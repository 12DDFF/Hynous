# Breakeven System Fix — Two-Layer Capital + Fee Protection

> **Status:** IMPLEMENTED — Round 1 (commit `5224ade`, 2026-03-10) + Round 2 bugs A–I (commit `5f3c47c`, 2026-03-12) + Round 3 (stale flag fix + background wakes, 2026-03-13)
> **Config (2026-03-17 update):** Capital-BE (Layer 1) **DEPRECATED** — replaced by Dynamic Protective SL (`capital_breakeven_enabled: false`). Fee-BE (Layer 2) remains active (`breakeven_stop_enabled: true`). New layer progression: Dynamic SL → Fee-BE → Trailing. See `dynamic-protective-sl.md`.
> **Priority:** Critical
> **Depends on:** WS price feed (implemented), mechanical exits (implemented), trade mechanism debug (5 fixes implemented)

---

## Problem

The breakeven system has a **design gap** that leaves trades unprotected.

### Current Behavior

The breakeven stop activates only when ROE covers the full round-trip fee:

```
fee_be_roe = taker_fee_pct × leverage = 0.07% × 20 = 1.4% ROE
```

At 20x leverage, a trade must reach **+1.4% ROE** before breakeven activates. If peak ROE reaches +1.06% and reverses, breakeven never fires. The trade falls to its original SL (e.g., -5.69% ROE).

### Evidence — SOL SHORT (2026-03-11)

| Metric | Value |
|--------|-------|
| Entry | $85.6165 |
| Exit | $85.80 |
| Leverage | 20x |
| Peak ROE | +1.06% |
| fee_be_roe threshold | 1.4% |
| Exit ROE | -5.69% |
| Gross PnL | -$5.69 |
| Fees | -$1.86 |

The trade was **genuinely profitable** (price moved 0.053% in the favorable direction) but hadn't covered the 0.07% round-trip fee. Breakeven correctly did not fire per current logic — but the trade should have been protected.

### Root Cause

There is no intermediate protection layer. The system has:
- Original SL (agent-placed, typically -3% to -5% ROE)
- Fee-breakeven SL (activates at 1.4% ROE at 20x)
- Trailing stop (activates at 2.8% ROE)

The gap between the original SL and fee-breakeven is where trades die. A trade that reaches +1% ROE and reverses has no protection.

---

## Solution — Two-Layer Breakeven

Add a **capital-breakeven** layer below the existing fee-breakeven:

```
Trade opens with original SL (e.g., -3% ROE)
    │
    ▼ price reaches capital_be_roe threshold (e.g., +0.5% ROE)
Layer 1: Capital-breakeven → SL moves to entry price
    │                         (worst case: ~-0.7% ROE fee loss at 20x)
    │
    ▼ price reaches fee_be_roe threshold (e.g., +1.4% ROE at 20x)
Layer 2: Fee-breakeven → SL tightens to entry + 0.07% buffer
    │                     (worst case: ~$0 net)
    │
    ▼ price reaches trailing_activation_roe (2.8% ROE)
Trailing stop → SL trails at 50% retracement from peak
```

Each layer only **tightens** the SL — never widens. The SL moves progressively closer to (and above) entry as the trade becomes more profitable.

### Layer 1: Capital-Breakeven (New)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Threshold | Configurable, default **0.5% ROE** | Fixed ROE, NOT fee-proportional |
| SL placement | Entry price (no buffer) | Accepts fee loss to protect capital |
| Worst-case exit | ~-0.7% ROE at 20x | Exit taker fee only |
| Best-case exit | ~$0 if price at exactly entry | Rare — usually some slippage |

**Why 0.5% ROE default:** At 20x, 0.5% ROE = 0.025% price move. This is enough to confirm the trade is directionally correct while still being reachable for most trades. Too low (0.1%) would trigger on noise. Too high (1.0%) approaches the fee-breakeven and defeats the purpose.

### Layer 2: Fee-Breakeven (Existing, unchanged)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Threshold | `taker_fee_pct × leverage` | 1.4% at 20x, 1.05% at 15x |
| SL placement | Entry + 0.07% buffer | Covers round-trip fee |
| Worst-case exit | ~$0 net | Fee-neutral |

### Impact Analysis

Using the SOL SHORT trade as reference:

| Scenario | Exit ROE | Improvement |
|----------|----------|-------------|
| No breakeven (current) | -5.69% | — |
| Capital-breakeven at 0.5% | ~-0.7% | +4.99% ROE saved |
| Fee-breakeven at 1.4% | ~0% | Never reached (peak was +1.06%) |

---

## Additional Fixes (Bundled)

Three code-level bugs exist in the current breakeven implementation. These are fixed alongside the two-layer redesign.

### Bug A: Missing `_refresh_trigger_cache()` after breakeven SL placement

**Location:** `daemon.py` lines 2094-2131 (breakeven block)

**Issue:** After placing the breakeven SL, the trigger cache is NOT refreshed. The trailing stop block (which runs immediately after) reads stale `_tracked_triggers` and may cancel/replace the breakeven SL with incorrect data.

**Compare:** The trailing stop block calls `_refresh_trigger_cache()` at line 2195 after placing its SL. The breakeven block omits this.

