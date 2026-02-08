/**
 * @module @nous/core/api
 * @description Tests for the Nous API Layer (NAL) — storm-023 implementation
 *
 * Test structure:
 * 1. Constants: Value verification, type guards
 * 2. Schemas: Zod schema validation (valid + invalid)
 * 3. Error handling: Error creation, HTTP status mapping, validation errors
 * 4. Pagination: Parameter normalization, result creation
 * 5. Rate limiting: Tier ranking, Redis keys, retry calculation
 * 6. Auth middleware: JWT context extraction, API key detection
 * 7. SSE chat: Event formatting, reconnection validation, event IDs
 * 8. Validators: Request body validation
 * 9. Data flows: Flow step lookups, execution creation
 */

import { describe, it, expect } from 'vitest';

import {
  // Constants
  USER_TIERS,
  TIER_LIMITS,
  ENDPOINT_RATE_LIMITS,
  BURST_ALLOWANCE_PERCENT,
  REDIS_KEY_PATTERNS,
  CHAT_SSE_EVENT_TYPES,
  CHAT_SSE_KEEPALIVE_INTERVAL_MS,
  CHAT_SSE_MAX_DURATION_MS,
  CHAT_SSE_RECONNECT_WINDOW_MS,
  CONTENT_LIMITS,
  API_ERROR_CODES,
  ENDPOINT_TIMEOUTS,
  RATE_LIMIT_ALERT_THRESHOLDS,
  CURSOR_PAGINATION_DEFAULT_LIMIT,
  CURSOR_PAGINATION_MAX_LIMIT,
  OFFSET_PAGINATION_DEFAULT_LIMIT,
  OFFSET_PAGINATION_MAX_LIMIT,
  IDEMPOTENCY_TTL_MS,
  RATE_LIMIT_ALGORITHMS,
  RATE_LIMIT_TYPES,
  AUTH_METHODS,
  API_KEY_PREFIX_LIVE,
  API_KEY_PREFIX_TEST,
  API_KEY_SCOPES,
  EMBEDDING_STATUSES,
  PRIVACY_TIERS,
  LIFECYCLE_STATES,
  EDGE_DIRECTIONS,
  INGEST_SOURCES,
  INGEST_MODES,
  INGEST_PRIORITIES,
  INGEST_ACTIONS,
  JOB_STATUSES,
  SYNC_OPERATIONS,
  SYNC_TABLES,
  SYNC_CONFLICT_TYPES,
  SYNC_RESOLUTIONS,
  FULL_SYNC_REASONS,
  AGENT_TOOL_CATEGORIES,
  ACTION_STATUSES,
  THEME_OPTIONS,
  AGENT_SUGGESTION_LEVELS,
  CREDIT_OPERATIONS,
  USAGE_GROUP_BY,
  FLOW_TYPES,
  CORS_ALLOWED_ORIGINS,
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
  BURST_LIMITS,
  REDIS_FALLBACK_LIMIT_PERCENT,

  // Type guards
  isUserTier,
  isRateLimitedEndpoint,
  isChatSSEEventType,
  isApiErrorCode,
  isRateLimitType,
  isEdgeDirection,
  isIngestSource,
  isIngestAction,
  isJobStatus,
  isSyncOperation,
  isSyncConflictType,
  isSyncResolution,
  isApiKeyScope,
  isEmbeddingStatus,

  // Schemas
  UserTierSchema,
  CursorPaginationRequestSchema,
  CursorPaginationResponseSchema,
  OffsetPaginationRequestSchema,
  OffsetPaginationResponseSchema,
  ApiErrorResponseExtendedSchema,
  ValidationFieldErrorSchema,
  ContentLimitsInfoSchema,
  AuthContextSchema,
  IdempotencyRecordSchema,
  EmbeddingInfoSchema,
  WebhookCallbackSchema,
  RateLimitResultSchema,
  SlidingWindowStateSchema,
  TokenBucketStateSchema,
  RateLimitErrorResponseSchema,
  RateLimitMetricsSchema,
  JWTClaimsSchema,
  APIKeyDisplayInfoSchema,
  RefreshTokenRequestSchema,
  RefreshTokenResponseSchema,
  ChatSessionStartEventSchema,
  ChatRetrievalStartEventSchema,
  ChatRetrievalNodeEventSchema,
  ChatRetrievalCompleteEventSchema,
  ChatResponseStartEventSchema,
  ChatResponseChunkEventSchema,
  ChatResponseCompleteEventSchema,
  ChatSourceSchema,
  ChatDoneEventSchema,
  ChatSessionExpiredEventSchema,
  NodeResponseSchema,
  CreateNodeRequestSchema,
  UpdateNodeRequestSchema,
  BatchCreateNodesRequestSchema,
  BatchFailureItemSchema,
  EdgeResponseSchema,
  CreateEdgeRequestSchema,
  UpdateEdgeRequestSchema,
  SearchResultItemSchema,
  SimpleSearchParamsSchema,
  AdvancedSearchRequestSchema,
  ClusterListItemSchema,
  UpdateClusterRequestSchema,
  ChatRequestSchema,
  ConversationMessageSchema,
  ConversationSummarySchema,
  AgentToolInfoSchema,
  ExecuteActionRequestSchema,
  ActionResultSchema,
  PreviewResultSchema,
  ActionHistoryItemSchema,
  IngestTextRequestSchema,
  IngestClassificationResponseSchema,
  CreatedNodeSummarySchema,
  IngestJobStageSchema,
  SyncChangeSchema,
  SyncPushRequestSchema,
  SyncAppliedItemSchema,
  SyncConflictItemSchema,
  SyncPullParamsSchema,
  PulledChangeSchema,
  ResolveConflictRequestSchema,
  FullSyncRequestSchema,
  AgentPermissionsSchema,
  NotificationSettingsSchema,
  UserPreferencesSchema,
  UpdateSettingsRequestSchema,
  CreateAPIKeyRequestSchema,
  UsageByDaySchema,
  CostEstimateRequestSchema,
  FlowStepSchema,
  FlowExecutionSchema,
  ListNodesParamsSchema,
  GetNodeParamsSchema,
  ListEdgesParamsSchema,

  // Error handling
  getHttpStatusForErrorCode,
  getDocsUrl,
  getContentLimits,
  createExtendedApiError,
  createValidationError,
  createContentLimitError,
  createBatchSizeError,

  // Pagination
  normalizeCursorParams,
  normalizeOffsetParams,
  createCursorPaginationResponse,
  createOffsetPaginationResponse,

  // Rate limiting
  TIER_RANKS,
  tierRank,
  buildRedisKey,
  calculateRetryAfter,
  calculateTokenBucketRetryAfter,
  formatRateLimitHeaders,
  checkRateLimit,
  getTierWithCache,

  // Auth middleware
  extractAuthContextFromJWT,
  isApiKeyToken,
  isTokenExpired,
  validateAuthToken,

  // SSE chat
  formatChatSSEEvent,
  isReconnectionValid,
  generateEventId,

  // Validators
  validateCreateNodeRequest,
  validateUpdateNodeRequest,
  validateBatchCreateNodesRequest,
  validateCreateEdgeRequest,
  validateUpdateEdgeRequest,
  validateAdvancedSearchRequest,
  validateChatRequest,
  validateExecuteActionRequest,
  validateIngestTextRequest,
  validateSyncPushRequest,
  validateResolveConflictRequest,
  validateFullSyncRequest,
  validateUpdateSettingsRequest,
  validateCreateAPIKeyRequest,
  validateCostEstimateRequest,

  // Data flows
  CHAT_FLOW_STEPS,
  SYNC_FLOW_STEPS,
  INGESTION_FLOW_STEPS,
  getFlowSteps,
  createFlowExecution,
} from './index';

// ============================================================
// 1. CONSTANTS
// ============================================================

