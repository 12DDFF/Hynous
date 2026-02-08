import { z } from 'zod';

// src/api/constants.ts
var USER_TIERS = ["free", "credits", "pro", "api_key"];
function isUserTier(value) {
  return typeof value === "string" && USER_TIERS.includes(value);
}
var TIER_LIMITS = {
  free: { requests_per_min: 60, requests_per_day: 1e3, concurrent: 5, batch_size: 20 },
  credits: { requests_per_min: 120, requests_per_day: 5e3, concurrent: 10, batch_size: 50 },
  pro: { requests_per_min: 300, requests_per_day: 5e4, concurrent: 25, batch_size: 100 },
  api_key: { requests_per_min: 60, requests_per_day: 1e4, concurrent: 5, batch_size: 50 }
};
var ENDPOINT_RATE_LIMITS = {
  "POST /v1/chat": { free: 20, credits: 60, pro: 120, reason: "LLM cost" },
  "POST /v1/ingest": { free: 10, credits: 30, pro: 60, reason: "Processing cost" },
  "POST /v1/ingest/file": { free: 5, credits: 15, pro: 30, reason: "Heavy processing" },
  "POST /v1/search": { free: 30, credits: 90, pro: 180, reason: "Embedding cost" },
  "POST /v1/agent/actions": { free: 10, credits: 30, pro: 60, reason: "LLM + write cost" },
  "POST /v1/sync/push": { free: 30, credits: 60, pro: 120, reason: "DB write cost" }
};
function isRateLimitedEndpoint(value) {
  return typeof value === "string" && value in ENDPOINT_RATE_LIMITS;
}
var BURST_ALLOWANCE_PERCENT = 0.1;
var BURST_LIMITS = {
  free: 66,
  credits: 132,
  pro: 330,
  api_key: 66
};
var REDIS_KEY_PATTERNS = {
  api: "ratelimit:api:{user_id}",
  llm: "ratelimit:llm:{user_id}",
  endpoint: "ratelimit:endpoint:{user_id}:{endpoint}",
  concurrent: "ratelimit:concurrent:{user_id}"
};
var REDIS_TTL_API_MS = 7e4;
var REDIS_TTL_LLM_MS = 7e4;
var REDIS_TTL_ENDPOINT_MS = 7e4;
var REDIS_TTL_CONCURRENT_MS = 3e5;
var REDIS_FALLBACK_LIMIT_PERCENT = 0.5;
var CHAT_SSE_EVENT_TYPES = [
  "session_start",
  "retrieval_start",
  "retrieval_node",
  "retrieval_complete",
  "response_start",
  "response_chunk",
  "response_complete",
  "done",
  "ping",
  "session_expired",
  "error"
];
function isChatSSEEventType(value) {
  return typeof value === "string" && CHAT_SSE_EVENT_TYPES.includes(value);
}
var CHAT_SSE_KEEPALIVE_INTERVAL_MS = 15e3;
var CHAT_SSE_MAX_DURATION_MS = 12e4;
var CHAT_SSE_RECONNECT_WINDOW_MS = 3e5;
var CONTENT_LIMITS = {
  title: 100,
  body_soft: 500,
  body_hard: 2e3,
  summary: 200,
  batch_max_size: 100
};
var API_ERROR_CODES = {
  // From storm-026 (included for completeness)
  UNAUTHORIZED: { status: 401, message: "Authentication required" },
  TOKEN_EXPIRED: { status: 401, message: "JWT expired, refresh needed" },
  FORBIDDEN: { status: 403, message: "Insufficient permissions" },
  NOT_FOUND: { status: 404, message: "Resource not found" },
  CONFLICT: { status: 409, message: "Version conflict" },
  RATE_LIMITED: { status: 429, message: "Too many requests" },
  VALIDATION_ERROR: { status: 400, message: "Invalid request data" },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
  SERVICE_UNAVAILABLE: { status: 503, message: "Service temporarily unavailable" },
  // New in storm-023
  INVALID_REQUEST: { status: 400, message: "Malformed request" },
  CONTENT_LIMIT_EXCEEDED: { status: 400, message: "Content exceeds size limits" },
  BATCH_SIZE_EXCEEDED: { status: 400, message: "Too many items in batch" },
  TIER_REQUIRED: { status: 403, message: "Higher tier required" },
  PRIVACY_TIER_REQUIRED: { status: 403, message: "Private tier required for this operation" },
  DUPLICATE: { status: 409, message: "Resource already exists" },
  IDEMPOTENCY_MISMATCH: { status: 409, message: "Same key with different request body" },
  UNPROCESSABLE: { status: 422, message: "Valid syntax but semantic error" },
  UPSTREAM_ERROR: { status: 502, message: "Upstream service failed" }
};
function isApiErrorCode(value) {
  return typeof value === "string" && value in API_ERROR_CODES;
}
var ENDPOINT_TIMEOUTS = {
  health: { expected_ms: 50, client_timeout_ms: 5e3 },
  node_crud: { expected_ms: 100, client_timeout_ms: 1e4 },
  list: { expected_ms: 200, client_timeout_ms: 15e3 },
  search: { expected_ms: 500, client_timeout_ms: 3e4 },
  ingest_text: { expected_ms: 2e3, client_timeout_ms: 3e4 },
  ingest_file: { expected_ms: null, client_timeout_ms: 6e4 },
  chat_sse: { expected_ms: null, client_timeout_ms: 12e4 },
  sync: { expected_ms: 500, client_timeout_ms: 3e4 },
  agent: { expected_ms: 5e3, client_timeout_ms: 6e4 }
};
var RATE_LIMIT_ALERT_THRESHOLDS = {
  redis_failure_rate_percent: 1,
  redis_failure_window_ms: 6e4,
  user_limit_hits_per_min: 10,
  tier_utilization_percent: 90,
  tier_utilization_window_ms: 3e5,
  fallback_active_max_ms: 3e4
};
var CURSOR_PAGINATION_DEFAULT_LIMIT = 50;
var CURSOR_PAGINATION_MAX_LIMIT = 100;
var OFFSET_PAGINATION_DEFAULT_LIMIT = 20;
var OFFSET_PAGINATION_MAX_LIMIT = 100;
var IDEMPOTENCY_TTL_MS = 864e5;
var RATE_LIMIT_ALGORITHMS = ["sliding_window", "token_bucket"];
var RATE_LIMIT_TYPES = ["api", "endpoint", "daily", "concurrent", "llm"];
function isRateLimitType(value) {
  return typeof value === "string" && RATE_LIMIT_TYPES.includes(value);
}
var AUTH_METHODS = ["jwt", "api_key"];
var API_KEY_PREFIX_LIVE = "sk_live_";
var API_KEY_PREFIX_TEST = "sk_test_";
var API_KEY_SCOPES = ["full", "read_only"];
function isApiKeyScope(value) {
  return typeof value === "string" && API_KEY_SCOPES.includes(value);
}
var EMBEDDING_STATUSES = ["pending", "processing", "complete", "failed"];
function isEmbeddingStatus(value) {
  return typeof value === "string" && EMBEDDING_STATUSES.includes(value);
}
var PRIVACY_TIERS = ["standard", "private"];
var LIFECYCLE_STATES = ["active", "weak", "dormant", "summarized", "archived"];
var EDGE_DIRECTIONS = ["in", "out", "both"];
function isEdgeDirection(value) {
  return typeof value === "string" && EDGE_DIRECTIONS.includes(value);
}
var INGEST_SOURCES = ["chat", "file", "voice", "api"];
function isIngestSource(value) {
  return typeof value === "string" && INGEST_SOURCES.includes(value);
}
var INGEST_MODES = ["normal", "incognito"];
var INGEST_PRIORITIES = ["normal", "high", "low"];
var INGEST_ACTIONS = ["saved", "ignored", "accumulated", "prompted"];
function isIngestAction(value) {
  return typeof value === "string" && INGEST_ACTIONS.includes(value);
}
var JOB_STATUSES = ["processing", "complete", "failed"];
function isJobStatus(value) {
  return typeof value === "string" && JOB_STATUSES.includes(value);
}
var SYNC_OPERATIONS = ["create", "update", "delete"];
function isSyncOperation(value) {
  return typeof value === "string" && SYNC_OPERATIONS.includes(value);
}
var SYNC_TABLES = ["nodes", "edges"];
var SYNC_CONFLICT_TYPES = ["VERSION_MISMATCH", "DELETED", "CONSTRAINT"];
function isSyncConflictType(value) {
  return typeof value === "string" && SYNC_CONFLICT_TYPES.includes(value);
}
var SYNC_RESOLUTIONS = ["keep_local", "keep_server", "merge"];
function isSyncResolution(value) {
  return typeof value === "string" && SYNC_RESOLUTIONS.includes(value);
}
var FULL_SYNC_REASONS = ["corruption", "reset", "new_device"];
var AGENT_TOOL_CATEGORIES = ["read", "write", "destructive"];
var ACTION_STATUSES = ["completed", "failed", "undone"];
var THEME_OPTIONS = ["system", "light", "dark"];
var AGENT_SUGGESTION_LEVELS = ["all", "important_only", "none"];
var CREDIT_OPERATIONS = ["chat_quick", "chat_standard", "chat_deep", "extraction", "agent", "embedding"];
var USAGE_GROUP_BY = ["day", "operation"];
var FLOW_TYPES = ["chat", "sync", "ingestion"];
var CORS_ALLOWED_ORIGINS = [
  "https://app.nous.app",
  "https://nous.app"
];
var CORS_ALLOWED_METHODS = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"];
var CORS_ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"];
var CORS_MAX_AGE_SECONDS = 86400;
var UserTierSchema = z.enum(USER_TIERS);
var CursorPaginationRequestSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(CURSOR_PAGINATION_MAX_LIMIT).default(CURSOR_PAGINATION_DEFAULT_LIMIT).optional()
});
var CursorPaginationResponseSchema = z.object({
  cursor: z.string().nullable(),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
  limit: z.number().int(),
  total: z.number().int().optional()
});
var OffsetPaginationRequestSchema = z.object({
  offset: z.number().int().min(0).default(0).optional(),
  limit: z.number().int().min(1).max(OFFSET_PAGINATION_MAX_LIMIT).default(OFFSET_PAGINATION_DEFAULT_LIMIT).optional()
});
var OffsetPaginationResponseSchema = z.object({
  offset: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  has_more: z.boolean()
});
var ApiErrorResponseExtendedSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  request_id: z.string(),
  retry_after: z.number().optional(),
  docs_url: z.string().url().optional()
});
var ValidationFieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  limit: z.number().optional(),
  actual: z.number().optional(),
  soft_limit: z.number().optional(),
  hard_limit: z.number().optional()
});
var ContentLimitsInfoSchema = z.object({
  title: z.number().int().positive(),
  body_soft: z.number().int().positive(),
  body_hard: z.number().int().positive(),
  summary: z.number().int().positive()
});
var AuthContextSchema = z.object({
  user_id: z.string(),
  tier: UserTierSchema,
  privacy_tier: z.enum(PRIVACY_TIERS),
  auth_method: z.enum(["jwt", "api_key"])
});
var IdempotencyRecordSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  key: z.string(),
  request_hash: z.string(),
  response: z.unknown(),
  status_code: z.number().int(),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime()
});
var EmbeddingInfoSchema = z.object({
  model: z.string(),
  dimensions: z.number().int().positive(),
  status: z.enum(EMBEDDING_STATUSES),
  estimated_completion: z.string().datetime().optional()
});
var WebhookCallbackSchema = z.object({
  event: z.string(),
  job_id: z.string(),
  status: z.string(),
  results: z.record(z.unknown()),
  timestamp: z.string().datetime()
});
var RateLimitResultSchema = z.object({
  allowed: z.boolean(),
  limit: z.number().int(),
  remaining: z.number().int().min(0),
  reset_at: z.string().datetime(),
  retry_after: z.number().optional(),
  limit_type: z.enum(["api", "endpoint", "daily", "concurrent", "llm"])
});
var SlidingWindowStateSchema = z.object({
  key: z.string(),
  count: z.number().int().min(0),
  window_start_ms: z.number().int(),
  window_end_ms: z.number().int()
});
var TokenBucketStateSchema = z.object({
  key: z.string(),
  tokens: z.number().min(0),
  last_refill_ms: z.number().int(),
  max_tokens: z.number().positive(),
  refill_rate: z.number().positive()
});
var RateLimitErrorResponseSchema = z.object({
  code: z.literal("RATE_LIMITED"),
  message: z.string(),
  retry_after: z.number().int().min(0),
  limit: z.number().int().positive(),
  remaining: z.literal(0),
  window: z.number().int().positive(),
  reset_at: z.string().datetime(),
  limit_type: z.enum(["api", "endpoint", "daily", "concurrent", "llm"]),
  endpoint: z.string().optional(),
  active_requests: z.number().int().optional(),
  upgrade_url: z.string().url().optional(),
  request_id: z.string(),
  docs_url: z.string().url()
});
var RateLimitMetricsSchema = z.object({
  check_count: z.number().int().min(0),
  exceeded_count: z.number().int().min(0),
  bucket_utilization: z.number().min(0).max(1),
  redis_latency_ms: z.number().min(0),
  redis_failure_count: z.number().int().min(0),
  fallback_count: z.number().int().min(0)
});
var JWTClaimsSchema = z.object({
  sub: z.string(),
  exp: z.number().int(),
  iat: z.number().int(),
  metadata: z.object({
    tier: z.enum(USER_TIERS),
    privacy: z.enum(PRIVACY_TIERS)
  })
});
var APIKeyDisplayInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scope: z.enum(API_KEY_SCOPES),
  created_at: z.string().datetime(),
  last_used: z.string().datetime().optional()
});
var RefreshTokenRequestSchema = z.object({
  refresh_token: z.string()
});
var RefreshTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().positive()
});
var ChatSessionStartEventSchema = z.object({
  session_id: z.string(),
  conversation_id: z.string().optional()
});
var ChatRetrievalStartEventSchema = z.object({
  phase: z.string(),
  query_processed: z.string()
});
var ChatRetrievalNodeEventSchema = z.object({
  node_id: z.string(),
  score: z.number(),
  title: z.string()
});
var ChatRetrievalCompleteEventSchema = z.object({
  nodes_retrieved: z.number().int().min(0),
  time_ms: z.number().min(0)
});
var ChatResponseStartEventSchema = z.object({
  model: z.string(),
  estimated_cost: z.number().min(0)
});
var ChatResponseChunkEventSchema = z.object({
  content: z.string(),
  index: z.number().int().min(0)
});
var ChatSourceSchema = z.object({
  node_id: z.string(),
  title: z.string(),
  relevance: z.number().min(0).max(1)
});
var ChatResponseCompleteEventSchema = z.object({
  total_tokens: z.number().int().min(0),
  actual_cost: z.number().min(0),
  thought_path: z.array(z.string()).optional(),
  sources: z.array(ChatSourceSchema)
});
var ChatDoneEventSchema = z.object({});
var ChatSessionExpiredEventSchema = z.object({
  message: z.string()
});
var NodeResponseSchema = z.object({
  id: z.string(),
  type: z.string(),
  subtype: z.string().optional(),
  content: z.object({
    title: z.string(),
    body: z.string(),
    summary: z.string().optional()
  }),
  embedding: z.object({
    model: z.string(),
    dimensions: z.number().int().positive(),
    status: z.enum(EMBEDDING_STATUSES),
    estimated_completion: z.string().datetime().optional()
  }).optional(),
  neural: z.object({
    stability: z.number().min(0).max(1),
    retrievability: z.number().min(0).max(1),
    importance: z.number().min(0).max(1)
  }),
  temporal: z.object({
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    last_accessed: z.string().datetime(),
    access_count: z.number().int().min(0)
  }),
  organization: z.object({
    cluster_id: z.string().optional(),
    tags: z.array(z.string())
  }),
  state: z.object({
    lifecycle: z.enum(LIFECYCLE_STATES),
    flags: z.array(z.string())
  }),
  version: z.number().int().min(1)
});
var ListNodesParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  type: z.string().optional(),
  updated_after: z.string().datetime().optional(),
  include: z.string().optional()
});
var GetNodeParamsSchema = z.object({
  include: z.string().optional()
});
var CreateNodeRequestSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  content: z.object({
    title: z.string().max(100),
    body: z.string().max(2e3),
    summary: z.string().max(200).optional()
  }),
  organization: z.object({
    tags: z.array(z.string()).optional()
  }).optional()
});
var UpdateNodeRequestSchema = z.object({
  content: z.object({
    title: z.string().max(100).optional(),
    body: z.string().max(2e3).optional(),
    summary: z.string().max(200).optional()
  }).optional(),
  expected_version: z.number().int().min(1).optional()
});
var BatchCreateNodesRequestSchema = z.object({
  nodes: z.array(CreateNodeRequestSchema).min(1).max(100),
  link_to_episode: z.string().optional()
});
var BatchFailureItemSchema = z.object({
  index: z.number().int().min(0),
  error: z.object({
    code: z.string(),
    message: z.string()
  })
});
var EdgeResponseSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.string(),
  strength: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  neural: z.object({
    co_activation_count: z.number().int().min(0),
    last_co_activation: z.string().datetime()
  }),
  created_at: z.string().datetime()
});
var ListEdgesParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  direction: z.enum(EDGE_DIRECTIONS).optional(),
  type: z.string().optional()
});
var CreateEdgeRequestSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.string(),
  strength: z.number().min(0).max(1).default(0.5).optional()
});
var UpdateEdgeRequestSchema = z.object({
  strength: z.number().min(0).max(1)
});
var SearchResultItemSchema = z.object({
  node: NodeResponseSchema,
  score: z.number(),
  score_breakdown: z.object({
    vector: z.number(),
    bm25: z.number(),
    combined: z.number()
  }).optional()
});
var SimpleSearchParamsSchema = z.object({
  q: z.string().min(1),
  type: z.string().optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional()
});
var AdvancedSearchRequestSchema = z.object({
  query: z.string().min(1),
  filters: z.object({
    types: z.array(z.string()).optional(),
    date_range: z.object({
      start: z.string(),
      end: z.string()
    }).optional(),
    clusters: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    lifecycle: z.array(z.enum(LIFECYCLE_STATES)).optional()
  }).optional(),
  options: z.object({
    include_scores: z.boolean().optional(),
    score_breakdown: z.boolean().optional()
  }).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional()
});
var ClusterListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  node_count: z.number().int().min(0),
  keywords: z.array(z.string()),
  color: z.string(),
  created_at: z.string().datetime()
});
var UpdateClusterRequestSchema = z.object({
  name: z.string().optional(),
  color: z.string().optional()
});
var ChatRequestSchema = z.object({
  message: z.string().min(1),
  conversation_id: z.string().optional(),
  options: z.object({
    include_retrieval: z.boolean().optional(),
    include_thought_path: z.boolean().optional(),
    max_tokens: z.number().int().positive().optional(),
    model_preference: z.string().nullable().optional()
  }).optional()
});
var ConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string().datetime(),
  sources: z.array(ChatSourceSchema).optional(),
  cost: z.number().min(0).optional()
});
var ConversationSummarySchema = z.object({
  id: z.string(),
  preview: z.string(),
  message_count: z.number().int().min(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});
var AgentToolInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  params: z.array(z.unknown()).optional(),
  available_offline: z.boolean(),
  credits: z.number().min(0),
  requires_confirmation: z.boolean().optional(),
  preview_threshold: z.number().int().positive().optional()
});
var ExecuteActionRequestSchema = z.object({
  tool: z.string(),
  params: z.record(z.unknown()),
  dry_run: z.boolean().optional()
});
var ActionResultSchema = z.object({
  action_id: z.string(),
  tool: z.string(),
  status: z.enum(ACTION_STATUSES),
  results: z.record(z.unknown()),
  credits_used: z.number().min(0),
  undoable: z.boolean(),
  undo_expires: z.string().datetime().optional()
});
var PreviewResultSchema = z.object({
  preview: z.literal(true),
  affected_count: z.number().int().min(0),
  affected_nodes: z.array(z.object({
    id: z.string(),
    title: z.string()
  })),
  estimated_credits: z.number().min(0),
  requires_confirmation: z.boolean()
});
var ActionHistoryItemSchema = z.object({
  id: z.string(),
  tool: z.string(),
  status: z.enum(ACTION_STATUSES),
  timestamp: z.string().datetime(),
  undoable: z.boolean(),
  credits_used: z.number().min(0)
});
var IngestTextRequestSchema = z.object({
  content: z.string().min(1),
  source: z.enum(INGEST_SOURCES),
  mode: z.enum(INGEST_MODES).optional(),
  options: z.object({
    auto_save: z.boolean().optional(),
    force_save: z.boolean().optional(),
    priority: z.enum(INGEST_PRIORITIES).optional()
  }).optional()
});
var IngestClassificationResponseSchema = z.object({
  intent: z.string(),
  save_signal: z.string(),
  content_type: z.string(),
  confidence: z.number().min(0).max(1),
  action_verb: z.string()
});
var CreatedNodeSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  embedding_status: z.enum(EMBEDDING_STATUSES)
});
var IngestJobStageSchema = z.object({
  name: z.string(),
  status: z.enum(["pending", "processing", "complete"]),
  progress: z.number().min(0).max(100).optional()
});
var SyncChangeSchema = z.object({
  operation: z.enum(SYNC_OPERATIONS),
  table: z.enum(SYNC_TABLES),
  id: z.string().optional(),
  local_id: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  expected_version: z.number().int().min(1).optional(),
  client_timestamp: z.string().datetime()
});
var SyncPushRequestSchema = z.object({
  changes: z.array(SyncChangeSchema),
  client_db_version: z.number().int().min(0)
});
var SyncAppliedItemSchema = z.object({
  local_id: z.string().optional(),
  server_id: z.string(),
  version: z.number().int().min(1)
});
var SyncConflictItemSchema = z.object({
  id: z.string(),
  conflict_id: z.string(),
  type: z.enum(SYNC_CONFLICT_TYPES),
  client_version: z.number().int().min(1),
  server_version: z.number().int().min(1),
  server_data: z.record(z.unknown()),
  resolution_options: z.array(z.enum(SYNC_RESOLUTIONS))
});
var SyncPullParamsSchema = z.object({
  since_version: z.number().int().min(0),
  limit: z.number().int().min(1).max(200).optional()
});
var PulledChangeSchema = z.object({
  table: z.enum(SYNC_TABLES),
  id: z.string(),
  operation: z.enum(SYNC_OPERATIONS),
  data: z.record(z.unknown()),
  version: z.number().int().min(1),
  timestamp: z.string().datetime()
});
var ResolveConflictRequestSchema = z.object({
  resolution: z.enum(SYNC_RESOLUTIONS),
  merged_data: z.record(z.unknown()).optional()
});
var FullSyncRequestSchema = z.object({
  reason: z.enum(FULL_SYNC_REASONS)
});
var AgentPermissionsSchema = z.object({
  can_write: z.boolean(),
  can_auto_operations: z.boolean(),
  can_delete: z.boolean(),
  can_bulk_operations: z.boolean()
});
var NotificationSettingsSchema = z.object({
  daily_summary: z.boolean(),
  sync_alerts: z.boolean(),
  agent_suggestions: z.enum(AGENT_SUGGESTION_LEVELS)
});
var UserPreferencesSchema = z.object({
  theme: z.enum(THEME_OPTIONS),
  language: z.string(),
  working_memory_hours: z.number().int().positive()
});
var UpdateSettingsRequestSchema = z.object({
  agent_permissions: z.object({
    can_write: z.boolean().optional(),
    can_auto_operations: z.boolean().optional(),
    can_delete: z.boolean().optional(),
    can_bulk_operations: z.boolean().optional()
  }).optional(),
  notifications: z.object({
    daily_summary: z.boolean().optional(),
    sync_alerts: z.boolean().optional(),
    agent_suggestions: z.enum(AGENT_SUGGESTION_LEVELS).optional()
  }).optional(),
  preferences: z.object({
    theme: z.enum(THEME_OPTIONS).optional(),
    language: z.string().optional(),
    working_memory_hours: z.number().int().positive().optional()
  }).optional()
});
var CreateAPIKeyRequestSchema = z.object({
  name: z.string().min(1),
  scope: z.enum(API_KEY_SCOPES)
});
var UsageByDaySchema = z.object({
  date: z.string(),
  amount: z.number().min(0)
});
var CostEstimateRequestSchema = z.object({
  operation: z.string(),
  params: z.object({
    message_length: z.number().int().positive().optional(),
    expected_retrieval: z.number().int().min(0).optional(),
    complexity: z.string().optional()
  })
});
var FlowStepSchema = z.object({
  name: z.string(),
  service: z.string(),
  description: z.string()
});
var FlowExecutionSchema = z.object({
  flow_type: z.enum(FLOW_TYPES),
  request_id: z.string(),
  current_step: z.string(),
  started_at: z.number().int(),
  steps_completed: z.array(z.string()),
  error: z.string().optional()
});

