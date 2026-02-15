# Trade Debug Interface — Analysis

> Add trade execution telemetry to the debug dashboard. Currently, the entire trade flow is a single opaque `tool_execution` span — every internal step is invisible.

---

## Problem

The debug dashboard captures 7 span types per trace: `context`, `retrieval`, `llm_call`, `tool_execution`, `memory_op`, `compression`, `queue_flush`.

For trades (`execute_trade`, `close_position`, `modify_position`), the **only** thing captured is one flat `tool_execution` span:

```json
{
  "type": "tool_execution",
  "tool_name": "execute_trade",
  "input_args": {"symbol": "BTC", "side": "long", ...},
  "output_preview": "EXECUTED: BTC LONG\nEntry: $68,000...",
  "duration_ms": 675,
  "success": true
}
```

No visibility into: validation, order fills, SL/TP placement, slippage, memory storage, thesis linking, PnL calculation, or any individual step timing.

---

## Current Debug System (Summary)

### Architecture

```
agent.py / memory_manager.py / tools/memory.py
    │  record spans via get_tracer().record_span()
    ▼
request_tracer.py (in-process singleton, thread-safe)
    │  begin_trace() → record_span() → end_trace()
    ▼
trace_log.py (persistent storage, thread-safe)
    │  save_trace() → storage/traces.json
    │  store_payload() → storage/payloads/{hash}.json
    ▼
state.py (dashboard state, polls every 2s)
    │  load_debug_traces() → debug_spans_display computed var
    ▼
pages/debug.py (split-pane UI: sidebar trace list + main timeline)
```

### Key Files

| File | Purpose |
|------|---------|
| `src/hynous/core/request_tracer.py` | In-process tracer singleton (288 lines) |
| `src/hynous/core/trace_log.py` | Persistent storage + content-addressed payloads (235 lines) |
| `src/hynous/intelligence/agent.py` | Records context, llm_call, tool_execution spans |
| `src/hynous/intelligence/memory_manager.py` | Records retrieval, compression, queue_flush spans |
| `src/hynous/intelligence/tools/memory.py` | Records memory_op spans (uses thread-local trace context) |
| `dashboard/dashboard/state.py` | Debug state vars, polling, span display processing |
| `dashboard/dashboard/pages/debug.py` | Debug dashboard UI (456 lines) |
| `storage/traces.json` | Persistent trace storage (FIFO, max 500, 14-day retention) |
| `storage/payloads/` | Content-addressed payload files (SHA256[:16]) |

### 7 Existing Span Types

| Type | Constant | Captured By | Data |
|------|----------|-------------|------|
| `context` | `SPAN_CONTEXT` | `agent.py` | briefing/snapshot presence, user message hash |
| `retrieval` | `SPAN_RETRIEVAL` | `memory_manager.py` | query, results (title, body, score, type, lifecycle) |
| `llm_call` | `SPAN_LLM_CALL` | `agent.py` | model, tokens, stop_reason, message/response hashes |
| `tool_execution` | `SPAN_TOOL_EXEC` | `agent.py` | tool name, input args, output preview, duration |
| `memory_op` | `SPAN_MEMORY_OP` | `tools/memory.py` | operation, memory_type, gate filter, dedup result |
| `compression` | `SPAN_COMPRESSION` | `memory_manager.py` | exchanges evicted, compression input/output |
| `queue_flush` | `SPAN_QUEUE_FLUSH` | `tools/memory.py` | items count, per-item results |

### Span Display Mapping (state.py)

Each span type maps to a label and color for the UI:

| Type | Label | Color |
|------|-------|-------|
| `context` | "Context" | `#818cf8` |
| `retrieval` | "Retrieval" | `#34d399` |
| `llm_call` | "LLM Call" | `#f59e0b` |
| `tool_execution` | "Tool" | `#60a5fa` |
| `memory_op` | "Memory" | `#a78bfa` |
| `compression` | "Compress" | `#fb923c` |
| `queue_flush` | "Queue" | `#94a3b8` |

### Thread-Local Trace Context

