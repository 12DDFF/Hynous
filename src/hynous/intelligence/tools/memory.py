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

from ...core.request_tracer import get_tracer, SPAN_MEMORY_OP, SPAN_QUEUE_FLUSH

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

    # Record queue flush span (before background thread starts)
    try:
        from datetime import datetime, timezone
        from ...core.request_tracer import get_active_trace
        _tid = get_active_trace()
        if _tid:
            get_tracer().record_span(_tid, {
                "type": SPAN_QUEUE_FLUSH,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "duration_ms": 0,
                "items_count": count,
                "items": [
                    {"title": k.get("title", "")[:60], "type": k.get("memory_type", "")}
                    for k in items[:10]
                ],
            })
    except Exception:
        pass

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


def _auto_assign_clusters(
    client, node_id: str, subtype: str,
    title: str = "", content: str = "",
    exclude_cluster: str | None = None,
):
    """Auto-assign node to clusters by subtype match OR keyword match.

    Runs in background thread to avoid blocking the store response.

    Two matching strategies:
    1. Subtype match: cluster.auto_subtypes includes this node's subtype
    2. Keyword match: cluster name appears as a whole word in title or content
       (case-insensitive, for asset symbol clusters like "BTC", "ETH")

    A node can belong to multiple clusters.
    """
    def _assign():
        try:
            import re
            clusters = client.list_clusters()
            text_upper = f"{title} {content}".upper()

            for cl in clusters:
                cid = cl.get("id")
                if not cid:
                    continue
                if exclude_cluster and cid == exclude_cluster:
                    continue

                matched = False

                # Strategy 1: Subtype match (existing logic)
                auto_subs = cl.get("auto_subtypes")
                if auto_subs:
                    if isinstance(auto_subs, str):
                        try:
                            auto_subs = json.loads(auto_subs)
                        except (json.JSONDecodeError, TypeError):
                            auto_subs = None

                    if isinstance(auto_subs, list) and subtype in auto_subs:
                        matched = True

                # Strategy 2: Keyword match (cluster name in content)
                if not matched:
                    cluster_name = (cl.get("name") or "").upper()
                    if cluster_name and len(cluster_name) >= 2:
                        pattern = r'(?<![A-Z])' + re.escape(cluster_name) + r'(?![A-Z])'
                        if re.search(pattern, text_upper):
                            matched = True

                if matched:
                    try:
                        client.add_to_cluster(cid, node_id=node_id)
                    except Exception:
                        continue

        except Exception as e:
            logger.debug("Cluster auto-assignment failed for %s: %s", node_id, e)

    threading.Thread(target=_assign, daemon=True).start()


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
    # Regret system subtypes
    "playbook": ("concept", "custom:playbook"),                      # Winning patterns extracted from profitable trades
    "missed_opportunity": ("concept", "custom:missed_opportunity"),   # Phantom tracker: would have won
    "good_pass": ("concept", "custom:good_pass"),                    # Phantom tracker: would have lost
}


# =============================================================================
# 1. STORE MEMORY
# =============================================================================

