import { z } from 'zod';

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
/** Current API version prefix */
declare const API_VERSION: "v1";
/** Base path for all API routes */
declare const API_BASE_PATH: "/v1";
/**
 * Supported deployment targets for the Nous backend.
 * - cloudflare_workers: Edge deployment (low latency, global)
 * - fly_io: Regional container deployment (heavy processing)
 * - docker: Self-hosted via Docker Compose
 * - local: Local development with mock adapters
 */
declare const DEPLOYMENT_TARGETS: readonly ["cloudflare_workers", "fly_io", "docker", "local"];
type DeploymentTarget = typeof DEPLOYMENT_TARGETS[number];
declare function isDeploymentTarget(value: unknown): value is DeploymentTarget;
/** Application environments */
declare const DEPLOYMENT_ENVIRONMENTS: readonly ["development", "staging", "production"];
type DeploymentEnvironment = typeof DEPLOYMENT_ENVIRONMENTS[number];
declare function isDeploymentEnvironment(value: unknown): value is DeploymentEnvironment;
/** Database adapter implementations */
declare const DATABASE_ADAPTER_TYPES: readonly ["turso", "sqlite"];
type DatabaseAdapterType = typeof DATABASE_ADAPTER_TYPES[number];
/** Auth adapter implementations */
declare const AUTH_ADAPTER_TYPES: readonly ["clerk", "local"];
type AuthAdapterType = typeof AUTH_ADAPTER_TYPES[number];
/** LLM adapter implementations */
declare const LLM_ADAPTER_TYPES: readonly ["openai", "anthropic", "google", "mock"];
type LLMAdapterType = typeof LLM_ADAPTER_TYPES[number];
/** Embedding adapter implementations */
declare const EMBEDDING_ADAPTER_TYPES: readonly ["openai", "mock"];
type EmbeddingAdapterType = typeof EMBEDDING_ADAPTER_TYPES[number];
/** Storage adapter implementations */
declare const STORAGE_ADAPTER_TYPES: readonly ["s3", "local", "mock"];
type StorageAdapterType = typeof STORAGE_ADAPTER_TYPES[number];
/** Job queue adapter implementations */
declare const JOB_QUEUE_ADAPTER_TYPES: readonly ["cloudflare", "bullmq", "memory"];
type JobQueueAdapterType = typeof JOB_QUEUE_ADAPTER_TYPES[number];
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
declare const JOB_TIERS: readonly ["inline", "queued", "regional"];
type JobTier = typeof JOB_TIERS[number];
declare function isJobTier(value: unknown): value is JobTier;
/**
 * Async job types (enqueued via IJobQueueAdapter).
 * - embed: Generate embedding for a single node (Tier 2)
 * - deduplicate: Check for duplicate content (Tier 2)
 * - infer-edges: Infer relationships between nodes (Tier 2)
 * - process-document: Parse and extract from documents (Tier 3)
 * - batch-embed: Batch embedding generation (Tier 3)
 * - sync-push-notification: Notify other devices of changes (Tier 2)
 */
declare const JOB_TYPES: readonly ["embed", "deduplicate", "infer-edges", "process-document", "batch-embed", "sync-push-notification"];
type JobType = typeof JOB_TYPES[number];
declare function isJobType(value: unknown): value is JobType;
/**
 * Cron-scheduled job types.
 * - decay-cycle: Run FSRS decay calculations (storm-007)
 * - reorganize: Cluster reorganization (storm-006)
 * - cleanup-expired: Remove expired trash items (storm-007)
 */
declare const CRON_JOB_TYPES: readonly ["decay-cycle", "reorganize", "cleanup-expired"];
type CronJobType = typeof CRON_JOB_TYPES[number];
declare function isCronJobType(value: unknown): value is CronJobType;
/** Job priority levels */
declare const JOB_PRIORITIES: readonly ["high", "normal", "low"];
type JobPriority = typeof JOB_PRIORITIES[number];
/**
 * Maximum duration per job tier.
 * Jobs exceeding their tier limit are killed and moved to DLQ.
 */
declare const JOB_TIER_LIMITS: {
    readonly inline: {
        readonly max_duration_ms: 50;
    };
    readonly queued: {
        readonly max_duration_ms: 30000;
    };
    readonly regional: {
        readonly max_duration_ms: 600000;
    };
};
/** Job types that run at the queued tier (Cloudflare Queues / BullMQ) */
declare const QUEUED_JOB_TYPES: readonly JobType[];
/** Job types that run at the regional tier (Fly.io / long-running containers) */
declare const REGIONAL_JOB_TYPES: readonly JobType[];
/** Default retry configuration for failed jobs */
declare const DEFAULT_JOB_RETRY_COUNT = 3;
declare const DEFAULT_JOB_RETRY_DELAY_MS = 1000;
/**
 * SSE (Server-Sent Events) configuration.
 * Cloudflare Workers have a 30s connection limit,
 * so we cap at 25s and send timeout events for reconnection.
 */
declare const SSE_MAX_DURATION_MS = 25000;
declare const SSE_HEARTBEAT_INTERVAL_MS = 15000;
declare const SSE_RECONNECT_DEFAULT = true;
/** SSE event types sent to clients */
declare const SSE_EVENT_TYPES: readonly ["data", "ping", "timeout", "done", "error"];
type SSEEventType = typeof SSE_EVENT_TYPES[number];
declare function isSSEEventType(value: unknown): value is SSEEventType;
/** Service health statuses */
declare const HEALTH_STATUSES: readonly ["healthy", "degraded", "unhealthy"];
type HealthStatus = typeof HEALTH_STATUSES[number];
declare function isHealthStatus(value: unknown): value is HealthStatus;
/** Timeout for individual service health checks */
declare const HEALTH_CHECK_TIMEOUT_MS = 5000;
/** Services checked by the /v1/health endpoint */
declare const HEALTH_CHECK_SERVICES: readonly ["database", "llm", "embedding", "auth", "jobs"];
type HealthCheckService = typeof HEALTH_CHECK_SERVICES[number];
/** Middleware types applied to all requests */
declare const MIDDLEWARE_TYPES: readonly ["cors", "auth", "rate_limit", "logging", "error"];
type MiddlewareType = typeof MIDDLEWARE_TYPES[number];
/**
 * Middleware application order.
 * cors → logging → error → auth → rate_limit
 */
declare const MIDDLEWARE_ORDER: readonly MiddlewareType[];
/** Default CORS origins (override in production) */
declare const DEFAULT_CORS_ORIGINS: readonly ["*"];
/** Default rate limit: 60 requests per minute */
declare const DEFAULT_RATE_LIMIT_RPM = 60;
/** Rate limit sliding window duration */
declare const RATE_LIMIT_WINDOW_MS = 60000;
/** Default server port */
declare const DEFAULT_PORT = 3000;
/** Default server host */
declare const DEFAULT_HOST = "0.0.0.0";
/** Logging levels (ordered by severity) */
declare const LOG_LEVELS: readonly ["debug", "info", "warn", "error", "fatal"];
type LogLevel = typeof LOG_LEVELS[number];
declare function isLogLevel(value: unknown): value is LogLevel;
/** Default log level */
declare const DEFAULT_LOG_LEVEL: LogLevel;
/** Sentry traces sample rate (10% of requests) */
declare const SENTRY_TRACES_SAMPLE_RATE = 0.1;
/**
 * Named deployment scenarios for the decision matrix.
 * @see deployment.ts DEPLOYMENT_MATRIX
 */
declare const DEPLOYMENT_SCENARIOS: readonly ["nous_cloud", "self_host_small", "self_host_scale", "enterprise"];
type DeploymentScenario = typeof DEPLOYMENT_SCENARIOS[number];
declare function isDeploymentScenario(value: unknown): value is DeploymentScenario;
/**
 * API route group prefixes.
 * Each maps to a Hono sub-router registered via app.route().
 */
declare const ROUTE_PREFIXES: {
    readonly nodes: "/v1/nodes";
    readonly edges: "/v1/edges";
    readonly search: "/v1/search";
    readonly chat: "/v1/chat";
    readonly agent: "/v1/agent";
    readonly sync: "/v1/sync";
    readonly ingest: "/v1/ingest";
    readonly settings: "/v1/settings";
    readonly credits: "/v1/credits";
    readonly clusters: "/v1/clusters";
    readonly health: "/v1/health";
};
/** Paths that do not require authentication */
declare const AUTH_EXEMPT_PATHS: readonly ["/v1/health"];
/**
 * Standard API error codes with HTTP status mapping.
 * Used by the error middleware to produce structured responses.
 */
declare const ERROR_CODES: {
    readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly message: "Authentication required";
    };
    readonly TOKEN_EXPIRED: {
        readonly status: 401;
        readonly message: "Token has expired";
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
};
type ErrorCode = keyof typeof ERROR_CODES;

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

