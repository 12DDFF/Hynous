/**
 * @module @nous/core/api
 * @description API constants — tiers, rate limits, SSE events, error codes, timeouts, content limits
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * All constants for the Nous REST API module.
 * Organized by domain: tiers, rate limits, burst, Redis, SSE, content, errors, timeouts, monitoring.
 *
 * NOTE: Base server constants (API_VERSION, ROUTE_PREFIXES, ERROR_CODES, SSE_MAX_DURATION_MS,
 * DEFAULT_RATE_LIMIT_RPM, RATE_LIMIT_WINDOW_MS) are defined in storm-026's @nous/core/backend.
 * This file EXTENDS those with API-layer specifics.
 */

// ============================================================
// USER TIERS
// ============================================================

/**
 * User tier levels that determine rate limits and feature access.
 *
 * - free: Default tier, basic access
 * - credits: Pay-as-you-go with purchased credits
 * - pro: Subscription tier with highest limits
 * - api_key: API key access (scripts/automation), separate rate bucket
 */
export const USER_TIERS = ['free', 'credits', 'pro', 'api_key'] as const;
export type UserTier = typeof USER_TIERS[number];

export function isUserTier(value: unknown): value is UserTier {
  return typeof value === 'string' && (USER_TIERS as readonly string[]).includes(value);
}

// ============================================================
// TIER RATE LIMITS
// ============================================================

/**
 * Rate limits per user tier.
 *
 * Source: storm-023 v2 brainstorm, "Limits by Tier" table.
 *
 * ```
 * Tier      Req/min  Req/day   Concurrent  Batch
 * Free      60       1,000     5           20
 * Credits   120      5,000     10          50
 * Pro       300      50,000    25          100
 * API Key   60       10,000    5           50
 * ```
 */
export const TIER_LIMITS = {
  free:    { requests_per_min: 60,  requests_per_day: 1_000,  concurrent: 5,  batch_size: 20 },
  credits: { requests_per_min: 120, requests_per_day: 5_000,  concurrent: 10, batch_size: 50 },
  pro:     { requests_per_min: 300, requests_per_day: 50_000, concurrent: 25, batch_size: 100 },
  api_key: { requests_per_min: 60,  requests_per_day: 10_000, concurrent: 5,  batch_size: 50 },
} as const;

export type TierLimitConfig = typeof TIER_LIMITS[UserTier];

// ============================================================
// PER-ENDPOINT RATE LIMITS
// ============================================================

/**
 * Endpoint-specific rate limits (stricter than tier base).
 * Only 6 expensive endpoints have per-endpoint limits.
 * All other endpoints use the tier's base `requests_per_min`.
 *
 * Source: storm-023 v2 brainstorm, "Per-Endpoint Limits" section.
 */
export const ENDPOINT_RATE_LIMITS = {
  'POST /v1/chat':          { free: 20, credits: 60,  pro: 120, reason: 'LLM cost' },
  'POST /v1/ingest':        { free: 10, credits: 30,  pro: 60,  reason: 'Processing cost' },
  'POST /v1/ingest/file':   { free: 5,  credits: 15,  pro: 30,  reason: 'Heavy processing' },
  'POST /v1/search':        { free: 30, credits: 90,  pro: 180, reason: 'Embedding cost' },
  'POST /v1/agent/actions': { free: 10, credits: 30,  pro: 60,  reason: 'LLM + write cost' },
  'POST /v1/sync/push':     { free: 30, credits: 60,  pro: 120, reason: 'DB write cost' },
} as const;

export type RateLimitedEndpoint = keyof typeof ENDPOINT_RATE_LIMITS;

export function isRateLimitedEndpoint(value: unknown): value is RateLimitedEndpoint {
  return typeof value === 'string' && value in ENDPOINT_RATE_LIMITS;
}

// ============================================================
// BURST CONFIGURATION
// ============================================================

/**
 * Burst allowance: 10% above tier limit.
 * Token bucket max capacity = tier_limit * (1 + BURST_ALLOWANCE_PERCENT).
 */
export const BURST_ALLOWANCE_PERCENT = 0.1;

export const BURST_LIMITS = {
  free:    66,
  credits: 132,
  pro:     330,
  api_key: 66,
} as const;

// ============================================================
// REDIS KEY PATTERNS
// ============================================================

/**
 * Redis key patterns for rate limiting storage.
 * `{user_id}` and `{endpoint}` are template placeholders.
 */
export const REDIS_KEY_PATTERNS = {
  api: 'ratelimit:api:{user_id}',
  llm: 'ratelimit:llm:{user_id}',
  endpoint: 'ratelimit:endpoint:{user_id}:{endpoint}',
  concurrent: 'ratelimit:concurrent:{user_id}',
} as const;

