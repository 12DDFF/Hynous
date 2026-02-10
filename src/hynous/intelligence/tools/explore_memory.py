"""
Explore Memory Tool — explore_memory

Lets the agent inspect the knowledge graph: see what a memory is connected to,
manually link two memories, or remove incorrect edges.

Actions:
  explore — Show a memory's connections (1-hop graph neighborhood)
  link    — Create an edge between two memories
  unlink  — Remove an edge

Standard tool module pattern:
  1. TOOL_DEF dict
  2. handler function
  3. register() wires into registry
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


TOOL_DEF = {
    "name": "explore_memory",
    "description": (
        "Inspect and manage connections in your knowledge graph.\n\n"
        "Actions:\n"
        "  explore — Show a memory's connections (what it's linked to).\n"
        "  link — Create a new edge between two memories.\n"
        "  unlink — Remove an edge between memories.\n\n"
        "Use explore to navigate your knowledge graph: follow trade lifecycle\n"
        "chains (entry → modify → close), discover related theses, or audit\n"
        "auto-generated links.\n\n"
        "Examples:\n"
        '  {"action": "explore", "node_id": "n_abc123"}\n'
        '  {"action": "link", "source_id": "n_abc", "target_id": "n_def", '
        '"edge_type": "relates_to"}\n'
        '  {"action": "unlink", "edge_id": "e_xyz789"}'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["explore", "link", "unlink"],
                "description": "What to do.",
            },
            "node_id": {
                "type": "string",
                "description": "Memory to explore (for explore action).",
            },
            "direction": {
                "type": "string",
                "enum": ["in", "out", "both"],
                "description": "Edge direction to show. Default both.",
            },
            "source_id": {
                "type": "string",
                "description": "Source memory ID (for link action).",
            },
            "target_id": {
                "type": "string",
                "description": "Target memory ID (for link action).",
            },
            "edge_type": {
                "type": "string",
                "enum": ["relates_to", "part_of", "causes", "supports", "contradicts"],
                "description": "Type of edge to create (for link action). Default relates_to.",
            },
            "edge_id": {
                "type": "string",
                "description": "Edge ID to remove (for unlink action).",
            },
        },
        "required": ["action"],
    },
}


def handle_explore_memory(
    action: str,
    node_id: Optional[str] = None,
    direction: str = "both",
    source_id: Optional[str] = None,
    target_id: Optional[str] = None,
    edge_type: str = "relates_to",
    edge_id: Optional[str] = None,
) -> str:
    """Explore, link, or unlink memories in the knowledge graph."""
    from ...nous.client import get_client

    try:
        client = get_client()

        if action == "explore":
            if not node_id:
                return "Error: node_id is required for explore action."

            # Get the starting node
            node = client.get_node(node_id)
            if not node:
                return f"Error: node {node_id} not found."

            title = node.get("content_title", "Untitled")
            ntype = node.get("subtype", node.get("type", "?"))
            if ntype.startswith("custom:"):
                ntype = ntype[7:]

            # Get all edges
            edges = client.get_edges(node_id, direction=direction)

            if not edges:
                return f"[{ntype}] {title} ({node_id})\n\nNo connections."

            # Fetch connected node titles
            lines = [f"[{ntype}] {title} ({node_id})", "", "Connections:"]

            for edge in edges:
                eid = edge.get("id", "?")
                etype = edge.get("type", "?")
                src = edge.get("source_id", "")
                tgt = edge.get("target_id", "")
                strength = edge.get("strength")

                # Determine direction and connected node
                if src == node_id:
                    # Outgoing edge
                    connected_id = tgt
                    arrow = "→"
                else:
                    # Incoming edge
                    connected_id = src
                    arrow = "←"

                # Fetch connected node title
                connected_title = connected_id
                connected_type = "?"
                try:
                    connected_node = client.get_node(connected_id)
                    if connected_node:
                        connected_title = connected_node.get("content_title", connected_id)
                        connected_type = connected_node.get("subtype", connected_node.get("type", "?"))
                        if connected_type.startswith("custom:"):
                            connected_type = connected_type[7:]
                except Exception:
                    pass

                strength_str = f" (str: {strength:.2f})" if strength is not None else ""
                lines.append(
                    f"  {arrow} [{etype}] {arrow} [{connected_type}] {connected_title} "
                    f"({connected_id}){strength_str} — edge: {eid}"
                )

            return "\n".join(lines)

        elif action == "link":
            if not source_id or not target_id:
                return "Error: source_id and target_id are required for link action."

            edge = client.create_edge(
                source_id=source_id,
                target_id=target_id,
                type=edge_type,
            )

            eid = edge.get("id", "?")
            logger.info("Created edge: %s → %s [%s] (%s)", source_id, target_id, edge_type, eid)
            return f"Linked: {source_id} → {target_id} [{edge_type}] (edge: {eid})"

        elif action == "unlink":
            if not edge_id:
                return "Error: edge_id is required for unlink action."

            success = client.delete_edge(edge_id)
            if not success:
                return f"Error: failed to delete edge {edge_id} (may not exist)."

            logger.info("Deleted edge: %s", edge_id)
            return f"Unlinked: edge {edge_id} removed."

        else:
            return f"Error: unknown action '{action}'. Use explore, link, or unlink."

    except Exception as e:
        logger.error("explore_memory failed: %s", e)
        return f"Error: {e}"


def register(registry):
    """Register explore_memory tool."""
    from .registry import Tool

    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_explore_memory,
    ))
