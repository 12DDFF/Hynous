"""Condition Engine — loads all condition models and runs predictions.

The ConditionEngine discovers models from the artifacts/conditions/ directory,
loads them at init, and runs all predictions on a feature vector in ~10ms total.

Usage:
    engine = ConditionEngine(Path("satellite/artifacts/conditions"))
    conditions = engine.predict(coin="BTC", features={"realized_vol_1h": 0.42, ...})
    print(conditions.to_briefing_text())
"""

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from satellite.training.condition_artifact import ConditionArtifact

log = logging.getLogger(__name__)

# Models disabled from inference (Spearman < 0.15).
# Artifacts are kept for retraining. Re-enable by removing from this set.
#
# Phase 1b VPS retrain (2026-03-22, 62K+ snapshots with real feature data):
#   vol_1h: 0.720, vol_4h: 0.673, range_30m: 0.603, move_30m: 0.533
#   volume_1h: 0.441, momentum_quality: 0.398, vol_expand: 0.355
#   entry_quality: 0.341, mae_short: 0.334, mae_long: 0.291
#   sl_survival_03: 0.280, funding_4h: 0.277, sl_survival_05: 0.238
#   reversal_30m: 0.097 — DISABLED (tautological target, confirmed broken)
DISABLED_MODELS: set[str] = {
    "reversal_30m",
}


@dataclass
class ConditionPrediction:
    """A single condition prediction with regime context."""

    name: str
    value: float
    percentile: int  # where this falls in training distribution
    regime: str  # "low" / "normal" / "high" / "extreme"


@dataclass
class MarketConditions:
    """Complete condition predictions for a single coin at a point in time."""

    coin: str
    timestamp: float
    predictions: dict[str, ConditionPrediction]
    inference_time_ms: float

    def to_dict(self) -> dict:
        """Serialize for storage in _latest_predictions."""
        result = {
            "coin": self.coin,
            "timestamp": self.timestamp,
            "inference_time_ms": round(self.inference_time_ms, 2),
        }
        for name, pred in self.predictions.items():
            result[name] = {
                "value": round(pred.value, 4),
                "percentile": pred.percentile,
                "regime": pred.regime,
            }
        return result

    def to_briefing_text(self) -> str:
        """Human-readable format for LLM briefing injection."""
        lines = [f"ML Conditions ({self.coin}):"]

        # Volatility (price swing intensity — NOT volume)
        vol_1h = self.predictions.get("vol_1h")
        vol_4h = self.predictions.get("vol_4h")
        vol_expand = self.predictions.get("vol_expand")
        if vol_1h or vol_4h:
            regime = (vol_1h or vol_4h).regime.upper()
            line = f"  Volatility (price swings): {regime}"
            if regime in ("HIGH", "EXTREME"):
                line += " — expect large price moves, widen stops"
            elif regime == "LOW":
                line += " — quiet market, tight range likely"
            else:
                line += " — normal conditions"
            lines.append(line)

        if vol_expand:
            if vol_expand.value > 1.3:
                lines.append(f"  Volatility expanding ({vol_expand.value:.1f}x current) — breakout risk")
            elif vol_expand.value < 0.7:
                lines.append(f"  Volatility compressing ({vol_expand.value:.1f}x current) — consolidation")

        # Price move forecast (how far price could move in next 30 min)
        range_30m = self.predictions.get("range_30m")
        move_30m = self.predictions.get("move_30m")
        if range_30m or move_30m:
            parts = []
            if range_30m:
                parts.append(f"total range ~{range_30m.value:.1f}% ROE")
            if move_30m:
                parts.append(f"max one-direction ~{move_30m.value:.1f}% ROE")
            lines.append(f"  Expected 30m move: {', '.join(parts)}")

        # Max drawdown risk (worst dip before recovery, in next 30 min)
        mae_long = self.predictions.get("mae_long")
        mae_short = self.predictions.get("mae_short")
        if mae_long or mae_short:
            parts = []
            if mae_long:
                parts.append(f"longs may dip ~{mae_long.value:.1f}% ROE before recovering")
            if mae_short:
                parts.append(f"shorts may spike ~{mae_short.value:.1f}% ROE against you")
            lines.append(f"  Drawdown risk: {', '.join(parts)}")

        # Entry timing quality (is NOW a good time to enter?)
        entry = self.predictions.get("entry_quality")
        if entry:
            if entry.percentile > 60:
                label = "GOOD — better than recent entries"
            elif entry.percentile < 40:
                label = "POOR — worse than recent entries, consider waiting"
            else:
                label = "neutral"
            lines.append(f"  Entry timing: {label} ({entry.percentile}th percentile)")

        # Trading volume (activity level — NOT volatility)
        volume = self.predictions.get("volume_1h")
        if volume:
            lines.append(f"  Trading volume (1h ahead): {volume.regime} ({volume.value:.1f}x typical)")

        # Funding rate direction (which side pays over next 4 hours)
        funding = self.predictions.get("funding_4h")
        if funding:
            if funding.value > 0.05:
                direction = "rising — longs will pay more, short squeeze potential"
            elif funding.value < -0.05:
                direction = "falling — shorts will pay more, long squeeze potential"
            else:
                direction = "flat — no directional funding pressure"
            lines.append(f"  Funding (next 4h): {direction}")

        # Reversal
        reversal = self.predictions.get("reversal_30m")
        if reversal:
            lines.append(f"  Reversal risk (30m): {reversal.value:.0%}")

        # Momentum quality
        momentum = self.predictions.get("momentum_quality")
        if momentum:
            quality = "real" if momentum.value > 0.5 else "hollow" if momentum.value < 0.2 else "moderate"
            lines.append(
                f"  Momentum quality: {quality} ({momentum.value:.2f})"
            )

        # SL survival
        sl_03 = self.predictions.get("sl_survival_03")
        # Stop-loss survival (chance a tight SL gets hit in 30 min)
        sl_03 = self.predictions.get("sl_survival_03")
        if sl_03:
            if sl_03.value > 0.5:
                lines.append(f"  Stop-loss warning: {sl_03.value:.0%} chance a 0.3% stop gets hit in 30m — widen your stop")
            elif sl_03.value > 0.3:
                lines.append(f"  Stop-loss risk: moderate ({sl_03.value:.0%} chance 0.3% stop hit in 30m)")

        lines.append(f"  [inference: {self.inference_time_ms:.1f}ms]")
        return "\n".join(lines)


