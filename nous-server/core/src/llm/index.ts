/**
 * @module @nous/core/llm
 * @description LLM Integration Layer (NLIL) - Main exports and functions
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-015
 * @storm Brainstorms/Infrastructure/storm-015-llm-integration
 *
 * Unified abstraction that routes all LLM operations through an intelligent
 * gateway with multi-provider support, intelligent routing, and cost optimization.
 */

// ============================================================
// RE-EXPORTS
// ============================================================

// Constants (enums, type guards, numeric thresholds)
export * from './constants';

// Types (interfaces, Zod schemas)
export * from './types';

// ============================================================
// IMPORTS FOR CONFIGURATION OBJECTS
// ============================================================

import {
  type Provider,
  type OperationType,
  type ModelTier,
  type CacheablePromptType,
  type DegradationLevel,
  type UrgencyLevel,
  type UserPlan,
  type EmbeddingMode,
  LATENCY_TARGETS_MS,
  CACHE_TTL_MINUTES,
  CACHE_MIN_TOKENS,
  CACHE_PRICING_MULTIPLIERS,
  DEFAULT_EMBEDDING_MODEL,
  LLM_EMBEDDING_DIMENSIONS,
  EMBEDDING_CACHE_TTL_DAYS,
  EMBEDDING_CACHE_MAX_SIZE,
  RATE_LIMIT_WARNING_THRESHOLD,
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_CHECK_FAILURE_THRESHOLD,
  FREE_DAILY_BUDGET,
  MODEL_DOWNGRADE_THRESHOLD,
  FREE_TIER_CAPACITY,
  COST_RESERVATION_BUFFER,
  CREDIT_RESERVATION_EXPIRY_MINUTES,
  BATCH_DISCOUNT_PERCENT,
  BATCH_DEADLINE_HOURS,
  PROVIDER_RATE_LIMITS,
} from './constants';

import {
  type ModelConfig,
  type ProviderConfig,
  type OperationConfig,
  type CostRange,
  type PromptCacheConfig,
  type EmbeddingServiceConfig,
  type RateLimitConfig,
  type DegradationModeConfig,
  type OperationAvailability,
  type PlanUsageLimits,
  type CreditFlowConfig,
  type LLMRequest,
  type RoutingDecision,
  type TokenUsage,
  type CreditReservation,
  type CreditTransaction,
  type CreditCheckResult,
  type CacheHitResult,
  type CacheSavingsEstimate,
  type CacheEntry,
  type EmbeddingResult,
  type EmbeddingBatchJob,
  type RateLimitState,
  type ProviderSelection,
  type ProviderHealthCheck,
  type SystemHealthStatus,
  type UserUsageState,
} from './types';

// ============================================================
// MODEL CONFIGURATIONS (January 2026 Pricing)
// ============================================================

/**
 * Complete model configurations.
 * Pricing should be externalized and updated via admin dashboard.
 *
 * @see revision.md lines 84-123 for pricing reference
 */
export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // Anthropic Models
  'claude-sonnet-4': {
    id: 'claude-sonnet-4',
    provider: 'anthropic',
    tier: 'balanced',
    pricing: {
      input: 3.0,
      output: 15.0,
      cache_read: 0.3,
      cache_write: 3.75,
    },
    context_window: 200000,
    supports_cache: true,
    supports_batch: true,
    display_name: 'Claude Sonnet 4',
  },
  'claude-3-haiku': {
    id: 'claude-3-haiku',
    provider: 'anthropic',
    tier: 'cheap',
    pricing: {
      input: 0.25,
      output: 1.25,
    },
    context_window: 200000,
    supports_cache: true,
    supports_batch: true,
    display_name: 'Claude 3 Haiku',
  },

  // OpenAI Models
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    tier: 'balanced',
    pricing: {
      input: 2.5,
      output: 10.0,
    },
    context_window: 128000,
    supports_cache: false,
    supports_batch: true,
    display_name: 'GPT-4o',
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'openai',
    tier: 'cheap',
    pricing: {
      input: 0.15,
      output: 0.6,
    },
    context_window: 128000,
    supports_cache: false,
    supports_batch: true,
    display_name: 'GPT-4o Mini',
  },

  // Google Models
  'gemini-2.0-flash': {
    id: 'gemini-2.0-flash',
    provider: 'google',
    tier: 'cheapest',
    pricing: {
      input: 0.1,
      output: 0.4,
    },
    context_window: 1000000,
    supports_cache: false,
    supports_batch: false,
    display_name: 'Gemini 2.0 Flash',
  },
  'gemini-2.0-flash-lite': {
    id: 'gemini-2.0-flash-lite',
    provider: 'google',
    tier: 'cheapest',
    pricing: {
      input: 0.075,
      output: 0.3,
    },
    context_window: 1000000,
    supports_cache: false,
    supports_batch: false,
    display_name: 'Gemini 2.0 Flash Lite',
  },

  // Embedding Models
  'text-embedding-3-small': {
    id: 'text-embedding-3-small',
    provider: 'openai',
    tier: 'cheap',
    pricing: {
      input: 0.02,
      output: 0,
    },
    context_window: 8191,
    supports_cache: false,
    supports_batch: true,
    display_name: 'text-embedding-3-small',
  },
  'text-embedding-3-large': {
    id: 'text-embedding-3-large',
    provider: 'openai',
    tier: 'balanced',
    pricing: {
      input: 0.13,
      output: 0,
    },
    context_window: 8191,
    supports_cache: false,
    supports_batch: true,
    display_name: 'text-embedding-3-large',
  },
} as const;

// ============================================================
// PROVIDER CONFIGURATIONS
// ============================================================

/**
 * Provider configurations.
 */
export const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    models: ['claude-sonnet-4', 'claude-3-haiku'],
    rate_limits: { rpm: 4000, tpm: 400000 },
    api_base_url: 'https://api.anthropic.com',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'text-embedding-3-small', 'text-embedding-3-large'],
    rate_limits: { rpm: 10000, tpm: 2000000 },
    api_base_url: 'https://api.openai.com',
  },
  google: {
    id: 'google',
    name: 'Google',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    rate_limits: { rpm: 60000, tpm: 4000000 },
    api_base_url: 'https://generativelanguage.googleapis.com',
  },
} as const;

