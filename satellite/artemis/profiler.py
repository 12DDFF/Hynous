"""Batch wallet profiling from Artemis Node Fills.

FIFO-matches trades per wallet to compute:
  - Win rate, profit factor, avg hold hours
  - Style classification (scalper, swing, etc.)
  - Bot detection (high frequency + low hold time)

Processes ~10K wallets in ~30-60 minutes on VPS.
"""

import logging
import time

log = logging.getLogger(__name__)


def batch_profile(
    db: object,
    trade_records: dict[str, list],
    date_str: str,
    min_trades: int = 10,
) -> int:
    """Profile wallets from their trade history using FIFO matching.

    Args:
        db: data-layer Database.
        trade_records: Dict mapping address -> list of trade dicts.
        date_str: Processing date (for logging).
        min_trades: Minimum trades needed for a meaningful profile.

    Returns:
        Number of profiles computed.
    """
    profiles_computed = 0

    for address, trades in trade_records.items():
        if len(trades) < min_trades:
            continue

        try:
            profile = compute_profile(address, trades)
            if profile is None:
                continue

            with db.write_lock:
                db.conn.execute(
                    """
                    INSERT OR REPLACE INTO wallet_profiles
                    (address, computed_at, win_rate, trade_count,
                     profit_factor, avg_hold_hours, avg_pnl_pct,
                     max_drawdown, style, is_bot, equity)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        address, time.time(),
                        profile["win_rate"],
                        profile["trade_count"],
                        profile["profit_factor"],
                        profile["avg_hold_hours"],
                        profile["avg_pnl_pct"],
                        profile["max_drawdown"],
                        profile["style"],
                        profile["is_bot"],
                        profile["equity"],
                    ),
                )
                db.conn.commit()

            profiles_computed += 1

        except Exception:
            pass  # skip individual profile failures

    return profiles_computed


def compute_profile(
    address: str, trades: list,
) -> dict | None:
    """Compute profile metrics from a list of trades.

    Uses FIFO matching: first buy matched with first sell for PnL.

    Args:
        address: Wallet address.
        trades: List of trade dicts (coin, side, px, sz, size_usd, time).

    Returns:
        Dict with profile metrics, or None if insufficient data.
    """
    # Group by coin, FIFO match
    by_coin: dict[str, list] = {}
    for t in sorted(trades, key=lambda x: x["time"]):
        coin = t["coin"]
        if coin not in by_coin:
            by_coin[coin] = []
        by_coin[coin].append(t)

    matched_trades = []
    for coin, coin_trades in by_coin.items():
        entries = []
        for t in coin_trades:
            if t["side"] == "buy":
                entries.append(t)
            elif t["side"] == "sell" and entries:
                entry = entries.pop(0)  # FIFO
                if entry["px"] <= 0:
                    continue
                pnl_pct = (
                    (t["px"] - entry["px"]) / entry["px"] * 100
                )
                hold_seconds = t["time"] - entry["time"]
                matched_trades.append({
                    "coin": coin,
                    "entry_px": entry["px"],
                    "exit_px": t["px"],
                    "size_usd": entry["size_usd"],
                    "pnl_pct": pnl_pct,
                    "hold_hours": hold_seconds / 3600,
                    "is_win": 1 if pnl_pct > 0 else 0,
                })

    if len(matched_trades) < 5:
        return None

    wins = sum(1 for t in matched_trades if t["is_win"])
    win_rate = wins / len(matched_trades)
    avg_hold = (
        sum(t["hold_hours"] for t in matched_trades)
        / len(matched_trades)
    )
    avg_pnl = (
        sum(t["pnl_pct"] for t in matched_trades)
        / len(matched_trades)
    )

    gross_profit = sum(
        t["pnl_pct"] for t in matched_trades if t["pnl_pct"] > 0
    )
    gross_loss = abs(sum(
        t["pnl_pct"] for t in matched_trades if t["pnl_pct"] < 0
    ))
    profit_factor = (
        gross_profit / gross_loss if gross_loss > 0 else 999.0
    )

    # Drawdown (cumulative PnL)
    cumulative = 0.0
    peak = 0.0
    max_dd = 0.0
    for t in matched_trades:
        cumulative += t["pnl_pct"]
        peak = max(peak, cumulative)
        dd = peak - cumulative
        max_dd = max(max_dd, dd)

    # Bot detection heuristic
    span_hours = sum(t["hold_hours"] for t in matched_trades)
    span_days = max(1, span_hours / 24)
    trades_per_day = len(matched_trades) / span_days
    is_bot = (
        1 if trades_per_day > 50 and avg_hold < 2 / 60 else 0
    )

    # Style classification
    if avg_hold < 1:
        style = "scalper"
    elif avg_hold < 24:
        style = "day_trader"
    elif avg_hold < 168:
        style = "swing"
    else:
        style = "position"

    return {
        "win_rate": round(win_rate, 4),
        "trade_count": len(matched_trades),
        "profit_factor": round(min(profit_factor, 999.0), 2),
        "avg_hold_hours": round(avg_hold, 2),
        "avg_pnl_pct": round(avg_pnl, 4),
        "max_drawdown": round(max_dd, 2),
        "style": style,
        "is_bot": is_bot,
        "equity": 0,  # not available from Node Fills alone
    }
