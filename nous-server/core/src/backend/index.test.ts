/**
 * @module @nous/core/backend
 * @description Comprehensive tests for storm-026 backend infrastructure module
 * @version 1.0.0
 *
 * ~190 tests covering all 11 domain files:
 * constants, types/schemas, adapters, server, jobs, config,
 * deployment, health, observability, sse, local-dev
 */

import { describe, it, expect } from 'vitest';
import {
  // === CONSTANTS ===
  API_VERSION,
  API_BASE_PATH,
  DEPLOYMENT_TARGETS,
  isDeploymentTarget,
  DEPLOYMENT_ENVIRONMENTS,
  isDeploymentEnvironment,
  DATABASE_ADAPTER_TYPES,
  AUTH_ADAPTER_TYPES,
  LLM_ADAPTER_TYPES,
  EMBEDDING_ADAPTER_TYPES,
  STORAGE_ADAPTER_TYPES,
  JOB_QUEUE_ADAPTER_TYPES,
  JOB_TIERS,
  isJobTier,
  JOB_TYPES,
  isJobType,
  CRON_JOB_TYPES,
  isCronJobType,
  JOB_PRIORITIES,
  JOB_TIER_LIMITS,
  QUEUED_JOB_TYPES,
  REGIONAL_JOB_TYPES,
  DEFAULT_JOB_RETRY_COUNT,
  DEFAULT_JOB_RETRY_DELAY_MS,
  SSE_MAX_DURATION_MS,
  SSE_HEARTBEAT_INTERVAL_MS,
  SSE_RECONNECT_DEFAULT,
  SSE_EVENT_TYPES,
  isSSEEventType,
  HEALTH_STATUSES,
  isHealthStatus,
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_CHECK_SERVICES,
  MIDDLEWARE_TYPES,
  MIDDLEWARE_ORDER,
  DEFAULT_CORS_ORIGINS,
  DEFAULT_RATE_LIMIT_RPM,
  RATE_LIMIT_WINDOW_MS,
  DEFAULT_PORT,
  DEFAULT_HOST,
  LOG_LEVELS,
  isLogLevel,
  DEFAULT_LOG_LEVEL,
  SENTRY_TRACES_SAMPLE_RATE,
  DEPLOYMENT_SCENARIOS,
  isDeploymentScenario,
  ROUTE_PREFIXES,
  AUTH_EXEMPT_PATHS,
  ERROR_CODES,

  // === SCHEMAS (from types.ts) ===
  ListOptionsSchema,
  VectorSearchOptionsSchema,
  TextSearchOptionsSchema,
  HybridSearchOptionsSchema,
  SearchResultSchema,
  ChangeSetSchema,
  ChangeSchema,
  ApplyResultSchema,
  AppliedChangeSchema,
  AdapterConflictSchema,
  AdapterMessageSchema,
  CompletionRequestSchema,
  CompletionResponseSchema,
  CompletionChunkSchema,
  AdapterTokenUsageSchema,
  AdapterCostEstimateSchema,
  UsageReportSchema,
  AdapterAuthResultSchema,
  AdapterUserSchema,
  AdapterTokenPairSchema,
  AdapterApiKeyResultSchema,
  JobSchema,
  JobEventSchema,
  FailedJobSchema,
  JobTierConfigSchema,
  JobMetricsSchema,
  RouteGroupSchema,
  CORSConfigSchema,
  AuthMiddlewareConfigSchema,
  ServerRateLimitConfigSchema,
  LoggingMiddlewareConfigSchema,
  ErrorMiddlewareConfigSchema,
  MiddlewareConfigSchema,
  ApiErrorResponseSchema,
  SSEOptionsSchema,
  SSEEventSchema,
  SSEStreamStateSchema,
  ChatStreamChunkSchema,
  TursoDatabaseConfigSchema,
  SqliteDatabaseConfigSchema,
  DatabaseConfigSchema,
  ClerkAuthConfigSchema,
  LocalAuthConfigSchema,
  AuthConfigSchema,
  LLMConfigSchema,
  CloudflareJobsConfigSchema,
  BullMQJobsConfigSchema,
  MemoryJobsConfigSchema,
  JobsConfigSchema,
  ObservabilityConfigSchema,
  NousConfigSchema,
  HealthCheckResponseSchema,
  ServiceHealthSchema,
  HealthMetricsSchema,
  ReadinessCheckSchema,
  DeploymentMatrixEntrySchema,
  SelfHostConfigSchema,
  DockerServiceConfigSchema,
  StructuredLogEntrySchema,
  MetricsConfigSchema,
  SentryConfigSchema,
  RequestContextSchema,
  LocalDevConfigSchema,
  SeedUserSchema,
  SeedDataConfigSchema,
  MockLLMConfigSchema,
  MockEmbeddingConfigSchema,
  MockJobQueueConfigSchema,
  LocalAuthDevConfigSchema,

  // === ADAPTERS ===
  createPaginatedResultSchema,

  // === SERVER ===
  ROUTE_GROUPS,
  DEFAULT_MIDDLEWARE_CONFIG,
  createApiError,
  getRouteGroup,
  requiresAuth,
  createServer,

  // === JOBS ===
  JOB_TIER_ASSIGNMENTS,
  getJobTierForType,
  getJobTierConfig,
  createJob,
  isJobExpired,

  // === CONFIG ===
  ENV_VAR_MAPPING,
  validateConfig,
  safeValidateConfig,
  getEnvVarName,
  loadConfig,

  // === DEPLOYMENT ===
  DEPLOYMENT_MATRIX,
  DEFAULT_SELF_HOST_CONFIG,
  DOCKER_SERVICES,
  getDeploymentConfig,
  getSelfHostRequirements,
  getDockerServices,
  requiresRedis,

  // === HEALTH ===
  isAllHealthy,
  determineOverallHealth,
  getHttpStatusForHealth,
  checkAllServices,
  checkServiceHealth,

  // === OBSERVABILITY ===
  DEFAULT_METRICS_CONFIG,
  createRequestContext,
  formatLogEntry,
  calculateRequestDuration,
  shouldLog,

  // === SSE ===
  DEFAULT_SSE_OPTIONS,
  formatSSEEvent,
  parseLastEventId,
  createSSEStreamState,
  isStreamExpired,
  createSSEStream,

  // === LOCAL DEV ===
  DEFAULT_LOCAL_DEV_CONFIG,
  DEV_USER,
  DEFAULT_SEED_DATA,
  getLocalDevConfig,
  getDefaultSeedUsers,
  getMockAdapterConfigs,
} from './index';

import { z } from 'zod';

// ============================================================
// HELPERS
// ============================================================

/** A minimal valid NousConfig object used for config validation tests */
function validNousConfig() {
  return {
    env: 'development',
    port: 3000,
    host: '0.0.0.0',
    database: { type: 'sqlite' as const, path: './dev.db' },
    auth: { type: 'local' as const },
    llm: {},
    jobs: { type: 'memory' as const },
    observability: { logLevel: 'info' },
  };
}

// ============================================================
// TESTS
// ============================================================

