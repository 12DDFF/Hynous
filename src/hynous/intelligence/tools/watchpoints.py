"""
Watchpoint Management Tool — manage_watchpoints

Gives the agent full control over its alert system. The daemon evaluates
these watchpoints against live market data and wakes the agent when
conditions are met.

Actions:
  create  — Set a new price/funding/sentiment alert with trigger conditions
  list    — View all active (and optionally dormant/weak) watchpoints
  delete  — Remove a watchpoint by ID (permanently)

Watchpoint lifecycle:
  ACTIVE → evaluated every poll cycle
  DORMANT → fired or expired, never re-evaluated
  Agent must create a NEW watchpoint to monitor again after one fires.

Standard tool module pattern:
  1. TOOL_DEF dict
  2. handler function
  3. register() wires into registry
"""

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


TOOL_DEF = {
    "name": "manage_watchpoints",
    "description": (
        "Manage your market alert system. Watchpoints are evaluated by your daemon "
        "against live data — when a condition is met, you get woken up with full context.\n\n"
        "Actions:\n"
        "  create — Set a new alert. You MUST provide symbol, condition, value, and context.\n"
        "  list — View your active watchpoints (and optionally include fired/expired ones).\n"
        "  delete — Remove a watchpoint permanently by its ID.\n\n"
        "Conditions: price_above, price_below, funding_above, funding_below, fear_greed_extreme\n\n"
        "Tips:\n"
        "  - After a watchpoint fires, it's DEAD. Set a new one if you still want to monitor.\n"
        "  - Include rich context — your future self needs to know WHY you set this.\n"
        "  - Include signals_at_creation — snapshot current market data for then-vs-now comparison.\n"
        "  - Default expiry is 7 days. Set longer for thesis-level monitoring.\n"
        "  - Use list to check what's active before setting duplicates."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["create", "list", "delete"],
                "description": "What to do.",
            },
            "symbol": {
                "type": "string",
                "description": "Asset symbol (e.g. BTC, ETH). Required for create.",
            },
            "condition": {
                "type": "string",
                "enum": [
                    "price_above", "price_below",
                    "funding_above", "funding_below",
                    "fear_greed_extreme",
                ],
                "description": "Trigger condition. Required for create.",
            },
            "value": {
                "type": "number",
                "description": (
                    "Threshold value. For price: USD price. For funding: decimal rate "
                    "(e.g. 0.0003). For fear_greed_extreme: fires when F&G <= value OR >= 100-value. "
                    "Required for create."
                ),
            },
            "context": {
                "type": "string",
                "description": (
                    "Why you're setting this alert. Your reasoning, thesis, what you plan to do "
                    "when it fires. Be detailed — this is shown to you on wake. Required for create."
                ),
            },
            "title": {
                "type": "string",
                "description": "Short descriptive title for the watchpoint. Required for create.",
            },
            "signals": {
                "type": "object",
                "description": (
                    "Current market snapshot to store alongside (price, funding, F&G, etc.). "
                    "Used for then-vs-now comparison when the alert fires."
                ),
            },
            "expiry_days": {
                "type": "number",
                "description": "Days until this watchpoint expires. Default 7.",
            },
            "watchpoint_id": {
                "type": "string",
                "description": "ID of the watchpoint to delete. Required for delete action.",
            },
            "include_inactive": {
                "type": "boolean",
                "description": "For list action: also show fired/expired watchpoints. Default false.",
            },
        },
        "required": ["action"],
    },
}


def handle_manage_watchpoints(
    action: str,
    symbol: Optional[str] = None,
    condition: Optional[str] = None,
    value: Optional[float] = None,
    context: Optional[str] = None,
    title: Optional[str] = None,
    signals: Optional[dict] = None,
    expiry_days: float = 7,
    watchpoint_id: Optional[str] = None,
    include_inactive: bool = False,
) -> str:
    """Manage watchpoints in Nous."""
    from ...nous.client import get_client

    try:
        client = get_client()

        if action == "create":
            return _create_watchpoint(
                client, symbol, condition, value, context, title, signals, expiry_days,
            )
        elif action == "list":
            return _list_watchpoints(client, include_inactive)
        elif action == "delete":
            return _delete_watchpoint(client, watchpoint_id)
        else:
            return f"Error: unknown action '{action}'. Use create, list, or delete."

    except Exception as e:
        logger.error("manage_watchpoints failed: %s", e)
        return f"Error: {e}"


