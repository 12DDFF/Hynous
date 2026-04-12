"""Unit tests for the ``search_trades`` journal tool (v2 phase 5 M6)."""

from __future__ import annotations

from typing import Any

from hynous.intelligence.tools.search_trades import (
    _DEFAULT_LIMIT,
    _MAX_LIMIT,
    handle_search_trades,
)


class _FakeStore:
    """Minimal JournalStore double — records list_trades kwargs + returns rows."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self.last_kwargs: dict[str, Any] | None = None

    def list_trades(self, **kwargs: Any) -> list[dict[str, Any]]:
        self.last_kwargs = kwargs
        # Simulate per-filter behaviour for the symbol/status assertions.
        rows = list(self._rows)
        if kwargs.get("symbol") is not None:
            rows = [r for r in rows if r.get("symbol") == kwargs["symbol"]]
        if kwargs.get("status") is not None:
            rows = [r for r in rows if r.get("status") == kwargs["status"]]
        limit = kwargs.get("limit") or len(rows)
        offset = kwargs.get("offset") or 0
        return rows[offset : offset + limit]


def _row(**overrides: Any) -> dict[str, Any]:
    base = {
        "trade_id": "t_1",
        "symbol": "BTC",
        "side": "long",
        "status": "closed",
        "entry_ts": "2026-04-01T00:00:00Z",
        "exit_ts": "2026-04-01T01:00:00Z",
        "realized_pnl_usd": 12.5,
        "roe_pct": 2.5,
        "exit_classification": "take_profit",
        "rejection_reason": None,
        "leverage": 20,            # dropped in summary
        "size_usd": 1000.0,        # dropped in summary
    }
    base.update(overrides)
    return base


def test_filter_by_symbol_returns_only_matching_rows() -> None:
    store = _FakeStore([
        _row(trade_id="t_a", symbol="BTC"),
        _row(trade_id="t_b", symbol="ETH"),
        _row(trade_id="t_c", symbol="BTC"),
    ])
    result = handle_search_trades(store=store, symbol="BTC")
    assert store.last_kwargs is not None
    assert store.last_kwargs["symbol"] == "BTC"
    assert [r["trade_id"] for r in result] == ["t_a", "t_c"]
    # Summary projection drops non-summary fields.
    assert "leverage" not in result[0]
    assert "size_usd" not in result[0]
    assert set(result[0].keys()) >= {
        "trade_id", "symbol", "side", "status", "entry_ts", "exit_ts",
        "realized_pnl_usd", "roe_pct", "exit_classification", "rejection_reason",
    }


def test_filter_by_status_passes_through_to_store() -> None:
    store = _FakeStore([
        _row(trade_id="t_a", status="rejected", rejection_reason="stale_predictions"),
        _row(trade_id="t_b", status="closed"),
    ])
    result = handle_search_trades(store=store, status="rejected")
    assert store.last_kwargs["status"] == "rejected"
    assert len(result) == 1
    assert result[0]["trade_id"] == "t_a"
    assert result[0]["rejection_reason"] == "stale_predictions"


def test_limit_cap_is_enforced_at_max() -> None:
    store = _FakeStore([_row(trade_id=f"t_{i}") for i in range(200)])
    # Caller asks for 500; tool clamps to _MAX_LIMIT.
    handle_search_trades(store=store, limit=500)
    assert store.last_kwargs["limit"] == _MAX_LIMIT
    # Default when unspecified.
    handle_search_trades(store=store)
    assert store.last_kwargs["limit"] == _DEFAULT_LIMIT
    # Zero / negative collapses to default.
    handle_search_trades(store=store, limit=0)
    assert store.last_kwargs["limit"] == _DEFAULT_LIMIT


def test_empty_result_returns_empty_list() -> None:
    store = _FakeStore([])
    result = handle_search_trades(store=store, symbol="DOGE")
    assert result == []
