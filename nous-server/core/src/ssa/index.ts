/**
 * @module @nous/core/ssa
 * @description Seeded Spreading Activation retrieval algorithm
 * @version 1.0.0
 * @spec Brainstorms/Specs/Phase-3-Retrieval-Core/storm-005
 * @storm Brainstorms/Infrastructure/storm-005-retrieval-algorithm
 *
 * This module implements storm-005: SSA Retrieval Algorithm.
 *
 * Algorithm flow:
 * 0. Parse filters → 1. Embed queries → 2. Hybrid seeding →
 * 3. Spreading activation → 4. Reranking → 5. Build result
 *
 * Key integrations:
 * - storm-016: Embedding thresholds (SSA_SEED_THRESHOLD, DENSE_WEIGHT, BM25_WEIGHT)
 * - storm-028: SSA_PARAMS, SSA_EDGE_WEIGHTS, rerankCandidates()
 */

import { z } from 'zod';
import {
  SSA_PARAMS,
  SSA_EDGE_WEIGHTS,
  rerankCandidates,
  rerankWithSectionWeights,
  type ScoredNode,
  type RankedNode,
  type GraphMetrics,
  type ScoreBreakdown,
} from '../params';
import {
  SSA_SEED_THRESHOLD,
  DENSE_WEIGHT,
  BM25_WEIGHT,
} from '../embeddings';

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Serendipity levels for unexpected connection discovery.
 */
export const SERENDIPITY_LEVELS = ['off', 'low', 'medium', 'high'] as const;
export type SerendipityLevel = (typeof SERENDIPITY_LEVELS)[number];

/**
 * Query combination strategies for multi-query.
 */
export const QUERY_COMBINATION_STRATEGIES = ['average', 'max_pooling'] as const;
export type QueryCombinationStrategy = (typeof QUERY_COMBINATION_STRATEGIES)[number];

/**
 * Serendipity thresholds per level.
 */
export const SERENDIPITY_THRESHOLDS: Record<SerendipityLevel, { minGraph: number; maxSim: number; count: number }> = {
  off: { minGraph: 1.0, maxSim: 0.0, count: 0 },
  low: { minGraph: 0.4, maxSim: 0.5, count: 2 },
  medium: { minGraph: 0.3, maxSim: 0.5, count: 5 },
  high: { minGraph: 0.2, maxSim: 0.5, count: 10 },
};

// ============================================================
// FILTER INTERFACES
// ============================================================

/**
 * Date range filter.
 */
export interface DateRangeFilter {
  after?: string;
  before?: string;
}

export const DateRangeFilterSchema = z.object({
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
}).refine(
  (data) => {
    if (data.after && data.before) {
      return new Date(data.after) <= new Date(data.before);
    }
    return true;
  },
  { message: 'after must be before or equal to before' }
);

/**
 * Last accessed filter.
 */
export interface LastAccessedFilter {
  within_days: number;
}

export const LastAccessedFilterSchema = z.object({
  within_days: z.number().int().positive(),
});

/**
 * Search filters for SSA.
 */
export interface SSASearchFilters {
  date_range?: DateRangeFilter;
  last_accessed?: LastAccessedFilter;
  types?: string[];
  exclude_types?: string[];
  clusters?: string[];
  tags?: string[];
  tags_any?: string[];
  exclude_tags?: string[];
  relationships?: string[];
  connected_to?: string;
  within_hops?: number;
}

export const SSASearchFiltersSchema = z.object({
  date_range: DateRangeFilterSchema.optional(),
  last_accessed: LastAccessedFilterSchema.optional(),
  types: z.array(z.string().max(100)).max(50).optional(),
  exclude_types: z.array(z.string().max(100)).max(50).optional(),
  clusters: z.array(z.string().min(1).max(100)).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
  tags_any: z.array(z.string().min(1).max(50)).optional(),
  exclude_tags: z.array(z.string().min(1).max(50)).optional(),
  relationships: z.array(z.string().max(100)).max(30).optional(),
  connected_to: z.string().min(1).max(100).optional(),
  within_hops: z.number().int().min(1).max(10).optional(),
});

// ============================================================
// REQUEST/RESPONSE INTERFACES
// ============================================================

/**
 * Search request for SSA.
 */
export interface SearchRequest {
  query?: string;
  queries?: string[];
  filters?: SSASearchFilters;
  serendipity_level?: SerendipityLevel;
  query_combination?: QueryCombinationStrategy;
  limit?: number;
  include_connections?: boolean;
}

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(2000).optional(),
  queries: z.array(z.string().min(1).max(2000)).max(10).optional(),
  filters: SSASearchFiltersSchema.optional(),
  serendipity_level: z.enum(SERENDIPITY_LEVELS).optional(),
  query_combination: z.enum(QUERY_COMBINATION_STRATEGIES).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  include_connections: z.boolean().optional(),
}).refine(
  (data) => data.query !== undefined || (data.queries !== undefined && data.queries.length > 0),
  { message: 'Either query or queries must be provided' }
);

