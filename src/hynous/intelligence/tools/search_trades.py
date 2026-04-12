"""
Search Trades Tool — search_trades (v2 phase 5 M6)

Wraps :meth:`hynous.journal.store.JournalStore.list_trades` so the v2 user
chat agent can query the journal without touching raw SQL. Returns compact
row summaries (no snapshots, no events) — the user chat agent pulls the
full hydrated bundle via ``get_trade_by_id`` when it needs detail.

Registered in :mod:`hynous.intelligence.tools.registry`. Present in the v1
agent's registry too (shared tool surface), but the v1 agent does NOT call
it today — only the user chat agent's restricted registry does.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_MAX_LIMIT = 100
_DEFAULT_LIMIT = 25

_SUMMARY_FIELDS: tuple[str, ...] = (
    "trade_id",
    "symbol",
    "side",
    "status",
    "entry_ts",
    "exit_ts",
    "realized_pnl_usd",
    "roe_pct",
    "exit_classification",
    "rejection_reason",
)


TOOL_DEF = {
    "name": "search_trades",
    "description": (
        "Search the v2 trade journal. Filter by symbol, status "
        "(open/closed/rejected), exit_classification (stop_loss/take_profit/"
        "trailing_stop/breakeven_stop/dynamic_protective_sl/manual), ISO8601 "
        "since/until timestamps, and limit/offset. Returns compact row "
        "summaries (trade_id, symbol, side, status, entry_ts, exit_ts, "
        "realized_pnl_usd, roe_pct, exit_classification, rejection_reason). "
        "Use get_trade_by_id for the full hydrated bundle on any row of "
        "interest. Default limit 25, hard cap 100."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": "Asset symbol, e.g. BTC, ETH",
            },
            "status": {
                "type": "string",
                "enum": ["open", "closed", "rejected"],
                "description": "Trade lifecycle status",
            },
            "exit_classification": {
                "type": "string",
                "description": "Exit type classification (e.g. stop_loss, take_profit)",
            },
            "since": {
                "type": "string",
                "description": "ISO8601 lower bound on entry_ts",
            },
            "until": {
                "type": "string",
                "description": "ISO8601 upper bound on entry_ts",
            },
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": _MAX_LIMIT,
                "description": f"Max rows to return (default {_DEFAULT_LIMIT}, cap {_MAX_LIMIT})",
            },
            "offset": {
                "type": "integer",
                "minimum": 0,
                "description": "Row offset for pagination (default 0)",
            },
        },
        "required": [],
    },
}


def _compact_row(row: dict[str, Any]) -> dict[str, Any]:
    """Project a trades-table row down to the LLM-facing summary fields."""
    return {key: row.get(key) for key in _SUMMARY_FIELDS}


def handle_search_trades(
    *,
    store: Any,
    symbol: str | None = None,
    status: str | None = None,
    exit_classification: str | None = None,
    since: str | None = None,
    until: str | None = None,
    limit: int = _DEFAULT_LIMIT,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Run the search and return compact summaries.

    ``store`` is a :class:`~hynous.journal.store.JournalStore` instance —
    the user chat agent binds it at construction time and passes it through
    a tool wrapper. The v1 agent would need to inject it similarly if/when
    it registers this tool, but today it does not call search_trades.
    """
    if limit is None or limit <= 0:
        limit = _DEFAULT_LIMIT
    if limit > _MAX_LIMIT:
        limit = _MAX_LIMIT
    if offset is None or offset < 0:
        offset = 0

    rows = store.list_trades(
        symbol=symbol,
        status=status,
        exit_classification=exit_classification,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )
    return [_compact_row(r) for r in rows]


def register(registry: Any) -> None:
    """Register the search_trades tool.

    Handler binding: the store is injected at call time by the user chat
    agent (which supplies ``store=...`` in its tool dispatcher). The
    registry-level handler here raises if called without a store so a
    misrouted call through the v1 agent surfaces loudly instead of
    silently returning empty results.
    """
    from .registry import Tool

    def _handler(**kwargs: Any) -> list[dict[str, Any]]:
        store = kwargs.pop("store", None)
        if store is None:
            raise RuntimeError(
                "search_trades requires a journal store; call via the user "
                "chat agent's bound dispatcher.",
            )
        return handle_search_trades(store=store, **kwargs)

    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=_handler,
    ))
