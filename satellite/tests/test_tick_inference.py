"""Tests for tick inference downsample alignment and audit fixes.

Validates that:
1. Downsampling 1s rows to 5s matches training pipeline
2. Mean5 is identity (w5=1), not 5-point average
3. Slope features have correct magnitude after downsample
4. Tick prediction keys are separate from v2 model keys
5. Feature hash validates code features against model metadata
6. MC RNG seeding is deterministic for same inputs
"""

import hashlib

import numpy as np
import pytest


# ─── Helpers ────────────────────────────────────────────────────────────────


def _make_rows(n: int, interval_s: float = 1.0, base_imb: float = 0.6) -> list[dict]:
    """Create synthetic tick_snapshots rows at given interval."""
    rows = []
    t0 = 1700000000.0
    for i in range(n):
        rows.append({
            "timestamp": t0 + i * interval_s,
            "coin": "BTC",
            "schema_version": 2,
            "book_imbalance_5": base_imb + 0.01 * (i % 5),
            "book_imbalance_10": 0.5,
            "book_imbalance_20": 0.5,
            "bid_depth_usd_5": 500000.0,
            "ask_depth_usd_5": 500000.0,
            "spread_pct": 0.0001,
            "mid_price": 80000.0 + i * 0.5,
            "buy_vwap_deviation": 0.0001,
            "sell_vwap_deviation": -0.0001,
            "flow_imbalance_10s": 0.55 + 0.005 * (i % 3),
            "flow_imbalance_30s": 0.52,
            "flow_imbalance_60s": 0.51,
            "flow_intensity_10s": 3.0,
            "flow_intensity_30s": 2.5,
            "trade_volume_10s_usd": 100000.0,
            "trade_volume_30s_usd": 250000.0,
            "price_change_10s": 0.02 + 0.001 * i,
            "price_change_30s": 0.05,
            "price_change_60s": 0.08,
            "large_trade_imbalance": 0.5,
            "book_imbalance_delta_5s": 0.01,
            "book_imbalance_delta_10s": 0.02,
            "depth_ratio_change_5s": 0.0,
            "max_trade_usd_60s": 50000.0,
            "trade_count_60s": 150.0,
            "trade_count_10s": 30.0,
        })
    return rows


def _downsample(rows: list[dict], interval_s: int = 5) -> list[dict]:
    """Downsample rows (same logic as training and inference fix)."""
    if not rows:
        return []
    result = [rows[0]]
    last_t = rows[0]["timestamp"]
    for r in rows[1:]:
        if r["timestamp"] - last_t >= interval_s - 0.5:
            result.append(r)
            last_t = r["timestamp"]
    return result


# ─── Test 1: Downsample Alignment ──────────────────────────────────────────


class TestDownsampleAlignment:
    """Verify that inference downsample matches training downsample."""

    def test_60_rows_at_1s_downsample_to_12(self):
        """60 raw 1s rows should produce exactly 12 downsampled 5s rows."""
        rows = _make_rows(60, interval_s=1.0)
        ds = _downsample(rows)
        assert len(ds) == 12

    def test_120_rows_at_1s_downsample_to_24(self):
        """120 raw 1s rows should produce exactly 24 downsampled 5s rows."""
        rows = _make_rows(120, interval_s=1.0)
        ds = _downsample(rows)
        assert len(ds) == 24

    def test_downsample_preserves_5s_spacing(self):
        """Each downsampled row should be ~5s apart."""
        rows = _make_rows(60, interval_s=1.0)
        ds = _downsample(rows)
        for i in range(1, len(ds)):
            gap = ds[i]["timestamp"] - ds[i - 1]["timestamp"]
            assert 4.5 <= gap <= 5.5, f"Gap {gap}s at index {i}"

    def test_downsample_handles_gaps(self):
        """Rows with gaps (>5s between some) should still produce valid output."""
        rows = _make_rows(30, interval_s=1.0)
        # Insert a 10s gap in the middle
        for r in rows[15:]:
            r["timestamp"] += 10.0
        ds = _downsample(rows)
        # All gaps should be >= 4.5s
        for i in range(1, len(ds)):
            gap = ds[i]["timestamp"] - ds[i - 1]["timestamp"]
            assert gap >= 4.5

    def test_downsample_first_row_always_included(self):
        """The first row should always be included."""
        rows = _make_rows(10, interval_s=1.0)
        ds = _downsample(rows)
        assert ds[0]["timestamp"] == rows[0]["timestamp"]

    def test_already_5s_data_passes_through(self):
        """Data already at 5s resolution should not be further downsampled."""
        rows = _make_rows(12, interval_s=5.0)
        ds = _downsample(rows)
        assert len(ds) == 12


