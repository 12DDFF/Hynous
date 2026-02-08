import { z } from 'zod';

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

/**
 * Node types for algorithm behavior.
 * These are behavioral categories used for stability/difficulty,
 * distinct from storm-011's structural node types.
 */
declare const ALGORITHM_NODE_TYPES: readonly ["person", "fact", "concept", "event", "note", "document", "preference"];
type AlgorithmNodeType = (typeof ALGORITHM_NODE_TYPES)[number];
/**
 * Reranking weight configuration.
 * All weights must sum to 1.0.
 */
interface RerankingWeights {
    semantic: number;
    keyword: number;
    graph: number;
    recency: number;
    authority: number;
    affinity: number;
}
declare const RerankingWeightsSchema: z.ZodEffects<z.ZodObject<{
    semantic: z.ZodNumber;
    keyword: z.ZodNumber;
    graph: z.ZodNumber;
    recency: z.ZodNumber;
    authority: z.ZodNumber;
    affinity: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    semantic: number;
    graph: number;
    keyword: number;
    recency: number;
    authority: number;
    affinity: number;
}, {
    semantic: number;
    graph: number;
    keyword: number;
    recency: number;
    authority: number;
    affinity: number;
}>, {
    semantic: number;
    graph: number;
    keyword: number;
    recency: number;
    authority: number;
    affinity: number;
}, {
    semantic: number;
    graph: number;
    keyword: number;
    recency: number;
    authority: number;
    affinity: number;
}>;
/**
 * Default reranking weights.
 */
declare const RERANKING_WEIGHTS: RerankingWeights;
/**
 * Reranking behavior configuration.
 */
interface RerankingConfig {
    recency_half_life_days: number;
    authority_cap_multiple: number;
    affinity_saturation: number;
    new_content_boost_days: number;
    new_content_boost_value: number;
}
declare const RerankingConfigSchema: z.ZodObject<{
    recency_half_life_days: z.ZodNumber;
    authority_cap_multiple: z.ZodNumber;
    affinity_saturation: z.ZodNumber;
    new_content_boost_days: z.ZodNumber;
    new_content_boost_value: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    recency_half_life_days: number;
    authority_cap_multiple: number;
    affinity_saturation: number;
    new_content_boost_days: number;
    new_content_boost_value: number;
}, {
    recency_half_life_days: number;
    authority_cap_multiple: number;
    affinity_saturation: number;
    new_content_boost_days: number;
    new_content_boost_value: number;
}>;
declare const RERANKING_CONFIG: RerankingConfig;
/**
 * Per-signal score breakdown.
 */
interface ScoreBreakdown {
    semantic: number;
    keyword: number;
    graph: number;
    recency: number;
    authority: number;
    affinity: number;
}
declare const ScoreBreakdownSchema: z.ZodObject<{
    semantic: z.ZodNumber;
    keyword: z.ZodNumber;
    graph: z.ZodNumber;
    recency: z.ZodNumber;
    authority: z.ZodNumber;
    affinity: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    semantic: number;
    graph: number;
    keyword: number;
    recency: number;
    authority: number;
    affinity: number;
}, {
    semantic: number;
    graph: number;
    keyword: number;
    recency: number;
    authority: number;
    affinity: number;
}>;
/**
 * Scored node input for reranking.
 */
interface ScoredNode {
    id: string;
    semantic_score?: number;
    bm25_score?: number;
    graph_score?: number;
    last_accessed: Date;
    created_at: Date;
    access_count: number;
    inbound_edge_count: number;
}
declare const ScoredNodeSchema: z.ZodObject<{
    id: z.ZodString;
    semantic_score: z.ZodOptional<z.ZodNumber>;
    bm25_score: z.ZodOptional<z.ZodNumber>;
    graph_score: z.ZodOptional<z.ZodNumber>;
    last_accessed: z.ZodDate;
    created_at: z.ZodDate;
    access_count: z.ZodNumber;
    inbound_edge_count: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: Date;
    last_accessed: Date;
    access_count: number;
    inbound_edge_count: number;
    semantic_score?: number | undefined;
    bm25_score?: number | undefined;
    graph_score?: number | undefined;
}, {
    id: string;
    created_at: Date;
    last_accessed: Date;
    access_count: number;
    inbound_edge_count: number;
    semantic_score?: number | undefined;
    bm25_score?: number | undefined;
    graph_score?: number | undefined;
}>;
/**
 * Graph metrics for reranking context.
 */
