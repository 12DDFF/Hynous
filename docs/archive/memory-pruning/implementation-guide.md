# Memory Pruning — Two-Phase Implementation Guide (Approach B)

## Context

The Hynous memory system accumulates nodes over time — trade records, theses, observations, signals, turn summaries. Many become stale: old trade lifecycles that completed months ago, invalidated theses, expired watchpoints, observations about past market conditions. These clutter search results and waste retrieval budget.

**Goal**: Give the agent two new tools so it can analyze the knowledge graph, identify groups of connected stale nodes, review the analysis, and then prune (archive or delete) the ones it deems no longer useful.

**Approach B — Two-Phase Tool**:
1. `analyze_memory` — Scan all nodes, group by connected component, score staleness, return ranked analysis
2. Agent reviews the analysis and decides which groups to prune
3. `batch_prune` — Archive or delete selected nodes in bulk

---

## Pre-Reading Requirements

Before implementing, the engineer agent MUST read these files in full to understand patterns, APIs, and conventions:

### Core Memory System
| File | Why |
|------|-----|
| `src/hynous/nous/client.py` | NousClient API — every HTTP method available. Key: `get_graph()`, `get_node()`, `get_edges()`, `delete_node()`, `delete_edge()`, `update_node()`, `list_nodes()` |
| `src/hynous/core/config.py` | Config dataclasses — understand how config is loaded and structured |
| `config/default.yaml` | Active config values |

### Existing Tool Patterns (CRITICAL — match these exactly)
| File | Why |
|------|-----|
| `src/hynous/intelligence/tools/registry.py` | Tool registration pattern: `Tool` dataclass, `register()` function, `get_registry()` |
| `src/hynous/intelligence/tools/delete_memory.py` | Closest existing tool — archive/delete pattern, edge cleanup before node delete |
| `src/hynous/intelligence/tools/explore_memory.py` | Graph exploration pattern — fetching edges, resolving connected node titles |
| `src/hynous/intelligence/tools/clusters.py` | Multi-action tool pattern with action enum |
| `src/hynous/intelligence/tools/memory.py` | Memory type map (`_TYPE_MAP`), result formatting (`_format_memory_results`), span recording pattern |

### Debug/Tracing (for span recording)
| File | Why |
|------|-----|
| `src/hynous/core/request_tracer.py` | Span constants (`SPAN_MEMORY_OP`), thread-local trace context (`get_active_trace()`), `get_tracer().record_span()` |

### Test Patterns
| File | Why |
|------|-----|
| `tests/unit/test_retrieval_orchestrator.py` | Test structure — litellm stubbing, pytest class grouping, mock patterns |
| `tests/unit/test_gate_filter.py` | Simpler test example — direct function testing |
| `tests/conftest.py` | Shared fixtures |

### Nous Server (read-only reference)
| File | Why |
|------|-----|
| `nous-server/server/src/routes/graph.ts` | `GET /v1/graph` response shape: `{nodes, edges, clusters, memberships}` — this is the bulk fetch used by `analyze_memory` |
| `nous-server/server/src/routes/nodes.ts` | Node schema, LIST max limit (200), FSRS decay on read |
| `nous-server/server/src/routes/edges.ts` | Edge schema, strengthen/delete |

---

## Architecture Overview