**Fix:** Add `self._refresh_trigger_cache()` after the `place_trigger_order()` call in the breakeven block.

### Bug B: Blocking `_wake_agent()` inside breakeven block

**Location:** `daemon.py` line 2120

**Issue:** The breakeven block calls `_wake_agent()` synchronously. This is a full LLM API call (5-30 seconds) that **freezes `_fast_trigger_check()`**. During this freeze:
- No SL/TP triggers are evaluated
- No trailing stop updates occur
- No peak ROE tracking runs

The SL IS placed before the wake (line 2102-2108), so the paper provider has the breakeven SL. But `check_triggers()` isn't called during the freeze, so if price drops to the SL level during the wake, it won't be caught until the wake returns.

**Compare:** The trailing stop (line 2133 comment: "no agent involvement") and small wins (line 2253) exits are fully mechanical — no agent wake, no blocking.

**Fix:** Remove the `_wake_agent()` call from the breakeven block. Log the event instead. The agent can see breakeven status in its next scheduled briefing.

### Bug C: Cancel-then-fail leaves position unprotected

**Location:** `daemon.py` lines 2098-2108

**Issue:** The breakeven block cancels the old SL (line 2100), then places the new one (line 2102). If `place_trigger_order()` throws an exception, the old SL is already gone and no replacement exists. The position has **no stop loss**.

**Fix:** Wrap placement in a try-except that restores the old SL on failure.

---

## Prerequisites — Required Reading

The engineer agent MUST read these files before implementing:

### Core Implementation Files (MUST READ)

| File | Lines | What to understand |
|------|-------|--------------------|
| `src/hynous/intelligence/daemon.py` | 320-365 | All state dictionaries and their lifecycle |
| `src/hynous/intelligence/daemon.py` | 1977-2310 | Full `_fast_trigger_check()` — understand execution order |
| `src/hynous/intelligence/daemon.py` | 2064-2131 | Current breakeven block — this is what you're modifying |
| `src/hynous/intelligence/daemon.py` | 2133-2251 | Trailing stop block — reference pattern for mechanical exits |
| `src/hynous/intelligence/daemon.py` | 2312-2376 | `_update_peaks_from_candles()` — MFE tracking, does NOT trigger breakeven |
| `src/hynous/intelligence/daemon.py` | 2963-2973 | Side-flip cleanup — must reset new state dicts |
| `src/hynous/intelligence/daemon.py` | 3016-3045 | Position-close cleanup — must clean new state dicts |
| `src/hynous/intelligence/daemon.py` | 1960-1975 | `_refresh_trigger_cache()` — understand what it does |
| `src/hynous/intelligence/daemon.py` | 2796-2809 | `_override_sl_classification()` — must handle new classification |
| `src/hynous/data/providers/paper.py` | 454-494 | `place_trigger_order()` and `cancel_order()` — SL mechanics |
| `src/hynous/data/providers/paper.py` | 555-625 | `check_triggers()` — trigger evaluation and fill price logic |
| `src/hynous/core/config.py` | 120-140 | `DaemonConfig` — add new config fields here |
| `config/default.yaml` | 50-62 | YAML defaults — MUST match config.py defaults |
| `src/hynous/core/trading_settings.py` | 55-110 | Runtime settings — NOT used for this change (daemon config only) |

### Reference Documentation (SHOULD READ)

| File | Why |
|------|-----|
| `docs/revisions/trade-mechanism-debug/README.md` | All 6 prior bugs — understand what was fixed and why |
| `docs/archive/mechanical-exits/implementation-guide.md` | Original implementation — 7 changes, BUG-1 formula fix |
| `docs/revisions/ws-migration/README.md` | WS price feed context — why 1s loop exists |
| `src/hynous/intelligence/tools/trading.py` lines 1960-2025 | Stop-tightening lockout — protects daemon SLs from agent |

### Test Files (MUST READ for test patterns)

| File | What it tests | Pattern to follow |
|------|---------------|-------------------|
| `tests/unit/test_mechanical_exits.py` | BE formula, trailing logic, tightening lockout | Pure logic tests — replicate formulas, validate math |
| `tests/unit/test_exit_classification.py` | `_override_sl_classification()` | Helper replication + source reading pattern |
| `tests/unit/test_cancel_before_place.py` | Cancel-before-place in BE block | Source reading, pattern validation |
| `tests/unit/test_stale_trigger_cache_fix.py` | `has_good_sl` logic, cache refresh | Logic replication, state simulation |
| `tests/unit/test_candle_peak_tracking.py` | Peak/trough ROE updates | ROE calculation validation |

---

## Implementation Guide

### Change 1: Add Config Fields

**File:** `src/hynous/core/config.py`

**Location:** `DaemonConfig` dataclass, after line 128 (`breakeven_buffer_macro_pct`)

**Add these fields:**

```python
capital_breakeven_enabled: bool = True         # Layer 1: move SL to entry when ROE > threshold
capital_breakeven_roe: float = 0.5             # Fixed ROE % threshold (not fee-proportional)
```

**File:** `config/default.yaml`

**Location:** daemon section, after `breakeven_buffer_macro_pct: 0.07`

**Add:**