// src/api/error-handling.ts
function getHttpStatusForErrorCode(code) {
  return API_ERROR_CODES[code].status;
}
function getDocsUrl(code) {
  return `https://docs.nous.app/errors/${code}`;
}
function getContentLimits() {
  return {
    title: CONTENT_LIMITS.title,
    body_soft: CONTENT_LIMITS.body_soft,
    body_hard: CONTENT_LIMITS.body_hard,
    summary: CONTENT_LIMITS.summary
  };
}
function createExtendedApiError(code, message, options) {
  return {
    code,
    message,
    request_id: options?.request_id ?? "",
    retry_after: options?.retry_after,
    details: options?.details,
    docs_url: options?.docs_url ?? getDocsUrl(code)
  };
}
function createValidationError(fields, requestId) {
  return createExtendedApiError("VALIDATION_ERROR", API_ERROR_CODES.VALIDATION_ERROR.message, {
    request_id: requestId,
    details: { fields }
  });
}
function createContentLimitError(field, limit, actual, requestId) {
  return createExtendedApiError(
    "CONTENT_LIMIT_EXCEEDED",
    API_ERROR_CODES.CONTENT_LIMIT_EXCEEDED.message,
    {
      request_id: requestId,
      details: {
        field,
        limit,
        actual,
        limits: getContentLimits()
      }
    }
  );
}
function createBatchSizeError(maxSize, actualSize, requestId) {
  return createExtendedApiError(
    "BATCH_SIZE_EXCEEDED",
    API_ERROR_CODES.BATCH_SIZE_EXCEEDED.message,
    {
      request_id: requestId,
      details: {
        max_size: maxSize,
        actual_size: actualSize
      }
    }
  );
}

