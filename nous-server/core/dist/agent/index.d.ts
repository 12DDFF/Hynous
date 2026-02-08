import { z } from 'zod';
import { A as AtssToolName, a as AtssConfirmationLevel } from '../constants-DE8KHKn3.js';
export { b as ATSS_TOOL_CONFIRMATION, c as ATSS_TOOL_NAMES, d as ATSS_TOOL_TO_CATEGORY } from '../constants-DE8KHKn3.js';

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

/**
 * Prefix for agent session IDs.
 * Full format: "ses_" + nanoid(12)
 * Example: "ses_a7f3c2x9k4m1"
 *
 * @see storm-011 - ID prefix pattern (lowercase prefix + underscore + nanoid)
 */
declare const NEAS_SESSION_ID_PREFIX = "ses_";
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
declare const NEAS_ERROR_TYPES: readonly ["NOT_FOUND", "PERMISSION_DENIED", "LIMIT_EXCEEDED", "INVALID_INPUT", "CONFLICT", "NETWORK"];
type NeasErrorType = (typeof NEAS_ERROR_TYPES)[number];
declare const NeasErrorTypeSchema: z.ZodEnum<["NOT_FOUND", "PERMISSION_DENIED", "LIMIT_EXCEEDED", "INVALID_INPUT", "CONFLICT", "NETWORK"]>;
/**
 * Exhaustive mapping of all 26 ATSS error codes to 6 NEAS error types.
 *
 * This enables the agent to classify tool-level errors into high-level
 * categories, each with a distinct fix strategy.
 */
declare const NEAS_ATSS_ERROR_MAPPING: Record<string, NeasErrorType>;
/** Fix strategy config: whether to auto-retry and what the strategy is. */
interface NeasFixStrategyConfig {
    /** Whether the agent should automatically retry (one attempt) */
    retry_automatically: boolean;
    /** Human-readable description of the recovery strategy */
    description: string;
}
declare const NeasFixStrategyConfigSchema: z.ZodObject<{
    retry_automatically: z.ZodBoolean;
    description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    retry_automatically: boolean;
    description: string;
}, {
    retry_automatically: boolean;
    description: string;
}>;
/**
 * Per-error-type fix strategies.
 * Part of the Interpret → Retry → Explain flow (Notion-inspired).
 */
declare const NEAS_FIX_STRATEGIES: Record<NeasErrorType, NeasFixStrategyConfig>;
/** User-facing error message templates. Placeholders replaced at runtime. */
declare const NEAS_ERROR_EXPLANATIONS: Record<NeasErrorType, string>;
/** Recovery suggestion templates. Placeholders replaced at runtime. */
declare const NEAS_RECOVERY_SUGGESTIONS: Record<NeasErrorType, string>;
/**
 * How certain the agent is about the user's intent.
 *
 * - high: Clear target + clear action ("delete this note")
 * - medium: Matches prior pattern or unambiguous scope
 * - low: Vague request ("fix my notes")
 */
declare const NEAS_CERTAINTY_LEVELS: readonly ["high", "medium", "low"];
type NeasCertaintyLevel = (typeof NEAS_CERTAINTY_LEVELS)[number];
declare const NeasCertaintyLevelSchema: z.ZodEnum<["high", "medium", "low"]>;
/**
 * How much impact the requested action will have.
 *
 * - low: Single read or small write, low cost
 * - medium: Moderate cost or scope
 * - high: Destructive, affects many items, or expensive
 */
declare const NEAS_IMPACT_LEVELS: readonly ["low", "medium", "high"];
type NeasImpactLevel = (typeof NEAS_IMPACT_LEVELS)[number];
declare const NeasImpactLevelSchema: z.ZodEnum<["low", "medium", "high"]>;
/**
 * What the agent should do based on certainty × impact assessment.
 *
 * - act: Execute immediately (may still require ATSS tool-level confirmation)
 * - act_then_clarify: Execute best effort, then ask if result is correct
 * - clarify_first: Ask user for more information before acting
 */
declare const NEAS_CLARIFICATION_ACTIONS: readonly ["act", "act_then_clarify", "clarify_first"];
type NeasClarificationAction = (typeof NEAS_CLARIFICATION_ACTIONS)[number];
declare const NeasClarificationActionSchema: z.ZodEnum<["act", "act_then_clarify", "clarify_first"]>;
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
declare const NEAS_CLARIFICATION_MATRIX: Record<NeasCertaintyLevel, Record<NeasImpactLevel, NeasClarificationAction>>;
/**
 * How verbose the agent's responses should be.
 *
 * - terse: Minimal output ("Done. 3 links created.")
 * - balanced: Standard detail level (default)
 * - detailed: Full explanation with reasoning
 */
declare const NEAS_RESPONSE_VERBOSITY_LEVELS: readonly ["terse", "balanced", "detailed"];
type NeasResponseVerbosity = (typeof NEAS_RESPONSE_VERBOSITY_LEVELS)[number];
declare const NeasResponseVerbositySchema: z.ZodEnum<["terse", "balanced", "detailed"]>;
/**
 * What the agent does when uncertain about user intent.
 *
 * - ask: Ask user for clarification (default)
 * - best_guess: Make best effort and show result
 * - refuse: Explain uncertainty and wait for clearer instructions
 */
declare const NEAS_UNCERTAINTY_RESPONSES: readonly ["ask", "best_guess", "refuse"];
type NeasUncertaintyResponse = (typeof NEAS_UNCERTAINTY_RESPONSES)[number];
declare const NeasUncertaintyResponseSchema: z.ZodEnum<["ask", "best_guess", "refuse"]>;
/**
 * Default scope for search operations.
 *
 * - all: Search entire graph (default)
 * - recent: Only recent nodes (within default_time_range_days)
 * - current_cluster: Only nodes in the user's current cluster context
 */