```yaml
capital_breakeven_enabled: true
capital_breakeven_roe: 0.5              # Fixed ROE % — SL moves to entry price when hit
```

**Validation checklist:**
- [ ] Python default matches YAML default exactly
- [ ] Field names use snake_case
- [ ] Types match (bool, float)

---

### Change 2: Add State Dictionary

**File:** `src/hynous/intelligence/daemon.py`

**Location:** After line 337 (`self._breakeven_set`)

**Add:**

```python
self._capital_be_set: dict[str, bool] = {}  # coin → True once capital-breakeven SL placed this hold
```

**Why a separate dict:** Capital-breakeven and fee-breakeven are independent layers. A trade can have capital-BE set but not fee-BE (peak between 0.5% and 1.4%). Both flags must be tracked independently.

---

### Change 3: Rewrite Breakeven Block in `_fast_trigger_check()`

**File:** `src/hynous/intelligence/daemon.py`

**Location:** Replace lines 2064-2131 (entire breakeven block) with the new two-layer implementation.

**Current code to remove** (lines 2064-2131):

```python
# Breakeven stop: check every 10s with fresh price (not just 60s)
if (
    self.config.daemon.breakeven_stop_enabled
    and not self._breakeven_set.get(sym)
):
    # ... entire existing breakeven block including _wake_agent call
```

**Replace with:**

```python
# ── Layer 1: Capital-breakeven — protect capital, accept fee loss ──
# Activates at a low fixed ROE threshold. SL moves to entry price.
# Worst case: exit costs the taker fee (~0.7% ROE at 20x).
# This is the safety net — catches trades that never reach fee-BE.
if (
    self.config.daemon.capital_breakeven_enabled
    and not self._capital_be_set.get(sym)
    and not self._breakeven_set.get(sym)  # Skip if fee-BE already set (tighter)
):
    capital_be_threshold = self.config.daemon.capital_breakeven_roe
    if roe_pct >= capital_be_threshold:
        is_long = (side == "long")
        # SL at exactly entry price — no buffer (we accept the fee loss)
        capital_be_price = entry_px

        # Check if existing SL is already tighter than entry
        triggers = self._tracked_triggers.get(sym, [])
        has_tighter_sl = any(
            t.get("order_type") == "stop_loss" and (
                (is_long and t.get("trigger_px", 0) >= capital_be_price) or
                (not is_long and 0 < t.get("trigger_px", 0) <= capital_be_price)
            )
            for t in triggers
        )
        if has_tighter_sl:
            self._capital_be_set[sym] = True
        else:
            # Save old SL for rollback on failure
            old_sl_info = None
            for t in triggers:
                if t.get("order_type") == "stop_loss" and t.get("oid"):
                    old_sl_info = (t["oid"], t.get("trigger_px"))
                    break

            try:
                # Cancel existing SL
                for t in triggers:
                    if t.get("order_type") == "stop_loss" and t.get("oid"):
                        self._get_provider().cancel_order(sym, t["oid"])

                # Place capital-breakeven SL at entry price
                sz = pos.get("size", 0)
                self._get_provider().place_trigger_order(
                    symbol=sym,
                    is_buy=(side != "long"),
                    sz=sz,
                    trigger_px=capital_be_price,
                    tpsl="sl",
                )
                self._refresh_trigger_cache()
                self._capital_be_set[sym] = True
                logger.info(
                    "Capital-breakeven SET: %s %s | SL @ $%,.2f (entry) | ROE %+.1f%% >= %.1f%% threshold",
                    sym, side, capital_be_price, roe_pct, capital_be_threshold,
                )
                log_event(DaemonEvent(
                    "profit", f"capital_breakeven: {sym} {side}",
                    f"SL @ ${capital_be_price:,.2f} (entry) | ROE {roe_pct:+.1f}%",
                ))
            except Exception as cbe_err:
                logger.warning("Capital-breakeven failed for %s: %s", sym, cbe_err)
                # Rollback: restore old SL if placement failed
                if old_sl_info:
                    try:
                        self._get_provider().place_trigger_order(
                            symbol=sym,
                            is_buy=(side != "long"),
                            sz=pos.get("size", 0),
                            trigger_px=old_sl_info[1],
                            tpsl="sl",
                        )
                        self._refresh_trigger_cache()
                    except Exception:
                        logger.error("CRITICAL: Failed to restore old SL for %s after capital-BE failure", sym)

# ── Layer 2: Fee-breakeven — tighten SL to cover fees ──────────
# Activates when ROE covers round-trip fee. SL moves to entry + buffer.
# Worst case: ~$0 net. This is the upgrade from capital-BE.
if (
    self.config.daemon.breakeven_stop_enabled
    and not self._breakeven_set.get(sym)
):
    fee_be_roe = self.config.daemon.taker_fee_pct * leverage
    if roe_pct >= fee_be_roe:
        type_info = self.get_position_type(sym)
        trade_type = type_info["type"]
        buffer_pct = (
            self.config.daemon.breakeven_buffer_micro_pct
            if trade_type == "micro"
            else self.config.daemon.breakeven_buffer_macro_pct
        ) / 100.0
        is_long = (side == "long")
        be_price = (
            entry_px * (1 + buffer_pct) if is_long
            else entry_px * (1 - buffer_pct)
        )
        # Check if existing SL is already adequate
        triggers = self._tracked_triggers.get(sym, [])
        has_good_sl = any(
            t.get("order_type") == "stop_loss" and (
                (is_long and t.get("trigger_px", 0) >= be_price) or
                (not is_long and 0 < t.get("trigger_px", 0) <= be_price)
            )
            for t in triggers
        )
        if has_good_sl:
            self._breakeven_set[sym] = True
        else:
            # Save old SL for rollback
            old_sl_info = None
            for t in triggers:
                if t.get("order_type") == "stop_loss" and t.get("oid"):
                    old_sl_info = (t["oid"], t.get("trigger_px"))
                    break

            try:
                # Cancel existing SL before placing fee-breakeven
                for t in triggers:
                    if t.get("order_type") == "stop_loss" and t.get("oid"):
                        self._get_provider().cancel_order(sym, t["oid"])
                sz = pos.get("size", 0)
                self._get_provider().place_trigger_order(
                    symbol=sym,
                    is_buy=(side != "long"),
                    sz=sz,
                    trigger_px=be_price,
                    tpsl="sl",
                )
                self._refresh_trigger_cache()  # FIX Bug A: was missing
                self._breakeven_set[sym] = True
                # Also mark capital-BE as set (fee-BE is strictly tighter)
                self._capital_be_set[sym] = True
                type_label = f"{trade_type} {leverage}x"
                logger.info(
                    "Fee-breakeven SET: %s %s (%s) | SL @ $%,.2f | ROE %+.1f%% >= %.1f%%",
                    sym, side, type_label, be_price, roe_pct, fee_be_roe,
                )
                log_event(DaemonEvent(
                    "profit", f"fee_breakeven: {sym} {side}",
                    f"SL @ ${be_price:,.2f} | ROE {roe_pct:+.1f}%",
                ))
            except Exception as be_err:
                logger.warning("Fee-breakeven failed for %s: %s", sym, be_err)
                # Rollback: restore old SL if placement failed
                if old_sl_info:
                    try:
                        self._get_provider().place_trigger_order(
                            symbol=sym,
                            is_buy=(side != "long"),
                            sz=pos.get("size", 0),
                            trigger_px=old_sl_info[1],
                            tpsl="sl",
                        )
                        self._refresh_trigger_cache()
                    except Exception:
                        logger.error("CRITICAL: Failed to restore old SL for %s after fee-BE failure", sym)
```

