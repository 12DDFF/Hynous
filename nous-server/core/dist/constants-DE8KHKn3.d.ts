import { z } from 'zod';

/**
 * @module @nous/core/agent-tools
 * @description All constants, enums, and configuration values for ATSS (Agent Tool Specification System)
 * @version 1.0.0
 * @spec Specs/Phase-9-Agent-Tools/storm-030
 * @storm Brainstorms/Infrastructure/storm-030-agent-tool-specs
 *
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for storm-030 constants.
 * Uses ATSS_ prefix on all constants to avoid naming conflicts.
 */

/**
 * All 9 agent tools in the system.
 * These are the operations an AI agent can perform on the knowledge graph.
 */
declare const ATSS_TOOL_NAMES: readonly ["view_node", "search", "create_node", "update_node", "delete_node", "create_edge", "delete_edge", "link_to_cluster", "bulk_operations"];
type AtssToolName = (typeof ATSS_TOOL_NAMES)[number];
declare const AtssToolNameSchema: z.ZodEnum<["view_node", "search", "create_node", "update_node", "delete_node", "create_edge", "delete_edge", "link_to_cluster", "bulk_operations"]>;
/**
 * Tool operation categories.
 * - read: No state change, no confirmation needed
 * - write: Creates or modifies state, may need confirmation
 * - destructive: Deletes state, requires confirmation
 */
declare const ATSS_TOOL_CATEGORIES: readonly ["read", "write", "destructive"];
type AtssToolCategory = (typeof ATSS_TOOL_CATEGORIES)[number];
declare const AtssToolCategorySchema: z.ZodEnum<["read", "write", "destructive"]>;
/** Maps each tool to its category. */
declare const ATSS_TOOL_TO_CATEGORY: Record<AtssToolName, AtssToolCategory>;
/**
 * Confirmation levels for tool execution.
 * - none: Execute silently (read operations)
 * - inform: Tell user what happened (creates)
 * - confirm: Ask user before executing (modifies/deletes)
 */
declare const ATSS_CONFIRMATION_LEVELS: readonly ["none", "inform", "confirm"];
type AtssConfirmationLevel = (typeof ATSS_CONFIRMATION_LEVELS)[number];
declare const AtssConfirmationLevelSchema: z.ZodEnum<["none", "inform", "confirm"]>;
/** Default confirmation level per tool. */
declare const ATSS_TOOL_CONFIRMATION: Record<AtssToolName, AtssConfirmationLevel>;
/**
 * Undo window TTL per tool (in seconds).
 * 0 means the tool is not undoable (read operations).
 */
declare const ATSS_UNDO_TTL_SECONDS: Record<AtssToolName, number>;
/** Quick undo UI highlight window (seconds). */
declare const ATSS_QUICK_UNDO_SECONDS = 300;
declare const ATSS_UNDO_STATUSES: readonly ["undoable", "undone", "expired", "redone"];
type AtssUndoStatus = (typeof ATSS_UNDO_STATUSES)[number];
declare const AtssUndoStatusSchema: z.ZodEnum<["undoable", "undone", "expired", "redone"]>;
/**
 * Credit cost per tool execution.
 * Read operations are free. bulk_operations cost = sum of individual ops (0 base).
 *
 * @see Brainstorms/Infrastructure/storm-013-business-model (brainstorm only)
 */
declare const ATSS_CREDIT_COSTS: Record<AtssToolName, number>;
/**
 * User subscription tiers.
 *
 * @see Brainstorms/Infrastructure/storm-013-business-model (brainstorm only)
 */
declare const ATSS_TIERS: readonly ["free", "credits", "pro"];
type AtssTier = (typeof ATSS_TIERS)[number];
declare const AtssTierSchema: z.ZodEnum<["free", "credits", "pro"]>;
/** Per-tool rate limit: sustained per-second rate + burst allowance. */
declare const ATSS_RATE_LIMITS: Record<AtssToolName, {
    perSecond: number;
    burst: number;
}>;
/** Maximum consecutive failures before the circuit breaker trips. */
declare const ATSS_CIRCUIT_BREAKER_MAX_FAILURES = 3;
/** Maximum time for a single tool execution (milliseconds). */
declare const ATSS_TOOL_TIMEOUT_MS = 10000;
/** Circuit breaker states. */
declare const ATSS_CIRCUIT_BREAKER_STATES: readonly ["closed", "open", "half_open"];
type AtssCircuitBreakerState = (typeof ATSS_CIRCUIT_BREAKER_STATES)[number];
declare const AtssCircuitBreakerStateSchema: z.ZodEnum<["closed", "open", "half_open"]>;
declare const ATSS_BULK_MODES: readonly ["all_or_nothing", "continue_on_error"];
type AtssBulkMode = (typeof ATSS_BULK_MODES)[number];
declare const AtssBulkModeSchema: z.ZodEnum<["all_or_nothing", "continue_on_error"]>;
declare const ATSS_ERROR_PREFIXES: readonly ["E400", "E403", "E404", "E409", "E429", "E500", "E503", "E504"];
type AtssErrorPrefix = (typeof ATSS_ERROR_PREFIXES)[number];
/** One-line description of each tool. Used by P-009 agent prompt. */
declare const ATSS_TOOL_DESCRIPTIONS: Record<AtssToolName, string>;
declare const ATSS_MAX_NODE_IDS_PER_VIEW = 20;
declare const ATSS_MAX_SEARCH_LIMIT = 50;
declare const ATSS_DEFAULT_SEARCH_LIMIT = 10;
declare const ATSS_MAX_CONTENT_LENGTH = 5000;
declare const ATSS_DEFAULT_MAX_CONTENT_LENGTH = 2000;
declare const ATSS_MAX_TAGS = 20;
declare const ATSS_MAX_BULK_OPERATIONS = 50;
declare const ATSS_MIN_SEARCH_SCORE = 0;
declare const ATSS_DEFAULT_MIN_SEARCH_SCORE = 0.3;
declare const ATSS_UPDATE_CONFIDENCE_THRESHOLD = 0.8;
declare const ATSS_TRANSACTION_ID_PREFIX = "tx_";
declare const ATSS_UNDO_ID_PREFIX = "undo_";
/** Reference syntax patterns for cross-referencing within bulk operations. */
declare const ATSS_BULK_REFERENCE_PATTERNS: {
    readonly byIndex: RegExp;
    readonly byId: RegExp;
    readonly byLast: RegExp;
};
/**
 * Maps each tool to its inverse tool.
 * null means the tool is not undoable (read operations).
 */
