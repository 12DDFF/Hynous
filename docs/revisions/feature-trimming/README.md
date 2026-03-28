# Feature Trimming — Legacy Code Removal

> **Date:** 2026-03-27
> **Status:** Complete
> **Tests:** 749 unit tests passing (0 regressions)

---

## Summary

Removed ~600 lines of dead/deprecated code across 6 categories. All items were verified as unreachable at runtime before deletion. No functionality was affected.

---

## 1. Phantom System (~400 lines)

**What it was:** Hypothetical trade tracker — when the agent passed on a scanner anomaly, the daemon would create a "phantom" trade and track what would have happened. Designed for regret-based learning.

**Why removed:** Fully disabled since commit `8b3003b` ("Remove phantom/regret system entirely"). All 8 methods were defined but unreachable — every invocation point was commented out. The system was never re-enabled.

**Files modified:**
- `src/hynous/intelligence/daemon.py` — Removed 8 dead methods (`_parse_phantom_params`, `_maybe_create_phantom`, `_evaluate_phantoms`, `_store_phantom_result`, `_wake_for_phantom`, `_persist_phantoms`, `_load_phantoms`, `_seed_phantom_stats_from_nous`), 4 unused state variables, 4 commented-out invocation blocks
- `src/hynous/intelligence/scanner.py` — Removed `infer_phantom_direction()` function (0 callers)
- `src/hynous/core/config.py` — Removed `phantom_check_interval` and `phantom_max_age_seconds` from DaemonConfig + load_config()

**Not removed:** Dashboard journal page still has phantom/regret tab UI (`dashboard/pages/journal.py`, `dashboard/state.py`). It renders "No phantom data yet" when empty — harmless, and preserves the UI slot if a replacement system is built.

---

## 2. Capital Breakeven (~100 lines)

**What it was:** Layer 1 of the two-layer breakeven system. Placed SL at entry price when ROE exceeded 0.5%, accepting fee loss (~0.7% ROE at 20x).

**Why removed:** Deprecated 2026-03-17, replaced by Dynamic Protective SL which places a vol-regime-calibrated SL immediately at position detection (no ROE threshold required). Config field `capital_breakeven_enabled` was set to `false` — entire code block was gated and unreachable.

**Files modified:**
- `src/hynous/intelligence/daemon.py` — Removed `_capital_be_set` state dict, the gated placement block in `_update_peaks_from_candles()`, all `.pop()` cleanup lines, `"capital_breakeven_stop"` classification string
- `config/default.yaml` — Removed `capital_breakeven_enabled` and `capital_breakeven_roe`
- `src/hynous/core/config.py` — Removed both fields from DaemonConfig + load_config()
- `tests/unit/test_breakeven_fix.py` — Removed 6 test classes testing capital-BE exclusively, kept fee-BE and dynamic SL tests (419 lines remain from 1143)
- `tests/unit/test_mechanical_exit_fixes_2.py` — Removed 2 capital-BE config wiring assertions
- `tests/unit/test_dynamic_protective_sl.py` — Removed 2 capital-BE deprecation tests
- `tests/unit/test_candle_peak_ws.py` — Removed 1 capital-BE reevaluation test
- `tests/unit/test_ml_adaptive_trailing.py` — Removed 1 comment referencing capital-BE

**Active exit layers (unchanged):** Dynamic Protective SL (Layer 1) -> Fee-Breakeven (Layer 2) -> Trailing Stop v3 (Layer 3)

---

## 3. Satellite Experiments (16 files)

**What it was:** One-time research scripts for backtesting: asymmetric risk, exit timing, fakeout detection, funding flips, liquidation cascades, regime transitions, squeeze detection, stop survival, trailing calibration, vol regime shifts, etc.

**Why removed:** Zero production callers. These ran manually via `run_all.py` for research. Results informed model design but the scripts themselves served no ongoing purpose.

**Deleted:** Entire `satellite/experiments/` directory (16 files: 13 `exp_*.py`, `harness.py`, `run_all.py`, `__init__.py`, `README.md`)

---

## 4. Dead Nous Client Method (10 lines)

**What it was:** `NousClient.detect_contradiction()` — called Nous `/v1/contradictions/detect` endpoint.

**Why removed:** 0 callers anywhere in the codebase. Contradiction detection is handled by the daemon's conflict resolution cycle, not this client method.

**File modified:** `src/hynous/nous/client.py`

**Not removed:** `classify_query()` — initially flagged as dead but verified to be actively used by `retrieval_orchestrator.py:150`.

---

## 5. Dead Daemon Methods (44 lines)

**What they were:**
- `_build_ml_context()` — Built ML conditions text block for scanner wakes. Never wired in.
- `_store_thought()` — Stored Haiku questions for injection. Never called (incomplete coach feature).

**Why removed:** 0 callers each. Both were partial implementations that were superseded by other approaches (briefing injection for ML context, `_pending_thoughts` list for coach thoughts).

**File modified:** `src/hynous/intelligence/daemon.py`

---

## 6. Untracked WS Test Scripts (2 files)

**What they were:** `scripts/ws_diagnostic.py` (259 lines) and `scripts/ws_soak_test.py` (245 lines) — one-time WebSocket validation tools used during WS migration Phase 1.

**Why removed:** WS migration is verified and deployed. These were manual diagnostic tools that sat untracked in git (`??` status). No programmatic references.

---

## Verification

- **Unit tests:** 749 passed, 0 regressions (1 pre-existing failure unrelated: model name assertion in test_token_optimization.py)
- **Satellite tests:** Not affected (experiments/ had no production callers)
- **No import errors:** All deleted code was unreachable — no module depends on removed symbols
- **VPS deployment:** Changes not yet deployed — requires `git pull && systemctl restart`
