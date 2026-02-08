/**
 * @module @nous/core/params
 * @description Canonical algorithm parameters for Nous - the single source of truth
 * @version 1.0.0
 * @spec Brainstorms/Specs/Phase-2-Data-Representation/storm-028
 *
 * This module implements storm-028: Algorithm Parameters & Thresholds.
 *
 * storm-028 is the AUTHORITATIVE SOURCE for all algorithm parameters.
 * Other storms should reference this module for values:
 * - storm-005 (Retrieval): Use reranking weights, SSA parameters
 * - storm-007 (Forgetting): Use decay parameters
 * - storm-008 (Classification): Use confidence thresholds
 * - storm-012 (Adaptive Limits): Use budget parameters
 */

import { z } from 'zod';

// ============================================================
// ALGORITHM NODE TYPES
// ============================================================

/**
 * Node types for algorithm behavior.
 * These are behavioral categories used for stability/difficulty,
 * distinct from storm-011's structural node types.
 */
export const ALGORITHM_NODE_TYPES = [
  'person',
  'fact',
  'concept',
  'event',
  'note',
  'document',
  'preference',
] as const;

export type AlgorithmNodeType = (typeof ALGORITHM_NODE_TYPES)[number];

// ============================================================
// RERANKING WEIGHTS
// ============================================================

/**
 * Reranking weight configuration.
 * All weights must sum to 1.0.
 */
export interface RerankingWeights {
  semantic: number;   // 0.30 - Vector similarity
  keyword: number;    // 0.15 - BM25 keyword match
  graph: number;      // 0.20 - Spreading activation
  recency: number;    // 0.15 - Time-based decay
  authority: number;  // 0.10 - Inbound edge count
  affinity: number;   // 0.10 - User interaction history
}

export const RerankingWeightsSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1),
}).refine(
  (w) => Math.abs(w.semantic + w.keyword + w.graph + w.recency + w.authority + w.affinity - 1.0) < 0.001,
  { message: 'Reranking weights must sum to 1.0' }
);

/**
 * Default reranking weights.
 */
export const RERANKING_WEIGHTS: RerankingWeights = {
  semantic: 0.30,
  keyword: 0.15,
  graph: 0.20,
  recency: 0.15,
  authority: 0.10,
  affinity: 0.10,
};

/**
 * Reranking behavior configuration.
 */
export interface RerankingConfig {
  recency_half_life_days: number;
  authority_cap_multiple: number;
  affinity_saturation: number;
  new_content_boost_days: number;
  new_content_boost_value: number;
}

export const RerankingConfigSchema = z.object({
  recency_half_life_days: z.number().positive(),
  authority_cap_multiple: z.number().positive(),
  affinity_saturation: z.number().positive(),
  new_content_boost_days: z.number().int().nonnegative(),
  new_content_boost_value: z.number().min(0).max(1),
});

export const RERANKING_CONFIG: RerankingConfig = {
  recency_half_life_days: 30,
  authority_cap_multiple: 2.0,
  affinity_saturation: 10,
  new_content_boost_days: 7,
  new_content_boost_value: 0.2,
};

/**
 * Per-signal score breakdown.
 */
export interface ScoreBreakdown {
  semantic: number;
  keyword: number;
  graph: number;
  recency: number;
  authority: number;
  affinity: number;
}

export const ScoreBreakdownSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1),
});

/**
 * Scored node input for reranking.
 */
export interface ScoredNode {
  id: string;
  semantic_score?: number;
  bm25_score?: number;
  graph_score?: number;
  last_accessed: Date;
  created_at: Date;
  access_count: number;
  inbound_edge_count: number;
}

export const ScoredNodeSchema = z.object({
  id: z.string(),
  semantic_score: z.number().min(0).max(1).optional(),
  bm25_score: z.number().nonnegative().optional(),
  graph_score: z.number().min(0).max(1).optional(),
  last_accessed: z.date(),
  created_at: z.date(),
  access_count: z.number().int().nonnegative(),
  inbound_edge_count: z.number().int().nonnegative(),
});

/**
 * Graph metrics for reranking context.
 */
export interface GraphMetrics {
  total_nodes: number;
  total_edges: number;
  density: number;
  avg_inbound_edges: number;
  avg_outbound_edges: number;
}

export const GraphMetricsSchema = z.object({
  total_nodes: z.number().int().nonnegative(),
  total_edges: z.number().int().nonnegative(),
  density: z.number().min(0).max(1),
  avg_inbound_edges: z.number().nonnegative(),
  avg_outbound_edges: z.number().nonnegative(),
});

/**
 * Ranked node result.
 */
export interface RankedNode {
  node: ScoredNode;
  score: number;
  breakdown: ScoreBreakdown;
  primary_signal: keyof ScoreBreakdown;
}