/**
 * Score breakdown for a ranked node.
 */
export interface SSAScoreBreakdown {
  semantic: number;
  keyword: number;
  graph: number;
  recency: number;
  authority: number;
  affinity: number;
}

export const SSAScoreBreakdownSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1),
});

/**
 * Ranking reason explaining why a node was ranked.
 */
export interface RankingReason {
  primary_signal: keyof SSAScoreBreakdown;
  explanation: string;
  score_breakdown: SSAScoreBreakdown;
}

export const RankingReasonSchema = z.object({
  primary_signal: z.enum(['semantic', 'keyword', 'graph', 'recency', 'authority', 'affinity']),
  explanation: z.string(),
  score_breakdown: SSAScoreBreakdownSchema,
});

/**
 * Ranked node in search results.
 */
export interface SSARankedNode {
  node_id: string;
  score: number;
  ranking_reason: RankingReason;
}

export const SSARankedNodeSchema = z.object({
  node_id: z.string(),
  score: z.number().min(0).max(1),
  ranking_reason: RankingReasonSchema,
});

/**
 * Connection between two nodes.
 */
export interface NodeConnection {
  source_id: string;
  target_id: string;
  edge_type: string;
  weight: number;
}

export const NodeConnectionSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  edge_type: z.string(),
  weight: z.number().min(0).max(1),
});

/**
 * Map of connections between activated nodes.
 */
export interface ConnectionMap {
  connections: NodeConnection[];
  node_count: number;
  edge_count: number;
}

export const ConnectionMapSchema = z.object({
  connections: z.array(NodeConnectionSchema),
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
});

/**
 * Serendipity candidate - unexpected but connected node.
 */
export interface SerendipityCandidate {
  node_id: string;
  semantic_score: number;
  graph_score: number;
  connection_path: string[];
  explanation: string;
}

export const SerendipityCandidateSchema = z.object({
  node_id: z.string(),
  semantic_score: z.number().min(0).max(1),
  graph_score: z.number().min(0).max(1),
  connection_path: z.array(z.string()),
  explanation: z.string(),
});

/**
 * Execution metrics for performance tracking.
 */
export interface ExecutionMetrics {
  total_ms: number;
  parse_filters_ms: number;
  embed_queries_ms: number;
  hybrid_seeding_ms: number;
  spreading_ms: number;
  reranking_ms: number;
  seeds_found: number;
  nodes_activated: number;
  nodes_filtered: number;
  nodes_returned: number;
}

export const ExecutionMetricsSchema = z.object({
  total_ms: z.number().nonnegative(),
  parse_filters_ms: z.number().nonnegative(),
  embed_queries_ms: z.number().nonnegative(),
  hybrid_seeding_ms: z.number().nonnegative(),
  spreading_ms: z.number().nonnegative(),
  reranking_ms: z.number().nonnegative(),
  seeds_found: z.number().int().nonnegative(),
  nodes_activated: z.number().int().nonnegative(),
  nodes_filtered: z.number().int().nonnegative(),
  nodes_returned: z.number().int().nonnegative(),
});

/**
 * Search response from SSA.
 */
export interface SearchResponse {
  results: SSARankedNode[];
  filters_applied: SSASearchFilters;
  total_candidates: number;
  execution_time_ms: number;
  metrics: ExecutionMetrics;
}

export const SearchResponseSchema = z.object({
  results: z.array(SSARankedNodeSchema),
  filters_applied: SSASearchFiltersSchema,
  total_candidates: z.number().int().nonnegative(),
  execution_time_ms: z.number().nonnegative(),
  metrics: ExecutionMetricsSchema,
});

// ============================================================
// SSA RESULT (Phase 2 Handoff)
// ============================================================

/**
 * Complete SSA result for Phase 2 handoff.
 */
export interface SSAResult {
  original_queries: string[];
  filters_applied: SSASearchFilters;
  relevant_nodes: SSARankedNode[];
  connection_map?: ConnectionMap;
  ranking_reasons: Record<string, RankingReason>;
  serendipity_candidates?: SerendipityCandidate[];
  metrics: ExecutionMetrics;
}

export const SSAResultSchema = z.object({
  original_queries: z.array(z.string()),
  filters_applied: SSASearchFiltersSchema,
  relevant_nodes: z.array(SSARankedNodeSchema),
  connection_map: ConnectionMapSchema.optional(),
  ranking_reasons: z.record(z.string(), RankingReasonSchema),
  serendipity_candidates: z.array(SerendipityCandidateSchema).optional(),
  metrics: ExecutionMetricsSchema,
});

