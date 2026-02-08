/**
 * @module @nous/core/llm
 * @description Types and Zod schemas for LLM Integration Layer (NLIL)
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-015
 * @storm Brainstorms/Infrastructure/storm-015-llm-integration
 *
 * All interfaces, types, and Zod schemas for the LLM integration layer.
 */

import { z } from 'zod';
import {
  type Provider,
  type ModelTier,
  type OperationType,
  type UrgencyLevel,
  type DegradationLevel,
  type ReservationStatus,
  type ProviderHealthStatus,
  type CacheablePromptType,
  type EmbeddingModel,
  type EmbeddingMode,
  type BatchJobStatus,
  type UserPlan,
  ProviderSchema,
  ModelTierSchema,
  OperationTypeSchema,
  UrgencyLevelSchema,
  DegradationLevelSchema,
  ReservationStatusSchema,
  ProviderHealthStatusSchema,
  CacheablePromptTypeSchema,
  EmbeddingModelSchema,
  EmbeddingModeSchema,
  BatchJobStatusSchema,
  UserPlanSchema,
} from './constants';

// ============================================================
// MODEL PRICING
// ============================================================

/**
 * Model pricing per 1M tokens.
 */
export interface ModelPricing {
  /** Input cost per 1M tokens */
  input: number;
  /** Output cost per 1M tokens */
  output: number;
  /** Cache read cost per 1M tokens (typically 0.1x base) */
  cache_read?: number;
  /** Cache write cost per 1M tokens (typically 1.25x base for 5min TTL) */
  cache_write?: number;
}

export const ModelPricingSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cache_read: z.number().nonnegative().optional(),
  cache_write: z.number().nonnegative().optional(),
});

// ============================================================
// MODEL CONFIGURATION
// ============================================================

/**
 * Complete model configuration.
 */
export interface ModelConfig {
  /** Model identifier */
  id: string;
  /** Provider that offers this model */
  provider: Provider;
  /** Cost/capability tier */
  tier: ModelTier;
  /** Pricing per 1M tokens */
  pricing: ModelPricing;
  /** Maximum context window in tokens */
  context_window: number;
  /** Whether model supports prompt caching */
  supports_cache: boolean;
  /** Whether model supports batch API */
  supports_batch: boolean;
  /** Display name for UI */
  display_name: string;
}

export const ModelConfigSchema = z.object({
  id: z.string(),
  provider: ProviderSchema,
  tier: ModelTierSchema,
  pricing: ModelPricingSchema,
  context_window: z.number().positive(),
  supports_cache: z.boolean(),
  supports_batch: z.boolean(),
  display_name: z.string(),
});

// ============================================================
// PROVIDER CONFIGURATION
// ============================================================

/**
 * Provider rate limits.
 */
export interface ProviderRateLimits {
  /** Requests per minute */
  rpm: number;
  /** Tokens per minute */
  tpm: number;
}

export const ProviderRateLimitsSchema = z.object({
  rpm: z.number().positive(),
  tpm: z.number().positive(),
});

/**
 * Provider configuration.
 */
export interface ProviderConfig {
  /** Provider identifier */
  id: Provider;
  /** Display name */
  name: string;
  /** Available models */
  models: string[];
  /** Rate limits */
  rate_limits: ProviderRateLimits;
  /** Health check endpoint (if available) */
  health_check_url?: string;
  /** Base API URL */
  api_base_url: string;
}

export const ProviderConfigSchema = z.object({
  id: ProviderSchema,
  name: z.string(),
  models: z.array(z.string()),
  rate_limits: ProviderRateLimitsSchema,
  health_check_url: z.string().url().optional(),
  api_base_url: z.string().url(),
});

// ============================================================
// COST ESTIMATION
// ============================================================

/**
 * Cost estimate range.
 * Always provide min/expected/max, not a single number.
 */
