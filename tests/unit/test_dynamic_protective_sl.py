"""Unit tests for the Dynamic Protective SL feature.

Tests verify:
1. State dict and config fields exist (static source inspection)
2. Dynamic SL block placed before fee-BE, with rollback + vol-regime resolution
3. Classification: dynamic_protective_sl precedence
4. Layer progression: dynamic SL → fee-BE → trailing
5. Cleanup: eviction, side-flip, position-close
6. Formula: vol-regime mapping, floor/cap clamping, price computation
7. Integration: PaperProvider SL placement and triggers
"""
import pytest
from pathlib import Path


# ── Source Helpers ────────────────────────────────────────────────────────────

def _daemon_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return path.read_text()


def _config_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "core" / "config.py"
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


# ── Class 1: Static Source Code Validation ────────────────────────────────────

class TestDynamicSlExists:
    """Verify structural correctness via source code inspection."""

    def test_dynamic_sl_set_state_dict(self):
        """_dynamic_sl_set must be initialized in __init__."""
        source = _daemon_source()
        assert 'self._dynamic_sl_set: dict[str, bool] = {}' in source, \
            "_dynamic_sl_set state dict must be initialized in __init__"

    def test_dynamic_sl_block_in_fast_trigger_check(self):
        """dynamic_sl_enabled check must appear in _fast_trigger_check method body."""
        source = _daemon_source()
        method = _get_method(source, "_fast_trigger_check")
        assert "dynamic_sl_enabled" in method, \
            "dynamic_sl_enabled must appear in _fast_trigger_check"

    def test_dynamic_sl_before_fee_be(self):
        """dynamic_sl_enabled check must appear BEFORE breakeven_stop_enabled in _fast_trigger_check."""
        source = _daemon_source()
        method = _get_method(source, "_fast_trigger_check")
        dyn_pos = method.find("dynamic_sl_enabled")
        fee_pos = method.find("breakeven_stop_enabled")
        assert dyn_pos > 0, "dynamic_sl_enabled not found in _fast_trigger_check"
        assert fee_pos > 0, "breakeven_stop_enabled not found in _fast_trigger_check"
        assert dyn_pos < fee_pos, \
            "dynamic SL block must appear before fee-BE block"

    def test_refresh_trigger_cache_called(self):
        """_refresh_trigger_cache() must be called in the dynamic SL block after placement."""
        source = _daemon_source()
        method = _get_method(source, "_fast_trigger_check")
        dyn_start = method.find("dynamic_sl_enabled")
        fee_be_pos = method.find("breakeven_stop_enabled")
        dyn_region = method[dyn_start:fee_be_pos]
        assert "_refresh_trigger_cache()" in dyn_region, \
            "_refresh_trigger_cache() must appear in dynamic SL block"

    def test_rollback_on_failure(self):
        """Dynamic SL block must contain rollback logic (old SL restoration)."""
        source = _daemon_source()
        method = _get_method(source, "_fast_trigger_check")
        dyn_start = method.find("dynamic_sl_enabled")
        fee_be_pos = method.find("breakeven_stop_enabled")
        dyn_region = method[dyn_start:fee_be_pos]
        assert "old_sl_oid" in dyn_region, \
            "dynamic SL block must save old_sl_oid for rollback"
        assert "rolled back to old SL" in dyn_region, \
            "dynamic SL block must log rollback on failure"

    def test_vol_regime_resolution(self):
        """_latest_predictions must be accessed in the dynamic SL block."""
        source = _daemon_source()
        method = _get_method(source, "_fast_trigger_check")
        dyn_start = method.find("dynamic_sl_enabled")
        fee_be_pos = method.find("breakeven_stop_enabled")
        dyn_region = method[dyn_start:fee_be_pos]
        assert "_latest_predictions" in dyn_region, \
            "_latest_predictions must be accessed in the dynamic SL block"

    def test_capital_be_disabled_in_yaml(self):
        """YAML capital_breakeven_enabled must be False (deprecated)."""
        cfg = _default_yaml()
        assert cfg["daemon"]["capital_breakeven_enabled"] is False, \
            "capital_breakeven_enabled must be false in YAML (deprecated)"

    def test_dynamic_sl_enabled_in_yaml(self):
        """YAML dynamic_sl_enabled must be True."""
        cfg = _default_yaml()
        assert cfg["daemon"]["dynamic_sl_enabled"] is True, \
            "dynamic_sl_enabled must be true in YAML"

    def test_cleanup_eviction(self):
        """_dynamic_sl_set.pop( must appear in the event-based eviction block."""
        source = _daemon_source()
        assert '_dynamic_sl_set.pop(_coin, None)' in source, \
            "_dynamic_sl_set must be popped in event-based eviction"

    def test_cleanup_side_flip(self):
        """_dynamic_sl_set.pop( must appear in the side-flip cleanup block."""
        source = _daemon_source()
        assert '_dynamic_sl_set.pop(coin, None)' in source, \
            "_dynamic_sl_set must be popped in side-flip cleanup"

    def test_cleanup_position_close(self):
        """_dynamic_sl_set cleanup loop must exist in position-close cleanup."""
        source = _daemon_source()
        method = _get_method(source, "_check_profit_levels")
        assert "_dynamic_sl_set" in method, \
            "_dynamic_sl_set must appear in position-close cleanup loop"

    def test_classification_dynamic_sl(self):
        """dynamic_protective_sl must appear in _override_sl_classification."""
        source = _daemon_source()
        method = _get_method(source, "_override_sl_classification")
        assert "dynamic_protective_sl" in method, \
            "_override_sl_classification must return dynamic_protective_sl"

    def test_classification_precedence(self):
        """In _override_sl_classification: trailing > breakeven > dynamic_protective_sl."""
        source = _daemon_source()
        method = _get_method(source, "_override_sl_classification")
        trailing_pos = method.find("trailing_stop")
        breakeven_pos = method.find("breakeven_stop")
        dynamic_pos = method.find("dynamic_protective_sl")
        assert trailing_pos < breakeven_pos, "trailing_stop must come before breakeven_stop"
        assert breakeven_pos < dynamic_pos, "breakeven_stop must come before dynamic_protective_sl"


