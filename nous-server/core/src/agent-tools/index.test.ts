import { describe, it, expect } from 'vitest';
import {
  // Constants
  ATSS_TOOL_NAMES,
  ATSS_TOOL_CATEGORIES,
  ATSS_TOOL_TO_CATEGORY,
  ATSS_CONFIRMATION_LEVELS,
  ATSS_TOOL_CONFIRMATION,
  ATSS_UNDO_TTL_SECONDS,
  ATSS_QUICK_UNDO_SECONDS,
  ATSS_UNDO_STATUSES,
  ATSS_CREDIT_COSTS,
  ATSS_TIERS,
  ATSS_RATE_LIMITS,
  ATSS_CIRCUIT_BREAKER_MAX_FAILURES,
  ATSS_TOOL_TIMEOUT_MS,
  ATSS_CIRCUIT_BREAKER_STATES,
  ATSS_BULK_MODES,
  ATSS_ERROR_PREFIXES,
  ATSS_TOOL_DESCRIPTIONS,
  ATSS_MAX_NODE_IDS_PER_VIEW,
  ATSS_MAX_SEARCH_LIMIT,
  ATSS_DEFAULT_SEARCH_LIMIT,
  ATSS_MAX_CONTENT_LENGTH,
  ATSS_DEFAULT_MAX_CONTENT_LENGTH,
  ATSS_MAX_TAGS,
  ATSS_MAX_BULK_OPERATIONS,
  ATSS_MIN_SEARCH_SCORE,
  ATSS_DEFAULT_MIN_SEARCH_SCORE,
  ATSS_UPDATE_CONFIDENCE_THRESHOLD,
  ATSS_TRANSACTION_ID_PREFIX,
  ATSS_UNDO_ID_PREFIX,
  ATSS_INVERSE_OPERATIONS,
  ATSS_ERROR_CODES,
  ATSS_ERROR_CODE_KEYS,
  ATSS_TIER_CONFIGS,
  ATSS_RETRYABLE_ERROR_CODES,
  ATSS_SYNTHESIZE_FORMATS,
  ATSS_BULK_REFERENCE_PATTERNS,
  // Schemas
  AtssToolNameSchema,
  AtssToolCategorySchema,
  AtssConfirmationLevelSchema,
  AtssUndoStatusSchema,
  AtssTierSchema,
  AtssCircuitBreakerStateSchema,
  AtssBulkModeSchema,
  AtssViewNodeParamsSchema,
  AtssSearchParamsSchema,
  AtssCreateNodeParamsSchema,
  AtssUpdateNodeParamsSchema,
  AtssDeleteNodeParamsSchema,
  AtssCreateEdgeParamsSchema,
  AtssDeleteEdgeParamsSchema,
  AtssLinkToClusterParamsSchema,
  AtssBulkOperationsParamsSchema,
  AtssNodeChangesSchema,
  AtssUndoEntrySchema,
  AtssCircuitBreakerSchema,
  AtssErrorResponseSchema,
  AtssDryRunResultSchema,
  // Functions
  generateTransactionId,
  generateUndoId,
  getToolDefinition,
  ATSS_TOOL_DEFINITIONS,
  buildInverseParams,
  createUndoEntry,
  isUndoable,
  isQuickUndoWindow,
  getInverseOperation,
  checkDependencies,
  getConfirmationLevel,
  checkCreditSufficiency,
  calculateBulkCost,
  shouldRequireConfirmation,
  createCircuitBreaker,
  tripCircuitBreaker,
  resetCircuitBreaker,
  atssRecordSuccess,
  atssRecordFailure,
  shouldAllowRequest,
  checkRateLimit,
  recordRateLimitRequest,
  executeDryRun,
  createErrorResponse,
  getHttpStatus,
  isRetryable,
  // Types
  type AtssToolName,
  type AtssUndoEntry,
  type AtssCircuitBreaker,
  type AtssRateLimitState,
} from './index';

// ============================================================
// CONSTANTS TESTS
// ============================================================

