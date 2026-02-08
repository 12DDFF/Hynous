"""
Memory Tools — store_memory + recall_memory

Lets the agent persist knowledge, set watchpoints, log curiosity items,
and recall memories from the Nous knowledge graph.

Memory types:
  watchpoint  → Alert with trigger conditions (price, funding, etc.)
  curiosity   → Something to learn about later
  lesson      → Knowledge learned from research
  thesis      → Trade reasoning / market thesis
  episode     → Market event record
  trade       → Trade record
  signal      → Snapshot of market conditions

Wikilinks: [[some title]] in content auto-links to matching memories.

Standard tool module pattern:
  1. TOOL_DEF dicts
  2. handler functions
  3. register() wires into registry
"""

import json
import logging
import re
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# Regex for [[wikilink]] extraction
_WIKILINK_RE = re.compile(r"\[\[(.+?)\]\]")

# ---- Memory Queue (deferred storage) ----
# When queue mode is active, store_memory appends to this list instead
# of making HTTP calls. The agent flushes after its response is complete.
# This keeps the thinking flow uninterrupted — zero latency on store calls.
_queue_lock = threading.Lock()
_memory_queue: list[dict] = []
_queue_mode = False


def enable_queue_mode():
    """Enable deferred memory storage. Calls to store_memory become instant."""
    global _queue_mode
    _queue_mode = True


def disable_queue_mode():
    """Disable deferred storage. Future store_memory calls go direct to Nous."""
    global _queue_mode
    _queue_mode = False


def flush_memory_queue() -> int:
    """Flush all queued memories to Nous in a background thread.

    Returns the number of memories queued for storage.
    Called by the agent after the response loop ends.
    """
    with _queue_lock:
        items = list(_memory_queue)
        _memory_queue.clear()

    if not items:
        return 0

    count = len(items)

    def _flush():
        for kwargs in items:
            try:
                _store_memory_impl(**kwargs)
            except Exception as e:
                logger.error("Failed to flush queued memory: %s", e)

    threading.Thread(target=_flush, daemon=True).start()
    logger.info("Flushing %d queued memories in background", count)
    return count


def _resolve_wikilinks(node_id: str, content: str, explicit_ids: list | None = None):
    """Extract [[wikilinks]] from content, search Nous, create edges.

    Runs in background thread. Each [[query]] searches Nous and links
    to the best match. Like Obsidian backlinks but with semantic search.
    """
    links = _WIKILINK_RE.findall(content)
    if not links:
        return

    def _link():
        try:
            from ...nous.client import get_client
            client = get_client()

            skip = {node_id}
            if explicit_ids:
                skip.update(explicit_ids)

            linked = 0
            for query in links:
                try:
                    results = client.search(query=query.strip(), limit=3)
                    for node in results:
                        rid = node.get("id")
                        if not rid or rid in skip:
                            continue
                        client.create_edge(
                            source_id=node_id,
                            target_id=rid,
                            type="relates_to",
                        )
                        skip.add(rid)
                        linked += 1
                        break  # Best match only per wikilink
                except Exception:
                    continue

            if linked:
                logger.info("Wikilinked %s to %d memories", node_id, linked)
        except Exception as e:
            logger.debug("Wikilink resolution failed for %s: %s", node_id, e)

    threading.Thread(target=_link, daemon=True).start()