**Key differences from old code:**
1. **No `_wake_agent()` call** — fully mechanical, no blocking (Bug B fix)
2. **`_refresh_trigger_cache()` after every SL placement** (Bug A fix)
3. **Rollback on failure** — restores old SL if placement throws (Bug C fix)
4. **Two independent layers** — capital-BE at fixed threshold, fee-BE at fee-proportional threshold
5. **Layer skip logic** — capital-BE skips if fee-BE already set (tighter SL exists)

---

### Change 4: Update `_override_sl_classification()`

**File:** `src/hynous/intelligence/daemon.py`

**Location:** Lines 2796-2809

**Current code:**

```python
def _override_sl_classification(self, coin: str, classification: str) -> str:
    if classification != "stop_loss":
        return classification
    if self._trailing_active.get(coin):
        return "trailing_stop"
    if self._breakeven_set.get(coin):
        return "breakeven_stop"
    return classification
```

**Replace with:**

```python
def _override_sl_classification(self, coin: str, classification: str) -> str:
    if classification != "stop_loss":
        return classification
    if self._trailing_active.get(coin):
        return "trailing_stop"
    if self._breakeven_set.get(coin):
        return "breakeven_stop"
    if self._capital_be_set.get(coin):
        return "capital_breakeven_stop"
    return classification
```

**Precedence order (most specific → least):**
1. `trailing_stop` — highest priority (tightest SL)
2. `breakeven_stop` — fee-breakeven (tighter than capital-BE)
3. `capital_breakeven_stop` — capital protection (entry price SL)
4. `stop_loss` — original agent SL

---

### Change 5: Update State Cleanup

**File:** `src/hynous/intelligence/daemon.py`

#### 5a: Side-flip cleanup (lines 2963-2973)

**After line 2967** (`self._breakeven_set.pop(coin, None)`), add:

```python
self._capital_be_set.pop(coin, None)         # New position — re-evaluate capital-BE
```

#### 5b: Position-close cleanup (lines 3028-3030)

**After the `_breakeven_set` cleanup loop** (line 3030), add:

```python
for coin in list(self._capital_be_set):
    if coin not in open_coins:
        del self._capital_be_set[coin]
```

---

### Change 6: Update Event-Based Eviction

**File:** `src/hynous/intelligence/daemon.py`

**Context:** When `_fast_trigger_check()` processes trigger events (position closed by SL/TP), it evicts the coin from `_prev_positions` at line 2027-2028. The state dicts are cleaned up later in `_check_profit_levels()`. No change needed here — the existing cleanup at lines 3016-3045 handles it.

However, verify the `_record_trigger_close()` call at line 2012 reads `_peak_roe`, `_trough_roe`, and classification BEFORE eviction. Current code does this correctly (line 2689-2691 in `_record_trigger_close`).

