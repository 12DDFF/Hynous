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

import { z } from 'zod';

// ============================================================
// TOOL NAMES
// ============================================================

/**
 * All 9 agent tools in the system.
 * These are the operations an AI agent can perform on the knowledge graph.
 */
export const ATSS_TOOL_NAMES = [
  'view_node',
  'search',
  'create_node',
  'update_node',
  'delete_node',
  'create_edge',
  'delete_edge',
  'link_to_cluster',
  'bulk_operations',
] as const;

export type AtssToolName = (typeof ATSS_TOOL_NAMES)[number];
export const AtssToolNameSchema = z.enum(ATSS_TOOL_NAMES);

// ============================================================
// TOOL CATEGORIES
// ============================================================

/**
 * Tool operation categories.
 * - read: No state change, no confirmation needed
 * - write: Creates or modifies state, may need confirmation
 * - destructive: Deletes state, requires confirmation
 */
export const ATSS_TOOL_CATEGORIES = ['read', 'write', 'destructive'] as const;

export type AtssToolCategory = (typeof ATSS_TOOL_CATEGORIES)[number];
export const AtssToolCategorySchema = z.enum(ATSS_TOOL_CATEGORIES);

/** Maps each tool to its category. */
export const ATSS_TOOL_TO_CATEGORY: Record<AtssToolName, AtssToolCategory> = {
  view_node: 'read',
  search: 'read',
  create_node: 'write',
  update_node: 'write',
  delete_node: 'destructive',
  create_edge: 'write',
  delete_edge: 'write',
  link_to_cluster: 'write',
  bulk_operations: 'destructive',
};

// ============================================================
// CONFIRMATION LEVELS
// ============================================================

/**
 * Confirmation levels for tool execution.
 * - none: Execute silently (read operations)
 * - inform: Tell user what happened (creates)
 * - confirm: Ask user before executing (modifies/deletes)
 */
export const ATSS_CONFIRMATION_LEVELS = ['none', 'inform', 'confirm'] as const;

export type AtssConfirmationLevel = (typeof ATSS_CONFIRMATION_LEVELS)[number];
export const AtssConfirmationLevelSchema = z.enum(ATSS_CONFIRMATION_LEVELS);

/** Default confirmation level per tool. */
export const ATSS_TOOL_CONFIRMATION: Record<AtssToolName, AtssConfirmationLevel> = {
  view_node: 'none',
  search: 'none',
  create_node: 'inform',
  update_node: 'confirm',
  delete_node: 'confirm',
  create_edge: 'inform',
  delete_edge: 'confirm',
  link_to_cluster: 'inform',
  bulk_operations: 'confirm',
};

// ============================================================
// UNDO CONFIGURATION
// ============================================================

/**
 * Undo window TTL per tool (in seconds).
 * 0 means the tool is not undoable (read operations).
 */
export const ATSS_UNDO_TTL_SECONDS: Record<AtssToolName, number> = {
  view_node: 0,
  search: 0,
  create_node: 86400,     // 24 hours
  update_node: 3600,      // 1 hour
  delete_node: 2592000,   // 30 days
  create_edge: 86400,     // 24 hours
  delete_edge: 86400,     // 24 hours
  link_to_cluster: 3600,  // 1 hour
  bulk_operations: 86400, // 24 hours
};

/** Quick undo UI highlight window (seconds). */
export const ATSS_QUICK_UNDO_SECONDS = 300; // 5 minutes

// ============================================================
// UNDO STATUSES
// ============================================================

export const ATSS_UNDO_STATUSES = ['undoable', 'undone', 'expired', 'redone'] as const;

export type AtssUndoStatus = (typeof ATSS_UNDO_STATUSES)[number];
export const AtssUndoStatusSchema = z.enum(ATSS_UNDO_STATUSES);

// ============================================================
// CREDIT COSTS
// ============================================================

/**
 * Credit cost per tool execution.
 * Read operations are free. bulk_operations cost = sum of individual ops (0 base).
 *
 * @see Brainstorms/Infrastructure/storm-013-business-model (brainstorm only)
 */
