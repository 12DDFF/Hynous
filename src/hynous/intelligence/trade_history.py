"""
Trade History Analyzer — learns from Nous trade memory to warn on weak setups.

Periodically loads trade closes from Nous, computes per-pattern win rates,
and exposes them for the trading tool and briefing. No ML model — the
patterns are clear enough for lookup tables (squeeze=27% WR, shorts>longs,
time-of-day effects).

Thread-safe singleton with lazy loading + periodic refresh (every 30min).
"""

import json
import logging
import math
import threading
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# ─── Pattern Stats ────────────────────────────────────────────────────────────


@dataclass
class PatternStats:
    """Win rate + sample size for a single pattern."""
    wins: int = 0
    total: int = 0
    avg_pnl: float = 0.0
    avg_mfe: float = 0.0
    avg_mae: float = 0.0

    @property
    def win_rate(self) -> float:
        return self.wins / self.total if self.total > 0 else 0.0

    @property
    def significant(self) -> bool:
        return self.total >= 10


@dataclass
class TradeHistoryStats:
    """Aggregated stats from all trade history."""
    total_trades: int = 0
    overall_wr: float = 0.0
    last_updated: float = 0.0

    by_symbol: dict[str, PatternStats] = field(default_factory=dict)
    by_side: dict[str, PatternStats] = field(default_factory=dict)
    by_hour: dict[int, PatternStats] = field(default_factory=dict)
    by_keyword: dict[str, PatternStats] = field(default_factory=dict)
    by_regime: dict[str, PatternStats] = field(default_factory=dict)
    by_combo: dict[str, PatternStats] = field(default_factory=dict)


# ─── Singleton ────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_stats: TradeHistoryStats | None = None
_last_load: float = 0.0
_REFRESH_INTERVAL = 1800  # 30 minutes


def _extract_hour(ts: str) -> int | None:
    if not ts or " " not in ts:
        return None
    try:
        return int(ts.split(" ")[1].split(":")[0])
    except (IndexError, ValueError):
        return None


def _extract_regime(text: str) -> str | None:
    text_upper = text.upper()
    for regime in ["TREND_BULL", "TREND_BEAR", "RANGING", "VOLATILE_BULL", "VOLATILE_BEAR", "SQUEEZE"]:
        if regime in text_upper:
            return regime
    return None


_KEYWORDS = [
    "book_flip", "cvd", "funding", "whale", "smart_money",
    "momentum", "squeeze", "breakout", "reversal", "dip",
    "bounce", "scalp", "trend", "flush", "liquidation",
]


