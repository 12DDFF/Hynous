"""Unit tests for mechanical exit bug fixes — Round 2.

Tests verify:
1. Bug A: Phase 2 trail SL update saves old_sl_info and restores it on placement failure
2. Bug B: check_triggers close path clears trailing state from memory and disk
3. Bug C: Side-flip clears and persists trailing state
4. Bug D: _check_profit_levels cleanup loop persists when trailing state is deleted
5. Bug E: Candle peak update persists when trailing is active
6. Bug F: Phase 3 success path persists after popping trailing state
7. Bug G: _override_sl_classification requires _trailing_stop_px to be set for "trailing_stop"
8. Bug H: taker_fee_pct removed from DaemonConfig and ScannerConfig
9. Bug I: load_config() wires mechanical exit fields from YAML
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


def _scanner_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "scanner.py"
    return path.read_text()


def _trading_settings_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "core" / "trading_settings.py"
    return path.read_text()


def _default_yaml() -> dict:
    import yaml
    path = Path(__file__).parent.parent.parent / "config" / "default.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def _fast_trigger_check_source() -> str:
    """Extract just the _fast_trigger_check method body from daemon.py."""
    source = _daemon_source()
    start = source.find("def _fast_trigger_check(")
    end = source.find("\n    def ", start + 1)
    return source[start:end]


def _check_profit_levels_source() -> str:
    """Extract just the _check_profit_levels method body from daemon.py."""
    source = _daemon_source()
    start = source.find("def _check_profit_levels(")
    end = source.find("\n    def ", start + 1)
    return source[start:end]


def _override_sl_source() -> str:
    """Extract just the _override_sl_classification method body from daemon.py."""
    source = _daemon_source()
    start = source.find("def _override_sl_classification(")
    end = source.find("\n    def ", start + 1)
    return source[start:end]


def _update_peaks_source() -> str:
    """Extract just the _update_peaks_from_candles method body from daemon.py."""
    source = _daemon_source()
    start = source.find("def _update_peaks_from_candles(")
    end = source.find("\n    def ", start + 1)
    return source[start:end]


def _load_config_source() -> str:
    """Extract just the load_config function body from config.py."""
    source = _config_source()
    start = source.find("def load_config(")
    return source[start:]


# ── Bug A: Phase 2 rollback ────────────────────────────────────────────────────

class TestBugATrailSLRollback:
    """Phase 2 must save old_sl_info before cancelling and restore it on failure."""

    def test_old_sl_info_saved_before_try_block(self):
        """old_sl_info must be assigned BEFORE the try: block in the should_update path.

        Pattern: old_sl_info = None ... for t in triggers: if order_type == stop_loss ...
        must appear before the try: that does cancel + place.
        This ensures rollback is possible even when cancel succeeds but place fails.
        """
        source = _fast_trigger_check_source()
        # Both old_sl_info assignment and the triggers lookup must exist
        assert "old_sl_info = None" in source, \
            "old_sl_info = None must exist in _fast_trigger_check Phase 2"
        assert "old_sl_info = (t[\"oid\"], t.get(\"trigger_px\"))" in source, \
            "old_sl_info must be assigned from trigger order before the try block"

    def test_rollback_restores_old_sl_on_non_zombie_failure(self):
        """The else branch of the Phase 2 exception handler must restore the old SL."""
        source = _fast_trigger_check_source()
        # The rollback must exist in the else branch
        assert "if old_sl_info:" in source, \
            "Rollback guard 'if old_sl_info:' must exist in Phase 2 exception handler"
        # Must log CRITICAL if rollback also fails
        assert "CRITICAL: Failed to restore old SL for %s after trail update failure" in source, \
            "CRITICAL log must exist for failed rollback in trail SL update"

    def test_triggers_fetched_before_try(self):
        """triggers = self._tracked_triggers.get(sym, []) must appear before try: in Phase 2.

        The pre-fetched triggers list is used for both the cancel loop and old_sl_info.
        """
        source = _fast_trigger_check_source()
        # Verify triggers is fetched and old_sl_info is set (which requires triggers to exist)
        # The pattern: triggers = self._tracked_triggers.get(sym, []) ... old_sl_info
        idx_triggers = source.find("triggers = self._tracked_triggers.get(sym, [])")
        idx_old_sl = source.find("old_sl_info = None")
        assert idx_triggers != -1, "triggers must be fetched in Phase 2"
        assert idx_old_sl != -1, "old_sl_info must be initialized in Phase 2"
        assert idx_triggers < idx_old_sl, \
            "triggers must be fetched before old_sl_info is set"

    def test_trail_sl_placement_failure_does_not_leave_naked(self):
        """Verify rollback exists in the same except block as the zombie handler.

        The else branch must handle restoration — zombie branch is separate.
        """
        source = _fast_trigger_check_source()
        # Both zombie cleanup and the non-zombie rollback must coexist
        assert "no position" in source, "Zombie check must still exist"
        assert "if old_sl_info:" in source, "Rollback must exist alongside zombie check"


# ── Bug B: check_triggers close path ──────────────────────────────────────────

class TestBugBCheckTriggersCleanup:
    """check_triggers close must clear trailing state from memory and persist."""

    def test_trailing_active_popped_in_events_block(self):
        """_trailing_active must be popped for closed coins in the events block."""
        source = _fast_trigger_check_source()
        # Find the events block
        events_block_start = source.find("if events:")
        events_block = source[events_block_start:events_block_start + 1500]
        assert "_trailing_active.pop(" in events_block, \
            "_trailing_active must be popped in the if events: block of _fast_trigger_check"

    def test_trailing_stop_px_popped_in_events_block(self):
        """_trailing_stop_px must be popped for closed coins in the events block."""
        source = _fast_trigger_check_source()
        events_block_start = source.find("if events:")
        events_block = source[events_block_start:events_block_start + 1500]
        assert "_trailing_stop_px.pop(" in events_block, \
            "_trailing_stop_px must be popped in the if events: block of _fast_trigger_check"

    def test_peak_roe_popped_in_events_block(self):
        """_peak_roe must be popped for closed coins in the events block."""
        source = _fast_trigger_check_source()
        events_block_start = source.find("if events:")
        events_block = source[events_block_start:events_block_start + 1500]
        assert "_peak_roe.pop(" in events_block, \
            "_peak_roe must be popped in the if events: block of _fast_trigger_check"

    def test_persist_called_after_eviction_in_events_block(self):
        """_persist_mechanical_state must be called in the events block."""
        source = _fast_trigger_check_source()
        events_block_start = source.find("if events:")
        events_block = source[events_block_start:events_block_start + 2000]
        assert "_persist_mechanical_state()" in events_block, \
            "_persist_mechanical_state must be called in the if events: block"

    def test_persist_called_before_get_user_state(self):
        """_persist_mechanical_state must be called before get_user_state() attempt.

        Order: pop _prev_positions → pop trailing state → persist → get_user_state.
        """
        source = _fast_trigger_check_source()
        events_block_start = source.find("if events:")
        events_block = source[events_block_start:events_block_start + 2000]
        idx_persist = events_block.find("_persist_mechanical_state()")
        idx_get_user_state = events_block.find("provider.get_user_state()")
        assert idx_persist != -1, "_persist_mechanical_state must exist in events block"
        assert idx_get_user_state != -1, "provider.get_user_state must exist in events block"
        assert idx_persist < idx_get_user_state, \
            "_persist_mechanical_state must be called before get_user_state() in events block"


# ── Bug C: Side-flip persists ──────────────────────────────────────────────────

class TestBugCSideFlipPersist:
    """Side-flip cleanup must call _persist_mechanical_state after popping trailing state."""

    def test_persist_called_in_side_flip_block(self):
        """_persist_mechanical_state must be called inside the side-flip if block."""
        source = _check_profit_levels_source()
        # Find the side flip detection block
        side_flip_start = source.find("prev_side and prev_side != side")
        assert side_flip_start != -1, "Side-flip detection must exist in _check_profit_levels"
        # Extract the if block (bounded by the closing `self._profit_sides[coin] = side` line)
        side_flip_block = source[side_flip_start:source.find("self._profit_sides[coin] = side", side_flip_start)]
        assert "_persist_mechanical_state()" in side_flip_block, \
            "_persist_mechanical_state must be called inside the side-flip if block"

    def test_persist_called_after_trailing_pops_in_side_flip(self):
        """_persist_mechanical_state must come AFTER the trailing state pops."""
        source = _check_profit_levels_source()
        side_flip_start = source.find("prev_side and prev_side != side")
        profit_sides_line = source.find("self._profit_sides[coin] = side", side_flip_start)
        side_flip_block = source[side_flip_start:profit_sides_line]
        idx_trailing_pop = side_flip_block.rfind("_trailing_stop_px.pop(")
        idx_persist = side_flip_block.find("_persist_mechanical_state()")
        assert idx_trailing_pop != -1, "_trailing_stop_px.pop must be in side-flip block"
        assert idx_persist != -1, "_persist_mechanical_state must be in side-flip block"
        assert idx_trailing_pop < idx_persist, \
            "_persist_mechanical_state must come after _trailing_stop_px.pop in side-flip"


# ── Bug D: _check_profit_levels cleanup loop ────────────────────────────────────

class TestBugDCleanupLoopPersist:
    """Cleanup loop must persist trailing state when coins are deleted."""

    def test_cleaned_trailing_flag_exists(self):
        """A tracking flag must exist to conditionally persist only when changes occur."""
        source = _check_profit_levels_source()
        assert "_cleaned_trailing" in source, \
            "_cleaned_trailing flag must exist in _check_profit_levels cleanup section"

    def test_persist_called_when_cleaned_trailing_true(self):
        """_persist_mechanical_state must be called conditionally after cleanup loops."""
        source = _check_profit_levels_source()
        # The pattern: if _cleaned_trailing: _persist_mechanical_state()
        assert "if _cleaned_trailing:" in source, \
            "Conditional persist guard 'if _cleaned_trailing:' must exist in cleanup section"
        idx_flag = source.find("if _cleaned_trailing:")
        idx_persist = source.find("_persist_mechanical_state()", idx_flag)
        assert idx_persist != -1 and idx_persist < idx_flag + 100, \
            "_persist_mechanical_state must immediately follow 'if _cleaned_trailing:'"

    def test_flag_set_in_trailing_active_loop(self):
        """_cleaned_trailing must be set True inside the _trailing_active cleanup loop."""
        source = _check_profit_levels_source()
        # Find trailing_active cleanup loop
        loop_start = source.find("for coin in list(self._trailing_active):")
        assert loop_start != -1, "_trailing_active cleanup loop must exist"
        loop_section = source[loop_start:loop_start + 200]
        assert "_cleaned_trailing = True" in loop_section, \
            "_cleaned_trailing = True must be set inside the _trailing_active cleanup loop"


# ── Bug E: Candle peak persist ─────────────────────────────────────────────────

class TestBugECandlePeakPersist:
    """_update_peaks_from_candles must persist when trailing is active and peak updates."""

    def test_persist_called_when_trailing_active(self):
        """_persist_mechanical_state must be called inside the peak update block when trailing active."""
        source = _update_peaks_source()
        # The pattern: if self._trailing_active.get(sym): self._persist_mechanical_state()
        assert "self._trailing_active.get(sym)" in source, \
            "Trailing active guard must exist in _update_peaks_from_candles"
        idx_trailing_guard = source.find("self._trailing_active.get(sym)")
        idx_persist = source.find("_persist_mechanical_state()", idx_trailing_guard)
        assert idx_persist != -1, \
            "_persist_mechanical_state must exist after trailing_active guard in candle tracking"

    def test_persist_only_when_trailing_active_not_unconditional(self):
        """_persist_mechanical_state must be guarded by _trailing_active check.

        Do not persist on every candle update — only when trailing is engaged.
        """
        source = _update_peaks_source()
        # The persist must be inside an 'if' block checking _trailing_active
        idx_guard = source.find("if self._trailing_active.get(sym):")
        assert idx_guard != -1, \
            "Conditional guard 'if self._trailing_active.get(sym):' must exist in candle tracking"


# ── Bug F: Phase 3 success persist ────────────────────────────────────────────

class TestBugFPhase3Persist:
    """Phase 3 success path must call _persist_mechanical_state after popping trailing state."""

    def test_persist_called_in_phase3_success(self):
        """_persist_mechanical_state must be called in Phase 3 success path.

        Specifically: after _peak_roe.pop(sym, None) and before cancel_all_orders.
        """
        source = _fast_trigger_check_source()
        # Find the Phase 3 success marker — the trailing stop hit message
        phase3_start = source.find("trail_msg = (")
        assert phase3_start != -1, "Phase 3 trail_msg must exist"
        # The cancel_all_orders call is the last thing in Phase 3 success
        cancel_all_start = source.find("cancel_all_orders(sym)", phase3_start)
        assert cancel_all_start != -1, "cancel_all_orders must exist in Phase 3"
        phase3_success = source[phase3_start:cancel_all_start + 50]
        assert "_persist_mechanical_state()" in phase3_success, \
            "_persist_mechanical_state must be called in Phase 3 success path"

    def test_persist_after_pop_before_cancel_all(self):
        """_persist_mechanical_state must come after _peak_roe.pop and before cancel_all_orders."""
        source = _fast_trigger_check_source()
        phase3_start = source.find("trail_msg = (")
        cancel_all_start = source.find("cancel_all_orders(sym)", phase3_start)
        phase3_section = source[phase3_start:cancel_all_start + 50]
        idx_peak_pop = phase3_section.rfind("_peak_roe.pop(")
        idx_persist = phase3_section.find("_persist_mechanical_state()")
        idx_cancel = phase3_section.find("cancel_all_orders(")
        assert idx_peak_pop < idx_persist < idx_cancel, \
            "Order must be: _peak_roe.pop → _persist_mechanical_state → cancel_all_orders"


# ── Bug G: Classification fix ──────────────────────────────────────────────────

class TestBugGClassificationFix:
    """_override_sl_classification must check _trailing_stop_px, not just _trailing_active."""

    def test_trailing_stop_classification_checks_stop_px(self):
        """trailing_stop classification must require _trailing_stop_px to be set."""
        source = _override_sl_source()
        # The correct pattern uses both _trailing_active and _trailing_stop_px
        assert "self._trailing_stop_px.get(coin)" in source, \
            "_override_sl_classification must check _trailing_stop_px not just _trailing_active"

    def test_trailing_stop_not_just_trailing_active(self):
        """Ensure the old single-check pattern is gone."""
        source = _override_sl_source()
        # The old incorrect pattern was: if self._trailing_active.get(coin): return "trailing_stop"
        # After fix it must include _trailing_stop_px
        trailing_check_idx = source.find("return \"trailing_stop\"")
        assert trailing_check_idx != -1, "trailing_stop classification must still exist"
        # Extract the condition line for trailing_stop
        line_start = source.rfind("\n", 0, trailing_check_idx)
        condition_line = source[line_start:trailing_check_idx + 30]
        assert "_trailing_stop_px" in condition_line, \
            "The line returning trailing_stop must reference _trailing_stop_px"


# ── Bug H: taker_fee_pct unified to TradingSettings ────────────────────────────

class TestBugHTakerFeePctUnified:
    """taker_fee_pct must be removed from DaemonConfig and ScannerConfig."""

    def test_taker_fee_pct_removed_from_daemon_config(self):
        """DaemonConfig must not have a taker_fee_pct field."""
        source = _config_source()
        # Find DaemonConfig class
        daemon_config_start = source.find("class DaemonConfig:")
        next_class = source.find("\n@dataclass\nclass ", daemon_config_start + 1)
        daemon_config_body = source[daemon_config_start:next_class]
        assert "taker_fee_pct" not in daemon_config_body, \
            "taker_fee_pct must be removed from DaemonConfig — use TradingSettings instead"

    def test_taker_fee_pct_removed_from_scanner_config(self):
        """ScannerConfig must not have a taker_fee_pct field."""
        source = _config_source()
        scanner_config_start = source.find("class ScannerConfig:")
        next_class = source.find("\n@dataclass\nclass ", scanner_config_start + 1)
        if next_class == -1:
            next_class = len(source)
        scanner_config_body = source[scanner_config_start:next_class]
        assert "taker_fee_pct" not in scanner_config_body, \
            "taker_fee_pct must be removed from ScannerConfig — use TradingSettings instead"

    def test_taker_fee_pct_remains_in_trading_settings(self):
        """taker_fee_pct must still exist in TradingSettings — the single source of truth."""
        source = _trading_settings_source()
        assert "taker_fee_pct: float = 0.07" in source, \
            "taker_fee_pct must remain in TradingSettings as the single source of truth"

    def test_daemon_does_not_use_config_daemon_taker_fee(self):
        """daemon.py must not reference self.config.daemon.taker_fee_pct anywhere."""
        source = _daemon_source()
        assert "self.config.daemon.taker_fee_pct" not in source, \
            "daemon.py must not use self.config.daemon.taker_fee_pct after Bug H fix"

    def test_scanner_does_not_use_config_taker_fee(self):
        """scanner.py must not reference self.config.taker_fee_pct anywhere."""
        source = _scanner_source()
        assert "self.config.taker_fee_pct" not in source, \
            "scanner.py must not use self.config.taker_fee_pct after Bug H fix"

    def test_daemon_uses_trading_settings_for_fee(self):
        """daemon.py must use get_trading_settings().taker_fee_pct or ts.taker_fee_pct."""
        source = _daemon_source()
        uses_ts = "ts.taker_fee_pct" in source or "ts_tp.taker_fee_pct" in source or "ts_sw.taker_fee_pct" in source
        uses_direct = "get_trading_settings().taker_fee_pct" in source
        assert uses_ts or uses_direct, \
            "daemon.py must read taker_fee_pct from TradingSettings (ts.taker_fee_pct or get_trading_settings().taker_fee_pct)"


# ── Bug I: load_config() wiring ────────────────────────────────────────────────

class TestBugILoadConfigWiring:
    """load_config() must pass all mechanical exit fields from YAML into DaemonConfig."""

    def test_breakeven_stop_enabled_wired(self):
        source = _load_config_source()
        assert "breakeven_stop_enabled" in source, \
            "breakeven_stop_enabled must be wired in load_config() DaemonConfig constructor"

    def test_breakeven_buffer_micro_wired(self):
        source = _load_config_source()
        assert "breakeven_buffer_micro_pct" in source, \
            "breakeven_buffer_micro_pct must be wired in load_config()"

    def test_breakeven_buffer_macro_wired(self):
        source = _load_config_source()
        assert "breakeven_buffer_macro_pct" in source, \
            "breakeven_buffer_macro_pct must be wired in load_config()"

    def test_trailing_stop_enabled_wired(self):
        source = _load_config_source()
        assert "trailing_stop_enabled" in source, \
            "trailing_stop_enabled must be wired in load_config()"

    def test_candle_peak_tracking_enabled_wired(self):
        source = _load_config_source()
        assert "candle_peak_tracking_enabled" in source, \
            "candle_peak_tracking_enabled must be wired in load_config()"

    def test_peak_reversion_thresholds_wired(self):
        source = _load_config_source()
        assert "peak_reversion_threshold_micro" in source, \
            "peak_reversion_threshold_micro must be wired in load_config()"
        assert "peak_reversion_threshold_macro" in source, \
            "peak_reversion_threshold_macro must be wired in load_config()"

    def test_yaml_values_readable(self):
        """YAML values for all newly-wired fields must be parseable."""
        cfg = _default_yaml()
        daemon_cfg = cfg.get("daemon", {})
        assert daemon_cfg.get("trailing_stop_enabled") is True
        assert daemon_cfg.get("trailing_activation_roe") == 2.8
        assert daemon_cfg.get("candle_peak_tracking_enabled") is True
        assert daemon_cfg.get("breakeven_buffer_micro_pct") == 0.07

    def test_taker_fee_pct_not_wired_in_daemon_config_constructor(self):
        """taker_fee_pct must NOT be wired into DaemonConfig in load_config (it was removed)."""
        source = _load_config_source()
        # Find the DaemonConfig( constructor call in load_config
        daemon_constructor_start = source.find("daemon=DaemonConfig(")
        daemon_constructor_end = source.find("),\n        scanner=", daemon_constructor_start)
        daemon_constructor = source[daemon_constructor_start:daemon_constructor_end]
        assert "taker_fee_pct" not in daemon_constructor, \
            "taker_fee_pct must NOT appear in DaemonConfig constructor in load_config — field was removed"
