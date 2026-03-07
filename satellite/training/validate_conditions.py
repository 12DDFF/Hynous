"""Live validation of condition models against actual outcomes.

Two modes:
  --live     True forward-test: uses predictions the daemon actually made
             in real-time, stored in condition_predictions table, and
             compares against labels (actual outcomes). Requires the system
             to have been running long enough for labels to exist.

  (default)  Retroactive backtest: re-runs models on historical snapshots
             and compares to labels. Useful but not a true live test.

Usage:
    # True live validation (predictions daemon actually made)
    python -m satellite.training.validate_conditions --live

    # Retroactive backtest (re-run models on history)
    python -m satellite.training.validate_conditions --days 7 --coin BTC
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

# Map condition model names to the label/snapshot columns they predict
_TARGET_ACTUAL_MAP = {
    "vol_1h": ("target_vol_1h", 12),       # realized_vol_1h 12 snapshots ahead
    "vol_4h": ("target_vol_4h", 48),        # avg realized_vol over 48 snapshots
    "range_30m": ("target_range_30m", 6),   # from 30m labels
    "move_30m": ("target_move_30m", 6),     # from 30m labels
    "volume_1h": ("target_volume_1h", 12),  # volume ratio 12 snapshots ahead
    "entry_quality": ("target_entry_quality", 6),
    "mae_short": ("target_mae_short", 6),   # from 30m labels
    "vol_expand": ("target_vol_expand", 12),
    "mae_long": ("target_mae_long", 6),     # from 30m labels
    "funding_4h": ("target_funding_4h", 48),
}


def _compute_metrics(predictions: np.ndarray, actuals: np.ndarray) -> dict:
    """Compute all validation metrics for a prediction/actual pair."""
    sp, p_value = spearmanr(actuals, predictions)
    mae = float(np.mean(np.abs(actuals - predictions)))
    centered_dir = 100 * float(np.mean(
        np.sign(actuals - np.mean(actuals)) == np.sign(predictions - np.mean(predictions))
    ))
    corr = float(np.corrcoef(actuals, predictions)[0, 1])

    # Extreme detection: when model says top 10%, is actual also above median?
    p90_pred = np.percentile(predictions, 90)
    extreme_mask = predictions >= p90_pred
    extreme_hit_rate = None
    if extreme_mask.sum() > 5:
        actual_median = np.median(actuals)
        extreme_hit_rate = 100 * float(np.mean(actuals[extreme_mask] > actual_median))

    return {
        "spearman": round(float(sp), 4),
        "p_value": round(float(p_value), 6),
        "pearson": round(corr, 4),
        "mae": round(mae, 4),
        "centered_dir_pct": round(centered_dir, 1),
        "extreme_hit_rate_pct": round(extreme_hit_rate, 1) if extreme_hit_rate is not None else None,
    }


# ─── Live Validation ────────────────────────────────────────────────────────

def validate_live(
    db_path: str,
    coin: str = "BTC",
    days: int = 7,
) -> list[dict]:
    """True forward-test using predictions the daemon actually made.

    Joins condition_predictions (what the model predicted in real-time)
    with snapshot_labels (what actually happened) via snapshot_id.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    cutoff = time.time() - days * 86400

    # Check how many live predictions exist
    count = conn.execute(
        "SELECT COUNT(*) as n FROM condition_predictions WHERE coin = ? AND predicted_at > ?",
        (coin, cutoff),
    ).fetchone()["n"]

    if count == 0:
        log.error(
            "No live predictions found for %s. "
            "The daemon needs to run with condition models for predictions to accumulate. "
            "Check back in 1-4 hours.",
            coin,
        )
        conn.close()
        return []

    log.info("Found %d live predictions for %s", count, coin)

    # Load all snapshots+labels that have live predictions
    rows = conn.execute(
        """
        SELECT s.*, l.*
        FROM snapshots s
        JOIN snapshot_labels l ON s.snapshot_id = l.snapshot_id
        JOIN (
            SELECT DISTINCT snapshot_id FROM condition_predictions
            WHERE coin = ? AND predicted_at > ?
        ) cp ON cp.snapshot_id = s.snapshot_id
        WHERE s.coin = ? AND l.label_version > 0
        ORDER BY s.created_at ASC
        """,
        (coin, cutoff, coin),
    ).fetchall()

    labeled_ids = {dict(r)["snapshot_id"] for r in rows}
    rows = [dict(r) for r in rows]

    if not rows:
        # Predictions exist but no labels yet — need to wait
        oldest = conn.execute(
            "SELECT MIN(predicted_at) as t FROM condition_predictions WHERE coin = ? AND predicted_at > ?",
            (coin, cutoff),
        ).fetchone()["t"]
        age_h = (time.time() - oldest) / 3600
        log.error(
            "Predictions exist but no labels yet (oldest prediction: %.1fh ago). "
            "Labels require 4h+ of wait time. Check back later.", age_h,
        )
        conn.close()
        return []

    # Build targets from the labeled snapshots
    rows_by_id = {r["snapshot_id"]: r for r in rows}
    rows = build_condition_targets(rows)

    # Load live predictions grouped by model
    pred_rows = conn.execute(
        """
        SELECT model_name, snapshot_id, predicted_value, percentile, regime
        FROM condition_predictions
        WHERE coin = ? AND predicted_at > ?
        ORDER BY predicted_at ASC
        """,
        (coin, cutoff),
    ).fetchall()
    conn.close()

    # Group predictions by model
    model_preds: dict[str, list[tuple[str, float]]] = {}
    for pr in pred_rows:
        pr = dict(pr)
        name = pr["model_name"]
        sid = pr["snapshot_id"]
        if name not in model_preds:
            model_preds[name] = []
        model_preds[name].append((sid, pr["predicted_value"]))

    # Build snapshot lookup for targets
    target_lookup = {r["snapshot_id"]: r for r in rows}

    results = []
    for target in CONDITION_TARGETS:
        name = target.name
        target_col = target.build_fn_name

        if name not in model_preds:
            results.append({"name": name, "status": "no_predictions", "samples": 0})
            continue

        predictions = []
        actuals = []

        for sid, pred_value in model_preds[name]:
            row = target_lookup.get(sid)
            if row is None:
                continue  # no label yet for this snapshot
            actual = row.get(target_col)
            if actual is None:
                continue
            predictions.append(pred_value)
            actuals.append(actual)

        if len(predictions) < 10:
            results.append({
                "name": name,
                "status": "insufficient_data",
                "samples": len(predictions),
                "labeled": len([s for s, _ in model_preds[name] if s in labeled_ids]),
                "total_predictions": len(model_preds[name]),
            })
            continue

        preds_arr = np.array(predictions)
        acts_arr = np.array(actuals)

        metrics = _compute_metrics(preds_arr, acts_arr)
        result = {"name": name, "status": "success", "samples": len(predictions), **metrics}
        results.append(result)

        log.info(
            "  %-15s spearman=%+.4f  pearson=%+.4f  mae=%.4f  dir=%.1f%%  extreme_hit=%-5s  (%d samples)",
            name, metrics["spearman"], metrics["pearson"], metrics["mae"],
            metrics["centered_dir_pct"],
            f"{metrics['extreme_hit_rate_pct']:.0f}%" if metrics.get("extreme_hit_rate_pct") is not None else "N/A",
            len(predictions),
        )

    return results