// ============================================================
// DECAY CONFIGURATION
// ============================================================

/**
 * Decay behavior configuration (FSRS-inspired).
 */
export interface DecayConfig {
  growth_rate: number;            // 2.5 - Stability multiplier on access
  max_stability_days: number;     // 365 - Cap at 1 year
  active_threshold: number;       // 0.5 - R > 0.5 = ACTIVE
  weak_threshold: number;         // 0.1 - R 0.1-0.5 = WEAK, R < 0.1 = DORMANT
  dormant_days: number;           // 60 - Days at R < 0.1 before dormant status
  compress_days: number;          // 120 - Days before compression eligible
  archive_days: number;           // 240 - Days before archive eligible
  cascade_factor: number;         // 0.8 - Edge weakening on dormant
  edge_floor: number;             // 0.1 - Minimum edge strength
}

export const DecayConfigSchema = z.object({
  growth_rate: z.number().positive(),
  max_stability_days: z.number().int().positive(),
  active_threshold: z.number().min(0).max(1),
  weak_threshold: z.number().min(0).max(1),
  dormant_days: z.number().int().nonnegative(),
  compress_days: z.number().int().nonnegative(),
  archive_days: z.number().int().nonnegative(),
  cascade_factor: z.number().min(0).max(1),
  edge_floor: z.number().min(0).max(1),
});

export const DECAY_CONFIG: DecayConfig = {
  growth_rate: 2.5,
  max_stability_days: 365,
  active_threshold: 0.5,
  weak_threshold: 0.1,
  dormant_days: 60,
  compress_days: 120,
  archive_days: 240,
  cascade_factor: 0.8,
  edge_floor: 0.1,
};

/**
 * Initial stability per algorithm node type (days).
 */
export const INITIAL_STABILITY: Record<AlgorithmNodeType, number> = {
  person: 14,
  fact: 7,
  concept: 21,
  event: 10,
  note: 30,
  document: 7,
  preference: 45,
};

/**
 * Initial difficulty per algorithm node type (0-1).
 */
export const INITIAL_DIFFICULTY: Record<AlgorithmNodeType, number> = {
  person: 0.2,
  fact: 0.3,
  concept: 0.4,
  event: 0.3,
  note: 0.2,
  document: 0.5,
  preference: 0.1,
};

/**
 * Decay-based lifecycle states for memory retrieval.
 * NOTE: These are distinct from storm-011's content lifecycle states.
 * These states are used by the forgetting model (storm-007) for decay calculations.
 */
export const DECAY_LIFECYCLE_STATES = ['ACTIVE', 'WEAK', 'DORMANT', 'COMPRESS', 'ARCHIVE'] as const;
export type DecayLifecycleState = (typeof DECAY_LIFECYCLE_STATES)[number];

// ============================================================
// SSA PARAMETERS
// ============================================================

/**
 * SSA aggregation modes.
 */
export type SSAAggregation = 'sum' | 'max';

/**
 * Spreading activation parameters.
 */
export interface SSAParams {
  initial_activation: number;   // 1.0 - Seeds start at full
  hop_decay: number;            // 0.5 - 50% loss per hop
  min_threshold: number;        // 0.05 - Stop spreading below 5%
  max_hops: number;             // 3 - Hard limit
  max_nodes: number;            // 500 - Breadth limit
  aggregation: SSAAggregation;  // 'sum' - Allow path reinforcement
}

export const SSAParamsSchema = z.object({
  initial_activation: z.number().min(0).max(1),
  hop_decay: z.number().min(0).max(1),
  min_threshold: z.number().min(0).max(1),
  max_hops: z.number().int().positive(),
  max_nodes: z.number().int().positive(),
  aggregation: z.enum(['sum', 'max']),
});

export const SSA_PARAMS: SSAParams = {
  initial_activation: 1.0,
  hop_decay: 0.5,
  min_threshold: 0.05,
  max_hops: 3,
  max_nodes: 500,
  aggregation: 'sum',
};

/**
 * Edge weights for SSA.
 * NOTE: These reference storm-031's edge weights but are defined here
 * as the canonical SSA values.
 */
export interface SSAEdgeWeights {
  same_entity: number;
  part_of: number;
  caused_by: number;
  mentioned_together: number;
  related_to: number;
  similar_to: number;
  user_linked: number;
  temporal_adjacent: number;
}

export const SSAEdgeWeightsSchema = z.object({
  same_entity: z.number().min(0).max(1),
  part_of: z.number().min(0).max(1),
  caused_by: z.number().min(0).max(1),
  mentioned_together: z.number().min(0).max(1),
  related_to: z.number().min(0).max(1),
  similar_to: z.number().min(0).max(1),
  user_linked: z.number().min(0).max(1),
  temporal_adjacent: z.number().min(0).max(1),
});

