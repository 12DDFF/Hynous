/**
 * @module @nous/core/retrieval
 * @description Two-Phase Cognition retrieval architecture
 * @version 1.0.0
 * @spec Brainstorms/Specs/Phase-3-Retrieval-Core/storm-003
 * @storm Brainstorms/Infrastructure/storm-003-retrieval-architecture
 *
 * This is the main entry point for the retrieval module.
 *
 * Two-Phase Cognition Pipeline:
 * 1. Phase 1 (SSA): Fast math-based activation (<100ms)
 * 2. QCS Decision: Should Phase 2 run?
 * 3. Phase 2 (Bounded Graph-CoT): Orient → Explore → Synthesize (3-4s)
 * 4. Response Assembly: Results with explanations
 *
 * @see storm-005 for SSA (Phase 1)
 * @see storm-008 for QCS (Query Classification)
 */

import { z } from 'zod';

// ============================================================================
// CONSTANTS
// From storm-003 v3: Performance Budget
// ============================================================================

/**
 * Maximum entry points to identify in Orient step.
 * Research shows 2-3 entry points provide good coverage without over-exploration.
 */
export const PHASE2_MAX_ENTRY_POINTS = 3;

/**
 * Minimum entry points to identify in Orient step.
 */
export const PHASE2_MIN_ENTRY_POINTS = 2;

/**
 * Maximum iterations per entry point during Explore step.
 * From KG-IRAG research: 3-6 iterations suffice for most tasks.
 */
export const PHASE2_MAX_ITERATIONS = 3;

/**
 * Maximum total hops across all entry points.
 * Prevents runaway exploration while ensuring thorough coverage.
 */
export const PHASE2_MAX_TOTAL_HOPS = 6;

/**
 * Hard timeout for Phase 2 execution in milliseconds.
 */
export const PHASE2_TIMEOUT_MS = 10000;

/**
 * Soft timeout warning threshold in milliseconds.
 */
export const PHASE2_SOFT_TIMEOUT_MS = 8000;

/**
 * Token budget estimates per Phase 2 step.
 */
export const ORIENT_TOKEN_BUDGET = 1000;
export const EXPLORE_TOKEN_BUDGET = 2700;
export const SYNTHESIZE_TOKEN_BUDGET = 2000;
export const TOTAL_TOKEN_BUDGET = ORIENT_TOKEN_BUDGET + EXPLORE_TOKEN_BUDGET + SYNTHESIZE_TOKEN_BUDGET;

/**
 * Performance targets in milliseconds.
 */
export const PHASE1_TARGET_MS = 100;
export const PHASE2_TYPICAL_MS = 3500;
export const PHASE2_WORST_CASE_MS = 8000;

/**
 * Concept map size limits.
 */
export const DEFAULT_CONCEPT_MAP_SIZE = 30;
export const MAX_CONCEPT_MAP_SIZE = 50;

/**
 * Confidence thresholds.
 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.5;
export const LOW_CONFIDENCE_THRESHOLD = 0.3;

// ============================================================================
// QUERY TYPES
// From storm-003 v5: 5 query types with different behaviors
// ============================================================================

/**
 * Query types for classification.
 *
 * - **factual**: Single correct answer exists (birthday, email, definition)
 * - **list**: Multiple items expected (all deadlines, all people)
 * - **exploratory**: Open-ended, multiple perspectives (how X relates to Y)
 * - **temporal**: Time-based queries (what happened last week)
 * - **procedural**: How-to queries (how do I do X)
 */
export const QUERY_TYPES = ['factual', 'list', 'exploratory', 'temporal', 'procedural'] as const;
export type QueryType = (typeof QUERY_TYPES)[number];

export const QueryTypeSchema = z.enum(QUERY_TYPES);

/**
 * Regular expression patterns for detecting query types.
 */
export const QUERY_TYPE_PATTERNS: Record<QueryType, RegExp[]> = {
  factual: [
    /what(?:'s|'s| is)\s+\S+(?:\s+\S+)?'s\s+(birthday|email|phone|address|name)/i,
    /when (is|was)\s+.+'s birthday/i,
    /^who is\s+\S+/i,
    /what does\s+.+\s+mean/i,
    /^define\s+.+/i,
    /what year did/i,
    /what is the\s+\S+\s+of\s+/i,
  ],
  list: [
    /what are (all|the)\s+.+s\s*\??$/i,
    /^list (all|the|my)\s+.+/i,
    /show me (all|every|my)\s+.+/i,
    /how many\s+.+\s+(do i|are there)/i,
    /give me (all|the)\s+.+/i,
    /what\s+\S+s\s+do i have/i,
  ],
  exploratory: [
    /how does\s+.+\s+relate to\s+.+/i,
    /what(?:'s|'s| is) the (connection|relationship) between/i,
    /^why (does|did|is|was)\s+.+/i,
    /^explain\s+.+/i,
    /^tell me about\s+.+/i,
    /what do I know about\s+.+/i,
    /what(?:'s|'s| is) related to\s+.+/i,
  ],
  temporal: [
    /what happened (on|last|this|in)\s+.+/i,
    /(last|this|next) (week|month|year)/i,
    /between\s+.+\s+and\s+.+/i,
    /since\s+.+/i,
    /before\s+.+/i,
    /after\s+.+/i,
    /in (january|february|march|april|may|june|july|august|september|october|november|december)/i,
    /on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /during\s+.+/i,
  ],
  procedural: [
    /^how (do|can|should) (i|we|you)\s+.+/i,
    /^steps to\s+.+/i,
    /^how to\s+.+/i,
    /what(?:'s|'s| is) the (process|procedure) for/i,
    /what are the steps to/i,
    /walk me through\s+.+/i,
  ],
};

/**
 * Context that may influence query type detection.
 */
export interface QueryContext {
  conversationHistory?: string[];
  userIntent?: 'question' | 'command' | 'explore';
  inConversation?: boolean;
}

export const QueryContextSchema = z.object({
  conversationHistory: z.array(z.string()).optional(),
  userIntent: z.enum(['question', 'command', 'explore']).optional(),
  inConversation: z.boolean().optional(),
});

/**
 * Result of query type detection.
 */
export interface QueryTypeResult {
  type: QueryType;
  confidence: number;
  matchedPattern?: string;
  fallbackUsed: boolean;
}

export const QueryTypeResultSchema = z.object({
  type: QueryTypeSchema,
  confidence: z.number().min(0).max(1),
  matchedPattern: z.string().optional(),
  fallbackUsed: z.boolean(),
});

/**
 * Detect query type from query text.
 */
export function detectQueryType(query: string, _context?: QueryContext): QueryTypeResult {
  const normalizedQuery = query.trim();

  // Check each pattern type
  for (const [type, patterns] of Object.entries(QUERY_TYPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedQuery)) {
        return {
          type: type as QueryType,
          confidence: 0.9,
          matchedPattern: pattern.source,
          fallbackUsed: false,
        };
      }
    }
  }

  // Fallback heuristics
  const lowerQuery = normalizedQuery.toLowerCase();

  if (lowerQuery.startsWith('what') || lowerQuery.startsWith('who') || lowerQuery.startsWith('when')) {
    if (normalizedQuery.length < 50 && !lowerQuery.includes(' and ')) {
      return { type: 'factual', confidence: 0.6, fallbackUsed: true };
    }
  }

  if (lowerQuery.startsWith('how')) {
    return { type: 'procedural', confidence: 0.5, fallbackUsed: true };
  }

  if (lowerQuery.startsWith('why')) {
    return { type: 'exploratory', confidence: 0.6, fallbackUsed: true };
  }

  return { type: 'exploratory', confidence: 0.3, fallbackUsed: true };
}

