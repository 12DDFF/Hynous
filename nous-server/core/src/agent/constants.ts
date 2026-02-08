/**
 * @module @nous/core/agent
 * @description All constants, enums, mappings, and configuration defaults for NEAS (Nous Embedded Agent System)
 * @version 1.0.0
 * @spec Specs/Phase-9-Agent-Tools/storm-019
 * @storm Brainstorms/Infrastructure/storm-019-embedded-ai-agent
 *
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for storm-019 constants.
 * Uses NEAS_ prefix on all constants to avoid naming conflicts with ATSS.
 */

import { z } from 'zod';
import {
  type AtssToolName,
  ATSS_TOOL_NAMES,
  ATSS_TOOL_TO_CATEGORY,
  ATSS_TOOL_CONFIRMATION,
  type AtssConfirmationLevel,
} from '../agent-tools/constants';

// ============================================================
// SESSION ID CONFIGURATION
// ============================================================

/**
 * Prefix for agent session IDs.
 * Full format: "ses_" + nanoid(12)
 * Example: "ses_a7f3c2x9k4m1"
 *
 * @see storm-011 - ID prefix pattern (lowercase prefix + underscore + nanoid)
 */
export const NEAS_SESSION_ID_PREFIX = 'ses_';

// ============================================================
// ERROR TYPES
// ============================================================

/**
 * High-level agent error type classifications.
 * These map to groups of ATSS error codes (E4xx/E5xx).
 *
 * - NOT_FOUND: Target node/edge/cluster doesn't exist
 * - PERMISSION_DENIED: Insufficient credits, tier restriction, or denied confirmation
 * - LIMIT_EXCEEDED: Too many items or rate limit hit
 * - INVALID_INPUT: Bad parameters, content too long, etc.
 * - CONFLICT: Duplicate edge, undo expired, state conflict
 * - NETWORK: LLM unavailable, timeout, circuit breaker, internal error
 */
export const NEAS_ERROR_TYPES = [
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'LIMIT_EXCEEDED',
  'INVALID_INPUT',
  'CONFLICT',
  'NETWORK',
] as const;

export type NeasErrorType = (typeof NEAS_ERROR_TYPES)[number];
export const NeasErrorTypeSchema = z.enum(NEAS_ERROR_TYPES);

// ============================================================
// ATSS ERROR CODE → NEAS ERROR TYPE MAPPING
// ============================================================

/**
 * Exhaustive mapping of all 26 ATSS error codes to 6 NEAS error types.
 *
 * This enables the agent to classify tool-level errors into high-level
 * categories, each with a distinct fix strategy.
 */
export const NEAS_ATSS_ERROR_MAPPING: Record<string, NeasErrorType> = {
  // 400 - Bad Request → mostly INVALID_INPUT, some LIMIT_EXCEEDED
  E400_INVALID_PARAMS: 'INVALID_INPUT',
  E400_MISSING_REQUIRED: 'INVALID_INPUT',
  E400_INVALID_NODE_TYPE: 'INVALID_INPUT',
  E400_INVALID_EDGE_TYPE: 'INVALID_INPUT',
  E400_CONTENT_TOO_LONG: 'INVALID_INPUT',
  E400_TOO_MANY_TAGS: 'INVALID_INPUT',
  E400_TOO_MANY_NODE_IDS: 'LIMIT_EXCEEDED',
  E400_TOO_MANY_BULK_OPS: 'LIMIT_EXCEEDED',
  E400_INVALID_BULK_REFERENCE: 'INVALID_INPUT',
  E400_SELF_EDGE: 'INVALID_INPUT',

  // 403 - Forbidden → PERMISSION_DENIED, except circuit breaker → NETWORK
  E403_INSUFFICIENT_CREDITS: 'PERMISSION_DENIED',
  E403_TIER_RESTRICTED: 'PERMISSION_DENIED',
  E403_CONFIRMATION_DENIED: 'PERMISSION_DENIED',
  E403_CIRCUIT_BREAKER_OPEN: 'NETWORK',

  // 404 - Not Found → NOT_FOUND
  E404_NODE_NOT_FOUND: 'NOT_FOUND',
  E404_EDGE_NOT_FOUND: 'NOT_FOUND',
  E404_CLUSTER_NOT_FOUND: 'NOT_FOUND',
  E404_UNDO_ENTRY_NOT_FOUND: 'NOT_FOUND',

  // 409 - Conflict → CONFLICT
  E409_DUPLICATE_EDGE: 'CONFLICT',
  E409_UNDO_EXPIRED: 'CONFLICT',
  E409_UNDO_DEPENDENCY: 'CONFLICT',
  E409_ALREADY_UNDONE: 'CONFLICT',

  // 429 - Rate Limited → LIMIT_EXCEEDED
  E429_RATE_LIMITED: 'LIMIT_EXCEEDED',

  // 500 - Internal → NETWORK (treat as infrastructure issue)
  E500_INTERNAL: 'NETWORK',

  // 503 - Service Unavailable → NETWORK
  E503_LLM_UNAVAILABLE: 'NETWORK',

  // 504 - Timeout → NETWORK
  E504_TOOL_TIMEOUT: 'NETWORK',
};

