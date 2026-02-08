/**
 * @module @nous/core/backend
 * @description Types and Zod schemas for Nous Backend Infrastructure
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Consolidated interfaces and Zod schemas from all backend spec files.
 * Organized by domain: pagination, search, sync, LLM, auth, transaction,
 * adapter interfaces, jobs, server, SSE, config, health, deployment,
 * observability, and local dev.
 */

import { z } from 'zod';
import type {
  JobTier, JobType, CronJobType, JobPriority,
  SSEEventType,
  HealthStatus, HealthCheckService,
  LogLevel,
  DeploymentEnvironment, DeploymentScenario,
  DeploymentTarget, DatabaseAdapterType, AuthAdapterType, JobQueueAdapterType,
} from './constants';

// ============================================================
// SUPPORTING TYPES: PAGINATION
// ============================================================

/** Options for paginated list queries */
export interface ListOptions {
  /** Maximum items to return */
  limit: number;
  /** Number of items to skip */
  offset: number;
  /** Field to sort by */
  sort_by?: string;
  /** Sort direction */
  sort_order?: 'asc' | 'desc';
  /** Filter criteria */
  filters?: Record<string, unknown>;
}

export const ListOptionsSchema = z.object({
  limit: z.number().int().min(1).max(1000),
  offset: z.number().int().min(0),
  sort_by: z.string().optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
  filters: z.record(z.unknown()).optional(),
});

/** Paginated query result */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  has_more: boolean;
}

// NOTE: PaginatedResult schema factory is in adapters.ts (generic requires factory pattern)

// ============================================================
// SUPPORTING TYPES: SEARCH
// ============================================================

/** Options for vector similarity search */
export interface VectorSearchOptions {
  /** Maximum results to return */
  limit: number;
  /** Minimum cosine similarity threshold (0-1) */
  min_similarity?: number;
  /** Additional filters */
  filters?: Record<string, unknown>;
}

export const VectorSearchOptionsSchema = z.object({
  limit: z.number().int().min(1).max(500),
  min_similarity: z.number().min(0).max(1).optional(),
  filters: z.record(z.unknown()).optional(),
});

/** Options for BM25 text search */
export interface TextSearchOptions {
  /** Maximum results to return */
  limit: number;
  /** Additional filters */
  filters?: Record<string, unknown>;
}

export const TextSearchOptionsSchema = z.object({
  limit: z.number().int().min(1).max(500),
  filters: z.record(z.unknown()).optional(),
});

/** Options for hybrid (vector + BM25) search */
export interface HybridSearchOptions {
  /** Maximum results to return */
  limit: number;
  /** Weight balance between vector and BM25 */
  weights?: { vector: number; bm25: number };
  /** Additional filters */
  filters?: Record<string, unknown>;
}

export const HybridSearchOptionsSchema = z.object({
  limit: z.number().int().min(1).max(500),
  weights: z.object({
    vector: z.number().min(0).max(1),
    bm25: z.number().min(0).max(1),
  }).optional(),
  filters: z.record(z.unknown()).optional(),
});

/** Search result (returned by all search methods) */
export interface SearchResult {
  /** Node ID */
  id: string;
  /** Relevance score (0-1, higher is better) */
  score: number;
  /** The matched node data */
  node: Record<string, unknown>;
}

export const SearchResultSchema = z.object({
  id: z.string(),
  score: z.number().min(0).max(1),
  node: z.record(z.unknown()),
});

// ============================================================
// SUPPORTING TYPES: SYNC (aligned with storm-017)
// ============================================================

/** A set of changes since a given version */
export interface ChangeSet {
  changes: Change[];
  currentVersion: number;
  hasMore: boolean;
}

export const ChangeSetSchema = z.object({
  changes: z.array(z.lazy(() => ChangeSchema)),
  currentVersion: z.number().int().min(0),
  hasMore: z.boolean(),
});

/** A single change record */
export interface Change {
  /** Entity ID (node or edge) */
  id: string;
  /** Which table was affected */
  table: 'nodes' | 'edges';
  /** Type of operation */
  operation: 'create' | 'update' | 'delete';
  /** The changed data */
  data: Record<string, unknown>;
  /** Server version at time of change */
  version: number;
  /** ISO 8601 timestamp */
  timestamp: string;
}

export const ChangeSchema = z.object({
  id: z.string(),
  table: z.enum(['nodes', 'edges']),
  operation: z.enum(['create', 'update', 'delete']),
  data: z.record(z.unknown()),
  version: z.number().int().min(0),
  timestamp: z.string(),
});

/** Result of applying client changes to server */
export interface ApplyResult {
  applied: AppliedChange[];
  conflicts: AdapterConflict[];
  serverVersion: number;
}

export const ApplyResultSchema = z.object({
  applied: z.array(z.lazy(() => AppliedChangeSchema)),
  conflicts: z.array(z.lazy(() => AdapterConflictSchema)),
  serverVersion: z.number().int().min(0),
});

/** A successfully applied change */
export interface AppliedChange {
  id: string;
  operation: 'create' | 'update' | 'delete';
  version: number;
}

export const AppliedChangeSchema = z.object({
  id: z.string(),
  operation: z.enum(['create', 'update', 'delete']),
  version: z.number().int().min(0),
});

/** A conflict detected during sync */
export interface AdapterConflict {
  /** Entity ID */
  id: string;
  /** Unique conflict identifier */
  conflictId: string;
  /** Type of conflict */
  type: 'VERSION_MISMATCH' | 'DELETED' | 'CONSTRAINT';
  /** Client's version of the entity */
  clientVersion: number;
  /** Server's current version */
  serverVersion: number;
  /** Server's current data */
  serverData: Record<string, unknown>;
  /** Available resolution strategies */
  resolutionOptions: ('keep_local' | 'keep_server' | 'merge')[];
}

