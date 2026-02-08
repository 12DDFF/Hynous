"""
Memory Manager — Tiered Memory for Hynous

Bridges the conversation working window and persistent Nous memory.
Three responsibilities:
  1. Retrieve relevant past context from Nous before each API call
  2. Compress evicted exchanges into Nous nodes
  3. Manage the working window boundary safely

Design principles:
  - Never mutate _history (that belongs to the Agent)
  - Degrade gracefully when Nous is down or Haiku fails
  - Never block the chat loop for compression
  - Track compression costs via the shared cost tracker
"""

import json
import logging
import threading
from typing import Optional

import anthropic

from ..core.config import Config
from ..core.costs import record_claude_usage

logger = logging.getLogger(__name__)

# Nous subtypes for tiered memory nodes
SUBTYPE_TURN_SUMMARY = "custom:turn_summary"
SUBTYPE_SESSION_SUMMARY = "custom:session_summary"

# Compression prompt — instructs Haiku to summarize exchanges as the agent's own memory
_COMPRESSION_SYSTEM = (
    "You are compressing a conversation exchange into the agent's own memory. "
    "Write as if YOU are the agent recalling what happened — use first person "
    "(I, my, me). This is your memory, not a report.\n\n"
    "Include:\n"
    "- Specific numbers: prices, funding rates, OI, percentages, sizes\n"
    "- What tools I used and what I found\n"
    "- Key market conditions at the time\n"
    "- Any thesis I formed or updated\n"
    "- Decisions made and reasoning behind them\n"
    "- Trade setups: entry, stop loss, take profit, size, confidence\n"
    "- Lessons learned or patterns noticed\n"
    "- What David (the user) asked or told me\n\n"
    "Write 150-300 words. Use plain text, no markdown. Be detailed — "
    "specific numbers and reasoning matter more than brevity. "
    "This memory needs to be useful when I recall it days later.\n\n"
    "Also output a SHORT title (max 60 chars) on the FIRST line, prefixed with "
    "TITLE: — this should describe the substance, not the user's question. "
    "Example: 'TITLE: BTC short squeeze setup at $68K, negative funding'\n"
    "Then a blank line, then the memory body.\n\n"
    "If the exchange is trivial (greeting, acknowledgment, or has no "
    "substantive content), respond with just the word TRIVIAL."
)

# Max tokens for compression output
_COMPRESSION_MAX_TOKENS = 600

# Words that indicate a trivial message (no need to search Nous)
_TRIVIAL_MESSAGES = frozenset({
    "ok", "okay", "thanks", "thank you", "thx", "ty",
    "got it", "sure", "yes", "no", "yep", "nope",
    "nice", "cool", "great", "perfect", "good",
    "hello", "hey", "hi", "sup", "yo",
    "of course", "sounds good", "makes sense",
    "right", "yea", "yeah", "k", "kk",
})