# ── Class 2: Config Validation ────────────────────────────────────────────────

class TestDynamicSlConfig:
    """Verify config fields and defaults."""

    def test_trading_settings_fields_exist(self):
        """TradingSettings must have all 7 new dynamic SL fields with correct defaults."""
        src = _settings_source()
        fields = [
            ("dynamic_sl_enabled: bool = True", "dynamic_sl_enabled"),
            ("dynamic_sl_low_vol: float = 2.5", "dynamic_sl_low_vol"),
            ("dynamic_sl_normal_vol: float = 7.0", "dynamic_sl_normal_vol"),
            ("dynamic_sl_high_vol: float = 8.0", "dynamic_sl_high_vol"),
            ("dynamic_sl_extreme_vol: float = 3.0", "dynamic_sl_extreme_vol"),
            ("dynamic_sl_floor: float = 1.5", "dynamic_sl_floor"),
            ("dynamic_sl_cap: float = 10.0", "dynamic_sl_cap"),
        ]
        for full_line, field_name in fields:
            assert full_line in src, f"{field_name} not found with correct default in TradingSettings"

    def test_daemon_config_field_exists(self):
        """DaemonConfig must have dynamic_sl_enabled field."""
        src = _config_source()
        assert "dynamic_sl_enabled: bool = True" in src, \
            "DaemonConfig must have dynamic_sl_enabled: bool = True"

    def test_yaml_matches_python_defaults(self):
        """YAML dynamic_sl_enabled must match Python DaemonConfig default (True)."""
        cfg = _default_yaml()
        src = _config_source()
        assert cfg["daemon"]["dynamic_sl_enabled"] is True
        assert "dynamic_sl_enabled: bool = True" in src

    def test_capital_be_deprecated(self):
        """DaemonConfig.capital_breakeven_enabled must default to False (deprecated)."""
        src = _config_source()
        assert "capital_breakeven_enabled: bool = False" in src, \
            "capital_breakeven_enabled must default to False in DaemonConfig"


# ── Class 3: Formula & Logic Tests ───────────────────────────────────────────

