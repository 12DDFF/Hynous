"""Tests for normalization pipeline and model artifacts."""

import json
import math

import numpy as np
import pytest

from satellite.features import (
    AVAIL_COLUMNS,
    FEATURE_HASH,
    FEATURE_NAMES,
    NEUTRAL_VALUES,
)
from satellite.normalize import TRANSFORM_MAP, FeatureScaler
from satellite.training.artifact import ModelArtifact, ModelMetadata


def _make_training_data() -> dict[str, np.ndarray]:
    """Create synthetic training data for all 12 features."""
    rng = np.random.default_rng(42)
    n = 100
    data = {}
    for name in FEATURE_NAMES:
        ttype = TRANSFORM_MAP[name]
        if ttype == "P":
            if name == "liq_cascade_active":
                data[name] = rng.choice([0, 1], size=n).astype(float)
            elif name == "sessions_overlapping":
                data[name] = rng.choice([0, 1, 2], size=n).astype(float)
            else:
                data[name] = rng.uniform(-1, 1, size=n)
        elif ttype == "C":
            data[name] = rng.normal(0, 1.5, size=n)
        elif ttype == "Z":
            data[name] = rng.normal(4, 2, size=n)
        elif ttype == "L":
            data[name] = rng.exponential(1.5, size=n) + 0.5
        elif ttype == "S":
            data[name] = rng.normal(0, 5, size=n)
    return data


# ─── FeatureScaler tests ─────────────────────────────────────────────────────


