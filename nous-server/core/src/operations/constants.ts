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

// ============================================================
// JOB SYSTEM CONSTANTS
// ============================================================

export const NBOS_JOB_IDS = [
  'J-001', 'J-002', 'J-003', 'J-004', 'J-005',
  'J-006', 'J-007', 'J-008', 'J-009', 'J-010',
  'J-011', 'J-012', 'J-013', 'J-014',
] as const;

export type NBOSJobId = typeof NBOS_JOB_IDS[number];

export const NBOS_JOB_NAMES: Record<NBOSJobId, string> = {
  'J-001': 'decay-cycle',
  'J-002': 'compression-run',
  'J-003': 'cleanup-dormant',
  'J-004': 'similarity-batch',
  'J-005': 'accessibility-audit',
  'J-006': 'embed-single',
  'J-007': 'embed-batch',
  'J-008': 'infer-edges',
  'J-009': 'deduplicate',
  'J-010': 'sync-retry',
  'J-011': 'cache-warm',
  'J-012': 'metrics-collect',
  'J-013': 'embedding-backfill',
  'J-014': 'dlq-process',
};

export const NBOS_JOB_NAME_VALUES = [
  'decay-cycle', 'compression-run', 'cleanup-dormant', 'similarity-batch',
  'accessibility-audit', 'embed-single', 'embed-batch', 'infer-edges',
  'deduplicate', 'sync-retry', 'cache-warm', 'metrics-collect',
  'embedding-backfill', 'dlq-process',
] as const;

export type NBOSJobName = typeof NBOS_JOB_NAME_VALUES[number];

export const NBOS_CRON_SCHEDULES: Partial<Record<NBOSJobId, string>> = {
  'J-001': '0 3 * * *',
  'J-002': '0 5 * * 0',
  'J-003': '0 6 1 * *',
  'J-004': '0 1 * * *',
  'J-005': '0 7 1 * *',
  'J-011': '*/30 * * * *',
  'J-012': '*/5 * * * *',
  'J-013': '0 0 * * *',
  'J-014': '0 * * * *',
};

export const JOB_TRIGGER_TYPES = ['cron', 'event', 'manual', 'retry'] as const;
export type JobTriggerType = typeof JOB_TRIGGER_TYPES[number];

export const NBOS_CRON_JOBS: readonly NBOSJobId[] = [
  'J-001', 'J-002', 'J-003', 'J-004', 'J-005',
  'J-011', 'J-012', 'J-013', 'J-014',
] as const;

export const NBOS_EVENT_JOBS: readonly NBOSJobId[] = [
  'J-006', 'J-007', 'J-008', 'J-009', 'J-010',
] as const;

export const NBOS_BATCH_SIZES: Record<NBOSJobId, number | null> = {
  'J-001': 1000,
  'J-002': 500,
  'J-003': 100,
  'J-004': 500,
  'J-005': null,
  'J-006': 1,
  'J-007': 50,
  'J-008': 10,
  'J-009': 1,
  'J-010': 1,
  'J-011': 100,
  'J-012': null,
  'J-013': 100,
  'J-014': 50,
};

export const NBOS_TIMEOUTS: Record<NBOSJobId, number> = {
  'J-001': 10 * 60 * 1000,
  'J-002': 30 * 60 * 1000,
  'J-003': 15 * 60 * 1000,
  'J-004': 20 * 60 * 1000,
  'J-005': 30 * 60 * 1000,
  'J-006': 30 * 1000,
  'J-007': 2 * 60 * 1000,
  'J-008': 60 * 1000,
  'J-009': 30 * 1000,
  'J-010': 60 * 1000,
  'J-011': 5 * 60 * 1000,
  'J-012': 60 * 1000,
  'J-013': 15 * 60 * 1000,
  'J-014': 5 * 60 * 1000,
};

export const NBOS_CONCURRENCY: Record<NBOSJobId, number> = {
  'J-001': 1, 'J-002': 1, 'J-003': 1, 'J-004': 1, 'J-005': 1,
  'J-006': 10, 'J-007': 3, 'J-008': 5, 'J-009': 5, 'J-010': 5,
  'J-011': 1, 'J-012': 1, 'J-013': 1, 'J-014': 1,
};

