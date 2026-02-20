"""SQLite database with WAL mode for hynous-data.

Thread-safe: all writes go through a single lock. Reads are concurrent
(WAL allows this). The write_lock must be used by all callers that do
INSERT/UPDATE/DELETE + commit.
"""

import sqlite3
import threading
import time
import logging
from pathlib import Path

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS addresses (
    address     TEXT PRIMARY KEY,
    first_seen  REAL NOT NULL,
    last_seen   REAL NOT NULL,
    trade_count INTEGER NOT NULL DEFAULT 0,
    last_polled REAL,
    tier        INTEGER NOT NULL DEFAULT 3,
    total_size_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_addresses_tier_polled ON addresses(tier, last_polled);
CREATE INDEX IF NOT EXISTS idx_addresses_last_seen ON addresses(last_seen);

CREATE TABLE IF NOT EXISTS positions (
    address     TEXT NOT NULL,
    coin        TEXT NOT NULL,
    side        TEXT NOT NULL,
    size        REAL NOT NULL,
    size_usd    REAL NOT NULL,
    entry_px    REAL NOT NULL,
    mark_px     REAL NOT NULL,
    leverage    REAL NOT NULL DEFAULT 1,
    margin_used REAL NOT NULL DEFAULT 0,
    liq_px      REAL,
    unrealized_pnl REAL NOT NULL DEFAULT 0,
    updated_at  REAL NOT NULL,
    PRIMARY KEY (address, coin)
);
CREATE INDEX IF NOT EXISTS idx_positions_coin ON positions(coin);
CREATE INDEX IF NOT EXISTS idx_positions_size_usd ON positions(size_usd);

CREATE TABLE IF NOT EXISTS hlp_snapshots (
    vault_address TEXT NOT NULL,
    coin          TEXT NOT NULL,
    snapshot_at   REAL NOT NULL,
    side          TEXT NOT NULL,
    size          REAL NOT NULL,
    size_usd      REAL NOT NULL,
    entry_px      REAL NOT NULL,
    mark_px       REAL NOT NULL,
    leverage      REAL NOT NULL DEFAULT 1,
    unrealized_pnl REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (vault_address, coin, snapshot_at)
);
CREATE INDEX IF NOT EXISTS idx_hlp_snapshot_at ON hlp_snapshots(snapshot_at);

CREATE TABLE IF NOT EXISTS pnl_snapshots (
    address     TEXT NOT NULL,
    snapshot_at REAL NOT NULL,
    equity      REAL NOT NULL,
    unrealized  REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (address, snapshot_at)
);
CREATE INDEX IF NOT EXISTS idx_pnl_snapshot_at ON pnl_snapshots(snapshot_at);
CREATE INDEX IF NOT EXISTS idx_pnl_addr_snap ON pnl_snapshots(address, snapshot_at, equity);

CREATE TABLE IF NOT EXISTS metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Smart Money: Watched wallets (user-curated list)
CREATE TABLE IF NOT EXISTS watched_wallets (
    address    TEXT PRIMARY KEY,
    label      TEXT DEFAULT '',
    added_at   REAL NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 1
);

-- Smart Money: Cached profile metrics (recomputed periodically)
CREATE TABLE IF NOT EXISTS wallet_profiles (
    address        TEXT PRIMARY KEY,
    computed_at    REAL NOT NULL,
    win_rate       REAL,
    trade_count    INTEGER,
    profit_factor  REAL,
    avg_hold_hours REAL,
    avg_pnl_pct    REAL,
    max_drawdown   REAL,
    style          TEXT,
    is_bot         INTEGER DEFAULT 0,
    equity         REAL
);

-- Smart Money: Cached matched trades (recomputed with profiles)
CREATE TABLE IF NOT EXISTS wallet_trades (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    address    TEXT NOT NULL,
    coin       TEXT NOT NULL,
    side       TEXT NOT NULL,
    entry_px   REAL NOT NULL,
    exit_px    REAL,
    size_usd   REAL NOT NULL,
    pnl_usd    REAL NOT NULL DEFAULT 0,
    pnl_pct    REAL NOT NULL DEFAULT 0,
    hold_hours REAL NOT NULL DEFAULT 0,
    entry_time REAL NOT NULL,
    exit_time  REAL,
    is_win     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_wt_address ON wallet_trades(address);
CREATE INDEX IF NOT EXISTS idx_wt_entry_time ON wallet_trades(entry_time);

-- Smart Money: Detected position changes (entry/exit events)
CREATE TABLE IF NOT EXISTS position_changes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    address    TEXT NOT NULL,
    coin       TEXT NOT NULL,
    action     TEXT NOT NULL,
    side       TEXT,
    size_usd   REAL,
    price      REAL,
    detected_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pc_address ON position_changes(address);
CREATE INDEX IF NOT EXISTS idx_pc_detected ON position_changes(detected_at);
"""


class Database:
    """Thread-safe SQLite database.

    WAL mode allows concurrent readers. All writes must go through the
    write_lock to prevent concurrent writer conflicts.
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
        return self._conn

    def init_schema(self):
        """Create tables and indexes."""
        assert self._conn is not None, "Call connect() first"
        self._conn.executescript(SCHEMA)
        self._run_migrations()
        log.info("Database schema initialized at %s", self._path)

    def _run_migrations(self):
        """Idempotent migrations — safe to run repeatedly."""
        c = self._conn
        assert c is not None

        # v1: Add notes/tags columns to watched_wallets
        for col, default in [("notes", "''"), ("tags", "''")]:
            try:
                c.execute(f"ALTER TABLE watched_wallets ADD COLUMN {col} TEXT DEFAULT {default}")
            except Exception:
                pass  # column already exists

        # v2: wallet_alerts table
        c.executescript("""
            CREATE TABLE IF NOT EXISTS wallet_alerts (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                address    TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                min_size_usd REAL DEFAULT 0,
                coins      TEXT DEFAULT '',
                enabled    INTEGER NOT NULL DEFAULT 1,
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_wallet_alerts_address ON wallet_alerts(address);
            CREATE INDEX IF NOT EXISTS idx_wallet_alerts_enabled ON wallet_alerts(enabled);
        """)

    @property
    def conn(self) -> sqlite3.Connection:
        assert self._conn is not None, "Call connect() first"
        return self._conn

    def prune_old_data(self, days: int = 7):
        """Delete time-series rows older than N days."""
        cutoff = time.time() - days * 86400
        c = self._conn
        assert c is not None
        with self.write_lock:
            cur1 = c.execute("DELETE FROM hlp_snapshots WHERE snapshot_at < ?", (cutoff,))
            cur2 = c.execute("DELETE FROM pnl_snapshots WHERE snapshot_at < ?", (cutoff,))
            deleted = cur1.rowcount + cur2.rowcount
            c.commit()
        if deleted:
            log.info("Pruned %d old time-series rows (cutoff=%d days)", deleted, days)

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None
