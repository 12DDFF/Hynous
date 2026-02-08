import { Hono } from 'hono';
import { getDb } from '../db.js';
import { applyDecay, type NodeRow } from '../core-bridge.js';

const graph = new Hono();

// GET /v1/graph — bulk fetch for visualization
graph.get('/graph', async (c) => {
  const db = getDb();

  // Fetch all nodes (limit 500 for performance)
  const nodeResult = await db.execute({
    sql: `SELECT * FROM nodes ORDER BY provenance_created_at DESC LIMIT 500`,
    args: [],
  });

  // Apply FSRS decay to each node
  const nodes = nodeResult.rows.map((row) => {
    const decayed = applyDecay(row as unknown as NodeRow);
    return {
      id: decayed.id,
      type: decayed.type,
      subtype: decayed.subtype,
      title: decayed.content_title,
      summary: decayed.content_summary,
      retrievability: decayed.neural_retrievability,
      lifecycle: decayed.state_lifecycle,
      access_count: decayed.neural_access_count,
      created_at: decayed.provenance_created_at,
    };
  });

  // Fetch all edges
  const edgeResult = await db.execute({
    sql: `SELECT * FROM edges`,
    args: [],
  });

  const edges = edgeResult.rows.map((row: any) => ({
    id: row.id,
    source: row.source_id,
    target: row.target_id,
    type: row.type,
    strength: row.strength,
  }));

  return c.json({ nodes, edges, count: { nodes: nodes.length, edges: edges.length } });
});

export default graph;
