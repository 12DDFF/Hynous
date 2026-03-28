# Agent Exit Lockout — Full Implementation Guide

> **Date:** 2026-03-27
> **Status:** Ready for implementation
> **Depends on:** Feature trimming (complete), WS migration Phase 1 (complete), mechanical exits (complete)
> **Estimated scope:** ~150 lines changed across 6 files, ~100 lines new tests

---

## Pre-Requisite Reading

The engineer MUST read and understand these files before starting:

| File | What to understand |
|------|-------------------|
| `docs/revisions/agent-exit-lockout/report.md` | Problem statement, data, edge cases |
| `src/hynous/intelligence/tools/trading.py` lines 1556-1620 | `handle_close_position()` — current trailing lockout |
| `src/hynous/intelligence/tools/trading.py` lines 1965-2140 | `handle_modify_position()` — SL widening guard, TP handling, cancel_orders |
| `src/hynous/intelligence/daemon.py` lines 3690-3770 | `_wake_for_profit()` — all tier messages |
| `src/hynous/intelligence/daemon.py` lines 5508-5512 | Position block injection |
| `src/hynous/intelligence/scanner.py` lines 1846-1863 | Peak fade + adverse book footers |
| `src/hynous/intelligence/wake_warnings.py` lines 263-284 | Profit-at-risk warnings |
| `src/hynous/intelligence/prompts/builder.py` lines 155-179 | System prompt EXIT LOCKOUT section |
| `src/hynous/core/request_tracer.py` lines 264-288 | `get_tracer()`, `get_active_trace()` |
| `src/hynous/core/trading_settings.py` lines 98-124 | TradingSettings dataclass structure |
| `CLAUDE.md` | Project conventions, especially tool registration and testing patterns |

---

## Overview

Nine changes, executed in order. Each change is self-contained — run tests after each one.

```
Change 1: Add config flag to TradingSettings
Change 2: Block close_position from daemon wakes
Change 3: Add TP widening guard in modify_position
Change 4: Block cancel_orders + TP widening from daemon wakes in modify_position
Change 5: Rewrite profit wake messages (remove close pressure)
Change 6: Rewrite scanner wake footers (remove close pressure)
Change 7: Rewrite position block footer (remove close pressure)
Change 8: Rewrite wake_warnings profit-at-risk (remove close pressure)
Change 9: Update system prompt EXIT LOCKOUT section
```

After all changes: write tests, run full suite, verify.

---

## Change 1: Add config flag to TradingSettings

**File:** `src/hynous/core/trading_settings.py`

**What:** Add a single boolean field `autonomous_close_lockout` so this behavior can be toggled from the Settings dashboard page without a code deploy.

**Location:** After the trailing stop section (after line 124, the `trail_min_distance_above_fee_be` field).

**Add:**
```python
    # --- Autonomous Close Lockout ---
    # When True, the agent cannot call close_position or cancel_orders during
    # daemon wakes. Only user-initiated closes (chat, Discord) are allowed.
    # Mechanical exits (trailing stop, dynamic SL, fee-BE, small wins) are unaffected.
    autonomous_close_lockout: bool = True
```

**Also add to `config/default.yaml`** in the daemon section, after the trailing stop settings:

```yaml
  # Agent cannot close positions during autonomous daemon wakes.
  # User-initiated closes (chat, Discord) always allowed.
  autonomous_close_lockout: true
```

**Verify:** `PYTHONPATH=src .venv/bin/python -c "from hynous.core.trading_settings import get_trading_settings; ts = get_trading_settings(); print(ts.autonomous_close_lockout)"`  — should print `True`.

---

## Change 2: Block close_position from daemon wakes

**File:** `src/hynous/intelligence/tools/trading.py`

**What:** Add a source check at the top of `handle_close_position()`, before the trailing lockout check. If the current chat originated from a daemon wake (`source.startswith("daemon:")`), block the close.

**Location:** Insert BETWEEN the position lookup (ends ~line 1596) and the trailing lockout check (starts ~line 1598). The new block goes right before the `# --- Trailing stop lockout` comment.