export function isQueryType(value: string): value is QueryType {
  return QUERY_TYPES.includes(value as QueryType);
}

export function validateQueryTypeResult(result: unknown): result is QueryTypeResult {
  return QueryTypeResultSchema.safeParse(result).success;
}

// ============================================================================
// SUFFICIENCY
// From storm-003 v5: Query-Type-Aware Fallback Thresholds
// ============================================================================

/**
 * Sufficiency thresholds for result evaluation.
 */
export interface SufficiencyThresholds {
  min_results: number;
  min_top_score: number;
  min_coverage_score?: number;
  require_high_confidence: boolean;
}

export const SufficiencyThresholdsSchema = z.object({
  min_results: z.number().int().nonnegative(),
  min_top_score: z.number().min(0).max(1),
  min_coverage_score: z.number().min(0).max(1).optional(),
  require_high_confidence: z.boolean(),
});

/**
 * Query-type-aware threshold configuration.
 */
export const THRESHOLDS_BY_QUERY_TYPE: Record<QueryType, SufficiencyThresholds> = {
  factual: {
    min_results: 1,
    min_top_score: 0.7,
    require_high_confidence: true,
  },
  list: {
    min_results: 5,
    min_top_score: 0.5,
    min_coverage_score: 0.6,
    require_high_confidence: false,
  },
  exploratory: {
    min_results: 3,
    min_top_score: 0.4,
    require_high_confidence: false,
  },
  temporal: {
    min_results: 1,
    min_top_score: 0.5,
    require_high_confidence: false,
  },
  procedural: {
    min_results: 2,
    min_top_score: 0.6,
    require_high_confidence: false,
  },
};

/**
 * Content types that are authoritative for factual queries.
 */
export const AUTHORITATIVE_CONTENT_TYPES = [
  'person', 'fact', 'definition', 'event', 'contact', 'identity',
] as const;
export type AuthoritativeContentType = (typeof AUTHORITATIVE_CONTENT_TYPES)[number];

export const AuthoritativeContentTypeSchema = z.enum(AUTHORITATIVE_CONTENT_TYPES);

/**
 * Fallback actions when results are insufficient.
 */
export const FALLBACK_ACTIONS = ['none', 'simplify', 'switch', 'clarify', 'explain'] as const;
export type FallbackAction = (typeof FALLBACK_ACTIONS)[number];

export const FallbackActionSchema = z.enum(FALLBACK_ACTIONS);

/**
 * Result of checking result sufficiency.
 */
export interface SufficiencyResult {
  is_sufficient: boolean;
  reason: string;
  suggested_action?: FallbackAction;
}

export const SufficiencyResultSchema = z.object({
  is_sufficient: z.boolean(),
  reason: z.string(),
  suggested_action: FallbackActionSchema.optional(),
});

/**
 * Minimal search result interface for sufficiency checking.
 */
export interface SearchResultForSufficiency {
  node_id: string;
  score: number;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  node_type?: string;
}

export const SearchResultForSufficiencySchema = z.object({
  node_id: z.string(),
  score: z.number().min(0).max(1),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  node_type: z.string().optional(),
});

/**
 * Check if a result is authoritative for factual queries.
 */
export function isAuthoritativeResult(
  result: SearchResultForSufficiency,
  queryType: QueryType
): boolean {
  if (queryType !== 'factual') return false;

  const isAuthoritativeType =
    result.node_type !== undefined &&
    AUTHORITATIVE_CONTENT_TYPES.includes(result.node_type as AuthoritativeContentType);

  return (
    isAuthoritativeType &&
    result.score >= HIGH_CONFIDENCE_THRESHOLD &&
    result.confidence === 'HIGH'
  );
}

/**
 * Calculate coverage score for list queries.
 */
export function calculateCoverageScore(results: SearchResultForSufficiency[]): number {
  if (results.length === 0) return 0;

  let weightedSum = 0;
  let weightSum = 0;

  for (let i = 0; i < results.length; i++) {
    const weight = 1 / (i + 1);
    weightedSum += results[i].score * weight;
    weightSum += weight;
  }

  return weightedSum / weightSum;
}

/**
 * Check if results are sufficient for the query type.
 */
export function checkResultSufficiency(
  results: SearchResultForSufficiency[],
  _query: string,
  queryType: QueryType
): SufficiencyResult {
  const thresholds = THRESHOLDS_BY_QUERY_TYPE[queryType];

  // Special case: Factual query with authoritative result
  if (queryType === 'factual' && results.length >= 1) {
    if (isAuthoritativeResult(results[0], queryType)) {
      return {
        is_sufficient: true,
        reason: `Found authoritative ${results[0].node_type} with high confidence`,
      };
    }
  }

  // Check minimum results
  if (results.length < thresholds.min_results) {
    return {
      is_sufficient: false,
      reason: `Found ${results.length} results, need ${thresholds.min_results} for ${queryType} query`,
      suggested_action: results.length === 0 ? 'explain' : 'simplify',
    };
  }

  // Check top score
  if (results[0].score < thresholds.min_top_score) {
    return {
      is_sufficient: false,
      reason: `Top result score ${results[0].score.toFixed(2)} below threshold ${thresholds.min_top_score}`,
      suggested_action: 'clarify',
    };
  }

  // Check coverage for list queries
  if (queryType === 'list' && thresholds.min_coverage_score !== undefined) {
    const coverageScore = calculateCoverageScore(results);
    if (coverageScore < thresholds.min_coverage_score) {
      return {
        is_sufficient: false,
        reason: `Coverage score ${coverageScore.toFixed(2)} suggests incomplete list`,
        suggested_action: 'switch',
      };
    }
  }

  // Check high confidence requirement
  if (thresholds.require_high_confidence) {
    const hasHighConfidence = results.some((r) => r.confidence === 'HIGH');
    if (!hasHighConfidence) {
      return {
        is_sufficient: false,
        reason: `No high-confidence results for ${queryType} query`,
        suggested_action: 'clarify',
      };
    }
  }

  return { is_sufficient: true, reason: `Meets ${queryType} sufficiency criteria` };
}

export function getThresholdsForQueryType(queryType: QueryType): SufficiencyThresholds {
  return THRESHOLDS_BY_QUERY_TYPE[queryType];
}

export function isFallbackAction(value: string): value is FallbackAction {
  return FALLBACK_ACTIONS.includes(value as FallbackAction);
}

export function isAuthoritativeContentType(value: string): value is AuthoritativeContentType {
  return AUTHORITATIVE_CONTENT_TYPES.includes(value as AuthoritativeContentType);
}

export function validateSufficiencyResult(result: unknown): result is SufficiencyResult {
  return SufficiencyResultSchema.safeParse(result).success;
}

export function validateSufficiencyThresholds(thresholds: unknown): thresholds is SufficiencyThresholds {
  return SufficiencyThresholdsSchema.safeParse(thresholds).success;
}

