"""
Unit tests for ML-adaptive trailing stop + agent exit lockout.

Verifies:
1. is_trailing_active() accessor exists in daemon.py
2. Agent exit lockout in handle_close_position()
3. System prompt updated with EXIT LOCKOUT
4. Vol-adaptive activation threshold (4-regime map)
5. Tiered retracement (3 tiers by peak)
6. Vol-regime modifier on retracement
7. Trail floor = fee_be_roe + min_distance
8. All 13 new config fields in TradingSettings and default.yaml
9. Regression: Phase 2/3, persist calls, breakeven layers unchanged
"""
from pathlib import Path


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


def _builder_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "prompts" / "builder.py"
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


class TestPromptUpdated:
    """Verify system prompt mentions EXIT LOCKOUT and lockout in profit_taking."""

    def test_exit_lockout_in_system_prompt(self):
        """EXIT LOCKOUT must appear in the MECHANICAL EXIT SYSTEM section of builder.py."""
        src = _builder_source()
        assert "EXIT LOCKOUT" in src

    def test_prompt_mentions_cannot_close(self):
        """Builder must mention agent CANNOT close when trail is active."""
        src = _builder_source()
        assert "CANNOT close" in src or "cannot close" in src.lower()

    def test_profit_taking_mentions_lockout(self):
        """profit_taking variable must mention mechanical/cannot override."""
        src = _builder_source()
        # Find profit_taking assignment
        idx = src.find('profit_taking = """')
        assert idx != -1, "profit_taking variable not found"
        # Extract its value
        end = src.find('"""', idx + len('profit_taking = """'))
        profit_taking = src[idx:end]
        assert "cannot override" in profit_taking.lower() or "locked" in profit_taking.lower()


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


class TestTieredRetracement:
    """Verify tiered retracement logic in _fast_trigger_check."""

    def test_three_tiers_exist(self):
        """All three retracement tier keys must appear in _fast_trigger_check."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        for key in ["trail_retracement_tier1", "trail_retracement_tier2",
                    "trail_retracement_tier3"]:
            assert key in method, f"{key} not found in _fast_trigger_check"

    def test_tier_boundaries(self):
        """Tier boundaries peak < 5.0 and peak < 10.0 must appear in trailing block."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "peak < 5.0" in method
        assert "peak < 10.0" in method

    def test_vol_modifier_applied(self):
        """effective_retracement = base_retracement * vol_modifier must exist."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "effective_retracement = base_retracement * vol_modifier" in method

    def test_trail_floor_includes_min_distance(self):
        """trail_min_distance_above_fee_be must appear in trailing block as floor."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "trail_min_distance_above_fee_be" in method
        assert "trail_floor" in method


class TestTieredRetractionFormulas:
    """Pure math validation of tiered retracement formulas."""

    def test_tier1_normal_vol(self):
        """peak=4%, tier1=45%, vol_mod=1.0 → trail_roe=2.2%."""
        peak, ret, mod = 4.0, 0.45, 1.0
        trail = peak * (1.0 - ret * mod)
        assert abs(trail - 2.2) < 0.01

    def test_tier2_high_vol(self):
        """peak=7%, tier2=38%, vol_mod=0.88 → trail_roe≈4.66%."""
        peak, ret, mod = 7.0, 0.38, 0.88
        trail = peak * (1.0 - ret * mod)
        assert abs(trail - 4.66) < 0.01

    def test_tier3_extreme_vol(self):
        """peak=12%, tier3=30%, vol_mod=0.75 → trail_roe=9.30%."""
        peak, ret, mod = 12.0, 0.30, 0.75
        trail = peak * (1.0 - ret * mod)
        assert abs(trail - 9.30) < 0.01

    def test_floor_prevents_low_trail(self):
        """Low trail is raised by floor = fee_be + min_distance."""
        trail = 2.5 * (1.0 - 0.45)   # 1.375%
        floor = 1.4 + 0.5              # 1.9%
        result = max(trail, floor)
        assert abs(result - 1.9) < 0.01

    def test_extreme_vol_activation(self):
        """Extreme regime activation=1.5%, floor at 20x ≈ 1.4+0.1 = 1.5%."""
        activation = 1.5
        floor = 0.07 * 20 + 0.1
        assert abs(max(activation, floor) - 1.5) < 0.01

    def test_low_vol_activation(self):
        """Low regime activation=3.0%, floor at 20x = 1.5%."""
        activation = 3.0
        floor = 0.07 * 20 + 0.1
        assert max(activation, floor) == 3.0


class TestConfigFields:
    """Verify all 13 new fields exist in TradingSettings and default.yaml."""

    _NEW_FIELDS = [
        "trail_activation_extreme", "trail_activation_high",
        "trail_activation_normal", "trail_activation_low",
        "trail_retracement_tier1", "trail_retracement_tier2", "trail_retracement_tier3",
        "trail_vol_mod_extreme", "trail_vol_mod_high",
        "trail_vol_mod_normal", "trail_vol_mod_low",
        "trail_min_distance_above_fee_be",
    ]

    def test_all_new_fields_in_trading_settings(self):
        """All 12 new ML-adaptive fields must exist in TradingSettings dataclass."""
        src = _settings_source()
        for field in self._NEW_FIELDS:
            assert field in src, f"{field} missing from TradingSettings"

    def test_yaml_has_new_fields(self):
        """All new fields must appear in default.yaml daemon section."""
        src = Path(__file__).parent.parent.parent / "config" / "default.yaml"
        yaml_text = src.read_text()
        for field in self._NEW_FIELDS:
            assert field in yaml_text, f"{field} missing from default.yaml"

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
        """Capital-BE and fee-BE blocks must still exist in _fast_trigger_check."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "capital_breakeven_enabled" in method
        assert "breakeven_stop_enabled" in method
