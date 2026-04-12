# Hynous v2 — Master Plan

> This document is the entry point for the Hynous v2 refactor. Every engineer working on this project reads this first, then the pre-implementation reading list, then the plan document for the phase they're assigned.

---

## Purpose of v2

Hynous v1 evolved into a cognitively elaborate LLM-driven trading system: a 28-tool agent with a TypeScript memory graph (Nous), multi-stage retrieval, sections, consolidation, playbook matching, pre-mortem coaching, trade-history warnings, and a sprawling daemon with eight wake types. An audit of the trading path showed that the LLM's decisions are not actually gating trades — ML signals are. The LLM's `reasoning` field is stored but never read back. Memory is written but never consulted by mechanical decisions. The qualitative layers add latency, cost, and surface area without contributing to trade outcomes.

v2 is a ground-up rebuild with a different philosophy:

1. **Trading decisions are mechanical.** ML signals and deterministic rules make entries and exits. The LLM is removed from the realtime trading path.
2. **The LLM becomes a post-trade interpreter.** After each trade closes, it produces a structured evidence-backed analysis of what happened. No prediction, only post-mortem.
3. **Memory becomes a trade journal.** Nous is replaced with a local Python SQLite module. Every trade, every rejected signal, every mechanical event is stored with exhaustive context so a human or future ML pipeline can audit the system objectively.
4. **Transparency is the product.** You should be able to click any trade in the dashboard and see every input, every event, every LLM interpretation, and verify each claim against structured evidence.

The trading loop becomes fast and auditable. The LLM stops pretending to decide and starts narrating what objectively happened.

---

## Non-Goals

To prevent scope creep, v2 explicitly does NOT include:

- Live trading (v2 ships in paper mode first; live comes later, separately)
- Multi-coin trading (v2 is BTC-only; ETH/SOL added in a future phase after BTC is validated)
- Multiple concurrent positions on the same coin (one position at a time; mechanical exits aren't designed for overlapping positions)
- Automatic edge discovery between trades beyond a conservative four-edge set
- Kill switches during paper mode (we want to observe failures, not suppress them)
- LLM-in-the-loop trading decisions of any kind
- Preservation of v1 trade history (fresh start — old Nous data is not migrated)
- Rollback-to-v1 capability (v2 is a full replacement, not a feature flag)

---

## Version Boundary

v2 lives on a separate git branch (`v2`) that will **never be merged into main**. Main represents the v1 codebase and is frozen for v2 purposes. v2 is deployed to a separate VPS directory (`/opt/hynous-v2`) when ready. If v2 succeeds, it eventually replaces main entirely — but merges are not the mechanism.

No cross-branch cherry-picks. No v1/v2 hybrid. The v2 branch starts as a copy of main and diverges aggressively from day one.

---

## Phase Overview

v2 is structured as nine phases, executed in sequence. Each phase has its own implementation plan document in this directory. Each phase must be fully complete (including tests and acceptance criteria) before the next phase begins.

| # | Phase | Document | Purpose |
|---|-------|----------|---------|
| 0 | Branch & environment | `03-phase-0-branch-and-environment.md` | Create v2 branch, set up storage layout, define environment conventions |
| 1 | Data capture expansion | `04-phase-1-data-capture.md` | Rich entry/exit snapshot capture + mechanical event emitter in daemon |
| 2 | Journal module | `05-phase-2-journal-module.md` | Python SQLite journal replacing Nous entirely |
| 3 | Analysis agent | `06-phase-3-analysis-agent.md` | Hybrid deterministic rules + LLM synthesis post-trade pipeline |
| 4 | Tier 1 deletions | `07-phase-4-tier1-deletions.md` | Delete decision-injection layer (coach, consolidation, retrieval orchestrator, etc.) |
| 5 | Mechanical entry | `08-phase-5-mechanical-entry.md` | Pluggable `EntryTriggerSource` interface + ML-signal-driven implementation; refactor `execute_trade` to plain function |
| 6 | Consolidation & patterns | `09-phase-6-consolidation-and-patterns.md` | Four conservative trade edges + weekly barebones pattern rollup cron |
| 7 | Dashboard rework | `10-phase-7-dashboard-rework.md` | Delete memory/graph/brain pages; rebuild Journal page with evidence-backed trade detail view |
| 8 | Quantitative improvements | `11-phase-8-quantitative.md` | Tick model fix + MC fixes + composite score calibration |

**Phase dependencies:**

```
Phase 0 (branch) 
  └─► Phase 1 (capture) 
        └─► Phase 2 (journal module) 
              └─► Phase 3 (analysis agent)
                    └─► Phase 4 (deletions)
                          └─► Phase 5 (mechanical entry)
                                └─► Phase 6 (consolidation)
                                      └─► Phase 7 (dashboard)
                                            └─► Phase 8 (quantitative)
```

No phase may start before its predecessors are fully accepted.

---

## Phase Status

Live roll-up of phase completion. Updated by the engineer on close of each phase; coordinator verifies at review.

| # | Phase | Status | Completion | Commits | Notes |
|---|-------|--------|------------|---------|-------|
| 0 | Branch & environment | complete | 2026-04-09 | 1 | V2Config + 5 sub-configs, baselines pinned |
| 1 | Data capture expansion | complete | 2026-04-10 | — | rich entry/exit snapshots, 8 lifecycle events, StagingStore, counterfactuals, `scripts/run_daemon.py` |
| 2 | Journal module | complete | 2026-04-12 | 8 (M1–M8) | `JournalStore`, 9-table schema, embeddings, FastAPI routes, staging→journal migration, daemon swap |
| 3 | Analysis agent | **complete** | 2026-04-12 | 5 (M1–M5) | `src/hynous/analysis/` — finding catalog + rules engine + mistake tags + LLM pipeline + validation + wake integration + batch rejection cron. 2 cron threads: per-trade `analysis-<trade_id[:8]>` on close, hourly `rejection-analysis-cron`. Files: `batch_rejection.py`, `embeddings.py`, `finding_catalog.py`, `llm_pipeline.py`, `mistake_tags.py`, `prompts.py`, `rules_engine.py`, `validation.py`, `wake_integration.py`. Baselines: unit 869/1, tests 924/1, mypy 333/89 files, ruff 108. |
| 4 | Tier 1 deletions | pending | — | — | Nous server + v1 memory tools + discord chat — next |
| 5 | Mechanical entry | pending | — | — | |
| 6 | Consolidation & patterns | pending | — | — | |
| 7 | Dashboard rework | pending | — | — | |
| 8 | Quantitative improvements | pending | — | — | |

---

## Terminology Glossary

These terms appear across all plan documents. They have precise meanings in v2:

- **Trade**: A single executed position with entry, hold, and exit. Identified by `trade_id` (UUID).
- **Lifecycle event**: A discrete mechanical occurrence during a trade's hold — e.g., `dynamic_sl_placed`, `fee_be_set`, `trail_activated`, `trail_updated`, `peak_roe_new`, `vol_regime_change`. Stored as rows in `trade_events`.
- **Entry snapshot**: The full set of metrics and state captured at the moment a trade fills. Stored as a JSON blob in `trade_entry_snapshots`.
- **Exit snapshot**: The full set of metrics, counterfactuals, and ML comparisons captured when a trade closes. Stored as a JSON blob in `trade_exit_snapshots`.
- **Finding**: A structured, evidence-backed observation about a trade. Produced by either the deterministic rules engine or the LLM analysis agent. Every finding has a type, severity, evidence reference, and interpretation.
- **Evidence reference**: A pointer from a finding to the specific data that supports it (snapshot field path, event ID, candle timestamp range). Every claim must resolve to a real evidence ref or it is flagged as `unverified`.
- **Trade analysis**: The LLM's output for a closed trade. Contains narrative, citations, findings list, component grades, mistake tags, and a process quality score. Stored in `trade_analyses`.
- **Rejected signal**: A scanner anomaly or ML-generated candidate that did not pass the entry gates. Stored in the same `trades` table with `status = "rejected"`. Analyzed in batch by a lighter LLM pass.
- **Mistake tag**: A short label from a fixed vocabulary that categorizes a trade's failure mode. Each tag must be supported by at least one finding.
- **Process quality score**: A 0–100 grade of how well the system reasoned about a trade, independent of PnL outcome. A losing trade with clean process scores high; a winning trade that ignored warnings scores low.
- **Mechanical entry**: An entry decision made without LLM involvement. Uses the `EntryTriggerSource` interface and deterministic `compute_entry_params` function.
- **Mechanical exit**: An exit decision made by the existing three-layer system (Dynamic Protective SL → Fee-Breakeven → Trailing Stop v3). Unchanged in v2.
- **Journal module**: The Python SQLite package at `src/hynous/journal/` that replaces Nous entirely.
- **Decision-injection layer**: The v1 code that inserts memory, coach output, trade history warnings, and consolidation content into LLM prompts. Deleted in v2.

---

## Cross-Cutting Conventions

Every plan document assumes these conventions. Engineers should not deviate without raising the issue.

### Code style

- **Python version**: 3.11+ (existing project standard)
- **Type annotations**: Required for all new public functions. Use `|` syntax (PEP 604) for unions.
- **Dataclasses**: Use `@dataclass(slots=True)` for any data carrier unless it needs dict-style mutation.
- **Imports**: Absolute imports from `hynous.*`. No relative imports beyond sibling modules.
- **Docstrings**: Required for public functions. One line describing purpose, plus Args/Returns if signature is non-obvious.
- **Error handling**: Raise specific exceptions. Do not catch `Exception` unless logging + re-raising. No silent `pass` in except blocks.
- **Logging**: Use `logging.getLogger(__name__)`. Log at `INFO` for lifecycle events, `DEBUG` for internal state, `WARNING` for recoverable anomalies, `ERROR` for failures that need attention.

### File layout for new modules

```
src/hynous/<module>/
├── __init__.py        # Public API exports only
├── schema.py          # Dataclasses and/or SQL DDL
├── store.py           # Persistence layer (SQLite CRUD)
├── <core>.py          # Domain logic (one concept per file)
├── api.py             # FastAPI routes if the module exposes HTTP endpoints
└── README.md          # One-page overview pointing to the v2 plan document
```

### SQLite conventions

- **Filename**: `storage/<module>.db` (e.g., `storage/journal.db`)
- **WAL mode enabled**: `PRAGMA journal_mode=WAL;` in schema init
- **Thread-safe connections**: Each worker gets its own connection from a pool; never share a connection across threads
- **Schema migrations**: Use a `schema_version` table; migrations are idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` with existence checks
- **Timestamps**: Always ISO 8601 strings in UTC (`datetime.now(timezone.utc).isoformat()`)
- **JSON blobs**: Stored as TEXT; always `json.dumps(obj, sort_keys=True, separators=(",", ":"))` for consistency
- **Indexes**: Defined in schema.py alongside CREATE TABLE. Include a comment explaining the query pattern the index supports.

### FastAPI routes

- **Prefix**: All v2 routes under `/api/v2/<module>/` to distinguish from v1 routes
- **Response models**: Use Pydantic models, not raw dicts
- **Errors**: Raise `HTTPException` with specific status codes; never return `{"error": ...}` dicts
- **Mounting**: Routes from `src/hynous/<module>/api.py` are imported and mounted in `dashboard/dashboard/dashboard.py`

### Testing

- **Test location**: `tests/unit/test_<module>.py` for unit tests; `tests/integration/test_<module>_integration.py` for integration tests
- **Fixtures**: Use pytest fixtures. Shared fixtures live in `tests/conftest.py`.
- **Mocking**: Use `unittest.mock.patch` for external dependencies (HTTP, LLM calls, exchange). Never mock internal project code — refactor to allow real testing.
- **Isolation**: Every test must clean up its own SQLite files, environment changes, and background threads.
- **Naming**: `test_<function_name>_<scenario>_<expected_outcome>`, e.g., `test_store_trade_entry_with_full_snapshot_persists_all_fields`.

### Git conventions for v2

- **Branch**: All work on `v2` (no feature branches off v2 until the phase model is validated)
- **Commits**: One commit per logical change. Commit messages start with `[phase-N]` tag.
  - Example: `[phase-1] add TradeEntrySnapshot dataclass + schema validation`
- **No squash**: Preserve commit history per phase so the v2 trajectory is readable
- **No merges from main**: v2 does not accept upstream changes from main

### LLM model selection

- **Analysis agent**: Claude Sonnet via OpenRouter (`anthropic/claude-sonnet-4.5` or equivalent current model). The model is configured in `config/default.yaml` under `analysis_agent.model`.
- **Batch rejection analysis**: Same model, lighter prompt. Configured separately.
- **No Haiku for trading**: Removed entirely. The coach subsystem is deleted.
- **No embedding model switching**: Use OpenAI `text-embedding-3-small` (1536 dim, 512-dim compared via matryoshka truncation for speed). Same as v1.

### Running in paper mode

- **No kill switches**: Per the plan, v2 paper mode intentionally runs without safety cutoffs so failure modes are observable. Kill switch logic is not called. This is only for paper.
- **Execution mode**: `execution.mode = "paper"` in `config/default.yaml`. Mechanical entry/exit uses `PaperProvider`.
- **Initial balance**: Set in config; paper_state.json tracks it across restarts.

---

## Engineer Protocol

Every plan document in this directory follows the same execution protocol. Engineers must follow it exactly.

### Before starting any phase

1. **Read `01-pre-implementation-reading.md` in full.** This is not optional. It identifies every file, doc, and concept you need in memory before you can safely make changes. Do not skip to your assigned phase document.
2. **Read the plan document for your assigned phase in full.** Do not begin implementation until you understand the full scope.
3. **Read the plan documents for phases that precede yours.** If you're on phase 5, read phases 0–4 first. Dependencies between phases matter.
4. **Ask for clarification on anything ambiguous.** Do not guess. Pause and report.

### During implementation

1. **Work in the order specified in the plan.** Phases have step ordering for a reason — later steps often depend on earlier ones.
2. **Follow the code sketches exactly unless you have a specific reason not to.** If you deviate, document why in your report-back.
3. **Run tests after every step, not at the end.** If a step breaks existing tests, do not proceed to the next step. Pause and report.
4. **Commit frequently with `[phase-N]` tags.** One commit per logical change.
5. **If you encounter an issue the plan does not address, stop immediately and report it.** Do not work around it. Do not fix it your way. Report to the user, wait for direction.

### Testing requirements for every phase

Every phase has two test categories that must both pass before the phase is accepted:

**Static tests:**
- Type checking: `mypy src/hynous/` must return zero new errors compared to the v2 branch baseline
- Linting: `ruff check src/hynous/` must return zero new errors
- Import sanity: `python -c "from hynous import <your_module>"` must succeed for any new public module

**Dynamic tests:**
- Unit tests: All new unit tests for the phase must pass (`pytest tests/unit/test_<module>.py`)
- Integration tests: Where the phase changes how components interact, integration tests must pass (`pytest tests/integration/test_<module>_integration.py`)
- Regression: All existing tests must still pass (`pytest tests/`) — no new failures introduced
- Smoke test: Start the daemon in paper mode and confirm no crashes for 5 minutes of idle operation (`python -m scripts.run_daemon` — observe logs, look for unhandled exceptions)

**Acceptance criteria:**
Each phase plan document includes a list of boolean checks under "Acceptance criteria." All must be true before the phase can be marked complete. The engineer runs these checks and includes their results in the report-back.

### Report-back protocol

When a phase is complete and all tests pass, the engineer reports back to the user with:

1. **Summary** (3–5 sentences): what was built, what changed
2. **Commits**: list of commit hashes and their messages, in order
3. **Test results**: pasted output of static tests, unit tests, integration tests (or links to CI runs)
4. **Acceptance criteria**: each check listed with ✓ or ✗ and a short note
5. **Deviations**: any place the engineer deviated from the plan, with justification
6. **Observations**: anything the engineer noticed that might affect later phases — new risks, surprises, opportunities
7. **Next phase blockers**: anything that must be clarified before the next phase can start

If anything fails or the engineer is uncertain, they report back with a **pause** request instead:

1. **What was attempted**
2. **What the current state of the code is** (committed / uncommitted / partially reverted)
3. **The specific issue encountered** (error message, unexpected behavior, ambiguity in the plan)
4. **What the engineer tried** before pausing
5. **Questions for the user**

No silent failures. No "I'll figure it out and tell you when it's done." Pause early and often.

---

## What Each Engineer Needs To Know Going In

This section is a quick orientation to save engineers from discovering fundamentals ad-hoc.

### System topology (what runs where)

**Current v1 state (for reference only — v2 changes this significantly):**
- Three processes: `hynous` (dashboard + agent + daemon, port 3000 + 8000), `nous` (TypeScript memory server, port 3100), `hynous-data` (market data collector, port 8100)
- One combined systemd unit per process
- Storage: `storage/` directory for JSON state files, SQLite DBs, traces

**v2 target state:**
- Two processes: `hynous-v2` (dashboard + daemon + journal + analysis agent, port 3000 + 8000) and `hynous-data` (unchanged, port 8100)
- No Nous server. No TypeScript. No pnpm.
- Analysis agent runs in-process as a background thread on post-trade wakes
- Journal is a local SQLite database at `storage/journal.db`

### What the daemon does (trading loop)

**v1:** Every ~1 second, `daemon._fast_trigger_check()` polls prices via WebSocket, updates peak/trough ROE for open positions, checks for SL/TP/liquidation triggers, applies the three mechanical exit layers (Dynamic SL → Fee-BE → Trailing v3), and wakes the LLM agent when a position closes or when scanner anomalies exceed a threshold. The LLM agent then reasons and may call `execute_trade`.

**v2:** Same fast trigger loop for exits (unchanged). But on scanner anomalies, the daemon calls the new `EntryTriggerSource.evaluate()` interface which makes a mechanical decision based on ML signals alone. If the signal passes, `execute_trade` is called as a plain function (not a tool). The LLM is only woken after a trade *closes*, and only to produce the analysis.

### What the LLM does in v2

- **On trade close**: background wake, fed the full lifecycle bundle (entry snapshot + exit snapshot + events + counterfactuals + ML signal comparison + deterministic findings), produces a trade analysis with narrative and evidence references
- **Hourly batch**: runs over rejected signals from the last hour, produces a lighter "was this rejection correct" analysis for each
- **On-demand**: user clicks "re-analyze" in the dashboard, same pipeline runs again with the same trade bundle
- **User chat**: separate lightweight agent for querying the journal ("show me my worst shorts this week"). Minimal tool surface: `search_trades`, `get_trade_by_id`, `get_market_data`.

### What the dashboard does in v2

- Journal page is the primary destination. It shows all trades (accepted and rejected), lets you drill into any trade's full lifecycle, displays the LLM analysis with citations resolved to their supporting evidence, surfaces the weekly pattern rollup.
- Home page is a simpler portfolio overview.
- Chat, settings, debug, ml, data pages kept but simplified.
- Memory, graph, brain pages deleted.

### Key files the engineer will touch most

- `src/hynous/intelligence/daemon.py` (large, ~5000+ LOC — phases 1, 5 modify it significantly)
- `src/hynous/intelligence/tools/trading.py` (phases 1, 5 modify)
- `src/hynous/journal/*` (new — phase 2 creates)
- `src/hynous/analysis/*` (new — phase 3 creates)
- `dashboard/dashboard/state.py` (phase 7 modifies significantly)
- `dashboard/dashboard/pages/journal.py` (phase 7 rewrites)
- `config/default.yaml` (phase 0 adds v2 sections)
- `src/hynous/core/config.py` (phase 0 adds v2 dataclasses)

### Key concepts the engineer must internalize

- **The LLM never makes trading decisions in v2.** If you find yourself writing code where the LLM returns a "should I trade" answer, you're on the wrong path — go back and read phase 5.
- **Every LLM claim in an analysis must cite an evidence reference.** Claims without evidence are flagged, not accepted.
- **Mechanical exits are unchanged.** Do not refactor `_fast_trigger_check`'s exit layers (Dynamic SL, Fee-BE, Trailing v3). Only entry logic changes.
- **Rich data capture is more valuable than clever analysis.** When in doubt, capture more at trade time. A missing field can't be reconstructed later.
- **Paper mode is observation mode.** Failures in paper mode are data. Do not add safety nets that suppress observable failures.

---

## Success Criteria for v2 as a Whole

v2 is considered complete and ready for extended paper trading when all nine phases are accepted AND the following system-level checks pass:

1. A full trading session (≥ 24h paper trading) runs without unhandled exceptions
2. Every closed trade has a corresponding `trade_analysis` record with non-empty narrative, findings, grades, and evidence citations
3. Every rejected signal in the observation window has a corresponding batch analysis
4. Every narrative citation in every analysis resolves to real evidence (zero unverified_claims across 100+ trades)
5. The dashboard Journal page renders every trade's detail view without errors
6. The weekly pattern rollup cron fires and produces a `system_health_report` without manual intervention
7. Mechanical exits fire at expected levels (Dynamic SL placed at vol-regime distance, Fee-BE set when ROE clears fees, Trail activates at vol-regime threshold) — verified by spot-checking 10 closed trades against their event timelines
8. The daemon runs without the nous process (confirm by disabling nous systemd unit; system must operate cleanly)
9. No v1 decision-injection code remains in the codebase (verify with grep for removed imports)

These are not acceptance criteria for individual phases — they're the gate for declaring v2 ready for extended paper trading as a whole system.

---

## Amendments Log

Plan amendments discovered post-writing. Every engineer must read this before starting their assigned phase — it captures reality checks that invalidate parts of the original plan.

### Amendment 1 — `scripts/run_daemon` does not exist on main (discovered in phase 0)

The plan documents reference `python -m scripts.run_daemon` for smoke tests. That module does not exist in the repository and has not existed for some time — the Makefile and CLAUDE.md also reference it but point at nothing. In v1, the daemon runs in-process inside the Reflex dashboard (`scripts/run_dashboard.py` → Reflex stack → daemon subsystem).

**Resolution:** Phase 1 creates a real `scripts/run_daemon.py` as its first step (see phase 1 plan step 0). Every phase from 1 onward can then use `python -m scripts.run_daemon` as written in the plans. Phase 0 engineers had to substitute an inline runner and that's documented in the phase 0 report-back.

### Amendment 2 — `tests/e2e/test_live_orchestrator.py` breaks pytest collection (discovered in phase 0)

The file at `tests/e2e/test_live_orchestrator.py` executes module-level code (`client = NousClient(); h = client.health()`) at import time, which requires the Nous server to be running on `localhost:3100` for pytest to even **collect** the file. When Nous is not running (which is most of the time during v2 development), pytest collection fails, which aborts the entire test run. This file has been broken on main for some time.

**Resolution (short-term):** Every phase regression test command uses `pytest tests/ --ignore=tests/e2e` instead of the plain `pytest tests/` written in the original plan. Phase plan docs 1–8 have been updated to reflect this.

**Resolution (permanent):** Phase 4 explicitly deletes `tests/e2e/test_live_orchestrator.py` as part of its test cleanup step (it tests Nous, which phase 4 removes entirely). Starting with phase 5, the `--ignore=tests/e2e` flag is no longer needed because the offending file is gone.

### Amendment 3 — Regression baseline is `810 passed / 1 pre-existing failure` (established in phase 0)

The phase 0 engineer verified that `tests/unit/test_token_optimization.py::TestCrossCutting::test_load_config_produces_valid_config` fails on both main and v2 with an identical stale-model-name assertion (expects `"claude-sonnet-4-5-20250929"` but the actual model is `"openrouter/x-ai/grok-4.1-fast"`). This is documented as pre-existing drift in `docs/revisions/feature-trimming/README.md` and was never fixed.

**Resolution (short-term):** Every phase's "zero new failures" acceptance criterion means **zero new failures compared to the 810 passed / 1 failed baseline**. The 1 pre-existing failure does NOT block phase acceptance as long as it is the same single failure and no new ones appear.

**Resolution (permanent):** Phase 4 explicitly deletes `tests/unit/test_token_optimization.py` as part of its test cleanup step (token optimization was a v1 LLM-in-the-loop prompt reduction effort — the feature and its tests are both removed in phase 4). Starting with phase 5, the regression baseline is `811 passed / 0 failed`.

### Amendment 4 — Non-v2 untracked files on main are deliberately left untracked

When you check out the v2 branch from main, these files appear as untracked in `git status`:

- `docs/revisions/mc-fixes/implementation-guide.md`
- `docs/revisions/tick-system-audit/future-entry-timing.md`
- `satellite/artifacts/tick_models/`

These are pre-existing uncommitted work on main. They are **not** part of v2's scope and are **not** staged in any v2 phase commit. Leave them alone. They continue to appear as untracked across all v2 phases and that is expected.

### Amendment 5 — `entry_score` key naming mismatch in plan code sketches (discovered in phase 1)

The phase 1 plan's `_build_ml_snapshot` code sketch uses `preds.get("_entry_score")` (with underscore prefix). The daemon stores the composite entry score as `entry_score` (no underscore) at daemon.py line 1825. The `_get_ml_conditions()` helper in trading.py re-keys it with an underscore prefix (`_entry_score`) when copying into the `ml_cond` dict. Since `capture.py` reads `_latest_predictions` directly (not via `ml_cond`), the plan's code would silently return `None` for `composite_entry_score` on every snapshot.

**Resolution:** Phase 1 implementation uses the correct key `preds.get("entry_score")` (no underscore). Future phases that read from `_latest_predictions` directly must use the no-underscore keys: `entry_score`, `entry_score_label`, `entry_score_components`, `entry_score_line`. Code that reads from the `ml_cond` dict returned by `_get_ml_conditions()` uses the underscore-prefixed keys: `_entry_score`, `_entry_score_label`, `_entry_score_components`.

### Amendment 6 — Source-code-introspection tests are fragile (discovered in phase 1)

`tests/unit/test_mechanical_exit_fixes_2.py::TestBugBCheckTriggersCleanup` searches daemon.py source code with hardcoded character windows after `"if events:"`. Phase 1's insertion of ~40 lines of v2 exit capture code pushed the cleanup logic beyond the original 1500/2000-char windows, breaking 5 tests.

**Resolution:** Replaced hardcoded character windows with `_extract_events_block()` helper that uses indentation-based block extraction. This captures the full `if events:` block regardless of size. Future phases that insert or remove code in this block will not break the tests.

### Amendment 7 — Counterfactuals computed at exit time are incomplete (discovered in phase 1)

`compute_counterfactuals()` requests candles from entry to `exit_ts + counterfactual_window_s`, but at exit time the post-exit candles don't exist yet. The counterfactual window (2-12 hours) looks ahead after exit, but the data isn't available when called synchronously. The fields `did_tp_hit_later` and `did_sl_get_hunted` are always `False` at capture time.

**Resolution:** Phase 1 adds `_recompute_pending_counterfactuals()` to the daemon, running every 30 minutes. It finds exit snapshots whose counterfactual window has elapsed, recomputes with the full candle range, and updates the snapshot in-place. This ensures counterfactuals are complete before phase 3's analysis agent needs them.

### Amendment 8 — Regression baseline after phase 1 is `824 passed / 1 pre-existing failure`

Phase 1 adds 14 new unit tests (test_v2_capture.py). Combined with the 8 phase 0 config tests and the 2 additional tests from fixing the introspection test helper, the regression baseline is now `824 passed / 1 failed`. The 1 failure remains the pre-existing `test_token_optimization.py` stale model assertion (Amendment 3).

ruff baseline: 108 errors (was 107). The +1 is an I001 (unsorted-imports) from inline imports in `_recompute_pending_counterfactuals()`, following the same pattern as 8 existing inline import blocks in daemon.py.

### Amendment 9 — Snapshot dataclass reconstruction helpers deferred from phase 1 to phase 2 (discovered 2026-04-12)

The phase 1 plan sketched `staging_store.get_entry_snapshot(trade_id) -> TradeEntrySnapshot | None` returning a hydrated dataclass via an unimplemented `_dict_to_entry_snapshot(data: dict) -> TradeEntrySnapshot` helper stubbed as `raise NotImplementedError("Implement dict→dataclass reconstruction")`. The phase 1 implementer deliberately sidestepped the reconstruction by shipping `get_entry_snapshot_json(trade_id) -> dict | None` instead — capture code only needs raw dicts for cross-reading during exit snapshot building, so dict-pass-through was sufficient for phase 1's scope.

This leaves phase 2 needing real reconstruction helpers because `JournalStore.get_trade()` returns a hydrated bundle (with `entry_snapshot` and `exit_snapshot` as typed dataclass instances) that phase 3's analysis agent consumes directly.

**Resolution:** Phase 2 step 1 adds `entry_snapshot_from_dict()` and `exit_snapshot_from_dict()` to `src/hynous/journal/schema.py`, with explicit nested-dataclass instantiation (no recursive generic walker — the dataclasses contain `list[dict]` fields like `clusters_above`, `top_whale_positions`, `direction_shap_top5`, `candles_1m_15min` that must stay as dicts). Four round-trip unit tests + one end-to-end hydration test are mandatory before the rest of phase 2 proceeds. Empirical verification of hydration on real smoke-captured data is part of the phase 2 report-back.

See `v2-planning/05-phase-2-journal-module.md` → "Dataclass Reconstruction Helpers" section for the full spec. Staging store is NOT backported — it is deleted at the end of phase 2.

### Amendment 10 — Order flow + smart money backfill scheduled in phase 2 (discovered 2026-04-12)

Phase 1's `src/hynous/journal/capture.py` ships `_build_order_flow_state()` and `_build_smart_money_context()` as bare placeholders returning empty `OrderFlowState()` / `SmartMoneyContext()` instances. The phase 1 report-back documented this as "placeholders for data-layer integration" but no follow-up plan existed. Every entry snapshot captured through phase 1 therefore has all eight `OrderFlowState` fields and all five `SmartMoneyContext` fields set to None / empty list / 0. Phase 3's analysis agent rules depend on these fields being populated to fire findings like `entered_against_funding`, `entered_into_liq_cluster`, or HLP-alignment observations.

**Resolution:** Phase 2 backfills both builders against the existing data-layer service (`:8100`). The `hynous_data.py` client already exposes every endpoint needed (`order_flow`, `hlp_positions`, `whales`, `sm_changes`). Two small additions to the data-layer engine are required to populate the currently-missing `cvd_30m` and `large_trade_count_1h` schema fields:

1. `data-layer/src/hynous_data/engine/order_flow.py` — extend default windows from `[60, 300, 900, 3600]` to `[60, 300, 900, 1800, 3600]` so the response includes a `"30m"` key.
2. `data-layer/src/hynous_data/engine/order_flow.py` — add `large_trade_count(coin, window_s, threshold_pct_of_window_vol)` helper + `GET /v1/orderflow/{coin}/large-trade-count` route + matching client method.

Every data-layer call in the rewritten builders is individually try/except-wrapped; a single endpoint outage cannot strand an entry snapshot. Populated-field post-smoke verification is a phase 2 acceptance criterion: at least one captured snapshot must have non-None `cvd_1h`, `buy_sell_ratio_1h`, and non-empty `top_whale_positions`.

See `v2-planning/05-phase-2-journal-module.md` → "Order Flow & Smart Money Backfill" section for the full spec including verified endpoint response shapes and graceful-degradation patterns.

---

## Document Index

- `00-master-plan.md` — this document
- `01-pre-implementation-reading.md` — required reading for every engineer before starting any phase
- `02-testing-standards.md` — detailed testing protocol referenced by every phase
- `03-phase-0-branch-and-environment.md` — phase 0
- `04-phase-1-data-capture.md` — phase 1
- `05-phase-2-journal-module.md` — phase 2
- `06-phase-3-analysis-agent.md` — phase 3
- `07-phase-4-tier1-deletions.md` — phase 4
- `08-phase-5-mechanical-entry.md` — phase 5
- `09-phase-6-consolidation-and-patterns.md` — phase 6
- `10-phase-7-dashboard-rework.md` — phase 7
- `11-phase-8-quantitative.md` — phase 8

Each phase document is self-contained for its phase but assumes the engineer has read this master plan and the pre-implementation reading list.
