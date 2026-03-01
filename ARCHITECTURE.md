# Hynous Architecture

> How the system fits together. Read this before making changes.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      REFLEX DASHBOARD (Python)                              │
│                           localhost:3000                                     │
│  ┌──────┐ ┌──────┐ ┌────────┐ ┌───────┐ ┌─────────┐ ┌──────┐              │
│  │ Home │ │ Chat │ │ Memory │ │ Graph │ │ Journal │ │Debug │              │
│  └──┬───┘ └──┬───┘ └───┬────┘ └───┬───┘ └────┬────┘ └──┬───┘              │
│  ┌──────┐ ┌──────┐ ┌────────┐ ┌───────┐                                    │
│  │ Data │ │  ML  │ │Settings│ │ Login │                                    │
│  └──┬───┘ └──┬───┘ └───┬────┘ └───┬───┘                                    │
└─────────┼────────────────┼──────────────────────────────────────────────────┘
          │                │
          └───────┬────────┘
                  │
┌─────────────────┼───────────────────────────────────────────────────────────┐
│                 │        FASTAPI GATEWAY (Python)                            │
│                 │           localhost:8000                                   │
│                 ▼                                                            │
│  ┌─────────────────────────┐                                                │
│  │      HYNOUS AGENT       │ ◄── Hynous lives here                          │
│  │  • Claude reasoning     │                                                │
│  │  • Tool calling loop    │                                                │
│  │  • Scanner + cron       │                                                │
│  └───────────┬─────────────┘                                                │
│              │                                                               │
│      ┌───────┼───────┬──────────────┬──────────────┐                        │
│      │       │       │              │              │                        │
│      ▼       ▼       ▼              ▼              ▼                        │
│  ┌───────┐ ┌───────┐ ┌────────┐ ┌──────────┐ ┌─────────┐                   │
│  │ Hydra │ │ Nous  │ │Scanner │ │ Daemon   │ │ Discord │                   │
│  │ Tools │ │Client │ │anomaly │ │          │ │   Bot   │                   │
│  │(direct)│ │(HTTP) │ │detect  │ │24/7 loop │ │  relay  │                   │
│  └───┬───┘ └───┬───┘ └────────┘ └─────┬────┘ └─────────┘                   │
└──────┼─────────┼───────────────────────┼────────────────────────────────────┘
       │         │                       │
       │         │ HTTP (~5ms)           │ satellite.tick() (every 300s)
       │         ▼                       ▼
       │  ┌─────────────────────┐ ┌──────────────────────────────┐
       │  │   NOUS API (TS)     │ │     SATELLITE (Python)       │
       │  │  Hono :3100         │ │  ML feature engine           │
       │  │                     │ │  12 structural features      │
       │  │  • SSA retrieval    │ │  Training + inference        │
       │  │  • Two-phase cogn.  │ │  Reads from data-layer DB    │
       │  │  • FSRS decay       │ └──────────────┬───────────────┘
       │  │  • Vector embed.    │                │
       │  └────────┬────────────┘                │ reads
       │           │                             ▼
       │           ▼                  ┌──────────────────────────┐
       │   ┌───────────────┐         │  DATA-LAYER (Python)     │
       │   │    SQLite     │         │  FastAPI :8100            │
       │   │   (nous.db)   │         │                           │
       │   └───────────────┘         │  • Trade stream           │
       │                             │  • L2 orderbook           │
       │                             │  • Liq heatmap            │
       ▼                             │  • Order flow             │