// ============================================================================
// VERBOSITY
// From storm-003 v5: Confidence-Adaptive Explanation Verbosity
// ============================================================================

/**
 * Verbosity levels for explanations.
 */
export const VERBOSITY_LEVELS = ['minimal', 'standard', 'verbose'] as const;
export type VerbosityLevel = (typeof VERBOSITY_LEVELS)[number];

export const VerbosityLevelSchema = z.enum(VERBOSITY_LEVELS);

/**
 * Configuration for verbosity display.
 */
export interface VerbosityConfig {
  level: VerbosityLevel;
  show_score: boolean;
  show_ranking_factors: boolean;
  show_connection_path: boolean;
  show_what_matched: boolean;
}

export const VerbosityConfigSchema = z.object({
  level: VerbosityLevelSchema,
  show_score: z.boolean(),
  show_ranking_factors: z.boolean(),
  show_connection_path: z.boolean(),
  show_what_matched: z.boolean(),
});

/**
 * Verbosity configurations per level.
 */
export const VERBOSITY_CONFIGS: Record<VerbosityLevel, VerbosityConfig> = {
  minimal: {
    level: 'minimal',
    show_score: false,
    show_ranking_factors: false,
    show_connection_path: false,
    show_what_matched: true,
  },
  standard: {
    level: 'standard',
    show_score: false,
    show_ranking_factors: true,
    show_connection_path: true,
    show_what_matched: true,
  },
  verbose: {
    level: 'verbose',
    show_score: true,
    show_ranking_factors: true,
    show_connection_path: true,
    show_what_matched: true,
  },
};

/**
 * User retrieval settings.
 */
export interface UserRetrievalSettings {
  explanation_verbosity: 'auto' | VerbosityLevel;
  show_confidence_scores: boolean;
  show_explanations: boolean;
  explanation_display: 'hover' | 'always';
}

export const UserRetrievalSettingsSchema = z.object({
  explanation_verbosity: z.union([z.literal('auto'), VerbosityLevelSchema]),
  show_confidence_scores: z.boolean(),
  show_explanations: z.boolean(),
  explanation_display: z.enum(['hover', 'always']),
});

/**
 * Default user retrieval settings.
 */
export const DEFAULT_RETRIEVAL_SETTINGS: UserRetrievalSettings = {
  explanation_verbosity: 'auto',
  show_confidence_scores: false,
  show_explanations: true,
  explanation_display: 'hover',
};

/**
 * Select verbosity level based on confidence and query type.
 */
export function selectVerbosity(
  score: number,
  queryType: QueryType,
  userPreference?: VerbosityLevel
): VerbosityLevel {
  if (userPreference) return userPreference;

  if (score >= 0.8 && queryType === 'factual') return 'minimal';
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return 'standard';
  if (score >= MEDIUM_CONFIDENCE_THRESHOLD) return 'standard';

  return 'verbose';
}

export function getVerbosityConfig(level: VerbosityLevel): VerbosityConfig {
  return VERBOSITY_CONFIGS[level];
}

export function getAutoVerbosityConfig(
  score: number,
  queryType: QueryType,
  userSettings?: UserRetrievalSettings
): VerbosityConfig {
  const preference =
    userSettings?.explanation_verbosity === 'auto'
      ? undefined
      : userSettings?.explanation_verbosity;

  const level = selectVerbosity(score, queryType, preference);
  return VERBOSITY_CONFIGS[level];
}

export function isVerbosityLevel(value: string): value is VerbosityLevel {
  return VERBOSITY_LEVELS.includes(value as VerbosityLevel);
}

export function validateVerbosityConfig(config: unknown): config is VerbosityConfig {
  return VerbosityConfigSchema.safeParse(config).success;
}

export function validateUserRetrievalSettings(settings: unknown): settings is UserRetrievalSettings {
  return UserRetrievalSettingsSchema.safeParse(settings).success;
}

// ============================================================================
// EXTRACTION
// From storm-003 v4: Goal-First Extraction
// ============================================================================

/**
 * Content priority levels for extraction.
 */
export const CONTENT_PRIORITIES = ['high', 'medium', 'low'] as const;
export type ContentPriority = (typeof CONTENT_PRIORITIES)[number];

export const ContentPrioritySchema = z.enum(CONTENT_PRIORITIES);

/**
 * Types of extracted content segments.
 */
export const SEGMENT_TYPES = ['answer', 'definition', 'number', 'name', 'decision', 'action'] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

export const SegmentTypeSchema = z.enum(SEGMENT_TYPES);

/**
 * A single extracted segment from content.
 */
export interface ExtractedSegment {
  text: string;
  type: SegmentType;
  relevance_score: number;
  source_location: string;
}

export const ExtractedSegmentSchema = z.object({
  text: z.string().min(1),
  type: SegmentTypeSchema,
  relevance_score: z.number().min(0).max(1),
  source_location: z.string(),
});

/**
 * Result of goal-first extraction from a single node.
 */
export interface ExtractedContent {
  node_id: string;
  original_length: number;
  extracted_length: number;
  compression_ratio: number;
  high_priority: ExtractedSegment[];
  medium_priority: ExtractedSegment[];
  omitted_sections: string[];
}

export const ExtractedContentSchema = z.object({
  node_id: z.string(),
  original_length: z.number().int().nonnegative(),
  extracted_length: z.number().int().nonnegative(),
  compression_ratio: z.number().min(0).max(1),
  high_priority: z.array(ExtractedSegmentSchema),
  medium_priority: z.array(ExtractedSegmentSchema),
  omitted_sections: z.array(z.string()),
});

/**
 * Request for goal-first extraction.
 */
export interface ExtractionRequest {
  questions: string[];
  content: string;
  node_id: string;
  max_tokens?: number;
}

export const ExtractionRequestSchema = z.object({
  questions: z.array(z.string().min(1)).min(1),
  content: z.string().min(1),
  node_id: z.string(),
  max_tokens: z.number().int().positive().optional(),
});

/**
 * Extraction rules for prioritization.
 */
export const EXTRACTION_RULES = {
  high_priority: {
    description: 'Always include these content types',
    includes: [
      'Direct answer passages',
      'Definitions and constraints (must/should/never)',
      'Numbers, dates, specific values',
      'Names, IDs, exact strings',
      'Decision points',
      'Action items',
    ],
  },
  medium_priority: {
    description: 'Include if space permits',
    includes: ['Supporting context', 'Related examples', 'Definitions of terms used'],
  },
  low_priority: {
    description: 'Omit unless explicitly asked',
    includes: ['Long background sections', 'Repeated phrasing', 'Decorative formatting', 'Tangential examples'],
  },
} as const;

export function calculateCompressionRatio(originalLength: number, extractedLength: number): number {
  if (originalLength === 0) return 0;
  return 1 - extractedLength / originalLength;
}

export function getExtractedLength(extracted: ExtractedContent): number {
  const highPriorityLength = extracted.high_priority.reduce((sum, seg) => sum + seg.text.length, 0);
  const mediumPriorityLength = extracted.medium_priority.reduce((sum, seg) => sum + seg.text.length, 0);
  return highPriorityLength + mediumPriorityLength;
}

