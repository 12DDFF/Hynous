"""
Hynous Agent

The core reasoning engine. Wraps Claude API with tool calling support.
This is the brain — it receives messages, thinks, optionally uses tools,
and responds as Hynous.
"""

import logging
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Generator

import anthropic

from .prompts import build_system_prompt
from .memory_manager import MemoryManager
from .tools.registry import ToolRegistry, get_registry
from .tools.memory import enable_queue_mode, disable_queue_mode, flush_memory_queue
from ..core.config import Config, load_config
from ..core.clock import stamp
from ..core import persistence
from ..core.costs import record_claude_usage
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
_MAX_STALE_RESULT_CHARS = 400


class Agent:
    """Claude-powered agent with Hynous persona and tool access."""

    def __init__(
        self,
        config: Config | None = None,
        tool_registry: ToolRegistry | None = None,
    ):
        self.config = config or load_config()

        if not self.config.anthropic_api_key:
            raise ValueError(
                "ANTHROPIC_API_KEY not set. "
                "Add it to your .env file or set the environment variable."
            )

        self.client = anthropic.Anthropic(api_key=self.config.anthropic_api_key)
        self.tools = tool_registry or get_registry()

        # Initialize Hyperliquid provider with config (picks testnet URL + private key)
        from ..data.providers.hyperliquid import get_provider
        provider = get_provider(config=self.config)

        # Build system prompt with real portfolio data if trading is available
        portfolio_value = self.config.execution.paper_balance
        positions = []
        if provider.can_trade:
            try:
                user_state = provider.get_user_state()
                portfolio_value = user_state.get("account_value", portfolio_value)
                positions = [
                    {
                        "symbol": p["coin"],
                        "side": p["side"],
                        "entry": p["entry_px"],
                        "pnl": p["return_pct"],
                    }
                    for p in user_state.get("positions", [])
                ]
            except Exception as e:
                logger.warning("Could not fetch testnet state for prompt: %s", e)

        self.system_prompt = build_system_prompt(
            context={
                "portfolio_value": portfolio_value,
                "positions": positions,
                "execution_mode": self.config.execution.mode,
            }
        )

        # Tiered memory manager — retrieval + compression
        self.memory_manager = MemoryManager(
            config=self.config,
            anthropic_client=self.client,
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

        # Is the last message a fresh (unseen) tool_result?
        last_is_tools = (
            len(messages) > 0
            and messages[-1]["role"] == "user"
            and isinstance(messages[-1].get("content"), list)
        )

        compacted = []
        for i, entry in enumerate(messages):
            is_tool_entry = (
                entry["role"] == "user"
                and isinstance(entry.get("content"), list)
            )
            # Keep the last tool_result full if fresh; compact all others
            if is_tool_entry and not (last_is_tools and i == len(messages) - 1):
                compacted.append(self._truncate_tool_entry(entry))
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
                    and i != last_user_idx
                    and "[Live State" in entry["content"]):
                content = entry["content"]
                end_marker = "[End Live State]\n\n"
                idx = content.find(end_marker)
                if idx >= 0:
                    compacted[i] = {"role": "user", "content": content[idx + len(end_marker):]}

        return compacted

    @staticmethod
    def _truncate_tool_entry(entry: dict) -> dict:
        """Create a copy of a tool_result entry with truncated content."""
        new_blocks = []
        for block in entry["content"]:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                content = block.get("content", "")
                if len(content) > _MAX_STALE_RESULT_CHARS:
                    content = content[:_MAX_STALE_RESULT_CHARS] + "\n...[truncated, already processed]"
                new_blocks.append({**block, "content": content})
            else:
                new_blocks.append(block)
        return {"role": entry["role"], "content": new_blocks}

    # ---- API kwargs with prompt caching ----

    def _api_kwargs(self) -> dict:
        """Build API kwargs with prompt caching enabled.

        Anthropic caches content marked with cache_control for 5 minutes
        (TTL refreshes on each hit).  The system prompt and tool schemas
        are identical across every call in a conversation, so marking them
        cacheable saves ~90% of input-token cost on the cached portion
        after the first call.

        Pricing (Sonnet 4.5):
          - Cache write:  $3.75 / MTok  (25% premium, first call only)
          - Cache read:   $0.30 / MTok  (90% savings, all subsequent)
          - No-cache:     $3.00 / MTok  (what we pay today, every call)
        """
        kwargs = {
            "model": self.config.agent.model,
            "max_tokens": self.config.agent.max_tokens,
            "system": [
                {
                    "type": "text",
                    "text": self.system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            "messages": self._sanitize_messages(self._compact_messages()),
        }

        if self.tools.has_tools:
            tools = self.tools.to_anthropic_format()
            # Mark the last tool for caching.  The API caches everything
            # up to and including the last cache_control breakpoint as a
            # single prefix — so system prompt + all tool schemas are
            # cached together in one read on subsequent calls.
            tools[-1]["cache_control"] = {"type": "ephemeral"}
            kwargs["tools"] = tools

        return kwargs

    @staticmethod
    def _sanitize_messages(messages: list[dict]) -> list[dict]:
        """Ensure no message has empty content (API rejects it)."""
        sanitized = []
        for msg in messages:
            content = msg.get("content")
            if not content and content != 0:
                # Empty string, empty list, or None — replace with placeholder
                logger.warning("Sanitized empty %s message (content=%r)", msg["role"], content)
                sanitized.append({
                    "role": msg["role"],
                    "content": "(empty)" if msg["role"] == "assistant" else "(continued)",
                })
            else:
                sanitized.append(msg)
        return sanitized

    # ---- Concurrent tool execution ----

    def _execute_tools(self, tool_blocks: list) -> list[dict]:
        """Execute tool calls and return tool_result dicts.

        Tools marked background=True (e.g. store_memory) fire in daemon
        threads and get an immediate synthetic result — the agent doesn't
        wait for them.  All other tools run with full concurrency and
        timeout handling.

        Single blocking tool  → runs inline (no thread overhead).
        Multiple blocking     → ThreadPool so network calls overlap.
        """
        def _run(name: str, kwargs: dict, tool_use_id: str) -> dict:
            """Execute a tool call. Accepts only plain Python types to avoid
            Pyo3 pointer issues when called from ThreadPoolExecutor threads."""
            logger.info("Tool call: %s(%s)", name, kwargs)
            try:
                result = self.tools.call(name, **kwargs)
                return {
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": json.dumps(result) if not isinstance(result, str) else result,
                }
            except Exception as e:
                logger.error("Tool error: %s — %s", name, e)
                return {
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": f"Error: {e}",
                    "is_error": True,
                }

        def _bg_fire(name: str, kwargs: dict):
            """Fire-and-forget: run in daemon thread, log errors only.

            IMPORTANT: Only pass plain Python types (str, dict, list) into
            this function — never Pyo3-backed SDK objects.  Dropping a Pyo3
            pointer from a non-GIL thread causes a Rust panic.
            """
            try:
                self.tools.call(name, **kwargs)
                logger.info("Background tool done: %s", name)
            except Exception as e:
                logger.error("Background tool error: %s — %s", name, e)

        # Split into blocking and background
        blocking = []
        background = []
        for block in tool_blocks:
            tool = self.tools.get(block.name)
            if tool and tool.background:
                background.append(block)
            else:
                blocking.append(block)

        results = []

        # Background tools: fire daemon threads, return synthetic results
        # Extract plain Python data from SDK blocks BEFORE spawning threads
        # to avoid Pyo3 pointer drops on non-GIL threads.
        for block in background:
            name = str(block.name)
            kwargs = dict(block.input)
            tool_use_id = str(block.id)
            logger.info("Background tool call: %s(%s)", name, kwargs)
            threading.Thread(target=_bg_fire, args=(name, kwargs), daemon=True).start()
            results.append({
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": "Done.",
            })

        # Extract plain Python data from SDK blocks before passing to threads.
        blocking_plain = [
            (str(b.name), dict(b.input), str(b.id)) for b in blocking
        ]

        # Blocking tools: full execution with concurrency + timeouts
        if len(blocking_plain) == 1:
            name, kwargs, tid = blocking_plain[0]
            results.append(_run(name, kwargs, tid))
        elif blocking_plain:
            with ThreadPoolExecutor(max_workers=len(blocking_plain)) as pool:
                futures = [pool.submit(_run, n, k, t) for n, k, t in blocking_plain]
                for future, (name, _, tid) in zip(futures, blocking_plain):
                    try:
                        results.append(future.result(timeout=_TOOL_TIMEOUT))
                    except Exception as e:
                        logger.error("Tool timeout: %s — %s", name, e)
                        results.append({
                            "type": "tool_result",
                            "tool_use_id": tid,
                            "content": f"Error: tool timed out after {_TOOL_TIMEOUT}s",
                            "is_error": True,
                        })

        return results

    # ---- Chat methods ----

    def chat(self, message: str) -> str:
        """Send a message and get a response, handling any tool calls.

        Maintains conversation history across calls.
        Every message is timestamped so the agent always knows what time it is.
        Retrieves relevant context from Nous before each exchange and
        compresses evicted history into Nous after each response.

        Thread-safe: acquires _chat_lock to prevent daemon/user interleaving.
        """
        with self._chat_lock:
            self._last_tool_calls = []  # Reset tool tracking
            get_tracker().reset()       # Reset mutation tracking for this cycle

            # Build and inject snapshot
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
                        response = self.client.messages.create(**kwargs)
                    except anthropic.APIError as e:
                        logger.error(f"Claude API error: {e}")
                        error_msg = "I'm having trouble connecting right now. Give me a moment."
                        self._history.append({"role": "assistant", "content": error_msg})
                        self._active_context = None
                        return error_msg

                    self._record_usage(response)

                    if response.stop_reason == "tool_use":
                        tool_blocks = [b for b in response.content if b.type == "tool_use"]
                        tool_results = self._execute_tools(tool_blocks)

                        # Track tool calls with truncated results for coach
                        for block, result in zip(tool_blocks, tool_results):
                            content = result.get("content", "")
                            if len(content) > 400:
                                content = content[:400] + "..."
                            self._last_tool_calls.append({
                                "name": str(block.name),
                                "input": dict(block.input),
                                "result": content,
                            })

                        self._history.append({"role": "assistant", "content": self._clean_content(response.content)})
                        self._history.append({"role": "user", "content": tool_results})
                        kwargs["messages"] = self._sanitize_messages(self._compact_messages())

                    else:
                        text = self._extract_text(response.content)
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

    def chat_stream(self, message: str) -> Generator[tuple[str, str], None, None]:
        """Stream a response, yielding typed chunks as they arrive.

        Yields tuples of (type, data):
            ("text", chunk)  — streamed text fragment
            ("tool", name)   — a tool is being invoked

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

            # Build and inject snapshot
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
                        with self.client.messages.stream(**kwargs) as stream:
                            collected = []
                            for text in stream.text_stream:
                                collected.append(text)
                                yield ("text", text)

                            response = stream.get_final_message()
                    except anthropic.APIError as e:
                        logger.error(f"Claude API error: {e}")
                        error_msg = "I'm having trouble connecting right now. Give me a moment."
                        self._history.append({"role": "assistant", "content": error_msg})
                        self._active_context = None
                        yield ("text", error_msg)
                        return

                    self._record_usage(response)

                    if response.stop_reason == "tool_use":
                        tool_blocks = [b for b in response.content if b.type == "tool_use"]

                        # Signal all tools to the UI before executing
                        for block in tool_blocks:
                            yield ("tool", block.name)

                        # Execute tools (concurrent when multiple)
                        tool_results = self._execute_tools(tool_blocks)

                        # Track tool calls with truncated results for coach
                        for block, result in zip(tool_blocks, tool_results):
                            content = result.get("content", "")
                            if len(content) > 400:
                                content = content[:400] + "..."
                            self._last_tool_calls.append({
                                "name": str(block.name),
                                "input": dict(block.input),
                                "result": content,
                            })

                        self._history.append({"role": "assistant", "content": self._clean_content(response.content)})
                        self._history.append({"role": "user", "content": tool_results})
                        kwargs["messages"] = self._sanitize_messages(self._compact_messages())

                    else:
                        full_text = "".join(collected) or "(no response)"
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

        The API requires every tool_result to have a matching tool_use in the
        preceding assistant message.  A naive slice can orphan tool_results.

        Strategy: if trimming is needed, find the first safe cut point at or
        after the target index — a "user" message whose content is a plain
        string (i.e., a real user message, not tool_results).
        """
        if len(self._history) <= max_entries:
            return

        target = len(self._history) - max_entries
        # Walk forward from target to find a safe boundary
        for i in range(target, len(self._history)):
            entry = self._history[i]
            if entry["role"] == "user" and isinstance(entry["content"], str):
                self._history = self._history[i:]
                return

        # Fallback: keep everything (shouldn't happen in practice)

    @staticmethod
    def _sanitize_history(history: list[dict]) -> list[dict]:
        """Remove orphaned tool_results from the start of a loaded history.

        On restore, the history might start with a tool_result whose matching
        tool_use was trimmed in a previous session.
        """
        # Find first safe message (user with string content)
        for i, entry in enumerate(history):
            if entry["role"] == "user" and isinstance(entry.get("content"), str):
                return history[i:]
            if entry["role"] == "assistant":
                return history[i:]
        return history

    @staticmethod
    def _record_usage(response) -> None:
        """Record token usage from a Claude API response."""
        try:
            usage = response.usage
            if usage:
                record_claude_usage(
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
                    cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
                )
        except Exception:
            pass  # Never let cost tracking break the agent

    @staticmethod
    def _clean_content(content) -> list[dict]:
        """Convert SDK content blocks to clean dicts for history storage.

        The SDK response objects may include extra fields (e.g., parsed_output)
        that the API rejects when sent back as input. Strip to only the fields
        the API expects.
        """
        cleaned = []
        for block in content:
            if hasattr(block, "type"):
                if block.type == "text":
                    cleaned.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    cleaned.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })
                else:
                    # Unknown block type — try dict conversion as fallback
                    cleaned.append({"type": block.type})
            elif isinstance(block, dict):
                cleaned.append(block)
        return cleaned

    def clear_history(self):
        """Clear conversation history."""
        self._history = []
        self._active_context = None

    def _extract_text(self, content: list) -> str:
        """Extract text from response content blocks."""
        texts = []
        for block in content:
            if hasattr(block, "text") and block.text:
                texts.append(block.text)
        return "\n".join(texts) if texts else "(no response)"