// ============================================================
// OPERATION CONFIGURATIONS
// ============================================================

/**
 * Operation routing configurations.
 * Defines model selection and cost estimates per operation type.
 *
 * @see revision.md lines 127-140 for routing table
 */
export const OPERATION_CONFIGS: Record<OperationType, OperationConfig> = {
  classification: {
    type: 'classification',
    tier: 'cheapest',
    primary_model: 'rules',
    fallback_models: ['gemini-2.0-flash'],
    cost_estimate: { min: 0, expected: 0, max: 0.0001 },
    latency_target_ms: LATENCY_TARGETS_MS.classification,
    rules_first: true,
    description: 'Query classification with rules-first approach',
  },

  quick_response: {
    type: 'quick_response',
    tier: 'cheap',
    primary_model: 'gpt-4o-mini',
    fallback_models: ['claude-3-haiku', 'gemini-2.0-flash'],
    cost_estimate: { min: 0.0002, expected: 0.0003, max: 0.0005 },
    latency_target_ms: LATENCY_TARGETS_MS.quick_response,
    rules_first: false,
    description: 'Fast, simple responses',
  },

  standard_response: {
    type: 'standard_response',
    tier: 'balanced',
    primary_model: 'claude-sonnet-4',
    fallback_models: ['gpt-4o'],
    cost_estimate: { min: 0.01, expected: 0.015, max: 0.02 },
    latency_target_ms: LATENCY_TARGETS_MS.standard_response,
    rules_first: false,
    description: 'Standard quality responses',
  },

  deep_thinking: {
    type: 'deep_thinking',
    tier: 'premium',
    primary_model: 'claude-sonnet-4',
    fallback_models: ['gpt-4o'],
    cost_estimate: { min: 0.03, expected: 0.045, max: 0.06 },
    latency_target_ms: LATENCY_TARGETS_MS.deep_thinking,
    rules_first: false,
    description: 'Complex reasoning and analysis',
  },

  graph_cot: {
    type: 'graph_cot',
    tier: 'balanced',
    primary_model: 'claude-sonnet-4',
    fallback_models: ['gpt-4o'],
    cost_estimate: { min: 0.02, expected: 0.03, max: 0.04 },
    latency_target_ms: LATENCY_TARGETS_MS.graph_cot,
    rules_first: false,
    description: 'Phase 2 Graph-CoT traversal',
  },

  extraction_simple: {
    type: 'extraction_simple',
    tier: 'cheap',
    primary_model: 'gpt-4o-mini',
    fallback_models: ['gemini-2.0-flash', 'claude-3-haiku'],
    cost_estimate: { min: 0.0005, expected: 0.0007, max: 0.001 },
    latency_target_ms: LATENCY_TARGETS_MS.extraction_simple,
    rules_first: false,
    description: 'Simple node extraction',
  },

  extraction_complex: {
    type: 'extraction_complex',
    tier: 'balanced',
    primary_model: 'claude-sonnet-4',
    fallback_models: ['gpt-4o'],
    cost_estimate: { min: 0.01, expected: 0.02, max: 0.03 },
    latency_target_ms: LATENCY_TARGETS_MS.extraction_complex,
    rules_first: false,
    description: 'Complex document extraction',
  },

  embedding: {
    type: 'embedding',
    tier: 'cheap',
    primary_model: 'text-embedding-3-small',
    fallback_models: [],
    cost_estimate: { min: 0.00001, expected: 0.00002, max: 0.00005 },
    latency_target_ms: LATENCY_TARGETS_MS.embedding,
    rules_first: false,
    description: 'Generate embeddings',
  },

  batch_extraction: {
    type: 'batch_extraction',
    tier: 'cheap',
    primary_model: 'gpt-4o-mini',
    fallback_models: ['claude-3-haiku'],
    cost_estimate: { min: 0.005, expected: 0.01, max: 0.02 },
    latency_target_ms: LATENCY_TARGETS_MS.batch_extraction,
    rules_first: false,
    description: 'Batch extraction (50% off via Batch API)',
  },
} as const;

// ============================================================
// PROMPT CACHE CONFIGURATIONS
// ============================================================

/**
 * Default cache configurations per prompt type.
 * Content is empty - will be set by storm-027 prompt templates.
 *
 * @see revision.md lines 333-366 for cache strategy
 */
export const PROMPT_CACHE_CONFIGS: Record<CacheablePromptType, PromptCacheConfig> = {
  classifier: {
    prompt_type: 'classifier',
    content: '', // Set by storm-027
    tokens: 1500,
    ttl_minutes: CACHE_TTL_MINUTES.classifier,
    min_tokens: CACHE_MIN_TOKENS,
  },
  extractor: {
    prompt_type: 'extractor',
    content: '', // Set by storm-027
    tokens: 2000,
    ttl_minutes: CACHE_TTL_MINUTES.extractor,
    min_tokens: CACHE_MIN_TOKENS,
  },
  responder: {
    prompt_type: 'responder',
    content: '', // Set by storm-027
    tokens: 2500,
    ttl_minutes: CACHE_TTL_MINUTES.responder,
    min_tokens: CACHE_MIN_TOKENS,
  },
} as const;

/**
 * Cache pricing multipliers (Anthropic).
 */
export const CACHE_MULTIPLIERS = CACHE_PRICING_MULTIPLIERS;

// ============================================================
// EMBEDDING SERVICE CONFIGURATION
// ============================================================

