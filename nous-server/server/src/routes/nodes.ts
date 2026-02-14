import { Hono } from 'hono';
import { getDb } from '../db.js';
import { nodeId, now } from '../utils.js';
import {
  getNeuralDefaults,
  applyDecay,
  computeStabilityGrowth,
  type NodeRow,
} from '../core-bridge.js';
import { embedTexts, buildNodeText, buildContextPrefix } from '../embed.js';
import { runTier2Pattern } from '@nous/core/contradiction';
import { nanoid } from 'nanoid';
import {
  cosineSimilarity,
  truncateForComparison,
  DEDUP_CHECK_THRESHOLD,
  SIMILARITY_EDGE_THRESHOLD,
  COMPARISON_DIMS,
} from '@nous/core/embeddings';

const nodes = new Hono();

// ---- CREATE ----
nodes.post('/nodes', async (c) => {
  const body = await c.req.json();
  const {
    type, subtype, content_title, content_summary, content_body,
    temporal_event_time, temporal_event_confidence, temporal_event_source,
  } = body;

  if (!type || !content_title) {
    return c.json({ error: 'type and content_title are required' }, 400);
  }

  const id = nodeId();
  const ts = now();
  const layer = type === 'episode' ? 'episode' : 'semantic';

  // Get FSRS-appropriate neural defaults from @nous/core
  const neural = getNeuralDefaults(type, subtype);

  const db = getDb();
  await db.execute({
    sql: `INSERT INTO nodes
      (id, type, subtype, content_title, content_summary, content_body,
       neural_stability, neural_retrievability, neural_difficulty,
       neural_last_accessed, provenance_created_at, layer, last_modified,
       temporal_event_time, temporal_event_confidence, temporal_event_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, type, subtype ?? null, content_title, content_summary ?? null, content_body ?? null,
      neural.neural_stability, neural.neural_retrievability, neural.neural_difficulty,
      ts, ts, layer, ts,
      temporal_event_time ?? null, temporal_event_confidence ?? null, temporal_event_source ?? null,
    ],
  });

  // Generate embedding — fire-and-forget (don't block node creation response)
  {
    const _id = id;
    const _title = content_title;
    const _summary = content_summary ?? null;
    const _body = content_body ?? null;
    const _type = type;
    const _subtype = subtype ?? null;
    (async () => {
      try {
        const text = buildNodeText(_title, _summary, _body);
        const prefix = buildContextPrefix(_type, _subtype);
        const [embedding] = await embedTexts([prefix + ' ' + text]);
        if (embedding && embedding.length > 0) {
          const buffer = Buffer.from(embedding.buffer);
          await db.execute({
            sql: 'UPDATE nodes SET embedding_vector = ?, embedding_model = ? WHERE id = ?',
            args: [buffer, 'openai-3-small', _id],
          });
        }
      } catch (e: any) {
        console.warn('[embed] Failed to embed node', _id, e.message);
      }
    })();
  }

  // Tier 2 contradiction pattern detection (free, <10ms)
  let contradiction_detected = false;
  try {
    const textToCheck = content_body || content_title;
    const patternResult = runTier2Pattern(textToCheck);
    if (patternResult.triggers_found.length > 0 && patternResult.confidence_score > 0.3) {
      contradiction_detected = true;
      // Search for potentially conflicting nodes
      const searchText = content_title.split(' ').slice(0, 3).join('%');
      const likePattern = `%${searchText}%`;
      const conflictSearch = await db.execute({
        sql: `SELECT id, content_title FROM nodes
              WHERE (content_title LIKE ? OR content_body LIKE ?)
              AND id != ? ORDER BY created_at DESC LIMIT 3`,
        args: [likePattern, likePattern, id],
      });
      // Queue conflicts for agent review
      for (const cRow of conflictSearch.rows) {
        const cid = `c_${nanoid(12)}`;
        const expires = new Date(Date.now() + 14 * 86_400_000).toISOString();
        await db.execute({
          sql: `INSERT INTO conflict_queue
            (id, old_node_id, new_node_id, new_content, conflict_type,
             detection_tier, detection_confidence, status, created_at, expires_at)
            VALUES (?, ?, ?, ?, 'AMBIGUOUS', 'PATTERN', ?, 'pending', ?, ?)`,
          args: [
            cid, cRow.id as string, id, textToCheck,
            patternResult.confidence_score, ts, expires,
          ],
        });
      }
    }
  } catch (e: any) {
    console.warn('[contradiction] Pattern check failed:', e.message);
  }

  // Fetch and return the created node
  const row = await db.execute({ sql: 'SELECT * FROM nodes WHERE id = ?', args: [id] });
  const node = row.rows[0] as any;
  if (contradiction_detected) {
    node._contradiction_detected = true;
  }
  return c.json(node, 201);
});

// ---- GET BY ID (with FSRS decay + stability growth) ----
nodes.get('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();

  const result = await db.execute({ sql: 'SELECT * FROM nodes WHERE id = ?', args: [id] });
  if (result.rows.length === 0) return c.json({ error: 'not found' }, 404);

  const row = result.rows[0] as unknown as NodeRow;

  // Apply FSRS decay to compute current retrievability + lifecycle
  const decayed = applyDecay(row);

  // Strengthen stability on access (recall event)
  const newStability = computeStabilityGrowth(
    row.neural_stability,
    row.neural_difficulty,
  );

  const ts = now();
  // Preserve manually-set DORMANT (e.g., from contradiction resolution).
  // FSRS can transition ACTIVE → WEAK → DORMANT naturally, but cannot
  // promote a DORMANT node back to ACTIVE — use PATCH for explicit reactivation.
  const persistLifecycle = row.state_lifecycle === 'DORMANT'
    ? 'DORMANT'
    : decayed.state_lifecycle;

  // Update neural fields in DB
  await db.execute({
    sql: `UPDATE nodes SET
      neural_access_count = neural_access_count + 1,
      neural_last_accessed = ?,
      neural_stability = ?,
      neural_retrievability = ?,
      state_lifecycle = ?
      WHERE id = ?`,
    args: [ts, newStability, decayed.neural_retrievability, persistLifecycle, id],
  });

  return c.json({
    ...decayed,
    state_lifecycle: persistLifecycle,
    neural_stability: newStability,
    neural_access_count: row.neural_access_count + 1,
    neural_last_accessed: ts,
  });
});

// ---- LIST ----
nodes.get('/nodes', async (c) => {
  const type = c.req.query('type');
  const subtype = c.req.query('subtype');
  const lifecycle = c.req.query('lifecycle');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const created_after = c.req.query('created_after');
  const created_before = c.req.query('created_before');

  let sql = 'SELECT * FROM nodes WHERE 1=1';
  const args: (string | number)[] = [];

  if (type) {
    sql += ' AND type = ?';
    args.push(type);
  }
  if (subtype) {
    sql += ' AND subtype = ?';
    args.push(subtype);
  }
  if (lifecycle) {
    sql += ' AND state_lifecycle = ?';
    args.push(lifecycle);
  }
  if (created_after) {
    sql += ' AND created_at >= ?';
    args.push(created_after);
  }
  if (created_before) {
    sql += ' AND created_at <= ?';
    args.push(created_before);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  args.push(limit);

  const db = getDb();
  const result = await db.execute({ sql, args });

  // Apply decay in-memory for display (no DB write for list — too expensive)
  const data = result.rows.map((row) => applyDecay(row as unknown as NodeRow));
  return c.json({ data, count: data.length });
});

// ---- UPDATE (PATCH) ----
nodes.patch('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const db = getDb();

  // Check node exists
  const existing = await db.execute({ sql: 'SELECT * FROM nodes WHERE id = ?', args: [id] });
  if (existing.rows.length === 0) return c.json({ error: 'not found' }, 404);

  // Build dynamic SET clause from allowed fields
  const allowedFields = [
    'type', 'subtype', 'content_title', 'content_summary', 'content_body',
    'neural_stability', 'neural_retrievability', 'neural_difficulty', 'state_lifecycle',
    'temporal_event_time', 'temporal_event_confidence', 'temporal_event_source',
  ];

  const sets: string[] = [];
  const args: (string | number | null)[] = [];

  for (const field of allowedFields) {
    if (field in body) {
      sets.push(`${field} = ?`);
      args.push(body[field]);
    }
  }

  if (sets.length === 0) return c.json({ error: 'no valid fields to update' }, 400);

  // Always bump version and last_modified
  sets.push('version = version + 1');
  sets.push('last_modified = ?');
  args.push(now());
  args.push(id);

  await db.execute({ sql: `UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`, args });

  const result = await db.execute({ sql: 'SELECT * FROM nodes WHERE id = ?', args: [id] });
  return c.json(result.rows[0]);
});

// ---- DELETE ----
nodes.delete('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  await db.execute({ sql: 'DELETE FROM cluster_memberships WHERE node_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM nodes WHERE id = ?', args: [id] });
  return c.json({ ok: true });
});

// ---- CHECK SIMILAR (dedup pre-check for lesson/curiosity) ----
nodes.post('/nodes/check-similar', async (c) => {
  const body = await c.req.json();
  const { content, title, subtype, limit = 5 } = body;

  if (!content || !title || !subtype) {
    return c.json({ error: 'content, title, and subtype are required' }, 400);
  }

  // Step 1: Build embedding text using the SAME functions used by POST /nodes
  // and POST /nodes/backfill-embeddings — ensures apples-to-apples comparison.
  const text = buildNodeText(title, null, content);
  const prefix = buildContextPrefix('concept', subtype);

  // Step 2: Generate embedding via OpenAI text-embedding-3-small (1536 dims)
  let newEmbedding: Float32Array;
  try {
    const [emb] = await embedTexts([prefix + ' ' + text]);
    if (!emb || emb.length === 0) {
      return c.json({ error: 'embedding generation failed: empty result' }, 500);
    }
    newEmbedding = emb;
  } catch (e: any) {
    return c.json({ error: `embedding generation failed: ${e.message}` }, 500);
  }

  // Step 3: Fetch candidate nodes of the same subtype that have embeddings.
  const db = getDb();
  let candidates: any[];
  try {
    const result = await db.execute({
      sql: `SELECT id, content_title, state_lifecycle, embedding_vector
            FROM nodes
            WHERE subtype = ? AND embedding_vector IS NOT NULL
            ORDER BY provenance_created_at DESC
            LIMIT ?`,
      args: [subtype, limit * 3],
    });
    candidates = result.rows as any[];
  } catch (e: any) {
    return c.json({ error: `similarity search failed: ${e.message}` }, 500);
  }

  // No candidates = unique by definition
  if (candidates.length === 0) {
    return c.json({ matches: [], recommendation: 'unique' });
  }

  // Step 4: Compare new embedding against each candidate using cosine similarity.
  const truncatedNew = truncateForComparison(newEmbedding, COMPARISON_DIMS);

  interface Match {
    node_id: string;
    title: string;
    similarity: number;
    action: 'duplicate' | 'connect';
    lifecycle: string;
  }

  const matches: Match[] = [];

  for (const row of candidates) {
    const blob = row.embedding_vector;
    if (!blob) continue;

    let candidateVec: Float32Array;
    try {
      if (blob instanceof ArrayBuffer) {
        candidateVec = new Float32Array(blob);
      } else if (blob instanceof Uint8Array || Buffer.isBuffer(blob)) {
        const aligned = new Uint8Array(blob).buffer;
        candidateVec = new Float32Array(aligned);
      } else {
        continue;
      }
    } catch {
      continue;
    }

    const truncatedCandidate = truncateForComparison(candidateVec, COMPARISON_DIMS);

    let similarity: number;
    try {
      similarity = cosineSimilarity(truncatedNew, truncatedCandidate);
    } catch {
      continue;
    }

    let action: 'duplicate' | 'connect' | 'none';
    if (similarity >= DEDUP_CHECK_THRESHOLD) {
      action = 'duplicate';
    } else if (similarity >= SIMILARITY_EDGE_THRESHOLD) {
      action = 'connect';
    } else {
      action = 'none';
    }

    if (action !== 'none') {
      matches.push({
        node_id: row.id as string,
        title: (row.content_title as string) ?? 'Untitled',
        similarity: Math.round(similarity * 10000) / 10000,
        action,
        lifecycle: (row.state_lifecycle as string) ?? 'ACTIVE',
      });
    }
  }

  // Step 5: Sort by similarity descending, take top `limit`
  matches.sort((a, b) => b.similarity - a.similarity);
  const topMatches = matches.slice(0, limit);

  // Step 6: Determine recommendation
  let recommendation: 'duplicate_found' | 'similar_found' | 'unique';
  if (topMatches.some((m) => m.action === 'duplicate')) {
    recommendation = 'duplicate_found';
  } else if (topMatches.length > 0) {
    recommendation = 'similar_found';
  } else {
    recommendation = 'unique';
  }

  return c.json({ matches: topMatches, recommendation });
});

// ---- BACKFILL EMBEDDINGS ----
nodes.post('/nodes/backfill-embeddings', async (c) => {
  const db = getDb();
  const result = await db.execute(
    'SELECT id, type, subtype, content_title, content_summary, content_body FROM nodes WHERE embedding_vector IS NULL',
  );

  if (result.rows.length === 0) {
    return c.json({ ok: true, embedded: 0, total: 0 });
  }

  // Build texts for batch embedding
  const texts = result.rows.map((row: any) => {
    const text = buildNodeText(row.content_title, row.content_summary, row.content_body);
    const prefix = buildContextPrefix(row.type, row.subtype);
    return prefix + ' ' + text;
  });

  const embeddings = await embedTexts(texts);

  let embedded = 0;
  for (let i = 0; i < result.rows.length; i++) {
    const emb = embeddings[i];
    if (emb && emb.length > 0) {
      const buffer = Buffer.from(emb.buffer);
      await db.execute({
        sql: 'UPDATE nodes SET embedding_vector = ?, embedding_model = ? WHERE id = ?',
        args: [buffer, 'openai-3-small', result.rows[i]!.id],
      });
      embedded++;
    }
  }

  return c.json({ ok: true, embedded, total: result.rows.length });
});

export default nodes;
