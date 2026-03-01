# Cross-System Data Flows

> Documents every data flow that crosses system boundaries in Hynous.
> These integrations are the most important undocumented relationships in the project.

---

## System Overview

```
  ┌──────────────────────────────────────────────────────────────┐
  │                    Dashboard (Reflex :3000)                  │
  │  /api/nous/*  /api/data/*  /api/ml/*  /api/candles          │
  └──────┬──────────┬──────────┬──────────────────────────────────┘
         │          │          │
         ▼          ▼          ▼
  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────────┐
  │  Nous    │ │Data-Layer│ │ satellite  │ │  Daemon          │
  │  :3100   │ │  :8100   │ │   .db      │ │  (background     │
  │  (TS)    │ │  (TS)    │ │  (SQLite)  │ │   thread)        │
  └──────────┘ └──────────┘ └───────────┘ └──────────────────┘
```

The daemon is the central orchestrator. It polls market data from Hyperliquid, pushes historical snapshots to the data-layer, feeds the satellite ML engine, wakes the agent, and coordinates with the dashboard and Discord bot. The following sections trace each data flow with source file references.

---

## Flow 1: Daemon --> Data-Layer (Pushing Historical Snapshots)

**What**: Every 300s (`deriv_poll_interval`), the daemon records funding, OI, and volume snapshots to the data-layer's historical tables via HTTP POST.

**Code path**:
1. `daemon.py:_poll_derivatives()` (line ~1042) calls `_record_historical_snapshots()`
2. `daemon.py:_record_historical_snapshots()` (line ~1190) reads from `self.snapshot.funding`, `self.snapshot.oi_usd`, `self.snapshot.volume_usd`
3. Calls `HynousDataClient.record_historical(funding, oi, volume)` from `src/hynous/data/providers/hynous_data.py`
4. HTTP POST to `http://127.0.0.1:8100/v1/historical/record`

**Guard**: Only runs if `config.data_layer.enabled` is true and `client.is_available`.

**Purpose**: Populates `oi_history`, `funding_history`, `volume_history` tables that satellite features query for rolling averages and z-scores.

```
  Daemon                    Data-Layer (:8100)
    │                            │
    │  POST /v1/historical/record│
    │  {funding, oi, volume}     │
    │ ─────────────────────────► │
    │                            │  INSERT INTO oi_history,
    │                            │  funding_history, volume_history
```

---

## Flow 2: Satellite <-- Data-Layer (Reading Historical Tables)

**What**: `satellite/features.py:compute_features()` reads from data-layer historical tables via a direct SQLite connection (read-only) for feature computation.

**Code path**:
1. `daemon.py` (line ~440) opens a read-only SQLite connection to `config.satellite.data_layer_db_path` (`data-layer/storage/hynous-data.db`)
2. Stored in `self._satellite_dl_conn` (read-only, `PRAGMA busy_timeout=3000`)
3. Wrapped in a `_DbAdapter` with `.conn` attribute (line ~1149)
4. Passed to `satellite.tick()` as `data_layer_db`
5. `features.py` executes SQL directly: `data_layer_db.conn.execute("SELECT AVG(oi_usd) FROM oi_history WHERE ...")` etc.

**Tables read**: `oi_history`, `funding_history`, `volume_history`, `liquidation_events`

**Features dependent on these tables**:
- `oi_vs_7d_avg_ratio` -- reads `oi_history` (7-day rolling average)
- `liq_cascade_active` + `liq_1h_vs_4h_avg` -- reads `liquidation_events` (1h and 4h windows)
- `funding_vs_30d_zscore` -- reads `funding_history` (30-day mean and std)
- `oi_funding_pressure` -- reads `oi_history` (1h lookback)
- `volume_vs_1h_avg_ratio` -- reads `volume_history` (1h rolling average)

```
  Satellite (features.py)            data-layer DB (SQLite, read-only)
    │                                    │
    │  SELECT AVG(oi_usd)                │
    │  FROM oi_history WHERE ...         │
    │ ──────────────────────────────────► │
    │                                    │
    │  SELECT rate                       │
    │  FROM funding_history WHERE ...    │
    │ ──────────────────────────────────► │
```

---

## Flow 3: Daemon --> Satellite (Calling tick())

**What**: After each `_poll_derivatives()` cycle (~300s), if satellite is enabled, the daemon calls `satellite.tick()` with the current market snapshot and data-layer connection.

