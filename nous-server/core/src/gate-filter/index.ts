/**
 * @module @nous/core/gate-filter
 * @description Gate Filter System for storm-036 - High-speed rule-based filtering
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-036
 * @storm Brainstorms/Infrastructure/storm-036-gate-filter
 *
 * @see {@link Specs/Phase-4-Memory-Lifecycle/storm-036/Index} - Spec overview
 * @see {@link Brainstorms/Infrastructure/storm-036-gate-filter/Session} - Brainstorm
 */

import { z } from 'zod';

// ============================================================
// DECISION TYPES
// ============================================================

/**
 * All valid Gate Filter decisions.
 *
 * - BYPASS: Skip filter entirely (files, voice, API force, manual notes)
 * - PASS: Content enters system, continue to classification
 * - REJECT: Content discarded from memory (LLM still responds)
 * - PROMPT: User confirmation required (uncertain value)
 *
 * @see storm-036 v1 - Decision Types
 */
export const GATE_DECISIONS = ['BYPASS', 'PASS', 'REJECT', 'PROMPT'] as const;

export type GateDecision = (typeof GATE_DECISIONS)[number];

// ============================================================
// GATE REASONS
// ============================================================

/**
 * Reasons for Gate Filter decisions.
 *
 * @see storm-036 v1 - Rule Summary (R-001 to R-008)
 */
export const GATE_REASONS = [
  'too_short',       // R-001: < 3 chars
  'gibberish',       // R-002: High entropy, no real words
  'spam_pattern',    // R-003: Known spam signatures
  'repeated_chars',  // R-004: > 10 repeated characters
  'pure_filler',     // R-005: > 90% filler words (5+ word messages)
  'empty_semantic',  // R-006: Only emoji/punctuation
  'all_caps',        // R-007: All uppercase (> 10 chars)
  'social_only',     // R-008: Greetings, thanks, apologies
  'uncertain',       // Default when no strong signal
] as const;

export type GateReason = (typeof GATE_REASONS)[number];

// ============================================================
// BYPASS SOURCES
// ============================================================

/**
 * Sources that trigger bypass (skip Gate Filter entirely).
 *
 * @see storm-036 v1 - Bypass Rules (B-001 to B-004)
 */
export const BYPASS_SOURCES = [
  'api_force',        // B-001: API forceSave=true
  'file_upload',      // B-002: User uploaded a file
  'voice_transcript', // B-003: Whisper-processed voice
  'manual_note',      // B-004: User explicitly created note
] as const;

export type BypassSource = (typeof BYPASS_SOURCES)[number];

// ============================================================
// TRANSFORMATION TYPES
// ============================================================

/**
 * Types of cleanup transformations applied to PASS content.
 */
export const TRANSFORMATION_TYPES = [
  'normalize_whitespace',  // T-001: Collapse multiple spaces
  'collapse_repeats',      // T-002: Reduce repeated punctuation
  'strip_filler',          // Reserved for future (P-003 handles this)
] as const;

export type TransformationType = (typeof TRANSFORMATION_TYPES)[number];

// ============================================================
// CONFIGURATION DEFAULTS
// ============================================================

/**
 * Default Gate Filter configuration.
 *
 * @see storm-036 v1 - Configuration section
 */
export const GATE_FILTER_DEFAULTS = {
  /** Maximum allowed latency in milliseconds */
  max_latency_ms: 5,

  /** Confidence threshold for REJECT decision (very high = conservative) */
  reject_confidence: 0.95,

  /** Confidence threshold for PROMPT decision */
  prompt_confidence: 0.80,

  /** Whether Gate Filter is enabled */
  enabled: true,

  /** Log rejected content for audit (hashed, not raw) */
  log_rejected: true,

  /** Strict mode = more aggressive filtering */
  strict_mode: false,

  /** Minimum words before filler scoring applies */
  min_words_for_filler_check: 5,

  /** Default language for social pattern matching */
  default_language: 'en',
} as const;

// ============================================================
// RULE CONFIDENCE VALUES
// ============================================================