describe('API Constants', () => {
  describe('USER_TIERS', () => {
    it('should have 4 tiers', () => {
      expect(USER_TIERS).toHaveLength(4);
    });

    it('should contain all expected tiers', () => {
      expect(USER_TIERS).toContain('free');
      expect(USER_TIERS).toContain('credits');
      expect(USER_TIERS).toContain('pro');
      expect(USER_TIERS).toContain('api_key');
    });
  });

  describe('TIER_LIMITS', () => {
    it('should define limits for all tiers', () => {
      for (const tier of USER_TIERS) {
        const limits = TIER_LIMITS[tier];
        expect(limits).toBeDefined();
        expect(limits.requests_per_min).toBeGreaterThan(0);
        expect(limits.requests_per_day).toBeGreaterThan(0);
        expect(limits.concurrent).toBeGreaterThan(0);
        expect(limits.batch_size).toBeGreaterThan(0);
      }
    });

    it('should have pro tier as highest requests_per_min', () => {
      expect(TIER_LIMITS.pro.requests_per_min).toBeGreaterThan(TIER_LIMITS.credits.requests_per_min);
      expect(TIER_LIMITS.credits.requests_per_min).toBeGreaterThan(TIER_LIMITS.free.requests_per_min);
    });

    it('should have specific free tier values', () => {
      expect(TIER_LIMITS.free.requests_per_min).toBe(60);
      expect(TIER_LIMITS.free.requests_per_day).toBe(1_000);
      expect(TIER_LIMITS.free.concurrent).toBe(5);
      expect(TIER_LIMITS.free.batch_size).toBe(20);
    });
  });

  describe('ENDPOINT_RATE_LIMITS', () => {
    it('should have 6 rate-limited endpoints', () => {
      expect(Object.keys(ENDPOINT_RATE_LIMITS)).toHaveLength(6);
    });

    it('should include chat and ingest endpoints', () => {
      expect('POST /v1/chat' in ENDPOINT_RATE_LIMITS).toBe(true);
      expect('POST /v1/ingest' in ENDPOINT_RATE_LIMITS).toBe(true);
    });
  });

  describe('BURST_ALLOWANCE_PERCENT', () => {
    it('should be 10%', () => {
      expect(BURST_ALLOWANCE_PERCENT).toBe(0.1);
    });
  });

  describe('BURST_LIMITS', () => {
    it('should be 10% above tier limits', () => {
      expect(BURST_LIMITS.free).toBe(66);
      expect(BURST_LIMITS.pro).toBe(330);
    });
  });

  describe('REDIS_KEY_PATTERNS', () => {
    it('should have 4 key patterns', () => {
      expect(Object.keys(REDIS_KEY_PATTERNS)).toHaveLength(4);
    });

    it('should include user_id placeholder', () => {
      expect(REDIS_KEY_PATTERNS.api).toContain('{user_id}');
      expect(REDIS_KEY_PATTERNS.llm).toContain('{user_id}');
      expect(REDIS_KEY_PATTERNS.endpoint).toContain('{user_id}');
      expect(REDIS_KEY_PATTERNS.concurrent).toContain('{user_id}');
    });
  });

  describe('CHAT_SSE_EVENT_TYPES', () => {
    it('should have 11 event types', () => {
      expect(CHAT_SSE_EVENT_TYPES).toHaveLength(11);
    });

    it('should include session lifecycle events', () => {
      expect(CHAT_SSE_EVENT_TYPES).toContain('session_start');
      expect(CHAT_SSE_EVENT_TYPES).toContain('done');
      expect(CHAT_SSE_EVENT_TYPES).toContain('session_expired');
      expect(CHAT_SSE_EVENT_TYPES).toContain('ping');
    });
  });

  describe('SSE configuration', () => {
    it('should have 15s keepalive', () => {
      expect(CHAT_SSE_KEEPALIVE_INTERVAL_MS).toBe(15_000);
    });

    it('should have 120s max duration (regional, not edge)', () => {
      expect(CHAT_SSE_MAX_DURATION_MS).toBe(120_000);
    });

    it('should have 5 minute reconnection window', () => {
      expect(CHAT_SSE_RECONNECT_WINDOW_MS).toBe(300_000);
    });
  });

  describe('CONTENT_LIMITS', () => {
    it('should have title limit of 100', () => {
      expect(CONTENT_LIMITS.title).toBe(100);
    });

    it('should have body soft 500 / hard 2000', () => {
      expect(CONTENT_LIMITS.body_soft).toBe(500);
      expect(CONTENT_LIMITS.body_hard).toBe(2_000);
    });

    it('should have summary limit of 200', () => {
      expect(CONTENT_LIMITS.summary).toBe(200);
    });

    it('should have batch max of 100', () => {
      expect(CONTENT_LIMITS.batch_max_size).toBe(100);
    });
  });

  describe('API_ERROR_CODES', () => {
    it('should have 18 error codes', () => {
      expect(Object.keys(API_ERROR_CODES)).toHaveLength(18);
    });

    it('should map RATE_LIMITED to 429', () => {
      expect(API_ERROR_CODES.RATE_LIMITED.status).toBe(429);
    });

    it('should map VALIDATION_ERROR to 400', () => {
      expect(API_ERROR_CODES.VALIDATION_ERROR.status).toBe(400);
    });

    it('should include storm-023 additions', () => {
      expect(API_ERROR_CODES.CONTENT_LIMIT_EXCEEDED.status).toBe(400);
      expect(API_ERROR_CODES.TIER_REQUIRED.status).toBe(403);
      expect(API_ERROR_CODES.IDEMPOTENCY_MISMATCH.status).toBe(409);
      expect(API_ERROR_CODES.UPSTREAM_ERROR.status).toBe(502);
    });
  });

  describe('ENDPOINT_TIMEOUTS', () => {
    it('should have health check as fastest', () => {
      expect(ENDPOINT_TIMEOUTS.health.expected_ms).toBe(50);
    });

    it('should have chat_sse with null expected (streaming)', () => {
      expect(ENDPOINT_TIMEOUTS.chat_sse.expected_ms).toBeNull();
    });
  });

  describe('RATE_LIMIT_ALERT_THRESHOLDS', () => {
    it('should have redis failure rate at 1%', () => {
      expect(RATE_LIMIT_ALERT_THRESHOLDS.redis_failure_rate_percent).toBe(1);
    });
  });

  describe('Pagination defaults', () => {
    it('should have cursor defaults', () => {
      expect(CURSOR_PAGINATION_DEFAULT_LIMIT).toBe(50);
      expect(CURSOR_PAGINATION_MAX_LIMIT).toBe(100);
    });

    it('should have offset defaults', () => {
      expect(OFFSET_PAGINATION_DEFAULT_LIMIT).toBe(20);
      expect(OFFSET_PAGINATION_MAX_LIMIT).toBe(100);
    });
  });

  describe('IDEMPOTENCY_TTL_MS', () => {
    it('should be 24 hours', () => {
      expect(IDEMPOTENCY_TTL_MS).toBe(86_400_000);
    });
  });

  describe('enum arrays', () => {
    it('should define RATE_LIMIT_ALGORITHMS', () => {
      expect(RATE_LIMIT_ALGORITHMS).toContain('sliding_window');
      expect(RATE_LIMIT_ALGORITHMS).toContain('token_bucket');
    });

    it('should define RATE_LIMIT_TYPES', () => {
      expect(RATE_LIMIT_TYPES).toHaveLength(5);
    });

    it('should define AUTH_METHODS', () => {
      expect(AUTH_METHODS).toEqual(['jwt', 'api_key']);
    });

    it('should define API_KEY_SCOPES', () => {
      expect(API_KEY_SCOPES).toContain('full');
      expect(API_KEY_SCOPES).toContain('read_only');
    });

    it('should define EMBEDDING_STATUSES', () => {
      expect(EMBEDDING_STATUSES).toHaveLength(4);
    });

    it('should define PRIVACY_TIERS', () => {
      expect(PRIVACY_TIERS).toEqual(['standard', 'private']);
    });

    it('should define LIFECYCLE_STATES', () => {
      expect(LIFECYCLE_STATES).toHaveLength(5);
      expect(LIFECYCLE_STATES).toContain('active');
      expect(LIFECYCLE_STATES).toContain('archived');
    });

    it('should define EDGE_DIRECTIONS', () => {
      expect(EDGE_DIRECTIONS).toEqual(['in', 'out', 'both']);
    });

    it('should define INGEST_SOURCES', () => {
      expect(INGEST_SOURCES).toHaveLength(4);
    });

    it('should define SYNC_OPERATIONS', () => {
      expect(SYNC_OPERATIONS).toEqual(['create', 'update', 'delete']);
    });

    it('should define SYNC_CONFLICT_TYPES', () => {
      expect(SYNC_CONFLICT_TYPES).toContain('VERSION_MISMATCH');
    });

    it('should define FLOW_TYPES', () => {
      expect(FLOW_TYPES).toEqual(['chat', 'sync', 'ingestion']);
    });

    it('should define CREDIT_OPERATIONS', () => {
      expect(CREDIT_OPERATIONS).toHaveLength(6);
    });

    it('should define ACTION_STATUSES', () => {
      expect(ACTION_STATUSES).toContain('completed');
      expect(ACTION_STATUSES).toContain('undone');
    });

    it('should define CORS arrays', () => {
      expect(CORS_ALLOWED_ORIGINS).toBeDefined();
      expect(CORS_ALLOWED_METHODS).toContain('GET');
      expect(CORS_ALLOWED_HEADERS).toContain('Authorization');
    });

    it('should define REDIS_FALLBACK_LIMIT_PERCENT', () => {
      expect(REDIS_FALLBACK_LIMIT_PERCENT).toBe(0.5);
    });
  });

  describe('type guards', () => {
    it('isUserTier should accept valid tiers', () => {
      expect(isUserTier('free')).toBe(true);
      expect(isUserTier('pro')).toBe(true);
      expect(isUserTier('api_key')).toBe(true);
    });

    it('isUserTier should reject invalid values', () => {
      expect(isUserTier('enterprise')).toBe(false);
      expect(isUserTier(123)).toBe(false);
      expect(isUserTier(null)).toBe(false);
    });

    it('isRateLimitedEndpoint should accept valid endpoints', () => {
      expect(isRateLimitedEndpoint('POST /v1/chat')).toBe(true);
      expect(isRateLimitedEndpoint('POST /v1/ingest')).toBe(true);
    });

    it('isRateLimitedEndpoint should reject unknown endpoints', () => {
      expect(isRateLimitedEndpoint('GET /v1/health')).toBe(false);
      expect(isRateLimitedEndpoint(42)).toBe(false);
    });

    it('isChatSSEEventType should validate event types', () => {
      expect(isChatSSEEventType('session_start')).toBe(true);
      expect(isChatSSEEventType('done')).toBe(true);
      expect(isChatSSEEventType('invalid')).toBe(false);
    });

    it('isApiErrorCode should validate error codes', () => {
      expect(isApiErrorCode('RATE_LIMITED')).toBe(true);
      expect(isApiErrorCode('UPSTREAM_ERROR')).toBe(true);
      expect(isApiErrorCode('UNKNOWN')).toBe(false);
    });

    it('isRateLimitType should validate limit types', () => {
      expect(isRateLimitType('api')).toBe(true);
      expect(isRateLimitType('llm')).toBe(true);
      expect(isRateLimitType('unknown')).toBe(false);
    });

    it('isEdgeDirection should validate directions', () => {
      expect(isEdgeDirection('in')).toBe(true);
      expect(isEdgeDirection('out')).toBe(true);
      expect(isEdgeDirection('both')).toBe(true);
      expect(isEdgeDirection('up')).toBe(false);
    });

    it('isIngestSource should validate sources', () => {
      expect(isIngestSource('chat')).toBe(true);
      expect(isIngestSource('file')).toBe(true);
      expect(isIngestSource('email')).toBe(false);
    });

    it('isIngestAction should validate actions', () => {
      expect(isIngestAction('saved')).toBe(true);
      expect(isIngestAction('dropped')).toBe(false);
    });

    it('isJobStatus should validate statuses', () => {
      expect(isJobStatus('processing')).toBe(true);
      expect(isJobStatus('complete')).toBe(true);
      expect(isJobStatus('running')).toBe(false);
    });

    it('isSyncOperation should validate operations', () => {
      expect(isSyncOperation('create')).toBe(true);
      expect(isSyncOperation('upsert')).toBe(false);
    });

    it('isSyncConflictType should validate conflict types', () => {
      expect(isSyncConflictType('VERSION_MISMATCH')).toBe(true);
      expect(isSyncConflictType('UNKNOWN')).toBe(false);
    });

    it('isSyncResolution should validate resolutions', () => {
      expect(isSyncResolution('keep_local')).toBe(true);
      expect(isSyncResolution('auto')).toBe(false);
    });

    it('isApiKeyScope should validate scopes', () => {
      expect(isApiKeyScope('full')).toBe(true);
      expect(isApiKeyScope('read_only')).toBe(true);
      expect(isApiKeyScope('admin')).toBe(false);
    });

    it('isEmbeddingStatus should validate statuses', () => {
      expect(isEmbeddingStatus('pending')).toBe(true);
      expect(isEmbeddingStatus('complete')).toBe(true);
      expect(isEmbeddingStatus('unknown')).toBe(false);
    });
  });
});

