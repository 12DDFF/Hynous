# Hynous Documentation

> Central navigation hub for Hynous project documentation (v2).

Hynous is a personal crypto trading system with a mechanical entry/exit loop
and a post-trade LLM analysis pipeline. Authoritative design docs live in
`v2-planning/`.

---

## Start Here

| Document | Purpose |
|----------|---------|
| [`v2-planning/00-master-plan.md`](../v2-planning/00-master-plan.md) | Authoritative v2 plan — read first |
| [`CLAUDE.md`](../CLAUDE.md) | Conventions for AI agents working in this codebase |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | 4-component architecture + data flows |
| [`docs/integration.md`](./integration.md) | Cross-system data flows (daemon, journal, satellite, data-layer, dashboard) |

---

## Phase Docs (v2-planning/)

| Phase | Doc | Status |
|-------|-----|--------|
| 0 | `v2-planning/03-phase-0-branch-and-environment.md` | Complete |
| 1 | `v2-planning/04-phase-1-data-capture.md` | Complete |
| 2 | `v2-planning/05-phase-2-journal-module.md` | Complete |
| 3 | `v2-planning/06-phase-3-analysis-agent.md` | Complete |
| 4 | `v2-planning/07-phase-4-tier1-deletions.md` | Complete |
| 5 | `v2-planning/08-phase-5-mechanical-entry.md` | Complete |
| 6 | `v2-planning/09-phase-6-consolidation.md` | Complete |
| 7 | `v2-planning/10-phase-7-dashboard.md` | In progress |
| 8 | `v2-planning/11-phase-8-quant-improvements.md` | Pending |

Other v2-planning files: `01-pre-implementation-reading.md`,
`02-testing-standards.md`, baselines (`mypy-baseline.txt`,
`ruff-baseline.txt`, `pytest-baseline.txt`).

---

## Per-Component Documentation

| Area | Document |
|------|----------|
| Daemon + tools | [`src/hynous/intelligence/README.md`](../src/hynous/intelligence/README.md), [`src/hynous/intelligence/tools/README.md`](../src/hynous/intelligence/tools/README.md) |
| Market data | [`src/hynous/data/README.md`](../src/hynous/data/README.md) |
| Journal (v2) | [`src/hynous/journal/README.md`](../src/hynous/journal/README.md) |
| Analysis agent (v2) | `src/hynous/analysis/` (see phase 3 doc) |
| Mechanical entry (v2) | `src/hynous/mechanical_entry/` (see `v2-planning/08-phase-5-mechanical-entry.md`) |
| User chat (v2) | `src/hynous/user_chat/` (see phase 5 doc) |
| Satellite | [`satellite/README.md`](../satellite/README.md), [`satellite/training/README.md`](../satellite/training/README.md), [`satellite/artemis/README.md`](../satellite/artemis/README.md) |
| Data-layer service | [`data-layer/README.md`](../data-layer/README.md) |
| Core utilities | [`src/hynous/core/README.md`](../src/hynous/core/README.md) |
| Deployment | [`deploy/README.md`](../deploy/README.md) |

Note: component READMEs may reference v1 concepts (e.g. Nous) in historical
passages. Phase 4+ milestones gradually reconcile these with v2 reality;
trust the phase docs and `v2-planning/` over inline component READMEs when
they conflict.

---

## Active Revision Guides (docs/revisions/)

Mechanical trading system revisions. These are implemented features; guides
are kept for engineering reference.

| Guide | Purpose |
|-------|---------|
| `mechanical-exits/` | Trailing stops, breakeven, stop-tightening lockout, MFE/MAE tracking |
| `breakeven-fix/` | Two-layer breakeven + dynamic protective SL (vol-regime distances) |
| `trailing-stop-fix/` | Adaptive Trailing Stop v3 (continuous exponential retracement) |
| `ws-migration/` | Phase 1 market-data WS (implemented); Phase 2 (account data) deferred |
| `ws-price-feed/` | Superseded by `ws-migration/` |
| `entry-quality-rework/` | Composite entry score, ML pipeline fixes, adaptive weights |
| `trade-mechanism-debug/` | 5 mechanical-exit bug fixes |
| `realtime-price-data/` | 1-minute candle high/low MFE/MAE enhancement |
| `agent-exit-lockout/` | Agent cannot close positions during trailing phase |
| `feature-trimming/` | ML feature pruning |
| `tick-system-audit/` | Microstructure feature collector audit |
| `mc-fixes/` | Pending — phase 8 quant improvements |
| `llm-lookahead-trade/` | Concept doc (superseded, see entry-quality Phase 4) |
| `agent-trade-memory/` | v1 feature (deprecated under v2 architecture) |

---

## Archive (docs/archive/)

Historical v1 revision guides — all completed, kept for reference only.
Most describe Nous memory wiring, retrieval orchestrator, memory sections,
trade recall, token optimization, etc., which are being deleted in phase
4. See `docs/archive/README.md` for the index.

---

## For Agents

1. Read `v2-planning/00-master-plan.md`
2. Read the current phase doc (check `v2-planning/` for which phase is active)
3. Read `CLAUDE.md` for codebase conventions
4. Read `ARCHITECTURE.md` for the 4-component topology
5. Drill into component READMEs only for subsystems you are modifying
6. `docs/archive/` is historical — consult for v1 context, not for v2 guidance

Key conventions:
- New tools go in `src/hynous/intelligence/tools/`. If user-chat-invocable, add guidance to `src/hynous/user_chat/prompt.py` — the analysis agent does not call external tools.
- New pages go in `dashboard/dashboard/pages/` and register in `dashboard.py`
- Config changes go in `config/default.yaml` and are modeled in `src/hynous/core/config.py`

---

Last updated: 2026-04-12 (phase 7 M8 — docs hub refresh)
