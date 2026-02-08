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

import { z } from 'zod';

import type {
  JobTriggerType,
  OpsErrorCategory,
  OpsErrorCode,
  NotifyChannel,
  NotifyPriority,
  CacheType,
  CacheStorageTier,
  EvictionPolicy,
  CacheWarmStrategy,
  OfflineQueueOpType,
  DegradableService,
  MetricType,
  BackoffStrategy,
} from './constants';

import {
  JOB_TRIGGER_TYPES,
  OPS_ERROR_CATEGORIES,
  OPS_ERROR_CODE_KEYS,
  NOTIFY_CHANNELS,
  NOTIFY_PRIORITIES,
  CACHE_TYPES,
  CACHE_STORAGE_TIERS,
  EVICTION_POLICIES,
  CACHE_WARM_STRATEGIES,
  OFFLINE_QUEUE_OP_TYPES,
  DEGRADABLE_SERVICES,
  METRIC_TYPES,
  BACKOFF_STRATEGIES,
} from './constants';

// ============================================================
// JOB PAYLOAD TYPES
// ============================================================

/** Base fields shared by all 14 job payloads. */
export interface BaseJobPayload {
  tenantId: string;
  correlationId: string;
  triggeredAt: string;
  triggeredBy: JobTriggerType;
}

export const BaseJobPayloadSchema = z.object({
  tenantId: z.string().min(1),
  correlationId: z.string().min(1),
  triggeredAt: z.string().datetime(),
  triggeredBy: z.enum(JOB_TRIGGER_TYPES),
});

/** J-001: Decay Cycle */
export interface DecayCyclePayload extends BaseJobPayload {
  type: 'decay-cycle';
  batchSize: number;
  offset?: number;
}

export const DecayCyclePayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('decay-cycle'),
  batchSize: z.number().int().positive(),
  offset: z.number().int().nonnegative().optional(),
});

/** J-002: Compression Run */
export interface CompressionRunPayload extends BaseJobPayload {
  type: 'compression-run';
  clusterId?: string;
  dryRun?: boolean;
}

export const CompressionRunPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('compression-run'),
  clusterId: z.string().optional(),
  dryRun: z.boolean().optional(),
});

/** J-003: Cleanup Dormant */
export interface CleanupDormantPayload extends BaseJobPayload {
  type: 'cleanup-dormant';
  dormantDays: number;
  action: 'archive' | 'notify' | 'delete';
}

export const CleanupDormantPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('cleanup-dormant'),
  dormantDays: z.number().int().positive(),
  action: z.enum(['archive', 'notify', 'delete']),
});

/** J-004: Similarity Batch */
export interface SimilarityBatchPayload extends BaseJobPayload {
  type: 'similarity-batch';
  sinceTimestamp?: string;
  threshold: number;
}

export const SimilarityBatchPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('similarity-batch'),
  sinceTimestamp: z.string().datetime().optional(),
  threshold: z.number().min(0).max(1),
});

/** J-005: Accessibility Audit */
export interface AccessibilityAuditPayload extends BaseJobPayload {
  type: 'accessibility-audit';
  notifyUser: boolean;
}

export const AccessibilityAuditPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('accessibility-audit'),
  notifyUser: z.boolean(),
});

/** J-006: Embed Single */
export interface EmbedSinglePayload extends BaseJobPayload {
  type: 'embed-single';
  nodeId: string;
  content: string;
  priority: 'high' | 'normal' | 'low';
}

export const EmbedSinglePayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('embed-single'),
  nodeId: z.string().min(1),
  content: z.string().min(1),
  priority: z.enum(['high', 'normal', 'low']),
});

/** J-007: Embed Batch */
export interface EmbedBatchPayload extends BaseJobPayload {
  type: 'embed-batch';
  nodeIds: string[];
  documentId?: string;
}

export const EmbedBatchPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('embed-batch'),
  nodeIds: z.array(z.string().min(1)).min(1),
  documentId: z.string().optional(),
});

/** J-008: Infer Edges */
export interface InferEdgesPayload extends BaseJobPayload {
  type: 'infer-edges';
  nodeId: string;
  contextNodeIds?: string[];
}

export const InferEdgesPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('infer-edges'),
  nodeId: z.string().min(1),
  contextNodeIds: z.array(z.string().min(1)).optional(),
});

