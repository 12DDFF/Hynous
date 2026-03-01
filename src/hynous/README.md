# hynous

> Main Python package for the Hynous crypto intelligence system.

---

## Package Map

```
hynous/
├── core/           # Shared utilities (config, types, errors, logging, tracing, costs, analytics)
├── data/           # Market data providers (Hyperliquid, Coinglass, CryptoCompare, Perplexity, hynous-data)
├── discord/        # Discord bot — chat relay, daemon notifications, stats panel
├── intelligence/   # LLM agent brain (agent, daemon, tools, prompts, scanner, retrieval)
├── nous/           # Python HTTP client for the Nous TypeScript memory server
└── __init__.py     # Package root (v0.1.0)
```

---

## How They Relate

```
                    ┌──────────────┐
                    │  intelligence │  LLM agent + daemon + tools
                    └──────┬───────┘
                           │ uses
              ┌────────────┼────────────┐
              v            v            v
         ┌────────┐  ┌─────────┐  ┌─────────┐
         │  data  │  │  nous   │  │  core   │
         │        │  │         │  │         │
         │ market │  │ memory  │  │ config  │
         │ prices │  │ search  │  │ types   │
         │ trades │  │ edges   │  │ tracing │
         └────────┘  └─────────┘  └─────────┘
              ^                        ^
              │                        │
         ┌────────┐                    │
         │discord │────────────────────┘
         │ bot    │  (shares Agent singleton, reads config)
         └────────┘
```

- **`core`** is a dependency of every other module. Config, types, errors, logging, and tracing all live here.
- **`intelligence`** is the central module. It imports from `data` (market reads + execution), `nous` (memory CRUD + search), and `core` (config, tracing).
- **`data`** has no internal dependencies on other hynous modules (except `core` for config loading in `hynous_data.py`).
- **`nous`** is a thin HTTP client. It connects to the Nous TypeScript server on `:3100`.
- **`discord`** runs in a background thread alongside the dashboard. It shares the Agent singleton from `intelligence` for chat relay, and reads from `data` and `intelligence` for the stats panel.

---

## Entry Points

| Script | What it starts |
|--------|----------------|
| `scripts/run_dashboard.py` | Reflex dashboard (`:3000`) + Discord bot (background thread) |
| `scripts/run_daemon.py` | Agent daemon (autonomous background loop) |

---

## Version

`0.1.0` (defined in `__init__.py`)

---

Last updated: 2026-03-01
