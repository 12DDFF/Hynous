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

import { z } from 'zod';

import type {
  UserTier,
  EmbeddingStatus,
  LifecycleState,
  EdgeDirection,
  AuthMethod,
  PrivacyTier,
  ApiKeyScope,
  RateLimitType,
  IngestSource,
  IngestMode,
  IngestPriority,
  IngestAction,
  JobStatus,
  ActionStatus,
  SyncOperation,
  SyncTable,
  SyncConflictType,
  SyncResolution,
  FullSyncReason,
  AgentSuggestionLevel,
  ThemeOption,
  CreditOperation,
  FlowType,
} from './constants';

import {
  USER_TIERS,
  EMBEDDING_STATUSES,
  LIFECYCLE_STATES,
  EDGE_DIRECTIONS,
  API_KEY_SCOPES,
  INGEST_SOURCES,
  INGEST_MODES,
  INGEST_PRIORITIES,
  ACTION_STATUSES,
  SYNC_OPERATIONS,
  SYNC_TABLES,
  SYNC_CONFLICT_TYPES,
  SYNC_RESOLUTIONS,
  FULL_SYNC_REASONS,
  AGENT_SUGGESTION_LEVELS,
  THEME_OPTIONS,
  PRIVACY_TIERS,
  FLOW_TYPES,
  CURSOR_PAGINATION_DEFAULT_LIMIT,
  CURSOR_PAGINATION_MAX_LIMIT,
  OFFSET_PAGINATION_DEFAULT_LIMIT,
  OFFSET_PAGINATION_MAX_LIMIT,
} from './constants';

// ============================================================
// HELPER SCHEMAS (reused throughout)
// ============================================================

export const UserTierSchema = z.enum(USER_TIERS);

// ============================================================
// PAGINATION: CURSOR-BASED
// ============================================================

/**
 * Cursor-based pagination request parameters.
 * Used for: node lists, conversation lists, sync pull, action history.
 */
export interface CursorPaginationRequest {
  cursor?: string;
  limit?: number;
}

export const CursorPaginationRequestSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(CURSOR_PAGINATION_MAX_LIMIT).default(CURSOR_PAGINATION_DEFAULT_LIMIT).optional(),
});

/**
 * Cursor-based pagination response metadata.
 */
export interface CursorPaginationResponse {
  cursor: string | null;
  next_cursor: string | null;
  has_more: boolean;
  limit: number;
  total?: number;
}

export const CursorPaginationResponseSchema = z.object({
  cursor: z.string().nullable(),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
  limit: z.number().int(),
  total: z.number().int().optional(),
});

// ============================================================
// PAGINATION: OFFSET-BASED
// ============================================================

/**
 * Offset-based pagination request parameters.
 * Used for: search results.
 */
export interface OffsetPaginationRequest {
  offset?: number;
  limit?: number;
}

export const OffsetPaginationRequestSchema = z.object({
  offset: z.number().int().min(0).default(0).optional(),
  limit: z.number().int().min(1).max(OFFSET_PAGINATION_MAX_LIMIT).default(OFFSET_PAGINATION_DEFAULT_LIMIT).optional(),
});

/**
 * Offset-based pagination response metadata.
 */
export interface OffsetPaginationResponse {
  offset: number;
  limit: number;
  total: number;
  has_more: boolean;
}

export const OffsetPaginationResponseSchema = z.object({
  offset: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  has_more: z.boolean(),
});

// ============================================================
// API RESPONSE WRAPPERS
// ============================================================

/** Standard API response wrapper for single-item endpoints. */
export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
  pagination?: CursorPaginationResponse | OffsetPaginationResponse;
}

/** Standard API response wrapper for list endpoints. */
export interface ApiListResponse<T> {
  data: T[];
  pagination: CursorPaginationResponse | OffsetPaginationResponse;
  meta?: Record<string, unknown>;
}

// ============================================================
// ERROR RESPONSES
// ============================================================

/**
 * Extended API error response.
 * Extends storm-026's ApiErrorResponse with retry_after, docs_url, request tracing.
 */
export interface ApiErrorResponseExtended {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  request_id: string;
  retry_after?: number;
  docs_url?: string;
}

export const ApiErrorResponseExtendedSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  request_id: z.string(),
  retry_after: z.number().optional(),
  docs_url: z.string().url().optional(),
});

/**
 * Field-level validation error detail.
 * Returned in the `details.fields` array of VALIDATION_ERROR responses.
 */
export interface ValidationFieldError {
  path: string;
  message: string;
  limit?: number;
  actual?: number;
  soft_limit?: number;
  hard_limit?: number;
}

export const ValidationFieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  limit: z.number().optional(),
  actual: z.number().optional(),
  soft_limit: z.number().optional(),
  hard_limit: z.number().optional(),
});

/**
 * Content limits reference returned in VALIDATION_ERROR responses.
 */
export interface ContentLimitsInfo {
  title: number;
  body_soft: number;
  body_hard: number;
  summary: number;
}

export const ContentLimitsInfoSchema = z.object({
  title: z.number().int().positive(),
  body_soft: z.number().int().positive(),
  body_hard: z.number().int().positive(),
  summary: z.number().int().positive(),
});