export const SSA_EDGE_WEIGHTS: SSAEdgeWeights = {
  same_entity: 0.95,
  part_of: 0.85,
  caused_by: 0.80,
  mentioned_together: 0.60,
  related_to: 0.50,
  similar_to: 0.45,
  user_linked: 0.90,
  temporal_adjacent: 0.40,
};

/**
 * Activated node result from SSA.
 */
export interface ActivatedNode {
  id: string;
  activation: number;
  path: string[];
}

export const ActivatedNodeSchema = z.object({
  id: z.string(),
  activation: z.number().min(0).max(1),
  path: z.array(z.string()),
});

// ============================================================
// CONFIDENCE THRESHOLDS
// ============================================================

/**
 * Confidence threshold categories.
 */
export interface ConfidenceThresholds {
  retrieval: {
    high: number;     // 0.70 - Answer directly
    medium: number;   // 0.45 - May need context
    low: number;      // 0.45 - Below this, clarify
  };
  classification: {
    clear_lookup: number;    // 0.85 - Definitely a simple lookup
    clear_reasoning: number; // 0.85 - Definitely needs reasoning
    ambiguous_floor: number; // 0.50 - Below this is REASONING
  };
  extraction: {
    auto_store: number;    // 0.85 - Store without asking
    confirm_store: number; // 0.60 - Ask user to confirm
  };
  contradiction: {
    definite: number;  // 0.85 - Flag for user
    possible: number;  // 0.60 - Note internally
  };
}

export const ConfidenceThresholdsSchema = z.object({
  retrieval: z.object({
    high: z.number().min(0).max(1),
    medium: z.number().min(0).max(1),
    low: z.number().min(0).max(1),
  }),
  classification: z.object({
    clear_lookup: z.number().min(0).max(1),
    clear_reasoning: z.number().min(0).max(1),
    ambiguous_floor: z.number().min(0).max(1),
  }),
  extraction: z.object({
    auto_store: z.number().min(0).max(1),
    confirm_store: z.number().min(0).max(1),
  }),
  contradiction: z.object({
    definite: z.number().min(0).max(1),
    possible: z.number().min(0).max(1),
  }),
});

export const CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  retrieval: {
    high: 0.70,
    medium: 0.45,
    low: 0.45,
  },
  classification: {
    clear_lookup: 0.85,
    clear_reasoning: 0.85,
    ambiguous_floor: 0.50,
  },
  extraction: {
    auto_store: 0.85,
    confirm_store: 0.60,
  },
  contradiction: {
    definite: 0.85,
    possible: 0.60,
  },
};

/**
 * Confidence levels.
 */
export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/**
 * Retrieval Confidence System weights.
 */
export interface RCSWeights {
  match_quality: number;     // 0.40
  distinctiveness: number;   // 0.35
  completeness: number;      // 0.25
}

export const RCSWeightsSchema = z.object({
  match_quality: z.number().min(0).max(1),
  distinctiveness: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1),
});

export const RCS_WEIGHTS: RCSWeights = {
  match_quality: 0.40,
  distinctiveness: 0.35,
  completeness: 0.25,
};

/**
 * Retrieval confidence result.
 */
export interface RetrievalConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  breakdown: { mq: number; dt: number; cm: number };
  flags: string[];
}

export const RetrievalConfidenceResultSchema = z.object({
  score: z.number().min(0).max(1),
  level: z.enum(CONFIDENCE_LEVELS),
  breakdown: z.object({
    mq: z.number().min(0).max(1),
    dt: z.number().min(0).max(1),
    cm: z.number().min(0).max(1),
  }),
  flags: z.array(z.string()),
});

/**
 * Contradiction detection levels.
 */
export const CONTRADICTION_LEVELS = ['definite', 'possible', 'none'] as const;
export type ContradictionLevel = (typeof CONTRADICTION_LEVELS)[number];

/**
 * Contradiction detection result.
 */
export interface ContradictionResult {
  level: ContradictionLevel;
  score: number;
  action: 'flag_user' | 'note_internal' | 'safe_to_store';
  explanation: string;
}

export const ContradictionResultSchema = z.object({
  level: z.enum(CONTRADICTION_LEVELS),
  score: z.number().min(0).max(1),
  action: z.enum(['flag_user', 'note_internal', 'safe_to_store']),
  explanation: z.string(),
});

// ============================================================
// ADAPTIVE LIMITS
// ============================================================

/**
 * Budget configuration per operation.
 */
export interface BudgetConfig {
  time_ms: number;
  max_nodes: number;
  max_api_calls: number;
}

export const BudgetConfigSchema = z.object({
  time_ms: z.number().nonnegative(),
  max_nodes: z.number().int().nonnegative(),
  max_api_calls: z.number().int().nonnegative(),
});

