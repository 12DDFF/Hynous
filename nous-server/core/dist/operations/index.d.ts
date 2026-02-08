import { z } from 'zod';

/**
 * @module @nous/core/operations
 * @description Constants for Nous Backend Operations System (NBOS) - storm-034
 * @version 1.0.0
 *
 * Three integrated subsystems:
 * 1. Job Scheduling (14 jobs: J-001 to J-014)
 * 2. Error Handling (30 codes: E1xx-E6xx)
 * 3. Caching Architecture (6 types, multi-tier L1/L2/L3)
 *
 * IMPORTANT: OPS_ERROR_CODES are OPERATIONAL codes (E1xx-E6xx).
 * API error codes live in storm-026 (ERROR_CODES) and storm-023 (API_ERROR_CODES).
 */
declare const NBOS_JOB_IDS: readonly ["J-001", "J-002", "J-003", "J-004", "J-005", "J-006", "J-007", "J-008", "J-009", "J-010", "J-011", "J-012", "J-013", "J-014"];
type NBOSJobId = typeof NBOS_JOB_IDS[number];
declare const NBOS_JOB_NAMES: Record<NBOSJobId, string>;
declare const NBOS_JOB_NAME_VALUES: readonly ["decay-cycle", "compression-run", "cleanup-dormant", "similarity-batch", "accessibility-audit", "embed-single", "embed-batch", "infer-edges", "deduplicate", "sync-retry", "cache-warm", "metrics-collect", "embedding-backfill", "dlq-process"];
type NBOSJobName = typeof NBOS_JOB_NAME_VALUES[number];
declare const NBOS_CRON_SCHEDULES: Partial<Record<NBOSJobId, string>>;
declare const JOB_TRIGGER_TYPES: readonly ["cron", "event", "manual", "retry"];
type JobTriggerType = typeof JOB_TRIGGER_TYPES[number];
declare const NBOS_CRON_JOBS: readonly NBOSJobId[];
declare const NBOS_EVENT_JOBS: readonly NBOSJobId[];
declare const NBOS_BATCH_SIZES: Record<NBOSJobId, number | null>;
declare const NBOS_TIMEOUTS: Record<NBOSJobId, number>;
declare const NBOS_CONCURRENCY: Record<NBOSJobId, number>;
declare const NBOS_JOB_PRIORITIES: Record<NBOSJobId, 'high' | 'normal' | 'low'>;
declare const NBOS_JOB_DEPENDENCIES: Partial<Record<NBOSJobId, readonly NBOSJobId[]>>;
declare const DAILY_CHAIN_ORDER: readonly NBOSJobId[];
declare const BACKOFF_STRATEGIES: readonly ["exponential", "linear", "fixed"];
type BackoffStrategy = typeof BACKOFF_STRATEGIES[number];
declare const JOB_FAILURE_CONFIGS: Record<string, {
    readonly retries: number;
    readonly backoff: BackoffStrategy;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    readonly deadLetterAfter: number;
    readonly alertAfter: number;
    readonly userNotify: boolean;
    readonly notifyChannel: 'toast' | 'banner' | 'push' | 'none';
}>;
declare const OPS_ERROR_CATEGORIES: readonly ["transient", "rate_limited", "permanent", "user_error", "system_error"];
type OpsErrorCategory = typeof OPS_ERROR_CATEGORIES[number];
declare const NOTIFY_CHANNELS: readonly ["toast", "banner", "push", "none"];
type NotifyChannel = typeof NOTIFY_CHANNELS[number];
declare const NOTIFY_PRIORITIES: readonly ["immediate", "next_session", "digest"];
type NotifyPriority = typeof NOTIFY_PRIORITIES[number];
declare const OPS_ERROR_CODES: {
    readonly E100: {
        readonly code: "E100";
        readonly category: "transient";
        readonly message: "LLM request timeout";
        readonly userMessage: "AI is thinking... please wait";
        readonly retryable: true;
        readonly notifyChannel: "toast";
    };
    readonly E101: {
        readonly code: "E101";
        readonly category: "rate_limited";
        readonly message: "LLM rate limit exceeded";
        readonly userMessage: "High demand, retrying shortly";
        readonly retryable: true;
        readonly retryAfter: 60000;
        readonly notifyChannel: "toast";
    };
    readonly E102: {
        readonly code: "E102";
        readonly category: "permanent";
        readonly message: "LLM content policy violation";
        readonly userMessage: "Content cannot be processed";
        readonly retryable: false;
        readonly notifyChannel: "banner";
    };
    readonly E103: {
        readonly code: "E103";
        readonly category: "transient";
        readonly message: "LLM service unavailable";
        readonly userMessage: "AI temporarily unavailable";
        readonly retryable: true;
        readonly notifyChannel: "toast";
    };
    readonly E104: {
        readonly code: "E104";
        readonly category: "permanent";
        readonly message: "LLM context too long";
        readonly userMessage: "Content too large, try splitting";
        readonly retryable: false;
        readonly notifyChannel: "banner";
    };
    readonly E200: {
        readonly code: "E200";
        readonly category: "transient";
        readonly message: "Embedding request timeout";
        readonly userMessage: "Processing delayed";
        readonly retryable: true;
        readonly notifyChannel: "toast";
    };
    readonly E201: {
        readonly code: "E201";
        readonly category: "rate_limited";
        readonly message: "Embedding rate limit";
        readonly userMessage: "Queued for processing";
        readonly retryable: true;
        readonly retryAfter: 30000;
        readonly notifyChannel: "none";
    };
    readonly E202: {
        readonly code: "E202";
        readonly category: "permanent";
        readonly message: "Content cannot be embedded";
        readonly userMessage: "Content format not supported";
        readonly retryable: false;
        readonly notifyChannel: "banner";
    };
    readonly E203: {
        readonly code: "E203";
        readonly category: "transient";
        readonly message: "Embedding service unavailable";
        readonly userMessage: "Search temporarily limited";
        readonly retryable: true;
        readonly notifyChannel: "toast";
    };
    readonly E300: {
        readonly code: "E300";
        readonly category: "transient";
        readonly message: "Database connection timeout";
        readonly userMessage: "Saving...";
        readonly retryable: true;
        readonly notifyChannel: "none";
    };
    readonly E301: {
        readonly code: "E301";
        readonly category: "transient";
        readonly message: "Database write conflict";
        readonly userMessage: "Syncing changes...";
        readonly retryable: true;
        readonly notifyChannel: "toast";
    };
    readonly E302: {
        readonly code: "E302";
        readonly category: "permanent";
        readonly message: "Database constraint violation";
        readonly userMessage: "Could not save, check for duplicates";
        readonly retryable: false;
        readonly notifyChannel: "banner";
    };
    readonly E303: {
        readonly code: "E303";
        readonly category: "system_error";
        readonly message: "Database connection failed";
        readonly userMessage: "Connection issue, saved locally";
        readonly retryable: true;
        readonly notifyChannel: "banner";
    };
    readonly E304: {
        readonly code: "E304";
        readonly category: "permanent";
        readonly message: "Storage quota exceeded";
        readonly userMessage: "Storage full, upgrade or delete content";
        readonly retryable: false;
        readonly notifyChannel: "push";
    };
    readonly E400: {
        readonly code: "E400";
        readonly category: "transient";
        readonly message: "Sync connection failed";
        readonly userMessage: "Offline mode, will sync later";
        readonly retryable: true;
        readonly notifyChannel: "banner";
    };
    readonly E401: {
        readonly code: "E401";
        readonly category: "transient";
        readonly message: "Sync conflict detected";
        readonly userMessage: "Resolving changes...";
        readonly retryable: true;
        readonly notifyChannel: "toast";
    };
    readonly E402: {
        readonly code: "E402";
        readonly category: "user_error";
        readonly message: "Sync conflict requires resolution";
        readonly userMessage: "Please choose which version to keep";
        readonly retryable: false;
        readonly notifyChannel: "banner";
    };
    readonly E403: {
        readonly code: "E403";
        readonly category: "permanent";
        readonly message: "Sync version mismatch";
        readonly userMessage: "Please refresh the app";
        readonly retryable: false;
        readonly notifyChannel: "banner";
    };
    readonly E404: {
        readonly code: "E404";
        readonly category: "transient";
        readonly message: "Sync server unavailable";
        readonly userMessage: "Sync paused, will resume";
        readonly retryable: true;
        readonly notifyChannel: "banner";
    };
    readonly E500: {
        readonly code: "E500";
        readonly category: "transient";
        readonly message: "Auth token expired";
        readonly userMessage: "";
        readonly retryable: true;
        readonly notifyChannel: "none";
    };
    readonly E501: {
        readonly code: "E501";
        readonly category: "permanent";
        readonly message: "Auth token invalid";
        readonly userMessage: "Please sign in again";
        readonly retryable: false;
        readonly notifyChannel: "banner";
    };
    readonly E502: {
        readonly code: "E502";
        readonly category: "permanent";
        readonly message: "Account suspended";
        readonly userMessage: "Account issue, contact support";
        readonly retryable: false;
        readonly notifyChannel: "push";
    };
    readonly E503: {
        readonly code: "E503";
        readonly category: "user_error";
        readonly message: "Subscription expired";
        readonly userMessage: "Subscription ended, renew to continue";
        readonly retryable: false;
        readonly notifyChannel: "push";
    };
    readonly E600: {
        readonly code: "E600";
        readonly category: "transient";
        readonly message: "Network request timeout";
        readonly userMessage: "Slow connection, retrying...";
        readonly retryable: true;
        readonly notifyChannel: "toast";
    };
    readonly E601: {
        readonly code: "E601";
        readonly category: "transient";
        readonly message: "Network offline";
        readonly userMessage: "Offline mode active";
        readonly retryable: true;
        readonly notifyChannel: "banner";
    };
    readonly E602: {
        readonly code: "E602";
        readonly category: "transient";
        readonly message: "DNS resolution failed";
        readonly userMessage: "Connection issue";
        readonly retryable: true;
        readonly notifyChannel: "toast";
    };
    readonly E603: {
        readonly code: "E603";
        readonly category: "transient";
        readonly message: "SSL/TLS error";
        readonly userMessage: "Secure connection failed";
        readonly retryable: true;
        readonly notifyChannel: "banner";
    };
};
type OpsErrorCode = keyof typeof OPS_ERROR_CODES;
declare const OPS_ERROR_CODE_KEYS: readonly OpsErrorCode[];
declare const OPS_ERROR_GROUPS: readonly ["llm", "embedding", "database", "sync", "auth", "network"];
type OpsErrorGroup = typeof OPS_ERROR_GROUPS[number];
declare const ERROR_GROUP_PREFIXES: Record<string, OpsErrorGroup>;
declare const NOTIFICATION_STRATEGY_TYPES: readonly ["transient_error", "sync_failed", "storage_full", "offline", "online", "conflict", "auth_expired"];
type NotificationStrategyType = typeof NOTIFICATION_STRATEGY_TYPES[number];
declare const NOTIFICATION_STRATEGY: Record<NotificationStrategyType, {
    readonly channel: NotifyChannel;
    readonly priority: NotifyPriority;
    readonly autoDismissMs?: number;
    readonly action?: {
        readonly label: string;
        readonly handler: string;
    };
}>;
declare const CACHE_TYPES: readonly ["embedding", "llm_response", "node", "search_result", "edge", "session"];
type CacheType = typeof CACHE_TYPES[number];
declare const CACHE_STORAGE_TIERS: readonly ["memory", "redis", "sqlite"];
type CacheStorageTier = typeof CACHE_STORAGE_TIERS[number];
declare const EVICTION_POLICIES: readonly ["lru", "lfu", "ttl"];
type EvictionPolicy = typeof EVICTION_POLICIES[number];
declare const CACHE_WARM_STRATEGIES: readonly ["recent", "frequent", "connected", "none"];
type CacheWarmStrategy = typeof CACHE_WARM_STRATEGIES[number];
declare const CACHE_CONFIGS: Record<CacheType, {
    readonly primaryStorage: CacheStorageTier;
    readonly fallbackStorage?: CacheStorageTier;
    readonly ttlSeconds: number;
    readonly maxItems: number;
    readonly maxBytes?: number;
    readonly evictionPolicy: EvictionPolicy;
    readonly warmStrategy: CacheWarmStrategy;
}>;
declare const NETWORK_STATUSES: readonly ["online", "offline", "unknown"];
type NetworkStatus = typeof NETWORK_STATUSES[number];
declare const NETWORK_MONITOR_CONFIG: {
    readonly checkIntervalMs: 30000;
    readonly offlineThreshold: 3;
    readonly onlineThreshold: 1;
    readonly endpoints: readonly string[];
    readonly timeoutMs: 5000;
};
declare const OFFLINE_QUEUE_OP_TYPES: readonly ["sync", "embed", "edge", "other"];
type OfflineQueueOpType = typeof OFFLINE_QUEUE_OP_TYPES[number];
declare const OFFLINE_QUEUE_CONFIG: {
    readonly storage: "sqlite";
    readonly tableName: "offline_queue";
    readonly maxItemsPerTenant: 1000;
    readonly maxAgeHours: 168;
    readonly priorityOrder: readonly OfflineQueueOpType[];
    readonly onFull: "drop_oldest";
};
declare const OFFLINE_QUEUE_OVERFLOW: readonly ["drop_oldest", "reject_new"];
type OfflineQueueOverflow = typeof OFFLINE_QUEUE_OVERFLOW[number];
declare const DEGRADABLE_SERVICES: readonly ["redis", "openai_embedding", "openai_llm", "turso_cloud", "inngest", "network"];
type DegradableService = typeof DEGRADABLE_SERVICES[number];
declare const DEGRADATION_MATRIX: Record<DegradableService, {
    readonly impact: string;
    readonly fallback: string;
}>;
declare const METRIC_TYPES: readonly ["queue-depth", "cache-hit-rate", "error-rate", "sync-latency"];
type MetricType = typeof METRIC_TYPES[number];
declare function isNBOSJobId(value: string): value is NBOSJobId;
declare function isNBOSJobName(value: string): value is NBOSJobName;
declare function isJobTriggerType(value: string): value is JobTriggerType;
declare function isOpsErrorCategory(value: string): value is OpsErrorCategory;
declare function isOpsErrorCode(value: string): value is OpsErrorCode;
declare function isNotifyChannel(value: string): value is NotifyChannel;
declare function isNotifyPriority(value: string): value is NotifyPriority;
declare function isCacheType(value: string): value is CacheType;
declare function isCacheStorageTier(value: string): value is CacheStorageTier;
declare function isEvictionPolicy(value: string): value is EvictionPolicy;
declare function isCacheWarmStrategy(value: string): value is CacheWarmStrategy;
declare function isNetworkStatus(value: string): value is NetworkStatus;
declare function isOfflineQueueOpType(value: string): value is OfflineQueueOpType;
declare function isDegradableService(value: string): value is DegradableService;
declare function isMetricType(value: string): value is MetricType;
declare function isBackoffStrategy(value: string): value is BackoffStrategy;
declare function isNotificationStrategyType(value: string): value is NotificationStrategyType;
declare function isOpsErrorGroup(value: string): value is OpsErrorGroup;