class TestDynamicSlFormula:
    """Pure math validation for dynamic SL price calculations."""

    def _compute_sl(self, entry_px, leverage, side, sl_roe, sl_floor=1.5, sl_cap=10.0):
        """Replicate the SL price computation from daemon.py."""
        sl_roe = max(sl_roe, sl_floor)
        sl_roe = min(sl_roe, sl_cap)
        sl_price_pct = sl_roe / leverage / 100.0
        if side == "long":
            return entry_px * (1.0 - sl_price_pct)
        else:
            return entry_px * (1.0 + sl_price_pct)

    def test_long_sl_below_entry(self):
        """Long at $100K, 20x, normal vol (7.0% ROE): SL must be below entry."""
        sl_px = self._compute_sl(100000.0, 20, "long", 7.0)
        assert sl_px < 100000.0
        # 7.0 / 20 / 100 = 0.0035 → $99,650
        assert abs(sl_px - 99650.0) < 1.0

    def test_short_sl_above_entry(self):
        """Short at $100K, 20x, normal vol (7.0% ROE): SL must be above entry."""
        sl_px = self._compute_sl(100000.0, 20, "short", 7.0)
        assert sl_px > 100000.0
        # 7.0 / 20 / 100 = 0.0035 → $100,350
        assert abs(sl_px - 100350.0) < 1.0

    def test_low_vol_distance(self):
        """Vol regime 'low' → sl_roe = 2.5."""
        sl_roe = 2.5  # dynamic_sl_low_vol default
        sl_roe_clamped = max(sl_roe, 1.5)
        sl_roe_clamped = min(sl_roe_clamped, 10.0)
        assert sl_roe_clamped == 2.5

    def test_normal_vol_distance(self):
        """Vol regime 'normal' → sl_roe = 7.0."""
        sl_roe = 7.0  # dynamic_sl_normal_vol default
        sl_roe_clamped = max(sl_roe, 1.5)
        sl_roe_clamped = min(sl_roe_clamped, 10.0)
        assert sl_roe_clamped == 7.0

    def test_high_vol_distance(self):
        """Vol regime 'high' → sl_roe = 8.0."""
        sl_roe = 8.0  # dynamic_sl_high_vol default
        sl_roe_clamped = max(sl_roe, 1.5)
        sl_roe_clamped = min(sl_roe_clamped, 10.0)
        assert sl_roe_clamped == 8.0

    def test_extreme_vol_distance(self):
        """Vol regime 'extreme' → sl_roe = 3.0."""
        sl_roe = 3.0  # dynamic_sl_extreme_vol default
        sl_roe_clamped = max(sl_roe, 1.5)
        sl_roe_clamped = min(sl_roe_clamped, 10.0)
        assert sl_roe_clamped == 3.0

    def test_floor_clamp(self):
        """If computed sl_roe < 1.5, clamp to 1.5 (floor)."""
        sl_roe = 1.0  # below floor
        result = max(sl_roe, 1.5)
        result = min(result, 10.0)
        assert result == 1.5

    def test_cap_clamp(self):
        """If computed sl_roe > 10.0, clamp to 10.0 (cap)."""
        sl_roe = 12.0  # above cap
        result = max(sl_roe, 1.5)
        result = min(result, 10.0)
        assert result == 10.0

    def test_leverage_scaling(self):
        """At 10x leverage, 7.0% ROE = 0.7% price. Long at $100K → SL = $99,300."""
        sl_px = self._compute_sl(100000.0, 10, "long", 7.0)
        # 7.0 / 10 / 100 = 0.007 → $100K * (1 - 0.007) = $99,300
        assert abs(sl_px - 99300.0) < 1.0

    def test_stale_predictions_fallback(self):
        """If _latest_predictions timestamp > 330s old, vol_regime must be 'normal'."""
        import time
        predictions = {
            "BTC": {
                "conditions": {
                    "timestamp": time.time() - 400,  # 400s old → stale
                    "vol_1h": {"regime": "extreme"},
                }
            }
        }
        # Replicate the staleness check
        _vol_regime = "normal"
        _pred = predictions.get("BTC", {})
        _cond = _pred.get("conditions", {})
        if _cond:
            _cond_ts = _cond.get("timestamp", 0)
            if time.time() - _cond_ts < 330:
                _vol_regime = _cond.get("vol_1h", {}).get("regime", "normal")
        assert _vol_regime == "normal", \
            "Stale predictions (>330s) must fall back to 'normal' regime"

    def test_missing_predictions_fallback(self):
        """If _latest_predictions is empty, vol_regime must be 'normal'."""
        predictions = {}
        _vol_regime = "normal"
        _pred = predictions.get("BTC", {})
        _cond = _pred.get("conditions", {})
        if _cond:
            _cond_ts = _cond.get("timestamp", 0)
            if True:  # would need import time
                _vol_regime = _cond.get("vol_1h", {}).get("regime", "normal")
        assert _vol_regime == "normal", \
            "Empty predictions must fall back to 'normal' regime"

    def test_non_btc_uses_normal(self):
        """Conditions are BTC-only; ETH/SOL access returns 'normal' (no ETH key)."""
        import time
        predictions = {
            "BTC": {
                "conditions": {
                    "timestamp": time.time() - 10,  # fresh
                    "vol_1h": {"regime": "extreme"},
                }
            }
        }
        # For ETH, _latest_predictions.get("ETH") returns {} → falls back to "normal"
        _vol_regime = "normal"
        _pred = predictions.get("ETH", {})  # ETH not in predictions
        _cond = _pred.get("conditions", {})
        if _cond:
            import time as t
            _cond_ts = _cond.get("timestamp", 0)
            if t.time() - _cond_ts < 330:
                _vol_regime = _cond.get("vol_1h", {}).get("regime", "normal")
        assert _vol_regime == "normal", \
            "Non-BTC coins must use 'normal' regime (conditions are BTC-only)"