export const AdapterConflictSchema = z.object({
  id: z.string(),
  conflictId: z.string(),
  type: z.enum(['VERSION_MISMATCH', 'DELETED', 'CONSTRAINT']),
  clientVersion: z.number().int().min(0),
  serverVersion: z.number().int().min(0),
  serverData: z.record(z.unknown()),
  resolutionOptions: z.array(z.enum(['keep_local', 'keep_server', 'merge'])),
});

// ============================================================
// SUPPORTING TYPES: LLM
// ============================================================

/** Chat message */
export interface AdapterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const AdapterMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

/** LLM completion request */
export interface CompletionRequest {
  /** Model identifier (e.g., 'claude-sonnet-4', 'gpt-4o') */
  model: string;
  /** Conversation messages */
  messages: AdapterMessage[];
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** System prompt (separate from messages for caching) */
  systemPrompt?: string;
  /** Whether to cache the system prompt (Anthropic only) */
  cacheSystemPrompt?: boolean;
  /** Request tracking ID */
  requestId?: string;
}

export const CompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(AdapterMessageSchema),
  maxTokens: z.number().int().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  systemPrompt: z.string().optional(),
  cacheSystemPrompt: z.boolean().optional(),
  requestId: z.string().optional(),
});

/** LLM completion response */
export interface CompletionResponse {
  /** Response ID */
  id: string;
  /** Generated content */
  content: string;
  /** Model that was used */
  model: string;
  /** Token usage */
  usage: AdapterTokenUsage;
  /** Reason for stopping */
  finishReason: 'stop' | 'length' | 'tool_use';
}

export const CompletionResponseSchema = z.object({
  id: z.string(),
  content: z.string(),
  model: z.string(),
  usage: z.lazy(() => AdapterTokenUsageSchema),
  finishReason: z.enum(['stop', 'length', 'tool_use']),
});

/** Streaming chunk from LLM */
export interface CompletionChunk {
  /** Chunk ID */
  id: string;
  /** Text delta */
  delta: string;
  /** Set when stream ends */
  finishReason?: 'stop' | 'length' | 'tool_use';
}

export const CompletionChunkSchema = z.object({
  id: z.string(),
  delta: z.string(),
  finishReason: z.enum(['stop', 'length', 'tool_use']).optional(),
});

/** Token usage from LLM response */
export interface AdapterTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}

export const AdapterTokenUsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cachedTokens: z.number().int().min(0).optional(),
});

/** Cost estimate for an LLM request */
export interface AdapterCostEstimate {
  /** Minimum expected cost in USD */
  min: number;
  /** Expected cost in USD */
  expected: number;
  /** Maximum expected cost in USD */
  max: number;
  /** Cost breakdown */
  breakdown: {
    embedding?: number;
    inputTokens: number;
    outputTokens: number;
    caching?: number;
  };
}

export const AdapterCostEstimateSchema = z.object({
  min: z.number().min(0),
  expected: z.number().min(0),
  max: z.number().min(0),
  breakdown: z.object({
    embedding: z.number().min(0).optional(),
    inputTokens: z.number().min(0),
    outputTokens: z.number().min(0),
    caching: z.number().min(0).optional(),
  }),
});

/** Usage callback type for cost tracking */
export type UsageCallback = (usage: UsageReport) => void;

/** Usage report emitted after each LLM call */
export interface UsageReport {
  /** Request tracking ID */
  requestId: string;
  /** Provider that served the request */
  provider: string;
  /** Model used */
  model: string;
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens generated */
  outputTokens: number;
  /** Tokens served from cache */
  cachedTokens: number;
  /** Actual cost in USD */
  actualCost: number;
  /** End-to-end latency */
  latencyMs: number;
}

export const UsageReportSchema = z.object({
  requestId: z.string(),
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cachedTokens: z.number().int().min(0),
  actualCost: z.number().min(0),
  latencyMs: z.number().min(0),
});

// ============================================================
// SUPPORTING TYPES: AUTH
// ============================================================

/** Result of token validation */
export interface AdapterAuthResult {
  /** Whether the token is valid */
  valid: boolean;
  /** User ID if valid */
  userId?: string;
  /** User's plan tier */
  tier?: 'free' | 'credits' | 'pro';
  /** User's privacy tier (storm-022) */
  privacyTier?: 'standard' | 'private';
  /** Token expiry (ISO 8601) */
  expiresAt?: string;
}

export const AdapterAuthResultSchema = z.object({
  valid: z.boolean(),
  userId: z.string().optional(),
  tier: z.enum(['free', 'credits', 'pro']).optional(),
  privacyTier: z.enum(['standard', 'private']).optional(),
  expiresAt: z.string().optional(),
});

/** Authenticated user */
export interface AdapterUser {
  id: string;
  email: string;
  tier: 'free' | 'credits' | 'pro';
  privacyTier: 'standard' | 'private';
}

export const AdapterUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  tier: z.enum(['free', 'credits', 'pro']),
  privacyTier: z.enum(['standard', 'private']),
});

/** Token pair from refresh */
export interface AdapterTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export const AdapterTokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string(),
});

/** API key validation result */
export interface AdapterApiKeyResult {
  valid: boolean;
  userId?: string;
  scopes?: string[];
}

export const AdapterApiKeyResultSchema = z.object({
  valid: z.boolean(),
  userId: z.string().optional(),
  scopes: z.array(z.string()).optional(),
});

// ============================================================
// SUPPORTING TYPES: TRANSACTION
// ============================================================