```
User asks: "Clean up stale memories"
    │
    ▼
Agent calls analyze_memory(min_staleness=0.5)
    │
    ├─ get_graph() → all nodes + edges (single HTTP call)
    ├─ Build adjacency list from edges
    ├─ BFS to find connected components
    ├─ Score each component on staleness
    ├─ Sort by staleness descending
    └─ Return formatted analysis to agent
    │
    ▼
Agent reviews analysis, decides which groups to prune
    │
    ▼
Agent calls batch_prune(node_ids=[...], action="archive")
    │
    ├─ ThreadPoolExecutor(max_workers=10) processes nodes concurrently
    ├─ _prune_one_node() per node (thread-safe worker):
    │    ├─ For archive: update_node(id, state_lifecycle="DORMANT")
    │    └─ For delete: get_edges(id) → delete each edge → delete_node(id)
    ├─ Collect results from futures → succeeded/skipped/failed
    ├─ MutationTracker records each archive/delete for audit
    └─ Return confirmation with counts
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/hynous/intelligence/tools/pruning.py` | **CREATE** | Both `analyze_memory` and `batch_prune` tools (concurrent via ThreadPoolExecutor) |
| `src/hynous/intelligence/tools/registry.py` | **MODIFY** | Add `from . import pruning` + `pruning.register(registry)` |
| `src/hynous/intelligence/prompts/builder.py` | **MODIFY** | Update `TOOL_STRATEGY` — tool count 23→25, add pruning tools to Memory section |
| `src/hynous/intelligence/agent.py` | **MODIFY** | Add `analyze_memory` + `batch_prune` to `_STALE_TRUNCATION` dict |
| `src/hynous/core/memory_tracker.py` | **MODIFY** | Add `record_archive()` + `record_delete()` audit methods, update `build_audit()` + `format_for_coach()` |
| `tests/unit/test_pruning.py` | **CREATE** | Unit tests for scoring, formatting, `_prune_one_node` worker, concurrency |
| `tests/integration/test_pruning_integration.py` | **CREATE** | Integration tests: full flow, large graph, concurrent batch, partial failures |
| `tests/unit/test_token_optimization.py` | **MODIFY** | Update `_STALE_TRUNCATION` count 23→25 |
| `src/hynous/nous/client.py` | **MODIFY** | Add `raise_for_status()` to `delete_node()` and `delete_edge()` |
| `dashboard/dashboard/state.py` | **MODIFY** | Health count shows live nodes (active+weak), excludes archived (DORMANT) |

---

## Chunk 1: Create `pruning.py` — Tool Definitions

**File**: `src/hynous/intelligence/tools/pruning.py`

### Module Structure

```python
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
```

### ANALYZE_MEMORY Tool Definition

```python
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
```

### BATCH_PRUNE Tool Definition

```python
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
```

---

## Chunk 2: `handle_analyze_memory` Implementation

### Core Algorithm

```python
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
        result = _format_analysis(scored_groups, len(all_nodes), len(all_edges), len(connected), len(isolated), _elapsed)

        # Record span
        _record_analysis_span(_elapsed, len(all_nodes), len(scored_groups))

        return result

    except Exception as e:
        logger.error("analyze_memory failed: %s", e)
        return f"Error analyzing memory: {e}"
```

### Staleness Scoring Function

```python
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
```

### Group Labeling Function

```python
def _generate_group_label(nodes: list[dict], subtypes: list[str]) -> str:
    """Generate a human-readable label for a connected component.

    Heuristics:
    1. If group has trade nodes → use symbol from trade title
    2. Otherwise → use the most common subtype + first node title
    """
    # Look for trade nodes to extract symbol
    for node in nodes:
        title = node.get("title", "")
        subtype = node.get("subtype", "")
        if "trade" in subtype.lower():
            # Extract symbol from trade titles like "LONG BTC @ $68K"
            for token in title.split():
                if token.upper() in ("BTC", "ETH", "SOL", "DOGE", "XRP", "AVAX", "LINK", "ARB", "OP", "SUI", "WIF", "PEPE", "NEAR", "APT"):
                    return f"{token.upper()} trade lifecycle"
            return f"Trade: {title[:40]}"

    # Use dominant subtype + first title
    if subtypes:
        # Count subtypes, pick most common
        from collections import Counter
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
```

---

## Chunk 3: `handle_batch_prune` Implementation (Concurrent)

### Per-Node Worker