// src/api/pagination.ts
function normalizeCursorParams(params) {
  const limit = params.limit !== void 0 ? Math.min(Math.max(1, params.limit), CURSOR_PAGINATION_MAX_LIMIT) : CURSOR_PAGINATION_DEFAULT_LIMIT;
  return {
    cursor: params.cursor,
    limit
  };
}
function normalizeOffsetParams(params) {
  const offset = params.offset !== void 0 ? Math.max(0, params.offset) : 0;
  const limit = params.limit !== void 0 ? Math.min(Math.max(1, params.limit), OFFSET_PAGINATION_MAX_LIMIT) : OFFSET_PAGINATION_DEFAULT_LIMIT;
  return {
    offset,
    limit
  };
}
function createCursorPaginationResponse(items, limit, currentCursor, total) {
  const hasMore = items.length >= limit;
  return {
    cursor: currentCursor,
    next_cursor: hasMore && items.length > 0 ? encodeCursor(items.length) : null,
    has_more: hasMore,
    limit,
    total
  };
}
function createOffsetPaginationResponse(offset, limit, total) {
  return {
    offset,
    limit,
    total,
    has_more: offset + limit < total
  };
}
function encodeCursor(position) {
  return btoa(String(position));
}

// src/api/rate-limiting.ts
var TIER_RANKS = {
  free: 0,
  api_key: 1,
  credits: 2,
  pro: 3
};
function tierRank(tier) {
  return TIER_RANKS[tier];
}
function buildRedisKey(pattern, params) {
  let key = pattern;
  for (const [name, value] of Object.entries(params)) {
    key = key.replace(`{${name}}`, value);
  }
  return key;
}
function calculateRetryAfter(windowMs, oldestTimestamp) {
  const now = Date.now();
  const expiresAt = oldestTimestamp + windowMs;
  const retryMs = Math.max(0, expiresAt - now);
  return Math.ceil(retryMs / 1e3);
}
function calculateTokenBucketRetryAfter(tokensNeeded, refillRate) {
  if (refillRate <= 0) return 60;
  return Math.ceil(tokensNeeded / refillRate);
}
function formatRateLimitHeaders(result, windowSeconds = 60) {
  const headers = {
    "X-RateLimit-Limit": result.limit,
    "X-RateLimit-Remaining": result.remaining,
    "X-RateLimit-Reset": Math.floor(new Date(result.reset_at).getTime() / 1e3),
    "X-RateLimit-Window": windowSeconds
  };
  if (!result.allowed && result.retry_after !== void 0) {
    headers["Retry-After"] = result.retry_after;
  }
  return headers;
}
function checkRateLimit(_userId, _tier, _endpoint) {
  throw new Error("checkRateLimit: External stub \u2014 implement in application layer");
}
function getTierWithCache(_userId, _cacheTtlSeconds = 60) {
  throw new Error("getTierWithCache: External stub \u2014 implement in application layer");
}

