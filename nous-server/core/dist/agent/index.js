import { nanoid } from 'nanoid';
import { z } from 'zod';

// src/agent/index.ts

// src/constants.ts
var NANOID_LENGTH = 12;
var ATSS_TOOL_NAMES = [
  "view_node",
  "search",
  "create_node",
  "update_node",
  "delete_node",
  "create_edge",
  "delete_edge",
  "link_to_cluster",
  "bulk_operations"
];
var AtssToolNameSchema = z.enum(ATSS_TOOL_NAMES);
var ATSS_TOOL_CATEGORIES = ["read", "write", "destructive"];
z.enum(ATSS_TOOL_CATEGORIES);
var ATSS_TOOL_TO_CATEGORY = {
  view_node: "read",
  search: "read",
  create_node: "write",
  update_node: "write",
  delete_node: "destructive",
  create_edge: "write",
  delete_edge: "write",
  link_to_cluster: "write",
  bulk_operations: "destructive"
};
var ATSS_CONFIRMATION_LEVELS = ["none", "inform", "confirm"];
var AtssConfirmationLevelSchema = z.enum(ATSS_CONFIRMATION_LEVELS);
var ATSS_TOOL_CONFIRMATION = {
  view_node: "none",
  search: "none",
  create_node: "inform",
  update_node: "confirm",
  delete_node: "confirm",
  create_edge: "inform",
  delete_edge: "confirm",
  link_to_cluster: "inform",
  bulk_operations: "confirm"
};
var ATSS_UNDO_STATUSES = ["undoable", "undone", "expired", "redone"];
z.enum(ATSS_UNDO_STATUSES);
var ATSS_TIERS = ["free", "credits", "pro"];
z.enum(ATSS_TIERS);
var ATSS_CIRCUIT_BREAKER_STATES = ["closed", "open", "half_open"];
z.enum(ATSS_CIRCUIT_BREAKER_STATES);
var ATSS_BULK_MODES = ["all_or_nothing", "continue_on_error"];
z.enum(ATSS_BULK_MODES);