export interface CostRange {
  /** Minimum expected cost (optimistic) */
  min: number;
  /** Expected cost (average) */
  expected: number;
  /** Maximum expected cost (pessimistic) */
  max: number;
}

export const CostRangeSchema = z.object({
  min: z.number().nonnegative(),
  expected: z.number().nonnegative(),
  max: z.number().nonnegative(),
});

// ============================================================
// OPERATION CONFIGURATION
// ============================================================

/**
 * Operation configuration with routing rules.
 */
export interface OperationConfig {
  /** Operation type identifier */
  type: OperationType;
  /** Model tier for this operation */
  tier: ModelTier;
  /** Primary model to use (or 'rules' for rules-first) */
  primary_model: string;
  /** Fallback models in order of preference */
  fallback_models: string[];
  /** Cost estimate range in dollars */
  cost_estimate: CostRange;
  /** Target latency in milliseconds */
  latency_target_ms: number;
  /** Whether to try rules before LLM */
  rules_first: boolean;
  /** Description for logging/UI */
  description: string;
}

export const OperationConfigSchema = z.object({
  type: OperationTypeSchema,
  tier: ModelTierSchema,
  primary_model: z.string(),
  fallback_models: z.array(z.string()),
  cost_estimate: CostRangeSchema,
  latency_target_ms: z.number().positive(),
  rules_first: z.boolean(),
  description: z.string(),
});

// ============================================================
// TOKEN USAGE
// ============================================================

/**
 * Token usage details from LLM response.
 */
export interface TokenUsage {
  /** Number of input tokens */
  input_tokens: number;
  /** Number of output tokens */
  output_tokens: number;
  /** Number of tokens read from cache */
  cache_read_tokens?: number;
  /** Number of tokens written to cache */
  cache_write_tokens?: number;
}

export const TokenUsageSchema = z.object({
  input_tokens: z.number().nonnegative(),
  output_tokens: z.number().nonnegative(),
  cache_read_tokens: z.number().nonnegative().optional(),
  cache_write_tokens: z.number().nonnegative().optional(),
});

// ============================================================
// REQUEST/RESPONSE TYPES
// ============================================================

/**
 * LLM request.
 */
export interface LLMRequest {
  /** Operation type determines model selection */
  operation: OperationType;
  /** Input text/prompt */
  input: string;
  /** System prompt (if any) */
  system_prompt?: string;
  /** Additional context */
  context?: string;
  /** User ID for credit tracking */
  user_id: string;
  /** Request urgency affects routing */
  urgency: UrgencyLevel;
  /** Maximum output tokens */
  max_tokens?: number;
  /** Temperature for generation */
  temperature?: number;
  /** Request ID for tracking */
  request_id?: string;
}

export const LLMRequestSchema = z.object({
  operation: OperationTypeSchema,
  input: z.string(),
  system_prompt: z.string().optional(),
  context: z.string().optional(),
  user_id: z.string(),
  urgency: UrgencyLevelSchema,
  max_tokens: z.number().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  request_id: z.string().optional(),
});

/**
 * LLM response.
 */
export interface LLMResponse {
  /** Generated content */
  content: string;
  /** Model that was used */
  model_used: string;
  /** Provider that was used */
  provider: Provider;
  /** Token usage details */
  usage: TokenUsage;
  /** Actual latency in milliseconds */
  latency_ms: number;
  /** Whether response was from cache */
  cached: boolean;
  /** Finish reason */
  finish_reason: 'stop' | 'length' | 'content_filter' | 'error';
  /** Request ID for tracking */
  request_id?: string;
}

export const LLMResponseSchema = z.object({
  content: z.string(),
  model_used: z.string(),
  provider: ProviderSchema,
  usage: TokenUsageSchema,
  latency_ms: z.number().nonnegative(),
  cached: z.boolean(),
  finish_reason: z.enum(['stop', 'length', 'content_filter', 'error']),
  request_id: z.string().optional(),
});