/**
 * @module @nous/core/operations
 * @description Types and Zod schemas for NBOS - storm-034
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-034
 * @storm Brainstorms/Infrastructure/storm-034-backend-operations
 *
 * All interfaces have corresponding Zod schemas for runtime validation.
 * Discriminated unions use the `type` field for job payload discrimination.
 */

/** Base fields shared by all 14 job payloads. */
interface BaseJobPayload {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: JobTriggerType;
}
declare const BaseJobPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
}>;
/** J-001: Decay Cycle */
interface DecayCyclePayload extends BaseJobPayload {
    type: 'decay-cycle';
    batchSize: number;
    offset?: number;
}
declare const DecayCyclePayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"decay-cycle">;
    batchSize: z.ZodNumber;
    offset: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "decay-cycle";
    batchSize: number;
    offset?: number | undefined;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "decay-cycle";
    batchSize: number;
    offset?: number | undefined;
}>;
/** J-002: Compression Run */
interface CompressionRunPayload extends BaseJobPayload {
    type: 'compression-run';
    clusterId?: string;
    dryRun?: boolean;
}
declare const CompressionRunPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"compression-run">;
    clusterId: z.ZodOptional<z.ZodString>;
    dryRun: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "compression-run";
    clusterId?: string | undefined;
    dryRun?: boolean | undefined;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "compression-run";
    clusterId?: string | undefined;
    dryRun?: boolean | undefined;
}>;
/** J-003: Cleanup Dormant */
interface CleanupDormantPayload extends BaseJobPayload {
    type: 'cleanup-dormant';
    dormantDays: number;
    action: 'archive' | 'notify' | 'delete';
}
declare const CleanupDormantPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"cleanup-dormant">;
    dormantDays: z.ZodNumber;
    action: z.ZodEnum<["archive", "notify", "delete"]>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "cleanup-dormant";
    dormantDays: number;
    action: "archive" | "notify" | "delete";
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "cleanup-dormant";
    dormantDays: number;
    action: "archive" | "notify" | "delete";
}>;
/** J-004: Similarity Batch */
interface SimilarityBatchPayload extends BaseJobPayload {
    type: 'similarity-batch';
    sinceTimestamp?: string;
    threshold: number;
}
declare const SimilarityBatchPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"similarity-batch">;
    sinceTimestamp: z.ZodOptional<z.ZodString>;
    threshold: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "similarity-batch";
    threshold: number;
    sinceTimestamp?: string | undefined;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "similarity-batch";
    threshold: number;
    sinceTimestamp?: string | undefined;
}>;
/** J-005: Accessibility Audit */
interface AccessibilityAuditPayload extends BaseJobPayload {
    type: 'accessibility-audit';
    notifyUser: boolean;
}
declare const AccessibilityAuditPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"accessibility-audit">;
    notifyUser: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "accessibility-audit";
    notifyUser: boolean;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "accessibility-audit";
    notifyUser: boolean;
}>;
/** J-006: Embed Single */
interface EmbedSinglePayload extends BaseJobPayload {
    type: 'embed-single';
    nodeId: string;
    content: string;
    priority: 'high' | 'normal' | 'low';
}
declare const EmbedSinglePayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"embed-single">;
    nodeId: z.ZodString;
    content: z.ZodString;
    priority: z.ZodEnum<["high", "normal", "low"]>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embed-single";
    nodeId: string;
    content: string;
    priority: "high" | "normal" | "low";
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embed-single";
    nodeId: string;
    content: string;
    priority: "high" | "normal" | "low";
}>;
/** J-007: Embed Batch */
interface EmbedBatchPayload extends BaseJobPayload {
    type: 'embed-batch';
    nodeIds: string[];
    documentId?: string;
}
declare const EmbedBatchPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"embed-batch">;
    nodeIds: z.ZodArray<z.ZodString, "many">;
    documentId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embed-batch";
    nodeIds: string[];
    documentId?: string | undefined;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embed-batch";
    nodeIds: string[];
    documentId?: string | undefined;
}>;
/** J-008: Infer Edges */
interface InferEdgesPayload extends BaseJobPayload {
    type: 'infer-edges';
    nodeId: string;
    contextNodeIds?: string[];
}
declare const InferEdgesPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"infer-edges">;
    nodeId: z.ZodString;
    contextNodeIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "infer-edges";
    nodeId: string;
    contextNodeIds?: string[] | undefined;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "infer-edges";
    nodeId: string;
    contextNodeIds?: string[] | undefined;
}>;
/** J-009: Deduplicate */
interface DeduplicatePayload extends BaseJobPayload {
    type: 'deduplicate';
    nodeId: string;
    similarityThreshold: number;
}
declare const DeduplicatePayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"deduplicate">;
    nodeId: z.ZodString;
    similarityThreshold: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "deduplicate";
    nodeId: string;
    similarityThreshold: number;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "deduplicate";
    nodeId: string;
    similarityThreshold: number;
}>;
/** J-010: Sync Retry */
interface SyncRetryPayload extends BaseJobPayload {
    type: 'sync-retry';
    syncId: string;
    attempt: number;
    maxAttempts: number;
}
declare const SyncRetryPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"sync-retry">;
    syncId: z.ZodString;
    attempt: z.ZodNumber;
    maxAttempts: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "sync-retry";
    syncId: string;
    attempt: number;
    maxAttempts: number;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "sync-retry";
    syncId: string;
    attempt: number;
    maxAttempts: number;
}>;
/** J-011: Cache Warm */
interface CacheWarmPayload extends BaseJobPayload {
    type: 'cache-warm';
    strategy: CacheWarmStrategy;
    limit: number;
}
declare const CacheWarmPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"cache-warm">;
    strategy: z.ZodEnum<["recent", "frequent", "connected", "none"]>;
    limit: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "cache-warm";
    strategy: "none" | "recent" | "frequent" | "connected";
    limit: number;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "cache-warm";
    strategy: "none" | "recent" | "frequent" | "connected";
    limit: number;
}>;
/** J-012: Metrics Collect */
interface MetricsCollectPayload extends BaseJobPayload {
    type: 'metrics-collect';
    metrics: MetricType[];
}
declare const MetricsCollectPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"metrics-collect">;
    metrics: z.ZodArray<z.ZodEnum<["queue-depth", "cache-hit-rate", "error-rate", "sync-latency"]>, "many">;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "metrics-collect";
    metrics: ("queue-depth" | "cache-hit-rate" | "error-rate" | "sync-latency")[];
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "metrics-collect";
    metrics: ("queue-depth" | "cache-hit-rate" | "error-rate" | "sync-latency")[];
}>;
/** J-013: Embedding Backfill */
interface EmbeddingBackfillPayload extends BaseJobPayload {
    type: 'embedding-backfill';
    batchSize: number;
    priority: 'stale' | 'failed' | 'missing';
}
declare const EmbeddingBackfillPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"embedding-backfill">;
    batchSize: z.ZodNumber;
    priority: z.ZodEnum<["stale", "failed", "missing"]>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embedding-backfill";
    batchSize: number;
    priority: "stale" | "failed" | "missing";
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embedding-backfill";
    batchSize: number;
    priority: "stale" | "failed" | "missing";
}>;
/** J-014: DLQ Process */
interface DLQProcessPayload extends BaseJobPayload {
    type: 'dlq-process';
    limit: number;
    retryEligible: boolean;
}
declare const DLQProcessPayloadSchema: z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"dlq-process">;
    limit: z.ZodNumber;
    retryEligible: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "dlq-process";
    limit: number;
    retryEligible: boolean;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "dlq-process";
    limit: number;
    retryEligible: boolean;
}>;
/** Discriminated union of all 14 job payloads. */
type NBOSJobPayload = DecayCyclePayload | CompressionRunPayload | CleanupDormantPayload | SimilarityBatchPayload | AccessibilityAuditPayload | EmbedSinglePayload | EmbedBatchPayload | InferEdgesPayload | DeduplicatePayload | SyncRetryPayload | CacheWarmPayload | MetricsCollectPayload | EmbeddingBackfillPayload | DLQProcessPayload;
/** Zod discriminated union of all 14 job payload schemas. */
declare const NBOSJobPayloadSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"decay-cycle">;
    batchSize: z.ZodNumber;
    offset: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "decay-cycle";
    batchSize: number;
    offset?: number | undefined;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "decay-cycle";
    batchSize: number;
    offset?: number | undefined;
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"compression-run">;
    clusterId: z.ZodOptional<z.ZodString>;
    dryRun: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "compression-run";
    clusterId?: string | undefined;
    dryRun?: boolean | undefined;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "compression-run";
    clusterId?: string | undefined;
    dryRun?: boolean | undefined;
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"cleanup-dormant">;
    dormantDays: z.ZodNumber;
    action: z.ZodEnum<["archive", "notify", "delete"]>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "cleanup-dormant";
    dormantDays: number;
    action: "archive" | "notify" | "delete";
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "cleanup-dormant";
    dormantDays: number;
    action: "archive" | "notify" | "delete";
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"similarity-batch">;
    sinceTimestamp: z.ZodOptional<z.ZodString>;
    threshold: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "similarity-batch";
    threshold: number;
    sinceTimestamp?: string | undefined;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "similarity-batch";
    threshold: number;
    sinceTimestamp?: string | undefined;
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"accessibility-audit">;
    notifyUser: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "accessibility-audit";
    notifyUser: boolean;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "accessibility-audit";
    notifyUser: boolean;
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"embed-single">;
    nodeId: z.ZodString;
    content: z.ZodString;
    priority: z.ZodEnum<["high", "normal", "low"]>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embed-single";
    nodeId: string;
    content: string;
    priority: "high" | "normal" | "low";
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embed-single";
    nodeId: string;
    content: string;
    priority: "high" | "normal" | "low";
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"embed-batch">;
    nodeIds: z.ZodArray<z.ZodString, "many">;
    documentId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embed-batch";
    nodeIds: string[];
    documentId?: string | undefined;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embed-batch";
    nodeIds: string[];
    documentId?: string | undefined;
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"infer-edges">;
    nodeId: z.ZodString;
    contextNodeIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "infer-edges";
    nodeId: string;
    contextNodeIds?: string[] | undefined;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "infer-edges";
    nodeId: string;
    contextNodeIds?: string[] | undefined;
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"deduplicate">;
    nodeId: z.ZodString;
    similarityThreshold: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "deduplicate";
    nodeId: string;
    similarityThreshold: number;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "deduplicate";
    nodeId: string;
    similarityThreshold: number;
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"sync-retry">;
    syncId: z.ZodString;
    attempt: z.ZodNumber;
    maxAttempts: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "sync-retry";
    syncId: string;
    attempt: number;
    maxAttempts: number;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "sync-retry";
    syncId: string;
    attempt: number;
    maxAttempts: number;
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"cache-warm">;
    strategy: z.ZodEnum<["recent", "frequent", "connected", "none"]>;
    limit: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "cache-warm";
    strategy: "none" | "recent" | "frequent" | "connected";
    limit: number;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "cache-warm";
    strategy: "none" | "recent" | "frequent" | "connected";
    limit: number;
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"metrics-collect">;
    metrics: z.ZodArray<z.ZodEnum<["queue-depth", "cache-hit-rate", "error-rate", "sync-latency"]>, "many">;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "metrics-collect";
    metrics: ("queue-depth" | "cache-hit-rate" | "error-rate" | "sync-latency")[];
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "metrics-collect";
    metrics: ("queue-depth" | "cache-hit-rate" | "error-rate" | "sync-latency")[];
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"embedding-backfill">;
    batchSize: z.ZodNumber;
    priority: z.ZodEnum<["stale", "failed", "missing"]>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embedding-backfill";
    batchSize: number;
    priority: "stale" | "failed" | "missing";
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "embedding-backfill";
    batchSize: number;
    priority: "stale" | "failed" | "missing";
}>, z.ZodObject<{
    tenantId: z.ZodString;
    correlationId: z.ZodString;
    triggeredAt: z.ZodString;
    triggeredBy: z.ZodEnum<["cron", "event", "manual", "retry"]>;
} & {
    type: z.ZodLiteral<"dlq-process">;
    limit: z.ZodNumber;
    retryEligible: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "dlq-process";
    limit: number;
    retryEligible: boolean;
}, {
    tenantId: string;
    correlationId: string;
    triggeredAt: string;
    triggeredBy: "cron" | "event" | "manual" | "retry";
    type: "dlq-process";
    limit: number;
    retryEligible: boolean;
}>]>;
/** Failure handling configuration for a job. */
interface JobFailureConfig {
    retries: number;
    backoff: BackoffStrategy;
    baseDelayMs: number;
    maxDelayMs: number;
    deadLetterAfter: number;
    alertAfter: number;
    userNotify: boolean;
    notifyChannel: NotifyChannel;
}
declare const JobFailureConfigSchema: z.ZodObject<{
    retries: z.ZodNumber;
    backoff: z.ZodEnum<["exponential", "linear", "fixed"]>;
    baseDelayMs: z.ZodNumber;
    maxDelayMs: z.ZodNumber;
    deadLetterAfter: z.ZodNumber;
    alertAfter: z.ZodNumber;
    userNotify: z.ZodBoolean;
    notifyChannel: z.ZodEnum<["toast", "banner", "push", "none"]>;
}, "strip", z.ZodTypeAny, {
    retries: number;
    backoff: "exponential" | "linear" | "fixed";
    baseDelayMs: number;
    maxDelayMs: number;
    deadLetterAfter: number;
    alertAfter: number;
    userNotify: boolean;
    notifyChannel: "toast" | "banner" | "push" | "none";
}, {
    retries: number;
    backoff: "exponential" | "linear" | "fixed";
    baseDelayMs: number;
    maxDelayMs: number;
    deadLetterAfter: number;
    alertAfter: number;
    userNotify: boolean;
    notifyChannel: "toast" | "banner" | "push" | "none";
}>;
/** Operational error with full context. Created via createOperationalError(). */
interface NousOperationalError {
    code: OpsErrorCode;
    category: OpsErrorCategory;
    message: string;
    userMessage: string;
    retryable: boolean;
    retryAfter?: number;
    notifyChannel: NotifyChannel;
    context?: Record<string, unknown>;
}
declare const NousOperationalErrorSchema: z.ZodObject<{
    code: z.ZodEnum<[string, ...string[]]>;
    category: z.ZodEnum<["transient", "rate_limited", "permanent", "user_error", "system_error"]>;
    message: z.ZodString;
    userMessage: z.ZodString;
    retryable: z.ZodBoolean;
    retryAfter: z.ZodOptional<z.ZodNumber>;
    notifyChannel: z.ZodEnum<["toast", "banner", "push", "none"]>;
    context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    notifyChannel: "toast" | "banner" | "push" | "none";
    category: "transient" | "rate_limited" | "permanent" | "user_error" | "system_error";
    userMessage: string;
    retryable: boolean;
    retryAfter?: number | undefined;
    context?: Record<string, unknown> | undefined;
}, {
    code: string;
    message: string;
    notifyChannel: "toast" | "banner" | "push" | "none";
    category: "transient" | "rate_limited" | "permanent" | "user_error" | "system_error";
    userMessage: string;
    retryable: boolean;
    retryAfter?: number | undefined;
    context?: Record<string, unknown> | undefined;
}>;
/** Configuration for a single cache type. */
interface CacheConfig {
    primaryStorage: CacheStorageTier;
    fallbackStorage?: CacheStorageTier;
    ttlSeconds: number;
    maxItems: number;
    maxBytes?: number;
    evictionPolicy: EvictionPolicy;
    warmStrategy: CacheWarmStrategy;
}
declare const CacheConfigSchema: z.ZodObject<{
    primaryStorage: z.ZodEnum<["memory", "redis", "sqlite"]>;
    fallbackStorage: z.ZodOptional<z.ZodEnum<["memory", "redis", "sqlite"]>>;
    ttlSeconds: z.ZodNumber;
    maxItems: z.ZodNumber;
    maxBytes: z.ZodOptional<z.ZodNumber>;
    evictionPolicy: z.ZodEnum<["lru", "lfu", "ttl"]>;
    warmStrategy: z.ZodEnum<["recent", "frequent", "connected", "none"]>;
}, "strip", z.ZodTypeAny, {
    primaryStorage: "memory" | "redis" | "sqlite";
    ttlSeconds: number;
    maxItems: number;
    evictionPolicy: "lru" | "lfu" | "ttl";
    warmStrategy: "none" | "recent" | "frequent" | "connected";
    fallbackStorage?: "memory" | "redis" | "sqlite" | undefined;
    maxBytes?: number | undefined;
}, {
    primaryStorage: "memory" | "redis" | "sqlite";
    ttlSeconds: number;
    maxItems: number;
    evictionPolicy: "lru" | "lfu" | "ttl";
    warmStrategy: "none" | "recent" | "frequent" | "connected";
    fallbackStorage?: "memory" | "redis" | "sqlite" | undefined;
    maxBytes?: number | undefined;
}>;
/** Runtime metrics for a cache instance. */
interface CacheMetrics {
    cacheType: CacheType;
    storage: CacheStorageTier;
    hits: number;
    misses: number;
    hitRate: number;
    itemCount: number;
    maxItems: number;
    bytesUsed: number;
    maxBytes: number;
    evictions: number;
    avgLatencyMs: number;
    p99LatencyMs: number;
}
declare const CacheMetricsSchema: z.ZodObject<{
    cacheType: z.ZodEnum<["embedding", "llm_response", "node", "search_result", "edge", "session"]>;
    storage: z.ZodEnum<["memory", "redis", "sqlite"]>;
    hits: z.ZodNumber;
    misses: z.ZodNumber;
    hitRate: z.ZodNumber;
    itemCount: z.ZodNumber;
    maxItems: z.ZodNumber;
    bytesUsed: z.ZodNumber;
    maxBytes: z.ZodNumber;
    evictions: z.ZodNumber;
    avgLatencyMs: z.ZodNumber;
    p99LatencyMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    maxItems: number;
    maxBytes: number;
    cacheType: "embedding" | "llm_response" | "node" | "search_result" | "edge" | "session";
    storage: "memory" | "redis" | "sqlite";
    hits: number;
    misses: number;
    hitRate: number;
    itemCount: number;
    bytesUsed: number;
    evictions: number;
    avgLatencyMs: number;
    p99LatencyMs: number;
}, {
    maxItems: number;
    maxBytes: number;
    cacheType: "embedding" | "llm_response" | "node" | "search_result" | "edge" | "session";
    storage: "memory" | "redis" | "sqlite";
    hits: number;
    misses: number;
    hitRate: number;
    itemCount: number;
    bytesUsed: number;
    evictions: number;
    avgLatencyMs: number;
    p99LatencyMs: number;
}>;
/** Stats returned by ICacheService.stats(). */
interface CacheStats {
    hits: number;
    misses: number;
    size: number;
    bytesUsed: number;
    evictions: number;
    avgLatencyMs: number;
    p99LatencyMs: number;
}
declare const CacheStatsSchema: z.ZodObject<{
    hits: z.ZodNumber;
    misses: z.ZodNumber;
    size: z.ZodNumber;
    bytesUsed: z.ZodNumber;
    evictions: z.ZodNumber;
    avgLatencyMs: z.ZodNumber;
    p99LatencyMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    hits: number;
    misses: number;
    bytesUsed: number;
    evictions: number;
    avgLatencyMs: number;
    p99LatencyMs: number;
    size: number;
}, {
    hits: number;
    misses: number;
    bytesUsed: number;
    evictions: number;
    avgLatencyMs: number;
    p99LatencyMs: number;
    size: number;
}>;
/** Cache service interface (pure interface, implementation deferred to service layer). */
interface ICacheService {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    deletePattern(pattern: string): Promise<number>;
    stats(): Promise<CacheStats>;
}
/** Network monitor configuration. */
interface NetworkMonitorConfig {
    checkIntervalMs: number;
    offlineThreshold: number;
    onlineThreshold: number;
    endpoints: readonly string[];
    timeoutMs: number;
}
declare const NetworkMonitorConfigSchema: z.ZodObject<{
    checkIntervalMs: z.ZodNumber;
    offlineThreshold: z.ZodNumber;
    onlineThreshold: z.ZodNumber;
    endpoints: z.ZodArray<z.ZodString, "many">;
    timeoutMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    checkIntervalMs: number;
    offlineThreshold: number;
    onlineThreshold: number;
    endpoints: string[];
    timeoutMs: number;
}, {
    checkIntervalMs: number;
    offlineThreshold: number;
    onlineThreshold: number;
    endpoints: string[];
    timeoutMs: number;
}>;
/**
 * An operation queued for offline replay.
 * Persisted in SQLite via the offline_queue table.
 * _schemaVersion required for persisted types (Technical Audit finding).
 */
