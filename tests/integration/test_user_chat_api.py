"""FastAPI integration tests for ``/api/v2/chat`` (v2 phase 5 M6).

Uses ``fastapi.testclient.TestClient`` against a bare app with only the
chat router mounted. The agent is a stub that simply echoes the message —
no real LLM or journal store is instantiated here.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hynous.user_chat.api import router as user_chat_router
from hynous.user_chat.api import set_agent


class _StubAgent:
    """Minimal agent stand-in — ducks :class:`UserChatAgent`."""

    def __init__(self) -> None:
        # Mirror the attribute shape the health endpoint reads.
        self._config = type(
            "_Cfg", (), {"model": "stub-model", "enabled": True},
        )()
        self.calls: list[str] = []

    @property
    def tool_names(self) -> list[str]:
        return ["search_trades", "get_trade_by_id"]

    def chat(self, message: str) -> str:
        self.calls.append(message)
        return f"echo: {message}"


@pytest.fixture
def client() -> TestClient:
    """Fresh FastAPI app + stub agent, reset between tests."""
    app = FastAPI()
    app.include_router(user_chat_router)
    agent = _StubAgent()
    set_agent(agent)
    try:
        tc = TestClient(app)
        tc.agent = agent  # type: ignore[attr-defined]
        yield tc
    finally:
        set_agent(None)  # type: ignore[arg-type]


def test_post_message_happy_path(client: TestClient) -> None:
    """POST /message returns a 200 with the stubbed reply + agent was called."""
    resp = client.post("/api/v2/chat/message", json={"message": "hi"})
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"reply": "echo: hi"}
    assert client.agent.calls == ["hi"]  # type: ignore[attr-defined]


def test_get_health_returns_200_when_agent_wired(client: TestClient) -> None:
    """Health endpoint returns status + model + tool surface."""
    resp = client.get("/api/v2/chat/health")
    assert resp.status_code == 200
    payload: dict[str, Any] = resp.json()
    assert payload["status"] == "ok"
    assert payload["model"] == "stub-model"
    assert payload["enabled"] is True
    assert set(payload["tools"]) == {"search_trades", "get_trade_by_id"}