// ============================================================
// ALGORITHM CONFIGURATION
// ============================================================

/**
 * SSA algorithm configuration.
 */
export interface SSAConfig {
  seed_threshold: number;
  dense_weight: number;
  bm25_weight: number;
  max_seeds: number;
  initial_activation: number;
  hop_decay: number;
  min_threshold: number;
  max_hops: number;
  max_nodes: number;
  aggregation: 'sum' | 'max';
  query_combination: QueryCombinationStrategy;
  default_limit: number;
}

export const SSAConfigSchema = z.object({
  seed_threshold: z.number().min(0).max(1),
  dense_weight: z.number().min(0).max(1),
  bm25_weight: z.number().min(0).max(1),
  max_seeds: z.number().int().positive(),
  initial_activation: z.number().min(0).max(1),
  hop_decay: z.number().min(0).max(1),
  min_threshold: z.number().min(0).max(1),
  max_hops: z.number().int().positive(),
  max_nodes: z.number().int().positive(),
  aggregation: z.enum(['sum', 'max']),
  query_combination: z.enum(QUERY_COMBINATION_STRATEGIES),
  default_limit: z.number().int().positive(),
});

/**
 * Default SSA configuration using storm-016 and storm-028 values.
 */
export const DEFAULT_SSA_CONFIG: SSAConfig = {
  seed_threshold: SSA_SEED_THRESHOLD,
  dense_weight: DENSE_WEIGHT,
  bm25_weight: BM25_WEIGHT,
  max_seeds: 15,
  initial_activation: SSA_PARAMS.initial_activation,
  hop_decay: SSA_PARAMS.hop_decay,
  min_threshold: SSA_PARAMS.min_threshold,
  max_hops: SSA_PARAMS.max_hops,
  max_nodes: SSA_PARAMS.max_nodes,
  aggregation: SSA_PARAMS.aggregation,
  query_combination: 'average',
  default_limit: 30,
};

// ============================================================
// INTERNAL ALGORITHM TYPES
// ============================================================

/**
 * Seed node from hybrid seeding.
 */
export interface SeedNode {
  node_id: string;
  vector_score: number;
  bm25_score: number;
  combined_score: number;
}

export const SeedNodeSchema = z.object({
  node_id: z.string(),
  vector_score: z.number().min(0).max(1),
  bm25_score: z.number().nonnegative(),
  combined_score: z.number().min(0).max(1),
});

/**
 * Result of hybrid seeding phase.
 */
export interface SeedingResult {
  seeds: SeedNode[];
  vector_candidates: number;
  bm25_candidates: number;
  combined_candidates: number;
  execution_ms: number;
}

export const SeedingResultSchema = z.object({
  seeds: z.array(SeedNodeSchema),
  vector_candidates: z.number().int().nonnegative(),
  bm25_candidates: z.number().int().nonnegative(),
  combined_candidates: z.number().int().nonnegative(),
  execution_ms: z.number().nonnegative(),
});

/**
 * Activated node during spreading.
 */
export interface SSAActivatedNode {
  node_id: string;
  activation: number;
  hop_distance: number;
  activation_path: string[];
  is_seed: boolean;
  vector_score: number;
  bm25_score: number;
}

export const SSAActivatedNodeSchema = z.object({
  node_id: z.string(),
  activation: z.number().min(0),
  hop_distance: z.number().int().nonnegative(),
  activation_path: z.array(z.string()),
  is_seed: z.boolean(),
  vector_score: z.number().min(0).max(1),
  bm25_score: z.number().nonnegative(),
});

/**
 * Result of spreading activation phase.
 */
export interface SpreadingResult {
  activated: SSAActivatedNode[];
  hops_completed: number;
  nodes_visited: number;
  edges_traversed: number;
  terminated_reason: 'max_hops' | 'max_nodes' | 'no_spread' | 'threshold';
  execution_ms: number;
}

export const SpreadingResultSchema = z.object({
  activated: z.array(SSAActivatedNodeSchema),
  hops_completed: z.number().int().nonnegative(),
  nodes_visited: z.number().int().nonnegative(),
  edges_traversed: z.number().int().nonnegative(),
  terminated_reason: z.enum(['max_hops', 'max_nodes', 'no_spread', 'threshold']),
  execution_ms: z.number().nonnegative(),
});

/**
 * Minimal node info for filter evaluation.
 */
export interface FilterNodeInput {
  id: string;
  type: string;
  created_at: string;
  last_accessed: string;
  clusters?: string[];
  tags?: string[];
}