// ============================================================
// ROUTING DECISION
// ============================================================

/**
 * Routing decision result.
 */
export interface RoutingDecision {
  /** Selected model */
  model: string;
  /** Selected provider */
  provider: Provider;
  /** Reason for selection */
  reason: 'primary' | 'fallback' | 'rate_limited' | 'health' | 'tier_downgrade';
  /** Estimated cost range */
  cost_estimate: CostRange;
  /** Use rules first before LLM? */
  use_rules_first: boolean;
  /** Use batch API? */
  use_batch: boolean;
}

export const RoutingDecisionSchema = z.object({
  model: z.string(),
  provider: ProviderSchema,
  reason: z.enum(['primary', 'fallback', 'rate_limited', 'health', 'tier_downgrade']),
  cost_estimate: CostRangeSchema,
  use_rules_first: z.boolean(),
  use_batch: z.boolean(),
});

// ============================================================
// CREDIT RESERVATION
// ============================================================

/**
 * Credit reservation for an LLM operation.
 */
export interface CreditReservation {
  /** Unique reservation ID */
  id: string;
  /** User ID */
  user_id: string;
  /** Reserved amount (max estimate) */
  amount: number;
  /** Operation type */
  operation: OperationType;
  /** When reservation was created */
  created_at: string;
  /** When reservation expires */
  expires_at: string;
  /** Current status */
  status: ReservationStatus;
  /** Actual amount deducted (after finalization) */
  actual_amount?: number;
  /** Associated request ID */
  request_id?: string;
}

export const CreditReservationSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  amount: z.number().nonnegative(),
  operation: OperationTypeSchema,
  created_at: z.string(),
  expires_at: z.string(),
  status: ReservationStatusSchema,
  actual_amount: z.number().nonnegative().optional(),
  request_id: z.string().optional(),
});

// ============================================================
// CREDIT TRANSACTION
// ============================================================

/**
 * Credit transaction record.
 */
export interface CreditTransaction {
  /** Unique transaction ID */
  id: string;
  /** User ID */
  user_id: string;
  /** Amount (positive = deduction, negative = refund) */
  amount: number;
  /** Operation type */
  operation: OperationType;
  /** Model used */
  model_used: string;
  /** Associated reservation ID */
  reservation_id?: string;
  /** Transaction type */
  type: 'deduction' | 'refund' | 'adjustment';
  /** When transaction occurred */
  created_at: string;
  /** Description */
  description?: string;
}

export const CreditTransactionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  amount: z.number(),
  operation: OperationTypeSchema,
  model_used: z.string(),
  reservation_id: z.string().optional(),
  type: z.enum(['deduction', 'refund', 'adjustment']),
  created_at: z.string(),
  description: z.string().optional(),
});

// ============================================================
// CREDIT ERRORS
// ============================================================

/**
 * Insufficient credits error.
 */
export interface InsufficientCreditsError {
  /** Required amount */
  required: number;
  /** Available amount */
  available: number;
  /** Suggestion for user */
  suggestion: string;
}

export const InsufficientCreditsErrorSchema = z.object({
  required: z.number().nonnegative(),
  available: z.number().nonnegative(),
  suggestion: z.string(),
});

// ============================================================
// COST EVENTS (for UI)
// ============================================================

/**
 * Cost estimate event (before operation).
 */
export interface CostEstimateEvent {
  /** Event type */
  type: 'cost:estimate';
  /** Minimum estimate */
  min: number;
  /** Maximum estimate */
  max: number;
  /** Operation type */
  operation: OperationType;
}

export const CostEstimateEventSchema = z.object({
  type: z.literal('cost:estimate'),
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  operation: OperationTypeSchema,
});

/**
 * Running cost event (during streaming).
 */
export interface CostRunningEvent {
  /** Event type */
  type: 'cost:running';
  /** Current accumulated cost */
  current: number;
  /** Maximum reserved */
  max: number;
}