// ============================================================
// 2. ZOD SCHEMAS
// ============================================================

describe('Zod Schemas', () => {
  describe('UserTierSchema', () => {
    it('should accept valid tiers', () => {
      expect(UserTierSchema.parse('free')).toBe('free');
      expect(UserTierSchema.parse('pro')).toBe('pro');
    });

    it('should reject invalid tiers', () => {
      expect(() => UserTierSchema.parse('enterprise')).toThrow();
    });
  });

  describe('Pagination schemas', () => {
    it('CursorPaginationRequestSchema should accept valid params', () => {
      const result = CursorPaginationRequestSchema.parse({ cursor: 'abc', limit: 50 });
      expect(result.cursor).toBe('abc');
      expect(result.limit).toBe(50);
    });

    it('CursorPaginationRequestSchema should accept empty params', () => {
      const result = CursorPaginationRequestSchema.parse({});
      expect(result.cursor).toBeUndefined();
    });

    it('CursorPaginationResponseSchema should accept valid response', () => {
      const result = CursorPaginationResponseSchema.parse({
        cursor: 'abc',
        next_cursor: 'def',
        has_more: true,
        limit: 50,
      });
      expect(result.has_more).toBe(true);
    });

    it('OffsetPaginationRequestSchema should accept valid params', () => {
      const result = OffsetPaginationRequestSchema.parse({ offset: 10, limit: 20 });
      expect(result.offset).toBe(10);
    });

    it('OffsetPaginationResponseSchema should accept valid response', () => {
      const result = OffsetPaginationResponseSchema.parse({
        offset: 0,
        limit: 20,
        total: 100,
        has_more: true,
      });
      expect(result.total).toBe(100);
    });
  });

  describe('Error schemas', () => {
    it('ApiErrorResponseExtendedSchema should accept valid error', () => {
      const result = ApiErrorResponseExtendedSchema.parse({
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        request_id: 'req_123',
      });
      expect(result.code).toBe('RATE_LIMITED');
    });

    it('ValidationFieldErrorSchema should accept field error', () => {
      const result = ValidationFieldErrorSchema.parse({
        path: 'content.title',
        message: 'Title too long',
        limit: 100,
        actual: 150,
      });
      expect(result.path).toBe('content.title');
    });

    it('ContentLimitsInfoSchema should accept valid limits', () => {
      const result = ContentLimitsInfoSchema.parse({
        title: 100,
        body_soft: 500,
        body_hard: 2000,
        summary: 200,
      });
      expect(result.title).toBe(100);
    });
  });

  describe('Auth schemas', () => {
    it('AuthContextSchema should accept valid context', () => {
      const result = AuthContextSchema.parse({
        user_id: 'user_123',
        tier: 'free',
        privacy_tier: 'standard',
        auth_method: 'jwt',
      });
      expect(result.user_id).toBe('user_123');
    });

    it('AuthContextSchema should reject invalid tier', () => {
      expect(() => AuthContextSchema.parse({
        user_id: 'user_123',
        tier: 'enterprise',
        privacy_tier: 'standard',
        auth_method: 'jwt',
      })).toThrow();
    });

    it('JWTClaimsSchema should accept valid claims', () => {
      const result = JWTClaimsSchema.parse({
        sub: 'user_123',
        exp: 1700000000,
        iat: 1699999000,
        metadata: { tier: 'pro', privacy: 'standard' },
      });
      expect(result.sub).toBe('user_123');
    });

    it('APIKeyDisplayInfoSchema should accept valid info', () => {
      const result = APIKeyDisplayInfoSchema.parse({
        id: 'key_1',
        name: 'My Key',
        prefix: 'sk_live_abc...',
        scope: 'full',
        created_at: '2024-01-01T00:00:00Z',
      });
      expect(result.scope).toBe('full');
    });

    it('RefreshTokenRequestSchema should accept valid request', () => {
      const result = RefreshTokenRequestSchema.parse({ refresh_token: 'rt_abc' });
      expect(result.refresh_token).toBe('rt_abc');
    });

    it('RefreshTokenResponseSchema should accept valid response', () => {
      const result = RefreshTokenResponseSchema.parse({
        access_token: 'at_abc',
        expires_in: 900,
      });
      expect(result.expires_in).toBe(900);
    });
  });

  describe('Idempotency schema', () => {
    it('IdempotencyRecordSchema should accept valid record', () => {
      const result = IdempotencyRecordSchema.parse({
        _schemaVersion: 1,
        key: 'idem_abc',
        request_hash: 'sha256:...',
        response: { data: {} },
        status_code: 200,
        created_at: '2024-01-01T00:00:00Z',
        expires_at: '2024-01-02T00:00:00Z',
      });
      expect(result._schemaVersion).toBe(1);
    });
  });

  describe('Embedding schema', () => {
    it('EmbeddingInfoSchema should accept valid info', () => {
      const result = EmbeddingInfoSchema.parse({
        model: 'text-embedding-3-small',
        dimensions: 1536,
        status: 'complete',
      });
      expect(result.dimensions).toBe(1536);
    });

    it('EmbeddingInfoSchema should reject invalid status', () => {
      expect(() => EmbeddingInfoSchema.parse({
        model: 'test',
        dimensions: 1536,
        status: 'unknown',
      })).toThrow();
    });
  });

  describe('Webhook schema', () => {
    it('WebhookCallbackSchema should accept valid callback', () => {
      const result = WebhookCallbackSchema.parse({
        event: 'ingestion.complete',
        job_id: 'job_123',
        status: 'complete',
        results: { chunks: 5 },
        timestamp: '2024-01-01T00:00:00Z',
      });
      expect(result.event).toBe('ingestion.complete');
    });
  });

  describe('Rate limit schemas', () => {
    it('RateLimitResultSchema should accept allowed result', () => {
      const result = RateLimitResultSchema.parse({
        allowed: true,
        limit: 60,
        remaining: 59,
        reset_at: '2024-01-01T00:01:00Z',
        limit_type: 'api',
      });
      expect(result.allowed).toBe(true);
    });

    it('RateLimitResultSchema should accept denied result with retry_after', () => {
      const result = RateLimitResultSchema.parse({
        allowed: false,
        limit: 60,
        remaining: 0,
        reset_at: '2024-01-01T00:01:00Z',
        retry_after: 30,
        limit_type: 'endpoint',
      });
      expect(result.retry_after).toBe(30);
    });

    it('SlidingWindowStateSchema should accept valid state', () => {
      const result = SlidingWindowStateSchema.parse({
        key: 'ratelimit:api:user_123',
        count: 42,
        window_start_ms: 1700000000000,
        window_end_ms: 1700000060000,
      });
      expect(result.count).toBe(42);
    });

    it('TokenBucketStateSchema should accept valid state', () => {
      const result = TokenBucketStateSchema.parse({
        key: 'ratelimit:llm:user_123',
        tokens: 5.5,
        last_refill_ms: 1700000000000,
        max_tokens: 66,
        refill_rate: 1,
      });
      expect(result.tokens).toBe(5.5);
    });

    it('RateLimitErrorResponseSchema should accept valid 429 response', () => {
      const result = RateLimitErrorResponseSchema.parse({
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        retry_after: 30,
        limit: 60,
        remaining: 0,
        window: 60,
        reset_at: '2024-01-01T00:01:00Z',
        limit_type: 'api',
        request_id: 'req_123',
        docs_url: 'https://docs.nous.app/errors/RATE_LIMITED',
      });
      expect(result.remaining).toBe(0);
    });

    it('RateLimitMetricsSchema should accept valid metrics', () => {
      const result = RateLimitMetricsSchema.parse({
        check_count: 1000,
        exceeded_count: 5,
        bucket_utilization: 0.42,
        redis_latency_ms: 2.5,
        redis_failure_count: 0,
        fallback_count: 0,
      });
      expect(result.check_count).toBe(1000);
    });
  });

  describe('Chat SSE event schemas', () => {
    it('ChatSessionStartEventSchema should accept valid event', () => {
      const result = ChatSessionStartEventSchema.parse({
        session_id: 'sess_123',
        conversation_id: 'conv_456',
      });
      expect(result.session_id).toBe('sess_123');
    });

    it('ChatRetrievalStartEventSchema should accept valid event', () => {
      const result = ChatRetrievalStartEventSchema.parse({
        phase: 'embedding',
        query_processed: 'what is AI',
      });
      expect(result.phase).toBe('embedding');
    });

    it('ChatRetrievalNodeEventSchema should accept valid event', () => {
      const result = ChatRetrievalNodeEventSchema.parse({
        node_id: 'node_123',
        score: 0.95,
        title: 'AI Overview',
      });
      expect(result.score).toBe(0.95);
    });

    it('ChatRetrievalCompleteEventSchema should accept valid event', () => {
      const result = ChatRetrievalCompleteEventSchema.parse({
        nodes_retrieved: 5,
        time_ms: 123,
      });
      expect(result.nodes_retrieved).toBe(5);
    });

    it('ChatResponseStartEventSchema should accept valid event', () => {
      const result = ChatResponseStartEventSchema.parse({
        model: 'claude-sonnet-4',
        estimated_cost: 0.002,
      });
      expect(result.model).toBe('claude-sonnet-4');
    });

    it('ChatResponseChunkEventSchema should accept valid event', () => {
      const result = ChatResponseChunkEventSchema.parse({
        content: 'Hello',
        index: 0,
      });
      expect(result.content).toBe('Hello');
    });

    it('ChatResponseCompleteEventSchema should accept valid event', () => {
      const result = ChatResponseCompleteEventSchema.parse({
        total_tokens: 500,
        actual_cost: 0.001,
        sources: [{ node_id: 'n1', title: 'Test', relevance: 0.9 }],
      });
      expect(result.total_tokens).toBe(500);
    });

    it('ChatSourceSchema should accept valid source', () => {
      const result = ChatSourceSchema.parse({
        node_id: 'node_123',
        title: 'My Note',
        relevance: 0.85,
      });
      expect(result.relevance).toBe(0.85);
    });

    it('ChatDoneEventSchema should accept empty object', () => {
      const result = ChatDoneEventSchema.parse({});
      expect(result).toEqual({});
    });

    it('ChatSessionExpiredEventSchema should accept valid event', () => {
      const result = ChatSessionExpiredEventSchema.parse({
        message: 'Session expired, please restart',
      });
      expect(result.message).toContain('expired');
    });
  });

  describe('Node endpoint schemas', () => {
    const validNode = {
      id: 'node_123',
      type: 'fact',
      content: { title: 'Test', body: 'Body text' },
      neural: { stability: 0.8, retrievability: 0.7, importance: 0.9 },
      temporal: {
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        last_accessed: '2024-01-01T00:00:00Z',
        access_count: 5,
      },
      organization: { tags: ['test'] },
      state: { lifecycle: 'active', flags: [] },
      version: 1,
    };

    it('NodeResponseSchema should accept valid node', () => {
      const result = NodeResponseSchema.parse(validNode);
      expect(result.id).toBe('node_123');
    });

    it('NodeResponseSchema should reject neural values > 1', () => {
      expect(() => NodeResponseSchema.parse({
        ...validNode,
        neural: { stability: 1.5, retrievability: 0.7, importance: 0.9 },
      })).toThrow();
    });

    it('CreateNodeRequestSchema should accept valid request', () => {
      const result = CreateNodeRequestSchema.parse({
        type: 'fact',
        content: { title: 'Test', body: 'Content' },
      });
      expect(result.type).toBe('fact');
    });

    it('CreateNodeRequestSchema should reject title > 100 chars', () => {
      expect(() => CreateNodeRequestSchema.parse({
        type: 'fact',
        content: { title: 'x'.repeat(101), body: 'Content' },
      })).toThrow();
    });

    it('CreateNodeRequestSchema should reject body > 2000 chars', () => {
      expect(() => CreateNodeRequestSchema.parse({
        type: 'fact',
        content: { title: 'Test', body: 'x'.repeat(2001) },
      })).toThrow();
    });

    it('UpdateNodeRequestSchema should accept partial update', () => {
      const result = UpdateNodeRequestSchema.parse({
        content: { title: 'New Title' },
        expected_version: 3,
      });
      expect(result.expected_version).toBe(3);
    });

    it('BatchCreateNodesRequestSchema should accept valid batch', () => {
      const result = BatchCreateNodesRequestSchema.parse({
        nodes: [{ type: 'fact', content: { title: 'A', body: 'B' } }],
      });
      expect(result.nodes).toHaveLength(1);
    });

    it('BatchCreateNodesRequestSchema should reject empty nodes array', () => {
      expect(() => BatchCreateNodesRequestSchema.parse({ nodes: [] })).toThrow();
    });

    it('BatchFailureItemSchema should accept valid failure', () => {
      const result = BatchFailureItemSchema.parse({
        index: 3,
        error: { code: 'VALIDATION_ERROR', message: 'Bad data' },
      });
      expect(result.index).toBe(3);
    });

    it('ListNodesParamsSchema should accept valid params', () => {
      const result = ListNodesParamsSchema.parse({ type: 'fact', limit: 25 });
      expect(result.type).toBe('fact');
    });

    it('GetNodeParamsSchema should accept include param', () => {
      const result = GetNodeParamsSchema.parse({ include: 'embedding,edges' });
      expect(result.include).toBe('embedding,edges');
    });
  });

  describe('Edge endpoint schemas', () => {
    it('EdgeResponseSchema should accept valid edge', () => {
      const result = EdgeResponseSchema.parse({
        id: 'edge_1',
        source: 'node_1',
        target: 'node_2',
        type: 'related',
        strength: 0.7,
        confidence: 0.9,
        neural: {
          co_activation_count: 3,
          last_co_activation: '2024-01-01T00:00:00Z',
        },
        created_at: '2024-01-01T00:00:00Z',
      });
      expect(result.strength).toBe(0.7);
    });

    it('CreateEdgeRequestSchema should accept valid request', () => {
      const result = CreateEdgeRequestSchema.parse({
        source: 'node_1',
        target: 'node_2',
        type: 'related',
      });
      expect(result.type).toBe('related');
    });

    it('UpdateEdgeRequestSchema should accept valid strength', () => {
      const result = UpdateEdgeRequestSchema.parse({ strength: 0.8 });
      expect(result.strength).toBe(0.8);
    });

    it('UpdateEdgeRequestSchema should reject strength > 1', () => {
      expect(() => UpdateEdgeRequestSchema.parse({ strength: 1.5 })).toThrow();
    });

    it('ListEdgesParamsSchema should accept direction filter', () => {
      const result = ListEdgesParamsSchema.parse({ direction: 'out' });
      expect(result.direction).toBe('out');
    });
  });

  describe('Search endpoint schemas', () => {
    it('SimpleSearchParamsSchema should accept valid params', () => {
      const result = SimpleSearchParamsSchema.parse({ q: 'test query' });
      expect(result.q).toBe('test query');
    });

    it('SimpleSearchParamsSchema should reject empty query', () => {
      expect(() => SimpleSearchParamsSchema.parse({ q: '' })).toThrow();
    });

    it('AdvancedSearchRequestSchema should accept complex filters', () => {
      const result = AdvancedSearchRequestSchema.parse({
        query: 'AI concepts',
        filters: {
          types: ['fact', 'concept'],
          tags: ['important'],
          lifecycle: ['active'],
        },
        options: { include_scores: true },
        limit: 30,
      });
      expect(result.filters?.types).toHaveLength(2);
    });

    it('SearchResultItemSchema should accept valid item', () => {
      const result = SearchResultItemSchema.parse({
        node: {
          id: 'n1', type: 'fact',
          content: { title: 'T', body: 'B' },
          neural: { stability: 0.5, retrievability: 0.5, importance: 0.5 },
          temporal: {
            created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
            last_accessed: '2024-01-01T00:00:00Z', access_count: 0,
          },
          organization: { tags: [] },
          state: { lifecycle: 'active', flags: [] },
          version: 1,
        },
        score: 0.95,
      });
      expect(result.score).toBe(0.95);
    });
  });

  describe('Cluster endpoint schemas', () => {
    it('ClusterListItemSchema should accept valid cluster', () => {
      const result = ClusterListItemSchema.parse({
        id: 'cl_1',
        name: 'AI Topics',
        description: 'AI-related nodes',
        node_count: 42,
        keywords: ['AI', 'ML'],
        color: '#FF0000',
        created_at: '2024-01-01T00:00:00Z',
      });
      expect(result.node_count).toBe(42);
    });

    it('UpdateClusterRequestSchema should accept partial update', () => {
      const result = UpdateClusterRequestSchema.parse({ name: 'New Name' });
      expect(result.name).toBe('New Name');
    });
  });

  describe('Chat endpoint schemas', () => {
    it('ChatRequestSchema should accept valid request', () => {
      const result = ChatRequestSchema.parse({
        message: 'Hello AI',
        options: { include_retrieval: true, max_tokens: 2000 },
      });
      expect(result.message).toBe('Hello AI');
    });

    it('ChatRequestSchema should reject empty message', () => {
      expect(() => ChatRequestSchema.parse({ message: '' })).toThrow();
    });

    it('ConversationMessageSchema should accept valid message', () => {
      const result = ConversationMessageSchema.parse({
        role: 'assistant',
        content: 'Hello!',
        timestamp: '2024-01-01T00:00:00Z',
        cost: 0.001,
      });
      expect(result.role).toBe('assistant');
    });

    it('ConversationSummarySchema should accept valid summary', () => {
      const result = ConversationSummarySchema.parse({
        id: 'conv_1',
        preview: 'Hello...',
        message_count: 5,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });
      expect(result.message_count).toBe(5);
    });
  });

  describe('Agent endpoint schemas', () => {
    it('AgentToolInfoSchema should accept valid tool', () => {
      const result = AgentToolInfoSchema.parse({
        name: 'merge_nodes',
        description: 'Merge two nodes',
        available_offline: false,
        credits: 0.01,
        requires_confirmation: true,
      });
      expect(result.name).toBe('merge_nodes');
    });

    it('ExecuteActionRequestSchema should accept valid request', () => {
      const result = ExecuteActionRequestSchema.parse({
        tool: 'merge_nodes',
        params: { source: 'n1', target: 'n2' },
        dry_run: true,
      });
      expect(result.dry_run).toBe(true);
    });

    it('ActionResultSchema should accept valid result', () => {
      const result = ActionResultSchema.parse({
        action_id: 'act_1',
        tool: 'merge_nodes',
        status: 'completed',
        results: { merged_id: 'n3' },
        credits_used: 0.01,
        undoable: true,
      });
      expect(result.undoable).toBe(true);
    });

    it('PreviewResultSchema should accept valid preview', () => {
      const result = PreviewResultSchema.parse({
        preview: true,
        affected_count: 2,
        affected_nodes: [{ id: 'n1', title: 'Node 1' }],
        estimated_credits: 0.01,
        requires_confirmation: true,
      });
      expect(result.preview).toBe(true);
    });

    it('ActionHistoryItemSchema should accept valid item', () => {
      const result = ActionHistoryItemSchema.parse({
        id: 'act_1',
        tool: 'merge_nodes',
        status: 'completed',
        timestamp: '2024-01-01T00:00:00Z',
        undoable: false,
        credits_used: 0.01,
      });
      expect(result.id).toBe('act_1');
    });
  });

  describe('Ingestion endpoint schemas', () => {
    it('IngestTextRequestSchema should accept valid request', () => {
      const result = IngestTextRequestSchema.parse({
        content: 'Today I learned about AI',
        source: 'chat',
      });
      expect(result.source).toBe('chat');
    });

    it('IngestTextRequestSchema should reject empty content', () => {
      expect(() => IngestTextRequestSchema.parse({
        content: '',
        source: 'chat',
      })).toThrow();
    });

    it('IngestClassificationResponseSchema should accept valid response', () => {
      const result = IngestClassificationResponseSchema.parse({
        intent: 'content',
        save_signal: 'explicit',
        content_type: 'fact',
        confidence: 0.95,
        action_verb: 'save',
      });
      expect(result.confidence).toBe(0.95);
    });

    it('CreatedNodeSummarySchema should accept valid summary', () => {
      const result = CreatedNodeSummarySchema.parse({
        id: 'n1',
        type: 'fact',
        title: 'AI Learning',
        embedding_status: 'pending',
      });
      expect(result.embedding_status).toBe('pending');
    });

    it('IngestJobStageSchema should accept valid stage', () => {
      const result = IngestJobStageSchema.parse({
        name: 'extraction',
        status: 'processing',
        progress: 50,
      });
      expect(result.progress).toBe(50);
    });
  });

  describe('Sync endpoint schemas', () => {
    it('SyncChangeSchema should accept valid change', () => {
      const result = SyncChangeSchema.parse({
        operation: 'create',
        table: 'nodes',
        local_id: 'local_1',
        data: { title: 'New Node' },
        client_timestamp: '2024-01-01T00:00:00Z',
      });
      expect(result.operation).toBe('create');
    });

    it('SyncPushRequestSchema should accept valid push', () => {
      const result = SyncPushRequestSchema.parse({
        changes: [{
          operation: 'update',
          table: 'nodes',
          id: 'n1',
          data: { title: 'Updated' },
          expected_version: 2,
          client_timestamp: '2024-01-01T00:00:00Z',
        }],
        client_db_version: 10,
      });
      expect(result.client_db_version).toBe(10);
    });

    it('SyncAppliedItemSchema should accept valid applied item', () => {
      const result = SyncAppliedItemSchema.parse({
        server_id: 'srv_1',
        version: 3,
      });
      expect(result.version).toBe(3);
    });

    it('SyncConflictItemSchema should accept valid conflict', () => {
      const result = SyncConflictItemSchema.parse({
        id: 'n1',
        conflict_id: 'cf_1',
        type: 'VERSION_MISMATCH',
        client_version: 2,
        server_version: 3,
        server_data: { title: 'Server Title' },
        resolution_options: ['keep_local', 'keep_server', 'merge'],
      });
      expect(result.type).toBe('VERSION_MISMATCH');
    });

    it('SyncPullParamsSchema should accept valid params', () => {
      const result = SyncPullParamsSchema.parse({ since_version: 5 });
      expect(result.since_version).toBe(5);
    });

    it('PulledChangeSchema should accept valid change', () => {
      const result = PulledChangeSchema.parse({
        table: 'edges',
        id: 'e1',
        operation: 'delete',
        data: {},
        version: 12,
        timestamp: '2024-01-01T00:00:00Z',
      });
      expect(result.operation).toBe('delete');
    });

    it('ResolveConflictRequestSchema should accept valid resolution', () => {
      const result = ResolveConflictRequestSchema.parse({
        resolution: 'merge',
        merged_data: { title: 'Merged Title' },
      });
      expect(result.resolution).toBe('merge');
    });

    it('FullSyncRequestSchema should accept valid request', () => {
      const result = FullSyncRequestSchema.parse({ reason: 'new_device' });
      expect(result.reason).toBe('new_device');
    });
  });

  describe('Settings endpoint schemas', () => {
    it('AgentPermissionsSchema should accept valid permissions', () => {
      const result = AgentPermissionsSchema.parse({
        can_write: true,
        can_auto_operations: false,
        can_delete: false,
        can_bulk_operations: true,
      });
      expect(result.can_write).toBe(true);
    });

    it('NotificationSettingsSchema should accept valid settings', () => {
      const result = NotificationSettingsSchema.parse({
        daily_summary: true,
        sync_alerts: false,
        agent_suggestions: 'important_only',
      });
      expect(result.agent_suggestions).toBe('important_only');
    });

    it('UserPreferencesSchema should accept valid preferences', () => {
      const result = UserPreferencesSchema.parse({
        theme: 'dark',
        language: 'en',
        working_memory_hours: 24,
      });
      expect(result.theme).toBe('dark');
    });

    it('UpdateSettingsRequestSchema should accept partial update', () => {
      const result = UpdateSettingsRequestSchema.parse({
        preferences: { theme: 'light' },
      });
      expect(result.preferences?.theme).toBe('light');
    });

    it('CreateAPIKeyRequestSchema should accept valid request', () => {
      const result = CreateAPIKeyRequestSchema.parse({
        name: 'My Script Key',
        scope: 'read_only',
      });
      expect(result.scope).toBe('read_only');
    });

    it('CreateAPIKeyRequestSchema should reject empty name', () => {
      expect(() => CreateAPIKeyRequestSchema.parse({
        name: '',
        scope: 'full',
      })).toThrow();
    });
  });

  describe('Credits endpoint schemas', () => {
    it('UsageByDaySchema should accept valid entry', () => {
      const result = UsageByDaySchema.parse({
        date: '2024-01-15',
        amount: 0.42,
      });
      expect(result.amount).toBe(0.42);
    });

    it('CostEstimateRequestSchema should accept valid request', () => {
      const result = CostEstimateRequestSchema.parse({
        operation: 'chat',
        params: { message_length: 100, complexity: 'standard' },
      });
      expect(result.operation).toBe('chat');
    });
  });

  describe('Data flow schemas', () => {
    it('FlowStepSchema should accept valid step', () => {
      const result = FlowStepSchema.parse({
        name: 'validate_auth',
        service: 'Auth',
        description: 'Validate JWT/API key',
      });
      expect(result.service).toBe('Auth');
    });

    it('FlowExecutionSchema should accept valid execution', () => {
      const result = FlowExecutionSchema.parse({
        flow_type: 'chat',
        request_id: 'req_123',
        current_step: 'classify_query',
        started_at: 1700000000000,
        steps_completed: ['validate_auth', 'check_credits'],
      });
      expect(result.steps_completed).toHaveLength(2);
    });

    it('FlowExecutionSchema should accept execution with error', () => {
      const result = FlowExecutionSchema.parse({
        flow_type: 'ingestion',
        request_id: 'req_456',
        current_step: 'stage_embed',
        started_at: 1700000000000,
        steps_completed: ['receive', 'classify'],
        error: 'Embedding service unavailable',
      });
      expect(result.error).toContain('unavailable');
    });
  });
});

