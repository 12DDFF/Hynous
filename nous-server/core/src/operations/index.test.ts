import { describe, it, expect } from 'vitest';
import {
  // Constants
  NBOS_JOB_IDS,
  NBOS_JOB_NAMES,
  NBOS_JOB_NAME_VALUES,
  NBOS_CRON_SCHEDULES,
  JOB_TRIGGER_TYPES,
  NBOS_CRON_JOBS,
  NBOS_EVENT_JOBS,
  NBOS_BATCH_SIZES,
  NBOS_TIMEOUTS,
  NBOS_CONCURRENCY,
  NBOS_JOB_PRIORITIES,
  NBOS_JOB_DEPENDENCIES,
  DAILY_CHAIN_ORDER,
  BACKOFF_STRATEGIES,
  JOB_FAILURE_CONFIGS,
  OPS_ERROR_CATEGORIES,
  NOTIFY_CHANNELS,
  NOTIFY_PRIORITIES,
  OPS_ERROR_CODES,
  OPS_ERROR_CODE_KEYS,
  OPS_ERROR_GROUPS,
  ERROR_GROUP_PREFIXES,
  NOTIFICATION_STRATEGY,
  NOTIFICATION_STRATEGY_TYPES,
  CACHE_TYPES,
  CACHE_STORAGE_TIERS,
  EVICTION_POLICIES,
  CACHE_WARM_STRATEGIES,
  CACHE_CONFIGS,
  NETWORK_STATUSES,
  NETWORK_MONITOR_CONFIG,
  OFFLINE_QUEUE_OP_TYPES,
  OFFLINE_QUEUE_CONFIG,
  OFFLINE_QUEUE_OVERFLOW,
  DEGRADABLE_SERVICES,
  DEGRADATION_MATRIX,
  METRIC_TYPES,

  // Type guards
  isNBOSJobId,
  isNBOSJobName,
  isJobTriggerType,
  isOpsErrorCategory,
  isOpsErrorCode,
  isNotifyChannel,
  isNotifyPriority,
  isCacheType,
  isCacheStorageTier,
  isEvictionPolicy,
  isCacheWarmStrategy,
  isNetworkStatus,
  isOfflineQueueOpType,
  isDegradableService,
  isMetricType,
  isBackoffStrategy,
  isNotificationStrategyType,
  isOpsErrorGroup,

  // Types & schemas
  BaseJobPayloadSchema,
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
  DLQProcessPayloadSchema,
  NBOSJobPayloadSchema,
  JobFailureConfigSchema,
  NousOperationalErrorSchema,
  CacheConfigSchema,
  CacheMetricsSchema,
  CacheStatsSchema,
  NetworkMonitorConfigSchema,
  QueuedOperationSchema,
  NotificationConfigSchema,
  DegradationActionSchema,

  // Jobs
  getJobSchedule,
  getJobBatchSize,
  getJobTimeout,
  getJobConcurrency,
  getJobPriority,
  getJobName,
  getJobDependencies,
  isJobBlocked,
  getJobFailureConfig,
  calculateRetryDelay,
  shouldDeadLetter,
  shouldAlertOps,
  isNBOSCronJob,
  isNBOSEventJob,
  getDailyChainOrder,
  createJobPayload,

  // Errors
  createOperationalError,
  isRetryableError,
  getRetryAfter,
  getNotificationForError,
  classifyError,
  isTransientError,
  isRateLimitedError,
  isPermanentError,
  isUserError,
  isSystemError,
  getErrorGroup,

  // Cache
  getCacheConfig,
  generateEmbeddingCacheKey,
  generateLLMCacheKey,
  generateNodeCacheKey,
  generateSearchCacheKey,
  generateEdgeCacheKey,
  generateSessionCacheKey,
  normalizeForEmbedding,
  getTTLSeconds,
  getMaxItems,
  calculateHitRate,
  shouldEvict,
  selectWarmStrategy,
  createEmptyCacheMetrics,

  // Network
  evaluateNetworkStatus,
  shouldGoOffline,
  shouldGoOnline,
  createQueuedOperation,
  getQueuePriority,
  isQueueFull,
  isQueueEntryExpired,
  sortQueueByPriority,

  // Degradation
  getDegradationAction,
  getActiveFallbacks,
  isFullOfflineMode,
  getAvailableFeatures,
} from './index';

// Simple hash function for testing cache keys
const testHash = (s: string) => `hash_${s.length}`;

// Helper to create a valid BaseJobPayload
function makeBase() {
  return {
    tenantId: 'tenant-1',
    correlationId: 'corr-123',
    triggeredAt: '2026-01-15T03:00:00.000Z',
    triggeredBy: 'cron' as const,
  };
}

// ============================================================
// CONSTANTS
// ============================================================

