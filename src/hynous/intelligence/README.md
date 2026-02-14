# Intelligence Module

> The brain of Hynous. LLM agent with reasoning and tool use.

---

## Structure

```
intelligence/
├── agent.py              # Core agent (LiteLLM multi-provider wrapper, tool loop)
├── daemon.py             # Background loop for autonomous operation
├── memory_manager.py     # Auto-retrieval + compression for context injection
├── scanner.py            # Market-wide anomaly detection across all Hyperliquid pairs
├── briefing.py           # Pre-built briefing injection for daemon wakes
├── coach.py              # Haiku sharpener for daemon wake quality
├── context_snapshot.py   # Live state snapshot builder (portfolio, market, memory)
├── retrieval_orchestrator.py # Intelligent multi-pass retrieval (classify, decompose, quality gate, merge)
├── gate_filter.py        # Pre-storage quality gate (rejects gibberish, filler, etc.)
├── wake_warnings.py      # Code-based warnings injected into daemon wakes
│
├── prompts/              # System prompts
│   ├── identity.py       # Who Hynous is (personality, values)
│   ├── trading.py        # Trading knowledge (principles, not rules)
│   └── builder.py        # Assembles full prompt from parts
│
└── tools/                # Tool definitions (17 modules, 23 tools — see tools/README.md)
    ├── registry.py       # Tool dataclass + registration
    ├── market.py         # get_market_data
    ├── orderbook.py      # get_orderbook
    ├── funding.py        # get_funding_history
    ├── multi_timeframe.py # get_multi_timeframe
    ├── liquidations.py   # get_liquidations
    ├── sentiment.py      # get_global_sentiment
    ├── options.py        # get_options_flow
    ├── institutional.py  # get_institutional_flow
    ├── web_search.py     # search_web
    ├── costs.py          # get_my_costs
    ├── memory.py         # store_memory, recall_memory, update_memory
    ├── delete_memory.py  # delete_memory
    ├── trading.py        # execute_trade, close_position, modify_position, get_account
    ├── trade_stats.py    # get_trade_stats
    ├── watchpoints.py    # manage_watchpoints
    ├── explore_memory.py # explore_memory (graph traversal, link/unlink)
    ├── conflicts.py      # manage_conflicts (contradiction list/resolve)
    └── clusters.py       # manage_clusters (cluster CRUD, membership, health)
```

---

## Key Patterns

### Adding a New Tool

See `tools/README.md` for the full pattern. In short:

1. Create `tools/my_tool.py` with `TOOL_DEF` dict + handler function + `register()` function
2. Import and call `register()` from `tools/registry.py`

### Retrieval Orchestrator

The `retrieval_orchestrator.py` module transforms memory retrieval from a single-shot lookup into a multi-pass research process. It runs a 5-step pipeline:

1. **Classify** — QCS pre-check detects compound (D4) and ambiguous (D1) queries
2. **Decompose** — Split compound queries into atomic sub-queries (4 strategies: conjunction, question mark, "also", entity-based)
3. **Parallel Search** — Execute sub-queries concurrently via `ThreadPoolExecutor`
4. **Quality Gate** — Score threshold (0.20) with reformulation retry on failure
5. **Merge & Select** — Deduplicate, dynamic cutoff (`top_score * 0.4`), coverage guarantee per sub-query

Wired into `memory_manager.py` (auto-retrieval) and `tools/memory.py` (explicit recall). Config toggle: `orchestrator.enabled` in `config/default.yaml`.

### Modifying the Prompt

Edit files in `prompts/` — they're combined by `builder.py`.

- `identity.py` — Hynous's personality (from storm-011)
- `trading.py` — Trading principles (from storm-010)

### Daemon Cron Tasks

The daemon runs 24/7 and has timed tasks:

| Task | Interval | Method |
|------|----------|--------|
| Price polling | 60s | `_poll_prices()` |
| Watchpoint evaluation | every price poll | `_check_watchpoints()` |
| Profit/risk alerts | every price poll | `_wake_for_profit()` |
| Derivatives/sentiment | 5m | `_poll_derivatives()` |
| Market scanner | every deriv poll | `_wake_for_scanner()` |
| Periodic market review | 1h (2h weekends) | `_wake_for_review()` |
| Curiosity check | 15m | `_check_curiosity()` |
| FSRS batch decay | 6h | `_run_decay_cycle()` |
| Contradiction polling | 30m | `_check_conflicts()` |
| Nous health check | 1h (+ startup) | `_check_health()` |
| Embedding backfill | 12h | `_run_embedding_backfill()` |

Each wake type has a **max_tokens cap** (TO-1) to control output costs:
- 512: normal periodic review, manual fill acknowledgments
- 1024: watchpoints, scanner, profit alerts, conflicts, manual wakes
- 1536: learning review, curiosity sessions, fill SL/TP

To add a new cron task: add a timing tracker in `__init__`, initialize in `_loop()`, add interval check in main loop, implement method.

---

## Debug Tracing

The intelligence module is fully instrumented for the debug dashboard. Every `agent.chat()` and `chat_stream()` call produces a trace with ordered spans:

- **`agent.py`** — `source` parameter on `chat()`/`chat_stream()`, context/LLM/tool spans, content-addressed payload storage for messages and responses
- **`memory_manager.py`** — Retrieval spans (with result content bodies: title, body, score, node_type, lifecycle) and compression spans
- **`tools/memory.py`** — Memory op spans for store (gate filter result, dedup result), recall, and queue flush. Uses thread-local trace context (`set_active_trace`/`get_active_trace`)
- **`daemon.py`** — `source=` tag on all 9 `_wake_agent()` call sites (e.g. `"daemon:review"`, `"daemon:scanner"`, `"daemon:profit"`)

All tracer calls are wrapped in `try/except` — tracing can never break the agent.

---

## Dependencies

- `litellm` — Multi-provider LLM API (Claude, GPT-4, DeepSeek, etc. via OpenRouter)
- `nous/` — Memory retrieval (via HTTP client)
- `data/` — Market data

---

## Known Issues

All NW wiring issues (NW-1 through NW-10) are resolved. See revision docs for details:

- **`revisions/nous-wiring/executive-summary.md`** — Overview of all issue categories
- **`revisions/revision-exploration.md`** — Master issue list (19 issues, P0-P3)

Resolved issues in this module:
- ~~`memory_manager.py` truncated retrieved memory content~~ — FIXED: now shows full `content_body`, parses JSON, `content_summary` only as fallback
- ~~`daemon.py` used wrong field name `lifecycle_state`~~ — FIXED: now uses `state_lifecycle` correctly
- ~~`tools/memory.py` had no `update_memory` tool~~ — FIXED: full update with replace, append (JSON-aware), and lifecycle changes
- ~~`store_memory` was fire-and-forget~~ — FIXED: now synchronous, agent sees real feedback
- ~~No contradiction handling~~ — FIXED: `manage_conflicts` tool + daemon polling + inline flag check
- ~~No graph traversal~~ — FIXED: `explore_memory` tool with explore/link/unlink actions
- ~~No browse-by-type~~ — FIXED: `recall_memory` browse mode via `list_nodes()`
- ~~No batch FSRS decay~~ — FIXED: daemon runs `_run_decay_cycle()` every 6h

Remaining:
- ~~`store_memory` always creates new nodes without checking for existing related memories (MF-0)~~ — FIXED: `_store_memory_impl()` calls `check_similar()` for lesson/curiosity types before creating. Duplicates (>= 0.95 cosine) are dropped with feedback, similar matches (0.90-0.95) get `relates_to` edges
- ~~Edge strengthening / Hebbian learning not wired (MF-1)~~ — FIXED: `strengthen_edge()` client method + auto-strengthen on co-retrieval (memory_manager 0.03, recall_memory 0.05) + trade lifecycle edges (0.1)
- ~~No time-range search parameters exposed to agent (MF-7)~~ — FIXED: `recall_memory` now accepts `time_start`, `time_end`, `time_type`
- ~~No health check monitoring (MF-8)~~ — FIXED: daemon `_check_health()` on startup + every hour
- ~~No embedding backfill daemon task (MF-9)~~ — FIXED: daemon `_run_embedding_backfill()` every 12h
- ~~No visibility into QCS search classification (MF-10)~~ — FIXED: `NousClient.search()` logs QCS metadata (query_type, embeddings, disqualified) at DEBUG level
- ~~No cluster management (MF-13)~~ — FIXED: `manage_clusters` tool with 8 actions (list, create, update, delete, add, remove, members, health). Cluster-scoped search via `recall_memory(cluster=...)`. Auto-assignment via `auto_subtypes`. 9 NousClient cluster methods.
- ~~No pre-storage quality gate (MF-15)~~ — FIXED: `gate_filter.py` module with 6 rejection rules (too_short, gibberish, spam, repeated_chars, filler, empty_semantic, social_only). Gate runs in `_store_memory_impl()` before dedup and `get_client()`. Config toggle: `gate_filter_enabled`.

All 16 MF items and all 10 NW wiring issues are now resolved.

Post-MF feature: **Intelligent Retrieval Orchestrator** — `retrieval_orchestrator.py` implements multi-pass memory search with compound query decomposition, quality gating, and dynamic result sizing. Uses `NousClient.search_full()` and `classify_query()`. See `revisions/memory-search/` for design docs.

### Trade Recall — RESOLVED

Three trade retrieval bugs have been fixed. See `revisions/trade-recall/retrieval-issues.md` for root cause analysis and resolution details.

- ~~`_store_to_nous()` missing `event_time`~~ — FIXED: now passes `event_time`, `event_confidence=1.0`, `event_source="inferred"` to `create_node()`. All trade nodes get ISO timestamps automatically.
- ~~`_TYPE_MAP` mismatch~~ — FIXED: `handle_recall_memory()` normalizes `"trade"` → `"trade_entry"` before lookup.
- ~~`get_trade_stats` wrong tool for thesis retrieval~~ — FIXED: `TradeRecord` has `thesis` field, `_enrich_from_entry()` extracts thesis via `part_of` edge traversal, time/limit filtering added to tool and formatters.