# ─── Retroactive Backtest ───────────────────────────────────────────────────

def validate_backtest(
    db_path: str,
    artifacts_dir: str,
    coin: str = "BTC",
    days: int = 7,
    since_training: bool = True,
) -> list[dict]:
    """Retroactive backtest: re-run models on historical snapshots."""
    engine = ConditionEngine(Path(artifacts_dir))
    if engine.model_count == 0:
        log.error("No condition models found in %s", artifacts_dir)
        return []

    # Get model creation time
    model_created_at = 0.0
    if since_training:
        for name in engine.model_names:
            meta_path = Path(artifacts_dir) / name / "metadata.json"
            if meta_path.exists():
                with open(meta_path) as f:
                    meta = json.load(f)
                from datetime import datetime
                created = datetime.fromisoformat(meta["created_at"])
                model_created_at = max(model_created_at, created.timestamp())

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    cutoff = time.time() - days * 86400
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
        log.error("No labeled snapshots found for %s", coin)
        return []

    log.info("Loaded %d labeled snapshots for backtest (%s)", len(rows), coin)
    rows = build_condition_targets(rows)

    feature_names = list(FEATURE_NAMES)
    results = []

    for target in CONDITION_TARGETS:
        target_col = target.build_fn_name
        predictions = []
        actuals = []

        for row in rows:
            actual = row.get(target_col)
            if actual is None:
                continue
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

            conditions = engine.predict(coin, features)
            pred = conditions.predictions.get(target.name)
            if pred is None:
                continue
            predictions.append(pred.value)
            actuals.append(actual)

        if len(predictions) < 50:
            results.append({
                "name": target.name, "status": "insufficient_data",
                "samples": len(predictions),
            })
            continue

        preds_arr = np.array(predictions)
        acts_arr = np.array(actuals)
        metrics = _compute_metrics(preds_arr, acts_arr)
        result = {"name": target.name, "status": "success", "samples": len(predictions), **metrics}
        results.append(result)

        log.info(
            "  %-15s spearman=%+.4f  pearson=%+.4f  mae=%.4f  dir=%.1f%%  extreme_hit=%-5s  (%d samples)",
            target.name, metrics["spearman"], metrics["pearson"], metrics["mae"],
            metrics["centered_dir_pct"],
            f"{metrics['extreme_hit_rate_pct']:.0f}%" if metrics.get("extreme_hit_rate_pct") is not None else "N/A",
            len(predictions),
        )

    return results