export const CostRunningEventSchema = z.object({
  type: z.literal('cost:running'),
  current: z.number().nonnegative(),
  max: z.number().nonnegative(),
});

/**
 * Final cost event (after operation).
 */
export interface CostFinalEvent {
  /** Event type */
  type: 'cost:final';
  /** Final cost */
  cost: number;
}

export const CostFinalEventSchema = z.object({
  type: z.literal('cost:final'),
  cost: z.number().nonnegative(),
});

/**
 * Union of all cost events.
 */
export type CostEvent = CostEstimateEvent | CostRunningEvent | CostFinalEvent;

export const CostEventSchema = z.discriminatedUnion('type', [
  CostEstimateEventSchema,
  CostRunningEventSchema,
  CostFinalEventSchema,
]);

// ============================================================
// CREDIT CHECK RESULT
// ============================================================

/**
 * Result of credit check.
 */
export interface CreditCheckResult {
  /** Whether user has sufficient credits */
  sufficient: boolean;
  /** User's available credits */
  available: number;
  /** Required amount (max estimate) */
  required: number;
  /** Whether to proceed with cheaper model */
  can_proceed_cheaper?: boolean;
  /** Error details if insufficient */
  error?: InsufficientCreditsError;
}

export const CreditCheckResultSchema = z.object({
  sufficient: z.boolean(),
  available: z.number().nonnegative(),
  required: z.number().nonnegative(),
  can_proceed_cheaper: z.boolean().optional(),
  error: InsufficientCreditsErrorSchema.optional(),
});

// ============================================================
// CREDIT FLOW CONFIG
// ============================================================

/**
 * Full credit flow configuration.
 */
export interface CreditFlowConfig {
  /** Buffer multiplier for reservations */
  reservation_buffer: number;
  /** Reservation expiry in minutes */
  reservation_expiry_minutes: number;
  /** Whether to emit cost events */
  emit_events: boolean;
}

export const CreditFlowConfigSchema = z.object({
  reservation_buffer: z.number().positive(),
  reservation_expiry_minutes: z.number().positive(),
  emit_events: z.boolean(),
});

// ============================================================
// CACHE CONFIGURATION
// ============================================================

/**
 * Cache configuration for a prompt type.
 */
export interface PromptCacheConfig {
  /** Prompt type identifier */
  prompt_type: CacheablePromptType;
  /** The system prompt content (set by storm-027) */
  content: string;
  /** Approximate token count */
  tokens: number;
  /** Cache TTL in minutes */
  ttl_minutes: number;
  /** Minimum tokens for caching (Anthropic: 1024) */
  min_tokens: number;
}

export const PromptCacheConfigSchema = z.object({
  prompt_type: CacheablePromptTypeSchema,
  content: z.string(),
  tokens: z.number().nonnegative(),
  ttl_minutes: z.number().positive(),
  min_tokens: z.number().positive(),
});

// ============================================================
// CACHE HIT RESULT
// ============================================================

/**
 * Result of checking prompt cache.
 */
export interface CacheHitResult {
  /** Whether cache was hit */
  hit: boolean;
  /** Cache entry ID (if hit) */
  cache_id?: string;
  /** Tokens saved by cache hit */
  tokens_saved?: number;
  /** Cost saved by cache hit */
  cost_saved?: number;
  /** When cache entry expires */
  expires_at?: string;
}

export const CacheHitResultSchema = z.object({
  hit: z.boolean(),
  cache_id: z.string().optional(),
  tokens_saved: z.number().nonnegative().optional(),
  cost_saved: z.number().nonnegative().optional(),
  expires_at: z.string().optional(),
});

// ============================================================
// CACHE SAVINGS
// ============================================================

/**
 * Estimated savings from caching.
 */
