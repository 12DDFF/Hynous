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

import { z } from 'zod';
import {
  calculateRetrievalConfidence,
  ConfidenceLevel,
} from '../params';

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Disqualifier categories for Stage 1.
 * Queries matching these patterns always require Phase 2.
 */
export const DISQUALIFIER_CATEGORIES = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as const;
export type DisqualifierCategory = (typeof DISQUALIFIER_CATEGORIES)[number];

/**
 * Query types for classification.
 * LOOKUP: Seeking specific attribute from specific entity
 * AMBIGUOUS: Unclear what's being asked
 */
export const QCS_QUERY_TYPES = ['LOOKUP', 'AMBIGUOUS'] as const;
export type QCSQueryType = (typeof QCS_QUERY_TYPES)[number];

/**
 * Skip decisions for Phase 2.
 * SKIP: Answer directly from Phase 1
 * SKIP_WITH_CAVEAT: Answer with uncertainty note
 * PHASE2: Proceed to LLM reasoning
 */
export const SKIP_DECISIONS = ['SKIP', 'SKIP_WITH_CAVEAT', 'PHASE2'] as const;
export type SkipDecision = (typeof SKIP_DECISIONS)[number];

// ============================================================
// DISQUALIFIER PATTERNS
// ============================================================

/**
 * D1: Reasoning keywords
 * Queries that require understanding relationships or explanations.
 */
export const D1_REASONING_PATTERNS: RegExp[] = [
  /\bhow does\b/i,
  /\bhow do\b/i,
  /\bhow is\b/i,
  /\bwhy does\b/i,
  /\bwhy is\b/i,
  /\bwhy did\b/i,
  /\brelate\b/i,
  /\brelationship\b/i,
  /\bconnection\b/i,
  /\bcompare\b/i,
  /\bcomparison\b/i,
  /\bdifference\b/i,
  /\bversus\b/i,
  /\bvs\b/i,
  /\bexplain\b/i,
  /\bsummarize\b/i,
  /\bdescribe\b/i,
  /\bwhat do I know about\b/i,
  /\btell me about\b/i,
];

/**
 * D2: Negation patterns
 * Queries involving absence or exclusion.
 */
export const D2_NEGATION_PATTERNS: RegExp[] = [
  /\bnot in\b/i,
  /\bnot included\b/i,
  /\bmissing from\b/i,
  /\bnever\b/i,
  /\bwithout\b/i,
  /\bexcept\b/i,
  /\bwhat don't I\b/i,
  /\bwhat haven't I\b/i,
];

/**
 * D3: Time reference patterns
 * Queries involving temporal context.
 */
