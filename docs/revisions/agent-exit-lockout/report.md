# Agent Exit Lockout — Full Autonomous Close Disable

## Problem Statement

The mechanical exit system (dynamic SL → fee-BE → trailing stop) is designed around
"LLM handles entries, code handles exits." The implementation enforces this principle
ONLY after trailing stop activates (ROE 1.5-3%+). Before that, the agent has
unrestricted access to `close_position()`.

**Data (183 trades, 2026-03-18 to 2026-03-28, all mechanical systems correct):**

| Exit Type | Trades | WR | PnL | Avg ROE |
|-----------|--------|----|-----|---------|
| Trailing stop | 44 | 100% | +$36.06 | +1.02% |
| Take profit | 5 | 100% | +$25.93 | +6.36% |
| Fee-breakeven | 86 | 38% | -$0.01 | 0.00% |
| **Agent manual close** | **37** | **3%** | **-$85.39** | **-2.83%** |
| Dynamic protective SL | 11 | 0% | -$38.59 | -5.00% |

The agent's 37 manual closes are **not necessarily all worse** than letting the
dynamic SL fire — the agent cut at avg -2.83% ROE while the dynamic SL sits at
-7.0% ROE in normal vol. On trades where price never recovers, the agent may
have saved money versus the SL.

**However, the agent's closes are a random, uncontrollable factor:**
- Closing at -0.4% one trade, -5.9% the next
- Based on whatever microstructure the agent happens to see (book flips, CVD)
- No consistency to measure, backtest, or optimize against

**The mechanical SL is a consistent, tunable factor:**
- Vol-regime calibrated distances (Low=2.5%, Normal=7.0%, High=8.0%, Extreme=3.0%)
- Can be adjusted based on outcome data
- Produces predictable, measurable loss distributions

**Goal: Remove the random agent exit factor so the only loss source is the
ML-calibrated SL — a consistent system we can optimize with data.**

---

## Current Architecture

```
Position Opens
    │
    ├─ Dynamic SL placed (immediate, vol-calibrated)
    │   └─ Agent CAN close here ← THE GAP
    │
    ├─ Fee-BE SL tightens (when ROE clears fees)
    │   └─ Agent CAN close here ← THE GAP
    │
    ├─ Trailing Stop activates (ROE 1.5-3%)
    │   └─ Agent BLOCKED from closing ← ENFORCED
    │
    └─ Trailing Stop fires (price reverses to trail level)
        └─ Mechanical exit
```

### The Only Code-Level Guard (trailing lockout)

```python
# trading.py:1598-1619
if _daemon and _daemon.is_trailing_active(symbol):
    trail_px = _daemon._trailing_stop_px.get(symbol, 0)
    peak = _daemon.get_peak_roe(symbol)
    return (
        f"BLOCKED: Trailing stop is active for {symbol}. "
        f"The mechanical exit system owns this position "
        f"(peak ROE {peak:+.1f}%, trail SL @ ${trail_px:,.2f}). "
        f"You cannot close manually while the trail is active. "
        f"The trailing stop will exit when the price reverses to the trail level."
    )
```

- `is_trailing_active()` returns `self._trailing_active.get(coin, False)`
- `force` parameter is **deprecated and does nothing** (line 1544)
- Safety fallback: if daemon unavailable, close is allowed

---

## What Drives the Agent to Close

### Daemon Wake Messages With Explicit Close Language

The daemon sends multiple wake types with aggressive close commands:

**VERY HIGH close pressure:**
- Profit nudge (scalps): `"CLOSE THIS TRADE NOW. This is peak micro profit."`
- Profit fading (scalps): `"Your profit is dying. CLOSE NOW or you lose it all."`
- Scanner peak_reversion (scalps): `"CLOSE or tighten SL to current mark."`
- Scanner position_adverse_book (scalps): `"Close or tighten SL now. Don't hold a micro against the flow."`

**HIGH close pressure:**
- Urgent profit (swings): `"Take profit or give a clear reason to hold."`
- ML drawdown risk: `"YOUR {side} faces extreme drawdown risk"`

### Briefing Context That Primes Closing

