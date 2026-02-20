"""Whale tracker — large position filtering and ranking."""

import logging

from hynous_data.core.db import Database

log = logging.getLogger(__name__)


class WhaleTracker:
    """Queries the positions table for large positions, ranked by size."""

    def __init__(self, db: Database):
        self._db = db

    def get_whales(self, coin: str, top_n: int = 50) -> dict:
        """Get largest positions for a coin."""
        conn = self._db.conn
        rows = conn.execute(
            """
            SELECT address, coin, side, size, size_usd, entry_px, mark_px,
                   leverage, liq_px, unrealized_pnl, updated_at
            FROM positions
            WHERE coin = ?
            ORDER BY size_usd DESC
            LIMIT ?
            """,
            (coin, top_n),
        ).fetchall()

        positions = []
        total_long_usd = 0.0
        total_short_usd = 0.0
        for row in rows:
            pos = dict(row)
            positions.append(pos)
            if pos["side"] == "long":
                total_long_usd += pos["size_usd"]
            else:
                total_short_usd += pos["size_usd"]

        return {
            "coin": coin,
            "positions": positions,
            "count": len(positions),
            "total_long_usd": round(total_long_usd, 2),
            "total_short_usd": round(total_short_usd, 2),
            "net_usd": round(total_long_usd - total_short_usd, 2),
        }

    def get_whale_summary(self) -> dict:
        """Aggregate whale stats across all coins."""
        conn = self._db.conn
        rows = conn.execute(
            """
            SELECT coin, side, COUNT(*) as cnt, SUM(size_usd) as total_usd
            FROM positions
            WHERE size_usd >= 100000
            GROUP BY coin, side
            ORDER BY total_usd DESC
            """
        ).fetchall()

        summary: dict[str, dict] = {}
        for row in rows:
            coin = row["coin"]
            if coin not in summary:
                summary[coin] = {"coin": coin, "long_usd": 0, "short_usd": 0,
                                 "long_count": 0, "short_count": 0}
            if row["side"] == "long":
                summary[coin]["long_usd"] = round(row["total_usd"], 2)
                summary[coin]["long_count"] = row["cnt"]
            else:
                summary[coin]["short_usd"] = round(row["total_usd"], 2)
                summary[coin]["short_count"] = row["cnt"]

        return {"coins": list(summary.values()), "total_coins": len(summary)}