export type RedisKeyType = keyof typeof REDIS_KEY_PATTERNS;

/** Redis key TTLs in milliseconds */
export const REDIS_TTL_API_MS = 70_000;
export const REDIS_TTL_LLM_MS = 70_000;
export const REDIS_TTL_ENDPOINT_MS = 70_000;
export const REDIS_TTL_CONCURRENT_MS = 300_000;

/** Percentage of tier limit applied during Redis fallback (in-memory mode) */
export const REDIS_FALLBACK_LIMIT_PERCENT = 0.5;

// ============================================================
// CHAT SSE EVENT TYPES
// ============================================================

/**
 * SSE event types for the chat streaming endpoint (POST /v1/chat).
 *
 * Event sequence:
 * session_start -> retrieval_start -> retrieval_node (xN) -> retrieval_complete
 *   -> response_start -> response_chunk (xN) -> response_complete -> done
 */
export const CHAT_SSE_EVENT_TYPES = [
  'session_start',
  'retrieval_start',
  'retrieval_node',
  'retrieval_complete',
  'response_start',
  'response_chunk',
  'response_complete',
  'done',
  'ping',
  'session_expired',
  'error',
] as const;

export type ChatSSEEventType = typeof CHAT_SSE_EVENT_TYPES[number];

export function isChatSSEEventType(value: unknown): value is ChatSSEEventType {
  return typeof value === 'string' && (CHAT_SSE_EVENT_TYPES as readonly string[]).includes(value);
}

// ============================================================
// SSE CONFIGURATION (CHAT-SPECIFIC)
// ============================================================

/** Chat SSE keepalive interval (15 seconds) */
export const CHAT_SSE_KEEPALIVE_INTERVAL_MS = 15_000;
/** Chat SSE max duration (120 seconds — regional container, not edge) */
export const CHAT_SSE_MAX_DURATION_MS = 120_000;
/** Chat SSE reconnection window (5 minutes) */
export const CHAT_SSE_RECONNECT_WINDOW_MS = 300_000;

// ============================================================
// CONTENT LIMITS
// ============================================================

/**
 * Content size limits for node creation/update.
 * Source: storm-011 (Node Structure) content architecture.
 */
export const CONTENT_LIMITS = {
  title: 100,
  body_soft: 500,
  body_hard: 2_000,
  summary: 200,
  batch_max_size: 100,
} as const;

// ============================================================
// EXTENDED ERROR CODES
// ============================================================

/**
 * API-layer error codes, extending storm-026's 9 base ERROR_CODES.
 * Storm-023 adds 8 more for a total of 17 error codes.
 */
export const API_ERROR_CODES = {
  // From storm-026 (included for completeness)
  UNAUTHORIZED:          { status: 401, message: 'Authentication required' },
  TOKEN_EXPIRED:         { status: 401, message: 'JWT expired, refresh needed' },
  FORBIDDEN:             { status: 403, message: 'Insufficient permissions' },
  NOT_FOUND:             { status: 404, message: 'Resource not found' },
  CONFLICT:              { status: 409, message: 'Version conflict' },
  RATE_LIMITED:          { status: 429, message: 'Too many requests' },
  VALIDATION_ERROR:      { status: 400, message: 'Invalid request data' },
  INTERNAL_ERROR:        { status: 500, message: 'Internal server error' },
  SERVICE_UNAVAILABLE:   { status: 503, message: 'Service temporarily unavailable' },

  // New in storm-023
  INVALID_REQUEST:          { status: 400, message: 'Malformed request' },
  CONTENT_LIMIT_EXCEEDED:   { status: 400, message: 'Content exceeds size limits' },
  BATCH_SIZE_EXCEEDED:      { status: 400, message: 'Too many items in batch' },
  TIER_REQUIRED:            { status: 403, message: 'Higher tier required' },
  PRIVACY_TIER_REQUIRED:    { status: 403, message: 'Private tier required for this operation' },
  DUPLICATE:                { status: 409, message: 'Resource already exists' },
  IDEMPOTENCY_MISMATCH:    { status: 409, message: 'Same key with different request body' },
  UNPROCESSABLE:            { status: 422, message: 'Valid syntax but semantic error' },
  UPSTREAM_ERROR:           { status: 502, message: 'Upstream service failed' },
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && value in API_ERROR_CODES;
}

// ============================================================
// ENDPOINT TIMEOUTS
// ============================================================

/**
 * Expected latency and client timeout per endpoint type.
 * `expected_ms: null` means variable/streaming.
 */
