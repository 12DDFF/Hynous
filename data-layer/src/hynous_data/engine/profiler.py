"""Wallet profiler — fetch fills, compute win rate / style, manage watchlist."""

import time
import logging

from hyperliquid.info import Info

from hynous_data.core.config import SmartMoneyConfig
from hynous_data.core.db import Database
from hynous_data.core.rate_limiter import RateLimiter

log = logging.getLogger(__name__)

FILLS_WEIGHT = 20  # Hyperliquid API weight for user_fills_by_time


class WalletProfiler:
    """Fetches trade history, computes profiles, manages watchlist."""

    def __init__(
        self,
        db: Database,
        rate_limiter: RateLimiter,
        config: SmartMoneyConfig,
        base_url: str = "https://api.hyperliquid.xyz",
    ):
        self._db = db
        self._rl = rate_limiter
        self._cfg = config
        self._info = Info(base_url=base_url, skip_ws=True)

    # ------------------------------------------------------------------
    # Fill fetching
    # ------------------------------------------------------------------

    def fetch_fills(self, address: str, days: int | None = None) -> list[dict]:
        """Fetch fills for an address over the profiling window.

        Returns raw fill dicts: {coin, dir, px, sz, closedPnl, time, startPosition, crossed}
        """
        window = days or self._cfg.profile_window_days
        start_ms = int((time.time() - window * 86400) * 1000)

        if not self._rl.acquire(FILLS_WEIGHT, timeout=30):
            log.warning("Rate limit timeout fetching fills for %s", address[:10])
            return []

        try:
            fills = self._info.user_fills_by_time(address, start_ms)
            return fills if isinstance(fills, list) else []
        except Exception:
            log.exception("Failed to fetch fills for %s", address[:10])
            return []

    # ------------------------------------------------------------------
    # Profile computation
    # ------------------------------------------------------------------

    def compute_profile(self, fills: list[dict]) -> dict:
        """FIFO trade matching → aggregate stats.

        Groups fills by coin, pairs open/close sequences, computes:
        win_rate, profit_factor, avg_hold_hours, avg_pnl_pct, trade_count,
        max_drawdown, style, is_bot.
        """
        if not fills:
            return {}

        # Group fills by coin, sorted by time
        by_coin: dict[str, list[dict]] = {}
        for f in fills:
            coin = f.get("coin", "")
            if not coin:
                continue
            by_coin.setdefault(coin, []).append(f)

        trades = []
        for coin, coin_fills in by_coin.items():
            coin_fills.sort(key=lambda x: x.get("time", 0))
            trades.extend(self._match_trades(coin, coin_fills))

        if len(trades) < self._cfg.min_trades_for_profile:
            return {}

        # Aggregate
        wins = 0
        gross_profit = 0.0
        gross_loss = 0.0
        hold_hours = []
        pnl_pcts = []
        running_equity = 0.0
        peak = 0.0
        max_dd = 0.0

        for t in trades:
            pnl = t["pnl_usd"]
            if pnl > 0:
                wins += 1
                gross_profit += pnl
            else:
                gross_loss += abs(pnl)

            hold_hours.append(t["hold_hours"])
            pnl_pcts.append(t["pnl_pct"])

            running_equity += pnl
            if running_equity > peak:
                peak = running_equity
            dd = peak - running_equity
            if dd > max_dd:
                max_dd = dd

        trade_count = len(trades)
        win_rate = wins / trade_count if trade_count else 0
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else (
            999.0 if gross_profit > 0 else 0.0
        )
        avg_hold = sum(hold_hours) / len(hold_hours) if hold_hours else 0
        avg_pnl = sum(pnl_pcts) / len(pnl_pcts) if pnl_pcts else 0

        # Time span for trades_per_day
        if trades:
            first_t = trades[0]["entry_time"]
            last_t = trades[-1]["exit_time"]
            span_days = max((last_t - first_t) / 86400, 1)
        else:
            span_days = 1
        trades_per_day = trade_count / span_days

        # Style classification
        is_bot = (
            trades_per_day > self._cfg.bot_trades_per_day
            or avg_hold * 60 < self._cfg.bot_avg_hold_min  # avg_hold is in hours
        )
        if is_bot:
            style = "bot"
        elif avg_hold < 1.0:
            style = "scalper"
        elif avg_hold > 4.0:
            style = "swing"
        else:
            style = "mixed"

        return {
            "win_rate": round(win_rate, 4),
            "trade_count": trade_count,
            "profit_factor": round(profit_factor, 2),
            "avg_hold_hours": round(avg_hold, 2),
            "avg_pnl_pct": round(avg_pnl, 4),
            "max_drawdown": round(max_dd, 2),
            "style": style,
            "is_bot": 1 if is_bot else 0,
            "_trades": trades,  # raw matched trades for DB storage
        }

    def _match_trades(self, coin: str, fills: list[dict]) -> list[dict]:
        """FIFO trade matching for a single coin.

        Uses closedPnl from Hyperliquid — each fill that closes a position
        reports its realized PnL directly. We group consecutive fills into
        trades based on position flips (startPosition crossing zero).
        """
        trades = []
        current_trade: dict | None = None

        for f in fills:
            px = float(f.get("px", 0))
            sz = float(f.get("sz", 0))
            closed_pnl = float(f.get("closedPnl", 0))
            ts = f.get("time", 0)
            # Hyperliquid time is in ms
            if ts > 1e12:
                ts = ts / 1000
            direction = f.get("dir", "")  # "Open Long", "Close Long", etc.
            start_pos = float(f.get("startPosition", 0))

            is_open = "Open" in direction
            side = "long" if "Long" in direction or "Buy" in direction else "short"

            if is_open and current_trade is None:
                # Start new trade
                current_trade = {
                    "coin": coin,
                    "side": side,
                    "entry_px": px,
                    "entry_size": sz,
                    "entry_time": ts,
                    "pnl_usd": 0.0,
                    "exit_time": ts,
                }
            elif current_trade is not None:
                current_trade["pnl_usd"] += closed_pnl
                current_trade["exit_time"] = ts

                # Check if position is fully closed
                # startPosition tells us position BEFORE this fill
                # If closedPnl != 0, some portion was closed
                if not is_open and closed_pnl != 0:
                    # Position closed (partially or fully)
                    # Check if we're flat after this fill
                    remaining = abs(start_pos) - sz
                    if remaining <= sz * 0.01:  # effectively flat
                        self._finalize_trade(current_trade, trades)
                        current_trade = None

        # Finalize any open trade
        if current_trade is not None and current_trade["pnl_usd"] != 0:
            self._finalize_trade(current_trade, trades)

        return trades

    def _finalize_trade(self, trade: dict, trades: list[dict]):
        """Compute derived fields and append to trades list."""
        hold_s = trade["exit_time"] - trade["entry_time"]
        trade["hold_hours"] = max(hold_s / 3600, 0.001)
        entry_val = trade["entry_px"] * trade["entry_size"]
        trade["pnl_pct"] = (trade["pnl_usd"] / entry_val) if entry_val > 0 else 0
        # Derive exit_px from PnL: pnl = (exit - entry) * size for long, inverse for short
        if trade["entry_size"] > 0 and trade["entry_px"] > 0:
            if trade["side"] == "long":
                trade["exit_px"] = trade["entry_px"] + trade["pnl_usd"] / trade["entry_size"]
            else:
                trade["exit_px"] = trade["entry_px"] - trade["pnl_usd"] / trade["entry_size"]
        else:
            trade["exit_px"] = trade["entry_px"]
        trades.append(trade)

    # ------------------------------------------------------------------
    # Profile refresh (called periodically by orchestrator)
    # ------------------------------------------------------------------

    def refresh_profiles(self):
        """Recompute profiles for watched + auto-discovered addresses."""
        conn = self._db.conn
        now = time.time()
        cutoff = now - self._cfg.profile_refresh_hours * 3600

        # 1. Watched wallets needing refresh
        stale = conn.execute(
            """
            SELECT w.address FROM watched_wallets w
            LEFT JOIN wallet_profiles p ON w.address = p.address
            WHERE w.is_active = 1
            AND (p.computed_at IS NULL OR p.computed_at < ?)
            LIMIT ?
            """,
            (cutoff, self._cfg.max_profiles_per_cycle),
        ).fetchall()

        addresses = [r["address"] for r in stale]

        # 2. Auto-discovery: top ranked addresses without profiles
        remaining = self._cfg.max_profiles_per_cycle - len(addresses)
        if remaining > 0:
            ranked = conn.execute(
                """
                SELECT DISTINCT ps.address FROM pnl_snapshots ps
                LEFT JOIN wallet_profiles wp ON ps.address = wp.address
                WHERE wp.address IS NULL
                AND ps.snapshot_at > ?
                AND ps.equity >= ?
                ORDER BY ps.equity DESC
                LIMIT ?
                """,
                (now - 86400, self._cfg.min_equity, remaining),
            ).fetchall()
            addresses.extend(r["address"] for r in ranked)

        if not addresses:
            return

        log.info("Profiling %d addresses", len(addresses))
        profiled = 0
        for addr in addresses:
            try:
                fills = self.fetch_fills(addr)
                if not fills:
                    continue
                profile = self.compute_profile(fills)
                if not profile:
                    continue

                # Get latest equity
                eq_row = conn.execute(
                    "SELECT equity FROM pnl_snapshots WHERE address = ? ORDER BY snapshot_at DESC LIMIT 1",
                    (addr,),
                ).fetchone()
                equity = eq_row["equity"] if eq_row else None

                self._upsert_profile(addr, profile, equity)
                profiled += 1
            except Exception:
                log.exception("Failed to profile %s", addr[:10])

        if profiled:
            log.info("Profiled %d/%d addresses", profiled, len(addresses))

    def _upsert_profile(self, address: str, profile: dict, equity: float | None):
        """Write profile to wallet_profiles table + cache matched trades."""
        conn = self._db.conn
        trades = profile.pop("_trades", [])
        with self._db.write_lock:
            conn.execute(
                """
                INSERT OR REPLACE INTO wallet_profiles
                (address, computed_at, win_rate, trade_count, profit_factor,
                 avg_hold_hours, avg_pnl_pct, max_drawdown, style, is_bot, equity)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    address,
                    time.time(),
                    profile.get("win_rate"),
                    profile.get("trade_count"),
                    profile.get("profit_factor"),
                    profile.get("avg_hold_hours"),
                    profile.get("avg_pnl_pct"),
                    profile.get("max_drawdown"),
                    profile.get("style"),
                    profile.get("is_bot", 0),
                    equity,
                ),
            )
            # Replace cached trades for this address
            if trades:
                conn.execute("DELETE FROM wallet_trades WHERE address = ?", (address,))
                conn.executemany(
                    """
                    INSERT INTO wallet_trades
                    (address, coin, side, entry_px, exit_px, size_usd, pnl_usd,
                     pnl_pct, hold_hours, entry_time, exit_time, is_win)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            address,
                            t.get("coin", ""),
                            t.get("side", ""),
                            t.get("entry_px", 0),
                            t.get("exit_px", t.get("entry_px", 0)),
                            round(t.get("entry_px", 0) * t.get("entry_size", 0), 2),
                            round(t.get("pnl_usd", 0), 2),
                            round(t.get("pnl_pct", 0), 6),
                            round(t.get("hold_hours", 0), 3),
                            t.get("entry_time", 0),
                            t.get("exit_time", 0),
                            1 if t.get("pnl_usd", 0) > 0 else 0,
                        )
                        for t in trades
                    ],
                )
            conn.commit()

    # ------------------------------------------------------------------
    # Auto-curation
    # ------------------------------------------------------------------

    def auto_curate(self) -> int:
        """Auto-track wallets that meet quality thresholds.

        Returns count of newly added wallets.
        """
        cfg = self._cfg
        conn = self._db.conn

        # Count existing auto-curated wallets
        auto_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM watched_wallets WHERE is_active = 1 AND label LIKE 'auto %'",
        ).fetchone()["cnt"]

        remaining = cfg.auto_curate_max_wallets - auto_count
        if remaining <= 0:
            return 0

        # Build query for qualifying profiles NOT already watched
        bot_clause = "AND wp.is_bot = 0" if cfg.auto_curate_exclude_bots else ""
        candidates = conn.execute(
            f"""
            SELECT wp.address, wp.win_rate, wp.profit_factor, wp.trade_count, wp.style
            FROM wallet_profiles wp
            LEFT JOIN watched_wallets ww ON wp.address = ww.address AND ww.is_active = 1
            WHERE ww.address IS NULL
            AND wp.win_rate >= ?
            AND wp.trade_count >= ?
            AND wp.profit_factor >= ?
            {bot_clause}
            ORDER BY wp.win_rate * wp.profit_factor DESC
            LIMIT ?
            """,
            (cfg.auto_curate_min_win_rate, cfg.auto_curate_min_trades,
             cfg.auto_curate_min_profit_factor, remaining),
        ).fetchall()

        added = 0
        for row in candidates:
            wr_pct = round((row["win_rate"] or 0) * 100)
            style = row["style"] or "mixed"
            label = f"auto | {wr_pct}% WR | {style}"
            self.watch(row["address"], label)
            added += 1

        if added:
            log.info("Auto-curated %d wallets (%d/%d slots used)",
                     added, auto_count + added, cfg.auto_curate_max_wallets)
        return added

    # ------------------------------------------------------------------
    # Watchlist management
    # ------------------------------------------------------------------

    def watch(self, address: str, label: str = ""):
        """Add an address to the watchlist."""
        address = address.strip().lower()
        conn = self._db.conn
        now = time.time()
        with self._db.write_lock:
            # Ensure address exists in addresses table
            conn.execute(
                "INSERT OR IGNORE INTO addresses (address, first_seen, last_seen) VALUES (?, ?, ?)",
                (address, now, now),
            )
            conn.execute(
                """
                INSERT INTO watched_wallets (address, label, added_at, is_active)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(address) DO UPDATE SET
                    label = excluded.label,
                    is_active = 1
                """,
                (address, label, now),
            )
            conn.commit()
        log.info("Watching wallet %s (%s)", address[:10], label or "no label")

    def unwatch(self, address: str):
        """Remove an address from the watchlist."""
        address = address.strip().lower()
        conn = self._db.conn
        with self._db.write_lock:
            conn.execute(
                "UPDATE watched_wallets SET is_active = 0 WHERE address = ?",
                (address,),
            )
            conn.commit()
        log.info("Unwatched wallet %s", address[:10])

    def get_watchlist(self) -> list[dict]:
        """Get all active watched wallets with profile data + position counts + notes/tags."""
        conn = self._db.conn
        rows = conn.execute(
            """
            SELECT
                w.address, w.label, w.added_at,
                w.notes, w.tags,
                p.win_rate, p.trade_count, p.profit_factor,
                p.avg_hold_hours, p.style, p.is_bot, p.equity,
                p.computed_at,
                COALESCE(pc.cnt, 0) AS positions_count
            FROM watched_wallets w
            LEFT JOIN wallet_profiles p ON w.address = p.address
            LEFT JOIN (
                SELECT address, COUNT(*) AS cnt FROM positions GROUP BY address
            ) pc ON w.address = pc.address
            WHERE w.is_active = 1
            ORDER BY w.added_at DESC
            """,
        ).fetchall()

        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Single profile lookup
    # ------------------------------------------------------------------

    def get_profile(self, address: str, days: int = 30) -> dict | None:
        """Get full profile for an address. Computes on-demand if missing/stale.

        Args:
            address: wallet address
            days: how many days of fill history to analyze (default 30 for on-demand)
        """
        address = address.strip().lower()
        conn = self._db.conn

        # Check existing profile — recompute if missing or if requesting
        # a deeper window than what was cached (stale = older than refresh window)
        row = conn.execute(
            "SELECT * FROM wallet_profiles WHERE address = ?", (address,)
        ).fetchone()

        need_compute = not row
        if row and days > self._cfg.profile_window_days:
            # User is requesting deeper analysis — recompute if profile is
            # older than 1 hour (avoid re-fetching on every page reload)
            age_hours = (time.time() - (row["computed_at"] or 0)) / 3600
            if age_hours > 1:
                need_compute = True

        if need_compute:
            fills = self.fetch_fills(address, days=days)
            if not fills:
                if row:
                    # Fall back to existing profile
                    profile_data = dict(row)
                else:
                    return None
            else:
                profile = self.compute_profile(fills)
                if not profile:
                    if row:
                        profile_data = dict(row)
                    else:
                        return None
                else:
                    eq_row = conn.execute(
                        "SELECT equity FROM pnl_snapshots WHERE address = ? ORDER BY snapshot_at DESC LIMIT 1",
                        (address,),
                    ).fetchone()
                    equity = eq_row["equity"] if eq_row else None
                    self._upsert_profile(address, profile, equity)
                    profile_data = profile
                    profile_data["equity"] = equity
                    profile_data["address"] = address
                    profile_data["computed_at"] = time.time()
        else:
            profile_data = dict(row)

        # Attach current positions
        positions = conn.execute(
            """
            SELECT coin, side, size_usd, entry_px, mark_px, leverage, unrealized_pnl
            FROM positions WHERE address = ?
            """,
            (address,),
        ).fetchall()
        profile_data["positions"] = [dict(p) for p in positions]

        # Attach recent position changes (last 24h)
        cutoff = time.time() - 86400
        changes = conn.execute(
            """
            SELECT coin, action, side, size_usd, price, detected_at
            FROM position_changes
            WHERE address = ? AND detected_at > ?
            ORDER BY detected_at DESC
            LIMIT 20
            """,
            (address, cutoff),
        ).fetchall()
        profile_data["recent_changes"] = [dict(c) for c in changes]

        # Attach cached trade history (last 50)
        trades = conn.execute(
            """
            SELECT coin, side, entry_px, exit_px, size_usd, pnl_usd,
                   pnl_pct, hold_hours, entry_time, exit_time, is_win
            FROM wallet_trades
            WHERE address = ?
            ORDER BY exit_time DESC
            LIMIT 50
            """,
            (address,),
        ).fetchall()
        profile_data["trades"] = [dict(t) for t in trades]

        # Check if watched + get notes/tags
        watched = conn.execute(
            "SELECT label, notes, tags FROM watched_wallets WHERE address = ? AND is_active = 1",
            (address,),
        ).fetchone()
        profile_data["is_watched"] = watched is not None
        profile_data["label"] = watched["label"] if watched else ""
        profile_data["notes"] = watched["notes"] if watched else ""
        profile_data["tags"] = watched["tags"] if watched else ""

        # Active alerts
        alerts = conn.execute(
            "SELECT id, alert_type, min_size_usd, coins, created_at FROM wallet_alerts WHERE address = ? AND enabled = 1",
            (address,),
        ).fetchall()
        profile_data["alerts"] = [dict(a) for a in alerts]

        return profile_data
