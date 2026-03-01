# Documentation Audit — Hynous

> Full audit of documentation gaps, stale content, and missing context across the Hynous project.
> Performed 2026-03-01 against commit `e39e2b7`.

---

## Table of Contents

1. [Overview](#overview)
2. [HIGH — Actively Misleading Documentation](#high--actively-misleading-documentation)
   - [H1: ARCHITECTURE.md — Missing 2 Subsystems, Wrong Provider List, Stale Counts](#h1-architecturemd)
   - [H2: MEMORY.md — Same Gaps as Architecture](#h2-memorymd)
   - [H3: src/hynous/data/README.md — Lists Providers That Don't Exist](#h3-srchynousdatareadmemd)
   - [H4: scripts/README.md — References Nonexistent File](#h4-scriptsreadmemd)
3. [MEDIUM — Missing Context That Causes Confusion](#medium--missing-context-that-causes-confusion)
   - [M1: satellite/ — Zero Documentation (5,000+ Lines)](#m1-satellite--zero-documentation)
   - [M2: data-layer/ — Zero Documentation (Entire Service)](#m2-data-layer--zero-documentation)
   - [M3: dashboard/README.md — Missing 5 Pages, 3 Assets, API Proxies](#m3-dashboardreadmemd)
   - [M4: deploy/README.md — Missing 3rd Service](#m4-deployreadmemd)
   - [M5: config/README.md — Missing 5 Config Sections](#m5-configreadmemd)
   - [M6: intelligence/tools/README.md — Missing 3 Tool Modules](#m6-intelligencetoolsreadmemd)
   - [M7: intelligence/README.md — Stale Tool Count](#m7-intelligencereadmemd)
   - [M8: Satellite ↔ Data-Layer ↔ Daemon Relationship — Undocumented](#m8-satellite--data-layer--daemon-relationship)
   - [M9: src/hynous/discord/ — No README](#m9-srchynousdiscord--no-readme)
   - [M10: src/hynous/ Root — No README](#m10-srchynous-root--no-readme)
4. [LOW — Incomplete but Not Misleading](#low--incomplete-but-not-misleading)
   - [L1: revisions/ — 38 Historical Files, All Complete](#l1-revisions--38-historical-files)
   - [L2: docs/README.md — References Nonexistent Documents](#l2-docsreadmemd)
   - [L3: nous-server/README.md — Stale Structure and Counts](#l3-nous-serverreadmemd)
   - [L4: tests/README.md — Missing Satellite and Data-Layer Tests](#l4-testsreadmemd)
   - [L5: intelligence/prompts/README.md — Oversimplified](#l5-intelligencepromptsreadmemd)
   - [L6: Duplicate "Known Issues" Across 7 Files](#l6-duplicate-known-issues)
   - [L7: No CLAUDE.md in Project Root](#l7-no-claudemd-in-project-root)
5. [Missing READMEs — Full Inventory](#missing-readmes--full-inventory)
6. [Appendix: Actual File Inventories](#appendix-actual-file-inventories)

---

## Overview

The Hynous project has grown significantly — two entire new subsystems (`satellite/` and `data-layer/`), 5 new dashboard pages, 3+ new agent tools, 5 new data providers, a Discord bot, and a major daemon expansion — but the documentation has not kept pace. An AI agent reading the current docs would build a fundamentally incomplete mental model of the system.

**By the numbers:**
- 14 directories have no README
- 8 existing READMEs contain stale or wrong information
- 2 entire subsystems (~8,000 lines combined) have zero documentation
- The architecture diagram is missing ~40% of the actual system

---

## HIGH — Actively Misleading Documentation

These documents contain information that is factually wrong and would cause an agent to make incorrect assumptions about the codebase.

---

### H1: ARCHITECTURE.md

**File:** `/ARCHITECTURE.md`
**Problem:** Missing 2 entire subsystems, wrong provider list, stale counts, incomplete diagrams.

**What's wrong:**

1. **Architecture diagram (lines 9-71) is missing two services:**
   - `data-layer/` — a standalone FastAPI service running on `:8100` that continuously collects and processes Hyperliquid market microstructure data. It has its own collectors (trade stream, L2 subscriber, position poller, HLP tracker), engines (liquidation heatmap, order flow, whale tracker, smart money, profiler, position change tracker), REST API with 20+ endpoints, and its own SQLite database (`hynous-data.db`). It runs as the third systemd service (`hynous-data.service`).
   - `satellite/` — an ML feature engineering and model training pipeline that computes 12 structural features from market data every 300 seconds, trains separate long/short XGBoost regressors, provides live inference with SHAP explanations, and includes a kill switch with 5 auto-disable conditions. It includes the Artemis sub-module for historical data reconstruction from S3, a walk-forward validation pipeline, and its own SQLite database (`satellite.db`).

2. **Dashboard pages list (line 13) only shows 5 of 10 actual pages:**
   - Listed: Home, Chat, Memory, Graph, Debug
   - Missing: Journal (`/journal`), Data (`/data`), ML (`/ml`), Settings (`/settings`), Login (`/login`)

3. **Dashboard assets (line 147) only mentions `graph.html`:**
   - Missing: `brain.html` (memory brain visualization), `ml.html` (ML feature monitoring dashboard), `data.html` (data layer visualization), `hynous-avatar.png`

4. **Dashboard components (line 145) only mentions 3 of 4:**
   - Missing: `ticker.py` (live ticker component)

5. **Component table — tools count (line 85) says "18 modules, 25 tools":**
   - Actual: 21 tool modules providing 25 registered tools
   - Missing from table: `data_layer.py` (13+ actions for hynous-data signals), `market_watch.py` (get_book_history, monitor_signal), `pruning.py` (analyze_memory, batch_prune)

6. **Data providers list (lines 111-120) is wrong:**
   - Lists: `hyperliquid.py`, `binance.py`, `cryptoquant.py`
   - **`binance.py` does not exist.** There is no Binance provider file.
   - **`cryptoquant.py` does not exist.** There is no CryptoQuant provider file.
   - Actual providers: `hyperliquid.py`, `paper.py`, `coinglass.py`, `cryptocompare.py`, `hynous_data.py`, `perplexity.py`

7. **Missing components from the component tables:**
   - `context_snapshot.py` — builds ~150-token live state snapshot (portfolio, positions with MFE/MAE, prices, regime, memory counts) injected into every agent message
   - `regime.py` — hybrid macro/micro dual-scoring regime detection
   - `wake_warnings.py` — code-based daemon wake warnings
   - `trading_settings.py` — runtime-adjustable trading parameters
   - `daemon_log.py` — persistent daemon event logging (referenced in core/README.md but not in ARCHITECTURE.md)
   - Discord bot (`src/hynous/discord/bot.py`) — chat relay, daemon notifications, stats panel

8. **Daemon wake flow (lines 196-216) is incomplete:**
   - Missing: consolidation cycle, fading memory alerts, playbook matching, satellite tick, data-layer historical recording push, pending watch triggers, small wins auto-exit, peak profit protection, breakeven stop management, daily circuit breaker

9. **Config section (lines 296-305) is stale:**
   - Says config files are `default.yaml`, `theme.yaml`, `tools.yaml (future)`
   - Missing: satellite config section, scanner L2/news config, data_layer config, discord config, sections config — all exist in `default.yaml`

10. **Testing section (lines 310-324) is stale:**
    - Does not mention `satellite/tests/` (6 test files) or `data-layer/tests/` (5 test files)
    - Does not list the actual current test files

11. **"For Future Agents" section says "All revisions complete":**
    - While revisions are complete, the architecture has grown far beyond what the doc describes. An agent reading this would not know about satellite, data-layer, Discord, or half the dashboard pages.

---

### H2: MEMORY.md

**File:** `~/.claude/projects/-Users-bauthoi-Documents-Hynous/memory/MEMORY.md`
**Problem:** The agent's persistent memory is missing all new systems from the latest development cycle.

**What's wrong:**

1. **Architecture section says "4 layers":**
   - Actual: 5+ components. The data-layer service (`:8100`) is a separate standalone service not mentioned anywhere.

2. **Key Directories section is incomplete:**
   - Lists `src/hynous/data/` as having "hyperliquid, binance, cryptoquant" — Binance and CryptoQuant provider files **do not exist**
   - Missing: `satellite/` directory (ML engine), `data-layer/` directory (data collection service), `src/hynous/discord/` (Discord bot)

3. **Entirely missing:**
   - Satellite module — features, inference, training, Artemis, safety, all undocumented
   - Data-layer service — collectors, engines, API, database, all undocumented
   - New dashboard pages — Journal, Data, ML, Settings, Login
   - New tools — `data_layer` (13+ actions), `market_watch` (get_book_history, monitor_signal)
   - New data providers — `paper.py`, `coinglass.py`, `cryptocompare.py`, `hynous_data.py`, `perplexity.py`
   - Scanner L2/news capabilities — BookSnapshot, book flip detector, momentum burst, news polling
   - `regime.py` — regime detection module
   - `wake_warnings.py` — daemon wake warnings
   - `context_snapshot.py` — live state snapshot injection
   - `trading_settings.py` — runtime-adjustable trading parameters and settings page
   - Dashboard API endpoints — `/api/ml/*`, `/api/data/*` proxy
   - Standalone HTML pages — `brain.html`, `ml.html`, `data.html`
   - Login/auth system in dashboard
   - `ticker.py` component

4. **Extension Patterns section is incomplete:**
   - Only covers tools, pages, data sources, node types
   - Missing patterns for: adding to data-layer, satellite features, Discord commands

---

### H3: src/hynous/data/README.md

**File:** `src/hynous/data/README.md`
**Problem:** Lists providers that don't exist, omits providers that do, shows fictional interface.

**What's wrong:**

1. **Provider list (lines 22-28) is entirely wrong:**
   ```
   Actual files in src/hynous/data/providers/:
     __init__.py
     coinglass.py      ← NOT in README
     cryptocompare.py   ← NOT in README
     hynous_data.py     ← NOT in README
     hyperliquid.py     ← In README ✓
     paper.py           ← NOT in README
     perplexity.py      ← NOT in README

   README claims exist:
     binance.py         ← DOES NOT EXIST
     cryptoquant.py     ← DOES NOT EXIST
   ```

2. **`BaseProvider` interface shown on lines 33-38 is fictional:**
   - No `BaseProvider` class exists in the codebase
   - Each provider has its own interface (HyperliquidProvider is a class with different methods; PaperProvider wraps it; HynousDataClient is an HTTP wrapper; others are standalone)

3. **No mention of the data-layer service:**
   - `hynous_data.py` is a Python HTTP client that bridges to the `data-layer/` service on `:8100`
   - This relationship is completely absent

4. **No mention of paper trading provider:**
   - `paper.py` is a drop-in replacement for HyperliquidProvider that simulates trades using mainnet prices — critical for Phase 4 paper trading

---

### H4: scripts/README.md

**File:** `scripts/README.md`
**Problem:** References a file that doesn't exist, missing two new scripts.

**What's wrong:**

1. **Lists `run_daemon.py` in the main entry points table (line 12):**
   - `run_daemon.py` does not exist in the `scripts/` directory
   - Actual files in `scripts/`: `__init__.py`, `run_dashboard.py`, `artemis_sync.sh`, `backup_satellite.sh`

2. **Missing `artemis_sync.sh`:**
   - Daily cron script that processes yesterday's Artemis data (perp balances, node fills) into feature snapshots via `satellite.artemis.pipeline.process_single_day()`
   - Reports metrics: address count, snapshot count, elapsed time
   - Designed to run at 1 AM UTC via cron

3. **Missing `backup_satellite.sh`:**
   - Daily backup of `satellite.db` and `hynous-data.db` using SQLite's online `.backup` command (WAL-safe)
   - 7-day local retention with optional Sunday remote sync via `scp`
   - Zero-downtime, atomic backups

---

## MEDIUM — Missing Context That Causes Confusion

These are cases where documentation is absent or significantly incomplete. An agent would have to read raw code to understand these systems.

---

### M1: satellite/ — Zero Documentation

**Directories affected:** `satellite/`, `satellite/artemis/`, `satellite/training/`, `satellite/tests/`
**Problem:** ~5,000 lines of code across 22 files with no README at any level.

**What needs to be documented:**

1. **Module purpose:** ML feature engineering and model training pipeline for predicting trade entry quality using XGBoost. Computes 12 structural features from market data every 300 seconds.

2. **The 12 structural features** (grouped by mechanism):
   - **Liquidation (4):** liq_magnet_direction, oi_vs_7d_avg_ratio, liq_cascade_active, liq_1h_vs_4h_avg
   - **Funding (3):** funding_vs_30d_zscore, hours_to_funding, oi_funding_pressure
   - **Momentum (3):** cvd_normalized_5m, price_change_5m_pct, volume_vs_1h_avg_ratio
   - **Context (2):** realized_vol_1h, sessions_overlapping
   - Plus 9 availability flags (binary inputs indicating data quality)

3. **Normalization types** (5 transform types per SPEC-04):
   - P (passthrough), C (clip only), Z (z-score), L (log + z), S (signed log + z)
   - Scaler fitted on training partition only, sealed forever

4. **Artemis sub-module** (`satellite/artemis/`):
   - Historical reconstruction from Artemis S3 data (perp balances, node fills) + Hyperliquid API
   - `pipeline.py` — daily processing: download → extract OI/liquidations/volume → reconstruct features → label
   - `reconstruct.py` — builds synthetic snapshots for `compute_features()` compatibility
   - `profiler.py` — wallet profiling (FIFO trade matching → PnL, win rate, profit factor, style, bot detection)
   - `seeder.py` — address discovery into data-layer addresses table
   - `layer2.py` — co-occurrence data collection for future smart money ML

5. **Training pipeline** (`satellite/training/`):
   - `pipeline.py` — data loading with time-based splits (never random), scaler fitting on train only
   - `train.py` — XGBoost with `reg:pseudohubererror`, MAE eval, early stopping at 10 rounds
   - `walkforward.py` — expanding-window validation across market regimes
   - `artifact.py` — sealed model containers (model_long, model_short, scaler, metadata) with feature hash verification
   - `explain.py` — SHAP TreeExplainer integration (~100us overhead per prediction)

6. **Inference** (`satellite/inference.py`):
   - `InferenceEngine.predict()` → signal (long/short/skip/conflict), predicted ROE, SHAP top-5, confidence
   - Dual model approach: separate long/short models because entry conditions differ directionally

7. **Safety** (`satellite/safety.py`):
   - Kill switch with 5 auto-disable triggers: manual, cumulative loss > -15%, 5 consecutive losses, precision collapse, data staleness > 900s
   - State persisted in `satellite_metadata` table

8. **Storage** (`satellite/schema.py`, `satellite/store.py`):
   - `satellite.db` — SQLite with WAL, 9 tables (snapshots, raw_snapshots, cvd_windows, snapshot_labels, simulated_exits, predictions, co_occurrences, satellite_metadata, plus schema version)

9. **Labeling** (`satellite/labeler.py`):
   - Async outcome measurement: entry at close price, windows 15m/30m/1h/4h, fee-adjusted ROE
   - Simulated exit generation for Model B bootstrap (~5,184 rows/day/3 coins)

10. **Monitoring** (`satellite/monitor.py`):
    - Daily health reports: snapshot pipeline, model performance, feature integrity, system health

11. **Tests** (`satellite/tests/`):
    - 6 test files: test_artemis, test_features, test_labeler, test_normalize, test_safety, test_training

---

### M2: data-layer/ — Zero Documentation

**Directories affected:** `data-layer/`, `data-layer/src/hynous_data/`, all subdirectories
**Problem:** An entire standalone service with no README anywhere.

**What needs to be documented:**

1. **Service overview:** Standalone FastAPI service on `:8100` that continuously collects and processes Hyperliquid market microstructure data. Runs as its own systemd service (`hynous-data.service`). Own database (`hynous-data.db`).

2. **Collectors** (`data-layer/src/hynous_data/collectors/`):
   - `trade_stream.py` — WebSocket subscriber for ALL Hyperliquid trades. Extracts addresses, buffers 50K trades/coin. Powers order flow and address discovery.
   - `l2_subscriber.py` — WebSocket subscriber for L2 orderbook (100 levels/side). Zero REST weight. Powers scanner micro-signal detectors.
   - `position_poller.py` — Periodic polling of positions for tracked addresses.
   - `hlp_tracker.py` — HLP vault position tracking.

3. **Engines** (`data-layer/src/hynous_data/engine/`):
   - `liq_heatmap.py` — Liquidation heatmap computation from position data
   - `order_flow.py` — Buy/sell CVD aggregation across multiple time windows
   - `whale_tracker.py` — Large position tracking and monitoring
   - `smart_money.py` — Profitable trader ranking and curation
   - `profiler.py` — Wallet profiling (win rate, trade count, profit factor, style classification)
   - `position_tracker.py` — Position change detection and alerting

4. **API** (`data-layer/src/hynous_data/api/`):
   - `app.py` — FastAPI application setup
   - `routes.py` — 20+ REST endpoints:
     - `/v1/heatmap/{coin}` — liquidation heatmap data
     - `/v1/hlp/positions`, `/v1/hlp/sentiment` — HLP vault data
     - `/v1/orderflow/{coin}` — CVD windows (5m, 1h, 4h, 1d)
     - `/v1/whales/{coin}` — top 50 positions, net bias
     - `/v1/smart-money` — profitable trader ranking
     - `/v1/smart-money/watchlist` — tracked wallets
     - `/v1/smart-money/wallet/{address}/trades` — wallet trade history
     - `/v1/smart-money/wallet/{address}/changes` — position changes
     - `/v1/historical/record` — batch record funding/OI/volume
     - `/v1/stats` — database health
     - Plus wallet alert CRUD endpoints

5. **Database** (`data-layer/src/hynous_data/core/db.py`):
   - Tables: addresses, positions, hlp_snapshots, pnl_snapshots, watched_wallets, wallet_profiles, wallet_trades, position_changes, funding_history, oi_history, liquidation_events, volume_history

6. **Configuration** (`data-layer/src/hynous_data/core/config.py`):
   - Service-specific config including tracked coins, polling intervals, API keys

7. **Tests** (`data-layer/tests/`):
   - 5 test files: test_historical_tables, test_liq_heatmap, test_order_flow, test_rate_limiter, test_smoke

8. **Integration points:**
   - Daemon pushes historical snapshots via `POST /v1/historical/record`
   - Satellite reads historical tables via direct SQLite access to `hynous-data.db`
   - Agent accesses via `hynous_data.py` provider and `data_layer` tool
   - Dashboard proxies `/api/data/*` to `:8100`

---

### M3: dashboard/README.md

**File:** `dashboard/README.md`
**Problem:** Missing 5 pages, 3 assets, API proxies, and several components.

**What's wrong:**

1. **Pages list only shows 5 of 10:**
   - Listed: Home, Chat, Memory, Graph, Debug
   - Missing: Journal (`/journal` — trade journal with phantom tracker and playbook tracker tabs), Data (`/data` — data layer visualization), ML (`/ml` — satellite feature monitoring + predictions), Settings (`/settings` — live-edit all 28+ trading parameters), Login (`/login` — authentication)

2. **Directory structure (lines 23-40) is missing:**
   - `pages/journal.py`, `pages/data.py`, `pages/ml.py`, `pages/settings.py`, `pages/login.py`
   - `assets/brain.html`, `assets/ml.html`, `assets/data.html`, `assets/hynous-avatar.png`
   - `components/ticker.py`

3. **API proxy section (lines 123-131) only documents the Nous proxy:**
   - Missing: `/api/data/*` proxy to `:8100` (data-layer service)
   - Missing: `/api/ml/*` endpoints (6 endpoints served directly from `dashboard.py` reading `satellite.db`)

4. **Memory page description (lines 58-61) is stale:**
   - Does not mention the "Sections" tab, `brain.html` iframe, or tab switching between graph and brain views

---

### M4: deploy/README.md

**File:** `deploy/README.md`
**Problem:** Missing 3rd service, missing env vars.

**What's wrong:**

1. **Service table (lines 29-32) only lists 2 services:**
   ```
   Listed: nous (port 3100), hynous (port 3000)
   Missing: hynous-data (port 8100)
   ```
   The file `deploy/hynous-data.service` exists in the deploy directory but is not mentioned in the README.

2. **Environment variables (lines 19-21) are incomplete:**
   - Missing: `OPENAI_API_KEY` — required for Nous vector embeddings on VPS
   - Missing: `CRYPTOCOMPARE_API_KEY` — required for news polling in scanner
   - `DISCORD_BOT_TOKEN` is listed but not in the env section

3. **No mention of satellite dependencies:**
   - `satellite/` requires `xgboost`, `numpy`, `shap` — should be noted for VPS setup

---

### M5: config/README.md

**File:** `config/README.md`
**Problem:** Missing 5 config sections from `default.yaml`.

**What's wrong:**

1. **Orchestrator config is documented (lines 58-73) — good.**

2. **Missing `satellite:` section:** Controls ML feature engine — `enabled`, `feature_coins`, cascade detection thresholds, funding settlement hours, tick interval.

3. **Missing `scanner:` expansion:** `default.yaml` now has L2 orderbook polling config (`book_poll_enabled`, `book_imbalance_flip_pct`, `momentum_5m_pct`, `momentum_volume_mult`, `position_adverse_threshold`) and news config (`news_poll_enabled`, `news_wake_max_age_minutes`).

4. **Missing `data_layer:` section:** URL, timeout, and tracked coins for the data-layer service.

5. **Missing `discord:` section:** `enabled`, `channel_id`, `stats_channel_id`, `allowed_user_ids`.

6. **Missing `sections:` section:** `intent_boost` multiplier, default section fallback for memory sections.

7. **Environment variables (lines 22-26) are incomplete:**
   - Missing: `OPENAI_API_KEY` (Nous embeddings)
   - Missing: `CRYPTOCOMPARE_API_KEY` (scanner news)

---

### M6: intelligence/tools/README.md

**File:** `src/hynous/intelligence/tools/README.md`
**Problem:** Tool table missing 3 modules, count is stale.

**What's wrong:**

1. **Header (line 3) says "17 tool modules, 23 registered tools":**
   - Actual: 21 tool modules, 25 registered tools (per `registry.py`)

2. **Tool table (lines 9-28) is missing 3 modules:**
   - `data_layer.py` — `get_data_layer_feature` tool with 13+ actions: heatmap, orderflow, whales, hlp, smart_money, track_wallet, untrack_wallet, watchlist, wallet_profile, relabel_wallet, wallet_alerts, analyze_wallet
   - `market_watch.py` — 2 tools: `get_book_history` (L2 orderbook imbalance trend from scanner buffer), `monitor_signal` (schedule 30-180s follow-up wake on developing setup)
   - `pruning.py` — 2 tools: `analyze_memory` (scan graph, score staleness), `batch_prune` (archive/delete in bulk)

---

### M7: intelligence/README.md

**File:** `src/hynous/intelligence/README.md`
**Problem:** Stale tool count in directory structure.

**What's wrong:**

1. **Line 27 says:** `tools/ # Tool definitions (17 modules, 23 tools — see tools/README.md)`
   - Actual: 21 modules, 25 tools

2. **Module listing may be incomplete** — should be verified against actual files in the directory (e.g., missing `regime.py`, `wake_warnings.py` mentions)

---

### M8: Satellite ↔ Data-Layer ↔ Daemon Relationship

**File:** None — this relationship is documented nowhere.
**Problem:** The three-way integration between these systems is critical to understanding the live data flow but is completely undocumented.

**What needs to be documented:**

1. **Daemon → Data-Layer:** After each `_poll_derivatives()` cycle, daemon pushes funding/OI/volume snapshots to `POST /v1/historical/record` on the data-layer service. This populates historical tables used by satellite.

2. **Satellite ← Data-Layer:** `satellite.features.compute_features()` reads from data-layer's SQLite tables (`oi_history`, `funding_history`, `liquidation_events`, `volume_history`) for historical averages and z-scores. Uses direct SQLite read access (not HTTP).

3. **Daemon → Satellite:** After derivatives polling, daemon calls `satellite.tick(snapshot, data_layer_db, heatmap_engine, order_flow_engine, store, config)` to compute features and optionally run inference.

4. **Satellite → Its Own DB:** Writes feature snapshots, predictions, and metadata to `satellite.db`.

5. **Dashboard ← Satellite DB:** ML page reads from `satellite.db` via `/api/ml/*` endpoints defined in `dashboard.py`.

6. **Dashboard ← Data-Layer:** Data page reads from data-layer via `/api/data/*` proxy to `:8100`.

**Data flow diagram needed:**
```
Daemon._poll_derivatives()
    │
    ├──► POST /v1/historical/record → data-layer → hynous-data.db
    │                                                    │
    ├──► satellite.tick(snapshot, db_path, ...)          │
    │       │                                            │
    │       ├── compute_features() ◄── reads ────────────┘
    │       │       (12 features from market data + historical tables)
    │       │
    │       ├── store.save_snapshot() → satellite.db
    │       │
    │       └── inference.predict() → satellite.db (predictions table)
    │
    └──► Dashboard reads both DBs via API proxies
```

---

### M9: src/hynous/discord/ — No README

**Directory:** `src/hynous/discord/`
**Problem:** The Discord bot module has no documentation.

**What needs to be documented:**

1. **Three capabilities** (from the module docstring):
   - Chat relay: user sends message → `agent.chat()` → response back to Discord
   - Daemon notifications: fills, watchpoints, reviews auto-posted to configured channel
   - Stats panel: `!stats` command posts/refreshes a live-updating embed (edits every 30s)

2. **Integration:**
   - Shares the same Agent singleton — same memory, positions, conversation context
   - Runs in a background thread with its own asyncio event loop
   - Started by `start_bot(agent, config)` during app initialization

3. **Configuration:**
   - `discord:` section in `default.yaml`: `enabled`, `channel_id`, `stats_channel_id`, `allowed_user_ids`
   - `DISCORD_BOT_TOKEN` env var required

4. **Behavior:**
   - Only responds to allowed users (configured list)
   - Auto-splits messages >2000 chars at line boundaries
   - Stats panel auto-updates every 30 seconds

---

### M10: src/hynous/ Root — No README

**Directory:** `src/hynous/`
**Problem:** No top-level README to orient a newcomer to the package structure.

**What needs to be documented:**

The `src/hynous/` package is the main Python application. An agent entering from the root would benefit from a brief map:

```
src/hynous/
├── core/           # Shared utilities (config, types, errors, logging, tracing)
├── data/           # Market data providers (Hyperliquid, paper, Coinglass, etc.)
├── discord/        # Discord bot (chat relay, notifications, stats)
├── intelligence/   # LLM agent brain (agent, daemon, scanner, tools, prompts)
└── nous/           # Python HTTP client for Nous TypeScript API
```

---

## LOW — Incomplete but Not Misleading

These are minor gaps or stale content that won't cause incorrect assumptions but reduce documentation quality.

---

### L1: revisions/ — 38 Historical Files

**Directory:** `revisions/`
**Problem:** All 38 markdown files across 14 subdirectories are marked as DONE/IMPLEMENTED. They are purely historical implementation guides and audit notes.

**Risk:** An AI agent scanning `revisions/` might spend time reading implementation guides for already-completed work, or might treat them as pending tasks.

**Options:**
- Move to `revisions/archive/` subdirectory to signal they're historical
- Consolidate into a single `revisions/CHANGELOG.md` summarizing what was done
- Keep as-is but add a prominent note at top of `revisions/README.md`

**Affected directories:** MF0/, MF12/, MF13/, MF15/, trade-recall/, trade-debug-interface/, token-optimization/, memory-pruning/, graph-changes/, nous-wiring/, memory-search/, memory-sections/, debugging/, portfolio-tracking/

---

### L2: docs/README.md

**File:** `docs/README.md`
**Problem:** References 6 documents that don't exist in the `docs/` directory.

**Referenced but missing:**
- `SETUP.md`
- `DEVELOPMENT.md`
- `DEPLOYMENT.md`
- `STYLE_GUIDE.md`
- `TROUBLESHOOTING.md`
- `DECISIONS.md`

The `docs/` directory only contains `README.md` itself. Either these docs were planned but never created, or they exist elsewhere.

---

### L3: nous-server/README.md

**File:** `nous-server/README.md`
**Problem:** Stale directory structure and test counts.

**What's wrong:**

1. **Directory structure still references `packages/` (line 9):**
   - Should reflect actual: `nous-server/core/` and `nous-server/server/`

2. **Test count says "1236 passing" (line 66):**
   - Actual: 4272+ TypeScript tests (per MEMORY.md)

3. **Missing from structure listing:**
   - `core/src/sections/` — memory sections module (added for Issue 0-6)
   - `core/src/contradiction/`, `core/src/decay/`, `core/src/clusters/` — and other modules in `core/src/`
   - `server/` directory entirely — Hono HTTP server with routes is not documented

4. **Spec references (lines 49-63) may be outdated:**
   - References specs in a `Specs/` directory which may not exist in the current repo structure

---

### L4: tests/README.md

**File:** `tests/README.md`
**Problem:** Missing satellite and data-layer tests, incomplete file lists.

**What's wrong:**

1. **No mention of `satellite/tests/`:** 6 test files (test_artemis, test_features, test_labeler, test_normalize, test_safety, test_training)

2. **No mention of `data-layer/tests/`:** 5 test files (test_historical_tables, test_liq_heatmap, test_order_flow, test_rate_limiter, test_smoke)

3. **Unit test file list (lines 44-47) is incomplete:** Missing test_consolidation, test_decay_conflict_fixes, test_playbook_matcher, test_sections, test_intent_boost, test_token_optimization

4. **Integration test list (lines 64-66) is incomplete:** Missing test_playbook_integration, test_pruning_integration

5. **`PYTHONPATH=src` requirement not documented:** Known issue — tests need `PYTHONPATH=src` set to run but this is not mentioned anywhere in the test docs

---

### L5: intelligence/prompts/README.md

**File:** `src/hynous/intelligence/prompts/README.md`
**Problem:** Simplified builder description doesn't reflect actual complexity.

**What's wrong:**

1. **`build_system_prompt()` signature (lines 19-28) is oversimplified:**
   - Shows a 3-part join: identity, trading knowledge, current state
   - Actual builder includes: TOOL_STRATEGY sections (per-tool usage guidance), memory section descriptions ("How My Memory Works"), context snapshot injection, trading settings injection, scanner validation instructions, phantom tracking context, regime reading context, dynamic prompt assembly based on wake type

2. **Missing TOOL_STRATEGY pattern:**
   - Tools MUST be mentioned in the system prompt's TOOL_STRATEGY section for the agent to know to use them. Registering a tool without adding it to builder.py means the agent won't use it. This is a critical extension pattern not documented here.

---

### L6: Duplicate "Known Issues" Across 7 Files

**Problem:** The same "all revisions resolved" message appears in 7 different files with slight variations, creating maintenance burden.

**Files with "known issues" sections:**
1. `ARCHITECTURE.md` (lines 328-399) — full revision listing with details
2. `revisions/README.md` — detailed revision listing
3. `docs/README.md` (lines 47-59) — revision links
4. `src/hynous/intelligence/README.md` — known issues section
5. `src/hynous/intelligence/tools/README.md` — known issues section
6. `src/hynous/nous/README.md` — known issues section
7. MEMORY.md — Known Audit Findings section

**Recommendation:** Consolidate to a single canonical source (e.g., `revisions/README.md`) and have other files link to it.

---

### L7: No CLAUDE.md in Project Root

**Problem:** There is no `CLAUDE.md` in `/Users/bauthoi/Documents/Hynous/`. All agent context lives in `~/.claude/projects/.../memory/MEMORY.md`.

**Impact:** A `CLAUDE.md` at the project root is the standard way to provide project-specific instructions to Claude Code. Any agent opening this project would not see project-specific guidance until MEMORY.md loads.

**Recommendation:** Consider creating a root `CLAUDE.md` with essential project conventions and a pointer to the memory file for detailed knowledge.

---

## Missing READMEs — Full Inventory

| Directory | README | Priority |
|-----------|--------|----------|
| `satellite/` | **NO** | HIGH — 5,000+ lines, zero docs |
| `satellite/artemis/` | **NO** | MEDIUM — complex sub-module |
| `satellite/training/` | **NO** | MEDIUM — training pipeline |
| `satellite/tests/` | **NO** | LOW — test conventions |
| `data-layer/` | **NO** | HIGH — entire standalone service |
| `data-layer/src/hynous_data/` | **NO** | MEDIUM — package structure |
| `data-layer/src/hynous_data/collectors/` | **NO** | MEDIUM — 4 collectors |
| `data-layer/src/hynous_data/engine/` | **NO** | MEDIUM — 6 engines |
| `data-layer/src/hynous_data/api/` | **NO** | MEDIUM — 20+ endpoints |
| `data-layer/src/hynous_data/core/` | **NO** | LOW — config/db |
| `data-layer/tests/` | **NO** | LOW — test conventions |
| `src/hynous/` | **NO** | MEDIUM — package overview |
| `src/hynous/discord/` | **NO** | MEDIUM — bot integration |
| `src/hynous/intelligence/events/` | **NO** | LOW — only `__init__.py` |

---

## Appendix: Actual File Inventories

### Data Providers (src/hynous/data/providers/)

| File | Purpose | In Current README |
|------|---------|:-:|
| `hyperliquid.py` | Hyperliquid SDK wrapper (mainnet data + trading) | Yes |
| `paper.py` | Paper trading simulator (simulated trades, mainnet prices) | No |
| `coinglass.py` | Coinglass derivatives data | No |
| `cryptocompare.py` | CryptoCompare news feed | No |
| `hynous_data.py` | HTTP client for data-layer service (`:8100`) | No |
| `perplexity.py` | Perplexity web search provider | No |
| `binance.py` | **DOES NOT EXIST** (listed in README) | Yes (wrong) |
| `cryptoquant.py` | **DOES NOT EXIST** (listed in README) | Yes (wrong) |

### Agent Tools (src/hynous/intelligence/tools/)

| File | Tools Provided | In Current README |
|------|---------------|:-:|
| `market.py` | get_market_data | Yes |
| `orderbook.py` | get_orderbook | Yes |
| `funding.py` | get_funding_data | Yes |
| `multi_timeframe.py` | get_multi_timeframe | Yes |
| `liquidations.py` | get_liquidation_data | Yes |
| `sentiment.py` | get_sentiment | Yes |
| `options.py` | get_options_data | Yes |
| `institutional.py` | get_institutional_data | Yes |
| `web_search.py` | web_search | Yes |
| `costs.py` | estimate_costs | Yes |
| `memory.py` | store_memory, recall_memory, update_memory | Yes |
| `delete_memory.py` | delete_memory | Yes |
| `trading.py` | execute_trade, close_position, modify_position, get_account_info | Yes |
| `watchpoints.py` | manage_watchpoints | Yes |
| `trade_stats.py` | get_trade_stats | Yes |
| `explore_memory.py` | explore_memory | Yes |
| `conflicts.py` | resolve_conflicts | Yes |
| `clusters.py` | manage_clusters | Yes |
| `data_layer.py` | get_data_layer_feature (13+ actions) | **No** |
| `market_watch.py` | get_book_history, monitor_signal | **No** |
| `pruning.py` | analyze_memory, batch_prune | **No** |

### Dashboard Pages (dashboard/dashboard/pages/)

| File | Route | In Current README |
|------|-------|:-:|
| `home.py` | `/` | Yes |
| `chat.py` | `/chat` | Yes |
| `memory.py` | `/memory` | Yes |
| `graph.py` | `/graph` | Yes |
| `debug.py` | `/debug` | Yes |
| `journal.py` | `/journal` | **No** |
| `data.py` | `/data` | **No** |
| `ml.py` | `/ml` | **No** |
| `settings.py` | `/settings` | **No** |
| `login.py` | `/login` | **No** |

### Dashboard Assets (dashboard/assets/)

| File | Purpose | In Current README |
|------|---------|:-:|
| `graph.html` | Force-graph memory visualization | Yes |
| `brain.html` | Sagittal brain SVG + section force graphs | **No** |
| `ml.html` | ML feature monitoring + predictions dashboard | **No** |
| `data.html` | Data layer visualization | **No** |
| `hynous-avatar.png` | Agent avatar image | **No** |
