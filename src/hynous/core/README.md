# Core Module

> Shared utilities used throughout Hynous.

---

## Structure

```
core/
├── config.py           # Configuration loading (YAML + .env)
├── clock.py            # Timestamp injection for agent messages
├── costs.py            # LLM cost tracking (per-model, per-session)
├── trading_settings.py # Runtime-adjustable trading parameters (TradingSettings dataclass,
│                       # JSON persistence, thread-safe singleton)
├── persistence.py      # Paper trading state + conversation history persistence
├── daemon_log.py       # Daemon event logging for UI display
├── equity_tracker.py   # Append-only equity curve persistence (5-min snapshots, 30-day prune)
├── request_tracer.py   # Debug trace collector (spans per user-chat call)
└── trace_log.py        # Trace persistence + content-addressed payload storage
```

---

## Configuration

Config is loaded from YAML files in `config/` and `.env`:

```python
from hynous.core.config import load_config

config = load_config()  # Loads config/default.yaml + .env
print(config.execution.mode)       # "paper"
print(config.v2.journal.db_path)   # "storage/v2/journal.db"
print(config.v2.user_chat.model)   # user-chat model id
```

Key config dataclasses defined in `config.py`:

- `Config` (root)
- `AgentConfig`, `ExecutionConfig`, `HyperliquidConfig`
- `DaemonConfig`, `ScannerConfig`, `DataLayerConfig`, `SatelliteConfig`
- `V2Config` with sub-configs: `V2JournalConfig`, `V2AnalysisAgentConfig`,
  `V2MechanicalEntryConfig`, `V2ConsolidationConfig`, `V2UserChatConfig`

---

## Trading Settings

Runtime-adjustable parameters persisted to `storage/trading_settings.json`.
Thread-safe singleton with lazy loading. Read by `mechanical_entry/`
(conviction margin + dynamic-SL clamps + fee-BE math) and `daemon.py`
(circuit breaker, TP protection, small-wins exits).

```python
from hynous.core.trading_settings import get_trading_settings

ts = get_trading_settings()
print(ts.taker_fee_pct)
print(ts.dynamic_sl_normal_vol)
```

---

## Logging & Errors

v2 uses Python stdlib `logging` directly (`logging.getLogger(__name__)`)
and raises stdlib exceptions (`ValueError`, `RuntimeError`,
`FileNotFoundError`). There is no custom logger wrapper or error
hierarchy in `core/` -- the previous `logging.py` / `errors.py` / `types.py`
modules were removed during the v2 rebuild.

---

## Request Tracing

Debug trace infrastructure for the dashboard's trace inspector. Records
every user-chat LLM call as a trace with ordered spans.

### `request_tracer.py` -- In-process trace collector

Thread-safe singleton. Records spans during each call, flushes completed
traces to `trace_log.py`.

```python
from hynous.core.request_tracer import get_tracer, set_active_trace

trace_id = get_tracer().begin_trace("user_chat", "What's BTC doing?")
set_active_trace(trace_id)
get_tracer().record_span(trace_id, {"type": "llm_call", "model": "claude-sonnet", ...})
get_tracer().end_trace(trace_id, "completed", "BTC is at $97K...")
```

Span types: `context`, `retrieval`, `llm_call`, `tool_execution`,
`memory_op`, `compression`, `queue_flush`, `trade_step`.

### `trace_log.py` -- Persistence + content-addressed payloads

Thread-safe, FIFO cap at 500, 14-day retention.

Large payloads (LLM messages, responses, injected context) are stored
via SHA256 content-addressing in `storage/payloads/` for deduplication.
Span fields ending in `_hash` reference these payloads; the dashboard's
`debug_spans_display` computed var resolves hashes at render time.

```python
from hynous.core.trace_log import store_payload, load_payload

hash_id = store_payload(json.dumps(messages))  # Returns SHA256[:16]
content = load_payload(hash_id)                # Returns original content
```

---

## Cost Tracking

`costs.py` records per-model, per-session LLM token spend. Used by the
user-chat agent and analysis agent to attribute cost back to individual
calls and expose totals to the dashboard.

---

## Equity & Daemon Logs

- `equity_tracker.py` -- append-only equity snapshots (5-minute cadence,
  30-day rolling prune). Feeds the dashboard equity curve.
- `daemon_log.py` -- capped, thread-safe daemon event log. Powers the
  "daemon activity" panel in the dashboard.

---

Last updated: 2026-04-12 (phase 7 complete)