// ============================================================
// FIX STRATEGY CONFIGURATION
// ============================================================

/** Fix strategy config: whether to auto-retry and what the strategy is. */
export interface NeasFixStrategyConfig {
  /** Whether the agent should automatically retry (one attempt) */
  retry_automatically: boolean;
  /** Human-readable description of the recovery strategy */
  description: string;
}

export const NeasFixStrategyConfigSchema = z.object({
  retry_automatically: z.boolean(),
  description: z.string(),
});

/**
 * Per-error-type fix strategies.
 * Part of the Interpret → Retry → Explain flow (Notion-inspired).
 */
export const NEAS_FIX_STRATEGIES: Record<NeasErrorType, NeasFixStrategyConfig> = {
  NOT_FOUND: { retry_automatically: false, description: 'Search for similar items, suggest creation' },
  PERMISSION_DENIED: { retry_automatically: false, description: 'Explain required permission or credits' },
  LIMIT_EXCEEDED: { retry_automatically: false, description: 'Offer partial execution (first N items)' },
  INVALID_INPUT: { retry_automatically: false, description: 'Ask user for clarification' },
  CONFLICT: { retry_automatically: true, description: 'Re-fetch fresh data and retry once' },
  NETWORK: { retry_automatically: true, description: 'Queue for later, inform user of degraded state' },
};

// ============================================================
// ERROR EXPLANATION TEMPLATES
// ============================================================

/** User-facing error message templates. Placeholders replaced at runtime. */
export const NEAS_ERROR_EXPLANATIONS: Record<NeasErrorType, string> = {
  NOT_FOUND: "I couldn't find {target}. {suggestion}",
  PERMISSION_DENIED: "I don't have permission to {action}. {suggestion}",
  LIMIT_EXCEEDED: 'That operation exceeds the {limit_type} limit of {limit_value}. {suggestion}',
  INVALID_INPUT: "The {field} provided isn't valid. {suggestion}",
  CONFLICT: 'The {target} was modified since I last viewed it. {suggestion}',
  NETWORK: "I'm having trouble reaching {service}. {suggestion}",
};

/** Recovery suggestion templates. Placeholders replaced at runtime. */
export const NEAS_RECOVERY_SUGGESTIONS: Record<NeasErrorType, string> = {
  NOT_FOUND: 'Would you like to search for something similar, or create it?',
  PERMISSION_DENIED: 'You can enable this in Settings > Agent > Safety.',
  LIMIT_EXCEEDED: 'Would you like me to do the first {max} instead?',
  INVALID_INPUT: 'Could you provide a valid {field}?',
  CONFLICT: "I'll re-read the latest version and try again.",
  NETWORK: "I'll queue this action and retry when the connection is restored.",
};

// ============================================================
// CERTAINTY LEVELS
// ============================================================

/**
 * How certain the agent is about the user's intent.
 *
 * - high: Clear target + clear action ("delete this note")
 * - medium: Matches prior pattern or unambiguous scope
 * - low: Vague request ("fix my notes")
 */
export const NEAS_CERTAINTY_LEVELS = ['high', 'medium', 'low'] as const;

export type NeasCertaintyLevel = (typeof NEAS_CERTAINTY_LEVELS)[number];
export const NeasCertaintyLevelSchema = z.enum(NEAS_CERTAINTY_LEVELS);

// ============================================================
// IMPACT LEVELS
// ============================================================

/**
 * How much impact the requested action will have.
 *
 * - low: Single read or small write, low cost
 * - medium: Moderate cost or scope
 * - high: Destructive, affects many items, or expensive
 */
export const NEAS_IMPACT_LEVELS = ['low', 'medium', 'high'] as const;

export type NeasImpactLevel = (typeof NEAS_IMPACT_LEVELS)[number];
export const NeasImpactLevelSchema = z.enum(NEAS_IMPACT_LEVELS);

// ============================================================
// CLARIFICATION ACTIONS
// ============================================================

/**
 * What the agent should do based on certainty × impact assessment.
 *
 * - act: Execute immediately (may still require ATSS tool-level confirmation)
 * - act_then_clarify: Execute best effort, then ask if result is correct
 * - clarify_first: Ask user for more information before acting
 */
export const NEAS_CLARIFICATION_ACTIONS = ['act', 'act_then_clarify', 'clarify_first'] as const;