Tools that don't receive `trace_id` explicitly use thread-local context:

```python
from ...core.request_tracer import get_active_trace, set_active_trace

# Set in agent.py at start of chat()
set_active_trace(trace_id)

# Read in tools/memory.py handlers
trace_id = get_active_trace()
if trace_id:
    get_tracer().record_span(trace_id, span)
```

This same pattern would be used for trade instrumentation.

---

## Current Trade System (Summary)

### Trade Execution Flow — `execute_trade` (~450-500ms total)

| Step | What Happens | HTTP Calls | Timing |
|------|-------------|------------|--------|
| 1. Circuit breaker | `_check_trading_allowed()` — checks paused, duplicates, max positions | 0 | <1ms |
| 2. Parameter validation | Leverage, size, SL/TP direction, R:R floor, confidence tier, portfolio risk | 0 | <1ms |
| 3. Update leverage | `provider.update_leverage(symbol, leverage)` | 1 (Hyperliquid) | ~85ms |
| 4. Execute order | `provider.market_open()` or `provider.limit_open()` | 1 (Hyperliquid) | ~300-500ms |
| 5. Cache invalidation | Clear snapshot + briefing cache | 0 | <1ms |
| 6. Place SL | `provider.place_trigger_order(tpsl="sl")` — uses `entry_px` param, no price fetch | 1 (Hyperliquid) | ~85ms |
| 7. Place TP | `provider.place_trigger_order(tpsl="tp")` — uses `entry_px` param, no price fetch | 1 (Hyperliquid) | ~85ms |
| 8. Daemon recording | `record_trade_entry()`, `register_position_type()` | 0 | <1ms |
| 9. Store memory | `_store_to_nous()` → Nous `POST /v1/nodes` | 1 (Nous localhost) | ~5ms |
| 10. Thesis linking | Background daemon thread: search theses + create edges (non-blocking) | 2+ (Nous, background) | ~150ms (not in response time) |

### Close Position Flow — `close_position`

| Step | What Happens | HTTP Calls |
|------|-------------|------------|
| 1. Get positions | `provider.get_user_state()` | 1 |
| 2. Execute close | `provider.market_close()` or `limit_open()` | 1 |
| 3. Calculate PnL | gross, fee estimate (0.035%/side), net, leveraged return | 0 |
| 4. Cancel orders | `get_trigger_orders()` + `cancel_order()` per order | 2+ |
| 5. Cache invalidation | Clear snapshot + briefing | 0 |
| 6. Find entry node | `_find_trade_entry()` → Nous search | 1 |
| 7. Store close | `_store_to_nous()` + edge to entry | 2 (Nous) |
| 8. Hebbian strengthen | Background: `strengthen_edge()` (+0.1) | 1 (background) |

### Modify Position Flow — `modify_position`

| Step | What Happens | HTTP Calls |
|------|-------------|------------|
| 1. Get positions | `provider.get_user_state()` | 1 |
| 2. Fetch triggers | `provider.get_trigger_orders(symbol)` | 1 |
| 3. Cancel old orders | Selective: only cancel what's being replaced | 0-2 |
| 4. Place new SL/TP | `place_trigger_order()` per new order | 0-2 |
| 5. Update leverage | `provider.update_leverage()` (if changed) | 0-1 |
| 6. Store modify | `_store_to_nous()` + edge to entry | 2 (Nous) |

### Trade Memory Node Types

| Subtype | Created By | Key Signals |
|---------|-----------|-------------|
| `custom:trade_entry` | `_store_trade_memory()` | action, side, symbol, entry, stop, target, size_usd, fill_sz, confidence, rr_ratio, trade_type |
| `custom:trade_close` | `handle_close_position()` | action, side, symbol, entry, exit, pnl_usd, pnl_pct, lev_return_pct, close_type, size_usd, opened_at |
| `custom:trade_modify` | `handle_modify_position()` | action, side, symbol, mark_px, size, new_stop, new_target, new_leverage |

All linked via `part_of` edges: `entry → close`, `entry → modify` (SSA weight 0.85).

---

## Data Available but Not Captured