/** Database transaction handle */
export interface AdapterTransaction {
  /** Execute a read query within the transaction */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Execute a write statement within the transaction */
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ============================================================
// ADAPTER INTERFACE: DATABASE
// ============================================================

/**
 * Domain-level database adapter.
 *
 * This is a HIGHER-LEVEL interface than storm-017's DatabaseAdapter.
 * storm-017 defines low-level SQL operations (query, execute, batch).
 * This interface provides domain operations (getNode, vectorSearch, etc.)
 * that are implemented by wrapping the low-level adapter.
 *
 * Implementations: @nous/adapter-turso, @nous/adapter-sqlite
 */
export interface IDatabaseAdapter {
  /** Tenant this adapter is scoped to */
  readonly tenantId: string;

  // --- Node CRUD ---
  getNode(id: string): Promise<Record<string, unknown> | null>;
  createNode(node: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateNode(id: string, updates: Record<string, unknown>, expectedVersion?: number): Promise<Record<string, unknown>>;
  deleteNode(id: string): Promise<void>;
  listNodes(options: ListOptions): Promise<PaginatedResult<Record<string, unknown>>>;

  // --- Edge CRUD ---
  getEdges(nodeId: string, direction: 'in' | 'out' | 'both'): Promise<Record<string, unknown>[]>;
  createEdge(edge: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteEdge(id: string): Promise<void>;

  // --- Search ---
  vectorSearch(embedding: number[], options: VectorSearchOptions): Promise<SearchResult[]>;
  textSearch(query: string, options: TextSearchOptions): Promise<SearchResult[]>;
  hybridSearch(embedding: number[], query: string, options: HybridSearchOptions): Promise<SearchResult[]>;

  // --- Sync (storm-017 protocol) ---
  getChangesSince(version: number, limit?: number): Promise<ChangeSet>;
  applyChanges(changes: Change[], clientVersion: number): Promise<ApplyResult>;
  getCurrentVersion(): Promise<number>;

  // --- Transaction ---
  transaction<T>(fn: (tx: AdapterTransaction) => Promise<T>): Promise<T>;

  // --- Health ---
  ping(): Promise<boolean>;
}

// ============================================================
// ADAPTER INTERFACE: DATABASE FACTORY (Multi-tenant)
// ============================================================

/**
 * Multi-tenant database factory.
 * Manages database-per-tenant isolation (aligned with storm-017).
 *
 * In Turso: each tenant gets their own database in a group.
 * In SQLite: single database file (for self-host/dev).
 */
export interface IDatabaseFactory {
  /** Get an adapter scoped to a specific tenant */
  forTenant(tenantId: string): Promise<IDatabaseAdapter>;
  /** Create a new tenant database */
  createTenant(tenantId: string): Promise<void>;
  /** Delete a tenant database (irreversible) */
  deleteTenant(tenantId: string): Promise<void>;
  /** List all tenant IDs */
  listTenants(): Promise<string[]>;
  /** Check factory health */
  ping(): Promise<boolean>;
}

// ============================================================
// ADAPTER INTERFACE: LLM (with cost tracking)
// ============================================================

/**
 * LLM adapter with streaming and cost tracking.
 * Wraps storm-015 LLM types with a provider-agnostic interface.
 *
 * Implementations: @nous/adapter-openai, @nous/adapter-anthropic
 */
export interface ILLMAdapter {
  /** Provider name (e.g., 'openai', 'anthropic', 'google') */
  readonly provider: string;
  /** Whether this adapter supports SSE streaming */
  readonly supportsStreaming: boolean;
  /** Whether this adapter supports prompt caching */
  readonly supportsCaching: boolean;

  /** Generate a completion */
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  /** Stream a completion via async iterator */
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
  /** Estimate cost for a request */
  estimateCost(request: CompletionRequest): AdapterCostEstimate;
  /** Register a usage callback for credit deduction */
  onUsage(callback: UsageCallback): void;
  /** Check adapter health */
  ping(): Promise<boolean>;
}

// ============================================================
// ADAPTER INTERFACE: EMBEDDING
// ============================================================

/**
 * Text embedding adapter.
 * Generates vector embeddings for semantic search.
 *
 * Implementations: @nous/adapter-openai (text-embedding-3-small)
 */
export interface IEmbeddingAdapter {
  /** Provider name */
  readonly provider: string;
  /** Output embedding dimensions (e.g., 1536) */
  readonly dimensions: number;
  /** Whether batch embedding is supported */
  readonly supportsBatch: boolean;

  /** Embed a single text */
  embed(text: string): Promise<number[]>;
  /** Embed multiple texts in batch */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Estimate cost for embedding by token count */
  estimateCost(tokenCount: number): number;
  /** Check adapter health */
  ping(): Promise<boolean>;
}

// ============================================================
// ADAPTER INTERFACE: AUTH
// ============================================================

/**
 * Authentication adapter.
 * Validates tokens and manages user sessions.
 * Wraps storm-022 auth types.
 *
 * Implementations: @nous/adapter-clerk, @nous/adapter-local-auth
 */
export interface IAuthAdapter {
  /** Validate an access token (JWT) */
  validateToken(token: string): Promise<AdapterAuthResult>;
  /** Get full user object from token */
  getUserFromToken(token: string): Promise<AdapterUser | null>;
  /** Refresh an expired access token */
  refreshToken(refreshToken: string): Promise<AdapterTokenPair>;
  /** Validate an API key */
  validateApiKey(key: string): Promise<AdapterApiKeyResult>;
  /** Check adapter health */
  ping(): Promise<boolean>;
}

// ============================================================
// ADAPTER INTERFACE: STORAGE
// ============================================================

/**
 * File/blob storage adapter.
 * Used for document uploads, exports, etc.
 *
 * Implementations: @nous/adapter-s3, @nous/adapter-local (filesystem)
 */
export interface IStorageAdapter {
  /** Upload a file and return its URL/key */
  upload(key: string, data: Uint8Array, contentType: string): Promise<string>;
  /** Download a file by key */
  download(key: string): Promise<Uint8Array>;
  /** Delete a file */
  delete(key: string): Promise<void>;
  /** Generate a pre-signed URL for temporary access */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  /** Check adapter health */
  ping(): Promise<boolean>;
}

// ============================================================
// JOB DEFINITION
// ============================================================

/** A job to be enqueued for background processing */
export interface Job<T extends JobType | CronJobType = JobType> {
  /** Unique job ID */
  id: string;
  /** Job type (determines handler and tier) */
  type: T;
  /** Job-specific payload data */
  payload: Record<string, unknown>;
  /** Execution priority */
  priority?: JobPriority;
  /** Links this job to the originating HTTP request */
  correlationId?: string;
  /** Tenant this job belongs to */
  tenantId: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
}

export const JobSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.record(z.unknown()),
  priority: z.enum(['high', 'normal', 'low']).optional(),
  correlationId: z.string().optional(),
  tenantId: z.string(),
  createdAt: z.string(),
});

// ============================================================
// JOB EVENT (Observability)
// ============================================================

/** Event emitted during job lifecycle */
export interface JobEvent {
  /** Job ID */
  jobId: string;
  /** Job type */
  type: string;
  /** Tenant ID */
  tenantId: string;
  /** Correlation ID linking to original request */
  correlationId?: string;
  /** When the job started processing (ISO 8601) */
  startedAt?: string;
  /** When the job completed (ISO 8601) */
  completedAt?: string;
  /** Processing duration in milliseconds */
  durationMs?: number;
}

export const JobEventSchema = z.object({
  jobId: z.string(),
  type: z.string(),
  tenantId: z.string(),
  correlationId: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().min(0).optional(),
});

// ============================================================
// FAILED JOB (Dead Letter Queue)
// ============================================================

/** A job that failed all retry attempts */
export interface FailedJob {
  /** The original job */
  job: Job<JobType>;
  /** Error message */
  error: string;
  /** When the job failed (ISO 8601) */
  failedAt: string;
  /** Number of attempts made */
  attempts: number;
}

export const FailedJobSchema = z.object({
  job: JobSchema,
  error: z.string(),
  failedAt: z.string(),
  attempts: z.number().int().min(1),
});

// ============================================================
// JOB HANDLER
// ============================================================

/** Function that processes a job */
export type JobHandler<T extends JobType | CronJobType = JobType> = (job: Job<T>) => Promise<void>;

// ============================================================
// JOB TIER CONFIGURATION
// ============================================================

/** Configuration for a specific job type's execution */
export interface JobTierConfig {
  /** Job type */
  type: JobType | CronJobType;
  /** Which tier this job runs at */
  tier: JobTier;
  /** Maximum execution time before kill */
  max_duration_ms: number;
  /** Number of retry attempts on failure */
  retry_count: number;
  /** Delay between retries in milliseconds */
  retry_delay_ms: number;
}

export const JobTierConfigSchema = z.object({
  type: z.string(),
  tier: z.enum(['inline', 'queued', 'regional']),
  max_duration_ms: z.number().int().min(0),
  retry_count: z.number().int().min(0),
  retry_delay_ms: z.number().int().min(0),
});

// ============================================================
// JOB METRICS
// ============================================================

/** Queue metrics snapshot */
export interface JobMetrics {
  /** Number of jobs waiting in queue */
  queue_depth: number;
  /** Number of jobs currently processing */
  processing_count: number;
  /** Total jobs completed since startup */
  completed_count: number;
  /** Total jobs failed since startup */
  failed_count: number;
  /** Average processing time in milliseconds */
  avg_processing_time_ms: number;
}

export const JobMetricsSchema = z.object({
  queue_depth: z.number().int().min(0),
  processing_count: z.number().int().min(0),
  completed_count: z.number().int().min(0),
  failed_count: z.number().int().min(0),
  avg_processing_time_ms: z.number().min(0),
});

// ============================================================
// ADAPTER INTERFACE: JOB QUEUE
// ============================================================

/**
 * Job queue adapter interface.
 * Provides background job processing with observability and DLQ.
 *
 * Implementations:
 * - @nous/adapter-cloudflare-queue (Cloudflare Queues for cloud)
 * - @nous/adapter-bullmq (BullMQ + Redis for self-host)
 * - @nous/adapter-mock (in-memory for development/testing)
 */
export interface IJobQueueAdapter {
  /** Enqueue a single job */
  enqueue<T extends JobType>(job: Job<T>): Promise<string>;
  /** Enqueue multiple jobs atomically */
  enqueueBatch<T extends JobType>(jobs: Job<T>[]): Promise<string[]>;
  /** Schedule a recurring cron job */
  schedule(cronExpression: string, job: Job<CronJobType>): Promise<string>;

