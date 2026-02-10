/**
 * Search route — Full SSA (Spreading Activation) pipeline.
 *
 * Uses @nous/core's executeSSA() for:
 * 1. BM25 seeding via FTS5
 * 2. Multi-hop spreading activation through graph edges
 * 3. 6-signal composite reranking (semantic, keyword, graph, recency, authority, affinity)
 *
 * The graph signal (20% of reranking) is now ACTIVE — connected memories surface
 * even when they don't keyword-match the query.
 */

import { Hono } from 'hono';
import { getDb } from '../db.js';
import { now } from '../utils.js';
import { applyDecay, type NodeRow } from '../core-bridge.js';
import { executeSSA } from '@nous/core/ssa';
import { createSSAContext } from '../ssa-context.js';
import { embedQuery } from '../embed.js';
import { checkDisqualifiers, classifyQueryType } from '@nous/core/qcs';

const search = new Hono();

/**
 * Embed function factory for SSA.
 * When embeddings are needed (complex queries), calls OpenAI (~500ms-1s).
 * When not needed (simple lookups), returns empty instantly (~0ms).
 * This is the single biggest latency optimization — most searches skip the API call.
 */
function makeSsaEmbed(useEmbeddings: boolean) {
  return async (queries: string[]): Promise<Float32Array> => {
    if (!useEmbeddings || queries.length === 0) return new Float32Array(0);
    try {
      return await embedQuery(queries[0]!);
    } catch {
      return new Float32Array(0);
    }
  };
}

