"""Sealed container for condition model artifacts.

Each condition model (vol_1h, move_30m, etc.) is saved as a
ConditionArtifact: an XGBoost model + metadata + training-set
percentile distribution for regime labeling.

Disk layout per model:
    artifacts/conditions/{name}/
        model.json          # XGBoost Booster (JSON format)
        metadata.json       # ConditionMetadata (feature hash, stats, percentiles)
"""

import hashlib
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import xgboost as xgb

log = logging.getLogger(__name__)


@dataclass
class ConditionMetadata:
    """Metadata paired with a condition model artifact."""

    name: str  # e.g. "vol_1h"
    version: int
    feature_hash: str  # SHA-256[:16] of "|".join(feature_names)
    feature_names: list[str]
    target_description: str  # human-readable target explanation
    created_at: str  # ISO 8601
    training_samples: int
    validation_spearman: float
    validation_mae: float
    xgboost_params: dict
    # Training-set percentiles for regime labeling at inference time
    # Keys: "p10", "p25", "p50", "p75", "p90", "p95"
    percentiles: dict[str, float] = field(default_factory=dict)


def _compute_feature_hash(feature_names: list[str]) -> str:
    """Deterministic hash of feature names + order. Must match across sessions."""
    return hashlib.sha256("|".join(feature_names).encode()).hexdigest()[:16]


@dataclass
class ConditionArtifact:
    """Sealed container for a single condition model.

    The model, metadata, and percentile distribution are paired.
    Feature hash is verified at load time to catch mismatches.
    """

    model: xgb.Booster
    metadata: ConditionMetadata

    def save(self, artifacts_dir: Path) -> Path:
        """Save model + metadata to artifacts_dir/{name}/.

        Args:
            artifacts_dir: Parent directory (e.g. artifacts/conditions/).

        Returns:
            Path to the model directory.
        """
        model_dir = artifacts_dir / self.metadata.name
        model_dir.mkdir(parents=True, exist_ok=True)

        # Save XGBoost model as JSON (portable, human-inspectable)
        model_path = model_dir / "model.json"
        self.model.save_model(str(model_path))

        # Save metadata
        meta_path = model_dir / "metadata.json"
        meta_dict = asdict(self.metadata)
        with open(meta_path, "w") as f:
            json.dump(meta_dict, f, indent=2)

        log.info(
            "Saved condition artifact: %s (spearman=%.3f, %d samples)",
            self.metadata.name,
            self.metadata.validation_spearman,
            self.metadata.training_samples,
        )
        return model_dir

    @classmethod
    def load(cls, model_dir: Path) -> "ConditionArtifact":
        """Load a condition artifact from disk.

        Verifies feature hash to ensure model/feature parity.

        Args:
            model_dir: Directory containing model.json and metadata.json.

        Returns:
            ConditionArtifact ready for inference.

        Raises:
            FileNotFoundError: If model or metadata files are missing.
            ValueError: If feature hash doesn't match.
        """
        model_path = model_dir / "model.json"
        meta_path = model_dir / "metadata.json"

        if not model_path.exists():
            raise FileNotFoundError(f"Model file not found: {model_path}")
        if not meta_path.exists():
            raise FileNotFoundError(f"Metadata file not found: {meta_path}")

        # Load metadata
        with open(meta_path) as f:
            meta_dict = json.load(f)
        metadata = ConditionMetadata(**meta_dict)

        # Verify feature hash
        expected_hash = _compute_feature_hash(metadata.feature_names)
        if metadata.feature_hash != expected_hash:
            raise ValueError(
                f"Feature hash mismatch for {metadata.name}: "
                f"stored={metadata.feature_hash}, computed={expected_hash}"
            )

        # Load XGBoost model
        booster = xgb.Booster()
        booster.load_model(str(model_path))

        log.info(
            "Loaded condition artifact: %s v%d (spearman=%.3f)",
            metadata.name,
            metadata.version,
            metadata.validation_spearman,
        )
        return cls(model=booster, metadata=metadata)

    def predict(self, feature_values: list[float], feature_names: list[str]) -> float:
        """Run inference on a single feature vector.

        Args:
            feature_values: Feature values in the same order as feature_names.
            feature_names: Feature names (verified against stored names).

        Returns:
            Predicted value (float).

        Raises:
            ValueError: If feature names don't match the model's expected features.
        """
        # Verify feature parity
        provided_hash = _compute_feature_hash(feature_names)
        if provided_hash != self.metadata.feature_hash:
            raise ValueError(
                f"Feature mismatch for {self.metadata.name}: "
                f"expected hash {self.metadata.feature_hash}, got {provided_hash}"
            )

        dmatrix = xgb.DMatrix(
            np.array(feature_values, dtype=np.float32).reshape(1, -1),
            feature_names=feature_names,
        )
        prediction = self.model.predict(dmatrix)
        return float(prediction[0])

    def get_regime(self, value: float) -> tuple[str, int]:
        """Map a predicted value to a regime label using training percentiles.

        Args:
            value: Predicted value from the model.

        Returns:
            Tuple of (regime_label, percentile_rank).
            regime_label is one of: "low", "normal", "high", "extreme".
        """
        pcts = self.metadata.percentiles
        if not pcts:
            return "normal", 50

        # Compute approximate percentile rank
        percentile = 50  # default
        for p_label in ["p10", "p25", "p50", "p75", "p90", "p95"]:
            p_val = pcts.get(p_label)
            if p_val is not None and value <= p_val:
                percentile = int(p_label[1:])
                break
        else:
            percentile = 99  # above p95

        # Map to regime
        if percentile < 25:
            regime = "low"
        elif percentile < 75:
            regime = "normal"
        elif percentile < 95:
            regime = "high"
        else:
            regime = "extreme"

        return regime, percentile
