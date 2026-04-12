"""Unit tests for hynous.mechanical_entry.interface.

Three tests:
1. EntrySignal dataclass fields + slots behavior
2. EntryEvaluationContext defaults
3. EntryTriggerSource ABC enforcement
"""

from __future__ import annotations

import pytest

from hynous.mechanical_entry.interface import (
    EntryEvaluationContext,
    EntrySignal,
    EntryTriggerSource,
)


def test_entry_signal_dataclass_fields() -> None:
    sig = EntrySignal(
        symbol="BTC",
        side="long",
        trade_type="macro",
        conviction=0.72,
        trigger_source="ml_signal_driven",
        trigger_type="composite_score_plus_direction",
        trigger_detail={"composite_score": 62.5, "vol_regime": "normal"},
        ml_snapshot_ref={"composite_entry_score": 62.5, "direction_signal": "long"},
        expires_at=None,
    )

    assert sig.symbol == "BTC"
    assert sig.side == "long"
    assert sig.trade_type == "macro"
    assert sig.conviction == 0.72
    assert sig.trigger_source == "ml_signal_driven"
    assert sig.trigger_type == "composite_score_plus_direction"
    assert sig.trigger_detail == {"composite_score": 62.5, "vol_regime": "normal"}
    assert sig.ml_snapshot_ref == {
        "composite_entry_score": 62.5,
        "direction_signal": "long",
    }
    assert sig.expires_at is None

    # slots: __slots__ must be defined, and arbitrary attrs must not be settable.
    assert hasattr(EntrySignal, "__slots__")
    with pytest.raises(AttributeError):
        sig.bogus_attr = 1  # type: ignore[attr-defined]


def test_entry_evaluation_context_defaults() -> None:
    daemon_obj = object()
    ctx = EntryEvaluationContext(daemon=daemon_obj, symbol="BTC")

    assert ctx.daemon is daemon_obj
    assert ctx.symbol == "BTC"
    assert ctx.scanner_anomaly is None
    assert ctx.now_ts == ""


def test_entry_trigger_source_abstract() -> None:
    with pytest.raises(TypeError):
        EntryTriggerSource()  # type: ignore[abstract]

    class Concrete(EntryTriggerSource):
        def evaluate(self, ctx: EntryEvaluationContext) -> EntrySignal | None:
            return None

        def name(self) -> str:
            return "test"

    inst = Concrete()
    assert inst.name() == "test"
    assert inst.evaluate(EntryEvaluationContext(daemon=None, symbol="BTC")) is None
