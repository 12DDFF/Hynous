"""
Hynous Agent

The core reasoning engine. Wraps LiteLLM for multi-provider LLM support
with tool calling. Supports Claude, GPT-4, DeepSeek, etc. via config.
This is the brain — it receives messages, thinks, optionally uses tools,
and responds as Hynous.
"""

import logging
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Generator

import litellm

from .prompts import build_system_prompt
from .memory_manager import MemoryManager
from .tools.registry import ToolRegistry, get_registry
from .tools.memory import enable_queue_mode, disable_queue_mode, flush_memory_queue
from ..core.config import Config, load_config
from ..core.clock import stamp
from ..core import persistence
from ..core.costs import record_llm_usage
from ..core.memory_tracker import get_tracker

logger = logging.getLogger(__name__)

# Max time (seconds) to wait for any single tool to return before giving
# up and sending an error result back to Claude.  Prevents a stuck HTTP
# request (e.g. Coinglass timeout) from blocking the entire conversation.
_TOOL_TIMEOUT = 30

# Max characters per tool result to keep in history for older (already-processed)
# tool results.  ~200 tokens.  The agent already saw the full result and made
# its decision — keeping the full text in subsequent API calls is pure waste.
# Fresh (unseen) tool results are always kept at full fidelity.
_MAX_STALE_RESULT_CHARS = 800