/**
 * Default embedding service configuration.
 *
 * @see revision.md lines 298-330 for embedding service
 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingServiceConfig = {
  model: DEFAULT_EMBEDDING_MODEL,
  dimensions: LLM_EMBEDDING_DIMENSIONS[DEFAULT_EMBEDDING_MODEL],
  pricing: {
    realtime: 0.02, // $0.02 per 1M tokens
    batch: 0.01, // 50% off
  },
  cache: {
    enabled: true,
    ttl_days: EMBEDDING_CACHE_TTL_DAYS,
    max_size: EMBEDDING_CACHE_MAX_SIZE,
  },
} as const;

// ============================================================
// RATE LIMIT CONFIGURATION
// ============================================================

/**
 * Default rate limit configuration.
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  warning_threshold: RATE_LIMIT_WARNING_THRESHOLD,
  health_check_interval_ms: HEALTH_CHECK_INTERVAL_MS,
  health_check_timeout_ms: HEALTH_CHECK_TIMEOUT_MS,
  failure_threshold: HEALTH_CHECK_FAILURE_THRESHOLD,
} as const;

// ============================================================
// DEGRADATION MODE CONFIGURATIONS
// ============================================================

/**
 * Degradation mode configurations.
 *
 * - Healthy: Full functionality
 * - Degraded: Rules classification, simpler models, batch extraction
 * - Offline: Rules only, pre-computed templates, queue for later
 *
 * @see revision.md lines 434-466
 */
export const DEGRADATION_MODE_CONFIGS: Record<DegradationLevel, DegradationModeConfig> = {
  healthy: {
    level: 'healthy',
    classification: 'llm',
    response: 'premium',
    extraction: 'realtime',
    user_message: undefined,
  },
  degraded: {
    level: 'degraded',
    classification: 'rules_only',
    response: 'basic',
    extraction: 'batch',
    user_message: 'Some AI features may be slower than usual.',
  },
  offline: {
    level: 'offline',
    classification: 'rules_only',
    response: 'template',
    extraction: 'queued',
    user_message: 'AI services temporarily limited. Basic features available.',
  },
} as const;

/**
 * Operation availability per degradation level.
 */
export const OPERATION_AVAILABILITY: Record<
  DegradationLevel,
  Record<OperationType, OperationAvailability>
> = {
  healthy: {
    classification: {
      operation: 'classification',
      available: true,
      mode: 'full',
      description: 'LLM-assisted classification',
    },
    quick_response: {
      operation: 'quick_response',
      available: true,
      mode: 'full',
      description: 'Fast model responses',
    },
    standard_response: {
      operation: 'standard_response',
      available: true,
      mode: 'full',
      description: 'Premium model responses',
    },
    deep_thinking: {
      operation: 'deep_thinking',
      available: true,
      mode: 'full',
      description: 'Complex reasoning',
    },
    graph_cot: {
      operation: 'graph_cot',
      available: true,
      mode: 'full',
      description: 'Graph-CoT traversal',
    },
    extraction_simple: {
      operation: 'extraction_simple',
      available: true,
      mode: 'full',
      description: 'Real-time extraction',
    },
    extraction_complex: {
      operation: 'extraction_complex',
      available: true,
      mode: 'full',
      description: 'Real-time extraction',
    },
    embedding: {
      operation: 'embedding',
      available: true,
      mode: 'full',
      description: 'Real-time embeddings',
    },
    batch_extraction: {
      operation: 'batch_extraction',
      available: true,
      mode: 'full',
      description: 'Batch processing',
    },
  },
  degraded: {
    classification: {
      operation: 'classification',
      available: true,
      mode: 'reduced',
      description: 'Rules-only classification',
    },
    quick_response: {
      operation: 'quick_response',
      available: true,
      mode: 'reduced',
      description: 'Basic model responses',
    },
    standard_response: {
      operation: 'standard_response',
      available: true,
      mode: 'reduced',
      description: 'Basic model responses',
    },
    deep_thinking: {
      operation: 'deep_thinking',
      available: false,
      mode: 'unavailable',
      description: 'Queued for later',
    },
    graph_cot: {
      operation: 'graph_cot',
      available: false,
      mode: 'unavailable',
      description: 'Queued for later',
    },
    extraction_simple: {
      operation: 'extraction_simple',
      available: true,
      mode: 'reduced',
      description: 'Batch extraction',
    },
    extraction_complex: {
      operation: 'extraction_complex',
      available: false,
      mode: 'unavailable',
      description: 'Queued for later',
    },
    embedding: {
      operation: 'embedding',
      available: true,
      mode: 'full',
      description: 'Real-time embeddings',
    },
    batch_extraction: {
      operation: 'batch_extraction',
      available: true,
      mode: 'full',
      description: 'Batch processing',
    },
  },
  offline: {
    classification: {
      operation: 'classification',
      available: true,
      mode: 'reduced',
      description: 'Rules-only classification',
    },
    quick_response: {
      operation: 'quick_response',
      available: true,
      mode: 'reduced',
      description: 'Template responses',
    },
    standard_response: {
      operation: 'standard_response',
      available: false,
      mode: 'unavailable',
      description: 'Queued for later',
    },
    deep_thinking: {
      operation: 'deep_thinking',
      available: false,
      mode: 'unavailable',
      description: 'Queued for later',
    },
    graph_cot: {
      operation: 'graph_cot',
      available: false,
      mode: 'unavailable',
      description: 'Queued for later',
    },
    extraction_simple: {
      operation: 'extraction_simple',
      available: false,
      mode: 'unavailable',
      description: 'Queued for later',
    },
    extraction_complex: {
      operation: 'extraction_complex',
      available: false,
      mode: 'unavailable',
      description: 'Queued for later',
    },
    embedding: {
      operation: 'embedding',
      available: false,
      mode: 'unavailable',
      description: 'Queued for later',
    },
    batch_extraction: {
      operation: 'batch_extraction',
      available: true,
      mode: 'full',
      description: 'Batch processing',
    },
  },
} as const;

// ============================================================
// PLAN CONFIGURATIONS
// ============================================================

/**
 * Plan configurations.
 *
 * @see revision.md "Tier Comparison" section
 */
export const PLAN_CONFIGS: Record<UserPlan, PlanUsageLimits> = {
  free: {
    plan: 'free',
    daily_cost_ceiling: FREE_DAILY_BUDGET, // $0.05/day
    model_downgrade_threshold: MODEL_DOWNGRADE_THRESHOLD,
    strict_enforcement: true,
  },
  credits: {
    plan: 'credits',
    daily_cost_ceiling: undefined, // Wallet balance is the limit
    model_downgrade_threshold: MODEL_DOWNGRADE_THRESHOLD,
    strict_enforcement: false, // Just warn, don't block
  },
  pro: {
    plan: 'pro',
    daily_cost_ceiling: undefined, // Start generous, tighten with data
    model_downgrade_threshold: MODEL_DOWNGRADE_THRESHOLD,
    strict_enforcement: false,
  },
} as const;

