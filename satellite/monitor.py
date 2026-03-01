"""Health monitoring and daily reporting for the ML pipeline.

Tracks:
  - Snapshot pipeline health (are snapshots being written?)
  - Model prediction metrics (rolling MAE, precision, win rate)
  - Feature value integrity (drift detection, range violations)
  - System health (DB size, latency, errors)

Reports are logged daily and can be sent to Discord via daemon integration.
"""

import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from satellite.features import AVAIL_COLUMNS, FEATURE_NAMES

log = logging.getLogger(__name__)


@dataclass
class HealthReport:
    """Daily health report for the ML system."""

    report_time: float
    report_date: str

    # Pipeline health
    snapshots_24h: int
    snapshots_expected: int       # 288 per coin * N coins
    snapshot_gap_max_seconds: float
    labeling_backlog: int         # unlabeled snapshots older than 4h

    # Model performance (last 24h)
    predictions_24h: int
    trades_24h: int
    win_rate_24h: float
    cumulative_roe_24h: float
    mean_predicted_roe: float
    mean_actual_roe: float | None

    # Feature integrity
    features_with_zero_variance: list[str] = field(default_factory=list)
    features_with_nulls: dict[str, int] = field(default_factory=dict)
    availability_rates: dict[str, float] = field(default_factory=dict)

    # System
    db_size_mb: float = 0.0
    errors_24h: int = 0

    @property
    def is_healthy(self) -> bool:
        """Quick health check."""
        snapshot_rate = self.snapshots_24h / max(self.snapshots_expected, 1)
        return (
            snapshot_rate > 0.9     # >90% of expected snapshots written
            and self.snapshot_gap_max_seconds < 900  # no gaps > 15min
            and self.labeling_backlog < 500           # not falling behind
        )

    @property
    def summary(self) -> str:
        """One-line health summary."""
        status = "HEALTHY" if self.is_healthy else "DEGRADED"
        return (
            f"[{status}] Snapshots: {self.snapshots_24h}/"
            f"{self.snapshots_expected}, "
            f"Predictions: {self.predictions_24h}, "
            f"WR: {self.win_rate_24h:.1%}, "
            f"ROE: {self.cumulative_roe_24h:+.1f}%"
        )


def _compute_mean_predicted_roe(
    conn: object, cutoff: float,
) -> float:
    """Compute mean predicted ROE from predictions table."""
    try:
        row = conn.execute(
            "SELECT AVG(CASE WHEN signal = 'long' THEN predicted_long_roe "
            "WHEN signal = 'short' THEN predicted_short_roe END) as avg_roe "
            "FROM predictions WHERE predicted_at >= ? "
            "AND signal IN ('long', 'short')",
            (cutoff,),
        ).fetchone()
        return (
            float(row["avg_roe"])
            if row and row["avg_roe"] is not None
            else 0.0
        )
    except Exception:
        return 0.0


def _find_zero_variance_features(
    conn: object, cutoff: float,
) -> list[str]:
    """Find features with zero variance in last 24h (data issues)."""
    zero_var = []
    for name in FEATURE_NAMES:
        try:
            row = conn.execute(
                f"SELECT MIN({name}) as lo, MAX({name}) as hi "
                f"FROM snapshots WHERE created_at >= ?",
                (cutoff,),
            ).fetchone()
            if row and row["lo"] is not None and row["lo"] == row["hi"]:
                zero_var.append(name)
        except Exception:
            pass
    return zero_var


def _find_null_features(
    conn: object, cutoff: float,
) -> dict[str, int]:
    """Count NULL values per feature in last 24h."""
    nulls = {}
    for name in FEATURE_NAMES:
        try:
            row = conn.execute(
                f"SELECT COUNT(*) as n FROM snapshots "
                f"WHERE created_at >= ? AND {name} IS NULL",
                (cutoff,),
            ).fetchone()
            if row and row["n"] > 0:
                nulls[name] = row["n"]
        except Exception:
            pass
    return nulls


def _compute_availability_rates(
    conn: object, cutoff: float,
) -> dict[str, float]:
    """Compute availability rate per avail column in last 24h."""
    rates = {}
    for col in AVAIL_COLUMNS:
        try:
            row = conn.execute(
                f"SELECT AVG(CAST({col} AS REAL)) as rate "
                f"FROM snapshots WHERE created_at >= ?",
                (cutoff,),
            ).fetchone()
            rates[col] = (
                float(row["rate"])
                if row and row["rate"] is not None
                else 0.0
            )
        except Exception:
            pass
    return rates


def generate_health_report(
    store: object,
    coins: list[str],
) -> HealthReport:
    """Generate a health report from satellite.db data.

    Args:
        store: SatelliteStore instance.
        coins: List of tracked coins.

    Returns:
        HealthReport with all metrics populated.
    """
    now = time.time()
    cutoff_24h = now - 86400
    conn = store.conn

    # Snapshot counts
    snap_count = conn.execute(
        "SELECT COUNT(*) as n FROM snapshots WHERE created_at >= ?",
        (cutoff_24h,),
    ).fetchone()["n"]

    expected = 288 * len(coins)  # 300s intervals * 24h = 288 per coin

    # Max gap between consecutive snapshots
    gap_query = """
        SELECT MAX(gap) as max_gap FROM (
            SELECT created_at - LAG(created_at) OVER (
                PARTITION BY coin ORDER BY created_at
            ) as gap
            FROM snapshots WHERE created_at >= ?
        ) WHERE gap IS NOT NULL
    """
    gap_row = conn.execute(gap_query, (cutoff_24h,)).fetchone()
    max_gap = (
        float(gap_row["max_gap"])
        if gap_row and gap_row["max_gap"] is not None
        else 0.0
    )

    # Labeling backlog
    backlog = conn.execute(
        """
        SELECT COUNT(*) as n FROM snapshots s
        LEFT JOIN snapshot_labels sl ON s.snapshot_id = sl.snapshot_id
        WHERE s.created_at < ? AND sl.snapshot_id IS NULL
        """,
        (now - 14400,),  # older than 4h
    ).fetchone()["n"]

    # Prediction counts
    pred_count = 0
    try:
        pred_count = conn.execute(
            "SELECT COUNT(*) as n FROM predictions "
            "WHERE predicted_at >= ?",
            (cutoff_24h,),
        ).fetchone()["n"]
    except Exception:
        pass  # predictions table may not exist yet

    # Feature integrity
    zero_var = _find_zero_variance_features(conn, cutoff_24h)
    nulls = _find_null_features(conn, cutoff_24h)
    avail_rates = _compute_availability_rates(conn, cutoff_24h)

    # DB size
    db_path = store._path
    db_size_mb = (
        os.path.getsize(db_path) / (1024 * 1024)
        if db_path.exists()
        else 0.0
    )

    return HealthReport(
        report_time=now,
        report_date=datetime.fromtimestamp(
            now, tz=timezone.utc,
        ).strftime("%Y-%m-%d"),
        snapshots_24h=snap_count,
        snapshots_expected=expected,
        snapshot_gap_max_seconds=max_gap,
        labeling_backlog=backlog,
        predictions_24h=pred_count,
        trades_24h=0,             # populated from daemon trade log
        win_rate_24h=0.0,         # populated from daemon trade log
        cumulative_roe_24h=0.0,   # populated from daemon trade log
        mean_predicted_roe=_compute_mean_predicted_roe(conn, cutoff_24h),
        mean_actual_roe=None,
        features_with_zero_variance=zero_var,
        features_with_nulls=nulls,
        availability_rates=avail_rates,
        db_size_mb=db_size_mb,
    )
