# Hynous

> ⚠️ **v2 branch notice:** This is the `v2` branch of Hynous, a ground-up refactor.
> v2 will never be merged into `main`. For v1 architecture and usage, see `main`.
> For the v2 rebuild plan, see `v2-planning/00-master-plan.md`.

> Personal crypto intelligence system. v2 replaces the LLM-driven trading agent
> with a mechanical entry/exit loop and a post-trade LLM analysis pipeline.

---

## Quick Start

```bash
# Install dependencies
pip install -e .

# Run dashboard (UI + agent + daemon)
python -m scripts.run_dashboard

# Run daemon standalone (smoke tests / development)
python -m scripts.run_daemon [--duration 300] [--log-level INFO]

# Nous memory server (v1 — still running in parallel until phase 4 removes it)
cd nous-server && pnpm install && pnpm build && pnpm start
```

---

## Project Structure

```
hynous/
├── src/hynous/              # Main Python application
│   ├── intelligence/        # LLM agent brain (agent, daemon, tools, prompts, scanner)
│   ├── journal/             # v2 trade journal (schema, staging_store, capture, counterfactuals)
│   ├── analysis/            # v2 analysis agent (scaffold — phase 3 populates)
│   ├── nous/                # Python HTTP client for Nous memory API (v1 — removed in phase 4)
│   ├── data/                # Market data providers (Hyperliquid, Coinglass, CryptoCompare, Perplexity)
│   ├── discord/             # Discord bot integration
│   └── core/                # Shared utilities (config, types, errors, logging, tracing)
│
├── dashboard/               # Reflex UI (Python → React, :3000)
│   ├── assets/              # Static files (graph.html, brain.html, data.html, ml.html)
│   ├── components/          # Reusable UI (card, chat, nav, ticker)
│   ├── pages/               # 10 pages (see below)
│   └── state.py             # Session + agent state management
│
├── satellite/               # ML feature engine (feature extraction, labeling, training, inference)
├── data-layer/              # Market data collection service (TypeScript-adjacent, :8100)
├── nous-server/             # TypeScript memory system (@nous/core + Hono server, :3100)
│   ├── core/                # 30+ modules (SSA, QCS, retrieval, embeddings, sections, decay)
│   └── server/              # HTTP routes (nodes, edges, search, classify, graph, health)
│
├── config/                  # YAML configuration (default.yaml, theme.yaml)
├── deploy/                  # VPS deployment (systemd services, setup.sh)
├── scripts/                 # Entry points + utilities (run_dashboard, run_daemon)
├── tests/                   # Test suites (unit, integration, e2e)
├── docs/                    # Documentation + archived revisions
│   └── archive/             # Completed revision docs (nous-wiring, memory-sections, etc.)
├── v2-planning/             # v2 rebuild plan (9 phases, master plan, testing standards)
└── storage/                 # Runtime data (traces, payloads) — gitignored
    └── v2/                  # v2-specific state (staging.db, journal.db)
```

---

## Dashboard Pages

| Page | Description |
|------|-------------|
| **Home** | Portfolio overview, positions, PnL, market scanner |
| **Chat** | Conversational interface with Hynous agent |
| **Journal** | Trade journal with entry/exit reasoning |
| **Memory** | Memory graph visualization + brain section viewer |
| **Graph** | Full force-directed knowledge graph |
| **Data** | Market data explorer (candles, orderbook, funding) |
| **ML** | Satellite engine status, features, predictions |
| **Settings** | Configuration and daemon controls |
| **Debug** | Request trace timeline + span inspector |
| **Login** | Authentication gate |

---

## Agent Tools

28 tools across 21 modules in `src/hynous/intelligence/tools/`:

**Market data:** market, orderbook, funding, multi_timeframe, liquidations, options, institutional, sentiment, data_layer, market_watch, web_search

**Trading:** trading (open/close/modify/list), trade_stats, costs, watchpoints

**Memory:** memory (recall/store/update), explore_memory, delete_memory, clusters, conflicts, pruning

---

## For Agents

If you're an AI agent working on this project:

