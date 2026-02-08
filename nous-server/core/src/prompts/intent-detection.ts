/**
 * @module @nous/core/prompts
 * @description Intent Detection Specification (IDS) v1.0
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-027
 * @storm Brainstorms/Infrastructure/storm-027-prompt-engineering
 *
 * Defines the complete intent detection system:
 * - 10 intent types (extended from 7 in v2)
 * - Fast-path keyword detection (latency optimization)
 * - Per-intent confidence thresholds
 * - Ambiguity handling strategies
 * - Multi-intent pattern detection
 * - Intent-to-action routing table
 *
 * @see {@link Brainstorms/Infrastructure/storm-027-prompt-engineering/cycles/cycle-2/revision} - IDS v1.0 source
 */

import { z } from 'zod';

// ============================================================
// INTENT TYPES (10 intents)
// ============================================================

/**
 * All intent types in the Nous system.
 *
 * Core intents (from P-002 v1.1):
 * - store, retrieve, update, delete, search, chat, command
 *
 * Extended intents (v2):
 * - organize, summarize, compare, clarify
 *
 * NOTE: 'summarize' and 'compare' are modes of 'retrieve'.
 * When detected, the system sets intent='retrieve' with
 * retrievalMode='summarize'|'compare'.
 *
 * @see storm-027 v2 IDS - Intent Taxonomy
 */
export const NPL_INTENT_TYPES = [
  'store',
  'retrieve',
  'update',
  'delete',
  'search',
  'chat',
  'command',
  'organize',
  'summarize',
  'compare',
  'clarify',
] as const;

export type NplIntentType = (typeof NPL_INTENT_TYPES)[number];

export const NplIntentTypeSchema = z.enum(NPL_INTENT_TYPES);

// ============================================================
// INTENT RESULT
// ============================================================

/**
 * Result from intent detection (fast-path or LLM).
 *
 * @see storm-027 v2 IDS - IntentResult
 */
export interface NplIntentResult {
  /** Primary detected intent */
  primary: NplIntentType;
  /** Secondary intent (for multi-intent queries) */
  secondary: NplIntentType | null;
  /** Retrieval mode (summarize/compare are modes of retrieve) */
  mode: 'direct' | 'summarize' | 'compare' | null;
  /** Confidence in primary intent (0-1) */
  confidence: number;
}

export const NplIntentResultSchema = z.object({
  primary: NplIntentTypeSchema,
  secondary: NplIntentTypeSchema.nullable(),
  mode: z.enum(['direct', 'summarize', 'compare']).nullable(),
  confidence: z.number().min(0).max(1),
});

// ============================================================
// FAST-PATH RULES
// ============================================================

/**
 * Fast-path rule for keyword-based intent detection.
 * Detects high-confidence intents from keywords BEFORE making an LLM call.
 *
 * @see storm-027 v2 IDS - Layer 1: Fast-Path Keywords
 */
export interface NplFastPathRule {
  /** Intent to detect */
  intent: NplIntentType;
  /** Trigger phrases (case-insensitive substring match) */
  triggers: string[];
  /** Minimum confidence to assign */
  minConfidence: number;
  /** When to skip fast-path and fall through to LLM */
  bypassCondition: string;
}

export const NplFastPathRuleSchema = z.object({
  intent: NplIntentTypeSchema,
  triggers: z.array(z.string().min(1)).min(1),
  minConfidence: z.number().min(0).max(1),
  bypassCondition: z.string(),
});

/**
 * Fast-path detection rules.
 * 6 rules covering the highest-confidence keyword patterns.
 *
 * @see storm-027 v2 IDS - FAST_PATH_RULES
 */
