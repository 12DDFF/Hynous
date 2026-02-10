# Hynous Architecture

> How the system fits together. Read this before making changes.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    REFLEX DASHBOARD (Python)                             │
│                         localhost:3000                                   │
│  ┌─────────────┐  ┌─────────────┐                                       │
│  │    Home     │  │    Chat     │  ... future pages                     │
│  └──────┬──────┘  └──────┬──────┘                                       │
└─────────┼────────────────┼──────────────────────────────────────────────┘
          │                │
          └───────┬────────┘
                  │
┌─────────────────┼───────────────────────────────────────────────────────┐
│                 │        FASTAPI GATEWAY (Python)                        │
│                 │           localhost:8000                               │
│                 ▼                                                        │
│  ┌─────────────────────────┐                                            │
│  │      HYNOUS AGENT       │ ◄── Hynous lives here                      │
│  │  • Claude API reasoning │                                            │
│  │  • Tool calling loop    │                                            │
│  │  • Event-driven + cron  │                                            │
│  └───────────┬─────────────┘                                            │
│              │                                                           │
│      ┌───────┼───────┬───────────────┐                                  │
│      │       │       │               │                                  │
│      ▼       ▼       ▼               ▼                                  │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌──────────┐                            │
│  │ Hydra │ │ Nous  │ │Events │ │ Daemon   │                            │
│  │ Tools │ │Client │ │       │ │          │                            │
│  │(direct)│ │(HTTP) │ │detect │ │24/7 loop │                            │
│  └───┬───┘ └───┬───┘ └───────┘ └──────────┘                            │
└──────┼─────────┼────────────────────────────────────────────────────────┘
       │         │
       │         │ HTTP (~5ms)
       │         ▼
       │  ┌─────────────────────────────────────────┐
       │  │         NOUS API (TypeScript)            │
       │  │         Hono - localhost:3100            │
       │  │                                          │
       │  │  • SSA retrieval algorithm               │
       │  │  • Two-phase cognition                   │
       │  │  • FSRS memory decay                     │
       │  │  • Vector embeddings                     │
       │  └─────────────────┬───────────────────────┘
       │                    │
       │                    ▼
       │            ┌───────────────┐
       │            │    SQLite     │
       │            │   (nous.db)   │
       │            └───────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           HYDRA (Python)                                  │
│                                                                          │
│  ┌─────────────────────┐      ┌─────────────────────┐                   │
│  │    Data Sources     │      │     Execution       │                   │
│  │                     │      │                     │                   │
│  │ • Hyperliquid       │      │ • Order placement   │                   │
│  │ • Binance           │      │ • Position mgmt     │                   │
│  │ • CryptoQuant       │      │ • Risk controls     │                   │
│  └─────────────────────┘      └─────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

### `src/hynous/intelligence/` — The Brain

The LLM agent that thinks, reasons, and acts.

| Module | Responsibility |
|--------|----------------|
| `agent.py` | Claude API wrapper, tool calling loop |
| `prompts/` | System prompts (identity, trading knowledge) |
| `tools/` | Tool definitions and handlers |
| `events/` | Event detection and triggers |
| `daemon.py` | Background loop for autonomous operation |

### `src/hynous/nous/` — The Memory Client

Python client for the Nous TypeScript API.

| Module | Responsibility |
|--------|----------------|
| `client.py` | HTTP client for Nous API |
| `types.py` | Python types matching Nous schemas |

**Note:** Nous itself is a TypeScript service. We call it via HTTP API.
See `storm-013-nous-http-api.md` in the brainstorm for the full API spec.

### `src/hynous/data/` — The Senses

Market data from external sources.

| Module | Responsibility |
|--------|----------------|
| `providers/` | Data source wrappers |
| `hyperliquid.py` | Hyperliquid API (prices, funding, execution) |
| `binance.py` | Binance API (historical data) |
| `cryptoquant.py` | CryptoQuant API (on-chain metrics) |

### `src/hynous/core/` — The Foundation

Shared utilities used everywhere.

| Module | Responsibility |
|--------|----------------|
| `config.py` | Configuration loading |
| `types.py` | Shared type definitions |
| `errors.py` | Custom exceptions |
| `logging.py` | Logging setup |