export type NeasClarificationAction = (typeof NEAS_CLARIFICATION_ACTIONS)[number];
export const NeasClarificationActionSchema = z.enum(NEAS_CLARIFICATION_ACTIONS);

// ============================================================
// CLARIFICATION DECISION MATRIX
// ============================================================

/**
 * The core decision matrix: certainty × impact → action.
 *
 * ```
 *            Low Impact       Medium Impact     High Impact
 *            ─────────────    ─────────────     ─────────────
 * High       act              act               act
 * Medium     act              act_then_clarify  clarify_first
 * Low        act_then_clarify clarify_first     clarify_first
 * ```
 */
export const NEAS_CLARIFICATION_MATRIX: Record<NeasCertaintyLevel, Record<NeasImpactLevel, NeasClarificationAction>> = {
  high: {
    low: 'act',
    medium: 'act',
    high: 'act',
  },
  medium: {
    low: 'act',
    medium: 'act_then_clarify',
    high: 'clarify_first',
  },
  low: {
    low: 'act_then_clarify',
    medium: 'clarify_first',
    high: 'clarify_first',
  },
};

// ============================================================
// RESPONSE VERBOSITY
// ============================================================

/**
 * How verbose the agent's responses should be.
 *
 * - terse: Minimal output ("Done. 3 links created.")
 * - balanced: Standard detail level (default)
 * - detailed: Full explanation with reasoning
 */
export const NEAS_RESPONSE_VERBOSITY_LEVELS = ['terse', 'balanced', 'detailed'] as const;

export type NeasResponseVerbosity = (typeof NEAS_RESPONSE_VERBOSITY_LEVELS)[number];
export const NeasResponseVerbositySchema = z.enum(NEAS_RESPONSE_VERBOSITY_LEVELS);

// ============================================================
// UNCERTAINTY RESPONSE MODES
// ============================================================

/**
 * What the agent does when uncertain about user intent.
 *
 * - ask: Ask user for clarification (default)
 * - best_guess: Make best effort and show result
 * - refuse: Explain uncertainty and wait for clearer instructions
 */
export const NEAS_UNCERTAINTY_RESPONSES = ['ask', 'best_guess', 'refuse'] as const;

export type NeasUncertaintyResponse = (typeof NEAS_UNCERTAINTY_RESPONSES)[number];
export const NeasUncertaintyResponseSchema = z.enum(NEAS_UNCERTAINTY_RESPONSES);

// ============================================================
// SEARCH SCOPE
// ============================================================

/**
 * Default scope for search operations.
 *
 * - all: Search entire graph (default)
 * - recent: Only recent nodes (within default_time_range_days)
 * - current_cluster: Only nodes in the user's current cluster context
 */
export const NEAS_SEARCH_SCOPES = ['all', 'recent', 'current_cluster'] as const;

export type NeasSearchScope = (typeof NEAS_SEARCH_SCOPES)[number];
export const NeasSearchScopeSchema = z.enum(NEAS_SEARCH_SCOPES);

// ============================================================
// SUGGESTION MODES
// ============================================================

/**
 * Proactive suggestion configuration modes.
 *
 * - off: No proactive suggestions (default)
 * - important_only: Only high-confidence suggestions (>= min_confidence)
 * - all: All suggestions (may be noisy)
 */
export const NEAS_SUGGESTION_MODES = ['off', 'important_only', 'all'] as const;

export type NeasSuggestionMode = (typeof NEAS_SUGGESTION_MODES)[number];
export const NeasSuggestionModeSchema = z.enum(NEAS_SUGGESTION_MODES);

// ============================================================
// PERMISSION TIERS
// ============================================================

/**
 * Permission tier levels for agent tool access.
 *
 * - always_on: Cannot be disabled (read operations)
 * - on_by_default: Enabled by default, user can disable (write operations)
 * - off_by_default: Disabled by default, user must enable (delete, bulk)
 */
export const NEAS_PERMISSION_TIERS = ['always_on', 'on_by_default', 'off_by_default'] as const;

export type NeasPermissionTier = (typeof NEAS_PERMISSION_TIERS)[number];
export const NeasPermissionTierSchema = z.enum(NEAS_PERMISSION_TIERS);

// ============================================================
// TOOL → PERMISSION TIER MAPPING
// ============================================================

/**
 * Maps each ATSS tool to its NEAS permission tier.
 *
 * - always_on: view_node, search (read-only, always available)
 * - on_by_default: create_node, update_node, create_edge, delete_edge, link_to_cluster
 * - off_by_default: delete_node, bulk_operations (dangerous, must enable)
 */
