import { z } from 'zod';
import { g as EdgeType, S as SourceType } from '../constants-Blu2FVkv.js';

/**
 * @module @nous/core/edges/weight
 * @description Edge Weight Determination System (EWDS) - 5-source weight calculation with Hebbian evolution
 * @version 1.0.0
 * @spec Brainstorms/Specs/Phase-2-Data-Representation/storm-031
 *
 * This module implements storm-031: Edge Weight Calculation & Clustering.
 *
 * Key concepts:
 * - 5 edge creation sources: extraction, similarity, user, temporal, coactivation
 * - Three-part weight: base × (1 + learned) + coactivation_bonus
 * - Hebbian learning with consecutive ignore tracking
 * - Adaptive compression for graph management
 */

/**
 * Extended edge types including storm-031 additions.
 */
declare const EXTENDED_EDGE_TYPES: readonly ["relates_to", "part_of", "mentioned_in", "causes", "precedes", "contradicts", "supersedes", "derived_from", "similar_to", "same_entity", "user_linked", "caused_by", "mentioned_together", "temporal_adjacent", "temporal_continuation", "summarizes"];
type ExtendedEdgeType = (typeof EXTENDED_EDGE_TYPES)[number];
/**
 * Default base weights for each edge type.
 * Higher values = stronger relationships.
 */
declare const EDGE_WEIGHTS: Record<ExtendedEdgeType, number>;
declare const EDGE_STATUSES: readonly ["confirmed", "provisional"];
type EdgeStatus = (typeof EDGE_STATUSES)[number];
declare const EDGE_CREATION_SOURCES: readonly ["extraction", "similarity", "user", "temporal", "coactivation", "compression"];
type EdgeCreationSource = (typeof EDGE_CREATION_SOURCES)[number];
/**
 * Extraction-time edge creation configuration.
 */
declare const EXTRACTION_CONFIG: {
    readonly confirmed_threshold: 0.7;
    readonly provisional_threshold: 0.5;
    readonly rejection_threshold: 0.5;
    readonly provisional_weight_factor: 0.5;
    readonly provisional_promotion_activations: 3;
    readonly provisional_expiry_days: 30;
};
/**
 * Similarity-based edge creation configuration.
 */
declare const SIMILARITY_CONFIG: {
    readonly creation_threshold: 0.85;
    readonly edge_type: ExtendedEdgeType;
    readonly batch_frequency: "daily";
    readonly max_edges_per_node: 10;
    readonly exclude_same_cluster: false;
};
/**
 * User-created edge configuration.
 */
declare const USER_EDGE_CONFIG: {
    readonly default_strength: 0.9;
    readonly min_strength: 0.5;
    readonly max_strength: 1;
    readonly default_type: ExtendedEdgeType;
    readonly allowed_types: ExtendedEdgeType[];
};
/**
 * Temporal edge configuration.
 */
declare const TEMPORAL_CONFIG: {
    readonly session_timeout_minutes: 30;
    readonly edge_type: ExtendedEdgeType;
    readonly decay_constant: 30;
    readonly max_gap_minutes: 120;
    readonly min_strength: 0.2;
    readonly continuation_max_gap_hours: 24;
    readonly continuation_base_weight: 0.3;
    readonly continuation_same_cluster_required: true;
    readonly continuation_edge_type: ExtendedEdgeType;
};
/**
 * Hebbian learning and co-activation configuration.
 */
declare const COACTIVATION_CONFIG: {
    readonly strengthen_delta: 0.1;
    readonly decay_delta: 0.02;
    readonly min_weight: 0.1;
    readonly max_weight: 1;
    readonly engagement_threshold_seconds: 5;
    readonly consecutive_ignores_before_decay: 3;
    readonly max_coactivation_bonus: 0.3;
    readonly new_edge_similarity_threshold: 0.5;
};
/**
 * Time-based edge decay configuration.
 */
declare const EDGE_DECAY_CONFIG: {
    readonly decay_start_days: 30;
    readonly decay_rate: 0.95;
    readonly decay_period_days: 30;
    readonly floor: 0.1;
};
/**
 * Compression default configuration.
 */
declare const COMPRESSION_DEFAULTS: {
    readonly min_nodes_for_compression: 5;
    readonly similarity_threshold: 0.75;
    readonly max_nodes_per_summary: 20;
    readonly restorable_days: 365;
    readonly dormant_days_minimum: 60;
    readonly importance_max: 0.3;
    readonly strong_active_edges_max: 2;
    readonly age_days_minimum: 30;
};
/**
 * Graph size thresholds for adaptive compression.
 */
