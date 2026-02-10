/**
 * Contradiction Detection Routes — Tiers 1-2 (free, no LLM).
 *
 * Uses @nous/core/contradiction for pattern-based contradiction detection.
 * Maintains a conflict queue for agent review.
 */

import { Hono } from 'hono';
import { getDb } from '../db.js';
import { now, edgeId } from '../utils.js';
import { nanoid } from 'nanoid';
import { runTier2Pattern, generateConflictId } from '@nous/core/contradiction';

const contradiction = new Hono();

/**
 * POST /contradiction/detect — Run tier 1-2 pattern detection on content.
 *
 * Checks for correction markers ("actually", "I was wrong", "update:", etc.)
 * Returns whether a contradiction pattern was detected and its confidence.
 */
contradiction.post('/contradiction/detect', async (c) => {
  const body = await c.req.json();
  const { content, title, node_id } = body;

  if (!content || typeof content !== 'string') {
    return c.json({ error: 'content string is required' }, 400);
  }

  // Run Tier 2 pattern detection (free, <10ms)
  const patternResult = runTier2Pattern(content);
  const detected = patternResult.triggers_found.length > 0 && patternResult.confidence_score > 0.3;

  // If pattern triggers found, search for potentially conflicting nodes
  let conflicting_nodes: any[] = [];
  if (detected) {
    const db = getDb();
    const searchText = title || content.substring(0, 80);
    const likePattern = `%${searchText.split(' ').slice(0, 3).join('%')}%`;

    try {
      const result = await db.execute({
        sql: `SELECT id, content_title, subtype FROM nodes
              WHERE (content_title LIKE ? OR content_body LIKE ?)
              ${node_id ? 'AND id != ?' : ''}
              ORDER BY created_at DESC LIMIT 5`,
        args: node_id
          ? [likePattern, likePattern, node_id]
          : [likePattern, likePattern],
      });
      conflicting_nodes = result.rows.map((r: any) => ({
        id: r.id,
        title: r.content_title,
        subtype: r.subtype,
      }));
    } catch {
      // Search failure is non-critical
    }
  }

  return c.json({
    conflict_detected: detected,
    tier: 'PATTERN',
    confidence: patternResult.confidence_score,
    triggers: patternResult.triggers_found,
    disqualifiers: patternResult.disqualifiers_found,
    temporal_signal: patternResult.temporal_signal,
    conflicting_nodes,
  });
});

/**
 * GET /contradiction/queue — List conflict queue items.
 */
contradiction.get('/contradiction/queue', async (c) => {
  const status = c.req.query('status') || 'pending';
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM conflict_queue WHERE status = ? ORDER BY created_at ASC',
    args: [status],
  });
  return c.json({ data: result.rows, count: result.rows.length });
});

/**
 * POST /contradiction/queue — Add a conflict to the queue.
 */