  // --- Observability callbacks ---
  /** Called when a job starts processing */
  onJobStart(callback: (event: JobEvent) => void): void;
  /** Called when a job completes successfully */
  onJobComplete(callback: (event: JobEvent) => void): void;
  /** Called when a job fails */
  onJobError(callback: (event: JobEvent, error: Error) => void): void;

  // --- Dead Letter Queue ---
  /** Get all failed jobs awaiting manual intervention */
  getDeadLetterQueue(): Promise<FailedJob[]>;
  /** Retry a failed job from the DLQ */
  retryDeadLetter(jobId: string): Promise<void>;

  // --- Metrics ---
  /** Get current queue depth */
  getQueueDepth(): Promise<number>;
  /** Get count of jobs currently processing */
  getProcessingCount(): Promise<number>;
}

// ============================================================
// SERVER CONFIGURATION
// ============================================================

/**
 * Central server configuration.
 * Holds references to all adapters and deployment settings.
 * Passed to createServer() to wire everything into a Hono app.
 *
 * NOTE: No Zod schema — contains adapter interface references.
 */
export interface ServerConfig {
  /** Multi-tenant database factory */
  dbFactory: IDatabaseFactory;
  /** LLM completion adapter */
  llm: ILLMAdapter;
  /** Text embedding adapter */
  embedding: IEmbeddingAdapter;
  /** Authentication adapter */
  auth: IAuthAdapter;
  /** File storage adapter (optional) */
  storage?: IStorageAdapter;
  /** Background job queue adapter */
  jobs: IJobQueueAdapter;
  /** Deployment environment */
  mode: DeploymentEnvironment;
  /** Sentry DSN for error tracking (optional) */
  sentryDsn?: string;
  /** CORS allowed origins (defaults to ['*']) */
  corsOrigins?: string[];
}

// ============================================================
// ROUTE GROUP DEFINITIONS
// ============================================================

/** Route group definition for documentation and registration */
export interface RouteGroup {
  /** URL prefix (e.g., '/v1/nodes') */
  prefix: string;
  /** Human-readable description */
  description: string;
  /** Whether authentication is required */
  auth_required: boolean;
  /** Whether rate limiting is applied */
  rate_limited: boolean;
}

export const RouteGroupSchema = z.object({
  prefix: z.string(),
  description: z.string(),
  auth_required: z.boolean(),
  rate_limited: z.boolean(),
});

// ============================================================
// MIDDLEWARE CONFIGURATION
// ============================================================

/** CORS middleware configuration */
export interface CORSConfig {
  origins: string[];
  methods: string[];
  headers: string[];
  credentials: boolean;
}

export const CORSConfigSchema = z.object({
  origins: z.array(z.string()),
  methods: z.array(z.string()),
  headers: z.array(z.string()),
  credentials: z.boolean(),
});

/** Auth middleware configuration */
export interface AuthMiddlewareConfig {
  /** Paths that bypass authentication */
  exclude_paths: string[];
  /** Header containing the token */
  token_header: string;
  /** Token prefix to strip (e.g., 'Bearer ') */
  token_prefix: string;
}

export const AuthMiddlewareConfigSchema = z.object({
  exclude_paths: z.array(z.string()),
  token_header: z.string(),
  token_prefix: z.string(),
});

/** Rate limit middleware configuration */
export interface ServerRateLimitConfig {
  /** Maximum requests per window */
  requests_per_minute: number;
  /** Sliding window duration in milliseconds */
  window_ms: number;
  /** Key prefix for rate limit storage */
  key_prefix: string;
}

export const ServerRateLimitConfigSchema = z.object({
  requests_per_minute: z.number().int().min(1),
  window_ms: z.number().int().min(1000),
  key_prefix: z.string(),
});

/** Logging middleware configuration */
export interface LoggingMiddlewareConfig {
  level: LogLevel;
  format: 'json' | 'text';
  include_request_id: boolean;
}

export const LoggingMiddlewareConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']),
  format: z.enum(['json', 'text']),
  include_request_id: z.boolean(),
});

