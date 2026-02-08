import { z } from 'zod';

// src/operations/constants.ts
var NBOS_JOB_IDS = [
  "J-001",
  "J-002",
  "J-003",
  "J-004",
  "J-005",
  "J-006",
  "J-007",
  "J-008",
  "J-009",
  "J-010",
  "J-011",
  "J-012",
  "J-013",
  "J-014"
];
var NBOS_JOB_NAMES = {
  "J-001": "decay-cycle",
  "J-002": "compression-run",
  "J-003": "cleanup-dormant",
  "J-004": "similarity-batch",
  "J-005": "accessibility-audit",
  "J-006": "embed-single",
  "J-007": "embed-batch",
  "J-008": "infer-edges",
  "J-009": "deduplicate",
  "J-010": "sync-retry",
  "J-011": "cache-warm",
  "J-012": "metrics-collect",
  "J-013": "embedding-backfill",
  "J-014": "dlq-process"
};
var NBOS_JOB_NAME_VALUES = [
  "decay-cycle",
  "compression-run",
  "cleanup-dormant",
  "similarity-batch",
  "accessibility-audit",
  "embed-single",
  "embed-batch",
  "infer-edges",
  "deduplicate",
  "sync-retry",
  "cache-warm",
  "metrics-collect",
  "embedding-backfill",
  "dlq-process"
];
var NBOS_CRON_SCHEDULES = {
  "J-001": "0 3 * * *",
  "J-002": "0 5 * * 0",
  "J-003": "0 6 1 * *",
  "J-004": "0 1 * * *",
  "J-005": "0 7 1 * *",
  "J-011": "*/30 * * * *",
  "J-012": "*/5 * * * *",
  "J-013": "0 0 * * *",
  "J-014": "0 * * * *"
};
var JOB_TRIGGER_TYPES = ["cron", "event", "manual", "retry"];
var NBOS_CRON_JOBS = [
  "J-001",
  "J-002",
  "J-003",
  "J-004",
  "J-005",
  "J-011",
  "J-012",
  "J-013",
  "J-014"
];
var NBOS_EVENT_JOBS = [
  "J-006",
  "J-007",
  "J-008",
  "J-009",
  "J-010"
];
var NBOS_BATCH_SIZES = {
  "J-001": 1e3,
  "J-002": 500,
  "J-003": 100,
  "J-004": 500,
  "J-005": null,
  "J-006": 1,
  "J-007": 50,
  "J-008": 10,
  "J-009": 1,
  "J-010": 1,
  "J-011": 100,
  "J-012": null,
  "J-013": 100,
  "J-014": 50
};
var NBOS_TIMEOUTS = {
  "J-001": 10 * 60 * 1e3,
  "J-002": 30 * 60 * 1e3,
  "J-003": 15 * 60 * 1e3,
  "J-004": 20 * 60 * 1e3,
  "J-005": 30 * 60 * 1e3,
  "J-006": 30 * 1e3,
  "J-007": 2 * 60 * 1e3,
  "J-008": 60 * 1e3,
  "J-009": 30 * 1e3,
  "J-010": 60 * 1e3,
  "J-011": 5 * 60 * 1e3,
  "J-012": 60 * 1e3,
  "J-013": 15 * 60 * 1e3,
  "J-014": 5 * 60 * 1e3
};
var NBOS_CONCURRENCY = {
  "J-001": 1,
  "J-002": 1,
  "J-003": 1,
  "J-004": 1,
  "J-005": 1,
  "J-006": 10,
  "J-007": 3,
  "J-008": 5,
  "J-009": 5,
  "J-010": 5,
  "J-011": 1,
  "J-012": 1,
  "J-013": 1,
  "J-014": 1
};
var NBOS_JOB_PRIORITIES = {
  "J-001": "low",
  "J-002": "low",
  "J-003": "low",
  "J-004": "low",
  "J-005": "low",
  "J-006": "high",
  "J-007": "normal",
  "J-008": "normal",
  "J-009": "normal",
  "J-010": "high",
  "J-011": "low",
  "J-012": "low",
  "J-013": "low",
  "J-014": "low"
};
var NBOS_JOB_DEPENDENCIES = {
  "J-001": ["J-004"],
  "J-002": ["J-001"],
  "J-004": ["J-013"],
  "J-008": ["J-006"],
  "J-009": ["J-006"]
};
var DAILY_CHAIN_ORDER = ["J-013", "J-004", "J-001"];
var BACKOFF_STRATEGIES = ["exponential", "linear", "fixed"];
var JOB_FAILURE_CONFIGS = {
  "decay-cycle": { retries: 3, backoff: "fixed", baseDelayMs: 6e4, maxDelayMs: 3e5, deadLetterAfter: 3, alertAfter: 2, userNotify: false, notifyChannel: "none" },
  "compression-run": { retries: 2, backoff: "fixed", baseDelayMs: 3e5, maxDelayMs: 6e5, deadLetterAfter: 2, alertAfter: 1, userNotify: false, notifyChannel: "none" },
  "cleanup-dormant": { retries: 2, backoff: "fixed", baseDelayMs: 3e5, maxDelayMs: 6e5, deadLetterAfter: 2, alertAfter: 1, userNotify: false, notifyChannel: "none" },
  "similarity-batch": { retries: 2, backoff: "fixed", baseDelayMs: 3e5, maxDelayMs: 6e5, deadLetterAfter: 2, alertAfter: 1, userNotify: false, notifyChannel: "none" },
  "accessibility-audit": { retries: 2, backoff: "fixed", baseDelayMs: 3e5, maxDelayMs: 6e5, deadLetterAfter: 2, alertAfter: 1, userNotify: false, notifyChannel: "none" },
  "embedding-backfill": { retries: 2, backoff: "fixed", baseDelayMs: 3e5, maxDelayMs: 6e5, deadLetterAfter: 2, alertAfter: 1, userNotify: false, notifyChannel: "none" },
  "cache-warm": { retries: 1, backoff: "fixed", baseDelayMs: 6e4, maxDelayMs: 6e4, deadLetterAfter: 1, alertAfter: 1, userNotify: false, notifyChannel: "none" },
  "metrics-collect": { retries: 1, backoff: "fixed", baseDelayMs: 3e4, maxDelayMs: 3e4, deadLetterAfter: 1, alertAfter: 3, userNotify: false, notifyChannel: "none" },
  "dlq-process": { retries: 1, backoff: "fixed", baseDelayMs: 6e4, maxDelayMs: 6e4, deadLetterAfter: 1, alertAfter: 1, userNotify: false, notifyChannel: "none" },
  "embed-single": { retries: 4, backoff: "exponential", baseDelayMs: 1e3, maxDelayMs: 6e4, deadLetterAfter: 4, alertAfter: 3, userNotify: true, notifyChannel: "toast" },
  "embed-batch": { retries: 3, backoff: "exponential", baseDelayMs: 2e3, maxDelayMs: 6e4, deadLetterAfter: 3, alertAfter: 2, userNotify: false, notifyChannel: "none" },
  "infer-edges": { retries: 3, backoff: "exponential", baseDelayMs: 2e3, maxDelayMs: 3e4, deadLetterAfter: 3, alertAfter: 2, userNotify: false, notifyChannel: "none" },
  "deduplicate": { retries: 3, backoff: "exponential", baseDelayMs: 2e3, maxDelayMs: 3e4, deadLetterAfter: 3, alertAfter: 2, userNotify: false, notifyChannel: "none" },
  "sync-retry": { retries: 5, backoff: "exponential", baseDelayMs: 1e3, maxDelayMs: 3e4, deadLetterAfter: 5, alertAfter: 3, userNotify: true, notifyChannel: "banner" }
};
var OPS_ERROR_CATEGORIES = ["transient", "rate_limited", "permanent", "user_error", "system_error"];
var NOTIFY_CHANNELS = ["toast", "banner", "push", "none"];
var NOTIFY_PRIORITIES = ["immediate", "next_session", "digest"];
var OPS_ERROR_CODES = {
  E100: { code: "E100", category: "transient", message: "LLM request timeout", userMessage: "AI is thinking... please wait", retryable: true, notifyChannel: "toast" },
  E101: { code: "E101", category: "rate_limited", message: "LLM rate limit exceeded", userMessage: "High demand, retrying shortly", retryable: true, retryAfter: 6e4, notifyChannel: "toast" },
  E102: { code: "E102", category: "permanent", message: "LLM content policy violation", userMessage: "Content cannot be processed", retryable: false, notifyChannel: "banner" },
  E103: { code: "E103", category: "transient", message: "LLM service unavailable", userMessage: "AI temporarily unavailable", retryable: true, notifyChannel: "toast" },
  E104: { code: "E104", category: "permanent", message: "LLM context too long", userMessage: "Content too large, try splitting", retryable: false, notifyChannel: "banner" },
  E200: { code: "E200", category: "transient", message: "Embedding request timeout", userMessage: "Processing delayed", retryable: true, notifyChannel: "toast" },
  E201: { code: "E201", category: "rate_limited", message: "Embedding rate limit", userMessage: "Queued for processing", retryable: true, retryAfter: 3e4, notifyChannel: "none" },
  E202: { code: "E202", category: "permanent", message: "Content cannot be embedded", userMessage: "Content format not supported", retryable: false, notifyChannel: "banner" },
  E203: { code: "E203", category: "transient", message: "Embedding service unavailable", userMessage: "Search temporarily limited", retryable: true, notifyChannel: "toast" },
  E300: { code: "E300", category: "transient", message: "Database connection timeout", userMessage: "Saving...", retryable: true, notifyChannel: "none" },
  E301: { code: "E301", category: "transient", message: "Database write conflict", userMessage: "Syncing changes...", retryable: true, notifyChannel: "toast" },
  E302: { code: "E302", category: "permanent", message: "Database constraint violation", userMessage: "Could not save, check for duplicates", retryable: false, notifyChannel: "banner" },
  E303: { code: "E303", category: "system_error", message: "Database connection failed", userMessage: "Connection issue, saved locally", retryable: true, notifyChannel: "banner" },
  E304: { code: "E304", category: "permanent", message: "Storage quota exceeded", userMessage: "Storage full, upgrade or delete content", retryable: false, notifyChannel: "push" },
  E400: { code: "E400", category: "transient", message: "Sync connection failed", userMessage: "Offline mode, will sync later", retryable: true, notifyChannel: "banner" },
  E401: { code: "E401", category: "transient", message: "Sync conflict detected", userMessage: "Resolving changes...", retryable: true, notifyChannel: "toast" },
  E402: { code: "E402", category: "user_error", message: "Sync conflict requires resolution", userMessage: "Please choose which version to keep", retryable: false, notifyChannel: "banner" },
  E403: { code: "E403", category: "permanent", message: "Sync version mismatch", userMessage: "Please refresh the app", retryable: false, notifyChannel: "banner" },
  E404: { code: "E404", category: "transient", message: "Sync server unavailable", userMessage: "Sync paused, will resume", retryable: true, notifyChannel: "banner" },
  E500: { code: "E500", category: "transient", message: "Auth token expired", userMessage: "", retryable: true, notifyChannel: "none" },
  E501: { code: "E501", category: "permanent", message: "Auth token invalid", userMessage: "Please sign in again", retryable: false, notifyChannel: "banner" },
  E502: { code: "E502", category: "permanent", message: "Account suspended", userMessage: "Account issue, contact support", retryable: false, notifyChannel: "push" },
  E503: { code: "E503", category: "user_error", message: "Subscription expired", userMessage: "Subscription ended, renew to continue", retryable: false, notifyChannel: "push" },
  E600: { code: "E600", category: "transient", message: "Network request timeout", userMessage: "Slow connection, retrying...", retryable: true, notifyChannel: "toast" },
  E601: { code: "E601", category: "transient", message: "Network offline", userMessage: "Offline mode active", retryable: true, notifyChannel: "banner" },
  E602: { code: "E602", category: "transient", message: "DNS resolution failed", userMessage: "Connection issue", retryable: true, notifyChannel: "toast" },
  E603: { code: "E603", category: "transient", message: "SSL/TLS error", userMessage: "Secure connection failed", retryable: true, notifyChannel: "banner" }
};
var OPS_ERROR_CODE_KEYS = [
  "E100",
  "E101",
  "E102",
  "E103",
  "E104",
  "E200",
  "E201",
  "E202",
  "E203",
  "E300",
  "E301",
  "E302",
  "E303",
  "E304",
  "E400",
  "E401",
  "E402",
  "E403",
  "E404",
  "E500",
  "E501",
  "E502",
  "E503",
  "E600",
  "E601",
  "E602",
  "E603"
];
var OPS_ERROR_GROUPS = ["llm", "embedding", "database", "sync", "auth", "network"];
var ERROR_GROUP_PREFIXES = {
  "E1": "llm",
  "E2": "embedding",
  "E3": "database",
  "E4": "sync",
  "E5": "auth",
  "E6": "network"
};
var NOTIFICATION_STRATEGY_TYPES = [
  "transient_error",
  "sync_failed",
  "storage_full",
  "offline",
  "online",
  "conflict",
  "auth_expired"
];
var NOTIFICATION_STRATEGY = {
  transient_error: { channel: "toast", priority: "immediate", autoDismissMs: 5e3 },
  sync_failed: { channel: "banner", priority: "immediate", action: { label: "Retry now", handler: "retrySync" } },
  storage_full: { channel: "push", priority: "immediate", action: { label: "Manage storage", handler: "openStorage" } },
  offline: { channel: "banner", priority: "immediate", action: { label: "Check connection", handler: "checkNetwork" } },
  online: { channel: "toast", priority: "immediate", autoDismissMs: 3e3 },
  conflict: { channel: "banner", priority: "immediate", action: { label: "Resolve", handler: "openConflicts" } },
  auth_expired: { channel: "banner", priority: "immediate", action: { label: "Sign in", handler: "openLogin" } }
};
var CACHE_TYPES = ["embedding", "llm_response", "node", "search_result", "edge", "session"];
var CACHE_STORAGE_TIERS = ["memory", "redis", "sqlite"];
var EVICTION_POLICIES = ["lru", "lfu", "ttl"];
var CACHE_WARM_STRATEGIES = ["recent", "frequent", "connected", "none"];
var CACHE_CONFIGS = {
  embedding: { primaryStorage: "redis", fallbackStorage: "sqlite", ttlSeconds: 86400 * 30, maxItems: 1e5, maxBytes: 600 * 1024 * 1024, evictionPolicy: "lru", warmStrategy: "none" },
  llm_response: { primaryStorage: "redis", ttlSeconds: 3600, maxItems: 1e4, maxBytes: 50 * 1024 * 1024, evictionPolicy: "lru", warmStrategy: "none" },
  node: { primaryStorage: "memory", fallbackStorage: "sqlite", ttlSeconds: 300, maxItems: 1e3, maxBytes: 10 * 1024 * 1024, evictionPolicy: "lru", warmStrategy: "recent" },
  search_result: { primaryStorage: "memory", ttlSeconds: 60, maxItems: 500, evictionPolicy: "lru", warmStrategy: "none" },
  edge: { primaryStorage: "memory", fallbackStorage: "sqlite", ttlSeconds: 300, maxItems: 5e3, evictionPolicy: "lru", warmStrategy: "connected" },
  session: { primaryStorage: "redis", ttlSeconds: 86400, maxItems: 1e5, evictionPolicy: "ttl", warmStrategy: "none" }
};
var NETWORK_STATUSES = ["online", "offline", "unknown"];
var NETWORK_MONITOR_CONFIG = {
  checkIntervalMs: 3e4,
  offlineThreshold: 3,
  onlineThreshold: 1,
  endpoints: ["https://api.nous.app/v1/health", "https://1.1.1.1/cdn-cgi/trace"],
  timeoutMs: 5e3
};
var OFFLINE_QUEUE_OP_TYPES = ["sync", "embed", "edge", "other"];
var OFFLINE_QUEUE_CONFIG = {
  storage: "sqlite",
  tableName: "offline_queue",
  maxItemsPerTenant: 1e3,
  maxAgeHours: 168,
  priorityOrder: ["sync", "embed", "edge", "other"],
  onFull: "drop_oldest"
};
var OFFLINE_QUEUE_OVERFLOW = ["drop_oldest", "reject_new"];
var DEGRADABLE_SERVICES = ["redis", "openai_embedding", "openai_llm", "turso_cloud", "inngest", "network"];
var DEGRADATION_MATRIX = {
  redis: { impact: "Cache misses, slower reads", fallback: "SQLite cache tier + memory-only for hot data" },
  openai_embedding: { impact: "No new embeddings", fallback: "Voyage AI fallback, then local model, then queue for later" },
  openai_llm: { impact: "No AI chat/synthesis", fallback: 'Anthropic fallback, then local model, then "AI unavailable"' },
  turso_cloud: { impact: "No sync", fallback: "Local SQLite continues, offline queue grows" },
  inngest: { impact: "No background jobs", fallback: "Sync processing inline, alert ops" },
  network: { impact: "No external services", fallback: "Full offline mode: local search, no AI, queue all operations" }
};
var METRIC_TYPES = ["queue-depth", "cache-hit-rate", "error-rate", "sync-latency"];
function isNBOSJobId(value) {
  return NBOS_JOB_IDS.includes(value);
}
function isNBOSJobName(value) {
  return NBOS_JOB_NAME_VALUES.includes(value);
}
function isJobTriggerType(value) {
  return JOB_TRIGGER_TYPES.includes(value);
}
function isOpsErrorCategory(value) {
  return OPS_ERROR_CATEGORIES.includes(value);
}
function isOpsErrorCode(value) {
  return OPS_ERROR_CODE_KEYS.includes(value);
}
function isNotifyChannel(value) {
  return NOTIFY_CHANNELS.includes(value);
}
function isNotifyPriority(value) {
  return NOTIFY_PRIORITIES.includes(value);
}
function isCacheType(value) {
  return CACHE_TYPES.includes(value);
}
function isCacheStorageTier(value) {
  return CACHE_STORAGE_TIERS.includes(value);
}
function isEvictionPolicy(value) {
  return EVICTION_POLICIES.includes(value);
}
function isCacheWarmStrategy(value) {
  return CACHE_WARM_STRATEGIES.includes(value);
}
function isNetworkStatus(value) {
  return NETWORK_STATUSES.includes(value);
}
function isOfflineQueueOpType(value) {
  return OFFLINE_QUEUE_OP_TYPES.includes(value);
}
function isDegradableService(value) {
  return DEGRADABLE_SERVICES.includes(value);
}
function isMetricType(value) {
  return METRIC_TYPES.includes(value);
}
function isBackoffStrategy(value) {
  return BACKOFF_STRATEGIES.includes(value);
}
function isNotificationStrategyType(value) {
  return NOTIFICATION_STRATEGY_TYPES.includes(value);
}
function isOpsErrorGroup(value) {
  return OPS_ERROR_GROUPS.includes(value);
}
var BaseJobPayloadSchema = z.object({
  tenantId: z.string().min(1),
  correlationId: z.string().min(1),
  triggeredAt: z.string().datetime(),
  triggeredBy: z.enum(JOB_TRIGGER_TYPES)
});
var DecayCyclePayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("decay-cycle"),
  batchSize: z.number().int().positive(),
  offset: z.number().int().nonnegative().optional()
});
var CompressionRunPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("compression-run"),
  clusterId: z.string().optional(),
  dryRun: z.boolean().optional()
});
var CleanupDormantPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("cleanup-dormant"),
  dormantDays: z.number().int().positive(),
  action: z.enum(["archive", "notify", "delete"])
});
var SimilarityBatchPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("similarity-batch"),
  sinceTimestamp: z.string().datetime().optional(),
  threshold: z.number().min(0).max(1)
});
var AccessibilityAuditPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("accessibility-audit"),
  notifyUser: z.boolean()
});
var EmbedSinglePayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("embed-single"),
  nodeId: z.string().min(1),
  content: z.string().min(1),
  priority: z.enum(["high", "normal", "low"])
});
var EmbedBatchPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("embed-batch"),
  nodeIds: z.array(z.string().min(1)).min(1),
  documentId: z.string().optional()
});
var InferEdgesPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("infer-edges"),
  nodeId: z.string().min(1),
  contextNodeIds: z.array(z.string().min(1)).optional()
});
var DeduplicatePayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("deduplicate"),
  nodeId: z.string().min(1),
  similarityThreshold: z.number().min(0).max(1)
});
var SyncRetryPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("sync-retry"),
  syncId: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive()
});
var CacheWarmPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("cache-warm"),
  strategy: z.enum(CACHE_WARM_STRATEGIES),
  limit: z.number().int().positive()
});
var MetricsCollectPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("metrics-collect"),
  metrics: z.array(z.enum(METRIC_TYPES)).min(1)
});
var EmbeddingBackfillPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("embedding-backfill"),
  batchSize: z.number().int().positive(),
  priority: z.enum(["stale", "failed", "missing"])
});
var DLQProcessPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal("dlq-process"),
  limit: z.number().int().positive(),
  retryEligible: z.boolean()
});
var NBOSJobPayloadSchema = z.discriminatedUnion("type", [
  DecayCyclePayloadSchema,
  CompressionRunPayloadSchema,
  CleanupDormantPayloadSchema,
  SimilarityBatchPayloadSchema,
  AccessibilityAuditPayloadSchema,
  EmbedSinglePayloadSchema,
  EmbedBatchPayloadSchema,
  InferEdgesPayloadSchema,
  DeduplicatePayloadSchema,
  SyncRetryPayloadSchema,
  CacheWarmPayloadSchema,
  MetricsCollectPayloadSchema,
  EmbeddingBackfillPayloadSchema,
  DLQProcessPayloadSchema
]);
var JobFailureConfigSchema = z.object({
  retries: z.number().int().nonnegative(),
  backoff: z.enum(BACKOFF_STRATEGIES),
  baseDelayMs: z.number().int().positive(),
  maxDelayMs: z.number().int().positive(),
  deadLetterAfter: z.number().int().positive(),
  alertAfter: z.number().int().positive(),
  userNotify: z.boolean(),
  notifyChannel: z.enum(NOTIFY_CHANNELS)
});
var NousOperationalErrorSchema = z.object({
  code: z.enum(OPS_ERROR_CODE_KEYS),
  category: z.enum(OPS_ERROR_CATEGORIES),
  message: z.string(),
  userMessage: z.string(),
  retryable: z.boolean(),
  retryAfter: z.number().int().positive().optional(),
  notifyChannel: z.enum(NOTIFY_CHANNELS),
  context: z.record(z.string(), z.unknown()).optional()
});
var CacheConfigSchema = z.object({
  primaryStorage: z.enum(CACHE_STORAGE_TIERS),
  fallbackStorage: z.enum(CACHE_STORAGE_TIERS).optional(),
  ttlSeconds: z.number().int().positive(),
  maxItems: z.number().int().positive(),
  maxBytes: z.number().int().positive().optional(),
  evictionPolicy: z.enum(EVICTION_POLICIES),
  warmStrategy: z.enum(CACHE_WARM_STRATEGIES)
});
var CacheMetricsSchema = z.object({
  cacheType: z.enum(CACHE_TYPES),
  storage: z.enum(CACHE_STORAGE_TIERS),
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  hitRate: z.number().min(0).max(1),
  itemCount: z.number().int().nonnegative(),
  maxItems: z.number().int().positive(),
  bytesUsed: z.number().int().nonnegative(),
  maxBytes: z.number().int().nonnegative(),
  evictions: z.number().int().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
  p99LatencyMs: z.number().nonnegative()
});
var CacheStatsSchema = z.object({
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  bytesUsed: z.number().int().nonnegative(),
  evictions: z.number().int().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
  p99LatencyMs: z.number().nonnegative()
});
var NetworkMonitorConfigSchema = z.object({
  checkIntervalMs: z.number().int().positive(),
  offlineThreshold: z.number().int().positive(),
  onlineThreshold: z.number().int().positive(),
  endpoints: z.array(z.string().url()).min(1),
  timeoutMs: z.number().int().positive()
});
var QueuedOperationSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  type: z.enum(OFFLINE_QUEUE_OP_TYPES),
  payload: z.unknown(),
  createdAt: z.string().datetime(),
  priority: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  lastAttempt: z.string().datetime().optional(),
  error: z.string().optional()
});
var NotificationConfigSchema = z.object({
  channel: z.enum(NOTIFY_CHANNELS),
  priority: z.enum(NOTIFY_PRIORITIES),
  autoDismissMs: z.number().int().positive().optional(),
  action: z.object({
    label: z.string().min(1),
    handler: z.string().min(1)
  }).optional()
});
var DegradationActionSchema = z.object({
  service: z.enum(DEGRADABLE_SERVICES),
  impact: z.string().min(1),
  fallback: z.string().min(1)
});
var EMBEDDING_BACKFILL_PRIORITIES = ["stale", "failed", "missing"];
var CLEANUP_ACTIONS = ["archive", "notify", "delete"];
var EMBED_PRIORITIES = ["high", "normal", "low"];

