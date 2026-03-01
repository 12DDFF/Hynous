# Hynous Data Layer

> Hyperliquid market intelligence service -- liquidation heatmaps, order flow, whale tracking, smart money profiling.

Standalone FastAPI service that collects real-time data from Hyperliquid via WebSocket and REST, runs analytical engines, and exposes results through a REST API on `:8100`. The main Hynous agent and dashboard consume this API via `HynousDataClient` (`src/hynous/data/providers/hynous_data.py`).

---

## Architecture

```
                    Hyperliquid API
                    (WS + REST)
                         |
            +------------+------------+
            |            |            |
       TradeStream  PositionPoller  HlpTracker   L2Subscriber
       (WebSocket)  (REST, tiered)  (REST, 60s)  (WebSocket)
            |            |            |                |
            v            v            v                v
      trade buffers   SQLite DB    SQLite DB    in-memory books
            |            |            |
       +----+----+  +---+---+   +----+----+
       |         |  |       |   |         |
  OrderFlow   LiqHeatmap  WhaleTracker  SmartMoney + Profiler
  (in-memory)  (DB query)  (DB query)    (DB + Hyperliquid fills)
       |         |          |             |
       +----+----+----+-----+----+--------+
            |              |              |
         FastAPI REST API (:8100)
            |
    HynousDataClient (main Hynous system)
```

**Data flows in three stages:**

1. **Collectors** -- gather raw data from Hyperliquid (trades, positions, L2 books)
2. **Engines** -- compute derived signals (heatmaps, CVD, rankings, profiles)
3. **API** -- serve results as JSON over HTTP

---

## Running

```bash
# Install
cd data-layer
python3 -m pip install -e .

# Run
python3 -m scripts.run

# Or use the Makefile
make install   # pip install -e .
make run       # python3 -m scripts.run
make test      # pytest tests/ -v
make lint      # ruff check
make format    # ruff format
make clean     # remove DB + __pycache__
```

The service writes to `storage/hynous-data.db` (SQLite, WAL mode) and `storage/hynous-data.pid` (instance lock). Only one instance can run at a time.

**Systemd (VPS):**

```bash
cp deploy/hynous-data.service /etc/systemd/system/
systemctl enable --now hynous-data
```

---

## Configuration

All settings live in `config/default.yaml`. The service also reads `../.env` from the project root.

| Section | Key | Default | Description |
|---------|-----|---------|-------------|
| `server` | `host` | `127.0.0.1` | Bind address |
| `server` | `port` | `8100` | API port |
| `db` | `path` | `storage/hynous-data.db` | SQLite file path |
| `db` | `prune_days` | `7` | Time-series retention (hlp_snapshots, pnl_snapshots) |
| `rate_limit` | `max_weight_per_min` | `1200` | Hyperliquid API weight budget |
| `rate_limit` | `safety_pct` | `85` | Use only N% of budget (effective = 1020) |
| `trade_stream` | `enabled` | `true` | WebSocket trade subscription |
| `position_poller` | `enabled` | `true` | Tiered position polling |
| `position_poller` | `workers` | `8` | Concurrent poll threads |
| `position_poller` | `tier1_interval` | `30` | Whale re-poll interval (seconds) |
| `position_poller` | `tier2_interval` | `120` | Mid re-poll interval |
| `position_poller` | `tier3_interval` | `600` | Small re-poll interval |
| `position_poller` | `whale_threshold` | `1000000` | USD threshold for tier 1 |
| `position_poller` | `mid_threshold` | `100000` | USD threshold for tier 2 |
| `hlp_tracker` | `enabled` | `true` | HLP vault polling |
| `hlp_tracker` | `poll_interval` | `60` | Seconds between vault polls |
| `hlp_tracker` | `vaults` | 3 addresses | Known HLP vault addresses |
| `heatmap` | `recompute_interval` | `10` | Seconds between heatmap refreshes |
| `heatmap` | `bucket_count` | `50` | Price buckets per heatmap |
| `heatmap` | `range_pct` | `15` | Price range % above/below mid |
| `order_flow` | `windows` | `[60, 300, 900, 3600]` | CVD aggregation windows (seconds) |
| `l2_subscriber` | `enabled` | `false` | L2 order book WebSocket (disabled by default) |
| `l2_subscriber` | `coins` | `[BTC, ETH, SOL]` | Coins to subscribe |
| `smart_money` | `profile_window_days` | `7` | Fill history window for profiling |
| `smart_money` | `profile_refresh_hours` | `2` | Profile recompute interval |
| `smart_money` | `min_equity` | `50000` | Auto-discovery equity threshold |
| `smart_money` | `auto_curate_enabled` | `true` | Auto-track profitable wallets |
| `smart_money` | `auto_curate_max_wallets` | `20` | Max auto-tracked wallets |

