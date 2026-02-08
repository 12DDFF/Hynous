# Core Module

> Shared utilities used throughout Hynous.

---

## Structure

```
core/
├── config.py      # Configuration loading
├── types.py       # Shared type definitions
├── errors.py      # Custom exceptions
└── logging.py     # Logging setup
```

---

## Configuration

Config is loaded from YAML files in `config/`:

```python
from hynous.core import load_config

config = load_config()  # Loads config/default.yaml
print(config.execution.mode)  # "paper"
print(config.agent.model)     # "claude-sonnet-4-20250514"
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