interface GraphMetrics {
    total_nodes: number;
    total_edges: number;
    density: number;
    avg_inbound_edges: number;
    avg_outbound_edges: number;
}
declare const GraphMetricsSchema: z.ZodObject<{
    total_nodes: z.ZodNumber;
    total_edges: z.ZodNumber;
    density: z.ZodNumber;
    avg_inbound_edges: z.ZodNumber;
    avg_outbound_edges: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    total_nodes: number;
    total_edges: number;
    density: number;
    avg_inbound_edges: number;
    avg_outbound_edges: number;
}, {
    total_nodes: number;
    total_edges: number;
    density: number;
    avg_inbound_edges: number;
    avg_outbound_edges: number;
}>;
/**
 * Ranked node result.
 */
interface RankedNode {
    node: ScoredNode;
    score: number;
    breakdown: ScoreBreakdown;
    primary_signal: keyof ScoreBreakdown;
}
/**
 * Decay behavior configuration (FSRS-inspired).
 */
interface DecayConfig {
    growth_rate: number;
    max_stability_days: number;
    active_threshold: number;
    weak_threshold: number;
    dormant_days: number;
    compress_days: number;
    archive_days: number;
    cascade_factor: number;
    edge_floor: number;
}
declare const DecayConfigSchema: z.ZodObject<{
    growth_rate: z.ZodNumber;
    max_stability_days: z.ZodNumber;
    active_threshold: z.ZodNumber;
    weak_threshold: z.ZodNumber;
    dormant_days: z.ZodNumber;
    compress_days: z.ZodNumber;
    archive_days: z.ZodNumber;
    cascade_factor: z.ZodNumber;
    edge_floor: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    growth_rate: number;
    max_stability_days: number;
    active_threshold: number;
    weak_threshold: number;
    dormant_days: number;
    compress_days: number;
    archive_days: number;
    cascade_factor: number;
    edge_floor: number;
}, {
    growth_rate: number;
    max_stability_days: number;
    active_threshold: number;
    weak_threshold: number;
    dormant_days: number;
    compress_days: number;
    archive_days: number;
    cascade_factor: number;
    edge_floor: number;
}>;
declare const DECAY_CONFIG: DecayConfig;
/**
 * Initial stability per algorithm node type (days).
 */
declare const INITIAL_STABILITY: Record<AlgorithmNodeType, number>;
/**
 * Initial difficulty per algorithm node type (0-1).
 */
declare const INITIAL_DIFFICULTY: Record<AlgorithmNodeType, number>;
/**
 * Decay-based lifecycle states for memory retrieval.
 * NOTE: These are distinct from storm-011's content lifecycle states.
 * These states are used by the forgetting model (storm-007) for decay calculations.
 */
declare const DECAY_LIFECYCLE_STATES: readonly ["ACTIVE", "WEAK", "DORMANT", "COMPRESS", "ARCHIVE"];
type DecayLifecycleState = (typeof DECAY_LIFECYCLE_STATES)[number];
/**
 * SSA aggregation modes.
 */
type SSAAggregation = 'sum' | 'max';
/**
 * Spreading activation parameters.
 */
interface SSAParams {
    initial_activation: number;
    hop_decay: number;
    min_threshold: number;
    max_hops: number;
    max_nodes: number;
    aggregation: SSAAggregation;
}
declare const SSAParamsSchema: z.ZodObject<{
    initial_activation: z.ZodNumber;
    hop_decay: z.ZodNumber;
    min_threshold: z.ZodNumber;
    max_hops: z.ZodNumber;
    max_nodes: z.ZodNumber;
    aggregation: z.ZodEnum<["sum", "max"]>;
}, "strip", z.ZodTypeAny, {
    initial_activation: number;
    hop_decay: number;
    min_threshold: number;
    max_hops: number;
    max_nodes: number;
    aggregation: "sum" | "max";
}, {
    initial_activation: number;
    hop_decay: number;
    min_threshold: number;
    max_hops: number;
    max_nodes: number;
    aggregation: "sum" | "max";
}>;
declare const SSA_PARAMS: SSAParams;
/**
 * Edge weights for SSA.
 * NOTE: These reference storm-031's edge weights but are defined here
 * as the canonical SSA values.
 */
