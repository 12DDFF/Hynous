# Artemis

> Historical data backfill pipeline -- downloads Hyperliquid data from the Artemis S3 bucket, reconstructs feature snapshots, and produces labeled training data one day at a time.

---

## Architecture

```
artemis/
├── __init__.py       # Package docstring
├── pipeline.py       # Orchestrator: process_date_range(), process_single_day()
├── reconstruct.py    # Feature snapshot reconstruction from historical data
├── profiler.py       # FIFO-matched wallet profiling (win rate, style, bot detection)
├── seeder.py         # Address discovery and seeding into data-layer
└── layer2.py         # Co-occurrence collection for future smart money ML
```

---

## Data Source

| Dataset | S3 Path | Contents |
|---------|---------|----------|
| **Perp Balances** | `s3://artemis-hyperliquid-data/raw/perp_balances/{date}/` | Snapshot of ALL addresses with open positions (position value, coin, address) |
| **Node Fills** | `s3://artemis-hyperliquid-data/raw/node_fills/{date}/` | Every trade with buyer/seller addresses, price, size, and liquidation flag |

Access is requester-pays (~$0.09/GB transfer). Files are gzip-compressed JSONL.

---

## Pipeline Steps

`process_single_day()` in `pipeline.py` runs 3 phases per date:

### Phase 1: Perp Balances

1. Download from S3 (requester-pays via boto3)
2. Extract addresses with positions >= `min_position_usd` ($50K default)
3. Compute aggregate OI per coin and write to `oi_history` table
4. Seed significant addresses into data-layer `addresses` table (tier=3)
5. Delete raw file from disk

### Phase 2: Node Fills

1. Download from S3
2. Extract liquidation events (>= $100 USD) into `liquidation_events` table
3. Aggregate volume per 5-minute bucket into `volume_history` table
4. Collect per-address trade records for profiling
5. Profile significant wallets (>= $50K volume) via FIFO matching
6. Delete raw file from disk

### Phase 3: Reconstruction + Labeling

1. Fetch 5m candles from Hyperliquid API (covers day - 1h through day + 4h)
2. Fetch funding rate history from Hyperliquid API (30 days back for z-score)
3. Reconstruct 288 feature snapshots per coin (one every 300s)
4. Label each snapshot immediately using available candle data

---

## Configuration

```python
@dataclass
class ArtemisConfig:
    s3_bucket: str = "artemis-hyperliquid-data"
    s3_prefix: str = "raw/"
    temp_dir: str = "/tmp/artemis"
    coins: list[str] = ["BTC", "ETH", "SOL"]
    batch_size: int = 10000            # rows per batch insert
    min_position_usd: float = 50_000   # wallet-level filter
    api_delay_seconds: float = 0.5     # HL API rate limiting
```

---

## Feature Reconstruction

`reconstruct.py:reconstruct_day()` produces 288 snapshots per coin per day by calling the **same** `compute_features()` function used in live collection, ensuring feature parity.

### Data Source Mapping

| Feature | Historical Source |
|---------|-----------------|
| `liq_magnet_direction` | Perp Balances (historical heatmap) |
| `oi_vs_7d_avg_ratio` | Perp Balances (sum positions = OI) |
| `liq_cascade_active` | Node Fills (liquidation flag) |
| `liq_1h_vs_4h_avg` | Node Fills (liq counts per window) |
| `funding_vs_30d_zscore` | Hyperliquid funding history API |
| `hours_to_funding` | Clock math |
| `oi_funding_pressure` | OI change + funding rate |
| `cvd_normalized_5m` | Node Fills (buyer/seller per trade) |
| `price_change_5m_pct` | Hyperliquid 5m candles API |
| `volume_vs_1h_avg_ratio` | Node Fills (sum sizes per window) |
| `realized_vol_1h` | Hyperliquid 1m candles API |
| `sessions_overlapping` | Clock math |