/** J-009: Deduplicate */
export interface DeduplicatePayload extends BaseJobPayload {
  type: 'deduplicate';
  nodeId: string;
  similarityThreshold: number;
}

export const DeduplicatePayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('deduplicate'),
  nodeId: z.string().min(1),
  similarityThreshold: z.number().min(0).max(1),
});

/** J-010: Sync Retry */
export interface SyncRetryPayload extends BaseJobPayload {
  type: 'sync-retry';
  syncId: string;
  attempt: number;
  maxAttempts: number;
}

export const SyncRetryPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('sync-retry'),
  syncId: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
});

/** J-011: Cache Warm */
export interface CacheWarmPayload extends BaseJobPayload {
  type: 'cache-warm';
  strategy: CacheWarmStrategy;
  limit: number;
}

export const CacheWarmPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('cache-warm'),
  strategy: z.enum(CACHE_WARM_STRATEGIES),
  limit: z.number().int().positive(),
});

/** J-012: Metrics Collect */
export interface MetricsCollectPayload extends BaseJobPayload {
  type: 'metrics-collect';
  metrics: MetricType[];
}

export const MetricsCollectPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('metrics-collect'),
  metrics: z.array(z.enum(METRIC_TYPES)).min(1),
});

/** J-013: Embedding Backfill */
export interface EmbeddingBackfillPayload extends BaseJobPayload {
  type: 'embedding-backfill';
  batchSize: number;
  priority: 'stale' | 'failed' | 'missing';
}

export const EmbeddingBackfillPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('embedding-backfill'),
  batchSize: z.number().int().positive(),
  priority: z.enum(['stale', 'failed', 'missing']),
});

/** J-014: DLQ Process */
export interface DLQProcessPayload extends BaseJobPayload {
  type: 'dlq-process';
  limit: number;
  retryEligible: boolean;
}

export const DLQProcessPayloadSchema = BaseJobPayloadSchema.extend({
  type: z.literal('dlq-process'),
  limit: z.number().int().positive(),
  retryEligible: z.boolean(),
});

/** Discriminated union of all 14 job payloads. */
export type NBOSJobPayload =
  | DecayCyclePayload
  | CompressionRunPayload
  | CleanupDormantPayload
  | SimilarityBatchPayload
  | AccessibilityAuditPayload
  | EmbedSinglePayload
  | EmbedBatchPayload
  | InferEdgesPayload
  | DeduplicatePayload
  | SyncRetryPayload
  | CacheWarmPayload
  | MetricsCollectPayload
  | EmbeddingBackfillPayload
  | DLQProcessPayload;

/** Zod discriminated union of all 14 job payload schemas. */
export const NBOSJobPayloadSchema = z.discriminatedUnion('type', [
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
]);

// ============================================================
// JOB FAILURE CONFIG TYPE
// ============================================================

/** Failure handling configuration for a job. */
export interface JobFailureConfig {
  retries: number;
  backoff: BackoffStrategy;
  baseDelayMs: number;
  maxDelayMs: number;
  deadLetterAfter: number;
  alertAfter: number;
  userNotify: boolean;
  notifyChannel: NotifyChannel;
}

export const JobFailureConfigSchema = z.object({
  retries: z.number().int().nonnegative(),
  backoff: z.enum(BACKOFF_STRATEGIES),
  baseDelayMs: z.number().int().positive(),
  maxDelayMs: z.number().int().positive(),
  deadLetterAfter: z.number().int().positive(),
  alertAfter: z.number().int().positive(),
  userNotify: z.boolean(),
  notifyChannel: z.enum(NOTIFY_CHANNELS),
});

// ============================================================
// ERROR TYPES
// ============================================================

/** Operational error with full context. Created via createOperationalError(). */
export interface NousOperationalError {
  code: OpsErrorCode;
  category: OpsErrorCategory;
  message: string;
  userMessage: string;
  retryable: boolean;
  retryAfter?: number;
  notifyChannel: NotifyChannel;
  context?: Record<string, unknown>;
}