export const NBOS_JOB_PRIORITIES: Record<NBOSJobId, 'high' | 'normal' | 'low'> = {
  'J-001': 'low', 'J-002': 'low', 'J-003': 'low', 'J-004': 'low', 'J-005': 'low',
  'J-006': 'high', 'J-007': 'normal', 'J-008': 'normal', 'J-009': 'normal', 'J-010': 'high',
  'J-011': 'low', 'J-012': 'low', 'J-013': 'low', 'J-014': 'low',
};

export const NBOS_JOB_DEPENDENCIES: Partial<Record<NBOSJobId, readonly NBOSJobId[]>> = {
  'J-001': ['J-004'],
  'J-002': ['J-001'],
  'J-004': ['J-013'],
  'J-008': ['J-006'],
  'J-009': ['J-006'],
};

export const DAILY_CHAIN_ORDER: readonly NBOSJobId[] = ['J-013', 'J-004', 'J-001'] as const;

// ============================================================
// JOB FAILURE CONFIGURATION
// ============================================================

export const BACKOFF_STRATEGIES = ['exponential', 'linear', 'fixed'] as const;
export type BackoffStrategy = typeof BACKOFF_STRATEGIES[number];

export const JOB_FAILURE_CONFIGS: Record<string, {
  readonly retries: number;
  readonly backoff: BackoffStrategy;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly deadLetterAfter: number;
  readonly alertAfter: number;
  readonly userNotify: boolean;
  readonly notifyChannel: 'toast' | 'banner' | 'push' | 'none';
}> = {
  'decay-cycle': { retries: 3, backoff: 'fixed', baseDelayMs: 60_000, maxDelayMs: 300_000, deadLetterAfter: 3, alertAfter: 2, userNotify: false, notifyChannel: 'none' },
  'compression-run': { retries: 2, backoff: 'fixed', baseDelayMs: 300_000, maxDelayMs: 600_000, deadLetterAfter: 2, alertAfter: 1, userNotify: false, notifyChannel: 'none' },
  'cleanup-dormant': { retries: 2, backoff: 'fixed', baseDelayMs: 300_000, maxDelayMs: 600_000, deadLetterAfter: 2, alertAfter: 1, userNotify: false, notifyChannel: 'none' },
  'similarity-batch': { retries: 2, backoff: 'fixed', baseDelayMs: 300_000, maxDelayMs: 600_000, deadLetterAfter: 2, alertAfter: 1, userNotify: false, notifyChannel: 'none' },
  'accessibility-audit': { retries: 2, backoff: 'fixed', baseDelayMs: 300_000, maxDelayMs: 600_000, deadLetterAfter: 2, alertAfter: 1, userNotify: false, notifyChannel: 'none' },
  'embedding-backfill': { retries: 2, backoff: 'fixed', baseDelayMs: 300_000, maxDelayMs: 600_000, deadLetterAfter: 2, alertAfter: 1, userNotify: false, notifyChannel: 'none' },
  'cache-warm': { retries: 1, backoff: 'fixed', baseDelayMs: 60_000, maxDelayMs: 60_000, deadLetterAfter: 1, alertAfter: 1, userNotify: false, notifyChannel: 'none' },
  'metrics-collect': { retries: 1, backoff: 'fixed', baseDelayMs: 30_000, maxDelayMs: 30_000, deadLetterAfter: 1, alertAfter: 3, userNotify: false, notifyChannel: 'none' },
  'dlq-process': { retries: 1, backoff: 'fixed', baseDelayMs: 60_000, maxDelayMs: 60_000, deadLetterAfter: 1, alertAfter: 1, userNotify: false, notifyChannel: 'none' },
  'embed-single': { retries: 4, backoff: 'exponential', baseDelayMs: 1_000, maxDelayMs: 60_000, deadLetterAfter: 4, alertAfter: 3, userNotify: true, notifyChannel: 'toast' },
  'embed-batch': { retries: 3, backoff: 'exponential', baseDelayMs: 2_000, maxDelayMs: 60_000, deadLetterAfter: 3, alertAfter: 2, userNotify: false, notifyChannel: 'none' },
  'infer-edges': { retries: 3, backoff: 'exponential', baseDelayMs: 2_000, maxDelayMs: 30_000, deadLetterAfter: 3, alertAfter: 2, userNotify: false, notifyChannel: 'none' },
  'deduplicate': { retries: 3, backoff: 'exponential', baseDelayMs: 2_000, maxDelayMs: 30_000, deadLetterAfter: 3, alertAfter: 2, userNotify: false, notifyChannel: 'none' },
  'sync-retry': { retries: 5, backoff: 'exponential', baseDelayMs: 1_000, maxDelayMs: 30_000, deadLetterAfter: 5, alertAfter: 3, userNotify: true, notifyChannel: 'banner' },
};

