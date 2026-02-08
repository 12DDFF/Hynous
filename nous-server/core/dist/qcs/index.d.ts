import { z } from 'zod';
import { ConfidenceLevel } from '../params/index.js';

/**
 * @module @nous/core/qcs
 * @description Query Classification System
 * @version 1.0.0
 * @spec Brainstorms/Specs/Phase-3-Retrieval-Core/storm-008
 * @storm Brainstorms/Infrastructure/storm-008-query-classification
 *
 * This module implements storm-008: Query Classification System.
 *
 * Two-Stage Architecture:
 * 1. Disqualifier Check - Fast-fail patterns that always need Phase 2
 * 2. Two-Factor Analysis - Query Type + Retrieval Confidence System (RCS)
 *
 * Core Decision Rule:
 * LOOKUP query + HIGH confidence + no blocking flags = Skip Phase 2
 *
 * Key integrations:
 * - storm-005: SSAResult for retrieval context
 * - storm-028: RCS functions (calculateRetrievalConfidence, getConfidenceLevel)
 */

/**
 * Disqualifier categories for Stage 1.
 * Queries matching these patterns always require Phase 2.
 */
declare const DISQUALIFIER_CATEGORIES: readonly ["D1", "D2", "D3", "D4", "D5", "D6"];
type DisqualifierCategory = (typeof DISQUALIFIER_CATEGORIES)[number];
/**
 * Query types for classification.
 * LOOKUP: Seeking specific attribute from specific entity
 * AMBIGUOUS: Unclear what's being asked
 */
declare const QCS_QUERY_TYPES: readonly ["LOOKUP", "AMBIGUOUS"];
type QCSQueryType = (typeof QCS_QUERY_TYPES)[number];
/**
 * Skip decisions for Phase 2.
 * SKIP: Answer directly from Phase 1
 * SKIP_WITH_CAVEAT: Answer with uncertainty note
 * PHASE2: Proceed to LLM reasoning
 */
declare const SKIP_DECISIONS: readonly ["SKIP", "SKIP_WITH_CAVEAT", "PHASE2"];
type SkipDecision = (typeof SKIP_DECISIONS)[number];
/**
 * D1: Reasoning keywords
 * Queries that require understanding relationships or explanations.
 */
declare const D1_REASONING_PATTERNS: RegExp[];
/**
 * D2: Negation patterns
 * Queries involving absence or exclusion.
 */
declare const D2_NEGATION_PATTERNS: RegExp[];
/**
 * D3: Time reference patterns
 * Queries involving temporal context.
 */
declare const D3_TIME_PATTERNS: RegExp[];
/**
 * D4: Compound query patterns
 * Multiple questions in one query.
 */
declare const D4_COMPOUND_PATTERNS: RegExp[];
/**
 * D5: Unresolved reference patterns
 * Pronouns or references without clear antecedent.
 */
declare const D5_REFERENCE_PATTERNS: RegExp[];
/**
 * D6: Exploration signal patterns
 * Queries seeking discovery rather than retrieval.
 */
declare const D6_EXPLORATION_PATTERNS: RegExp[];
/**
 * All disqualifier patterns grouped by category.
 */
declare const DISQUALIFIER_PATTERNS: Record<DisqualifierCategory, RegExp[]>;
/**
 * Patterns that indicate a LOOKUP query type.
 * Format: Entity + Attribute seeking patterns.
 */
declare const LOOKUP_PATTERNS: RegExp[];
/**
 * Keywords that boost LOOKUP confidence.
 * These indicate the user is seeking a specific attribute.
 */
declare const ATTRIBUTE_KEYWORDS: string[];
/**
 * Result of Stage 1 disqualifier check.
 */