export function combineExtractedContent(extractions: ExtractedContent[]): ExtractedSegment[] {
  const allSegments: ExtractedSegment[] = [];

  for (const extraction of extractions) {
    allSegments.push(...extraction.high_priority);
    allSegments.push(...extraction.medium_priority);
  }

  return allSegments.sort((a, b) => b.relevance_score - a.relevance_score);
}

export function isSegmentType(value: string): value is SegmentType {
  return SEGMENT_TYPES.includes(value as SegmentType);
}

export function isContentPriority(value: string): value is ContentPriority {
  return CONTENT_PRIORITIES.includes(value as ContentPriority);
}

export function validateExtractedContent(content: unknown): content is ExtractedContent {
  return ExtractedContentSchema.safeParse(content).success;
}

export function validateExtractedSegment(segment: unknown): segment is ExtractedSegment {
  return ExtractedSegmentSchema.safeParse(segment).success;
}

export function validateExtractionRequest(request: unknown): request is ExtractionRequest {
  return ExtractionRequestSchema.safeParse(request).success;
}

// ============================================================================
// WHY INCLUDED
// From storm-003 v4: "Why This Result?" explanations
// ============================================================================

/**
 * Primary signals that can explain why a result was included.
 */
export const PRIMARY_SIGNALS = ['semantic', 'keyword', 'graph', 'recency', 'authority', 'affinity'] as const;
export type PrimarySignal = (typeof PRIMARY_SIGNALS)[number];

export const PrimarySignalSchema = z.enum(PRIMARY_SIGNALS);

/**
 * Explanation for why a result was included.
 */
export interface WhyIncluded {
  primary_reason: string;
  ranking_factors: string[];
  connection_path?: string;
}

export const WhyIncludedSchema = z.object({
  primary_reason: z.string().min(1),
  ranking_factors: z.array(z.string()),
  connection_path: z.string().optional(),
});

/**
 * Score breakdown for a ranked node.
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
 * Complete ranking reason from SSA.
 */
export interface RankingReason {
  primary_signal: PrimarySignal;
  explanation: string;
  score_breakdown: ScoreBreakdown;
}

export const RankingReasonSchema = z.object({
  primary_signal: PrimarySignalSchema,
  explanation: z.string(),
  score_breakdown: ScoreBreakdownSchema,
});

/**
 * Query context for explanation generation.
 */
export interface QueryContextForExplanation {
  query: string;
  questions?: string[];
}

/**
 * Generate "Why Included" explanation from ranking reason.
 */
export function generateWhyIncluded(
  rankingReason: RankingReason,
  _queryContext: QueryContextForExplanation
): WhyIncluded {
  const reasons: string[] = [];
  const breakdown = rankingReason.score_breakdown;

  const primaryReason = getPrimaryReasonText(rankingReason.primary_signal, breakdown);

  if (breakdown.keyword > 0.6 && rankingReason.primary_signal !== 'keyword') {
    reasons.push('Strong keyword match in title');
  }
  if (breakdown.semantic > 0.7 && rankingReason.primary_signal !== 'semantic') {
    reasons.push('Semantically related to query');
  }
  if (breakdown.recency > 0.7 && rankingReason.primary_signal !== 'recency') {
    reasons.push('Recently viewed');
  }
  if (breakdown.authority > 0.6 && rankingReason.primary_signal !== 'authority') {
    reasons.push('Well-connected knowledge');
  }
  if (breakdown.graph > 0.6 && rankingReason.primary_signal !== 'graph') {
    reasons.push('Connected to relevant concepts');
  }
  if (breakdown.affinity > 0.6 && rankingReason.primary_signal !== 'affinity') {
    reasons.push('Frequently accessed');
  }

  const connectionPath =
    rankingReason.primary_signal === 'graph' ? 'Connected via knowledge graph' : undefined;

  return {
    primary_reason: primaryReason,
    ranking_factors: [primaryReason, ...reasons].slice(0, 4),
    connection_path: connectionPath,
  };
}

function getPrimaryReasonText(signal: PrimarySignal, breakdown: ScoreBreakdown): string {
  const score = breakdown[signal];
  const percentage = Math.round(score * 100);

  switch (signal) {
    case 'semantic':
      return `Content is semantically related to your query (${percentage}% match)`;
    case 'keyword':
      return `Contains matching keywords (${percentage}% match)`;
    case 'graph':
      return `Connected to relevant concepts via knowledge graph`;
    case 'recency':
      return `Recently accessed or updated`;
    case 'authority':
      return `Well-referenced content (${percentage}% authority)`;
    case 'affinity':
      return `Frequently accessed content`;
    default:
      return `Matched on ${signal} (${percentage}%)`;
  }
}

export function formatScoreBreakdown(breakdown: ScoreBreakdown): string[] {
  const lines: string[] = [];

  if (breakdown.semantic > 0) lines.push(`Semantic: ${Math.round(breakdown.semantic * 100)}%`);
  if (breakdown.keyword > 0) lines.push(`Keyword: ${Math.round(breakdown.keyword * 100)}%`);
  if (breakdown.graph > 0) lines.push(`Graph: ${Math.round(breakdown.graph * 100)}%`);
  if (breakdown.recency > 0) lines.push(`Recency: ${Math.round(breakdown.recency * 100)}%`);
  if (breakdown.authority > 0) lines.push(`Authority: ${Math.round(breakdown.authority * 100)}%`);
  if (breakdown.affinity > 0) lines.push(`Affinity: ${Math.round(breakdown.affinity * 100)}%`);

  return lines;
}

export function isPrimarySignal(value: string): value is PrimarySignal {
  return PRIMARY_SIGNALS.includes(value as PrimarySignal);
}

export function validateWhyIncluded(explanation: unknown): explanation is WhyIncluded {
  return WhyIncludedSchema.safeParse(explanation).success;
}

export function validateRankingReason(reason: unknown): reason is RankingReason {
  return RankingReasonSchema.safeParse(reason).success;
}

export function validateScoreBreakdown(breakdown: unknown): breakdown is ScoreBreakdown {
  return ScoreBreakdownSchema.safeParse(breakdown).success;
}

// ============================================================================
// PHASE 2 (BOUNDED GRAPH-COT)
// From storm-003 v4: Orient → Explore → Synthesize
// ============================================================================

/**
 * Status of Phase 2 execution.
 */
export const PHASE2_STATUSES = ['skipped', 'running', 'completed', 'timeout', 'error'] as const;
export type Phase2Status = (typeof PHASE2_STATUSES)[number];

export const Phase2StatusSchema = z.enum(PHASE2_STATUSES);

/**
 * An entry point selected during Orient stage.
 */
export interface EntryPoint {
  node_id: string;
  reason: string;
  relevance_score: number;
  exploration_hint?: string;
}

export const EntryPointSchema = z.object({
  node_id: z.string(),
  reason: z.string(),
  relevance_score: z.number().min(0).max(1),
  exploration_hint: z.string().optional(),
});

/**
 * Result of the Orient stage.
 */
export interface OrientResult {
  entry_points: EntryPoint[];
  questions_addressed: string[];
  tokens_used: number;
  duration_ms: number;
}

export const OrientResultSchema = z.object({
  entry_points: z.array(EntryPointSchema).max(PHASE2_MAX_ENTRY_POINTS),
  questions_addressed: z.array(z.string()),
  tokens_used: z.number().int().nonnegative(),
  duration_ms: z.number().nonnegative(),
});

