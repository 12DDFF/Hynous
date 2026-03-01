"""Model inference and decision logic.

Converts model predictions into actionable trade signals:
  1. Compute features (SPEC-02 compute_features())
  2. Normalize structural features (artifact's sealed scaler, 12 values)
  3. Append availability flags (9 binary values, no normalization)
  4. Predict (XGBoost inference <1ms)
  5. Explain (SHAP ~100us)
  6. Decide (threshold + conflict resolution)

The threshold is a runtime parameter — no retraining needed to adjust.
"""

import logging
import time
from dataclasses import dataclass

import numpy as np
import xgboost as xgb

from satellite.features import (
    AVAIL_COLUMNS,
    FEATURE_NAMES,
    compute_features,
)
from satellite.training.artifact import ModelArtifact
from satellite.training.explain import (
    PredictionExplanation,
    create_explainer,
    explain_prediction,
)

log = logging.getLogger(__name__)

# Full feature list used by trained models: 12 structural + 9 avail = 21
_ALL_FEATURE_NAMES = list(FEATURE_NAMES) + list(AVAIL_COLUMNS)


# ─── Decision Result ─────────────────────────────────────────────────────────

@dataclass
class InferenceResult:
    """Result of model inference for a single coin."""

    coin: str
    predicted_long_roe: float
    predicted_short_roe: float
    signal: str                  # "long", "short", "skip", "conflict"
    confidence: float
    explanation_long: PredictionExplanation | None
    explanation_short: PredictionExplanation | None
    inference_time_ms: float

    @property
    def summary(self) -> str:
        """Human-readable decision summary."""
        lines = [
            f"[{self.coin}] Signal: {self.signal.upper()} "
            f"(long={self.predicted_long_roe:+.1f}%, "
            f"short={self.predicted_short_roe:+.1f}%)",
        ]
        if self.signal in ("long", "short"):
            exp = (
                self.explanation_long
                if self.signal == "long"
                else self.explanation_short
            )
            if exp:
                lines.append(f"  {exp.summary}")
        return "\n".join(lines)


# ─── Inference Engine ────────────────────────────────────────────────────────

class InferenceEngine:
    """Stateful inference engine. Loads model once, predicts many times.

    Args:
        artifact: ModelArtifact (loaded and verified).
        entry_threshold: Minimum predicted ROE to generate entry signal (%).
        conflict_margin: Both sides must differ by this much to avoid
            "conflict" (%).
    """

    def __init__(
        self,
        artifact: ModelArtifact,
        entry_threshold: float = 3.0,
        conflict_margin: float = 1.0,
    ):
        self._artifact = artifact
        self._threshold = entry_threshold
        self._conflict_margin = conflict_margin
        self._explainer_long = create_explainer(artifact.model_long)
        self._explainer_short = create_explainer(artifact.model_short)

    @property
    def entry_threshold(self) -> float:
        return self._threshold

    @entry_threshold.setter
    def entry_threshold(self, value: float) -> None:
        """Runtime-adjustable threshold. No retraining needed."""
        self._threshold = value
        log.info("Entry threshold updated to %.1f%%", value)

    def predict(
        self,
        coin: str,
        snapshot: object,
        data_layer_db: object,
        heatmap_engine: object | None = None,
        order_flow_engine: object | None = None,
        explain: bool = True,
    ) -> InferenceResult:
        """Run full inference pipeline for a single coin.

        Args:
            coin: Coin symbol.
            snapshot: Daemon MarketSnapshot.
            data_layer_db: data-layer Database.
            heatmap_engine: LiqHeatmapEngine (optional).
            order_flow_engine: OrderFlowEngine (optional).
            explain: Whether to generate SHAP explanations.

        Returns:
            InferenceResult with prediction, signal, and explanation.
        """
        t0 = time.perf_counter()

        # 1. Compute features (SPEC-02 — single source of truth)
        feature_result = compute_features(
            coin=coin,
            snapshot=snapshot,
            data_layer_db=data_layer_db,
            heatmap_engine=heatmap_engine,
            order_flow_engine=order_flow_engine,
        )

        # 2. Transform structural features through sealed scaler (12 values)
        raw = feature_result.features
        transformed = self._artifact.scaler.transform(raw)

        # 3. Append availability flags (9 binary, no normalization)
        avail = feature_result.availability
        avail_values = [avail.get(col, 1) for col in AVAIL_COLUMNS]
        full_vector = transformed + avail_values  # 12 + 9 = 21

        # 4. Predict
        x = np.array([full_vector])
        dmat = xgb.DMatrix(x, feature_names=_ALL_FEATURE_NAMES)

        pred_long = float(self._artifact.model_long.predict(dmat)[0])
        pred_short = float(self._artifact.model_short.predict(dmat)[0])

        # 5. SHAP explanations (optional, ~100us each)
        # Merge raw features + avail flags for display
        raw_for_display = dict(raw)
        raw_for_display.update(
            {col: float(avail.get(col, 1)) for col in AVAIL_COLUMNS},
        )

        exp_long = None
        exp_short = None
        if explain:
            exp_long = explain_prediction(
                self._explainer_long, full_vector, raw_for_display,
                _ALL_FEATURE_NAMES, pred_long,
            )
            exp_short = explain_prediction(
                self._explainer_short, full_vector, raw_for_display,
                _ALL_FEATURE_NAMES, pred_short,
            )

        # 6. Decision logic
        signal = self._decide(pred_long, pred_short)

        elapsed_ms = (time.perf_counter() - t0) * 1000

        return InferenceResult(
            coin=coin,
            predicted_long_roe=pred_long,
            predicted_short_roe=pred_short,
            signal=signal,
            confidence=max(pred_long, pred_short),
            explanation_long=exp_long,
            explanation_short=exp_short,
            inference_time_ms=elapsed_ms,
        )

    def _decide(self, pred_long: float, pred_short: float) -> str:
        """Convert predictions to a trade signal.

        Decision rules:
          1. Neither above threshold -> "skip"
          2. Both above threshold AND within conflict margin -> "conflict"
          3. One above threshold -> that direction
          4. Both above, clear winner -> stronger direction

        Args:
            pred_long: Predicted long ROE (%).
            pred_short: Predicted short ROE (%).

        Returns:
            "long", "short", "skip", or "conflict".
        """
        long_above = pred_long > self._threshold
        short_above = pred_short > self._threshold

        if not long_above and not short_above:
            return "skip"

        if long_above and short_above:
            diff = abs(pred_long - pred_short)
            if diff < self._conflict_margin:
                return "conflict"
            return "long" if pred_long > pred_short else "short"

        if long_above:
            return "long"
        return "short"


# ─── Position Sizing ─────────────────────────────────────────────────────────

def compute_position_size(
    predicted_roe: float,
    entry_threshold: float = 3.0,
    base_size_usd: float = 5000,
    max_size_usd: float = 25000,
    scale_factor: float = 1.5,
) -> float:
    """Compute position size from predicted ROE.

    Higher predicted ROE -> larger position. Linear scaling with floor/ceiling.

    Args:
        predicted_roe: Model's predicted net ROE (%).
        entry_threshold: Minimum predicted ROE for entry.
        base_size_usd: Minimum position size.
        max_size_usd: Maximum position size.
        scale_factor: How much to scale per 1% ROE above threshold.

    Returns:
        Position size in USD.
    """
    excess = predicted_roe - entry_threshold
    size = base_size_usd + excess * scale_factor * base_size_usd
    return max(base_size_usd, min(max_size_usd, size))