export const NPL_FAST_PATH_RULES: NplFastPathRule[] = [
  {
    intent: 'store',
    triggers: ['remember that', 'save this', 'note that', 'keep track of', 'store this'],
    minConfidence: 0.85,
    bypassCondition: 'Contains "don\'t" or "did I" (negation or retrieval marker)',
  },
  {
    intent: 'delete',
    triggers: ['delete', 'remove', 'forget about', 'get rid of'],
    minConfidence: 0.80,
    bypassCondition: 'Contains "what did I delete" (retrieval about deletion)',
  },
  {
    intent: 'summarize',
    triggers: ['summarize', 'summary of', 'tldr', 'give me the gist'],
    minConfidence: 0.85,
    bypassCondition: 'Contains "save" or "remember" (store + summarize)',
  },
  {
    intent: 'compare',
    triggers: ['compare', 'difference between', 'how has X changed', 'versus', 'vs'],
    minConfidence: 0.85,
    bypassCondition: 'Fewer than 2 entities detected',
  },
  {
    intent: 'organize',
    triggers: ['move to', 'link these', 'tag as', 'group', 'cluster'],
    minConfidence: 0.80,
    bypassCondition: 'No node references in context',
  },
  {
    intent: 'chat',
    triggers: ['hi', 'hello', 'thanks', 'bye', 'how are you'],
    minConfidence: 0.95,
    bypassCondition: 'Message longer than 50 characters',
  },
] as const;

// ============================================================
// CONFIDENCE THRESHOLDS PER INTENT
// ============================================================

/**
 * Confidence threshold levels for an intent.
 */
export interface NplIntentConfidenceThresholds {
  /** Auto-execute without confirmation */
  high: number;
  /** Execute with soft confirmation */
  medium: number;
  /** Require clarification */
  low: number;
}

export const NplIntentConfidenceThresholdsSchema = z.object({
  high: z.number().min(0).max(1),
  medium: z.number().min(0).max(1),
  low: z.number().min(0).max(1),
});

/**
 * Per-intent confidence thresholds.
 * Different intents have inherently different detection difficulty.
 *
 * Design rationale:
 * - `retrieve` has lowest thresholds (safer to search than miss)
 * - `delete` has highest thresholds (destructive, need high confidence)
 * - `chat` has high thresholds (wrong chat response is annoying)
 *
 * @see storm-027 v2 IDS - Confidence Thresholds
 */
export const NPL_INTENT_CONFIDENCE_THRESHOLDS: Record<NplIntentType, NplIntentConfidenceThresholds> = {
  store: { high: 0.85, medium: 0.70, low: 0.50 },
  retrieve: { high: 0.75, medium: 0.60, low: 0.40 },
  search: { high: 0.70, medium: 0.55, low: 0.40 },
  chat: { high: 0.90, medium: 0.75, low: 0.60 },
  update: { high: 0.85, medium: 0.70, low: 0.50 },
  delete: { high: 0.90, medium: 0.80, low: 0.65 },
  command: { high: 0.85, medium: 0.70, low: 0.55 },
  organize: { high: 0.80, medium: 0.65, low: 0.50 },
  summarize: { high: 0.80, medium: 0.65, low: 0.50 },
  compare: { high: 0.80, medium: 0.65, low: 0.50 },
  clarify: { high: 0.85, medium: 0.70, low: 0.55 },
} as const;

// ============================================================
// AMBIGUITY HANDLING
// ============================================================

/**
 * Strategy for handling ambiguous intent detection.
 */
export interface NplClarificationStrategy {
  /** Which confidence level triggers this strategy */
  confidenceLevel: 'low' | 'insufficient';
  /** How to handle the ambiguity */
  strategy: 'ask_clarification' | 'assume_safe_default' | 'show_options';
}

export const NplClarificationStrategySchema = z.object({
  confidenceLevel: z.enum(['low', 'insufficient']),
  strategy: z.enum(['ask_clarification', 'assume_safe_default', 'show_options']),
});

/**
 * Ambiguity handling strategies per intent.
 *
 * Design rationale:
 * - `store`/`retrieve` default to safe action (store/search anyway)
 * - `delete`/`update` always require clarification (destructive)
 * - `organize` shows options at low confidence, asks at insufficient
 *
 * @see storm-027 v2 IDS - Ambiguous Intent Handling
 */
