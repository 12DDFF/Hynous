"""Lightweight LLM wrapper for the v2 dashboard chat surface (phase 5 M6).

One request/response cycle per HTTP call. No streaming, no conversation
history, no memory writes. Exposes two journal-backed tools
(``search_trades``, ``get_trade_by_id``) bound to a caller-supplied
:class:`~hynous.journal.store.JournalStore`. Contrast with the retired v1
intelligence agent — no queue mode, no Nous, no persistence, no tracing,
no curiosity/review/coach wiring.

Hard cap: 300 LOC in this file. Grow via directive only.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from hynous.core.config import V2UserChatConfig
from hynous.intelligence.tools.get_trade_by_id import (
    TOOL_DEF as GET_TRADE_TOOL_DEF,
)
from hynous.intelligence.tools.get_trade_by_id import (
    handle_get_trade_by_id,
)
from hynous.intelligence.tools.search_trades import (
    TOOL_DEF as SEARCH_TRADES_TOOL_DEF,
)
from hynous.intelligence.tools.search_trades import (
    handle_search_trades,
)
from hynous.journal.store import JournalStore

from .prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)

# Cap the outer tool loop. Well-behaved responses resolve in 1-3 iters.
_MAX_TOOL_ITERATIONS = 6


@dataclass(frozen=True)
class _ToolResult:
    """Dispatcher result — ``content`` is always a JSON-serializable string."""

    content: str
    is_error: bool = False


class UserChatAgent:
    """Read-only journal analyst for the dashboard chat page.

    Construct with a :class:`V2UserChatConfig` + :class:`JournalStore`.
    Call :meth:`chat` once per user turn — each call is independent.
    """

    def __init__(
        self,
        *,
        config: V2UserChatConfig,
        journal_store: JournalStore,
    ) -> None:
        self._config = config
        self._journal_store = journal_store

        self._tool_defs: list[dict[str, Any]] = [
            SEARCH_TRADES_TOOL_DEF,
            GET_TRADE_TOOL_DEF,
        ]
        self._tool_dispatch: dict[str, Any] = {
            "search_trades": self._wrap_tool("search_trades", handle_search_trades),
            "get_trade_by_id": self._wrap_tool("get_trade_by_id", handle_get_trade_by_id),
        }

    # ------------------------------------------------------------------
    # Tool surface
    # ------------------------------------------------------------------

    def _wrap_tool(self, name: str, fn: Any) -> Any:
        """Bind ``store=`` into a tool handler."""
        store = self._journal_store

        def _call(**kwargs: Any) -> Any:
            return fn(store=store, **kwargs)

        _call.__name__ = f"bound_{name}"
        return _call

    @property
    def tool_names(self) -> list[str]:
        """Restricted tool surface exposed to the LLM (used by tests)."""
        return list(self._tool_dispatch.keys())

    def _tools_for_llm(self) -> list[dict[str, Any]]:
        """OpenAI/LiteLLM function-tool format."""
        return [
            {
                "type": "function",
                "function": {
                    "name": td["name"],
                    "description": td["description"],
                    "parameters": td["parameters"],
                },
            }
            for td in self._tool_defs
        ]

    # ------------------------------------------------------------------
    # Chat entry point
    # ------------------------------------------------------------------

    def chat(self, message: str) -> str:
        """Run one tool-loop for ``message`` and return the final reply."""
        if not self._config.enabled:
            return (
                "User chat is disabled in configuration "
                "(v2.user_chat.enabled = false)."
            )

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": message},
        ]

        for _ in range(_MAX_TOOL_ITERATIONS):
            response = self._call_llm(messages)
            choice = response.choices[0].message
            tool_calls = list(getattr(choice, "tool_calls", None) or [])

            if not tool_calls:
                return (choice.content or "").strip()

            messages.append(self._assistant_msg_from(choice, tool_calls))

            for tc in tool_calls:
                result = self._run_tool_call(tc)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": tc.function.name,
                    "content": result.content,
                })

        logger.warning(
            "user_chat: tool loop hit %d-iteration cap", _MAX_TOOL_ITERATIONS,
        )
        return (
            "I wasn't able to finish within the tool-call budget. "
            "Try a more specific question."
        )

    # ------------------------------------------------------------------
    # LLM + tool plumbing
    # ------------------------------------------------------------------

    def _call_llm(self, messages: list[dict[str, Any]]) -> Any:
        """One litellm.completion call. Lazy-imported for test monkeypatch."""
        import litellm  # noqa: PLC0415 — mirrors analysis/llm_pipeline.py

        try:
            return litellm.completion(
                model=self._config.model,
                messages=messages,
                max_tokens=self._config.max_tokens,
                temperature=self._config.temperature,
                tools=self._tools_for_llm(),
            )
        except Exception as exc:
            logger.exception("user_chat LLM call failed")
            raise RuntimeError(f"LLM call failed: {exc}") from exc

    @staticmethod
    def _assistant_msg_from(choice: Any, tool_calls: list[Any]) -> dict[str, Any]:
        """Round-trip the assistant turn with tool_calls preserved."""
        return {
            "role": "assistant",
            "content": choice.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": (
                            tc.function.arguments
                            if isinstance(tc.function.arguments, str)
                            else json.dumps(tc.function.arguments)
                        ),
                    },
                }
                for tc in tool_calls
            ],
        }

    def _run_tool_call(self, tc: Any) -> _ToolResult:
        """Execute one tool call under a timeout, serialize result to JSON."""
        name = tc.function.name
        dispatcher = self._tool_dispatch.get(name)
        if dispatcher is None:
            logger.warning("user_chat: model requested unknown tool %r", name)
            return _ToolResult(
                content=json.dumps({"error": "unknown_tool", "tool": name}),
                is_error=True,
            )

        try:
            args = (
                json.loads(tc.function.arguments)
                if isinstance(tc.function.arguments, str)
                else (tc.function.arguments or {})
            )
        except json.JSONDecodeError as exc:
            return _ToolResult(
                content=json.dumps({"error": "bad_arguments", "detail": str(exc)}),
                is_error=True,
            )

        try:
            result = _run_with_timeout(
                lambda: dispatcher(**args),
                timeout_s=self._config.tool_timeout_s,
            )
        except TimeoutError:
            return _ToolResult(
                content=json.dumps({
                    "error": "tool_timeout",
                    "tool": name,
                    "timeout_s": self._config.tool_timeout_s,
                }),
                is_error=True,
            )
        except Exception as exc:
            logger.exception("user_chat: tool %s raised", name)
            return _ToolResult(
                content=json.dumps({
                    "error": "tool_exception",
                    "tool": name,
                    "detail": str(exc),
                }),
                is_error=True,
            )

        try:
            serialized = json.dumps(result, default=str)
        except (TypeError, ValueError):
            serialized = json.dumps({"result": str(result)})
        return _ToolResult(content=serialized)


def _run_with_timeout(fn: Any, *, timeout_s: int) -> Any:
    """Execute ``fn()`` and raise :class:`TimeoutError` past ``timeout_s``.

    Short-lived daemon thread so the timeout is cross-platform. If the
    call genuinely hangs the thread is abandoned; Python can still exit.
    """
    import threading

    box: dict[str, Any] = {}

    def _worker() -> None:
        try:
            box["result"] = fn()
        except BaseException as exc:  # noqa: BLE001 — re-raised below
            box["error"] = exc

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()
    thread.join(timeout=timeout_s)

    if thread.is_alive():
        raise TimeoutError(f"tool call exceeded {timeout_s}s")
    if "error" in box:
        raise box["error"]
    return box.get("result")
