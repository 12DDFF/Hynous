import { z } from 'zod';

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
/**
 * User tier levels that determine rate limits and feature access.
 *
 * - free: Default tier, basic access
 * - credits: Pay-as-you-go with purchased credits
 * - pro: Subscription tier with highest limits
 * - api_key: API key access (scripts/automation), separate rate bucket
 */
declare const USER_TIERS: readonly ["free", "credits", "pro", "api_key"];
type UserTier = typeof USER_TIERS[number];
declare function isUserTier(value: unknown): value is UserTier;
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
declare const TIER_LIMITS: {
    readonly free: {
        readonly requests_per_min: 60;
        readonly requests_per_day: 1000;
        readonly concurrent: 5;
        readonly batch_size: 20;
    };
    readonly credits: {
        readonly requests_per_min: 120;
        readonly requests_per_day: 5000;
        readonly concurrent: 10;
        readonly batch_size: 50;
    };
    readonly pro: {
        readonly requests_per_min: 300;
        readonly requests_per_day: 50000;
        readonly concurrent: 25;
        readonly batch_size: 100;
    };
    readonly api_key: {
        readonly requests_per_min: 60;
        readonly requests_per_day: 10000;
        readonly concurrent: 5;
        readonly batch_size: 50;
    };
};
type TierLimitConfig = typeof TIER_LIMITS[UserTier];
/**
 * Endpoint-specific rate limits (stricter than tier base).
 * Only 6 expensive endpoints have per-endpoint limits.
 * All other endpoints use the tier's base `requests_per_min`.
 *
 * Source: storm-023 v2 brainstorm, "Per-Endpoint Limits" section.
 */
declare const ENDPOINT_RATE_LIMITS: {
    readonly 'POST /v1/chat': {
        readonly free: 20;
        readonly credits: 60;
        readonly pro: 120;
        readonly reason: "LLM cost";
    };
    readonly 'POST /v1/ingest': {
        readonly free: 10;
        readonly credits: 30;
        readonly pro: 60;
        readonly reason: "Processing cost";
    };
    readonly 'POST /v1/ingest/file': {
        readonly free: 5;
        readonly credits: 15;
        readonly pro: 30;
        readonly reason: "Heavy processing";
    };
    readonly 'POST /v1/search': {
        readonly free: 30;
        readonly credits: 90;
        readonly pro: 180;
        readonly reason: "Embedding cost";
    };
    readonly 'POST /v1/agent/actions': {
        readonly free: 10;
        readonly credits: 30;
        readonly pro: 60;
        readonly reason: "LLM + write cost";
    };
    readonly 'POST /v1/sync/push': {
        readonly free: 30;
        readonly credits: 60;
        readonly pro: 120;
        readonly reason: "DB write cost";
    };
};
type RateLimitedEndpoint = keyof typeof ENDPOINT_RATE_LIMITS;
declare function isRateLimitedEndpoint(value: unknown): value is RateLimitedEndpoint;
/**
 * Burst allowance: 10% above tier limit.
 * Token bucket max capacity = tier_limit * (1 + BURST_ALLOWANCE_PERCENT).
 */
declare const BURST_ALLOWANCE_PERCENT = 0.1;
declare const BURST_LIMITS: {
    readonly free: 66;
    readonly credits: 132;
    readonly pro: 330;
    readonly api_key: 66;
};
/**
 * Redis key patterns for rate limiting storage.
 * `{user_id}` and `{endpoint}` are template placeholders.
 */
declare const REDIS_KEY_PATTERNS: {
    readonly api: "ratelimit:api:{user_id}";
    readonly llm: "ratelimit:llm:{user_id}";
    readonly endpoint: "ratelimit:endpoint:{user_id}:{endpoint}";
    readonly concurrent: "ratelimit:concurrent:{user_id}";
};
type RedisKeyType = keyof typeof REDIS_KEY_PATTERNS;
/** Redis key TTLs in milliseconds */
declare const REDIS_TTL_API_MS = 70000;
declare const REDIS_TTL_LLM_MS = 70000;
declare const REDIS_TTL_ENDPOINT_MS = 70000;
declare const REDIS_TTL_CONCURRENT_MS = 300000;
/** Percentage of tier limit applied during Redis fallback (in-memory mode) */
declare const REDIS_FALLBACK_LIMIT_PERCENT = 0.5;
/**
 * SSE event types for the chat streaming endpoint (POST /v1/chat).
 *
 * Event sequence:
 * session_start -> retrieval_start -> retrieval_node (xN) -> retrieval_complete
 *   -> response_start -> response_chunk (xN) -> response_complete -> done
 */
declare const CHAT_SSE_EVENT_TYPES: readonly ["session_start", "retrieval_start", "retrieval_node", "retrieval_complete", "response_start", "response_chunk", "response_complete", "done", "ping", "session_expired", "error"];
type ChatSSEEventType = typeof CHAT_SSE_EVENT_TYPES[number];
declare function isChatSSEEventType(value: unknown): value is ChatSSEEventType;
/** Chat SSE keepalive interval (15 seconds) */
declare const CHAT_SSE_KEEPALIVE_INTERVAL_MS = 15000;
/** Chat SSE max duration (120 seconds — regional container, not edge) */
declare const CHAT_SSE_MAX_DURATION_MS = 120000;
/** Chat SSE reconnection window (5 minutes) */
declare const CHAT_SSE_RECONNECT_WINDOW_MS = 300000;
/**
 * Content size limits for node creation/update.
 * Source: storm-011 (Node Structure) content architecture.
 */
declare const CONTENT_LIMITS: {
    readonly title: 100;
    readonly body_soft: 500;
    readonly body_hard: 2000;
    readonly summary: 200;
    readonly batch_max_size: 100;
};
/**
 * API-layer error codes, extending storm-026's 9 base ERROR_CODES.
 * Storm-023 adds 8 more for a total of 17 error codes.
 */
declare const API_ERROR_CODES: {
    readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly message: "Authentication required";
    };
    readonly TOKEN_EXPIRED: {
        readonly status: 401;
        readonly message: "JWT expired, refresh needed";
    };
    readonly FORBIDDEN: {
        readonly status: 403;
        readonly message: "Insufficient permissions";
    };
    readonly NOT_FOUND: {
        readonly status: 404;
        readonly message: "Resource not found";
    };
    readonly CONFLICT: {
        readonly status: 409;
        readonly message: "Version conflict";
    };
    readonly RATE_LIMITED: {
        readonly status: 429;
        readonly message: "Too many requests";
    };
    readonly VALIDATION_ERROR: {
        readonly status: 400;
        readonly message: "Invalid request data";
    };
    readonly INTERNAL_ERROR: {
        readonly status: 500;
        readonly message: "Internal server error";
    };
    readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly message: "Service temporarily unavailable";
    };
    readonly INVALID_REQUEST: {
        readonly status: 400;
        readonly message: "Malformed request";
    };
    readonly CONTENT_LIMIT_EXCEEDED: {
        readonly status: 400;
        readonly message: "Content exceeds size limits";
    };
    readonly BATCH_SIZE_EXCEEDED: {
        readonly status: 400;
        readonly message: "Too many items in batch";
    };
    readonly TIER_REQUIRED: {
        readonly status: 403;
        readonly message: "Higher tier required";
    };
    readonly PRIVACY_TIER_REQUIRED: {
        readonly status: 403;
        readonly message: "Private tier required for this operation";
    };
    readonly DUPLICATE: {
        readonly status: 409;
        readonly message: "Resource already exists";
    };
    readonly IDEMPOTENCY_MISMATCH: {
        readonly status: 409;
        readonly message: "Same key with different request body";
    };
    readonly UNPROCESSABLE: {
        readonly status: 422;
        readonly message: "Valid syntax but semantic error";
    };
    readonly UPSTREAM_ERROR: {
        readonly status: 502;
        readonly message: "Upstream service failed";
    };
};
type ApiErrorCode = keyof typeof API_ERROR_CODES;
declare function isApiErrorCode(value: unknown): value is ApiErrorCode;
/**
 * Expected latency and client timeout per endpoint type.
 * `expected_ms: null` means variable/streaming.
 */
declare const ENDPOINT_TIMEOUTS: {
    readonly health: {
        readonly expected_ms: 50;
        readonly client_timeout_ms: 5000;
    };
    readonly node_crud: {
        readonly expected_ms: 100;
        readonly client_timeout_ms: 10000;
    };
    readonly list: {
        readonly expected_ms: 200;
        readonly client_timeout_ms: 15000;
    };
    readonly search: {
        readonly expected_ms: 500;
        readonly client_timeout_ms: 30000;
    };
    readonly ingest_text: {
        readonly expected_ms: 2000;
        readonly client_timeout_ms: 30000;
    };
    readonly ingest_file: {
        readonly expected_ms: null;
        readonly client_timeout_ms: 60000;
    };
    readonly chat_sse: {
        readonly expected_ms: null;
        readonly client_timeout_ms: 120000;
    };
    readonly sync: {
        readonly expected_ms: 500;
        readonly client_timeout_ms: 30000;
    };
    readonly agent: {
        readonly expected_ms: 5000;
        readonly client_timeout_ms: 60000;
    };
};
type EndpointTimeoutType = keyof typeof ENDPOINT_TIMEOUTS;
/** Alerting thresholds for rate limiting monitoring */
declare const RATE_LIMIT_ALERT_THRESHOLDS: {
    readonly redis_failure_rate_percent: 1;
    readonly redis_failure_window_ms: 60000;
    readonly user_limit_hits_per_min: 10;
    readonly tier_utilization_percent: 90;
    readonly tier_utilization_window_ms: 300000;
    readonly fallback_active_max_ms: 30000;
};
declare const CURSOR_PAGINATION_DEFAULT_LIMIT = 50;
declare const CURSOR_PAGINATION_MAX_LIMIT = 100;
declare const OFFSET_PAGINATION_DEFAULT_LIMIT = 20;
declare const OFFSET_PAGINATION_MAX_LIMIT = 100;
/** Idempotency key cache duration (24 hours) */
declare const IDEMPOTENCY_TTL_MS = 86400000;
declare const RATE_LIMIT_ALGORITHMS: readonly ["sliding_window", "token_bucket"];
type RateLimitAlgorithm = typeof RATE_LIMIT_ALGORITHMS[number];
/**
 * Categories of rate limits checked per request.
 * Check order: endpoint-specific -> global tier -> daily -> concurrent.
 */
declare const RATE_LIMIT_TYPES: readonly ["api", "endpoint", "daily", "concurrent", "llm"];
type RateLimitType = typeof RATE_LIMIT_TYPES[number];
declare function isRateLimitType(value: unknown): value is RateLimitType;
declare const AUTH_METHODS: readonly ["jwt", "api_key"];
type AuthMethod = typeof AUTH_METHODS[number];
declare const API_KEY_PREFIX_LIVE = "sk_live_";
declare const API_KEY_PREFIX_TEST = "sk_test_";
declare const API_KEY_SCOPES: readonly ["full", "read_only"];
type ApiKeyScope = typeof API_KEY_SCOPES[number];
declare function isApiKeyScope(value: unknown): value is ApiKeyScope;
declare const EMBEDDING_STATUSES: readonly ["pending", "processing", "complete", "failed"];
type EmbeddingStatus = typeof EMBEDDING_STATUSES[number];
declare function isEmbeddingStatus(value: unknown): value is EmbeddingStatus;
declare const PRIVACY_TIERS: readonly ["standard", "private"];
type PrivacyTier = typeof PRIVACY_TIERS[number];
declare const LIFECYCLE_STATES: readonly ["active", "weak", "dormant", "summarized", "archived"];
type LifecycleState = typeof LIFECYCLE_STATES[number];
declare const EDGE_DIRECTIONS: readonly ["in", "out", "both"];
type EdgeDirection = typeof EDGE_DIRECTIONS[number];
declare function isEdgeDirection(value: unknown): value is EdgeDirection;
declare const INGEST_SOURCES: readonly ["chat", "file", "voice", "api"];
type IngestSource = typeof INGEST_SOURCES[number];
declare function isIngestSource(value: unknown): value is IngestSource;
declare const INGEST_MODES: readonly ["normal", "incognito"];
type IngestMode = typeof INGEST_MODES[number];
declare const INGEST_PRIORITIES: readonly ["normal", "high", "low"];
type IngestPriority = typeof INGEST_PRIORITIES[number];
declare const INGEST_ACTIONS: readonly ["saved", "ignored", "accumulated", "prompted"];
type IngestAction = typeof INGEST_ACTIONS[number];
declare function isIngestAction(value: unknown): value is IngestAction;
declare const JOB_STATUSES: readonly ["processing", "complete", "failed"];
type JobStatus = typeof JOB_STATUSES[number];
declare function isJobStatus(value: unknown): value is JobStatus;
declare const SYNC_OPERATIONS: readonly ["create", "update", "delete"];
type SyncOperation = typeof SYNC_OPERATIONS[number];
declare function isSyncOperation(value: unknown): value is SyncOperation;
declare const SYNC_TABLES: readonly ["nodes", "edges"];
type SyncTable = typeof SYNC_TABLES[number];
declare const SYNC_CONFLICT_TYPES: readonly ["VERSION_MISMATCH", "DELETED", "CONSTRAINT"];
type SyncConflictType = typeof SYNC_CONFLICT_TYPES[number];
declare function isSyncConflictType(value: unknown): value is SyncConflictType;
declare const SYNC_RESOLUTIONS: readonly ["keep_local", "keep_server", "merge"];
type SyncResolution = typeof SYNC_RESOLUTIONS[number];
declare function isSyncResolution(value: unknown): value is SyncResolution;
declare const FULL_SYNC_REASONS: readonly ["corruption", "reset", "new_device"];
type FullSyncReason = typeof FULL_SYNC_REASONS[number];
declare const AGENT_TOOL_CATEGORIES: readonly ["read", "write", "destructive"];
type AgentToolCategory = typeof AGENT_TOOL_CATEGORIES[number];
declare const ACTION_STATUSES: readonly ["completed", "failed", "undone"];
type ActionStatus = typeof ACTION_STATUSES[number];
declare const THEME_OPTIONS: readonly ["system", "light", "dark"];
type ThemeOption = typeof THEME_OPTIONS[number];
declare const AGENT_SUGGESTION_LEVELS: readonly ["all", "important_only", "none"];
type AgentSuggestionLevel = typeof AGENT_SUGGESTION_LEVELS[number];
declare const CREDIT_OPERATIONS: readonly ["chat_quick", "chat_standard", "chat_deep", "extraction", "agent", "embedding"];
type CreditOperation = typeof CREDIT_OPERATIONS[number];
declare const USAGE_GROUP_BY: readonly ["day", "operation"];
type UsageGroupBy = typeof USAGE_GROUP_BY[number];
declare const FLOW_TYPES: readonly ["chat", "sync", "ingestion"];
type FlowType = typeof FLOW_TYPES[number];
declare const CORS_ALLOWED_ORIGINS: readonly ["https://app.nous.app", "https://nous.app"];
declare const CORS_ALLOWED_METHODS: readonly ["GET", "POST", "PATCH", "DELETE", "OPTIONS"];
declare const CORS_ALLOWED_HEADERS: readonly ["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"];
declare const CORS_MAX_AGE_SECONDS = 86400;