/**
 * A single hop during exploration.
 */
export interface ExplorationHop {
  from_node: string;
  to_node: string;
  edge_type: string;
  reason: string;
  finding?: string;
}

export const ExplorationHopSchema = z.object({
  from_node: z.string(),
  to_node: z.string(),
  edge_type: z.string(),
  reason: z.string(),
  finding: z.string().optional(),
});

/**
 * A single exploration iteration.
 */
export interface ExplorationIteration {
  iteration: number;
  hops: ExplorationHop[];
  nodes_visited: string[];
  findings: string[];
  should_continue: boolean;
  stop_reason?: string;
}

export const ExplorationIterationSchema = z.object({
  iteration: z.number().int().min(1).max(PHASE2_MAX_ITERATIONS),
  hops: z.array(ExplorationHopSchema),
  nodes_visited: z.array(z.string()),
  findings: z.array(z.string()),
  should_continue: z.boolean(),
  stop_reason: z.string().optional(),
});

/**
 * Result of the Explore stage.
 */
export interface ExploreResult {
  iterations: ExplorationIteration[];
  total_hops: number;
  all_nodes_visited: string[];
  all_findings: string[];
  tokens_used: number;
  duration_ms: number;
}

export const ExploreResultSchema = z.object({
  iterations: z.array(ExplorationIterationSchema).max(PHASE2_MAX_ITERATIONS),
  total_hops: z.number().int().nonnegative().max(PHASE2_MAX_TOTAL_HOPS),
  all_nodes_visited: z.array(z.string()),
  all_findings: z.array(z.string()),
  tokens_used: z.number().int().nonnegative(),
  duration_ms: z.number().nonnegative(),
});

/**
 * A source reference for the synthesized answer.
 */
export interface SynthesisSource {
  node_id: string;
  title: string;
  supports: string;
  relevance: number;
}

export const SynthesisSourceSchema = z.object({
  node_id: z.string(),
  title: z.string(),
  supports: z.string(),
  relevance: z.number().min(0).max(1),
});

/**
 * Result of the Synthesize stage.
 */
export interface SynthesizeResult {
  answer: string;
  sources: SynthesisSource[];
  confidence: number;
  answer_completeness: 'complete' | 'partial' | 'uncertain';
  missing_information?: string;
  tokens_used: number;
  duration_ms: number;
}

export const SynthesizeResultSchema = z.object({
  answer: z.string(),
  sources: z.array(SynthesisSourceSchema),
  confidence: z.number().min(0).max(1),
  answer_completeness: z.enum(['complete', 'partial', 'uncertain']),
  missing_information: z.string().optional(),
  tokens_used: z.number().int().nonnegative(),
  duration_ms: z.number().nonnegative(),
});

/**
 * Complete result of Phase 2 execution.
 */
export interface Phase2Result {
  status: Phase2Status;
  orient?: OrientResult;
  explore?: ExploreResult;
  synthesize?: SynthesizeResult;
  total_tokens_used: number;
  total_duration_ms: number;
  within_budget: boolean;
  error?: string;
}

export const Phase2ResultSchema = z.object({
  status: Phase2StatusSchema,
  orient: OrientResultSchema.optional(),
  explore: ExploreResultSchema.optional(),
  synthesize: SynthesizeResultSchema.optional(),
  total_tokens_used: z.number().int().nonnegative(),
  total_duration_ms: z.number().nonnegative(),
  within_budget: z.boolean(),
  error: z.string().optional(),
});

/**
 * Request to execute Phase 2.
 */
export interface Phase2Request {
  questions: string[];
  ssa_results: Array<{ node_id: string; score: number; title?: string }>;
  timeout_ms?: number;
  token_budget?: number;
}

export const Phase2RequestSchema = z.object({
  questions: z.array(z.string().min(1)).min(1),
  ssa_results: z.array(
    z.object({
      node_id: z.string(),
      score: z.number().min(0).max(1),
      title: z.string().optional(),
    })
  ),
  timeout_ms: z.number().int().positive().optional(),
  token_budget: z.number().int().positive().optional(),
});

export function getPhase2TokenBudget(): number {
  return TOTAL_TOKEN_BUDGET;
}

export function isWithinBudget(result: Phase2Result): boolean {
  return result.total_tokens_used <= TOTAL_TOKEN_BUDGET && result.total_duration_ms <= PHASE2_TIMEOUT_MS;
}

export function createSkippedResult(reason: string): Phase2Result {
  return {
    status: 'skipped',
    total_tokens_used: 0,
    total_duration_ms: 0,
    within_budget: true,
    error: reason,
  };
}

export function createTimeoutResult(partial: Partial<Phase2Result>, duration_ms: number): Phase2Result {
  return {
    status: 'timeout',
    orient: partial.orient,
    explore: partial.explore,
    synthesize: partial.synthesize,
    total_tokens_used: partial.total_tokens_used ?? 0,
    total_duration_ms: duration_ms,
    within_budget: false,
    error: `Phase 2 exceeded timeout of ${PHASE2_TIMEOUT_MS}ms`,
  };
}

export function createErrorResult(error: string, duration_ms: number): Phase2Result {
  return {
    status: 'error',
    total_tokens_used: 0,
    total_duration_ms: duration_ms,
    within_budget: true,
    error,
  };
}

export function isPhase2Status(value: string): value is Phase2Status {
  return PHASE2_STATUSES.includes(value as Phase2Status);
}

export function isPhase2Completed(result: Phase2Result): boolean {
  return result.status === 'completed' && result.synthesize !== undefined;
}

export function isPhase2Skipped(result: Phase2Result): boolean {
  return result.status === 'skipped';
}

export function validatePhase2Result(result: unknown): result is Phase2Result {
  return Phase2ResultSchema.safeParse(result).success;
}

export function validatePhase2Request(request: unknown): request is Phase2Request {
  return Phase2RequestSchema.safeParse(request).success;
}

export function validateOrientResult(result: unknown): result is OrientResult {
  return OrientResultSchema.safeParse(result).success;
}

export function validateExploreResult(result: unknown): result is ExploreResult {
  return ExploreResultSchema.safeParse(result).success;
}

export function validateSynthesizeResult(result: unknown): result is SynthesizeResult {
  return SynthesizeResultSchema.safeParse(result).success;
}

// ============================================================================
// FALLBACK
// From storm-003 v4: Fallback chain for graceful degradation
// ============================================================================

/**
 * Fallback strategies available.
 */
export const FALLBACK_STRATEGIES = ['simplify', 'switch', 'clarify', 'explain'] as const;
export type FallbackStrategy = (typeof FALLBACK_STRATEGIES)[number];

export const FallbackStrategySchema = z.enum(FALLBACK_STRATEGIES);

/**
 * Alternative search strategies for switch fallback.
 */
export const ALTERNATIVE_STRATEGIES = ['title_only', 'tags', 'recent', 'connected'] as const;
export type AlternativeStrategy = (typeof ALTERNATIVE_STRATEGIES)[number];

export const AlternativeStrategySchema = z.enum(ALTERNATIVE_STRATEGIES);

/**
 * A simplified version of a query with constraints removed.
 */
export interface SimplifiedQuery {
  original: string;
  simplified: string;
  removed_constraints: string[];
}