declare const ATSS_INVERSE_OPERATIONS: Record<AtssToolName, AtssToolName | null>;
/** Error code definition structure. */
interface AtssErrorDefinition {
    code: string;
    http: number;
    message: string;
}
/** All 26 ATSS error codes. */
declare const ATSS_ERROR_CODES: {
    readonly E400_INVALID_PARAMS: {
        readonly code: "E400_INVALID_PARAMS";
        readonly http: 400;
        readonly message: "Invalid parameters provided";
    };
    readonly E400_MISSING_REQUIRED: {
        readonly code: "E400_MISSING_REQUIRED";
        readonly http: 400;
        readonly message: "Required parameter missing";
    };
    readonly E400_INVALID_NODE_TYPE: {
        readonly code: "E400_INVALID_NODE_TYPE";
        readonly http: 400;
        readonly message: "Invalid node type";
    };
    readonly E400_INVALID_EDGE_TYPE: {
        readonly code: "E400_INVALID_EDGE_TYPE";
        readonly http: 400;
        readonly message: "Invalid edge type";
    };
    readonly E400_CONTENT_TOO_LONG: {
        readonly code: "E400_CONTENT_TOO_LONG";
        readonly http: 400;
        readonly message: "Content exceeds maximum length";
    };
    readonly E400_TOO_MANY_TAGS: {
        readonly code: "E400_TOO_MANY_TAGS";
        readonly http: 400;
        readonly message: "Too many tags";
    };
    readonly E400_TOO_MANY_NODE_IDS: {
        readonly code: "E400_TOO_MANY_NODE_IDS";
        readonly http: 400;
        readonly message: "Too many node IDs in single request";
    };
    readonly E400_TOO_MANY_BULK_OPS: {
        readonly code: "E400_TOO_MANY_BULK_OPS";
        readonly http: 400;
        readonly message: "Too many operations in bulk request";
    };
    readonly E400_INVALID_BULK_REFERENCE: {
        readonly code: "E400_INVALID_BULK_REFERENCE";
        readonly http: 400;
        readonly message: "Invalid bulk operation reference syntax";
    };
    readonly E400_SELF_EDGE: {
        readonly code: "E400_SELF_EDGE";
        readonly http: 400;
        readonly message: "Cannot create edge from node to itself";
    };
    readonly E403_INSUFFICIENT_CREDITS: {
        readonly code: "E403_INSUFFICIENT_CREDITS";
        readonly http: 403;
        readonly message: "Insufficient credits";
    };
    readonly E403_TIER_RESTRICTED: {
        readonly code: "E403_TIER_RESTRICTED";
        readonly http: 403;
        readonly message: "Operation not available on current tier";
    };
    readonly E403_CONFIRMATION_DENIED: {
        readonly code: "E403_CONFIRMATION_DENIED";
        readonly http: 403;
        readonly message: "User denied confirmation";
    };
    readonly E403_CIRCUIT_BREAKER_OPEN: {
        readonly code: "E403_CIRCUIT_BREAKER_OPEN";
        readonly http: 403;
        readonly message: "Circuit breaker is open - too many failures";
    };
    readonly E404_NODE_NOT_FOUND: {
        readonly code: "E404_NODE_NOT_FOUND";
        readonly http: 404;
        readonly message: "Node not found";
    };
    readonly E404_EDGE_NOT_FOUND: {
        readonly code: "E404_EDGE_NOT_FOUND";
        readonly http: 404;
        readonly message: "Edge not found";
    };
    readonly E404_CLUSTER_NOT_FOUND: {
        readonly code: "E404_CLUSTER_NOT_FOUND";
        readonly http: 404;
        readonly message: "Cluster not found";
    };
    readonly E404_UNDO_ENTRY_NOT_FOUND: {
        readonly code: "E404_UNDO_ENTRY_NOT_FOUND";
        readonly http: 404;
        readonly message: "Undo entry not found";
    };
    readonly E409_DUPLICATE_EDGE: {
        readonly code: "E409_DUPLICATE_EDGE";
        readonly http: 409;
        readonly message: "Edge already exists between these nodes";
    };
    readonly E409_UNDO_EXPIRED: {
        readonly code: "E409_UNDO_EXPIRED";
        readonly http: 409;
        readonly message: "Undo window has expired";
    };
    readonly E409_UNDO_DEPENDENCY: {
        readonly code: "E409_UNDO_DEPENDENCY";
        readonly http: 409;
        readonly message: "Cannot undo - dependent operations exist";
    };
    readonly E409_ALREADY_UNDONE: {
        readonly code: "E409_ALREADY_UNDONE";
        readonly http: 409;
        readonly message: "Operation already undone";
    };
    readonly E429_RATE_LIMITED: {
        readonly code: "E429_RATE_LIMITED";
        readonly http: 429;
        readonly message: "Rate limit exceeded";
    };
    readonly E500_INTERNAL: {
        readonly code: "E500_INTERNAL";
        readonly http: 500;
        readonly message: "Internal server error";
    };
    readonly E503_LLM_UNAVAILABLE: {
        readonly code: "E503_LLM_UNAVAILABLE";
        readonly http: 503;
        readonly message: "LLM service unavailable";
    };
    readonly E504_TOOL_TIMEOUT: {
        readonly code: "E504_TOOL_TIMEOUT";
        readonly http: 504;
        readonly message: "Tool execution timed out";
    };
};
type AtssErrorCode = keyof typeof ATSS_ERROR_CODES;
/** All error code keys as an array. */
declare const ATSS_ERROR_CODE_KEYS: AtssErrorCode[];
/** Default tier configurations. */
declare const ATSS_TIER_CONFIGS: Record<AtssTier, {
    is_student: boolean;
    daily_credit_limit?: number;
    can_bulk: boolean;
    max_bulk_operations: number;
}>;
/** Error codes that clients should retry. */
declare const ATSS_RETRYABLE_ERROR_CODES: AtssErrorCode[];
/** Per-tool synthesize format templates for P-007 integration. */
declare const ATSS_SYNTHESIZE_FORMATS: Record<AtssToolName, string>;