declare const GRAPH_SIZE_THRESHOLDS: {
    readonly small: {
        readonly max: 500;
        readonly min_nodes: 3;
    };
    readonly medium: {
        readonly max: 5000;
        readonly min_nodes: 5;
    };
    readonly large: {
        readonly max: number;
        readonly min_nodes: 10;
    };
};
/**
 * Weight bounds for all edges.
 */
declare const WEIGHT_BOUNDS: {
    readonly min: 0.1;
    readonly max: 1;
};
/**
 * Learned adjustment bounds.
 */
declare const LEARNED_ADJUSTMENT_BOUNDS: {
    readonly min: -0.3;
    readonly max: 0.3;
};
/**
 * Weight component decomposition.
 */
interface EdgeWeightComponents {
    base_weight: number;
    learned_adjustment: number;
    coactivation_bonus: number;
}
/**
 * Extended edge with weight components.
 */
interface WeightedEdge extends Omit<NousEdge, 'type'> {
    type: ExtendedEdgeType;
    status: EdgeStatus;
    components: EdgeWeightComponents;
    creation_source: EdgeCreationSource;
    consecutive_ignored: number;
    activation_count: number;
}
/**
 * Result of calculating effective weight.
 */
interface EffectiveWeightResult {
    effective_weight: number;
    was_clamped: boolean;
    raw_value: number;
}
/**
 * Provisional edge state tracking.
 */
interface ProvisionalEdgeState {
    created_at: string;
    activation_count: number;
    expires_at: string;
}
/**
 * Extraction edge result.
 */
interface ExtractionEdgeResult {
    weight: number;
    status: EdgeStatus;
    components: EdgeWeightComponents;
}
/**
 * Temporal edge result.
 */
interface TemporalEdgeResult {
    source: string;
    target: string;
    type: 'temporal_adjacent' | 'temporal_continuation';
    weight: number;
    components: EdgeWeightComponents;
}
/**
 * Session for temporal edge detection.
 */
interface Session {
    id: string;
    start: string;
    end: string;
    accessedNodes: SessionNode[];
}
/**
 * Node accessed during a session.
 */
interface SessionNode {
    id: string;
    cluster_id: string;
    accessed_at: string;
}
/**
 * Co-activation update result.
 */
interface CoactivationUpdateResult {
    edge: WeightedEdge;
    action: 'strengthened' | 'decayed' | 'unchanged';
    previous_weight: number;
    new_weight: number;
    reason: string;
}
/**
 * Time-based decay result.
 */
interface DecayResult {
    decay_periods: number;
    decay_factor: number;
    previous_bonus: number;
    new_bonus: number;
    decay_applied: boolean;
}
/**
 * Compression configuration.
 */
interface CompressionConfig {
    never_compress: {
        is_pinned: boolean;
        is_starred: boolean;
        age_days_less_than: number;
    };
    candidate_requirements: {
        dormant_days_minimum: number;
        importance_max: number;
        strong_active_edges_max: number;
    };
    clustering: {
        similarity_threshold: number;
        min_nodes_for_compression: number;
        max_nodes_per_summary: number;
    };
    retention: {
        restorable_days: number;
    };
}
/**
 * Summary node content.
 */
interface SummaryContent {
    title: string;
    body: string;
    preserved_entities: string[];
    key_facts: string[];
    temporal_span: string | null;
}
/**
 * Compressed edge record for restoration.
 */
interface CompressedEdgeRecord {
    original_source: string;
    target: string;
    original_type: string;
    original_weight: number;
}
/**
 * Summary node from compression.
 */
interface SummaryNode {
    id: string;
    type: 'summary';
    content: SummaryContent;
    compressed_from: string[];
    compressed_edges: CompressedEdgeRecord[];
    cluster_id: string;
    created_at: string;
}
/**
 * Node compression state.
 */
interface NodeCompressionState {
    compressed_into?: string;
    compressed_at?: string;
    restorable_until?: string;
}
/**
 * Embedding freshness state.
 */