---

### Change 7: Update `_record_trigger_close()` to Handle New Classification

**File:** `src/hynous/intelligence/daemon.py`

**Location:** `_record_trigger_close()` method (lines 2645-2758)

**No code change needed.** The classification is passed through as `event["classification"]` and stored in the Nous node signals as `close_type`. The new `capital_breakeven_stop` classification will flow through automatically.

**However, verify:** The `_wake_for_fill()` method (called at line 2013) handles the new classification gracefully. Read its implementation to confirm it doesn't have a hardcoded list of valid classifications.

---

### Change 8: Update Candle Peak Tracking to Re-evaluate Capital-Breakeven

**File:** `src/hynous/intelligence/daemon.py`

**Location:** `_update_peaks_from_candles()` method (lines 2312-2376)

**Current issue:** `_update_peaks_from_candles()` updates `_peak_roe` from candle data but never triggers breakeven evaluation. This means a sub-1s wick captured by candles could cross the capital-BE threshold without activating it.

**Add after line 2366** (after the MFE correction log), inside the `if best_roe > self._peak_roe.get(sym, 0):` block:

```python
# Re-evaluate capital-breakeven if candle shows threshold was crossed
if (
    self.config.daemon.capital_breakeven_enabled
    and not self._capital_be_set.get(sym)
    and not self._breakeven_set.get(sym)
):
    capital_threshold = self.config.daemon.capital_breakeven_roe
    if best_roe >= capital_threshold:
        is_long = (side == "long")
        try:
            triggers_for_sym = self._tracked_triggers.get(sym, [])
            has_tighter = any(
                t.get("order_type") == "stop_loss" and (
                    (is_long and t.get("trigger_px", 0) >= entry_px) or
                    (not is_long and 0 < t.get("trigger_px", 0) <= entry_px)
                )
                for t in triggers_for_sym
            )
            if not has_tighter:
                for t in triggers_for_sym:
                    if t.get("order_type") == "stop_loss" and t.get("oid"):
                        self._get_provider().cancel_order(sym, t["oid"])
                self._get_provider().place_trigger_order(
                    symbol=sym,
                    is_buy=(side != "long"),
                    sz=self._prev_positions.get(sym, {}).get("size", 0),
                    trigger_px=entry_px,
                    tpsl="sl",
                )
                self._refresh_trigger_cache()
                self._capital_be_set[sym] = True
                logger.info(
                    "Capital-BE from candle: %s %s | candle peak ROE %.1f%% >= %.1f%%",
                    sym, side, best_roe, capital_threshold,
                )
        except Exception as cbe_candle_err:
            logger.debug("Candle capital-BE failed for %s: %s", sym, cbe_candle_err)
```

**Note:** This is a lightweight check — it only runs when a candle correction already found a new peak. No additional API calls for price data.

---

## Testing Requirements

### Test File: `tests/unit/test_breakeven_fix.py`

The test file MUST contain all of the following test classes and methods. Use the existing project test patterns (see Prerequisites — Test Files).

### Static Tests (Source Code Validation)

These tests read daemon.py source code to verify structural correctness.

```
class TestCapitalBreakevenExists:
    test_capital_be_set_dict_initialized()
        # Verify self._capital_be_set appears in __init__

    test_capital_be_config_fields_exist()
        # Verify DaemonConfig has capital_breakeven_enabled and capital_breakeven_roe

    test_yaml_defaults_match_python()
        # Load default.yaml, verify capital_breakeven_enabled and capital_breakeven_roe match DaemonConfig defaults

    test_capital_be_block_exists_in_fast_trigger_check()
        # Read daemon.py source, verify "capital_breakeven" appears in _fast_trigger_check

    test_capital_be_runs_before_fee_be()
        # Read daemon.py source, verify capital-BE block appears BEFORE fee-BE block
        # (capital-BE has lower threshold, must set first)

    test_no_wake_agent_in_breakeven_blocks()
        # Read daemon.py source, verify _wake_agent does NOT appear between
        # the "capital_breakeven" and "Trailing Stop" comments
        # This confirms Bug B is fixed

    test_refresh_trigger_cache_after_be_placement()
        # Read daemon.py source, verify _refresh_trigger_cache() appears
        # after every place_trigger_order call in both BE blocks
        # This confirms Bug A is fixed
```

### Formula Tests (Pure Math Validation)

```
class TestCapitalBreakevenFormula:
    test_long_sl_at_entry_price()
        # For a long at $100, capital-BE SL should be exactly $100

    test_short_sl_at_entry_price()
        # For a short at $100, capital-BE SL should be exactly $100

    test_capital_be_threshold_is_fixed_roe()
        # Verify threshold is config value (0.5%), NOT fee-proportional
        # At 20x: capital_be = 0.5%, fee_be = 1.4% → capital < fee
        # At 10x: capital_be = 0.5%, fee_be = 0.7% → capital < fee
        # At 5x:  capital_be = 0.5%, fee_be = 0.35% → capital > fee (capital-BE inactive, fee-BE sufficient)

    test_fee_be_sl_tighter_than_capital_be_for_long()
        # entry=100, buffer=0.07%
        # capital-BE SL = $100.00, fee-BE SL = $100.07
        # For a long, $100.07 > $100.00 → fee-BE is tighter ✓

    test_fee_be_sl_tighter_than_capital_be_for_short()
        # entry=100, buffer=0.07%
        # capital-BE SL = $100.00, fee-BE SL = $99.93
        # For a short, $99.93 < $100.00 → fee-BE is tighter ✓

    test_worst_case_loss_at_capital_be()
        # At 20x, exit fee = 0.035% * 20 = 0.7% ROE
        # If capital-BE SL fires at entry price, loss = -0.7% ROE (exit fee only)
        # Verify this is much better than original SL (e.g., -5.69%)
```