class MemoryManager:
    """Manages the bridge between working conversation window and persistent memory."""

    def __init__(
        self,
        config: Config,
        anthropic_client: anthropic.Anthropic,
    ):
        self.config = config
        self.client = anthropic_client
        self._compressing = False

    # ================================================================
    # 1. CONTEXT RETRIEVAL
    # ================================================================

    def retrieve_context(self, message: str) -> Optional[str]:
        """Search Nous for relevant past context to inject into the API call.

        Args:
            message: The user's raw stamped message (e.g., "[2:34 PM ...] query").

        Returns:
            Formatted context string, or None if nothing relevant found
            or Nous is unavailable. Never raises.
        """
        if not self.config.memory.compress_enabled:
            return None

        # Strip timestamp, check if trivial
        query = _extract_query(message)
        if _is_trivial(query):
            return None

        try:
            from ..nous.client import get_client
            nous = get_client()
            results = nous.search(
                query=query,
                limit=self.config.memory.retrieve_limit,
            )
            if not results:
                return None

            return _format_context(results, self.config.memory.max_context_tokens)

        except Exception as e:
            logger.debug("Context retrieval skipped (Nous may be down): %s", e)
            return None

    # ================================================================
    # 2. EXCHANGE GROUPING
    # ================================================================

    @staticmethod
    def group_exchanges(history: list[dict]) -> list[list[dict]]:
        """Split history into complete user→response exchange groups.

        An "exchange" starts with a real user message (string content)
        and includes all subsequent messages (assistant tool_use, user
        tool_results, etc.) until the next real user message or end.

        Only COMPLETE exchanges are returned — the exchange must have
        at least one assistant message, and the last entry must be an
        assistant message with string content (not mid-tool-loop).

        Multi-tool exchanges (user → assistant+tools → results →
        assistant+tools → results → final response) are ONE exchange.
        """
        exchanges: list[list[dict]] = []
        current: list[dict] = []

        for entry in history:
            is_real_user = (
                entry["role"] == "user"
                and isinstance(entry.get("content"), str)
            )

            if is_real_user:
                # Close previous exchange if it exists and is complete
                if current and _is_complete_exchange(current):
                    exchanges.append(current)
                current = [entry]
            elif current:
                # Append to current exchange (tool results, assistant msgs)
                current.append(entry)

        # Handle the last exchange
        if current and _is_complete_exchange(current):
            exchanges.append(current)

        return exchanges

    # ================================================================
    # 3. WINDOW MANAGEMENT
    # ================================================================

    def maybe_compress(self, history: list[dict]) -> tuple[list[dict], bool]:
        """Check if history exceeds window and handle overflow.

        Returns:
            (trimmed_history, did_compress) — the new history list and
            whether compression was triggered.

        If overflow detected:
        1. Identifies exchanges beyond the window
        2. Deep-copies them for background compression
        3. Trims history immediately (caller should assign back)
        4. Fires background thread for Haiku compression → Nous storage

        If no overflow: returns (history, False) unchanged.
        """
        if not self.config.memory.compress_enabled:
            return history, False

        exchanges = self.group_exchanges(history)
        window = self.config.memory.window_size

        if len(exchanges) <= window:
            return history, False

        # Split: evict oldest, keep most recent
        evicted_exchanges = exchanges[:-window]
        kept_exchanges = exchanges[-window:]

        # Find the cut point in the original history list.
        # The first entry of the first kept exchange tells us where to slice.
        if not kept_exchanges:
            return history, False

        first_kept_entry = kept_exchanges[0][0]
        cut_index = None
        for i, entry in enumerate(history):
            if entry is first_kept_entry:  # Identity check — same dict object
                cut_index = i
                break

        if cut_index is None:
            logger.error("Could not find cut point in history — skipping compression")
            return history, False

        # Trim history immediately
        trimmed = history[cut_index:]

        # Deep-copy evicted exchanges for the background thread.
        # Use dict() for shallow copy of each entry — content values
        # (strings, lists of plain dicts) won't be mutated, so this is safe.
        evicted_copy = [
            [dict(entry) for entry in exchange]
            for exchange in evicted_exchanges
        ]

        # Fire background compression (skip if already compressing)
        if not self._compressing:
            self._compressing = True

            def _bg():
                try:
                    self._compress_and_store(evicted_copy)
                except Exception as e:
                    logger.error("Background compression failed: %s", e)
                finally:
                    self._compressing = False

            threading.Thread(target=_bg, daemon=True).start()
            logger.info(
                "Compressing %d evicted exchange(s) in background",
                len(evicted_exchanges),
            )

        return trimmed, True

    # ================================================================
    # 4. COMPRESSION
    # ================================================================

    def _compress_and_store(self, exchanges: list[list[dict]]) -> None:
        """Compress exchanges via Haiku and store in Nous.

        Runs in a background thread. Uses only plain Python types.
        Each exchange becomes one Nous node of subtype custom:turn_summary.
        """
        for exchange in exchanges:
            try:
                summary = self._compress_one(exchange)
                if summary:
                    self._store_summary(summary, exchange)
            except Exception as e:
                logger.error("Failed to compress exchange: %s", e)

    def _compress_one(self, exchange: list[dict]) -> Optional[str]:
        """Compress a single exchange into a summary string.

        Tries Haiku first, falls back to rule-based extraction on failure.
        Returns None for trivial exchanges.
        """
        formatted = _format_exchange(exchange)

        # Skip very short exchanges (trivial or empty)
        if len(formatted) < 100:
            return None

        try:
            response = self.client.messages.create(
                model=self.config.memory.compression_model,
                max_tokens=_COMPRESSION_MAX_TOKENS,
                system=_COMPRESSION_SYSTEM,
                messages=[{"role": "user", "content": formatted}],
            )

            # Track compression cost
            _record_compression_usage(response)

            summary = response.content[0].text.strip()

            # Haiku flagged as trivial
            if summary.upper() == "TRIVIAL":
                return None

            # Sanity: summary shouldn't be longer than the input
            if len(summary) > len(formatted):
                logger.warning("Compression expanded input — using fallback")
                return _fallback_compress(exchange)

            return summary

        except anthropic.APIError as e:
            logger.warning("Haiku compression failed, using fallback: %s", e)
            return _fallback_compress(exchange)
        except Exception as e:
            logger.error("Unexpected compression error: %s", e)
            return _fallback_compress(exchange)

    def _store_summary(self, summary: str, exchange: list[dict]) -> None:
        """Store a compressed turn summary in Nous."""
        # Parse TITLE: prefix from compression output
        title = None
        body = summary

        if summary.startswith("TITLE:"):
            lines = summary.split("\n", 2)
            title = lines[0].replace("TITLE:", "").strip()[:60]
            # Body is everything after the title line (skip blank line)
            body = "\n".join(lines[1:]).strip()

        # Fallback title from user's question
        if not title:
            title = "Conversation exchange"
            for entry in exchange:
                if entry["role"] == "user" and isinstance(entry.get("content"), str):
                    raw = _extract_query(entry["content"])
                    title = raw[:80] if len(raw) > 80 else raw
                    break

        try:
            from ..nous.client import get_client
            nous = get_client()
            node = nous.create_node(
                type="episode",
                subtype=SUBTYPE_TURN_SUMMARY,
                title=title,
                body=body,
                summary=body[:300] if len(body) > 300 else None,
            )
            logger.info("Stored turn summary: %s", title[:50])

            # Auto-link to related memories
            node_id = node.get("id")
            if node_id:
                _auto_link_summary(nous, node_id, title)

        except Exception as e:
            # Acceptable loss — turn summaries are convenience, not critical
            logger.error("Failed to store turn summary in Nous: %s", e)


