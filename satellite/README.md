# Satellite

> ML feature computation engine -- computes 12 structural features from market data, stores them in a dedicated SQLite database, and provides the single source of truth for feature computation across training, inference, and backfill.

---

## Architecture

```
satellite/
├── __init__.py        # tick() entry point — called by daemon every 300s
├── config.py          # SatelliteConfig dataclass + SafetyConfig
├── schema.py          # SQLite schema (8 tables) + migrations
├── features.py        # 12-feature compute engine (SINGLE SOURCE OF TRUTH)
├── normalize.py       # 5 transform types + FeatureScaler (fitted on train only)
├── labeler.py         # Async outcome labeling (forward-looking ROE + simulated exits)
├── inference.py       # InferenceEngine — XGBoost prediction + SHAP + signal decision
├── safety.py          # KillSwitch — 5 auto-disable conditions
├── store.py           # SatelliteStore — thread-safe SQLite (WAL mode)
├── monitor.py         # Daily HealthReport generation
├── artemis/           # Historical backfill pipeline (S3 data + HL API)
└── training/          # XGBoost training, walk-forward validation, SHAP explainability
```

---

## The 12 Features

All features are computed in `features.py:compute_features()`. This is the **only** place where feature computation happens -- training reads from `satellite.db`, inference calls `compute_features()` directly, and Artemis backfill calls it with historical data.

### Liquidation Mechanism (4 features)

| # | Feature | Formula | Range | Source |
|---|---------|---------|-------|--------|
| 1 | `liq_magnet_direction` | `(short_liq - long_liq) / total_liq` | [-1, +1] | LiqHeatmapEngine |
| 2 | `oi_vs_7d_avg_ratio` | `current_oi / rolling_7d_mean_oi` | [0, inf) | oi_history table |
| 3 | `liq_cascade_active` | `1 if ratio > 2.5 AND liq_1h > $500K` | {0, 1} | liquidation_events table |
| 4 | `liq_1h_vs_4h_avg` | `liq_usd_1h * 4 / liq_usd_4h` | [0, inf) | liquidation_events table |

### Funding Mechanism (3 features)

| # | Feature | Formula | Range | Source |
|---|---------|---------|-------|--------|
| 5 | `funding_vs_30d_zscore` | `(current_rate - 30d_mean) / 30d_std` | (-inf, inf) | funding_history table |
| 6 | `hours_to_funding` | Time until next 00:00/08:00/16:00 UTC | [0, 8] | Clock math |
| 7 | `oi_funding_pressure` | `oi_change_1h_pct * funding_rate` | (-inf, inf) | Snapshot + oi_history |

### Momentum / Confirmation (3 features)

| # | Feature | Formula | Range | Source |
|---|---------|---------|-------|--------|
| 8 | `cvd_normalized_5m` | `CVD_5m / total_volume_5m` | [-1, +1] | OrderFlowEngine |
| 9 | `price_change_5m_pct` | `(close_now - close_5m_ago) / close_5m_ago * 100` | (-inf, inf) | Candle data (stub in live, backfilled via Artemis) |
| 10 | `volume_vs_1h_avg_ratio` | `current_volume / avg_volume_1h` | [0, inf) | volume_history table |

### Context (2 features)

| # | Feature | Formula | Range | Source |
|---|---------|---------|-------|--------|
| 11 | `realized_vol_1h` | `stdev(1m returns) * sqrt(60)` | [0, inf) | 1m candle data (stub in live, backfilled via Artemis) |
| 12 | `sessions_overlapping` | Count of active sessions (Asia/London/US) | {0, 1, 2} | Clock math |

### Availability Flags (9 columns)

Features that depend on external data sources carry an availability flag (0 = unavailable, imputed to neutral). These flags are stored in `satellite.db` and fed to the model as additional input features (21 total = 12 structural + 9 avail).

Features **without** avail flags: `hours_to_funding`, `sessions_overlapping`, `liq_1h_vs_4h_avg` (clock math that never fails).

### Feature Hash

A deterministic SHA-256 hash of the feature name list (`FEATURE_HASH`) is stored in every model artifact. At load time, the hash is verified to prevent using a model trained on a different feature set.

---

## Normalization (5 Transform Types)

Defined in `normalize.py`. Scalers are fitted on training data **only** and frozen forever after. Raw values are always stored; normalization happens at training/inference time.