declare const NEAS_SEARCH_SCOPES: readonly ["all", "recent", "current_cluster"];
type NeasSearchScope = (typeof NEAS_SEARCH_SCOPES)[number];
declare const NeasSearchScopeSchema: z.ZodEnum<["all", "recent", "current_cluster"]>;
/**
 * Proactive suggestion configuration modes.
 *
 * - off: No proactive suggestions (default)
 * - important_only: Only high-confidence suggestions (>= min_confidence)
 * - all: All suggestions (may be noisy)
 */
declare const NEAS_SUGGESTION_MODES: readonly ["off", "important_only", "all"];
type NeasSuggestionMode = (typeof NEAS_SUGGESTION_MODES)[number];
declare const NeasSuggestionModeSchema: z.ZodEnum<["off", "important_only", "all"]>;
/**
 * Permission tier levels for agent tool access.
 *
 * - always_on: Cannot be disabled (read operations)
 * - on_by_default: Enabled by default, user can disable (write operations)
 * - off_by_default: Disabled by default, user must enable (delete, bulk)
 */
declare const NEAS_PERMISSION_TIERS: readonly ["always_on", "on_by_default", "off_by_default"];
type NeasPermissionTier = (typeof NEAS_PERMISSION_TIERS)[number];
declare const NeasPermissionTierSchema: z.ZodEnum<["always_on", "on_by_default", "off_by_default"]>;
/**
 * Maps each ATSS tool to its NEAS permission tier.
 *
 * - always_on: view_node, search (read-only, always available)
 * - on_by_default: create_node, update_node, create_edge, delete_edge, link_to_cluster
 * - off_by_default: delete_node, bulk_operations (dangerous, must enable)
 */
declare const NEAS_TOOL_PERMISSION_TIER: Record<AtssToolName, NeasPermissionTier>;
/** Tools available when the device is offline. Only read operations. */
declare const NEAS_OFFLINE_AVAILABLE_TOOLS: readonly AtssToolName[];
/** Tools that require online connectivity. All write and destructive operations. */
declare const NEAS_ONLINE_ONLY_TOOLS: readonly AtssToolName[];
/** Default agent behavior settings. Users can override any of these. */
declare const NEAS_DEFAULT_AGENT_DEFAULTS: {
    readonly response_verbosity: NeasResponseVerbosity;
    readonly show_reasoning: false;
    readonly auto_search_before_action: true;
    readonly auto_show_related: true;
    readonly auto_suggest_links: false;
    readonly confirm_threshold_items: 10;
    readonly confirm_threshold_credits: 15;
    readonly confirm_destructive: true;
    readonly uncertainty_response: NeasUncertaintyResponse;
    readonly default_search_scope: NeasSearchScope;
    readonly default_time_range_days: 30;
};
/** Default agent permissions. Safe-by-default: read+write on, delete+bulk off. */
declare const NEAS_DEFAULT_AGENT_PERMISSIONS: {
    readonly can_read: true;
    readonly can_write: true;
    readonly can_auto_operations: true;
    readonly can_delete: false;
    readonly can_bulk_operations: false;
};
/** Default request-level agent limits. Per-request caps complementing ATSS per-tool rate limits. */
declare const NEAS_DEFAULT_AGENT_LIMITS: {
    readonly max_operations_per_request: 100;
    readonly max_credits_per_request: 30;
    readonly preview_threshold: 10;
    readonly context_batch_size: 50;
};
/** Default proactive suggestion config. Suggestions OFF by default. */
declare const NEAS_DEFAULT_SUGGESTION_CONFIG: {
    readonly mode: NeasSuggestionMode;
    readonly max_per_day: 1;
    readonly min_confidence: 0.9;
    readonly quiet_hours_start: 22;
    readonly quiet_hours_end: 8;
};
/**
 * Credit cost threshold above which an operation is considered "high impact"
 * in the impact assessment. Default: 10 credits.
 */
declare const NEAS_HIGH_IMPACT_CREDIT_THRESHOLD = 10;

/** Type guard for NEAS error types. */
declare function isNeasErrorType(value: string): value is NeasErrorType;
/** Type guard for certainty levels. */
declare function isNeasCertaintyLevel(value: string): value is NeasCertaintyLevel;
/** Type guard for impact levels. */
declare function isNeasImpactLevel(value: string): value is NeasImpactLevel;
/** Type guard for clarification actions. */
declare function isNeasClarificationAction(value: string): value is NeasClarificationAction;
/** Type guard for response verbosity levels. */
declare function isNeasResponseVerbosity(value: string): value is NeasResponseVerbosity;
/** Type guard for suggestion modes. */
declare function isNeasSuggestionMode(value: string): value is NeasSuggestionMode;
/** Type guard for permission tiers. */
declare function isNeasPermissionTier(value: string): value is NeasPermissionTier;

/**
 * @module @nous/core/agent
 * @description All interfaces and Zod schemas for NEAS (Nous Embedded Agent System)
 * @version 1.0.0
 * @spec Specs/Phase-9-Agent-Tools/storm-019
 * @storm Brainstorms/Infrastructure/storm-019-embedded-ai-agent
 *
 * Defines types for: agent errors, intent assessment, configuration,
 * permissions, sessions, offline behavior, and proactive suggestions.
 */