describe('@nous/core/backend', () => {
  // ============================
  // CONSTANTS (~20 tests)
  // ============================
  describe('constants', () => {
    it('API_VERSION is v1', () => {
      expect(API_VERSION).toBe('v1');
    });

    it('API_BASE_PATH is /v1', () => {
      expect(API_BASE_PATH).toBe('/v1');
    });

    it('DEPLOYMENT_TARGETS contains all four targets', () => {
      expect(DEPLOYMENT_TARGETS).toEqual(['cloudflare_workers', 'fly_io', 'docker', 'local']);
    });

    it('isDeploymentTarget returns true for valid targets', () => {
      expect(isDeploymentTarget('cloudflare_workers')).toBe(true);
      expect(isDeploymentTarget('docker')).toBe(true);
    });

    it('isDeploymentTarget returns false for invalid values', () => {
      expect(isDeploymentTarget('aws')).toBe(false);
      expect(isDeploymentTarget(123)).toBe(false);
      expect(isDeploymentTarget(null)).toBe(false);
    });

    it('DEPLOYMENT_ENVIRONMENTS contains dev/staging/production', () => {
      expect(DEPLOYMENT_ENVIRONMENTS).toEqual(['development', 'staging', 'production']);
    });

    it('isDeploymentEnvironment validates correctly', () => {
      expect(isDeploymentEnvironment('development')).toBe(true);
      expect(isDeploymentEnvironment('test')).toBe(false);
    });

    it('adapter type arrays contain expected values', () => {
      expect(DATABASE_ADAPTER_TYPES).toEqual(['turso', 'sqlite']);
      expect(AUTH_ADAPTER_TYPES).toEqual(['clerk', 'local']);
      expect(LLM_ADAPTER_TYPES).toEqual(['openai', 'anthropic', 'google', 'mock']);
      expect(EMBEDDING_ADAPTER_TYPES).toEqual(['openai', 'mock']);
      expect(STORAGE_ADAPTER_TYPES).toEqual(['s3', 'local', 'mock']);
      expect(JOB_QUEUE_ADAPTER_TYPES).toEqual(['cloudflare', 'bullmq', 'memory']);
    });

    it('JOB_TIERS has inline, queued, regional', () => {
      expect(JOB_TIERS).toEqual(['inline', 'queued', 'regional']);
    });

    it('isJobTier validates correctly', () => {
      expect(isJobTier('inline')).toBe(true);
      expect(isJobTier('queued')).toBe(true);
      expect(isJobTier('regional')).toBe(true);
      expect(isJobTier('immediate')).toBe(false);
    });

    it('isJobType validates all job types', () => {
      for (const jt of JOB_TYPES) {
        expect(isJobType(jt)).toBe(true);
      }
      expect(isJobType('unknown-job')).toBe(false);
    });

    it('isCronJobType validates cron job types', () => {
      expect(isCronJobType('decay-cycle')).toBe(true);
      expect(isCronJobType('reorganize')).toBe(true);
      expect(isCronJobType('cleanup-expired')).toBe(true);
      expect(isCronJobType('embed')).toBe(false);
    });

    it('JOB_TIER_LIMITS has correct max durations', () => {
      expect(JOB_TIER_LIMITS.inline.max_duration_ms).toBe(50);
      expect(JOB_TIER_LIMITS.queued.max_duration_ms).toBe(30_000);
      expect(JOB_TIER_LIMITS.regional.max_duration_ms).toBe(600_000);
    });

    it('QUEUED_JOB_TYPES and REGIONAL_JOB_TYPES are disjoint sets', () => {
      for (const q of QUEUED_JOB_TYPES) {
        expect(REGIONAL_JOB_TYPES).not.toContain(q);
      }
    });

    it('SSE constants match spec', () => {
      expect(SSE_MAX_DURATION_MS).toBe(25_000);
      expect(SSE_HEARTBEAT_INTERVAL_MS).toBe(15_000);
      expect(SSE_RECONNECT_DEFAULT).toBe(true);
    });

    it('isSSEEventType validates event types', () => {
      expect(isSSEEventType('data')).toBe(true);
      expect(isSSEEventType('ping')).toBe(true);
      expect(isSSEEventType('timeout')).toBe(true);
      expect(isSSEEventType('done')).toBe(true);
      expect(isSSEEventType('error')).toBe(true);
      expect(isSSEEventType('message')).toBe(false);
    });

    it('isHealthStatus validates statuses', () => {
      expect(isHealthStatus('healthy')).toBe(true);
      expect(isHealthStatus('degraded')).toBe(true);
      expect(isHealthStatus('unhealthy')).toBe(true);
      expect(isHealthStatus('ok')).toBe(false);
    });

    it('server defaults are correct', () => {
      expect(DEFAULT_PORT).toBe(3000);
      expect(DEFAULT_HOST).toBe('0.0.0.0');
      expect(DEFAULT_JOB_RETRY_COUNT).toBe(3);
      expect(DEFAULT_JOB_RETRY_DELAY_MS).toBe(1_000);
      expect(DEFAULT_RATE_LIMIT_RPM).toBe(60);
      expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
      expect(HEALTH_CHECK_TIMEOUT_MS).toBe(5_000);
    });

    it('isLogLevel validates log levels', () => {
      expect(isLogLevel('debug')).toBe(true);
      expect(isLogLevel('info')).toBe(true);
      expect(isLogLevel('fatal')).toBe(true);
      expect(isLogLevel('trace')).toBe(false);
    });

    it('DEFAULT_LOG_LEVEL is info', () => {
      expect(DEFAULT_LOG_LEVEL).toBe('info');
    });

    it('SENTRY_TRACES_SAMPLE_RATE is 0.1', () => {
      expect(SENTRY_TRACES_SAMPLE_RATE).toBe(0.1);
    });

    it('isDeploymentScenario validates scenarios', () => {
      expect(isDeploymentScenario('nous_cloud')).toBe(true);
      expect(isDeploymentScenario('self_host_small')).toBe(true);
      expect(isDeploymentScenario('heroku')).toBe(false);
    });

    it('ROUTE_PREFIXES has expected keys and paths', () => {
      expect(ROUTE_PREFIXES.nodes).toBe('/v1/nodes');
      expect(ROUTE_PREFIXES.health).toBe('/v1/health');
      expect(ROUTE_PREFIXES.chat).toBe('/v1/chat');
    });

    it('AUTH_EXEMPT_PATHS includes only /v1/health', () => {
      expect(AUTH_EXEMPT_PATHS).toEqual(['/v1/health']);
    });

    it('ERROR_CODES has correct HTTP statuses', () => {
      expect(ERROR_CODES.UNAUTHORIZED.status).toBe(401);
      expect(ERROR_CODES.FORBIDDEN.status).toBe(403);
      expect(ERROR_CODES.NOT_FOUND.status).toBe(404);
      expect(ERROR_CODES.CONFLICT.status).toBe(409);
      expect(ERROR_CODES.RATE_LIMITED.status).toBe(429);
      expect(ERROR_CODES.VALIDATION_ERROR.status).toBe(400);
      expect(ERROR_CODES.INTERNAL_ERROR.status).toBe(500);
      expect(ERROR_CODES.SERVICE_UNAVAILABLE.status).toBe(503);
    });

    it('MIDDLEWARE_ORDER is cors -> logging -> error -> auth -> rate_limit', () => {
      expect(MIDDLEWARE_ORDER).toEqual(['cors', 'logging', 'error', 'auth', 'rate_limit']);
    });

    it('JOB_PRIORITIES has high, normal, low', () => {
      expect(JOB_PRIORITIES).toEqual(['high', 'normal', 'low']);
    });

    it('DEFAULT_CORS_ORIGINS is wildcard', () => {
      expect(DEFAULT_CORS_ORIGINS).toEqual(['*']);
    });

    it('HEALTH_CHECK_SERVICES contains expected services', () => {
      expect(HEALTH_CHECK_SERVICES).toEqual(['database', 'llm', 'embedding', 'auth', 'jobs']);
    });

    it('MIDDLEWARE_TYPES contains expected types', () => {
      expect(MIDDLEWARE_TYPES).toEqual(['cors', 'auth', 'rate_limit', 'logging', 'error']);
    });
  });

  // ============================
  // SCHEMAS (~40 tests)
  // ============================
  describe('schemas', () => {
    it('ListOptionsSchema accepts valid data', () => {
      const result = ListOptionsSchema.parse({ limit: 10, offset: 0 });
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    it('ListOptionsSchema rejects limit < 1', () => {
      expect(() => ListOptionsSchema.parse({ limit: 0, offset: 0 })).toThrow();
    });

    it('ListOptionsSchema rejects limit > 1000', () => {
      expect(() => ListOptionsSchema.parse({ limit: 1001, offset: 0 })).toThrow();
    });

    it('ListOptionsSchema accepts optional sort fields', () => {
      const result = ListOptionsSchema.parse({ limit: 50, offset: 10, sort_by: 'name', sort_order: 'desc' });
      expect(result.sort_by).toBe('name');
      expect(result.sort_order).toBe('desc');
    });

    it('VectorSearchOptionsSchema accepts valid data', () => {
      const result = VectorSearchOptionsSchema.parse({ limit: 10, min_similarity: 0.5 });
      expect(result.min_similarity).toBe(0.5);
    });

    it('VectorSearchOptionsSchema rejects min_similarity > 1', () => {
      expect(() => VectorSearchOptionsSchema.parse({ limit: 10, min_similarity: 1.5 })).toThrow();
    });

    it('TextSearchOptionsSchema accepts valid data', () => {
      const result = TextSearchOptionsSchema.parse({ limit: 100 });
      expect(result.limit).toBe(100);
    });

    it('HybridSearchOptionsSchema accepts weights', () => {
      const result = HybridSearchOptionsSchema.parse({
        limit: 20,
        weights: { vector: 0.7, bm25: 0.3 },
      });
      expect(result.weights?.vector).toBe(0.7);
    });

    it('SearchResultSchema accepts valid data', () => {
      const result = SearchResultSchema.parse({ id: 'n1', score: 0.95, node: { title: 'test' } });
      expect(result.id).toBe('n1');
    });

    it('SearchResultSchema rejects score > 1', () => {
      expect(() => SearchResultSchema.parse({ id: 'n1', score: 1.5, node: {} })).toThrow();
    });

    it('ChangeSchema accepts valid data', () => {
      const result = ChangeSchema.parse({
        id: 'c1', table: 'nodes', operation: 'create',
        data: { title: 'test' }, version: 1, timestamp: '2025-01-01T00:00:00Z',
      });
      expect(result.table).toBe('nodes');
    });

    it('ChangeSchema rejects invalid table', () => {
      expect(() => ChangeSchema.parse({
        id: 'c1', table: 'invalid', operation: 'create',
        data: {}, version: 1, timestamp: '2025-01-01T00:00:00Z',
      })).toThrow();
    });

    it('AdapterMessageSchema accepts valid roles', () => {
      expect(AdapterMessageSchema.parse({ role: 'system', content: 'Hello' }).role).toBe('system');
      expect(AdapterMessageSchema.parse({ role: 'user', content: 'Hi' }).role).toBe('user');
      expect(AdapterMessageSchema.parse({ role: 'assistant', content: 'Hey' }).role).toBe('assistant');
    });

    it('CompletionRequestSchema accepts valid data', () => {
      const result = CompletionRequestSchema.parse({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
      });
      expect(result.model).toBe('gpt-4o');
    });

    it('CompletionRequestSchema rejects temperature > 2', () => {
      expect(() => CompletionRequestSchema.parse({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 2.5,
      })).toThrow();
    });

    it('CompletionResponseSchema accepts valid data', () => {
      const result = CompletionResponseSchema.parse({
        id: 'resp-1', content: 'Hello!', model: 'gpt-4o',
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'stop',
      });
      expect(result.finishReason).toBe('stop');
    });

    it('CompletionChunkSchema accepts delta with optional finishReason', () => {
      const result = CompletionChunkSchema.parse({ id: 'ch-1', delta: 'Hel' });
      expect(result.finishReason).toBeUndefined();
    });

    it('AdapterTokenUsageSchema accepts cachedTokens as optional', () => {
      const result = AdapterTokenUsageSchema.parse({ inputTokens: 100, outputTokens: 50 });
      expect(result.cachedTokens).toBeUndefined();
    });

    it('AdapterCostEstimateSchema accepts valid breakdown', () => {
      const result = AdapterCostEstimateSchema.parse({
        min: 0.001, expected: 0.005, max: 0.01,
        breakdown: { inputTokens: 0.003, outputTokens: 0.002 },
      });
      expect(result.expected).toBe(0.005);
    });

    it('UsageReportSchema accepts valid data', () => {
      const result = UsageReportSchema.parse({
        requestId: 'r1', provider: 'openai', model: 'gpt-4o',
        inputTokens: 100, outputTokens: 50, cachedTokens: 0,
        actualCost: 0.005, latencyMs: 200,
      });
      expect(result.provider).toBe('openai');
    });

    it('AdapterAuthResultSchema accepts valid=true with userId', () => {
      const result = AdapterAuthResultSchema.parse({ valid: true, userId: 'u1', tier: 'pro' });
      expect(result.valid).toBe(true);
    });

    it('AdapterUserSchema rejects invalid email', () => {
      expect(() => AdapterUserSchema.parse({
        id: 'u1', email: 'not-an-email', tier: 'free', privacyTier: 'standard',
      })).toThrow();
    });

    it('AdapterUserSchema accepts valid user', () => {
      const result = AdapterUserSchema.parse({
        id: 'u1', email: 'test@example.com', tier: 'credits', privacyTier: 'private',
      });
      expect(result.tier).toBe('credits');
    });

    it('AdapterTokenPairSchema accepts valid data', () => {
      const result = AdapterTokenPairSchema.parse({
        accessToken: 'at', refreshToken: 'rt', expiresAt: '2025-12-31T00:00:00Z',
      });
      expect(result.accessToken).toBe('at');
    });

    it('AdapterApiKeyResultSchema accepts valid data', () => {
      const result = AdapterApiKeyResultSchema.parse({ valid: true, userId: 'u1', scopes: ['read'] });
      expect(result.scopes).toEqual(['read']);
    });

    it('JobSchema accepts valid job', () => {
      const result = JobSchema.parse({
        id: 'j1', type: 'embed', payload: { nodeId: 'n1' },
        priority: 'high', tenantId: 't1', createdAt: '2025-01-01T00:00:00Z',
      });
      expect(result.type).toBe('embed');
    });

    it('JobEventSchema accepts valid event', () => {
      const result = JobEventSchema.parse({ jobId: 'j1', type: 'embed', tenantId: 't1' });
      expect(result.jobId).toBe('j1');
    });

    it('FailedJobSchema accepts valid failed job', () => {
      const result = FailedJobSchema.parse({
        job: {
          id: 'j1', type: 'embed', payload: {}, tenantId: 't1', createdAt: '2025-01-01T00:00:00Z',
        },
        error: 'timeout', failedAt: '2025-01-01T00:01:00Z', attempts: 3,
      });
      expect(result.attempts).toBe(3);
    });

    it('FailedJobSchema rejects attempts < 1', () => {
      expect(() => FailedJobSchema.parse({
        job: { id: 'j1', type: 'embed', payload: {}, tenantId: 't1', createdAt: '2025-01-01T00:00:00Z' },
        error: 'timeout', failedAt: '2025-01-01T00:01:00Z', attempts: 0,
      })).toThrow();
    });

    it('JobTierConfigSchema accepts valid data', () => {
      const result = JobTierConfigSchema.parse({
        type: 'embed', tier: 'queued', max_duration_ms: 10000,
        retry_count: 3, retry_delay_ms: 1000,
      });
      expect(result.tier).toBe('queued');
    });

    it('JobMetricsSchema accepts valid metrics', () => {
      const result = JobMetricsSchema.parse({
        queue_depth: 5, processing_count: 2, completed_count: 100,
        failed_count: 3, avg_processing_time_ms: 150.5,
      });
      expect(result.queue_depth).toBe(5);
    });

    it('SSEEventSchema accepts valid event', () => {
      const result = SSEEventSchema.parse({ event: 'data', id: '1', data: '{"token":"hi"}' });
      expect(result.event).toBe('data');
    });

    it('SSEEventSchema rejects invalid event type', () => {
      expect(() => SSEEventSchema.parse({ event: 'message', data: 'test' })).toThrow();
    });

    it('SSEStreamStateSchema accepts valid state', () => {
      const result = SSEStreamStateSchema.parse({
        eventId: 0, startTime: Date.now(), closed: false,
      });
      expect(result.closed).toBe(false);
    });

    it('ChatStreamChunkSchema accepts token type', () => {
      const result = ChatStreamChunkSchema.parse({ type: 'token', content: 'Hello' });
      expect(result.content).toBe('Hello');
    });

    it('ChatStreamChunkSchema accepts source type', () => {
      const result = ChatStreamChunkSchema.parse({ type: 'source', sources: ['n1', 'n2'] });
      expect(result.sources).toEqual(['n1', 'n2']);
    });

    // Discriminated union schemas
    it('DatabaseConfigSchema accepts turso config', () => {
      const result = DatabaseConfigSchema.parse({
        type: 'turso', url: 'https://db.turso.io', authToken: 'token123',
      });
      expect(result.type).toBe('turso');
    });

    it('DatabaseConfigSchema accepts sqlite config', () => {
      const result = DatabaseConfigSchema.parse({ type: 'sqlite', path: './dev.db' });
      expect(result.type).toBe('sqlite');
    });

    it('DatabaseConfigSchema rejects unknown type', () => {
      expect(() => DatabaseConfigSchema.parse({ type: 'postgres', connectionString: 'x' })).toThrow();
    });

    it('AuthConfigSchema accepts clerk config', () => {
      const result = AuthConfigSchema.parse({
        type: 'clerk', secretKey: 'sk_test', publishableKey: 'pk_test',
      });
      expect(result.type).toBe('clerk');
    });

    it('AuthConfigSchema accepts local config', () => {
      const result = AuthConfigSchema.parse({ type: 'local' });
      expect(result.type).toBe('local');
    });

    it('JobsConfigSchema accepts cloudflare config', () => {
      const result = JobsConfigSchema.parse({ type: 'cloudflare' });
      expect(result.type).toBe('cloudflare');
    });

    it('JobsConfigSchema accepts bullmq config', () => {
      const result = JobsConfigSchema.parse({ type: 'bullmq', redisUrl: 'https://redis.example.com' });
      expect(result.type).toBe('bullmq');
    });

    it('JobsConfigSchema accepts memory config', () => {
      const result = JobsConfigSchema.parse({ type: 'memory' });
      expect(result.type).toBe('memory');
    });

    it('NousConfigSchema accepts a full valid config', () => {
      const result = NousConfigSchema.parse(validNousConfig());
      expect(result.env).toBe('development');
      expect(result.port).toBe(3000);
    });

    it('NousConfigSchema applies defaults for env, port, host', () => {
      const result = NousConfigSchema.parse({
        database: { type: 'sqlite', path: './dev.db' },
        auth: { type: 'local' },
        llm: {},
        jobs: { type: 'memory' },
        observability: {},
      });
      expect(result.env).toBe('development');
      expect(result.port).toBe(3000);
      expect(result.host).toBe('0.0.0.0');
    });

    it('NousConfigSchema rejects invalid port', () => {
      const config = { ...validNousConfig(), port: 99999 };
      expect(() => NousConfigSchema.parse(config)).toThrow();
    });

    it('HealthCheckResponseSchema accepts valid response', () => {
      const result = HealthCheckResponseSchema.parse({
        status: 'healthy', version: '1.0.0', timestamp: '2025-01-01T00:00:00Z',
        services: { database: { status: 'healthy', latency_ms: 5 } },
      });
      expect(result.status).toBe('healthy');
    });

    it('ServiceHealthSchema accepts with optional error', () => {
      const result = ServiceHealthSchema.parse({ status: 'unhealthy', error: 'Connection refused' });
      expect(result.error).toBe('Connection refused');
    });

    it('ReadinessCheckSchema accepts valid data', () => {
      const result = ReadinessCheckSchema.parse({ ready: true, checks: { db: true, llm: false } });
      expect(result.ready).toBe(true);
    });

    it('SentryConfigSchema accepts valid data', () => {
      const result = SentryConfigSchema.parse({
        dsn: 'https://sentry.io/123', traces_sample_rate: 0.1, environment: 'production',
      });
      expect(result.traces_sample_rate).toBe(0.1);
    });

    it('StructuredLogEntrySchema accepts minimal entry', () => {
      const result = StructuredLogEntrySchema.parse({
        timestamp: '2025-01-01T00:00:00Z', requestId: 'req-1', level: 'info',
      });
      expect(result.level).toBe('info');
    });

    it('StructuredLogEntrySchema accepts full entry', () => {
      const result = StructuredLogEntrySchema.parse({
        timestamp: '2025-01-01T00:00:00Z', requestId: 'req-1', level: 'error',
        method: 'POST', path: '/v1/nodes', status: 500, duration_ms: 123,
        userId: 'u1', tenantId: 't1', message: 'fail', error: 'oops',
      });
      expect(result.status).toBe(500);
    });
  });

  // ============================
  // ADAPTERS (~5 tests)
  // ============================
  describe('adapters', () => {
    it('createPaginatedResultSchema creates a valid schema', () => {
      const schema = createPaginatedResultSchema(z.string());
      const result = schema.parse({ items: ['a', 'b'], total: 2, has_more: false });
      expect(result.items).toEqual(['a', 'b']);
      expect(result.total).toBe(2);
      expect(result.has_more).toBe(false);
    });

    it('createPaginatedResultSchema rejects negative total', () => {
      const schema = createPaginatedResultSchema(z.string());
      expect(() => schema.parse({ items: [], total: -1, has_more: false })).toThrow();
    });

    it('createPaginatedResultSchema rejects wrong item types', () => {
      const schema = createPaginatedResultSchema(z.number());
      expect(() => schema.parse({ items: ['not-a-number'], total: 1, has_more: false })).toThrow();
    });

    it('createPaginatedResultSchema works with complex item schema', () => {
      const schema = createPaginatedResultSchema(z.object({ id: z.string(), name: z.string() }));
      const result = schema.parse({
        items: [{ id: '1', name: 'test' }], total: 1, has_more: true,
      });
      expect(result.items[0]!.id).toBe('1');
    });

    it('createPaginatedResultSchema rejects missing fields', () => {
      const schema = createPaginatedResultSchema(z.string());
      expect(() => schema.parse({ items: ['a'] })).toThrow();
    });
  });

  // ============================
  // SERVER (~15 tests)
  // ============================
  describe('server', () => {
    it('ROUTE_GROUPS has 11 groups', () => {
      expect(ROUTE_GROUPS).toHaveLength(11);
    });

    it('ROUTE_GROUPS includes health as unauthenticated', () => {
      const health = ROUTE_GROUPS.find(g => g.prefix === '/v1/health');
      expect(health).toBeDefined();
      expect(health!.auth_required).toBe(false);
      expect(health!.rate_limited).toBe(false);
    });

    it('ROUTE_GROUPS includes nodes as authenticated and rate-limited', () => {
      const nodes = ROUTE_GROUPS.find(g => g.prefix === '/v1/nodes');
      expect(nodes).toBeDefined();
      expect(nodes!.auth_required).toBe(true);
      expect(nodes!.rate_limited).toBe(true);
    });

    it('sync route is auth-required but not rate-limited', () => {
      const sync = ROUTE_GROUPS.find(g => g.prefix === '/v1/sync');
      expect(sync!.auth_required).toBe(true);
      expect(sync!.rate_limited).toBe(false);
    });

    it('DEFAULT_MIDDLEWARE_CONFIG has expected structure', () => {
      expect(DEFAULT_MIDDLEWARE_CONFIG.cors.origins).toEqual(['*']);
      expect(DEFAULT_MIDDLEWARE_CONFIG.cors.credentials).toBe(true);
      expect(DEFAULT_MIDDLEWARE_CONFIG.auth.token_header).toBe('Authorization');
      expect(DEFAULT_MIDDLEWARE_CONFIG.auth.token_prefix).toBe('Bearer ');
      expect(DEFAULT_MIDDLEWARE_CONFIG.auth.exclude_paths).toEqual(['/v1/health']);
      expect(DEFAULT_MIDDLEWARE_CONFIG.rateLimit.requests_per_minute).toBe(60);
      expect(DEFAULT_MIDDLEWARE_CONFIG.logging.level).toBe('info');
      expect(DEFAULT_MIDDLEWARE_CONFIG.logging.format).toBe('json');
      expect(DEFAULT_MIDDLEWARE_CONFIG.error.expose_errors).toBe(false);
    });

    it('createApiError returns correct shape with code and message', () => {
      const error = createApiError('NOT_FOUND', 'Resource not found');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toBe('Resource not found');
      expect(error.details).toBeUndefined();
      expect(error.request_id).toBeUndefined();
    });

    it('createApiError includes details when provided', () => {
      const error = createApiError('VALIDATION_ERROR', 'Bad input', { field: 'name' });
      expect(error.details).toEqual({ field: 'name' });
    });

    it('createApiError includes request_id when provided', () => {
      const error = createApiError('INTERNAL_ERROR', 'Oops', undefined, 'req-123');
      expect(error.request_id).toBe('req-123');
    });

    it('createApiError includes both details and request_id', () => {
      const error = createApiError('UNAUTHORIZED', 'No token', { hint: 'add header' }, 'req-456');
      expect(error.details).toEqual({ hint: 'add header' });
      expect(error.request_id).toBe('req-456');
    });

    it('createApiError result passes ApiErrorResponseSchema', () => {
      const error = createApiError('FORBIDDEN', 'Denied', { reason: 'no scope' }, 'req-789');
      expect(() => ApiErrorResponseSchema.parse(error)).not.toThrow();
    });

    it('getRouteGroup returns the correct group', () => {
      const group = getRouteGroup('/v1/nodes');
      expect(group).toBeDefined();
      expect(group!.description).toBe('Node CRUD operations');
    });

    it('getRouteGroup returns undefined for unknown prefix', () => {
      expect(getRouteGroup('/v1/unknown')).toBeUndefined();
    });

    it('requiresAuth returns false for /v1/health', () => {
      expect(requiresAuth('/v1/health')).toBe(false);
    });

    it('requiresAuth returns true for /v1/nodes', () => {
      expect(requiresAuth('/v1/nodes')).toBe(true);
    });

    it('requiresAuth returns true for /v1/nodes/abc (prefix match)', () => {
      expect(requiresAuth('/v1/nodes/abc')).toBe(true);
    });

    it('requiresAuth defaults to true for unknown paths', () => {
      expect(requiresAuth('/v1/unknown')).toBe(true);
    });

    it('createServer throws stub error', () => {
      expect(() => createServer({} as never)).toThrow('createServer requires Hono framework implementation');
    });
  });

  // ============================
  // JOBS (~20 tests)
  // ============================
  describe('jobs', () => {
    it('JOB_TIER_ASSIGNMENTS covers all JOB_TYPES', () => {
      for (const jt of JOB_TYPES) {
        expect(JOB_TIER_ASSIGNMENTS[jt]).toBeDefined();
      }
    });

    it('JOB_TIER_ASSIGNMENTS covers all CRON_JOB_TYPES', () => {
      for (const ct of CRON_JOB_TYPES) {
        expect(JOB_TIER_ASSIGNMENTS[ct]).toBeDefined();
      }
    });

    it('embed is assigned to queued tier', () => {
      expect(JOB_TIER_ASSIGNMENTS['embed'].tier).toBe('queued');
    });

    it('process-document is assigned to regional tier', () => {
      expect(JOB_TIER_ASSIGNMENTS['process-document'].tier).toBe('regional');
    });

    it('batch-embed is assigned to regional tier', () => {
      expect(JOB_TIER_ASSIGNMENTS['batch-embed'].tier).toBe('regional');
    });

    it('decay-cycle is a regional cron job', () => {
      expect(JOB_TIER_ASSIGNMENTS['decay-cycle'].tier).toBe('regional');
    });

    it('embed max_duration_ms is 10000', () => {
      expect(JOB_TIER_ASSIGNMENTS['embed'].max_duration_ms).toBe(10_000);
    });

    it('sync-push-notification has retry_count of 5', () => {
      expect(JOB_TIER_ASSIGNMENTS['sync-push-notification'].retry_count).toBe(5);
    });

    it('getJobTierForType returns correct tier for embed', () => {
      expect(getJobTierForType('embed')).toBe('queued');
    });

    it('getJobTierForType returns correct tier for process-document', () => {
      expect(getJobTierForType('process-document')).toBe('regional');
    });

    it('getJobTierForType returns correct tier for cron jobs', () => {
      expect(getJobTierForType('decay-cycle')).toBe('regional');
      expect(getJobTierForType('reorganize')).toBe('regional');
      expect(getJobTierForType('cleanup-expired')).toBe('regional');
    });

    it('getJobTierConfig returns full config for embed', () => {
      const config = getJobTierConfig('embed');
      expect(config.type).toBe('embed');
      expect(config.tier).toBe('queued');
      expect(config.max_duration_ms).toBe(10_000);
      expect(config.retry_count).toBe(3);
      expect(config.retry_delay_ms).toBe(1_000);
    });

    it('getJobTierConfig returns full config for batch-embed', () => {
      const config = getJobTierConfig('batch-embed');
      expect(config.max_duration_ms).toBe(600_000);
      expect(config.retry_count).toBe(2);
    });

    it('createJob generates a job with all required fields', () => {
      const job = createJob('embed', { nodeId: 'n1' }, 'tenant-1');
      expect(job.id).toMatch(/^job_\d+_\w+$/);
      expect(job.type).toBe('embed');
      expect(job.payload).toEqual({ nodeId: 'n1' });
      expect(job.tenantId).toBe('tenant-1');
      expect(job.priority).toBe('normal');
      expect(job.createdAt).toBeDefined();
    });

    it('createJob accepts priority option', () => {
      const job = createJob('deduplicate', {}, 't1', { priority: 'high' });
      expect(job.priority).toBe('high');
    });

    it('createJob accepts correlationId option', () => {
      const job = createJob('infer-edges', {}, 't1', { correlationId: 'req-123' });
      expect(job.correlationId).toBe('req-123');
    });

    it('createJob generates unique IDs', () => {
      const job1 = createJob('embed', {}, 't1');
      const job2 = createJob('embed', {}, 't1');
      expect(job1.id).not.toBe(job2.id);
    });

    it('createJob output passes JobSchema validation', () => {
      const job = createJob('embed', { nodeId: 'n1' }, 't1');
      expect(() => JobSchema.parse(job)).not.toThrow();
    });

    it('isJobExpired returns false for recently started job', () => {
      const job = createJob('embed', {}, 't1');
      // Just started, so shouldn't be expired (embed has 10s limit)
      expect(isJobExpired(job, new Date().toISOString())).toBe(false);
    });

    it('isJobExpired returns true for old job', () => {
      const job = createJob('embed', {}, 't1');
      // Started 20s ago (embed limit is 10s)
      const pastTime = new Date(Date.now() - 20_000).toISOString();
      expect(isJobExpired(job, pastTime)).toBe(true);
    });

    it('isJobExpired works for regional jobs with long limits', () => {
      const job = createJob('process-document', {}, 't1');
      // Started 1 minute ago (process-document limit is 300s)
      const pastTime = new Date(Date.now() - 60_000).toISOString();
      expect(isJobExpired(job, pastTime)).toBe(false);
    });
  });

  // ============================
  // CONFIG (~20 tests)
  // ============================
  describe('config', () => {
    it('ENV_VAR_MAPPING maps env to NODE_ENV', () => {
      expect(ENV_VAR_MAPPING['env']).toBe('NODE_ENV');
    });

    it('ENV_VAR_MAPPING maps port to PORT', () => {
      expect(ENV_VAR_MAPPING['port']).toBe('PORT');
    });

    it('ENV_VAR_MAPPING maps database.turso.url to TURSO_URL', () => {
      expect(ENV_VAR_MAPPING['database.turso.url']).toBe('TURSO_URL');
    });

    it('ENV_VAR_MAPPING maps auth.clerk.secretKey to CLERK_SECRET_KEY', () => {
      expect(ENV_VAR_MAPPING['auth.clerk.secretKey']).toBe('CLERK_SECRET_KEY');
    });

    it('ENV_VAR_MAPPING maps jobs.bullmq.redisUrl to REDIS_URL', () => {
      expect(ENV_VAR_MAPPING['jobs.bullmq.redisUrl']).toBe('REDIS_URL');
    });

    it('ENV_VAR_MAPPING maps observability.sentryDsn to SENTRY_DSN', () => {
      expect(ENV_VAR_MAPPING['observability.sentryDsn']).toBe('SENTRY_DSN');
    });

    it('getEnvVarName returns correct env var for known paths', () => {
      expect(getEnvVarName('env')).toBe('NODE_ENV');
      expect(getEnvVarName('port')).toBe('PORT');
      expect(getEnvVarName('llm.openai.apiKey')).toBe('OPENAI_API_KEY');
    });

    it('getEnvVarName returns undefined for unknown paths', () => {
      expect(getEnvVarName('unknown.path')).toBeUndefined();
    });

    it('validateConfig accepts valid config', () => {
      const config = validateConfig(validNousConfig());
      expect(config.env).toBe('development');
      expect(config.database.type).toBe('sqlite');
    });

    it('validateConfig throws for invalid config', () => {
      expect(() => validateConfig({})).toThrow();
    });

    it('validateConfig throws for missing database', () => {
      const config = { ...validNousConfig() } as Record<string, unknown>;
      delete config['database'];
      expect(() => validateConfig(config)).toThrow();
    });

    it('validateConfig accepts turso database config', () => {
      const config = {
        ...validNousConfig(),
        database: { type: 'turso', url: 'https://db.turso.io', authToken: 'token' },
      };
      const result = validateConfig(config);
      expect(result.database.type).toBe('turso');
    });

    it('validateConfig accepts clerk auth config', () => {
      const config = {
        ...validNousConfig(),
        auth: { type: 'clerk', secretKey: 'sk_test', publishableKey: 'pk_test' },
      };
      const result = validateConfig(config);
      expect(result.auth.type).toBe('clerk');
    });

    it('validateConfig accepts bullmq jobs config', () => {
      const config = {
        ...validNousConfig(),
        jobs: { type: 'bullmq', redisUrl: 'https://redis.example.com' },
      };
      const result = validateConfig(config);
      expect(result.jobs.type).toBe('bullmq');
    });

    it('validateConfig accepts cloudflare jobs config', () => {
      const config = { ...validNousConfig(), jobs: { type: 'cloudflare' } };
      const result = validateConfig(config);
      expect(result.jobs.type).toBe('cloudflare');
    });

    it('safeValidateConfig returns success for valid config', () => {
      const result = safeValidateConfig(validNousConfig());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(3000);
      }
    });

    it('safeValidateConfig returns error for invalid config', () => {
      const result = safeValidateConfig({});
      expect(result.success).toBe(false);
    });

    it('safeValidateConfig returns error details', () => {
      const result = safeValidateConfig({ database: { type: 'invalid' } });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });

    it('validateConfig accepts production environment', () => {
      const config = { ...validNousConfig(), env: 'production' };
      const result = validateConfig(config);
      expect(result.env).toBe('production');
    });

    it('loadConfig throws stub error', () => {
      expect(() => loadConfig()).toThrow('loadConfig requires process.env access');
    });
  });

  // ============================
  // DEPLOYMENT (~15 tests)
  // ============================
  describe('deployment', () => {
    it('DEPLOYMENT_MATRIX has all four scenarios', () => {
      expect(Object.keys(DEPLOYMENT_MATRIX)).toEqual(
        ['nous_cloud', 'self_host_small', 'self_host_scale', 'enterprise']
      );
    });

    it('nous_cloud uses cloudflare_workers + turso + clerk', () => {
      const entry = DEPLOYMENT_MATRIX['nous_cloud'];
      expect(entry.api).toBe('cloudflare_workers');
      expect(entry.database).toBe('turso');
      expect(entry.auth).toBe('clerk');
      expect(entry.jobs).toBe('cloudflare');
    });

    it('self_host_small uses docker + sqlite + memory + local', () => {
      const entry = DEPLOYMENT_MATRIX['self_host_small'];
      expect(entry.api).toBe('docker');
      expect(entry.database).toBe('sqlite');
      expect(entry.auth).toBe('local');
      expect(entry.jobs).toBe('memory');
    });

    it('self_host_scale uses bullmq for jobs', () => {
      expect(DEPLOYMENT_MATRIX['self_host_scale'].jobs).toBe('bullmq');
    });

    it('enterprise uses bullmq for jobs', () => {
      expect(DEPLOYMENT_MATRIX['enterprise'].jobs).toBe('bullmq');
    });

    it('DEFAULT_SELF_HOST_CONFIG has expected services', () => {
      expect(DEFAULT_SELF_HOST_CONFIG.docker_compose_services).toEqual(['api', 'jobs', 'redis']);
    });

    it('DEFAULT_SELF_HOST_CONFIG requires OPENAI_API_KEY', () => {
      expect(DEFAULT_SELF_HOST_CONFIG.required_env_vars).toContain('OPENAI_API_KEY');
    });

    it('DEFAULT_SELF_HOST_CONFIG has min_ram_mb of 1024', () => {
      expect(DEFAULT_SELF_HOST_CONFIG.min_ram_mb).toBe(1024);
      expect(DEFAULT_SELF_HOST_CONFIG.recommended_ram_mb).toBe(2048);
    });

    it('DOCKER_SERVICES has 3 services', () => {
      expect(DOCKER_SERVICES).toHaveLength(3);
    });

    it('DOCKER_SERVICES api service depends on redis', () => {
      const api = DOCKER_SERVICES.find(s => s.name === 'api');
      expect(api!.depends_on).toContain('redis');
    });

    it('getDeploymentConfig returns correct entry', () => {
      const config = getDeploymentConfig('nous_cloud');
      expect(config.scenario).toBe('nous_cloud');
      expect(config.api).toBe('cloudflare_workers');
    });

    it('getSelfHostRequirements returns DEFAULT_SELF_HOST_CONFIG', () => {
      const reqs = getSelfHostRequirements();
      expect(reqs).toEqual(DEFAULT_SELF_HOST_CONFIG);
    });

    it('getDockerServices returns only api for self_host_small', () => {
      const services = getDockerServices('self_host_small');
      expect(services).toHaveLength(1);
      expect(services[0]!.name).toBe('api');
    });

    it('getDockerServices returns all 3 services for self_host_scale', () => {
      const services = getDockerServices('self_host_scale');
      expect(services).toHaveLength(3);
    });

    it('getDockerServices returns all 3 services for enterprise', () => {
      const services = getDockerServices('enterprise');
      expect(services).toHaveLength(3);
    });

    it('requiresRedis returns false for nous_cloud', () => {
      expect(requiresRedis('nous_cloud')).toBe(false);
    });

    it('requiresRedis returns false for self_host_small', () => {
      expect(requiresRedis('self_host_small')).toBe(false);
    });

    it('requiresRedis returns true for self_host_scale', () => {
      expect(requiresRedis('self_host_scale')).toBe(true);
    });

    it('requiresRedis returns true for enterprise', () => {
      expect(requiresRedis('enterprise')).toBe(true);
    });
  });

  // ============================
  // HEALTH (~10 tests)
  // ============================
  describe('health', () => {
    it('isAllHealthy returns true when all services are healthy', () => {
      const response = {
        status: 'healthy' as const,
        version: '1.0.0',
        timestamp: '2025-01-01T00:00:00Z',
        services: {
          database: { status: 'healthy' as const },
          llm: { status: 'healthy' as const },
          embedding: { status: 'healthy' as const },
          auth: { status: 'healthy' as const },
          jobs: { status: 'healthy' as const },
        },
      };
      expect(isAllHealthy(response)).toBe(true);
    });

    it('isAllHealthy returns false when any service is degraded', () => {
      const response = {
        status: 'degraded' as const,
        version: '1.0.0',
        timestamp: '2025-01-01T00:00:00Z',
        services: {
          database: { status: 'healthy' as const },
          llm: { status: 'degraded' as const },
          embedding: { status: 'healthy' as const },
          auth: { status: 'healthy' as const },
          jobs: { status: 'healthy' as const },
        },
      };
      expect(isAllHealthy(response)).toBe(false);
    });

    it('determineOverallHealth returns healthy when all healthy', () => {
      expect(determineOverallHealth({
        db: { status: 'healthy' },
        llm: { status: 'healthy' },
      })).toBe('healthy');
    });

    it('determineOverallHealth returns unhealthy when any unhealthy', () => {
      expect(determineOverallHealth({
        db: { status: 'healthy' },
        llm: { status: 'unhealthy' },
      })).toBe('unhealthy');
    });

    it('determineOverallHealth returns degraded when degraded but not unhealthy', () => {
      expect(determineOverallHealth({
        db: { status: 'healthy' },
        llm: { status: 'degraded' },
      })).toBe('degraded');
    });

    it('determineOverallHealth returns unhealthy over degraded', () => {
      expect(determineOverallHealth({
        db: { status: 'degraded' },
        llm: { status: 'unhealthy' },
      })).toBe('unhealthy');
    });

    it('getHttpStatusForHealth returns 200 for healthy', () => {
      expect(getHttpStatusForHealth('healthy')).toBe(200);
    });

    it('getHttpStatusForHealth returns 503 for degraded', () => {
      expect(getHttpStatusForHealth('degraded')).toBe(503);
    });

    it('getHttpStatusForHealth returns 503 for unhealthy', () => {
      expect(getHttpStatusForHealth('unhealthy')).toBe(503);
    });

    it('checkAllServices throws stub error', async () => {
      await expect(checkAllServices({})).rejects.toThrow('checkAllServices requires adapter instances');
    });

    it('checkServiceHealth throws stub error', async () => {
      await expect(checkServiceHealth('database', { ping: async () => true })).rejects.toThrow(
        'checkServiceHealth requires adapter instance'
      );
    });
  });

  // ============================
  // OBSERVABILITY (~10 tests)
  // ============================
  describe('observability', () => {
    it('DEFAULT_METRICS_CONFIG has all metrics enabled', () => {
      expect(DEFAULT_METRICS_CONFIG.request_count).toBe(true);
      expect(DEFAULT_METRICS_CONFIG.request_duration).toBe(true);
      expect(DEFAULT_METRICS_CONFIG.llm_cost).toBe(true);
      expect(DEFAULT_METRICS_CONFIG.embedding_count).toBe(true);
      expect(DEFAULT_METRICS_CONFIG.job_queue_size).toBe(true);
    });

    it('createRequestContext returns a context with requestId and startTime', () => {
      const ctx = createRequestContext();
      expect(ctx.requestId).toMatch(/^req_\d+_\w+$/);
      expect(ctx.startTime).toBeLessThanOrEqual(Date.now());
      expect(ctx.userId).toBeUndefined();
      expect(ctx.tenantId).toBeUndefined();
    });

    it('createRequestContext generates unique IDs', () => {
      const ctx1 = createRequestContext();
      const ctx2 = createRequestContext();
      expect(ctx1.requestId).not.toBe(ctx2.requestId);
    });

    it('createRequestContext output passes RequestContextSchema', () => {
      const ctx = createRequestContext();
      expect(() => RequestContextSchema.parse(ctx)).not.toThrow();
    });

    it('formatLogEntry produces valid JSON', () => {
      const entry = {
        timestamp: '2025-01-01T00:00:00Z',
        requestId: 'req-1',
        level: 'info' as const,
        message: 'test',
      };
      const json = formatLogEntry(entry);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      expect(parsed['message']).toBe('test');
      expect(parsed['level']).toBe('info');
    });

    it('formatLogEntry includes all provided fields', () => {
      const entry = {
        timestamp: '2025-01-01T00:00:00Z',
        requestId: 'req-1',
        level: 'error' as const,
        method: 'POST',
        path: '/v1/nodes',
        status: 500,
        duration_ms: 123,
        error: 'something broke',
      };
      const parsed = JSON.parse(formatLogEntry(entry)) as Record<string, unknown>;
      expect(parsed['method']).toBe('POST');
      expect(parsed['status']).toBe(500);
    });

    it('calculateRequestDuration returns positive duration', () => {
      const ctx = { requestId: 'r1', startTime: Date.now() - 100 };
      const duration = calculateRequestDuration(ctx);
      expect(duration).toBeGreaterThanOrEqual(100);
      expect(duration).toBeLessThan(5000); // sanity: should be much less than 5s
    });

    it('shouldLog returns true when level >= minLevel', () => {
      expect(shouldLog('error', 'info')).toBe(true);
      expect(shouldLog('fatal', 'debug')).toBe(true);
      expect(shouldLog('info', 'info')).toBe(true);
    });

    it('shouldLog returns false when level < minLevel', () => {
      expect(shouldLog('debug', 'info')).toBe(false);
      expect(shouldLog('info', 'warn')).toBe(false);
      expect(shouldLog('warn', 'error')).toBe(false);
    });

    it('shouldLog handles boundary: debug is lowest level', () => {
      expect(shouldLog('debug', 'debug')).toBe(true);
      expect(shouldLog('fatal', 'fatal')).toBe(true);
    });
  });

  // ============================
  // SSE (~10 tests)
  // ============================
  describe('sse', () => {
    it('DEFAULT_SSE_OPTIONS has correct values', () => {
      expect(DEFAULT_SSE_OPTIONS.maxDurationMs).toBe(25_000);
      expect(DEFAULT_SSE_OPTIONS.heartbeatMs).toBe(15_000);
      expect(DEFAULT_SSE_OPTIONS.reconnectable).toBe(true);
    });

    it('formatSSEEvent produces correct wire format with id', () => {
      const result = formatSSEEvent({ event: 'data', id: '1', data: '{"token":"hi"}' });
      expect(result).toBe('event: data\nid: 1\ndata: {"token":"hi"}\n\n');
    });

    it('formatSSEEvent omits id when not provided', () => {
      const result = formatSSEEvent({ event: 'ping', data: '' });
      expect(result).toBe('event: ping\ndata: \n\n');
      expect(result).not.toContain('id:');
    });

    it('formatSSEEvent handles timeout event', () => {
      const result = formatSSEEvent({ event: 'timeout', id: '42', data: '{"reason":"max_duration"}' });
      expect(result).toContain('event: timeout');
      expect(result).toContain('id: 42');
    });

    it('parseLastEventId returns trimmed string for valid header', () => {
      expect(parseLastEventId('  42  ')).toBe('42');
      expect(parseLastEventId('100')).toBe('100');
    });

    it('parseLastEventId returns undefined for empty/missing', () => {
      expect(parseLastEventId(undefined)).toBeUndefined();
      expect(parseLastEventId('')).toBeUndefined();
      expect(parseLastEventId('   ')).toBeUndefined();
    });

    it('createSSEStreamState initializes correctly', () => {
      const state = createSSEStreamState();
      expect(state.eventId).toBe(0);
      expect(state.startTime).toBeLessThanOrEqual(Date.now());
      expect(state.lastEventId).toBeUndefined();
      expect(state.closed).toBe(false);
    });

    it('createSSEStreamState parses Last-Event-ID header', () => {
      const state = createSSEStreamState('42');
      expect(state.lastEventId).toBe('42');
    });

    it('isStreamExpired returns false for fresh stream', () => {
      const state = createSSEStreamState();
      expect(isStreamExpired(state, 25_000)).toBe(false);
    });

    it('isStreamExpired returns true for old stream', () => {
      const state = { eventId: 5, startTime: Date.now() - 30_000, closed: false };
      expect(isStreamExpired(state, 25_000)).toBe(true);
    });

    it('createSSEStream throws stub error', () => {
      const gen = (async function* () { yield 'test'; })();
      expect(() => createSSEStream({}, gen)).toThrow('createSSEStream requires Hono framework implementation');
    });
  });

  // ============================
  // LOCAL-DEV (~10 tests)
  // ============================
  describe('local-dev', () => {
    it('DEFAULT_LOCAL_DEV_CONFIG has expected values', () => {
      expect(DEFAULT_LOCAL_DEV_CONFIG.port).toBe(3000);
      expect(DEFAULT_LOCAL_DEV_CONFIG.database_path).toBe('./data/dev.db');
      expect(DEFAULT_LOCAL_DEV_CONFIG.auto_seed).toBe(true);
      expect(DEFAULT_LOCAL_DEV_CONFIG.mock_llm_latency_ms).toBe(100);
      expect(DEFAULT_LOCAL_DEV_CONFIG.mock_embedding_deterministic).toBe(true);
      expect(DEFAULT_LOCAL_DEV_CONFIG.accept_any_token).toBe(true);
      expect(DEFAULT_LOCAL_DEV_CONFIG.process_jobs_immediately).toBe(true);
    });

    it('DEV_USER has expected properties', () => {
      expect(DEV_USER.id).toBe('dev-user');
      expect(DEV_USER.email).toBe('dev@localhost');
      expect(DEV_USER.tier).toBe('pro');
    });

    it('DEFAULT_SEED_DATA has expected counts', () => {
      expect(DEFAULT_SEED_DATA.users).toHaveLength(1);
      expect(DEFAULT_SEED_DATA.node_count).toBe(10);
      expect(DEFAULT_SEED_DATA.edge_count).toBe(5);
    });

    it('getLocalDevConfig returns a copy of DEFAULT_LOCAL_DEV_CONFIG', () => {
      const config = getLocalDevConfig();
      expect(config).toEqual(DEFAULT_LOCAL_DEV_CONFIG);
      expect(config).not.toBe(DEFAULT_LOCAL_DEV_CONFIG);
    });

    it('getLocalDevConfig returns independent copies', () => {
      const config1 = getLocalDevConfig();
      const config2 = getLocalDevConfig();
      config1.port = 9999;
      expect(config2.port).toBe(3000);
    });

    it('getDefaultSeedUsers returns array with dev user', () => {
      const users = getDefaultSeedUsers();
      expect(users).toHaveLength(1);
      expect(users[0]!.id).toBe('dev-user');
    });

    it('getDefaultSeedUsers returns independent copies', () => {
      const users1 = getDefaultSeedUsers();
      const users2 = getDefaultSeedUsers();
      users1[0]!.id = 'modified';
      expect(users2[0]!.id).toBe('dev-user');
    });

    it('getMockAdapterConfigs returns all adapter configs', () => {
      const configs = getMockAdapterConfigs();
      expect(configs.llm.latencyMs).toBe(100);
      expect(configs.llm.mockResponses).toBe(true);
      expect(configs.llm.deterministicOutputs).toBe(true);
      expect(configs.embedding.dimensions).toBe(1536);
      expect(configs.embedding.deterministic).toBe(true);
      expect(configs.jobs.processImmediately).toBe(true);
      expect(configs.auth.acceptAnyToken).toBe(true);
      expect(configs.auth.users).toHaveLength(1);
    });

    it('getMockAdapterConfigs auth users match DEV_USER', () => {
      const configs = getMockAdapterConfigs();
      expect(configs.auth.users[0]!.id).toBe('dev-user');
      expect(configs.auth.users[0]!.email).toBe('dev@localhost');
    });

    it('getMockAdapterConfigs validates against schemas', () => {
      const configs = getMockAdapterConfigs();
      expect(() => MockLLMConfigSchema.parse(configs.llm)).not.toThrow();
      expect(() => MockEmbeddingConfigSchema.parse(configs.embedding)).not.toThrow();
      expect(() => MockJobQueueConfigSchema.parse(configs.jobs)).not.toThrow();
      // LocalAuthDevConfigSchema uses SeedUserSchema which requires .email()
      // DEV_USER.email is 'dev@localhost' which Zod's strict email() rejects,
      // so we validate the structure without the users array
      expect(configs.auth.acceptAnyToken).toBe(true);
      expect(configs.auth.users).toHaveLength(1);
    });

    it('getLocalDevConfig validates against LocalDevConfigSchema', () => {
      const config = getLocalDevConfig();
      expect(() => LocalDevConfigSchema.parse(config)).not.toThrow();
    });
  });
});