// ============================================================
// 3. ERROR HANDLING
// ============================================================

describe('Error Handling', () => {
  describe('getHttpStatusForErrorCode', () => {
    it('should return 429 for RATE_LIMITED', () => {
      expect(getHttpStatusForErrorCode('RATE_LIMITED')).toBe(429);
    });

    it('should return 400 for VALIDATION_ERROR', () => {
      expect(getHttpStatusForErrorCode('VALIDATION_ERROR')).toBe(400);
    });

    it('should return 401 for UNAUTHORIZED', () => {
      expect(getHttpStatusForErrorCode('UNAUTHORIZED')).toBe(401);
    });

    it('should return 403 for TIER_REQUIRED', () => {
      expect(getHttpStatusForErrorCode('TIER_REQUIRED')).toBe(403);
    });

    it('should return 409 for IDEMPOTENCY_MISMATCH', () => {
      expect(getHttpStatusForErrorCode('IDEMPOTENCY_MISMATCH')).toBe(409);
    });

    it('should return 502 for UPSTREAM_ERROR', () => {
      expect(getHttpStatusForErrorCode('UPSTREAM_ERROR')).toBe(502);
    });

    it('should return 422 for UNPROCESSABLE', () => {
      expect(getHttpStatusForErrorCode('UNPROCESSABLE')).toBe(422);
    });
  });

  describe('getDocsUrl', () => {
    it('should return correct URL format', () => {
      expect(getDocsUrl('RATE_LIMITED')).toBe('https://docs.nous.app/errors/RATE_LIMITED');
    });

    it('should include the error code in the URL', () => {
      expect(getDocsUrl('VALIDATION_ERROR')).toContain('VALIDATION_ERROR');
    });
  });

  describe('getContentLimits', () => {
    it('should return correct limits', () => {
      const limits = getContentLimits();
      expect(limits.title).toBe(100);
      expect(limits.body_soft).toBe(500);
      expect(limits.body_hard).toBe(2000);
      expect(limits.summary).toBe(200);
    });
  });

  describe('createExtendedApiError', () => {
    it('should create basic error', () => {
      const error = createExtendedApiError('NOT_FOUND', 'Node not found');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toBe('Node not found');
      expect(error.docs_url).toContain('NOT_FOUND');
    });

    it('should include request_id', () => {
      const error = createExtendedApiError('NOT_FOUND', 'Not found', {
        request_id: 'req_123',
      });
      expect(error.request_id).toBe('req_123');
    });

    it('should include retry_after', () => {
      const error = createExtendedApiError('RATE_LIMITED', 'Too many requests', {
        retry_after: 30,
      });
      expect(error.retry_after).toBe(30);
    });

    it('should allow custom docs_url', () => {
      const error = createExtendedApiError('RATE_LIMITED', 'msg', {
        docs_url: 'https://custom.docs.com',
      });
      expect(error.docs_url).toBe('https://custom.docs.com');
    });
  });

  describe('createValidationError', () => {
    it('should create validation error with fields', () => {
      const error = createValidationError([
        { path: 'content.title', message: 'Too long', limit: 100, actual: 150 },
      ]);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details?.fields).toHaveLength(1);
    });

    it('should include request_id', () => {
      const error = createValidationError([], 'req_123');
      expect(error.request_id).toBe('req_123');
    });
  });

  describe('createContentLimitError', () => {
    it('should create content limit error', () => {
      const error = createContentLimitError('content.title', 100, 150, 'req_1');
      expect(error.code).toBe('CONTENT_LIMIT_EXCEEDED');
      expect(error.details?.field).toBe('content.title');
      expect(error.details?.limit).toBe(100);
      expect(error.details?.actual).toBe(150);
      expect(error.details?.limits).toBeDefined();
    });
  });

  describe('createBatchSizeError', () => {
    it('should create batch size error', () => {
      const error = createBatchSizeError(100, 200, 'req_1');
      expect(error.code).toBe('BATCH_SIZE_EXCEEDED');
      expect(error.details?.max_size).toBe(100);
      expect(error.details?.actual_size).toBe(200);
    });
  });
});