STORE_TOOL_DEF = {
    "name": "store_memory",
    "description": (
        "Store something in your persistent memory. Include key context, reasoning, "
        "and numbers — be complete but not padded.\n\n"
        "Memory types:\n"
        "  episode — A specific event. \"BTC pumped 5% on a short squeeze.\"\n"
        "  lesson — A takeaway from experience or research.\n"
        "  thesis — Forward-looking conviction. What you believe will happen and why.\n"
        "  signal — Raw data snapshot. Numbers, not narrative.\n"
        "  watchpoint — An alert with trigger conditions. Include trigger object.\n"
        "  curiosity — A question to research later.\n"
        "  trade — Manual trade record.\n\n"
        "Use [[wikilinks]] in content to link to related memories: "
        "\"This confirms my [[funding rate thesis]].\" "
        "The system searches for matches and creates edges automatically.\n\n"
        "Lessons and curiosity items are checked for duplicates automatically."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": (
                    "The content to remember. Include context, reasoning, and key numbers. "
                    "Use [[title]] to link to related memories."
                ),
            },
            "memory_type": {
                "type": "string",
                "enum": ["watchpoint", "curiosity", "lesson", "thesis", "episode", "trade", "signal", "playbook"],
                "description": "Type of memory to store.",
            },
            "title": {
                "type": "string",
                "description": "Descriptive title for this memory.",
            },
            "trigger": {
                "type": "object",
                "description": (
                    "Watchpoints only. Conditions: price_below, price_above, funding_above, "
                    "funding_below, fear_greed_extreme. Requires symbol and value. "
                    "Optional expiry (ISO date, default 7 days)."
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
            "cluster": {
                "type": "string",
                "description": "Cluster ID to assign to (optional). Auto-assignment also applies based on type.",
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
    cluster: Optional[str] = None,
) -> str:
    """Store a memory — queues if queue mode active, stores directly otherwise."""
    if memory_type not in _TYPE_MAP:
        return f"Error: unknown memory_type '{memory_type}'. Use one of: {', '.join(_TYPE_MAP.keys())}"

    kwargs = dict(
        content=content, memory_type=memory_type, title=title,
        trigger=trigger, signals=signals, link_ids=link_ids,
        event_time=event_time, cluster=cluster,
    )

    if _queue_mode and memory_type not in ("lesson", "curiosity"):
        with _queue_lock:
            _memory_queue.append(kwargs)
        wikilinks = _WIKILINK_RE.findall(content)
        result = f"Queued: \"{title}\""
        if cluster:
            result += f" [→ cluster: {cluster}]"
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
    cluster: Optional[str] = None,
) -> str:
    """Actually store a memory in Nous (HTTP calls + linking)."""
    from ...core.config import load_config
    from ..gate_filter import check_content

    # --- Gate filter (MF-15) ---
    # Reject junk content before any HTTP calls to Nous.
    # Runs on ALL memory types. For synchronous stores (lesson/curiosity),
    # the agent sees the rejection feedback. For queued stores, the rejection
    # is logged but silent to the agent (acceptable — rules are conservative).
    cfg = load_config()
    if cfg.memory.gate_filter_enabled:
        gate_result = check_content(content)
        if not gate_result.passed:
            logger.info(
                "Gate filter rejected %s \"%s\": %s",
                memory_type, title[:50], gate_result.reason,
            )
            # Record rejected memory op span
            try:
                from datetime import datetime, timezone
                from ...core.request_tracer import get_active_trace
                _tid = get_active_trace()
                if _tid:
                    get_tracer().record_span(_tid, {
                        "type": SPAN_MEMORY_OP,
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "duration_ms": 0,
                        "operation": "store",
                        "memory_type": memory_type,
                        "title": title[:100],
                        "gate_filter": "rejected",
                        "gate_reason": gate_result.reason,
                    })
            except Exception:
                pass
            return f"Not stored: {gate_result.detail}"

    from ...nous.client import get_client
    client = get_client()

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

    # --- Dedup check for eligible types (MF-0) ---
    # Only lesson and curiosity go through dedup. All other types create immediately.
    # This check calls POST /v1/nodes/check-similar on Nous to compare the new
    # content's embedding against existing nodes of the same subtype.
    _connect_matches = []
    if memory_type in ("lesson", "curiosity"):
        try:
            similar = client.check_similar(
                content=content,
                title=title,
                subtype=subtype,
                limit=5,
            )

            recommendation = similar.get("recommendation", "unique")
            matches = similar.get("matches", [])

            # DUPLICATE (>= 0.95 cosine): drop the new node entirely
            if recommendation == "duplicate_found" and matches and len(matches) > 0:
                top = matches[0]  # Highest similarity match (sorted by Nous)
                dup_title = top.get("title", "Untitled")
                dup_id = top.get("node_id", "?")
                dup_lifecycle = top.get("lifecycle", "ACTIVE")
                dup_sim = top.get("similarity", 0)
                sim_pct = int(dup_sim * 100)

                logger.info(
                    "Dedup: dropped %s \"%s\" — duplicate of \"%s\" (%s, %d%% similar)",
                    memory_type, title, dup_title, dup_id, sim_pct,
                )

                result_msg = (
                    f"Duplicate: already stored as \"{dup_title}\" ({dup_id})"
                )
                if dup_lifecycle != "ACTIVE":
                    result_msg += f" [{dup_lifecycle}]"
                    result_msg += ". Use update_memory to reactivate if needed"
                result_msg += f". Not created. ({sim_pct}% similar)"
                # Record dedup rejection span
                try:
                    from datetime import datetime, timezone
                    from ...core.request_tracer import get_active_trace
                    _tid = get_active_trace()
                    if _tid:
                        get_tracer().record_span(_tid, {
                            "type": SPAN_MEMORY_OP,
                            "started_at": datetime.now(timezone.utc).isoformat(),
                            "duration_ms": 0,
                            "operation": "store",
                            "memory_type": memory_type,
                            "title": title[:100],
                            "dedup": "duplicate",
                            "duplicate_of": dup_title[:60],
                            "similarity": dup_sim,
                        })
                except Exception:
                    pass
                return result_msg

            # CONNECT tier matches (0.90-0.95) — save for edge creation after node is created
            _connect_matches = [
                m for m in matches if m.get("action") == "connect"
            ]

        except Exception as e:
            # Dedup check failed — fall back to creating normally.
            # A duplicate is better than a lost memory. Dedup is optimization, not safety.
            logger.warning("Dedup check failed, creating normally: %s", e)
            _connect_matches = []

    try:
        from ...core.memory_tracker import get_tracker
        tracker = get_tracker()

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
        contradiction_flag = node.get("_contradiction_detected", False)

        # Track mutation
        tracker.record_create(subtype, title, node_id)

        # Create edges for explicitly linked memories
        if link_ids:
            for link_id in link_ids:
                try:
                    client.create_edge(
                        source_id=node_id,
                        target_id=link_id,
                        type="relates_to",
                    )
                    tracker.record_edge(node_id, link_id, "relates_to", "explicit link")
                except Exception as e:
                    logger.warning("Failed to link %s → %s: %s", node_id, link_id, e)
                    tracker.record_fail("create_edge", str(e))

        # Resolve [[wikilinks]] in content → search & link (background)
        _resolve_wikilinks(node_id, content, explicit_ids=link_ids)

        # Auto-link to related memories by title (background)
        # Include connect-tier match IDs in skip list to avoid duplicate edges
        connect_ids = [m.get("node_id") for m in _connect_matches if m.get("node_id")]
        all_skip = (link_ids or []) + connect_ids
        _auto_link(node_id, title, content, explicit_ids=all_skip if all_skip else link_ids)

        # Create edges for connect-tier matches from dedup check (0.90-0.95 similarity)
        if _connect_matches:
            for match in _connect_matches:
                match_id = match.get("node_id")
                if match_id:
                    try:
                        client.create_edge(
                            source_id=node_id,
                            target_id=match_id,
                            type="relates_to",
                        )
                    except Exception as e:
                        logger.debug("Failed to link connect-tier match %s → %s: %s", node_id, match_id, e)

        # ---- Cluster assignment (MF-13) ----
        # 1. Explicit cluster (synchronous — agent gets feedback)
        if cluster:
            try:
                client.add_to_cluster(cluster, node_id=node_id)
            except Exception as e:
                logger.debug("Explicit cluster assignment failed: %s", e)

        # 2. Auto-assign based on cluster auto_subtypes + keyword match (background)
        _auto_assign_clusters(client, node_id, subtype, title=title, content=content, exclude_cluster=cluster)

        logger.info("Stored %s: \"%s\" (%s)", memory_type, title, node_id)
        # Record successful memory op span
        try:
            from datetime import datetime, timezone
            from ...core.request_tracer import get_active_trace
            _tid = get_active_trace()
            if _tid:
                get_tracer().record_span(_tid, {
                    "type": SPAN_MEMORY_OP,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "duration_ms": 0,
                    "operation": "store",
                    "memory_type": memory_type,
                    "title": title[:100],
                    "node_id": node_id,
                    "gate_filter": "passed" if cfg.memory.gate_filter_enabled else "disabled",
                    "contradiction": contradiction_flag,
                })
        except Exception:
            pass
        result_msg = f"Stored: \"{title}\" ({node_id})"
        if cluster:
            result_msg += f" [→ cluster: {cluster}]"
        if contradiction_flag:
            logger.warning("Contradiction detected on store: %s (%s)", title, node_id)
            result_msg += (
                "\n\n⚠ Contradiction detected — this content may conflict with "
                "existing memories. Use manage_conflicts(action=\"list\") to review."
            )
        return result_msg

    except Exception as e:
        logger.error("store_memory failed: %s", e)
        try:
            get_tracker().record_fail("create_node", str(e))
        except Exception:
            pass
        return f"Error storing memory: {e}"


# =============================================================================
# 2. RECALL MEMORY
# =============================================================================

RECALL_TOOL_DEF = {
    "name": "recall_memory",
    "description": (
        "Search or browse your persistent memory.\n\n"
        "Modes:\n"
        "  search (default) — Semantic search by query. Requires query.\n"
        "  browse — List by type/lifecycle. No query needed.\n\n"
        "Examples:\n"
        '  {"query": "BTC support levels"}\n'
        '  {"mode": "browse", "memory_type": "thesis", "active_only": true}\n'
        '  {"query": "BTC", "time_start": "2026-01-01", "time_end": "2026-01-31"}'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "mode": {
                "type": "string",
                "enum": ["search", "browse"],
                "description": "search (default) = semantic search by query. browse = list by type/lifecycle.",
            },
            "query": {
                "type": "string",
                "description": "What to search for (required for search mode, ignored in browse mode).",
            },
            "memory_type": {
                "type": "string",
                "enum": [
                    "watchpoint", "curiosity", "lesson", "thesis", "episode", "trade", "signal",
                    "trade_entry", "trade_modify", "trade_close",
                ],
                "description": "Filter by memory type.",
            },
            "active_only": {
                "type": "boolean",
                "description": "Only return active memories (not expired/archived). Default false.",
            },
            "limit": {
                "type": "integer",
                "description": "Max results to return. Default 10.",
            },
            "time_start": {
                "type": "string",
                "description": "ISO date/datetime — only return memories after this time. Search mode only.",
            },
            "time_end": {
                "type": "string",
                "description": "ISO date/datetime — only return memories before this time. Search mode only.",
            },
            "time_type": {
                "type": "string",
                "enum": ["event", "ingestion", "any"],
                "description": "Timestamp to filter: event (when it happened), ingestion (when stored), any (either). Default: any.",
            },
            "cluster": {
                "type": "string",
                "description": "Cluster ID to search within (search mode only).",
            },
        },
        "required": [],
    },
}