| Type | Transform | Features |
|------|-----------|----------|
| **P** (Passthrough) | Identity -- already bounded | `liq_magnet_direction`, `liq_cascade_active`, `cvd_normalized_5m`, `sessions_overlapping` |
| **C** (Clip-only) | Clip to [-5, +5] -- already a z-score | `funding_vs_30d_zscore` |
| **Z** (Z-score) | `(x - mean) / std` | `hours_to_funding`, `price_change_5m_pct`, `realized_vol_1h` |
| **L** (Log + Z) | `(log1p(x) - mean) / std` -- for skewed ratios | `oi_vs_7d_avg_ratio`, `liq_1h_vs_4h_avg`, `volume_vs_1h_avg_ratio` |
| **S** (Signed Log + Z) | `(sign(x) * log1p(|x|) - mean) / std` | `oi_funding_pressure` |

---

## Database Schema

Defined in `schema.py`. Eight tables in `satellite.db`:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `snapshots` | Feature snapshots (one per coin per 300s tick) | 12 feature columns + 9 avail flags + metadata |
| `raw_snapshots` | Raw API responses (for retroactive debugging) | `snapshot_id`, `raw_json` |
| `cvd_windows` | Supplementary CVD at multiple time windows | `snapshot_id`, `window_seconds`, `cvd_normalized` |
| `satellite_metadata` | Key-value store (schema version, safety state) | `key`, `value` |
| `snapshot_labels` | Outcome labels (ROE at 15m/30m/1h/4h, gross + net) | Gross ROE all windows, net ROE 30m, MAE 30m |
| `simulated_exits` | Exit model training data (Model B bootstrap) | `current_roe`, `remaining_roe`, `should_hold` |
| `predictions` | Every inference result logged | `predicted_long_roe`, `predicted_short_roe`, `signal`, `shap_top5_json` |
| `co_occurrences` | Layer 2: wallet entry co-occurrence (future smart money ML) | `address_a`, `address_b`, `coin`, `occurred_at` + UNIQUE constraint |

Indexes on `(coin)`, `(created_at)`, `(coin, created_at)` for snapshots; `(coin, predicted_at)` and `(signal)` for predictions; `(occurred_at)`, `(address_a)`, `(address_b)` for co_occurrences.

---

## Configuration

From `config/default.yaml`, section `satellite:`:

```yaml
satellite:
  enabled: false                        # Master switch (disabled during UI dev)
  db_path: "storage/satellite.db"
  data_layer_db_path: "data-layer/storage/hynous-data.db"
  snapshot_interval: 300                 # 5-minute tick frequency
  coins:
    - "BTC"
    - "ETH"
    - "SOL"
  min_position_size_usd: 1000           # Noise filter for heatmap positions
  liq_cascade_threshold: 2.5            # liq_1h_vs_4h_avg ratio for cascade flag
  liq_cascade_min_usd: 500000           # Minimum total liq USD for cascade
  store_raw_data: true                   # Store raw API responses (~1.5GB/yr)
  funding_settlement_hours: [0, 8, 16]   # Hyperliquid funding times (UTC)
```

Safety configuration lives in `SatelliteConfig.safety` (see Kill Switch section below).

---

## Integration Points

### Daemon -> Satellite (feature collection)

The daemon calls `satellite.tick()` every 300s after `_poll_derivatives()`:

```python
from satellite import tick

results = tick(
    snapshot=market_snapshot,
    data_layer_db=data_layer_db,
    heatmap_engine=heatmap_engine,
    order_flow_engine=order_flow_engine,
    store=satellite_store,
    config=satellite_config,
)
```

This iterates over configured coins, calls `compute_features()` for each, and writes results to `satellite.db`.

### Satellite -> Trading (inference)

`InferenceEngine.predict()` runs the full pipeline for a single coin:

1. `compute_features()` -- compute raw features (same function as collection)
2. `scaler.transform()` -- normalize 12 structural features using sealed scaler
3. Append 9 availability flags (binary, no normalization) -- 21-dimensional vector
4. XGBoost `model.predict()` -- two separate models (long, short) predict net ROE %
5. SHAP `TreeExplainer` -- per-prediction explanation (~100us)
6. `_decide()` -- threshold + conflict resolution produces signal

Signals: `"long"`, `"short"`, `"skip"` (neither above threshold), `"conflict"` (both above threshold within margin).

### Position Sizing

`compute_position_size()` scales position USD linearly with predicted ROE above threshold, bounded by `base_size_usd` ($5,000) and `max_size_usd` ($25,000).

---

## Labeling

`labeler.py` computes ground-truth labels by looking forward at actual price action. Labels answer: "If we entered LONG or SHORT at this snapshot, what was the best achievable ROE?"

