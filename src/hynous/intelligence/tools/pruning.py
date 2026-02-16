"""
Memory Pruning Tools — analyze_memory + batch_prune

Two-phase memory maintenance:
  1. analyze_memory — Scan the knowledge graph, find connected groups of
     stale nodes, score staleness, return ranked analysis for agent review.
  2. batch_prune — Archive or delete selected nodes in bulk after the
     agent has reviewed the analysis.

Standard tool module pattern:
  1. TOOL_DEF dicts
  2. handler functions
  3. register() wires into registry
"""

import logging
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

from ...core.memory_tracker import get_tracker
from ...core.request_tracer import get_tracer, SPAN_MEMORY_OP, get_active_trace

logger = logging.getLogger(__name__)


# =============================================================================
# 1. TOOL DEFINITIONS
# =============================================================================

ANALYZE_TOOL_DEF = {
    "name": "analyze_memory",
    "description": (
        "Scan your entire knowledge graph and identify groups of connected "
        "nodes that may be stale or no longer useful.\n\n"
        "Returns a ranked list of connected components scored by staleness. "
        "Each group shows its nodes, their types, lifecycle states, and a "
        "staleness score (0.0 = fresh, 1.0 = very stale).\n\n"
        "Use this BEFORE batch_prune — review the analysis first, then "
        "decide which groups to archive or delete.\n\n"
        "Parameters:\n"
        "  min_staleness — Only show groups scoring above this threshold "
        "(default 0.3, range 0.0-1.0).\n"
        "  max_groups — Max groups to return (default 20).\n"
        "  include_isolated — Include nodes with zero connections (default false)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "min_staleness": {
                "type": "number",
                "description": "Minimum staleness score to include (0.0-1.0). Default 0.3.",
            },
            "max_groups": {
                "type": "integer",
                "description": "Max groups to return. Default 20.",
            },
            "include_isolated": {
                "type": "boolean",
                "description": "Include nodes with zero connections. Default false.",
            },
        },
        "required": [],
    },
}

BATCH_PRUNE_TOOL_DEF = {
    "name": "batch_prune",
    "description": (
        "Archive or delete a batch of memory nodes after reviewing an "
        "analyze_memory report.\n\n"
        "Actions:\n"
        "  archive — Mark nodes as DORMANT. Data is preserved but hidden "
        "from active queries. PREFERRED for most pruning.\n"
        "  delete — Permanently remove nodes and all their edges. Use for "
        "genuinely wrong or duplicate data only.\n\n"
        "Pass the node_ids you want to prune. Get them from analyze_memory results.\n\n"
        "Safety: Nodes in ACTIVE lifecycle with access_count > 10 will be "
        "skipped with a warning (use delete_memory for individual high-value removals)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "node_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of node IDs to prune (from analyze_memory results).",
            },
            "action": {
                "type": "string",
                "enum": ["archive", "delete"],
                "description": "archive = mark DORMANT (safe, reversible). delete = permanent removal.",
            },
        },
        "required": ["node_ids", "action"],
    },
}


# =============================================================================
# 2. ANALYZE MEMORY HANDLER
# =============================================================================