- MFE "gave back" display: `"MFE +2.1% (gave back 45%)"` — triggers loss aversion
- Profit-at-risk warnings (wake_warnings.py): `"tighten stop or take profit NOW"`
- Funding cost display, orderbook imbalance questions, coach sharpener risk questions
- Position block in every wake: `"If any position is profitable, consider whether to close, trail stop, or hold."`

### System Prompt Contradiction

The prompt says `"My job is ENTRIES... Everything after entry is mechanical"` but
`close_position` is fully available pre-trailing. The agent finds legitimate
reasons ("thesis invalidated by ask-heavy book + sell CVD") and overrides the
mechanical system.

---

## The 37 Manual Closes — Pattern

All follow the same pattern:
1. Agent enters on scanner/ML signal
2. Price moves adversely within 2-15 minutes
3. Agent sees microstructure change (book flip, CVD reversal)
4. Agent calls `close_position()` citing "thesis invalidated"
5. Loss: -$0.33 to -$5.58 per trade

Every reason is plausible in isolation. The problem is inconsistency — the agent
applies different thresholds each time based on transient signals. This creates
a random, unoptimizable loss factor.

---

## Edge Cases to Design For

1. **User-initiated closes from chat** — User says "close my BTC" during
   interactive chat. Must still work. Need to distinguish autonomous daemon
   wakes from user conversations.

2. **Side-flip entries** — Agent wants to go short while holding long. Currently
   must close first. Options: block the close (agent can't flip), or allow
   close-and-reopen as a single atomic action via `execute_trade`.

3. **Small wins mode** — Daemon mechanically closes at configured ROE. Works
   independently; agent is told not to override. No conflict.

4. **Emergency: Dynamic SL not placed** — If data-layer is down and the daemon
   hasn't placed a dynamic SL yet, the position has no mechanical protection.
   Agent closing might be the only safeguard. Need to handle this.

5. **Daemon not running** — Safety fallback already exists: `except Exception: pass`
   allows close if daemon unavailable.

6. **Partial closes** — Agent can do 50% partial. If autonomous closes are blocked,
   partials should also be blocked.

7. **Profit-taking wakes** — The daemon currently sends "CLOSE THIS TRADE NOW"
   messages. If agent can't close, these messages need to be removed or
   repurposed (the trailing stop handles profit-taking mechanically).

8. **Scanner position_adverse_book / peak_reversion** — These wakes tell the agent
   to close/tighten. If agent can't close, tightening SL via `modify_position`
   should still be allowed (the stop-tightening lockout already prevents widening).

---

## Relevant Code Locations

| File | Lines | What |
|------|-------|------|
| `src/hynous/intelligence/tools/trading.py` | 1556-1619 | `handle_close_position()` — only guard is trailing lockout |
| `src/hynous/intelligence/tools/trading.py` | 1542-1544 | `force` param — deprecated, does nothing |
| `src/hynous/intelligence/daemon.py` | 802-804 | `is_trailing_active()` — only accessor |
| `src/hynous/intelligence/daemon.py` | 3765-3920 | Profit alert wakes — "CLOSE NOW" language |
| `src/hynous/intelligence/daemon.py` | 4209-4290 | Scanner wakes — position risk/peak fade |
| `src/hynous/intelligence/daemon.py` | 3936-3975 | Position block injected into all wakes |
| `satellite/condition_alerts.py` | (various) | ML condition alerts — drawdown messaging |
| `src/hynous/intelligence/prompts/builder.py` | 155-200 | System prompt EXIT LOCKOUT sections |
| `src/hynous/core/trading_settings.py` | 98-132 | Trailing/dynamic SL settings |
| `config/default.yaml` | 59-78 | Default mechanical exit settings |
| `tests/unit/test_ml_adaptive_trailing.py` | (various) | Exit lockout tests (trailing-only) |

## What Doesn't Exist Yet

- No config flag for full autonomous close lockout (only trailing lockout exists)
- No `is_mechanical_exit_active()` or `is_position_managed()` method on daemon
- No source detection in `handle_close_position()` (can't distinguish user vs autonomous)
- No test coverage for pre-trailing close blocking
- Wake messages still contain "CLOSE NOW" language that conflicts with lockout
