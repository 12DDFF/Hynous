"""Rolling signal quality evaluation for entry-outcome feedback.

Computes per-signal IC (Spearman rank correlation) and composite
score ECE (Expected Calibration Error) from entry_snapshots table.
Called periodically by daemon (daily or after N closed trades).
"""

import logging
import math

log = logging.getLogger(__name__)


def compute_rolling_ic(store, window: int = 10) -> dict[str, float]:
    """Compute Spearman IC for each signal against trade outcome ROE.

    Args:
        store: SatelliteStore with entry_snapshots table.
        window: Last N closed trades to evaluate. Default 10 (tightened
            from 30 in phase-8 new-M1 so the evaluator matches the
            updater's default ``min_trades``).

    Returns:
        Dict of {signal_name: spearman_rho}. Positive = signal predicts winners.
    """
    rows = store.conn.execute(
        "SELECT composite_score, entry_quality_pctl, vol_1h_pctl, "
        "funding_4h_pctl, mae_long_pctl, mae_short_pctl, outcome_roe "
        "FROM entry_snapshots WHERE outcome_won IS NOT NULL "
        "ORDER BY close_time DESC LIMIT ?",
        (window,),
    ).fetchall()

    if len(rows) < 10:
        return {}

    rows = [dict(r) for r in rows]
    outcomes = [r["outcome_roe"] for r in rows]
    ics = {}

    signal_cols = {
        "composite_score": "composite_score",
        "entry_quality": "entry_quality_pctl",
        "vol_1h": "vol_1h_pctl",
        "funding_4h": "funding_4h_pctl",
    }

    for name, col in signal_cols.items():
        vals = [r[col] for r in rows if r[col] is not None]
        if len(vals) >= 10:
            rho = _spearman(vals[:len(outcomes)], outcomes[:len(vals)])
            if rho is not None:
                ics[name] = round(rho, 4)

    return ics


def compute_calibration_error(store, n_bins: int = 5, window: int = 50) -> float:
    """Compute Expected Calibration Error for composite score.

    Bins entries by composite score, compares score/100 (predicted win rate)
    vs actual win rate per bin.

    Returns:
        ECE (0-1, lower is better). -1.0 if insufficient data.
    """
    rows = store.conn.execute(
        "SELECT composite_score, outcome_won FROM entry_snapshots "
        "WHERE outcome_won IS NOT NULL ORDER BY close_time DESC LIMIT ?",
        (window,),
    ).fetchall()

    if len(rows) < 10:
        return -1.0

    rows = [dict(r) for r in rows]
    bin_size = 100.0 / n_bins
    ece = 0.0
    total = len(rows)

    for i in range(n_bins):
        lo = i * bin_size
        hi = (i + 1) * bin_size
        bin_rows = [r for r in rows if lo <= r["composite_score"] < hi]
        if not bin_rows:
            continue
        predicted = sum(r["composite_score"] / 100.0 for r in bin_rows) / len(bin_rows)
        actual = sum(r["outcome_won"] for r in bin_rows) / len(bin_rows)
        ece += len(bin_rows) / total * abs(predicted - actual)

    return round(ece, 4)


def _spearman(x: list, y: list) -> float | None:
    """Compute Spearman rank correlation without scipy dependency."""
    n = min(len(x), len(y))
    if n < 5:
        return None

    def _rank(vals):
        indexed = sorted(range(n), key=lambda i: vals[i])
        ranks = [0.0] * n
        for rank, idx in enumerate(indexed):
            ranks[idx] = rank + 1.0
        return ranks

    rx = _rank(x[:n])
    ry = _rank(y[:n])
    d_sq = sum((rx[i] - ry[i]) ** 2 for i in range(n))
    rho = 1.0 - (6 * d_sq) / (n * (n * n - 1))
    return rho
