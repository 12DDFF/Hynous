/**
 * @module @nous/core/params
 * @description Tests for algorithm parameters module (storm-028)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Types
  ALGORITHM_NODE_TYPES,
  type AlgorithmNodeType,

  // Reranking
  RERANKING_WEIGHTS,
  RERANKING_CONFIG,
  RerankingWeightsSchema,
  RerankingConfigSchema,
  ScoreBreakdownSchema,
  type RerankingWeights,
  type ScoredNode,
  type GraphMetrics,
  type RankedNode,

  // Decay
  DECAY_CONFIG,
  INITIAL_STABILITY,
  INITIAL_DIFFICULTY,
  DECAY_LIFECYCLE_STATES,
  DecayConfigSchema,
  type DecayLifecycleState,

  // SSA
  SSA_PARAMS,
  SSA_EDGE_WEIGHTS,
  SSAParamsSchema,
  SSAEdgeWeightsSchema,

  // Confidence
  CONFIDENCE_THRESHOLDS,
  CONFIDENCE_LEVELS,
  RCS_WEIGHTS,
  CONTRADICTION_LEVELS,
  ConfidenceThresholdsSchema,
  RCSWeightsSchema,
  type ConfidenceLevel,
  type ContradictionLevel,

  // Adaptive Limits
  OPERATION_BUDGETS,
  QUALITY_TARGETS,
  QUALITY_WEIGHTS,
  COLD_START_THRESHOLD,
  COLD_START_LIMITS,
  QUERY_TYPES,
  BudgetConfigSchema,
  QualityTargetSchema,
  AdaptiveLimitsSchema,
  type QueryType,

  // BM25
  BM25_CONFIG,
  FIELD_BOOSTS,
  STOPWORDS_CONFIG,
  BM25ConfigSchema,
  FieldBoostSchema,
  StopwordsConfigSchema,

  // Master params
  ALGORITHM_PARAMS,

  // Reranking functions
  semanticScore,
  keywordScore,
  graphScore,
  recencyScore,
  authorityScore,
  affinityScore,
  rerankCandidates,

  // Decay functions
  calculateRetrievability,
  calculateDifficulty,
  updateStabilityOnAccess,
  getDecayLifecycleState,
  applyCascadeDecay,
  getInitialStability,
  getInitialDifficulty,

  // Confidence functions
  calculateRetrievalConfidence,
  getConfidenceLevel,
  detectContradiction,

  // Adaptive limit functions
  calculateAdaptiveLimits,
  calculateQualityScore,
  shouldTerminate,
  getBudgetForOperation,
  getQualityTargetForQueryType,

  // BM25 functions
  getEffectiveStopwords,
  removeStopwords,
  shouldIndexTerm,
  getFieldBoost,

  // Validation functions
  validateRerankingWeights,
  validateRerankingConfig,
  validateDecayConfig,
  validateSSAParams,
  validateSSAEdgeWeights,
  validateConfidenceThresholds,
  validateBudgetConfig,
  validateAdaptiveLimits,
  validateBM25Config,
  validateQualityTarget,
  validateGraphMetrics,
} from './index';

// ============================================================
// ALGORITHM NODE TYPES
// ============================================================

describe('Algorithm Node Types', () => {
  it('should have 7 behavioral types', () => {
    expect(ALGORITHM_NODE_TYPES).toHaveLength(7);
    expect(ALGORITHM_NODE_TYPES).toContain('person');
    expect(ALGORITHM_NODE_TYPES).toContain('fact');
    expect(ALGORITHM_NODE_TYPES).toContain('concept');
    expect(ALGORITHM_NODE_TYPES).toContain('event');
    expect(ALGORITHM_NODE_TYPES).toContain('note');
    expect(ALGORITHM_NODE_TYPES).toContain('document');
    expect(ALGORITHM_NODE_TYPES).toContain('preference');
  });

  it('should allow valid type assignments', () => {
    const nodeType: AlgorithmNodeType = 'person';
    expect(ALGORITHM_NODE_TYPES).toContain(nodeType);
  });
});

// ============================================================
// RERANKING WEIGHTS
// ============================================================

describe('Reranking Weights', () => {
  it('should sum to 1.0', () => {
    const sum = Object.values(RERANKING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
  });

  it('should have correct individual weights', () => {
    expect(RERANKING_WEIGHTS.semantic).toBe(0.30);
    expect(RERANKING_WEIGHTS.keyword).toBe(0.15);
    expect(RERANKING_WEIGHTS.graph).toBe(0.20);
    expect(RERANKING_WEIGHTS.recency).toBe(0.15);
    expect(RERANKING_WEIGHTS.authority).toBe(0.10);
    expect(RERANKING_WEIGHTS.affinity).toBe(0.10);
  });

  it('should validate via schema', () => {
    const result = RerankingWeightsSchema.safeParse(RERANKING_WEIGHTS);
    expect(result.success).toBe(true);
  });

  it('should reject weights that do not sum to 1.0', () => {
    const invalidWeights = { ...RERANKING_WEIGHTS, semantic: 0.50 };
    const result = RerankingWeightsSchema.safeParse(invalidWeights);
    expect(result.success).toBe(false);
  });
});

describe('Reranking Config', () => {
  it('should have correct values', () => {
    expect(RERANKING_CONFIG.recency_half_life_days).toBe(30);
    expect(RERANKING_CONFIG.authority_cap_multiple).toBe(2.0);
    expect(RERANKING_CONFIG.affinity_saturation).toBe(10);
    expect(RERANKING_CONFIG.new_content_boost_days).toBe(7);
    expect(RERANKING_CONFIG.new_content_boost_value).toBe(0.2);
  });

  it('should validate via schema', () => {
    const result = RerankingConfigSchema.safeParse(RERANKING_CONFIG);
    expect(result.success).toBe(true);
  });
});

// ============================================================
// DECAY CONFIGURATION
// ============================================================

describe('Decay Config', () => {
  it('should have correct FSRS-inspired values', () => {
    expect(DECAY_CONFIG.growth_rate).toBe(2.5);
    expect(DECAY_CONFIG.max_stability_days).toBe(365);
    expect(DECAY_CONFIG.active_threshold).toBe(0.5);
    expect(DECAY_CONFIG.weak_threshold).toBe(0.1);
    expect(DECAY_CONFIG.dormant_days).toBe(60);
    expect(DECAY_CONFIG.compress_days).toBe(120);
    expect(DECAY_CONFIG.archive_days).toBe(240);
    expect(DECAY_CONFIG.cascade_factor).toBe(0.8);
    expect(DECAY_CONFIG.edge_floor).toBe(0.1);
  });

  it('should validate via schema', () => {
    const result = DecayConfigSchema.safeParse(DECAY_CONFIG);
    expect(result.success).toBe(true);
  });
});

describe('Initial Stability', () => {
  it('should have per-type stability values', () => {
    expect(INITIAL_STABILITY.person).toBe(14);
    expect(INITIAL_STABILITY.fact).toBe(7);
    expect(INITIAL_STABILITY.concept).toBe(21);
    expect(INITIAL_STABILITY.event).toBe(10);
    expect(INITIAL_STABILITY.note).toBe(30);
    expect(INITIAL_STABILITY.document).toBe(7);
    expect(INITIAL_STABILITY.preference).toBe(45);
  });
});

describe('Initial Difficulty', () => {
  it('should have per-type difficulty values (0-1)', () => {
    for (const type of ALGORITHM_NODE_TYPES) {
      const difficulty = INITIAL_DIFFICULTY[type];
      expect(difficulty).toBeGreaterThanOrEqual(0);
      expect(difficulty).toBeLessThanOrEqual(1);
    }
  });

  it('should have correct values', () => {
    expect(INITIAL_DIFFICULTY.person).toBe(0.2);
    expect(INITIAL_DIFFICULTY.preference).toBe(0.1);
    expect(INITIAL_DIFFICULTY.document).toBe(0.5);
  });
});

describe('Decay Lifecycle States', () => {
  it('should have 5 states', () => {
    expect(DECAY_LIFECYCLE_STATES).toHaveLength(5);
    expect(DECAY_LIFECYCLE_STATES).toContain('ACTIVE');
    expect(DECAY_LIFECYCLE_STATES).toContain('WEAK');
    expect(DECAY_LIFECYCLE_STATES).toContain('DORMANT');
    expect(DECAY_LIFECYCLE_STATES).toContain('COMPRESS');
    expect(DECAY_LIFECYCLE_STATES).toContain('ARCHIVE');
  });
});

// ============================================================
// SSA PARAMETERS
// ============================================================

describe('SSA Params', () => {
  it('should have correct spreading activation values', () => {
    expect(SSA_PARAMS.initial_activation).toBe(1.0);
    expect(SSA_PARAMS.hop_decay).toBe(0.80);
    expect(SSA_PARAMS.min_threshold).toBe(0.01);
    expect(SSA_PARAMS.max_hops).toBe(3);
    expect(SSA_PARAMS.max_nodes).toBe(500);
    expect(SSA_PARAMS.aggregation).toBe('sum');
  });

  it('should validate via schema', () => {
    const result = SSAParamsSchema.safeParse(SSA_PARAMS);
    expect(result.success).toBe(true);
  });
});

describe('SSA Edge Weights', () => {
  it('should have weights in 0-1 range', () => {
    for (const [, weight] of Object.entries(SSA_EDGE_WEIGHTS)) {
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it('should have same_entity as highest weight', () => {
    expect(SSA_EDGE_WEIGHTS.same_entity).toBe(0.95);
    for (const [key, weight] of Object.entries(SSA_EDGE_WEIGHTS)) {
      if (key !== 'same_entity') {
        expect(weight).toBeLessThanOrEqual(SSA_EDGE_WEIGHTS.same_entity);
      }
    }
  });

  it('should validate via schema', () => {
    const result = SSAEdgeWeightsSchema.safeParse(SSA_EDGE_WEIGHTS);
    expect(result.success).toBe(true);
  });
});

// ============================================================
// CONFIDENCE THRESHOLDS
// ============================================================

describe('Confidence Thresholds', () => {
  it('should have retrieval thresholds', () => {
    expect(CONFIDENCE_THRESHOLDS.retrieval.high).toBe(0.70);
    expect(CONFIDENCE_THRESHOLDS.retrieval.medium).toBe(0.45);
    expect(CONFIDENCE_THRESHOLDS.retrieval.low).toBe(0.45);
  });

  it('should have classification thresholds', () => {
    expect(CONFIDENCE_THRESHOLDS.classification.clear_lookup).toBe(0.85);
    expect(CONFIDENCE_THRESHOLDS.classification.clear_reasoning).toBe(0.85);
    expect(CONFIDENCE_THRESHOLDS.classification.ambiguous_floor).toBe(0.50);
  });

  it('should have extraction thresholds', () => {
    expect(CONFIDENCE_THRESHOLDS.extraction.auto_store).toBe(0.85);
    expect(CONFIDENCE_THRESHOLDS.extraction.confirm_store).toBe(0.60);
  });

  it('should have contradiction thresholds', () => {
    expect(CONFIDENCE_THRESHOLDS.contradiction.definite).toBe(0.85);
    expect(CONFIDENCE_THRESHOLDS.contradiction.possible).toBe(0.60);
  });

  it('should validate via schema', () => {
    const result = ConfidenceThresholdsSchema.safeParse(CONFIDENCE_THRESHOLDS);
    expect(result.success).toBe(true);
  });
});

describe('RCS Weights', () => {
  it('should have MQ, DT, CM weights', () => {
    expect(RCS_WEIGHTS.match_quality).toBe(0.40);
    expect(RCS_WEIGHTS.distinctiveness).toBe(0.35);
    expect(RCS_WEIGHTS.completeness).toBe(0.25);
  });

  it('should sum to 1.0', () => {
    const sum = RCS_WEIGHTS.match_quality + RCS_WEIGHTS.distinctiveness + RCS_WEIGHTS.completeness;
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
  });
});

// ============================================================
// ADAPTIVE LIMITS
// ============================================================

describe('Operation Budgets', () => {
  it('should have budget for common operations', () => {
    expect(OPERATION_BUDGETS.simple_lookup).toBeDefined();
    expect(OPERATION_BUDGETS.standard_query).toBeDefined();
    expect(OPERATION_BUDGETS.complex_query).toBeDefined();
    expect(OPERATION_BUDGETS.phase2_reasoning).toBeDefined();
  });

  it('should have increasing budgets for complexity', () => {
    expect(OPERATION_BUDGETS.simple_lookup!.time_ms).toBeLessThan(OPERATION_BUDGETS.standard_query!.time_ms);
    expect(OPERATION_BUDGETS.standard_query!.time_ms).toBeLessThan(OPERATION_BUDGETS.complex_query!.time_ms);
  });

  it('should validate via schema', () => {
    for (const budget of Object.values(OPERATION_BUDGETS)) {
      const result = BudgetConfigSchema.safeParse(budget);
      expect(result.success).toBe(true);
    }
  });
});

describe('Quality Targets', () => {
  it('should have targets for query types', () => {
    expect(QUALITY_TARGETS.LOOKUP).toBeDefined();
    expect(QUALITY_TARGETS.REASONING).toBeDefined();
    expect(QUALITY_TARGETS.EXPLORATORY).toBeDefined();
    expect(QUALITY_TARGETS.TEMPORAL).toBeDefined();
  });

  it('should validate via schema', () => {
    for (const target of Object.values(QUALITY_TARGETS)) {
      const result = QualityTargetSchema.safeParse(target);
      expect(result.success).toBe(true);
    }
  });
});

describe('Cold Start', () => {
  it('should have correct threshold', () => {
    expect(COLD_START_THRESHOLD).toBe(200);
  });

  it('should have cold start limits', () => {
    expect(COLD_START_LIMITS.entry_points).toBe(2);
    expect(COLD_START_LIMITS.max_hops).toBe(3);
    expect(COLD_START_LIMITS.max_nodes).toBe(50);
  });

  it('should validate cold start limits via schema', () => {
    const result = AdaptiveLimitsSchema.safeParse(COLD_START_LIMITS);
    expect(result.success).toBe(true);
  });
});

// ============================================================
// BM25 CONFIGURATION
// ============================================================

describe('BM25 Config', () => {
  it('should have correct values', () => {
    expect(BM25_CONFIG.k1).toBe(1.2);
    expect(BM25_CONFIG.b).toBe(0.75);
    expect(BM25_CONFIG.min_term_length).toBe(2);
    expect(BM25_CONFIG.max_term_length).toBe(50);
    expect(BM25_CONFIG.max_doc_frequency_ratio).toBe(0.95);
    expect(BM25_CONFIG.stemmer).toBe('porter');
    expect(BM25_CONFIG.preserve_original).toBe(true);
  });

  it('should validate via schema', () => {
    const result = BM25ConfigSchema.safeParse(BM25_CONFIG);
    expect(result.success).toBe(true);
  });
});

describe('Field Boosts', () => {
  it('should have 5 field types', () => {
    expect(FIELD_BOOSTS).toHaveLength(5);
  });

  it('should have correct boost order', () => {
    const titleBoost = FIELD_BOOSTS.find(fb => fb.field === 'title');
    const bodyBoost = FIELD_BOOSTS.find(fb => fb.field === 'body');
    expect(titleBoost!.boost).toBeGreaterThan(bodyBoost!.boost);
  });

  it('should validate via schema', () => {
    for (const boost of FIELD_BOOSTS) {
      const result = FieldBoostSchema.safeParse(boost);
      expect(result.success).toBe(true);
    }
  });
});

describe('Stopwords Config', () => {
  it('should have English stopwords', () => {
    expect(STOPWORDS_CONFIG.language).toBe('en');
    expect(STOPWORDS_CONFIG.default_list).toContain('the');
    expect(STOPWORDS_CONFIG.default_list).toContain('and');
  });

  it('should have custom additions', () => {
    expect(STOPWORDS_CONFIG.custom_additions).toContain('note');
    expect(STOPWORDS_CONFIG.custom_additions).toContain('idea');
  });

  it('should validate via schema', () => {
    const result = StopwordsConfigSchema.safeParse(STOPWORDS_CONFIG);
    expect(result.success).toBe(true);
  });
});

// ============================================================
// MASTER ALGORITHM PARAMS
// ============================================================

describe('ALGORITHM_PARAMS', () => {
  it('should aggregate all parameter groups', () => {
    expect(ALGORITHM_PARAMS.reranking.weights).toBe(RERANKING_WEIGHTS);
    expect(ALGORITHM_PARAMS.reranking.config).toBe(RERANKING_CONFIG);
    expect(ALGORITHM_PARAMS.decay.config).toBe(DECAY_CONFIG);
    expect(ALGORITHM_PARAMS.ssa.params).toBe(SSA_PARAMS);
    expect(ALGORITHM_PARAMS.confidence.thresholds).toBe(CONFIDENCE_THRESHOLDS);
    expect(ALGORITHM_PARAMS.adaptive.cold_start_threshold).toBe(COLD_START_THRESHOLD);
    expect(ALGORITHM_PARAMS.bm25.config).toBe(BM25_CONFIG);
  });
});

// ============================================================
// RERANKING FUNCTIONS
// ============================================================

describe('Reranking Functions', () => {
  const createTestNode = (overrides: Partial<ScoredNode> = {}): ScoredNode => ({
    id: 'test-node',
    semantic_score: 0.8,
    bm25_score: 10,
    graph_score: 0.6,
    last_accessed: new Date(),
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    access_count: 5,
    inbound_edge_count: 10,
    ...overrides,
  });

  const testMetrics: GraphMetrics = {
    total_nodes: 1000,
    total_edges: 5000,
    density: 0.005,
    avg_inbound_edges: 5,
    avg_outbound_edges: 5,
  };

  describe('semanticScore', () => {
    it('should return semantic_score if present', () => {
      const node = createTestNode({ semantic_score: 0.75 });
      expect(semanticScore(node)).toBe(0.75);
    });

    it('should return 0 if semantic_score is undefined', () => {
      const node = createTestNode({ semantic_score: undefined });
      expect(semanticScore(node)).toBe(0);
    });
  });

  describe('keywordScore', () => {
    it('should normalize against max BM25', () => {
      const node = createTestNode({ bm25_score: 5 });
      expect(keywordScore(node, 10, 5)).toBe(0.5);
    });

    it('should return 0.5 if maxBM25 is 0', () => {
      const node = createTestNode({ bm25_score: 0 });
      expect(keywordScore(node, 0, 5)).toBe(0.5);
    });

    it('should return 1.0 for single candidate', () => {
      const node = createTestNode({ bm25_score: 5 });
      expect(keywordScore(node, 10, 1)).toBe(1.0);
    });
  });

  describe('graphScore', () => {
    it('should return graph_score if present', () => {
      const node = createTestNode({ graph_score: 0.65 });
      expect(graphScore(node)).toBe(0.65);
    });

    it('should return 0 if graph_score is undefined', () => {
      const node = createTestNode({ graph_score: undefined });
      expect(graphScore(node)).toBe(0);
    });
  });

  describe('recencyScore', () => {
    it('should return 1.0 for today', () => {
      const now = new Date();
      expect(recencyScore(now, now)).toBeCloseTo(1.0, 2);
    });

    it('should decay with time', () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const score = recencyScore(thirtyDaysAgo, now);
      expect(score).toBeLessThan(1.0);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('authorityScore', () => {
    it('should return 0.5 if avgInbound is 0', () => {
      expect(authorityScore(10, 0)).toBe(0.5);
    });

    it('should cap at 1.0', () => {
      expect(authorityScore(100, 5)).toBe(1.0);
    });

    it('should scale with edge count', () => {
      expect(authorityScore(5, 10)).toBe(0.25);
    });
  });

  describe('affinityScore', () => {
    it('should boost new content', () => {
      const now = new Date();
      const createdRecently = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const score = affinityScore(0, createdRecently, now, now);
      expect(score).toBeGreaterThan(0);
    });

    it('should saturate with access count', () => {
      const now = new Date();
      const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const score1 = affinityScore(5, old, now, now);
      const score2 = affinityScore(100, old, now, now);
      expect(score2).toBeGreaterThan(score1);
      // Diminishing returns - 20x more accesses doesn't give 20x more score
      expect(score2).toBeLessThan(score1 * 3);
    });
  });

  describe('rerankCandidates', () => {
    it('should return empty array for empty input', () => {
      expect(rerankCandidates([], testMetrics)).toEqual([]);
    });

    it('should rank candidates by score', () => {
      const node1 = createTestNode({ id: 'node1', semantic_score: 0.9 });
      const node2 = createTestNode({ id: 'node2', semantic_score: 0.5 });
      const results = rerankCandidates([node1, node2], testMetrics);
      expect(results[0].node.id).toBe('node1');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('should include score breakdown', () => {
      const node = createTestNode();
      const results = rerankCandidates([node], testMetrics);
      expect(results[0].breakdown).toHaveProperty('semantic');
      expect(results[0].breakdown).toHaveProperty('keyword');
      expect(results[0].breakdown).toHaveProperty('graph');
      expect(results[0].breakdown).toHaveProperty('recency');
      expect(results[0].breakdown).toHaveProperty('authority');
      expect(results[0].breakdown).toHaveProperty('affinity');
    });

    it('should identify primary signal', () => {
      const node = createTestNode({ semantic_score: 1.0, graph_score: 0 });
      const results = rerankCandidates([node], testMetrics);
      expect(results[0].primary_signal).toBe('semantic');
    });
  });
});

// ============================================================
// DECAY FUNCTIONS
// ============================================================

describe('Decay Functions', () => {
  describe('calculateRetrievability', () => {
    it('should return 1.0 for 0 days since access', () => {
      expect(calculateRetrievability(0, 10)).toBeCloseTo(1.0, 5);
    });

    it('should return ~0.37 after 1 stability period', () => {
      const stability = 10;
      expect(calculateRetrievability(stability, stability)).toBeCloseTo(Math.exp(-1), 2);
    });

    it('should return 0 for zero stability', () => {
      expect(calculateRetrievability(10, 0)).toBe(0);
    });

    it('should decrease with time', () => {
      const stability = 10;
      expect(calculateRetrievability(5, stability)).toBeGreaterThan(calculateRetrievability(10, stability));
    });
  });

  describe('calculateDifficulty', () => {
    it('should return base difficulty for minimal content', () => {
      const difficulty = calculateDifficulty('fact', 100, 0);
      expect(difficulty).toBeCloseTo(INITIAL_DIFFICULTY.fact, 1);
    });

    it('should increase with content length', () => {
      const shortContent = calculateDifficulty('fact', 100, 0);
      const longContent = calculateDifficulty('fact', 5000, 0);
      expect(longContent).toBeGreaterThan(shortContent);
    });

    it('should decrease with more edges', () => {
      const fewEdges = calculateDifficulty('fact', 1000, 5);
      const manyEdges = calculateDifficulty('fact', 1000, 40);
      expect(manyEdges).toBeLessThan(fewEdges);
    });

    it('should stay within 0-1', () => {
      for (const type of ALGORITHM_NODE_TYPES) {
        const difficulty = calculateDifficulty(type, 10000, 100);
        expect(difficulty).toBeGreaterThanOrEqual(0);
        expect(difficulty).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('updateStabilityOnAccess', () => {
    it('should increase stability', () => {
      const newStability = updateStabilityOnAccess(10, 0.3);
      expect(newStability).toBeGreaterThan(10);
    });

    it('should cap at max stability', () => {
      const newStability = updateStabilityOnAccess(300, 0.1);
      expect(newStability).toBeLessThanOrEqual(DECAY_CONFIG.max_stability_days);
    });

    it('should grow less with higher difficulty', () => {
      const lowDiff = updateStabilityOnAccess(10, 0.1);
      const highDiff = updateStabilityOnAccess(10, 0.9);
      expect(lowDiff).toBeGreaterThan(highDiff);
    });
  });

  describe('getDecayLifecycleState', () => {
    it('should return ACTIVE for high retrievability', () => {
      expect(getDecayLifecycleState(0.8, 0)).toBe('ACTIVE');
    });

    it('should return WEAK for medium retrievability', () => {
      expect(getDecayLifecycleState(0.3, 0)).toBe('WEAK');
    });

    it('should return DORMANT for low retrievability', () => {
      expect(getDecayLifecycleState(0.05, 30)).toBe('DORMANT');
    });

    it('should return COMPRESS for extended dormancy', () => {
      expect(getDecayLifecycleState(0.05, 150)).toBe('COMPRESS');
    });

    it('should return ARCHIVE for very long dormancy', () => {
      expect(getDecayLifecycleState(0.05, 250)).toBe('ARCHIVE');
    });
  });

  describe('applyCascadeDecay', () => {
    it('should not decay edges for active nodes', () => {
      expect(applyCascadeDecay(0.8, 0.6)).toBe(0.8);
    });

    it('should decay edges for dormant nodes', () => {
      const decayed = applyCascadeDecay(0.8, 0.05);
      expect(decayed).toBeLessThan(0.8);
    });

    it('should not decay below edge floor', () => {
      const decayed = applyCascadeDecay(0.15, 0.01);
      expect(decayed).toBeGreaterThanOrEqual(DECAY_CONFIG.edge_floor);
    });
  });

  describe('getInitialStability', () => {
    it('should return correct values for types', () => {
      expect(getInitialStability('person')).toBe(14);
      expect(getInitialStability('fact')).toBe(7);
      expect(getInitialStability('preference')).toBe(45);
    });

    it('should return default for unknown type', () => {
      expect(getInitialStability('unknown' as AlgorithmNodeType)).toBe(14);
    });
  });

  describe('getInitialDifficulty', () => {
    it('should return correct values for types', () => {
      expect(getInitialDifficulty('preference')).toBe(0.1);
      expect(getInitialDifficulty('document')).toBe(0.5);
    });

    it('should return default for unknown type', () => {
      expect(getInitialDifficulty('unknown' as AlgorithmNodeType)).toBe(0.3);
    });
  });
});

// ============================================================
// CONFIDENCE FUNCTIONS
// ============================================================

describe('Confidence Functions', () => {
  describe('calculateRetrievalConfidence', () => {
    it('should return LOW for no results', () => {
      const result = calculateRetrievalConfidence(0, null, 0, false);
      expect(result.level).toBe('LOW');
      expect(result.score).toBe(0);
      expect(result.flags).toContain('no_results');
    });

    it('should return HIGH for perfect match', () => {
      // Perfect match requires MQ > 0.95, DT > 0.8, and hasAttribute=true
      // With single result and high topScore, DT should be high
      const result = calculateRetrievalConfidence(0.98, null, 1, true);
      expect(result.level).toBe('HIGH');
      expect(result.flags).toContain('perfect_match');
    });

    it('should flag disambiguation needed', () => {
      const result = calculateRetrievalConfidence(0.8, 0.75, 5, true);
      expect(result.flags).toContain('disambiguation_needed');
    });

    it('should flag sparse results', () => {
      const result = calculateRetrievalConfidence(0.4, null, 2, true);
      expect(result.flags).toContain('sparse_results');
    });

    it('should include breakdown', () => {
      const result = calculateRetrievalConfidence(0.8, 0.5, 3, true);
      expect(result.breakdown).toHaveProperty('mq');
      expect(result.breakdown).toHaveProperty('dt');
      expect(result.breakdown).toHaveProperty('cm');
    });
  });

  describe('getConfidenceLevel', () => {
    it('should return HIGH for >= 0.70', () => {
      expect(getConfidenceLevel(0.70)).toBe('HIGH');
      expect(getConfidenceLevel(0.95)).toBe('HIGH');
    });

    it('should return MEDIUM for >= 0.45', () => {
      expect(getConfidenceLevel(0.45)).toBe('MEDIUM');
      expect(getConfidenceLevel(0.69)).toBe('MEDIUM');
    });

    it('should return LOW for < 0.45', () => {
      expect(getConfidenceLevel(0.44)).toBe('LOW');
      expect(getConfidenceLevel(0.1)).toBe('LOW');
    });
  });

  describe('detectContradiction', () => {
    it('should flag definite contradictions', () => {
      // Score = similarity*0.4 + logicalConflict*0.5 = 1.0*0.4 + 1.0*0.5 = 0.9 >= 0.85
      const result = detectContradiction(1.0, 1.0, 10);
      expect(result.level).toBe('definite');
      expect(result.action).toBe('flag_user');
    });

    it('should note possible contradictions', () => {
      const result = detectContradiction(0.7, 0.7, 10);
      expect(result.level).toBe('possible');
      expect(result.action).toBe('note_internal');
    });

    it('should allow safe storage for no conflict', () => {
      const result = detectContradiction(0.3, 0.2, 10);
      expect(result.level).toBe('none');
      expect(result.action).toBe('safe_to_store');
    });

    it('should reduce score for old existing info', () => {
      const recent = detectContradiction(0.8, 0.8, 30);
      const old = detectContradiction(0.8, 0.8, 120);
      expect(old.score).toBeLessThan(recent.score);
    });
  });
});

// ============================================================
// ADAPTIVE LIMIT FUNCTIONS
// ============================================================

describe('Adaptive Limit Functions', () => {
  describe('calculateAdaptiveLimits', () => {
    it('should use cold start limits for small graphs', () => {
      const limits = calculateAdaptiveLimits(100, 0.01, 'standard');
      expect(limits.entry_points).toBe(COLD_START_LIMITS.entry_points);
      expect(limits.max_nodes).toBeLessThanOrEqual(50);
    });

    it('should scale with graph size', () => {
      const small = calculateAdaptiveLimits(500, 0.01, 'standard');
      const large = calculateAdaptiveLimits(10000, 0.01, 'standard');
      expect(large.max_nodes).toBeGreaterThan(small.max_nodes);
    });

    it('should adjust hops by density', () => {
      const sparse = calculateAdaptiveLimits(1000, 0.0001, 'standard');
      const dense = calculateAdaptiveLimits(1000, 0.1, 'standard');
      expect(sparse.max_hops).toBeGreaterThan(dense.max_hops);
    });

    it('should respect query type budgets', () => {
      const simple = calculateAdaptiveLimits(5000, 0.01, 'simple');
      const complex = calculateAdaptiveLimits(5000, 0.01, 'complex');
      expect(complex.max_nodes).toBeGreaterThan(simple.max_nodes);
    });
  });

  describe('calculateQualityScore', () => {
    it('should weight components correctly', () => {
      const score = calculateQualityScore(1.0, 1.0, 1.0);
      expect(score).toBeCloseTo(1.0, 2);
    });

    it('should be 0 for all zeros', () => {
      expect(calculateQualityScore(0, 0, 0)).toBe(0);
    });
  });

  describe('shouldTerminate', () => {
    const fullBudget = { time_ms: 100, max_nodes: 500, max_api_calls: 5 };

    it('should terminate when quality target met', () => {
      const result = shouldTerminate(0.8, 0.7, 0.1, 0, fullBudget);
      expect(result.terminate).toBe(true);
      expect(result.reason).toBe('quality_target_met');
    });

    it('should terminate when converged', () => {
      const result = shouldTerminate(0.5, 0.7, 0.01, 3, fullBudget);
      expect(result.terminate).toBe(true);
      expect(result.reason).toBe('converged');
    });

    it('should terminate when time exhausted', () => {
      const result = shouldTerminate(0.5, 0.7, 0.1, 0, { ...fullBudget, time_ms: 0 });
      expect(result.terminate).toBe(true);
      expect(result.reason).toBe('time_exhausted');
    });

    it('should terminate when node limit reached', () => {
      const result = shouldTerminate(0.5, 0.7, 0.1, 0, { ...fullBudget, max_nodes: 0 });
      expect(result.terminate).toBe(true);
      expect(result.reason).toBe('node_limit_reached');
    });

    it('should not terminate if conditions not met', () => {
      const result = shouldTerminate(0.5, 0.7, 0.1, 0, fullBudget);
      expect(result.terminate).toBe(false);
    });
  });

  describe('getBudgetForOperation', () => {
    it('should return known budgets', () => {
      expect(getBudgetForOperation('simple_lookup')).toBe(OPERATION_BUDGETS.simple_lookup);
    });

    it('should return standard_query for unknown', () => {
      expect(getBudgetForOperation('unknown')).toEqual(OPERATION_BUDGETS['standard_query']);
    });
  });

  describe('getQualityTargetForQueryType', () => {
    it('should return known targets', () => {
      expect(getQualityTargetForQueryType('LOOKUP')).toBe(QUALITY_TARGETS.LOOKUP);
    });

    it('should return REASONING for unknown', () => {
      expect(getQualityTargetForQueryType('unknown')).toEqual(QUALITY_TARGETS['REASONING']);
    });
  });
});

// ============================================================
// BM25 FUNCTIONS
// ============================================================

describe('BM25 Functions', () => {
  describe('getEffectiveStopwords', () => {
    it('should combine default and custom stopwords', () => {
      const stopwords = getEffectiveStopwords();
      expect(stopwords.has('the')).toBe(true);
      expect(stopwords.has('note')).toBe(true);
    });

    it('should work with custom config', () => {
      const customConfig = {
        ...STOPWORDS_CONFIG,
        custom_additions: ['custom', 'word'],
      };
      const stopwords = getEffectiveStopwords(customConfig);
      expect(stopwords.has('custom')).toBe(true);
    });
  });

  describe('removeStopwords', () => {
    it('should remove stopwords from tokens', () => {
      const stopwords = new Set(['the', 'a', 'is']);
      const tokens = ['the', 'cat', 'is', 'happy'];
      const filtered = removeStopwords(tokens, stopwords);
      expect(filtered).toEqual(['cat', 'happy']);
    });

    it('should be case-insensitive', () => {
      const stopwords = new Set(['the']);
      const tokens = ['The', 'THE', 'cat'];
      const filtered = removeStopwords(tokens, stopwords);
      expect(filtered).toEqual(['cat']);
    });
  });

  describe('shouldIndexTerm', () => {
    it('should reject short terms', () => {
      expect(shouldIndexTerm('a', 10, 100)).toBe(false);
    });

    it('should reject long terms', () => {
      const longTerm = 'a'.repeat(60);
      expect(shouldIndexTerm(longTerm, 10, 100)).toBe(false);
    });

    it('should reject too-common terms', () => {
      expect(shouldIndexTerm('common', 97, 100)).toBe(false);
    });

    it('should accept valid terms', () => {
      expect(shouldIndexTerm('valid', 10, 100)).toBe(true);
    });

    it('should require at least 1 doc frequency', () => {
      expect(shouldIndexTerm('term', 0, 100)).toBe(false);
    });
  });

  describe('getFieldBoost', () => {
    it('should return correct boosts', () => {
      expect(getFieldBoost('title')).toBe(3.0);
      expect(getFieldBoost('tags')).toBe(2.5);
      expect(getFieldBoost('headers')).toBe(2.0);
      expect(getFieldBoost('body')).toBe(1.0);
      expect(getFieldBoost('metadata')).toBe(0.5);
    });
  });
});

// ============================================================
// VALIDATION FUNCTIONS
// ============================================================

describe('Validation Functions', () => {
  describe('validateRerankingWeights', () => {
    it('should validate correct weights', () => {
      expect(validateRerankingWeights(RERANKING_WEIGHTS)).toBe(true);
    });

    it('should reject invalid weights', () => {
      expect(validateRerankingWeights({ foo: 'bar' })).toBe(false);
    });
  });

  describe('validateRerankingConfig', () => {
    it('should validate correct config', () => {
      expect(validateRerankingConfig(RERANKING_CONFIG)).toBe(true);
    });
  });

  describe('validateDecayConfig', () => {
    it('should validate correct config', () => {
      expect(validateDecayConfig(DECAY_CONFIG)).toBe(true);
    });
  });

  describe('validateSSAParams', () => {
    it('should validate correct params', () => {
      expect(validateSSAParams(SSA_PARAMS)).toBe(true);
    });
  });

  describe('validateSSAEdgeWeights', () => {
    it('should validate correct weights', () => {
      expect(validateSSAEdgeWeights(SSA_EDGE_WEIGHTS)).toBe(true);
    });
  });

  describe('validateConfidenceThresholds', () => {
    it('should validate correct thresholds', () => {
      expect(validateConfidenceThresholds(CONFIDENCE_THRESHOLDS)).toBe(true);
    });
  });

  describe('validateBudgetConfig', () => {
    it('should validate correct config', () => {
      expect(validateBudgetConfig(OPERATION_BUDGETS.standard_query)).toBe(true);
    });
  });

  describe('validateAdaptiveLimits', () => {
    it('should validate correct limits', () => {
      expect(validateAdaptiveLimits(COLD_START_LIMITS)).toBe(true);
    });
  });

  describe('validateBM25Config', () => {
    it('should validate correct config', () => {
      expect(validateBM25Config(BM25_CONFIG)).toBe(true);
    });
  });

  describe('validateQualityTarget', () => {
    it('should validate correct target', () => {
      expect(validateQualityTarget(QUALITY_TARGETS.LOOKUP)).toBe(true);
    });
  });

  describe('validateGraphMetrics', () => {
    it('should validate correct metrics', () => {
      expect(validateGraphMetrics({
        total_nodes: 1000,
        total_edges: 5000,
        density: 0.005,
        avg_inbound_edges: 5,
        avg_outbound_edges: 5,
      })).toBe(true);
    });
  });
});