**Insert this block:**
```python
    # --- Autonomous close lockout: agent cannot close from daemon wakes ---
    # Mechanical exits (trailing stop, dynamic SL, fee-BE) handle all exits.
    # Only user-initiated closes (chat, Discord) are allowed through.
    try:
        from ...core.trading_settings import get_trading_settings
        _ts = get_trading_settings()
        if _ts.autonomous_close_lockout:
            from ...core.request_tracer import get_active_trace, get_tracer
            _trace_id = get_active_trace()
            if _trace_id:
                _trace = get_tracer()._active.get(_trace_id)
                if _trace and _trace.get("source", "").startswith("daemon:"):
                    _record_trade_span(
                        "close_position", "autonomous_lockout", False,
                        f"BLOCKED: autonomous close not allowed (source={_trace['source']})",
                    )
                    return (
                        f"BLOCKED: You cannot close {symbol} during autonomous operation. "
                        f"The mechanical exit system (dynamic SL / fee-BE / trailing stop) "
                        f"manages all exits. Only the user can close positions manually via chat. "
                        f"Focus on entries — exits are mechanical."
                    )
    except Exception:
        pass  # If tracing unavailable, allow the close (safety fallback)
```

**Key design decisions:**
- Uses the existing `get_active_trace()` infrastructure (already imported at line 57)
- Accesses `get_tracer()._active` dict to read the trace's `source` field
- All 11 daemon wake sources use `"daemon:*"` prefix — the `startswith("daemon:")` check catches all of them
- User chat defaults to `"user_chat"`, Discord also defaults to `"user_chat"` — both pass through
- If tracer is unavailable or trace not found, the close is allowed (safety fallback)
- The `autonomous_close_lockout` flag from TradingSettings gates the entire check — can be disabled from dashboard Settings page
- The `_record_trade_span` call logs the block for debugging in the trace timeline

**Do NOT remove the trailing lockout check below it.** Both guards should exist — the trailing lockout remains as a second layer for when autonomous_close_lockout is disabled.

---

## Change 3: Add TP widening guard in modify_position

**File:** `src/hynous/intelligence/tools/trading.py`

**What:** Mirror the existing SL widening guard (lines 2046-2066) for take profit orders. The agent can only tighten TPs (move closer to current price), never widen them.

**Location:** After the TP directional validation block (ends at line 2037) and before the `# --- Fetch existing trigger orders` comment (line 2039). Insert the new guard block between them.

**Insert this block:**
```python
    # --- Mechanical TP lockout: LLM can only TIGHTEN take profits, never widen ---
    # Mirrors the SL widening guard. Prevents the agent from defeating its own TP
    # by moving it out of reach. TP can only move closer to current price.
    # Note: existing_triggers are fetched below, so we do a quick fetch here for TP check.
    if take_profit is not None:
        _tp_triggers = []
        try:
            _tp_triggers = provider.get_trigger_orders(symbol)
        except Exception:
            pass
        for t in _tp_triggers:
            if t.get("order_type") == "take_profit":
                existing_tp = t.get("trigger_px")
                if existing_tp is not None:
                    if is_long and take_profit > existing_tp:
                        return (
                            f"BLOCKED: Cannot widen take profit from ${existing_tp:,.2f} to ${take_profit:,.2f}. "
                            f"Take profits can only be TIGHTENED (moved closer to current price). "
                            f"Your TP must be <= ${existing_tp:,.2f} for this long."
                        )
                    if not is_long and take_profit < existing_tp:
                        return (
                            f"BLOCKED: Cannot widen take profit from ${existing_tp:,.2f} to ${take_profit:,.2f}. "
                            f"Take profits can only be TIGHTENED (moved closer to current price). "
                            f"Your TP must be >= ${existing_tp:,.2f} for this short."
                        )
                break
```

**Important:** This fetches trigger orders a second time (the main fetch is at line 2040-2045). This is intentional — the TP guard must run before the cancel flow at line 2070. The cost is one extra API call (~50ms) only when `take_profit` is provided. If this is a concern, refactor both guards to share a single fetch, but keep the guard placement before the cancel flow.

---

## Change 4: Block cancel_orders and TP widening from daemon wakes

**File:** `src/hynous/intelligence/tools/trading.py`

**What:** During daemon wakes, block `cancel_orders=true` (which nukes TP and SL) and TP modifications. SL tightening remains allowed (it reinforces the mechanical system).

**Location:** Inside `handle_modify_position()`, insert after the parameter validation block (after the TP directional check at line 2037) and before the TP widening guard from Change 3.