def _load_from_nous() -> TradeHistoryStats:
    """Load trade history from Nous and compute pattern stats.

    Strategy: fetch trade_close nodes (have all outcome data) and
    trade_entry nodes (have thesis text + confidence) separately.
    Match entries to closes by symbol + timestamp proximity.
    This avoids 700+ per-node edge API calls.
    """
    from ..nous.client import get_client

    stats = TradeHistoryStats(last_updated=time.time())

    try:
        client = get_client()
    except Exception as e:
        logger.warning("Trade history: can't connect to Nous: %s", e)
        return stats

    # Fetch all trade closes (paginated via created_before cursor)
    all_closes: list[dict] = []
    cursor: str | None = None
    for page in range(10):  # Safety cap: 10 pages × 200 = 2000 trades max
        try:
            kwargs: dict = {"subtype": "custom:trade_close", "limit": 200}
            if cursor:
                kwargs["created_before"] = cursor
            nodes = client.list_nodes(**kwargs)
            if not nodes:
                break
            all_closes.extend(nodes)
            if len(nodes) < 200:
                break
            # Use oldest node's timestamp as cursor for next page
            timestamps = [n.get("created_at", n.get("provenance_created_at", ""))
                          for n in nodes if n.get("created_at") or n.get("provenance_created_at")]
            if timestamps:
                cursor = min(timestamps)
            else:
                break
        except Exception as e:
            logger.warning("Trade history: failed to fetch closes (page %d): %s", page, e)
            break

    if not all_closes:
        logger.info("Trade history: no trade closes found in Nous")
        return stats

    # Fetch trade entries for thesis text matching (paginated)
    all_entries: list[dict] = []
    cursor = None
    for page in range(10):
        try:
            kwargs = {"subtype": "custom:trade_entry", "limit": 200}
            if cursor:
                kwargs["created_before"] = cursor
            nodes = client.list_nodes(**kwargs)
            if not nodes:
                break
            all_entries.extend(nodes)
            if len(nodes) < 200:
                break
            timestamps = [n.get("created_at", n.get("provenance_created_at", ""))
                          for n in nodes if n.get("created_at") or n.get("provenance_created_at")]
            cursor = min(timestamps) if timestamps else None
            if not cursor:
                break
        except Exception:
            break

    # Build entry lookup: symbol+side+approx_time -> entry data
    entry_lookup: dict[str, dict] = {}  # key = "BTC:long:2026-03-09 02" (hour-level)
    for node in all_entries:
        body_raw = node.get("content_body", "")
        try:
            body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
        except (json.JSONDecodeError, TypeError):
            continue
        signals = body.get("signals", {})
        text = body.get("text", "")
        sym = signals.get("symbol", "")
        side = signals.get("side", "")
        ts = node.get("created_at", node.get("provenance_created_at", ""))
        if sym and side and ts:
            # Store by hour-level key for approximate matching
            hour_key = ts[:13] if len(ts) >= 13 else ts[:10]
            key = f"{sym}:{side}:{hour_key}"
            entry_lookup[key] = {
                "confidence": signals.get("confidence", 0),
                "rr_ratio": signals.get("rr_ratio", 0),
                "text": text,
                "ts": ts,
            }

    # Process closes
    trades = []
    for node in all_closes:
        body_raw = node.get("content_body", "")
        try:
            body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
        except (json.JSONDecodeError, TypeError):
            continue

        signals = body.get("signals", {})
        if not signals.get("symbol"):
            continue

        sym = signals.get("symbol", "")
        side = signals.get("side", "")
        close_ts = node.get("created_at", node.get("provenance_created_at", ""))

        # Try to find matching entry
        entry_text = ""
        confidence = 0.0
        if close_ts and sym and side:
            hour_key = close_ts[:13] if len(close_ts) >= 13 else close_ts[:10]
            key = f"{sym}:{side}:{hour_key}"
            entry = entry_lookup.get(key, {})
            entry_text = entry.get("text", "")
            confidence = entry.get("confidence", 0)

        trades.append({
            "symbol": sym,
            "side": side,
            "pnl_usd": signals.get("pnl_usd", 0),
            "mfe_pct": signals.get("mfe_pct", 0),
            "mae_pct": signals.get("mae_pct", 0),
            "close_type": signals.get("close_type", ""),
            "leverage": signals.get("leverage", 0),
            "close_ts": close_ts,
            "entry_text": entry_text,
            "confidence": confidence,
        })

    # ─── Compute pattern stats ────────────────────────────────────────────

    def _update(ps: PatternStats, trade: dict):
        is_win = trade["pnl_usd"] > 0
        ps.total += 1
        if is_win:
            ps.wins += 1
        n = ps.total
        ps.avg_pnl = ps.avg_pnl * (n - 1) / n + trade["pnl_usd"] / n
        if trade["mfe_pct"]:
            ps.avg_mfe = ps.avg_mfe * (n - 1) / n + trade["mfe_pct"] / n
        if trade["mae_pct"]:
            ps.avg_mae = ps.avg_mae * (n - 1) / n + trade["mae_pct"] / n

    stats.total_trades = len(trades)
    total_wins = sum(1 for t in trades if t["pnl_usd"] > 0)
    stats.overall_wr = total_wins / len(trades) if trades else 0.0

    for t in trades:
        sym = t["symbol"]
        side = t["side"]
        hour = _extract_hour(t["close_ts"])
        regime = _extract_regime(t["entry_text"])
        text_lower = t["entry_text"].lower()

        # By symbol
        if sym not in stats.by_symbol:
            stats.by_symbol[sym] = PatternStats()
        _update(stats.by_symbol[sym], t)

        # By side
        if side not in stats.by_side:
            stats.by_side[side] = PatternStats()
        _update(stats.by_side[side], t)

        # By hour
        if hour is not None:
            if hour not in stats.by_hour:
                stats.by_hour[hour] = PatternStats()
            _update(stats.by_hour[hour], t)

        # By keyword
        for kw in _KEYWORDS:
            if kw in text_lower:
                if kw not in stats.by_keyword:
                    stats.by_keyword[kw] = PatternStats()
                _update(stats.by_keyword[kw], t)

        # By regime
        if regime:
            if regime not in stats.by_regime:
                stats.by_regime[regime] = PatternStats()
            _update(stats.by_regime[regime], t)

        # Combos
        combo1 = f"{sym}:{side}"
        if combo1 not in stats.by_combo:
            stats.by_combo[combo1] = PatternStats()
        _update(stats.by_combo[combo1], t)

        if regime:
            combo2 = f"{sym}:{side}:{regime}"
            if combo2 not in stats.by_combo:
                stats.by_combo[combo2] = PatternStats()
            _update(stats.by_combo[combo2], t)

    logger.info(
        "Trade history loaded: %d trades, %.1f%% WR, %d symbols, %d combos",
        stats.total_trades, stats.overall_wr * 100,
        len(stats.by_symbol), len(stats.by_combo),
    )
    return stats