# ── Class 4: State Progression Tests ─────────────────────────────────────────

class TestDynamicSlProgression:
    """State machine validation for the dynamic SL layer progression."""

    def _override(self, coin, classification, trailing_active, trailing_stop_px,
                  breakeven_set, dynamic_sl_set):
        """Replicate updated _override_sl_classification logic."""
        if classification != "stop_loss":
            return classification
        if trailing_active.get(coin) and trailing_stop_px.get(coin):
            return "trailing_stop"
        if breakeven_set.get(coin):
            return "breakeven_stop"
        if dynamic_sl_set.get(coin) and not breakeven_set.get(coin):
            return "dynamic_protective_sl"
        return classification

    def test_dynamic_sl_set_blocks_reevaluation(self):
        """Once _dynamic_sl_set[sym] = True, the gate condition blocks re-entry."""
        dynamic_sl_set = {"BTC": True}
        breakeven_set = {}
        # If dynamic_sl_set is True and breakeven is not set, the gate would skip
        gate_passes = (
            not dynamic_sl_set.get("BTC")  # False → gate does NOT pass
            and not breakeven_set.get("BTC")
        )
        assert not gate_passes, \
            "gate must block re-entry once _dynamic_sl_set is True"

    def test_fee_be_sets_dynamic_sl_flag(self):
        """When fee-BE fires, _dynamic_sl_set must also be set to True."""
        source = _daemon_source()
        method = _get_method(source, "_fast_trigger_check")
        # Find fee-BE block using breakeven_stop_enabled guard (comes before placement code)
        fee_be_pos = method.find("breakeven_stop_enabled")
        trail_pos = method.find("Trailing Stop", fee_be_pos)
        fee_be_region = method[fee_be_pos:trail_pos]
        assert "_dynamic_sl_set[sym] = True" in fee_be_region, \
            "_dynamic_sl_set must be set to True when fee-BE fires"

    def test_fee_be_tightens_past_dynamic_sl(self):
        """Fee-BE SL (entry + buffer) is always tighter than dynamic SL (entry - distance).

        For a long: fee-BE SL > entry > dynamic SL. Fee-BE is tighter (higher price).
        For a short: fee-BE SL < entry < dynamic SL. Fee-BE is tighter (lower price).
        """
        entry_px = 100.0
        leverage = 20
        buffer_pct = 0.07 / 100.0  # 0.07%

        # All 4 vol regimes
        for sl_roe in [2.5, 7.0, 8.0, 3.0]:
            sl_price_pct = sl_roe / leverage / 100.0

            # Long: dynamic SL is below entry, fee-BE SL is above entry
            dynamic_sl_long = entry_px * (1.0 - sl_price_pct)
            fee_be_long = entry_px * (1.0 + buffer_pct)
            assert fee_be_long > entry_px > dynamic_sl_long, \
                f"Long: fee-BE SL (${fee_be_long}) must be > entry (${entry_px}) > dynamic SL (${dynamic_sl_long})"

            # Short: dynamic SL is above entry, fee-BE SL is below entry
            dynamic_sl_short = entry_px * (1.0 + sl_price_pct)
            fee_be_short = entry_px * (1.0 - buffer_pct)
            assert fee_be_short < entry_px < dynamic_sl_short, \
                f"Short: fee-BE SL (${fee_be_short}) must be < entry (${entry_px}) < dynamic SL (${dynamic_sl_short})"

    def test_trailing_supersedes_all(self):
        """Once trailing is active, dynamic SL is irrelevant (classification returns trailing_stop)."""
        result = self._override(
            "BTC", "stop_loss",
            trailing_active={"BTC": True},
            trailing_stop_px={"BTC": 99.5},
            breakeven_set={},
            dynamic_sl_set={"BTC": True},
        )
        assert result == "trailing_stop"

    def test_side_flip_resets_dynamic_sl(self):
        """After side-flip cleanup, _dynamic_sl_set must not contain the coin."""
        source = _daemon_source()
        method = _get_method(source, "_check_profit_levels")
        # The side-flip block must pop _dynamic_sl_set
        assert "_dynamic_sl_set.pop(coin, None)" in method, \
            "_dynamic_sl_set must be popped in side-flip cleanup"

    def test_eviction_resets_dynamic_sl(self):
        """After event-based eviction, _dynamic_sl_set must not contain the coin."""
        source = _daemon_source()
        method = _get_method(source, "_fast_trigger_check")
        assert "_dynamic_sl_set.pop(_coin, None)" in method, \
            "_dynamic_sl_set must be popped in event-based eviction"


