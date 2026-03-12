# LLM Lookahead Trade Mechanism

> **Status:** Concept
> **Priority:** High
> **Depends on:** WS price feed (implemented), ML condition engine (implemented), mechanical exits (implemented)

---

## Problem

The agent's entry flow is reactive. When a signal fires (scanner anomaly, condition alert, etc.), the daemon wakes the agent, which then spends 5-30 seconds reasoning before placing a trade. At 20x leverage on BTC, a 30-second delay can mean the entry opportunity has already passed or the price has moved significantly against the intended direction.

Exits don't have this problem — trailing stops, breakeven stops, and SL/TP triggers all execute mechanically in the 1s daemon loop via `_fast_trigger_check()` with sub-second WS prices. Entries are the bottleneck.

---

## Core Idea

**Decouple the trade decision from the trade execution.**

Instead of the agent reacting to current conditions and immediately executing, it uses current market data + ML predictions to **pre-stage trades that should execute at a future point**. The daemon then evaluates these staged directives every 1s (same as exits) and fires them mechanically when conditions are met.

### Current Flow (Reactive)

```
Signal detected → Wake agent (5-30s thinking) → Execute trade immediately
                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^
                  Entry delayed by LLM latency
```

### Proposed Flow (Predictive)

```
Agent wakes (any trigger) → Reads ML conditions + market state
                          → Pre-stages directive: "Enter X when conditions Y are met"
                          → Also reviews any active staged trades
                          ↓
Daemon 1s loop → Checks staged directives against live WS prices
               → Conditions met → Mechanical execution (instant)
```

---

## Behavioral Shift

The agent still wakes on the same triggers (scanner, conditions, review cycle, fills, etc.) and still reasons with the full LLM. But its output changes:

- **Before:** "BTC is spiking right now, I should enter long" → immediate execution (30s late)
- **After:** "Based on current vol regime + ML predictions, BTC will likely present a long setup in the next 5-10 min. Staging entry at $X with SL/TP/size defined, expires in 10 min" → mechanical execution when price hits

Every wake cycle, the agent:
1. Checks on any existing open positions (same as today)
2. Reviews active staged directives — confirm, adjust, or cancel
3. Analyzes current conditions + ML predictions to stage new directives

The agent gets a **buffer window** to think without the pressure of immediate execution. The 1s mechanical loop handles the time-critical part.

---

## Open Design Questions

### Directive Structure
What parameters does the LLM output when staging a trade?
- Coin, side, entry price or price range, SL, TP, size, leverage
- Expiry time (how long before the directive dies if not triggered)
- Confidence level or conditions that must still hold at trigger time

### Storage & Persistence
Where do staged directives live?
- In-memory (like `_trailing_active`) — simple but lost on restart
- Persisted to disk (like phantoms) — survives restarts
- Hybrid — in-memory with periodic persistence

### Evaluation Loop
How does the daemon check staged directives?
- Same `_fast_trigger_check` loop (extend it)
- Separate `_check_staged_entries()` method in the 1s loop
- What safety checks run at trigger time? (circuit breaker, max positions, etc.)

### Conflict Handling
- What if the agent stages a BTC long but already has a BTC position?
- What if two directives conflict (long and short on same coin)?
- What if market conditions change drastically between staging and trigger?

### Expiry & Staleness
- How long should a directive live? 5 min? 10 min? Configurable per directive?
- Should the agent be able to extend/renew directives on subsequent wakes?
- What happens to expired directives? Log and discard? Notify agent?

### Interaction with Existing Systems
- How does this interact with the phantom system? (Phantoms are hypothetical; directives are real)
- How does this interact with watchpoints? (Watchpoints wake the agent; directives execute without waking)
- How does this interact with ML-adaptive trading? (Leverage caps, sizing, entry gating still apply at execution time?)

---

## Existing Building Blocks

| System | What it does | Relevance |
|--------|-------------|-----------|
| Mechanical exits | SL/TP/trailing/breakeven fire in 1s loop without LLM | Same pattern — directive execution would work identically |
| Phantom system | Daemon creates hypothetical trades, tracks outcomes | Similar concept but phantoms don't execute; directives would |
| Watchpoints | Price-level triggers that wake the agent | Directives are like watchpoints that execute instead of waking |
| ML condition engine | 14 models predict market state every 300s | Primary input for lookahead predictions |
| WS price feed | Sub-second prices in daemon loop | Enables 1s directive evaluation |
| ML-adaptive trading | Leverage/sizing/gating from live conditions | Safety checks that should apply at directive execution time |

---

Last updated: 2026-03-09
