"""
Delete / Archive Memory Tool — delete_memory

Lets the agent remove or archive memories and their connections from the
knowledge graph. Use cases: cleaning up stale watchpoints, archiving
invalidated theses, removing incorrect data, pruning duplicates.

Standard tool module pattern:
  1. TOOL_DEF dict
  2. handler function
  3. register() wires into registry
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


TOOL_DEF = {
    "name": "delete_memory",
    "description": (
        "Delete or archive a memory node from your knowledge graph.\n\n"
        "Use cases:\n"
        "  - Archive an invalidated thesis (keeps data, hides from active queries)\n"
        "  - Archive a resolved watchpoint or stale trade entry\n"
        "  - Delete a memory that's just wrong or a duplicate\n"
        "  - Break a specific edge between two memories\n\n"
        "You need the node ID or edge ID — get them from recall_memory results.\n\n"
        "Actions:\n"
        "  archive — Mark a node DORMANT. It won't appear in active queries but data is preserved. "
        "USE THIS for invalidated theses, resolved setups, expired watchpoints.\n"
        "  delete_node — Permanently remove a memory node. Use for wrong data or duplicates.\n"
        "  delete_edge — Remove a single edge (connection) between two memories."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["archive", "delete_node", "delete_edge"],
                "description": "What to do. Prefer 'archive' over 'delete_node' — archive preserves data.",
            },
            "node_id": {
                "type": "string",
                "description": "ID of the memory node (for archive or delete_node action).",
            },
            "edge_id": {
                "type": "string",
                "description": "ID of the edge to delete (for delete_edge action).",
            },
            "delete_edges": {
                "type": "boolean",
                "description": "Also delete all edges connected to this node (delete_node only). Default true.",
            },
        },
        "required": ["action"],
    },
}


def handle_delete_memory(
    action: str,
    node_id: Optional[str] = None,
    edge_id: Optional[str] = None,
    delete_edges: bool = True,
) -> str:
    """Delete or archive a memory node or edge from Nous."""
    from ...nous.client import get_client

    try:
        client = get_client()

        if action == "archive":
            if not node_id:
                return "Error: node_id is required for archive action."

            node = client.get_node(node_id)
            if not node:
                return f"Error: node {node_id} not found."

            title = node.get("content_title", "Untitled")
            current = node.get("state_lifecycle", "ACTIVE")

            if current == "DORMANT":
                return f"Already archived: \"{title}\" ({node_id})"

            client.update_node(node_id, state_lifecycle="DORMANT")
            logger.info("Archived node: \"%s\" (%s) %s → DORMANT", title, node_id, current)
            return f"Archived: \"{title}\" ({node_id}) — now DORMANT, preserved but hidden from active queries"

        elif action == "delete_node":
            if not node_id:
                return "Error: node_id is required for delete_node action."

            # Fetch node first to confirm it exists and get its title
            node = client.get_node(node_id)
            if not node:
                return f"Error: node {node_id} not found."

            title = node.get("content_title", "Untitled")

            # Delete connected edges first if requested
            edges_deleted = 0
            if delete_edges:
                edges = client.get_edges(node_id, direction="both")
                for edge in edges:
                    eid = edge.get("id")
                    if eid:
                        client.delete_edge(eid)
                        edges_deleted += 1

            # Delete the node
            success = client.delete_node(node_id)
            if not success:
                return f"Error: failed to delete node {node_id}."

            result = f"Deleted: \"{title}\" ({node_id})"
            if edges_deleted:
                result += f" + {edges_deleted} edge(s)"
            logger.info("Deleted node: \"%s\" (%s) + %d edges", title, node_id, edges_deleted)
            return result

        elif action == "delete_edge":
            if not edge_id:
                return "Error: edge_id is required for delete_edge action."

            success = client.delete_edge(edge_id)
            if not success:
                return f"Error: failed to delete edge {edge_id} (may not exist)."

            logger.info("Deleted edge: %s", edge_id)
            return f"Deleted edge: {edge_id}"

        else:
            return f"Error: unknown action '{action}'. Use archive, delete_node, or delete_edge."

    except Exception as e:
        logger.error("delete_memory failed: %s", e)
        return f"Error: {e}"


def register(registry):
    """Register delete_memory tool."""
    from .registry import Tool

    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_delete_memory,
    ))
