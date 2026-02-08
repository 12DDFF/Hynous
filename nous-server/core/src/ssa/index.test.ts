/**
 * @module @nous/core/ssa
 * @description Tests for SSA retrieval algorithm module (storm-005)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  // Constants
  SERENDIPITY_LEVELS,
  QUERY_COMBINATION_STRATEGIES,
  SERENDIPITY_THRESHOLDS,
  DEFAULT_SSA_CONFIG,

  // Types
  type SerendipityLevel,
  type QueryCombinationStrategy,
  type SSASearchFilters,
  type SearchRequest,
  type SSAResult,
  type SSARankedNode,
  type SSAScoreBreakdown,
  type RankingReason,
  type NodeConnection,
  type ConnectionMap,
  type SerendipityCandidate,
  type ExecutionMetrics,
  type SearchResponse,
  type SSAConfig,
  type SeedNode,
  type SeedingResult,
  type SSAActivatedNode,
  type SpreadingResult,
  type FilterNodeInput,
  type FilterEdgeInput,
  type FilterPredicate,
  type SSAGraphContext,
  type EmbedFunction,
  type ExecuteSSAOptions,

  // Schemas
  DateRangeFilterSchema,
  LastAccessedFilterSchema,
  SSASearchFiltersSchema,
  SearchRequestSchema,
  SSAScoreBreakdownSchema,
  RankingReasonSchema,
  SSARankedNodeSchema,
  NodeConnectionSchema,
  ConnectionMapSchema,
  SerendipityCandidateSchema,
  ExecutionMetricsSchema,
  SearchResponseSchema,
  SSAResultSchema,
  SSAConfigSchema,
  SeedNodeSchema,
  SeedingResultSchema,
  SSAActivatedNodeSchema,
  SpreadingResultSchema,
  FilterNodeInputSchema,
  FilterEdgeInputSchema,

  // Functions
  buildFilterPredicate,
  parseFilters,
  hybridSeed,
  getSSAEdgeWeight,
  spreadActivation,
  buildScoredNodes,
  convertToSSARankedNodes,
  identifySerendipity,
  buildConnectionMap,
  getNormalizedQueries,
  extractQueryTerms,
  mergeSSAConfig,
  createEmptyMetrics,
  generateExplanation,
  getSerendipityThreshold,
  validateSearchRequest,
  validateSearchFilters,
  validateSSAConfig,
  validateSSAResult,
  parseSearchRequest,
  executeSSA,
  createSearchResponse,
} from './index';
import { SSA_PARAMS, SSA_EDGE_WEIGHTS, type GraphMetrics, type ScoreBreakdown } from '../params';
import { SSA_SEED_THRESHOLD, DENSE_WEIGHT, BM25_WEIGHT } from '../embeddings';

// ============================================================
// TEST FIXTURES
// ============================================================

const createMockNode = (id: string, overrides: Partial<FilterNodeInput> = {}): FilterNodeInput => ({
  id,
  type: 'note',
  created_at: '2026-01-15T10:00:00.000Z',
  last_accessed: '2026-01-30T10:00:00.000Z',
  clusters: ['cluster-1'],
  tags: ['tag-1', 'tag-2'],
  ...overrides,
});

const createMockEdge = (source: string, target: string, type = 'related_to'): FilterEdgeInput => ({
  id: `${source}-${target}`,
  source_id: source,
  target_id: target,
  edge_type: type,
});

const createMockGraphContext = (): SSAGraphContext => ({
  getNode: vi.fn().mockResolvedValue(createMockNode('node-1')),
  getNeighbors: vi.fn().mockResolvedValue([]),
  vectorSearch: vi.fn().mockResolvedValue([]),
  bm25Search: vi.fn().mockResolvedValue([]),
  getGraphMetrics: vi.fn().mockResolvedValue({
    total_nodes: 100,
    total_edges: 200,
    avg_degree: 4.0,
  } as GraphMetrics),
  getNodeForReranking: vi.fn().mockResolvedValue({
    id: 'node-1',
    last_accessed: new Date('2026-01-30T10:00:00.000Z'),
    created_at: new Date('2026-01-15T10:00:00.000Z'),
    access_count: 5,
    inbound_edge_count: 3,
  }),
});

const createMockEmbed: EmbedFunction = vi.fn().mockResolvedValue(new Float32Array(768));

// ============================================================
// CONSTANTS TESTS
// ============================================================

describe('@nous/core/ssa - Constants', () => {
  describe('SERENDIPITY_LEVELS', () => {
    it('should define four levels', () => {
      expect(SERENDIPITY_LEVELS).toHaveLength(4);
      expect(SERENDIPITY_LEVELS).toContain('off');
      expect(SERENDIPITY_LEVELS).toContain('low');
      expect(SERENDIPITY_LEVELS).toContain('medium');
      expect(SERENDIPITY_LEVELS).toContain('high');
    });
  });

  describe('QUERY_COMBINATION_STRATEGIES', () => {
    it('should define combination strategies', () => {
      expect(QUERY_COMBINATION_STRATEGIES).toContain('average');
      expect(QUERY_COMBINATION_STRATEGIES).toContain('max_pooling');
    });
  });

  describe('SERENDIPITY_THRESHOLDS', () => {
    it('should have thresholds for each level', () => {
      expect(SERENDIPITY_THRESHOLDS.off.count).toBe(0);
      expect(SERENDIPITY_THRESHOLDS.low.count).toBe(2);
      expect(SERENDIPITY_THRESHOLDS.medium.count).toBe(5);
      expect(SERENDIPITY_THRESHOLDS.high.count).toBe(10);
    });

    it('should have decreasing minGraph thresholds', () => {
      expect(SERENDIPITY_THRESHOLDS.low.minGraph).toBeGreaterThan(SERENDIPITY_THRESHOLDS.medium.minGraph);
      expect(SERENDIPITY_THRESHOLDS.medium.minGraph).toBeGreaterThan(SERENDIPITY_THRESHOLDS.high.minGraph);
    });
  });

  describe('DEFAULT_SSA_CONFIG', () => {
    it('should use storm-016 constants for seeding', () => {
      expect(DEFAULT_SSA_CONFIG.seed_threshold).toBe(SSA_SEED_THRESHOLD);
      expect(DEFAULT_SSA_CONFIG.dense_weight).toBe(DENSE_WEIGHT);
      expect(DEFAULT_SSA_CONFIG.bm25_weight).toBe(BM25_WEIGHT);
    });

    it('should use storm-028 constants for spreading', () => {
      expect(DEFAULT_SSA_CONFIG.hop_decay).toBe(SSA_PARAMS.hop_decay);
      expect(DEFAULT_SSA_CONFIG.min_threshold).toBe(SSA_PARAMS.min_threshold);
      expect(DEFAULT_SSA_CONFIG.max_hops).toBe(SSA_PARAMS.max_hops);
      expect(DEFAULT_SSA_CONFIG.max_nodes).toBe(SSA_PARAMS.max_nodes);
      expect(DEFAULT_SSA_CONFIG.aggregation).toBe(SSA_PARAMS.aggregation);
    });

    it('should have reasonable defaults', () => {
      expect(DEFAULT_SSA_CONFIG.max_seeds).toBeGreaterThan(0);
      expect(DEFAULT_SSA_CONFIG.default_limit).toBe(30);
      expect(DEFAULT_SSA_CONFIG.query_combination).toBe('average');
    });
  });
});

// ============================================================
// SCHEMA VALIDATION TESTS
// ============================================================

describe('@nous/core/ssa - Schemas', () => {
  describe('DateRangeFilterSchema', () => {
    it('should accept valid date range', () => {
      const result = DateRangeFilterSchema.safeParse({
        after: '2026-01-01T00:00:00.000Z',
        before: '2026-12-31T23:59:59.999Z',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid date order', () => {
      const result = DateRangeFilterSchema.safeParse({
        after: '2026-12-31T00:00:00.000Z',
        before: '2026-01-01T00:00:00.000Z',
      });
      expect(result.success).toBe(false);
    });

    it('should accept partial dates', () => {
      expect(DateRangeFilterSchema.safeParse({ after: '2026-01-01T00:00:00.000Z' }).success).toBe(true);
      expect(DateRangeFilterSchema.safeParse({ before: '2026-12-31T00:00:00.000Z' }).success).toBe(true);
      expect(DateRangeFilterSchema.safeParse({}).success).toBe(true);
    });
  });

  describe('LastAccessedFilterSchema', () => {
    it('should accept positive integer days', () => {
      expect(LastAccessedFilterSchema.safeParse({ within_days: 7 }).success).toBe(true);
      expect(LastAccessedFilterSchema.safeParse({ within_days: 30 }).success).toBe(true);
    });

    it('should reject non-positive values', () => {
      expect(LastAccessedFilterSchema.safeParse({ within_days: 0 }).success).toBe(false);
      expect(LastAccessedFilterSchema.safeParse({ within_days: -1 }).success).toBe(false);
    });
  });

  describe('SSASearchFiltersSchema', () => {
    it('should accept valid filters', () => {
      const result = SSASearchFiltersSchema.safeParse({
        types: ['note', 'document'],
        tags: ['important'],
        clusters: ['work'],
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty filters', () => {
      expect(SSASearchFiltersSchema.safeParse({}).success).toBe(true);
    });

    it('should reject invalid within_hops', () => {
      expect(SSASearchFiltersSchema.safeParse({ within_hops: 0 }).success).toBe(false);
      expect(SSASearchFiltersSchema.safeParse({ within_hops: 11 }).success).toBe(false);
    });
  });

  describe('SearchRequestSchema', () => {
    it('should accept single query', () => {
      const result = SearchRequestSchema.safeParse({ query: 'test query' });
      expect(result.success).toBe(true);
    });

    it('should accept multiple queries', () => {
      const result = SearchRequestSchema.safeParse({ queries: ['query 1', 'query 2'] });
      expect(result.success).toBe(true);
    });

    it('should reject empty request', () => {
      expect(SearchRequestSchema.safeParse({}).success).toBe(false);
    });

    it('should accept optional parameters', () => {
      const result = SearchRequestSchema.safeParse({
        query: 'test',
        limit: 10,
        serendipity_level: 'medium',
        include_connections: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid limit', () => {
      expect(SearchRequestSchema.safeParse({ query: 'test', limit: 0 }).success).toBe(false);
      expect(SearchRequestSchema.safeParse({ query: 'test', limit: 101 }).success).toBe(false);
    });
  });

  describe('SSAScoreBreakdownSchema', () => {
    it('should accept valid scores', () => {
      const result = SSAScoreBreakdownSchema.safeParse({
        semantic: 0.8,
        keyword: 0.6,
        graph: 0.7,
        recency: 0.5,
        authority: 0.4,
        affinity: 0.3,
      });
      expect(result.success).toBe(true);
    });

    it('should reject out-of-range scores', () => {
      expect(SSAScoreBreakdownSchema.safeParse({
        semantic: 1.5,
        keyword: 0.6,
        graph: 0.7,
        recency: 0.5,
        authority: 0.4,
        affinity: 0.3,
      }).success).toBe(false);
    });
  });

  describe('SSARankedNodeSchema', () => {
    it('should accept valid ranked node', () => {
      const result = SSARankedNodeSchema.safeParse({
        node_id: 'node-1',
        score: 0.85,
        ranking_reason: {
          primary_signal: 'semantic',
          explanation: 'Strong semantic match',
          score_breakdown: {
            semantic: 0.8,
            keyword: 0.6,
            graph: 0.7,
            recency: 0.5,
            authority: 0.4,
            affinity: 0.3,
          },
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ExecutionMetricsSchema', () => {
    it('should accept valid metrics', () => {
      const result = ExecutionMetricsSchema.safeParse({
        total_ms: 95.5,
        parse_filters_ms: 2.0,
        embed_queries_ms: 50.0,
        hybrid_seeding_ms: 15.0,
        spreading_ms: 20.0,
        reranking_ms: 5.0,
        seeds_found: 10,
        nodes_activated: 150,
        nodes_returned: 30,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('SSAConfigSchema', () => {
    it('should accept valid config', () => {
      const result = SSAConfigSchema.safeParse(DEFAULT_SSA_CONFIG);
      expect(result.success).toBe(true);
    });

    it('should reject invalid aggregation', () => {
      const config = { ...DEFAULT_SSA_CONFIG, aggregation: 'invalid' };
      expect(SSAConfigSchema.safeParse(config).success).toBe(false);
    });
  });

  describe('SSAActivatedNodeSchema', () => {
    it('should accept valid activated node', () => {
      const result = SSAActivatedNodeSchema.safeParse({
        node_id: 'node-1',
        activation: 0.75,
        hop_distance: 2,
        activation_path: ['seed-1', 'node-1'],
        is_seed: false,
        vector_score: 0.0,
        bm25_score: 0.0,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('SpreadingResultSchema', () => {
    it('should accept valid spreading result', () => {
      const result = SpreadingResultSchema.safeParse({
        activated: [],
        hops_completed: 3,
        nodes_visited: 50,
        edges_traversed: 100,
        terminated_reason: 'max_hops',
        execution_ms: 20.0,
      });
      expect(result.success).toBe(true);
    });

    it('should accept all termination reasons', () => {
      const reasons = ['max_hops', 'max_nodes', 'no_spread', 'threshold'] as const;
      for (const reason of reasons) {
        const result = SpreadingResultSchema.safeParse({
          activated: [],
          hops_completed: 1,
          nodes_visited: 10,
          edges_traversed: 20,
          terminated_reason: reason,
          execution_ms: 5.0,
        });
        expect(result.success).toBe(true);
      }
    });
  });
});

// ============================================================
// FILTER FUNCTIONS TESTS
// ============================================================

describe('@nous/core/ssa - Filter Functions', () => {
  describe('buildFilterPredicate', () => {
    it('should build predicate for empty filters', () => {
      const predicate = buildFilterPredicate({});
      const node = createMockNode('node-1');
      expect(predicate.evaluateNode(node)).toBe(true);
    });

    it('should filter by types', () => {
      const predicate = buildFilterPredicate({ types: ['note'] });
      expect(predicate.evaluateNode(createMockNode('n1', { type: 'note' }))).toBe(true);
      expect(predicate.evaluateNode(createMockNode('n2', { type: 'document' }))).toBe(false);
    });

    it('should filter by exclude_types', () => {
      const predicate = buildFilterPredicate({ exclude_types: ['document'] });
      expect(predicate.evaluateNode(createMockNode('n1', { type: 'note' }))).toBe(true);
      expect(predicate.evaluateNode(createMockNode('n2', { type: 'document' }))).toBe(false);
    });

    it('should filter by tags (must have ALL)', () => {
      const predicate = buildFilterPredicate({ tags: ['tag-1', 'tag-2'] });
      expect(predicate.evaluateNode(createMockNode('n1', { tags: ['tag-1', 'tag-2', 'tag-3'] }))).toBe(true);
      expect(predicate.evaluateNode(createMockNode('n2', { tags: ['tag-1'] }))).toBe(false);
    });

    it('should filter by tags_any (must have ANY)', () => {
      const predicate = buildFilterPredicate({ tags_any: ['tag-1', 'tag-2'] });
      expect(predicate.evaluateNode(createMockNode('n1', { tags: ['tag-1'] }))).toBe(true);
      expect(predicate.evaluateNode(createMockNode('n2', { tags: ['tag-3'] }))).toBe(false);
    });

    it('should filter by exclude_tags', () => {
      const predicate = buildFilterPredicate({ exclude_tags: ['excluded'] });
      expect(predicate.evaluateNode(createMockNode('n1', { tags: ['good'] }))).toBe(true);
      expect(predicate.evaluateNode(createMockNode('n2', { tags: ['excluded'] }))).toBe(false);
    });

    it('should filter by clusters', () => {
      const predicate = buildFilterPredicate({ clusters: ['work'] });
      expect(predicate.evaluateNode(createMockNode('n1', { clusters: ['work'] }))).toBe(true);
      expect(predicate.evaluateNode(createMockNode('n2', { clusters: ['personal'] }))).toBe(false);
    });

    it('should filter by date_range', () => {
      const predicate = buildFilterPredicate({
        date_range: {
          after: '2026-01-01T00:00:00.000Z',
          before: '2026-01-31T23:59:59.999Z',
        },
      });
      expect(predicate.evaluateNode(createMockNode('n1', { created_at: '2026-01-15T10:00:00.000Z' }))).toBe(true);
      expect(predicate.evaluateNode(createMockNode('n2', { created_at: '2025-12-01T10:00:00.000Z' }))).toBe(false);
    });

    it('should filter by last_accessed', () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

      const predicate = buildFilterPredicate({ last_accessed: { within_days: 7 } });
      expect(predicate.evaluateNode(createMockNode('n1', { last_accessed: recentDate }))).toBe(true);
      expect(predicate.evaluateNode(createMockNode('n2', { last_accessed: oldDate }))).toBe(false);
    });

    it('should filter edges by relationships', () => {
      const predicate = buildFilterPredicate({ relationships: ['supports', 'contradicts'] });
      expect(predicate.evaluateEdge(createMockEdge('a', 'b', 'supports'))).toBe(true);
      expect(predicate.evaluateEdge(createMockEdge('a', 'b', 'related_to'))).toBe(false);
    });

    it('should pass all edges with no relationship filter', () => {
      const predicate = buildFilterPredicate({});
      expect(predicate.evaluateEdge(createMockEdge('a', 'b', 'any_type'))).toBe(true);
    });
  });

  describe('parseFilters', () => {
    it('should parse valid filters', () => {
      const result = parseFilters({ types: ['note'] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.types).toEqual(['note']);
      }
    });

    it('should return error for invalid filters', () => {
      const result = parseFilters({ within_hops: -1 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });
});

// ============================================================
// SEEDING FUNCTIONS TESTS
// ============================================================

describe('@nous/core/ssa - Seeding Functions', () => {
  describe('hybridSeed', () => {
    it('should combine vector and BM25 results', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'node-1', score: 0.8 },
        { nodeId: 'node-2', score: 0.7 },
      ]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'node-1', score: 5.0 },
        { nodeId: 'node-3', score: 4.0 },
      ]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(createMockNode('test'));

      const predicate = buildFilterPredicate({});
      const result = await hybridSeed(
        new Float32Array(768),
        ['test', 'query'],
        context,
        predicate,
        DEFAULT_SSA_CONFIG
      );

      expect(result.seeds.length).toBeGreaterThan(0);
      expect(result.vector_candidates).toBe(2);
      expect(result.bm25_candidates).toBe(2);
      expect(result.execution_ms).toBeGreaterThanOrEqual(0);
    });

    it('should filter out nodes below threshold', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'node-1', score: 0.3 }, // Below threshold when combined
      ]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(createMockNode('test'));

      const predicate = buildFilterPredicate({});
      const result = await hybridSeed(
        new Float32Array(768),
        ['test'],
        context,
        predicate,
        DEFAULT_SSA_CONFIG
      );

      expect(result.seeds).toHaveLength(0);
    });

    it('should apply node filters', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'node-1', score: 0.9 },
      ]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockNode('node-1', { type: 'document' })
      );

      const predicate = buildFilterPredicate({ types: ['note'] });
      const result = await hybridSeed(
        new Float32Array(768),
        ['test'],
        context,
        predicate,
        DEFAULT_SSA_CONFIG
      );

      expect(result.seeds).toHaveLength(0);
    });

    it('should limit seeds to max_seeds', async () => {
      const context = createMockGraphContext();
      const manyResults = Array.from({ length: 30 }, (_, i) => ({
        nodeId: `node-${i}`,
        score: 0.9,
      }));
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(manyResults);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(createMockNode('test'));

      const predicate = buildFilterPredicate({});
      const result = await hybridSeed(
        new Float32Array(768),
        ['test'],
        context,
        predicate,
        { ...DEFAULT_SSA_CONFIG, max_seeds: 5 }
      );

      expect(result.seeds.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getSSAEdgeWeight', () => {
    it('should return weight for known edge types', () => {
      expect(getSSAEdgeWeight('same_entity')).toBe(SSA_EDGE_WEIGHTS.same_entity);
      expect(getSSAEdgeWeight('related_to')).toBe(SSA_EDGE_WEIGHTS.related_to);
      expect(getSSAEdgeWeight('user_linked')).toBe(SSA_EDGE_WEIGHTS.user_linked);
    });

    it('should return default weight for unknown types', () => {
      expect(getSSAEdgeWeight('unknown_edge_type')).toBe(0.50);
    });
  });
});

// ============================================================
// SPREADING ACTIVATION TESTS
// ============================================================

describe('@nous/core/ssa - Spreading Activation', () => {
  describe('spreadActivation', () => {
    it('should initialize seeds with activation', async () => {
      const seeds: SeedNode[] = [
        { node_id: 'seed-1', vector_score: 0.8, bm25_score: 0.5, combined_score: 0.71 },
      ];
      const context = createMockGraphContext();
      const predicate = buildFilterPredicate({});

      const result = await spreadActivation(seeds, context, predicate, DEFAULT_SSA_CONFIG);

      expect(result.activated).toHaveLength(1);
      expect(result.activated[0].is_seed).toBe(true);
      expect(result.activated[0].hop_distance).toBe(0);
    });

    it('should spread to neighbors', async () => {
      const seeds: SeedNode[] = [
        { node_id: 'seed-1', vector_score: 0.9, bm25_score: 0.5, combined_score: 0.78 },
      ];
      const context = createMockGraphContext();
      (context.getNeighbors as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          node: createMockNode('neighbor-1'),
          edge: createMockEdge('seed-1', 'neighbor-1', 'related_to'),
          weight: 0.5,
        },
      ]);
      const predicate = buildFilterPredicate({});

      const result = await spreadActivation(seeds, context, predicate, DEFAULT_SSA_CONFIG);

      expect(result.activated.length).toBeGreaterThan(1);
      expect(result.hops_completed).toBeGreaterThanOrEqual(1);
    });

    it('should respect max_hops limit', async () => {
      const seeds: SeedNode[] = [
        { node_id: 'seed-1', vector_score: 0.9, bm25_score: 0.5, combined_score: 0.78 },
      ];
      const context = createMockGraphContext();

      // Create deep chain of neighbors
      let callCount = 0;
      (context.getNeighbors as ReturnType<typeof vi.fn>).mockImplementation(async (nodeId: string) => {
        callCount++;
        if (callCount > 10) return [];
        return [{
          node: createMockNode(`neighbor-${callCount}`),
          edge: createMockEdge(nodeId, `neighbor-${callCount}`, 'related_to'),
          weight: 0.5,
        }];
      });

      const predicate = buildFilterPredicate({});
      const config = { ...DEFAULT_SSA_CONFIG, max_hops: 2 };

      const result = await spreadActivation(seeds, context, predicate, config);

      expect(result.hops_completed).toBeLessThanOrEqual(2);
    });

    it('should stop spreading below threshold', async () => {
      const seeds: SeedNode[] = [
        { node_id: 'seed-1', vector_score: 0.2, bm25_score: 0.1, combined_score: 0.17 },
      ];
      const context = createMockGraphContext();
      const predicate = buildFilterPredicate({});
      const config = { ...DEFAULT_SSA_CONFIG, min_threshold: 0.1, initial_activation: 0.5 };

      const result = await spreadActivation(seeds, context, predicate, config);

      // Low initial activation should prevent much spreading
      expect(result.nodes_visited).toBeLessThan(10);
    });

    it('should apply edge filters', async () => {
      const seeds: SeedNode[] = [
        { node_id: 'seed-1', vector_score: 0.9, bm25_score: 0.5, combined_score: 0.78 },
      ];
      const context = createMockGraphContext();
      (context.getNeighbors as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          node: createMockNode('neighbor-1'),
          edge: createMockEdge('seed-1', 'neighbor-1', 'unrelated'),
          weight: 0.5,
        },
      ]);
      const predicate = buildFilterPredicate({ relationships: ['supports'] });

      const result = await spreadActivation(seeds, context, predicate, DEFAULT_SSA_CONFIG);

      // Only seed should be activated since edge doesn't match filter
      expect(result.activated).toHaveLength(1);
    });

    it('should aggregate activations based on mode', async () => {
      const seeds: SeedNode[] = [
        { node_id: 'seed-1', vector_score: 0.9, bm25_score: 0.5, combined_score: 0.78 },
        { node_id: 'seed-2', vector_score: 0.8, bm25_score: 0.4, combined_score: 0.68 },
      ];
      const context = createMockGraphContext();

      // Both seeds connect to same neighbor
      (context.getNeighbors as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          node: createMockNode('shared-neighbor'),
          edge: createMockEdge('seed-x', 'shared-neighbor', 'related_to'),
          weight: 0.5,
        },
      ]);
      const predicate = buildFilterPredicate({});

      // Test sum aggregation
      const sumResult = await spreadActivation(seeds, context, predicate, {
        ...DEFAULT_SSA_CONFIG,
        aggregation: 'sum',
      });

      // Test max aggregation
      const maxResult = await spreadActivation(seeds, context, predicate, {
        ...DEFAULT_SSA_CONFIG,
        aggregation: 'max',
      });

      // Both should complete without error
      expect(sumResult.activated.length).toBeGreaterThan(0);
      expect(maxResult.activated.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// RERANKING INTEGRATION TESTS
// ============================================================

describe('@nous/core/ssa - Reranking Integration', () => {
  describe('buildScoredNodes', () => {
    it('should convert activated nodes to scored nodes', async () => {
      const activated: SSAActivatedNode[] = [
        {
          node_id: 'node-1',
          activation: 0.8,
          hop_distance: 0,
          activation_path: ['node-1'],
          is_seed: true,
          vector_score: 0.9,
          bm25_score: 0.6,
        },
      ];
      const context = createMockGraphContext();

      const result = await buildScoredNodes(activated, context);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('node-1');
      expect(result[0].semantic_score).toBe(0.9);
      expect(result[0].bm25_score).toBe(0.6);
      expect(result[0].graph_score).toBe(0.8);
    });

    it('should skip nodes not found in context', async () => {
      const activated: SSAActivatedNode[] = [
        {
          node_id: 'node-1',
          activation: 0.8,
          hop_distance: 0,
          activation_path: ['node-1'],
          is_seed: true,
          vector_score: 0.9,
          bm25_score: 0.6,
        },
      ];
      const context = createMockGraphContext();
      (context.getNodeForReranking as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await buildScoredNodes(activated, context);

      expect(result).toHaveLength(0);
    });
  });

  describe('convertToSSARankedNodes', () => {
    it('should convert ranked nodes to SSA format', () => {
      const ranked = [{
        node: {
          id: 'node-1',
          semantic_score: 0.8,
          bm25_score: 0.6,
          graph_score: 0.7,
          last_accessed: new Date(),
          created_at: new Date(),
          access_count: 5,
          inbound_edge_count: 3,
        },
        score: 0.75,
        primary_signal: 'semantic' as const,
        breakdown: {
          semantic: 0.8,
          keyword: 0.6,
          graph: 0.7,
          recency: 0.5,
          authority: 0.4,
          affinity: 0.3,
        },
      }];

      const result = convertToSSARankedNodes(ranked);

      expect(result).toHaveLength(1);
      expect(result[0].node_id).toBe('node-1');
      expect(result[0].score).toBe(0.75);
      expect(result[0].ranking_reason.primary_signal).toBe('semantic');
    });
  });
});

// ============================================================
// SERENDIPITY TESTS
// ============================================================

describe('@nous/core/ssa - Serendipity Functions', () => {
  describe('identifySerendipity', () => {
    it('should return empty for off level', () => {
      const activated: SSAActivatedNode[] = [
        {
          node_id: 'node-1',
          activation: 0.8,
          hop_distance: 2,
          activation_path: ['seed', 'mid', 'node-1'],
          is_seed: false,
          vector_score: 0.1,
          bm25_score: 0.1,
        },
      ];

      const result = identifySerendipity(activated, 'off');
      expect(result).toHaveLength(0);
    });

    it('should find low semantic but high graph nodes', () => {
      const activated: SSAActivatedNode[] = [
        {
          node_id: 'serendipity-1',
          activation: 0.6,
          hop_distance: 2,
          activation_path: ['seed', 'mid', 'serendipity-1'],
          is_seed: false,
          vector_score: 0.2, // Low semantic
          bm25_score: 0.1,
        },
        {
          node_id: 'regular-1',
          activation: 0.7,
          hop_distance: 1,
          activation_path: ['seed', 'regular-1'],
          is_seed: false,
          vector_score: 0.8, // High semantic - not serendipitous
          bm25_score: 0.5,
        },
      ];

      const result = identifySerendipity(activated, 'medium');
      expect(result.some(c => c.node_id === 'serendipity-1')).toBe(true);
      expect(result.some(c => c.node_id === 'regular-1')).toBe(false);
    });

    it('should limit results based on level', () => {
      const activated: SSAActivatedNode[] = Array.from({ length: 20 }, (_, i) => ({
        node_id: `node-${i}`,
        activation: 0.5,
        hop_distance: 2,
        activation_path: ['seed', `node-${i}`],
        is_seed: false,
        vector_score: 0.1,
        bm25_score: 0.1,
      }));

      const lowResult = identifySerendipity(activated, 'low');
      const mediumResult = identifySerendipity(activated, 'medium');
      const highResult = identifySerendipity(activated, 'high');

      expect(lowResult.length).toBeLessThanOrEqual(SERENDIPITY_THRESHOLDS.low.count);
      expect(mediumResult.length).toBeLessThanOrEqual(SERENDIPITY_THRESHOLDS.medium.count);
      expect(highResult.length).toBeLessThanOrEqual(SERENDIPITY_THRESHOLDS.high.count);
    });
  });

  describe('getSerendipityThreshold', () => {
    it('should return correct thresholds for each level', () => {
      expect(getSerendipityThreshold('off')).toEqual(SERENDIPITY_THRESHOLDS.off);
      expect(getSerendipityThreshold('low')).toEqual(SERENDIPITY_THRESHOLDS.low);
      expect(getSerendipityThreshold('medium')).toEqual(SERENDIPITY_THRESHOLDS.medium);
      expect(getSerendipityThreshold('high')).toEqual(SERENDIPITY_THRESHOLDS.high);
    });
  });
});

// ============================================================
// CONNECTION MAP TESTS
// ============================================================

describe('@nous/core/ssa - Connection Map', () => {
  describe('buildConnectionMap', () => {
    it('should build connections between activated nodes', async () => {
      const activated: SSAActivatedNode[] = [
        {
          node_id: 'node-1',
          activation: 0.8,
          hop_distance: 0,
          activation_path: ['node-1'],
          is_seed: true,
          vector_score: 0.9,
          bm25_score: 0.6,
        },
        {
          node_id: 'node-2',
          activation: 0.6,
          hop_distance: 1,
          activation_path: ['node-1', 'node-2'],
          is_seed: false,
          vector_score: 0.0,
          bm25_score: 0.0,
        },
      ];

      const context = createMockGraphContext();
      (context.getNeighbors as ReturnType<typeof vi.fn>).mockImplementation(async (nodeId: string) => {
        if (nodeId === 'node-1') {
          return [{
            node: createMockNode('node-2'),
            edge: createMockEdge('node-1', 'node-2', 'related_to'),
            weight: 0.5,
          }];
        }
        return [];
      });

      const predicate = buildFilterPredicate({});
      const result = await buildConnectionMap(activated, context, predicate);

      expect(result.node_count).toBe(2);
      expect(result.connections.length).toBeGreaterThan(0);
    });

    it('should exclude connections to non-activated nodes', async () => {
      const activated: SSAActivatedNode[] = [
        {
          node_id: 'node-1',
          activation: 0.8,
          hop_distance: 0,
          activation_path: ['node-1'],
          is_seed: true,
          vector_score: 0.9,
          bm25_score: 0.6,
        },
      ];

      const context = createMockGraphContext();
      (context.getNeighbors as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          node: createMockNode('not-activated'),
          edge: createMockEdge('node-1', 'not-activated', 'related_to'),
          weight: 0.5,
        },
      ]);

      const predicate = buildFilterPredicate({});
      const result = await buildConnectionMap(activated, context, predicate);

      expect(result.connections).toHaveLength(0);
    });
  });
});

// ============================================================
// UTILITY FUNCTIONS TESTS
// ============================================================

describe('@nous/core/ssa - Utility Functions', () => {
  describe('getNormalizedQueries', () => {
    it('should return queries array when provided', () => {
      expect(getNormalizedQueries({ queries: ['q1', 'q2'] })).toEqual(['q1', 'q2']);
    });

    it('should wrap single query in array', () => {
      expect(getNormalizedQueries({ query: 'single query' })).toEqual(['single query']);
    });

    it('should prefer queries over query', () => {
      expect(getNormalizedQueries({ query: 'single', queries: ['multi'] })).toEqual(['multi']);
    });

    it('should return empty array for invalid input', () => {
      expect(getNormalizedQueries({} as SearchRequest)).toEqual([]);
    });
  });

  describe('extractQueryTerms', () => {
    it('should tokenize queries', () => {
      const terms = extractQueryTerms(['hello world', 'test query']);
      expect(terms).toContain('hello');
      expect(terms).toContain('world');
      expect(terms).toContain('test');
      expect(terms).toContain('query');
    });

    it('should lowercase terms', () => {
      const terms = extractQueryTerms(['Hello World']);
      expect(terms).toContain('hello');
      expect(terms).not.toContain('Hello');
    });

    it('should remove short tokens', () => {
      const terms = extractQueryTerms(['a b c hello']);
      expect(terms).toContain('hello');
      expect(terms).not.toContain('a');
    });

    it('should deduplicate terms', () => {
      const terms = extractQueryTerms(['hello hello world']);
      const helloCount = terms.filter(t => t === 'hello').length;
      expect(helloCount).toBe(1);
    });
  });

  describe('mergeSSAConfig', () => {
    it('should return defaults when no override', () => {
      expect(mergeSSAConfig()).toEqual(DEFAULT_SSA_CONFIG);
      expect(mergeSSAConfig(undefined)).toEqual(DEFAULT_SSA_CONFIG);
    });

    it('should merge partial config', () => {
      const result = mergeSSAConfig({ max_hops: 5 });
      expect(result.max_hops).toBe(5);
      expect(result.hop_decay).toBe(DEFAULT_SSA_CONFIG.hop_decay);
    });
  });

  describe('createEmptyMetrics', () => {
    it('should return zeroed metrics', () => {
      const metrics = createEmptyMetrics();
      expect(metrics.total_ms).toBe(0);
      expect(metrics.seeds_found).toBe(0);
      expect(metrics.nodes_activated).toBe(0);
    });
  });

  describe('generateExplanation', () => {
    it('should generate explanation for each signal type', () => {
      const breakdown: ScoreBreakdown = {
        semantic: 0.8,
        keyword: 0.6,
        graph: 0.7,
        recency: 0.5,
        authority: 0.4,
        affinity: 0.3,
      };

      expect(generateExplanation('semantic', breakdown)).toContain('80%');
      expect(generateExplanation('keyword', breakdown)).toContain('60%');
      expect(generateExplanation('graph', breakdown)).toContain('70%');
      expect(generateExplanation('recency', breakdown)).toContain('50%');
      expect(generateExplanation('authority', breakdown)).toContain('40%');
      expect(generateExplanation('affinity', breakdown)).toContain('30%');
    });
  });
});

// ============================================================
// VALIDATION FUNCTIONS TESTS
// ============================================================

describe('@nous/core/ssa - Validation Functions', () => {
  describe('validateSearchRequest', () => {
    it('should return true for valid request', () => {
      expect(validateSearchRequest({ query: 'test' })).toBe(true);
    });

    it('should return false for invalid request', () => {
      expect(validateSearchRequest({})).toBe(false);
      expect(validateSearchRequest(null)).toBe(false);
    });
  });

  describe('validateSearchFilters', () => {
    it('should return true for valid filters', () => {
      expect(validateSearchFilters({})).toBe(true);
      expect(validateSearchFilters({ types: ['note'] })).toBe(true);
    });

    it('should return false for invalid filters', () => {
      expect(validateSearchFilters({ within_hops: -1 })).toBe(false);
    });
  });

  describe('validateSSAConfig', () => {
    it('should return true for valid config', () => {
      expect(validateSSAConfig(DEFAULT_SSA_CONFIG)).toBe(true);
    });

    it('should return false for invalid config', () => {
      expect(validateSSAConfig({ ...DEFAULT_SSA_CONFIG, max_hops: -1 })).toBe(false);
    });
  });

  describe('parseSearchRequest', () => {
    it('should parse valid request', () => {
      const result = parseSearchRequest({ query: 'test' });
      expect(result.success).toBe(true);
    });

    it('should return error for invalid request', () => {
      const result = parseSearchRequest({});
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================
// MAIN EXECUTION TESTS
// ============================================================

describe('@nous/core/ssa - Main Execution', () => {
  describe('executeSSA', () => {
    it('should execute complete SSA pipeline', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'node-1', score: 0.9 },
      ]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'node-1', score: 3.0 },
      ]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(createMockNode('node-1'));

      const result = await executeSSA({
        request: { query: 'test query' },
        context,
        embed: createMockEmbed,
      });

      expect(result.original_queries).toEqual(['test query']);
      expect(result.metrics.total_ms).toBeGreaterThan(0);
      expect(Array.isArray(result.relevant_nodes)).toBe(true);
    });

    it('should handle empty seed case', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await executeSSA({
        request: { query: 'no matches' },
        context,
        embed: createMockEmbed,
      });

      expect(result.relevant_nodes).toHaveLength(0);
      expect(result.metrics.seeds_found).toBe(0);
    });

    it('should apply filters', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'node-1', score: 0.9 },
      ]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockNode('node-1', { type: 'document' })
      );

      const result = await executeSSA({
        request: {
          query: 'test',
          filters: { types: ['note'] },
        },
        context,
        embed: createMockEmbed,
      });

      // Node filtered out because type doesn't match
      expect(result.relevant_nodes).toHaveLength(0);
    });

    it('should respect limit', async () => {
      const context = createMockGraphContext();
      const manyNodes = Array.from({ length: 50 }, (_, i) => ({
        nodeId: `node-${i}`,
        score: 0.9,
      }));
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(manyNodes);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(createMockNode('test'));

      const result = await executeSSA({
        request: { query: 'test', limit: 5 },
        context,
        embed: createMockEmbed,
      });

      expect(result.relevant_nodes.length).toBeLessThanOrEqual(5);
    });

    it('should include connection map when requested', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'node-1', score: 0.9 },
      ]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(createMockNode('node-1'));

      const result = await executeSSA({
        request: { query: 'test', include_connections: true },
        context,
        embed: createMockEmbed,
      });

      expect(result.connection_map).toBeDefined();
    });

    it('should include serendipity candidates when level not off', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'node-1', score: 0.9 },
      ]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(createMockNode('node-1'));

      const result = await executeSSA({
        request: { query: 'test', serendipity_level: 'medium' },
        context,
        embed: createMockEmbed,
      });

      expect(result.serendipity_candidates).toBeDefined();
    });

    it('should handle multiple queries', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'node-1', score: 0.8 },
      ]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(createMockNode('node-1'));

      const result = await executeSSA({
        request: { queries: ['query 1', 'query 2', 'query 3'] },
        context,
        embed: createMockEmbed,
      });

      expect(result.original_queries).toHaveLength(3);
    });

    it('should throw for invalid request', async () => {
      const context = createMockGraphContext();

      await expect(executeSSA({
        request: {} as SearchRequest,
        context,
        embed: createMockEmbed,
      })).rejects.toThrow('Invalid search request');
    });

    it('should merge custom config', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await executeSSA({
        request: { query: 'test' },
        context,
        embed: createMockEmbed,
        config: { max_hops: 5, default_limit: 50 },
      });

      // Should complete without error with custom config
      expect(result.metrics).toBeDefined();
    });
  });

  describe('createSearchResponse', () => {
    it('should convert SSA result to search response', () => {
      const ssaResult: SSAResult = {
        original_queries: ['test'],
        filters_applied: {},
        relevant_nodes: [{
          node_id: 'node-1',
          score: 0.85,
          ranking_reason: {
            primary_signal: 'semantic',
            explanation: 'Strong match',
            score_breakdown: {
              semantic: 0.8,
              keyword: 0.6,
              graph: 0.7,
              recency: 0.5,
              authority: 0.4,
              affinity: 0.3,
            },
          },
        }],
        ranking_reasons: {},
        metrics: {
          total_ms: 50,
          parse_filters_ms: 1,
          embed_queries_ms: 30,
          hybrid_seeding_ms: 10,
          spreading_ms: 5,
          reranking_ms: 2,
          seeds_found: 5,
          nodes_activated: 20,
          nodes_returned: 1,
        },
      };

      const response = createSearchResponse(ssaResult);

      expect(response.results).toEqual(ssaResult.relevant_nodes);
      expect(response.filters_applied).toEqual({});
      expect(response.total_candidates).toBe(20);
      expect(response.execution_time_ms).toBe(50);
    });
  });
});

// ============================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================

describe('@nous/core/ssa - Edge Cases', () => {
  describe('Empty graph scenarios', () => {
    it('should handle graph with no nodes', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await executeSSA({
        request: { query: 'test' },
        context,
        embed: createMockEmbed,
      });

      expect(result.relevant_nodes).toHaveLength(0);
    });

    it('should handle graph with no edges', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'isolated-node', score: 0.9 },
      ]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(createMockNode('isolated-node'));
      (context.getNeighbors as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await executeSSA({
        request: { query: 'test' },
        context,
        embed: createMockEmbed,
      });

      expect(result.metrics.nodes_activated).toBeGreaterThan(0);
    });
  });

  describe('Boundary conditions', () => {
    it('should handle very long query', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const longQuery = 'word '.repeat(100).trim();
      const result = await executeSSA({
        request: { query: longQuery },
        context,
        embed: createMockEmbed,
      });

      expect(result.original_queries[0]).toBe(longQuery);
    });

    it('should handle special characters in query', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await executeSSA({
        request: { query: 'test@#$%^&*(){}[]|\\:;"\'<>,.?/' },
        context,
        embed: createMockEmbed,
      });

      expect(result.metrics).toBeDefined();
    });
  });

  describe('Performance tracking', () => {
    it('should track all timing metrics', async () => {
      const context = createMockGraphContext();
      (context.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { nodeId: 'node-1', score: 0.9 },
      ]);
      (context.bm25Search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (context.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(createMockNode('node-1'));

      const result = await executeSSA({
        request: { query: 'test' },
        context,
        embed: createMockEmbed,
      });

      expect(result.metrics.parse_filters_ms).toBeGreaterThanOrEqual(0);
      expect(result.metrics.embed_queries_ms).toBeGreaterThanOrEqual(0);
      expect(result.metrics.hybrid_seeding_ms).toBeGreaterThanOrEqual(0);
      expect(result.metrics.spreading_ms).toBeGreaterThanOrEqual(0);
      expect(result.metrics.reranking_ms).toBeGreaterThanOrEqual(0);
      expect(result.metrics.total_ms).toBeGreaterThanOrEqual(0);
    });
  });
});
