/**
 * @module @nous/core/llm
 * @description Constants for LLM Integration Layer (NLIL)
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-015
 * @storm Brainstorms/Infrastructure/storm-015-llm-integration
 *
 * All numeric thresholds, model IDs, rate limits, and configuration defaults.
 * These values are from storm-015 v1 revision and should not be changed
 * without updating the brainstorm.
 */

import { z } from 'zod';

// ============================================================
// PROVIDER CONSTANTS
// ============================================================

/**
 * Supported LLM providers.
 */
export const PROVIDERS = ['anthropic', 'openai', 'google'] as const;

export type Provider = (typeof PROVIDERS)[number];

export const ProviderSchema = z.enum(PROVIDERS);

/**
 * Type guard for Provider.
 */
export function isProvider(value: unknown): value is Provider {
  return PROVIDERS.includes(value as Provider);
}

// ============================================================
// MODEL CONSTANTS
// ============================================================

/**
 * Anthropic model identifiers.
 */
export const ANTHROPIC_MODELS = ['claude-sonnet-4', 'claude-3-haiku'] as const;

export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];

export const AnthropicModelSchema = z.enum(ANTHROPIC_MODELS);

/**
 * OpenAI model identifiers.
 */
export const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini'] as const;

export type OpenAIModel = (typeof OPENAI_MODELS)[number];

export const OpenAIModelSchema = z.enum(OPENAI_MODELS);

/**
 * Google model identifiers.
 */
export const GOOGLE_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite'] as const;

export type GoogleModel = (typeof GOOGLE_MODELS)[number];

export const GoogleModelSchema = z.enum(GOOGLE_MODELS);

/**
 * Embedding model identifiers for LLM module.
 * Renamed from EMBEDDING_MODELS to avoid conflict with embeddings module.
 */
export const LLM_EMBEDDING_MODELS = ['text-embedding-3-small', 'text-embedding-3-large'] as const;

export type EmbeddingModel = (typeof LLM_EMBEDDING_MODELS)[number];

export const EmbeddingModelSchema = z.enum(LLM_EMBEDDING_MODELS);

/**
 * All LLM model identifiers (excludes embeddings).
 */
export const LLM_MODELS = [
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
  ...GOOGLE_MODELS,
] as const;

export type LLMModel = (typeof LLM_MODELS)[number];

export const LLMModelSchema = z.enum(LLM_MODELS);

/**
 * Type guard for LLMModel.
 */
export function isLLMModel(value: unknown): value is LLMModel {
  return LLM_MODELS.includes(value as LLMModel);
}

// ============================================================
// MODEL TIER CONSTANTS
// ============================================================

/**
 * Model tiers by cost/capability.
 */
export const MODEL_TIERS = ['cheapest', 'cheap', 'balanced', 'premium'] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

export const ModelTierSchema = z.enum(MODEL_TIERS);

/**
 * Type guard for ModelTier.
 */
export function isModelTier(value: unknown): value is ModelTier {
  return MODEL_TIERS.includes(value as ModelTier);
}

// ============================================================
// OPERATION TYPE CONSTANTS
// ============================================================

/**
 * LLM operation types.
 */
