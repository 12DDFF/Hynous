import { NousNode } from '../nodes/index.js';
import { z } from 'zod';
import '../constants-Blu2FVkv.js';
import '../blocks/index.js';
import '../temporal/index.js';

/**
 * @module @nous/core/contradiction
 * @description Constants for Contradiction Resolution System (CRS)
 * @version 1.0.0
 * @spec Specs/Phase-5-Quality-Control/storm-009
 * @storm Brainstorms/Infrastructure/storm-009-contradiction-handling
 *
 * All numeric thresholds, limits, and configuration defaults.
 * These values are from storm-009 v2 revision and should not be changed
 * without updating the brainstorm.
 */

/**
 * Detection tier names.
 * Pipeline flows: STRUCTURAL → NORMALIZED → PATTERN → CLASSIFIER → LLM → VERIFICATION
 */
declare const DETECTION_TIERS: readonly ["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM", "VERIFICATION"];
type DetectionTier = (typeof DETECTION_TIERS)[number];
declare const DetectionTierSchema: z.ZodEnum<["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM", "VERIFICATION"]>;
/**
 * Type guard for DetectionTier.
 */
declare function isDetectionTier(value: unknown): value is DetectionTier;
/**
 * Metadata for each detection tier.
 * Speed, cost, and accuracy targets from v2 revision.
 */
declare const DETECTION_TIER_METADATA: Record<DetectionTier, {
    speed_ms: number;
    cost: number;
    accuracy: number;
}>;
/**
 * Confidence thresholds for detection tiers.
 * Determines when to proceed to next tier or stop.
 */
declare const TIER_THRESHOLDS: {
    /** Tier 1: Structural match confidence */
    readonly structural_confidence: 0.95;
    /** Tier 1.5: Normalized match confidence */
    readonly normalized_confidence: 0.9;
    /** Tier 2: Pattern high confidence - proceed to resolution */
    readonly pattern_high_threshold: 0.7;
    /** Tier 2: Pattern continue threshold - proceed to Tier 2.5 */
    readonly pattern_continue_threshold: 0.4;
    /** Tier 2.5: Classifier threshold to proceed */
    readonly classifier_threshold: 0.7;
    /** Tier 3: LLM confidence for auto-supersession (requires Tier 4) */
    readonly llm_auto_threshold: 0.8;
    /** Tier 4: Verification confidence for auto-supersession */
    readonly verification_threshold: 0.7;
};
/**
 * The 6 contradiction types.
 */
declare const CONFLICT_TYPES: readonly ["FACT_UPDATE", "CORRECTION", "BELIEF_CONTRADICTION", "BELIEF_EVOLUTION", "SOURCE_CONFLICT", "AMBIGUOUS"];
type ConflictType = (typeof CONFLICT_TYPES)[number];
declare const ConflictTypeSchema: z.ZodEnum<["FACT_UPDATE", "CORRECTION", "BELIEF_CONTRADICTION", "BELIEF_EVOLUTION", "SOURCE_CONFLICT", "AMBIGUOUS"]>;
/**
 * Type guard for ConflictType.
 */
declare function isConflictType(value: unknown): value is ConflictType;
/**
 * Resolution strategies.
 */
declare const RESOLUTION_STRATEGIES: readonly ["supersede_old", "keep_both_linked", "keep_both_unlinked", "queue_for_user", "source_ranking"];
type ResolutionStrategy = (typeof RESOLUTION_STRATEGIES)[number];
declare const ResolutionStrategySchema: z.ZodEnum<["supersede_old", "keep_both_linked", "keep_both_unlinked", "queue_for_user", "source_ranking"]>;
/**
 * Resolution details for each conflict type.
 */
declare const CONFLICT_TYPE_RESOLUTION: Record<ConflictType, {
    auto_supersede: boolean;
    resolution: ResolutionStrategy;
    description: string;
}>;
/**
 * Superseded node lifecycle states.
 */
declare const SUPERSEDED_STATES: readonly ["SUPERSEDED_ACTIVE", "SUPERSEDED_FADING", "SUPERSEDED_DORMANT", "SUPERSEDED_ARCHIVED", "SUPERSEDED_DELETED"];
type SupersededState = (typeof SUPERSEDED_STATES)[number];
declare const SupersededStateSchema: z.ZodEnum<["SUPERSEDED_ACTIVE", "SUPERSEDED_FADING", "SUPERSEDED_DORMANT", "SUPERSEDED_ARCHIVED", "SUPERSEDED_DELETED"]>;
/**
 * Type guard for SupersededState.
 */
declare function isSupersededState(value: unknown): value is SupersededState;
/**
 * Decay rate multipliers per superseded state.
 * Applied to normal decay rate (λ_superseded = multiplier × λ_normal).
 */
declare const SUPERSEDED_DECAY_MULTIPLIERS: Record<SupersededState, number>;
/**
 * If user accesses superseded node, reduce decay multiplier to this.
 */
declare const SUPERSEDED_ACCESS_DECAY_MULTIPLIER = 2;
/**
 * Retrievability thresholds for superseded state transitions.
 */
declare const SUPERSEDED_R_THRESHOLDS: {
    /** Above this: SUPERSEDED_ACTIVE */
    readonly active_min: 0.3;
    /** Between fading_min and active_min: SUPERSEDED_FADING */
    readonly fading_min: 0.1;
    /** Below fading_min: SUPERSEDED_DORMANT */
    readonly dormant_max: 0.1;
};
/**
 * Days in dormant state before archival.
 */
declare const SUPERSEDED_DORMANT_DAYS = 90;
/**
 * All 5 conditions must be true for deletion.
 */
declare const DELETION_CRITERIA: {
    /** 1. Must be archived for this many days */
    readonly min_archived_days: 180;
    /** 2. Must have zero accesses since archival */
    readonly required_access_count: 0;
    /** 3. No incoming edges with strength above this */
    readonly max_edge_strength: 0.5;
    /** 4. Superseding node must still be active */
    readonly superseding_must_be_active: true;
    /** 5. Raw source must exist in Archive Layer */
    readonly raw_must_exist: true;
};
/**
 * Storage pressure threshold that triggers deletion audit.
 */
declare const STORAGE_PRESSURE_THRESHOLD = 0.8;
/**
 * Conflict resolution queue configuration.
 */
declare const CONFLICT_QUEUE_CONFIG: {
    /** Maximum items in queue - oldest auto-resolves on overflow */
    readonly max_items: 20;
    /** Days before auto-resolve to "keep both" */
    readonly auto_resolve_days: 14;
    /** Auto-resolve strategy */
    readonly auto_resolve_strategy: "keep_both";
    /** Weekly prompt day (0=Sunday, 1=Monday) */
    readonly weekly_prompt_day: 1;
};
/**
 * Conflict statuses.
 */
declare const CONFLICT_STATUSES: readonly ["pending", "resolved", "auto_resolved"];
type ConflictStatus = (typeof CONFLICT_STATUSES)[number];
declare const ConflictStatusSchema: z.ZodEnum<["pending", "resolved", "auto_resolved"]>;
/**
 * User resolution options.
 */
declare const USER_RESOLUTIONS: readonly ["old_is_current", "new_is_current", "keep_both", "merge"];
type UserResolution = (typeof USER_RESOLUTIONS)[number];
declare const UserResolutionSchema: z.ZodEnum<["old_is_current", "new_is_current", "keep_both", "merge"]>;
/**
 * Description of each resolution option.
 */
declare const USER_RESOLUTION_DESCRIPTIONS: Record<UserResolution, string>;
/**
 * User-selectable accuracy modes.
 */
declare const ACCURACY_MODES: readonly ["FAST", "BALANCED", "THOROUGH", "MANUAL"];
type AccuracyMode = (typeof ACCURACY_MODES)[number];
declare const AccuracyModeSchema: z.ZodEnum<["FAST", "BALANCED", "THOROUGH", "MANUAL"]>;
/**
 * Type guard for AccuracyMode.
 */
declare function isAccuracyMode(value: unknown): value is AccuracyMode;
/**
 * Accuracy targets per tier for monitoring.
 */
declare const ACCURACY_TARGETS: Record<DetectionTier, number>;
/**
 * Overall auto-supersede accuracy target.
 */
declare const AUTO_SUPERSEDE_ACCURACY_TARGET = 0.97;
/**
 * Thresholds for classifier training (self-improvement).
 */
declare const CLASSIFIER_TRAINING: {
    /** Train initial model at this many examples */
    readonly initial_train_examples: 500;
    /** Retrain with full dataset at this many examples */
    readonly retrain_examples: 2000;
    /** Minimum accuracy before alerting */
    readonly accuracy_alert_threshold: 0.85;
    /** Auto-supersede accuracy below this triggers conservative mode */
    readonly auto_mode_switch_threshold: 0.95;
};
/**
 * Attribute synonym mappings for Tier 1.5 normalization.
 */
declare const ATTRIBUTE_SYNONYMS: Record<string, string[]>;
/**
 * Correction marker patterns for Tier 2.
 */
declare const PATTERN_TRIGGERS: readonly ["actually", "I was wrong", "correction:", "update:", "no longer", "changed to", "now it's", "turns out", "not anymore", "used to be"];
/**
 * Disqualifier patterns for Tier 2.
 */
declare const PATTERN_DISQUALIFIERS: readonly ["wasn't actually", "not really", "wrong to doubt", "wrong of me", "was I wrong?", "is it actually?", "good point", "actually, yes", "actually enjoyed", "actually quite", "actually like", "actually think"];
/**
 * Confidence scoring weights for Tier 2 pattern detection.
 */
