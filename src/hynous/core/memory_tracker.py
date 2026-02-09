"""
Memory Mutation Tracker — in-process log of all Nous writes per chat cycle.

Tracks every node creation, edge creation, and failure during a single
agent.chat() call. The coach reads this audit to verify graph integrity
with hard facts — zero HTTP calls, purely in-process tracking.

Usage:
    from hynous.core.memory_tracker import get_tracker

    # Agent resets at start of each chat()
    get_tracker().reset()

    # Tool modules record writes as they happen
    get_tracker().record_create("custom:trade_entry", "LONG BTC @ $97K", "node-123")
    get_tracker().record_edge("node-123", "node-456", "supports", "auto thesis link")

    # Coach reads the audit after chat() completes
    audit = get_tracker().build_audit()
    text = get_tracker().format_for_coach()
"""

import logging
import threading
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class _NodeRecord:
    subtype: str
    title: str
    node_id: str


@dataclass
class _EdgeRecord:
    source_id: str
    target_id: str
    edge_type: str
    context: str  # Brief label like "auto thesis link", "wikilink", "explicit"


@dataclass
class _FailRecord:
    operation: str  # "create_node", "create_edge", etc.
    error: str


class MutationTracker:
    """Tracks Nous writes during a single agent chat() cycle.

    Thread-safe. One singleton instance shared across the process.
    Reset at the start of each chat() so the coach only sees mutations
    from the current wake cycle.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._nodes: list[_NodeRecord] = []
        self._edges: list[_EdgeRecord] = []
        self._failures: list[_FailRecord] = []

    def reset(self):
        """Clear all tracked mutations. Called at start of each chat()."""
        with self._lock:
            self._nodes.clear()
            self._edges.clear()
            self._failures.clear()
        logger.debug("MutationTracker: reset")

    def record_create(self, subtype: str, title: str, node_id: str):
        """Record a successful node creation."""
        with self._lock:
            self._nodes.append(_NodeRecord(subtype=subtype, title=title, node_id=node_id))
        logger.debug("MutationTracker: recorded create %s '%s' (%s)", subtype, title, node_id)

    def record_edge(self, source_id: str, target_id: str, edge_type: str, context: str = ""):
        """Record a successful edge creation."""
        with self._lock:
            self._edges.append(_EdgeRecord(
                source_id=source_id, target_id=target_id,
                edge_type=edge_type, context=context,
            ))
        logger.debug("MutationTracker: recorded edge %s -[%s]-> %s", source_id, edge_type, target_id)

    def record_fail(self, operation: str, error: str):
        """Record a failed Nous write."""
        with self._lock:
            self._failures.append(_FailRecord(operation=operation, error=error))
        logger.debug("MutationTracker: recorded failure %s: %s", operation, error)

    def build_audit(self) -> dict:
        """Return structured audit data for programmatic use.

        Returns:
            {
                "nodes_created": [{"subtype": "...", "title": "...", "id": "..."}],
                "edges_created": [{"source": "...", "target": "...", "type": "...", "context": "..."}],
                "failures": [{"operation": "...", "error": "..."}],
                "summary": "Created: 2 nodes (trade_entry, thesis), 1 edge (supports). 0 failures."
            }
        """
        with self._lock:
            nodes = [{"subtype": n.subtype, "title": n.title, "id": n.node_id} for n in self._nodes]
            edges = [
                {"source": e.source_id, "target": e.target_id, "type": e.edge_type, "context": e.context}
                for e in self._edges
            ]
            failures = [{"operation": f.operation, "error": f.error} for f in self._failures]

        # Build summary string
        if nodes:
            subtypes = [n["subtype"].replace("custom:", "") for n in nodes]
            node_summary = f"{len(nodes)} node{'s' if len(nodes) != 1 else ''} ({', '.join(subtypes)})"
        else:
            node_summary = "0 nodes"

        if edges:
            edge_types = [e["type"] for e in edges]
            edge_summary = f"{len(edges)} edge{'s' if len(edges) != 1 else ''} ({', '.join(edge_types)})"
        else:
            edge_summary = "0 edges"

        fail_summary = f"{len(failures)} failure{'s' if len(failures) != 1 else ''}"

        summary = f"Created: {node_summary}, {edge_summary}. {fail_summary}."

        return {
            "nodes_created": nodes,
            "edges_created": edges,
            "failures": failures,
            "summary": summary,
        }

    def format_for_coach(self) -> str:
        """Format audit as compact text for the coach prompt (~100 tokens).

        Returns empty string if no mutations occurred.
        """
        audit = self.build_audit()

        if not audit["nodes_created"] and not audit["edges_created"] and not audit["failures"]:
            return ""

        lines = [audit["summary"]]

        if audit["nodes_created"]:
            lines.append("Nodes:")
            for n in audit["nodes_created"]:
                subtype = n["subtype"].replace("custom:", "")
                lines.append(f"  + [{subtype}] {n['title']}")

        if audit["edges_created"]:
            lines.append("Edges:")
            for e in audit["edges_created"]:
                ctx = f" ({e['context']})" if e["context"] else ""
                lines.append(f"  + {e['source'][:8]}.. -[{e['type']}]-> {e['target'][:8]}..{ctx}")

        if audit["failures"]:
            lines.append("Failures:")
            for f in audit["failures"]:
                lines.append(f"  ! {f['operation']}: {f['error'][:100]}")

        return "\n".join(lines)


# ---- Module-level singleton ----

_tracker: MutationTracker | None = None
_tracker_lock = threading.Lock()


def get_tracker() -> MutationTracker:
    """Get the global MutationTracker singleton."""
    global _tracker
    if _tracker is None:
        with _tracker_lock:
            if _tracker is None:
                _tracker = MutationTracker()
    return _tracker
