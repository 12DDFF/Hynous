"""Unit tests for MLSignalDrivenTrigger (phase 5 M2).

Covers all 14 scenarios from the M2 directive:

1. Fires on strong conditions.
2. Rejects on circuit breaker.
3. Rejects on existing position.
4. Rejects on missing predictions.
5. Rejects on stale predictions.
6. Rejects on low composite.
7. Rejects on missing / non-directional signal (parametrized).
8. Rejects on low direction confidence.
9. Rejects on low entry quality.
10. Rejects on extreme vol when max is high.
11. Rejection writes to journal with ``rej_`` prefix + expected kwargs.
12. Rejection with no journal is silent.
13. ``name()`` returns ``"ml_signal_driven"``.
14. Symbol is uppercased in rejection row.

Uses a minimal fake daemon (SimpleNamespace) and a fake journal that
captures ``upsert_trade`` kwargs into a list. No real SQLite.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import pytest

from hynous.mechanical_entry.interface import EntryEvaluationContext, EntrySignal
from hynous.mechanical_entry.ml_signal_driven import MLSignalDrivenTrigger


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


@dataclass
class FakeJournal:
    """Records upsert_trade kwargs into a list for assertion."""

    calls: list[dict[str, Any]] = field(default_factory=list)
    raise_on_upsert: bool = False

    def upsert_trade(self, **kwargs: Any) -> None:
        if self.raise_on_upsert:
            raise RuntimeError("fake journal write failure")
        self.calls.append(kwargs)


def _make_daemon(
    *,
    trading_paused: bool = False,
    prev_positions: dict[str, Any] | None = None,
    latest_predictions: dict[str, Any] | None = None,
    journal: FakeJournal | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        trading_paused=trading_paused,
        _prev_positions=prev_positions if prev_positions is not None else {},
        _latest_predictions=latest_predictions if latest_predictions is not None else {},
        _latest_predictions_lock=threading.Lock(),
        _journal_store=journal,
    )


def _fresh_predictions(
    *,
    entry_score: float = 70.0,
    signal: str = "long",
    long_roe: float = 8.0,
    short_roe: float = -2.0,
    eq_pctl: int = 80,
    vol_regime: str = "normal",
    ts: float | None = None,
) -> dict[str, Any]:
    return {
        "_entry_score": entry_score,
        "signal": signal,
        "long_roe": long_roe,
        "short_roe": short_roe,
        "conditions": {
            "timestamp": ts if ts is not None else time.time(),
            "entry_quality": {"percentile": eq_pctl},
            "vol_1h": {"regime": vol_regime},
        },
    }


def _default_trigger() -> MLSignalDrivenTrigger:
    return MLSignalDrivenTrigger(
        composite_threshold=60.0,
        direction_confidence_threshold=0.5,
        entry_quality_threshold=70,
        max_vol_regime="high",
    )


def _ctx(daemon: SimpleNamespace, *, symbol: str = "BTC") -> EntryEvaluationContext:
    return EntryEvaluationContext(daemon=daemon, symbol=symbol, now_ts="2026-04-12T12:00:00+00:00")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_fires_on_strong_conditions() -> None:
    journal = FakeJournal()
    daemon = _make_daemon(
        latest_predictions={"BTC": _fresh_predictions()},
        journal=journal,
    )
    trig = _default_trigger()

    result = trig.evaluate(_ctx(daemon))

    assert isinstance(result, EntrySignal)
    assert result.symbol == "BTC"
    assert result.side == "long"
    assert result.trade_type == "macro"
    assert result.trigger_source == "ml_signal_driven"
    assert result.trigger_type == "composite_score_plus_direction"
    assert result.trigger_detail["composite_score"] == 70.0
    assert result.trigger_detail["vol_regime"] == "normal"
    assert result.trigger_detail["entry_quality_pctl"] == 80
    # conviction = max(|8.0|, |-2.0|) / 10.0 = 0.8
    assert result.conviction == pytest.approx(0.8)
    assert result.ml_snapshot_ref["direction_signal"] == "long"
    # No rejection row written on the fire path.
    assert journal.calls == []


def test_rejects_on_circuit_breaker() -> None:
    journal = FakeJournal()
    daemon = _make_daemon(
        trading_paused=True,
        latest_predictions={"BTC": _fresh_predictions()},
        journal=journal,
    )
    trig = _default_trigger()

    result = trig.evaluate(_ctx(daemon))

    assert result is None
    assert len(journal.calls) == 1
    assert journal.calls[0]["rejection_reason"] == "circuit_breaker_active"


def test_rejects_on_existing_position() -> None:
    journal = FakeJournal()
    daemon = _make_daemon(
        prev_positions={"BTC": {"size": 1.0, "side": "long"}},
        latest_predictions={"BTC": _fresh_predictions()},
        journal=journal,
    )
    trig = _default_trigger()

    result = trig.evaluate(_ctx(daemon))

    assert result is None
    assert len(journal.calls) == 1
    assert journal.calls[0]["rejection_reason"] == "already_has_position"


def test_rejects_on_missing_predictions() -> None:
    journal = FakeJournal()
    daemon = _make_daemon(latest_predictions={}, journal=journal)
    trig = _default_trigger()

    result = trig.evaluate(_ctx(daemon))

    assert result is None
    assert len(journal.calls) == 1
    assert journal.calls[0]["rejection_reason"] == "no_ml_predictions"


def test_rejects_on_stale_predictions() -> None:
    journal = FakeJournal()
    stale_ts = time.time() - 700  # 700 s old → > 600 s threshold
    daemon = _make_daemon(
        latest_predictions={"BTC": _fresh_predictions(ts=stale_ts)},
        journal=journal,
    )
    trig = _default_trigger()

    result = trig.evaluate(_ctx(daemon))

    assert result is None
    assert len(journal.calls) == 1
    assert journal.calls[0]["rejection_reason"] == "ml_predictions_stale"


def test_rejects_on_low_composite() -> None:
    journal = FakeJournal()
    daemon = _make_daemon(
        latest_predictions={"BTC": _fresh_predictions(entry_score=40.0)},
        journal=journal,
    )
    trig = _default_trigger()

    result = trig.evaluate(_ctx(daemon))

    assert result is None
    assert len(journal.calls) == 1
    call = journal.calls[0]
    assert call["rejection_reason"] == "composite_below_threshold"
    # The detail dict isn't persisted on the row, but the trigger_type mirrors the reason.
    assert call["trigger_type"] == "composite_below_threshold"


@pytest.mark.parametrize("signal", [None, "skip", "conflict", "nonsense"])
def test_rejects_on_missing_direction_signal(signal: str | None) -> None:
    journal = FakeJournal()
    preds = _fresh_predictions()
    if signal is None:
        preds.pop("signal")
    else:
        preds["signal"] = signal
    daemon = _make_daemon(latest_predictions={"BTC": preds}, journal=journal)
    trig = _default_trigger()

    result = trig.evaluate(_ctx(daemon))

    assert result is None
    assert len(journal.calls) == 1
    assert journal.calls[0]["rejection_reason"] == "no_direction_signal"


def test_rejects_on_low_direction_confidence() -> None:
    journal = FakeJournal()
    # long_roe=1.0, short_roe=-1.0 → conviction = 0.1 < threshold 0.5
    daemon = _make_daemon(
        latest_predictions={
            "BTC": _fresh_predictions(long_roe=1.0, short_roe=-1.0),
        },
        journal=journal,
    )
    trig = _default_trigger()

    result = trig.evaluate(_ctx(daemon))

    assert result is None
    assert len(journal.calls) == 1
    assert journal.calls[0]["rejection_reason"] == "direction_confidence_below_threshold"


def test_rejects_on_low_entry_quality() -> None:
    journal = FakeJournal()
    daemon = _make_daemon(
        latest_predictions={"BTC": _fresh_predictions(eq_pctl=50)},  # < threshold 70
        journal=journal,
    )
    trig = _default_trigger()

    result = trig.evaluate(_ctx(daemon))

    assert result is None
    assert len(journal.calls) == 1
    assert journal.calls[0]["rejection_reason"] == "entry_quality_below_threshold"


def test_rejects_on_extreme_vol_when_max_is_high() -> None:
    journal = FakeJournal()
    daemon = _make_daemon(
        latest_predictions={"BTC": _fresh_predictions(vol_regime="extreme")},
        journal=journal,
    )
    trig = _default_trigger()  # max_vol_regime="high"

    result = trig.evaluate(_ctx(daemon))

    assert result is None
    assert len(journal.calls) == 1
    assert journal.calls[0]["rejection_reason"] == "vol_regime_above_max"


def test_rejection_writes_to_journal() -> None:
    journal = FakeJournal()
    daemon = _make_daemon(trading_paused=True, journal=journal)
    trig = _default_trigger()

    result = trig.evaluate(_ctx(daemon))

    assert result is None
    assert len(journal.calls) == 1
    call = journal.calls[0]
    assert call["trade_id"].startswith("rej_")
    assert len(call["trade_id"]) == len("rej_") + 16
    assert call["status"] == "rejected"
    assert call["rejection_reason"] == "circuit_breaker_active"
    assert call["trigger_source"] == "ml_signal_driven"
    assert call["trigger_type"] == "circuit_breaker_active"
    assert call["side"] == "none"
    assert call["trade_type"] == "macro"
    assert call["symbol"] == "BTC"
    assert call["entry_ts"] == "2026-04-12T12:00:00+00:00"


def test_rejection_no_journal_is_silent() -> None:
    daemon = _make_daemon(trading_paused=True, journal=None)
    trig = _default_trigger()

    # Must not raise, must return None.
    result = trig.evaluate(_ctx(daemon))
    assert result is None


def test_name_returns_ml_signal_driven() -> None:
    trig = _default_trigger()
    assert trig.name() == "ml_signal_driven"


def test_symbol_uppercased_in_rejection() -> None:
    journal = FakeJournal()
    daemon = _make_daemon(trading_paused=True, journal=journal)
    trig = _default_trigger()

    result = trig.evaluate(_ctx(daemon, symbol="btc"))

    assert result is None
    assert len(journal.calls) == 1
    assert journal.calls[0]["symbol"] == "BTC"
