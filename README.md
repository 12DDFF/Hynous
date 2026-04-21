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
│   ├── journal/             # v2 trade journal (schema, store, capture, counterfactuals, embeddings, consolidation, migrate_staging)
│   ├── analysis/            # v2 post-trade analysis (rules engine, LLM synthesis, wake integration, batch rejection)
│   ├── mechanical_entry/    # v2 mechanical entry loop (interface, ML-signal trigger, entry params, executor)
│   ├── user_chat/           # v2 user chat agent (agent, api, prompt) — mounted at /api/v2/chat/*
│   ├── data/                # Market data providers (Hyperliquid, Coinglass + WS feed manager)
│   └── core/                # Shared utilities (config, types, errors, logging, tracing)
│
├── dashboard/               # Reflex UI (Python → React, :3000) + /api/v2/journal/* + /api/v2/chat/* routes
│   ├── assets/              # Static files (data.html, ml.html, etc.)
│   ├── components/          # Reusable UI (card, chat, nav, ticker)
│   ├── pages/               # Dashboard pages
│   └── state.py             # Session + state management
│
├── satellite/               # ML feature engine (feature extraction, training, inference, 6 tick-direction models)
├── data-layer/              # Market data collection service (:8100)
│
├── config/                  # YAML configuration (default.yaml, theme.yaml)
├── deploy/                  # VPS deployment (2 systemd services: hynous, hynous-data)
├── scripts/                 # Entry points + utilities (run_dashboard, run_daemon)
├── tests/                   # Test suites (unit, integration, e2e)
├── docs/                    # Documentation + archived revisions
│   └── archive/             # Completed v1 revision docs (historical reference only)
├── v2-planning/             # v2 rebuild plan (master plan, phase docs, phase acceptance, testing standards)
└── storage/                 # Runtime data (gitignored)
    └── v2/                  # v2-specific state (journal.db, staging.db — migrated then retired)
