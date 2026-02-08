/**
 * @module @nous/core/agent-tools
 * @description Agent Tool Specification System (ATSS) - 9 tools for AI agent graph manipulation
 * @version 1.0.0
 * @spec Specs/Phase-9-Agent-Tools/storm-030
 * @storm Brainstorms/Infrastructure/storm-030-agent-tool-specs
 *
 * Provides:
 * - 9 tool schemas (view_node, search, create_node, update_node, delete_node,
 *   create_edge, delete_edge, link_to_cluster, bulk_operations)
 * - Undo system with tiered TTLs and dependency tracking
 * - Permission model with 3 confirmation levels
 * - Circuit breaker and rate limiting
 * - 26 standardized error codes
 */

import { nanoid } from 'nanoid';
import { NANOID_LENGTH } from '../constants';

// Re-export all constants and types
export * from './constants';
export * from './types';

// Import needed for function implementations
import {
  type AtssToolName,
  type AtssConfirmationLevel,
  type AtssErrorCode,
  ATSS_TRANSACTION_ID_PREFIX,
  ATSS_UNDO_ID_PREFIX,
  ATSS_TOOL_NAMES,
  ATSS_TOOL_TO_CATEGORY,
  ATSS_TOOL_CONFIRMATION,
  ATSS_CREDIT_COSTS,
  ATSS_UNDO_TTL_SECONDS,
  ATSS_QUICK_UNDO_SECONDS,
  ATSS_RATE_LIMITS,
  ATSS_TOOL_DESCRIPTIONS,
  ATSS_INVERSE_OPERATIONS,
  ATSS_ERROR_CODES,
  ATSS_RETRYABLE_ERROR_CODES,
  ATSS_CIRCUIT_BREAKER_MAX_FAILURES,
  ATSS_UPDATE_CONFIDENCE_THRESHOLD,
  ATSS_SYNTHESIZE_FORMATS,
} from './constants';

import {
  type AtssToolDefinition,
  type AtssUndoEntry,
  type AtssCircuitBreaker,
  type AtssRateLimitState,
  type AtssDryRunResult,
  type AtssErrorResponse,
  type AtssBulkOperationItem,
} from './types';

// ============================================================
// ID GENERATION
// ============================================================

/**
 * Generates a globally unique transaction ID.
 * Format: "tx_" + 12-character nanoid
 */
export function generateTransactionId(): string {
  return ATSS_TRANSACTION_ID_PREFIX + nanoid(NANOID_LENGTH);
}

/**
 * Generates a globally unique undo entry ID.
 * Format: "undo_" + 12-character nanoid
 */
export function generateUndoId(): string {
  return ATSS_UNDO_ID_PREFIX + nanoid(NANOID_LENGTH);
}

// ============================================================
// TOOL DEFINITION LOOKUP
// ============================================================

/**
 * Complete tool definitions aggregating all per-tool configuration.
 */
export const ATSS_TOOL_DEFINITIONS: Record<AtssToolName, AtssToolDefinition> = Object.fromEntries(
  ATSS_TOOL_NAMES.map((name) => [
    name,
    {
      name,
      category: ATSS_TOOL_TO_CATEGORY[name],
      description: ATSS_TOOL_DESCRIPTIONS[name],
      confirmation: ATSS_TOOL_CONFIRMATION[name],
      credit_cost: ATSS_CREDIT_COSTS[name],
      undo_ttl_seconds: ATSS_UNDO_TTL_SECONDS[name],
      rate_limit: ATSS_RATE_LIMITS[name],
      synthesize_format: ATSS_SYNTHESIZE_FORMATS[name],
    } satisfies AtssToolDefinition,
  ])
) as Record<AtssToolName, AtssToolDefinition>;

/**
 * Get the complete definition for a tool by name.
 */
export function getToolDefinition(name: AtssToolName): AtssToolDefinition {
  return ATSS_TOOL_DEFINITIONS[name];
}

// ============================================================
// UNDO SYSTEM FUNCTIONS
// ============================================================

/**
 * Builds inverse parameters for an undo operation.
 * Each tool type has specific inverse logic.
 */
