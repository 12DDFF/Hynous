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

# Models confirmed broken via live validation (zero predictive power).
# reversal_30m: tautological target, BinaryAcc = base rate (92%), Spearman +0.022
# momentum_quality: Spearman 0.075, DirAcc 50% = coin flip
# They still exist as artifacts but are skipped during inference.
DISABLED_MODELS: set[str] = {"reversal_30m", "momentum_quality"}


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

        # Volatility
        vol_1h = self.predictions.get("vol_1h")
        vol_4h = self.predictions.get("vol_4h")
        vol_expand = self.predictions.get("vol_expand")
        if vol_1h or vol_4h:
            vol_parts = []
            if vol_1h:
                vol_parts.append(f"1h: {vol_1h.value:.2f}")
            if vol_4h:
                vol_parts.append(f"4h: {vol_4h.value:.2f}")
            regime = (vol_1h or vol_4h).regime.upper()
            line = f"  Volatility: {regime} ({', '.join(vol_parts)})"
            if regime in ("HIGH", "EXTREME"):
                line += " — expect large moves"
            elif regime == "LOW":
                line += " — quiet market"
            lines.append(line)

        if vol_expand:
            expand_str = f"{vol_expand.value:.1f}x"
            if vol_expand.value > 1.3:
                lines.append(f"  Vol expanding: {expand_str} — potential breakout")
            elif vol_expand.value < 0.7:
                lines.append(f"  Vol compressing: {expand_str} — consolidation")

        # Move forecast
        range_30m = self.predictions.get("range_30m")
        move_30m = self.predictions.get("move_30m")
        if range_30m or move_30m:
            parts = []
            if range_30m:
                parts.append(f"{range_30m.value:.1f}% range in 30m")
            if move_30m:
                parts.append(f"max single move ~{move_30m.value:.1f}%")
            lines.append(f"  Move forecast: {', '.join(parts)}")

        # Risk
        mae_long = self.predictions.get("mae_long")
        mae_short = self.predictions.get("mae_short")
        if mae_long or mae_short:
            parts = []
            if mae_long:
                parts.append(f"long drawdown ~{mae_long.value:.1f}% ROE")
            if mae_short:
                parts.append(f"short drawdown ~{mae_short.value:.1f}% ROE")
            lines.append(f"  Risk: {', '.join(parts)}")

        # Entry quality
        entry = self.predictions.get("entry_quality")
        if entry:
            label = "above average" if entry.percentile > 60 else (
                "below average" if entry.percentile < 40 else "neutral"
            )
            lines.append(
                f"  Entry quality: {label} ({entry.value:.1f}, "
                f"{entry.percentile}th percentile)"
            )

        # Volume
        volume = self.predictions.get("volume_1h")
        if volume:
            lines.append(f"  Volume forecast: {volume.regime} ({volume.value:.1f}x avg)")

        # Funding
        funding = self.predictions.get("funding_4h")
        if funding:
            direction = "increasing" if funding.value > 0.05 else (
                "decreasing" if funding.value < -0.05 else "flat"
            )
            lines.append(
                f"  Funding trajectory: {direction} over 4h "
                f"({funding.value:+.2f} z-score change)"
            )

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
        sl_05 = self.predictions.get("sl_survival_05")
        if sl_03 or sl_05:
            parts = []
            if sl_03:
                parts.append(f"0.3%: {sl_03.value:.0%} hit risk")
            if sl_05:
                parts.append(f"0.5%: {sl_05.value:.0%} hit risk")
            line = f"  SL survival (30m): {', '.join(parts)}"
            # High-risk warning
            high_risk = (sl_03 and sl_03.value > 0.5) or (sl_05 and sl_05.value > 0.5)
            if high_risk:
                line += " — tight stops likely to get hit"
            lines.append(line)

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

    def predict(self, coin: str, features: dict[str, float]) -> MarketConditions:
        """Run all loaded condition models on a feature vector.

        Args:
            coin: Coin symbol (e.g., "BTC").
            features: Dict of feature_name -> value from the latest snapshot.

        Returns:
            MarketConditions with all predictions.
        """
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
