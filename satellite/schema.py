"""Satellite SQLite schema and migrations."""

import sqlite3
import logging

log = logging.getLogger(__name__)

SCHEMA = """
-- Feature snapshots: one row per coin per 300s tick
CREATE TABLE IF NOT EXISTS snapshots (
    snapshot_id     TEXT PRIMARY KEY,
    created_at      REAL NOT NULL,
    coin            TEXT NOT NULL,

    -- 12 STRUCTURAL CORE FEATURES (raw values, normalized at training time)
    -- Liquidation mechanism (4)
    liq_magnet_direction    REAL,
    oi_vs_7d_avg_ratio      REAL,
    liq_cascade_active      INTEGER,
    liq_1h_vs_4h_avg        REAL,

    -- Funding mechanism (3)
    funding_vs_30d_zscore   REAL,
    hours_to_funding        REAL,
    oi_funding_pressure     REAL,

    -- Momentum/confirmation (3)
    cvd_normalized_5m       REAL,
    price_change_5m_pct     REAL,
    volume_vs_1h_avg_ratio  REAL,

    -- Context (2)
    realized_vol_1h         REAL,
    sessions_overlapping    INTEGER,

    -- Availability flags (1 per nullable feature, used as model inputs)
    liq_magnet_avail            INTEGER NOT NULL DEFAULT 1,
    oi_7d_avail                 INTEGER NOT NULL DEFAULT 1,
    liq_cascade_avail           INTEGER NOT NULL DEFAULT 1,
    funding_zscore_avail        INTEGER NOT NULL DEFAULT 1,
    oi_funding_pressure_avail   INTEGER NOT NULL DEFAULT 1,
    cvd_avail                   INTEGER NOT NULL DEFAULT 1,
    price_change_5m_avail       INTEGER NOT NULL DEFAULT 1,
    volume_avail                INTEGER NOT NULL DEFAULT 1,
    realized_vol_avail          INTEGER NOT NULL DEFAULT 1,

    -- Metadata
    schema_version          INTEGER NOT NULL DEFAULT 1,
    created_by              TEXT NOT NULL DEFAULT 'satellite',

    UNIQUE(coin, created_at)
);
CREATE INDEX IF NOT EXISTS idx_snap_coin ON snapshots(coin);
CREATE INDEX IF NOT EXISTS idx_snap_created ON snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_snap_coin_created ON snapshots(coin, created_at);

-- Raw API responses for retroactive debugging and feature recomputation
CREATE TABLE IF NOT EXISTS raw_snapshots (
    snapshot_id     TEXT PRIMARY KEY,
    raw_json        TEXT NOT NULL,
    FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);

-- Supplementary CVD windows (satellite stores all, training picks which to use)
CREATE TABLE IF NOT EXISTS cvd_windows (
    snapshot_id     TEXT NOT NULL,
    window_seconds  INTEGER NOT NULL,
    buy_volume_usd  REAL,
    sell_volume_usd REAL,
    cvd             REAL,
    cvd_normalized  REAL,
    PRIMARY KEY (snapshot_id, window_seconds),
    FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);

-- Metadata key-value store (schema version, last tick time, etc.)
CREATE TABLE IF NOT EXISTS satellite_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Labels: outcome measurements for each snapshot (written async by labeler)
CREATE TABLE IF NOT EXISTS snapshot_labels (
    label_id                  TEXT PRIMARY KEY,
    snapshot_id               TEXT NOT NULL UNIQUE,

    -- Gross ROE (before fees) — all windows
    best_long_roe_15m_gross   REAL,
    best_long_roe_30m_gross   REAL,
    best_long_roe_1h_gross    REAL,
    best_long_roe_4h_gross    REAL,

    best_short_roe_15m_gross  REAL,
    best_short_roe_30m_gross  REAL,
    best_short_roe_1h_gross   REAL,
    best_short_roe_4h_gross   REAL,

    -- Net ROE (after fees) — primary training targets
    best_long_roe_30m_net     REAL,
    best_short_roe_30m_net    REAL,

    -- Maximum adverse excursion
    worst_long_mae_30m        REAL,
    worst_short_mae_30m       REAL,

    -- Metadata
    labeled_at                REAL,
    label_version             INTEGER NOT NULL DEFAULT 1,

    FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
CREATE INDEX IF NOT EXISTS idx_labels_snapshot ON snapshot_labels(snapshot_id);

-- Simulated exit training data (Model B bootstrap, ml-010b Upgrade 2)
CREATE TABLE IF NOT EXISTS simulated_exits (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id       TEXT NOT NULL,
    coin              TEXT NOT NULL,
    side              TEXT NOT NULL,
    entry_price       REAL NOT NULL,
    checkpoint_time   REAL NOT NULL,
    checkpoint_price  REAL NOT NULL,
    current_roe       REAL NOT NULL,
    remaining_roe     REAL NOT NULL,
    should_hold       INTEGER NOT NULL,

    FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
CREATE INDEX IF NOT EXISTS idx_sim_exits_coin ON simulated_exits(coin);
CREATE INDEX IF NOT EXISTS idx_sim_exits_side ON simulated_exits(side);

-- Prediction log: every inference result stored for analysis
CREATE TABLE IF NOT EXISTS predictions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    predicted_at        REAL NOT NULL,
    coin                TEXT NOT NULL,
    model_version       INTEGER NOT NULL,
    predicted_long_roe  REAL NOT NULL,
    predicted_short_roe REAL NOT NULL,
    signal              TEXT NOT NULL,
    entry_threshold     REAL NOT NULL,
    inference_time_ms   REAL,
    snapshot_id         TEXT,
    shap_top5_json      TEXT,

    FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
CREATE INDEX IF NOT EXISTS idx_pred_coin_time ON predictions(coin, predicted_at);
CREATE INDEX IF NOT EXISTS idx_pred_signal ON predictions(signal);

-- Layer 2: Entry co-occurrence data (future smart money ML)
CREATE TABLE IF NOT EXISTS co_occurrences (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    address_a   TEXT NOT NULL,
    address_b   TEXT NOT NULL,
    coin        TEXT NOT NULL,
    occurred_at REAL NOT NULL,
    UNIQUE(address_a, address_b, coin, occurred_at)
);
CREATE INDEX IF NOT EXISTS idx_cooc_time ON co_occurrences(occurred_at);
CREATE INDEX IF NOT EXISTS idx_cooc_addr_a ON co_occurrences(address_a);
CREATE INDEX IF NOT EXISTS idx_cooc_addr_b ON co_occurrences(address_b);
"""


def init_schema(conn: sqlite3.Connection) -> None:
    """Create tables and indexes. Idempotent."""
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO satellite_metadata (key, value) VALUES (?, ?)",
        ("schema_version", "1"),
    )
    conn.commit()
    log.info("Satellite schema initialized")


def run_migrations(conn: sqlite3.Connection) -> None:
    """Idempotent migrations for schema evolution."""
    # v1 -> v2: Add availability columns for oi_funding_pressure and price_change
    for col in ["oi_funding_pressure_avail", "price_change_5m_avail"]:
        try:
            conn.execute(
                f"ALTER TABLE snapshots ADD COLUMN {col} "
                "INTEGER NOT NULL DEFAULT 1",
            )
        except Exception:
            pass  # column already exists

    # v2 -> v3: Add UNIQUE constraint to co_occurrences (INSERT OR IGNORE
    # had no effect without it — duplicates accumulated silently).
    try:
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_cooc_unique "
            "ON co_occurrences(address_a, address_b, coin, occurred_at)",
        )
    except Exception:
        pass  # index already exists

    conn.commit()