```python
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
            edges = client.get_edges(nid, direction="both")
            edges_deleted = 0
            for edge in edges:
                eid = edge.get("id")
                if eid:
                    client.delete_edge(eid)
                    edges_deleted += 1
            client.delete_node(nid)
            get_tracker().record_delete(nid, title, subtype, edges_deleted)
            logger.info("Pruned (delete): \"%s\" (%s) + %d edges", title, nid, edges_deleted)
            return {
                "status": "succeeded", "id": nid, "title": title,
                "action": "deleted", "edges_removed": edges_deleted,
            }

    except Exception as e:
        return {"status": "failed", "id": nid, "reason": str(e)}
```

### Concurrent Batch Handler

```python
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
```

---

## Chunk 4: Formatting Functions

### Analysis Formatting

```python
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
        if lc.get("ACTIVE", 0): lc_parts.append(f"{lc['ACTIVE']} active")
        if lc.get("WEAK", 0): lc_parts.append(f"{lc['WEAK']} weak")
        if lc.get("DORMANT", 0): lc_parts.append(f"{lc['DORMANT']} dormant")
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
```

### Prune Result Formatting

```python
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
```

---

## Chunk 5: Span Recording + Registration

### Span Recording (follows existing pattern from `tools/memory.py` and `tools/trading.py`)

```python
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
```

### Registration (follows exact pattern from every other tool module)

```python
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
```

---

## Chunk 6: Registry Wiring

**File**: `src/hynous/intelligence/tools/registry.py`

Add at the end of `get_registry()`, before `return registry`:

```python
    from . import pruning
    pruning.register(registry)
```

This follows the exact same pattern as every other tool registration in the file.

---

## Chunk 7: Unit Tests

**File**: `tests/unit/test_pruning.py`

### Test Structure

```python
"""Tests for memory pruning tools (analyze_memory + batch_prune)."""

import sys
import types
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone, timedelta

# Stub litellm before importing hynous.intelligence
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception

from hynous.intelligence.tools.pruning import (
    _score_component,
    _generate_group_label,
    _format_analysis,
    _format_prune_result,
    _prune_one_node,
    handle_analyze_memory,
    handle_batch_prune,
)
```

### Test Cases Required (45 total)

#### `TestScoreComponent` class (7 tests):
1. `test_fresh_active_nodes_score_low` — All ACTIVE, high retrievability, recent → staleness < 0.3
2. `test_dormant_old_nodes_score_high` — All DORMANT, low retrievability, old → staleness > 0.7
3. `test_mixed_lifecycle_scores_moderate` — Mix of ACTIVE and DORMANT → moderate staleness
4. `test_high_access_count_reduces_staleness` — High access_count → lower staleness
5. `test_zero_retrievability_scores_high` — retrievability=0 → high staleness contribution
6. `test_single_node_component` — Works correctly with 1 node
7. `test_empty_component_returns_zero` — Empty node list → staleness 0.0

#### `TestGenerateGroupLabel` class (4 tests):
1. `test_trade_nodes_use_symbol` — Nodes with trade subtypes extract symbol from title
2. `test_non_trade_uses_dominant_subtype` — Non-trade nodes use most common subtype
3. `test_single_node_label` — Single node shows "subtype: title"
4. `test_long_title_truncated` — Titles over 40 chars get truncated

#### `TestFormatAnalysis` class (3 tests):
1. `test_empty_groups_healthy_message` — No stale groups → healthy message
2. `test_groups_show_all_metadata` — Groups include staleness, retrievability, lifecycle, node list
3. `test_includes_node_ids_in_brackets` — Each node line ends with [node_id]

#### `TestFormatPruneResult` class (3 tests):
1. `test_all_succeeded` — All nodes pruned → clean summary
2. `test_with_skipped_and_failed` — Mix of succeeded/skipped/failed → all sections shown
3. `test_delete_shows_edge_count` — Delete action shows edges_removed