interface SSAEdgeWeights {
    same_entity: number;
    part_of: number;
    caused_by: number;
    mentioned_together: number;
    related_to: number;
    similar_to: number;
    user_linked: number;
    temporal_adjacent: number;
}
declare const SSAEdgeWeightsSchema: z.ZodObject<{
    same_entity: z.ZodNumber;
    part_of: z.ZodNumber;
    caused_by: z.ZodNumber;
    mentioned_together: z.ZodNumber;
    related_to: z.ZodNumber;
    similar_to: z.ZodNumber;
    user_linked: z.ZodNumber;
    temporal_adjacent: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    part_of: number;
    similar_to: number;
    same_entity: number;
    user_linked: number;
    caused_by: number;
    mentioned_together: number;
    temporal_adjacent: number;
    related_to: number;
}, {
    part_of: number;
    similar_to: number;
    same_entity: number;
    user_linked: number;
    caused_by: number;
    mentioned_together: number;
    temporal_adjacent: number;
    related_to: number;
}>;
declare const SSA_EDGE_WEIGHTS: SSAEdgeWeights;
/**
 * Activated node result from SSA.
 */
interface ActivatedNode {
    id: string;
    activation: number;
    path: string[];
}
declare const ActivatedNodeSchema: z.ZodObject<{
    id: z.ZodString;
    activation: z.ZodNumber;
    path: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    path: string[];
    id: string;
    activation: number;
}, {
    path: string[];
    id: string;
    activation: number;
}>;
/**
 * Confidence threshold categories.
 */
interface ConfidenceThresholds {
    retrieval: {
        high: number;
        medium: number;
        low: number;
    };
    classification: {
        clear_lookup: number;
        clear_reasoning: number;
        ambiguous_floor: number;
    };
    extraction: {
        auto_store: number;
        confirm_store: number;
    };
    contradiction: {
        definite: number;
        possible: number;
    };
}
declare const ConfidenceThresholdsSchema: z.ZodObject<{
    retrieval: z.ZodObject<{
        high: z.ZodNumber;
        medium: z.ZodNumber;
        low: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        medium: number;
        high: number;
        low: number;
    }, {
        medium: number;
        high: number;
        low: number;
    }>;
    classification: z.ZodObject<{
        clear_lookup: z.ZodNumber;
        clear_reasoning: z.ZodNumber;
        ambiguous_floor: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        clear_lookup: number;
        clear_reasoning: number;
        ambiguous_floor: number;
    }, {
        clear_lookup: number;
        clear_reasoning: number;
        ambiguous_floor: number;
    }>;
    extraction: z.ZodObject<{
        auto_store: z.ZodNumber;
        confirm_store: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        auto_store: number;
        confirm_store: number;
    }, {
        auto_store: number;
        confirm_store: number;
    }>;
    contradiction: z.ZodObject<{
        definite: z.ZodNumber;
        possible: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        definite: number;
        possible: number;
    }, {
        definite: number;
        possible: number;
    }>;
}, "strip", z.ZodTypeAny, {
    extraction: {
        auto_store: number;
        confirm_store: number;
    };
    retrieval: {
        medium: number;
        high: number;
        low: number;
    };
    classification: {
        clear_lookup: number;
        clear_reasoning: number;
        ambiguous_floor: number;
    };
    contradiction: {
        definite: number;
        possible: number;
    };
}, {
    extraction: {
        auto_store: number;
        confirm_store: number;
    };
    retrieval: {
        medium: number;
        high: number;
        low: number;
    };
    classification: {
        clear_lookup: number;
        clear_reasoning: number;
        ambiguous_floor: number;
    };
    contradiction: {
        definite: number;
        possible: number;
    };
}>;
declare const CONFIDENCE_THRESHOLDS: ConfidenceThresholds;
/**
 * Confidence levels.
 */