class ConditionEngine:
    """Loads and runs all condition models.

    Discovers models by scanning subdirectories of the artifacts directory.
    Each subdirectory must contain model.json and metadata.json.
    """

    def __init__(self, artifacts_dir: Path):
        """Load all condition models from artifacts_dir.

        Args:
            artifacts_dir: Path to artifacts/conditions/ directory.
        """
        self._artifacts: dict[str, ConditionArtifact] = {}
        self._artifacts_dir = artifacts_dir

        if not artifacts_dir.exists():
            log.warning("Condition artifacts directory not found: %s", artifacts_dir)
            return

        for model_dir in sorted(artifacts_dir.iterdir()):
            if not model_dir.is_dir():
                continue
            if not (model_dir / "model.json").exists():
                continue
            if model_dir.name in DISABLED_MODELS:
                log.info("Skipping disabled condition model: %s", model_dir.name)
                continue
            try:
                artifact = ConditionArtifact.load(model_dir)
                self._artifacts[artifact.metadata.name] = artifact
            except Exception:
                log.warning("Failed to load condition model: %s", model_dir.name, exc_info=True)

        # Rolling prediction buffer for online percentile recalibration.
        # Training-set percentiles drift as market regime changes — this tracks
        # recent predictions and recomputes percentiles every 500 predictions.
        self._rolling_preds: dict[str, deque] = {
            name: deque(maxlen=2000)  # ~7 days at 5min intervals
            for name in self._artifacts
        }
        self._rolling_pcts: dict[str, dict[str, float]] = {}
        self._pred_count: int = 0

        log.info(
            "ConditionEngine loaded %d models: %s",
            len(self._artifacts),
            ", ".join(sorted(self._artifacts.keys())),
        )

    def predict(self, coin: str, features: dict[str, float]) -> MarketConditions | None:
        """Run all loaded condition models on a feature vector.

        Args:
            coin: Coin symbol (e.g., "BTC").
            features: Dict of feature_name -> value from the latest snapshot.

        Returns:
            MarketConditions with all predictions, or None if features are
            too degraded (>50% zero) to produce meaningful predictions.
        """
        # Feature quality gate: if most features are zero/missing, the data-layer
        # is likely down and predictions would be garbage. Return None so downstream
        # consumers (trading tool, briefing) know ML is unavailable.
        core_features = [
            "realized_vol_1h", "volume_vs_1h_avg_ratio", "price_trend_1h",
            "funding_vs_30d_zscore", "oi_vs_7d_avg_ratio", "cvd_ratio_30m",
        ]
        zero_count = sum(1 for f in core_features if not features.get(f))
        if zero_count >= 4:  # 4 of 6 core features missing = data-layer likely down
            log.warning(
                "Feature quality too low for %s (%d/%d core features zero) — skipping predictions",
                coin, zero_count, len(core_features),
            )
            return None

        t0 = time.perf_counter()
        predictions: dict[str, ConditionPrediction] = {}

        for name, artifact in self._artifacts.items():
            try:
                # Extract features in the model's expected order
                feature_names = artifact.metadata.feature_names
                feature_values = [features.get(f, 0.0) for f in feature_names]

                value = artifact.predict(feature_values, feature_names)

                # Track for online recalibration
                buf = self._rolling_preds.get(name)
                if buf is not None:
                    buf.append(value)

                # Use rolling percentiles if available, else training percentiles
                rolling = self._rolling_pcts.get(name)
                regime, percentile = artifact.get_regime(value, override_percentiles=rolling)

                predictions[name] = ConditionPrediction(
                    name=name,
                    value=value,
                    percentile=percentile,
                    regime=regime,
                )
            except Exception:
                log.warning("Condition prediction failed for %s", name, exc_info=True)

        # Periodic recalibration of percentiles from recent predictions
        self._pred_count += 1
        if self._pred_count % 500 == 0:
            self._recalibrate()

        elapsed_ms = (time.perf_counter() - t0) * 1000

        return MarketConditions(
            coin=coin,
            timestamp=time.time(),
            predictions=predictions,
            inference_time_ms=elapsed_ms,
        )

    def _recalibrate(self):
        """Recompute regime percentiles from recent live predictions.

        Replaces static training-set percentiles with rolling estimates
        so regime labels stay calibrated as market conditions shift.
        """
        for name, buf in self._rolling_preds.items():
            if len(buf) < 200:
                continue
            arr = np.array(buf)
            self._rolling_pcts[name] = {
                f"p{p}": float(np.percentile(arr, p))
                for p in [10, 25, 50, 75, 90, 95]
            }
        log.info(
            "Recalibrated percentiles for %d models from %d recent predictions",
            len(self._rolling_pcts), self._pred_count,
        )

    @property
    def model_count(self) -> int:
        return len(self._artifacts)

    @property
    def model_names(self) -> list[str]:
        return sorted(self._artifacts.keys())
