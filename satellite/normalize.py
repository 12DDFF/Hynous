"""Feature normalization pipeline.

Transforms raw feature values into model-ready inputs using 5 transform types.
Scalers are fitted on training data ONLY and frozen forever after.

Rules:
  1. STORAGE: Raw values always. Never store normalized values.
  2. TRAINING: Fit scaler on train partition only. Save scaler.
  3. INFERENCE: Load saved scaler. Apply. Never refit.
  4. funding_vs_30d_zscore: TYPE C (clip only, never re-z-score).
  5. NULLs: Impute to neutral values BEFORE transform.
"""

import logging
import math
from dataclasses import dataclass, field

import numpy as np

from satellite.features import FEATURE_NAMES, NEUTRAL_VALUES, FEATURE_HASH

log = logging.getLogger(__name__)


# ─── Transform Type Assignments ──────────────────────────────────────────────

TRANSFORM_MAP: dict[str, str] = {
    # TYPE P — Passthrough (already bounded, semantically meaningful)
    "liq_magnet_direction": "P",    # [-1, +1]
    "liq_cascade_active": "P",      # {0, 1}
    "cvd_normalized_5m": "P",       # [-1, +1]
    "sessions_overlapping": "P",    # {0, 1, 2}

    # TYPE C — Clip only (already a z-score, don't re-normalize)
    "funding_vs_30d_zscore": "C",   # already a market z-score

    # TYPE Z — Z-score (normal continuous, center + scale)
    "hours_to_funding": "Z",        # 0-8, continuous
    "price_change_5m_pct": "Z",     # %, continuous
    "realized_vol_1h": "Z",         # %, continuous

    # TYPE L — Log transform + Z-score (skewed ratios, always positive)
    "oi_vs_7d_avg_ratio": "L",      # ratio > 0, skewed right
    "liq_1h_vs_4h_avg": "L",        # ratio > 0, spike-prone
    "volume_vs_1h_avg_ratio": "L",  # ratio > 0, skewed right

    # TYPE S — Signed log + Z-score (any sign, skewed)
    "oi_funding_pressure": "S",     # interaction term, large range
}


# ─── Scaler Dataclass ────────────────────────────────────────────────────────