interface DisqualifierResult {
    /** Whether the query is disqualified (requires Phase 2) */
    disqualified: boolean;
    /** Human-readable reason for disqualification */
    reason?: string;
    /** Which category matched */
    category?: DisqualifierCategory;
    /** The pattern that matched (for debugging) */
    pattern?: string;
}
declare const DisqualifierResultSchema: z.ZodObject<{
    disqualified: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
    category: z.ZodOptional<z.ZodEnum<["D1", "D2", "D3", "D4", "D5", "D6"]>>;
    pattern: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    disqualified: boolean;
    pattern?: string | undefined;
    reason?: string | undefined;
    category?: "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | undefined;
}, {
    disqualified: boolean;
    pattern?: string | undefined;
    reason?: string | undefined;
    category?: "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | undefined;
}>;
/**
 * Result of Stage 2a query type classification.
 */
interface QueryTypeResult {
    /** Classified query type */
    type: QCSQueryType;
    /** Extracted entity name(s) if LOOKUP */
    entity?: string;
    /** Extracted attribute being sought if LOOKUP */
    attribute?: string;
    /** Confidence in classification (0-1) */
    confidence: number;
}
declare const QueryTypeResultSchema: z.ZodObject<{
    type: z.ZodEnum<["LOOKUP", "AMBIGUOUS"]>;
    entity: z.ZodOptional<z.ZodString>;
    attribute: z.ZodOptional<z.ZodString>;
    confidence: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "LOOKUP" | "AMBIGUOUS";
    confidence: number;
    entity?: string | undefined;
    attribute?: string | undefined;
}, {
    type: "LOOKUP" | "AMBIGUOUS";
    confidence: number;
    entity?: string | undefined;
    attribute?: string | undefined;
}>;
/**
 * Complete classification result.
 */
