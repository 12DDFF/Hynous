/**
 * Contradiction Detection Routes — Tiers 1-2 (free, no LLM).
 *
 * Uses @nous/core/contradiction for pattern-based contradiction detection.
 * Maintains a conflict queue for agent review.
 */

import { Hono } from 'hono';
import { getDb } from '../db.js';
import { now } from '../utils.js';
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
 * POST /contradiction/resolve — Resolve a conflict.
 * resolution: 'old_is_current' | 'new_is_current' | 'keep_both' | 'merge'
 */
contradiction.post('/contradiction/resolve', async (c) => {
  const { conflict_id, resolution } = await c.req.json();

  if (!conflict_id || !resolution) {
    return c.json({ error: 'conflict_id and resolution are required' }, 400);
  }

  const db = getDb();
  await db.execute({
    sql: 'UPDATE conflict_queue SET status = ? WHERE id = ?',
    args: ['resolved', conflict_id],
  });

  return c.json({ ok: true, conflict_id, resolution });
});

export default contradiction;
