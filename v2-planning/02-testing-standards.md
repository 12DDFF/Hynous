# 02 — Testing Standards

> This document defines the testing protocol that every v2 phase must follow. It's referenced by every phase plan. Read it once, then refer back as needed.

---

## Philosophy

Two categories of tests matter for v2, and both must pass before any phase is accepted:

1. **Static tests**: can the code be parsed, type-checked, and linted without errors?
2. **Dynamic tests**: does the code do what it claims to do when you actually run it?

Neither category substitutes for the other. Static tests catch contract violations at the boundary. Dynamic tests catch behavior violations at runtime. v2 requires both because the codebase is highly interconnected — a change that type-checks can still break the running system if the types are wrong at runtime.

A third, implicit category matters: **you wrote the test, did you verify it would catch the bug?** Every new test must be validated by demonstrating that it fails when the code is broken. A test that passes against both the correct and incorrect implementation is worthless.

---

## Static Tests (Required)

### Type checking with mypy

Every phase must preserve the mypy baseline. No new errors.

**Setup:** On the v2 branch, before starting phase 0, capture the mypy error count:

```bash
cd /Users/bauthoi/Documents/Hynous
source .venv/bin/activate
mypy src/hynous/ 2>&1 | tee storage/mypy-baseline.txt
mypy src/hynous/ 2>&1 | tail -1 > storage/mypy-baseline-count.txt
```

This produces a baseline count of existing mypy errors. Phase 0 commits this baseline to the `v2-planning/` directory as `mypy-baseline-count.txt`.

**After every phase:**

```bash
mypy src/hynous/ 2>&1 | tail -1
```

Compare to baseline. The number must be **equal or lower**. If higher, the phase introduced new type errors and is not accepted.

**New code must be fully typed.** Use:
- Concrete types for all function parameters and return values
- `|` syntax for unions (`int | None`, not `Optional[int]`)
- `list[T]`, `dict[K, V]` from builtins (not `List`, `Dict` from typing)
- `TypedDict` for dict shapes that cross module boundaries
- `@dataclass` for structured data carriers

**Do not use:**
- `Any` without explicit justification in a comment
- `# type: ignore` without a specific error code and justification
- `type: ignore[misc]` (catch-all suppressions are forbidden)

### Linting with ruff

Every phase must preserve the ruff baseline.

**Setup:** Same as mypy; capture baseline on phase 0:

```bash
ruff check src/hynous/ 2>&1 | tee storage/ruff-baseline.txt
ruff check src/hynous/ --statistics 2>&1 > storage/ruff-baseline-stats.txt
```

**After every phase:**

```bash
ruff check src/hynous/ --statistics
```

The count must be equal or lower per category. Ruff config lives in `pyproject.toml`; do not change it without approval.

**New code standards:**
- Line length ≤ 100 characters (ruff-enforced)
- No unused imports
- No undefined names
- No shadow-builtin names in new code

### Import sanity check

Every new public module must import cleanly without side effects:

```bash
python -c "from hynous import <your_module>; print('ok')"
python -c "from hynous.<your_module> import <PublicClass>; print('ok')"
```

If an import triggers a network call, DB connection, or file write, that's a failure. Initialization belongs in explicit `init()` functions, not at import time.

### Schema validation

For any phase that adds or modifies SQLite schemas:

```bash
# Delete any test DB, create fresh, inspect
rm -f /tmp/test_schema.db
python -c "
from hynous.<module>.schema import init_schema
import sqlite3
conn = sqlite3.connect('/tmp/test_schema.db')
init_schema(conn)
# Dump schema
for row in conn.execute('SELECT sql FROM sqlite_master WHERE type=\"table\"'):
    print(row[0])
"
```

The schema output must match the plan's DDL exactly. Any drift is a failure.

---

## Dynamic Tests (Required)

### Unit tests

Every phase that adds code must add corresponding unit tests in `tests/unit/test_<module>.py`. Unit tests must:

1. **Cover the happy path** for every public function
2. **Cover at least one error path** for every public function that can fail
3. **Be isolated** — no shared state between tests, no external dependencies (DB, HTTP, file system beyond a tmp_path fixture)
4. **Be fast** — no individual test should take more than 100ms
5. **Be deterministic** — no time-based flakiness, no race conditions, no `time.sleep()` except in explicit concurrency tests
6. **Validate what matters** — test the contract, not the implementation