export const ENDPOINT_TIMEOUTS = {
  health:      { expected_ms: 50,    client_timeout_ms: 5_000 },
  node_crud:   { expected_ms: 100,   client_timeout_ms: 10_000 },
  list:        { expected_ms: 200,   client_timeout_ms: 15_000 },
  search:      { expected_ms: 500,   client_timeout_ms: 30_000 },
  ingest_text: { expected_ms: 2_000, client_timeout_ms: 30_000 },
  ingest_file: { expected_ms: null,  client_timeout_ms: 60_000 },
  chat_sse:    { expected_ms: null,  client_timeout_ms: 120_000 },
  sync:        { expected_ms: 500,   client_timeout_ms: 30_000 },
  agent:       { expected_ms: 5_000, client_timeout_ms: 60_000 },
} as const;

export type EndpointTimeoutType = keyof typeof ENDPOINT_TIMEOUTS;

// ============================================================
// RATE LIMIT MONITORING
// ============================================================

/** Alerting thresholds for rate limiting monitoring */
export const RATE_LIMIT_ALERT_THRESHOLDS = {
  redis_failure_rate_percent: 1,
  redis_failure_window_ms: 60_000,
  user_limit_hits_per_min: 10,
  tier_utilization_percent: 90,
  tier_utilization_window_ms: 300_000,
  fallback_active_max_ms: 30_000,
} as const;

// ============================================================
// PAGINATION DEFAULTS
// ============================================================

export const CURSOR_PAGINATION_DEFAULT_LIMIT = 50;
export const CURSOR_PAGINATION_MAX_LIMIT = 100;
export const OFFSET_PAGINATION_DEFAULT_LIMIT = 20;
export const OFFSET_PAGINATION_MAX_LIMIT = 100;

// ============================================================
// IDEMPOTENCY
// ============================================================

/** Idempotency key cache duration (24 hours) */
export const IDEMPOTENCY_TTL_MS = 86_400_000;

// ============================================================
// RATE LIMIT ALGORITHMS
// ============================================================

export const RATE_LIMIT_ALGORITHMS = ['sliding_window', 'token_bucket'] as const;
export type RateLimitAlgorithm = typeof RATE_LIMIT_ALGORITHMS[number];

// ============================================================
// RATE LIMIT TYPES
// ============================================================

/**
 * Categories of rate limits checked per request.
 * Check order: endpoint-specific -> global tier -> daily -> concurrent.
 */
export const RATE_LIMIT_TYPES = ['api', 'endpoint', 'daily', 'concurrent', 'llm'] as const;
export type RateLimitType = typeof RATE_LIMIT_TYPES[number];

export function isRateLimitType(value: unknown): value is RateLimitType {
  return typeof value === 'string' && (RATE_LIMIT_TYPES as readonly string[]).includes(value);
}

// ============================================================
// AUTH METHODS
// ============================================================

export const AUTH_METHODS = ['jwt', 'api_key'] as const;
export type AuthMethod = typeof AUTH_METHODS[number];

// ============================================================
// API KEY PREFIXES & SCOPES
// ============================================================

export const API_KEY_PREFIX_LIVE = 'sk_live_';
export const API_KEY_PREFIX_TEST = 'sk_test_';

export const API_KEY_SCOPES = ['full', 'read_only'] as const;
export type ApiKeyScope = typeof API_KEY_SCOPES[number];

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === 'string' && (API_KEY_SCOPES as readonly string[]).includes(value);
}

// ============================================================
// EMBEDDING STATUS
// ============================================================

export const EMBEDDING_STATUSES = ['pending', 'processing', 'complete', 'failed'] as const;
export type EmbeddingStatus = typeof EMBEDDING_STATUSES[number];

export function isEmbeddingStatus(value: unknown): value is EmbeddingStatus {
  return typeof value === 'string' && (EMBEDDING_STATUSES as readonly string[]).includes(value);
}

// ============================================================
// PRIVACY TIERS (API-LEVEL REFERENCE)
// ============================================================

export const PRIVACY_TIERS = ['standard', 'private'] as const;
export type PrivacyTier = typeof PRIVACY_TIERS[number];

// ============================================================
// LIFECYCLE STATES
// ============================================================

export const LIFECYCLE_STATES = ['active', 'weak', 'dormant', 'summarized', 'archived'] as const;
export type LifecycleState = typeof LIFECYCLE_STATES[number];

// ============================================================
// EDGE DIRECTIONS
// ============================================================

export const EDGE_DIRECTIONS = ['in', 'out', 'both'] as const;
export type EdgeDirection = typeof EDGE_DIRECTIONS[number];

export function isEdgeDirection(value: unknown): value is EdgeDirection {
  return typeof value === 'string' && (EDGE_DIRECTIONS as readonly string[]).includes(value);
}

