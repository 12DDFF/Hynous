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

  // Fetch clusters + memberships for visualization
  const clusterResult = await db.execute({
    sql: `SELECT id, name, description, icon, pinned FROM clusters ORDER BY pinned DESC, created_at DESC`,
    args: [],
  });

  const clusters = clusterResult.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    icon: row.icon,
    pinned: !!row.pinned,
  }));

  const membershipResult = await db.execute({
    sql: `SELECT cluster_id, node_id, weight FROM cluster_memberships`,
    args: [],
  });

  // Filter memberships to only nodes present in the graph
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const memberships = membershipResult.rows
    .map((row: any) => ({
      cluster_id: row.cluster_id,
      node_id: row.node_id,
      weight: row.weight,
    }))
    .filter((m) => nodeIdSet.has(m.node_id));

  return c.json({ nodes, edges, clusters, memberships, count: { nodes: nodes.length, edges: edges.length } });
});

export default graph;