**Insert this block:**
```python
    # --- Autonomous modify lockout: restrict destructive modifications from daemon wakes ---
    # During daemon wakes: block cancel_orders (nukes SL+TP) and TP changes.
    # SL tightening remains allowed (reinforces mechanical exits).
    try:
        from ...core.trading_settings import get_trading_settings as _gts
        _ts_mod = _gts()
        if _ts_mod.autonomous_close_lockout:
            from ...core.request_tracer import get_active_trace as _gat, get_tracer as _gt
            _tid = _gat()
            if _tid:
                _tr = _gt()._active.get(_tid)
                if _tr and _tr.get("source", "").startswith("daemon:"):
                    if cancel_orders:
                        return (
                            f"BLOCKED: Cannot cancel orders for {symbol} during autonomous operation. "
                            f"Mechanical stops must remain in place. Only the user can cancel orders via chat."
                        )
                    if take_profit is not None:
                        return (
                            f"BLOCKED: Cannot modify take profit for {symbol} during autonomous operation. "
                            f"Only the user can adjust take profits via chat."
                        )
    except Exception:
        pass
```

**Design notes:**
- `cancel_orders=true` is blocked entirely from daemon wakes — it would remove the mechanical SL
- TP modification is blocked from daemon wakes — TP is set at entry and should not be moved autonomously
- SL tightening from daemon wakes is NOT blocked — if the agent wants to tighten its stop during a wake, that's a defensive action consistent with the mechanical system
- SL widening is already blocked universally by the existing guard (lines 2046-2066)

---

## Change 5: Rewrite profit wake messages

**File:** `src/hynous/intelligence/daemon.py`

**What:** Replace all "CLOSE", "close it", "Take profit", "take what's left" language with observational messages that acknowledge the mechanical exit system. The agent can't close from these wakes anyway (Change 2), so commanding it to close is contradictory.

**Locations and exact replacements:**

### 5a. `urgent_profit` tier (lines 3725-3731)

**Replace lines 3725-3731 with:**
```python
        elif tier == "urgent_profit":
            header = f"[DAEMON WAKE — Profit Check: {coin} {side.upper()} +{roe_pct:.0f}%]"
            if is_scalp:
                footer = f"Scalp up {roe_pct:+.0f}%. Mechanical exits are tracking this position."
            else:
                footer = f"Swing up {roe_pct:+.0f}%. Trailing stop will manage the exit if price reverses."
            priority = True
```

### 5b. `take_profit` tier (lines 3732-3738)

**Replace lines 3732-3738 with:**
```python
        elif tier == "take_profit":
            header = f"[DAEMON WAKE — Profit Check: {coin} {side.upper()} +{roe_pct:.0f}%]"
            if is_scalp:
                footer = f"Scalp up {roe_pct:+.0f}%. Trailing stop active — mechanical exit manages this."
            else:
                footer = f"Swing up {roe_pct:+.0f}%. Trailing stop tracking — let the mechanical system work."
            priority = True
```

### 5c. `profit_nudge` tier (lines 3739-3745)

**Replace lines 3739-3745 with:**
```python
        elif tier == "profit_nudge":
            header = f"[DAEMON WAKE — {coin} {side.upper()} +{roe_pct:.0f}%]"
            if is_scalp:
                footer = f"Scalp up {roe_pct:+.0f}%. Position running — mechanical exits active."
            else:
                footer = f"Swing building at +{roe_pct:.0f}%. Trailing stop will engage when appropriate."
            priority = False
```

### 5d. `profit_fading` tier (lines 3746-3759)

**Replace lines 3746-3759 with:**
```python
        elif tier == "profit_fading":
            peak = self._peak_roe.get(coin, 0)
            header = f"[DAEMON WAKE — Profit Update: {coin} {side.upper()} peaked +{peak:.0f}% -> now {roe_pct:+.0f}%]"
            if is_scalp:
                footer = (
                    f"Scalp peaked at +{peak:.0f}% ROE, now at {roe_pct:+.0f}%. "
                    f"Trailing stop / dynamic SL will handle the exit."
                )
            else:
                footer = (
                    f"Swing peaked at +{peak:.0f}% ROE, now at {roe_pct:+.0f}%. "
                    f"Mechanical exits are managing this position."
                )
            priority = True
```

### 5e. `risk_no_sl` tier (lines 3760-3766)

**Replace lines 3760-3766 with:**
```python
        elif tier == "risk_no_sl":
            header = f"[DAEMON WAKE — RISK: {coin} {side.upper()} {roe_pct:+.0f}%]"
            if is_scalp:
                footer = f"Scalp at {roe_pct:+.0f}% with no SL detected. Check if dynamic SL placement failed — set a stop via modify_position."
            else:
                footer = f"Swing at {roe_pct:+.0f}% with no stop loss detected. Set a stop via modify_position to protect capital."
            priority = True
```

