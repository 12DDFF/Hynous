"""Smart money engine — PnL tracking and most-profitable address ranking."""

import time
import logging

from hynous_data.core.db import Database

log = logging.getLogger(__name__)


class SmartMoneyEngine:
    """Tracks equity over time and ranks addresses by profitability."""

    def __init__(self, db: Database):
        self._db = db

    def snapshot_pnl(self, address: str, equity: float, unrealized: float):
        """Record a PnL snapshot for a single address."""
        self.batch_snapshot_pnl([(address, equity, unrealized)])

    def batch_snapshot_pnl(self, snapshots: list[tuple[str, float, float]]):
        """Record PnL snapshots for multiple addresses in one transaction."""
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

        # Attach positions + profile data
        for entry in addr_pnl:
            entry["positions"] = pos_map.get(entry["address"], [])
            prof = profile_map.get(entry["address"], {})
            entry["win_rate"] = prof.get("win_rate")
            entry["style"] = prof.get("style")
            entry["is_bot"] = prof.get("is_bot", 0)
            entry["trade_count"] = prof.get("trade_count")
            entry["profit_factor"] = prof.get("profit_factor")

        return {
            "rankings": addr_pnl,
            "count": len(addr_pnl),
            "window_hours": 24,
        }
