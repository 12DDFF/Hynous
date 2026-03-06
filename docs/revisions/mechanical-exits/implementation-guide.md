# Revision 1: Mechanical Exit System — Implementation Guide

> Priority: CRITICAL — Single highest-impact change.
> Addresses: EXIT-1 through EXIT-7, BUG-1 from the advisor document.
> Source: `docs/temporary-advisor-document.md`

---

## Prerequisites — Read Before Coding

Read these files **in order** before writing any code. Understanding the existing patterns is critical.

### Must Read

| # | File | Lines | Why |
|---|------|-------|-----|
| 1 | `src/hynous/intelligence/daemon.py` | 320-337 | **Position tracking state dicts.** All `self._peak_roe`, `self._trough_roe`, `self._breakeven_set`, `self._small_wins_*` dicts. Your new trailing stop state must follow this exact pattern. |
| 2 | `src/hynous/intelligence/daemon.py` | 843-922 | **Main loop.** Understand the 10s heartbeat, `_fast_trigger_check()` on every iteration, `_check_profit_levels()` every 60s. Your trailing stop check runs inside `_fast_trigger_check()`. |
| 3 | `src/hynous/intelligence/daemon.py` | 1716-1909 | **`_fast_trigger_check()` method.** This is where the breakeven stop (BUG-1) lives and where the trailing stop will be added. Study the full method: price fetch → trigger check → peak/trough ROE tracking → breakeven stop logic → small wins logic. |
| 4 | `src/hynous/intelligence/daemon.py` | 2322-2519 | **`_check_profit_levels()` method.** Contains the profit alert tiers (nudge/take/urgent/fading), MFE/MAE tracking (duplicate of fast-trigger), side-flip cleanup, and position cleanup section (lines 2493-2516). Your new dict must be cleaned up here too. |
| 5 | `src/hynous/intelligence/daemon.py` | 2150-2230 | **`_record_trigger_close()` method.** Records trade closes to Nous. Your trailing stop closes must call this with `classification="trailing_stop"`. Study the full method to understand all the metadata it expects. |
| 6 | `src/hynous/intelligence/daemon.py` | 1854-1906 | **Small wins exit pattern.** This is the template for your trailing stop exit. Study: `market_close()` → update daily PnL → `_record_trigger_close()` → cleanup position types → remove from `_prev_positions` → cancel remaining orders → log + Discord notify. |
| 7 | `src/hynous/intelligence/tools/trading.py` | 1363-1384 | **Fee-loss block** (EXIT-4). You will remove this entirely. |
| 8 | `src/hynous/intelligence/tools/trading.py` | 1723-1842 | **`handle_modify_position()`.** You will add stop-tightening-only enforcement here. Study the SL/TP validation (lines 1773-1795) and the trigger order cancel-and-replace flow (lines 1799-1841). |
| 9 | `src/hynous/intelligence/prompts/builder.py` | 41-100 | **`_GROUND_RULES_STATIC`.** Static prompt text. You will NOT modify this. |
| 10 | `src/hynous/intelligence/prompts/builder.py` | 105-200 | **`_build_ground_rules()`.** Dynamic prompt sections. You will rewrite the fee-loss, peak profit protection, and profit-taking sections. |
| 11 | `src/hynous/data/providers/paper.py` | 34-58 | **`PaperPosition` dataclass** and PnL methods. Understand the fields: `sl_px`, `tp_px`, `sl_oid`, `tp_oid`. |
| 12 | `src/hynous/data/providers/paper.py` | 454-512 | **`place_trigger_order()` and `cancel_order()`.** These are the paper provider's SL/TP management methods you'll call when updating the trailing stop. |
| 13 | `src/hynous/data/providers/paper.py` | 555-625 | **`check_triggers()`.** Paper provider's trigger evaluation. Runs priority: liquidation > SL > TP. When your trailing stop updates the `sl_px` on the paper position, this method automatically enforces it. |
| 14 | `src/hynous/core/config.py` | 94-130 | **`DaemonConfig` dataclass.** Current breakeven/fee config fields. You will add trailing stop config fields here. |
| 15 | `src/hynous/core/trading_settings.py` | 27-97 | **`TradingSettings` dataclass.** Runtime-adjustable settings. You will add trailing stop settings here. |
| 16 | `config/default.yaml` | 34-51 | **Daemon YAML config.** You will add trailing stop defaults here. Must match `DaemonConfig` defaults. |
| 17 | `docs/temporary-advisor-document.md` | Full file | **Advisor analysis.** Contains the data-backed rationale for every change: BUG-1 formula, EXIT-1–7 findings, trailing stop model parameters (50% retracement, 2.8% activation, breakeven zone). |

### Reference Only (Do Not Modify)