/** Represents a single agent tool invocation. Used in error tracking and session logging. */
interface NeasToolCall {
    /** ATSS tool name (e.g., 'create_node', 'search') */
    tool: AtssToolName;
    /** Tool parameters as passed to ATSS */
    params: Record<string, unknown>;
}
declare const NeasToolCallSchema: z.ZodObject<{
    tool: z.ZodEnum<["view_node", "search", "create_node", "update_node", "delete_node", "create_edge", "delete_edge", "link_to_cluster", "bulk_operations"]>;
    params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    params: Record<string, unknown>;
    tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
}, {
    params: Record<string, unknown>;
    tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
}>;
/** Structured error from agent error handling flow. */
interface NeasAgentError {
    /** High-level error classification */
    type: NeasErrorType;
    /** Human-readable error message */
    message: string;
    /** The tool call that caused the error */
    original_action: NeasToolCall;
    /** Original ATSS error code (e.g., 'E404_NODE_NOT_FOUND') */
    atss_error_code: string;
    /** Whether automatic recovery was attempted */
    recovery_attempted: boolean;
    /** Result of recovery attempt (if attempted) */
    recovery_result?: 'success' | 'failed';
}
declare const NeasAgentErrorSchema: z.ZodObject<{
    type: z.ZodEnum<["NOT_FOUND", "PERMISSION_DENIED", "LIMIT_EXCEEDED", "INVALID_INPUT", "CONFLICT", "NETWORK"]>;
    message: z.ZodString;
    original_action: z.ZodObject<{
        tool: z.ZodEnum<["view_node", "search", "create_node", "update_node", "delete_node", "create_edge", "delete_edge", "link_to_cluster", "bulk_operations"]>;
        params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        params: Record<string, unknown>;
        tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
    }, {
        params: Record<string, unknown>;
        tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
    }>;
    atss_error_code: z.ZodString;
    recovery_attempted: z.ZodBoolean;
    recovery_result: z.ZodOptional<z.ZodEnum<["success", "failed"]>>;
}, "strip", z.ZodTypeAny, {
    message: string;
    type: "NOT_FOUND" | "PERMISSION_DENIED" | "LIMIT_EXCEEDED" | "INVALID_INPUT" | "CONFLICT" | "NETWORK";
    original_action: {
        params: Record<string, unknown>;
        tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
    };
    atss_error_code: string;
    recovery_attempted: boolean;
    recovery_result?: "success" | "failed" | undefined;
}, {
    message: string;
    type: "NOT_FOUND" | "PERMISSION_DENIED" | "LIMIT_EXCEEDED" | "INVALID_INPUT" | "CONFLICT" | "NETWORK";
    original_action: {
        params: Record<string, unknown>;
        tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
    };
    atss_error_code: string;
    recovery_attempted: boolean;
    recovery_result?: "success" | "failed" | undefined;
}>;
/** User-facing error explanation with recovery suggestion. */
interface NeasErrorExplanation {
    /** User-friendly error message */
    user_message: string;
    /** Recovery suggestion for the user */
    suggestion: string;
    /** The original agent error */
    original_error: NeasAgentError;
}
declare const NeasErrorExplanationSchema: z.ZodObject<{
    user_message: z.ZodString;
    suggestion: z.ZodString;
    original_error: z.ZodObject<{
        type: z.ZodEnum<["NOT_FOUND", "PERMISSION_DENIED", "LIMIT_EXCEEDED", "INVALID_INPUT", "CONFLICT", "NETWORK"]>;
        message: z.ZodString;
        original_action: z.ZodObject<{
            tool: z.ZodEnum<["view_node", "search", "create_node", "update_node", "delete_node", "create_edge", "delete_edge", "link_to_cluster", "bulk_operations"]>;
            params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            params: Record<string, unknown>;
            tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
        }, {
            params: Record<string, unknown>;
            tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
        }>;
        atss_error_code: z.ZodString;
        recovery_attempted: z.ZodBoolean;
        recovery_result: z.ZodOptional<z.ZodEnum<["success", "failed"]>>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        type: "NOT_FOUND" | "PERMISSION_DENIED" | "LIMIT_EXCEEDED" | "INVALID_INPUT" | "CONFLICT" | "NETWORK";
        original_action: {
            params: Record<string, unknown>;
            tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
        };
        atss_error_code: string;
        recovery_attempted: boolean;
        recovery_result?: "success" | "failed" | undefined;
    }, {
        message: string;
        type: "NOT_FOUND" | "PERMISSION_DENIED" | "LIMIT_EXCEEDED" | "INVALID_INPUT" | "CONFLICT" | "NETWORK";
        original_action: {
            params: Record<string, unknown>;
            tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
        };
        atss_error_code: string;
        recovery_attempted: boolean;
        recovery_result?: "success" | "failed" | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    user_message: string;
    suggestion: string;
    original_error: {
        message: string;
        type: "NOT_FOUND" | "PERMISSION_DENIED" | "LIMIT_EXCEEDED" | "INVALID_INPUT" | "CONFLICT" | "NETWORK";
        original_action: {
            params: Record<string, unknown>;
            tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
        };
        atss_error_code: string;
        recovery_attempted: boolean;
        recovery_result?: "success" | "failed" | undefined;
    };
}, {
    user_message: string;
    suggestion: string;
    original_error: {
        message: string;
        type: "NOT_FOUND" | "PERMISSION_DENIED" | "LIMIT_EXCEEDED" | "INVALID_INPUT" | "CONFLICT" | "NETWORK";
        original_action: {
            params: Record<string, unknown>;
            tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
        };
        atss_error_code: string;
        recovery_attempted: boolean;
        recovery_result?: "success" | "failed" | undefined;
    };
}>;
/** Inputs to certainty assessment. Used to determine confidence about user intent. */
interface NeasCertaintyFactors {
    /** User specified a specific target ("this note" vs "my notes") */
    has_specific_target: boolean;
    /** User specified a clear action ("delete" vs "help with") */
    has_clear_action: boolean;
    /** Request matches a pattern the user has done before */
    matches_prior_pattern: boolean;
    /** Scope is unambiguous ("these 3" vs "some") */
    unambiguous_scope: boolean;
}
declare const NeasCertaintyFactorsSchema: z.ZodObject<{
    has_specific_target: z.ZodBoolean;
    has_clear_action: z.ZodBoolean;
    matches_prior_pattern: z.ZodBoolean;
    unambiguous_scope: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    has_specific_target: boolean;
    has_clear_action: boolean;
    matches_prior_pattern: boolean;
    unambiguous_scope: boolean;
}, {
    has_specific_target: boolean;
    has_clear_action: boolean;
    matches_prior_pattern: boolean;
    unambiguous_scope: boolean;
}>;
/** Inputs to impact assessment. Used to determine operation impact level. */
interface NeasImpactFactors {
    /** Operation is destructive (delete, remove, merge) */
    is_destructive: boolean;
    /** Operation affects many items ("all my notes") */
    affects_many: boolean;
    /** Operation is reversible (can undo) */
    is_reversible: boolean;
    /** Estimated credit cost of the operation */
    estimated_cost: number;
}
declare const NeasImpactFactorsSchema: z.ZodObject<{
    is_destructive: z.ZodBoolean;
    affects_many: z.ZodBoolean;
    is_reversible: z.ZodBoolean;
    estimated_cost: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    is_destructive: boolean;
    affects_many: boolean;
    is_reversible: boolean;
    estimated_cost: number;
}, {
    is_destructive: boolean;
    affects_many: boolean;
    is_reversible: boolean;
    estimated_cost: number;
}>;
/** Result of certainty × impact assessment. */
interface NeasIntentAssessment {
    /** How certain the agent is about user intent */
    certainty: NeasCertaintyLevel;
    /** How much impact the action will have */
    impact: NeasImpactLevel;
    /** What the agent should do */
    action: NeasClarificationAction;
}
declare const NeasIntentAssessmentSchema: z.ZodObject<{
    certainty: z.ZodEnum<["high", "medium", "low"]>;
    impact: z.ZodEnum<["low", "medium", "high"]>;
    action: z.ZodEnum<["act", "act_then_clarify", "clarify_first"]>;
}, "strip", z.ZodTypeAny, {
    certainty: "high" | "medium" | "low";
    impact: "high" | "medium" | "low";
    action: "act" | "act_then_clarify" | "clarify_first";
}, {
    certainty: "high" | "medium" | "low";
    impact: "high" | "medium" | "low";
    action: "act" | "act_then_clarify" | "clarify_first";
}>;
/** User-configurable agent behavior settings. Persisted, requires _schemaVersion. */
interface NeasAgentDefaults {
    /** Schema version for migration safety */
    _schemaVersion: number;
    /** How verbose responses should be */
    response_verbosity: NeasResponseVerbosity;
    /** Whether to show reasoning steps */
    show_reasoning: boolean;
    /** Search for existing content before creating new */
    auto_search_before_action: boolean;
    /** Show related nodes alongside results */
    auto_show_related: boolean;
    /** Suggest new links proactively */
    auto_suggest_links: boolean;
    /** Require confirmation when more than N items are affected */
    confirm_threshold_items: number;
    /** Require confirmation when cost exceeds N credits */
    confirm_threshold_credits: number;
    /** Always require confirmation for destructive operations */
    confirm_destructive: boolean;
    /** What to do when uncertain about user intent */
    uncertainty_response: NeasUncertaintyResponse;
    /** Default search scope */
    default_search_scope: NeasSearchScope;
    /** Default time range for recency queries (days) */
    default_time_range_days: number;
}
declare const NeasAgentDefaultsSchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    response_verbosity: z.ZodEnum<["terse", "balanced", "detailed"]>;
    show_reasoning: z.ZodBoolean;
    auto_search_before_action: z.ZodBoolean;
    auto_show_related: z.ZodBoolean;
    auto_suggest_links: z.ZodBoolean;
    confirm_threshold_items: z.ZodNumber;
    confirm_threshold_credits: z.ZodNumber;
    confirm_destructive: z.ZodBoolean;
    uncertainty_response: z.ZodEnum<["ask", "best_guess", "refuse"]>;
    default_search_scope: z.ZodEnum<["all", "recent", "current_cluster"]>;
    default_time_range_days: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    _schemaVersion: number;
    response_verbosity: "balanced" | "terse" | "detailed";
    show_reasoning: boolean;
    auto_search_before_action: boolean;
    auto_show_related: boolean;
    auto_suggest_links: boolean;
    confirm_threshold_items: number;
    confirm_threshold_credits: number;
    confirm_destructive: boolean;
    uncertainty_response: "ask" | "best_guess" | "refuse";
    default_search_scope: "all" | "recent" | "current_cluster";
    default_time_range_days: number;
}, {
    _schemaVersion: number;
    response_verbosity: "balanced" | "terse" | "detailed";
    show_reasoning: boolean;
    auto_search_before_action: boolean;
    auto_show_related: boolean;
    auto_suggest_links: boolean;
    confirm_threshold_items: number;
    confirm_threshold_credits: number;
    confirm_destructive: boolean;
    uncertainty_response: "ask" | "best_guess" | "refuse";
    default_search_scope: "all" | "recent" | "current_cluster";
    default_time_range_days: number;
}>;
/**
 * 3-tier permission model for agent capabilities.
 * Tier 1: Always on (read) — cannot be disabled.
 * Tier 2: On by default (write, auto-operations) — user can disable.
 * Tier 3: Off by default (delete, bulk) — user must enable.
 */
