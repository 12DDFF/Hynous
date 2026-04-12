"""Unit tests for the ``get_trade_by_id`` journal tool (v2 phase 5 M6)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from hynous.intelligence.tools.get_trade_by_id import handle_get_trade_by_id


@dataclass
class _FakeEntrySnapshot:
    """Stand-in dataclass — proves asdict flattening works on snapshots."""

    trade_id: str
    side: str
    entry_px: float


class _FakeStore:
    """Minimal JournalStore double."""

    def __init__(self, bundle: dict[str, Any] | None) -> None:
        self._bundle = bundle
        self.requested: str | None = None

    def get_trade(self, trade_id: str) -> dict[str, Any] | None:
        self.requested = trade_id
        return self._bundle


def test_hit_returns_full_bundle() -> None:
    bundle = {
        "trade_id": "t_1",
        "symbol": "BTC",
        "side": "long",
        "status": "closed",
        "entry_snapshot": None,
        "exit_snapshot": None,
        "events": [{"id": 1, "event_type": "fill", "payload": {}}],
        "analysis": None,
        "tags": [],
    }
    store = _FakeStore(bundle)
    result = handle_get_trade_by_id(store=store, trade_id="t_1")
    assert store.requested == "t_1"
    assert result["trade_id"] == "t_1"
    assert "events" in result
    assert "error" not in result


def test_miss_returns_error_shape() -> None:
    store = _FakeStore(None)
    result = handle_get_trade_by_id(store=store, trade_id="t_missing")
    assert result == {"error": "trade_not_found", "trade_id": "t_missing"}


def test_dataclass_snapshots_are_flattened_to_dicts() -> None:
    snap = _FakeEntrySnapshot(trade_id="t_2", side="short", entry_px=100.5)
    bundle = {
        "trade_id": "t_2",
        "entry_snapshot": snap,
        "exit_snapshot": None,
        "events": [],
        "tags": [],
        "analysis": None,
    }
    store = _FakeStore(bundle)
    result = handle_get_trade_by_id(store=store, trade_id="t_2")
    # Dataclass gone; dict in its place.
    assert isinstance(result["entry_snapshot"], dict)
    assert result["entry_snapshot"] == {
        "trade_id": "t_2",
        "side": "short",
        "entry_px": 100.5,
    }
