"""Tests for XGBoost training, walk-forward, decision logic, and position sizing."""

import numpy as np
import pytest
import xgboost as xgb

from satellite.features import AVAIL_COLUMNS, FEATURE_NAMES, NEUTRAL_VALUES
from satellite.normalize import FeatureScaler
from satellite.training.pipeline import TrainingData, prepare_training_data
from satellite.training.train import (
    XGBOOST_PARAMS,
    MAX_BOOST_ROUNDS,
    TrainResult,
    evaluate_model,
    train_both_models,
    train_model,
)
from satellite.training.walkforward import (
    WalkForwardResult,
    run_walk_forward,
)
from satellite.inference import InferenceEngine, compute_position_size


# ─── Fixtures ────────────────────────────────────────────────────────────────


def _make_training_data(
    n_train: int = 200,
    n_val: int = 50,
) -> TrainingData:
    """Create synthetic TrainingData with realistic shape."""
    rng = np.random.default_rng(42)
    n_features = len(FEATURE_NAMES) + len(AVAIL_COLUMNS)  # 21
    feature_names = list(FEATURE_NAMES) + list(AVAIL_COLUMNS)

    # Build feature arrays for scaler fitting
    data = {}
    for name in FEATURE_NAMES:
        data[name] = rng.normal(1.0, 0.5, size=n_train)

    scaler = FeatureScaler()
    scaler.fit(data)

    X_train = rng.normal(0, 1, size=(n_train, n_features)).astype(np.float32)
    X_val = rng.normal(0, 1, size=(n_val, n_features)).astype(np.float32)

    # Targets: noisy linear combination of first few features
    y_train = (
        X_train[:, 0] * 2 + X_train[:, 1] * -1.5
        + rng.normal(0, 1, size=n_train)
    ).astype(np.float32)
    y_val = (
        X_val[:, 0] * 2 + X_val[:, 1] * -1.5
        + rng.normal(0, 1, size=n_val)
    ).astype(np.float32)

    # Clip targets to [-20, 20]
    y_train = np.clip(y_train, -20, 20)
    y_val = np.clip(y_val, -20, 20)

    train_ts = np.arange(n_train, dtype=np.float64) * 300 + 1000.0
    val_ts = np.arange(n_val, dtype=np.float64) * 300 + 1000.0 + n_train * 300

    return TrainingData(
        X_train=X_train,
        y_train=y_train,
        X_val=X_val,
        y_val=y_val,
        scaler=scaler,
        train_timestamps=train_ts,
        val_timestamps=val_ts,
        feature_names=feature_names,
    )


def _make_rows(n: int, start_ts: float = 1000.0) -> list[dict]:
    """Create synthetic labeled rows for walk-forward testing."""
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
        for col in AVAIL_COLUMNS:
            row[col] = 1
        row["best_long_roe_30m_net"] = float(rng.normal(0, 3))
        row["best_short_roe_30m_net"] = float(rng.normal(0, 3))
        rows.append(row)
    return rows


# ─── XGBoost Training Tests ─────────────────────────────────────────────────


class TestXGBoostTraining:

    def test_train_model_runs(self):
        """Training completes without errors on synthetic data."""
        data = _make_training_data()
        result = train_model(data)
        assert result.model is not None
        assert result.val_mae > 0
        assert result.best_iteration >= 1

    def test_huber_loss_used(self):
        """Default params use Huber loss, not squared error."""
        assert XGBOOST_PARAMS["objective"] == "reg:pseudohubererror"
        assert XGBOOST_PARAMS["eval_metric"] == "mae"
        assert XGBOOST_PARAMS["huber_slope"] == 1.0

    def test_early_stopping(self):
        """Training stops before MAX_BOOST_ROUNDS via early stopping."""
        data = _make_training_data()
        result = train_model(data)
        assert result.best_iteration < MAX_BOOST_ROUNDS

    def test_feature_importances_sum_to_one(self):
        """Feature importances (gain-normalized) sum to ~1."""
        data = _make_training_data()
        result = train_model(data)
        total = sum(result.feature_importances.values())
        assert abs(total - 1.0) < 0.01

    def test_train_both_models(self):
        """train_both_models produces a valid ModelArtifact."""
        long_data = _make_training_data()
        short_data = _make_training_data()
        artifact = train_both_models(long_data, short_data, version=1)

        assert artifact.model_long is not None
        assert artifact.model_short is not None
        assert artifact.scaler.fitted is True
        assert artifact.metadata.version == 1
        assert "Long MAE" in artifact.metadata.notes
        assert "Short MAE" in artifact.metadata.notes

    def test_metadata_feature_names_includes_avail(self):
        """Metadata feature_names includes structural + avail columns."""
        long_data = _make_training_data()
        short_data = _make_training_data()
        artifact = train_both_models(long_data, short_data, version=1)

        assert len(artifact.metadata.feature_names) == (
            len(FEATURE_NAMES) + len(AVAIL_COLUMNS)
        )

    def test_evaluate_model_metrics(self):
        """evaluate_model returns expected metric keys."""
        data = _make_training_data()
        result = train_model(data)

        metrics = evaluate_model(
            result.model, data.X_val, data.y_val, data.feature_names,
        )

        assert "mae" in metrics
        assert "rmse" in metrics
        assert "median_ae" in metrics
        assert "directional_accuracy" in metrics
        assert "n_samples" in metrics
        assert metrics["n_samples"] == len(data.y_val)
        assert 0 <= metrics["directional_accuracy"] <= 1

    def test_precision_at_threshold(self):
        """Precision-at-threshold computes for multiple thresholds."""
        data = _make_training_data()
        result = train_model(data)

        metrics = evaluate_model(
            result.model, data.X_val, data.y_val, data.feature_names,
        )

        for t in [1.0, 2.0, 3.0, 5.0]:
            key = f"precision_at_{t}pct"
            assert key in metrics
            # Value is either None (no predictions above threshold) or [0, 1]
            if metrics[key] is not None:
                assert 0 <= metrics[key] <= 1


