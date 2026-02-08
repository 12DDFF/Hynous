import { describe, it, expect } from 'vitest';
import {
  // Constants
  CW_SCHEMA_VERSION,
  DEFAULT_SYSTEM_PROMPT_TOKENS,
  DEFAULT_MIN_USER_TOKENS,
  PROVIDER_RETRIEVAL_RATIOS,
  DEFAULT_RESPONSE_BUFFERS,
  DEFAULT_RESPONSE_BUFFER_FALLBACK,
  DEFAULT_PRIORITY_WEIGHTS,
  PRIORITY_WEIGHT_NAMES,
  RECENCY_HALF_LIFE_DAYS,
  CONNECTIVITY_CAP_FACTOR,
  TRUNCATION_TIERS,
  TRUNCATION_MAX_LATENCY_MS,
  SEMANTIC_TRUNCATION_KEEP_START,
  SEMANTIC_TRUNCATION_KEEP_END,
  SPARSE_RETRIEVAL_THRESHOLD,
  SPARSE_EXTRA_RESPONSE_BUFFER,
  CONVERSATION_RECENT_TURNS,
  SUMMARIZATION_MODEL,
  SUMMARIZATION_TURN_TRIGGER,
  SUMMARIZATION_TOKEN_TRIGGER,
  CHUNKING_TRIGGER_TOKENS,
  CHUNK_TARGET_MIN,
  CHUNK_TARGET_MAX,
  CHUNK_HARD_MAX,
  CHUNK_ABSOLUTE_MAX,
  CHUNK_OVERLAP_IN_EMBEDDING,
  CHUNK_LEVELS,
  CHUNK_EDGE_TYPES,
  CHUNK_EXPANSION_MAX_TOKENS,
  CHUNK_SAME_DOC_THRESHOLD,
  CHUNK_HIGH_COUNT_THRESHOLD,
  TOKEN_ESTIMATE_CHARS_PER_TOKEN,

  // Type Guards (constants)
  isTruncationTier,
  isChunkLevel,
  isChunkEdgeType,
  isPriorityWeightName,

  // Schemas
  ModelContextBudgetSchema,
  ContextAllocationRequestSchema,
  ContextAllocationResultSchema,
  PrioritizedNodeSchema,
  PackedContextSchema,
  ChunkFieldsSchema,
  ParentFieldsSchema,
  TokenCountCacheSchema,
  ContextAssemblyMetricsSchema,
  ContextWindowConfigSchema,
  ConversationHistoryConfigSchema,
  ManagedHistorySchema,
  ChunkRetrievalConfigSchema,

  // Defaults
  DEFAULT_CONTEXT_WINDOW_CONFIG,

  // Functions
  getModelContextBudget,
  allocateContext,
  handleSparseRetrieval,
  calculateNodePriority,
  calculateRecencyScore,
  calculateConnectivityScore,
  packNodes,
  selectTruncationTier,
  semanticTruncate,
  hardTruncate,
  reorderForAttention,
  manageConversationHistory,
  estimateTokens,
  shouldChunk,
  calculateChunkCount,
  createChunkFields,
  createParentFields,
  shouldExpandChunks,
  shouldAggregateChunks,
  getDefaultContextWindowConfig,
  getDefaultChunkRetrievalConfig,

  // Types
  type PrioritizedNode,
  type NodePriorityFactors,
  type PriorityWeights,
  type ContextAllocationRequest,
  type ChunkRetrievalConfig,
  type ChunkingConfig,
  type ConversationHistoryConfig,
} from './index';

// ============================================================
// TEST DATA (from planning notes Section 14)
// ============================================================

const HIGH_PRIORITY_NODE: PrioritizedNode = {
  node_id: 'n1',
  priority_score: 0.95,
  tokens: 500,
  retrieval_score: 0.92,
  is_critical: false,
  was_truncated: false,
};

const MEDIUM_PRIORITY_NODE: PrioritizedNode = {
  node_id: 'n2',
  priority_score: 0.60,
  tokens: 1000,
  retrieval_score: 0.70,
  is_critical: false,
  was_truncated: false,
};

const CRITICAL_NODE: PrioritizedNode = {
  node_id: 'n3',
  priority_score: 0.40,
  tokens: 200,
  retrieval_score: 0.40,
  is_critical: true,
  was_truncated: false,
};

const LARGE_NODE: PrioritizedNode = {
  node_id: 'n4',
  priority_score: 0.80,
  tokens: 5000,
  retrieval_score: 0.85,
  is_critical: false,
  was_truncated: false,
};

// Text samples
const SHORT_TEXT = 'This is a short sentence.'; // ~7 tokens
const MEDIUM_TEXT = 'First paragraph. '.repeat(100); // ~486 tokens
const LONG_TEXT = 'Sentence with many words here. '.repeat(500); // ~2143 tokens
const VERY_LONG_TEXT = 'A '.repeat(10000); // ~5715 tokens

// ============================================================
// TESTS
// ============================================================