def _create_watchpoint(
    client,
    symbol: Optional[str],
    condition: Optional[str],
    value: Optional[float],
    context: Optional[str],
    title: Optional[str],
    signals: Optional[dict],
    expiry_days: float,
) -> str:
    """Create a new watchpoint in Nous."""
    # Validate required fields
    missing = []
    if not symbol:
        missing.append("symbol")
    if not condition:
        missing.append("condition")
    if value is None:
        missing.append("value")
    if not context:
        missing.append("context")
    if not title:
        missing.append("title")
    if missing:
        return f"Error: create requires: {', '.join(missing)}"

    valid_conditions = {
        "price_above", "price_below",
        "funding_above", "funding_below",
        "fear_greed_extreme",
    }
    if condition not in valid_conditions:
        return f"Error: condition must be one of: {', '.join(sorted(valid_conditions))}"

    # Build expiry
    expiry = (datetime.now(timezone.utc) + timedelta(days=expiry_days)).isoformat()

    # Build the watchpoint body (same JSON format the daemon expects)
    body_data = {
        "text": context,
        "trigger": {
            "condition": condition,
            "symbol": symbol,
            "value": value,
            "expiry": expiry,
        },
    }
    if signals:
        body_data["signals_at_creation"] = signals

    node = client.create_node(
        type="concept",
        subtype="custom:watchpoint",
        title=title,
        body=json.dumps(body_data),
    )

    node_id = node.get("id", "?")

    # Auto-link to related memories
    from .memory import _auto_link
    _auto_link(node_id, title, context)

    logger.info("Watchpoint created: \"%s\" (%s) — %s %s %s, expires %s",
                 title, node_id, symbol, condition, value, expiry[:10])

    return (
        f"Watchpoint set: \"{title}\" ({node_id})\n"
        f"Trigger: {symbol} {condition.replace('_', ' ')} {value}\n"
        f"Expires: {expiry[:10]}"
    )


def _list_watchpoints(client, include_inactive: bool) -> str:
    """List watchpoints from Nous."""
    # Always get active
    active = client.list_nodes(
        subtype="custom:watchpoint",
        lifecycle="ACTIVE",
        limit=50,
    )

    inactive = []
    if include_inactive:
        for state in ("WEAK", "DORMANT"):
            inactive.extend(client.list_nodes(
                subtype="custom:watchpoint",
                lifecycle=state,
                limit=20,
            ))

    all_wps = active + inactive
    if not all_wps:
        return "No watchpoints found."

    lines = [f"Found {len(all_wps)} watchpoint(s) ({len(active)} active):\n"]

    for i, wp in enumerate(all_wps, 1):
        title = wp.get("content_title", "Untitled")
        node_id = wp.get("id", "?")
        lifecycle = wp.get("lifecycle_state", "?")
        date = wp.get("provenance_created_at", "?")[:10]

        # Parse trigger from body
        body = wp.get("content_body", "")
        trigger_str = "?"
        context_str = ""
        try:
            data = json.loads(body)
            trigger = data.get("trigger", {})
            sym = trigger.get("symbol", "?")
            cond = trigger.get("condition", "?").replace("_", " ")
            val = trigger.get("value", "?")
            expiry = trigger.get("expiry", "")[:10]
            trigger_str = f"{sym} {cond} {val}"
            if expiry:
                trigger_str += f" (expires {expiry})"
            context_str = data.get("text", "")[:200]
        except (json.JSONDecodeError, TypeError):
            pass

        status = "ACTIVE" if lifecycle == "ACTIVE" else lifecycle
        lines.append(f"{i}. [{status}] {title} ({date}, {node_id})")
        lines.append(f"   Trigger: {trigger_str}")
        if context_str:
            lines.append(f"   Context: {context_str}")

    return "\n".join(lines)


def _delete_watchpoint(client, watchpoint_id: Optional[str]) -> str:
    """Delete a watchpoint by ID."""
    if not watchpoint_id:
        return "Error: watchpoint_id is required for delete action."

    # Verify it exists and is a watchpoint
    node = client.get_node(watchpoint_id)
    if not node:
        return f"Error: node {watchpoint_id} not found."

    subtype = node.get("subtype", "")
    if subtype != "custom:watchpoint":
        return f"Error: {watchpoint_id} is not a watchpoint (type: {subtype})."

    title = node.get("content_title", "Untitled")

    # Delete edges
    edges = client.get_edges(watchpoint_id, direction="both")
    for edge in edges:
        eid = edge.get("id")
        if eid:
            client.delete_edge(eid)

    # Delete node
    success = client.delete_node(watchpoint_id)
    if not success:
        return f"Error: failed to delete watchpoint {watchpoint_id}."

    logger.info("Watchpoint deleted: \"%s\" (%s)", title, watchpoint_id)
    return f"Deleted watchpoint: \"{title}\" ({watchpoint_id})"


def register(registry):
    """Register manage_watchpoints tool."""
    from .registry import Tool

    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_manage_watchpoints,
    ))