interface ClassificationResult {
    /** Original query */
    query: string;
    /** Classified query type */
    queryType: QueryTypeResult;
    /** Retrieval Confidence System result */
    rcs: {
        score: number;
        level: ConfidenceLevel;
        flags: string[];
    };
    /** Final decision */
    decision: SkipDecision;
    /** Explanation of decision */
    explanation: string;
    /** Handoff metadata if proceeding to Phase 2 */
    handoff?: Phase2HandoffMetadata;
}
declare const ClassificationResultSchema: z.ZodObject<{
    query: z.ZodString;
    queryType: z.ZodObject<{
        type: z.ZodEnum<["LOOKUP", "AMBIGUOUS"]>;
        entity: z.ZodOptional<z.ZodString>;
        attribute: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "LOOKUP" | "AMBIGUOUS";
        confidence: number;
        entity?: string | undefined;
        attribute?: string | undefined;
    }, {
        type: "LOOKUP" | "AMBIGUOUS";
        confidence: number;
        entity?: string | undefined;
        attribute?: string | undefined;
    }>;
    rcs: z.ZodObject<{
        score: z.ZodNumber;
        level: z.ZodEnum<["HIGH", "MEDIUM", "LOW"]>;
        flags: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        level: "HIGH" | "MEDIUM" | "LOW";
        score: number;
        flags: string[];
    }, {
        level: "HIGH" | "MEDIUM" | "LOW";
        score: number;
        flags: string[];
    }>;
    decision: z.ZodEnum<["SKIP", "SKIP_WITH_CAVEAT", "PHASE2"]>;
    explanation: z.ZodString;
    handoff: z.ZodOptional<z.ZodLazy<z.ZodObject<{
        classification_reason: z.ZodEnum<["reasoning_query", "low_confidence", "no_answer_found", "disambiguation", "compound_query", "time_reference", "exploration", "unresolved_reference", "negation_query", "ambiguous_query"]>;
        phase1_results: z.ZodArray<z.ZodObject<{
            node_id: z.ZodString;
            score: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            node_id: string;
            score: number;
        }, {
            node_id: string;
            score: number;
        }>, "many">;
        query_analysis: z.ZodObject<{
            type: z.ZodEnum<["LOOKUP", "AMBIGUOUS"]>;
            entities: z.ZodArray<z.ZodString, "many">;
            attribute: z.ZodNullable<z.ZodString>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "LOOKUP" | "AMBIGUOUS";
            confidence: number;
            attribute: string | null;
            entities: string[];
        }, {
            type: "LOOKUP" | "AMBIGUOUS";
            confidence: number;
            attribute: string | null;
            entities: string[];
        }>;
    }, "strip", z.ZodTypeAny, {
        classification_reason: "reasoning_query" | "low_confidence" | "no_answer_found" | "disambiguation" | "compound_query" | "time_reference" | "exploration" | "unresolved_reference" | "negation_query" | "ambiguous_query";
        phase1_results: {
            node_id: string;
            score: number;
        }[];
        query_analysis: {
            type: "LOOKUP" | "AMBIGUOUS";
            confidence: number;
            attribute: string | null;
            entities: string[];
        };
    }, {
        classification_reason: "reasoning_query" | "low_confidence" | "no_answer_found" | "disambiguation" | "compound_query" | "time_reference" | "exploration" | "unresolved_reference" | "negation_query" | "ambiguous_query";
        phase1_results: {
            node_id: string;
            score: number;
        }[];
        query_analysis: {
            type: "LOOKUP" | "AMBIGUOUS";
            confidence: number;
            attribute: string | null;
            entities: string[];
        };
    }>>>;
}, "strip", z.ZodTypeAny, {
    query: string;
    explanation: string;
    queryType: {
        type: "LOOKUP" | "AMBIGUOUS";
        confidence: number;
        entity?: string | undefined;
        attribute?: string | undefined;
    };
    rcs: {
        level: "HIGH" | "MEDIUM" | "LOW";
        score: number;
        flags: string[];
    };
    decision: "SKIP" | "SKIP_WITH_CAVEAT" | "PHASE2";
    handoff?: {
        classification_reason: "reasoning_query" | "low_confidence" | "no_answer_found" | "disambiguation" | "compound_query" | "time_reference" | "exploration" | "unresolved_reference" | "negation_query" | "ambiguous_query";
        phase1_results: {
            node_id: string;
            score: number;
        }[];
        query_analysis: {
            type: "LOOKUP" | "AMBIGUOUS";
            confidence: number;
            attribute: string | null;
            entities: string[];
        };
    } | undefined;
}, {
    query: string;
    explanation: string;
    queryType: {
        type: "LOOKUP" | "AMBIGUOUS";
        confidence: number;
        entity?: string | undefined;
        attribute?: string | undefined;
    };
    rcs: {
        level: "HIGH" | "MEDIUM" | "LOW";
        score: number;
        flags: string[];
    };
    decision: "SKIP" | "SKIP_WITH_CAVEAT" | "PHASE2";
    handoff?: {
        classification_reason: "reasoning_query" | "low_confidence" | "no_answer_found" | "disambiguation" | "compound_query" | "time_reference" | "exploration" | "unresolved_reference" | "negation_query" | "ambiguous_query";
        phase1_results: {
            node_id: string;
            score: number;
        }[];
        query_analysis: {
            type: "LOOKUP" | "AMBIGUOUS";
            confidence: number;
            attribute: string | null;
            entities: string[];
        };
    } | undefined;
}>;
/**
 * Classification reason codes for Phase 2 handoff.
 */
declare const CLASSIFICATION_REASONS: readonly ["reasoning_query", "low_confidence", "no_answer_found", "disambiguation", "compound_query", "time_reference", "exploration", "unresolved_reference", "negation_query", "ambiguous_query"];
type ClassificationReason = (typeof CLASSIFICATION_REASONS)[number];
/**
 * Metadata passed to Phase 2 when not skipping.
 */