- **Fee model**: Maker open (2 bps) + taker close (5 bps) = 7 bps round-trip
- **Default leverage**: 20x
- **Label windows**: 15m, 30m, 1h, 4h (gross ROE for all; net ROE + MAE for 30m)
- **ROE clipping**: [-20%, +20%] to prevent outlier domination
- **Binary labels**: At thresholds 0%, 1%, 2%, 3%, 5% (for evaluation, not training)
- **Minimum label age**: 14,400s (4h) before a snapshot can be labeled
- **Simulated exits**: Generates ~6 exit decision rows per snapshot (every 5 min within 30-min window, for both long and short) used by Model B bootstrap

---

## Kill Switch (Safety)

`safety.py` controls whether the ML model is allowed to make trade decisions. Five disable conditions:

| # | Condition | Default Threshold | Description |
|---|-----------|-------------------|-------------|
| 1 | Manual disable | `ml_enabled=false` | Operator sets in config |
| 2 | Cumulative loss | `-15.0%` ROE | Total losses exceed threshold |
| 3 | Consecutive losses | `5` trades | N losing trades in a row |
| 4 | Precision collapse | `< 40%` | Precision-at-3% over last 50 predictions drops below floor |
| 5 | Data staleness | `900s` (15 min) | No fresh snapshots for > 3x snapshot interval |

When triggered, the system falls back to LLM-based decisions. Re-enabling requires manual operator action: investigate, enable shadow mode, validate, then re-enable.

**Shadow mode**: Model predicts but does not execute trades. Used for re-validation after auto-disable.

Safety state (cumulative ROE, consecutive losses, recent predictions) is persisted in the `satellite_metadata` table.

---

## Health Monitoring

`monitor.py:generate_health_report()` produces a daily `HealthReport` covering:

- **Pipeline health**: Snapshot count vs expected (288/coin/day), max gap between snapshots, labeling backlog
- **Model performance**: Prediction count, win rate, cumulative ROE (populated from daemon trade log)
- **Feature integrity**: Zero-variance features, NULL counts, per-feature availability rates
- **System**: DB file size in MB

Health check passes if: snapshot rate > 90%, max gap < 15 minutes, labeling backlog < 500.

---

## Trained Model: v1

The first trained model lives in `satellite/artifacts/v1/`. It is committed to the repo but **not yet wired into the daemon** — inference code exists (`InferenceEngine`) but nothing calls it yet.

### v1 Artifact

| File | Size | Contents |
|------|------|----------|
| `model_long_v1.pkl` | 296KB | XGBoost Booster (long ROE predictor) |
| `model_short_v1.pkl` | 271KB | XGBoost Booster (short ROE predictor) |
| `scaler_v1.json` | 1.7KB | Fitted FeatureScaler (sealed to training data) |
| `metadata_v1.json` | 1.2KB | Training metadata, params, feature hash |

### Training Summary

- **Data**: 166,750 labeled snapshots (BTC/ETH/SOL), Aug 2025 -- Feb 2026
- **Split**: 85/15 time-based (train through Jan 30, val Feb onward)
- **Train samples**: 141,739 | **Val samples**: 25,011
- **Validation MAE**: Long 4.441, Short 4.667
- **Walk-forward**: 9 generations (60-day min train, 14-day test steps), profitable in all 9 windows across bull, bear, and chop regimes

### Feature Importance (SHAP)

Top features by mean absolute SHAP value (stable across all regimes):

1. `realized_vol_1h` -- dominant (~70% of total SHAP)
2. `price_change_5m_pct` -- consistent #2
3. `funding_vs_30d_zscore` -- #1 derivatives feature in bear/chop regimes
4. `volume_vs_1h_avg_ratio` -- #2 derivatives feature
5. `sessions_overlapping`, `hours_to_funding`, `cvd_normalized_5m` -- modest but stable

### Known Limitations

1. **Live feature gap**: The top 2 features (`realized_vol_1h`, `price_change_5m_pct`) are computed from candle data in backfill but **stub out in live `compute_features()`** (return neutral with avail=0). Wiring these from the data-layer's candle/trade stream is required before the model operates at full strength.
2. **Inference not wired**: `InferenceEngine` exists but the daemon does not call it. The current flow is `tick()` -> `compute_features()` -> store. Adding inference after feature computation is the next integration step.
3. **Label design**: Target is "best 30-min forward-looking ROE at 20x leverage" -- assumes optimal exit timing within the window. Real execution will capture a fraction of this.

---

## Related Documentation

- `satellite/artemis/README.md` -- Historical backfill pipeline
- `satellite/training/README.md` -- Model training and validation
- `docs/archive/` -- Revision history and implementation guides

---

Last updated: 2026-03-02