# ─── Walk-Forward Tests ──────────────────────────────────────────────────────


class TestWalkForward:

    def test_produces_generations(self):
        """Walk-forward produces at least one generation."""
        # Need enough data: 7 days train + 3 days test at 300s interval
        # 7 days = 2016 snapshots, 3 days = 864 snapshots
        rows = _make_rows(3500, start_ts=1000.0)

        result = run_walk_forward(
            rows=rows,
            target_column="best_long_roe_30m_net",
            min_train_days=7,
            test_window_days=3,
            step_days=3,
        )

        assert len(result.generations) >= 1
        assert result.mean_mae > 0

    def test_no_data_leakage(self):
        """Test timestamps are always strictly after train timestamps."""
        rows = _make_rows(3500, start_ts=1000.0)

        result = run_walk_forward(
            rows=rows,
            target_column="best_long_roe_30m_net",
            min_train_days=7,
            test_window_days=3,
            step_days=3,
        )

        for gen in result.generations:
            assert gen.test_start >= gen.train_end

    def test_aggregate_computes(self):
        """Aggregate stats are computed after walk-forward."""
        rows = _make_rows(3500, start_ts=1000.0)

        result = run_walk_forward(
            rows=rows,
            target_column="best_long_roe_30m_net",
            min_train_days=7,
            test_window_days=3,
            step_days=3,
        )

        assert result.summary != ""
        assert result.std_mae >= 0

    def test_insufficient_data_raises(self):
        """Too little data raises ValueError."""
        rows = _make_rows(100, start_ts=1000.0)

        with pytest.raises(ValueError, match="Insufficient data"):
            run_walk_forward(
                rows=rows,
                target_column="best_long_roe_30m_net",
                min_train_days=60,
                test_window_days=14,
            )

    def test_empty_rows_raises(self):
        """Empty row list raises ValueError."""
        with pytest.raises(ValueError, match="No rows"):
            run_walk_forward(
                rows=[],
                target_column="best_long_roe_30m_net",
            )


# ─── Decision Logic Tests ───────────────────────────────────────────────────


class TestDecisionLogic:

    def _make_engine(
        self, threshold: float = 3.0, margin: float = 1.0,
    ) -> InferenceEngine:
        """Create an InferenceEngine with only _decide() usable."""
        engine = InferenceEngine.__new__(InferenceEngine)
        engine._threshold = threshold
        engine._conflict_margin = margin
        return engine

    def test_skip_below_threshold(self):
        """Both predictions below threshold = skip."""
        engine = self._make_engine(threshold=3.0)
        assert engine._decide(2.0, 1.5) == "skip"

    def test_skip_negative_predictions(self):
        """Negative predictions = skip."""
        engine = self._make_engine(threshold=3.0)
        assert engine._decide(-2.0, -5.0) == "skip"

    def test_clear_long(self):
        """Long above threshold, short below = long."""
        engine = self._make_engine(threshold=3.0)
        assert engine._decide(5.0, 1.0) == "long"

    def test_clear_short(self):
        """Short above threshold, long below = short."""
        engine = self._make_engine(threshold=3.0)
        assert engine._decide(1.0, 5.0) == "short"

    def test_conflict_both_above_close(self):
        """Both above threshold, within margin = conflict."""
        engine = self._make_engine(threshold=3.0, margin=1.0)
        assert engine._decide(4.0, 3.5) == "conflict"

    def test_both_above_clear_long_winner(self):
        """Both above threshold, clear long winner = long."""
        engine = self._make_engine(threshold=3.0, margin=1.0)
        assert engine._decide(6.0, 3.5) == "long"

    def test_both_above_clear_short_winner(self):
        """Both above threshold, clear short winner = short."""
        engine = self._make_engine(threshold=3.0, margin=1.0)
        assert engine._decide(3.5, 6.0) == "short"

    def test_threshold_boundary(self):
        """Prediction exactly at threshold = skip (uses > not >=)."""
        engine = self._make_engine(threshold=3.0)
        assert engine._decide(3.0, 2.0) == "skip"

    def test_threshold_adjustable(self):
        """Changing threshold changes decisions."""
        engine = self._make_engine(threshold=5.0)
        assert engine._decide(4.0, 1.0) == "skip"

        engine._threshold = 3.0
        assert engine._decide(4.0, 1.0) == "long"