def handle_analyze_memory(
    min_staleness: float = 0.3,
    max_groups: int = 20,
    include_isolated: bool = False,
) -> str:
    """Analyze the knowledge graph for stale connected components."""
    from ...nous.client import get_client

    _start = time.monotonic()

    try:
        client = get_client()

        # Step 1: Bulk fetch entire graph (single HTTP call)
        graph = client.get_graph()
        all_nodes = graph.get("nodes", [])
        all_edges = graph.get("edges", [])

        if not all_nodes:
            return "No memories found in the knowledge graph."

        # Step 2: Build adjacency list
        adjacency = defaultdict(set)  # node_id -> set of connected node_ids
        node_map = {}  # node_id -> node dict

        for node in all_nodes:
            nid = node.get("id")
            if nid:
                node_map[nid] = node
                adjacency[nid]  # Ensure every node has an entry

        for edge in all_edges:
            src = edge.get("source")
            tgt = edge.get("target")
            if src and tgt and src in node_map and tgt in node_map:
                adjacency[src].add(tgt)
                adjacency[tgt].add(src)

        # Step 3: Find connected components via BFS
        visited = set()
        components = []  # list of lists of node_ids

        for nid in node_map:
            if nid in visited:
                continue
            # BFS
            component = []
            queue = [nid]
            while queue:
                current = queue.pop(0)
                if current in visited:
                    continue
                visited.add(current)
                component.append(current)
                for neighbor in adjacency[current]:
                    if neighbor not in visited:
                        queue.append(neighbor)
            components.append(component)

        # Step 4: Separate isolated nodes (0 connections)
        isolated = [c for c in components if len(c) == 1 and len(adjacency[c[0]]) == 0]
        connected = [c for c in components if not (len(c) == 1 and len(adjacency[c[0]]) == 0)]

        # Step 5: Score each component
        scored_groups = []
        for component_ids in connected:
            group = _score_component(component_ids, node_map, adjacency)
            if group["staleness"] >= min_staleness:
                scored_groups.append(group)

        if include_isolated:
            for component_ids in isolated:
                group = _score_component(component_ids, node_map, adjacency)
                if group["staleness"] >= min_staleness:
                    group["label"] = f"Isolated: {group['label']}"
                    scored_groups.append(group)

        # Step 6: Sort by staleness descending, cap at max_groups
        scored_groups.sort(key=lambda g: g["staleness"], reverse=True)
        scored_groups = scored_groups[:max_groups]

        # Step 7: Format output
        _elapsed = int((time.monotonic() - _start) * 1000)
        result = _format_analysis(
            scored_groups, len(all_nodes), len(all_edges),
            len(connected), len(isolated), _elapsed,
        )

        # Record span
        _record_analysis_span(_elapsed, len(all_nodes), len(scored_groups))

        return result

    except Exception as e:
        logger.error("analyze_memory failed: %s", e)
        return f"Error analyzing memory: {e}"


# =============================================================================
# 3. STALENESS SCORING
# =============================================================================

def _score_component(
    node_ids: list[str],
    node_map: dict[str, dict],
    adjacency: dict[str, set],
) -> dict:
    """Score a connected component for staleness.

    Staleness score (0.0 = fresh, 1.0 = very stale) is computed from:
      - Retrievability: avg (1 - retrievability) across nodes (weight: 0.35)
      - Lifecycle: fraction of DORMANT + WEAK nodes (weight: 0.25)
      - Recency: days since most recent access, normalized (weight: 0.25)
      - Access frequency: inverse of avg access count, normalized (weight: 0.15)

    Returns a dict with scoring metadata and node details.
    """
    nodes = [node_map[nid] for nid in node_ids if nid in node_map]
    if not nodes:
        return {"staleness": 0.0, "node_ids": node_ids, "nodes": [], "label": "Empty"}

    # Collect metrics
    retrievabilities = []
    access_counts = []
    lifecycles = {"ACTIVE": 0, "WEAK": 0, "DORMANT": 0}
    last_accessed_dates = []
    subtypes = []

    now = datetime.now(timezone.utc)

    for node in nodes:
        # Retrievability (0-1, provided by graph route after FSRS decay)
        ret = node.get("retrievability", 0.5)
        try:
            ret = float(ret)
        except (TypeError, ValueError):
            ret = 0.5
        retrievabilities.append(ret)

        # Access count
        ac = node.get("access_count", 0)
        try:
            ac = int(ac)
        except (TypeError, ValueError):
            ac = 0
        access_counts.append(ac)

        # Lifecycle
        lc = node.get("lifecycle", "ACTIVE")
        if lc in lifecycles:
            lifecycles[lc] += 1

        # Last accessed / created date for recency
        created = node.get("created_at", "")
        if created:
            try:
                dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                last_accessed_dates.append(dt)
            except (ValueError, TypeError):
                pass

        # Subtype for labeling
        st = node.get("subtype", node.get("type", ""))
        if st:
            subtypes.append(st)

    n = len(nodes)

    # --- Component 1: Retrievability decay (weight 0.35) ---
    avg_ret = sum(retrievabilities) / n if retrievabilities else 0.5
    ret_score = 1.0 - avg_ret  # Low retrievability = high staleness

    # --- Component 2: Lifecycle distribution (weight 0.25) ---
    dormant_weak = lifecycles.get("DORMANT", 0) + lifecycles.get("WEAK", 0)
    lifecycle_score = dormant_weak / n if n > 0 else 0.0

    # --- Component 3: Recency — days since newest node created (weight 0.25) ---
    if last_accessed_dates:
        newest = max(last_accessed_dates)
        days_old = (now - newest).total_seconds() / 86400
        # Normalize: 0 days = 0.0, 90+ days = 1.0
        recency_score = min(1.0, days_old / 90.0)
    else:
        recency_score = 0.5  # Unknown = neutral

    # --- Component 4: Access frequency (weight 0.15) ---
    avg_access = sum(access_counts) / n if access_counts else 0
    # Normalize: 0 accesses = 1.0, 20+ accesses = 0.0
    access_score = max(0.0, 1.0 - (avg_access / 20.0))

    # --- Weighted staleness ---
    staleness = (
        ret_score * 0.35
        + lifecycle_score * 0.25
        + recency_score * 0.25
        + access_score * 0.15
    )
    staleness = round(min(1.0, max(0.0, staleness)), 3)

    # --- Generate label from dominant subtype ---
    label = _generate_group_label(nodes, subtypes)

    # --- Edge count within this component ---
    internal_edges = 0
    node_id_set = set(node_ids)
    for nid in node_ids:
        for neighbor in adjacency.get(nid, set()):
            if neighbor in node_id_set:
                internal_edges += 1
    internal_edges //= 2  # Each edge counted twice

    return {
        "staleness": staleness,
        "node_ids": node_ids,
        "nodes": nodes,
        "label": label,
        "node_count": n,
        "edge_count": internal_edges,
        "avg_retrievability": round(avg_ret, 3),
        "lifecycle_breakdown": lifecycles,
        "days_since_active": round((now - max(last_accessed_dates)).total_seconds() / 86400, 1) if last_accessed_dates else None,
        "avg_access_count": round(avg_access, 1),
    }