interface EmbeddingFreshnessState {
    embedding_version: number;
    last_content_update: string;
    last_embedding_update: string;
}
declare const EdgeWeightComponentsSchema: z.ZodObject<{
    base_weight: z.ZodNumber;
    learned_adjustment: z.ZodNumber;
    coactivation_bonus: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    base_weight: number;
    learned_adjustment: number;
    coactivation_bonus: number;
}, {
    base_weight: number;
    learned_adjustment: number;
    coactivation_bonus: number;
}>;
declare const EdgeStatusSchema: z.ZodEnum<["confirmed", "provisional"]>;
declare const EdgeCreationSourceSchema: z.ZodEnum<["extraction", "similarity", "user", "temporal", "coactivation", "compression"]>;
declare const ProvisionalEdgeStateSchema: z.ZodObject<{
    created_at: z.ZodString;
    activation_count: z.ZodNumber;
    expires_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    activation_count: number;
    expires_at: string;
}, {
    created_at: string;
    activation_count: number;
    expires_at: string;
}>;
declare const ExtractionEdgeResultSchema: z.ZodObject<{
    weight: z.ZodNumber;
    status: z.ZodEnum<["confirmed", "provisional"]>;
    components: z.ZodObject<{
        base_weight: z.ZodNumber;
        learned_adjustment: z.ZodNumber;
        coactivation_bonus: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        base_weight: number;
        learned_adjustment: number;
        coactivation_bonus: number;
    }, {
        base_weight: number;
        learned_adjustment: number;
        coactivation_bonus: number;
    }>;
}, "strip", z.ZodTypeAny, {
    status: "confirmed" | "provisional";
    weight: number;
    components: {
        base_weight: number;
        learned_adjustment: number;
        coactivation_bonus: number;
    };
}, {
    status: "confirmed" | "provisional";
    weight: number;
    components: {
        base_weight: number;
        learned_adjustment: number;
        coactivation_bonus: number;
    };
}>;
declare const SessionNodeSchema: z.ZodObject<{
    id: z.ZodString;
    cluster_id: z.ZodString;
    accessed_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    cluster_id: string;
    accessed_at: string;
}, {
    id: string;
    cluster_id: string;
    accessed_at: string;
}>;
declare const SessionSchema: z.ZodObject<{
    id: z.ZodString;
    start: z.ZodString;
    end: z.ZodString;
    accessedNodes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        cluster_id: z.ZodString;
        accessed_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        cluster_id: string;
        accessed_at: string;
    }, {
        id: string;
        cluster_id: string;
        accessed_at: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    id: string;
    start: string;
    end: string;
    accessedNodes: {
        id: string;
        cluster_id: string;
        accessed_at: string;
    }[];
}, {
    id: string;
    start: string;
    end: string;
    accessedNodes: {
        id: string;
        cluster_id: string;
        accessed_at: string;
    }[];
}>;
declare const TemporalEdgeResultSchema: z.ZodObject<{
    source: z.ZodString;
    target: z.ZodString;
    type: z.ZodEnum<["temporal_adjacent", "temporal_continuation"]>;
    weight: z.ZodNumber;
    components: z.ZodObject<{
        base_weight: z.ZodNumber;
        learned_adjustment: z.ZodNumber;
        coactivation_bonus: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        base_weight: number;
        learned_adjustment: number;
        coactivation_bonus: number;
    }, {
        base_weight: number;
        learned_adjustment: number;
        coactivation_bonus: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "temporal_adjacent" | "temporal_continuation";
    source: string;
    target: string;
    weight: number;
    components: {
        base_weight: number;
        learned_adjustment: number;
        coactivation_bonus: number;
    };
}, {
    type: "temporal_adjacent" | "temporal_continuation";
    source: string;
    target: string;
    weight: number;
    components: {
        base_weight: number;
        learned_adjustment: number;
        coactivation_bonus: number;
    };
}>;
declare const DecayResultSchema: z.ZodObject<{
    decay_periods: z.ZodNumber;
    decay_factor: z.ZodNumber;
    previous_bonus: z.ZodNumber;
    new_bonus: z.ZodNumber;
    decay_applied: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    decay_periods: number;
    decay_factor: number;
    previous_bonus: number;
    new_bonus: number;
    decay_applied: boolean;
}, {
    decay_periods: number;
    decay_factor: number;
    previous_bonus: number;
    new_bonus: number;
    decay_applied: boolean;
}>;
declare const SummaryContentSchema: z.ZodObject<{
    title: z.ZodString;
    body: z.ZodString;
    preserved_entities: z.ZodArray<z.ZodString, "many">;
    key_facts: z.ZodArray<z.ZodString, "many">;
    temporal_span: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    title: string;
    body: string;
    preserved_entities: string[];
    key_facts: string[];
    temporal_span: string | null;
}, {
    title: string;
    body: string;
    preserved_entities: string[];
    key_facts: string[];
    temporal_span: string | null;
}>;
declare const CompressedEdgeRecordSchema: z.ZodObject<{
    original_source: z.ZodString;
    target: z.ZodString;
    original_type: z.ZodString;
    original_weight: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    target: string;
    original_source: string;
    original_type: string;
    original_weight: number;
}, {
    target: string;
    original_source: string;
    original_type: string;
    original_weight: number;
}>;
declare const SummaryNodeSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"summary">;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodString;
        preserved_entities: z.ZodArray<z.ZodString, "many">;
        key_facts: z.ZodArray<z.ZodString, "many">;
        temporal_span: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        body: string;
        preserved_entities: string[];
        key_facts: string[];
        temporal_span: string | null;
    }, {
        title: string;
        body: string;
        preserved_entities: string[];
        key_facts: string[];
        temporal_span: string | null;
    }>;
    compressed_from: z.ZodArray<z.ZodString, "many">;
    compressed_edges: z.ZodArray<z.ZodObject<{
        original_source: z.ZodString;
        target: z.ZodString;
        original_type: z.ZodString;
        original_weight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        target: string;
        original_source: string;
        original_type: string;
        original_weight: number;
    }, {
        target: string;
        original_source: string;
        original_type: string;
        original_weight: number;
    }>, "many">;
    cluster_id: z.ZodString;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "summary";
    id: string;
    content: {
        title: string;
        body: string;
        preserved_entities: string[];
        key_facts: string[];
        temporal_span: string | null;
    };
    created_at: string;
    cluster_id: string;
    compressed_from: string[];
    compressed_edges: {
        target: string;
        original_source: string;
        original_type: string;
        original_weight: number;
    }[];
}, {
    type: "summary";
    id: string;
    content: {
        title: string;
        body: string;
        preserved_entities: string[];
        key_facts: string[];
        temporal_span: string | null;
    };
    created_at: string;
    cluster_id: string;
    compressed_from: string[];
    compressed_edges: {
        target: string;
        original_source: string;
        original_type: string;
        original_weight: number;
    }[];
}>;
declare const NodeCompressionStateSchema: z.ZodObject<{
    compressed_into: z.ZodOptional<z.ZodString>;
    compressed_at: z.ZodOptional<z.ZodString>;
    restorable_until: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    compressed_into?: string | undefined;
    compressed_at?: string | undefined;
    restorable_until?: string | undefined;
}, {
    compressed_into?: string | undefined;
    compressed_at?: string | undefined;
    restorable_until?: string | undefined;
}>;
declare const EmbeddingFreshnessStateSchema: z.ZodObject<{
    embedding_version: z.ZodNumber;
    last_content_update: z.ZodString;
    last_embedding_update: z.ZodString;
}, "strip", z.ZodTypeAny, {
    embedding_version: number;
    last_content_update: string;
    last_embedding_update: string;
}, {
    embedding_version: number;
    last_content_update: string;
    last_embedding_update: string;
}>;
/**
 * Calculates effective weight from components.
 * Formula: effective = base × (1 + learned) + coactivation
 */