describe('ATSS Constants', () => {
  it('should have exactly 9 tool names', () => {
    expect(ATSS_TOOL_NAMES).toHaveLength(9);
  });

  it('should have correct tool names', () => {
    expect(ATSS_TOOL_NAMES).toContain('view_node');
    expect(ATSS_TOOL_NAMES).toContain('search');
    expect(ATSS_TOOL_NAMES).toContain('create_node');
    expect(ATSS_TOOL_NAMES).toContain('update_node');
    expect(ATSS_TOOL_NAMES).toContain('delete_node');
    expect(ATSS_TOOL_NAMES).toContain('create_edge');
    expect(ATSS_TOOL_NAMES).toContain('delete_edge');
    expect(ATSS_TOOL_NAMES).toContain('link_to_cluster');
    expect(ATSS_TOOL_NAMES).toContain('bulk_operations');
  });

  it('should have 3 tool categories', () => {
    expect(ATSS_TOOL_CATEGORIES).toEqual(['read', 'write', 'destructive']);
  });

  it('should map every tool to a category', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      expect(ATSS_TOOL_TO_CATEGORY[tool]).toBeDefined();
      expect(ATSS_TOOL_CATEGORIES).toContain(ATSS_TOOL_TO_CATEGORY[tool]);
    }
  });

  it('should map read tools correctly', () => {
    expect(ATSS_TOOL_TO_CATEGORY.view_node).toBe('read');
    expect(ATSS_TOOL_TO_CATEGORY.search).toBe('read');
  });

  it('should map destructive tools correctly', () => {
    expect(ATSS_TOOL_TO_CATEGORY.delete_node).toBe('destructive');
    expect(ATSS_TOOL_TO_CATEGORY.bulk_operations).toBe('destructive');
  });

  it('should have 3 confirmation levels', () => {
    expect(ATSS_CONFIRMATION_LEVELS).toEqual(['none', 'inform', 'confirm']);
  });

  it('should map every tool to a confirmation level', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      expect(ATSS_TOOL_CONFIRMATION[tool]).toBeDefined();
      expect(ATSS_CONFIRMATION_LEVELS).toContain(ATSS_TOOL_CONFIRMATION[tool]);
    }
  });

  it('should give read tools no confirmation', () => {
    expect(ATSS_TOOL_CONFIRMATION.view_node).toBe('none');
    expect(ATSS_TOOL_CONFIRMATION.search).toBe('none');
  });

  it('should give destructive tools confirm level', () => {
    expect(ATSS_TOOL_CONFIRMATION.delete_node).toBe('confirm');
    expect(ATSS_TOOL_CONFIRMATION.bulk_operations).toBe('confirm');
  });

  it('should map every tool to an undo TTL', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      expect(typeof ATSS_UNDO_TTL_SECONDS[tool]).toBe('number');
    }
  });

  it('should give read tools 0 TTL (not undoable)', () => {
    expect(ATSS_UNDO_TTL_SECONDS.view_node).toBe(0);
    expect(ATSS_UNDO_TTL_SECONDS.search).toBe(0);
  });

  it('should give delete_node the longest TTL (30 days)', () => {
    expect(ATSS_UNDO_TTL_SECONDS.delete_node).toBe(2592000);
  });

  it('should have quick undo at 5 minutes', () => {
    expect(ATSS_QUICK_UNDO_SECONDS).toBe(300);
  });

  it('should have 4 undo statuses', () => {
    expect(ATSS_UNDO_STATUSES).toEqual(['undoable', 'undone', 'expired', 'redone']);
  });

  it('should map every tool to a credit cost', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      expect(typeof ATSS_CREDIT_COSTS[tool]).toBe('number');
    }
  });

  it('should give read tools 0 credits', () => {
    expect(ATSS_CREDIT_COSTS.view_node).toBe(0);
    expect(ATSS_CREDIT_COSTS.search).toBe(0);
  });

  it('should give create_node 3 credits', () => {
    expect(ATSS_CREDIT_COSTS.create_node).toBe(3);
  });

  it('should have 3 tiers', () => {
    expect(ATSS_TIERS).toEqual(['free', 'credits', 'pro']);
  });

  it('should map every tool to rate limits', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      expect(ATSS_RATE_LIMITS[tool]).toBeDefined();
      expect(ATSS_RATE_LIMITS[tool].perSecond).toBeGreaterThan(0);
      expect(ATSS_RATE_LIMITS[tool].burst).toBeGreaterThanOrEqual(ATSS_RATE_LIMITS[tool].perSecond);
    }
  });

  it('should have circuit breaker max failures at 3', () => {
    expect(ATSS_CIRCUIT_BREAKER_MAX_FAILURES).toBe(3);
  });

  it('should have tool timeout at 10 seconds', () => {
    expect(ATSS_TOOL_TIMEOUT_MS).toBe(10000);
  });

  it('should have 3 circuit breaker states', () => {
    expect(ATSS_CIRCUIT_BREAKER_STATES).toEqual(['closed', 'open', 'half_open']);
  });

  it('should have 2 bulk modes', () => {
    expect(ATSS_BULK_MODES).toEqual(['all_or_nothing', 'continue_on_error']);
  });

  it('should have 8 error prefixes', () => {
    expect(ATSS_ERROR_PREFIXES).toHaveLength(8);
  });

  it('should have a description for every tool', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      expect(ATSS_TOOL_DESCRIPTIONS[tool]).toBeDefined();
      expect(ATSS_TOOL_DESCRIPTIONS[tool].length).toBeGreaterThan(10);
    }
  });

  it('should have correct validation limits', () => {
    expect(ATSS_MAX_NODE_IDS_PER_VIEW).toBe(20);
    expect(ATSS_MAX_SEARCH_LIMIT).toBe(50);
    expect(ATSS_DEFAULT_SEARCH_LIMIT).toBe(10);
    expect(ATSS_MAX_CONTENT_LENGTH).toBe(5000);
    expect(ATSS_DEFAULT_MAX_CONTENT_LENGTH).toBe(2000);
    expect(ATSS_MAX_TAGS).toBe(20);
    expect(ATSS_MAX_BULK_OPERATIONS).toBe(50);
    expect(ATSS_MIN_SEARCH_SCORE).toBe(0.0);
    expect(ATSS_DEFAULT_MIN_SEARCH_SCORE).toBe(0.3);
    expect(ATSS_UPDATE_CONFIDENCE_THRESHOLD).toBe(0.8);
  });

  it('should have correct ID prefixes', () => {
    expect(ATSS_TRANSACTION_ID_PREFIX).toBe('tx_');
    expect(ATSS_UNDO_ID_PREFIX).toBe('undo_');
  });

  it('should have inverse operations for every tool', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      expect(tool in ATSS_INVERSE_OPERATIONS).toBe(true);
    }
  });

  it('should have null inverse for read tools', () => {
    expect(ATSS_INVERSE_OPERATIONS.view_node).toBeNull();
    expect(ATSS_INVERSE_OPERATIONS.search).toBeNull();
  });

  it('should have 26 error codes', () => {
    expect(ATSS_ERROR_CODE_KEYS).toHaveLength(26);
  });

  it('should have correct tier configs', () => {
    expect(ATSS_TIER_CONFIGS.free.daily_credit_limit).toBe(5);
    expect(ATSS_TIER_CONFIGS.free.can_bulk).toBe(false);
    expect(ATSS_TIER_CONFIGS.credits.can_bulk).toBe(true);
    expect(ATSS_TIER_CONFIGS.pro.can_bulk).toBe(true);
  });

  it('should have 3 retryable error codes', () => {
    expect(ATSS_RETRYABLE_ERROR_CODES).toHaveLength(3);
    expect(ATSS_RETRYABLE_ERROR_CODES).toContain('E429_RATE_LIMITED');
    expect(ATSS_RETRYABLE_ERROR_CODES).toContain('E503_LLM_UNAVAILABLE');
    expect(ATSS_RETRYABLE_ERROR_CODES).toContain('E504_TOOL_TIMEOUT');
  });

  it('should have synthesize formats for every tool', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      expect(ATSS_SYNTHESIZE_FORMATS[tool]).toBeDefined();
      expect(ATSS_SYNTHESIZE_FORMATS[tool].length).toBeGreaterThan(0);
    }
  });

  it('should have bulk reference patterns', () => {
    expect(ATSS_BULK_REFERENCE_PATTERNS.byIndex).toBeInstanceOf(RegExp);
    expect(ATSS_BULK_REFERENCE_PATTERNS.byId).toBeInstanceOf(RegExp);
    expect(ATSS_BULK_REFERENCE_PATTERNS.byLast).toBeInstanceOf(RegExp);
  });

  it('should match valid bulk references', () => {
    expect(ATSS_BULK_REFERENCE_PATTERNS.byIndex.test('{{0.node_id}}')).toBe(true);
    expect(ATSS_BULK_REFERENCE_PATTERNS.byId.test('{{create_op.node_id}}')).toBe(true);
    expect(ATSS_BULK_REFERENCE_PATTERNS.byLast.test('{{$last.node_id}}')).toBe(true);
  });
});

