"""Tests for satellite.entry_score composite entry scoring."""

import pytest
from satellite.entry_score import (
    EntryScore,
    EntryScoreConfig,
    compute_entry_score,
    score_to_sizing_factor,
)


def _make_conditions(
    entry_quality_pctl=50,
    vol_1h_regime="normal",
    funding_4h_pctl=50,
    volume_1h_regime="normal",
    mae_long_pctl=50,
    mae_short_pctl=50,
) -> dict:
    """Helper to build a conditions dict like MarketConditions.to_dict()."""
    return {
        "coin": "BTC",
        "timestamp": 0.0,
        "entry_quality": {"value": 0.5, "percentile": entry_quality_pctl, "regime": "normal"},
        "vol_1h": {"value": 0.02, "percentile": 50, "regime": vol_1h_regime},
        "funding_4h": {"value": 0.0, "percentile": funding_4h_pctl, "regime": "normal"},
        "volume_1h": {"value": 1.0, "percentile": 50, "regime": volume_1h_regime},
        "mae_long": {"value": 1.0, "percentile": mae_long_pctl, "regime": "normal"},
        "mae_short": {"value": 1.0, "percentile": mae_short_pctl, "regime": "normal"},
    }


# ─── Test 1: all 6 components present → 0-100 range ─────────────────────────

class TestComputeEntryScoreAllComponents:

    def test_score_in_range(self):
        conditions = _make_conditions()
        score = compute_entry_score(
            conditions,
            direction_signal="long",
            direction_long_roe=7.0,
            direction_short_roe=2.0,
        )
        assert isinstance(score, EntryScore)
        assert 0.0 <= score.score <= 100.0

    def test_all_six_components_present(self):
        conditions = _make_conditions()
        score = compute_entry_score(
            conditions,
            direction_signal="long",
            direction_long_roe=7.0,
            direction_short_roe=2.0,
        )
        assert len(score.components) == 6
        assert "direction_edge" in score.components


# ─── Test 2: only 2 components → graceful degradation ────────────────────────

class TestGracefulDegradation:

    def test_two_components(self):
        # Only entry_quality and vol_1h present
        conditions = {
            "entry_quality": {"value": 0.6, "percentile": 60, "regime": "normal"},
            "vol_1h": {"value": 0.02, "percentile": 50, "regime": "normal"},
        }
        score = compute_entry_score(conditions)
        assert isinstance(score, EntryScore)
        assert 0.0 <= score.score <= 100.0
        assert len(score.components) == 2


# ─── Test 3: empty conditions → returns 50.0 ─────────────────────────────────

class TestEmptyConditions:

    def test_empty_returns_fifty(self):
        score = compute_entry_score({})
        assert score.score == 50.0
        assert score.components == {}

    def test_empty_coin_label(self):
        score = compute_entry_score({}, coin="ETH")
        assert score.coin == "ETH"
        assert score.score == 50.0


# ─── Test 4: high quality conditions → score > 70 ────────────────────────────

class TestHighQualityScore:

    def test_favorable_conditions_score_above_70(self):
        # entry quality 90th pctl, low vol (favorable), neutral funding
        conditions = _make_conditions(
            entry_quality_pctl=90,
            vol_1h_regime="low",   # low vol = 0.80 favorability
            funding_4h_pctl=50,    # perfectly neutral funding
            volume_1h_regime="high",
            mae_long_pctl=20,      # low MAE = safe
            mae_short_pctl=20,
        )
        score = compute_entry_score(conditions)
        assert score.score > 70, f"Expected > 70, got {score.score:.1f}"


# ─── Test 5: poor conditions → score < 30 ────────────────────────────────────

class TestPoorConditionsScore:

    def test_unfavorable_conditions_score_below_30(self):
        # entry quality 10th pctl, extreme vol, extreme funding (distant from 50)
        conditions = _make_conditions(
            entry_quality_pctl=10,
            vol_1h_regime="extreme",  # 0.15 favorability
            funding_4h_pctl=0,        # max distance from 50 → 0.0 safety
            volume_1h_regime="low",
            mae_long_pctl=95,
            mae_short_pctl=95,
        )
        score = compute_entry_score(conditions)
        assert score.score < 30, f"Expected < 30, got {score.score:.1f}"


