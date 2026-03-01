# Tests

> Test suites for Hynous.

---

## Structure

```
tests/
├── unit/               # Test individual functions
├── integration/        # Test component interactions
└── e2e/                # Test full user flows

satellite/tests/        # Satellite subsystem tests
data-layer/tests/       # Data layer subsystem tests
```

---

## Running Tests

```bash
# All tests (PYTHONPATH required)
PYTHONPATH=src pytest

# Unit tests only
PYTHONPATH=src pytest tests/unit/

# Integration tests
PYTHONPATH=src pytest tests/integration/

# With coverage
PYTHONPATH=src pytest --cov=src/hynous

# Specific file
PYTHONPATH=src pytest tests/unit/test_retrieval_orchestrator.py
```

> **Note:** Python tests require `PYTHONPATH=src` to be set. This is not configured in `pytest.ini` / `pyproject.toml` — you must set it manually or via your IDE.

---

## Test Categories

### Unit Tests (`tests/unit/`)

Test individual functions in isolation. Mock external dependencies.

| File | Coverage |
|------|----------|
| `test_retrieval_orchestrator.py` | 48 tests: decomposition strategies, quality gate, merge & select, reformulation, config loading |
| `test_trade_retrieval.py` | 29 tests: `_store_to_nous()` event_time, memory_type normalization, thesis enrichment, trade stats caching |
| `test_gate_filter.py` | Gate filter rejection rules (too_short, gibberish, spam, filler, etc.) |
| `test_consolidation.py` | Background consolidation engine (pattern detection, knowledge promotion) |
| `test_decay_conflict_fixes.py` | 59 tests: FSRS decay cycle, fading alerts, conflict auto-resolve |
| `test_intent_boost.py` | Intent-based search boosting |
| `test_playbook_matcher.py` | 27 tests: playbook trigger matching, TTL cache, format output |
| `test_pruning.py` | Two-phase memory pruning (analyze + batch) |
| `test_sections.py` | Memory section classification and bias layer |
| `test_token_optimization.py` | Token budget optimization |

### Integration Tests (`tests/integration/`)

Test multiple components working together. May use real databases (test instances).

| File | Coverage |
|------|----------|
| `test_orchestrator_integration.py` | 10 tests: full pipeline with mock NousClient, compound query decomposition, timeout handling |
| `test_trade_retrieval_integration.py` | 6 tests: trade browse recall, time-filtered stats, thesis extraction pipeline |
| `test_gate_filter_integration.py` | Gate filter in store flow |
| `test_playbook_integration.py` | Playbook matching end-to-end with mock scanner data |
| `test_pruning_integration.py` | Pruning pipeline with real graph structures |

### E2E Tests (`tests/e2e/`)

Test full user flows. May require running services.

| File | Coverage |
|------|----------|
| `test_live_orchestrator.py` | 21 live dynamic tests: real Nous server queries, end-to-end retrieval orchestration |

### Satellite Tests (`satellite/tests/`)

Tests for the satellite subsystem (Artemis on-chain data, feature engineering, ML labeling).

| File | Coverage |
|------|----------|
| `test_artemis.py` | Artemis pipeline processing |
| `test_features.py` | Feature engineering |
| `test_labeler.py` | ML label generation |
| `test_normalize.py` | Data normalization |
| `test_safety.py` | Safety checks and validation |
| `test_training.py` | Training data preparation |

### Data Layer Tests (`data-layer/tests/`)

Tests for the data layer subsystem (Hyperliquid market data, order flow, liquidation heatmaps).

| File | Coverage |
|------|----------|
| `test_historical_tables.py` | Historical data table management |
| `test_liq_heatmap.py` | Liquidation heatmap generation |
| `test_order_flow.py` | Order flow / CVD computation |
| `test_rate_limiter.py` | API rate limiter |
| `test_smoke.py` | Smoke tests for basic functionality |

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
3. **Clear test names** -- `test_agent_returns_error_on_invalid_symbol`
4. **Mock external services** -- Don't hit real APIs in tests

---

Last updated: 2026-03-01