### `dashboard/` — The Face

User interface built with Reflex (Python → React).

| Module | Responsibility |
|--------|----------------|
| `rxconfig.py` | Reflex configuration |
| `dashboard/dashboard.py` | App entry point, routing |
| `dashboard/state.py` | Reactive state management |
| `dashboard/components/` | Reusable UI components |
| `dashboard/pages/` | Page components (home, chat) |

Run with: `cd dashboard && reflex run`

---

## Data Flow

### User Chat Flow

```
User types message
    │
    ▼
dashboard/pages/chat.py
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
    │    nous/client.py → Nous API (:3100)
    │
    ▼
Response returned to dashboard
    │
    ▼
User sees Hynous response
```

### Event-Driven Flow

```
daemon.py (every minute)
    │
    ▼
events/detector.py (check conditions)
    │
    ├── funding > threshold?
    ├── price move > threshold?
    │
    ▼ (if event detected)
intelligence/agent.py (analyze_event)
    │
    ├──► Search memory for similar events
    ├──► Reason about implications
    ├──► Decide: trade / wait / pass
    │
    ▼ (if trade decision)
tools/trading.py (execute_trade)
    │
    ▼
data/hyperliquid.py (place order)
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI Framework | Reflex | Python-native, compiles to React |
| Memory System | Nous (TypeScript) via HTTP | Too complex to reimplement, ~5ms overhead acceptable |
| LLM | Claude (Anthropic) | Best reasoning, good tool use |
| Agent-Hydra | Direct import | Zero overhead, same Python process |
| Agent-Nous | HTTP API | Nous is TypeScript, clean separation |
| Config | YAML files | Human readable, easy to edit |

---

## Extension Points

### Adding a New Tool

1. Create handler in `src/hynous/intelligence/tools/`
2. Register in `tools/registry.py`
3. Tool is automatically available to agent

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
├── theme.yaml       # UI styling
└── tools.yaml       # Tool-specific config (future)
```

Config is loaded once at startup and passed through the system.

---

## Testing Strategy

```
tests/
├── unit/            # Test individual functions
│   ├── test_agent.py
│   ├── test_nous.py
│   └── test_tools.py
│
├── integration/     # Test component interactions
│   ├── test_chat_flow.py
│   └── test_event_flow.py
│
└── e2e/             # Test full user flows
    └── test_dashboard.py
```

---

## Known Issues & Revisions

The `revisions/` directory contains documented issues and planned improvements, organized by scope:

### `revisions/revision-exploration.md`

Master list of 19 issues across the entire codebase, prioritized P0 through P3. Covers retrieval bugs, daemon failures, missing tools, and system prompt inaccuracies.

### `revisions/nous-wiring/`

Focused on the Nous ↔ Python integration layer. Start with `executive-summary.md` for the high-level issue categories, then dive into:

- **`nous-wiring-revisions.md`** — 10 wiring issues (NW-1 to NW-10) — **all 10 FIXED** (field name mismatches, retrieval truncation, silent failures, missing tools)
- **`more-functionality.md`** — 16 Nous capabilities (MF-0 to MF-15). **14 DONE, 2 SKIPPED (MF-11, MF-14), 0 remaining.** All items resolved. Completed: MF-0 (search-before-store dedup), MF-1 through MF-10 (Hebbian learning, batch decay, contradiction queue, update tool, graph traversal, browse-by-type, time-range search, health check, embedding backfill, QCS logging), MF-12 (contradiction resolution execution), MF-13 (cluster management), MF-15 (gate filter for memory quality). Skipped: MF-11 (working memory — overlaps with FSRS decay + dedup + Hebbian), MF-14 (edge decay — Hebbian strengthening already provides signal discrimination)

**If you're working on Nous integration, read the executive summary first.** It explains the overall landscape and current status.

---

## For Future Agents

When working on this codebase:

1. **Check revisions first** — `revisions/` has known issues that may affect your work
2. **Check existing patterns** — Don't reinvent, extend
3. **Keep modules focused** — One responsibility per file
4. **Update this doc** — If you change architecture, document it
5. **Test your changes** — Don't break what works