### Logic Tests (State Machine Validation)

```
class TestTwoLayerProgression:
    test_capital_be_sets_before_fee_be()
        # Simulate: ROE goes from 0 → 0.5% → 1.4%
        # At 0.5%: _capital_be_set = True, _breakeven_set = False
        # At 1.4%: _capital_be_set = True, _breakeven_set = True

    test_fee_be_also_sets_capital_be_flag()
        # If ROE jumps directly past fee_be_roe (e.g., 0% → 2%),
        # BOTH _capital_be_set and _breakeven_set should be True

    test_capital_be_skips_if_fee_be_already_set()
        # If _breakeven_set is True, capital-BE block should skip
        # (fee-BE SL is already tighter than capital-BE SL)

    test_neither_layer_fires_below_threshold()
        # ROE = 0.3% (below 0.5% capital-BE threshold)
        # Both flags remain False

    test_capital_be_fires_fee_be_does_not()
        # ROE = 0.8% at 20x leverage
        # capital_be_roe = 0.5% → fires
        # fee_be_roe = 1.4% → does not fire
        # _capital_be_set = True, _breakeven_set = False

    test_side_flip_resets_both_flags()
        # Open long, set capital-BE
        # Close long, open short on same coin
        # Both _capital_be_set and _breakeven_set should be cleared

    test_position_close_cleans_both_flags()
        # Open position, set both flags
        # Close position
        # Verify both flags cleaned from dicts
```

### Classification Tests

```
class TestCapitalBreakevenClassification:
    test_override_returns_capital_breakeven_stop()
        # _capital_be_set = True, _breakeven_set = False, _trailing_active = False
        # classification = "stop_loss" → "capital_breakeven_stop"

    test_fee_be_takes_precedence_over_capital_be()
        # _capital_be_set = True, _breakeven_set = True
        # classification = "stop_loss" → "breakeven_stop" (not capital_breakeven_stop)

    test_trailing_takes_precedence_over_both()
        # _capital_be_set = True, _breakeven_set = True, _trailing_active = True
        # classification = "stop_loss" → "trailing_stop"

    test_classification_for_tp_unchanged()
        # classification = "take_profit" → unchanged regardless of BE flags

    test_classification_for_liquidation_unchanged()
        # classification = "liquidation" → unchanged regardless of BE flags
```

### Rollback Tests

```
class TestCancelReplaceRollback:
    test_old_sl_restored_on_placement_failure()
        # Simulate: cancel succeeds, place_trigger_order raises exception
        # Verify old SL is restored via rollback

    test_no_rollback_when_no_previous_sl()
        # If no existing SL, placement failure just logs warning (no rollback needed)

    test_rollback_failure_logs_critical()
        # If both placement AND rollback fail, verify CRITICAL log emitted
```

### Integration Tests (Paper Provider)

```
class TestPaperProviderBreakevenIntegration:
    test_capital_be_sl_actually_triggers()
        # 1. Create PaperProvider with a long position at entry=$100
        # 2. Place capital-BE SL at $100 via place_trigger_order
        # 3. Call check_triggers with price=$99.50 (below SL)
        # 4. Verify event returned with classification="stop_loss"
        # 5. Verify exit_px = $100 (SL price, not market price)

    test_fee_be_sl_replaces_capital_be_sl()
        # 1. Create position, place capital-BE SL at $100
        # 2. Cancel capital-BE SL, place fee-BE SL at $100.07
        # 3. Verify pos.sl_px = $100.07 (tighter)
        # 4. Check triggers at $100.05 (between old and new SL)
        # 5. Verify NO trigger (price is above new SL)

    test_check_triggers_uses_sl_price_not_market()
        # Verify paper provider fills at sl_px, not at the passed-in price
        # This is critical: even if daemon was frozen for 30s and price
        # gapped through the SL, the fill is at SL price in paper mode

    test_cancel_order_with_wrong_oid_returns_false()
        # Cancel with non-matching OID should return False, not raise

    test_cancel_then_place_is_atomic_in_paper()
        # In paper mode, cancel sets sl_px=None, place sets sl_px=new
        # Verify no race condition (paper uses threading lock)
```

### Candle Peak Re-evaluation Test

```
class TestCandlePeakBreakevenReevaluation:
    test_candle_peak_triggers_capital_be()
        # Simulate: candle shows best_roe=0.8%, current _peak_roe=0.3%
        # After _update_peaks_from_candles, _capital_be_set should be True

    test_candle_peak_does_not_trigger_if_already_set()
        # _capital_be_set already True → no duplicate placement

    test_candle_peak_does_not_trigger_fee_be()
        # Candle correction should NOT trigger fee-breakeven
        # (fee-BE requires sustained price above threshold, not just a wick)
```