def _format_memory_results(results: list[dict], header: str) -> str:
    """Format a list of Nous nodes for display to the agent."""
    if not results:
        return header

    lines = [header]
    for i, node in enumerate(results, 1):
        title = node.get("content_title", "Untitled")
        ntype = node.get("subtype", node.get("type", "?"))
        # Strip custom: prefix for display
        if ntype.startswith("custom:"):
            ntype = ntype[7:]
        date = node.get("provenance_created_at", "?")[:10]
        node_id = node.get("id", "?")
        lifecycle = node.get("state_lifecycle", "")

        # Preview from body (primary) or summary (fallback)
        body = node.get("content_body", "") or ""
        summary = node.get("content_summary", "") or ""

        # Parse JSON bodies first (trades, watchpoints store JSON with "text" key)
        preview = ""
        if body.startswith("{"):
            try:
                parsed = json.loads(body)
                preview = parsed.get("text", "")
            except (json.JSONDecodeError, TypeError):
                pass

        # Use body as primary, summary only as fallback when body is empty
        if not preview:
            preview = body or summary

        lifecycle_tag = f" [{lifecycle}]" if lifecycle and lifecycle != "ACTIVE" else ""
        lines.append(f"{i}. [{ntype}] {title} ({date}, {node_id}){lifecycle_tag}")
        if preview:
            lines.append(f"   {preview}")

        # Show SSA score + primary signal when available (search mode only)
        score = node.get("score")
        primary = node.get("primary_signal")
        if score:
            score_pct = int(float(score) * 100)
            lines.append(f"   Score: {score_pct}%{f' (via {primary})' if primary else ''}")

    return "\n".join(lines)


