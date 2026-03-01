# Trade Debug Interface — Implementation Guide

> Add sub-span instrumentation to all trade tool handlers so every internal step of `execute_trade`, `close_position`, and `modify_position` is visible in the debug dashboard. Currently these tools produce a single opaque `tool_execution` span — after this change, each internal step (validation, order fill, SL/TP placement, memory storage, etc.) gets its own span with timing, data, and success/failure status.

---

## Table of Contents

1. [Pre-Read Requirements](#1-pre-read-requirements)
2. [Architecture Overview](#2-architecture-overview)
3. [Chunk 1: Add `trade_step` Span Type](#chunk-1-add-trade_step-span-type)
4. [Chunk 2: Add Trade Span Helper to `trading.py`](#chunk-2-add-trade-span-helper)
5. [Chunk 3: Instrument `handle_execute_trade()`](#chunk-3-instrument-handle_execute_trade)
6. [Chunk 4: Instrument `handle_close_position()`](#chunk-4-instrument-handle_close_position)
7. [Chunk 5: Instrument `handle_modify_position()`](#chunk-5-instrument-handle_modify_position)
8. [Chunk 6: Update Dashboard State](#chunk-6-update-dashboard-state)
9. [Final Verification](#final-verification)

---

## 1. Pre-Read Requirements

**Before writing ANY code, read these files in full.** You must understand the existing patterns, data flow, and conventions. Failure to do so will produce inconsistent code.

### Required Reading — Debug Infrastructure (read first)

| # | File | Lines | Why |
|---|------|-------|-----|
| 1 | `src/hynous/core/request_tracer.py` | 288 | **The tracer singleton.** Understand: `SPAN_*` constants (lines 36-43), `record_span()` (line 90), thread-local context `get_active_trace()` / `set_active_trace()` (lines 280-287). Your trade spans will use `get_active_trace()` to get the trace_id and `get_tracer().record_span()` to record. |
| 2 | `src/hynous/core/trace_log.py` | 235 | **Persistence layer.** Understand `store_payload()` (line 196) for content-addressed storage. You will NOT modify this file — just understand it. |
| 3 | `dashboard/dashboard/pages/debug.py` | 456 | **The debug page UI.** Understand `_span_row()` (line 173) — this is how spans render. You will NOT modify this file — it already renders any span type via `debug_spans_display`. |
| 4 | `dashboard/dashboard/state.py` lines 447-453 | 7 | **Debug state vars.** Understand the debug state shape. |
| 5 | `dashboard/dashboard/state.py` lines 2450-2563 | 113 | **`debug_spans_display` computed var.** This is CRITICAL — it maps span types to labels, colors, and summaries. You WILL modify this to handle the new `trade_step` span type. Read the entire method, especially the `label_map` dict (line 2489), the summary building `if/elif` chain (line 2501-2528), and the payload hash resolution loop (line 2530-2545). |

### Required Reading — Trading Tools (read second)

| # | File | Lines | Why |
|---|------|-------|-----|
| 6 | `src/hynous/intelligence/tools/trading.py` | 1646 | **The main file to instrument.** Read the ENTIRE file. Key sections: `_check_trading_allowed()` (line 46), `handle_execute_trade()` (line 410), `_place_triggers()` (line 807), `_store_to_nous()` (line 855), `_find_trade_entry()` (line 932), `_store_trade_memory()` (line 958), `handle_close_position()` (line 1106), `handle_modify_position()` (line 1369), `_strengthen_trade_edge()` (line 1551). |
| 7 | `src/hynous/intelligence/agent.py` lines 373-492 | 120 | **`_execute_tools()` method.** Understand how the EXISTING `tool_execution` span is recorded (lines 398-406). Your trade_step spans will appear ALONGSIDE this span in the timeline — NOT nested inside it. The tool_execution span records AFTER the handler returns, so your trade_step spans (recorded DURING the handler) will appear BEFORE it chronologically. |

### Required Reading — Existing Instrumentation Pattern (read third)

| # | File | Lines | Why |
|---|------|-------|-----|
| 8 | `src/hynous/intelligence/tools/memory.py` lines 24-30, 391-396, 459-466, 549-559 | ~60 | **The pattern to follow.** This file already uses `get_active_trace()` + `get_tracer().record_span()` inside tool handlers. Every span recording is wrapped in `try/except Exception: pass`. Study how it imports from `...core.request_tracer` and records spans at key decision points (gate filter rejection, dedup rejection, successful store). |

### Required Reading — Context

| # | File | Why |
|---|------|-----|
| 9 | `revisions/trade-debug-interface/analysis.md` | The analysis document describing the problem, current trade flows, data available, and proposed solutions. This guide implements **Option A** (trade_step spans within the existing timeline). |
| 10 | `ARCHITECTURE.md` | System overview. Focus on the "Debug Trace Flow" section (line 209). |

**Total: 10 files. Read ALL before writing code.**

---

## 2. Architecture Overview

### How Trade Spans Will Work

```
agent.chat() starts trace
    │
    ├── [existing spans: context, retrieval, llm_call...]
    │
    ├── Agent decides to call execute_trade
    │     │
    │     ▼ agent.py _execute_tools() starts timing
    │     │
    │     ▼ handler: handle_execute_trade() runs
    │     │   ├── record_span(trade_step: circuit_breaker)
    │     │   ├── record_span(trade_step: validation)
    │     │   ├── record_span(trade_step: price_fetch)
    │     │   ├── record_span(trade_step: leverage_set)
    │     │   ├── record_span(trade_step: order_fill)
    │     │   ├── record_span(trade_step: stop_loss)
    │     │   ├── record_span(trade_step: take_profit)
    │     │   ├── record_span(trade_step: cache_invalidation)
    │     │   ├── record_span(trade_step: daemon_record)
    │     │   └── record_span(trade_step: memory_store)
    │     │
    │     ▼ agent.py _execute_tools() records tool_execution span
    │
    ├── [more spans if needed...]
    │
    ▼ agent.chat() ends trace
```

**Key design points:**

1. **Flat spans, not nested.** Trade step spans are siblings to the tool_execution span, not children. This avoids any data model changes to `request_tracer.py` or `trace_log.py`.

2. **Thread-local trace context.** The trading handlers don't receive a `trace_id` parameter. They use `get_active_trace()` (already set by `agent.py` in `chat()` and `chat_stream()`) to get the current trace ID. This is the same pattern used by `tools/memory.py`.

3. **Silent degradation.** Every `record_span()` call is wrapped in `try/except Exception: pass`. If tracing fails, the trade executes normally. Tracing must NEVER break trading.

4. **Human + AI readable.** Each span has a `detail` field with a human-readable one-liner AND structured data fields for programmatic parsing.

### Trade Step Span Schema

Every trade_step span follows this structure:

```python
{
    "type": "trade_step",           # Constant — identifies this as a trade sub-step
    "started_at": str,              # ISO timestamp
    "duration_ms": int,             # Wall clock time for this step
    "trade_tool": str,              # "execute_trade" | "close_position" | "modify_position"
    "step": str,                    # Step name (see below)
    "success": bool,                # Did this step succeed?
    "detail": str,                  # Human-readable one-liner summary
    # ... plus step-specific fields (symbol, price, fill data, etc.)
}
```

Step names by tool:

**execute_trade:** `circuit_breaker`, `validation`, `price_fetch`, `leverage_set`, `order_fill`, `stop_loss`, `take_profit`, `cache_invalidation`, `daemon_record`, `memory_store`

**close_position:** `position_lookup`, `order_fill`, `pnl_calculation`, `order_cancellation`, `cache_invalidation`, `entry_lookup`, `memory_store`

**modify_position:** `position_lookup`, `trigger_fetch`, `order_management`, `leverage_update`, `cache_invalidation`, `entry_lookup`, `memory_store`

---

## Critical Rules

These rules apply to EVERY chunk. Violating them will break the system.

1. **NEVER break trading.** Every `get_tracer()` and `get_active_trace()` call MUST be inside `try/except Exception: pass`. If tracing throws, the trade MUST continue normally. Trading is mission-critical — tracing is observability.

2. **Follow existing import style.** Look at how `tools/memory.py` imports: `from ...core.request_tracer import get_tracer, SPAN_MEMORY_OP`. Match this exactly.

3. **No new dependencies.** Only use stdlib + packages already in `pyproject.toml`.

4. **Timestamps.** Use `datetime.now(timezone.utc).isoformat()` for all span timestamps.

5. **Duration timing.** Use `time.monotonic()` for duration calculation (not `time.time()`).

6. **JSON serialization.** Only store plain Python types (str, int, float, bool, list, dict, None) in spans. No dataclass instances, no SDK objects.

7. **Keep spans lean.** Don't store entire order responses. Extract the fields that matter: price, size, status, oid. Truncate strings to reasonable lengths (200-500 chars).

8. **Existing code untouched.** Do NOT modify any existing logic in the trading handlers. Only INSERT span recording calls at appropriate points. The handlers must return the exact same results.

---

## Chunk 1: Add `trade_step` Span Type

### File: `src/hynous/core/request_tracer.py`

Add a new span type constant after the existing constants.

**Find this block (lines 36-43):**

```python
# ---- Span type constants (used by instrumented code) ----
SPAN_CONTEXT = "context"
SPAN_RETRIEVAL = "retrieval"
SPAN_LLM_CALL = "llm_call"
SPAN_TOOL_EXEC = "tool_execution"
SPAN_MEMORY_OP = "memory_op"
SPAN_COMPRESSION = "compression"
SPAN_QUEUE_FLUSH = "queue_flush"
```

**Replace with:**

```python
# ---- Span type constants (used by instrumented code) ----
SPAN_CONTEXT = "context"
SPAN_RETRIEVAL = "retrieval"
SPAN_LLM_CALL = "llm_call"
SPAN_TOOL_EXEC = "tool_execution"
SPAN_MEMORY_OP = "memory_op"
SPAN_COMPRESSION = "compression"
SPAN_QUEUE_FLUSH = "queue_flush"
SPAN_TRADE_STEP = "trade_step"
```

One line added. Nothing else in this file changes.

### Verification — Chunk 1

```bash
cd /path/to/Hynous
python -c "from hynous.core.request_tracer import SPAN_TRADE_STEP; print(f'OK: {SPAN_TRADE_STEP}')"
# Expected output: OK: trade_step
```

---

## Chunk 2: Add Trade Span Helper

### File: `src/hynous/intelligence/tools/trading.py`

Add imports and a helper function that wraps the trace recording pattern. This helper will be used by all three trade handlers.

**Step 2.1 — Add imports**

Find this block (lines 25-30):

```python
import json
import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)
```

Replace with:

```python
import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)
```

Two new imports added: `time` and `from datetime import datetime, timezone`.

**Step 2.2 — Add the helper function**

Insert this immediately after the `logger = logging.getLogger(__name__)` line (after line 30), BEFORE the `_get_trading_provider()` function:

```python


def _record_trade_span(
    trade_tool: str,
    step: str,
    success: bool,
    detail: str,
    duration_ms: int = 0,
    **extra,
) -> None:
    """Record a trade step span to the active debug trace.

    Silent no-op if no trace is active or if recording fails.
    Must NEVER raise — trading is more important than tracing.

    Args:
        trade_tool: Which trade tool is running ("execute_trade", "close_position", "modify_position").
        step: Step name (e.g. "circuit_breaker", "order_fill", "stop_loss").
        success: Whether this step succeeded.
        detail: Human-readable one-liner (also useful for AI agents parsing the trace).
        duration_ms: Wall clock time for this step (0 if instant/negligible).
        **extra: Additional step-specific fields merged into the span dict.
    """
    try:
        from ...core.request_tracer import get_tracer, get_active_trace, SPAN_TRADE_STEP
        trace_id = get_active_trace()
        if not trace_id:
            return
        span = {
            "type": SPAN_TRADE_STEP,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": duration_ms,
            "trade_tool": trade_tool,
            "step": step,
            "success": success,
            "detail": detail,
        }
        span.update(extra)
        get_tracer().record_span(trace_id, span)
    except Exception:
        pass
```

### Verification — Chunk 2

```bash
cd /path/to/Hynous
python -c "from hynous.intelligence.tools.trading import _record_trade_span; print('OK')"
# Expected: OK (no errors)
```

---

## Chunk 3: Instrument `handle_execute_trade()`

This is the largest chunk. We add span recording at each major step inside the execute_trade handler. Every insertion is ADDITIVE — no existing code is modified or moved.

The handle_execute_trade function spans lines 410-804. We instrument 10 steps.

**Step 3.1 — Circuit breaker check (after line 429)**

Find this block (lines 426-429):

```python
    # Check circuit breaker, duplicate position, and position limits
    blocked = _check_trading_allowed(is_new_entry=True, symbol=symbol)
    if blocked:
        return blocked
```

Replace with:

```python
    # Check circuit breaker, duplicate position, and position limits
    blocked = _check_trading_allowed(is_new_entry=True, symbol=symbol)
    if blocked:
        _record_trade_span("execute_trade", "circuit_breaker", False, f"Blocked: {blocked[:150]}", symbol=symbol)
        return blocked
    _record_trade_span("execute_trade", "circuit_breaker", True, f"Trading allowed for {symbol}", symbol=symbol)
```

**Step 3.2 — Validation summary (after line 638, before leverage set)**

After all the validation checks pass (R:R floor, leverage-SL coherence, portfolio risk cap) and before the leverage is set, insert a validation summary span. Find this exact block (lines 640-645):

```python
    # --- Set leverage if specified ---
    if leverage is not None:
        try:
            provider.update_leverage(symbol, leverage)
        except Exception as e:
            return f"Error setting leverage to {leverage}x: {e}"
```

Replace with:

```python
    # --- Validation summary span ---
    _record_trade_span(
        "execute_trade", "validation", True,
        f"{side.upper()} {symbol} | {leverage}x | R:R {pre_rr:.1f}:1 | "
        f"Confidence {confidence:.0%} ({tier}) | Portfolio risk {portfolio_risk_pct:.1f}%"
        if confidence is not None and 'pre_rr' in dir() and 'portfolio_risk_pct' in dir()
        else f"{side.upper()} {symbol} | {leverage}x | Confidence {confidence:.0%}" if confidence is not None
        else f"{side.upper()} {symbol} | {leverage}x",
        symbol=symbol, side=side, leverage=leverage,
        confidence=confidence, tier=tier,
        rr_ratio=pre_rr if 'pre_rr' in dir() else None,
        portfolio_risk_pct=portfolio_risk_pct if 'portfolio_risk_pct' in dir() else None,
        oversized=oversized,
        warnings=_warnings if _warnings else None,
    )

    # --- Set leverage if specified ---
    if leverage is not None:
        _lev_start = time.monotonic()
        try:
            provider.update_leverage(symbol, leverage)
        except Exception as e:
            _record_trade_span("execute_trade", "leverage_set", False, f"Failed to set {leverage}x on {symbol}: {e}", duration_ms=int((time.monotonic() - _lev_start) * 1000), symbol=symbol, leverage=leverage, error=str(e))
            return f"Error setting leverage to {leverage}x: {e}"
        _record_trade_span("execute_trade", "leverage_set", True, f"Set {leverage}x on {symbol}", duration_ms=int((time.monotonic() - _lev_start) * 1000), symbol=symbol, leverage=leverage)
```

**Step 3.3 — Order fill instrumentation**

For the **limit order** path, find this block (lines 648-658):

```python
    if order_type == "limit":
        try:
            result = provider.limit_open(
                symbol=symbol,
                is_buy=is_buy,
                limit_px=limit_price,
                size_usd=size_usd,
                sz=size,
            )
        except Exception as e:
            return f"Error placing limit order: {e}"
```

Replace with:

```python
    if order_type == "limit":
        _order_start = time.monotonic()
        try:
            result = provider.limit_open(
                symbol=symbol,
                is_buy=is_buy,
                limit_px=limit_price,
                size_usd=size_usd,
                sz=size,
            )
        except Exception as e:
            _record_trade_span("execute_trade", "order_fill", False, f"Limit order failed: {e}", duration_ms=int((time.monotonic() - _order_start) * 1000), symbol=symbol, side=side, order_type="limit", error=str(e))
            return f"Error placing limit order: {e}"
```

Then find the block where limit order resting status is handled (around line 664-705 — the `if is_resting:` block). After `is_resting = result["status"] == "resting"` (line 662), insert:

Find:

```python
        is_resting = result["status"] == "resting"

        if is_resting:
```

Replace with:

```python
        is_resting = result["status"] == "resting"
        _record_trade_span(
            "execute_trade", "order_fill", True,
            f"LIMIT {'resting' if is_resting else 'filled'} {side.upper()} {symbol} @ {_fmt_price(limit_price)}",
            duration_ms=int((time.monotonic() - _order_start) * 1000),
            symbol=symbol, side=side, order_type="limit",
            limit_price=limit_price, status=result.get("status"),
            oid=result.get("oid"), filled_sz=result.get("filled_sz", 0),
        )

        if is_resting:
```

For the **market order** path, find this block (lines 707-718):

```python
    else:
        # Market order
        slip = slippage or config.hyperliquid.default_slippage
        try:
            if size is not None:
                # Base-asset sizing: convert to USD for market_open
                effective_usd = size * price
                result = provider.market_open(symbol, is_buy, effective_usd, slip)
            else:
                result = provider.market_open(symbol, is_buy, size_usd, slip)
        except Exception as e:
            return f"Error executing market order: {e}"
```

Replace with:

```python
    else:
        # Market order
        slip = slippage or config.hyperliquid.default_slippage
        _order_start = time.monotonic()
        try:
            if size is not None:
                # Base-asset sizing: convert to USD for market_open
                effective_usd = size * price
                result = provider.market_open(symbol, is_buy, effective_usd, slip)
            else:
                result = provider.market_open(symbol, is_buy, size_usd, slip)
        except Exception as e:
            _record_trade_span("execute_trade", "order_fill", False, f"Market order failed: {e}", duration_ms=int((time.monotonic() - _order_start) * 1000), symbol=symbol, side=side, order_type="market", error=str(e))
            return f"Error executing market order: {e}"
```

Then after the fill validation (lines 720-727), find:

```python
    if not isinstance(result, dict):
        return f"Unexpected order response. Try again."

    fill_px = result.get("avg_px", price)
    fill_sz = result.get("filled_sz", 0)

    if result.get("status") != "filled" or fill_sz == 0:
        return f"Order not filled. Status: {result.get('status', 'unknown')}. Try again or adjust size."
```

Replace with:

```python
    if not isinstance(result, dict):
        _record_trade_span("execute_trade", "order_fill", False, "Unexpected order response", duration_ms=int((time.monotonic() - _order_start) * 1000), symbol=symbol, side=side, order_type="market")
        return f"Unexpected order response. Try again."

    fill_px = result.get("avg_px", price)
    fill_sz = result.get("filled_sz", 0)

    if result.get("status") != "filled" or fill_sz == 0:
        _record_trade_span("execute_trade", "order_fill", False, f"Not filled: {result.get('status', 'unknown')}", duration_ms=int((time.monotonic() - _order_start) * 1000), symbol=symbol, side=side, order_type="market", status=result.get("status"))
        return f"Order not filled. Status: {result.get('status', 'unknown')}. Try again or adjust size."

    # Calculate slippage vs reference price
    _slippage_pct = abs(fill_px - price) / price * 100 if price > 0 else 0
    _record_trade_span(
        "execute_trade", "order_fill", True,
        f"MARKET {side.upper()} {fill_sz:.6g} {symbol} @ {_fmt_price(fill_px)} (slippage: {_slippage_pct:.3f}%)",
        duration_ms=int((time.monotonic() - _order_start) * 1000),
        symbol=symbol, side=side, order_type="market",
        fill_px=fill_px, fill_sz=fill_sz, requested_price=price,
        slippage_pct=round(_slippage_pct, 4), status="filled",
    )
```

**Step 3.4 — Cache invalidation span (after line 736)**

Find this block (lines 729-736):

```python
    # Invalidate snapshot + briefing cache so next chat() gets fresh position data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass
```

Replace with:

```python
    # Invalidate snapshot + briefing cache so next chat() gets fresh position data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass
    _record_trade_span("execute_trade", "cache_invalidation", True, "Snapshot + briefing cache cleared")
```

**Step 3.5 — Daemon recording span (after line 783)**

Find this block (lines 773-783):

```python
    # --- Record entry for activity tracking + position type registry ---
    try:
        from ...intelligence.daemon import get_active_daemon
        daemon = get_active_daemon()
        if daemon:
            daemon.record_trade_entry()
            daemon.register_position_type(symbol, trade_type)
            if trade_type == "micro":
                daemon.record_micro_entry()
    except Exception:
        pass
```

Replace with:

```python
    # --- Record entry for activity tracking + position type registry ---
    try:
        from ...intelligence.daemon import get_active_daemon
        daemon = get_active_daemon()
        if daemon:
            daemon.record_trade_entry()
            daemon.register_position_type(symbol, trade_type)
            if trade_type == "micro":
                daemon.record_micro_entry()
            _record_trade_span("execute_trade", "daemon_record", True, f"Entry #{daemon.entries_today} recorded, type={trade_type}", trade_type=trade_type)
    except Exception:
        pass
```

**Step 3.6 — Memory store span**

Find this block (lines 796-803):

```python
    _store_trade_memory(
        side, symbol, _fmt_price(fill_px), fill_px,
        stop_loss, take_profit, confidence,
        effective_usd, fill_sz, rr_val, reasoning, lines,
        trade_type=trade_type,
    )

    lines.extend(_warnings)
```

Replace with:

```python
    _mem_start = time.monotonic()
    _mem_node_id = _store_trade_memory(
        side, symbol, _fmt_price(fill_px), fill_px,
        stop_loss, take_profit, confidence,
        effective_usd, fill_sz, rr_val, reasoning, lines,
        trade_type=trade_type,
    )
    _record_trade_span(
        "execute_trade", "memory_store",
        _mem_node_id is not None,
        f"Node {_mem_node_id} created" if _mem_node_id else "Memory store failed",
        duration_ms=int((time.monotonic() - _mem_start) * 1000),
        node_id=_mem_node_id, subtype="custom:trade_entry",
    )

    lines.extend(_warnings)
```

Note: `_store_trade_memory` already returns `node_id` or `None` — we just capture the return value.

### Verification — Chunk 3

1. **Syntax check**: `python -c "from hynous.intelligence.tools.trading import handle_execute_trade; print('OK')"`
2. **No behavior change**: The function still returns the exact same strings. All span recording is wrapped in the helper's try/except.
3. **Count spans**: The execute_trade handler should now have span recording for: circuit_breaker, validation, leverage_set, order_fill, cache_invalidation, daemon_record, memory_store (7 spans minimum per successful market trade).

---

## Chunk 4: Instrument `handle_close_position()`

The close handler spans lines 1106-1312.

**Step 4.1 — Position lookup span (after line 1134)**

Find this block (lines 1121-1134):

```python
    # --- Get current position ---
    try:
        state = provider.get_user_state()
    except Exception as e:
        return f"Error fetching account state: {e}"

    position = None
    for p in state["positions"]:
        if p["coin"] == symbol:
            position = p
            break

    if not position:
        return f"No open position for {symbol}."
```

Replace with:

```python
    # --- Get current position ---
    _pos_start = time.monotonic()
    try:
        state = provider.get_user_state()
    except Exception as e:
        _record_trade_span("close_position", "position_lookup", False, f"Failed to fetch state: {e}", duration_ms=int((time.monotonic() - _pos_start) * 1000), symbol=symbol, error=str(e))
        return f"Error fetching account state: {e}"

    position = None
    for p in state["positions"]:
        if p["coin"] == symbol:
            position = p
            break

    if not position:
        _record_trade_span("close_position", "position_lookup", False, f"No open position for {symbol}", duration_ms=int((time.monotonic() - _pos_start) * 1000), symbol=symbol)
        return f"No open position for {symbol}."

    _record_trade_span(
        "close_position", "position_lookup", True,
        f"Found {position['side'].upper()} {symbol} | Entry: {_fmt_price(position.get('entry_px', 0))} | Size: {position['size']:.6g}",
        duration_ms=int((time.monotonic() - _pos_start) * 1000),
        symbol=symbol, side=position["side"],
        entry_px=position.get("entry_px", 0), size=position["size"],
    )
```

**Step 4.2 — Order fill span (market close path)**

Find this block (lines 1177-1188):

```python
    else:
        # Market close
        slip = config.hyperliquid.default_slippage
        try:
            result = provider.market_close(symbol, size=close_size, slippage=slip)
        except Exception as e:
            return f"Error closing position: {e}"

        if not isinstance(result, dict):
            return "Unexpected close response. Try again."
        exit_px = result.get("avg_px", 0)
        closed_sz = result.get("filled_sz", close_size or full_size)
```

Replace with:

```python
    else:
        # Market close
        slip = config.hyperliquid.default_slippage
        _close_start = time.monotonic()
        try:
            result = provider.market_close(symbol, size=close_size, slippage=slip)
        except Exception as e:
            _record_trade_span("close_position", "order_fill", False, f"Close failed: {e}", duration_ms=int((time.monotonic() - _close_start) * 1000), symbol=symbol, error=str(e))
            return f"Error closing position: {e}"

        if not isinstance(result, dict):
            _record_trade_span("close_position", "order_fill", False, "Unexpected response", duration_ms=int((time.monotonic() - _close_start) * 1000), symbol=symbol)
            return "Unexpected close response. Try again."
        exit_px = result.get("avg_px", 0)
        closed_sz = result.get("filled_sz", close_size or full_size)
        _record_trade_span(
            "close_position", "order_fill", True,
            f"Closed {closed_sz:.6g} {symbol} @ {_fmt_price(exit_px)}",
            duration_ms=int((time.monotonic() - _close_start) * 1000),
            symbol=symbol, exit_px=exit_px, closed_sz=closed_sz,
        )
```

**Step 4.3 — PnL calculation span (after line 1216)**

Find this block (lines 1199-1216):

```python
    # --- Calculate realized PnL ---
    entry_px = position.get("entry_px", 0)
    if is_long:
        pnl_per_unit = exit_px - entry_px
    else:
        pnl_per_unit = entry_px - exit_px
    realized_pnl = pnl_per_unit * closed_sz
    # Fee estimate (taker 0.035% per side)
    fee_estimate = closed_sz * exit_px * 0.00035
    realized_pnl_net = realized_pnl - fee_estimate
    pnl_pct = (pnl_per_unit / entry_px * 100) if entry_px > 0 else 0
    # Leveraged return on margin for consistency with position display
    margin_used = position.get("margin_used", 0)
    if margin_used > 0 and partial_pct < 100:
        lev_return = realized_pnl_net / (margin_used * partial_pct / 100) * 100
    elif margin_used > 0:
        lev_return = realized_pnl_net / margin_used * 100
    else:
        lev_return = pnl_pct
```

Insert AFTER this block (after the `lev_return = pnl_pct` line):

```python

    _record_trade_span(
        "close_position", "pnl_calculation", True,
        f"PnL: {'+'if realized_pnl_net >= 0 else ''}{_fmt_price(realized_pnl_net)} "
        f"({lev_return:+.1f}% on margin, {_fmt_pct(pnl_pct)} price)",
        entry_px=entry_px, exit_px=exit_px,
        pnl_gross=round(realized_pnl, 2), fee_estimate=round(fee_estimate, 2),
        pnl_net=round(realized_pnl_net, 2), pnl_pct=round(pnl_pct, 2),
        lev_return_pct=round(lev_return, 2),
    )
```

**Step 4.4 — Order cancellation span (after line 1229)**

Find this block (lines 1218-1229):

```python
    # --- Cancel associated orders on full close ---
    cancelled = 0
    if partial_pct >= 100:
        try:
            # Cancel trigger orders (SL/TP) — cancel_all_orders only handles limits
            triggers = provider.get_trigger_orders(symbol)
            for t in triggers:
                if t.get("oid"):
                    provider.cancel_order(symbol, t["oid"])
                    cancelled += 1
            # Cancel resting limit orders
            cancelled += provider.cancel_all_orders(symbol)
        except Exception as e:
            logger.error("Failed to cancel orders for %s: %s", symbol, e)
```

Replace with:

```python
    # --- Cancel associated orders on full close ---
    cancelled = 0
    if partial_pct >= 100:
        _cancel_start = time.monotonic()
        try:
            # Cancel trigger orders (SL/TP) — cancel_all_orders only handles limits
            triggers = provider.get_trigger_orders(symbol)
            for t in triggers:
                if t.get("oid"):
                    provider.cancel_order(symbol, t["oid"])
                    cancelled += 1
            # Cancel resting limit orders
            cancelled += provider.cancel_all_orders(symbol)
            _record_trade_span("close_position", "order_cancellation", True, f"Cancelled {cancelled} order(s)", duration_ms=int((time.monotonic() - _cancel_start) * 1000), symbol=symbol, count=cancelled)
        except Exception as e:
            logger.error("Failed to cancel orders for %s: %s", symbol, e)
            _record_trade_span("close_position", "order_cancellation", False, f"Cancel failed: {e}", duration_ms=int((time.monotonic() - _cancel_start) * 1000), symbol=symbol, error=str(e))
```

**Step 4.5 — Cache invalidation span (after existing cache block ~line 1197)**

Find this block (lines 1190-1197):

```python
    # Invalidate snapshot + briefing cache so next chat() gets fresh position data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass
```

Replace with:

```python
    # Invalidate snapshot + briefing cache so next chat() gets fresh position data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass
    _record_trade_span("close_position", "cache_invalidation", True, "Snapshot + briefing cache cleared")
```

**Step 4.6 — Entry lookup + memory store spans**

Find this block (lines 1231-1276):

```python
    # Find the entry node to link this close back to it (builds trade lifecycle graph)
    entry_node_id = _find_trade_entry(symbol)
```

Replace with:

```python
    # Find the entry node to link this close back to it (builds trade lifecycle graph)
    _entry_start = time.monotonic()
    entry_node_id = _find_trade_entry(symbol)
    _record_trade_span(
        "close_position", "entry_lookup",
        entry_node_id is not None,
        f"Found entry node {entry_node_id}" if entry_node_id else f"No entry node found for {symbol}",
        duration_ms=int((time.monotonic() - _entry_start) * 1000),
        symbol=symbol, entry_node_id=entry_node_id,
    )
```

Then find the `_store_to_nous` call for the close (around line 1258-1276):

```python
    close_node_id = _store_to_nous(
        subtype="custom:trade_close",
```

Wrap it with timing:

```python
    _mem_start = time.monotonic()
    close_node_id = _store_to_nous(
        subtype="custom:trade_close",
```

Then find the line right after the Hebbian strengthening call (around line 1279):

```python
    if close_node_id and entry_node_id:
        _strengthen_trade_edge(entry_node_id, close_node_id)
```

Insert AFTER this block:

```python

    _record_trade_span(
        "close_position", "memory_store",
        close_node_id is not None,
        f"Node {close_node_id} created, linked to entry {entry_node_id}" if close_node_id and entry_node_id
        else f"Node {close_node_id} created (no entry link)" if close_node_id
        else "Memory store failed",
        duration_ms=int((time.monotonic() - _mem_start) * 1000),
        node_id=close_node_id, entry_node_id=entry_node_id,
        subtype="custom:trade_close", edge_strengthened=bool(close_node_id and entry_node_id),
    )
```

### Verification — Chunk 4

1. **Syntax check**: `python -c "from hynous.intelligence.tools.trading import handle_close_position; print('OK')"`
2. **Span count**: A successful full market close should produce: position_lookup, order_fill, pnl_calculation, order_cancellation, cache_invalidation, entry_lookup, memory_store (7 spans).

---

## Chunk 5: Instrument `handle_modify_position()`

The modify handler spans lines 1369-1577. It follows the same pattern.

**Step 5.1 — Position lookup span**

Find this block (lines 1389-1402):

```python
    # --- Get current position ---
    try:
        state = provider.get_user_state()
    except Exception as e:
        return f"Error fetching account state: {e}"

    position = None
    for p in state["positions"]:
        if p["coin"] == symbol:
            position = p
            break

    if not position:
        return f"No open position for {symbol}."
```

Replace with:

```python
    # --- Get current position ---
    _pos_start = time.monotonic()
    try:
        state = provider.get_user_state()
    except Exception as e:
        _record_trade_span("modify_position", "position_lookup", False, f"Failed to fetch state: {e}", duration_ms=int((time.monotonic() - _pos_start) * 1000), symbol=symbol, error=str(e))
        return f"Error fetching account state: {e}"

    position = None
    for p in state["positions"]:
        if p["coin"] == symbol:
            position = p
            break

    if not position:
        _record_trade_span("modify_position", "position_lookup", False, f"No open position for {symbol}", duration_ms=int((time.monotonic() - _pos_start) * 1000), symbol=symbol)
        return f"No open position for {symbol}."

    _record_trade_span(
        "modify_position", "position_lookup", True,
        f"Found {position['side'].upper()} {symbol} | Mark: {_fmt_price(position.get('mark_px', 0))} | Size: {position.get('size', 0):.6g}",
        duration_ms=int((time.monotonic() - _pos_start) * 1000),
        symbol=symbol, side=position.get("side"), mark_px=position.get("mark_px", 0), size=position.get("size", 0),
    )
```

**Step 5.2 — Order management span (after all order operations)**

After all the cancel/place operations complete (the SL, TP, and leverage blocks all append to `changes`), find the cache invalidation block (lines 1495-1501):

```python
    # Invalidate snapshot + briefing cache so next chat() gets fresh data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass
```

Insert BEFORE this block:

```python
    # Record order management span summarizing all changes
    _record_trade_span(
        "modify_position", "order_management",
        bool(changes),
        "; ".join(changes) if changes else "No changes applied",
        symbol=symbol,
        new_stop=stop_loss, new_target=take_profit, new_leverage=leverage,
        cancel_all=cancel_orders,
    )

```

Then replace the cache block:

```python
    # Invalidate snapshot + briefing cache so next chat() gets fresh data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass
    _record_trade_span("modify_position", "cache_invalidation", True, "Snapshot + briefing cache cleared")
```

**Step 5.3 — Entry lookup + memory store spans**

Find this block (lines 1503-1532):

```python
    # --- Store modification in memory (always — every adjustment is documented) ---
    # Find the entry node to link this modification back to it
    entry_node_id = _find_trade_entry(symbol)
```

Replace with:

```python
    # --- Store modification in memory (always — every adjustment is documented) ---
    # Find the entry node to link this modification back to it
    _entry_start = time.monotonic()
    entry_node_id = _find_trade_entry(symbol)
    _record_trade_span(
        "modify_position", "entry_lookup",
        entry_node_id is not None,
        f"Found entry node {entry_node_id}" if entry_node_id else f"No entry node found for {symbol}",
        duration_ms=int((time.monotonic() - _entry_start) * 1000),
        symbol=symbol, entry_node_id=entry_node_id,
    )
```

Then find the `_store_to_nous` call (line 1525):

```python
    mem_id = _store_to_nous(
```

Replace with:

```python
    _mem_start = time.monotonic()
    mem_id = _store_to_nous(
```

Then find this block (lines 1534-1543):

```python
    # --- Build result ---
    lines = [
```

Insert BEFORE it:

```python
    _record_trade_span(
        "modify_position", "memory_store",
        mem_id is not None,
        f"Node {mem_id} created, linked to entry {entry_node_id}" if mem_id and entry_node_id
        else f"Node {mem_id} created (no entry link)" if mem_id
        else "Memory store failed",
        duration_ms=int((time.monotonic() - _mem_start) * 1000),
        node_id=mem_id, entry_node_id=entry_node_id,
        subtype="custom:trade_modify",
    )

```

### Verification — Chunk 5

1. **Syntax check**: `python -c "from hynous.intelligence.tools.trading import handle_modify_position; print('OK')"`
2. **Span count**: A successful modify should produce: position_lookup, order_management, cache_invalidation, entry_lookup, memory_store (5 spans).

---

## Chunk 6: Update Dashboard State

### File: `dashboard/dashboard/state.py`

Update the `debug_spans_display` computed var to handle the new `trade_step` span type with proper label, color, and summary.

**Step 6.1 — Add trade_step to the label_map**

Find this block inside `debug_spans_display()` (lines 2489-2497):

```python
            label_map = {
                "context": ("Context", "#818cf8"),
                "retrieval": ("Retrieval", "#34d399"),
                "llm_call": ("LLM Call", "#f59e0b"),
                "tool_execution": ("Tool", "#60a5fa"),
                "memory_op": ("Memory", "#a78bfa"),
                "compression": ("Compress", "#fb923c"),
                "queue_flush": ("Queue", "#94a3b8"),
            }
```

Replace with:

```python
            label_map = {
                "context": ("Context", "#818cf8"),
                "retrieval": ("Retrieval", "#34d399"),
                "llm_call": ("LLM Call", "#f59e0b"),
                "tool_execution": ("Tool", "#60a5fa"),
                "memory_op": ("Memory", "#a78bfa"),
                "compression": ("Compress", "#fb923c"),
                "queue_flush": ("Queue", "#94a3b8"),
                "trade_step": ("Trade", "#f472b6"),
            }
```

The color `#f472b6` is pink — distinct from all existing span colors (indigo, teal, amber, blue, purple, orange, slate).

**Step 6.2 — Add trade_step summary generation**

Find this block (lines 2525-2528):

```python
            elif span_type == "queue_flush":
                summary = f"{span.get('items_count', 0)} items"
            else:
                summary = ""
```

Replace with:

```python
            elif span_type == "queue_flush":
                summary = f"{span.get('items_count', 0)} items"
            elif span_type == "trade_step":
                _step = span.get("step", "")
                _tool = span.get("trade_tool", "")
                _detail = span.get("detail", "")
                _ok = span.get("success", True)
                summary = f"{'[FAIL] ' if not _ok else ''}{_step}: {_detail}" if _detail else _step
            else:
                summary = ""
```

### Verification — Chunk 6

```bash
cd /path/to/Hynous/dashboard
python -c "
from dashboard.state import AppState
# Verify the computed var can handle trade_step spans
state = AppState()
state.debug_selected_trace = {
    'spans': [{
        'type': 'trade_step',
        'started_at': '2026-01-01T00:00:00Z',
        'duration_ms': 85,
        'trade_tool': 'execute_trade',
        'step': 'leverage_set',
        'success': True,
        'detail': 'Set 20x on BTC',
        'symbol': 'BTC',
        'leverage': 20,
    }]
}
result = state.debug_spans_display
assert len(result) == 1
assert result[0]['label'] == 'Trade'
assert result[0]['color'] == '#f472b6'
assert 'leverage_set' in result[0]['summary']
print('Dashboard state OK')
"
```

---

## Final Verification

After completing ALL chunks, run these checks in order:

### 1. Import Chain (no errors)

```bash
cd /path/to/Hynous
python -c "
from hynous.core.request_tracer import get_tracer, SPAN_TRADE_STEP, get_active_trace, set_active_trace
from hynous.intelligence.tools.trading import handle_execute_trade, handle_close_position, handle_modify_position, _record_trade_span
print('All imports OK')
"
```

### 2. Tracer Round-Trip with Trade Spans

```bash
cd /path/to/Hynous
python -c "
from hynous.core.request_tracer import get_tracer, set_active_trace, SPAN_TRADE_STEP

t = get_tracer()
tid = t.begin_trace('test_trade_debug', 'Testing trade span recording')
set_active_trace(tid)

# Simulate trade spans as they'd be recorded by the handler
from hynous.intelligence.tools.trading import _record_trade_span

_record_trade_span('execute_trade', 'circuit_breaker', True, 'Trading allowed for BTC', symbol='BTC')
_record_trade_span('execute_trade', 'validation', True, 'LONG BTC | 20x | R:R 2.0:1 | Confidence 85% (High)', symbol='BTC', side='long', leverage=20, confidence=0.85)
_record_trade_span('execute_trade', 'leverage_set', True, 'Set 20x on BTC', duration_ms=85, symbol='BTC', leverage=20)
_record_trade_span('execute_trade', 'order_fill', True, 'MARKET LONG 0.03 BTC @ \$68,012 (slippage: 0.020%)', duration_ms=510, symbol='BTC', side='long', fill_px=68012, fill_sz=0.03, slippage_pct=0.02)
_record_trade_span('execute_trade', 'stop_loss', True, 'SL set at \$66,500 (2.2% from entry)', duration_ms=95, symbol='BTC', price=66500)
_record_trade_span('execute_trade', 'take_profit', True, 'TP set at \$72,000 (5.9% from entry)', duration_ms=90, symbol='BTC', price=72000)
_record_trade_span('execute_trade', 'memory_store', True, 'Node n_abc123 created', duration_ms=5, node_id='n_abc123')

set_active_trace(None)
t.end_trace(tid, 'completed', 'Trade spans test')

# Verify
full = t.get_trace(tid)
assert full is not None, 'Trace not found'
trade_spans = [s for s in full['spans'] if s['type'] == 'trade_step']
assert len(trade_spans) == 7, f'Expected 7 trade spans, got {len(trade_spans)}'

# Verify each span has required fields
for s in trade_spans:
    assert 'trade_tool' in s, f'Missing trade_tool in {s[\"step\"]}'
    assert 'step' in s, 'Missing step field'
    assert 'success' in s, f'Missing success in {s[\"step\"]}'
    assert 'detail' in s, f'Missing detail in {s[\"step\"]}'

print(f'Trade span round-trip OK — {len(trade_spans)} spans recorded')
for s in trade_spans:
    ok = 'OK' if s['success'] else 'FAIL'
    print(f'  [{ok}] {s[\"step\"]:20s} {s[\"duration_ms\"]:>5d}ms  {s[\"detail\"]}')
"
```

Expected output:

```
Trade span round-trip OK — 7 spans recorded
  [OK] circuit_breaker           0ms  Trading allowed for BTC
  [OK] validation                0ms  LONG BTC | 20x | R:R 2.0:1 | Confidence 85% (High)
  [OK] leverage_set             85ms  Set 20x on BTC
  [OK] order_fill              510ms  MARKET LONG 0.03 BTC @ $68,012 (slippage: 0.020%)
  [OK] stop_loss                95ms  SL set at $66,500 (2.2% from entry)
  [OK] take_profit              90ms  TP set at $72,000 (5.9% from entry)
  [OK] memory_store              5ms  Node n_abc123 created
```

### 3. Dashboard Integration Check

```bash
cd /path/to/Hynous/dashboard
python -c "
from dashboard.state import AppState
from dashboard.pages.debug import debug_page
from dashboard.dashboard import app
print('Dashboard integration OK')
"
```

### 4. Full System Smoke Test (requires running Nous + API keys)

```bash
cd /path/to/Hynous
python -c "
import os
if not os.getenv('OPENROUTER_API_KEY'):
    print('SKIPPED — no OPENROUTER_API_KEY')
else:
    from hynous.intelligence.agent import Agent
    from hynous.core.request_tracer import get_tracer

    agent = Agent()
    # Use get_account (read-only) to trigger a tool call with tracing
    response = agent.chat('Check my account balance', source='test_trade_debug')

    traces = get_tracer().get_recent_traces(limit=5)
    test_traces = [t for t in traces if t['source'] == 'test_trade_debug']
    assert len(test_traces) >= 1, 'No trace created'
    print(f'Smoke test OK — trace {test_traces[0][\"trace_id\"][:8]}... with {test_traces[0][\"span_count\"]} spans')
"
```

### 5. Existing Test Suite

Run the full test suite to confirm zero regressions:

```bash
cd /path/to/Hynous
python -m pytest tests/ -v --tb=short
```

All existing tests must pass. The trade span instrumentation is purely additive — no existing behavior is changed.

---

## Summary: Files Modified

| File | Change | Lines Added |
|------|--------|-------------|
| `src/hynous/core/request_tracer.py` | Add `SPAN_TRADE_STEP` constant | +1 |
| `src/hynous/intelligence/tools/trading.py` | Add imports, helper function, instrument 3 handlers | ~120 |
| `dashboard/dashboard/state.py` | Add trade_step to label_map + summary chain | ~8 |

**Total: 3 files modified, ~130 lines added, 0 lines removed.**

No new files created. No new dependencies. No changes to `trace_log.py`, `debug.py`, `agent.py`, or any other file.

### What the Debug Timeline Looks Like After This Change

```
▼ TRADE  circuit_breaker      0ms   Trading allowed for BTC
▼ TRADE  validation           0ms   LONG BTC | 20x | R:R 2.0:1 | Confidence 85% (High) | Risk 3.2%
▼ TRADE  leverage_set        85ms   Set 20x on BTC
▼ TRADE  order_fill         510ms   MARKET LONG 0.03 BTC @ $68,012 (slippage: 0.020%)
▼ TRADE  stop_loss           95ms   SL set at $66,500 (2.2% from entry)
▼ TRADE  take_profit         90ms   TP set at $72,000 (5.9% from entry)
▼ TRADE  cache_invalidation   0ms   Snapshot + briefing cache cleared
▼ TRADE  daemon_record        0ms   Entry #3 recorded, type=macro
▼ TRADE  memory_store         5ms   Node n_abc123 created
▼ TOOL   execute_trade      675ms   {"symbol": "BTC", "side": "long", ...}
```

Each TRADE span is expandable. Clicking reveals the full JSON detail with all structured fields — readable by both humans and AI agents.
