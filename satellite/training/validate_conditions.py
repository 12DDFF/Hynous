"""Live validation of condition models against actual outcomes.

Compares model predictions against ground-truth labels to measure
real out-of-sample accuracy. Uses only snapshots created AFTER model
training (true forward-test, not backtest).

Usage:
    python -m satellite.training.validate_conditions
    python -m satellite.training.validate_conditions --days 3 --coin BTC
"""

import argparse
import json
import logging
import sqlite3
import time
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr

from satellite.features import FEATURE_NAMES
from satellite.training.train_conditions import (
    CONDITION_TARGETS,
    build_condition_targets,
)
from satellite.conditions import ConditionEngine

log = logging.getLogger(__name__)


def validate_conditions(
    db_path: str,
    artifacts_dir: str,
    coin: str = "BTC",
    days: int = 7,
    since_training: bool = True,
) -> list[dict]:
    """Validate all condition models against actual labeled outcomes.

    Args:
        db_path: Path to satellite.db.
        artifacts_dir: Path to artifacts/conditions/ directory.
        coin: Coin to validate.
        days: How many days of data to use (from most recent).
        since_training: If True, only use snapshots after model was trained.

    Returns:
        List of per-model validation results.
    """
    engine = ConditionEngine(Path(artifacts_dir))
    if engine.model_count == 0:
        log.error("No condition models found in %s", artifacts_dir)
        return []

    # Get model creation time (to filter post-training data only)
    model_created_at = 0.0
    if since_training:
        for name in engine.model_names:
            meta_path = Path(artifacts_dir) / name / "metadata.json"
            if meta_path.exists():
                with open(meta_path) as f:
                    meta = json.load(f)
                from datetime import datetime, timezone
                created = datetime.fromisoformat(meta["created_at"])
                ts = created.timestamp()
                model_created_at = max(model_created_at, ts)

    # Load labeled snapshots
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    cutoff = time.time() - days * 86400
    # Use the later of: N days ago, or model training time
    if since_training and model_created_at > cutoff:
        cutoff = model_created_at
        log.info("Using post-training cutoff: %s", time.ctime(cutoff))

    rows = conn.execute(
        """
        SELECT s.*, l.*
        FROM snapshots s
        JOIN snapshot_labels l ON s.snapshot_id = l.snapshot_id
        WHERE s.coin = ? AND s.created_at > ? AND l.label_version > 0
        ORDER BY s.created_at ASC
        """,
        (coin, cutoff),
    ).fetchall()
    conn.close()

    rows = [dict(r) for r in rows]
    if not rows:
        log.error("No labeled post-training snapshots found for %s", coin)
        return []

    log.info("Loaded %d labeled snapshots for validation (%s)", len(rows), coin)

    # Build targets (same as training — computes actual outcomes)
    rows = build_condition_targets(rows)

    # Run predictions on each snapshot and compare
    feature_names = list(FEATURE_NAMES)
    results = []

    for target in CONDITION_TARGETS:
        target_col = target.build_fn_name  # e.g. "target_vol_1h"

        predictions = []
        actuals = []

        for row in rows:
            actual = row.get(target_col)
            if actual is None:
                continue

            # Check all features present
            features = {}
            skip = False
            for f in feature_names:
                v = row.get(f)
                if v is None:
                    skip = True
                    break
                features[f] = v
            if skip:
                continue

            # Run model prediction
            conditions = engine.predict(coin, features)
            pred = conditions.predictions.get(target.name)
            if pred is None:
                continue

            predictions.append(pred.value)
            actuals.append(actual)

        if len(predictions) < 50:
            log.warning(
                "%-15s: insufficient data (%d samples)",
                target.name, len(predictions),
            )
            results.append({
                "name": target.name,
                "status": "insufficient_data",
                "samples": len(predictions),
            })
            continue

        predictions = np.array(predictions)
        actuals = np.array(actuals)

        # Metrics
        sp, p_value = spearmanr(actuals, predictions)
        mae = float(np.mean(np.abs(actuals - predictions)))
        centered_dir = 100 * float(np.mean(
            np.sign(actuals - np.mean(actuals)) == np.sign(predictions - np.mean(predictions))
        ))

        # Directional accuracy for regime calls
        # "Did the model correctly identify above/below median?"
        median_actual = np.median(actuals)
        median_pred = np.median(predictions)
        directional_acc = 100 * float(np.mean(
            (actuals > median_actual) == (predictions > median_pred)
        ))

        # Correlation
        corr = float(np.corrcoef(actuals, predictions)[0, 1])

        # Extreme detection: when model says "extreme" (top 10%), is actual also high?
        p90_pred = np.percentile(predictions, 90)
        extreme_mask = predictions >= p90_pred
        if extreme_mask.sum() > 5:
            actual_when_extreme = actuals[extreme_mask]
            actual_median = np.median(actuals)
            extreme_hit_rate = 100 * float(np.mean(actual_when_extreme > actual_median))
        else:
            extreme_hit_rate = None

        result = {
            "name": target.name,
            "status": "success",
            "samples": len(predictions),
            "spearman": round(float(sp), 4),
            "p_value": round(float(p_value), 6),
            "pearson": round(corr, 4),
            "mae": round(mae, 4),
            "centered_dir_pct": round(centered_dir, 1),
            "directional_acc_pct": round(directional_acc, 1),
            "extreme_hit_rate_pct": round(extreme_hit_rate, 1) if extreme_hit_rate is not None else None,
        }
        results.append(result)

        log.info(
            "  %-15s spearman=%+.4f  pearson=%+.4f  mae=%.4f  dir=%.1f%%  extreme_hit=%-5s  (%d samples)",
            target.name,
            sp,
            corr,
            mae,
            centered_dir,
            f"{extreme_hit_rate:.0f}%" if extreme_hit_rate is not None else "N/A",
            len(predictions),
        )

    return results