#### `TestHandleAnalyzeMemory` class (5 tests, mocked NousClient):
1. `test_returns_analysis_for_stale_graph` — Mock get_graph() with stale nodes → formatted output
2. `test_empty_graph_returns_message` — No nodes → "No memories found"
3. `test_min_staleness_filters_groups` — High threshold filters out less-stale groups
4. `test_include_isolated_flag` — With flag, isolated nodes appear; without, they don't
5. `test_nous_connection_error` — NousClient raises → error message, not crash

#### `TestHandleBatchPrune` class (7 tests, mocked NousClient):
1. `test_archive_sets_dormant` — Archive calls update_node with state_lifecycle="DORMANT"
2. `test_delete_removes_edges_then_node` — Delete calls get_edges, delete_edge for each, then delete_node
3. `test_skips_already_dormant_on_archive` — Already DORMANT nodes are skipped
4. `test_safety_skips_high_value_active` — ACTIVE + access_count > 10 → skipped on delete
5. `test_not_found_reported_as_failed` — Missing node_id → failed list
6. `test_empty_node_ids_returns_error` — Empty list → error message
7. `test_invalid_action_returns_error` — Bad action string → error message

#### `TestPruneOneNode` class (5 tests, worker function):
1. `test_archive_returns_succeeded` — Successful archive returns status=succeeded
2. `test_delete_returns_succeeded_with_edge_count` — Delete returns edges_removed
3. `test_not_found_returns_failed` — Missing node returns status=failed
4. `test_exception_returns_failed` — Exception during processing returns status=failed
5. `test_safety_guard_returns_skipped` — High-value active node returns status=skipped

#### `TestBatchPruneConcurrency` class (4 tests, thread pool):
1. `test_large_batch_archive` — Archive 50 nodes concurrently, all succeed
2. `test_large_batch_mixed_results` — 30 nodes: 10 succeed, 10 skipped, 10 fail
3. `test_large_batch_delete_with_edges` — Delete 20 nodes with 3 edges each, all cleaned
4. `test_concurrent_exceptions_dont_crash` — Some workers throw, others still succeed

### Mock Helpers for Tests

```python
def _make_node(id, title="Test", subtype="custom:thesis", lifecycle="ACTIVE",
               retrievability=0.8, access_count=5, created_days_ago=7):
    """Create a mock node dict matching the get_graph() response shape."""
    created = (datetime.now(timezone.utc) - timedelta(days=created_days_ago)).isoformat()
    return {
        "id": id,
        "type": "concept",
        "subtype": subtype,
        "title": title,
        "summary": None,
        "retrievability": retrievability,
        "lifecycle": lifecycle,
        "access_count": access_count,
        "created_at": created,
    }


def _make_edge(id, source, target, type="relates_to", strength=0.5):
    """Create a mock edge dict matching the get_graph() response shape."""
    return {
        "id": id,
        "source": source,
        "target": target,
        "type": type,
        "strength": strength,
    }


def _make_full_node(id, title="Test", subtype="custom:thesis", lifecycle="ACTIVE",
                    access_count=5):
    """Create a mock node dict matching the get_node() response shape (for batch_prune)."""
    return {
        "id": id,
        "content_title": title,
        "subtype": subtype,
        "state_lifecycle": lifecycle,
        "neural_access_count": access_count,
    }
```

---

## Chunk 8: Integration Tests

**File**: `tests/integration/test_pruning_integration.py`

### Integration Test Cases (7 total)

These tests mock the NousClient at the HTTP level and test the full flow:

1. `test_analyze_then_prune_flow` — Full E2E: create mock graph with stale + fresh groups → analyze → verify stale groups appear → batch_prune stale node_ids → verify correct API calls
2. `test_large_graph_performance` — Mock graph with 200+ nodes → analyze completes in < 2 seconds
3. `test_analyze_with_clusters` — Graph with cluster memberships → components still detected correctly
4. `test_prune_with_partial_failures` — Some nodes fail to delete → succeeded + failed both reported
5. `test_analyze_isolated_nodes` — Graph with many isolated nodes → include_isolated toggle works
6. `test_analyze_then_bulk_archive_50_nodes` — Full E2E: analyze 60-node graph → archive 50 stale nodes concurrently → all succeed
7. `test_bulk_delete_with_edge_cleanup` — Delete 30 nodes concurrently, each with 2 edges → 60 edges + 30 nodes removed