// ============================================================
// 4. PAGINATION
// ============================================================

describe('Pagination', () => {
  describe('normalizeCursorParams', () => {
    it('should apply default limit', () => {
      const result = normalizeCursorParams({});
      expect(result.limit).toBe(CURSOR_PAGINATION_DEFAULT_LIMIT);
    });

    it('should preserve cursor', () => {
      const result = normalizeCursorParams({ cursor: 'abc' });
      expect(result.cursor).toBe('abc');
    });

    it('should clamp limit to max', () => {
      const result = normalizeCursorParams({ limit: 500 });
      expect(result.limit).toBe(CURSOR_PAGINATION_MAX_LIMIT);
    });

    it('should enforce minimum limit of 1', () => {
      const result = normalizeCursorParams({ limit: -5 });
      expect(result.limit).toBe(1);
    });

    it('should preserve valid limit', () => {
      const result = normalizeCursorParams({ limit: 25 });
      expect(result.limit).toBe(25);
    });
  });

  describe('normalizeOffsetParams', () => {
    it('should apply default offset and limit', () => {
      const result = normalizeOffsetParams({});
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(OFFSET_PAGINATION_DEFAULT_LIMIT);
    });

    it('should clamp limit to max', () => {
      const result = normalizeOffsetParams({ limit: 500 });
      expect(result.limit).toBe(OFFSET_PAGINATION_MAX_LIMIT);
    });

    it('should enforce minimum offset of 0', () => {
      const result = normalizeOffsetParams({ offset: -10 });
      expect(result.offset).toBe(0);
    });

    it('should enforce minimum limit of 1', () => {
      const result = normalizeOffsetParams({ limit: 0 });
      expect(result.limit).toBe(1);
    });

    it('should preserve valid values', () => {
      const result = normalizeOffsetParams({ offset: 20, limit: 30 });
      expect(result.offset).toBe(20);
      expect(result.limit).toBe(30);
    });
  });

  describe('createCursorPaginationResponse', () => {
    it('should indicate has_more when items fill the limit', () => {
      const items = Array.from({ length: 50 }, (_, i) => i);
      const result = createCursorPaginationResponse(items, 50, null);
      expect(result.has_more).toBe(true);
    });

    it('should indicate no more when items are fewer than limit', () => {
      const items = [1, 2, 3];
      const result = createCursorPaginationResponse(items, 50, null);
      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeNull();
    });

    it('should include total when provided', () => {
      const result = createCursorPaginationResponse([1], 50, null, 100);
      expect(result.total).toBe(100);
    });

    it('should preserve current cursor', () => {
      const result = createCursorPaginationResponse([1], 50, 'abc');
      expect(result.cursor).toBe('abc');
    });
  });

  describe('createOffsetPaginationResponse', () => {
    it('should indicate has_more when not at end', () => {
      const result = createOffsetPaginationResponse(0, 20, 100);
      expect(result.has_more).toBe(true);
    });

    it('should indicate no more when at end', () => {
      const result = createOffsetPaginationResponse(80, 20, 100);
      expect(result.has_more).toBe(false);
    });

    it('should include all fields', () => {
      const result = createOffsetPaginationResponse(10, 20, 50);
      expect(result.offset).toBe(10);
      expect(result.limit).toBe(20);
      expect(result.total).toBe(50);
      expect(result.has_more).toBe(true);
    });
  });
});

