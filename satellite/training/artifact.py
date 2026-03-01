"""Model artifact: sealed container for model + scaler + metadata.

A ModelArtifact ensures that a trained model and its scaler are always
used together. The feature hash is verified at load time to prevent
feature drift (using a model trained on feature set A with feature set B).

Artifact layout on disk:
    artifacts/v{N}/
        model_long_v{N}.pkl       # XGBoost model
        model_short_v{N}.pkl      # XGBoost model
        scaler_v{N}.json          # FeatureScaler serialized
        metadata_v{N}.json        # Training metadata
"""

import json
import logging
import pickle
from dataclasses import dataclass
from pathlib import Path

from satellite.features import AVAIL_COLUMNS, FEATURE_HASH, FEATURE_NAMES
from satellite.normalize import FeatureScaler

log = logging.getLogger(__name__)


@dataclass
class ModelMetadata:
    """Training metadata stored alongside model artifacts."""

    version: int
    feature_hash: str
    feature_names: list[str]
    created_at: str                     # ISO8601
    training_samples: int
    training_start: str                 # ISO8601
    training_end: str                   # ISO8601
    validation_mae: float               # Best validation MAE
    validation_samples: int
    xgboost_params: dict                # Hyperparameters used
    notes: str = ""

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "feature_hash": self.feature_hash,
            "feature_names": self.feature_names,
            "created_at": self.created_at,
            "training_samples": self.training_samples,
            "training_start": self.training_start,
            "training_end": self.training_end,
            "validation_mae": self.validation_mae,
            "validation_samples": self.validation_samples,
            "xgboost_params": self.xgboost_params,
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ModelMetadata":
        return cls(**d)


@dataclass
class ModelArtifact:
    """Sealed container for a trained model version.

    Always contains:
      - model_long: XGBoost regressor for long predictions
      - model_short: XGBoost regressor for short predictions
      - scaler: FeatureScaler (fitted, immutable)
      - metadata: ModelMetadata

    The feature_hash is checked at load to ensure consistency.
    """

    model_long: object = None
    model_short: object = None
    scaler: FeatureScaler | None = None
    metadata: ModelMetadata | None = None

    def save(self, artifacts_dir: str | Path) -> Path:
        """Save artifact to disk.

        Creates: artifacts_dir/v{N}/ with model, scaler, and metadata files.

        Args:
            artifacts_dir: Base directory for all artifacts.

        Returns:
            Path to the versioned artifact directory.
        """
        version = self.metadata.version
        version_dir = Path(artifacts_dir) / f"v{version}"
        version_dir.mkdir(parents=True, exist_ok=True)

        # Save models
        with open(version_dir / f"model_long_v{version}.pkl", "wb") as f:
            pickle.dump(self.model_long, f)
        with open(version_dir / f"model_short_v{version}.pkl", "wb") as f:
            pickle.dump(self.model_short, f)

        # Save scaler
        with open(version_dir / f"scaler_v{version}.json", "w") as f:
            json.dump(self.scaler.to_dict(), f, indent=2)

        # Save metadata
        with open(version_dir / f"metadata_v{version}.json", "w") as f:
            json.dump(self.metadata.to_dict(), f, indent=2)

        log.info("Saved model artifact v%d to %s", version, version_dir)
        return version_dir

    @classmethod
    def load(cls, version_dir: str | Path) -> "ModelArtifact":
        """Load artifact from disk with feature hash verification.

        Args:
            version_dir: Path to versioned artifact directory.

        Returns:
            Loaded ModelArtifact.

        Raises:
            ValueError: If feature hash mismatch.
            FileNotFoundError: If any required file is missing.
        """
        version_dir = Path(version_dir)

        # Find version number from directory name
        version_str = version_dir.name.lstrip("v")
        version = int(version_str)

        # Load metadata first (for hash check)
        with open(version_dir / f"metadata_v{version}.json") as f:
            metadata = ModelMetadata.from_dict(json.load(f))

        # Feature hash verification — CRITICAL SAFETY CHECK
        if metadata.feature_hash != FEATURE_HASH:
            raise ValueError(
                f"Feature hash mismatch! Model was trained with hash "
                f"{metadata.feature_hash}, but current feature set has "
                f"hash {FEATURE_HASH}. Model features: "
                f"{metadata.feature_names}, Current features: "
                f"{FEATURE_NAMES}. Refusing to load — this model is "
                f"incompatible with the current feature set."
            )

        # Load scaler
        with open(version_dir / f"scaler_v{version}.json") as f:
            scaler = FeatureScaler.from_dict(json.load(f))

        # Verify scaler hash too
        if scaler.feature_hash != FEATURE_HASH:
            raise ValueError(
                f"Scaler feature hash mismatch! Scaler hash: "
                f"{scaler.feature_hash}, current hash: {FEATURE_HASH}."
            )

        # Load models
        with open(
            version_dir / f"model_long_v{version}.pkl", "rb",
        ) as f:
            model_long = pickle.load(f)
        with open(
            version_dir / f"model_short_v{version}.pkl", "rb",
        ) as f:
            model_short = pickle.load(f)

        log.info(
            "Loaded model artifact v%d (trained on %d samples)",
            version, metadata.training_samples,
        )

        return cls(
            model_long=model_long,
            model_short=model_short,
            scaler=scaler,
            metadata=metadata,
        )

    def predict(
        self,
        raw_features: dict[str, float],
        availability: dict[str, int] | None = None,
    ) -> tuple[float, float]:
        """Predict ROE for both long and short from raw features.

        Applies the sealed scaler to structural features, appends avail
        flags, then runs both models.

        Args:
            raw_features: Dict of raw feature values (from compute_features).
            availability: Dict of availability flags. Defaults to all-1
                (all features available).

        Returns:
            (predicted_long_roe, predicted_short_roe) in percent.
        """
        if (
            self.scaler is None
            or self.model_long is None
            or self.model_short is None
        ):
            raise ValueError("Artifact not fully loaded.")

        # Transform structural features through sealed scaler (12 values)
        transformed = self.scaler.transform(raw_features)

        # Append availability flags (9 binary, no normalization)
        avail = availability or {}
        avail_values = [avail.get(col, 1) for col in AVAIL_COLUMNS]
        full_vector = transformed + avail_values

        import numpy as np
        import xgboost as xgb

        feature_names = list(FEATURE_NAMES) + list(AVAIL_COLUMNS)
        x = np.array([full_vector])
        dmat = xgb.DMatrix(x, feature_names=feature_names)

        pred_long = float(self.model_long.predict(dmat)[0])
        pred_short = float(self.model_short.predict(dmat)[0])

        return pred_long, pred_short
