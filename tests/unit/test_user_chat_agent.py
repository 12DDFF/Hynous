"""Unit tests for :class:`hynous.user_chat.agent.UserChatAgent` (phase 5 M6).

Mirrors ``test_v2_analysis.py``: a stub ``litellm`` module is installed in
``sys.modules`` so ``monkeypatch.setattr("litellm.completion", ...)``
works even when the real package isn't available. The agent resolves
``litellm`` lazily inside ``_call_llm``, so per-test patches win.
"""

from __future__ import annotations

import json
import sys
import types
from types import SimpleNamespace
from typing import Any

import pytest

# Ensure a ``litellm`` module is importable for monkeypatch targets, same
# pattern used by ``test_v2_analysis.py``.
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception  # type: ignore[attr-defined]

from hynous.core.config import V2UserChatConfig
from hynous.user_chat.agent import UserChatAgent


class _StubStore:
    """Records calls to list_trades / get_trade."""

    def __init__(self) -> None:
        self.list_calls: list[dict[str, Any]] = []
        self.get_calls: list[str] = []

    def list_trades(self, **kwargs: Any) -> list[dict[str, Any]]:
        self.list_calls.append(kwargs)
        return [{
            "trade_id": "t_1", "symbol": "BTC", "side": "long",
            "status": "closed", "entry_ts": "2026-04-01T00:00:00Z",
            "exit_ts": "2026-04-01T01:00:00Z", "realized_pnl_usd": 10.0,
            "roe_pct": 1.0, "exit_classification": "take_profit",
            "rejection_reason": None,
        }]

    def get_trade(self, trade_id: str) -> dict[str, Any] | None:
        self.get_calls.append(trade_id)
        return None


def _fake_response(*, content: str | None = None, tool_calls: list[Any] | None = None) -> Any:
    """Build a litellm-like response object (SimpleNamespace)."""
    msg = SimpleNamespace(content=content, tool_calls=tool_calls)
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def _tool_call(*, call_id: str, name: str, args: dict[str, Any]) -> SimpleNamespace:
    """Build a litellm-like tool_call object."""
    return SimpleNamespace(
        id=call_id,
        function=SimpleNamespace(name=name, arguments=json.dumps(args)),
    )


def _config(**overrides: Any) -> V2UserChatConfig:
    base = dict(
        enabled=True,
        model="openrouter/anthropic/claude-opus-4",
        max_tokens=512,
        temperature=0.2,
        tool_timeout_s=5,
    )
    base.update(overrides)
    return V2UserChatConfig(**base)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_agent_init_from_config() -> None:
    """Constructor wires the tool surface + preserves the restricted tool list."""
    agent = UserChatAgent(config=_config(), journal_store=_StubStore())
    assert set(agent.tool_names) == {"search_trades", "get_trade_by_id"}
    # Internal tools-for-LLM shape is OpenAI-function-tool format.
    tools = agent._tools_for_llm()
    assert all(t["type"] == "function" for t in tools)
    assert {t["function"]["name"] for t in tools} == {"search_trades", "get_trade_by_id"}


def test_tool_dispatch_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """Model requests search_trades → agent dispatches + feeds back result."""
    store = _StubStore()
    agent = UserChatAgent(config=_config(), journal_store=store)

    calls: list[Any] = []

    def fake_completion(**kwargs: Any) -> Any:
        calls.append(kwargs)
        if len(calls) == 1:
            return _fake_response(tool_calls=[
                _tool_call(call_id="c1", name="search_trades", args={"symbol": "BTC"}),
            ])
        return _fake_response(content="Found 1 BTC trade.")

    monkeypatch.setattr("litellm.completion", fake_completion, raising=False)

    reply = agent.chat("show me BTC trades")
    assert reply == "Found 1 BTC trade."
    # Store was actually called with symbol filter.
    assert len(store.list_calls) == 1
    assert store.list_calls[0]["symbol"] == "BTC"
    # Two LLM calls: initial + post-tool-result.
    assert len(calls) == 2
    # Second call includes the tool-result message in messages.
    msgs = calls[1]["messages"]
    tool_msgs = [m for m in msgs if m.get("role") == "tool"]
    assert len(tool_msgs) == 1
    assert tool_msgs[0]["tool_call_id"] == "c1"


def test_tool_timeout_returns_error_string_to_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """When a dispatcher takes too long, the model gets an error message back."""
    # Replace the dispatcher with a slow one via a custom store.
    import time

    class _SlowStore(_StubStore):
        def list_trades(self, **kwargs: Any) -> list[dict[str, Any]]:
            time.sleep(0.5)
            return []

    agent = UserChatAgent(
        config=_config(tool_timeout_s=0),  # timeout of 0s forces expiry
        journal_store=_SlowStore(),
    )

    captured_tool_content: list[str] = []

    def fake_completion(**kwargs: Any) -> Any:
        # On second call, record the tool-result content then answer.
        msgs = kwargs["messages"]
        tool_msgs = [m for m in msgs if m.get("role") == "tool"]
        if tool_msgs:
            captured_tool_content.append(tool_msgs[-1]["content"])
            return _fake_response(content="Handled the timeout.")
        return _fake_response(tool_calls=[
            _tool_call(call_id="c1", name="search_trades", args={}),
        ])

    monkeypatch.setattr("litellm.completion", fake_completion, raising=False)

    reply = agent.chat("go")
    assert reply == "Handled the timeout."
    assert len(captured_tool_content) == 1
    payload = json.loads(captured_tool_content[0])
    assert payload["error"] == "tool_timeout"
    assert payload["tool"] == "search_trades"


def test_unknown_tool_name_handled_gracefully(monkeypatch: pytest.MonkeyPatch) -> None:
    """Model invoking an unregistered tool gets an ``unknown_tool`` error back."""
    agent = UserChatAgent(config=_config(), journal_store=_StubStore())

    captured: list[str] = []

    def fake_completion(**kwargs: Any) -> Any:
        msgs = kwargs["messages"]
        tool_msgs = [m for m in msgs if m.get("role") == "tool"]
        if tool_msgs:
            captured.append(tool_msgs[-1]["content"])
            return _fake_response(content="ok")
        return _fake_response(tool_calls=[
            _tool_call(call_id="c1", name="execute_trade", args={}),
        ])

    monkeypatch.setattr("litellm.completion", fake_completion, raising=False)

    reply = agent.chat("execute a trade for me")
    assert reply == "ok"
    assert len(captured) == 1
    payload = json.loads(captured[0])
    assert payload["error"] == "unknown_tool"
    assert payload["tool"] == "execute_trade"


def test_trade_execution_tools_not_in_surface() -> None:
    """Negative assertion: user chat agent never exposes execute/close/modify."""
    agent = UserChatAgent(config=_config(), journal_store=_StubStore())
    names = set(agent.tool_names)
    for forbidden in (
        "execute_trade", "close_position", "modify_position",
        "get_account", "store_memory", "recall_memory",
    ):
        assert forbidden not in names
    # Sanity — tool defs list matches dispatcher.
    defs = {td["name"] for td in agent._tool_defs}
    assert defs == names