/**
 * Tier at each usage threshold.
 * Renamed from TIER_THRESHOLDS to avoid conflict with contradiction module.
 */
export const USAGE_TIER_THRESHOLDS: ReadonlyArray<{ threshold: number; tier: ModelTier }> = [
  { threshold: 0.0, tier: 'premium' },
  { threshold: 0.8, tier: 'balanced' },
  { threshold: 0.9, tier: 'cheap' },
  { threshold: 1.0, tier: 'cheapest' },
] as const;

/**
 * Model tier downgrade sequence.
 */
export const TIER_DOWNGRADE_SEQUENCE: ReadonlyArray<ModelTier> = [
  'premium',
  'balanced',
  'cheap',
  'cheapest',
] as const;

/**
 * User-facing messages for downgrade events.
 */
export const DOWNGRADE_MESSAGES = {
  approaching:
    "You're approaching your daily usage limit. Nous is still available but will use standard models. Full access resets at midnight.",
  downgraded:
    "You've reached your daily usage limit. Nous is still available using standard models. Full access resets at midnight.",
  limit_reached: 'Daily limit reached. Only basic features available until midnight.',
  reset: 'Your daily usage has been reset. Full access restored.',
} as const;

// ============================================================
// CREDIT FLOW CONFIGURATION
// ============================================================

/**
 * Default credit flow configuration.
 */
export const DEFAULT_CREDIT_FLOW_CONFIG: CreditFlowConfig = {
  reservation_buffer: COST_RESERVATION_BUFFER,
  reservation_expiry_minutes: CREDIT_RESERVATION_EXPIRY_MINUTES,
  emit_events: true,
} as const;

// ============================================================
// PROVIDER CONFIG FUNCTIONS
// ============================================================

/**
 * Get model configuration by ID.
 *
 * @param model_id - Model identifier
 * @returns Model configuration or undefined if not found
 */
export function getModelConfig(model_id: string): ModelConfig | undefined {
  return MODEL_CONFIGS[model_id];
}

/**
 * Get provider configuration by ID.
 *
 * @param provider - Provider identifier
 * @returns Provider configuration
 */
export function getProviderConfig(provider: Provider): ProviderConfig {
  return PROVIDER_CONFIGS[provider];
}

/**
 * Get all models for a provider.
 *
 * @param provider - Provider identifier
 * @returns Array of model IDs
 */
export function getModelsForProvider(provider: Provider): string[] {
  return PROVIDER_CONFIGS[provider].models;
}

/**
 * Get all models for a tier.
 *
 * @param tier - Model tier
 * @returns Array of model configurations
 */
export function getModelsForTier(tier: ModelTier): ModelConfig[] {
  return Object.values(MODEL_CONFIGS).filter((m) => m.tier === tier);
}

/**
 * Get provider for a model.
 *
 * @param model_id - Model identifier
 * @returns Provider or undefined
 */
export function getProviderForModel(model_id: string): Provider | undefined {
  const config = MODEL_CONFIGS[model_id];
  return config?.provider;
}

/**
 * Calculate cost for token usage.
 *
 * @param model_id - Model identifier
 * @param input_tokens - Number of input tokens
 * @param output_tokens - Number of output tokens
 * @param cache_read_tokens - Number of cache read tokens
 * @param cache_write_tokens - Number of cache write tokens
 * @returns Cost in dollars
 */
export function calculateTokenCost(
  model_id: string,
  input_tokens: number,
  output_tokens: number,
  cache_read_tokens: number = 0,
  cache_write_tokens: number = 0
): number {
  const config = MODEL_CONFIGS[model_id];
  if (!config) {
    throw new Error(`Unknown model: ${model_id}`);
  }

  const { pricing } = config;
  const PER_MILLION = 1_000_000;

  let cost = 0;
  cost += (input_tokens * pricing.input) / PER_MILLION;
  cost += (output_tokens * pricing.output) / PER_MILLION;

  if (pricing.cache_read && cache_read_tokens > 0) {
    cost += (cache_read_tokens * pricing.cache_read) / PER_MILLION;
  }

  if (pricing.cache_write && cache_write_tokens > 0) {
    cost += (cache_write_tokens * pricing.cache_write) / PER_MILLION;
  }

  return cost;
}

/**
 * Check if model supports prompt caching.
 *
 * @param model_id - Model identifier
 * @returns True if caching is supported
 */
export function supportsCaching(model_id: string): boolean {
  return MODEL_CONFIGS[model_id]?.supports_cache ?? false;
}

/**
 * Check if model supports batch API.
 *
 * @param model_id - Model identifier
 * @returns True if batch is supported
 */
export function supportsBatch(model_id: string): boolean {
  return MODEL_CONFIGS[model_id]?.supports_batch ?? false;
}

// ============================================================
// OPERATION ROUTING FUNCTIONS
// ============================================================

/**
 * Get operation configuration.
 *
 * @param operation - Operation type
 * @returns Operation configuration
 */
export function getOperationConfig(operation: OperationType): OperationConfig {
  return OPERATION_CONFIGS[operation];
}

/**
 * Estimate cost for a request.
 * Renamed from estimateCost to avoid conflict with embeddings module.
 *
 * @param request - LLM request
 * @returns Cost range estimate
 */
export function estimateOperationCost(request: LLMRequest): CostRange {
  const config = OPERATION_CONFIGS[request.operation];
  return config.cost_estimate;
}

/**
 * Check if operation should use batch API.
 *
 * @param operation - Operation type
 * @param urgency - Request urgency
 * @returns True if batch should be used
 */
export function shouldUseBatch(operation: OperationType, urgency: UrgencyLevel): boolean {
  return (
    urgency === 'background' &&
    (operation === 'batch_extraction' ||
      operation === 'embedding' ||
      operation === 'extraction_simple' ||
      operation === 'extraction_complex')
  );
}

/**
 * Get latency target for operation.
 *
 * @param operation - Operation type
 * @returns Latency target in milliseconds
 */
export function getLatencyTarget(operation: OperationType): number {
  return LATENCY_TARGETS_MS[operation];
}

