"""Unit tests for execute_trade_mechanical (phase 5 M3).

Covers the 5 scenarios from the M3 directive:

1. Happy path — provider mocked, all calls flow in order, daemon state
   mutations happen, snapshot persisted, trade_id returned.
2. Order-failure parametrized — several bad-return / raise modes all yield
   a ``None`` return with no snapshot insert / no state mutation.
3. Snapshot-call verification — ``build_entry_snapshot`` invoked with the
   exact kwargs the directive specifies (fill prices / sizes / trigger
   metadata).
4. Trigger placement failure keeps the position — ``_place_triggers`` raises
   but the executor still returns a ``trade_id`` and persists the snapshot.
5. Snapshot persistence failure returns ``None`` and does NOT call
   ``record_trade_entry``.

All mocks via ``unittest.mock``. No real exchange / journal. ``_retry_exchange_call``
and ``_place_triggers`` are patched where needed to keep the seam clean.
"""

from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Module-level import shim — mirrors the litellm stub in test_v2_analysis.py.
# ---------------------------------------------------------------------------
# ``hynous.intelligence.__init__`` auto-imports ``Agent`` which imports
# ``litellm`` at module load. That package isn't installed in the test env.
# Stubbing it in sys.modules lets the real ``hynous.intelligence.tools.trading``
# module load cleanly, which is what the executor's lazy import needs.
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception  # type: ignore[attr-defined]

import pytest  # noqa: E402

from hynous.mechanical_entry.executor import execute_trade_mechanical  # noqa: E402
from hynous.mechanical_entry.interface import EntrySignal  # noqa: E402


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


def _make_signal(
    *,
    symbol: str = "BTC",
    side: str = "long",
    trade_type: str = "macro",
    conviction: float = 0.7,
    vol_regime: str = "normal",
) -> EntrySignal:
    return EntrySignal(
        symbol=symbol,
        side=side,
        trade_type=trade_type,
        conviction=conviction,
        trigger_source="ml_signal_driven",
        trigger_type="composite_score_plus_direction",
        trigger_detail={"vol_regime": vol_regime, "composite_score": 72.0},
        ml_snapshot_ref={"composite_entry_score": 72.0},
    )


def _make_provider(
    *,
    price: float | None = 50000.0,
    account_value: float = 1000.0,
    fill_status: str = "filled",
    fill_sz: float = 0.02,
    fill_avg_px: float = 50010.0,
    market_open_result: Any = None,
    market_open_raises: Exception | None = None,
    update_leverage_raises: Exception | None = None,
    get_user_state_raises: Exception | None = None,
) -> MagicMock:
    provider = MagicMock()
    provider.get_price.return_value = price
    if get_user_state_raises is not None:
        provider.get_user_state.side_effect = get_user_state_raises
    else:
        provider.get_user_state.return_value = {"account_value": account_value}
    if update_leverage_raises is not None:
        provider.update_leverage.side_effect = update_leverage_raises
    else:
        provider.update_leverage.return_value = None
    if market_open_raises is not None:
        provider.market_open.side_effect = market_open_raises
    elif market_open_result is not None:
        provider.market_open.return_value = market_open_result
    else:
        provider.market_open.return_value = {
            "status": fill_status,
            "avg_px": fill_avg_px,
            "filled_sz": fill_sz,
        }
    provider.place_trigger_order.return_value = None
    return provider


def _make_daemon(provider: MagicMock) -> SimpleNamespace:
    """Assemble a minimal daemon stand-in with the attrs the executor touches."""
    journal = MagicMock()
    journal.insert_entry_snapshot.return_value = None

    daemon = SimpleNamespace(
        _get_provider=lambda: provider,
        _journal_store=journal,
        _open_trade_ids={},
        record_trade_entry=MagicMock(),
        register_position_type=MagicMock(),
        config=SimpleNamespace(
            hyperliquid=SimpleNamespace(default_slippage=0.01),
            v2=SimpleNamespace(
                mechanical_entry=SimpleNamespace(roe_target_pct=10.0),
            ),
        ),
    )
    return daemon


