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
├── trade_analytics.py # Trade performance analytics (TradeRecord, TradeStats, thesis enrichment, time filtering)
├── trading_settings.py # Runtime-adjustable trading parameters (TradingSettings dataclass, JSON persistence, thread-safe singleton)
├── persistence.py     # Paper trading state + conversation history persistence
├── daemon_log.py      # Daemon event logging for UI display
├── memory_tracker.py  # Memory mutation tracking per agent cycle
├── equity_tracker.py  # Append-only equity curve persistence (5-min snapshots, 30-day prune)
├── request_tracer.py  # Debug trace collector (spans per agent.chat() call)
└── trace_log.py       # Trace persistence + content-addressed payload storage
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
print(config.orchestrator.enabled)  # True (retrieval orchestrator)
```

Key config dataclasses: `AgentConfig`, `MemoryConfig`, `OrchestratorConfig`, `DaemonConfig`, `NousConfig`, `ExecutionConfig`, `DiscordConfig`.

---

## Trading Settings

Runtime-adjustable parameters persisted to `storage/trading_settings.json`. Thread-safe singleton with lazy loading. Read by `prompts/builder.py` to inject live values into the system prompt.

```python
from hynous.core.trading_settings import get_trading_settings

ts = get_trading_settings()
print(ts.tier_high_margin_pct)   # High conviction margin %
print(ts.micro_leverage)         # Micro trade leverage
print(ts.small_wins_mode)        # Whether small wins exit mode is active
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

---

## Request Tracing

Debug trace infrastructure for the dashboard's trace inspector. Records every `agent.chat()` / `chat_stream()` call as a trace with ordered spans.

### `request_tracer.py` -- In-process trace collector

Thread-safe singleton (same pattern as `memory_tracker.py`). Records spans during each chat call, flushes completed traces to `trace_log.py`.

```python
from hynous.core.request_tracer import get_tracer, set_active_trace, get_active_trace

# Begin a trace (called at start of agent.chat())
trace_id = get_tracer().begin_trace("user_chat", "What's BTC doing?")

# Set thread-local context (so tools/memory.py can record spans without explicit trace_id)
set_active_trace(trace_id)

# Record spans during the request
get_tracer().record_span(trace_id, {"type": "llm_call", "model": "claude-sonnet", ...})

# End trace (persists to disk)
get_tracer().end_trace(trace_id, "completed", "BTC is at $97K...")
```

Span types: `context`, `retrieval`, `llm_call`, `tool_execution`, `memory_op`, `compression`, `queue_flush`, `trade_step`.

### `trace_log.py` -- Persistence + content-addressed payloads

Follows `daemon_log.py` pattern: thread-safe, Lock, lazy load, FIFO cap at 500, 14-day retention.

Large payloads (LLM messages, responses, injected context) are stored via SHA256 content-addressing in `storage/payloads/` for deduplication. Span fields ending in `_hash` reference these payloads. The dashboard's `debug_spans_display` computed var resolves hashes to actual content for display.

```python
from hynous.core.trace_log import store_payload, load_payload

hash_id = store_payload(json.dumps(messages))  # Returns SHA256[:16]
content = load_payload(hash_id)                # Returns original content
```

---

Last updated: 2026-03-01