export const SimplifiedQuerySchema = z.object({
  original: z.string(),
  simplified: z.string(),
  removed_constraints: z.array(z.string()),
});

/**
 * Clarification request when results are insufficient.
 */
export interface ClarificationRequest {
  question: string;
  suggestions: string[];
  context: string;
}

export const ClarificationRequestSchema = z.object({
  question: z.string(),
  suggestions: z.array(z.string()),
  context: z.string(),
});

/**
 * Explanation when no results can be found.
 */
export interface MissingExplanation {
  message: string;
  possible_reasons: string[];
  suggested_actions: string[];
}

export const MissingExplanationSchema = z.object({
  message: z.string(),
  possible_reasons: z.array(z.string()),
  suggested_actions: z.array(z.string()),
});

/**
 * Result of executing the fallback chain.
 */
export interface FallbackResult {
  fallback_used: FallbackStrategy | 'none';
  original_sufficiency: SufficiencyResult;
  simplified_query?: SimplifiedQuery;
  alternative_strategy?: AlternativeStrategy;
  clarification_needed?: ClarificationRequest;
  explanation?: MissingExplanation;
  strategies_tried: FallbackStrategy[];
}

export const FallbackResultSchema = z.object({
  fallback_used: z.union([FallbackStrategySchema, z.literal('none')]),
  original_sufficiency: SufficiencyResultSchema,
  simplified_query: SimplifiedQuerySchema.optional(),
  alternative_strategy: AlternativeStrategySchema.optional(),
  clarification_needed: ClarificationRequestSchema.optional(),
  explanation: MissingExplanationSchema.optional(),
  strategies_tried: z.array(FallbackStrategySchema),
});

/**
 * Search response including fallback information.
 */
export interface SearchResponseWithFallback<T = SearchResultForSufficiency> {
  results: T[];
  query_type: QueryType;
  sufficiency_reason: string;
  fallback_result?: FallbackResult;
}

/**
 * Simplify a query by removing constraints.
 */
export function simplifyQuery(query: string): SimplifiedQuery {
  const original = query;
  let simplified = query;
  const removed: string[] = [];

  const datePatterns = [
    /\s+in\s+(Q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december|\d{4})/gi,
    /\s+(last|this|next)\s+(week|month|year)/gi,
    /\s+between\s+.+\s+and\s+.+/gi,
    /\s+(before|after|since)\s+\S+/gi,
  ];

  for (const pattern of datePatterns) {
    const match = simplified.match(pattern);
    if (match) {
      removed.push(match[0].trim());
      simplified = simplified.replace(pattern, '');
    }
  }

  // Case-sensitive to only match proper nouns (e.g., "Alpha deadline" but not "project deadlines")
  const qualifierPatterns = [/\s*(project\s+)?\b[A-Z][a-z]+\b(?=\s+(deadline|meeting|task|note))/g];

  for (const pattern of qualifierPatterns) {
    const match = simplified.match(pattern);
    if (match) {
      removed.push(match[0].trim());
      simplified = simplified.replace(pattern, '');
    }
  }

  simplified = simplified.replace(/\s+/g, ' ').trim();

  return {
    original,
    simplified: simplified || original,
    removed_constraints: removed,
  };
}

/**
 * Generate clarification suggestions for a query type.
 */
export function generateClarificationForQueryType(query: string, queryType: QueryType): ClarificationRequest {
  const suggestions: string[] = [];

  switch (queryType) {
    case 'factual':
      suggestions.push('Can you provide the exact name or identifier?', 'Is there another term you might use for this?');
      break;
    case 'list':
      suggestions.push('What category or type are you looking for?', 'Any specific timeframe to consider?', 'Should I include related items?');
      break;
    case 'exploratory':
      suggestions.push('What aspect are you most interested in?', 'Any specific relationships to explore?', 'Should I focus on recent or historical connections?');
      break;
    case 'temporal':
      suggestions.push('Can you narrow down the time period?', 'Any specific events or milestones to anchor on?');
      break;
    case 'procedural':
      suggestions.push('What specific task are you trying to accomplish?', 'Have you done something similar before?', 'Any tools or systems you prefer?');
      break;
  }

  return {
    question: 'I found limited results. Can you help me narrow down?',
    suggestions,
    context: `${queryType} query with insufficient results`,
  };
}

/**
 * Generate explanation for missing results.
 */
export function generateMissingExplanation(query: string, queryType: QueryType): MissingExplanation {
  const possibleReasons = [
    'The topic may not have been captured in your knowledge base yet',
    'The information might be stored under a different name or category',
    'Relevant notes may exist but lack the specific keywords searched',
  ];

  const suggestedActions = [
    'Would you like to create a note about this topic?',
    'Try searching with different keywords or synonyms',
    'Browse recent notes to find related content',
  ];

  if (queryType === 'factual') {
    possibleReasons.push('Specific facts may not have been explicitly recorded');
  } else if (queryType === 'list') {
    possibleReasons.push('Items may be scattered across different notes');
    suggestedActions.push('Check if items are tagged or categorized differently');
  }

  return {
    message: `I couldn't find information about "${query}".`,
    possible_reasons: possibleReasons,
    suggested_actions: suggestedActions,
  };
}

export function createNoFallbackResult(sufficiency: SufficiencyResult): FallbackResult {
  return {
    fallback_used: 'none',
    original_sufficiency: sufficiency,
    strategies_tried: [],
  };
}

export function createSimplifyFallbackResult(
  originalSufficiency: SufficiencyResult,
  simplifiedQuery: SimplifiedQuery
): FallbackResult {
  return {
    fallback_used: 'simplify',
    original_sufficiency: originalSufficiency,
    simplified_query: simplifiedQuery,
    strategies_tried: ['simplify'],
  };
}

export function createSwitchFallbackResult(
  originalSufficiency: SufficiencyResult,
  alternativeStrategy: AlternativeStrategy,
  previousStrategies: FallbackStrategy[]
): FallbackResult {
  return {
    fallback_used: 'switch',
    original_sufficiency: originalSufficiency,
    alternative_strategy: alternativeStrategy,
    strategies_tried: [...previousStrategies, 'switch'],
  };
}

export function createClarifyFallbackResult(
  originalSufficiency: SufficiencyResult,
  clarification: ClarificationRequest,
  previousStrategies: FallbackStrategy[]
): FallbackResult {
  return {
    fallback_used: 'clarify',
    original_sufficiency: originalSufficiency,
    clarification_needed: clarification,
    strategies_tried: [...previousStrategies, 'clarify'],
  };
}

export function createExplainFallbackResult(
  originalSufficiency: SufficiencyResult,
  explanation: MissingExplanation,
  previousStrategies: FallbackStrategy[]
): FallbackResult {
  return {
    fallback_used: 'explain',
    original_sufficiency: originalSufficiency,
    explanation,
    strategies_tried: [...previousStrategies, 'explain'],
  };
}

export function isFallbackStrategy(value: string): value is FallbackStrategy {
  return FALLBACK_STRATEGIES.includes(value as FallbackStrategy);
}

export function isAlternativeStrategy(value: string): value is AlternativeStrategy {
  return ALTERNATIVE_STRATEGIES.includes(value as AlternativeStrategy);
}