/**
 * Confidence values for each rule.
 * Tier 1: Instant reject (0.96-1.0)
 * Tier 2: Likely reject (0.85-0.95)
 * Tier 3: Consider prompt (0.50-0.85)
 *
 * Keys use R-NNN_ prefix to provide rule ID context.
 */
export const RULE_CONFIDENCES = {
  /** R-001: Too short */
  'R-001_too_short': 1.0,

  /** R-002: Gibberish detection */
  'R-002_gibberish': 0.98,

  /** R-003: Spam patterns */
  'R-003_spam_pattern': 0.97,

  /** R-004: Repeated characters */
  'R-004_repeated_chars': 0.96,

  /** R-005: Pure filler (>90%) */
  'R-005_pure_filler': 0.96,

  /** R-006: Empty semantic content */
  'R-006_empty_semantic': 0.88,

  /** R-007: All caps */
  'R-007_all_caps': 0.85,

  /** R-008: Social-only content */
  'R-008_social_only': 0.70,
} as const;

// ============================================================
// GIBBERISH DETECTION THRESHOLDS
// ============================================================

/**
 * Entropy threshold for gibberish detection (R-002).
 * Values above this indicate high character randomness.
 */
export const GIBBERISH_ENTROPY_THRESHOLD = 4.5;

/**
 * Word ratio threshold for gibberish detection (R-002).
 * Values below this indicate text is not real language.
 */
export const GIBBERISH_WORD_RATIO_THRESHOLD = 0.3;

/**
 * Filler score threshold for pure filler detection (R-005).
 * If filler words exceed this ratio, content is pure filler.
 */
export const FILLER_SCORE_THRESHOLD = 0.9;

// ============================================================
// FILLER WORDS
// ============================================================

/**
 * Filler words for R-005 detection.
 * If >90% of a 5+ word message is these, it's pure filler.
 */
export const FILLER_WORDS = new Set([
  'um',
  'uh',
  'like',
  'basically',
  'actually',
  'literally',
  'honestly',
  'so',
  'well',
  'anyway',
  'kind',
  'sort',
  'right',
  'okay',
  'yeah',
  'hmm',
]);

/**
 * Multi-word filler phrases (checked before single-word).
 */
export const FILLER_PHRASES = [
  'you know',
  'i mean',
  'kind of',
  'sort of',
];

// ============================================================
// SPAM PATTERNS
// ============================================================

/**
 * Regex patterns for spam detection (R-003).
 */
export const SPAM_PATTERNS: RegExp[] = [
  // Test/placeholder content
  /^(test|testing|asdf|qwerty)+$/i,

  // Marketing spam phrases
  /\b(buy now|click here|limited offer|act now|free money)\b/i,

  // Repeated short patterns (e.g., "hahahahaha" but shorter repeats)
  /(.{1,3})\1{5,}/,

  // Only phone numbers
  /^[0-9\s\-\+\(\)]+$/,

  // Only numbers
  /^\s*\d+\s*$/,
];

// ============================================================
// SOCIAL PATTERNS (Multi-Language)
// ============================================================

/**
 * Social-only patterns by language for R-008.
 * These match complete messages that are just social pleasantries.
 *
 * @see storm-036 v1 - Multi-language support
 */
