"""v2 user chat agent — dashboard-only LLM wrapper (phase 5 M6).

The :class:`UserChatAgent` is a read-only analyst that queries the v2
journal on behalf of the operator. It has no trade-execution surface and
no memory-write surface; the tool list is restricted to ``search_trades``
and ``get_trade_by_id`` at construction time.

The FastAPI routes live in :mod:`hynous.user_chat.api` and mount at
``/api/v2/chat`` in :mod:`dashboard.dashboard`.
"""

from .agent import UserChatAgent

__all__ = ["UserChatAgent"]
