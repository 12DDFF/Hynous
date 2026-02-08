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

import { nanoid } from 'nanoid';
import { NANOID_LENGTH } from '../constants';

// Re-export all constants and types
export * from './constants';
export * from './types';

// Import needed for function implementations
import {
  NEAS_SESSION_ID_PREFIX,
  NEAS_ATSS_ERROR_MAPPING,
  NEAS_FIX_STRATEGIES,
  NEAS_ERROR_EXPLANATIONS,
  NEAS_RECOVERY_SUGGESTIONS,
  NEAS_HIGH_IMPACT_CREDIT_THRESHOLD,
  NEAS_CLARIFICATION_MATRIX,
  NEAS_TOOL_PERMISSION_TIER,
  NEAS_DEFAULT_AGENT_DEFAULTS,
  NEAS_DEFAULT_AGENT_PERMISSIONS,
  NEAS_DEFAULT_AGENT_LIMITS,
  NEAS_DEFAULT_SUGGESTION_CONFIG,
  NEAS_OFFLINE_AVAILABLE_TOOLS,
  ATSS_TOOL_NAMES,
  ATSS_TOOL_TO_CATEGORY,
  ATSS_TOOL_CONFIRMATION,
  type NeasErrorType,
  type NeasCertaintyLevel,
  type NeasImpactLevel,
  type NeasClarificationAction,
  type NeasPermissionTier,
  type NeasFixStrategyConfig,
  type AtssToolName,
  type AtssConfirmationLevel,
} from './constants';

import type {
  NeasToolCall,
  NeasAgentError,
  NeasErrorExplanation,
  NeasCertaintyFactors,
  NeasImpactFactors,
  NeasIntentAssessment,
  NeasAgentDefaults,
  NeasAgentPermissions,
  NeasAgentLimits,
  NeasAgentSession,
  NeasSessionAction,
  NeasOperationCheck,
  NeasSessionSummary,
  NeasOfflineCapabilities,
  NeasSuggestionConfig,
  NeasPermissionCheckResult,
} from './types';

// ============================================================
// SESSION ID GENERATION
// ============================================================

/**
 * Generates a globally unique agent session ID.
 * Format: "ses_" + 12-character nanoid
 *
 * @returns Session ID string (16 characters total)
 */
export function generateSessionId(): string {
  return NEAS_SESSION_ID_PREFIX + nanoid(NANOID_LENGTH);
}

// ============================================================
// ERROR CLASSIFICATION
// ============================================================

/**
 * Classifies an ATSS error code into a high-level agent error type.
 *
 * Maps all 26 ATSS error codes to one of 6 agent error types.
 * Returns 'NETWORK' as fallback for unknown/unmapped codes.
 *
 * @param atssErrorCode - ATSS error code string (e.g., 'E404_NODE_NOT_FOUND')
 * @returns The agent-level error type classification
 */
export function classifyAgentError(atssErrorCode: string): NeasErrorType {
  return NEAS_ATSS_ERROR_MAPPING[atssErrorCode] ?? 'NETWORK';
}

// ============================================================
// ERROR CREATION
// ============================================================

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
export function mapAtssErrorToAgentError(
  atssErrorCode: string,
  message: string,
  originalAction: NeasToolCall,
): NeasAgentError {
  return {
    type: classifyAgentError(atssErrorCode),
    message,
    original_action: originalAction,
    atss_error_code: atssErrorCode,
    recovery_attempted: false,
  };
}

// ============================================================
// FIX STRATEGY
// ============================================================

/**
 * Returns the fix strategy configuration for a given error type.
 *
 * @param errorType - The agent-level error type
 * @returns Fix strategy configuration
 */
export function getFixStrategy(errorType: NeasErrorType): NeasFixStrategyConfig {
  return NEAS_FIX_STRATEGIES[errorType] ?? {
    retry_automatically: false,
    description: 'Unknown error type',
  };
}

/**
 * Checks whether the given error type supports automatic retry.
 * Only CONFLICT and NETWORK are auto-retryable.
 *
 * @param errorType - The agent-level error type
 * @returns true if auto-retry is appropriate
 */
export function isAutoRetryable(errorType: NeasErrorType): boolean {
  return NEAS_FIX_STRATEGIES[errorType]?.retry_automatically ?? false;
}

// ============================================================
// USER-FACING EXPLANATIONS
// ============================================================

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
export function generateUserExplanation(
  error: NeasAgentError,
  context?: Record<string, string>,
): string {
  const template = NEAS_ERROR_EXPLANATIONS[error.type];
  if (!template) {
    return error.message;
  }

  let result = template;
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      result = result.replace(`{${key}}`, value);
    }
  }
  // Replace {suggestion} placeholder with recovery suggestion
  const suggestion = generateRecoverySuggestion(error, context);
  result = result.replace('{suggestion}', suggestion);
  return result;
}

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
export function generateRecoverySuggestion(
  error: NeasAgentError,
  context?: Record<string, string>,
): string {
  const template = NEAS_RECOVERY_SUGGESTIONS[error.type];
  if (!template) {
    return 'Please try again or rephrase your request.';
  }

  let result = template;
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      result = result.replace(`{${key}}`, value);
    }
  }
  return result;
}

