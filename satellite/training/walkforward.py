"""Walk-forward validation for time-series model evaluation.

Proves that the model's edge persists across different market conditions
by training on expanding windows and testing on strictly future data.

Protocol:
  Gen 0: Train days 0-60, test days 60-74
  Gen 1: Train days 0-74, test days 74-88
  Gen 2: Train days 0-88, test days 88-102
  ...

Each generation sees more data. Test sets NEVER overlap (true out-of-sample).
"""

import logging
from dataclasses import dataclass, field

import numpy as np

from satellite.training.pipeline import prepare_training_data
from satellite.training.train import evaluate_model, train_model

log = logging.getLogger(__name__)


# ─── Configuration ───────────────────────────────────────────────────────────

MIN_TRAIN_DAYS = 60
TEST_WINDOW_DAYS = 14
STEP_DAYS = 14


# ─── Walk-Forward Result ─────────────────────────────────────────────────────

@dataclass
class WalkForwardGeneration:
    """Results from one generation of walk-forward validation."""

    generation: int
    train_start: float
    train_end: float
    test_start: float
    test_end: float
    train_samples: int
    test_samples: int
    train_mae: float
    val_mae: float
    metrics: dict


@dataclass
class WalkForwardResult:
    """Aggregated walk-forward validation results."""

    generations: list[WalkForwardGeneration] = field(default_factory=list)
    mean_mae: float = 0.0
    std_mae: float = 0.0
    mean_directional_accuracy: float = 0.0
    mean_precision_at_3pct: float | None = None
    is_profitable: bool = False
    summary: str = ""

    def aggregate(self) -> None:
        """Compute aggregate statistics across all generations."""
        if not self.generations:
            return

        maes = [g.val_mae for g in self.generations]
        self.mean_mae = float(np.mean(maes))
        self.std_mae = float(np.std(maes))

        dir_accs = [
            g.metrics.get("directional_accuracy", 0)
            for g in self.generations
        ]
        self.mean_directional_accuracy = float(np.mean(dir_accs))

        p3s = [
            g.metrics.get("precision_at_3.0pct")
            for g in self.generations
        ]
        p3s_valid = [p for p in p3s if p is not None]
        self.mean_precision_at_3pct = (
            float(np.mean(p3s_valid)) if p3s_valid else None
        )

        # Profitable if directional accuracy > 55% AND mean MAE < 4%
        self.is_profitable = (
            self.mean_directional_accuracy > 0.55
            and self.mean_mae < 4.0
        )

        self.summary = (
            f"Walk-forward: {len(self.generations)} generations, "
            f"MAE={self.mean_mae:.2f}+-{self.std_mae:.2f}, "
            f"dir_acc={self.mean_directional_accuracy:.1%}, "
            f"profitable={'YES' if self.is_profitable else 'NO'}"
        )


# ─── Walk-Forward Runner ────────────────────────────────────────────────────

def run_walk_forward(
    rows: list[dict],
    target_column: str,
    min_train_days: int = MIN_TRAIN_DAYS,
    test_window_days: int = TEST_WINDOW_DAYS,
    step_days: int = STEP_DAYS,
    params: dict | None = None,
) -> WalkForwardResult:
    """Run walk-forward validation on labeled snapshots.

    Args:
        rows: List of dicts from load_labeled_snapshots(), sorted by
            created_at.
        target_column: Label column (e.g., "best_long_roe_30m_net").
        min_train_days: Minimum training window in days.
        test_window_days: Size of each test window in days.
        step_days: How far to advance the window between generations.
        params: XGBoost params override.

    Returns:
        WalkForwardResult with per-generation metrics and aggregated stats.
    """
    if not rows:
        raise ValueError("No rows provided for walk-forward validation")

    timestamps = np.array([r["created_at"] for r in rows])
    data_start = float(timestamps[0])
    data_end = float(timestamps[-1])

    total_days = (data_end - data_start) / 86400
    if total_days < min_train_days + test_window_days:
        raise ValueError(
            f"Insufficient data for walk-forward: {total_days:.0f} days "
            f"(need {min_train_days + test_window_days})",
        )

    result = WalkForwardResult()
    generation = 0
    train_end_epoch = data_start + min_train_days * 86400

    while train_end_epoch + test_window_days * 86400 <= data_end:
        test_start_epoch = train_end_epoch
        test_end_epoch = test_start_epoch + test_window_days * 86400

        # Split data for this generation
        train_rows = [
            r for r in rows
            if data_start <= r["created_at"] < train_end_epoch
        ]
        test_rows = [
            r for r in rows
            if test_start_epoch <= r["created_at"] < test_end_epoch
        ]

        if len(train_rows) < 50 or len(test_rows) < 10:
            train_end_epoch += step_days * 86400
            continue

        try:
            # prepare_training_data fits scaler on train only
            data = prepare_training_data(
                rows=train_rows + test_rows,
                target_column=target_column,
                train_end=train_end_epoch,
            )

            train_result = train_model(data, params)

            metrics = evaluate_model(
                model=train_result.model,
                X=data.X_val,
                y=data.y_val,
                feature_names=data.feature_names,
            )

            gen = WalkForwardGeneration(
                generation=generation,
                train_start=data_start,
                train_end=train_end_epoch,
                test_start=test_start_epoch,
                test_end=test_end_epoch,
                train_samples=len(train_rows),
                test_samples=len(test_rows),
                train_mae=train_result.train_mae,
                val_mae=train_result.val_mae,
                metrics=metrics,
            )
            result.generations.append(gen)

            log.info(
                "Gen %d: train=%d, test=%d, val_mae=%.3f, dir_acc=%.1f%%",
                generation, len(train_rows), len(test_rows),
                train_result.val_mae,
                metrics["directional_accuracy"] * 100,
            )

        except Exception:
            log.exception("Walk-forward generation %d failed", generation)

        generation += 1
        train_end_epoch += step_days * 86400

    result.aggregate()
    log.info(result.summary)

    return result