export const SOCIAL_PATTERNS_BY_LANG: Record<string, RegExp[]> = {
  en: [
    /^(hi|hello|hey|yo|sup)[\s!?.]*$/i,
    /^(thanks|thank you|ty|thx)[\s!?.]*$/i,
    /^(sorry|my bad|oops|apologies)[\s!?.]*$/i,
    /^(bye|goodbye|see you|later|cya)[\s!?.]*$/i,
    /^(ok|okay|k|sure|yep|yeah|yes|no|nope|nah)[\s!?.]*$/i,
    /^how are you[\s!?.]*$/i,
    /^what's up[\s!?.]*$/i,
    /^(good morning|good night|gm|gn)[\s!?.]*$/i,
  ],
  es: [
    /^(hola|buenas|oye|que tal)[\s!?.]*$/i,
    /^(gracias|muchas gracias)[\s!?.]*$/i,
    /^(perdon|lo siento)[\s!?.]*$/i,
    /^(adios|hasta luego|chao)[\s!?.]*$/i,
    /^(si|no|ok|vale)[\s!?.]*$/i,
  ],
  fr: [
    /^(salut|bonjour|coucou|bonsoir)[\s!?.]*$/i,
    /^(merci|merci beaucoup)[\s!?.]*$/i,
    /^(pardon|desole)[\s!?.]*$/i,
    /^(au revoir|a bientot|ciao)[\s!?.]*$/i,
    /^(oui|non|ok|d'accord)[\s!?.]*$/i,
  ],
  de: [
    /^(hallo|hi|guten tag|moin)[\s!?.]*$/i,
    /^(danke|vielen dank)[\s!?.]*$/i,
    /^(entschuldigung|sorry)[\s!?.]*$/i,
    /^(tschuss|auf wiedersehen|ciao)[\s!?.]*$/i,
    /^(ja|nein|ok)[\s!?.]*$/i,
  ],
};

/**
 * Supported languages for social pattern matching.
 */
export const SUPPORTED_LANGUAGES = Object.keys(
  SOCIAL_PATTERNS_BY_LANG
) as string[];

// ============================================================
// COMMON WORDS (for gibberish detection)
// ============================================================

/**
 * Common English words for real word detection in gibberish check.
 * In production, use a proper dictionary or word frequency list.
 */
export const COMMON_WORDS = new Set([
  // Articles, pronouns
  'the', 'a', 'an', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their',

  // Verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'shall',

  // Conjunctions, prepositions
  'and', 'or', 'but', 'if', 'then', 'because', 'as', 'until', 'while',
  'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from',
  'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',

  // Common adverbs, adjectives
  'again', 'further', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',

  // Common nouns
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
]);

// ============================================================
// REPEATED CHARS THRESHOLD
// ============================================================

/**
 * Number of consecutive repeated characters to trigger R-004.
 */
export const REPEATED_CHARS_THRESHOLD = 10;

/**
 * Regex for detecting repeated characters.
 */
export const REPEATED_CHARS_PATTERN = /(.)\1{10,}/;

// ============================================================
// CONTENT LENGTH THRESHOLDS
// ============================================================

/**
 * Minimum content length for meaningful input (R-001).
 * Named specifically for gate filter to avoid conflict with embeddings.MIN_CONTENT_LENGTH
 */
export const GATE_MIN_CONTENT_LENGTH = 3;

/**
 * Minimum length for all-caps check (R-007).
 */
export const ALL_CAPS_MIN_LENGTH = 10;

/**
 * Minimum letter count for all-caps check.
 */
export const ALL_CAPS_MIN_LETTERS = 5;

// ============================================================
// TYPES & SCHEMAS
// ============================================================

/**
 * Gate Filter configuration.
 */
export interface GateFilterConfig {
  /** Maximum allowed latency in milliseconds (default: 5) */
  max_latency_ms: number;

  /** Confidence threshold for REJECT decision (default: 0.95) */
  reject_confidence: number;

  /** Confidence threshold for PROMPT decision (default: 0.80) */
  prompt_confidence: number;

  /** Whether Gate Filter is enabled (default: true) */
  enabled: boolean;

  /** Log rejected content for audit (default: true) */
  log_rejected: boolean;

  /** Strict mode = more aggressive filtering (default: false) */
  strict_mode: boolean;

  /** Minimum words before filler scoring applies (default: 5) */
  min_words_for_filler_check: number;

  /** Default language for social pattern matching (default: 'en') */
  default_language: string;
}

/**
 * Zod schema for GateFilterConfig.
 */
export const GateFilterConfigSchema = z.object({
  max_latency_ms: z.number().min(1).max(100).default(GATE_FILTER_DEFAULTS.max_latency_ms),
  reject_confidence: z.number().min(0).max(1).default(GATE_FILTER_DEFAULTS.reject_confidence),
  prompt_confidence: z.number().min(0).max(1).default(GATE_FILTER_DEFAULTS.prompt_confidence),
  enabled: z.boolean().default(GATE_FILTER_DEFAULTS.enabled),
  log_rejected: z.boolean().default(GATE_FILTER_DEFAULTS.log_rejected),
  strict_mode: z.boolean().default(GATE_FILTER_DEFAULTS.strict_mode),
  min_words_for_filler_check: z.number().min(1).max(20).default(GATE_FILTER_DEFAULTS.min_words_for_filler_check),
  default_language: z.string().default(GATE_FILTER_DEFAULTS.default_language),
});

/**
 * Information about why content bypassed the Gate Filter.
 */
export interface GateFilterBypass {
  /** Source type that triggered bypass */
  source: BypassSource;

  /** Human-readable reason */
  reason: string;
}

/**
 * Zod schema for GateFilterBypass.
 */
export const GateFilterBypassSchema = z.object({
  source: z.enum(BYPASS_SOURCES),
  reason: z.string(),
});

/**
 * Record of a cleanup transformation applied to content.
 */
export interface Transformation {
  /** Type of transformation */
  type: TransformationType;

  /** Content before transformation */
  before: string;

  /** Content after transformation */
  after: string;
}

/**
 * Zod schema for Transformation.
 */
export const TransformationSchema = z.object({
  type: z.enum(TRANSFORMATION_TYPES),
  before: z.string(),
  after: z.string(),
});

/**
 * Result of Gate Filter processing.
 */
export interface GateFilterResult {
  /** The decision: BYPASS, PASS, REJECT, or PROMPT */
  decision: GateDecision;

  /** Confidence level (0-1) for this decision */
  confidence: number;

  /** Reasons that contributed to this decision */
  reasons: GateReason[];

  /** Cleanup transformations applied (only for PASS) */
  transformations?: Transformation[];

  /** Bypass information (only if decision is BYPASS) */
  bypass?: GateFilterBypass;

  /** Processing time in milliseconds */
  latency_ms: number;
}

/**
 * Zod schema for GateFilterResult.
 */
export const GateFilterResultSchema = z.object({
  decision: z.enum(GATE_DECISIONS),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.enum(GATE_REASONS)),
  transformations: z.array(TransformationSchema).optional(),
  bypass: GateFilterBypassSchema.optional(),
  latency_ms: z.number().min(0),
});