interface NeasAgentPermissions {
    /** Schema version for migration safety */
    _schemaVersion: number;
    /** Tier 1: Always on — cannot be disabled */
    can_read: true;
    /** Tier 2: On by default — user can disable */
    can_write: boolean;
    /** Tier 2: On by default — user can disable */
    can_auto_operations: boolean;
    /** Tier 3: Off by default — user must enable */
    can_delete: boolean;
    /** Tier 3: Off by default — user must enable */
    can_bulk_operations: boolean;
}
declare const NeasAgentPermissionsSchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    can_read: z.ZodLiteral<true>;
    can_write: z.ZodBoolean;
    can_auto_operations: z.ZodBoolean;
    can_delete: z.ZodBoolean;
    can_bulk_operations: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    _schemaVersion: number;
    can_read: true;
    can_write: boolean;
    can_auto_operations: boolean;
    can_delete: boolean;
    can_bulk_operations: boolean;
}, {
    _schemaVersion: number;
    can_read: true;
    can_write: boolean;
    can_auto_operations: boolean;
    can_delete: boolean;
    can_bulk_operations: boolean;
}>;
/** Request-level operation caps. Prevents runaway operations and excessive credit spending. */
interface NeasAgentLimits {
    /** Maximum tool calls per user request */
    max_operations_per_request: number;
    /** Maximum credits per user request */
    max_credits_per_request: number;
    /** Show preview if more than N items affected */
    preview_threshold: number;
    /** Process large operations in batches of N */
    context_batch_size: number;
}
declare const NeasAgentLimitsSchema: z.ZodObject<{
    max_operations_per_request: z.ZodNumber;
    max_credits_per_request: z.ZodNumber;
    preview_threshold: z.ZodNumber;
    context_batch_size: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    max_operations_per_request: number;
    max_credits_per_request: number;
    preview_threshold: number;
    context_batch_size: number;
}, {
    max_operations_per_request: number;
    max_credits_per_request: number;
    preview_threshold: number;
    context_batch_size: number;
}>;
/** Single tracked action in a session. */
interface NeasSessionAction {
    /** ATSS tool that was executed */
    tool: AtssToolName;
    /** Reference to ATSS undo entry (null for read operations) */
    atss_undo_entry_id: string | null;
    /** When the action was performed (ISO 8601) */
    timestamp: string;
    /** Credit cost of this action */
    credit_cost: number;
}
declare const NeasSessionActionSchema: z.ZodObject<{
    tool: z.ZodEnum<["view_node", "search", "create_node", "update_node", "delete_node", "create_edge", "delete_edge", "link_to_cluster", "bulk_operations"]>;
    atss_undo_entry_id: z.ZodNullable<z.ZodString>;
    timestamp: z.ZodString;
    credit_cost: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
    atss_undo_entry_id: string | null;
    timestamp: string;
    credit_cost: number;
}, {
    tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
    atss_undo_entry_id: string | null;
    timestamp: string;
    credit_cost: number;
}>;
/** Per-request session tracking. Tracks all operations during a single user request. */
interface NeasAgentSession {
    /** Schema version for migration safety */
    _schemaVersion: number;
    /** Unique session ID (ses_ + nanoid(12)) */
    id: string;
    /** User who owns this session */
    user_id: string;
    /** When the session started (ISO 8601) */
    started_at: string;
    /** Total number of tool operations performed */
    operations_count: number;
    /** Total credits spent in this session */
    credits_spent: number;
    /** Ordered log of all actions in this session */
    action_log: NeasSessionAction[];
}
declare const NeasAgentSessionSchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    id: z.ZodString;
    user_id: z.ZodString;
    started_at: z.ZodString;
    operations_count: z.ZodNumber;
    credits_spent: z.ZodNumber;
    action_log: z.ZodArray<z.ZodObject<{
        tool: z.ZodEnum<["view_node", "search", "create_node", "update_node", "delete_node", "create_edge", "delete_edge", "link_to_cluster", "bulk_operations"]>;
        atss_undo_entry_id: z.ZodNullable<z.ZodString>;
        timestamp: z.ZodString;
        credit_cost: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
        atss_undo_entry_id: string | null;
        timestamp: string;
        credit_cost: number;
    }, {
        tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
        atss_undo_entry_id: string | null;
        timestamp: string;
        credit_cost: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    _schemaVersion: number;
    id: string;
    user_id: string;
    started_at: string;
    operations_count: number;
    credits_spent: number;
    action_log: {
        tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
        atss_undo_entry_id: string | null;
        timestamp: string;
        credit_cost: number;
    }[];
}, {
    _schemaVersion: number;
    id: string;
    user_id: string;
    started_at: string;
    operations_count: number;
    credits_spent: number;
    action_log: {
        tool: "view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations";
        atss_undo_entry_id: string | null;
        timestamp: string;
        credit_cost: number;
    }[];
}>;
/** Result of checking whether an operation can proceed. */
interface NeasOperationCheck {
    /** Whether the operation is allowed */
    allowed: boolean;
    /** Reason for denial (if not allowed) */
    reason?: string;
    /** How many more operations can be performed this request */
    remaining_operations: number;
    /** How many more credits can be spent this request */
    remaining_credits: number;
}
declare const NeasOperationCheckSchema: z.ZodObject<{
    allowed: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
    remaining_operations: z.ZodNumber;
    remaining_credits: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    allowed: boolean;
    remaining_operations: number;
    remaining_credits: number;
    reason?: string | undefined;
}, {
    allowed: boolean;
    remaining_operations: number;
    remaining_credits: number;
    reason?: string | undefined;
}>;
/** Summary stats for a completed session. */
interface NeasSessionSummary {
    /** Total operations performed */
    total_operations: number;
    /** Total credits spent */
    total_credits: number;
    /** Session duration in milliseconds */
    duration_ms: number;
    /** Count of each tool used (tool name -> count) */
    tools_used: Record<string, number>;
}
declare const NeasSessionSummarySchema: z.ZodObject<{
    total_operations: z.ZodNumber;
    total_credits: z.ZodNumber;
    duration_ms: z.ZodNumber;
    tools_used: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    total_operations: number;
    total_credits: number;
    duration_ms: number;
    tools_used: Record<string, number>;
}, {
    total_operations: number;
    total_credits: number;
    duration_ms: number;
    tools_used: Record<string, number>;
}>;
/** Agent capabilities when offline. */
interface NeasOfflineCapabilities {
    /** Tools that work offline (read-only ATSS tools) */
    available_tools: readonly AtssToolName[];
    /** Whether the agent is in read-only mode */
    read_only: boolean;
    /** Whether previously cached suggestions are accessible */
    cached_suggestions_available: boolean;
}
declare const NeasOfflineCapabilitiesSchema: z.ZodObject<{
    available_tools: z.ZodReadonly<z.ZodArray<z.ZodEnum<["view_node", "search", "create_node", "update_node", "delete_node", "create_edge", "delete_edge", "link_to_cluster", "bulk_operations"]>, "many">>;
    read_only: z.ZodBoolean;
    cached_suggestions_available: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    available_tools: readonly ("view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations")[];
    read_only: boolean;
    cached_suggestions_available: boolean;
}, {
    available_tools: readonly ("view_node" | "search" | "create_node" | "update_node" | "delete_node" | "create_edge" | "delete_edge" | "link_to_cluster" | "bulk_operations")[];
    read_only: boolean;
    cached_suggestions_available: boolean;
}>;
/** Proactive suggestion configuration. Controls when and how the agent suggests improvements. */
interface NeasSuggestionConfig {
    /** Schema version for migration safety */
    _schemaVersion: number;
    /** Suggestion display mode */
    mode: NeasSuggestionMode;
    /** Maximum suggestions per day */
    max_per_day: number;
    /** Minimum confidence threshold (0.0-1.0) */
    min_confidence: number;
    /** Quiet hours start (0-23, hour of day) */
    quiet_hours_start: number;
    /** Quiet hours end (0-23, hour of day) */
    quiet_hours_end: number;
}
declare const NeasSuggestionConfigSchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    mode: z.ZodEnum<["off", "important_only", "all"]>;
    max_per_day: z.ZodNumber;
    min_confidence: z.ZodNumber;
    quiet_hours_start: z.ZodNumber;
    quiet_hours_end: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    _schemaVersion: number;
    mode: "all" | "off" | "important_only";
    max_per_day: number;
    min_confidence: number;
    quiet_hours_start: number;
    quiet_hours_end: number;
}, {
    _schemaVersion: number;
    mode: "all" | "off" | "important_only";
    max_per_day: number;
    min_confidence: number;
    quiet_hours_start: number;
    quiet_hours_end: number;
}>;
/** Result of combined NEAS + ATSS permission check. */
interface NeasPermissionCheckResult {
    /** Whether the tool call is allowed */
    allowed: boolean;
    /** Reason for denial (if not allowed) */
    denied_reason?: string;
    /** Effective confirmation level after combining NEAS + ATSS rules */
    effective_confirmation: AtssConfirmationLevel;
    /** Which permission tier this tool belongs to */
    permission_tier: NeasPermissionTier;
}
declare const NeasPermissionCheckResultSchema: z.ZodObject<{
    allowed: z.ZodBoolean;
    denied_reason: z.ZodOptional<z.ZodString>;
    effective_confirmation: z.ZodEnum<["none", "inform", "confirm"]>;
    permission_tier: z.ZodEnum<["always_on", "on_by_default", "off_by_default"]>;
}, "strip", z.ZodTypeAny, {
    allowed: boolean;
    effective_confirmation: "confirm" | "none" | "inform";
    permission_tier: "always_on" | "on_by_default" | "off_by_default";
    denied_reason?: string | undefined;
}, {
    allowed: boolean;
    effective_confirmation: "confirm" | "none" | "inform";
    permission_tier: "always_on" | "on_by_default" | "off_by_default";
    denied_reason?: string | undefined;
}>;