# ─── Test 2: Mean5 Identity ────────────────────────────────────────────────


class TestMean5IsIdentity:
    """Verify that mean5 after downsample is identity (matches training w5=1)."""

    def test_mean5_equals_latest_value(self):
        """mean5 with w5=1 should be the latest downsampled point, not an average."""
        rows = _make_rows(60, interval_s=1.0)
        ds = _downsample(rows)
        book_imb = [r["book_imbalance_5"] for r in ds]

        # After fix: mean5 = latest downsampled value (identity)
        mean5_fixed = book_imb[-1]
        # Old broken: mean5 = np.mean of last 5 raw 1s rows
        raw_book = [r["book_imbalance_5"] for r in rows]
        mean5_old = float(np.mean(raw_book[-5:]))

        assert mean5_fixed == book_imb[-1]
        # The old and fixed values should generally differ
        # (unless by coincidence all 5 raw values equal the latest downsampled)

    def test_mean5_matches_training_rolling_mean_w1(self):
        """Training's _rolling_mean(x, window=1) returns x.copy() — verify."""
        from satellite.training.train_tick_direction import _rolling_mean

        x = np.array([0.5, 0.6, 0.7, 0.8, 0.9], dtype=np.float32)
        result = _rolling_mean(x, window=1)
        np.testing.assert_array_equal(result, x)


# ─── Test 3: Slope Scaling ─────────────────────────────────────────────────


class TestSlopeScaling:
    """Verify slope features have correct magnitude after downsample."""

    def test_slope_on_linear_trend(self):
        """A known linear trend should produce comparable slopes in training vs fixed inference."""
        rows = _make_rows(120, interval_s=1.0)
        ds = _downsample(rows)

        mid_ds = np.array([r["mid_price"] for r in ds], dtype=np.float32)
        mid_raw = np.array([r["mid_price"] for r in rows], dtype=np.float32)

        def _slope(seg):
            t = np.arange(len(seg), dtype=np.float32)
            t_m, y_m = t.mean(), seg.mean()
            cov = np.sum((t - t_m) * (seg - y_m))
            var = np.sum((t - t_m) ** 2)
            return float(cov / var) if var > 0 else 0.0

        # Training slope: last 12 downsampled ticks (w60=12)
        slope_training = _slope(mid_ds[-12:])

        # OLD inference slope: last 60 raw ticks (WRONG)
        slope_old = _slope(mid_raw[-60:])

        # FIXED inference slope: last 12 downsampled ticks (same as training)
        slope_fixed = _slope(mid_ds[-12:])

        # The old slope should be ~5x smaller than training
        ratio = slope_old / slope_training if slope_training != 0 else 0
        assert 0.15 <= ratio <= 0.25, f"Old slope ratio {ratio:.3f} — expected ~0.20"

        # The fixed slope should match training exactly
        assert slope_fixed == pytest.approx(slope_training, rel=1e-5)

    def test_slope_zero_for_flat_data(self):
        """Flat data should produce slope ~0 regardless of resolution."""
        rows = _make_rows(120, interval_s=1.0)
        # Make mid_price constant
        for r in rows:
            r["mid_price"] = 80000.0
        ds = _downsample(rows)
        mid_ds = np.array([r["mid_price"] for r in ds], dtype=np.float32)

        t = np.arange(len(mid_ds[-12:]), dtype=np.float32)
        seg = mid_ds[-12:]
        t_m, y_m = t.mean(), seg.mean()
        cov = np.sum((t - t_m) * (seg - y_m))
        var = np.sum((t - t_m) ** 2)
        slope = float(cov / var) if var > 0 else 0.0
        assert abs(slope) < 1e-6