// ============================================================
// RATE LIMIT HEADERS
// ============================================================

/**
 * Rate limit response headers included on every API response.
 * `Retry-After` is only included on 429 responses.
 */
export interface RateLimitHeaders {
  'X-RateLimit-Limit': number;
  'X-RateLimit-Remaining': number;
  'X-RateLimit-Reset': number;
  'X-RateLimit-Window': number;
  'Retry-After'?: number;
}

// ============================================================
// AUTH CONTEXT
// ============================================================

/**
 * Authenticated request context extracted from JWT or API key.
 * Available to all route handlers after auth middleware.
 */
export interface AuthContext {
  user_id: string;
  tier: UserTier;
  privacy_tier: PrivacyTier;
  auth_method: AuthMethod;
}

export const AuthContextSchema = z.object({
  user_id: z.string(),
  tier: UserTierSchema,
  privacy_tier: z.enum(PRIVACY_TIERS),
  auth_method: z.enum(['jwt', 'api_key']),
});

// ============================================================
// IDEMPOTENCY
// ============================================================

/**
 * Server-side record of an idempotent request.
 * Cached for 24 hours (IDEMPOTENCY_TTL_MS).
 *
 * @persisted
 */
export interface IdempotencyRecord {
  _schemaVersion: number;
  key: string;
  request_hash: string;
  response: unknown;
  status_code: number;
  created_at: string;
  expires_at: string;
}

export const IdempotencyRecordSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  key: z.string(),
  request_hash: z.string(),
  response: z.unknown(),
  status_code: z.number().int(),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
});

// ============================================================
// EMBEDDING INFO
// ============================================================

/**
 * Embedding status information returned in node API responses.
 * The actual embedding vector is NOT returned (security, per storm-022).
 */
export interface EmbeddingInfo {
  model: string;
  dimensions: number;
  status: EmbeddingStatus;
  estimated_completion?: string;
}

export const EmbeddingInfoSchema = z.object({
  model: z.string(),
  dimensions: z.number().int().positive(),
  status: z.enum(EMBEDDING_STATUSES),
  estimated_completion: z.string().datetime().optional(),
});

// ============================================================
// WEBHOOK CALLBACK
// ============================================================

/** Webhook callback payload sent by the server to a user-provided URL. */
export interface WebhookCallback {
  event: string;
  job_id: string;
  status: string;
  results: Record<string, unknown>;
  timestamp: string;
}

export const WebhookCallbackSchema = z.object({
  event: z.string(),
  job_id: z.string(),
  status: z.string(),
  results: z.record(z.unknown()),
  timestamp: z.string().datetime(),
});

// ============================================================
// RATE LIMIT RESULT
// ============================================================

/** Result of a rate limit check. */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset_at: string;
  retry_after?: number;
  limit_type: RateLimitType;
}

export const RateLimitResultSchema = z.object({
  allowed: z.boolean(),
  limit: z.number().int(),
  remaining: z.number().int().min(0),
  reset_at: z.string().datetime(),
  retry_after: z.number().optional(),
  limit_type: z.enum(['api', 'endpoint', 'daily', 'concurrent', 'llm']),
});

// ============================================================
// RATE LIMITING: SLIDING WINDOW STATE
// ============================================================

/**
 * Internal state of a sliding window rate limiter.
 * Redis implementation: Sorted Set with timestamp scores.
 */
export interface SlidingWindowState {
  key: string;
  count: number;
  window_start_ms: number;
  window_end_ms: number;
}

export const SlidingWindowStateSchema = z.object({
  key: z.string(),
  count: z.number().int().min(0),
  window_start_ms: z.number().int(),
  window_end_ms: z.number().int(),
});

// ============================================================
// RATE LIMITING: TOKEN BUCKET STATE
// ============================================================

/**
 * Internal state of a token bucket rate limiter.
 * Redis implementation: Hash with tokens and last_refill fields.
 */
export interface TokenBucketState {
  key: string;
  tokens: number;
  last_refill_ms: number;
  max_tokens: number;
  refill_rate: number;
}

export const TokenBucketStateSchema = z.object({
  key: z.string(),
  tokens: z.number().min(0),
  last_refill_ms: z.number().int(),
  max_tokens: z.number().positive(),
  refill_rate: z.number().positive(),
});

// ============================================================
// RATE LIMITING: 429 ERROR RESPONSE
// ============================================================