/** Error handling middleware configuration */
export interface ErrorMiddlewareConfig {
  /** Whether to expose error details (false in production) */
  expose_errors: boolean;
  /** Sentry DSN for error reporting */
  sentry_dsn?: string;
}

export const ErrorMiddlewareConfigSchema = z.object({
  expose_errors: z.boolean(),
  sentry_dsn: z.string().optional(),
});

/** Complete middleware configuration */
export interface MiddlewareConfig {
  cors: CORSConfig;
  auth: AuthMiddlewareConfig;
  rateLimit: ServerRateLimitConfig;
  logging: LoggingMiddlewareConfig;
  error: ErrorMiddlewareConfig;
}

export const MiddlewareConfigSchema = z.object({
  cors: CORSConfigSchema,
  auth: AuthMiddlewareConfigSchema,
  rateLimit: ServerRateLimitConfigSchema,
  logging: LoggingMiddlewareConfigSchema,
  error: ErrorMiddlewareConfigSchema,
});

// ============================================================
// API ERROR RESPONSE
// ============================================================

/** Structured API error response */
export interface ApiErrorResponse {
  /** Error code (e.g., 'UNAUTHORIZED', 'NOT_FOUND') */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional details (only in development mode) */
  details?: Record<string, unknown>;
  /** Request tracking ID */
  request_id?: string;
}

export const ApiErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  request_id: z.string().optional(),
});

// ============================================================
// SERVER FACTORY RETURN TYPE
// ============================================================

/** Hono app abstraction (the server's public interface) */
export interface HonoApp {
  /** Handle an incoming HTTP request */
  fetch: (request: Request) => Promise<Response>;
}

// ============================================================
// SSE OPTIONS
// ============================================================

/** Options for creating an SSE stream */
export interface SSEOptions {
  /** Maximum stream duration before sending timeout event (default: 25000ms) */
  maxDurationMs?: number;
  /** Heartbeat interval (default: 15000ms) */
  heartbeatMs?: number;
  /** Whether to support reconnection via Last-Event-ID (default: true) */
  reconnectable?: boolean;
}

export const SSEOptionsSchema = z.object({
  maxDurationMs: z.number().int().min(1000).optional(),
  heartbeatMs: z.number().int().min(1000).optional(),
  reconnectable: z.boolean().optional(),
});

