import { Hono } from 'hono';
import { getDb } from '../db.js';
import { computeDecay, type NodeRow } from '../core-bridge.js';

const decay = new Hono();

/**
 * POST /v1/decay — Run a decay cycle across all active nodes.
 *
 * For each node, recomputes retrievability based on FSRS formula and
 * transitions lifecycle state (ACTIVE → WEAK → DORMANT → etc.).
 * Updates DB in batch. Returns stats.
 *
 * Intended for the future daemon to call periodically.
 */
decay.post('/decay', async (c) => {
  const db = getDb();

  // Fetch all non-archived nodes
  const result = await db.execute(
    "SELECT * FROM nodes WHERE state_lifecycle NOT IN ('ARCHIVE', 'DELETED')"
  );

  let processed = 0;
  const transitions: { id: string; from: string; to: string }[] = [];

  for (const row of result.rows) {
    const nodeRow = row as unknown as NodeRow;
    const { retrievability, lifecycle_state } = computeDecay(nodeRow);
    const currentLifecycle = nodeRow.state_lifecycle;

    // Only update if something changed
    if (
      Math.abs(retrievability - nodeRow.neural_retrievability) > 0.001 ||
      lifecycle_state !== currentLifecycle
    ) {
      await db.execute({
        sql: 'UPDATE nodes SET neural_retrievability = ?, state_lifecycle = ? WHERE id = ?',
        args: [Math.round(retrievability * 10000) / 10000, lifecycle_state, nodeRow.id],
      });

      if (lifecycle_state !== currentLifecycle) {
        transitions.push({
          id: nodeRow.id,
          from: currentLifecycle,
          to: lifecycle_state,
        });
      }
    }

    processed++;
  }

  return c.json({
    ok: true,
    processed,
    transitions_count: transitions.length,
    transitions,
  });
});

export default decay;