// src/agent/constants.ts
var NEAS_SESSION_ID_PREFIX = "ses_";
var NEAS_ERROR_TYPES = [
  "NOT_FOUND",
  "PERMISSION_DENIED",
  "LIMIT_EXCEEDED",
  "INVALID_INPUT",
  "CONFLICT",
  "NETWORK"
];
var NeasErrorTypeSchema = z.enum(NEAS_ERROR_TYPES);
var NEAS_ATSS_ERROR_MAPPING = {
  // 400 - Bad Request → mostly INVALID_INPUT, some LIMIT_EXCEEDED
  E400_INVALID_PARAMS: "INVALID_INPUT",
  E400_MISSING_REQUIRED: "INVALID_INPUT",
  E400_INVALID_NODE_TYPE: "INVALID_INPUT",
  E400_INVALID_EDGE_TYPE: "INVALID_INPUT",
  E400_CONTENT_TOO_LONG: "INVALID_INPUT",
  E400_TOO_MANY_TAGS: "INVALID_INPUT",
  E400_TOO_MANY_NODE_IDS: "LIMIT_EXCEEDED",
  E400_TOO_MANY_BULK_OPS: "LIMIT_EXCEEDED",
  E400_INVALID_BULK_REFERENCE: "INVALID_INPUT",
  E400_SELF_EDGE: "INVALID_INPUT",
  // 403 - Forbidden → PERMISSION_DENIED, except circuit breaker → NETWORK
  E403_INSUFFICIENT_CREDITS: "PERMISSION_DENIED",
  E403_TIER_RESTRICTED: "PERMISSION_DENIED",
  E403_CONFIRMATION_DENIED: "PERMISSION_DENIED",
  E403_CIRCUIT_BREAKER_OPEN: "NETWORK",
  // 404 - Not Found → NOT_FOUND
  E404_NODE_NOT_FOUND: "NOT_FOUND",
  E404_EDGE_NOT_FOUND: "NOT_FOUND",
  E404_CLUSTER_NOT_FOUND: "NOT_FOUND",
  E404_UNDO_ENTRY_NOT_FOUND: "NOT_FOUND",
  // 409 - Conflict → CONFLICT
  E409_DUPLICATE_EDGE: "CONFLICT",
  E409_UNDO_EXPIRED: "CONFLICT",
  E409_UNDO_DEPENDENCY: "CONFLICT",
  E409_ALREADY_UNDONE: "CONFLICT",
  // 429 - Rate Limited → LIMIT_EXCEEDED
  E429_RATE_LIMITED: "LIMIT_EXCEEDED",
  // 500 - Internal → NETWORK (treat as infrastructure issue)
  E500_INTERNAL: "NETWORK",
  // 503 - Service Unavailable → NETWORK
  E503_LLM_UNAVAILABLE: "NETWORK",
  // 504 - Timeout → NETWORK
  E504_TOOL_TIMEOUT: "NETWORK"
};
var NeasFixStrategyConfigSchema = z.object({
  retry_automatically: z.boolean(),
  description: z.string()
});
var NEAS_FIX_STRATEGIES = {
  NOT_FOUND: { retry_automatically: false, description: "Search for similar items, suggest creation" },
  PERMISSION_DENIED: { retry_automatically: false, description: "Explain required permission or credits" },
  LIMIT_EXCEEDED: { retry_automatically: false, description: "Offer partial execution (first N items)" },
  INVALID_INPUT: { retry_automatically: false, description: "Ask user for clarification" },
  CONFLICT: { retry_automatically: true, description: "Re-fetch fresh data and retry once" },
  NETWORK: { retry_automatically: true, description: "Queue for later, inform user of degraded state" }
};
var NEAS_ERROR_EXPLANATIONS = {
  NOT_FOUND: "I couldn't find {target}. {suggestion}",
  PERMISSION_DENIED: "I don't have permission to {action}. {suggestion}",
  LIMIT_EXCEEDED: "That operation exceeds the {limit_type} limit of {limit_value}. {suggestion}",
  INVALID_INPUT: "The {field} provided isn't valid. {suggestion}",
  CONFLICT: "The {target} was modified since I last viewed it. {suggestion}",
  NETWORK: "I'm having trouble reaching {service}. {suggestion}"
};
var NEAS_RECOVERY_SUGGESTIONS = {
  NOT_FOUND: "Would you like to search for something similar, or create it?",
  PERMISSION_DENIED: "You can enable this in Settings > Agent > Safety.",
  LIMIT_EXCEEDED: "Would you like me to do the first {max} instead?",
  INVALID_INPUT: "Could you provide a valid {field}?",
  CONFLICT: "I'll re-read the latest version and try again.",
  NETWORK: "I'll queue this action and retry when the connection is restored."
};
var NEAS_CERTAINTY_LEVELS = ["high", "medium", "low"];
var NeasCertaintyLevelSchema = z.enum(NEAS_CERTAINTY_LEVELS);
var NEAS_IMPACT_LEVELS = ["low", "medium", "high"];
var NeasImpactLevelSchema = z.enum(NEAS_IMPACT_LEVELS);
var NEAS_CLARIFICATION_ACTIONS = ["act", "act_then_clarify", "clarify_first"];
var NeasClarificationActionSchema = z.enum(NEAS_CLARIFICATION_ACTIONS);
var NEAS_CLARIFICATION_MATRIX = {
  high: {
    low: "act",
    medium: "act",
    high: "act"
  },
  medium: {
    low: "act",
    medium: "act_then_clarify",
    high: "clarify_first"
  },
  low: {
    low: "act_then_clarify",
    medium: "clarify_first",
    high: "clarify_first"
  }
};
var NEAS_RESPONSE_VERBOSITY_LEVELS = ["terse", "balanced", "detailed"];
var NeasResponseVerbositySchema = z.enum(NEAS_RESPONSE_VERBOSITY_LEVELS);
var NEAS_UNCERTAINTY_RESPONSES = ["ask", "best_guess", "refuse"];
var NeasUncertaintyResponseSchema = z.enum(NEAS_UNCERTAINTY_RESPONSES);
var NEAS_SEARCH_SCOPES = ["all", "recent", "current_cluster"];
var NeasSearchScopeSchema = z.enum(NEAS_SEARCH_SCOPES);
var NEAS_SUGGESTION_MODES = ["off", "important_only", "all"];
var NeasSuggestionModeSchema = z.enum(NEAS_SUGGESTION_MODES);
var NEAS_PERMISSION_TIERS = ["always_on", "on_by_default", "off_by_default"];
var NeasPermissionTierSchema = z.enum(NEAS_PERMISSION_TIERS);
var NEAS_TOOL_PERMISSION_TIER = {
  view_node: "always_on",
  search: "always_on",
  create_node: "on_by_default",
  update_node: "on_by_default",
  create_edge: "on_by_default",
  delete_edge: "on_by_default",
  link_to_cluster: "on_by_default",
  delete_node: "off_by_default",
  bulk_operations: "off_by_default"
};
var NEAS_OFFLINE_AVAILABLE_TOOLS = [
  "view_node",
  "search"
];
var NEAS_ONLINE_ONLY_TOOLS = [
  "create_node",
  "update_node",
  "delete_node",
  "create_edge",
  "delete_edge",
  "link_to_cluster",
  "bulk_operations"
];
var NEAS_DEFAULT_AGENT_DEFAULTS = {
  response_verbosity: "balanced",
  show_reasoning: false,
  auto_search_before_action: true,
  auto_show_related: true,
  auto_suggest_links: false,
  confirm_threshold_items: 10,
  confirm_threshold_credits: 15,
  confirm_destructive: true,
  uncertainty_response: "ask",
  default_search_scope: "all",
  default_time_range_days: 30
};
var NEAS_DEFAULT_AGENT_PERMISSIONS = {
  can_read: true,
  can_write: true,
  can_auto_operations: true,
  can_delete: false,
  can_bulk_operations: false
};
var NEAS_DEFAULT_AGENT_LIMITS = {
  max_operations_per_request: 100,
  max_credits_per_request: 30,
  preview_threshold: 10,
  context_batch_size: 50
};
var NEAS_DEFAULT_SUGGESTION_CONFIG = {
  mode: "off",
  max_per_day: 1,
  min_confidence: 0.9,
  quiet_hours_start: 22,
  quiet_hours_end: 8
};
var NEAS_HIGH_IMPACT_CREDIT_THRESHOLD = 10;
function isNeasErrorType(value) {
  return NEAS_ERROR_TYPES.includes(value);
}
function isNeasCertaintyLevel(value) {
  return NEAS_CERTAINTY_LEVELS.includes(value);
}
function isNeasImpactLevel(value) {
  return NEAS_IMPACT_LEVELS.includes(value);
}
function isNeasClarificationAction(value) {
  return NEAS_CLARIFICATION_ACTIONS.includes(value);
}
function isNeasResponseVerbosity(value) {
  return NEAS_RESPONSE_VERBOSITY_LEVELS.includes(value);
}
function isNeasSuggestionMode(value) {
  return NEAS_SUGGESTION_MODES.includes(value);
}
function isNeasPermissionTier(value) {
  return NEAS_PERMISSION_TIERS.includes(value);
}
var NeasToolCallSchema = z.object({
  tool: AtssToolNameSchema,
  params: z.record(z.unknown())
});
var NeasAgentErrorSchema = z.object({
  type: NeasErrorTypeSchema,
  message: z.string(),
  original_action: NeasToolCallSchema,
  atss_error_code: z.string(),
  recovery_attempted: z.boolean(),
  recovery_result: z.enum(["success", "failed"]).optional()
});
var NeasErrorExplanationSchema = z.object({
  user_message: z.string(),
  suggestion: z.string(),
  original_error: NeasAgentErrorSchema
});
var NeasCertaintyFactorsSchema = z.object({
  has_specific_target: z.boolean(),
  has_clear_action: z.boolean(),
  matches_prior_pattern: z.boolean(),
  unambiguous_scope: z.boolean()
});
var NeasImpactFactorsSchema = z.object({
  is_destructive: z.boolean(),
  affects_many: z.boolean(),
  is_reversible: z.boolean(),
  estimated_cost: z.number().min(0)
});
var NeasIntentAssessmentSchema = z.object({
  certainty: NeasCertaintyLevelSchema,
  impact: NeasImpactLevelSchema,
  action: NeasClarificationActionSchema
});
var NeasAgentDefaultsSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  response_verbosity: NeasResponseVerbositySchema,
  show_reasoning: z.boolean(),
  auto_search_before_action: z.boolean(),
  auto_show_related: z.boolean(),
  auto_suggest_links: z.boolean(),
  confirm_threshold_items: z.number().int().min(1),
  confirm_threshold_credits: z.number().int().min(1),
  confirm_destructive: z.boolean(),
  uncertainty_response: NeasUncertaintyResponseSchema,
  default_search_scope: NeasSearchScopeSchema,
  default_time_range_days: z.number().int().min(1).max(365)
});
var NeasAgentPermissionsSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  can_read: z.literal(true),
  can_write: z.boolean(),
  can_auto_operations: z.boolean(),
  can_delete: z.boolean(),
  can_bulk_operations: z.boolean()
});
var NeasAgentLimitsSchema = z.object({
  max_operations_per_request: z.number().int().min(1),
  max_credits_per_request: z.number().int().min(1),
  preview_threshold: z.number().int().min(1),
  context_batch_size: z.number().int().min(1)
});
var NeasSessionActionSchema = z.object({
  tool: AtssToolNameSchema,
  atss_undo_entry_id: z.string().nullable(),
  timestamp: z.string(),
  credit_cost: z.number().min(0)
});
var NeasAgentSessionSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  id: z.string(),
  user_id: z.string(),
  started_at: z.string(),
  operations_count: z.number().int().min(0),
  credits_spent: z.number().min(0),
  action_log: z.array(NeasSessionActionSchema)
});
var NeasOperationCheckSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  remaining_operations: z.number().int(),
  remaining_credits: z.number()
});
var NeasSessionSummarySchema = z.object({
  total_operations: z.number().int().min(0),
  total_credits: z.number().min(0),
  duration_ms: z.number().min(0),
  tools_used: z.record(z.number().int().min(0))
});
var NeasOfflineCapabilitiesSchema = z.object({
  available_tools: z.array(AtssToolNameSchema).readonly(),
  read_only: z.boolean(),
  cached_suggestions_available: z.boolean()
});
var NeasSuggestionConfigSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  mode: NeasSuggestionModeSchema,
  max_per_day: z.number().int().min(0),
  min_confidence: z.number().min(0).max(1),
  quiet_hours_start: z.number().int().min(0).max(23),
  quiet_hours_end: z.number().int().min(0).max(23)
});
var NeasPermissionCheckResultSchema = z.object({
  allowed: z.boolean(),
  denied_reason: z.string().optional(),
  effective_confirmation: AtssConfirmationLevelSchema,
  permission_tier: NeasPermissionTierSchema
});