# ─── CLI ────────────────────────────────────────────────────────────────────

def _print_results(results: list[dict], mode: str):
    """Print results table."""
    print("\n" + "=" * 70)
    print(f"{'Model':<16} {'Spearman':>9} {'Pearson':>8} {'MAE':>8} {'Dir%':>6} {'ExtHit':>7} {'N':>6}")
    print("-" * 70)
    for r in results:
        if r.get("status") != "success":
            detail = r.get("status", "")
            if r.get("total_predictions"):
                detail += f" ({r['total_predictions']} preds, {r.get('labeled', 0)} labeled)"
            elif r.get("samples", 0) > 0:
                detail += f" ({r['samples']} samples)"
            print(f"{r['name']:<16} {detail}")
            continue
        ext = f"{r['extreme_hit_rate_pct']:.0f}%" if r.get("extreme_hit_rate_pct") is not None else "N/A"
        print(
            f"{r['name']:<16} {r['spearman']:>+8.4f} {r['pearson']:>+8.4f} "
            f"{r['mae']:>8.4f} {r['centered_dir_pct']:>5.1f}% {ext:>7} {r['samples']:>6}"
        )
    print("=" * 70)

    if mode == "live":
        print("\nThis is a TRUE forward-test — predictions were made in real-time")
        print("by the daemon, then compared to actual outcomes after the fact.")
    else:
        print("\nThis is a retroactive BACKTEST — models were re-run on history.")
        print("Use --live for true forward-test (requires daemon to have been running).")

    print("\nInterpretation:")
    print("  Spearman > 0.3  = model rankings match reality")
    print("  Dir%     > 55%  = better than coin flip at above/below average")
    print("  ExtHit   > 60%  = extreme predictions correctly flag high outcomes")
    print()


def main():
    parser = argparse.ArgumentParser(description="Validate condition models")
    parser.add_argument("--db", default="storage/satellite.db")
    parser.add_argument("--artifacts", default="satellite/artifacts/conditions")
    parser.add_argument("--coin", default="BTC")
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--live", action="store_true",
                        help="True forward-test using daemon's stored predictions")
    parser.add_argument("--all-data", action="store_true",
                        help="Backtest: use all data, not just post-training")
    parser.add_argument("-v", "--verbose", action="store_true")

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    mode = "live" if args.live else "backtest"

    print("\n" + "=" * 70)
    print(f"CONDITION MODEL VALIDATION — {mode.upper()}")
    print(f"Coin: {args.coin}  |  Window: {args.days} days")
    print("=" * 70 + "\n")

    if args.live:
        results = validate_live(db_path=args.db, coin=args.coin, days=args.days)
    else:
        results = validate_backtest(
            db_path=args.db, artifacts_dir=args.artifacts,
            coin=args.coin, days=args.days,
            since_training=not args.all_data,
        )

    if results:
        _print_results(results, mode)


if __name__ == "__main__":
    main()
