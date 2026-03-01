# MF-13: Cluster Management — Solved

> Summary of the issue, what was done, considerations made, and impact on the system.

---

## The Issue

**Original priority:** P3

Memories in Nous were stored as a flat collection — no organizational structure beyond node type and subtype. The agent had no way to group related memories (e.g., "all BTC analysis", "momentum strategies", "bear market signals") for scoped search or knowledge management.

**Concrete example:** If the agent stored 50 memories about BTC analysis and 50 about ETH, searching for "funding rate patterns" returned results from both — diluting relevance. The agent couldn't say "search only within my BTC analysis cluster" to focus retrieval on a specific knowledge domain.

Nous core already had cluster types defined in `core/src/clusters/types.ts`, but no server endpoints, no DB tables, no Python client methods, and no agent-facing tools existed. The full lifecycle — create clusters, manage membership, scope search, auto-assign by type — needed to be built end-to-end across TypeScript and Python.

---

## Key Considerations

### 1. Scope: CRUD + membership + search + auto-assign

Full cluster evolution/onboarding/routing was excluded — premature for current scale. The V1 scope covers: create/list/update/delete clusters, add/remove members, cluster-scoped SSA search, health reporting, and subtype-based auto-assignment.

### 2. SSA performance: conditional JOIN

Rather than always JOINing `cluster_memberships` on every search (adding overhead for all queries), the SSA context only JOINs when the request includes a `cluster_ids` filter. Standard searches have zero additional overhead.

### 3. Auto-assignment via `auto_subtypes`

Clusters have an `auto_subtypes` JSON field (e.g., `["custom:thesis", "custom:lesson"]`). When a memory is stored, `_auto_assign_clusters` checks all clusters and assigns the node to any cluster whose `auto_subtypes` include the node's subtype. This runs in a daemon thread to avoid blocking the store response.

### 4. Many-to-many membership model

A node can belong to multiple clusters (e.g., a BTC thesis could be in both "BTC Analysis" and "Thesis Collection"). Membership uses hard weight (1.0) — soft weights excluded for V1 simplicity. `INSERT OR IGNORE` prevents duplicate membership rows.

### 5. Manual cascade deletion (no FK constraints)

Consistent with the existing codebase — neither nodes nor edges use FK cascade deletes. Cluster deletion manually removes memberships first, and node deletion manually removes the node's cluster memberships. This matches the established pattern.

### 6. ID format: `cl_` prefix

Following the existing convention: `n_` for nodes, `e_` for edges, `cl_` for clusters — all using 12-char nanoid.

### 7. Explicit + auto cluster assignment on store

The `store_memory` tool accepts an optional `cluster` parameter for explicit assignment. Auto-assignment also runs, with an `exclude_cluster` guard to prevent double-assigning the explicitly specified cluster.

---

## What Was Implemented

### 1. DB schema — Two new tables

**File:** `nous-server/server/src/db.ts`

`clusters` table (8 columns: id, name, description, icon, pinned, source, auto_subtypes, created_at) and `cluster_memberships` table (5 columns: cluster_id, node_id, weight, pinned, updated_at) with composite primary key `(cluster_id, node_id)`.

### 2. ID helper — `clusterId()`

**File:** `nous-server/server/src/utils.ts`

Generates `cl_` + 12-char nanoid, matching `nodeId()` and `edgeId()` patterns.

### 3. Server routes — 9 endpoints in `clusters.ts`