// src/api/auth-middleware.ts
function extractAuthContextFromJWT(claims) {
  return {
    user_id: claims.sub,
    tier: claims.metadata.tier,
    privacy_tier: claims.metadata.privacy,
    auth_method: "jwt"
  };
}
function isApiKeyToken(token) {
  return token.startsWith(API_KEY_PREFIX_LIVE) || token.startsWith(API_KEY_PREFIX_TEST);
}
function isTokenExpired(claims) {
  return claims.exp * 1e3 < Date.now();
}
function validateAuthToken(_token) {
  throw new Error("validateAuthToken: External stub \u2014 implement in application layer");
}

// src/api/sse-chat.ts
function formatChatSSEEvent(eventType, data, eventId) {
  return `event: ${eventType}
id: ${eventId}
data: ${JSON.stringify(data)}

`;
}
function isReconnectionValid(lastEventTimestamp, windowMs = CHAT_SSE_RECONNECT_WINDOW_MS) {
  return Date.now() - lastEventTimestamp < windowMs;
}
function generateEventId(prefix, sequence) {
  return `${prefix}_${sequence.toString().padStart(3, "0")}`;
}

// src/api/validators.ts
function validateCreateNodeRequest(data) {
  return CreateNodeRequestSchema.parse(data);
}
function validateUpdateNodeRequest(data) {
  return UpdateNodeRequestSchema.parse(data);
}
function validateBatchCreateNodesRequest(data) {
  return BatchCreateNodesRequestSchema.parse(data);
}
function validateCreateEdgeRequest(data) {
  return CreateEdgeRequestSchema.parse(data);
}
function validateUpdateEdgeRequest(data) {
  return UpdateEdgeRequestSchema.parse(data);
}
function validateAdvancedSearchRequest(data) {
  return AdvancedSearchRequestSchema.parse(data);
}
function validateChatRequest(data) {
  return ChatRequestSchema.parse(data);
}
function validateExecuteActionRequest(data) {
  return ExecuteActionRequestSchema.parse(data);
}
function validateIngestTextRequest(data) {
  return IngestTextRequestSchema.parse(data);
}
function validateSyncPushRequest(data) {
  return SyncPushRequestSchema.parse(data);
}
function validateResolveConflictRequest(data) {
  return ResolveConflictRequestSchema.parse(data);
}
function validateFullSyncRequest(data) {
  return FullSyncRequestSchema.parse(data);
}
function validateUpdateSettingsRequest(data) {
  return UpdateSettingsRequestSchema.parse(data);
}
function validateCreateAPIKeyRequest(data) {
  return CreateAPIKeyRequestSchema.parse(data);
}
function validateCostEstimateRequest(data) {
  return CostEstimateRequestSchema.parse(data);
}