/**
 * Minimal input envelope for Gate Filter.
 * Full InputEnvelope is defined in storm-014.
 * This includes context for audit logging.
 */
export interface GateFilterInputEnvelope {
  /** Input source for bypass detection */
  source: 'chat' | 'file' | 'voice' | 'api' | 'stream';

  /** Normalized content */
  normalized: {
    /** Text content to filter */
    text: string;
  };

  /** Optional metadata */
  metadata?: {
    /** Language code (e.g., 'en', 'es') */
    language?: string;

    /** Whether voice was processed by Whisper */
    whisperProcessed?: boolean;

    /** Whether this is a manually created note */
    isManualNote?: boolean;
  };

  /** API options */
  options?: {
    /** Force save regardless of filter result */
    forceSave?: boolean;
  };

  /** Context for audit logging */
  context: {
    /** User ID */
    userId: string;
    /** Session ID */
    sessionId: string;
  };
}

/**
 * Zod schema for GateFilterInputEnvelope.
 */
export const GateFilterInputEnvelopeSchema = z.object({
  source: z.enum(['chat', 'file', 'voice', 'api', 'stream']),
  normalized: z.object({
    text: z.string(),
  }),
  metadata: z
    .object({
      language: z.string().optional(),
      whisperProcessed: z.boolean().optional(),
      isManualNote: z.boolean().optional(),
    })
    .optional(),
  options: z
    .object({
      forceSave: z.boolean().optional(),
    })
    .optional(),
  context: z.object({
    userId: z.string(),
    sessionId: z.string(),
  }),
});

/**
 * Metrics for Gate Filter observability and tuning.
 */
export interface GateFilterMetrics {
  /** Total inputs processed */
  total_processed: number;

  /** Count of BYPASS decisions */
  bypass_count: number;

  /** Count of PASS decisions */
  pass_count: number;

