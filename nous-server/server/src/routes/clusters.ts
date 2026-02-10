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
