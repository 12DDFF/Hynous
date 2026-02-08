"""
Delete Memory Tool — delete_memory

Lets the agent remove memories and their connections from the knowledge graph.
Use cases: cleaning up stale watchpoints, removing incorrect data, pruning
duplicates, breaking outdated links.

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
        "Delete a memory node (and optionally its edges) from your knowledge graph.\n\n"
        "Use cases:\n"
        "  - Remove a fired watchpoint you no longer need\n"
        "  - Delete a memory that turned out to be wrong\n"
        "  - Clean up duplicate entries\n"
        "  - Break a specific edge between two memories\n\n"
        "You need the node ID or edge ID — get them from recall_memory results.\n\n"
        "Actions:\n"
        "  delete_node — Remove a memory node. Optionally remove all its edges too.\n"
        "  delete_edge — Remove a single edge (connection) between two memories."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["delete_node", "delete_edge"],
                "description": "What to delete.",
            },
            "node_id": {
                "type": "string",
                "description": "ID of the memory node to delete (for delete_node action).",
            },
            "edge_id": {
                "type": "string",
                "description": "ID of the edge to delete (for delete_edge action).",
            },
            "delete_edges": {
                "type": "boolean",
                "description": "Also delete all edges connected to this node. Default true.",
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
    """Delete a memory node or edge from Nous."""
    from ...nous.client import get_client

    try:
        client = get_client()

        if action == "delete_node":
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
            return f"Error: unknown action '{action}'. Use delete_node or delete_edge."

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