interface QueuedOperation {
    _schemaVersion: number;
    id: string;
    tenantId: string;
    type: OfflineQueueOpType;
    payload: unknown;
    createdAt: string;
    priority: number;
    attempts: number;
    lastAttempt?: string;
    error?: string;
}
declare const QueuedOperationSchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    id: z.ZodString;
    tenantId: z.ZodString;
    type: z.ZodEnum<["sync", "embed", "edge", "other"]>;
    payload: z.ZodUnknown;
    createdAt: z.ZodString;
    priority: z.ZodNumber;
    attempts: z.ZodNumber;
    lastAttempt: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    type: "sync" | "edge" | "embed" | "other";
    priority: number;
    _schemaVersion: number;
    id: string;
    createdAt: string;
    attempts: number;
    payload?: unknown;
    lastAttempt?: string | undefined;
    error?: string | undefined;
}, {
    tenantId: string;
    type: "sync" | "edge" | "embed" | "other";
    priority: number;
    _schemaVersion: number;
    id: string;
    createdAt: string;
    attempts: number;
    payload?: unknown;
    lastAttempt?: string | undefined;
    error?: string | undefined;
}>;
/** Notification configuration for an event type. */
interface NotificationConfig {
    channel: NotifyChannel;
    priority: NotifyPriority;
    autoDismissMs?: number;
    action?: {
        label: string;
        handler: string;
    };
}
declare const NotificationConfigSchema: z.ZodObject<{
    channel: z.ZodEnum<["toast", "banner", "push", "none"]>;
    priority: z.ZodEnum<["immediate", "next_session", "digest"]>;
    autoDismissMs: z.ZodOptional<z.ZodNumber>;
    action: z.ZodOptional<z.ZodObject<{
        label: z.ZodString;
        handler: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        label: string;
        handler: string;
    }, {
        label: string;
        handler: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    priority: "immediate" | "next_session" | "digest";
    channel: "toast" | "banner" | "push" | "none";
    action?: {
        label: string;
        handler: string;
    } | undefined;
    autoDismissMs?: number | undefined;
}, {
    priority: "immediate" | "next_session" | "digest";
    channel: "toast" | "banner" | "push" | "none";
    action?: {
        label: string;
        handler: string;
    } | undefined;
    autoDismissMs?: number | undefined;
}>;
/** Degradation action for a downed service. */
interface DegradationAction {
    service: DegradableService;
    impact: string;
    fallback: string;
}
declare const DegradationActionSchema: z.ZodObject<{
    service: z.ZodEnum<["redis", "openai_embedding", "openai_llm", "turso_cloud", "inngest", "network"]>;
    impact: z.ZodString;
    fallback: z.ZodString;
}, "strip", z.ZodTypeAny, {
    service: "network" | "redis" | "openai_embedding" | "openai_llm" | "turso_cloud" | "inngest";
    impact: string;
    fallback: string;
}, {
    service: "network" | "redis" | "openai_embedding" | "openai_llm" | "turso_cloud" | "inngest";
    impact: string;
    fallback: string;
}>;
/** Priority for J-013 embedding backfill. */
declare const EMBEDDING_BACKFILL_PRIORITIES: readonly ["stale", "failed", "missing"];
type EmbeddingBackfillPriority = typeof EMBEDDING_BACKFILL_PRIORITIES[number];
/** Actions for J-003 cleanup dormant. */
declare const CLEANUP_ACTIONS: readonly ["archive", "notify", "delete"];
type CleanupAction = typeof CLEANUP_ACTIONS[number];
/** Priority for J-006 embed single. */
declare const EMBED_PRIORITIES: readonly ["high", "normal", "low"];
type EmbedPriority = typeof EMBED_PRIORITIES[number];

/**
 * @module @nous/core/operations
 * @description Job scheduling, dependency resolution, and failure handling - storm-034
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-034
 * @storm Brainstorms/Infrastructure/storm-034-backend-operations
 */

/**
 * Get the cron schedule string for a given job.
 *
 * @returns The cron expression, or `null` if the job is event-driven
 */
declare function getJobSchedule(jobId: NBOSJobId): string | null;
/**
 * Get the batch size for a given job.
 *
 * @returns The maximum batch size, or `null` for unbounded processing
 */
declare function getJobBatchSize(jobId: NBOSJobId): number | null;
/**
 * Get the execution timeout in milliseconds for a given job.
 */
declare function getJobTimeout(jobId: NBOSJobId): number;
/**
 * Get the concurrency limit for a given job.
 */
declare function getJobConcurrency(jobId: NBOSJobId): number;
/**
 * Get the priority for a given job.
 */
declare function getJobPriority(jobId: NBOSJobId): 'high' | 'normal' | 'low';
/**
 * Get the human-readable job name from a job ID.
 */
declare function getJobName(jobId: NBOSJobId): string;
/**
 * Get the ordered dependency chain for a job.
 *
 * @returns Array of prerequisite job IDs (empty if no dependencies)
 */
declare function getJobDependencies(jobId: NBOSJobId): readonly NBOSJobId[];
/**
 * Check whether a job is blocked by incomplete dependencies.
 *
 * @param jobId - The job to evaluate
 * @param completedJobs - Jobs that have already completed successfully
 * @returns `true` if the job cannot run yet
 */
declare function isJobBlocked(jobId: NBOSJobId, completedJobs: readonly NBOSJobId[]): boolean;
/**
 * Get the failure-handling configuration for a job by its name.
 *
 * @param jobName - The human-readable job name (e.g. 'decay-cycle')
 * @returns The failure config, or `undefined` if no config exists
 */
declare function getJobFailureConfig(jobName: string): JobFailureConfig | undefined;
/**
 * Calculate the retry delay in milliseconds.
 *
 * - exponential: min(baseDelay * 2^attempt, maxDelay)
 * - linear: min(baseDelay * (attempt + 1), maxDelay)
 * - fixed: baseDelay
 */
declare function calculateRetryDelay(config: JobFailureConfig, attempt: number): number;
/**
 * Determine whether a job should be moved to the dead-letter queue.
 */
declare function shouldDeadLetter(config: JobFailureConfig, attempts: number): boolean;
/**
 * Determine whether the operations team should be alerted.
 */
declare function shouldAlertOps(config: JobFailureConfig, failures: number): boolean;
/** Check if a job is cron-triggered (has a schedule). */
declare function isNBOSCronJob(jobId: NBOSJobId): boolean;
/** Check if a job is event-triggered (no schedule). */
declare function isNBOSEventJob(jobId: NBOSJobId): boolean;
/** Get the ordered list of job IDs for the daily processing chain. */
declare function getDailyChainOrder(): readonly NBOSJobId[];
/**
 * Create a fully-formed job payload with auto-generated metadata.
 *
 * Stamps `correlationId` and `triggeredAt` onto the provided payload.
 */
declare function createJobPayload<T extends NBOSJobPayload>(payload: Omit<T, 'correlationId' | 'triggeredAt'>): T;

/**
 * @module @nous/core/operations
 * @description Error creation, classification, and notification mapping - storm-034
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-034
 * @storm Brainstorms/Infrastructure/storm-034-backend-operations
 */

/**
 * Create a structured operational error from a known error code.
 *
 * Looks up the code in OPS_ERROR_CODES to populate category, message,
 * userMessage, retryability, and notification channel. Merges optional
 * context for runtime debugging.
 *
 * @throws If `code` is not found in OPS_ERROR_CODES
 */
declare function createOperationalError(code: OpsErrorCode, context?: Record<string, unknown>): NousOperationalError;
/** Check whether an operational error is retryable. */
declare function isRetryableError(error: NousOperationalError): boolean;
/** Get the suggested retry delay for a rate-limited error. */
declare function getRetryAfter(error: NousOperationalError): number | undefined;
/**
 * Map an operational error to its notification configuration.
 *
 * Uses the error's category and notifyChannel to derive the appropriate
 * notification strategy. Falls back to a silent notification.
 */
declare function getNotificationForError(error: NousOperationalError): NotificationConfig;
/**
 * Classify a raw (possibly unknown) error into an operational error code.
 *
 * Uses heuristic matching on error message content.
 */
declare function classifyError(error: unknown): OpsErrorCode;
/** Check if the error is transient (temporary, likely to self-resolve). */
declare function isTransientError(error: NousOperationalError): boolean;
/** Check if the error is caused by rate limiting. */
declare function isRateLimitedError(error: NousOperationalError): boolean;
/** Check if the error is permanent (will not resolve on retry). */
declare function isPermanentError(error: NousOperationalError): boolean;
/** Check if the error originated from user input or action. */
declare function isUserError(error: NousOperationalError): boolean;
/** Check if the error is a system/infrastructure error. */
declare function isSystemError(error: NousOperationalError): boolean;
/**
 * Derive the error group from an error code.
 *
 * Groups by prefix: E1xx=llm, E2xx=embedding, E3xx=database,
 * E4xx=sync, E5xx=auth, E6xx=network
 */
declare function getErrorGroup(code: OpsErrorCode): OpsErrorGroup;

/**
 * @module @nous/core/operations
 * @description Cache key generation, TTL management, and metrics - storm-034
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-034
 * @storm Brainstorms/Infrastructure/storm-034-backend-operations
 */

/**
 * Get the full cache configuration for a given cache type.
 *
 * @throws If `cacheType` is not found in CACHE_CONFIGS
 */
declare function getCacheConfig(cacheType: CacheType): CacheConfig;
/**
 * Generate a cache key for an embedding result.
 * Format: `emb:{length}:{hash}`
 *
 * @param content - The raw content to embed
 * @param hashFn - A hash function (e.g. SHA-256 hex) to produce a digest
 */
declare function generateEmbeddingCacheKey(content: string, hashFn: (s: string) => string): string;
/**
 * Generate a cache key for an LLM response.
 * Format: `llm:{operation}:{model}:{length}:{hash}`
 */
declare function generateLLMCacheKey(operation: string, model: string, prompt: string, hashFn: (s: string) => string): string;
/**
 * Generate a cache key for a memory node.
 * Format: `node:{tenantId}:{nodeId}` or `node:{tenantId}:{nodeId}:v{version}`
 */
declare function generateNodeCacheKey(tenantId: string, nodeId: string, version?: number): string;
/**
 * Generate a cache key for a search result.
 * Format: `search:{tenantId}:{queryHash}:{filtersHash}`
 */
declare function generateSearchCacheKey(tenantId: string, query: string, filters: Record<string, unknown>, hashFn: (s: string) => string): string;
/**
 * Generate a cache key for edges connected to a node.
 * Format: `edges:{tenantId}:{nodeId}`
 */
declare function generateEdgeCacheKey(tenantId: string, nodeId: string): string;
/**
 * Generate a cache key for a user session.
 * Format: `session:{sessionId}`
 */
declare function generateSessionCacheKey(sessionId: string): string;
/**
 * Normalize content for consistent embedding cache key generation.
 *
 * 1. Convert to lowercase
 * 2. Trim leading and trailing whitespace
 * 3. Collapse all consecutive whitespace into a single space
 * 4. Truncate to a maximum of 8000 characters
 */
declare function normalizeForEmbedding(content: string): string;
/** Get the TTL (time-to-live) in seconds for a given cache type. */
declare function getTTLSeconds(cacheType: CacheType): number;
/** Get the maximum number of items allowed for a given cache type. */
declare function getMaxItems(cacheType: CacheType): number;
/**
 * Calculate the cache hit rate as a value between 0 and 1.
 * Safely handles zero denominator (returns 0).
 */
declare function calculateHitRate(hits: number, misses: number): number;
/**
 * Determine whether cache eviction should be triggered.
 * Eviction is needed when itemCount >= maxItems.
 */
declare function shouldEvict(metrics: CacheMetrics): boolean;
/** Get the warm (pre-population) strategy for a cache type. */
declare function selectWarmStrategy(cacheType: CacheType): CacheWarmStrategy;
/**
 * Create an empty CacheMetrics object with all counters initialized to zero.
 */
declare function createEmptyCacheMetrics(cacheType: CacheType): CacheMetrics;

/**
 * @module @nous/core/operations
 * @description Network status evaluation and offline queue management - storm-034
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-034
 * @storm Brainstorms/Infrastructure/storm-034-backend-operations
 */

/**
 * Evaluate the current network status based on consecutive failure/success counts.
 *
 * State transitions (from brainstorm):
 * - 3 consecutive failures -> offline
 * - 1 success from offline -> online
 * - < threshold with no definitive signal -> unknown
 */
declare function evaluateNetworkStatus(consecutiveFailures: number, consecutiveSuccesses: number): NetworkStatus;
/**
 * Check if consecutive failures have crossed the offline threshold.
 */
declare function shouldGoOffline(consecutiveFailures: number): boolean;
/**
 * Check if the system should transition back to online.
 * Only returns `true` when the system is not already online.
 */
declare function shouldGoOnline(currentStatus: NetworkStatus, successCount: number): boolean;
/**
 * Create a new queued operation for offline processing.
 *
 * Auto-generates: id, createdAt, priority, attempts=0, _schemaVersion=1
 */
declare function createQueuedOperation(tenantId: string, type: OfflineQueueOpType, payload: unknown): QueuedOperation;
/**
 * Get the numeric priority for an offline queue operation type.
 *
 * Uses index in OFFLINE_QUEUE_CONFIG.priorityOrder:
 * sync=0, embed=1, edge=2, other=3
 */
declare function getQueuePriority(type: OfflineQueueOpType): number;
/**
 * Check if the offline queue for a tenant has reached capacity.
 */
declare function isQueueFull(currentCount: number): boolean;
/**
 * Check if a queue entry has exceeded the maximum age (7 days).
 */
declare function isQueueEntryExpired(createdAt: string, now?: Date): boolean;
/**
 * Sort queued operations by priority (ascending) then by creation time
 * (ascending, oldest first).
 *
 * Does not mutate the input array.
 */
declare function sortQueueByPriority(operations: readonly QueuedOperation[]): QueuedOperation[];

/**
 * @module @nous/core/operations
 * @description Graceful degradation logic for service outages - storm-034
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-034
 * @storm Brainstorms/Infrastructure/storm-034-backend-operations
 */

/**
 * Get the degradation action for a specific downed service.
 *
 * @throws If `service` is not found in DEGRADATION_MATRIX
 */
declare function getDegradationAction(service: DegradableService): DegradationAction;
/**
 * Get all active fallback actions for a set of currently-down services.
 * Deduplicates by service name.
 */
declare function getActiveFallbacks(downServices: readonly DegradableService[]): DegradationAction[];
/**
 * Check if the system is in full offline mode.
 * Full offline = 'network' service is down.
 */
declare function isFullOfflineMode(downServices: readonly DegradableService[]): boolean;
/**
 * Determine which features remain available when specific services are down.
 *
 * A feature is available only when NONE of its required services are down.
 */
declare function getAvailableFeatures(downServices: readonly DegradableService[]): string[];

export { type AccessibilityAuditPayload, AccessibilityAuditPayloadSchema, BACKOFF_STRATEGIES, type BackoffStrategy, type BaseJobPayload, BaseJobPayloadSchema, CACHE_CONFIGS, CACHE_STORAGE_TIERS, CACHE_TYPES, CACHE_WARM_STRATEGIES, CLEANUP_ACTIONS, type CacheConfig, CacheConfigSchema, type CacheMetrics, CacheMetricsSchema, type CacheStats, CacheStatsSchema, type CacheStorageTier, type CacheType, type CacheWarmPayload, CacheWarmPayloadSchema, type CacheWarmStrategy, type CleanupAction, type CleanupDormantPayload, CleanupDormantPayloadSchema, type CompressionRunPayload, CompressionRunPayloadSchema, DAILY_CHAIN_ORDER, DEGRADABLE_SERVICES, DEGRADATION_MATRIX, type DLQProcessPayload, DLQProcessPayloadSchema, type DecayCyclePayload, DecayCyclePayloadSchema, type DeduplicatePayload, DeduplicatePayloadSchema, type DegradableService, type DegradationAction, DegradationActionSchema, EMBEDDING_BACKFILL_PRIORITIES, EMBED_PRIORITIES, ERROR_GROUP_PREFIXES, EVICTION_POLICIES, type EmbedBatchPayload, EmbedBatchPayloadSchema, type EmbedPriority, type EmbedSinglePayload, EmbedSinglePayloadSchema, type EmbeddingBackfillPayload, EmbeddingBackfillPayloadSchema, type EmbeddingBackfillPriority, type EvictionPolicy, type ICacheService, type InferEdgesPayload, InferEdgesPayloadSchema, JOB_FAILURE_CONFIGS, JOB_TRIGGER_TYPES, type JobFailureConfig, JobFailureConfigSchema, type JobTriggerType, METRIC_TYPES, type MetricType, type MetricsCollectPayload, MetricsCollectPayloadSchema, type NBOSJobId, type NBOSJobName, type NBOSJobPayload, NBOSJobPayloadSchema, NBOS_BATCH_SIZES, NBOS_CONCURRENCY, NBOS_CRON_JOBS, NBOS_CRON_SCHEDULES, NBOS_EVENT_JOBS, NBOS_JOB_DEPENDENCIES, NBOS_JOB_IDS, NBOS_JOB_NAMES, NBOS_JOB_NAME_VALUES, NBOS_JOB_PRIORITIES, NBOS_TIMEOUTS, NETWORK_MONITOR_CONFIG, NETWORK_STATUSES, NOTIFICATION_STRATEGY, NOTIFICATION_STRATEGY_TYPES, NOTIFY_CHANNELS, NOTIFY_PRIORITIES, type NetworkMonitorConfig, NetworkMonitorConfigSchema, type NetworkStatus, type NotificationConfig, NotificationConfigSchema, type NotificationStrategyType, type NotifyChannel, type NotifyPriority, type NousOperationalError, NousOperationalErrorSchema, OFFLINE_QUEUE_CONFIG, OFFLINE_QUEUE_OP_TYPES, OFFLINE_QUEUE_OVERFLOW, OPS_ERROR_CATEGORIES, OPS_ERROR_CODES, OPS_ERROR_CODE_KEYS, OPS_ERROR_GROUPS, type OfflineQueueOpType, type OfflineQueueOverflow, type OpsErrorCategory, type OpsErrorCode, type OpsErrorGroup, type QueuedOperation, QueuedOperationSchema, type SimilarityBatchPayload, SimilarityBatchPayloadSchema, type SyncRetryPayload, SyncRetryPayloadSchema, calculateHitRate, calculateRetryDelay, classifyError, createEmptyCacheMetrics, createJobPayload, createOperationalError, createQueuedOperation, evaluateNetworkStatus, generateEdgeCacheKey, generateEmbeddingCacheKey, generateLLMCacheKey, generateNodeCacheKey, generateSearchCacheKey, generateSessionCacheKey, getActiveFallbacks, getAvailableFeatures, getCacheConfig, getDailyChainOrder, getDegradationAction, getErrorGroup, getJobBatchSize, getJobConcurrency, getJobDependencies, getJobFailureConfig, getJobName, getJobPriority, getJobSchedule, getJobTimeout, getMaxItems, getNotificationForError, getQueuePriority, getRetryAfter, getTTLSeconds, isBackoffStrategy, isCacheStorageTier, isCacheType, isCacheWarmStrategy, isDegradableService, isEvictionPolicy, isFullOfflineMode, isJobBlocked, isJobTriggerType, isMetricType, isNBOSCronJob, isNBOSEventJob, isNBOSJobId, isNBOSJobName, isNetworkStatus, isNotificationStrategyType, isNotifyChannel, isNotifyPriority, isOfflineQueueOpType, isOpsErrorCategory, isOpsErrorCode, isOpsErrorGroup, isPermanentError, isQueueEntryExpired, isQueueFull, isRateLimitedError, isRetryableError, isSystemError, isTransientError, isUserError, normalizeForEmbedding, selectWarmStrategy, shouldAlertOps, shouldDeadLetter, shouldEvict, shouldGoOffline, shouldGoOnline, sortQueueByPriority };
