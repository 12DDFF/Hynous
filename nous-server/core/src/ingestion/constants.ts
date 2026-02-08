/**
 * @module @nous/core/ingestion/constants
 * @description All constants, patterns, and configuration for storm-014 Input & Ingestion Pipeline
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-014
 * @storm Brainstorms/Infrastructure/storm-014-input-ingestion
 *
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for Ingestion Pipeline constants.
 */

// ============================================================
// INPUT SOURCES
// ============================================================

export const INPUT_SOURCES = ['chat', 'file', 'voice', 'api', 'stream'] as const;
export type InputSource = (typeof INPUT_SOURCES)[number];

// ============================================================
// INPUT MODES
// ============================================================

export const INPUT_MODES = ['normal', 'incognito'] as const;
export type InputMode = (typeof INPUT_MODES)[number];

// ============================================================
// CLASSIFICATION INTENTS
// ============================================================

export const CLASSIFICATION_INTENTS = [
  'query',
  'content',
  'command',
  'conversation',
  'noise',
] as const;
export type ClassificationIntent = (typeof CLASSIFICATION_INTENTS)[number];

// ============================================================
// SAVE SIGNALS
// ============================================================

export const SAVE_SIGNALS = ['explicit', 'implicit', 'none', 'unclear'] as const;
export type SaveSignal = (typeof SAVE_SIGNALS)[number];

// ============================================================
// CONTENT TYPES
// ============================================================

export const CONTENT_TYPES = ['fact', 'opinion', 'question', 'instruction', 'mixed'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

// ============================================================
// COMPLEXITY LEVELS
// ============================================================

export const COMPLEXITY_LEVELS = ['atomic', 'composite', 'document'] as const;
export type ComplexityLevel = (typeof COMPLEXITY_LEVELS)[number];

// ============================================================
// PIPELINE STAGES
// ============================================================

export const PIPELINE_STAGES = ['RECEIVE', 'CLASSIFY', 'ROUTE', 'PROCESS', 'STAGE', 'COMMIT'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// ============================================================
// PROCESSING ACTIONS
// ============================================================

export const PROCESSING_ACTIONS = [
  'saved',
  'ignored',
  'accumulated',
  'queried',
  'prompted',
  'uncertain',
] as const;
export type ProcessingAction = (typeof PROCESSING_ACTIONS)[number];

// ============================================================
// ACTION VERBS
// ============================================================

export const REVIEW_VERBS = [
  'review', 'check', 'proofread', 'edit', 'look over',
  'revise', 'examine', 'inspect', 'analyze',
] as const;

export const SAVE_VERBS = [
  'save', 'remember', 'keep', 'store', 'note',
  'record', 'memorize', 'dont forget', "don't forget",
] as const;

export const AMBIGUOUS_VERBS = [
  'look at', 'see this', "here's", 'heres', 'check out', 'take a look',
] as const;

export const ACTION_VERB_CATEGORIES = {
  review: REVIEW_VERBS,
  save: SAVE_VERBS,
  ambiguous: AMBIGUOUS_VERBS,
} as const;

export type ActionVerbCategory = keyof typeof ACTION_VERB_CATEGORIES;

// ============================================================
// CONTENT CATEGORIES
// ============================================================

export const CONTENT_CATEGORIES = [
  'identity', 'academic', 'conversation', 'work',
  'temporal', 'document', 'general',
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

// ============================================================
// ADAPTIVE CONFIDENCE THRESHOLDS
// ============================================================

export const ADAPTIVE_THRESHOLDS: Record<ContentCategory, { rule: number; prompt: number }> = {
  identity: { rule: 0.60, prompt: 0.50 },
  academic: { rule: 0.70, prompt: 0.60 },
  conversation: { rule: 0.75, prompt: 0.65 },
  work: { rule: 0.70, prompt: 0.60 },
  temporal: { rule: 0.70, prompt: 0.60 },
  document: { rule: 0.85, prompt: 0.75 },
  general: { rule: 0.75, prompt: 0.65 },
};

// ============================================================
// PROMPT LIMITS
// ============================================================

export const PROMPT_LIMITS = {
  max_per_session: 3,
  min_messages_between: 5,
  dismissals_to_stop: 2,
} as const;

// ============================================================
// CHUNK SIZE LIMITS
// ============================================================

export const CHUNK_LIMITS = {
  target: { min: 500, max: 2000 },
  soft_max: 3000,
  hard_max: 5000,
  overlap_percent: 0.10,
} as const;

export const SUMMARY_LIMITS = {
  document: { min: 300, max: 800 },
  section: { min: 200, max: 500 },
} as const;

// ============================================================
// STREAM PROCESSING
// ============================================================

export const STREAM_CONFIG = {
  buffer_window_ms: 30000,
  silence_trigger_ms: 2000,
  max_accumulation_ms: 300000,
} as const;

// ============================================================
// INGESTION DEFAULTS
// ============================================================

export const INGESTION_DEFAULTS = {
  default_mode: 'normal' as InputMode,
  gate_filter_enabled: true,
  user_learning_enabled: true,
  default_content_category: 'general' as ContentCategory,
  thought_path_enabled: true,
  intra_batch_dedupe: true,
  dedupe_similarity: 0.90,
  default_language: 'en',
} as const;

// ============================================================
// FAST RULE PATTERNS
// ============================================================

export const FAST_RULE_PATTERNS = {
  question: [
    /^(what|who|where|when|why|how|which|whose|whom)\s/i,
    /\?\s*$/,
    /^(is|are|was|were|do|does|did|can|could|will|would|should)\s/i,
  ],
  explicit_save: [
    /\b(save|remember|keep|store|note|record|memorize)\s+(this|that|it)\b/i,
    /\bdon'?t forget\b/i,
    /\bremember\s+that\b/i,
  ],
  social: [
    /^(hi|hello|hey|yo|sup|thanks|thank you|sorry|bye|goodbye)[\s!?.]*$/i,
    /^(ok|okay|sure|yep|yeah|yes|no|nope|got it|understood)[\s!?.]*$/i,
    /^(good morning|good night|gm|gn|how are you)[\s!?.]*$/i,
  ],
  command: [
    /^(search|find|show|list|delete|remove|clear|reset|undo)\s/i,
    /^(create|make|add|new)\s+(a\s+)?(node|note|document)\b/i,
  ],
};

// ============================================================
// HANDLER TYPES
// ============================================================

export const HANDLER_TYPES = [
  'QueryHandler',
  'DirectSaveHandler',
  'AccumulatorHandler',
  'PromptHandler',
  'CommandHandler',
  'ResponseHandler',
  'IgnoreHandler',
] as const;
export type HandlerType = (typeof HANDLER_TYPES)[number];

// ============================================================
// WORKING MEMORY DURATIONS (from storm-035)
// ============================================================

export const WORKING_MEMORY_DURATIONS: Record<ContentCategory, number> = {
  identity: 48,
  academic: 24,
  conversation: 6,
  work: 24,
  temporal: 12,
  document: 48,
  general: 24,
};