interface Phase2HandoffMetadata {
    /** Why Phase 2 is needed */
    classification_reason: ClassificationReason;
    /** Phase 1 retrieval results (node IDs and scores) */
    phase1_results: Array<{
        node_id: string;
        score: number;
    }>;
    /** Query analysis details */
    query_analysis: {
        type: QCSQueryType;
        entities: string[];
        attribute: string | null;
        confidence: number;
    };
}
declare const Phase2HandoffMetadataSchema: z.ZodObject<{
    classification_reason: z.ZodEnum<["reasoning_query", "low_confidence", "no_answer_found", "disambiguation", "compound_query", "time_reference", "exploration", "unresolved_reference", "negation_query", "ambiguous_query"]>;
    phase1_results: z.ZodArray<z.ZodObject<{
        node_id: z.ZodString;
        score: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        node_id: string;
        score: number;
    }, {
        node_id: string;
        score: number;
    }>, "many">;
    query_analysis: z.ZodObject<{
        type: z.ZodEnum<["LOOKUP", "AMBIGUOUS"]>;
        entities: z.ZodArray<z.ZodString, "many">;
        attribute: z.ZodNullable<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "LOOKUP" | "AMBIGUOUS";
        confidence: number;
        attribute: string | null;
        entities: string[];
    }, {
        type: "LOOKUP" | "AMBIGUOUS";
        confidence: number;
        attribute: string | null;
        entities: string[];
    }>;
}, "strip", z.ZodTypeAny, {
    classification_reason: "reasoning_query" | "low_confidence" | "no_answer_found" | "disambiguation" | "compound_query" | "time_reference" | "exploration" | "unresolved_reference" | "negation_query" | "ambiguous_query";
    phase1_results: {
        node_id: string;
        score: number;
    }[];
    query_analysis: {
        type: "LOOKUP" | "AMBIGUOUS";
        confidence: number;
        attribute: string | null;
        entities: string[];
    };
}, {
    classification_reason: "reasoning_query" | "low_confidence" | "no_answer_found" | "disambiguation" | "compound_query" | "time_reference" | "exploration" | "unresolved_reference" | "negation_query" | "ambiguous_query";
    phase1_results: {
        node_id: string;
        score: number;
    }[];
    query_analysis: {
        type: "LOOKUP" | "AMBIGUOUS";
        confidence: number;
        attribute: string | null;
        entities: string[];
    };
}>;
/**
 * Configuration for QCS.
 */
interface QCSConfig {
    /** Enable debug logging */
    debug?: boolean;
    /** Custom disqualifier patterns to add */
    customDisqualifiers?: RegExp[];
    /** Custom lookup patterns to add */
    customLookupPatterns?: RegExp[];
}
declare const QCSConfigSchema: z.ZodObject<{
    debug: z.ZodOptional<z.ZodBoolean>;
    customDisqualifiers: z.ZodOptional<z.ZodArray<z.ZodType<RegExp, z.ZodTypeDef, RegExp>, "many">>;
    customLookupPatterns: z.ZodOptional<z.ZodArray<z.ZodType<RegExp, z.ZodTypeDef, RegExp>, "many">>;
}, "strip", z.ZodTypeAny, {
    debug?: boolean | undefined;
    customDisqualifiers?: RegExp[] | undefined;
    customLookupPatterns?: RegExp[] | undefined;
}, {
    debug?: boolean | undefined;
    customDisqualifiers?: RegExp[] | undefined;
    customLookupPatterns?: RegExp[] | undefined;
}>;
/**
 * Minimal SSA result interface for QCS.
 * Full type is in @nous/core/ssa.
 */
interface SSAResultForQCS {
    relevant_nodes: Array<{
        node_id: string;
        score: number;
    }>;
    metrics: {
        nodes_returned: number;
    };
}
/**
 * Get disqualifier category description.
 */
declare function getDisqualifierDescription(category: DisqualifierCategory): string;
/**
 * Map disqualifier category to classification reason.
 */
declare function categoryToReason(category: DisqualifierCategory): ClassificationReason;
/**
 * Check if a flag blocks skipping Phase 2.
 */
declare function isBlockingFlag(flag: string): boolean;
/**
 * Generate decision explanation.
 */