describe('@nous/core/operations', () => {
  describe('Constants', () => {
    it('NBOS_JOB_IDS has 14 entries', () => {
      expect(NBOS_JOB_IDS).toHaveLength(14);
    });

    it('NBOS_JOB_NAMES maps all 14 job IDs', () => {
      for (const id of NBOS_JOB_IDS) {
        expect(NBOS_JOB_NAMES[id]).toBeDefined();
        expect(typeof NBOS_JOB_NAMES[id]).toBe('string');
      }
    });

    it('NBOS_JOB_NAME_VALUES has 14 entries matching names', () => {
      expect(NBOS_JOB_NAME_VALUES).toHaveLength(14);
      const nameSet = new Set(Object.values(NBOS_JOB_NAMES));
      for (const name of NBOS_JOB_NAME_VALUES) {
        expect(nameSet.has(name)).toBe(true);
      }
    });

    it('NBOS_CRON_SCHEDULES has valid cron format', () => {
      const cronRegex = /^[\d*\/,\-]+(\s[\d*\/,\-]+){4}$/;
      for (const [, schedule] of Object.entries(NBOS_CRON_SCHEDULES)) {
        expect(schedule).toMatch(cronRegex);
      }
    });

    it('NBOS_CRON_JOBS + NBOS_EVENT_JOBS = all 14 jobs', () => {
      const all = new Set([...NBOS_CRON_JOBS, ...NBOS_EVENT_JOBS]);
      expect(all.size).toBe(14);
      for (const id of NBOS_JOB_IDS) {
        expect(all.has(id)).toBe(true);
      }
    });

    it('NBOS_BATCH_SIZES has entry for all 14 jobs', () => {
      for (const id of NBOS_JOB_IDS) {
        expect(id in NBOS_BATCH_SIZES).toBe(true);
      }
    });

    it('NBOS_TIMEOUTS has positive values for all 14 jobs', () => {
      for (const id of NBOS_JOB_IDS) {
        expect(NBOS_TIMEOUTS[id]).toBeGreaterThan(0);
      }
    });

    it('NBOS_CONCURRENCY has positive values for all 14 jobs', () => {
      for (const id of NBOS_JOB_IDS) {
        expect(NBOS_CONCURRENCY[id]).toBeGreaterThan(0);
      }
    });

    it('NBOS_JOB_PRIORITIES has valid priority for all 14 jobs', () => {
      for (const id of NBOS_JOB_IDS) {
        expect(['high', 'normal', 'low']).toContain(NBOS_JOB_PRIORITIES[id]);
      }
    });

    it('DAILY_CHAIN_ORDER is [J-013, J-004, J-001]', () => {
      expect(DAILY_CHAIN_ORDER).toEqual(['J-013', 'J-004', 'J-001']);
    });

    it('JOB_FAILURE_CONFIGS has entry for all 14 job names', () => {
      for (const name of NBOS_JOB_NAME_VALUES) {
        expect(JOB_FAILURE_CONFIGS[name]).toBeDefined();
      }
    });

    it('JOB_TRIGGER_TYPES has 4 types', () => {
      expect(JOB_TRIGGER_TYPES).toEqual(['cron', 'event', 'manual', 'retry']);
    });

    it('BACKOFF_STRATEGIES has 3 strategies', () => {
      expect(BACKOFF_STRATEGIES).toEqual(['exponential', 'linear', 'fixed']);
    });

    it('OPS_ERROR_CODES has 30 error codes', () => {
      expect(Object.keys(OPS_ERROR_CODES)).toHaveLength(27);
    });

    it('OPS_ERROR_CODE_KEYS matches OPS_ERROR_CODES keys', () => {
      expect(OPS_ERROR_CODE_KEYS).toHaveLength(27);
      for (const key of OPS_ERROR_CODE_KEYS) {
        expect(key in OPS_ERROR_CODES).toBe(true);
      }
    });

    it('all error codes have unique code values', () => {
      const codes = Object.values(OPS_ERROR_CODES).map((e) => e.code);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('all error codes have valid category', () => {
      for (const entry of Object.values(OPS_ERROR_CODES)) {
        expect(OPS_ERROR_CATEGORIES).toContain(entry.category);
      }
    });

    it('all error codes have valid notifyChannel', () => {
      for (const entry of Object.values(OPS_ERROR_CODES)) {
        expect(NOTIFY_CHANNELS).toContain(entry.notifyChannel);
      }
    });

    it('OPS_ERROR_GROUPS has 6 groups', () => {
      expect(OPS_ERROR_GROUPS).toEqual(['llm', 'embedding', 'database', 'sync', 'auth', 'network']);
    });

    it('ERROR_GROUP_PREFIXES maps E1-E6 to groups', () => {
      expect(ERROR_GROUP_PREFIXES['E1']).toBe('llm');
      expect(ERROR_GROUP_PREFIXES['E2']).toBe('embedding');
      expect(ERROR_GROUP_PREFIXES['E3']).toBe('database');
      expect(ERROR_GROUP_PREFIXES['E4']).toBe('sync');
      expect(ERROR_GROUP_PREFIXES['E5']).toBe('auth');
      expect(ERROR_GROUP_PREFIXES['E6']).toBe('network');
    });

    it('NOTIFICATION_STRATEGY has 7 entries', () => {
      expect(NOTIFICATION_STRATEGY_TYPES).toHaveLength(7);
      for (const type of NOTIFICATION_STRATEGY_TYPES) {
        expect(NOTIFICATION_STRATEGY[type]).toBeDefined();
      }
    });

    it('CACHE_TYPES has 6 cache types', () => {
      expect(CACHE_TYPES).toEqual(['embedding', 'llm_response', 'node', 'search_result', 'edge', 'session']);
    });

    it('CACHE_CONFIGS has entry for all 6 cache types', () => {
      for (const type of CACHE_TYPES) {
        expect(CACHE_CONFIGS[type]).toBeDefined();
        expect(CACHE_CONFIGS[type]!.ttlSeconds).toBeGreaterThan(0);
        expect(CACHE_CONFIGS[type]!.maxItems).toBeGreaterThan(0);
      }
    });

    it('CACHE_STORAGE_TIERS has 3 tiers', () => {
      expect(CACHE_STORAGE_TIERS).toEqual(['memory', 'redis', 'sqlite']);
    });

    it('EVICTION_POLICIES has 3 policies', () => {
      expect(EVICTION_POLICIES).toEqual(['lru', 'lfu', 'ttl']);
    });

    it('NETWORK_STATUSES has 3 states', () => {
      expect(NETWORK_STATUSES).toEqual(['online', 'offline', 'unknown']);
    });

    it('NETWORK_MONITOR_CONFIG has correct thresholds', () => {
      expect(NETWORK_MONITOR_CONFIG.offlineThreshold).toBe(3);
      expect(NETWORK_MONITOR_CONFIG.onlineThreshold).toBe(1);
      expect(NETWORK_MONITOR_CONFIG.checkIntervalMs).toBe(30_000);
      expect(NETWORK_MONITOR_CONFIG.timeoutMs).toBe(5_000);
    });

    it('OFFLINE_QUEUE_CONFIG has correct limits', () => {
      expect(OFFLINE_QUEUE_CONFIG.maxItemsPerTenant).toBe(1_000);
      expect(OFFLINE_QUEUE_CONFIG.maxAgeHours).toBe(168);
      expect(OFFLINE_QUEUE_CONFIG.storage).toBe('sqlite');
    });

    it('OFFLINE_QUEUE_OP_TYPES has 4 types', () => {
      expect(OFFLINE_QUEUE_OP_TYPES).toEqual(['sync', 'embed', 'edge', 'other']);
    });

    it('DEGRADABLE_SERVICES has 6 services', () => {
      expect(DEGRADABLE_SERVICES).toHaveLength(6);
    });

    it('DEGRADATION_MATRIX has entry for all 6 services', () => {
      for (const svc of DEGRADABLE_SERVICES) {
        expect(DEGRADATION_MATRIX[svc]).toBeDefined();
        expect(DEGRADATION_MATRIX[svc]!.impact).toBeTruthy();
        expect(DEGRADATION_MATRIX[svc]!.fallback).toBeTruthy();
      }
    });

    it('METRIC_TYPES has 4 types', () => {
      expect(METRIC_TYPES).toEqual(['queue-depth', 'cache-hit-rate', 'error-rate', 'sync-latency']);
    });
  });

  // ============================================================
  // TYPE GUARDS
  // ============================================================

  describe('Type Guards', () => {
    it('isNBOSJobId returns true for valid IDs', () => {
      expect(isNBOSJobId('J-001')).toBe(true);
      expect(isNBOSJobId('J-014')).toBe(true);
    });

    it('isNBOSJobId returns false for invalid IDs', () => {
      expect(isNBOSJobId('J-000')).toBe(false);
      expect(isNBOSJobId('J-015')).toBe(false);
      expect(isNBOSJobId('')).toBe(false);
    });

    it('isNBOSJobName returns true for valid names', () => {
      expect(isNBOSJobName('decay-cycle')).toBe(true);
      expect(isNBOSJobName('sync-retry')).toBe(true);
    });

    it('isNBOSJobName returns false for invalid names', () => {
      expect(isNBOSJobName('unknown-job')).toBe(false);
      expect(isNBOSJobName('')).toBe(false);
    });

    it('isJobTriggerType works correctly', () => {
      expect(isJobTriggerType('cron')).toBe(true);
      expect(isJobTriggerType('event')).toBe(true);
      expect(isJobTriggerType('manual')).toBe(true);
      expect(isJobTriggerType('retry')).toBe(true);
      expect(isJobTriggerType('unknown')).toBe(false);
    });

    it('isOpsErrorCategory works correctly', () => {
      expect(isOpsErrorCategory('transient')).toBe(true);
      expect(isOpsErrorCategory('permanent')).toBe(true);
      expect(isOpsErrorCategory('invalid')).toBe(false);
    });

    it('isOpsErrorCode works correctly', () => {
      expect(isOpsErrorCode('E100')).toBe(true);
      expect(isOpsErrorCode('E603')).toBe(true);
      expect(isOpsErrorCode('E999')).toBe(false);
    });

    it('isNotifyChannel works correctly', () => {
      expect(isNotifyChannel('toast')).toBe(true);
      expect(isNotifyChannel('banner')).toBe(true);
      expect(isNotifyChannel('push')).toBe(true);
      expect(isNotifyChannel('none')).toBe(true);
      expect(isNotifyChannel('email')).toBe(false);
    });

    it('isNotifyPriority works correctly', () => {
      expect(isNotifyPriority('immediate')).toBe(true);
      expect(isNotifyPriority('next_session')).toBe(true);
      expect(isNotifyPriority('digest')).toBe(true);
      expect(isNotifyPriority('urgent')).toBe(false);
    });

    it('isCacheType works correctly', () => {
      expect(isCacheType('embedding')).toBe(true);
      expect(isCacheType('node')).toBe(true);
      expect(isCacheType('invalid')).toBe(false);
    });

    it('isCacheStorageTier works correctly', () => {
      expect(isCacheStorageTier('memory')).toBe(true);
      expect(isCacheStorageTier('redis')).toBe(true);
      expect(isCacheStorageTier('sqlite')).toBe(true);
      expect(isCacheStorageTier('disk')).toBe(false);
    });

    it('isEvictionPolicy works correctly', () => {
      expect(isEvictionPolicy('lru')).toBe(true);
      expect(isEvictionPolicy('lfu')).toBe(true);
      expect(isEvictionPolicy('ttl')).toBe(true);
      expect(isEvictionPolicy('fifo')).toBe(false);
    });

    it('isCacheWarmStrategy works correctly', () => {
      expect(isCacheWarmStrategy('recent')).toBe(true);
      expect(isCacheWarmStrategy('none')).toBe(true);
      expect(isCacheWarmStrategy('random')).toBe(false);
    });

    it('isNetworkStatus works correctly', () => {
      expect(isNetworkStatus('online')).toBe(true);
      expect(isNetworkStatus('offline')).toBe(true);
      expect(isNetworkStatus('unknown')).toBe(true);
      expect(isNetworkStatus('degraded')).toBe(false);
    });

    it('isOfflineQueueOpType works correctly', () => {
      expect(isOfflineQueueOpType('sync')).toBe(true);
      expect(isOfflineQueueOpType('embed')).toBe(true);
      expect(isOfflineQueueOpType('edge')).toBe(true);
      expect(isOfflineQueueOpType('other')).toBe(true);
      expect(isOfflineQueueOpType('delete')).toBe(false);
    });

    it('isDegradableService works correctly', () => {
      expect(isDegradableService('redis')).toBe(true);
      expect(isDegradableService('openai_llm')).toBe(true);
      expect(isDegradableService('network')).toBe(true);
      expect(isDegradableService('postgres')).toBe(false);
    });

    it('isMetricType works correctly', () => {
      expect(isMetricType('queue-depth')).toBe(true);
      expect(isMetricType('cache-hit-rate')).toBe(true);
      expect(isMetricType('memory-usage')).toBe(false);
    });

    it('isBackoffStrategy works correctly', () => {
      expect(isBackoffStrategy('exponential')).toBe(true);
      expect(isBackoffStrategy('linear')).toBe(true);
      expect(isBackoffStrategy('fixed')).toBe(true);
      expect(isBackoffStrategy('random')).toBe(false);
    });

    it('isNotificationStrategyType works correctly', () => {
      expect(isNotificationStrategyType('transient_error')).toBe(true);
      expect(isNotificationStrategyType('offline')).toBe(true);
      expect(isNotificationStrategyType('critical')).toBe(false);
    });

    it('isOpsErrorGroup works correctly', () => {
      expect(isOpsErrorGroup('llm')).toBe(true);
      expect(isOpsErrorGroup('database')).toBe(true);
      expect(isOpsErrorGroup('storage')).toBe(false);
    });
  });

  // ============================================================
  // ZOD SCHEMAS
  // ============================================================

  describe('Types / Zod Schemas', () => {
    describe('BaseJobPayload', () => {
      it('validates correct payload', () => {
        const result = BaseJobPayloadSchema.safeParse(makeBase());
        expect(result.success).toBe(true);
      });

      it('rejects missing tenantId', () => {
        const { tenantId, ...rest } = makeBase();
        expect(BaseJobPayloadSchema.safeParse(rest).success).toBe(false);
      });

      it('rejects invalid triggeredBy', () => {
        expect(BaseJobPayloadSchema.safeParse({ ...makeBase(), triggeredBy: 'invalid' }).success).toBe(false);
      });

      it('rejects invalid datetime', () => {
        expect(BaseJobPayloadSchema.safeParse({ ...makeBase(), triggeredAt: 'not-a-date' }).success).toBe(false);
      });
    });

    describe('DecayCyclePayload', () => {
      it('validates correct payload', () => {
        const result = DecayCyclePayloadSchema.safeParse({ ...makeBase(), type: 'decay-cycle', batchSize: 100 });
        expect(result.success).toBe(true);
      });

      it('rejects non-positive batchSize', () => {
        expect(DecayCyclePayloadSchema.safeParse({ ...makeBase(), type: 'decay-cycle', batchSize: 0 }).success).toBe(false);
      });

      it('accepts optional offset', () => {
        const result = DecayCyclePayloadSchema.safeParse({ ...makeBase(), type: 'decay-cycle', batchSize: 100, offset: 50 });
        expect(result.success).toBe(true);
      });
    });

    describe('CompressionRunPayload', () => {
      it('validates correct payload', () => {
        const result = CompressionRunPayloadSchema.safeParse({ ...makeBase(), type: 'compression-run' });
        expect(result.success).toBe(true);
      });

      it('accepts optional fields', () => {
        const result = CompressionRunPayloadSchema.safeParse({ ...makeBase(), type: 'compression-run', clusterId: 'c1', dryRun: true });
        expect(result.success).toBe(true);
      });
    });

    describe('CleanupDormantPayload', () => {
      it('validates correct payload', () => {
        const result = CleanupDormantPayloadSchema.safeParse({ ...makeBase(), type: 'cleanup-dormant', dormantDays: 60, action: 'archive' });
        expect(result.success).toBe(true);
      });

      it('rejects invalid action', () => {
        expect(CleanupDormantPayloadSchema.safeParse({ ...makeBase(), type: 'cleanup-dormant', dormantDays: 60, action: 'destroy' }).success).toBe(false);
      });
    });

    describe('SimilarityBatchPayload', () => {
      it('validates threshold between 0 and 1', () => {
        expect(SimilarityBatchPayloadSchema.safeParse({ ...makeBase(), type: 'similarity-batch', threshold: 0.8 }).success).toBe(true);
        expect(SimilarityBatchPayloadSchema.safeParse({ ...makeBase(), type: 'similarity-batch', threshold: 1.5 }).success).toBe(false);
        expect(SimilarityBatchPayloadSchema.safeParse({ ...makeBase(), type: 'similarity-batch', threshold: -0.1 }).success).toBe(false);
      });
    });

    describe('AccessibilityAuditPayload', () => {
      it('validates correct payload', () => {
        const result = AccessibilityAuditPayloadSchema.safeParse({ ...makeBase(), type: 'accessibility-audit', notifyUser: true });
        expect(result.success).toBe(true);
      });
    });

    describe('EmbedSinglePayload', () => {
      it('validates correct payload', () => {
        const result = EmbedSinglePayloadSchema.safeParse({ ...makeBase(), type: 'embed-single', nodeId: 'n1', content: 'text', priority: 'high' });
        expect(result.success).toBe(true);
      });

      it('rejects empty content', () => {
        expect(EmbedSinglePayloadSchema.safeParse({ ...makeBase(), type: 'embed-single', nodeId: 'n1', content: '', priority: 'high' }).success).toBe(false);
      });
    });

    describe('EmbedBatchPayload', () => {
      it('validates correct payload', () => {
        const result = EmbedBatchPayloadSchema.safeParse({ ...makeBase(), type: 'embed-batch', nodeIds: ['n1', 'n2'] });
        expect(result.success).toBe(true);
      });

      it('rejects empty nodeIds', () => {
        expect(EmbedBatchPayloadSchema.safeParse({ ...makeBase(), type: 'embed-batch', nodeIds: [] }).success).toBe(false);
      });
    });

    describe('InferEdgesPayload', () => {
      it('validates correct payload', () => {
        const result = InferEdgesPayloadSchema.safeParse({ ...makeBase(), type: 'infer-edges', nodeId: 'n1' });
        expect(result.success).toBe(true);
      });
    });

    describe('DeduplicatePayload', () => {
      it('validates threshold between 0 and 1', () => {
        expect(DeduplicatePayloadSchema.safeParse({ ...makeBase(), type: 'deduplicate', nodeId: 'n1', similarityThreshold: 0.9 }).success).toBe(true);
        expect(DeduplicatePayloadSchema.safeParse({ ...makeBase(), type: 'deduplicate', nodeId: 'n1', similarityThreshold: 2 }).success).toBe(false);
      });
    });

    describe('SyncRetryPayload', () => {
      it('validates correct payload', () => {
        const result = SyncRetryPayloadSchema.safeParse({ ...makeBase(), type: 'sync-retry', syncId: 's1', attempt: 1, maxAttempts: 5 });
        expect(result.success).toBe(true);
      });
    });

    describe('CacheWarmPayload', () => {
      it('validates correct payload', () => {
        const result = CacheWarmPayloadSchema.safeParse({ ...makeBase(), type: 'cache-warm', strategy: 'recent', limit: 100 });
        expect(result.success).toBe(true);
      });
    });

    describe('MetricsCollectPayload', () => {
      it('validates correct payload', () => {
        const result = MetricsCollectPayloadSchema.safeParse({ ...makeBase(), type: 'metrics-collect', metrics: ['queue-depth'] });
        expect(result.success).toBe(true);
      });

      it('rejects empty metrics array', () => {
        expect(MetricsCollectPayloadSchema.safeParse({ ...makeBase(), type: 'metrics-collect', metrics: [] }).success).toBe(false);
      });
    });

    describe('EmbeddingBackfillPayload', () => {
      it('validates correct payload', () => {
        const result = EmbeddingBackfillPayloadSchema.safeParse({ ...makeBase(), type: 'embedding-backfill', batchSize: 100, priority: 'stale' });
        expect(result.success).toBe(true);
      });

      it('rejects invalid priority', () => {
        expect(EmbeddingBackfillPayloadSchema.safeParse({ ...makeBase(), type: 'embedding-backfill', batchSize: 100, priority: 'urgent' }).success).toBe(false);
      });
    });

    describe('DLQProcessPayload', () => {
      it('validates correct payload', () => {
        const result = DLQProcessPayloadSchema.safeParse({ ...makeBase(), type: 'dlq-process', limit: 50, retryEligible: true });
        expect(result.success).toBe(true);
      });
    });

    describe('NBOSJobPayload discriminated union', () => {
      it('parses decay-cycle correctly', () => {
        const result = NBOSJobPayloadSchema.safeParse({ ...makeBase(), type: 'decay-cycle', batchSize: 100 });
        expect(result.success).toBe(true);
      });

      it('parses embed-single correctly', () => {
        const result = NBOSJobPayloadSchema.safeParse({ ...makeBase(), type: 'embed-single', nodeId: 'n1', content: 'text', priority: 'high' });
        expect(result.success).toBe(true);
      });

      it('rejects unknown type', () => {
        const result = NBOSJobPayloadSchema.safeParse({ ...makeBase(), type: 'unknown-job' });
        expect(result.success).toBe(false);
      });
    });

    describe('JobFailureConfig', () => {
      it('validates correct config', () => {
        const result = JobFailureConfigSchema.safeParse({
          retries: 3, backoff: 'exponential', baseDelayMs: 1000, maxDelayMs: 60000,
          deadLetterAfter: 3, alertAfter: 2, userNotify: true, notifyChannel: 'toast',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('NousOperationalError', () => {
      it('validates correct error', () => {
        const result = NousOperationalErrorSchema.safeParse({
          code: 'E100', category: 'transient', message: 'LLM timeout',
          userMessage: 'AI is thinking', retryable: true, notifyChannel: 'toast',
        });
        expect(result.success).toBe(true);
      });

      it('accepts optional context', () => {
        const result = NousOperationalErrorSchema.safeParse({
          code: 'E100', category: 'transient', message: 'LLM timeout',
          userMessage: 'AI is thinking', retryable: true, notifyChannel: 'toast',
          context: { prompt: 'hello' },
        });
        expect(result.success).toBe(true);
      });

      it('accepts optional retryAfter', () => {
        const result = NousOperationalErrorSchema.safeParse({
          code: 'E101', category: 'rate_limited', message: 'Rate limited',
          userMessage: 'Retrying', retryable: true, retryAfter: 60000, notifyChannel: 'toast',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('CacheConfig', () => {
      it('validates correct config', () => {
        const result = CacheConfigSchema.safeParse({
          primaryStorage: 'redis', ttlSeconds: 3600, maxItems: 10000,
          evictionPolicy: 'lru', warmStrategy: 'none',
        });
        expect(result.success).toBe(true);
      });

      it('accepts optional fallbackStorage and maxBytes', () => {
        const result = CacheConfigSchema.safeParse({
          primaryStorage: 'redis', fallbackStorage: 'sqlite', ttlSeconds: 3600,
          maxItems: 10000, maxBytes: 1024, evictionPolicy: 'lru', warmStrategy: 'none',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('CacheMetrics', () => {
      it('validates correct metrics', () => {
        const result = CacheMetricsSchema.safeParse({
          cacheType: 'node', storage: 'memory', hits: 100, misses: 20,
          hitRate: 0.83, itemCount: 50, maxItems: 1000, bytesUsed: 5000,
          maxBytes: 10000, evictions: 5, avgLatencyMs: 1.2, p99LatencyMs: 5.5,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('CacheStats', () => {
      it('validates correct stats', () => {
        const result = CacheStatsSchema.safeParse({
          hits: 100, misses: 20, size: 80, bytesUsed: 5000,
          evictions: 5, avgLatencyMs: 1.2, p99LatencyMs: 5.5,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('NetworkMonitorConfig', () => {
      it('validates correct config', () => {
        const result = NetworkMonitorConfigSchema.safeParse({
          checkIntervalMs: 30000, offlineThreshold: 3, onlineThreshold: 1,
          endpoints: ['https://example.com/health'], timeoutMs: 5000,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('QueuedOperation', () => {
      it('validates correct operation with _schemaVersion', () => {
        const result = QueuedOperationSchema.safeParse({
          _schemaVersion: 1, id: 'q1', tenantId: 't1', type: 'sync',
          payload: { nodeId: 'n1' }, createdAt: '2026-01-15T00:00:00.000Z',
          priority: 0, attempts: 0,
        });
        expect(result.success).toBe(true);
      });

      it('rejects missing _schemaVersion', () => {
        const result = QueuedOperationSchema.safeParse({
          id: 'q1', tenantId: 't1', type: 'sync', payload: {},
          createdAt: '2026-01-15T00:00:00.000Z', priority: 0, attempts: 0,
        });
        expect(result.success).toBe(false);
      });
    });

    describe('NotificationConfig', () => {
      it('validates correct config', () => {
        const result = NotificationConfigSchema.safeParse({
          channel: 'toast', priority: 'immediate', autoDismissMs: 5000,
        });
        expect(result.success).toBe(true);
      });

      it('validates with action', () => {
        const result = NotificationConfigSchema.safeParse({
          channel: 'banner', priority: 'immediate',
          action: { label: 'Retry', handler: 'retrySync' },
        });
        expect(result.success).toBe(true);
      });
    });

    describe('DegradationAction', () => {
      it('validates correct action', () => {
        const result = DegradationActionSchema.safeParse({
          service: 'redis', impact: 'Cache misses', fallback: 'SQLite fallback',
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ============================================================
  // JOBS
  // ============================================================

  describe('Jobs', () => {
    describe('getJobSchedule', () => {
      it('returns cron schedule for cron jobs', () => {
        expect(getJobSchedule('J-001')).toBe('0 3 * * *');
        expect(getJobSchedule('J-002')).toBe('0 5 * * 0');
        expect(getJobSchedule('J-013')).toBe('0 0 * * *');
      });

      it('returns null for event-driven jobs', () => {
        expect(getJobSchedule('J-006')).toBeNull();
        expect(getJobSchedule('J-007')).toBeNull();
        expect(getJobSchedule('J-009')).toBeNull();
        expect(getJobSchedule('J-010')).toBeNull();
      });
    });

    describe('getJobBatchSize', () => {
      it('returns batch size for batch jobs', () => {
        expect(getJobBatchSize('J-001')).toBe(1000);
        expect(getJobBatchSize('J-007')).toBe(50);
      });

      it('returns null for unbounded jobs', () => {
        expect(getJobBatchSize('J-005')).toBeNull();
        expect(getJobBatchSize('J-012')).toBeNull();
      });
    });

    describe('getJobTimeout', () => {
      it('returns correct timeouts', () => {
        expect(getJobTimeout('J-001')).toBe(10 * 60 * 1000);
        expect(getJobTimeout('J-006')).toBe(30 * 1000);
      });
    });

    describe('getJobConcurrency', () => {
      it('returns correct concurrency', () => {
        expect(getJobConcurrency('J-001')).toBe(1);
        expect(getJobConcurrency('J-006')).toBe(10);
      });
    });

    describe('getJobPriority', () => {
      it('returns correct priorities', () => {
        expect(getJobPriority('J-006')).toBe('high');
        expect(getJobPriority('J-007')).toBe('normal');
        expect(getJobPriority('J-001')).toBe('low');
      });
    });

    describe('getJobName', () => {
      it('returns correct names', () => {
        expect(getJobName('J-001')).toBe('decay-cycle');
        expect(getJobName('J-006')).toBe('embed-single');
        expect(getJobName('J-014')).toBe('dlq-process');
      });
    });

    describe('getJobDependencies', () => {
      it('returns dependencies for jobs with deps', () => {
        expect(getJobDependencies('J-001')).toEqual(['J-004']);
        expect(getJobDependencies('J-002')).toEqual(['J-001']);
        expect(getJobDependencies('J-004')).toEqual(['J-013']);
      });

      it('returns empty array for jobs with no deps', () => {
        expect(getJobDependencies('J-006')).toEqual([]);
        expect(getJobDependencies('J-013')).toEqual([]);
      });
    });

    describe('isJobBlocked', () => {
      it('returns false when all dependencies are met', () => {
        expect(isJobBlocked('J-001', ['J-004'])).toBe(false);
      });

      it('returns true when dependencies are missing', () => {
        expect(isJobBlocked('J-001', [])).toBe(true);
        expect(isJobBlocked('J-001', ['J-013'])).toBe(true);
      });

      it('returns false for jobs with no dependencies', () => {
        expect(isJobBlocked('J-006', [])).toBe(false);
        expect(isJobBlocked('J-013', [])).toBe(false);
      });
    });

    describe('getJobFailureConfig', () => {
      it('returns config for all 14 jobs', () => {
        for (const name of NBOS_JOB_NAME_VALUES) {
          const config = getJobFailureConfig(name);
          expect(config).toBeDefined();
          expect(config!.retries).toBeGreaterThanOrEqual(0);
        }
      });

      it('returns undefined for unknown job name', () => {
        expect(getJobFailureConfig('unknown-job')).toBeUndefined();
      });

      it('embed-single has 4 retries and exponential backoff', () => {
        const config = getJobFailureConfig('embed-single');
        expect(config!.retries).toBe(4);
        expect(config!.backoff).toBe('exponential');
      });

      it('sync-retry has 5 retries and user notify', () => {
        const config = getJobFailureConfig('sync-retry');
        expect(config!.retries).toBe(5);
        expect(config!.userNotify).toBe(true);
        expect(config!.notifyChannel).toBe('banner');
      });
    });

    describe('calculateRetryDelay', () => {
      const expConfig = { retries: 3, backoff: 'exponential' as const, baseDelayMs: 1000, maxDelayMs: 60000, deadLetterAfter: 3, alertAfter: 2, userNotify: false, notifyChannel: 'none' as const };
      const linConfig = { ...expConfig, backoff: 'linear' as const };
      const fixConfig = { ...expConfig, backoff: 'fixed' as const };

      it('exponential: delay doubles each attempt', () => {
        expect(calculateRetryDelay(expConfig, 0)).toBe(1000);
        expect(calculateRetryDelay(expConfig, 1)).toBe(2000);
        expect(calculateRetryDelay(expConfig, 2)).toBe(4000);
        expect(calculateRetryDelay(expConfig, 3)).toBe(8000);
      });

      it('exponential: caps at maxDelayMs', () => {
        expect(calculateRetryDelay(expConfig, 10)).toBe(60000);
      });

      it('linear: delay increases linearly', () => {
        expect(calculateRetryDelay(linConfig, 0)).toBe(1000);
        expect(calculateRetryDelay(linConfig, 1)).toBe(2000);
        expect(calculateRetryDelay(linConfig, 2)).toBe(3000);
      });

      it('linear: caps at maxDelayMs', () => {
        expect(calculateRetryDelay(linConfig, 100)).toBe(60000);
      });

      it('fixed: always returns baseDelayMs', () => {
        expect(calculateRetryDelay(fixConfig, 0)).toBe(1000);
        expect(calculateRetryDelay(fixConfig, 5)).toBe(1000);
        expect(calculateRetryDelay(fixConfig, 100)).toBe(1000);
      });
    });

    describe('shouldDeadLetter', () => {
      const config = { retries: 3, backoff: 'fixed' as const, baseDelayMs: 1000, maxDelayMs: 1000, deadLetterAfter: 3, alertAfter: 2, userNotify: false, notifyChannel: 'none' as const };

      it('returns false when attempts < deadLetterAfter', () => {
        expect(shouldDeadLetter(config, 0)).toBe(false);
        expect(shouldDeadLetter(config, 1)).toBe(false);
        expect(shouldDeadLetter(config, 2)).toBe(false);
      });

      it('returns true when attempts >= deadLetterAfter', () => {
        expect(shouldDeadLetter(config, 3)).toBe(true);
        expect(shouldDeadLetter(config, 5)).toBe(true);
      });
    });

    describe('shouldAlertOps', () => {
      const config = { retries: 3, backoff: 'fixed' as const, baseDelayMs: 1000, maxDelayMs: 1000, deadLetterAfter: 3, alertAfter: 2, userNotify: false, notifyChannel: 'none' as const };

      it('returns false when failures < alertAfter', () => {
        expect(shouldAlertOps(config, 0)).toBe(false);
        expect(shouldAlertOps(config, 1)).toBe(false);
      });

      it('returns true when failures >= alertAfter', () => {
        expect(shouldAlertOps(config, 2)).toBe(true);
        expect(shouldAlertOps(config, 5)).toBe(true);
      });
    });

    describe('isNBOSCronJob / isNBOSEventJob', () => {
      it('correctly identifies cron jobs', () => {
        expect(isNBOSCronJob('J-001')).toBe(true);
        expect(isNBOSCronJob('J-012')).toBe(true);
        expect(isNBOSCronJob('J-006')).toBe(false);
      });

      it('correctly identifies event jobs', () => {
        expect(isNBOSEventJob('J-006')).toBe(true);
        expect(isNBOSEventJob('J-010')).toBe(true);
        expect(isNBOSEventJob('J-001')).toBe(false);
      });
    });

    describe('getDailyChainOrder', () => {
      it('returns [J-013, J-004, J-001]', () => {
        expect(getDailyChainOrder()).toEqual(['J-013', 'J-004', 'J-001']);
      });
    });

    describe('createJobPayload', () => {
      it('stamps correlationId and triggeredAt', () => {
        const payload = createJobPayload({
          tenantId: 't1',
          triggeredBy: 'cron' as const,
          type: 'decay-cycle' as const,
          batchSize: 100,
        });
        expect(payload.correlationId).toBeTruthy();
        expect(payload.triggeredAt).toBeTruthy();
        expect(payload.tenantId).toBe('t1');
        expect(payload.type).toBe('decay-cycle');
        expect(payload.batchSize).toBe(100);
      });

      it('generates valid ISO timestamp', () => {
        const payload = createJobPayload({
          tenantId: 't1',
          triggeredBy: 'event' as const,
          type: 'embed-single' as const,
          nodeId: 'n1',
          content: 'test',
          priority: 'high' as const,
        });
        expect(() => new Date(payload.triggeredAt)).not.toThrow();
        expect(new Date(payload.triggeredAt).toISOString()).toBe(payload.triggeredAt);
      });
    });
  });

  // ============================================================
  // ERRORS
  // ============================================================

  describe('Errors', () => {
    describe('createOperationalError', () => {
      it('creates error from E100', () => {
        const err = createOperationalError('E100');
        expect(err.code).toBe('E100');
        expect(err.category).toBe('transient');
        expect(err.retryable).toBe(true);
        expect(err.notifyChannel).toBe('toast');
        expect(err.message).toContain('LLM');
      });

      it('creates error from E101 with retryAfter', () => {
        const err = createOperationalError('E101');
        expect(err.code).toBe('E101');
        expect(err.category).toBe('rate_limited');
        expect(err.retryAfter).toBe(60_000);
      });

      it('creates error from E304 (permanent)', () => {
        const err = createOperationalError('E304');
        expect(err.retryable).toBe(false);
        expect(err.notifyChannel).toBe('push');
      });

      it('includes context when provided', () => {
        const err = createOperationalError('E100', { prompt: 'hello' });
        expect(err.context).toEqual({ prompt: 'hello' });
      });

      it('has undefined context when not provided', () => {
        const err = createOperationalError('E100');
        expect(err.context).toBeUndefined();
      });

      it('creates all 30 error codes without error', () => {
        for (const code of OPS_ERROR_CODE_KEYS) {
          const err = createOperationalError(code);
          expect(err.code).toBe(code);
        }
      });
    });

    describe('isRetryableError', () => {
      it('returns true for transient errors', () => {
        const err = createOperationalError('E100');
        expect(isRetryableError(err)).toBe(true);
      });

      it('returns false for permanent errors', () => {
        const err = createOperationalError('E102');
        expect(isRetryableError(err)).toBe(false);
      });
    });

    describe('getRetryAfter', () => {
      it('returns retryAfter for rate-limited errors', () => {
        const err = createOperationalError('E101');
        expect(getRetryAfter(err)).toBe(60_000);
      });

      it('returns undefined for non-rate-limited errors', () => {
        const err = createOperationalError('E100');
        expect(getRetryAfter(err)).toBeUndefined();
      });
    });

    describe('getNotificationForError', () => {
      it('returns notification config for transient errors', () => {
        const err = createOperationalError('E100');
        const notification = getNotificationForError(err);
        expect(notification.channel).toBe('toast');
        expect(notification.priority).toBe('immediate');
      });

      it('returns notification config for auth errors', () => {
        const err = createOperationalError('E501');
        const notification = getNotificationForError(err);
        expect(notification.channel).toBe('banner');
      });

      it('returns notification config for storage full', () => {
        const err = createOperationalError('E304');
        const notification = getNotificationForError(err);
        expect(notification.channel).toBe('push');
      });
    });

    describe('classifyError', () => {
      it('classifies LLM timeout', () => {
        expect(classifyError(new Error('LLM request timeout'))).toBe('E100');
      });

      it('classifies embedding timeout', () => {
        expect(classifyError(new Error('Embedding request timed out'))).toBe('E200');
      });

      it('classifies database timeout', () => {
        expect(classifyError(new Error('Database connection timeout'))).toBe('E300');
      });

      it('classifies generic timeout as network', () => {
        expect(classifyError(new Error('Request timed out'))).toBe('E600');
      });

      it('classifies LLM rate limit', () => {
        expect(classifyError(new Error('Rate limit exceeded'))).toBe('E101');
      });

      it('classifies embedding rate limit', () => {
        expect(classifyError(new Error('Embedding rate limit hit'))).toBe('E201');
      });

      it('classifies token expired', () => {
        expect(classifyError(new Error('Token expired'))).toBe('E500');
      });

      it('classifies unauthorized', () => {
        expect(classifyError(new Error('Unauthorized access 401'))).toBe('E501');
      });

      it('classifies connection refused', () => {
        expect(classifyError(new Error('ECONNREFUSED'))).toBe('E601');
      });

      it('classifies network errors', () => {
        expect(classifyError(new Error('Network error'))).toBe('E602');
      });

      it('classifies constraint violation', () => {
        expect(classifyError(new Error('Constraint violation'))).toBe('E302');
      });

      it('classifies quota exceeded', () => {
        expect(classifyError(new Error('Storage quota exceeded'))).toBe('E304');
      });

      it('classifies sync conflict', () => {
        expect(classifyError(new Error('Sync conflict detected'))).toBe('E401');
      });

      it('falls back to E303 for unknown errors', () => {
        expect(classifyError(new Error('Something completely unknown'))).toBe('E303');
      });

      it('handles string errors', () => {
        expect(classifyError('LLM timeout error')).toBe('E100');
      });

      it('handles null/undefined errors', () => {
        expect(classifyError(null)).toBe('E303');
        expect(classifyError(undefined)).toBe('E303');
      });
    });

    describe('Category checks', () => {
      it('isTransientError', () => {
        expect(isTransientError(createOperationalError('E100'))).toBe(true);
        expect(isTransientError(createOperationalError('E102'))).toBe(false);
      });

      it('isRateLimitedError', () => {
        expect(isRateLimitedError(createOperationalError('E101'))).toBe(true);
        expect(isRateLimitedError(createOperationalError('E100'))).toBe(false);
      });

      it('isPermanentError', () => {
        expect(isPermanentError(createOperationalError('E102'))).toBe(true);
        expect(isPermanentError(createOperationalError('E100'))).toBe(false);
      });

      it('isUserError', () => {
        expect(isUserError(createOperationalError('E402'))).toBe(true);
        expect(isUserError(createOperationalError('E503'))).toBe(true);
        expect(isUserError(createOperationalError('E100'))).toBe(false);
      });

      it('isSystemError', () => {
        expect(isSystemError(createOperationalError('E303'))).toBe(true);
        expect(isSystemError(createOperationalError('E100'))).toBe(false);
      });
    });

    describe('getErrorGroup', () => {
      it('returns llm for E1xx codes', () => {
        expect(getErrorGroup('E100')).toBe('llm');
        expect(getErrorGroup('E104')).toBe('llm');
      });

      it('returns embedding for E2xx codes', () => {
        expect(getErrorGroup('E200')).toBe('embedding');
        expect(getErrorGroup('E203')).toBe('embedding');
      });

      it('returns database for E3xx codes', () => {
        expect(getErrorGroup('E300')).toBe('database');
        expect(getErrorGroup('E304')).toBe('database');
      });

      it('returns sync for E4xx codes', () => {
        expect(getErrorGroup('E400')).toBe('sync');
        expect(getErrorGroup('E404')).toBe('sync');
      });

      it('returns auth for E5xx codes', () => {
        expect(getErrorGroup('E500')).toBe('auth');
        expect(getErrorGroup('E503')).toBe('auth');
      });

      it('returns network for E6xx codes', () => {
        expect(getErrorGroup('E600')).toBe('network');
        expect(getErrorGroup('E603')).toBe('network');
      });
    });
  });

  // ============================================================
  // CACHE
  // ============================================================

  describe('Cache', () => {
    describe('getCacheConfig', () => {
      it('returns config for all 6 cache types', () => {
        for (const type of CACHE_TYPES) {
          const config = getCacheConfig(type);
          expect(config.ttlSeconds).toBeGreaterThan(0);
          expect(config.maxItems).toBeGreaterThan(0);
          expect(config.evictionPolicy).toBeTruthy();
        }
      });

      it('embedding has redis primary with sqlite fallback', () => {
        const config = getCacheConfig('embedding');
        expect(config.primaryStorage).toBe('redis');
        expect(config.fallbackStorage).toBe('sqlite');
      });

      it('node has memory primary with sqlite fallback', () => {
        const config = getCacheConfig('node');
        expect(config.primaryStorage).toBe('memory');
        expect(config.fallbackStorage).toBe('sqlite');
      });

      it('search_result has memory primary with no fallback', () => {
        const config = getCacheConfig('search_result');
        expect(config.primaryStorage).toBe('memory');
        expect(config.fallbackStorage).toBeUndefined();
      });
    });

    describe('generateEmbeddingCacheKey', () => {
      it('includes content length and hash', () => {
        const key = generateEmbeddingCacheKey('hello world', testHash);
        expect(key).toBe('emb:11:hash_11');
      });

      it('normalizes content before hashing', () => {
        const key1 = generateEmbeddingCacheKey('  Hello  World  ', testHash);
        const key2 = generateEmbeddingCacheKey('hello world', testHash);
        expect(key1).toBe(key2);
      });
    });

    describe('generateLLMCacheKey', () => {
      it('includes operation, model, length, and hash', () => {
        const key = generateLLMCacheKey('extract', 'gpt-4', 'test prompt', testHash);
        expect(key).toBe('llm:extract:gpt-4:11:hash_11');
      });
    });

    describe('generateNodeCacheKey', () => {
      it('generates key without version', () => {
        expect(generateNodeCacheKey('t1', 'n1')).toBe('node:t1:n1');
      });

      it('generates key with version', () => {
        expect(generateNodeCacheKey('t1', 'n1', 3)).toBe('node:t1:n1:v3');
      });
    });

    describe('generateSearchCacheKey', () => {
      it('includes tenant, query hash, and filters hash', () => {
        const key = generateSearchCacheKey('t1', 'hello', { tag: 'test' }, testHash);
        expect(key).toMatch(/^search:t1:hash_\d+:hash_\d+$/);
      });

      it('produces same key for same filters in different order', () => {
        const key1 = generateSearchCacheKey('t1', 'q', { a: 1, b: 2 }, testHash);
        const key2 = generateSearchCacheKey('t1', 'q', { b: 2, a: 1 }, testHash);
        expect(key1).toBe(key2);
      });
    });

    describe('generateEdgeCacheKey', () => {
      it('generates correct format', () => {
        expect(generateEdgeCacheKey('t1', 'n1')).toBe('edges:t1:n1');
      });
    });

    describe('generateSessionCacheKey', () => {
      it('generates correct format', () => {
        expect(generateSessionCacheKey('sess-123')).toBe('session:sess-123');
      });
    });

    describe('normalizeForEmbedding', () => {
      it('lowercases content', () => {
        expect(normalizeForEmbedding('HELLO')).toBe('hello');
      });

      it('trims whitespace', () => {
        expect(normalizeForEmbedding('  hello  ')).toBe('hello');
      });

      it('collapses consecutive whitespace', () => {
        expect(normalizeForEmbedding('hello   world')).toBe('hello world');
      });

      it('truncates to 8000 chars', () => {
        const long = 'a'.repeat(10000);
        expect(normalizeForEmbedding(long)).toHaveLength(8000);
      });

      it('handles empty string', () => {
        expect(normalizeForEmbedding('')).toBe('');
      });
    });

    describe('getTTLSeconds', () => {
      it('returns correct TTL for each cache type', () => {
        expect(getTTLSeconds('embedding')).toBe(86_400 * 30);
        expect(getTTLSeconds('llm_response')).toBe(3_600);
        expect(getTTLSeconds('node')).toBe(300);
        expect(getTTLSeconds('search_result')).toBe(60);
        expect(getTTLSeconds('edge')).toBe(300);
        expect(getTTLSeconds('session')).toBe(86_400);
      });
    });

    describe('getMaxItems', () => {
      it('returns correct max items for each cache type', () => {
        expect(getMaxItems('embedding')).toBe(100_000);
        expect(getMaxItems('node')).toBe(1_000);
        expect(getMaxItems('search_result')).toBe(500);
      });
    });

    describe('calculateHitRate', () => {
      it('calculates correct ratio', () => {
        expect(calculateHitRate(75, 25)).toBe(0.75);
        expect(calculateHitRate(100, 0)).toBe(1);
        expect(calculateHitRate(0, 100)).toBe(0);
      });

      it('returns 0 for zero denominator', () => {
        expect(calculateHitRate(0, 0)).toBe(0);
      });
    });

    describe('shouldEvict', () => {
      it('returns true when itemCount >= maxItems', () => {
        const metrics = createEmptyCacheMetrics('node');
        metrics.itemCount = 1000;
        expect(shouldEvict(metrics)).toBe(true);
      });

      it('returns false when itemCount < maxItems', () => {
        const metrics = createEmptyCacheMetrics('node');
        metrics.itemCount = 999;
        expect(shouldEvict(metrics)).toBe(false);
      });
    });

    describe('selectWarmStrategy', () => {
      it('returns correct strategies', () => {
        expect(selectWarmStrategy('node')).toBe('recent');
        expect(selectWarmStrategy('edge')).toBe('connected');
        expect(selectWarmStrategy('embedding')).toBe('none');
      });
    });

    describe('createEmptyCacheMetrics', () => {
      it('creates zeroed metrics for a cache type', () => {
        const metrics = createEmptyCacheMetrics('node');
        expect(metrics.cacheType).toBe('node');
        expect(metrics.storage).toBe('memory');
        expect(metrics.hits).toBe(0);
        expect(metrics.misses).toBe(0);
        expect(metrics.hitRate).toBe(0);
        expect(metrics.itemCount).toBe(0);
        expect(metrics.maxItems).toBe(1_000);
        expect(metrics.evictions).toBe(0);
        expect(metrics.avgLatencyMs).toBe(0);
        expect(metrics.p99LatencyMs).toBe(0);
      });

      it('sets correct storage tier per type', () => {
        expect(createEmptyCacheMetrics('embedding').storage).toBe('redis');
        expect(createEmptyCacheMetrics('session').storage).toBe('redis');
        expect(createEmptyCacheMetrics('search_result').storage).toBe('memory');
      });
    });
  });

  // ============================================================
  // NETWORK
  // ============================================================

  describe('Network', () => {
    describe('evaluateNetworkStatus', () => {
      it('returns offline when 3 consecutive failures', () => {
        expect(evaluateNetworkStatus(3, 0)).toBe('offline');
      });

      it('returns offline when more than 3 failures', () => {
        expect(evaluateNetworkStatus(5, 0)).toBe('offline');
      });

      it('returns online when 1 success', () => {
        expect(evaluateNetworkStatus(0, 1)).toBe('online');
      });

      it('returns unknown when below thresholds', () => {
        expect(evaluateNetworkStatus(0, 0)).toBe('unknown');
        expect(evaluateNetworkStatus(2, 0)).toBe('unknown');
      });

      it('failures take priority over successes', () => {
        expect(evaluateNetworkStatus(3, 1)).toBe('offline');
      });
    });

    describe('shouldGoOffline', () => {
      it('returns true at threshold', () => {
        expect(shouldGoOffline(3)).toBe(true);
      });

      it('returns false below threshold', () => {
        expect(shouldGoOffline(2)).toBe(false);
        expect(shouldGoOffline(0)).toBe(false);
      });
    });

    describe('shouldGoOnline', () => {
      it('returns true from offline with 1 success', () => {
        expect(shouldGoOnline('offline', 1)).toBe(true);
      });

      it('returns true from unknown with 1 success', () => {
        expect(shouldGoOnline('unknown', 1)).toBe(true);
      });

      it('returns false when already online', () => {
        expect(shouldGoOnline('online', 1)).toBe(false);
      });

      it('returns false when success count is 0', () => {
        expect(shouldGoOnline('offline', 0)).toBe(false);
      });
    });

    describe('createQueuedOperation', () => {
      it('creates operation with all required fields', () => {
        const op = createQueuedOperation('t1', 'sync', { nodeId: 'n1' });
        expect(op._schemaVersion).toBe(1);
        expect(op.id).toBeTruthy();
        expect(op.tenantId).toBe('t1');
        expect(op.type).toBe('sync');
        expect(op.payload).toEqual({ nodeId: 'n1' });
        expect(op.priority).toBe(0);
        expect(op.attempts).toBe(0);
        expect(op.createdAt).toBeTruthy();
      });

      it('generates unique IDs', () => {
        const op1 = createQueuedOperation('t1', 'sync', {});
        const op2 = createQueuedOperation('t1', 'sync', {});
        expect(op1.id).not.toBe(op2.id);
      });

      it('sets correct priority for each type', () => {
        expect(createQueuedOperation('t1', 'sync', {}).priority).toBe(0);
        expect(createQueuedOperation('t1', 'embed', {}).priority).toBe(1);
        expect(createQueuedOperation('t1', 'edge', {}).priority).toBe(2);
        expect(createQueuedOperation('t1', 'other', {}).priority).toBe(3);
      });
    });

    describe('getQueuePriority', () => {
      it('returns correct priority by type', () => {
        expect(getQueuePriority('sync')).toBe(0);
        expect(getQueuePriority('embed')).toBe(1);
        expect(getQueuePriority('edge')).toBe(2);
        expect(getQueuePriority('other')).toBe(3);
      });
    });

    describe('isQueueFull', () => {
      it('returns true at capacity', () => {
        expect(isQueueFull(1000)).toBe(true);
      });

      it('returns false below capacity', () => {
        expect(isQueueFull(999)).toBe(false);
        expect(isQueueFull(0)).toBe(false);
      });

      it('returns true above capacity', () => {
        expect(isQueueFull(1001)).toBe(true);
      });
    });

    describe('isQueueEntryExpired', () => {
      it('returns false for recent entries', () => {
        const now = new Date();
        const createdAt = new Date(now.getTime() - 1000).toISOString();
        expect(isQueueEntryExpired(createdAt, now)).toBe(false);
      });

      it('returns true for entries older than 7 days', () => {
        const now = new Date();
        const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
        expect(isQueueEntryExpired(eightDaysAgo, now)).toBe(true);
      });

      it('returns false at exactly 7 days', () => {
        const now = new Date();
        const sevenDays = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        expect(isQueueEntryExpired(sevenDays, now)).toBe(false);
      });

      it('returns true just past 7 days', () => {
        const now = new Date();
        const justPast = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000 - 1).toISOString();
        expect(isQueueEntryExpired(justPast, now)).toBe(true);
      });
    });

    describe('sortQueueByPriority', () => {
      it('sorts by priority ascending', () => {
        const now = new Date().toISOString();
        const ops = [
          createQueuedOperation('t1', 'other', {}),
          createQueuedOperation('t1', 'sync', {}),
          createQueuedOperation('t1', 'embed', {}),
        ];
        // Override createdAt to be same
        for (const op of ops) {
          op.createdAt = now;
        }
        const sorted = sortQueueByPriority(ops);
        expect(sorted[0]!.type).toBe('sync');
        expect(sorted[1]!.type).toBe('embed');
        expect(sorted[2]!.type).toBe('other');
      });

      it('sorts by createdAt within same priority', () => {
        const op1 = createQueuedOperation('t1', 'sync', {});
        op1.createdAt = '2026-01-01T00:00:00.000Z';
        const op2 = createQueuedOperation('t1', 'sync', {});
        op2.createdAt = '2026-01-02T00:00:00.000Z';
        const sorted = sortQueueByPriority([op2, op1]);
        expect(sorted[0]!.createdAt).toBe('2026-01-01T00:00:00.000Z');
        expect(sorted[1]!.createdAt).toBe('2026-01-02T00:00:00.000Z');
      });

      it('does not mutate the input array', () => {
        const ops = [
          createQueuedOperation('t1', 'other', {}),
          createQueuedOperation('t1', 'sync', {}),
        ];
        const original = [...ops];
        sortQueueByPriority(ops);
        expect(ops[0]!.type).toBe(original[0]!.type);
        expect(ops[1]!.type).toBe(original[1]!.type);
      });
    });
  });

  // ============================================================
  // DEGRADATION
  // ============================================================

  describe('Degradation', () => {
    describe('getDegradationAction', () => {
      it('returns action for all 6 services', () => {
        for (const svc of DEGRADABLE_SERVICES) {
          const action = getDegradationAction(svc);
          expect(action.service).toBe(svc);
          expect(action.impact).toBeTruthy();
          expect(action.fallback).toBeTruthy();
        }
      });

      it('returns correct impact for redis', () => {
        const action = getDegradationAction('redis');
        expect(action.impact).toContain('Cache');
      });

      it('returns correct fallback for network', () => {
        const action = getDegradationAction('network');
        expect(action.fallback).toContain('offline');
      });
    });

    describe('getActiveFallbacks', () => {
      it('returns actions for multiple downed services', () => {
        const actions = getActiveFallbacks(['redis', 'openai_llm']);
        expect(actions).toHaveLength(2);
        expect(actions.map((a) => a.service)).toContain('redis');
        expect(actions.map((a) => a.service)).toContain('openai_llm');
      });

      it('deduplicates services', () => {
        const actions = getActiveFallbacks(['redis', 'redis', 'redis']);
        expect(actions).toHaveLength(1);
      });

      it('returns empty for empty input', () => {
        expect(getActiveFallbacks([])).toHaveLength(0);
      });
    });

    describe('isFullOfflineMode', () => {
      it('returns true when network is down', () => {
        expect(isFullOfflineMode(['network'])).toBe(true);
        expect(isFullOfflineMode(['redis', 'network'])).toBe(true);
      });

      it('returns false when network is not down', () => {
        expect(isFullOfflineMode(['redis'])).toBe(false);
        expect(isFullOfflineMode(['openai_llm', 'redis'])).toBe(false);
        expect(isFullOfflineMode([])).toBe(false);
      });
    });

    describe('getAvailableFeatures', () => {
      it('returns all features when nothing is down', () => {
        const features = getAvailableFeatures([]);
        expect(features.length).toBeGreaterThan(0);
        expect(features).toContain('local-search');
        expect(features).toContain('note-editing');
        expect(features).toContain('ai-chat');
      });

      it('removes AI features when LLM is down', () => {
        const features = getAvailableFeatures(['openai_llm']);
        expect(features).not.toContain('ai-chat');
        expect(features).not.toContain('ai-extraction');
        expect(features).toContain('local-search');
        expect(features).toContain('note-editing');
      });

      it('removes search features when embedding is down', () => {
        const features = getAvailableFeatures(['openai_embedding']);
        expect(features).not.toContain('semantic-search');
        expect(features).toContain('local-search');
      });

      it('removes cache features when redis is down', () => {
        const features = getAvailableFeatures(['redis']);
        expect(features).not.toContain('cached-reads');
        expect(features).toContain('local-search');
      });

      it('returns only offline features when network is down', () => {
        const features = getAvailableFeatures(['network']);
        expect(features).toContain('local-search');
        expect(features).toContain('note-editing');
        expect(features).toContain('graph-browsing');
        expect(features).toContain('offline-queue');
        expect(features).not.toContain('ai-chat');
        expect(features).not.toContain('multi-device-sync');
      });

      it('handles multiple services down', () => {
        const features = getAvailableFeatures(['openai_llm', 'openai_embedding', 'redis']);
        expect(features).not.toContain('ai-chat');
        expect(features).not.toContain('semantic-search');
        expect(features).not.toContain('cached-reads');
        expect(features).toContain('local-search');
        expect(features).toContain('note-editing');
      });
    });
  });
});