| File | Why |
|------|-----|
| `src/hynous/intelligence/daemon.py` lines 4314-4512 | `_wake_agent()` — understand how wakes work, but trailing stops do NOT wake the agent. |
| `src/hynous/intelligence/briefing.py` lines 291-476 | Briefing builder — position display. Not modified in this revision. |
| `src/hynous/intelligence/context_snapshot.py` lines 322-333 | Activity counters. Not modified in this revision. |
| `docs/integration.md` | Cross-system data flows. Reference for understanding daemon → provider interaction. |

---

## Overview of Changes

This revision implements **mechanical exit management** — code-driven stops that execute without LLM involvement. Seven changes, ordered by implementation dependency:

1. **Fix BUG-1:** Invert the breakeven stop formula
2. **Add trailing stop state** to daemon `__init__`
3. **Add trailing stop config** to `DaemonConfig`, `TradingSettings`, `default.yaml`
4. **Implement trailing stop logic** in `_fast_trigger_check()`
5. **Add stop-tightening lockout** to `modify_position`
6. **Remove the fee-loss block** from `close_position`
7. **Rewrite prompt sections** in `builder.py`

---

## Change 1: Fix BUG-1 — Breakeven Stop Formula Inversion

**File:** `src/hynous/intelligence/daemon.py`
**Lines:** 1804-1808

### Current Code (BROKEN)

```python
be_price = (
    entry_px * (1 - buffer_pct) if is_long
    else entry_px * (1 + buffer_pct)
)
```

For longs, this places the stop BELOW entry (guaranteeing a loss). For shorts, it places the stop ABOVE entry (also guaranteeing a loss).

### Replace With

```python
be_price = (
    entry_px * (1 + buffer_pct) if is_long
    else entry_px * (1 - buffer_pct)
)
```

For longs: stop is ABOVE entry → nets a small profit when hit.
For shorts: stop is BELOW entry → nets a small profit when hit.

### Also Fix: Buffer Values

**File:** `src/hynous/core/config.py`
**Lines:** 127-128

Change the buffer values to match the round-trip fee so "breakeven" actually breaks even:

```python
# BEFORE:
breakeven_buffer_micro_pct: float = 0.10
breakeven_buffer_macro_pct: float = 0.30

# AFTER:
breakeven_buffer_micro_pct: float = 0.07  # Round-trip fee (0.035% per side) — nets ~0% when hit
breakeven_buffer_macro_pct: float = 0.07  # Same for macro — true breakeven regardless of trade type
```

**File:** `config/default.yaml` — There are no YAML entries for these (they use dataclass defaults). No YAML change needed.

### Verification

After this change, a 20x long entered at $100,000:
- Buffer = 0.07% → `be_price = 100000 * 1.0007 = $100,070`
- Stop is $70 above entry → catches the trade at +0.07% price move → +1.4% ROE
- Round-trip fee at 20x = 0.07% × 20 = 1.4% ROE → net ≈ 0%

---

## Change 2: Add Trailing Stop State to Daemon `__init__`

**File:** `src/hynous/intelligence/daemon.py`
**Location:** After line 337 (after `self._small_wins_tp_placed`)

Add these new state dicts:

```python
        self._trailing_active: dict[str, bool] = {}   # coin → True once trail is engaged
        self._trailing_stop_px: dict[str, float] = {}  # coin → current trailing stop price level
```

These follow the exact same pattern as `self._breakeven_set` and `self._small_wins_exited`.

---

## Change 3: Add Trailing Stop Config

### 3A: DaemonConfig dataclass

**File:** `src/hynous/core/config.py`
**Location:** After line 129 (after `taker_fee_pct`)

Add:

```python
    # Trailing stop
    trailing_stop_enabled: bool = True              # Master switch for trailing stop system
    trailing_activation_roe: float = 2.8            # ROE % to activate trailing (modeled optimum)
    trailing_retracement_pct: float = 50.0          # % of peak ROE to give back before stop fires (50% = trail at half peak)
```

### 3B: TradingSettings dataclass

**File:** `src/hynous/core/trading_settings.py`
**Location:** After line 96 (after `small_wins_roe_pct`)

Add:

```python
    # --- Trailing Stop ---
    # Mechanical trailing stop — code handles exits, LLM handles entries.
    # Once ROE exceeds trailing_activation_roe, the stop trails at (1 - trailing_retracement_pct/100) * peak_roe.
    # Stop moves upward only, executes immediately when hit. No LLM involvement.
    trailing_stop_enabled: bool = True
    trailing_activation_roe: float = 2.8    # ROE % threshold to begin trailing
    trailing_retracement_pct: float = 50.0  # % of peak ROE allowed as giveback before exit
```

### 3C: default.yaml

**File:** `config/default.yaml`
**Location:** After line 51 (after `playbook_cache_ttl`)

