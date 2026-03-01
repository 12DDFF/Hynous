# Portfolio Tracking Audit

> Status: Resolved (2026-03-01) — 2 critical bugs + 1 structural bug fixed. 2 minor issues deferred (no-fix decisions documented below).
> Commit: 035bbeb. Deployed to production VPS (89.167.50.168). All findings verified against actual codebase before fixing.

---

## Files to Read Before Working on These Issues

Read these files in full before touching anything:

| File | Why |
|---|---|
| `src/hynous/data/providers/paper.py` | PaperProvider — position state, balance, fee math, _stats_reset_at, _save()/_load() |
| `src/hynous/core/trade_analytics.py` | TradeStats, fetch_trade_history(), get_trade_stats(), _get_stats_reset_at(), _merge_partial_trades() |
| `src/hynous/intelligence/context_snapshot.py` | Return % calculation injected into every agent message |
| `src/hynous/intelligence/briefing.py` | Briefing injected before daemon wakes — also computes return % and performance |
| `src/hynous/intelligence/daemon.py` | _daily_realized_pnl, _update_daily_pnl(), _check_positions(), _wake_agent(), _fast_trigger_check() |
| `dashboard/dashboard/state.py` | _fetch_portfolio(), load_journal(), portfolio_initial, journal_total_pnl, journal_recorded_pnl |

---

## Bug 1 — `stats_reset_at` is never set (Critical)

### What it does (when working)

`trade_analytics.get_trade_stats()` reads `stats_reset_at` from `paper-state.json` and passes it as `created_after` to `fetch_trade_history()`. This filters Nous `trade_close` nodes to only those created after the reset timestamp — scoping stats to the current paper session.

```python
# trade_analytics.py:457-458
if created_after is None:
    created_after = _get_stats_reset_at()
```

```python
# trade_analytics.py:24-38
def _get_stats_reset_at() -> str | None:
    # Walks up filesystem looking for storage/paper-state.json
    # Returns data.get("stats_reset_at") from the JSON
```

### The bug

`PaperProvider._stats_reset_at` is initialized to `None` and **never assigned a non-None value anywhere in the codebase**.

```python
# paper.py:79
self._stats_reset_at: str | None = None
```

It IS persisted to disk in `_save()` (line 674: `"stats_reset_at": self._stats_reset_at`) and loaded back in `_load()` (line 703: `self._stats_reset_at = data.get("stats_reset_at")`). But since it's always `None`, it's always saved as `null`, and always loaded as `None`.

**No code in the entire codebase ever calls anything that sets `_stats_reset_at` to a non-null value.** There is no `reset_stats()` method on `PaperProvider`. There is no dashboard button or agent tool that triggers one.

### Consequence

`_get_stats_reset_at()` always returns `None`. `fetch_trade_history()` always queries with `created_after=None`. All `trade_close` Nous nodes ever stored are always included in stats — including those from previous paper sessions. `stats.total_pnl` and all derived metrics (win rate, profit factor, streak, etc.) reflect all-time history, not the current session.

This directly causes the "doesn't add up" symptom: if you reset your paper balance but the old Nous nodes remain, stats show a wildly different number than the wallet balance reflects.

### Fix

Add a `reset_paper_stats()` method to `PaperProvider`:

```python
def reset_paper_stats(self):
    """Mark the current time as the session start for trade stats filtering."""
    with self._lock:
        from datetime import datetime, timezone
        self._stats_reset_at = datetime.now(timezone.utc).isoformat()
        self._save()
```

Then wire this up in one or more of:
1. A dashboard button ("Reset Stats") that calls an API endpoint
2. An agent tool (so the agent can reset stats via `reset_paper_stats`)
3. Automatically when `PaperProvider` is initialized AND `paper-state.json` doesn't exist yet (i.e., first-ever run)
4. Automatically when `reset_paper_balance` or equivalent is called (if that ever gets implemented)

Also consider calling `invalidate_snapshot()` and the trade_analytics module-level cache reset after `reset_paper_stats()` so stale cached stats are cleared immediately.

Note: the trade_analytics module cache (`_cached_stats`, `_cache_time`) is module-level with a 30s TTL. After a reset, the cache must be cleared or you'll see stale stats for up to 30 seconds. Add `trade_analytics._cached_stats = None` after the reset.

---

## Bug 2 — Wrong initial balance in context snapshot and briefing (Critical)

### What the dashboard does (correctly)

`dashboard/state.py:1851`:
```python
initial = getattr(provider, "_initial_balance", config.execution.paper_balance)
```

