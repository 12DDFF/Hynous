# Hynous

> Personal crypto intelligence system with an autonomous LLM trading agent.

---

## Quick Start

```bash
# Install dependencies
pip install -e .

# Run dashboard (UI + agent + daemon)
python -m scripts.run_dashboard

# Nous memory server (TypeScript — separate process)
cd nous-server && pnpm install && pnpm build && pnpm start
```

---

## Project Structure

```
hynous/
├── src/hynous/              # Main Python application
│   ├── intelligence/        # LLM agent brain (agent, daemon, tools, prompts, scanner)
│   ├── nous/                # Python HTTP client for Nous memory API
│   ├── data/                # Market data providers (Hyperliquid, Binance, CryptoQuant)
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
├── scripts/                 # Entry points + utilities
├── tests/                   # Test suites (unit, integration, e2e)
├── docs/                    # Documentation + archived revisions
│   └── archive/             # Completed revision docs (nous-wiring, memory-sections, etc.)
└── storage/                 # Runtime data (traces, payloads) — gitignored
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
3. **All revisions complete** — Nous wiring, memory search, trade recall, trade debug, token optimization, memory pruning, memory sections, and brain visualization all fully implemented
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

## Status

- [x] Phase 1: Dashboard skeleton
- [x] Phase 2: Chat with Hynous
- [x] Phase 3: Tools (28 tools, market scanner, Discord bot)
- [x] Phase 4: Paper trading (conviction-sized, micro/swing types)
- [x] Satellite ML engine (feature extraction, labeling, training, inference)
- [x] Brain-inspired memory sections (4-section model, playbook matcher, bias layer)
- [x] Brain visualization (sagittal SVG + per-section force graphs)
- [ ] Phase 5: Live trading

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI | Reflex (Python-native, compiles to React) |
| Agent | Claude (Anthropic) via LiteLLM |
| Memory | @nous/core (TypeScript) via HTTP API |
| Data | Hyperliquid SDK, Binance, CryptoQuant |
| ML | Satellite (Python, scikit-learn/XGBoost) |
| Deploy | Ubuntu 24.04, systemd, Caddy HTTPS |
| Config | YAML (default.yaml, theme.yaml) |

---

*Last updated: 2026-03-01*
