# Core Module

> Shared utilities used throughout Hynous.

---

## Structure

```
core/
├── config.py          # Configuration loading (YAML + .env)
├── types.py           # Shared type definitions
├── errors.py          # Custom exceptions
├── logging.py         # Logging setup
├── clock.py           # Timestamp injection for agent messages
├── costs.py           # LLM cost tracking (per-model, per-session)
├── persistence.py     # Paper trading state + conversation history persistence
├── daemon_log.py      # Daemon event logging for UI display
└── memory_tracker.py  # Memory mutation tracking per agent cycle
```

---

## Configuration

Config is loaded from YAML files in `config/` and `.env`:

```python
from hynous.core import load_config

config = load_config()  # Loads config/default.yaml + .env
print(config.execution.mode)  # "paper"
print(config.agent.model)     # "openrouter/anthropic/claude-sonnet-4-5-20250929"
print(config.agent.max_tokens) # 2048 (default, overridable per wake type)
```

---

## Types

Shared types avoid duplication:

```python
from hynous.core.types import Symbol, Timeframe, Side

symbol: Symbol = "BTC"
timeframe: Timeframe = "1h"
side: Side = "long"
```

---

## Errors

Custom exceptions for clear error handling:

```python
from hynous.core.errors import (
    HynousError,        # Base exception
    ConfigError,        # Configuration issues
    ProviderError,      # Data provider issues
    AgentError,         # LLM/agent issues
)
```

---

## Logging

Consistent logging across modules:

```python
from hynous.core.logging import get_logger

logger = get_logger(__name__)
logger.info("Something happened")
```