┌──────────────────────────────┐     │  • Position tracking      │
│        HYDRA (Python)        │     └──────────────────────────┘
│                              │
│  ┌──────────────────┐ ┌──────────────────┐
│  │  Data Sources    │ │   Execution      │
│  │                  │ │                  │
│  │ • Hyperliquid    │ │ • Order place    │
│  │ • Coinglass      │ │ • Position mgmt  │
│  │ • CryptoCompare  │ │ • Risk controls  │
│  │ • Perplexity     │ │                  │
│  └──────────────────┘ └──────────────────┘
└──────────────────────────────┘
```

---

## Component Responsibilities

### `src/hynous/intelligence/` -- The Brain

The LLM agent that thinks, reasons, and acts.

| Module | Responsibility |
|--------|----------------|
| `agent.py` | LiteLLM multi-provider wrapper (Claude via OpenRouter), tool calling loop |
| `prompts/` | System prompts (identity, trading knowledge, tool strategy) |
| `tools/` | Tool definitions and handlers (22 modules, 29 tools) |
| `events/` | Event type definitions |
| `daemon.py` | Background loop for autonomous operation (24/7 wake cycle) |
| `scanner.py` | Market-wide anomaly detection across all Hyperliquid pairs (macro + micro detectors) |
| `briefing.py` | Pre-built briefing injection for daemon wakes |
| `coach.py` | Haiku sharpener for daemon wake quality |
| `context_snapshot.py` | Live state snapshot builder (portfolio, positions, market, memory) -- injected into every agent message |
| `regime.py` | Regime detection v4: hybrid macro/micro dual scoring, 6 combined labels (zero LLM cost) |
| `wake_warnings.py` | Deterministic code-based checks injected before agent responds (zero LLM cost) |
| `memory_manager.py` | Tiered memory: working window + Nous-backed compression |
| `retrieval_orchestrator.py` | Intelligent multi-pass retrieval: classify -> decompose -> parallel search -> quality gate -> merge |
| `gate_filter.py` | Pre-storage quality gate (rejects gibberish, filler, etc.) |
| `memory_tracker.py` | In-process audit log of all Nous writes per chat cycle (creates, archives, deletes) |
| `consolidation.py` | Cross-episode generalization: clusters related episodes, extracts patterns via LLM, creates knowledge/playbook nodes |
| `playbook_matcher.py` | Procedural memory: loads playbook nodes, evaluates structured trigger conditions against scanner anomalies |

### `src/hynous/nous/` -- The Memory Client

Python client for the Nous TypeScript API.

| Module | Responsibility |
|--------|----------------|
| `client.py` | HTTP client for Nous API |
| `sections.py` | Memory section definitions: 4 sections (Episodic, Signals, Knowledge, Procedural), subtype->section mapping, per-section weight/decay/encoding profiles |
| `server.py` | Auto-start Nous TypeScript server as background subprocess |

**Note:** Nous itself is a TypeScript service. We call it via HTTP API.
See `storm-013-nous-http-api.md` in the brainstorm for the full API spec.

### `src/hynous/data/` -- The Senses

Market data from external sources.

| Module | Responsibility |
|--------|----------------|
| `providers/` | Data source wrappers (6 providers) |
| `hyperliquid.py` | Hyperliquid API (prices, funding, positions, execution) |
| `paper.py` | Paper trading simulator (local order matching) |
| `coinglass.py` | Coinglass API (derivatives data: OI, liquidations, funding) |
| `cryptocompare.py` | CryptoCompare API (news feed, sentiment) |
| `hynous_data.py` | Client for the data-layer service (:8100) |
| `perplexity.py` | Perplexity API (AI-powered web search) |

### `src/hynous/core/` -- The Foundation

Shared utilities used everywhere.

| Module | Responsibility |
|--------|----------------|
| `config.py` | Configuration loading (YAML -> dataclasses) |
| `types.py` | Shared type definitions |
| `errors.py` | Custom exceptions |
| `logging.py` | Logging setup |
| `clock.py` | Time awareness -- all timestamps Pacific (America/Los_Angeles) |
| `costs.py` | Cost tracker for LLM API usage, Perplexity, subscriptions |
| `daemon_log.py` | Persistent JSON log of daemon events (500-event cap, buffered flush) |
| `equity_tracker.py` | Append-only equity curve persistence (~5 min snapshots, 30-day prune) |
| `persistence.py` | Chat persistence (save/load conversation state across restarts) |
| `trade_analytics.py` | Performance tracking from Nous trade_close nodes (30s cache) |
| `trading_settings.py` | Runtime-adjustable trading parameters (thread-safe singleton, JSON-persisted) |
| `request_tracer.py` | Debug trace collector -- records 8 span types per `agent.chat()` call |
| `memory_tracker.py` | Mutation audit log -- tracks node creates, edge creates, archives, deletes per chat cycle |
| `trace_log.py` | Trace persistence + SHA256 content-addressed payload storage |

### `src/hynous/discord/` -- The Relay

Discord bot for chat and daemon notifications.

| Module | Responsibility |
|--------|----------------|
| `bot.py` | Chat relay (message -> agent.chat() -> response), daemon notifications (fills, watchpoints, reviews), background thread with own event loop |
| `stats.py` | Stats embed builder -- live-updating panel (portfolio, positions, regime, trade performance, scanner status) every 30s |

Shares the same Agent singleton as the dashboard -- same memory, same positions, same conversation context.

### `dashboard/` -- The Face

User interface built with Reflex (Python -> React).

| Module | Responsibility |
|--------|----------------|
| `rxconfig.py` | Reflex configuration |
| `dashboard/dashboard.py` | App entry point, routing, Nous API proxy |
| `dashboard/state.py` | Reactive state management |
| `dashboard/components/` | Reusable UI components (card, chat, nav, ticker) |
| `dashboard/pages/` | 10 page components (see below) |
| `assets/` | Static assets served by Reflex |

**Pages** (10):

| Page | Route | Purpose |
|------|-------|---------|
| `home.py` | `/` | Portfolio overview, equity curve, positions |
| `chat.py` | `/chat` | Conversational interface with Hynous |
| `memory.py` | `/memory` | Memory browser with Sections tab (brain visualization) |
| `graph.py` | `/graph` | Force-directed knowledge graph |
| `journal.py` | `/journal` | Trade journal + activity log |
| `debug.py` | `/debug` | Trace timeline, span inspector |
| `data.py` | `/data` | Data-layer dashboards (trade stream, order flow, heatmap) |
| `ml.py` | `/ml` | ML satellite monitoring (features, training, inference) |
| `settings.py` | `/settings` | Runtime-adjustable trading parameters |
| `login.py` | `/login` | Authentication |

**Assets** (5):

| File | Purpose |
|------|---------|
| `graph.html` | Standalone force-graph visualization with cluster layout |
| `brain.html` | Sagittal brain SVG + per-section force graphs (1373 lines, self-contained) |
| `ml.html` | ML satellite feature visualization |
| `data.html` | Data-layer real-time dashboards |
| `hynous-avatar.png` | Agent avatar image |

Run with: `cd dashboard && reflex run`

### `satellite/` -- The Feature Engine

ML feature computation engine. Computes 12 structural core features from data-layer engines, stores them in a dedicated SQLite database.

| Module | Responsibility |
|--------|----------------|
| `__init__.py` | `tick()` entry point -- called by daemon every 300s after `_poll_derivatives()` |
| `features.py` | Feature computation (SINGLE SOURCE OF TRUTH -- training, inference, and backfill all use this) |
| `config.py` | SatelliteConfig dataclass |
| `schema.py` | Database schema definitions |
| `store.py` | SQLite persistence (satellite.db) |
| `normalize.py` | Feature normalization |
| `labeler.py` | Label generation for training data |
| `inference.py` | Real-time inference from trained models |
| `monitor.py` | Feature drift and health monitoring |
| `safety.py` | Safety checks and guardrails |
| `training/` | Training pipeline (train.py, walkforward.py, explain.py, artifact.py, pipeline.py) |
| `artemis/` | Advanced analysis (layer2.py, pipeline.py, profiler.py, reconstruct.py, seeder.py) |
| `tests/` | 6 test modules |

### `data-layer/` -- The Market Data Pipeline

Standalone FastAPI service for real-time market data collection and processing. Runs on `:8100`.

| Module | Responsibility |
|--------|----------------|
| `src/hynous_data/api/` | FastAPI application factory + routes |
| `src/hynous_data/collectors/` | Real-time data collectors (trade_stream, l2_subscriber, position_poller, hlp_tracker) |
| `src/hynous_data/engine/` | Processing engines (liq_heatmap, order_flow, position_tracker, smart_money, whale_tracker, profiler) |
| `src/hynous_data/core/` | Core utilities (database, config) |
| `tests/` | 5 test modules |

---

## Data Flow

### User Chat Flow

```
User types message (Dashboard or Discord)
    │
    ▼