export const ATSS_CREDIT_COSTS: Record<AtssToolName, number> = {
  view_node: 0,
  search: 0,
  create_node: 3,
  update_node: 3,
  delete_node: 1,
  create_edge: 1,
  delete_edge: 1,
  link_to_cluster: 1,
  bulk_operations: 0,
};

// ============================================================
// TIER SYSTEM
// ============================================================

/**
 * User subscription tiers.
 *
 * @see Brainstorms/Infrastructure/storm-013-business-model (brainstorm only)
 */
export const ATSS_TIERS = ['free', 'credits', 'pro'] as const;

export type AtssTier = (typeof ATSS_TIERS)[number];
export const AtssTierSchema = z.enum(ATSS_TIERS);

// ============================================================
// RATE LIMITS PER TOOL
// ============================================================

/** Per-tool rate limit: sustained per-second rate + burst allowance. */
export const ATSS_RATE_LIMITS: Record<AtssToolName, { perSecond: number; burst: number }> = {
  view_node: { perSecond: 20, burst: 50 },
  search: { perSecond: 5, burst: 10 },
  create_node: { perSecond: 5, burst: 10 },
  update_node: { perSecond: 5, burst: 10 },
  delete_node: { perSecond: 2, burst: 5 },
  create_edge: { perSecond: 10, burst: 20 },
  delete_edge: { perSecond: 5, burst: 10 },
  link_to_cluster: { perSecond: 5, burst: 10 },
  bulk_operations: { perSecond: 1, burst: 3 },
};

// ============================================================
// CIRCUIT BREAKER
// ============================================================

/** Maximum consecutive failures before the circuit breaker trips. */
export const ATSS_CIRCUIT_BREAKER_MAX_FAILURES = 3;

/** Maximum time for a single tool execution (milliseconds). */
export const ATSS_TOOL_TIMEOUT_MS = 10000;

/** Circuit breaker states. */
export const ATSS_CIRCUIT_BREAKER_STATES = ['closed', 'open', 'half_open'] as const;

export type AtssCircuitBreakerState = (typeof ATSS_CIRCUIT_BREAKER_STATES)[number];
export const AtssCircuitBreakerStateSchema = z.enum(ATSS_CIRCUIT_BREAKER_STATES);

// ============================================================
// BULK OPERATION MODES
// ============================================================

export const ATSS_BULK_MODES = ['all_or_nothing', 'continue_on_error'] as const;

export type AtssBulkMode = (typeof ATSS_BULK_MODES)[number];
export const AtssBulkModeSchema = z.enum(ATSS_BULK_MODES);

// ============================================================
// ERROR CODE PREFIXES
// ============================================================

export const ATSS_ERROR_PREFIXES = [
  'E400', 'E403', 'E404', 'E409', 'E429', 'E500', 'E503', 'E504',
] as const;

export type AtssErrorPrefix = (typeof ATSS_ERROR_PREFIXES)[number];

// ============================================================
// TOOL DESCRIPTIONS
// ============================================================

/** One-line description of each tool. Used by P-009 agent prompt. */
export const ATSS_TOOL_DESCRIPTIONS: Record<AtssToolName, string> = {
  view_node: 'View one or more nodes by ID, including content, metadata, and connections',
  search: 'Search the knowledge graph by query with optional filters',
  create_node: 'Create a new node in the knowledge graph',
  update_node: 'Update an existing node\'s title, content, tags, or cluster',
  delete_node: 'Delete a node (soft-delete with restore window)',
  create_edge: 'Create a relationship edge between two nodes',
  delete_edge: 'Delete a relationship edge',
  link_to_cluster: 'Assign a node to a cluster (sets primary affinity)',
  bulk_operations: 'Execute multiple tool operations in a single transaction',
};

// ============================================================
// VALIDATION LIMITS
// ============================================================

export const ATSS_MAX_NODE_IDS_PER_VIEW = 20;
export const ATSS_MAX_SEARCH_LIMIT = 50;
export const ATSS_DEFAULT_SEARCH_LIMIT = 10;
export const ATSS_MAX_CONTENT_LENGTH = 5000;
export const ATSS_DEFAULT_MAX_CONTENT_LENGTH = 2000;
export const ATSS_MAX_TAGS = 20;
export const ATSS_MAX_BULK_OPERATIONS = 50;
export const ATSS_MIN_SEARCH_SCORE = 0.0;
export const ATSS_DEFAULT_MIN_SEARCH_SCORE = 0.3;
export const ATSS_UPDATE_CONFIDENCE_THRESHOLD = 0.8;

