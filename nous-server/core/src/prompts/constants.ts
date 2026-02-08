/**
 * @module @nous/core/prompts
 * @description Constants for the Nous Prompt Library (NPL)
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-027
 * @storm Brainstorms/Infrastructure/storm-027-prompt-engineering
 *
 * All prompt identifiers, cache strategies, model recommendations,
 * token budgets, and integration mappings for the NPL.
 *
 * Every constant uses the NPL_ prefix to avoid naming conflicts
 * with the 19 other storms that export similar names.
 *
 * @see {@link Brainstorms/Infrastructure/storm-027-prompt-engineering/revision} - v1.1 source
 * @see {@link Brainstorms/Infrastructure/storm-027-prompt-engineering/cycles/cycle-2/revision} - v2 IDS
 * @see {@link Brainstorms/Infrastructure/storm-027-prompt-engineering/cycles/cycle-3/revision} - v3 P-008
 */

import { z } from 'zod';

// ============================================================
// PROMPT IDENTIFIERS
// ============================================================

/**
 * All prompt IDs in the Nous Prompt Library.
 *
 * | ID | Name | Source |
 * |----|------|--------|
 * | P-001 | Query Classification | v1.1 |
 * | P-002 | Intent Extraction v1.2 | v2 |
 * | P-002C | Intent Clarification | v2 |
 * | P-003 | Node Extraction | v1.1 |
 * | P-004 | Edge Relationship | v1.1 |
 * | P-005 | Orient (Phase 2) | v1.1 |
 * | P-006 | Explore (Phase 2) | v1.1 |
 * | P-007 | Synthesize (Phase 2) | v1.1 |
 * | P-008 | Chat System v2.0 | v3 |
 * | P-009 | Agent Reasoning | v1.1 |
 * | P-010 | Contradiction Detection | v1.1 + storm-009 |
 * | P-010B | Contradiction Verification | v1.1 + storm-009 |
 * | P-011 | Memory Compression | v1.1 |
 */
export const NPL_PROMPT_IDS = [
  'P-001',
  'P-002',
  'P-002C',
  'P-003',
  'P-004',
  'P-005',
  'P-006',
  'P-007',
  'P-008',
  'P-009',
  'P-010',
  'P-010B',
  'P-011',
] as const;

export type NplPromptId = (typeof NPL_PROMPT_IDS)[number];

export const NplPromptIdSchema = z.enum(NPL_PROMPT_IDS);

// ============================================================
// CACHE STRATEGIES
// ============================================================

/**
 * Cache strategies for NPL prompts.
 *
 * - **global**: System prompt identical across all users (90% savings)
 * - **per_user**: Includes user-specific context (cached per session)
 * - **none**: Not cached (dynamic content)
 *
 * @see storm-015 CacheablePromptType for provider-level caching
 */
export const NPL_CACHE_STRATEGIES = ['global', 'per_user', 'none'] as const;

export type NplCacheStrategy = (typeof NPL_CACHE_STRATEGIES)[number];

export const NplCacheStrategySchema = z.enum(NPL_CACHE_STRATEGIES);

// ============================================================
// PROMPT ERROR TYPES
// ============================================================

/**
 * Standard error types for NPL prompt failures.
 *
 * @see storm-027 v1.1 - Error Response Standard
 */
export const NPL_ERROR_TYPES = [
  'MALFORMED_INPUT',
  'INSUFFICIENT_CONTEXT',
  'AMBIGUOUS_REQUEST',
  'CONTENT_TOO_LONG',
] as const;

export type NplErrorType = (typeof NPL_ERROR_TYPES)[number];

export const NplErrorTypeSchema = z.enum(NPL_ERROR_TYPES);

// ============================================================
// QUERY CLASSIFICATIONS
// ============================================================

/**
 * Query classification categories for P-001.
 *
 * - **RETRIEVAL**: User wants information from stored memories/notes
 * - **DIRECT_TASK**: User wants something that doesn't require memories
 * - **CHAT**: Social interaction, greetings, casual conversation
 *
 * @see storm-027 v1.1 P-001
 */
export const NPL_QUERY_CLASSIFICATIONS = ['RETRIEVAL', 'DIRECT_TASK', 'CHAT'] as const;

export type NplQueryClassification = (typeof NPL_QUERY_CLASSIFICATIONS)[number];

export const NplQueryClassificationSchema = z.enum(NPL_QUERY_CLASSIFICATIONS);

// ============================================================
// DISQUALIFIER CODES
// ============================================================