The `_enrich_historical_features()` function overrides features that the live `compute_features()` path cannot compute without real-time engines (e.g., `price_change_5m_pct` is computed from candle data instead of the live candle source which is not yet wired).

A `_SyntheticSnapshot` object is constructed for each timestamp to satisfy the `compute_features()` interface, populated with the nearest candle close, funding rate, OI, and volume from historical tables.

---

## Wallet Profiler

`profiler.py:batch_profile()` computes per-wallet metrics using FIFO trade matching:

| Metric | Description |
|--------|-------------|
| `win_rate` | Fraction of matched trades with positive PnL |
| `trade_count` | Number of FIFO-matched round trips |
| `profit_factor` | Gross profit / gross loss |
| `avg_hold_hours` | Mean hold duration |
| `avg_pnl_pct` | Mean PnL per trade (%) |
| `max_drawdown` | Worst peak-to-trough cumulative PnL drawdown (%) |
| `style` | Classification: `scalper` (<1h), `day_trader` (<24h), `swing` (<168h), `position` (168h+) |
| `is_bot` | Heuristic: `1` if >50 trades/day AND avg hold <2 min |
| `equity` | Not available from Node Fills alone (set to 0) |

Minimum 10 trades to attempt profiling; minimum 5 matched round trips to produce a profile. Profiles are written to `wallet_profiles` table in the data-layer DB.

---

## Address Seeder

`seeder.py:seed_addresses()` inserts discovered addresses into the data-layer `addresses` table using `INSERT OR IGNORE` (existing addresses are not overwritten). New addresses receive:

- `tier = 3` (lowest polling priority -- upgraded after profiling)
- `first_seen` / `last_seen` set to the processing date
- `trade_count = 0`, `total_size_usd = 0`

Batch size: 1,000 rows per insert.

---

## Layer 2: Co-occurrence

`layer2.py:collect_co_occurrence()` detects wallets that enter positions within a configurable time window (default 300s / 5 minutes). This data is stored in the `co_occurrences` table in `satellite.db` for future smart money ML features (not used in the v1 model).

Prepared capabilities:
1. Entry co-occurrence (temporal clustering of entries)
2. Strategy fingerprinting (which features are active at entry)
3. Group detection (wallets that trade together)

---

## Usage

```python
from datetime import date
from satellite.artemis.pipeline import process_date_range, ArtemisConfig

results = process_date_range(
    start_date=date(2025, 1, 1),
    end_date=date(2025, 1, 31),
    data_layer_db=data_layer_db,
    satellite_store=satellite_store,
    config=ArtemisConfig(coins=["BTC", "ETH", "SOL"]),
)

for r in results:
    print(f"{r.date}: {r.snapshots_reconstructed} snaps, {r.labels_computed} labels ({r.elapsed_seconds:.0f}s)")
```

### DayResult Fields

| Field | Type | Description |
|-------|------|-------------|
| `date` | `str` | YYYY-MM-DD |
| `addresses_discovered` | `int` | Significant wallets from Perp Balances |
| `liquidation_events` | `int` | Liquidations extracted from Node Fills |
| `trades_processed` | `int` | Total trades parsed from Node Fills |
| `profiles_computed` | `int` | Wallets profiled via FIFO matching |
| `snapshots_reconstructed` | `int` | Feature snapshots written (288 per coin per day) |
| `labels_computed` | `int` | Snapshots with outcome labels |
| `elapsed_seconds` | `float` | Wall clock time for the entire day |

---

## Disk Budget

Processing is designed for VPS disk constraints. Only one day's raw data exists on disk at a time: download -> extract -> delete -> next day. Temp files go to `/tmp/artemis/{date}/` and are always cleaned up (even on failure).

---

## Related Documentation

- `../README.md` -- Satellite module overview
- `../training/README.md` -- Training pipeline that consumes Artemis-produced data
- `docs/archive/` -- Revision history

---

Last updated: 2026-03-01