class Agent:
    """LLM-powered agent with Hynous persona and tool access.

    Uses LiteLLM for multi-provider support (Claude, GPT-4, DeepSeek, etc.).
    Provider is selected via the model config string (e.g. "anthropic/claude-sonnet-4-5-20250929").
    """

    def __init__(
        self,
        config: Config | None = None,
        tool_registry: ToolRegistry | None = None,
    ):
        self.config = config or load_config()

        # Set OpenRouter API key — single key for all LLM providers
        if self.config.openrouter_api_key:
            os.environ["OPENROUTER_API_KEY"] = self.config.openrouter_api_key

        self.tools = tool_registry or get_registry()

        # Initialize Hyperliquid provider with config (picks testnet URL + private key)
        from ..data.providers.hyperliquid import get_provider
        provider = get_provider(config=self.config)

        # Build system prompt — live portfolio data comes from [Live State]
        # snapshot injected per-message, not baked into system prompt.
        self.system_prompt = build_system_prompt(
            context={"execution_mode": self.config.execution.mode}
        )

        # Tiered memory manager — retrieval + compression
        self.memory_manager = MemoryManager(
            config=self.config,
        )
        self._active_context: str | None = None

        # Lock to prevent daemon and user chat from interleaving.
        # Both chat() and chat_stream() acquire this.
        # RLock (reentrant) because the daemon acquires the lock in
        # _wake_agent(), then calls chat() which re-acquires from the
        # same thread.  A plain Lock would deadlock.
        self._chat_lock = threading.RLock()

        # Coach tracking — read by Coach after each chat() in daemon wakes
        self._last_tool_calls: list[dict] = []      # Tools called with results in last chat()
        self._last_active_context: str | None = None # Nous context from last chat()

        # Snapshot tracking — cached for daemon coach loop and context retrieval
        self._last_snapshot: str | None = None       # Last built snapshot text
        self._snapshot_symbols: list[str] = []       # Position symbols from last snapshot

        # Load persisted conversation history (survives restarts)
        _, saved_history = persistence.load()
        self._history: list[dict] = (
            self._sanitize_history(saved_history) if saved_history else []
        )
        if self._history:
            logger.info(f"Restored {len(self._history)} history entries from disk")

    # ---- Message building with context injection ----

    def _build_messages(self) -> list[dict]:
        """Build messages array for the API call, injecting recalled context.

        If _active_context is set, creates a shallow copy of _history
        and modifies the last real user message to include context.
        Never mutates _history itself — it stays clean for persistence.

        Context is injected into the LAST user message with string content
        (a real user message, not tool_results). This preserves the
        system prompt cache (context goes in messages, not system).
        """
        if not self._active_context:
            return self._history  # No copy needed

        messages = list(self._history)  # Shallow copy of list

        # Find the last real user message
        for i in range(len(messages) - 1, -1, -1):
            entry = messages[i]
            if entry["role"] == "user" and isinstance(entry.get("content"), str):
                messages[i] = {
                    "role": "user",
                    "content": (
                        "[From your memory — relevant context recalled automatically]\n"
                        f"{self._active_context}\n"
                        "[End of recalled context]\n\n"
                        f"{entry['content']}"
                    ),
                }
                break

        return messages

    def _build_snapshot(self) -> str | None:
        """Build live state snapshot for context injection.

        Returns compact text (~150 tokens) with portfolio, market, and
        memory state, or None if snapshot can't be built.
        Also caches the snapshot and extracts position symbols for
        smarter daemon wake context retrieval.
        """
        try:
            from ..data.providers.hyperliquid import get_provider
            from .daemon import get_active_daemon
            from ..nous.client import get_client
            from .context_snapshot import build_snapshot, extract_symbols

            provider = get_provider()
            daemon = get_active_daemon()
            nous = get_client()
            snapshot = build_snapshot(provider, daemon, nous, self.config)
            if snapshot:
                self._last_snapshot = snapshot
                self._snapshot_symbols = extract_symbols(snapshot)
                return snapshot
            return None
        except Exception as e:
            logger.debug("Snapshot build failed: %s", e)
            return None

    @staticmethod
    def _get_briefing_injection() -> str | None:
        """Get briefing injection — full [Briefing] or delta [Update].

        Returns pre-wrapped text if daemon is running and has data.
        Falls back to None → caller uses basic [Live State] snapshot.
        """
        try:
            from .briefing import get_briefing_injection
            return get_briefing_injection()
        except Exception:
            return None

    def _compact_messages(self) -> list[dict]:
        """Build messages for API with stale tool results and snapshots compacted.

        After the agent processes tool results and responds, those results
        sit in history forever at full size — re-sent on every subsequent
        API call even though the agent already incorporated them.

        This method:
        1. Truncates all STALE tool results to ~200 tokens each
        2. Strips [Live State] snapshot blocks from all but the latest user message

        Returns a modified copy — never mutates _history.
        """
        messages = self._build_messages()

        # Find the last tool result message index
        last_tool_idx = None
        for i in range(len(messages) - 1, -1, -1):
            if messages[i]["role"] == "tool":
                last_tool_idx = i
                break

        compacted = []
        for i, entry in enumerate(messages):
            # Truncate stale tool results (keep fresh ones full)
            if entry["role"] == "tool" and i != last_tool_idx:
                content = entry.get("content", "")
                if len(content) > _MAX_STALE_RESULT_CHARS:
                    content = content[:_MAX_STALE_RESULT_CHARS] + "\n...[truncated, already processed]"
                    compacted.append({**entry, "content": content})
                else:
                    compacted.append(entry)
            else:
                compacted.append(entry)

        # Strip snapshots from all but the last user message with string content.
        # Stale snapshots waste ~150 tokens each on outdated portfolio/market data.
        last_user_idx = None
        for i in range(len(compacted) - 1, -1, -1):
            if compacted[i]["role"] == "user" and isinstance(compacted[i].get("content"), str):
                last_user_idx = i
                break

        for i, entry in enumerate(compacted):
            if (entry["role"] == "user"
                    and isinstance(entry.get("content"), str)
                    and i != last_user_idx):
                content = entry["content"]
                # Strip stale [Live State] blocks
                if "[Live State" in content:
                    end_marker = "[End Live State]\n\n"
                    idx = content.find(end_marker)
                    if idx >= 0:
                        content = content[idx + len(end_marker):]
                # Strip stale [Briefing] blocks
                if "[Briefing" in content:
                    end_marker = "[End Briefing]\n\n"
                    idx = content.find(end_marker)
                    if idx >= 0:
                        content = content[idx + len(end_marker):]
                # Strip stale [Update] blocks
                if "[Update" in content:
                    end_marker = "[End Update]\n\n"
                    idx = content.find(end_marker)
                    if idx >= 0:
                        content = content[idx + len(end_marker):]
                if content != entry["content"]:
                    compacted[i] = {"role": "user", "content": content}

        return compacted

    # ---- API kwargs with prompt caching ----

    def _is_anthropic(self) -> bool:
        """Check if the current model is an Anthropic model (direct or via OpenRouter)."""
        return "anthropic/" in self.config.agent.model

    def _build_system_messages(self) -> list[dict]:
        """Build system message(s) for the API call.

        For Anthropic models, uses cache_control for prompt caching (~90% savings).
        For other providers, uses a plain system message.
        """
        if self._is_anthropic():
            return [{"role": "system", "content": [
                {
                    "type": "text",
                    "text": self.system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ]}]
        return [{"role": "system", "content": self.system_prompt}]

    def _api_kwargs(self) -> dict:
        """Build API kwargs for litellm.completion().

        For Anthropic models, enables prompt caching via cache_control markers.
        For other providers, uses plain messages (cache_control is ignored).
        """
        system_msgs = self._build_system_messages()
        conversation = self._sanitize_messages(self._compact_messages())

        kwargs = {
            "model": self.config.agent.model,
            "max_tokens": self.config.agent.max_tokens,
            "messages": system_msgs + conversation,
        }

        if self.tools.has_tools:
            kwargs["tools"] = self.tools.to_litellm_format()

        return kwargs

    @staticmethod
    def _sanitize_messages(messages: list[dict]) -> list[dict]:
        """Ensure no message has empty content (API rejects it).

        Special handling:
        - Assistant messages with tool_calls can have empty content (that's valid)
        - Tool messages always have content from execution results
        """
        sanitized = []
        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content")
            # Assistant messages with tool_calls are valid even with empty content
            if role == "assistant" and msg.get("tool_calls"):
                sanitized.append(msg)
            elif role == "tool":
                # Tool results should always have content; pass through
                sanitized.append(msg)
            elif not content and content != 0:
                # Empty string, empty list, or None — replace with placeholder
                logger.warning("Sanitized empty %s message (content=%r)", role, content)
                sanitized.append({
                    **msg,
                    "content": "(empty)" if role == "assistant" else "(continued)",
                })
            else:
                sanitized.append(msg)
        return sanitized

    # ---- Concurrent tool execution ----

    def _execute_tools(self, tool_calls: list[dict]) -> list[dict]:
        """Execute tool calls and return tool result messages (OpenAI format).

        Args:
            tool_calls: List of parsed tool call dicts with keys:
                id, name, arguments (dict, already parsed from JSON).

        Returns list of {"role": "tool", "tool_call_id": ..., "name": ..., "content": ...} dicts.

        Tools marked background=True (e.g. store_memory) fire in daemon
        threads and get an immediate synthetic result — the agent doesn't
        wait for them.  All other tools run with full concurrency and
        timeout handling.
        """
        def _run(name: str, kwargs: dict, tool_call_id: str) -> dict:
            """Execute a tool call."""
            logger.info("Tool call: %s(%s)", name, kwargs)
            try:
                result = self.tools.call(name, **kwargs)
                return {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "name": name,
                    "content": json.dumps(result) if not isinstance(result, str) else result,
                }
            except Exception as e:
                logger.error("Tool error: %s — %s", name, e)
                return {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "name": name,
                    "content": f"Error: {e}",
                }

        def _bg_fire(name: str, kwargs: dict):
            """Fire-and-forget: run in daemon thread, log errors only."""
            try:
                self.tools.call(name, **kwargs)
                logger.info("Background tool done: %s", name)
            except Exception as e:
                logger.error("Background tool error: %s — %s", name, e)

        # Split into blocking and background
        blocking = []
        background = []
        for tc in tool_calls:
            tool = self.tools.get(tc["name"])
            if tool and tool.background:
                background.append(tc)
            else:
                blocking.append(tc)

        results = []

        # Background tools: fire daemon threads, return synthetic results
        for tc in background:
            name = tc["name"]
            kwargs = tc["arguments"]
            tool_call_id = tc["id"]
            logger.info("Background tool call: %s(%s)", name, kwargs)
            threading.Thread(target=_bg_fire, args=(name, kwargs), daemon=True).start()
            results.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": name,
                "content": "Done.",
            })

        # Blocking tools: full execution with concurrency + timeouts
        if len(blocking) == 1:
            tc = blocking[0]
            results.append(_run(tc["name"], tc["arguments"], tc["id"]))
        elif blocking:
            with ThreadPoolExecutor(max_workers=len(blocking)) as pool:
                futures = [
                    pool.submit(_run, tc["name"], tc["arguments"], tc["id"])
                    for tc in blocking
                ]
                for future, tc in zip(futures, blocking):
                    try:
                        results.append(future.result(timeout=_TOOL_TIMEOUT))
                    except Exception as e:
                        logger.error("Tool timeout: %s — %s", tc["name"], e)
                        results.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "name": tc["name"],
                            "content": f"Error: tool timed out after {_TOOL_TIMEOUT}s",
                        })

        return results

    # ---- Response parsing helpers ----

    @staticmethod
    def _parse_tool_calls(message) -> list[dict]:
        """Parse tool calls from a LiteLLM response message into plain dicts.

        Returns list of {"id": str, "name": str, "arguments": dict}.
        """
        tool_calls = []
        for tc in (message.tool_calls or []):
            try:
                args = json.loads(tc.function.arguments) if isinstance(tc.function.arguments, str) else tc.function.arguments
            except (json.JSONDecodeError, TypeError):
                args = {}
            tool_calls.append({
                "id": tc.id,
                "name": tc.function.name,
                "arguments": args,
            })
        return tool_calls

    @staticmethod
    def _build_assistant_msg(message, tool_calls: list[dict] | None = None) -> dict:
        """Build a clean assistant history entry from a LiteLLM response message.

        For messages with tool calls, includes the tool_calls array.
        For plain text, just content string.
        """
        content = message.content or ""
        if tool_calls:
            return {
                "role": "assistant",
                "content": content,
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": json.dumps(tc["arguments"]) if isinstance(tc["arguments"], dict) else tc["arguments"],
                        },
                    }
                    for tc in tool_calls
                ],
            }
        return {"role": "assistant", "content": content}

    # ---- Chat methods ----

    def chat(self, message: str, skip_snapshot: bool = False) -> str:
        """Send a message and get a response, handling any tool calls.

        Maintains conversation history across calls.
        Every message is timestamped so the agent always knows what time it is.
        Retrieves relevant context from Nous before each exchange and
        compresses evicted history into Nous after each response.

        Args:
            message: The user/daemon message to send.
            skip_snapshot: If True, skip [Live State] injection (daemon wakes
                with [Briefing] already contain all the data).

        Thread-safe: acquires _chat_lock to prevent daemon/user interleaving.
        """
        with self._chat_lock:
            self._last_tool_calls = []  # Reset tool tracking
            get_tracker().reset()       # Reset mutation tracking for this cycle

            # Build context injection:
            # - skip_snapshot=True (daemon wake with briefing): no injection
            # - skip_snapshot=False: try briefing injection first, fall back to snapshot
            if not skip_snapshot:
                injection = self._get_briefing_injection()
                if injection:
                    wrapped = f"{injection}\n\n{message}"
                else:
                    snapshot = self._build_snapshot()
                    if snapshot:
                        wrapped = (
                            f"[Live State — auto-updated, no tool calls needed]\n"
                            f"{snapshot}\n"
                            f"[End Live State]\n\n"
                            f"{message}"
                        )
                    else:
                        wrapped = message
            else:
                wrapped = message
                self._last_snapshot = ""

            self._history.append({"role": "user", "content": stamp(wrapped)})

            # Retrieve relevant past context from Nous
            # For daemon wakes, search by position symbols + "thesis" (not boilerplate text)
            if "[DAEMON WAKE" in message:
                symbols = self._snapshot_symbols or getattr(self.config, 'execution', None) and self.config.execution.symbols[:3] or []
                search_query = " ".join(symbols) + " thesis trade observation" if symbols else message
            else:
                search_query = message
            self._active_context = self.memory_manager.retrieve_context(search_query)
            self._last_active_context = self._active_context  # Preserve for coach

            # Enable memory queue — store_memory calls become instant during thinking.
            # All queued memories flush to Nous after the response is complete.
            enable_queue_mode()
            kwargs = self._api_kwargs()

            try:
                while True:
                    try:
                        response = litellm.completion(**kwargs)
                    except Exception as e:
                        logger.error("LLM API error (%s): %s", type(e).__name__, e)
                        error_msg = "I'm having trouble connecting right now. Give me a moment."
                        self._history.append({"role": "assistant", "content": error_msg})
                        self._active_context = None
                        return error_msg

                    self._record_usage(response)
                    msg = response.choices[0].message
                    finish = response.choices[0].finish_reason

                    if finish == "tool_calls" or (msg.tool_calls and len(msg.tool_calls) > 0):
                        parsed_calls = self._parse_tool_calls(msg)
                        tool_results = self._execute_tools(parsed_calls)

                        # Track tool calls with truncated results for coach
                        for tc, result in zip(parsed_calls, tool_results):
                            content = result.get("content", "")
                            if len(content) > 400:
                                content = content[:400] + "..."
                            self._last_tool_calls.append({
                                "name": tc["name"],
                                "input": tc["arguments"],
                                "result": content,
                            })

                        self._history.append(self._build_assistant_msg(msg, parsed_calls))
                        self._history.extend(tool_results)
                        kwargs["messages"] = (
                            self._build_system_messages()
                            + self._sanitize_messages(self._compact_messages())
                        )

                    else:
                        text = msg.content or "(no response)"
                        self._history.append({"role": "assistant", "content": text})

                        # Window management: compress evicted exchanges into Nous
                        self._active_context = None
                        trimmed, did_compress = self.memory_manager.maybe_compress(self._history)
                        if did_compress:
                            self._history = trimmed
                        else:
                            self._trim_history()  # Safety net fallback
                        return text
            finally:
                disable_queue_mode()
                flush_memory_queue()

    def chat_stream(self, message: str, skip_snapshot: bool = False) -> Generator[tuple[str, str], None, None]:
        """Stream a response, yielding typed chunks as they arrive.

        Yields tuples of (type, data):
            ("text", chunk)  — streamed text fragment
            ("tool", name)   — a tool is being invoked

        Args:
            message: The user/daemon message to send.
            skip_snapshot: If True, skip [Live State] injection.

        Thread-safe: acquires _chat_lock for the entire generator lifetime.
        The lock is held from first next() until generator exits.

        Usage:
            for kind, data in agent.chat_stream("What's BTC doing?"):
                if kind == "text":
                    display(data)
                elif kind == "tool":
                    show_tool_indicator(data)
        """
        with self._chat_lock:
            self._last_tool_calls = []  # Reset tool tracking
            get_tracker().reset()       # Reset mutation tracking for this cycle

            # Build context injection:
            # - skip_snapshot=True (daemon wake with briefing): no injection
            # - skip_snapshot=False: try briefing injection first, fall back to snapshot
            if not skip_snapshot:
                injection = self._get_briefing_injection()
                if injection:
                    wrapped = f"{injection}\n\n{message}"
                else:
                    snapshot = self._build_snapshot()
                    if snapshot:
                        wrapped = (
                            f"[Live State — auto-updated, no tool calls needed]\n"
                            f"{snapshot}\n"
                            f"[End Live State]\n\n"
                            f"{message}"
                        )
                    else:
                        wrapped = message
            else:
                wrapped = message
                self._last_snapshot = ""

            self._history.append({"role": "user", "content": stamp(wrapped)})

            # Retrieve relevant past context from Nous
            # For daemon wakes, search by position symbols + "thesis" (not boilerplate text)
            if "[DAEMON WAKE" in message:
                symbols = self._snapshot_symbols or getattr(self.config, 'execution', None) and self.config.execution.symbols[:3] or []
                search_query = " ".join(symbols) + " thesis trade observation" if symbols else message
            else:
                search_query = message
            self._active_context = self.memory_manager.retrieve_context(search_query)
            self._last_active_context = self._active_context  # Preserve for coach

            # Enable memory queue — store_memory calls become instant during thinking.
            enable_queue_mode()
            kwargs = self._api_kwargs()

            try:
                while True:
                    try:
                        stream_response = litellm.completion(**kwargs, stream=True)

                        collected_text = []
                        collected_tool_calls: dict[int, dict] = {}  # index → {id, name, arguments}

                        for chunk in stream_response:
                            delta = chunk.choices[0].delta
                            finish = chunk.choices[0].finish_reason

                            # Text chunk
                            if delta.content:
                                collected_text.append(delta.content)
                                yield ("text", delta.content)

                            # Tool call chunks (accumulated across multiple chunks)
                            if delta.tool_calls:
                                for tc_chunk in delta.tool_calls:
                                    idx = tc_chunk.index
                                    if idx not in collected_tool_calls:
                                        collected_tool_calls[idx] = {
                                            "id": tc_chunk.id or "",
                                            "name": "",
                                            "arguments": "",
                                        }
                                    if tc_chunk.id:
                                        collected_tool_calls[idx]["id"] = tc_chunk.id
                                    if tc_chunk.function and tc_chunk.function.name:
                                        collected_tool_calls[idx]["name"] = tc_chunk.function.name
                                    if tc_chunk.function and tc_chunk.function.arguments:
                                        collected_tool_calls[idx]["arguments"] += tc_chunk.function.arguments

                    except Exception as e:
                        logger.error("LLM API error (%s): %s", type(e).__name__, e)
                        error_msg = "I'm having trouble connecting right now. Give me a moment."
                        self._history.append({"role": "assistant", "content": error_msg})
                        self._active_context = None
                        yield ("text", error_msg)
                        return

                    # After stream ends — check if we got tool calls
                    if collected_tool_calls:
                        # Parse accumulated tool calls
                        parsed_calls = []
                        for idx in sorted(collected_tool_calls.keys()):
                            tc = collected_tool_calls[idx]
                            try:
                                args = json.loads(tc["arguments"]) if tc["arguments"] else {}
                            except json.JSONDecodeError:
                                args = {}
                            parsed_calls.append({
                                "id": tc["id"],
                                "name": tc["name"],
                                "arguments": args,
                            })

                        # Signal all tools to the UI before executing
                        for tc in parsed_calls:
                            yield ("tool", tc["name"])

                        # Execute tools (concurrent when multiple)
                        tool_results = self._execute_tools(parsed_calls)

                        # Track tool calls with truncated results for coach
                        for tc, result in zip(parsed_calls, tool_results):
                            content = result.get("content", "")
                            if len(content) > 400:
                                content = content[:400] + "..."
                            self._last_tool_calls.append({
                                "name": tc["name"],
                                "input": tc["arguments"],
                                "result": content,
                            })

                        # Build assistant message with tool_calls for history
                        assistant_content = "".join(collected_text)
                        assistant_msg = {
                            "role": "assistant",
                            "content": assistant_content,
                            "tool_calls": [
                                {
                                    "id": tc["id"],
                                    "type": "function",
                                    "function": {
                                        "name": tc["name"],
                                        "arguments": json.dumps(tc["arguments"]),
                                    },
                                }
                                for tc in parsed_calls
                            ],
                        }
                        self._history.append(assistant_msg)
                        self._history.extend(tool_results)
                        kwargs["messages"] = (
                            self._build_system_messages()
                            + self._sanitize_messages(self._compact_messages())
                        )

                    else:
                        full_text = "".join(collected_text) or "(no response)"
                        self._history.append({"role": "assistant", "content": full_text})

                        # Window management: compress evicted exchanges into Nous
                        self._active_context = None
                        trimmed, did_compress = self.memory_manager.maybe_compress(self._history)
                        if did_compress:
                            self._history = trimmed
                        else:
                            self._trim_history()  # Safety net fallback
                        return
            finally:
                disable_queue_mode()
                flush_memory_queue()

    def _trim_history(self, max_entries: int = 40):
        """Trim history to roughly max_entries without breaking tool pairs.

        The API requires every tool result message to have a matching tool_calls
        in the preceding assistant message.  A naive slice can orphan tool results.

        Strategy: if trimming is needed, find the first safe cut point at or
        after the target index — a "user" message whose content is a plain
        string (i.e., a real user message, not in the middle of a tool exchange).
        """
        if len(self._history) <= max_entries:
            return

        target = len(self._history) - max_entries
        # Walk forward from target to find a safe boundary
        for i in range(target, len(self._history)):
            entry = self._history[i]
            if entry["role"] == "user" and isinstance(entry.get("content"), str):
                self._history = self._history[i:]
                return

        # Fallback: keep everything (shouldn't happen in practice)

    @staticmethod
    def _sanitize_history(history: list[dict]) -> list[dict]:
        """Sanitize loaded history for LiteLLM/OpenAI format compatibility.

        Handles:
        1. Old Anthropic-format messages (content as list of blocks with
           tool_use/tool_result types) — these are incompatible with OpenAI
           format and must be discarded.
        2. Orphaned tool results at the start of history.
        """
        # Detect old Anthropic format: any message with content as list
        # containing tool_use/tool_result blocks is pre-migration history.
        for entry in history:
            content = entry.get("content")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") in (
                        "tool_use", "tool_result",
                    ):
                        logger.warning(
                            "Discarding %d old Anthropic-format history entries",
                            len(history),
                        )
                        return []

        # Find first safe message (user with string content, or assistant without tool context issues)
        for i, entry in enumerate(history):
            if entry["role"] == "user" and isinstance(entry.get("content"), str):
                return history[i:]
            if entry["role"] == "assistant" and not entry.get("tool_calls"):
                return history[i:]
        return history

    def _record_usage(self, response) -> None:
        """Record token usage and cost from a LiteLLM API response."""
        try:
            usage = response.usage
            if usage:
                # Get actual cost from LiteLLM (knows pricing for all models)
                try:
                    cost = litellm.completion_cost(completion_response=response)
                except Exception:
                    cost = 0.0
                record_llm_usage(
                    model=self.config.agent.model,
                    input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                    output_tokens=getattr(usage, "completion_tokens", 0) or 0,
                    cost_usd=cost,
                )
        except Exception:
            pass  # Never let cost tracking break the agent

    def clear_history(self):
        """Clear conversation history."""
        self._history = []
        self._active_context = None