/**
 * Disqualifier codes for P-001 LLM output.
 * These are human-readable string names used in the prompt.
 *
 * Bridge to storm-008: Use NPL_DISQUALIFIER_TO_QCS_CODE to convert
 * these to storm-008's D1-D6 codes.
 *
 * @see storm-008 DISQUALIFIER_CATEGORIES for D-code equivalents
 * @see storm-027 v1.1 P-001 DISQUALIFIERS section
 */
export const NPL_DISQUALIFIER_CODES = [
  'reasoning_required',
  'temporal_reference',
  'compound_query',
  'negation',
  'unresolved_pronoun',
  'exploration',
  'needs_current_data',
] as const;

export type NplDisqualifierCode = (typeof NPL_DISQUALIFIER_CODES)[number];

export const NplDisqualifierCodeSchema = z.enum(NPL_DISQUALIFIER_CODES);

// ============================================================
// EXTRACTION NODE TYPES
// ============================================================

/**
 * Node types for P-003 extraction output.
 *
 * @see storm-011 NODE_TYPES for the full node type system
 * @see storm-027 v1.1 P-003 NODE TYPES section
 */
export const NPL_EXTRACTION_NODE_TYPES = [
  'FACT',
  'EVENT',
  'NOTE',
  'IDEA',
  'TASK',
  'REFERENCE',
] as const;

export type NplExtractionNodeType = (typeof NPL_EXTRACTION_NODE_TYPES)[number];

export const NplExtractionNodeTypeSchema = z.enum(NPL_EXTRACTION_NODE_TYPES);

// ============================================================
// CONFIDENCE LEVELS
// ============================================================

/**
 * Confidence levels for synthesis and other prompt outputs.
 *
 * Bridge to storm-003: Use NPL_CONFIDENCE_LEVEL_SCORES to convert
 * these string levels to storm-003's numeric 0-1 confidence.
 *
 * @see storm-003 SynthesizeResult.confidence (numeric 0-1)
 * @see storm-028 CONFIDENCE_LEVELS
 */
export const NPL_CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;

export type NplConfidenceLevel = (typeof NPL_CONFIDENCE_LEVELS)[number];

export const NplConfidenceLevelSchema = z.enum(NPL_CONFIDENCE_LEVELS);

// ============================================================
// CONTRADICTION RECOMMENDATIONS
// ============================================================

/**
 * Recommendation values for P-010B verification output.
 * These MUST match storm-009's VerificationOutput.recommendation values exactly.
 *
 * @see storm-009 VerificationOutput.recommendation
 */
export const NPL_CONTRADICTION_RECOMMENDATIONS = [
  'auto_supersede',
  'queue_for_user',
  'keep_both',
] as const;

export type NplContradictionRecommendation = (typeof NPL_CONTRADICTION_RECOMMENDATIONS)[number];

export const NplContradictionRecommendationSchema = z.enum(NPL_CONTRADICTION_RECOMMENDATIONS);

// ============================================================
// CONTRADICTION RELATIONSHIPS
// ============================================================

/**
 * Relationship types for P-010 contradiction detection output.
 * These MUST match storm-009's LLMDetectionOutput.relationship values exactly.
 *
 * @see storm-009 LLMDetectionOutput.relationship
 */
export const NPL_CONTRADICTION_RELATIONSHIPS = [
  'contradicts',
  'updates',
  'evolves',
  'coexists',
  'unrelated',
] as const;

export type NplContradictionRelationship = (typeof NPL_CONTRADICTION_RELATIONSHIPS)[number];

export const NplContradictionRelationshipSchema = z.enum(NPL_CONTRADICTION_RELATIONSHIPS);

// ============================================================
// CACHEABLE PROMPT TYPES (Mirror of storm-015)
// ============================================================

/**
 * Cache categories from storm-015.
 * Each NPL prompt maps to one of these 3 categories.
 *
 * @see storm-015 CACHEABLE_PROMPT_TYPES
 */
export const NPL_CACHEABLE_PROMPT_TYPES = ['classifier', 'extractor', 'responder'] as const;

export type NplCacheablePromptType = (typeof NPL_CACHEABLE_PROMPT_TYPES)[number];

export const NplCacheablePromptTypeSchema = z.enum(NPL_CACHEABLE_PROMPT_TYPES);

// ============================================================
// MODEL RECOMMENDATIONS PER PROMPT
// ============================================================

/**
 * Model recommendation for a prompt.
 */
export interface NplModelRecommendation {
  /** Primary model ID */
  primary: string;
  /** Fallback model ID */
  fallback: string;
  /** Recommended temperature */
  temperature: number;
}

