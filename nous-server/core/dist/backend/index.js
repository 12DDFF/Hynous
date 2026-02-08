import { z } from 'zod';

// src/backend/constants.ts
var API_VERSION = "v1";
var API_BASE_PATH = "/v1";
var DEPLOYMENT_TARGETS = ["cloudflare_workers", "fly_io", "docker", "local"];
function isDeploymentTarget(value) {
  return typeof value === "string" && DEPLOYMENT_TARGETS.includes(value);
}
var DEPLOYMENT_ENVIRONMENTS = ["development", "staging", "production"];
function isDeploymentEnvironment(value) {
  return typeof value === "string" && DEPLOYMENT_ENVIRONMENTS.includes(value);
}
var DATABASE_ADAPTER_TYPES = ["turso", "sqlite"];
var AUTH_ADAPTER_TYPES = ["clerk", "local"];
var LLM_ADAPTER_TYPES = ["openai", "anthropic", "google", "mock"];
var EMBEDDING_ADAPTER_TYPES = ["openai", "mock"];
var STORAGE_ADAPTER_TYPES = ["s3", "local", "mock"];
var JOB_QUEUE_ADAPTER_TYPES = ["cloudflare", "bullmq", "memory"];
var JOB_TIERS = ["inline", "queued", "regional"];
function isJobTier(value) {
  return typeof value === "string" && JOB_TIERS.includes(value);
}
var JOB_TYPES = [
  "embed",
  "deduplicate",
  "infer-edges",
  "process-document",
  "batch-embed",
  "sync-push-notification"
];
function isJobType(value) {
  return typeof value === "string" && JOB_TYPES.includes(value);
}
var CRON_JOB_TYPES = [
  "decay-cycle",
  "reorganize",
  "cleanup-expired"
];
function isCronJobType(value) {
  return typeof value === "string" && CRON_JOB_TYPES.includes(value);
}
var JOB_PRIORITIES = ["high", "normal", "low"];
var JOB_TIER_LIMITS = {
  inline: { max_duration_ms: 50 },
  queued: { max_duration_ms: 3e4 },
  regional: { max_duration_ms: 6e5 }
};
var QUEUED_JOB_TYPES = [
  "embed",
  "deduplicate",
  "infer-edges",
  "sync-push-notification"
];
var REGIONAL_JOB_TYPES = [
  "process-document",
  "batch-embed"
];
var DEFAULT_JOB_RETRY_COUNT = 3;
var DEFAULT_JOB_RETRY_DELAY_MS = 1e3;
var SSE_MAX_DURATION_MS = 25e3;
var SSE_HEARTBEAT_INTERVAL_MS = 15e3;
var SSE_RECONNECT_DEFAULT = true;
var SSE_EVENT_TYPES = ["data", "ping", "timeout", "done", "error"];
function isSSEEventType(value) {
  return typeof value === "string" && SSE_EVENT_TYPES.includes(value);
}
var HEALTH_STATUSES = ["healthy", "degraded", "unhealthy"];
function isHealthStatus(value) {
  return typeof value === "string" && HEALTH_STATUSES.includes(value);
}
var HEALTH_CHECK_TIMEOUT_MS = 5e3;
var HEALTH_CHECK_SERVICES = ["database", "llm", "embedding", "auth", "jobs"];
var MIDDLEWARE_TYPES = ["cors", "auth", "rate_limit", "logging", "error"];
var MIDDLEWARE_ORDER = [
  "cors",
  "logging",
  "error",
  "auth",
  "rate_limit"
];
var DEFAULT_CORS_ORIGINS = ["*"];
var DEFAULT_RATE_LIMIT_RPM = 60;
var RATE_LIMIT_WINDOW_MS = 6e4;
var DEFAULT_PORT = 3e3;
var DEFAULT_HOST = "0.0.0.0";
var LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"];
function isLogLevel(value) {
  return typeof value === "string" && LOG_LEVELS.includes(value);
}
var DEFAULT_LOG_LEVEL = "info";
var SENTRY_TRACES_SAMPLE_RATE = 0.1;
var DEPLOYMENT_SCENARIOS = [
  "nous_cloud",
  "self_host_small",
  "self_host_scale",
  "enterprise"
];
function isDeploymentScenario(value) {
  return typeof value === "string" && DEPLOYMENT_SCENARIOS.includes(value);
}
var ROUTE_PREFIXES = {
  nodes: "/v1/nodes",
  edges: "/v1/edges",
  search: "/v1/search",
  chat: "/v1/chat",
  agent: "/v1/agent",
  sync: "/v1/sync",
  ingest: "/v1/ingest",
  settings: "/v1/settings",
  credits: "/v1/credits",
  clusters: "/v1/clusters",
  health: "/v1/health"
};
var AUTH_EXEMPT_PATHS = ["/v1/health"];
var ERROR_CODES = {
  UNAUTHORIZED: { status: 401, message: "Authentication required" },
  TOKEN_EXPIRED: { status: 401, message: "Token has expired" },
  FORBIDDEN: { status: 403, message: "Insufficient permissions" },
  NOT_FOUND: { status: 404, message: "Resource not found" },
  CONFLICT: { status: 409, message: "Version conflict" },
  RATE_LIMITED: { status: 429, message: "Too many requests" },
  VALIDATION_ERROR: { status: 400, message: "Invalid request data" },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
  SERVICE_UNAVAILABLE: { status: 503, message: "Service temporarily unavailable" }
};
var ListOptionsSchema = z.object({
  limit: z.number().int().min(1).max(1e3),
  offset: z.number().int().min(0),
  sort_by: z.string().optional(),
  sort_order: z.enum(["asc", "desc"]).optional(),
  filters: z.record(z.unknown()).optional()
});
var VectorSearchOptionsSchema = z.object({
  limit: z.number().int().min(1).max(500),
  min_similarity: z.number().min(0).max(1).optional(),
  filters: z.record(z.unknown()).optional()
});
var TextSearchOptionsSchema = z.object({
  limit: z.number().int().min(1).max(500),
  filters: z.record(z.unknown()).optional()
});
var HybridSearchOptionsSchema = z.object({
  limit: z.number().int().min(1).max(500),
  weights: z.object({
    vector: z.number().min(0).max(1),
    bm25: z.number().min(0).max(1)
  }).optional(),
  filters: z.record(z.unknown()).optional()
});
var SearchResultSchema = z.object({
  id: z.string(),
  score: z.number().min(0).max(1),
  node: z.record(z.unknown())
});
var ChangeSetSchema = z.object({
  changes: z.array(z.lazy(() => ChangeSchema)),
  currentVersion: z.number().int().min(0),
  hasMore: z.boolean()
});
var ChangeSchema = z.object({
  id: z.string(),
  table: z.enum(["nodes", "edges"]),
  operation: z.enum(["create", "update", "delete"]),
  data: z.record(z.unknown()),
  version: z.number().int().min(0),
  timestamp: z.string()
});
var ApplyResultSchema = z.object({
  applied: z.array(z.lazy(() => AppliedChangeSchema)),
  conflicts: z.array(z.lazy(() => AdapterConflictSchema)),
  serverVersion: z.number().int().min(0)
});
var AppliedChangeSchema = z.object({
  id: z.string(),
  operation: z.enum(["create", "update", "delete"]),
  version: z.number().int().min(0)
});
var AdapterConflictSchema = z.object({
  id: z.string(),
  conflictId: z.string(),
  type: z.enum(["VERSION_MISMATCH", "DELETED", "CONSTRAINT"]),
  clientVersion: z.number().int().min(0),
  serverVersion: z.number().int().min(0),
  serverData: z.record(z.unknown()),
  resolutionOptions: z.array(z.enum(["keep_local", "keep_server", "merge"]))
});
var AdapterMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string()
});
var CompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(AdapterMessageSchema),
  maxTokens: z.number().int().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  systemPrompt: z.string().optional(),
  cacheSystemPrompt: z.boolean().optional(),
  requestId: z.string().optional()
});
var CompletionResponseSchema = z.object({
  id: z.string(),
  content: z.string(),
  model: z.string(),
  usage: z.lazy(() => AdapterTokenUsageSchema),
  finishReason: z.enum(["stop", "length", "tool_use"])
});
var CompletionChunkSchema = z.object({
  id: z.string(),
  delta: z.string(),
  finishReason: z.enum(["stop", "length", "tool_use"]).optional()
});
var AdapterTokenUsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cachedTokens: z.number().int().min(0).optional()
});
var AdapterCostEstimateSchema = z.object({
  min: z.number().min(0),
  expected: z.number().min(0),
  max: z.number().min(0),
  breakdown: z.object({
    embedding: z.number().min(0).optional(),
    inputTokens: z.number().min(0),
    outputTokens: z.number().min(0),
    caching: z.number().min(0).optional()
  })
});
var UsageReportSchema = z.object({
  requestId: z.string(),
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cachedTokens: z.number().int().min(0),
  actualCost: z.number().min(0),
  latencyMs: z.number().min(0)
});
var AdapterAuthResultSchema = z.object({
  valid: z.boolean(),
  userId: z.string().optional(),
  tier: z.enum(["free", "credits", "pro"]).optional(),
  privacyTier: z.enum(["standard", "private"]).optional(),
  expiresAt: z.string().optional()
});
var AdapterUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  tier: z.enum(["free", "credits", "pro"]),
  privacyTier: z.enum(["standard", "private"])
});
var AdapterTokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string()
});
var AdapterApiKeyResultSchema = z.object({
  valid: z.boolean(),
  userId: z.string().optional(),
  scopes: z.array(z.string()).optional()
});
var JobSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.record(z.unknown()),
  priority: z.enum(["high", "normal", "low"]).optional(),
  correlationId: z.string().optional(),
  tenantId: z.string(),
  createdAt: z.string()
});
var JobEventSchema = z.object({
  jobId: z.string(),
  type: z.string(),
  tenantId: z.string(),
  correlationId: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().min(0).optional()
});
var FailedJobSchema = z.object({
  job: JobSchema,
  error: z.string(),
  failedAt: z.string(),
  attempts: z.number().int().min(1)
});
var JobTierConfigSchema = z.object({
  type: z.string(),
  tier: z.enum(["inline", "queued", "regional"]),
  max_duration_ms: z.number().int().min(0),
  retry_count: z.number().int().min(0),
  retry_delay_ms: z.number().int().min(0)
});
var JobMetricsSchema = z.object({
  queue_depth: z.number().int().min(0),
  processing_count: z.number().int().min(0),
  completed_count: z.number().int().min(0),
  failed_count: z.number().int().min(0),
  avg_processing_time_ms: z.number().min(0)
});
var RouteGroupSchema = z.object({
  prefix: z.string(),
  description: z.string(),
  auth_required: z.boolean(),
  rate_limited: z.boolean()
});
var CORSConfigSchema = z.object({
  origins: z.array(z.string()),
  methods: z.array(z.string()),
  headers: z.array(z.string()),
  credentials: z.boolean()
});
var AuthMiddlewareConfigSchema = z.object({
  exclude_paths: z.array(z.string()),
  token_header: z.string(),
  token_prefix: z.string()
});
var ServerRateLimitConfigSchema = z.object({
  requests_per_minute: z.number().int().min(1),
  window_ms: z.number().int().min(1e3),
  key_prefix: z.string()
});
var LoggingMiddlewareConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error", "fatal"]),
  format: z.enum(["json", "text"]),
  include_request_id: z.boolean()
});
var ErrorMiddlewareConfigSchema = z.object({
  expose_errors: z.boolean(),
  sentry_dsn: z.string().optional()
});
var MiddlewareConfigSchema = z.object({
  cors: CORSConfigSchema,
  auth: AuthMiddlewareConfigSchema,
  rateLimit: ServerRateLimitConfigSchema,
  logging: LoggingMiddlewareConfigSchema,
  error: ErrorMiddlewareConfigSchema
});
var ApiErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  request_id: z.string().optional()
});
var SSEOptionsSchema = z.object({
  maxDurationMs: z.number().int().min(1e3).optional(),
  heartbeatMs: z.number().int().min(1e3).optional(),
  reconnectable: z.boolean().optional()
});
var SSEEventSchema = z.object({
  event: z.enum(["data", "ping", "timeout", "done", "error"]),
  id: z.string().optional(),
  data: z.string()
});
var SSEStreamStateSchema = z.object({
  eventId: z.number().int().min(0),
  startTime: z.number(),
  lastEventId: z.string().optional(),
  closed: z.boolean()
});
var ChatStreamChunkSchema = z.object({
  type: z.enum(["token", "source", "done", "error"]),
  content: z.string().optional(),
  sources: z.array(z.string()).optional(),
  error: z.string().optional()
});
var TursoDatabaseConfigSchema = z.object({
  type: z.literal("turso"),
  /** Turso database URL (libsql://...) */
  url: z.string().url(),
  /** Turso auth token */
  authToken: z.string().min(1)
});
var SqliteDatabaseConfigSchema = z.object({
  type: z.literal("sqlite"),
  /** Path to SQLite database file */
  path: z.string().min(1)
});
var DatabaseConfigSchema = z.discriminatedUnion("type", [
  TursoDatabaseConfigSchema,
  SqliteDatabaseConfigSchema
]);
var ClerkAuthConfigSchema = z.object({
  type: z.literal("clerk"),
  /** Clerk secret key (server-side) */
  secretKey: z.string().min(1),
  /** Clerk publishable key */
  publishableKey: z.string().min(1)
});
var LocalAuthConfigSchema = z.object({
  type: z.literal("local"),
  /** JWT signing secret (optional, auto-generated if not set) */
  jwtSecret: z.string().optional()
});
var AuthConfigSchema = z.discriminatedUnion("type", [
  ClerkAuthConfigSchema,
  LocalAuthConfigSchema
]);
var LLMConfigSchema = z.object({
  openai: z.object({ apiKey: z.string().min(1) }).optional(),
  anthropic: z.object({ apiKey: z.string().min(1) }).optional(),
  google: z.object({ apiKey: z.string().min(1) }).optional()
});
var CloudflareJobsConfigSchema = z.object({
  type: z.literal("cloudflare")
});
var BullMQJobsConfigSchema = z.object({
  type: z.literal("bullmq"),
  /** Redis connection URL */
  redisUrl: z.string().url()
});
var MemoryJobsConfigSchema = z.object({
  type: z.literal("memory")
});
var JobsConfigSchema = z.discriminatedUnion("type", [
  CloudflareJobsConfigSchema,
  BullMQJobsConfigSchema,
  MemoryJobsConfigSchema
]);
var ObservabilityConfigSchema = z.object({
  /** Sentry DSN for error tracking */
  sentryDsn: z.string().url().optional(),
  /** Log level */
  logLevel: z.enum(["debug", "info", "warn", "error", "fatal"]).default("info")
});
var NousConfigSchema = z.object({
  /** Deployment environment */
  env: z.enum(["development", "staging", "production"]).default("development"),
  /** Server port */
  port: z.coerce.number().int().min(1).max(65535).default(3e3),
  /** Server host */
  host: z.string().default("0.0.0.0"),
  /** Database configuration */
  database: DatabaseConfigSchema,
  /** Authentication configuration */
  auth: AuthConfigSchema,
  /** LLM provider configuration */
  llm: LLMConfigSchema,
  /** Job queue configuration */
  jobs: JobsConfigSchema,
  /** Observability configuration */
  observability: ObservabilityConfigSchema
});
var HealthCheckResponseSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  version: z.string(),
  timestamp: z.string(),
  services: z.record(z.lazy(() => ServiceHealthSchema)),
  metrics: z.lazy(() => HealthMetricsSchema).optional()
});
var ServiceHealthSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  latency_ms: z.number().min(0).optional(),
  error: z.string().optional()
});
var HealthMetricsSchema = z.object({
  jobQueueDepth: z.number().int().min(0).optional(),
  activeConnections: z.number().int().min(0).optional(),
  uptime_seconds: z.number().min(0).optional()
});
var ReadinessCheckSchema = z.object({
  ready: z.boolean(),
  checks: z.record(z.boolean())
});
var DeploymentMatrixEntrySchema = z.object({
  scenario: z.string(),
  api: z.string(),
  jobs: z.string(),
  database: z.string(),
  auth: z.string(),
  description: z.string()
});
var SelfHostConfigSchema = z.object({
  docker_compose_services: z.array(z.string()),
  required_env_vars: z.array(z.string()),
  optional_env_vars: z.array(z.string()),
  min_ram_mb: z.number().int().min(0),
  recommended_ram_mb: z.number().int().min(0),
  volumes: z.array(z.string())
});
var DockerServiceConfigSchema = z.object({
  name: z.string(),
  image: z.string(),
  ports: z.array(z.string()).optional(),
  environment: z.array(z.string()),
  volumes: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).optional()
});
var StructuredLogEntrySchema = z.object({
  timestamp: z.string(),
  requestId: z.string(),
  level: z.enum(["debug", "info", "warn", "error", "fatal"]),
  method: z.string().optional(),
  path: z.string().optional(),
  status: z.number().int().optional(),
  duration_ms: z.number().min(0).optional(),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional()
});
var MetricsConfigSchema = z.object({
  request_count: z.boolean(),
  request_duration: z.boolean(),
  llm_cost: z.boolean(),
  embedding_count: z.boolean(),
  job_queue_size: z.boolean()
});
var SentryConfigSchema = z.object({
  dsn: z.string().url(),
  traces_sample_rate: z.number().min(0).max(1),
  environment: z.enum(["development", "staging", "production"]),
  release: z.string().optional()
});
var RequestContextSchema = z.object({
  requestId: z.string(),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  startTime: z.number()
});
var LocalDevConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  database_path: z.string(),
  auto_seed: z.boolean(),
  mock_llm_latency_ms: z.number().int().min(0),
  mock_embedding_deterministic: z.boolean(),
  accept_any_token: z.boolean(),
  process_jobs_immediately: z.boolean()
});
var SeedUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  tier: z.enum(["free", "credits", "pro"])
});
var SeedDataConfigSchema = z.object({
  users: z.array(SeedUserSchema),
  node_count: z.number().int().min(0),
  edge_count: z.number().int().min(0)
});
var MockLLMConfigSchema = z.object({
  latencyMs: z.number().int().min(0),
  mockResponses: z.boolean(),
  deterministicOutputs: z.boolean()
});
var MockEmbeddingConfigSchema = z.object({
  dimensions: z.number().int().min(1),
  deterministic: z.boolean()
});
var MockJobQueueConfigSchema = z.object({
  processImmediately: z.boolean()
});
var LocalAuthDevConfigSchema = z.object({
  users: z.array(SeedUserSchema),
  acceptAnyToken: z.boolean()
});
function createPaginatedResultSchema(itemSchema) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().min(0),
    has_more: z.boolean()
  });
}

