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
from dataclasses import dataclass, field
from pathlib import Path

from satellite.training.condition_artifact import ConditionArtifact

log = logging.getLogger(__name__)


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
                parts.append(f"long drawdown ~{mae_long.value:.1f}%")
            if mae_short:
                parts.append(f"short drawdown ~{mae_short.value:.1f}%")
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
            try:
                artifact = ConditionArtifact.load(model_dir)
                self._artifacts[artifact.metadata.name] = artifact
            except Exception:
                log.warning("Failed to load condition model: %s", model_dir.name, exc_info=True)

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
                regime, percentile = artifact.get_regime(value)

                predictions[name] = ConditionPrediction(
                    name=name,
                    value=value,
                    percentile=percentile,
                    regime=regime,
                )
            except Exception:
                log.warning("Condition prediction failed for %s", name, exc_info=True)

        elapsed_ms = (time.perf_counter() - t0) * 1000

        return MarketConditions(
            coin=coin,
            timestamp=time.time(),
            predictions=predictions,
            inference_time_ms=elapsed_ms,
        )

    @property
    def model_count(self) -> int:
        return len(self._artifacts)

    @property
    def model_names(self) -> list[str]:
        return sorted(self._artifacts.keys())