### execute_trade

| Step | Data Available | Currently Visible in Debug? |
|------|---------------|-----------------------------|
| Circuit breaker check | pass/fail, reason (paused, duplicate, max positions) | No |
| Parameter validation | leverage validated, R:R calculated, portfolio risk %, coherence check | No |
| Confidence tier | tier name, recommended margin, oversized warning | No |
| `update_leverage()` | symbol, leverage, success/fail, latency | No |
| `get_price()` | fetched price, latency | No |
| `market_open()` / `limit_open()` | avg_px, filled_sz, status, oid, latency | No |
| Fill quality | slippage (requested vs actual fill) | No |
| Cache invalidation | snapshot + briefing cleared | No |
| `place_trigger_order()` SL | price, distance %, success/fail, latency | No |
| `place_trigger_order()` TP | price, distance %, success/fail, latency | No |
| Daemon recording | entry count incremented, position type registered | No |
| `_store_to_nous()` | node_id, subtype, signals dict | No |
| Background thesis linking | theses found, edges created | No (runs in background thread) |

### close_position

| Step | Data Available | Currently Visible in Debug? |
|------|---------------|-----------------------------|
| Position lookup | found/not found, entry_px, side, size | No |
| `market_close()` | exit_px, filled_sz, latency | No |
| PnL calculation | gross, fee estimate, net, leveraged return % | No |
| Order cancellation | count of SL/TP/limits cancelled | No |
| Entry node lookup | `_find_trade_entry()` success/fail, node_id | No |
| Edge creation | entry→close `part_of` edge, edge_id | No |
| Hebbian strengthening | edge strength +0.1 (background) | No |

### modify_position

| Step | Data Available | Currently Visible in Debug? |
|------|---------------|-----------------------------|
| Existing trigger fetch | old SL/TP values, count | No |
| Selective cancellation | which orders cancelled, old prices | No |
| New trigger placement | new SL/TP, success/fail per order | No |
| Leverage update | old→new leverage | No |

---

## Proposed Solutions

### Option A — Sub-Spans Within `tool_execution`

Break the single trade span into nested sub-spans. The timeline would render as:

```
▼ Tool: execute_trade (675ms)
  ├─ Validation (2ms) — R:R 2.0:1, confidence HIGH, portfolio risk 3.2%
  ├─ Leverage (85ms) — Set 10x on BTC
  ├─ Order Fill (510ms) — MARKET LONG 0.03 BTC @ $68,012 (slippage: 0.02%)
  ├─ Stop Loss (95ms) — $66,500 (2.2% from entry) [set]
  ├─ Take Profit (90ms) — $72,000 (5.9% from entry) [set]
  └─ Memory (5ms) — Node n_abc123 created, 2 thesis edges linked
```

**Pros:** Reuses existing debug infrastructure. One timeline, everything in context.
**Cons:** Requires adding `sub_spans` support to the trace data model + UI rendering.

### Option B — Dedicated Trade Trace Panel

A separate "Trades" section/page showing trade-specific telemetry: execution waterfall, fill quality, risk metrics, memory linkage. Each trade as its own inspectable entity.

**Pros:** Purpose-built for trade analysis. Can show aggregated metrics (avg slippage, execution speed trends, SL/TP hit rates).
**Cons:** More work. Separate from the general debug timeline.

### Option C — Both

Sub-spans in the debug timeline for the technical/debugging view, plus a dedicated trade log that aggregates trade-specific metrics over time.

**Pros:** Best of both worlds.
**Cons:** Most implementation work.

---

## Files That Would Be Modified

| File | Change |
|------|--------|
| `src/hynous/core/request_tracer.py` | New span type constant(s) for trade sub-spans |
| `src/hynous/intelligence/tools/trading.py` | Instrument each step with `record_span()` calls |
| `dashboard/dashboard/state.py` | Add label/color mapping for new span types, handle sub-span rendering |
| `dashboard/dashboard/pages/debug.py` | Render nested sub-spans (indented, collapsible) |

No changes needed to `trace_log.py` (storage is schema-agnostic — any dict works).