/**
 * @module @nous/core/api
 * @description All interfaces and Zod schemas for the Nous API Layer (NAL)
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Consolidated from spec files: types, error-handling, rate-limiting, auth-middleware,
 * sse-chat, resource-endpoints, action-endpoints, system-endpoints, data-flows.
 *
 * Naming convention: InterfaceName + InterfaceNameSchema
 */

declare const UserTierSchema: z.ZodEnum<["free", "credits", "pro", "api_key"]>;
/**
 * Cursor-based pagination request parameters.
 * Used for: node lists, conversation lists, sync pull, action history.
 */
interface CursorPaginationRequest {
    cursor?: string;
    limit?: number;
}
declare const CursorPaginationRequestSchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    cursor?: string | undefined;
    limit?: number | undefined;
}, {
    cursor?: string | undefined;
    limit?: number | undefined;
}>;
/**
 * Cursor-based pagination response metadata.
 */
interface CursorPaginationResponse {
    cursor: string | null;
    next_cursor: string | null;
    has_more: boolean;
    limit: number;
    total?: number;
}
declare const CursorPaginationResponseSchema: z.ZodObject<{
    cursor: z.ZodNullable<z.ZodString>;
    next_cursor: z.ZodNullable<z.ZodString>;
    has_more: z.ZodBoolean;
    limit: z.ZodNumber;
    total: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    cursor: string | null;
    limit: number;
    next_cursor: string | null;
    has_more: boolean;
    total?: number | undefined;
}, {
    cursor: string | null;
    limit: number;
    next_cursor: string | null;
    has_more: boolean;
    total?: number | undefined;
}>;
/**
 * Offset-based pagination request parameters.
 * Used for: search results.
 */
interface OffsetPaginationRequest {
    offset?: number;
    limit?: number;
}
declare const OffsetPaginationRequestSchema: z.ZodObject<{
    offset: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    limit: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    limit?: number | undefined;
    offset?: number | undefined;
}, {
    limit?: number | undefined;
    offset?: number | undefined;
}>;
/**
 * Offset-based pagination response metadata.
 */
interface OffsetPaginationResponse {
    offset: number;
    limit: number;
    total: number;
    has_more: boolean;
}
declare const OffsetPaginationResponseSchema: z.ZodObject<{
    offset: z.ZodNumber;
    limit: z.ZodNumber;
    total: z.ZodNumber;
    has_more: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    limit: number;
    has_more: boolean;
    total: number;
    offset: number;
}, {
    limit: number;
    has_more: boolean;
    total: number;
    offset: number;
}>;
/** Standard API response wrapper for single-item endpoints. */
interface ApiResponse<T> {
    data: T;
    meta?: Record<string, unknown>;
    pagination?: CursorPaginationResponse | OffsetPaginationResponse;
}
/** Standard API response wrapper for list endpoints. */
interface ApiListResponse<T> {
    data: T[];
    pagination: CursorPaginationResponse | OffsetPaginationResponse;
    meta?: Record<string, unknown>;
}
/**
 * Extended API error response.
 * Extends storm-026's ApiErrorResponse with retry_after, docs_url, request tracing.
 */
interface ApiErrorResponseExtended {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id: string;
    retry_after?: number;
    docs_url?: string;
}
declare const ApiErrorResponseExtendedSchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
    details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    request_id: z.ZodString;
    retry_after: z.ZodOptional<z.ZodNumber>;
    docs_url: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    request_id: string;
    details?: Record<string, unknown> | undefined;
    retry_after?: number | undefined;
    docs_url?: string | undefined;
}, {
    code: string;
    message: string;
    request_id: string;
    details?: Record<string, unknown> | undefined;
    retry_after?: number | undefined;
    docs_url?: string | undefined;
}>;
/**
 * Field-level validation error detail.
 * Returned in the `details.fields` array of VALIDATION_ERROR responses.
 */
interface ValidationFieldError {
    path: string;
    message: string;
    limit?: number;
    actual?: number;
    soft_limit?: number;
    hard_limit?: number;
}
declare const ValidationFieldErrorSchema: z.ZodObject<{
    path: z.ZodString;
    message: z.ZodString;
    limit: z.ZodOptional<z.ZodNumber>;
    actual: z.ZodOptional<z.ZodNumber>;
    soft_limit: z.ZodOptional<z.ZodNumber>;
    hard_limit: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    path: string;
    message: string;
    limit?: number | undefined;
    actual?: number | undefined;
    soft_limit?: number | undefined;
    hard_limit?: number | undefined;
}, {
    path: string;
    message: string;
    limit?: number | undefined;
    actual?: number | undefined;
    soft_limit?: number | undefined;
    hard_limit?: number | undefined;
}>;
/**
 * Content limits reference returned in VALIDATION_ERROR responses.
 */
interface ContentLimitsInfo {
    title: number;
    body_soft: number;
    body_hard: number;
    summary: number;
}
declare const ContentLimitsInfoSchema: z.ZodObject<{
    title: z.ZodNumber;
    body_soft: z.ZodNumber;
    body_hard: z.ZodNumber;
    summary: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    title: number;
    body_soft: number;
    body_hard: number;
    summary: number;
}, {
    title: number;
    body_soft: number;
    body_hard: number;
    summary: number;
}>;
/**
 * Rate limit response headers included on every API response.
 * `Retry-After` is only included on 429 responses.
 */
interface RateLimitHeaders {
    'X-RateLimit-Limit': number;
    'X-RateLimit-Remaining': number;
    'X-RateLimit-Reset': number;
    'X-RateLimit-Window': number;
    'Retry-After'?: number;
}
/**
 * Authenticated request context extracted from JWT or API key.
 * Available to all route handlers after auth middleware.
 */
interface AuthContext {
    user_id: string;
    tier: UserTier;
    privacy_tier: PrivacyTier;
    auth_method: AuthMethod;
}
declare const AuthContextSchema: z.ZodObject<{
    user_id: z.ZodString;
    tier: z.ZodEnum<["free", "credits", "pro", "api_key"]>;
    privacy_tier: z.ZodEnum<["standard", "private"]>;
    auth_method: z.ZodEnum<["jwt", "api_key"]>;
}, "strip", z.ZodTypeAny, {
    user_id: string;
    tier: "free" | "credits" | "pro" | "api_key";
    privacy_tier: "standard" | "private";
    auth_method: "api_key" | "jwt";
}, {
    user_id: string;
    tier: "free" | "credits" | "pro" | "api_key";
    privacy_tier: "standard" | "private";
    auth_method: "api_key" | "jwt";
}>;
/**
 * Server-side record of an idempotent request.
 * Cached for 24 hours (IDEMPOTENCY_TTL_MS).
 *
 * @persisted
 */
interface IdempotencyRecord {
    _schemaVersion: number;
    key: string;
    request_hash: string;
    response: unknown;
    status_code: number;
    created_at: string;
    expires_at: string;
}
declare const IdempotencyRecordSchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    key: z.ZodString;
    request_hash: z.ZodString;
    response: z.ZodUnknown;
    status_code: z.ZodNumber;
    created_at: z.ZodString;
    expires_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    _schemaVersion: number;
    key: string;
    request_hash: string;
    status_code: number;
    created_at: string;
    expires_at: string;
    response?: unknown;
}, {
    _schemaVersion: number;
    key: string;
    request_hash: string;
    status_code: number;
    created_at: string;
    expires_at: string;
    response?: unknown;
}>;
/**
 * Embedding status information returned in node API responses.
 * The actual embedding vector is NOT returned (security, per storm-022).
 */
interface EmbeddingInfo {
    model: string;
    dimensions: number;
    status: EmbeddingStatus;
    estimated_completion?: string;
}
declare const EmbeddingInfoSchema: z.ZodObject<{
    model: z.ZodString;
    dimensions: z.ZodNumber;
    status: z.ZodEnum<["pending", "processing", "complete", "failed"]>;
    estimated_completion: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "pending" | "processing" | "complete" | "failed";
    model: string;
    dimensions: number;
    estimated_completion?: string | undefined;
}, {
    status: "pending" | "processing" | "complete" | "failed";
    model: string;
    dimensions: number;
    estimated_completion?: string | undefined;
}>;
/** Webhook callback payload sent by the server to a user-provided URL. */
interface WebhookCallback {
    event: string;
    job_id: string;
    status: string;
    results: Record<string, unknown>;
    timestamp: string;
}
declare const WebhookCallbackSchema: z.ZodObject<{
    event: z.ZodString;
    job_id: z.ZodString;
    status: z.ZodString;
    results: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: string;
    event: string;
    job_id: string;
    results: Record<string, unknown>;
    timestamp: string;
}, {
    status: string;
    event: string;
    job_id: string;
    results: Record<string, unknown>;
    timestamp: string;
}>;
/** Result of a rate limit check. */
interface RateLimitResult {
    allowed: boolean;
    limit: number;
    remaining: number;
    reset_at: string;
    retry_after?: number;
    limit_type: RateLimitType;
}
declare const RateLimitResultSchema: z.ZodObject<{
    allowed: z.ZodBoolean;
    limit: z.ZodNumber;
    remaining: z.ZodNumber;
    reset_at: z.ZodString;
    retry_after: z.ZodOptional<z.ZodNumber>;
    limit_type: z.ZodEnum<["api", "endpoint", "daily", "concurrent", "llm"]>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    allowed: boolean;
    remaining: number;
    reset_at: string;
    limit_type: "api" | "endpoint" | "daily" | "concurrent" | "llm";
    retry_after?: number | undefined;
}, {
    limit: number;
    allowed: boolean;
    remaining: number;
    reset_at: string;
    limit_type: "api" | "endpoint" | "daily" | "concurrent" | "llm";
    retry_after?: number | undefined;
}>;
/**
 * Internal state of a sliding window rate limiter.
 * Redis implementation: Sorted Set with timestamp scores.
 */
interface SlidingWindowState {
    key: string;
    count: number;
    window_start_ms: number;
    window_end_ms: number;
}
declare const SlidingWindowStateSchema: z.ZodObject<{
    key: z.ZodString;
    count: z.ZodNumber;
    window_start_ms: z.ZodNumber;
    window_end_ms: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    key: string;
    count: number;
    window_start_ms: number;
    window_end_ms: number;
}, {
    key: string;
    count: number;
    window_start_ms: number;
    window_end_ms: number;
}>;
/**
 * Internal state of a token bucket rate limiter.
 * Redis implementation: Hash with tokens and last_refill fields.
 */
interface TokenBucketState {
    key: string;
    tokens: number;
    last_refill_ms: number;
    max_tokens: number;
    refill_rate: number;
}
declare const TokenBucketStateSchema: z.ZodObject<{
    key: z.ZodString;
    tokens: z.ZodNumber;
    last_refill_ms: z.ZodNumber;
    max_tokens: z.ZodNumber;
    refill_rate: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    key: string;
    tokens: number;
    last_refill_ms: number;
    max_tokens: number;
    refill_rate: number;
}, {
    key: string;
    tokens: number;
    last_refill_ms: number;
    max_tokens: number;
    refill_rate: number;
}>;
/** Detailed 429 error response for rate limit exceeded. */
interface RateLimitErrorResponse {
    code: 'RATE_LIMITED';
    message: string;
    retry_after: number;
    limit: number;
    remaining: 0;
    window: number;
    reset_at: string;
    limit_type: RateLimitType;
    endpoint?: string;
    active_requests?: number;
    upgrade_url?: string;
    request_id: string;
    docs_url: string;
}
declare const RateLimitErrorResponseSchema: z.ZodObject<{
    code: z.ZodLiteral<"RATE_LIMITED">;
    message: z.ZodString;
    retry_after: z.ZodNumber;
    limit: z.ZodNumber;
    remaining: z.ZodLiteral<0>;
    window: z.ZodNumber;
    reset_at: z.ZodString;
    limit_type: z.ZodEnum<["api", "endpoint", "daily", "concurrent", "llm"]>;
    endpoint: z.ZodOptional<z.ZodString>;
    active_requests: z.ZodOptional<z.ZodNumber>;
    upgrade_url: z.ZodOptional<z.ZodString>;
    request_id: z.ZodString;
    docs_url: z.ZodString;
}, "strip", z.ZodTypeAny, {
    limit: number;
    code: "RATE_LIMITED";
    message: string;
    request_id: string;
    retry_after: number;
    docs_url: string;
    remaining: 0;
    reset_at: string;
    limit_type: "api" | "endpoint" | "daily" | "concurrent" | "llm";
    window: number;
    endpoint?: string | undefined;
    active_requests?: number | undefined;
    upgrade_url?: string | undefined;
}, {
    limit: number;
    code: "RATE_LIMITED";
    message: string;
    request_id: string;
    retry_after: number;
    docs_url: string;
    remaining: 0;
    reset_at: string;
    limit_type: "api" | "endpoint" | "daily" | "concurrent" | "llm";
    window: number;
    endpoint?: string | undefined;
    active_requests?: number | undefined;
    upgrade_url?: string | undefined;
}>;
/** Rate limiting Redis operations interface (external stubs). */
interface RateLimitRedisOps {
    slidingWindowCheck(key: string, windowMs: number, limit: number): Promise<RateLimitResult>;
    tokenBucketCheck(key: string, refillRate: number, maxTokens: number): Promise<RateLimitResult>;
    concurrentAdd(key: string, requestId: string, limit: number): Promise<RateLimitResult>;
    concurrentRemove(key: string, requestId: string): Promise<void>;
}
/** Rate limiting metrics snapshot for monitoring/observability. */
interface RateLimitMetrics {
    check_count: number;
    exceeded_count: number;
    bucket_utilization: number;
    redis_latency_ms: number;
    redis_failure_count: number;
    fallback_count: number;
}
declare const RateLimitMetricsSchema: z.ZodObject<{
    check_count: z.ZodNumber;
    exceeded_count: z.ZodNumber;
    bucket_utilization: z.ZodNumber;
    redis_latency_ms: z.ZodNumber;
    redis_failure_count: z.ZodNumber;
    fallback_count: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    check_count: number;
    exceeded_count: number;
    bucket_utilization: number;
    redis_latency_ms: number;
    redis_failure_count: number;
    fallback_count: number;
}, {
    check_count: number;
    exceeded_count: number;
    bucket_utilization: number;
    redis_latency_ms: number;
    redis_failure_count: number;
    fallback_count: number;
}>;
/**
 * JWT claims structure issued by Clerk.
 * Extracted from the Authorization header after validation.
 */