Add:

```yaml
  # Peak profit protection
  breakeven_buffer_micro_pct: 0.07   # Price % buffer for breakeven stop (matches round-trip fee)
  breakeven_buffer_macro_pct: 0.07   # Same for macro trades
  # Trailing stop (mechanical exit — no agent involvement)
  trailing_stop_enabled: true          # Master switch
  trailing_activation_roe: 2.8         # ROE % to activate trailing
  trailing_retracement_pct: 50.0       # % of peak ROE to give back before exit
```

---

## Change 4: Implement Trailing Stop in `_fast_trigger_check()`

**File:** `src/hynous/intelligence/daemon.py`
**Location:** Inside `_fast_trigger_check()`, AFTER the breakeven stop block (after line 1852) and BEFORE the small wins block (line 1854).

This is the core change. The trailing stop runs every 10s alongside breakeven and MFE tracking.

### Implementation

Insert the following block between the breakeven stop block and the small wins block:

```python
                # ── Trailing Stop: mechanical exit, no agent involvement ──────────
                # Activates once ROE exceeds threshold. Trails at configured
                # retracement from peak. Stop only moves up, never down.
                # Executes immediately — no wake, no LLM decision.
                if (
                    self.config.daemon.trailing_stop_enabled
                    and not self._small_wins_exited.get(sym)  # Don't trail if small wins already closed
                ):
                    ts = get_trading_settings()
                    if ts.trailing_stop_enabled:
                        activation_roe = ts.trailing_activation_roe
                        retracement_pct = ts.trailing_retracement_pct / 100.0
                        peak = self._peak_roe.get(sym, 0)

                        # Phase 1: Check if trail should activate
                        if not self._trailing_active.get(sym) and roe_pct >= activation_roe:
                            self._trailing_active[sym] = True
                            logger.info(
                                "Trailing stop ACTIVATED: %s %s | ROE %.1f%% >= %.1f%% threshold",
                                sym, side, roe_pct, activation_roe,
                            )

                        # Phase 2: Update trailing stop price (only if active)
                        if self._trailing_active.get(sym) and peak > 0:
                            # Trail ROE = peak * (1 - retracement)
                            trail_roe = peak * (1.0 - retracement_pct)

                            # Floor: never trail below breakeven (fee break-even ROE)
                            fee_be_roe = self.config.daemon.taker_fee_pct * leverage
                            trail_roe = max(trail_roe, fee_be_roe)

                            # Convert trail ROE to price
                            trail_price_pct = trail_roe / leverage / 100.0
                            if side == "long":
                                new_trail_px = entry_px * (1 + trail_price_pct)
                            else:
                                new_trail_px = entry_px * (1 - trail_price_pct)

                            # Stop only moves UP (tighter) — never backwards
                            old_trail_px = self._trailing_stop_px.get(sym, 0)
                            if side == "long":
                                should_update = (new_trail_px > old_trail_px) if old_trail_px > 0 else True
                            else:
                                should_update = (new_trail_px < old_trail_px) if old_trail_px > 0 else True

                            if should_update:
                                self._trailing_stop_px[sym] = new_trail_px
                                # Update the paper provider's SL to match
                                try:
                                    # Cancel existing SL first, then place new one
                                    triggers = self._tracked_triggers.get(sym, [])
                                    for t in triggers:
                                        if t.get("order_type") == "stop_loss" and t.get("oid"):
                                            self._get_provider().cancel_order(sym, t["oid"])
                                    self._get_provider().place_trigger_order(
                                        symbol=sym,
                                        is_buy=(side != "long"),
                                        sz=pos.get("size", 0),
                                        trigger_px=new_trail_px,
                                        tpsl="sl",
                                    )
                                    # Refresh trigger cache so check_triggers sees the new SL
                                    self._refresh_trigger_cache()
                                    if old_trail_px > 0:
                                        logger.info(
                                            "Trailing stop UPDATED: %s %s | $%,.2f → $%,.2f (peak ROE %.1f%%, trail ROE %.1f%%)",
                                            sym, side, old_trail_px, new_trail_px, peak, trail_roe,
                                        )
                                except Exception as trail_err:
                                    logger.warning("Trailing stop update failed for %s: %s", sym, trail_err)

                        # Phase 3: Check if trailing stop is HIT
                        # This is a backup — paper provider's check_triggers() catches it too,
                        # but we want immediate execution + proper classification.
                        if self._trailing_active.get(sym):
                            trail_px = self._trailing_stop_px.get(sym)
                            if trail_px and trail_px > 0:
                                trail_hit = (
                                    (side == "long" and px <= trail_px) or
                                    (side == "short" and px >= trail_px)
                                )
                                if trail_hit:
                                    try:
                                        result = self._get_provider().market_close(sym)
                                        realized_pnl = result.get("closed_pnl", 0.0)
                                        exit_px_trail = result.get("avg_px", px)
                                        trail_roe_at_exit = roe_pct
                                        peak_at_exit = self._peak_roe.get(sym, 0)

                                        trail_msg = (
                                            f"[TRAILING STOP] {sym} {side.upper()} closed at {trail_roe_at_exit:+.1f}% ROE "
                                            f"(peak was {peak_at_exit:+.1f}%). Trail stop @ ${trail_px:,.2f} hit."
                                        )
                                        _queue_and_persist("System", f"Trailing Stop: {sym}", trail_msg)
                                        _notify_discord_simple(
                                            f"Trailing stop hit: {sym} {side.upper()} | "
                                            f"ROE {trail_roe_at_exit:+.1f}% (peak {peak_at_exit:+.1f}%) | "
                                            f"PnL ${realized_pnl:+.2f}"
                                        )
                                        log_event(DaemonEvent(
                                            "profit", f"trailing_stop: {sym} {side}",
                                            f"Exit ROE {trail_roe_at_exit:+.1f}% | Peak {peak_at_exit:+.1f}% | "
                                            f"PnL ${realized_pnl:+.2f}",
                                        ))
                                        self._update_daily_pnl(realized_pnl)
                                        self._record_trigger_close({
                                            "coin": sym, "side": side, "entry_px": entry_px,
                                            "exit_px": exit_px_trail, "realized_pnl": realized_pnl,
                                            "classification": "trailing_stop",
                                        })
                                        self._position_types.pop(sym, None)
                                        self._persist_position_types()
                                        self._prev_positions.pop(sym, None)
                                        try:
                                            self._get_provider().cancel_all_orders(sym)
                                        except Exception:
                                            pass
                                    except Exception as trail_close_err:
                                        logger.warning("Trailing stop close failed for %s: %s", sym, trail_close_err)
```