// ============================================================
// SSE EVENT
// ============================================================

/** A single SSE event sent to the client */
export interface SSEEvent {
  /** Event type */
  event: SSEEventType;
  /** Event ID for reconnection tracking */
  id?: string;
  /** Event data (JSON stringified) */
  data: string;
}

export const SSEEventSchema = z.object({
  event: z.enum(['data', 'ping', 'timeout', 'done', 'error']),
  id: z.string().optional(),
  data: z.string(),
});

// ============================================================
// SSE STREAM STATE
// ============================================================

/** Internal state of an active SSE stream */
export interface SSEStreamState {
  /** Monotonically increasing event counter */
  eventId: number;
  /** Stream start time (Date.now()) */
  startTime: number;
  /** Last-Event-ID from reconnection header */
  lastEventId?: string;
  /** Whether the stream has been closed */
  closed: boolean;
}

export const SSEStreamStateSchema = z.object({
  eventId: z.number().int().min(0),
  startTime: z.number(),
  lastEventId: z.string().optional(),
  closed: z.boolean(),
});

// ============================================================
// CHAT STREAM CHUNKS
// ============================================================

/**
 * Chat-specific SSE chunk types for /v1/chat endpoint.
 * The chat endpoint streams these as SSE data events.
 */
export interface ChatStreamChunk {
  /** Chunk type */
  type: 'token' | 'source' | 'done' | 'error';
  /** Generated text (for 'token' type) */
  content?: string;
  /** Referenced node IDs (for 'source' type) */
  sources?: string[];
  /** Error message (for 'error' type) */
  error?: string;
}

export const ChatStreamChunkSchema = z.object({
  type: z.enum(['token', 'source', 'done', 'error']),
  content: z.string().optional(),
  sources: z.array(z.string()).optional(),
  error: z.string().optional(),
});

// ============================================================
// CONFIG SCHEMA: DATABASE (Discriminated Union)
// ============================================================

/** Turso cloud database configuration */
export const TursoDatabaseConfigSchema = z.object({
  type: z.literal('turso'),
  /** Turso database URL (libsql://...) */
  url: z.string().url(),
  /** Turso auth token */
  authToken: z.string().min(1),
});
export type TursoDatabaseConfig = z.infer<typeof TursoDatabaseConfigSchema>;

/** Local SQLite database configuration */
export const SqliteDatabaseConfigSchema = z.object({
  type: z.literal('sqlite'),
  /** Path to SQLite database file */
  path: z.string().min(1),
});
export type SqliteDatabaseConfig = z.infer<typeof SqliteDatabaseConfigSchema>;

/** Database configuration (one of the above) */
export const DatabaseConfigSchema = z.discriminatedUnion('type', [
  TursoDatabaseConfigSchema,
  SqliteDatabaseConfigSchema,
]);
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

// ============================================================
// CONFIG SCHEMA: AUTH (Discriminated Union)
// ============================================================

/** Clerk cloud auth configuration */
export const ClerkAuthConfigSchema = z.object({
  type: z.literal('clerk'),
  /** Clerk secret key (server-side) */
  secretKey: z.string().min(1),
  /** Clerk publishable key */
  publishableKey: z.string().min(1),
});
export type ClerkAuthConfig = z.infer<typeof ClerkAuthConfigSchema>;

/** Local JWT auth configuration (for dev/self-host) */
export const LocalAuthConfigSchema = z.object({
  type: z.literal('local'),
  /** JWT signing secret (optional, auto-generated if not set) */
  jwtSecret: z.string().optional(),
});
export type LocalAuthConfig = z.infer<typeof LocalAuthConfigSchema>;

/** Auth configuration (one of the above) */
export const AuthConfigSchema = z.discriminatedUnion('type', [
  ClerkAuthConfigSchema,
  LocalAuthConfigSchema,
]);
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

// ============================================================
// CONFIG SCHEMA: LLM
// ============================================================

/** LLM provider configuration (at least one key required) */
export const LLMConfigSchema = z.object({
  openai: z.object({ apiKey: z.string().min(1) }).optional(),
  anthropic: z.object({ apiKey: z.string().min(1) }).optional(),
  google: z.object({ apiKey: z.string().min(1) }).optional(),
});
export type LLMConfig = z.infer<typeof LLMConfigSchema>;

// ============================================================
// CONFIG SCHEMA: JOBS (Discriminated Union)
// ============================================================

/** Cloudflare Queues configuration (bound via wrangler.toml) */
export const CloudflareJobsConfigSchema = z.object({
  type: z.literal('cloudflare'),
});
export type CloudflareJobsConfig = z.infer<typeof CloudflareJobsConfigSchema>;

/** BullMQ + Redis configuration (for self-host/scale) */
export const BullMQJobsConfigSchema = z.object({
  type: z.literal('bullmq'),
  /** Redis connection URL */
  redisUrl: z.string().url(),
});
export type BullMQJobsConfig = z.infer<typeof BullMQJobsConfigSchema>;

/** In-memory job queue (for development) */
export const MemoryJobsConfigSchema = z.object({
  type: z.literal('memory'),
});
export type MemoryJobsConfig = z.infer<typeof MemoryJobsConfigSchema>;

/** Jobs configuration (one of the above) */
export const JobsConfigSchema = z.discriminatedUnion('type', [
  CloudflareJobsConfigSchema,
  BullMQJobsConfigSchema,
  MemoryJobsConfigSchema,
]);
export type JobsConfig = z.infer<typeof JobsConfigSchema>;

// ============================================================
// CONFIG SCHEMA: OBSERVABILITY
// ============================================================