export const OPERATION_TYPES = [
  'classification',
  'quick_response',
  'standard_response',
  'deep_thinking',
  'graph_cot',
  'extraction_simple',
  'extraction_complex',
  'embedding',
  'batch_extraction',
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

export const OperationTypeSchema = z.enum(OPERATION_TYPES);

/**
 * Type guard for OperationType.
 */
export function isOperationType(value: unknown): value is OperationType {
  return OPERATION_TYPES.includes(value as OperationType);
}

// ============================================================
// DEGRADATION CONSTANTS
// ============================================================

/**
 * System degradation levels.
 */
export const DEGRADATION_LEVELS = ['healthy', 'degraded', 'offline'] as const;

export type DegradationLevel = (typeof DEGRADATION_LEVELS)[number];

export const DegradationLevelSchema = z.enum(DEGRADATION_LEVELS);

/**
 * Type guard for DegradationLevel.
 */
export function isDegradationLevel(value: unknown): value is DegradationLevel {
  return DEGRADATION_LEVELS.includes(value as DegradationLevel);
}

// ============================================================
// URGENCY CONSTANTS
// ============================================================

/**
 * Request urgency levels.
 */
export const URGENCY_LEVELS = ['realtime', 'normal', 'background'] as const;

export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const UrgencyLevelSchema = z.enum(URGENCY_LEVELS);

/**
 * Type guard for UrgencyLevel.
 */
export function isUrgencyLevel(value: unknown): value is UrgencyLevel {
  return URGENCY_LEVELS.includes(value as UrgencyLevel);
}

// ============================================================
// RATE LIMIT CONSTANTS
// ============================================================

/**
 * Threshold for proactive routing away from a provider.
 * At 80% of rate limit, start routing to fallback providers.
 */
export const RATE_LIMIT_WARNING_THRESHOLD = 0.80;

/**
 * Rate limits per provider (from January 2026 data).
 */
export const PROVIDER_RATE_LIMITS: Record<Provider, { rpm: number; tpm: number }> = {
  anthropic: { rpm: 4000, tpm: 400000 },
  openai: { rpm: 10000, tpm: 2000000 },
  google: { rpm: 60000, tpm: 4000000 },
} as const;

// ============================================================
// EMBEDDING CONSTANTS
// ============================================================

/**
 * Default embedding model.
 */
export const DEFAULT_EMBEDDING_MODEL: EmbeddingModel = 'text-embedding-3-small';

/**
 * Embedding dimensions by model.
 * Renamed from EMBEDDING_DIMENSIONS to avoid conflict with embeddings module.
 */
export const LLM_EMBEDDING_DIMENSIONS: Record<EmbeddingModel, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
} as const;

/**
 * Embedding cache TTL in days.
 */
export const EMBEDDING_CACHE_TTL_DAYS = 7;

/**
 * Maximum embedding cache size.
 */
export const EMBEDDING_CACHE_MAX_SIZE = '1GB';

// ============================================================
// BATCH PROCESSING CONSTANTS
// ============================================================

/**
 * Batch API discount percentage.
 */
export const BATCH_DISCOUNT_PERCENT = 50;

/**
 * Batch API deadline in hours.
 */
export const BATCH_DEADLINE_HOURS = 24;

/**
 * Operations eligible for batch processing.
 */
export const BATCH_ELIGIBLE_OPERATIONS: readonly OperationType[] = [
  'extraction_simple',
  'extraction_complex',
  'embedding',
  'batch_extraction',
] as const;

// ============================================================
// CREDIT CONSTANTS
// ============================================================

/**
 * Free tier daily budget in dollars.
 */
export const FREE_DAILY_BUDGET = 0.05;

/**
 * Cost reservation buffer multiplier.
 * Reserve 1.5x the estimated max cost to prevent overdraft.
 */
export const COST_RESERVATION_BUFFER = 1.5;

/**
 * Reservation expiry in minutes.
 */
export const CREDIT_RESERVATION_EXPIRY_MINUTES = 30;

// ============================================================
// CACHE CONSTANTS
// ============================================================

/**
 * Prompt types that support caching.
 */
export const CACHEABLE_PROMPT_TYPES = ['classifier', 'extractor', 'responder'] as const;

export type CacheablePromptType = (typeof CACHEABLE_PROMPT_TYPES)[number];

export const CacheablePromptTypeSchema = z.enum(CACHEABLE_PROMPT_TYPES);

/**
 * Type guard for CacheablePromptType.
 */
export function isCacheablePromptType(value: unknown): value is CacheablePromptType {
  return CACHEABLE_PROMPT_TYPES.includes(value as CacheablePromptType);
}

/**
 * Cache TTL by prompt type (in minutes).
 */
export const CACHE_TTL_MINUTES: Record<CacheablePromptType, number> = {
  classifier: 60,
  extractor: 5,
  responder: 5,
} as const;

/**
 * Minimum tokens required for caching (Anthropic requirement).
 */
export const CACHE_MIN_TOKENS = 1024;

/**
 * Anthropic cache pricing multipliers.
 */
export const CACHE_PRICING_MULTIPLIERS = {
  /** 5-minute TTL cache write: 1.25x base */
  cache_write_5min: 1.25,
  /** 1-hour TTL cache write: 2.0x base */
  cache_write_1hr: 2.0,
  /** Cache read: 0.1x base (90% savings!) */
  cache_read: 0.10,
} as const;

// ============================================================
// LATENCY TARGET CONSTANTS
// ============================================================

