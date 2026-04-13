# Cross-System Data Flows (v2)

> Documents every data flow that crosses a system boundary in Hynous v2.

---

## System Boundaries

```
  ┌──────────────────────────────────────────────────────────────┐
  │                    Dashboard (Reflex :3000)                  │
  │   /api/data/*     /api/ml/*     /api/v2/journal/*   /api/candles
  └──────┬──────────────┬────────────────┬──────────────────────┘
         │              │                │
         ▼              ▼                ▼
  ┌──────────────┐ ┌────────────┐ ┌──────────────┐
  │  Data-Layer  │ │ satellite  │ │  Journal     │
  │  :8100       │ │   .db      │ │  (in-proc    │
  │              │ │ (SQLite)   │ │   SQLite)    │
  └──────┬───────┘ └─────┬──────┘ └──────▲───────┘
         │               │               │
         │               │               │  writes on every
         │               │               │  trade lifecycle event
         │               │               │
         └───┬───────────┴───────────────┤
             │                           │
             ▼                           │
       ┌──────────────────────────────────────┐
       │   Daemon (intelligence/daemon.py)    │
       │   + Analysis agent (src/hynous/      │
       │     analysis/, in-process threads)   │
       └──────────────────────────────────────┘
```

The daemon is the central orchestrator. It drives the mechanical trading
loop, polls market data, pushes historical snapshots to the data-layer,
feeds the satellite ML engine, writes journal events, and triggers the
post-trade analysis agent.

---

## Flow 1: Daemon → Data-Layer (historical push)

**What**: Every 300s (`deriv_poll_interval`), the daemon records funding,
OI, and volume snapshots to the data-layer's historical tables via HTTP
POST.

**Code path**:
1. `daemon.py:_poll_derivatives()` calls `_record_historical_snapshots()`
2. Calls `HynousDataClient.record_historical(funding, oi, volume)` in `src/hynous/data/providers/hynous_data.py`
3. HTTP POST to `http://127.0.0.1:8100/v1/historical/record`

**Guard**: only runs if `config.data_layer.enabled` and `client.is_available`.

**Purpose**: populates `oi_history`, `funding_history`, `volume_history`
tables that satellite reads for rolling averages and z-scores.

---

## Flow 2: Satellite ← Data-Layer DB (read-only SQLite)

**What**: `satellite/features.py:compute_features()` reads directly from
the data-layer's SQLite file.

**Code path**:
1. Daemon opens a read-only SQLite connection to
   `config.satellite.data_layer_db_path` (`data-layer/storage/hynous-data.db`)
2. Stored in `daemon._satellite_dl_conn` (RO, `PRAGMA busy_timeout=3000`)
3. Wrapped in a `_DbAdapter` and passed into `satellite.tick()`
4. `features.py` queries `oi_history`, `funding_history`, `volume_history`,
   `liquidation_events`

---

## Flow 3: Daemon → Satellite (tick + inference)

**What**: After each `_poll_derivatives()` cycle (~300s), the daemon calls
`satellite.tick()` and then `_run_satellite_inference()` per coin.

**Code path**:
1. Daemon fetches candles per coin via `_fetch_satellite_candles(coin)`
   (5m + 1m, WS-first with REST fallback through `ws_feeds.py`)
2. Builds `candles_map = {coin: (candles_5m, candles_1m)}`
3. Calls
   `satellite.tick(snapshot, data_layer_db, heatmap_engine, order_flow_engine, store, config, candles_map=candles_map)`
4. `satellite/__init__.py:tick()` computes 28 features per coin and writes
   to `satellite.db` via `store.save_snapshot()`
5. Daemon then calls `_run_satellite_inference()` which runs XGBoost +
   SHAP via `InferenceEngine.predict(...)`, writes predictions to
   `satellite.db`, updates `_latest_predictions` cache
6. Signal gating happens inside the mechanical entry loop, not here. The
   daemon's `_periodic_ml_signal_check` (60 s cadence) reads
   `_latest_predictions` and drives `mechanical_entry/ml_signal_driven.py`
   to accept or reject candidate entries. No LLM is woken from satellite
   predictions in v2.

**Kill switch**: `KillSwitch.check_staleness()` auto-disables inference if
no snapshot for >900s.

---

## Flow 4: Daemon → Journal (trade lifecycle writes)

**What**: Every trade lifecycle event — entry detection, exit detection,
side-flip, SL/TP placement, cancels — is captured by
`src/hynous/journal/capture.py` and written to `storage/v2/journal.db` via
`JournalStore`.

**Code path**:
1. Daemon detects entry in `_check_positions()`
2. Builds `TradeEntrySnapshot` via `journal.capture.build_entry_snapshot(...)`
3. `JournalStore.write_entry_snapshot()` inserts into `entry_snapshots` +
   creates a row in `trades`
4. On exit: builds `TradeExitSnapshot`, writes via
   `write_exit_snapshot()`, closes the trade row, fires the analysis agent
5. Counterfactual recompute scheduled for T+30min —
   `list_exit_snapshots_needing_counterfactuals()` drives the retry

Schema: 9 tables (`trades`, `trade_events`, `entry_snapshots`,
`exit_snapshots`, `trade_analyses`, `rejection_analyses`, `trade_edges`,
`pattern_rollups`, `journal_metadata`). WAL mode, 5s busy_timeout.

---

## Flow 5: Journal → Analysis Agent (post-trade)

**What**: After every exit snapshot, `wake_integration.trigger_analysis_async(trade_id)`
runs the post-trade analysis pipeline on a background thread named
`analysis-<trade_id[:8]>`.

**Code path**:
1. Deterministic rules engine (`analysis/rules_engine.py`, 12 rules) runs
   over entry, exit, and counterfactual data