// ============================================================
// SCHEMA VALIDATION TESTS
// ============================================================

describe('Schema Validation', () => {
  it('should validate tool names', () => {
    expect(AtssToolNameSchema.safeParse('view_node').success).toBe(true);
    expect(AtssToolNameSchema.safeParse('invalid_tool').success).toBe(false);
  });

  it('should validate tool categories', () => {
    expect(AtssToolCategorySchema.safeParse('read').success).toBe(true);
    expect(AtssToolCategorySchema.safeParse('invalid').success).toBe(false);
  });

  it('should validate confirmation levels', () => {
    expect(AtssConfirmationLevelSchema.safeParse('none').success).toBe(true);
    expect(AtssConfirmationLevelSchema.safeParse('inform').success).toBe(true);
    expect(AtssConfirmationLevelSchema.safeParse('confirm').success).toBe(true);
    expect(AtssConfirmationLevelSchema.safeParse('deny').success).toBe(false);
  });

  it('should validate undo statuses', () => {
    expect(AtssUndoStatusSchema.safeParse('undoable').success).toBe(true);
    expect(AtssUndoStatusSchema.safeParse('deleted').success).toBe(false);
  });

  it('should validate tiers', () => {
    expect(AtssTierSchema.safeParse('free').success).toBe(true);
    expect(AtssTierSchema.safeParse('enterprise').success).toBe(false);
  });

  it('should validate circuit breaker states', () => {
    expect(AtssCircuitBreakerStateSchema.safeParse('closed').success).toBe(true);
    expect(AtssCircuitBreakerStateSchema.safeParse('half_open').success).toBe(true);
    expect(AtssCircuitBreakerStateSchema.safeParse('tripped').success).toBe(false);
  });

  it('should validate bulk modes', () => {
    expect(AtssBulkModeSchema.safeParse('all_or_nothing').success).toBe(true);
    expect(AtssBulkModeSchema.safeParse('ignore_errors').success).toBe(false);
  });
});

// ============================================================
// ID GENERATION TESTS
// ============================================================

describe('ID Generation', () => {
  it('should generate transaction IDs with tx_ prefix', () => {
    const id = generateTransactionId();
    expect(id).toMatch(/^tx_[a-zA-Z0-9_-]{12}$/);
  });

  it('should generate undo IDs with undo_ prefix', () => {
    const id = generateUndoId();
    expect(id).toMatch(/^undo_[a-zA-Z0-9_-]{12}$/);
  });

  it('should generate unique transaction IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTransactionId()));
    expect(ids.size).toBe(100);
  });

  it('should generate unique undo IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUndoId()));
    expect(ids.size).toBe(100);
  });
});

// ============================================================
// TOOL SCHEMA TESTS - view_node
// ============================================================

describe('Tool Schemas - view_node', () => {
  it('should accept valid params', () => {
    const result = AtssViewNodeParamsSchema.safeParse({
      node_ids: ['n_abc123def456'],
    });
    expect(result.success).toBe(true);
  });

  it('should require node_ids', () => {
    const result = AtssViewNodeParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject empty node_ids', () => {
    const result = AtssViewNodeParamsSchema.safeParse({ node_ids: [] });
    expect(result.success).toBe(false);
  });

  it('should reject too many node_ids', () => {
    const ids = Array.from({ length: 21 }, (_, i) => `n_id${i}`);
    const result = AtssViewNodeParamsSchema.safeParse({ node_ids: ids });
    expect(result.success).toBe(false);
  });

  it('should apply defaults', () => {
    const result = AtssViewNodeParamsSchema.parse({ node_ids: ['n_abc'] });
    expect(result.include_metadata).toBe(false);
    expect(result.include_connections).toBe(false);
    expect(result.include_deleted).toBe(false);
    expect(result.max_content_length).toBe(ATSS_DEFAULT_MAX_CONTENT_LENGTH);
  });
});