def _generate_group_label(nodes: list[dict], subtypes: list[str]) -> str:
    """Generate a human-readable label for a connected component.

    Heuristics:
    1. If group has trade nodes -> use symbol from trade title
    2. Otherwise -> use the most common subtype + first node title
    """
    # Look for trade nodes to extract symbol
    for node in nodes:
        title = node.get("title", "")
        subtype = node.get("subtype", "")
        if "trade" in subtype.lower():
            # Extract symbol from trade titles like "LONG BTC @ $68K"
            for token in title.split():
                if token.upper() in (
                    "BTC", "ETH", "SOL", "DOGE", "XRP", "AVAX", "LINK",
                    "ARB", "OP", "SUI", "WIF", "PEPE", "NEAR", "APT",
                ):
                    return f"{token.upper()} trade lifecycle"
            return f"Trade: {title[:40]}"

    # Use dominant subtype + first title
    if subtypes:
        type_counts = Counter(subtypes)
        dominant = type_counts.most_common(1)[0][0]
        # Strip custom: prefix
        if dominant.startswith("custom:"):
            dominant = dominant[7:]
    else:
        dominant = "mixed"

    first_title = nodes[0].get("title", "Untitled") if nodes else "Untitled"
    if len(first_title) > 40:
        first_title = first_title[:37] + "..."

    if len(nodes) == 1:
        return f"{dominant}: {first_title}"
    return f"{dominant} group: {first_title}"


# =============================================================================
# 4. BATCH PRUNE HANDLER
# =============================================================================