// ============================================================
// INGESTION CONSTANTS
// ============================================================

export const INGEST_SOURCES = ['chat', 'file', 'voice', 'api'] as const;
export type IngestSource = typeof INGEST_SOURCES[number];

export function isIngestSource(value: unknown): value is IngestSource {
  return typeof value === 'string' && (INGEST_SOURCES as readonly string[]).includes(value);
}

export const INGEST_MODES = ['normal', 'incognito'] as const;
export type IngestMode = typeof INGEST_MODES[number];

export const INGEST_PRIORITIES = ['normal', 'high', 'low'] as const;
export type IngestPriority = typeof INGEST_PRIORITIES[number];

export const INGEST_ACTIONS = ['saved', 'ignored', 'accumulated', 'prompted'] as const;
export type IngestAction = typeof INGEST_ACTIONS[number];

export function isIngestAction(value: unknown): value is IngestAction {
  return typeof value === 'string' && (INGEST_ACTIONS as readonly string[]).includes(value);
}

// ============================================================
// JOB STATUSES
// ============================================================

export const JOB_STATUSES = ['processing', 'complete', 'failed'] as const;
export type JobStatus = typeof JOB_STATUSES[number];

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (JOB_STATUSES as readonly string[]).includes(value);
}

// ============================================================
// SYNC CONSTANTS
// ============================================================

export const SYNC_OPERATIONS = ['create', 'update', 'delete'] as const;
export type SyncOperation = typeof SYNC_OPERATIONS[number];

export function isSyncOperation(value: unknown): value is SyncOperation {
  return typeof value === 'string' && (SYNC_OPERATIONS as readonly string[]).includes(value);
}

export const SYNC_TABLES = ['nodes', 'edges'] as const;
export type SyncTable = typeof SYNC_TABLES[number];

export const SYNC_CONFLICT_TYPES = ['VERSION_MISMATCH', 'DELETED', 'CONSTRAINT'] as const;
export type SyncConflictType = typeof SYNC_CONFLICT_TYPES[number];

export function isSyncConflictType(value: unknown): value is SyncConflictType {
  return typeof value === 'string' && (SYNC_CONFLICT_TYPES as readonly string[]).includes(value);
}

export const SYNC_RESOLUTIONS = ['keep_local', 'keep_server', 'merge'] as const;
export type SyncResolution = typeof SYNC_RESOLUTIONS[number];

export function isSyncResolution(value: unknown): value is SyncResolution {
  return typeof value === 'string' && (SYNC_RESOLUTIONS as readonly string[]).includes(value);
}

export const FULL_SYNC_REASONS = ['corruption', 'reset', 'new_device'] as const;
export type FullSyncReason = typeof FULL_SYNC_REASONS[number];

// ============================================================
// AGENT CONSTANTS
// ============================================================

export const AGENT_TOOL_CATEGORIES = ['read', 'write', 'destructive'] as const;
export type AgentToolCategory = typeof AGENT_TOOL_CATEGORIES[number];

export const ACTION_STATUSES = ['completed', 'failed', 'undone'] as const;
export type ActionStatus = typeof ACTION_STATUSES[number];

// ============================================================
// SETTINGS CONSTANTS
// ============================================================

export const THEME_OPTIONS = ['system', 'light', 'dark'] as const;
export type ThemeOption = typeof THEME_OPTIONS[number];

export const AGENT_SUGGESTION_LEVELS = ['all', 'important_only', 'none'] as const;
export type AgentSuggestionLevel = typeof AGENT_SUGGESTION_LEVELS[number];

// ============================================================
// CREDIT CONSTANTS
// ============================================================

export const CREDIT_OPERATIONS = ['chat_quick', 'chat_standard', 'chat_deep', 'extraction', 'agent', 'embedding'] as const;
export type CreditOperation = typeof CREDIT_OPERATIONS[number];

export const USAGE_GROUP_BY = ['day', 'operation'] as const;
export type UsageGroupBy = typeof USAGE_GROUP_BY[number];

// ============================================================
// FLOW TYPES
// ============================================================

export const FLOW_TYPES = ['chat', 'sync', 'ingestion'] as const;
export type FlowType = typeof FLOW_TYPES[number];

// ============================================================
// CORS CONFIGURATION
// ============================================================

export const CORS_ALLOWED_ORIGINS = [
  'https://app.nous.app',
  'https://nous.app',
] as const;

export const CORS_ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export const CORS_ALLOWED_HEADERS = ['Authorization', 'Content-Type', 'X-Request-ID', 'Idempotency-Key'] as const;
export const CORS_MAX_AGE_SECONDS = 86_400;