/** Detailed 429 error response for rate limit exceeded. */
export interface RateLimitErrorResponse {
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

export const RateLimitErrorResponseSchema = z.object({
  code: z.literal('RATE_LIMITED'),
  message: z.string(),
  retry_after: z.number().int().min(0),
  limit: z.number().int().positive(),
  remaining: z.literal(0),
  window: z.number().int().positive(),
  reset_at: z.string().datetime(),
  limit_type: z.enum(['api', 'endpoint', 'daily', 'concurrent', 'llm']),
  endpoint: z.string().optional(),
  active_requests: z.number().int().optional(),
  upgrade_url: z.string().url().optional(),
  request_id: z.string(),
  docs_url: z.string().url(),
});

// ============================================================
// RATE LIMITING: REDIS OPERATIONS INTERFACE
// ============================================================

/** Rate limiting Redis operations interface (external stubs). */
export interface RateLimitRedisOps {
  slidingWindowCheck(key: string, windowMs: number, limit: number): Promise<RateLimitResult>;
  tokenBucketCheck(key: string, refillRate: number, maxTokens: number): Promise<RateLimitResult>;
  concurrentAdd(key: string, requestId: string, limit: number): Promise<RateLimitResult>;
  concurrentRemove(key: string, requestId: string): Promise<void>;
}

// ============================================================
// RATE LIMITING: METRICS
// ============================================================

/** Rate limiting metrics snapshot for monitoring/observability. */
export interface RateLimitMetrics {
  check_count: number;
  exceeded_count: number;
  bucket_utilization: number;
  redis_latency_ms: number;
  redis_failure_count: number;
  fallback_count: number;
}

export const RateLimitMetricsSchema = z.object({
  check_count: z.number().int().min(0),
  exceeded_count: z.number().int().min(0),
  bucket_utilization: z.number().min(0).max(1),
  redis_latency_ms: z.number().min(0),
  redis_failure_count: z.number().int().min(0),
  fallback_count: z.number().int().min(0),
});

// ============================================================
// AUTH: JWT CLAIMS
// ============================================================

/**
 * JWT claims structure issued by Clerk.
 * Extracted from the Authorization header after validation.
 */
export interface JWTClaims {
  sub: string;
  exp: number;
  iat: number;
  metadata: {
    tier: UserTier;
    privacy: PrivacyTier;
  };
}

export const JWTClaimsSchema = z.object({
  sub: z.string(),
  exp: z.number().int(),
  iat: z.number().int(),
  metadata: z.object({
    tier: z.enum(USER_TIERS),
    privacy: z.enum(PRIVACY_TIERS),
  }),
});

// ============================================================
// AUTH: API KEY DISPLAY INFO
// ============================================================

/**
 * API key information for the Settings UI display.
 * The actual key value is NEVER stored or returned after creation.
 */
export interface APIKeyDisplayInfo {
  id: string;
  name: string;
  prefix: string;
  scope: ApiKeyScope;
  created_at: string;
  last_used?: string;
}

export const APIKeyDisplayInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scope: z.enum(API_KEY_SCOPES),
  created_at: z.string().datetime(),
  last_used: z.string().datetime().optional(),
});

// ============================================================
// AUTH: REFRESH TOKEN
// ============================================================

/** Refresh token request body. POST /v1/auth/refresh */
export interface RefreshTokenRequest {
  refresh_token: string;
}

export const RefreshTokenRequestSchema = z.object({
  refresh_token: z.string(),
});

/** Refresh token response. */
export interface RefreshTokenResponse {
  access_token: string;
  expires_in: number;
}

export const RefreshTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().positive(),
});

// ============================================================
// CHAT SSE: EVENT DATA TYPES
// ============================================================

/** session_start — First event, confirms session creation. */
export interface ChatSessionStartEvent {
  session_id: string;
  conversation_id?: string;
}

export const ChatSessionStartEventSchema = z.object({
  session_id: z.string(),
  conversation_id: z.string().optional(),
});

/** retrieval_start — Signals beginning of retrieval phase. */
export interface ChatRetrievalStartEvent {
  phase: string;
  query_processed: string;
}

export const ChatRetrievalStartEventSchema = z.object({
  phase: z.string(),
  query_processed: z.string(),
});

/** retrieval_node — Emitted for each relevant node found during retrieval. */
export interface ChatRetrievalNodeEvent {
  node_id: string;
  score: number;
  title: string;
}

export const ChatRetrievalNodeEventSchema = z.object({
  node_id: z.string(),
  score: z.number(),
  title: z.string(),
});

/** retrieval_complete — Signals end of retrieval phase with summary. */
export interface ChatRetrievalCompleteEvent {
  nodes_retrieved: number;
  time_ms: number;
}

export const ChatRetrievalCompleteEventSchema = z.object({
  nodes_retrieved: z.number().int().min(0),
  time_ms: z.number().min(0),
});

/** response_start — Signals beginning of LLM response generation. */
export interface ChatResponseStartEvent {
  model: string;
  estimated_cost: number;
}

export const ChatResponseStartEventSchema = z.object({
  model: z.string(),
  estimated_cost: z.number().min(0),
});

/** response_chunk — Streamed text chunk from LLM response. */
export interface ChatResponseChunkEvent {
  content: string;
  index: number;
}

export const ChatResponseChunkEventSchema = z.object({
  content: z.string(),
  index: z.number().int().min(0),
});

/** Source node referenced in a chat response. */
export interface ChatSource {
  node_id: string;
  title: string;
  relevance: number;
}

export const ChatSourceSchema = z.object({
  node_id: z.string(),
  title: z.string(),
  relevance: z.number().min(0).max(1),
});