// src/api/data-flows.ts
var CHAT_FLOW_STEPS = [
  { name: "validate_auth", service: "Auth", description: "Validate JWT/API key" },
  { name: "check_credits", service: "Credits", description: "Verify sufficient balance" },
  { name: "classify_query", service: "Classifier", description: "Determine query type (storm-008)" },
  { name: "embed_query", service: "Embedding", description: "Generate query embedding (storm-016)" },
  { name: "hybrid_search", service: "Turso", description: "Vector + BM25 search (storm-016)" },
  { name: "ssa_expansion", service: "Graph", description: "Spreading activation (storm-005)" },
  { name: "llm_call", service: "LLM Provider", description: "Stream response (storm-015)" },
  { name: "deduct_cost", service: "Credits", description: "Deduct actual cost" },
  { name: "store_conversation", service: "Turso", description: "Persist conversation" }
];
var SYNC_FLOW_STEPS = [
  { name: "check_status", service: "Turso", description: "Get current sync state" },
  { name: "push_changes", service: "Turso", description: "Send local changes to server" },
  { name: "detect_conflicts", service: "NSE", description: "Check for concurrent edits (storm-033)" },
  { name: "apply_nonconflicting", service: "Turso", description: "Apply clean changes" },
  { name: "resolve_conflicts", service: "NSE + User", description: "Auto-merge or user resolution" },
  { name: "pull_changes", service: "Turso", description: "Fetch remote changes since last sync" }
];
var INGESTION_FLOW_STEPS = [
  { name: "receive", service: "Adapter", description: "Normalize input (storm-014 stage 1)" },
  { name: "classify", service: "Classifier", description: "Intent + save signal (storm-014 stage 2)" },
  { name: "route", service: "Router", description: "Select handler based on classification" },
  { name: "process", service: "Extractor", description: "Extract concepts if content type" },
  { name: "stage_embed", service: "Embedding", description: "Generate embeddings (storm-016)" },
  { name: "stage_dedup", service: "Turso", description: "Check for duplicates" },
  { name: "commit_nodes", service: "Turso", description: "Create node records" },
  { name: "commit_edges", service: "Graph", description: "Create edge records" }
];
function getFlowSteps(flowType) {
  switch (flowType) {
    case "chat":
      return CHAT_FLOW_STEPS;
    case "sync":
      return SYNC_FLOW_STEPS;
    case "ingestion":
      return INGESTION_FLOW_STEPS;
  }
}
function createFlowExecution(flowType, requestId) {
  const steps = getFlowSteps(flowType);
  const firstStep = steps[0];
  return {
    flow_type: flowType,
    request_id: requestId,
    current_step: firstStep ? firstStep.name : "",
    started_at: Date.now(),
    steps_completed: []
  };
}