// ============================================================
// 5. RATE LIMITING
// ============================================================

describe('Rate Limiting', () => {
  describe('TIER_RANKS', () => {
    it('should rank tiers from lowest to highest', () => {
      expect(TIER_RANKS.free).toBeLessThan(TIER_RANKS.credits);
      expect(TIER_RANKS.credits).toBeLessThan(TIER_RANKS.pro);
    });

    it('should rank api_key between free and credits', () => {
      expect(TIER_RANKS.api_key).toBeGreaterThan(TIER_RANKS.free);
      expect(TIER_RANKS.api_key).toBeLessThan(TIER_RANKS.credits);
    });
  });

  describe('tierRank', () => {
    it('should return correct rank for each tier', () => {
      expect(tierRank('free')).toBe(0);
      expect(tierRank('api_key')).toBe(1);
      expect(tierRank('credits')).toBe(2);
      expect(tierRank('pro')).toBe(3);
    });

    it('should detect upgrade (higher rank)', () => {
      expect(tierRank('pro')).toBeGreaterThan(tierRank('free'));
    });

    it('should detect downgrade (lower rank)', () => {
      expect(tierRank('free')).toBeLessThan(tierRank('pro'));
    });
  });

  describe('buildRedisKey', () => {
    it('should substitute user_id', () => {
      const key = buildRedisKey(REDIS_KEY_PATTERNS.api, { user_id: 'u123' });
      expect(key).toBe('ratelimit:api:u123');
    });

    it('should substitute multiple placeholders', () => {
      const key = buildRedisKey(REDIS_KEY_PATTERNS.endpoint, {
        user_id: 'u123',
        endpoint: 'chat',
      });
      expect(key).toBe('ratelimit:endpoint:u123:chat');
    });

    it('should leave unmatched placeholders unchanged', () => {
      const key = buildRedisKey('prefix:{missing}', {});
      expect(key).toBe('prefix:{missing}');
    });
  });

  describe('calculateRetryAfter', () => {
    it('should return positive seconds when window not expired', () => {
      const now = Date.now();
      const oldestTimestamp = now - 30_000; // 30s ago
      const windowMs = 60_000; // 60s window
      const result = calculateRetryAfter(windowMs, oldestTimestamp);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(30);
    });

    it('should return 0 when window already expired', () => {
      const now = Date.now();
      const oldestTimestamp = now - 120_000; // 120s ago
      const windowMs = 60_000; // 60s window
      const result = calculateRetryAfter(windowMs, oldestTimestamp);
      expect(result).toBe(0);
    });
  });

  describe('calculateTokenBucketRetryAfter', () => {
    it('should calculate seconds needed for token refill', () => {
      expect(calculateTokenBucketRetryAfter(10, 2)).toBe(5);
    });

    it('should ceil to nearest second', () => {
      expect(calculateTokenBucketRetryAfter(7, 3)).toBe(3); // 2.33 -> 3
    });

    it('should return 60 for zero refill rate (safety)', () => {
      expect(calculateTokenBucketRetryAfter(10, 0)).toBe(60);
    });

    it('should return 60 for negative refill rate (safety)', () => {
      expect(calculateTokenBucketRetryAfter(10, -1)).toBe(60);
    });
  });

  describe('formatRateLimitHeaders', () => {
    it('should format allowed result headers', () => {
      const headers = formatRateLimitHeaders({
        allowed: true,
        limit: 60,
        remaining: 55,
        reset_at: '2024-01-01T00:01:00Z',
        limit_type: 'api',
      });
      expect(headers['X-RateLimit-Limit']).toBe(60);
      expect(headers['X-RateLimit-Remaining']).toBe(55);
      expect(headers['X-RateLimit-Window']).toBe(60);
      expect(headers['Retry-After']).toBeUndefined();
    });

    it('should include Retry-After on denied result', () => {
      const headers = formatRateLimitHeaders({
        allowed: false,
        limit: 60,
        remaining: 0,
        reset_at: '2024-01-01T00:01:00Z',
        retry_after: 30,
        limit_type: 'api',
      });
      expect(headers['Retry-After']).toBe(30);
    });

    it('should accept custom window seconds', () => {
      const headers = formatRateLimitHeaders({
        allowed: true,
        limit: 100,
        remaining: 90,
        reset_at: '2024-01-01T00:01:00Z',
        limit_type: 'api',
      }, 120);
      expect(headers['X-RateLimit-Window']).toBe(120);
    });
  });

  describe('external stubs', () => {
    it('checkRateLimit should throw', () => {
      expect(() => checkRateLimit('u1', 'free', '/v1/chat')).toThrow('External stub');
    });

    it('getTierWithCache should throw', () => {
      expect(() => getTierWithCache('u1')).toThrow('External stub');
    });
  });
});