export function buildInverseParams(
  tool: AtssToolName,
  params: Record<string, unknown>,
  result: Record<string, unknown>,
): Record<string, unknown> {
  switch (tool) {
    case 'create_node':
      return { node_id: result['node_id'] as string, cascade_edges: true };
    case 'update_node':
      return {
        node_id: params['node_id'] as string,
        changes: result['previous_values'] as Record<string, unknown>,
      };
    case 'delete_node':
      return { ...params, restore: true, node_id: params['node_id'] as string };
    case 'create_edge':
      return { edge_id: result['edge_id'] as string };
    case 'delete_edge':
      return { ...params };
    case 'link_to_cluster':
      return {
        node_id: params['node_id'] as string,
        cluster_id: result['previous_cluster'] as string,
      };
    case 'bulk_operations':
      return { inverse_of_bulk: true, original_params: params };
    default:
      return {};
  }
}

/**
 * Creates a new undo entry for a completed tool operation.
 * Returns null if the tool is not undoable.
 */
export function createUndoEntry(
  tool: AtssToolName,
  params: Record<string, unknown>,
  result: Record<string, unknown>,
  userId: string,
  sessionId: string,
): AtssUndoEntry | null {
  const inverseTool = ATSS_INVERSE_OPERATIONS[tool];
  if (inverseTool === null) {
    return null;
  }

  const ttlSeconds = ATSS_UNDO_TTL_SECONDS[tool] ?? 0;
  if (ttlSeconds === 0) {
    return null;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const quickUndoUntil = new Date(now.getTime() + ATSS_QUICK_UNDO_SECONDS * 1000);
  const creditCost = ATSS_CREDIT_COSTS[tool] ?? 0;

  const inverseParams = buildInverseParams(tool, params, result);

  return {
    id: generateUndoId(),
    _schemaVersion: 1,
    timestamp: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    quick_undo_until: quickUndoUntil.toISOString(),
    tool,
    params,
    result,
    inverse_tool: inverseTool,
    inverse_params: inverseParams,
    status: 'undoable',
    depends_on: [],
    enables: [],
    user_id: userId,
    session_id: sessionId,
    credit_cost: creditCost,
  };
}

/**
 * Checks whether an undo entry can still be undone.
 */
export function isUndoable(entry: AtssUndoEntry): boolean {
  if (entry.status !== 'undoable') {
    return false;
  }
  const now = new Date();
  const expiresAt = new Date(entry.expires_at);
  return now < expiresAt;
}

/**
 * Checks whether an undo entry is within the quick undo window (5 min).
 */
export function isQuickUndoWindow(entry: AtssUndoEntry): boolean {
  const now = new Date();
  const quickUntil = new Date(entry.quick_undo_until);
  return now < quickUntil && entry.status === 'undoable';
}

/**
 * Gets the inverse operation for an undo entry.
 * Returns null for read-only tools.
 */
export function getInverseOperation(
  entry: AtssUndoEntry,
): { tool: AtssToolName; params: Record<string, unknown> } | null {
  const inverseTool = ATSS_INVERSE_OPERATIONS[entry.tool];
  if (inverseTool === null) {
    return null;
  }
  return {
    tool: inverseTool,
    params: entry.inverse_params,
  };
}

/**
 * Checks whether an undo entry can be undone given dependency graph.
 * An entry cannot be undone if other non-undone entries depend on it.
 */
export function checkDependencies(
  entry: AtssUndoEntry,
  allEntries: AtssUndoEntry[],
): { canUndo: boolean; blockedBy: string[] } {
  const blockedBy: string[] = [];

  for (const other of allEntries) {
    if (other.depends_on.includes(entry.id) && other.status === 'undoable') {
      blockedBy.push(other.id);
    }
  }

  return {
    canUndo: blockedBy.length === 0,
    blockedBy,
  };
}

// ============================================================
// PERMISSION & CONFIRMATION FUNCTIONS
// ============================================================

/**
 * Determines the confirmation level for a tool execution.
 * May upgrade update_node to 'confirm' if confidence is below threshold.
 */
export function getConfirmationLevel(
  tool: AtssToolName,
  params: Record<string, unknown>,
): AtssConfirmationLevel {
  const baseLevel = ATSS_TOOL_CONFIRMATION[tool];

  if (tool === 'update_node') {
    const confidence = typeof params['confidence'] === 'number'
      ? params['confidence']
      : 1.0;
    if (confidence < ATSS_UPDATE_CONFIDENCE_THRESHOLD) {
      return 'confirm';
    }
  }

  return baseLevel;
}

/**
 * Checks whether a user has enough credits for an operation.
 */
export function checkCreditSufficiency(
  cost: number,
  balance: number,
): { sufficient: boolean; shortfall: number } {
  const shortfall = Math.max(0, cost - balance);
  return {
    sufficient: cost <= balance,
    shortfall,
  };
}

/**
 * Calculates the total credit cost of a bulk operation.
 */
export function calculateBulkCost(operations: AtssBulkOperationItem[]): number {
  let total = 0;
  for (const op of operations) {
    const cost = ATSS_CREDIT_COSTS[op.tool] ?? 0;
    total += cost;
  }
  return total;
}

/**
 * Determines whether a tool execution requires user confirmation.
 */
export function shouldRequireConfirmation(
  tool: AtssToolName,
  params: Record<string, unknown>,
): boolean {
  const level = getConfirmationLevel(tool, params);
  return level === 'confirm';
}

// ============================================================
// CIRCUIT BREAKER FUNCTIONS
// ============================================================

/**
 * Creates a new circuit breaker in the closed (normal) state.
 */
export function createCircuitBreaker(): AtssCircuitBreaker {
  return {
    state: 'closed',
    consecutive_failures: 0,
  };
}

/**
 * Trips the circuit breaker to the open state.
 */
export function tripCircuitBreaker(breaker: AtssCircuitBreaker): AtssCircuitBreaker {
  return {
    ...breaker,
    state: 'open',
    tripped_at: new Date().toISOString(),
  };
}

/**
 * Resets the circuit breaker to closed state.
 */
export function resetCircuitBreaker(breaker: AtssCircuitBreaker): AtssCircuitBreaker {
  return {
    ...breaker,
    state: 'closed',
    consecutive_failures: 0,
    tripped_at: undefined,
  };
}

/**
 * Records a successful tool execution. Resets failure counter.
 * Named atssRecordSuccess to avoid conflict with embeddings module.
 */
export function atssRecordSuccess(breaker: AtssCircuitBreaker): AtssCircuitBreaker {
  return {
    ...breaker,
    state: 'closed',
    consecutive_failures: 0,
    last_success_at: new Date().toISOString(),
    tripped_at: undefined,
  };
}

/**
 * Records a failed tool execution. Trips breaker at threshold.
 * Named atssRecordFailure to avoid conflict with embeddings module.
 */
export function atssRecordFailure(breaker: AtssCircuitBreaker): AtssCircuitBreaker {
  const newFailures = breaker.consecutive_failures + 1;
  const now = new Date().toISOString();

  if (newFailures >= ATSS_CIRCUIT_BREAKER_MAX_FAILURES) {
    return {
      ...breaker,
      state: 'open',
      consecutive_failures: newFailures,
      last_failure_at: now,
      tripped_at: now,
    };
  }

  return {
    ...breaker,
    consecutive_failures: newFailures,
    last_failure_at: now,
  };
}

/**
 * Checks whether a request should be allowed through the circuit breaker.
 */
export function shouldAllowRequest(breaker: AtssCircuitBreaker): boolean {
  switch (breaker.state) {
    case 'closed':
      return true;
    case 'open':
      return false;
    case 'half_open':
      return true;
    default:
      return false;
  }
}

// ============================================================
// RATE LIMITING FUNCTIONS
// ============================================================

/**
 * Checks whether a request is within rate limits for a given tool.
 */
export function checkRateLimit(
  state: AtssRateLimitState,
  tool: AtssToolName,
): { allowed: boolean; retry_after_ms?: number } {
  const limits = ATSS_RATE_LIMITS[tool];
  if (!limits) {
    return { allowed: true };
  }

  const now = Date.now();
  const windowStart = new Date(state.window_start).getTime();
  const windowMs = 1000;

  if (now - windowStart >= windowMs) {
    return { allowed: true };
  }

  if (state.request_count >= limits.perSecond) {
    if (state.burst_count >= limits.burst) {
      const retryAfterMs = windowMs - (now - windowStart);
      return { allowed: false, retry_after_ms: retryAfterMs };
    }
  }

  return { allowed: true };
}

/**
 * Records a request against the rate limit state.
 */
export function recordRateLimitRequest(state: AtssRateLimitState): AtssRateLimitState {
  const now = new Date();
  const windowStart = new Date(state.window_start);
  const windowMs = 1000;

  if (now.getTime() - windowStart.getTime() >= windowMs) {
    return {
      ...state,
      window_start: now.toISOString(),
      request_count: 1,
      burst_count: 0,
    };
  }

  const limits = ATSS_RATE_LIMITS[state.tool];
  const newCount = state.request_count + 1;

  return {
    ...state,
    request_count: newCount,
    burst_count: limits && newCount > limits.perSecond
      ? state.burst_count + 1
      : state.burst_count,
  };
}

// ============================================================
// DRY RUN FUNCTION
// ============================================================

/**
 * Executes a dry run of a tool operation.
 * Previews what would happen without making changes.
 */
export function executeDryRun(
  tool: AtssToolName,
  params: Record<string, unknown>,
): AtssDryRunResult {
  const creditCost = ATSS_CREDIT_COSTS[tool] ?? 0;
  const confirmationLevel = getConfirmationLevel(tool, params);
  const sideEffects: string[] = [];
  const warnings: string[] = [];

  if (tool === 'update_node') {
    const confidence = typeof params['confidence'] === 'number'
      ? params['confidence']
      : 1.0;
    if (confidence < ATSS_UPDATE_CONFIDENCE_THRESHOLD) {
      warnings.push(`Low confidence (${confidence}) - confirmation required`);
    }
  }

  switch (tool) {
    case 'create_node':
      sideEffects.push('New node will be created in knowledge graph');
      sideEffects.push('Cluster auto-assignment may occur');
      sideEffects.push('Similar nodes will be checked for deduplication');
      break;
    case 'update_node':
      sideEffects.push('Node content/metadata will be modified');
      sideEffects.push('Previous values stored for undo');
      break;
    case 'delete_node':
      sideEffects.push('Node will be soft-deleted (restorable)');
      if (params['cascade_edges'] !== false) {
        sideEffects.push('Connected edges will be removed');
      }
      break;
    case 'create_edge':
      sideEffects.push('New edge will connect two nodes');
      if (params['bidirectional'] === true) {
        sideEffects.push('Reverse edge will also be created');
      }
      break;
    case 'delete_edge':
      sideEffects.push('Edge will be removed from the graph');
      break;
    case 'link_to_cluster':
      sideEffects.push('Node primary cluster affinity will change');
      if (params['create_if_missing'] === true) {
        sideEffects.push('New cluster may be created');
      }
      break;
    case 'bulk_operations':
      sideEffects.push('Multiple operations will execute in sequence');
      break;
  }

  return {
    would_succeed: true,
    credits_required: creditCost,
    confirmation_required: confirmationLevel,
    side_effects: sideEffects,
    warnings,
  };
}

// ============================================================
// ERROR FACTORY FUNCTIONS
// ============================================================

/**
 * Creates a standardized error response.
 */
export function createErrorResponse(
  code: AtssErrorCode,
  tool?: AtssToolName,
  details?: Record<string, unknown>,
): AtssErrorResponse {
  const errorDef = ATSS_ERROR_CODES[code];
  return {
    error: true,
    code: errorDef.code,
    message: errorDef.message,
    details,
    tool,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Gets the HTTP status code for an error code.
 */
export function getHttpStatus(code: AtssErrorCode): number {
  return ATSS_ERROR_CODES[code].http;
}

/**
 * Determines whether an error is retryable.
 */
export function isRetryable(code: AtssErrorCode): boolean {
  return ATSS_RETRYABLE_ERROR_CODES.includes(code);
}