/**
 * Creates a complete error explanation combining message and suggestion.
 * Final step of the Interpret → Retry → Explain flow.
 *
 * @param error - The agent error to explain
 * @param context - Optional placeholder values for templates
 * @returns Complete error explanation with message + suggestion
 */
export function createErrorExplanation(
  error: NeasAgentError,
  context?: Record<string, string>,
): NeasErrorExplanation {
  return {
    user_message: generateUserExplanation(error, context),
    suggestion: generateRecoverySuggestion(error, context),
    original_error: error,
  };
}

// ============================================================
// CERTAINTY ASSESSMENT
// ============================================================

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
export function assessCertainty(factors: NeasCertaintyFactors): NeasCertaintyLevel {
  if (factors.has_specific_target && factors.has_clear_action) {
    return 'high';
  }
  if (factors.matches_prior_pattern || factors.unambiguous_scope) {
    return 'medium';
  }
  return 'low';
}

// ============================================================
// IMPACT ASSESSMENT
// ============================================================

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
export function assessImpact(
  factors: NeasImpactFactors,
  creditThreshold?: number,
): NeasImpactLevel {
  const threshold = creditThreshold ?? NEAS_HIGH_IMPACT_CREDIT_THRESHOLD;

  if (factors.is_destructive || factors.affects_many) {
    return 'high';
  }
  if (factors.estimated_cost > threshold) {
    return 'medium';
  }
  return 'low';
}

// ============================================================
// DECISION MATRIX
// ============================================================

/**
 * Looks up the clarification action from the certainty × impact matrix.
 *
 * @param certainty - How certain the agent is about intent
 * @param impact - How much impact the action will have
 * @returns The clarification action to take
 */
export function determineAction(
  certainty: NeasCertaintyLevel,
  impact: NeasImpactLevel,
): NeasClarificationAction {
  const certaintyRow = NEAS_CLARIFICATION_MATRIX[certainty];
  if (!certaintyRow) {
    return 'clarify_first'; // Safe fallback for unknown certainty
  }
  return certaintyRow[impact] ?? 'clarify_first';
}

// ============================================================
// FULL ASSESSMENT
// ============================================================

/**
 * Performs a complete intent assessment combining certainty, impact, and action.
 *
 * @param certaintyFactors - Inputs for certainty evaluation
 * @param impactFactors - Inputs for impact evaluation
 * @returns Complete intent assessment with certainty, impact, and action
 */
export function assessIntent(
  certaintyFactors: NeasCertaintyFactors,
  impactFactors: NeasImpactFactors,
): NeasIntentAssessment {
  const certainty = assessCertainty(certaintyFactors);
  const impact = assessImpact(impactFactors);
  const action = determineAction(certainty, impact);
  return { certainty, impact, action };
}

// ============================================================
// QUICK CHECKS
// ============================================================

/** Returns true if the agent should ask for clarification BEFORE acting. */
export function shouldClarifyFirst(assessment: NeasIntentAssessment): boolean {
  return assessment.action === 'clarify_first';
}

/** Returns true if the agent should act first, then ask if the result is correct. */
export function shouldActThenClarify(assessment: NeasIntentAssessment): boolean {
  return assessment.action === 'act_then_clarify';
}

// ============================================================
// DEFAULT FACTORIES
// ============================================================

/**
 * Creates a new NeasAgentDefaults with all default values.
 * Returns a deep copy. Sets _schemaVersion to 1.
 */
export function createDefaultAgentDefaults(): NeasAgentDefaults {
  return {
    _schemaVersion: 1,
    ...NEAS_DEFAULT_AGENT_DEFAULTS,
  };
}

/**
 * Creates a new NeasAgentPermissions with safe defaults.
 * Returns a deep copy. Sets _schemaVersion to 1.
 */
export function createDefaultAgentPermissions(): NeasAgentPermissions {
  return {
    _schemaVersion: 1,
    ...NEAS_DEFAULT_AGENT_PERMISSIONS,
  };
}

/**
 * Creates a new NeasAgentLimits with default request-level caps.
 */
export function createDefaultAgentLimits(): NeasAgentLimits {
  return { ...NEAS_DEFAULT_AGENT_LIMITS };
}

// ============================================================
// CONFIGURATION MERGE
// ============================================================

/**
 * Merges user overrides into base agent defaults.
 * Preserves base _schemaVersion.
 *
 * @param base - Current agent defaults
 * @param overrides - Partial overrides to apply
 * @returns New agent defaults with overrides applied
 */