// ============================================================
// 6. AUTH MIDDLEWARE
// ============================================================

describe('Auth Middleware', () => {
  describe('extractAuthContextFromJWT', () => {
    it('should extract user_id from sub', () => {
      const context = extractAuthContextFromJWT({
        sub: 'user_123',
        exp: 9999999999,
        iat: 1000000000,
        metadata: { tier: 'pro', privacy: 'standard' },
      });
      expect(context.user_id).toBe('user_123');
    });

    it('should extract tier from metadata', () => {
      const context = extractAuthContextFromJWT({
        sub: 'u1',
        exp: 9999999999,
        iat: 1000000000,
        metadata: { tier: 'credits', privacy: 'private' },
      });
      expect(context.tier).toBe('credits');
      expect(context.privacy_tier).toBe('private');
    });

    it('should set auth_method to jwt', () => {
      const context = extractAuthContextFromJWT({
        sub: 'u1',
        exp: 9999999999,
        iat: 1000000000,
        metadata: { tier: 'free', privacy: 'standard' },
      });
      expect(context.auth_method).toBe('jwt');
    });
  });

  describe('isApiKeyToken', () => {
    it('should detect live API keys', () => {
      expect(isApiKeyToken('sk_live_abc123def456')).toBe(true);
    });

    it('should detect test API keys', () => {
      expect(isApiKeyToken('sk_test_abc123def456')).toBe(true);
    });

    it('should reject JWT tokens', () => {
      expect(isApiKeyToken('eyJhbGciOiJIUzI1NiJ9...')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isApiKeyToken('')).toBe(false);
    });

    it('should use correct prefixes', () => {
      expect(API_KEY_PREFIX_LIVE).toBe('sk_live_');
      expect(API_KEY_PREFIX_TEST).toBe('sk_test_');
    });
  });

  describe('isTokenExpired', () => {
    it('should return true for expired token', () => {
      expect(isTokenExpired({ exp: 0 })).toBe(true);
    });

    it('should return false for future token', () => {
      expect(isTokenExpired({ exp: Math.floor(Date.now() / 1000) + 3600 })).toBe(false);
    });

    it('should handle edge case at current time', () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      // Token expiring right now should be expired
      expect(isTokenExpired({ exp: nowSeconds - 1 })).toBe(true);
    });
  });

  describe('validateAuthToken (external stub)', () => {
    it('should throw', () => {
      expect(() => validateAuthToken('any_token')).toThrow('External stub');
    });
  });
});

// ============================================================
// 7. SSE CHAT
// ============================================================