def _make_snapshot(trade_id: str = "trade_abc123") -> SimpleNamespace:
    return SimpleNamespace(trade_basics=SimpleNamespace(trade_id=trade_id))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_execute_trade_mechanical_happy_path_mocks() -> None:
    """Happy path: provider calls flow in order, state mutations happen, id returned."""
    provider = _make_provider()
    daemon = _make_daemon(provider)
    signal = _make_signal()
    fake_snapshot = _make_snapshot("trade_happy_1")

    with patch(
        "hynous.mechanical_entry.executor.build_entry_snapshot",
        return_value=fake_snapshot,
    ) as mock_build:
        result = execute_trade_mechanical(signal=signal, daemon=daemon)

    assert result == "trade_happy_1"

    # Provider calls in expected order
    provider.get_price.assert_called_once_with("BTC")
    provider.get_user_state.assert_called_once_with()
    provider.update_leverage.assert_called_once()
    provider.market_open.assert_called_once()
    # place_trigger_order is called twice (SL + TP) via _place_triggers
    assert provider.place_trigger_order.call_count == 2

    # Snapshot built + persisted
    mock_build.assert_called_once()
    daemon._journal_store.insert_entry_snapshot.assert_called_once_with(fake_snapshot)

    # Daemon state mutations
    assert daemon._open_trade_ids["BTC"] == "trade_happy_1"
    daemon.record_trade_entry.assert_called_once_with()
    daemon.register_position_type.assert_called_once_with("BTC", "macro")


@pytest.mark.parametrize(
    "mutate",
    [
        # get_price returns 0
        lambda p: setattr(p, "get_price", MagicMock(return_value=0)),
        # get_price returns None
        lambda p: setattr(p, "get_price", MagicMock(return_value=None)),
        # get_user_state raises
        lambda p: setattr(
            p, "get_user_state", MagicMock(side_effect=RuntimeError("boom")),
        ),
        # update_leverage raises
        lambda p: setattr(
            p, "update_leverage", MagicMock(side_effect=RuntimeError("lev fail")),
        ),
        # market_open raises
        lambda p: setattr(
            p, "market_open", MagicMock(side_effect=RuntimeError("order fail")),
        ),
        # market_open returns non-dict
        lambda p: setattr(p, "market_open", MagicMock(return_value="oops")),
        # market_open returns {status: "open"} (not filled)
        lambda p: setattr(
            p,
            "market_open",
            MagicMock(return_value={"status": "open", "filled_sz": 0}),
        ),
        # market_open returns filled with zero size
        lambda p: setattr(
            p,
            "market_open",
            MagicMock(
                return_value={"status": "filled", "avg_px": 50000.0, "filled_sz": 0},
            ),
        ),
    ],
    ids=[
        "price_zero",
        "price_none",
        "user_state_raises",
        "update_leverage_raises",
        "market_open_raises",
        "market_open_non_dict",
        "market_open_not_filled",
        "market_open_zero_fill",
    ],
)
def test_execute_trade_mechanical_handles_order_failure(mutate: Any) -> None:
    """Any pre-snapshot failure returns None and skips snapshot persistence."""
    provider = _make_provider()
    mutate(provider)
    daemon = _make_daemon(provider)
    signal = _make_signal()

    with patch(
        "hynous.mechanical_entry.executor.build_entry_snapshot",
    ) as mock_build:
        result = execute_trade_mechanical(signal=signal, daemon=daemon)

    assert result is None
    mock_build.assert_not_called()
    daemon._journal_store.insert_entry_snapshot.assert_not_called()
    daemon.record_trade_entry.assert_not_called()
    daemon.register_position_type.assert_not_called()
    assert daemon._open_trade_ids == {}


