# ML-Daemon Interaction Issues

> Known architectural issues between the satellite inference engine and the daemon's wake system. These are not bugs in the current implementation — they are structural limitations that need to be understood before enabling non-shadow mode and before relying on ML signals for time-sensitive entries.

**Status**: Shadow mode active (these issues have no practical impact until shadow mode is disabled)
**Priority**: P1 — must be addressed before live ML-driven trading

---

## Issue 1: Stale Signal Delivery (Signal-to-Execution Lag)

### Problem

ML signals are generated every 300 seconds inside `_run_satellite_inference()`, which runs at the end of `_poll_derivatives()`. The signal is then cached in `self._latest_predictions` and delivered to the agent only on the **next daemon wake** — which may happen at any time after the signal was computed, potentially much later.

The model predicts "this coin has a +3.5% long ROE opportunity right now", but the agent may not see that signal for another 2–10+ minutes depending on when the next wake occurs.

### Concrete sequence

```
T=0      _poll_derivatives() fires
T≈300s   ML signal: "BTC LONG, +4.2% ROE"
         cached in _latest_predictions["BTC"]
         next wake could be at T=360s, T=600s, or later

T=360s   Daemon wakes for an unrelated reason (scanner, watchpoint, etc.)
         Agent sees "ML Signals: BTC: LONG (+4.2% ROE) [shadow]" in briefing
         -- but market conditions have already moved 60 seconds

T=600s   Same ML signal still cached; next poll fires and overwrites it
         The signal has been "live" for 5 minutes — stale by this point
```

If the next wake happens to be the periodic review (every 3600s), the agent could be acting on a 60-minute-old signal with completely irrelevant market context.

### Root cause

`_latest_predictions` is a dict that simply holds the last computed values. There is no TTL enforcement at the briefing injection level — only `_build_ml_section()` filters out predictions older than 600 seconds. However this means a 9-minute-old signal can still be shown, which is too stale for a 5-minute model.

The signal generation and the signal delivery are decoupled with no synchronization.

### Impact (non-shadow mode)

- Agent may evaluate a signal against market prices that have already moved past the opportunity window
- The model targets 30-minute forward ROE — a 5–10 minute delivery lag consumes 17–33% of the opportunity window before the agent even considers acting

### Potential fixes (not yet implemented)

1. **TTL tighten**: Reduce the 600s stale filter in `_build_ml_section()` to 360s (one poll cycle) so signals are never shown from more than one cycle ago
2. **Synchronous wake on signal**: Instead of caching and waiting for an unrelated wake, call `_wake_agent()` immediately from `_run_satellite_inference()` when a strong signal fires (this is already partially coded — the issue is the cooldown prevents it; see Issue 3)
3. **Signal age context**: Include the signal age in the briefing ("3m 24s ago") so the agent can self-filter stale signals

---

## Issue 2: In-Trade Signal Suppression (Active Position Check)

### Problem

`_run_satellite_inference()` has this guard:

```python
existing = self._prev_positions.get(coin)
if existing:
    continue  # skip wake for this coin
```

If the daemon is currently holding a BTC position, ML signals for BTC are suppressed from triggering agent wakes entirely. The rationale is correct for avoiding redundant entry signals — but the implementation has a significant gap:

**The signal is still cached and injected into the next briefing**, so the agent will eventually see it — but only when it wakes for some other reason (scanner, watchpoint, review). This creates a scenario where:

1. Daemon enters a long BTC trade at T=0
2. At T=300s, ML fires a **SHORT** BTC signal (regime reversal)
3. Wake is suppressed because `_prev_positions["BTC"]` exists
4. At T=1800s, daemon wakes for a periodic review
5. Agent sees the briefing injection: "ML Signals: BTC: SHORT (+3.8% ROE)"
6. But the signal was computed 25 minutes ago; conditions may have entirely resolved

### Additional gap: signal direction is not checked at suppression time