export const OPERATION_BUDGETS: Record<string, BudgetConfig> = {
  simple_lookup: { time_ms: 50, max_nodes: 100, max_api_calls: 0 },
  standard_query: { time_ms: 100, max_nodes: 500, max_api_calls: 0 },
  complex_query: { time_ms: 200, max_nodes: 1000, max_api_calls: 0 },
  phase2_reasoning: { time_ms: 3000, max_nodes: 500, max_api_calls: 5 },
  deep_search: { time_ms: 500, max_nodes: 2000, max_api_calls: 0 },
  serendipity: { time_ms: 200, max_nodes: 200, max_api_calls: 0 },
};

/**
 * Quality target per query type.
 */
export interface QualityTarget {
  confidence: number;
  min_coverage: number;
}

export const QualityTargetSchema = z.object({
  confidence: z.number().min(0).max(1),
  min_coverage: z.number().min(0).max(1),
});

export const QUALITY_TARGETS: Record<string, QualityTarget> = {
  LOOKUP: { confidence: 0.80, min_coverage: 0.60 },
  REASONING: { confidence: 0.70, min_coverage: 0.70 },
  EXPLORATORY: { confidence: 0.50, min_coverage: 0.40 },
  TEMPORAL: { confidence: 0.75, min_coverage: 0.65 },
};

/**
 * Quality score weights.
 */
export interface QualityWeights {
  coverage: number;
  match_quality: number;
  convergence: number;
}

export const QualityWeightsSchema = z.object({
  coverage: z.number().min(0).max(1),
  match_quality: z.number().min(0).max(1),
  convergence: z.number().min(0).max(1),
});

export const QUALITY_WEIGHTS: QualityWeights = {
  coverage: 0.35,
  match_quality: 0.45,
  convergence: 0.20,
};

/**
 * Cold start threshold (node count).
 */
export const COLD_START_THRESHOLD = 200;

/**
 * Adaptive limits configuration.
 */
export interface AdaptiveLimits {
  entry_points: number;
  max_hops: number;
  max_nodes: number;
}

export const AdaptiveLimitsSchema = z.object({
  entry_points: z.number().int().positive(),
  max_hops: z.number().int().positive(),
  max_nodes: z.number().int().positive(),
});

export const COLD_START_LIMITS: AdaptiveLimits = {
  entry_points: 2,
  max_hops: 3,
  max_nodes: 50,
};

/**
 * Query types for adaptive limits.
 */
export const QUERY_TYPES = ['simple', 'standard', 'complex'] as const;
export type QueryType = (typeof QUERY_TYPES)[number];

/**
 * Termination result.
 */
export interface TerminationResult {
  terminate: boolean;
  reason: string;
}

export const TerminationResultSchema = z.object({
  terminate: z.boolean(),
  reason: z.string(),
});

// ============================================================
// BM25 CONFIGURATION
// ============================================================

/**
 * Stemmer types.
 */
export type StemmerType = 'porter' | 'snowball' | 'none';

/**
 * BM25 core configuration.
 */
export interface BM25Config {
  k1: number;                     // 1.2 - Term frequency saturation
  b: number;                      // 0.75 - Document length normalization
  min_term_length: number;        // 2
  max_term_length: number;        // 50
  max_doc_frequency_ratio: number; // 0.95
  stemmer: StemmerType;
  preserve_original: boolean;
}

export const BM25ConfigSchema = z.object({
  k1: z.number().positive(),
  b: z.number().min(0).max(1),
  min_term_length: z.number().int().positive(),
  max_term_length: z.number().int().positive(),
  max_doc_frequency_ratio: z.number().min(0).max(1),
  stemmer: z.enum(['porter', 'snowball', 'none']),
  preserve_original: z.boolean(),
});

export const BM25_CONFIG: BM25Config = {
  k1: 1.2,
  b: 0.75,
  min_term_length: 2,
  max_term_length: 50,
  max_doc_frequency_ratio: 0.95,
  stemmer: 'porter',
  preserve_original: true,
};

/**
 * Field types for boosting.
 */
export type FieldType = 'title' | 'tags' | 'headers' | 'body' | 'metadata';

/**
 * Field boost configuration.
 */
export interface FieldBoost {
  field: FieldType;
  boost: number;
}

export const FieldBoostSchema = z.object({
  field: z.enum(['title', 'tags', 'headers', 'body', 'metadata']),
  boost: z.number().positive(),
});

export const FIELD_BOOSTS: FieldBoost[] = [
  { field: 'title', boost: 3.0 },
  { field: 'tags', boost: 2.5 },
  { field: 'headers', boost: 2.0 },
  { field: 'body', boost: 1.0 },
  { field: 'metadata', boost: 0.5 },
];

/**
 * Stopwords behavior.
 */