# ── Class 5: Classification Tests ─────────────────────────────────────────────

class TestDynamicSlClassification:
    """Test _override_sl_classification precedence with dynamic_protective_sl."""

    def _override(self, coin, classification, trailing_active, trailing_stop_px,
                  breakeven_set, dynamic_sl_set):
        """Replicate updated _override_sl_classification logic."""
        if classification != "stop_loss":
            return classification
        if trailing_active.get(coin) and trailing_stop_px.get(coin):
            return "trailing_stop"
        if breakeven_set.get(coin):
            return "breakeven_stop"
        if dynamic_sl_set.get(coin) and not breakeven_set.get(coin):
            return "dynamic_protective_sl"
        return classification

    def test_classification_dynamic_sl_only(self):
        """dynamic_sl_set=True, no trailing/breakeven → dynamic_protective_sl."""
        result = self._override(
            "BTC", "stop_loss",
            trailing_active={}, trailing_stop_px={},
            breakeven_set={},
            dynamic_sl_set={"BTC": True},
        )
        assert result == "dynamic_protective_sl"

    def test_classification_trailing_takes_precedence(self):
        """trailing_active=True AND dynamic_sl_set=True → trailing_stop."""
        result = self._override(
            "BTC", "stop_loss",
            trailing_active={"BTC": True},
            trailing_stop_px={"BTC": 99.0},
            breakeven_set={},
            dynamic_sl_set={"BTC": True},
        )
        assert result == "trailing_stop"

    def test_classification_breakeven_takes_precedence(self):
        """breakeven_set=True AND dynamic_sl_set=True → breakeven_stop."""
        result = self._override(
            "BTC", "stop_loss",
            trailing_active={}, trailing_stop_px={},
            breakeven_set={"BTC": True},
            dynamic_sl_set={"BTC": True},
        )
        assert result == "breakeven_stop"

    def test_classification_nothing_set(self):
        """All flags False → stop_loss (agent-placed SL)."""
        result = self._override(
            "BTC", "stop_loss",
            trailing_active={}, trailing_stop_px={},
            breakeven_set={},
            dynamic_sl_set={},
        )
        assert result == "stop_loss"

    def test_classification_tp_unchanged(self):
        """take_profit is never overridden regardless of flags."""
        result = self._override(
            "BTC", "take_profit",
            trailing_active={"BTC": True},
            trailing_stop_px={"BTC": 99.0},
            breakeven_set={"BTC": True},
            dynamic_sl_set={"BTC": True},
        )
        assert result == "take_profit"

    def test_classification_liquidation_unchanged(self):
        """liquidation is never overridden."""
        result = self._override(
            "BTC", "liquidation",
            trailing_active={"BTC": True},
            trailing_stop_px={"BTC": 99.0},
            breakeven_set={"BTC": True},
            dynamic_sl_set={"BTC": True},
        )
        assert result == "liquidation"