// src/operations/jobs.ts
function getJobSchedule(jobId) {
  return NBOS_CRON_SCHEDULES[jobId] ?? null;
}
function getJobBatchSize(jobId) {
  return NBOS_BATCH_SIZES[jobId] ?? null;
}
function getJobTimeout(jobId) {
  return NBOS_TIMEOUTS[jobId] ?? 3e4;
}
function getJobConcurrency(jobId) {
  return NBOS_CONCURRENCY[jobId] ?? 1;
}
function getJobPriority(jobId) {
  return NBOS_JOB_PRIORITIES[jobId] ?? "normal";
}
function getJobName(jobId) {
  return NBOS_JOB_NAMES[jobId] ?? jobId;
}
function getJobDependencies(jobId) {
  return NBOS_JOB_DEPENDENCIES[jobId] ?? [];
}
function isJobBlocked(jobId, completedJobs) {
  const deps = getJobDependencies(jobId);
  if (deps.length === 0) {
    return false;
  }
  const completedSet = new Set(completedJobs);
  return deps.some((dep) => !completedSet.has(dep));
}
function getJobFailureConfig(jobName) {
  const entry = JOB_FAILURE_CONFIGS[jobName];
  if (!entry) {
    return void 0;
  }
  return {
    retries: entry.retries,
    backoff: entry.backoff,
    baseDelayMs: entry.baseDelayMs,
    maxDelayMs: entry.maxDelayMs,
    deadLetterAfter: entry.deadLetterAfter,
    alertAfter: entry.alertAfter,
    userNotify: entry.userNotify,
    notifyChannel: entry.notifyChannel
  };
}
function calculateRetryDelay(config, attempt) {
  const strategy = config.backoff;
  switch (strategy) {
    case "exponential":
      return Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
    case "linear":
      return Math.min(config.baseDelayMs * (attempt + 1), config.maxDelayMs);
    case "fixed":
      return config.baseDelayMs;
    default: {
      const _exhaustive = strategy;
      throw new Error(`Unknown backoff strategy: ${_exhaustive}`);
    }
  }
}
function shouldDeadLetter(config, attempts) {
  return attempts >= config.deadLetterAfter;
}
function shouldAlertOps(config, failures) {
  return failures >= config.alertAfter;
}
function isNBOSCronJob(jobId) {
  return NBOS_CRON_JOBS.includes(jobId);
}
function isNBOSEventJob(jobId) {
  return NBOS_EVENT_JOBS.includes(jobId);
}
function getDailyChainOrder() {
  return DAILY_CHAIN_ORDER;
}
function createJobPayload(payload) {
  return {
    ...payload,
    correlationId: generateCorrelationId(),
    triggeredAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function generateCorrelationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${hex()}-${hex()}${hex()}${hex()}`;
}

// src/operations/errors.ts
function createOperationalError(code, context) {
  const entry = OPS_ERROR_CODES[code];
  if (!entry) {
    throw new Error(`Unknown operational error code: ${code}`);
  }
  return {
    code,
    category: entry.category,
    message: entry.message,
    userMessage: entry.userMessage,
    retryable: entry.retryable,
    retryAfter: "retryAfter" in entry ? entry.retryAfter : void 0,
    notifyChannel: entry.notifyChannel,
    context
  };
}
function isRetryableError(error) {
  return error.retryable === true;
}
function getRetryAfter(error) {
  return error.retryAfter;
}
function getNotificationForError(error) {
  if (error.category === "transient") {
    const strategy = NOTIFICATION_STRATEGY["transient_error"];
    if (strategy) {
      return {
        channel: strategy.channel,
        priority: strategy.priority,
        autoDismissMs: strategy.autoDismissMs,
        action: strategy.action ? { label: strategy.action.label, handler: strategy.action.handler } : void 0
      };
    }
  }
  const group = getErrorGroup(error.code);
  if (group === "sync") {
    const strategy = NOTIFICATION_STRATEGY["sync_failed"];
    if (strategy) {
      return {
        channel: strategy.channel,
        priority: strategy.priority,
        autoDismissMs: strategy.autoDismissMs,
        action: strategy.action ? { label: strategy.action.label, handler: strategy.action.handler } : void 0
      };
    }
  }
  if (group === "auth") {
    const strategy = NOTIFICATION_STRATEGY["auth_expired"];
    if (strategy) {
      return {
        channel: strategy.channel,
        priority: strategy.priority,
        autoDismissMs: strategy.autoDismissMs,
        action: strategy.action ? { label: strategy.action.label, handler: strategy.action.handler } : void 0
      };
    }
  }
  if (error.code === "E304") {
    const strategy = NOTIFICATION_STRATEGY["storage_full"];
    if (strategy) {
      return {
        channel: strategy.channel,
        priority: strategy.priority,
        autoDismissMs: strategy.autoDismissMs,
        action: strategy.action ? { label: strategy.action.label, handler: strategy.action.handler } : void 0
      };
    }
  }
  if (group === "network" && error.code === "E601") {
    const strategy = NOTIFICATION_STRATEGY["offline"];
    if (strategy) {
      return {
        channel: strategy.channel,
        priority: strategy.priority,
        autoDismissMs: strategy.autoDismissMs,
        action: strategy.action ? { label: strategy.action.label, handler: strategy.action.handler } : void 0
      };
    }
  }
  return {
    channel: error.notifyChannel,
    priority: "immediate"
  };
}
function classifyError(error) {
  const msg = extractErrorMessage(error).toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout")) {
    if (msg.includes("llm") || msg.includes("openai") || msg.includes("anthropic") || msg.includes("completion")) {
      return "E100";
    }
    if (msg.includes("embed") || msg.includes("vector")) {
      return "E200";
    }
    if (msg.includes("db") || msg.includes("database") || msg.includes("sql")) {
      return "E300";
    }
    return "E600";
  }
  if (msg.includes("rate limit") || msg.includes("rate_limit") || msg.includes("429") || msg.includes("too many requests")) {
    if (msg.includes("embed") || msg.includes("vector")) {
      return "E201";
    }
    return "E101";
  }
  if (msg.includes("token expired") || msg.includes("jwt expired") || msg.includes("token_expired")) {
    return "E500";
  }
  if (msg.includes("unauthorized") || msg.includes("401") || msg.includes("forbidden") || msg.includes("403")) {
    return "E501";
  }
  if (msg.includes("sync") && msg.includes("conflict")) {
    return "E401";
  }
  if (msg.includes("sync") && (msg.includes("fail") || msg.includes("error"))) {
    return "E400";
  }
  if (msg.includes("econnrefused") || msg.includes("connection refused") || msg.includes("econnreset")) {
    return "E601";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("enotfound") || msg.includes("dns")) {
    return "E602";
  }
  if (msg.includes("constraint") || msg.includes("unique") || msg.includes("duplicate")) {
    return "E302";
  }
  if (msg.includes("database") || msg.includes("sql") || msg.includes("db")) {
    return "E303";
  }
  if (msg.includes("quota") || msg.includes("storage full") || msg.includes("disk full")) {
    return "E304";
  }
  return "E303";
}
function isTransientError(error) {
  return error.category === "transient";
}
function isRateLimitedError(error) {
  return error.category === "rate_limited";
}
function isPermanentError(error) {
  return error.category === "permanent";
}
function isUserError(error) {
  return error.category === "user_error";
}
function isSystemError(error) {
  return error.category === "system_error";
}
function getErrorGroup(code) {
  const prefix = code.slice(0, 2);
  const group = ERROR_GROUP_PREFIXES[prefix];
  return group ?? "network";
}
function extractErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error !== null && error !== void 0 && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

// src/operations/cache.ts
function getCacheConfig(cacheType) {
  const config = CACHE_CONFIGS[cacheType];
  if (!config) {
    throw new Error(`Unknown cache type: ${cacheType}`);
  }
  return {
    primaryStorage: config.primaryStorage,
    fallbackStorage: config.fallbackStorage,
    ttlSeconds: config.ttlSeconds,
    maxItems: config.maxItems,
    maxBytes: config.maxBytes,
    evictionPolicy: config.evictionPolicy,
    warmStrategy: config.warmStrategy
  };
}
function generateEmbeddingCacheKey(content, hashFn) {
  const normalized = normalizeForEmbedding(content);
  const hash = hashFn(normalized);
  return `emb:${normalized.length}:${hash}`;
}
function generateLLMCacheKey(operation, model, prompt, hashFn) {
  const hash = hashFn(prompt);
  return `llm:${operation}:${model}:${prompt.length}:${hash}`;
}
function generateNodeCacheKey(tenantId, nodeId, version) {
  const base = `node:${tenantId}:${nodeId}`;
  if (version !== void 0) {
    return `${base}:v${version}`;
  }
  return base;
}
function generateSearchCacheKey(tenantId, query, filters, hashFn) {
  const queryHash = hashFn(query);
  const filtersHash = hashFn(stableStringify(filters));
  return `search:${tenantId}:${queryHash}:${filtersHash}`;
}
function generateEdgeCacheKey(tenantId, nodeId) {
  return `edges:${tenantId}:${nodeId}`;
}
function generateSessionCacheKey(sessionId) {
  return `session:${sessionId}`;
}
function normalizeForEmbedding(content) {
  return content.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 8e3);
}
function getTTLSeconds(cacheType) {
  return getCacheConfig(cacheType).ttlSeconds;
}
function getMaxItems(cacheType) {
  return getCacheConfig(cacheType).maxItems;
}
function calculateHitRate(hits, misses) {
  const total = hits + misses;
  if (total === 0) {
    return 0;
  }
  return hits / total;
}
function shouldEvict(metrics) {
  return metrics.itemCount >= metrics.maxItems;
}
function selectWarmStrategy(cacheType) {
  return getCacheConfig(cacheType).warmStrategy;
}
function createEmptyCacheMetrics(cacheType) {
  const config = getCacheConfig(cacheType);
  return {
    cacheType,
    storage: config.primaryStorage,
    hits: 0,
    misses: 0,
    hitRate: 0,
    itemCount: 0,
    maxItems: config.maxItems,
    bytesUsed: 0,
    maxBytes: config.maxBytes ?? 0,
    evictions: 0,
    avgLatencyMs: 0,
    p99LatencyMs: 0
  };
}
function stableStringify(obj) {
  const sortedKeys = Object.keys(obj).sort();
  const sorted = {};
  for (const key of sortedKeys) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

// src/operations/network.ts
function evaluateNetworkStatus(consecutiveFailures, consecutiveSuccesses) {
  if (consecutiveFailures >= NETWORK_MONITOR_CONFIG.offlineThreshold) {
    return "offline";
  }
  if (consecutiveSuccesses >= NETWORK_MONITOR_CONFIG.onlineThreshold) {
    return "online";
  }
  return "unknown";
}
function shouldGoOffline(consecutiveFailures) {
  return consecutiveFailures >= NETWORK_MONITOR_CONFIG.offlineThreshold;
}
function shouldGoOnline(currentStatus, successCount) {
  if (currentStatus === "online") {
    return false;
  }
  return successCount >= NETWORK_MONITOR_CONFIG.onlineThreshold;
}
function createQueuedOperation(tenantId, type, payload) {
  return {
    _schemaVersion: 1,
    id: generateQueueId(),
    tenantId,
    type,
    payload,
    priority: getQueuePriority(type),
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    attempts: 0
  };
}
function getQueuePriority(type) {
  const index = OFFLINE_QUEUE_CONFIG.priorityOrder.indexOf(type);
  return index >= 0 ? index : OFFLINE_QUEUE_CONFIG.priorityOrder.length;
}
function isQueueFull(currentCount) {
  return currentCount >= OFFLINE_QUEUE_CONFIG.maxItemsPerTenant;
}
function isQueueEntryExpired(createdAt, now) {
  const created = new Date(createdAt).getTime();
  const reference = (now ?? /* @__PURE__ */ new Date()).getTime();
  const maxAgeMs = OFFLINE_QUEUE_CONFIG.maxAgeHours * 60 * 60 * 1e3;
  return reference - created > maxAgeMs;
}
function sortQueueByPriority(operations) {
  return [...operations].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}
function generateQueueId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${hex()}-${hex()}${hex()}${hex()}`;
}

// src/operations/degradation.ts
var FEATURE_SERVICE_REQUIREMENTS = {
  "ai-chat": ["openai_llm", "network"],
  "ai-extraction": ["openai_llm", "network"],
  "ai-summarization": ["openai_llm", "network"],
  "semantic-search": ["openai_embedding", "network"],
  "similarity-detection": ["openai_embedding", "network"],
  "embedding-generation": ["openai_embedding", "network"],
  "multi-device-sync": ["turso_cloud", "network"],
  "cloud-backup": ["turso_cloud", "network"],
  "background-jobs": ["inngest", "network"],
  "batch-processing": ["inngest", "network"],
  "cached-reads": ["redis"],
  "local-search": [],
  "note-editing": [],
  "graph-browsing": [],
  "offline-queue": []
};
function getDegradationAction(service) {
  const entry = DEGRADATION_MATRIX[service];
  if (!entry) {
    throw new Error(`Unknown degradable service: ${service}`);
  }
  return {
    service,
    impact: entry.impact,
    fallback: entry.fallback
  };
}
function getActiveFallbacks(downServices) {
  const seen = /* @__PURE__ */ new Set();
  const actions = [];
  for (const service of downServices) {
    if (seen.has(service)) {
      continue;
    }
    seen.add(service);
    const entry = DEGRADATION_MATRIX[service];
    if (entry) {
      actions.push({
        service,
        impact: entry.impact,
        fallback: entry.fallback
      });
    }
  }
  return actions;
}
function isFullOfflineMode(downServices) {
  return downServices.includes("network");
}
function getAvailableFeatures(downServices) {
  const downSet = new Set(downServices);
  const available = [];
  for (const [feature, requiredServices] of Object.entries(FEATURE_SERVICE_REQUIREMENTS)) {
    const isBlocked = requiredServices.some((svc) => downSet.has(svc));
    if (!isBlocked) {
      available.push(feature);
    }
  }
  return available;
}

export { AccessibilityAuditPayloadSchema, BACKOFF_STRATEGIES, BaseJobPayloadSchema, CACHE_CONFIGS, CACHE_STORAGE_TIERS, CACHE_TYPES, CACHE_WARM_STRATEGIES, CLEANUP_ACTIONS, CacheConfigSchema, CacheMetricsSchema, CacheStatsSchema, CacheWarmPayloadSchema, CleanupDormantPayloadSchema, CompressionRunPayloadSchema, DAILY_CHAIN_ORDER, DEGRADABLE_SERVICES, DEGRADATION_MATRIX, DLQProcessPayloadSchema, DecayCyclePayloadSchema, DeduplicatePayloadSchema, DegradationActionSchema, EMBEDDING_BACKFILL_PRIORITIES, EMBED_PRIORITIES, ERROR_GROUP_PREFIXES, EVICTION_POLICIES, EmbedBatchPayloadSchema, EmbedSinglePayloadSchema, EmbeddingBackfillPayloadSchema, InferEdgesPayloadSchema, JOB_FAILURE_CONFIGS, JOB_TRIGGER_TYPES, JobFailureConfigSchema, METRIC_TYPES, MetricsCollectPayloadSchema, NBOSJobPayloadSchema, NBOS_BATCH_SIZES, NBOS_CONCURRENCY, NBOS_CRON_JOBS, NBOS_CRON_SCHEDULES, NBOS_EVENT_JOBS, NBOS_JOB_DEPENDENCIES, NBOS_JOB_IDS, NBOS_JOB_NAMES, NBOS_JOB_NAME_VALUES, NBOS_JOB_PRIORITIES, NBOS_TIMEOUTS, NETWORK_MONITOR_CONFIG, NETWORK_STATUSES, NOTIFICATION_STRATEGY, NOTIFICATION_STRATEGY_TYPES, NOTIFY_CHANNELS, NOTIFY_PRIORITIES, NetworkMonitorConfigSchema, NotificationConfigSchema, NousOperationalErrorSchema, OFFLINE_QUEUE_CONFIG, OFFLINE_QUEUE_OP_TYPES, OFFLINE_QUEUE_OVERFLOW, OPS_ERROR_CATEGORIES, OPS_ERROR_CODES, OPS_ERROR_CODE_KEYS, OPS_ERROR_GROUPS, QueuedOperationSchema, SimilarityBatchPayloadSchema, SyncRetryPayloadSchema, calculateHitRate, calculateRetryDelay, classifyError, createEmptyCacheMetrics, createJobPayload, createOperationalError, createQueuedOperation, evaluateNetworkStatus, generateEdgeCacheKey, generateEmbeddingCacheKey, generateLLMCacheKey, generateNodeCacheKey, generateSearchCacheKey, generateSessionCacheKey, getActiveFallbacks, getAvailableFeatures, getCacheConfig, getDailyChainOrder, getDegradationAction, getErrorGroup, getJobBatchSize, getJobConcurrency, getJobDependencies, getJobFailureConfig, getJobName, getJobPriority, getJobSchedule, getJobTimeout, getMaxItems, getNotificationForError, getQueuePriority, getRetryAfter, getTTLSeconds, isBackoffStrategy, isCacheStorageTier, isCacheType, isCacheWarmStrategy, isDegradableService, isEvictionPolicy, isFullOfflineMode, isJobBlocked, isJobTriggerType, isMetricType, isNBOSCronJob, isNBOSEventJob, isNBOSJobId, isNBOSJobName, isNetworkStatus, isNotificationStrategyType, isNotifyChannel, isNotifyPriority, isOfflineQueueOpType, isOpsErrorCategory, isOpsErrorCode, isOpsErrorGroup, isPermanentError, isQueueEntryExpired, isQueueFull, isRateLimitedError, isRetryableError, isSystemError, isTransientError, isUserError, normalizeForEmbedding, selectWarmStrategy, shouldAlertOps, shouldDeadLetter, shouldEvict, shouldGoOffline, shouldGoOnline, sortQueueByPriority };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map