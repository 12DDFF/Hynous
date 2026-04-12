"""Unit tests for daemon-side mechanical entry wiring (phase 5 M4).

The 11 scenarios from the M4 directive:

1. ``_init_mechanical_entry`` builds an ``MLSignalDrivenTrigger`` when the
   configured ``trigger_source`` is ``"ml_signal_driven"``.
2. Empty ``trigger_source`` disables the trigger.
3. Unknown ``trigger_source`` disables the trigger and logs an error.
4. ``_evaluate_entry_signals`` is a no-op when the trigger is ``None``.
5. ``_evaluate_entry_signals`` filters anomalies to ``cfg.coin``.
6. A returned ``EntrySignal`` invokes ``execute_trade_mechanical``.
7. Trigger-side exceptions are swallowed, the executor is not called.
8. Executor exceptions are swallowed.
9. ``_periodic_ml_signal_check`` skips when the target coin already has a
   live position.
10. With no position, a returned signal fires the executor.
11. Trigger exceptions inside the periodic check are swallowed.

The tests never instantiate a real ``Daemon`` — the config / journal
stack would make setup slow and brittle. Instead each test builds a
``SimpleNamespace`` "fake daemon" and binds the actual method under test via
``types.MethodType``.
"""

from __future__ import annotations

import logging
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Module-level import shim — mirrors the litellm stub in test_executor.py /
# test_v2_analysis.py. ``hynous.intelligence.__init__`` loads ``Agent`` which
# imports ``litellm`` unconditionally at module load.
# ---------------------------------------------------------------------------
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception  # type: ignore[attr-defined]

import pytest  # noqa: E402

from hynous.intelligence.daemon import Daemon  # noqa: E402
from hynous.mechanical_entry.interface import EntrySignal  # noqa: E402
from hynous.mechanical_entry.ml_signal_driven import (  # noqa: E402
    MLSignalDrivenTrigger,
)


# ---------------------------------------------------------------------------
# Fakes / helpers
# ---------------------------------------------------------------------------


def _make_mech_cfg(
    *,
    trigger_source: str = "ml_signal_driven",
    coin: str = "BTC",
    composite_threshold: float = 50,
    direction_conf: float = 0.55,
    eq_pctl: int = 60,
    max_vol: str = "high",
) -> SimpleNamespace:
    return SimpleNamespace(
        trigger_source=trigger_source,
        coin=coin,
        composite_entry_threshold=composite_threshold,
        direction_confidence_threshold=direction_conf,
        require_entry_quality_pctl=eq_pctl,
        max_vol_regime=max_vol,
        roe_target_pct=10.0,
    )


def _make_fake_daemon(
    *,
    trigger_source: str = "ml_signal_driven",
    coin: str = "BTC",
    entry_trigger=None,
    prev_positions: dict | None = None,
) -> SimpleNamespace:
    """Build a minimal fake daemon sufficient for the methods under test."""
    cfg = SimpleNamespace(
        v2=SimpleNamespace(
            mechanical_entry=_make_mech_cfg(
                trigger_source=trigger_source, coin=coin,
            ),
        ),
    )
    daemon = SimpleNamespace(
        config=cfg,
        _entry_trigger=entry_trigger,
        _prev_positions=prev_positions or {},
    )
    # Bind the real methods to the fake instance — no subclass gymnastics.
    daemon._init_mechanical_entry = types.MethodType(  # type: ignore[attr-defined]
        Daemon._init_mechanical_entry, daemon,
    )
    daemon._evaluate_entry_signals = types.MethodType(  # type: ignore[attr-defined]
        Daemon._evaluate_entry_signals, daemon,
    )
    daemon._periodic_ml_signal_check = types.MethodType(  # type: ignore[attr-defined]
        Daemon._periodic_ml_signal_check, daemon,
    )
    return daemon


def _make_signal(
    *, symbol: str = "BTC", side: str = "long", conviction: float = 0.7,
) -> EntrySignal:
    return EntrySignal(
        symbol=symbol,
        side=side,
        trade_type="macro",
        conviction=conviction,
        trigger_source="ml_signal_driven",
        trigger_type="composite_score_plus_direction",
        trigger_detail={"vol_regime": "normal"},
        ml_snapshot_ref={},
        expires_at=None,
    )


# ---------------------------------------------------------------------------
# 1-3. _init_mechanical_entry
# ---------------------------------------------------------------------------


def test_init_mechanical_entry_creates_ml_trigger() -> None:
    daemon = _make_fake_daemon(trigger_source="ml_signal_driven")
    daemon._init_mechanical_entry()
    assert isinstance(daemon._entry_trigger, MLSignalDrivenTrigger)
    assert daemon._entry_trigger.name() == "ml_signal_driven"


