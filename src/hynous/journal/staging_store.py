"""Thin SQLite wrapper for phase 1 data capture.

Phase 2 replaces this with the full JournalStore. This file exists only for
phase 1 so the capture pipeline has somewhere to persist snapshots and events
without waiting for the full journal module.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .schema import (
    LifecycleEvent,
    TradeEntrySnapshot,
    TradeExitSnapshot,
)

logger = logging.getLogger(__name__)


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS trade_entry_snapshots_staging (
    trade_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    entry_ts TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staging_entry_symbol
    ON trade_entry_snapshots_staging(symbol);
CREATE INDEX IF NOT EXISTS idx_staging_entry_ts
    ON trade_entry_snapshots_staging(entry_ts);

CREATE TABLE IF NOT EXISTS trade_exit_snapshots_staging (
    trade_id TEXT PRIMARY KEY,
    exit_ts TEXT NOT NULL,
    exit_classification TEXT NOT NULL,
    realized_pnl_usd REAL,
    snapshot_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (trade_id)
        REFERENCES trade_entry_snapshots_staging(trade_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staging_exit_ts
    ON trade_exit_snapshots_staging(exit_ts);

CREATE TABLE IF NOT EXISTS trade_events_staging (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staging_events_trade_id
    ON trade_events_staging(trade_id);
CREATE INDEX IF NOT EXISTS idx_staging_events_type
    ON trade_events_staging(event_type);
CREATE INDEX IF NOT EXISTS idx_staging_events_ts
    ON trade_events_staging(ts);
"""


class StagingStore:
    """Minimal staging store for phase 1 data capture.

    Thread-safe via a write lock. Reads are concurrent (WAL mode).
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        """Open a new connection with WAL mode and safe settings."""
        conn = sqlite3.connect(
            self._db_path, timeout=5.0, isolation_level=None,
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _init_schema(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(SCHEMA_SQL)
            finally:
                conn.close()

    def close(self) -> None:
        """No-op — connections are per-operation."""

    # ========================================================================
    # Entry snapshots
    # ========================================================================

    def insert_entry_snapshot(self, snapshot: TradeEntrySnapshot) -> None:
        """Persist an entry snapshot."""
        json_str = json.dumps(
            asdict(snapshot), sort_keys=True, separators=(",", ":"), default=str,
        )
        now_iso = datetime.now(timezone.utc).isoformat()

        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO trade_entry_snapshots_staging
                    (trade_id, symbol, side, entry_ts, snapshot_json,
                     schema_version, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        snapshot.trade_basics.trade_id,
                        snapshot.trade_basics.symbol,
                        snapshot.trade_basics.side,
                        snapshot.trade_basics.entry_ts,
                        json_str,
                        snapshot.schema_version,
                        now_iso,
                    ),
                )
            finally:
                conn.close()

    def get_entry_snapshot_json(self, trade_id: str) -> dict[str, Any] | None:
        """Load an entry snapshot as a parsed dict, or None."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT snapshot_json FROM trade_entry_snapshots_staging "
                "WHERE trade_id = ?",
                (trade_id,),
            ).fetchone()
            if not row:
                return None
            result: dict[str, Any] = json.loads(row["snapshot_json"])
            return result
        finally:
            conn.close()

    # ========================================================================
    # Exit snapshots
    # ========================================================================

    def insert_exit_snapshot(self, snapshot: TradeExitSnapshot) -> None:
        """Persist an exit snapshot."""
        json_str = json.dumps(
            asdict(snapshot), sort_keys=True, separators=(",", ":"), default=str,
        )
        now_iso = datetime.now(timezone.utc).isoformat()

        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO trade_exit_snapshots_staging
                    (trade_id, exit_ts, exit_classification, realized_pnl_usd,
                     snapshot_json, schema_version, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        snapshot.trade_id,
                        snapshot.trade_outcome.exit_ts,
                        snapshot.trade_outcome.exit_classification,
                        snapshot.trade_outcome.realized_pnl_usd,
                        json_str,
                        snapshot.schema_version,
                        now_iso,
                    ),
                )
            finally:
                conn.close()

    # ========================================================================
    # Lifecycle events
    # ========================================================================

    def insert_lifecycle_event(
        self,
        *,
        trade_id: str,
        ts: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        """Persist a lifecycle event."""
        now_iso = datetime.now(timezone.utc).isoformat()
        payload_json = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), default=str,
        )

        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO trade_events_staging
                    (trade_id, ts, event_type, payload_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (trade_id, ts, event_type, payload_json, now_iso),
                )
            finally:
                conn.close()

    def list_exit_snapshots_needing_counterfactuals(
        self,
    ) -> list[dict[str, Any]]:
        """Return exit snapshots where counterfactuals may be incomplete.

        An exit snapshot needs recomputation when its counterfactual window
        has elapsed (exit_ts + window_s < now) and did_tp_hit_later is False
        (indicating counterfactuals were computed at exit time with no
        post-exit candles available).
        """
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT trade_id, exit_ts, snapshot_json
                FROM trade_exit_snapshots_staging
                ORDER BY exit_ts ASC
                """,
            ).fetchall()
            results = []
            for r in rows:
                snap = json.loads(r["snapshot_json"])
                cf = snap.get("counterfactuals", {})
                # Only recompute if did_tp_hit_later is False and
                # did_sl_get_hunted is False (i.e., default values from
                # sync computation with no post-exit data)
                if not cf.get("did_tp_hit_later") and not cf.get("did_sl_get_hunted"):
                    results.append({
                        "trade_id": r["trade_id"],
                        "exit_ts": r["exit_ts"],
                        "snapshot": snap,
                    })
            return results
        finally:
            conn.close()

    def update_exit_snapshot(
        self,
        trade_id: str,
        snapshot: TradeExitSnapshot,
    ) -> None:
        """Update an existing exit snapshot (e.g., after counterfactual recomputation)."""
        from dataclasses import asdict

        json_str = json.dumps(
            asdict(snapshot), sort_keys=True, separators=(",", ":"), default=str,
        )
        now_iso = datetime.now(timezone.utc).isoformat()

        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    UPDATE trade_exit_snapshots_staging
                    SET snapshot_json = ?, created_at = ?
                    WHERE trade_id = ?
                    """,
                    (json_str, now_iso, trade_id),
                )
            finally:
                conn.close()

    def get_events_for_trade(self, trade_id: str) -> list[LifecycleEvent]:
        """Load all lifecycle events for a trade in chronological order."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT id, trade_id, ts, event_type, payload_json
                FROM trade_events_staging
                WHERE trade_id = ?
                ORDER BY ts ASC
                """,
                (trade_id,),
            ).fetchall()
            return [
                LifecycleEvent(
                    event_id=r["id"],
                    trade_id=r["trade_id"],
                    ts=r["ts"],
                    event_type=r["event_type"],
                    payload=json.loads(r["payload_json"]),
                )
                for r in rows
            ]
        finally:
            conn.close()