def main():
    parser = argparse.ArgumentParser(description="Validate condition models against actual outcomes")
    parser.add_argument("--db", default="storage/satellite.db", help="Path to satellite.db")
    parser.add_argument("--artifacts", default="satellite/artifacts/conditions", help="Artifacts directory")
    parser.add_argument("--coin", default="BTC", help="Coin to validate")
    parser.add_argument("--days", type=int, default=7, help="Days of data to validate on")
    parser.add_argument("--all-data", action="store_true", help="Use all data, not just post-training")
    parser.add_argument("-v", "--verbose", action="store_true")

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    print("\n" + "=" * 70)
    print("CONDITION MODEL LIVE VALIDATION")
    print(f"Coin: {args.coin}  |  Window: {args.days} days  |  Post-training only: {not args.all_data}")
    print("=" * 70 + "\n")

    results = validate_conditions(
        db_path=args.db,
        artifacts_dir=args.artifacts,
        coin=args.coin,
        days=args.days,
        since_training=not args.all_data,
    )

    # Summary table
    print("\n" + "=" * 70)
    print(f"{'Model':<16} {'Spearman':>9} {'Pearson':>8} {'MAE':>8} {'Dir%':>6} {'ExtHit':>7} {'N':>6}")
    print("-" * 70)
    for r in results:
        if r.get("status") != "success":
            print(f"{r['name']:<16} {'— ' + r.get('status', ''):>50}")
            continue
        ext = f"{r['extreme_hit_rate_pct']:.0f}%" if r.get("extreme_hit_rate_pct") is not None else "N/A"
        print(
            f"{r['name']:<16} {r['spearman']:>+8.4f} {r['pearson']:>+8.4f} "
            f"{r['mae']:>8.4f} {r['centered_dir_pct']:>5.1f}% {ext:>7} {r['samples']:>6}"
        )
    print("=" * 70)

    # Interpretation guide
    print("\nInterpretation:")
    print("  Spearman > 0.3  = model rankings match reality")
    print("  Dir%     > 55%  = better than coin flip at above/below average")
    print("  ExtHit   > 60%  = extreme predictions correctly flag high outcomes")
    print()


if __name__ == "__main__":
    main()