interface JWTClaims {
    sub: string;
    exp: number;
    iat: number;
    metadata: {
        tier: UserTier;
        privacy: PrivacyTier;
    };
}
declare const JWTClaimsSchema: z.ZodObject<{
    sub: z.ZodString;
    exp: z.ZodNumber;
    iat: z.ZodNumber;
    metadata: z.ZodObject<{
        tier: z.ZodEnum<["free", "credits", "pro", "api_key"]>;
        privacy: z.ZodEnum<["standard", "private"]>;
    }, "strip", z.ZodTypeAny, {
        tier: "free" | "credits" | "pro" | "api_key";
        privacy: "standard" | "private";
    }, {
        tier: "free" | "credits" | "pro" | "api_key";
        privacy: "standard" | "private";
    }>;
}, "strip", z.ZodTypeAny, {
    sub: string;
    exp: number;
    iat: number;
    metadata: {
        tier: "free" | "credits" | "pro" | "api_key";
        privacy: "standard" | "private";
    };
}, {
    sub: string;
    exp: number;
    iat: number;
    metadata: {
        tier: "free" | "credits" | "pro" | "api_key";
        privacy: "standard" | "private";
    };
}>;
/**
 * API key information for the Settings UI display.
 * The actual key value is NEVER stored or returned after creation.
 */
interface APIKeyDisplayInfo {
    id: string;
    name: string;
    prefix: string;
    scope: ApiKeyScope;
    created_at: string;
    last_used?: string;
}
declare const APIKeyDisplayInfoSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    prefix: z.ZodString;
    scope: z.ZodEnum<["full", "read_only"]>;
    created_at: z.ZodString;
    last_used: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    id: string;
    name: string;
    prefix: string;
    scope: "full" | "read_only";
    last_used?: string | undefined;
}, {
    created_at: string;
    id: string;
    name: string;
    prefix: string;
    scope: "full" | "read_only";
    last_used?: string | undefined;
}>;
/** Refresh token request body. POST /v1/auth/refresh */
interface RefreshTokenRequest {
    refresh_token: string;
}
declare const RefreshTokenRequestSchema: z.ZodObject<{
    refresh_token: z.ZodString;
}, "strip", z.ZodTypeAny, {
    refresh_token: string;
}, {
    refresh_token: string;
}>;
/** Refresh token response. */
interface RefreshTokenResponse {
    access_token: string;
    expires_in: number;
}
declare const RefreshTokenResponseSchema: z.ZodObject<{
    access_token: z.ZodString;
    expires_in: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    access_token: string;
    expires_in: number;
}, {
    access_token: string;
    expires_in: number;
}>;
/** session_start — First event, confirms session creation. */
interface ChatSessionStartEvent {
    session_id: string;
    conversation_id?: string;
}
declare const ChatSessionStartEventSchema: z.ZodObject<{
    session_id: z.ZodString;
    conversation_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    session_id: string;
    conversation_id?: string | undefined;
}, {
    session_id: string;
    conversation_id?: string | undefined;
}>;
/** retrieval_start — Signals beginning of retrieval phase. */
interface ChatRetrievalStartEvent {
    phase: string;
    query_processed: string;
}
declare const ChatRetrievalStartEventSchema: z.ZodObject<{
    phase: z.ZodString;
    query_processed: z.ZodString;
}, "strip", z.ZodTypeAny, {
    phase: string;
    query_processed: string;
}, {
    phase: string;
    query_processed: string;
}>;
/** retrieval_node — Emitted for each relevant node found during retrieval. */
interface ChatRetrievalNodeEvent {
    node_id: string;
    score: number;
    title: string;
}
declare const ChatRetrievalNodeEventSchema: z.ZodObject<{
    node_id: z.ZodString;
    score: z.ZodNumber;
    title: z.ZodString;
}, "strip", z.ZodTypeAny, {
    title: string;
    node_id: string;
    score: number;
}, {
    title: string;
    node_id: string;
    score: number;
}>;
/** retrieval_complete — Signals end of retrieval phase with summary. */
interface ChatRetrievalCompleteEvent {
    nodes_retrieved: number;
    time_ms: number;
}
declare const ChatRetrievalCompleteEventSchema: z.ZodObject<{
    nodes_retrieved: z.ZodNumber;
    time_ms: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    nodes_retrieved: number;
    time_ms: number;
}, {
    nodes_retrieved: number;
    time_ms: number;
}>;
/** response_start — Signals beginning of LLM response generation. */
interface ChatResponseStartEvent {
    model: string;
    estimated_cost: number;
}
declare const ChatResponseStartEventSchema: z.ZodObject<{
    model: z.ZodString;
    estimated_cost: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    model: string;
    estimated_cost: number;
}, {
    model: string;
    estimated_cost: number;
}>;
/** response_chunk — Streamed text chunk from LLM response. */
interface ChatResponseChunkEvent {
    content: string;
    index: number;
}
declare const ChatResponseChunkEventSchema: z.ZodObject<{
    content: z.ZodString;
    index: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    content: string;
    index: number;
}, {
    content: string;
    index: number;
}>;
/** Source node referenced in a chat response. */
interface ChatSource {
    node_id: string;
    title: string;
    relevance: number;
}
declare const ChatSourceSchema: z.ZodObject<{
    node_id: z.ZodString;
    title: z.ZodString;
    relevance: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    title: string;
    node_id: string;
    relevance: number;
}, {
    title: string;
    node_id: string;
    relevance: number;
}>;
/** response_complete — Signals end of LLM response with cost and metadata. */
interface ChatResponseCompleteEvent {
    total_tokens: number;
    actual_cost: number;
    thought_path?: string[];
    sources: ChatSource[];
}
declare const ChatResponseCompleteEventSchema: z.ZodObject<{
    total_tokens: z.ZodNumber;
    actual_cost: z.ZodNumber;
    thought_path: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    sources: z.ZodArray<z.ZodObject<{
        node_id: z.ZodString;
        title: z.ZodString;
        relevance: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        title: string;
        node_id: string;
        relevance: number;
    }, {
        title: string;
        node_id: string;
        relevance: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    total_tokens: number;
    actual_cost: number;
    sources: {
        title: string;
        node_id: string;
        relevance: number;
    }[];
    thought_path?: string[] | undefined;
}, {
    total_tokens: number;
    actual_cost: number;
    sources: {
        title: string;
        node_id: string;
        relevance: number;
    }[];
    thought_path?: string[] | undefined;
}>;
/** done — Signals end of stream. Empty data payload. */
interface ChatDoneEvent {
}
declare const ChatDoneEventSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
/** session_expired — Sent when reconnection is outside the 5-minute window. */
interface ChatSessionExpiredEvent {
    message: string;
}
declare const ChatSessionExpiredEventSchema: z.ZodObject<{
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
}, {
    message: string;
}>;
/** Union type of all chat SSE event data payloads. Discriminated on `type`. */
type ChatSSEEventData = {
    type: 'session_start';
    data: ChatSessionStartEvent;
} | {
    type: 'retrieval_start';
    data: ChatRetrievalStartEvent;
} | {
    type: 'retrieval_node';
    data: ChatRetrievalNodeEvent;
} | {
    type: 'retrieval_complete';
    data: ChatRetrievalCompleteEvent;
} | {
    type: 'response_start';
    data: ChatResponseStartEvent;
} | {
    type: 'response_chunk';
    data: ChatResponseChunkEvent;
} | {
    type: 'response_complete';
    data: ChatResponseCompleteEvent;
} | {
    type: 'done';
    data: ChatDoneEvent;
} | {
    type: 'session_expired';
    data: ChatSessionExpiredEvent;
} | {
    type: 'ping';
    data: Record<string, never>;
};
/**
 * API representation of a memory node.
 * NOT NousNode from storm-011 — a flattened, safe representation.
 * Embedding vector is NEVER included (security per storm-022).
 */
interface NodeResponse {
    id: string;
    type: string;
    subtype?: string;
    content: {
        title: string;
        body: string;
        summary?: string;
    };
    embedding?: EmbeddingInfo;
    neural: {
        stability: number;
        retrievability: number;
        importance: number;
    };
    temporal: {
        created_at: string;
        updated_at: string;
        last_accessed: string;
        access_count: number;
    };
    organization: {
        cluster_id?: string;
        tags: string[];
    };
    state: {
        lifecycle: LifecycleState;
        flags: string[];
    };
    version: number;
}
declare const NodeResponseSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    subtype: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        body: string;
        summary?: string | undefined;
    }, {
        title: string;
        body: string;
        summary?: string | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        model: z.ZodString;
        dimensions: z.ZodNumber;
        status: z.ZodEnum<["pending", "processing", "complete", "failed"]>;
        estimated_completion: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "pending" | "processing" | "complete" | "failed";
        model: string;
        dimensions: number;
        estimated_completion?: string | undefined;
    }, {
        status: "pending" | "processing" | "complete" | "failed";
        model: string;
        dimensions: number;
        estimated_completion?: string | undefined;
    }>>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        importance: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        importance: number;
    }, {
        stability: number;
        retrievability: number;
        importance: number;
    }>;
    temporal: z.ZodObject<{
        created_at: z.ZodString;
        updated_at: z.ZodString;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        created_at: string;
        updated_at: string;
        last_accessed: string;
        access_count: number;
    }, {
        created_at: string;
        updated_at: string;
        last_accessed: string;
        access_count: number;
    }>;
    organization: z.ZodObject<{
        cluster_id: z.ZodOptional<z.ZodString>;
        tags: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        tags: string[];
        cluster_id?: string | undefined;
    }, {
        tags: string[];
        cluster_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        lifecycle: z.ZodEnum<["active", "weak", "dormant", "summarized", "archived"]>;
        flags: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        lifecycle: "active" | "weak" | "dormant" | "summarized" | "archived";
        flags: string[];
    }, {
        lifecycle: "active" | "weak" | "dormant" | "summarized" | "archived";
        flags: string[];
    }>;
    version: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: string;
    id: string;
    content: {
        title: string;
        body: string;
        summary?: string | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        importance: number;
    };
    temporal: {
        created_at: string;
        updated_at: string;
        last_accessed: string;
        access_count: number;
    };
    organization: {
        tags: string[];
        cluster_id?: string | undefined;
    };
    state: {
        lifecycle: "active" | "weak" | "dormant" | "summarized" | "archived";
        flags: string[];
    };
    version: number;
    embedding?: {
        status: "pending" | "processing" | "complete" | "failed";
        model: string;
        dimensions: number;
        estimated_completion?: string | undefined;
    } | undefined;
    subtype?: string | undefined;
}, {
    type: string;
    id: string;
    content: {
        title: string;
        body: string;
        summary?: string | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        importance: number;
    };
    temporal: {
        created_at: string;
        updated_at: string;
        last_accessed: string;
        access_count: number;
    };
    organization: {
        tags: string[];
        cluster_id?: string | undefined;
    };
    state: {
        lifecycle: "active" | "weak" | "dormant" | "summarized" | "archived";
        flags: string[];
    };
    version: number;
    embedding?: {
        status: "pending" | "processing" | "complete" | "failed";
        model: string;
        dimensions: number;
        estimated_completion?: string | undefined;
    } | undefined;
    subtype?: string | undefined;
}>;
/** List nodes query parameters. GET /v1/nodes */
interface ListNodesParams extends CursorPaginationRequest {
    type?: string;
    updated_after?: string;
    include?: string;
}
declare const ListNodesParamsSchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodOptional<z.ZodNumber>;
    type: z.ZodOptional<z.ZodString>;
    updated_after: z.ZodOptional<z.ZodString>;
    include: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    cursor?: string | undefined;
    limit?: number | undefined;
    type?: string | undefined;
    updated_after?: string | undefined;
    include?: string | undefined;
}, {
    cursor?: string | undefined;
    limit?: number | undefined;
    type?: string | undefined;
    updated_after?: string | undefined;
    include?: string | undefined;
}>;
/** List nodes response. */
interface ListNodesResponse {
    data: NodeResponse[];
    pagination: CursorPaginationResponse;
}
/** Get node query parameters. GET /v1/nodes/:id */
interface GetNodeParams {
    include?: string;
}
declare const GetNodeParamsSchema: z.ZodObject<{
    include: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    include?: string | undefined;
}, {
    include?: string | undefined;
}>;
/** Get node response. */
interface GetNodeResponse {
    data: NodeResponse;
}
/**
 * Create node request body. POST /v1/nodes
 * Content limits: title 100, body soft 500/hard 2000, summary 200.
 */