  /** Count of REJECT decisions */
  reject_count: number;

  /** Count of PROMPT decisions */
  prompt_count: number;

  /** Rolling average latency in ms */
  avg_latency_ms: number;

  /** Rejection counts by reason */
  rejection_by_reason: Partial<Record<GateReason, number>>;

  /** User-reported false positives */
  false_positive_reports: number;
}

/**
 * Zod schema for GateFilterMetrics.
 */
export const GateFilterMetricsSchema = z.object({
  total_processed: z.number().min(0),
  bypass_count: z.number().min(0),
  pass_count: z.number().min(0),
  reject_count: z.number().min(0),
  prompt_count: z.number().min(0),
  avg_latency_ms: z.number().min(0),
  rejection_by_reason: z.record(z.string(), z.number()),
  false_positive_reports: z.number().min(0),
});

/**
 * Audit log entry for rejected/prompted content.
 * Content is hashed for privacy.
 */
export interface RejectionLog {
  /** Timestamp of rejection */
  timestamp: Date;

  /** User ID */
  userId: string;

  /** Session ID */
  sessionId: string;

  /** Hash of input content (not raw content for privacy) */
  input_hash: string;

  /** Length of original input */
  input_length: number;

  /** Decision made */
  decision: GateDecision;

  /** Reasons for decision */
  reasons: GateReason[];

  /** Confidence level */
  confidence: number;

  /** Processing latency */
  latency_ms: number;
}

/**
 * Zod schema for RejectionLog.
 */
export const RejectionLogSchema = z.object({
  timestamp: z.date(),
  userId: z.string(),
  sessionId: z.string(),
  input_hash: z.string(),
  input_length: z.number().min(0),
  decision: z.enum(GATE_DECISIONS),
  reasons: z.array(z.enum(GATE_REASONS)),
  confidence: z.number().min(0).max(1),
  latency_ms: z.number().min(0),
});

/**
 * Context flags passed to storm-011 extraction from Gate Filter.
 * Part of ExtractionContext interface.
 */
export interface GateFilterExtractionContext {
  /** Whether content passed Gate Filter (vs bypassed) */
  gateFilterPassed: boolean;

  /** Whether cleanup transformations were applied */
  gateCleanupApplied: boolean;

  /** Bypass reason if bypassed */
  gateBypassReason?: string;

  /** Whether user confirmed after PROMPT decision */
  userConfirmedFromPrompt?: boolean;
}

/**
 * Zod schema for GateFilterExtractionContext.
 */
export const GateFilterExtractionContextSchema = z.object({
  gateFilterPassed: z.boolean(),
  gateCleanupApplied: z.boolean(),
  gateBypassReason: z.string().optional(),
  userConfirmedFromPrompt: z.boolean().optional(),
});

// ============================================================
// MAIN GATE FILTER FUNCTION
// ============================================================

/**
 * Main Gate Filter function.
 * Processes input envelope and returns decision with confidence and reasons.
 *
 * @param envelope - The input envelope to filter
 * @param config - Optional configuration (uses defaults if not provided)
 * @returns GateFilterResult with decision, confidence, reasons
 *
 * @example
 * ```typescript
 * const result = gateFilter({
 *   source: 'chat',
 *   normalized: { text: 'Remember my meeting at 3pm' },
 *   context: { userId: 'user-1', sessionId: 'session-1' },
 * });
 * // result.decision === 'PASS'
 * ```
 */