// src/agent/index.ts
function generateSessionId() {
  return NEAS_SESSION_ID_PREFIX + nanoid(NANOID_LENGTH);
}
function classifyAgentError(atssErrorCode) {
  return NEAS_ATSS_ERROR_MAPPING[atssErrorCode] ?? "NETWORK";
}
function mapAtssErrorToAgentError(atssErrorCode, message, originalAction) {
  return {
    type: classifyAgentError(atssErrorCode),
    message,
    original_action: originalAction,
    atss_error_code: atssErrorCode,
    recovery_attempted: false
  };
}
function getFixStrategy(errorType) {
  return NEAS_FIX_STRATEGIES[errorType] ?? {
    retry_automatically: false,
    description: "Unknown error type"
  };
}
function isAutoRetryable(errorType) {
  return NEAS_FIX_STRATEGIES[errorType]?.retry_automatically ?? false;
}
function generateUserExplanation(error, context) {
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
  const suggestion = generateRecoverySuggestion(error, context);
  result = result.replace("{suggestion}", suggestion);
  return result;
}
function generateRecoverySuggestion(error, context) {
  const template = NEAS_RECOVERY_SUGGESTIONS[error.type];
  if (!template) {
    return "Please try again or rephrase your request.";
  }
  let result = template;
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      result = result.replace(`{${key}}`, value);
    }
  }
  return result;
}
function createErrorExplanation(error, context) {
  return {
    user_message: generateUserExplanation(error, context),
    suggestion: generateRecoverySuggestion(error, context),
    original_error: error
  };
}
function assessCertainty(factors) {
  if (factors.has_specific_target && factors.has_clear_action) {
    return "high";
  }
  if (factors.matches_prior_pattern || factors.unambiguous_scope) {
    return "medium";
  }
  return "low";
}
function assessImpact(factors, creditThreshold) {
  const threshold = creditThreshold ?? NEAS_HIGH_IMPACT_CREDIT_THRESHOLD;
  if (factors.is_destructive || factors.affects_many) {
    return "high";
  }
  if (factors.estimated_cost > threshold) {
    return "medium";
  }
  return "low";
}
function determineAction(certainty, impact) {
  const certaintyRow = NEAS_CLARIFICATION_MATRIX[certainty];
  if (!certaintyRow) {
    return "clarify_first";
  }
  return certaintyRow[impact] ?? "clarify_first";
}
function assessIntent(certaintyFactors, impactFactors) {
  const certainty = assessCertainty(certaintyFactors);
  const impact = assessImpact(impactFactors);
  const action = determineAction(certainty, impact);
  return { certainty, impact, action };
}
function shouldClarifyFirst(assessment) {
  return assessment.action === "clarify_first";
}
function shouldActThenClarify(assessment) {
  return assessment.action === "act_then_clarify";
}
function createDefaultAgentDefaults() {
  return {
    _schemaVersion: 1,
    ...NEAS_DEFAULT_AGENT_DEFAULTS
  };
}
function createDefaultAgentPermissions() {
  return {
    _schemaVersion: 1,
    ...NEAS_DEFAULT_AGENT_PERMISSIONS
  };
}
function createDefaultAgentLimits() {
  return { ...NEAS_DEFAULT_AGENT_LIMITS };
}
function mergeAgentDefaults(base, overrides) {
  return {
    ...base,
    ...overrides,
    _schemaVersion: base._schemaVersion
  };
}
function isToolAllowedByPermissions(tool, permissions) {
  const tier = NEAS_TOOL_PERMISSION_TIER[tool];
  if (!tier || tier === "always_on") {
    return true;
  }
  if (tier === "on_by_default") {
    return permissions.can_write;
  }
  if (tool === "delete_node") {
    return permissions.can_delete;
  }
  if (tool === "bulk_operations") {
    return permissions.can_bulk_operations;
  }
  return false;
}
function getEffectiveConfirmationLevel(tool, permissions, defaults, _params) {
  const tier = NEAS_TOOL_PERMISSION_TIER[tool] ?? "always_on";
  if (!isToolAllowedByPermissions(tool, permissions)) {
    return {
      allowed: false,
      denied_reason: `${tool} is not enabled in your agent permissions. Enable it in Settings > Agent > Safety.`,
      effective_confirmation: "confirm",
      permission_tier: tier
    };
  }
  let confirmation = ATSS_TOOL_CONFIRMATION[tool] ?? "confirm";
  if (defaults.confirm_destructive && ATSS_TOOL_TO_CATEGORY[tool] === "destructive") {
    confirmation = "confirm";
  }
  return {
    allowed: true,
    effective_confirmation: confirmation,
    permission_tier: tier
  };
}
function createAgentSession(userId) {
  return {
    _schemaVersion: 1,
    id: NEAS_SESSION_ID_PREFIX + nanoid(NANOID_LENGTH),
    user_id: userId,
    started_at: (/* @__PURE__ */ new Date()).toISOString(),
    operations_count: 0,
    credits_spent: 0,
    action_log: []
  };
}
function recordSessionOperation(session, tool, creditCost, undoEntryId) {
  const action = {
    tool,
    atss_undo_entry_id: undoEntryId,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    credit_cost: creditCost
  };
  return {
    ...session,
    operations_count: session.operations_count + 1,
    credits_spent: session.credits_spent + creditCost,
    action_log: [...session.action_log, action]
  };
}
function canPerformOperation(session, limits, creditCost) {
  const remainingOps = limits.max_operations_per_request - session.operations_count;
  const remainingCredits = limits.max_credits_per_request - session.credits_spent;
  if (remainingOps <= 0) {
    return {
      allowed: false,
      reason: `Operation limit reached (${session.operations_count}/${limits.max_operations_per_request})`,
      remaining_operations: 0,
      remaining_credits: remainingCredits
    };
  }
  if (creditCost > remainingCredits) {
    return {
      allowed: false,
      reason: `Credit limit would be exceeded (${session.credits_spent + creditCost}/${limits.max_credits_per_request})`,
      remaining_operations: remainingOps,
      remaining_credits: remainingCredits
    };
  }
  return {
    allowed: true,
    remaining_operations: remainingOps - 1,
    remaining_credits: remainingCredits - creditCost
  };
}
function getSessionSummary(session) {
  const toolCounts = {};
  for (const action of session.action_log) {
    toolCounts[action.tool] = (toolCounts[action.tool] ?? 0) + 1;
  }
  const startTime = new Date(session.started_at).getTime();
  const duration = Date.now() - startTime;
  return {
    total_operations: session.operations_count,
    total_credits: session.credits_spent,
    duration_ms: Math.max(0, duration),
    tools_used: toolCounts
  };
}
function getAvailableTools(isOnline) {
  if (isOnline) {
    return ATSS_TOOL_NAMES;
  }
  return NEAS_OFFLINE_AVAILABLE_TOOLS;
}
function isToolAvailableOffline(tool) {
  return NEAS_OFFLINE_AVAILABLE_TOOLS.includes(tool);
}
function getOfflineCapabilities() {
  return {
    available_tools: NEAS_OFFLINE_AVAILABLE_TOOLS,
    read_only: true,
    cached_suggestions_available: true
  };
}
function createDefaultSuggestionConfig() {
  return {
    _schemaVersion: 1,
    ...NEAS_DEFAULT_SUGGESTION_CONFIG
  };
}
function shouldShowSuggestion(config, lastSuggestionAt, confidence, currentHour) {
  if (config.mode === "off") {
    return false;
  }
  if (config.mode === "important_only" && confidence < config.min_confidence) {
    return false;
  }
  if (isInQuietHours(currentHour, config.quiet_hours_start, config.quiet_hours_end)) {
    return false;
  }
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (!canSuggestToday(lastSuggestionAt, config.max_per_day, today)) {
    return false;
  }
  return true;
}
function isInQuietHours(currentHour, quietStart, quietEnd) {
  if (quietStart === quietEnd) {
    return false;
  }
  if (quietStart < quietEnd) {
    return currentHour >= quietStart && currentHour < quietEnd;
  }
  return currentHour >= quietStart || currentHour < quietEnd;
}
function canSuggestToday(lastSuggestionAt, maxPerDay, today) {
  if (maxPerDay <= 0) {
    return false;
  }
  if (lastSuggestionAt === null) {
    return true;
  }
  const lastDate = lastSuggestionAt.slice(0, 10);
  if (lastDate !== today) {
    return true;
  }
  return false;
}