# ====================================================================
# PURE FUNCTIONS (no state, easy to test)
# ====================================================================


def _extract_query(message: str) -> str:
    """Strip the clock timestamp prefix from a stamped message.

    Input:  "[2:34 PM · Feb 6, 2026] What's BTC doing?"
    Output: "What's BTC doing?"
    """
    if message.startswith("[") and "] " in message:
        return message.split("] ", 1)[1]
    return message


def _is_trivial(query: str) -> bool:
    """Check if a message is too trivial to warrant Nous retrieval."""
    text = query.strip().lower()
    if len(text) < 8:
        return True
    return text in _TRIVIAL_MESSAGES


def _is_complete_exchange(entries: list[dict]) -> bool:
    """Check if an exchange group is complete (has assistant response, ends with final text)."""
    if not entries:
        return False
    has_assistant = any(e["role"] == "assistant" for e in entries)
    if not has_assistant:
        return False
    last = entries[-1]
    return last["role"] == "assistant" and isinstance(last.get("content"), str)


def _format_context(results: list[dict], max_tokens: int) -> Optional[str]:
    """Format Nous search results as injectable context text.

    Each memory gets one compact line. Stays within approximate token budget.
    """
    char_limit = max_tokens * 4  # ~4 chars per token
    lines = []
    total_chars = 0

    for node in results:
        title = node.get("content_title", "Untitled")
        subtype = node.get("subtype", node.get("type", ""))
        if subtype.startswith("custom:"):
            subtype = subtype[7:]
        date = node.get("provenance_created_at", "")[:10]

        # Get preview text
        body = node.get("content_body", "") or ""
        summary = node.get("content_summary", "") or ""
        preview = summary or body[:300]

        # Parse JSON bodies (watchpoints, signals store JSON)
        if preview.startswith("{"):
            try:
                parsed = json.loads(body)
                preview = parsed.get("text", body[:300])
            except (json.JSONDecodeError, TypeError):
                preview = body[:300]

        if len(preview) > 300:
            preview = preview[:297] + "..."

        entry = f"- [{subtype}] {title} ({date}): {preview}"
        entry_chars = len(entry)

        if total_chars + entry_chars > char_limit:
            break

        lines.append(entry)
        total_chars += entry_chars

    if not lines:
        return None

    return "\n".join(lines)