declare function calculateEffectiveWeight(components: EdgeWeightComponents): EffectiveWeightResult;
/**
 * Creates weight components with defaults.
 */
declare function createWeightComponents(input: {
    base_weight: number;
    learned_adjustment?: number;
    coactivation_bonus?: number;
}): EdgeWeightComponents;
/**
 * Applies a learning adjustment to components.
 */
declare function applyLearningAdjustment(components: EdgeWeightComponents, delta: number): EdgeWeightComponents;
/**
 * Applies a coactivation bonus to components.
 */
declare function applyCoactivationBonus(components: EdgeWeightComponents, delta: number): EdgeWeightComponents;
/**
 * Decays coactivation bonus by a factor.
 */
declare function decayCoactivationBonus(components: EdgeWeightComponents, factor: number): EdgeWeightComponents;
/**
 * Calculates extraction edge result based on LLM confidence.
 */
declare function calculateExtractionEdge(type: ExtendedEdgeType, llmConfidence: number): ExtractionEdgeResult | null;
/**
 * Creates provisional edge state.
 */
declare function createProvisionalState(): ProvisionalEdgeState;
/**
 * Checks if provisional edge should be promoted.
 */
declare function shouldPromoteProvisional(state: ProvisionalEdgeState): boolean;
/**
 * Checks if provisional edge has expired.
 */