declare const CONFIDENCE_LEVELS: readonly ["HIGH", "MEDIUM", "LOW"];
type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
/**
 * Retrieval Confidence System weights.
 */
interface RCSWeights {
    match_quality: number;
    distinctiveness: number;
    completeness: number;
}
declare const RCSWeightsSchema: z.ZodObject<{
    match_quality: z.ZodNumber;
    distinctiveness: z.ZodNumber;
    completeness: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    match_quality: number;
    distinctiveness: number;
    completeness: number;
}, {
    match_quality: number;
    distinctiveness: number;
    completeness: number;
}>;
declare const RCS_WEIGHTS: RCSWeights;
/**
 * Retrieval confidence result.
 */
interface RetrievalConfidenceResult {
    score: number;
    level: ConfidenceLevel;
    breakdown: {
        mq: number;
        dt: number;
        cm: number;
    };
    flags: string[];
}
declare const RetrievalConfidenceResultSchema: z.ZodObject<{
    score: z.ZodNumber;
    level: z.ZodEnum<["HIGH", "MEDIUM", "LOW"]>;
    breakdown: z.ZodObject<{
        mq: z.ZodNumber;
        dt: z.ZodNumber;
        cm: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        mq: number;
        dt: number;
        cm: number;
    }, {
        mq: number;
        dt: number;
        cm: number;
    }>;
    flags: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    level: "HIGH" | "MEDIUM" | "LOW";
    score: number;
    breakdown: {
        mq: number;
        dt: number;
        cm: number;
    };
    flags: string[];
}, {
    level: "HIGH" | "MEDIUM" | "LOW";
    score: number;
    breakdown: {
        mq: number;
        dt: number;
        cm: number;
    };
    flags: string[];
}>;
/**
 * Contradiction detection levels.
 */
declare const CONTRADICTION_LEVELS: readonly ["definite", "possible", "none"];
type ContradictionLevel = (typeof CONTRADICTION_LEVELS)[number];
/**
 * Contradiction detection result.
 */
interface ContradictionResult {
    level: ContradictionLevel;
    score: number;
    action: 'flag_user' | 'note_internal' | 'safe_to_store';
    explanation: string;
}
declare const ContradictionResultSchema: z.ZodObject<{
    level: z.ZodEnum<["definite", "possible", "none"]>;
    score: z.ZodNumber;
    action: z.ZodEnum<["flag_user", "note_internal", "safe_to_store"]>;
    explanation: z.ZodString;
}, "strip", z.ZodTypeAny, {
    level: "none" | "definite" | "possible";
    action: "flag_user" | "note_internal" | "safe_to_store";
    score: number;
    explanation: string;
}, {
    level: "none" | "definite" | "possible";
    action: "flag_user" | "note_internal" | "safe_to_store";
    score: number;
    explanation: string;
}>;
/**
 * Budget configuration per operation.
 */
interface BudgetConfig {
    time_ms: number;
    max_nodes: number;
    max_api_calls: number;
}
declare const BudgetConfigSchema: z.ZodObject<{
    time_ms: z.ZodNumber;
    max_nodes: z.ZodNumber;
    max_api_calls: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    max_nodes: number;
    time_ms: number;
    max_api_calls: number;
}, {
    max_nodes: number;
    time_ms: number;
    max_api_calls: number;
}>;
declare const OPERATION_BUDGETS: Record<string, BudgetConfig>;
/**
 * Quality target per query type.
 */
interface QualityTarget {
    confidence: number;
    min_coverage: number;
}
declare const QualityTargetSchema: z.ZodObject<{
    confidence: z.ZodNumber;
    min_coverage: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    confidence: number;
    min_coverage: number;
}, {
    confidence: number;
    min_coverage: number;
}>;
declare const QUALITY_TARGETS: Record<string, QualityTarget>;
/**
 * Quality score weights.
 */