export const FilterNodeInputSchema = z.object({
  id: z.string(),
  type: z.string(),
  created_at: z.string().datetime(),
  last_accessed: z.string().datetime(),
  clusters: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * Minimal edge info for filter evaluation.
 */
export interface FilterEdgeInput {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
}

export const FilterEdgeInputSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  target_id: z.string(),
  edge_type: z.string(),
});

/**
 * Filter predicate result.
 */
export interface FilterPredicate {
  filters: SSASearchFilters;
  evaluateNode: (node: FilterNodeInput) => boolean;
  evaluateEdge: (edge: FilterEdgeInput) => boolean;
}

// ============================================================
// GRAPH CONTEXT INTERFACE
// ============================================================

/**
 * Node data for reranking.
 */
export interface RerankingNodeData {
  id: string;
  last_accessed: Date;
  created_at: Date;
  access_count: number;
  inbound_edge_count: number;
  subtype?: string;  // e.g. 'custom:lesson' — for per-section reranking (Issue 1)
}

/**
 * Neighbor result from graph query.
 */
export interface NeighborResult {
  node: FilterNodeInput;
  edge: FilterEdgeInput;
  weight: number;
}

/**
 * Vector search result.
 */
export interface SSAVectorSearchResult {
  nodeId: string;
  score: number;
}

/**
 * BM25 search result.
 */
export interface BM25SearchResult {
  nodeId: string;
  score: number;
}

/**
 * Graph context for SSA execution.
 */
export interface SSAGraphContext {
  getNode: (id: string) => Promise<FilterNodeInput | null>;
  getNeighbors: (nodeId: string) => Promise<NeighborResult[]>;
  vectorSearch: (embedding: Float32Array, limit: number) => Promise<SSAVectorSearchResult[]>;
  bm25Search: (terms: string[], limit: number) => Promise<BM25SearchResult[]>;
  getGraphMetrics: () => Promise<GraphMetrics>;
  getNodeForReranking: (id: string) => Promise<RerankingNodeData | null>;
}

/**
 * Embed function for query embedding.
 */
export type EmbedFunction = (queries: string[]) => Promise<Float32Array>;

/**
 * Options for executeSSA.
 */
export interface ExecuteSSAOptions {
  request: SearchRequest;
  context: SSAGraphContext;
  embed: EmbedFunction;
  config?: Partial<SSAConfig>;
}

// ============================================================
// FILTER FUNCTIONS
// ============================================================

/**
 * Build filter predicate from search filters.
 */
