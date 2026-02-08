/**
 * Query Classification Routes — QCS from @nous/core/qcs.
 *
 * Classifies queries to optimize SSA depth:
 * - Simple LOOKUPs with high confidence → smaller SSA limit
 * - Disqualified/AMBIGUOUS queries → larger SSA limit, more spreading
 */

import { Hono } from 'hono';
import { checkDisqualifiers, classifyQueryType } from '@nous/core/qcs';

const classify = new Hono();

/**
 * POST /classify-query — Classify a query for SSA optimization.
 *
 * Returns disqualifier status, query type, confidence, and extracted entity/attribute.
 * This is a lightweight pre-classification — no DB access, no embeddings.
 */
classify.post('/classify-query', async (c) => {
  const body = await c.req.json();
  const { query } = body;

  if (!query || typeof query !== 'string') {
    return c.json({ error: 'query string is required' }, 400);
  }

  // Stage 1: Disqualifier check
  const disqualifier = checkDisqualifiers(query);

  // Stage 2: Query type classification
  const queryType = classifyQueryType(query);

  return c.json({
    query,
    disqualified: disqualifier.disqualified,
    disqualifier_category: disqualifier.category ?? null,
    disqualifier_reason: disqualifier.reason ?? null,
    query_type: queryType.type,
    confidence: queryType.confidence,
    entity: queryType.entity ?? null,
    attribute: queryType.attribute ?? null,
  });
});

export default classify;