def _auto_link(node_id: str, title: str, content: str, explicit_ids: list | None = None):
    """Search for related memories and create edges automatically.

    Runs in background thread to avoid blocking tool response.
    Searches by title, links to top 3 related nodes (excluding self and explicit links).
    """
    def _link():
        try:
            from ...nous.client import get_client
            client = get_client()

            results = client.search(query=title, limit=6)

            skip = {node_id}
            if explicit_ids:
                skip.update(explicit_ids)

            linked = 0
            for node in results:
                rid = node.get("id")
                if not rid or rid in skip:
                    continue
                try:
                    client.create_edge(
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
                logger.info("Auto-linked %s to %d related memories", node_id, linked)
        except Exception as e:
            logger.debug("Auto-link failed for %s: %s", node_id, e)

    threading.Thread(target=_link, daemon=True).start()


# Memory type → (@nous/core type, subtype)
_TYPE_MAP = {
    "watchpoint": ("concept", "custom:watchpoint"),
    "curiosity": ("concept", "custom:curiosity"),
    "lesson": ("concept", "custom:lesson"),
    "thesis": ("concept", "custom:thesis"),
    "episode": ("episode", "custom:market_event"),
    "trade": ("concept", "custom:trade"),
    "signal": ("concept", "custom:signal"),
    "turn_summary": ("episode", "custom:turn_summary"),
    "session_summary": ("episode", "custom:session_summary"),
    # Trade lifecycle subtypes (created by trading tools, searchable via recall)
    # type="concept" → FSRS: 21 day stability, 0.4 difficulty (durable)
    "trade_entry": ("concept", "custom:trade_entry"),
    "trade_modify": ("concept", "custom:trade_modify"),
    "trade_close": ("concept", "custom:trade_close"),
}


# =============================================================================
# 1. STORE MEMORY
# =============================================================================

STORE_TOOL_DEF = {
    "name": "store_memory",
    "description": (
        "Store something in your persistent memory. Write rich, detailed content — "
        "your future self will thank you. Don't summarize when detail matters.\n\n"
        "Memory types (choose ONE — if unsure, pick the closest):\n"
        "  episode — WHAT happened. A specific event with a timestamp. "
        "\"BTC pumped 5% in 2 hours on a short squeeze cascade.\"\n"
        "  lesson — WHAT you learned. A takeaway from experience or research.\n"
        "  thesis — WHAT you believe will happen and WHY. Forward-looking conviction.\n"
        "  signal — RAW data snapshot. Numbers, not narrative.\n"
        "  watchpoint — An alert with trigger conditions. Include trigger object.\n"
        "  curiosity — A question to research later.\n"
        "  trade — Manual trade record.\n\n"
        "Rule of thumb: episode=narrative of what happened, signal=raw numbers, "
        "thesis=forward prediction, lesson=backward insight.\n\n"
        "LINKING with [[wikilinks]]: Reference existing memories by writing "
        "[[title or topic]] anywhere in your content. The system searches for "
        "matching memories and creates edges automatically. Like Obsidian backlinks.\n"
        "Example: \"BTC squeezed 5% today, similar pattern to [[BTC Jan 15 squeeze]]. "
        "This confirms my [[funding rate divergence thesis]].\"\n\n"
        "BATCHING: Don't stop to store memories mid-analysis. Keep thinking, keep "
        "using tools, keep building your picture. Call store_memory whenever something "
        "is worth remembering — it's instant (queued, not stored yet). All memories "
        "flush to Nous after your response is complete. Call multiple store_memory "
        "in one response for related memories. Use [[wikilinks]] to cross-reference."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": (
                    "The full content to remember. Be detailed — include context, "
                    "reasoning, numbers, and anything that would help you understand "
                    "this memory months from now. No need to be brief. "
                    "Use [[title]] to link to related memories."
                ),
            },
            "memory_type": {
                "type": "string",
                "enum": ["watchpoint", "curiosity", "lesson", "thesis", "episode", "trade", "signal"],
                "description": "Type of memory to store.",
            },
            "title": {
                "type": "string",
                "description": "Descriptive title for this memory.",
            },
            "trigger": {
                "type": "object",
                "description": (
                    "Only for watchpoints. Alert conditions. Properties: "
                    "condition (price_below, price_above, funding_above, funding_below, "
                    "oi_change, liquidation_spike, fear_greed_extreme), "
                    "symbol (e.g. BTC), value (threshold number), "
                    "expiry (ISO date, optional, default 7 days)."
                ),
                "properties": {
                    "condition": {"type": "string"},
                    "symbol": {"type": "string"},
                    "value": {"type": "number"},
                    "expiry": {"type": "string"},
                },
            },
            "signals": {
                "type": "object",
                "description": "Current market snapshot to store alongside (e.g. funding rate, fear/greed, price).",
            },
            "link_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "IDs of related memories to link to (if you know them). Prefer [[wikilinks]] in content instead.",
            },
            "event_time": {
                "type": "string",
                "description": (
                    "ISO timestamp for when this event actually occurred. "
                    "Only needed if the event time differs from now (e.g. recording a past event). "
                    "Episodes, trades, and signals auto-set to now if not provided."
                ),
            },
        },
        "required": ["content", "memory_type", "title"],
    },
}


