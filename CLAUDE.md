# CLAUDE.md — Hynous Project Guide

> Essential conventions for AI agents working on the `v2` branch.
> Authoritative v2 plan lives in `v2-planning/00-master-plan.md`.

---

## Project Overview

Hynous (v2) is a personal crypto trading system with a mechanical entry/exit
loop and a post-trade LLM analysis pipeline. Python 3.11+.

The v1 LLM-in-the-loop trading agent, TypeScript Nous memory server, and most
memory tooling have been removed. The current system writes every trade
lifecycle event to a local SQLite journal at `storage/v2/journal.db` and
analyzes trades after they close.

**5 runtime components / 3 systemd services:**

| Component | Port | Service | Purpose |
|-----------|------|---------|---------|
| Reflex Dashboard | `:3000` | `hynous` | UI (granian frontend) |
| FastAPI Gateway | `:8000` | `hynous` | journal API + chat API + analysis agent (in-process) |
| Data Layer | `:8100` | `hynous-data` | Market data collection + analytics |
| Mechanical Daemon | (in-process) | `hynous-daemon` | Entry/exit loop + Kronos shadow predictor (`scripts/run_daemon`, standalone since 2026-04-15) |
| Satellite | (in-process inside daemon) | `hynous-daemon` | ML feature engine + XGBoost inference |

The journal SQLite file (`storage/v2/journal.db`) is shared between `hynous` and `hynous-daemon` — `JournalStore.__init__` resolves the relative `db_path` against project root so both processes land on the same file regardless of CWD.

---

## Directory Structure

