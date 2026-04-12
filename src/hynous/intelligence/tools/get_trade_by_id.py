"""
Get Trade By ID Tool — get_trade_by_id (v2 phase 5 M6)

Wraps :meth:`hynous.journal.store.JournalStore.get_trade` and flattens the
dataclass-valued ``entry_snapshot`` / ``exit_snapshot`` fields to plain
dicts so the LLM sees a JSON-friendly bundle. On miss, returns a structured
``{"error": "trade_not_found"}`` payload rather than raising.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, is_dataclass
from typing import Any

logger = logging.getLogger(__name__)


TOOL_DEF = {
    "name": "get_trade_by_id",
    "description": (
        "Fetch the full hydrated bundle for a single trade by its trade_id: "
        "top-level row + entry_snapshot + exit_snapshot + counterfactuals + "
        "lifecycle events + LLM analysis (if present) + tags. Dataclass-"
        "valued snapshots are flattened to plain JSON. On miss returns "
        "{\"error\": \"trade_not_found\", \"trade_id\": ...}. Follow "
        "search_trades to discover trade_ids."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "trade_id": {
                "type": "string",
                "description": "Trade primary key (e.g. t_20260412_abc1234)",
            },
        },
        "required": ["trade_id"],
    },
}


def _flatten_dataclasses(bundle: dict[str, Any]) -> dict[str, Any]:
    """Flatten dataclass-valued keys in a ``get_trade`` bundle to dicts.

    ``JournalStore.get_trade`` hydrates ``entry_snapshot`` and
    ``exit_snapshot`` into :class:`TradeEntrySnapshot` /
    :class:`TradeExitSnapshot` dataclasses. The LLM only sees JSON — so we
    convert with :func:`dataclasses.asdict`. All other keys (counterfactuals,
    events, analysis, tags) are already plain Python containers.
    """
    flat: dict[str, Any] = dict(bundle)
    for key in ("entry_snapshot", "exit_snapshot"):
        val = flat.get(key)
        if is_dataclass(val) and not isinstance(val, type):
            flat[key] = asdict(val)
    return flat


def handle_get_trade_by_id(
    *,
    store: Any,
    trade_id: str,
) -> dict[str, Any]:
    """Return the flattened trade bundle or a structured miss marker."""
    if not trade_id:
        return {"error": "missing_trade_id", "trade_id": trade_id}

    bundle = store.get_trade(trade_id)
    if bundle is None:
        return {"error": "trade_not_found", "trade_id": trade_id}
    return _flatten_dataclasses(bundle)


def register(registry: Any) -> None:
    """Register the get_trade_by_id tool (store injected at call time)."""
    from .registry import Tool

    def _handler(**kwargs: Any) -> dict[str, Any]:
        store = kwargs.pop("store", None)
        if store is None:
            raise RuntimeError(
                "get_trade_by_id requires a journal store; call via the "
                "user chat agent's bound dispatcher.",
            )
        return handle_get_trade_by_id(store=store, **kwargs)

    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=_handler,
    ))