/**
 * Route an LLM request to the appropriate model.
 *
 * @param request - LLM request
 * @param available_providers - List of currently available providers
 * @returns Routing decision
 */
export function routeRequest(request: LLMRequest, available_providers: Provider[]): RoutingDecision {
  const config = OPERATION_CONFIGS[request.operation];

  // For rules-first operations, return rules routing
  if (config.rules_first) {
    return {
      model: 'rules',
      provider: 'google', // Fallback provider for LLM if rules fail
      reason: 'primary',
      cost_estimate: config.cost_estimate,
      use_rules_first: true,
      use_batch: shouldUseBatch(request.operation, request.urgency),
    };
  }

  // Try primary model
  const primary_provider = getProviderForModel(config.primary_model);
  if (primary_provider && available_providers.includes(primary_provider)) {
    return {
      model: config.primary_model,
      provider: primary_provider,
      reason: 'primary',
      cost_estimate: config.cost_estimate,
      use_rules_first: false,
      use_batch: shouldUseBatch(request.operation, request.urgency),
    };
  }

  // Try fallback models
  for (const fallback_model of config.fallback_models) {
    const fallback_provider = getProviderForModel(fallback_model);
    if (fallback_provider && available_providers.includes(fallback_provider)) {
      return {
        model: fallback_model,
        provider: fallback_provider,
        reason: 'fallback',
        cost_estimate: config.cost_estimate,
        use_rules_first: false,
        use_batch: shouldUseBatch(request.operation, request.urgency),
      };
    }
  }

  // No providers available - return with first fallback as placeholder
  const first_fallback = config.fallback_models[0] ?? config.primary_model;
  const first_fallback_provider = getProviderForModel(first_fallback) ?? 'openai';

  return {
    model: first_fallback,
    provider: first_fallback_provider,
    reason: 'health',
    cost_estimate: config.cost_estimate,
    use_rules_first: false,
    use_batch: shouldUseBatch(request.operation, request.urgency),
  };
}

/**
 * Get model for operation with fallback support.
 *
 * @param operation - Operation type
 * @param available_providers - List of available providers
 * @returns Model ID or 'rules' for rules-first operations
 */
export function getModelForOperation(
  operation: OperationType,
  available_providers: Provider[]
): string {
  const config = OPERATION_CONFIGS[operation];

  // For rules-first operations, return 'rules' as primary
  if (config.rules_first) {
    return 'rules';
  }

  // Try primary model
  const primary_provider = getProviderForModel(config.primary_model);
  if (primary_provider && available_providers.includes(primary_provider)) {
    return config.primary_model;
  }

  // Try fallbacks
  for (const fallback_model of config.fallback_models) {
    const fallback_provider = getProviderForModel(fallback_model);
    if (fallback_provider && available_providers.includes(fallback_provider)) {
      return fallback_model;
    }
  }

  // Return primary as default
  return config.primary_model;
}

// ============================================================
// CREDIT FLOW FUNCTIONS
// ============================================================

/**
 * Get reservation buffer multiplier.
 */
export function getReservationBuffer(): number {
  return COST_RESERVATION_BUFFER;
}

/**
 * Get reservation expiry time in minutes.
 */
export function getReservationExpiryMinutes(): number {
  return CREDIT_RESERVATION_EXPIRY_MINUTES;
}

/**
 * Calculate actual cost from token usage.
 *
 * @param usage - Token usage from response
 * @param model - Model used
 * @returns Actual cost in dollars
 */
export function calculateActualCost(usage: TokenUsage, model: string): number {
  return calculateTokenCost(
    model,
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_read_tokens ?? 0,
    usage.cache_write_tokens ?? 0
  );
}

/**
 * Check if user has sufficient credits for operation.
 * Requires external credit balance lookup.
 *
 * @param user_id - User ID
 * @param estimated_max - Maximum estimated cost
 * @returns Credit check result
 */
export async function checkCredits(
  _user_id: string,
  _estimated_max: number
): Promise<CreditCheckResult> {
  // This requires external credit balance lookup
  // Implementation will be provided by the credit service
  throw new Error('checkCredits requires credit service implementation');
}

/**
 * Reserve credits before operation.
 * Requires external credit service.
 *
 * @param user_id - User ID
 * @param amount - Amount to reserve
 * @param operation - Operation type
 * @param request_id - Optional request ID
 * @returns Credit reservation
 */
export async function reserveCredits(
  _user_id: string,
  _amount: number,
  _operation: OperationType,
  _request_id?: string
): Promise<CreditReservation> {
  // This requires external credit service
  throw new Error('reserveCredits requires credit service implementation');
}

/**
 * Finalize reservation after operation.
 * Requires external credit service.
 *
 * @param reservation_id - Reservation ID
 * @param actual_cost - Actual cost incurred
 * @param model_used - Model that was used
 * @returns Credit transaction
 */
export async function finalizeCredits(
  _reservation_id: string,
  _actual_cost: number,
  _model_used: string
): Promise<CreditTransaction> {
  // This requires external credit service
  throw new Error('finalizeCredits requires credit service implementation');
}

/**
 * Refund entire reservation (on error).
 * Requires external credit service.
 *
 * @param reservation_id - Reservation ID
 * @returns Credit transaction (refund)
 */
export async function refundCredits(_reservation_id: string): Promise<CreditTransaction> {
  // This requires external credit service
  throw new Error('refundCredits requires credit service implementation');
}

/**
 * Get user's current credit balance.
 * Requires external credit service.
 *
 * @param user_id - User ID
 * @returns Current credit balance
 */
export async function getCreditBalance(_user_id: string): Promise<number> {
  // This requires external credit service
  throw new Error('getCreditBalance requires credit service implementation');
}

// ============================================================
// PROMPT CACHE FUNCTIONS
// ============================================================

/**
 * Get cache configuration for prompt type.
 *
 * @param prompt_type - Type of prompt
 * @returns Cache configuration
 */
export function getCacheConfig(prompt_type: CacheablePromptType): PromptCacheConfig {
  return PROMPT_CACHE_CONFIGS[prompt_type];
}

/**
 * Check if model supports caching.
 *
 * @param model - Model ID
 * @returns True if model supports prompt caching
 */