# ─── Position Sizing Tests ───────────────────────────────────────────────────


class TestPositionSizing:

    def test_at_threshold(self):
        """At exactly threshold + epsilon, position = base size."""
        size = compute_position_size(3.1, entry_threshold=3.0)
        assert size >= 5000  # base_size_usd

    def test_scales_with_roe(self):
        """Higher predicted ROE = larger position."""
        size_low = compute_position_size(4.0, entry_threshold=3.0)
        size_high = compute_position_size(6.0, entry_threshold=3.0)
        assert size_high > size_low

    def test_capped_at_max(self):
        """Position size never exceeds max."""
        size = compute_position_size(100.0, max_size_usd=25000)
        assert size == 25000

    def test_floor_at_base(self):
        """Position size never below base."""
        size = compute_position_size(
            2.0, entry_threshold=3.0, base_size_usd=5000,
        )
        assert size == 5000


# ─── SHAP Tests ──────────────────────────────────────────────────────────────


class TestSHAP:

    def test_explainer_creates(self):
        """SHAP TreeExplainer creates from trained model."""
        from satellite.training.explain import create_explainer

        data = _make_training_data()
        result = train_model(data)
        explainer = create_explainer(result.model)
        assert explainer is not None

    def test_explain_prediction(self):
        """SHAP explanation produces valid output."""
        from satellite.training.explain import (
            create_explainer,
            explain_prediction,
        )

        data = _make_training_data()
        result = train_model(data)
        explainer = create_explainer(result.model)

        # Use first validation row
        transformed = list(data.X_val[0])
        raw = {name: float(data.X_val[0][i]) for i, name in enumerate(
            data.feature_names,
        )}
        pred = float(result.model.predict(
            xgb.DMatrix(data.X_val[:1], feature_names=data.feature_names),
        )[0])

        explanation = explain_prediction(
            explainer, transformed, raw, data.feature_names, pred,
        )

        assert len(explanation.shap_values) == len(data.feature_names)
        assert len(explanation.top_contributors) == len(data.feature_names)
        assert explanation.predicted_roe == pred
        # SHAP values should approximately sum to (prediction - base_value)
        shap_sum = sum(explanation.shap_values)
        expected = pred - explanation.base_value
        assert abs(shap_sum - expected) < 0.5  # within tolerance

    def test_feature_importance_shap(self):
        """SHAP feature importance returns ranked dict."""
        from satellite.training.explain import (
            create_explainer,
            feature_importance_shap,
        )

        data = _make_training_data()
        result = train_model(data)
        explainer = create_explainer(result.model)

        importance = feature_importance_shap(
            explainer, data.X_val, data.feature_names,
        )

        assert len(importance) == len(data.feature_names)
        # Values should be non-negative
        assert all(v >= 0 for v in importance.values())
        # Should be sorted descending
        vals = list(importance.values())
        assert vals == sorted(vals, reverse=True)

    def test_explanation_summary_readable(self):
        """PredictionExplanation.summary produces readable string."""
        from satellite.training.explain import PredictionExplanation

        exp = PredictionExplanation(
            predicted_roe=4.5,
            base_value=0.5,
            feature_names=["f1", "f2"],
            feature_values=[1.0, 2.0],
            shap_values=[2.0, -1.0],
            top_contributors=[("f1", 1.0, 2.0), ("f2", 2.0, -1.0)],
        )
        summary = exp.summary
        assert "4.5" in summary
        assert "f1" in summary


# ─── Schema Tests ────────────────────────────────────────────────────────────


class TestPredictionSchema:

    def test_predictions_table_exists(self):
        """Predictions table created by schema."""
        from satellite.store import SatelliteStore

        store = SatelliteStore(":memory:")
        store.connect()

        # Should not raise
        store.conn.execute(
            "INSERT INTO predictions "
            "(predicted_at, coin, model_version, predicted_long_roe, "
            "predicted_short_roe, signal, entry_threshold) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (1000.0, "BTC", 1, 3.5, -1.0, "long", 3.0),
        )
        store.conn.commit()

        row = store.conn.execute(
            "SELECT * FROM predictions WHERE coin = 'BTC'",
        ).fetchone()
        assert row["signal"] == "long"
        assert row["predicted_long_roe"] == 3.5
        store.close()