export function gateFilter(
  envelope: GateFilterInputEnvelope,
  config: GateFilterConfig = GATE_FILTER_DEFAULTS as GateFilterConfig
): GateFilterResult {
  const startTime = Date.now();
  const text = envelope.normalized.text;
  const lang = envelope.metadata?.language || config.default_language;

  // ═══════════════════════════════════════════════════════════
  // STEP 0: CHECK BYPASS CONDITIONS (B-001 to B-004)
  // ═══════════════════════════════════════════════════════════
  const bypass = shouldBypass(envelope);
  if (bypass) {
    return {
      decision: 'BYPASS',
      confidence: 1.0,
      reasons: [],
      bypass,
      latency_ms: Date.now() - startTime,
    };
  }

  const normalized = normalizeWhitespace(text);
  const reasons: GateReason[] = [];
  let confidence = 0;

  // ═══════════════════════════════════════════════════════════
  // TIER 1: INSTANT REJECT (confidence: 0.96-1.0)
  // ═══════════════════════════════════════════════════════════

  // Rule R-001: Too short to be meaningful
  if (normalized.length < GATE_MIN_CONTENT_LENGTH) {
    return finalize('REJECT', RULE_CONFIDENCES['R-001_too_short'], ['too_short'], startTime);
  }

  // Rule R-002: Gibberish detection (high entropy, no words)
  if (isGibberish(normalized)) {
    return finalize('REJECT', RULE_CONFIDENCES['R-002_gibberish'], ['gibberish'], startTime);
  }

  // Rule R-003: Spam patterns (known spam signatures)
  if (matchesSpamPattern(normalized)) {
    return finalize('REJECT', RULE_CONFIDENCES['R-003_spam_pattern'], ['spam_pattern'], startTime);
  }

  // Rule R-004: Repeated characters (>10 of same char)
  if (REPEATED_CHARS_PATTERN.test(normalized)) {
    return finalize('REJECT', RULE_CONFIDENCES['R-004_repeated_chars'], ['repeated_chars'], startTime);
  }

  // ═══════════════════════════════════════════════════════════
  // TIER 1.5: PURE FILLER (confidence: 0.96)
  // ═══════════════════════════════════════════════════════════

  // Rule R-005: Pure filler (>90% filler words, 5+ words only)
  const words = normalized.toLowerCase().split(/\s+/);
  if (words.length >= config.min_words_for_filler_check) {
    const fillerScore = getFillerScore(words);
    if (fillerScore > FILLER_SCORE_THRESHOLD) {
      return finalize('REJECT', RULE_CONFIDENCES['R-005_pure_filler'], ['pure_filler'], startTime);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TIER 2: LIKELY REJECT (confidence: 0.85-0.95)
  // ═══════════════════════════════════════════════════════════

  // Rule R-006: Empty semantic content (only punctuation/emoji)
  if (isEmptySemantic(normalized)) {
    reasons.push('empty_semantic');
    confidence = Math.max(confidence, RULE_CONFIDENCES['R-006_empty_semantic']);
  }

  // Rule R-007: All caps (likely noise/shouting)
  if (isAllCaps(normalized)) {
    reasons.push('all_caps');
    confidence = Math.max(confidence, RULE_CONFIDENCES['R-007_all_caps']);
  }

  // ═══════════════════════════════════════════════════════════
  // TIER 3: PROMPT USER (confidence: 0.50-0.85)
  // ═══════════════════════════════════════════════════════════

  // Rule R-008: Social-only content (greetings, thanks, apologies)
  if (isSocialOnly(normalized, lang)) {
    reasons.push('social_only');
    confidence = Math.max(confidence, RULE_CONFIDENCES['R-008_social_only']);
  }

  // ═══════════════════════════════════════════════════════════
  // DECISION LOGIC
  // ═══════════════════════════════════════════════════════════

  let decision: GateDecision;
  if (confidence >= config.reject_confidence) {
    decision = 'REJECT';
  } else if (confidence >= config.prompt_confidence) {
    decision = 'PROMPT';
  } else {
    decision = 'PASS';
    if (reasons.length === 0) {
      reasons.push('uncertain');
    }
  }

  // Apply transformations for PASS content
  let transformations: Transformation[] = [];
  if (decision === 'PASS') {
    transformations = applyCleanup(normalized);
  }

  return {
    decision,
    confidence,
    reasons,
    transformations: transformations.length > 0 ? transformations : undefined,
    latency_ms: Date.now() - startTime,
  };
}

/**
 * Helper to finalize early returns.
 */
function finalize(
  decision: GateDecision,
  confidence: number,
  reasons: GateReason[],
  startTime: number
): GateFilterResult {
  return {
    decision,
    confidence,
    reasons,
    latency_ms: Date.now() - startTime,
  };
}

// ============================================================
// BYPASS DETECTION (B-001 to B-004)
// ============================================================

/**
 * Check if input should bypass Gate Filter entirely.
 *
 * @param envelope - The input envelope to check
 * @returns Bypass info if should bypass, null otherwise
 */
export function shouldBypass(envelope: GateFilterInputEnvelope): GateFilterBypass | null {
  // B-001: API force save override
  if (envelope.source === 'api' && envelope.options?.forceSave) {
    return { source: 'api_force', reason: 'Developer override' };
  }

  // B-002: File uploads (user committed to upload)
  if (envelope.source === 'file') {
    return { source: 'file_upload', reason: 'User committed to upload' };
  }

  // B-003: Voice transcripts (already cleaned by Whisper)
  if (envelope.source === 'voice' && envelope.metadata?.whisperProcessed) {
    return { source: 'voice_transcript', reason: 'Already cleaned by Whisper' };
  }

  // B-004: Manual notes (explicit user creation intent)
  if (envelope.metadata?.isManualNote) {
    return { source: 'manual_note', reason: 'Explicit user creation' };
  }

  return null;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Normalize whitespace in text.
 *
 * @param text - Input text
 * @returns Text with normalized whitespace
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Check if text is gibberish (R-002).
 * High entropy + low real word ratio = gibberish.
 *
 * @param text - Input text
 * @returns true if text appears to be gibberish
 */
export function isGibberish(text: string): boolean {
  const entropy = calculateEntropy(text);
  const words = text.split(/\s+/);
  const realWordCount = countRealWords(text);
  const wordRatio = realWordCount / Math.max(1, words.length);

  return entropy > GIBBERISH_ENTROPY_THRESHOLD && wordRatio < GIBBERISH_WORD_RATIO_THRESHOLD;
}

/**
 * Calculate Shannon entropy of text.
 * Higher entropy = more random/uniform character distribution.
 *
 * @param text - Input text
 * @returns Entropy value (bits per character)
 */
export function calculateEntropy(text: string): number {
  if (text.length === 0) return 0;

  const freq: Record<string, number> = {};
  for (const char of text) {
    freq[char] = (freq[char] || 0) + 1;
  }

  const len = text.length;
  return Object.values(freq).reduce((sum, f) => {
    const p = f / len;
    return sum - p * Math.log2(p);
  }, 0);
}

/**
 * Count real words in text.
 *
 * @param text - Input text
 * @returns Count of real/common words
 */
export function countRealWords(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  return words.filter((w) => COMMON_WORDS.has(w) || w.length > 2).length;
}

/**
 * Check if text matches known spam patterns (R-003).
 *
 * @param text - Input text
 * @returns true if text matches spam pattern
 */
export function matchesSpamPattern(text: string): boolean {
  return SPAM_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Calculate filler word score (R-005).
 *
 * @param words - Pre-split words array (lowercase)
 * @returns Ratio of filler words (0-1)
 */
export function getFillerScore(words: string[]): number {
  if (words.length === 0) return 0;
  const fillerCount = words.filter((w) => FILLER_WORDS.has(w)).length;
  return fillerCount / words.length;
}

/**
 * Check if text has empty semantic content (R-006).
 * Only emoji, punctuation, whitespace = empty.
 *
 * @param text - Input text
 * @returns true if semantically empty
 */
export function isEmptySemantic(text: string): boolean {
  // Remove emojis, punctuation, whitespace
  const semantic = text.replace(/[\p{Emoji}\s\p{P}]/gu, '');
  return semantic.length < 2;
}

/**
 * Check if text is all caps (R-007).
 *
 * @param text - Input text
 * @returns true if all uppercase and meets length requirements
 */
export function isAllCaps(text: string): boolean {
  if (text.length <= ALL_CAPS_MIN_LENGTH) return false;

  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < ALL_CAPS_MIN_LETTERS) return false;

  return letters === letters.toUpperCase();
}

/**
 * Check if text is social-only content (R-008).
 * Matches greetings, thanks, apologies in multiple languages.
 *
 * @param text - Input text
 * @param lang - Language code (default: 'en')
 * @returns true if text is only social pleasantry
 */
export function isSocialOnly(text: string, lang: string = 'en'): boolean {
  const patterns = SOCIAL_PATTERNS_BY_LANG[lang] ?? SOCIAL_PATTERNS_BY_LANG['en'];
  if (!patterns) return false;
  return patterns.some((pattern) => pattern.test(text.trim()));
}

// ============================================================
// CLEANUP TRANSFORMATIONS
// ============================================================

/**
 * Apply cleanup transformations to PASS content.
 *
 * @param text - Input text (already normalized)
 * @returns Array of transformations applied
 */
export function applyCleanup(text: string): Transformation[] {
  const transformations: Transformation[] = [];
  let current = text;

  // T-001: Normalize whitespace (already done, but record if different from original)
  const normalized = current.replace(/\s+/g, ' ').trim();
  if (normalized !== current) {
    transformations.push({
      type: 'normalize_whitespace',
      before: current,
      after: normalized,
    });
    current = normalized;
  }

  // T-002: Collapse repeated punctuation (more than 2)
  const collapsed = current.replace(/([!?.]){3,}/g, '$1$1');
  if (collapsed !== current) {
    transformations.push({
      type: 'collapse_repeats',
      before: current,
      after: collapsed,
    });
  }

  // NOTE: Filler word stripping happens later in P-003 extraction
  // Gate Filter only does structural cleanup

  return transformations;
}

// ============================================================
// METRICS
// ============================================================

/**
 * Create initial/default metrics object.
 *
 * @returns Fresh GateFilterMetrics with zero values
 */
export function createDefaultMetrics(): GateFilterMetrics {
  return {
    total_processed: 0,
    bypass_count: 0,
    pass_count: 0,
    reject_count: 0,
    prompt_count: 0,
    avg_latency_ms: 0,
    rejection_by_reason: {},
    false_positive_reports: 0,
  };
}

/**
 * Update metrics with a gate filter result.
 * Mutates the metrics object in place.
 *
 * @param metrics - Metrics object to update (mutated)
 * @param result - Gate filter result
 */
export function updateMetrics(
  metrics: GateFilterMetrics,
  result: GateFilterResult
): void {
  metrics.total_processed++;

  // Increment decision count
  switch (result.decision) {
    case 'BYPASS':
      metrics.bypass_count++;
      break;
    case 'PASS':
      metrics.pass_count++;
      break;
    case 'REJECT':
      metrics.reject_count++;
      break;
    case 'PROMPT':
      metrics.prompt_count++;
      break;
  }

  // Update rolling average latency
  metrics.avg_latency_ms =
    (metrics.avg_latency_ms * (metrics.total_processed - 1) + result.latency_ms) /
    metrics.total_processed;

  // Track rejection reasons
  for (const reason of result.reasons) {
    metrics.rejection_by_reason[reason] =
      (metrics.rejection_by_reason[reason] || 0) + 1;
  }
}

/**
 * Report a false positive.
 * Mutates the metrics object in place.
 *
 * @param metrics - Metrics object to update (mutated)
 */
export function reportFalsePositive(metrics: GateFilterMetrics): void {
  metrics.false_positive_reports++;
}

// ============================================================
// AUDIT LOGGING
// ============================================================

/**
 * Create a rejection log entry.
 *
 * @param envelope - Input envelope (contains context)
 * @param result - Gate filter result
 * @param hashFn - Hash function (for privacy)
 * @returns RejectionLog entry
 */
export function createRejectionLog(
  envelope: GateFilterInputEnvelope,
  result: GateFilterResult,
  hashFn: (text: string) => string
): RejectionLog {
  return {
    timestamp: new Date(),
    userId: envelope.context.userId,
    sessionId: envelope.context.sessionId,
    input_hash: hashFn(envelope.normalized.text),
    input_length: envelope.normalized.text.length,
    decision: result.decision,
    reasons: result.reasons,
    confidence: result.confidence,
    latency_ms: result.latency_ms,
  };
}