// ============================================================
// OPERATIONAL ERROR CODES (E1xx - E6xx)
// ============================================================

export const OPS_ERROR_CATEGORIES = ['transient', 'rate_limited', 'permanent', 'user_error', 'system_error'] as const;
export type OpsErrorCategory = typeof OPS_ERROR_CATEGORIES[number];

export const NOTIFY_CHANNELS = ['toast', 'banner', 'push', 'none'] as const;
export type NotifyChannel = typeof NOTIFY_CHANNELS[number];

export const NOTIFY_PRIORITIES = ['immediate', 'next_session', 'digest'] as const;
export type NotifyPriority = typeof NOTIFY_PRIORITIES[number];

export const OPS_ERROR_CODES = {
  E100: { code: 'E100' as const, category: 'transient' as const, message: 'LLM request timeout', userMessage: 'AI is thinking... please wait', retryable: true, notifyChannel: 'toast' as const },
  E101: { code: 'E101' as const, category: 'rate_limited' as const, message: 'LLM rate limit exceeded', userMessage: 'High demand, retrying shortly', retryable: true, retryAfter: 60_000, notifyChannel: 'toast' as const },
  E102: { code: 'E102' as const, category: 'permanent' as const, message: 'LLM content policy violation', userMessage: 'Content cannot be processed', retryable: false, notifyChannel: 'banner' as const },
  E103: { code: 'E103' as const, category: 'transient' as const, message: 'LLM service unavailable', userMessage: 'AI temporarily unavailable', retryable: true, notifyChannel: 'toast' as const },
  E104: { code: 'E104' as const, category: 'permanent' as const, message: 'LLM context too long', userMessage: 'Content too large, try splitting', retryable: false, notifyChannel: 'banner' as const },
  E200: { code: 'E200' as const, category: 'transient' as const, message: 'Embedding request timeout', userMessage: 'Processing delayed', retryable: true, notifyChannel: 'toast' as const },
  E201: { code: 'E201' as const, category: 'rate_limited' as const, message: 'Embedding rate limit', userMessage: 'Queued for processing', retryable: true, retryAfter: 30_000, notifyChannel: 'none' as const },
  E202: { code: 'E202' as const, category: 'permanent' as const, message: 'Content cannot be embedded', userMessage: 'Content format not supported', retryable: false, notifyChannel: 'banner' as const },
  E203: { code: 'E203' as const, category: 'transient' as const, message: 'Embedding service unavailable', userMessage: 'Search temporarily limited', retryable: true, notifyChannel: 'toast' as const },
  E300: { code: 'E300' as const, category: 'transient' as const, message: 'Database connection timeout', userMessage: 'Saving...', retryable: true, notifyChannel: 'none' as const },
  E301: { code: 'E301' as const, category: 'transient' as const, message: 'Database write conflict', userMessage: 'Syncing changes...', retryable: true, notifyChannel: 'toast' as const },
  E302: { code: 'E302' as const, category: 'permanent' as const, message: 'Database constraint violation', userMessage: 'Could not save, check for duplicates', retryable: false, notifyChannel: 'banner' as const },
  E303: { code: 'E303' as const, category: 'system_error' as const, message: 'Database connection failed', userMessage: 'Connection issue, saved locally', retryable: true, notifyChannel: 'banner' as const },
  E304: { code: 'E304' as const, category: 'permanent' as const, message: 'Storage quota exceeded', userMessage: 'Storage full, upgrade or delete content', retryable: false, notifyChannel: 'push' as const },
  E400: { code: 'E400' as const, category: 'transient' as const, message: 'Sync connection failed', userMessage: 'Offline mode, will sync later', retryable: true, notifyChannel: 'banner' as const },
  E401: { code: 'E401' as const, category: 'transient' as const, message: 'Sync conflict detected', userMessage: 'Resolving changes...', retryable: true, notifyChannel: 'toast' as const },
  E402: { code: 'E402' as const, category: 'user_error' as const, message: 'Sync conflict requires resolution', userMessage: 'Please choose which version to keep', retryable: false, notifyChannel: 'banner' as const },
  E403: { code: 'E403' as const, category: 'permanent' as const, message: 'Sync version mismatch', userMessage: 'Please refresh the app', retryable: false, notifyChannel: 'banner' as const },
  E404: { code: 'E404' as const, category: 'transient' as const, message: 'Sync server unavailable', userMessage: 'Sync paused, will resume', retryable: true, notifyChannel: 'banner' as const },
  E500: { code: 'E500' as const, category: 'transient' as const, message: 'Auth token expired', userMessage: '', retryable: true, notifyChannel: 'none' as const },
  E501: { code: 'E501' as const, category: 'permanent' as const, message: 'Auth token invalid', userMessage: 'Please sign in again', retryable: false, notifyChannel: 'banner' as const },
  E502: { code: 'E502' as const, category: 'permanent' as const, message: 'Account suspended', userMessage: 'Account issue, contact support', retryable: false, notifyChannel: 'push' as const },
  E503: { code: 'E503' as const, category: 'user_error' as const, message: 'Subscription expired', userMessage: 'Subscription ended, renew to continue', retryable: false, notifyChannel: 'push' as const },
  E600: { code: 'E600' as const, category: 'transient' as const, message: 'Network request timeout', userMessage: 'Slow connection, retrying...', retryable: true, notifyChannel: 'toast' as const },
  E601: { code: 'E601' as const, category: 'transient' as const, message: 'Network offline', userMessage: 'Offline mode active', retryable: true, notifyChannel: 'banner' as const },
  E602: { code: 'E602' as const, category: 'transient' as const, message: 'DNS resolution failed', userMessage: 'Connection issue', retryable: true, notifyChannel: 'toast' as const },
  E603: { code: 'E603' as const, category: 'transient' as const, message: 'SSL/TLS error', userMessage: 'Secure connection failed', retryable: true, notifyChannel: 'banner' as const },
} as const;

