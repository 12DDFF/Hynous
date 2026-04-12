"""FastAPI routes for the v2 user chat agent (``/api/v2/chat/*``).

Mirrors :mod:`hynous.journal.api`: a module-level singleton is injected
at dashboard startup via :func:`set_agent`; routes 503 out until that
happens so a misconfigured startup fails loudly instead of silently
serving an empty surface.

Routes:
    GET  /api/v2/chat/health       — liveness probe.
    POST /api/v2/chat/message      — ``{"message": str}`` → ``{"reply": str}``.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .agent import UserChatAgent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v2/chat", tags=["user-chat"])

_agent: UserChatAgent | None = None


def set_agent(agent: UserChatAgent) -> None:
    """Inject the chat agent singleton. Called once at app startup."""
    global _agent
    _agent = agent


def _require_agent() -> UserChatAgent:
    """Lookup helper — routes 503 until :func:`set_agent` has been called."""
    if _agent is None:
        raise HTTPException(
            status_code=503,
            detail="User chat agent not initialized",
        )
    return _agent


class ChatMessageRequest(BaseModel):
    """Request body for ``POST /message``."""

    message: str = Field(..., min_length=1, max_length=8000)


class ChatMessageResponse(BaseModel):
    """Response body for ``POST /message``."""

    reply: str


@router.get("/health")
def health_endpoint() -> dict[str, Any]:
    """Liveness probe. 200 if agent is wired + model configured, 503 else."""
    agent = _require_agent()
    return {
        "status": "ok",
        "model": agent._config.model,
        "enabled": agent._config.enabled,
        "tools": agent.tool_names,
    }


@router.post("/message", response_model=ChatMessageResponse)
def post_message_endpoint(body: ChatMessageRequest) -> ChatMessageResponse:
    """Synchronous chat turn. 60s hard ceiling is caller's responsibility.

    The agent's internal tool-loop already caps iterations + per-tool
    time. If the LLM call itself hangs, the HTTP layer will time out —
    uvicorn's default keep-alive handles that upstream.
    """
    agent = _require_agent()
    try:
        reply = agent.chat(body.message)
    except RuntimeError as exc:
        logger.exception("user_chat: chat() raised")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ChatMessageResponse(reply=reply)