export { type AtssToolName as A, ATSS_MAX_SEARCH_LIMIT as B, ATSS_MAX_TAGS as C, ATSS_MIN_SEARCH_SCORE as D, ATSS_QUICK_UNDO_SECONDS as E, ATSS_RATE_LIMITS as F, ATSS_RETRYABLE_ERROR_CODES as G, ATSS_SYNTHESIZE_FORMATS as H, ATSS_TIERS as I, ATSS_TIER_CONFIGS as J, ATSS_TOOL_CATEGORIES as K, ATSS_TOOL_DESCRIPTIONS as L, ATSS_TOOL_TIMEOUT_MS as M, ATSS_TRANSACTION_ID_PREFIX as N, ATSS_UNDO_ID_PREFIX as O, ATSS_UNDO_STATUSES as P, ATSS_UNDO_TTL_SECONDS as Q, ATSS_UPDATE_CONFIDENCE_THRESHOLD as R, AtssBulkModeSchema as S, AtssCircuitBreakerStateSchema as T, AtssConfirmationLevelSchema as U, type AtssErrorDefinition as V, type AtssErrorPrefix as W, AtssTierSchema as X, AtssToolCategorySchema as Y, AtssToolNameSchema as Z, AtssUndoStatusSchema as _, type AtssConfirmationLevel as a, ATSS_TOOL_CONFIRMATION as b, ATSS_TOOL_NAMES as c, ATSS_TOOL_TO_CATEGORY as d, type AtssToolCategory as e, type AtssBulkMode as f, type AtssCircuitBreakerState as g, type AtssUndoStatus as h, type AtssTier as i, type AtssErrorCode as j, ATSS_BULK_MODES as k, ATSS_BULK_REFERENCE_PATTERNS as l, ATSS_CIRCUIT_BREAKER_MAX_FAILURES as m, ATSS_CIRCUIT_BREAKER_STATES as n, ATSS_CONFIRMATION_LEVELS as o, ATSS_CREDIT_COSTS as p, ATSS_DEFAULT_MAX_CONTENT_LENGTH as q, ATSS_DEFAULT_MIN_SEARCH_SCORE as r, ATSS_DEFAULT_SEARCH_LIMIT as s, ATSS_ERROR_CODES as t, ATSS_ERROR_CODE_KEYS as u, ATSS_ERROR_PREFIXES as v, ATSS_INVERSE_OPERATIONS as w, ATSS_MAX_BULK_OPERATIONS as x, ATSS_MAX_CONTENT_LENGTH as y, ATSS_MAX_NODE_IDS_PER_VIEW as z };
