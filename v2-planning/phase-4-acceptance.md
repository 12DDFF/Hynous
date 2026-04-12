# Phase 4 Acceptance — 2026-04-12

Annotated acceptance checklist from
`v2-planning/07-phase-4-tier1-deletions.md` lines 606–638. Each item is
marked `[x]` (pass), `[partial]`, or `[deferred-phase-7]` with evidence.

## Checklist

- [x] **10 deletion steps executed in order, each as a separate commit**
      Commits M1 through M9 — `fde85de`, `f691389`, `d0cbae3`, `4e825d3`,
      `1f8faa3`, `daa314f`, `9b2912d`, `e90c2b8`, `36f6530`, `0df6edd`
      (final cleanup). 10 phase-4 commits total (plan step 10 covered
      by M9).
- [x] **`nous-server/` directory does not exist**
      Deleted in M6a (commit `daa314f`).
- [x] **`src/hynous/nous/` directory does not exist**
      Deleted in M5 (commit `1f8faa3`).
- [x] **All 9 decision-injection modules deleted**
      Deleted in M3 (commit `d0cbae3`): coach, consolidation,
      memory_manager, playbook_matcher, retrieval_orchestrator,
      gate_filter, wake_warnings, trade_history, and assorted helpers.
- [x] **All 8 memory agent tools deleted**
      Deleted in M4 (commit `4e825d3`): memory, delete_memory,
      explore_memory, pruning, watchpoints, clusters, conflicts,
      trade_stats. Registry now 17 tools.
- [partial] **CryptoCompareProvider and PerplexityProvider deleted**
      CryptoCompare + Perplexity retained; news_alert detector retained.
      Deferred to phase 7 per M8 adjudication (entanglement with scanner
      + news polling). Tracked in Phase 7 punch list.
- [x] **6 unused Coinglass methods deleted**
      3 deleted in M8 (commit `36f6530`): `get_liquidation_heatmap`,
      `get_options_data`, `get_institutional_positioning`. The other 3
      remain in active use (`get_derivatives_data`, `get_funding_rate`,
      `get_options_flow` — verified call-site grep).
- [x] **`deploy/nous.service` deleted**
      Deleted in M6a (commit `daa314f`).
- [x] **`config/default.yaml` has no `nous:` section**
      Verified in M6a (commit `daa314f`).
- [x] **`core/config.py` has no `NousConfig`**
      Deleted in M6a. Residual `MemoryConfig`/`OrchestratorConfig`
      dataclasses remain but are orphaned (zero consumers); flagged in
      Phase 7 punch list.
- [x] **`prompts/builder.py` trimmed (≥ 40% LOC reduction)**
      M7 (commit `e90c2b8`) reduced builder.py from 435 → 244 LOC
      (-44%). TOOL_STRATEGY + promoted-lessons blocks fully removed.
- [x] **`trading.py` trimmed: no `_store_trade_memory`, no coach calls,
      no trade_history calls**
      M1 (commit `fde85de`) removed the hot paths; M9 removed the dead
      breadcrumb comments. Grep confirms zero matches for
      `_store_trade_memory|coach|trade_history`.
- [x] **`daemon.py` trimmed: no cron jobs for decay/conflicts/
      consolidation/fading/curiosity**
      M2 (commit `f691389`) removed the crons; M9 deleted the residual
      `_get_nous()` stub, `_check_health()` method, `_auto_resolve_conflict`
      orphan, and `_nous_*` attrs.
- [x] **`grep "from hynous.nous"` returns nothing (in `src/hynous/`)**
      Verified: `grep -rn "from hynous.nous" src/hynous/` → no matches.
      Dashboard still has stale imports — tracked in Phase 7 punch list.
- [x] **`grep "from .coach"` returns nothing (and similar for all deleted
      modules)**
      Verified: `grep -rn "from \.coach\|from \.consolidation\|from
      \.playbook_matcher\|from \.retrieval_orchestrator\|from \.memory_manager\|
      from \.gate_filter\|from \.wake_warnings\|from \.trade_history"
      src/hynous/` → no matches.
- [x] **All tests pass at the post-phase-4 baseline**
      `pytest tests/` → **482 passed / 0 failed** (pinned after M4
      ratification; held through M5–M9). Plan's `~855` estimate assumed
      a different CE-ignore path; the ratified baseline is 482.
- [x] **`tests/e2e/test_live_orchestrator.py` deleted**
      Deleted in M6b (commit `9b2912d`).
- [x] **`tests/unit/test_token_optimization.py` deleted**
      Deleted in M6b.