declare function shouldExpireProvisional(state: ProvisionalEdgeState): boolean;
/**
 * Increments provisional edge activation count.
 */
declare function incrementProvisionalActivation(state: ProvisionalEdgeState): ProvisionalEdgeState;
/**
 * Checks if similarity meets threshold for edge creation.
 */
declare function meetsSimilarityThreshold(similarity: number): boolean;
/**
 * Checks if embedding is fresh.
 */
declare function isEmbeddingFresh(state: EmbeddingFreshnessState): boolean;
/**
 * Calculates similarity edge weight.
 */
declare function calculateSimilarityWeight(cosineSimilarity: number): number;
/**
 * Calculates user edge weight with bounds.
 */
declare function calculateUserEdgeWeight(userStrength?: number): number;
/**
 * Checks if edge type is allowed for user creation.
 */
declare function isAllowedUserEdgeType(type: string): boolean;
/**
 * Calculates temporal weight based on time gap.
 * Uses exponential decay: e^(-t/30)
 */
declare function calculateTemporalWeight(minutesApart: number): number | null;
/**
 * Creates a temporal adjacent edge.
 */
declare function createTemporalAdjacentEdge(nodeA: string, nodeB: string, minutesApart: number): TemporalEdgeResult | null;
/**
 * Checks continuation edge eligibility between sessions.
 */
declare function checkContinuationEligibility(currentSession: Session, previousSession: Session): {
    should_create: boolean;
    overlapping_clusters: string[];
    hours_between: number;
};
/**
 * Detects continuation edges between sessions.
 */
declare function detectContinuationEdges(currentSession: Session, previousSession: Session): TemporalEdgeResult[];
/**
 * Creates temporal edges for nodes in a session.
 */
declare function createSessionTemporalEdges(session: Session): TemporalEdgeResult[];
/**
 * Checks if a session has ended.
 */
declare function hasSessionEnded(lastAccessTime: string, currentTime: string): boolean;
/**
 * Determines if user engaged based on view duration.
 */
declare function didUserEngage(viewDurationSeconds: number): boolean;
/**
 * Calculates strengthening delta using asymptotic formula.
 */
declare function calculateStrengtheningDelta(currentWeight: number): number;
/**
 * Updates co-activation weight based on user engagement.
 */
declare function updateCoActivationWeight(edge: WeightedEdge, userEngaged: boolean): CoactivationUpdateResult;
/**
 * Applies time-based decay to an edge.
 */
declare function applyTimeBasedDecay(edge: WeightedEdge): DecayResult;
/**
 * Checks if nodes are eligible for new co-activation edge.
 */
declare function shouldConsiderNewEdge(similarity: number): boolean;
/**
 * Checks if an edge is "dead" (at minimum weight).
 */
declare function isEdgeDead(edge: WeightedEdge): boolean;
/**
 * Gets compression configuration based on graph size.
 */
declare function getCompressionConfig(graphSize: number): CompressionConfig;
/**
 * Checks if a node should never be compressed.
 */
declare function isNeverCompress(node: {
    is_pinned: boolean;
    is_starred: boolean;
    created_at: string;
}, config: CompressionConfig): boolean;
/**
 * Checks if a node meets compression requirements.
 */
declare function meetsCompressionRequirements(node: {
    lifecycle: string;
    dormant_since?: string;
    importance_score: number;
}, strongActiveEdges: number, config: CompressionConfig): boolean;
/**
 * Creates compression state for a node.
 */
declare function createCompressionState(summaryId: string, restorableDays: number): NodeCompressionState;
/**
 * Checks if a compressed node is still restorable.
 */
declare function isRestorable(state: NodeCompressionState): boolean;
/**
 * Creates an edge record for preservation.
 */
declare function createEdgeRecord(sourceNodeId: string, targetNodeId: string, edgeType: string, weight: number): CompressedEdgeRecord;
/**
 * Calculates aggregated weight for summary edges.
 */
declare function calculateAggregatedWeight(records: CompressedEdgeRecord[]): number | null;
/**
 * Generates a summary node ID.
 */
declare function generateSummaryNodeId(): string;
/**
 * Creates a weighted edge from base properties.
 */
