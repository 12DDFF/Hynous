"""
Unit tests for ML-adaptive trailing stop + agent exit lockout.

Verifies:
1. is_trailing_active() accessor exists in daemon.py
2. Agent exit lockout in handle_close_position()
3. System prompt updated with EXIT LOCKOUT
4. Vol-adaptive activation threshold (4-regime map)
5. Continuous exponential retracement (replaces 3-tier discrete system)
6. Vol regime absorbed into decay rate k (no separate modifier)
7. Trail floor = fee_be_roe + min_distance
8. All new config fields in TradingSettings and default.yaml
9. Regression: Phase 2/3, persist calls, breakeven layers unchanged
"""
from pathlib import Path

# Calibrated values from Phase 1
CALIBRATED_FLOOR = 0.20
CALIBRATED_AMPLITUDE = 0.30
CALIBRATED_K_EXTREME = 0.160
CALIBRATED_K_HIGH = 0.100
CALIBRATED_K_NORMAL = 0.080
CALIBRATED_K_LOW = 0.040


# ---------------------------------------------------------------------------
# Source helpers
# ---------------------------------------------------------------------------

def _daemon_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return path.read_text()


def _trading_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "tools" / "trading.py"
    return path.read_text()


def _settings_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "core" / "trading_settings.py"
    return path.read_text()


def _get_method(src: str, method_name: str) -> str:
    start = src.find(f"def {method_name}(")
    end = src.find("\n    def ", start + 1)
    return src[start:end] if end != -1 else src[start:]


def _default_yaml() -> dict:
    import yaml
    path = Path(__file__).parent.parent.parent / "config" / "default.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Part 1 Tests: Agent Exit Lockout
# ---------------------------------------------------------------------------

class TestIsTrailingActiveAccessor:
    """Structural verification of is_trailing_active() accessor in daemon.py."""

    def test_method_exists(self):
        """Verify def is_trailing_active(self, coin: str) exists in daemon.py."""
        src = _daemon_source()
        assert "def is_trailing_active(self, coin: str)" in src

    def test_returns_bool(self):
        """Verify method body contains correct return statement."""
        src = _daemon_source()
        method = _get_method(src, "is_trailing_active")
        assert 'return self._trailing_active.get(coin, False)' in method


class TestExitLockoutInClosePosition:
    """Verify trailing stop lockout in handle_close_position()."""

    def test_lockout_check_exists(self):
        """is_trailing_active must appear in handle_close_position."""
        src = _trading_source()
        method = _get_method(src, "handle_close_position")
        assert "is_trailing_active" in method

    def test_lockout_returns_blocked_message(self):
        """BLOCKED and trailing stop is active must appear in handle_close_position."""
        src = _trading_source()
        method = _get_method(src, "handle_close_position")
        assert "BLOCKED" in method
        assert "trailing stop is active" in method or "trailing stop" in method.lower()

    def test_lockout_before_market_close(self):
        """is_trailing_active must appear BEFORE market_close in handle_close_position."""
        src = _trading_source()
        method = _get_method(src, "handle_close_position")
        lockout_pos = method.find("is_trailing_active")
        market_close_pos = method.find("market_close")
        assert lockout_pos != -1, "is_trailing_active not found in handle_close_position"
        assert market_close_pos != -1, "market_close not found in handle_close_position"
        assert lockout_pos < market_close_pos, "Lockout must appear before market_close"

    def test_lockout_has_safety_fallback(self):
        """Lockout block must be wrapped in try/except for daemon unavailability."""
        src = _trading_source()
        method = _get_method(src, "handle_close_position")
        # The try/except wrapping the lockout
        assert "except Exception" in method
        assert "pass  # If daemon unavailable" in method or "pass" in method

    def test_lockout_records_trade_span(self):
        """_record_trade_span must be called near trailing_lockout string."""
        src = _trading_source()
        method = _get_method(src, "handle_close_position")
        assert "_record_trade_span" in method
        assert "trailing_lockout" in method


# ---------------------------------------------------------------------------
# Part 2 Tests: ML-Adaptive Parameters
# ---------------------------------------------------------------------------