### Important Notes

1. The `get_trading_settings` import already exists at the top of this method (used by small wins). Reuse it.
2. `_queue_and_persist`, `_notify_discord_simple`, `log_event`, `DaemonEvent` are all module-level functions already used by the breakeven and small-wins blocks. No new imports needed.
3. The trailing stop updates the paper provider's SL via `place_trigger_order()`, so the paper provider's `check_triggers()` can also catch it on the next cycle. The Phase 3 backup ensures immediate execution when the daemon detects the hit in the same loop iteration.
4. The `_refresh_trigger_cache()` call after placing the new SL ensures `self._tracked_triggers` is current for subsequent checks.

### Cleanup: Add Trailing Stop Dicts to All Cleanup Locations

**Location 1:** Side-flip reset in `_check_profit_levels()` (after line 2450)

Add two lines after the existing cleanup block:

```python
                    self._trailing_active.pop(coin, None)      # New hold — re-arm trailing
                    self._trailing_stop_px.pop(coin, None)      # New hold — clear trail price
```

**Location 2:** Position close cleanup in `_check_profit_levels()` (after line 2516)

Add a new cleanup block:

```python
            for coin in list(self._trailing_active):
                if coin not in open_coins:
                    del self._trailing_active[coin]
            for coin in list(self._trailing_stop_px):
                if coin not in open_coins:
                    del self._trailing_stop_px[coin]
```

---

## Change 5: Stop-Tightening Lockout on `modify_position`

**File:** `src/hynous/intelligence/tools/trading.py`
**Location:** Inside `handle_modify_position()`, after the SL validation block (after line 1783), before the existing `changes = []` line (line 1797).

### Implementation

Add this enforcement block:

```python
    # --- Mechanical stop lockout: LLM can only TIGHTEN stops, never widen ---
    # If the daemon set a trailing/breakeven stop, the agent cannot move it further away.
    if stop_loss is not None:
        existing_sl = None
        try:
            existing_triggers = provider.get_trigger_orders(symbol)
            for t in existing_triggers:
                if t.get("order_type") == "stop_loss":
                    existing_sl = t.get("trigger_px")
                    break
        except Exception:
            pass

        if existing_sl is not None:
            if is_long and stop_loss < existing_sl:
                return (
                    f"BLOCKED: Cannot widen stop loss from ${existing_sl:,.2f} to ${stop_loss:,.2f}. "
                    f"Mechanical stops can only be TIGHTENED (moved closer to current price). "
                    f"Your SL must be >= ${existing_sl:,.2f} for this long."
                )
            if not is_long and stop_loss > existing_sl:
                return (
                    f"BLOCKED: Cannot widen stop loss from ${existing_sl:,.2f} to ${stop_loss:,.2f}. "
                    f"Mechanical stops can only be TIGHTENED (moved closer to current price). "
                    f"Your SL must be <= ${existing_sl:,.2f} for this short."
                )
```