export const NplModelRecommendationSchema = z.object({
  primary: z.string(),
  fallback: z.string(),
  temperature: z.number().min(0).max(2),
});

/**
 * Model recommendations per prompt.
 *
 * @see storm-015 OPERATION_CONFIGS for actual routing (these are recommendations)
 * @see storm-027 v1.1 Model Recommendation sections
 */
export const NPL_MODEL_RECOMMENDATIONS: Record<NplPromptId, NplModelRecommendation> = {
  'P-001': { primary: 'gemini-2.0-flash-lite', fallback: 'gpt-4o-mini', temperature: 0 },
  'P-002': { primary: 'gpt-4o-mini', fallback: 'claude-3-haiku', temperature: 0 },
  'P-002C': { primary: 'gpt-4o-mini', fallback: 'claude-3-haiku', temperature: 0.3 },
  'P-003': { primary: 'gpt-4o-mini', fallback: 'claude-sonnet-4', temperature: 0 },
  'P-004': { primary: 'gpt-4o-mini', fallback: 'claude-3-haiku', temperature: 0 },
  'P-005': { primary: 'claude-3-haiku', fallback: 'gpt-4o-mini', temperature: 0 },
  'P-006': { primary: 'claude-3-haiku', fallback: 'gpt-4o-mini', temperature: 0 },
  'P-007': { primary: 'claude-sonnet-4', fallback: 'gpt-4o', temperature: 0.3 },
  'P-008': { primary: 'claude-sonnet-4', fallback: 'gpt-4o', temperature: 0.5 },
  'P-009': { primary: 'claude-sonnet-4', fallback: 'gpt-4o', temperature: 0 },
  'P-010': { primary: 'claude-sonnet-4', fallback: 'gpt-4o', temperature: 0 },
  'P-010B': { primary: 'claude-sonnet-4', fallback: 'gpt-4o', temperature: 0 },
  'P-011': { primary: 'claude-3-haiku', fallback: 'gpt-4o-mini', temperature: 0 },
} as const;

// ============================================================
// CACHE STRATEGY PER PROMPT
// ============================================================

/**
 * Cache strategy assignments per prompt.
 * Only P-008 uses per_user (includes user-specific context).
 *
 * @see storm-027 v1.1 Metadata sections
 */
export const NPL_CACHE_CONFIGS: Record<NplPromptId, NplCacheStrategy> = {
  'P-001': 'global',
  'P-002': 'global',
  'P-002C': 'global',
  'P-003': 'global',
  'P-004': 'global',
  'P-005': 'global',
  'P-006': 'global',
  'P-007': 'global',
  'P-008': 'per_user',
  'P-009': 'global',
  'P-010': 'global',
  'P-010B': 'global',
  'P-011': 'global',
} as const;

// ============================================================
// TOKEN BUDGET ESTIMATES
// ============================================================

/**
 * Token budget estimate for a prompt.
 */
export interface NplTokenBudget {
  /** System message tokens (cached) */
  system: number;
  /** User template base tokens (excluding variable content) */
  userBase: number;
  /** Expected output tokens */
  output: number;
  /** Typical total tokens per call */
  typicalTotal: number;
}

export const NplTokenBudgetSchema = z.object({
  system: z.number().int().nonnegative(),
  userBase: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  typicalTotal: z.number().int().positive(),
});

/**
 * Token budget estimates per prompt.
 * These are approximations from the brainstorm; actual usage varies with input.
 *
 * @see storm-027 v1.1 Token Budget sections
 */
export const NPL_TOKEN_BUDGETS: Record<NplPromptId, NplTokenBudget> = {
  'P-001': { system: 450, userBase: 50, output: 120, typicalTotal: 650 },
  'P-002': { system: 550, userBase: 80, output: 180, typicalTotal: 850 },
  'P-002C': { system: 100, userBase: 80, output: 100, typicalTotal: 280 },
  'P-003': { system: 500, userBase: 100, output: 250, typicalTotal: 1200 },
  'P-004': { system: 200, userBase: 100, output: 150, typicalTotal: 500 },
  'P-005': { system: 300, userBase: 100, output: 250, typicalTotal: 1650 },
  'P-006': { system: 300, userBase: 200, output: 200, typicalTotal: 800 },
  'P-007': { system: 350, userBase: 100, output: 400, typicalTotal: 2000 },
  'P-008': { system: 2500, userBase: 0, output: 0, typicalTotal: 3500 },
  'P-009': { system: 1000, userBase: 150, output: 350, typicalTotal: 1600 },
  'P-010': { system: 300, userBase: 200, output: 150, typicalTotal: 650 },
  'P-010B': { system: 200, userBase: 150, output: 100, typicalTotal: 450 },
  'P-011': { system: 250, userBase: 300, output: 200, typicalTotal: 700 },
} as const;