/** Observability and monitoring configuration */
export const ObservabilityConfigSchema = z.object({
  /** Sentry DSN for error tracking */
  sentryDsn: z.string().url().optional(),
  /** Log level */
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});
export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>;

// ============================================================
// CONFIG SCHEMA: MASTER CONFIG
// ============================================================

/**
 * Complete Nous backend configuration.
 * Validated at startup — fails fast on invalid config.
 */
export const NousConfigSchema = z.object({
  /** Deployment environment */
  env: z.enum(['development', 'staging', 'production']).default('development'),
  /** Server port */
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Server host */
  host: z.string().default('0.0.0.0'),
  /** Database configuration */
  database: DatabaseConfigSchema,
  /** Authentication configuration */
  auth: AuthConfigSchema,
  /** LLM provider configuration */
  llm: LLMConfigSchema,
  /** Job queue configuration */
  jobs: JobsConfigSchema,
  /** Observability configuration */
  observability: ObservabilityConfigSchema,
});
export type NousConfig = z.infer<typeof NousConfigSchema>;

// ============================================================
// HEALTH CHECK RESPONSE
// ============================================================

/** Response from the /v1/health endpoint */
export interface HealthCheckResponse {
  /** Overall system status */
  status: HealthStatus;
  /** Application version */
  version: string;
  /** Current server time (ISO 8601) */
  timestamp: string;
  /** Per-service health status */
  services: Record<HealthCheckService, ServiceHealth>;
  /** Optional system metrics */
  metrics?: HealthMetrics;
}

export const HealthCheckResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string(),
  timestamp: z.string(),
  services: z.record(z.lazy(() => ServiceHealthSchema)),
  metrics: z.lazy(() => HealthMetricsSchema).optional(),
});

// ============================================================
// SERVICE HEALTH
// ============================================================

/** Health status of an individual service/adapter */
export interface ServiceHealth {
  /** Service status */
  status: HealthStatus;
  /** Response latency in milliseconds */
  latency_ms?: number;
  /** Error message if unhealthy */
  error?: string;
}

export const ServiceHealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  latency_ms: z.number().min(0).optional(),
  error: z.string().optional(),
});

// ============================================================
// HEALTH METRICS
// ============================================================

/** Optional system metrics included in health response */
export interface HealthMetrics {
  /** Number of jobs in queue */
  jobQueueDepth?: number;
  /** Number of active connections */
  activeConnections?: number;
  /** Server uptime in seconds */
  uptime_seconds?: number;
}

export const HealthMetricsSchema = z.object({
  jobQueueDepth: z.number().int().min(0).optional(),
  activeConnections: z.number().int().min(0).optional(),
  uptime_seconds: z.number().min(0).optional(),
});

// ============================================================
// READINESS CHECK
// ============================================================

/** Readiness probe for Kubernetes/Fly.io */
export interface ReadinessCheck {
  /** Whether the server is ready to accept requests */
  ready: boolean;
  /** Individual check results */
  checks: Record<string, boolean>;
}

export const ReadinessCheckSchema = z.object({
  ready: z.boolean(),
  checks: z.record(z.boolean()),
});

// ============================================================
// DEPLOYMENT MATRIX
// ============================================================

/** A single entry in the deployment decision matrix */
export interface DeploymentMatrixEntry {
  /** Named deployment scenario */
  scenario: DeploymentScenario;
  /** Where the API runs */
  api: DeploymentTarget;
  /** Job queue adapter type */
  jobs: JobQueueAdapterType;
  /** Database adapter type */
  database: DatabaseAdapterType;
  /** Auth adapter type */
  auth: AuthAdapterType;
  /** Human-readable description */
  description: string;
}

export const DeploymentMatrixEntrySchema = z.object({
  scenario: z.string(),
  api: z.string(),
  jobs: z.string(),
  database: z.string(),
  auth: z.string(),
  description: z.string(),
});

// ============================================================
// SELF-HOSTING CONFIGURATION
// ============================================================

/** Self-hosting system requirements */
export interface SelfHostConfig {
  /** Docker Compose service names */
  docker_compose_services: string[];
  /** Environment variables that MUST be set */
  required_env_vars: string[];
  /** Environment variables that are optional */
  optional_env_vars: string[];
  /** Minimum RAM in megabytes */
  min_ram_mb: number;
  /** Recommended RAM in megabytes */
  recommended_ram_mb: number;
  /** Docker volumes for persistent data */
  volumes: string[];
}

export const SelfHostConfigSchema = z.object({
  docker_compose_services: z.array(z.string()),
  required_env_vars: z.array(z.string()),
  optional_env_vars: z.array(z.string()),
  min_ram_mb: z.number().int().min(0),
  recommended_ram_mb: z.number().int().min(0),
  volumes: z.array(z.string()),
});

// ============================================================
// DOCKER SERVICE CONFIGURATION
// ============================================================

/** Docker Compose service definition */
export interface DockerServiceConfig {
  /** Service name */
  name: string;
  /** Docker image or build context */
  image: string;
  /** Exposed port mappings */
  ports?: string[];
  /** Environment variables */
  environment: string[];
  /** Volume mounts */
  volumes?: string[];
  /** Service dependencies */
  depends_on?: string[];
}

export const DockerServiceConfigSchema = z.object({
  name: z.string(),
  image: z.string(),
  ports: z.array(z.string()).optional(),
  environment: z.array(z.string()),
  volumes: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
});

// ============================================================
// STRUCTURED LOG ENTRY
// ============================================================