export type OpsErrorCode = keyof typeof OPS_ERROR_CODES;

export const OPS_ERROR_CODE_KEYS: readonly OpsErrorCode[] = [
  'E100', 'E101', 'E102', 'E103', 'E104',
  'E200', 'E201', 'E202', 'E203',
  'E300', 'E301', 'E302', 'E303', 'E304',
  'E400', 'E401', 'E402', 'E403', 'E404',
  'E500', 'E501', 'E502', 'E503',
  'E600', 'E601', 'E602', 'E603',
] as const;

export const OPS_ERROR_GROUPS = ['llm', 'embedding', 'database', 'sync', 'auth', 'network'] as const;
export type OpsErrorGroup = typeof OPS_ERROR_GROUPS[number];

export const ERROR_GROUP_PREFIXES: Record<string, OpsErrorGroup> = {
  'E1': 'llm', 'E2': 'embedding', 'E3': 'database', 'E4': 'sync', 'E5': 'auth', 'E6': 'network',
};

// ============================================================
// NOTIFICATION STRATEGY
// ============================================================

export const NOTIFICATION_STRATEGY_TYPES = [
  'transient_error', 'sync_failed', 'storage_full', 'offline',
  'online', 'conflict', 'auth_expired',
] as const;
export type NotificationStrategyType = typeof NOTIFICATION_STRATEGY_TYPES[number];

export const NOTIFICATION_STRATEGY: Record<NotificationStrategyType, {
  readonly channel: NotifyChannel;
  readonly priority: NotifyPriority;
  readonly autoDismissMs?: number;
  readonly action?: { readonly label: string; readonly handler: string };
}> = {
  transient_error: { channel: 'toast', priority: 'immediate', autoDismissMs: 5_000 },
  sync_failed: { channel: 'banner', priority: 'immediate', action: { label: 'Retry now', handler: 'retrySync' } },
  storage_full: { channel: 'push', priority: 'immediate', action: { label: 'Manage storage', handler: 'openStorage' } },
  offline: { channel: 'banner', priority: 'immediate', action: { label: 'Check connection', handler: 'checkNetwork' } },
  online: { channel: 'toast', priority: 'immediate', autoDismissMs: 3_000 },
  conflict: { channel: 'banner', priority: 'immediate', action: { label: 'Resolve', handler: 'openConflicts' } },
  auth_expired: { channel: 'banner', priority: 'immediate', action: { label: 'Sign in', handler: 'openLogin' } },
};