def handle_recall_memory(
    mode: str = "search",
    query: Optional[str] = None,
    memory_type: Optional[str] = None,
    active_only: bool = False,
    limit: int = 10,
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    time_type: Optional[str] = None,
    cluster: Optional[str] = None,
) -> str:
    """Search or browse memories in Nous."""
    from ...nous.client import get_client

    # Map memory_type to subtype filter
    subtype = None
    node_type = None
    if memory_type and memory_type in _TYPE_MAP:
        node_type, subtype = _TYPE_MAP[memory_type]

    lifecycle = "ACTIVE" if active_only else None

    try:
        client = get_client()

        if mode == "browse":
            # Browse mode — list by type/lifecycle, no query needed
            results = client.list_nodes(
                type=node_type,
                subtype=subtype,
                lifecycle=lifecycle,
                limit=limit,
            )

            if not results:
                filters = []
                if memory_type:
                    filters.append(f"type={memory_type}")
                if active_only:
                    filters.append("active only")
                filter_str = f" ({', '.join(filters)})" if filters else ""
                return f"No memories found{filter_str}."

            type_label = memory_type or "all types"
            header = f"Found {len(results)} memories ({type_label}):\n"
            result_text = _format_memory_results(results, header)
            # Record recall span (browse)
            try:
                from datetime import datetime, timezone
                from ...core.request_tracer import get_active_trace
                _tid = get_active_trace()
                if _tid:
                    get_tracer().record_span(_tid, {
                        "type": SPAN_MEMORY_OP,
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "duration_ms": 0,
                        "operation": "recall",
                        "mode": "browse",
                        "memory_type": memory_type,
                        "results_count": len(results),
                    })
            except Exception:
                pass
            return result_text

        else:
            # Search mode (default) — semantic search by query
            if not query:
                return "Error: query is required for search mode. Use mode=\"browse\" to list without a query."

            # Build time_range filter if any time parameters provided
            time_range = None
            if time_start or time_end:
                time_range = {"type": time_type or "any"}
                if time_start:
                    time_range["start"] = time_start
                if time_end:
                    time_range["end"] = time_end

            # Use orchestrator for intelligent multi-pass search
            from ...core.config import load_config
            orch_config = load_config()
            if orch_config.orchestrator.enabled:
                from ..retrieval_orchestrator import orchestrate_retrieval
                results = orchestrate_retrieval(
                    query=query,
                    client=client,
                    config=orch_config,
                    type_filter=node_type,
                    subtype_filter=subtype,
                    lifecycle_filter=lifecycle,
                    time_range=time_range,
                    cluster_ids=[cluster] if cluster else None,
                )
                # Cap to requested limit (orchestrator may return up to max_results)
                if len(results) > limit:
                    results = results[:limit]
            else:
                results = client.search(
                    query=query,
                    type=node_type,
                    subtype=subtype,
                    lifecycle=lifecycle,
                    limit=limit,
                    time_range=time_range,
                    cluster_ids=[cluster] if cluster else None,
                )

            if not results:
                return f"No memories found for: \"{query}\""

            # Hebbian: strengthen edges between co-retrieved memories (MF-1)
            # Higher amount (0.05) than auto-retrieval (0.03) since agent explicitly asked
            if len(results) > 1:
                from ..memory_manager import _strengthen_co_retrieved
                _strengthen_co_retrieved(client, results, amount=0.05)

            header = f"Found {len(results)} memories:\n"
            result_text = _format_memory_results(results, header)
            # Record recall span
            try:
                from datetime import datetime, timezone
                from ...core.request_tracer import get_active_trace
                _tid = get_active_trace()
                if _tid:
                    get_tracer().record_span(_tid, {
                        "type": SPAN_MEMORY_OP,
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "duration_ms": 0,
                        "operation": "recall",
                        "mode": mode,
                        "query": query[:200] if query else None,
                        "results_count": len(results),
                    })
            except Exception:
                pass
            return result_text

    except Exception as e:
        logger.error("recall_memory failed: %s", e)
        return f"Error recalling memories: {e}"