dashboard/pages/chat.py  OR  discord/bot.py
    │
    ▼
intelligence/agent.py (process_message)
    │
    ├──► Claude API (reasoning)
    │
    ├──► tools/market.py (if needs price)
    │       │
    │       ▼
    │    data/hyperliquid.py
    │
    ├──► tools/memory.py (if needs memory)
    │       │
    │       ▼
    │    retrieval_orchestrator.py (classify → decompose → parallel search → quality gate → merge)
    │       │
    │       ▼
    │    nous/client.py → Nous API (:3100)
    │
    ├──► tools/data_layer.py (if needs trade stream / order flow / heatmap)
    │       │
    │       ▼
    │    data/providers/hynous_data.py → Data-Layer API (:8100)
    │
    ├──► tools/pruning.py (if memory hygiene)
    │       │
    │       ├── analyze_memory: get_graph() → BFS components → staleness scoring
    │       └── batch_prune: ThreadPoolExecutor(10) → concurrent archive/delete
    │
    ▼
Response returned to dashboard / Discord channel
    │
    ▼
User sees Hynous response
```

### Daemon Wake Flow

```
daemon.py (continuous loop)
    │
    ├── _poll_prices() (every 60s)
    │     ├── scanner.py (macro anomaly detection across all pairs)
    │     └── L2 book + 5m candle polling (micro detectors)
    │
    ├── _poll_derivatives() (every 300s)
    │     ├── Funding, OI, sentiment data
    │     ├── satellite.tick() → compute 12 features → satellite.db
    │     └── news polling (CryptoCompare)
    │
    ├── _check_positions() → fill detection → _wake_for_fill()
    ├── _check_profit_levels() → tiered profit alerts → _wake_for_profit()
    ├── _check_watchpoints() → price level triggers → _wake_for_watchpoint()
    ├── _check_pending_watches() → deferred watchpoint creation
    │
    ├── scanner anomalies above threshold → _wake_for_scanner()
    │     └── playbook_matcher: match anomalies against procedural playbooks
    │
    ├── periodic review (every 60 min) → _wake_for_review()
    ├── curiosity check (every 15 min) → _wake_agent(source="daemon:learning")
    │
    ├── _run_decay_cycle() (every 6 hours, background thread)
    │     └── _check_fading_transitions() → _wake_for_fading_memories()
    │
    ├── _check_conflicts() (every 30 min, background thread)
    │     └── tier-1 auto-resolve → _wake_for_conflicts() (remaining)
    │
    ├── _check_health() (every 1 hour) → Nous health check
    │
    ▼ (if wake triggered)