describe('Context Window', () => {
  // ============================================================
  // CONSTANTS
  // ============================================================

  describe('Constants', () => {
    it('CW_SCHEMA_VERSION is 1', () => {
      expect(CW_SCHEMA_VERSION).toBe(1);
    });

    it('DEFAULT_SYSTEM_PROMPT_TOKENS is 3000', () => {
      expect(DEFAULT_SYSTEM_PROMPT_TOKENS).toBe(3000);
    });

    it('DEFAULT_MIN_USER_TOKENS is 2000', () => {
      expect(DEFAULT_MIN_USER_TOKENS).toBe(2000);
    });

    it('PROVIDER_RETRIEVAL_RATIOS has all 3 providers', () => {
      expect(Object.keys(PROVIDER_RETRIEVAL_RATIOS)).toEqual(
        expect.arrayContaining(['anthropic', 'openai', 'google'])
      );
      expect(Object.keys(PROVIDER_RETRIEVAL_RATIOS).length).toBe(3);
    });

    it('PROVIDER_RETRIEVAL_RATIOS anthropic is 0.70', () => {
      expect(PROVIDER_RETRIEVAL_RATIOS['anthropic']).toBe(0.70);
    });

    it('PROVIDER_RETRIEVAL_RATIOS openai is 0.65', () => {
      expect(PROVIDER_RETRIEVAL_RATIOS['openai']).toBe(0.65);
    });

    it('DEFAULT_RESPONSE_BUFFERS has entries for all LLM models', () => {
      const expectedModels = [
        'claude-sonnet-4',
        'claude-3-haiku',
        'gpt-4o',
        'gpt-4o-mini',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
      ];
      expectedModels.forEach((model) => {
        expect(DEFAULT_RESPONSE_BUFFERS).toHaveProperty(model);
      });
    });

    it('DEFAULT_PRIORITY_WEIGHTS sum to 1.0', () => {
      const sum =
        DEFAULT_PRIORITY_WEIGHTS.retrieval_score +
        DEFAULT_PRIORITY_WEIGHTS.query_mentioned +
        DEFAULT_PRIORITY_WEIGHTS.recency +
        DEFAULT_PRIORITY_WEIGHTS.connectivity +
        DEFAULT_PRIORITY_WEIGHTS.importance;
      expect(sum).toBeCloseTo(1.0, 10);
    });

    it('PRIORITY_WEIGHT_NAMES has 5 entries', () => {
      expect(PRIORITY_WEIGHT_NAMES).toHaveLength(5);
    });

    it('TRUNCATION_TIERS has 4 entries', () => {
      expect(TRUNCATION_TIERS).toHaveLength(4);
    });

    it('TRUNCATION_MAX_LATENCY_MS is 100', () => {
      expect(TRUNCATION_MAX_LATENCY_MS).toBe(100);
    });

    it('SEMANTIC_TRUNCATION_KEEP_START + KEEP_END <= 1.0', () => {
      const sum = SEMANTIC_TRUNCATION_KEEP_START + SEMANTIC_TRUNCATION_KEEP_END;
      expect(sum).toBeLessThanOrEqual(1.0);
    });

    it('CONVERSATION_RECENT_TURNS is 6', () => {
      expect(CONVERSATION_RECENT_TURNS).toBe(6);
    });

    it('SUMMARIZATION_MODEL is gpt-4o-mini', () => {
      expect(SUMMARIZATION_MODEL).toBe('gpt-4o-mini');
    });

    it('CHUNKING_TRIGGER_TOKENS is 2000', () => {
      expect(CHUNKING_TRIGGER_TOKENS).toBe(2000);
    });

    it('CHUNK_TARGET_MIN < CHUNK_TARGET_MAX', () => {
      expect(CHUNK_TARGET_MIN).toBeLessThan(CHUNK_TARGET_MAX);
    });

    it('CHUNK_TARGET_MAX < CHUNK_HARD_MAX < CHUNK_ABSOLUTE_MAX', () => {
      expect(CHUNK_TARGET_MAX).toBeLessThan(CHUNK_HARD_MAX);
      expect(CHUNK_HARD_MAX).toBeLessThan(CHUNK_ABSOLUTE_MAX);
    });

    it('CHUNK_OVERLAP_IN_EMBEDDING is false', () => {
      expect(CHUNK_OVERLAP_IN_EMBEDDING).toBe(false);
    });

    it('CHUNK_LEVELS has 3 entries', () => {
      expect(CHUNK_LEVELS).toHaveLength(3);
    });

    it('CHUNK_EDGE_TYPES has 4 entries', () => {
      expect(CHUNK_EDGE_TYPES).toHaveLength(4);
    });

    it('TOKEN_ESTIMATE_CHARS_PER_TOKEN is 3.5', () => {
      expect(TOKEN_ESTIMATE_CHARS_PER_TOKEN).toBe(3.5);
    });
  });

  // ============================================================
  // TYPE GUARDS
  // ============================================================

  describe('Type Guards', () => {
    it('isTruncationTier: valid/invalid', () => {
      expect(isTruncationTier('use_summary')).toBe(true);
      expect(isTruncationTier('semantic_truncation')).toBe(true);
      expect(isTruncationTier('extract_relevant')).toBe(true);
      expect(isTruncationTier('hard_truncation')).toBe(true);
      expect(isTruncationTier('invalid')).toBe(false);
      expect(isTruncationTier('')).toBe(false);
    });

    it('isChunkLevel: valid/invalid', () => {
      expect(isChunkLevel('document')).toBe(true);
      expect(isChunkLevel('section')).toBe(true);
      expect(isChunkLevel('paragraph')).toBe(true);
      expect(isChunkLevel('invalid')).toBe(false);
      expect(isChunkLevel('')).toBe(false);
    });

    it('isChunkEdgeType: valid/invalid', () => {
      expect(isChunkEdgeType('chunk_of')).toBe(true);
      expect(isChunkEdgeType('section_of')).toBe(true);
      expect(isChunkEdgeType('follows')).toBe(true);
      expect(isChunkEdgeType('contains')).toBe(true);
      expect(isChunkEdgeType('invalid')).toBe(false);
      expect(isChunkEdgeType('')).toBe(false);
    });

    it('isPriorityWeightName: valid/invalid', () => {
      expect(isPriorityWeightName('retrieval_score')).toBe(true);
      expect(isPriorityWeightName('query_mentioned')).toBe(true);
      expect(isPriorityWeightName('recency')).toBe(true);
      expect(isPriorityWeightName('connectivity')).toBe(true);
      expect(isPriorityWeightName('importance')).toBe(true);
      expect(isPriorityWeightName('invalid')).toBe(false);
      expect(isPriorityWeightName('')).toBe(false);
    });
  });

  // ============================================================
  // ZOD SCHEMAS
  // ============================================================

  describe('Zod Schemas', () => {
    it('ModelContextBudgetSchema: valid input passes', () => {
      const valid = {
        model_id: 'gpt-4o-mini',
        total_context: 128000,
        fixed: { system_prompt: 3000, min_user_message: 2000, response_buffer: 8000 },
        flexible_pool: 115000,
        retrieval_ratio: 0.65,
        default_retrieved: 74750,
        default_history: 40250,
      };
      expect(() => ModelContextBudgetSchema.parse(valid)).not.toThrow();
    });

    it('ContextAllocationRequestSchema: valid passes, missing model_id fails', () => {
      const valid: ContextAllocationRequest = {
        model_id: 'gpt-4o-mini',
        user_message_tokens: 500,
        retrieved_tokens: 10000,
        history_tokens: 5000,
      };
      expect(() => ContextAllocationRequestSchema.parse(valid)).not.toThrow();

      const invalid = {
        user_message_tokens: 500,
        retrieved_tokens: 10000,
        history_tokens: 5000,
      };
      expect(() => ContextAllocationRequestSchema.parse(invalid)).toThrow();
    });

    it('ContextAllocationResultSchema: valid with _schemaVersion passes', () => {
      const valid = {
        _schemaVersion: 1,
        action: 'proceed' as const,
        allocations: {
          system_prompt: 3000,
          user_message: 2000,
          retrieved: 50000,
          history: 30000,
          response: 8000,
        },
        flexible_pool: 115000,
        unused_tokens: 35000,
        model_id: 'gpt-4o-mini',
      };
      expect(() => ContextAllocationResultSchema.parse(valid)).not.toThrow();
    });

    it('PrioritizedNodeSchema: valid passes', () => {
      expect(() => PrioritizedNodeSchema.parse(HIGH_PRIORITY_NODE)).not.toThrow();
    });

    it('PackedContextSchema: valid passes', () => {
      const valid = {
        nodes: [HIGH_PRIORITY_NODE],
        used_tokens: 500,
        budget_tokens: 10000,
        truncated_count: 0,
        excluded_count: 0,
      };
      expect(() => PackedContextSchema.parse(valid)).not.toThrow();
    });

    it('ChunkFieldsSchema: valid passes', () => {
      const valid = {
        is_chunk: true,
        parent_id: 'n_parent',
        chunk_index: 0,
        total_chunks: 3,
        level: 'section' as const,
        next_chunk_id: 'n_parent_chunk_1',
        overlap_tokens: 100,
        overlap_hash: '',
      };
      expect(() => ChunkFieldsSchema.parse(valid)).not.toThrow();
    });

    it('ParentFieldsSchema: valid passes', () => {
      const valid = {
        is_parent: true,
        child_ids: ['c1', 'c2', 'c3'],
        total_tokens: 4500,
        total_chunks: 3,
        document_type: 'manual_note',
      };
      expect(() => ParentFieldsSchema.parse(valid)).not.toThrow();
    });

    it('TokenCountCacheSchema: valid passes', () => {
      const valid = {
        body: 1500,
        summary: 200,
        total: 1720,
        counted_with: 'estimate',
        counted_at: '2026-02-05T10:30:00Z',
      };
      expect(() => TokenCountCacheSchema.parse(valid)).not.toThrow();
    });

    it('ContextAssemblyMetricsSchema: valid with _schemaVersion passes', () => {
      const valid = {
        _schemaVersion: 1,
        total_tokens_used: 85000,
        retrieved_tokens: 60000,
        history_tokens: 25000,
        truncation_count: 2,
        expansion_count: 1,
        latency_ms: 45,
        nodes_considered: 50,
        nodes_included: 32,
        overflow_triggered: true,
        model_id: 'claude-sonnet-4',
      };
      expect(() => ContextAssemblyMetricsSchema.parse(valid)).not.toThrow();
    });

    it('ContextWindowConfigSchema: valid with _schemaVersion passes', () => {
      expect(() => ContextWindowConfigSchema.parse(DEFAULT_CONTEXT_WINDOW_CONFIG)).not.toThrow();
    });

    it('ConversationHistoryConfigSchema: valid passes', () => {
      const valid: ConversationHistoryConfig = {
        recent_window: { max_turns: 6, max_tokens: 8000 },
        summarization: {
          turn_trigger: 10,
          token_trigger: 20000,
          model: 'gpt-4o-mini',
          input_budget: 10000,
          output_budget: 2000,
          compression_target: 0.25,
        },
      };
      expect(() => ConversationHistoryConfigSchema.parse(valid)).not.toThrow();
    });

    it('ManagedHistorySchema: valid passes', () => {
      const valid = {
        recent_messages: ['User: hi', 'Bot: hello'],
        total_tokens: 100,
        needs_summarization: false,
        turn_count: 2,
      };
      expect(() => ManagedHistorySchema.parse(valid)).not.toThrow();
    });

    it('ChunkRetrievalConfigSchema: valid passes', () => {
      const valid: ChunkRetrievalConfig = {
        expansion: {
          enabled: true,
          max_expansion_tokens: 1500,
          include_adjacent_chunks: 1,
          include_parent_summary: true,
        },
        aggregation: {
          same_doc_threshold: 2,
          action: 'merge_with_context',
          high_count_threshold: 4,
          high_count_action: 'use_parent_summary_plus_highlights',
        },
      };
      expect(() => ChunkRetrievalConfigSchema.parse(valid)).not.toThrow();
    });
  });

  // ============================================================
  // BUDGET ALLOCATION
  // ============================================================

  describe('getModelContextBudget', () => {
    it('claude-sonnet-4: total 200000, retrieval ratio 0.70', () => {
      const budget = getModelContextBudget('claude-sonnet-4');
      expect(budget.total_context).toBe(200000);
      expect(budget.retrieval_ratio).toBe(0.70);
      expect(budget.model_id).toBe('claude-sonnet-4');
    });

    it('gpt-4o-mini: total 128000, retrieval ratio 0.65', () => {
      const budget = getModelContextBudget('gpt-4o-mini');
      expect(budget.total_context).toBe(128000);
      expect(budget.retrieval_ratio).toBe(0.65);
    });

    it('gemini-2.0-flash: total 1000000, retrieval ratio 0.70', () => {
      const budget = getModelContextBudget('gemini-2.0-flash');
      expect(budget.total_context).toBe(1000000);
      expect(budget.retrieval_ratio).toBe(0.70);
    });

    it('unknown model: falls back to gpt-4o-mini budget', () => {
      const budget = getModelContextBudget('unknown-model-xyz');
      const gpt4oMiniBudget = getModelContextBudget('gpt-4o-mini');
      expect(budget.total_context).toBe(gpt4oMiniBudget.total_context);
      expect(budget.retrieval_ratio).toBe(gpt4oMiniBudget.retrieval_ratio);
    });

    it('flexible_pool = total - system - user - response', () => {
      const budget = getModelContextBudget('claude-sonnet-4');
      const expected =
        budget.total_context -
        budget.fixed.system_prompt -
        budget.fixed.min_user_message -
        budget.fixed.response_buffer;
      expect(budget.flexible_pool).toBe(expected);
    });

    it('default_retrieved = floor(flexible_pool * ratio)', () => {
      const budget = getModelContextBudget('claude-sonnet-4');
      expect(budget.default_retrieved).toBe(
        Math.floor(budget.flexible_pool * budget.retrieval_ratio)
      );
    });

    it('default_history = flexible_pool - default_retrieved', () => {
      const budget = getModelContextBudget('claude-sonnet-4');
      expect(budget.default_history).toBe(budget.flexible_pool - budget.default_retrieved);
    });
  });

  describe('allocateContext', () => {
    it('normal request: action is proceed', () => {
      const request: ContextAllocationRequest = {
        model_id: 'gpt-4o-mini',
        user_message_tokens: 2000,
        retrieved_tokens: 5000,
        history_tokens: 5000,
      };
      const result = allocateContext(request);
      expect(result.action).toBe('proceed');
    });

    it('retrieved exceeds allocation: action is prioritize_nodes', () => {
      const request: ContextAllocationRequest = {
        model_id: 'gpt-4o-mini',
        user_message_tokens: 2000,
        retrieved_tokens: 200000, // Way more than available
        history_tokens: 5000,
      };
      const result = allocateContext(request);
      expect(result.action).toBe('prioritize_nodes');
    });

    it('history exceeds allocation: action is summarize_history', () => {
      const budget = getModelContextBudget('gpt-4o-mini');
      const request: ContextAllocationRequest = {
        model_id: 'gpt-4o-mini',
        user_message_tokens: 2000,
        retrieved_tokens: 1000, // Small so it doesn't trigger prioritize_nodes
        history_tokens: budget.total_context, // Massively exceeds history allocation
      };
      const result = allocateContext(request);
      expect(result.action).toBe('summarize_history');
    });

    it('user message larger than minimum: expands allocation', () => {
      const request: ContextAllocationRequest = {
        model_id: 'gpt-4o-mini',
        user_message_tokens: 10000,
        retrieved_tokens: 5000,
        history_tokens: 5000,
      };
      const result = allocateContext(request);
      expect(result.allocations.user_message).toBe(10000);
    });

    it('user message smaller than minimum: uses minimum', () => {
      const request: ContextAllocationRequest = {
        model_id: 'gpt-4o-mini',
        user_message_tokens: 500,
        retrieved_tokens: 5000,
        history_tokens: 5000,
      };
      const result = allocateContext(request);
      expect(result.allocations.user_message).toBe(DEFAULT_MIN_USER_TOKENS);
    });

    it('unused retrieved space: reallocated to history (half)', () => {
      // When retrieved < 50% of allocation, half the unused goes to history
      const request: ContextAllocationRequest = {
        model_id: 'claude-sonnet-4',
        user_message_tokens: 2000,
        retrieved_tokens: 100, // Very sparse — much less than 50% of allocation
        history_tokens: 5000,
      };
      const result = allocateContext(request);
      // History should get more than the default allocation because unused was reallocated
      const budget = getModelContextBudget('claude-sonnet-4');
      const defaultHistory = budget.flexible_pool - Math.floor(budget.flexible_pool * budget.retrieval_ratio);
      expect(result.allocations.history).toBeGreaterThan(defaultHistory);
    });

    it('allocations sum to <= total context', () => {
      const request: ContextAllocationRequest = {
        model_id: 'gpt-4o-mini',
        user_message_tokens: 2000,
        retrieved_tokens: 50000,
        history_tokens: 30000,
      };
      const result = allocateContext(request);
      const budget = getModelContextBudget('gpt-4o-mini');
      const sum =
        result.allocations.system_prompt +
        result.allocations.user_message +
        result.allocations.retrieved +
        result.allocations.history +
        result.allocations.response;
      expect(sum).toBeLessThanOrEqual(budget.total_context);
    });

    it('_schemaVersion is 1', () => {
      const request: ContextAllocationRequest = {
        model_id: 'gpt-4o-mini',
        user_message_tokens: 2000,
        retrieved_tokens: 5000,
        history_tokens: 5000,
      };
      const result = allocateContext(request);
      expect(result._schemaVersion).toBe(CW_SCHEMA_VERSION);
    });
  });

  describe('handleSparseRetrieval', () => {
    it('sparse (500 tokens): adds extra response buffer', () => {
      const budget = getModelContextBudget('gpt-4o');
      const adjusted = handleSparseRetrieval(500, budget);
      expect(adjusted.fixed.response_buffer).toBe(
        budget.fixed.response_buffer + SPARSE_EXTRA_RESPONSE_BUFFER
      );
    });

    it('not sparse (2000 tokens): returns same budget', () => {
      const budget = getModelContextBudget('gpt-4o');
      const result = handleSparseRetrieval(2000, budget);
      expect(result.fixed.response_buffer).toBe(budget.fixed.response_buffer);
    });

    it('does not mutate input', () => {
      const budget = getModelContextBudget('gpt-4o');
      const originalBuffer = budget.fixed.response_buffer;
      handleSparseRetrieval(500, budget);
      expect(budget.fixed.response_buffer).toBe(originalBuffer);
    });
  });

  // ============================================================
  // NODE PRIORITIZATION
  // ============================================================

  describe('calculateNodePriority', () => {
    it('all factors 1.0: returns sum of weights (1.0)', () => {
      const factors: NodePriorityFactors = {
        retrieval_score: 1.0,
        query_mentioned: 1.0,
        recency: 1.0,
        connectivity: 1.0,
        importance: 1.0,
      };
      expect(calculateNodePriority(factors)).toBeCloseTo(1.0, 5);
    });

    it('all factors 0.0: returns 0', () => {
      const factors: NodePriorityFactors = {
        retrieval_score: 0,
        query_mentioned: 0,
        recency: 0,
        connectivity: 0,
        importance: 0,
      };
      expect(calculateNodePriority(factors)).toBe(0);
    });

    it('only retrieval_score 1.0: returns 0.40', () => {
      const factors: NodePriorityFactors = {
        retrieval_score: 1.0,
        query_mentioned: 0,
        recency: 0,
        connectivity: 0,
        importance: 0,
      };
      expect(calculateNodePriority(factors)).toBeCloseTo(0.40, 5);
    });

    it('only query_mentioned 1.0: returns 0.25', () => {
      const factors: NodePriorityFactors = {
        retrieval_score: 0,
        query_mentioned: 1.0,
        recency: 0,
        connectivity: 0,
        importance: 0,
      };
      expect(calculateNodePriority(factors)).toBeCloseTo(0.25, 5);
    });

    it('custom weights: overrides defaults', () => {
      const factors: NodePriorityFactors = {
        retrieval_score: 1.0,
        query_mentioned: 0,
        recency: 0,
        connectivity: 0,
        importance: 0,
      };
      const customWeights: PriorityWeights = {
        retrieval_score: 0.80,
        query_mentioned: 0.05,
        recency: 0.05,
        connectivity: 0.05,
        importance: 0.05,
      };
      expect(calculateNodePriority(factors, customWeights)).toBeCloseTo(0.80, 5);
    });

    it('mixed factors: correct weighted sum', () => {
      const factors: NodePriorityFactors = {
        retrieval_score: 0.8,
        query_mentioned: 1.0,
        recency: 0.5,
        connectivity: 0.3,
        importance: 0.6,
      };
      const expected =
        0.8 * DEFAULT_PRIORITY_WEIGHTS.retrieval_score +
        1.0 * DEFAULT_PRIORITY_WEIGHTS.query_mentioned +
        0.5 * DEFAULT_PRIORITY_WEIGHTS.recency +
        0.3 * DEFAULT_PRIORITY_WEIGHTS.connectivity +
        0.6 * DEFAULT_PRIORITY_WEIGHTS.importance;
      expect(calculateNodePriority(factors)).toBeCloseTo(expected, 5);
    });
  });

  describe('calculateRecencyScore', () => {
    it('just accessed (0 days): returns ~1.0', () => {
      const now = new Date().toISOString();
      const score = calculateRecencyScore(now);
      expect(score).toBeCloseTo(1.0, 1);
    });

    it('20 days ago: returns ~0.5 (half-life)', () => {
      const twentyDaysAgo = new Date(
        Date.now() - 20 * 24 * 60 * 60 * 1000
      ).toISOString();
      const score = calculateRecencyScore(twentyDaysAgo);
      expect(score).toBeCloseTo(0.5, 1);
    });

    it('60 days ago: returns ~0.125', () => {
      const sixtyDaysAgo = new Date(
        Date.now() - 60 * 24 * 60 * 60 * 1000
      ).toISOString();
      const score = calculateRecencyScore(sixtyDaysAgo);
      expect(score).toBeCloseTo(0.125, 1);
    });

    it('very old (365 days): returns near 0', () => {
      const yearAgo = new Date(
        Date.now() - 365 * 24 * 60 * 60 * 1000
      ).toISOString();
      const score = calculateRecencyScore(yearAgo);
      expect(score).toBeLessThan(0.01);
    });
  });

  describe('calculateConnectivityScore', () => {
    it('0 connections: returns 0', () => {
      expect(calculateConnectivityScore(0)).toBe(0);
    });

    it('1 connection: returns 0.3', () => {
      expect(calculateConnectivityScore(1)).toBeCloseTo(0.3, 5);
    });

    it('3 connections: returns 0.9', () => {
      expect(calculateConnectivityScore(3)).toBeCloseTo(0.9, 5);
    });

    it('4+ connections: capped at 1.0', () => {
      expect(calculateConnectivityScore(4)).toBe(1.0);
      expect(calculateConnectivityScore(10)).toBe(1.0);
    });
  });

  describe('packNodes', () => {
    it('empty candidates: returns empty result', () => {
      const result = packNodes([], 10000);
      expect(result.nodes).toHaveLength(0);
      expect(result.used_tokens).toBe(0);
      expect(result.excluded_count).toBe(0);
    });

    it('all fit: includes all', () => {
      const candidates = [HIGH_PRIORITY_NODE, MEDIUM_PRIORITY_NODE, CRITICAL_NODE];
      const result = packNodes(candidates, 10000);
      expect(result.nodes).toHaveLength(3);
      expect(result.used_tokens).toBe(500 + 1000 + 200);
    });

    it('some dont fit: highest priority included', () => {
      const candidates = [HIGH_PRIORITY_NODE, MEDIUM_PRIORITY_NODE, LARGE_NODE];
      const result = packNodes(candidates, 2000);
      // High (500) + Medium (1000) = 1500 fits; Large (5000) doesn't
      expect(result.nodes).toHaveLength(2);
      expect(result.excluded_count).toBe(1);
      expect(result.nodes.map((n) => n.node_id)).toContain('n1');
    });

    it('critical nodes included first', () => {
      const candidates = [LARGE_NODE, CRITICAL_NODE, MEDIUM_PRIORITY_NODE];
      const result = packNodes(candidates, 1500, ['n3']);
      // Critical (200) goes first, then LARGE_NODE (5000, won't fit), then MEDIUM (1000, fits)
      expect(result.nodes[0]?.node_id).toBe('n3');
      expect(result.nodes).toHaveLength(2); // Critical + Medium
    });

    it('critical node doesnt fit: skipped', () => {
      const hugeCritical: PrioritizedNode = {
        node_id: 'n_huge',
        priority_score: 0.40,
        tokens: 50000,
        retrieval_score: 0.40,
        is_critical: true,
        was_truncated: false,
      };
      const result = packNodes([hugeCritical, HIGH_PRIORITY_NODE], 1000, ['n_huge']);
      expect(result.nodes.map((n) => n.node_id)).not.toContain('n_huge');
      expect(result.excluded_count).toBeGreaterThanOrEqual(1);
    });

    it('truncated_count tracks truncated nodes', () => {
      const truncatedNode: PrioritizedNode = {
        ...MEDIUM_PRIORITY_NODE,
        node_id: 'n_trunc',
        was_truncated: true,
      };
      const result = packNodes([truncatedNode, HIGH_PRIORITY_NODE], 10000);
      expect(result.truncated_count).toBe(1);
    });

    it('excluded_count tracks excluded nodes', () => {
      const result = packNodes([HIGH_PRIORITY_NODE, LARGE_NODE], 600);
      // HIGH (500) fits, LARGE (5000) doesn't
      expect(result.excluded_count).toBe(1);
    });

    it('used_tokens <= budget_tokens', () => {
      const candidates = [HIGH_PRIORITY_NODE, MEDIUM_PRIORITY_NODE, LARGE_NODE, CRITICAL_NODE];
      const result = packNodes(candidates, 2000);
      expect(result.used_tokens).toBeLessThanOrEqual(result.budget_tokens);
    });
  });

  // ============================================================
  // TRUNCATION
  // ============================================================

  describe('selectTruncationTier', () => {
    it('has summary: returns use_summary', () => {
      expect(selectTruncationTier(5000, 1000, true)).toBe('use_summary');
    });

    it('no summary, small overflow: returns semantic_truncation', () => {
      // nodeTokens (3000) <= 2 * targetTokens (2000) → semantic
      expect(selectTruncationTier(3000, 2000, false)).toBe('semantic_truncation');
    });

    it('no summary, large overflow: returns extract_relevant', () => {
      // nodeTokens (6000) > 2 * targetTokens (2000) → extract
      expect(selectTruncationTier(6000, 2000, false)).toBe('extract_relevant');
    });
  });

  describe('semanticTruncate', () => {
    it('keeps first 60% and last 20%', () => {
      const result = semanticTruncate(LONG_TEXT, 500);
      // Result should contain content from beginning and end
      expect(result).toContain('Sentence');
      expect(result).toContain('here.');
    });

    it('adds [...] separator', () => {
      const result = semanticTruncate(LONG_TEXT, 500);
      expect(result).toContain('[...]');
    });

    it('result shorter than original', () => {
      const result = semanticTruncate(LONG_TEXT, 500);
      expect(result.length).toBeLessThan(LONG_TEXT.length);
    });

    it('empty text: returns empty', () => {
      expect(semanticTruncate('', 500)).toBe('');
    });

    it('text shorter than target: returns as-is', () => {
      expect(semanticTruncate(SHORT_TEXT, 500)).toBe(SHORT_TEXT);
    });
  });

  describe('hardTruncate', () => {
    it('truncates at sentence boundary', () => {
      const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
      const result = hardTruncate(text, 5); // ~5 tokens = ~17.5 chars
      expect(result).toContain('[truncated]');
    });

    it('adds [truncated] suffix', () => {
      const result = hardTruncate(LONG_TEXT, 100);
      expect(result).toContain('[truncated]');
    });

    it('result shorter than original', () => {
      const result = hardTruncate(LONG_TEXT, 100);
      expect(result.length).toBeLessThan(LONG_TEXT.length);
    });

    it('text shorter than target: returns as-is', () => {
      const result = hardTruncate(SHORT_TEXT, 500);
      expect(result).toBe(SHORT_TEXT);
      expect(result).not.toContain('[truncated]');
    });
  });

  // ============================================================
  // CONTEXT PLACEMENT
  // ============================================================

  describe('reorderForAttention', () => {
    it('0 nodes: returns empty array', () => {
      const result = reorderForAttention([]);
      expect(result).toHaveLength(0);
    });

    it('1 node: returns same', () => {
      const result = reorderForAttention([HIGH_PRIORITY_NODE]);
      expect(result).toHaveLength(1);
      expect(result[0]?.node_id).toBe('n1');
    });

    it('2 nodes: most relevant last, 2nd most first', () => {
      const sorted = [HIGH_PRIORITY_NODE, MEDIUM_PRIORITY_NODE]; // Sorted by priority desc
      const result = reorderForAttention(sorted);
      expect(result[0]?.node_id).toBe('n2'); // 2nd most → first (primacy)
      expect(result[1]?.node_id).toBe('n1'); // most relevant → last (recency)
    });

    it('5 nodes: correct Lost-in-the-Middle ordering', () => {
      const n5: PrioritizedNode = {
        node_id: 'n5',
        priority_score: 0.30,
        tokens: 300,
        retrieval_score: 0.30,
        is_critical: false,
        was_truncated: false,
      };
      const sorted = [HIGH_PRIORITY_NODE, LARGE_NODE, MEDIUM_PRIORITY_NODE, CRITICAL_NODE, n5];
      const result = reorderForAttention(sorted);
      // [2nd, 3rd, 4th, 5th, 1st]
      expect(result[0]?.node_id).toBe('n4'); // 2nd most relevant → first
      expect(result[result.length - 1]?.node_id).toBe('n1'); // most relevant → last
    });

    it('does not mutate input', () => {
      const original = [HIGH_PRIORITY_NODE, MEDIUM_PRIORITY_NODE, CRITICAL_NODE];
      const copy = [...original];
      reorderForAttention(original);
      expect(original).toEqual(copy);
    });
  });

  // ============================================================
  // CONVERSATION HISTORY
  // ============================================================

  describe('manageConversationHistory', () => {
    it('short conversation (3 turns): no summarization needed', () => {
      const messages = ['User: hi', 'Bot: hello', 'User: how are you?'];
      const counts = [10, 15, 20];
      const result = manageConversationHistory(messages, counts);
      expect(result.needs_summarization).toBe(false);
      expect(result.turn_count).toBe(3);
    });

    it('10+ turns: needs_summarization = true', () => {
      const messages = Array.from({ length: 12 }, (_, i) => `Turn ${i}: content`);
      const counts = Array.from({ length: 12 }, () => 100);
      const result = manageConversationHistory(messages, counts);
      expect(result.needs_summarization).toBe(true);
    });

    it('20K+ tokens: needs_summarization = true', () => {
      const messages = ['User: long message', 'Bot: long response'];
      const counts = [12000, 12000]; // Total 24000 > 20000 trigger
      const result = manageConversationHistory(messages, counts);
      expect(result.needs_summarization).toBe(true);
    });

    it('recent_messages limited to max_turns', () => {
      const messages = Array.from({ length: 15 }, (_, i) => `Turn ${i}`);
      const counts = Array.from({ length: 15 }, () => 50);
      const result = manageConversationHistory(messages, counts);
      expect(result.recent_messages).toHaveLength(CONVERSATION_RECENT_TURNS);
    });

    it('total_tokens calculated correctly', () => {
      const messages = ['a', 'b', 'c'];
      const counts = [100, 200, 300];
      const result = manageConversationHistory(messages, counts);
      expect(result.total_tokens).toBe(600);
    });

    it('custom config overrides defaults', () => {
      const messages = Array.from({ length: 5 }, (_, i) => `Turn ${i}`);
      const counts = Array.from({ length: 5 }, () => 100);
      const customConfig: ConversationHistoryConfig = {
        recent_window: { max_turns: 2, max_tokens: 4000 },
        summarization: {
          turn_trigger: 3, // Low trigger
          token_trigger: 200, // Low trigger
          model: 'gpt-4o-mini',
          input_budget: 10000,
          output_budget: 2000,
          compression_target: 0.25,
        },
      };
      const result = manageConversationHistory(messages, counts, customConfig);
      expect(result.needs_summarization).toBe(true); // 5 > 3 turns
      expect(result.recent_messages).toHaveLength(2); // Custom max_turns = 2
    });
  });

  // ============================================================
  // TOKEN ESTIMATION
  // ============================================================

  describe('estimateTokens', () => {
    it('empty string: returns 0', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('"hello": returns Math.ceil(5 / 3.5) = 2', () => {
      expect(estimateTokens('hello')).toBe(Math.ceil(5 / 3.5));
    });

    it('1000 character string: returns ~286', () => {
      const text = 'a'.repeat(1000);
      expect(estimateTokens(text)).toBe(Math.ceil(1000 / 3.5));
    });

    it('very long string: handles correctly', () => {
      const text = 'x'.repeat(100000);
      expect(estimateTokens(text)).toBe(Math.ceil(100000 / 3.5));
    });
  });

  // ============================================================
  // CHUNK UTILITIES
  // ============================================================

  describe('shouldChunk', () => {
    it('1000 tokens: returns false (< 2000)', () => {
      expect(shouldChunk(1000)).toBe(false);
    });

    it('2001 tokens: returns true', () => {
      expect(shouldChunk(2001)).toBe(true);
    });

    it('exactly 2000: returns false (not >)', () => {
      expect(shouldChunk(2000)).toBe(false);
    });

    it('custom config: uses custom trigger', () => {
      const config: ChunkingConfig = {
        ...DEFAULT_CONTEXT_WINDOW_CONFIG.chunking,
        chunking_trigger: 500,
      };
      expect(shouldChunk(600, config)).toBe(true);
      expect(shouldChunk(400, config)).toBe(false);
    });
  });

  describe('calculateChunkCount', () => {
    it('2000 tokens: returns 2 (target avg: 1000)', () => {
      expect(calculateChunkCount(2000)).toBe(2);
    });

    it('5000 tokens: returns 5', () => {
      expect(calculateChunkCount(5000)).toBe(5);
    });

    it('100 tokens: returns 1 (minimum)', () => {
      expect(calculateChunkCount(100)).toBe(1);
    });
  });

  describe('createChunkFields', () => {
    it('first chunk (index 0): no previous_chunk_id', () => {
      const fields = createChunkFields('n_parent', 0, 3, 'section', 100);
      expect(fields.previous_chunk_id).toBeUndefined();
      expect(fields.next_chunk_id).toBe('n_parent_chunk_1');
    });

    it('middle chunk: has both previous and next', () => {
      const fields = createChunkFields('n_parent', 1, 3, 'section', 100);
      expect(fields.previous_chunk_id).toBe('n_parent_chunk_0');
      expect(fields.next_chunk_id).toBe('n_parent_chunk_2');
    });

    it('last chunk: no next_chunk_id', () => {
      const fields = createChunkFields('n_parent', 2, 3, 'section', 100);
      expect(fields.previous_chunk_id).toBe('n_parent_chunk_1');
      expect(fields.next_chunk_id).toBeUndefined();
    });

    it('sets parent_id correctly', () => {
      const fields = createChunkFields('n_doc_abc', 0, 5, 'document', 50);
      expect(fields.parent_id).toBe('n_doc_abc');
      expect(fields.is_chunk).toBe(true);
      expect(fields.level).toBe('document');
    });

    it('temporary defaults to undefined', () => {
      const fields = createChunkFields('n_parent', 0, 1, 'paragraph', 0);
      expect(fields.temporary).toBeUndefined();
    });
  });

  describe('createParentFields', () => {
    it('creates with child_ids ordered', () => {
      const ids = ['c1', 'c2', 'c3'];
      const fields = createParentFields(ids, 4500, 'manual_note');
      expect(fields.child_ids).toEqual(ids);
    });

    it('calculates total_chunks from child_ids.length', () => {
      const ids = ['c1', 'c2', 'c3', 'c4'];
      const fields = createParentFields(ids, 6000, 'article');
      expect(fields.total_chunks).toBe(4);
    });

    it('sets is_parent = true', () => {
      const fields = createParentFields(['c1'], 1000, 'note');
      expect(fields.is_parent).toBe(true);
    });
  });

  describe('shouldExpandChunks', () => {
    it('1 matched chunk, enabled: returns true', () => {
      expect(shouldExpandChunks(1)).toBe(true);
    });

    it('0 matched chunks: returns false', () => {
      expect(shouldExpandChunks(0)).toBe(false);
    });

    it('expansion disabled: returns false', () => {
      const config: ChunkRetrievalConfig = {
        ...DEFAULT_CONTEXT_WINDOW_CONFIG.chunk_retrieval,
        expansion: {
          ...DEFAULT_CONTEXT_WINDOW_CONFIG.chunk_retrieval.expansion,
          enabled: false,
        },
      };
      expect(shouldExpandChunks(3, config)).toBe(false);
    });
  });

  describe('shouldAggregateChunks', () => {
    it('1 chunk from doc: returns none', () => {
      expect(shouldAggregateChunks(1)).toBe('none');
    });

    it('2 chunks from doc: returns merge', () => {
      expect(shouldAggregateChunks(2)).toBe('merge');
    });

    it('4 chunks from doc: returns summarize', () => {
      expect(shouldAggregateChunks(4)).toBe('summarize');
    });

    it('5 chunks from doc: returns summarize', () => {
      expect(shouldAggregateChunks(5)).toBe('summarize');
    });
  });

  // ============================================================
  // CONFIGURATION
  // ============================================================

  describe('getDefaultContextWindowConfig', () => {
    it('returns valid config', () => {
      const config = getDefaultContextWindowConfig();
      expect(config).toBeDefined();
      expect(() => ContextWindowConfigSchema.parse(config)).not.toThrow();
    });

    it('_schemaVersion is 1', () => {
      const config = getDefaultContextWindowConfig();
      expect(config._schemaVersion).toBe(CW_SCHEMA_VERSION);
    });

    it('chunking config matches constants', () => {
      const config = getDefaultContextWindowConfig();
      expect(config.chunking.chunking_trigger).toBe(CHUNKING_TRIGGER_TOKENS);
      expect(config.chunking.target_min).toBe(CHUNK_TARGET_MIN);
      expect(config.chunking.target_max).toBe(CHUNK_TARGET_MAX);
    });

    it('priority weights match defaults', () => {
      const config = getDefaultContextWindowConfig();
      expect(config.priority_weights.retrieval_score).toBe(
        DEFAULT_PRIORITY_WEIGHTS.retrieval_score
      );
      expect(config.priority_weights.query_mentioned).toBe(
        DEFAULT_PRIORITY_WEIGHTS.query_mentioned
      );
    });
  });

  describe('getDefaultChunkRetrievalConfig', () => {
    it('returns valid config', () => {
      const config = getDefaultChunkRetrievalConfig();
      expect(config).toBeDefined();
      expect(() => ChunkRetrievalConfigSchema.parse(config)).not.toThrow();
    });

    it('expansion enabled', () => {
      const config = getDefaultChunkRetrievalConfig();
      expect(config.expansion.enabled).toBe(true);
    });

    it('same_doc_threshold matches constant', () => {
      const config = getDefaultChunkRetrievalConfig();
      expect(config.aggregation.same_doc_threshold).toBe(CHUNK_SAME_DOC_THRESHOLD);
    });
  });

  // ============================================================
  // INTEGRATION
  // ============================================================

  describe('Integration', () => {
    it('full pipeline: allocate → prioritize → pack → reorder', () => {
      // Step 1: Allocate budget
      const request: ContextAllocationRequest = {
        model_id: 'claude-sonnet-4',
        user_message_tokens: 2000,
        retrieved_tokens: 5000,
        history_tokens: 3000,
      };
      const allocation = allocateContext(request);
      expect(allocation.action).toBe('proceed');

      // Step 2: Calculate priorities
      const factors: NodePriorityFactors = {
        retrieval_score: 0.9,
        query_mentioned: 1.0,
        recency: 0.8,
        connectivity: 0.5,
        importance: 0.7,
      };
      const score = calculateNodePriority(factors);
      expect(score).toBeGreaterThan(0);

      // Step 3: Pack nodes
      const packed = packNodes(
        [HIGH_PRIORITY_NODE, MEDIUM_PRIORITY_NODE, CRITICAL_NODE],
        allocation.allocations.retrieved
      );
      expect(packed.nodes.length).toBeGreaterThan(0);
      expect(packed.used_tokens).toBeLessThanOrEqual(packed.budget_tokens);

      // Step 4: Reorder for attention
      const reordered = reorderForAttention(packed.nodes);
      expect(reordered).toHaveLength(packed.nodes.length);
    });

    it('budget from allocateContext can feed into packNodes', () => {
      const result = allocateContext({
        model_id: 'gpt-4o-mini',
        user_message_tokens: 2000,
        retrieved_tokens: 50000,
        history_tokens: 20000,
      });
      const packed = packNodes([HIGH_PRIORITY_NODE, MEDIUM_PRIORITY_NODE], result.allocations.retrieved);
      expect(packed.budget_tokens).toBe(result.allocations.retrieved);
    });

    it('getModelContextBudget works with all MODEL_CONFIGS models', () => {
      const models = [
        'claude-sonnet-4',
        'claude-3-haiku',
        'gpt-4o',
        'gpt-4o-mini',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
      ];
      models.forEach((model) => {
        const budget = getModelContextBudget(model);
        expect(budget.total_context).toBeGreaterThan(0);
        expect(budget.model_id).toBe(model);
      });
    });

    it('conversation config consistent with constants', () => {
      const config = getDefaultContextWindowConfig();
      expect(config.conversation.recent_window.max_turns).toBe(CONVERSATION_RECENT_TURNS);
      expect(config.conversation.summarization.model).toBe(SUMMARIZATION_MODEL);
      expect(config.conversation.summarization.turn_trigger).toBe(SUMMARIZATION_TURN_TRIGGER);
      expect(config.conversation.summarization.token_trigger).toBe(SUMMARIZATION_TOKEN_TRIGGER);
    });
  });

  // ============================================================
  // EDGE CASES
  // ============================================================

  describe('Edge Cases', () => {
    it('user message larger than total context', () => {
      const request: ContextAllocationRequest = {
        model_id: 'gpt-4o-mini',
        user_message_tokens: 500000, // Way larger than 128K context
        retrieved_tokens: 5000,
        history_tokens: 5000,
      };
      const result = allocateContext(request);
      // Should not crash, flexible pool will be 0
      expect(result.flexible_pool).toBe(0);
    });

    it('all nodes exceed budget', () => {
      const nodes = [LARGE_NODE, { ...LARGE_NODE, node_id: 'n5' }, { ...LARGE_NODE, node_id: 'n6' }];
      const result = packNodes(nodes, 1000); // Budget too small for any 5000-token node
      expect(result.nodes).toHaveLength(0);
      expect(result.excluded_count).toBe(3);
    });

    it('negative token counts handled', () => {
      // Negative connectivity shouldn't break calculateConnectivityScore
      expect(calculateConnectivityScore(-5)).toBe(0);
      // estimateTokens handles empty gracefully
      expect(estimateTokens('')).toBe(0);
    });

    it('very large context window (1M — Gemini)', () => {
      const budget = getModelContextBudget('gemini-2.0-flash');
      expect(budget.total_context).toBe(1000000);
      expect(budget.flexible_pool).toBeGreaterThan(900000);
      // Allocation should still work
      const result = allocateContext({
        model_id: 'gemini-2.0-flash',
        user_message_tokens: 2000,
        retrieved_tokens: 500000,
        history_tokens: 200000,
      });
      expect(result.allocations.retrieved).toBeGreaterThan(0);
      expect(result.allocations.history).toBeGreaterThan(0);
    });
  });
});