def handle_store_memory(
    content: str,
    memory_type: str,
    title: str,
    trigger: Optional[dict] = None,
    signals: Optional[dict] = None,
    link_ids: Optional[list] = None,
    event_time: Optional[str] = None,
) -> str:
    """Store a memory — queues if queue mode active, stores directly otherwise."""
    if memory_type not in _TYPE_MAP:
        return f"Error: unknown memory_type '{memory_type}'. Use one of: {', '.join(_TYPE_MAP.keys())}"

    kwargs = dict(
        content=content, memory_type=memory_type, title=title,
        trigger=trigger, signals=signals, link_ids=link_ids, event_time=event_time,
    )

    if _queue_mode:
        with _queue_lock:
            _memory_queue.append(kwargs)
        wikilinks = _WIKILINK_RE.findall(content)
        result = f"Queued: \"{title}\""
        if wikilinks:
            result += f" (will link: {', '.join(wikilinks)})"
        return result

    return _store_memory_impl(**kwargs)


def _store_memory_impl(
    content: str,
    memory_type: str,
    title: str,
    trigger: Optional[dict] = None,
    signals: Optional[dict] = None,
    link_ids: Optional[list] = None,
    event_time: Optional[str] = None,
) -> str:
    """Actually store a memory in Nous (HTTP calls + linking)."""
    from ...nous.client import get_client

    node_type, subtype = _TYPE_MAP[memory_type]

    # Auto-set event_time for event-like types (things happening NOW)
    _event_time = event_time
    _event_confidence = None
    _event_source = None
    if memory_type in ("episode", "signal", "trade", "trade_entry", "trade_close", "trade_modify"):
        if not _event_time:
            from datetime import datetime, timezone
            _event_time = datetime.now(timezone.utc).isoformat()
        _event_confidence = 1.0
        _event_source = "explicit" if event_time else "inferred"

    # Build content_body — plain text for simple memories, JSON for watchpoints
    if trigger or signals:
        body_data: dict = {"text": content}
        if trigger:
            body_data["trigger"] = trigger
        if signals:
            body_data["signals_at_creation"] = signals
        body = json.dumps(body_data)
    else:
        body = content

    # Create the summary from first ~500 chars of content
    summary = content[:500] if len(content) > 500 else None

    try:
        client = get_client()
        node = client.create_node(
            type=node_type,
            subtype=subtype,
            title=title,
            body=body,
            summary=summary,
            event_time=_event_time,
            event_confidence=_event_confidence,
            event_source=_event_source,
        )

        node_id = node.get("id", "?")

        # Create edges for explicitly linked memories
        if link_ids:
            for link_id in link_ids:
                try:
                    client.create_edge(
                        source_id=node_id,
                        target_id=link_id,
                        type="relates_to",
                    )
                except Exception as e:
                    logger.warning("Failed to link %s → %s: %s", node_id, link_id, e)

        # Resolve [[wikilinks]] in content → search & link (background)
        _resolve_wikilinks(node_id, content, explicit_ids=link_ids)

        # Auto-link to related memories by title (background)
        _auto_link(node_id, title, content, explicit_ids=link_ids)

        logger.info("Stored %s: \"%s\" (%s)", memory_type, title, node_id)
        return f"Stored: \"{title}\" ({node_id})"

    except Exception as e:
        logger.error("store_memory failed: %s", e)
        return f"Error storing memory: {e}"


# =============================================================================
# 2. RECALL MEMORY
# =============================================================================