export function validateFallbackResult(result: unknown): result is FallbackResult {
  return FallbackResultSchema.safeParse(result).success;
}

export function validateClarificationRequest(request: unknown): request is ClarificationRequest {
  return ClarificationRequestSchema.safeParse(request).success;
}

export function validateMissingExplanation(explanation: unknown): explanation is MissingExplanation {
  return MissingExplanationSchema.safeParse(explanation).success;
}

// ============================================================================
// PROMPTS
// From storm-003 v3: Prompt templates for Phase 2
// ============================================================================

/**
 * Prompt template for the Orient step.
 */
export const ORIENT_PROMPT_TEMPLATE = `You are analyzing a personal knowledge graph to answer: "{query}"

Here are the relevant concepts found (from most to least activated):
{compressed_concept_map}

Task: Identify the 2-3 best starting points for exploration.
For each, explain WHY it's relevant to the query.

Output format:
1. [node_id]: [reason this helps answer the query]
2. [node_id]: [reason]
3. [node_id]: [reason] (optional)

Important:
- Choose nodes most likely to lead to the answer
- Consider both direct matches and connected concepts
- Explain your reasoning briefly`;

/**
 * Prompt template for the Explore step.
 */
export const EXPLORE_PROMPT_TEMPLATE = `Query: "{query}"
Current location: {current_node_full_context}

Connected concepts:
{neighbors_compressed}

What you've learned so far:
{accumulated_context}

Task:
1. Does this node help answer the query? If yes, extract the key insight.
2. Which connected concept should we explore next? Pick ONE or say "sufficient".

Output format:
- Insight: [what this node tells us about the query, or "not directly relevant"]
- Next: [neighbor_id to explore] OR "sufficient - ready to answer"
- Confidence: [LOW/MEDIUM/HIGH that we can answer the query now]

Constraints:
- Only choose from the connected concepts listed above
- Be concise in your insights
- Stop exploring when confident in the answer`;

/**
 * Prompt template for the Synthesize step.
 */
export const SYNTHESIZE_PROMPT_TEMPLATE = `Query: "{query}"

Your exploration discovered these insights (goal-first extracted):
{extracted_insights}

Reasoning path:
{path_visualization}

Task: Answer the query using ONLY the extracted insights.

Format:
Answer: [your response]

Sources:
- [node_id]: [why this was relevant]

Confidence: [LOW/MEDIUM/HIGH]

If incomplete, explain what's missing and how user could help.

Important:
- Only use information from the provided insights
- Show how pieces connect in your reasoning
- Be honest about confidence level`;

/**
 * Prompt template for goal-first extraction.
 */
export const EXTRACTION_PROMPT_TEMPLATE = `Given these questions: {questions}

Extract from this content ONLY the parts that help answer the questions.

Content:
{full_content}

Rules:
1. ALWAYS include: direct answers, definitions, numbers, dates, names, decisions, action items
2. OMIT: background sections, repeated text, decorative formatting, tangential examples
3. Keep original phrasing - don't paraphrase
4. Note where each extraction came from

Output format:
EXTRACTED:
- [type: answer] "..." (from: Section Name)
- [type: number] "..." (from: Section Name)
- [type: definition] "..." (from: Section Name)
- [type: decision] "..." (from: Section Name)
- [type: action] "..." (from: Section Name)
- [type: name] "..." (from: Section Name)

OMITTED:
- [section name]: [reason omitted]

Priority types:
- answer: Direct answer to the question
- number: Numbers, dates, specific values
- definition: Constraints (must/should/never)
- name: Names, IDs, exact strings
- decision: Decision points
- action: Action items`;

/**
 * Node compression format template.
 */
export const NODE_COMPRESSION_FORMAT = '[{node_id}] {type}: {name} - {key_fact}';

/**
 * Insight compression format template.
 */
export const INSIGHT_COMPRESSION_FORMAT = 'From {node_id}: {insight}';

/**
 * Format a node into compressed format for concept map.
 */
export function formatCompressedNode(node: { id: string; type: string; name: string; keyFact: string }): string {
  return `[${node.id}] ${node.type}: ${node.name} - ${node.keyFact}`;
}

/**
 * Format an insight into compressed format.
 */
export function formatCompressedInsight(nodeId: string, insight: string): string {
  return `From ${nodeId}: ${insight}`;
}

/**
 * Format a reasoning path for visualization.
 */
export function formatReasoningPath(
  path: Array<{ nodeId: string; nodeName: string; reason: string }>
): string {
  return path
    .map((step, index) => `${index + 1}. ${step.nodeName} (${step.nodeId}) - ${step.reason}`)
    .join('\n');
}

/**
 * Format a graph path visualization.
 */
export function formatGraphPath(nodes: string[]): string {
  return nodes.join(' -> ');
}

/**
 * Variables expected by ORIENT_PROMPT_TEMPLATE.
 */
export interface OrientPromptVariables {
  query: string;
  compressed_concept_map: string;
}

/**
 * Variables expected by EXPLORE_PROMPT_TEMPLATE.
 */
export interface ExplorePromptVariables {
  query: string;
  current_node_full_context: string;
  neighbors_compressed: string;
  accumulated_context: string;
}

/**
 * Variables expected by SYNTHESIZE_PROMPT_TEMPLATE.
 */
export interface SynthesizePromptVariables {
  query: string;
  extracted_insights: string;
  path_visualization: string;
}

/**
 * Variables expected by EXTRACTION_PROMPT_TEMPLATE.
 */
export interface ExtractionPromptVariables {
  questions: string;
  full_content: string;
}

/**
 * Build Orient prompt from variables.
 */
export function buildOrientPrompt(variables: OrientPromptVariables): string {
  return ORIENT_PROMPT_TEMPLATE.replace('{query}', variables.query).replace(
    '{compressed_concept_map}',
    variables.compressed_concept_map
  );
}

/**
 * Build Explore prompt from variables.
 */
export function buildExplorePrompt(variables: ExplorePromptVariables): string {
  return EXPLORE_PROMPT_TEMPLATE.replace('{query}', variables.query)
    .replace('{current_node_full_context}', variables.current_node_full_context)
    .replace('{neighbors_compressed}', variables.neighbors_compressed)
    .replace('{accumulated_context}', variables.accumulated_context);
}

/**
 * Build Synthesize prompt from variables.
 */
export function buildSynthesizePrompt(variables: SynthesizePromptVariables): string {
  return SYNTHESIZE_PROMPT_TEMPLATE.replace('{query}', variables.query)
    .replace('{extracted_insights}', variables.extracted_insights)
    .replace('{path_visualization}', variables.path_visualization);
}

/**
 * Build Extraction prompt from variables.
 */
export function buildExtractionPrompt(variables: ExtractionPromptVariables): string {
  return EXTRACTION_PROMPT_TEMPLATE.replace('{questions}', variables.questions).replace(
    '{full_content}',
    variables.full_content
  );
}

/**
 * Recommended models per Phase 2 step.
 */
export const RECOMMENDED_MODELS = {
  orient: 'haiku' as const,
  explore: 'sonnet' as const,
  synthesize: 'sonnet' as const,
  extraction: 'haiku' as const,
};

export type Phase2Step = keyof typeof RECOMMENDED_MODELS;

/**
 * Get recommended model for a Phase 2 step.
 */