**Note on `risk_no_sl`:** This is the one case where agent action is warranted — if no SL exists, the dynamic SL may have failed. The agent should be able to tighten (set) a stop via `modify_position`, which is still allowed from daemon wakes. The message directs to `modify_position` instead of "close".

---

## Change 6: Rewrite scanner wake footers

**File:** `src/hynous/intelligence/scanner.py`

### 6a. Position adverse book — scalp (line 1847)

**Replace:**
```python
            lines.append("This is a scalp — book flipped against you. Close or tighten SL now. Don't hold a micro against the flow. 1-2 sentences.")
```

**With:**
```python
            lines.append("Scalp — book flipped against you. Mechanical exits are active. You can tighten SL via modify_position if needed. 1-2 sentences.")
```

### 6b. Position adverse book — swing (lines 1848-1849)

**Replace:**
```python
            lines.append("Swing position — book pressure building. Check if your thesis still holds. Tighten stop or hold if conviction is strong. 1-2 sentences.")
```

**With:**
```python
            lines.append("Swing — book pressure building against you. Mechanical exits managing this position. Tighten SL via modify_position if conviction is weakening. 1-2 sentences.")
```

### 6c. Peak reversion — scalp (lines 1853-1857)

**Replace:**
```python
            lines.append(
                "Scalp is giving back a significant chunk of peak profit. You had it, now it's eroding. "
                "CLOSE or tighten SL to current mark. 'Waiting for recovery' is not a plan on a micro. 1-2 sentences."
            )
```

**With:**
```python
            lines.append(
                "Scalp gave back a significant chunk of peak profit. "
                "Trailing stop / dynamic SL will manage the exit. You can tighten SL via modify_position if needed. 1-2 sentences."
            )
```

### 6d. Peak reversion — swing (lines 1858-1863)

**Replace:**
```python
            lines.append(
                "Swing position is fading from its peak. Three options: close and lock in what's left, "
                "tighten SL to current mark, or state clearly why your thesis still points higher. "
                "No answer is not an answer. 1-2 sentences."
            )
```

**With:**
```python
            lines.append(
                "Swing fading from peak. Mechanical exits are tracking this position. "
                "You can tighten SL via modify_position if thesis is weakening. 1-2 sentences."
            )
```

---

## Change 7: Rewrite position block footer

**File:** `src/hynous/intelligence/daemon.py`

**Location:** Line 5511.

**Replace:**
```python
                        + "\nIf any position is profitable, consider whether to close, trail stop, or hold."
```

**With:**
```python
                        + "\nMechanical exits active on all positions. You can tighten stops via modify_position."
```

---

## Change 8: Rewrite wake_warnings profit-at-risk

**File:** `src/hynous/intelligence/wake_warnings.py`

**Location:** Lines 279-282 inside `_check_profit_at_risk()`.

**Replace:**
```python
            if ret_pct >= take:
                warnings.append(f"{coin} is up {ret_pct:.1f}% — that's exceptional. Tighten stop or take profit NOW.")
            elif ret_pct >= nudge:
                warnings.append(f"{coin} is up {ret_pct:.1f}% — tighten stop to lock in gains")
```

**With:**
```python
            if ret_pct >= take:
                warnings.append(f"{coin} is up {ret_pct:.1f}% — trailing stop tracking this position")
            elif ret_pct >= nudge:
                warnings.append(f"{coin} is up {ret_pct:.1f}% — mechanical exits active")
```

---

## Change 9: Update system prompt EXIT LOCKOUT section

**File:** `src/hynous/intelligence/prompts/builder.py`

**Location:** Lines 155-179, the MECHANICAL EXIT SYSTEM section.

**Replace the entire section (lines 155-179) with:**