See `config/default.yaml` for the full list including bot detection thresholds and auto-curation criteria.

---

## API Endpoints

All endpoints return JSON.

### Core

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health: uptime, address/position counts, WS status |
| `GET` | `/v1/stats` | Component-level stats (trade_stream, position_poller, hlp_tracker, liq_heatmap, rate_limiter) |

### Market Intelligence

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/heatmap/{coin}` | Liquidation heatmap -- price buckets with long/short liq USD. Filters: min $1K position, excludes bots, 1200s staleness cutoff |
| `GET` | `/v1/orderflow/{coin}` | Buy/sell volume + CVD across 1m/5m/15m/1h windows |
| `GET` | `/v1/whales/{coin}?top_n=50` | Largest positions for a coin, sorted by size_usd |
| `GET` | `/v1/hlp/positions` | Current HLP vault positions (in-memory cache) |
| `GET` | `/v1/hlp/sentiment?hours=24` | HLP sentiment: current side, flips, size per coin over N hours |

### Smart Money

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/smart-money?top_n=50` | Top traders by 24h PnL. Filters: `min_win_rate`, `style` (scalper/swing/mixed/bot), `exclude_bots`, `min_trades`, `min_equity`, `max_hold_hours` |
| `GET` | `/v1/smart-money/watchlist` | All active watched wallets with profile data + positions |
| `GET` | `/v1/smart-money/wallet/{address}?days=30` | Full wallet profile: stats, positions, recent changes, trade history. Computes on-demand if missing |
| `GET` | `/v1/smart-money/wallet/{address}/trades?limit=50` | Matched trade history for an address |
| `GET` | `/v1/smart-money/changes?minutes=30` | Recent position changes for tracked wallets (entries, exits, flips, increases) |
| `POST` | `/v1/smart-money/watch` | Add address to watchlist. Body: `{"address": "0x...", "label": "..."}` |
| `DELETE` | `/v1/smart-money/watch/{address}` | Remove address from watchlist |
| `PATCH` | `/v1/smart-money/watch/{address}` | Update label/notes/tags. Body: `{"label": "...", "notes": "...", "tags": "..."}` |

### Wallet Alerts

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/smart-money/wallet/{address}/alerts` | Create alert. Body: `{"alert_type": "...", "min_size_usd": 0, "coins": ""}`. Types: `any_trade`, `entry_only`, `exit_only`, `size_above`, `coin_specific` |
| `GET` | `/v1/smart-money/wallet/{address}/alerts` | List active alerts for an address |
| `DELETE` | `/v1/smart-money/alert/{alert_id}` | Delete an alert by ID |
| `GET` | `/v1/smart-money/alerts/active` | All active alerts (batch, for scanner) |

### Historical Recording

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/historical/record` | Record funding/OI/volume snapshots. Body: `{"funding": {...}, "oi": {...}, "volume": {...}}`. Called by the main Hynous daemon after each derivatives poll (~300s) |

---

## Database Tables

SQLite with WAL mode. Thread-safe: all writes go through a single `write_lock`; reads are concurrent.

### Core Tables