RECALL_TOOL_DEF = {
    "name": "recall_memory",
    "description": (
        "Search your persistent memory. Use this to recall past analyses, theses, "
        "lessons, watchpoints, or any stored knowledge.\n\n"
        "Examples:\n"
        '  {"query": "BTC support levels"} → search all memories\n'
        '  {"query": "funding", "memory_type": "signal"} → search only signal snapshots\n'
        '  {"query": "watchpoint", "memory_type": "watchpoint", "active_only": true} '
        "→ active watchpoints only"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "What to search for in your memories.",
            },
            "memory_type": {
                "type": "string",
                "enum": [
                    "watchpoint", "curiosity", "lesson", "thesis", "episode", "trade", "signal",
                    "trade_entry", "trade_modify", "trade_close",
                ],
                "description": (
                    "Filter by memory type. Trade lifecycle types: "
                    "trade_entry (theses + entries), trade_close (outcomes + PnL), "
                    "trade_modify (position adjustments)."
                ),
            },
            "active_only": {
                "type": "boolean",
                "description": "Only return active memories (not expired/archived). Default false.",
            },
            "limit": {
                "type": "integer",
                "description": "Max results to return. Default 10.",
            },
        },
        "required": ["query"],
    },
}


def handle_recall_memory(
    query: str,
    memory_type: Optional[str] = None,
    active_only: bool = False,
    limit: int = 10,
) -> str:
    """Search memories in Nous."""
    from ...nous.client import get_client

    # Map memory_type to subtype filter
    subtype = None
    node_type = None
    if memory_type and memory_type in _TYPE_MAP:
        node_type, subtype = _TYPE_MAP[memory_type]

    lifecycle = "ACTIVE" if active_only else None

    try:
        client = get_client()
        results = client.search(
            query=query,
            type=node_type,
            subtype=subtype,
            lifecycle=lifecycle,
            limit=limit,
        )

        if not results:
            return f"No memories found for: \"{query}\""

        lines = [f"Found {len(results)} memories:\n"]
        for i, node in enumerate(results, 1):
            title = node.get("content_title", "Untitled")
            ntype = node.get("subtype", node.get("type", "?"))
            # Strip custom: prefix for display
            if ntype.startswith("custom:"):
                ntype = ntype[7:]
            date = node.get("provenance_created_at", "?")[:10]
            node_id = node.get("id", "?")

            # Preview from body or summary — show enough to be useful
            body = node.get("content_body", "") or ""
            summary = node.get("content_summary", "") or ""
            preview = summary or body[:400]

            # Try to extract text from JSON body
            if preview.startswith("{"):
                try:
                    parsed = json.loads(body)
                    preview = parsed.get("text", body[:400])
                except (json.JSONDecodeError, TypeError):
                    preview = body[:400]

            if len(preview) > 400:
                preview = preview[:397] + "..."

            lines.append(f"{i}. [{ntype}] {title} ({date}, {node_id})")
            if preview:
                lines.append(f"   {preview}")

            # Show SSA score + primary signal when available
            score = node.get("score")
            primary = node.get("primary_signal")
            if score:
                score_pct = int(float(score) * 100)
                lines.append(f"   Score: {score_pct}%{f' (via {primary})' if primary else ''}")

        return "\n".join(lines)

    except Exception as e:
        logger.error("recall_memory failed: %s", e)
        return f"Error recalling memories: {e}"


# =============================================================================
# 3. REGISTRATION
# =============================================================================

def register(registry):
    """Register memory tools."""
    from .registry import Tool

    registry.register(Tool(
        name=STORE_TOOL_DEF["name"],
        description=STORE_TOOL_DEF["description"],
        parameters=STORE_TOOL_DEF["parameters"],
        handler=handle_store_memory,
        background=True,
    ))

    registry.register(Tool(
        name=RECALL_TOOL_DEF["name"],
        description=RECALL_TOOL_DEF["description"],
        parameters=RECALL_TOOL_DEF["parameters"],
        handler=handle_recall_memory,
    ))