export type StopwordsBehavior = 'remove_from_query' | 'remove_from_both' | 'keep_for_phrases';

/**
 * Stopwords configuration.
 */
export interface StopwordsConfig {
  language: string;
  default_list: string[];
  custom_additions: string[];
  behavior: StopwordsBehavior;
}

export const StopwordsConfigSchema = z.object({
  language: z.string(),
  default_list: z.array(z.string()),
  custom_additions: z.array(z.string()),
  behavior: z.enum(['remove_from_query', 'remove_from_both', 'keep_for_phrases']),
});

export const STOPWORDS_CONFIG: StopwordsConfig = {
  language: 'en',
  default_list: [
    'a', 'an', 'the',
    'and', 'or', 'but',
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
    'is', 'was', 'are', 'were', 'been', 'be',
    'have', 'has', 'had',
    'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
    'this', 'that', 'these', 'those',
    'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  ],
  custom_additions: [
    'note', 'notes',
    'idea', 'ideas',
    'thought', 'thoughts',
    'todo', 'item', 'entry',
  ],
  behavior: 'remove_from_query',
};

// ============================================================
// MASTER ALGORITHM PARAMS
// ============================================================

/**
 * Master algorithm parameters aggregation.
 */
export interface AlgorithmParams {
  reranking: {
    weights: RerankingWeights;
    config: RerankingConfig;
  };
  decay: {
    config: DecayConfig;
    initial_stability: Record<AlgorithmNodeType, number>;
    initial_difficulty: Record<AlgorithmNodeType, number>;
  };
  ssa: {
    params: SSAParams;
    edge_weights: SSAEdgeWeights;
  };
  confidence: {
    thresholds: ConfidenceThresholds;
    rcs_weights: RCSWeights;
  };
  adaptive: {
    budgets: Record<string, BudgetConfig>;
    quality_targets: Record<string, QualityTarget>;
    quality_weights: QualityWeights;
    cold_start_threshold: number;
    cold_start_limits: AdaptiveLimits;
  };
  bm25: {
    config: BM25Config;
    field_boosts: FieldBoost[];
    stopwords: StopwordsConfig;
  };
}

/**
 * The canonical algorithm parameters object.
 * This is THE single source of truth for all algorithm parameters.
 */
export const ALGORITHM_PARAMS: AlgorithmParams = {
  reranking: {
    weights: RERANKING_WEIGHTS,
    config: RERANKING_CONFIG,
  },
  decay: {
    config: DECAY_CONFIG,
    initial_stability: INITIAL_STABILITY,
    initial_difficulty: INITIAL_DIFFICULTY,
  },
  ssa: {
    params: SSA_PARAMS,
    edge_weights: SSA_EDGE_WEIGHTS,
  },
  confidence: {
    thresholds: CONFIDENCE_THRESHOLDS,
    rcs_weights: RCS_WEIGHTS,
  },
  adaptive: {
    budgets: OPERATION_BUDGETS,
    quality_targets: QUALITY_TARGETS,
    quality_weights: QUALITY_WEIGHTS,
    cold_start_threshold: COLD_START_THRESHOLD,
    cold_start_limits: COLD_START_LIMITS,
  },
  bm25: {
    config: BM25_CONFIG,
    field_boosts: FIELD_BOOSTS,
    stopwords: STOPWORDS_CONFIG,
  },
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Calculates days between two dates.
 */
function daysBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

// ============================================================
// RERANKING FUNCTIONS
// ============================================================

/**
 * Gets semantic score from node.
 */
export function semanticScore(node: ScoredNode): number {
  return node.semantic_score ?? 0;
}

/**
 * Normalizes BM25 score against batch max.
 */
export function keywordScore(node: ScoredNode, maxBM25: number, candidateCount: number): number {
  if (maxBM25 === 0) return 0.5;
  if (candidateCount === 1) return 1.0;
  return (node.bm25_score ?? 0) / maxBM25;
}

/**
 * Gets graph score from node.
 */
export function graphScore(node: ScoredNode): number {
  return node.graph_score ?? 0;
}

/**
 * Calculates recency score using exponential decay.
 */
export function recencyScore(lastAccessed: Date, now: Date = new Date()): number {
  const daysSince = daysBetween(lastAccessed, now);
  return Math.exp(-daysSince / RERANKING_CONFIG.recency_half_life_days);
}

/**
 * Calculates authority score based on inbound edges.
 */
export function authorityScore(inboundEdges: number, avgInbound: number): number {
  if (avgInbound === 0) return 0.5;
  const ratio = inboundEdges / avgInbound;
  return Math.min(ratio / RERANKING_CONFIG.authority_cap_multiple, 1.0);
}

/**
 * Calculates affinity score based on interaction history.
 */
export function affinityScore(
  accessCount: number,
  createdAt: Date,
  lastAccessed: Date,
  now: Date = new Date()
): number {
  const recency = recencyScore(lastAccessed, now);
  const interactionScore = Math.tanh(accessCount / RERANKING_CONFIG.affinity_saturation) * recency;

  const ageDays = daysBetween(createdAt, now);
  const newContentBoost = ageDays < RERANKING_CONFIG.new_content_boost_days
    ? RERANKING_CONFIG.new_content_boost_value
    : 0;

  return Math.min(interactionScore + newContentBoost, 1.0);
}

/**
 * Reranks candidates using all 6 signals.
 */
export function rerankCandidates(
  candidates: ScoredNode[],
  metrics: GraphMetrics,
  weights: RerankingWeights = RERANKING_WEIGHTS,
  now: Date = new Date()
): RankedNode[] {
  if (candidates.length === 0) return [];

  const maxBM25 = Math.max(...candidates.map(c => c.bm25_score ?? 0));

  return candidates.map(node => {
    const breakdown: ScoreBreakdown = {
      semantic: semanticScore(node),
      keyword: keywordScore(node, maxBM25, candidates.length),
      graph: graphScore(node),
      recency: recencyScore(node.last_accessed, now),
      authority: authorityScore(node.inbound_edge_count, metrics.avg_inbound_edges),
      affinity: affinityScore(node.access_count, node.created_at, node.last_accessed, now),
    };

    const score =
      weights.semantic * breakdown.semantic +
      weights.keyword * breakdown.keyword +
      weights.graph * breakdown.graph +
      weights.recency * breakdown.recency +
      weights.authority * breakdown.authority +
      weights.affinity * breakdown.affinity;

    const contributions = Object.entries(breakdown).map(([key, value]) => ({
      key: key as keyof ScoreBreakdown,
      contribution: weights[key as keyof RerankingWeights] * value
    }));
    const primary = contributions.reduce((a, b) =>
      b.contribution > a.contribution ? b : a
    ).key;

    return { node, score, breakdown, primary_signal: primary };
  }).sort((a, b) => b.score - a.score);
}

// ============================================================
// DECAY FUNCTIONS
// ============================================================

/**
 * Calculates retrievability using exponential decay.
 * R = e^(-t/S)
 */
export function calculateRetrievability(daysSinceAccess: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.exp(-daysSinceAccess / stability);
}

/**
 * Calculates difficulty based on node characteristics.
 */
export function calculateDifficulty(
  type: AlgorithmNodeType,
  contentLength: number,
  edgeCount: number
): number {
  const baseDifficulty = INITIAL_DIFFICULTY[type] ?? 0.3;
  const lengthFactor = Math.min(contentLength / 5000, 1) * 0.15;
  const abstractionFactor = type === 'concept' ? 0.1 : 0;
  const connectionBonus = -Math.min(edgeCount / 40, 1) * 0.15;

  return Math.max(0, Math.min(1,
    baseDifficulty + lengthFactor + abstractionFactor + connectionBonus
  ));
}

/**
 * Updates stability on access.
 */
export function updateStabilityOnAccess(stability: number, difficulty: number): number {
  const difficultyFactor = 1 - (difficulty * 0.5);
  return Math.min(
    stability * DECAY_CONFIG.growth_rate * difficultyFactor,
    DECAY_CONFIG.max_stability_days
  );
}

/**
 * Gets decay lifecycle state based on retrievability.
 */
export function getDecayLifecycleState(retrievability: number, daysDormant: number): DecayLifecycleState {
  if (retrievability > DECAY_CONFIG.active_threshold) return 'ACTIVE';
  if (retrievability > DECAY_CONFIG.weak_threshold) return 'WEAK';
  if (daysDormant < DECAY_CONFIG.dormant_days) return 'DORMANT';
  if (daysDormant < DECAY_CONFIG.compress_days) return 'DORMANT';
  if (daysDormant < DECAY_CONFIG.archive_days) return 'COMPRESS';
  return 'ARCHIVE';
}

/**
 * Applies cascade decay to edge weight.
 */
export function applyCascadeDecay(edgeWeight: number, retrievability: number): number {
  if (retrievability >= DECAY_CONFIG.weak_threshold) {
    return edgeWeight;
  }
  return Math.max(edgeWeight * DECAY_CONFIG.cascade_factor, DECAY_CONFIG.edge_floor);
}

/**
 * Gets initial stability for a node type.
 */
export function getInitialStability(type: AlgorithmNodeType): number {
  return INITIAL_STABILITY[type] ?? 14;
}

/**
 * Gets initial difficulty for a node type.
 */
export function getInitialDifficulty(type: AlgorithmNodeType): number {
  return INITIAL_DIFFICULTY[type] ?? 0.3;
}

// ============================================================
// CONFIDENCE FUNCTIONS
// ============================================================

/**
 * Calculates retrieval confidence using RCS.
 */
export function calculateRetrievalConfidence(
  topScore: number,
  secondScore: number | null,
  resultCount: number,
  hasAttribute: boolean
): RetrievalConfidenceResult {
  if (resultCount === 0) {
    return {
      score: 0,
      level: 'LOW',
      breakdown: { mq: 0, dt: 0, cm: 0 },
      flags: ['no_results'],
    };
  }

  const MQ = topScore;

  const scoreGap = secondScore !== null ? topScore - secondScore : 1.0;
  const gapNormalized = Math.min(scoreGap / 0.3, 1.0);
  let focus: number;
  if (resultCount === 1) focus = 1.0;
  else if (resultCount <= 5) focus = 0.8;
  else if (resultCount <= 15) focus = 0.5;
  else focus = 0.3;
  const DT = gapNormalized * 0.5 + focus * 0.5;

  const CM = hasAttribute ? 1.0 : 0.5;

  const MQ_safe = Math.max(MQ, 0.1);
  const DT_safe = Math.max(DT, 0.1);
  const CM_safe = Math.max(CM, 0.1);

  let score = Math.pow(MQ_safe, RCS_WEIGHTS.match_quality) *
              Math.pow(DT_safe, RCS_WEIGHTS.distinctiveness) *
              Math.pow(CM_safe, RCS_WEIGHTS.completeness);

  if (MQ < 0.3) score = Math.min(score, 0.4);
  if (DT < 0.2) score = Math.min(score, 0.4);
  if (!hasAttribute) score = Math.min(score, 0.7);

  const flags: string[] = [];
  if (resultCount > 1 && scoreGap < 0.15) flags.push('disambiguation_needed');
  if (resultCount < 3 && MQ < 0.6) flags.push('sparse_results');
  if (!hasAttribute) flags.push('attribute_unknown');
  if (MQ > 0.95 && DT > 0.8 && hasAttribute) flags.push('perfect_match');

  const level = getConfidenceLevel(score);

  return { score, level, breakdown: { mq: MQ, dt: DT, cm: CM }, flags };
}

/**
 * Gets confidence level from score.
 */
export function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.retrieval.high) return 'HIGH';
  if (score >= CONFIDENCE_THRESHOLDS.retrieval.medium) return 'MEDIUM';
  return 'LOW';
}