**Fixture conventions:**

```python
# tests/conftest.py already has common fixtures
import pytest

@pytest.fixture
def tmp_journal_db(tmp_path):
    """Fresh journal DB in a tmp directory, auto-cleaned."""
    db_path = tmp_path / "journal.db"
    from hynous.journal.store import JournalStore
    store = JournalStore(str(db_path))
    yield store
    store.close()

@pytest.fixture
def sample_entry_snapshot():
    """A minimal but complete TradeEntrySnapshot for tests."""
    from hynous.journal.schema import TradeEntrySnapshot
    return TradeEntrySnapshot(...)  # fill with plausible values
```

Use fixtures heavily. They're the main mechanism for keeping tests fast and isolated.

**Mocking conventions:**

External dependencies (LLM calls, exchange API, data-layer HTTP) must be mocked. Use `unittest.mock.patch`:

```python
from unittest.mock import patch, MagicMock

def test_analysis_agent_calls_llm_with_expected_prompt(tmp_journal_db):
    with patch("hynous.analysis.llm_pipeline.call_llm") as mock_llm:
        mock_llm.return_value = {"narrative": "...", "findings": [...]}
        result = run_analysis(trade_id="abc123")
        assert mock_llm.called
        call_args = mock_llm.call_args
        assert "trade_id" in call_args.kwargs
```

**Never mock internal project code.** If you find yourself patching `hynous.journal.store.get_trade`, your test is testing the wrong thing — refactor the code under test to accept the store as a parameter and pass a real fixture.

**Coverage target:** ≥ 80% line coverage for new code in each phase. Measured with `pytest --cov=hynous.<module>`. This is not a hard gate but significantly lower coverage should be explained in the report-back.

### Integration tests

Where a phase changes how components interact, add integration tests in `tests/integration/test_<module>_integration.py`. Integration tests may:

- Use a real SQLite DB on disk (in a tmp dir)
- Spin up a FastAPI test client for API route tests
- Run short end-to-end flows (e.g., "execute_trade → emit events → close → analysis runs")
- Use real provider code in paper mode (`PaperProvider`)

Integration tests must NOT:
- Touch the real network (no real HL API calls, no real LLM calls)
- Leave artifacts after the test run (all files in tmp, all state cleaned up)
- Take longer than 5 seconds per test

Example integration test shape:

```python
def test_full_trade_lifecycle_produces_complete_journal_record(tmp_path):
    # Setup: fresh journal, fake daemon state, fake provider
    journal = JournalStore(str(tmp_path / "journal.db"))
    fake_provider = FakePaperProvider()
    
    # Execute: simulate a full trade
    trade_id = execute_trade_mechanical(
        symbol="BTC",
        side="long",
        signal=mock_entry_signal(),
        provider=fake_provider,
        journal=journal,
    )
    
    # Simulate mechanical events during hold
    emit_event(journal, trade_id, "dynamic_sl_placed", {...})
    emit_event(journal, trade_id, "trail_activated", {...})
    emit_event(journal, trade_id, "trail_updated", {...})
    
    # Close
    record_exit(journal, trade_id, exit_snapshot=mock_exit_snapshot())
    
    # Verify: full record exists and is queryable
    trade = journal.get_trade(trade_id)
    assert trade["status"] == "closed"
    assert len(trade["events"]) == 3
    assert trade["entry_snapshot"] is not None
    assert trade["exit_snapshot"] is not None
```

### Regression tests

After every phase, run the full existing test suite:

```bash
pytest tests/ -v
```

**Zero new failures allowed.** If a v1 test fails because v2 changed behavior, one of two things is true:
1. The v1 test was testing something v2 intentionally removes — delete the test in the same phase that removes the feature
2. The v2 change broke something it shouldn't have — fix the v2 change

Do not skip, xfail, or mark tests as `@pytest.mark.skip` to make them pass. Either delete the test (with justification in the phase report-back) or fix the code.

### Smoke test

After every phase, run the daemon in paper mode for 5 minutes and confirm no unhandled exceptions:

```bash
cd /Users/bauthoi/Documents/Hynous
source .venv/bin/activate
timeout 300 python -m scripts.run_daemon 2>&1 | tee storage/smoke-phase-<N>.log
```