export function buildFilterPredicate(filters: SSASearchFilters): FilterPredicate {
  const now = new Date();

  const evaluateNode = (node: FilterNodeInput): boolean => {
    // Date range filter
    if (filters.date_range) {
      const created = new Date(node.created_at);
      if (filters.date_range.after && created < new Date(filters.date_range.after)) {
        return false;
      }
      if (filters.date_range.before && created > new Date(filters.date_range.before)) {
        return false;
      }
    }

    // Last accessed filter
    if (filters.last_accessed) {
      const lastAccessed = new Date(node.last_accessed);
      const daysAgo = (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
      if (daysAgo > filters.last_accessed.within_days) {
        return false;
      }
    }

    // Type filter
    if (filters.types && filters.types.length > 0) {
      if (!filters.types.includes(node.type)) {
        return false;
      }
    }

    // Exclude types filter
    if (filters.exclude_types && filters.exclude_types.length > 0) {
      if (filters.exclude_types.includes(node.type)) {
        return false;
      }
    }

    // Cluster filter
    if (filters.clusters && filters.clusters.length > 0) {
      if (!node.clusters || !filters.clusters.some(c => node.clusters!.includes(c))) {
        return false;
      }
    }

    // Tags filter (must have ALL)
    if (filters.tags && filters.tags.length > 0) {
      if (!node.tags || !filters.tags.every(t => node.tags!.includes(t))) {
        return false;
      }
    }

    // Tags any filter (must have ANY)
    if (filters.tags_any && filters.tags_any.length > 0) {
      if (!node.tags || !filters.tags_any.some(t => node.tags!.includes(t))) {
        return false;
      }
    }

    // Exclude tags filter
    if (filters.exclude_tags && filters.exclude_tags.length > 0) {
      if (node.tags && filters.exclude_tags.some(t => node.tags!.includes(t))) {
        return false;
      }
    }

    return true;
  };

  const evaluateEdge = (edge: FilterEdgeInput): boolean => {
    // Relationship filter
    if (filters.relationships && filters.relationships.length > 0) {
      if (!filters.relationships.includes(edge.edge_type)) {
        return false;
      }
    }
    return true;
  };

  return { filters, evaluateNode, evaluateEdge };
}

/**
 * Parse and validate search filters.
 */
export function parseFilters(filters: unknown): { success: true; data: SSASearchFilters } | { success: false; error: string } {
  const result = SSASearchFiltersSchema.safeParse(filters);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}

// ============================================================
// SEEDING FUNCTIONS
// ============================================================

/**
 * Perform hybrid seeding with vector and BM25.
 */
export async function hybridSeed(
  queryEmbedding: Float32Array,
  queryTerms: string[],
  context: SSAGraphContext,
  predicate: FilterPredicate,
  config: SSAConfig
): Promise<SeedingResult> {
  const startTime = performance.now();

  // Vector search
  const vectorResults = await context.vectorSearch(queryEmbedding, config.max_seeds * 3);

  // BM25 search
  const bm25Results = await context.bm25Search(queryTerms, config.max_seeds * 3);

  // Combine scores
  const scoreMap = new Map<string, { vector: number; bm25: number }>();

  // Normalize BM25 scores (they can be > 1)
  const maxBm25 = Math.max(...bm25Results.map(r => r.score), 1);

  for (const result of vectorResults) {
    scoreMap.set(result.nodeId, { vector: result.score, bm25: 0 });
  }

  for (const result of bm25Results) {
    const existing = scoreMap.get(result.nodeId);
    const normalizedBm25 = result.score / maxBm25;
    if (existing) {
      existing.bm25 = normalizedBm25;
    } else {
      scoreMap.set(result.nodeId, { vector: 0, bm25: normalizedBm25 });
    }
  }

  // Calculate combined scores and filter
  const seeds: SeedNode[] = [];

  for (const [nodeId, scores] of scoreMap) {
    const combined = config.dense_weight * scores.vector + config.bm25_weight * scores.bm25;

    if (combined >= config.seed_threshold) {
      // Apply node filter
      const node = await context.getNode(nodeId);
      if (node && predicate.evaluateNode(node)) {
        seeds.push({
          node_id: nodeId,
          vector_score: scores.vector,
          bm25_score: scores.bm25,
          combined_score: combined,
        });
      }
    }
  }

  // Sort by combined score and limit
  seeds.sort((a, b) => b.combined_score - a.combined_score);
  const limitedSeeds = seeds.slice(0, config.max_seeds);

  return {
    seeds: limitedSeeds,
    vector_candidates: vectorResults.length,
    bm25_candidates: bm25Results.length,
    combined_candidates: scoreMap.size,
    execution_ms: performance.now() - startTime,
  };
}

// ============================================================
// SPREADING ACTIVATION FUNCTIONS
// ============================================================

/**
 * Get edge weight for SSA from edge type.
 */
export function getSSAEdgeWeight(edgeType: string): number {
  const weights = SSA_EDGE_WEIGHTS as unknown as Record<string, number>;
  return weights[edgeType] ?? 0.50; // Default to related_to weight
}

/**
 * Run spreading activation from seed nodes.
 */
export async function spreadActivation(
  seeds: SeedNode[],
  context: SSAGraphContext,
  predicate: FilterPredicate,
  config: SSAConfig
): Promise<SpreadingResult> {
  const startTime = performance.now();

  // Initialize activation map
  const activations = new Map<string, SSAActivatedNode>();
  const toProcess: Array<{ nodeId: string; activation: number; hop: number; path: string[] }> = [];

  // Initialize seeds
  for (const seed of seeds) {
    const activation = config.initial_activation * seed.combined_score;
    activations.set(seed.node_id, {
      node_id: seed.node_id,
      activation,
      hop_distance: 0,
      activation_path: [seed.node_id],
      is_seed: true,
      vector_score: seed.vector_score,
      bm25_score: seed.bm25_score,
    });
    toProcess.push({ nodeId: seed.node_id, activation, hop: 0, path: [seed.node_id] });
  }

  let nodesVisited = seeds.length;
  let edgesTraversed = 0;
  let hopsCompleted = 0;
  let terminatedReason: 'max_hops' | 'max_nodes' | 'no_spread' | 'threshold' = 'max_hops';

  // Process activation spread
  while (toProcess.length > 0 && hopsCompleted < config.max_hops) {
    const nextRound: typeof toProcess = [];
    hopsCompleted++;

    for (const { nodeId, activation, hop, path } of toProcess) {
      // Skip if below threshold
      if (activation < config.min_threshold) {
        continue;
      }

      // Get neighbors
      const neighbors = await context.getNeighbors(nodeId);

      for (const neighbor of neighbors) {
        edgesTraversed++;

        // Check edge filter
        if (!predicate.evaluateEdge(neighbor.edge)) {
          continue;
        }

        // Check node filter
        if (!predicate.evaluateNode(neighbor.node)) {
          continue;
        }

        // Calculate spread
        const edgeWeight = getSSAEdgeWeight(neighbor.edge.edge_type);
        const spread = activation * edgeWeight * config.hop_decay;

        if (spread < config.min_threshold) {
          continue;
        }

        const neighborId = neighbor.node.id;
        const existing = activations.get(neighborId);

        if (existing) {
          // Update existing activation based on aggregation mode
          if (config.aggregation === 'sum') {
            existing.activation += spread;
          } else {
            existing.activation = Math.max(existing.activation, spread);
          }
          // Update path if this path is shorter
          if (hop + 1 < existing.hop_distance) {
            existing.hop_distance = hop + 1;
            existing.activation_path = [...path, neighborId];
          }
        } else {
          // Add new activation
          const newNode: SSAActivatedNode = {
            node_id: neighborId,
            activation: spread,
            hop_distance: hop + 1,
            activation_path: [...path, neighborId],
            is_seed: false,
            vector_score: 0,
            bm25_score: 0,
          };
          activations.set(neighborId, newNode);
          nodesVisited++;

          // Check max nodes limit
          if (nodesVisited >= config.max_nodes) {
            terminatedReason = 'max_nodes';
            break;
          }
        }

        // Queue for next round
        nextRound.push({
          nodeId: neighborId,
          activation: spread,
          hop: hop + 1,
          path: [...path, neighborId],
        });
      }

      if (nodesVisited >= config.max_nodes) {
        break;
      }
    }

    if (nodesVisited >= config.max_nodes) {
      break;
    }

    if (nextRound.length === 0) {
      terminatedReason = 'no_spread';
      break;
    }

    toProcess.length = 0;
    toProcess.push(...nextRound);
  }

  // Convert map to array — raw activations may exceed 1.0 from sum aggregation.
  // Normalization happens downstream in executeSSA after the query-relevance filter,
  // so graph scores are relative to the surviving result set, not deleted hub nodes.
  const activated = Array.from(activations.values());

  return {
    activated,
    hops_completed: hopsCompleted,
    nodes_visited: nodesVisited,
    edges_traversed: edgesTraversed,
    terminated_reason: terminatedReason,
    execution_ms: performance.now() - startTime,
  };
}

// ============================================================
// RERANKING INTEGRATION
// ============================================================

/**
 * Convert activated nodes to scored nodes for reranking.
 */
export async function buildScoredNodes(
  activated: SSAActivatedNode[],
  context: SSAGraphContext
): Promise<ScoredNode[]> {
  const scoredNodes: ScoredNode[] = [];

  for (const node of activated) {
    const rerankData = await context.getNodeForReranking(node.node_id);
    if (rerankData) {
      scoredNodes.push({
        id: node.node_id,
        semantic_score: node.vector_score,
        bm25_score: node.bm25_score,
        graph_score: node.activation,
        last_accessed: rerankData.last_accessed,
        created_at: rerankData.created_at,
        access_count: rerankData.access_count,
        inbound_edge_count: rerankData.inbound_edge_count,
        subtype: rerankData.subtype,  // For per-section reranking (Issue 1)
      });
    }
  }

  return scoredNodes;
}

/**
 * Convert ranked nodes to SSA format.
 */
export function convertToSSARankedNodes(ranked: RankedNode[]): SSARankedNode[] {
  return ranked.map(r => ({
    node_id: r.node.id,
    score: r.score,
    ranking_reason: {
      primary_signal: r.primary_signal,
      explanation: generateExplanation(r.primary_signal, r.breakdown),
      score_breakdown: r.breakdown,
    },
  }));
}

// ============================================================
// SERENDIPITY FUNCTIONS
// ============================================================

/**
 * Identify serendipity candidates.
 */
export function identifySerendipity(
  activated: SSAActivatedNode[],
  level: SerendipityLevel
): SerendipityCandidate[] {
  if (level === 'off') {
    return [];
  }

  const threshold = SERENDIPITY_THRESHOLDS[level];
  const candidates: SerendipityCandidate[] = [];

  for (const node of activated) {
    // Low semantic similarity but high graph activation
    if (node.vector_score < threshold.maxSim && node.activation >= threshold.minGraph) {
      candidates.push({
        node_id: node.node_id,
        semantic_score: node.vector_score,
        graph_score: node.activation,
        connection_path: node.activation_path,
        explanation: `Connected via ${node.hop_distance} hops despite low semantic similarity`,
      });
    }
  }

  // Sort by graph score and limit
  candidates.sort((a, b) => b.graph_score - a.graph_score);
  return candidates.slice(0, threshold.count);
}

// ============================================================
// CONNECTION MAP FUNCTIONS
// ============================================================

/**
 * Build connection map from activated nodes.
 */
export async function buildConnectionMap(
  activated: SSAActivatedNode[],
  context: SSAGraphContext,
  predicate: FilterPredicate
): Promise<ConnectionMap> {
  const activatedIds = new Set(activated.map(n => n.node_id));
  const connections: NodeConnection[] = [];

  for (const node of activated) {
    const neighbors = await context.getNeighbors(node.node_id);
    for (const neighbor of neighbors) {
      // Only include edges between activated nodes
      if (activatedIds.has(neighbor.node.id)) {
        // Check edge filter
        if (predicate.evaluateEdge(neighbor.edge)) {
          connections.push({
            source_id: node.node_id,
            target_id: neighbor.node.id,
            edge_type: neighbor.edge.edge_type,
            weight: neighbor.weight,
          });
        }
      }
    }
  }

  return {
    connections,
    node_count: activated.length,
    edge_count: connections.length,
  };
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Get normalized queries from request.
 */
export function getNormalizedQueries(request: SearchRequest): string[] {
  if (request.queries && request.queries.length > 0) {
    return request.queries;
  }
  if (request.query) {
    return [request.query];
  }
  return [];
}

/**
 * Extract query terms for BM25.
 */
export function extractQueryTerms(queries: string[]): string[] {
  const terms: string[] = [];
  for (const query of queries) {
    // Simple tokenization - split on whitespace and punctuation
    const tokens = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);
    terms.push(...tokens);
  }
  // Deduplicate
  return [...new Set(terms)];
}

/**
 * Merge config with defaults.
 */
export function mergeSSAConfig(partial?: Partial<SSAConfig>): SSAConfig {
  if (!partial) return DEFAULT_SSA_CONFIG;
  return { ...DEFAULT_SSA_CONFIG, ...partial };
}

/**
 * Create empty execution metrics.
 */
export function createEmptyMetrics(): ExecutionMetrics {
  return {
    total_ms: 0,
    parse_filters_ms: 0,
    embed_queries_ms: 0,
    hybrid_seeding_ms: 0,
    spreading_ms: 0,
    reranking_ms: 0,
    seeds_found: 0,
    nodes_activated: 0,
    nodes_filtered: 0,
    nodes_returned: 0,
  };
}

/**
 * Generate explanation for primary signal.
 */
export function generateExplanation(
  primary: keyof ScoreBreakdown,
  breakdown: ScoreBreakdown
): string {
  const score = breakdown[primary];
  const percentage = Math.round(score * 100);

  switch (primary) {
    case 'semantic':
      return `Strong semantic match (${percentage}% similarity)`;
    case 'keyword':
      return `Keyword match in content (${percentage}% BM25 score)`;
    case 'graph':
      return `Connected via knowledge graph (${percentage}% activation)`;
    case 'recency':
      return `Recently accessed (${percentage}% recency score)`;
    case 'authority':
      return `Well-connected node (${percentage}% authority)`;
    case 'affinity':
      return `Frequently accessed by user (${percentage}% affinity)`;
    default:
      return `Primary signal: ${primary} (${percentage}%)`;
  }
}

/**
 * Get serendipity threshold for a level.
 */
export function getSerendipityThreshold(level: SerendipityLevel): { minGraph: number; maxSim: number; count: number } {
  return SERENDIPITY_THRESHOLDS[level];
}

// ============================================================
// VALIDATION FUNCTIONS
// ============================================================

export function validateSearchRequest(request: unknown): request is SearchRequest {
  return SearchRequestSchema.safeParse(request).success;
}

export function validateSearchFilters(filters: unknown): filters is SSASearchFilters {
  return SSASearchFiltersSchema.safeParse(filters).success;
}

export function validateSSAConfig(config: unknown): config is SSAConfig {
  return SSAConfigSchema.safeParse(config).success;
}

export function validateSSAResult(result: unknown): result is SSAResult {
  return SSAResultSchema.safeParse(result).success;
}

/**
 * Safely parse search request.
 */
export function parseSearchRequest(request: unknown): { success: true; data: SearchRequest } | { success: false; error: string } {
  const result = SearchRequestSchema.safeParse(request);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}

// ============================================================
// MAIN EXECUTION FUNCTION
// ============================================================

/**
 * Execute SSA retrieval algorithm.
 * Main entry point for Phase 1 retrieval.
 */
export async function executeSSA(options: ExecuteSSAOptions): Promise<SSAResult> {
  const startTime = performance.now();
  const metrics = createEmptyMetrics();

  const { request, context, embed, config: partialConfig } = options;
  const config = mergeSSAConfig(partialConfig);

  // Validate request
  const parseResult = parseSearchRequest(request);
  if (!parseResult.success) {
    // Don't expose internal schema details in error message
    throw new Error('Invalid search request: validation failed. Ensure query or queries is provided.');
  }

  // Step 0: Parse filters
  const filterStart = performance.now();
  const filters = request.filters ?? {};
  const predicate = buildFilterPredicate(filters);
  metrics.parse_filters_ms = performance.now() - filterStart;

  // Get normalized queries
  const queries = getNormalizedQueries(request);
  if (queries.length === 0) {
    throw new Error('No queries provided');
  }

  // Step 1: Embed queries
  const embedStart = performance.now();
  const queryEmbedding = await embed(queries);
  metrics.embed_queries_ms = performance.now() - embedStart;

  // Extract query terms for BM25
  const queryTerms = extractQueryTerms(queries);

  // Step 2: Hybrid seeding
  const seedingStart = performance.now();
  const seedingResult = await hybridSeed(queryEmbedding, queryTerms, context, predicate, config);
  metrics.hybrid_seeding_ms = performance.now() - seedingStart;
  metrics.seeds_found = seedingResult.seeds.length;

  // Handle empty seed case
  if (seedingResult.seeds.length === 0) {
    metrics.total_ms = performance.now() - startTime;
    return {
      original_queries: queries,
      filters_applied: filters,
      relevant_nodes: [],
      ranking_reasons: {},
      metrics,
    };
  }

  // Step 3: Spreading activation
  const spreadingStart = performance.now();
  const spreadingResult = await spreadActivation(seedingResult.seeds, context, predicate, config);
  metrics.spreading_ms = performance.now() - spreadingStart;
  metrics.nodes_activated = spreadingResult.activated.length;

  // Step 3.5: Query-relevance floor — drop nodes with zero topical connection.
  // Nodes discovered purely through graph edges (not seeds) have bm25_score=0
  // and vector_score=0. They got activated because they're well-connected, not
  // because they match the query. Seeds always pass (they matched during seeding).
  const relevantActivated = spreadingResult.activated.filter(
    (node) => node.is_seed || node.bm25_score > 0 || node.vector_score > 0,
  );
  metrics.nodes_filtered = spreadingResult.activated.length - relevantActivated.length;

  // Step 3.6: Normalize activations to [0, 1] across surviving nodes.
  // Raw activations from sum aggregation can exceed 1.0 when multiple paths converge.
  // Normalizing here (after the filter) ensures graph scores are relative to the
  // surviving result set — not inflated by removed hub nodes.
  if (relevantActivated.length > 0) {
    const maxActivation = Math.max(...relevantActivated.map((n) => n.activation));
    if (maxActivation > 0) {
      for (const node of relevantActivated) {
        node.activation = node.activation / maxActivation;
      }
    }
  }

  // Step 4: Per-section reranking — each node scored with its section's weight profile
  // Signals: recency-dominant. Episodic: recency-favoring. Knowledge: authority-dominant.
  // Procedural: keyword+graph-dominant. See: revisions/memory-sections/issue-1-retrieval-weights.md
  const rerankingStart = performance.now();
  const graphMetrics = await context.getGraphMetrics();
  const scoredNodes = await buildScoredNodes(relevantActivated, context);
  const rankedNodes = rerankWithSectionWeights(scoredNodes, graphMetrics);
  metrics.reranking_ms = performance.now() - rerankingStart;

  // Apply limit
  const limit = request.limit ?? config.default_limit;
  const limitedRanked = rankedNodes.slice(0, limit);

  // Convert to SSA format
  const ssaRankedNodes = convertToSSARankedNodes(limitedRanked);
  metrics.nodes_returned = ssaRankedNodes.length;

  // Build ranking reasons map
  const rankingReasons: Record<string, RankingReason> = {};
  for (const node of ssaRankedNodes) {
    rankingReasons[node.node_id] = node.ranking_reason;
  }

  // Step 5: Build result
  const result: SSAResult = {
    original_queries: queries,
    filters_applied: filters,
    relevant_nodes: ssaRankedNodes,
    ranking_reasons: rankingReasons,
    metrics,
  };

  // Optional: Include connection map
  if (request.include_connections) {
    result.connection_map = await buildConnectionMap(
      spreadingResult.activated,
      context,
      predicate
    );
  }

  // Optional: Include serendipity candidates
  const serendipityLevel = request.serendipity_level ?? 'off';
  if (serendipityLevel !== 'off') {
    result.serendipity_candidates = identifySerendipity(spreadingResult.activated, serendipityLevel);
  }

  metrics.total_ms = performance.now() - startTime;

  return result;
}

/**
 * Create a search response from SSA result.
 */
export function createSearchResponse(result: SSAResult): SearchResponse {
  return {
    results: result.relevant_nodes,
    filters_applied: result.filters_applied,
    total_candidates: result.metrics.nodes_activated,
    execution_time_ms: result.metrics.total_ms,
    metrics: result.metrics,
  };
}