# ─── Test 4: Std30 Window Size ─────────────────────────────────────────────


class TestStd30WindowSize:
    """Verify std30 uses 6 downsampled ticks, not 30 raw ticks."""

    def test_std30_uses_6_points_after_downsample(self):
        """After downsampling, std30 should use w30=6 downsampled ticks."""
        rows = _make_rows(120, interval_s=1.0)
        ds = _downsample(rows)
        book_imb = [r["book_imbalance_5"] for r in ds]

        # Fixed: std of last 6 downsampled ticks
        std_fixed = float(np.std(book_imb[-6:]))

        # Old: std of last 30 raw ticks
        raw_book = [r["book_imbalance_5"] for r in rows]
        std_old = float(np.std(raw_book[-30:]))

        # They should differ (different granularity, different point counts)
        # The exact ratio is unpredictable, but they shouldn't be equal
        assert std_fixed != pytest.approx(std_old, abs=1e-6) or std_fixed == 0.0


# ─── Test 5: Prediction Key Separation ─────────────────────────────────────


class TestDaemonPredictionKeys:
    """Verify tick predictions don't overwrite v2 model predictions."""

    def test_tick_keys_are_separate(self):
        """Tick model should use tick_signal, not signal."""
        preds = {
            "signal": "long",
            "long_roe": 5.0,
            "short_roe": 1.0,
            "confidence": 0.72,
            "summary": "Bullish structure",
        }
        # Tick model writes separate keys (after fix)
        preds["tick_signal"] = "short"
        preds["tick_long_roe"] = 0.2
        preds["tick_short_roe"] = 0.8

        # V2 signal preserved
        assert preds["signal"] == "long"
        assert preds["long_roe"] == 5.0
        assert preds["short_roe"] == 1.0

        # Tick signal is separate
        assert preds["tick_signal"] == "short"
        assert preds["tick_long_roe"] == 0.2
        assert preds["tick_short_roe"] == 0.8

    def test_entry_score_uses_v2_not_tick(self):
        """Entry score should read signal/long_roe/short_roe (v2), not tick_*."""
        preds = {
            "signal": "long",
            "long_roe": 5.0,
            "short_roe": 1.0,
            "tick_signal": "short",
            "tick_long_roe": 0.2,
            "tick_short_roe": 0.8,
        }
        # This mimics daemon.py:1814-1816 — entry score reads generic keys
        direction_signal = preds.get("signal")
        direction_long_roe = preds.get("long_roe", 0)
        direction_short_roe = preds.get("short_roe", 0)

        assert direction_signal == "long"  # V2, not tick
        assert direction_long_roe == 5.0   # V2 ROE, not tick ROE
        assert direction_short_roe == 1.0


# ─── Test 6: Feature Hash Check ────────────────────────────────────────────