def _prune_one_node(client, nid: str, action: str) -> dict:
    """Prune a single node. Returns a result dict with 'status' key.

    Thread-safe — each call uses its own HTTP requests.
    Returns one of:
      {"status": "succeeded", "id": ..., "title": ..., "action": ..., ...}
      {"status": "skipped",   "id": ..., "title": ..., "reason": ...}
      {"status": "failed",    "id": ..., "reason": ...}
    """
    try:
        node = client.get_node(nid)
        if not node:
            return {"status": "failed", "id": nid, "reason": "not found"}

        title = node.get("content_title", "Untitled")
        lifecycle = node.get("state_lifecycle", "ACTIVE")
        access_count = node.get("neural_access_count", 0)
        try:
            access_count = int(access_count)
        except (TypeError, ValueError):
            access_count = 0

        subtype = node.get("subtype", "")

        # Safety: skip high-value active nodes
        if action == "delete" and lifecycle == "ACTIVE" and access_count > 10:
            return {
                "status": "skipped", "id": nid, "title": title,
                "reason": f"ACTIVE with {access_count} accesses — use delete_memory for individual removal",
            }

        if action == "archive":
            if lifecycle == "DORMANT":
                return {"status": "skipped", "id": nid, "title": title, "reason": "already DORMANT"}
            client.update_node(nid, state_lifecycle="DORMANT")
            get_tracker().record_archive(nid, title, subtype)
            logger.info("Pruned (archive): \"%s\" (%s)", title, nid)
            return {"status": "succeeded", "id": nid, "title": title, "action": "archived"}

        elif action == "delete":
            # Delete all connected edges first
            edges = client.get_edges(nid, direction="both")
            edges_deleted = 0
            for edge in edges:
                eid = edge.get("id")
                if eid:
                    client.delete_edge(eid)
                    edges_deleted += 1

            # Delete the node
            client.delete_node(nid)
            get_tracker().record_delete(nid, title, subtype, edges_deleted)
            logger.info("Pruned (delete): \"%s\" (%s) + %d edges", title, nid, edges_deleted)
            return {
                "status": "succeeded", "id": nid, "title": title,
                "action": "deleted", "edges_removed": edges_deleted,
            }

    except Exception as e:
        return {"status": "failed", "id": nid, "reason": str(e)}


# Max concurrent HTTP requests to Nous during batch prune.
_PRUNE_WORKERS = 10


def handle_batch_prune(
    node_ids: list[str],
    action: str,
) -> str:
    """Archive or delete a batch of memory nodes (concurrent)."""
    from ...nous.client import get_client

    if not node_ids:
        return "Error: node_ids list is empty."

    if action not in ("archive", "delete"):
        return f"Error: action must be 'archive' or 'delete', got '{action}'."

    _start = time.monotonic()

    try:
        client = get_client()

        succeeded = []
        skipped = []
        failed = []

        workers = min(_PRUNE_WORKERS, len(node_ids))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_prune_one_node, client, nid, action): nid
                for nid in node_ids
            }
            for future in as_completed(futures):
                result = future.result()
                status = result.pop("status")
                if status == "succeeded":
                    succeeded.append(result)
                elif status == "skipped":
                    skipped.append(result)
                else:
                    failed.append(result)

        # Format result
        _elapsed = int((time.monotonic() - _start) * 1000)
        result = _format_prune_result(succeeded, skipped, failed, action, _elapsed)

        # Record span
        _record_prune_span(_elapsed, action, len(succeeded), len(skipped), len(failed))

        return result

    except Exception as e:
        logger.error("batch_prune failed: %s", e)
        return f"Error during batch prune: {e}"


# =============================================================================
# 5. FORMATTING
# =============================================================================

def _format_analysis(
    groups: list[dict],
    total_nodes: int,
    total_edges: int,
    connected_count: int,
    isolated_count: int,
    elapsed_ms: int,
) -> str:
    """Format analysis results for agent review."""
    if not groups:
        return (
            f"Analysis complete ({elapsed_ms}ms): {total_nodes} nodes, {total_edges} edges, "
            f"{connected_count} connected groups, {isolated_count} isolated nodes.\n\n"
            "No groups meet the staleness threshold. Your knowledge graph is healthy."
        )

    lines = [
        f"Memory Analysis ({elapsed_ms}ms): {total_nodes} nodes, {total_edges} edges",
        f"  {connected_count} connected groups, {isolated_count} isolated nodes",
        f"  {len(groups)} group(s) above staleness threshold:",
        "",
    ]

    for i, group in enumerate(groups, 1):
        staleness = group["staleness"]
        label = group["label"]
        n = group["node_count"]
        edges = group["edge_count"]
        avg_ret = group["avg_retrievability"]
        days = group.get("days_since_active")
        lc = group["lifecycle_breakdown"]

        days_str = f", last active {int(days)}d ago" if days is not None else ""
        lines.append(
            f"Group {i}: \"{label}\" ({n} node{'s' if n != 1 else ''}, "
            f"{edges} edge{'s' if edges != 1 else ''}{days_str}, "
            f"retrievability {avg_ret:.2f}, staleness {staleness:.2f})"
        )

        # Lifecycle breakdown
        lc_parts = []
        if lc.get("ACTIVE", 0):
            lc_parts.append(f"{lc['ACTIVE']} active")
        if lc.get("WEAK", 0):
            lc_parts.append(f"{lc['WEAK']} weak")
        if lc.get("DORMANT", 0):
            lc_parts.append(f"{lc['DORMANT']} dormant")
        if lc_parts:
            lines.append(f"  Lifecycle: {', '.join(lc_parts)}")

        # List nodes
        for node in group["nodes"]:
            nid = node.get("id", "?")
            title = node.get("title", "Untitled")
            subtype = node.get("subtype", node.get("type", "?"))
            if isinstance(subtype, str) and subtype.startswith("custom:"):
                subtype = subtype[7:]
            lifecycle = node.get("lifecycle", "?")
            lines.append(f"  - {title} ({subtype}, {lifecycle.lower()}) [{nid}]")

        lines.append("")

    lines.append(
        "Use batch_prune(node_ids=[...], action=\"archive\") to archive stale groups, "
        "or action=\"delete\" for permanent removal."
    )

    return "\n".join(lines)