export function modelSupportsCaching(model: string): boolean {
  // Currently only Anthropic models support prompt caching
  return model.startsWith('claude-');
}

/**
 * Calculate break-even calls for caching.
 *
 * @param tokens - Number of tokens in prompt
 * @param model - Model to use
 * @returns Number of calls to break even on cache write cost
 */
export function calculateBreakEvenCalls(_tokens: number, _model: string): number {
  // Cache write is 1.25x base, cache read is 0.1x base
  // Break-even: (1.25 * base) = n * (0.1 * base) + base
  // Solving: 0.25 * base = (n - 1) * 0.9 * base
  // n = 2 calls to break even
  return 2;
}

/**
 * Check if prompt is cached.
 * Requires external cache service.
 *
 * @param prompt_type - Type of prompt
 * @param content_hash - Hash of prompt content
 * @returns Cache hit result
 */
export async function checkCacheHit(
  _prompt_type: CacheablePromptType,
  _content_hash: string
): Promise<CacheHitResult> {
  // This requires external cache service
  throw new Error('checkCacheHit requires cache service implementation');
}

/**
 * Estimate savings from caching.
 * Requires model pricing lookup.
 *
 * @param calls_expected - Expected number of calls
 * @param prompt_type - Type of prompt
 * @param model - Model to use (for pricing)
 * @returns Savings estimate
 */
export function estimateCacheSavings(
  calls_expected: number,
  prompt_type: CacheablePromptType,
  model: string
): CacheSavingsEstimate {
  const config = getCacheConfig(prompt_type);
  const model_config = getModelConfig(model);

  if (!model_config || !model_config.pricing.cache_read) {
    return {
      without_cache: 0,
      with_cache: 0,
      savings_percent: 0,
      break_even_calls: Infinity,
    };
  }

  const PER_MILLION = 1_000_000;
  const base_cost = (config.tokens * model_config.pricing.input) / PER_MILLION;
  const cache_read_cost = (config.tokens * model_config.pricing.cache_read) / PER_MILLION;
  const cache_write_cost = model_config.pricing.cache_write
    ? (config.tokens * model_config.pricing.cache_write) / PER_MILLION
    : base_cost * 1.25;

  const without_cache = base_cost * calls_expected;
  const with_cache = cache_write_cost + cache_read_cost * (calls_expected - 1);
  const savings_percent = calls_expected > 1 ? ((without_cache - with_cache) / without_cache) * 100 : 0;

  return {
    without_cache,
    with_cache,
    savings_percent,
    break_even_calls: 2,
  };
}

/**
 * Warm cache for prompt type.
 * Requires external cache service.
 *
 * @param prompt_type - Type of prompt
 * @returns Cache entry
 */
export async function warmCache(_prompt_type: CacheablePromptType): Promise<CacheEntry> {
  // This requires external cache service
  throw new Error('warmCache requires cache service implementation');
}

/**
 * Invalidate cache entry.
 * Requires external cache service.
 *
 * @param cache_id - Cache entry ID
 */
export async function invalidateCache(_cache_id: string): Promise<void> {
  // This requires external cache service
  throw new Error('invalidateCache requires cache service implementation');
}

/**
 * Get cache statistics.
 * Requires external cache service.
 *
 * @param prompt_type - Type of prompt (optional, all if not specified)
 * @returns Cache statistics
 */
export async function getCacheStats(_prompt_type?: CacheablePromptType): Promise<{
  entries: number;
  total_reads: number;
  total_tokens_saved: number;
  total_cost_saved: number;
}> {
  // This requires external cache service
  throw new Error('getCacheStats requires cache service implementation');
}

// ============================================================
// EMBEDDING SERVICE FUNCTIONS
// ============================================================

/**
 * Get embedding service configuration.
 *
 * @returns Current configuration
 */
export function getEmbeddingConfig(): EmbeddingServiceConfig {
  return DEFAULT_EMBEDDING_CONFIG;
}

/**
 * Calculate embedding cost.
 *
 * @param token_count - Number of tokens
 * @param mode - Operation mode
 * @returns Cost in dollars
 */
export function calculateEmbeddingCost(token_count: number, mode: EmbeddingMode): number {
  const config = DEFAULT_EMBEDDING_CONFIG;
  const price_per_million = mode === 'batch' ? config.pricing.batch : config.pricing.realtime;
  return (token_count * price_per_million) / 1_000_000;
}

/**
 * Get batch discount percentage.
 */
export function getBatchDiscountPercent(): number {
  return BATCH_DISCOUNT_PERCENT;
}

/**
 * Get batch deadline in hours.
 */
export function getBatchDeadlineHours(): number {
  return BATCH_DEADLINE_HOURS;
}

/**
 * When to use batch vs realtime.
 *
 * Use batch for:
 * - Document ingestion (storm-014 progressive extraction)
 * - Periodic re-embedding (model updates)
 * - Backfill operations
 *
 * Use realtime for:
 * - Query embedding
 * - User-initiated operations
 * - Real-time responses
 */
export function shouldUseBatchEmbedding(
  texts_count: number,
  is_user_initiated: boolean,
  is_urgent: boolean
): boolean {
  // Never batch user-initiated or urgent requests
  if (is_user_initiated || is_urgent) {
    return false;
  }

  // Batch makes sense for larger operations
  return texts_count >= 10;
}

/**
 * Embed a single query (real-time).
 * Requires external embedding service.
 *
 * @param text - Text to embed
 * @param user_id - User ID for tracking
 * @returns Embedding vector
 */
export async function embedQuery(_text: string, _user_id: string): Promise<number[]> {
  // This requires external embedding service
  throw new Error('embedQuery requires embedding service implementation');
}

/**
 * Embed multiple texts (real-time).
 * Requires external embedding service.
 *
 * @param texts - Texts to embed
 * @param user_id - User ID for tracking
 * @returns Embedding result
 */
export async function embedTexts(_texts: string[], _user_id: string): Promise<EmbeddingResult> {
  // This requires external embedding service
  throw new Error('embedTexts requires embedding service implementation');
}