declare const PATTERN_CONFIDENCE_WEIGHTS: {
    /** Base confidence when trigger found */
    readonly base: 0.5;
    /** Add if entity reference within 10 words */
    readonly entity_nearby: 0.15;
    /** Add if factual value present */
    readonly has_value: 0.1;
    /** Add if temporal signal present */
    readonly temporal_signal: 0.1;
    /** Subtract if any disqualifier found */
    readonly disqualifier_penalty: -0.3;
};
/**
 * Maximum distance (in words) for entity to be considered "nearby".
 */
declare const ENTITY_NEARBY_DISTANCE = 10;
/**
 * Patterns that trigger history mode in QCS.
 */
declare const HISTORY_MODE_PATTERNS: readonly ["used to", "before", "previously", "originally", "changed", "updated", "evolved", "history of", "what did I think", "how has .* changed"];
/**
 * Penalty applied to superseded nodes in history mode.
 */
declare const HISTORY_MODE_SUPERSEDED_PENALTY = 0.5;
/**
 * SSA activation cap for superseded nodes.
 */
declare const SSA_SUPERSEDED_ACTIVATION_CAP = 0.3;
/**
 * Spread decay factor for superseded nodes.
 */
declare const SSA_SUPERSEDED_SPREAD_DECAY = 0.5;
/**
 * Query modes for retrieval.
 */
declare const QUERY_MODES: readonly ["current", "as_of", "history", "full_audit"];
type QueryMode = (typeof QUERY_MODES)[number];
declare const QueryModeSchema: z.ZodEnum<["current", "as_of", "history", "full_audit"]>;
/**
 * Type guard for QueryMode.
 */
declare function isQueryMode(value: unknown): value is QueryMode;
/**
 * Sentiment categories for belief analysis.
 */
declare const SENTIMENTS: readonly ["positive", "negative", "neutral"];
type Sentiment = (typeof SENTIMENTS)[number];
declare const SentimentSchema: z.ZodEnum<["positive", "negative", "neutral"]>;

/**
 * @module @nous/core/contradiction
 * @description Types and schemas for Contradiction Resolution System
 * @version 1.0.0
 * @spec Specs/Phase-5-Quality-Control/storm-009
 * @storm Brainstorms/Infrastructure/storm-009-contradiction-handling
 */

/**
 * Context provided for type classification.
 */
interface DetectionContext {
    old_value: string;
    new_value: string;
    old_timestamp: string;
    new_timestamp: string;
    old_source_confidence: number;
    new_source_confidence: number;
    has_sentiment_flip: boolean;
    has_scope_expansion: boolean;
    entity_id?: string;
    attribute_type?: string;
    has_correction_pattern: boolean;
}
declare const DetectionContextSchema: z.ZodObject<{
    old_value: z.ZodString;
    new_value: z.ZodString;
    old_timestamp: z.ZodString;
    new_timestamp: z.ZodString;
    old_source_confidence: z.ZodNumber;
    new_source_confidence: z.ZodNumber;
    has_sentiment_flip: z.ZodBoolean;
    has_scope_expansion: z.ZodBoolean;
    entity_id: z.ZodOptional<z.ZodString>;
    attribute_type: z.ZodOptional<z.ZodString>;
    has_correction_pattern: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    old_value: string;
    new_value: string;
    old_timestamp: string;
    new_timestamp: string;
    old_source_confidence: number;
    new_source_confidence: number;
    has_sentiment_flip: boolean;
    has_scope_expansion: boolean;
    has_correction_pattern: boolean;
    entity_id?: string | undefined;
    attribute_type?: string | undefined;
}, {
    old_value: string;
    new_value: string;
    old_timestamp: string;
    new_timestamp: string;
    old_source_confidence: number;
    new_source_confidence: number;
    has_sentiment_flip: boolean;
    has_scope_expansion: boolean;
    has_correction_pattern: boolean;
    entity_id?: string | undefined;
    attribute_type?: string | undefined;
}>;
/**
 * Result of classifying a potential contradiction.
 */
interface TypeClassification {
    type: ConflictType;
    confidence: number;
    auto_supersede: boolean;
    resolution: ResolutionStrategy;
    reasoning: string;
}
declare const TypeClassificationSchema: z.ZodObject<{
    type: z.ZodEnum<["FACT_UPDATE", "CORRECTION", "BELIEF_CONTRADICTION", "BELIEF_EVOLUTION", "SOURCE_CONFLICT", "AMBIGUOUS"]>;
    confidence: z.ZodNumber;
    auto_supersede: z.ZodBoolean;
    resolution: z.ZodEnum<["supersede_old", "keep_both_linked", "keep_both_unlinked", "queue_for_user", "source_ranking"]>;
    reasoning: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT";
    confidence: number;
    resolution: "supersede_old" | "keep_both_linked" | "keep_both_unlinked" | "queue_for_user" | "source_ranking";
    auto_supersede: boolean;
    reasoning: string;
}, {
    type: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT";
    confidence: number;
    resolution: "supersede_old" | "keep_both_linked" | "keep_both_unlinked" | "queue_for_user" | "source_ranking";
    auto_supersede: boolean;
    reasoning: string;
}>;
/**
 * Result from any detection tier.
 */
interface TierResult {
    tier: DetectionTier;
    detected: boolean;
    confidence: number;
    conflict_type?: ConflictType;
    should_continue: boolean;
    reasoning?: string;
    time_ms: number;
    cost: number;
}
declare const TierResultSchema: z.ZodObject<{
    tier: z.ZodEnum<["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM", "VERIFICATION"]>;
    detected: z.ZodBoolean;
    confidence: z.ZodNumber;
    conflict_type: z.ZodOptional<z.ZodEnum<["FACT_UPDATE", "CORRECTION", "BELIEF_CONTRADICTION", "BELIEF_EVOLUTION", "SOURCE_CONFLICT", "AMBIGUOUS"]>>;
    should_continue: z.ZodBoolean;
    reasoning: z.ZodOptional<z.ZodString>;
    time_ms: z.ZodNumber;
    cost: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    confidence: number;
    time_ms: number;
    tier: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
    detected: boolean;
    should_continue: boolean;
    cost: number;
    reasoning?: string | undefined;
    conflict_type?: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT" | undefined;
}, {
    confidence: number;
    time_ms: number;
    tier: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
    detected: boolean;
    should_continue: boolean;
    cost: number;
    reasoning?: string | undefined;
    conflict_type?: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT" | undefined;
}>;
/**
 * Tier 1: Structural detection result.
 */
interface StructuralDetection {
    entity_id?: string;
    attribute_type?: string;
    old_value?: string;
    new_value?: string;
    match_found: boolean;
    values_differ: boolean;
}
declare const StructuralDetectionSchema: z.ZodObject<{
    entity_id: z.ZodOptional<z.ZodString>;
    attribute_type: z.ZodOptional<z.ZodString>;
    old_value: z.ZodOptional<z.ZodString>;
    new_value: z.ZodOptional<z.ZodString>;
    match_found: z.ZodBoolean;
    values_differ: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    match_found: boolean;
    values_differ: boolean;
    old_value?: string | undefined;
    new_value?: string | undefined;
    entity_id?: string | undefined;
    attribute_type?: string | undefined;
}, {
    match_found: boolean;
    values_differ: boolean;
    old_value?: string | undefined;
    new_value?: string | undefined;
    entity_id?: string | undefined;
    attribute_type?: string | undefined;
}>;
/**
 * Tier 1.5: Normalization result.
 */