- [x] **`tests/unit/test_decay_conflict_fixes.py` deleted**
      Deleted in M6b.
- [x] **mypy baseline preserved**
      Same-toolchain delta (mypy 1.19.2): pre-M9 260 → post-M9 246
      (-14). Absolute count drifted upward from the plan's ≤225
      reference because of ambient toolchain upgrade between phase 3
      and phase 4; architect ratified same-toolchain deltas as the
      binding rule in M8.
- [x] **ruff baseline preserved**
      Same-toolchain delta (ruff 0.14.5): pre-M9 78 → post-M9 78
      (hold).
- [x] **30-minute smoke test completes without errors**
      `storage/v2/smoke-phase-4.log` — 1801s elapsed (14:28:55–14:58:56),
      no tracebacks, clean shutdown. Heartbeats every 60s. Zero
      non-hynous "nous" log lines. Zero coach/consolidation/playbook/
      retrieval_orchestrator log lines.
- [partial] **Journal and analysis still producing records during smoke**
      Paper mode, zero positions opened, so `trade_events` / `trades`
      both 0. Store initialized cleanly (`v2 journal store initialized`)
      and batch rejection cron started (`v2 batch rejection cron started
      (interval=3600s)`). Both writers are wired — just no input during
      the 30-min window.
- [partial] **`CLAUDE.md`, `ARCHITECTURE.md`, `docs/README.md`,
      `docs/integration.md` all updated to reflect v2**
      `CLAUDE.md` fully rewritten (M6a + M9 final stamp). The other
      three are phase-7 scope — ARCHITECTURE + docs/integration +
      docs/README describe the dashboard + 5-component architecture
      that phase 7 will replace; rewriting them now would duplicate
      effort. Tracked in Phase 7 punch list.
- [deferred-phase-7] **`Makefile` `init-db` target fixed or deleted
      (no Nous references)** — predates v2, bundled with deploy rework.
- [deferred-phase-7] **`Makefile` `daemon` target verified working** —
      scripts/run_daemon.py verified working (30-min smoke passed); the
      Makefile target itself is out of scope here.
- [deferred-phase-7] **`pyproject.toml` description + dependencies
      reviewed, v1 references removed** — bundled with deploy rework.
- [deferred-phase-7] **`deploy/README.md` (if exists) updated from
      3-service to 2-service setup** — bundled with deploy rework.
- [deferred-phase-7] **`deploy/setup.sh` updated to remove Nous build
      steps** — bundled with deploy rework.
- [x] **Phase 4 commits tagged `[phase-4]`**
      All 10 commits use `[phase-4]` prefix. Verified via
      `git log --oneline | grep phase-4`.

## Summary

- **Pass:** 22 items
- **Partial:** 3 items (cryptocompare/perplexity deferred, journal idle
  during smoke, 3 docs deferred to phase 7)
- **Deferred to phase 7:** 5 items (Makefile, pyproject, deploy docs)
- **Fail:** 0 items

Phase 4 goal — "remove v1 infrastructure that blocks a clean mechanical
loop in phase 5" — is met. Residual v1 references are cosmetic (dashboard
pages, orphan modules) or packaging (Makefile, deploy) and are the
explicit scope of phase 7.

## Phase 7 punch list (handoff)

Items deferred here, grouped so the phase-7 planner has the punch list
in one place:

1. **Dashboard rework** — `/api/nous/*` stubs, memory/graph/brain pages,
   remaining `from hynous.nous.client import get_client` calls in
   `dashboard/state.py`, Journal page rebuild against `JournalStore`.
2. **Orphan modules** — `src/hynous/core/memory_tracker.py`,
   `src/hynous/core/trade_analytics.py`. Both have empty-return fallbacks
   so nothing breaks in the interim.
3. **Config dataclasses** — `MemoryConfig`, `OrchestratorConfig`,
   `SectionsConfig` are still wired into `Config` but have zero runtime
   consumers.
4. **Makefile / pyproject / deploy** — `init-db` target (mentions Nous),
   `daemon` target rewrite, `pyproject.toml` description + deps review,
   `deploy/README.md` 3→2 service rewrite, `deploy/setup.sh` Nous build
   removal.
5. **News + 3rd-party providers** — `CryptoCompareProvider`,
   `PerplexityProvider`, `news_alert` detector, `CRYPTOCOMPARE_API_KEY`.
   Entangled with scanner; defer until scanner rework.
6. **Doc rewrites** — `ARCHITECTURE.md`, `docs/README.md`,
   `docs/integration.md` — rewrite against v2 (4 components, no Nous,
   journal + analysis agent).