def test_execute_trade_mechanical_persists_entry_snapshot() -> None:
    """Verify build_entry_snapshot is called with the exact expected kwargs."""
    provider = _make_provider(fill_avg_px=50_010.0, fill_sz=0.02)
    daemon = _make_daemon(provider)
    signal = _make_signal(conviction=0.75, vol_regime="normal")
    fake_snapshot = _make_snapshot("trade_persist_1")

    with patch(
        "hynous.mechanical_entry.executor.build_entry_snapshot",
        return_value=fake_snapshot,
    ) as mock_build:
        result = execute_trade_mechanical(signal=signal, daemon=daemon)

    assert result == "trade_persist_1"
    mock_build.assert_called_once()
    kwargs = mock_build.call_args.kwargs

    # Exact kwargs from the directive
    assert kwargs["symbol"] == "BTC"
    assert kwargs["side"] == "long"
    assert kwargs["trade_type"] == "macro"
    assert kwargs["fill_px"] == 50_010.0
    assert kwargs["fill_sz"] == 0.02
    assert kwargs["reference_price"] == 50_000.0
    assert kwargs["trigger_source"] == "ml_signal_driven"
    assert kwargs["trigger_type"] == "composite_score_plus_direction"
    assert kwargs["wake_source_id"] is None
    assert kwargs["scanner_detail"] == signal.trigger_detail
    assert kwargs["scanner_score"] == 0.75
    assert kwargs["daemon"] is daemon

    # size_usd / leverage / sl_px / tp_px / fees_paid_usd come from compute_entry_params
    # (verified separately in test_compute_entry_params.py). Here we just assert
    # they were populated with positive, finite values of the expected types.
    assert isinstance(kwargs["size_usd"], (int, float)) and kwargs["size_usd"] > 0
    assert isinstance(kwargs["leverage"], int) and kwargs["leverage"] > 0
    assert isinstance(kwargs["sl_px"], (int, float)) and kwargs["sl_px"] > 0
    assert isinstance(kwargs["tp_px"], (int, float)) and kwargs["tp_px"] > 0
    assert (
        isinstance(kwargs["fees_paid_usd"], (int, float)) and kwargs["fees_paid_usd"] > 0
    )

    # Daemon state mutations
    assert daemon._open_trade_ids["BTC"] == "trade_persist_1"
    daemon.record_trade_entry.assert_called_once_with()
    daemon.register_position_type.assert_called_once_with("BTC", "macro")


def test_execute_trade_mechanical_trigger_placement_failure_keeps_position() -> None:
    """If trigger placement raises, the executor still returns the trade_id."""
    provider = _make_provider()
    daemon = _make_daemon(provider)
    signal = _make_signal()
    fake_snapshot = _make_snapshot("trade_trig_fail")

    with patch(
        "hynous.mechanical_entry.executor.build_entry_snapshot",
        return_value=fake_snapshot,
    ), patch(
        "hynous.intelligence.tools.trading._place_triggers",
        side_effect=RuntimeError("exchange ate the trigger"),
    ):
        result = execute_trade_mechanical(signal=signal, daemon=daemon)

    # Position is live — snapshot persisted, state mutated, id returned.
    assert result == "trade_trig_fail"
    daemon._journal_store.insert_entry_snapshot.assert_called_once_with(fake_snapshot)
    assert daemon._open_trade_ids["BTC"] == "trade_trig_fail"
    daemon.record_trade_entry.assert_called_once_with()
    daemon.register_position_type.assert_called_once_with("BTC", "macro")


def test_execute_trade_mechanical_snapshot_persist_failure_returns_none() -> None:
    """If insert_entry_snapshot raises, return None and skip state mutations."""
    provider = _make_provider()
    daemon = _make_daemon(provider)
    daemon._journal_store.insert_entry_snapshot.side_effect = RuntimeError(
        "journal write failure",
    )
    signal = _make_signal()
    fake_snapshot = _make_snapshot("trade_persist_fail")

    with patch(
        "hynous.mechanical_entry.executor.build_entry_snapshot",
        return_value=fake_snapshot,
    ):
        result = execute_trade_mechanical(signal=signal, daemon=daemon)

    assert result is None
    # insert was attempted
    daemon._journal_store.insert_entry_snapshot.assert_called_once_with(fake_snapshot)
    # State mutations did NOT happen (position is orphaned, phase 6 reconciles)
    assert daemon._open_trade_ids == {}
    daemon.record_trade_entry.assert_not_called()
    daemon.register_position_type.assert_not_called()
