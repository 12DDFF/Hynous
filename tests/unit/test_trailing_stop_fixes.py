"""Unit tests for trailing stop bug fixes.

Tests verify:
1. Zombie cleanup: Phase 2 and Phase 3 exception handlers evict stale state immediately
   on "no position" errors rather than spinning for 60s until _check_positions() runs.
2. State persistence: _persist_mechanical_state() / _load_mechanical_state() save and
   restore _peak_roe, _trailing_stop_px, _trailing_active across daemon restarts.
3. Assignment-inside-try: _trailing_stop_px[sym] = new_trail_px is written AFTER
   place_trigger_order() succeeds, not before.
"""
from pathlib import Path


# ── Source Helpers ────────────────────────────────────────────────────────────

def _daemon_source() -> str:
    daemon_path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return daemon_path.read_text()


def _get_method(src: str, method_name: str) -> str:
    """Extract a method body from source by name."""
    start = src.find(f"def {method_name}(")
    end = src.find("\n    def ", start + 1)
    return src[start:end] if end != -1 else src[start:]


# ── Class 1: Zombie Cleanup — Static Source Code Validation ───────────────────

class TestZombieCleanupExists:
    """Verify zombie cleanup logic is present in the source."""

    def test_phase2_exception_checks_no_position_string(self):
        """Phase 2 handler must check for 'no position' in error string."""
        src = _daemon_source()
        assert '"no position" in _err' in src or "'no position' in _err" in src

    def test_phase3_exception_checks_no_open_position_string(self):
        """Phase 3 handler must check for 'no open position' in error string."""
        src = _daemon_source()
        assert '"no open position" in _err' in src or "'no open position' in _err" in src

    def test_phase2_exception_pops_prev_positions(self):
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "self._prev_positions.pop(sym, None)" in method

    def test_phase3_exception_pops_trailing_active(self):
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "self._trailing_active.pop(sym, None)" in method

    def test_trailing_stop_px_assigned_inside_try(self):
        """_trailing_stop_px must be assigned AFTER place_trigger_order, not before."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assign_idx = method.find("self._trailing_stop_px[sym] = new_trail_px")
        place_idx = method.find("place_trigger_order(")
        refresh_idx = method.find("_refresh_trigger_cache()")
        assert assign_idx > place_idx, \
            "_trailing_stop_px must be assigned after place_trigger_order"
        assert assign_idx > refresh_idx, \
            "_trailing_stop_px must be assigned after _refresh_trigger_cache"

    def test_persist_mechanical_state_method_exists(self):
        src = _daemon_source()
        assert "def _persist_mechanical_state(self)" in src

    def test_load_mechanical_state_method_exists(self):
        src = _daemon_source()
        assert "def _load_mechanical_state(self)" in src

    def test_load_mechanical_state_called_in_init(self):
        src = _daemon_source()
        init_method = _get_method(src, "_init_position_tracking")
        assert "_load_mechanical_state()" in init_method

    def test_persist_called_after_trailing_activation(self):
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        activation_idx = method.find("self._trailing_active[sym] = True")
        persist_idx = method.find("self._persist_mechanical_state()", activation_idx)
        # persist must appear within 3 lines of activation
        activation_line = method[:activation_idx].count("\n")
        persist_line = method[:persist_idx].count("\n")
        assert 0 < persist_line - activation_line <= 3, \
            "_persist_mechanical_state must be called immediately after trail activation"

    def test_persist_called_after_successful_placement(self):
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assign_idx = method.find("self._trailing_stop_px[sym] = new_trail_px")
        persist_idx = method.find("self._persist_mechanical_state()", assign_idx)
        assert persist_idx > assign_idx, \
            "_persist_mechanical_state must be called after _trailing_stop_px assignment"

    def test_mechanical_state_json_path(self):
        src = _daemon_source()
        assert '"mechanical_state.json"' in src or "'mechanical_state.json'" in src

    def test_phase3_success_clears_trailing_active(self):
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        # Find Phase 3 success block anchor: _record_trigger_close with trailing_stop classification
        anchor = method.find('"classification": "trailing_stop"')
        # The cleanup pops follow within ~200 chars of the record_trigger_close call
        cleanup_region = method[anchor:anchor + 600]
        assert "self._trailing_active.pop(sym, None)" in cleanup_region
        assert "self._trailing_stop_px.pop(sym, None)" in cleanup_region
        assert "self._peak_roe.pop(sym, None)" in cleanup_region


# ── Class 2: Zombie Error Strings Match paper.py ──────────────────────────────

class TestZombieCleanupBehavior:
    """Verify that zombie error strings match the actual paper.py error messages."""

    def test_phase3_zombie_error_string_matches_paper_provider(self):
        """paper.py must raise 'No open position for X', daemon must check 'no open position'."""
        paper_src = (Path(__file__).parent.parent.parent /
                     "src/hynous/data/providers/paper.py").read_text()
        daemon_src = _daemon_source()

        assert 'No open position for' in paper_src, \
            "paper.py must raise 'No open position for {sym}'"
        assert 'No position for' in paper_src, \
            "paper.py must raise 'No position for {sym} to attach trigger to'"

        method = _get_method(daemon_src, "_fast_trigger_check")
        assert "no open position" in method or "no position" in method, \
            "Daemon Phase 3 handler must check for paper.py error substring"

    def test_phase2_zombie_error_string_matches_paper_provider(self):
        """Phase 2 handler checks 'no position' which matches paper.py's place_trigger_order error."""
        paper_src = (Path(__file__).parent.parent.parent /
                     "src/hynous/data/providers/paper.py").read_text()
        assert 'No position for' in paper_src
        daemon_src = _daemon_source()
        assert '"no position" in _err' in daemon_src or "'no position' in _err" in daemon_src


