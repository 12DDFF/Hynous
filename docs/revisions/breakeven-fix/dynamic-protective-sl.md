# Dynamic Protective Stop-Loss — Implementation Guide

> Replaces the capital-breakeven layer (Layer 1) with a volatility-regime-calibrated
> protective stop that gives trades room to breathe through normal noise while still
> capping downside before the trailing stop activates.

**Status:** Implemented 2026-03-17
**Author:** Architect (Claude)
**Date:** 2026-03-17

---

## Table of Contents

1. [Required Reading](#1-required-reading)
2. [Motivation & Problem Statement](#2-motivation--problem-statement)
3. [Design Specification](#3-design-specification)
4. [Evidence & Calibration](#4-evidence--calibration)
5. [Implementation Steps](#5-implementation-steps)
6. [Test Specifications](#6-test-specifications)
7. [System Integration Verification](#7-system-integration-verification)
8. [Rollback Plan](#8-rollback-plan)

---

## 1. Required Reading

Before implementing, read these files **in order**. Do not skip any — each builds
context for the next.

### Documentation (understand the system)

| File | Purpose |
|------|---------|
| `docs/revisions/breakeven-fix/README.md` | Two-layer breakeven design, Round 1-3 history, state persistence |
| `docs/revisions/breakeven-fix/ml-adaptive-trailing-stop.md` | ML-adaptive trailing stop v2 (vol-regime activation, tiered retracement, agent exit lockout) — the dynamic SL follows the same vol-regime pattern |
| `docs/revisions/breakeven-fix/mechanical-exit-fixes-2.md` | Round 2 bugs A-I (state persistence). Same patterns apply to the new dynamic SL |
| `docs/integration.md` | Cross-system data flows (satellite → daemon → briefing) |

### Source Code (understand what you're modifying)

| File | Lines | What to study |
|------|-------|---------------|
| `src/hynous/intelligence/daemon.py` | 341-349 | State dicts (`_capital_be_set`, `_breakeven_set`, etc.) |
| `src/hynous/intelligence/daemon.py` | 2054-2595 | `_fast_trigger_check()` — the entire method, focus on the capital-BE block (2161-2233), fee-BE block (2237-2316), and trailing block (2322-2536) |
| `src/hynous/intelligence/daemon.py` | 2606-2756 | `_update_peaks_from_candles()` — capital-BE re-evaluation at 2685-2747 |
| `src/hynous/intelligence/daemon.py` | 3179-3197 | `_override_sl_classification()` — exit type labeling |
| `src/hynous/intelligence/daemon.py` | 3351-3366 | Side-flip cleanup (pops `_capital_be_set`) |
| `src/hynous/intelligence/daemon.py` | 3409-3449 | Position-close cleanup (cleans `_capital_be_set`) |
| `src/hynous/intelligence/daemon.py` | 2113-2120 | Event-based eviction (pops `_capital_be_set` on trigger close) |
| `src/hynous/intelligence/daemon.py` | 4596-4658 | `_persist_mechanical_state()` and `_load_mechanical_state()` |
| `src/hynous/intelligence/daemon.py` | 692 | `_latest_predictions` declaration |
| `src/hynous/intelligence/daemon.py` | 2330-2338 | Vol regime resolution for trailing stop (we reuse this exact pattern) |
| `src/hynous/core/config.py` | 94-136 | `DaemonConfig` — fields at 129-130 (`capital_breakeven_enabled`, `capital_breakeven_roe`) |
| `src/hynous/core/config.py` | 314-338 | `load_config()` — DaemonConfig field wiring at 333-334 |
| `config/default.yaml` | 53-78 | daemon config section — capital-BE at 56-57, trailing at 59-78 |
| `src/hynous/core/trading_settings.py` | 26-151 | `TradingSettings` — trailing fields at 98-124 |
| `src/hynous/intelligence/prompts/builder.py` | 159-177 | MECHANICAL EXIT SYSTEM section of the agent system prompt |

### Test Files (understand the test patterns)

| File | Purpose |
|------|---------|
| `tests/unit/test_breakeven_fix.py` | Two-layer breakeven tests — **your new tests must follow these exact patterns** |
| `tests/unit/test_ml_adaptive_trailing.py` | ML-adaptive trailing tests — **your dynamic SL tests should mirror these** |
| `tests/unit/test_mechanical_exits.py` | Mechanical exit formula tests |

---

## 2. Motivation & Problem Statement

### The Problem: Capital-Breakeven Causes Chronic Fee Bleed

The current capital-breakeven (Layer 1) activates at 0.5% ROE and places SL at entry
price. At 20x leverage:

- 0.5% ROE = **0.025% price move** — BTC moves this in seconds
- SL at entry = **0% effective distance** — any noise triggers it
- Per-fire cost: **~0.7% ROE** (round-trip taker fees)
- Fire rate: **~80-90%** of trades that briefly go positive

This means most trades that show any directional correctness get immediately stopped
at entry, costing 0.7% ROE each time. Over 100 such trades: **~60% cumulative ROE
bleed** with almost zero trades ever reaching trailing stop activation.

### The Solution: Vol-Regime Calibrated Protective Stop

Replace the capital-BE's fixed 0.5% ROE trigger / 0% SL distance with a dynamic
stop placed at entry detection, using a wider, market-condition-aware distance. The
stop gives trades room to breathe through normal adverse excursions while capping
downside before the trailing stop activates.

### Layer Progression (unchanged architecture)

```
[Entry] → Dynamic Protective SL (placed immediately, vol-regime distance below entry)
              ↓  fee-BE threshold reached (~1.4% ROE at 20x)
          Fee-Breakeven SL (tightens to entry + buffer, ~$0 net)
              ↓  trailing threshold reached (1.5-3.0% ROE, vol-adaptive)
          Trailing Stop (locks in profit, ratchets up)
```

Each layer only **tightens** the SL. The dynamic SL is the widest protection layer.
Fee-BE overrides it when its threshold is reached. Trailing overrides fee-BE.

---

## 3. Design Specification

### 3.1 SL Distance Values

| Vol Regime | SL Distance (ROE %) | Price Distance (at 20x) | Max Loss (SL + fees) |
|------------|---------------------|-------------------------|----------------------|
| Low        | 2.5%                | 0.125%                  | 3.9%                 |
| Normal     | 7.0%                | 0.35%                   | 8.4%                 |
| High       | 8.0%                | 0.40%                   | 9.4%                 |
| Extreme    | 3.0%                | 0.15%                   | 4.4%                 |

**Floor:** 1.5% ROE — below this the SL is within fee-BE territory and meaningless.

**Cap:** 10.0% ROE — maximum acceptable single-trade risk.

These values are stored in `TradingSettings` (runtime-adjustable) and mirrored as
defaults in `config/default.yaml`.

### 3.2 Vol Regime Resolution

Use the **exact same pattern** as the trailing stop (daemon.py lines 2330-2338):

```python
_vol_regime = "normal"  # default fallback
_pred = self._latest_predictions.get("BTC", {})
_cond = _pred.get("conditions", {})
if _cond:
    _cond_ts = _cond.get("timestamp", 0)
    if time.time() - _cond_ts < 330:  # <330s = fresh
        _vol_regime = _cond.get("vol_1h", {}).get("regime", "normal")
```

If predictions are stale (>330s) or unavailable, fall back to "normal" regime.

### 3.3 SL Price Computation

```python
ts = get_trading_settings()

# 1. Resolve vol regime → SL distance in ROE %
_sl_map = {
    "extreme": ts.dynamic_sl_extreme_vol,   # 3.0
    "high":    ts.dynamic_sl_high_vol,       # 8.0
    "normal":  ts.dynamic_sl_normal_vol,     # 7.0
    "low":     ts.dynamic_sl_low_vol,        # 2.5
}
sl_roe = _sl_map.get(_vol_regime, ts.dynamic_sl_normal_vol)

# 2. Clamp to floor/cap
sl_roe = max(sl_roe, ts.dynamic_sl_floor)   # 1.5
sl_roe = min(sl_roe, ts.dynamic_sl_cap)     # 10.0

# 3. Convert ROE % → price distance → SL price
sl_price_pct = sl_roe / leverage / 100.0
if side == "long":
    sl_px = entry_px * (1.0 - sl_price_pct)
else:  # short
    sl_px = entry_px * (1.0 + sl_price_pct)
```

### 3.4 Activation Timing

The dynamic SL is placed **immediately when a new position is detected** in
`_fast_trigger_check()`. No ROE threshold is required — the stop exists from the
moment the daemon sees the position.

Detection mechanism: the daemon already detects new positions via the
`_prev_positions` diff in `_fast_trigger_check()`. When a coin appears in the
current position set but not in `_prev_positions`, a new position was opened.

### 3.5 State Management

**New state dict:**
```python
self._dynamic_sl_set: dict[str, bool] = {}  # True once dynamic SL placed
```

**Cleanup:** Pop from `_dynamic_sl_set` in all existing cleanup paths:
- Event-based eviction (line ~2118)
- Side-flip cleanup (line ~3355)
- Position-close cleanup (line ~3424)

**Persistence:** `_dynamic_sl_set` does NOT need to persist to
`mechanical_state.json`. On daemon restart, the SL order already exists on the
exchange (or paper provider). The "has tighter SL" check (same pattern as
capital-BE) prevents re-placement at a wider distance than the existing SL.

### 3.6 Interaction with Existing Layers

**Fee-BE override:** When fee-BE fires (ROE >= fee threshold), it places SL at
entry + buffer. This is strictly tighter than the dynamic SL (which is below
entry). Fee-BE already sets `_capital_be_set[sym] = True` (line 2290) and
`_breakeven_set[sym] = True` (line 2288). We add: also set
`_dynamic_sl_set[sym] = True` to prevent re-evaluation.

**Trailing override:** When trailing activates, it manages SL independently.
The dynamic SL is superseded. Trailing already handles all SL management once
active.

**Agent SL tightening:** The existing tightening lockout (in `trading.py`)
prevents the agent from widening daemon-set SLs. The dynamic SL is a daemon-set
SL, so the agent can only tighten it. This is correct behavior.

### 3.7 Classification

Add a new exit classification: `"dynamic_protective_sl"`.

In `_override_sl_classification()` (line 3179), add a check for
`_dynamic_sl_set[coin]` **after** trailing and breakeven checks but **before**
the fallthrough to generic `"stop_loss"`:

```
Precedence: trailing_stop > breakeven_stop > dynamic_protective_sl > stop_loss
```

Note: `capital_breakeven_stop` is removed since capital-BE no longer exists.

---

## 4. Evidence & Calibration

### 4.1 Data Source

All calibration data comes from the project's own satellite database
(`storage/satellite.db`): **166,750 labeled snapshots** across BTC/ETH/SOL from
August 2025 to March 2026. Labels include 30-minute forward-looking MAE (maximum
adverse excursion) at 20x leverage.

### 4.2 MAE Distribution by Vol Regime

The `realized_vol_1h` feature (from `satellite/features.py`) was used to bucket
snapshots into 4 regimes using the same percentile thresholds as the condition
engine (`satellite/conditions.py` lines 196-204):

| Vol Regime | Vol Range | N Snapshots | Median MAE | p75 MAE | p90 MAE |
|------------|-----------|-------------|-----------|---------|---------|
| Low        | < 0.33%   | 41,509      | 2.0%      | 3.9%    | 6.5%    |
| Normal     | 0.33-0.73%| 83,110      | 4.3%      | 8.0%    | 13.0%   |
| High       | 0.73-1.05%| 24,960      | 6.9%      | 12.7%   | 20.0%   |
| Extreme    | > 1.05%   | 16,794      | 10.2%     | 18.7%   | 20.0%   |

MAE is the worst drawdown from entry within a 30-minute window, in ROE % at 20x.
Normal vol accounts for 50% of all data.

### 4.3 Expected Value Analysis

A full EV sweep was run across SL distances 1-10% (in 0.5% increments) for each
vol regime, using the trailing stop's actual activation thresholds (low=3.0%,
normal=2.5%, high=2.0%, extreme=1.5%) and retracement parameters (tier 1 = 45%
giveback, keep 55% of peak) as the profit model.

**Key finding: the optimal direction splits by regime.**

| Regime  | EV Direction        | Best EV Region | Why |
|---------|---------------------|----------------|-----|
| Low     | Tighter is better   | 1-2% SL        | Low vol doesn't generate enough movement to reach trailing activation. Wider SLs create zombie trades below fee-BE. |
| Normal  | Wider is better     | 7-10%+ SL      | Each 1% of extra room converts ~3K stops into trail captures. Trail system averages +3.1% net per capture. |
| High    | Wider is better     | 7-10%+ SL      | Binary outcome (stop or trail). 97.6% of survivors reach trailing. Near-zero zombie trades. |
| Extreme | Tighter is better   | 1-3% SL        | Even 10% SL gets hit 51% of the time. Per-stop cost is catastrophic. Tight SL minimizes damage. |

### 4.4 Value Derivation

**Low vol (2.5% ROE):**
- EV-optimal is ~1%, but 1% ROE at 20x = 0.05% price = $50 on BTC. This is
  within the bid-ask spread and practically unexecutable.
- 2.5% = 0.125% price ≈ $125 on BTC. Minimum practically executable distance.
- Sits between p25 (1.6%) and median (2.0%) of MAE distribution — covers most
  normal noise with small buffer.
- Unconditional survival: ~55%. With agent directional edge (estimated +15pp
  from quality-conditioned data): ~70%.

**Normal vol (7.0% ROE):**
- EV improves +0.08 per 1% from 5-8%, then diminishes to +0.05 from 8-10%.
  7.0% captures most of the improvement while keeping the zombie-trade bucket
  at 6.7% (vs 11.5% at 10%).
- Trail rate: 56% unconditional, estimated ~70% with agent edge.
- 86% of survivors reach trailing activation at 2.5% ROE.
- Per-stop cost 8.4% ROE — acceptable given the user's explicit preference for
  fewer premature stops over lower per-stop cost.
- The 30-minute EV analysis understates actual trailing profit because real
  trades run longer than 30 minutes.

**High vol (8.0% ROE):**
- Same pattern as normal vol but one tier wider. The binary outcome pattern
  (stop or trail, <3% zombie) means the zombie-trade concern barely applies.
- 54.3% trail rate. 97.6% of survivors reach trailing.
- Per-stop cost 9.4% ROE.
- At 20x: 0.4% price distance. BTC moves this in 1-2 minutes during high vol.

**Extreme vol (3.0% ROE):**
- EV strongly favors tight (optimal at ~1%). Every 1% of width costs ~0.15 EV
  because extreme vol MAE is enormous (median 10.2%).
- 3.0% = 0.15% price ≈ $150 on BTC. Minimum reliably executable distance.
- 17.4% unconditional survival, but of survivors, 99.4% reach trailing at
  +5.36% average net. Extreme vol moves fast — survivors win big.
- Trailing activates at only 1.5% ROE in extreme vol, so trades that survive
  reach it quickly.

### 4.5 Risk-Reward Verification

At 20x leverage with maximum conviction (30% margin on $10K portfolio = $3K margin):

| Regime  | SL (ROE %) | Price Distance | Dollar Risk | Portfolio Risk |
|---------|-----------|----------------|-------------|----------------|
| Low     | 2.5%      | 0.125%         | $75         | 0.75%          |
| Normal  | 7.0%      | 0.35%          | $210        | 2.1%           |
| High    | 8.0%      | 0.40%          | $240        | 2.4%           |
| Extreme | 3.0%      | 0.15%          | $90         | 0.9%           |

All values are well under the `portfolio_risk_cap_warn` (5%) and
`portfolio_risk_cap_reject` (10%) in `trading_settings.py` lines 49-50. **No
position sizing changes are required.**

### 4.6 Academic Support

- **Sweeney's MAE Framework (1997):** Set SL at 75-80% survival of winning
  trade MAE distribution. Our quality-conditioned data shows 5% SL survives ~69%
  of good trades, 7% survives ~75% — aligned with this recommendation.
- **Kaminski & Lo (MIT, 2014):** Stop-losses add value when momentum is present
  (our agent provides directional signals) but destroy value at very short
  sampling frequencies. Our 1s evaluation loop checks the SL but the SL itself
  is calibrated to 30-minute market structure.
- **Dai, Marshall et al. (2021):** Wider stop-loss thresholds remain beneficial
  after transaction costs; tighter ones lose their edge to fees. Directly
  validates replacing the 0% capital-BE with a wider stop.
- **Baviera & Santagostino Baldi (2019):** SL and leverage must be jointly
  optimized. Our vol-adaptive leverage (in `trading.py`) already caps leverage
  in high/extreme vol, complementing the wider SL in those regimes.

---

## 5. Implementation Steps

### Step 1: Add TradingSettings Fields

**File:** `src/hynous/core/trading_settings.py`

After the trailing stop fields (line ~124), add a new section:

```python
    # --- Dynamic Protective SL (replaces capital-breakeven) ---
    dynamic_sl_enabled: bool = True
    dynamic_sl_low_vol: float = 2.5       # ROE % SL distance in low vol
    dynamic_sl_normal_vol: float = 7.0    # ROE % SL distance in normal vol
    dynamic_sl_high_vol: float = 8.0      # ROE % SL distance in high vol
    dynamic_sl_extreme_vol: float = 3.0   # ROE % SL distance in extreme vol
    dynamic_sl_floor: float = 1.5         # minimum SL distance (ROE %)
    dynamic_sl_cap: float = 10.0          # maximum SL distance (ROE %)
```

These are `TradingSettings` fields (runtime-adjustable via Settings page / JSON),
following the same pattern as `trail_activation_extreme` etc.

**Verification:** Run `python -c "from hynous.core.trading_settings import TradingSettings; ts = TradingSettings(); print(ts.dynamic_sl_normal_vol)"` — should print `7.0`.

### Step 2: Add Config Fields

**File:** `src/hynous/core/config.py`

In the `DaemonConfig` dataclass (line 94), **change** the existing capital-breakeven
fields:

```python
    # Replace:
    #   capital_breakeven_enabled: bool = True
    #   capital_breakeven_roe: float = 0.5
    # With:
    dynamic_sl_enabled: bool = True
```

Keep `capital_breakeven_enabled` and `capital_breakeven_roe` in the dataclass but
set defaults to `False` and `0.5` respectively, for backwards compatibility during
transition. They become dead config.

```python
    capital_breakeven_enabled: bool = False   # DEPRECATED — replaced by dynamic_sl_enabled
    capital_breakeven_roe: float = 0.5        # DEPRECATED — kept for config compat
    dynamic_sl_enabled: bool = True           # NEW — master switch for dynamic protective SL
```

**File:** `src/hynous/core/config.py` — `load_config()` (line ~333)

Add wiring for the new field:

```python
    dynamic_sl_enabled=daemon_raw.get("dynamic_sl_enabled", True),
```

Keep the existing `capital_breakeven_enabled` wiring but it will now default to
`False` in both YAML and Python.

**File:** `config/default.yaml`

In the daemon section (line ~56), replace:

```yaml
    # Replace:
    #   capital_breakeven_enabled: true
    #   capital_breakeven_roe: 0.5
    # With:
    capital_breakeven_enabled: false    # DEPRECATED — replaced by dynamic_sl
    capital_breakeven_roe: 0.5         # DEPRECATED
    dynamic_sl_enabled: true           # Dynamic protective SL (replaces capital-BE)
```

The `TradingSettings` fields (`dynamic_sl_low_vol`, etc.) do NOT need YAML
entries — they're loaded from `trading_settings.json` at runtime, with defaults
from the dataclass.

### Step 3: Add State Dict

**File:** `src/hynous/intelligence/daemon.py`

At line 345 (after `self._capital_be_set`), add:

```python
        self._dynamic_sl_set: dict[str, bool] = {}   # True once dynamic protective SL placed
```

### Step 4: Replace Capital-BE Block in `_fast_trigger_check()`

**File:** `src/hynous/intelligence/daemon.py`

**Remove** the entire capital-breakeven block (lines 2161-2233). Replace it with
the dynamic protective SL block. The new block must be placed **at the same
position** (before the fee-BE block) and use the same error handling patterns.

**New block (replaces lines 2161-2233):**

```python
                # ── Dynamic Protective SL (replaces capital-breakeven) ────────
                # Placed immediately on position detection. Vol-regime-calibrated
                # distance below entry. Fee-BE will tighten later if ROE rises.
                ts = get_trading_settings()
                if (
                    ts.dynamic_sl_enabled
                    and self.config.daemon.dynamic_sl_enabled
                    and not self._dynamic_sl_set.get(sym)
                    and not self._breakeven_set.get(sym)
                ):
                    try:
                        # ── Resolve vol regime (same pattern as trailing) ──
                        _vol_regime = "normal"
                        _pred = self._latest_predictions.get("BTC", {})
                        _cond = _pred.get("conditions", {})
                        if _cond:
                            _cond_ts = _cond.get("timestamp", 0)
                            if time.time() - _cond_ts < 330:
                                _vol_regime = _cond.get("vol_1h", {}).get("regime", "normal")

                        # ── Map regime → SL distance (ROE %) ──
                        _sl_map = {
                            "extreme": ts.dynamic_sl_extreme_vol,
                            "high":    ts.dynamic_sl_high_vol,
                            "normal":  ts.dynamic_sl_normal_vol,
                            "low":     ts.dynamic_sl_low_vol,
                        }
                        sl_roe = _sl_map.get(_vol_regime, ts.dynamic_sl_normal_vol)
                        sl_roe = max(sl_roe, ts.dynamic_sl_floor)
                        sl_roe = min(sl_roe, ts.dynamic_sl_cap)

                        # ── Convert to price ──
                        sl_price_pct = sl_roe / leverage / 100.0
                        if side == "long":
                            sl_px = entry_px * (1.0 - sl_price_pct)
                        else:
                            sl_px = entry_px * (1.0 + sl_price_pct)

                        # ── Check if existing SL is already tighter ──
                        existing_sl = None
                        for t in self._tracked_triggers.get(sym, []):
                            if t.get("order_type") == "stop_loss":
                                existing_sl = t
                                break

                        already_tighter = False
                        if existing_sl:
                            tpx = existing_sl.get("trigger_px", 0)
                            if side == "long" and tpx > 0:
                                already_tighter = tpx >= sl_px  # existing is closer to price
                            elif side == "short" and tpx > 0:
                                already_tighter = tpx <= sl_px

                        if already_tighter:
                            self._dynamic_sl_set[sym] = True
                            logger.debug(
                                "Dynamic SL skip: %s existing SL tighter (%.2f vs %.2f)",
                                sym, existing_sl.get("trigger_px", 0), sl_px,
                            )
                        else:
                            # ── Save old SL for rollback (Bug A pattern) ──
                            old_sl_oid = existing_sl.get("oid") if existing_sl else None
                            old_sl_px = existing_sl.get("trigger_px") if existing_sl else None

                            # ── Cancel existing SL ──
                            if old_sl_oid:
                                provider.cancel_order(sym, old_sl_oid)

                            # ── Place dynamic SL ──
                            result = provider.place_trigger_order(
                                symbol=sym,
                                is_buy=(side != "long"),
                                sz=pos.get("size", 0),
                                trigger_px=round(sl_px, 6),
                                tpsl="sl",
                            )
                            if result and result.get("status") == "trigger_placed":
                                self._refresh_trigger_cache()
                                self._dynamic_sl_set[sym] = True
                                logger.info(
                                    "Dynamic SL placed: %s %s | %.2f ROE%% (%s vol) | SL @ $%.4f",
                                    sym, side, sl_roe, _vol_regime, sl_px,
                                )
                            else:
                                # ── Rollback: restore old SL on failure ──
                                if old_sl_px and old_sl_oid:
                                    provider.place_trigger_order(
                                        symbol=sym,
                                        is_buy=(side != "long"),
                                        sz=pos.get("size", 0),
                                        trigger_px=old_sl_px,
                                        tpsl="sl",
                                    )
                                    self._refresh_trigger_cache()
                                logger.warning(
                                    "Dynamic SL FAILED: %s — rolled back to old SL", sym,
                                )
                    except Exception:
                        logger.exception("Dynamic SL error for %s", sym)
```

**Critical consistency notes:**

- The `get_trading_settings()` call may already exist earlier in the loop
  iteration. Reuse `ts` if already assigned; do not call it twice per iteration.
- `provider`, `sym`, `side`, `entry_px`, `leverage`, `pos` are all local
  variables already available in the `_fast_trigger_check` loop (see the
  existing capital-BE block for how they're accessed).
- `self._tracked_triggers` is the daemon's cached trigger state — same dict
  used by the existing breakeven/trailing blocks.
- `self._refresh_trigger_cache()` MUST be called after every successful
  placement (Bug B1 fix from trade-mechanism-debug).
- The rollback pattern (save old SL → cancel → place new → restore on failure)
  follows Bug A from Round 2 exactly.

### Step 5: Update Fee-BE to Set `_dynamic_sl_set`

**File:** `src/hynous/intelligence/daemon.py`

In the fee-BE block, at line 2290 (where `_capital_be_set` is set after
successful placement), add:

```python
                                self._dynamic_sl_set[sym] = True
```

This prevents the dynamic SL from being re-evaluated after fee-BE tightens it.
Place this on the line after `self._capital_be_set[sym] = True` (line 2290).

Also add it in the fee-BE "already tighter" fast path (line 2265, where
`_breakeven_set[sym] = True` is set):

```python
                            self._dynamic_sl_set[sym] = True
```

### Step 6: Remove Capital-BE from `_update_peaks_from_candles()`

**File:** `src/hynous/intelligence/daemon.py`

The capital-BE re-evaluation section in `_update_peaks_from_candles()` (lines
2685-2747) checks `self.config.daemon.capital_breakeven_enabled` and re-evaluates
capital-BE when candle peaks cross the threshold. This entire section must be
**removed** or **guarded by the deprecated flag** (which is now `False`).

Since `capital_breakeven_enabled` defaults to `False`, the existing `if` guard
at line 2686 will already skip this section. **No code change needed** — the
config change in Step 2 handles it.

Verify by confirming the guard:
```python
if self.config.daemon.capital_breakeven_enabled:  # line 2686 — now False
```

The dynamic SL does NOT need candle-peak re-evaluation because it's placed once
at entry and not re-evaluated. Fee-BE and trailing handle the progression.

### Step 7: Update State Cleanup Paths

**File:** `src/hynous/intelligence/daemon.py`

Add `_dynamic_sl_set` cleanup in all 3 existing cleanup locations:

**7a. Event-based eviction (lines 2113-2120):**
Find where `_capital_be_set` is popped (line ~2118) and add:
```python
                        self._dynamic_sl_set.pop(_coin, None)
```

**7b. Side-flip cleanup (lines 3351-3366):**
Find where `_capital_be_set` is popped (line ~3356) and add:
```python
            self._dynamic_sl_set.pop(coin, None)
```

**7c. Position-close cleanup (lines 3409-3449):**
Find the cleanup loop for `_capital_be_set` (lines 3424-3426) and add a
matching loop:
```python
            for coin in list(self._dynamic_sl_set):
                if coin not in open_coins:
                    del self._dynamic_sl_set[coin]
```

### Step 8: Update Exit Classification

**File:** `src/hynous/intelligence/daemon.py`

In `_override_sl_classification()` (lines 3179-3197), add a new check **after**
the `_breakeven_set` check (line ~3194) and **before** the final fallthrough:

```python
        if self._dynamic_sl_set.get(coin) and not self._breakeven_set.get(coin):
            return "dynamic_protective_sl"
```

**Full updated precedence:**

```python
def _override_sl_classification(self, coin: str, classification: str) -> str:
    if classification != "stop_loss":
        return classification
    if self._trailing_active.get(coin) and self._trailing_stop_px.get(coin):
        return "trailing_stop"
    if self._breakeven_set.get(coin):
        return "breakeven_stop"
    if self._dynamic_sl_set.get(coin) and not self._breakeven_set.get(coin):
        return "dynamic_protective_sl"
    return classification
```

Note: The `capital_breakeven_stop` classification is removed. If `_capital_be_set`
is still referenced elsewhere in analytics, leave those references but they will
never fire since `capital_breakeven_enabled` is now `False`.

### Step 9: Update System Prompt

**File:** `src/hynous/intelligence/prompts/builder.py`

Update the MECHANICAL EXIT SYSTEM section (lines 159-177). Replace the breakeven
description with the dynamic SL description:

**Replace lines 161-163:**

```python
# OLD:
# Breakeven stop: Once I clear fee break-even ROE ({ts.taker_fee_pct * ts.micro_leverage:.1f}% at \
# {ts.micro_leverage}x, scales with leverage), the daemon moves my SL to entry + fee buffer. \
# This trade is now risk-free.

# NEW:
Dynamic protective SL: At entry, the daemon places a volatility-adjusted stop-loss below my \
entry price. The distance depends on the current vol regime (tighter in low/extreme vol, wider \
in normal/high vol). This is NOT a breakeven — it accepts a controlled loss to avoid premature \
stop-outs on normal market noise.

Fee-breakeven: Once I clear fee break-even ROE ({ts.taker_fee_pct * ts.micro_leverage:.1f}% at \
{ts.micro_leverage}x, scales with leverage), the daemon tightens my SL to entry + fee buffer. \
This trade is now risk-free. The dynamic SL is replaced by the fee-breakeven SL.
```

### Step 10: Update YAML Config

**File:** `config/default.yaml`

Change the capital-breakeven lines (56-57):

```yaml
    capital_breakeven_enabled: false    # DEPRECATED — replaced by dynamic_sl
    capital_breakeven_roe: 0.5         # DEPRECATED
    dynamic_sl_enabled: true           # Vol-regime protective SL at entry
```

---

## 6. Test Specifications

Create a new test file: `tests/unit/test_dynamic_protective_sl.py`

Follow the **exact patterns** from `test_breakeven_fix.py` and
`test_ml_adaptive_trailing.py`. Use source-code-inspection for structural
tests and pure-logic replication for behavioral tests.

### 6.1 Static Tests (Source Code Validation)

These tests read daemon.py source and assert structural correctness. They do
NOT import or run the daemon.

**Class: `TestDynamicSlExists`**

| Test | Assertion |
|------|-----------|
| `test_dynamic_sl_set_state_dict` | `"self._dynamic_sl_set: dict[str, bool] = {}"` in daemon source |
| `test_dynamic_sl_block_in_fast_trigger_check` | `"dynamic_sl_enabled"` appears in `_fast_trigger_check` method body |
| `test_dynamic_sl_before_fee_be` | The `dynamic_sl_enabled` check appears BEFORE `breakeven_stop_enabled` in `_fast_trigger_check` |
| `test_refresh_trigger_cache_called` | `"_refresh_trigger_cache()"` appears in the dynamic SL block at least once for each `place_trigger_order(` call |
| `test_rollback_on_failure` | The dynamic SL block contains rollback logic (old SL restoration) |
| `test_vol_regime_resolution` | `"_latest_predictions"` accessed in the dynamic SL block |
| `test_capital_be_disabled_in_yaml` | `_default_yaml()["daemon"]["capital_breakeven_enabled"]` is `False` |
| `test_dynamic_sl_enabled_in_yaml` | `_default_yaml()["daemon"]["dynamic_sl_enabled"]` is `True` |
| `test_cleanup_eviction` | `"_dynamic_sl_set.pop("` appears in the eviction block |
| `test_cleanup_side_flip` | `"_dynamic_sl_set.pop("` appears in the side-flip block |
| `test_cleanup_position_close` | `"_dynamic_sl_set"` appears in the position-close cleanup block |
| `test_classification_dynamic_sl` | `"dynamic_protective_sl"` appears in `_override_sl_classification` method |
| `test_classification_precedence` | In `_override_sl_classification`, `trailing_stop` check is before `breakeven_stop`, which is before `dynamic_protective_sl` |

**Class: `TestDynamicSlConfig`**

| Test | Assertion |
|------|-----------|
| `test_trading_settings_fields_exist` | `TradingSettings` has all 7 new fields with correct defaults |
| `test_daemon_config_field_exists` | `DaemonConfig` has `dynamic_sl_enabled: bool` |
| `test_yaml_matches_python_defaults` | YAML `dynamic_sl_enabled` matches Python default |
| `test_capital_be_deprecated` | `DaemonConfig.capital_breakeven_enabled` defaults to `False` |

### 6.2 Formula & Logic Tests (Pure Python)

These tests replicate the SL computation logic in pure Python. No daemon import.

**Class: `TestDynamicSlFormula`**

| Test | Assertion |
|------|-----------|
| `test_long_sl_below_entry` | For a long at $100K, 20x, normal vol: SL = $100K * (1 - 7.0/20/100) = $99,650. Assert `sl_px < entry_px`. |
| `test_short_sl_above_entry` | For a short at $100K, 20x, normal vol: SL = $100K * (1 + 7.0/20/100) = $100,350. Assert `sl_px > entry_px`. |
| `test_low_vol_distance` | Vol regime "low" → `sl_roe = 2.5`. Verify math. |
| `test_normal_vol_distance` | Vol regime "normal" → `sl_roe = 7.0`. Verify math. |
| `test_high_vol_distance` | Vol regime "high" → `sl_roe = 8.0`. Verify math. |
| `test_extreme_vol_distance` | Vol regime "extreme" → `sl_roe = 3.0`. Verify math. |
| `test_floor_clamp` | If computed `sl_roe < 1.5`, clamp to 1.5. |
| `test_cap_clamp` | If computed `sl_roe > 10.0`, clamp to 10.0. |
| `test_leverage_scaling` | At 10x leverage, 7.0% ROE = 0.7% price. SL for long at $100K = $99,300. |
| `test_stale_predictions_fallback` | If `_latest_predictions` timestamp > 330s old, `_vol_regime = "normal"`. |
| `test_missing_predictions_fallback` | If `_latest_predictions` is empty, `_vol_regime = "normal"`. |
| `test_non_btc_uses_normal` | Non-BTC coins (conditions are BTC-only) → "normal" regime. |

**Class: `TestDynamicSlProgression`**

Replicate the layer progression in pure Python state machine:

| Test | Assertion |
|------|-----------|
| `test_dynamic_sl_set_blocks_reevaluation` | Once `_dynamic_sl_set["SYM"] = True`, the gate condition `not self._dynamic_sl_set.get(sym)` blocks re-entry. |
| `test_fee_be_sets_dynamic_sl_flag` | When fee-BE fires, `_dynamic_sl_set["SYM"]` must become True. |
| `test_fee_be_tightens_past_dynamic_sl` | Fee-BE SL at entry + buffer is always tighter than dynamic SL at entry - distance. Verify for all 4 regimes. |
| `test_trailing_supersedes_all` | Once `_trailing_active["SYM"] = True`, the dynamic SL is irrelevant. |
| `test_side_flip_resets_dynamic_sl` | After side-flip cleanup, `_dynamic_sl_set` should not contain the coin. |
| `test_eviction_resets_dynamic_sl` | After event-based eviction, `_dynamic_sl_set` should not contain the coin. |

**Class: `TestDynamicSlClassification`**

| Test | Assertion |
|------|-----------|
| `test_classification_dynamic_sl_only` | `_dynamic_sl_set=True`, no trailing/breakeven → returns `"dynamic_protective_sl"`. |
| `test_classification_trailing_takes_precedence` | `_trailing_active=True` AND `_dynamic_sl_set=True` → returns `"trailing_stop"`. |
| `test_classification_breakeven_takes_precedence` | `_breakeven_set=True` AND `_dynamic_sl_set=True` → returns `"breakeven_stop"`. |
| `test_classification_nothing_set` | All flags False → returns `"stop_loss"` (agent-placed). |

### 6.3 Integration Tests (PaperProvider)

Follow the exact fixture pattern from `test_breakeven_fix.py` (PaperProvider
with temp storage, mock real provider, pre-opened positions).

**Class: `TestDynamicSlPaperIntegration`**

| Test | Assertion |
|------|-----------|
| `test_sl_placed_at_correct_price_long` | Open long at $100, 20x, normal vol. Dynamic SL should be at $100 * (1 - 7.0/20/100) = $99.65. Verify via `paper.check_triggers({"SYM": 99.60})` → triggers. |
| `test_sl_placed_at_correct_price_short` | Open short at $100, 20x, normal vol. Dynamic SL at $100.35. Verify triggers. |
| `test_existing_tighter_sl_preserved` | Pre-place a tighter SL. Run dynamic SL logic. Assert original SL unchanged. |
| `test_existing_wider_sl_replaced` | Pre-place a wider SL. Run dynamic SL logic. Assert SL replaced with dynamic SL. |
| `test_cancel_before_place` | With existing SL, verify old SL is cancelled before new one placed (check order count). |
| `test_rollback_on_placement_failure` | Mock `place_trigger_order` to fail. Verify old SL is restored. |
| `test_fee_be_overrides_dynamic_sl` | After dynamic SL placed, simulate price rise to fee-BE threshold. Verify SL tightens to entry + buffer. |

### 6.4 Running Tests

```bash
# Run just the new tests
PYTHONPATH=src pytest tests/unit/test_dynamic_protective_sl.py -v

# Run ALL breakeven-related tests (regression check)
PYTHONPATH=src pytest tests/unit/test_breakeven_fix.py tests/unit/test_ml_adaptive_trailing.py tests/unit/test_mechanical_exits.py tests/unit/test_dynamic_protective_sl.py -v

# Run full test suite (final verification)
PYTHONPATH=src pytest tests/ -v
```

**All existing tests must continue to pass.** The capital-BE tests in
`test_breakeven_fix.py` will need updates since `capital_breakeven_enabled`
is now `False`. Specifically:

- Tests in `TestCapitalBreakevenExists` that check for `capital_breakeven_enabled`
  in YAML being `True` → update to assert `False`.
- Tests that validate capital-BE gate logic → these should now test that the
  gate does NOT fire (since the config is disabled).
- Tests that validate the two-layer progression → update to test the new
  three-layer progression (dynamic SL → fee-BE → trailing).

**Do NOT delete the old capital-BE tests.** Update them to verify that
capital-BE is disabled and that the dynamic SL has taken its place. The
structural tests act as guards against accidental re-enablement.

---

## 7. System Integration Verification

After all tests pass, verify the complete system integration:

### 7.1 Config Consistency Check

```bash
# Verify YAML loads without error
python -c "
from hynous.core.config import load_config
cfg = load_config()
print('dynamic_sl_enabled:', cfg.daemon.dynamic_sl_enabled)
print('capital_be_enabled:', cfg.daemon.capital_breakeven_enabled)
assert cfg.daemon.dynamic_sl_enabled is True
assert cfg.daemon.capital_breakeven_enabled is False
print('Config OK')
"

# Verify TradingSettings defaults
python -c "
from hynous.core.trading_settings import TradingSettings
ts = TradingSettings()
print('dynamic_sl_low:', ts.dynamic_sl_low_vol)
print('dynamic_sl_normal:', ts.dynamic_sl_normal_vol)
print('dynamic_sl_high:', ts.dynamic_sl_high_vol)
print('dynamic_sl_extreme:', ts.dynamic_sl_extreme_vol)
print('dynamic_sl_floor:', ts.dynamic_sl_floor)
print('dynamic_sl_cap:', ts.dynamic_sl_cap)
assert ts.dynamic_sl_normal_vol == 7.0
print('TradingSettings OK')
"
```

### 7.2 Mechanical State Persistence Check

The `_persist_mechanical_state()` (line 4596) does NOT persist `_dynamic_sl_set`
(by design — same as `_capital_be_set`). Verify this is intentional by confirming:

1. On daemon restart, the SL order still exists on the exchange/paper provider.
2. The "already tighter" check in the dynamic SL block prevents re-placement.
3. If the daemon restarts and there is no existing SL (edge case — provider
   cleared it), the dynamic SL will be re-placed on the next
   `_fast_trigger_check()` iteration.

### 7.3 System Prompt Check

```bash
# Verify the updated prompt
python -c "
from hynous.intelligence.prompts.builder import build_system_prompt
# This may need a mock context — verify the dynamic SL text appears
# and the old capital-breakeven text is removed
"
```

### 7.4 Full Test Suite

```bash
PYTHONPATH=src pytest tests/ -v --tb=short
```

All tests must pass. Expected count: ~750+ tests (current 747 + ~30 new dynamic
SL tests).

### 7.5 Pause Points

**If any of the following occur, STOP and report back to the architect:**

- Any existing test fails after the change (indicates a regression).
- The dynamic SL block references variables not available in its scope.
- The fee-BE block's `_dynamic_sl_set` flag setting causes unexpected behavior.
- The `_override_sl_classification()` method has a different structure than
  documented (line numbers shifted from a recent commit).
- The `_update_peaks_from_candles()` capital-BE section does NOT have the
  `capital_breakeven_enabled` guard (would need explicit removal).
- Any import errors or circular dependencies from the new config field.

---

## 8. Rollback Plan

If the dynamic SL needs to be reverted:

1. Set `dynamic_sl_enabled: false` in `config/default.yaml`.
2. Set `capital_breakeven_enabled: true` in `config/default.yaml`.
3. Restart daemon. The capital-BE code still exists (guarded by config flag).
   The dynamic SL block is guarded by its own flag.

No code changes needed for rollback — just config. This is why we kept the
deprecated `capital_breakeven_enabled` field rather than deleting the code.

---

## Appendix: File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/hynous/core/trading_settings.py` | ADD 7 fields | `dynamic_sl_enabled/low/normal/high/extreme/floor/cap` |
| `src/hynous/core/config.py` | MODIFY 2 defaults, ADD 1 field | `capital_breakeven_enabled → False`, add `dynamic_sl_enabled` |
| `config/default.yaml` | MODIFY 2 lines, ADD 1 line | Disable capital-BE, add `dynamic_sl_enabled: true` |
| `src/hynous/intelligence/daemon.py` | REPLACE block, ADD state dict, ADD cleanup, MODIFY classification | Replace capital-BE (lines 2161-2233) with dynamic SL. Add `_dynamic_sl_set`. Add cleanup in 3 paths. Add classification. |
| `src/hynous/intelligence/prompts/builder.py` | MODIFY ~6 lines | Update MECHANICAL EXIT SYSTEM section |
| `tests/unit/test_dynamic_protective_sl.py` | NEW file | ~30 tests across 6 test classes |
| `tests/unit/test_breakeven_fix.py` | MODIFY ~5 tests | Update capital-BE assertions to expect disabled |
