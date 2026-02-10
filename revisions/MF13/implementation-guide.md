# MF-13: Cluster Management — Implementation Guide

> Extremely detailed, step-by-step guide for implementing cluster management across Nous (TypeScript) and Hynous (Python). Every code change is specified exactly. Follow sequentially.

---

## Prerequisites — Read Before Coding

Read these files **in full** before writing any code. Understanding the existing patterns is critical — every new piece must be consistent with them.

### Nous Server (TypeScript)

| File | Why |
|------|-----|
| `nous-server/server/src/db.ts` | DB schema pattern — how tables are created, `safeAddColumn`, `getDb()` singleton |
| `nous-server/server/src/utils.ts` | ID generation pattern — `nodeId()`, `edgeId()`, `now()` |
| `nous-server/server/src/index.ts` | Route mounting pattern — `app.route('/', routeName)` |
| `nous-server/server/src/routes/edges.ts` | **Primary route pattern** — CRUD + strengthen. Cleanest example of a route file |
| `nous-server/server/src/routes/nodes.ts` | Node CRUD + check-similar + backfill. Shows `applyDecay` usage for list responses |
| `nous-server/server/src/routes/search.ts` | Search route — where `cluster_ids` filter will be passed to SSA |
| `nous-server/server/src/ssa-context.ts` | SSA graph context — where cluster data must be loaded for cluster-scoped search |
| `nous-server/server/src/core-bridge.ts` | `applyDecay()`, `NodeRow` type — needed for member listing |

### Hynous (Python)

| File | Why |
|------|-----|
| `src/hynous/nous/client.py` | NousClient pattern — every method follows `self._session.[method](self._url(...))` → `resp.raise_for_status()` → `return resp.json()` |
| `src/hynous/intelligence/tools/conflicts.py` | **Primary tool pattern** — multi-action tool (list/resolve). 205 lines. Copy this structure. |
| `src/hynous/intelligence/tools/explore_memory.py` | Another multi-action tool (explore/link/unlink). 200 lines. |
| `src/hynous/intelligence/tools/memory.py` | Store/recall/update tools — where auto-assignment and cluster search filter are added |
| `src/hynous/intelligence/tools/registry.py` | Tool registration — where to add the import + register call |

### Documentation

| File | Why |
|------|-----|
| `revisions/nous-wiring/more-functionality.md` | MF-13 description and the status of all other MFs |
| `revisions/nous-wiring/executive-summary.md` | Overall integration landscape |
| `nous-server/core/src/clusters/types.ts` | Core cluster types — understand the data model (do NOT import from core; use as reference only) |

---

## Architecture Decisions (Already Made)

These decisions are final. Do not deviate.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Scope** | CRUD + membership + cluster-scoped search + health + auto-assign | Full evolution/onboarding/routing excluded — premature for current scale |
| **SSA performance** | Option B — conditional JOIN in `getNode()` | Only JOIN `cluster_memberships` when `cluster_ids` filter is present in search request |
| **Auto-assignment** | Subtype-based rules on clusters | Clusters have `auto_subtypes` field; `_store_memory_impl` checks matches and assigns automatically |
| **Explicit assignment** | Optional `cluster` param on `store_memory` | Agent can specify a cluster ID at store time; also runs auto-assign |
| **Membership model** | Many-to-many, hard weight (1.0) | A node can belong to multiple clusters. Soft weights excluded for V1 |
| **FK cascades** | Manual cleanup (no PRAGMA foreign_keys) | Consistent with existing codebase — edges and nodes don't use FK cascades |
| **ID format** | `cl_` + 12 char nanoid | Matches `n_` (nodes), `e_` (edges) pattern |
| **Auto-subtypes storage** | JSON string in SQLite, parsed to array on read | Matches pattern of storing structured data in TEXT columns |
| **Cluster filter on search** | `cluster` param on `recall_memory` (search mode only) | Passed through as `cluster_ids` to `POST /search` |

---

## Implementation Steps

### Step 1: DB Schema — Add Cluster Tables

**File:** `nous-server/server/src/db.ts`

**What:** Add two new tables (`clusters` and `cluster_memberships`) to the `initDb()` function.

**Where:** Inside the `initDb()` function, after the existing `CREATE TABLE` statements for `nodes`, `edges`, and `conflict_queue`. Add the two new `CREATE TABLE` statements at the end, before the `safeAddColumn` calls.

**Exact code to add** (insert after the last existing `CREATE TABLE` block and before the first `safeAddColumn` call):

```typescript
  // ---- Clusters (MF-13) ----
  await db.execute(`
    CREATE TABLE IF NOT EXISTS clusters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      pinned INTEGER DEFAULT 0,
      source TEXT DEFAULT 'user_created',
      auto_subtypes TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS cluster_memberships (
      cluster_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      pinned INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (cluster_id, node_id)
    )
  `);
```

**Column definitions:**