```python
**MECHANICAL EXIT SYSTEM:** My exits are handled by code, not by me.

Dynamic protective SL: At entry, the daemon places a volatility-adjusted stop-loss below my \
entry price. The distance depends on the current vol regime (tighter in low/extreme vol, wider \
in normal/high vol). This is NOT a breakeven — it accepts a controlled loss to avoid premature \
stop-outs on normal market noise.

Fee-breakeven: Once I clear fee break-even ROE ({ts.taker_fee_pct * ts.micro_leverage:.1f}% at \
{ts.micro_leverage}x, scales with leverage), the daemon tightens my SL to entry + fee buffer. \
This trade is now risk-free. The dynamic SL is replaced by the fee-breakeven SL.

Trailing stop: Once ROE crosses the activation threshold (adapts to volatility, typically 1.5-3.0%), \
the stop begins trailing using a continuous exponential curve — retracement tightens smoothly as \
the trade runs further, with the tightening speed calibrated to the current vol regime. \
It executes immediately — no wake, no asking me.

FULL EXIT LOCKOUT: I CANNOT close positions or modify take profits during autonomous operation. \
The system will reject my close_position call from any daemon wake. Only the user can close \
positions via direct chat. This is by design — my manual closes were a random, unoptimizable \
loss factor. The mechanical system (dynamic SL / fee-BE / trailing stop) produces consistent, \
tunable exit behavior.

TP lockout: I can only TIGHTEN take profits (move closer to price), never widen them. \
I cannot cancel orders during autonomous operation.

Stop lockout: I can TIGHTEN my stops (move closer to price) but I CANNOT widen or remove \
mechanical stops. The system enforces this — trying to widen will be blocked.

My job is ENTRIES: direction, symbol, conviction, sizing, initial SL/TP, thesis. \
Everything after entry is mechanical. I do not close, I do not move TPs wider, \
I do not cancel orders. I find the next good entry.
```

---

## Testing

### Static Tests (run after each change)

```bash
# Syntax check on all modified files
PYTHONPATH=src .venv/bin/python -m py_compile src/hynous/intelligence/tools/trading.py
PYTHONPATH=src .venv/bin/python -m py_compile src/hynous/intelligence/daemon.py
PYTHONPATH=src .venv/bin/python -m py_compile src/hynous/intelligence/scanner.py
PYTHONPATH=src .venv/bin/python -m py_compile src/hynous/intelligence/wake_warnings.py
PYTHONPATH=src .venv/bin/python -m py_compile src/hynous/intelligence/prompts/builder.py
PYTHONPATH=src .venv/bin/python -m py_compile src/hynous/core/trading_settings.py

# Import check
PYTHONPATH=src .venv/bin/python -c "from hynous.intelligence.tools.trading import handle_close_position, handle_modify_position; print('OK')"
PYTHONPATH=src .venv/bin/python -c "from hynous.core.trading_settings import get_trading_settings; ts = get_trading_settings(); print('lockout:', ts.autonomous_close_lockout)"
```

### New Unit Tests

**Create file:** `tests/unit/test_agent_exit_lockout.py`

Write tests covering these scenarios:

**A. close_position autonomous lockout (6 tests):**

1. `test_close_blocked_from_daemon_wake` — Mock tracer to return `source="daemon:profit"`. Call `handle_close_position`. Assert return contains "BLOCKED" and "autonomous".
2. `test_close_allowed_from_user_chat` — Mock tracer to return `source="user_chat"`. Call `handle_close_position`. Assert does NOT contain "BLOCKED" (will fail on position lookup, but should get past the lockout).
3. `test_close_allowed_when_lockout_disabled` — Set `autonomous_close_lockout=False` in TradingSettings. Mock tracer to return `source="daemon:profit"`. Assert does NOT contain "BLOCKED".
4. `test_close_allowed_when_tracer_unavailable` — Mock `get_active_trace` to return `None`. Assert does NOT contain "BLOCKED" (safety fallback).
5. `test_close_blocked_all_daemon_sources` — Test with each of: `daemon:profit`, `daemon:scanner`, `daemon:fill`, `daemon:review`, `daemon:watchpoint`, `daemon:ml_conditions`. All should be blocked.
6. `test_partial_close_also_blocked` — Same as test 1 but with `partial_pct=50`. Assert blocked.

**B. modify_position autonomous lockout (4 tests):**

7. `test_cancel_orders_blocked_from_daemon` — Mock tracer `source="daemon:scanner"`. Call `handle_modify_position(cancel_orders=True)`. Assert "BLOCKED".
8. `test_tp_modification_blocked_from_daemon` — Mock tracer `source="daemon:profit"`. Call `handle_modify_position(take_profit=100000)`. Assert "BLOCKED".
9. `test_sl_tightening_allowed_from_daemon` — Mock tracer `source="daemon:scanner"`. Call `handle_modify_position(stop_loss=<tighter_value>)`. Assert NOT blocked (will fail later on position lookup, but should pass the lockout gate).
10. `test_cancel_orders_allowed_from_user` — Mock tracer `source="user_chat"`. Call `handle_modify_position(cancel_orders=True)`. Assert NOT blocked.