**Code path**:
1. `daemon.py` (line ~1144) checks `if self._satellite_store:`
2. Creates `_HeatmapAdapter` and `_OrderFlowAdapter` wrappers around `HynousDataClient` (lines ~1166-1175)
3. Calls `satellite.tick(snapshot, data_layer_db, heatmap_engine, order_flow_engine, store, config)` (line ~1179)
4. `satellite/__init__.py:tick()` iterates over configured coins, calls `compute_features()` for each, writes results via `store.save_snapshot(result)`

**Data passed in**:
- `snapshot` -- daemon's `MarketSnapshot` (prices, funding, OI, volume)
- `data_layer_db` -- read-only SQLite connection to data-layer DB (wrapped in `_DbAdapter`)
- `heatmap_engine` -- adapter calling `HynousDataClient.heatmap(coin)` via HTTP to `:8100`
- `order_flow_engine` -- adapter calling `HynousDataClient.order_flow(coin)` via HTTP to `:8100`

**Config**: `satellite.enabled`, `satellite.coins`, `satellite.db_path`, `satellite.data_layer_db_path` in `config/default.yaml`

**Runtime toggle**: Dashboard can enable/disable satellite at runtime via `POST /api/ml/satellite/toggle`, which writes a flag file at `storage/.satellite_toggle` that the daemon checks each loop iteration.

```
  Daemon                          Satellite
    │                                │
    │  satellite.tick(               │
    │    snapshot,                   │
    │    data_layer_db,              │
    │    heatmap_engine,             │
    │    order_flow_engine,          │
    │    store, config               │
    │  )                             │
    │ ─────────────────────────────► │
    │                                │  compute_features() x N coins
    │                                │  store.save_snapshot()
    │                                │  writes to satellite.db
```

---

## Flow 4: Satellite --> satellite.db (Writing Snapshots)

**What**: `SatelliteStore.save_snapshot()` writes computed feature vectors to `storage/satellite.db`.

**Code path**:
1. `satellite/features.py:compute_features()` returns a `FeatureResult` with 12 features + 9 availability flags
2. `satellite/__init__.py:tick()` calls `store.save_snapshot(result)`
3. `SatelliteStore` (in `satellite/store.py`) inserts into the `snapshots` table

**12 features stored**: `liq_magnet_direction`, `oi_vs_7d_avg_ratio`, `liq_cascade_active`, `liq_1h_vs_4h_avg`, `funding_vs_30d_zscore`, `hours_to_funding`, `oi_funding_pressure`, `cvd_normalized_5m`, `price_change_5m_pct`, `volume_vs_1h_avg_ratio`, `realized_vol_1h`, `sessions_overlapping`

**Schema version**: `SCHEMA_VERSION = 1` (in `satellite/__init__.py`), verified via `FEATURE_HASH` (SHA-256 of feature name list).

---

## Flow 5: Dashboard <-- Satellite DB (Reading via /api/ml/* Endpoints)

**What**: The ML dashboard page reads satellite data through custom Starlette API endpoints added in `dashboard.py`.

**Endpoints** (all defined in `dashboard/dashboard/dashboard.py`):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ml/status` | GET | Satellite engine status: enabled, db size, snapshot count, coins |
| `/api/ml/features?coin=BTC` | GET | Latest feature snapshot for a coin (all 12 features + avail flags) |
| `/api/ml/snapshots/stats` | GET | Per-coin counts, 24h counts, feature availability rates |
| `/api/ml/predictions?coin=BTC` | GET | Latest model prediction + SHAP explanations |
| `/api/ml/model` | GET | Model metadata from `artifacts/` directory |
| `/api/ml/satellite/toggle` | POST | Enable/disable satellite at runtime (writes flag file) |

**Data path**: Dashboard opens a read-only SQLite connection to `satellite.db` (path from `config.satellite.db_path`), runs SQL queries, returns JSON.

```
  Browser                Dashboard (:3000)           satellite.db
    │                        │                           │
    │  GET /api/ml/features  │                           │
    │ ─────────────────────► │  sqlite3.connect(ro)      │
    │                        │ ────────────────────────►  │
    │                        │  SELECT * FROM snapshots   │
    │   ◄───── JSON ──────── │  ◄──────── row ────────── │
```

---

## Flow 6: Dashboard <-- Data-Layer (Reading via /api/data/* Proxy)

**What**: The dashboard proxies all data-layer requests through Starlette routes to avoid exposing port 8100 to the browser (blocked by UFW on VPS).

**Code path**:
1. `dashboard.py:_data_proxy()` (line ~299) handles all methods: GET, POST, DELETE, PATCH
2. Routes: `/api/data/{path:path}` --> `http://localhost:8100/v1/{path}`
3. Uses `httpx.AsyncClient` with 10s timeout