| Table | Purpose | Primary Key | Retention |
|-------|---------|-------------|-----------|
| `addresses` | Discovered trading addresses with tier classification | `address` | Permanent (inactive pruned via `last_seen` filter) |
| `positions` | Current open positions per address/coin | `(address, coin)` | Pruned hourly: rows not updated in 24h |
| `metadata` | Key-value store for internal state | `key` | Permanent |

### HLP & PnL Snapshots

| Table | Purpose | Primary Key | Retention |
|-------|---------|-------------|-----------|
| `hlp_snapshots` | HLP vault position history | `(vault_address, coin, snapshot_at)` | `prune_days` (default 7) |
| `pnl_snapshots` | Equity + unrealized PnL per address over time | `(address, snapshot_at)` | `prune_days` (default 7) |

### Smart Money Tables

| Table | Purpose | Primary Key | Retention |
|-------|---------|-------------|-----------|
| `watched_wallets` | User-curated + auto-curated wallet watchlist | `address` | Permanent (soft delete via `is_active`) |
| `wallet_profiles` | Cached profile metrics (win_rate, style, etc.) | `address` | Permanent (recomputed every `profile_refresh_hours`) |
| `wallet_trades` | FIFO-matched trade history per address | `id` (autoincrement) | Permanent (replaced on profile recompute) |
| `position_changes` | Detected entry/exit/flip/increase events | `id` (autoincrement) | Pruned hourly: rows older than 7 days |
| `wallet_alerts` | Per-wallet custom alert rules | `id` (autoincrement) | Permanent |

### Historical Tables (ML Features)

| Table | Purpose | Primary Key | Retention |
|-------|---------|-------------|-----------|
| `funding_history` | Funding rate snapshots per coin | `(coin, recorded_at)` | 90 days |
| `oi_history` | Open interest snapshots per coin | `(coin, recorded_at)` | 90 days |
| `volume_history` | Volume snapshots per coin | `(coin, recorded_at)` | 90 days |
| `liquidation_events` | Individual liquidation events from trade stream | `id` (autoincrement) | 90 days |

---

## Collectors

### TradeStream (`collectors/trade_stream.py`)

Subscribes to the Hyperliquid WebSocket for **all coins** and processes every trade in real-time. Two responsibilities:

1. **Address discovery** -- extracts trader addresses from the `users` field and batch-inserts them into the `addresses` table (1s flush interval)
2. **Trade buffering** -- appends each trade to per-coin in-memory deques (`_trade_buffers`, 50K trades/coin max) consumed by the OrderFlow engine
3. **Liquidation recording** -- detects liquidation trades and writes them to `liquidation_events` (min $100 size). Side semantics: `side="B"` (buy = SHORT liquidated) maps to `"short"`, `side="A"` (sell = LONG liquidated) maps to `"long"`

Health monitoring: if no trades arrive for 30s, the WebSocket is considered dead and auto-reconnects. Exposes `is_healthy` property and `stats()`.

### PositionPoller (`collectors/position_poller.py`)

Polls `user_state` for discovered addresses using the Hyperliquid REST API. **Tiered by position size:**

| Tier | Size Threshold | Poll Interval | Description |
|------|---------------|---------------|-------------|
| 1 | >= $1M | 30s | Whales |
| 2 | $100K -- $1M | 120s | Mid-size |
| 3 | < $100K | 600s | Small |

Uses a thread pool (default 8 workers) for parallel polling. After each cycle:
- Upserts positions to DB and deletes closed positions
- Reclassifies address tiers based on current total size
- Records equity snapshots for smart money PnL tracking
- Detects position changes for watched wallets (entry/exit/flip/increase)

Watched wallets are always included in every poll cycle regardless of tier/staleness. Addresses inactive for 7+ days are skipped.

### HlpTracker (`collectors/hlp_tracker.py`)