/** response_complete — Signals end of LLM response with cost and metadata. */
export interface ChatResponseCompleteEvent {
  total_tokens: number;
  actual_cost: number;
  thought_path?: string[];
  sources: ChatSource[];
}

export const ChatResponseCompleteEventSchema = z.object({
  total_tokens: z.number().int().min(0),
  actual_cost: z.number().min(0),
  thought_path: z.array(z.string()).optional(),
  sources: z.array(ChatSourceSchema),
});

/** done — Signals end of stream. Empty data payload. */
export interface ChatDoneEvent {
  // Empty — signals end of stream
}

export const ChatDoneEventSchema = z.object({});

/** session_expired — Sent when reconnection is outside the 5-minute window. */
export interface ChatSessionExpiredEvent {
  message: string;
}

export const ChatSessionExpiredEventSchema = z.object({
  message: z.string(),
});

// ============================================================
// CHAT SSE: DISCRIMINATED UNION
// ============================================================

/** Union type of all chat SSE event data payloads. Discriminated on `type`. */
export type ChatSSEEventData =
  | { type: 'session_start'; data: ChatSessionStartEvent }
  | { type: 'retrieval_start'; data: ChatRetrievalStartEvent }
  | { type: 'retrieval_node'; data: ChatRetrievalNodeEvent }
  | { type: 'retrieval_complete'; data: ChatRetrievalCompleteEvent }
  | { type: 'response_start'; data: ChatResponseStartEvent }
  | { type: 'response_chunk'; data: ChatResponseChunkEvent }
  | { type: 'response_complete'; data: ChatResponseCompleteEvent }
  | { type: 'done'; data: ChatDoneEvent }
  | { type: 'session_expired'; data: ChatSessionExpiredEvent }
  | { type: 'ping'; data: Record<string, never> };

// ============================================================
// NODE ENDPOINTS
// ============================================================

/**
 * API representation of a memory node.
 * NOT NousNode from storm-011 — a flattened, safe representation.
 * Embedding vector is NEVER included (security per storm-022).
 */
export interface NodeResponse {
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

export const NodeResponseSchema = z.object({
  id: z.string(),
  type: z.string(),
  subtype: z.string().optional(),
  content: z.object({
    title: z.string(),
    body: z.string(),
    summary: z.string().optional(),
  }),
  embedding: z.object({
    model: z.string(),
    dimensions: z.number().int().positive(),
    status: z.enum(EMBEDDING_STATUSES),
    estimated_completion: z.string().datetime().optional(),
  }).optional(),
  neural: z.object({
    stability: z.number().min(0).max(1),
    retrievability: z.number().min(0).max(1),
    importance: z.number().min(0).max(1),
  }),
  temporal: z.object({
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    last_accessed: z.string().datetime(),
    access_count: z.number().int().min(0),
  }),
  organization: z.object({
    cluster_id: z.string().optional(),
    tags: z.array(z.string()),
  }),
  state: z.object({
    lifecycle: z.enum(LIFECYCLE_STATES),
    flags: z.array(z.string()),
  }),
  version: z.number().int().min(1),
});

/** List nodes query parameters. GET /v1/nodes */
export interface ListNodesParams extends CursorPaginationRequest {
  type?: string;
  updated_after?: string;
  include?: string;
}

export const ListNodesParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  type: z.string().optional(),
  updated_after: z.string().datetime().optional(),
  include: z.string().optional(),
});

/** List nodes response. */
export interface ListNodesResponse {
  data: NodeResponse[];
  pagination: CursorPaginationResponse;
}

/** Get node query parameters. GET /v1/nodes/:id */
export interface GetNodeParams {
  include?: string;
}

export const GetNodeParamsSchema = z.object({
  include: z.string().optional(),
});

/** Get node response. */
export interface GetNodeResponse {
  data: NodeResponse;
}

/**
 * Create node request body. POST /v1/nodes
 * Content limits: title 100, body soft 500/hard 2000, summary 200.
 */
export interface CreateNodeRequest {
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

export const CreateNodeRequestSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  content: z.object({
    title: z.string().max(100),
    body: z.string().max(2000),
    summary: z.string().max(200).optional(),
  }),
  organization: z.object({
    tags: z.array(z.string()).optional(),
  }).optional(),
});

/** Create node response (201). */
export interface CreateNodeResponse {
  data: NodeResponse;
  meta: {
    edges_created: number;
    auto_linked: boolean;
  };
}

/** Update node request body. PATCH /v1/nodes/:id */
export interface UpdateNodeRequest {
  content?: Partial<{
    title: string;
    body: string;
    summary: string;
  }>;
  expected_version?: number;
}

export const UpdateNodeRequestSchema = z.object({
  content: z.object({
    title: z.string().max(100).optional(),
    body: z.string().max(2000).optional(),
    summary: z.string().max(200).optional(),
  }).optional(),
  expected_version: z.number().int().min(1).optional(),
});

/** Batch create nodes request body. POST /v1/nodes/batch */
export interface BatchCreateNodesRequest {
  nodes: CreateNodeRequest[];
  link_to_episode?: string;
}