// src/backend/server.ts
var ROUTE_GROUPS = [
  { prefix: "/v1/nodes", description: "Node CRUD operations", auth_required: true, rate_limited: true },
  { prefix: "/v1/edges", description: "Edge CRUD operations", auth_required: true, rate_limited: true },
  { prefix: "/v1/search", description: "Vector, text, and hybrid search", auth_required: true, rate_limited: true },
  { prefix: "/v1/chat", description: "Chat with SSE streaming", auth_required: true, rate_limited: true },
  { prefix: "/v1/agent", description: "AI agent tool execution", auth_required: true, rate_limited: true },
  { prefix: "/v1/sync", description: "Multi-device sync protocol", auth_required: true, rate_limited: false },
  { prefix: "/v1/ingest", description: "Content ingestion pipeline", auth_required: true, rate_limited: true },
  { prefix: "/v1/settings", description: "User preferences and settings", auth_required: true, rate_limited: false },
  { prefix: "/v1/credits", description: "Credit balance and transactions", auth_required: true, rate_limited: false },
  { prefix: "/v1/clusters", description: "Memory cluster management", auth_required: true, rate_limited: true },
  { prefix: "/v1/health", description: "Health check endpoint", auth_required: false, rate_limited: false }
];
var DEFAULT_MIDDLEWARE_CONFIG = {
  cors: {
    origins: ["*"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    headers: ["Content-Type", "Authorization", "Last-Event-ID"],
    credentials: true
  },
  auth: {
    exclude_paths: ["/v1/health"],
    token_header: "Authorization",
    token_prefix: "Bearer "
  },
  rateLimit: {
    requests_per_minute: 60,
    window_ms: 6e4,
    key_prefix: "rl:"
  },
  logging: {
    level: "info",
    format: "json",
    include_request_id: true
  },
  error: {
    expose_errors: false,
    sentry_dsn: void 0
  }
};
function createApiError(code, message, details, request_id) {
  return {
    code,
    message,
    ...details && { details },
    ...request_id && { request_id }
  };
}
function getRouteGroup(prefix) {
  return ROUTE_GROUPS.find((g) => g.prefix === prefix);
}
function requiresAuth(path) {
  const group = ROUTE_GROUPS.find((g) => path.startsWith(g.prefix));
  return group?.auth_required ?? true;
}
function createServer(_config) {
  throw new Error("createServer requires Hono framework implementation");
}

// src/backend/jobs.ts
var JOB_TIER_ASSIGNMENTS = {
  // Tier 2: Queued (<30s)
  "embed": {
    type: "embed",
    tier: "queued",
    max_duration_ms: 1e4,
    retry_count: 3,
    retry_delay_ms: 1e3
  },
  "deduplicate": {
    type: "deduplicate",
    tier: "queued",
    max_duration_ms: 15e3,
    retry_count: 3,
    retry_delay_ms: 1e3
  },
  "infer-edges": {
    type: "infer-edges",
    tier: "queued",
    max_duration_ms: 2e4,
    retry_count: 3,
    retry_delay_ms: 2e3
  },
  "sync-push-notification": {
    type: "sync-push-notification",
    tier: "queued",
    max_duration_ms: 5e3,
    retry_count: 5,
    retry_delay_ms: 500
  },
  // Tier 3: Regional (<10min)
  "process-document": {
    type: "process-document",
    tier: "regional",
    max_duration_ms: 3e5,
    retry_count: 2,
    retry_delay_ms: 5e3
  },
  "batch-embed": {
    type: "batch-embed",
    tier: "regional",
    max_duration_ms: 6e5,
    retry_count: 2,
    retry_delay_ms: 1e4
  },
  // Cron jobs: Regional
  "decay-cycle": {
    type: "decay-cycle",
    tier: "regional",
    max_duration_ms: 3e5,
    retry_count: 1,
    retry_delay_ms: 6e4
  },
  "reorganize": {
    type: "reorganize",
    tier: "regional",
    max_duration_ms: 6e5,
    retry_count: 1,
    retry_delay_ms: 6e4
  },
  "cleanup-expired": {
    type: "cleanup-expired",
    tier: "regional",
    max_duration_ms: 12e4,
    retry_count: 1,
    retry_delay_ms: 3e4
  }
};
function getJobTierForType(type) {
  return JOB_TIER_ASSIGNMENTS[type].tier;
}
function getJobTierConfig(type) {
  return JOB_TIER_ASSIGNMENTS[type];
}
function createJob(type, payload, tenantId, options) {
  return {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    priority: options?.priority ?? "normal",
    correlationId: options?.correlationId,
    tenantId,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function isJobExpired(job, startedAt) {
  const config = JOB_TIER_ASSIGNMENTS[job.type];
  const elapsed = Date.now() - new Date(startedAt).getTime();
  return elapsed > config.max_duration_ms;
}

// src/backend/config.ts
var ENV_VAR_MAPPING = {
  "env": "NODE_ENV",
  "port": "PORT",
  "host": "HOST",
  "database.turso.url": "TURSO_URL",
  "database.turso.authToken": "TURSO_AUTH_TOKEN",
  "database.sqlite.path": "DATABASE_PATH",
  "auth.clerk.secretKey": "CLERK_SECRET_KEY",
  "auth.clerk.publishableKey": "CLERK_PUBLISHABLE_KEY",
  "auth.local.jwtSecret": "JWT_SECRET",
  "llm.openai.apiKey": "OPENAI_API_KEY",
  "llm.anthropic.apiKey": "ANTHROPIC_API_KEY",
  "llm.google.apiKey": "GOOGLE_API_KEY",
  "jobs.bullmq.redisUrl": "REDIS_URL",
  "observability.sentryDsn": "SENTRY_DSN",
  "observability.logLevel": "LOG_LEVEL"
};
function validateConfig(raw) {
  return NousConfigSchema.parse(raw);
}
function safeValidateConfig(raw) {
  return NousConfigSchema.safeParse(raw);
}
function getEnvVarName(configPath) {
  return ENV_VAR_MAPPING[configPath];
}
function loadConfig() {
  throw new Error("loadConfig requires process.env access and should be implemented at the application level");
}

// src/backend/deployment.ts
var DEPLOYMENT_MATRIX = {
  nous_cloud: {
    scenario: "nous_cloud",
    api: "cloudflare_workers",
    jobs: "cloudflare",
    database: "turso",
    auth: "clerk",
    description: "Production Nous Cloud: edge API + Turso + Clerk + Cloudflare Queues"
  },
  self_host_small: {
    scenario: "self_host_small",
    api: "docker",
    jobs: "memory",
    database: "sqlite",
    auth: "local",
    description: "Small self-hosted: single Docker container, in-process jobs, SQLite file"
  },
  self_host_scale: {
    scenario: "self_host_scale",
    api: "docker",
    jobs: "bullmq",
    database: "sqlite",
    auth: "local",
    description: "Scaled self-hosted: multiple Docker containers, BullMQ + Redis, SQLite file"
  },
  enterprise: {
    scenario: "enterprise",
    api: "docker",
    jobs: "bullmq",
    database: "sqlite",
    auth: "local",
    description: "Enterprise: Kubernetes-ready, BullMQ + Redis, SQLite (or community Postgres adapter)"
  }
};
var DEFAULT_SELF_HOST_CONFIG = {
  docker_compose_services: ["api", "jobs", "redis"],
  required_env_vars: ["OPENAI_API_KEY"],
  optional_env_vars: [
    "DATABASE_PATH",
    "PORT",
    "JWT_SECRET",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "REDIS_URL",
    "SENTRY_DSN",
    "LOG_LEVEL"
  ],
  min_ram_mb: 1024,
  recommended_ram_mb: 2048,
  volumes: ["/data/nous.db"]
};
var DOCKER_SERVICES = [
  {
    name: "api",
    image: "nous-api:latest",
    ports: ["3000:3000"],
    environment: [
      "DATABASE_PATH=/data/nous.db",
      "AUTH_MODE=local",
      "REDIS_URL=redis://redis:6379"
    ],
    volumes: ["nous-data:/data"],
    depends_on: ["redis"]
  },
  {
    name: "jobs",
    image: "nous-jobs:latest",
    environment: [
      "DATABASE_PATH=/data/nous.db",
      "REDIS_URL=redis://redis:6379"
    ],
    volumes: ["nous-data:/data"],
    depends_on: ["redis"]
  },
  {
    name: "redis",
    image: "redis:7-alpine",
    ports: ["6379:6379"],
    environment: []
  }
];
function getDeploymentConfig(scenario) {
  return DEPLOYMENT_MATRIX[scenario];
}
function getSelfHostRequirements() {
  return DEFAULT_SELF_HOST_CONFIG;
}
function getDockerServices(scenario) {
  if (scenario === "self_host_small") {
    return DOCKER_SERVICES.filter((s) => s.name === "api");
  }
  return DOCKER_SERVICES;
}
function requiresRedis(scenario) {
  const config = DEPLOYMENT_MATRIX[scenario];
  return config.jobs === "bullmq";
}

// src/backend/health.ts
function isAllHealthy(response) {
  return Object.values(response.services).every((s) => s.status === "healthy");
}
function determineOverallHealth(services) {
  const statuses = Object.values(services).map((s) => s.status);
  if (statuses.every((s) => s === "healthy")) {
    return "healthy";
  }
  if (statuses.some((s) => s === "unhealthy")) {
    return "unhealthy";
  }
  return "degraded";
}
function getHttpStatusForHealth(status) {
  return status === "healthy" ? 200 : 503;
}
async function checkAllServices(_config) {
  throw new Error("checkAllServices requires adapter instances for health probing");
}
async function checkServiceHealth(_service, _adapter) {
  throw new Error("checkServiceHealth requires adapter instance for health probing");
}

// src/backend/observability.ts
var DEFAULT_METRICS_CONFIG = {
  request_count: true,
  request_duration: true,
  llm_cost: true,
  embedding_count: true,
  job_queue_size: true
};
function createRequestContext() {
  return {
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    startTime: Date.now()
  };
}
function formatLogEntry(entry) {
  return JSON.stringify(entry);
}
function calculateRequestDuration(context) {
  return Date.now() - context.startTime;
}
function shouldLog(level, minLevel) {
  const levels = ["debug", "info", "warn", "error", "fatal"];
  return levels.indexOf(level) >= levels.indexOf(minLevel);
}

// src/backend/sse.ts
var DEFAULT_SSE_OPTIONS = {
  maxDurationMs: 25e3,
  heartbeatMs: 15e3,
  reconnectable: true
};
function formatSSEEvent(event) {
  let result = `event: ${event.event}
`;
  if (event.id !== void 0) {
    result += `id: ${event.id}
`;
  }
  result += `data: ${event.data}

`;
  return result;
}
function parseLastEventId(header) {
  if (!header || header.trim() === "") {
    return void 0;
  }
  return header.trim();
}
function createSSEStreamState(lastEventIdHeader) {
  return {
    eventId: 0,
    startTime: Date.now(),
    lastEventId: parseLastEventId(lastEventIdHeader),
    closed: false
  };
}
function isStreamExpired(state, maxDurationMs) {
  return Date.now() - state.startTime > maxDurationMs;
}
function createSSEStream(_context, _generator, _options) {
  throw new Error("createSSEStream requires Hono framework implementation");
}

// src/backend/local-dev.ts
var DEFAULT_LOCAL_DEV_CONFIG = {
  port: 3e3,
  database_path: "./data/dev.db",
  auto_seed: true,
  mock_llm_latency_ms: 100,
  mock_embedding_deterministic: true,
  accept_any_token: true,
  process_jobs_immediately: true
};
var DEV_USER = {
  id: "dev-user",
  email: "dev@localhost",
  tier: "pro"
};
var DEFAULT_SEED_DATA = {
  users: [DEV_USER],
  node_count: 10,
  edge_count: 5
};
function getLocalDevConfig() {
  return { ...DEFAULT_LOCAL_DEV_CONFIG };
}
function getDefaultSeedUsers() {
  return [{ ...DEV_USER }];
}
function getMockAdapterConfigs() {
  return {
    llm: {
      latencyMs: 100,
      mockResponses: true,
      deterministicOutputs: true
    },
    embedding: {
      dimensions: 1536,
      deterministic: true
    },
    jobs: {
      processImmediately: true
    },
    auth: {
      users: [{ ...DEV_USER }],
      acceptAnyToken: true
    }
  };
}

export { API_BASE_PATH, API_VERSION, AUTH_ADAPTER_TYPES, AUTH_EXEMPT_PATHS, AdapterApiKeyResultSchema, AdapterAuthResultSchema, AdapterConflictSchema, AdapterCostEstimateSchema, AdapterMessageSchema, AdapterTokenPairSchema, AdapterTokenUsageSchema, AdapterUserSchema, ApiErrorResponseSchema, AppliedChangeSchema, ApplyResultSchema, AuthConfigSchema, AuthMiddlewareConfigSchema, BullMQJobsConfigSchema, CORSConfigSchema, CRON_JOB_TYPES, ChangeSchema, ChangeSetSchema, ChatStreamChunkSchema, ClerkAuthConfigSchema, CloudflareJobsConfigSchema, CompletionChunkSchema, CompletionRequestSchema, CompletionResponseSchema, DATABASE_ADAPTER_TYPES, DEFAULT_CORS_ORIGINS, DEFAULT_HOST, DEFAULT_JOB_RETRY_COUNT, DEFAULT_JOB_RETRY_DELAY_MS, DEFAULT_LOCAL_DEV_CONFIG, DEFAULT_LOG_LEVEL, DEFAULT_METRICS_CONFIG, DEFAULT_MIDDLEWARE_CONFIG, DEFAULT_PORT, DEFAULT_RATE_LIMIT_RPM, DEFAULT_SEED_DATA, DEFAULT_SELF_HOST_CONFIG, DEFAULT_SSE_OPTIONS, DEPLOYMENT_ENVIRONMENTS, DEPLOYMENT_MATRIX, DEPLOYMENT_SCENARIOS, DEPLOYMENT_TARGETS, DEV_USER, DOCKER_SERVICES, DatabaseConfigSchema, DeploymentMatrixEntrySchema, DockerServiceConfigSchema, EMBEDDING_ADAPTER_TYPES, ENV_VAR_MAPPING, ERROR_CODES, ErrorMiddlewareConfigSchema, FailedJobSchema, HEALTH_CHECK_SERVICES, HEALTH_CHECK_TIMEOUT_MS, HEALTH_STATUSES, HealthCheckResponseSchema, HealthMetricsSchema, HybridSearchOptionsSchema, JOB_PRIORITIES, JOB_QUEUE_ADAPTER_TYPES, JOB_TIERS, JOB_TIER_ASSIGNMENTS, JOB_TIER_LIMITS, JOB_TYPES, JobEventSchema, JobMetricsSchema, JobSchema, JobTierConfigSchema, JobsConfigSchema, LLMConfigSchema, LLM_ADAPTER_TYPES, LOG_LEVELS, ListOptionsSchema, LocalAuthConfigSchema, LocalAuthDevConfigSchema, LocalDevConfigSchema, LoggingMiddlewareConfigSchema, MIDDLEWARE_ORDER, MIDDLEWARE_TYPES, MemoryJobsConfigSchema, MetricsConfigSchema, MiddlewareConfigSchema, MockEmbeddingConfigSchema, MockJobQueueConfigSchema, MockLLMConfigSchema, NousConfigSchema, ObservabilityConfigSchema, QUEUED_JOB_TYPES, RATE_LIMIT_WINDOW_MS, REGIONAL_JOB_TYPES, ROUTE_GROUPS, ROUTE_PREFIXES, ReadinessCheckSchema, RequestContextSchema, RouteGroupSchema, SENTRY_TRACES_SAMPLE_RATE, SSEEventSchema, SSEOptionsSchema, SSEStreamStateSchema, SSE_EVENT_TYPES, SSE_HEARTBEAT_INTERVAL_MS, SSE_MAX_DURATION_MS, SSE_RECONNECT_DEFAULT, STORAGE_ADAPTER_TYPES, SearchResultSchema, SeedDataConfigSchema, SeedUserSchema, SelfHostConfigSchema, SentryConfigSchema, ServerRateLimitConfigSchema, ServiceHealthSchema, SqliteDatabaseConfigSchema, StructuredLogEntrySchema, TextSearchOptionsSchema, TursoDatabaseConfigSchema, UsageReportSchema, VectorSearchOptionsSchema, calculateRequestDuration, checkAllServices, checkServiceHealth, createApiError, createJob, createPaginatedResultSchema, createRequestContext, createSSEStream, createSSEStreamState, createServer, determineOverallHealth, formatLogEntry, formatSSEEvent, getDefaultSeedUsers, getDeploymentConfig, getDockerServices, getEnvVarName, getHttpStatusForHealth, getJobTierConfig, getJobTierForType, getLocalDevConfig, getMockAdapterConfigs, getRouteGroup, getSelfHostRequirements, isAllHealthy, isCronJobType, isDeploymentEnvironment, isDeploymentScenario, isDeploymentTarget, isHealthStatus, isJobExpired, isJobTier, isJobType, isLogLevel, isSSEEventType, isStreamExpired, loadConfig, parseLastEventId, requiresAuth, requiresRedis, safeValidateConfig, shouldLog, validateConfig };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map