**C. TP widening guard (4 tests):**

11. `test_tp_widen_blocked_long` — Mock existing TP at $70,000. Call `modify_position(take_profit=75000)` for a long. Assert "BLOCKED" and "Cannot widen".
12. `test_tp_tighten_allowed_long` — Mock existing TP at $70,000. Call `modify_position(take_profit=69000)` for a long. Assert NOT blocked.
13. `test_tp_widen_blocked_short` — Mock existing TP at $60,000. Call `modify_position(take_profit=55000)` for a short. Assert "BLOCKED" and "Cannot widen".
14. `test_tp_tighten_allowed_short` — Mock existing TP at $60,000. Call `modify_position(take_profit=61000)` for a short. Assert NOT blocked.

**D. Config flag (2 tests):**

15. `test_config_flag_exists_in_trading_settings` — Assert `TradingSettings` has `autonomous_close_lockout` field defaulting to `True`.
16. `test_config_flag_in_yaml` — Load config from `config/default.yaml`. Assert `autonomous_close_lockout` is `true`.

**Test patterns:** Follow the existing test style in `tests/unit/test_ml_adaptive_trailing.py` and `tests/unit/test_dynamic_protective_sl.py` — use `unittest.mock.patch` for daemon/provider/tracer mocking, `pytest` assertions, minimal setup.

### Full Suite Regression

```bash
# Run ALL unit tests — must pass with 0 regressions
PYTHONPATH=src .venv/bin/python -m pytest tests/unit/ -q --tb=short

# Expected: 749+ passed (current) + 16 new = 765+ passed
# The pre-existing test_load_config_produces_valid_config failure (model name) is unrelated
```

### Dynamic Verification (Manual)

After deployment to VPS:

1. **Daemon wake close blocked:** Check logs for "autonomous_lockout" trace spans when agent tries to close from profit/scanner wakes.
2. **User chat close works:** SSH into VPS, open dashboard chat, say "close my BTC position" — should execute.
3. **Profit wake messages:** Check daemon logs — messages should say "mechanical exits active" not "CLOSE NOW".
4. **TP widening blocked:** In chat, try to widen a TP — should get "BLOCKED: Cannot widen take profit".

---

## Verification Checklist

Before reporting completion:

- [ ] All 6 files compile without syntax errors
- [ ] All imports resolve correctly
- [ ] `autonomous_close_lockout` field exists in TradingSettings with default `True`
- [ ] `autonomous_close_lockout: true` exists in `config/default.yaml`
- [ ] `handle_close_position` blocks when trace source starts with `"daemon:"`
- [ ] `handle_close_position` allows when trace source is `"user_chat"` or trace unavailable
- [ ] `handle_modify_position` blocks `cancel_orders` from daemon wakes
- [ ] `handle_modify_position` blocks TP modification from daemon wakes
- [ ] `handle_modify_position` allows SL tightening from daemon wakes
- [ ] TP widening guard blocks wider TP for both longs and shorts
- [ ] TP tightening passes for both longs and shorts
- [ ] No profit wake message contains "CLOSE", "close", "Take profit", "take profit", "Lock in"
- [ ] No scanner footer contains "Close" (capital C) as a command
- [ ] Position block footer says "Mechanical exits active"
- [ ] Wake warning says "trailing stop tracking" not "take profit NOW"
- [ ] System prompt contains "FULL EXIT LOCKOUT" and "I CANNOT close positions"
- [ ] 16 new tests pass
- [ ] Full unit test suite passes with 0 regressions
- [ ] No other files were modified

**If any check fails, STOP and report the failure before continuing.**

---

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `src/hynous/core/trading_settings.py` | +1 field: `autonomous_close_lockout` |
| `config/default.yaml` | +1 line: `autonomous_close_lockout: true` |
| `src/hynous/intelligence/tools/trading.py` | +autonomous lockout in close_position, +TP widening guard, +daemon modify lockout |
| `src/hynous/intelligence/daemon.py` | Rewrite 5 profit tier messages + position block footer |
| `src/hynous/intelligence/scanner.py` | Rewrite 4 scanner wake footers |
| `src/hynous/intelligence/wake_warnings.py` | Rewrite 2 profit-at-risk warnings |
| `src/hynous/intelligence/prompts/builder.py` | Update EXIT LOCKOUT section |
| `tests/unit/test_agent_exit_lockout.py` | NEW: 16 tests |