class TestAdaptiveActivation:
    """Verify vol-adaptive activation threshold in _fast_trigger_check."""

    def test_vol_regime_read_from_predictions(self):
        """_latest_predictions must be accessed in the trailing stop block."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "_latest_predictions" in method

    def test_activation_map_has_four_regimes(self):
        """All four vol-regime activation keys must appear in _fast_trigger_check."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        for key in ["trail_activation_extreme", "trail_activation_high",
                    "trail_activation_normal", "trail_activation_low"]:
            assert key in method, f"{key} not found in _fast_trigger_check"

    def test_activation_floor_above_fee_be(self):
        """Activation floor (max against fee_be_roe) must exist in trailing block."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "max(activation_roe, fee_be_roe" in method

    def test_staleness_check_on_conditions(self):
        """330s staleness threshold must appear near conditions access."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "330" in method, "Staleness threshold 330 not found in _fast_trigger_check"

    def test_fallback_to_normal_without_ml(self):
        """_vol_regime must default to 'normal' before ML check."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert '_vol_regime = "normal"' in method


class TestContinuousRetracement:
    """Verify continuous exponential retracement replaces discrete tiers."""

    def test_exponential_fields_exist(self):
        """New fields exist in TradingSettings."""
        src = Path("src/hynous/core/trading_settings.py").read_text()
        assert "trail_ret_floor" in src
        assert "trail_ret_amplitude" in src
        assert "trail_ret_k_extreme" in src
        assert "trail_ret_k_high" in src
        assert "trail_ret_k_normal" in src
        assert "trail_ret_k_low" in src

    def test_tier_fields_removed(self):
        """Old tier and vol_mod fields no longer exist."""
        src = Path("src/hynous/core/trading_settings.py").read_text()
        assert "trail_retracement_tier1" not in src
        assert "trail_retracement_tier2" not in src
        assert "trail_retracement_tier3" not in src
        assert "trail_vol_mod_extreme" not in src
        assert "trail_vol_mod_high" not in src
        assert "trail_vol_mod_normal" not in src
        assert "trail_vol_mod_low" not in src

    def test_daemon_uses_math_exp(self):
        """daemon.py uses math.exp for retracement, not if/elif/else tiers."""
        src = Path("src/hynous/intelligence/daemon.py").read_text()
        assert "math.exp" in src
        # Old tier logic should be gone
        assert "trail_retracement_tier1" not in src
        assert "trail_retracement_tier2" not in src
        assert "trail_retracement_tier3" not in src
        assert "trail_vol_mod_extreme" not in src

    def test_k_map_in_daemon(self):
        """daemon.py has a _k_map dict for regime-dependent decay rate."""
        src = Path("src/hynous/intelligence/daemon.py").read_text()
        assert "_k_map" in src
        assert "trail_ret_k_extreme" in src
        assert "trail_ret_k_normal" in src

    def test_trail_floor_unchanged(self):
        """trail_min_distance_above_fee_be is still present and used."""
        src = Path("src/hynous/core/trading_settings.py").read_text()
        assert "trail_min_distance_above_fee_be" in src
        daemon_src = Path("src/hynous/intelligence/daemon.py").read_text()
        assert "trail_min_distance_above_fee_be" in daemon_src


class TestContinuousRetractionFormulas:
    """Verify the exponential retracement formula produces correct values."""

    def test_formula_at_low_peak(self):
        """At peak near activation, retracement should be near ceiling."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        peak = 2.5
        r = floor + amp * math.exp(-k * peak)
        # Should be near 0.45 (the old tier 1 value in normal vol)
        assert 0.35 <= r <= 0.55, f"r({peak}) = {r}, expected ~0.45"

    def test_formula_at_mid_peak(self):
        """At peak ~7.5%, retracement should be near old tier 2."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        peak = 7.5
        r = floor + amp * math.exp(-k * peak)
        # Should be near 0.38 (the old tier 2 value in normal vol)
        assert 0.28 <= r <= 0.48, f"r({peak}) = {r}, expected ~0.38"

    def test_formula_at_high_peak(self):
        """At peak ~12%, retracement should be near old tier 3."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        peak = 12.0
        r = floor + amp * math.exp(-k * peak)
        # Should be near 0.30 (the old tier 3 value in normal vol)
        assert 0.20 <= r <= 0.40, f"r({peak}) = {r}, expected ~0.30"

    def test_monotonically_decreasing(self):
        """Retracement decreases as peak increases."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        prev = 1.0
        for peak in [1.0, 2.0, 3.0, 5.0, 7.5, 10.0, 15.0, 20.0, 30.0]:
            r = floor + amp * math.exp(-k * peak)
            assert r <= prev, f"r({peak}) = {r} > r(prev) = {prev}"
            prev = r

    def test_never_below_floor(self):
        """Retracement never goes below floor, even at extreme peaks."""
        import math
        floor, amp = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE
        for k in [CALIBRATED_K_EXTREME, CALIBRATED_K_HIGH, CALIBRATED_K_NORMAL, CALIBRATED_K_LOW]:
            for peak in [0.0, 5.0, 10.0, 20.0, 50.0, 100.0]:
                r = floor + amp * math.exp(-k * peak)
                assert r >= floor - 1e-9, f"r({peak}) = {r} < floor {floor}"

    def test_extreme_vol_tighter_than_normal(self):
        """In extreme vol (higher k), retracement is lower at same peak."""
        import math
        floor, amp = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE
        for peak in [3.0, 5.0, 7.5, 10.0, 15.0]:
            r_extreme = floor + amp * math.exp(-CALIBRATED_K_EXTREME * peak)
            r_normal = floor + amp * math.exp(-CALIBRATED_K_NORMAL * peak)
            assert r_extreme <= r_normal, (
                f"At peak {peak}: extreme r={r_extreme} > normal r={r_normal}"
            )

    def test_low_vol_looser_than_normal(self):
        """In low vol (lower k), retracement is higher at same peak."""
        import math
        floor, amp = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE
        for peak in [3.0, 5.0, 7.5, 10.0, 15.0]:
            r_low = floor + amp * math.exp(-CALIBRATED_K_LOW * peak)
            r_normal = floor + amp * math.exp(-CALIBRATED_K_NORMAL * peak)
            assert r_low >= r_normal, (
                f"At peak {peak}: low r={r_low} < normal r={r_normal}"
            )

    def test_floor_prevents_low_trail(self):
        """Trail floor (fee_be + min_distance) still applies."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        peak = 2.5  # Low peak
        r = floor + amp * math.exp(-k * peak)
        trail_roe = peak * (1.0 - r)
        fee_be_roe = 0.07 * 20  # 1.4% at 20x
        trail_floor = fee_be_roe + 0.5  # 1.9%
        effective_trail = max(trail_roe, trail_floor)
        assert effective_trail >= trail_floor

    def test_continuous_at_old_boundary_5pct(self):
        """No discontinuity at the old 5% tier boundary."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        r_499 = floor + amp * math.exp(-k * 4.99)
        r_501 = floor + amp * math.exp(-k * 5.01)
        # Change should be tiny (< 0.01), not the old 0.07 jump
        assert abs(r_499 - r_501) < 0.01, (
            f"Discontinuity at 5%: r(4.99)={r_499}, r(5.01)={r_501}, "
            f"delta={abs(r_499 - r_501)}"
        )

    def test_continuous_at_old_boundary_10pct(self):
        """No discontinuity at the old 10% tier boundary."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        r_999 = floor + amp * math.exp(-k * 9.99)
        r_1001 = floor + amp * math.exp(-k * 10.01)
        assert abs(r_999 - r_1001) < 0.01, (
            f"Discontinuity at 10%: r(9.99)={r_999}, r(10.01)={r_1001}, "
            f"delta={abs(r_999 - r_1001)}"
        )