| Table | Column | Type | Purpose |
|-------|--------|------|---------|
| `clusters` | `id` | TEXT PK | `cl_` + 12 chars |
| `clusters` | `name` | TEXT NOT NULL | Display name (e.g., "BTC Analysis") |
| `clusters` | `description` | TEXT | Optional description |
| `clusters` | `icon` | TEXT | Optional emoji/icon |
| `clusters` | `pinned` | INTEGER | 0 or 1 — pinned clusters sort first |
| `clusters` | `source` | TEXT | Always `'user_created'` for V1 |
| `clusters` | `auto_subtypes` | TEXT | JSON array string (e.g., `'["custom:thesis","custom:lesson"]'`) or NULL |
| `clusters` | `created_at` | TEXT | ISO timestamp |
| `cluster_memberships` | `cluster_id` | TEXT | References `clusters.id` |
| `cluster_memberships` | `node_id` | TEXT | References `nodes.id` |
| `cluster_memberships` | `weight` | REAL | Always 1.0 for V1 |
| `cluster_memberships` | `pinned` | INTEGER | 0 or 1 |
| `cluster_memberships` | `updated_at` | TEXT | ISO timestamp |

**Important:** Do NOT add `FOREIGN KEY` constraints. The existing codebase does not use them (SQLite PRAGMA foreign_keys is not enabled). Cascade deletes are handled manually in the route handlers.

---

### Step 2: ID Helper — Add `clusterId()`

**File:** `nous-server/server/src/utils.ts`

**What:** Add a `clusterId()` function following the existing `nodeId()` and `edgeId()` pattern.

**Current file content (full):**

```typescript
import { nanoid } from 'nanoid';

export const nodeId = () => `n_${nanoid(12)}`;
export const edgeId = () => `e_${nanoid(12)}`;
export const now = () => new Date().toISOString();
```

**New file content (full replacement):**

```typescript
import { nanoid } from 'nanoid';

export const nodeId = () => `n_${nanoid(12)}`;
export const edgeId = () => `e_${nanoid(12)}`;
export const clusterId = () => `cl_${nanoid(12)}`;
export const now = () => new Date().toISOString();
```

**Only change:** Add the `clusterId` line between `edgeId` and `now`.

---

### Step 3: Server Routes — Create `clusters.ts`

**File:** `nous-server/server/src/routes/clusters.ts` **(NEW FILE)**

**What:** Full CRUD for clusters + membership management + health endpoint. 9 routes total.

**Create this file with the following exact content:**

```typescript
import { Hono } from 'hono';
import { getDb } from '../db.js';
import { clusterId, now } from '../utils.js';
import { applyDecay, type NodeRow } from '../core-bridge.js';

const clusters = new Hono();

/**
 * Parse auto_subtypes from JSON string to array.
 * SQLite stores TEXT; we return a proper array to clients.
 */
function parseAutoSubtypes(row: any): any {
  if (row && row.auto_subtypes && typeof row.auto_subtypes === 'string') {
    try {
      row.auto_subtypes = JSON.parse(row.auto_subtypes);
    } catch {
      // Malformed JSON — leave as string
    }
  }
  return row;
}

// ---- CREATE ----
clusters.post('/clusters', async (c) => {
  const body = await c.req.json();
  const { name, description, icon, pinned, auto_subtypes } = body;

  if (!name || typeof name !== 'string') {
    return c.json({ error: 'name is required' }, 400);
  }

  const id = clusterId();
  const ts = now();
  const autoSubtypesJson = Array.isArray(auto_subtypes)
    ? JSON.stringify(auto_subtypes)
    : null;

  const db = getDb();
  await db.execute({
    sql: `INSERT INTO clusters (id, name, description, icon, pinned, source, auto_subtypes, created_at)
          VALUES (?, ?, ?, ?, ?, 'user_created', ?, ?)`,
    args: [
      id, name, description ?? null, icon ?? null,
      pinned ? 1 : 0, autoSubtypesJson, ts,
    ],
  });

  const result = await db.execute({
    sql: 'SELECT * FROM clusters WHERE id = ?',
    args: [id],
  });
  return c.json(parseAutoSubtypes({ ...result.rows[0] }), 201);
});

// ---- LIST (with node counts) ----
clusters.get('/clusters', async (c) => {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT c.*, COUNT(cm.node_id) as node_count
          FROM clusters c
          LEFT JOIN cluster_memberships cm ON cm.cluster_id = c.id
          GROUP BY c.id
          ORDER BY c.pinned DESC, c.created_at DESC`,
    args: [],
  });

  const data = result.rows.map((row) => parseAutoSubtypes({ ...row }));
  return c.json({ data, count: data.length });
});