intelligence/agent.py (chat with max_tokens cap per wake type)
    │
    ├──► wake_warnings.py (deterministic pre-checks, zero cost)
    ├──► Briefing injection (pre-built, free)
    ├──► context_snapshot.py (portfolio + market state, ~150 tokens)
    ├──► regime.py (market regime label, zero cost)
    ├──► Nous context retrieval (via retrieval orchestrator)
    ├──► Reason + tool calls
    │
    ▼ (if trade decision)
tools/trading.py (execute_trade)
    │
    ▼
data/hyperliquid.py (place order)
```

### Debug Trace Flow

```
agent.chat() / chat_stream() called
    │
    ├── request_tracer.begin_trace(source, input_summary)
    │
    ├── Context span (briefing/snapshot injection, user_message, wrapped_hash)
    ├── Retrieval span (query, results with content bodies)
    ├── LLM Call span (model, tokens, messages_hash, response_hash)
    ├── Tool Execution span (tool_name, input_args, output_preview)
    ├── Trade Step span (trade_tool, step, success, detail, duration_ms)
    ├── Memory Op span (store/recall/update, gate_filter result)
    ├── Compression span (exchanges_evicted, window_size)
    ├── Queue Flush span (items_count)
    │
    ├── request_tracer.end_trace(status, output_summary)
    │
    ▼