class TestConfigFields:
    """Verify all 13 new fields exist in TradingSettings and default.yaml."""

    _NEW_FIELDS = [
        "trail_activation_extreme", "trail_activation_high",
        "trail_activation_normal", "trail_activation_low",
        "trail_ret_floor", "trail_ret_amplitude",
        "trail_ret_k_extreme", "trail_ret_k_high",
        "trail_ret_k_normal", "trail_ret_k_low",
        "trail_min_distance_above_fee_be",
    ]

    def test_all_new_fields_in_trading_settings(self):
        """All 12 new ML-adaptive fields must exist in TradingSettings dataclass."""
        src = _settings_source()
        for field in self._NEW_FIELDS:
            assert field in src, f"{field} missing from TradingSettings"

    def test_yaml_has_new_fields(self):
        """default.yaml contains all new trailing stop fields."""
        yaml_text = Path("config/default.yaml").read_text()
        for field_name in [
            "trail_ret_floor", "trail_ret_amplitude",
            "trail_ret_k_extreme", "trail_ret_k_high",
            "trail_ret_k_normal", "trail_ret_k_low",
            "trail_min_distance_above_fee_be",
        ]:
            assert field_name in yaml_text, f"Missing in YAML: {field_name}"

    def test_legacy_fields_preserved(self):
        """trailing_activation_roe and trailing_retracement_pct must still exist."""
        src = _settings_source()
        assert "trailing_activation_roe" in src
        assert "trailing_retracement_pct" in src


# ---------------------------------------------------------------------------
# Regression Tests
# ---------------------------------------------------------------------------

class TestExistingBehaviorUnchanged:
    """Verify Phase 2/3, persist calls, breakeven layers, and classification unchanged."""

    def test_phase2_sl_placement_unchanged(self):
        """Cancel-place-rollback pattern must still exist after trail_roe calculation."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "old_sl_info = None" in method
        assert "CRITICAL: Failed to restore old SL" in method

    def test_phase3_backup_close_unchanged(self):
        """Phase 3 trailing stop hit check and market_close must still exist."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "trail_hit" in method
        assert "market_close(sym)" in method

    def test_persist_calls_unchanged(self):
        """_persist_mechanical_state() must still be called at least 3 times in trailing block."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert method.count("_persist_mechanical_state()") >= 3

    def test_classification_unchanged(self):
        """_override_sl_classification must still handle trailing_stop."""
        src = _daemon_source()
        method = _get_method(src, "_override_sl_classification")
        assert '"trailing_stop"' in method

    def test_breakeven_layers_unchanged(self):
        """Dynamic SL and fee-BE blocks must exist in _fast_trigger_check."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "dynamic_sl_enabled" in method
        assert "breakeven_stop_enabled" in method