declare function createWeightedEdge(options: {
    source: string;
    target: string;
    type: ExtendedEdgeType;
    status?: EdgeStatus;
    creationSource: EdgeCreationSource;
    baseWeight?: number;
    confidence?: number;
}): WeightedEdge;
declare function validateWeightComponents(components: unknown): components is EdgeWeightComponents;
declare function validateProvisionalState(state: unknown): state is ProvisionalEdgeState;
declare function validateSession(session: unknown): session is Session;
declare function validateSummaryNode(node: unknown): node is SummaryNode;
declare function validateCompressionState(state: unknown): state is NodeCompressionState;
declare function validateEmbeddingFreshness(state: unknown): state is EmbeddingFreshnessState;

/**
 * @module @nous/core/edges
 * @description Edge schema for relationships between nodes
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-011/spec/edge-schema.ts
 *
 * Edges are first-class citizens in Nous. They enable:
 * - Graph traversal in SSA
 * - Relationship-aware retrieval
 * - Contradiction/supersession tracking
 */

/**
 * Generates a globally unique edge ID.
 * Format: "e_" + 12-character nanoid
 */
declare function generateEdgeId(): string;
/**
 * Neural properties for edge decay and strengthening.
 * Supports Hebbian learning ("neurons that fire together wire together").
 */
interface EdgeNeuralProperties {
    /** How many times these nodes were activated together */
    co_activation_count: number;
    /** When nodes were last co-activated (ISO 8601) */
    last_co_activation: string;
    /** Current decay factor (0-1). Lower = more decayed */
    decay_factor: number;
}
declare const EdgeNeuralPropertiesSchema: z.ZodObject<{
    co_activation_count: z.ZodNumber;
    last_co_activation: z.ZodString;
    decay_factor: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    decay_factor: number;
    co_activation_count: number;
    last_co_activation: string;
}, {
    decay_factor: number;
    co_activation_count: number;
    last_co_activation: string;
}>;
/**
 * How this edge was created.
 */
interface EdgeProvenance {
    /** How the edge was created */
    source_type: SourceType;
    /** When the edge was created (ISO 8601) */
    created_at: string;
    /** Confidence in extraction (if applicable) */
    extraction_confidence?: number;
}
declare const EdgeProvenanceSchema: z.ZodObject<{
    source_type: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
    created_at: z.ZodString;
    extraction_confidence: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    source_type: "import" | "extraction" | "manual" | "inference";
    extraction_confidence?: number | undefined;
}, {
    created_at: string;
    source_type: "import" | "extraction" | "manual" | "inference";
    extraction_confidence?: number | undefined;
}>;
/**
 * A relationship between two nodes.
 *
 * Edges enable:
 * - SSA graph traversal (storm-005)
 * - Contradiction detection (storm-009)
 * - Cluster organization (storm-006)
 * - Weight-based retrieval ranking (storm-031)
 */
