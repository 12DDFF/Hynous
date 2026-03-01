"""Satellite SQLite storage operations."""

import json
import sqlite3
import time
import threading
import logging
from pathlib import Path

from satellite.schema import init_schema, run_migrations
from satellite.features import AVAIL_COLUMNS, FeatureResult, FEATURE_NAMES

log = logging.getLogger(__name__)

# Build INSERT SQL from canonical feature and avail column lists.
# This ensures store.py can never drift from features.py definitions.
_SNAPSHOT_COLS = (
    ["snapshot_id", "created_at", "coin"]
    + list(FEATURE_NAMES)
    + list(AVAIL_COLUMNS)
    + ["schema_version", "created_by"]
)
_INSERT_SQL = (
    "INSERT OR IGNORE INTO snapshots ({cols}) VALUES ({placeholders})".format(
        cols=", ".join(_SNAPSHOT_COLS),
        placeholders=", ".join(["?"] * len(_SNAPSHOT_COLS)),
    )
)


class SatelliteStore:
    """Thread-safe SQLite storage for satellite feature snapshots.

    Mirrors data-layer Database pattern: WAL mode, write_lock for all mutations.
    """

    def __init__(self, db_path: str | Path):
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: sqlite3.Connection | None = None
        self.write_lock = threading.Lock()

    def connect(self) -> sqlite3.Connection:
        """Open connection with WAL mode."""
        self._conn = sqlite3.connect(
            str(self._path),
            check_same_thread=False,
            timeout=10,
        )
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.row_factory = sqlite3.Row
        init_schema(self._conn)
        run_migrations(self._conn)
        return self._conn

    @property
    def conn(self) -> sqlite3.Connection:
        assert self._conn is not None, "Call connect() first"
        return self._conn

    def save_snapshot(self, result: FeatureResult) -> None:
        """Write a feature snapshot to the database.

        Args:
            result: FeatureResult from compute_features().
        """
        f = result.features
        a = result.availability

        values = (
            result.snapshot_id, result.created_at, result.coin,
            *(f.get(name) for name in FEATURE_NAMES),
            *(a.get(col, 1) for col in AVAIL_COLUMNS),
            result.schema_version,
            "satellite",
        )

        with self.write_lock:
            self._conn.execute(_INSERT_SQL, values)

            # Store raw data if available
            if result.raw_data is not None:
                self._conn.execute(
                    "INSERT OR IGNORE INTO raw_snapshots (snapshot_id, raw_json) "
                    "VALUES (?, ?)",
                    (result.snapshot_id, json.dumps(result.raw_data, default=str)),
                )

            self._conn.commit()

    def get_snapshots(
        self,
        coin: str,
        start: float | None = None,
        end: float | None = None,
        limit: int | None = None,
    ) -> list[sqlite3.Row]:
        """Query snapshots for training or analysis.

        Args:
            coin: Coin to query.
            start: Minimum created_at (inclusive).
            end: Maximum created_at (inclusive).
            limit: Max rows to return.

        Returns:
            List of sqlite3.Row objects.
        """
        query = "SELECT * FROM snapshots WHERE coin = ?"
        params: list = [coin]

        if start is not None:
            query += " AND created_at >= ?"
            params.append(start)
        if end is not None:
            query += " AND created_at <= ?"
            params.append(end)

        query += " ORDER BY created_at ASC"

        if limit is not None:
            query += " LIMIT ?"
            params.append(limit)

        return self.conn.execute(query, params).fetchall()

    def get_snapshot_count(self, coin: str | None = None) -> int:
        """Count total snapshots, optionally filtered by coin."""
        if coin:
            row = self.conn.execute(
                "SELECT COUNT(*) as n FROM snapshots WHERE coin = ?", (coin,),
            ).fetchone()
        else:
            row = self.conn.execute(
                "SELECT COUNT(*) as n FROM snapshots",
            ).fetchone()
        return row["n"]

    def get_unlabeled_snapshots(
        self, coin: str, min_age_seconds: float = 14400,
    ) -> list:
        """Get snapshots old enough to label but not yet labeled.

        Used by the labeler (SPEC-03) to find snapshots needing outcome labels.

        Args:
            coin: Coin to query.
            min_age_seconds: Minimum age before labeling (default 4h = 14400s).
        """
        cutoff = time.time() - min_age_seconds
        return self.conn.execute(
            """
            SELECT s.snapshot_id, s.created_at, s.coin
            FROM snapshots s
            LEFT JOIN snapshot_labels sl ON s.snapshot_id = sl.snapshot_id
            WHERE s.coin = ? AND s.created_at < ? AND sl.snapshot_id IS NULL
            ORDER BY s.created_at ASC
            """,
            (coin, cutoff),
        ).fetchall()

    def prune_old_data(self, keep_days: int = 180) -> int:
        """Delete snapshots and related data older than keep_days.

        Satellite data is valuable for retraining, so keep 6 months by default.
        Artemis backfill data is retained permanently in historical.db.

        Args:
            keep_days: Number of days to keep (default 180 = 6 months).

        Returns:
            Number of rows deleted.
        """
        cutoff = time.time() - keep_days * 86400
        deleted = 0

        with self.write_lock:
            # Delete in dependency order: children first
            cur = self._conn.execute(
                "DELETE FROM raw_snapshots WHERE snapshot_id IN "
                "(SELECT snapshot_id FROM snapshots WHERE created_at < ?)",
                (cutoff,),
            )
            deleted += cur.rowcount

            cur = self._conn.execute(
                "DELETE FROM cvd_windows WHERE snapshot_id IN "
                "(SELECT snapshot_id FROM snapshots WHERE created_at < ?)",
                (cutoff,),
            )
            deleted += cur.rowcount

            cur = self._conn.execute(
                "DELETE FROM simulated_exits WHERE snapshot_id IN "
                "(SELECT snapshot_id FROM snapshots WHERE created_at < ?)",
                (cutoff,),
            )
            deleted += cur.rowcount

            cur = self._conn.execute(
                "DELETE FROM snapshot_labels WHERE snapshot_id IN "
                "(SELECT snapshot_id FROM snapshots WHERE created_at < ?)",
                (cutoff,),
            )
            deleted += cur.rowcount

            cur = self._conn.execute(
                "DELETE FROM snapshots WHERE created_at < ?", (cutoff,),
            )
            deleted += cur.rowcount

            self._conn.commit()

        if deleted:
            log.info(
                "Pruned %d old satellite rows (cutoff: %d days)",
                deleted, keep_days,
            )

        return deleted

    def close(self) -> None:
        """Close the database connection."""
        if self._conn:
            self._conn.close()
            self._conn = None
