# Hynous

> Personal crypto trading system. v2 runs a mechanical entry/exit loop and a
> post-trade LLM analysis pipeline. Active development on the `v2` branch.
> v2 will never merge back into `main`.
>
> Authoritative v2 plan: `v2-planning/00-master-plan.md`.

---

## Quick Start

```bash
# Install dependencies
pip install -e .

# Run dashboard (UI + daemon + journal in-process)
python -m scripts.run_dashboard

# Run daemon standalone (smoke tests / development)
python -m scripts.run_daemon [--duration 300] [--log-level INFO]
```

---

## Project Structure

```
hynous/
├── src/hynous/              # Main Python application
│   ├── intelligence/        # Daemon + scanner + trading tools + prompts
│   ├── journal/             # v2 trade journal (schema, store, capture, counterfactuals, embeddings, migrate_staging)
│   ├── analysis/            # v2 post-trade analysis (rules engine, LLM synthesis, wake integration, batch rejection)
│   ├── data/                # Market data providers (Hyperliquid, Coinglass, CryptoCompare, etc. + WS feed manager)
│   ├── discord/             # Discord bot integration
│   └── core/                # Shared utilities (config, types, errors, logging, tracing)
│
├── dashboard/               # Reflex UI (Python → React, :3000) + /api/v2/journal/* routes
│   ├── assets/              # Static files (graph.html, data.html, ml.html, etc.)
│   ├── components/          # Reusable UI (card, chat, nav, ticker)
│   ├── pages/               # Dashboard pages
│   └── state.py             # Session + state management
│
├── satellite/               # ML feature engine (feature extraction, training, inference)
├── data-layer/              # Market data collection service (:8100)
│
├── config/                  # YAML configuration (default.yaml, theme.yaml)
├── deploy/                  # VPS deployment (2 systemd services: hynous, hynous-data)
├── scripts/                 # Entry points + utilities (run_dashboard, run_daemon)
├── tests/                   # Test suites (unit, integration, e2e)
├── docs/                    # Documentation + archived revisions
│   └── archive/             # Completed v1 revision docs (historical reference only)
├── v2-planning/             # v2 rebuild plan (master plan, phase docs, testing standards)
└── storage/                 # Runtime data (gitignored)
    └── v2/                  # v2-specific state (journal.db, staging.db)
```

---

## For Agents

If you're an AI agent working on this project:

1. **Read the v2 plan first:** `v2-planning/00-master-plan.md` — authoritative for all v2 work
2. **Current phase:** check `v2-planning/07-phase-4-tier1-deletions.md`
3. **Architecture:** `ARCHITECTURE.md` explains how the 4 runtime components connect
4. **Patterns:** each directory has a README explaining its conventions
5. **Stay modular:** one feature = one module. Don't mix concerns
6. **Tool registration:** new tools need both `registry.py` registration AND `prompts/builder.py` system prompt guidance — registering alone is not enough

---

## Key Files

| File | Purpose |
|------|---------|
| `config/default.yaml` | Main configuration (execution, daemon, scanner, satellite, v2) |
| `config/theme.yaml` | UI colors and styling |
| `src/hynous/intelligence/daemon.py` | Mechanical loop + journal writes + analysis agent triggers |
| `src/hynous/journal/store.py` | `JournalStore` — 9-table SQLite store with embeddings + semantic search |
| `src/hynous/analysis/` | Post-trade analysis pipeline (rules engine, LLM synthesis, wake integration) |
| `dashboard/dashboard/dashboard.py` | Dashboard entry point + API proxies + journal router mount |
| `dashboard/dashboard/state.py` | Reflex state management |
| `v2-planning/00-master-plan.md` | Authoritative v2 plan |

---

## v2 Rebuild Status

See `v2-planning/00-master-plan.md` for full plan details.

- [x] Phase 0: Branch & environment (config scaffolding, storage layout, baselines)
- [x] Phase 1: Data capture expansion (entry/exit snapshots, lifecycle events, counterfactuals)
- [x] Phase 2: Journal module (full SQLite store, embeddings, API routes, Amendments 9+10)
- [x] Phase 3: Analysis agent (deterministic rules + LLM synthesis, evidence validation, batch rejection cron)
- [ ] **Phase 4 (in progress): Tier 1 deletions (Nous server, v1 memory tools, dashboard Nous cleanup in phase 7)**
- [ ] Phase 5: Mechanical entry (EntryTriggerSource, ML-signal-driven, remove LLM from trading)
- [ ] Phase 6: Consolidation & patterns (trade edges, weekly rollup cron)
- [ ] Phase 7: Dashboard rework (journal page rewrite, delete memory/graph pages)
- [ ] Phase 8: Quantitative improvements (tick model fix, MC fixes, composite calibration)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI | Reflex (Python-native, compiles to React) |
| Analysis agent | Claude (Anthropic) via LiteLLM — post-trade only |
| Journal | Python SQLite (`JournalStore` in-process, 9-table schema, OpenAI text-embedding-3-small) |
| Data | Hyperliquid SDK, Coinglass, CryptoCompare, Perplexity |
| ML | Satellite (Python, scikit-learn / XGBoost) |
| Deploy | Ubuntu 24.04, systemd (2 services: hynous + hynous-data), Caddy HTTPS |
| Config | YAML (default.yaml, theme.yaml) |

---

*Last updated: 2026-04-12 (phase 4 M6a — Nous server deleted, 5→4 component architecture)*