interface NousEdge {
    /** Globally unique edge ID */
    id: string;
    /** Source node ID (where edge originates) */
    source: string;
    /** Target node ID (where edge points) */
    target: string;
    /** Relationship type */
    type: EdgeType;
    /** More specific subtype (e.g., "sibling", "parent") */
    subtype?: string;
    /** Connection strength (0-1). Higher = stronger relationship */
    strength: number;
    /** Confidence in this edge (0-1). Higher = more certain */
    confidence: number;
    /** Neural properties for decay/strengthening */
    neural: EdgeNeuralProperties;
    /** Where this edge came from */
    provenance: EdgeProvenance;
}
declare const NousEdgeSchema: z.ZodObject<{
    id: z.ZodString;
    source: z.ZodString;
    target: z.ZodString;
    type: z.ZodEnum<["relates_to", "part_of", "mentioned_in", "causes", "precedes", "contradicts", "supersedes", "derived_from", "similar_to"]>;
    subtype: z.ZodOptional<z.ZodString>;
    strength: z.ZodNumber;
    confidence: z.ZodNumber;
    neural: z.ZodObject<{
        co_activation_count: z.ZodNumber;
        last_co_activation: z.ZodString;
        decay_factor: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        decay_factor: number;
        co_activation_count: number;
        last_co_activation: string;
    }, {
        decay_factor: number;
        co_activation_count: number;
        last_co_activation: string;
    }>;
    provenance: z.ZodObject<{
        source_type: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        created_at: z.ZodString;
        extraction_confidence: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        created_at: string;
        source_type: "import" | "extraction" | "manual" | "inference";
        extraction_confidence?: number | undefined;
    }, {
        created_at: string;
        source_type: "import" | "extraction" | "manual" | "inference";
        extraction_confidence?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "relates_to" | "part_of" | "mentioned_in" | "causes" | "precedes" | "contradicts" | "supersedes" | "derived_from" | "similar_to";
    id: string;
    confidence: number;
    source: string;
    neural: {
        decay_factor: number;
        co_activation_count: number;
        last_co_activation: string;
    };
    provenance: {
        created_at: string;
        source_type: "import" | "extraction" | "manual" | "inference";
        extraction_confidence?: number | undefined;
    };
    target: string;
    strength: number;
    subtype?: string | undefined;
}, {
    type: "relates_to" | "part_of" | "mentioned_in" | "causes" | "precedes" | "contradicts" | "supersedes" | "derived_from" | "similar_to";
    id: string;
    confidence: number;
    source: string;
    neural: {
        decay_factor: number;
        co_activation_count: number;
        last_co_activation: string;
    };
    provenance: {
        created_at: string;
        source_type: "import" | "extraction" | "manual" | "inference";
        extraction_confidence?: number | undefined;
    };
    target: string;
    strength: number;
    subtype?: string | undefined;
}>;
/**
 * Edge creation rule definitions.
 * These rules determine how edges are automatically created during extraction.
 */
declare const EDGE_CREATION_RULES: {
    /** Rule 1: Co-mention - Entities mentioned in the same sentence */
    readonly CO_MENTION: {
        readonly type: EdgeType;
        readonly defaultStrength: 0.5;
        readonly description: "Entities in same sentence";
    };
    /** Rule 2: Explicit relation - "X causes Y" */
    readonly EXPLICIT_CAUSAL: {
        readonly type: EdgeType;
        readonly defaultStrength: 0.8;
        readonly description: "Explicit causal statement";
    };
    /** Rule 3: Containment - "X is part of Y" */
    readonly EXPLICIT_CONTAINMENT: {
        readonly type: EdgeType;
        readonly defaultStrength: 0.9;
        readonly description: "Explicit containment";
    };
    /** Rule 4: Temporal sequence - Events in order */
    readonly TEMPORAL_SEQUENCE: {
        readonly type: EdgeType;
        readonly defaultStrength: 0.7;
        readonly description: "Events in temporal order";
    };
    /** Rule 5: Extraction origin - Concept extracted from Episode */
    readonly EXTRACTION_ORIGIN: {
        readonly type: EdgeType;
        readonly defaultStrength: 1;
        readonly description: "Concept from episode";
    };
    /** Rule 6: Embedding similarity - cosine > 0.85 */
    readonly EMBEDDING_SIMILARITY: {
        readonly type: EdgeType;
        readonly threshold: 0.85;
        readonly description: "High semantic similarity";
    };
};
interface CreateEdgeOptions {
    subtype?: string;
    strength?: number;
    confidence?: number;
    sourceType?: SourceType;
    extractionConfidence?: number;
}
/**
 * Creates a new edge with default values.
 */
declare function createEdge(source: string, target: string, type: EdgeType, options?: CreateEdgeOptions): NousEdge;
/**
 * Creates default neural properties for a new edge.
 */
declare function createDefaultEdgeNeuralProperties(): EdgeNeuralProperties;
/**
 * Strengthens an edge based on co-activation (Hebbian learning).
 * "Neurons that fire together wire together."
 */
declare function strengthenEdge(edge: NousEdge, amount?: number): NousEdge;
/**
 * Applies decay to an edge.
 * Used by the forgetting model (storm-007).
 */
declare function decayEdge(edge: NousEdge, decayRate?: number): NousEdge;
/**
 * Resets an edge's decay factor (reactivation).
 */
declare function reactivateEdge(edge: NousEdge): NousEdge;
/**
 * Updates an edge's confidence.
 */
declare function updateEdgeConfidence(edge: NousEdge, confidence: number): NousEdge;
/**
 * Checks if an edge connects two specific nodes (in either direction).
 */
declare function edgeConnects(edge: NousEdge, nodeA: string, nodeB: string): boolean;
/**
 * Gets the other node in an edge.
 */
declare function getOtherNode(edge: NousEdge, nodeId: string): string | undefined;
/**
 * Checks if an edge is below the decay threshold.
 */
declare function isEdgeDecayed(edge: NousEdge, threshold?: number): boolean;
/**
 * Checks if an edge should be pruned based on age and decay.
 */
declare function shouldPruneEdge(edge: NousEdge, maxAgeDays?: number, decayThreshold?: number): boolean;
/**
 * Filters edges by type.
 */
declare function filterEdgesByType(edges: NousEdge[], type: EdgeType): NousEdge[];
/**
 * Gets all edges connected to a node.
 */
declare function getEdgesForNode(edges: NousEdge[], nodeId: string): NousEdge[];
/**
 * Gets outgoing edges from a node.
 */
declare function getOutgoingEdges(edges: NousEdge[], nodeId: string): NousEdge[];
/**
 * Gets incoming edges to a node.
 */
declare function getIncomingEdges(edges: NousEdge[], nodeId: string): NousEdge[];
/**
 * Sorts edges by strength (descending).
 */
declare function sortEdgesByStrength(edges: NousEdge[]): NousEdge[];
/**
 * Sorts edges by co-activation count (descending).
 */
declare function sortEdgesByCoActivation(edges: NousEdge[]): NousEdge[];
/**
 * Validates an edge against the schema.
 */
declare function validateEdge(edge: unknown): edge is NousEdge;
/**
 * Parses and validates edge data.
 */
declare function parseEdge(data: unknown): NousEdge;
/**
 * Safely parses edge data, returning null on failure.
 */
declare function safeParseEdge(data: unknown): NousEdge | null;

export { COACTIVATION_CONFIG, COMPRESSION_DEFAULTS, type CoactivationUpdateResult, type CompressedEdgeRecord, CompressedEdgeRecordSchema, type CompressionConfig, type CreateEdgeOptions, type DecayResult, DecayResultSchema, EDGE_CREATION_RULES, EDGE_CREATION_SOURCES, EDGE_DECAY_CONFIG, EDGE_STATUSES, EDGE_WEIGHTS, EXTENDED_EDGE_TYPES, EXTRACTION_CONFIG, type EdgeCreationSource, EdgeCreationSourceSchema, type EdgeNeuralProperties, EdgeNeuralPropertiesSchema, type EdgeProvenance, EdgeProvenanceSchema, type EdgeStatus, EdgeStatusSchema, EdgeType, type EdgeWeightComponents, EdgeWeightComponentsSchema, type EffectiveWeightResult, type EmbeddingFreshnessState, EmbeddingFreshnessStateSchema, type ExtendedEdgeType, type ExtractionEdgeResult, ExtractionEdgeResultSchema, GRAPH_SIZE_THRESHOLDS, LEARNED_ADJUSTMENT_BOUNDS, type NodeCompressionState, NodeCompressionStateSchema, type NousEdge, NousEdgeSchema, type ProvisionalEdgeState, ProvisionalEdgeStateSchema, SIMILARITY_CONFIG, type Session, type SessionNode, SessionNodeSchema, SessionSchema, SourceType, type SummaryContent, SummaryContentSchema, type SummaryNode, SummaryNodeSchema, TEMPORAL_CONFIG, type TemporalEdgeResult, TemporalEdgeResultSchema, USER_EDGE_CONFIG, WEIGHT_BOUNDS, type WeightedEdge, applyCoactivationBonus, applyLearningAdjustment, applyTimeBasedDecay, calculateAggregatedWeight, calculateEffectiveWeight, calculateExtractionEdge, calculateSimilarityWeight, calculateStrengtheningDelta, calculateTemporalWeight, calculateUserEdgeWeight, checkContinuationEligibility, createCompressionState, createDefaultEdgeNeuralProperties, createEdge, createEdgeRecord, createProvisionalState, createSessionTemporalEdges, createTemporalAdjacentEdge, createWeightComponents, createWeightedEdge, decayCoactivationBonus, decayEdge, detectContinuationEdges, didUserEngage, edgeConnects, filterEdgesByType, generateEdgeId, generateSummaryNodeId, getCompressionConfig, getEdgesForNode, getIncomingEdges, getOtherNode, getOutgoingEdges, hasSessionEnded, incrementProvisionalActivation, isAllowedUserEdgeType, isEdgeDead, isEdgeDecayed, isEmbeddingFresh, isNeverCompress, isRestorable, meetsCompressionRequirements, meetsSimilarityThreshold, parseEdge, reactivateEdge, safeParseEdge, shouldConsiderNewEdge, shouldExpireProvisional, shouldPromoteProvisional, shouldPruneEdge, sortEdgesByCoActivation, sortEdgesByStrength, strengthenEdge, updateCoActivationWeight, updateEdgeConfidence, validateCompressionState, validateEdge, validateEmbeddingFreshness, validateProvisionalState, validateSession, validateSummaryNode, validateWeightComponents };