interface QualityWeights {
    coverage: number;
    match_quality: number;
    convergence: number;
}
declare const QualityWeightsSchema: z.ZodObject<{
    coverage: z.ZodNumber;
    match_quality: z.ZodNumber;
    convergence: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    match_quality: number;
    coverage: number;
    convergence: number;
}, {
    match_quality: number;
    coverage: number;
    convergence: number;
}>;
declare const QUALITY_WEIGHTS: QualityWeights;
/**
 * Cold start threshold (node count).
 */
declare const COLD_START_THRESHOLD = 200;
/**
 * Adaptive limits configuration.
 */
interface AdaptiveLimits {
    entry_points: number;
    max_hops: number;
    max_nodes: number;
}
declare const AdaptiveLimitsSchema: z.ZodObject<{
    entry_points: z.ZodNumber;
    max_hops: z.ZodNumber;
    max_nodes: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    max_hops: number;
    max_nodes: number;
    entry_points: number;
}, {
    max_hops: number;
    max_nodes: number;
    entry_points: number;
}>;
declare const COLD_START_LIMITS: AdaptiveLimits;
/**
 * Query types for adaptive limits.
 */
declare const QUERY_TYPES: readonly ["simple", "standard", "complex"];
type QueryType = (typeof QUERY_TYPES)[number];
/**
 * Termination result.
 */
interface TerminationResult {
    terminate: boolean;
    reason: string;
}
declare const TerminationResultSchema: z.ZodObject<{
    terminate: z.ZodBoolean;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    reason: string;
    terminate: boolean;
}, {
    reason: string;
    terminate: boolean;
}>;
/**
 * Stemmer types.
 */
type StemmerType = 'porter' | 'snowball' | 'none';
/**
 * BM25 core configuration.
 */
interface BM25Config {
    k1: number;
    b: number;
    min_term_length: number;
    max_term_length: number;
    max_doc_frequency_ratio: number;
    stemmer: StemmerType;
    preserve_original: boolean;
}
declare const BM25ConfigSchema: z.ZodObject<{
    k1: z.ZodNumber;
    b: z.ZodNumber;
    min_term_length: z.ZodNumber;
    max_term_length: z.ZodNumber;
    max_doc_frequency_ratio: z.ZodNumber;
    stemmer: z.ZodEnum<["porter", "snowball", "none"]>;
    preserve_original: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    k1: number;
    b: number;
    min_term_length: number;
    max_term_length: number;
    max_doc_frequency_ratio: number;
    stemmer: "none" | "porter" | "snowball";
    preserve_original: boolean;
}, {
    k1: number;
    b: number;
    min_term_length: number;
    max_term_length: number;
    max_doc_frequency_ratio: number;
    stemmer: "none" | "porter" | "snowball";
    preserve_original: boolean;
}>;
declare const BM25_CONFIG: BM25Config;
/**
 * Field types for boosting.
 */
type FieldType = 'title' | 'tags' | 'headers' | 'body' | 'metadata';
/**
 * Field boost configuration.
 */
interface FieldBoost {
    field: FieldType;
    boost: number;
}
declare const FieldBoostSchema: z.ZodObject<{
    field: z.ZodEnum<["title", "tags", "headers", "body", "metadata"]>;
    boost: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    field: "title" | "body" | "metadata" | "tags" | "headers";
    boost: number;
}, {
    field: "title" | "body" | "metadata" | "tags" | "headers";
    boost: number;
}>;
declare const FIELD_BOOSTS: FieldBoost[];
/**
 * Stopwords behavior.
 */
type StopwordsBehavior = 'remove_from_query' | 'remove_from_both' | 'keep_for_phrases';
/**
 * Stopwords configuration.
 */
interface StopwordsConfig {
    language: string;
    default_list: string[];
    custom_additions: string[];
    behavior: StopwordsBehavior;
}
declare const StopwordsConfigSchema: z.ZodObject<{
    language: z.ZodString;
    default_list: z.ZodArray<z.ZodString, "many">;
    custom_additions: z.ZodArray<z.ZodString, "many">;
    behavior: z.ZodEnum<["remove_from_query", "remove_from_both", "keep_for_phrases"]>;
}, "strip", z.ZodTypeAny, {
    language: string;
    default_list: string[];
    custom_additions: string[];
    behavior: "remove_from_query" | "remove_from_both" | "keep_for_phrases";
}, {
    language: string;
    default_list: string[];
    custom_additions: string[];
    behavior: "remove_from_query" | "remove_from_both" | "keep_for_phrases";
}>;
declare const STOPWORDS_CONFIG: StopwordsConfig;
/**
 * Master algorithm parameters aggregation.
 */