describe('SSE Chat', () => {
  describe('formatChatSSEEvent', () => {
    it('should format event in SSE wire format', () => {
      const result = formatChatSSEEvent('session_start', { session_id: 's1' }, 'evt_001');
      expect(result).toContain('event: session_start\n');
      expect(result).toContain('id: evt_001\n');
      expect(result).toContain('data: {"session_id":"s1"}\n');
      expect(result.endsWith('\n\n')).toBe(true);
    });

    it('should serialize data as JSON', () => {
      const result = formatChatSSEEvent('response_chunk', { content: 'Hello', index: 0 }, 'e1');
      expect(result).toContain('"content":"Hello"');
    });

    it('should handle empty data', () => {
      const result = formatChatSSEEvent('done', {}, 'e_done');
      expect(result).toContain('data: {}');
    });

    it('should handle ping event', () => {
      const result = formatChatSSEEvent('ping', {}, 'ping_001');
      expect(result).toContain('event: ping');
    });
  });

  describe('isReconnectionValid', () => {
    it('should return true for recent event', () => {
      const recentTimestamp = Date.now() - 1000; // 1 second ago
      expect(isReconnectionValid(recentTimestamp)).toBe(true);
    });

    it('should return false for old event (> 5 min)', () => {
      const oldTimestamp = Date.now() - 400_000; // 6+ minutes ago
      expect(isReconnectionValid(oldTimestamp)).toBe(false);
    });

    it('should use default 5-minute window', () => {
      const justWithin = Date.now() - 299_000; // 4:59 ago
      expect(isReconnectionValid(justWithin)).toBe(true);
    });

    it('should accept custom window', () => {
      const timestamp = Date.now() - 5_000;
      expect(isReconnectionValid(timestamp, 3_000)).toBe(false); // 5s > 3s window
      expect(isReconnectionValid(timestamp, 10_000)).toBe(true); // 5s < 10s window
    });
  });

  describe('generateEventId', () => {
    it('should format with zero-padded sequence', () => {
      expect(generateEventId('sess_abc', 1)).toBe('sess_abc_001');
    });

    it('should handle sequence 0', () => {
      expect(generateEventId('s', 0)).toBe('s_000');
    });

    it('should handle large sequences', () => {
      expect(generateEventId('s', 999)).toBe('s_999');
    });

    it('should handle sequences > 999', () => {
      expect(generateEventId('s', 1234)).toBe('s_1234');
    });
  });
});

// ============================================================
// 8. VALIDATORS
// ============================================================

describe('Validators', () => {
  describe('validateCreateNodeRequest', () => {
    it('should accept valid request', () => {
      const result = validateCreateNodeRequest({
        type: 'fact',
        content: { title: 'Test', body: 'Body' },
      });
      expect(result.type).toBe('fact');
    });

    it('should throw on invalid request', () => {
      expect(() => validateCreateNodeRequest({ type: 'fact' })).toThrow();
    });
  });

  describe('validateUpdateNodeRequest', () => {
    it('should accept partial update', () => {
      const result = validateUpdateNodeRequest({ content: { title: 'New' } });
      expect(result.content?.title).toBe('New');
    });
  });

  describe('validateBatchCreateNodesRequest', () => {
    it('should accept valid batch', () => {
      const result = validateBatchCreateNodesRequest({
        nodes: [{ type: 'fact', content: { title: 'A', body: 'B' } }],
      });
      expect(result.nodes).toHaveLength(1);
    });
  });

  describe('validateChatRequest', () => {
    it('should accept valid chat request', () => {
      const result = validateChatRequest({ message: 'Hello' });
      expect(result.message).toBe('Hello');
    });

    it('should throw on empty message', () => {
      expect(() => validateChatRequest({ message: '' })).toThrow();
    });
  });

  describe('validateIngestTextRequest', () => {
    it('should accept valid ingest request', () => {
      const result = validateIngestTextRequest({
        content: 'Some text',
        source: 'chat',
      });
      expect(result.source).toBe('chat');
    });
  });

  describe('validateSyncPushRequest', () => {
    it('should accept valid push', () => {
      const result = validateSyncPushRequest({
        changes: [{
          operation: 'create',
          table: 'nodes',
          data: { title: 'T' },
          client_timestamp: '2024-01-01T00:00:00Z',
        }],
        client_db_version: 1,
      });
      expect(result.changes).toHaveLength(1);
    });
  });

  describe('validateCreateEdgeRequest', () => {
    it('should accept valid edge request', () => {
      const result = validateCreateEdgeRequest({
        source: 'n1',
        target: 'n2',
        type: 'related',
      });
      expect(result.type).toBe('related');
    });
  });

  describe('validateUpdateEdgeRequest', () => {
    it('should accept valid strength', () => {
      const result = validateUpdateEdgeRequest({ strength: 0.8 });
      expect(result.strength).toBe(0.8);
    });
  });

  describe('validateAdvancedSearchRequest', () => {
    it('should accept valid search', () => {
      const result = validateAdvancedSearchRequest({ query: 'test' });
      expect(result.query).toBe('test');
    });
  });

  describe('validateExecuteActionRequest', () => {
    it('should accept valid action', () => {
      const result = validateExecuteActionRequest({
        tool: 'merge',
        params: { a: 1 },
      });
      expect(result.tool).toBe('merge');
    });
  });

  describe('validateResolveConflictRequest', () => {
    it('should accept valid resolution', () => {
      const result = validateResolveConflictRequest({ resolution: 'keep_local' });
      expect(result.resolution).toBe('keep_local');
    });
  });

  describe('validateFullSyncRequest', () => {
    it('should accept valid request', () => {
      const result = validateFullSyncRequest({ reason: 'corruption' });
      expect(result.reason).toBe('corruption');
    });
  });

  describe('validateUpdateSettingsRequest', () => {
    it('should accept valid update', () => {
      const result = validateUpdateSettingsRequest({
        preferences: { theme: 'dark' },
      });
      expect(result.preferences?.theme).toBe('dark');
    });
  });

  describe('validateCreateAPIKeyRequest', () => {
    it('should accept valid request', () => {
      const result = validateCreateAPIKeyRequest({ name: 'Key', scope: 'full' });
      expect(result.name).toBe('Key');
    });
  });

  describe('validateCostEstimateRequest', () => {
    it('should accept valid request', () => {
      const result = validateCostEstimateRequest({
        operation: 'chat',
        params: { message_length: 100 },
      });
      expect(result.operation).toBe('chat');
    });
  });
});

// ============================================================
// 9. DATA FLOWS
// ============================================================

describe('Data Flows', () => {
  describe('CHAT_FLOW_STEPS', () => {
    it('should have 9 steps', () => {
      expect(CHAT_FLOW_STEPS).toHaveLength(9);
    });

    it('should start with validate_auth', () => {
      expect(CHAT_FLOW_STEPS[0]?.name).toBe('validate_auth');
    });

    it('should end with store_conversation', () => {
      expect(CHAT_FLOW_STEPS[8]?.name).toBe('store_conversation');
    });
  });

  describe('SYNC_FLOW_STEPS', () => {
    it('should have 6 steps', () => {
      expect(SYNC_FLOW_STEPS).toHaveLength(6);
    });
  });

  describe('INGESTION_FLOW_STEPS', () => {
    it('should have 8 steps', () => {
      expect(INGESTION_FLOW_STEPS).toHaveLength(8);
    });

    it('should start with receive', () => {
      expect(INGESTION_FLOW_STEPS[0]?.name).toBe('receive');
    });
  });

  describe('getFlowSteps', () => {
    it('should return chat steps for "chat"', () => {
      expect(getFlowSteps('chat')).toBe(CHAT_FLOW_STEPS);
    });

    it('should return sync steps for "sync"', () => {
      expect(getFlowSteps('sync')).toBe(SYNC_FLOW_STEPS);
    });

    it('should return ingestion steps for "ingestion"', () => {
      expect(getFlowSteps('ingestion')).toBe(INGESTION_FLOW_STEPS);
    });
  });

  describe('createFlowExecution', () => {
    it('should create execution with correct flow_type', () => {
      const exec = createFlowExecution('chat', 'req_1');
      expect(exec.flow_type).toBe('chat');
    });

    it('should set request_id', () => {
      const exec = createFlowExecution('sync', 'req_2');
      expect(exec.request_id).toBe('req_2');
    });

    it('should start at first step', () => {
      const exec = createFlowExecution('chat', 'req_3');
      expect(exec.current_step).toBe('validate_auth');
    });

    it('should have empty steps_completed', () => {
      const exec = createFlowExecution('ingestion', 'req_4');
      expect(exec.steps_completed).toEqual([]);
    });

    it('should set started_at to current time', () => {
      const before = Date.now();
      const exec = createFlowExecution('chat', 'req_5');
      const after = Date.now();
      expect(exec.started_at).toBeGreaterThanOrEqual(before);
      expect(exec.started_at).toBeLessThanOrEqual(after);
    });
  });
});
