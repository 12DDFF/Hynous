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

    -- 14 FEATURES v2 (raw values, normalized at training time)
    -- Liquidation mechanism (3)
    oi_vs_7d_avg_ratio      REAL,
    liq_cascade_active      INTEGER,
    liq_1h_vs_4h_avg        REAL,

    -- Funding mechanism (3)
    funding_vs_30d_zscore   REAL,
    hours_to_funding        REAL,
    oi_funding_pressure     REAL,

    -- Magnitude (2)
    volume_vs_1h_avg_ratio  REAL,
    realized_vol_1h         REAL,

    -- Directional (6)
    cvd_ratio_30m           REAL,
    cvd_acceleration        REAL,
    price_trend_1h          REAL,
    close_position_5m       REAL,
    oi_price_direction      REAL,
    liq_imbalance_1h        REAL,

    -- Availability flags (1 per nullable feature, used as model inputs)
    oi_7d_avail                 INTEGER NOT NULL DEFAULT 1,
    liq_cascade_avail           INTEGER NOT NULL DEFAULT 1,
    funding_zscore_avail        INTEGER NOT NULL DEFAULT 1,
    oi_funding_pressure_avail   INTEGER NOT NULL DEFAULT 1,
    volume_avail                INTEGER NOT NULL DEFAULT 1,
    realized_vol_avail          INTEGER NOT NULL DEFAULT 1,
    cvd_30m_avail               INTEGER NOT NULL DEFAULT 1,
    price_trend_1h_avail        INTEGER NOT NULL DEFAULT 1,
    close_position_avail        INTEGER NOT NULL DEFAULT 1,
    oi_price_dir_avail          INTEGER NOT NULL DEFAULT 1,
    liq_imbalance_avail         INTEGER NOT NULL DEFAULT 1,

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

