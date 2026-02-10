"""
Conflict Management Tool — manage_conflicts

Lets the agent inspect and resolve contradictions detected by Nous.
When the agent stores content with correction markers ("actually",
"I was wrong", "update:"), Nous queues potential conflicts for review.

Actions:
  list    — Show pending (or resolved) conflicts in the queue
  resolve — Resolve a conflict with a chosen strategy

Standard tool module pattern:
  1. TOOL_DEF dict
  2. handler function
  3. register() wires into registry
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


TOOL_DEF = {
    "name": "manage_conflicts",
    "description": (
        "Inspect and resolve contradictions in your knowledge base.\n\n"
        "When you store memories containing correction markers "
        '("actually", "I was wrong", "update:"), the system detects '
        "potential contradictions and queues them for your review.\n\n"
        "Actions:\n"
        "  list — Show pending conflicts (or filter by status).\n"
        "  resolve — Resolve a conflict with your decision.\n\n"
        "Resolution strategies:\n"
        "  old_is_current — The old memory is correct, new one is wrong.\n"
        "  new_is_current — The new memory supersedes the old one.\n"
        "  keep_both — Both are valid (e.g. different contexts).\n"
        "  merge — Both contain useful info, should be combined.\n\n"
        "Examples:\n"
        '  {"action": "list"}\n'
        '  {"action": "list", "status": "resolved"}\n'
        '  {"action": "resolve", "conflict_id": "c_abc123", '
        '"resolution": "new_is_current"}'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list", "resolve"],
                "description": "What to do.",
            },
            "status": {
                "type": "string",
                "enum": ["pending", "resolved"],
                "description": "Filter conflicts by status (for list action). Default pending.",
            },
            "conflict_id": {
                "type": "string",
                "description": "Conflict ID to resolve (for resolve action).",
            },
            "resolution": {
                "type": "string",
                "enum": ["old_is_current", "new_is_current", "keep_both", "merge"],
                "description": "How to resolve the conflict (for resolve action).",
            },
        },
        "required": ["action"],
    },
}


def handle_manage_conflicts(
    action: str,
    status: str = "pending",
    conflict_id: Optional[str] = None,
    resolution: Optional[str] = None,
) -> str:
    """List or resolve conflicts in the contradiction queue."""
    from ...nous.client import get_client

    try:
        client = get_client()

        if action == "list":
            conflicts = client.get_conflicts(status=status)

            if not conflicts:
                return f"No {status} conflicts."

            lines = [f"{len(conflicts)} {status} conflict(s):", ""]

            for conflict in conflicts:
                cid = conflict.get("id", "?")
                old_id = conflict.get("old_node_id", "?")
                new_id = conflict.get("new_node_id")
                new_content = conflict.get("new_content", "")
                ctype = conflict.get("conflict_type", "?")
                confidence = conflict.get("detection_confidence", 0)
                created = conflict.get("created_at", "?")
                expires = conflict.get("expires_at", "?")

                # Fetch old node full data for comparison
                old_title = old_id
                old_body = ""
                try:
                    old_node = client.get_node(old_id)
                    if old_node:
                        old_title = old_node.get("content_title", old_id)
                        old_body = old_node.get("content_body", "") or ""
                except Exception:
                    pass

                # Fetch new node full data if it exists
                new_title = ""
                new_body = ""
                if new_id:
                    try:
                        new_node = client.get_node(new_id)
                        if new_node:
                            new_title = new_node.get("content_title", "")
                            new_body = new_node.get("content_body", "") or ""
                    except Exception:
                        pass

                lines.append(f"--- {cid} ---")
                lines.append(f"  Type: {ctype} | Confidence: {confidence:.0%}")
                lines.append(f"  Created: {created} | Expires: {expires}")
                lines.append("")

                # Old node — show full content (capped at 1000 chars)
                lines.append(f"  OLD: \"{old_title}\" ({old_id})")
                if old_body:
                    display_body = old_body[:1000]
                    if len(old_body) > 1000:
                        display_body += "..."
                    lines.append(f"  Content: {display_body}")
                lines.append("")

                # New node or new content
                if new_id and new_title:
                    lines.append(f"  NEW: \"{new_title}\" ({new_id})")
                    if new_body:
                        display_body = new_body[:1000]
                        if len(new_body) > 1000:
                            display_body += "..."
                        lines.append(f"  Content: {display_body}")
                else:
                    lines.append(f"  NEW CONTENT:")
                    display_content = new_content[:1000]
                    if len(new_content) > 1000:
                        display_content += "..."
                    lines.append(f"  {display_content}")
                lines.append("")

            lines.append(
                "Use resolve action with conflict_id and resolution "
                "(old_is_current, new_is_current, keep_both, merge)."
            )
            return "\n".join(lines)

        elif action == "resolve":
            if not conflict_id:
                return "Error: conflict_id is required for resolve action."
            if not resolution:
                return "Error: resolution is required for resolve action."

            result = client.resolve_conflict(conflict_id, resolution)

            if result.get("ok"):
                logger.info("Resolved conflict %s: %s", conflict_id, resolution)
                actions = result.get("actions", [])
                old_id = result.get("old_node_id", "?")
                new_id = result.get("new_node_id", "?")

                lines = [f"Resolved: conflict {conflict_id} — {resolution}."]
                if actions:
                    lines.append("")
                    lines.append("Actions taken:")
                    for action_desc in actions:
                        lines.append(f"  - {action_desc}")
                return "\n".join(lines)
            else:
                error = result.get("error", "unknown error")
                return f"Error resolving conflict {conflict_id}: {error}"

        else:
            return f"Error: unknown action '{action}'. Use list or resolve."

    except Exception as e:
        logger.error("manage_conflicts failed: %s", e)
        return f"Error: {e}"


def register(registry):
    """Register manage_conflicts tool."""
    from .registry import Tool

    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_manage_conflicts,
    ))
