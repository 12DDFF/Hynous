# Tests

> Test suites for Hynous.

---

## Structure

```
tests/
├── unit/           # Test individual functions
├── integration/    # Test component interactions
└── e2e/            # Test full user flows
```

---

## Running Tests

```bash
# All tests
pytest

# Unit tests only
pytest tests/unit/

# With coverage
pytest --cov=src/hynous

# Specific file
pytest tests/unit/test_agent.py
```

---

## Test Categories

### Unit Tests (`unit/`)

Test individual functions in isolation.
Mock external dependencies.

Key test files:
- `test_retrieval_orchestrator.py` — 48 tests: decomposition strategies, quality gate, merge & select, reformulation, config loading
- `test_trade_retrieval.py` — 29 tests: `_store_to_nous()` event_time, memory_type normalization, thesis enrichment, trade stats caching, tool definition, output formatting
- `test_gate_filter.py` — Gate filter rejection rules
- `test_agent.py` — Agent prompt building and tool execution

```python
# tests/unit/test_agent.py

def test_agent_formats_prompt():
    agent = Agent(mock_config)
    prompt = agent._build_prompt("Hello")
    assert "Hynous" in prompt
```

### Integration Tests (`integration/`)

Test multiple components working together.
May use real databases (test instances).

Key test files:
- `test_orchestrator_integration.py` — 10 tests: full pipeline with mock NousClient, compound query decomposition, timeout handling, filter passthrough, fallback behavior
- `test_trade_retrieval_integration.py` — 6 tests: trade browse recall, time-filtered stats, thesis extraction pipeline, empty result messages
- `test_gate_filter_integration.py` — Gate filter in store flow

```python
# tests/integration/test_chat_flow.py

async def test_chat_stores_in_memory():
    agent = Agent(config)
    store = NousStore(":memory:")

    response = await agent.chat("Remember this")

    nodes = store.search("remember")
    assert len(nodes) > 0
```

### E2E Tests (`e2e/`)

Test full user flows.
May require running services.

```python
# tests/e2e/test_dashboard.py

def test_home_page_loads():
    # Uses Reflex testing utilities
    ...
```

---

## Fixtures

Common fixtures live in `conftest.py`:

```python
# tests/conftest.py

@pytest.fixture
def mock_config():
    return Config(...)

@pytest.fixture
def memory_store():
    return NousStore(":memory:")
```

---

## Writing Good Tests

1. **Test behavior, not implementation**
2. **One assertion per test** (when possible)
3. **Clear test names** — `test_agent_returns_error_on_invalid_symbol`
4. **Mock external services** — Don't hit real APIs in tests
