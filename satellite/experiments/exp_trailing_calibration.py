"""Trailing stop retracement calibration.

Sweeps (floor, amplitude, k) parameters for the continuous exponential
retracement function  r(p) = floor + amplitude * exp(-k * p).

Uses labeled snapshots from satellite.db to evaluate each parameter set
against the current 3-tier + vol-modifier system.

Output: optimal (floor, amplitude, k_per_regime) with stability analysis.

Usage:
    python -m satellite.experiments.exp_trailing_calibration --db storage/satellite.db --coin BTC
"""

from __future__ import annotations

import argparse
import math
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

# ── Constants ──────────────────────────────────────────────────────────────────

# Vol regime thresholds (from condition engine: p25, p75, p95 of realized_vol_1h)
VOL_THRESHOLDS = {"low": 0.33, "normal": 0.73, "high": 1.05}

# Current activation thresholds (from trading_settings.py, unchanged)
ACTIVATION_MAP = {"extreme": 1.5, "high": 2.0, "normal": 2.5, "low": 3.0}

# Current tier system (for comparison baseline)
TIER_BOUNDARIES = [5.0, 10.0]
TIER_RETRACEMENTS = [0.45, 0.38, 0.30]  # tier1, tier2, tier3
VOL_MODIFIERS = {"extreme": 0.75, "high": 0.88, "normal": 1.0, "low": 1.1}

# Fee-BE floor (taker_fee_pct * leverage + min_distance)
DEFAULT_TAKER_FEE_PCT = 0.07
DEFAULT_LEVERAGE = 20
FEE_BE_ROE = DEFAULT_TAKER_FEE_PCT * DEFAULT_LEVERAGE  # 1.4% at 20x
TRAIL_MIN_DISTANCE = 0.5  # ROE % above fee-BE
TRAIL_FLOOR_ROE = FEE_BE_ROE + TRAIL_MIN_DISTANCE  # 1.9% at 20x

# Sweep ranges
FLOOR_RANGE = np.arange(0.10, 0.36, 0.05)       # [0.10, 0.15, 0.20, 0.25, 0.30, 0.35]
AMPLITUDE_RANGE = np.arange(0.10, 0.41, 0.05)   # [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40]
K_RANGE = np.arange(0.02, 0.26, 0.02)           # [0.02, 0.04, ..., 0.24]

# Evaluation peaks (where to compare new vs current)
EVAL_PEAKS = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 7.0, 7.5,
              8.0, 9.0, 10.0, 10.5, 12.0, 15.0, 20.0]

# Walk-forward parameters
WF_WINDOW_DAYS = 60    # Each chunk is 60 days
WF_STEP_DAYS = 30      # Step by 30 days
SNAPSHOTS_PER_DAY = 288  # 5-min intervals, 24h


# ── Data classes ───────────────────────────────────────────────────────────────

@dataclass
class ParamSet:
    """A candidate parameter combination."""
    floor: float
    amplitude: float
    k: float  # regime-specific


@dataclass
class EvalResult:
    """Evaluation of one parameter set for one regime."""
    regime: str
    floor: float
    amplitude: float
    k: float
    n_snapshots: int
    n_activated: int                     # snapshots where peak >= activation_roe
    avg_capture_new: float               # avg trail_exit_roe with new function
    avg_capture_current: float           # avg trail_exit_roe with current tiers
    capture_improvement_pct: float       # (new - current) / current * 100
    boundary_smoothness: float           # smoothness score at tier boundaries
    monotonic: bool                      # is the curve monotonically decreasing?
    floor_violated: bool                 # does effective retracement go below floor?


@dataclass
class CalibrationReport:
    """Full calibration output."""
    coin: str
    total_snapshots: int
    regime_counts: dict[str, int]
    best_params: dict[str, EvalResult]   # regime → best EvalResult
    global_floor: float
    global_amplitude: float
    walk_forward_stable: bool
    wf_details: list[dict] = field(default_factory=list)


# ── Core functions ─────────────────────────────────────────────────────────────