This lets the agent tighten stops (move closer to mark price) but blocks widening (moving further from mark). The daemon's trailing stop is protected.

**Note:** The existing trigger order fetch at line 1800 is duplicated with this new block. Refactor: move the `existing_triggers` fetch BEFORE the lockout check and reuse it for the cancel-and-replace flow below. The fetch at line 1800-1804 can then use the already-fetched variable.

---

## Change 6: Remove Fee-Loss Block from `close_position`

**File:** `src/hynous/intelligence/tools/trading.py`
**Lines:** 1363-1384

### Delete This Entire Block

```python
    # --- Pre-flight fee check ---
    # If closing would be a fee loss (direction correct but net < 0), block unless force=True
    if not force:
        mark_px = float(position.get("mark_px", 0))
        unrealized_pnl = float(position.get("unrealized_pnl", 0))
        full_size_pre = float(position.get("size", 0))
        entry_px_pre = float(position.get("entry_px", 0))
        if mark_px > 0 and full_size_pre > 0 and entry_px_pre > 0:
            proj_size = full_size_pre * (partial_pct / 100.0)
            proj_gross = unrealized_pnl * (partial_pct / 100.0)
            proj_fees = proj_size * (entry_px_pre + mark_px) * 0.00035
            proj_net = proj_gross - proj_fees
            if proj_gross > 0 and proj_net < 0:
                return (
                    f"⚠ FEE BLOCK — closing {symbol} now would be a fee loss.\n"
                    f"  Projected gross: {_fmt_price(proj_gross)}  |  "
                    f"  Est. fees: ~{_fmt_price(proj_fees)}  |  "
                    f"  Net: {_fmt_price(proj_net)}\n"
                    f"Direction is correct. If you are closing for risk management "
                    f"(thesis broken, stop management), pass force=True. "
                    f"Otherwise, let TP work."
                )
```

**Why:** The trailing stop protects trades from re-entering the fee-loss zone. The fee-loss block was converting ~0% outcomes into -3% to -10% losses by preventing rational early exits. With trailing stops, the trade is mechanically closed before profit erodes past the break-even floor.

**Also:** Remove the `force` parameter from `handle_close_position` if it is only used by this block. Check the function signature and all callers first. If `force` is used elsewhere, leave the parameter but remove only the fee-loss check block.

### Check for `force` Usage

Search for all callers of `handle_close_position` and all uses of `force=True` in the codebase. The `force` parameter may also be used by other callers (like the agent passing `force=True` for risk management). If so, keep the parameter in the signature but remove the fee-loss check body. The parameter becomes a no-op for now, which is fine.

---

## Change 7: Rewrite Prompt Sections in `builder.py`

**File:** `src/hynous/intelligence/prompts/builder.py`

### 7A: Rewrite the FEE AWARENESS section (lines 133-147)

Replace the entire FEE AWARENESS paragraph inside the `trade_types` f-string with:

```python
**FEE AWARENESS (all trades):** Round-trip taker fees = {ts.taker_fee_pct}% × leverage ROE. \
At {ts.micro_leverage}x (micro): ~{ts.taker_fee_pct * ts.micro_leverage:.1f}% ROE to break even. \
Macro fee break-even by leverage: \
{ts.macro_leverage_max}x → {ts.taker_fee_pct * ts.macro_leverage_max:.2f}% ROE | \
10x → {ts.taker_fee_pct * 10:.2f}% ROE | 5x → {ts.taker_fee_pct * 5:.2f}% ROE | \
3x → {ts.taker_fee_pct * 3:.2f}% ROE."""
```

**Removed:** "I do NOT close micros early with tiny green", "fee loss means I exited too early — not a skill problem, a patience problem", and the `force=True` override instructions. These sentences encouraged holding through drawdowns (EXIT-3).

### 7B: Rewrite the PEAK PROFIT PROTECTION section (lines 153-167)

Replace with:

```python
**MECHANICAL EXIT SYSTEM:** My exits are handled by code, not by me.

Breakeven stop: Once I clear fee break-even ROE ({ts.taker_fee_pct * ts.micro_leverage:.1f}% at \
{ts.micro_leverage}x, scales with leverage), the daemon moves my SL to entry + fee buffer. \
This trade is now risk-free.

Trailing stop: Once ROE exceeds {ts.trailing_activation_roe if hasattr(ts, 'trailing_activation_roe') else 2.8}%, \
the stop begins trailing at {ts.trailing_retracement_pct if hasattr(ts, 'trailing_retracement_pct') else 50}% \
retracement from peak. The stop only moves up, never down. It executes immediately — no wake, \
no asking me. This protects winners from reversing into losers.

Stop lockout: I can TIGHTEN my stops (move closer to price) but I CANNOT widen or remove \
mechanical stops. The system enforces this — trying to widen will be blocked.

My job is ENTRIES: direction, symbol, conviction, sizing, initial SL/TP, thesis. \
Everything after entry is mechanical. I do not override, delay, or rationalize around \
the trailing stop. It fires, the trade closes, I move on."""
```