export const NPL_AMBIGUITY_HANDLERS: Record<NplIntentType, NplClarificationStrategy[]> = {
  store: [
    { confidenceLevel: 'low', strategy: 'assume_safe_default' },
    { confidenceLevel: 'insufficient', strategy: 'ask_clarification' },
  ],
  retrieve: [
    { confidenceLevel: 'low', strategy: 'assume_safe_default' },
    { confidenceLevel: 'insufficient', strategy: 'show_options' },
  ],
  search: [
    { confidenceLevel: 'low', strategy: 'assume_safe_default' },
    { confidenceLevel: 'insufficient', strategy: 'show_options' },
  ],
  chat: [
    { confidenceLevel: 'low', strategy: 'assume_safe_default' },
    { confidenceLevel: 'insufficient', strategy: 'assume_safe_default' },
  ],
  update: [
    { confidenceLevel: 'low', strategy: 'show_options' },
    { confidenceLevel: 'insufficient', strategy: 'ask_clarification' },
  ],
  delete: [
    { confidenceLevel: 'low', strategy: 'ask_clarification' },
    { confidenceLevel: 'insufficient', strategy: 'ask_clarification' },
  ],
  command: [
    { confidenceLevel: 'low', strategy: 'show_options' },
    { confidenceLevel: 'insufficient', strategy: 'ask_clarification' },
  ],
  organize: [
    { confidenceLevel: 'low', strategy: 'show_options' },
    { confidenceLevel: 'insufficient', strategy: 'ask_clarification' },
  ],
  summarize: [
    { confidenceLevel: 'low', strategy: 'assume_safe_default' },
    { confidenceLevel: 'insufficient', strategy: 'show_options' },
  ],
  compare: [
    { confidenceLevel: 'low', strategy: 'assume_safe_default' },
    { confidenceLevel: 'insufficient', strategy: 'show_options' },
  ],
  clarify: [
    { confidenceLevel: 'low', strategy: 'assume_safe_default' },
    { confidenceLevel: 'insufficient', strategy: 'ask_clarification' },
  ],
} as const;

// ============================================================
// MULTI-INTENT PATTERNS
// ============================================================

/**
 * Multi-intent pattern for compound queries.
 */
export interface NplMultiIntentPattern {
  /** Pattern name (e.g., 'store + retrieve') */
  pattern: string;
  /** Example query */
  example: string;
  /** How intents should be executed */
  precedence: 'sequential' | 'parallel' | 'conditional';
  /** Order of execution */
  executionOrder: NplIntentType[];
  /** Why this order */
  reasoning: string;
}

export const NplMultiIntentPatternSchema = z.object({
  pattern: z.string(),
  example: z.string(),
  precedence: z.enum(['sequential', 'parallel', 'conditional']),
  executionOrder: z.array(NplIntentTypeSchema).min(2),
  reasoning: z.string(),
});

/**
 * Common multi-intent patterns.
 * 5 patterns covering the most frequent compound queries.
 *
 * @see storm-027 v2 IDS - Multi-Intent Detection
 */
export const NPL_MULTI_INTENT_PATTERNS: NplMultiIntentPattern[] = [
  {
    pattern: 'store + retrieve',
    example: 'Remember this article and show me what else I have about AI',
    precedence: 'sequential',
    executionOrder: ['store', 'retrieve'],
    reasoning: 'Store first so retrieve includes new content',
  },
  {
    pattern: 'retrieve + summarize',
    example: 'What do I know about Project X? Give me a summary.',
    precedence: 'sequential',
    executionOrder: ['retrieve', 'summarize'],
    reasoning: 'Retrieve is implicit, summarize is the output mode',
  },
  {
    pattern: 'delete + retrieve',
    example: "Delete the old notes and show me what's left",
    precedence: 'sequential',
    executionOrder: ['delete', 'retrieve'],
    reasoning: 'Delete first, then show updated state',
  },
  {
    pattern: 'compare + store',
    example: 'Compare these two approaches and save my preference',
    precedence: 'conditional',
    executionOrder: ['compare', 'store'],
    reasoning: 'Compare first, store only if user confirms preference',
  },
  {
    pattern: 'organize + retrieve',
    example: 'Move these notes to Work and show me the Work cluster',
    precedence: 'sequential',
    executionOrder: ['organize', 'retrieve'],
    reasoning: 'Organize first, then show result',
  },
] as const;

