"""Tiered position polling — polls user_state for discovered addresses."""

import time
import threading
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from hyperliquid.info import Info

from hynous_data.core.config import PositionPollerConfig
from hynous_data.core.db import Database
from hynous_data.core.rate_limiter import RateLimiter
from hynous_data.core.utils import safe_float
from hynous_data.engine.smart_money import SmartMoneyEngine

log = logging.getLogger(__name__)

USER_STATE_WEIGHT = 2  # Hyperliquid API weight for clearinghouseState
ADDRESS_MAX_AGE_DAYS = 7  # Stop polling addresses inactive for this long


class PositionPoller:
    """Polls user_state for discovered addresses, tiered by size."""

    def __init__(
        self,
        db: Database,
        rate_limiter: RateLimiter,
        config: PositionPollerConfig,
        base_url: str = "https://api.hyperliquid.xyz",
    ):
        self._db = db
        self._rl = rate_limiter
        self._cfg = config
        self._info = Info(base_url=base_url, skip_ws=True)
        self._smart_money: SmartMoneyEngine | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._executor = ThreadPoolExecutor(max_workers=config.workers)
        self._equity_snapshots: list[tuple[str, float, float]] = []  # (addr, equity, unrealized)
        self._equity_lock = threading.Lock()
        # Stats
        self.total_polls = 0
        self.total_positions_upserted = 0
        self.total_positions_deleted = 0
        self.total_errors = 0

    def set_smart_money(self, engine: SmartMoneyEngine):
        """Wire the smart money engine for PnL snapshot recording."""
        self._smart_money = engine

    def start(self):
        self._thread = threading.Thread(target=self._run, name="position-poller", daemon=True)
        self._thread.start()

    def _run(self):
        log.info("PositionPoller starting (workers=%d)", self._cfg.workers)
        while not self._stop_event.is_set():
            try:
                self._poll_cycle()
            except Exception:
                log.exception("PositionPoller cycle error")
            self._stop_event.wait(5)  # Brief sleep between cycles

    def _poll_cycle(self):
        """Fetch stale addresses and poll them in parallel."""
        now = time.time()
        conn = self._db.conn

        # Get addresses that are due for re-polling, ordered by tier then staleness
        # Skip addresses not seen trading in ADDRESS_MAX_AGE_DAYS
        active_cutoff = now - ADDRESS_MAX_AGE_DAYS * 86400
        rows = conn.execute(
            """
            SELECT address, tier FROM addresses
            WHERE last_seen >= ?
            AND (
                (tier = 1 AND (last_polled IS NULL OR last_polled < ?))
                OR (tier = 2 AND (last_polled IS NULL OR last_polled < ?))
                OR (tier = 3 AND (last_polled IS NULL OR last_polled < ?))
            )
            ORDER BY tier ASC, last_polled ASC
            LIMIT 200
            """,
            (
                active_cutoff,
                now - self._cfg.tier1_interval,
                now - self._cfg.tier2_interval,
                now - self._cfg.tier3_interval,
            ),
        ).fetchall()

        if not rows:
            self._stop_event.wait(2)
            return

        # Submit polling tasks
        futures = {}
        for row in rows:
            if self._stop_event.is_set():
                break
            addr = row["address"]
            fut = self._executor.submit(self._poll_address, addr)
            futures[fut] = addr

        # Collect results and batch upsert
        all_positions = []
        polled_addrs = []
        polled_results: list[tuple[str, set[str]]] = []  # (addr, {coins with positions})
        for fut in as_completed(futures):
            addr = futures[fut]
            try:
                positions, total_size, active_coins = fut.result()
                if positions is not None:
                    all_positions.extend(positions)
                    polled_addrs.append((addr, total_size))
                    polled_results.append((addr, active_coins))
            except Exception:
                self.total_errors += 1
                log.debug("Poll failed for %s", addr)

        # Batch upsert positions + delete closed ones
        if all_positions:
            self._upsert_positions(all_positions)
        if polled_results:
            self._delete_closed_positions(polled_results)

        # Update address metadata
        if polled_addrs:
            self._update_address_meta(polled_addrs)

        # Flush equity snapshots for smart money
        self._flush_equity_snapshots()

    def _poll_address(self, address: str) -> tuple[list[dict] | None, float, set[str]]:
        """Poll a single address. Returns (positions, total_size_usd, active_coins)."""
        if not self._rl.acquire(USER_STATE_WEIGHT, timeout=10):
            return None, 0, set()

        try:
            state = self._info.user_state(address)
            self.total_polls += 1
        except Exception:
            self.total_errors += 1
            return None, 0, set()

        now = time.time()
        positions = []
        total_size = 0.0
        active_coins: set[str] = set()

        # Extract equity for PnL snapshots (smart money tracking)
        margin_summary = state.get("marginSummary", {})
        equity = safe_float(margin_summary.get("accountValue", 0))
        unrealized = safe_float(margin_summary.get("totalUnrealizedPnl", 0))
        with self._equity_lock:
            self._equity_snapshots.append((address, equity, unrealized))

        for pos in state.get("assetPositions", []):
            p = pos.get("position", {})
            coin = p.get("coin", "")
            size = safe_float(p.get("szi", 0))
            if size == 0 or coin == "":
                continue

            entry_px = safe_float(p.get("entryPx", 0))
            if entry_px <= 0:
                continue  # corrupt data — skip

            pos_val = safe_float(p.get("positionValue", 0))
            mark_px = pos_val / abs(size) if size else entry_px
            if mark_px <= 0:
                mark_px = entry_px
            lev = safe_float(p.get("leverage", {}).get("value", 1))
            liq_raw = p.get("liquidationPx")
            liq_px = safe_float(liq_raw) if liq_raw else None
            margin_used = safe_float(p.get("marginUsed", 0))
            upnl = safe_float(p.get("unrealizedPnl", 0))

            # Sanity checks
            if lev > 200 or lev < 0:
                lev = 1
            if liq_px is not None and liq_px <= 0:
                liq_px = None

            size_usd = abs(size) * mark_px
            total_size += size_usd
            active_coins.add(coin)

            positions.append({
                "address": address,
                "coin": coin,
                "side": "long" if size > 0 else "short",
                "size": abs(size),
                "size_usd": size_usd,
                "entry_px": entry_px,
                "mark_px": mark_px,
                "leverage": lev,
                "margin_used": margin_used,
                "liq_px": liq_px,
                "unrealized_pnl": upnl,
                "updated_at": now,
            })

        return positions, total_size, active_coins

    def _delete_closed_positions(self, polled_results: list[tuple[str, set[str]]]):
        """Delete DB rows for positions an address no longer holds."""
        conn = self._db.conn
        try:
            with self._db.write_lock:
                for addr, active_coins in polled_results:
                    if active_coins:
                        placeholders = ",".join("?" for _ in active_coins)
                        cur = conn.execute(
                            f"DELETE FROM positions WHERE address = ? AND coin NOT IN ({placeholders})",
                            (addr, *active_coins),
                        )
                    else:
                        cur = conn.execute(
                            "DELETE FROM positions WHERE address = ?", (addr,)
                        )
                    self.total_positions_deleted += cur.rowcount
                conn.commit()
        except Exception:
            log.exception("Failed to delete closed positions")

    def _flush_equity_snapshots(self):
        """Write queued equity snapshots for smart money tracking."""
        if not self._smart_money:
            return
        with self._equity_lock:
            if not self._equity_snapshots:
                return
            snapshots = self._equity_snapshots[:]
            self._equity_snapshots.clear()
        # Filter and batch write
        valid = [(a, e, u) for a, e, u in snapshots if e > 0]
        if valid:
            self._smart_money.batch_snapshot_pnl(valid)

    def _upsert_positions(self, positions: list[dict]):
        """Batch INSERT OR REPLACE positions."""
        conn = self._db.conn
        try:
            with self._db.write_lock:
                conn.executemany(
                    """
                    INSERT OR REPLACE INTO positions
                    (address, coin, side, size, size_usd, entry_px, mark_px,
                     leverage, margin_used, liq_px, unrealized_pnl, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            p["address"], p["coin"], p["side"], p["size"], p["size_usd"],
                            p["entry_px"], p["mark_px"], p["leverage"], p["margin_used"],
                            p["liq_px"], p["unrealized_pnl"], p["updated_at"],
                        )
                        for p in positions
                    ],
                )
                conn.commit()
            self.total_positions_upserted += len(positions)
        except Exception:
            log.exception("Failed to upsert %d positions", len(positions))

    def _update_address_meta(self, polled: list[tuple[str, float]]):
        """Update last_polled + reclassify tiers."""
        now = time.time()
        conn = self._db.conn
        try:
            with self._db.write_lock:
                conn.executemany(
                    """
                    UPDATE addresses SET
                        last_polled = ?,
                        total_size_usd = ?,
                        tier = CASE
                            WHEN ? >= ? THEN 1
                            WHEN ? >= ? THEN 2
                            ELSE 3
                        END
                    WHERE address = ?
                    """,
                    [
                        (
                            now, total_size,
                            total_size, self._cfg.whale_threshold,
                            total_size, self._cfg.mid_threshold,
                            addr,
                        )
                        for addr, total_size in polled
                    ],
                )
                conn.commit()
        except Exception:
            log.exception("Failed to update address meta")

    def stop(self):
        self._stop_event.set()
        self._executor.shutdown(wait=True, cancel_futures=True)
        if self._thread:
            self._thread.join(timeout=5)

    def stats(self) -> dict:
        conn = self._db.conn
        counts = conn.execute(
            "SELECT tier, COUNT(*) as cnt FROM addresses GROUP BY tier"
        ).fetchall()
        tier_counts = {row["tier"]: row["cnt"] for row in counts}
        return {
            "total_polls": self.total_polls,
            "total_positions_upserted": self.total_positions_upserted,
            "total_errors": self.total_errors,
            "tier_counts": tier_counts,
        }