contradiction.post('/contradiction/queue', async (c) => {
  const body = await c.req.json();
  const {
    old_node_id, new_node_id, new_content, conflict_type,
    detection_tier, detection_confidence, context, entity_name, topic,
  } = body;

  if (!old_node_id || !new_content) {
    return c.json({ error: 'old_node_id and new_content are required' }, 400);
  }

  const id = `c_${nanoid(12)}`;
  const ts = now();
  // Auto-expire in 14 days
  const expires = new Date(Date.now() + 14 * 86_400_000).toISOString();

  const db = getDb();
  await db.execute({
    sql: `INSERT INTO conflict_queue
      (id, old_node_id, new_node_id, new_content, conflict_type,
       detection_tier, detection_confidence, context, entity_name, topic,
       status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    args: [
      id, old_node_id, new_node_id ?? null, new_content,
      conflict_type ?? 'AMBIGUOUS', detection_tier ?? 'PATTERN',
      detection_confidence ?? 0, context ?? null,
      entity_name ?? null, topic ?? null, ts, expires,
    ],
  });

  return c.json({ id, status: 'pending', expires_at: expires }, 201);
});

/**
 * Execute a single conflict resolution — shared logic for single and batch routes.
 */
const validResolutions = ['old_is_current', 'new_is_current', 'keep_both', 'merge'];

async function executeResolution(
  db: any,
  conflict_id: string,
  resolution: string,
  merged_content?: string,
): Promise<{ ok: boolean; conflict_id: string; resolution: string; old_node_id: string; new_node_id: string | null; actions: string[]; resolved_at: string; error?: string }> {
  if (!validResolutions.includes(resolution)) {
    return { ok: false, conflict_id, resolution, old_node_id: '', new_node_id: null, actions: [], resolved_at: '', error: `Invalid resolution: ${resolution}` };
  }

  const ts = now();

  const conflictResult = await db.execute({
    sql: 'SELECT * FROM conflict_queue WHERE id = ?',
    args: [conflict_id],
  });

  if (conflictResult.rows.length === 0) {
    return { ok: false, conflict_id, resolution, old_node_id: '', new_node_id: null, actions: [], resolved_at: '', error: `Conflict ${conflict_id} not found` };
  }

  const conflict = conflictResult.rows[0] as any;
  const oldNodeId: string = conflict.old_node_id;
  const newNodeId: string | null = conflict.new_node_id ?? null;
  const actions: string[] = [];

  try {
    if (resolution === 'new_is_current') {
      await db.execute({
        sql: `UPDATE nodes SET state_lifecycle = 'DORMANT', last_modified = ?, version = version + 1 WHERE id = ?`,
        args: [ts, oldNodeId],
      });
      actions.push(`Old node ${oldNodeId} → DORMANT`);

      if (newNodeId) {
        const eid = edgeId();
        await db.execute({
          sql: `INSERT INTO edges (id, type, source_id, target_id, neural_weight, strength, confidence, created_at)
                VALUES (?, 'supersedes', ?, ?, 0.5, 0.5, 1.0, ?)`,
          args: [eid, newNodeId, oldNodeId, ts],
        });
        actions.push(`Edge ${eid}: ${newNodeId} supersedes ${oldNodeId}`);
      }
    } else if (resolution === 'old_is_current') {
      if (newNodeId) {
        await db.execute({
          sql: `UPDATE nodes SET state_lifecycle = 'DORMANT', last_modified = ?, version = version + 1 WHERE id = ?`,
          args: [ts, newNodeId],
        });
        actions.push(`New node ${newNodeId} → DORMANT`);

        const eid = edgeId();
        await db.execute({
          sql: `INSERT INTO edges (id, type, source_id, target_id, neural_weight, strength, confidence, created_at)
                VALUES (?, 'supersedes', ?, ?, 0.5, 0.5, 1.0, ?)`,
          args: [eid, oldNodeId, newNodeId, ts],
        });
        actions.push(`Edge ${eid}: ${oldNodeId} supersedes ${newNodeId}`);
      } else {
        actions.push(`Old node ${oldNodeId} confirmed current (no new node to deprecate)`);
      }
    } else if (resolution === 'keep_both') {
      if (newNodeId) {
        const eid = edgeId();
        await db.execute({
          sql: `INSERT INTO edges (id, type, source_id, target_id, neural_weight, strength, confidence, created_at)
                VALUES (?, 'relates_to', ?, ?, 0.5, 0.5, 1.0, ?)`,
          args: [eid, oldNodeId, newNodeId, ts],
        });
        actions.push(`Edge ${eid}: ${oldNodeId} relates_to ${newNodeId}`);
      } else {
        actions.push('Both kept (no new node to link)');
      }
    } else if (resolution === 'merge') {
      const oldNodeResult = await db.execute({
        sql: 'SELECT content_body FROM nodes WHERE id = ?',
        args: [oldNodeId],
      });

      if (oldNodeResult.rows.length > 0) {
        const oldBody = (oldNodeResult.rows[0] as any).content_body || '';
        const appendContent = merged_content || conflict.new_content || '';
        const separator = '\n\n--- Merged (' + ts.substring(0, 10) + ') ---\n\n';
        const newBody = oldBody + separator + appendContent;

        await db.execute({
          sql: `UPDATE nodes SET content_body = ?, last_modified = ?, version = version + 1 WHERE id = ?`,
          args: [newBody, ts, oldNodeId],
        });
        actions.push(`Merged content into old node ${oldNodeId}`);
      }

      if (newNodeId) {
        await db.execute({
          sql: 'DELETE FROM nodes WHERE id = ?',
          args: [newNodeId],
        });
        actions.push(`Deleted new node ${newNodeId} (merged into ${oldNodeId})`);
      }
    }
  } catch (e: any) {
    return { ok: false, conflict_id, resolution, old_node_id: oldNodeId, new_node_id: newNodeId, actions, resolved_at: '', error: `Resolution failed: ${e.message}` };
  }

  await db.execute({
    sql: `UPDATE conflict_queue SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?`,
    args: [resolution, ts, conflict_id],
  });

  return { ok: true, conflict_id, resolution, old_node_id: oldNodeId, new_node_id: newNodeId, actions, resolved_at: ts };
}

/**
 * POST /contradiction/resolve — Resolve a single conflict.
 */
contradiction.post('/contradiction/resolve', async (c) => {
  const body = await c.req.json();
  const { conflict_id, resolution, merged_content } = body;

  if (!conflict_id || !resolution) {
    return c.json({ error: 'conflict_id and resolution are required' }, 400);
  }

  const db = getDb();
  const result = await executeResolution(db, conflict_id, resolution, merged_content);

  if (!result.ok) {
    const status = result.error?.includes('not found') ? 404 : 500;
    return c.json(result, status);
  }

  return c.json(result);
});

/**
 * POST /contradiction/batch-resolve — Resolve multiple conflicts in one call.
 *
 * Body: { items: [{ conflict_id, resolution, merged_content? }, ...] }
 * Max 50 items per batch.
 */
contradiction.post('/contradiction/batch-resolve', async (c) => {
  const body = await c.req.json();
  const { items } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'items array is required (each: {conflict_id, resolution})' }, 400);
  }

  if (items.length > 50) {
    return c.json({ error: 'Maximum 50 items per batch' }, 400);
  }

  const db = getDb();
  const results: any[] = [];
  let resolved = 0;
  let failed = 0;

  for (const item of items) {
    const { conflict_id, resolution, merged_content } = item;
    if (!conflict_id || !resolution) {
      results.push({ conflict_id: conflict_id ?? '?', ok: false, error: 'missing conflict_id or resolution' });
      failed++;
      continue;
    }
    try {
      const result = await executeResolution(db, conflict_id, resolution, merged_content);
      results.push(result);
      if (result.ok) resolved++;
      else failed++;
    } catch (e: any) {
      results.push({ conflict_id, ok: false, error: e.message });
      failed++;
    }
  }

  return c.json({ ok: true, resolved, failed, total: items.length, results });
});

export default contradiction;