// ============================================================
// CACHE CONSTANTS
// ============================================================

export const CACHE_TYPES = ['embedding', 'llm_response', 'node', 'search_result', 'edge', 'session'] as const;
export type CacheType = typeof CACHE_TYPES[number];

export const CACHE_STORAGE_TIERS = ['memory', 'redis', 'sqlite'] as const;
export type CacheStorageTier = typeof CACHE_STORAGE_TIERS[number];

export const EVICTION_POLICIES = ['lru', 'lfu', 'ttl'] as const;
export type EvictionPolicy = typeof EVICTION_POLICIES[number];

export const CACHE_WARM_STRATEGIES = ['recent', 'frequent', 'connected', 'none'] as const;
export type CacheWarmStrategy = typeof CACHE_WARM_STRATEGIES[number];

export const CACHE_CONFIGS: Record<CacheType, {
  readonly primaryStorage: CacheStorageTier;
  readonly fallbackStorage?: CacheStorageTier;
  readonly ttlSeconds: number;
  readonly maxItems: number;
  readonly maxBytes?: number;
  readonly evictionPolicy: EvictionPolicy;
  readonly warmStrategy: CacheWarmStrategy;
}> = {
  embedding: { primaryStorage: 'redis', fallbackStorage: 'sqlite', ttlSeconds: 86_400 * 30, maxItems: 100_000, maxBytes: 600 * 1024 * 1024, evictionPolicy: 'lru', warmStrategy: 'none' },
  llm_response: { primaryStorage: 'redis', ttlSeconds: 3_600, maxItems: 10_000, maxBytes: 50 * 1024 * 1024, evictionPolicy: 'lru', warmStrategy: 'none' },
  node: { primaryStorage: 'memory', fallbackStorage: 'sqlite', ttlSeconds: 300, maxItems: 1_000, maxBytes: 10 * 1024 * 1024, evictionPolicy: 'lru', warmStrategy: 'recent' },
  search_result: { primaryStorage: 'memory', ttlSeconds: 60, maxItems: 500, evictionPolicy: 'lru', warmStrategy: 'none' },
  edge: { primaryStorage: 'memory', fallbackStorage: 'sqlite', ttlSeconds: 300, maxItems: 5_000, evictionPolicy: 'lru', warmStrategy: 'connected' },
  session: { primaryStorage: 'redis', ttlSeconds: 86_400, maxItems: 100_000, evictionPolicy: 'ttl', warmStrategy: 'none' },
};

// ============================================================
// NETWORK & OFFLINE QUEUE CONSTANTS
// ============================================================

export const NETWORK_STATUSES = ['online', 'offline', 'unknown'] as const;
export type NetworkStatus = typeof NETWORK_STATUSES[number];

export const NETWORK_MONITOR_CONFIG = {
  checkIntervalMs: 30_000,
  offlineThreshold: 3,
  onlineThreshold: 1,
  endpoints: ['https://api.nous.app/v1/health', 'https://1.1.1.1/cdn-cgi/trace'] as readonly string[],
  timeoutMs: 5_000,
} as const;

export const OFFLINE_QUEUE_OP_TYPES = ['sync', 'embed', 'edge', 'other'] as const;
export type OfflineQueueOpType = typeof OFFLINE_QUEUE_OP_TYPES[number];

export const OFFLINE_QUEUE_CONFIG = {
  storage: 'sqlite' as const,
  tableName: 'offline_queue' as const,
  maxItemsPerTenant: 1_000,
  maxAgeHours: 168,
  priorityOrder: ['sync', 'embed', 'edge', 'other'] as readonly OfflineQueueOpType[],
  onFull: 'drop_oldest' as const,
} as const;

export const OFFLINE_QUEUE_OVERFLOW = ['drop_oldest', 'reject_new'] as const;
export type OfflineQueueOverflow = typeof OFFLINE_QUEUE_OVERFLOW[number];