declare function generateDecisionExplanation(decision: SkipDecision, queryType: QCSQueryType, rcsLevel: ConfidenceLevel, flags: string[], disqualified?: DisqualifierCategory): string;
/**
 * Stage 1: Check if query matches any disqualifier patterns.
 * @param query - The user query to check
 * @returns Disqualifier result with match details
 */
declare function checkDisqualifiers(query: string): DisqualifierResult;
/**
 * Stage 2a: Classify query as LOOKUP or AMBIGUOUS.
 * @param query - The user query to classify
 * @returns Classification with entity/attribute extraction
 */
declare function classifyQueryType(query: string): QueryTypeResult;
/**
 * Extract entity names from query.
 * @param query - The user query
 * @returns Array of extracted entity names
 */
declare function extractQueryEntities(query: string): string[];
/**
 * Extract sought attribute from query.
 * @param query - The user query
 * @returns Attribute name or null
 */
declare function extractQueryAttribute(query: string): string | null;
/**
 * Main entry point: Complete query classification.
 * @param query - The user query
 * @param ssaResult - Results from SSA retrieval
 * @param config - Optional configuration
 * @returns Complete classification result
 */
declare function classifyQuery(query: string, ssaResult: SSAResultForQCS, _config?: QCSConfig): ClassificationResult;
/**
 * Decision helper: Determine skip decision from classification.
 * @param classification - Complete classification result
 * @returns Skip decision (SKIP, SKIP_WITH_CAVEAT, or PHASE2)
 */
declare function shouldSkipPhase2(classification: ClassificationResult): SkipDecision;
/**
 * Build Phase 2 handoff metadata.
 * @param reason - Why Phase 2 is needed
 * @param relevantNodes - Phase 1 results
 * @param queryType - Query classification
 * @param entities - Extracted entities
 * @param attribute - Extracted attribute
 * @returns Handoff metadata for Phase 2
 */
declare function buildPhase2Handoff(reason: ClassificationReason, relevantNodes: Array<{
    node_id: string;
    score: number;
}>, queryType: QueryTypeResult, entities: string[], attribute: string | null): Phase2HandoffMetadata;
declare function validateDisqualifierResult(result: unknown): result is DisqualifierResult;
declare function validateQueryTypeResult(result: unknown): result is QueryTypeResult;
declare function validateClassificationResult(result: unknown): result is ClassificationResult;
declare function validatePhase2HandoffMetadata(metadata: unknown): metadata is Phase2HandoffMetadata;
declare function validateQCSConfig(config: unknown): config is QCSConfig;

export { ATTRIBUTE_KEYWORDS, CLASSIFICATION_REASONS, type ClassificationReason, type ClassificationResult, ClassificationResultSchema, D1_REASONING_PATTERNS, D2_NEGATION_PATTERNS, D3_TIME_PATTERNS, D4_COMPOUND_PATTERNS, D5_REFERENCE_PATTERNS, D6_EXPLORATION_PATTERNS, DISQUALIFIER_CATEGORIES, DISQUALIFIER_PATTERNS, type DisqualifierCategory, type DisqualifierResult, DisqualifierResultSchema, LOOKUP_PATTERNS, type Phase2HandoffMetadata, Phase2HandoffMetadataSchema, type QCSConfig, QCSConfigSchema, type QCSQueryType, QCS_QUERY_TYPES, type QueryTypeResult, QueryTypeResultSchema, SKIP_DECISIONS, type SSAResultForQCS, type SkipDecision, buildPhase2Handoff, categoryToReason, checkDisqualifiers, classifyQuery, classifyQueryType, extractQueryAttribute, extractQueryEntities, generateDecisionExplanation, getDisqualifierDescription, isBlockingFlag, shouldSkipPhase2, validateClassificationResult, validateDisqualifierResult, validatePhase2HandoffMetadata, validateQCSConfig, validateQueryTypeResult };