def get_trade_history() -> TradeHistoryStats | None:
    """Get cached trade history stats. Lazy-loads, refreshes every 30min."""
    global _stats, _last_load

    now = time.time()
    if _stats is not None and (now - _last_load) < _REFRESH_INTERVAL:
        return _stats

    with _lock:
        if _stats is not None and (now - _last_load) < _REFRESH_INTERVAL:
            return _stats

        try:
            _stats = _load_from_nous()
            _last_load = now
        except Exception as e:
            logger.error("Failed to load trade history: %s", e)
            if _stats is None:
                _stats = TradeHistoryStats()
                _last_load = now

    return _stats


def invalidate_cache() -> None:
    """Force refresh on next access (call after a new trade is stored)."""
    global _last_load
    _last_load = 0.0


# ─── Trade Quality Warnings ──────────────────────────────────────────────────


def get_trade_warnings(
    symbol: str,
    side: str,
    confidence: float | None = None,
    reasoning: str = "",
    hour: int | None = None,
) -> list[str]:
    """Generate historical pattern warnings for a proposed trade.

    Only warns on near-certain losers: <=15% WR with n>=15.
    Returns warning strings. Empty list = no concerns.
    """
    stats = get_trade_history()
    if not stats or stats.total_trades < 50:
        return []

    warnings: list[str] = []
    text_lower = reasoning.lower()

    # Thresholds — only fire on patterns that almost always lose
    _MIN_SAMPLES = 15   # Need real sample size to trust the signal
    _MAX_WR = 0.15      # <=15% win rate = nearly always loses
    _COMBO_MIN = 10     # Combos need fewer since they're more specific
    _COMBO_MAX_WR = 0.10  # <=10% for combos (stricter since smaller n)

    # --- Keyword patterns (squeeze, etc.) ---
    for kw in _KEYWORDS:
        if kw in text_lower:
            kw_stats = stats.by_keyword.get(kw)
            if (kw_stats and kw_stats.total >= _MIN_SAMPLES
                    and kw_stats.win_rate <= _MAX_WR):
                warnings.append(
                    f"HISTORY: \"{kw}\" setups win {kw_stats.win_rate:.0%} "
                    f"(n={kw_stats.total}). Nearly always loses."
                )

    # --- Symbol:side combo ---
    combo = f"{symbol}:{side}"
    combo_stats = stats.by_combo.get(combo)
    if (combo_stats and combo_stats.total >= _MIN_SAMPLES
            and combo_stats.win_rate <= _MAX_WR):
        warnings.append(
            f"HISTORY: {symbol} {side}s win {combo_stats.win_rate:.0%} "
            f"(n={combo_stats.total}). Nearly always loses."
        )

    # --- Hour of day (only if basically 0%) ---
    if hour is not None:
        hour_stats = stats.by_hour.get(hour)
        if (hour_stats and hour_stats.total >= _COMBO_MIN
                and hour_stats.win_rate <= _COMBO_MAX_WR):
            warnings.append(
                f"HISTORY: Trades at {hour:02d}:00 UTC win {hour_stats.win_rate:.0%} "
                f"(n={hour_stats.total}). Dead zone."
            )

    # --- Regime + symbol + side combo ---
    regime = _extract_regime(reasoning)
    if regime:
        combo3 = f"{symbol}:{side}:{regime}"
        combo3_stats = stats.by_combo.get(combo3)
        if (combo3_stats and combo3_stats.total >= _COMBO_MIN
                and combo3_stats.win_rate <= _COMBO_MAX_WR):
            warnings.append(
                f"HISTORY: {symbol} {side} in {regime} = "
                f"{combo3_stats.win_rate:.0%} WR (n={combo3_stats.total}). "
                f"This exact setup nearly always loses."
            )

    return warnings


def format_history_summary() -> str:
    """Compact trade history summary for briefing injection."""
    stats = get_trade_history()
    if not stats or stats.total_trades < 20:
        return ""

    lines = [f"Trade History ({stats.total_trades} trades, {stats.overall_wr:.0%} WR):"]

    # Per-symbol
    for sym in sorted(stats.by_symbol.keys()):
        ps = stats.by_symbol[sym]
        if ps.total >= 5:
            lines.append(f"  {sym}: {ps.win_rate:.0%} WR (n={ps.total})")

    # Side bias
    long_stats = stats.by_side.get("long")
    short_stats = stats.by_side.get("short")
    if long_stats and short_stats:
        lines.append(
            f"  Long: {long_stats.win_rate:.0%} | Short: {short_stats.win_rate:.0%}"
        )

    # Weakest patterns
    weak = []
    for kw, ps in sorted(stats.by_keyword.items(), key=lambda x: x[1].win_rate):
        if ps.significant and ps.win_rate < 0.32:
            weak.append(f"{kw} ({ps.win_rate:.0%})")
    if weak:
        lines.append(f"  Weak patterns: {', '.join(weak[:3])}")

    return "\n".join(lines)