export { ATSS_TOOL_CONFIRMATION, ATSS_TOOL_NAMES, ATSS_TOOL_TO_CATEGORY, NEAS_ATSS_ERROR_MAPPING, NEAS_CERTAINTY_LEVELS, NEAS_CLARIFICATION_ACTIONS, NEAS_CLARIFICATION_MATRIX, NEAS_DEFAULT_AGENT_DEFAULTS, NEAS_DEFAULT_AGENT_LIMITS, NEAS_DEFAULT_AGENT_PERMISSIONS, NEAS_DEFAULT_SUGGESTION_CONFIG, NEAS_ERROR_EXPLANATIONS, NEAS_ERROR_TYPES, NEAS_FIX_STRATEGIES, NEAS_HIGH_IMPACT_CREDIT_THRESHOLD, NEAS_IMPACT_LEVELS, NEAS_OFFLINE_AVAILABLE_TOOLS, NEAS_ONLINE_ONLY_TOOLS, NEAS_PERMISSION_TIERS, NEAS_RECOVERY_SUGGESTIONS, NEAS_RESPONSE_VERBOSITY_LEVELS, NEAS_SEARCH_SCOPES, NEAS_SESSION_ID_PREFIX, NEAS_SUGGESTION_MODES, NEAS_TOOL_PERMISSION_TIER, NEAS_UNCERTAINTY_RESPONSES, NeasAgentDefaultsSchema, NeasAgentErrorSchema, NeasAgentLimitsSchema, NeasAgentPermissionsSchema, NeasAgentSessionSchema, NeasCertaintyFactorsSchema, NeasCertaintyLevelSchema, NeasClarificationActionSchema, NeasErrorExplanationSchema, NeasErrorTypeSchema, NeasFixStrategyConfigSchema, NeasImpactFactorsSchema, NeasImpactLevelSchema, NeasIntentAssessmentSchema, NeasOfflineCapabilitiesSchema, NeasOperationCheckSchema, NeasPermissionCheckResultSchema, NeasPermissionTierSchema, NeasResponseVerbositySchema, NeasSearchScopeSchema, NeasSessionActionSchema, NeasSessionSummarySchema, NeasSuggestionConfigSchema, NeasSuggestionModeSchema, NeasToolCallSchema, NeasUncertaintyResponseSchema, assessCertainty, assessImpact, assessIntent, canPerformOperation, canSuggestToday, classifyAgentError, createAgentSession, createDefaultAgentDefaults, createDefaultAgentLimits, createDefaultAgentPermissions, createDefaultSuggestionConfig, createErrorExplanation, determineAction, generateRecoverySuggestion, generateSessionId, generateUserExplanation, getAvailableTools, getEffectiveConfirmationLevel, getFixStrategy, getOfflineCapabilities, getSessionSummary, isAutoRetryable, isInQuietHours, isNeasCertaintyLevel, isNeasClarificationAction, isNeasErrorType, isNeasImpactLevel, isNeasPermissionTier, isNeasResponseVerbosity, isNeasSuggestionMode, isToolAllowedByPermissions, isToolAvailableOffline, mapAtssErrorToAgentError, mergeAgentDefaults, recordSessionOperation, shouldActThenClarify, shouldClarifyFirst, shouldShowSuggestion };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map