Inspect `storage/smoke-phase-<N>.log` for:
- `ERROR` log lines → must investigate each one
- Tracebacks → all must be accounted for (expected recovery vs. actual bug)
- Daemon startup completion (the "daemon started" log line must appear)
- At least one `_fast_trigger_check` cycle (look for the log line the trigger check emits)

For phases that add new scheduled work (cron jobs, background threads), extend the smoke test window to cover at least one cycle of the new work.

### Database state validation

For phases that persist data (phase 1, 2, 3, 6), after running the smoke test, inspect the resulting DB state:

```bash
sqlite3 storage/journal.db <<EOF
.schema
SELECT COUNT(*) FROM trades;
SELECT COUNT(*) FROM trade_events;
SELECT COUNT(*) FROM trade_analyses;
EOF
```

The engineer should verify:
- Tables exist with the expected schema
- At least a handful of rows exist after smoke testing
- Row counts are consistent across tables (e.g., every `trade_events.trade_id` exists in `trades`)
- Indexes are populated (check `EXPLAIN QUERY PLAN` for common queries)

---

## Phase-Specific Testing Requirements

Each phase plan document includes a testing section that may add phase-specific requirements on top of this baseline. Always follow both: the baseline in this document AND the phase-specific additions.

Common phase-specific additions include:
- **Phase 1**: verify rich entry snapshots contain all 40+ fields; verify lifecycle events emit at every expected mutation point
- **Phase 2**: verify journal CRUD operations; verify semantic search returns correct ordering; verify FastAPI routes return expected shapes
- **Phase 3**: verify deterministic rules fire correctly against synthetic trade data; verify LLM pipeline produces valid output shape; verify evidence references resolve to real data
- **Phase 5**: verify mechanical entry produces same output as LLM entry for identical inputs (baseline comparison)
- **Phase 7**: verify dashboard pages render without errors; verify API routes return journal data correctly

---

## Acceptance Criteria Format

Every phase document ends with an "Acceptance Criteria" section. It's a bullet list of boolean checks. The engineer runs each check and reports the result as:

- ✓ if passed
- ✗ if failed (with explanation)
- ⊘ if not applicable (with explanation)

Example acceptance criteria block:

```
## Acceptance criteria

- [ ] All new unit tests pass (`pytest tests/unit/test_journal.py`)
- [ ] All new integration tests pass (`pytest tests/integration/test_journal_integration.py`)
- [ ] Full test suite passes (`pytest tests/`)
- [ ] mypy baseline preserved (`mypy src/hynous/` count ≤ baseline)
- [ ] ruff baseline preserved (`ruff check src/hynous/` count ≤ baseline)
- [ ] Smoke test runs for 5 minutes without ERROR-level logs
- [ ] Journal DB contains expected tables and indexes (`sqlite3 storage/journal.db .schema`)
- [ ] Every public function in journal module has a docstring
- [ ] Every public function in journal module is typed
- [ ] Phase document's explicit acceptance criteria all pass (see phase doc)
```

Engineers must report all criteria results in their report-back. A phase with any ✗ is not accepted.

---

## Report-Back Template

When a phase is complete, the engineer reports back to the user with this structure:

```markdown
## Phase <N> Report

### Summary
<3–5 sentences: what was built, what changed>

### Commits
- `<sha>` — <commit message>
- `<sha>` — <commit message>
- ...

### Static tests
- mypy baseline: <N> (before) → <N> (after) ✓
- ruff baseline: <N> (before) → <N> (after) ✓

### Dynamic tests
- Unit: `<N>` tests, `<N>` passed, `<N>` failed
- Integration: `<N>` tests, `<N>` passed, `<N>` failed
- Full regression: `<total>` tests, `<N>` passed, `<N>` failed, `<N>` new failures
- Smoke test: ✓ (no ERROR logs in 5min run) / ✗ (explain)

### Phase-specific tests
<list from phase doc, each ✓/✗>

### Acceptance criteria
<list from phase doc, each ✓/✗>

### Deviations from the plan
<any place you did something different, with justification, or "none">

### Observations
<anything you noticed that might affect later phases, or "none">

### Next phase blockers
<questions or issues that must be resolved before phase N+1, or "none">
```