/**
 * Create a batch embedding job.
 * Requires external embedding service.
 *
 * @param texts - Texts to embed
 * @param user_id - User ID for tracking
 * @returns Batch job
 */
export async function embedBatch(_texts: string[], _user_id: string): Promise<EmbeddingBatchJob> {
  // This requires external embedding service
  throw new Error('embedBatch requires embedding service implementation');
}

/**
 * Get batch job status.
 * Requires external embedding service.
 *
 * @param job_id - Job ID
 * @returns Batch job status
 */
export async function getBatchStatus(_job_id: string): Promise<EmbeddingBatchJob> {
  // This requires external embedding service
  throw new Error('getBatchStatus requires embedding service implementation');
}

/**
 * Get batch job results.
 * Requires external embedding service.
 *
 * @param job_id - Job ID
 * @returns Embedding result
 */
export async function getBatchResults(_job_id: string): Promise<EmbeddingResult> {
  // This requires external embedding service
  throw new Error('getBatchResults requires embedding service implementation');
}

/**
 * Cancel a pending batch job.
 * Requires external embedding service.
 *
 * @param job_id - Job ID
 */
export async function cancelBatchJob(_job_id: string): Promise<void> {
  // This requires external embedding service
  throw new Error('cancelBatchJob requires embedding service implementation');
}

// ============================================================
// RATE LIMIT FUNCTIONS
// ============================================================

/**
 * Get rate limit configuration.
 */
export function getRateLimitConfig(): RateLimitConfig {
  return DEFAULT_RATE_LIMIT_CONFIG;
}

/**
 * Get provider rate limits from config.
 *
 * @param provider - Provider identifier
 * @returns Rate limits for the provider
 */
export function getProviderRateLimits(provider: Provider): { rpm: number; tpm: number } {
  return PROVIDER_RATE_LIMITS[provider];
}

/**
 * Get current rate limit state for a provider.
 * Requires external rate limit tracking.
 *
 * @param provider - Provider identifier
 * @returns Current rate limit state
 */
export function getRateLimitState(_provider: Provider): RateLimitState {
  // This requires external rate limit tracking
  throw new Error('getRateLimitState requires rate limit tracking implementation');
}

/**
 * Check if provider is available (not rate limited and healthy).
 * Requires external rate limit tracking.
 *
 * @param provider - Provider identifier
 * @returns True if provider can accept requests
 */
export function isProviderAvailable(_provider: Provider): boolean {
  // This requires external rate limit tracking
  throw new Error('isProviderAvailable requires rate limit tracking implementation');
}

/**
 * Check if provider is approaching rate limit.
 * Requires external rate limit tracking.
 *
 * @param provider - Provider identifier
 * @returns True if at or above warning threshold
 */
export function isApproachingRateLimit(_provider: Provider): boolean {
  // This requires external rate limit tracking
  throw new Error('isApproachingRateLimit requires rate limit tracking implementation');
}

/**
 * Select best available provider for an operation.
 * Requires external rate limit and health tracking.
 *
 * @param operation - Operation type
 * @param preferred_providers - Ordered list of preferred providers
 * @param urgency - Request urgency
 * @returns Provider selection result
 */
export async function selectProvider(
  _operation: OperationType,
  _preferred_providers: Provider[],
  _urgency: UrgencyLevel
): Promise<ProviderSelection> {
  // This requires external rate limit and health tracking
  throw new Error('selectProvider requires rate limit tracking implementation');
}

/**
 * Track a request for rate limiting.
 * Requires external rate limit tracking.
 *
 * @param provider - Provider that handled the request
 * @param tokens_used - Number of tokens consumed
 */
export function trackRequest(_provider: Provider, _tokens_used: number): void {
  // This requires external rate limit tracking
  throw new Error('trackRequest requires rate limit tracking implementation');
}

/**
 * Check provider health.
 * Requires external health monitoring.
 *
 * @param provider - Provider identifier
 * @returns Health check result
 */
export async function checkProviderHealth(_provider: Provider): Promise<ProviderHealthCheck> {
  // This requires external health monitoring
  throw new Error('checkProviderHealth requires health monitoring implementation');
}

/**
 * Get count of healthy providers.
 * Requires external health monitoring.
 *
 * @returns Number of providers with 'healthy' status
 */
export function getHealthyProviderCount(): number {
  // This requires external health monitoring
  throw new Error('getHealthyProviderCount requires health monitoring implementation');
}

/**
 * Get all provider health states.
 * Requires external health monitoring.
 *
 * @returns Map of provider to health status
 */
export function getAllProviderHealth(): Record<Provider, 'healthy' | 'degraded' | 'down'> {
  // This requires external health monitoring
  throw new Error('getAllProviderHealth requires health monitoring implementation');
}

/**
 * Reset rate limit counters (called at minute boundary).
 * Requires external rate limit tracking.
 *
 * @param provider - Provider to reset, or all if not specified
 */
export function resetRateLimitCounters(_provider?: Provider): void {
  // This requires external rate limit tracking
  throw new Error('resetRateLimitCounters requires rate limit tracking implementation');
}

/**
 * Calculate usage percentage for a provider.
 * Requires external rate limit tracking.
 *
 * @param provider - Provider identifier
 * @returns Usage as percentage (0-100), higher of RPM or TPM usage
 */
export function calculateUsagePercent(_provider: Provider): number {
  // This requires external rate limit tracking
  throw new Error('calculateUsagePercent requires rate limit tracking implementation');
}

// ============================================================
// DEGRADATION FUNCTIONS
// ============================================================

// Module-level state for degradation (for pure functions)
let currentDegradationLevel: DegradationLevel = 'healthy';

/**
 * Get current degradation level.
 *
 * @returns Current degradation level
 */
export function getCurrentDegradationLevel(): DegradationLevel {
  return currentDegradationLevel;
}

/**
 * Set degradation level.
 *
 * @param level - New degradation level
 * @param reason - Reason for change
 */
export function setDegradationLevel(level: DegradationLevel, _reason: string): void {
  currentDegradationLevel = level;
  // In a full implementation, this would emit a degradation:changed event
}

/**
 * Get degradation mode config for current level.
 *
 * @returns Degradation mode configuration
 */