```
hynous/
├── src/hynous/          # Main Python application
│   ├── intelligence/    # Daemon, scanner, tools, prompts (v2: mechanical loop, no autonomous LLM)
│   ├── journal/         # v2 trade journal (schema, store, capture, counterfactuals, embeddings, consolidation, migrate_staging)
│   ├── analysis/        # v2 post-trade analysis agent (rules engine + LLM synthesis + wake integration)
│   ├── mechanical_entry/ # v2 mechanical entry loop (interface, ml_signal_driven trigger, entry_params, executor)
│   ├── user_chat/       # v2 user chat agent (agent, api, prompt) — mounted at `/api/v2/chat/*`
│   ├── kronos_shadow/   # Kronos foundation-model shadow predictor (post-v2; vendor/ holds upstream MIT code)
│   ├── data/            # Market data providers (Hyperliquid, Coinglass + WS feed manager)
│   └── core/            # Shared utilities (config, types, tracing, trading_settings)
├── dashboard/           # Reflex UI + `/api/v2/journal/*` FastAPI router
├── satellite/           # ML feature engine (XGBoost condition models, walk-forward)
├── data-layer/          # Standalone data collection service
├── config/              # YAML configuration (default.yaml, theme.yaml)
├── deploy/              # VPS deployment (3 systemd services: hynous, hynous-data, hynous-daemon; setup.sh)
├── scripts/             # Entry points (run_dashboard.py, run_daemon.py)
├── tests/               # Test suites (unit, integration, e2e)
├── docs/                # Documentation hub + archived revisions
├── v2-planning/         # v2 rebuild plan (phase docs, master plan, testing standards)
└── storage/             # Runtime data (gitignored)
    └── v2/              # journal.db + staging.db (migrated then retired)
```

---

## Key Extension Patterns

### Adding a New Tool

1. **Create handler** in `src/hynous/intelligence/tools/my_tool.py`
2. **Register** in `src/hynous/intelligence/tools/registry.py`:
   ```python
   from . import my_tool
   my_tool.register(registry)
   ```
3. **Mention it in the consuming agent's prompt** — registry registration alone is not enough; the agent will not use a tool it doesn't see described. The two LLM surfaces in v2:
   - **User chat** (`src/hynous/user_chat/prompt.py`) — only consumes `search_trades` and `get_trade_by_id` today. Add guidance here if the new tool is user-chat-invocable.
   - **Analysis agent** (`src/hynous/analysis/prompts.py`) — post-trade; does not call external tools (structured JSON output only).

Tools registered in `registry.py` are the canonical surface; keep scope narrow.

### Adding a New Dashboard Page

1. Create page in `dashboard/dashboard/pages/my_page.py`
2. Add route in `dashboard/dashboard/dashboard.py`
3. Add nav item in `dashboard/dashboard/components/nav.py`
4. Add state vars in `dashboard/dashboard/state.py` if needed

### Adding a New Data Provider

1. Create provider in `src/hynous/data/providers/my_provider.py`
2. Export in `src/hynous/data/__init__.py`
3. Create corresponding tool in `src/hynous/intelligence/tools/`

---

## Configuration

All config in `config/default.yaml`. Loaded by `src/hynous/core/config.py` → `load_config()`.

Top-level dataclasses include AgentConfig, ExecutionConfig, HyperliquidConfig,
DaemonConfig, ScannerConfig, DataLayerConfig, SatelliteConfig, V2Config
(journal / analysis_agent / mechanical_entry / consolidation / user_chat
sub-configs), and Config (root).

**Environment variables** (in `.env`, never committed):
```
OPENROUTER_API_KEY=sk-or-...        # LLM providers via OpenRouter
HYPERLIQUID_PRIVATE_KEY=...          # Exchange wallet
OPENAI_API_KEY=...                   # Journal + analysis-agent embeddings (text-embedding-3-small)
COINGLASS_API_KEY=...               # Derivatives data (optional)
```

---

## Branches & Deployment

v2 lives on the `v2` branch. It will never merge back into `main` — main
tracks the v1 system and is being retired.

| Branch | Purpose | VPS Path | Deploys to |
|--------|---------|----------|------------|
| `v2` | v2 trading system (mechanical loop + analysis agent) | `/opt/hynous` | Ports 3000 / 8000 |

**Deploy workflow:**
```bash
git push origin v2
ssh vps "cd /opt/hynous && sudo -u hynous git pull && sudo systemctl restart hynous"
```

**VPS services:**
```bash
sudo systemctl restart hynous        # Dashboard + daemon + journal (in-process)
sudo systemctl restart hynous-data   # Data layer (:8100)
```

---

## Running

```bash
# Dashboard (development)
cd dashboard && reflex run

# Daemon (background mechanical loop)
python -m scripts.run_daemon

# Data layer
cd data-layer && make run
```

---

## Testing

```bash
# Python tests (requires PYTHONPATH=src)
PYTHONPATH=src pytest tests/

# Satellite tests
PYTHONPATH=. pytest satellite/tests/

# Data layer tests
cd data-layer && pytest tests/
```

Phase 4 is complete; the canonical CE-ignore list has been fully retired
(M6b deleted the orphan test files and `pytest tests/` now runs
unrestricted). Current baseline (phase 8 complete): `592 passed / 0 failed`.

---

## v2 Rebuild Status

**v2 rebuild complete** (2026-04-13) — all 9 phases accepted. See `v2-planning/phase-8-acceptance.md`.

---

## Phase Status

- **Phase 0** complete (2026-04-09) — branch + V2Config scaffold + baselines pinned
- **Phase 1** complete (2026-04-10) — rich entry/exit snapshots, 8 lifecycle events, StagingStore, counterfactuals, `scripts/run_daemon.py`
- **Phase 2** complete (2026-04-12) — `JournalStore`, 9-table schema, embeddings (matryoshka 512-dim), FastAPI routes at `/api/v2/journal/*`, staging→journal migration, daemon swap
- **Phase 3** complete (2026-04-12) — post-trade analysis agent at `src/hynous/analysis/` (rules engine + LLM synthesis + validation + wake integration + batch rejection cron)
- **Phase 4** complete (2026-04-12) — Nous server + Python client deleted, 9 decision-injection modules removed, 8 v1 memory tools removed, unused coinglass methods + perplexity/cryptocompare out, prompt trimmed ~40%, `scripts/run_daemon.py` standalone, `pytest tests/` = 482p/0f. Deferred to phase 7: `trade_analytics.py`, `memory_tracker.py`, dashboard memory/graph/brain pages, Makefile/pyproject/deploy rework, cryptocompare + perplexity + news alert detector.
- **Phase 5** complete (2026-04-12) — mechanical entry loop: `src/hynous/mechanical_entry/` (interface, `MLSignalDrivenTrigger`, `compute_entry_params`, `executor`) + daemon rewire (`_evaluate_entry_signals` + `_periodic_ml_signal_check` at 60 s). v1 `intelligence/agent.py` deleted, all daemon LLM-wake methods removed (`grep agent.chat src/hynous/intelligence/daemon.py` → 0). User chat agent moved to `src/hynous/user_chat/` with `/api/v2/chat/*` router. Rejected entry signals write `status='rejected'` rows with `rejection_reason` for phase 6 batch analysis. Final baselines: 551p/0f, ruff 62, mypy 252. Deferred to phase 7: `intelligence/tools/market_watch.py` (writes to removed `daemon._pending_watches` — unreachable), `discord/bot.py` (stale `self.agent.chat` call — unreachable; bot not started from any v2 path).
- **Phase 6** complete (2026-04-12) — consolidation + pattern rollup: `src/hynous/journal/consolidation.py` (4 edge builders: temporal preceded/followed-by, regime-bucket, rejection-reason, rejection-vs-contemporaneous) + weekly `run_weekly_rollup` writing `system_health_report` pattern rows (mistake_tag_summary, rejection_reasons, grade_summary, regime_performance). Edge builds fire automatically after analysis insert via `build_edges_for_trade` hook; daemon starts the rollup cron (`start_weekly_rollup_cron`, interval from `V2Config.consolidation.pattern_rollup_interval_hours`). Routes `/api/v2/journal/patterns` and `/api/v2/journal/trades/{id}/related` live in `api.py`. CLI manual trigger at `python -m hynous.journal rollup`. No-dedup design note preserved in `consolidation.py`. Final baselines: 576p/0f, ruff 62, mypy 252. Registry unchanged (18 tools).
- **Phase 7** complete (2026-04-12) — dashboard rework + deferred-artifact cleanup. M1–M3 removed Memory/Graph pages, `brain.html`/`graph.html`, `/api/nous` proxy. M4 rewrote the Journal page on `/api/v2/journal/*` (6 fetchers: trades, trade detail, related, stats, patterns, search). M5–M6 trimmed `intelligence/agent.py`, `memory_tracker.py`, `trade_analytics.py`, orphan tools, `Makefile` refresh, systemd rework (3→2 services), state cleanup. M7 deleted cryptocompare + perplexity + news + dormant tools. M8 = documentation refresh + scanner dead-code sweep. M9 = dashboard boot + 8-page import-through + 30-min paper smoke + component README audit (`intelligence`, `core`, `data` rewritten; `journal`, `satellite` left accurate-as-is) + acceptance doc. Final baselines: **576p/0f, mypy 223, ruff src 51, ruff dashboard 120, registry 15**. Smoke log: `storage/v2/smoke-phase-7.log`.
- **Phase 8** complete (2026-04-13) — quantitative improvements: Task 1 tick downsample + retrain (`f573dd8` — 5 s downsample in `tick_inference.py`; 8 tick models in `satellite/artifacts/tick_models/direction_{10..180}s/`, 53–67 % dir accuracy), Task 2 MC fixes (`4e6beb0` — feature-list consolidation + `_zero_count >= 10` guard + bias-score strong-only), Task 3 composite-score calibration audit (`f3b01ee`, new-M3), Task 4 weight-update tightening `min_trades 30→10` + EMA smoothing + daily interval (`3e84c55`, new-M1) + seeded MC RNG (`56eee0d`, new-M2 — tick-audit Issue 5), Task 5 direction-model retrain bridge (`514db5a`, new-M4). Final baselines: **592p/0f, mypy 223/40, ruff src 51, ruff dashboard 120, registry 15**. Smoke log: `storage/v2/smoke-phase-8.log` (30-min paper, zero exceptions). See `v2-planning/phase-8-acceptance.md`.

---

## Code Conventions

- **One feature = one module.** Don't mix concerns.
- **No over-engineering.** Only make changes that are directly requested.
- **Tools need system prompt mention.** Registry alone doesn't make the agent use a tool.
- **Config dataclass defaults must match YAML.** If you change one, change the other.
- **Atomic file writes** for persistence: write to temp file, then rename.
- **Thread safety** for shared state: use locks (see `trading_settings.py` pattern).

---

## Documentation

- `v2-planning/00-master-plan.md` — authoritative v2 plan (read first)
- `v2-planning/05-phase-2-journal-module.md` — journal schema, store, migration, embeddings
- `v2-planning/06-phase-3-analysis-agent.md` — post-trade analysis pipeline (rules + LLM + validation)
- `v2-planning/07-phase-4-tier1-deletions.md` — phase 4 plan (complete 2026-04-12); see `v2-planning/phase-4-acceptance.md` for the annotated acceptance checklist
- `ARCHITECTURE.md` — system overview, component responsibilities, data flows
- `docs/README.md` — documentation hub (points at v2-planning for live design docs)
- `docs/integration.md` — cross-system data flows
- `docs/revisions/breakeven-fix/` — two-layer breakeven + dynamic protective SL (vol-regime distances Low 2.5% / Normal 7.0% / High 8.0% / Extreme 3.0% ROE). Capital-BE deprecated, fee-BE active.
- `docs/revisions/trailing-stop-fix/` — Adaptive Trailing Stop v3: continuous exponential retracement `r(p) = 0.20 + 0.30 × exp(-k × p)` with k by vol regime (extreme 0.160 / high 0.100 / normal 0.080 / low 0.040). Replaces v2 tiers.
- `docs/revisions/ws-migration/` — WS migration Phase 1 (market data via `ws_feeds.py`): `allMids`, `l2Book`, `activeAssetCtx`, `candle` (1m/5m), staleness-gated with REST fallback. Phase 2 (account data) deferred.
- `docs/archive/` — completed v1 revision guides, kept for historical reference only
- Each major directory has its own `README.md`
- `v2-planning/12-kronos-shadow-integration.md` — post-v2 Kronos shadow integration guide + implementation outcomes

---

## Post-v2 Additions (2026-04-15)

- **Kronos shadow predictor** live (`src/hynous/kronos_shadow/`). Currently `Kronos-small` (24.7 M params, the largest variant viable on a 2-vCPU VPS — Kronos-base / 102 M overflowed the 300 s tick cadence). Writes to `kronos_shadow_predictions` table, never affects live trading. Optional extras: `pip install -e ".[kronos-shadow]"`.
- **`hynous-daemon` systemd service** runs `scripts/run_daemon` standalone. Was the only stable way to keep the mechanical loop alive — Reflex's granian ASGI worker does not reliably keep long-lived background threads.
- **Journal DB path unification** — `JournalStore.__init__` resolves relative `db_path` against project root. Both `hynous` (cwd `/opt/hynous/dashboard`) and `hynous-daemon` (cwd `/opt/hynous`) write to the same `/opt/hynous/storage/v2/journal.db`. Prior split-brain caused 2632 stale rejection rows in dashboard DB invisible to the daemon.
- **Hyperliquid 429 retry layer** — `HyperliquidProvider.__init__` retries `Info()` and `provider.get_candles` retries `candles_snapshot` (both share the `/info` rate-limit bucket). Was the silent killer of the daemon thread during boot storms.

## Post-v2 Additions (2026-04-20)

- **ML stack retrain.** Direction model **v3** lives at `satellite/artifacts/v3/` with target switched from `risk_adj_30m` to peak ROE (`best_roe_30m_net`); v2 was emitting 100 % skip on recent data. The daemon picks the highest `v*` artifact dir at boot (`daemon.py:374-384`), so v3 is auto-loaded — v2 is left in tree but unused. Conditions retrained on 72K snapshots: 12 existing models refreshed (notable wins: entry_quality 0.05→0.32, volume_1h 0.32→0.47, funding_4h 0.00→0.23, vol_1h 0.62→0.73), `momentum_quality` added (active, spearman 0.39), `reversal_30m` added but kept in `DISABLED_MODELS` (spearman 0.10). Tick direction models retrained on 455K v2 tick snapshots, **8 → 6 horizons** (45s and 180s dropped as weak) — `direction_10s` improved 66.6 % → 69.7 % directional accuracy.
- **Opt-in tick-confirmation gate.** New gate in `MLSignalDrivenTrigger` between the direction-signal and direction-confidence checks: when `v2.mechanical_entry.tick_confirmation_enabled: true`, the chosen tick horizon's sign must agree with the satellite direction. Off by default. Configurable via `tick_confirmation_horizon` (default `direction_10s`). Two new rejection reasons: `tick_confirmation_unavailable`, `tick_direction_disagreement`.

## ⚠️ Active Issues — read before working (2026-04-22)

Full audit + status dashboard: **`docs/revisions/v2-debug/README.md`** (18 issues: 1 Critical, 8 High, 9 Medium). **15 of 18 resolved.** Only M1 remains engineer-touchable, and it's held for a rescope.

### Open — held for rescope

- **M1** — originally scoped as a dead-code delete (`context_snapshot.py` + the `get_briefing_injection` half of `briefing.py`). User flagged 2026-04-22 that `DataCache.poll()` output (L2 depth + 7d candles + 7d funding) is genuinely useful for backtesting. New target: keep the polling, delete only the dead consumer half, persist the cached data into a new `market_context_snapshots` table for offline replay. Design pass deferred; no operational impact.

### Deferred (out of scope — multi-PR refactors)

- **M7** — daemon.py monolith split (3951 lines post-H1).
- **M9** — dashboard/dashboard/dashboard.py monolith split (892 lines).

### Resolved in the 2026-04-22 session (4 issues — C1, H6, H8, M2A)

- **C1** — diagnose script run on VPS confirmed Hypothesis A. v3 artifact was genuinely retrained on `best_*_roe_30m_net`; the `_v3_risk_adj_rejected_BACKUP/` directory on disk corroborates. Fix: `config/default.yaml` `inference_entry_threshold 3.0→2.0`, `inference_conflict_margin 1.0→0.5`. v3's p75 ≈ 1.7% and p95 ≈ 2.6% — the 3.0 threshold caught only ~4% of predictions; 2.0 catches ~9%.
- **H6** — `scripts/retrain_direction_v3_snapshots.py:80-81` corrected to `best_long_roe_30m_net` / `best_short_roe_30m_net`. Target names now also threaded into `train_both_models` so future artifacts self-document.
- **H8** — `ModelMetadata` gained `long_target_column` + `short_target_column` fields (defaults to `""` for backward compat). `ModelArtifact.load()` warns on artifacts missing the fields. `from_dict` now filters unknown keys via `fields(cls)`. Both existing retrain scripts pass target names through. v2 metadata backfilled with `risk_adj_*`; v3 with `best_*_roe_30m_net`.
- **M2 Option A** — fixed the lying docstrings in `src/hynous/journal/__init__.py:8` and `src/hynous/journal/README.md:26`. `staging_store.py` stays (two test files still use it for roundtrip fixtures).

### Resolved in the 2026-04-21 cleanup session (11 issues)

| ID | Commit | Issue |
|---|---|---|
| H7 | `7fe866f` | diagnose script `--v3` path |
| H1 | `b468a80` | staged_entries dead code deleted |
| H3 | `b10febb` | deploy setup for 3 services |
| H4 | `93dc039` | src/hynous/README.md rewrite |
| H5 | `2f306f1` | config/README.md rewrite |
| M3 | `4b229e7` | conftest.py v1 fixtures deleted |
| M4 | `b0fac9f` | `trade_history_warnings` deleted |
| M8 | `2eb7232` | paper.py reads fee from settings |
| M6A | `1674f8c` | startup log trimmed |
| M5 | `1a3cd82` | TICK_FEATURE_NAMES deduped |
| H2-strict | `ec03d27` | prompts/ deleted + 4 stale tests pruned |

---

Last updated: 2026-04-22 (C1 production outage resolved via diagnose-driven threshold calibration + H6/H8/M2A landed same session; 15/18 issues closed; M1 held for backtesting-repurpose brainstorm; M7/M9 remain deferred.)
