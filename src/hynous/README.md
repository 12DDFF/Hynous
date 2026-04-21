# hynous

> Main Python package for the Hynous v2 crypto trading system.

---

## Package Map

```
hynous/
├── core/              # Shared utilities (config, clock, costs, persistence, tracing, trading_settings)
├── data/              # Market data providers (Hyperliquid REST+WS, Coinglass, hynous-data client, Paper sim)
├── intelligence/      # Mechanical trading loop — daemon, scanner, regime, tools (user-chat surface only)
├── journal/           # v2 trade journal (9-table SQLite + embeddings + FastAPI router + migration)
├── analysis/          # Post-trade LLM analysis pipeline (rules + synthesis + validation + batch rejection)
├── mechanical_entry/  # Pluggable entry trigger + deterministic param computation + executor
├── user_chat/         # Read-only LLM chat agent mounted at /api/v2/chat/*
├── kronos_shadow/     # Read-only Kronos foundation-model shadow predictor
└── __init__.py        # Package root (v0.1.0)
```

---

## Dependency Direction

```
                 ┌──────────────┐
                 │ mechanical_  │──uses──┐
                 │   entry      │        │
                 └──────────────┘        ▼
                                 ┌──────────┐
                 ┌──────────────┐│ journal  │
                 │  analysis    │┤          │
                 └──────────────┘│          │
                                 ├──────────┤
                 ┌──────────────┐│   data   │
                 │ intelligence │┤          │
                 │   (daemon)   ││          │
                 └──────────────┘│   core   │
                                 └──────────┘
                 ┌──────────────┐
                 │  user_chat   │──uses── tools/search_trades, tools/get_trade_by_id
                 └──────────────┘
                 ┌──────────────┐
                 │ kronos_shadow│──uses── journal.store._write_lock, data.providers
                 └──────────────┘
```

- `core` has no internal dependencies on other hynous modules (except reading its own config).
- `intelligence.daemon` is the trading-loop orchestrator: imports from `journal` (capture + store), `analysis` (`trigger_analysis_async`), `mechanical_entry` (entry trigger + executor), `kronos_shadow` (side predictor), and `data` (providers).
- LLM is out of the trade-execution path. The daemon does not wake an LLM. The only LLM surfaces are `analysis/` (post-trade, background thread) and `user_chat/` (HTTP request/response).

---

## Entry Points

| Script | Starts |
|--------|--------|
| `scripts/run_dashboard.py` | Reflex dashboard (`:3000`) + FastAPI routers (`/api/v2/journal/*`, `/api/v2/chat/*`) mounted in-process |
| `scripts/run_daemon.py` | Standalone trading daemon (mechanical loop + Kronos shadow tick, 3rd systemd unit) |

Data layer runs as a separate service — see `data-layer/scripts/run.py` (`:8100` FastAPI).

---

## Version

`0.1.0` (defined in `__init__.py`)

---

Last updated: 2026-04-21 (v2-debug H4 — removed references to deleted `discord/` and `nous/` modules, refreshed dependency graph for v2 layout)