interface NormalizationResult {
    original_attribute: string;
    normalized_attribute: string;
    synonyms_matched: string[];
    implicit_extraction?: {
        pattern: string;
        extracted_attribute: string;
        extracted_value: string;
    };
}
declare const NormalizationResultSchema: z.ZodObject<{
    original_attribute: z.ZodString;
    normalized_attribute: z.ZodString;
    synonyms_matched: z.ZodArray<z.ZodString, "many">;
    implicit_extraction: z.ZodOptional<z.ZodObject<{
        pattern: z.ZodString;
        extracted_attribute: z.ZodString;
        extracted_value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        pattern: string;
        extracted_attribute: string;
        extracted_value: string;
    }, {
        pattern: string;
        extracted_attribute: string;
        extracted_value: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    original_attribute: string;
    normalized_attribute: string;
    synonyms_matched: string[];
    implicit_extraction?: {
        pattern: string;
        extracted_attribute: string;
        extracted_value: string;
    } | undefined;
}, {
    original_attribute: string;
    normalized_attribute: string;
    synonyms_matched: string[];
    implicit_extraction?: {
        pattern: string;
        extracted_attribute: string;
        extracted_value: string;
    } | undefined;
}>;
/**
 * Tier 2: Pattern detection result.
 */
interface PatternDetection {
    triggers_found: string[];
    entity_nearby: boolean;
    has_value: boolean;
    temporal_signal: boolean;
    disqualifiers_found: string[];
    confidence_score: number;
}
declare const PatternDetectionSchema: z.ZodObject<{
    triggers_found: z.ZodArray<z.ZodString, "many">;
    entity_nearby: z.ZodBoolean;
    has_value: z.ZodBoolean;
    temporal_signal: z.ZodBoolean;
    disqualifiers_found: z.ZodArray<z.ZodString, "many">;
    confidence_score: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    triggers_found: string[];
    entity_nearby: boolean;
    has_value: boolean;
    temporal_signal: boolean;
    disqualifiers_found: string[];
    confidence_score: number;
}, {
    triggers_found: string[];
    entity_nearby: boolean;
    has_value: boolean;
    temporal_signal: boolean;
    disqualifiers_found: string[];
    confidence_score: number;
}>;
/**
 * Tier 2.5: Classifier result.
 */
interface ClassifierResult {
    is_correction: boolean;
    confidence: number;
    model_used: 'few_shot' | 'fine_tuned';
}
declare const ClassifierResultSchema: z.ZodObject<{
    is_correction: z.ZodBoolean;
    confidence: z.ZodNumber;
    model_used: z.ZodEnum<["few_shot", "fine_tuned"]>;
}, "strip", z.ZodTypeAny, {
    confidence: number;
    is_correction: boolean;
    model_used: "few_shot" | "fine_tuned";
}, {
    confidence: number;
    is_correction: boolean;
    model_used: "few_shot" | "fine_tuned";
}>;
/**
 * Tier 3: LLM detection output.
 */
interface LLMDetectionOutput {
    relationship: 'contradicts' | 'updates' | 'evolves' | 'coexists' | 'unrelated';
    confidence: number;
    reasoning: string;
    which_is_current: 'old' | 'new' | 'both' | 'unclear';
    both_could_be_true: boolean;
    is_time_dependent: boolean;
    needs_user_input: boolean;
}
declare const LLMDetectionOutputSchema: z.ZodObject<{
    relationship: z.ZodEnum<["contradicts", "updates", "evolves", "coexists", "unrelated"]>;
    confidence: z.ZodNumber;
    reasoning: z.ZodString;
    which_is_current: z.ZodEnum<["old", "new", "both", "unclear"]>;
    both_could_be_true: z.ZodBoolean;
    is_time_dependent: z.ZodBoolean;
    needs_user_input: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    relationship: "contradicts" | "updates" | "evolves" | "coexists" | "unrelated";
    confidence: number;
    reasoning: string;
    which_is_current: "unclear" | "old" | "new" | "both";
    both_could_be_true: boolean;
    is_time_dependent: boolean;
    needs_user_input: boolean;
}, {
    relationship: "contradicts" | "updates" | "evolves" | "coexists" | "unrelated";
    confidence: number;
    reasoning: string;
    which_is_current: "unclear" | "old" | "new" | "both";
    both_could_be_true: boolean;
    is_time_dependent: boolean;
    needs_user_input: boolean;
}>;
/**
 * Tier 4: Verification output.
 */
interface VerificationOutput {
    should_supersede: boolean;
    confidence: number;
    concerns: string[];
    recommendation: 'auto_supersede' | 'queue_for_user' | 'keep_both';
}
declare const VerificationOutputSchema: z.ZodObject<{
    should_supersede: z.ZodBoolean;
    confidence: z.ZodNumber;
    concerns: z.ZodArray<z.ZodString, "many">;
    recommendation: z.ZodEnum<["auto_supersede", "queue_for_user", "keep_both"]>;
}, "strip", z.ZodTypeAny, {
    confidence: number;
    should_supersede: boolean;
    concerns: string[];
    recommendation: "keep_both" | "queue_for_user" | "auto_supersede";
}, {
    confidence: number;
    should_supersede: boolean;
    concerns: string[];
    recommendation: "keep_both" | "queue_for_user" | "auto_supersede";
}>;
/**
 * Full pipeline result.
 */
interface DetectionPipelineResult {
    final_tier: DetectionTier;
    conflict_detected: boolean;
    conflict_type?: ConflictType;
    overall_confidence: number;
    auto_supersede: boolean;
    needs_user_resolution: boolean;
    tier_results: TierResult[];
    total_time_ms: number;
    total_cost: number;
}
declare const DetectionPipelineResultSchema: z.ZodObject<{
    final_tier: z.ZodEnum<["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM", "VERIFICATION"]>;
    conflict_detected: z.ZodBoolean;
    conflict_type: z.ZodOptional<z.ZodEnum<["FACT_UPDATE", "CORRECTION", "BELIEF_CONTRADICTION", "BELIEF_EVOLUTION", "SOURCE_CONFLICT", "AMBIGUOUS"]>>;
    overall_confidence: z.ZodNumber;
    auto_supersede: z.ZodBoolean;
    needs_user_resolution: z.ZodBoolean;
    tier_results: z.ZodArray<z.ZodObject<{
        tier: z.ZodEnum<["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM", "VERIFICATION"]>;
        detected: z.ZodBoolean;
        confidence: z.ZodNumber;
        conflict_type: z.ZodOptional<z.ZodEnum<["FACT_UPDATE", "CORRECTION", "BELIEF_CONTRADICTION", "BELIEF_EVOLUTION", "SOURCE_CONFLICT", "AMBIGUOUS"]>>;
        should_continue: z.ZodBoolean;
        reasoning: z.ZodOptional<z.ZodString>;
        time_ms: z.ZodNumber;
        cost: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        time_ms: number;
        tier: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
        detected: boolean;
        should_continue: boolean;
        cost: number;
        reasoning?: string | undefined;
        conflict_type?: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT" | undefined;
    }, {
        confidence: number;
        time_ms: number;
        tier: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
        detected: boolean;
        should_continue: boolean;
        cost: number;
        reasoning?: string | undefined;
        conflict_type?: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT" | undefined;
    }>, "many">;
    total_time_ms: z.ZodNumber;
    total_cost: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    conflict_detected: boolean;
    auto_supersede: boolean;
    final_tier: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
    overall_confidence: number;
    needs_user_resolution: boolean;
    tier_results: {
        confidence: number;
        time_ms: number;
        tier: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
        detected: boolean;
        should_continue: boolean;
        cost: number;
        reasoning?: string | undefined;
        conflict_type?: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT" | undefined;
    }[];
    total_time_ms: number;
    total_cost: number;
    conflict_type?: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT" | undefined;
}, {
    conflict_detected: boolean;
    auto_supersede: boolean;
    final_tier: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
    overall_confidence: number;
    needs_user_resolution: boolean;
    tier_results: {
        confidence: number;
        time_ms: number;
        tier: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
        detected: boolean;
        should_continue: boolean;
        cost: number;
        reasoning?: string | undefined;
        conflict_type?: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT" | undefined;
    }[];
    total_time_ms: number;
    total_cost: number;
    conflict_type?: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT" | undefined;
}>;
/**
 * Configuration for each superseded state.
 */
interface SupersededStateConfig {
    state: SupersededState;
    r_threshold_min?: number;
    r_threshold_max?: number;
    decay_multiplier: number;
    retrieval_mode: 'normal_excluded' | 'history_only' | 'audit_only' | 'none';
    content_state: 'full' | 'summarized' | 'reference_only' | 'deleted';
    duration_days?: number;
}
declare const SupersededStateConfigSchema: z.ZodObject<{
    state: z.ZodEnum<["SUPERSEDED_ACTIVE", "SUPERSEDED_FADING", "SUPERSEDED_DORMANT", "SUPERSEDED_ARCHIVED", "SUPERSEDED_DELETED"]>;
    r_threshold_min: z.ZodOptional<z.ZodNumber>;
    r_threshold_max: z.ZodOptional<z.ZodNumber>;
    decay_multiplier: z.ZodNumber;
    retrieval_mode: z.ZodEnum<["normal_excluded", "history_only", "audit_only", "none"]>;
    content_state: z.ZodEnum<["full", "summarized", "reference_only", "deleted"]>;
    duration_days: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    state: "SUPERSEDED_ACTIVE" | "SUPERSEDED_FADING" | "SUPERSEDED_DORMANT" | "SUPERSEDED_ARCHIVED" | "SUPERSEDED_DELETED";
    decay_multiplier: number;
    retrieval_mode: "none" | "normal_excluded" | "history_only" | "audit_only";
    content_state: "full" | "summarized" | "reference_only" | "deleted";
    r_threshold_min?: number | undefined;
    r_threshold_max?: number | undefined;
    duration_days?: number | undefined;
}, {
    state: "SUPERSEDED_ACTIVE" | "SUPERSEDED_FADING" | "SUPERSEDED_DORMANT" | "SUPERSEDED_ARCHIVED" | "SUPERSEDED_DELETED";
    decay_multiplier: number;
    retrieval_mode: "none" | "normal_excluded" | "history_only" | "audit_only";
    content_state: "full" | "summarized" | "reference_only" | "deleted";
    r_threshold_min?: number | undefined;
    r_threshold_max?: number | undefined;
    duration_days?: number | undefined;
}>;
/**
 * Fields added to a node when superseded.
 */
interface SupersessionFields {
    superseded_by?: string;
    superseded_at?: string;
    superseded_state?: SupersededState;
    decay_rate_multiplier?: number;
    access_count_since_superseded?: number;
    dormant_since?: string;
    archived_at?: string;
}
declare const SupersessionFieldsSchema: z.ZodObject<{
    superseded_by: z.ZodOptional<z.ZodString>;
    superseded_at: z.ZodOptional<z.ZodString>;
    superseded_state: z.ZodOptional<z.ZodEnum<["SUPERSEDED_ACTIVE", "SUPERSEDED_FADING", "SUPERSEDED_DORMANT", "SUPERSEDED_ARCHIVED", "SUPERSEDED_DELETED"]>>;
    decay_rate_multiplier: z.ZodOptional<z.ZodNumber>;
    access_count_since_superseded: z.ZodOptional<z.ZodNumber>;
    dormant_since: z.ZodOptional<z.ZodString>;
    archived_at: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    superseded_by?: string | undefined;
    superseded_at?: string | undefined;
    superseded_state?: "SUPERSEDED_ACTIVE" | "SUPERSEDED_FADING" | "SUPERSEDED_DORMANT" | "SUPERSEDED_ARCHIVED" | "SUPERSEDED_DELETED" | undefined;
    decay_rate_multiplier?: number | undefined;
    access_count_since_superseded?: number | undefined;
    dormant_since?: string | undefined;
    archived_at?: string | undefined;
}, {
    superseded_by?: string | undefined;
    superseded_at?: string | undefined;
    superseded_state?: "SUPERSEDED_ACTIVE" | "SUPERSEDED_FADING" | "SUPERSEDED_DORMANT" | "SUPERSEDED_ARCHIVED" | "SUPERSEDED_DELETED" | undefined;
    decay_rate_multiplier?: number | undefined;
    access_count_since_superseded?: number | undefined;
    dormant_since?: string | undefined;
    archived_at?: string | undefined;
}>;
/**
 * Deletion criteria result.
 */
interface DeletionCriteriaResult {
    eligible: boolean;
    criteria: {
        archived_long_enough: boolean;
        days_archived: number;
        no_accesses: boolean;
        access_count: number;
        no_important_edges: boolean;
        max_edge_strength: number;
        superseding_active: boolean;
        superseding_node_state?: string;
        raw_in_archive: boolean;
    };
}
declare const DeletionCriteriaResultSchema: z.ZodObject<{
    eligible: z.ZodBoolean;
    criteria: z.ZodObject<{
        archived_long_enough: z.ZodBoolean;
        days_archived: z.ZodNumber;
        no_accesses: z.ZodBoolean;
        access_count: z.ZodNumber;
        no_important_edges: z.ZodBoolean;
        max_edge_strength: z.ZodNumber;
        superseding_active: z.ZodBoolean;
        superseding_node_state: z.ZodOptional<z.ZodString>;
        raw_in_archive: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        access_count: number;
        days_archived: number;
        archived_long_enough: boolean;
        no_accesses: boolean;
        no_important_edges: boolean;
        max_edge_strength: number;
        superseding_active: boolean;
        raw_in_archive: boolean;
        superseding_node_state?: string | undefined;
    }, {
        access_count: number;
        days_archived: number;
        archived_long_enough: boolean;
        no_accesses: boolean;
        no_important_edges: boolean;
        max_edge_strength: number;
        superseding_active: boolean;
        raw_in_archive: boolean;
        superseding_node_state?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    eligible: boolean;
    criteria: {
        access_count: number;
        days_archived: number;
        archived_long_enough: boolean;
        no_accesses: boolean;
        no_important_edges: boolean;
        max_edge_strength: number;
        superseding_active: boolean;
        raw_in_archive: boolean;
        superseding_node_state?: string | undefined;
    };
}, {
    eligible: boolean;
    criteria: {
        access_count: number;
        days_archived: number;
        archived_long_enough: boolean;
        no_accesses: boolean;
        no_important_edges: boolean;
        max_edge_strength: number;
        superseding_active: boolean;
        raw_in_archive: boolean;
        superseding_node_state?: string | undefined;
    };
}>;
/**
 * State transition event.
 */
interface SupersededStateTransition {
    node_id: string;
    from_state: SupersededState;
    to_state: SupersededState;
    triggered_by: 'decay' | 'time' | 'storage_pressure' | 'user_access';
    timestamp: string;
    context?: {
        retrievability?: number;
        days_in_previous_state?: number;
        user_accessed?: boolean;
    };
}
declare const SupersededStateTransitionSchema: z.ZodObject<{
    node_id: z.ZodString;
    from_state: z.ZodEnum<["SUPERSEDED_ACTIVE", "SUPERSEDED_FADING", "SUPERSEDED_DORMANT", "SUPERSEDED_ARCHIVED", "SUPERSEDED_DELETED"]>;
    to_state: z.ZodEnum<["SUPERSEDED_ACTIVE", "SUPERSEDED_FADING", "SUPERSEDED_DORMANT", "SUPERSEDED_ARCHIVED", "SUPERSEDED_DELETED"]>;
    triggered_by: z.ZodEnum<["decay", "time", "storage_pressure", "user_access"]>;
    timestamp: z.ZodString;
    context: z.ZodOptional<z.ZodObject<{
        retrievability: z.ZodOptional<z.ZodNumber>;
        days_in_previous_state: z.ZodOptional<z.ZodNumber>;
        user_accessed: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        retrievability?: number | undefined;
        days_in_previous_state?: number | undefined;
        user_accessed?: boolean | undefined;
    }, {
        retrievability?: number | undefined;
        days_in_previous_state?: number | undefined;
        user_accessed?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    timestamp: string;
    node_id: string;
    from_state: "SUPERSEDED_ACTIVE" | "SUPERSEDED_FADING" | "SUPERSEDED_DORMANT" | "SUPERSEDED_ARCHIVED" | "SUPERSEDED_DELETED";
    to_state: "SUPERSEDED_ACTIVE" | "SUPERSEDED_FADING" | "SUPERSEDED_DORMANT" | "SUPERSEDED_ARCHIVED" | "SUPERSEDED_DELETED";
    triggered_by: "user_access" | "decay" | "time" | "storage_pressure";
    context?: {
        retrievability?: number | undefined;
        days_in_previous_state?: number | undefined;
        user_accessed?: boolean | undefined;
    } | undefined;
}, {
    timestamp: string;
    node_id: string;
    from_state: "SUPERSEDED_ACTIVE" | "SUPERSEDED_FADING" | "SUPERSEDED_DORMANT" | "SUPERSEDED_ARCHIVED" | "SUPERSEDED_DELETED";
    to_state: "SUPERSEDED_ACTIVE" | "SUPERSEDED_FADING" | "SUPERSEDED_DORMANT" | "SUPERSEDED_ARCHIVED" | "SUPERSEDED_DELETED";
    triggered_by: "user_access" | "decay" | "time" | "storage_pressure";
    context?: {
        retrievability?: number | undefined;
        days_in_previous_state?: number | undefined;
        user_accessed?: boolean | undefined;
    } | undefined;
}>;
/**
 * An item in the conflict resolution queue.
 */
interface ConflictQueueItem {
    id: string;
    old_node_id: string;
    new_content: string;
    new_node_id?: string;
    conflict_type: ConflictType;
    detection_tier: DetectionTier;
    detection_confidence: number;
    context: string;
    created_at: string;
    expires_at: string;
    status: ConflictStatus;
    entity_name?: string;
    topic?: string;
}
declare const ConflictQueueItemSchema: z.ZodObject<{
    id: z.ZodString;
    old_node_id: z.ZodString;
    new_content: z.ZodString;
    new_node_id: z.ZodOptional<z.ZodString>;
    conflict_type: z.ZodEnum<["FACT_UPDATE", "CORRECTION", "BELIEF_CONTRADICTION", "BELIEF_EVOLUTION", "SOURCE_CONFLICT", "AMBIGUOUS"]>;
    detection_tier: z.ZodEnum<["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM", "VERIFICATION"]>;
    detection_confidence: z.ZodNumber;
    context: z.ZodString;
    created_at: z.ZodString;
    expires_at: z.ZodString;
    status: z.ZodEnum<["pending", "resolved", "auto_resolved"]>;
    entity_name: z.ZodOptional<z.ZodString>;
    topic: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "resolved" | "pending" | "auto_resolved";
    id: string;
    created_at: string;
    expires_at: string;
    context: string;
    conflict_type: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT";
    old_node_id: string;
    new_content: string;
    detection_tier: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
    detection_confidence: number;
    new_node_id?: string | undefined;
    entity_name?: string | undefined;
    topic?: string | undefined;
}, {
    status: "resolved" | "pending" | "auto_resolved";
    id: string;
    created_at: string;
    expires_at: string;
    context: string;
    conflict_type: "AMBIGUOUS" | "FACT_UPDATE" | "CORRECTION" | "BELIEF_CONTRADICTION" | "BELIEF_EVOLUTION" | "SOURCE_CONFLICT";
    old_node_id: string;
    new_content: string;
    detection_tier: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
    detection_confidence: number;
    new_node_id?: string | undefined;
    entity_name?: string | undefined;
    topic?: string | undefined;
}>;
/**
 * Contradiction resolution event.
 * Note: Named ContradictionResolution to avoid collision with sync module's ConflictResolution.
 */
interface ContradictionResolution {
    conflict_id: string;
    resolved_by: 'user' | 'auto' | 'timeout';
    resolution: UserResolution;
    resolved_at: string;
    user_merged_content?: string;
    was_override?: boolean;
}
declare const ContradictionResolutionSchema: z.ZodObject<{
    conflict_id: z.ZodString;
    resolved_by: z.ZodEnum<["user", "auto", "timeout"]>;
    resolution: z.ZodEnum<["old_is_current", "new_is_current", "keep_both", "merge"]>;
    resolved_at: z.ZodString;
    user_merged_content: z.ZodOptional<z.ZodString>;
    was_override: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    resolution: "merge" | "keep_both" | "old_is_current" | "new_is_current";
    resolved_at: string;
    resolved_by: "user" | "auto" | "timeout";
    conflict_id: string;
    user_merged_content?: string | undefined;
    was_override?: boolean | undefined;
}, {
    resolution: "merge" | "keep_both" | "old_is_current" | "new_is_current";
    resolved_at: string;
    resolved_by: "user" | "auto" | "timeout";
    conflict_id: string;
    user_merged_content?: string | undefined;
    was_override?: boolean | undefined;
}>;
/**
 * Queue status.
 */
interface ConflictQueueStatus {
    pending_count: number;
    oldest_pending_date?: string;
    next_auto_resolve_date?: string;
    items_resolved_this_week: number;
    at_capacity: boolean;
}
declare const ConflictQueueStatusSchema: z.ZodObject<{
    pending_count: z.ZodNumber;
    oldest_pending_date: z.ZodOptional<z.ZodString>;
    next_auto_resolve_date: z.ZodOptional<z.ZodString>;
    items_resolved_this_week: z.ZodNumber;
    at_capacity: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    pending_count: number;
    items_resolved_this_week: number;
    at_capacity: boolean;
    oldest_pending_date?: string | undefined;
    next_auto_resolve_date?: string | undefined;
}, {
    pending_count: number;
    items_resolved_this_week: number;
    at_capacity: boolean;
    oldest_pending_date?: string | undefined;
    next_auto_resolve_date?: string | undefined;
}>;
/**
 * Conflict presentation for UI.
 */
interface ConflictPresentation {
    conflict_id: string;
    entity_name?: string;
    topic: string;
    version_a: {
        content: string;
        date: string;
        source?: string;
    };
    version_b: {
        content: string;
        date: string;
        source?: string;
    };
    suggested_action?: UserResolution;
    confidence_in_suggestion: number;
    days_until_auto_resolve: number;
}
declare const ConflictPresentationSchema: z.ZodObject<{
    conflict_id: z.ZodString;
    entity_name: z.ZodOptional<z.ZodString>;
    topic: z.ZodString;
    version_a: z.ZodObject<{
        content: z.ZodString;
        date: z.ZodString;
        source: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        date: string;
        content: string;
        source?: string | undefined;
    }, {
        date: string;
        content: string;
        source?: string | undefined;
    }>;
    version_b: z.ZodObject<{
        content: z.ZodString;
        date: z.ZodString;
        source: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        date: string;
        content: string;
        source?: string | undefined;
    }, {
        date: string;
        content: string;
        source?: string | undefined;
    }>;
    suggested_action: z.ZodOptional<z.ZodEnum<["old_is_current", "new_is_current", "keep_both", "merge"]>>;
    confidence_in_suggestion: z.ZodNumber;
    days_until_auto_resolve: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    topic: string;
    conflict_id: string;
    version_a: {
        date: string;
        content: string;
        source?: string | undefined;
    };
    version_b: {
        date: string;
        content: string;
        source?: string | undefined;
    };
    confidence_in_suggestion: number;
    days_until_auto_resolve: number;
    entity_name?: string | undefined;
    suggested_action?: "merge" | "keep_both" | "old_is_current" | "new_is_current" | undefined;
}, {
    topic: string;
    conflict_id: string;
    version_a: {
        date: string;
        content: string;
        source?: string | undefined;
    };
    version_b: {
        date: string;
        content: string;
        source?: string | undefined;
    };
    confidence_in_suggestion: number;
    days_until_auto_resolve: number;
    entity_name?: string | undefined;
    suggested_action?: "merge" | "keep_both" | "old_is_current" | "new_is_current" | undefined;
}>;
/**
 * Queue configuration.
 */
interface ConflictQueueConfig {
    max_items: number;
    auto_resolve_days: number;
    auto_resolve_strategy: UserResolution;
    weekly_prompt_enabled: boolean;
    weekly_prompt_day: number;
}
declare const ConflictQueueConfigSchema: z.ZodObject<{
    max_items: z.ZodNumber;
    auto_resolve_days: z.ZodNumber;
    auto_resolve_strategy: z.ZodEnum<["old_is_current", "new_is_current", "keep_both", "merge"]>;
    weekly_prompt_enabled: z.ZodBoolean;
    weekly_prompt_day: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    max_items: number;
    auto_resolve_days: number;
    auto_resolve_strategy: "merge" | "keep_both" | "old_is_current" | "new_is_current";
    weekly_prompt_enabled: boolean;
    weekly_prompt_day: number;
}, {
    max_items: number;
    auto_resolve_days: number;
    auto_resolve_strategy: "merge" | "keep_both" | "old_is_current" | "new_is_current";
    weekly_prompt_enabled: boolean;
    weekly_prompt_day: number;
}>;
/**
 * Accuracy mode configuration.
 */
interface AccuracyModeConfig {
    mode: AccuracyMode;
    description: string;
    tiers_used: DetectionTier[];
    auto_supersede_tiers: DetectionTier[];
    user_involvement: 'high' | 'medium' | 'low' | 'very_high';
    typical_speed_ms: number;
    typical_cost: number;
    expected_accuracy: number;
}
declare const AccuracyModeConfigSchema: z.ZodObject<{
    mode: z.ZodEnum<["FAST", "BALANCED", "THOROUGH", "MANUAL"]>;
    description: z.ZodString;
    tiers_used: z.ZodArray<z.ZodEnum<["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM", "VERIFICATION"]>, "many">;
    auto_supersede_tiers: z.ZodArray<z.ZodEnum<["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM", "VERIFICATION"]>, "many">;
    user_involvement: z.ZodEnum<["high", "medium", "low", "very_high"]>;
    typical_speed_ms: z.ZodNumber;
    typical_cost: z.ZodNumber;
    expected_accuracy: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    description: string;
    mode: "FAST" | "BALANCED" | "THOROUGH" | "MANUAL";
    tiers_used: ("STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION")[];
    auto_supersede_tiers: ("STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION")[];
    user_involvement: "medium" | "high" | "low" | "very_high";
    typical_speed_ms: number;
    typical_cost: number;
    expected_accuracy: number;
}, {
    description: string;
    mode: "FAST" | "BALANCED" | "THOROUGH" | "MANUAL";
    tiers_used: ("STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION")[];
    auto_supersede_tiers: ("STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION")[];
    user_involvement: "medium" | "high" | "low" | "very_high";
    typical_speed_ms: number;
    typical_cost: number;
    expected_accuracy: number;
}>;
/**
 * Detection event log.
 */
interface DetectionEventLog {
    id: string;
    detection_id: string;
    tier_reached: DetectionTier;
    tier_confidence: number;
    auto_resolved: boolean;
    resolution: 'supersede' | 'keep_both' | 'unrelated';
    user_override?: 'agreed' | 'disagreed';
    user_resolution?: UserResolution;
    timestamp: string;
    accuracy_mode: AccuracyMode;
    old_content?: string;
    new_content?: string;
}
declare const DetectionEventLogSchema: z.ZodObject<{
    id: z.ZodString;
    detection_id: z.ZodString;
    tier_reached: z.ZodEnum<["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM", "VERIFICATION"]>;
    tier_confidence: z.ZodNumber;
    auto_resolved: z.ZodBoolean;
    resolution: z.ZodEnum<["supersede", "keep_both", "unrelated"]>;
    user_override: z.ZodOptional<z.ZodEnum<["agreed", "disagreed"]>>;
    user_resolution: z.ZodOptional<z.ZodEnum<["old_is_current", "new_is_current", "keep_both", "merge"]>>;
    timestamp: z.ZodString;
    accuracy_mode: z.ZodEnum<["FAST", "BALANCED", "THOROUGH", "MANUAL"]>;
    old_content: z.ZodOptional<z.ZodString>;
    new_content: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    timestamp: string;
    resolution: "keep_both" | "unrelated" | "supersede";
    auto_resolved: boolean;
    detection_id: string;
    tier_reached: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
    tier_confidence: number;
    accuracy_mode: "FAST" | "BALANCED" | "THOROUGH" | "MANUAL";
    new_content?: string | undefined;
    user_override?: "agreed" | "disagreed" | undefined;
    user_resolution?: "merge" | "keep_both" | "old_is_current" | "new_is_current" | undefined;
    old_content?: string | undefined;
}, {
    id: string;
    timestamp: string;
    resolution: "keep_both" | "unrelated" | "supersede";
    auto_resolved: boolean;
    detection_id: string;
    tier_reached: "STRUCTURAL" | "NORMALIZED" | "PATTERN" | "CLASSIFIER" | "LLM" | "VERIFICATION";
    tier_confidence: number;
    accuracy_mode: "FAST" | "BALANCED" | "THOROUGH" | "MANUAL";
    new_content?: string | undefined;
    user_override?: "agreed" | "disagreed" | undefined;
    user_resolution?: "merge" | "keep_both" | "old_is_current" | "new_is_current" | undefined;
    old_content?: string | undefined;
}>;
/**
 * Accuracy metrics.
 */
interface AccuracyMetrics {
    period_start: string;
    period_end: string;
    per_tier_accuracy: Record<DetectionTier, number | null>;
    false_positive_rate: number;
    false_negative_rate: number;
    auto_supersede_accuracy: number;
    total_detections: number;
    user_resolutions: number;
    by_mode: Record<AccuracyMode, {
        detections: number;
        accuracy: number | null;
    }>;
}
declare const AccuracyMetricsSchema: z.ZodObject<{
    period_start: z.ZodString;
    period_end: z.ZodString;
    per_tier_accuracy: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodNumber>>;
    false_positive_rate: z.ZodNumber;
    false_negative_rate: z.ZodNumber;
    auto_supersede_accuracy: z.ZodNumber;
    total_detections: z.ZodNumber;
    user_resolutions: z.ZodNumber;
    by_mode: z.ZodRecord<z.ZodString, z.ZodObject<{
        detections: z.ZodNumber;
        accuracy: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        detections: number;
        accuracy: number | null;
    }, {
        detections: number;
        accuracy: number | null;
    }>>;
}, "strip", z.ZodTypeAny, {
    period_start: string;
    period_end: string;
    per_tier_accuracy: Record<string, number | null>;
    false_positive_rate: number;
    false_negative_rate: number;
    auto_supersede_accuracy: number;
    total_detections: number;
    user_resolutions: number;
    by_mode: Record<string, {
        detections: number;
        accuracy: number | null;
    }>;
}, {
    period_start: string;
    period_end: string;
    per_tier_accuracy: Record<string, number | null>;
    false_positive_rate: number;
    false_negative_rate: number;
    auto_supersede_accuracy: number;
    total_detections: number;
    user_resolutions: number;
    by_mode: Record<string, {
        detections: number;
        accuracy: number | null;
    }>;
}>;
/**
 * Self-improvement configuration.
 */
interface SelfImprovementConfig {
    classifier_initial_train_examples: number;
    classifier_retrain_examples: number;
    accuracy_alert_threshold: number;
    auto_mode_switch_threshold: number;
}
declare const SelfImprovementConfigSchema: z.ZodObject<{
    classifier_initial_train_examples: z.ZodNumber;
    classifier_retrain_examples: z.ZodNumber;
    accuracy_alert_threshold: z.ZodNumber;
    auto_mode_switch_threshold: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    classifier_initial_train_examples: number;
    classifier_retrain_examples: number;
    accuracy_alert_threshold: number;
    auto_mode_switch_threshold: number;
}, {
    classifier_initial_train_examples: number;
    classifier_retrain_examples: number;
    accuracy_alert_threshold: number;
    auto_mode_switch_threshold: number;
}>;
/**
 * QCS history mode configuration.
 */
interface QCSHistoryModeConfig {
    history_patterns: readonly string[];
    superseded_penalty: number;
}
declare const QCSHistoryModeConfigSchema: z.ZodObject<{
    history_patterns: z.ZodArray<z.ZodString, "many">;
    superseded_penalty: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    history_patterns: string[];
    superseded_penalty: number;
}, {
    history_patterns: string[];
    superseded_penalty: number;
}>;
/**
 * History mode detection result.
 */
interface HistoryModeDetection {
    is_history_mode: boolean;
    matched_patterns: string[];
    suggested_mode: QueryMode;
}
declare const HistoryModeDetectionSchema: z.ZodObject<{
    is_history_mode: z.ZodBoolean;
    matched_patterns: z.ZodArray<z.ZodString, "many">;
    suggested_mode: z.ZodEnum<["current", "as_of", "history", "full_audit"]>;
}, "strip", z.ZodTypeAny, {
    is_history_mode: boolean;
    matched_patterns: string[];
    suggested_mode: "current" | "as_of" | "history" | "full_audit";
}, {
    is_history_mode: boolean;
    matched_patterns: string[];
    suggested_mode: "current" | "as_of" | "history" | "full_audit";
}>;
/**
 * RCS supersession flag.
 */
interface RCSSupersessionFlag {
    flag: 'has_superseded_history';
    trigger: 'top_result_has_superseded_by_chain';
    explanation_text: string;
}
declare const RCSSupersessionFlagSchema: z.ZodObject<{
    flag: z.ZodLiteral<"has_superseded_history">;
    trigger: z.ZodLiteral<"top_result_has_superseded_by_chain">;
    explanation_text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    flag: "has_superseded_history";
    trigger: "top_result_has_superseded_by_chain";
    explanation_text: string;
}, {
    flag: "has_superseded_history";
    trigger: "top_result_has_superseded_by_chain";
    explanation_text: string;
}>;
/**
 * SSA superseded configuration.
 */
interface SSASupersededConfig {
    activation_cap: number;
    spread_decay: number;
    spread_to_superseding: boolean;
}
declare const SSASupersededConfigSchema: z.ZodObject<{
    activation_cap: z.ZodNumber;
    spread_decay: z.ZodNumber;
    spread_to_superseding: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    activation_cap: number;
    spread_decay: number;
    spread_to_superseding: boolean;
}, {
    activation_cap: number;
    spread_decay: number;
    spread_to_superseding: boolean;
}>;
/**
 * Phase 2 context injection configuration.
 */
interface Phase2ContextInjection {
    superseded_context_template: string;
    follow_supersedes_for: readonly string[];
}
declare const Phase2ContextInjectionSchema: z.ZodObject<{
    superseded_context_template: z.ZodString;
    follow_supersedes_for: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    superseded_context_template: string;
    follow_supersedes_for: string[];
}, {
    superseded_context_template: string;
    follow_supersedes_for: string[];
}>;
/**
 * Query mode configuration.
 */
interface QueryModeConfig {
    mode: QueryMode;
    include_superseded: boolean;
    superseded_penalty: number;
    description: string;
}
declare const QueryModeConfigSchema: z.ZodObject<{
    mode: z.ZodEnum<["current", "as_of", "history", "full_audit"]>;
    include_superseded: z.ZodBoolean;
    superseded_penalty: z.ZodNumber;
    description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    description: string;
    mode: "current" | "as_of" | "history" | "full_audit";
    superseded_penalty: number;
    include_superseded: boolean;
}, {
    description: string;
    mode: "current" | "as_of" | "history" | "full_audit";
    superseded_penalty: number;
    include_superseded: boolean;
}>;
/**
 * Combined retrieval integration configuration.
 */
interface RetrievalIntegrationConfig {
    qcs: QCSHistoryModeConfig;
    rcs: RCSSupersessionFlag;
    ssa: SSASupersededConfig;
    phase2: Phase2ContextInjection;
}
declare const RetrievalIntegrationConfigSchema: z.ZodObject<{
    qcs: z.ZodObject<{
        history_patterns: z.ZodArray<z.ZodString, "many">;
        superseded_penalty: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        history_patterns: string[];
        superseded_penalty: number;
    }, {
        history_patterns: string[];
        superseded_penalty: number;
    }>;
    rcs: z.ZodObject<{
        flag: z.ZodLiteral<"has_superseded_history">;
        trigger: z.ZodLiteral<"top_result_has_superseded_by_chain">;
        explanation_text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        flag: "has_superseded_history";
        trigger: "top_result_has_superseded_by_chain";
        explanation_text: string;
    }, {
        flag: "has_superseded_history";
        trigger: "top_result_has_superseded_by_chain";
        explanation_text: string;
    }>;
    ssa: z.ZodObject<{
        activation_cap: z.ZodNumber;
        spread_decay: z.ZodNumber;
        spread_to_superseding: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        activation_cap: number;
        spread_decay: number;
        spread_to_superseding: boolean;
    }, {
        activation_cap: number;
        spread_decay: number;
        spread_to_superseding: boolean;
    }>;
    phase2: z.ZodObject<{
        superseded_context_template: z.ZodString;
        follow_supersedes_for: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        superseded_context_template: string;
        follow_supersedes_for: string[];
    }, {
        superseded_context_template: string;
        follow_supersedes_for: string[];
    }>;
}, "strip", z.ZodTypeAny, {
    rcs: {
        flag: "has_superseded_history";
        trigger: "top_result_has_superseded_by_chain";
        explanation_text: string;
    };
    qcs: {
        history_patterns: string[];
        superseded_penalty: number;
    };
    ssa: {
        activation_cap: number;
        spread_decay: number;
        spread_to_superseding: boolean;
    };
    phase2: {
        superseded_context_template: string;
        follow_supersedes_for: string[];
    };
}, {
    rcs: {
        flag: "has_superseded_history";
        trigger: "top_result_has_superseded_by_chain";
        explanation_text: string;
    };
    qcs: {
        history_patterns: string[];
        superseded_penalty: number;
    };
    ssa: {
        activation_cap: number;
        spread_decay: number;
        spread_to_superseding: boolean;
    };
    phase2: {
        superseded_context_template: string;
        follow_supersedes_for: string[];
    };
}>;
/**
 * Input for Tier 3 LLM detection.
 */
interface Tier3Input {
    entity_name: string;
    entity_type: string;
    attribute: string;
    old_value: string;
    old_date: string;
    old_source: string;
    new_statement: string;
    context: string;
    new_date: string;
    new_source: string;
}
declare const Tier3InputSchema: z.ZodObject<{
    entity_name: z.ZodString;
    entity_type: z.ZodString;
    attribute: z.ZodString;
    old_value: z.ZodString;
    old_date: z.ZodString;
    old_source: z.ZodString;
    new_statement: z.ZodString;
    context: z.ZodString;
    new_date: z.ZodString;
    new_source: z.ZodString;
}, "strip", z.ZodTypeAny, {
    old_value: string;
    context: string;
    attribute: string;
    entity_name: string;
    entity_type: string;
    old_date: string;
    old_source: string;
    new_statement: string;
    new_date: string;
    new_source: string;
}, {
    old_value: string;
    context: string;
    attribute: string;
    entity_name: string;
    entity_type: string;
    old_date: string;
    old_source: string;
    new_statement: string;
    new_date: string;
    new_source: string;
}>;
/**
 * Input for Tier 4 verification.
 */
interface Tier4Input {
    old_value: string;
    entity: string;
    old_date: string;
    new_statement: string;
    new_date: string;
    tier3_result: LLMDetectionOutput;
}
declare const Tier4InputSchema: z.ZodObject<{
    old_value: z.ZodString;
    entity: z.ZodString;
    old_date: z.ZodString;
    new_statement: z.ZodString;
    new_date: z.ZodString;
    tier3_result: z.ZodObject<{
        relationship: z.ZodEnum<["contradicts", "updates", "evolves", "coexists", "unrelated"]>;
        confidence: z.ZodNumber;
        reasoning: z.ZodString;
        which_is_current: z.ZodEnum<["old", "new", "both", "unclear"]>;
        both_could_be_true: z.ZodBoolean;
        is_time_dependent: z.ZodBoolean;
        needs_user_input: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        relationship: "contradicts" | "updates" | "evolves" | "coexists" | "unrelated";
        confidence: number;
        reasoning: string;
        which_is_current: "unclear" | "old" | "new" | "both";
        both_could_be_true: boolean;
        is_time_dependent: boolean;
        needs_user_input: boolean;
    }, {
        relationship: "contradicts" | "updates" | "evolves" | "coexists" | "unrelated";
        confidence: number;
        reasoning: string;
        which_is_current: "unclear" | "old" | "new" | "both";
        both_could_be_true: boolean;
        is_time_dependent: boolean;
        needs_user_input: boolean;
    }>;
}, "strip", z.ZodTypeAny, {
    entity: string;
    old_value: string;
    old_date: string;
    new_statement: string;
    new_date: string;
    tier3_result: {
        relationship: "contradicts" | "updates" | "evolves" | "coexists" | "unrelated";
        confidence: number;
        reasoning: string;
        which_is_current: "unclear" | "old" | "new" | "both";
        both_could_be_true: boolean;
        is_time_dependent: boolean;
        needs_user_input: boolean;
    };
}, {
    entity: string;
    old_value: string;
    old_date: string;
    new_statement: string;
    new_date: string;
    tier3_result: {
        relationship: "contradicts" | "updates" | "evolves" | "coexists" | "unrelated";
        confidence: number;
        reasoning: string;
        which_is_current: "unclear" | "old" | "new" | "both";
        both_could_be_true: boolean;
        is_time_dependent: boolean;
        needs_user_input: boolean;
    };
}>;

/**
 * @module @nous/core/contradiction
 * @description Contradiction Resolution System (CRS) for storm-009
 * @version 1.0.0
 * @spec Specs/Phase-5-Quality-Control/storm-009
 * @storm Brainstorms/Infrastructure/storm-009-contradiction-handling
 *
 * 6-tier detection pipeline, supersession lifecycle, and user conflict resolution.
 */

/**
 * Few-shot classification prompt for Tier 2.5.
 */
declare const CLASSIFIER_FEW_SHOT_PROMPT = "Classify if this text is correcting previous information.\n\nExamples of CORRECTIONS:\n- \"Actually, Sarah's phone is 555-5678\" \u2192 CORRECTION\n- \"I was wrong about the meeting date, it's Thursday\" \u2192 CORRECTION\n- \"Update: The deadline moved to next week\" \u2192 CORRECTION\n\nExamples of NOT corrections:\n- \"Actually, that's a great idea\" \u2192 NOT (agreement)\n- \"I was wrong to doubt you\" \u2192 NOT (apology)\n- \"I actually enjoyed the movie\" \u2192 NOT (emphasis)\n- \"Was I wrong about this?\" \u2192 NOT (question)\n\nText to classify: \"{input_text}\"\nContext: \"{surrounding_sentences}\"\n\nIs this a CORRECTION or NOT? Answer with confidence (0-1).";
/**
 * Structured LLM detection prompt for Tier 3.
 */
declare const LLM_DETECTION_PROMPT = "You are analyzing whether new information contradicts existing information in a personal knowledge base.\n\nEXISTING INFORMATION:\n- Entity: {entity_name}\n- Type: {entity_type}\n- Attribute: {attribute}\n- Current value: \"{old_value}\"\n- Recorded on: {old_date}\n- Source: {old_source}\n\nNEW INFORMATION:\n- Statement: \"{new_statement}\"\n- Context (surrounding text): \"{context}\"\n- Date: {new_date}\n- Source: {new_source}\n\nIMPORTANT: Consider these possibilities:\n1. TRUE CONTRADICTION: The facts cannot both be true\n2. UPDATE: The fact changed over time (both were true at time)\n3. EVOLUTION: The belief/opinion developed (not contradiction)\n4. DIFFERENT CONTEXT: Both could be true in different contexts\n5. UNRELATED: The new info is about something else entirely\n\nRespond with ONLY this JSON (no other text):\n{\n  \"relationship\": \"contradicts|updates|evolves|coexists|unrelated\",\n  \"confidence\": <0.0-1.0>,\n  \"reasoning\": \"<brief explanation in 1-2 sentences>\",\n  \"which_is_current\": \"old|new|both|unclear\",\n  \"both_could_be_true\": <true|false>,\n  \"is_time_dependent\": <true|false>,\n  \"needs_user_input\": <true|false>\n}";
/**
 * Adversarial verification prompt for Tier 4.
 */
declare const VERIFICATION_PROMPT = "A detection system believes these two pieces of information CONTRADICT each other:\n\nEXISTING: \"{old_value}\" (about {entity}, recorded {old_date})\nNEW: \"{new_statement}\" (from {new_date})\n\nThe system wants to AUTOMATICALLY mark the old information as superseded by the new information.\n\nYOUR JOB: Find reasons this might be WRONG. Consider:\n- Could they be about different things? (different Sarah?)\n- Could both be true? (different contexts, times, aspects?)\n- Is the \"new\" information actually a correction?\n- Could this be a misunderstanding or ambiguity?\n\nRespond with ONLY this JSON:\n{\n  \"should_supersede\": <true|false>,\n  \"confidence\": <0.0-1.0>,\n  \"concerns\": [\"<concern1>\", \"<concern2>\"] or [],\n  \"recommendation\": \"auto_supersede|queue_for_user|keep_both\"\n}";
/**
 * Superseded state configurations.
 */
declare const SUPERSEDED_STATE_CONFIGS: Record<SupersededState, SupersededStateConfig>;
/**
 * Accuracy mode configurations.
 */
declare const ACCURACY_MODE_CONFIGS: Record<AccuracyMode, AccuracyModeConfig>;
/**
 * Query mode configurations.
 */
declare const QUERY_MODE_CONFIGS: Record<QueryMode, QueryModeConfig>;
/**
 * Default conflict queue configuration.
 */
declare const DEFAULT_QUEUE_CONFIG: ConflictQueueConfig;
/**
 * Default self-improvement configuration.
 */
declare const DEFAULT_SELF_IMPROVEMENT_CONFIG: SelfImprovementConfig;
/**
 * QCS history mode configuration.
 */
declare const QCS_HISTORY_MODE_CONFIG: QCSHistoryModeConfig;
/**
 * RCS supersession flag configuration.
 */
declare const RCS_SUPERSESSION_FLAG: RCSSupersessionFlag;
/**
 * SSA superseded configuration.
 */
declare const SSA_SUPERSEDED_CONFIG: SSASupersededConfig;
/**
 * Phase 2 context injection configuration.
 */
declare const PHASE2_CONTEXT_INJECTION: Phase2ContextInjection;
/**
 * Default retrieval integration configuration.
 */
declare const DEFAULT_RETRIEVAL_INTEGRATION_CONFIG: RetrievalIntegrationConfig;
/**
 * Detection criteria for each conflict type.
 */
interface TypeDetectionCriteria {
    type: ConflictType;
    priority: number;
    matches: (context: DetectionContext) => boolean;
    confidence: number;
    auto_supersede: boolean;
    resolution: 'supersede_old' | 'keep_both_linked' | 'keep_both_unlinked' | 'queue_for_user' | 'source_ranking';
}
declare const TYPE_DETECTION_CRITERIA: TypeDetectionCriteria[];
/**
 * Calculates days since a given ISO timestamp.
 */
declare function daysSince(isoTimestamp: string): number;
/**
 * Generates a unique conflict ID.
 */
declare function generateConflictId(): string;
/**
 * Generates a unique event ID.
 */
declare function generateEventId(): string;
/**
 * Formats a date for timeline display.
 */
declare function formatDate(isoTimestamp: string): string;
/**
 * Classifies a potential contradiction into one of 6 types.
 */
declare function classifyConflictType(_old_node: NousNode, _new_content: string, context: DetectionContext): TypeClassification;
/**
 * Checks if a conflict type auto-supersedes.
 */
declare function isAutoSupersede(type: ConflictType): boolean;
/**
 * Gets the resolution strategy for a conflict type.
 */
declare function getResolutionStrategy(type: ConflictType): string;
/**
 * Determines the winning node in a source conflict.
 */
declare function resolveSourceConflict(old_confidence: number, new_confidence: number): 'old' | 'new';
/**
 * Detects if two statements have opposite sentiments.
 */
declare function hasSentimentFlip(old_sentiment: Sentiment, new_sentiment: Sentiment): boolean;
/**
 * Runs Tier 2: Contextual pattern detection.
 */
declare function runTier2Pattern(content: string): PatternDetection;
/**
 * Calculates pattern confidence score.
 */
declare function calculatePatternConfidence(detection: PatternDetection): number;
/**
 * Runs Tier 1.5: Attribute normalization.
 */
declare function runTier1_5Normalization(attribute: string, _content: string): NormalizationResult;
/**
 * Determines if pipeline should continue to next tier.
 */
declare function shouldContinueToNextTier(result: TierResult, mode: AccuracyMode): boolean;
/**
 * Determines if auto-supersession is allowed.
 */
declare function canAutoSupersede(tier3_result: LLMDetectionOutput | undefined, tier4_result: VerificationOutput | undefined, mode: AccuracyMode): boolean;
/**
 * Determines the current superseded state based on node properties.
 */
declare function determineSupersededState(node: NousNode & Partial<SupersessionFields>): SupersededState;
/**
 * Gets the decay multiplier for a superseded state.
 */
declare function getDecayMultiplier(state: SupersededState): number;
/**
 * Gets the decay multiplier accounting for user access.
 */
declare function getEffectiveDecayMultiplier(state: SupersededState, userAccessed: boolean): number;
/**
 * Checks if a node should transition to a new superseded state.
 */
declare function checkStateTransition(node: NousNode & Partial<SupersessionFields>): SupersededStateTransition | null;
/**
 * Checks if a superseded node meets all 5 deletion criteria.
 */
declare function checkDeletionCriteria(node: NousNode & Partial<SupersessionFields>, supersedingNode: NousNode | null, maxIncomingEdgeStrength: number, rawInArchive: boolean): DeletionCriteriaResult;
/**
 * Checks if system is under storage pressure.
 */
declare function isStoragePressure(currentCapacity: number): boolean;
/**
 * Gets the retrieval mode for a superseded state.
 */
declare function getRetrievalMode(state: SupersededState): SupersededStateConfig['retrieval_mode'];
/**
 * Gets the content state for a superseded state.
 */
declare function getContentState(state: SupersededState): SupersededStateConfig['content_state'];
/**
 * Creates a new conflict queue item.
 */
declare function createConflictQueueItem(data: Omit<ConflictQueueItem, 'id' | 'created_at' | 'expires_at' | 'status'>): ConflictQueueItem;
/**
 * Adds an item to the conflict queue.
 */
declare function addToConflictQueue(queue: ConflictQueueItem[], item: ConflictQueueItem): {
    queue: ConflictQueueItem[];
    auto_resolved: ContradictionResolution[];
};
/**
 * Gets all pending conflicts from the queue.
 */
declare function getPendingConflicts(queue: ConflictQueueItem[]): ConflictQueueItem[];
/**
 * Resolves a conflict with user's choice.
 */
declare function resolveConflict(queue: ConflictQueueItem[], conflict_id: string, resolution: UserResolution, merged_content?: string): ContradictionResolution;
/**
 * Processes all expired conflicts.
 */
declare function processExpiredConflicts(queue: ConflictQueueItem[]): ContradictionResolution[];
/**
 * Gets current queue status.
 */
declare function getQueueStatus(queue: ConflictQueueItem[]): ConflictQueueStatus;
/**
 * Formats a conflict for presentation to user.
 */
declare function formatForPresentation(item: ConflictQueueItem, old_node_content: string, old_node_date: string): ConflictPresentation;
/**
 * Checks if weekly prompt should be shown.
 */
declare function shouldShowWeeklyPrompt(queue: ConflictQueueItem[], config?: ConflictQueueConfig): boolean;
/**
 * Gets the configuration for an accuracy mode.
 */
declare function getAccuracyModeConfig(mode: AccuracyMode): AccuracyModeConfig;
/**
 * Checks if a tier should be used in a given mode.
 */
declare function shouldUseTier(tier: DetectionTier, mode: AccuracyMode): boolean;
/**
 * Checks if a tier can trigger auto-supersession in a given mode.
 */
declare function canAutoSupersedeTier(tier: DetectionTier, mode: AccuracyMode): boolean;
/**
 * Logs a detection event.
 */
declare function logDetectionEvent(event: Omit<DetectionEventLog, 'id' | 'timestamp'>): DetectionEventLog;
/**
 * Computes weekly accuracy metrics.
 */
declare function computeWeeklyMetrics(events: DetectionEventLog[], periodStart: string, periodEnd: string): AccuracyMetrics;
/**
 * Checks for accuracy alerts.
 */
declare function checkAccuracyAlerts(metrics: AccuracyMetrics, config?: SelfImprovementConfig): string[];
/**
 * Checks if classifier should be trained/retrained.
 */
declare function shouldTrainClassifier(trainingExamples: number, hasExistingModel: boolean, config?: SelfImprovementConfig): {
    train: boolean;
    retrain: boolean;
};
/**
 * Gets training data from detection events.
 */
declare function getTrainingData(events: DetectionEventLog[]): DetectionEventLog[];
/**
 * Gets the accuracy target for a tier.
 */
declare function getAccuracyTarget(tier: DetectionTier): number;
/**
 * Checks if a query should enable history mode.
 */
declare function detectHistoryMode(query: string): HistoryModeDetection;
/**
 * Applies activation cap to a superseded node.
 */
declare function applySupersededCap(activation: number, node: NousNode & Partial<SupersessionFields>): number;
/**
 * Calculates spread activation from a superseded node.
 */
declare function calculateSupersededSpread(activation: number, isSuperseded: boolean): number;
/**
 * Injects supersession context for Phase 2 LLM traversal.
 */
declare function injectSupersessionContext(node: NousNode, supersedingContent: string): string;
/**
 * Checks if supersedes edges should be followed for a query.
 */
declare function shouldFollowSupersedesEdges(query: string): boolean;
/**
 * Builds a history timeline from a supersession chain.
 */
declare function buildHistoryTimeline(chain: NousNode[]): string;
/**
 * Gets the query mode configuration.
 */
declare function getQueryModeConfig(mode: QueryMode): QueryModeConfig;
/**
 * Checks if superseded nodes should be included for a query mode.
 */
declare function shouldIncludeSuperseded(mode: QueryMode): boolean;
/**
 * Gets the superseded penalty for a query mode.
 */
declare function getSupersededPenalty(mode: QueryMode): number;
/**
 * Checks if RCS should flag supersession history.
 */
declare function shouldFlagSupersessionHistory(topResults: (NousNode & Partial<SupersessionFields>)[]): boolean;

export { ACCURACY_MODES, ACCURACY_MODE_CONFIGS, ACCURACY_TARGETS, ATTRIBUTE_SYNONYMS, AUTO_SUPERSEDE_ACCURACY_TARGET, type AccuracyMetrics, AccuracyMetricsSchema, type AccuracyMode, type AccuracyModeConfig, AccuracyModeConfigSchema, AccuracyModeSchema, CLASSIFIER_FEW_SHOT_PROMPT, CLASSIFIER_TRAINING, CONFLICT_QUEUE_CONFIG, CONFLICT_STATUSES, CONFLICT_TYPES, CONFLICT_TYPE_RESOLUTION, type ClassifierResult, ClassifierResultSchema, type ConflictPresentation, ConflictPresentationSchema, type ConflictQueueConfig, ConflictQueueConfigSchema, type ConflictQueueItem, ConflictQueueItemSchema, type ConflictQueueStatus, ConflictQueueStatusSchema, type ConflictStatus, ConflictStatusSchema, type ConflictType, ConflictTypeSchema, type ContradictionResolution, ContradictionResolutionSchema, DEFAULT_QUEUE_CONFIG, DEFAULT_RETRIEVAL_INTEGRATION_CONFIG, DEFAULT_SELF_IMPROVEMENT_CONFIG, DELETION_CRITERIA, DETECTION_TIERS, DETECTION_TIER_METADATA, type DeletionCriteriaResult, DeletionCriteriaResultSchema, type DetectionContext, DetectionContextSchema, type DetectionEventLog, DetectionEventLogSchema, type DetectionPipelineResult, DetectionPipelineResultSchema, type DetectionTier, DetectionTierSchema, ENTITY_NEARBY_DISTANCE, HISTORY_MODE_PATTERNS, HISTORY_MODE_SUPERSEDED_PENALTY, type HistoryModeDetection, HistoryModeDetectionSchema, type LLMDetectionOutput, LLMDetectionOutputSchema, LLM_DETECTION_PROMPT, type NormalizationResult, NormalizationResultSchema, PATTERN_CONFIDENCE_WEIGHTS, PATTERN_DISQUALIFIERS, PATTERN_TRIGGERS, PHASE2_CONTEXT_INJECTION, type PatternDetection, PatternDetectionSchema, type Phase2ContextInjection, Phase2ContextInjectionSchema, type QCSHistoryModeConfig, QCSHistoryModeConfigSchema, QCS_HISTORY_MODE_CONFIG, QUERY_MODES, QUERY_MODE_CONFIGS, type QueryMode, type QueryModeConfig, QueryModeConfigSchema, QueryModeSchema, type RCSSupersessionFlag, RCSSupersessionFlagSchema, RCS_SUPERSESSION_FLAG, RESOLUTION_STRATEGIES, type ResolutionStrategy, ResolutionStrategySchema, type RetrievalIntegrationConfig, RetrievalIntegrationConfigSchema, SENTIMENTS, type SSASupersededConfig, SSASupersededConfigSchema, SSA_SUPERSEDED_ACTIVATION_CAP, SSA_SUPERSEDED_CONFIG, SSA_SUPERSEDED_SPREAD_DECAY, STORAGE_PRESSURE_THRESHOLD, SUPERSEDED_ACCESS_DECAY_MULTIPLIER, SUPERSEDED_DECAY_MULTIPLIERS, SUPERSEDED_DORMANT_DAYS, SUPERSEDED_R_THRESHOLDS, SUPERSEDED_STATES, SUPERSEDED_STATE_CONFIGS, type SelfImprovementConfig, SelfImprovementConfigSchema, type Sentiment, SentimentSchema, type StructuralDetection, StructuralDetectionSchema, type SupersededState, type SupersededStateConfig, SupersededStateConfigSchema, SupersededStateSchema, type SupersededStateTransition, SupersededStateTransitionSchema, type SupersessionFields, SupersessionFieldsSchema, TIER_THRESHOLDS, TYPE_DETECTION_CRITERIA, type Tier3Input, Tier3InputSchema, type Tier4Input, Tier4InputSchema, type TierResult, TierResultSchema, type TypeClassification, TypeClassificationSchema, type TypeDetectionCriteria, USER_RESOLUTIONS, USER_RESOLUTION_DESCRIPTIONS, type UserResolution, UserResolutionSchema, VERIFICATION_PROMPT, type VerificationOutput, VerificationOutputSchema, addToConflictQueue, applySupersededCap, buildHistoryTimeline, calculatePatternConfidence, calculateSupersededSpread, canAutoSupersede, canAutoSupersedeTier, checkAccuracyAlerts, checkDeletionCriteria, checkStateTransition, classifyConflictType, computeWeeklyMetrics, createConflictQueueItem, daysSince, detectHistoryMode, determineSupersededState, formatDate, formatForPresentation, generateConflictId, generateEventId, getAccuracyModeConfig, getAccuracyTarget, getContentState, getDecayMultiplier, getEffectiveDecayMultiplier, getPendingConflicts, getQueryModeConfig, getQueueStatus, getResolutionStrategy, getRetrievalMode, getSupersededPenalty, getTrainingData, hasSentimentFlip, injectSupersessionContext, isAccuracyMode, isAutoSupersede, isConflictType, isDetectionTier, isQueryMode, isStoragePressure, isSupersededState, logDetectionEvent, processExpiredConflicts, resolveConflict, resolveSourceConflict, runTier1_5Normalization, runTier2Pattern, shouldContinueToNextTier, shouldFlagSupersessionHistory, shouldFollowSupersedesEdges, shouldIncludeSuperseded, shouldShowWeeklyPrompt, shouldTrainClassifier, shouldUseTier };