@dataclass
class FeatureScaler:
    """Fitted scaler for all features. Immutable after fitting.

    Stores per-feature parameters needed to reproduce the exact transform
    at inference time. Always paired with a model via ModelArtifact.
    """

    feature_names: list[str] = field(default_factory=list)
    feature_hash: str = ""
    transform_map: dict[str, str] = field(default_factory=dict)
    params: dict[str, dict] = field(default_factory=dict)
    fitted: bool = False

    def fit(self, data: dict[str, np.ndarray]) -> "FeatureScaler":
        """Fit scaler parameters on training data.

        Args:
            data: Dict mapping feature name -> array of raw values
                (training set only).

        Returns:
            Self (fitted).
        """
        self.feature_names = list(FEATURE_NAMES)
        self.feature_hash = FEATURE_HASH
        self.transform_map = dict(TRANSFORM_MAP)
        self.params = {}

        for name in self.feature_names:
            ttype = self.transform_map[name]
            values = data.get(name, np.array([]))

            if len(values) == 0:
                self.params[name] = {}
                continue

            # Impute NaN to neutral before fitting
            neutral = NEUTRAL_VALUES.get(name, 0.0)
            values = np.where(np.isnan(values), neutral, values)

            if ttype == "P":
                self.params[name] = {}
            elif ttype == "C":
                self.params[name] = {"clip_low": -5.0, "clip_high": 5.0}
            elif ttype == "Z":
                mean = float(np.mean(values))
                std = float(np.std(values))
                self.params[name] = {"mean": mean, "std": std}
            elif ttype == "L":
                logged = np.log1p(np.maximum(values, 0))
                self.params[name] = {
                    "log_mean": float(np.mean(logged)),
                    "log_std": float(np.std(logged)),
                }
            elif ttype == "S":
                signed_log = np.sign(values) * np.log1p(np.abs(values))
                self.params[name] = {
                    "slog_mean": float(np.mean(signed_log)),
                    "slog_std": float(np.std(signed_log)),
                }

        self.fitted = True
        log.info("Scaler fitted on %d features", len(self.feature_names))
        return self

    def transform(self, data: dict[str, float]) -> list[float]:
        """Transform a single row of raw features into model-ready values.

        Args:
            data: Dict mapping feature name -> raw value (single snapshot).

        Returns:
            List of transformed values in FEATURE_NAMES order.

        Raises:
            ValueError: If scaler is not fitted.
        """
        if not self.fitted:
            raise ValueError("Scaler not fitted. Call fit() first.")

        result = []
        for name in self.feature_names:
            raw = data.get(name)
            neutral = NEUTRAL_VALUES.get(name, 0.0)

            # Impute None/NaN to neutral
            if raw is None or (isinstance(raw, float) and math.isnan(raw)):
                raw = neutral

            ttype = self.transform_map[name]
            params = self.params.get(name, {})

            if ttype == "P":
                result.append(float(raw))
            elif ttype == "C":
                clip_low = params.get("clip_low", -5.0)
                clip_high = params.get("clip_high", 5.0)
                result.append(max(clip_low, min(clip_high, float(raw))))
            elif ttype == "Z":
                std = params.get("std", 1.0)
                mean = params.get("mean", 0.0)
                if std < 1e-10:
                    result.append(0.0)
                else:
                    result.append((float(raw) - mean) / std)
            elif ttype == "L":
                logged = math.log1p(max(float(raw), 0))
                std = params.get("log_std", 1.0)
                mean = params.get("log_mean", 0.0)
                if std < 1e-10:
                    result.append(0.0)
                else:
                    result.append((logged - mean) / std)
            elif ttype == "S":
                val = float(raw)
                signed_log = (
                    math.copysign(math.log1p(abs(val)), val)
                    if val != 0 else 0.0
                )
                std = params.get("slog_std", 1.0)
                mean = params.get("slog_mean", 0.0)
                if std < 1e-10:
                    result.append(0.0)
                else:
                    result.append((signed_log - mean) / std)

        return result

    def transform_batch(self, data: dict[str, np.ndarray]) -> np.ndarray:
        """Transform a batch of rows (for training).

        Args:
            data: Dict mapping feature name -> array of raw values.

        Returns:
            2D numpy array, shape (n_samples, n_features).
        """
        if not self.fitted:
            raise ValueError("Scaler not fitted.")

        n_samples = len(next(iter(data.values())))
        result = np.zeros((n_samples, len(self.feature_names)))

        for i, name in enumerate(self.feature_names):
            values = data.get(
                name,
                np.full(n_samples, NEUTRAL_VALUES.get(name, 0.0)),
            )
            values = np.where(
                np.isnan(values), NEUTRAL_VALUES.get(name, 0.0), values,
            )

            ttype = self.transform_map[name]
            params = self.params.get(name, {})

            if ttype == "P":
                result[:, i] = values
            elif ttype == "C":
                result[:, i] = np.clip(
                    values,
                    params.get("clip_low", -5),
                    params.get("clip_high", 5),
                )
            elif ttype == "Z":
                std = params.get("std", 1.0)
                if std < 1e-10:
                    result[:, i] = 0.0
                else:
                    result[:, i] = (
                        (values - params.get("mean", 0.0)) / std
                    )
            elif ttype == "L":
                logged = np.log1p(np.maximum(values, 0))
                std = params.get("log_std", 1.0)
                if std < 1e-10:
                    result[:, i] = 0.0
                else:
                    result[:, i] = (
                        (logged - params.get("log_mean", 0.0)) / std
                    )
            elif ttype == "S":
                signed_log = np.sign(values) * np.log1p(np.abs(values))
                std = params.get("slog_std", 1.0)
                if std < 1e-10:
                    result[:, i] = 0.0
                else:
                    result[:, i] = (
                        (signed_log - params.get("slog_mean", 0.0)) / std
                    )

        return result

    def to_dict(self) -> dict:
        """Serialize scaler to JSON-safe dict for artifact storage."""
        return {
            "feature_names": self.feature_names,
            "feature_hash": self.feature_hash,
            "transform_map": self.transform_map,
            "params": self.params,
            "fitted": self.fitted,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "FeatureScaler":
        """Deserialize scaler from dict."""
        scaler = cls()
        scaler.feature_names = d["feature_names"]
        scaler.feature_hash = d["feature_hash"]
        scaler.transform_map = d["transform_map"]
        scaler.params = d["params"]
        scaler.fitted = d["fitted"]
        return scaler
