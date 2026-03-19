# Adaptive Trailing Stop v3 — Continuous Exponential Retracement

> Replace the 3-tier discrete retracement + multiplicative vol modifier with a single
> continuous exponential function with regime-dependent decay rate.
>
> **Status:** Implemented 2026-03-18
> **Priority:** High
> **Branch:** `test-env`
> **Estimated scope:** ~150 lines changed, 1 new experiment file

---

## Problem

The current trailing stop uses a 3-tier step function:

| Peak ROE | Retracement | Behavior |
|----------|-------------|----------|
| 0–5%     | 45%         | Flat within tier |
| 5–10%    | 38%         | **7pp jump at boundary** |
| 10%+     | 30%         | **8pp jump at boundary**, flat forever |

Then a vol modifier is multiplied on top: `effective = base × vol_mod`.

**Three issues:**

1. **Discontinuities** at peak 5% and 10% — the trail SL jumps abruptly at tier boundaries.
2. **Flat segments** — going from peak 2% to 4.9% provides zero additional tightening.
3. **Floor violation** — the multiplicative modifier can push effective retracement below the intended minimum. Example: floor intended at 0.20, but `0.25 × 0.75 = 0.1875`.

## Solution

One continuous exponential function with regime-dependent decay rate:

```
r(p, regime) = floor + amplitude × e^(-k(regime) × p)
```

- **floor**: universal asymptotic minimum retracement (same for all regimes)
- **amplitude**: range of variation (same for all regimes)
- **k(regime)**: decay rate per vol regime — higher k = faster tightening
- **6 parameters total**: `floor`, `amplitude`, `k_extreme`, `k_high`, `k_normal`, `k_low`

The vol modifier is absorbed into `k` — no separate multiplication step.

## Phases

| Phase | Guide | Purpose |
|-------|-------|---------|
| **1** | [`phase-1-calibration.md`](phase-1-calibration.md) | Build & run the calibration script to determine the 6 parameter values |
| **2** | [`phase-2-implementation.md`](phase-2-implementation.md) | Apply the calibrated values to the codebase |

**Workflow:** Complete Phase 1 first. Run the calibration. Report the 6 numbers. Then proceed to Phase 2 using those numbers.

## Theoretical Backing

- **Functional form**: Prospect theory (Kahneman & Tversky 1992) — concave utility for gains implies convex (decelerating) tightening curve. OU process dynamics — exponential autocorrelation decay. Beats linear, hyperbolic, power, logistic, and arctangent on every evaluation criterion.
- **Regime-dependent k**: Hamilton (1989) regime-switching models — the regime selects internal parameters, not a post-hoc scale factor. Preserves floor guarantee without clamping. Quasi-orthogonal parameters for calibration.
- **Signal combination**: Kittler (1998) — sum rule outperforms product rule for noisy signals. Multiplicative vol modifier amplifies estimation errors; absorbing into k eliminates this.
- **MAE trail floor dropped**: Partial correlation analysis shows ρ(MAE, outcome | vol_regime) ≈ -0.10 to +0.07. After conditioning on vol regime, MAE adds near-zero marginal information. The causal chain (volatility → price movement → MAE) means vol regime already captures this.

## What Changes

| Component | Before | After |
|-----------|--------|-------|
| Retracement function | 3 discrete tiers (if/elif/else) | 1 continuous exponential |
| Vol modifier | Separate multiplication (4 values) | Absorbed into decay rate k |
| TradingSettings fields | 7 fields (3 tiers + 4 vol mods) | 6 fields (floor + amplitude + 4 k values) |
| daemon.py | ~20 lines (tier lookup + mod lookup + multiply) | ~3 lines (one exp() call) |
| Trail floor | Unchanged | Unchanged |
| Activation thresholds | Unchanged | Unchanged |
| Agent exit lockout | Unchanged | Unchanged |
| State persistence | Unchanged | Unchanged |
| Layer progression | Unchanged | Unchanged |

## What Does NOT Change

- Activation thresholds (`trail_activation_extreme/high/normal/low`)
- Trail floor (`fee_be_roe + trail_min_distance_above_fee_be`)
- Agent exit lockout (`is_trailing_active()` blocks `close_position()`)
- State dicts (`_trailing_active`, `_trailing_stop_px`, `_peak_roe`)
- Persistence to `storage/mechanical_state.json`
- All cleanup/rollback/eviction paths
- Layer progression (Dynamic SL → Fee-BE → Trailing)
- Exit classification (`_override_sl_classification()`)
- Legacy fallback fields (`trailing_activation_roe`, `trailing_retracement_pct`)

---

## Calibration Results

Calibrated against 55,888 BTC labeled snapshots from `storage/satellite.db`. Walk-forward stable (max k_drift = 0.02 across 5 windows, all 4 regimes). 800 unit tests passing.

| Parameter | Value |
|-----------|-------|
| `trail_ret_floor` | 0.20 |
| `trail_ret_amplitude` | 0.30 |
| `trail_ret_k_extreme` | 0.160 |
| `trail_ret_k_high` | 0.100 |
| `trail_ret_k_normal` | 0.080 |
| `trail_ret_k_low` | 0.040 |

**Constraint checks (all pass):** ceiling = 0.50 ≤ 0.55, floor = 0.20 ≥ 0.10, k ordering: extreme > high > normal > low, all 4 regimes monotonic, no floor violations.

---

Last updated: 2026-03-18
