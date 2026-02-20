"""Smart money engine — PnL tracking and most-profitable address ranking."""

import time
import logging
import threading
from collections import deque

from hynous_data.core.db import Database

log = logging.getLogger(__name__)

# Don't re-queue an address within this window (seconds)
_QUEUE_DEDUP_TTL = 300  # 5 minutes


class SmartMoneyEngine:
    """Tracks equity over time and ranks addresses by profitability."""

    def __init__(self, db: Database, profiler=None, min_equity: float = 50_000):
        self._db = db
        self._profiler = profiler
        self._min_equity = min_equity
        # Persistent profiling queue + drainer thread
        self._profile_queue: deque[str] = deque()
        self._queue_lock = threading.Lock()
        self._queue_event = threading.Event()
        self._queued_recently: dict[str, float] = {}  # addr → queued_at
        self._drainer: threading.Thread | None = None
        # Track which addresses have profiles (refreshed periodically)
        self._profiled_addrs: set[str] = set()
        self._profiled_addrs_ts: float = 0

    def start_drainer(self):
        """Start the persistent profile queue drainer thread."""
        if self._drainer and self._drainer.is_alive():
            return
        self._drainer = threading.Thread(
            target=self._drain_loop, daemon=True, name="profile-drainer"
        )
        self._drainer.start()

    def _refresh_profiled_set(self):
        """Cache the set of addresses that already have profiles (every 60s)."""
        now = time.time()
        if now - self._profiled_addrs_ts < 60:
            return
        try:
            rows = self._db.conn.execute(
                "SELECT address FROM wallet_profiles"
            ).fetchall()
            self._profiled_addrs = {r["address"] for r in rows}
            self._profiled_addrs_ts = now
        except Exception:
            pass

    def _enqueue(self, addresses: list[str]):
        """Add addresses to the profiling queue (deduped)."""
        now = time.time()
        added = 0
        with self._queue_lock:
            # Prune old dedup entries
            stale = [a for a, t in self._queued_recently.items() if now - t > _QUEUE_DEDUP_TTL]
            for a in stale:
                del self._queued_recently[a]

            for addr in addresses:
                if addr not in self._queued_recently:
                    self._queued_recently[addr] = now
                    self._profile_queue.append(addr)
                    added += 1
        if added:
            self._queue_event.set()  # wake drainer

    def _drain_loop(self):
        """Persistent thread: drains the profiling queue one address at a time."""
        log.info("Profile drainer started")
        while True:
            # Wait until there's work
            self._queue_event.wait(timeout=30)
            self._queue_event.clear()

            while True:
                with self._queue_lock:
                    if not self._profile_queue:
                        break
                    addr = self._profile_queue.popleft()

                self._profile_one(addr)

    def _profile_one(self, addr: str):
        """Profile a single address. Silently skips on failure."""
        profiler = self._profiler
        if not profiler:
            return
        try:
            fills = profiler.fetch_fills(addr)
            if not fills:
                return
            profile = profiler.compute_profile(fills)
            if not profile:
                return
            conn = self._db.conn
            eq_row = conn.execute(
                "SELECT equity FROM pnl_snapshots WHERE address = ? ORDER BY snapshot_at DESC LIMIT 1",
                (addr,),
            ).fetchone()
            equity = eq_row["equity"] if eq_row else None
            profiler._upsert_profile(addr, profile, equity)
            self._profiled_addrs.add(addr)
            log.info(
                "Profiled %s: %d trades, %.0f%% WR, %s",
                addr[:10], profile.get("trade_count", 0),
                (profile.get("win_rate", 0) or 0) * 100,
                profile.get("style", "?"),
            )
        except Exception:
            log.debug("Profile failed for %s", addr[:10])

    # ------------------------------------------------------------------
    # PnL snapshot recording
    # ------------------------------------------------------------------

    def snapshot_pnl(self, address: str, equity: float, unrealized: float):
        """Record a PnL snapshot for a single address."""
        self.batch_snapshot_pnl([(address, equity, unrealized)])

    def batch_snapshot_pnl(self, snapshots: list[tuple[str, float, float]]):
        """Record PnL snapshots for multiple addresses in one transaction.

        Also queues high-equity addresses without profiles for immediate profiling.
        """
        if not snapshots:
            return
        now = time.time()
        conn = self._db.conn
        rows = [(addr, now, eq, unr) for addr, eq, unr in snapshots]
        try:
            with self._db.write_lock:
                conn.executemany(
                    "INSERT OR REPLACE INTO pnl_snapshots "
                    "(address, snapshot_at, equity, unrealized) VALUES (?, ?, ?, ?)",
                    rows,
                )
                conn.commit()
        except Exception:
            log.exception("Failed to write %d PnL snapshots", len(rows))
            return

        # Queue high-equity addresses that don't have profiles yet
        if self._profiler:
            self._refresh_profiled_set()
            need_profile = [
                addr for addr, eq, _ in snapshots
                if eq >= self._min_equity and addr not in self._profiled_addrs
            ]
            if need_profile:
                self._enqueue(need_profile)

    # ------------------------------------------------------------------
    # Rankings
    # ------------------------------------------------------------------

    def get_rankings(self, top_n: int = 50) -> dict:
        """Rank addresses by equity growth over the last 24h.

        Uses window functions to get first/last equity in a single query,
        then joins positions. Avoids N+1 queries.
        """
        cutoff = time.time() - 86400  # 24h
        conn = self._db.conn

        # Single query: get start/end equity per address using subqueries
        rows = conn.execute(
            """
            WITH addr_range AS (
                SELECT
                    address,
                    MIN(snapshot_at) AS first_snap,
                    MAX(snapshot_at) AS last_snap
                FROM pnl_snapshots
                WHERE snapshot_at >= ?
                GROUP BY address
                HAVING COUNT(*) >= 2
            )
            SELECT
                ar.address,
                ps_first.equity AS equity_start,
                ps_last.equity AS equity_end
            FROM addr_range ar
            JOIN pnl_snapshots ps_first
                ON ps_first.address = ar.address AND ps_first.snapshot_at = ar.first_snap
            JOIN pnl_snapshots ps_last
                ON ps_last.address = ar.address AND ps_last.snapshot_at = ar.last_snap
            """,
            (cutoff,),
        ).fetchall()

        if not rows:
            return {"rankings": [], "count": 0, "window_hours": 24}

        # Compute PnL for each address
        addr_pnl = []
        for row in rows:
            start = row["equity_start"]
            end = row["equity_end"]
            pnl = end - start
            pnl_pct = (pnl / start * 100) if start > 0 else 0
            addr_pnl.append({
                "address": row["address"],
                "equity": round(end, 2),
                "pnl_24h": round(pnl, 2),
                "pnl_pct_24h": round(pnl_pct, 2),
            })

        # Sort by PnL, take top N
        addr_pnl.sort(key=lambda x: x["pnl_24h"], reverse=True)
        addr_pnl = addr_pnl[:top_n]

        # Batch fetch positions for top addresses (1 query instead of N)
        top_addrs = [a["address"] for a in addr_pnl]
        placeholders = ",".join("?" for _ in top_addrs)
        pos_rows = conn.execute(
            f"SELECT address, coin, side, size_usd, unrealized_pnl "
            f"FROM positions WHERE address IN ({placeholders})",
            top_addrs,
        ).fetchall()

        # Group positions by address
        pos_map: dict[str, list[dict]] = {}
        for p in pos_rows:
            addr = p["address"]
            if addr not in pos_map:
                pos_map[addr] = []
            pos_map[addr].append(dict(p))

        # Batch fetch profiles (win_rate, style) if table exists
        profile_map: dict[str, dict] = {}
        try:
            prof_rows = conn.execute(
                f"SELECT address, win_rate, style, is_bot, trade_count, profit_factor "
                f"FROM wallet_profiles WHERE address IN ({placeholders})",
                top_addrs,
            ).fetchall()
            for pr in prof_rows:
                profile_map[pr["address"]] = dict(pr)
        except Exception:
            pass  # Table may not exist yet

        # Attach positions + profile data; queue any missing for profiling
        missing_profile = []
        for entry in addr_pnl:
            entry["positions"] = pos_map.get(entry["address"], [])
            prof = profile_map.get(entry["address"], {})
            entry["win_rate"] = prof.get("win_rate")
            entry["style"] = prof.get("style")
            entry["is_bot"] = prof.get("is_bot", 0)
            entry["trade_count"] = prof.get("trade_count")
            entry["profit_factor"] = prof.get("profit_factor")
            if not prof:
                missing_profile.append(entry["address"])

        if missing_profile:
            self._enqueue(missing_profile)

        return {
            "rankings": addr_pnl,
            "count": len(addr_pnl),
            "window_hours": 24,
        }