**Similarly for Nous**: `/api/nous/{path:path}` --> `http://localhost:3100/v1/{path}` (GET only)

**Additional proxies**:
- `/api/data-health` --> `http://localhost:8100/health`
- `/api/candles` --> Hyperliquid API via `HyperliquidProvider.get_candles()`

```
  Browser              Dashboard (:3000)          Data-Layer (:8100)
    │                      │                           │
    │ GET /api/data/stats  │                           │
    │ ───────────────────► │  httpx.get(:8100/v1/stats)│
    │                      │ ────────────────────────► │
    │  ◄──── JSON ──────── │  ◄──────── JSON ──────── │
```

---

## Flow 7: Agent --> Data-Layer (via data_layer Tool)

**What**: The agent can query data-layer signals on-demand through the `data_layer` tool.

**Code path**:
1. Agent calls `data_layer` tool with action + parameters
2. `src/hynous/intelligence/tools/data_layer.py` handles the tool call
3. Calls methods on `HynousDataClient` singleton (`src/hynous/data/providers/hynous_data.py`)
4. HTTP requests to `http://127.0.0.1:8100/v1/*`

**Available actions**: `heatmap`, `orderflow`, `whales`, `hlp`, `smart_money`, `track_wallet`, `untrack_wallet`, `watchlist`, `wallet_profile`, `relabel_wallet`, `wallet_alerts`, `analyze_wallet`

**Config**: `data_layer.url`, `data_layer.enabled`, `data_layer.timeout` in `config/default.yaml`

---

## Flow 8: Context Snapshot <-- Multiple Sources

**What**: Every `agent.chat()` call injects a `[Live State]` snapshot (~150 tokens) built from multiple data sources. Cached for 30 seconds.

**Module**: `src/hynous/intelligence/context_snapshot.py:build_snapshot()`

**Data sources** (all zero or low cost):

| Section | Source | Cost |
|---------|--------|------|
| Portfolio + Positions | `provider.get_user_state()` | 1 HTTP call (~50ms) |
| SL/TP orders | `provider.get_trigger_orders()` | 1 HTTP call per position |
| Market data | `daemon.snapshot` (cached prices, funding, fear/greed) | Zero (in-memory) |
| Daily PnL + circuit breaker | `daemon._daily_realized_pnl`, `daemon._trading_paused` | Zero (in-memory) |
| Regime classification | `daemon._regime` | Zero (in-memory) |
| Memory counts | `daemon` cached counts, fallback to `nous.list_nodes()` | Zero or 1 HTTP |
| Trade activity | `daemon` in-memory counters (wakes, scanner wakes) | Zero |
| Data layer signals | `HynousDataClient.hlp_positions()`, `.order_flow()` | 2-6 HTTP calls |

**Invalidation**: `invalidate_snapshot()` is called after trades (`execute_trade`, `close_position`, `modify_position`) to force a fresh snapshot on the next message.

```
  Provider (HL)    Daemon cache    Nous (:3100)    Data-Layer (:8100)
       │                │               │                │
       └──── portfolio ─┤               │                │
                        ├── prices ─────┤                │
                        ├── regime ─────┤                │
                        ├── counts ─────┘                │
                        ├── HLP ─────────────────────────┘
                        ├── CVD ─────────────────────────┘
                        ▼
               context_snapshot.py
               build_snapshot()
                        │
                        ▼
               "[Live State]" text
               injected into agent.chat()
```

---

## Flow 9: Trading Settings (Settings Page --> JSON --> Daemon/Agent/Prompt)

**What**: The Settings page writes to `storage/trading_settings.json`, which is read by the daemon, agent tools, and prompt builder at runtime.

**Module**: `src/hynous/core/trading_settings.py`

**Write path**:
1. User edits settings on the Settings dashboard page
2. `dashboard/dashboard/state.py:save_settings()` (line ~3293) constructs a `TradingSettings` dataclass
3. Calls `save_trading_settings(ts)` -- atomic write to `storage/trading_settings.json`
4. Calls `_apply_trading_settings(ts)` -- updates Reflex state variables for live UI sync