export interface CacheSavingsEstimate {
  /** Cost without caching */
  without_cache: number;
  /** Cost with caching (after first call) */
  with_cache: number;
  /** Savings percentage */
  savings_percent: number;
  /** Break-even number of calls */
  break_even_calls: number;
}

export const CacheSavingsEstimateSchema = z.object({
  without_cache: z.number().nonnegative(),
  with_cache: z.number().nonnegative(),
  savings_percent: z.number().nonnegative(),
  break_even_calls: z.number().positive(),
});

// ============================================================
// CACHE ENTRY
// ============================================================

/**
 * Cache entry tracking.
 */
export interface CacheEntry {
  /** Unique cache ID */
  id: string;
  /** Prompt type */
  prompt_type: CacheablePromptType;
  /** Content hash for comparison */
  content_hash: string;
  /** Token count */
  tokens: number;
  /** When entry was created */
  created_at: string;
  /** When entry expires */
  expires_at: string;
  /** Number of times read */
  read_count: number;
  /** Total tokens saved */
  total_tokens_saved: number;
}

export const CacheEntrySchema = z.object({
  id: z.string(),
  prompt_type: CacheablePromptTypeSchema,
  content_hash: z.string(),
  tokens: z.number().positive(),
  created_at: z.string(),
  expires_at: z.string(),
  read_count: z.number().nonnegative(),
  total_tokens_saved: z.number().nonnegative(),
});

// ============================================================
// EMBEDDING REQUEST/RESULT
// ============================================================

/**
 * Embedding request.
 */
export interface EmbeddingRequest {
  /** Texts to embed */
  texts: string[];
  /** Operation mode */
  mode: EmbeddingMode;
  /** Model to use (defaults to text-embedding-3-small) */
  model?: EmbeddingModel;
  /** User ID for tracking */
  user_id: string;
  /** Request ID */
  request_id?: string;
}

export const EmbeddingRequestSchema = z.object({
  texts: z.array(z.string()),
  mode: EmbeddingModeSchema,
  model: EmbeddingModelSchema.optional(),
  user_id: z.string(),
  request_id: z.string().optional(),
});

/**
 * Embedding result.
 */
export interface EmbeddingResult {
  /** Generated embeddings (one per input text) */
  embeddings: number[][];
  /** Model used */
  model: EmbeddingModel;
  /** Embedding dimensions */
  dimensions: number;
  /** Token usage */
  usage: {
    total_tokens: number;
  };
  /** Whether results came from cache */
  cached: boolean;
  /** Latency in milliseconds */
  latency_ms: number;
}

export const EmbeddingResultSchema = z.object({
  embeddings: z.array(z.array(z.number())),
  model: EmbeddingModelSchema,
  dimensions: z.number().positive(),
  usage: z.object({
    total_tokens: z.number().nonnegative(),
  }),
  cached: z.boolean(),
  latency_ms: z.number().nonnegative(),
});

// ============================================================
// BATCH JOB
// ============================================================

/**
 * Embedding batch job.
 */
export interface EmbeddingBatchJob {
  /** Unique job ID */
  id: string;
  /** Number of texts in batch */
  texts_count: number;
  /** Current status */
  status: BatchJobStatus;
  /** When job was created */
  created_at: string;
  /** When job was completed (if completed) */
  completed_at?: string;
  /** Deadline for completion */
  deadline: string;
  /** URL to retrieve results (when completed) */
  result_url?: string;
  /** Error message (if failed) */
  error?: string;
  /** Progress (0-100) */
  progress?: number;
}

export const EmbeddingBatchJobSchema = z.object({
  id: z.string(),
  texts_count: z.number().positive(),
  status: BatchJobStatusSchema,
  created_at: z.string(),
  completed_at: z.string().optional(),
  deadline: z.string(),
  result_url: z.string().url().optional(),
  error: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
});

// ============================================================
// EMBEDDING SERVICE CONFIG
// ============================================================

/**
 * Embedding service configuration.
 */