// ============================================================
// ID CONFIGURATION
// ============================================================

export const ATSS_TRANSACTION_ID_PREFIX = 'tx_';
export const ATSS_UNDO_ID_PREFIX = 'undo_';

// ============================================================
// BULK REFERENCE PATTERNS
// ============================================================

/** Reference syntax patterns for cross-referencing within bulk operations. */
export const ATSS_BULK_REFERENCE_PATTERNS = {
  byIndex: /^\{\{(\d+)\.(\w+)\}\}$/,
  byId: /^\{\{([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+)\}\}$/,
  byLast: /^\{\{\$last\.(\w+)\}\}$/,
} as const;

// ============================================================
// INVERSE OPERATION MAPPING
// ============================================================

/**
 * Maps each tool to its inverse tool.
 * null means the tool is not undoable (read operations).
 */
export const ATSS_INVERSE_OPERATIONS: Record<AtssToolName, AtssToolName | null> = {
  view_node: null,
  search: null,
  create_node: 'delete_node',
  update_node: 'update_node',
  delete_node: 'create_node',
  create_edge: 'delete_edge',
  delete_edge: 'create_edge',
  link_to_cluster: 'link_to_cluster',
  bulk_operations: 'bulk_operations',
};

// ============================================================
// ERROR CODES
// ============================================================

/** Error code definition structure. */
export interface AtssErrorDefinition {
  code: string;
  http: number;
  message: string;
}

/** All 26 ATSS error codes. */
export const ATSS_ERROR_CODES = {
  // 400 Bad Request
  E400_INVALID_PARAMS: { code: 'E400_INVALID_PARAMS', http: 400, message: 'Invalid parameters provided' },
  E400_MISSING_REQUIRED: { code: 'E400_MISSING_REQUIRED', http: 400, message: 'Required parameter missing' },
  E400_INVALID_NODE_TYPE: { code: 'E400_INVALID_NODE_TYPE', http: 400, message: 'Invalid node type' },
  E400_INVALID_EDGE_TYPE: { code: 'E400_INVALID_EDGE_TYPE', http: 400, message: 'Invalid edge type' },
  E400_CONTENT_TOO_LONG: { code: 'E400_CONTENT_TOO_LONG', http: 400, message: 'Content exceeds maximum length' },
  E400_TOO_MANY_TAGS: { code: 'E400_TOO_MANY_TAGS', http: 400, message: 'Too many tags' },
  E400_TOO_MANY_NODE_IDS: { code: 'E400_TOO_MANY_NODE_IDS', http: 400, message: 'Too many node IDs in single request' },
  E400_TOO_MANY_BULK_OPS: { code: 'E400_TOO_MANY_BULK_OPS', http: 400, message: 'Too many operations in bulk request' },
  E400_INVALID_BULK_REFERENCE: { code: 'E400_INVALID_BULK_REFERENCE', http: 400, message: 'Invalid bulk operation reference syntax' },
  E400_SELF_EDGE: { code: 'E400_SELF_EDGE', http: 400, message: 'Cannot create edge from node to itself' },
  // 403 Forbidden
  E403_INSUFFICIENT_CREDITS: { code: 'E403_INSUFFICIENT_CREDITS', http: 403, message: 'Insufficient credits' },
  E403_TIER_RESTRICTED: { code: 'E403_TIER_RESTRICTED', http: 403, message: 'Operation not available on current tier' },
  E403_CONFIRMATION_DENIED: { code: 'E403_CONFIRMATION_DENIED', http: 403, message: 'User denied confirmation' },
  E403_CIRCUIT_BREAKER_OPEN: { code: 'E403_CIRCUIT_BREAKER_OPEN', http: 403, message: 'Circuit breaker is open - too many failures' },
  // 404 Not Found
  E404_NODE_NOT_FOUND: { code: 'E404_NODE_NOT_FOUND', http: 404, message: 'Node not found' },
  E404_EDGE_NOT_FOUND: { code: 'E404_EDGE_NOT_FOUND', http: 404, message: 'Edge not found' },
  E404_CLUSTER_NOT_FOUND: { code: 'E404_CLUSTER_NOT_FOUND', http: 404, message: 'Cluster not found' },
  E404_UNDO_ENTRY_NOT_FOUND: { code: 'E404_UNDO_ENTRY_NOT_FOUND', http: 404, message: 'Undo entry not found' },
  // 409 Conflict
  E409_DUPLICATE_EDGE: { code: 'E409_DUPLICATE_EDGE', http: 409, message: 'Edge already exists between these nodes' },
  E409_UNDO_EXPIRED: { code: 'E409_UNDO_EXPIRED', http: 409, message: 'Undo window has expired' },
  E409_UNDO_DEPENDENCY: { code: 'E409_UNDO_DEPENDENCY', http: 409, message: 'Cannot undo - dependent operations exist' },
  E409_ALREADY_UNDONE: { code: 'E409_ALREADY_UNDONE', http: 409, message: 'Operation already undone' },
  // 429 Rate Limited
  E429_RATE_LIMITED: { code: 'E429_RATE_LIMITED', http: 429, message: 'Rate limit exceeded' },
  // 500 Internal Server Error
  E500_INTERNAL: { code: 'E500_INTERNAL', http: 500, message: 'Internal server error' },
  // 503 Service Unavailable
  E503_LLM_UNAVAILABLE: { code: 'E503_LLM_UNAVAILABLE', http: 503, message: 'LLM service unavailable' },
  // 504 Timeout
  E504_TOOL_TIMEOUT: { code: 'E504_TOOL_TIMEOUT', http: 504, message: 'Tool execution timed out' },
} as const;

export type AtssErrorCode = keyof typeof ATSS_ERROR_CODES;

/** All error code keys as an array. */
export const ATSS_ERROR_CODE_KEYS = Object.keys(ATSS_ERROR_CODES) as AtssErrorCode[];

// ============================================================
// TIER CONFIGURATIONS
// ============================================================

/** Default tier configurations. */
export const ATSS_TIER_CONFIGS: Record<AtssTier, { is_student: boolean; daily_credit_limit?: number; can_bulk: boolean; max_bulk_operations: number }> = {
  free: { is_student: false, daily_credit_limit: 5, can_bulk: false, max_bulk_operations: 0 },
  credits: { is_student: false, can_bulk: true, max_bulk_operations: ATSS_MAX_BULK_OPERATIONS },
  pro: { is_student: false, can_bulk: true, max_bulk_operations: ATSS_MAX_BULK_OPERATIONS },
};

// ============================================================
// RETRYABLE ERROR CODES
// ============================================================

/** Error codes that clients should retry. */
export const ATSS_RETRYABLE_ERROR_CODES: AtssErrorCode[] = [
  'E429_RATE_LIMITED',
  'E503_LLM_UNAVAILABLE',
  'E504_TOOL_TIMEOUT',
];

// ============================================================
// SYNTHESIZE FORMAT TEMPLATES
// ============================================================

/** Per-tool synthesize format templates for P-007 integration. */
export const ATSS_SYNTHESIZE_FORMATS: Record<AtssToolName, string> = {
  view_node: 'Retrieved {count} node(s): {titles}',
  search: 'Found {total_count} result(s) for "{query}". Top: {top_titles}',
  create_node: 'Created {type} node "{title}" (ID: {node_id})',
  update_node: 'Updated {updated_fields} on node "{title}" (ID: {node_id})',
  delete_node: 'Deleted node "{node_title}" (ID: {node_id}). Restorable until {restore_deadline}. {edges_affected} edge(s) affected.',
  create_edge: 'Created {relation_type} edge: "{source_title}" → "{target_title}"',
  delete_edge: 'Deleted {relation_type} edge between "{source_title}" and "{target_title}"',
  link_to_cluster: 'Moved node "{node_title}" to cluster "{new_cluster}"',
  bulk_operations: 'Executed {success_count}/{total} operation(s). Credits: {total_credits}',
};