This reads `PaperProvider._initial_balance` directly from the provider instance. `_initial_balance` is loaded from `paper-state.json` on startup (paper.py:699), so it reflects the actual starting balance of the paper wallet, not necessarily the YAML config value.

### The bug

Both `context_snapshot.py` and `briefing.py` compute return % using `config.execution.paper_balance` instead of `provider._initial_balance`:

**`context_snapshot.py:132-133`:**
```python
initial = config.execution.paper_balance if config else 1000
ret_pct = ((acct - initial) / initial * 100) if initial > 0 else 0
```

**`briefing.py:355-356`** (used in the agent's performance line):
```python
_init = config.execution.paper_balance if config else 1000
_account_pnl = _acct - _init
```

**`briefing.py:383-384`** (used in the portfolio section header):
```python
initial = config.execution.paper_balance if config else 1000
ret_pct = ((acct - initial) / initial * 100) if initial > 0 else 0
```

### When this causes divergence

`PaperProvider._initial_balance` diverges from `config.execution.paper_balance` when:
- The YAML config `paper_balance` value is changed after the state file already exists
- The state file was manually edited or copied from another setup
- The initial balance was programmatically set to a different value than the YAML default

In all these cases, the context snapshot and briefing show the wrong return % to the agent in every single message it receives, and the wrong PnL in the briefing's performance line.

### Consequence

The agent sees an incorrect return % in every message. If the actual paper_balance in state is $5,000 but the YAML says $10,000, the agent is told it's down 50% when it's actually flat. This affects the agent's risk assessment and behavior.

### Fix

Both `context_snapshot.py` and `briefing.py` already receive `provider` as a parameter. Replace the config fallback with a direct read:

```python
# In both files, replace:
initial = config.execution.paper_balance if config else 1000

# With:
initial = getattr(provider, "_initial_balance", None) or \
          (config.execution.paper_balance if config else 1000)
```

This uses `_initial_balance` from the provider when available (paper mode always has it), and falls back to the config value for live trading (where `_initial_balance` doesn't exist on `HyperliquidProvider`).

---

## Bug 3 — Daemon-wake-initiated agent closes don't update the circuit breaker (Structural)

### Background

The daemon's `_daily_realized_pnl` counter is the circuit breaker: if it goes below `-max_daily_loss_usd`, trading is paused. It's updated via `_update_daily_pnl(realized_pnl)`. There are two mechanisms that call this:

1. **SL/TP/liquidation triggers** (`_fast_trigger_check`, `_check_positions` paper path): `check_triggers()` returns events → `_update_daily_pnl()` called immediately.
2. **Agent-initiated closes via position disappearance detection** (`_check_positions` live/fallback path): detects that a position in `_prev_positions` is no longer in the current state → calls `_handle_position_close()` → `_update_daily_pnl()`.

### The bug

When the **daemon wakes the agent** (scanner, watchpoint, profit monitor, etc.) and the agent closes a position as part of its response, the `_update_daily_pnl()` is never called for that close.

The mechanism that should detect it (mechanism 2 above) is bypassed by the `_wake_agent()` `finally` block:

```python
# daemon.py:4290-4302
finally:
    self.agent._chat_lock.release()
    # Refresh position snapshot so agent-initiated closes don't
    # re-trigger fill detection on the next _check_positions() cycle.
    try:
        provider = self._get_provider()
        if provider.can_trade:
            state = provider.get_user_state()
            self._prev_positions = {
                p["coin"]: {...}
                for p in state.get("positions", [])
            }
    except Exception:
        pass
```

This refresh is intended to prevent duplicate wake/detection — but it also removes the closed coin from `_prev_positions`, so `_check_positions()` never detects the close, and `_handle_position_close()` is never called.

`_wake_agent()` runs synchronously in the daemon loop (blocking). After it returns, the loop continues — but `_prev_positions` already reflects the post-close state. So the close is invisible to the position-change detection system.

For paper mode specifically: `_check_positions()` uses the paper path (calls `check_triggers()` first). If check_triggers returns no events, it falls through to the snapshot comparison — but `_prev_positions` is already updated. If `_wake_agent()` runs while daemon-initiated triggers fire simultaneously, there's also potential for the trigger close to be counted by `_fast_trigger_check` AND attempted again by `_check_positions`.

### Consequence

If the agent closes a position during a daemon-initiated wake (e.g., scanner fires, agent reviews and decides to exit), the circuit breaker counter is not updated. The agent could technically exceed the daily loss limit via daemon-wake-initiated closes without triggering the circuit breaker.

This also means `_daily_realized_pnl` (shown in the context snapshot and dashboard) understates today's realized PnL.

**Note**: User-chat-initiated closes are NOT affected. When the user sends a chat and the agent closes a position, `_wake_agent()` is not called, `_prev_positions` is not refreshed immediately, and `_check_positions()` correctly detects the close within 60 seconds.

### Fix

After `_wake_agent()` detects that an agent response caused a position close (by comparing `_prev_positions` before vs after), call `_update_daily_pnl()` for each closed position.

Concrete approach: save `_prev_positions` snapshot before the wake, compare after, find the difference, look up the realized PnL from fills for each newly-closed coin, call `_update_daily_pnl()`.

```python
# In _wake_agent(), before the agent call:
positions_before = dict(self._prev_positions)

# ... agent processes ...

# In the finally block, after refreshing _prev_positions:
for coin, prev_data in positions_before.items():
    if coin not in self._prev_positions:
        # This coin was closed during the wake — find the PnL and update circuit breaker
        try:
            fills = provider.get_user_fills(
                start_ms=int((time.time() - 300) * 1000)
            )
            close_fill = next(
                (f for f in reversed(fills)
                 if f.get("coin") == coin and "Close" in f.get("direction", "")),
                None
            )
            if close_fill:
                self._update_daily_pnl(close_fill.get("closed_pnl", 0.0))
        except Exception:
            pass
```

---

## Minor Issue 4 — Account value slightly overstates equity for open positions

### Where

`paper.py:178-183` (`get_user_state()`):
```python
return {
    "account_value": self.balance + total_margin + total_pnl,
    ...
}
```

`total_pnl` is **gross unrealized PnL** (no exit fees deducted). If you closed every open position right now, you'd pay exit fees (`size * price * TAKER_FEE = 0.035%`). The displayed equity is optimistic by that amount.

### Consequence

At small paper sizes (e.g. $1,000 balance, $500 position), exit fees are ~$0.18. At larger sizes, the delta grows. The Return % in the snapshot and dashboard is slightly inflated whenever positions are open.

### Severity and Fix

This is the industry-standard way to display mark-to-market equity (gross unrealized). No immediate fix required, but if exact accounting is desired:
```python
# paper.py — in get_user_state():
exit_fees = sum(pos.size * prices.get(coin, pos.entry_px) * self.TAKER_FEE
                for coin, pos in self.positions.items())
"account_value": self.balance + total_margin + total_pnl - exit_fees,
```

---

## Minor Issue 5 — Partial close merge key too specific

### Where

`trade_analytics.py:321`:
```python
key = (t.symbol, t.side, t.entry_px, t.trade_type)
```

`_merge_partial_trades()` groups partial closes of the same position by this key. Including `entry_px` means two partial closes are only merged if they share exactly the same float entry price.

### Current impact

None. In paper trading, all partial closes of the same position use the same `entry_px` (the position's `entry_px` field). The `close_position` tool reads `entry_px` from the position dict (which is fixed at open), and stores it in `signals.entry` in the Nous node. So it round-trips cleanly.

### Future impact

If DCA (add-to-position / averaging down) is ever implemented, the position's average entry price changes on each add. Partial closes before and after the DCA would have different `entry_px` values and would NOT be merged — they'd appear as separate trades in the journal.

### Fix (when relevant)

Replace `entry_px` in the key with a position identifier. Since paper mode doesn't have a native position ID, a practical approach is to use the open timestamp from `signals.opened_at`, or accept that DCA positions need explicit handling.

---

## Three PnL Sources (Context, Not a Bug)

The system has three independent PnL numbers that are legitimately different. Documenting this so it's understood rather than debugged repeatedly.

| Source | Location | Scope | Resets |
|---|---|---|---|
| `_daily_realized_pnl` | `daemon.py` in-memory | Today's realized PnL only | UTC midnight |
| `stats.total_pnl` | Nous `trade_close` nodes | All time (or post-`stats_reset_at` when Bug 1 is fixed) | Manual (via `reset_paper_stats()`) |
| `account_value - _initial_balance` | `paper-state.json` | Since wallet initialization | On wallet reset |

They diverge because:
- Daily counter is today-only; it misses yesterday's trades
- Nous sum is all-time; it includes historical sessions (Bug 1 makes this worse)
- Exchange truth counts open positions at gross mark-to-market; the other two count only closed PnL

The Journal page currently shows both `journal_recorded_pnl` (Nous sum) and `journal_total_pnl` (exchange truth) without explaining why they differ. After Bug 1 and Bug 2 are fixed, they should converge more closely, but won't be identical because:
- Exchange truth includes unrealized PnL on open positions; Nous sum does not
- Nous node creation can fail silently (network error), undercounting the Nous sum