If anything fails or blocks, the engineer instead reports a **pause request** in this shape:

```markdown
## Phase <N> Pause Request

### What was attempted
<what you tried to do>

### Current state
- Committed: <yes/no>
- Partial: <yes/no, details>
- Rolled back: <yes/no>

### Issue encountered
<specific error, unexpected behavior, or plan ambiguity>

### What I tried
<debugging steps, workarounds you considered>

### Questions for user
1. <specific question>
2. <specific question>
```

---

## Anti-Patterns (Don't Do These)

These are common shortcuts that look fine but violate the v2 quality bar. Avoid all of them.

### Anti-pattern 1: Mocking the code under test

```python
# BAD
def test_store_trade():
    with patch("hynous.journal.store.JournalStore.store_trade") as mock:
        mock.return_value = "trade_abc"
        result = my_function_that_calls_store_trade()
        assert result == "trade_abc"
```

The test doesn't test `my_function_that_calls_store_trade` — it tests that `mock.return_value` works. Refactor to use a real `JournalStore` fixture.

### Anti-pattern 2: Deep assertion on implementation details

```python
# BAD
def test_compute_entry_score():
    result = compute_entry_score(features)
    assert result._internal_weight_cache[0] == 0.3  # BAD — testing implementation
```

Assert on the **contract** (the return value, the side effects), not the internals.

### Anti-pattern 3: Test that doesn't actually assert

```python
# BAD
def test_analysis_agent_runs():
    result = run_analysis(trade_id="abc")
    assert result  # BAD — tests nothing specific
```

Assert on **specific properties** of the result. "It was truthy" is not a test.

### Anti-pattern 4: `time.sleep` in tests

```python
# BAD
def test_background_worker():
    worker.start()
    time.sleep(2)  # BAD — flaky
    assert worker.processed_count > 0
```

Use explicit synchronization: events, futures, polling with timeouts, or test the worker's work function directly without the thread.

### Anti-pattern 5: Test that pollutes global state

```python
# BAD
def test_config_loading():
    os.environ["SOMETHING"] = "value"  # never unset
    config = load_config()
    assert config.something == "value"
```

Use `monkeypatch` fixture from pytest:

```python
def test_config_loading(monkeypatch):
    monkeypatch.setenv("SOMETHING", "value")
    config = load_config()
    assert config.something == "value"
```

### Anti-pattern 6: Catching exceptions in tests to "make them pass"

```python
# BAD
def test_risky_operation():
    try:
        risky_operation()
    except Exception:
        pass  # BAD — test can never fail
```

If the operation might raise, `pytest.raises(ExpectedType)` is the only acceptable pattern:

```python
def test_risky_operation_raises():
    with pytest.raises(ValueError, match="expected message"):
        risky_operation()
```

### Anti-pattern 7: Skipping tests to make CI green

```python
# BAD
@pytest.mark.skip(reason="flaky")
def test_something():
    ...
```

Fix the flakiness. If you can't, delete the test and document why in the phase report-back. `@pytest.mark.skip` without explicit approval is forbidden.

---

## Debug Protocol When Tests Fail

1. **Read the error.** Actually read it. Don't just rerun.
2. **Reproduce in isolation.** Can you trigger the failure with a single test invocation? If yes, focus there. If no, look for shared state.
3. **Check for recent changes.** `git diff HEAD~1` — did your last change touch something related?
4. **Read the code under test.** Not just your test code. The actual code path.
5. **Add logging or use pdb.** Temporarily add `import pdb; pdb.set_trace()` or add `logger.debug(...)` statements. Remove them before committing.
6. **Check assumptions.** What are you assuming about the fixture, the environment, the data? Write that assumption as an assertion at the top of the test.
7. **If stuck after 30 minutes: pause and report.** Don't spin for hours. The plan exists so you don't have to figure everything out alone.

---

## One Rule That Overrides Everything Else

**If a test passes but you're not sure why, it doesn't count.**

The whole point of writing a test is to create a machine-verified claim that the code works. If you wrote a test, ran it, saw green, and can't explain why it's green, the claim isn't verified. Delete the test and write one you understand, or verify the passing test by temporarily breaking the code and confirming it turns red.

Phases are accepted based on tests passing AND the engineer having confidence in what the tests prove. Vague green bars are not acceptance.