def test_init_mechanical_entry_disabled_by_empty_source() -> None:
    daemon = _make_fake_daemon(trigger_source="")
    daemon._init_mechanical_entry()
    assert daemon._entry_trigger is None


def test_init_mechanical_entry_logs_and_disables_on_unknown_source(
    caplog: pytest.LogCaptureFixture,
) -> None:
    daemon = _make_fake_daemon(trigger_source="bogus")
    with caplog.at_level(logging.ERROR, logger="hynous.intelligence.daemon"):
        daemon._init_mechanical_entry()
    assert daemon._entry_trigger is None
    assert any("unknown trigger_source" in r.getMessage() for r in caplog.records)


# ---------------------------------------------------------------------------
# 4-8. _evaluate_entry_signals
# ---------------------------------------------------------------------------


def test_evaluate_entry_signals_skips_when_trigger_none() -> None:
    daemon = _make_fake_daemon(entry_trigger=None)
    # Must not crash and must not raise — single assert: returns None (no-op).
    assert daemon._evaluate_entry_signals([
        SimpleNamespace(symbol="BTC"),
    ]) is None


def test_evaluate_entry_signals_filters_by_cfg_coin() -> None:
    trigger = MagicMock()
    trigger.evaluate.return_value = None
    daemon = _make_fake_daemon(coin="BTC", entry_trigger=trigger)
    anomalies = [SimpleNamespace(symbol="ETH")]  # wrong coin
    daemon._evaluate_entry_signals(anomalies)
    trigger.evaluate.assert_not_called()


def test_evaluate_entry_signals_calls_execute_on_signal() -> None:
    signal = _make_signal()
    trigger = MagicMock()
    trigger.evaluate.return_value = signal
    daemon = _make_fake_daemon(coin="BTC", entry_trigger=trigger)
    anomalies = [SimpleNamespace(symbol="BTC", headline="px spike")]

    with patch(
        "hynous.mechanical_entry.executor.execute_trade_mechanical",
    ) as exec_mock:
        exec_mock.return_value = "entry_abc123"
        daemon._evaluate_entry_signals(anomalies)

    trigger.evaluate.assert_called_once()
    exec_mock.assert_called_once()
    _, kwargs = exec_mock.call_args
    assert kwargs["signal"] is signal
    assert kwargs["daemon"] is daemon


def test_evaluate_entry_signals_swallows_trigger_exception() -> None:
    trigger = MagicMock()
    trigger.evaluate.side_effect = RuntimeError("boom")
    daemon = _make_fake_daemon(coin="BTC", entry_trigger=trigger)
    anomalies = [SimpleNamespace(symbol="BTC")]

    with patch(
        "hynous.mechanical_entry.executor.execute_trade_mechanical",
    ) as exec_mock:
        # Must not raise.
        daemon._evaluate_entry_signals(anomalies)
        exec_mock.assert_not_called()


def test_evaluate_entry_signals_swallows_executor_exception() -> None:
    trigger = MagicMock()
    trigger.evaluate.return_value = _make_signal()
    daemon = _make_fake_daemon(coin="BTC", entry_trigger=trigger)
    anomalies = [SimpleNamespace(symbol="BTC")]

    with patch(
        "hynous.mechanical_entry.executor.execute_trade_mechanical",
        side_effect=RuntimeError("exec boom"),
    ):
        # Must not raise.
        daemon._evaluate_entry_signals(anomalies)


# ---------------------------------------------------------------------------
# 9-11. _periodic_ml_signal_check
# ---------------------------------------------------------------------------


def test_periodic_ml_signal_check_skips_when_position_exists() -> None:
    trigger = MagicMock()
    daemon = _make_fake_daemon(
        coin="BTC",
        entry_trigger=trigger,
        prev_positions={"BTC": {"side": "long", "size": 0.01}},
    )
    daemon._periodic_ml_signal_check()
    trigger.evaluate.assert_not_called()


def test_periodic_ml_signal_check_fires_executor_on_signal() -> None:
    signal = _make_signal()
    trigger = MagicMock()
    trigger.evaluate.return_value = signal
    daemon = _make_fake_daemon(coin="BTC", entry_trigger=trigger)

    with patch(
        "hynous.mechanical_entry.executor.execute_trade_mechanical",
    ) as exec_mock:
        exec_mock.return_value = "entry_periodic_1"
        daemon._periodic_ml_signal_check()

    trigger.evaluate.assert_called_once()
    exec_mock.assert_called_once()
    _, kwargs = exec_mock.call_args
    assert kwargs["signal"] is signal
    assert kwargs["daemon"] is daemon


def test_periodic_ml_signal_check_swallows_exceptions() -> None:
    trigger = MagicMock()
    trigger.evaluate.side_effect = RuntimeError("boom")
    daemon = _make_fake_daemon(coin="BTC", entry_trigger=trigger)
    # Must not raise.
    daemon._periodic_ml_signal_check()
