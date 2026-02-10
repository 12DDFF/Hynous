"""
Cluster Management Tool — manage_clusters

Lets the agent organize memories into named clusters for scoped search
and knowledge organization.

Actions:
  list    — List all clusters with node counts
  create  — Create a new cluster
  update  — Update cluster properties
  delete  — Delete a cluster
  add     — Add node(s) to a cluster
  remove  — Remove a node from a cluster
  members — List members of a cluster
  health  — Get health stats for a cluster

Standard tool module pattern:
  1. TOOL_DEF dict
  2. handler function
  3. register() wires into registry
"""

import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)


TOOL_DEF = {
    "name": "manage_clusters",
    "description": (
        "Organize your memories into clusters for scoped search and "
        "knowledge management.\n\n"
        "Clusters group related memories — by asset (BTC, ETH), strategy "
        "(momentum, mean-reversion), market regime (bull, bear), or any "
        "category you choose.\n\n"
        "Actions:\n"
        "  list — List all clusters with node counts.\n"
        "  create — Create a new cluster. Optionally set auto_subtypes "
        "to auto-assign future memories.\n"
        "  update — Update cluster name, description, icon, pinned, "
        "or auto_subtypes.\n"
        "  delete — Delete a cluster (memories are NOT deleted, only "
        "the grouping).\n"
        "  add — Add memory node(s) to a cluster.\n"
        "  remove — Remove a memory from a cluster.\n"
        "  members — List memories in a cluster.\n"
        "  health — Show cluster health (active/weak/dormant counts).\n\n"
        "Auto-assignment: When you create a cluster with auto_subtypes "
        "(e.g. [\"thesis\", \"lesson\"]), all future memories of those "
        "types are automatically added to the cluster. A memory can "
        "belong to multiple clusters.\n\n"
        "Examples:\n"
        '  {"action": "list"}\n'
        '  {"action": "create", "name": "BTC Analysis", '
        '"description": "All BTC-related memories", '
        '"auto_subtypes": ["thesis", "lesson", "signal"]}\n'
        '  {"action": "add", "cluster_id": "cl_abc123", '
        '"node_id": "n_def456"}\n'
        '  {"action": "add", "cluster_id": "cl_abc123", '
        '"node_ids": ["n_def456", "n_ghi789"]}\n'
        '  {"action": "members", "cluster_id": "cl_abc123"}\n'
        '  {"action": "health", "cluster_id": "cl_abc123"}'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "list", "create", "update", "delete",
                    "add", "remove", "members", "health",
                ],
                "description": "What to do.",
            },
            "cluster_id": {
                "type": "string",
                "description": (
                    "Cluster ID (for update, delete, add, remove, "
                    "members, health actions)."
                ),
            },
            "name": {
                "type": "string",
                "description": "Cluster name (for create/update).",
            },
            "description": {
                "type": "string",
                "description": "Cluster description (for create/update).",
            },
            "icon": {
                "type": "string",
                "description": "Emoji or icon (for create/update).",
            },
            "pinned": {
                "type": "boolean",
                "description": "Pin cluster to top of list (for create/update).",
            },
            "auto_subtypes": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Memory types to auto-assign to this cluster. "
                    "Use short names: thesis, lesson, signal, episode, "
                    "trade, curiosity, watchpoint, trade_entry, "
                    "trade_close, trade_modify."
                ),
            },
            "node_id": {
                "type": "string",
                "description": "Memory ID to add/remove (for add/remove actions).",
            },
            "node_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Multiple memory IDs to add (for add action).",
            },
            "limit": {
                "type": "integer",
                "description": "Max results for members action. Default 50.",
            },
        },
        "required": ["action"],
    },
}

# Short name → full subtype mapping (same subtypes as memory.py _TYPE_MAP)
_SUBTYPE_MAP = {
    "watchpoint": "custom:watchpoint",
    "curiosity": "custom:curiosity",
    "lesson": "custom:lesson",
    "thesis": "custom:thesis",
    "episode": "custom:market_event",
    "trade": "custom:trade",
    "signal": "custom:signal",
    "trade_entry": "custom:trade_entry",
    "trade_modify": "custom:trade_modify",
    "trade_close": "custom:trade_close",
    "turn_summary": "custom:turn_summary",
    "session_summary": "custom:session_summary",
}