// ============================================================
// PROMPT VERSIONS
// ============================================================

/**
 * Current version of each prompt.
 *
 * @see storm-027 v1.1, v2, v3 revision cycles
 */
export const NPL_PROMPT_VERSIONS: Record<NplPromptId, string> = {
  'P-001': '1.1.0',
  'P-002': '1.2.0',
  'P-002C': '1.0.0',
  'P-003': '1.1.0',
  'P-004': '1.1.0',
  'P-005': '1.1.0',
  'P-006': '1.1.0',
  'P-007': '1.1.0',
  'P-008': '2.0.0',
  'P-009': '1.1.0',
  'P-010': '1.1.0',
  'P-010B': '1.0.0',
  'P-011': '1.1.0',
} as const;

// ============================================================
// PROMPT-TO-OPERATION MAPPING
// ============================================================

/**
 * Maps each NPL prompt to its storm-015 operation type.
 * Used by the LLM gateway to route requests to the correct model.
 *
 * Operation types from storm-015:
 * 'classification' | 'quick_response' | 'standard_response' | 'deep_thinking' |
 * 'graph_cot' | 'extraction_simple' | 'extraction_complex' | 'embedding' | 'batch_extraction'
 *
 * @see storm-015 OPERATION_TYPES
 * @see storm-015 OPERATION_CONFIGS for model selection per operation
 */
export const NPL_PROMPT_TO_OPERATION: Record<NplPromptId, string> = {
  'P-001': 'classification',
  'P-002': 'classification',
  'P-002C': 'quick_response',
  'P-003': 'extraction_simple',
  'P-004': 'extraction_simple',
  'P-005': 'graph_cot',
  'P-006': 'graph_cot',
  'P-007': 'graph_cot',
  'P-008': 'standard_response',
  'P-009': 'deep_thinking',
  'P-010': 'standard_response',
  'P-010B': 'standard_response',
  'P-011': 'extraction_simple',
} as const;

// ============================================================
// PROMPT-TO-CACHE-TYPE MAPPING
// ============================================================

/**
 * Maps each NPL prompt to its storm-015 cache category.
 *
 * - **classifier**: Classification and intent prompts
 * - **extractor**: Extraction and exploration prompts
 * - **responder**: Response, reasoning, and utility prompts
 *
 * @see storm-015 CACHEABLE_PROMPT_TYPES
 * @see storm-015 PROMPT_CACHE_CONFIGS (content "Set by storm-027")
 */
export const NPL_PROMPT_TO_CACHE_TYPE: Record<NplPromptId, NplCacheablePromptType> = {
  'P-001': 'classifier',
  'P-002': 'classifier',
  'P-002C': 'classifier',
  'P-003': 'extractor',
  'P-004': 'extractor',
  'P-005': 'extractor',
  'P-006': 'extractor',
  'P-007': 'responder',
  'P-008': 'responder',
  'P-009': 'responder',
  'P-010': 'responder',
  'P-010B': 'responder',
  'P-011': 'responder',
} as const;

// ============================================================
// DISQUALIFIER CODE MAPPING
// ============================================================

/**
 * Maps NPL disqualifier string names to storm-008 D-codes.
 *
 * P-001 LLM output uses readable string names. Storm-008 QCS uses D1-D6 codes.
 * This mapping bridges the two systems.
 *
 * @see storm-008 DISQUALIFIER_CATEGORIES ['D1'..'D6']
 * @see storm-008 DISQUALIFIER_DESCRIPTIONS for D-code meanings
 */
export const NPL_DISQUALIFIER_TO_QCS_CODE: Record<NplDisqualifierCode, string> = {
  reasoning_required: 'D1',
  negation: 'D2',
  temporal_reference: 'D3',
  compound_query: 'D4',
  unresolved_pronoun: 'D5',
  exploration: 'D6',
  needs_current_data: 'D6', // Mapped to D6 (exploration-adjacent)
} as const;

// ============================================================
// CONFIDENCE LEVEL SCORES
// ============================================================

/**
 * Numeric score mapping for confidence levels.
 * Used to bridge NPL string levels to storm-003's numeric confidence (0-1).
 *
 * @see storm-003 SynthesizeResult.confidence (number 0-1)
 * @see storm-028 CONFIDENCE_LEVELS
 */
