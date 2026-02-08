import { Hono } from 'hono';
import { getDb } from '../db.js';
import { edgeId } from '../utils.js';
import { getDefaultEdgeWeight } from '../core-bridge.js';

const edges = new Hono();

// ---- CREATE ----
edges.post('/edges', async (c) => {
  const body = await c.req.json();
  const { source_id, target_id, type, subtype, neural_weight, strength, confidence } = body;

  if (!source_id || !target_id || !type) {
    return c.json({ error: 'source_id, target_id, and type are required' }, 400);
  }

  const id = edgeId();
  // Use @nous/core SSA_EDGE_WEIGHTS defaults if strength not provided
  const edgeStrength = strength ?? getDefaultEdgeWeight(type);
  const edgeConfidence = confidence ?? 1.0;
  const weight = neural_weight ?? edgeStrength;

  const db = getDb();
  await db.execute({
    sql: `INSERT INTO edges (id, type, subtype, source_id, target_id, neural_weight, strength, confidence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, type, subtype ?? null, source_id, target_id, weight, edgeStrength, edgeConfidence],
  });

  const result = await db.execute({ sql: 'SELECT * FROM edges WHERE id = ?', args: [id] });
  return c.json(result.rows[0], 201);
});

// ---- LIST FOR NODE ----
edges.get('/edges', async (c) => {
  const nodeId = c.req.query('node_id');
  const direction = c.req.query('direction') ?? 'both';

  if (!nodeId) {
    return c.json({ error: 'node_id query parameter is required' }, 400);
  }

  const db = getDb();
  let sql: string;
  let args: string[];

  if (direction === 'out') {
    sql = 'SELECT * FROM edges WHERE source_id = ?';
    args = [nodeId];
  } else if (direction === 'in') {
    sql = 'SELECT * FROM edges WHERE target_id = ?';
    args = [nodeId];
  } else {
    sql = 'SELECT * FROM edges WHERE source_id = ? OR target_id = ?';
    args = [nodeId, nodeId];
  }

  const result = await db.execute({ sql, args });
  return c.json({ data: result.rows, count: result.rows.length });
});

// ---- STRENGTHEN (co-activation) ----
edges.post('/edges/:id/strengthen', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const amount = body.amount ?? 0.05;

  const db = getDb();
  const existing = await db.execute({ sql: 'SELECT * FROM edges WHERE id = ?', args: [id] });
  if (existing.rows.length === 0) return c.json({ error: 'not found' }, 404);

  const currentStrength = Number(existing.rows[0]?.strength ?? 0.5);
  const newStrength = Math.min(1.0, currentStrength + amount);

  await db.execute({
    sql: 'UPDATE edges SET strength = ?, neural_weight = ? WHERE id = ?',
    args: [newStrength, newStrength, id],
  });

  const result = await db.execute({ sql: 'SELECT * FROM edges WHERE id = ?', args: [id] });
  return c.json(result.rows[0]);
});

// ---- DELETE ----
edges.delete('/edges/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  await db.execute({ sql: 'DELETE FROM edges WHERE id = ?', args: [id] });
  return c.json({ ok: true });
});

export default edges;
