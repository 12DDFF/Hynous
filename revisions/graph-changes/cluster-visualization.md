# Cluster Visualization in Memory Graph

## Context
Cluster management was added (MF-13) with full CRUD, memberships, and health stats. The dashboard sidebar shows clusters, but the force-graph visualization doesn't render cluster boundaries. The goal is to draw Venn diagram-style convex hulls around cluster members so spatial grouping is visible in the graph.

## Files to Modify

| File | Change |
|------|--------|
| `nous-server/server/src/routes/graph.ts` | Add `clusters` + `memberships` arrays to the graph response |
| `dashboard/assets/graph.html` | All frontend work: hull geometry, rendering, forces, toggle, legend |

No other files need changes. The Reflex proxy (`dashboard.py:250`) already wildcards `/api/nous/{path:path}`.

## Plan

### Step 1 — Extend graph API with cluster data

In `graph.ts`, add two queries after the existing nodes/edges fetch:

```sql
SELECT id, name, description, icon, pinned FROM clusters
  ORDER BY pinned DESC, created_at DESC

SELECT cluster_id, node_id, weight FROM cluster_memberships
```

Filter memberships to only nodes present in the graph (the 500-node limit means some members may be excluded). Return both arrays in the response:

```json
{
  "nodes": [...], "edges": [...],
  "clusters": [{ "id": "cl_abc", "name": "BTC", ... }],
  "memberships": [{ "cluster_id": "cl_abc", "node_id": "nd_xyz", "weight": 1.0 }],
  "count": { ... }
}
```

### Step 2 — Hull geometry functions (pure math, no deps)

Add to `graph.html`:
- `convexHull(points)` — Andrew's monotone chain, O(n log n)
- `expandHull(hull, pad)` — push hull vertices outward from centroid
- `drawSmoothHull(ctx, hull)` — quadratic Bezier curves through hull for rounded corners
- `drawCapsule(ctx, p1, p2, pad)` — for 2-node clusters

### Step 3 — State, data wiring, color assignment

New state variables: `clustersEnabled`, `clusterData`, `clusterMemberships`, `clusterNodeMap` (node→clusters lookup), `clusterColorMap`, `nodeById`.

Color palette: 12 semi-transparent colors (fill: 0.06 alpha, stroke: 0.25 alpha). Known cluster names (BTC, ETH, SOL, etc.) get fixed color slots for consistency with the memory page. Remaining clusters assigned from palette sequentially.

In `renderGraph(data)`, process `data.clusters` and `data.memberships`, build lookup maps, assign colors.

### Step 4 — Render cluster hulls behind nodes

Use `onRenderFramePre(ctx, globalScale)` (supported since force-graph v1.43, we use v1.47.4). For each cluster with visible members:
- **0 members**: skip
- **1 member**: draw circle (radius = 20/globalScale)
- **2 members**: draw capsule shape
- **3+ members**: compute convex hull → expand by padding → draw smooth filled shape

Fill with cluster color (0.06 alpha), stroke with cluster color (0.25 alpha, 1px scaled). Draw cluster name label at centroid (50% opacity, scaled font).

### Step 5 — Cluster attraction force

Custom d3 force (`graph.d3Force('cluster', fn)`) that gently pulls cluster members toward their cluster's centroid each tick:
- Strength: 0.015 (weaker than gravity at 0.04, much weaker than link force)
- Multi-cluster nodes: force divided by number of cluster memberships, so they naturally drift to the intersection zone
- Only active when `clustersEnabled === true`; removed when toggled off
- Gentle reheat on toggle (not a full restart)

### Step 6 — UI controls and legend

- **Toggle button**: "Clusters" button in the controls bar, `.active` class when on (indigo border/text like the theme accent)
- **Cluster legend**: Appended to existing legend element with a divider when clusters are enabled. Shows cluster color dot + name + member count. Hidden when toggled off.
- **Detail panel**: When clicking a node, show its cluster memberships (comma-separated names) if any

### Edge Cases

| Case | Handling |
|------|---------|
| Empty cluster (no graphed members) | Skip render, omit from legend |
| Single-node cluster | Circle around the node |
| Two-node cluster | Capsule shape |
| Node in 0 clusters | Normal rendering, no force |
| Node in 2+ clusters | Forces split evenly; node drifts to intersection |
| 0 clusters in DB | Button visible but toggle does nothing |

## Verification

1. Start Nous server (`pnpm dev` in `nous-server/`)
2. Start Reflex dashboard (`reflex run` in `dashboard/`)
3. Open graph page, verify nodes/edges render as before
4. Click "Clusters" toggle — hulls should appear around grouped nodes
5. Verify Venn overlap: nodes in multiple clusters sit at hull intersections
6. Toggle off — hulls disappear, nodes drift back to normal layout
7. Click a node in a cluster — detail panel shows cluster membership
8. Zoom in/out — hulls scale properly (padding stays consistent)
9. Search while clusters active — both work independently
10. Refresh — clusters reload correctly