/** A single structured log entry (JSON format) */
export interface StructuredLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Unique request identifier */
  requestId: string;
  /** Log severity level */
  level: LogLevel;
  /** HTTP method (for request logs) */
  method?: string;
  /** Request path (for request logs) */
  path?: string;
  /** HTTP status code (for response logs) */
  status?: number;
  /** Request duration in milliseconds */
  duration_ms?: number;
  /** Authenticated user ID */
  userId?: string;
  /** Tenant ID */
  tenantId?: string;
  /** Log message */
  message?: string;
  /** Error string (for error logs) */
  error?: string;
}

export const StructuredLogEntrySchema = z.object({
  timestamp: z.string(),
  requestId: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']),
  method: z.string().optional(),
  path: z.string().optional(),
  status: z.number().int().optional(),
  duration_ms: z.number().min(0).optional(),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

// ============================================================
// METRICS CONFIGURATION
// ============================================================

/** Which metrics to collect */
export interface MetricsConfig {
  /** Track total request count */
  request_count: boolean;
  /** Track request duration histogram */
  request_duration: boolean;
  /** Track LLM cost per request */
  llm_cost: boolean;
  /** Track embedding generation count */
  embedding_count: boolean;
  /** Track job queue size */
  job_queue_size: boolean;
}

export const MetricsConfigSchema = z.object({
  request_count: z.boolean(),
  request_duration: z.boolean(),
  llm_cost: z.boolean(),
  embedding_count: z.boolean(),
  job_queue_size: z.boolean(),
});

// ============================================================
// SENTRY CONFIGURATION
// ============================================================

/** Sentry error tracking configuration */
export interface SentryConfig {
  /** Sentry DSN */
  dsn: string;
  /** Percentage of requests to trace (0-1) */
  traces_sample_rate: number;
  /** Deployment environment tag */
  environment: DeploymentEnvironment;
  /** Release version tag */
  release?: string;
}

export const SentryConfigSchema = z.object({
  dsn: z.string().url(),
  traces_sample_rate: z.number().min(0).max(1),
  environment: z.enum(['development', 'staging', 'production']),
  release: z.string().optional(),
});

// ============================================================
// REQUEST CONTEXT
// ============================================================

/** Per-request context passed through middleware chain */
export interface RequestContext {
  /** Unique request identifier (UUID v4) */
  requestId: string;
  /** Authenticated user ID (set by auth middleware) */
  userId?: string;
  /** Tenant ID (set by auth middleware) */
  tenantId?: string;
  /** Request start time (Date.now()) */
  startTime: number;
}

export const RequestContextSchema = z.object({
  requestId: z.string(),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  startTime: z.number(),
});

// ============================================================
// LOCAL DEV CONFIGURATION
// ============================================================

/** Configuration for local development server */
export interface LocalDevConfig {
  /** Server port */
  port: number;
  /** Path to SQLite database file */
  database_path: string;
  /** Whether to auto-seed with sample data */
  auto_seed: boolean;
  /** Simulated LLM latency in milliseconds */
  mock_llm_latency_ms: number;
  /** Whether mock embeddings are deterministic (same input → same output) */
  mock_embedding_deterministic: boolean;
  /** Whether to accept any Bearer token as valid */
  accept_any_token: boolean;
  /** Whether to process jobs immediately instead of queuing */
  process_jobs_immediately: boolean;
}

export const LocalDevConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  database_path: z.string(),
  auto_seed: z.boolean(),
  mock_llm_latency_ms: z.number().int().min(0),
  mock_embedding_deterministic: z.boolean(),
  accept_any_token: z.boolean(),
  process_jobs_immediately: z.boolean(),
});

// ============================================================
// SEED DATA
// ============================================================

/** Seed user for development */
export interface SeedUser {
  id: string;
  email: string;
  tier: 'free' | 'credits' | 'pro';
}

export const SeedUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  tier: z.enum(['free', 'credits', 'pro']),
});

/** Seed data configuration */
export interface SeedDataConfig {
  /** Pre-created users */
  users: SeedUser[];
  /** Number of sample nodes to create */
  node_count: number;
  /** Number of sample edges to create */
  edge_count: number;
}

export const SeedDataConfigSchema = z.object({
  users: z.array(SeedUserSchema),
  node_count: z.number().int().min(0),
  edge_count: z.number().int().min(0),
});

// ============================================================
// MOCK ADAPTER CONFIGURATIONS
// ============================================================

/** Configuration for mock LLM adapter */
export interface MockLLMConfig {
  /** Simulated response latency */
  latencyMs: number;
  /** Whether to generate mock response content */
  mockResponses: boolean;
  /** Whether same input produces same output */
  deterministicOutputs: boolean;
}

export const MockLLMConfigSchema = z.object({
  latencyMs: z.number().int().min(0),
  mockResponses: z.boolean(),
  deterministicOutputs: z.boolean(),
});

/** Configuration for mock embedding adapter */
export interface MockEmbeddingConfig {
  /** Embedding vector dimensions */
  dimensions: number;
  /** Whether same input produces same embedding */
  deterministic: boolean;
}

export const MockEmbeddingConfigSchema = z.object({
  dimensions: z.number().int().min(1),
  deterministic: z.boolean(),
});

/** Configuration for mock job queue */
export interface MockJobQueueConfig {
  /** Whether to process jobs immediately (inline) */
  processImmediately: boolean;
}

export const MockJobQueueConfigSchema = z.object({
  processImmediately: z.boolean(),
});

/** Configuration for local auth adapter */
export interface LocalAuthDevConfig {
  /** Pre-created users */
  users: SeedUser[];
  /** Whether to accept any token */
  acceptAnyToken: boolean;
}

export const LocalAuthDevConfigSchema = z.object({
  users: z.array(SeedUserSchema),
  acceptAnyToken: z.boolean(),
});