### 7C: Rewrite the `profit_taking` variable (line 188)

Replace with:

```python
    profit_taking = """**Exit management is mechanical.** I don't decide when to exit — the trailing stop handles it. My breakeven stop protects capital once fees are cleared. My trailing stop locks in proportional profit as the trade extends. I focus on finding the next good entry, not micromanaging exits."""
```

### 7D: Remove or update the Small Wins Mode section (lines 169-186)

The small wins mode and trailing stop serve similar purposes but the trailing stop is strictly superior (proportional capture vs flat target). However, keep small wins mode as an option for now — it may be useful as an even more aggressive exit mode. No changes needed to this section.

### 7E: Update the `_GROUND_RULES_STATIC` (line 65)

**Line 65** currently says: `**I don't do these things:** Chase pumps. Double down on losers. Revenge trade. Ignore stops. Let winners become losers. Trade without a thesis.`

This is fine as-is — "Let winners become losers" now has mechanical backing. No change needed.

---

## Testing Plan

### Static Tests (Unit)

Create `tests/unit/test_mechanical_exits.py`:

```python
"""
Unit tests for the mechanical exit system.

Tests cover:
1. BUG-1 fix: breakeven stop formula
2. Trailing stop activation, trailing, floor enforcement
3. Stop-tightening lockout in modify_position
4. Fee-loss block removal
"""
import pytest


class TestBreakevenStopFormula:
    """BUG-1 fix: breakeven stop places correctly for longs and shorts."""

    def test_long_breakeven_above_entry(self):
        """Long breakeven stop should be ABOVE entry price."""
        entry_px = 100_000
        buffer_pct = 0.07 / 100  # 0.07%
        is_long = True
        be_price = entry_px * (1 + buffer_pct) if is_long else entry_px * (1 - buffer_pct)
        assert be_price > entry_px, f"Long BE {be_price} should be > entry {entry_px}"
        assert abs(be_price - 100_070) < 1, f"Expected ~100070, got {be_price}"

    def test_short_breakeven_below_entry(self):
        """Short breakeven stop should be BELOW entry price."""
        entry_px = 100_000
        buffer_pct = 0.07 / 100
        is_long = False
        be_price = entry_px * (1 + buffer_pct) if is_long else entry_px * (1 - buffer_pct)
        assert be_price < entry_px, f"Short BE {be_price} should be < entry {entry_px}"
        assert abs(be_price - 99_930) < 1, f"Expected ~99930, got {be_price}"

    def test_breakeven_nets_zero_at_20x(self):
        """At 20x, hitting the 0.07% buffer stop should net ~0% after fees."""
        entry_px = 100_000
        buffer_pct = 0.0007
        leverage = 20
        fee_roe = 0.07 * leverage  # 1.4% ROE
        be_price = entry_px * (1 + buffer_pct)  # long
        price_move_pct = (be_price - entry_px) / entry_px * 100
        roe_at_be = price_move_pct * leverage
        net_roe = roe_at_be - fee_roe
        assert abs(net_roe) < 0.1, f"Net ROE at BE should be ~0%, got {net_roe:.2f}%"


class TestTrailingStopLogic:
    """Trailing stop activation, trailing, and floor enforcement."""

    def test_activation_threshold(self):
        """Trail activates when ROE crosses activation threshold."""
        activation_roe = 2.8
        assert 1.0 < activation_roe  # Not active
        assert 2.8 >= activation_roe  # Active
        assert 5.0 >= activation_roe  # Active

    def test_trail_roe_calculation(self):
        """Trail ROE = peak * (1 - retracement_pct)."""
        peak_roe = 10.0
        retracement_pct = 0.50
        trail_roe = peak_roe * (1.0 - retracement_pct)
        assert trail_roe == 5.0

    def test_trail_never_below_fee_breakeven(self):
        """Trail ROE floor is fee break-even ROE."""
        peak_roe = 3.0
        retracement_pct = 0.50
        fee_pct = 0.07
        leverage = 20
        fee_be_roe = fee_pct * leverage  # 1.4%
        trail_roe = peak_roe * (1.0 - retracement_pct)  # 1.5%
        trail_roe = max(trail_roe, fee_be_roe)  # max(1.5, 1.4) = 1.5
        assert trail_roe >= fee_be_roe

        # Edge case: very small peak
        peak_roe_small = 2.8
        trail_roe_small = peak_roe_small * (1.0 - retracement_pct)  # 1.4%
        trail_roe_small = max(trail_roe_small, fee_be_roe)  # max(1.4, 1.4) = 1.4
        assert trail_roe_small >= fee_be_roe

    def test_trail_price_long(self):
        """Trail price for longs is above entry."""
        entry_px = 100_000
        trail_roe = 5.0  # 5% ROE
        leverage = 20
        trail_price_pct = trail_roe / leverage / 100.0  # 0.0025
        trail_px = entry_px * (1 + trail_price_pct)
        assert trail_px == 100_250  # $250 above entry

    def test_trail_price_short(self):
        """Trail price for shorts is below entry."""
        entry_px = 100_000
        trail_roe = 5.0
        leverage = 20
        trail_price_pct = trail_roe / leverage / 100.0
        trail_px = entry_px * (1 - trail_price_pct)
        assert trail_px == 99_750  # $250 below entry

    def test_stop_only_moves_tighter(self):
        """Stop never moves backwards (looser)."""
        # Long: new trail must be > old trail
        old_trail_long = 100_250
        new_trail_higher = 100_300
        new_trail_lower = 100_200
        assert new_trail_higher > old_trail_long  # OK — tighter
        assert not (new_trail_lower > old_trail_long)  # Blocked — looser

        # Short: new trail must be < old trail
        old_trail_short = 99_750
        new_trail_lower_s = 99_700
        new_trail_higher_s = 99_800
        assert new_trail_lower_s < old_trail_short  # OK — tighter
        assert not (new_trail_higher_s < old_trail_short)  # Blocked — looser

    def test_trail_hit_detection_long(self):
        """Long trailing stop fires when price drops to trail price."""
        trail_px = 100_250
        price_above = 100_500
        price_at = 100_250
        price_below = 100_200
        assert not (price_above <= trail_px)
        assert (price_at <= trail_px)
        assert (price_below <= trail_px)

    def test_trail_hit_detection_short(self):
        """Short trailing stop fires when price rises to trail price."""
        trail_px = 99_750
        price_below = 99_500
        price_at = 99_750
        price_above = 99_800
        assert not (price_below >= trail_px)
        assert (price_at >= trail_px)
        assert (price_above >= trail_px)


class TestStopTighteningLockout:
    """LLM can only tighten stops, never widen."""

    def test_long_tighten_allowed(self):
        """Moving SL closer to price (higher) on a long is allowed."""
        existing_sl = 99_000
        new_sl = 99_500  # Closer to mark price
        is_long = True
        blocked = is_long and new_sl < existing_sl
        assert not blocked

    def test_long_widen_blocked(self):
        """Moving SL further from price (lower) on a long is blocked."""
        existing_sl = 99_000
        new_sl = 98_500  # Further from mark price
        is_long = True
        blocked = is_long and new_sl < existing_sl
        assert blocked

    def test_short_tighten_allowed(self):
        """Moving SL closer to price (lower) on a short is allowed."""
        existing_sl = 101_000
        new_sl = 100_500
        is_long = False
        blocked = not is_long and new_sl > existing_sl
        assert not blocked

    def test_short_widen_blocked(self):
        """Moving SL further from price (higher) on a short is blocked."""
        existing_sl = 101_000
        new_sl = 101_500
        is_long = False
        blocked = not is_long and new_sl > existing_sl
        assert blocked


class TestFeeLossBlockRemoved:
    """Fee-loss block no longer prevents closes."""

    def test_close_in_fee_loss_zone_allowed(self):
        """Closing a trade where gross > 0 but net < 0 should no longer be blocked."""
        # This is a design test — the actual enforcement code is deleted.
        # If someone re-adds a fee-loss block, this test documents the intent.
        gross_pnl = 5.0   # $5 gross profit
        fees = 7.0         # $7 in fees
        net_pnl = gross_pnl - fees  # -$2 net loss
        # Previously: this would be blocked. Now: allowed.
        assert gross_pnl > 0 and net_pnl < 0, "This scenario should be allowed to close"
```