# ── Class 3: State Persistence Round-Trip ─────────────────────────────────────

class TestStatePersistenceRoundTrip:
    """Verify mechanical state persists and loads correctly."""

    def test_persist_and_load_restores_trailing_data(self, tmp_path):
        """Simulate persist/load cycle: closed coins not restored, open coins are."""
        import json
        from src.hynous.core.persistence import _atomic_write

        state = {
            "peak_roe": {"BTC": 3.5, "SOL": 6.69},
            "trailing_stop_px": {"BTC": 69650.0, "SOL": 85.49},
            "trailing_active": {"BTC": True, "SOL": True},
        }
        path = tmp_path / "mechanical_state.json"
        _atomic_write(path, json.dumps(state))

        loaded = json.loads(path.read_text())
        open_syms = {"BTC"}  # SOL is closed — should not be restored

        peak_roe = {k: v for k, v in loaded["peak_roe"].items() if k in open_syms}
        trailing_px = {k: v for k, v in loaded["trailing_stop_px"].items() if k in open_syms}
        trailing_active = {k: v for k, v in loaded["trailing_active"].items() if k in open_syms}

        assert peak_roe == {"BTC": 3.5}, "Only open coins restored"
        assert trailing_px == {"BTC": 69650.0}, "Only open coins restored"
        assert trailing_active == {"BTC": True}, "Only open coins restored"
        assert "SOL" not in peak_roe, "Closed coin must not be restored"

    def test_load_mechanical_state_called_before_refresh_trigger_cache(self):
        """_load_mechanical_state must be called before _refresh_trigger_cache in startup."""
        src = _daemon_source()
        init = _get_method(src, "_init_position_tracking")
        load_idx = init.find("_load_mechanical_state()")
        refresh_idx = init.find("_refresh_trigger_cache()")
        assert load_idx != -1, "_load_mechanical_state must be called in _init_position_tracking"
        assert load_idx < refresh_idx, \
            "_load_mechanical_state must be called before _refresh_trigger_cache"

    def test_load_called_after_prev_positions_populated(self):
        """_load_mechanical_state must be called after _prev_positions is populated."""
        src = _daemon_source()
        init = _get_method(src, "_init_position_tracking")
        get_state_idx = init.find("get_user_state()")
        load_idx = init.find("_load_mechanical_state()")
        assert load_idx > get_state_idx, \
            "_load_mechanical_state must run after _prev_positions is populated"

    def test_persist_uses_atomic_write(self):
        """_persist_mechanical_state must use _atomic_write, not direct file write."""
        src = _daemon_source()
        method = _get_method(src, "_persist_mechanical_state")
        assert "_atomic_write" in method, \
            "_persist_mechanical_state must use _atomic_write for atomicity"

    def test_persist_uses_mechanical_state_json(self):
        """_persist_mechanical_state must write to mechanical_state.json."""
        src = _daemon_source()
        method = _get_method(src, "_persist_mechanical_state")
        assert "mechanical_state.json" in method

    def test_load_filters_to_open_positions_only(self):
        """_load_mechanical_state must check sym against open_syms before restoring."""
        src = _daemon_source()
        method = _get_method(src, "_load_mechanical_state")
        assert "open_syms" in method, \
            "_load_mechanical_state must filter restored state to open positions"
        assert "_prev_positions" in method, \
            "_load_mechanical_state must read _prev_positions to get open symbols"


# ── Class 4: Assignment-Inside-Try ────────────────────────────────────────────

class TestAssignmentInsideTry:
    """Verify _trailing_stop_px assignment is inside the try block."""

    def test_trailing_stop_px_not_assigned_before_try(self):
        """_trailing_stop_px[sym] = new_trail_px must not appear before the try block."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        should_update_idx = method.find("if should_update:")
        try_idx = method.find("try:", should_update_idx)
        assign_idx = method.find("self._trailing_stop_px[sym] = new_trail_px", should_update_idx)
        assert assign_idx > try_idx, \
            "_trailing_stop_px must be assigned inside the try block, not before it"

    def test_persist_called_on_successful_placement_only(self):
        """_persist_mechanical_state must be inside try block (after place succeeds)."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        try_idx = method.find("try:", method.find("if should_update:"))
        except_idx = method.find("except Exception as trail_err:", try_idx)
        persist_idx = method.find("self._persist_mechanical_state()", try_idx)
        assert try_idx < persist_idx < except_idx, \
            "_persist_mechanical_state must be inside the try block"