**File:** `nous-server/server/src/routes/clusters.ts` (NEW — ~290 lines)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/clusters` | Create cluster |
| GET | `/clusters` | List all with node counts |
| GET | `/clusters/:id` | Get single cluster |
| PATCH | `/clusters/:id` | Update fields |
| DELETE | `/clusters/:id` | Delete (cascades memberships) |
| POST | `/clusters/:id/members` | Add member(s) |
| DELETE | `/clusters/:id/members/:node_id` | Remove member |
| GET | `/clusters/:id/members` | List members (with FSRS decay) |
| GET | `/clusters/:id/health` | Lifecycle counts + health ratio |

Includes `parseAutoSubtypes()` helper that parses JSON string to array on all GET/LIST responses.

### 4. SSA context — Conditional cluster JOIN

**File:** `nous-server/server/src/ssa-context.ts`

`createSSAContext()` accepts optional `{ includeClusterData?: boolean }`. When true, `getNode()` JOINs `cluster_memberships` via `GROUP_CONCAT` to populate the node's `clusters` field for cluster-scoped filtering. When false/omitted, the standard query runs with zero overhead.

### 5. Search integration — `cluster_ids` filter

**File:** `nous-server/server/src/routes/search.ts`

Destructures `cluster_ids` from request body, creates cluster-aware SSA context when present, passes `clusters` filter to SSA request. Non-cluster searches are completely unchanged.

### 6. Node deletion cleanup

**File:** `nous-server/server/src/routes/nodes.ts`

Added `DELETE FROM cluster_memberships WHERE node_id = ?` before node deletion to prevent orphaned membership rows.

### 7. Python client — 9 cluster methods + search update

**File:** `src/hynous/nous/client.py`

Nine new methods on `NousClient`: `create_cluster`, `list_clusters`, `get_cluster`, `update_cluster`, `delete_cluster`, `add_to_cluster`, `remove_from_cluster`, `get_cluster_members`, `get_cluster_health`. Also updated `search()` to accept `cluster_ids` parameter.

### 8. Agent tool — `manage_clusters` with 8 actions

**File:** `src/hynous/intelligence/tools/clusters.py` (NEW — ~310 lines)

Multi-action tool: `list`, `create`, `update`, `delete`, `add`, `remove`, `members`, `health`. Includes `_normalize_subtypes()` to convert short names ("thesis") to full form ("custom:thesis") and `_format_subtypes_display()` to strip the prefix for agent-readable output.

### 9. Store/recall memory integration

**File:** `src/hynous/intelligence/tools/memory.py`

- `store_memory`: Added `cluster` parameter for explicit assignment + `_auto_assign_clusters()` helper for background auto-assignment by subtype
- `recall_memory`: Added `cluster` parameter, passed through as `cluster_ids=[cluster]` to `client.search()`
- Queue mode: Includes cluster in kwargs, shows `[-> cluster: ...]` in queued/stored result messages

---

## Audit Results

**Verdict: PASS — No P0, P1, or P2 issues found.**

40 E2E test assertions executed covering: full CRUD lifecycle, membership management (single + batch), cascade deletion (both cluster→memberships and node→memberships), multi-cluster membership, cluster-scoped search with real OpenAI embeddings (verified non-member exclusion), health reporting, error handling (404s, 400s), and regression compatibility with existing endpoints.

Cluster-scoped search verified end-to-end: 3 nodes with embeddings, unscoped search returned all 3, cluster-scoped search correctly filtered to only the 2 cluster members. SSA seed counts confirmed the filter operates at the seeding level, not just post-filtering.

**5 informational P3 observations (no action needed):**

| # | Observation |
|---|-------------|
| P3-1 | INSERT OR IGNORE `added` counter is misleading — increments even when row already exists |
| P3-2 | No index on `cluster_memberships.node_id` — fine for current scale |
| P3-3 | Implementation order table in `more-functionality.md` not strikethrough-updated |
| P3-4 | Pre-existing stale text in `nous/README.md` about MF-0 remaining |
| P3-5 | PRAGMA foreign_keys=ON enabled but cluster tables use manual cascade (intentional, matches guide) |

---

## Impact on the System

### Immediate

- **Organized knowledge base.** The agent can now group memories by asset, strategy, market regime, or any custom category. Clusters provide the organizational layer that was completely missing.
- **Scoped search.** `recall_memory(cluster="cl_xxx")` restricts SSA retrieval to cluster members only, dramatically improving relevance when the agent is focused on a specific topic.
- **Automatic organization.** Clusters with `auto_subtypes` ensure future memories of matching types are auto-assigned without the agent needing to remember to specify a cluster on every store.

### Long-term

- **Knowledge domains scale.** As the agent accumulates hundreds of memories, clusters prevent retrieval degradation by allowing focused search within relevant subsets.
- **Multi-cluster membership enables cross-referencing.** A memory about "BTC funding rate patterns during bear markets" can belong to both "BTC Analysis" and "Bear Market Signals", making it discoverable from either context.
- **Health reporting enables maintenance.** The health endpoint shows active/weak/dormant distribution per cluster, letting the agent identify knowledge domains that need refresh or review.

---

## Files Changed

| File | Change |
|------|--------|
| `nous-server/server/src/db.ts` | Add `clusters` + `cluster_memberships` tables |
| `nous-server/server/src/utils.ts` | Add `clusterId()` export |
| `nous-server/server/src/routes/clusters.ts` | **NEW** — 9 route handlers (~290 lines) |
| `nous-server/server/src/index.ts` | Import + mount cluster routes (2 lines) |
| `nous-server/server/src/ssa-context.ts` | Optional `includeClusterData` param, conditional JOIN in `getNode()` |
| `nous-server/server/src/routes/search.ts` | `cluster_ids` destructure, cluster-aware SSA context, filter passthrough |
| `nous-server/server/src/routes/nodes.ts` | Delete cluster memberships on node deletion (1 line) |
| `src/hynous/nous/client.py` | 9 cluster methods + `cluster_ids` on `search()` |
| `src/hynous/intelligence/tools/clusters.py` | **NEW** — `manage_clusters` tool with 8 actions (~310 lines) |
| `src/hynous/intelligence/tools/registry.py` | Import + register clusters module (2 lines) |
| `src/hynous/intelligence/tools/memory.py` | `cluster` param on store + recall, `_auto_assign_clusters` helper, result messages |
| `revisions/nous-wiring/more-functionality.md` | Mark MF-13 DONE |
| `src/hynous/nous/README.md` | Add 9 cluster methods to table |
| `src/hynous/intelligence/tools/README.md` | Add clusters.py as tool #17 |
| `src/hynous/intelligence/README.md` | Update tool count to 17 |

**Implementation guide:** `revisions/MF13/implementation-guide.md`
**Audit notes:** `revisions/MF13/audit-notes.md`
