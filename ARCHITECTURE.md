# Hynous Architecture

> How the system fits together. Read this before making changes.
>
> This document describes the v2 architecture (mechanical trading loop +
> post-trade LLM analysis agent). Authoritative v2 plan:
> `v2-planning/00-master-plan.md`.

---

## System Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                      REFLEX DASHBOARD (Python)                        │
│                           localhost:3000                              │
│  Pages + Starlette routes:                                            │
│    /api/data/*        → data-layer (:8100) proxy                       │
│    /api/ml/*          → satellite.db (read-only)                       │
│    /api/v2/journal/*  → journal router (in-process)                    │
└──────────────┬─────────────────────────────────────────────────────────┘
               │
┌──────────────┼─────────────────────────────────────────────────────────┐
│              │          FASTAPI GATEWAY (Python)                       │
│              │             localhost:8000                              │
│              ▼                                                         │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │            DAEMON (intelligence/daemon.py)                  │      │
│  │  • Fast trigger loop (~1s): SL/TP fills, trailing stop,     │      │
│  │    dynamic protective SL, fee-BE                            │      │
│  │  • Price poll loop (60s): scanner, L2 books, 5m candles     │      │
│  │  • Derivatives poll loop (300s): funding, OI, sentiment,    │      │
│  │    satellite.tick(), inference, historical snapshot push    │      │
│  │  • Journal writes: entry/exit snapshots + lifecycle events  │      │
│  │  • Post-trade analysis triggered after every exit           │      │
│  └───────┬─────────────────────────────────────────────────────┘      │
│          │                                                             │
│     ┌────┴─────┬────────────┬───────────────┐                        │
│     ▼          ▼            ▼               ▼                         │
│ ┌───────┐ ┌─────────┐ ┌───────────┐ ┌────────────────┐                │
│ │Journal│ │Analysis │ │ Scanner   │ │  Satellite     │                │
│ │store  │ │agent    │ │ (anomaly  │ │  (feature +    │                │
│ │(SQLite│ │(rules + │ │  detect)  │ │   inference)   │                │
│ │ 9 tbl)│ │  LLM)   │ │           │ │                │                │
│ └───┬───┘ └────┬────┘ └─────┬─────┘ └────────┬───────┘                │
└─────┼──────────┼────────────┼────────────────┼────────────────────────┘
      │          │            │                │
      ▼          ▼            │                │  satellite.tick()
┌───────────────────┐         │                │  (every 300s)
│ storage/v2/       │         │                ▼
│   journal.db      │         │     ┌──────────────────────────┐
│   staging.db      │         │     │   DATA-LAYER (Python)    │
│   (migrated once) │         │     │   FastAPI :8100          │
└───────────────────┘         │     │                          │
                              │     │  • Trade stream (WS)     │
                              │     │  • L2 orderbook (WS)     │
                              │     │  • Liq heatmap           │
                              │     │  • Order flow            │
                              │     │  • Smart money tracker   │
                              │     │  • Historical push:      │
                              │     │    funding / OI / vol    │
                              │     └──────────┬───────────────┘
                              │                │
                              ▼                ▼ read-only SQLite
                ┌────────────────────────────────────────┐
                │   Hyperliquid (REST + WebSocket)       │
                │   wss://api.hyperliquid.xyz/ws         │
                └────────────────────────────────────────┘
```

---

## Component Responsibilities

### `src/hynous/intelligence/` — daemon + trading tools

Drives the mechanical loop, emits journal events, wakes the analysis agent.

| Module | Responsibility |
|--------|----------------|
| `daemon.py` | Fast trigger loop, poll loops, journal writes, analysis triggers, mechanical exits, mechanical entry via `_periodic_ml_signal_check` (60 s) |
| `scanner.py` | Market-wide anomaly detection across Hyperliquid pairs (producer of `AnomalyEvent`; v2 has no LLM wake formatter) |
| `regime.py` | Regime detection (hybrid macro/micro dual scoring, zero LLM cost) |
| `tools/` | Tool handlers — 15 tools, user-chat surface only (phase 4 removed v1 memory tools; phase 5 kept trading/read tools for user chat but detached them from the decision loop) |
| `briefing.py` | Pre-built context injection (trimmed in phase 7 M7) |
| `context_snapshot.py` | Live state block (portfolio, positions, regime, ML predictions) |

### `src/hynous/journal/` — trade journal (v2)

In-process SQLite store replacing the v1 Nous memory graph.

| Module | Responsibility |
|--------|----------------|
| `schema.py` | 9-table schema: `trades`, `trade_events`, `entry_snapshots`, `exit_snapshots`, `trade_analyses`, `rejection_analyses`, `trade_edges`, `pattern_rollups`, `journal_metadata` |
| `store.py` | `JournalStore` — CRUD + daemon-compat surface (`get_entry_snapshot_json`, `list_exit_snapshots_needing_counterfactuals`, `update_exit_snapshot`) + semantic search |
| `capture.py` | Builds `TradeEntrySnapshot` / `TradeExitSnapshot` dataclasses from daemon state |
| `counterfactuals.py` | Deferred counterfactual computation (re-runs ~30min post-exit) |
| `embeddings.py` | `EmbeddingClient` — OpenAI `text-embedding-3-small` with matryoshka truncation to 512 dims (strips `openai/` prefix so OpenRouter-style config works with OpenAI direct API) |
| `migrate_staging.py` | One-shot idempotent migration from `staging.db` to `journal.db` (flag-guarded, runs at daemon startup) |
| `router.py` | FastAPI `/api/v2/journal/*` routes: trades / events / analysis / stats / search / tags |

Backing store: `storage/v2/journal.db` (WAL mode, busy_timeout 5s).

### `src/hynous/analysis/` — post-trade analysis agent (v2)

Hybrid deterministic-rules + LLM synthesis pipeline. Triggered after every
exit snapshot (background thread) and hourly for rejection batches.

| Module | Responsibility |
|--------|----------------|
| `finding_catalog.py` | Enumerated finding codes + severities |
| `mistake_tags.py` | Mistake taxonomy |
| `rules_engine.py` | 12 deterministic rules over entry/exit snapshots + counterfactuals |
| `prompts.py` | Analysis + rejection prompt templates (versioned) |
| `llm_pipeline.py` | `litellm` synthesis (single attempt, no retry, lazy import) |
| `validation.py` | Evidence / tag / grade stripping; rejects unsupported claims |
| `wake_integration.py` | Daemon calls `trigger_analysis_async` after every exit; thread name `analysis-<trade_id[:8]>` |
| `batch_rejection.py` | Hourly cron thread `rejection-analysis-cron` batches pending rejections |
| `embeddings.py` | Shares journal's 512-dim OpenAI embedding client |

Persisted rows carry narrative, citations, merged deterministic + LLM
findings, mistake tags, grades, `process_quality_score`, and
`unverified_claims`.

### `src/hynous/mechanical_entry/` — mechanical entry loop (v2)

Replaces v1's LLM-driven entry decisions. Runs on a 60 s cadence from
`daemon._periodic_ml_signal_check`. See
`v2-planning/08-phase-5-mechanical-entry.md` for the full design.

| Module | Responsibility |
|--------|----------------|
| `interface.py` | `EntryTrigger` protocol + `EntryDecision` dataclass (accept / reject with reason) |
| `ml_signal_driven.py` | `MLSignalDrivenTrigger` — gates entries on satellite conditions (vol/entry_quality/momentum/sl_survival) and regime |
| `compute_entry_params.py` | Vol-adaptive leverage, size, SL / TP resolution from `TradingSettings` and vol regime |
| `executor.py` | Execution helpers — submits the order, writes entry snapshot, writes rejection row on reject |

### `src/hynous/user_chat/` — user chat agent (v2)

LLM conversational surface only. Not in the trading decision path. Mounted
at `/api/v2/chat/*`.

| Module | Responsibility |
|--------|----------------|
| `agent.py` | LiteLLM-backed conversational agent (lazy-imports `litellm`) |
| `api.py` | FastAPI router mounted on the dashboard process |
| `prompt.py` | System prompt builder (user-chat identity + tool strategy) |

### `src/hynous/data/` — market data

| Module | Responsibility |
|--------|----------------|
| `providers/hyperliquid.py` | Hyperliquid API (WS-first reads, REST execution) |
| `providers/ws_feeds.py` | `MarketDataFeed` — one WS connection managing `allMids`, `l2Book`, `activeAssetCtx`, `candle` (1m/5m) with 30s staleness gating and REST fallback |
| `providers/paper.py` | Paper trading simulator (local order matching) |
| `providers/coinglass.py` | Coinglass derivatives API |
| `providers/hynous_data.py` | Client for the data-layer service (:8100) |

### `src/hynous/core/` — shared utilities

| Module | Responsibility |
|--------|----------------|
| `config.py` | YAML → dataclasses (`load_config()`). Top-level config dataclasses enumerated in CLAUDE.md |
| `types.py` | Shared type definitions |
| `trading_settings.py` | Runtime-adjustable trading parameters (thread-safe singleton, JSON-persisted) |
| `request_tracer.py` | Debug trace collector (8 span types per call) |
| `trace_log.py` | Trace persistence + SHA256 content-addressed payload storage |

### `dashboard/` — Reflex UI

Pages, state management, Starlette API routes. The `/api/v2/journal/*`
router is mounted at startup and serves the v2 journal surface
(trades, events, analysis results, stats, search, tags).

### `satellite/` — ML feature engine

In-process feature computation and inference. `tick()` is called by daemon
every 300s after derivatives poll. Reads data-layer historical tables via
read-only SQLite, writes snapshots + predictions to `storage/satellite.db`.

| Module | Responsibility |
|--------|----------------|
| `__init__.py` | `tick()` entry point |
| `features.py` | Feature computation (single source of truth for training + inference) |
| `conditions.py` | `ConditionEngine` — runs all condition models in ~10ms |
| `inference.py` | Real-time inference from trained models |
| `store.py` | SQLite persistence (`satellite.db`) |
| `training/` | Training pipeline |
| `artemis/` | Historical data backfill |

### `data-layer/` — market data service

Standalone FastAPI service on `:8100`. Collectors, engines, REST API.
Accessed via `hynous_data.py` provider from the daemon and `/api/data/*`
proxy from the dashboard.

---

## Data Flow

### Daemon wake flow (v2)

```
daemon.py (continuous loops)
    │
    ├── _fast_trigger_check() (~1s)
    │     ├── check_triggers() → SL/TP fill detection
    │     ├── Dynamic protective SL (vol-regime distances, at entry)
    │     ├── Fee-breakeven (layer 2, fee-proportional ROE)
    │     └── Trailing stop v3 (continuous exponential retracement)
    │
    ├── _poll_prices() (60s)
    │     ├── scanner.py (macro + micro anomaly detection)
    │     └── L2 + 5m candle updates
    │
    ├── _poll_derivatives() (300s)
    │     ├── Funding, OI, sentiment polls
    │     ├── Push historical snapshot → data-layer (POST /v1/historical/record)
    │     ├── satellite.tick() → 28 features → satellite.db
    │     └── _run_satellite_inference() → XGBoost + SHAP → satellite.db
    │
    ├── _check_positions() → fill detection
    │     ├── Entry detected: journal.capture_entry() → write entry_snapshot + trade row
    │     ├── Exit detected: journal.capture_exit() → write exit_snapshot + close trade
    │     │                 → trigger_analysis_async(trade_id) (background thread)
    │     │                 → schedule counterfactual recompute at T+30min
    │     └── Side flip: close + reopen chain
    │
    └── Background threads:
          • rejection-analysis-cron (hourly): batch-judge pending rejections
          • counterfactual check (30min): recompute deferred exit counterfactuals
          • ML-signal mechanical entry (60s cadence via `_periodic_ml_signal_check`)
```

### Post-trade analysis flow

```
Exit snapshot written → wake_integration.trigger_analysis_async(trade_id)
    │
    ▼ (background thread analysis-<trade_id[:8]>)
analysis/rules_engine.py — run 12 deterministic rules over
                           entry_snapshot, exit_snapshot, counterfactuals
    │
    ▼
analysis/prompts.py — build prompt with evidence references
    │
    ▼
analysis/llm_pipeline.py — litellm synthesis (single attempt)
    │
    ▼
analysis/validation.py — strip unsupported claims, validate tags/grades
    │
    ▼
journal.store.write_trade_analysis() → trade_analyses table
                                       (narrative, citations, findings,
                                        mistake tags, grades,
                                        process_quality_score)
```

### Cross-system boundaries

See `docs/integration.md` for the enumerated list.

---

## Tools Reference

Tools live in `src/hynous/intelligence/tools/` and register in
`registry.py`. Phase 5 removed the LLM from the trading decision loop;
the 15 tools that remain in the registry are the surface available to the
user-chat agent (`src/hynous/user_chat/`). Trade-execution tools are kept
for the user chat, but the daemon never invokes an LLM to decide on a
trade — entries go through `mechanical_entry/` and exits through
`daemon._fast_trigger_check`. Consult `registry.py` for the authoritative
list.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI framework | Reflex | Python-native, compiles to React |
| Journal | In-process SQLite (`JournalStore`) | Replaces v1's TypeScript Nous memory server; same process, zero HTTP overhead, easier migration path |
| LLM access | LiteLLM via OpenRouter | Multi-provider, single API key |
| Market data | WS-first via `ws_feeds.py` | Sub-second prices / L2 / contexts / candles, REST fallback on staleness |
| Data-layer | Separate FastAPI service | Isolates high-frequency market data from the daemon process |
| Satellite | In-process module | Called by daemon via `satellite.tick()`; reads data-layer DB directly |
| Trading loop | Mechanical (v2) | LLM is out of the trade-execution path; analysis runs post-close only |
| Config | YAML dataclasses | Human readable, single source of truth |

---

## Extension Points

### Adding a New Tool

1. Create handler in `src/hynous/intelligence/tools/`
2. Register in `tools/registry.py`
3. If the tool is user-chat-invocable, mention it in `src/hynous/user_chat/prompt.py`. The analysis agent does not call external tools.

### Adding a New Page

1. Create page in `dashboard/dashboard/pages/`
2. Add route in `dashboard/dashboard/dashboard.py`
3. Add nav item in `dashboard/dashboard/components/nav.py`

### Adding a New Data Source

1. Create provider in `src/hynous/data/providers/`
2. Export in `data/__init__.py`
3. Create corresponding tool in `intelligence/tools/`

---

## Configuration

All config lives in `config/`:

```
config/
├── default.yaml     # Main app config
└── theme.yaml       # UI styling
```

Loaded by `src/hynous/core/config.py::load_config()` at startup.

---

## Deployment

VPS deployment via systemd services and Caddy reverse proxy.

```
deploy/
├── hynous.service       # Main app (dashboard + daemon + journal)
├── hynous-data.service  # Data-layer FastAPI service (:8100)
├── setup.sh             # VPS provisioning script
└── README.md            # Deployment instructions
```

---

## Testing Strategy

```
tests/                    # Main Python test suite
├── unit/                 # Test individual functions
├── integration/          # Test component interactions
└── e2e/                  # Test full user flows

satellite/tests/          # Satellite-specific tests
data-layer/tests/         # Data-layer tests
```

Run: `PYTHONPATH=src pytest tests/` (satellite/data-layer use their own
`PYTHONPATH`).

---

## Revisions

Active revision guides in `docs/revisions/`. Archived v1 revisions (all
completed) in `docs/archive/`. Highlights:

- `docs/revisions/mechanical-exits/` — trailing stops, breakeven stops, stop-tightening lockout, MFE/MAE tracking
- `docs/revisions/breakeven-fix/` — two-layer breakeven + dynamic protective SL (vol-regime distances)
- `docs/revisions/trailing-stop-fix/` — Adaptive Trailing Stop v3 (continuous exponential retracement)
- `docs/revisions/ws-migration/` — Phase 1 market data WS (verified); Phase 2 (account data) deferred to live trading
- `docs/revisions/entry-quality-rework/` — composite entry score, ML pipeline fixes, adaptive weights

---

Last updated: 2026-04-22 (v2-debug — 15 of 18 audit issues resolved on `v2`; see `docs/revisions/v2-debug/README.md` Status Dashboard)

> **Trading loop running** — the 2026-04-21 C1 outage was resolved on 2026-04-22 after the diagnose script on VPS confirmed v3's prediction distribution. Config change (`inference_entry_threshold: 3.0→2.0`, `inference_conflict_margin: 1.0→0.5`) deployed + daemon restarted. H6 + H8 + M2 Option A landed in the same session. Remaining: M1 held for a backtesting-repurpose rescope; M7 + M9 deferred as multi-PR refactors.

---

## Post-v2 Additions (2026-04-15)

Three independent improvements landed in one session, **no live trading impact**:

### `src/hynous/kronos_shadow/` — Kronos shadow predictor

Vendored [Kronos](https://github.com/shiyu-coder/Kronos) (arXiv 2508.02739,
AAAI 2026, MIT license) running alongside `MLSignalDrivenTrigger` as a
read-only foundation-model side car. Currently `NeoQuasar/Kronos-small`
(24.7 M params; Kronos-base needed >2 vCPU). Every 300 s on the daemon
tick: fetch 360 × 1 h BTC bars → forecast next 24 bars (5 MC samples) →
derive upside-prob → write row to `kronos_shadow_predictions` (new table)
with both shadow and live decisions for offline comparison.

| Module | Responsibility |
|--------|----------------|
| `adapter.py` | Soft-failing torch import + `KronosAdapter.load()` + `predict_upside_prob()` |
| `shadow_predictor.py` | Coordinator: fetch candles → infer → derive long/short/skip → record |
| `store.py` | Direct-SQL writer (uses `JournalStore._write_lock` + `_connect()`) |
| `config.py` | `V2KronosShadowConfig` |
| `vendor/` | Vendored upstream `kronos.py` + `module.py` (sibling-import fix only; MIT) |

Optional extras: `pip install -e ".[kronos-shadow]"` (torch, huggingface_hub,
einops, safetensors, tqdm). Soft-fails cleanly without them.

### `deploy/hynous-daemon.service` — standalone daemon process

Runs `scripts/run_daemon` independently of the Reflex UI. Decouples the
mechanical loop from granian ASGI worker lifecycle (the prior in-process
daemon thread inside Reflex died silently after rate-limit storms;
standalone with `Restart=always` is the canonical pattern). **Three systemd
services now**:

| Service | Process | Port |
|---|---|---|
| `hynous` | Reflex UI (granian) + journal/chat routers | 3000, 8000 |
| `hynous-data` | Standalone market-data service | 8100 |
| `hynous-daemon` | Mechanical entry loop + Kronos shadow tick (in-process) | — |

### Journal DB path unification

`JournalStore.__init__` now resolves relative `db_path` against
`_find_project_root()` so daemon (cwd `/opt/hynous`) and dashboard
(cwd `/opt/hynous/dashboard`) both land on
`/opt/hynous/storage/v2/journal.db`. Absolute paths pass through unchanged
so test fixtures work as before. Single source of truth for live trigger
writes, Kronos shadow writes, and dashboard reads.

### Hyperliquid 429 retry layer

`HyperliquidProvider.__init__` retries `Info()` on 429 (was the silent
killer of the daemon thread during boot storms). `provider.get_candles`
also retries on 429 — the candle endpoint shares the `/info` rate-limit
bucket and the Kronos shadow tick was failing on it.

---

## Phase 8 — Quantitative Improvements (2026-04-13)

Phase 8 is ML-only and does not change the component topology above. It
landed:

- **Tick downsample + retrain** (`tick_inference.py`): canonical 5 s downsample
  on the inference path. Phase 8 shipped 8 direction models at 10–180 s
  horizons (53–67 % accuracy). The 2026-04-20 retrain dropped the weak
  `direction_45s` and `direction_180s` horizons — **6 models now live** at
  `satellite/artifacts/tick_models/direction_{10s,15s,20s,30s,60s,120s}/`
  (~69.7 % directional accuracy at 10 s after retrain on 455K v2 tick snapshots).
- **Monte-Carlo fixes**: feature-list consolidation, `_zero_count >= 10`
  guard, bias-score restricted to strong-only signals.
- **Composite-score calibration audit** (new-M3).
- **Weight-update tightening**: `min_trades 30 → 10`, EMA smoothing, daily
  interval (new-M1).
- **Seeded MC RNG** (new-M2) closes tick-audit Issue 5.
- **Direction-model retrain bridge** (new-M4) connects the retrain harness to
  the tick model artifacts.

Baselines after phase 8: 592 p / 0 f · mypy 223/40 · ruff src 51 · ruff
dashboard 120 · registry 15. Smoke log:
`storage/v2/smoke-phase-8.log` (30-min paper, 0 exceptions).