1. **Read first:** `ARCHITECTURE.md` explains how all four layers connect
2. **Check docs:** `docs/archive/` has all completed revision history — start with `docs/archive/nous-wiring/executive-summary.md` for the Nous integration story
3. **All revisions complete** — Nous wiring, memory search, trade recall, trade debug, token optimization, memory pruning, memory sections, brain visualization, portfolio tracking, ML wiring, mechanical exits, real-time price data, and agent trade memory all fully implemented
4. **Follow patterns:** Each directory has a README explaining conventions
5. **Stay modular:** One feature = one module. Don't mix concerns
6. **Tool registration:** New tools need both `registry.py` registration AND `prompts/builder.py` system prompt guidance — registering alone is not enough

---

## Key Files

| File | Purpose |
|------|---------|
| `config/default.yaml` | Main configuration (agent, memory, scanner, satellite) |
| `config/theme.yaml` | UI colors and styling |
| `src/hynous/intelligence/agent.py` | Hynous agent core (Claude reasoning + tool loop) |
| `src/hynous/intelligence/daemon.py` | Background daemon (scanner, decay, events, cron) |
| `src/hynous/intelligence/tools/registry.py` | Tool registration (28 tools) |
| `dashboard/dashboard/dashboard.py` | Dashboard entry point + API proxies |
| `dashboard/dashboard/state.py` | Reflex state management |
| `nous-server/server/src/index.ts` | Nous HTTP server entry point |
| `docs/archive/nous-wiring/executive-summary.md` | Nous integration issue overview |

---

## v2 Rebuild Status

See `v2-planning/00-master-plan.md` for full plan details.

- [x] Phase 0: Branch & environment (config scaffolding, storage layout, baselines)
- [x] Phase 1: Data capture expansion (entry/exit snapshots, lifecycle events, counterfactuals)
- [x] Phase 2: Journal module (full SQLite store, embeddings, API routes, Amendments 9+10)
- [ ] **Phase 3 (next): Analysis agent (deterministic rules + LLM synthesis, evidence validation)**
- [ ] Phase 4: Tier 1 deletions (~106K LOC: Nous, coach, consolidation, memory tools)
- [ ] Phase 5: Mechanical entry (EntryTriggerSource, ML-signal-driven, remove LLM from trading)
- [ ] Phase 6: Consolidation & patterns (trade edges, weekly rollup cron)
- [ ] Phase 7: Dashboard rework (journal page rewrite, delete memory/graph pages)
- [ ] Phase 8: Quantitative improvements (tick model fix, MC fixes, composite calibration)

### Phase 2 summary (done 2026-04-12)

8 commits on `v2` (M1–M8, all tagged `[phase-2]`):

| Milestone | Purpose |
|---|---|
| M1 `ee2c8d9` | Amendment 9 — `entry/exit_snapshot_from_dict` round-trip helpers |
| M2 `e97453a` | `JournalStore` + 9-table schema + CRUD + daemon-compat methods |
| M3 `ed3591f` | `EmbeddingClient` (OpenAI text-embedding-3-small, matryoshka 512) + cosine + semantic search |
| M4 `d658bea` | FastAPI `/api/v2/journal/*` routes + dashboard mount |
| M5 `6946bc7` | `migrate_staging.py` — idempotent, per-row corruption-isolated |
| M6 `c0a9ed2` | Amendment 10 — data-layer 30m window + `large_trade_count` + backfill of `_build_order_flow_state` / `_build_smart_money_context` |
| M7 `ee000a9` | Daemon `StagingStore → JournalStore` swap + auto-migration flag |
| M8 `3f8b8f7` | `run_daemon.py` class-name fix + 30s smoke verified |

Tests: 881 passed / 1 pre-existing failure (baseline 824 + 57 new).
mypy: 333 baseline preserved.
ruff: 108 baseline preserved.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI | Reflex (Python-native, compiles to React) |
| Agent | Claude (Anthropic) via LiteLLM — v2: post-trade analysis only |
| Journal | Python SQLite (v2) — replaces Nous TypeScript memory server |
| Data | Hyperliquid SDK, Coinglass, CryptoCompare, Perplexity |
| ML | Satellite (Python, scikit-learn/XGBoost) |
| Deploy | Ubuntu 24.04, systemd, Caddy HTTPS |
| Config | YAML (default.yaml, theme.yaml) |

---

*Last updated: 2026-04-12 (v2 phase 2 complete; phase 3 next)*