export const BatchCreateNodesRequestSchema = z.object({
  nodes: z.array(CreateNodeRequestSchema).min(1).max(100),
  link_to_episode: z.string().optional(),
});

/** A single failure item in a batch response. */
export interface BatchFailureItem {
  index: number;
  error: {
    code: string;
    message: string;
  };
}

export const BatchFailureItemSchema = z.object({
  index: z.number().int().min(0),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

/** Batch create nodes response (201). Partial success is possible. */
export interface BatchCreateNodesResponse {
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

// ============================================================
// EDGE ENDPOINTS
// ============================================================

/** API representation of an edge between two nodes. */
export interface EdgeResponse {
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

export const EdgeResponseSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.string(),
  strength: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  neural: z.object({
    co_activation_count: z.number().int().min(0),
    last_co_activation: z.string().datetime(),
  }),
  created_at: z.string().datetime(),
});

/** List edges for a node query parameters. GET /v1/nodes/:id/edges */
export interface ListEdgesParams extends CursorPaginationRequest {
  direction?: EdgeDirection;
  type?: string;
}

export const ListEdgesParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  direction: z.enum(EDGE_DIRECTIONS).optional(),
  type: z.string().optional(),
});

/** List edges response. */
export interface ListEdgesResponse {
  data: EdgeResponse[];
  pagination: CursorPaginationResponse;
}

/** Create edge request body. POST /v1/edges */
export interface CreateEdgeRequest {
  source: string;
  target: string;
  type: string;
  strength?: number;
}

export const CreateEdgeRequestSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.string(),
  strength: z.number().min(0).max(1).default(0.5).optional(),
});

/** Update edge request body. PATCH /v1/edges/:id */
export interface UpdateEdgeRequest {
  strength: number;
}

export const UpdateEdgeRequestSchema = z.object({
  strength: z.number().min(0).max(1),
});

// ============================================================
// SEARCH ENDPOINTS
// ============================================================

/** Search result item containing a node and its relevance score. */
export interface SearchResultItem {
  node: NodeResponse;
  score: number;
  score_breakdown?: {
    vector: number;
    bm25: number;
    combined: number;
  };
}

export const SearchResultItemSchema = z.object({
  node: NodeResponseSchema,
  score: z.number(),
  score_breakdown: z.object({
    vector: z.number(),
    bm25: z.number(),
    combined: z.number(),
  }).optional(),
});

/** Simple search query parameters. GET /v1/search */
export interface SimpleSearchParams {
  q: string;
  type?: string;
  offset?: number;
  limit?: number;
}

export const SimpleSearchParamsSchema = z.object({
  q: z.string().min(1),
  type: z.string().optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/** Advanced search request body. POST /v1/search */
export interface AdvancedSearchRequest {
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

export const AdvancedSearchRequestSchema = z.object({
  query: z.string().min(1),
  filters: z.object({
    types: z.array(z.string()).optional(),
    date_range: z.object({
      start: z.string(),
      end: z.string(),
    }).optional(),
    clusters: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    lifecycle: z.array(z.enum(LIFECYCLE_STATES)).optional(),
  }).optional(),
  options: z.object({
    include_scores: z.boolean().optional(),
    score_breakdown: z.boolean().optional(),
  }).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

/** Search response (used by both simple and advanced search). */
export interface SearchResponse {
  data: SearchResultItem[];
  pagination: OffsetPaginationResponse;
  meta: {
    query_time_ms: number;
    embedding_model?: string;
    retrieval_method?: string;
  };
}

// ============================================================
// CLUSTER ENDPOINTS
// ============================================================

/** Cluster list item for GET /v1/clusters. */
export interface ClusterListItem {
  id: string;
  name: string;
  description: string;
  node_count: number;
  keywords: string[];
  color: string;
  created_at: string;
}

export const ClusterListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  node_count: z.number().int().min(0),
  keywords: z.array(z.string()),
  color: z.string(),
  created_at: z.string().datetime(),
});

/** Cluster detail response for GET /v1/clusters/:id. */
export interface ClusterDetailResponse {
  data: ClusterListItem & {
    top_nodes: { id: string; title: string; importance: number }[];
    related_clusters: { id: string; name: string; strength: number }[];
  };
}

/** Update cluster request body. PATCH /v1/clusters/:id */
export interface UpdateClusterRequest {
  name?: string;
  color?: string;
}

export const UpdateClusterRequestSchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
});

/** List clusters response. No pagination — cluster count is typically small. */
export interface ListClustersResponse {
  data: ClusterListItem[];
}

// ============================================================
// CHAT ENDPOINTS
// ============================================================

/**
 * Chat request body. POST /v1/chat (with Accept: text/event-stream for SSE).
 * The response is an SSE stream — see ChatSSEEventData.
 */
export interface ChatRequest {
  message: string;
  conversation_id?: string;
  options?: {
    include_retrieval?: boolean;
    include_thought_path?: boolean;
    max_tokens?: number;
    model_preference?: string | null;
  };
}

export const ChatRequestSchema = z.object({
  message: z.string().min(1),
  conversation_id: z.string().optional(),
  options: z.object({
    include_retrieval: z.boolean().optional(),
    include_thought_path: z.boolean().optional(),
    max_tokens: z.number().int().positive().optional(),
    model_preference: z.string().nullable().optional(),
  }).optional(),
});

/** A single message in a conversation. */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: ChatSource[];
  cost?: number;
}

