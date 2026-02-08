/**
 * @module @nous/core/backend
 * @description Backend Infrastructure constants — deployment targets, job tiers, SSE limits, health checks
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * All constants for the Nous Backend Infrastructure module.
 * Organized by domain: API, deployment, adapters, jobs, SSE, health, middleware, observability.
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/constants.ts} - Spec
 */

// ============================================================
// API VERSIONING
// ============================================================

/** Current API version prefix */
export const API_VERSION = 'v1' as const;

/** Base path for all API routes */
export const API_BASE_PATH = '/v1' as const;

// ============================================================
// DEPLOYMENT TARGETS
// ============================================================

/**
 * Supported deployment targets for the Nous backend.
 * - cloudflare_workers: Edge deployment (low latency, global)
 * - fly_io: Regional container deployment (heavy processing)
 * - docker: Self-hosted via Docker Compose
 * - local: Local development with mock adapters
 */
export const DEPLOYMENT_TARGETS = ['cloudflare_workers', 'fly_io', 'docker', 'local'] as const;
export type DeploymentTarget = typeof DEPLOYMENT_TARGETS[number];

export function isDeploymentTarget(value: unknown): value is DeploymentTarget {
  return typeof value === 'string' && (DEPLOYMENT_TARGETS as readonly string[]).includes(value);
}

// ============================================================
// DEPLOYMENT ENVIRONMENTS
// ============================================================

/** Application environments */
export const DEPLOYMENT_ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type DeploymentEnvironment = typeof DEPLOYMENT_ENVIRONMENTS[number];