export function mergeAgentDefaults(
  base: NeasAgentDefaults,
  overrides: Partial<Omit<NeasAgentDefaults, '_schemaVersion'>>,
): NeasAgentDefaults {
  return {
    ...base,
    ...overrides,
    _schemaVersion: base._schemaVersion,
  };
}

// ============================================================
// PERMISSION CHECKS
// ============================================================

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
export function isToolAllowedByPermissions(
  tool: AtssToolName,
  permissions: NeasAgentPermissions,
): boolean {
  const tier = NEAS_TOOL_PERMISSION_TIER[tool];

  if (!tier || tier === 'always_on') {
    return true;
  }

  if (tier === 'on_by_default') {
    return permissions.can_write;
  }

  // off_by_default — check specific permission
  if (tool === 'delete_node') {
    return permissions.can_delete;
  }
  if (tool === 'bulk_operations') {
    return permissions.can_bulk_operations;
  }

  return false;
}

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
export function getEffectiveConfirmationLevel(
  tool: AtssToolName,
  permissions: NeasAgentPermissions,
  defaults: NeasAgentDefaults,
  _params: Record<string, unknown>,
): NeasPermissionCheckResult {
  const tier = NEAS_TOOL_PERMISSION_TIER[tool] ?? ('always_on' as NeasPermissionTier);

  // Layer 1: Check NEAS permissions
  if (!isToolAllowedByPermissions(tool, permissions)) {
    return {
      allowed: false,
      denied_reason: `${tool} is not enabled in your agent permissions. Enable it in Settings > Agent > Safety.`,
      effective_confirmation: 'confirm' as AtssConfirmationLevel,
      permission_tier: tier,
    };
  }

  // Layer 2: Get ATSS tool-level confirmation
  let confirmation: AtssConfirmationLevel = ATSS_TOOL_CONFIRMATION[tool] ?? 'confirm';

  // Upgrade to 'confirm' for destructive tools when confirm_destructive is true
  if (defaults.confirm_destructive && ATSS_TOOL_TO_CATEGORY[tool] === 'destructive') {
    confirmation = 'confirm';
  }

  return {
    allowed: true,
    effective_confirmation: confirmation,
    permission_tier: tier,
  };
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

/**
 * Creates a new agent session for tracking operations within a request.
 * Session ID format: "ses_" + nanoid(12)
 *
 * @param userId - ID of the user making the request
 * @returns Fresh agent session
 */
export function createAgentSession(userId: string): NeasAgentSession {
  return {
    _schemaVersion: 1,
    id: NEAS_SESSION_ID_PREFIX + nanoid(NANOID_LENGTH),
    user_id: userId,
    started_at: new Date().toISOString(),
    operations_count: 0,
    credits_spent: 0,
    action_log: [],
  };
}

/**
 * Records a tool operation in the session (immutable — returns new session).
 *
 * @param session - Current session state
 * @param tool - ATSS tool that was executed
 * @param creditCost - Credit cost of the operation
 * @param undoEntryId - ATSS undo entry ID (null for read operations)
 * @returns New session with the operation recorded
 */
export function recordSessionOperation(
  session: NeasAgentSession,
  tool: AtssToolName,
  creditCost: number,
  undoEntryId: string | null,
): NeasAgentSession {
  const action: NeasSessionAction = {
    tool,
    atss_undo_entry_id: undoEntryId,
    timestamp: new Date().toISOString(),
    credit_cost: creditCost,
  };

  return {
    ...session,
    operations_count: session.operations_count + 1,
    credits_spent: session.credits_spent + creditCost,
    action_log: [...session.action_log, action],
  };
}

/**
 * Checks whether an operation can proceed within the session's limits.
 *
 * @param session - Current session state
 * @param limits - Agent limits configuration
 * @param creditCost - Credit cost of the proposed operation
 * @returns Whether the operation is allowed + remaining capacity
 */
export function canPerformOperation(
  session: NeasAgentSession,
  limits: NeasAgentLimits,
  creditCost: number,
): NeasOperationCheck {
  const remainingOps = limits.max_operations_per_request - session.operations_count;
  const remainingCredits = limits.max_credits_per_request - session.credits_spent;

  if (remainingOps <= 0) {
    return {
      allowed: false,
      reason: `Operation limit reached (${session.operations_count}/${limits.max_operations_per_request})`,
      remaining_operations: 0,
      remaining_credits: remainingCredits,
    };
  }

  if (creditCost > remainingCredits) {
    return {
      allowed: false,
      reason: `Credit limit would be exceeded (${session.credits_spent + creditCost}/${limits.max_credits_per_request})`,
      remaining_operations: remainingOps,
      remaining_credits: remainingCredits,
    };
  }

  return {
    allowed: true,
    remaining_operations: remainingOps - 1,
    remaining_credits: remainingCredits - creditCost,
  };
}

/**
 * Generates a summary of a completed session.
 *
 * @param session - The session to summarize
 * @returns Session summary statistics
 */
export function getSessionSummary(session: NeasAgentSession): NeasSessionSummary {
  const toolCounts: Record<string, number> = {};

  for (const action of session.action_log) {
    toolCounts[action.tool] = (toolCounts[action.tool] ?? 0) + 1;
  }

  const startTime = new Date(session.started_at).getTime();
  const duration = Date.now() - startTime;

  return {
    total_operations: session.operations_count,
    total_credits: session.credits_spent,
    duration_ms: Math.max(0, duration),
    tools_used: toolCounts,
  };
}

// ============================================================
// OFFLINE TOOL AVAILABILITY
// ============================================================

/**
 * Returns the list of tools available based on online/offline state.
 *
 * @param isOnline - Whether the device has network connectivity
 * @returns Array of available tool names
 */
export function getAvailableTools(isOnline: boolean): readonly AtssToolName[] {
  if (isOnline) {
    return ATSS_TOOL_NAMES;
  }
  return NEAS_OFFLINE_AVAILABLE_TOOLS;
}

/**
 * Checks whether a specific tool is available offline.
 *
 * @param tool - ATSS tool name to check
 * @returns true if the tool works offline
 */
export function isToolAvailableOffline(tool: AtssToolName): boolean {
  return (NEAS_OFFLINE_AVAILABLE_TOOLS as readonly string[]).includes(tool);
}

/**
 * Returns the full offline capabilities description.
 */
export function getOfflineCapabilities(): NeasOfflineCapabilities {
  return {
    available_tools: NEAS_OFFLINE_AVAILABLE_TOOLS,
    read_only: true,
    cached_suggestions_available: true,
  };
}

// ============================================================
// PROACTIVE SUGGESTIONS
// ============================================================

/**
 * Creates a new suggestion configuration with defaults.
 * Default: suggestions OFF, max 1/day, 90% confidence, quiet 22:00-08:00.
 */
export function createDefaultSuggestionConfig(): NeasSuggestionConfig {
  return {
    _schemaVersion: 1,
    ...NEAS_DEFAULT_SUGGESTION_CONFIG,
  };
}

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
export function shouldShowSuggestion(
  config: NeasSuggestionConfig,
  lastSuggestionAt: string | null,
  confidence: number,
  currentHour: number,
): boolean {
  // Condition 1: Mode is not 'off'
  if (config.mode === 'off') {
    return false;
  }

  // Condition 2: Confidence threshold (only for 'important_only' mode)
  if (config.mode === 'important_only' && confidence < config.min_confidence) {
    return false;
  }

  // Condition 3: Not in quiet hours
  if (isInQuietHours(currentHour, config.quiet_hours_start, config.quiet_hours_end)) {
    return false;
  }

  // Condition 4: Daily limit not reached
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (!canSuggestToday(lastSuggestionAt, config.max_per_day, today)) {
    return false;
  }

  return true;
}

/**
 * Checks whether the current time falls within quiet hours.
 * Handles wraparound (e.g., 22:00-08:00 wraps past midnight).
 *
 * @param currentHour - Current hour (0-23)
 * @param quietStart - Start of quiet period (0-23)
 * @param quietEnd - End of quiet period (0-23)
 * @returns true if the current hour is within quiet hours
 */
export function isInQuietHours(
  currentHour: number,
  quietStart: number,
  quietEnd: number,
): boolean {
  if (quietStart === quietEnd) {
    return false; // No quiet hours when start === end
  }

  if (quietStart < quietEnd) {
    // Normal range (e.g., 9-17)
    return currentHour >= quietStart && currentHour < quietEnd;
  }

  // Wraparound range (e.g., 22-8)
  return currentHour >= quietStart || currentHour < quietEnd;
}

/**
 * Checks whether more suggestions can be shown today.
 *
 * @param lastSuggestionAt - ISO 8601 timestamp of last suggestion (null if never)
 * @param maxPerDay - Maximum suggestions allowed per day
 * @param today - Today's date string (YYYY-MM-DD)
 * @returns true if more suggestions are allowed today
 */
export function canSuggestToday(
  lastSuggestionAt: string | null,
  maxPerDay: number,
  today: string,
): boolean {
  if (maxPerDay <= 0) {
    return false;
  }

  if (lastSuggestionAt === null) {
    return true;
  }

  // Extract date portion (YYYY-MM-DD) from ISO 8601 timestamp
  const lastDate = lastSuggestionAt.slice(0, 10);
  if (lastDate !== today) {
    return true; // Last suggestion was on a different day
  }

  // Last suggestion was today — deny (conservative for simplified single-value tracking)
  return false;
}