export function getDegradationModeConfig(): DegradationModeConfig {
  return DEGRADATION_MODE_CONFIGS[currentDegradationLevel];
}

/**
 * Get user message for current degradation level.
 *
 * @returns User-facing message or undefined if healthy
 */
export function getUserMessage(): string | undefined {
  return DEGRADATION_MODE_CONFIGS[currentDegradationLevel].user_message;
}

/**
 * Calculate degradation level from provider health.
 *
 * @param healthy_count - Number of healthy providers
 * @param total_count - Total number of providers
 * @returns Appropriate degradation level
 */
export function calculateDegradationLevel(
  healthy_count: number,
  total_count: number
): DegradationLevel {
  if (healthy_count === 0) {
    return 'offline';
  }
  if (healthy_count === 1 || healthy_count < total_count / 2) {
    return 'degraded';
  }
  return 'healthy';
}

/**
 * Check if an operation is available at current degradation level.
 *
 * @param operation - Operation type
 * @returns True if operation can be performed
 */
export function isOperationAvailable(operation: OperationType): boolean {
  return OPERATION_AVAILABILITY[currentDegradationLevel][operation].available;
}

/**
 * Get operation availability details.
 *
 * @param operation - Operation type
 * @returns Availability details
 */
export function getOperationAvailability(operation: OperationType): OperationAvailability {
  return OPERATION_AVAILABILITY[currentDegradationLevel][operation];
}

/**
 * Handle provider failure.
 * Requires external health monitoring.
 *
 * @param provider - Provider that failed
 */
export function handleProviderFailure(_provider: Provider): void {
  // In a full implementation, this would:
  // 1. Update provider health state
  // 2. Recalculate degradation level
  // 3. Emit events
  throw new Error('handleProviderFailure requires health monitoring implementation');
}

/**
 * Handle provider recovery.
 * Requires external health monitoring.
 *
 * @param provider - Provider that recovered
 */
export function handleProviderRecovery(_provider: Provider): void {
  // In a full implementation, this would:
  // 1. Update provider health state
  // 2. Recalculate degradation level
  // 3. Emit events
  throw new Error('handleProviderRecovery requires health monitoring implementation');
}

/**
 * Get system health status.
 * Requires external health monitoring.
 *
 * @returns Current system health status
 */
export function getSystemHealthStatus(): SystemHealthStatus {
  // This requires external health monitoring
  throw new Error('getSystemHealthStatus requires health monitoring implementation');
}

// ============================================================
// USAGE LIMIT FUNCTIONS
// ============================================================

/**
 * Get plan configuration.
 *
 * @param plan - Plan type
 * @returns Plan usage limits
 */
export function getPlanConfig(plan: UserPlan): PlanUsageLimits {
  return PLAN_CONFIGS[plan];
}

/**
 * Calculate tier for usage percentage.
 *
 * @param usage_percent - Usage as percentage (0-1)
 * @returns Appropriate model tier
 */
export function calculateTierForUsage(usage_percent: number): ModelTier {
  // Find the highest threshold that is <= usage_percent
  for (let i = USAGE_TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = USAGE_TIER_THRESHOLDS[i];
    if (threshold && usage_percent >= threshold.threshold) {
      return threshold.tier;
    }
  }
  return 'premium';
}

/**
 * Get free tier capacity reference.
 *
 * @returns What $0.05/day buys
 */
export function getFreeTierCapacity(): typeof FREE_TIER_CAPACITY {
  return FREE_TIER_CAPACITY;
}

/**
 * Get downgrade message for notification type.
 *
 * @param type - Notification type
 * @returns User-facing message
 */
export function getDowngradeMessage(
  type: 'approaching' | 'downgraded' | 'limit_reached' | 'reset'
): string {
  return DOWNGRADE_MESSAGES[type];
}

/**
 * Check if user can proceed with estimated cost.
 * Requires external usage tracking.
 *
 * @param user_id - User ID
 * @param estimated_cost - Estimated cost for the operation
 * @returns True if user has sufficient budget
 */
export function checkUserBudget(_user_id: string, _estimated_cost: number): boolean {
  // This requires external usage tracking
  throw new Error('checkUserBudget requires usage tracking implementation');
}

/**
 * Get user's current usage state.
 * Requires external usage tracking.
 *
 * @param user_id - User ID
 * @returns Current usage state
 */
export async function getUserUsageState(_user_id: string): Promise<UserUsageState> {
  // This requires external usage tracking
  throw new Error('getUserUsageState requires usage tracking implementation');
}

/**
 * Get available model tier for user.
 * Requires external usage tracking.
 *
 * @param user_id - User ID
 * @returns Maximum available tier
 */
export async function getAvailableModelTier(_user_id: string): Promise<ModelTier> {
  // This requires external usage tracking
  throw new Error('getAvailableModelTier requires usage tracking implementation');
}

/**
 * Handle approaching limit.
 * Requires external usage tracking.
 *
 * @param user_id - User ID
 * @param usage_percent - Current usage as percentage
 */
export function handleApproachingLimit(_user_id: string, _usage_percent: number): void {
  // This requires external usage tracking
  throw new Error('handleApproachingLimit requires usage tracking implementation');
}

/**
 * Track usage for a user.
 * Requires external usage tracking.
 *
 * @param user_id - User ID
 * @param cost - Cost to add
 */
export async function trackUsage(_user_id: string, _cost: number): Promise<void> {
  // This requires external usage tracking
  throw new Error('trackUsage requires usage tracking implementation');
}

/**
 * Reset daily usage for a user.
 * Requires external usage tracking.
 *
 * @param user_id - User ID
 */
export async function resetDailyUsage(_user_id: string): Promise<void> {
  // This requires external usage tracking
  throw new Error('resetDailyUsage requires usage tracking implementation');
}

/**
 * Check if operation is allowed for user's current tier.
 * Requires external usage tracking.
 *
 * @param user_id - User ID
 * @param required_tier - Minimum tier required for operation
 * @returns True if user's tier is sufficient
 */
export async function isOperationAllowedForTier(
  _user_id: string,
  _required_tier: ModelTier
): Promise<boolean> {
  // This requires external usage tracking
  throw new Error('isOperationAllowedForTier requires usage tracking implementation');
}