/**
 * Detects contradiction between new and existing information.
 */
export function detectContradiction(
  similarity: number,
  logicalConflict: number,
  daysSinceExisting: number
): ContradictionResult {
  const supersessionLikelihood = daysSinceExisting > 90 ? 0.3 : 0;

  const score = Math.max(0, Math.min(1,
    similarity * 0.4 + logicalConflict * 0.5 - supersessionLikelihood
  ));

  if (score >= CONFIDENCE_THRESHOLDS.contradiction.definite) {
    return {
      level: 'definite',
      score,
      action: 'flag_user',
      explanation: `High conflict detected (${(score * 100).toFixed(0)}%): new info may contradict existing knowledge`,
    };
  }

  if (score >= CONFIDENCE_THRESHOLDS.contradiction.possible) {
    return {
      level: 'possible',
      score,
      action: 'note_internal',
      explanation: `Moderate conflict (${(score * 100).toFixed(0)}%): noted for potential review`,
    };
  }

  return {
    level: 'none',
    score,
    action: 'safe_to_store',
    explanation: 'No significant conflict detected',
  };
}

// ============================================================
// ADAPTIVE LIMIT FUNCTIONS
// ============================================================

/**
 * Calculates adaptive limits based on graph characteristics.
 */
export function calculateAdaptiveLimits(
  graphSize: number,
  graphDensity: number,
  queryType: QueryType
): AdaptiveLimits {
  if (graphSize < COLD_START_THRESHOLD) {
    return {
      ...COLD_START_LIMITS,
      max_nodes: Math.min(COLD_START_LIMITS.max_nodes, Math.ceil(graphSize * 0.5)),
    };
  }

  const entryPoints = Math.max(2, Math.min(5, Math.ceil(Math.log10(graphSize))));

  let maxHops: number;
  if (graphDensity < 0.001) maxHops = 5;
  else if (graphDensity < 0.01) maxHops = 4;
  else if (graphDensity < 0.05) maxHops = 3;
  else maxHops = 2;

  const percentageMap: Record<QueryType, number> = {
    simple: 0.02,
    standard: 0.05,
    complex: 0.10,
  };
  const percentage = percentageMap[queryType];

  const budgetKey = `${queryType}_query`;
  const budgetLookup = OPERATION_BUDGETS[budgetKey];
  const budget = budgetLookup ?? OPERATION_BUDGETS['standard_query']!;

  const maxNodes = Math.max(
    50,
    Math.min(Math.ceil(graphSize * percentage), budget.max_nodes)
  );

  return { entry_points: entryPoints, max_hops: maxHops, max_nodes: maxNodes };
}

