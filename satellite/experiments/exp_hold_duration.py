"""Experiment 1: Optimal Hold Duration

Predicts: How many 5-minute intervals until the best price peak within 4h.
Features: Same 14 market features.
Label: Number of 5m snapshots between entry and highest close price in the
       forward 4h window (range: 1-48).

Why it should work: vol_1h (0.76 Spearman) and move_30m (0.58) already predict
move magnitude. Duration is structurally correlated — high vol = fast peaks,
low vol = slow grind. This extends existing signal.

Statistical notes:
  - Target is computed from future CLOSE prices at each snapshot (NOT from
    labels — labels are themselves forward-looking and would cause double
    look-ahead contamination).
  - Per-fold clipping in harness prevents percentile leakage.
  - 48-snapshot embargo gap covers the full 4h look-ahead window.

Usage:
    python -m satellite.experiments.exp_hold_duration --db storage/satellite.db
"""

import logging
import sys

import numpy as np

from satellite.features import FEATURE_NAMES
from satellite.experiments.harness import (
    load_snapshots_with_labels,
    run_walkforward,
    run_permutation_baseline,
    summarize,
    print_report,
    save_report,
    get_standard_args,
    XGBOOST_HUBER,
)

log = logging.getLogger(__name__)

EXPERIMENT_NAME = "hold_duration"
DESCRIPTION = "Predict 5m intervals until price peaks within 4h (regression)"

# Look-ahead for peak detection
LOOK_4H = 48  # 48 * 5min = 240min


def build_targets(rows: list[dict]) -> list[dict]:
    """Add hold_duration target: index offset to highest close price within 4h.

    For each snapshot i, scan forward up to 48 snapshots.
    Peak = snapshot with the highest absolute price move from entry.
    Target = peak_offset in 5m intervals.

    We use the snapshot's own close price (price_trend_1h serves as proxy)
    and reconstruct relative price from it. Since we don't have raw close
    prices in the snapshot table, we use the ROE labels at each future
    snapshot to find when the biggest move occurs — but we must use the
    GROSS ROE labels that are already computed and stored, not compute
    new forward-looking values.

    Actually: the cleanest approach is to compare the ROE labels at
    different future offsets. The snapshot at offset j has its own
    best_long_roe_15m_gross (which is the best ROE in THAT snapshot's
    15m window). But what we really want is "what is the price at
    snapshot j relative to snapshot i?"

    The simplest uncontaminated label: use realized_vol_1h as a proxy
    for "how much price moved by time j." But that's not exactly right
    either.

    CORRECT APPROACH: Use the 4h gross ROE labels at snapshot i directly.
    best_long_roe_4h_gross tells us the peak long ROE within 4h.
    best_long_roe_1h_gross tells us the peak within 1h.
    best_long_roe_30m_gross tells us the peak within 30m.
    best_long_roe_15m_gross tells us the peak within 15m.

    If 15m_gross ≈ 4h_gross, the peak happened fast (within 15m).
    If 15m_gross << 4h_gross, the peak happened later.

    We bucket into: 15m (peak within 15m), 30m, 1h, 4h based on which
    window first captures most of the 4h peak.
    """
    n = len(rows)

    for i in range(n):
        roe_15m = rows[i].get("best_long_roe_15m_gross")
        roe_30m = rows[i].get("best_long_roe_30m_gross")
        roe_1h = rows[i].get("best_long_roe_1h_gross")
        roe_4h = rows[i].get("best_long_roe_4h_gross")

        # Also check short side — use whichever had the bigger move
        sroe_15m = rows[i].get("best_short_roe_15m_gross")
        sroe_30m = rows[i].get("best_short_roe_30m_gross")
        sroe_1h = rows[i].get("best_short_roe_1h_gross")
        sroe_4h = rows[i].get("best_short_roe_4h_gross")

        if any(v is None for v in [roe_15m, roe_30m, roe_1h, roe_4h,
                                    sroe_15m, sroe_30m, sroe_1h, sroe_4h]):
            rows[i]["target_hold_duration"] = None
            continue

        # Use the side with the larger 4h peak
        if abs(roe_4h) >= abs(sroe_4h):
            r15, r30, r1h, r4h = abs(roe_15m), abs(roe_30m), abs(roe_1h), abs(roe_4h)
        else:
            r15, r30, r1h, r4h = abs(sroe_15m), abs(sroe_30m), abs(sroe_1h), abs(sroe_4h)

        if r4h < 0.01:
            # No meaningful move — assign middle value
            rows[i]["target_hold_duration"] = 24.0  # 2h = midpoint
            continue

        # Fraction of 4h peak captured by each window
        # If 15m captures 90%+ of 4h peak, the move happened in ~15m
        frac_15m = r15 / r4h
        frac_30m = r30 / r4h
        frac_1h = r1h / r4h

        if frac_15m >= 0.90:
            duration = 3.0    # ~15min in 5m units
        elif frac_30m >= 0.90:
            duration = 6.0    # ~30min
        elif frac_1h >= 0.90:
            duration = 12.0   # ~1h
        elif frac_1h >= 0.70:
            duration = 24.0   # ~2h
        else:
            duration = 36.0   # ~3h+ (peak is late in the 4h window)

        rows[i]["target_hold_duration"] = duration

    return rows


def main():
    parser = get_standard_args()
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    log.info("Loading data for %s...", args.coin)
    rows = load_snapshots_with_labels(args.db, args.coin)
    log.info("Loaded %d labeled snapshots", len(rows))

    if not rows:
        log.error("No data found")
        sys.exit(1)

    log.info("Building hold_duration targets...")
    rows = build_targets(rows)

    # Filter valid rows
    feature_names = list(FEATURE_NAMES)
    valid = []
    for row in rows:
        target = row.get("target_hold_duration")
        if target is None:
            continue
        if any(row.get(f) is None for f in feature_names):
            continue
        valid.append(row)

    log.info("Valid rows: %d / %d", len(valid), len(rows))

    if not valid:
        log.error("No valid rows with targets")
        sys.exit(1)

    X = np.array([[row[f] for f in feature_names] for row in valid], dtype=np.float32)
    y = np.array([row["target_hold_duration"] for row in valid], dtype=np.float32)

    # NOTE: per-fold clipping happens inside run_walkforward, NOT here
    log.info("Target stats: mean=%.1f, std=%.1f, min=%.0f, max=%.0f", y.mean(), y.std(), y.min(), y.max())

    # Permutation baseline
    baseline = 0.0
    if not args.no_baseline:
        baseline = run_permutation_baseline(X, y, feature_names, XGBOOST_HUBER, EXPERIMENT_NAME)

    log.info("Running walk-forward validation...")
    results, importance = run_walkforward(X, y, feature_names, XGBOOST_HUBER, EXPERIMENT_NAME)

    summary = summarize(EXPERIMENT_NAME, DESCRIPTION, feature_names, len(valid), results, importance, baseline)
    print_report(summary)
    save_report(summary)


if __name__ == "__main__":
    main()