export function getRecommendedModel(step: Phase2Step): 'haiku' | 'sonnet' {
  return RECOMMENDED_MODELS[step];
}

// ============================================================================
// COGNITION (MAIN ORCHESTRATOR)
// From storm-003: Two-Phase Cognition
// ============================================================================

/**
 * Request for Two-Phase Cognition execution.
 */
export interface CognitionRequest {
  question?: string;
  questions?: string[];
  filters?: {
    clusters?: string[];
    date_range?: { before?: string; after?: string };
    node_types?: string[];
  };
  conversation_context?: string;
  user_intent?: 'question' | 'command' | 'explore';
  verbosity_override?: VerbosityLevel;
  force_skip_phase2?: boolean;
  force_phase2?: boolean;
}

export const CognitionRequestSchema = z.object({
  question: z.string().optional(),
  questions: z.array(z.string()).optional(),
  filters: z
    .object({
      clusters: z.array(z.string()).optional(),
      date_range: z.object({ before: z.string().optional(), after: z.string().optional() }).optional(),
      node_types: z.array(z.string()).optional(),
    })
    .optional(),
  conversation_context: z.string().optional(),
  user_intent: z.enum(['question', 'command', 'explore']).optional(),
  verbosity_override: VerbosityLevelSchema.optional(),
  force_skip_phase2: z.boolean().optional(),
  force_phase2: z.boolean().optional(),
});

/**
 * A single result in the cognition response.
 */
export interface CognitionResultItem {
  node_id: string;
  title: string;
  score: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  why_included: WhyIncluded;
  ranking_reason?: RankingReason;
  extracted?: ExtractedContent;
  verbosity: VerbosityLevel;
}

export const CognitionResultItemSchema = z.object({
  node_id: z.string(),
  title: z.string(),
  score: z.number().min(0).max(1),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  why_included: WhyIncludedSchema,
  ranking_reason: RankingReasonSchema.optional(),
  extracted: ExtractedContentSchema.optional(),
  verbosity: VerbosityLevelSchema,
});

/**
 * Response from Two-Phase Cognition execution.
 */
export interface CognitionResponse {
  answer?: string;
  results: CognitionResultItem[];
  query_type: QueryType;
  phase2_ran: boolean;
  phase2_result?: Phase2Result;
  reasoning_chain?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  sources: Array<{ node_id: string; title: string; relevance: string }>;
  fallback?: FallbackResult;
  metrics: CognitionMetrics;
}

export const CognitionResponseSchema = z.object({
  answer: z.string().optional(),
  results: z.array(CognitionResultItemSchema),
  query_type: QueryTypeSchema,
  phase2_ran: z.boolean(),
  phase2_result: Phase2ResultSchema.optional(),
  reasoning_chain: z.string().optional(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  sources: z.array(z.object({ node_id: z.string(), title: z.string(), relevance: z.string() })),
  fallback: FallbackResultSchema.optional(),
  metrics: z.any(),
});

/**
 * Execution metrics for cognition pipeline.
 */
export interface CognitionMetrics {
  total_duration_ms: number;
  phase1_duration_ms: number;
  phase2_duration_ms: number;
  ssa_results_count: number;
  final_results_count: number;
  tokens_used: number;
  api_calls: number;
  fallback_strategies_tried?: string[];
}

export const CognitionMetricsSchema = z.object({
  total_duration_ms: z.number().nonnegative(),
  phase1_duration_ms: z.number().nonnegative(),
  phase2_duration_ms: z.number().nonnegative(),
  ssa_results_count: z.number().int().nonnegative(),
  final_results_count: z.number().int().nonnegative(),
  tokens_used: z.number().int().nonnegative(),
  api_calls: z.number().int().nonnegative(),
  fallback_strategies_tried: z.array(z.string()).optional(),
});

/**
 * Stages in the cognition pipeline.
 */
export const PIPELINE_STAGES = [
  'query_analysis',
  'phase1_ssa',
  'qcs_decision',
  'sufficiency_check',
  'phase2_cognition',
  'fallback',
  'response_assembly',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PipelineStageSchema = z.enum(PIPELINE_STAGES);

/**
 * Internal state during cognition execution.
 */
export interface CognitionState {
  stage: PipelineStage;
  request: CognitionRequest;
  questions: string[];
  query_type?: QueryType;
  sufficiency?: SufficiencyResult;
  should_run_phase2?: boolean;
  phase2_result?: Phase2Result;
  fallback_result?: FallbackResult;
  metrics: Partial<CognitionMetrics>;
  start_time: number;
}

/**
 * Normalize request to always have questions array.
 */
export function normalizeRequest(request: CognitionRequest): string[] {
  if (request.questions && request.questions.length > 0) {
    return request.questions;
  }
  if (request.question) {
    return [request.question];
  }
  return [];
}

/**
 * Determine if Phase 2 should run based on request and QCS decision.
 */
export function shouldRunPhase2(request: CognitionRequest, qcsDecision: boolean): boolean {
  if (request.force_skip_phase2) return false;
  if (request.force_phase2) return true;
  return !qcsDecision;
}

/**
 * Calculate overall confidence from results.
 */
export function calculateOverallConfidence(
  results: Array<{ confidence: 'HIGH' | 'MEDIUM' | 'LOW'; score: number }>
): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (results.length === 0) return 'LOW';

  const highCount = results.filter((r) => r.confidence === 'HIGH').length;
  const topScore = results[0]?.score ?? 0;

  if (highCount >= 1 && topScore >= 0.7) return 'HIGH';
  if (topScore >= 0.5) return 'MEDIUM';
  return 'LOW';
}

/**
 * Format reasoning chain from Phase 2 result.
 */
export function formatReasoningChain(phase2Result: Phase2Result): string {
  const parts: string[] = [];

  if (phase2Result.orient) {
    const entryPoints = phase2Result.orient.entry_points.map((ep) => ep.node_id).join(', ');
    parts.push(`Started from: ${entryPoints}`);
  }

  if (phase2Result.explore) {
    const findings = phase2Result.explore.all_findings.slice(0, 3);
    if (findings.length > 0) {
      parts.push(`Discovered: ${findings.join('; ')}`);
    }
  }

  if (phase2Result.synthesize) {
    parts.push(`Confidence: ${phase2Result.synthesize.confidence.toFixed(0)}%`);
  }

  return parts.join(' -> ');
}

/**
 * Create empty metrics object.
 */
export function createEmptyMetrics(): CognitionMetrics {
  return {
    total_duration_ms: 0,
    phase1_duration_ms: 0,
    phase2_duration_ms: 0,
    ssa_results_count: 0,
    final_results_count: 0,
    tokens_used: 0,
    api_calls: 0,
  };
}

export function isPipelineStage(value: string): value is PipelineStage {
  return PIPELINE_STAGES.includes(value as PipelineStage);
}

export function validateCognitionRequest(request: unknown): request is CognitionRequest {
  return CognitionRequestSchema.safeParse(request).success;
}

export function validateCognitionResponse(response: unknown): response is CognitionResponse {
  return CognitionResponseSchema.safeParse(response).success;
}

export function validateCognitionMetrics(metrics: unknown): metrics is CognitionMetrics {
  return CognitionMetricsSchema.safeParse(metrics).success;
}