**Read paths** (all call `get_trading_settings()` -- lazy-loaded, cached singleton):
- `daemon.py` (line ~34, ~1608, ~2114, ~2145) -- circuit breaker, small-wins exits, TP protection
- `src/hynous/intelligence/tools/trading.py` (line ~509) -- trade validation (SL/TP limits, R:R checks, leverage caps)
- `src/hynous/intelligence/prompts/builder.py` (line ~107) -- injects thresholds into the system prompt so the agent knows its limits

**Settings categories**: Macro/micro SL/TP ranges, leverage limits, risk management (R:R floor, portfolio risk cap, ROE limits), conviction sizing tiers, fee structure, position limits, scanner thresholds, smart money filters, small-wins mode.

```
  Settings Page            trading_settings.json         Consumers
       │                          │                          │
       │  save_trading_settings() │                          │
       │ ───────────────────────► │                          │
       │                          │  get_trading_settings()  │
       │                          │ ◄──────── daemon.py ─────┤
       │                          │ ◄──────── trading.py ────┤
       │                          │ ◄──────── builder.py ────┤
```

---

## Flow 10: Discord Bot <--> Agent (Shared Singleton, Notification Flow)

**What**: The Discord bot shares the same `Agent` singleton as the dashboard. It relays user messages to `agent.chat()` and receives daemon notifications via thread-safe module-level functions.

**Module**: `src/hynous/discord/bot.py`

**Startup**:
1. `start_bot(agent, config)` (line ~239) creates a `HynousDiscordBot` with the same `agent` instance
2. Runs in a background daemon thread with its own asyncio event loop (`asyncio.new_event_loop()`)

**Chat relay** (Discord --> Agent):
1. User sends message in configured channel or DM
2. `on_message()` filters by `allowed_user_ids` and `channel_id`
3. Prefixes with `[{sender} via Discord]` for attribution
4. Calls `asyncio.to_thread(self.agent.chat, prefixed)` (shares the agent's `_chat_lock`)
5. Response sent back chunked (2000 char Discord limit)

**Daemon notifications** (Daemon --> Discord):
1. Daemon calls `_notify_discord(wake_type, title, response)` or `_notify_discord_simple(message)` (daemon.py lines ~60-76)
2. These import `notify()` / `notify_simple()` from `src/hynous/discord/bot.py`
3. `notify()` uses `asyncio.run_coroutine_threadsafe()` to schedule on the Discord bot's event loop
4. `send_notification()` posts to the configured channel with formatted header

**Notification types** (all called from daemon.py):
- Fill notifications (position opens/closes)
- Watchpoint triggers
- Scanner anomalies
- Phantom tracking results
- Periodic reviews
- Learning sessions
- Profit protection exits

**Stats panel**: `!stats` command posts a live-updating embed in the stats channel, auto-refreshed by a `discord.ext.tasks` loop.

```
  Discord User          Discord Bot           Agent (shared)        Daemon
       │                    │                      │                   │
       │  "Analyze BTC"     │                      │                   │
       │ ─────────────────► │  agent.chat()        │                   │
       │                    │ ───────────────────►  │                   │
       │  ◄── response ──── │  ◄── response ────── │                   │
       │                    │                      │                   │
       │                    │                      │   _notify_discord()│
       │  ◄── notification ─│  ◄── notify() ───────│──────────────────┘│
```

---

## Summary: All Cross-System Boundaries

| # | Flow | Direction | Protocol | Frequency |
|---|------|-----------|----------|-----------|
| 1 | Daemon --> Data-Layer | HTTP POST | `:8100/v1/historical/record` | Every 300s |
| 2 | Satellite <-- Data-Layer DB | SQLite read-only | Direct file access | Every 300s |
| 3 | Daemon --> Satellite | Python function call | `satellite.tick()` | Every 300s |
| 4 | Satellite --> satellite.db | SQLite write | `store.save_snapshot()` | Every 300s |
| 5 | Dashboard <-- satellite.db | SQLite read-only | `/api/ml/*` endpoints | On page load |
| 6 | Dashboard <-- Data-Layer | HTTP proxy | `/api/data/*` --> `:8100` | On demand |
| 7 | Agent --> Data-Layer | HTTP via tool | `data_layer` tool --> `:8100` | On demand |
| 8 | Context Snapshot <-- multiple | Mixed (HTTP, in-memory) | `build_snapshot()` | Every `chat()` call |
| 9 | Settings Page --> JSON --> consumers | File I/O | `trading_settings.json` | On save |
| 10 | Discord Bot <--> Agent | Shared Python singleton | `agent.chat()` + `notify()` | On message / wake |

---

Last updated: 2026-03-01