/**
 * @module @nous/core/agent
 * @description Nous Embedded Agent System (NEAS) - Behavioral intelligence layer above ATSS
 * @version 1.0.0
 * @spec Specs/Phase-9-Agent-Tools/storm-019
 * @storm Brainstorms/Infrastructure/storm-019-embedded-ai-agent
 *
 * Provides:
 * - Error classification and fix strategies (6 agent error types → 26 ATSS codes)
 * - Intent assessment (certainty × impact → clarification action)
 * - Agent configuration, permissions, and session management
 * - Offline behavior and proactive suggestion throttling
 */

/**
 * Generates a globally unique agent session ID.
 * Format: "ses_" + 12-character nanoid
 *
 * @returns Session ID string (16 characters total)
 */
declare function generateSessionId(): string;
/**
 * Classifies an ATSS error code into a high-level agent error type.
 *
 * Maps all 26 ATSS error codes to one of 6 agent error types.
 * Returns 'NETWORK' as fallback for unknown/unmapped codes.
 *
 * @param atssErrorCode - ATSS error code string (e.g., 'E404_NODE_NOT_FOUND')
 * @returns The agent-level error type classification
 */
declare function classifyAgentError(atssErrorCode: string): NeasErrorType;
/**
 * Creates a structured agent error from an ATSS error response.
 *
 * Combines the ATSS error code with agent-level classification.
 * Sets recovery_attempted = false (recovery happens later).
 *
 * @param atssErrorCode - Original ATSS error code
 * @param message - Human-readable error message from ATSS
 * @param originalAction - The tool call that triggered the error
 * @returns A structured NeasAgentError
 */
