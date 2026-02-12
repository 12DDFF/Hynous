# Cluster Visualization in Memory Graph

## Status: DONE

## Context
Cluster management was added (MF-13) with full CRUD, memberships, and health stats. The dashboard sidebar shows clusters, but the force-graph visualization didn't render cluster boundaries. The goal was to visually separate nodes by cluster in the graph view.

## Files Modified

| File | Change |
|------|--------|
| `nous-server/server/src/routes/graph.ts` | Added `clusters` + `memberships` arrays to the graph response |
| `dashboard/assets/graph.html` | All frontend work: hull geometry, rendering, deterministic layout, toggle, legend |

No other files needed changes. The Reflex proxy (`dashboard.py:250`) already wildcards `/api/nous/{path:path}`.

## What Was Implemented

### 1. Graph API — cluster data in response

`graph.ts` now fetches clusters and memberships alongside nodes/edges:

```sql
SELECT id, name, description, icon, pinned FROM clusters
  ORDER BY pinned DESC, created_at DESC

SELECT cluster_id, node_id, weight FROM cluster_memberships
```

Memberships are filtered to only include nodes present in the graph (the 500-node limit means some members may be excluded). Response shape:

```json
{
  "nodes": [...], "edges": [...],
  "clusters": [{ "id": "cl_abc", "name": "BTC", ... }],
  "memberships": [{ "cluster_id": "cl_abc", "node_id": "nd_xyz", "weight": 1.0 }],
  "count": { ... }
}
```

### 2. Hull geometry (pure math, no deps)

Four functions in `graph.html`:
- `convexHull(points)` — Andrew's monotone chain, O(n log n)
- `expandHull(hull, pad)` — push hull vertices outward from centroid
- `drawSmoothHull(ctx, hull)` — quadratic Bezier curves through hull for rounded corners
- `drawCapsule(ctx, p1, p2, pad)` — for 2-node clusters

### 3. Color assignment

12-color semi-transparent palette (fill: 0.06 alpha, stroke: 0.25 alpha). Known cluster names (BTC, ETH, SOL, etc.) get fixed color slots for consistency with the memory sidebar. Remaining clusters assigned from palette sequentially.

### 4. Deterministic cluster layout (no physics)

**Key design decision:** Physics-based cluster forces were tried first (d3 custom forces pulling members toward cluster centroids) but abandoned — forces competed with link distance, charge, and gravity, causing clusters to overlap or oscillate unpredictably.

**Final approach — deterministic positioning with `node.fx`/`node.fy`:**

When the "Clusters" toggle is activated:
1. Each node is assigned to one cluster (first membership found)
2. Active clusters are placed on a circle (radius scales with largest cluster size)
3. Nodes within each cluster are arranged in a Fibonacci spiral (`golden angle ≈ 137.5°`)
4. Unclustered nodes get their own slot on the circle
5. All nodes are pinned via `.fx`/`.fy` — d3 forces are completely bypassed
6. View auto-zooms to fit all clusters (`graph.zoomToFit()`)

When toggled off:
1. `.fx`/`.fy` are removed from all nodes
2. d3 simulation reheats — normal physics layout resumes

This produces clean, non-overlapping cluster groups every time with zero physics instability.

### 5. Hull rendering behind nodes

Uses `onRenderFramePre(ctx, globalScale)` (force-graph v1.47.4). For each cluster:
- **0 members**: skip
- **1 member**: circle (radius = 20/globalScale)
- **2 members**: capsule shape
- **3+ members**: convex hull → expand by padding → smooth Bezier fill

Hulls only include nodes assigned to that cluster (via `nodeAssignedCluster` map), so hulls never overlap. Cluster name label drawn at centroid.

### 6. UI controls and legend

- **Toggle button**: "Clusters" button in the controls bar, `.active` class when on (indigo border/text)
- **Cluster legend**: Appended to existing legend with divider. Shows color dot + name + member count. Hidden when toggled off.
- **Detail panel**: Node click shows cluster memberships (comma-separated names)

### Edge Cases

| Case | Handling |
|------|---------|
| Empty cluster (no graphed members) | Skip render, omit from legend, no slot on circle |
| Single-node cluster | Circle hull around the node |
| Two-node cluster | Capsule shape |
| Node in 0 clusters | Gets own "unclustered" slot on the circle |
| Node in 2+ clusters | Assigned to first cluster for layout; detail panel shows all |
| 0 clusters in DB | Button visible but toggle does nothing |

## Verification

1. Start Nous server (`pnpm dev` in `nous-server/`)
2. Start Reflex dashboard (`reflex run` in `dashboard/`)
3. Open graph page — nodes/edges render normally with physics
4. Click "Clusters" toggle — nodes rearrange into separated cluster groups
5. Each cluster has its own hull boundary with no overlap
6. Cross-cluster links still drawn as connecting lines between groups
7. Toggle off — nodes unpin and physics layout resumes
8. Click a node in a cluster — detail panel shows cluster membership
9. Zoom in/out — hulls scale properly (padding stays consistent)
10. Search while clusters active — both work independently
11. Refresh while clusters active — layout recomputed correctly