// ============================================================
// ACTION ROUTING TABLE
// ============================================================

/**
 * Action route for an intent.
 */
export interface NplActionRoute {
  /** Intent */
  intent: NplIntentType;
  /** Primary action to take */
  primaryAction: string;
  /** When to require user confirmation */
  requiresConfirmation: string;
  /** Fallback action on failure */
  fallbackAction: string;
  /** Error handling strategy */
  errorHandling: string;
}

export const NplActionRouteSchema = z.object({
  intent: NplIntentTypeSchema,
  primaryAction: z.string(),
  requiresConfirmation: z.string(),
  fallbackAction: z.string(),
  errorHandling: z.string(),
});

/**
 * Intent-to-action routing table.
 * Maps each intent to its primary action, confirmation requirements, and error handling.
 *
 * @see storm-027 v2 IDS - Intent to Action Mapping
 */
export const NPL_ACTION_ROUTES: NplActionRoute[] = [
  {
    intent: 'store',
    primaryAction: 'create_node()',
    requiresConfirmation: 'on_duplicate',
    fallbackAction: 'ask_clarification',
    errorHandling: 'Retry with simpler extraction',
  },
  {
    intent: 'retrieve',
    primaryAction: 'search() → synthesize()',
    requiresConfirmation: 'never',
    fallbackAction: 'suggest_related',
    errorHandling: "I couldn't find anything about X",
  },
  {
    intent: 'search',
    primaryAction: 'browse() → list_results()',
    requiresConfirmation: 'never',
    fallbackAction: 'broaden_scope',
    errorHandling: 'Show empty state with suggestions',
  },
  {
    intent: 'chat',
    primaryAction: 'respond_directly()',
    requiresConfirmation: 'never',
    fallbackAction: 'N/A',
    errorHandling: 'Standard error response',
  },
  {
    intent: 'update',
    primaryAction: 'find_node() → update_node()',
    requiresConfirmation: 'always_show_diff',
    fallbackAction: 'ask_which_node',
    errorHandling: 'Which note do you want to update?',
  },
  {
    intent: 'delete',
    primaryAction: 'find_node() → delete_node()',
    requiresConfirmation: 'always_explicit',
    fallbackAction: 'show_candidates',
    errorHandling: 'Require explicit confirmation',
  },
  {
    intent: 'command',
    primaryAction: 'parse_command() → execute()',
    requiresConfirmation: 'on_destructive',
    fallbackAction: 'show_help',
    errorHandling: 'Show available commands',
  },
  {
    intent: 'organize',
    primaryAction: 'find_nodes() → move/link/tag()',
    requiresConfirmation: 'show_preview',
    fallbackAction: 'ask_target',
    errorHandling: 'I need to know which cluster/tag',
  },
  {
    intent: 'summarize',
    primaryAction: 'search() → compress()',
    requiresConfirmation: 'never',
    fallbackAction: 'return_individuals',
    errorHandling: 'Not enough to summarize',
  },
  {
    intent: 'compare',
    primaryAction: 'search_both() → diff()',
    requiresConfirmation: 'never',
    fallbackAction: 'return_individuals',
    errorHandling: 'Need at least 2 things to compare',
  },
  {
    intent: 'clarify',
    primaryAction: 'update_context() → retry_last()',
    requiresConfirmation: 'never',
    fallbackAction: 'ask_again',
    errorHandling: 'Re-ask with previous context',
  },
] as const;

// ============================================================
// DETECTION PRIORITY
// ============================================================

/**
 * Intent detection priority order (when uncertain).
 * Higher priority intents are checked first.
 *
 * @see storm-027 v2 IDS - DETECTION PRIORITY
 */
export const NPL_DETECTION_PRIORITY: NplIntentType[] = [
  'clarify',   // 1. If message is very short and follows a clarification request
  'delete',    // 2. If destructive verb present (requires high confidence)
  'update',    // 3. If correction pattern detected
  'store',     // 4. If store verbs or implicit save signals
  'retrieve',  // 5. If question or search pattern
  'chat',      // 6. Default for general messages
] as const;