# =============================================================================
# 3. UPDATE MEMORY
# =============================================================================

UPDATE_TOOL_DEF = {
    "name": "update_memory",
    "description": (
        "Update an existing memory node. Use this instead of delete + re-create — "
        "it preserves the node ID, all edges, and FSRS stability.\n\n"
        "Use cases:\n"
        "  - Append new evidence to an existing thesis\n"
        "  - Correct errors in stored memories\n"
        "  - Annotate old predictions with outcomes\n"
        "  - Change a memory's lifecycle state\n\n"
        "You need the node_id — get it from recall_memory results.\n\n"
        "For appending: use append_text to add content to the existing body "
        "without replacing it. A separator line is added automatically."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "node_id": {
                "type": "string",
                "description": "ID of the memory to update (from recall_memory results).",
            },
            "title": {
                "type": "string",
                "description": "New title for the memory.",
            },
            "content": {
                "type": "string",
                "description": "New body content (replaces existing body entirely).",
            },
            "summary": {
                "type": "string",
                "description": "New summary for the memory.",
            },
            "append_text": {
                "type": "string",
                "description": (
                    "Text to append to the existing body (doesn't replace). "
                    "For JSON bodies (trades, watchpoints), appends to the 'text' field."
                ),
            },
            "lifecycle": {
                "type": "string",
                "enum": ["ACTIVE", "WEAK", "DORMANT"],
                "description": "Change the memory's lifecycle state.",
            },
        },
        "required": ["node_id"],
    },
}