export interface EmbeddingServiceConfig {
  /** Default model */
  model: EmbeddingModel;
  /** Embedding dimensions */
  dimensions: number;
  /** Pricing per 1M tokens */
  pricing: {
    realtime: number;
    batch: number; // 50% off
  };
  /** Cache configuration */
  cache: {
    enabled: boolean;
    ttl_days: number;
    max_size: string;
  };
}

export const EmbeddingServiceConfigSchema = z.object({
  model: EmbeddingModelSchema,
  dimensions: z.number().positive(),
  pricing: z.object({
    realtime: z.number().nonnegative(),
    batch: z.number().nonnegative(),
  }),
  cache: z.object({
    enabled: z.boolean(),
    ttl_days: z.number().positive(),
    max_size: z.string(),
  }),
});

// ============================================================
// RATE LIMIT STATE
// ============================================================

/**
 * Rate limit state for a single provider.
 */
export interface RateLimitState {
  /** Provider identifier */
  provider: Provider;
  /** Requests made this minute */
  requests_this_minute: number;
  /** Tokens used this minute */
  tokens_this_minute: number;
  /** Configured limits */
  limit: {
    rpm: number;
    tpm: number;
  };
  /** When counters reset */
  reset_at: string;
  /** Current health status */
  health: ProviderHealthStatus;
}

export const RateLimitStateSchema = z.object({
  provider: ProviderSchema,
  requests_this_minute: z.number().nonnegative(),
  tokens_this_minute: z.number().nonnegative(),
  limit: z.object({
    rpm: z.number().positive(),
    tpm: z.number().positive(),
  }),
  reset_at: z.string(),
  health: ProviderHealthStatusSchema,
});

// ============================================================
// PROVIDER SELECTION
// ============================================================

/**
 * Result of provider selection.
 */
export interface ProviderSelection {
  /** Selected provider */
  provider: Provider;
  /** Selected model */
  model: string;
  /** Reason for selection */
  reason: 'primary' | 'fallback' | 'rate_limited' | 'health';
  /** Whether rate limit is approaching */
  rate_limit_warning: boolean;
}

export const ProviderSelectionSchema = z.object({
  provider: ProviderSchema,
  model: z.string(),
  reason: z.enum(['primary', 'fallback', 'rate_limited', 'health']),
  rate_limit_warning: z.boolean(),
});

// ============================================================
// HEALTH CHECK
// ============================================================

/**
 * Provider health check result.
 */
export interface ProviderHealthCheck {
  /** Provider identifier */
  provider: Provider;
  /** Whether provider is healthy */
  healthy: boolean;
  /** Response latency in milliseconds */
  latency_ms?: number;
  /** Error message if unhealthy */
  error?: string;
  /** When check was performed */
  checked_at: string;
  /** Consecutive failure count */
  consecutive_failures: number;
}

export const ProviderHealthCheckSchema = z.object({
  provider: ProviderSchema,
  healthy: z.boolean(),
  latency_ms: z.number().nonnegative().optional(),
  error: z.string().optional(),
  checked_at: z.string(),
  consecutive_failures: z.number().nonnegative(),
});

// ============================================================
// RATE LIMIT EVENT
// ============================================================

/**
 * Event emitted when approaching or hitting rate limits.
 */
export interface RateLimitEvent {
  /** Event type */
  type: 'rate_limit:warning' | 'rate_limit:exceeded';
  /** Affected provider */
  provider: Provider;
  /** Current usage percentage */
  usage_percent: number;
  /** When limit resets */
  reset_at: string;
  /** Suggested action */
  action: 'route_away' | 'queue' | 'wait';
}

export const RateLimitEventSchema = z.object({
  type: z.enum(['rate_limit:warning', 'rate_limit:exceeded']),
  provider: ProviderSchema,
  usage_percent: z.number().min(0).max(100),
  reset_at: z.string(),
  action: z.enum(['route_away', 'queue', 'wait']),
});