### Edge Case Tests

```
class TestBreakevenEdgeCases:
    test_low_leverage_capital_be_above_fee_be()
        # At 5x leverage: fee_be_roe = 0.35%, capital_be_roe = 0.5%
        # Capital-BE threshold is HIGHER than fee-BE threshold
        # In this case, fee-BE fires first and sets _breakeven_set = True
        # Capital-BE block sees _breakeven_set = True → skips (correct)

    test_multiple_positions_independent()
        # Two positions: BTC long and SOL short
        # Capital-BE on BTC should not affect SOL state

    test_breakeven_disabled_via_config()
        # breakeven_stop_enabled = False → fee-BE block skipped entirely
        # capital_breakeven_enabled = False → capital-BE block skipped entirely

    test_zero_size_position_skipped()
        # pos.get("size", 0) = 0 → place_trigger_order would place 0-size order
        # Verify this case is handled (skip or error)
```

---

## Running Tests

```bash
cd /Users/bauthoi/Documents/Hynous
PYTHONPATH=src pytest tests/unit/test_breakeven_fix.py -v

# Also run ALL existing mechanical exit tests to verify no regressions:
PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py -v
PYTHONPATH=src pytest tests/unit/test_exit_classification.py -v
PYTHONPATH=src pytest tests/unit/test_cancel_before_place.py -v
PYTHONPATH=src pytest tests/unit/test_stale_trigger_cache_fix.py -v
PYTHONPATH=src pytest tests/unit/test_candle_peak_tracking.py -v
PYTHONPATH=src pytest tests/unit/test_stale_cache_fix.py -v
PYTHONPATH=src pytest tests/unit/test_ws_price_feed.py -v
PYTHONPATH=src pytest tests/unit/test_429_resilience.py -v
PYTHONPATH=src pytest tests/unit/test_recent_trades.py -v
```

**All existing tests MUST pass.** If any fail, the implementation has a regression.

---

## Verification Checklist

After implementation, the engineer agent must verify:

### Code Verification

- [ ] `_capital_be_set` dict initialized in `__init__` alongside other state dicts
- [ ] `capital_breakeven_enabled` and `capital_breakeven_roe` in DaemonConfig with correct defaults
- [ ] YAML defaults match Python defaults exactly
- [ ] Capital-BE block appears BEFORE fee-BE block in `_fast_trigger_check()`
- [ ] No `_wake_agent()` call in either breakeven block
- [ ] `_refresh_trigger_cache()` called after EVERY `place_trigger_order()` in both BE blocks
- [ ] Rollback try-except wraps every cancel-then-place sequence
- [ ] `_override_sl_classification()` handles `capital_breakeven_stop`
- [ ] Side-flip cleanup pops `_capital_be_set`
- [ ] Position-close cleanup deletes `_capital_be_set` entries
- [ ] Fee-BE block sets `_capital_be_set[sym] = True` when it fires (since fee-BE is tighter)
- [ ] Capital-BE block skips when `_breakeven_set` is already True
- [ ] Candle peak tracking re-evaluates capital-BE (NOT fee-BE)

### Math Verification

- [ ] At 20x: capital_be = 0.5% < fee_be = 1.4% ✓
- [ ] At 15x: capital_be = 0.5% < fee_be = 1.05% ✓
- [ ] At 10x: capital_be = 0.5% < fee_be = 0.70% ✓
- [ ] At 5x: capital_be = 0.5% > fee_be = 0.35% → fee-BE fires first, capital-BE skips ✓
- [ ] Long capital-BE SL = entry (no buffer) ✓
- [ ] Short capital-BE SL = entry (no buffer) ✓
- [ ] Long fee-BE SL = entry × 1.0007 ✓
- [ ] Short fee-BE SL = entry × 0.9993 ✓

### Regression Verification

- [ ] All 9 existing test files pass (see Running Tests section)
- [ ] Trailing stop logic unchanged (Phase 1/2/3)
- [ ] Small wins logic unchanged
- [ ] Stop-tightening lockout still protects both BE layers
- [ ] Paper provider `check_triggers()` evaluates both capital-BE and fee-BE SLs correctly
- [ ] `_record_trigger_close()` stores new classification in Nous correctly

---

## Design Decisions

### Why fixed ROE threshold for capital-BE (not fee-proportional)?

The fee-BE threshold scales with leverage: 1.4% at 20x, 0.7% at 10x. If capital-BE also scaled, it would be too close to fee-BE at high leverage (where protection matters most). A fixed 0.5% ensures capital-BE is always reachable regardless of leverage.

### Why no agent wake for either breakeven layer?

The agent doesn't need to "acknowledge" breakeven. It's a mechanical safety system. Waking the agent:
1. Blocks the trigger check loop for 5-30 seconds
2. Gives the agent an opportunity to override/close the position
3. Consumes LLM tokens for no actionable purpose

The agent can see breakeven status in its next scheduled briefing (position block shows current ROE and peak).