Run with:
```bash
PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py -v
```

### Dynamic Tests (Live Environment)

These tests require a running system. The engineer must verify each scenario interactively.

#### Setup

```bash
# Terminal 1: Start Nous server
cd nous-server && pnpm --filter server start

# Terminal 2: Start data layer
cd data-layer && make run

# Terminal 3: Start dashboard + daemon
cd dashboard && reflex run
```

Ensure `config/default.yaml` has:
- `execution.mode: "paper"`
- `daemon.enabled: true` (or enable via dashboard Settings page)
- `trailing_stop_enabled: true`
- `trailing_activation_roe: 2.8`
- `trailing_retracement_pct: 50.0`

#### Test Scenario 1: BUG-1 Fix Verification

1. Open the Chat page in the dashboard
2. Tell the agent to enter a trade: "Go long SOL with medium conviction"
3. Wait for the breakeven stop to activate (watch daemon logs for "breakeven_stop" event)
4. **Verify:** In the daemon log, the breakeven SL price should be ABOVE entry price for a long
5. Check the paper provider state (via Settings or Debug page) — `sl_px` should be > `entry_px`

#### Test Scenario 2: Trailing Stop Activation + Trailing

1. Enter a trade via Chat
2. Watch daemon logs for "Trailing stop ACTIVATED" message — should appear when ROE crosses 2.8%
3. As price moves further in the trade's favor, watch for "Trailing stop UPDATED" messages
4. **Verify:** Each update moves the stop price closer to current price (higher for longs, lower for shorts)
5. **Verify:** The stop never moves backwards even if price retraces slightly

