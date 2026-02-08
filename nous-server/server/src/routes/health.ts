import { Hono } from 'hono';
import { getDb } from '../db.js';

const health = new Hono();

health.get('/health', async (c) => {
  try {
    const db = getDb();
    const [nodeResult, edgeResult, lifecycleResult] = await Promise.all([
      db.execute('SELECT COUNT(*) as count FROM nodes'),
      db.execute('SELECT COUNT(*) as count FROM edges'),
      db.execute('SELECT state_lifecycle, COUNT(*) as count FROM nodes GROUP BY state_lifecycle'),
    ]);

    const nodeCount = Number(nodeResult.rows[0]?.count ?? 0);
    const edgeCount = Number(edgeResult.rows[0]?.count ?? 0);

    const lifecycle: Record<string, number> = {};
    for (const row of lifecycleResult.rows) {
      lifecycle[row.state_lifecycle as string] = Number(row.count);
    }

    return c.json({
      status: 'ok',
      node_count: nodeCount,
      edge_count: edgeCount,
      lifecycle,
    });
  } catch (e) {
    return c.json({ status: 'error', message: String(e) }, 500);
  }
});

export default health;