declare function mapAtssErrorToAgentError(atssErrorCode: string, message: string, originalAction: NeasToolCall): NeasAgentError;
/**
 * Returns the fix strategy configuration for a given error type.
 *
 * @param errorType - The agent-level error type
 * @returns Fix strategy configuration
 */
declare function getFixStrategy(errorType: NeasErrorType): NeasFixStrategyConfig;
/**
 * Checks whether the given error type supports automatic retry.
 * Only CONFLICT and NETWORK are auto-retryable.
 *
 * @param errorType - The agent-level error type
 * @returns true if auto-retry is appropriate
 */
declare function isAutoRetryable(errorType: NeasErrorType): boolean;
/**
 * Generates a user-friendly error explanation message.
 *
 * Uses template from NEAS_ERROR_EXPLANATIONS, replacing {placeholders}
 * with context values. Falls back to error.message if no template.
 *
 * @param error - The agent error to explain
 * @param context - Optional placeholder values for the template
 * @returns User-friendly error message string
 */
declare function generateUserExplanation(error: NeasAgentError, context?: Record<string, string>): string;
/**
 * Generates a recovery suggestion for the user.
 *
 * Uses template from NEAS_RECOVERY_SUGGESTIONS, replacing {placeholders}
 * with context values.
 *
 * @param error - The agent error to suggest recovery for
 * @param context - Optional placeholder values
 * @returns Recovery suggestion string
 */
declare function generateRecoverySuggestion(error: NeasAgentError, context?: Record<string, string>): string;
/**
 * Creates a complete error explanation combining message and suggestion.
 * Final step of the Interpret → Retry → Explain flow.
 *
 * @param error - The agent error to explain
 * @param context - Optional placeholder values for templates
 * @returns Complete error explanation with message + suggestion
 */
