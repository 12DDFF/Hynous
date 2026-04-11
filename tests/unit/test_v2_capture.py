"""Tests for v2 data capture pipeline (phase 1).

Covers: ML snapshot builder, market state builder, entry snapshot generation,
lifecycle event emission, staging store roundtrip, counterfactual computation.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_daemon():
    """A mock daemon with realistic state for snapshot builders."""
    daemon = MagicMock()
    daemon._latest_predictions_lock = threading.Lock()
    daemon._latest_predictions = {
        "BTC": {
            "signal": "long",
            "long_roe": 5.2,
            "short_roe": -1.8,
            "confidence": 5.2,
            "entry_score": 72.5,
            "entry_score_label": "good",
            "entry_score_components": {
                "entry_quality": 0.65,
                "vol_favorability": 0.60,
                "funding_safety": 0.70,
                "volume_quality": 0.55,
                "mae_safety": 0.80,
                "direction_edge": 0.45,
            },
            "conditions": {
                "timestamp": time.time() - 30,
                "vol_1h": {"value": 1.2, "percentile": 55, "regime": "normal"},
                "vol_4h": {"value": 1.8, "percentile": 60, "regime": "normal"},
                "entry_quality": {"value": 0.65, "percentile": 70, "regime": "normal"},
                "mae_long": {"value": 0.8, "percentile": 40, "regime": "low"},
                "mae_short": {"value": 1.2, "percentile": 55, "regime": "normal"},
                "funding_4h": {"value": 0.01, "percentile": 45, "regime": "normal"},
                "volume_1h": {"value": 1.1, "percentile": 50, "regime": "normal"},
                "momentum_quality": {"value": 0.7, "percentile": 65, "regime": "normal"},
                "range_30m": {"value": 0.5, "percentile": 40, "regime": "low"},
                "move_30m": {"value": 0.3, "percentile": 35, "regime": "low"},
                "vol_expand": {"value": 0.4, "percentile": 30, "regime": "low"},
                "sl_survival_03": {"value": 0.15, "percentile": 20, "regime": "low"},
                "sl_survival_05": {"value": 0.10, "percentile": 15, "regime": "low"},
            },
            "shap_top5": [],
        },
    }
    daemon._peak_roe = {"BTC": 3.5}
    daemon._trough_roe = {"BTC": -1.2}
    daemon._peak_roe_ts = {"BTC": "2026-04-10T12:00:00+00:00"}
    daemon._trough_roe_ts = {"BTC": "2026-04-10T11:30:00+00:00"}
    daemon._peak_roe_price = {"BTC": 98500.0}
    daemon._trough_roe_price = {"BTC": 96200.0}
    daemon._open_trade_ids = {}
    daemon.snapshot = MagicMock()
    daemon.snapshot.funding = {"BTC": 0.0001}
    daemon.snapshot.oi_usd = {"BTC": 5_000_000_000.0}
    daemon.snapshot.volume_usd = {"BTC": 50_000_000.0}
    daemon.trading_paused = False
    daemon._daily_realized_pnl = 25.5
    daemon._entries_today = 2
    daemon._initial_balance = 1000.0

    # Provider mock
    provider = MagicMock()
    provider.get_l2_book.return_value = {
        "best_bid": 97000.0,
        "best_ask": 97010.0,
        "bids": [{"price": 97000.0, "size": 0.5}],
        "asks": [{"price": 97010.0, "size": 0.3}],
    }
    provider.get_user_state.return_value = {
        "account_value": 1050.0,
        "positions": [{"coin": "BTC", "side": "long", "size": 0.01}],
    }
    provider.get_candles.return_value = [
        {"t": 1000000, "o": 97000, "h": 97100, "l": 96900, "c": 97050, "v": 10.0},
    ] * 20
    daemon._get_provider.return_value = provider

    return daemon


@pytest.fixture
def staging_store(tmp_path):
    """Fresh staging store in a temp directory."""
    from hynous.journal.staging_store import StagingStore
    db_path = str(tmp_path / "test_staging.db")
    store = StagingStore(db_path)
    yield store
    store.close()


@pytest.fixture
def sample_entry_snapshot(mock_daemon):
    """A built entry snapshot for roundtrip tests."""
    from hynous.journal.capture import build_entry_snapshot
    return build_entry_snapshot(
        symbol="BTC",
        side="long",
        trade_type="macro",
        fill_px=97005.0,
        fill_sz=0.01,
        leverage=10,
        sl_px=96000.0,
        tp_px=100000.0,
        size_usd=970.05,
        reference_price=97000.0,
        fees_paid_usd=0.68,
        daemon=mock_daemon,
    )


# ============================================================================
# Tests
# ============================================================================


class TestMLSnapshot:
    """Tests for _build_ml_snapshot."""

    def test_build_ml_snapshot_with_full_predictions(self, mock_daemon):
        from hynous.journal.capture import _build_ml_snapshot

        snap = _build_ml_snapshot(mock_daemon, "BTC")

        assert snap.composite_entry_score == 72.5
        assert snap.composite_label == "good"
        assert snap.vol_1h_regime == "normal"
        assert snap.vol_1h_value == 1.2
        assert snap.entry_quality_percentile == 70
        assert snap.direction_signal == "long"
        assert snap.direction_long_roe == 5.2
        assert snap.predictions_staleness_s is not None
        assert snap.predictions_staleness_s < 60

    def test_build_ml_snapshot_with_empty_predictions(self, mock_daemon):
        from hynous.journal.capture import _build_ml_snapshot

        mock_daemon._latest_predictions = {}
        snap = _build_ml_snapshot(mock_daemon, "BTC")

        assert snap.composite_entry_score is None
        assert snap.vol_1h_regime is None
        assert snap.direction_signal is None
        assert snap.predictions_timestamp is None
        assert snap.predictions_staleness_s is None

    def test_build_ml_snapshot_uses_correct_key_names(self, mock_daemon):
        """Verify we read 'entry_score' (no underscore) from _latest_predictions."""
        from hynous.journal.capture import _build_ml_snapshot

        # The daemon stores entry_score without underscore prefix
        assert "entry_score" in mock_daemon._latest_predictions["BTC"]
        snap = _build_ml_snapshot(mock_daemon, "BTC")
        assert snap.composite_entry_score == 72.5


class TestMarketState:
    """Tests for _build_market_state."""

    def test_build_market_state_with_full_book(self, mock_daemon):
        from hynous.journal.capture import _build_market_state

        state = _build_market_state(mock_daemon, "BTC", 97005.0)

        assert state.bid == 97000.0
        assert state.ask == 97010.0
        assert state.spread_bps is not None
        assert state.spread_bps > 0
        assert state.mid_price == 97005.0

    def test_build_market_state_with_missing_book(self, mock_daemon):
        from hynous.journal.capture import _build_market_state

        provider = mock_daemon._get_provider()
        provider.get_l2_book.return_value = None
        state = _build_market_state(mock_daemon, "BTC", 97005.0)

        assert state.mid_price == 97005.0
        assert state.bid is None
        assert state.spread_bps is None


class TestEntrySnapshot:
    """Tests for build_entry_snapshot."""

    def test_generates_unique_trade_id(self, mock_daemon):
        from hynous.journal.capture import build_entry_snapshot

        snap1 = build_entry_snapshot(
            symbol="BTC", side="long", trade_type="macro",
            fill_px=97000, fill_sz=0.01, leverage=10,
            sl_px=96000, tp_px=100000, size_usd=970,
            reference_price=97000, fees_paid_usd=0.68,
            daemon=mock_daemon,
        )
        snap2 = build_entry_snapshot(
            symbol="BTC", side="long", trade_type="macro",
            fill_px=97000, fill_sz=0.01, leverage=10,
            sl_px=96000, tp_px=100000, size_usd=970,
            reference_price=97000, fees_paid_usd=0.68,
            daemon=mock_daemon,
        )
        assert snap1.trade_basics.trade_id != snap2.trade_basics.trade_id

    def test_snapshot_has_all_components(self, sample_entry_snapshot):
        snap = sample_entry_snapshot
        assert snap.trade_basics.symbol == "BTC"
        assert snap.trade_basics.side == "long"
        assert snap.ml_snapshot is not None
        assert snap.market_state is not None
        assert snap.derivatives_state is not None
        assert snap.liquidation_terrain is not None
        assert snap.order_flow_state is not None
        assert snap.smart_money_context is not None
        assert snap.time_context is not None
        assert snap.account_context is not None
        assert snap.settings_snapshot is not None
        assert snap.price_history is not None
        assert snap.schema_version == "1.0.0"


class TestLifecycleEvent:
    """Tests for emit_lifecycle_event and staging store persistence."""

    def test_emit_lifecycle_event_persists(self, staging_store):
        from hynous.journal.capture import emit_lifecycle_event

        emit_lifecycle_event(
            journal_store=staging_store,
            trade_id="trade_abc123",
            event_type="peak_roe_new",
            payload={"peak_roe": 3.5, "price": 98000},
        )

        events = staging_store.get_events_for_trade("trade_abc123")
        assert len(events) == 1
        assert events[0].event_type == "peak_roe_new"
        assert events[0].payload["peak_roe"] == 3.5

    def test_emit_lifecycle_event_handles_store_exception(self):
        """Emit should log and swallow, never raise."""
        from hynous.journal.capture import emit_lifecycle_event

        broken_store = MagicMock()
        broken_store.insert_lifecycle_event.side_effect = RuntimeError("DB locked")

        # Should NOT raise
        emit_lifecycle_event(
            journal_store=broken_store,
            trade_id="trade_abc",
            event_type="peak_roe_new",
            payload={"peak_roe": 1.0},
        )


class TestStagingStoreRoundtrip:
    """Tests for staging store insert/retrieve."""

    def test_roundtrip_entry_snapshot(self, staging_store, sample_entry_snapshot):
        staging_store.insert_entry_snapshot(sample_entry_snapshot)
        trade_id = sample_entry_snapshot.trade_basics.trade_id

        loaded = staging_store.get_entry_snapshot_json(trade_id)
        assert loaded is not None
        assert loaded["trade_basics"]["symbol"] == "BTC"
        assert loaded["trade_basics"]["side"] == "long"
        assert loaded["ml_snapshot"]["composite_entry_score"] == 72.5

    def test_roundtrip_lifecycle_events_ordered(self, staging_store):
        trade_id = "trade_test_order"
        for i, event_type in enumerate(
            ["dynamic_sl_placed", "peak_roe_new", "trail_activated"],
        ):
            staging_store.insert_lifecycle_event(
                trade_id=trade_id,
                ts=f"2026-04-10T12:{i:02d}:00+00:00",
                event_type=event_type,
                payload={"seq": i},
            )

        events = staging_store.get_events_for_trade(trade_id)
        assert len(events) == 3
        assert events[0].event_type == "dynamic_sl_placed"
        assert events[1].event_type == "peak_roe_new"
        assert events[2].event_type == "trail_activated"


class TestCounterfactuals:
    """Tests for counterfactual computation."""

    def test_counterfactual_window_formula(self):
        from hynous.journal.counterfactuals import compute_counterfactual_window

        # Short hold → 2h minimum
        assert compute_counterfactual_window(300) == 7200
        # Medium hold → hold duration
        assert compute_counterfactual_window(10000) == 10000
        # Long hold → 12h cap
        assert compute_counterfactual_window(100000) == 43200

    def test_compute_counterfactuals_with_tp_hit_later(self):
        from hynous.journal.counterfactuals import compute_counterfactuals

        provider = MagicMock()
        # Candles: exit at t=5, TP hit at t=8 (post-exit)
        candles = []
        for i in range(20):
            candles.append({
                "t": (1700000000 + i * 60) * 1000,
                "o": 97000 + i * 50,
                "h": 97000 + i * 50 + 100,
                "l": 97000 + i * 50 - 50,
                "c": 97000 + i * 50 + 50,
                "v": 1.0,
            })
        provider.get_candles.return_value = candles

        result = compute_counterfactuals(
            provider=provider,
            symbol="BTC",
            side="long",
            entry_px=97000,
            entry_ts="2023-11-14T22:13:20+00:00",  # t=0
            exit_px=97200,
            exit_ts="2023-11-14T22:18:20+00:00",   # t=5min
            sl_px=96500,
            tp_px=97800,  # TP at 97800 — candle at i=16 has h=97900
        )

        assert result.did_tp_hit_later is True

    def test_compute_counterfactuals_with_sl_hunted(self):
        from hynous.journal.counterfactuals import compute_counterfactuals

        provider = MagicMock()
        # Candle touches SL at i=3, then reverses >1% within next 10 candles
        candles = []
        for i in range(20):
            if i == 3:
                # SL touch
                candles.append({
                    "t": (1700000000 + i * 60) * 1000,
                    "o": 96600, "h": 96600, "l": 96400, "c": 96500, "v": 1.0,
                })
            elif i in range(4, 14):
                # Recovery after SL touch
                candles.append({
                    "t": (1700000000 + i * 60) * 1000,
                    "o": 96600, "h": 97500 + i * 10, "l": 96600, "c": 97000 + i * 10, "v": 1.0,
                })
            else:
                candles.append({
                    "t": (1700000000 + i * 60) * 1000,
                    "o": 97000, "h": 97100, "l": 96900, "c": 97050, "v": 1.0,
                })
        provider.get_candles.return_value = candles

        result = compute_counterfactuals(
            provider=provider,
            symbol="BTC",
            side="long",
            entry_px=97000,
            entry_ts="2023-11-14T22:13:20+00:00",
            exit_px=96500,
            exit_ts="2023-11-14T22:16:20+00:00",
            sl_px=96500,
            tp_px=100000,
        )

        assert result.did_sl_get_hunted is True
        assert result.sl_hunt_reversal_pct is not None
        assert result.sl_hunt_reversal_pct > 1.0
