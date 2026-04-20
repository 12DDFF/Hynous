"""Retrain direction models (v3) directly from satellite.db snapshots.

Unlike scripts/retrain_direction_model.py (which requires closed trades in
the v2 journal — currently zero), this script uses the labeled snapshots
table in satellite.db that the satellite.tick() loop has been populating
continuously since the system went live. It mirrors the library path that
produced the original v2 artifacts in satellite/artifacts/v2/.

Usage (run on VPS, from repo root):
    PYTHONPATH=. .venv/bin/python scripts/retrain_direction_v3_snapshots.py \\
        --db storage/satellite.db --coin BTC --train-split 0.85 \\
        --output satellite/artifacts/v3
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SRC_DIR = _REPO_ROOT / "src"
if _SRC_DIR.is_dir() and str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

log = logging.getLogger("retrain_direction_v3_snapshots")


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--db", default="storage/satellite.db")
    p.add_argument("--coin", default="BTC")
    p.add_argument("--train-split", type=float, default=0.85)
    p.add_argument("--output", default="satellite/artifacts/v3")
    p.add_argument("--version", type=int, default=3)
    args = p.parse_args(argv)

    from satellite.training.pipeline import load_labeled_snapshots, prepare_training_data
    from satellite.training.train import train_both_models, evaluate_model

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    store = SimpleNamespace(conn=conn)
    rows = load_labeled_snapshots(store, args.coin)
    conn.close()

    if not rows:
        log.error("No labeled snapshots for coin=%s", args.coin)
        return 2

    n = len(rows)
    first_ts = rows[0]["created_at"]
    last_ts = rows[-1]["created_at"]
    log.info(
        "Loaded %d labeled snapshots for %s (first=%s, last=%s)",
        n, args.coin,
        datetime.fromtimestamp(first_ts, timezone.utc).isoformat(),
        datetime.fromtimestamp(last_ts, timezone.utc).isoformat(),
    )

    split_idx = int(n * args.train_split)
    train_end_ts = rows[split_idx]["created_at"]
    log.info(
        "Time split at %s (index %d / %d — train=%d, val=%d)",
        datetime.fromtimestamp(train_end_ts, timezone.utc).isoformat(),
        split_idx, n, split_idx, n - split_idx,
    )

    long_data = prepare_training_data(rows, "risk_adj_long_30m", train_end_ts)
    short_data = prepare_training_data(rows, "risk_adj_short_30m", train_end_ts)

    artifact = train_both_models(long_data, short_data, version=args.version)

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    saved = artifact.save(out_dir)
    log.info("Saved artifact to %s", saved)

    long_metrics = evaluate_model(
        artifact.model_long, long_data.X_val, long_data.y_val,
        long_data.feature_names,
    )
    short_metrics = evaluate_model(
        artifact.model_short, short_data.X_val, short_data.y_val,
        short_data.feature_names,
    )

    report = {
        "coin": args.coin,
        "total_rows": n,
        "train_rows": split_idx,
        "val_rows": n - split_idx,
        "train_start": datetime.fromtimestamp(first_ts, timezone.utc).isoformat(),
        "train_end": datetime.fromtimestamp(train_end_ts, timezone.utc).isoformat(),
        "val_end": datetime.fromtimestamp(last_ts, timezone.utc).isoformat(),
        "long_val_mae": long_metrics["mae"],
        "short_val_mae": short_metrics["mae"],
        "long_directional_accuracy": long_metrics["directional_accuracy"],
        "short_directional_accuracy": short_metrics["directional_accuracy"],
        "long_precision_at": {k: v for k, v in long_metrics.items() if k.startswith("precision_at_")},
        "short_precision_at": {k: v for k, v in short_metrics.items() if k.startswith("precision_at_")},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    report_path = out_dir / "training_report.json"
    with report_path.open("w") as f:
        json.dump(report, f, indent=2, sort_keys=True)
    log.info("Wrote training report: %s", report_path)
    log.info(
        "SUMMARY — long: MAE %.3f, dir_acc %.1f%% | short: MAE %.3f, dir_acc %.1f%%",
        long_metrics["mae"], long_metrics["directional_accuracy"] * 100,
        short_metrics["mae"], short_metrics["directional_accuracy"] * 100,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
