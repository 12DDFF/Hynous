/**
 * @module @nous/core/llm
 * @description Tests for LLM Integration Layer (storm-015)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Constants
  PROVIDERS,
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  GOOGLE_MODELS,
  LLM_EMBEDDING_MODELS,
  LLM_MODELS,
  MODEL_TIERS,
  OPERATION_TYPES,
  DEGRADATION_LEVELS,
  URGENCY_LEVELS,
  USER_PLANS,
  RESERVATION_STATUSES,
  PROVIDER_HEALTH_STATUSES,
  EMBEDDING_MODES,
  BATCH_JOB_STATUSES,
  CACHEABLE_PROMPT_TYPES,
  RATE_LIMIT_WARNING_THRESHOLD,
  PROVIDER_RATE_LIMITS,
  DEFAULT_EMBEDDING_MODEL,
  LLM_EMBEDDING_DIMENSIONS,
  EMBEDDING_CACHE_TTL_DAYS,
  EMBEDDING_CACHE_MAX_SIZE,
  BATCH_DISCOUNT_PERCENT,
  BATCH_DEADLINE_HOURS,
  BATCH_ELIGIBLE_OPERATIONS,
  FREE_DAILY_BUDGET,
  COST_RESERVATION_BUFFER,
  CREDIT_RESERVATION_EXPIRY_MINUTES,
  CACHE_TTL_MINUTES,
  CACHE_MIN_TOKENS,
  CACHE_PRICING_MULTIPLIERS,
  LATENCY_TARGETS_MS,
  MODEL_DOWNGRADE_THRESHOLD,
  FREE_TIER_CAPACITY,
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_CHECK_FAILURE_THRESHOLD,

  // Type guards
  isProvider,
  isLLMModel,
  isModelTier,
  isOperationType,
  isDegradationLevel,
  isUrgencyLevel,
  isUserPlan,
  isReservationStatus,
  isProviderHealthStatus,
  isEmbeddingMode,
  isBatchJobStatus,
  isCacheablePromptType,

  // Zod schemas
  ProviderSchema,
  AnthropicModelSchema,
  OpenAIModelSchema,
  GoogleModelSchema,
  EmbeddingModelSchema,
  LLMModelSchema,
  ModelTierSchema,
  OperationTypeSchema,
  DegradationLevelSchema,
  UrgencyLevelSchema,
  UserPlanSchema,
  ReservationStatusSchema,
  ProviderHealthStatusSchema,
  EmbeddingModeSchema,
  BatchJobStatusSchema,
  CacheablePromptTypeSchema,
  ModelPricingSchema,
  ModelConfigSchema,
  ProviderRateLimitsSchema,
  ProviderConfigSchema,
  CostRangeSchema,
  OperationConfigSchema,
  LLMRequestSchema,
  TokenUsageSchema,
  LLMResponseSchema,
  RoutingDecisionSchema,
  CreditReservationSchema,
  CreditTransactionSchema,
  InsufficientCreditsErrorSchema,
  CreditCheckResultSchema,
  CostEstimateEventSchema,
  CostRunningEventSchema,
  CostFinalEventSchema,
  CreditFlowConfigSchema,
  PromptCacheConfigSchema,
  CacheHitResultSchema,
  CacheSavingsEstimateSchema,
  CacheEntrySchema,
  EmbeddingRequestSchema,
  EmbeddingResultSchema,
  EmbeddingBatchJobSchema,
  EmbeddingServiceConfigSchema,
  RateLimitStateSchema,
  ProviderSelectionSchema,
  ProviderHealthCheckSchema,
  RateLimitConfigSchema,
  DegradationModeConfigSchema,
  OperationAvailabilitySchema,
  SystemHealthStatusSchema,
  PlanUsageLimitsSchema,
  UserUsageStateSchema,
  ModelDowngradeNotificationSchema,

  // Configuration objects
  MODEL_CONFIGS,
  PROVIDER_CONFIGS,
  OPERATION_CONFIGS,
  PROMPT_CACHE_CONFIGS,
  CACHE_MULTIPLIERS,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG,
  DEGRADATION_MODE_CONFIGS,
  OPERATION_AVAILABILITY,
  PLAN_CONFIGS,
  USAGE_TIER_THRESHOLDS,
  TIER_DOWNGRADE_SEQUENCE,
  DOWNGRADE_MESSAGES,
  DEFAULT_CREDIT_FLOW_CONFIG,

  // Provider config functions
  getModelConfig,
  getProviderConfig,
  getModelsForProvider,
  getModelsForTier,
  getProviderForModel,
  calculateTokenCost,
  supportsCaching,
  supportsBatch,

  // Operation routing functions
  getOperationConfig,
  estimateOperationCost,
  shouldUseBatch,
  getLatencyTarget,
  routeRequest,
  getModelForOperation,

  // Credit flow functions
  getReservationBuffer,
  getReservationExpiryMinutes,
  calculateActualCost,
  checkCredits,
  reserveCredits,
  finalizeCredits,
  refundCredits,
  getCreditBalance,

  // Prompt cache functions
  getCacheConfig,
  modelSupportsCaching,
  calculateBreakEvenCalls,
  checkCacheHit,
  estimateCacheSavings,
  warmCache,
  invalidateCache,
  getCacheStats,

  // Embedding service functions
  getEmbeddingConfig,
  calculateEmbeddingCost,
  getBatchDiscountPercent,
  getBatchDeadlineHours,
  shouldUseBatchEmbedding,
  embedQuery,
  embedTexts,
  embedBatch,
  getBatchStatus,
  getBatchResults,
  cancelBatchJob,

  // Rate limit functions
  getRateLimitConfig,
  getProviderRateLimits,
  getRateLimitState,
  isProviderAvailable,
  isApproachingRateLimit,
  selectProvider,
  trackRequest,
  checkProviderHealth,
  getHealthyProviderCount,
  getAllProviderHealth,
  resetRateLimitCounters,
  calculateUsagePercent,

  // Degradation functions
  getCurrentDegradationLevel,
  setDegradationLevel,
  getDegradationModeConfig,
  getUserMessage,
  calculateDegradationLevel,
  isOperationAvailable,
  getOperationAvailability,
  handleProviderFailure,
  handleProviderRecovery,
  getSystemHealthStatus,

  // Usage limit functions
  getPlanConfig,
  calculateTierForUsage,
  getFreeTierCapacity,
  getDowngradeMessage,
  checkUserBudget,
  getUserUsageState,
  getAvailableModelTier,
  handleApproachingLimit,
  trackUsage,
  resetDailyUsage,
  isOperationAllowedForTier,

  // Types
  type Provider,
  type OperationType,
  type ModelTier,
  type DegradationLevel,
  type UrgencyLevel,
  type UserPlan,
  type CacheablePromptType,
} from './index';

// ============================================================
// CONSTANTS TESTS
// ============================================================

describe('LLM Constants', () => {
  describe('Provider Constants', () => {
    it('should have all expected providers', () => {
      expect(PROVIDERS).toContain('anthropic');
      expect(PROVIDERS).toContain('openai');
      expect(PROVIDERS).toContain('google');
      expect(PROVIDERS.length).toBe(3);
    });

    it('should have valid provider type guard', () => {
      expect(isProvider('anthropic')).toBe(true);
      expect(isProvider('openai')).toBe(true);
      expect(isProvider('google')).toBe(true);
      expect(isProvider('invalid')).toBe(false);
      expect(isProvider(123)).toBe(false);
    });
  });

  describe('Model Constants', () => {
    it('should have Anthropic models', () => {
      expect(ANTHROPIC_MODELS).toContain('claude-sonnet-4');
      expect(ANTHROPIC_MODELS).toContain('claude-3-haiku');
    });

    it('should have OpenAI models', () => {
      expect(OPENAI_MODELS).toContain('gpt-4o');
      expect(OPENAI_MODELS).toContain('gpt-4o-mini');
    });

    it('should have Google models', () => {
      expect(GOOGLE_MODELS).toContain('gemini-2.0-flash');
      expect(GOOGLE_MODELS).toContain('gemini-2.0-flash-lite');
    });

    it('should have embedding models', () => {
      expect(LLM_EMBEDDING_MODELS).toContain('text-embedding-3-small');
      expect(LLM_EMBEDDING_MODELS).toContain('text-embedding-3-large');
    });

    it('should combine all LLM models', () => {
      expect(LLM_MODELS.length).toBe(
        ANTHROPIC_MODELS.length + OPENAI_MODELS.length + GOOGLE_MODELS.length
      );
    });

    it('should have valid LLM model type guard', () => {
      expect(isLLMModel('claude-sonnet-4')).toBe(true);
      expect(isLLMModel('gpt-4o')).toBe(true);
      expect(isLLMModel('invalid-model')).toBe(false);
    });
  });

  describe('Model Tier Constants', () => {
    it('should have all model tiers', () => {
      expect(MODEL_TIERS).toContain('cheapest');
      expect(MODEL_TIERS).toContain('cheap');
      expect(MODEL_TIERS).toContain('balanced');
      expect(MODEL_TIERS).toContain('premium');
      expect(MODEL_TIERS.length).toBe(4);
    });

    it('should have valid model tier type guard', () => {
      expect(isModelTier('cheap')).toBe(true);
      expect(isModelTier('premium')).toBe(true);
      expect(isModelTier('invalid')).toBe(false);
    });
  });

  describe('Operation Type Constants', () => {
    it('should have all operation types', () => {
      expect(OPERATION_TYPES).toContain('classification');
      expect(OPERATION_TYPES).toContain('quick_response');
      expect(OPERATION_TYPES).toContain('standard_response');
      expect(OPERATION_TYPES).toContain('deep_thinking');
      expect(OPERATION_TYPES).toContain('graph_cot');
      expect(OPERATION_TYPES).toContain('extraction_simple');
      expect(OPERATION_TYPES).toContain('extraction_complex');
      expect(OPERATION_TYPES).toContain('embedding');
      expect(OPERATION_TYPES).toContain('batch_extraction');
      expect(OPERATION_TYPES.length).toBe(9);
    });

    it('should have valid operation type type guard', () => {
      expect(isOperationType('classification')).toBe(true);
      expect(isOperationType('deep_thinking')).toBe(true);
      expect(isOperationType('invalid')).toBe(false);
    });
  });

  describe('Degradation Level Constants', () => {
    it('should have all degradation levels', () => {
      expect(DEGRADATION_LEVELS).toContain('healthy');
      expect(DEGRADATION_LEVELS).toContain('degraded');
      expect(DEGRADATION_LEVELS).toContain('offline');
      expect(DEGRADATION_LEVELS.length).toBe(3);
    });

    it('should have valid degradation level type guard', () => {
      expect(isDegradationLevel('healthy')).toBe(true);
      expect(isDegradationLevel('offline')).toBe(true);
      expect(isDegradationLevel('invalid')).toBe(false);
    });
  });

  describe('User Plan Constants', () => {
    it('should have all user plans', () => {
      expect(USER_PLANS).toContain('free');
      expect(USER_PLANS).toContain('credits');
      expect(USER_PLANS).toContain('pro');
      expect(USER_PLANS.length).toBe(3);
    });

    it('should have valid user plan type guard', () => {
      expect(isUserPlan('free')).toBe(true);
      expect(isUserPlan('pro')).toBe(true);
      expect(isUserPlan('invalid')).toBe(false);
    });
  });

  describe('Rate Limit Constants', () => {
    it('should have warning threshold', () => {
      expect(RATE_LIMIT_WARNING_THRESHOLD).toBe(0.8);
    });

    it('should have provider rate limits', () => {
      expect(PROVIDER_RATE_LIMITS.anthropic).toEqual({ rpm: 4000, tpm: 400000 });
      expect(PROVIDER_RATE_LIMITS.openai).toEqual({ rpm: 10000, tpm: 2000000 });
      expect(PROVIDER_RATE_LIMITS.google).toEqual({ rpm: 60000, tpm: 4000000 });
    });
  });

  describe('Embedding Constants', () => {
    it('should have default embedding model', () => {
      expect(DEFAULT_EMBEDDING_MODEL).toBe('text-embedding-3-small');
    });

    it('should have embedding dimensions', () => {
      expect(LLM_EMBEDDING_DIMENSIONS['text-embedding-3-small']).toBe(1536);
      expect(LLM_EMBEDDING_DIMENSIONS['text-embedding-3-large']).toBe(3072);
    });

    it('should have cache TTL', () => {
      expect(EMBEDDING_CACHE_TTL_DAYS).toBe(7);
    });
  });

  describe('Batch Processing Constants', () => {
    it('should have batch discount', () => {
      expect(BATCH_DISCOUNT_PERCENT).toBe(50);
    });

    it('should have batch deadline', () => {
      expect(BATCH_DEADLINE_HOURS).toBe(24);
    });

    it('should have batch eligible operations', () => {
      expect(BATCH_ELIGIBLE_OPERATIONS).toContain('extraction_simple');
      expect(BATCH_ELIGIBLE_OPERATIONS).toContain('embedding');
      expect(BATCH_ELIGIBLE_OPERATIONS).toContain('batch_extraction');
    });
  });

  describe('Credit Constants', () => {
    it('should have free daily budget', () => {
      expect(FREE_DAILY_BUDGET).toBe(0.05);
    });

    it('should have reservation buffer', () => {
      expect(COST_RESERVATION_BUFFER).toBe(1.5);
    });

    it('should have reservation expiry', () => {
      expect(CREDIT_RESERVATION_EXPIRY_MINUTES).toBe(30);
    });
  });

  describe('Cache Constants', () => {
    it('should have cache TTL per prompt type', () => {
      expect(CACHE_TTL_MINUTES.classifier).toBe(60);
      expect(CACHE_TTL_MINUTES.extractor).toBe(5);
      expect(CACHE_TTL_MINUTES.responder).toBe(5);
    });

    it('should have minimum tokens for caching', () => {
      expect(CACHE_MIN_TOKENS).toBe(1024);
    });

    it('should have cache pricing multipliers', () => {
      expect(CACHE_PRICING_MULTIPLIERS.cache_write_5min).toBe(1.25);
      expect(CACHE_PRICING_MULTIPLIERS.cache_write_1hr).toBe(2.0);
      expect(CACHE_PRICING_MULTIPLIERS.cache_read).toBe(0.1);
    });
  });

  describe('Latency Targets', () => {
    it('should have latency targets for all operations', () => {
      expect(LATENCY_TARGETS_MS.classification).toBe(10);
      expect(LATENCY_TARGETS_MS.quick_response).toBe(500);
      expect(LATENCY_TARGETS_MS.standard_response).toBe(1000);
      expect(LATENCY_TARGETS_MS.deep_thinking).toBe(3000);
      expect(LATENCY_TARGETS_MS.graph_cot).toBe(5000);
      expect(LATENCY_TARGETS_MS.embedding).toBe(200);
      expect(LATENCY_TARGETS_MS.batch_extraction).toBe(86400000);
    });
  });

  describe('Health Check Constants', () => {
    it('should have health check interval', () => {
      expect(HEALTH_CHECK_INTERVAL_MS).toBe(30000);
    });

    it('should have health check timeout', () => {
      expect(HEALTH_CHECK_TIMEOUT_MS).toBe(5000);
    });

    it('should have failure threshold', () => {
      expect(HEALTH_CHECK_FAILURE_THRESHOLD).toBe(3);
    });
  });
});

// ============================================================
// CONFIGURATION OBJECTS TESTS
// ============================================================

describe('LLM Configuration Objects', () => {
  describe('MODEL_CONFIGS', () => {
    it('should have Claude Sonnet 4 config', () => {
      const config = MODEL_CONFIGS['claude-sonnet-4'];
      expect(config).toBeDefined();
      expect(config.provider).toBe('anthropic');
      expect(config.tier).toBe('balanced');
      expect(config.supports_cache).toBe(true);
      expect(config.pricing.input).toBe(3.0);
      expect(config.pricing.output).toBe(15.0);
    });

    it('should have GPT-4o config', () => {
      const config = MODEL_CONFIGS['gpt-4o'];
      expect(config).toBeDefined();
      expect(config.provider).toBe('openai');
      expect(config.tier).toBe('balanced');
      expect(config.supports_cache).toBe(false);
    });

    it('should have Gemini Flash config', () => {
      const config = MODEL_CONFIGS['gemini-2.0-flash'];
      expect(config).toBeDefined();
      expect(config.provider).toBe('google');
      expect(config.tier).toBe('cheapest');
    });

    it('should have embedding model config', () => {
      const config = MODEL_CONFIGS['text-embedding-3-small'];
      expect(config).toBeDefined();
      expect(config.provider).toBe('openai');
      expect(config.pricing.input).toBe(0.02);
    });
  });

  describe('PROVIDER_CONFIGS', () => {
    it('should have Anthropic provider config', () => {
      const config = PROVIDER_CONFIGS.anthropic;
      expect(config.name).toBe('Anthropic');
      expect(config.models).toContain('claude-sonnet-4');
      expect(config.rate_limits).toEqual({ rpm: 4000, tpm: 400000 });
    });

    it('should have OpenAI provider config', () => {
      const config = PROVIDER_CONFIGS.openai;
      expect(config.name).toBe('OpenAI');
      expect(config.models).toContain('gpt-4o');
    });

    it('should have Google provider config', () => {
      const config = PROVIDER_CONFIGS.google;
      expect(config.name).toBe('Google');
      expect(config.models).toContain('gemini-2.0-flash');
    });
  });

  describe('OPERATION_CONFIGS', () => {
    it('should have classification config with rules first', () => {
      const config = OPERATION_CONFIGS.classification;
      expect(config.rules_first).toBe(true);
      expect(config.tier).toBe('cheapest');
      expect(config.primary_model).toBe('rules');
    });

    it('should have quick response config', () => {
      const config = OPERATION_CONFIGS.quick_response;
      expect(config.tier).toBe('cheap');
      expect(config.primary_model).toBe('gpt-4o-mini');
      expect(config.latency_target_ms).toBe(500);
    });

    it('should have deep thinking config', () => {
      const config = OPERATION_CONFIGS.deep_thinking;
      expect(config.tier).toBe('premium');
      expect(config.primary_model).toBe('claude-sonnet-4');
    });

    it('should have cost estimates for all operations', () => {
      for (const op of OPERATION_TYPES) {
        const config = OPERATION_CONFIGS[op];
        expect(config.cost_estimate).toBeDefined();
        expect(config.cost_estimate.min).toBeLessThanOrEqual(config.cost_estimate.expected);
        expect(config.cost_estimate.expected).toBeLessThanOrEqual(config.cost_estimate.max);
      }
    });
  });

  describe('DEGRADATION_MODE_CONFIGS', () => {
    it('should have healthy mode config', () => {
      const config = DEGRADATION_MODE_CONFIGS.healthy;
      expect(config.classification).toBe('llm');
      expect(config.response).toBe('premium');
      expect(config.extraction).toBe('realtime');
      expect(config.user_message).toBeUndefined();
    });

    it('should have degraded mode config', () => {
      const config = DEGRADATION_MODE_CONFIGS.degraded;
      expect(config.classification).toBe('rules_only');
      expect(config.response).toBe('basic');
      expect(config.user_message).toBeDefined();
    });

    it('should have offline mode config', () => {
      const config = DEGRADATION_MODE_CONFIGS.offline;
      expect(config.classification).toBe('rules_only');
      expect(config.response).toBe('template');
      expect(config.extraction).toBe('queued');
    });
  });

  describe('PLAN_CONFIGS', () => {
    it('should have free plan config', () => {
      const config = PLAN_CONFIGS.free;
      expect(config.daily_cost_ceiling).toBe(0.05);
      expect(config.strict_enforcement).toBe(true);
    });

    it('should have credits plan config', () => {
      const config = PLAN_CONFIGS.credits;
      expect(config.daily_cost_ceiling).toBeUndefined();
      expect(config.strict_enforcement).toBe(false);
    });

    it('should have pro plan config', () => {
      const config = PLAN_CONFIGS.pro;
      expect(config.daily_cost_ceiling).toBeUndefined();
    });
  });

  describe('USAGE_TIER_THRESHOLDS', () => {
    it('should have thresholds in ascending order', () => {
      for (let i = 1; i < USAGE_TIER_THRESHOLDS.length; i++) {
        expect(USAGE_TIER_THRESHOLDS[i].threshold).toBeGreaterThan(
          USAGE_TIER_THRESHOLDS[i - 1].threshold
        );
      }
    });

    it('should start with premium at 0%', () => {
      expect(USAGE_TIER_THRESHOLDS[0]).toEqual({ threshold: 0.0, tier: 'premium' });
    });

    it('should downgrade to cheapest at 100%', () => {
      expect(USAGE_TIER_THRESHOLDS[USAGE_TIER_THRESHOLDS.length - 1]).toEqual({
        threshold: 1.0,
        tier: 'cheapest',
      });
    });
  });
});

// ============================================================
// PROVIDER CONFIG FUNCTIONS TESTS
// ============================================================

describe('Provider Config Functions', () => {
  describe('getModelConfig', () => {
    it('should return model config for valid model', () => {
      const config = getModelConfig('claude-sonnet-4');
      expect(config).toBeDefined();
      expect(config?.id).toBe('claude-sonnet-4');
    });

    it('should return undefined for invalid model', () => {
      const config = getModelConfig('invalid-model');
      expect(config).toBeUndefined();
    });
  });

  describe('getProviderConfig', () => {
    it('should return provider config', () => {
      const config = getProviderConfig('anthropic');
      expect(config).toBeDefined();
      expect(config.name).toBe('Anthropic');
    });
  });

  describe('getModelsForProvider', () => {
    it('should return models for Anthropic', () => {
      const models = getModelsForProvider('anthropic');
      expect(models).toContain('claude-sonnet-4');
      expect(models).toContain('claude-3-haiku');
    });

    it('should return models for OpenAI', () => {
      const models = getModelsForProvider('openai');
      expect(models).toContain('gpt-4o');
      expect(models).toContain('text-embedding-3-small');
    });
  });

  describe('getModelsForTier', () => {
    it('should return balanced tier models', () => {
      const models = getModelsForTier('balanced');
      expect(models.some((m) => m.id === 'claude-sonnet-4')).toBe(true);
      expect(models.some((m) => m.id === 'gpt-4o')).toBe(true);
    });

    it('should return cheap tier models', () => {
      const models = getModelsForTier('cheap');
      expect(models.some((m) => m.id === 'gpt-4o-mini')).toBe(true);
    });
  });

  describe('getProviderForModel', () => {
    it('should return provider for model', () => {
      expect(getProviderForModel('claude-sonnet-4')).toBe('anthropic');
      expect(getProviderForModel('gpt-4o')).toBe('openai');
      expect(getProviderForModel('gemini-2.0-flash')).toBe('google');
    });

    it('should return undefined for invalid model', () => {
      expect(getProviderForModel('invalid')).toBeUndefined();
    });
  });

  describe('calculateTokenCost', () => {
    it('should calculate cost for input/output tokens', () => {
      // Claude Sonnet 4: $3/1M input, $15/1M output
      const cost = calculateTokenCost('claude-sonnet-4', 1000, 500);
      // 1000 * 3 / 1M + 500 * 15 / 1M = 0.003 + 0.0075 = 0.0105
      expect(cost).toBeCloseTo(0.0105, 5);
    });

    it('should include cache costs when provided', () => {
      const cost = calculateTokenCost('claude-sonnet-4', 1000, 500, 2000, 0);
      // Base: 0.0105 + cache_read: 2000 * 0.30 / 1M = 0.0006
      expect(cost).toBeCloseTo(0.0111, 5);
    });

    it('should throw for invalid model', () => {
      expect(() => calculateTokenCost('invalid', 100, 100)).toThrow('Unknown model');
    });
  });

  describe('supportsCaching', () => {
    it('should return true for Claude models', () => {
      expect(supportsCaching('claude-sonnet-4')).toBe(true);
      expect(supportsCaching('claude-3-haiku')).toBe(true);
    });

    it('should return false for GPT models', () => {
      expect(supportsCaching('gpt-4o')).toBe(false);
    });
  });

  describe('supportsBatch', () => {
    it('should return true for models with batch support', () => {
      expect(supportsBatch('claude-sonnet-4')).toBe(true);
      expect(supportsBatch('gpt-4o')).toBe(true);
    });

    it('should return false for Gemini models', () => {
      expect(supportsBatch('gemini-2.0-flash')).toBe(false);
    });
  });
});

// ============================================================
// OPERATION ROUTING FUNCTIONS TESTS
// ============================================================

describe('Operation Routing Functions', () => {
  describe('getOperationConfig', () => {
    it('should return config for all operation types', () => {
      for (const op of OPERATION_TYPES) {
        const config = getOperationConfig(op);
        expect(config).toBeDefined();
        expect(config.type).toBe(op);
      }
    });
  });

  describe('estimateOperationCost', () => {
    it('should return cost range for request', () => {
      const request = {
        operation: 'standard_response' as const,
        input: 'test input',
        user_id: 'user123',
        urgency: 'normal' as const,
      };
      const estimate = estimateOperationCost(request);
      expect(estimate.min).toBe(0.01);
      expect(estimate.max).toBe(0.02);
    });
  });

  describe('shouldUseBatch', () => {
    it('should return true for background batch operations', () => {
      expect(shouldUseBatch('batch_extraction', 'background')).toBe(true);
      expect(shouldUseBatch('embedding', 'background')).toBe(true);
    });

    it('should return false for realtime requests', () => {
      expect(shouldUseBatch('batch_extraction', 'realtime')).toBe(false);
    });

    it('should return false for non-batch operations', () => {
      expect(shouldUseBatch('quick_response', 'background')).toBe(false);
    });
  });

  describe('getLatencyTarget', () => {
    it('should return latency target for operation', () => {
      expect(getLatencyTarget('classification')).toBe(10);
      expect(getLatencyTarget('quick_response')).toBe(500);
      expect(getLatencyTarget('deep_thinking')).toBe(3000);
    });
  });

  describe('routeRequest', () => {
    it('should route to rules for classification', () => {
      const request = {
        operation: 'classification' as const,
        input: 'test',
        user_id: 'user123',
        urgency: 'normal' as const,
      };
      const decision = routeRequest(request, ['anthropic', 'openai', 'google']);
      expect(decision.model).toBe('rules');
      expect(decision.use_rules_first).toBe(true);
    });

    it('should route to primary model when available', () => {
      const request = {
        operation: 'standard_response' as const,
        input: 'test',
        user_id: 'user123',
        urgency: 'normal' as const,
      };
      const decision = routeRequest(request, ['anthropic', 'openai', 'google']);
      expect(decision.model).toBe('claude-sonnet-4');
      expect(decision.provider).toBe('anthropic');
      expect(decision.reason).toBe('primary');
    });

    it('should fallback when primary not available', () => {
      const request = {
        operation: 'standard_response' as const,
        input: 'test',
        user_id: 'user123',
        urgency: 'normal' as const,
      };
      const decision = routeRequest(request, ['openai', 'google']);
      expect(decision.model).toBe('gpt-4o');
      expect(decision.provider).toBe('openai');
      expect(decision.reason).toBe('fallback');
    });
  });

  describe('getModelForOperation', () => {
    it('should return rules for classification', () => {
      expect(getModelForOperation('classification', ['anthropic'])).toBe('rules');
    });

    it('should return primary model when available', () => {
      expect(getModelForOperation('quick_response', ['openai', 'anthropic'])).toBe('gpt-4o-mini');
    });

    it('should return fallback when primary not available', () => {
      expect(getModelForOperation('quick_response', ['anthropic', 'google'])).toBe('claude-3-haiku');
    });
  });
});

// ============================================================
// CREDIT FLOW FUNCTIONS TESTS
// ============================================================

describe('Credit Flow Functions', () => {
  describe('getReservationBuffer', () => {
    it('should return reservation buffer', () => {
      expect(getReservationBuffer()).toBe(1.5);
    });
  });

  describe('getReservationExpiryMinutes', () => {
    it('should return expiry minutes', () => {
      expect(getReservationExpiryMinutes()).toBe(30);
    });
  });

  describe('calculateActualCost', () => {
    it('should calculate cost from token usage', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
      };
      const cost = calculateActualCost(usage, 'claude-sonnet-4');
      expect(cost).toBeCloseTo(0.0105, 5);
    });
  });

  describe('Stub functions', () => {
    it('checkCredits should throw not implemented', async () => {
      await expect(checkCredits('user123', 0.05)).rejects.toThrow(
        'checkCredits requires credit service implementation'
      );
    });

    it('reserveCredits should throw not implemented', async () => {
      await expect(reserveCredits('user123', 0.05, 'quick_response')).rejects.toThrow(
        'reserveCredits requires credit service implementation'
      );
    });

    it('finalizeCredits should throw not implemented', async () => {
      await expect(finalizeCredits('res123', 0.03, 'claude-sonnet-4')).rejects.toThrow(
        'finalizeCredits requires credit service implementation'
      );
    });

    it('refundCredits should throw not implemented', async () => {
      await expect(refundCredits('res123')).rejects.toThrow(
        'refundCredits requires credit service implementation'
      );
    });

    it('getCreditBalance should throw not implemented', async () => {
      await expect(getCreditBalance('user123')).rejects.toThrow(
        'getCreditBalance requires credit service implementation'
      );
    });
  });
});

// ============================================================
// PROMPT CACHE FUNCTIONS TESTS
// ============================================================

describe('Prompt Cache Functions', () => {
  describe('getCacheConfig', () => {
    it('should return cache config for prompt type', () => {
      const config = getCacheConfig('classifier');
      expect(config.ttl_minutes).toBe(60);
      expect(config.tokens).toBe(1500);
    });
  });

  describe('modelSupportsCaching', () => {
    it('should return true for Claude models', () => {
      expect(modelSupportsCaching('claude-sonnet-4')).toBe(true);
    });

    it('should return false for non-Claude models', () => {
      expect(modelSupportsCaching('gpt-4o')).toBe(false);
    });
  });

  describe('calculateBreakEvenCalls', () => {
    it('should return 2 calls for break even', () => {
      expect(calculateBreakEvenCalls(1000, 'claude-sonnet-4')).toBe(2);
    });
  });

  describe('estimateCacheSavings', () => {
    it('should estimate savings for Claude model', () => {
      const savings = estimateCacheSavings(10, 'classifier', 'claude-sonnet-4');
      expect(savings.without_cache).toBeGreaterThan(0);
      expect(savings.with_cache).toBeLessThan(savings.without_cache);
      expect(savings.savings_percent).toBeGreaterThan(0);
    });

    it('should return zero savings for non-cacheable model', () => {
      const savings = estimateCacheSavings(10, 'classifier', 'gpt-4o');
      expect(savings.without_cache).toBe(0);
      expect(savings.savings_percent).toBe(0);
    });
  });

  describe('Stub functions', () => {
    it('checkCacheHit should throw not implemented', async () => {
      await expect(checkCacheHit('classifier', 'hash123')).rejects.toThrow(
        'checkCacheHit requires cache service implementation'
      );
    });

    it('warmCache should throw not implemented', async () => {
      await expect(warmCache('classifier')).rejects.toThrow(
        'warmCache requires cache service implementation'
      );
    });

    it('invalidateCache should throw not implemented', async () => {
      await expect(invalidateCache('cache123')).rejects.toThrow(
        'invalidateCache requires cache service implementation'
      );
    });

    it('getCacheStats should throw not implemented', async () => {
      await expect(getCacheStats()).rejects.toThrow(
        'getCacheStats requires cache service implementation'
      );
    });
  });
});

// ============================================================
// EMBEDDING SERVICE FUNCTIONS TESTS
// ============================================================

describe('Embedding Service Functions', () => {
  describe('getEmbeddingConfig', () => {
    it('should return default embedding config', () => {
      const config = getEmbeddingConfig();
      expect(config.model).toBe('text-embedding-3-small');
      expect(config.dimensions).toBe(1536);
      expect(config.pricing.realtime).toBe(0.02);
      expect(config.pricing.batch).toBe(0.01);
    });
  });

  describe('calculateEmbeddingCost', () => {
    it('should calculate realtime cost', () => {
      const cost = calculateEmbeddingCost(1000000, 'realtime');
      expect(cost).toBeCloseTo(0.02, 5);
    });

    it('should calculate batch cost (50% off)', () => {
      const cost = calculateEmbeddingCost(1000000, 'batch');
      expect(cost).toBeCloseTo(0.01, 5);
    });
  });

  describe('getBatchDiscountPercent', () => {
    it('should return 50%', () => {
      expect(getBatchDiscountPercent()).toBe(50);
    });
  });

  describe('getBatchDeadlineHours', () => {
    it('should return 24 hours', () => {
      expect(getBatchDeadlineHours()).toBe(24);
    });
  });

  describe('shouldUseBatchEmbedding', () => {
    it('should return false for user initiated', () => {
      expect(shouldUseBatchEmbedding(100, true, false)).toBe(false);
    });

    it('should return false for urgent', () => {
      expect(shouldUseBatchEmbedding(100, false, true)).toBe(false);
    });

    it('should return true for large non-urgent batch', () => {
      expect(shouldUseBatchEmbedding(100, false, false)).toBe(true);
    });

    it('should return false for small batch', () => {
      expect(shouldUseBatchEmbedding(5, false, false)).toBe(false);
    });
  });

  describe('Stub functions', () => {
    it('embedQuery should throw not implemented', async () => {
      await expect(embedQuery('test', 'user123')).rejects.toThrow(
        'embedQuery requires embedding service implementation'
      );
    });

    it('embedTexts should throw not implemented', async () => {
      await expect(embedTexts(['test1', 'test2'], 'user123')).rejects.toThrow(
        'embedTexts requires embedding service implementation'
      );
    });

    it('embedBatch should throw not implemented', async () => {
      await expect(embedBatch(['test1', 'test2'], 'user123')).rejects.toThrow(
        'embedBatch requires embedding service implementation'
      );
    });

    it('getBatchStatus should throw not implemented', async () => {
      await expect(getBatchStatus('job123')).rejects.toThrow(
        'getBatchStatus requires embedding service implementation'
      );
    });

    it('getBatchResults should throw not implemented', async () => {
      await expect(getBatchResults('job123')).rejects.toThrow(
        'getBatchResults requires embedding service implementation'
      );
    });

    it('cancelBatchJob should throw not implemented', async () => {
      await expect(cancelBatchJob('job123')).rejects.toThrow(
        'cancelBatchJob requires embedding service implementation'
      );
    });
  });
});

// ============================================================
// RATE LIMIT FUNCTIONS TESTS
// ============================================================

describe('Rate Limit Functions', () => {
  describe('getRateLimitConfig', () => {
    it('should return rate limit config', () => {
      const config = getRateLimitConfig();
      expect(config.warning_threshold).toBe(0.8);
      expect(config.health_check_interval_ms).toBe(30000);
    });
  });

  describe('getProviderRateLimits', () => {
    it('should return rate limits for provider', () => {
      expect(getProviderRateLimits('anthropic')).toEqual({ rpm: 4000, tpm: 400000 });
      expect(getProviderRateLimits('openai')).toEqual({ rpm: 10000, tpm: 2000000 });
    });
  });

  describe('Stub functions', () => {
    it('getRateLimitState should throw not implemented', () => {
      expect(() => getRateLimitState('anthropic')).toThrow(
        'getRateLimitState requires rate limit tracking implementation'
      );
    });

    it('isProviderAvailable should throw not implemented', () => {
      expect(() => isProviderAvailable('anthropic')).toThrow(
        'isProviderAvailable requires rate limit tracking implementation'
      );
    });

    it('isApproachingRateLimit should throw not implemented', () => {
      expect(() => isApproachingRateLimit('anthropic')).toThrow(
        'isApproachingRateLimit requires rate limit tracking implementation'
      );
    });

    it('selectProvider should throw not implemented', async () => {
      await expect(selectProvider('quick_response', ['anthropic'], 'normal')).rejects.toThrow(
        'selectProvider requires rate limit tracking implementation'
      );
    });

    it('trackRequest should throw not implemented', () => {
      expect(() => trackRequest('anthropic', 1000)).toThrow(
        'trackRequest requires rate limit tracking implementation'
      );
    });

    it('checkProviderHealth should throw not implemented', async () => {
      await expect(checkProviderHealth('anthropic')).rejects.toThrow(
        'checkProviderHealth requires health monitoring implementation'
      );
    });

    it('getHealthyProviderCount should throw not implemented', () => {
      expect(() => getHealthyProviderCount()).toThrow(
        'getHealthyProviderCount requires health monitoring implementation'
      );
    });

    it('getAllProviderHealth should throw not implemented', () => {
      expect(() => getAllProviderHealth()).toThrow(
        'getAllProviderHealth requires health monitoring implementation'
      );
    });

    it('resetRateLimitCounters should throw not implemented', () => {
      expect(() => resetRateLimitCounters()).toThrow(
        'resetRateLimitCounters requires rate limit tracking implementation'
      );
    });

    it('calculateUsagePercent should throw not implemented', () => {
      expect(() => calculateUsagePercent('anthropic')).toThrow(
        'calculateUsagePercent requires rate limit tracking implementation'
      );
    });
  });
});

// ============================================================
// DEGRADATION FUNCTIONS TESTS
// ============================================================

describe('Degradation Functions', () => {
  beforeEach(() => {
    setDegradationLevel('healthy', 'reset for test');
  });

  describe('getCurrentDegradationLevel', () => {
    it('should return current level', () => {
      expect(getCurrentDegradationLevel()).toBe('healthy');
    });
  });

  describe('setDegradationLevel', () => {
    it('should set degradation level', () => {
      setDegradationLevel('degraded', 'test');
      expect(getCurrentDegradationLevel()).toBe('degraded');
    });
  });

  describe('getDegradationModeConfig', () => {
    it('should return config for current level', () => {
      const config = getDegradationModeConfig();
      expect(config.level).toBe('healthy');
    });
  });

  describe('getUserMessage', () => {
    it('should return undefined for healthy', () => {
      expect(getUserMessage()).toBeUndefined();
    });

    it('should return message for degraded', () => {
      setDegradationLevel('degraded', 'test');
      expect(getUserMessage()).toBeDefined();
    });
  });

  describe('calculateDegradationLevel', () => {
    it('should return healthy when most providers healthy', () => {
      expect(calculateDegradationLevel(3, 3)).toBe('healthy');
      expect(calculateDegradationLevel(2, 3)).toBe('healthy');
    });

    it('should return degraded when few providers healthy', () => {
      expect(calculateDegradationLevel(1, 3)).toBe('degraded');
    });

    it('should return offline when no providers healthy', () => {
      expect(calculateDegradationLevel(0, 3)).toBe('offline');
    });
  });

  describe('isOperationAvailable', () => {
    it('should return true for all operations when healthy', () => {
      for (const op of OPERATION_TYPES) {
        expect(isOperationAvailable(op)).toBe(true);
      }
    });

    it('should return false for some operations when offline', () => {
      setDegradationLevel('offline', 'test');
      expect(isOperationAvailable('deep_thinking')).toBe(false);
      expect(isOperationAvailable('standard_response')).toBe(false);
    });
  });

  describe('getOperationAvailability', () => {
    it('should return availability details', () => {
      const avail = getOperationAvailability('quick_response');
      expect(avail.operation).toBe('quick_response');
      expect(avail.available).toBe(true);
    });
  });

  describe('Stub functions', () => {
    it('handleProviderFailure should throw not implemented', () => {
      expect(() => handleProviderFailure('anthropic')).toThrow(
        'handleProviderFailure requires health monitoring implementation'
      );
    });

    it('handleProviderRecovery should throw not implemented', () => {
      expect(() => handleProviderRecovery('anthropic')).toThrow(
        'handleProviderRecovery requires health monitoring implementation'
      );
    });

    it('getSystemHealthStatus should throw not implemented', () => {
      expect(() => getSystemHealthStatus()).toThrow(
        'getSystemHealthStatus requires health monitoring implementation'
      );
    });
  });
});

// ============================================================
// USAGE LIMIT FUNCTIONS TESTS
// ============================================================

describe('Usage Limit Functions', () => {
  describe('getPlanConfig', () => {
    it('should return plan config', () => {
      expect(getPlanConfig('free').daily_cost_ceiling).toBe(0.05);
      expect(getPlanConfig('pro').daily_cost_ceiling).toBeUndefined();
    });
  });

  describe('calculateTierForUsage', () => {
    it('should return premium for low usage', () => {
      expect(calculateTierForUsage(0)).toBe('premium');
      expect(calculateTierForUsage(0.5)).toBe('premium');
    });

    it('should return balanced at 80%', () => {
      expect(calculateTierForUsage(0.8)).toBe('balanced');
    });

    it('should return cheap at 90%', () => {
      expect(calculateTierForUsage(0.9)).toBe('cheap');
    });

    it('should return cheapest at 100%', () => {
      expect(calculateTierForUsage(1.0)).toBe('cheapest');
    });
  });

  describe('getFreeTierCapacity', () => {
    it('should return free tier capacity', () => {
      const capacity = getFreeTierCapacity();
      expect(capacity.quick_thoughts).toBe(5);
      expect(capacity.standard_thoughts).toBe(1);
    });
  });

  describe('getDowngradeMessage', () => {
    it('should return messages for all types', () => {
      expect(getDowngradeMessage('approaching')).toBeDefined();
      expect(getDowngradeMessage('downgraded')).toBeDefined();
      expect(getDowngradeMessage('limit_reached')).toBeDefined();
      expect(getDowngradeMessage('reset')).toBeDefined();
    });
  });

  describe('Stub functions', () => {
    it('checkUserBudget should throw not implemented', () => {
      expect(() => checkUserBudget('user123', 0.05)).toThrow(
        'checkUserBudget requires usage tracking implementation'
      );
    });

    it('getUserUsageState should throw not implemented', async () => {
      await expect(getUserUsageState('user123')).rejects.toThrow(
        'getUserUsageState requires usage tracking implementation'
      );
    });

    it('getAvailableModelTier should throw not implemented', async () => {
      await expect(getAvailableModelTier('user123')).rejects.toThrow(
        'getAvailableModelTier requires usage tracking implementation'
      );
    });

    it('handleApproachingLimit should throw not implemented', () => {
      expect(() => handleApproachingLimit('user123', 0.8)).toThrow(
        'handleApproachingLimit requires usage tracking implementation'
      );
    });

    it('trackUsage should throw not implemented', async () => {
      await expect(trackUsage('user123', 0.01)).rejects.toThrow(
        'trackUsage requires usage tracking implementation'
      );
    });

    it('resetDailyUsage should throw not implemented', async () => {
      await expect(resetDailyUsage('user123')).rejects.toThrow(
        'resetDailyUsage requires usage tracking implementation'
      );
    });

    it('isOperationAllowedForTier should throw not implemented', async () => {
      await expect(isOperationAllowedForTier('user123', 'premium')).rejects.toThrow(
        'isOperationAllowedForTier requires usage tracking implementation'
      );
    });
  });
});

// ============================================================
// ZOD SCHEMA VALIDATION TESTS
// ============================================================

describe('Zod Schema Validation', () => {
  describe('Provider Schemas', () => {
    it('ProviderSchema should validate valid providers', () => {
      expect(ProviderSchema.parse('anthropic')).toBe('anthropic');
      expect(ProviderSchema.parse('openai')).toBe('openai');
      expect(() => ProviderSchema.parse('invalid')).toThrow();
    });
  });

  describe('Model Schemas', () => {
    it('AnthropicModelSchema should validate', () => {
      expect(AnthropicModelSchema.parse('claude-sonnet-4')).toBe('claude-sonnet-4');
    });

    it('OpenAIModelSchema should validate', () => {
      expect(OpenAIModelSchema.parse('gpt-4o')).toBe('gpt-4o');
    });

    it('GoogleModelSchema should validate', () => {
      expect(GoogleModelSchema.parse('gemini-2.0-flash')).toBe('gemini-2.0-flash');
    });
  });

  describe('Configuration Schemas', () => {
    it('ModelPricingSchema should validate', () => {
      const pricing = { input: 3.0, output: 15.0 };
      expect(ModelPricingSchema.parse(pricing)).toEqual(pricing);
    });

    it('CostRangeSchema should validate', () => {
      const range = { min: 0.01, expected: 0.015, max: 0.02 };
      expect(CostRangeSchema.parse(range)).toEqual(range);
    });

    it('TokenUsageSchema should validate', () => {
      const usage = { input_tokens: 1000, output_tokens: 500 };
      expect(TokenUsageSchema.parse(usage)).toEqual(usage);
    });
  });

  describe('Request/Response Schemas', () => {
    it('LLMRequestSchema should validate', () => {
      const request = {
        operation: 'quick_response',
        input: 'test',
        user_id: 'user123',
        urgency: 'normal',
      };
      expect(LLMRequestSchema.parse(request)).toEqual(request);
    });

    it('RoutingDecisionSchema should validate', () => {
      const decision = {
        model: 'gpt-4o-mini',
        provider: 'openai',
        reason: 'primary',
        cost_estimate: { min: 0.0002, expected: 0.0003, max: 0.0005 },
        use_rules_first: false,
        use_batch: false,
      };
      expect(RoutingDecisionSchema.parse(decision)).toEqual(decision);
    });
  });

  describe('Event Schemas', () => {
    it('CostEstimateEventSchema should validate', () => {
      const event = {
        type: 'cost:estimate',
        min: 0.01,
        max: 0.02,
        operation: 'standard_response',
      };
      expect(CostEstimateEventSchema.parse(event)).toEqual(event);
    });

    it('CostFinalEventSchema should validate', () => {
      const event = { type: 'cost:final', cost: 0.015 };
      expect(CostFinalEventSchema.parse(event)).toEqual(event);
    });
  });
});