// ============================================================
// RATE LIMIT CONFIG
// ============================================================

/**
 * Rate limit configuration.
 */
export interface RateLimitConfig {
  /** Threshold for proactive routing (0-1) */
  warning_threshold: number;
  /** Health check interval in ms */
  health_check_interval_ms: number;
  /** Health check timeout in ms */
  health_check_timeout_ms: number;
  /** Failures before marking down */
  failure_threshold: number;
}

export const RateLimitConfigSchema = z.object({
  warning_threshold: z.number().min(0).max(1),
  health_check_interval_ms: z.number().positive(),
  health_check_timeout_ms: z.number().positive(),
  failure_threshold: z.number().positive(),
});

// ============================================================
// DEGRADATION MODE
// ============================================================

/**
 * What capabilities are available at each degradation level.
 */
export interface DegradationModeConfig {
  /** Current degradation level */
  level: DegradationLevel;
  /** How classification works at this level */
  classification: 'llm' | 'rules_only';
  /** Response quality at this level */
  response: 'premium' | 'basic' | 'template';
  /** Extraction mode at this level */
  extraction: 'realtime' | 'batch' | 'queued';
  /** User-facing message (if any) */
  user_message?: string;
}

export const DegradationModeConfigSchema = z.object({
  level: DegradationLevelSchema,
  classification: z.enum(['llm', 'rules_only']),
  response: z.enum(['premium', 'basic', 'template']),
  extraction: z.enum(['realtime', 'batch', 'queued']),
  user_message: z.string().optional(),
});

// ============================================================
// SYSTEM HEALTH STATUS
// ============================================================

/**
 * Current system health status.
 */
export interface SystemHealthStatus {
  /** Current degradation level */
  level: DegradationLevel;
  /** Providers that are healthy */
  healthy_providers: Provider[];
  /** Providers that are degraded */
  degraded_providers: Provider[];
  /** Providers that are down */
  down_providers: Provider[];
  /** When status was last checked */
  last_check: string;
  /** How long in current state (ms) */
  duration_in_state_ms: number;
}

export const SystemHealthStatusSchema = z.object({
  level: DegradationLevelSchema,
  healthy_providers: z.array(ProviderSchema),
  degraded_providers: z.array(ProviderSchema),
  down_providers: z.array(ProviderSchema),
  last_check: z.string(),
  duration_in_state_ms: z.number().nonnegative(),
});

// ============================================================
// OPERATION AVAILABILITY
// ============================================================

/**
 * Operation availability at a degradation level.
 */
export interface OperationAvailability {
  /** Operation type */
  operation: OperationType;
  /** Whether available at current level */
  available: boolean;
  /** How operation behaves at current level */
  mode: 'full' | 'reduced' | 'unavailable';
  /** Description of behavior */
  description: string;
}

export const OperationAvailabilitySchema = z.object({
  operation: OperationTypeSchema,
  available: z.boolean(),
  mode: z.enum(['full', 'reduced', 'unavailable']),
  description: z.string(),
});

// ============================================================
// DEGRADATION EVENT
// ============================================================

/**
 * Event emitted when degradation level changes.
 */
export interface DegradationEvent {
  /** Event type */
  type: 'degradation:changed';
  /** Previous level */
  from: DegradationLevel;
  /** New level */
  to: DegradationLevel;
  /** Reason for change */
  reason: string;
  /** User-facing message */
  user_message?: string;
  /** When change occurred */
  changed_at: string;
}

export const DegradationEventSchema = z.object({
  type: z.literal('degradation:changed'),
  from: DegradationLevelSchema,
  to: DegradationLevelSchema,
  reason: z.string(),
  user_message: z.string().optional(),
  changed_at: z.string(),
});

// ============================================================
// USAGE LIMITS
// ============================================================

/**
 * Usage limits per plan type.
 */
