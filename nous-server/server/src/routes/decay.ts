import { Hono } from 'hono';
import { getDb } from '../db.js';
import { computeDecay, type NodeRow } from '../core-bridge.js';

const decay = new Hono();

/**
 * POST /v1/decay — Run a decay cycle across all active nodes.
 *
 * For each node, recomputes retrievability based on FSRS formula and
 * transitions lifecycle state (ACTIVE → WEAK → DORMANT → etc.).
 * Updates DB via a single batch transaction. Returns stats.
 *
 * Called by the daemon every 6 hours.
 *
 * Performance note: previously used individual await db.execute() per node
 * (N+1 queries). With thousands of nodes this caused 60+ second response
 * times, blocking the Python daemon loop. Now uses db.batch() to send all
 * UPDATEs in one transaction, reducing time to <1s regardless of node count.
 */
decay.post('/decay', async (c) => {
  const db = getDb();

  // Fetch all non-archived nodes
  const result = await db.execute(
    "SELECT * FROM nodes WHERE state_lifecycle NOT IN ('ARCHIVE', 'DELETED')"
  );

  let processed = 0;
  const transitions: { id: string; from: string; to: string; subtype: string }[] = [];

  // Accumulate all UPDATE statements — send as one batch transaction
  const updates: { sql: string; args: (string | number)[] }[] = [];

  for (const row of result.rows) {
    const nodeRow = row as unknown as NodeRow;
    const { retrievability, lifecycle_state } = computeDecay(nodeRow);
    const currentLifecycle = nodeRow.state_lifecycle;

    // Only update if something meaningfully changed
    if (
      Math.abs(retrievability - nodeRow.neural_retrievability) > 0.001 ||
      lifecycle_state !== currentLifecycle
    ) {
      updates.push({
        sql: 'UPDATE nodes SET neural_retrievability = ?, state_lifecycle = ? WHERE id = ?',
        args: [Math.round(retrievability * 10000) / 10000, lifecycle_state, nodeRow.id],
      });

      if (lifecycle_state !== currentLifecycle) {
        transitions.push({
          id: nodeRow.id,
          from: currentLifecycle,
          to: lifecycle_state,
          subtype: nodeRow.subtype ?? 'unknown',
        });
      }
    }

    processed++;
  }

  // Execute all updates in a single batch transaction
  if (updates.length > 0) {
    await db.batch(updates);
  }

  return c.json({
    ok: true,
    processed,
    transitions_count: transitions.length,
    transitions,
  });
});

export default decay;