trace_log.save_trace() → storage/traces.json
                        → storage/payloads/*.json (content-addressed)
    │
    ▼
Dashboard Debug page reads traces + resolves payload hashes
```

Memory Op spans include `analyze` and `prune` operations from the pruning tools, recording node counts, stale groups found, and archive/delete success/failure metrics.

Trade step spans provide sub-step visibility into `execute_trade` (7+ spans: circuit breaker, validation, leverage, order fill, cache, daemon, memory), `close_position` (7 spans), and `modify_position` (5 spans). Each span includes timing, success/failure, and a human-readable detail string. Recorded via `_record_trade_span()` helper in `tools/trading.py` using thread-local trace context.

Large content (LLM messages, responses, injected context) is stored via SHA256 content-addressed payloads in `storage/payloads/`. The dashboard's `debug_spans_display` computed var resolves `*_hash` fields to actual content before rendering.

---

## Tools Reference

22 tool modules registering 29 tools:

| Module | Tools | Description |
|--------|-------|-------------|
| `market.py` | `get_market_data` | Current price, 24h change, volume |
| `orderbook.py` | `get_orderbook` | L2 orderbook depth |
| `funding.py` | `get_funding_history` | Funding rate history |
| `multi_timeframe.py` | `get_multi_timeframe` | Multi-timeframe candle analysis |
| `liquidations.py` | `get_liquidations` | Liquidation data |
| `sentiment.py` | `get_global_sentiment` | Fear & Greed, social sentiment |
| `options.py` | `get_options_flow` | Options market data |
| `institutional.py` | `get_institutional_flow` | ETF flows, whale movements |
| `web_search.py` | `search_web` | Perplexity-powered web search |
| `costs.py` | `get_my_costs` | Operational cost tracking |
| `memory.py` | `store_memory`, `recall_memory`, `update_memory` | Memory CRUD operations |
| `trading.py` | `execute_trade`, `close_position`, `modify_position`, `get_account` | Trade execution + account info |
| `delete_memory.py` | `delete_memory` | Memory deletion |
| `watchpoints.py` | `manage_watchpoints` | Price alert watchpoints |
| `trade_stats.py` | `get_trade_stats` | Trade performance analytics |
| `explore_memory.py` | `explore_memory` | Graph traversal + memory browsing |
| `conflicts.py` | `manage_conflicts` | Contradiction queue management |
| `clusters.py` | `manage_clusters` | Memory cluster CRUD |
| `pruning.py` | `analyze_memory`, `batch_prune` | Memory hygiene (staleness analysis + batch archive/delete) |
| `data_layer.py` | `data_layer` | Query data-layer service (trade stream, order flow, heatmap, smart money) |
| `market_watch.py` | `get_book_history`, `monitor_signal` | L2 book history + signal monitoring |

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI Framework | Reflex | Python-native, compiles to React |
| Memory System | Nous (TypeScript) via HTTP | Too complex to reimplement, ~5ms overhead acceptable |
| LLM | LiteLLM via OpenRouter | Multi-provider (Claude, GPT-4, DeepSeek, etc.), single API key |
| Agent-Hydra | Direct import | Zero overhead, same Python process |
| Agent-Nous | HTTP API | Nous is TypeScript, clean separation |
| Agent-Discord | Shared singleton | Same Agent instance, background thread with own event loop |
| Data-Layer | Separate FastAPI service | Isolates high-frequency market data from agent process |
| Satellite | In-process module | Called by daemon via `satellite.tick()`, reads data-layer DB directly |
| Config | YAML files | Human readable, easy to edit |

---

## Extension Points

### Adding a New Tool

1. Create handler in `src/hynous/intelligence/tools/`
2. Register in `tools/registry.py`
3. Add to `prompts/builder.py` `TOOL_STRATEGY` section -- registering alone is not enough; the agent won't know to use the tool without system prompt guidance
4. Tool is now available to agent

### Adding a New Page

1. Create page in `dashboard/pages/`
2. Add route in `dashboard/app.py`
3. Page is automatically available

### Adding a New Data Source

1. Create provider in `src/hynous/data/providers/`
2. Export in `data/__init__.py`
3. Create corresponding tools in `intelligence/tools/`

### Adding a New Node Type

1. Add to enum in `nous/nodes.py`
2. Update schemas if needed
3. Nodes of new type can be created immediately

---

## Configuration

All config lives in `config/` directory:

```
config/
├── default.yaml     # Main app config
└── theme.yaml       # UI styling
```

Config is loaded once at startup and passed through the system.

### `default.yaml` Sections

| Section | Purpose |
|---------|---------|
| `app` | Name, version |
| `execution` | Mode (paper/testnet/live), symbols, paper balance |
| `hyperliquid` | Leverage, position caps, slippage |
| `agent` | Model, max_tokens, temperature |
| `coinglass` | API plan tier |
| `daemon` | All daemon intervals, circuit breakers, rate limits |
| `scanner` | Anomaly thresholds (macro + micro), news polling |
| `discord` | Bot config, channel IDs, allowed users |
| `data_layer` | Data-layer service URL, timeout |
| `nous` | Nous server URL, DB path, auto-retrieve limit |
| `orchestrator` | Multi-pass retrieval settings (quality threshold, max sub-queries, timeout) |
| `memory` | Window size, context token budget, compression model |
| `sections` | Memory section bias layer (intent boost, default section) |
| `satellite` | Feature engine config (snapshot interval, coins, thresholds, funding hours) |
| `events` | Funding/price event thresholds, cooldown |
| `logging` | Log level, format |

---

## Deployment

VPS deployment via systemd services and Caddy reverse proxy.

```
deploy/
├── hynous.service       # Main app (dashboard + agent + daemon + discord bot)
├── nous.service          # Nous TypeScript memory server (:3100)
├── hynous-data.service   # Data-layer FastAPI service (:8100)
├── setup.sh              # VPS provisioning script
└── README.md             # Deployment instructions
```

---

## Testing Strategy

```
tests/                    # Main Python test suite
├── unit/                 # Test individual functions
├── integration/          # Test component interactions
└── e2e/                  # Test full user flows

satellite/tests/          # Satellite-specific tests (6 modules)
├── test_features.py
├── test_labeler.py
├── test_normalize.py
├── test_safety.py
├── test_training.py
└── test_artemis.py

data-layer/tests/         # Data-layer tests (5 modules)
├── test_smoke.py
├── test_historical_tables.py
├── test_liq_heatmap.py
├── test_order_flow.py
└── test_rate_limiter.py

nous-server/core/         # TypeScript test suite (4270+ tests, vitest)
```

---

## Known Issues & Revisions

The `docs/archive/` directory contains documented issues and their resolutions, organized by scope. (Formerly `revisions/`, moved to `docs/archive/`.)

### `docs/archive/revision-exploration.md`

Master list of 21 issues across the entire codebase, prioritized P0 through P3. Covers retrieval bugs, daemon failures, missing tools, and system prompt inaccuracies.

### `docs/archive/nous-wiring/`

Focused on the Nous <-> Python integration layer. Start with `executive-summary.md` for the high-level issue categories, then dive into:

- **`nous-wiring-revisions.md`** -- 10 wiring issues (NW-1 to NW-10) -- **all 10 FIXED** (field name mismatches, retrieval truncation, silent failures, missing tools)
- **`more-functionality.md`** -- 16 Nous capabilities (MF-0 to MF-15). **14 DONE, 2 SKIPPED (MF-11, MF-14), 0 remaining.**

**If you're working on Nous integration, read the executive summary first.**

### `docs/archive/memory-search/`

Intelligent Retrieval Orchestrator -- multi-pass memory search. **IMPLEMENTED.**

### `docs/archive/trade-recall/` -- ALL FIXED

Trade retrieval failures -- three root causes identified and resolved.

### `docs/archive/graph-changes/`

Graph visualization enhancements -- cluster layout. **DONE.**

### `docs/archive/trade-debug-interface/` -- IMPLEMENTED

Trade execution telemetry -- sub-step visibility into all trade operations. Added `trade_step` span type (8th span type) to the debug system.

### `docs/archive/token-optimization/`

Token cost reduction measures:
- **TO-1** -- Dynamic max_tokens per wake type (512-2048) -- **DONE**
- **TO-2** -- Schema trimming for store/recall_memory (~70% smaller) -- **DONE**
- **TO-3** -- Tiered stale tool-result truncation (150/300/400/600/800) -- **DONE**
- **TO-4** -- Window size 6->4 with Haiku compression -- **DONE**
- TO-5 through TO-8 -- Deferred

### `docs/archive/memory-sections/` -- IMPLEMENTED (2026-02-21)

Brain-inspired memory sectioning -- 4 sections (Episodic, Signals, Knowledge, Procedural) with per-section retrieval weights, decay curves, encoding modulation, consolidation, and procedural pattern-matching. All 7 issues implemented (Issues 0-6).

### `docs/archive/memory-pruning/`

Two-phase memory pruning (analyze_memory + batch_prune). **IMPLEMENTED.**

### `docs/archive/debugging/`

Debug Dashboard planning and implementation. **IMPLEMENTED.**

### `docs/archive/portfolio-tracking/`

Three paper trading portfolio bugs fixed (2026-03-01): (1) `stats_reset_at` auto-stamped on first run + `reset_paper_stats()` method + dashboard Reset Stats button; (2) initial balance now read from `provider._initial_balance` in context snapshot and briefing (not YAML config); (3) daemon-wake-initiated agent closes now update `_daily_realized_pnl` via fill lookup in `_wake_agent()` finally block. **ALL 3 BUGS FIXED.**

---

## For Future Agents

When working on this codebase:

1. **Check docs/archive/ first** -- contains documented issues and their resolutions (formerly `revisions/`)
2. **All revisions complete** -- Nous wiring, memory search, trade recall, trade debug interface, token optimization, memory pruning, memory sections, brain visualization, and portfolio tracking are all fully implemented
3. **Check existing patterns** -- Don't reinvent, extend
4. **Keep modules focused** -- One responsibility per file
5. **Update this doc** -- If you change architecture, document it
6. **Test your changes** -- Don't break what works
7. **System prompt matters** -- Tools registered in `registry.py` also need guidance in `prompts/builder.py` TOOL_STRATEGY or the agent won't use them
8. **Nous dist rebuild** -- When changing `@nous/core` exports, run `pnpm build` in `nous-server/core/` to update `dist/`

---

Last updated: 2026-03-01