export interface PlanUsageLimits {
  /** Plan identifier */
  plan: UserPlan;
  /** Maximum API cost per day (undefined = no ceiling) */
  daily_cost_ceiling?: number;
  /** Percentage of limit before model downgrade (0-1) */
  model_downgrade_threshold: number;
  /** Whether to enforce strict limits */
  strict_enforcement: boolean;
}

export const PlanUsageLimitsSchema = z.object({
  plan: UserPlanSchema,
  daily_cost_ceiling: z.number().positive().optional(),
  model_downgrade_threshold: z.number().min(0).max(1),
  strict_enforcement: z.boolean(),
});

// ============================================================
// USER USAGE STATE
// ============================================================

/**
 * Current usage state for a user.
 */
export interface UserUsageState {
  /** User ID */
  user_id: string;
  /** User's plan */
  plan: UserPlan;
  /** Total cost used today */
  today_usage: number;
  /** Daily limit (from plan or wallet) */
  daily_limit: number;
  /** Current available model tier */
  model_tier_available: ModelTier;
  /** When limit resets (user's local midnight) */
  reset_at: string;
  /** Whether currently in downgraded mode */
  is_downgraded: boolean;
  /** Whether limit has been reached */
  limit_reached: boolean;
}

export const UserUsageStateSchema = z.object({
  user_id: z.string(),
  plan: UserPlanSchema,
  today_usage: z.number().nonnegative(),
  daily_limit: z.number().nonnegative(),
  model_tier_available: ModelTierSchema,
  reset_at: z.string(),
  is_downgraded: z.boolean(),
  limit_reached: z.boolean(),
});

// ============================================================
// MODEL DOWNGRADE NOTIFICATION
// ============================================================

/**
 * Notification when models are downgraded.
 */
export interface ModelDowngradeNotification {
  /** Notification type */
  type: 'approaching_limit' | 'limit_reached';
  /** Current usage */
  current_usage: number;
  /** Daily limit */
  daily_limit: number;
  /** Previous tier */
  from_tier: ModelTier;
  /** New tier */
  to_tier: ModelTier;
  /** User-facing message */
  message: string;
}

export const ModelDowngradeNotificationSchema = z.object({
  type: z.enum(['approaching_limit', 'limit_reached']),
  current_usage: z.number().nonnegative(),
  daily_limit: z.number().nonnegative(),
  from_tier: ModelTierSchema,
  to_tier: ModelTierSchema,
  message: z.string(),
});

// ============================================================
// USAGE EVENTS
// ============================================================

/**
 * Usage limit events.
 */
export interface UsageLimitEvent {
  /** Event type */
  type: 'usage:warning' | 'usage:downgrade' | 'usage:limit_reached' | 'usage:reset';
  /** User ID */
  user_id: string;
  /** Current usage */
  current_usage: number;
  /** Daily limit */
  daily_limit: number;
  /** Usage percentage */
  usage_percent: number;
  /** Available model tier */
  model_tier: ModelTier;
  /** User-facing message */
  message: string;
}

export const UsageLimitEventSchema = z.object({
  type: z.enum(['usage:warning', 'usage:downgrade', 'usage:limit_reached', 'usage:reset']),
  user_id: z.string(),
  current_usage: z.number().nonnegative(),
  daily_limit: z.number().nonnegative(),
  usage_percent: z.number().min(0).max(100),
  model_tier: ModelTierSchema,
  message: z.string(),
});

// ============================================================
// PRICING CONFIG
// ============================================================

/**
 * Pricing configuration structure for external config file.
 */
export interface PricingConfig {
  providers: Record<string, Record<string, ModelPricing>>;
  last_updated: string;
  alert_on_change: boolean;
}

export const PricingConfigSchema = z.object({
  providers: z.record(z.record(ModelPricingSchema)),
  last_updated: z.string(),
  alert_on_change: z.boolean(),
});