-- Condition prediction log: every condition inference stored for live validation
CREATE TABLE IF NOT EXISTS condition_predictions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    predicted_at    REAL NOT NULL,
    snapshot_id     TEXT NOT NULL,
    coin            TEXT NOT NULL,
    model_name      TEXT NOT NULL,
    predicted_value REAL NOT NULL,
    percentile      INTEGER NOT NULL,
    regime          TEXT NOT NULL,
    inference_ms    REAL,

    FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
);
CREATE INDEX IF NOT EXISTS idx_cpred_coin_time ON condition_predictions(coin, predicted_at);
CREATE INDEX IF NOT EXISTS idx_cpred_snapshot ON condition_predictions(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_cpred_model ON condition_predictions(model_name);

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

    # v3 -> v4: Add new directional feature columns (feature set v2)
    new_feature_cols = [
        ("cvd_ratio_30m", "REAL"),
        ("cvd_acceleration", "REAL"),
        ("price_trend_1h", "REAL"),
        ("close_position_5m", "REAL"),
        ("oi_price_direction", "REAL"),
        ("liq_imbalance_1h", "REAL"),
        ("cvd_30m_avail", "INTEGER NOT NULL DEFAULT 1"),
        ("price_trend_1h_avail", "INTEGER NOT NULL DEFAULT 1"),
        ("close_position_avail", "INTEGER NOT NULL DEFAULT 1"),
        ("oi_price_dir_avail", "INTEGER NOT NULL DEFAULT 1"),
        ("liq_imbalance_avail", "INTEGER NOT NULL DEFAULT 1"),
    ]
    for col_name, col_type in new_feature_cols:
        try:
            conn.execute(
                f"ALTER TABLE snapshots ADD COLUMN {col_name} {col_type}",
            )
        except Exception:
            pass  # column already exists

    # v4 -> v5: Add condition_predictions table for live validation
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS condition_predictions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                predicted_at    REAL NOT NULL,
                snapshot_id     TEXT NOT NULL,
                coin            TEXT NOT NULL,
                model_name      TEXT NOT NULL,
                predicted_value REAL NOT NULL,
                percentile      INTEGER NOT NULL,
                regime          TEXT NOT NULL,
                inference_ms    REAL,
                FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cpred_coin_time ON condition_predictions(coin, predicted_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cpred_snapshot ON condition_predictions(snapshot_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cpred_model ON condition_predictions(model_name)")
    except Exception:
        pass

    # v5 -> v6: Add v3 feature columns (per-model feature sets)
    v3_feature_cols = [
        ("liq_total_1h_usd", "REAL"),
        ("funding_rate_raw", "REAL"),
        ("oi_change_rate_1h", "REAL"),
        ("realized_vol_4h", "REAL"),
        ("vol_of_vol", "REAL"),
        ("volume_acceleration", "REAL"),
        ("cvd_ratio_1h", "REAL"),
        ("price_trend_4h", "REAL"),
    ]
    for col_name, col_type in v3_feature_cols:
        try:
            conn.execute(
                f"ALTER TABLE snapshots ADD COLUMN {col_name} {col_type}",
            )
        except Exception:
            pass  # column already exists

    # v6 -> v7: Add v4 feature columns (microstructure, funding velocity, time encoding)
    v4_feature_cols = [
        ("return_autocorrelation", "REAL"),
        ("body_ratio_1h", "REAL"),
        ("upper_wick_ratio_1h", "REAL"),
        ("funding_velocity", "REAL"),
        ("hour_sin", "REAL"),
        ("hour_cos", "REAL"),
        ("return_autocorr_avail", "INTEGER NOT NULL DEFAULT 1"),
        ("body_ratio_avail", "INTEGER NOT NULL DEFAULT 1"),
        ("upper_wick_avail", "INTEGER NOT NULL DEFAULT 1"),
        ("funding_velocity_avail", "INTEGER NOT NULL DEFAULT 1"),
    ]
    for col_name, col_type in v4_feature_cols:
        try:
            conn.execute(
                f"ALTER TABLE snapshots ADD COLUMN {col_name} {col_type}",
            )
        except Exception:
            pass  # column already exists

    # Phase 0: Add v3/v4 availability flag columns
    for col in [
        "realized_vol_4h_avail",
        "vol_of_vol_avail",
        "volume_acceleration_avail",
        "cvd_1h_avail",
        "price_trend_4h_avail",
    ]:
        try:
            conn.execute(
                f"ALTER TABLE snapshots ADD COLUMN {col} "
                "INTEGER NOT NULL DEFAULT 1",
            )
        except Exception:
            pass  # column already exists

    # Phase 3: Entry-outcome feedback loop
    conn.execute("""
        CREATE TABLE IF NOT EXISTS entry_snapshots (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_id            TEXT NOT NULL,
            coin                TEXT NOT NULL,
            side                TEXT NOT NULL,
            entry_time          REAL NOT NULL,
            composite_score     REAL NOT NULL,
            vol_1h_regime       TEXT,
            vol_1h_pctl         INTEGER,
            entry_quality_pctl  INTEGER,
            funding_4h_pctl     INTEGER,
            volume_1h_regime    TEXT,
            mae_long_pctl       INTEGER,
            mae_short_pctl      INTEGER,
            direction_signal    TEXT,
            direction_long_roe  REAL,
            direction_short_roe REAL,
            score_components    TEXT,
            outcome_roe         REAL,
            outcome_pnl_usd     REAL,
            outcome_won         INTEGER,
            close_time          REAL,
            close_reason        TEXT
        )
    """)
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_es_coin ON entry_snapshots(coin)",
        "CREATE INDEX IF NOT EXISTS idx_es_time ON entry_snapshots(entry_time)",
        "CREATE INDEX IF NOT EXISTS idx_es_outcome ON entry_snapshots(outcome_won)",
    ]:
        conn.execute(idx)

    # Tick-level microstructure snapshots (1s compute, 5s batch write)
    # For directional prediction using orderbook + trade flow features.
    # Separate from the 300s condition snapshots — much higher frequency.
    from satellite.tick_features import TICK_FEATURE_NAMES, TICK_SCHEMA_VERSION
    tick_cols = ["timestamp REAL NOT NULL", "coin TEXT NOT NULL"]
    tick_cols += [f"{f} REAL" for f in TICK_FEATURE_NAMES]
    tick_cols += ["schema_version INTEGER NOT NULL DEFAULT 1"]
    tick_ddl = (
        "CREATE TABLE IF NOT EXISTS tick_snapshots (\n"
        "    " + ",\n    ".join(tick_cols) + ",\n"
        "    PRIMARY KEY (coin, timestamp)\n"
        ")"
    )
    conn.execute(tick_ddl)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tick_coin_time "
        "ON tick_snapshots(coin, timestamp)"
    )

    # tick_snapshots v1 → v2: add book delta + trade distribution columns
    for col in [
        "book_imbalance_delta_5s", "book_imbalance_delta_10s",
        "depth_ratio_change_5s", "max_trade_usd_60s",
        "trade_count_60s", "trade_count_10s",
    ]:
        try:
            conn.execute(f"ALTER TABLE tick_snapshots ADD COLUMN {col} REAL")
        except Exception:
            pass  # column already exists

    conn.commit()