def _format_exchange(exchange: list[dict]) -> str:
    """Format an exchange for the Haiku compression prompt.

    Converts raw history dicts into readable text.
    Tool results are truncated to keep the prompt manageable.
    """
    lines = []
    for entry in exchange:
        role = entry["role"]
        content = entry["content"]

        if role == "user" and isinstance(content, str):
            lines.append(f"USER: {_extract_query(content)}")

        elif role == "user" and isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    tool_content = block.get("content", "")
                    is_error = block.get("is_error", False)
                    if len(tool_content) > 800:
                        tool_content = tool_content[:797] + "..."
                    prefix = "TOOL ERROR" if is_error else "TOOL RESULT"
                    lines.append(f"{prefix}: {tool_content}")

        elif role == "assistant":
            if isinstance(content, str):
                lines.append(f"AGENT: {content}")
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text = block["text"]
                            if text.strip():
                                lines.append(f"AGENT: {text}")
                        elif block.get("type") == "tool_use":
                            name = block.get("name", "?")
                            inp = block.get("input", {})
                            compact = json.dumps(inp, separators=(",", ":"))
                            if len(compact) > 200:
                                compact = compact[:197] + "..."
                            lines.append(f"AGENT CALLED: {name}({compact})")

    return "\n".join(lines)


def _fallback_compress(exchange: list[dict]) -> Optional[str]:
    """Rule-based fallback compression when Haiku is unavailable.

    Extracts: user question, tools called, truncated final response.
    """
    user_msg = None
    tools_called = []
    final_response = None

    for entry in exchange:
        role = entry["role"]
        content = entry["content"]

        if role == "user" and isinstance(content, str) and user_msg is None:
            user_msg = _extract_query(content)

        elif role == "assistant":
            if isinstance(content, str):
                final_response = content
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "tool_use":
                            tools_called.append(block.get("name", "?"))
                        elif block.get("type") == "text" and block.get("text", "").strip():
                            final_response = block["text"]

    parts = []
    if user_msg:
        if len(user_msg) > 100:
            user_msg = user_msg[:97] + "..."
        parts.append(f"User asked: {user_msg}")
    if tools_called:
        parts.append(f"Tools used: {', '.join(tools_called)}")
    if final_response:
        if len(final_response) > 200:
            final_response = final_response[:197] + "..."
        parts.append(f"Response: {final_response}")

    return " | ".join(parts) if parts else None


def _auto_link_summary(nous, node_id: str, title: str) -> None:
    """Link a turn summary to related existing memories.

    Already runs in the compression background thread, so no extra thread needed.
    Searches by title, links to top 3 related nodes (excluding self).
    """
    try:
        results = nous.search(query=title, limit=6)
        linked = 0
        for node in results:
            rid = node.get("id")
            if not rid or rid == node_id:
                continue
            try:
                nous.create_edge(
                    source_id=node_id,
                    target_id=rid,
                    type="relates_to",
                )
                linked += 1
                if linked >= 3:
                    break
            except Exception:
                continue
        if linked:
            logger.info("Auto-linked turn summary %s to %d memories", node_id, linked)
    except Exception as e:
        logger.debug("Auto-link failed for turn summary %s: %s", node_id, e)


def _record_compression_usage(response) -> None:
    """Record Haiku compression token usage.

    Records under the shared 'claude' bucket. This overestimates cost
    (Haiku is ~12x cheaper than Sonnet) but the absolute numbers are
    tiny (~$0.0004 per compression) so the error is negligible.
    """
    try:
        usage = response.usage
        if usage:
            record_claude_usage(
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                cache_write_tokens=0,
                cache_read_tokens=0,
            )
    except Exception:
        pass