// ---- GET BY ID ----
clusters.get('/clusters/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT c.*, COUNT(cm.node_id) as node_count
          FROM clusters c
          LEFT JOIN cluster_memberships cm ON cm.cluster_id = c.id
          WHERE c.id = ?
          GROUP BY c.id`,
    args: [id],
  });

  if (result.rows.length === 0) return c.json({ error: 'not found' }, 404);
  return c.json(parseAutoSubtypes({ ...result.rows[0] }));
});

// ---- UPDATE (PATCH) ----
clusters.patch('/clusters/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const db = getDb();

  const existing = await db.execute({
    sql: 'SELECT * FROM clusters WHERE id = ?',
    args: [id],
  });
  if (existing.rows.length === 0) return c.json({ error: 'not found' }, 404);

  const sets: string[] = [];
  const args: (string | number | null)[] = [];

  // Simple fields
  for (const field of ['name', 'description', 'icon'] as const) {
    if (field in body) {
      sets.push(`${field} = ?`);
      args.push(body[field] ?? null);
    }
  }

  // Boolean field — stored as INTEGER
  if ('pinned' in body) {
    sets.push('pinned = ?');
    args.push(body.pinned ? 1 : 0);
  }

  // JSON field — serialize array to string
  if ('auto_subtypes' in body) {
    sets.push('auto_subtypes = ?');
    args.push(
      Array.isArray(body.auto_subtypes)
        ? JSON.stringify(body.auto_subtypes)
        : null,
    );
  }

  if (sets.length === 0) {
    return c.json({ error: 'no valid fields to update' }, 400);
  }

  args.push(id);
  await db.execute({
    sql: `UPDATE clusters SET ${sets.join(', ')} WHERE id = ?`,
    args,
  });

  const result = await db.execute({
    sql: 'SELECT * FROM clusters WHERE id = ?',
    args: [id],
  });
  return c.json(parseAutoSubtypes({ ...result.rows[0] }));
});

// ---- DELETE (manual cascade — remove memberships first) ----
clusters.delete('/clusters/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  await db.execute({
    sql: 'DELETE FROM cluster_memberships WHERE cluster_id = ?',
    args: [id],
  });
  await db.execute({
    sql: 'DELETE FROM clusters WHERE id = ?',
    args: [id],
  });
  return c.json({ ok: true });
});

// ---- ADD MEMBER(S) ----
clusters.post('/clusters/:id/members', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { node_id, node_ids } = body;

  const db = getDb();

  // Verify cluster exists
  const cluster = await db.execute({
    sql: 'SELECT id FROM clusters WHERE id = ?',
    args: [id],
  });
  if (cluster.rows.length === 0) {
    return c.json({ error: 'cluster not found' }, 404);
  }

  // Accept single node_id or array node_ids
  const ids: string[] = node_ids ?? (node_id ? [node_id] : []);
  if (ids.length === 0) {
    return c.json({ error: 'node_id or node_ids is required' }, 400);
  }

  const ts = now();
  let added = 0;

  for (const nid of ids) {
    try {
      await db.execute({
        sql: `INSERT OR IGNORE INTO cluster_memberships
              (cluster_id, node_id, weight, pinned, updated_at)
              VALUES (?, ?, 1.0, 0, ?)`,
        args: [id, nid, ts],
      });
      added++;
    } catch {
      // Node doesn't exist or other constraint — skip silently
    }
  }

  return c.json({ ok: true, added, cluster_id: id });
});

// ---- REMOVE MEMBER ----
clusters.delete('/clusters/:id/members/:node_id', async (c) => {
  const id = c.req.param('id');
  const nodeId = c.req.param('node_id');
  const db = getDb();
  await db.execute({
    sql: 'DELETE FROM cluster_memberships WHERE cluster_id = ? AND node_id = ?',
    args: [id, nodeId],
  });
  return c.json({ ok: true });
});

// ---- LIST MEMBERS ----
clusters.get('/clusters/:id/members', async (c) => {
  const id = c.req.param('id');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const db = getDb();

  const result = await db.execute({
    sql: `SELECT n.*,
            cm.weight as membership_weight,
            cm.updated_at as membership_updated_at
          FROM cluster_memberships cm
          JOIN nodes n ON n.id = cm.node_id
          WHERE cm.cluster_id = ?
          ORDER BY cm.updated_at DESC
          LIMIT ?`,
    args: [id, limit],
  });

  // Apply FSRS decay for display (same pattern as GET /nodes list)
  const data = result.rows.map((row) =>
    applyDecay(row as unknown as NodeRow),
  );
  return c.json({ data, count: data.length });
});

// ---- HEALTH ----
clusters.get('/clusters/:id/health', async (c) => {
  const id = c.req.param('id');
  const db = getDb();

  // Verify cluster exists
  const cluster = await db.execute({
    sql: 'SELECT id, name FROM clusters WHERE id = ?',
    args: [id],
  });
  if (cluster.rows.length === 0) {
    return c.json({ error: 'not found' }, 404);
  }

  // Count nodes per lifecycle state
  const stats = await db.execute({
    sql: `SELECT
            COUNT(*) as total_nodes,
            SUM(CASE WHEN n.state_lifecycle = 'ACTIVE' THEN 1 ELSE 0 END) as active_nodes,
            SUM(CASE WHEN n.state_lifecycle = 'WEAK' THEN 1 ELSE 0 END) as weak_nodes,
            SUM(CASE WHEN n.state_lifecycle = 'DORMANT' THEN 1 ELSE 0 END) as dormant_nodes
          FROM cluster_memberships cm
          JOIN nodes n ON n.id = cm.node_id
          WHERE cm.cluster_id = ?`,
    args: [id],
  });

  const row = stats.rows[0] as any;
  const total = Number(row.total_nodes ?? 0);
  const active = Number(row.active_nodes ?? 0);

  return c.json({
    cluster_id: id,
    name: (cluster.rows[0] as any).name,
    total_nodes: total,
    active_nodes: active,
    weak_nodes: Number(row.weak_nodes ?? 0),
    dormant_nodes: Number(row.dormant_nodes ?? 0),
    health_ratio: total > 0 ? Math.round((active / total) * 10000) / 10000 : 0,
  });
});

export default clusters;
```

**Route summary:**

| Method | Path | Status Codes |
|--------|------|-------------|
| `POST /clusters` | Create cluster | 201, 400 |
| `GET /clusters` | List all clusters | 200 |
| `GET /clusters/:id` | Get single cluster | 200, 404 |
| `PATCH /clusters/:id` | Update cluster | 200, 400, 404 |
| `DELETE /clusters/:id` | Delete cluster | 200 |
| `POST /clusters/:id/members` | Add member(s) | 200, 400, 404 |
| `DELETE /clusters/:id/members/:node_id` | Remove member | 200 |
| `GET /clusters/:id/members` | List members | 200 |
| `GET /clusters/:id/health` | Health stats | 200, 404 |

---

### Step 4: Mount Routes — Update `index.ts`

**File:** `nous-server/server/src/index.ts`

**What:** Import and mount the cluster routes.

**Add this import** at the top of the file, alongside the other route imports:

```typescript
import clusters from './routes/clusters.js';
```

**Add this route mount** alongside the other `app.route()` calls (after the last existing one):

```typescript
app.route('/', clusters);
```

**Result:** The file should have these route mounts (order doesn't matter, but add clusters at the end for clarity):

```typescript
app.route('/', health);
app.route('/', nodes);
app.route('/', edges);
app.route('/', search);
app.route('/', decay);
app.route('/', graph);
app.route('/', contradiction);
app.route('/', classify);
app.route('/', clusters);  // <-- NEW
```

---

### Step 5: SSA Context — Conditional Cluster Data

**File:** `nous-server/server/src/ssa-context.ts`

**What:** Update `createSSAContext()` to accept an options parameter. When `includeClusterData` is true, the `getNode()` method JOINs `cluster_memberships` to include cluster IDs in the returned node data. When false (or omitted), behavior is unchanged.

**Change the function signature and the `getNode` method only.** All other methods (`getNeighbors`, `vectorSearch`, `bm25Search`, `getGraphMetrics`, `getNodeForReranking`) remain exactly as they are.

**Replace the `createSSAContext` function signature and `getNode` method:**

Find this code (the function signature and the `getNode` method):

```typescript
export function createSSAContext(): SSAGraphContext {
  return {
    /**
     * Fetch minimal node info for filter evaluation during spreading.
     */
    async getNode(id: string): Promise<FilterNodeInput | null> {
      const db = getDb();
      const r = await db.execute({
        sql: `SELECT id, type, created_at,
              COALESCE(neural_last_accessed, provenance_created_at) as last_accessed
              FROM nodes WHERE id = ?`,
        args: [id],
      });
      if (r.rows.length === 0) return null;
      const row = r.rows[0]!;
      return {
        id: row.id as string,
        type: row.type as string,
        created_at: row.created_at as string,
        last_accessed: row.last_accessed as string,
      };
    },
```

Replace with:

```typescript
export function createSSAContext(options?: {
  includeClusterData?: boolean;
}): SSAGraphContext {
  return {
    /**
     * Fetch minimal node info for filter evaluation during spreading.
     * When includeClusterData is true, JOINs cluster_memberships to
     * populate the clusters field (needed for cluster-scoped search).
     */
    async getNode(id: string): Promise<FilterNodeInput | null> {
      const db = getDb();

      if (options?.includeClusterData) {
        const r = await db.execute({
          sql: `SELECT n.id, n.type, n.created_at,
                COALESCE(n.neural_last_accessed, n.provenance_created_at) as last_accessed,
                GROUP_CONCAT(cm.cluster_id) as cluster_ids
                FROM nodes n
                LEFT JOIN cluster_memberships cm ON cm.node_id = n.id
                WHERE n.id = ?
                GROUP BY n.id`,
          args: [id],
        });
        if (r.rows.length === 0) return null;
        const row = r.rows[0]!;
        const clusterStr = row.cluster_ids as string | null;
        return {
          id: row.id as string,
          type: row.type as string,
          created_at: row.created_at as string,
          last_accessed: row.last_accessed as string,
          clusters: clusterStr ? clusterStr.split(',') : [],
        };
      }

      // Standard path — no cluster data (zero overhead)
      const r = await db.execute({
        sql: `SELECT id, type, created_at,
              COALESCE(neural_last_accessed, provenance_created_at) as last_accessed
              FROM nodes WHERE id = ?`,
        args: [id],
      });
      if (r.rows.length === 0) return null;
      const row = r.rows[0]!;
      return {
        id: row.id as string,
        type: row.type as string,
        created_at: row.created_at as string,
        last_accessed: row.last_accessed as string,
      };
    },
```

**All other methods in the returned object remain unchanged.** Only the function signature and `getNode` change.

---

### Step 6: Search Integration — Pass `cluster_ids` to SSA

**File:** `nous-server/server/src/routes/search.ts`

**What:** Accept `cluster_ids` from the request body, pass it to SSA filters, and create a cluster-aware SSA context when needed.

**Change 1 — Destructure `cluster_ids` from request body.**

Find this line:

```typescript
  const { query, type, subtype, lifecycle, limit: rawLimit, time_range } = body;
```

Replace with:

```typescript
  const { query, type, subtype, lifecycle, limit: rawLimit, time_range, cluster_ids } = body;
```

**Change 2 — Create cluster-aware SSA context.**

Find this line:

```typescript
    const context = createSSAContext();
```

Replace with:

```typescript
    const hasClusterFilter = Array.isArray(cluster_ids) && cluster_ids.length > 0;
    const context = createSSAContext(
      hasClusterFilter ? { includeClusterData: true } : undefined,
    );
```

**Change 3 — Pass cluster filter to SSA request.**

Find this code:

```typescript
    const ssaResult = await executeSSA({
      request: {
        query,
        // Over-fetch for post-filtering — QCS adjusts multiplier
        limit: limit * ssaMultiplier,
        // SSA supports type filtering natively
        filters: type ? { types: [type] } : undefined,
      },
```

Replace with:

```typescript
    const ssaResult = await executeSSA({
      request: {
        query,
        // Over-fetch for post-filtering — QCS adjusts multiplier
        limit: limit * ssaMultiplier,
        // SSA supports type and cluster filtering natively
        filters: (type || hasClusterFilter)
          ? {
              ...(type ? { types: [type] } : {}),
              ...(hasClusterFilter ? { clusters: cluster_ids } : {}),
            }
          : undefined,
      },
```

**No other changes to search.ts.** The fallback LIKE search does not need cluster support (it's an emergency fallback).

---

### Step 7: Python Client — Add Cluster Methods

**File:** `src/hynous/nous/client.py`

**What:** Add 9 new methods to the `NousClient` class and update `search()` to accept `cluster_ids`.

**Change 1 — Update `search()` signature and payload.**

Find the `search` method. Locate its signature:

```python
    def search(
        self,
        query: str,
        type: str | None = None,
        subtype: str | None = None,
        lifecycle: str | None = None,
        limit: int = 10,
        time_range: dict | None = None,
    ) -> list[dict]:
```

Replace with:

```python
    def search(
        self,
        query: str,
        type: str | None = None,
        subtype: str | None = None,
        lifecycle: str | None = None,
        limit: int = 10,
        time_range: dict | None = None,
        cluster_ids: list[str] | None = None,
    ) -> list[dict]:
```

Inside the same `search` method, find where the payload is built. Locate the block that adds `time_range` to the payload (it will look like `if time_range: payload["time_range"] = time_range`). Add this line immediately after it:

```python
        if cluster_ids:
            payload["cluster_ids"] = cluster_ids
```

**Change 2 — Add cluster methods at the end of the `NousClient` class.**

Add all 9 methods below at the end of the class, before the module-level `get_client()` function. Place them after the last existing method (likely `classify_query`).

```python
    # ================================================================
    # Clusters (MF-13)
    # ================================================================

    def create_cluster(
        self,
        name: str,
        description: str | None = None,
        icon: str | None = None,
        pinned: bool = False,
        auto_subtypes: list[str] | None = None,
    ) -> dict:
        """Create a new cluster."""
        payload: dict = {"name": name}
        if description is not None:
            payload["description"] = description
        if icon is not None:
            payload["icon"] = icon
        if pinned:
            payload["pinned"] = True
        if auto_subtypes:
            payload["auto_subtypes"] = auto_subtypes
        resp = self._session.post(self._url("/clusters"), json=payload)
        resp.raise_for_status()
        return resp.json()

    def list_clusters(self) -> list[dict]:
        """List all clusters with node counts."""
        resp = self._session.get(self._url("/clusters"))
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", data) if isinstance(data, dict) else data

    def get_cluster(self, cluster_id: str) -> dict:
        """Get cluster details."""
        resp = self._session.get(self._url(f"/clusters/{cluster_id}"))
        resp.raise_for_status()
        return resp.json()

    def update_cluster(self, cluster_id: str, **kwargs) -> dict:
        """Update cluster fields (name, description, icon, pinned, auto_subtypes)."""
        resp = self._session.patch(
            self._url(f"/clusters/{cluster_id}"), json=kwargs,
        )
        resp.raise_for_status()
        return resp.json()

    def delete_cluster(self, cluster_id: str) -> dict:
        """Delete a cluster. Memberships are removed automatically."""
        resp = self._session.delete(self._url(f"/clusters/{cluster_id}"))
        resp.raise_for_status()
        return resp.json()

    def add_to_cluster(
        self,
        cluster_id: str,
        node_id: str | None = None,
        node_ids: list[str] | None = None,
    ) -> dict:
        """Add node(s) to a cluster."""
        payload: dict = {}
        if node_id:
            payload["node_id"] = node_id
        if node_ids:
            payload["node_ids"] = node_ids
        resp = self._session.post(
            self._url(f"/clusters/{cluster_id}/members"), json=payload,
        )
        resp.raise_for_status()
        return resp.json()

    def remove_from_cluster(self, cluster_id: str, node_id: str) -> dict:
        """Remove a node from a cluster."""
        resp = self._session.delete(
            self._url(f"/clusters/{cluster_id}/members/{node_id}"),
        )
        resp.raise_for_status()
        return resp.json()

    def get_cluster_members(self, cluster_id: str, limit: int = 50) -> list[dict]:
        """List members of a cluster."""
        resp = self._session.get(
            self._url(f"/clusters/{cluster_id}/members"),
            params={"limit": limit},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", data) if isinstance(data, dict) else data

    def get_cluster_health(self, cluster_id: str) -> dict:
        """Get health stats for a cluster."""
        resp = self._session.get(
            self._url(f"/clusters/{cluster_id}/health"),
        )
        resp.raise_for_status()
        return resp.json()
```

---

### Step 8: Agent Tool — Create `clusters.py`

**File:** `src/hynous/intelligence/tools/clusters.py` **(NEW FILE)**

**What:** A `manage_clusters` tool with 8 actions: `list`, `create`, `update`, `delete`, `add`, `remove`, `members`, `health`.

**Create this file with the following exact content:**

```python
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
```

---

### Step 9: Tool Registry — Register Clusters Tool

**File:** `src/hynous/intelligence/tools/registry.py`

**What:** Import and register the clusters tool module.

**Add these two lines** at the end of the `get_registry()` function, after the last existing `register()` call (which is `conflicts.register(registry)`):

```python
    from . import clusters
    clusters.register(registry)
```

**Result:** The end of `get_registry()` should look like:

```python
    from . import explore_memory
    explore_memory.register(registry)

    from . import conflicts
    conflicts.register(registry)

    from . import clusters
    clusters.register(registry)

    return registry
```

---

### Step 10: Store Memory Integration — Auto-Assignment + Optional Cluster Param

**File:** `src/hynous/intelligence/tools/memory.py`

**What:** Three changes:
1. Add `cluster` parameter to `STORE_TOOL_DEF`
2. Add `cluster` parameter to `handle_store_memory` and `_store_memory_impl`
3. Add auto-assignment logic after node creation

**Change 1 — Add `cluster` to STORE_TOOL_DEF parameters.**

In the `STORE_TOOL_DEF` dict, inside `"parameters"` → `"properties"`, add this new property after the existing `"event_time"` property:

```python
            "cluster": {
                "type": "string",
                "description": (
                    "Cluster ID to assign this memory to (optional). "
                    "Get cluster IDs from manage_clusters(action=\"list\"). "
                    "Memories are also auto-assigned to clusters based on "
                    "their type if the cluster has matching auto_subtypes."
                ),
            },
```

**Change 2 — Add `cluster` to handler signatures.**

In `handle_store_memory`, add `cluster: Optional[str] = None` to the function signature. The full signature becomes:

```python
def handle_store_memory(
    content: str,
    memory_type: str,
    title: str,
    trigger: Optional[dict] = None,
    signals: Optional[dict] = None,
    link_ids: Optional[list] = None,
    event_time: Optional[str] = None,
    cluster: Optional[str] = None,
) -> str:
```

Inside `handle_store_memory`, add `cluster=cluster` to the `kwargs` dict construction:

```python
    kwargs = dict(
        content=content, memory_type=memory_type, title=title,
        trigger=trigger, signals=signals, link_ids=link_ids,
        event_time=event_time, cluster=cluster,
    )
```

In `_store_memory_impl`, add `cluster: Optional[str] = None` to the function signature. The full signature becomes:

```python
def _store_memory_impl(
    content: str,
    memory_type: str,
    title: str,
    trigger: Optional[dict] = None,
    signals: Optional[dict] = None,
    link_ids: Optional[list] = None,
    event_time: Optional[str] = None,
    cluster: Optional[str] = None,
) -> str:
```

**Change 3 — Add cluster assignment after node creation.**

Inside `_store_memory_impl`, find the line that logs successful storage (near the end of the `try` block):

```python
        logger.info("Stored %s: \"%s\" (%s)", memory_type, title, node_id)
        result_msg = f"Stored: \"{title}\" ({node_id})"
```

Insert the following code block **immediately before** those two lines (after the connect-tier edge creation block and before the logger.info):

```python
        # ---- Cluster assignment (MF-13) ----
        # 1. Explicit cluster (synchronous — agent gets feedback)
        if cluster:
            try:
                client.add_to_cluster(cluster, node_id=node_id)
            except Exception as e:
                logger.debug("Explicit cluster assignment failed: %s", e)

        # 2. Auto-assign based on cluster auto_subtypes (background)
        _auto_assign_clusters(client, node_id, subtype, exclude_cluster=cluster)
```

**Change 4 — Add the auto-assign helper function.**

Add this function in the module, after the existing `_auto_link` function and before the `_TYPE_MAP` dict:

```python
def _auto_assign_clusters(
    client, node_id: str, subtype: str, exclude_cluster: str | None = None,
):
    """Auto-assign node to clusters whose auto_subtypes include this subtype.

    Runs in background thread to avoid blocking the store response.
    Skips the exclude_cluster (already assigned explicitly).
    """
    def _assign():
        try:
            clusters = client.list_clusters()
            for cl in clusters:
                cid = cl.get("id")
                if not cid:
                    continue
                # Skip if already explicitly assigned
                if exclude_cluster and cid == exclude_cluster:
                    continue

                auto_subs = cl.get("auto_subtypes")
                if not auto_subs:
                    continue

                # Handle both parsed list and raw JSON string
                if isinstance(auto_subs, str):
                    try:
                        auto_subs = json.loads(auto_subs)
                    except (json.JSONDecodeError, TypeError):
                        continue

                if not isinstance(auto_subs, list):
                    continue

                if subtype in auto_subs:
                    try:
                        client.add_to_cluster(cid, node_id=node_id)
                    except Exception:
                        continue

        except Exception as e:
            logger.debug("Cluster auto-assignment failed for %s: %s", node_id, e)

    threading.Thread(target=_assign, daemon=True).start()
```

**Change 5 — Update the queue result message.**

In `handle_store_memory`, find the queue-mode result message block:

```python
        wikilinks = _WIKILINK_RE.findall(content)
        result = f"Queued: \"{title}\""
        if wikilinks:
            result += f" (will link: {', '.join(wikilinks)})"
        return result
```

Replace with:

```python
        wikilinks = _WIKILINK_RE.findall(content)
        result = f"Queued: \"{title}\""
        if cluster:
            result += f" [→ cluster: {cluster}]"
        if wikilinks:
            result += f" (will link: {', '.join(wikilinks)})"
        return result
```

**Change 6 — Update the stored result message.**

Find the result message construction after the cluster assignment block:

```python
        logger.info("Stored %s: \"%s\" (%s)", memory_type, title, node_id)
        result_msg = f"Stored: \"{title}\" ({node_id})"
```

Replace with:

```python
        logger.info("Stored %s: \"%s\" (%s)", memory_type, title, node_id)
        result_msg = f"Stored: \"{title}\" ({node_id})"
        if cluster:
            result_msg += f" [→ cluster: {cluster}]"
```

---

### Step 11: Recall Memory Integration — Cluster Filter on Search

**File:** `src/hynous/intelligence/tools/memory.py`

**What:** Add a `cluster` parameter to `RECALL_TOOL_DEF` and pass it through to `client.search()` as `cluster_ids`.

**Change 1 — Add `cluster` to RECALL_TOOL_DEF parameters.**

In the `RECALL_TOOL_DEF` dict, inside `"parameters"` → `"properties"`, add this new property after the existing `"time_type"` property:

```python
            "cluster": {
                "type": "string",
                "description": (
                    "Cluster ID to search within (search mode only). "
                    "Only returns memories that belong to this cluster. "
                    "Get cluster IDs from manage_clusters(action=\"list\")."
                ),
            },
```

**Change 2 — Add `cluster` to handler signature.**

In `handle_recall_memory`, add `cluster: Optional[str] = None` to the function signature:

```python
def handle_recall_memory(
    mode: str = "search",
    query: Optional[str] = None,
    memory_type: Optional[str] = None,
    active_only: bool = False,
    limit: int = 10,
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    time_type: Optional[str] = None,
    cluster: Optional[str] = None,
) -> str:
```

**Change 3 — Pass `cluster_ids` to search call.**

In the search mode branch of `handle_recall_memory`, find the `client.search()` call:

```python
            results = client.search(
                query=query,
                type=node_type,
                subtype=subtype,
                lifecycle=lifecycle,
                limit=limit,
                time_range=time_range,
            )
```

Replace with:

```python
            results = client.search(
                query=query,
                type=node_type,
                subtype=subtype,
                lifecycle=lifecycle,
                limit=limit,
                time_range=time_range,
                cluster_ids=[cluster] if cluster else None,
            )
```

---

### Step 12: Node Deletion Cleanup

**File:** `nous-server/server/src/routes/nodes.ts`

**What:** When a node is deleted, also delete its cluster memberships. This prevents orphaned rows in `cluster_memberships`.

Find the DELETE route:

```typescript
// ---- DELETE ----
nodes.delete('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  await db.execute({ sql: 'DELETE FROM nodes WHERE id = ?', args: [id] });
  return c.json({ ok: true });
});
```

Replace with:

```typescript
// ---- DELETE ----
nodes.delete('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  await db.execute({ sql: 'DELETE FROM cluster_memberships WHERE node_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM nodes WHERE id = ?', args: [id] });
  return c.json({ ok: true });
});
```

---

### Step 13: Documentation Updates

**File:** `revisions/nous-wiring/more-functionality.md`

**What:** Mark MF-13 as DONE.

Find the MF-13 section header:

```
## MF-13. [P3] Cluster Management
```

Replace with:

```
## ~~MF-13. [P3] Cluster Management~~ DONE
```

Add a `**Status:** Implemented.` line and a summary of what was done, following the same format as other completed MFs (e.g., MF-12).

**File:** `src/hynous/nous/README.md`

**What:** Add the 9 new cluster methods to the NousClient methods table.

**File:** `src/hynous/intelligence/tools/README.md`

**What:** Add `clusters.py` as tool module #17 with a description of `manage_clusters`.

**File:** `src/hynous/intelligence/README.md`

**What:** Update the tool count from 16 to 17.

---

## File-by-File Summary

| # | File | Action | Changes |
|---|------|--------|---------|
| 1 | `nous-server/server/src/db.ts` | MODIFY | Add `clusters` + `cluster_memberships` tables to `initDb()` |
| 2 | `nous-server/server/src/utils.ts` | MODIFY | Add `clusterId()` export |
| 3 | `nous-server/server/src/routes/clusters.ts` | **CREATE** | 9 route handlers (~220 lines) |
| 4 | `nous-server/server/src/index.ts` | MODIFY | Import + mount cluster routes (2 lines) |
| 5 | `nous-server/server/src/ssa-context.ts` | MODIFY | Add options param, conditional cluster JOIN in `getNode()` |
| 6 | `nous-server/server/src/routes/search.ts` | MODIFY | Destructure `cluster_ids`, create cluster-aware context, pass to SSA filters |
| 7 | `nous-server/server/src/routes/nodes.ts` | MODIFY | Delete cluster memberships on node deletion (1 line) |
| 8 | `src/hynous/nous/client.py` | MODIFY | Add `cluster_ids` to `search()`, add 9 cluster methods |
| 9 | `src/hynous/intelligence/tools/clusters.py` | **CREATE** | `manage_clusters` tool (~310 lines) |
| 10 | `src/hynous/intelligence/tools/registry.py` | MODIFY | Import + register clusters module (2 lines) |
| 11 | `src/hynous/intelligence/tools/memory.py` | MODIFY | `cluster` param on store + recall, auto-assign helper |
| 12 | `revisions/nous-wiring/more-functionality.md` | MODIFY | Mark MF-13 DONE |
| 13 | `src/hynous/nous/README.md` | MODIFY | Add cluster methods to table |
| 14 | `src/hynous/intelligence/tools/README.md` | MODIFY | Add clusters.py as tool #17 |
| 15 | `src/hynous/intelligence/README.md` | MODIFY | Update tool count |

**Total: 2 new files, 13 modified files.**

---

## Self-Review Checklist

Before submitting for audit, verify every item:

### TypeScript (Nous Server)

- [ ] **`pnpm build` succeeds** in `nous-server/` with zero errors
- [ ] **Server starts** — run `pnpm dev` in `nous-server/server/`, confirm no startup crashes
- [ ] **Tables created** — after server starts, verify `clusters` and `cluster_memberships` tables exist (check logs or use `sqlite3` on the DB file)
- [ ] **POST /v1/clusters** — create a test cluster, verify 201 response with `id` starting with `cl_`
- [ ] **GET /v1/clusters** — list returns the created cluster with `node_count: 0`
- [ ] **POST /v1/clusters/:id/members** — add a node, verify `added: 1`
- [ ] **POST /v1/clusters/:id/members** (duplicate) — add the same node again, verify `INSERT OR IGNORE` doesn't crash (returns `added: 1` but no duplicate row)
- [ ] **GET /v1/clusters/:id/members** — list members shows the node with FSRS decay applied
- [ ] **DELETE /v1/clusters/:id/members/:node_id** — remove succeeds
- [ ] **GET /v1/clusters/:id/health** — returns lifecycle counts, health_ratio
- [ ] **PATCH /v1/clusters/:id** — update name, verify response
- [ ] **PATCH /v1/clusters/:id** with `auto_subtypes` — set, then GET, verify parsed as array (not string)
- [ ] **DELETE /v1/clusters/:id** — cluster deleted, memberships also deleted
- [ ] **DELETE /v1/nodes/:id** — verify cluster_memberships for that node are also deleted
- [ ] **POST /v1/search** with `cluster_ids` — search scoped to cluster members only. Verify nodes NOT in the cluster do not appear
- [ ] **POST /v1/search** without `cluster_ids` — verify existing search behavior unchanged (no performance regression)
- [ ] **`parseAutoSubtypes`** — verify `auto_subtypes` comes back as array in all GET/LIST responses, not a raw JSON string
- [ ] **SSA context** — verify `createSSAContext()` (no options) still works identically to before

### Python (Hynous)

- [ ] **Import succeeds** — `from hynous.intelligence.tools.clusters import handle_manage_clusters` doesn't crash
- [ ] **Registry** — `get_registry()` includes `manage_clusters` in the tool list
- [ ] **manage_clusters list** — calls `client.list_clusters()`, formats correctly
- [ ] **manage_clusters create** — creates cluster, normalizes auto_subtypes (short names → `custom:` prefix)
- [ ] **manage_clusters add** — adds single node and batch of nodes
- [ ] **manage_clusters members** — lists with previews, lifecycle tags, date formatting
- [ ] **manage_clusters health** — shows percentage and counts
- [ ] **store_memory with cluster** — explicit cluster param assigns node to cluster
- [ ] **store_memory auto-assign** — node automatically assigned to clusters matching its subtype
- [ ] **store_memory auto-assign multi-cluster** — node assigned to ALL matching clusters (not just first)
- [ ] **store_memory with no clusters** — no errors, no crash, behaves exactly as before
- [ ] **recall_memory with cluster** — search scoped to cluster members only
- [ ] **recall_memory without cluster** — existing behavior completely unchanged
- [ ] **Queue mode** — store_memory in queue mode includes `cluster` in kwargs, auto-assignment runs during flush
- [ ] **Dedup path** — lesson/curiosity types with dedup: if duplicate found, no cluster assignment (correct — node not created). If unique, cluster assignment runs normally.
- [ ] **`_auto_assign_clusters` thread safety** — runs in daemon thread, doesn't block store response, doesn't crash on empty cluster list or Nous being down
- [ ] **`_normalize_subtypes`** — "thesis" → "custom:thesis", "custom:lesson" → "custom:lesson" (idempotent)

### Integration

- [ ] **End-to-end flow** — create cluster with auto_subtypes → store memory of matching type → verify node auto-assigned → search within cluster → node appears
- [ ] **Multi-cluster membership** — create two clusters with overlapping auto_subtypes → store matching memory → verify node in BOTH clusters
- [ ] **Cluster-scoped search returns nothing for non-members** — store a memory NOT in any cluster → search with cluster filter → verify it does not appear
- [ ] **No regressions** — all existing tools (store_memory, recall_memory, update_memory, delete_memory, explore_memory, manage_conflicts) work exactly as before with no cluster params