export const NEAS_TOOL_PERMISSION_TIER: Record<AtssToolName, NeasPermissionTier> = {
  view_node: 'always_on',
  search: 'always_on',
  create_node: 'on_by_default',
  update_node: 'on_by_default',
  create_edge: 'on_by_default',
  delete_edge: 'on_by_default',
  link_to_cluster: 'on_by_default',
  delete_node: 'off_by_default',
  bulk_operations: 'off_by_default',
};

// ============================================================
// OFFLINE TOOL AVAILABILITY
// ============================================================

/** Tools available when the device is offline. Only read operations. */
export const NEAS_OFFLINE_AVAILABLE_TOOLS: readonly AtssToolName[] = [
  'view_node',
  'search',
];

/** Tools that require online connectivity. All write and destructive operations. */
export const NEAS_ONLINE_ONLY_TOOLS: readonly AtssToolName[] = [
  'create_node',
  'update_node',
  'delete_node',
  'create_edge',
  'delete_edge',
  'link_to_cluster',
  'bulk_operations',
];

// ============================================================
// DEFAULT AGENT CONFIGURATION
// ============================================================

/** Default agent behavior settings. Users can override any of these. */
export const NEAS_DEFAULT_AGENT_DEFAULTS = {
  response_verbosity: 'balanced' as NeasResponseVerbosity,
  show_reasoning: false,
  auto_search_before_action: true,
  auto_show_related: true,
  auto_suggest_links: false,
  confirm_threshold_items: 10,
  confirm_threshold_credits: 15,
  confirm_destructive: true,
  uncertainty_response: 'ask' as NeasUncertaintyResponse,
  default_search_scope: 'all' as NeasSearchScope,
  default_time_range_days: 30,
} as const;

/** Default agent permissions. Safe-by-default: read+write on, delete+bulk off. */
export const NEAS_DEFAULT_AGENT_PERMISSIONS = {
  can_read: true as const,
  can_write: true,
  can_auto_operations: true,
  can_delete: false,
  can_bulk_operations: false,
} as const;

/** Default request-level agent limits. Per-request caps complementing ATSS per-tool rate limits. */
export const NEAS_DEFAULT_AGENT_LIMITS = {
  max_operations_per_request: 100,
  max_credits_per_request: 30,
  preview_threshold: 10,
  context_batch_size: 50,
} as const;

/** Default proactive suggestion config. Suggestions OFF by default. */
export const NEAS_DEFAULT_SUGGESTION_CONFIG = {
  mode: 'off' as NeasSuggestionMode,
  max_per_day: 1,
  min_confidence: 0.9,
  quiet_hours_start: 22,
  quiet_hours_end: 8,
} as const;

// ============================================================
// IMPACT COST THRESHOLD
// ============================================================

/**
 * Credit cost threshold above which an operation is considered "high impact"
 * in the impact assessment. Default: 10 credits.
 */
export const NEAS_HIGH_IMPACT_CREDIT_THRESHOLD = 10;

// ============================================================
// RE-EXPORTED ATSS REFERENCES (for NEAS internal use)
// ============================================================

/** Re-export ATSS tool names for NEAS functions that reference the full tool list. */
export { ATSS_TOOL_NAMES, ATSS_TOOL_TO_CATEGORY, ATSS_TOOL_CONFIRMATION };
export type { AtssToolName, AtssConfirmationLevel };

// ============================================================
// TYPE GUARDS
// ============================================================

/** Type guard for NEAS error types. */
export function isNeasErrorType(value: string): value is NeasErrorType {
  return (NEAS_ERROR_TYPES as readonly string[]).includes(value);
}

/** Type guard for certainty levels. */
export function isNeasCertaintyLevel(value: string): value is NeasCertaintyLevel {
  return (NEAS_CERTAINTY_LEVELS as readonly string[]).includes(value);
}

/** Type guard for impact levels. */
export function isNeasImpactLevel(value: string): value is NeasImpactLevel {
  return (NEAS_IMPACT_LEVELS as readonly string[]).includes(value);
}

/** Type guard for clarification actions. */
export function isNeasClarificationAction(value: string): value is NeasClarificationAction {
  return (NEAS_CLARIFICATION_ACTIONS as readonly string[]).includes(value);
}

/** Type guard for response verbosity levels. */
export function isNeasResponseVerbosity(value: string): value is NeasResponseVerbosity {
  return (NEAS_RESPONSE_VERBOSITY_LEVELS as readonly string[]).includes(value);
}

/** Type guard for suggestion modes. */
export function isNeasSuggestionMode(value: string): value is NeasSuggestionMode {
  return (NEAS_SUGGESTION_MODES as readonly string[]).includes(value);
}

/** Type guard for permission tiers. */
export function isNeasPermissionTier(value: string): value is NeasPermissionTier {
  return (NEAS_PERMISSION_TIERS as readonly string[]).includes(value);
}