### Why rollback instead of atomic cancel-replace?

Paper provider doesn't support atomic operations. Hyperliquid exchange also doesn't have atomic cancel-replace for trigger orders. The rollback pattern is the safest approach: try new, restore old on failure.

### Why does fee-BE also set `_capital_be_set = True`?

If fee-BE fires (ROE crossed the higher threshold), the fee-BE SL is strictly tighter than capital-BE SL. There's no need for capital-BE to re-evaluate. Setting both flags prevents redundant checks on subsequent loop iterations.

### Why does candle peak re-evaluation only trigger capital-BE?

Fee-breakeven requires sustained price above the threshold (the 1s live loop catches this). A sub-second wick captured by candles is too volatile for fee-BE — the price was above the threshold for less than a second. But capital-BE is a safety net: if the trade was ever directionally correct enough to cross 0.5% ROE (even briefly), it deserves entry-price protection.

---

## Implementation Status (2026-03-11)

### Completed

All 8 code changes from the implementation guide have been implemented:

1. **Config fields** — `capital_breakeven_enabled`, `capital_breakeven_roe` in `DaemonConfig` + `default.yaml`
2. **State dictionary** — `_capital_be_set` initialized in `__init__`
3. **Two-layer breakeven block** — Capital-BE (0.5% threshold, SL at entry) + Fee-BE (fee-proportional, SL at entry + buffer). Both fully mechanical (no `_wake_agent()`), with `_refresh_trigger_cache()` after placement, and rollback on failure.
4. **SL classification** — `_override_sl_classification()` handles `capital_breakeven_stop`
5. **State cleanup** — Side-flip and position-close cleanup both handle `_capital_be_set`
6. **Event eviction** — No change needed (existing cleanup handles it)
7. **Trigger close classification** — Flows through automatically
8. **Candle peak re-evaluation** — `_update_peaks_from_candles()` triggers capital-BE when candle peak crosses threshold

All 3 bundled bug fixes applied:
- **Bug A:** `_refresh_trigger_cache()` added after every SL placement in both BE blocks
- **Bug B:** No `_wake_agent()` in either breakeven block (fully mechanical)
- **Bug C:** Rollback try-except wraps every cancel-then-place sequence

Tests: `tests/unit/test_breakeven_fix.py` created with test coverage.

### State Persistence — FIXED in Round 2

State persistence was the primary vulnerability identified after Round 1. **Fixed by Round 2 bugs B–F.**

`_persist_mechanical_state()` writes `_peak_roe`, `_trailing_active`, `_trailing_stop_px` to `storage/mechanical_state.json`. `_load_mechanical_state()` restores on startup filtered by open positions.

Round 2 added `_persist_mechanical_state()` calls at every state transition:
- **Bug B** — after position-close eviction (clears closed coin state, persists immediately)
- **Bug C** — after side-flip cleanup (persist before marking new side)
- **Bug D** — after stale trailing cleanup loop (conditional persist)
- **Bug E** — after `_update_peaks_from_candles()` peak update
- **Bug F** — after Phase 3 success pop block

**Remaining notes:**
- `_breakeven_set` and `_capital_be_set` are NOT persisted to disk — but the "has_tighter_sl" check in both BE blocks prevents SL degradation on restart (the existing SL at entry price is already tighter than a re-evaluation would place)
- `_trailing_stop_px` IS persisted — the restart-safe trailing vulnerability (cancelling +5% SL and replacing with +1.4%) is now fixed

### Trailing Stop v3 — Continuous Exponential Retracement (2026-03-18)

The ML-adaptive trailing stop v2 (tiered retracement + vol modifier) described in `ml-adaptive-trailing-stop.md` has been **superseded by v3** (continuous exponential retracement). The 3-tier if/elif/else + multiplicative vol modifier has been replaced by a single exponential function `r(p) = 0.20 + 0.30 × exp(-k × p)` where k varies by vol regime (extreme=0.160, high=0.100, normal=0.080, low=0.040). See `docs/revisions/trailing-stop-fix/` for the current design and calibration results.

### Dynamic Protective SL — Replaces Capital-BE (2026-03-17)

Capital-BE (Layer 1) was deprecated and replaced by the **Dynamic Protective SL** — a vol-regime-calibrated stop placed immediately at entry detection (no ROE threshold). See `dynamic-protective-sl.md` for the full specification.

**What changed:**
- `capital_breakeven_enabled: false` in `config/default.yaml`
- New `dynamic_sl_enabled: true` controls the replacement layer
- Layer progression is now: **Dynamic SL → Fee-BE → Trailing Stop**
- `_dynamic_sl_set` state dict added alongside `_capital_be_set` (which is kept for rollback)
- Capital-BE code preserved in daemon.py, guarded by `config.daemon.capital_breakeven_enabled` (now False)
- Classification `"dynamic_protective_sl"` replaces `"capital_breakeven_stop"` in the precedence chain

### Next Steps

1. **Monitor paper trades** — Validate dynamic SL distances, confirm trail capture rate improvement vs capital-BE.
2. **Live trading** — Once paper validation is complete, flip `execution.mode` to `live_confirm`.

---

Last updated: 2026-03-17