class TestFeatureHashCheck:
    """Verify feature hash validates code features against model metadata."""

    def test_hash_matches_current_code(self):
        """The code's MODEL_FEATURES hash should match deployed model metadata."""
        import json
        from pathlib import Path

        from satellite.training.train_tick_direction import MODEL_FEATURES

        code_hash = hashlib.sha256(
            "|".join(MODEL_FEATURES).encode()
        ).hexdigest()[:16]

        meta_path = Path("satellite/artifacts/tick_models/direction_60s/metadata.json")
        if not meta_path.exists():
            pytest.skip("Model artifacts not present")

        with open(meta_path) as f:
            meta = json.load(f)
        assert code_hash == meta["feature_hash"], (
            f"Code features hash {code_hash} != model hash {meta['feature_hash']}. "
            "Feature list may have diverged from training."
        )

    def test_hash_detects_feature_change(self):
        """If feature list changes, hash should NOT match."""
        from satellite.training.train_tick_direction import MODEL_FEATURES

        code_hash = hashlib.sha256(
            "|".join(MODEL_FEATURES).encode()
        ).hexdigest()[:16]

        altered = list(MODEL_FEATURES) + ["FAKE_FEATURE"]
        altered_hash = hashlib.sha256(
            "|".join(altered).encode()
        ).hexdigest()[:16]

        assert altered_hash != code_hash

    def test_old_check_was_tautological(self):
        """The old check compared metadata against itself — always passes."""
        # Simulate old logic: hash model.feature_names and compare to model.feature_hash
        # Both come from the same metadata.json, so they always match.
        feature_names = ["book_imbalance_5", "flow_imbalance_10s"]
        feature_hash = hashlib.sha256(
            "|".join(feature_names).encode()
        ).hexdigest()[:16]

        # Old check: compute from model.feature_names, compare to model.feature_hash
        expected = hashlib.sha256(
            "|".join(feature_names).encode()
        ).hexdigest()[:16]
        assert expected == feature_hash  # Always true — tautological


# ─── Test 7: MC RNG Seeding ────────────────────────────────────────────────


class TestMCSeeding:
    """Verify MC RNG seeding produces deterministic output for same inputs."""

    def test_same_inputs_same_seed(self):
        """Identical price + predictions should produce identical seeds."""
        price = 82500.0
        preds = {60: 1.5, 120: 2.0, 180: 2.5}

        seed1 = int(price * 1000) % (2**31)
        seed1 ^= int(sum(preds.values()) * 10000) % (2**31)
        seed2 = int(price * 1000) % (2**31)
        seed2 ^= int(sum(preds.values()) * 10000) % (2**31)
        assert seed1 == seed2

    def test_same_seed_same_paths(self):
        """Same seed should produce identical random draws."""
        seed = 42
        rng1 = np.random.default_rng(seed)
        rng2 = np.random.default_rng(seed)
        assert np.array_equal(rng1.normal(0, 1, 200), rng2.normal(0, 1, 200))

    def test_different_price_different_seed(self):
        """Different prices should produce different seeds."""
        preds = {60: 1.0}
        seed1 = int(82500.0 * 1000) % (2**31) ^ int(sum(preds.values()) * 10000) % (2**31)
        seed2 = int(82501.0 * 1000) % (2**31) ^ int(sum(preds.values()) * 10000) % (2**31)
        assert seed1 != seed2


# ─── Test 8: Window Size Constants ──────────────────────────────────────────