export const ConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.string().datetime(),
  sources: z.array(ChatSourceSchema).optional(),
  cost: z.number().min(0).optional(),
});

/** Conversation detail response. GET /v1/chat/conversations/:id */
export interface ConversationDetailResponse {
  data: {
    id: string;
    messages: ConversationMessage[];
    total_cost: number;
    created_at: string;
    updated_at: string;
  };
}

/** Conversation summary for list view. */
export interface ConversationSummary {
  id: string;
  preview: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export const ConversationSummarySchema = z.object({
  id: z.string(),
  preview: z.string(),
  message_count: z.number().int().min(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

/** List conversations response. GET /v1/chat/conversations */
export interface ListConversationsResponse {
  data: ConversationSummary[];
  pagination: CursorPaginationResponse;
}

// ============================================================
// AGENT ENDPOINTS
// ============================================================

/** Agent tool information. Returned in GET /v1/agent/tools. */
export interface AgentToolInfo {
  name: string;
  description?: string;
  params?: unknown[];
  available_offline: boolean;
  credits: number;
  requires_confirmation?: boolean;
  preview_threshold?: number;
}

export const AgentToolInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  params: z.array(z.unknown()).optional(),
  available_offline: z.boolean(),
  credits: z.number().min(0),
  requires_confirmation: z.boolean().optional(),
  preview_threshold: z.number().int().positive().optional(),
});

/** Agent tools list response, categorized by type. GET /v1/agent/tools */
export interface AgentToolsResponse {
  data: {
    read: AgentToolInfo[];
    write: AgentToolInfo[];
    destructive: AgentToolInfo[];
  };
}

/** Execute agent action request body. POST /v1/agent/actions */
export interface ExecuteActionRequest {
  tool: string;
  params: Record<string, unknown>;
  dry_run?: boolean;
}

export const ExecuteActionRequestSchema = z.object({
  tool: z.string(),
  params: z.record(z.unknown()),
  dry_run: z.boolean().optional(),
});

/** Action result (returned when dry_run = false). */
export interface ActionResult {
  action_id: string;
  tool: string;
  status: ActionStatus;
  results: Record<string, unknown>;
  credits_used: number;
  undoable: boolean;
  undo_expires?: string;
}

export const ActionResultSchema = z.object({
  action_id: z.string(),
  tool: z.string(),
  status: z.enum(ACTION_STATUSES),
  results: z.record(z.unknown()),
  credits_used: z.number().min(0),
  undoable: z.boolean(),
  undo_expires: z.string().datetime().optional(),
});

/** Preview result (returned when dry_run = true). */
export interface PreviewResult {
  preview: true;
  affected_count: number;
  affected_nodes: { id: string; title: string }[];
  estimated_credits: number;
  requires_confirmation: boolean;
}

export const PreviewResultSchema = z.object({
  preview: z.literal(true),
  affected_count: z.number().int().min(0),
  affected_nodes: z.array(z.object({
    id: z.string(),
    title: z.string(),
  })),
  estimated_credits: z.number().min(0),
  requires_confirmation: z.boolean(),
});

/** Execute action response. */
export interface ExecuteActionResponse {
  data: ActionResult | PreviewResult;
}

/** Agent view response — node with full context. GET /v1/agent/view/:node_id */
export interface AgentViewResponse {
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
export interface UndoActionResponse {
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
export interface ActionHistoryItem {
  id: string;
  tool: string;
  status: ActionStatus;
  timestamp: string;
  undoable: boolean;
  credits_used: number;
}

export const ActionHistoryItemSchema = z.object({
  id: z.string(),
  tool: z.string(),
  status: z.enum(ACTION_STATUSES),
  timestamp: z.string().datetime(),
  undoable: z.boolean(),
  credits_used: z.number().min(0),
});

/** Action history list response. GET /v1/agent/actions */
export interface ActionHistoryResponse {
  data: ActionHistoryItem[];
  pagination: CursorPaginationResponse;
}

// ============================================================
// INGESTION ENDPOINTS
// ============================================================

/** Ingest text content request body. POST /v1/ingest (synchronous — returns 200). */
export interface IngestTextRequest {
  content: string;
  source: IngestSource;
  mode?: IngestMode;
  options?: {
    auto_save?: boolean;
    force_save?: boolean;
    priority?: IngestPriority;
  };
}

export const IngestTextRequestSchema = z.object({
  content: z.string().min(1),
  source: z.enum(INGEST_SOURCES),
  mode: z.enum(INGEST_MODES).optional(),
  options: z.object({
    auto_save: z.boolean().optional(),
    force_save: z.boolean().optional(),
    priority: z.enum(INGEST_PRIORITIES).optional(),
  }).optional(),
});

/** Ingestion classification result from storm-014's pipeline. */
export interface IngestClassificationResponse {
  intent: string;
  save_signal: string;
  content_type: string;
  confidence: number;
  action_verb: string;
}

export const IngestClassificationResponseSchema = z.object({
  intent: z.string(),
  save_signal: z.string(),
  content_type: z.string(),
  confidence: z.number().min(0).max(1),
  action_verb: z.string(),
});

/** Summary of a created node (used in ingestion responses). */
export interface CreatedNodeSummary {
  id: string;
  type: string;
  title: string;
  embedding_status: EmbeddingStatus;
}

export const CreatedNodeSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  embedding_status: z.enum(EMBEDDING_STATUSES),
});

/** Ingest text response (200 — synchronous). */
export interface IngestTextResponse {
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
export interface IngestFileResponse {
  data: {
    job_id: string;
    status: 'processing';
    estimated_time_seconds: number;
    webhook_configured: boolean;
  };
}

/** Ingestion job stage for progress tracking. */
export interface IngestJobStage {
  name: string;
  status: 'pending' | 'processing' | 'complete';
  progress?: number;
}

export const IngestJobStageSchema = z.object({
  name: z.string(),
  status: z.enum(['pending', 'processing', 'complete']),
  progress: z.number().min(0).max(100).optional(),
});

/** Ingestion job status response. GET /v1/ingest/jobs/:id */
export interface IngestJobStatusResponse {
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

// ============================================================
// SYNC ENDPOINTS
// ============================================================

/** Sync status response. GET /v1/sync/status */
export interface SyncStatusResponse {
  data: {
    last_sync: string;
    pending_changes: number;
    conflicts: number;
    db_version: number;
    client_behind_by: number;
  };
}

/** A single change in a sync push request. */
export interface SyncChange {
  operation: SyncOperation;
  table: SyncTable;
  id?: string;
  local_id?: string;
  data?: Record<string, unknown>;
  expected_version?: number;
  client_timestamp: string;
}

export const SyncChangeSchema = z.object({
  operation: z.enum(SYNC_OPERATIONS),
  table: z.enum(SYNC_TABLES),
  id: z.string().optional(),
  local_id: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  expected_version: z.number().int().min(1).optional(),
  client_timestamp: z.string().datetime(),
});

/** Sync push request body. POST /v1/sync/push */
export interface SyncPushRequest {
  changes: SyncChange[];
  client_db_version: number;
}

export const SyncPushRequestSchema = z.object({
  changes: z.array(SyncChangeSchema),
  client_db_version: z.number().int().min(0),
});

/** A successfully applied change in a sync push response. */
export interface SyncAppliedItem {
  local_id?: string;
  server_id: string;
  version: number;
}

export const SyncAppliedItemSchema = z.object({
  local_id: z.string().optional(),
  server_id: z.string(),
  version: z.number().int().min(1),
});

/** A conflict detected during sync push. */
export interface SyncConflictItem {
  id: string;
  conflict_id: string;
  type: SyncConflictType;
  client_version: number;
  server_version: number;
  server_data: Record<string, unknown>;
  resolution_options: SyncResolution[];
}

export const SyncConflictItemSchema = z.object({
  id: z.string(),
  conflict_id: z.string(),
  type: z.enum(SYNC_CONFLICT_TYPES),
  client_version: z.number().int().min(1),
  server_version: z.number().int().min(1),
  server_data: z.record(z.unknown()),
  resolution_options: z.array(z.enum(SYNC_RESOLUTIONS)),
});

/** Sync push response. */
export interface SyncPushResponse {
  data: {
    applied: SyncAppliedItem[];
    conflicts: SyncConflictItem[];
    server_db_version: number;
  };
}

/** Sync pull query parameters. GET /v1/sync/pull */
export interface SyncPullParams {
  since_version: number;
  limit?: number;
}

export const SyncPullParamsSchema = z.object({
  since_version: z.number().int().min(0),
  limit: z.number().int().min(1).max(200).optional(),
});

/** A change pulled from the server. */
export interface PulledChange {
  table: SyncTable;
  id: string;
  operation: SyncOperation;
  data: Record<string, unknown>;
  version: number;
  timestamp: string;
}

export const PulledChangeSchema = z.object({
  table: z.enum(SYNC_TABLES),
  id: z.string(),
  operation: z.enum(SYNC_OPERATIONS),
  data: z.record(z.unknown()),
  version: z.number().int().min(1),
  timestamp: z.string().datetime(),
});

/** Sync pull response. */
export interface SyncPullResponse {
  data: {
    changes: PulledChange[];
    current_version: number;
    has_more: boolean;
  };
}

/** Resolve conflict request body. POST /v1/sync/conflicts/:id/resolve */
export interface ResolveConflictRequest {
  resolution: SyncResolution;
  merged_data?: Record<string, unknown>;
}

export const ResolveConflictRequestSchema = z.object({
  resolution: z.enum(SYNC_RESOLUTIONS),
  merged_data: z.record(z.unknown()).optional(),
});

/** Resolve conflict response. */
export interface ResolveConflictResponse {
  data: {
    resolved: boolean;
    final_version: number;
    final_data: Record<string, unknown>;
  };
}

/** Full sync request body (recovery). POST /v1/sync/full */
export interface FullSyncRequest {
  reason: FullSyncReason;
}

export const FullSyncRequestSchema = z.object({
  reason: z.enum(FULL_SYNC_REASONS),
});

/** Full sync response (initiates async full sync job). */
export interface FullSyncResponse {
  data: {
    job_id: string;
    status: 'initiated';
    estimated_time_seconds: number;
  };
}

// ============================================================
// SETTINGS ENDPOINTS
// ============================================================

/** Agent permissions configuration. */
export interface AgentPermissions {
  can_write: boolean;
  can_auto_operations: boolean;
  can_delete: boolean;
  can_bulk_operations: boolean;
}

export const AgentPermissionsSchema = z.object({
  can_write: z.boolean(),
  can_auto_operations: z.boolean(),
  can_delete: z.boolean(),
  can_bulk_operations: z.boolean(),
});

/** Notification settings. */
export interface NotificationSettings {
  daily_summary: boolean;
  sync_alerts: boolean;
  agent_suggestions: AgentSuggestionLevel;
}

export const NotificationSettingsSchema = z.object({
  daily_summary: z.boolean(),
  sync_alerts: z.boolean(),
  agent_suggestions: z.enum(AGENT_SUGGESTION_LEVELS),
});

/** User preferences. */
export interface UserPreferences {
  theme: ThemeOption;
  language: string;
  working_memory_hours: number;
}

export const UserPreferencesSchema = z.object({
  theme: z.enum(THEME_OPTIONS),
  language: z.string(),
  working_memory_hours: z.number().int().positive(),
});

/** User settings response. GET /v1/settings */
export interface UserSettingsResponse {
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
export interface UpdateSettingsRequest {
  agent_permissions?: Partial<AgentPermissions>;
  notifications?: Partial<NotificationSettings>;
  preferences?: Partial<UserPreferences>;
}

export const UpdateSettingsRequestSchema = z.object({
  agent_permissions: z.object({
    can_write: z.boolean().optional(),
    can_auto_operations: z.boolean().optional(),
    can_delete: z.boolean().optional(),
    can_bulk_operations: z.boolean().optional(),
  }).optional(),
  notifications: z.object({
    daily_summary: z.boolean().optional(),
    sync_alerts: z.boolean().optional(),
    agent_suggestions: z.enum(AGENT_SUGGESTION_LEVELS).optional(),
  }).optional(),
  preferences: z.object({
    theme: z.enum(THEME_OPTIONS).optional(),
    language: z.string().optional(),
    working_memory_hours: z.number().int().positive().optional(),
  }).optional(),
});

/** Create API key request body. POST /v1/settings/api-keys */
export interface CreateAPIKeyRequest {
  name: string;
  scope: ApiKeyScope;
}

export const CreateAPIKeyRequestSchema = z.object({
  name: z.string().min(1),
  scope: z.enum(API_KEY_SCOPES),
});

/**
 * Create API key response (201).
 * The `key` field contains the full API key and is shown ONLY ONCE.
 */
export interface CreateAPIKeyResponse {
  data: {
    id: string;
    name: string;
    key: string;
    scope: ApiKeyScope;
    created_at: string;
  };
}

// ============================================================
// CREDITS ENDPOINTS
// ============================================================

/** Credit balance response. GET /v1/credits */
export interface CreditBalanceResponse {
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
export interface UsageByDay {
  date: string;
  amount: number;
}

export const UsageByDaySchema = z.object({
  date: z.string(),
  amount: z.number().min(0),
});

/** Credit usage response. GET /v1/credits/usage */
export interface CreditUsageResponse {
  data: {
    total: number;
    by_operation: Record<CreditOperation, number>;
    by_day: UsageByDay[];
  };
}

/** Cost estimate request body. POST /v1/credits/estimate */
export interface CostEstimateRequest {
  operation: string;
  params: {
    message_length?: number;
    expected_retrieval?: number;
    complexity?: string;
  };
}

export const CostEstimateRequestSchema = z.object({
  operation: z.string(),
  params: z.object({
    message_length: z.number().int().positive().optional(),
    expected_retrieval: z.number().int().min(0).optional(),
    complexity: z.string().optional(),
  }),
});

/** Cost estimate response. */
export interface CostEstimateResponse {
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

// ============================================================
// DATA FLOW TYPES
// ============================================================

/** A single step in a data flow pipeline. */
export interface FlowStep {
  name: string;
  service: string;
  description: string;
}

export const FlowStepSchema = z.object({
  name: z.string(),
  service: z.string(),
  description: z.string(),
});

/** Represents a running data flow instance for observability. */
export interface FlowExecution {
  flow_type: FlowType;
  request_id: string;
  current_step: string;
  started_at: number;
  steps_completed: string[];
  error?: string;
}

export const FlowExecutionSchema = z.object({
  flow_type: z.enum(FLOW_TYPES),
  request_id: z.string(),
  current_step: z.string(),
  started_at: z.number().int(),
  steps_completed: z.array(z.string()),
  error: z.string().optional(),
});