// ============================================================
// TOOL SCHEMA TESTS - search
// ============================================================

describe('Tool Schemas - search', () => {
  it('should accept valid params', () => {
    const result = AtssSearchParamsSchema.safeParse({ query: 'test query' });
    expect(result.success).toBe(true);
  });

  it('should require non-empty query', () => {
    const result = AtssSearchParamsSchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
  });

  it('should apply default limit', () => {
    const result = AtssSearchParamsSchema.parse({ query: 'test' });
    expect(result.limit).toBe(ATSS_DEFAULT_SEARCH_LIMIT);
  });

  it('should reject limit over max', () => {
    const result = AtssSearchParamsSchema.safeParse({ query: 'test', limit: 100 });
    expect(result.success).toBe(false);
  });

  it('should apply default min_score', () => {
    const result = AtssSearchParamsSchema.parse({ query: 'test' });
    expect(result.min_score).toBe(ATSS_DEFAULT_MIN_SEARCH_SCORE);
  });

  it('should accept filters', () => {
    const result = AtssSearchParamsSchema.safeParse({
      query: 'test',
      filters: { types: ['concept'], tags: ['important'] },
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================
// TOOL SCHEMA TESTS - create_node
// ============================================================

describe('Tool Schemas - create_node', () => {
  it('should accept valid params', () => {
    const result = AtssCreateNodeParamsSchema.safeParse({
      type: 'concept',
      title: 'Test Node',
      content: 'Test content',
    });
    expect(result.success).toBe(true);
  });

  it('should require type, title, and content', () => {
    expect(AtssCreateNodeParamsSchema.safeParse({}).success).toBe(false);
    expect(AtssCreateNodeParamsSchema.safeParse({ type: 'concept' }).success).toBe(false);
    expect(AtssCreateNodeParamsSchema.safeParse({ type: 'concept', title: 'T' }).success).toBe(false);
  });

  it('should validate node type', () => {
    const result = AtssCreateNodeParamsSchema.safeParse({
      type: 'invalid_type',
      title: 'Test',
      content: 'Content',
    });
    expect(result.success).toBe(false);
  });

  it('should reject too many tags', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    const result = AtssCreateNodeParamsSchema.safeParse({
      type: 'concept',
      title: 'Test',
      content: 'Content',
      tags,
    });
    expect(result.success).toBe(false);
  });

  it('should reject content over max length', () => {
    const result = AtssCreateNodeParamsSchema.safeParse({
      type: 'concept',
      title: 'Test',
      content: 'x'.repeat(ATSS_MAX_CONTENT_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it('should default dry_run to false', () => {
    const result = AtssCreateNodeParamsSchema.parse({
      type: 'concept',
      title: 'Test',
      content: 'Content',
    });
    expect(result.dry_run).toBe(false);
  });
});

// ============================================================
// TOOL SCHEMA TESTS - update_node
// ============================================================

describe('Tool Schemas - update_node', () => {
  it('should accept valid params', () => {
    const result = AtssUpdateNodeParamsSchema.safeParse({
      node_id: 'n_abc123def456',
      changes: { title: 'New Title' },
    });
    expect(result.success).toBe(true);
  });

  it('should require at least one change', () => {
    const result = AtssNodeChangesSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should default confidence to 1.0', () => {
    const result = AtssUpdateNodeParamsSchema.parse({
      node_id: 'n_abc',
      changes: { title: 'New' },
    });
    expect(result.confidence).toBe(1.0);
  });
});

// ============================================================
// TOOL SCHEMA TESTS - delete_node
// ============================================================

describe('Tool Schemas - delete_node', () => {
  it('should accept valid params', () => {
    const result = AtssDeleteNodeParamsSchema.safeParse({
      node_id: 'n_abc123def456',
    });
    expect(result.success).toBe(true);
  });

  it('should default cascade_edges to true', () => {
    const result = AtssDeleteNodeParamsSchema.parse({ node_id: 'n_abc' });
    expect(result.cascade_edges).toBe(true);
  });
});

// ============================================================
// TOOL SCHEMA TESTS - create_edge
// ============================================================

describe('Tool Schemas - create_edge', () => {
  it('should accept valid params', () => {
    const result = AtssCreateEdgeParamsSchema.safeParse({
      source_id: 'n_abc',
      target_id: 'n_def',
      relation_type: 'relates_to',
    });
    expect(result.success).toBe(true);
  });

  it('should validate edge type', () => {
    const result = AtssCreateEdgeParamsSchema.safeParse({
      source_id: 'n_abc',
      target_id: 'n_def',
      relation_type: 'invalid_type',
    });
    expect(result.success).toBe(false);
  });

  it('should reject self-edges', () => {
    const result = AtssCreateEdgeParamsSchema.safeParse({
      source_id: 'n_abc',
      target_id: 'n_abc',
      relation_type: 'relates_to',
    });
    expect(result.success).toBe(false);
  });

  it('should default weight to 0.5', () => {
    const result = AtssCreateEdgeParamsSchema.parse({
      source_id: 'n_abc',
      target_id: 'n_def',
      relation_type: 'relates_to',
    });
    expect(result.weight).toBe(0.5);
  });

  it('should default bidirectional to false', () => {
    const result = AtssCreateEdgeParamsSchema.parse({
      source_id: 'n_abc',
      target_id: 'n_def',
      relation_type: 'relates_to',
    });
    expect(result.bidirectional).toBe(false);
  });
});

// ============================================================
// TOOL SCHEMA TESTS - delete_edge
// ============================================================

describe('Tool Schemas - delete_edge', () => {
  it('should accept valid params', () => {
    const result = AtssDeleteEdgeParamsSchema.safeParse({ edge_id: 'e_abc' });
    expect(result.success).toBe(true);
  });

  it('should require edge_id', () => {
    const result = AtssDeleteEdgeParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ============================================================
// TOOL SCHEMA TESTS - link_to_cluster
// ============================================================

describe('Tool Schemas - link_to_cluster', () => {
  it('should accept valid params', () => {
    const result = AtssLinkToClusterParamsSchema.safeParse({
      node_id: 'n_abc',
      cluster_id: 'cluster_1',
    });
    expect(result.success).toBe(true);
  });

  it('should default create_if_missing to false', () => {
    const result = AtssLinkToClusterParamsSchema.parse({
      node_id: 'n_abc',
      cluster_id: 'cluster_1',
    });
    expect(result.create_if_missing).toBe(false);
  });
});

// ============================================================
// TOOL SCHEMA TESTS - bulk_operations
// ============================================================

describe('Tool Schemas - bulk_operations', () => {
  it('should accept valid params', () => {
    const result = AtssBulkOperationsParamsSchema.safeParse({
      operations: [
        { tool: 'create_node', params: { type: 'concept', title: 'T', content: 'C' } },
      ],
      mode: 'all_or_nothing',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty operations', () => {
    const result = AtssBulkOperationsParamsSchema.safeParse({
      operations: [],
      mode: 'all_or_nothing',
    });
    expect(result.success).toBe(false);
  });

  it('should reject too many operations', () => {
    const ops = Array.from({ length: 51 }, () => ({
      tool: 'view_node' as const,
      params: { node_ids: ['n_abc'] },
    }));
    const result = AtssBulkOperationsParamsSchema.safeParse({
      operations: ops,
      mode: 'continue_on_error',
    });
    expect(result.success).toBe(false);
  });

  it('should validate bulk mode', () => {
    const result = AtssBulkOperationsParamsSchema.safeParse({
      operations: [{ tool: 'search', params: { query: 'test' } }],
      mode: 'invalid_mode',
    });
    expect(result.success).toBe(false);
  });

  it('should allow read-only tools in bulk', () => {
    const result = AtssBulkOperationsParamsSchema.safeParse({
      operations: [
        { tool: 'view_node', params: { node_ids: ['n_abc'] } },
        { tool: 'search', params: { query: 'test' } },
      ],
      mode: 'continue_on_error',
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================
// TOOL DEFINITIONS TESTS
// ============================================================

describe('Tool Definitions', () => {
  it('should have a definition for every tool', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      const def = getToolDefinition(tool);
      expect(def).toBeDefined();
      expect(def.name).toBe(tool);
    }
  });

  it('should have consistent categories', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      const def = getToolDefinition(tool);
      expect(def.category).toBe(ATSS_TOOL_TO_CATEGORY[tool]);
    }
  });

  it('should have consistent confirmation levels', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      const def = getToolDefinition(tool);
      expect(def.confirmation).toBe(ATSS_TOOL_CONFIRMATION[tool]);
    }
  });

  it('should have consistent credit costs', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      const def = getToolDefinition(tool);
      expect(def.credit_cost).toBe(ATSS_CREDIT_COSTS[tool]);
    }
  });

  it('should have synthesize formats', () => {
    for (const tool of ATSS_TOOL_NAMES) {
      const def = getToolDefinition(tool);
      expect(def.synthesize_format.length).toBeGreaterThan(0);
    }
  });

  it('should be accessible via ATSS_TOOL_DEFINITIONS', () => {
    expect(Object.keys(ATSS_TOOL_DEFINITIONS)).toHaveLength(9);
  });
});

// ============================================================
// UNDO SYSTEM TESTS
// ============================================================

describe('Undo System', () => {
  const makeEntry = (overrides: Partial<AtssUndoEntry> = {}): AtssUndoEntry => ({
    id: 'undo_test12test34',
    _schemaVersion: 1,
    timestamp: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    quick_undo_until: new Date(Date.now() + 300000).toISOString(),
    tool: 'create_node',
    params: { type: 'concept', title: 'Test', content: 'Content' },
    result: { node_id: 'n_abc123def456', success: true },
    inverse_tool: 'delete_node',
    inverse_params: { node_id: 'n_abc123def456', cascade_edges: true },
    status: 'undoable',
    depends_on: [],
    enables: [],
    user_id: 'user_123',
    session_id: 'session_456',
    credit_cost: 3,
    ...overrides,
  });

  describe('createUndoEntry', () => {
    it('should create a valid undo entry for create_node', () => {
      const entry = createUndoEntry(
        'create_node',
        { type: 'concept', title: 'Test', content: 'Content' },
        { node_id: 'n_abc', success: true },
        'user_1',
        'session_1',
      );
      expect(entry).not.toBeNull();
      expect(entry!.id).toMatch(/^undo_/);
      expect(entry!._schemaVersion).toBe(1);
      expect(entry!.tool).toBe('create_node');
      expect(entry!.inverse_tool).toBe('delete_node');
      expect(entry!.status).toBe('undoable');
      expect(entry!.credit_cost).toBe(3);
    });

    it('should return null for read-only tools', () => {
      expect(createUndoEntry('view_node', {}, {}, 'u', 's')).toBeNull();
      expect(createUndoEntry('search', {}, {}, 'u', 's')).toBeNull();
    });

    it('should set expires_at correctly', () => {
      const before = Date.now();
      const entry = createUndoEntry('create_node', {}, { node_id: 'n_x' }, 'u', 's')!;
      const after = Date.now();
      const expiresAt = new Date(entry.expires_at).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 86400 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + 86400 * 1000);
    });

    it('should set quick_undo_until correctly', () => {
      const before = Date.now();
      const entry = createUndoEntry('create_node', {}, { node_id: 'n_x' }, 'u', 's')!;
      const quickUntil = new Date(entry.quick_undo_until).getTime();
      expect(quickUntil).toBeGreaterThanOrEqual(before + 300 * 1000);
    });
  });

  describe('buildInverseParams', () => {
    it('should build inverse for create_node', () => {
      const inv = buildInverseParams('create_node', {}, { node_id: 'n_abc' });
      expect(inv.node_id).toBe('n_abc');
      expect(inv.cascade_edges).toBe(true);
    });

    it('should build inverse for update_node', () => {
      const inv = buildInverseParams(
        'update_node',
        { node_id: 'n_abc', changes: { title: 'New' } },
        { previous_values: { title: 'Old' } },
      );
      expect(inv.node_id).toBe('n_abc');
      expect(inv.changes).toEqual({ title: 'Old' });
    });

    it('should build inverse for create_edge', () => {
      const inv = buildInverseParams('create_edge', {}, { edge_id: 'e_abc' });
      expect(inv.edge_id).toBe('e_abc');
    });

    it('should build inverse for link_to_cluster', () => {
      const inv = buildInverseParams(
        'link_to_cluster',
        { node_id: 'n_abc', cluster_id: 'new_cluster' },
        { previous_cluster: 'old_cluster' },
      );
      expect(inv.node_id).toBe('n_abc');
      expect(inv.cluster_id).toBe('old_cluster');
    });
  });

  describe('isUndoable', () => {
    it('should return true for undoable, non-expired entries', () => {
      expect(isUndoable(makeEntry())).toBe(true);
    });

    it('should return false for expired entries', () => {
      const entry = makeEntry({
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      expect(isUndoable(entry)).toBe(false);
    });

    it('should return false for already-undone entries', () => {
      expect(isUndoable(makeEntry({ status: 'undone' }))).toBe(false);
    });

    it('should return false for expired status entries', () => {
      expect(isUndoable(makeEntry({ status: 'expired' }))).toBe(false);
    });
  });

  describe('isQuickUndoWindow', () => {
    it('should return true within 5 minutes', () => {
      expect(isQuickUndoWindow(makeEntry())).toBe(true);
    });

    it('should return false after quick undo window', () => {
      const entry = makeEntry({
        quick_undo_until: new Date(Date.now() - 1000).toISOString(),
      });
      expect(isQuickUndoWindow(entry)).toBe(false);
    });

    it('should return false for non-undoable entries', () => {
      expect(isQuickUndoWindow(makeEntry({ status: 'undone' }))).toBe(false);
    });
  });

  describe('getInverseOperation', () => {
    it('should return correct inverse for create_node', () => {
      const entry = makeEntry();
      const inv = getInverseOperation(entry);
      expect(inv).not.toBeNull();
      expect(inv!.tool).toBe('delete_node');
    });

    it('should return null for read tools', () => {
      const entry = makeEntry({ tool: 'view_node' });
      expect(getInverseOperation(entry)).toBeNull();
    });
  });

  describe('checkDependencies', () => {
    it('should allow undo when no dependencies', () => {
      const entry = makeEntry();
      const result = checkDependencies(entry, []);
      expect(result.canUndo).toBe(true);
      expect(result.blockedBy).toEqual([]);
    });

    it('should block undo when dependent entries exist', () => {
      const entry = makeEntry({ id: 'undo_parent12345' });
      const dependent = makeEntry({
        id: 'undo_child123456',
        depends_on: ['undo_parent12345'],
      });
      const result = checkDependencies(entry, [dependent]);
      expect(result.canUndo).toBe(false);
      expect(result.blockedBy).toContain('undo_child123456');
    });

    it('should allow undo when dependent is already undone', () => {
      const entry = makeEntry({ id: 'undo_parent12345' });
      const dependent = makeEntry({
        id: 'undo_child123456',
        depends_on: ['undo_parent12345'],
        status: 'undone',
      });
      const result = checkDependencies(entry, [dependent]);
      expect(result.canUndo).toBe(true);
    });
  });

  describe('AtssUndoEntrySchema', () => {
    it('should validate a well-formed entry', () => {
      const result = AtssUndoEntrySchema.safeParse(makeEntry());
      expect(result.success).toBe(true);
    });

    it('should require _schemaVersion', () => {
      const entry = { ...makeEntry() } as Record<string, unknown>;
      delete entry._schemaVersion;
      const result = AtssUndoEntrySchema.safeParse(entry);
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================
// PERMISSION & CONFIRMATION TESTS
// ============================================================

describe('Permission & Confirmation', () => {
  it('should return none for read tools', () => {
    expect(getConfirmationLevel('view_node', {})).toBe('none');
    expect(getConfirmationLevel('search', {})).toBe('none');
  });

  it('should return inform for create tools', () => {
    expect(getConfirmationLevel('create_node', {})).toBe('inform');
    expect(getConfirmationLevel('create_edge', {})).toBe('inform');
  });

  it('should return confirm for destructive tools', () => {
    expect(getConfirmationLevel('delete_node', {})).toBe('confirm');
    expect(getConfirmationLevel('bulk_operations', {})).toBe('confirm');
  });

  it('should upgrade update_node to confirm when confidence is low', () => {
    expect(getConfirmationLevel('update_node', { confidence: 0.5 })).toBe('confirm');
    expect(getConfirmationLevel('update_node', { confidence: 0.79 })).toBe('confirm');
  });

  it('should keep update_node at confirm when confidence is at threshold', () => {
    // 0.8 is NOT less than 0.8, so it should stay at base level (confirm)
    expect(getConfirmationLevel('update_node', { confidence: 0.8 })).toBe('confirm');
  });

  it('should keep update_node at confirm when confidence is high', () => {
    expect(getConfirmationLevel('update_node', { confidence: 1.0 })).toBe('confirm');
  });

  describe('checkCreditSufficiency', () => {
    it('should return sufficient when balance >= cost', () => {
      expect(checkCreditSufficiency(3, 10)).toEqual({ sufficient: true, shortfall: 0 });
    });

    it('should return insufficient with correct shortfall', () => {
      expect(checkCreditSufficiency(5, 3)).toEqual({ sufficient: false, shortfall: 2 });
    });

    it('should handle zero cost', () => {
      expect(checkCreditSufficiency(0, 0)).toEqual({ sufficient: true, shortfall: 0 });
    });

    it('should handle exact balance', () => {
      expect(checkCreditSufficiency(5, 5)).toEqual({ sufficient: true, shortfall: 0 });
    });
  });

  describe('calculateBulkCost', () => {
    it('should sum individual operation costs', () => {
      const ops = [
        { tool: 'create_node' as AtssToolName, params: {} },
        { tool: 'create_edge' as AtssToolName, params: {} },
        { tool: 'create_edge' as AtssToolName, params: {} },
      ];
      expect(calculateBulkCost(ops)).toBe(5); // 3 + 1 + 1
    });

    it('should return 0 for read-only operations', () => {
      const ops = [
        { tool: 'view_node' as AtssToolName, params: {} },
        { tool: 'search' as AtssToolName, params: {} },
      ];
      expect(calculateBulkCost(ops)).toBe(0);
    });
  });

  describe('shouldRequireConfirmation', () => {
    it('should return false for read tools', () => {
      expect(shouldRequireConfirmation('view_node', {})).toBe(false);
    });

    it('should return false for inform tools', () => {
      expect(shouldRequireConfirmation('create_node', {})).toBe(false);
    });

    it('should return true for confirm tools', () => {
      expect(shouldRequireConfirmation('delete_node', {})).toBe(true);
      expect(shouldRequireConfirmation('update_node', {})).toBe(true);
    });
  });
});

// ============================================================
// CIRCUIT BREAKER TESTS
// ============================================================

describe('Circuit Breaker', () => {
  it('should create in closed state', () => {
    const cb = createCircuitBreaker();
    expect(cb.state).toBe('closed');
    expect(cb.consecutive_failures).toBe(0);
  });

  it('should allow requests when closed', () => {
    const cb = createCircuitBreaker();
    expect(shouldAllowRequest(cb)).toBe(true);
  });

  it('should block requests when open', () => {
    const cb = tripCircuitBreaker(createCircuitBreaker());
    expect(cb.state).toBe('open');
    expect(shouldAllowRequest(cb)).toBe(false);
  });

  it('should allow requests when half_open', () => {
    const cb: AtssCircuitBreaker = {
      state: 'half_open',
      consecutive_failures: 2,
    };
    expect(shouldAllowRequest(cb)).toBe(true);
  });

  it('should increment failure count', () => {
    let cb = createCircuitBreaker();
    cb = atssRecordFailure(cb);
    expect(cb.consecutive_failures).toBe(1);
    expect(cb.state).toBe('closed');
  });

  it('should trip at threshold', () => {
    let cb = createCircuitBreaker();
    cb = atssRecordFailure(cb);
    cb = atssRecordFailure(cb);
    cb = atssRecordFailure(cb);
    expect(cb.consecutive_failures).toBe(3);
    expect(cb.state).toBe('open');
    expect(cb.tripped_at).toBeDefined();
  });

  it('should reset on success', () => {
    let cb = createCircuitBreaker();
    cb = atssRecordFailure(cb);
    cb = atssRecordFailure(cb);
    cb = atssRecordSuccess(cb);
    expect(cb.state).toBe('closed');
    expect(cb.consecutive_failures).toBe(0);
    expect(cb.last_success_at).toBeDefined();
  });

  it('should reset via resetCircuitBreaker', () => {
    let cb = tripCircuitBreaker(createCircuitBreaker());
    cb = resetCircuitBreaker(cb);
    expect(cb.state).toBe('closed');
    expect(cb.consecutive_failures).toBe(0);
    expect(cb.tripped_at).toBeUndefined();
  });

  it('should validate schema', () => {
    const result = AtssCircuitBreakerSchema.safeParse(createCircuitBreaker());
    expect(result.success).toBe(true);
  });
});

// ============================================================
// RATE LIMITING TESTS
// ============================================================

describe('Rate Limiting', () => {
  const makeState = (overrides: Partial<AtssRateLimitState> = {}): AtssRateLimitState => ({
    tool: 'search',
    window_start: new Date().toISOString(),
    request_count: 0,
    burst_count: 0,
    ...overrides,
  });

  it('should allow requests within limit', () => {
    const state = makeState();
    const result = checkRateLimit(state, 'search');
    expect(result.allowed).toBe(true);
  });

  it('should allow requests in a new window', () => {
    const state = makeState({
      window_start: new Date(Date.now() - 2000).toISOString(),
      request_count: 100,
    });
    const result = checkRateLimit(state, 'search');
    expect(result.allowed).toBe(true);
  });

  it('should deny when both rate and burst exceeded', () => {
    const state = makeState({
      request_count: 5,
      burst_count: 10,
    });
    const result = checkRateLimit(state, 'search');
    expect(result.allowed).toBe(false);
    expect(result.retry_after_ms).toBeGreaterThan(0);
  });

  it('should record a request and increment count', () => {
    const state = makeState();
    const updated = recordRateLimitRequest(state);
    expect(updated.request_count).toBe(1);
  });

  it('should reset window on new period', () => {
    const state = makeState({
      window_start: new Date(Date.now() - 2000).toISOString(),
      request_count: 100,
      burst_count: 50,
    });
    const updated = recordRateLimitRequest(state);
    expect(updated.request_count).toBe(1);
    expect(updated.burst_count).toBe(0);
  });
});

// ============================================================
// DRY RUN TESTS
// ============================================================

describe('Dry Run', () => {
  it('should return correct preview for create_node', () => {
    const result = executeDryRun('create_node', {
      type: 'concept',
      title: 'Test',
      content: 'Content',
    });
    expect(result.would_succeed).toBe(true);
    expect(result.credits_required).toBe(3);
    expect(result.confirmation_required).toBe('inform');
    expect(result.side_effects.length).toBeGreaterThan(0);
  });

  it('should identify cascade side effect for delete_node', () => {
    const result = executeDryRun('delete_node', { node_id: 'n_abc' });
    expect(result.side_effects).toContain('Node will be soft-deleted (restorable)');
    expect(result.side_effects).toContain('Connected edges will be removed');
  });

  it('should not include cascade when disabled', () => {
    const result = executeDryRun('delete_node', {
      node_id: 'n_abc',
      cascade_edges: false,
    });
    expect(result.side_effects).not.toContain('Connected edges will be removed');
  });

  it('should warn about low confidence on update_node', () => {
    const result = executeDryRun('update_node', {
      node_id: 'n_abc',
      confidence: 0.5,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.confirmation_required).toBe('confirm');
  });

  it('should show bidirectional side effect', () => {
    const result = executeDryRun('create_edge', {
      source_id: 'n_a',
      target_id: 'n_b',
      bidirectional: true,
    });
    expect(result.side_effects).toContain('Reverse edge will also be created');
  });

  it('should validate DryRunResult schema', () => {
    const result = executeDryRun('search', { query: 'test' });
    const validation = AtssDryRunResultSchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  it('should return 0 credits for read operations', () => {
    expect(executeDryRun('view_node', {}).credits_required).toBe(0);
    expect(executeDryRun('search', {}).credits_required).toBe(0);
  });
});

// ============================================================
// ERROR RESPONSE TESTS
// ============================================================

describe('Error Responses', () => {
  it('should create valid error response', () => {
    const error = createErrorResponse('E400_INVALID_PARAMS', 'create_node');
    expect(error.error).toBe(true);
    expect(error.code).toBe('E400_INVALID_PARAMS');
    expect(error.message).toBe('Invalid parameters provided');
    expect(error.tool).toBe('create_node');
    expect(error.timestamp).toBeDefined();
  });

  it('should include details when provided', () => {
    const error = createErrorResponse('E404_NODE_NOT_FOUND', 'view_node', {
      node_id: 'n_missing',
    });
    expect(error.details).toEqual({ node_id: 'n_missing' });
  });

  it('should have ISO 8601 timestamp', () => {
    const error = createErrorResponse('E500_INTERNAL');
    expect(() => new Date(error.timestamp)).not.toThrow();
  });

  it('should validate error schema', () => {
    const error = createErrorResponse('E429_RATE_LIMITED', 'search');
    const result = AtssErrorResponseSchema.safeParse(error);
    expect(result.success).toBe(true);
  });

  describe('getHttpStatus', () => {
    it('should return correct HTTP status for each category', () => {
      expect(getHttpStatus('E400_INVALID_PARAMS')).toBe(400);
      expect(getHttpStatus('E403_INSUFFICIENT_CREDITS')).toBe(403);
      expect(getHttpStatus('E404_NODE_NOT_FOUND')).toBe(404);
      expect(getHttpStatus('E409_DUPLICATE_EDGE')).toBe(409);
      expect(getHttpStatus('E429_RATE_LIMITED')).toBe(429);
      expect(getHttpStatus('E500_INTERNAL')).toBe(500);
      expect(getHttpStatus('E503_LLM_UNAVAILABLE')).toBe(503);
      expect(getHttpStatus('E504_TOOL_TIMEOUT')).toBe(504);
    });
  });

  describe('isRetryable', () => {
    it('should return true for retryable codes', () => {
      expect(isRetryable('E429_RATE_LIMITED')).toBe(true);
      expect(isRetryable('E503_LLM_UNAVAILABLE')).toBe(true);
      expect(isRetryable('E504_TOOL_TIMEOUT')).toBe(true);
    });

    it('should return false for non-retryable codes', () => {
      expect(isRetryable('E400_INVALID_PARAMS')).toBe(false);
      expect(isRetryable('E403_INSUFFICIENT_CREDITS')).toBe(false);
      expect(isRetryable('E404_NODE_NOT_FOUND')).toBe(false);
      expect(isRetryable('E409_DUPLICATE_EDGE')).toBe(false);
      expect(isRetryable('E500_INTERNAL')).toBe(false);
    });
  });

  it('should have all 26 error codes with valid definitions', () => {
    expect(ATSS_ERROR_CODE_KEYS).toHaveLength(26);
    for (const code of ATSS_ERROR_CODE_KEYS) {
      const def = ATSS_ERROR_CODES[code];
      expect(def.code).toBeDefined();
      expect(def.http).toBeGreaterThanOrEqual(400);
      expect(def.http).toBeLessThanOrEqual(504);
      expect(def.message.length).toBeGreaterThan(0);
    }
  });
});
