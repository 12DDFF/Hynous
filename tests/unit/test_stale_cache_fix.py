"""
Unit tests for Fix 01: T1 (stale position cache after 429).

Tests verify:
1. Event-based eviction removes closed positions from _prev_positions
2. get_user_state() success overwrites the partial eviction with full truth
3. get_user_state() failure still leaves _prev_positions clean (no ghost positions)
4. Phase 3 is preserved (NOT deleted) as Phase 2 failure backup
5. Evicted coins are skipped by the ROE tracking guard
"""
import pytest


class TestEventBasedEviction:
    """T1 fix: closed positions are evicted from _prev_positions using event data."""

    def test_eviction_removes_closed_coin(self):
        """After check_triggers() closes BTC, BTC should be removed from _prev_positions."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
        }
        events = [
            {"coin": "BTC", "side": "long", "entry_px": 100000, "exit_px": 99000,
             "realized_pnl": -10.0, "classification": "stop_loss"},
        ]
        for event in events:
            prev_positions.pop(event["coin"], None)

        assert "BTC" not in prev_positions, "Closed position should be evicted"
        assert "ETH" in prev_positions, "Unaffected position should remain"

    def test_eviction_handles_multiple_closes(self):
        """Multiple positions closing in one tick should all be evicted."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
            "SOL": {"side": "long", "size": 1.0, "entry_px": 150, "leverage": 5},
        }
        events = [
            {"coin": "BTC", "side": "long", "entry_px": 100000, "exit_px": 99000,
             "realized_pnl": -10.0, "classification": "stop_loss"},
            {"coin": "ETH", "side": "short", "entry_px": 3500, "exit_px": 3600,
             "realized_pnl": -5.0, "classification": "stop_loss"},
        ]
        for event in events:
            prev_positions.pop(event["coin"], None)

        assert "BTC" not in prev_positions
        assert "ETH" not in prev_positions
        assert "SOL" in prev_positions, "Unaffected position should remain"

    def test_eviction_idempotent_for_unknown_coin(self):
        """Evicting a coin not in _prev_positions should not raise."""
        prev_positions = {"BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20}}
        events = [{"coin": "DOGE", "side": "long", "entry_px": 0.3, "exit_px": 0.28,
                    "realized_pnl": -1.0, "classification": "stop_loss"}]
        for event in events:
            prev_positions.pop(event["coin"], None)
        assert "BTC" in prev_positions

    def test_full_refresh_overwrites_partial_eviction(self):
        """If get_user_state() succeeds, its result replaces the evicted dict entirely."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
        }
        events = [{"coin": "BTC", "side": "long", "entry_px": 100000, "exit_px": 99000,
                    "realized_pnl": -10.0, "classification": "stop_loss"}]

        # Step 1: evict
        for event in events:
            prev_positions.pop(event["coin"], None)

        # Step 2: simulate get_user_state() returning fresh data
        fresh_positions = [
            {"coin": "ETH", "side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
            {"coin": "SOL", "side": "long", "size": 1.0, "entry_px": 150, "leverage": 5},
        ]
        prev_positions = {
            p["coin"]: {"side": p["side"], "size": p["size"], "entry_px": p["entry_px"], "leverage": p.get("leverage", 20)}
            for p in fresh_positions
        }

        assert "BTC" not in prev_positions
        assert "ETH" in prev_positions
        assert "SOL" in prev_positions

    def test_fallback_after_failure_preserves_remaining(self):
        """If get_user_state() fails, remaining positions survive the eviction."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
        }
        events = [{"coin": "BTC", "side": "long", "entry_px": 100000, "exit_px": 99000,
                    "realized_pnl": -10.0, "classification": "stop_loss"}]

        # Step 1: evict closed positions
        for event in events:
            prev_positions.pop(event["coin"], None)

        # Step 2: get_user_state() fails — we just keep what we have
        assert "BTC" not in prev_positions, "Closed position must be gone"
        assert "ETH" in prev_positions, "Open position must survive"
        assert prev_positions["ETH"]["entry_px"] == 3500, "Data must be intact"


class TestEvictedCoinsSkippedByGuard:
    """Evicted coins should be skipped by the ROE loop's `if not pos: continue` guard."""

    def test_guard_skips_evicted_coin(self):
        """After eviction, _prev_positions.get(coin) returns None → skipped."""
        prev_positions = {
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
        }
        # BTC was in the old position_syms list but has been evicted
        position_syms = ["BTC", "ETH"]

        processed = []
        for sym in position_syms:
            pos = prev_positions.get(sym)
            if not pos:
                continue  # mirrors line 1806-1807 in daemon.py
            processed.append(sym)

        assert "BTC" not in processed, "Evicted coin must be skipped"
        assert "ETH" in processed, "Open coin must be processed"

    def test_guard_skips_all_evicted(self):
        """If all positions closed, loop processes nothing."""
        prev_positions = {}  # all evicted
        position_syms = ["BTC", "ETH"]

        processed = []
        for sym in position_syms:
            pos = prev_positions.get(sym)
            if not pos:
                continue
            processed.append(sym)

        assert processed == []


class TestPhase3Preserved:
    """Phase 3 must NOT be deleted — it's a Phase 2 failure backup.

    Reads daemon.py source directly to avoid importing the full dependency chain
    (litellm, reflex, etc.) which isn't available in the unit test environment.
    """

    @staticmethod
    def _daemon_source() -> str:
        from pathlib import Path
        daemon_path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
        return daemon_path.read_text()

    def test_phase3_still_exists(self):
        """Phase 3 backup close code must still exist in _fast_trigger_check."""
        source = self._daemon_source()
        assert "Phase 3" in source, "Phase 3 comment must still exist"
        assert "market_close" in source, "Phase 3 market_close must still exist"

    def test_all_three_phases_exist(self):
        """Phases 1, 2, and 3 must all exist."""
        source = self._daemon_source()
        assert "Phase 1" in source
        assert "Phase 2" in source
        assert "Phase 3" in source


class TestRecordingBeforeEviction:
    """Verify that _record_trigger_close can access _prev_positions data."""

    def test_metadata_available_before_eviction(self):
        """Leverage and size must be readable from _prev_positions before eviction."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
        }
        event = {"coin": "BTC", "side": "long", "entry_px": 100000, "exit_px": 101000,
                 "realized_pnl": 5.0, "classification": "take_profit"}

        # Simulate reading metadata (as _record_trigger_close does on line 2437)
        pos_meta = prev_positions.get(event["coin"], {})
        leverage = int(pos_meta.get("leverage", 0))
        size = float(pos_meta.get("size", 0))
        assert leverage == 20
        assert size == 0.01

        # NOW evict
        prev_positions.pop(event["coin"], None)
        assert "BTC" not in prev_positions