interface CreateNodeRequest {
    type: string;
    subtype?: string;
    content: {
        title: string;
        body: string;
        summary?: string;
    };
    organization?: {
        tags?: string[];
    };
}
declare const CreateNodeRequestSchema: z.ZodObject<{
    type: z.ZodString;
    subtype: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        body: string;
        summary?: string | undefined;
    }, {
        title: string;
        body: string;
        summary?: string | undefined;
    }>;
    organization: z.ZodOptional<z.ZodObject<{
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        tags?: string[] | undefined;
    }, {
        tags?: string[] | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    type: string;
    content: {
        title: string;
        body: string;
        summary?: string | undefined;
    };
    subtype?: string | undefined;
    organization?: {
        tags?: string[] | undefined;
    } | undefined;
}, {
    type: string;
    content: {
        title: string;
        body: string;
        summary?: string | undefined;
    };
    subtype?: string | undefined;
    organization?: {
        tags?: string[] | undefined;
    } | undefined;
}>;
/** Create node response (201). */
interface CreateNodeResponse {
    data: NodeResponse;
    meta: {
        edges_created: number;
        auto_linked: boolean;
    };
}
/** Update node request body. PATCH /v1/nodes/:id */
interface UpdateNodeRequest {
    content?: Partial<{
        title: string;
        body: string;
        summary: string;
    }>;
    expected_version?: number;
}
declare const UpdateNodeRequestSchema: z.ZodObject<{
    content: z.ZodOptional<z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        title?: string | undefined;
        summary?: string | undefined;
        body?: string | undefined;
    }, {
        title?: string | undefined;
        summary?: string | undefined;
        body?: string | undefined;
    }>>;
    expected_version: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    content?: {
        title?: string | undefined;
        summary?: string | undefined;
        body?: string | undefined;
    } | undefined;
    expected_version?: number | undefined;
}, {
    content?: {
        title?: string | undefined;
        summary?: string | undefined;
        body?: string | undefined;
    } | undefined;
    expected_version?: number | undefined;
}>;
/** Batch create nodes request body. POST /v1/nodes/batch */
interface BatchCreateNodesRequest {
    nodes: CreateNodeRequest[];
    link_to_episode?: string;
}
declare const BatchCreateNodesRequestSchema: z.ZodObject<{
    nodes: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        subtype: z.ZodOptional<z.ZodString>;
        content: z.ZodObject<{
            title: z.ZodString;
            body: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            title: string;
            body: string;
            summary?: string | undefined;
        }, {
            title: string;
            body: string;
            summary?: string | undefined;
        }>;
        organization: z.ZodOptional<z.ZodObject<{
            tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            tags?: string[] | undefined;
        }, {
            tags?: string[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        content: {
            title: string;
            body: string;
            summary?: string | undefined;
        };
        subtype?: string | undefined;
        organization?: {
            tags?: string[] | undefined;
        } | undefined;
    }, {
        type: string;
        content: {
            title: string;
            body: string;
            summary?: string | undefined;
        };
        subtype?: string | undefined;
        organization?: {
            tags?: string[] | undefined;
        } | undefined;
    }>, "many">;
    link_to_episode: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    nodes: {
        type: string;
        content: {
            title: string;
            body: string;
            summary?: string | undefined;
        };
        subtype?: string | undefined;
        organization?: {
            tags?: string[] | undefined;
        } | undefined;
    }[];
    link_to_episode?: string | undefined;
}, {
    nodes: {
        type: string;
        content: {
            title: string;
            body: string;
            summary?: string | undefined;
        };
        subtype?: string | undefined;
        organization?: {
            tags?: string[] | undefined;
        } | undefined;
    }[];
    link_to_episode?: string | undefined;
}>;
/** A single failure item in a batch response. */
interface BatchFailureItem {
    index: number;
    error: {
        code: string;
        message: string;
    };
}
declare const BatchFailureItemSchema: z.ZodObject<{
    index: z.ZodNumber;
    error: z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
    }, {
        code: string;
        message: string;
    }>;
}, "strip", z.ZodTypeAny, {
    error: {
        code: string;
        message: string;
    };
    index: number;
}, {
    error: {
        code: string;
        message: string;
    };
    index: number;
}>;
/** Batch create nodes response (201). Partial success is possible. */
interface BatchCreateNodesResponse {
    data: {
        created: NodeResponse[];
        failed: BatchFailureItem[];
    };
    meta: {
        total: number;
        created_count: number;
        failed_count: number;
        batch_id: string;
    };
}
/** API representation of an edge between two nodes. */
interface EdgeResponse {
    id: string;
    source: string;
    target: string;
    type: string;
    strength: number;
    confidence: number;
    neural: {
        co_activation_count: number;
        last_co_activation: string;
    };
    created_at: string;
}
declare const EdgeResponseSchema: z.ZodObject<{
    id: z.ZodString;
    source: z.ZodString;
    target: z.ZodString;
    type: z.ZodString;
    strength: z.ZodNumber;
    confidence: z.ZodNumber;
    neural: z.ZodObject<{
        co_activation_count: z.ZodNumber;
        last_co_activation: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        co_activation_count: number;
        last_co_activation: string;
    }, {
        co_activation_count: number;
        last_co_activation: string;
    }>;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: string;
    created_at: string;
    id: string;
    neural: {
        co_activation_count: number;
        last_co_activation: string;
    };
    source: string;
    target: string;
    strength: number;
    confidence: number;
}, {
    type: string;
    created_at: string;
    id: string;
    neural: {
        co_activation_count: number;
        last_co_activation: string;
    };
    source: string;
    target: string;
    strength: number;
    confidence: number;
}>;
/** List edges for a node query parameters. GET /v1/nodes/:id/edges */
interface ListEdgesParams extends CursorPaginationRequest {
    direction?: EdgeDirection;
    type?: string;
}
declare const ListEdgesParamsSchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodOptional<z.ZodNumber>;
    direction: z.ZodOptional<z.ZodEnum<["in", "out", "both"]>>;
    type: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    cursor?: string | undefined;
    limit?: number | undefined;
    type?: string | undefined;
    direction?: "in" | "out" | "both" | undefined;
}, {
    cursor?: string | undefined;
    limit?: number | undefined;
    type?: string | undefined;
    direction?: "in" | "out" | "both" | undefined;
}>;
/** List edges response. */
interface ListEdgesResponse {
    data: EdgeResponse[];
    pagination: CursorPaginationResponse;
}
/** Create edge request body. POST /v1/edges */
interface CreateEdgeRequest {
    source: string;
    target: string;
    type: string;
    strength?: number;
}
declare const CreateEdgeRequestSchema: z.ZodObject<{
    source: z.ZodString;
    target: z.ZodString;
    type: z.ZodString;
    strength: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    type: string;
    source: string;
    target: string;
    strength?: number | undefined;
}, {
    type: string;
    source: string;
    target: string;
    strength?: number | undefined;
}>;
/** Update edge request body. PATCH /v1/edges/:id */
interface UpdateEdgeRequest {
    strength: number;
}
declare const UpdateEdgeRequestSchema: z.ZodObject<{
    strength: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    strength: number;
}, {
    strength: number;
}>;
/** Search result item containing a node and its relevance score. */
interface SearchResultItem {
    node: NodeResponse;
    score: number;
    score_breakdown?: {
        vector: number;
        bm25: number;
        combined: number;
    };
}
declare const SearchResultItemSchema: z.ZodObject<{
    node: z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        subtype: z.ZodOptional<z.ZodString>;
        content: z.ZodObject<{
            title: z.ZodString;
            body: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            title: string;
            body: string;
            summary?: string | undefined;
        }, {
            title: string;
            body: string;
            summary?: string | undefined;
        }>;
        embedding: z.ZodOptional<z.ZodObject<{
            model: z.ZodString;
            dimensions: z.ZodNumber;
            status: z.ZodEnum<["pending", "processing", "complete", "failed"]>;
            estimated_completion: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            status: "pending" | "processing" | "complete" | "failed";
            model: string;
            dimensions: number;
            estimated_completion?: string | undefined;
        }, {
            status: "pending" | "processing" | "complete" | "failed";
            model: string;
            dimensions: number;
            estimated_completion?: string | undefined;
        }>>;
        neural: z.ZodObject<{
            stability: z.ZodNumber;
            retrievability: z.ZodNumber;
            importance: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            stability: number;
            retrievability: number;
            importance: number;
        }, {
            stability: number;
            retrievability: number;
            importance: number;
        }>;
        temporal: z.ZodObject<{
            created_at: z.ZodString;
            updated_at: z.ZodString;
            last_accessed: z.ZodString;
            access_count: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            created_at: string;
            updated_at: string;
            last_accessed: string;
            access_count: number;
        }, {
            created_at: string;
            updated_at: string;
            last_accessed: string;
            access_count: number;
        }>;
        organization: z.ZodObject<{
            cluster_id: z.ZodOptional<z.ZodString>;
            tags: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            tags: string[];
            cluster_id?: string | undefined;
        }, {
            tags: string[];
            cluster_id?: string | undefined;
        }>;
        state: z.ZodObject<{
            lifecycle: z.ZodEnum<["active", "weak", "dormant", "summarized", "archived"]>;
            flags: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            lifecycle: "active" | "weak" | "dormant" | "summarized" | "archived";
            flags: string[];
        }, {
            lifecycle: "active" | "weak" | "dormant" | "summarized" | "archived";
            flags: string[];
        }>;
        version: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: string;
        id: string;
        content: {
            title: string;
            body: string;
            summary?: string | undefined;
        };
        neural: {
            stability: number;
            retrievability: number;
            importance: number;
        };
        temporal: {
            created_at: string;
            updated_at: string;
            last_accessed: string;
            access_count: number;
        };
        organization: {
            tags: string[];
            cluster_id?: string | undefined;
        };
        state: {
            lifecycle: "active" | "weak" | "dormant" | "summarized" | "archived";
            flags: string[];
        };
        version: number;
        embedding?: {
            status: "pending" | "processing" | "complete" | "failed";
            model: string;
            dimensions: number;
            estimated_completion?: string | undefined;
        } | undefined;
        subtype?: string | undefined;
    }, {
        type: string;
        id: string;
        content: {
            title: string;
            body: string;
            summary?: string | undefined;
        };
        neural: {
            stability: number;
            retrievability: number;
            importance: number;
        };
        temporal: {
            created_at: string;
            updated_at: string;
            last_accessed: string;
            access_count: number;
        };
        organization: {
            tags: string[];
            cluster_id?: string | undefined;
        };
        state: {
            lifecycle: "active" | "weak" | "dormant" | "summarized" | "archived";
            flags: string[];
        };
        version: number;
        embedding?: {
            status: "pending" | "processing" | "complete" | "failed";
            model: string;
            dimensions: number;
            estimated_completion?: string | undefined;
        } | undefined;
        subtype?: string | undefined;
    }>;
    score: z.ZodNumber;
    score_breakdown: z.ZodOptional<z.ZodObject<{
        vector: z.ZodNumber;
        bm25: z.ZodNumber;
        combined: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        vector: number;
        bm25: number;
        combined: number;
    }, {
        vector: number;
        bm25: number;
        combined: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    score: number;
    node: {
        type: string;
        id: string;
        content: {
            title: string;
            body: string;
            summary?: string | undefined;
        };
        neural: {
            stability: number;
            retrievability: number;
            importance: number;
        };
        temporal: {
            created_at: string;
            updated_at: string;
            last_accessed: string;
            access_count: number;
        };
        organization: {
            tags: string[];
            cluster_id?: string | undefined;
        };
        state: {
            lifecycle: "active" | "weak" | "dormant" | "summarized" | "archived";
            flags: string[];
        };
        version: number;
        embedding?: {
            status: "pending" | "processing" | "complete" | "failed";
            model: string;
            dimensions: number;
            estimated_completion?: string | undefined;
        } | undefined;
        subtype?: string | undefined;
    };
    score_breakdown?: {
        vector: number;
        bm25: number;
        combined: number;
    } | undefined;
}, {
    score: number;
    node: {
        type: string;
        id: string;
        content: {
            title: string;
            body: string;
            summary?: string | undefined;
        };
        neural: {
            stability: number;
            retrievability: number;
            importance: number;
        };
        temporal: {
            created_at: string;
            updated_at: string;
            last_accessed: string;
            access_count: number;
        };
        organization: {
            tags: string[];
            cluster_id?: string | undefined;
        };
        state: {
            lifecycle: "active" | "weak" | "dormant" | "summarized" | "archived";
            flags: string[];
        };
        version: number;
        embedding?: {
            status: "pending" | "processing" | "complete" | "failed";
            model: string;
            dimensions: number;
            estimated_completion?: string | undefined;
        } | undefined;
        subtype?: string | undefined;
    };
    score_breakdown?: {
        vector: number;
        bm25: number;
        combined: number;
    } | undefined;
}>;
/** Simple search query parameters. GET /v1/search */
interface SimpleSearchParams {
    q: string;
    type?: string;
    offset?: number;
    limit?: number;
}
declare const SimpleSearchParamsSchema: z.ZodObject<{
    q: z.ZodString;
    type: z.ZodOptional<z.ZodString>;
    offset: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    q: string;
    limit?: number | undefined;
    type?: string | undefined;
    offset?: number | undefined;
}, {
    q: string;
    limit?: number | undefined;
    type?: string | undefined;
    offset?: number | undefined;
}>;
/** Advanced search request body. POST /v1/search */
interface AdvancedSearchRequest {
    query: string;
    filters?: {
        types?: string[];
        date_range?: {
            start: string;
            end: string;
        };
        clusters?: string[];
        tags?: string[];
        lifecycle?: LifecycleState[];
    };
    options?: {
        include_scores?: boolean;
        score_breakdown?: boolean;
    };
    limit?: number;
    offset?: number;
}
declare const AdvancedSearchRequestSchema: z.ZodObject<{
    query: z.ZodString;
    filters: z.ZodOptional<z.ZodObject<{
        types: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        date_range: z.ZodOptional<z.ZodObject<{
            start: z.ZodString;
            end: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            start: string;
            end: string;
        }, {
            start: string;
            end: string;
        }>>;
        clusters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        lifecycle: z.ZodOptional<z.ZodArray<z.ZodEnum<["active", "weak", "dormant", "summarized", "archived"]>, "many">>;
    }, "strip", z.ZodTypeAny, {
        tags?: string[] | undefined;
        lifecycle?: ("active" | "weak" | "dormant" | "summarized" | "archived")[] | undefined;
        types?: string[] | undefined;
        date_range?: {
            start: string;
            end: string;
        } | undefined;
        clusters?: string[] | undefined;
    }, {
        tags?: string[] | undefined;
        lifecycle?: ("active" | "weak" | "dormant" | "summarized" | "archived")[] | undefined;
        types?: string[] | undefined;
        date_range?: {
            start: string;
            end: string;
        } | undefined;
        clusters?: string[] | undefined;
    }>>;
    options: z.ZodOptional<z.ZodObject<{
        include_scores: z.ZodOptional<z.ZodBoolean>;
        score_breakdown: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        score_breakdown?: boolean | undefined;
        include_scores?: boolean | undefined;
    }, {
        score_breakdown?: boolean | undefined;
        include_scores?: boolean | undefined;
    }>>;
    limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    query: string;
    limit?: number | undefined;
    options?: {
        score_breakdown?: boolean | undefined;
        include_scores?: boolean | undefined;
    } | undefined;
    offset?: number | undefined;
    filters?: {
        tags?: string[] | undefined;
        lifecycle?: ("active" | "weak" | "dormant" | "summarized" | "archived")[] | undefined;
        types?: string[] | undefined;
        date_range?: {
            start: string;
            end: string;
        } | undefined;
        clusters?: string[] | undefined;
    } | undefined;
}, {
    query: string;
    limit?: number | undefined;
    options?: {
        score_breakdown?: boolean | undefined;
        include_scores?: boolean | undefined;
    } | undefined;
    offset?: number | undefined;
    filters?: {
        tags?: string[] | undefined;
        lifecycle?: ("active" | "weak" | "dormant" | "summarized" | "archived")[] | undefined;
        types?: string[] | undefined;
        date_range?: {
            start: string;
            end: string;
        } | undefined;
        clusters?: string[] | undefined;
    } | undefined;
}>;
/** Search response (used by both simple and advanced search). */
interface SearchResponse {
    data: SearchResultItem[];
    pagination: OffsetPaginationResponse;
    meta: {
        query_time_ms: number;
        embedding_model?: string;
        retrieval_method?: string;
    };
}
/** Cluster list item for GET /v1/clusters. */
interface ClusterListItem {
    id: string;
    name: string;
    description: string;
    node_count: number;
    keywords: string[];
    color: string;
    created_at: string;
}
declare const ClusterListItemSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    node_count: z.ZodNumber;
    keywords: z.ZodArray<z.ZodString, "many">;
    color: z.ZodString;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    id: string;
    name: string;
    description: string;
    node_count: number;
    keywords: string[];
    color: string;
}, {
    created_at: string;
    id: string;
    name: string;
    description: string;
    node_count: number;
    keywords: string[];
    color: string;
}>;
/** Cluster detail response for GET /v1/clusters/:id. */
interface ClusterDetailResponse {
    data: ClusterListItem & {
        top_nodes: {
            id: string;
            title: string;
            importance: number;
        }[];
        related_clusters: {
            id: string;
            name: string;
            strength: number;
        }[];
    };
}
/** Update cluster request body. PATCH /v1/clusters/:id */
interface UpdateClusterRequest {
    name?: string;
    color?: string;
}
declare const UpdateClusterRequestSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    color?: string | undefined;
}, {
    name?: string | undefined;
    color?: string | undefined;
}>;
/** List clusters response. No pagination — cluster count is typically small. */
interface ListClustersResponse {
    data: ClusterListItem[];
}
/**
 * Chat request body. POST /v1/chat (with Accept: text/event-stream for SSE).
 * The response is an SSE stream — see ChatSSEEventData.
 */