interface AlgorithmParams {
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
declare const ALGORITHM_PARAMS: AlgorithmParams;
/**
 * Gets semantic score from node.
 */
declare function semanticScore(node: ScoredNode): number;
/**
 * Normalizes BM25 score against batch max.
 */
declare function keywordScore(node: ScoredNode, maxBM25: number, candidateCount: number): number;
/**
 * Gets graph score from node.
 */
declare function graphScore(node: ScoredNode): number;
/**
 * Calculates recency score using exponential decay.
 */
declare function recencyScore(lastAccessed: Date, now?: Date): number;
/**
 * Calculates authority score based on inbound edges.
 */
declare function authorityScore(inboundEdges: number, avgInbound: number): number;
/**
 * Calculates affinity score based on interaction history.
 */
declare function affinityScore(accessCount: number, createdAt: Date, lastAccessed: Date, now?: Date): number;
/**
 * Reranks candidates using all 6 signals.
 */
declare function rerankCandidates(candidates: ScoredNode[], metrics: GraphMetrics, weights?: RerankingWeights, now?: Date): RankedNode[];
/**
 * Calculates retrievability using exponential decay.
 * R = e^(-t/S)
 */
declare function calculateRetrievability(daysSinceAccess: number, stability: number): number;
/**
 * Calculates difficulty based on node characteristics.
 */
declare function calculateDifficulty(type: AlgorithmNodeType, contentLength: number, edgeCount: number): number;
/**
 * Updates stability on access.
 */
declare function updateStabilityOnAccess(stability: number, difficulty: number): number;
/**
 * Gets decay lifecycle state based on retrievability.
 */
declare function getDecayLifecycleState(retrievability: number, daysDormant: number): DecayLifecycleState;
/**
 * Applies cascade decay to edge weight.
 */
declare function applyCascadeDecay(edgeWeight: number, retrievability: number): number;
/**
 * Gets initial stability for a node type.
 */
declare function getInitialStability(type: AlgorithmNodeType): number;
/**
 * Gets initial difficulty for a node type.
 */
declare function getInitialDifficulty(type: AlgorithmNodeType): number;
/**
 * Calculates retrieval confidence using RCS.
 */
declare function calculateRetrievalConfidence(topScore: number, secondScore: number | null, resultCount: number, hasAttribute: boolean): RetrievalConfidenceResult;
/**
 * Gets confidence level from score.
 */
declare function getConfidenceLevel(score: number): ConfidenceLevel;
/**
 * Detects contradiction between new and existing information.
 */
declare function detectContradiction(similarity: number, logicalConflict: number, daysSinceExisting: number): ContradictionResult;
/**
 * Calculates adaptive limits based on graph characteristics.
 */
declare function calculateAdaptiveLimits(graphSize: number, graphDensity: number, queryType: QueryType): AdaptiveLimits;
/**
 * Calculates quality score from components.
 */
declare function calculateQualityScore(coverage: number, matchQuality: number, convergence: number): number;
/**
 * Determines if search should terminate.
 */
declare function shouldTerminate(currentQuality: number, targetQuality: number, convergence: number, lowConvergenceSteps: number, remainingBudget: BudgetConfig): TerminationResult;
/**
 * Gets budget for an operation.
 */
declare function getBudgetForOperation(operation: string): BudgetConfig;
/**
 * Gets quality target for a query type.
 */
declare function getQualityTargetForQueryType(queryType: string): QualityTarget;
/**
 * Gets effective stopwords set.
 */
declare function getEffectiveStopwords(config?: StopwordsConfig): Set<string>;
/**
 * Removes stopwords from tokens.
 */
declare function removeStopwords(tokens: string[], stopwords: Set<string>): string[];
/**
 * Determines if a term should be indexed.
 */
declare function shouldIndexTerm(term: string, docFrequency: number, totalDocs: number, config?: BM25Config): boolean;
/**
 * Gets field boost for a field type.
 */
declare function getFieldBoost(field: FieldType): number;
declare function validateRerankingWeights(weights: unknown): weights is RerankingWeights;
declare function validateRerankingConfig(config: unknown): config is RerankingConfig;
declare function validateDecayConfig(config: unknown): config is DecayConfig;
declare function validateSSAParams(params: unknown): params is SSAParams;
declare function validateSSAEdgeWeights(weights: unknown): weights is SSAEdgeWeights;
declare function validateConfidenceThresholds(thresholds: unknown): thresholds is ConfidenceThresholds;
declare function validateBudgetConfig(config: unknown): config is BudgetConfig;
declare function validateAdaptiveLimits(limits: unknown): limits is AdaptiveLimits;
declare function validateBM25Config(config: unknown): config is BM25Config;
declare function validateQualityTarget(target: unknown): target is QualityTarget;
declare function validateGraphMetrics(metrics: unknown): metrics is GraphMetrics;

export { ALGORITHM_NODE_TYPES, ALGORITHM_PARAMS, type ActivatedNode, ActivatedNodeSchema, type AdaptiveLimits, AdaptiveLimitsSchema, type AlgorithmNodeType, type AlgorithmParams, type BM25Config, BM25ConfigSchema, BM25_CONFIG, type BudgetConfig, BudgetConfigSchema, COLD_START_LIMITS, COLD_START_THRESHOLD, CONFIDENCE_LEVELS, CONFIDENCE_THRESHOLDS, CONTRADICTION_LEVELS, type ConfidenceLevel, type ConfidenceThresholds, ConfidenceThresholdsSchema, type ContradictionLevel, type ContradictionResult, ContradictionResultSchema, DECAY_CONFIG, DECAY_LIFECYCLE_STATES, type DecayConfig, DecayConfigSchema, type DecayLifecycleState, FIELD_BOOSTS, type FieldBoost, FieldBoostSchema, type FieldType, type GraphMetrics, GraphMetricsSchema, INITIAL_DIFFICULTY, INITIAL_STABILITY, OPERATION_BUDGETS, QUALITY_TARGETS, QUALITY_WEIGHTS, QUERY_TYPES, type QualityTarget, QualityTargetSchema, type QualityWeights, QualityWeightsSchema, type QueryType, type RCSWeights, RCSWeightsSchema, RCS_WEIGHTS, RERANKING_CONFIG, RERANKING_WEIGHTS, type RankedNode, type RerankingConfig, RerankingConfigSchema, type RerankingWeights, RerankingWeightsSchema, type RetrievalConfidenceResult, RetrievalConfidenceResultSchema, type SSAAggregation, type SSAEdgeWeights, SSAEdgeWeightsSchema, type SSAParams, SSAParamsSchema, SSA_EDGE_WEIGHTS, SSA_PARAMS, STOPWORDS_CONFIG, type ScoreBreakdown, ScoreBreakdownSchema, type ScoredNode, ScoredNodeSchema, type StemmerType, type StopwordsBehavior, type StopwordsConfig, StopwordsConfigSchema, type TerminationResult, TerminationResultSchema, affinityScore, applyCascadeDecay, authorityScore, calculateAdaptiveLimits, calculateDifficulty, calculateQualityScore, calculateRetrievability, calculateRetrievalConfidence, detectContradiction, getBudgetForOperation, getConfidenceLevel, getDecayLifecycleState, getEffectiveStopwords, getFieldBoost, getInitialDifficulty, getInitialStability, getQualityTargetForQueryType, graphScore, keywordScore, recencyScore, removeStopwords, rerankCandidates, semanticScore, shouldIndexTerm, shouldTerminate, updateStabilityOnAccess, validateAdaptiveLimits, validateBM25Config, validateBudgetConfig, validateConfidenceThresholds, validateDecayConfig, validateGraphMetrics, validateQualityTarget, validateRerankingConfig, validateRerankingWeights, validateSSAEdgeWeights, validateSSAParams };