class TestFeatureScaler:

    def test_passthrough_unchanged(self):
        """Type P features pass through without modification."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)
        result = scaler.transform({"liq_magnet_direction": 0.5})
        idx = FEATURE_NAMES.index("liq_magnet_direction")
        assert result[idx] == 0.5

    def test_clip_only_no_rescale(self):
        """Type C clips but doesn't z-score."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)
        result = scaler.transform({"funding_vs_30d_zscore": 10.0})
        idx = FEATURE_NAMES.index("funding_vs_30d_zscore")
        assert result[idx] == 5.0  # clipped to 5.0

    def test_clip_negative(self):
        """Type C clips negative values too."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)
        result = scaler.transform({"funding_vs_30d_zscore": -10.0})
        idx = FEATURE_NAMES.index("funding_vs_30d_zscore")
        assert result[idx] == -5.0

    def test_zscore_centering(self):
        """Type Z centers to mean=0, std=1."""
        scaler = FeatureScaler()
        data = _make_training_data()
        # Use constant values for predictable z-score
        data["hours_to_funding"] = np.array([4.0] * 50 + [6.0] * 50)
        scaler.fit(data)
        # Transform the mean value (5.0) — should be near 0
        result = scaler.transform({"hours_to_funding": 5.0})
        idx = FEATURE_NAMES.index("hours_to_funding")
        assert abs(result[idx]) < 0.1

    def test_log_zscore_positive_ratios(self):
        """Type L applies log1p then z-score for positive ratios."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)
        # A ratio of 1.0 (neutral) should be near 0 after log+z
        result = scaler.transform({"oi_vs_7d_avg_ratio": 1.0})
        idx = FEATURE_NAMES.index("oi_vs_7d_avg_ratio")
        # Should be finite, not crash
        assert math.isfinite(result[idx])

    def test_signed_log_zscore(self):
        """Type S handles negative values via signed log."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)
        # Positive and negative should produce opposite signs
        result_pos = scaler.transform({"oi_funding_pressure": 5.0})
        result_neg = scaler.transform({"oi_funding_pressure": -5.0})
        idx = FEATURE_NAMES.index("oi_funding_pressure")
        # Signs should differ (or both near 0 if mean is large)
        assert result_pos[idx] != result_neg[idx]

    def test_nan_imputed_to_neutral(self):
        """NaN values are imputed to neutral before transform."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)
        result = scaler.transform({"liq_magnet_direction": float("nan")})
        idx = FEATURE_NAMES.index("liq_magnet_direction")
        assert result[idx] == NEUTRAL_VALUES["liq_magnet_direction"]

    def test_none_imputed_to_neutral(self):
        """None values are imputed to neutral before transform."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)
        result = scaler.transform({"liq_magnet_direction": None})
        idx = FEATURE_NAMES.index("liq_magnet_direction")
        assert result[idx] == NEUTRAL_VALUES["liq_magnet_direction"]

    def test_transform_returns_12_values(self):
        """Transform output has exactly 12 values."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)
        result = scaler.transform({})
        assert len(result) == 12

    def test_transform_batch_shape(self):
        """Batch transform produces correct shape."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)
        result = scaler.transform_batch(data)
        assert result.shape == (100, 12)

    def test_serialization_roundtrip(self):
        """Scaler survives to_dict/from_dict roundtrip."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)

        serialized = scaler.to_dict()
        restored = FeatureScaler.from_dict(serialized)

        assert restored.feature_hash == scaler.feature_hash
        assert restored.fitted is True
        assert restored.transform_map == scaler.transform_map
        assert restored.params.keys() == scaler.params.keys()

    def test_serialization_json_safe(self):
        """Serialized scaler is valid JSON."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)
        # Should not raise
        json_str = json.dumps(scaler.to_dict())
        assert len(json_str) > 0

    def test_transform_before_fit_raises(self):
        """Transforming before fitting raises ValueError."""
        scaler = FeatureScaler()
        with pytest.raises(ValueError, match="not fitted"):
            scaler.transform({"liq_magnet_direction": 0.5})

    def test_transform_batch_before_fit_raises(self):
        """Batch transform before fitting raises ValueError."""
        scaler = FeatureScaler()
        with pytest.raises(ValueError, match="not fitted"):
            scaler.transform_batch(
                {"liq_magnet_direction": np.array([0.5])},
            )

    def test_feature_hash_set_on_fit(self):
        """Fitting sets the feature hash from FEATURE_HASH."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)
        assert scaler.feature_hash == FEATURE_HASH

    def test_transform_map_complete(self):
        """Every feature in FEATURE_NAMES has a transform type."""
        for name in FEATURE_NAMES:
            assert name in TRANSFORM_MAP, f"Missing transform for {name}"

    def test_single_vs_batch_consistency(self):
        """Single transform and batch transform produce same results."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)

        # Transform first row individually
        row = {name: float(data[name][0]) for name in FEATURE_NAMES}
        single_result = scaler.transform(row)

        # Transform as batch, take first row
        batch_result = scaler.transform_batch(data)

        for i in range(12):
            assert abs(single_result[i] - batch_result[0, i]) < 1e-10, (
                f"Mismatch at feature {FEATURE_NAMES[i]}: "
                f"single={single_result[i]}, batch={batch_result[0, i]}"
            )


# ─── ModelArtifact tests ─────────────────────────────────────────────────────


class TestModelArtifact:

    def test_feature_hash_mismatch_raises(self, tmp_path):
        """Loading artifact with wrong feature hash raises ValueError."""
        metadata = ModelMetadata(
            version=1,
            feature_hash="wrong_hash_12345",
            feature_names=["fake"],
            created_at="2026-01-01T00:00:00Z",
            training_samples=100,
            training_start="2026-01-01T00:00:00Z",
            training_end="2026-02-01T00:00:00Z",
            validation_mae=2.5,
            validation_samples=20,
            xgboost_params={},
        )
        version_dir = tmp_path / "v1"
        version_dir.mkdir()
        with open(version_dir / "metadata_v1.json", "w") as f:
            json.dump(metadata.to_dict(), f)

        with pytest.raises(ValueError, match="Feature hash mismatch"):
            ModelArtifact.load(version_dir)

    def test_save_and_load_roundtrip(self, tmp_path):
        """Artifact saves and loads correctly."""
        scaler = FeatureScaler()
        data = _make_training_data()
        scaler.fit(data)

        # Use simple dummy models (just dicts for testing, not real XGBoost)
        metadata = ModelMetadata(
            version=1,
            feature_hash=FEATURE_HASH,
            feature_names=list(FEATURE_NAMES),
            created_at="2026-02-28T00:00:00Z",
            training_samples=100,
            training_start="2026-01-01T00:00:00Z",
            training_end="2026-02-01T00:00:00Z",
            validation_mae=2.5,
            validation_samples=20,
            xgboost_params={"max_depth": 4},
        )

        artifact = ModelArtifact(
            model_long={"type": "dummy_long"},
            model_short={"type": "dummy_short"},
            scaler=scaler,
            metadata=metadata,
        )

        saved_dir = artifact.save(tmp_path / "artifacts")
        loaded = ModelArtifact.load(saved_dir)

        assert loaded.metadata.version == 1
        assert loaded.metadata.feature_hash == FEATURE_HASH
        assert loaded.scaler.fitted is True
        assert loaded.model_long == {"type": "dummy_long"}
        assert loaded.model_short == {"type": "dummy_short"}

    def test_metadata_serialization(self):
        """ModelMetadata survives to_dict/from_dict."""
        meta = ModelMetadata(
            version=3,
            feature_hash=FEATURE_HASH,
            feature_names=list(FEATURE_NAMES),
            created_at="2026-02-28T12:00:00Z",
            training_samples=500,
            training_start="2026-01-01T00:00:00Z",
            training_end="2026-02-15T00:00:00Z",
            validation_mae=1.8,
            validation_samples=50,
            xgboost_params={"max_depth": 4, "learning_rate": 0.03},
            notes="test run",
        )
        d = meta.to_dict()
        restored = ModelMetadata.from_dict(d)
        assert restored.version == 3
        assert restored.notes == "test run"
        assert restored.validation_mae == 1.8


# ─── Pipeline tests ──────────────────────────────────────────────────────────


class TestPipeline:

    def _make_rows(self, n: int, start_ts: float = 1000.0) -> list[dict]:
        """Create synthetic labeled rows."""
        rng = np.random.default_rng(42)
        rows = []
        for i in range(n):
            row = {
                "created_at": start_ts + i * 300,
                "coin": "BTC",
                "snapshot_id": f"snap-{i}",
            }
            for name in FEATURE_NAMES:
                row[name] = float(rng.normal(1.0, 0.5))
            # Avail flags (from canonical AVAIL_COLUMNS)
            for col in AVAIL_COLUMNS:
                row[col] = 1
            # Labels
            row["best_long_roe_30m_net"] = float(rng.normal(0, 3))
            row["best_short_roe_30m_net"] = float(rng.normal(0, 3))
            rows.append(row)
        return rows

    def test_prepare_training_data(self):
        """Pipeline splits, fits, and transforms correctly."""
        from satellite.training.pipeline import prepare_training_data

        rows = self._make_rows(100)
        train_end = rows[79]["created_at"] + 1  # 80/20 split

        td = prepare_training_data(
            rows, "best_long_roe_30m_net", train_end,
        )

        assert td.X_train.shape[0] == 80
        assert td.X_val.shape[0] == 20
        # 12 features + 9 avail flags = 21 columns
        assert td.X_train.shape[1] == 12 + len(AVAIL_COLUMNS)
        assert td.scaler.fitted is True
        assert len(td.feature_names) == 12 + len(AVAIL_COLUMNS)

    def test_targets_clipped(self):
        """Training targets are clipped to [-20, +20]."""
        from satellite.training.pipeline import prepare_training_data

        rows = self._make_rows(100)
        # Inject extreme values
        rows[0]["best_long_roe_30m_net"] = 50.0
        rows[1]["best_long_roe_30m_net"] = -50.0
        train_end = rows[79]["created_at"] + 1

        td = prepare_training_data(
            rows, "best_long_roe_30m_net", train_end,
        )

        assert td.y_train.max() <= 20.0
        assert td.y_train.min() >= -20.0

    def test_too_few_train_samples(self):
        """Raises if fewer than 50 training samples."""
        from satellite.training.pipeline import prepare_training_data

        rows = self._make_rows(55)
        # Split at 30/25 — train=30 is below minimum
        train_end = rows[29]["created_at"] + 1

        with pytest.raises(ValueError, match="Too few training"):
            prepare_training_data(
                rows, "best_long_roe_30m_net", train_end,
            )

    def test_too_few_val_samples(self):
        """Raises if fewer than 10 validation samples."""
        from satellite.training.pipeline import prepare_training_data

        rows = self._make_rows(55)
        # Split at 50/5 — val=5 is below minimum
        train_end = rows[49]["created_at"] + 1

        with pytest.raises(ValueError, match="Too few validation"):
            prepare_training_data(
                rows, "best_long_roe_30m_net", train_end,
            )

    def test_time_based_split(self):
        """Split is by time, not random — train timestamps < val timestamps."""
        from satellite.training.pipeline import prepare_training_data

        rows = self._make_rows(100)
        train_end = rows[79]["created_at"] + 1

        td = prepare_training_data(
            rows, "best_long_roe_30m_net", train_end,
        )

        assert td.train_timestamps.max() < td.val_timestamps.min()