export const NousOperationalErrorSchema = z.object({
  code: z.enum(OPS_ERROR_CODE_KEYS as unknown as [string, ...string[]]),
  category: z.enum(OPS_ERROR_CATEGORIES),
  message: z.string(),
  userMessage: z.string(),
  retryable: z.boolean(),
  retryAfter: z.number().int().positive().optional(),
  notifyChannel: z.enum(NOTIFY_CHANNELS),
  context: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================
// CACHE TYPES
// ============================================================

/** Configuration for a single cache type. */
export interface CacheConfig {
  primaryStorage: CacheStorageTier;
  fallbackStorage?: CacheStorageTier;
  ttlSeconds: number;
  maxItems: number;
  maxBytes?: number;
  evictionPolicy: EvictionPolicy;
  warmStrategy: CacheWarmStrategy;
}

export const CacheConfigSchema = z.object({
  primaryStorage: z.enum(CACHE_STORAGE_TIERS),
  fallbackStorage: z.enum(CACHE_STORAGE_TIERS).optional(),
  ttlSeconds: z.number().int().positive(),
  maxItems: z.number().int().positive(),
  maxBytes: z.number().int().positive().optional(),
  evictionPolicy: z.enum(EVICTION_POLICIES),
  warmStrategy: z.enum(CACHE_WARM_STRATEGIES),
});

/** Runtime metrics for a cache instance. */
export interface CacheMetrics {
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

export const CacheMetricsSchema = z.object({
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
  p99LatencyMs: z.number().nonnegative(),
});

/** Stats returned by ICacheService.stats(). */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  bytesUsed: number;
  evictions: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
}

export const CacheStatsSchema = z.object({
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  bytesUsed: z.number().int().nonnegative(),
  evictions: z.number().int().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
  p99LatencyMs: z.number().nonnegative(),
});

/** Cache service interface (pure interface, implementation deferred to service layer). */
export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  deletePattern(pattern: string): Promise<number>;
  stats(): Promise<CacheStats>;
}

// ============================================================
// NETWORK & OFFLINE QUEUE TYPES
// ============================================================

/** Network monitor configuration. */
export interface NetworkMonitorConfig {
  checkIntervalMs: number;
  offlineThreshold: number;
  onlineThreshold: number;
  endpoints: readonly string[];
  timeoutMs: number;
}

export const NetworkMonitorConfigSchema = z.object({
  checkIntervalMs: z.number().int().positive(),
  offlineThreshold: z.number().int().positive(),
  onlineThreshold: z.number().int().positive(),
  endpoints: z.array(z.string().url()).min(1),
  timeoutMs: z.number().int().positive(),
});

/**
 * An operation queued for offline replay.
 * Persisted in SQLite via the offline_queue table.
 * _schemaVersion required for persisted types (Technical Audit finding).
 */
export interface QueuedOperation {
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

export const QueuedOperationSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  type: z.enum(OFFLINE_QUEUE_OP_TYPES),
  payload: z.unknown(),
  createdAt: z.string().datetime(),
  priority: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  lastAttempt: z.string().datetime().optional(),
  error: z.string().optional(),
});

// ============================================================
// NOTIFICATION TYPES
// ============================================================

/** Notification configuration for an event type. */
export interface NotificationConfig {
  channel: NotifyChannel;
  priority: NotifyPriority;
  autoDismissMs?: number;
  action?: { label: string; handler: string };
}

export const NotificationConfigSchema = z.object({
  channel: z.enum(NOTIFY_CHANNELS),
  priority: z.enum(NOTIFY_PRIORITIES),
  autoDismissMs: z.number().int().positive().optional(),
  action: z.object({
    label: z.string().min(1),
    handler: z.string().min(1),
  }).optional(),
});

// ============================================================
// DEGRADATION TYPES
// ============================================================

/** Degradation action for a downed service. */
export interface DegradationAction {
  service: DegradableService;
  impact: string;
  fallback: string;
}

export const DegradationActionSchema = z.object({
  service: z.enum(DEGRADABLE_SERVICES),
  impact: z.string().min(1),
  fallback: z.string().min(1),
});

// ============================================================
// ADDITIONAL UNION TYPES
// ============================================================

/** Priority for J-013 embedding backfill. */
export const EMBEDDING_BACKFILL_PRIORITIES = ['stale', 'failed', 'missing'] as const;
export type EmbeddingBackfillPriority = typeof EMBEDDING_BACKFILL_PRIORITIES[number];

/** Actions for J-003 cleanup dormant. */
export const CLEANUP_ACTIONS = ['archive', 'notify', 'delete'] as const;
export type CleanupAction = typeof CLEANUP_ACTIONS[number];

/** Priority for J-006 embed single. */
export const EMBED_PRIORITIES = ['high', 'normal', 'low'] as const;
export type EmbedPriority = typeof EMBED_PRIORITIES[number];