export const NPL_CONFIDENCE_LEVEL_SCORES: Record<NplConfidenceLevel, number> = {
  HIGH: 0.9,
  MEDIUM: 0.6,
  LOW: 0.3,
} as const;

// ============================================================
// EXTRACTION CONTENT LIMITS
// ============================================================

/**
 * Content limits for P-003 node extraction.
 * Aligned with storm-014 ingestion pipeline limits.
 *
 * @see storm-014 pipeline-types.ts
 * @see storm-027 v1.1 P-003 CONTENT LIMITS
 */
export const NPL_EXTRACTION_CONTENT_LIMITS = {
  /** Target content range (characters) */
  target: { min: 500, max: 2000 },
  /** Soft maximum — acceptable if semantically coherent */
  softMax: 3000,
  /** Hard maximum — force split at sentence boundary */
  hardMax: 5000,
} as const;

// ============================================================
// P-008 TOKEN BUDGET (Special)
// ============================================================

/**
 * Special token budget for P-008 Chat System prompt.
 * P-008 is significantly larger than other prompts due to 13-section system prompt.
 *
 * @see storm-027 v3 P-008 v2.0
 */
export const NPL_P008_TOKEN_BUDGET = {
  /** Core system prompt (13 sections) */
  corePrompt: 2500,
  /** Dynamic context customization section */
  contextCustomization: 200,
  /** Retrieved context injection */
  retrievedContext: 500,
  /** Conversation history */
  conversationHistory: 300,
  /** First call total (before caching) */
  firstCall: 3500,
  /** Subsequent calls (system prompt cached) */
  subsequentCalls: 1000,
  /** Cache read cost factor (90% savings) */
  cachedCostFactor: 0.1,
} as const;

// ============================================================
// AUTO-SUPERSEDE THRESHOLDS
// ============================================================

/**
 * Thresholds for automatic supersession in P-010/P-010B pipeline.
 * Auto-supersede only if ALL conditions are met.
 *
 * From storm-009 v2:
 * - Tier 3 confidence >= 0.8
 * - Tier 3 relationship === 'contradicts'
 * - Tier 4 should_supersede === true
 * - Tier 4 confidence >= 0.7
 * - Tier 4 concerns === [] (no concerns)
 *
 * @see storm-009 canAutoSupersede function
 */
export const NPL_AUTO_SUPERSEDE_THRESHOLDS = {
  /** Minimum Tier 3 (P-010) confidence for auto-supersede */
  tier3MinConfidence: 0.8,
  /** Required Tier 3 relationship for auto-supersede */
  tier3RequiredRelationship: 'contradicts' as const,
  /** Minimum Tier 4 (P-010B) confidence for auto-supersede */
  tier4MinConfidence: 0.7,
  /** Tier 4 must have zero concerns */
  tier4MaxConcerns: 0,
} as const;

// ============================================================
// PROMPT NAMES (Human-readable)
// ============================================================

/**
 * Human-readable names for each prompt.
 */
export const NPL_PROMPT_NAMES: Record<NplPromptId, string> = {
  'P-001': 'Query Classification',
  'P-002': 'Intent Extraction',
  'P-002C': 'Intent Clarification',
  'P-003': 'Node Extraction',
  'P-004': 'Edge Relationship',
  'P-005': 'Orient (Phase 2)',
  'P-006': 'Explore (Phase 2)',
  'P-007': 'Synthesize (Phase 2)',
  'P-008': 'Chat System',
  'P-009': 'Agent Reasoning',
  'P-010': 'Contradiction Detection',
  'P-010B': 'Contradiction Verification',
  'P-011': 'Memory Compression',
} as const;

// ============================================================
// PROMPT INTEGRATION MAP
// ============================================================

/**
 * Which storms each prompt integrates with.
 */
export const NPL_PROMPT_INTEGRATIONS: Record<NplPromptId, string[]> = {
  'P-001': ['storm-008'],
  'P-002': ['storm-014'],
  'P-002C': ['storm-014'],
  'P-003': ['storm-014', 'storm-011'],
  'P-004': ['storm-011', 'storm-031'],
  'P-005': ['storm-003'],
  'P-006': ['storm-003'],
  'P-007': ['storm-003'],
  'P-008': ['storm-015', 'storm-020'],
  'P-009': ['storm-019'],
  'P-010': ['storm-009'],
  'P-010B': ['storm-009'],
  'P-011': ['storm-007'],
} as const;
