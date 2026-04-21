"""Diagnostic: compare v2 vs v3 direction model prediction distributions.

Loads recent BTC snapshots from satellite.db, scores them with both model
artifacts, and reports how often each would emit long/short/skip/conflict
under the live entry_threshold=3.0% and conflict_margin=1.0%.
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
from pathlib import Path

import numpy as np
import xgboost as xgb

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SRC_DIR = _REPO_ROOT / "src"
for p in (_SRC_DIR, _REPO_ROOT):
    if p.is_dir() and str(p) not in sys.path:
        sys.path.insert(0, str(p))

log = logging.getLogger("diagnose")


def classify(pred_long: float, pred_short: float, thr: float, margin: float) -> str:
    long_above = pred_long > thr
    short_above = pred_short > thr
    if not long_above and not short_above:
        return "skip"
    if long_above and short_above:
        if abs(pred_long - pred_short) < margin:
            return "conflict"
        return "long" if pred_long > pred_short else "short"
    return "long" if long_above else "short"


def score_artifact(rows, artifact_dir: Path) -> dict:
    from satellite.features import AVAIL_COLUMNS, FEATURE_NAMES
    from satellite.training.artifact import ModelArtifact

    artifact = ModelArtifact.load(artifact_dir)
    scaler = artifact.scaler

    # Build raw feature matrix
    feat_dict = {}
    for name in FEATURE_NAMES:
        feat_dict[name] = np.array(
            [float(r.get(name) if r.get(name) is not None else 0.0) for r in rows],
            dtype=np.float64,
        )
    X = scaler.transform_batch(feat_dict)
    avail_cols = []
    for col in AVAIL_COLUMNS:
        avail_cols.append(
            np.array([r.get(col, 1) for r in rows], dtype=np.float64).reshape(-1, 1),
        )
    X = np.hstack([X] + avail_cols)
    feature_names = list(FEATURE_NAMES) + list(AVAIL_COLUMNS)

    dmat = xgb.DMatrix(X, feature_names=feature_names)
    pred_long = artifact.model_long.predict(dmat)
    pred_short = artifact.model_short.predict(dmat)

    return {
        "pred_long": pred_long,
        "pred_short": pred_short,
        "metadata": artifact.metadata.__dict__,
    }


def summarize(preds_long: np.ndarray, preds_short: np.ndarray, thr: float, margin: float) -> dict:
    signals = [classify(l, s, thr, margin) for l, s in zip(preds_long, preds_short)]
    n = len(signals)
    counts = {sig: signals.count(sig) for sig in ("long", "short", "skip", "conflict")}
    return {
        "n": n,
        "signal_counts": counts,
        "signal_pct": {k: round(v / n * 100, 1) for k, v in counts.items()},
        "long_quantiles": {
            q: round(float(np.quantile(preds_long, q / 100)), 3)
            for q in (5, 25, 50, 75, 95, 99)
        },
        "short_quantiles": {
            q: round(float(np.quantile(preds_short, q / 100)), 3)
            for q in (5, 25, 50, 75, 95, 99)
        },
        "max_long": round(float(preds_long.max()), 3),
        "max_short": round(float(preds_short.max()), 3),
    }


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
    p = argparse.ArgumentParser()
    p.add_argument("--db", default="storage/satellite.db")
    p.add_argument("--v2", default="satellite/artifacts/v2")
    p.add_argument("--v3", default="satellite/artifacts/v3")
    p.add_argument("--coin", default="BTC")
    p.add_argument("--days", type=int, default=14, help="lookback days")
    p.add_argument("--threshold", type=float, default=3.0)
    p.add_argument("--margin", type=float, default=1.0)
    args = p.parse_args(argv)

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cutoff_sql = (
        "SELECT * FROM snapshots WHERE coin = ? "
        "AND created_at >= (SELECT MAX(created_at) FROM snapshots) - ? "
        "ORDER BY created_at ASC"
    )
    lookback_s = args.days * 86400
    rows = [dict(r) for r in conn.execute(cutoff_sql, (args.coin, lookback_s)).fetchall()]
    conn.close()

    if not rows:
        log.error("No rows in window")
        return 1
    log.info("Scored %d snapshots spanning ~%.1f days", len(rows), lookback_s / 86400)

    v2 = score_artifact(rows, Path(args.v2))
    v3 = score_artifact(rows, Path(args.v3))

    v2_summary = summarize(v2["pred_long"], v2["pred_short"], args.threshold, args.margin)
    v3_summary = summarize(v3["pred_long"], v3["pred_short"], args.threshold, args.margin)

    output = {
        "window_days": args.days,
        "rows": len(rows),
        "entry_threshold": args.threshold,
        "conflict_margin": args.margin,
        "v2": v2_summary,
        "v3": v3_summary,
    }
    # Also run at relaxed threshold to show what thresholds WOULD trigger
    for thr in (2.0, 1.5, 1.0, 0.5):
        output[f"v3_at_threshold_{thr}"] = {
            "signal_counts": {
                sig: sum(
                    1 for l, s in zip(v3["pred_long"], v3["pred_short"])
                    if classify(l, s, thr, args.margin) == sig
                )
                for sig in ("long", "short", "skip", "conflict")
            }
        }
    print(json.dumps(output, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