declare function createErrorExplanation(error: NeasAgentError, context?: Record<string, string>): NeasErrorExplanation;
/**
 * Evaluates how certain the agent is about the user's intent.
 *
 * - high: has_specific_target AND has_clear_action
 * - medium: matches_prior_pattern OR unambiguous_scope
 * - low: otherwise
 *
 * @param factors - The certainty assessment inputs
 * @returns Certainty level: 'high', 'medium', or 'low'
 */
declare function assessCertainty(factors: NeasCertaintyFactors): NeasCertaintyLevel;
/**
 * Evaluates how much impact the requested action will have.
 *
 * - high: is_destructive OR affects_many
 * - medium: estimated_cost > creditThreshold
 * - low: otherwise
 *
 * @param factors - The impact assessment inputs
 * @param creditThreshold - Cost threshold for medium impact (default: NEAS_HIGH_IMPACT_CREDIT_THRESHOLD)
 * @returns Impact level: 'low', 'medium', or 'high'
 */
declare function assessImpact(factors: NeasImpactFactors, creditThreshold?: number): NeasImpactLevel;
/**
 * Looks up the clarification action from the certainty × impact matrix.
 *
 * @param certainty - How certain the agent is about intent
 * @param impact - How much impact the action will have
 * @returns The clarification action to take
 */
declare function determineAction(certainty: NeasCertaintyLevel, impact: NeasImpactLevel): NeasClarificationAction;
/**
 * Performs a complete intent assessment combining certainty, impact, and action.
 *
 * @param certaintyFactors - Inputs for certainty evaluation
 * @param impactFactors - Inputs for impact evaluation
 * @returns Complete intent assessment with certainty, impact, and action
 */
declare function assessIntent(certaintyFactors: NeasCertaintyFactors, impactFactors: NeasImpactFactors): NeasIntentAssessment;
/** Returns true if the agent should ask for clarification BEFORE acting. */
declare function shouldClarifyFirst(assessment: NeasIntentAssessment): boolean;
/** Returns true if the agent should act first, then ask if the result is correct. */
declare function shouldActThenClarify(assessment: NeasIntentAssessment): boolean;
/**
 * Creates a new NeasAgentDefaults with all default values.
 * Returns a deep copy. Sets _schemaVersion to 1.
 */
declare function createDefaultAgentDefaults(): NeasAgentDefaults;
/**
 * Creates a new NeasAgentPermissions with safe defaults.
 * Returns a deep copy. Sets _schemaVersion to 1.
 */
declare function createDefaultAgentPermissions(): NeasAgentPermissions;
/**
 * Creates a new NeasAgentLimits with default request-level caps.
 */
declare function createDefaultAgentLimits(): NeasAgentLimits;
/**
 * Merges user overrides into base agent defaults.
 * Preserves base _schemaVersion.
 *
 * @param base - Current agent defaults
 * @param overrides - Partial overrides to apply
 * @returns New agent defaults with overrides applied
 */
declare function mergeAgentDefaults(base: NeasAgentDefaults, overrides: Partial<Omit<NeasAgentDefaults, '_schemaVersion'>>): NeasAgentDefaults;
/**
 * Checks whether a tool is allowed by the user's agent permissions.
 *
 * - always_on: always true (view_node, search)
 * - on_by_default: checks can_write
 * - off_by_default: checks can_delete or can_bulk_operations
 *
 * @param tool - ATSS tool name to check
 * @param permissions - User's current agent permissions
 * @returns true if the tool is allowed
 */
declare function isToolAllowedByPermissions(tool: AtssToolName, permissions: NeasAgentPermissions): boolean;
/**
 * Gets the effective confirmation level by combining NEAS permissions with ATSS confirmation.
 *
 * Two-layer check:
 * 1. NEAS: Is this category of operation allowed?
 * 2. ATSS: What confirmation level does the specific tool require?
 *
 * If confirm_destructive is true and the tool is destructive, upgrades to 'confirm'.
 *
 * @param tool - ATSS tool name
 * @param permissions - User's agent permissions
 * @param defaults - User's agent defaults
 * @param _params - Tool parameters (reserved for future confirmation upgrades)
 * @returns Combined permission check result
 */
declare function getEffectiveConfirmationLevel(tool: AtssToolName, permissions: NeasAgentPermissions, defaults: NeasAgentDefaults, _params: Record<string, unknown>): NeasPermissionCheckResult;
/**
 * Creates a new agent session for tracking operations within a request.
 * Session ID format: "ses_" + nanoid(12)
 *
 * @param userId - ID of the user making the request
 * @returns Fresh agent session
 */
declare function createAgentSession(userId: string): NeasAgentSession;
/**
 * Records a tool operation in the session (immutable — returns new session).
 *
 * @param session - Current session state
 * @param tool - ATSS tool that was executed
 * @param creditCost - Credit cost of the operation
 * @param undoEntryId - ATSS undo entry ID (null for read operations)
 * @returns New session with the operation recorded
 */
declare function recordSessionOperation(session: NeasAgentSession, tool: AtssToolName, creditCost: number, undoEntryId: string | null): NeasAgentSession;
/**
 * Checks whether an operation can proceed within the session's limits.
 *
 * @param session - Current session state
 * @param limits - Agent limits configuration
 * @param creditCost - Credit cost of the proposed operation
 * @returns Whether the operation is allowed + remaining capacity
 */
declare function canPerformOperation(session: NeasAgentSession, limits: NeasAgentLimits, creditCost: number): NeasOperationCheck;
/**
 * Generates a summary of a completed session.
 *
 * @param session - The session to summarize
 * @returns Session summary statistics
 */
declare function getSessionSummary(session: NeasAgentSession): NeasSessionSummary;
/**
 * Returns the list of tools available based on online/offline state.
 *
 * @param isOnline - Whether the device has network connectivity
 * @returns Array of available tool names
 */
declare function getAvailableTools(isOnline: boolean): readonly AtssToolName[];
/**
 * Checks whether a specific tool is available offline.
 *
 * @param tool - ATSS tool name to check
 * @returns true if the tool works offline
 */