/**
 * Latency targets by operation type (in milliseconds).
 */
export const LATENCY_TARGETS_MS: Record<OperationType, number> = {
  classification: 10,       // Rules path (LLM fallback: 500ms)
  quick_response: 500,      // TTFT
  standard_response: 1000,  // TTFT
  deep_thinking: 3000,      // TTFT
  graph_cot: 5000,          // Total time
  extraction_simple: 1000,
  extraction_complex: 5000,
  embedding: 200,
  batch_extraction: 86400000, // 24 hours
} as const;

// ============================================================
// USAGE LIMIT CONSTANTS
// ============================================================

/**
 * User plan types.
 */
export const USER_PLANS = ['free', 'credits', 'pro'] as const;

export type UserPlan = (typeof USER_PLANS)[number];

export const UserPlanSchema = z.enum(USER_PLANS);

/**
 * Type guard for UserPlan.
 */
export function isUserPlan(value: unknown): value is UserPlan {
  return USER_PLANS.includes(value as UserPlan);
}

/**
 * Model downgrade threshold as percentage of daily limit.
 */
export const MODEL_DOWNGRADE_THRESHOLD = 0.80;

/**
 * What free tier daily budget buys (for reference).
 */
export const FREE_TIER_CAPACITY = {
  /** Approximate quick thoughts per day */
  quick_thoughts: 5,
  /** Approximate standard thoughts per day */
  standard_thoughts: 1,
  /** Approximate deep thoughts per day (partial) */
  deep_thoughts: 0.5,
} as const;

// ============================================================
// HEALTH CHECK CONSTANTS
// ============================================================

/**
 * Health check interval in milliseconds.
 */
export const HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds

/**
 * Health check timeout in milliseconds.
 */
export const HEALTH_CHECK_TIMEOUT_MS = 5000; // 5 seconds

/**
 * Number of consecutive failures before marking provider as down.
 */
export const HEALTH_CHECK_FAILURE_THRESHOLD = 3;

// ============================================================
// RESERVATION STATUS CONSTANTS
// ============================================================

/**
 * Credit reservation statuses.
 */
export const RESERVATION_STATUSES = ['active', 'finalized', 'refunded', 'expired'] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const ReservationStatusSchema = z.enum(RESERVATION_STATUSES);

/**
 * Type guard for ReservationStatus.
 */
export function isReservationStatus(value: unknown): value is ReservationStatus {
  return RESERVATION_STATUSES.includes(value as ReservationStatus);
}

// ============================================================
// PROVIDER HEALTH CONSTANTS
// ============================================================

/**
 * Provider health statuses.
 */
export const PROVIDER_HEALTH_STATUSES = ['healthy', 'degraded', 'down'] as const;

export type ProviderHealthStatus = (typeof PROVIDER_HEALTH_STATUSES)[number];

export const ProviderHealthStatusSchema = z.enum(PROVIDER_HEALTH_STATUSES);

/**
 * Type guard for ProviderHealthStatus.
 */
export function isProviderHealthStatus(value: unknown): value is ProviderHealthStatus {
  return PROVIDER_HEALTH_STATUSES.includes(value as ProviderHealthStatus);
}

// ============================================================
// EMBEDDING MODE CONSTANTS
// ============================================================

/**
 * Embedding operation modes.
 */
export const EMBEDDING_MODES = ['realtime', 'batch'] as const;

export type EmbeddingMode = (typeof EMBEDDING_MODES)[number];

export const EmbeddingModeSchema = z.enum(EMBEDDING_MODES);

/**
 * Type guard for EmbeddingMode.
 */
export function isEmbeddingMode(value: unknown): value is EmbeddingMode {
  return EMBEDDING_MODES.includes(value as EmbeddingMode);
}

// ============================================================
// BATCH JOB STATUS CONSTANTS
// ============================================================

/**
 * Batch job statuses.
 */
export const BATCH_JOB_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;

export type BatchJobStatus = (typeof BATCH_JOB_STATUSES)[number];

export const BatchJobStatusSchema = z.enum(BATCH_JOB_STATUSES);

/**
 * Type guard for BatchJobStatus.
 */
export function isBatchJobStatus(value: unknown): value is BatchJobStatus {
  return BATCH_JOB_STATUSES.includes(value as BatchJobStatus);
}