interface ChatRequest {
    message: string;
    conversation_id?: string;
    options?: {
        include_retrieval?: boolean;
        include_thought_path?: boolean;
        max_tokens?: number;
        model_preference?: string | null;
    };
}
declare const ChatRequestSchema: z.ZodObject<{
    message: z.ZodString;
    conversation_id: z.ZodOptional<z.ZodString>;
    options: z.ZodOptional<z.ZodObject<{
        include_retrieval: z.ZodOptional<z.ZodBoolean>;
        include_thought_path: z.ZodOptional<z.ZodBoolean>;
        max_tokens: z.ZodOptional<z.ZodNumber>;
        model_preference: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        max_tokens?: number | undefined;
        include_retrieval?: boolean | undefined;
        include_thought_path?: boolean | undefined;
        model_preference?: string | null | undefined;
    }, {
        max_tokens?: number | undefined;
        include_retrieval?: boolean | undefined;
        include_thought_path?: boolean | undefined;
        model_preference?: string | null | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    message: string;
    options?: {
        max_tokens?: number | undefined;
        include_retrieval?: boolean | undefined;
        include_thought_path?: boolean | undefined;
        model_preference?: string | null | undefined;
    } | undefined;
    conversation_id?: string | undefined;
}, {
    message: string;
    options?: {
        max_tokens?: number | undefined;
        include_retrieval?: boolean | undefined;
        include_thought_path?: boolean | undefined;
        model_preference?: string | null | undefined;
    } | undefined;
    conversation_id?: string | undefined;
}>;
/** A single message in a conversation. */
interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    sources?: ChatSource[];
    cost?: number;
}
declare const ConversationMessageSchema: z.ZodObject<{
    role: z.ZodEnum<["user", "assistant"]>;
    content: z.ZodString;
    timestamp: z.ZodString;
    sources: z.ZodOptional<z.ZodArray<z.ZodObject<{
        node_id: z.ZodString;
        title: z.ZodString;
        relevance: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        title: string;
        node_id: string;
        relevance: number;
    }, {
        title: string;
        node_id: string;
        relevance: number;
    }>, "many">>;
    cost: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    timestamp: string;
    content: string;
    role: "user" | "assistant";
    sources?: {
        title: string;
        node_id: string;
        relevance: number;
    }[] | undefined;
    cost?: number | undefined;
}, {
    timestamp: string;
    content: string;
    role: "user" | "assistant";
    sources?: {
        title: string;
        node_id: string;
        relevance: number;
    }[] | undefined;
    cost?: number | undefined;
}>;
/** Conversation detail response. GET /v1/chat/conversations/:id */
interface ConversationDetailResponse {
    data: {
        id: string;
        messages: ConversationMessage[];
        total_cost: number;
        created_at: string;
        updated_at: string;
    };
}
/** Conversation summary for list view. */
interface ConversationSummary {
    id: string;
    preview: string;
    message_count: number;
    created_at: string;
    updated_at: string;
}
declare const ConversationSummarySchema: z.ZodObject<{
    id: z.ZodString;
    preview: z.ZodString;
    message_count: z.ZodNumber;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    id: string;
    updated_at: string;
    preview: string;
    message_count: number;
}, {
    created_at: string;
    id: string;
    updated_at: string;
    preview: string;
    message_count: number;
}>;
/** List conversations response. GET /v1/chat/conversations */
interface ListConversationsResponse {
    data: ConversationSummary[];
    pagination: CursorPaginationResponse;
}
/** Agent tool information. Returned in GET /v1/agent/tools. */
interface AgentToolInfo {
    name: string;
    description?: string;
    params?: unknown[];
    available_offline: boolean;
    credits: number;
    requires_confirmation?: boolean;
    preview_threshold?: number;
}
declare const AgentToolInfoSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    params: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    available_offline: z.ZodBoolean;
    credits: z.ZodNumber;
    requires_confirmation: z.ZodOptional<z.ZodBoolean>;
    preview_threshold: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    credits: number;
    name: string;
    available_offline: boolean;
    params?: unknown[] | undefined;
    description?: string | undefined;
    requires_confirmation?: boolean | undefined;
    preview_threshold?: number | undefined;
}, {
    credits: number;
    name: string;
    available_offline: boolean;
    params?: unknown[] | undefined;
    description?: string | undefined;
    requires_confirmation?: boolean | undefined;
    preview_threshold?: number | undefined;
}>;
/** Agent tools list response, categorized by type. GET /v1/agent/tools */
interface AgentToolsResponse {
    data: {
        read: AgentToolInfo[];
        write: AgentToolInfo[];
        destructive: AgentToolInfo[];
    };
}
/** Execute agent action request body. POST /v1/agent/actions */
interface ExecuteActionRequest {
    tool: string;
    params: Record<string, unknown>;
    dry_run?: boolean;
}
declare const ExecuteActionRequestSchema: z.ZodObject<{
    tool: z.ZodString;
    params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    dry_run: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    params: Record<string, unknown>;
    tool: string;
    dry_run?: boolean | undefined;
}, {
    params: Record<string, unknown>;
    tool: string;
    dry_run?: boolean | undefined;
}>;
/** Action result (returned when dry_run = false). */
interface ActionResult {
    action_id: string;
    tool: string;
    status: ActionStatus;
    results: Record<string, unknown>;
    credits_used: number;
    undoable: boolean;
    undo_expires?: string;
}
declare const ActionResultSchema: z.ZodObject<{
    action_id: z.ZodString;
    tool: z.ZodString;
    status: z.ZodEnum<["completed", "failed", "undone"]>;
    results: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    credits_used: z.ZodNumber;
    undoable: z.ZodBoolean;
    undo_expires: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "failed" | "completed" | "undone";
    results: Record<string, unknown>;
    tool: string;
    action_id: string;
    credits_used: number;
    undoable: boolean;
    undo_expires?: string | undefined;
}, {
    status: "failed" | "completed" | "undone";
    results: Record<string, unknown>;
    tool: string;
    action_id: string;
    credits_used: number;
    undoable: boolean;
    undo_expires?: string | undefined;
}>;
/** Preview result (returned when dry_run = true). */
interface PreviewResult {
    preview: true;
    affected_count: number;
    affected_nodes: {
        id: string;
        title: string;
    }[];
    estimated_credits: number;
    requires_confirmation: boolean;
}
declare const PreviewResultSchema: z.ZodObject<{
    preview: z.ZodLiteral<true>;
    affected_count: z.ZodNumber;
    affected_nodes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        title: string;
        id: string;
    }, {
        title: string;
        id: string;
    }>, "many">;
    estimated_credits: z.ZodNumber;
    requires_confirmation: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    preview: true;
    requires_confirmation: boolean;
    affected_count: number;
    affected_nodes: {
        title: string;
        id: string;
    }[];
    estimated_credits: number;
}, {
    preview: true;
    requires_confirmation: boolean;
    affected_count: number;
    affected_nodes: {
        title: string;
        id: string;
    }[];
    estimated_credits: number;
}>;
/** Execute action response. */
interface ExecuteActionResponse {
    data: ActionResult | PreviewResult;
}
/** Agent view response — node with full context. GET /v1/agent/view/:node_id */
interface AgentViewResponse {
    data: {
        node: Record<string, unknown>;
        context: {
            incoming_edges: Record<string, unknown>[];
            outgoing_edges: Record<string, unknown>[];
            cluster: Record<string, unknown>;
            related_nodes: Record<string, unknown>[];
        };
    };
}
/** Undo action response. POST /v1/agent/actions/:id/undo */
interface UndoActionResponse {
    data: {
        action_id: string;
        status: 'undone';
        restored: Record<string, unknown>;
        dependent_actions?: {
            id: string;
            status: 'also_undone';
            reason: string;
        }[];
    };
}
/** Action history item. */
interface ActionHistoryItem {
    id: string;
    tool: string;
    status: ActionStatus;
    timestamp: string;
    undoable: boolean;
    credits_used: number;
}
declare const ActionHistoryItemSchema: z.ZodObject<{
    id: z.ZodString;
    tool: z.ZodString;
    status: z.ZodEnum<["completed", "failed", "undone"]>;
    timestamp: z.ZodString;
    undoable: z.ZodBoolean;
    credits_used: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    status: "failed" | "completed" | "undone";
    timestamp: string;
    id: string;
    tool: string;
    credits_used: number;
    undoable: boolean;
}, {
    status: "failed" | "completed" | "undone";
    timestamp: string;
    id: string;
    tool: string;
    credits_used: number;
    undoable: boolean;
}>;
/** Action history list response. GET /v1/agent/actions */
interface ActionHistoryResponse {
    data: ActionHistoryItem[];
    pagination: CursorPaginationResponse;
}
/** Ingest text content request body. POST /v1/ingest (synchronous — returns 200). */
interface IngestTextRequest {
    content: string;
    source: IngestSource;
    mode?: IngestMode;
    options?: {
        auto_save?: boolean;
        force_save?: boolean;
        priority?: IngestPriority;
    };
}
declare const IngestTextRequestSchema: z.ZodObject<{
    content: z.ZodString;
    source: z.ZodEnum<["chat", "file", "voice", "api"]>;
    mode: z.ZodOptional<z.ZodEnum<["normal", "incognito"]>>;
    options: z.ZodOptional<z.ZodObject<{
        auto_save: z.ZodOptional<z.ZodBoolean>;
        force_save: z.ZodOptional<z.ZodBoolean>;
        priority: z.ZodOptional<z.ZodEnum<["normal", "high", "low"]>>;
    }, "strip", z.ZodTypeAny, {
        auto_save?: boolean | undefined;
        force_save?: boolean | undefined;
        priority?: "normal" | "high" | "low" | undefined;
    }, {
        auto_save?: boolean | undefined;
        force_save?: boolean | undefined;
        priority?: "normal" | "high" | "low" | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: string;
    source: "api" | "chat" | "file" | "voice";
    options?: {
        auto_save?: boolean | undefined;
        force_save?: boolean | undefined;
        priority?: "normal" | "high" | "low" | undefined;
    } | undefined;
    mode?: "normal" | "incognito" | undefined;
}, {
    content: string;
    source: "api" | "chat" | "file" | "voice";
    options?: {
        auto_save?: boolean | undefined;
        force_save?: boolean | undefined;
        priority?: "normal" | "high" | "low" | undefined;
    } | undefined;
    mode?: "normal" | "incognito" | undefined;
}>;
/** Ingestion classification result from storm-014's pipeline. */
interface IngestClassificationResponse {
    intent: string;
    save_signal: string;
    content_type: string;
    confidence: number;
    action_verb: string;
}
declare const IngestClassificationResponseSchema: z.ZodObject<{
    intent: z.ZodString;
    save_signal: z.ZodString;
    content_type: z.ZodString;
    confidence: z.ZodNumber;
    action_verb: z.ZodString;
}, "strip", z.ZodTypeAny, {
    confidence: number;
    intent: string;
    save_signal: string;
    content_type: string;
    action_verb: string;
}, {
    confidence: number;
    intent: string;
    save_signal: string;
    content_type: string;
    action_verb: string;
}>;
/** Summary of a created node (used in ingestion responses). */
interface CreatedNodeSummary {
    id: string;
    type: string;
    title: string;
    embedding_status: EmbeddingStatus;
}
declare const CreatedNodeSummarySchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    title: z.ZodString;
    embedding_status: z.ZodEnum<["pending", "processing", "complete", "failed"]>;
}, "strip", z.ZodTypeAny, {
    type: string;
    title: string;
    id: string;
    embedding_status: "pending" | "processing" | "complete" | "failed";
}, {
    type: string;
    title: string;
    id: string;
    embedding_status: "pending" | "processing" | "complete" | "failed";
}>;
/** Ingest text response (200 — synchronous). */
interface IngestTextResponse {
    data: {
        ingest_id: string;
        classification: IngestClassificationResponse;
        action: IngestAction;
        nodes_created: CreatedNodeSummary[];
        edges_created: number;
        thought_path?: string[];
    };
}
/** Ingest file response (202 — asynchronous). POST /v1/ingest/file */
interface IngestFileResponse {
    data: {
        job_id: string;
        status: 'processing';
        estimated_time_seconds: number;
        webhook_configured: boolean;
    };
}
/** Ingestion job stage for progress tracking. */
interface IngestJobStage {
    name: string;
    status: 'pending' | 'processing' | 'complete';
    progress?: number;
}
declare const IngestJobStageSchema: z.ZodObject<{
    name: z.ZodString;
    status: z.ZodEnum<["pending", "processing", "complete"]>;
    progress: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    status: "pending" | "processing" | "complete";
    name: string;
    progress?: number | undefined;
}, {
    status: "pending" | "processing" | "complete";
    name: string;
    progress?: number | undefined;
}>;
/** Ingestion job status response. GET /v1/ingest/jobs/:id */
interface IngestJobStatusResponse {
    data: {
        job_id: string;
        status: JobStatus;
        progress: number;
        current_stage?: string;
        stages?: IngestJobStage[];
        results?: {
            document_node?: string;
            chunks_created: number;
            concepts_extracted: number;
            edges_created: number;
            cost: number;
        };
    };
}
/** Sync status response. GET /v1/sync/status */
interface SyncStatusResponse {
    data: {
        last_sync: string;
        pending_changes: number;
        conflicts: number;
        db_version: number;
        client_behind_by: number;
    };
}
/** A single change in a sync push request. */
interface SyncChange {
    operation: SyncOperation;
    table: SyncTable;
    id?: string;
    local_id?: string;
    data?: Record<string, unknown>;
    expected_version?: number;
    client_timestamp: string;
}
declare const SyncChangeSchema: z.ZodObject<{
    operation: z.ZodEnum<["create", "update", "delete"]>;
    table: z.ZodEnum<["nodes", "edges"]>;
    id: z.ZodOptional<z.ZodString>;
    local_id: z.ZodOptional<z.ZodString>;
    data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    expected_version: z.ZodOptional<z.ZodNumber>;
    client_timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    operation: "create" | "update" | "delete";
    table: "nodes" | "edges";
    client_timestamp: string;
    id?: string | undefined;
    expected_version?: number | undefined;
    local_id?: string | undefined;
    data?: Record<string, unknown> | undefined;
}, {
    operation: "create" | "update" | "delete";
    table: "nodes" | "edges";
    client_timestamp: string;
    id?: string | undefined;
    expected_version?: number | undefined;
    local_id?: string | undefined;
    data?: Record<string, unknown> | undefined;
}>;
/** Sync push request body. POST /v1/sync/push */
interface SyncPushRequest {
    changes: SyncChange[];
    client_db_version: number;
}
declare const SyncPushRequestSchema: z.ZodObject<{
    changes: z.ZodArray<z.ZodObject<{
        operation: z.ZodEnum<["create", "update", "delete"]>;
        table: z.ZodEnum<["nodes", "edges"]>;
        id: z.ZodOptional<z.ZodString>;
        local_id: z.ZodOptional<z.ZodString>;
        data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        expected_version: z.ZodOptional<z.ZodNumber>;
        client_timestamp: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        operation: "create" | "update" | "delete";
        table: "nodes" | "edges";
        client_timestamp: string;
        id?: string | undefined;
        expected_version?: number | undefined;
        local_id?: string | undefined;
        data?: Record<string, unknown> | undefined;
    }, {
        operation: "create" | "update" | "delete";
        table: "nodes" | "edges";
        client_timestamp: string;
        id?: string | undefined;
        expected_version?: number | undefined;
        local_id?: string | undefined;
        data?: Record<string, unknown> | undefined;
    }>, "many">;
    client_db_version: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    changes: {
        operation: "create" | "update" | "delete";
        table: "nodes" | "edges";
        client_timestamp: string;
        id?: string | undefined;
        expected_version?: number | undefined;
        local_id?: string | undefined;
        data?: Record<string, unknown> | undefined;
    }[];
    client_db_version: number;
}, {
    changes: {
        operation: "create" | "update" | "delete";
        table: "nodes" | "edges";
        client_timestamp: string;
        id?: string | undefined;
        expected_version?: number | undefined;
        local_id?: string | undefined;
        data?: Record<string, unknown> | undefined;
    }[];
    client_db_version: number;
}>;
/** A successfully applied change in a sync push response. */
interface SyncAppliedItem {
    local_id?: string;
    server_id: string;
    version: number;
}
declare const SyncAppliedItemSchema: z.ZodObject<{
    local_id: z.ZodOptional<z.ZodString>;
    server_id: z.ZodString;
    version: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    version: number;
    server_id: string;
    local_id?: string | undefined;
}, {
    version: number;
    server_id: string;
    local_id?: string | undefined;
}>;
/** A conflict detected during sync push. */
interface SyncConflictItem {
    id: string;
    conflict_id: string;
    type: SyncConflictType;
    client_version: number;
    server_version: number;
    server_data: Record<string, unknown>;
    resolution_options: SyncResolution[];
}
declare const SyncConflictItemSchema: z.ZodObject<{
    id: z.ZodString;
    conflict_id: z.ZodString;
    type: z.ZodEnum<["VERSION_MISMATCH", "DELETED", "CONSTRAINT"]>;
    client_version: z.ZodNumber;
    server_version: z.ZodNumber;
    server_data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    resolution_options: z.ZodArray<z.ZodEnum<["keep_local", "keep_server", "merge"]>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "VERSION_MISMATCH" | "DELETED" | "CONSTRAINT";
    id: string;
    conflict_id: string;
    client_version: number;
    server_version: number;
    server_data: Record<string, unknown>;
    resolution_options: ("keep_local" | "keep_server" | "merge")[];
}, {
    type: "VERSION_MISMATCH" | "DELETED" | "CONSTRAINT";
    id: string;
    conflict_id: string;
    client_version: number;
    server_version: number;
    server_data: Record<string, unknown>;
    resolution_options: ("keep_local" | "keep_server" | "merge")[];
}>;
/** Sync push response. */
interface SyncPushResponse {
    data: {
        applied: SyncAppliedItem[];
        conflicts: SyncConflictItem[];
        server_db_version: number;
    };
}
/** Sync pull query parameters. GET /v1/sync/pull */
interface SyncPullParams {
    since_version: number;
    limit?: number;
}
declare const SyncPullParamsSchema: z.ZodObject<{
    since_version: z.ZodNumber;
    limit: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    since_version: number;
    limit?: number | undefined;
}, {
    since_version: number;
    limit?: number | undefined;
}>;
/** A change pulled from the server. */
interface PulledChange {
    table: SyncTable;
    id: string;
    operation: SyncOperation;
    data: Record<string, unknown>;
    version: number;
    timestamp: string;
}
declare const PulledChangeSchema: z.ZodObject<{
    table: z.ZodEnum<["nodes", "edges"]>;
    id: z.ZodString;
    operation: z.ZodEnum<["create", "update", "delete"]>;
    data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    version: z.ZodNumber;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    operation: "create" | "update" | "delete";
    timestamp: string;
    id: string;
    version: number;
    table: "nodes" | "edges";
    data: Record<string, unknown>;
}, {
    operation: "create" | "update" | "delete";
    timestamp: string;
    id: string;
    version: number;
    table: "nodes" | "edges";
    data: Record<string, unknown>;
}>;
/** Sync pull response. */
interface SyncPullResponse {
    data: {
        changes: PulledChange[];
        current_version: number;
        has_more: boolean;
    };
}
/** Resolve conflict request body. POST /v1/sync/conflicts/:id/resolve */
interface ResolveConflictRequest {
    resolution: SyncResolution;
    merged_data?: Record<string, unknown>;
}
declare const ResolveConflictRequestSchema: z.ZodObject<{
    resolution: z.ZodEnum<["keep_local", "keep_server", "merge"]>;
    merged_data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    resolution: "keep_local" | "keep_server" | "merge";
    merged_data?: Record<string, unknown> | undefined;
}, {
    resolution: "keep_local" | "keep_server" | "merge";
    merged_data?: Record<string, unknown> | undefined;
}>;
/** Resolve conflict response. */
interface ResolveConflictResponse {
    data: {
        resolved: boolean;
        final_version: number;
        final_data: Record<string, unknown>;
    };
}
/** Full sync request body (recovery). POST /v1/sync/full */
interface FullSyncRequest {
    reason: FullSyncReason;
}
declare const FullSyncRequestSchema: z.ZodObject<{
    reason: z.ZodEnum<["corruption", "reset", "new_device"]>;
}, "strip", z.ZodTypeAny, {
    reason: "corruption" | "reset" | "new_device";
}, {
    reason: "corruption" | "reset" | "new_device";
}>;
/** Full sync response (initiates async full sync job). */
interface FullSyncResponse {
    data: {
        job_id: string;
        status: 'initiated';
        estimated_time_seconds: number;
    };
}
/** Agent permissions configuration. */
interface AgentPermissions {
    can_write: boolean;
    can_auto_operations: boolean;
    can_delete: boolean;
    can_bulk_operations: boolean;
}
declare const AgentPermissionsSchema: z.ZodObject<{
    can_write: z.ZodBoolean;
    can_auto_operations: z.ZodBoolean;
    can_delete: z.ZodBoolean;
    can_bulk_operations: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    can_write: boolean;
    can_auto_operations: boolean;
    can_delete: boolean;
    can_bulk_operations: boolean;
}, {
    can_write: boolean;
    can_auto_operations: boolean;
    can_delete: boolean;
    can_bulk_operations: boolean;
}>;
/** Notification settings. */
interface NotificationSettings {
    daily_summary: boolean;
    sync_alerts: boolean;
    agent_suggestions: AgentSuggestionLevel;
}
declare const NotificationSettingsSchema: z.ZodObject<{
    daily_summary: z.ZodBoolean;
    sync_alerts: z.ZodBoolean;
    agent_suggestions: z.ZodEnum<["all", "important_only", "none"]>;
}, "strip", z.ZodTypeAny, {
    daily_summary: boolean;
    sync_alerts: boolean;
    agent_suggestions: "all" | "important_only" | "none";
}, {
    daily_summary: boolean;
    sync_alerts: boolean;
    agent_suggestions: "all" | "important_only" | "none";
}>;
/** User preferences. */
interface UserPreferences {
    theme: ThemeOption;
    language: string;
    working_memory_hours: number;
}
declare const UserPreferencesSchema: z.ZodObject<{
    theme: z.ZodEnum<["system", "light", "dark"]>;
    language: z.ZodString;
    working_memory_hours: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    theme: "system" | "light" | "dark";
    language: string;
    working_memory_hours: number;
}, {
    theme: "system" | "light" | "dark";
    language: string;
    working_memory_hours: number;
}>;
/** User settings response. GET /v1/settings */
interface UserSettingsResponse {
    data: {
        tier: UserTier;
        privacy_tier: PrivacyTier;
        agent_permissions: AgentPermissions;
        notifications: NotificationSettings;
        preferences: UserPreferences;
        api_keys: APIKeyDisplayInfo[];
    };
}
/** Update settings request body. PATCH /v1/settings */
interface UpdateSettingsRequest {
    agent_permissions?: Partial<AgentPermissions>;
    notifications?: Partial<NotificationSettings>;
    preferences?: Partial<UserPreferences>;
}
declare const UpdateSettingsRequestSchema: z.ZodObject<{
    agent_permissions: z.ZodOptional<z.ZodObject<{
        can_write: z.ZodOptional<z.ZodBoolean>;
        can_auto_operations: z.ZodOptional<z.ZodBoolean>;
        can_delete: z.ZodOptional<z.ZodBoolean>;
        can_bulk_operations: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        can_write?: boolean | undefined;
        can_auto_operations?: boolean | undefined;
        can_delete?: boolean | undefined;
        can_bulk_operations?: boolean | undefined;
    }, {
        can_write?: boolean | undefined;
        can_auto_operations?: boolean | undefined;
        can_delete?: boolean | undefined;
        can_bulk_operations?: boolean | undefined;
    }>>;
    notifications: z.ZodOptional<z.ZodObject<{
        daily_summary: z.ZodOptional<z.ZodBoolean>;
        sync_alerts: z.ZodOptional<z.ZodBoolean>;
        agent_suggestions: z.ZodOptional<z.ZodEnum<["all", "important_only", "none"]>>;
    }, "strip", z.ZodTypeAny, {
        daily_summary?: boolean | undefined;
        sync_alerts?: boolean | undefined;
        agent_suggestions?: "all" | "important_only" | "none" | undefined;
    }, {
        daily_summary?: boolean | undefined;
        sync_alerts?: boolean | undefined;
        agent_suggestions?: "all" | "important_only" | "none" | undefined;
    }>>;
    preferences: z.ZodOptional<z.ZodObject<{
        theme: z.ZodOptional<z.ZodEnum<["system", "light", "dark"]>>;
        language: z.ZodOptional<z.ZodString>;
        working_memory_hours: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        theme?: "system" | "light" | "dark" | undefined;
        language?: string | undefined;
        working_memory_hours?: number | undefined;
    }, {
        theme?: "system" | "light" | "dark" | undefined;
        language?: string | undefined;
        working_memory_hours?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    agent_permissions?: {
        can_write?: boolean | undefined;
        can_auto_operations?: boolean | undefined;
        can_delete?: boolean | undefined;
        can_bulk_operations?: boolean | undefined;
    } | undefined;
    notifications?: {
        daily_summary?: boolean | undefined;
        sync_alerts?: boolean | undefined;
        agent_suggestions?: "all" | "important_only" | "none" | undefined;
    } | undefined;
    preferences?: {
        theme?: "system" | "light" | "dark" | undefined;
        language?: string | undefined;
        working_memory_hours?: number | undefined;
    } | undefined;
}, {
    agent_permissions?: {
        can_write?: boolean | undefined;
        can_auto_operations?: boolean | undefined;
        can_delete?: boolean | undefined;
        can_bulk_operations?: boolean | undefined;
    } | undefined;
    notifications?: {
        daily_summary?: boolean | undefined;
        sync_alerts?: boolean | undefined;
        agent_suggestions?: "all" | "important_only" | "none" | undefined;
    } | undefined;
    preferences?: {
        theme?: "system" | "light" | "dark" | undefined;
        language?: string | undefined;
        working_memory_hours?: number | undefined;
    } | undefined;
}>;
/** Create API key request body. POST /v1/settings/api-keys */
interface CreateAPIKeyRequest {
    name: string;
    scope: ApiKeyScope;
}
declare const CreateAPIKeyRequestSchema: z.ZodObject<{
    name: z.ZodString;
    scope: z.ZodEnum<["full", "read_only"]>;
}, "strip", z.ZodTypeAny, {
    name: string;
    scope: "full" | "read_only";
}, {
    name: string;
    scope: "full" | "read_only";
}>;
/**
 * Create API key response (201).
 * The `key` field contains the full API key and is shown ONLY ONCE.
 */
interface CreateAPIKeyResponse {
    data: {
        id: string;
        name: string;
        key: string;
        scope: ApiKeyScope;
        created_at: string;
    };
}
/** Credit balance response. GET /v1/credits */
interface CreditBalanceResponse {
    data: {
        balance: number;
        tier: UserTier;
        daily_budget: number | null;
        daily_usage: number;
        free_credits_remaining: number;
        last_purchase?: string;
    };
}
/** Usage by day entry. */
interface UsageByDay {
    date: string;
    amount: number;
}
declare const UsageByDaySchema: z.ZodObject<{
    date: z.ZodString;
    amount: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    date: string;
    amount: number;
}, {
    date: string;
    amount: number;
}>;
/** Credit usage response. GET /v1/credits/usage */
interface CreditUsageResponse {
    data: {
        total: number;
        by_operation: Record<CreditOperation, number>;
        by_day: UsageByDay[];
    };
}
/** Cost estimate request body. POST /v1/credits/estimate */
interface CostEstimateRequest {
    operation: string;
    params: {
        message_length?: number;
        expected_retrieval?: number;
        complexity?: string;
    };
}
declare const CostEstimateRequestSchema: z.ZodObject<{
    operation: z.ZodString;
    params: z.ZodObject<{
        message_length: z.ZodOptional<z.ZodNumber>;
        expected_retrieval: z.ZodOptional<z.ZodNumber>;
        complexity: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        message_length?: number | undefined;
        expected_retrieval?: number | undefined;
        complexity?: string | undefined;
    }, {
        message_length?: number | undefined;
        expected_retrieval?: number | undefined;
        complexity?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    operation: string;
    params: {
        message_length?: number | undefined;
        expected_retrieval?: number | undefined;
        complexity?: string | undefined;
    };
}, {
    operation: string;
    params: {
        message_length?: number | undefined;
        expected_retrieval?: number | undefined;
        complexity?: string | undefined;
    };
}>;
/** Cost estimate response. */
interface CostEstimateResponse {
    data: {
        estimated_cost: {
            min: number;
            expected: number;
            max: number;
        };
        breakdown: {
            embedding: number;
            retrieval: number;
            llm_input: number;
            llm_output: number;
        };
        sufficient_balance: boolean;
    };
}
/** A single step in a data flow pipeline. */
interface FlowStep {
    name: string;
    service: string;
    description: string;
}
declare const FlowStepSchema: z.ZodObject<{
    name: z.ZodString;
    service: z.ZodString;
    description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    description: string;
    service: string;
}, {
    name: string;
    description: string;
    service: string;
}>;
/** Represents a running data flow instance for observability. */
interface FlowExecution {
    flow_type: FlowType;
    request_id: string;
    current_step: string;
    started_at: number;
    steps_completed: string[];
    error?: string;
}
declare const FlowExecutionSchema: z.ZodObject<{
    flow_type: z.ZodEnum<["chat", "sync", "ingestion"]>;
    request_id: z.ZodString;
    current_step: z.ZodString;
    started_at: z.ZodNumber;
    steps_completed: z.ZodArray<z.ZodString, "many">;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    request_id: string;
    flow_type: "chat" | "sync" | "ingestion";
    current_step: string;
    started_at: number;
    steps_completed: string[];
    error?: string | undefined;
}, {
    request_id: string;
    flow_type: "chat" | "sync" | "ingestion";
    current_step: string;
    started_at: number;
    steps_completed: string[];
    error?: string | undefined;
}>;

/**
 * @module @nous/core/api
 * @description Error creation and formatting — extended API errors, validation errors, content limit errors
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Pure functions for creating structured error responses.
 * Extends storm-026's base ApiErrorResponse with retry_after, docs_url, and field-level validation.
 *
 * Error response variants:
 * 1. Standard error — code, message, request_id, docs_url
 * 2. Rate limit 429 — adds retry_after, limit, remaining, window, reset_at
 * 3. Validation error — adds details.fields[] with per-field errors
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/error-handling.ts} - Spec
 */

/**
 * Get the HTTP status code for an API error code.
 *
 * @param code - One of the 17 API error codes
 * @returns HTTP status code (400, 401, 403, 404, 409, 422, 429, 500, 502, 503)
 */
declare function getHttpStatusForErrorCode(code: ApiErrorCode): number;
/**
 * Get the documentation URL for an error code.
 *
 * @param code - API error code
 * @returns URL to the error documentation page
 */
declare function getDocsUrl(code: ApiErrorCode): string;
/**
 * Get the content size limits for node creation/update validation.
 *
 * @returns Content limits reference with title, body_soft, body_hard, summary
 */
declare function getContentLimits(): ContentLimitsInfo;
/**
 * Create an extended API error response with optional rate-limit and retry fields.
 *
 * @param code - API error code
 * @param message - Human-readable error message
 * @param options - Optional fields: request_id, retry_after, docs_url override
 * @returns Structured error response
 */
declare function createExtendedApiError(code: ApiErrorCode, message: string, options?: {
    request_id?: string;
    retry_after?: number;
    details?: Record<string, unknown>;
    docs_url?: string;
}): ApiErrorResponseExtended;
/**
 * Create a VALIDATION_ERROR response with field-level error details.
 *
 * @param fields - Array of field validation errors
 * @param requestId - Optional request ID for tracing
 * @returns Structured validation error response
 */
declare function createValidationError(fields: ValidationFieldError[], requestId?: string): ApiErrorResponseExtended;
/**
 * Create a CONTENT_LIMIT_EXCEEDED error for a specific field.
 *
 * @param field - Field name that exceeded the limit (e.g., 'content.title')
 * @param limit - The limit that was exceeded
 * @param actual - The actual size of the content
 * @param requestId - Optional request ID for tracing
 * @returns Structured content limit error response
 */
declare function createContentLimitError(field: string, limit: number, actual: number, requestId?: string): ApiErrorResponseExtended;
/**
 * Create a BATCH_SIZE_EXCEEDED error.
 *
 * @param maxSize - Maximum allowed batch size
 * @param actualSize - Actual batch size submitted
 * @param requestId - Optional request ID for tracing
 * @returns Structured batch size error response
 */
declare function createBatchSizeError(maxSize: number, actualSize: number, requestId?: string): ApiErrorResponseExtended;

/**
 * @module @nous/core/api
 * @description Pagination helpers — cursor and offset normalization, result creation
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Pure functions for normalizing pagination parameters and creating pagination results.
 *
 * Two pagination strategies:
 * - Cursor-based: For sync/lists (consistent during concurrent writes)
 * - Offset-based: For search results (familiar jump-to-page UX)
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/pagination.ts} - Spec
 */

/**
 * Normalize and clamp cursor pagination parameters.
 * Applies defaults and enforces max limits.
 *
 * @param params - Raw pagination params from request
 * @returns Normalized params with valid limit
 */
declare function normalizeCursorParams(params: Partial<CursorPaginationRequest>): CursorPaginationRequest;
/**
 * Normalize and clamp offset pagination parameters.
 * Applies defaults and enforces max limits.
 *
 * @param params - Raw pagination params from request
 * @returns Normalized params with valid offset and limit
 */
declare function normalizeOffsetParams(params: Partial<OffsetPaginationRequest>): OffsetPaginationRequest;
/**
 * Create a cursor pagination response from a list of items.
 *
 * The cursor is opaque to the client (base64-encoded).
 * `has_more` is true when items.length === limit (more items may exist).
 *
 * @param items - Items returned from the query
 * @param limit - The limit that was applied
 * @param currentCursor - The cursor from the request (null for first page)
 * @param total - Optional total count (expensive to compute, omit if not needed)
 * @returns Cursor pagination metadata
 */
declare function createCursorPaginationResponse(items: unknown[], limit: number, currentCursor: string | null, total?: number): CursorPaginationResponse;
/**
 * Create an offset pagination response.
 *
 * @param offset - The offset that was applied
 * @param limit - The limit that was applied
 * @param total - Total count of matching items
 * @returns Offset pagination metadata
 */
declare function createOffsetPaginationResponse(offset: number, limit: number, total: number): OffsetPaginationResponse;

/**
 * @module @nous/core/api
 * @description Rate limiting pure functions and data — tier ranking, Redis key building, retry calculation
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Pure functions for the rate limiting system. These operate on data structures
 * defined in types.ts. Actual Redis I/O happens in the application layer via
 * the RateLimitRedisOps interface.
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/rate-limiting.ts} - Spec
 */

/**
 * Tier rank mapping for upgrade/downgrade detection.
 * Higher rank = higher tier. Used to determine tier transition behavior:
 * - Upgrade (rank increases): Apply new higher limits immediately
 * - Downgrade (rank decreases): Wait for current window to reset
 */
declare const TIER_RANKS: Record<UserTier, number>;
/**
 * Get the numeric rank for a user tier.
 * Used for upgrade/downgrade comparison.
 *
 * @param tier - User tier
 * @returns Numeric rank (0 = lowest, 3 = highest)
 *
 * @example
 * ```typescript
 * tierRank('pro')     // 3
 * tierRank('free')    // 0
 * tierRank('pro') > tierRank('free') // true (upgrade)
 * ```
 */
declare function tierRank(tier: UserTier): number;
/**
 * Build a Redis key from a pattern by substituting placeholders.
 *
 * @param pattern - Key pattern with `{placeholder}` syntax
 * @param params - Values to substitute
 * @returns Fully resolved Redis key
 *
 * @example
 * ```typescript
 * buildRedisKey('ratelimit:api:{user_id}', { user_id: 'user_123' })
 * // => 'ratelimit:api:user_123'
 * ```
 */
declare function buildRedisKey(pattern: string, params: Record<string, string>): string;
/**
 * Calculate retry_after for a sliding window that is full.
 * Returns the number of seconds until the oldest request in the window expires.
 *
 * @param windowMs - Window duration in milliseconds
 * @param oldestTimestamp - Oldest request timestamp in the window (ms since epoch)
 * @returns Seconds to wait before retrying
 */
declare function calculateRetryAfter(windowMs: number, oldestTimestamp: number): number;
/**
 * Calculate retry_after for a token bucket that is empty.
 * Returns the number of seconds until enough tokens are refilled.
 *
 * @param tokensNeeded - Number of tokens needed
 * @param refillRate - Tokens per second
 * @returns Seconds to wait before retrying
 */
declare function calculateTokenBucketRetryAfter(tokensNeeded: number, refillRate: number): number;
/**
 * Format rate limit response headers from a check result.
 *
 * @param result - Rate limit check result
 * @param windowSeconds - Window duration in seconds (default 60)
 * @returns Headers object to merge into HTTP response
 */
declare function formatRateLimitHeaders(result: RateLimitResult, windowSeconds?: number): RateLimitHeaders;
/**
 * Check rate limit for a request (orchestrates all limit checks).
 *
 * **EXTERNAL STUB** — requires Redis client and database access.
 *
 * @param _userId - User ID
 * @param _tier - User tier from JWT/API key
 * @param _endpoint - Request endpoint (e.g. 'POST /v1/chat')
 * @returns Most restrictive rate limit result
 */
declare function checkRateLimit(_userId: string, _tier: UserTier, _endpoint: string): Promise<RateLimitResult>;
/**
 * Get user tier with caching for tier transition detection.
 *
 * **EXTERNAL STUB** — requires database access.
 *
 * @param _userId - User ID
 * @param _cacheTtlSeconds - Cache TTL (default 60s)
 * @returns Current user tier from database
 */
declare function getTierWithCache(_userId: string, _cacheTtlSeconds?: number): Promise<UserTier>;

/**
 * @module @nous/core/api
 * @description Auth context extraction — JWT claims parsing, API key detection, token expiry check
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Pure functions for extracting authentication context from JWT tokens and API keys.
 *
 * Dual auth modes:
 * - JWT (Clerk): 15-minute access token, 30-day refresh. Contains tier + privacy in metadata.
 * - API Key: Prefixed with `sk_live_` or `sk_test_`. Separate rate bucket (api_key tier).
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/auth-middleware.ts} - Spec
 */

/**
 * Extract an AuthContext from validated JWT claims.
 *
 * Called after the JWT has been validated by Clerk. Extracts
 * user ID, tier, and privacy tier from the token claims.
 *
 * @param claims - Validated JWT claims from Clerk
 * @returns AuthContext for route handlers
 */
declare function extractAuthContextFromJWT(claims: JWTClaims): AuthContext;
/**
 * Check if a token string is an API key (starts with sk_live_ or sk_test_).
 *
 * @param token - Raw token from the Authorization header
 * @returns true if the token is an API key
 */
declare function isApiKeyToken(token: string): boolean;
/**
 * Check if a JWT token has expired.
 *
 * @param claims - JWT claims (only needs `exp` field)
 * @returns true if the token's exp timestamp is in the past
 */
declare function isTokenExpired(claims: Pick<JWTClaims, 'exp'>): boolean;
/**
 * Validate an auth token (JWT or API key) and return the AuthContext.
 *
 * **EXTERNAL STUB** — requires Clerk SDK or database access for API key validation.
 *
 * @param _token - Raw token from the Authorization header
 * @returns AuthContext extracted from the validated token
 */
declare function validateAuthToken(_token: string): Promise<AuthContext>;

/**
 * @module @nous/core/api
 * @description Chat SSE event formatting — event serialization, reconnection validation, event IDs
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Pure functions for Server-Sent Events (SSE) in the chat endpoint.
 *
 * SSE event types (10):
 * session_start -> retrieval_start -> retrieval_node (xN) -> retrieval_complete
 *   -> response_start -> response_chunk (xN) -> response_complete -> done
 * Plus: ping (keepalive every 15s), session_expired (reconnection too late)
 *
 * Reconnection: Client sends Last-Event-ID header. Server resumes if within 5-minute window.
 *
 * Chat SSE runs on regional containers (120s max), NOT edge workers (25s max from storm-026).
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/sse-chat.ts} - Spec
 */

/**
 * Format a chat SSE event for transmission over the wire.
 *
 * SSE wire format:
 * ```
 * event: <type>
 * id: <eventId>
 * data: <JSON>
 *
 * ```
 *
 * @param eventType - One of the 10 chat SSE event types
 * @param data - Event payload (will be JSON.stringify'd)
 * @param eventId - Unique event ID for reconnection support
 * @returns SSE-formatted string ready to write to response stream
 */
declare function formatChatSSEEvent(eventType: ChatSSEEventType, data: unknown, eventId: string): string;
/**
 * Check if a reconnection attempt is within the allowed time window.
 *
 * When a client reconnects with a Last-Event-ID, the server checks if the
 * original session is still within the reconnection window (default 5 minutes).
 *
 * @param lastEventTimestamp - Timestamp (ms since epoch) of the last event sent
 * @param windowMs - Reconnection window in milliseconds (default: CHAT_SSE_RECONNECT_WINDOW_MS = 300,000)
 * @returns true if the reconnection is within the allowed window
 */
declare function isReconnectionValid(lastEventTimestamp: number, windowMs?: number): boolean;
/**
 * Generate a sequential event ID for SSE events.
 *
 * Format: `{prefix}_{sequence}` where sequence is zero-padded to 3 digits.
 *
 * @param prefix - Session prefix (e.g., session ID)
 * @param sequence - Sequential event number (0-indexed)
 * @returns Event ID string (e.g., "sess_abc_001")
 */
declare function generateEventId(prefix: string, sequence: number): string;

/**
 * @module @nous/core/api
 * @description Request body validation — Zod-based validators for API endpoint request bodies
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Validation functions that parse request bodies using Zod schemas from types.ts.
 * Returns typed, validated data or throws a ZodError.
 *
 * These are thin wrappers around Zod's `.parse()` — the schemas do the real work.
 * The validators provide a clean API surface and can be used in route handlers.
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/types.ts} - Schema definitions
 */

/** Validate a POST /v1/nodes request body. */
declare function validateCreateNodeRequest(data: unknown): CreateNodeRequest;
/** Validate a PATCH /v1/nodes/:id request body. */
declare function validateUpdateNodeRequest(data: unknown): UpdateNodeRequest;
/** Validate a POST /v1/nodes/batch request body. */
declare function validateBatchCreateNodesRequest(data: unknown): BatchCreateNodesRequest;
/** Validate a POST /v1/edges request body. */
declare function validateCreateEdgeRequest(data: unknown): CreateEdgeRequest;
/** Validate a PATCH /v1/edges/:id request body. */
declare function validateUpdateEdgeRequest(data: unknown): UpdateEdgeRequest;
/** Validate a POST /v1/search request body. */
declare function validateAdvancedSearchRequest(data: unknown): AdvancedSearchRequest;
/** Validate a POST /v1/chat request body. */
declare function validateChatRequest(data: unknown): ChatRequest;
/** Validate a POST /v1/agent/actions request body. */
declare function validateExecuteActionRequest(data: unknown): ExecuteActionRequest;
/** Validate a POST /v1/ingest request body. */
declare function validateIngestTextRequest(data: unknown): IngestTextRequest;
/** Validate a POST /v1/sync/push request body. */
declare function validateSyncPushRequest(data: unknown): SyncPushRequest;
/** Validate a POST /v1/sync/conflicts/:id/resolve request body. */
declare function validateResolveConflictRequest(data: unknown): ResolveConflictRequest;
/** Validate a POST /v1/sync/full request body. */
declare function validateFullSyncRequest(data: unknown): FullSyncRequest;
/** Validate a PATCH /v1/settings request body. */
declare function validateUpdateSettingsRequest(data: unknown): UpdateSettingsRequest;
/** Validate a POST /v1/settings/api-keys request body. */
declare function validateCreateAPIKeyRequest(data: unknown): CreateAPIKeyRequest;
/** Validate a POST /v1/credits/estimate request body. */
declare function validateCostEstimateRequest(data: unknown): CostEstimateRequest;

/**
 * @module @nous/core/api
 * @description Data flow pipeline definitions — Chat, Sync, Ingestion flow steps
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Defines the three main data flow pipelines documented in the brainstorm:
 * 1. Chat/Query Flow: Auth -> Credits -> Classify -> Embed -> Search -> SSA -> LLM -> Store
 * 2. Sync Flow: Status -> Push -> Conflict Detection -> Apply -> Resolve -> Pull
 * 3. Ingestion Flow: Receive -> Classify -> Route -> Process -> Embed -> Dedup -> Commit
 *
 * Source: storm-023 v2 brainstorm, "Data Flow Diagrams" section.
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/data-flows.ts} - Spec
 */

/**
 * Complete Chat/Query Flow pipeline (9 steps).
 *
 * ```
 * Mobile App -> API Gateway -> Services
 * 1. Validate JWT              (Auth)
 * 2. Check credits             (Credits)
 * 3. Classify query            (Classifier — storm-008)
 * 4. Embed query               (Embedding — storm-016)
 * 5. Hybrid search             (Turso — Vector + BM25)
 * 6. SSA expansion             (Graph — storm-005)
 * 7. LLM call (streaming)      (LLM Provider — storm-015)
 * 8. Deduct actual cost        (Credits)
 * 9. Store conversation        (Turso)
 * ```
 */
declare const CHAT_FLOW_STEPS: readonly FlowStep[];
/**
 * Complete Sync Flow pipeline (6 steps).
 *
 * ```
 * Mobile App -> API Gateway -> Turso Cloud
 * 1. Check status              (Turso)
 * 2. Push changes              (Turso)
 * 3. Detect conflicts          (NSE — storm-033)
 * 4. Apply non-conflicting     (Turso)
 * 5. Resolve conflicts         (NSE + User — storm-033)
 * 6. Pull changes              (Turso)
 * ```
 */
declare const SYNC_FLOW_STEPS: readonly FlowStep[];
/**
 * Complete Ingestion Flow pipeline (8 steps).
 *
 * ```
 * Mobile App -> API Gateway -> Services
 * 1. Receive                   (Adapter — storm-014 stage 1)
 * 2. Classify                  (Classifier — storm-014 stage 2)
 * 3. Route                     (Router — select handler)
 * 4. Process                   (Extractor — extract concepts)
 * 5. Stage: Embed              (Embedding — storm-016)
 * 6. Stage: Dedup              (Turso — check duplicates)
 * 7. Commit: Nodes             (Turso — create records)
 * 8. Commit: Edges             (Graph — create edges)
 * ```
 */
declare const INGESTION_FLOW_STEPS: readonly FlowStep[];
/**
 * Get flow step definitions for a given flow type.
 *
 * @param flowType - One of 'chat', 'sync', 'ingestion'
 * @returns Array of flow steps for the specified flow
 */
declare function getFlowSteps(flowType: FlowType): readonly FlowStep[];
/**
 * Create a new flow execution tracker.
 *
 * @param flowType - Flow type to track
 * @param requestId - Unique request ID for this execution
 * @returns A new FlowExecution instance starting at step 0
 */
declare function createFlowExecution(flowType: FlowType, requestId: string): FlowExecution;

export { ACTION_STATUSES, AGENT_SUGGESTION_LEVELS, AGENT_TOOL_CATEGORIES, type APIKeyDisplayInfo, APIKeyDisplayInfoSchema, API_ERROR_CODES, API_KEY_PREFIX_LIVE, API_KEY_PREFIX_TEST, API_KEY_SCOPES, AUTH_METHODS, type ActionHistoryItem, ActionHistoryItemSchema, type ActionHistoryResponse, type ActionResult, ActionResultSchema, type ActionStatus, type AdvancedSearchRequest, AdvancedSearchRequestSchema, type AgentPermissions, AgentPermissionsSchema, type AgentSuggestionLevel, type AgentToolCategory, type AgentToolInfo, AgentToolInfoSchema, type AgentToolsResponse, type AgentViewResponse, type ApiErrorCode, type ApiErrorResponseExtended, ApiErrorResponseExtendedSchema, type ApiKeyScope, type ApiListResponse, type ApiResponse, type AuthContext, AuthContextSchema, type AuthMethod, BURST_ALLOWANCE_PERCENT, BURST_LIMITS, type BatchCreateNodesRequest, BatchCreateNodesRequestSchema, type BatchCreateNodesResponse, type BatchFailureItem, BatchFailureItemSchema, CHAT_FLOW_STEPS, CHAT_SSE_EVENT_TYPES, CHAT_SSE_KEEPALIVE_INTERVAL_MS, CHAT_SSE_MAX_DURATION_MS, CHAT_SSE_RECONNECT_WINDOW_MS, CONTENT_LIMITS, CORS_ALLOWED_HEADERS, CORS_ALLOWED_METHODS, CORS_ALLOWED_ORIGINS, CORS_MAX_AGE_SECONDS, CREDIT_OPERATIONS, CURSOR_PAGINATION_DEFAULT_LIMIT, CURSOR_PAGINATION_MAX_LIMIT, type ChatDoneEvent, ChatDoneEventSchema, type ChatRequest, ChatRequestSchema, type ChatResponseChunkEvent, ChatResponseChunkEventSchema, type ChatResponseCompleteEvent, ChatResponseCompleteEventSchema, type ChatResponseStartEvent, ChatResponseStartEventSchema, type ChatRetrievalCompleteEvent, ChatRetrievalCompleteEventSchema, type ChatRetrievalNodeEvent, ChatRetrievalNodeEventSchema, type ChatRetrievalStartEvent, ChatRetrievalStartEventSchema, type ChatSSEEventData, type ChatSSEEventType, type ChatSessionExpiredEvent, ChatSessionExpiredEventSchema, type ChatSessionStartEvent, ChatSessionStartEventSchema, type ChatSource, ChatSourceSchema, type ClusterDetailResponse, type ClusterListItem, ClusterListItemSchema, type ContentLimitsInfo, ContentLimitsInfoSchema, type ConversationDetailResponse, type ConversationMessage, ConversationMessageSchema, type ConversationSummary, ConversationSummarySchema, type CostEstimateRequest, CostEstimateRequestSchema, type CostEstimateResponse, type CreateAPIKeyRequest, CreateAPIKeyRequestSchema, type CreateAPIKeyResponse, type CreateEdgeRequest, CreateEdgeRequestSchema, type CreateNodeRequest, CreateNodeRequestSchema, type CreateNodeResponse, type CreatedNodeSummary, CreatedNodeSummarySchema, type CreditBalanceResponse, type CreditOperation, type CreditUsageResponse, type CursorPaginationRequest, CursorPaginationRequestSchema, type CursorPaginationResponse, CursorPaginationResponseSchema, EDGE_DIRECTIONS, EMBEDDING_STATUSES, ENDPOINT_RATE_LIMITS, ENDPOINT_TIMEOUTS, type EdgeDirection, type EdgeResponse, EdgeResponseSchema, type EmbeddingInfo, EmbeddingInfoSchema, type EmbeddingStatus, type EndpointTimeoutType, type ExecuteActionRequest, ExecuteActionRequestSchema, type ExecuteActionResponse, FLOW_TYPES, FULL_SYNC_REASONS, type FlowExecution, FlowExecutionSchema, type FlowStep, FlowStepSchema, type FlowType, type FullSyncReason, type FullSyncRequest, FullSyncRequestSchema, type FullSyncResponse, type GetNodeParams, GetNodeParamsSchema, type GetNodeResponse, IDEMPOTENCY_TTL_MS, INGESTION_FLOW_STEPS, INGEST_ACTIONS, INGEST_MODES, INGEST_PRIORITIES, INGEST_SOURCES, type IdempotencyRecord, IdempotencyRecordSchema, type IngestAction, type IngestClassificationResponse, IngestClassificationResponseSchema, type IngestFileResponse, type IngestJobStage, IngestJobStageSchema, type IngestJobStatusResponse, type IngestMode, type IngestPriority, type IngestSource, type IngestTextRequest, IngestTextRequestSchema, type IngestTextResponse, JOB_STATUSES, type JWTClaims, JWTClaimsSchema, type JobStatus, LIFECYCLE_STATES, type LifecycleState, type ListClustersResponse, type ListConversationsResponse, type ListEdgesParams, ListEdgesParamsSchema, type ListEdgesResponse, type ListNodesParams, ListNodesParamsSchema, type ListNodesResponse, type NodeResponse, NodeResponseSchema, type NotificationSettings, NotificationSettingsSchema, OFFSET_PAGINATION_DEFAULT_LIMIT, OFFSET_PAGINATION_MAX_LIMIT, type OffsetPaginationRequest, OffsetPaginationRequestSchema, type OffsetPaginationResponse, OffsetPaginationResponseSchema, PRIVACY_TIERS, type PreviewResult, PreviewResultSchema, type PrivacyTier, type PulledChange, PulledChangeSchema, RATE_LIMIT_ALERT_THRESHOLDS, RATE_LIMIT_ALGORITHMS, RATE_LIMIT_TYPES, REDIS_FALLBACK_LIMIT_PERCENT, REDIS_KEY_PATTERNS, REDIS_TTL_API_MS, REDIS_TTL_CONCURRENT_MS, REDIS_TTL_ENDPOINT_MS, REDIS_TTL_LLM_MS, type RateLimitAlgorithm, type RateLimitErrorResponse, RateLimitErrorResponseSchema, type RateLimitHeaders, type RateLimitMetrics, RateLimitMetricsSchema, type RateLimitRedisOps, type RateLimitResult, RateLimitResultSchema, type RateLimitType, type RateLimitedEndpoint, type RedisKeyType, type RefreshTokenRequest, RefreshTokenRequestSchema, type RefreshTokenResponse, RefreshTokenResponseSchema, type ResolveConflictRequest, ResolveConflictRequestSchema, type ResolveConflictResponse, SYNC_CONFLICT_TYPES, SYNC_FLOW_STEPS, SYNC_OPERATIONS, SYNC_RESOLUTIONS, SYNC_TABLES, type SearchResponse, type SearchResultItem, SearchResultItemSchema, type SimpleSearchParams, SimpleSearchParamsSchema, type SlidingWindowState, SlidingWindowStateSchema, type SyncAppliedItem, SyncAppliedItemSchema, type SyncChange, SyncChangeSchema, type SyncConflictItem, SyncConflictItemSchema, type SyncConflictType, type SyncOperation, type SyncPullParams, SyncPullParamsSchema, type SyncPullResponse, type SyncPushRequest, SyncPushRequestSchema, type SyncPushResponse, type SyncResolution, type SyncStatusResponse, type SyncTable, THEME_OPTIONS, TIER_LIMITS, TIER_RANKS, type ThemeOption, type TierLimitConfig, type TokenBucketState, TokenBucketStateSchema, USAGE_GROUP_BY, USER_TIERS, type UndoActionResponse, type UpdateClusterRequest, UpdateClusterRequestSchema, type UpdateEdgeRequest, UpdateEdgeRequestSchema, type UpdateNodeRequest, UpdateNodeRequestSchema, type UpdateSettingsRequest, UpdateSettingsRequestSchema, type UsageByDay, UsageByDaySchema, type UsageGroupBy, type UserPreferences, UserPreferencesSchema, type UserSettingsResponse, type UserTier, UserTierSchema, type ValidationFieldError, ValidationFieldErrorSchema, type WebhookCallback, WebhookCallbackSchema, buildRedisKey, calculateRetryAfter, calculateTokenBucketRetryAfter, checkRateLimit, createBatchSizeError, createContentLimitError, createCursorPaginationResponse, createExtendedApiError, createFlowExecution, createOffsetPaginationResponse, createValidationError, extractAuthContextFromJWT, formatChatSSEEvent, formatRateLimitHeaders, generateEventId, getContentLimits, getDocsUrl, getFlowSteps, getHttpStatusForErrorCode, getTierWithCache, isApiErrorCode, isApiKeyScope, isApiKeyToken, isChatSSEEventType, isEdgeDirection, isEmbeddingStatus, isIngestAction, isIngestSource, isJobStatus, isRateLimitType, isRateLimitedEndpoint, isReconnectionValid, isSyncConflictType, isSyncOperation, isSyncResolution, isTokenExpired, isUserTier, normalizeCursorParams, normalizeOffsetParams, tierRank, validateAdvancedSearchRequest, validateAuthToken, validateBatchCreateNodesRequest, validateChatRequest, validateCostEstimateRequest, validateCreateAPIKeyRequest, validateCreateEdgeRequest, validateCreateNodeRequest, validateExecuteActionRequest, validateFullSyncRequest, validateIngestTextRequest, validateResolveConflictRequest, validateSyncPushRequest, validateUpdateEdgeRequest, validateUpdateNodeRequest, validateUpdateSettingsRequest };