// ============================================================
// GRACEFUL DEGRADATION
// ============================================================

export const DEGRADABLE_SERVICES = ['redis', 'openai_embedding', 'openai_llm', 'turso_cloud', 'inngest', 'network'] as const;
export type DegradableService = typeof DEGRADABLE_SERVICES[number];

export const DEGRADATION_MATRIX: Record<DegradableService, { readonly impact: string; readonly fallback: string }> = {
  redis: { impact: 'Cache misses, slower reads', fallback: 'SQLite cache tier + memory-only for hot data' },
  openai_embedding: { impact: 'No new embeddings', fallback: 'Voyage AI fallback, then local model, then queue for later' },
  openai_llm: { impact: 'No AI chat/synthesis', fallback: 'Anthropic fallback, then local model, then "AI unavailable"' },
  turso_cloud: { impact: 'No sync', fallback: 'Local SQLite continues, offline queue grows' },
  inngest: { impact: 'No background jobs', fallback: 'Sync processing inline, alert ops' },
  network: { impact: 'No external services', fallback: 'Full offline mode: local search, no AI, queue all operations' },
};

// ============================================================
// METRIC TYPES
// ============================================================

export const METRIC_TYPES = ['queue-depth', 'cache-hit-rate', 'error-rate', 'sync-latency'] as const;
export type MetricType = typeof METRIC_TYPES[number];

// ============================================================
// TYPE GUARDS
// ============================================================

export function isNBOSJobId(value: string): value is NBOSJobId {
  return (NBOS_JOB_IDS as readonly string[]).includes(value);
}
export function isNBOSJobName(value: string): value is NBOSJobName {
  return (NBOS_JOB_NAME_VALUES as readonly string[]).includes(value);
}
export function isJobTriggerType(value: string): value is JobTriggerType {
  return (JOB_TRIGGER_TYPES as readonly string[]).includes(value);
}
export function isOpsErrorCategory(value: string): value is OpsErrorCategory {
  return (OPS_ERROR_CATEGORIES as readonly string[]).includes(value);
}
export function isOpsErrorCode(value: string): value is OpsErrorCode {
  return (OPS_ERROR_CODE_KEYS as readonly string[]).includes(value);
}
export function isNotifyChannel(value: string): value is NotifyChannel {
  return (NOTIFY_CHANNELS as readonly string[]).includes(value);
}
export function isNotifyPriority(value: string): value is NotifyPriority {
  return (NOTIFY_PRIORITIES as readonly string[]).includes(value);
}
export function isCacheType(value: string): value is CacheType {
  return (CACHE_TYPES as readonly string[]).includes(value);
}
export function isCacheStorageTier(value: string): value is CacheStorageTier {
  return (CACHE_STORAGE_TIERS as readonly string[]).includes(value);
}
export function isEvictionPolicy(value: string): value is EvictionPolicy {
  return (EVICTION_POLICIES as readonly string[]).includes(value);
}
export function isCacheWarmStrategy(value: string): value is CacheWarmStrategy {
  return (CACHE_WARM_STRATEGIES as readonly string[]).includes(value);
}
export function isNetworkStatus(value: string): value is NetworkStatus {
  return (NETWORK_STATUSES as readonly string[]).includes(value);
}
export function isOfflineQueueOpType(value: string): value is OfflineQueueOpType {
  return (OFFLINE_QUEUE_OP_TYPES as readonly string[]).includes(value);
}
export function isDegradableService(value: string): value is DegradableService {
  return (DEGRADABLE_SERVICES as readonly string[]).includes(value);
}
export function isMetricType(value: string): value is MetricType {
  return (METRIC_TYPES as readonly string[]).includes(value);
}
export function isBackoffStrategy(value: string): value is BackoffStrategy {
  return (BACKOFF_STRATEGIES as readonly string[]).includes(value);
}
export function isNotificationStrategyType(value: string): value is NotificationStrategyType {
  return (NOTIFICATION_STRATEGY_TYPES as readonly string[]).includes(value);
}
export function isOpsErrorGroup(value: string): value is OpsErrorGroup {
  return (OPS_ERROR_GROUPS as readonly string[]).includes(value);
}
