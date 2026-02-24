"""HLP vault position tracker — polls known vault addresses."""

import time
import threading
import logging

from hyperliquid.info import Info

from hynous_data.core.config import HlpTrackerConfig
from hynous_data.core.db import Database
from hynous_data.core.rate_limiter import RateLimiter
from hynous_data.core.utils import safe_float

log = logging.getLogger(__name__)


class HlpTracker:
    """Polls HLP vault addresses for positions on a fixed interval."""

    def __init__(
        self,
        db: Database,
        rate_limiter: RateLimiter,
        config: HlpTrackerConfig,
        base_url: str = "https://api.hyperliquid.xyz",
    ):
        self._db = db
        self._rl = rate_limiter
        self._cfg = config
        self._info = Info(base_url=base_url, skip_ws=True, timeout=10)
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        # In-memory cache for latest HLP positions (for fast API reads)
        self.current_positions: list[dict] = []
        self._positions_lock = threading.Lock()
        # Stats
        self.total_polls = 0
        self.total_snapshots = 0

    def start(self):
        self._thread = threading.Thread(target=self._run, name="hlp-tracker", daemon=True)
        self._thread.start()

    def _run(self):
        log.info("HlpTracker starting — tracking %d vaults", len(self._cfg.vaults))
        while not self._stop_event.is_set():
            try:
                self._poll_all_vaults()
            except Exception:
                log.exception("HlpTracker cycle error")
            self._stop_event.wait(self._cfg.poll_interval)

    def _poll_all_vaults(self):
        """Poll all HLP vaults and update positions + snapshots."""
        now = time.time()
        all_positions = []
        snapshot_rows = []

        for vault_addr in self._cfg.vaults:
            if self._stop_event.is_set():
                return
            if not self._rl.acquire(2, timeout=10):
                log.warning("Rate limit — skipping vault %s", vault_addr[:10])
                continue

            try:
                state = self._info.user_state(vault_addr)
                self.total_polls += 1
            except Exception:
                log.debug("Failed to poll vault %s", vault_addr[:10])
                continue

            for pos in state.get("assetPositions", []):
                p = pos.get("position", {})
                coin = p.get("coin", "")
                size = safe_float(p.get("szi", 0))
                if size == 0 or not coin:
                    continue

                entry_px = safe_float(p.get("entryPx", 0))
                if entry_px <= 0:
                    continue

                pos_val = safe_float(p.get("positionValue", 0))
                mark_px = pos_val / abs(size) if size else entry_px
                if mark_px <= 0:
                    mark_px = entry_px
                lev = safe_float(p.get("leverage", {}).get("value", 1))
                if lev > 200 or lev < 0:
                    lev = 1
                upnl = safe_float(p.get("unrealizedPnl", 0))
                size_usd = abs(size) * entry_px

                record = {
                    "vault_address": vault_addr,
                    "coin": coin,
                    "side": "long" if size > 0 else "short",
                    "size": abs(size),
                    "size_usd": size_usd,
                    "entry_px": entry_px,
                    "mark_px": mark_px,
                    "leverage": lev,
                    "unrealized_pnl": upnl,
                }
                all_positions.append(record)
                snapshot_rows.append((*[record[k] for k in (
                    "vault_address", "coin",
                )], now, record["side"], record["size"], size_usd,
                    entry_px, mark_px, lev, upnl))

        # Update in-memory cache
        with self._positions_lock:
            self.current_positions = all_positions

        # Write snapshots to DB
        if snapshot_rows:
            conn = self._db.conn
            try:
                with self._db.write_lock:
                    conn.executemany(
                        """
                        INSERT OR REPLACE INTO hlp_snapshots
                        (vault_address, coin, snapshot_at, side, size, size_usd,
                         entry_px, mark_px, leverage, unrealized_pnl)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        snapshot_rows,
                    )
                    conn.commit()
                self.total_snapshots += len(snapshot_rows)
            except Exception:
                log.exception("Failed to write HLP snapshots")

    def get_positions(self) -> list[dict]:
        """Get latest HLP positions (thread-safe)."""
        with self._positions_lock:
            return list(self.current_positions)

    def get_sentiment(self, hours: float = 24) -> dict:
        """Compute HLP sentiment: net delta, flips, side per coin over N hours."""
        cutoff = time.time() - hours * 3600
        conn = self._db.conn
        rows = conn.execute(
            """
            SELECT coin, side, size_usd, snapshot_at
            FROM hlp_snapshots
            WHERE snapshot_at >= ?
            ORDER BY coin, snapshot_at
            """,
            (cutoff,),
        ).fetchall()

        sentiment: dict[str, dict] = {}
        for row in rows:
            coin = row["coin"]
            if coin not in sentiment:
                sentiment[coin] = {
                    "coin": coin,
                    "current_side": None,
                    "current_size_usd": 0,
                    "flips": 0,
                    "prev_side": None,
                }
            s = sentiment[coin]
            side = row["side"]
            if s["prev_side"] and s["prev_side"] != side:
                s["flips"] += 1
            s["prev_side"] = side
            s["current_side"] = side
            s["current_size_usd"] = row["size_usd"]

        # Clean up internal fields
        for s in sentiment.values():
            s.pop("prev_side", None)

        return sentiment

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)

    def stats(self) -> dict:
        return {
            "vaults_tracked": len(self._cfg.vaults),
            "total_polls": self.total_polls,
            "total_snapshots": self.total_snapshots,
            "current_positions": len(self.current_positions),
        }
