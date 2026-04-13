"""Adaptive composite score weight adjustment.

After accumulating >= 10 closed trades with entry snapshots,
recompute signal weights proportional to their rolling IC.
Persist to storage/entry_score_weights.json.

Phase 8 new-M1 (2026-04-12): default ``min_trades`` lowered from 30 to 10
to tighten the feedback window. The daily scheduler in
``src/hynous/intelligence/daemon.py`` (86 400 s interval at the ``# 13.
Entry score feedback`` block) already runs this at the cadence the
feedback-loop design document specifies; no change to the scheduler was
required.

Uses EMA smoothing (α=0.3 by default) over the persisted weights so the
daily update reacts on a ~3-update horizon rather than jumping with each
10-trade IC draw.
"""

import json
import logging
from pathlib import Path

from satellite.signal_evaluator import compute_rolling_ic

log = logging.getLogger(__name__)


def _load_prior_weights(output_path: Path) -> dict[str, float]:
    """Load previously-persisted weights as the EMA prior.

    Returns an empty dict on any failure (missing file, malformed JSON,
    non-float values) so the first-run / cold-start path falls through
    cleanly to ``raw`` weights without biasing toward zero.
    """
    if not output_path.exists():
        return {}
    try:
        data = json.loads(output_path.read_text())
    except Exception:
        log.debug("Failed to read prior weights from %s", output_path, exc_info=True)
        return {}
    if not isinstance(data, dict):
        return {}
    prior: dict[str, float] = {}
    for k, v in data.items():
        if isinstance(k, str) and isinstance(v, (int, float)):
            prior[k] = float(v)
        else:
            return {}
    return prior


def update_weights(
    store,
    output_path: Path,
    min_trades: int = 10,
    smoothing_alpha: float = 0.3,
) -> dict[str, float] | None:
    """Recompute composite score weights from rolling IC.

    Args:
        store: SatelliteStore with entry_snapshots table.
        output_path: Path to write weights JSON (atomic write).
        min_trades: Minimum closed trades before adjusting. Default 10
            (tightened from 30 in phase-8 new-M1 so the daily scheduler
            reacts to short-horizon IC shifts).
        smoothing_alpha: EMA blend factor in ``[0, 1]``. ``new = α * raw +
            (1 - α) * prior``. Default 0.3 gives a ~3-update effective
            horizon. Cold start (no prior file) writes ``raw`` unchanged
            for each key so a first appearance is not biased toward an
            empty prior.

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
        raw = {k: 1.0 / len(ics) for k in ics}
    else:
        raw = {k: v / total_ic for k, v in positive_ics.items()}

    # EMA blend with the previously-persisted weights. Keys new to this
    # batch fall back to raw (no bias toward a missing prior). Keys that
    # have disappeared from raw are dropped (retired signal).
    prior = _load_prior_weights(output_path)
    alpha = smoothing_alpha
    blended: dict[str, float] = {}
    for k, raw_v in raw.items():
        if k in prior:
            blended[k] = alpha * raw_v + (1.0 - alpha) * prior[k]
        else:
            blended[k] = raw_v

    # Renormalise — the blend + cold-start fallback can drift the sum off
    # 1.0, and downstream callers treat weights as a probability vector.
    total = sum(blended.values())
    if total > 0:
        new_weights = {k: v / total for k, v in blended.items()}
    else:
        new_weights = blended

    log.debug("Raw IC weights: %s", raw)
    log.debug("Blended/persisted weights: %s", new_weights)

    # Persist (atomic write pattern from core.persistence)
    try:
        from hynous.core.persistence import _atomic_write
        output_path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write(output_path, json.dumps(new_weights, indent=2))
        log.info("Updated entry score weights: %s", new_weights)
    except Exception:
        log.debug("Failed to persist weights", exc_info=True)

    return new_weights