```

---

## For Agents

If you're an AI agent working on this project:

1. **Read the v2 plan first:** `v2-planning/00-master-plan.md` — authoritative for all v2 work
2. **Phase status:** all 9 phases complete; see `v2-planning/phase-8-acceptance.md` for the most recent
3. **Architecture:** `ARCHITECTURE.md` explains how the 4 runtime components connect
4. **Patterns:** each major directory has a README explaining its conventions
5. **Stay modular:** one feature = one module. Don't mix concerns
6. **Tool registration:** new tools need both `registry.py` registration AND a mention in the consuming agent's prompt (`src/hynous/user_chat/prompt.py` for user-chat; the analysis agent doesn't call external tools). Registering alone is not enough.

---

## Key Files

| File | Purpose |
|------|---------|
| `config/default.yaml` | Main configuration (execution, daemon, scanner, satellite, v2) |
| `config/theme.yaml` | UI colors and styling |
| `src/hynous/intelligence/daemon.py` | Mechanical loop + journal writes + analysis agent triggers |
| `src/hynous/journal/store.py` | `JournalStore` — 9-table SQLite store with embeddings + semantic search |
| `src/hynous/analysis/` | Post-trade analysis pipeline (rules engine, LLM synthesis, wake integration) |
| `src/hynous/mechanical_entry/` | Mechanical entry loop (ML-signal trigger + executor) |
| `src/hynous/user_chat/` | User-chat LLM agent (read-only, not in the trade loop) |
| `dashboard/dashboard/dashboard.py` | Dashboard entry point + API proxies + journal/chat router mounts |
| `dashboard/dashboard/state.py` | Reflex state management |
| `v2-planning/00-master-plan.md` | Authoritative v2 plan |

---

## v2 Rebuild Status

**v2 rebuild complete (2026-04-13).** All 9 phases accepted. See `v2-planning/phase-8-acceptance.md`.

- [x] Phase 0: Branch & environment (config scaffolding, storage layout, baselines)
- [x] Phase 1: Data capture expansion (entry/exit snapshots, lifecycle events, counterfactuals)
- [x] Phase 2: Journal module (full SQLite store, embeddings, API routes, Amendments 9+10)
- [x] Phase 3: Analysis agent (deterministic rules + LLM synthesis, evidence validation, batch rejection cron)
- [x] Phase 4: Tier 1 deletions (Nous server + v1 memory tools + decision-injection modules)
- [x] Phase 5: Mechanical entry (ML-signal-driven trigger; LLM out of the trading path; user-chat agent scaffolded)
- [x] Phase 6: Consolidation & patterns (4 trade edge builders, weekly rollup cron)
- [x] Phase 7: Dashboard rework (journal page rewrite on `/api/v2/journal/*`, memory/graph pages deleted, 3→2 systemd services)
- [x] Phase 8: Quantitative improvements (tick downsample + 8 direction models, MC fixes, composite-score calibration, weight-update tightening, seeded MC RNG, direction-model retrain bridge)

**Final baselines:** 592 tests passing / 0 failing · mypy 223 · ruff src 51 · ruff dashboard 120 · 15 tools in registry.

### Post-v2 Additions

- **Kronos shadow predictor** (`src/hynous/kronos_shadow/`, 2026-04-15) — vendored Kronos foundation model (arXiv 2508.02739, AAAI 2026; MIT license) running alongside the live `MLSignalDrivenTrigger` as a read-only side car. Writes "would-fire" verdicts to `kronos_shadow_predictions`. Currently uses **Kronos-small** (24.7 M params, the largest variant feasible on a 2-vCPU VPS — Kronos-base / 102 M overflowed the 300 s tick cadence in live testing, Kronos-large / 499 M weights are not publicly released). See `v2-planning/12-kronos-shadow-integration.md`. Tests: 631 passed / 0 failed including 24 new shadow tests.
- **Standalone daemon service** (`deploy/hynous-daemon.service`) — runs `scripts/run_daemon` independently of the Reflex UI process. Decouples the mechanical loop from granian's ASGI worker lifecycle. **3 systemd services total**: `hynous` (UI), `hynous-data` (data layer :8100), `hynous-daemon` (mechanical loop + Kronos shadow).
- **Journal DB path unification** — `JournalStore` resolves relative `db_path` against project root so daemon (cwd `/opt/hynous`) and dashboard (cwd `/opt/hynous/dashboard`) write to the same file (`/opt/hynous/storage/v2/journal.db`). Prior split-brain caused dashboard to show stale data.
- **ML stack retrain (2026-04-20)** — direction model **v3** (`satellite/artifacts/v3/`, target switched from `risk_adj_30m` to peak ROE; daemon picks the highest `v*` dir at boot, so v3 is auto-loaded), 12 conditions retrained on 72K snapshots + `momentum_quality` added as active + `reversal_30m` added as disabled (13 active / 14 total), 6 tick direction models (10s/15s/20s/30s/60s/120s; 45s and 180s dropped as weak). New opt-in entry gate `v2.mechanical_entry.tick_confirmation_enabled` (off by default) requires the chosen tick horizon's sign to agree with the satellite direction.
- **⚠️ v3 outage + 13-issue audit (2026-04-21)** — **trading loop is halted**: v3 direction model produces 100 % skip in production. Kronos shadow log shows `live=skip` every 5 min while Kronos itself emits directional verdicts. Full diagnosis + audit of 13 latent v2 debt items lives in **`docs/revisions/v2-debug/README.md`**. Read the "For the Next Engineer" preamble before any fix work — sequencing is load-bearing and several items are gated on user decisions.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI | Reflex (Python-native, compiles to React) |
| Analysis agent | Claude (Anthropic) via LiteLLM / OpenRouter — post-trade only |
| User-chat agent | LiteLLM-backed, read-only tool surface (`search_trades`, `get_trade_by_id`) |
| Journal | Python SQLite (`JournalStore` in-process, 9-table schema, OpenAI text-embedding-3-small / 512-dim matryoshka) |
| Data | Hyperliquid (REST + WS), Coinglass |
| ML | Satellite (Python, XGBoost; 14 condition models / 13 active + 6 tick-direction models) |
| Deploy | Ubuntu 24.04, systemd (3 services: hynous + hynous-data + hynous-daemon), Caddy HTTPS |
| Shadow predictor | Kronos foundation model (vendored, MIT, CPU inference, opt-in via `[kronos-shadow]` extras) |
| Config | YAML (default.yaml, theme.yaml) |

---

*Last updated: 2026-04-21 (v3 production outage + `docs/revisions/v2-debug/` 13-issue audit)*