2. Prompt built in `analysis/prompts.py` with evidence references
3. `analysis/llm_pipeline.py` runs LiteLLM synthesis (single attempt, no
   retry, lazy import of `litellm` to preserve cold-start time)
4. `analysis/validation.py` strips unsupported claims, validates tags and
   grades
5. `JournalStore.write_trade_analysis()` persists narrative, citations,
   merged deterministic + LLM findings, mistake tags, grades,
   `process_quality_score`, `unverified_claims`

**Batch rejection cron**: a separate thread
(`rejection-analysis-cron`) runs hourly and batch-judges pending rejected
signals with `prompt_version='rejection-v1'`, writing to
`rejection_analyses`.

---

## Flow 6: Dashboard ← Journal (HTTP router)

**What**: The dashboard mounts the FastAPI router from
`src/hynous/journal/router.py` at `/api/v2/journal/*`.

**Endpoints** (non-exhaustive): trades list/get, events by trade, analysis
fetch, stats summary, semantic search (via `EmbeddingClient` matryoshka
512-dim), tag CRUD.

**Data path**: Dashboard calls the router in-process (same FastAPI app as
the dashboard proxy routes). `JournalStore` reads `journal.db` directly.

---

## Flow 7: Dashboard ← Satellite DB (`/api/ml/*`)

**What**: The ML dashboard page reads satellite data through Starlette
routes in `dashboard.py`.

**Endpoints** (all defined in `dashboard/dashboard/dashboard.py`):

| Endpoint | Purpose |
|----------|---------|
| `/api/ml/status` | Engine status, db size, snapshot count, coins |
| `/api/ml/features?coin=BTC` | Latest feature snapshot |
| `/api/ml/snapshots/stats` | Per-coin counts, 24h counts, availability rates |
| `/api/ml/predictions?coin=BTC` | Latest prediction + SHAP |
| `/api/ml/predictions/history?coin=BTC&limit=50` | Prediction history |
| `/api/ml/model` | Model metadata |
| `/api/ml/satellite/toggle` | Enable/disable satellite at runtime (flag file) |

Dashboard opens a read-only SQLite connection to `satellite.db`.

---

## Flow 8: Dashboard ← Data-Layer (`/api/data/*` proxy)

**What**: Starlette proxy: `/api/data/{path:path}` → `http://localhost:8100/v1/{path}`.

**Code**: `dashboard.py:_data_proxy()` handles GET, POST, DELETE, PATCH via
`httpx.AsyncClient` with 10s timeout. Keeps port 8100 off the public
interface (blocked by UFW on the VPS).

Related proxies:
- `/api/data-health` → `http://localhost:8100/health`
- `/api/candles` → Hyperliquid API via `HyperliquidProvider.get_candles()`

---

## Flow 9: Trading Settings (Settings page → JSON → consumers)

**What**: The Settings page writes to `storage/trading_settings.json`
atomically (temp file + rename). Consumers lazy-load a cached singleton
via `get_trading_settings()`.

**Module**: `src/hynous/core/trading_settings.py`

**Read sites**:
- `daemon.py` — circuit breaker, TP protection, small-wins exits
- `src/hynous/intelligence/tools/trading.py` — trade validation
- `src/hynous/intelligence/prompts/builder.py` — threshold injection into prompts

---

## Flow 10: Provider ← Hyperliquid WebSocket

**What**: `MarketDataFeed` in `src/hynous/data/providers/ws_feeds.py`
maintains one WS connection to `wss://api.hyperliquid.xyz/ws` subscribing
to `allMids`, `l2Book` (per tracked coin), `activeAssetCtx` (per tracked
coin), and `candle` (1m + 5m per tracked coin). All four channels are
staleness-gated (30s) with REST fallback.

**Code path**:
1. Daemon calls `provider.start_ws(coins)` at startup
2. Handlers update atomic dicts/deques (`_prices`, `_l2_books`,
   `_asset_ctxs`, `_candle_windows`)
3. Provider read methods (`get_all_prices`, `get_l2_book`,
   `get_asset_context`, `get_multi_asset_contexts`) check WS cache first;
   if stale (>30s) fall through to REST
4. Candle data accessed directly by daemon's
   `_fetch_satellite_candles()` via `feed.get_candles()`

Not WS-fed (stays REST):
- `get_candles()` historical time-range queries (7d, 50h)
- `get_all_asset_contexts()` for scanner (200+ coin universe)
- All write operations (order placement, cancel, close)

---

## Summary: All Cross-System Boundaries

| # | Flow | Direction | Protocol | Frequency |
|---|------|-----------|----------|-----------|
| 1 | Daemon → Data-Layer | HTTP POST | `:8100/v1/historical/record` | Every 300s |
| 2 | Satellite ← Data-Layer DB | SQLite read-only | Direct file access | Every 300s |
| 3 | Daemon → Satellite tick + inference | Python call | `satellite.tick()` + `_run_satellite_inference()` | Every 300s |
| 4 | Daemon → Journal | In-process SQLite | `JournalStore` CRUD | Per lifecycle event |
| 5 | Journal → Analysis Agent | In-process thread | `trigger_analysis_async(trade_id)` | Per exit + hourly batch rejection |
| 6 | Dashboard ← Journal | HTTP router (in-process) | `/api/v2/journal/*` | On demand |
| 7 | Dashboard ← satellite.db | SQLite read-only | `/api/ml/*` | On demand |
| 8 | Dashboard ← Data-Layer | HTTP proxy | `/api/data/*` → `:8100` | On demand |
| 9 | Settings → JSON → consumers | File I/O | `trading_settings.json` | On save |
| 10 | Provider ← Hyperliquid WS | WebSocket | `ws_feeds.py` channels | Sub-second |

---

Last updated: 2026-04-12 (phase 7 M8 — integration refresh for v2)