# ─── Test 6: score_to_sizing_factor boundary values ──────────────────────────

class TestScoreToSizingFactor:

    def test_score_zero_returns_floor(self):
        assert score_to_sizing_factor(0) == pytest.approx(0.5)

    def test_score_100_returns_ceiling(self):
        assert score_to_sizing_factor(100) == pytest.approx(1.2)

    def test_score_50_returns_midpoint(self):
        # Linear interpolation: 0.5 + 0.5 * (1.2 - 0.5) = 0.5 + 0.35 = 0.85
        assert score_to_sizing_factor(50) == pytest.approx(0.85)

    def test_custom_floor_ceiling(self):
        assert score_to_sizing_factor(0, floor=0.3, ceiling=1.5) == pytest.approx(0.3)
        assert score_to_sizing_factor(100, floor=0.3, ceiling=1.5) == pytest.approx(1.5)

    def test_out_of_range_clamped(self):
        assert score_to_sizing_factor(-10) == pytest.approx(0.5)
        assert score_to_sizing_factor(110) == pytest.approx(1.2)


# ─── Test 7: to_briefing_line returns non-empty with score + label ────────────

class TestToBriefingLine:

    def test_briefing_line_non_empty(self):
        conditions = _make_conditions(entry_quality_pctl=70)
        score = compute_entry_score(conditions)
        line = score.to_briefing_line()
        assert isinstance(line, str)
        assert len(line) > 0

    def test_briefing_line_contains_score_and_label(self):
        conditions = _make_conditions(entry_quality_pctl=90, vol_1h_regime="low")
        score = compute_entry_score(conditions)
        line = score.to_briefing_line()
        assert str(int(score.score)) in line or f"{score.score:.0f}" in line
        assert score.label in line

    def test_label_excellent(self):
        conditions = _make_conditions(
            entry_quality_pctl=95,
            vol_1h_regime="low",
            funding_4h_pctl=50,
            mae_long_pctl=10,
            mae_short_pctl=10,
            volume_1h_regime="high",
        )
        score = compute_entry_score(
            conditions,
            direction_signal="long",
            direction_long_roe=10.0,
        )
        # score should be very high
        assert score.label in ("excellent", "good")


# ─── Test 8: direction edge with strong signal → close to 1.0 ─────────────────

class TestDirectionEdge:

    def test_strong_long_signal(self):
        conditions = {}  # Only test direction edge in isolation
        score = compute_entry_score(
            conditions,
            direction_signal="long",
            direction_long_roe=10.0,
            direction_short_roe=1.0,
        )
        # direction_edge = min(1.0, (10.0 - 3.0) / 7.0) = 1.0
        assert score.components.get("direction_edge") == pytest.approx(1.0)

    def test_mid_long_signal(self):
        conditions = {}
        score = compute_entry_score(
            conditions,
            direction_signal="long",
            direction_long_roe=6.5,
            direction_short_roe=1.0,
        )
        # direction_edge = (6.5 - 3.0) / 7.0 = 0.5
        assert score.components.get("direction_edge") == pytest.approx(0.5)


# ─── Test 9: no direction signal → direction_edge not in components ───────────

class TestNoDirectionSignal:

    def test_none_signal_no_direction_edge(self):
        conditions = _make_conditions()
        score = compute_entry_score(conditions, direction_signal=None)
        assert "direction_edge" not in score.components

    def test_skip_signal_no_direction_edge(self):
        conditions = _make_conditions()
        score = compute_entry_score(conditions, direction_signal="skip")
        assert "direction_edge" not in score.components

    def test_conflict_signal_no_direction_edge(self):
        conditions = _make_conditions()
        score = compute_entry_score(conditions, direction_signal="conflict")
        assert "direction_edge" not in score.components