---

## Verification & Testing Protocol

### Static Verification (before running anything)
1. Verify `pruning.py` follows the exact module pattern of `delete_memory.py` and `clusters.py`:
   - Module docstring
   - Imports from `...nous.client`, `...core.request_tracer`
   - `TOOL_DEF` dict with name, description, parameters
   - Handler function matching parameter names exactly
   - `register()` function at bottom
2. Verify `_TYPE_MAP` is NOT duplicated — pruning.py doesn't need it (it works on raw node dicts from `get_graph()`)
3. Verify all span recording follows the `try/except Exception: pass` pattern (silent degradation)
4. Verify safety guard in `batch_prune` prevents deleting high-value active nodes

### Dynamic Unit Tests
```bash
cd /Users/bauthoi/Documents/Hynous
python -m pytest tests/unit/test_pruning.py -v
```

Expected: All tests pass. Fix any failures before proceeding.

### Dynamic Integration Tests
```bash
python -m pytest tests/integration/test_pruning_integration.py -v
```

### Regression Tests (existing suite)
```bash
python -m pytest tests/ -v
```

Expected: Zero regressions. The only changes to existing files are 2 lines in `registry.py`.

### Manual E2E Verification (requires running Nous server)
1. Start Nous server: `cd nous-server/server && pnpm dev`
2. Start dashboard: `cd dashboard && reflex run`
3. Chat with agent: "Analyze my memories for stale content"
4. Verify agent calls `analyze_memory` and returns formatted groups
5. Ask agent to prune a specific group: "Archive group 1"
6. Verify agent calls `batch_prune` with correct node_ids
7. Check debug page → verify `memory_op` spans appear for both analyze and prune operations
8. Check graph page → verify pruned nodes are now DORMANT (if archived) or gone (if deleted)

---

## Critical Rules

1. **Never crash the agent** — all NousClient calls wrapped in try/except, return error strings not exceptions
2. **Silent span degradation** — all `_record_*_span()` calls wrapped in `try/except Exception: pass`
3. **Safety guard** — `batch_prune` with `action="delete"` skips ACTIVE nodes with >10 accesses
4. **Edge cleanup before delete** — always `get_edges()` + `delete_edge()` before `delete_node()` (matches `delete_memory.py` pattern)
5. **Single HTTP call for analysis** — use `get_graph()` not N+1 individual fetches
6. **Existing patterns only** — no new config, no new span types. Uses existing `SPAN_MEMORY_OP` and existing NousClient methods. Dashboard health count updated to reflect archiving
7. **Concurrent batch processing** — `batch_prune` uses `ThreadPoolExecutor(max_workers=10)` via `_prune_one_node()` worker. Each worker is thread-safe (own HTTP calls). `_PRUNE_WORKERS=10` caps concurrency to avoid overwhelming Nous
8. **Audit trail** — every successful archive/delete recorded in `MutationTracker` via `record_archive()` / `record_delete()`. Coach reads this audit after each chat cycle
9. **System prompt mentions** — `TOOL_STRATEGY` in `builder.py` updated to reference both tools (25 tools total). `_STALE_TRUNCATION` in `agent.py` includes entries for both tools
10. **Delete error propagation** — `NousClient.delete_node()` and `delete_edge()` now call `raise_for_status()` (was the only methods missing it). `_prune_one_node()` checks `delete_node()` return value and logs failed edge deletes
11. **Health count shows live nodes** — Dashboard `_fetch_memory_health()` computes `live_nodes = active + weak` as headline count, excludes DORMANT (archived). Lifecycle label changed from "dormant" to "archived"