def load_data(db_path: str, coin: str) -> list[dict]:
    """Load labeled snapshots. Same pattern as harness.load_snapshots_with_labels."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT s.realized_vol_1h, s.created_at,
               l.best_long_roe_30m_net, l.best_short_roe_30m_net,
               l.worst_long_mae_30m, l.worst_short_mae_30m
        FROM snapshots s
        JOIN snapshot_labels l ON s.snapshot_id = l.snapshot_id
        WHERE s.coin = ? AND l.label_version > 0
        ORDER BY s.created_at ASC
        """,
        (coin,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def assign_regime(vol_1h: float | None) -> str:
    """Bucket realized_vol_1h into regime. Same thresholds as condition engine."""
    if vol_1h is None or vol_1h < VOL_THRESHOLDS["low"]:
        return "low"
    elif vol_1h < VOL_THRESHOLDS["normal"]:
        return "normal"
    elif vol_1h < VOL_THRESHOLDS["high"]:
        return "high"
    else:
        return "extreme"


def continuous_retracement(peak: float, floor: float, amplitude: float, k: float) -> float:
    """Compute retracement fraction using continuous exponential decay."""
    return floor + amplitude * math.exp(-k * peak)


def current_tier_retracement(peak: float, regime: str) -> float:
    """Compute retracement fraction using current 3-tier + vol modifier system."""
    if peak < TIER_BOUNDARIES[0]:
        base = TIER_RETRACEMENTS[0]  # 0.45
    elif peak < TIER_BOUNDARIES[1]:
        base = TIER_RETRACEMENTS[1]  # 0.38
    else:
        base = TIER_RETRACEMENTS[2]  # 0.30
    return base * VOL_MODIFIERS.get(regime, 1.0)


def compute_trail_exit_roe(peak: float, retracement: float) -> float:
    """Compute the trail exit ROE given peak and retracement fraction."""
    trail_roe = peak * (1.0 - retracement)
    return max(trail_roe, TRAIL_FLOOR_ROE)


def check_monotonicity(floor: float, amplitude: float, k: float) -> bool:
    """Verify the curve is monotonically decreasing over [0, 30]."""
    # Derivative: r'(p) = -amplitude * k * exp(-k * p)
    # This is always negative for amplitude > 0 and k > 0.
    return amplitude > 0 and k > 0


def compute_boundary_smoothness(floor: float, amplitude: float, k: float, regime: str) -> float:
    """Measure how much smoother the continuous function is at tier boundaries.

    Returns a score where higher = smoother. Computed as the reduction
    in the maximum instantaneous change at the old boundary points.
    """
    # Current system has jumps at peak=5.0 and peak=10.0
    # Measure the rate of change of the continuous function at those points
    # compared to the tier jump magnitude.

    # Current jumps
    jump_5 = abs(current_tier_retracement(4.99, regime) - current_tier_retracement(5.01, regime))
    jump_10 = abs(current_tier_retracement(9.99, regime) - current_tier_retracement(10.01, regime))
    max_jump = max(jump_5, jump_10)

    if max_jump == 0:
        return 1.0

    # Continuous function change over same 0.02 interval
    cont_change_5 = abs(
        continuous_retracement(4.99, floor, amplitude, k)
        - continuous_retracement(5.01, floor, amplitude, k)
    )
    cont_change_10 = abs(
        continuous_retracement(9.99, floor, amplitude, k)
        - continuous_retracement(10.01, floor, amplitude, k)
    )
    max_cont_change = max(cont_change_5, cont_change_10)

    # Smoothness = 1 - (continuous_change / tier_jump). Higher = smoother.
    return 1.0 - (max_cont_change / max_jump)


def evaluate_params_for_regime(
    snapshots: list[dict],
    regime: str,
    floor: float,
    amplitude: float,
    k: float,
) -> EvalResult:
    """Evaluate one (floor, amplitude, k) combination for one regime.

    Compares average capture ROE of the continuous function vs current tiers
    across all snapshots where peak >= activation threshold.
    """
    activation_roe = ACTIVATION_MAP[regime]
    captures_new: list[float] = []
    captures_current: list[float] = []

    for snap in snapshots:
        # Evaluate both sides (long and short)
        for side in ("long", "short"):
            peak = snap.get(f"best_{side}_roe_30m_net")
            if peak is None or peak <= 0:
                continue

            # Only evaluate snapshots where trailing would activate
            if peak < activation_roe:
                continue

            # New continuous system
            r_new = continuous_retracement(peak, floor, amplitude, k)
            exit_new = compute_trail_exit_roe(peak, r_new)
            captures_new.append(exit_new)

            # Current tier system (for comparison)
            r_current = current_tier_retracement(peak, regime)
            exit_current = compute_trail_exit_roe(peak, r_current)
            captures_current.append(exit_current)

    n_activated = len(captures_new)
    if n_activated == 0:
        return EvalResult(
            regime=regime, floor=floor, amplitude=amplitude, k=k,
            n_snapshots=len(snapshots), n_activated=0,
            avg_capture_new=0, avg_capture_current=0,
            capture_improvement_pct=0, boundary_smoothness=0,
            monotonic=True, floor_violated=False,
        )

    avg_new = sum(captures_new) / n_activated
    avg_current = sum(captures_current) / n_activated
    improvement = ((avg_new - avg_current) / avg_current * 100) if avg_current > 0 else 0

    return EvalResult(
        regime=regime,
        floor=floor,
        amplitude=amplitude,
        k=k,
        n_snapshots=len(snapshots),
        n_activated=n_activated,
        avg_capture_new=avg_new,
        avg_capture_current=avg_current,
        capture_improvement_pct=improvement,
        boundary_smoothness=compute_boundary_smoothness(floor, amplitude, k, regime),
        monotonic=check_monotonicity(floor, amplitude, k),
        floor_violated=(floor + amplitude > 0.55),  # ceiling check
    )


def run_sweep(snapshots_by_regime: dict[str, list[dict]]) -> dict[str, EvalResult]:
    """Sweep all parameter combinations and select best per regime.

    Strategy: find global (floor, amplitude) that work well across all regimes,
    then optimize k per regime independently.
    """
    print("\n=== PHASE 1: Find optimal global (floor, amplitude) ===\n")

    # First pass: find (floor, amplitude) pairs that produce good results
    # across all regimes with k=0.08 (reasonable middle value)
    global_scores: dict[tuple[float, float], float] = {}

    for fl in FLOOR_RANGE:
        for amp in AMPLITUDE_RANGE:
            # Skip invalid: ceiling > 0.55 is too generous
            if fl + amp > 0.55:
                continue
            # Skip invalid: ceiling < 0.30 is too tight
            if fl + amp < 0.30:
                continue

            total_score = 0.0
            valid = True

            for regime, snaps in snapshots_by_regime.items():
                result = evaluate_params_for_regime(snaps, regime, fl, amp, 0.08)
                if result.n_activated == 0:
                    valid = False
                    break
                # Score: penalize large deviations from current system
                total_score += abs(result.capture_improvement_pct)

            if valid:
                # Lower total deviation = better match to current system
                global_scores[(fl, amp)] = total_score

    if not global_scores:
        print("ERROR: No valid (floor, amplitude) found. Check sweep ranges.")
        sys.exit(1)

    # Sort by score (lower = better match to current)
    sorted_globals = sorted(global_scores.items(), key=lambda x: x[1])

    print("Top 5 (floor, amplitude) candidates:")
    print(f"  {'floor':>6}  {'amp':>6}  {'total_dev':>10}")
    for (fl, amp), score in sorted_globals[:5]:
        print(f"  {fl:6.2f}  {amp:6.2f}  {score:10.4f}%")

    best_floor, best_amplitude = sorted_globals[0][0]
    print(f"\n  Selected: floor={best_floor:.2f}, amplitude={best_amplitude:.2f}\n")

    # Second pass: optimize k per regime with the selected (floor, amplitude)
    print("=== PHASE 2: Optimize k per regime ===\n")

    best_per_regime: dict[str, EvalResult] = {}

    for regime, snaps in snapshots_by_regime.items():
        print(f"--- {regime.upper()} regime ({len(snaps):,} snapshots) ---")

        best_result: EvalResult | None = None
        best_score = float("inf")

        for k in K_RANGE:
            result = evaluate_params_for_regime(snaps, regime, best_floor, best_amplitude, k)

            if result.n_activated == 0:
                continue
            if not result.monotonic:
                continue

            # Score: minimize deviation from current system while rewarding smoothness
            # Small positive improvement is allowed (we want to be at least as good)
            deviation = abs(result.capture_improvement_pct)
            smoothness_bonus = result.boundary_smoothness * 0.5  # 0-0.5 bonus
            score = deviation - smoothness_bonus

            if score < best_score:
                best_score = score
                best_result = result

        if best_result is None:
            print(f"  ERROR: No valid k found for {regime}!")
            sys.exit(1)

        best_per_regime[regime] = best_result

        print(f"  k = {best_result.k:.3f}")
        print(f"  Activated: {best_result.n_activated:,} / {best_result.n_snapshots:,}")
        print(f"  Avg capture (new):     {best_result.avg_capture_new:.4f}% ROE")
        print(f"  Avg capture (current): {best_result.avg_capture_current:.4f}% ROE")
        print(f"  Improvement: {best_result.capture_improvement_pct:+.4f}%")
        print(f"  Boundary smoothness: {best_result.boundary_smoothness:.4f}")
        print()

    return best_per_regime


def run_walk_forward(
    all_snapshots: list[dict],
    global_floor: float,
    global_amplitude: float,
    best_k: dict[str, float],
) -> tuple[bool, list[dict]]:
    """Walk-forward stability check.

    Split data into time-ordered windows. For each window, re-run the
    evaluation and verify that the selected parameters remain optimal
    (or near-optimal). If the best k shifts by more than 0.04 in any
    window, flag as unstable.
    """
    print("\n=== PHASE 3: Walk-forward stability ===\n")

    window_size = WF_WINDOW_DAYS * SNAPSHOTS_PER_DAY  # ~17,280 snapshots
    step_size = WF_STEP_DAYS * SNAPSHOTS_PER_DAY      # ~8,640 snapshots
    results: list[dict] = []
    stable = True

    for start in range(0, len(all_snapshots) - window_size, step_size):
        window = all_snapshots[start : start + window_size]
        window_start_ts = window[0].get("created_at", 0)
        window_end_ts = window[-1].get("created_at", 0)

        # Bucket this window by regime
        window_by_regime: dict[str, list[dict]] = {r: [] for r in ACTIVATION_MAP}
        for snap in window:
            regime = assign_regime(snap.get("realized_vol_1h"))
            window_by_regime[regime].append(snap)

        window_result = {
            "window_start": window_start_ts,
            "window_end": window_end_ts,
            "n_snapshots": len(window),
            "regimes": {},
        }

        for regime, snaps in window_by_regime.items():
            if len(snaps) < 100:
                continue

            # Evaluate the selected k for this window
            result = evaluate_params_for_regime(
                snaps, regime, global_floor, global_amplitude, best_k[regime],
            )

            # Also find the best k for this window independently
            local_best_k = best_k[regime]
            local_best_score = float("inf")
            for k in K_RANGE:
                r = evaluate_params_for_regime(snaps, regime, global_floor, global_amplitude, k)
                if r.n_activated == 0:
                    continue
                score = abs(r.capture_improvement_pct)
                if score < local_best_score:
                    local_best_score = score
                    local_best_k = k

            k_drift = abs(local_best_k - best_k[regime])
            if k_drift > 0.04:
                stable = False

            window_result["regimes"][regime] = {
                "n_snapshots": len(snaps),
                "selected_k": best_k[regime],
                "local_best_k": local_best_k,
                "k_drift": k_drift,
                "avg_capture": result.avg_capture_new,
                "improvement": result.capture_improvement_pct,
            }

        results.append(window_result)

    # Print summary
    print(f"  Windows evaluated: {len(results)}")
    for regime in ACTIVATION_MAP:
        drifts = [
            r["regimes"][regime]["k_drift"]
            for r in results
            if regime in r["regimes"]
        ]
        if drifts:
            print(f"  {regime:>8}: avg k_drift={np.mean(drifts):.4f}, "
                  f"max k_drift={max(drifts):.4f}, "
                  f"stable={'YES' if max(drifts) <= 0.04 else 'NO'}")

    print(f"\n  Overall stability: {'PASS' if stable else 'FAIL'}")
    return stable, results


def print_curve_comparison(
    global_floor: float,
    global_amplitude: float,
    best_k: dict[str, float],
) -> None:
    """Print a side-by-side comparison of new vs current at every eval peak."""
    print("\n=== CURVE COMPARISON: New vs Current ===\n")
    print(f"  Parameters: floor={global_floor:.3f}, amplitude={global_amplitude:.3f}")
    print(f"  k values: " + ", ".join(f"{r}={best_k[r]:.3f}" for r in best_k))
    print()

    for regime in ["low", "normal", "high", "extreme"]:
        k = best_k[regime]
        print(f"  --- {regime.upper()} (k={k:.3f}) ---")
        print(f"  {'Peak':>6}  {'New r(p)':>8}  {'Current':>8}  {'Delta':>8}  {'Trail ROE (new)':>15}")

        for peak in EVAL_PEAKS:
            r_new = continuous_retracement(peak, global_floor, global_amplitude, k)
            r_current = current_tier_retracement(peak, regime)
            trail_new = compute_trail_exit_roe(peak, r_new)
            delta = r_new - r_current
            print(f"  {peak:6.1f}  {r_new:8.4f}  {r_current:8.4f}  {delta:+8.4f}  {trail_new:15.4f}")
        print()


def print_final_report(report: CalibrationReport) -> None:
    """Print the final calibration report with the 6 parameters."""
    print("\n" + "=" * 70)
    print("  CALIBRATION COMPLETE — FINAL PARAMETERS")
    print("=" * 70)
    print()
    print(f"  Coin: {report.coin}")
    print(f"  Total snapshots: {report.total_snapshots:,}")
    print(f"  Regime distribution: {report.regime_counts}")
    print(f"  Walk-forward stable: {'YES' if report.walk_forward_stable else 'NO'}")
    print()
    print("  ┌─────────────────────────────────────────────┐")
    print(f"  │  trail_ret_floor:      {report.global_floor:.2f}                  │")
    print(f"  │  trail_ret_amplitude:  {report.global_amplitude:.2f}                  │")
    for regime, result in report.best_params.items():
        print(f"  │  trail_ret_k_{regime:<8s}: {result.k:.3f}                 │")
    print("  └─────────────────────────────────────────────┘")
    print()
    print("  Copy these values into Phase 2.")
    print()

    # Verify constraints
    ceiling = report.global_floor + report.global_amplitude
    print(f"  Constraints check:")
    print(f"    ceiling (floor + amplitude) = {ceiling:.2f} (must be <= 0.55)")
    print(f"    floor = {report.global_floor:.2f} (must be >= 0.10)")
    for regime, result in report.best_params.items():
        print(f"    {regime}: monotonic={result.monotonic}, floor_violated={result.floor_violated}")
    print()


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Trailing stop retracement calibration")
    parser.add_argument("--db", required=True, help="Path to satellite.db")
    parser.add_argument("--coin", default="BTC", help="Coin to calibrate (default: BTC)")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"ERROR: Database not found: {db_path}")
        sys.exit(1)

    # ── Load data ──
    print(f"Loading snapshots for {args.coin} from {db_path}...")
    all_snapshots = load_data(str(db_path), args.coin)
    print(f"  Loaded {len(all_snapshots):,} labeled snapshots")

    if len(all_snapshots) < 1000:
        print("ERROR: Insufficient data for calibration (need >= 1000 snapshots)")
        sys.exit(1)

    # ── Bucket by vol regime ──
    snapshots_by_regime: dict[str, list[dict]] = {r: [] for r in ACTIVATION_MAP}
    for snap in all_snapshots:
        regime = assign_regime(snap.get("realized_vol_1h"))
        snapshots_by_regime[regime].append(snap)

    regime_counts = {r: len(s) for r, s in snapshots_by_regime.items()}
    print(f"  Regime distribution: {regime_counts}")

    # ── Run sweep ──
    best_per_regime = run_sweep(snapshots_by_regime)

    # Extract global params from any regime (they're the same)
    any_result = next(iter(best_per_regime.values()))
    global_floor = any_result.floor
    global_amplitude = any_result.amplitude
    best_k = {r: result.k for r, result in best_per_regime.items()}

    # ── Print curve comparison ──
    print_curve_comparison(global_floor, global_amplitude, best_k)

    # ── Walk-forward stability ──
    wf_stable, wf_details = run_walk_forward(
        all_snapshots, global_floor, global_amplitude, best_k,
    )

    # ── Final report ──
    report = CalibrationReport(
        coin=args.coin,
        total_snapshots=len(all_snapshots),
        regime_counts=regime_counts,
        best_params=best_per_regime,
        global_floor=global_floor,
        global_amplitude=global_amplitude,
        walk_forward_stable=wf_stable,
        wf_details=wf_details,
    )
    print_final_report(report)


if __name__ == "__main__":
    main()