/**
 * Calculates quality score from components.
 */
export function calculateQualityScore(
  coverage: number,
  matchQuality: number,
  convergence: number
): number {
  return (
    coverage * QUALITY_WEIGHTS.coverage +
    matchQuality * QUALITY_WEIGHTS.match_quality +
    convergence * QUALITY_WEIGHTS.convergence
  );
}

/**
 * Determines if search should terminate.
 */
export function shouldTerminate(
  currentQuality: number,
  targetQuality: number,
  convergence: number,
  lowConvergenceSteps: number,
  remainingBudget: BudgetConfig
): TerminationResult {
  if (currentQuality >= targetQuality) {
    return { terminate: true, reason: 'quality_target_met' };
  }
  if (convergence < 0.02 && lowConvergenceSteps >= 2) {
    return { terminate: true, reason: 'converged' };
  }
  if (remainingBudget.time_ms <= 0) {
    return { terminate: true, reason: 'time_exhausted' };
  }
  if (remainingBudget.max_nodes <= 0) {
    return { terminate: true, reason: 'node_limit_reached' };
  }
  return { terminate: false, reason: '' };
}

/**
 * Gets budget for an operation.
 */
export function getBudgetForOperation(operation: string): BudgetConfig {
  const budget = OPERATION_BUDGETS[operation];
  return budget ?? OPERATION_BUDGETS['standard_query']!;
}