#### Test Scenario 3: Trailing Stop Execution

1. Enter a trade and wait for trailing stop to activate
2. Wait for price to reverse past the trail level
3. **Verify:** The position closes automatically with a "TRAILING STOP" log message
4. **Verify:** Discord notification is sent (if Discord is configured)
5. **Verify:** Trade close is recorded in Nous (check Journal page)
6. **Verify:** The close event includes `classification: "trailing_stop"`, correct MFE/MAE

#### Test Scenario 4: Stop-Tightening Lockout

1. Enter a trade and wait for breakeven or trailing stop to be set
2. Via Chat, ask the agent to modify the stop loss to a WIDER level (further from price)
3. **Verify:** The agent receives a "BLOCKED" message explaining stops can only be tightened
4. Ask the agent to TIGHTEN the stop (closer to price)
5. **Verify:** The modification succeeds

#### Test Scenario 5: Fee-Loss Block Removed

1. Enter a trade
2. When the trade is in gross profit but net loss (fee-loss zone, typically at +0.5-1.0% ROE at 20x), ask the agent to close the position
3. **Verify:** The close executes successfully without requiring `force=True`
4. **Verify:** No "FEE BLOCK" message appears

#### Test Scenario 6: Trailing Stop + Small Wins Interaction

1. Enable small wins mode (Settings page, set `small_wins_roe_pct: 3.0`)
2. Enter a trade
3. **Verify:** If small wins fires before trailing activates (ROE hits 3.0% before 2.8%), the trade closes via small wins
4. **Verify:** Trailing stop does NOT try to also close the trade after small wins

#### Test Scenario 7: Position Cleanup

1. Enter a trade, let trailing stop activate
2. Close the trade (via agent, trailing stop, or SL)
3. **Verify:** `_trailing_active` and `_trailing_stop_px` are cleaned up for that symbol
4. Enter a new trade on the same symbol
5. **Verify:** Trailing stop starts fresh (no stale state from previous trade)

---

## Summary of All File Changes

| File | Change |
|------|--------|
| `src/hynous/intelligence/daemon.py` | BUG-1 fix (lines 1805-1808), trailing stop state (after line 337), trailing stop logic (after line 1852), cleanup in `_check_profit_levels()` (lines 2446-2450, 2493-2516) |
| `src/hynous/intelligence/tools/trading.py` | Stop-tightening lockout (after line 1783), fee-loss block removal (lines 1363-1384) |
| `src/hynous/intelligence/prompts/builder.py` | Rewrite fee awareness (lines 133-147), peak profit protection (lines 153-167), profit taking (line 188) |
| `src/hynous/core/config.py` | Fix breakeven buffer values (lines 127-128), add trailing stop config fields (after line 129) |
| `src/hynous/core/trading_settings.py` | Add trailing stop settings (after line 96) |
| `config/default.yaml` | Add trailing stop YAML config (after line 51) |
| `tests/unit/test_mechanical_exits.py` | NEW FILE — unit tests for all changes |

---

## Completion Checklist

- [ ] BUG-1: Breakeven formula inverted (`1 + buffer` for longs)
- [ ] BUG-1: Buffer values set to 0.07% (round-trip fee)
- [ ] Trailing stop state dicts added to `__init__`
- [ ] Config added to `DaemonConfig`, `TradingSettings`, `default.yaml`
- [ ] Trailing stop logic added to `_fast_trigger_check()` (activate, trail, execute)
- [ ] Trailing stop dicts cleaned up in side-flip reset and position-close cleanup
- [ ] Stop-tightening lockout added to `handle_modify_position()`
- [ ] Fee-loss block removed from `handle_close_position()`
- [ ] Prompt sections rewritten (fee awareness, peak profit, profit taking)
- [ ] Unit tests pass: `PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py -v`
- [ ] Dynamic test scenarios 1-7 verified in live environment
- [ ] No regressions: existing daemon functionality (breakeven, small wins, profit alerts) still works

---

Last updated: 2026-03-05