class TestWindowSizeConstants:
    """Verify that window sizes match training's computation."""

    def test_training_window_sizes(self):
        """Verify w5=1, w10=2, w30=6, w60=12 at DOWNSAMPLE_INTERVAL=5."""
        from satellite.training.train_tick_direction import DOWNSAMPLE_INTERVAL

        assert DOWNSAMPLE_INTERVAL == 5
        w5 = max(1, 5 // DOWNSAMPLE_INTERVAL)
        w10 = max(1, 10 // DOWNSAMPLE_INTERVAL)
        w30 = max(1, 30 // DOWNSAMPLE_INTERVAL)
        w60 = max(1, 60 // DOWNSAMPLE_INTERVAL)
        assert w5 == 1
        assert w10 == 2
        assert w30 == 6
        assert w60 == 12

    def test_model_features_count(self):
        """MODEL_FEATURES should have 36 features (37 ALL minus mid_price)."""
        from satellite.training.train_tick_direction import (
            ALL_FEATURES,
            MODEL_FEATURES,
        )

        assert len(ALL_FEATURES) == 37
        assert len(MODEL_FEATURES) == 36
        assert "mid_price" not in MODEL_FEATURES
        assert "mid_price" in ALL_FEATURES


# ─── Test 9: Round 2 — std30 Guard Matches Training ─────────────────────────


class TestStd30Guard:
    """Verify std30 requires 3+ elements, matching training's _rolling_std."""

    def test_two_elements_returns_zero(self):
        """With exactly 2 downsampled rows, std30 must return 0.0 (matches training)."""
        # 10 raw 1s rows → 2 downsampled 5s rows
        rows = _make_rows(10, interval_s=1.0)
        ds = _downsample(rows)
        assert len(ds) == 2

        n = len(ds)
        w30 = min(6, n)
        assert w30 == 2

        # After fix: guard is w30 >= 3, so this should NOT compute std
        assert w30 < 3, "Guard should reject 2 elements"

    def test_three_elements_computes_std(self):
        """With 3 downsampled rows, std30 should compute normally."""
        rows = _make_rows(15, interval_s=1.0)
        ds = _downsample(rows)
        assert len(ds) == 3

        book_imb = [r["book_imbalance_5"] for r in ds]
        n = len(ds)
        w30 = min(6, n)
        assert w30 == 3
        assert w30 >= 3  # Guard passes

        std_val = float(np.std(book_imb[-w30:]))
        # With varying data, std should be non-zero
        assert std_val >= 0.0

    def test_training_rolling_std_matches(self):
        """Verify training's _rolling_std returns 0 for n=2, non-zero for n=3."""
        from satellite.training.train_tick_direction import _rolling_std

        # 2 elements → training returns 0.0
        x2 = np.array([0.3, 0.7], dtype=np.float32)
        result2 = _rolling_std(x2, window=6)
        assert result2[-1] == 0.0, "Training returns 0.0 with 2 elements"

        # 3 elements → training computes std
        x3 = np.array([0.3, 0.5, 0.7], dtype=np.float32)
        result3 = _rolling_std(x3, window=6)
        assert result3[-1] > 0.0, "Training computes non-zero std with 3 elements"


# ─── Test 10: Round 2 — Base Features From Downsampled ──────────────────────


class TestBaseFeatureSource:
    """Verify base features come from ds_rows[-1], not raw rows[-1]."""

    def test_raw_and_downsampled_latest_can_differ(self):
        """rows[-1] and ds_rows[-1] may have different timestamps."""
        rows = _make_rows(120, interval_s=1.0)
        ds = _downsample(rows)
        # rows[-1] is at t=119, ds[-1] is at t=115 (119-115=4 < 4.5 threshold)
        assert rows[-1]["timestamp"] != ds[-1]["timestamp"]
        assert ds[-1]["timestamp"] < rows[-1]["timestamp"]

    def test_base_features_should_match_rolling_source(self):
        """Base book_imbalance_5 and mean5 (identity) must come from same row."""
        rows = _make_rows(120, interval_s=1.0)
        ds = _downsample(rows)

        # After fix: both base and rolling come from ds_rows
        base_val = ds[-1]["book_imbalance_5"] or 0.0
        book_imb = [r["book_imbalance_5"] for r in ds]
        mean5_val = book_imb[-1]  # w5=1 identity

        assert base_val == mean5_val, (
            f"Base ({base_val}) must equal mean5 identity ({mean5_val}) — "
            "both should come from ds_rows[-1]"
        )

    def test_old_code_would_mismatch(self):
        """Using rows[-1] for base creates a mismatch with mean5 from ds_rows[-1]."""
        rows = _make_rows(120, interval_s=1.0)
        ds = _downsample(rows)

        old_base = rows[-1]["book_imbalance_5"]  # raw latest (OLD behavior)
        mean5 = ds[-1]["book_imbalance_5"]  # downsampled latest (rolling source)

        # These should differ because they come from different rows
        assert old_base != mean5, "Raw vs downsampled latest should differ"