/**
 * Gets quality target for a query type.
 */
export function getQualityTargetForQueryType(queryType: string): QualityTarget {
  const target = QUALITY_TARGETS[queryType];
  return target ?? QUALITY_TARGETS['REASONING']!;
}

// ============================================================
// BM25 FUNCTIONS
// ============================================================

/**
 * Gets effective stopwords set.
 */
export function getEffectiveStopwords(config: StopwordsConfig = STOPWORDS_CONFIG): Set<string> {
  return new Set([...config.default_list, ...config.custom_additions]);
}

/**
 * Removes stopwords from tokens.
 */
export function removeStopwords(tokens: string[], stopwords: Set<string>): string[] {
  return tokens.filter(token => !stopwords.has(token.toLowerCase()));
}

/**
 * Determines if a term should be indexed.
 */
export function shouldIndexTerm(
  term: string,
  docFrequency: number,
  totalDocs: number,
  config: BM25Config = BM25_CONFIG
): boolean {
  if (term.length < config.min_term_length) return false;
  if (term.length > config.max_term_length) return false;
  if (docFrequency < 1) return false;
  if (totalDocs === 0) return docFrequency >= 1;
  const frequencyRatio = docFrequency / totalDocs;
  if (frequencyRatio > config.max_doc_frequency_ratio) return false;
  return true;
}

/**
 * Gets field boost for a field type.
 */
export function getFieldBoost(field: FieldType): number {
  const boost = FIELD_BOOSTS.find(fb => fb.field === field);
  return boost?.boost ?? 1.0;
}

// ============================================================
// VALIDATION FUNCTIONS
// ============================================================

export function validateRerankingWeights(weights: unknown): weights is RerankingWeights {
  return RerankingWeightsSchema.safeParse(weights).success;
}

export function validateRerankingConfig(config: unknown): config is RerankingConfig {
  return RerankingConfigSchema.safeParse(config).success;
}

export function validateDecayConfig(config: unknown): config is DecayConfig {
  return DecayConfigSchema.safeParse(config).success;
}

export function validateSSAParams(params: unknown): params is SSAParams {
  return SSAParamsSchema.safeParse(params).success;
}

export function validateSSAEdgeWeights(weights: unknown): weights is SSAEdgeWeights {
  return SSAEdgeWeightsSchema.safeParse(weights).success;
}

export function validateConfidenceThresholds(thresholds: unknown): thresholds is ConfidenceThresholds {
  return ConfidenceThresholdsSchema.safeParse(thresholds).success;
}

export function validateBudgetConfig(config: unknown): config is BudgetConfig {
  return BudgetConfigSchema.safeParse(config).success;
}

export function validateAdaptiveLimits(limits: unknown): limits is AdaptiveLimits {
  return AdaptiveLimitsSchema.safeParse(limits).success;
}

export function validateBM25Config(config: unknown): config is BM25Config {
  return BM25ConfigSchema.safeParse(config).success;
}

export function validateQualityTarget(target: unknown): target is QualityTarget {
  return QualityTargetSchema.safeParse(target).success;
}

export function validateGraphMetrics(metrics: unknown): metrics is GraphMetrics {
  return GraphMetricsSchema.safeParse(metrics).success;
}