search.post('/search', async (c) => {
  const body = await c.req.json();
  const { query, type, subtype, lifecycle, limit: rawLimit, time_range, cluster_ids } = body;

  if (!query || typeof query !== 'string') {
    return c.json({ error: 'query string is required' }, 400);
  }

  const limit = Math.min(Number(rawLimit ?? 10), 100);
  const db = getDb();
  const ts = now();

  // QCS pre-classification — gates embedding usage for latency optimization.
  // LOOKUP queries are simple keyword matches ("BTC funding", "my trades") —
  // BM25 handles these in <10ms. AMBIGUOUS and disqualified queries may be
  // conceptual ("crowded positioning risks", "what patterns predict squeezes")
  // and benefit from semantic similarity via embeddings (~1s OpenAI round-trip).
  const qcsDisqualifier = checkDisqualifiers(query);
  const qcsQueryType = classifyQueryType(query);
  const needsEmbedding = qcsQueryType.type !== 'LOOKUP' || qcsDisqualifier.disqualified;
  const ssaMultiplier = needsEmbedding ? 3 : 2;

  try {
    // Execute full SSA pipeline from @nous/core
    const hasClusterFilter = Array.isArray(cluster_ids) && cluster_ids.length > 0;
    const context = createSSAContext(
      hasClusterFilter ? { includeClusterData: true } : undefined,
    );

    const ssaResult = await executeSSA({
      request: {
        query,
        // Over-fetch for post-filtering — QCS adjusts multiplier
        limit: limit * ssaMultiplier,
        // SSA supports type and cluster filtering natively
        filters: (type || hasClusterFilter)
          ? {
              ...(type ? { types: [type] } : {}),
              ...(hasClusterFilter ? { clusters: cluster_ids } : {}),
            }
          : undefined,
      },
      context,
      embed: makeSsaEmbed(needsEmbedding && !!process.env.OPENAI_API_KEY),
      // Seed threshold: permissive to let 6-signal reranking handle quality.
      // Default 0.60 is too aggressive for small corpora — cosine sims for
      // loosely related content are 0.3-0.5, combined rarely hits 0.60.
      // With embeddings: 0.15 (vector alone can seed at ~0.2 cosine sim)
      // Without embeddings: 0.05 (BM25-only maxes at 0.30)
      config: { seed_threshold: process.env.OPENAI_API_KEY ? 0.15 : 0.05 },
    });

    if (ssaResult.relevant_nodes.length === 0) {
      return c.json({ data: [], count: 0, metrics: ssaResult.metrics });
    }

    // Fetch full node data for ranked results
    const rankedIds = ssaResult.relevant_nodes.map((n) => n.node_id);
    const placeholders = rankedIds.map(() => '?').join(',');
    const nodeResult = await db.execute({
      sql: `SELECT * FROM nodes WHERE id IN (${placeholders})`,
      args: rankedIds,
    });

    // Build lookup map
    const nodeMap = new Map(
      nodeResult.rows.map((r) => [r.id as string, r]),
    );

    // Post-filter by subtype and lifecycle (SSA filters don't support these)
    let results = ssaResult.relevant_nodes.filter((ranked) => {
      const row = nodeMap.get(ranked.node_id);
      if (!row) return false;
      if (subtype && row.subtype !== subtype) return false;
      if (lifecycle && row.state_lifecycle !== lifecycle) return false;
      return true;
    });

    // Time-range filter (Phase 2 — temporal model)
    if (time_range && time_range.start && time_range.end) {
      const start = new Date(time_range.start).getTime();
      const end = new Date(time_range.end).getTime();
      const timeType = time_range.type || 'any'; // 'event' | 'ingestion' | 'any'

      results = results.filter((ranked) => {
        const row = nodeMap.get(ranked.node_id) as any;
        if (!row) return false;

        if ((timeType === 'event' || timeType === 'any') && row.temporal_event_time) {
          const t = new Date(row.temporal_event_time).getTime();
          if (t >= start && t <= end) return true;
        }
        if ((timeType === 'ingestion' || timeType === 'any') && row.provenance_created_at) {
          const t = new Date(row.provenance_created_at).getTime();
          if (t >= start && t <= end) return true;
        }
        return timeType === 'any' ? false : false;
      });
    }

    // Trim to requested limit
    results = results.slice(0, limit);

    // Build response: full node data + SSA scores + breakdown
    const data = results.map((ranked) => {
      const row = nodeMap.get(ranked.node_id)!;
      const decayed = applyDecay(row as unknown as NodeRow);
      return {
        ...decayed,
        score: Math.round(ranked.score * 10000) / 10000,
        breakdown: ranked.ranking_reason.score_breakdown,
        primary_signal: ranked.ranking_reason.primary_signal,
      };
    });

    // Bump access count for returned nodes
    for (const item of data) {
      await db.execute({
        sql: 'UPDATE nodes SET neural_access_count = neural_access_count + 1, neural_last_accessed = ? WHERE id = ?',
        args: [ts, item.id],
      });
    }

    return c.json({
      data,
      count: data.length,
      metrics: ssaResult.metrics,
      qcs: {
        query_type: qcsQueryType.type,
        confidence: qcsQueryType.confidence,
        disqualified: qcsDisqualifier.disqualified,
        disqualifier_category: qcsDisqualifier.category ?? null,
        used_embeddings: needsEmbedding,
        ssa_multiplier: ssaMultiplier,
      },
    });
  } catch (e: any) {
    // Fallback to LIKE search on SSA failure
    console.error('[search] SSA failed, falling back to LIKE:', e.message);
    const likeSql = `
      SELECT * FROM nodes
      WHERE (content_title LIKE ? OR content_body LIKE ? OR content_summary LIKE ?)
      ${type ? 'AND type = ?' : ''}
      ${subtype ? 'AND subtype = ?' : ''}
      ${lifecycle ? 'AND state_lifecycle = ?' : ''}
      ORDER BY created_at DESC
      LIMIT ?
    `;
    const likePattern = `%${query}%`;
    const likeArgs: (string | number)[] = [
      likePattern,
      likePattern,
      likePattern,
    ];
    if (type) likeArgs.push(type);
    if (subtype) likeArgs.push(subtype);
    if (lifecycle) likeArgs.push(lifecycle);
    likeArgs.push(limit);

    const fallback = await db.execute({ sql: likeSql, args: likeArgs });
    const data = fallback.rows.map((row) =>
      applyDecay(row as unknown as NodeRow),
    );
    return c.json({ data, count: data.length });
  }
});

export default search;