Polls 3 known HLP (Hyperliquid Liquidity Provider) vault addresses on a fixed 60s interval. Writes position snapshots to `hlp_snapshots` and maintains an in-memory cache for fast API reads. Computes sentiment (side flips, net delta) from historical snapshots. Position `size_usd` is computed using mark price (derived from `positionValue / size`) for accurate current-value reporting.

### L2Subscriber (`collectors/l2_subscriber.py`)

WebSocket subscriber for L2 order book data (100 levels/side). Maintains in-memory snapshots updated in real-time. **Disabled by default** (`l2_subscriber.enabled: false`). Provides `get_book(coin)` (bids, asks, mid, spread, depth) and `get_mid(coin)`. Connects to `wss://api.hyperliquid.xyz/ws`.

---

## Engines

### LiqHeatmapEngine (`engine/liq_heatmap.py`)

Periodically recomputes liquidation heatmaps from the `positions` table (default: every 10s).

- Fetches current mid prices via `all_mids()` REST call
- For each coin: queries positions with `liq_px`, buckets them into N price ranges (+/- range_pct from mid)
- **Filters:** min $1K position size, excludes `is_bot=1` wallets, 1200s staleness cutoff
- Output: per-bucket `long_liq_usd`/`short_liq_usd` counts + summary totals

### OrderFlowEngine (`engine/order_flow.py`)

Computes buy/sell volume and CVD (Cumulative Volume Delta) from the in-memory trade buffers.

- **`get_order_flow(coin)`** -- metrics across all configured windows (default: 1m, 5m, 15m, 1h): buy_volume_usd, sell_volume_usd, cvd, buy_count, sell_count, buy_pct
- **`get_all_cvd_summary()`** -- quick 5m CVD for all coins (used by scanner integration)
- Stateless: reads directly from shared `_trade_buffers` deques

### WhaleTracker (`engine/whale_tracker.py`)

Queries the `positions` table for large positions, ranked by `size_usd`.

- **`get_whales(coin, top_n)`** -- top N positions with long/short totals and net exposure
- **`get_whale_summary()`** -- aggregate stats across all coins for positions >= $100K

### SmartMoneyEngine (`engine/smart_money.py`)

Tracks equity over time and ranks addresses by profitability.

- **`batch_snapshot_pnl()`** -- records equity snapshots; auto-queues high-equity addresses without profiles for profiling
- **`get_rankings(top_n)`** -- ranks by 24h PnL using window functions on `pnl_snapshots`, attaches positions + profile data
- **Profile queue** -- persistent drainer thread profiles ~20 addresses/min (3s throttle to share rate limit budget)

### WalletProfiler (`engine/profiler.py`)

Fetches trade fills from Hyperliquid, computes wallet statistics, manages the watchlist.

- **`fetch_fills(address)`** -- calls `user_fills_by_time` (API weight: 20)
- **`compute_profile(fills)`** -- FIFO trade matching, computes: win_rate, profit_factor, avg_hold_hours, avg_pnl_pct, max_drawdown, style classification, bot detection
- **Style classification:** `bot` (>50 trades/day or <2min avg hold), `scalper` (<1h avg), `swing` (>4h avg), `mixed`
- **`refresh_profiles()`** -- periodic refresh (default 2h): prioritizes leaderboard wallets > watched wallets > stale profiles
- **`auto_curate()`** -- auto-tracks wallets meeting thresholds (>55% win rate, >10 trades, >1.5 profit factor, up to 20 wallets)
- **`get_profile(address)`** -- full profile lookup with on-demand computation, includes: positions, recent changes, trade history, watchlist status, alerts

### PositionChangeTracker (`engine/position_tracker.py`)

Compares position snapshots to detect changes for watched wallets.

- Maintains in-memory state: last known positions per address
- **Detects:** `entry` (new position), `exit` (position closed), `flip` (side changed), `increase` (size grew >20%)
- Initializes from DB at startup to avoid false alerts on restart
- Writes detected changes to `position_changes` table

---

## Integration with Main Hynous System

The main Hynous system communicates with the data layer over HTTP:

| Component | How it uses data-layer |
|-----------|----------------------|
| `HynousDataClient` (`src/hynous/data/providers/hynous_data.py`) | Singleton HTTP client wrapping all endpoints. Thread-safe. Used by tools and context builders |
| `data_layer` tool (`src/hynous/intelligence/tools/data_layer.py`) | Registered LLM tool giving the agent access to heatmaps, order flow, whales, smart money, wallet tracking |
| Scanner (`src/hynous/intelligence/scanner.py`) | Polls data layer signals for automated market scanning |
| Briefing (`src/hynous/intelligence/briefing.py`) | Injects heatmap/HLP/order flow summaries into agent context |
| Context snapshot (`src/hynous/intelligence/context_snapshot.py`) | Reads data layer for regime detection context |
| Daemon (`src/hynous/intelligence/daemon.py`) | Calls `record_historical()` to push funding/OI/volume snapshots after each derivatives poll |

Configuration in `config/default.yaml` (main project):
```yaml
data_layer:
  url: "http://127.0.0.1:8100"
  enabled: true
```

---

## File Inventory

```
data-layer/
  config/
    default.yaml              # All service configuration
  deploy/
    hynous-data.service       # systemd unit file
  scripts/
    run.py                    # Entry point (python -m scripts.run)
  src/hynous_data/
    main.py                   # Orchestrator — starts all components + uvicorn
    api/
      app.py                  # FastAPI app factory
      routes.py               # All REST endpoints
    collectors/
      trade_stream.py         # WebSocket trade subscriber + address discovery
      position_poller.py      # Tiered REST position polling
      hlp_tracker.py          # HLP vault position polling
      l2_subscriber.py        # WebSocket L2 order book (disabled by default)
    core/
      config.py               # Dataclass config + YAML loader
      db.py                   # SQLite database (WAL mode, schema, migrations, pruning)
      rate_limiter.py         # Token bucket rate limiter (1200 weight/min)
      utils.py                # safe_float helper
    engine/
      liq_heatmap.py          # Liquidation heatmap computation
      order_flow.py           # CVD + buy/sell volume from trade buffers
      whale_tracker.py        # Large position filtering and ranking
      smart_money.py          # PnL tracking, equity ranking, profile queue
      profiler.py             # Fill fetching, FIFO trade matching, watchlist, auto-curation
      position_tracker.py     # Position change detection (entry/exit/flip/increase)
  tests/
    test_smoke.py             # Smoke tests
    test_order_flow.py        # OrderFlow engine tests
    test_rate_limiter.py      # Rate limiter tests
    test_liq_heatmap.py       # Heatmap engine tests
    test_historical_tables.py # Historical table tests
  Makefile                    # install, dev, run, test, lint, format, clean
  pyproject.toml              # Package metadata + dependencies
```

---

## Dependencies

From `pyproject.toml`:

| Package | Purpose |
|---------|---------|
| `pyyaml` | Configuration loading |
| `hyperliquid-python-sdk` | Hyperliquid REST + WebSocket client |
| `fastapi` | REST API framework |
| `uvicorn[standard]` | ASGI server |

Dev dependencies: `pytest`, `pytest-cov`, `ruff`.

Python >= 3.11 required.

---

## Background Threads

The Orchestrator starts these background threads:

| Thread | Interval | Purpose |
|--------|----------|---------|
| `trade-stream` | Continuous (WebSocket) | Trade subscription + address discovery |
| `position-poller` | 5s between cycles | Tiered position polling |
| `hlp-tracker` | 60s | HLP vault polling |
| `l2-subscriber` | Continuous (WebSocket) | L2 order book (if enabled) |
| `liq-heatmap` | 10s | Heatmap recomputation |
| `profile-drainer` | Continuous (3s throttle) | Smart money profiling queue |
| Pruner | 3600s (hourly) | Delete old time-series data + stale positions |
| Profiler refresh | `profile_refresh_hours` (default 2h) | Recompute wallet profiles + auto-curate |

---

*Last updated: 2026-03-01*