def _format_prune_result(
    succeeded: list[dict],
    skipped: list[dict],
    failed: list[dict],
    action: str,
    elapsed_ms: int,
) -> str:
    """Format batch prune results."""
    total = len(succeeded) + len(skipped) + len(failed)
    lines = [f"Batch {action} complete ({elapsed_ms}ms): {len(succeeded)}/{total} nodes {action}d."]

    if succeeded:
        lines.append("")
        action_past = "Archived" if action == "archive" else "Deleted"
        for item in succeeded:
            extra = ""
            if item.get("edges_removed"):
                extra = f" + {item['edges_removed']} edges"
            lines.append(f"  {action_past}: \"{item['title']}\" ({item['id']}){extra}")

    if skipped:
        lines.append("")
        lines.append(f"Skipped ({len(skipped)}):")
        for item in skipped:
            lines.append(f"  - \"{item.get('title', item['id'])}\": {item['reason']}")

    if failed:
        lines.append("")
        lines.append(f"Failed ({len(failed)}):")
        for item in failed:
            lines.append(f"  - {item['id']}: {item['reason']}")

    return "\n".join(lines)


# =============================================================================
# 6. SPAN RECORDING
# =============================================================================

def _record_analysis_span(elapsed_ms: int, total_nodes: int, groups_found: int) -> None:
    """Record a memory_op span for analyze_memory. Silent on failure."""
    try:
        _tid = get_active_trace()
        if _tid:
            get_tracer().record_span(_tid, {
                "type": SPAN_MEMORY_OP,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "duration_ms": elapsed_ms,
                "operation": "analyze",
                "total_nodes": total_nodes,
                "stale_groups_found": groups_found,
            })
    except Exception:
        pass


def _record_prune_span(elapsed_ms: int, action: str, succeeded: int, skipped: int, failed: int) -> None:
    """Record a memory_op span for batch_prune. Silent on failure."""
    try:
        _tid = get_active_trace()
        if _tid:
            get_tracer().record_span(_tid, {
                "type": SPAN_MEMORY_OP,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "duration_ms": elapsed_ms,
                "operation": "prune",
                "prune_action": action,
                "succeeded": succeeded,
                "skipped": skipped,
                "failed": failed,
            })
    except Exception:
        pass


# =============================================================================
# 7. REGISTRATION
# =============================================================================

def register(registry):
    """Register memory pruning tools."""
    from .registry import Tool

    registry.register(Tool(
        name=ANALYZE_TOOL_DEF["name"],
        description=ANALYZE_TOOL_DEF["description"],
        parameters=ANALYZE_TOOL_DEF["parameters"],
        handler=handle_analyze_memory,
    ))

    registry.register(Tool(
        name=BATCH_PRUNE_TOOL_DEF["name"],
        description=BATCH_PRUNE_TOOL_DEF["description"],
        parameters=BATCH_PRUNE_TOOL_DEF["parameters"],
        handler=handle_batch_prune,
    ))