export const D3_TIME_PATTERNS: RegExp[] = [
  // Relative time
  /\blast week\b/i,
  /\byesterday\b/i,
  /\brecently\b/i,
  /\blast month\b/i,
  /\blast year\b/i,
  /\btoday\b/i,
  /\bthis week\b/i,
  /\bthis month\b/i,
  // Specific time
  /\bin (january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\bon (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bin \d{4}\b/i,
  // Time ranges
  /\bbetween\b/i,
  /\bfrom .+ to\b/i,
  /\bduring\b/i,
];

/**
 * D4: Compound query patterns
 * Multiple questions in one query.
 */
export const D4_COMPOUND_PATTERNS: RegExp[] = [
  /\?\s*\S+.*\?/,  // Multiple question marks with content between
  /\band what\b/i,
  /\band when\b/i,
  /\band where\b/i,
  /\band who\b/i,
  /\band how\b/i,
  /\band why\b/i,
  /\balso\b.*\?/i,
];

/**
 * D5: Unresolved reference patterns
 * Pronouns or references without clear antecedent.
 */
export const D5_REFERENCE_PATTERNS: RegExp[] = [
  /\btheir\b/i,
  /\bhis\b/i,
  /\bher\b/i,
  /\bits\b/i,
  /\bthat\b/i,
  /\bthis\b/i,
  /\bthe same\b/i,
  /\bthe other\b/i,
];

/**
 * D6: Exploration signal patterns
 * Queries seeking discovery rather than retrieval.
 */
export const D6_EXPLORATION_PATTERNS: RegExp[] = [
  /\bwhat else\b/i,
  /\banything related\b/i,
  /\bmore about\b/i,
  /\bsimilar to\b/i,
  /\blike \S+\b/i,
  /\bbrainstorm\b/i,
  /\bideas for\b/i,
  /\bsuggest\b/i,
];

/**
 * All disqualifier patterns grouped by category.
 */
export const DISQUALIFIER_PATTERNS: Record<DisqualifierCategory, RegExp[]> = {
  D1: D1_REASONING_PATTERNS,
  D2: D2_NEGATION_PATTERNS,
  D3: D3_TIME_PATTERNS,
  D4: D4_COMPOUND_PATTERNS,
  D5: D5_REFERENCE_PATTERNS,
  D6: D6_EXPLORATION_PATTERNS,
};

// ============================================================
// LOOKUP PATTERNS
// ============================================================

/**
 * Patterns that indicate a LOOKUP query type.
 * Format: Entity + Attribute seeking patterns.
 */
export const LOOKUP_PATTERNS: RegExp[] = [
  // "What's X's Y?"
  /\bwhat(?:'s|'s| is)\s+(\S+(?:\s+\S+)?)'s\s+(\S+)/i,
  // "What is X's Y?"
  /\bwhat is\s+(\S+(?:\s+\S+)?)'s\s+(\S+)/i,
  // "X's Y?"
  /^(\S+(?:\s+\S+)?)'s\s+(\S+)\??$/i,
  // "Y for X?"
  /\b(\S+)\s+for\s+(\S+(?:\s+\S+)?)\??$/i,
  // "Who is X?"
  /\bwho is\s+(\S+(?:\s+\S+)?)\??$/i,
  // "Where is X?"
  /\bwhere is\s+(\S+(?:\s+\S+)?)\??$/i,
  // "When is X?"
  /\bwhen is\s+(\S+(?:\s+\S+)?)\??$/i,
];

/**
 * Keywords that boost LOOKUP confidence.
 * These indicate the user is seeking a specific attribute.
 */
export const ATTRIBUTE_KEYWORDS: string[] = [
  'phone',
  'email',
  'address',
  'birthday',
  'number',
  'date',
  'name',
  'title',
  'location',
  'id',
  'link',
  'url',
  'contact',
  'age',
  'status',
  'role',
  'position',
  'company',
  'team',
  'project',
];

// ============================================================
// INTERFACES
// ============================================================

/**
 * Result of Stage 1 disqualifier check.
 */
export interface DisqualifierResult {
  /** Whether the query is disqualified (requires Phase 2) */
  disqualified: boolean;
  /** Human-readable reason for disqualification */
  reason?: string;
  /** Which category matched */
  category?: DisqualifierCategory;
  /** The pattern that matched (for debugging) */
  pattern?: string;
}

export const DisqualifierResultSchema = z.object({
  disqualified: z.boolean(),
  reason: z.string().optional(),
  category: z.enum(DISQUALIFIER_CATEGORIES).optional(),
  pattern: z.string().optional(),
});

/**
 * Result of Stage 2a query type classification.
 */
export interface QueryTypeResult {
  /** Classified query type */
  type: QCSQueryType;
  /** Extracted entity name(s) if LOOKUP */
  entity?: string;
  /** Extracted attribute being sought if LOOKUP */
  attribute?: string;
  /** Confidence in classification (0-1) */
  confidence: number;
}

export const QueryTypeResultSchema = z.object({
  type: z.enum(QCS_QUERY_TYPES),
  entity: z.string().optional(),
  attribute: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

/**
 * Complete classification result.
 */
export interface ClassificationResult {
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

export const ClassificationResultSchema = z.object({
  query: z.string(),
  queryType: QueryTypeResultSchema,
  rcs: z.object({
    score: z.number().min(0).max(1),
    level: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    flags: z.array(z.string()),
  }),
  decision: z.enum(SKIP_DECISIONS),
  explanation: z.string(),
  handoff: z.lazy(() => Phase2HandoffMetadataSchema).optional(),
});

/**
 * Classification reason codes for Phase 2 handoff.
 */
export const CLASSIFICATION_REASONS = [
  'reasoning_query',
  'low_confidence',
  'no_answer_found',
  'disambiguation',
  'compound_query',
  'time_reference',
  'exploration',
  'unresolved_reference',
  'negation_query',
  'ambiguous_query',
] as const;
export type ClassificationReason = (typeof CLASSIFICATION_REASONS)[number];

/**
 * Metadata passed to Phase 2 when not skipping.
 */
export interface Phase2HandoffMetadata {
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

export const Phase2HandoffMetadataSchema = z.object({
  classification_reason: z.enum(CLASSIFICATION_REASONS),
  phase1_results: z.array(z.object({
    node_id: z.string(),
    score: z.number().min(0).max(1),
  })).max(100),
  query_analysis: z.object({
    type: z.enum(QCS_QUERY_TYPES),
    entities: z.array(z.string()).max(20),
    attribute: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  }),
});

/**
 * Configuration for QCS.
 */
export interface QCSConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Custom disqualifier patterns to add */
  customDisqualifiers?: RegExp[];
  /** Custom lookup patterns to add */
  customLookupPatterns?: RegExp[];
}

export const QCSConfigSchema = z.object({
  debug: z.boolean().optional(),
  customDisqualifiers: z.array(z.instanceof(RegExp)).optional(),
  customLookupPatterns: z.array(z.instanceof(RegExp)).optional(),
});

// ============================================================
// SSA RESULT TYPE (minimal interface for QCS)
// ============================================================

/**
 * Minimal SSA result interface for QCS.
 * Full type is in @nous/core/ssa.
 */
export interface SSAResultForQCS {
  relevant_nodes: Array<{
    node_id: string;
    score: number;
  }>;
  metrics: {
    nodes_returned: number;
  };
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Get disqualifier category description.
 */
export function getDisqualifierDescription(category: DisqualifierCategory): string {
  const descriptions: Record<DisqualifierCategory, string> = {
    D1: 'Reasoning query (how/why/explain)',
    D2: 'Negation query (not/never/except)',
    D3: 'Time reference (last week/in September)',
    D4: 'Compound query (multiple questions)',
    D5: 'Unresolved reference (their/his/it)',
    D6: 'Exploration query (what else/similar to)',
  };
  return descriptions[category];
}

/**
 * Map disqualifier category to classification reason.
 */
export function categoryToReason(category: DisqualifierCategory): ClassificationReason {
  const mapping: Record<DisqualifierCategory, ClassificationReason> = {
    D1: 'reasoning_query',
    D2: 'negation_query',
    D3: 'time_reference',
    D4: 'compound_query',
    D5: 'unresolved_reference',
    D6: 'exploration',
  };
  return mapping[category];
}

/**
 * Check if a flag blocks skipping Phase 2.
 */
export function isBlockingFlag(flag: string): boolean {
  const blockingFlags = [
    'disambiguation_needed',
    'sparse_results',
    'no_results',
  ];
  return blockingFlags.includes(flag);
}

/**
 * Generate decision explanation.
 */
export function generateDecisionExplanation(
  decision: SkipDecision,
  queryType: QCSQueryType,
  rcsLevel: ConfidenceLevel,
  flags: string[],
  disqualified?: DisqualifierCategory
): string {
  if (disqualified) {
    return `Query disqualified by ${disqualified}: ${getDisqualifierDescription(disqualified)}. Proceeding to Phase 2.`;
  }

  if (queryType === 'AMBIGUOUS') {
    return 'Query type is AMBIGUOUS. Proceeding to Phase 2 for clarification.';
  }

  const blockingFlags = flags.filter(isBlockingFlag);
  if (blockingFlags.length > 0) {
    return `LOOKUP query with ${rcsLevel} confidence, but blocked by: ${blockingFlags.join(', ')}. Proceeding to Phase 2.`;
  }

  switch (decision) {
    case 'SKIP':
      return `LOOKUP query with HIGH confidence and no blocking flags. Answering directly from Phase 1.`;
    case 'SKIP_WITH_CAVEAT':
      return `LOOKUP query with MEDIUM confidence. Answering with uncertainty note.`;
    case 'PHASE2':
      return `LOOKUP query with ${rcsLevel} confidence. Proceeding to Phase 2 for verification.`;
    default:
      return `Decision: ${decision}`;
  }
}

// ============================================================
// STAGE 1: DISQUALIFIER CHECK
// ============================================================

/**
 * Stage 1: Check if query matches any disqualifier patterns.
 * @param query - The user query to check
 * @returns Disqualifier result with match details
 */
export function checkDisqualifiers(query: string): DisqualifierResult {
  // Check each category in order
  for (const category of DISQUALIFIER_CATEGORIES) {
    const patterns = DISQUALIFIER_PATTERNS[category];
    for (const pattern of patterns) {
      if (pattern.test(query)) {
        return {
          disqualified: true,
          reason: getDisqualifierDescription(category),
          category,
          pattern: pattern.source,
        };
      }
    }
  }

  return { disqualified: false };
}

// ============================================================
// STAGE 2: QUERY TYPE CLASSIFICATION
// ============================================================

/**
 * Clean extracted value by removing trailing punctuation.
 */
function cleanExtractedValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Remove trailing punctuation (?, !, ., etc.)
  return value.replace(/[?!.,;:]+$/, '').trim();
}

/**
 * Stage 2a: Classify query as LOOKUP or AMBIGUOUS.
 * @param query - The user query to classify
 * @returns Classification with entity/attribute extraction
 */
export function classifyQueryType(query: string): QueryTypeResult {
  // Try each LOOKUP pattern
  for (const pattern of LOOKUP_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      // Extract entity and attribute from match groups
      const entity = cleanExtractedValue(match[1]?.trim());
      const attribute = cleanExtractedValue(match[2]?.trim());

      // Calculate confidence based on specificity
      let confidence = 0.7; // Base confidence for pattern match

      // Boost if attribute is a known keyword
      if (attribute && ATTRIBUTE_KEYWORDS.some(kw =>
        attribute.toLowerCase().includes(kw.toLowerCase())
      )) {
        confidence = Math.min(confidence + 0.15, 1.0);
      }

      // Boost if query ends with question mark
      if (query.trim().endsWith('?')) {
        confidence = Math.min(confidence + 0.05, 1.0);
      }

      // Boost if query is short (more specific)
      if (query.length < 50) {
        confidence = Math.min(confidence + 0.05, 1.0);
      }

      return {
        type: 'LOOKUP',
        entity: entity || undefined,
        attribute: attribute || undefined,
        confidence,
      };
    }
  }

  // Check for attribute keywords even without pattern match
  const hasAttributeKeyword = ATTRIBUTE_KEYWORDS.some(kw =>
    query.toLowerCase().includes(kw.toLowerCase())
  );

  if (hasAttributeKeyword) {
    // Try to extract entity from simple queries like "John's phone"
    const simpleMatch = query.match(/(\S+(?:\s+\S+)?)'s\s+(\S+)/i);
    if (simpleMatch) {
      return {
        type: 'LOOKUP',
        entity: cleanExtractedValue(simpleMatch[1]?.trim()),
        attribute: cleanExtractedValue(simpleMatch[2]?.trim()),
        confidence: 0.6,
      };
    }

    return {
      type: 'LOOKUP',
      attribute: ATTRIBUTE_KEYWORDS.find(kw =>
        query.toLowerCase().includes(kw.toLowerCase())
      ),
      confidence: 0.5,
    };
  }

  // Default to AMBIGUOUS
  return {
    type: 'AMBIGUOUS',
    confidence: 0.3,
  };
}

/**
 * Extract entity names from query.
 * @param query - The user query
 * @returns Array of extracted entity names
 */
export function extractQueryEntities(query: string): string[] {
  const entities: string[] = [];

  // Try possessive patterns - match just the word(s) immediately before 's
  // Use a more precise pattern that captures only proper word boundaries
  const possessiveMatches = query.matchAll(/(?:^|\s)(\w+)'s\s+/gi);
  for (const match of possessiveMatches) {
    const cleaned = cleanExtractedValue(match[1]);
    if (cleaned) {
      entities.push(cleaned);
    }
  }

  // Try "for X" patterns - capture word chars only
  const forMatches = query.matchAll(/\bfor\s+(\w+(?:\s+\w+)?)\b/gi);
  for (const match of forMatches) {
    const cleaned = cleanExtractedValue(match[1]);
    if (cleaned) {
      entities.push(cleaned);
    }
  }

  // Try "who/where/when is X" patterns - capture word chars only
  const isMatches = query.matchAll(/\b(?:who|where|when) is\s+(\w+(?:\s+\w+)?)\b/gi);
  for (const match of isMatches) {
    const cleaned = cleanExtractedValue(match[1]);
    if (cleaned) {
      entities.push(cleaned);
    }
  }

  // Deduplicate
  return [...new Set(entities)];
}

/**
 * Extract sought attribute from query.
 * @param query - The user query
 * @returns Attribute name or null
 */
export function extractQueryAttribute(query: string): string | null {
  // Check for possessive pattern: "X's Y" - capture word chars
  const possessiveMatch = query.match(/\S+'s\s+(\w+)/i);
  if (possessiveMatch?.[1]) {
    return cleanExtractedValue(possessiveMatch[1].trim()) ?? null;
  }

  // Check for "Y for X" pattern
  const forMatch = query.match(/^(\w+)\s+for\s+/i);
  if (forMatch?.[1]) {
    return cleanExtractedValue(forMatch[1].trim()) ?? null;
  }

  // Check for known attribute keywords
  for (const keyword of ATTRIBUTE_KEYWORDS) {
    if (query.toLowerCase().includes(keyword.toLowerCase())) {
      return keyword;
    }
  }

  return null;
}

// ============================================================
// MAIN CLASSIFICATION FUNCTION
// ============================================================

/**
 * Main entry point: Complete query classification.
 * @param query - The user query
 * @param ssaResult - Results from SSA retrieval
 * @param config - Optional configuration
 * @returns Complete classification result
 */
export function classifyQuery(
  query: string,
  ssaResult: SSAResultForQCS,
  _config?: QCSConfig
): ClassificationResult {
  // Stage 1: Disqualifier check
  const disqualifierResult = checkDisqualifiers(query);

  // Stage 2a: Query type classification
  const queryTypeResult = classifyQueryType(query);

  // Stage 2b: Entity/attribute extraction
  const entities = extractQueryEntities(query);
  const attribute = extractQueryAttribute(query);

  // Stage 2c: Calculate RCS from SSA results
  const relevantNodes = ssaResult.relevant_nodes;
  const topScore = relevantNodes[0]?.score ?? 0;
  const secondScore = relevantNodes.length > 1 ? relevantNodes[1]?.score ?? null : null;
  const resultCount = relevantNodes.length;
  const hasAttribute = attribute !== null;

  const rcsResult = calculateRetrievalConfidence(
    topScore,
    secondScore,
    resultCount,
    hasAttribute
  );

  // Stage 3: Decision matrix
  let decision: SkipDecision;
  let classificationReason: ClassificationReason | undefined;

  if (disqualifierResult.disqualified) {
    // Disqualified queries always go to Phase 2
    decision = 'PHASE2';
    classificationReason = disqualifierResult.category
      ? categoryToReason(disqualifierResult.category)
      : 'reasoning_query';
  } else if (queryTypeResult.type === 'AMBIGUOUS') {
    // Ambiguous queries always go to Phase 2
    decision = 'PHASE2';
    classificationReason = 'ambiguous_query';
  } else if (resultCount === 0) {
    // No results
    decision = 'PHASE2';
    classificationReason = 'no_answer_found';
  } else if (rcsResult.flags.some(isBlockingFlag)) {
    // Blocking flags force Phase 2
    decision = 'PHASE2';
    if (rcsResult.flags.includes('disambiguation_needed')) {
      classificationReason = 'disambiguation';
    } else if (rcsResult.flags.includes('no_results')) {
      classificationReason = 'no_answer_found';
    } else {
      classificationReason = 'low_confidence';
    }
  } else {
    // Apply decision matrix based on confidence level
    switch (rcsResult.level) {
      case 'HIGH':
        decision = 'SKIP';
        break;
      case 'MEDIUM':
        decision = 'SKIP_WITH_CAVEAT';
        break;
      case 'LOW':
      default:
        decision = 'PHASE2';
        classificationReason = 'low_confidence';
        break;
    }
  }

  // Generate explanation
  const explanation = generateDecisionExplanation(
    decision,
    queryTypeResult.type,
    rcsResult.level,
    rcsResult.flags,
    disqualifierResult.category
  );

  // Build result
  const result: ClassificationResult = {
    query,
    queryType: queryTypeResult,
    rcs: {
      score: rcsResult.score,
      level: rcsResult.level,
      flags: rcsResult.flags,
    },
    decision,
    explanation,
  };

  // Add handoff metadata if proceeding to Phase 2
  if (decision === 'PHASE2' && classificationReason) {
    result.handoff = buildPhase2Handoff(
      classificationReason,
      relevantNodes,
      queryTypeResult,
      entities,
      attribute
    );
  }

  return result;
}

/**
 * Decision helper: Determine skip decision from classification.
 * @param classification - Complete classification result
 * @returns Skip decision (SKIP, SKIP_WITH_CAVEAT, or PHASE2)
 */
export function shouldSkipPhase2(classification: ClassificationResult): SkipDecision {
  return classification.decision;
}

/**
 * Build Phase 2 handoff metadata.
 * @param reason - Why Phase 2 is needed
 * @param relevantNodes - Phase 1 results
 * @param queryType - Query classification
 * @param entities - Extracted entities
 * @param attribute - Extracted attribute
 * @returns Handoff metadata for Phase 2
 */
export function buildPhase2Handoff(
  reason: ClassificationReason,
  relevantNodes: Array<{ node_id: string; score: number }>,
  queryType: QueryTypeResult,
  entities: string[],
  attribute: string | null
): Phase2HandoffMetadata {
  return {
    classification_reason: reason,
    phase1_results: relevantNodes.slice(0, 100).map(n => ({
      node_id: n.node_id,
      score: n.score,
    })),
    query_analysis: {
      type: queryType.type,
      entities,
      attribute,
      confidence: queryType.confidence,
    },
  };
}

// ============================================================
// VALIDATION FUNCTIONS
// ============================================================

export function validateDisqualifierResult(result: unknown): result is DisqualifierResult {
  return DisqualifierResultSchema.safeParse(result).success;
}

export function validateQueryTypeResult(result: unknown): result is QueryTypeResult {
  return QueryTypeResultSchema.safeParse(result).success;
}

export function validateClassificationResult(result: unknown): result is ClassificationResult {
  return ClassificationResultSchema.safeParse(result).success;
}

export function validatePhase2HandoffMetadata(metadata: unknown): metadata is Phase2HandoffMetadata {
  return Phase2HandoffMetadataSchema.safeParse(metadata).success;
}

export function validateQCSConfig(config: unknown): config is QCSConfig {
  return QCSConfigSchema.safeParse(config).success;
}