The current suppression logic blocks ALL coin wakes when a position exists for that coin — regardless of whether the ML signal agrees or contradicts the position direction. A contradicting signal (model says SHORT while you're LONG) is arguably the most important signal to surface immediately. The agent only sees it in a code question ("ML model signals SHORT BTC but you're LONG — re-evaluate?") at the next unrelated wake.

### Potential fixes (not yet implemented)

1. **Direction-aware suppression**: Only suppress wake if ML signal agrees with current position direction. If signal contradicts position, treat it as a priority wake (possible exit/hedge signal)
2. **Minimum signal age at delivery**: Check signal timestamp when assembling briefing; if the signal for a held coin is older than 2x the snapshot interval (600s), suppress the briefing injection entirely

---

## Issue 3: Wake Cooldown Absorbs ML Signals

### Problem

`_wake_agent()` enforces a 120-second cooldown between non-priority wakes (`wake_cooldown_seconds: 120`). ML signals use `priority=False`:

```python
self._wake_agent(
    msg,
    source="daemon:ml_signal",
    max_tokens=1536,
    max_coach_cycles=0,
    # priority not set → defaults to False
)
```

If any non-priority wake fires within 120 seconds of an ML signal (or vice versa), the ML wake is **silently dropped** with a log message and `return None`. The signal is not retried, queued, or re-evaluated.

### Concrete scenario

```
T=0     Scanner detects funding extreme → non-priority wake → fires
T=60s   ML signals BTC LONG +4.5% ROE
        _run_satellite_inference() calls _wake_agent()
        cooldown check: 120s - 60s = 60s remaining → wake SKIPPED
        Signal is logged to DB but agent never sees the dedicated wake
T=300s  Next poll cycle overwrites _latest_predictions with new values
        The +4.5% signal never got its dedicated wake
```

The agent will still see the signal in the next regular briefing injection, but the dedicated high-confidence "ML Signal" wake is permanently lost.

### Interaction with max_wakes_per_hour

`max_wakes_per_hour: 6` is tracked in `wakes_this_hour` but is **not actually enforced** in `_wake_agent()` — it only appears in stats displays (Discord and dashboard). The real enforced limit is the 120s cooldown, which allows at most 30 wakes per hour in practice. This is fine from a rate perspective but means the config field is misleading.

### Potential fixes (not yet implemented)

1. **Priority promotion**: Give ML signals `priority=True` if predicted ROE exceeds a higher threshold (e.g. >5%). This bypasses cooldown like fill wakes do
2. **Signal retry buffer**: Queue dropped ML signals for up to one poll cycle, retry the wake on the next iteration if cooldown has cleared
3. **Minimum gap between polls and ML wakes**: Schedule ML wakes at T+30s after a poll rather than immediately, reducing the chance of collision with scanner wakes that also run near the poll boundary

---

## Issue 4: Single-Tick Inference (No Signal Confirmation)

### Problem

A signal is generated from a single 300-second snapshot. There is no requirement for a signal to persist across consecutive polls before a wake fires. A one-tick spike in `realized_vol_1h` or `price_change_5m_pct` can produce a `long` signal that reverses on the next tick.

The model was trained on 30-minute forward ROE targets, not on signal persistence. A single high-confidence prediction does not mean the signal will still be valid 300 seconds later.

### Impact

- False wakes on transient conditions (volume spikes, momentary volatility)
- Agent may evaluate and potentially act on a signal that is already reversing by the time the LLM responds (which takes 2–5 seconds for the model call alone)

### Potential fixes (not yet implemented)

1. **N-of-M confirmation**: Only fire a wake if the same coin produces the same direction signal in 2 of the last 3 polls (600s confirmation window)
2. **Confidence floor**: Raise `inference_entry_threshold` from 3.0% to 4.0–5.0% to reduce noise signals; higher threshold = fewer but higher-quality triggers
3. **Cooldown per coin per signal direction**: After a LONG BTC signal fires a wake, suppress further LONG BTC signal wakes for at least 1800s (30 min) regardless of predictions

---

## Issue 5: Briefing Injection Independent of Wake Trigger

### Problem

`_latest_predictions` is injected into **every** briefing regardless of why the agent woke. The agent waking to handle a fill notification (position filled at exchange) will see the ML signals section even if the ML prediction is 8 minutes old and the wake has nothing to do with ML.

This is minor but creates unnecessary cognitive noise in the briefing. A fill wake has a specific, time-critical purpose — the ML section adds tokens and potential distraction without value in that context.

### Potential fix (not yet implemented)

Pass the wake `source` to `build_briefing()` and suppress the ML section for non-market wakes (fills, conflicts, learning sessions). Only inject ML signals for `daemon:ml_signal`, `daemon:review`, and `daemon:scanner` wakes.

---

## Issue 6: Kill Switch State Not Persisted Across Daemon Restart

### Problem

`KillSwitch._load_state()` reads from `satellite_metadata` table via the store. However, the kill switch is initialized **after** the satellite store in the daemon init sequence. If the daemon crashes mid-trade and the kill switch was in auto-disabled state, the state should be preserved in the DB.

This is already partially handled — `KillSwitch._save_state()` writes to `satellite_metadata` after each `record_trade_outcome()` call. But the `shadow_mode` flag is set at startup from `config.satellite.inference_shadow_mode` and **overwrites whatever was stored**, meaning:

- Operator manually disables shadow mode for live trading
- Daemon crashes
- On restart, `inference_shadow_mode: false` in config causes shadow mode to be re-applied (correct)
- But if the operator had set shadow mode = true via runtime config change (not saved to YAML), that state is lost

### Potential fix (not yet implemented)

Persist shadow mode changes to `satellite_metadata` table (like the rest of kill switch state) rather than applying from config on every restart.

---

## Summary Table

| # | Issue | Impact (non-shadow) | Severity |
|---|-------|---------------------|----------|
| 1 | Signal-to-execution lag (up to 10+ min) | Stale signals, missed windows | High |
| 2 | In-trade signal suppression ignores direction | Contra-position signals delivered late | High |
| 3 | Cooldown silently drops ML wakes | Strong signals silently lost | Medium |
| 4 | No signal confirmation across ticks | False wakes on transient conditions | Medium |
| 5 | ML briefing injected regardless of wake source | Noise in non-market wakes | Low |
| 6 | Shadow mode not persisted to DB | Lost operator runtime state on restart | Low |

---

## Current Mitigation

All 6 issues are currently **inert** because `inference_shadow_mode: true` is the active configuration. In shadow mode:
- No ML wakes fire at all (Issues 1–5 cannot manifest)
- Shadow state is read from config on restart (Issue 6 is irrelevant since shadow=true)

Before disabling shadow mode, Issues 1, 2, and 3 should be addressed. Issues 4, 5, and 6 can be deferred.

---

Last updated: 2026-03-05