/** Options for paginated list queries */
interface ListOptions {
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
declare const ListOptionsSchema: z.ZodObject<{
    limit: z.ZodNumber;
    offset: z.ZodNumber;
    sort_by: z.ZodOptional<z.ZodString>;
    sort_order: z.ZodOptional<z.ZodEnum<["asc", "desc"]>>;
    filters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    offset: number;
    sort_by?: string | undefined;
    sort_order?: "asc" | "desc" | undefined;
    filters?: Record<string, unknown> | undefined;
}, {
    limit: number;
    offset: number;
    sort_by?: string | undefined;
    sort_order?: "asc" | "desc" | undefined;
    filters?: Record<string, unknown> | undefined;
}>;
/** Paginated query result */
interface PaginatedResult<T> {
    items: T[];
    total: number;
    has_more: boolean;
}
/** Options for vector similarity search */
interface VectorSearchOptions {
    /** Maximum results to return */
    limit: number;
    /** Minimum cosine similarity threshold (0-1) */
    min_similarity?: number;
    /** Additional filters */
    filters?: Record<string, unknown>;
}
declare const VectorSearchOptionsSchema: z.ZodObject<{
    limit: z.ZodNumber;
    min_similarity: z.ZodOptional<z.ZodNumber>;
    filters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    filters?: Record<string, unknown> | undefined;
    min_similarity?: number | undefined;
}, {
    limit: number;
    filters?: Record<string, unknown> | undefined;
    min_similarity?: number | undefined;
}>;
/** Options for BM25 text search */
interface TextSearchOptions {
    /** Maximum results to return */
    limit: number;
    /** Additional filters */
    filters?: Record<string, unknown>;
}
declare const TextSearchOptionsSchema: z.ZodObject<{
    limit: z.ZodNumber;
    filters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    filters?: Record<string, unknown> | undefined;
}, {
    limit: number;
    filters?: Record<string, unknown> | undefined;
}>;
/** Options for hybrid (vector + BM25) search */
interface HybridSearchOptions {
    /** Maximum results to return */
    limit: number;
    /** Weight balance between vector and BM25 */
    weights?: {
        vector: number;
        bm25: number;
    };
    /** Additional filters */
    filters?: Record<string, unknown>;
}
declare const HybridSearchOptionsSchema: z.ZodObject<{
    limit: z.ZodNumber;
    weights: z.ZodOptional<z.ZodObject<{
        vector: z.ZodNumber;
        bm25: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        vector: number;
        bm25: number;
    }, {
        vector: number;
        bm25: number;
    }>>;
    filters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    filters?: Record<string, unknown> | undefined;
    weights?: {
        vector: number;
        bm25: number;
    } | undefined;
}, {
    limit: number;
    filters?: Record<string, unknown> | undefined;
    weights?: {
        vector: number;
        bm25: number;
    } | undefined;
}>;
/** Search result (returned by all search methods) */
interface SearchResult {
    /** Node ID */
    id: string;
    /** Relevance score (0-1, higher is better) */
    score: number;
    /** The matched node data */
    node: Record<string, unknown>;
}
declare const SearchResultSchema: z.ZodObject<{
    id: z.ZodString;
    score: z.ZodNumber;
    node: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    id: string;
    score: number;
    node: Record<string, unknown>;
}, {
    id: string;
    score: number;
    node: Record<string, unknown>;
}>;
/** A set of changes since a given version */
interface ChangeSet {
    changes: Change[];
    currentVersion: number;
    hasMore: boolean;
}
declare const ChangeSetSchema: z.ZodObject<{
    changes: z.ZodArray<z.ZodLazy<z.ZodObject<{
        id: z.ZodString;
        table: z.ZodEnum<["nodes", "edges"]>;
        operation: z.ZodEnum<["create", "update", "delete"]>;
        data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        version: z.ZodNumber;
        timestamp: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        data: Record<string, unknown>;
        id: string;
        table: "nodes" | "edges";
        operation: "create" | "update" | "delete";
        version: number;
        timestamp: string;
    }, {
        data: Record<string, unknown>;
        id: string;
        table: "nodes" | "edges";
        operation: "create" | "update" | "delete";
        version: number;
        timestamp: string;
    }>>, "many">;
    currentVersion: z.ZodNumber;
    hasMore: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    changes: {
        data: Record<string, unknown>;
        id: string;
        table: "nodes" | "edges";
        operation: "create" | "update" | "delete";
        version: number;
        timestamp: string;
    }[];
    currentVersion: number;
    hasMore: boolean;
}, {
    changes: {
        data: Record<string, unknown>;
        id: string;
        table: "nodes" | "edges";
        operation: "create" | "update" | "delete";
        version: number;
        timestamp: string;
    }[];
    currentVersion: number;
    hasMore: boolean;
}>;
/** A single change record */
interface Change {
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
declare const ChangeSchema: z.ZodObject<{
    id: z.ZodString;
    table: z.ZodEnum<["nodes", "edges"]>;
    operation: z.ZodEnum<["create", "update", "delete"]>;
    data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    version: z.ZodNumber;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    data: Record<string, unknown>;
    id: string;
    table: "nodes" | "edges";
    operation: "create" | "update" | "delete";
    version: number;
    timestamp: string;
}, {
    data: Record<string, unknown>;
    id: string;
    table: "nodes" | "edges";
    operation: "create" | "update" | "delete";
    version: number;
    timestamp: string;
}>;
/** Result of applying client changes to server */
interface ApplyResult {
    applied: AppliedChange[];
    conflicts: AdapterConflict[];
    serverVersion: number;
}
declare const ApplyResultSchema: z.ZodObject<{
    applied: z.ZodArray<z.ZodLazy<z.ZodObject<{
        id: z.ZodString;
        operation: z.ZodEnum<["create", "update", "delete"]>;
        version: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        operation: "create" | "update" | "delete";
        version: number;
    }, {
        id: string;
        operation: "create" | "update" | "delete";
        version: number;
    }>>, "many">;
    conflicts: z.ZodArray<z.ZodLazy<z.ZodObject<{
        id: z.ZodString;
        conflictId: z.ZodString;
        type: z.ZodEnum<["VERSION_MISMATCH", "DELETED", "CONSTRAINT"]>;
        clientVersion: z.ZodNumber;
        serverVersion: z.ZodNumber;
        serverData: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        resolutionOptions: z.ZodArray<z.ZodEnum<["keep_local", "keep_server", "merge"]>, "many">;
    }, "strip", z.ZodTypeAny, {
        type: "VERSION_MISMATCH" | "DELETED" | "CONSTRAINT";
        id: string;
        conflictId: string;
        clientVersion: number;
        serverVersion: number;
        serverData: Record<string, unknown>;
        resolutionOptions: ("keep_local" | "keep_server" | "merge")[];
    }, {
        type: "VERSION_MISMATCH" | "DELETED" | "CONSTRAINT";
        id: string;
        conflictId: string;
        clientVersion: number;
        serverVersion: number;
        serverData: Record<string, unknown>;
        resolutionOptions: ("keep_local" | "keep_server" | "merge")[];
    }>>, "many">;
    serverVersion: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    applied: {
        id: string;
        operation: "create" | "update" | "delete";
        version: number;
    }[];
    conflicts: {
        type: "VERSION_MISMATCH" | "DELETED" | "CONSTRAINT";
        id: string;
        conflictId: string;
        clientVersion: number;
        serverVersion: number;
        serverData: Record<string, unknown>;
        resolutionOptions: ("keep_local" | "keep_server" | "merge")[];
    }[];
    serverVersion: number;
}, {
    applied: {
        id: string;
        operation: "create" | "update" | "delete";
        version: number;
    }[];
    conflicts: {
        type: "VERSION_MISMATCH" | "DELETED" | "CONSTRAINT";
        id: string;
        conflictId: string;
        clientVersion: number;
        serverVersion: number;
        serverData: Record<string, unknown>;
        resolutionOptions: ("keep_local" | "keep_server" | "merge")[];
    }[];
    serverVersion: number;
}>;
/** A successfully applied change */
interface AppliedChange {
    id: string;
    operation: 'create' | 'update' | 'delete';
    version: number;
}
declare const AppliedChangeSchema: z.ZodObject<{
    id: z.ZodString;
    operation: z.ZodEnum<["create", "update", "delete"]>;
    version: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    operation: "create" | "update" | "delete";
    version: number;
}, {
    id: string;
    operation: "create" | "update" | "delete";
    version: number;
}>;
/** A conflict detected during sync */
interface AdapterConflict {
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
declare const AdapterConflictSchema: z.ZodObject<{
    id: z.ZodString;
    conflictId: z.ZodString;
    type: z.ZodEnum<["VERSION_MISMATCH", "DELETED", "CONSTRAINT"]>;
    clientVersion: z.ZodNumber;
    serverVersion: z.ZodNumber;
    serverData: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    resolutionOptions: z.ZodArray<z.ZodEnum<["keep_local", "keep_server", "merge"]>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "VERSION_MISMATCH" | "DELETED" | "CONSTRAINT";
    id: string;
    conflictId: string;
    clientVersion: number;
    serverVersion: number;
    serverData: Record<string, unknown>;
    resolutionOptions: ("keep_local" | "keep_server" | "merge")[];
}, {
    type: "VERSION_MISMATCH" | "DELETED" | "CONSTRAINT";
    id: string;
    conflictId: string;
    clientVersion: number;
    serverVersion: number;
    serverData: Record<string, unknown>;
    resolutionOptions: ("keep_local" | "keep_server" | "merge")[];
}>;
/** Chat message */
interface AdapterMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
declare const AdapterMessageSchema: z.ZodObject<{
    role: z.ZodEnum<["system", "user", "assistant"]>;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    role: "system" | "user" | "assistant";
    content: string;
}, {
    role: "system" | "user" | "assistant";
    content: string;
}>;
/** LLM completion request */
interface CompletionRequest {
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
declare const CompletionRequestSchema: z.ZodObject<{
    model: z.ZodString;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["system", "user", "assistant"]>;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        role: "system" | "user" | "assistant";
        content: string;
    }, {
        role: "system" | "user" | "assistant";
        content: string;
    }>, "many">;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    temperature: z.ZodOptional<z.ZodNumber>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    cacheSystemPrompt: z.ZodOptional<z.ZodBoolean>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    model: string;
    messages: {
        role: "system" | "user" | "assistant";
        content: string;
    }[];
    maxTokens?: number | undefined;
    temperature?: number | undefined;
    systemPrompt?: string | undefined;
    cacheSystemPrompt?: boolean | undefined;
    requestId?: string | undefined;
}, {
    model: string;
    messages: {
        role: "system" | "user" | "assistant";
        content: string;
    }[];
    maxTokens?: number | undefined;
    temperature?: number | undefined;
    systemPrompt?: string | undefined;
    cacheSystemPrompt?: boolean | undefined;
    requestId?: string | undefined;
}>;
/** LLM completion response */
interface CompletionResponse {
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
declare const CompletionResponseSchema: z.ZodObject<{
    id: z.ZodString;
    content: z.ZodString;
    model: z.ZodString;
    usage: z.ZodLazy<z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        cachedTokens: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        inputTokens: number;
        outputTokens: number;
        cachedTokens?: number | undefined;
    }, {
        inputTokens: number;
        outputTokens: number;
        cachedTokens?: number | undefined;
    }>>;
    finishReason: z.ZodEnum<["stop", "length", "tool_use"]>;
}, "strip", z.ZodTypeAny, {
    id: string;
    content: string;
    model: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        cachedTokens?: number | undefined;
    };
    finishReason: "length" | "stop" | "tool_use";
}, {
    id: string;
    content: string;
    model: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        cachedTokens?: number | undefined;
    };
    finishReason: "length" | "stop" | "tool_use";
}>;
/** Streaming chunk from LLM */
interface CompletionChunk {
    /** Chunk ID */
    id: string;
    /** Text delta */
    delta: string;
    /** Set when stream ends */
    finishReason?: 'stop' | 'length' | 'tool_use';
}
declare const CompletionChunkSchema: z.ZodObject<{
    id: z.ZodString;
    delta: z.ZodString;
    finishReason: z.ZodOptional<z.ZodEnum<["stop", "length", "tool_use"]>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    delta: string;
    finishReason?: "length" | "stop" | "tool_use" | undefined;
}, {
    id: string;
    delta: string;
    finishReason?: "length" | "stop" | "tool_use" | undefined;
}>;
/** Token usage from LLM response */
interface AdapterTokenUsage {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
}
declare const AdapterTokenUsageSchema: z.ZodObject<{
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    cachedTokens: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number | undefined;
}, {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number | undefined;
}>;
/** Cost estimate for an LLM request */
interface AdapterCostEstimate {
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
declare const AdapterCostEstimateSchema: z.ZodObject<{
    min: z.ZodNumber;
    expected: z.ZodNumber;
    max: z.ZodNumber;
    breakdown: z.ZodObject<{
        embedding: z.ZodOptional<z.ZodNumber>;
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        caching: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        inputTokens: number;
        outputTokens: number;
        embedding?: number | undefined;
        caching?: number | undefined;
    }, {
        inputTokens: number;
        outputTokens: number;
        embedding?: number | undefined;
        caching?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    expected: number;
    min: number;
    max: number;
    breakdown: {
        inputTokens: number;
        outputTokens: number;
        embedding?: number | undefined;
        caching?: number | undefined;
    };
}, {
    expected: number;
    min: number;
    max: number;
    breakdown: {
        inputTokens: number;
        outputTokens: number;
        embedding?: number | undefined;
        caching?: number | undefined;
    };
}>;
/** Usage callback type for cost tracking */
type UsageCallback = (usage: UsageReport) => void;
/** Usage report emitted after each LLM call */
interface UsageReport {
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
declare const UsageReportSchema: z.ZodObject<{
    requestId: z.ZodString;
    provider: z.ZodString;
    model: z.ZodString;
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    cachedTokens: z.ZodNumber;
    actualCost: z.ZodNumber;
    latencyMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    model: string;
    requestId: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    provider: string;
    actualCost: number;
    latencyMs: number;
}, {
    model: string;
    requestId: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    provider: string;
    actualCost: number;
    latencyMs: number;
}>;
/** Result of token validation */
interface AdapterAuthResult {
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
declare const AdapterAuthResultSchema: z.ZodObject<{
    valid: z.ZodBoolean;
    userId: z.ZodOptional<z.ZodString>;
    tier: z.ZodOptional<z.ZodEnum<["free", "credits", "pro"]>>;
    privacyTier: z.ZodOptional<z.ZodEnum<["standard", "private"]>>;
    expiresAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    valid: boolean;
    userId?: string | undefined;
    tier?: "free" | "credits" | "pro" | undefined;
    privacyTier?: "standard" | "private" | undefined;
    expiresAt?: string | undefined;
}, {
    valid: boolean;
    userId?: string | undefined;
    tier?: "free" | "credits" | "pro" | undefined;
    privacyTier?: "standard" | "private" | undefined;
    expiresAt?: string | undefined;
}>;
/** Authenticated user */
interface AdapterUser {
    id: string;
    email: string;
    tier: 'free' | 'credits' | 'pro';
    privacyTier: 'standard' | 'private';
}
declare const AdapterUserSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    tier: z.ZodEnum<["free", "credits", "pro"]>;
    privacyTier: z.ZodEnum<["standard", "private"]>;
}, "strip", z.ZodTypeAny, {
    id: string;
    tier: "free" | "credits" | "pro";
    privacyTier: "standard" | "private";
    email: string;
}, {
    id: string;
    tier: "free" | "credits" | "pro";
    privacyTier: "standard" | "private";
    email: string;
}>;
/** Token pair from refresh */
interface AdapterTokenPair {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
}
declare const AdapterTokenPairSchema: z.ZodObject<{
    accessToken: z.ZodString;
    refreshToken: z.ZodString;
    expiresAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    expiresAt: string;
    accessToken: string;
    refreshToken: string;
}, {
    expiresAt: string;
    accessToken: string;
    refreshToken: string;
}>;
/** API key validation result */
interface AdapterApiKeyResult {
    valid: boolean;
    userId?: string;
    scopes?: string[];
}
declare const AdapterApiKeyResultSchema: z.ZodObject<{
    valid: z.ZodBoolean;
    userId: z.ZodOptional<z.ZodString>;
    scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    valid: boolean;
    userId?: string | undefined;
    scopes?: string[] | undefined;
}, {
    valid: boolean;
    userId?: string | undefined;
    scopes?: string[] | undefined;
}>;
/** Database transaction handle */
interface AdapterTransaction {
    /** Execute a read query within the transaction */
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
    /** Execute a write statement within the transaction */
    execute(sql: string, params?: unknown[]): Promise<void>;
}
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
interface IDatabaseAdapter {
    /** Tenant this adapter is scoped to */
    readonly tenantId: string;
    getNode(id: string): Promise<Record<string, unknown> | null>;
    createNode(node: Record<string, unknown>): Promise<Record<string, unknown>>;
    updateNode(id: string, updates: Record<string, unknown>, expectedVersion?: number): Promise<Record<string, unknown>>;
    deleteNode(id: string): Promise<void>;
    listNodes(options: ListOptions): Promise<PaginatedResult<Record<string, unknown>>>;
    getEdges(nodeId: string, direction: 'in' | 'out' | 'both'): Promise<Record<string, unknown>[]>;
    createEdge(edge: Record<string, unknown>): Promise<Record<string, unknown>>;
    deleteEdge(id: string): Promise<void>;
    vectorSearch(embedding: number[], options: VectorSearchOptions): Promise<SearchResult[]>;
    textSearch(query: string, options: TextSearchOptions): Promise<SearchResult[]>;
    hybridSearch(embedding: number[], query: string, options: HybridSearchOptions): Promise<SearchResult[]>;
    getChangesSince(version: number, limit?: number): Promise<ChangeSet>;
    applyChanges(changes: Change[], clientVersion: number): Promise<ApplyResult>;
    getCurrentVersion(): Promise<number>;
    transaction<T>(fn: (tx: AdapterTransaction) => Promise<T>): Promise<T>;
    ping(): Promise<boolean>;
}
/**
 * Multi-tenant database factory.
 * Manages database-per-tenant isolation (aligned with storm-017).
 *
 * In Turso: each tenant gets their own database in a group.
 * In SQLite: single database file (for self-host/dev).
 */
interface IDatabaseFactory {
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
/**
 * LLM adapter with streaming and cost tracking.
 * Wraps storm-015 LLM types with a provider-agnostic interface.
 *
 * Implementations: @nous/adapter-openai, @nous/adapter-anthropic
 */
interface ILLMAdapter {
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
/**
 * Text embedding adapter.
 * Generates vector embeddings for semantic search.
 *
 * Implementations: @nous/adapter-openai (text-embedding-3-small)
 */
interface IEmbeddingAdapter {
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
/**
 * Authentication adapter.
 * Validates tokens and manages user sessions.
 * Wraps storm-022 auth types.
 *
 * Implementations: @nous/adapter-clerk, @nous/adapter-local-auth
 */
interface IAuthAdapter {
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
/**
 * File/blob storage adapter.
 * Used for document uploads, exports, etc.
 *
 * Implementations: @nous/adapter-s3, @nous/adapter-local (filesystem)
 */
interface IStorageAdapter {
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
/** A job to be enqueued for background processing */
interface Job<T extends JobType | CronJobType = JobType> {
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
declare const JobSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    priority: z.ZodOptional<z.ZodEnum<["high", "normal", "low"]>>;
    correlationId: z.ZodOptional<z.ZodString>;
    tenantId: z.ZodString;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: string;
    id: string;
    payload: Record<string, unknown>;
    tenantId: string;
    createdAt: string;
    priority?: "high" | "normal" | "low" | undefined;
    correlationId?: string | undefined;
}, {
    type: string;
    id: string;
    payload: Record<string, unknown>;
    tenantId: string;
    createdAt: string;
    priority?: "high" | "normal" | "low" | undefined;
    correlationId?: string | undefined;
}>;
/** Event emitted during job lifecycle */
interface JobEvent {
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
declare const JobEventSchema: z.ZodObject<{
    jobId: z.ZodString;
    type: z.ZodString;
    tenantId: z.ZodString;
    correlationId: z.ZodOptional<z.ZodString>;
    startedAt: z.ZodOptional<z.ZodString>;
    completedAt: z.ZodOptional<z.ZodString>;
    durationMs: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: string;
    tenantId: string;
    jobId: string;
    correlationId?: string | undefined;
    startedAt?: string | undefined;
    completedAt?: string | undefined;
    durationMs?: number | undefined;
}, {
    type: string;
    tenantId: string;
    jobId: string;
    correlationId?: string | undefined;
    startedAt?: string | undefined;
    completedAt?: string | undefined;
    durationMs?: number | undefined;
}>;
/** A job that failed all retry attempts */
interface FailedJob {
    /** The original job */
    job: Job<JobType>;
    /** Error message */
    error: string;
    /** When the job failed (ISO 8601) */
    failedAt: string;
    /** Number of attempts made */
    attempts: number;
}
declare const FailedJobSchema: z.ZodObject<{
    job: z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        priority: z.ZodOptional<z.ZodEnum<["high", "normal", "low"]>>;
        correlationId: z.ZodOptional<z.ZodString>;
        tenantId: z.ZodString;
        createdAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: string;
        id: string;
        payload: Record<string, unknown>;
        tenantId: string;
        createdAt: string;
        priority?: "high" | "normal" | "low" | undefined;
        correlationId?: string | undefined;
    }, {
        type: string;
        id: string;
        payload: Record<string, unknown>;
        tenantId: string;
        createdAt: string;
        priority?: "high" | "normal" | "low" | undefined;
        correlationId?: string | undefined;
    }>;
    error: z.ZodString;
    failedAt: z.ZodString;
    attempts: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    error: string;
    job: {
        type: string;
        id: string;
        payload: Record<string, unknown>;
        tenantId: string;
        createdAt: string;
        priority?: "high" | "normal" | "low" | undefined;
        correlationId?: string | undefined;
    };
    failedAt: string;
    attempts: number;
}, {
    error: string;
    job: {
        type: string;
        id: string;
        payload: Record<string, unknown>;
        tenantId: string;
        createdAt: string;
        priority?: "high" | "normal" | "low" | undefined;
        correlationId?: string | undefined;
    };
    failedAt: string;
    attempts: number;
}>;
/** Function that processes a job */
type JobHandler<T extends JobType | CronJobType = JobType> = (job: Job<T>) => Promise<void>;
/** Configuration for a specific job type's execution */
interface JobTierConfig {
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
declare const JobTierConfigSchema: z.ZodObject<{
    type: z.ZodString;
    tier: z.ZodEnum<["inline", "queued", "regional"]>;
    max_duration_ms: z.ZodNumber;
    retry_count: z.ZodNumber;
    retry_delay_ms: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: string;
    tier: "inline" | "queued" | "regional";
    max_duration_ms: number;
    retry_count: number;
    retry_delay_ms: number;
}, {
    type: string;
    tier: "inline" | "queued" | "regional";
    max_duration_ms: number;
    retry_count: number;
    retry_delay_ms: number;
}>;
/** Queue metrics snapshot */
interface JobMetrics {
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
declare const JobMetricsSchema: z.ZodObject<{
    queue_depth: z.ZodNumber;
    processing_count: z.ZodNumber;
    completed_count: z.ZodNumber;
    failed_count: z.ZodNumber;
    avg_processing_time_ms: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    queue_depth: number;
    processing_count: number;
    completed_count: number;
    failed_count: number;
    avg_processing_time_ms: number;
}, {
    queue_depth: number;
    processing_count: number;
    completed_count: number;
    failed_count: number;
    avg_processing_time_ms: number;
}>;
/**
 * Job queue adapter interface.
 * Provides background job processing with observability and DLQ.
 *
 * Implementations:
 * - @nous/adapter-cloudflare-queue (Cloudflare Queues for cloud)
 * - @nous/adapter-bullmq (BullMQ + Redis for self-host)
 * - @nous/adapter-mock (in-memory for development/testing)
 */
interface IJobQueueAdapter {
    /** Enqueue a single job */
    enqueue<T extends JobType>(job: Job<T>): Promise<string>;
    /** Enqueue multiple jobs atomically */
    enqueueBatch<T extends JobType>(jobs: Job<T>[]): Promise<string[]>;
    /** Schedule a recurring cron job */
    schedule(cronExpression: string, job: Job<CronJobType>): Promise<string>;
    /** Called when a job starts processing */
    onJobStart(callback: (event: JobEvent) => void): void;
    /** Called when a job completes successfully */
    onJobComplete(callback: (event: JobEvent) => void): void;
    /** Called when a job fails */
    onJobError(callback: (event: JobEvent, error: Error) => void): void;
    /** Get all failed jobs awaiting manual intervention */
    getDeadLetterQueue(): Promise<FailedJob[]>;
    /** Retry a failed job from the DLQ */
    retryDeadLetter(jobId: string): Promise<void>;
    /** Get current queue depth */
    getQueueDepth(): Promise<number>;
    /** Get count of jobs currently processing */
    getProcessingCount(): Promise<number>;
}
/**
 * Central server configuration.
 * Holds references to all adapters and deployment settings.
 * Passed to createServer() to wire everything into a Hono app.
 *
 * NOTE: No Zod schema — contains adapter interface references.
 */
interface ServerConfig {
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
/** Route group definition for documentation and registration */
interface RouteGroup {
    /** URL prefix (e.g., '/v1/nodes') */
    prefix: string;
    /** Human-readable description */
    description: string;
    /** Whether authentication is required */
    auth_required: boolean;
    /** Whether rate limiting is applied */
    rate_limited: boolean;
}
declare const RouteGroupSchema: z.ZodObject<{
    prefix: z.ZodString;
    description: z.ZodString;
    auth_required: z.ZodBoolean;
    rate_limited: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    prefix: string;
    description: string;
    auth_required: boolean;
    rate_limited: boolean;
}, {
    prefix: string;
    description: string;
    auth_required: boolean;
    rate_limited: boolean;
}>;
/** CORS middleware configuration */
interface CORSConfig {
    origins: string[];
    methods: string[];
    headers: string[];
    credentials: boolean;
}
declare const CORSConfigSchema: z.ZodObject<{
    origins: z.ZodArray<z.ZodString, "many">;
    methods: z.ZodArray<z.ZodString, "many">;
    headers: z.ZodArray<z.ZodString, "many">;
    credentials: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    origins: string[];
    methods: string[];
    headers: string[];
    credentials: boolean;
}, {
    origins: string[];
    methods: string[];
    headers: string[];
    credentials: boolean;
}>;
/** Auth middleware configuration */
interface AuthMiddlewareConfig {
    /** Paths that bypass authentication */
    exclude_paths: string[];
    /** Header containing the token */
    token_header: string;
    /** Token prefix to strip (e.g., 'Bearer ') */
    token_prefix: string;
}
declare const AuthMiddlewareConfigSchema: z.ZodObject<{
    exclude_paths: z.ZodArray<z.ZodString, "many">;
    token_header: z.ZodString;
    token_prefix: z.ZodString;
}, "strip", z.ZodTypeAny, {
    exclude_paths: string[];
    token_header: string;
    token_prefix: string;
}, {
    exclude_paths: string[];
    token_header: string;
    token_prefix: string;
}>;
/** Rate limit middleware configuration */
interface ServerRateLimitConfig {
    /** Maximum requests per window */
    requests_per_minute: number;
    /** Sliding window duration in milliseconds */
    window_ms: number;
    /** Key prefix for rate limit storage */
    key_prefix: string;
}
declare const ServerRateLimitConfigSchema: z.ZodObject<{
    requests_per_minute: z.ZodNumber;
    window_ms: z.ZodNumber;
    key_prefix: z.ZodString;
}, "strip", z.ZodTypeAny, {
    requests_per_minute: number;
    window_ms: number;
    key_prefix: string;
}, {
    requests_per_minute: number;
    window_ms: number;
    key_prefix: string;
}>;
/** Logging middleware configuration */
interface LoggingMiddlewareConfig {
    level: LogLevel;
    format: 'json' | 'text';
    include_request_id: boolean;
}
declare const LoggingMiddlewareConfigSchema: z.ZodObject<{
    level: z.ZodEnum<["debug", "info", "warn", "error", "fatal"]>;
    format: z.ZodEnum<["json", "text"]>;
    include_request_id: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    level: "error" | "debug" | "info" | "warn" | "fatal";
    format: "json" | "text";
    include_request_id: boolean;
}, {
    level: "error" | "debug" | "info" | "warn" | "fatal";
    format: "json" | "text";
    include_request_id: boolean;
}>;
/** Error handling middleware configuration */
interface ErrorMiddlewareConfig {
    /** Whether to expose error details (false in production) */
    expose_errors: boolean;
    /** Sentry DSN for error reporting */
    sentry_dsn?: string;
}
declare const ErrorMiddlewareConfigSchema: z.ZodObject<{
    expose_errors: z.ZodBoolean;
    sentry_dsn: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    expose_errors: boolean;
    sentry_dsn?: string | undefined;
}, {
    expose_errors: boolean;
    sentry_dsn?: string | undefined;
}>;
/** Complete middleware configuration */
interface MiddlewareConfig {
    cors: CORSConfig;
    auth: AuthMiddlewareConfig;
    rateLimit: ServerRateLimitConfig;
    logging: LoggingMiddlewareConfig;
    error: ErrorMiddlewareConfig;
}
declare const MiddlewareConfigSchema: z.ZodObject<{
    cors: z.ZodObject<{
        origins: z.ZodArray<z.ZodString, "many">;
        methods: z.ZodArray<z.ZodString, "many">;
        headers: z.ZodArray<z.ZodString, "many">;
        credentials: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        origins: string[];
        methods: string[];
        headers: string[];
        credentials: boolean;
    }, {
        origins: string[];
        methods: string[];
        headers: string[];
        credentials: boolean;
    }>;
    auth: z.ZodObject<{
        exclude_paths: z.ZodArray<z.ZodString, "many">;
        token_header: z.ZodString;
        token_prefix: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        exclude_paths: string[];
        token_header: string;
        token_prefix: string;
    }, {
        exclude_paths: string[];
        token_header: string;
        token_prefix: string;
    }>;
    rateLimit: z.ZodObject<{
        requests_per_minute: z.ZodNumber;
        window_ms: z.ZodNumber;
        key_prefix: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        requests_per_minute: number;
        window_ms: number;
        key_prefix: string;
    }, {
        requests_per_minute: number;
        window_ms: number;
        key_prefix: string;
    }>;
    logging: z.ZodObject<{
        level: z.ZodEnum<["debug", "info", "warn", "error", "fatal"]>;
        format: z.ZodEnum<["json", "text"]>;
        include_request_id: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        level: "error" | "debug" | "info" | "warn" | "fatal";
        format: "json" | "text";
        include_request_id: boolean;
    }, {
        level: "error" | "debug" | "info" | "warn" | "fatal";
        format: "json" | "text";
        include_request_id: boolean;
    }>;
    error: z.ZodObject<{
        expose_errors: z.ZodBoolean;
        sentry_dsn: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        expose_errors: boolean;
        sentry_dsn?: string | undefined;
    }, {
        expose_errors: boolean;
        sentry_dsn?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    error: {
        expose_errors: boolean;
        sentry_dsn?: string | undefined;
    };
    auth: {
        exclude_paths: string[];
        token_header: string;
        token_prefix: string;
    };
    cors: {
        origins: string[];
        methods: string[];
        headers: string[];
        credentials: boolean;
    };
    logging: {
        level: "error" | "debug" | "info" | "warn" | "fatal";
        format: "json" | "text";
        include_request_id: boolean;
    };
    rateLimit: {
        requests_per_minute: number;
        window_ms: number;
        key_prefix: string;
    };
}, {
    error: {
        expose_errors: boolean;
        sentry_dsn?: string | undefined;
    };
    auth: {
        exclude_paths: string[];
        token_header: string;
        token_prefix: string;
    };
    cors: {
        origins: string[];
        methods: string[];
        headers: string[];
        credentials: boolean;
    };
    logging: {
        level: "error" | "debug" | "info" | "warn" | "fatal";
        format: "json" | "text";
        include_request_id: boolean;
    };
    rateLimit: {
        requests_per_minute: number;
        window_ms: number;
        key_prefix: string;
    };
}>;
/** Structured API error response */
interface ApiErrorResponse {
    /** Error code (e.g., 'UNAUTHORIZED', 'NOT_FOUND') */
    code: string;
    /** Human-readable error message */
    message: string;
    /** Additional details (only in development mode) */
    details?: Record<string, unknown>;
    /** Request tracking ID */
    request_id?: string;
}
declare const ApiErrorResponseSchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
    details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    request_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    details?: Record<string, unknown> | undefined;
    request_id?: string | undefined;
}, {
    code: string;
    message: string;
    details?: Record<string, unknown> | undefined;
    request_id?: string | undefined;
}>;
/** Hono app abstraction (the server's public interface) */
interface HonoApp {
    /** Handle an incoming HTTP request */
    fetch: (request: Request) => Promise<Response>;
}
/** Options for creating an SSE stream */
interface SSEOptions {
    /** Maximum stream duration before sending timeout event (default: 25000ms) */
    maxDurationMs?: number;
    /** Heartbeat interval (default: 15000ms) */
    heartbeatMs?: number;
    /** Whether to support reconnection via Last-Event-ID (default: true) */
    reconnectable?: boolean;
}
declare const SSEOptionsSchema: z.ZodObject<{
    maxDurationMs: z.ZodOptional<z.ZodNumber>;
    heartbeatMs: z.ZodOptional<z.ZodNumber>;
    reconnectable: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    maxDurationMs?: number | undefined;
    heartbeatMs?: number | undefined;
    reconnectable?: boolean | undefined;
}, {
    maxDurationMs?: number | undefined;
    heartbeatMs?: number | undefined;
    reconnectable?: boolean | undefined;
}>;
/** A single SSE event sent to the client */
interface SSEEvent {
    /** Event type */
    event: SSEEventType;
    /** Event ID for reconnection tracking */
    id?: string;
    /** Event data (JSON stringified) */
    data: string;
}
declare const SSEEventSchema: z.ZodObject<{
    event: z.ZodEnum<["data", "ping", "timeout", "done", "error"]>;
    id: z.ZodOptional<z.ZodString>;
    data: z.ZodString;
}, "strip", z.ZodTypeAny, {
    data: string;
    event: "data" | "ping" | "timeout" | "done" | "error";
    id?: string | undefined;
}, {
    data: string;
    event: "data" | "ping" | "timeout" | "done" | "error";
    id?: string | undefined;
}>;
/** Internal state of an active SSE stream */
interface SSEStreamState {
    /** Monotonically increasing event counter */
    eventId: number;
    /** Stream start time (Date.now()) */
    startTime: number;
    /** Last-Event-ID from reconnection header */
    lastEventId?: string;
    /** Whether the stream has been closed */
    closed: boolean;
}
declare const SSEStreamStateSchema: z.ZodObject<{
    eventId: z.ZodNumber;
    startTime: z.ZodNumber;
    lastEventId: z.ZodOptional<z.ZodString>;
    closed: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    eventId: number;
    startTime: number;
    closed: boolean;
    lastEventId?: string | undefined;
}, {
    eventId: number;
    startTime: number;
    closed: boolean;
    lastEventId?: string | undefined;
}>;
/**
 * Chat-specific SSE chunk types for /v1/chat endpoint.
 * The chat endpoint streams these as SSE data events.
 */
interface ChatStreamChunk {
    /** Chunk type */
    type: 'token' | 'source' | 'done' | 'error';
    /** Generated text (for 'token' type) */
    content?: string;
    /** Referenced node IDs (for 'source' type) */
    sources?: string[];
    /** Error message (for 'error' type) */
    error?: string;
}
declare const ChatStreamChunkSchema: z.ZodObject<{
    type: z.ZodEnum<["token", "source", "done", "error"]>;
    content: z.ZodOptional<z.ZodString>;
    sources: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "done" | "error" | "token" | "source";
    error?: string | undefined;
    content?: string | undefined;
    sources?: string[] | undefined;
}, {
    type: "done" | "error" | "token" | "source";
    error?: string | undefined;
    content?: string | undefined;
    sources?: string[] | undefined;
}>;
/** Turso cloud database configuration */
declare const TursoDatabaseConfigSchema: z.ZodObject<{
    type: z.ZodLiteral<"turso">;
    /** Turso database URL (libsql://...) */
    url: z.ZodString;
    /** Turso auth token */
    authToken: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "turso";
    url: string;
    authToken: string;
}, {
    type: "turso";
    url: string;
    authToken: string;
}>;
type TursoDatabaseConfig = z.infer<typeof TursoDatabaseConfigSchema>;
/** Local SQLite database configuration */
declare const SqliteDatabaseConfigSchema: z.ZodObject<{
    type: z.ZodLiteral<"sqlite">;
    /** Path to SQLite database file */
    path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    type: "sqlite";
}, {
    path: string;
    type: "sqlite";
}>;
type SqliteDatabaseConfig = z.infer<typeof SqliteDatabaseConfigSchema>;
/** Database configuration (one of the above) */
declare const DatabaseConfigSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"turso">;
    /** Turso database URL (libsql://...) */
    url: z.ZodString;
    /** Turso auth token */
    authToken: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "turso";
    url: string;
    authToken: string;
}, {
    type: "turso";
    url: string;
    authToken: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sqlite">;
    /** Path to SQLite database file */
    path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    type: "sqlite";
}, {
    path: string;
    type: "sqlite";
}>]>;
type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
/** Clerk cloud auth configuration */
declare const ClerkAuthConfigSchema: z.ZodObject<{
    type: z.ZodLiteral<"clerk">;
    /** Clerk secret key (server-side) */
    secretKey: z.ZodString;
    /** Clerk publishable key */
    publishableKey: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "clerk";
    secretKey: string;
    publishableKey: string;
}, {
    type: "clerk";
    secretKey: string;
    publishableKey: string;
}>;
type ClerkAuthConfig = z.infer<typeof ClerkAuthConfigSchema>;
/** Local JWT auth configuration (for dev/self-host) */
declare const LocalAuthConfigSchema: z.ZodObject<{
    type: z.ZodLiteral<"local">;
    /** JWT signing secret (optional, auto-generated if not set) */
    jwtSecret: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "local";
    jwtSecret?: string | undefined;
}, {
    type: "local";
    jwtSecret?: string | undefined;
}>;
type LocalAuthConfig = z.infer<typeof LocalAuthConfigSchema>;
/** Auth configuration (one of the above) */
declare const AuthConfigSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"clerk">;
    /** Clerk secret key (server-side) */
    secretKey: z.ZodString;
    /** Clerk publishable key */
    publishableKey: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "clerk";
    secretKey: string;
    publishableKey: string;
}, {
    type: "clerk";
    secretKey: string;
    publishableKey: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"local">;
    /** JWT signing secret (optional, auto-generated if not set) */
    jwtSecret: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "local";
    jwtSecret?: string | undefined;
}, {
    type: "local";
    jwtSecret?: string | undefined;
}>]>;
type AuthConfig = z.infer<typeof AuthConfigSchema>;
/** LLM provider configuration (at least one key required) */
declare const LLMConfigSchema: z.ZodObject<{
    openai: z.ZodOptional<z.ZodObject<{
        apiKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        apiKey: string;
    }, {
        apiKey: string;
    }>>;
    anthropic: z.ZodOptional<z.ZodObject<{
        apiKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        apiKey: string;
    }, {
        apiKey: string;
    }>>;
    google: z.ZodOptional<z.ZodObject<{
        apiKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        apiKey: string;
    }, {
        apiKey: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    openai?: {
        apiKey: string;
    } | undefined;
    anthropic?: {
        apiKey: string;
    } | undefined;
    google?: {
        apiKey: string;
    } | undefined;
}, {
    openai?: {
        apiKey: string;
    } | undefined;
    anthropic?: {
        apiKey: string;
    } | undefined;
    google?: {
        apiKey: string;
    } | undefined;
}>;
type LLMConfig = z.infer<typeof LLMConfigSchema>;
/** Cloudflare Queues configuration (bound via wrangler.toml) */
declare const CloudflareJobsConfigSchema: z.ZodObject<{
    type: z.ZodLiteral<"cloudflare">;
}, "strip", z.ZodTypeAny, {
    type: "cloudflare";
}, {
    type: "cloudflare";
}>;
type CloudflareJobsConfig = z.infer<typeof CloudflareJobsConfigSchema>;
/** BullMQ + Redis configuration (for self-host/scale) */
declare const BullMQJobsConfigSchema: z.ZodObject<{
    type: z.ZodLiteral<"bullmq">;
    /** Redis connection URL */
    redisUrl: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "bullmq";
    redisUrl: string;
}, {
    type: "bullmq";
    redisUrl: string;
}>;
type BullMQJobsConfig = z.infer<typeof BullMQJobsConfigSchema>;
/** In-memory job queue (for development) */
declare const MemoryJobsConfigSchema: z.ZodObject<{
    type: z.ZodLiteral<"memory">;
}, "strip", z.ZodTypeAny, {
    type: "memory";
}, {
    type: "memory";
}>;
type MemoryJobsConfig = z.infer<typeof MemoryJobsConfigSchema>;
/** Jobs configuration (one of the above) */
declare const JobsConfigSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"cloudflare">;
}, "strip", z.ZodTypeAny, {
    type: "cloudflare";
}, {
    type: "cloudflare";
}>, z.ZodObject<{
    type: z.ZodLiteral<"bullmq">;
    /** Redis connection URL */
    redisUrl: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "bullmq";
    redisUrl: string;
}, {
    type: "bullmq";
    redisUrl: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"memory">;
}, "strip", z.ZodTypeAny, {
    type: "memory";
}, {
    type: "memory";
}>]>;
type JobsConfig = z.infer<typeof JobsConfigSchema>;
/** Observability and monitoring configuration */
declare const ObservabilityConfigSchema: z.ZodObject<{
    /** Sentry DSN for error tracking */
    sentryDsn: z.ZodOptional<z.ZodString>;
    /** Log level */
    logLevel: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error", "fatal"]>>;
}, "strip", z.ZodTypeAny, {
    logLevel: "error" | "debug" | "info" | "warn" | "fatal";
    sentryDsn?: string | undefined;
}, {
    sentryDsn?: string | undefined;
    logLevel?: "error" | "debug" | "info" | "warn" | "fatal" | undefined;
}>;
type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>;
/**
 * Complete Nous backend configuration.
 * Validated at startup — fails fast on invalid config.
 */
declare const NousConfigSchema: z.ZodObject<{
    /** Deployment environment */
    env: z.ZodDefault<z.ZodEnum<["development", "staging", "production"]>>;
    /** Server port */
    port: z.ZodDefault<z.ZodNumber>;
    /** Server host */
    host: z.ZodDefault<z.ZodString>;
    /** Database configuration */
    database: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"turso">;
        /** Turso database URL (libsql://...) */
        url: z.ZodString;
        /** Turso auth token */
        authToken: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "turso";
        url: string;
        authToken: string;
    }, {
        type: "turso";
        url: string;
        authToken: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"sqlite">;
        /** Path to SQLite database file */
        path: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "sqlite";
    }, {
        path: string;
        type: "sqlite";
    }>]>;
    /** Authentication configuration */
    auth: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"clerk">;
        /** Clerk secret key (server-side) */
        secretKey: z.ZodString;
        /** Clerk publishable key */
        publishableKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "clerk";
        secretKey: string;
        publishableKey: string;
    }, {
        type: "clerk";
        secretKey: string;
        publishableKey: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"local">;
        /** JWT signing secret (optional, auto-generated if not set) */
        jwtSecret: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "local";
        jwtSecret?: string | undefined;
    }, {
        type: "local";
        jwtSecret?: string | undefined;
    }>]>;
    /** LLM provider configuration */
    llm: z.ZodObject<{
        openai: z.ZodOptional<z.ZodObject<{
            apiKey: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            apiKey: string;
        }, {
            apiKey: string;
        }>>;
        anthropic: z.ZodOptional<z.ZodObject<{
            apiKey: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            apiKey: string;
        }, {
            apiKey: string;
        }>>;
        google: z.ZodOptional<z.ZodObject<{
            apiKey: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            apiKey: string;
        }, {
            apiKey: string;
        }>>;
    }, "strip", z.ZodTypeAny, {
        openai?: {
            apiKey: string;
        } | undefined;
        anthropic?: {
            apiKey: string;
        } | undefined;
        google?: {
            apiKey: string;
        } | undefined;
    }, {
        openai?: {
            apiKey: string;
        } | undefined;
        anthropic?: {
            apiKey: string;
        } | undefined;
        google?: {
            apiKey: string;
        } | undefined;
    }>;
    /** Job queue configuration */
    jobs: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"cloudflare">;
    }, "strip", z.ZodTypeAny, {
        type: "cloudflare";
    }, {
        type: "cloudflare";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"bullmq">;
        /** Redis connection URL */
        redisUrl: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "bullmq";
        redisUrl: string;
    }, {
        type: "bullmq";
        redisUrl: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"memory">;
    }, "strip", z.ZodTypeAny, {
        type: "memory";
    }, {
        type: "memory";
    }>]>;
    /** Observability configuration */
    observability: z.ZodObject<{
        /** Sentry DSN for error tracking */
        sentryDsn: z.ZodOptional<z.ZodString>;
        /** Log level */
        logLevel: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error", "fatal"]>>;
    }, "strip", z.ZodTypeAny, {
        logLevel: "error" | "debug" | "info" | "warn" | "fatal";
        sentryDsn?: string | undefined;
    }, {
        sentryDsn?: string | undefined;
        logLevel?: "error" | "debug" | "info" | "warn" | "fatal" | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    database: {
        type: "turso";
        url: string;
        authToken: string;
    } | {
        path: string;
        type: "sqlite";
    };
    llm: {
        openai?: {
            apiKey: string;
        } | undefined;
        anthropic?: {
            apiKey: string;
        } | undefined;
        google?: {
            apiKey: string;
        } | undefined;
    };
    auth: {
        type: "clerk";
        secretKey: string;
        publishableKey: string;
    } | {
        type: "local";
        jwtSecret?: string | undefined;
    };
    jobs: {
        type: "cloudflare";
    } | {
        type: "bullmq";
        redisUrl: string;
    } | {
        type: "memory";
    };
    env: "development" | "staging" | "production";
    port: number;
    host: string;
    observability: {
        logLevel: "error" | "debug" | "info" | "warn" | "fatal";
        sentryDsn?: string | undefined;
    };
}, {
    database: {
        type: "turso";
        url: string;
        authToken: string;
    } | {
        path: string;
        type: "sqlite";
    };
    llm: {
        openai?: {
            apiKey: string;
        } | undefined;
        anthropic?: {
            apiKey: string;
        } | undefined;
        google?: {
            apiKey: string;
        } | undefined;
    };
    auth: {
        type: "clerk";
        secretKey: string;
        publishableKey: string;
    } | {
        type: "local";
        jwtSecret?: string | undefined;
    };
    jobs: {
        type: "cloudflare";
    } | {
        type: "bullmq";
        redisUrl: string;
    } | {
        type: "memory";
    };
    observability: {
        sentryDsn?: string | undefined;
        logLevel?: "error" | "debug" | "info" | "warn" | "fatal" | undefined;
    };
    env?: "development" | "staging" | "production" | undefined;
    port?: number | undefined;
    host?: string | undefined;
}>;
type NousConfig = z.infer<typeof NousConfigSchema>;
/** Response from the /v1/health endpoint */
interface HealthCheckResponse {
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
declare const HealthCheckResponseSchema: z.ZodObject<{
    status: z.ZodEnum<["healthy", "degraded", "unhealthy"]>;
    version: z.ZodString;
    timestamp: z.ZodString;
    services: z.ZodRecord<z.ZodString, z.ZodLazy<z.ZodObject<{
        status: z.ZodEnum<["healthy", "degraded", "unhealthy"]>;
        latency_ms: z.ZodOptional<z.ZodNumber>;
        error: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "healthy" | "degraded" | "unhealthy";
        error?: string | undefined;
        latency_ms?: number | undefined;
    }, {
        status: "healthy" | "degraded" | "unhealthy";
        error?: string | undefined;
        latency_ms?: number | undefined;
    }>>>;
    metrics: z.ZodOptional<z.ZodLazy<z.ZodObject<{
        jobQueueDepth: z.ZodOptional<z.ZodNumber>;
        activeConnections: z.ZodOptional<z.ZodNumber>;
        uptime_seconds: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        jobQueueDepth?: number | undefined;
        activeConnections?: number | undefined;
        uptime_seconds?: number | undefined;
    }, {
        jobQueueDepth?: number | undefined;
        activeConnections?: number | undefined;
        uptime_seconds?: number | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    status: "healthy" | "degraded" | "unhealthy";
    version: string;
    timestamp: string;
    services: Record<string, {
        status: "healthy" | "degraded" | "unhealthy";
        error?: string | undefined;
        latency_ms?: number | undefined;
    }>;
    metrics?: {
        jobQueueDepth?: number | undefined;
        activeConnections?: number | undefined;
        uptime_seconds?: number | undefined;
    } | undefined;
}, {
    status: "healthy" | "degraded" | "unhealthy";
    version: string;
    timestamp: string;
    services: Record<string, {
        status: "healthy" | "degraded" | "unhealthy";
        error?: string | undefined;
        latency_ms?: number | undefined;
    }>;
    metrics?: {
        jobQueueDepth?: number | undefined;
        activeConnections?: number | undefined;
        uptime_seconds?: number | undefined;
    } | undefined;
}>;
/** Health status of an individual service/adapter */
interface ServiceHealth {
    /** Service status */
    status: HealthStatus;
    /** Response latency in milliseconds */
    latency_ms?: number;
    /** Error message if unhealthy */
    error?: string;
}
declare const ServiceHealthSchema: z.ZodObject<{
    status: z.ZodEnum<["healthy", "degraded", "unhealthy"]>;
    latency_ms: z.ZodOptional<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "healthy" | "degraded" | "unhealthy";
    error?: string | undefined;
    latency_ms?: number | undefined;
}, {
    status: "healthy" | "degraded" | "unhealthy";
    error?: string | undefined;
    latency_ms?: number | undefined;
}>;
/** Optional system metrics included in health response */
interface HealthMetrics {
    /** Number of jobs in queue */
    jobQueueDepth?: number;
    /** Number of active connections */
    activeConnections?: number;
    /** Server uptime in seconds */
    uptime_seconds?: number;
}
declare const HealthMetricsSchema: z.ZodObject<{
    jobQueueDepth: z.ZodOptional<z.ZodNumber>;
    activeConnections: z.ZodOptional<z.ZodNumber>;
    uptime_seconds: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    jobQueueDepth?: number | undefined;
    activeConnections?: number | undefined;
    uptime_seconds?: number | undefined;
}, {
    jobQueueDepth?: number | undefined;
    activeConnections?: number | undefined;
    uptime_seconds?: number | undefined;
}>;
/** Readiness probe for Kubernetes/Fly.io */
interface ReadinessCheck {
    /** Whether the server is ready to accept requests */
    ready: boolean;
    /** Individual check results */
    checks: Record<string, boolean>;
}
declare const ReadinessCheckSchema: z.ZodObject<{
    ready: z.ZodBoolean;
    checks: z.ZodRecord<z.ZodString, z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    ready: boolean;
    checks: Record<string, boolean>;
}, {
    ready: boolean;
    checks: Record<string, boolean>;
}>;
/** A single entry in the deployment decision matrix */
interface DeploymentMatrixEntry {
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
declare const DeploymentMatrixEntrySchema: z.ZodObject<{
    scenario: z.ZodString;
    api: z.ZodString;
    jobs: z.ZodString;
    database: z.ZodString;
    auth: z.ZodString;
    description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    database: string;
    auth: string;
    jobs: string;
    description: string;
    scenario: string;
    api: string;
}, {
    database: string;
    auth: string;
    jobs: string;
    description: string;
    scenario: string;
    api: string;
}>;
/** Self-hosting system requirements */
interface SelfHostConfig {
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
declare const SelfHostConfigSchema: z.ZodObject<{
    docker_compose_services: z.ZodArray<z.ZodString, "many">;
    required_env_vars: z.ZodArray<z.ZodString, "many">;
    optional_env_vars: z.ZodArray<z.ZodString, "many">;
    min_ram_mb: z.ZodNumber;
    recommended_ram_mb: z.ZodNumber;
    volumes: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    docker_compose_services: string[];
    required_env_vars: string[];
    optional_env_vars: string[];
    min_ram_mb: number;
    recommended_ram_mb: number;
    volumes: string[];
}, {
    docker_compose_services: string[];
    required_env_vars: string[];
    optional_env_vars: string[];
    min_ram_mb: number;
    recommended_ram_mb: number;
    volumes: string[];
}>;
/** Docker Compose service definition */
interface DockerServiceConfig {
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
declare const DockerServiceConfigSchema: z.ZodObject<{
    name: z.ZodString;
    image: z.ZodString;
    ports: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    environment: z.ZodArray<z.ZodString, "many">;
    volumes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    depends_on: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    image: string;
    environment: string[];
    volumes?: string[] | undefined;
    ports?: string[] | undefined;
    depends_on?: string[] | undefined;
}, {
    name: string;
    image: string;
    environment: string[];
    volumes?: string[] | undefined;
    ports?: string[] | undefined;
    depends_on?: string[] | undefined;
}>;
/** A single structured log entry (JSON format) */
interface StructuredLogEntry {
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
declare const StructuredLogEntrySchema: z.ZodObject<{
    timestamp: z.ZodString;
    requestId: z.ZodString;
    level: z.ZodEnum<["debug", "info", "warn", "error", "fatal"]>;
    method: z.ZodOptional<z.ZodString>;
    path: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodNumber>;
    duration_ms: z.ZodOptional<z.ZodNumber>;
    userId: z.ZodOptional<z.ZodString>;
    tenantId: z.ZodOptional<z.ZodString>;
    message: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    timestamp: string;
    requestId: string;
    level: "error" | "debug" | "info" | "warn" | "fatal";
    error?: string | undefined;
    path?: string | undefined;
    message?: string | undefined;
    status?: number | undefined;
    userId?: string | undefined;
    tenantId?: string | undefined;
    method?: string | undefined;
    duration_ms?: number | undefined;
}, {
    timestamp: string;
    requestId: string;
    level: "error" | "debug" | "info" | "warn" | "fatal";
    error?: string | undefined;
    path?: string | undefined;
    message?: string | undefined;
    status?: number | undefined;
    userId?: string | undefined;
    tenantId?: string | undefined;
    method?: string | undefined;
    duration_ms?: number | undefined;
}>;
/** Which metrics to collect */
interface MetricsConfig {
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
declare const MetricsConfigSchema: z.ZodObject<{
    request_count: z.ZodBoolean;
    request_duration: z.ZodBoolean;
    llm_cost: z.ZodBoolean;
    embedding_count: z.ZodBoolean;
    job_queue_size: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    request_count: boolean;
    request_duration: boolean;
    llm_cost: boolean;
    embedding_count: boolean;
    job_queue_size: boolean;
}, {
    request_count: boolean;
    request_duration: boolean;
    llm_cost: boolean;
    embedding_count: boolean;
    job_queue_size: boolean;
}>;
/** Sentry error tracking configuration */
interface SentryConfig {
    /** Sentry DSN */
    dsn: string;
    /** Percentage of requests to trace (0-1) */
    traces_sample_rate: number;
    /** Deployment environment tag */
    environment: DeploymentEnvironment;
    /** Release version tag */
    release?: string;
}
declare const SentryConfigSchema: z.ZodObject<{
    dsn: z.ZodString;
    traces_sample_rate: z.ZodNumber;
    environment: z.ZodEnum<["development", "staging", "production"]>;
    release: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    environment: "development" | "staging" | "production";
    dsn: string;
    traces_sample_rate: number;
    release?: string | undefined;
}, {
    environment: "development" | "staging" | "production";
    dsn: string;
    traces_sample_rate: number;
    release?: string | undefined;
}>;
/** Per-request context passed through middleware chain */
interface RequestContext {
    /** Unique request identifier (UUID v4) */
    requestId: string;
    /** Authenticated user ID (set by auth middleware) */
    userId?: string;
    /** Tenant ID (set by auth middleware) */
    tenantId?: string;
    /** Request start time (Date.now()) */
    startTime: number;
}
declare const RequestContextSchema: z.ZodObject<{
    requestId: z.ZodString;
    userId: z.ZodOptional<z.ZodString>;
    tenantId: z.ZodOptional<z.ZodString>;
    startTime: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    requestId: string;
    startTime: number;
    userId?: string | undefined;
    tenantId?: string | undefined;
}, {
    requestId: string;
    startTime: number;
    userId?: string | undefined;
    tenantId?: string | undefined;
}>;
/** Configuration for local development server */
interface LocalDevConfig {
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
declare const LocalDevConfigSchema: z.ZodObject<{
    port: z.ZodNumber;
    database_path: z.ZodString;
    auto_seed: z.ZodBoolean;
    mock_llm_latency_ms: z.ZodNumber;
    mock_embedding_deterministic: z.ZodBoolean;
    accept_any_token: z.ZodBoolean;
    process_jobs_immediately: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    port: number;
    database_path: string;
    auto_seed: boolean;
    mock_llm_latency_ms: number;
    mock_embedding_deterministic: boolean;
    accept_any_token: boolean;
    process_jobs_immediately: boolean;
}, {
    port: number;
    database_path: string;
    auto_seed: boolean;
    mock_llm_latency_ms: number;
    mock_embedding_deterministic: boolean;
    accept_any_token: boolean;
    process_jobs_immediately: boolean;
}>;
/** Seed user for development */
interface SeedUser {
    id: string;
    email: string;
    tier: 'free' | 'credits' | 'pro';
}
declare const SeedUserSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    tier: z.ZodEnum<["free", "credits", "pro"]>;
}, "strip", z.ZodTypeAny, {
    id: string;
    tier: "free" | "credits" | "pro";
    email: string;
}, {
    id: string;
    tier: "free" | "credits" | "pro";
    email: string;
}>;
/** Seed data configuration */
interface SeedDataConfig {
    /** Pre-created users */
    users: SeedUser[];
    /** Number of sample nodes to create */
    node_count: number;
    /** Number of sample edges to create */
    edge_count: number;
}
declare const SeedDataConfigSchema: z.ZodObject<{
    users: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        email: z.ZodString;
        tier: z.ZodEnum<["free", "credits", "pro"]>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        tier: "free" | "credits" | "pro";
        email: string;
    }, {
        id: string;
        tier: "free" | "credits" | "pro";
        email: string;
    }>, "many">;
    node_count: z.ZodNumber;
    edge_count: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    users: {
        id: string;
        tier: "free" | "credits" | "pro";
        email: string;
    }[];
    node_count: number;
    edge_count: number;
}, {
    users: {
        id: string;
        tier: "free" | "credits" | "pro";
        email: string;
    }[];
    node_count: number;
    edge_count: number;
}>;
/** Configuration for mock LLM adapter */
interface MockLLMConfig {
    /** Simulated response latency */
    latencyMs: number;
    /** Whether to generate mock response content */
    mockResponses: boolean;
    /** Whether same input produces same output */
    deterministicOutputs: boolean;
}
declare const MockLLMConfigSchema: z.ZodObject<{
    latencyMs: z.ZodNumber;
    mockResponses: z.ZodBoolean;
    deterministicOutputs: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    latencyMs: number;
    mockResponses: boolean;
    deterministicOutputs: boolean;
}, {
    latencyMs: number;
    mockResponses: boolean;
    deterministicOutputs: boolean;
}>;
/** Configuration for mock embedding adapter */
interface MockEmbeddingConfig {
    /** Embedding vector dimensions */
    dimensions: number;
    /** Whether same input produces same embedding */
    deterministic: boolean;
}
declare const MockEmbeddingConfigSchema: z.ZodObject<{
    dimensions: z.ZodNumber;
    deterministic: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    dimensions: number;
    deterministic: boolean;
}, {
    dimensions: number;
    deterministic: boolean;
}>;
/** Configuration for mock job queue */
interface MockJobQueueConfig {
    /** Whether to process jobs immediately (inline) */
    processImmediately: boolean;
}
declare const MockJobQueueConfigSchema: z.ZodObject<{
    processImmediately: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    processImmediately: boolean;
}, {
    processImmediately: boolean;
}>;
/** Configuration for local auth adapter */
interface LocalAuthDevConfig {
    /** Pre-created users */
    users: SeedUser[];
    /** Whether to accept any token */
    acceptAnyToken: boolean;
}
declare const LocalAuthDevConfigSchema: z.ZodObject<{
    users: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        email: z.ZodString;
        tier: z.ZodEnum<["free", "credits", "pro"]>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        tier: "free" | "credits" | "pro";
        email: string;
    }, {
        id: string;
        tier: "free" | "credits" | "pro";
        email: string;
    }>, "many">;
    acceptAnyToken: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    users: {
        id: string;
        tier: "free" | "credits" | "pro";
        email: string;
    }[];
    acceptAnyToken: boolean;
}, {
    users: {
        id: string;
        tier: "free" | "credits" | "pro";
        email: string;
    }[];
    acceptAnyToken: boolean;
}>;

/**
 * @module @nous/core/backend
 * @description Adapter utilities — schema factories and adapter validation helpers
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Provides utility functions for working with adapter types:
 * - Generic schema factories for paginated results
 * - Adapter type validation helpers
 *
 * The adapter interfaces themselves are defined in types.ts.
 * This file provides runtime utilities for working with adapters.
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/adapter-interfaces.ts} - Spec
 */

/**
 * Create a Zod schema for PaginatedResult<T> with a given item schema.
 * Used to validate paginated responses from IDatabaseAdapter.
 *
 * @param itemSchema - Zod schema for the items in the result
 * @returns A Zod object schema for PaginatedResult<T>
 *
 * @example
 * ```typescript
 * const NodeResultSchema = createPaginatedResultSchema(z.record(z.unknown()));
 * const result = NodeResultSchema.parse({ items: [...], total: 10, has_more: false });
 * ```
 */
declare function createPaginatedResultSchema<T extends z.ZodType>(itemSchema: T): z.ZodObject<{
    items: z.ZodArray<T, "many">;
    total: z.ZodNumber;
    has_more: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    items: T["_output"][];
    total: number;
    has_more: boolean;
}, {
    items: T["_input"][];
    total: number;
    has_more: boolean;
}>;

/**
 * @module @nous/core/backend
 * @description Server configuration — route groups, middleware defaults, error handling, server factory
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Route group data, default middleware configuration, pure functions for
 * API error creation, route lookup, and auth requirement checks.
 * The createServer() stub requires a Hono framework implementation.
 *
 * Middleware application order: cors -> logging -> error -> auth -> rate_limit
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/server-config.ts} - Spec
 */

/**
 * All API route groups.
 * Each maps to a Hono sub-router via app.route(prefix, router).
 *
 * @see storm-026 spec/server-config.ts - ROUTE_GROUPS
 */
declare const ROUTE_GROUPS: readonly RouteGroup[];
/**
 * Default middleware configuration.
 * Production deployments should override corsOrigins in ServerConfig.
 *
 * @see storm-026 spec/server-config.ts - DEFAULT_MIDDLEWARE_CONFIG
 */
declare const DEFAULT_MIDDLEWARE_CONFIG: MiddlewareConfig;
/**
 * Create a structured API error response.
 *
 * @param code - Error code from ERROR_CODES (e.g., 'UNAUTHORIZED', 'NOT_FOUND')
 * @param message - Human-readable message
 * @param details - Optional additional details (only exposed in development)
 * @param request_id - Optional request tracking ID
 * @returns Structured ApiErrorResponse object
 */
declare function createApiError(code: string, message: string, details?: Record<string, unknown>, request_id?: string): ApiErrorResponse;
/**
 * Get the route group configuration for a prefix.
 *
 * @param prefix - Route prefix (e.g., '/v1/nodes')
 * @returns RouteGroup or undefined if not found
 */
declare function getRouteGroup(prefix: string): RouteGroup | undefined;
/**
 * Check if a path requires authentication.
 * Matches against ROUTE_GROUPS by prefix. If no matching group is found,
 * defaults to requiring auth (secure by default).
 *
 * @param path - Request path (e.g., '/v1/health', '/v1/nodes/abc')
 * @returns True if the path requires authentication
 */
declare function requiresAuth(path: string): boolean;
/**
 * Create a Hono server wired with all adapters.
 * Requires Hono framework.
 *
 * @param _config - Server configuration with all adapters
 * @returns A Hono app ready to serve requests
 */
declare function createServer(_config: ServerConfig): HonoApp;

/**
 * @module @nous/core/backend
 * @description Job system — tier assignments, job creation, expiration checks
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Job tier assignment data and pure functions for the three-tier execution model:
 *
 * ```
 * TIER 1: INLINE    (<50ms)   Classification, token validation
 * TIER 2: QUEUED    (<30s)    Embedding, dedup, edge inference
 * TIER 3: REGIONAL  (<10min)  Document processing, batch embed
 * ```
 *
 * Tier 1 jobs run inline in the request handler (no queue needed).
 * Tier 2 jobs go through Cloudflare Queues (cloud) or BullMQ (self-host).
 * Tier 3 jobs go through Fly.io Machines (cloud) or BullMQ (self-host).
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/job-system.ts} - Spec
 */

/**
 * Tier assignment for each job type.
 * Determines where each job runs and its execution constraints.
 *
 * @see storm-026 spec/job-system.ts - JOB_TIER_ASSIGNMENTS
 */
declare const JOB_TIER_ASSIGNMENTS: Record<JobType | CronJobType, JobTierConfig>;
/**
 * Get the execution tier for a job type.
 *
 * @param type - Job or cron job type
 * @returns The tier this job should run at ('inline' | 'queued' | 'regional')
 */
declare function getJobTierForType(type: JobType | CronJobType): JobTier;
/**
 * Get the full tier configuration for a job type.
 *
 * @param type - Job or cron job type
 * @returns Tier configuration including limits and retry settings
 */
declare function getJobTierConfig(type: JobType | CronJobType): JobTierConfig;
/**
 * Create a new job instance with a generated ID and timestamp.
 *
 * @param type - Job type
 * @param payload - Job-specific data
 * @param tenantId - Tenant the job belongs to
 * @param options - Optional priority and correlation ID
 * @returns A fully formed Job object ready for enqueue
 */
declare function createJob<T extends JobType>(type: T, payload: Record<string, unknown>, tenantId: string, options?: {
    priority?: JobPriority;
    correlationId?: string;
}): Job<T>;
/**
 * Check if a job has exceeded its tier's maximum duration.
 *
 * @param job - The job to check
 * @param startedAt - When the job started processing (ISO 8601)
 * @returns True if the job has exceeded its time limit
 */
declare function isJobExpired(job: Job<JobType | CronJobType>, startedAt: string): boolean;

/**
 * @module @nous/core/backend
 * @description Configuration schema — environment variable mapping, validation, config loading
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Environment variable mapping data, pure functions for Zod-validated
 * configuration, and the loadConfig() stub for application-level
 * environment reading.
 *
 * @example
 * ```typescript
 * // Validate raw config
 * const config = validateConfig(rawConfigObject);
 *
 * // Safe validation (no throw)
 * const result = safeValidateConfig(rawConfigObject);
 * if (result.success) {
 *   console.log(result.data.port);
 * }
 *
 * // Look up env var name
 * getEnvVarName('database.turso.url'); // 'TURSO_URL'
 * ```
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/config-schema.ts} - Spec
 */

/**
 * Maps configuration fields to environment variable names.
 * Used by loadConfig() to read from process.env.
 *
 * @see storm-026 spec/config-schema.ts - ENV_VAR_MAPPING
 */
declare const ENV_VAR_MAPPING: {
    readonly env: "NODE_ENV";
    readonly port: "PORT";
    readonly host: "HOST";
    readonly 'database.turso.url': "TURSO_URL";
    readonly 'database.turso.authToken': "TURSO_AUTH_TOKEN";
    readonly 'database.sqlite.path': "DATABASE_PATH";
    readonly 'auth.clerk.secretKey': "CLERK_SECRET_KEY";
    readonly 'auth.clerk.publishableKey': "CLERK_PUBLISHABLE_KEY";
    readonly 'auth.local.jwtSecret': "JWT_SECRET";
    readonly 'llm.openai.apiKey': "OPENAI_API_KEY";
    readonly 'llm.anthropic.apiKey': "ANTHROPIC_API_KEY";
    readonly 'llm.google.apiKey': "GOOGLE_API_KEY";
    readonly 'jobs.bullmq.redisUrl': "REDIS_URL";
    readonly 'observability.sentryDsn': "SENTRY_DSN";
    readonly 'observability.logLevel': "LOG_LEVEL";
};
/**
 * Validate a raw configuration object against the NousConfigSchema.
 * Throws a ZodError if validation fails -- use for fail-fast startup.
 *
 * @param raw - Raw configuration (e.g., from environment)
 * @returns Validated NousConfig
 * @throws ZodError if validation fails
 */
declare function validateConfig(raw: unknown): NousConfig;
/**
 * Safely validate configuration without throwing.
 * Returns a Zod SafeParseReturnType with either data or error details.
 *
 * @param raw - Raw configuration
 * @returns Success result with data, or error result with issues
 */
declare function safeValidateConfig(raw: unknown): z.SafeParseReturnType<unknown, NousConfig>;
/**
 * Get the environment variable name for a config field path.
 *
 * @param configPath - Dot-separated config path (e.g., 'database.turso.url')
 * @returns Environment variable name or undefined if not mapped
 */
declare function getEnvVarName(configPath: string): string | undefined;
/**
 * Load configuration from environment variables.
 * Reads process.env, maps to config schema, and validates.
 * Exits with error message if validation fails.
 *
 * This must be implemented at the application level where process.env
 * (or platform-specific env access) is available.
 *
 * @returns Validated NousConfig
 */
declare function loadConfig(): NousConfig;

/**
 * @module @nous/core/backend
 * @description Deployment configuration — targets, decision matrix, self-hosting, Docker Compose
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Deployment decision matrix data, self-hosting defaults, Docker service
 * definitions, and pure functions for deployment scenario lookups.
 *
 * | Scenario          | API                | Jobs       | Database | Auth   |
 * |-------------------|--------------------|------------|----------|--------|
 * | Nous Cloud        | Cloudflare Workers | Cloudflare | Turso    | Clerk  |
 * | Self-Host (Small) | Docker (Bun)       | Memory     | SQLite   | Local  |
 * | Self-Host (Scale) | Docker (multiple)  | BullMQ     | SQLite   | Local  |
 * | Enterprise        | Docker/K8s         | BullMQ     | SQLite   | Local  |
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/deployment.ts} - Spec
 */

/**
 * Deployment decision matrix.
 * Maps named scenarios to their infrastructure choices.
 *
 * @see storm-026 spec/deployment.ts - DEPLOYMENT_MATRIX
 */
declare const DEPLOYMENT_MATRIX: Record<DeploymentScenario, DeploymentMatrixEntry>;
/**
 * Default self-hosting configuration with system requirements.
 *
 * @see storm-026 spec/deployment.ts - DEFAULT_SELF_HOST_CONFIG
 */
declare const DEFAULT_SELF_HOST_CONFIG: SelfHostConfig;
/**
 * Docker Compose service definitions for self-hosting.
 * These define the three services in the self-host stack.
 *
 * @see storm-026 spec/deployment.ts - DOCKER_SERVICES
 */
declare const DOCKER_SERVICES: readonly DockerServiceConfig[];
/**
 * Get deployment configuration for a named scenario.
 *
 * @param scenario - Named deployment scenario
 * @returns Deployment matrix entry with all infrastructure choices
 */
declare function getDeploymentConfig(scenario: DeploymentScenario): DeploymentMatrixEntry;
/**
 * Get self-hosting system requirements.
 *
 * @returns Self-host configuration with required env vars, RAM, and volumes
 */
declare function getSelfHostRequirements(): SelfHostConfig;
/**
 * Get Docker Compose service definitions for a scenario.
 * Small deployments get only the API service (in-process jobs, no Redis).
 * Scale and enterprise deployments get the full stack (api + jobs + redis).
 *
 * @param scenario - Deployment scenario
 * @returns Array of Docker service configurations
 */
declare function getDockerServices(scenario: DeploymentScenario): readonly DockerServiceConfig[];
/**
 * Check if a scenario requires Redis.
 * Only BullMQ-based job queues need Redis.
 *
 * @param scenario - Deployment scenario
 * @returns True if Redis is needed
 */
declare function requiresRedis(scenario: DeploymentScenario): boolean;

/**
 * @module @nous/core/backend
 * @description Health checks — service health monitoring and readiness probes
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Pure functions for health status aggregation, HTTP status mapping,
 * and external stubs for adapter health probing.
 *
 * The /v1/health endpoint pings all adapters and aggregates their status:
 * - healthy: All services responding
 * - degraded: Some services failing (returns 503)
 * - unhealthy: Critical services down (returns 503)
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/health-checks.ts} - Spec
 */

/**
 * Check if all services in a health response are healthy.
 * @param response - Health check response
 * @returns True if every service is 'healthy'
 */
declare function isAllHealthy(response: HealthCheckResponse): boolean;
/**
 * Determine the overall health status from individual service statuses.
 * @param services - Map of service name to health status
 * @returns Overall system status
 */
declare function determineOverallHealth(services: Record<string, ServiceHealth>): HealthStatus;
/**
 * Get the HTTP status code for a health status.
 * - healthy → 200
 * - degraded → 503
 * - unhealthy → 503
 */
declare function getHttpStatusForHealth(status: HealthStatus): number;
/**
 * Check health of all services by pinging their adapters.
 * Requires actual adapter instances.
 *
 * @param _config - Server configuration with adapter references
 * @returns Health check response
 */
declare function checkAllServices(_config: unknown): Promise<HealthCheckResponse>;
/**
 * Check health of a single service.
 * @param _service - Service name
 * @param _adapter - Adapter with ping() method
 * @returns Service health result
 */
declare function checkServiceHealth(_service: string, _adapter: {
    ping(): Promise<boolean>;
}): Promise<ServiceHealth>;

/**
 * @module @nous/core/backend
 * @description Observability -- structured logging, metrics, request context tracking
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Defines structured logging format, metrics configuration, and
 * request context tracking for the Nous backend.
 *
 * Observability stack:
 * - Structured JSON logging (all environments)
 * - Sentry error tracking (production)
 * - Request correlation via requestId
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/observability.ts} - Spec
 */

/** Default metrics configuration (all enabled) */
declare const DEFAULT_METRICS_CONFIG: MetricsConfig;
/**
 * Create a new request context with a unique ID.
 * Generates a request ID using timestamp + random suffix for uniqueness.
 * @returns Fresh request context with requestId and startTime set
 */
declare function createRequestContext(): RequestContext;
/**
 * Format a structured log entry as a JSON string.
 * Used by the logging middleware to emit structured logs.
 * @param entry - Log entry to format
 * @returns JSON string representation of the log entry
 */
declare function formatLogEntry(entry: StructuredLogEntry): string;
/**
 * Calculate request duration from context.
 * @param context - Request context with start time
 * @returns Duration in milliseconds since the request started
 */
declare function calculateRequestDuration(context: RequestContext): number;
/**
 * Check if a log level should be emitted given the configured minimum.
 * Uses ordered severity comparison: debug < info < warn < error < fatal.
 * @param level - Log level to check
 * @param minLevel - Minimum configured log level
 * @returns True if the level should be logged
 */
declare function shouldLog(level: LogLevel, minLevel: LogLevel): boolean;

/**
 * @module @nous/core/backend
 * @description SSE streaming -- event formatting, reconnection, edge timeout strategy
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Server-Sent Events (SSE) streaming utilities for the Nous API.
 * Handles Cloudflare Workers' 30-second connection limit by:
 * 1. Capping streams at 25 seconds
 * 2. Sending timeout events with last event ID
 * 3. Supporting client reconnection via Last-Event-ID header
 * 4. Sending heartbeat pings every 15 seconds to keep connections alive
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/sse-streaming.ts} - Spec
 */

/** Default SSE options */
declare const DEFAULT_SSE_OPTIONS: Required<SSEOptions>;
/**
 * Format an SSE event as a string for the wire protocol.
 * Produces the standard SSE text format with event, optional id, and data fields.
 *
 * @example
 * formatSSEEvent({ event: 'data', id: '1', data: '{"token":"hello"}' })
 * // => 'event: data\nid: 1\ndata: {"token":"hello"}\n\n'
 *
 * @param event - SSE event to format
 * @returns Wire-format string ready to be written to the response stream
 */
declare function formatSSEEvent(event: SSEEvent): string;
/**
 * Parse the Last-Event-ID header for reconnection.
 * Returns undefined for empty or missing header values.
 * @param header - Value of the Last-Event-ID header
 * @returns The trimmed event ID string, or undefined if not present
 */
declare function parseLastEventId(header: string | undefined): string | undefined;
/**
 * Create initial SSE stream state.
 * Initializes event counter at 0, records start time, and parses
 * the Last-Event-ID header for reconnection support.
 * @param lastEventIdHeader - Value of Last-Event-ID header (for reconnection)
 * @returns Initial stream state
 */
declare function createSSEStreamState(lastEventIdHeader?: string): SSEStreamState;
/**
 * Check if an SSE stream has exceeded its maximum duration.
 * Used to proactively close streams before Cloudflare's 30s limit.
 * @param state - Current stream state
 * @param maxDurationMs - Maximum duration in milliseconds
 * @returns True if the stream should be closed
 */
declare function isStreamExpired(state: SSEStreamState, maxDurationMs: number): boolean;
/**
 * Create an SSE stream response.
 * Requires Hono's streamSSE utility for actual implementation.
 *
 * @param _context - Hono request context
 * @param _generator - Async generator producing stream chunks
 * @param _options - SSE configuration options
 * @returns HTTP Response with SSE content type
 */
declare function createSSEStream(_context: unknown, _generator: AsyncGenerator<unknown>, _options?: SSEOptions): Promise<Response>;

/**
 * @module @nous/core/backend
 * @description Local development -- mock adapter configs, seed data, dev server setup
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Defines configuration for local development mode.
 * Goal: `npm run dev` starts everything with zero external dependencies.
 *
 * - SQLite file for persistence (no Turso needed)
 * - Mock LLM adapter (no API keys needed)
 * - Mock embedding adapter (deterministic outputs)
 * - Local auth (any token accepted)
 * - In-memory job queue (process immediately)
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/local-dev.ts} - Spec
 */

/** Default local development configuration */
declare const DEFAULT_LOCAL_DEV_CONFIG: LocalDevConfig;
/** Default development user */
declare const DEV_USER: SeedUser;
/** Default seed data configuration */
declare const DEFAULT_SEED_DATA: SeedDataConfig;
/**
 * Get default local development configuration.
 * Returns a shallow copy to prevent mutation of the default config.
 * @returns LocalDevConfig with sensible defaults
 */
declare function getLocalDevConfig(): LocalDevConfig;
/**
 * Get default seed users.
 * Returns a new array with a shallow copy of the dev user.
 * @returns Array of seed users (currently just the dev user)
 */
declare function getDefaultSeedUsers(): SeedUser[];
/**
 * Get default mock adapter configurations.
 * Returns configurations for all mock adapters used in local development:
 * LLM, embedding, job queue, and auth.
 * @returns Configurations for all mock adapters
 */
declare function getMockAdapterConfigs(): {
    llm: MockLLMConfig;
    embedding: MockEmbeddingConfig;
    jobs: MockJobQueueConfig;
    auth: LocalAuthDevConfig;
};

export { API_BASE_PATH, API_VERSION, AUTH_ADAPTER_TYPES, AUTH_EXEMPT_PATHS, type AdapterApiKeyResult, AdapterApiKeyResultSchema, type AdapterAuthResult, AdapterAuthResultSchema, type AdapterConflict, AdapterConflictSchema, type AdapterCostEstimate, AdapterCostEstimateSchema, type AdapterMessage, AdapterMessageSchema, type AdapterTokenPair, AdapterTokenPairSchema, type AdapterTokenUsage, AdapterTokenUsageSchema, type AdapterTransaction, type AdapterUser, AdapterUserSchema, type ApiErrorResponse, ApiErrorResponseSchema, type AppliedChange, AppliedChangeSchema, type ApplyResult, ApplyResultSchema, type AuthAdapterType, type AuthConfig, AuthConfigSchema, type AuthMiddlewareConfig, AuthMiddlewareConfigSchema, type BullMQJobsConfig, BullMQJobsConfigSchema, type CORSConfig, CORSConfigSchema, CRON_JOB_TYPES, type Change, ChangeSchema, type ChangeSet, ChangeSetSchema, type ChatStreamChunk, ChatStreamChunkSchema, type ClerkAuthConfig, ClerkAuthConfigSchema, type CloudflareJobsConfig, CloudflareJobsConfigSchema, type CompletionChunk, CompletionChunkSchema, type CompletionRequest, CompletionRequestSchema, type CompletionResponse, CompletionResponseSchema, type CronJobType, DATABASE_ADAPTER_TYPES, DEFAULT_CORS_ORIGINS, DEFAULT_HOST, DEFAULT_JOB_RETRY_COUNT, DEFAULT_JOB_RETRY_DELAY_MS, DEFAULT_LOCAL_DEV_CONFIG, DEFAULT_LOG_LEVEL, DEFAULT_METRICS_CONFIG, DEFAULT_MIDDLEWARE_CONFIG, DEFAULT_PORT, DEFAULT_RATE_LIMIT_RPM, DEFAULT_SEED_DATA, DEFAULT_SELF_HOST_CONFIG, DEFAULT_SSE_OPTIONS, DEPLOYMENT_ENVIRONMENTS, DEPLOYMENT_MATRIX, DEPLOYMENT_SCENARIOS, DEPLOYMENT_TARGETS, DEV_USER, DOCKER_SERVICES, type DatabaseAdapterType, type DatabaseConfig, DatabaseConfigSchema, type DeploymentEnvironment, type DeploymentMatrixEntry, DeploymentMatrixEntrySchema, type DeploymentScenario, type DeploymentTarget, type DockerServiceConfig, DockerServiceConfigSchema, EMBEDDING_ADAPTER_TYPES, ENV_VAR_MAPPING, ERROR_CODES, type EmbeddingAdapterType, type ErrorCode, type ErrorMiddlewareConfig, ErrorMiddlewareConfigSchema, type FailedJob, FailedJobSchema, HEALTH_CHECK_SERVICES, HEALTH_CHECK_TIMEOUT_MS, HEALTH_STATUSES, type HealthCheckResponse, HealthCheckResponseSchema, type HealthCheckService, type HealthMetrics, HealthMetricsSchema, type HealthStatus, type HonoApp, type HybridSearchOptions, HybridSearchOptionsSchema, type IAuthAdapter, type IDatabaseAdapter, type IDatabaseFactory, type IEmbeddingAdapter, type IJobQueueAdapter, type ILLMAdapter, type IStorageAdapter, JOB_PRIORITIES, JOB_QUEUE_ADAPTER_TYPES, JOB_TIERS, JOB_TIER_ASSIGNMENTS, JOB_TIER_LIMITS, JOB_TYPES, type Job, type JobEvent, JobEventSchema, type JobHandler, type JobMetrics, JobMetricsSchema, type JobPriority, type JobQueueAdapterType, JobSchema, type JobTier, type JobTierConfig, JobTierConfigSchema, type JobType, type JobsConfig, JobsConfigSchema, type LLMAdapterType, type LLMConfig, LLMConfigSchema, LLM_ADAPTER_TYPES, LOG_LEVELS, type ListOptions, ListOptionsSchema, type LocalAuthConfig, LocalAuthConfigSchema, type LocalAuthDevConfig, LocalAuthDevConfigSchema, type LocalDevConfig, LocalDevConfigSchema, type LogLevel, type LoggingMiddlewareConfig, LoggingMiddlewareConfigSchema, MIDDLEWARE_ORDER, MIDDLEWARE_TYPES, type MemoryJobsConfig, MemoryJobsConfigSchema, type MetricsConfig, MetricsConfigSchema, type MiddlewareConfig, MiddlewareConfigSchema, type MiddlewareType, type MockEmbeddingConfig, MockEmbeddingConfigSchema, type MockJobQueueConfig, MockJobQueueConfigSchema, type MockLLMConfig, MockLLMConfigSchema, type NousConfig, NousConfigSchema, type ObservabilityConfig, ObservabilityConfigSchema, type PaginatedResult, QUEUED_JOB_TYPES, RATE_LIMIT_WINDOW_MS, REGIONAL_JOB_TYPES, ROUTE_GROUPS, ROUTE_PREFIXES, type ReadinessCheck, ReadinessCheckSchema, type RequestContext, RequestContextSchema, type RouteGroup, RouteGroupSchema, SENTRY_TRACES_SAMPLE_RATE, type SSEEvent, SSEEventSchema, type SSEEventType, type SSEOptions, SSEOptionsSchema, type SSEStreamState, SSEStreamStateSchema, SSE_EVENT_TYPES, SSE_HEARTBEAT_INTERVAL_MS, SSE_MAX_DURATION_MS, SSE_RECONNECT_DEFAULT, STORAGE_ADAPTER_TYPES, type SearchResult, SearchResultSchema, type SeedDataConfig, SeedDataConfigSchema, type SeedUser, SeedUserSchema, type SelfHostConfig, SelfHostConfigSchema, type SentryConfig, SentryConfigSchema, type ServerConfig, type ServerRateLimitConfig, ServerRateLimitConfigSchema, type ServiceHealth, ServiceHealthSchema, type SqliteDatabaseConfig, SqliteDatabaseConfigSchema, type StorageAdapterType, type StructuredLogEntry, StructuredLogEntrySchema, type TextSearchOptions, TextSearchOptionsSchema, type TursoDatabaseConfig, TursoDatabaseConfigSchema, type UsageCallback, type UsageReport, UsageReportSchema, type VectorSearchOptions, VectorSearchOptionsSchema, calculateRequestDuration, checkAllServices, checkServiceHealth, createApiError, createJob, createPaginatedResultSchema, createRequestContext, createSSEStream, createSSEStreamState, createServer, determineOverallHealth, formatLogEntry, formatSSEEvent, getDefaultSeedUsers, getDeploymentConfig, getDockerServices, getEnvVarName, getHttpStatusForHealth, getJobTierConfig, getJobTierForType, getLocalDevConfig, getMockAdapterConfigs, getRouteGroup, getSelfHostRequirements, isAllHealthy, isCronJobType, isDeploymentEnvironment, isDeploymentScenario, isDeploymentTarget, isHealthStatus, isJobExpired, isJobTier, isJobType, isLogLevel, isSSEEventType, isStreamExpired, loadConfig, parseLastEventId, requiresAuth, requiresRedis, safeValidateConfig, shouldLog, validateConfig };
