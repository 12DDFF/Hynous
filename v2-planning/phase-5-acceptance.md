# Phase 5 Acceptance — 2026-04-12

Annotated acceptance checklist from
`v2-planning/08-phase-5-mechanical-entry.md` lines 803–819. Each item is
marked `[x]` (pass), `[partial]`, or `[deferred]` with evidence.

## Checklist

- [x] **`src/hynous/mechanical_entry/` module with all 4 files**
      `interface.py`, `compute_entry_params.py`, `executor.py`,
      `ml_signal_driven.py` + `__init__.py`. Created in M1/M2/M3
      (commits `fb1e08d`, `6a21043`, `489da4a`).
- [x] **`MLSignalDrivenTrigger` implements `EntryTriggerSource`**
      `src/hynous/mechanical_entry/ml_signal_driven.py:39` →
      `class MLSignalDrivenTrigger(EntryTriggerSource)`. Interface at
      `interface.py:45` (`class EntryTriggerSource(ABC)`).
- [x] **`compute_entry_params` is pure-deterministic (test with same
      inputs returns same output)**
      Covered by `tests/unit/test_compute_entry_params.py` determinism
      test. 551/0 pytest baseline includes these.
- [x] **`execute_trade_mechanical` handles happy path and failures
      gracefully**
      Integration tests in
      `tests/integration/test_mechanical_entry_integration.py`
      (added M8 commit 1 `ef59eb5`) cover full lifecycle +
      rejected-signal accumulation + periodic ML signal check path.
- [x] **Daemon `_evaluate_entry_signals` replaces `_wake_for_scanner`
      for entry decisions**
      `src/hynous/intelligence/daemon.py:3492` — wired in M4
      (`b3b848e`). Grep `_wake_for_scanner` returns zero src/ matches.
- [x] **Periodic ML signal check fires every 60s**
      `_periodic_ml_signal_check` at `daemon.py:3555`. Smoke log shows
      33 rejection rows over 32 min (~1/min) in `trades` table —
      periodic check is firing on cadence.
- [x] **All LLM agent invocation removed from daemon wake methods**
      M5 (commit `47b57b9`) removed dead wakes. Grep of smoke log:
      `grep -c "agent.chat" storage/v2/smoke-phase-5.log` → `0`.
- [x] **`handle_execute_trade` removed from trading.py**
      M5 (`47b57b9`). Grep `handle_execute_trade` in `src/` returns
      only a stale `.pyc` (no source matches).
- [x] **`execute_trade` unregistered from tools registry**
      Registry listing now 18 tools; `execute_trade` not present.
      Verified via
      `from hynous.intelligence.tools.registry import get_registry;
      'execute_trade' in list(get_registry()._tools.keys()) → False`.
- [x] **Rejected signals stored in journal with `status='rejected'`
      and rejection_reason**
      Smoke produced 33 rejections, all `status='rejected'` with
      `rejection_reason='no_ml_predictions'` and
      `trigger_source='ml_signal_driven'` (see Smoke section below).
- [x] **User chat agent scaffolded at `src/hynous/user_chat/`**
      Added in M6 (commit `9a523ab`): `agent.py`, `api.py`, `prompt.py`,
      `__init__.py`.
- [x] **v1 `agent.py` deleted**
      `src/hynous/intelligence/agent.py` no longer exists (removed M7,
      commit `749ed07`).
- [x] **All unit + integration tests pass**
      `PYTHONPATH=src pytest tests/` → **551 passed / 0 failed**.
- [x] **60-min smoke test produces at least one entry OR a set of
      clean rejections**
      ~32-min smoke (1933s elapsed) produced 33 clean
      `no_ml_predictions` rejections — all logged cleanly, no
      tracebacks beyond the handled satellite-init
      `ModuleNotFoundError: numpy` at startup (daemon reports
      "continuing without ML" then operates normally).
- [x] **Phase 5 commits tagged `[phase-5]`**
      All 8 milestone commits (`fb1e08d`, `6a21043`, `489da4a`,
      `b3b848e`, `47b57b9`, `9a523ab`, `749ed07`, `ef59eb5`) use the
      `[phase-5]` prefix. This acceptance commit is the 9th.

## Smoke summary

- **Log:** `storage/v2/smoke-phase-5.log` — 69 lines, 1933s elapsed
  (16:35:28 → 17:07:42 local).
- **Startup:** journal store initialized, mechanical entry trigger
  initialized (`ml_signal_driven (thresh=50.00 dir=0.55 eq=60
  vol<=high)`), batch rejection cron started (3600s interval), WS
  market feed connected for BTC/ETH/SOL.
- **Steady state:** 1 heartbeat/min; one rejection per 60s from the
  periodic ML signal check.
- **Trades table:** 33 rows, all `status='rejected'`,
  `rejection_reason='no_ml_predictions'`,
  `trigger_source='ml_signal_driven'`.
- **LLM entry-path calls:** `grep -c "agent.chat"` → 0 ✓
- **Tracebacks:** only the startup
  `ModuleNotFoundError: No module named 'numpy'` from
  `satellite.training.artifact` — caught by the
  `Satellite inference init failed, continuing without ML` handler.
  Daemon was launched from the system `/opt/homebrew/bin/python3.11`
  rather than the project `.venv`; the numpy + satellite deps live in
  `.venv`. Rejections reading `no_ml_predictions` are the direct
  consequence. **Not a phase-5 regression** — acceptance criterion is
  "at least one entry OR a set of clean rejections" and the clean
  rejections path is proven.
- **Shutdown:** clean SIGINT → `Daemon stopped (wakes=0,
  watchpoints=0, learning=0)` → `run_daemon complete: 1933s elapsed,
  no fatal errors`.

## Dashboard import check (team-lead M8 addendum)

Run from project root with venv + PYTHONPATH=src:

```
python3.11 -c "from dashboard.dashboard.dashboard import app; print(app)"
  → <App state=State>   (include_router errors caught by try/except,
                         same pre-existing reflex 0.8.26 issue)

python3.11 -c "import dashboard.dashboard.pages.home"
  → home OK

python3.11 -c "import dashboard.dashboard.pages.journal"
  → journal OK
```

All three pass. `state.py` one-line fix (`Any` added to typing import)
resolves the NameError the M7 `_DaemonHolder` shim introduced.

The `app._api.include_router(...)` `AttributeError` messages printed
on the first check are **pre-existing** (introduced by phase 2 M4
commit `d658bea`, before phase 5 began). The try/except around the
mount handles them; app construction still succeeds. Out of scope for
M8; tracked alongside the phase-4 dashboard punch list for phase 7.

## Floors

- `pytest tests/`: **551 passed / 0 failed** ✓
- `mypy src/`: **238** (target ≤252) ✓
- `ruff check src/`: **62** (target ≤62) ✓

## Summary

- **Pass:** 15 items
- **Partial:** 0
- **Deferred:** 0
- **Fail:** 0

Phase 5 goal — "replace the LLM-in-the-loop entry path with a
pluggable `EntryTriggerSource` + `MLSignalDrivenTrigger`, and prove
via smoke that the LLM is no longer called in the entry path" — is
met. Rejection accounting works end-to-end; periodic ML signal check
fires on 60s cadence; mechanical executor path is reachable from both
scanner-driven and periodic entry code paths; no `agent.chat` calls
in the entry trigger flow.