export { ACTION_STATUSES, AGENT_SUGGESTION_LEVELS, AGENT_TOOL_CATEGORIES, APIKeyDisplayInfoSchema, API_ERROR_CODES, API_KEY_PREFIX_LIVE, API_KEY_PREFIX_TEST, API_KEY_SCOPES, AUTH_METHODS, ActionHistoryItemSchema, ActionResultSchema, AdvancedSearchRequestSchema, AgentPermissionsSchema, AgentToolInfoSchema, ApiErrorResponseExtendedSchema, AuthContextSchema, BURST_ALLOWANCE_PERCENT, BURST_LIMITS, BatchCreateNodesRequestSchema, BatchFailureItemSchema, CHAT_FLOW_STEPS, CHAT_SSE_EVENT_TYPES, CHAT_SSE_KEEPALIVE_INTERVAL_MS, CHAT_SSE_MAX_DURATION_MS, CHAT_SSE_RECONNECT_WINDOW_MS, CONTENT_LIMITS, CORS_ALLOWED_HEADERS, CORS_ALLOWED_METHODS, CORS_ALLOWED_ORIGINS, CORS_MAX_AGE_SECONDS, CREDIT_OPERATIONS, CURSOR_PAGINATION_DEFAULT_LIMIT, CURSOR_PAGINATION_MAX_LIMIT, ChatDoneEventSchema, ChatRequestSchema, ChatResponseChunkEventSchema, ChatResponseCompleteEventSchema, ChatResponseStartEventSchema, ChatRetrievalCompleteEventSchema, ChatRetrievalNodeEventSchema, ChatRetrievalStartEventSchema, ChatSessionExpiredEventSchema, ChatSessionStartEventSchema, ChatSourceSchema, ClusterListItemSchema, ContentLimitsInfoSchema, ConversationMessageSchema, ConversationSummarySchema, CostEstimateRequestSchema, CreateAPIKeyRequestSchema, CreateEdgeRequestSchema, CreateNodeRequestSchema, CreatedNodeSummarySchema, CursorPaginationRequestSchema, CursorPaginationResponseSchema, EDGE_DIRECTIONS, EMBEDDING_STATUSES, ENDPOINT_RATE_LIMITS, ENDPOINT_TIMEOUTS, EdgeResponseSchema, EmbeddingInfoSchema, ExecuteActionRequestSchema, FLOW_TYPES, FULL_SYNC_REASONS, FlowExecutionSchema, FlowStepSchema, FullSyncRequestSchema, GetNodeParamsSchema, IDEMPOTENCY_TTL_MS, INGESTION_FLOW_STEPS, INGEST_ACTIONS, INGEST_MODES, INGEST_PRIORITIES, INGEST_SOURCES, IdempotencyRecordSchema, IngestClassificationResponseSchema, IngestJobStageSchema, IngestTextRequestSchema, JOB_STATUSES, JWTClaimsSchema, LIFECYCLE_STATES, ListEdgesParamsSchema, ListNodesParamsSchema, NodeResponseSchema, NotificationSettingsSchema, OFFSET_PAGINATION_DEFAULT_LIMIT, OFFSET_PAGINATION_MAX_LIMIT, OffsetPaginationRequestSchema, OffsetPaginationResponseSchema, PRIVACY_TIERS, PreviewResultSchema, PulledChangeSchema, RATE_LIMIT_ALERT_THRESHOLDS, RATE_LIMIT_ALGORITHMS, RATE_LIMIT_TYPES, REDIS_FALLBACK_LIMIT_PERCENT, REDIS_KEY_PATTERNS, REDIS_TTL_API_MS, REDIS_TTL_CONCURRENT_MS, REDIS_TTL_ENDPOINT_MS, REDIS_TTL_LLM_MS, RateLimitErrorResponseSchema, RateLimitMetricsSchema, RateLimitResultSchema, RefreshTokenRequestSchema, RefreshTokenResponseSchema, ResolveConflictRequestSchema, SYNC_CONFLICT_TYPES, SYNC_FLOW_STEPS, SYNC_OPERATIONS, SYNC_RESOLUTIONS, SYNC_TABLES, SearchResultItemSchema, SimpleSearchParamsSchema, SlidingWindowStateSchema, SyncAppliedItemSchema, SyncChangeSchema, SyncConflictItemSchema, SyncPullParamsSchema, SyncPushRequestSchema, THEME_OPTIONS, TIER_LIMITS, TIER_RANKS, TokenBucketStateSchema, USAGE_GROUP_BY, USER_TIERS, UpdateClusterRequestSchema, UpdateEdgeRequestSchema, UpdateNodeRequestSchema, UpdateSettingsRequestSchema, UsageByDaySchema, UserPreferencesSchema, UserTierSchema, ValidationFieldErrorSchema, WebhookCallbackSchema, buildRedisKey, calculateRetryAfter, calculateTokenBucketRetryAfter, checkRateLimit, createBatchSizeError, createContentLimitError, createCursorPaginationResponse, createExtendedApiError, createFlowExecution, createOffsetPaginationResponse, createValidationError, extractAuthContextFromJWT, formatChatSSEEvent, formatRateLimitHeaders, generateEventId, getContentLimits, getDocsUrl, getFlowSteps, getHttpStatusForErrorCode, getTierWithCache, isApiErrorCode, isApiKeyScope, isApiKeyToken, isChatSSEEventType, isEdgeDirection, isEmbeddingStatus, isIngestAction, isIngestSource, isJobStatus, isRateLimitType, isRateLimitedEndpoint, isReconnectionValid, isSyncConflictType, isSyncOperation, isSyncResolution, isTokenExpired, isUserTier, normalizeCursorParams, normalizeOffsetParams, tierRank, validateAdvancedSearchRequest, validateAuthToken, validateBatchCreateNodesRequest, validateChatRequest, validateCostEstimateRequest, validateCreateAPIKeyRequest, validateCreateEdgeRequest, validateCreateNodeRequest, validateExecuteActionRequest, validateFullSyncRequest, validateIngestTextRequest, validateResolveConflictRequest, validateSyncPushRequest, validateUpdateEdgeRequest, validateUpdateNodeRequest, validateUpdateSettingsRequest };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map