declare function isToolAvailableOffline(tool: AtssToolName): boolean;
/**
 * Returns the full offline capabilities description.
 */
declare function getOfflineCapabilities(): NeasOfflineCapabilities;
/**
 * Creates a new suggestion configuration with defaults.
 * Default: suggestions OFF, max 1/day, 90% confidence, quiet 22:00-08:00.
 */
declare function createDefaultSuggestionConfig(): NeasSuggestionConfig;
/**
 * Determines whether a proactive suggestion should be shown.
 *
 * All conditions must pass:
 * 1. Mode is not 'off'
 * 2. Confidence meets threshold (for 'important_only' mode)
 * 3. Not in quiet hours
 * 4. Daily limit not reached
 *
 * @param config - Suggestion configuration
 * @param lastSuggestionAt - ISO 8601 timestamp of last suggestion (null if never)
 * @param confidence - Confidence score (0.0-1.0)
 * @param currentHour - Current hour of day (0-23)
 * @returns true if the suggestion should be displayed
 */
declare function shouldShowSuggestion(config: NeasSuggestionConfig, lastSuggestionAt: string | null, confidence: number, currentHour: number): boolean;
/**
 * Checks whether the current time falls within quiet hours.
 * Handles wraparound (e.g., 22:00-08:00 wraps past midnight).
 *
 * @param currentHour - Current hour (0-23)
 * @param quietStart - Start of quiet period (0-23)
 * @param quietEnd - End of quiet period (0-23)
 * @returns true if the current hour is within quiet hours
 */
declare function isInQuietHours(currentHour: number, quietStart: number, quietEnd: number): boolean;
/**
 * Checks whether more suggestions can be shown today.
 *
 * @param lastSuggestionAt - ISO 8601 timestamp of last suggestion (null if never)
 * @param maxPerDay - Maximum suggestions allowed per day
 * @param today - Today's date string (YYYY-MM-DD)
 * @returns true if more suggestions are allowed today
 */
declare function canSuggestToday(lastSuggestionAt: string | null, maxPerDay: number, today: string): boolean;

export { AtssConfirmationLevel, AtssToolName, NEAS_ATSS_ERROR_MAPPING, NEAS_CERTAINTY_LEVELS, NEAS_CLARIFICATION_ACTIONS, NEAS_CLARIFICATION_MATRIX, NEAS_DEFAULT_AGENT_DEFAULTS, NEAS_DEFAULT_AGENT_LIMITS, NEAS_DEFAULT_AGENT_PERMISSIONS, NEAS_DEFAULT_SUGGESTION_CONFIG, NEAS_ERROR_EXPLANATIONS, NEAS_ERROR_TYPES, NEAS_FIX_STRATEGIES, NEAS_HIGH_IMPACT_CREDIT_THRESHOLD, NEAS_IMPACT_LEVELS, NEAS_OFFLINE_AVAILABLE_TOOLS, NEAS_ONLINE_ONLY_TOOLS, NEAS_PERMISSION_TIERS, NEAS_RECOVERY_SUGGESTIONS, NEAS_RESPONSE_VERBOSITY_LEVELS, NEAS_SEARCH_SCOPES, NEAS_SESSION_ID_PREFIX, NEAS_SUGGESTION_MODES, NEAS_TOOL_PERMISSION_TIER, NEAS_UNCERTAINTY_RESPONSES, type NeasAgentDefaults, NeasAgentDefaultsSchema, type NeasAgentError, NeasAgentErrorSchema, type NeasAgentLimits, NeasAgentLimitsSchema, type NeasAgentPermissions, NeasAgentPermissionsSchema, type NeasAgentSession, NeasAgentSessionSchema, type NeasCertaintyFactors, NeasCertaintyFactorsSchema, type NeasCertaintyLevel, NeasCertaintyLevelSchema, type NeasClarificationAction, NeasClarificationActionSchema, type NeasErrorExplanation, NeasErrorExplanationSchema, type NeasErrorType, NeasErrorTypeSchema, type NeasFixStrategyConfig, NeasFixStrategyConfigSchema, type NeasImpactFactors, NeasImpactFactorsSchema, type NeasImpactLevel, NeasImpactLevelSchema, type NeasIntentAssessment, NeasIntentAssessmentSchema, type NeasOfflineCapabilities, NeasOfflineCapabilitiesSchema, type NeasOperationCheck, NeasOperationCheckSchema, type NeasPermissionCheckResult, NeasPermissionCheckResultSchema, type NeasPermissionTier, NeasPermissionTierSchema, type NeasResponseVerbosity, NeasResponseVerbositySchema, type NeasSearchScope, NeasSearchScopeSchema, type NeasSessionAction, NeasSessionActionSchema, type NeasSessionSummary, NeasSessionSummarySchema, type NeasSuggestionConfig, NeasSuggestionConfigSchema, type NeasSuggestionMode, NeasSuggestionModeSchema, type NeasToolCall, NeasToolCallSchema, type NeasUncertaintyResponse, NeasUncertaintyResponseSchema, assessCertainty, assessImpact, assessIntent, canPerformOperation, canSuggestToday, classifyAgentError, createAgentSession, createDefaultAgentDefaults, createDefaultAgentLimits, createDefaultAgentPermissions, createDefaultSuggestionConfig, createErrorExplanation, determineAction, generateRecoverySuggestion, generateSessionId, generateUserExplanation, getAvailableTools, getEffectiveConfirmationLevel, getFixStrategy, getOfflineCapabilities, getSessionSummary, isAutoRetryable, isInQuietHours, isNeasCertaintyLevel, isNeasClarificationAction, isNeasErrorType, isNeasImpactLevel, isNeasPermissionTier, isNeasResponseVerbosity, isNeasSuggestionMode, isToolAllowedByPermissions, isToolAvailableOffline, mapAtssErrorToAgentError, mergeAgentDefaults, recordSessionOperation, shouldActThenClarify, shouldClarifyFirst, shouldShowSuggestion };