export function isDeploymentEnvironment(value: unknown): value is DeploymentEnvironment {
  return typeof value === 'string' && (DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(value);
}

// ============================================================
// ADAPTER TYPES
// ============================================================

/** Database adapter implementations */
export const DATABASE_ADAPTER_TYPES = ['turso', 'sqlite'] as const;
export type DatabaseAdapterType = typeof DATABASE_ADAPTER_TYPES[number];

/** Auth adapter implementations */
export const AUTH_ADAPTER_TYPES = ['clerk', 'local'] as const;
export type AuthAdapterType = typeof AUTH_ADAPTER_TYPES[number];

/** LLM adapter implementations */
export const LLM_ADAPTER_TYPES = ['openai', 'anthropic', 'google', 'mock'] as const;
export type LLMAdapterType = typeof LLM_ADAPTER_TYPES[number];

/** Embedding adapter implementations */
export const EMBEDDING_ADAPTER_TYPES = ['openai', 'mock'] as const;
export type EmbeddingAdapterType = typeof EMBEDDING_ADAPTER_TYPES[number];

/** Storage adapter implementations */
export const STORAGE_ADAPTER_TYPES = ['s3', 'local', 'mock'] as const;
export type StorageAdapterType = typeof STORAGE_ADAPTER_TYPES[number];

/** Job queue adapter implementations */
export const JOB_QUEUE_ADAPTER_TYPES = ['cloudflare', 'bullmq', 'memory'] as const;
export type JobQueueAdapterType = typeof JOB_QUEUE_ADAPTER_TYPES[number];

// ============================================================
// JOB SYSTEM
// ============================================================

/**
 * Job execution tiers.
 *
 * ```
 * ┌─────────────────────────────────────────────────────┐
 * │  TIER 1: INLINE    (<50ms)   Edge Workers           │
 * │  TIER 2: QUEUED    (<30s)    Cloudflare Queues       │
 * │  TIER 3: REGIONAL  (<10min)  Fly.io Containers       │
 * └─────────────────────────────────────────────────────┘
 * ```
 */
export const JOB_TIERS = ['inline', 'queued', 'regional'] as const;
export type JobTier = typeof JOB_TIERS[number];

export function isJobTier(value: unknown): value is JobTier {
  return typeof value === 'string' && (JOB_TIERS as readonly string[]).includes(value);
}

/**
 * Async job types (enqueued via IJobQueueAdapter).
 * - embed: Generate embedding for a single node (Tier 2)
 * - deduplicate: Check for duplicate content (Tier 2)
 * - infer-edges: Infer relationships between nodes (Tier 2)
 * - process-document: Parse and extract from documents (Tier 3)
 * - batch-embed: Batch embedding generation (Tier 3)
 * - sync-push-notification: Notify other devices of changes (Tier 2)
 */
export const JOB_TYPES = [
  'embed',
  'deduplicate',
  'infer-edges',
  'process-document',
  'batch-embed',
  'sync-push-notification',
] as const;
export type JobType = typeof JOB_TYPES[number];

export function isJobType(value: unknown): value is JobType {
  return typeof value === 'string' && (JOB_TYPES as readonly string[]).includes(value);
}

/**
 * Cron-scheduled job types.
 * - decay-cycle: Run FSRS decay calculations (storm-007)
 * - reorganize: Cluster reorganization (storm-006)
 * - cleanup-expired: Remove expired trash items (storm-007)
 */
export const CRON_JOB_TYPES = [
  'decay-cycle',
  'reorganize',
  'cleanup-expired',
] as const;
export type CronJobType = typeof CRON_JOB_TYPES[number];

export function isCronJobType(value: unknown): value is CronJobType {
  return typeof value === 'string' && (CRON_JOB_TYPES as readonly string[]).includes(value);
}

/** Job priority levels */
export const JOB_PRIORITIES = ['high', 'normal', 'low'] as const;
export type JobPriority = typeof JOB_PRIORITIES[number];

/**
 * Maximum duration per job tier.
 * Jobs exceeding their tier limit are killed and moved to DLQ.
 */
export const JOB_TIER_LIMITS = {
  inline: { max_duration_ms: 50 },
  queued: { max_duration_ms: 30_000 },
  regional: { max_duration_ms: 600_000 },
} as const;

/** Job types that run at the queued tier (Cloudflare Queues / BullMQ) */
export const QUEUED_JOB_TYPES: readonly JobType[] = [
  'embed',
  'deduplicate',
  'infer-edges',
  'sync-push-notification',
] as const;

/** Job types that run at the regional tier (Fly.io / long-running containers) */
export const REGIONAL_JOB_TYPES: readonly JobType[] = [
  'process-document',
  'batch-embed',
] as const;

/** Default retry configuration for failed jobs */
export const DEFAULT_JOB_RETRY_COUNT = 3;
export const DEFAULT_JOB_RETRY_DELAY_MS = 1_000;

// ============================================================
// SSE STREAMING
// ============================================================

/**
 * SSE (Server-Sent Events) configuration.
 * Cloudflare Workers have a 30s connection limit,
 * so we cap at 25s and send timeout events for reconnection.
 */
export const SSE_MAX_DURATION_MS = 25_000;
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
export const SSE_RECONNECT_DEFAULT = true;

/** SSE event types sent to clients */
export const SSE_EVENT_TYPES = ['data', 'ping', 'timeout', 'done', 'error'] as const;
export type SSEEventType = typeof SSE_EVENT_TYPES[number];

export function isSSEEventType(value: unknown): value is SSEEventType {
  return typeof value === 'string' && (SSE_EVENT_TYPES as readonly string[]).includes(value);
}

// ============================================================
// HEALTH CHECKS
// ============================================================

/** Service health statuses */
export const HEALTH_STATUSES = ['healthy', 'degraded', 'unhealthy'] as const;
export type HealthStatus = typeof HEALTH_STATUSES[number];

export function isHealthStatus(value: unknown): value is HealthStatus {
  return typeof value === 'string' && (HEALTH_STATUSES as readonly string[]).includes(value);
}

/** Timeout for individual service health checks */
export const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/** Services checked by the /v1/health endpoint */
export const HEALTH_CHECK_SERVICES = ['database', 'llm', 'embedding', 'auth', 'jobs'] as const;
export type HealthCheckService = typeof HEALTH_CHECK_SERVICES[number];

// ============================================================
// MIDDLEWARE
// ============================================================

/** Middleware types applied to all requests */
export const MIDDLEWARE_TYPES = ['cors', 'auth', 'rate_limit', 'logging', 'error'] as const;
export type MiddlewareType = typeof MIDDLEWARE_TYPES[number];

/**
 * Middleware application order.
 * cors → logging → error → auth → rate_limit
 */
export const MIDDLEWARE_ORDER: readonly MiddlewareType[] = [
  'cors',
  'logging',
  'error',
  'auth',
  'rate_limit',
] as const;

/** Default CORS origins (override in production) */
export const DEFAULT_CORS_ORIGINS = ['*'] as const;

/** Default rate limit: 60 requests per minute */
export const DEFAULT_RATE_LIMIT_RPM = 60;

/** Rate limit sliding window duration */
export const RATE_LIMIT_WINDOW_MS = 60_000;

// ============================================================
// SERVER
// ============================================================

/** Default server port */
export const DEFAULT_PORT = 3000;

/** Default server host */
export const DEFAULT_HOST = '0.0.0.0';

// ============================================================
// OBSERVABILITY
// ============================================================

/** Logging levels (ordered by severity) */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = typeof LOG_LEVELS[number];

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

/** Default log level */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/** Sentry traces sample rate (10% of requests) */
export const SENTRY_TRACES_SAMPLE_RATE = 0.1;

// ============================================================
// DEPLOYMENT SCENARIOS
// ============================================================

/**
 * Named deployment scenarios for the decision matrix.
 * @see deployment.ts DEPLOYMENT_MATRIX
 */
export const DEPLOYMENT_SCENARIOS = [
  'nous_cloud',
  'self_host_small',
  'self_host_scale',
  'enterprise',
] as const;
export type DeploymentScenario = typeof DEPLOYMENT_SCENARIOS[number];

export function isDeploymentScenario(value: unknown): value is DeploymentScenario {
  return typeof value === 'string' && (DEPLOYMENT_SCENARIOS as readonly string[]).includes(value);
}

// ============================================================
// ROUTE GROUPS
// ============================================================

/**
 * API route group prefixes.
 * Each maps to a Hono sub-router registered via app.route().
 */
export const ROUTE_PREFIXES = {
  nodes: '/v1/nodes',
  edges: '/v1/edges',
  search: '/v1/search',
  chat: '/v1/chat',
  agent: '/v1/agent',
  sync: '/v1/sync',
  ingest: '/v1/ingest',
  settings: '/v1/settings',
  credits: '/v1/credits',
  clusters: '/v1/clusters',
  health: '/v1/health',
} as const;

/** Paths that do not require authentication */
export const AUTH_EXEMPT_PATHS = ['/v1/health'] as const;

// ============================================================
// ERROR CODES
// ============================================================

/**
 * Standard API error codes with HTTP status mapping.
 * Used by the error middleware to produce structured responses.
 */
export const ERROR_CODES = {
  UNAUTHORIZED: { status: 401, message: 'Authentication required' },
  TOKEN_EXPIRED: { status: 401, message: 'Token has expired' },
  FORBIDDEN: { status: 403, message: 'Insufficient permissions' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  CONFLICT: { status: 409, message: 'Version conflict' },
  RATE_LIMITED: { status: 429, message: 'Too many requests' },
  VALIDATION_ERROR: { status: 400, message: 'Invalid request data' },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