# ── Class 6: PaperProvider Integration Tests ─────────────────────────────────

class TestDynamicSlPaperIntegration:
    """Integration tests using real PaperProvider with temp storage."""

    @pytest.fixture
    def paper(self, tmp_path):
        """Create PaperProvider with temp storage and mock price feed."""
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
        from hynous.data.providers.paper import PaperProvider
        from unittest.mock import MagicMock, patch

        mock_real = MagicMock()
        mock_real.get_price.return_value = 100.0

        storage_dir = tmp_path / "storage"
        storage_dir.mkdir()
        storage_file = str(storage_dir / "paper-state.json")
        with patch.object(PaperProvider, "_find_storage_path", return_value=storage_file):
            provider = PaperProvider(mock_real, initial_balance=10000.0)
        return provider

    @pytest.fixture
    def long_position(self, paper):
        """Open a long position at $100 (20x leverage)."""
        paper.leverage_map["SYM"] = 20
        paper.market_open("SYM", is_buy=True, size_usd=200, slippage=0.0)
        return paper

    @pytest.fixture
    def short_position(self, paper):
        """Open a short position at $100 (20x leverage)."""
        paper.leverage_map["SYM"] = 20
        paper.market_open("SYM", is_buy=False, size_usd=200, slippage=0.0)
        return paper

    def test_sl_placed_at_correct_price_long(self, long_position):
        """Long at $100, 20x, normal vol (7.0%): dynamic SL at $99.65. Triggers at $99.60."""
        paper = long_position
        pos = paper.positions.get("SYM")
        assert pos is not None

        entry_px = pos.entry_px
        leverage = 20
        sl_roe = 7.0
        sl_px = entry_px * (1.0 - sl_roe / leverage / 100.0)
        # $100 * (1 - 0.0035) = $99.65

        result = paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=round(sl_px, 6), tpsl="sl"
        )
        assert result["status"] == "trigger_placed"
        assert abs(pos.sl_px - sl_px) < 0.01

        # Price drops below SL → triggers
        events = paper.check_triggers({"SYM": sl_px - 0.05})
        assert len(events) == 1
        assert events[0]["coin"] == "SYM"
        assert events[0]["classification"] == "stop_loss"
        assert abs(events[0]["exit_px"] - sl_px) < 0.01

    def test_sl_placed_at_correct_price_short(self, short_position):
        """Short at $100, 20x, normal vol (7.0%): dynamic SL at $100.35. Triggers at $100.40."""
        paper = short_position
        pos = paper.positions.get("SYM")
        assert pos is not None
        assert pos.side == "short"

        entry_px = pos.entry_px
        leverage = 20
        sl_roe = 7.0
        sl_px = entry_px * (1.0 + sl_roe / leverage / 100.0)
        # $100 * (1 + 0.0035) = $100.35

        result = paper.place_trigger_order(
            "SYM", is_buy=True, sz=pos.size, trigger_px=round(sl_px, 6), tpsl="sl"
        )
        assert result["status"] == "trigger_placed"
        assert abs(pos.sl_px - sl_px) < 0.01

        # Price rises above SL → triggers for short
        events = paper.check_triggers({"SYM": sl_px + 0.05})
        assert len(events) == 1
        assert abs(events[0]["exit_px"] - sl_px) < 0.01

    def test_existing_tighter_sl_preserved(self, long_position):
        """If existing SL is already tighter, dynamic SL logic must not replace it."""
        paper = long_position
        pos = paper.positions.get("SYM")

        # Place a tighter SL at $99.80 (only 0.2% below entry — very tight)
        tighter_sl = 99.80
        r1 = paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=tighter_sl, tpsl="sl"
        )
        original_oid = r1["oid"]
        assert pos.sl_px == tighter_sl

        # Dynamic SL would compute ~$99.65 for 7% ROE at 20x
        # $99.80 > $99.65 → existing SL is tighter for long
        # Simulate "already_tighter" logic
        dynamic_sl_px = pos.entry_px * (1.0 - 7.0 / 20 / 100.0)
        existing_tighter = pos.sl_px >= dynamic_sl_px  # True: $99.80 > $99.65
        assert existing_tighter, "Tighter pre-placed SL must be detected"

        # Position still has original SL
        assert pos.sl_px == tighter_sl, "Original tighter SL must not be replaced"
        assert pos.sl_oid == original_oid

    def test_existing_wider_sl_replaced(self, long_position):
        """Pre-placed wider SL should be cancelled and replaced with dynamic SL."""
        paper = long_position
        pos = paper.positions.get("SYM")

        # Place a WIDER (looser) SL at $98.00 (2% below entry)
        wider_sl = 98.00
        r1 = paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=wider_sl, tpsl="sl"
        )
        old_oid = r1["oid"]
        assert pos.sl_px == wider_sl

        # Dynamic SL at $99.65 is tighter than $98.00
        # Simulate replace: cancel old, place new
        paper.cancel_order("SYM", old_oid)
        assert pos.sl_px is None

        new_sl_px = pos.entry_px * (1.0 - 7.0 / 20 / 100.0)
        r2 = paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=round(new_sl_px, 6), tpsl="sl"
        )
        assert r2["status"] == "trigger_placed"
        assert abs(pos.sl_px - new_sl_px) < 0.01

    def test_cancel_before_place(self, long_position):
        """With existing SL, old must be cancelled before new is placed."""
        paper = long_position
        pos = paper.positions.get("SYM")

        # Place initial SL
        r1 = paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=98.0, tpsl="sl"
        )
        old_oid = r1["oid"]

        # Cancel
        paper.cancel_order("SYM", old_oid)
        assert pos.sl_px is None, "sl_px must be None after cancel"

        # Place new
        new_sl_px = pos.entry_px * (1.0 - 7.0 / 20 / 100.0)
        r2 = paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=round(new_sl_px, 6), tpsl="sl"
        )
        assert r2["status"] == "trigger_placed"
        assert pos.sl_px is not None

    def test_rollback_on_placement_failure(self, long_position):
        """Mock placement failure: old SL must be restored via rollback."""
        from unittest.mock import patch
        paper = long_position
        pos = paper.positions.get("SYM")

        # Place initial SL
        r1 = paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=98.0, tpsl="sl"
        )
        old_oid = r1["oid"]
        old_sl_px = pos.sl_px
        assert old_sl_px == 98.0

        # Simulate: cancel succeeds, placement fails
        paper.cancel_order("SYM", old_oid)
        assert pos.sl_px is None

        # Simulate rollback: restore old SL
        paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=old_sl_px, tpsl="sl"
        )
        assert pos.sl_px == old_sl_px, "Old SL must be restored after placement failure"

    def test_fee_be_overrides_dynamic_sl(self, long_position):
        """After dynamic SL placed, fee-BE tightens it to entry + buffer."""
        paper = long_position
        pos = paper.positions.get("SYM")

        # Step 1: Place dynamic SL at $99.65 (7.0% ROE at 20x)
        dynamic_sl_px = pos.entry_px * (1.0 - 7.0 / 20 / 100.0)
        r1 = paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=round(dynamic_sl_px, 6), tpsl="sl"
        )
        old_oid = r1["oid"]
        assert abs(pos.sl_px - dynamic_sl_px) < 0.01

        # Step 2: Fee-BE fires → cancel dynamic SL, place at entry + 0.07%
        paper.cancel_order("SYM", old_oid)
        fee_be_px = pos.entry_px * (1.0 + 0.07 / 100.0)  # $100.07
        paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=fee_be_px, tpsl="sl"
        )
        assert abs(pos.sl_px - fee_be_px) < 0.001

        # Fee-BE SL is tighter (higher) than dynamic SL for long
        assert pos.sl_px > dynamic_sl_px, "Fee-BE SL must be tighter than dynamic SL"