def handle_update_memory(
    node_id: str,
    title: Optional[str] = None,
    content: Optional[str] = None,
    summary: Optional[str] = None,
    append_text: Optional[str] = None,
    lifecycle: Optional[str] = None,
) -> str:
    """Update an existing memory node in Nous."""
    from ...nous.client import get_client

    # Must provide at least one field to update
    if not any([title, content, summary, append_text, lifecycle]):
        return "Error: provide at least one field to update (title, content, summary, append_text, or lifecycle)."

    # Can't both replace and append content
    if content and append_text:
        return "Error: provide either content (replace) or append_text (append), not both."

    try:
        client = get_client()

        # Verify node exists
        node = client.get_node(node_id)
        if not node:
            return f"Error: node {node_id} not found."

        old_title = node.get("content_title", "Untitled")

        # Build update dict with correct Nous field names
        updates = {}

        if title:
            updates["content_title"] = title

        if summary:
            updates["content_summary"] = summary

        if lifecycle:
            updates["state_lifecycle"] = lifecycle

        if content:
            updates["content_body"] = content

        if append_text:
            existing_body = node.get("content_body", "") or ""

            # Handle JSON bodies (trades, watchpoints store JSON with "text" key)
            if existing_body.startswith("{"):
                try:
                    parsed = json.loads(existing_body)
                    existing_text = parsed.get("text", "")
                    parsed["text"] = existing_text + "\n\n---\n\n" + append_text
                    updates["content_body"] = json.dumps(parsed)
                except (json.JSONDecodeError, TypeError):
                    # Malformed JSON — treat as plain text
                    updates["content_body"] = existing_body + "\n\n---\n\n" + append_text
            else:
                # Plain text body — just append
                updates["content_body"] = existing_body + "\n\n---\n\n" + append_text

        # Apply the update
        client.update_node(node_id, **updates)

        # Build confirmation message
        changed = []
        if title:
            changed.append(f"title → \"{title}\"")
        if content:
            changed.append("content (replaced)")
        if append_text:
            changed.append("content (appended)")
        if summary:
            changed.append("summary")
        if lifecycle:
            changed.append(f"lifecycle → {lifecycle}")

        display_title = title or old_title
        logger.info("Updated memory: \"%s\" (%s) — %s", display_title, node_id, ", ".join(changed))
        return f"Updated: \"{display_title}\" ({node_id}) — {', '.join(changed)}"

    except Exception as e:
        logger.error("update_memory failed: %s", e)
        return f"Error updating memory: {e}"


# =============================================================================
# 4. REGISTRATION
# =============================================================================

def register(registry):
    """Register memory tools."""
    from .registry import Tool

    registry.register(Tool(
        name=STORE_TOOL_DEF["name"],
        description=STORE_TOOL_DEF["description"],
        parameters=STORE_TOOL_DEF["parameters"],
        handler=handle_store_memory,
        background=False,
    ))

    registry.register(Tool(
        name=RECALL_TOOL_DEF["name"],
        description=RECALL_TOOL_DEF["description"],
        parameters=RECALL_TOOL_DEF["parameters"],
        handler=handle_recall_memory,
    ))

    registry.register(Tool(
        name=UPDATE_TOOL_DEF["name"],
        description=UPDATE_TOOL_DEF["description"],
        parameters=UPDATE_TOOL_DEF["parameters"],
        handler=handle_update_memory,
    ))
