"""Adaptive composite score weight adjustment.

After accumulating >= 30 closed trades with entry snapshots,
recompute signal weights proportional to their rolling IC.
Persist to storage/entry_score_weights.json.
"""

import json
import logging
from pathlib import Path

from satellite.signal_evaluator import compute_rolling_ic

log = logging.getLogger(__name__)


def update_weights(store, output_path: Path, min_trades: int = 30) -> dict[str, float] | None:
    """Recompute composite score weights from rolling IC.

    Args:
        store: SatelliteStore with entry_snapshots table.
        output_path: Path to write weights JSON (atomic write).
        min_trades: Minimum closed trades before adjusting.

    Returns:
        New weights dict, or None if insufficient data.
    """
    row = store.conn.execute(
        "SELECT COUNT(*) as cnt FROM entry_snapshots WHERE outcome_won IS NOT NULL"
    ).fetchone()
    if row["cnt"] < min_trades:
        log.info("Weight update skipped: %d/%d trades", row["cnt"], min_trades)
        return None

    ics = compute_rolling_ic(store, window=min_trades)
    if not ics:
        return None

    # Positive IC = signal predicts winners -> keep weight
    # Negative IC = anti-predictive -> zero weight
    positive_ics = {k: max(0.0, v) for k, v in ics.items()}
    total_ic = sum(positive_ics.values())

    if total_ic < 0.01:
        log.warning("All signals have zero/negative IC — using equal weights")
        weights = {k: 1.0 / len(ics) for k in ics}
    else:
        weights = {k: v / total_ic for k, v in positive_ics.items()}

    # Persist (atomic write pattern from core.persistence)
    try:
        from hynous.core.persistence import _atomic_write
        output_path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write(output_path, json.dumps(weights, indent=2))
        log.info("Updated entry score weights: %s", weights)
    except Exception:
        log.debug("Failed to persist weights", exc_info=True)

    return weights