// ============================================================
// INTENT DEFINITIONS (Human-readable)
// ============================================================

/**
 * Human-readable intent definitions.
 */
export const NPL_INTENT_DEFINITIONS: Record<NplIntentType, string> = {
  store: 'User wants to save new information',
  retrieve: 'User wants to find existing information',
  update: 'User wants to modify existing information',
  delete: 'User wants to remove information',
  search: 'User wants to browse/explore without specific target',
  chat: 'General conversation, not about knowledge management',
  command: 'System action (settings, export, help)',
  organize: 'User wants to restructure (move, link, cluster, tag)',
  summarize: 'User wants condensed view (retrieval mode)',
  compare: 'User wants to see differences (retrieval mode)',
  clarify: 'User is providing additional context for previous query',
} as const;

// ============================================================
// FUNCTION SIGNATURES
// ============================================================

/**
 * Fast-path intent detection from keywords.
 * Detects high-confidence intents WITHOUT making an LLM call.
 *
 * Returns null if no fast-path match (fall through to LLM P-002).
 *
 * @param message - User message text
 * @returns Intent result or null if no match
 *
 * @see storm-027 v2 IDS - Layer 1: Fast-Path Keywords
 */
export function nplFastPathDetect(message: string): NplIntentResult | null {
  const normalized = message.toLowerCase();

  for (const rule of NPL_FAST_PATH_RULES) {
    for (const trigger of rule.triggers) {
      if (normalized.includes(trigger)) {
        // Implementation will check bypass conditions
        // For spec: return the matched intent
        return {
          primary: rule.intent,
          secondary: null,
          mode:
            rule.intent === 'summarize'
              ? 'summarize'
              : rule.intent === 'compare'
                ? 'compare'
                : null,
          confidence: rule.minConfidence,
        };
      }
    }
  }
  return null;
}

/**
 * Get confidence level classification for an intent.
 *
 * @param intent - Intent type
 * @param confidence - Confidence score (0-1)
 * @returns Confidence level: 'high', 'medium', 'low', or 'insufficient'
 *
 * @see storm-027 v2 IDS - Confidence Thresholds
 */
export function nplGetConfidenceLevel(
  intent: NplIntentType,
  confidence: number
): 'high' | 'medium' | 'low' | 'insufficient' {
  const thresholds = NPL_INTENT_CONFIDENCE_THRESHOLDS[intent];
  if (confidence >= thresholds.high) return 'high';
  if (confidence >= thresholds.medium) return 'medium';
  if (confidence >= thresholds.low) return 'low';
  return 'insufficient';
}

/**
 * Get ambiguity handling strategy for an intent at a given confidence level.
 *
 * @param intent - Intent type
 * @param confidenceLevel - Classified confidence level
 * @returns Strategy to handle the ambiguity, or null if confidence is sufficient
 */
export function nplGetAmbiguityStrategy(
  intent: NplIntentType,
  confidenceLevel: 'low' | 'insufficient'
): 'ask_clarification' | 'assume_safe_default' | 'show_options' {
  const handlers = NPL_AMBIGUITY_HANDLERS[intent];
  const handler = handlers.find((h) => h.confidenceLevel === confidenceLevel);
  return handler?.strategy ?? 'ask_clarification';
}

/**
 * Find matching multi-intent pattern.
 *
 * @param primary - Primary intent
 * @param secondary - Secondary intent
 * @returns Matching pattern or undefined
 */
export function nplFindMultiIntentPattern(
  primary: NplIntentType,
  secondary: NplIntentType
): NplMultiIntentPattern | undefined {
  const key = `${primary} + ${secondary}`;
  return NPL_MULTI_INTENT_PATTERNS.find((p) => p.pattern === key);
}

/**
 * Get action route for an intent.
 *
 * @param intent - Intent type
 * @returns Action route configuration
 */
export function nplGetActionRoute(intent: NplIntentType): NplActionRoute | undefined {
  return NPL_ACTION_ROUTES.find((r) => r.intent === intent);
}