def _normalize_subtypes(raw: list[str]) -> list[str]:
    """Convert short names to full custom: subtypes."""
    normalized = []
    for st in raw:
        if st in _SUBTYPE_MAP:
            normalized.append(_SUBTYPE_MAP[st])
        elif st.startswith("custom:"):
            normalized.append(st)
        else:
            # Unknown short name — prepend custom: as fallback
            normalized.append(f"custom:{st}")
    return normalized


def _format_subtypes_display(subtypes: list) -> str:
    """Format subtypes for display — strip custom: prefix."""
    return ", ".join(
        s.replace("custom:", "") if isinstance(s, str) else str(s)
        for s in subtypes
    )


def handle_manage_clusters(
    action: str,
    cluster_id: Optional[str] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
    icon: Optional[str] = None,
    pinned: Optional[bool] = None,
    auto_subtypes: Optional[list] = None,
    node_id: Optional[str] = None,
    node_ids: Optional[list] = None,
    limit: int = 50,
) -> str:
    """Handle all cluster management actions."""
    from ...nous.client import get_client

    try:
        client = get_client()

        # ---- LIST ----
        if action == "list":
            clusters = client.list_clusters()

            if not clusters:
                return "No clusters. Use create action to make one."

            lines = [f"{len(clusters)} cluster(s):", ""]

            for cl in clusters:
                cid = cl.get("id", "?")
                cname = cl.get("name", "Untitled")
                count = cl.get("node_count", 0)
                is_pinned = cl.get("pinned", 0)
                desc = cl.get("description", "")
                auto_subs = cl.get("auto_subtypes")

                pin_tag = " [pinned]" if is_pinned else ""
                lines.append(f"  {cname} ({cid}) — {count} nodes{pin_tag}")

                if desc:
                    lines.append(f"    {desc}")

                if auto_subs and isinstance(auto_subs, list) and len(auto_subs) > 0:
                    lines.append(
                        f"    Auto-assigns: {_format_subtypes_display(auto_subs)}"
                    )

                lines.append("")

            return "\n".join(lines)

        # ---- CREATE ----
        elif action == "create":
            if not name:
                return "Error: name is required for create action."

            # Normalize auto_subtypes to full form
            normalized_subs = None
            if auto_subtypes:
                normalized_subs = _normalize_subtypes(auto_subtypes)

            result = client.create_cluster(
                name=name,
                description=description,
                icon=icon,
                pinned=pinned or False,
                auto_subtypes=normalized_subs,
            )

            cid = result.get("id", "?")
            logger.info("Created cluster: \"%s\" (%s)", name, cid)

            lines = [f"Created cluster: \"{name}\" ({cid})"]
            if normalized_subs:
                lines.append(
                    f"Auto-assigns: {_format_subtypes_display(normalized_subs)}"
                )
            return "\n".join(lines)

        # ---- UPDATE ----
        elif action == "update":
            if not cluster_id:
                return "Error: cluster_id is required for update action."

            kwargs: dict = {}
            if name is not None:
                kwargs["name"] = name
            if description is not None:
                kwargs["description"] = description
            if icon is not None:
                kwargs["icon"] = icon
            if pinned is not None:
                kwargs["pinned"] = pinned
            if auto_subtypes is not None:
                kwargs["auto_subtypes"] = _normalize_subtypes(auto_subtypes)

            if not kwargs:
                return "Error: provide at least one field to update."

            result = client.update_cluster(cluster_id, **kwargs)
            updated_name = result.get("name", cluster_id)

            changed = list(kwargs.keys())
            logger.info(
                "Updated cluster: \"%s\" (%s) — %s",
                updated_name, cluster_id, ", ".join(changed),
            )
            return (
                f"Updated: \"{updated_name}\" ({cluster_id}) "
                f"— {', '.join(changed)}"
            )

        # ---- DELETE ----
        elif action == "delete":
            if not cluster_id:
                return "Error: cluster_id is required for delete action."

            client.delete_cluster(cluster_id)
            logger.info("Deleted cluster: %s", cluster_id)
            return (
                f"Deleted cluster {cluster_id}. "
                "Memories are NOT deleted — only the grouping is removed."
            )

        # ---- ADD ----
        elif action == "add":
            if not cluster_id:
                return "Error: cluster_id is required for add action."
            if not node_id and not node_ids:
                return "Error: node_id or node_ids is required for add action."

            result = client.add_to_cluster(
                cluster_id, node_id=node_id, node_ids=node_ids,
            )
            added = result.get("added", 0)
            total = len(node_ids) if node_ids else 1

            logger.info(
                "Added %d node(s) to cluster %s", added, cluster_id,
            )
            return f"Added {added}/{total} node(s) to cluster {cluster_id}."

        # ---- REMOVE ----
        elif action == "remove":
            if not cluster_id:
                return "Error: cluster_id is required for remove action."
            if not node_id:
                return "Error: node_id is required for remove action."

            client.remove_from_cluster(cluster_id, node_id)
            logger.info(
                "Removed %s from cluster %s", node_id, cluster_id,
            )
            return f"Removed {node_id} from cluster {cluster_id}."

        # ---- MEMBERS ----
        elif action == "members":
            if not cluster_id:
                return "Error: cluster_id is required for members action."

            members = client.get_cluster_members(cluster_id, limit=limit)

            if not members:
                return f"Cluster {cluster_id} has no members."

            lines = [f"Cluster {cluster_id} — {len(members)} member(s):", ""]

            for i, node in enumerate(members, 1):
                title = node.get("content_title", "Untitled")
                ntype = node.get("subtype", node.get("type", "?"))
                if isinstance(ntype, str) and ntype.startswith("custom:"):
                    ntype = ntype[7:]
                date = str(node.get("provenance_created_at", "?"))[:10]
                nid = node.get("id", "?")
                lifecycle = node.get("state_lifecycle", "")

                lifecycle_tag = (
                    f" [{lifecycle}]"
                    if lifecycle and lifecycle != "ACTIVE"
                    else ""
                )
                lines.append(
                    f"  {i}. [{ntype}] {title} ({date}, {nid}){lifecycle_tag}"
                )

                # Preview
                body = node.get("content_body", "") or ""
                summary = node.get("content_summary", "") or ""
                preview = ""
                if body.startswith("{"):
                    try:
                        parsed = json.loads(body)
                        preview = parsed.get("text", "")
                    except (json.JSONDecodeError, TypeError):
                        pass
                if not preview:
                    preview = body or summary
                if preview:
                    if len(preview) > 150:
                        preview = preview[:147] + "..."
                    lines.append(f"     {preview}")

            return "\n".join(lines)

        # ---- HEALTH ----
        elif action == "health":
            if not cluster_id:
                return "Error: cluster_id is required for health action."

            health = client.get_cluster_health(cluster_id)

            name_str = health.get("name", cluster_id)
            total = health.get("total_nodes", 0)
            active = health.get("active_nodes", 0)
            weak = health.get("weak_nodes", 0)
            dormant = health.get("dormant_nodes", 0)
            ratio = health.get("health_ratio", 0)
            pct = int(ratio * 100)

            return (
                f"{name_str} ({cluster_id}) — Health: {pct}%\n"
                f"  Total: {total} | Active: {active} | "
                f"Weak: {weak} | Dormant: {dormant}"
            )

        else:
            return (
                f"Error: unknown action '{action}'. "
                "Use list, create, update, delete, add, remove, members, or health."
            )

    except Exception as e:
        logger.error("manage_clusters failed: %s", e)
        return f"Error: {e}"


def register(registry):
    """Register manage_clusters tool."""
    from .registry import Tool

    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_manage_clusters,
    ))
