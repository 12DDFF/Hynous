/**
 * @module @nous/core/context-window
 * @description Types, interfaces, and Zod schemas for the Context Window & Chunking Strategy
 * @version 1.0.0
 * @spec Specs/Phase-8-Scaling-Limits/storm-029
 * @storm Brainstorms/Infrastructure/storm-029-context-chunking
 */

import { z } from 'zod';
import {
  CW_SCHEMA_VERSION,
  DEFAULT_SYSTEM_PROMPT_TOKENS,
  DEFAULT_MIN_USER_TOKENS,
  DEFAULT_PRIORITY_WEIGHTS,
  CHUNKING_TRIGGER_TOKENS,
  CHUNK_TARGET_MIN,
  CHUNK_TARGET_MAX,
  CHUNK_HARD_MAX,
  CHUNK_ABSOLUTE_MAX,
  CHUNK_MIN_TOKENS,
  CHUNK_MIN_SENTENCES,
  CHUNK_OVERLAP_TOKENS,
  CHUNK_OVERLAP_IN_EMBEDDING,
  CHUNK_EMBEDDING_MAX,
  CONVERSATION_RECENT_TURNS,
  CONVERSATION_RECENT_MAX_TOKENS,
  SUMMARIZATION_TURN_TRIGGER,
  SUMMARIZATION_TOKEN_TRIGGER,
  SUMMARIZATION_MODEL,
  SUMMARIZATION_INPUT_BUDGET,
  SUMMARIZATION_OUTPUT_BUDGET,
  SUMMARIZATION_COMPRESSION_TARGET,
  CHUNK_EXPANSION_MAX_TOKENS,
  CHUNK_ADJACENT_COUNT,
  CHUNK_SAME_DOC_THRESHOLD,
  CHUNK_HIGH_COUNT_THRESHOLD,
  type TruncationTier,
  TruncationTierSchema,
  type ChunkLevel,
  ChunkLevelSchema,
} from './constants';

// ============================================================
// BUDGET TYPES
// ============================================================

/**
 * Fixed token allocations.
 *
 * These are reserved at the beginning and end of the context window.
 * They are subtracted from total_context before calculating the flexible pool.
 */
export interface FixedAllocations {
  /** System prompt tokens (typically cached) */
  system_prompt: number;

  /** Minimum guaranteed user message space */
  min_user_message: number;

  /** Response buffer (model-dependent: 8000-16000) */
  response_buffer: number;
}

export const FixedAllocationsSchema = z.object({
  system_prompt: z.number().int().nonnegative(),
  min_user_message: z.number().int().nonnegative(),
  response_buffer: z.number().int().nonnegative(),
});

/**
 * Per-model token budget allocation.
 *
 * Defines the token budget breakdown for a specific LLM model.
 * Fixed allocations are reserved first, then the flexible pool
 * is divided between retrieved context and conversation history.
 *
 * @example
 * ```typescript
 * const budget: ModelContextBudget = {
 *   model_id: 'claude-sonnet-4',
 *   total_context: 200000,
 *   fixed: {
 *     system_prompt: 3000,
 *     min_user_message: 2000,
 *     response_buffer: 16000,
 *   },
 *   flexible_pool: 179000, // 200000 - 3000 - 2000 - 16000
 *   retrieval_ratio: 0.70,
 *   default_retrieved: 125300, // floor(179000 * 0.70)
 *   default_history: 53700,    // 179000 - 125300
 * };
 * ```
 */
export interface ModelContextBudget {
  /** Model ID from storm-015 LLM_MODELS */
  model_id: string;

  /** Total context window size from MODEL_CONFIGS.context_window */
  total_context: number;

  /** Fixed token allocations (subtracted first) */
  fixed: FixedAllocations;

  /** Remaining tokens after fixed allocations (total - fixed) */
  flexible_pool: number;

  /** Fraction of flexible pool for retrieved context (0.65-0.70) */
  retrieval_ratio: number;

  /** Default retrieved token allocation (floor(flexible_pool * retrieval_ratio)) */
  default_retrieved: number;

  /** Default history token allocation (flexible_pool - default_retrieved) */
  default_history: number;
}

export const ModelContextBudgetSchema = z.object({
  model_id: z.string().min(1),
  total_context: z.number().int().nonnegative(),
  fixed: FixedAllocationsSchema,
  flexible_pool: z.number().int().nonnegative(),
  retrieval_ratio: z.number().min(0).max(1),
  default_retrieved: z.number().int().nonnegative(),
  default_history: z.number().int().nonnegative(),
});

/**
 * Input to budget allocation.
 *
 * @example
 * ```typescript
 * const request: ContextAllocationRequest = {
 *   model_id: 'claude-sonnet-4',
 *   user_message_tokens: 2500,
 *   retrieved_tokens: 80000,
 *   history_tokens: 45000,
 *   thoroughness: 'balanced',
 * };
 * ```
 */
export interface ContextAllocationRequest {
  /** Model ID from storm-015 LLM_MODELS */
  model_id: string;

  /** Actual user message size in tokens */
  user_message_tokens: number;

  /** Retrieved context size in tokens */
  retrieved_tokens: number;

  /** Conversation history size in tokens */
  history_tokens: number;

  /** Thoroughness level from storm-012 (optional) */
  thoroughness?: string;
}

export const ContextAllocationRequestSchema = z.object({
  model_id: z.string().min(1),
  user_message_tokens: z.number().int().nonnegative(),
  retrieved_tokens: z.number().int().nonnegative(),
  history_tokens: z.number().int().nonnegative(),
  thoroughness: z.string().optional(),
});

/**
 * Output of budget allocation.
 *
 * THIS IS A PERSISTED TYPE - includes _schemaVersion for migration safety.
 *
 * The action field indicates whether to proceed normally, prioritize nodes
 * (when retrieved content exceeds budget), or summarize history (when
 * history exceeds budget).
 *
 * @example
 * ```typescript
 * const result: ContextAllocationResult = {
 *   _schemaVersion: 1,
 *   action: 'proceed',
 *   allocations: {
 *     system_prompt: 3000,
 *     user_message: 2500,
 *     retrieved: 80000,
 *     history: 45000,
 *     response: 16000,
 *   },
 *   flexible_pool: 179000,
 *   unused_tokens: 54000,
 *   model_id: 'claude-sonnet-4',
 * };
 * ```
 */
export interface ContextAllocationResult {
  /** Schema version for migration safety */
  _schemaVersion: number;

  /** Action to take based on allocation result */
  action: 'proceed' | 'prioritize_nodes' | 'summarize_history';

  /** Actual token allocations */
  allocations: {
    system_prompt: number;
    user_message: number;
    retrieved: number;
    history: number;
    response: number;
  };

  /** Flexible pool size for this allocation */
  flexible_pool: number;

  /** Unused tokens after allocation */
  unused_tokens: number;

  /** Model ID used for this allocation */
  model_id: string;
}

export const ContextAllocationResultSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  action: z.enum(['proceed', 'prioritize_nodes', 'summarize_history']),
  allocations: z.object({
    system_prompt: z.number().int().nonnegative(),
    user_message: z.number().int().nonnegative(),
    retrieved: z.number().int().nonnegative(),
    history: z.number().int().nonnegative(),
    response: z.number().int().nonnegative(),
  }),
  flexible_pool: z.number().int().nonnegative(),
  unused_tokens: z.number().int().nonnegative(),
  model_id: z.string().min(1),
});

// ============================================================
// PRIORITY TYPES
// ============================================================

/**
 * Priority weights for Weighted Priority Scoring (WPS).
 * All weights must sum to 1.0.
 *
 * From brainstorm revision.md Part 1, Node Prioritization Algorithm:
 * "Learnable defaults with A/B framework. v1 uses static weights."
 *
 * Default values from DEFAULT_PRIORITY_WEIGHTS:
 * - retrieval_score: 0.40
 * - query_mentioned: 0.25
 * - recency: 0.15
 * - connectivity: 0.10
 * - importance: 0.10
 */
export interface PriorityWeights {
  retrieval_score: number;
  query_mentioned: number;
  recency: number;
  connectivity: number;
  importance: number;
}

export const PriorityWeightsSchema = z.object({
  retrieval_score: z.number().min(0).max(1),
  query_mentioned: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  connectivity: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
}).refine(
  (weights) => {
    const sum = Object.values(weights).reduce((acc, val) => acc + val, 0);
    return Math.abs(sum - 1.0) < 0.001; // Allow for floating point precision
  },
  { message: 'Priority weights must sum to 1.0' }
);

/**
 * Input factors for priority scoring, each normalized 0-1.
 *
 * From brainstorm revision.md Part 1:
 * - retrieval_score: SSA reranked score from storm-005
 * - query_mentioned: 1.0 if query directly mentions node, else 0.0
 * - recency: Exponential decay from last_accessed (storm-007)
 * - connectivity: Bonus for connections to included nodes
 * - importance: Node importance score (neural.importance from storm-011)
 */
export interface NodePriorityFactors {
  retrieval_score: number;
  query_mentioned: number;
  recency: number;
  connectivity: number;
  importance: number;
}

export const NodePriorityFactorsSchema = z.object({
  retrieval_score: z.number().min(0).max(1),
  query_mentioned: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  connectivity: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
});

/**
 * A node with computed priority score, ready for packing.
 *
 * From brainstorm revision.md Part 1, Packing Algorithm:
 * "Step 2: Sort remaining by priority_score descending
 *  Step 3: Greedy packing
 *  Step 4: For top-3 high-priority nodes that don't fit, attempt truncation"
 *
 * @example
 * {
 *   node_id: 'n_abc123',
 *   priority_score: 0.85,
 *   tokens: 1200,
 *   retrieval_score: 0.92,
 *   is_critical: false,
 *   was_truncated: false
 * }
 */
export interface PrioritizedNode {
  node_id: string;
  priority_score: number;
  tokens: number;
  retrieval_score: number;
  is_critical: boolean;
  was_truncated: boolean;
  truncation_tier?: TruncationTier;
}

export const PrioritizedNodeSchema = z.object({
  node_id: z.string().min(1),
  priority_score: z.number().min(0).max(1),
  tokens: z.number().int().nonnegative(),
  retrieval_score: z.number().min(0).max(1),
  is_critical: z.boolean(),
  was_truncated: z.boolean(),
  truncation_tier: TruncationTierSchema.optional(),
});

/**
 * Result of packing nodes into a token budget.
 *
 * From brainstorm revision.md Part 1, Packing Algorithm:
 * "Step 1: Include critical nodes first (if they fit)
 *  Step 2: Sort remaining by priority
 *  Step 3: Greedy packing
 *  Step 4: Check for orphaned chunks"
 */
export interface PackedContext {
  nodes: PrioritizedNode[];
  used_tokens: number;
  budget_tokens: number;
  truncated_count: number;
  excluded_count: number;
}

export const PackedContextSchema = z.object({
  nodes: z.array(PrioritizedNodeSchema),
  used_tokens: z.number().int().nonnegative(),
  budget_tokens: z.number().int().nonnegative(),
  truncated_count: z.number().int().nonnegative(),
  excluded_count: z.number().int().nonnegative(),
});

// ============================================================
// TRUNCATION TYPES
// ============================================================

/**
 * Result of a truncation operation.
 *
 * Returned by all truncation functions to track what tier was used,
 * how many tokens were saved, and how long the operation took.
 *
 * @example
 * ```typescript
 * const result: TruncatedContent = {
 *   text: "Introduction to neural networks... [...] ...backpropagation algorithm.",
 *   original_tokens: 3000,
 *   truncated_tokens: 1200,
 *   tier_used: 'semantic_truncation',
 *   latency_ms: 5
 * };
 * ```
 */
export interface TruncatedContent {
  /**
   * The truncated text.
   */
  text: string;

  /**
   * Token count of the original content before truncation.
   */
  original_tokens: number;

  /**
   * Token count of the truncated content.
   * Always <= original_tokens.
   */
  truncated_tokens: number;

  /**
   * Which truncation tier was used.
   */
  tier_used: TruncationTier;

  /**
   * Time spent performing the truncation operation in milliseconds.
   * Should be <= TRUNCATION_MAX_LATENCY_MS (100ms).
   */
  latency_ms: number;
}

export const TruncatedContentSchema = z.object({
  text: z.string(),
  original_tokens: z.number().int().nonnegative(),
  truncated_tokens: z.number().int().nonnegative(),
  tier_used: TruncationTierSchema,
  latency_ms: z.number().nonnegative(),
});

// ============================================================
// PLACEMENT TYPES
// ============================================================

/**
 * Ordered context for LLM prompt assembly.
 *
 * This defines the complete structure of context passed to an LLM,
 * with sections arranged to maximize attention on the most relevant content.
 *
 * From brainstorm revision.md Part 1, Context Assembly Format:
 * "Context Placement (Lost-in-the-Middle Fix):
 *  Position 1: System prompt (cached, high attention)
 *  Position 2: 2nd most relevant memory (primacy)
 *  Positions 3...N-3: Lower relevance (buried zone)
 *  Position N-2: 1st most relevant memory (recency)
 *  Position N-1: Recent messages (recency)
 *  Position N: User query (highest attention)"
 *
 * @example
 * ```typescript
 * const placement: ContextPlacement = {
 *   system_prompt: "You are Nous, an AI with access to the user's knowledge graph...",
 *   retrieved_nodes: [
 *     { node_id: 'n_xyz789', priority_score: 0.82, ... }, // 2nd most relevant → first
 *     { node_id: 'n_def456', priority_score: 0.75, ... }, // 3rd → middle (buried)
 *     { node_id: 'n_abc123', priority_score: 0.92, ... }, // 1st most relevant → last
 *   ],
 *   conversation_summary: "User asked about neural networks, discussed backpropagation...",
 *   recent_messages: [
 *     "User: What's the chain rule?",
 *     "Nous: The chain rule is...",
 *     "User: How does it relate to backprop?",
 *   ],
 *   user_query: "Can you explain backpropagation with examples?"
 * };
 * ```
 */
export interface ContextPlacement {
  /** System prompt (position 1 — high attention). */
  system_prompt: string;

  /** Retrieved nodes reordered for attention. 2nd-most-relevant first, most-relevant last. */
  retrieved_nodes: PrioritizedNode[];

  /** Conversation summary, if any (before recent messages). */
  conversation_summary?: string;

  /** Verbatim recent turns (high recency attention). */
  recent_messages: string[];

  /** User query (position N — highest attention). */
  user_query: string;
}

export const ContextPlacementSchema = z.object({
  system_prompt: z.string(),
  retrieved_nodes: z.array(PrioritizedNodeSchema),
  conversation_summary: z.string().optional(),
  recent_messages: z.array(z.string()),
  user_query: z.string(),
});

// ============================================================
// CONVERSATION TYPES
// ============================================================

/**
 * Configuration for conversation history management.
 *
 * Hybrid approach: Recent messages stay verbatim, old messages get summarized.
 * Summarization happens in background after response is sent, never blocks user.
 *
 * @example
 * ```typescript
 * const config: ConversationHistoryConfig = {
 *   recent_window: {
 *     max_turns: 6,        // 3 exchanges
 *     max_tokens: 8000,
 *   },
 *   summarization: {
 *     turn_trigger: 10,
 *     token_trigger: 20000,
 *     model: 'gpt-4o-mini',
 *     input_budget: 10000,
 *     output_budget: 2000,
 *     compression_target: 0.25,
 *   },
 * };
 * ```
 */
export interface ConversationHistoryConfig {
  /** Recent message window configuration */
  recent_window: {
    /** Maximum number of recent turns to keep verbatim */
    max_turns: number;
    /** Maximum tokens for recent window */
    max_tokens: number;
  };

  /** Summarization configuration */
  summarization: {
    /** Trigger summarization after this many turns */
    turn_trigger: number;
    /** Trigger summarization after this many total tokens */
    token_trigger: number;
    /** LLM model to use for summarization (cheap model) */
    model: string;
    /** Maximum tokens to send to summarizer */
    input_budget: number;
    /** Maximum tokens for summary output */
    output_budget: number;
    /** Target compression ratio (0-1), e.g., 0.25 = 75% reduction */
    compression_target: number;
  };
}

export const ConversationHistoryConfigSchema = z.object({
  recent_window: z.object({
    max_turns: z.number().int().positive(),
    max_tokens: z.number().int().positive(),
  }),
  summarization: z.object({
    turn_trigger: z.number().int().positive(),
    token_trigger: z.number().int().positive(),
    model: z.string().min(1),
    input_budget: z.number().int().positive(),
    output_budget: z.number().int().positive(),
    compression_target: z.number().min(0).max(1),
  }),
});

/**
 * Result of history management operation.
 *
 * Contains summary (if exists), recent messages, and metadata about
 * whether background summarization should be triggered.
 *
 * @example
 * ```typescript
 * // 4-turn conversation (no summarization needed)
 * const history: ManagedHistory = {
 *   summary: undefined,
 *   recent_messages: [
 *     'User: What is a Fourier transform?',
 *     'Assistant: A Fourier transform converts...',
 *     'User: How is it used in signals?',
 *     'Assistant: In signal processing...',
 *   ],
 *   total_tokens: 2400,
 *   needs_summarization: false,
 *   turn_count: 4,
 * };
 * ```
 */
export interface ManagedHistory {
  /** Summary of older messages (if exists) */
  summary?: string;
  /** Recent messages to include verbatim */
  recent_messages: string[];
  /** Total token count (summary + recent) */
  total_tokens: number;
  /** Whether background summarization should be triggered */
  needs_summarization: boolean;
  /** Total number of turns in conversation */
  turn_count: number;
}

export const ManagedHistorySchema = z.object({
  summary: z.string().optional(),
  recent_messages: z.array(z.string()),
  total_tokens: z.number().int().nonnegative(),
  needs_summarization: z.boolean(),
  turn_count: z.number().int().nonnegative(),
});

// ============================================================
// CHUNK TYPES
// ============================================================

/**
 * Chunking thresholds and settings.
 *
 * Defines when content is chunked, target chunk sizes, minimum thresholds,
 * overlap configuration, and embedding limits.
 *
 * From brainstorm revision.md Part 2, Chunking Thresholds:
 * - chunking_trigger: 2000 tokens - start chunking above this
 * - target_min/max: 500-1500 tokens - aim for this range
 * - hard_max: 3000 tokens - force split above this
 * - absolute_max: 5000 tokens - emergency split
 * - overlap_tokens: 100 tokens - ~10% overlap for context
 * - overlap_in_embedding: false - overlap NOT included in embedding
 *
 * @example
 * ```typescript
 * const config: ChunkingConfig = {
 *   chunking_trigger: 2000,
 *   target_min: 500,
 *   target_max: 1500,
 *   hard_max: 3000,
 *   absolute_max: 5000,
 *   min_tokens: 100,
 *   min_sentences: 3,
 *   overlap_tokens: 100,
 *   overlap_in_embedding: false,
 *   embedding_max: 7500,
 * };
 * ```
 */
export interface ChunkingConfig {
  /** Token count above which chunking is triggered */
  chunking_trigger: number;

  /** Minimum target chunk size in tokens */
  target_min: number;

  /** Maximum target chunk size in tokens */
  target_max: number;

  /** Hard limit - force split above this */
  hard_max: number;

  /** Absolute maximum - emergency split */
  absolute_max: number;

  /** Minimum tokens per chunk (avoid fragments) */
  min_tokens: number;

  /** Minimum sentences per chunk */
  min_sentences: number;

  /** Overlap tokens between adjacent chunks */
  overlap_tokens: number;

  /** Whether overlap is included in embedded portion (false = excluded) */
  overlap_in_embedding: boolean;

  /** Maximum token count for embedding a chunk (OpenAI limit with buffer) */
  embedding_max: number;
}

export const ChunkingConfigSchema = z.object({
  chunking_trigger: z.number().int().positive(),
  target_min: z.number().int().positive(),
  target_max: z.number().int().positive(),
  hard_max: z.number().int().positive(),
  absolute_max: z.number().int().positive(),
  min_tokens: z.number().int().positive(),
  min_sentences: z.number().int().positive(),
  overlap_tokens: z.number().int().nonnegative(),
  overlap_in_embedding: z.boolean(),
  embedding_max: z.number().int().positive(),
});

/**
 * Chunk metadata (composes with storm-011 node schema).
 *
 * These fields extend the node schema to track chunk-specific information:
 * position in sequence, navigation links, overlap tracking, and temporary
 * status for on-demand chunks.
 *
 * From brainstorm revision.md Part 2, Chunk Relationship Schema:
 * - is_chunk: boolean flag identifying chunks
 * - parent_id: reference to parent document/section
 * - chunk_index: 0-based position in sequence
 * - total_chunks: total number of chunks in parent
 * - level: 'document' | 'section' | 'paragraph' hierarchy
 * - previous/next_chunk_id: navigation links
 * - overlap_tokens: track overlap with adjacent chunks
 * - overlap_hash: detect if overlap changed (for re-embedding)
 * - temporary: not persisted (on-demand chunks at retrieval time)
 *
 * @example (with a middle chunk)
 * ```typescript
 * const chunk: ChunkFields = {
 *   is_chunk: true,
 *   parent_id: 'n_abc123xyz789',
 *   chunk_index: 1,
 *   total_chunks: 3,
 *   level: 'section',
 *   previous_chunk_id: 'n_def456uvw012',
 *   next_chunk_id: 'n_ghi789rst345',
 *   overlap_tokens: 100,
 *   overlap_hash: 'sha256:a3f2...',
 * };
 * ```
 */
export interface ChunkFields {
  /** Identifies this node as a chunk */
  is_chunk: boolean;

  /** Parent document/section node ID */
  parent_id: string;

  /** 0-based position in chunk sequence */
  chunk_index: number;

  /** Total number of chunks in parent */
  total_chunks: number;

  /** Chunk hierarchy level */
  level: ChunkLevel;

  /** Previous chunk node ID (undefined for first chunk) */
  previous_chunk_id?: string;

  /** Next chunk node ID (undefined for last chunk) */
  next_chunk_id?: string;

  /** Overlap tokens with adjacent chunks */
  overlap_tokens: number;

  /** Hash of overlap content (detect changes) */
  overlap_hash: string;

  /** Not persisted - on-demand chunk (optional) */
  temporary?: boolean;
}

export const ChunkFieldsSchema = z.object({
  is_chunk: z.boolean(),
  parent_id: z.string().min(1),
  chunk_index: z.number().int().nonnegative(),
  total_chunks: z.number().int().positive(),
  level: ChunkLevelSchema,
  previous_chunk_id: z.string().min(1).optional(),
  next_chunk_id: z.string().min(1).optional(),
  overlap_tokens: z.number().int().nonnegative(),
  overlap_hash: z.string(),
  temporary: z.boolean().optional(),
});

/**
 * Parent document metadata.
 *
 * Tracks information about documents/sections that have been chunked.
 * Used to reconstruct the full document when multiple chunks match retrieval,
 * and to access the parent summary for context.
 *
 * From brainstorm revision.md Part 2, Chunk Relationship Schema:
 * - is_parent: boolean flag identifying parent documents
 * - child_ids: ordered array of chunk node IDs
 * - total_tokens: total token count of full document
 * - total_chunks: number of chunks (length of child_ids)
 * - document_type: classification of document
 *
 * @example
 * ```typescript
 * const parent: ParentFields = {
 *   is_parent: true,
 *   child_ids: ['n_chunk1', 'n_chunk2', 'n_chunk3'],
 *   total_tokens: 4500,
 *   total_chunks: 3,
 *   document_type: 'manual_note',
 * };
 * ```
 */
export interface ParentFields {
  /** Identifies this node as a parent of chunks */
  is_parent: boolean;

  /** Ordered array of child chunk node IDs */
  child_ids: string[];

  /** Total token count of full document */
  total_tokens: number;

  /** Total number of chunks (child_ids.length) */
  total_chunks: number;

  /** Classification of document type */
  document_type: string;
}

export const ParentFieldsSchema = z.object({
  is_parent: z.boolean(),
  child_ids: z.array(z.string().min(1)),
  total_tokens: z.number().int().positive(),
  total_chunks: z.number().int().positive(),
  document_type: z.string().min(1),
});

/**
 * How chunks are retrieved and aggregated.
 *
 * Configures chunk expansion (including adjacent chunks for context),
 * aggregation (when multiple chunks from same document match), and
 * parent summary usage.
 *
 * From brainstorm revision.md Part 2, Retrieval Behavior:
 * - expansion.enabled: whether to include adjacent chunks
 * - expansion.max_expansion_tokens: don't expand beyond this
 * - expansion.include_adjacent_chunks: 1 = include 1 before + 1 after
 * - expansion.include_parent_summary: add parent summary for context
 * - aggregation.same_doc_threshold: if 2+ chunks from same doc
 * - aggregation.action: 'merge_with_context' (merge and add summary)
 * - aggregation.high_count_threshold: if 4+ chunks
 * - aggregation.high_count_action: use parent summary + highlights
 *
 * @example
 * ```typescript
 * const config: ChunkRetrievalConfig = {
 *   expansion: {
 *     enabled: true,
 *     max_expansion_tokens: 1500,
 *     include_adjacent_chunks: 1,
 *     include_parent_summary: true,
 *   },
 *   aggregation: {
 *     same_doc_threshold: 2,
 *     action: 'merge_with_context',
 *     high_count_threshold: 4,
 *     high_count_action: 'use_parent_summary_plus_highlights',
 *   },
 * };
 * ```
 */
export interface ChunkRetrievalConfig {
  /** Expansion configuration for including adjacent chunks */
  expansion: {
    /** Whether expansion is enabled */
    enabled: boolean;

    /** Maximum tokens to use for expansion */
    max_expansion_tokens: number;

    /** Number of adjacent chunks to include (1 = 1 before + 1 after) */
    include_adjacent_chunks: number;

    /** Whether to include parent summary for context */
    include_parent_summary: boolean;
  };

  /** Aggregation configuration for multiple chunks from same document */
  aggregation: {
    /** Minimum chunks from same document to trigger aggregation */
    same_doc_threshold: number;

    /** Action when threshold met: 'merge_with_context' */
    action: string;

    /** Threshold for high chunk count */
    high_count_threshold: number;

    /** Action for high count: 'use_parent_summary_plus_highlights' */
    high_count_action: string;
  };
}

export const ChunkRetrievalConfigSchema = z.object({
  expansion: z.object({
    enabled: z.boolean(),
    max_expansion_tokens: z.number().int().positive(),
    include_adjacent_chunks: z.number().int().nonnegative(),
    include_parent_summary: z.boolean(),
  }),
  aggregation: z.object({
    same_doc_threshold: z.number().int().positive(),
    action: z.string().min(1),
    high_count_threshold: z.number().int().positive(),
    high_count_action: z.string().min(1),
  }),
});

// ============================================================
// TOKEN TYPES
// ============================================================

/**
 * Cached token count on a node (avoids re-counting).
 *
 * Token counts are expensive to compute, so we cache them on nodes
 * to avoid re-counting on every retrieval. The counted_with field
 * tracks which tokenizer was used in case we need to re-count
 * with a different tokenizer.
 *
 * From brainstorm revision.md Part 1:
 * "Token count stored on nodes (extend storm-011 schema)"
 *
 * @example
 * ```typescript
 * const cache: TokenCountCache = {
 *   body: 1500,
 *   summary: 200,
 *   total: 1720, // body + title overhead + summary
 *   counted_with: 'estimate',
 *   counted_at: '2026-02-05T10:30:00Z',
 * };
 * ```
 */
export interface TokenCountCache {
  /** Token count of node body */
  body: number;

  /** Token count of node summary (if exists) */
  summary: number;

  /** Total token count (body + title + overhead) */
  total: number;

  /** Tokenizer used: 'tiktoken-gpt4' | 'claude' | 'estimate' */
  counted_with: string;

  /** ISO 8601 timestamp of when count was performed */
  counted_at: string;
}

export const TokenCountCacheSchema = z.object({
  body: z.number().int().nonnegative(),
  summary: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  counted_with: z.string().min(1),
  counted_at: z.string().min(1),
});

// ============================================================
// METRICS TYPES
// ============================================================

/**
 * Per-request context assembly metrics.
 *
 * THIS IS A PERSISTED TYPE - includes _schemaVersion for migration safety.
 *
 * Tracked for every context assembly to understand budget utilization,
 * overflow frequency, and truncation patterns. Used for optimizing
 * priority weights and budget allocations.
 *
 * From brainstorm revision.md:
 * "Metrics and Logging Framework"
 *
 * @example
 * ```typescript
 * const metrics: ContextAssemblyMetrics = {
 *   _schemaVersion: 1,
 *   total_tokens_used: 85000,
 *   retrieved_tokens: 60000,
 *   history_tokens: 25000,
 *   truncation_count: 2,
 *   expansion_count: 1,
 *   latency_ms: 45,
 *   nodes_considered: 50,
 *   nodes_included: 32,
 *   overflow_triggered: true,
 *   model_id: 'claude-sonnet-4',
 * };
 * ```
 */
export interface ContextAssemblyMetrics {
  /** Schema version for migration safety */
  _schemaVersion: number;

  /** Total tokens used in final context */
  total_tokens_used: number;

  /** Tokens from retrieved nodes */
  retrieved_tokens: number;

  /** Tokens from conversation history */
  history_tokens: number;

  /** Number of nodes that were truncated */
  truncation_count: number;

  /** Number of chunks that were expanded */
  expansion_count: number;

  /** Latency of context assembly in milliseconds */
  latency_ms: number;

  /** Number of candidate nodes considered */
  nodes_considered: number;

  /** Number of nodes included in final context */
  nodes_included: number;

  /** Whether overflow handling was triggered */
  overflow_triggered: boolean;

  /** Model ID used for this assembly */
  model_id: string;
}

export const ContextAssemblyMetricsSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  total_tokens_used: z.number().int().nonnegative(),
  retrieved_tokens: z.number().int().nonnegative(),
  history_tokens: z.number().int().nonnegative(),
  truncation_count: z.number().int().nonnegative(),
  expansion_count: z.number().int().nonnegative(),
  latency_ms: z.number().nonnegative(),
  nodes_considered: z.number().int().nonnegative(),
  nodes_included: z.number().int().nonnegative(),
  overflow_triggered: z.boolean(),
  model_id: z.string().min(1),
});

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Master configuration for context window management.
 *
 * THIS IS A PERSISTED TYPE - includes _schemaVersion for migration safety.
 *
 * Combines all context window configuration into a single object:
 * - Fixed allocations (system prompt, min user message)
 * - Priority weights for node scoring
 * - Chunking configuration
 * - Conversation history management
 * - Chunk retrieval behavior
 *
 * From brainstorm revision.md:
 * "Master configuration for the Context Budget Manager (CBM) and
 *  Semantic Chunking System (SCS)"
 *
 * @example
 * ```typescript
 * const config: ContextWindowConfig = {
 *   _schemaVersion: 1,
 *   fixed_allocations: {
 *     system_prompt: 3000,
 *     min_user_message: 2000,
 *   },
 *   priority_weights: {
 *     retrieval_score: 0.40,
 *     query_mentioned: 0.25,
 *     recency: 0.15,
 *     connectivity: 0.10,
 *     importance: 0.10,
 *   },
 *   chunking: {
 *     chunking_trigger: 2000,
 *     target_min: 500,
 *     target_max: 1500,
 *     // ... all chunking config
 *   },
 *   conversation: {
 *     recent_window: { max_turns: 6, max_tokens: 8000 },
 *     summarization: { ... },
 *   },
 *   chunk_retrieval: {
 *     expansion: { ... },
 *     aggregation: { ... },
 *   },
 * };
 * ```
 */
export interface ContextWindowConfig {
  /** Schema version for migration safety */
  _schemaVersion: number;

  /** Fixed token allocations */
  fixed_allocations: FixedAllocations;

  /** Priority weights for node scoring */
  priority_weights: PriorityWeights;

  /** Chunking configuration */
  chunking: ChunkingConfig;

  /** Conversation history configuration */
  conversation: ConversationHistoryConfig;

  /** Chunk retrieval configuration */
  chunk_retrieval: ChunkRetrievalConfig;
}

export const ContextWindowConfigSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  fixed_allocations: FixedAllocationsSchema,
  priority_weights: PriorityWeightsSchema,
  chunking: ChunkingConfigSchema,
  conversation: ConversationHistoryConfigSchema,
  chunk_retrieval: ChunkRetrievalConfigSchema,
});

/**
 * Default context window configuration.
 * All values sourced from constants.
 */
export const DEFAULT_CONTEXT_WINDOW_CONFIG: ContextWindowConfig = {
  _schemaVersion: CW_SCHEMA_VERSION,
  fixed_allocations: {
    system_prompt: DEFAULT_SYSTEM_PROMPT_TOKENS,
    min_user_message: DEFAULT_MIN_USER_TOKENS,
    response_buffer: 12000, // Will be overridden by model-specific value
  },
  priority_weights: {
    retrieval_score: DEFAULT_PRIORITY_WEIGHTS.retrieval_score,
    query_mentioned: DEFAULT_PRIORITY_WEIGHTS.query_mentioned,
    recency: DEFAULT_PRIORITY_WEIGHTS.recency,
    connectivity: DEFAULT_PRIORITY_WEIGHTS.connectivity,
    importance: DEFAULT_PRIORITY_WEIGHTS.importance,
  },
  chunking: {
    chunking_trigger: CHUNKING_TRIGGER_TOKENS,
    target_min: CHUNK_TARGET_MIN,
    target_max: CHUNK_TARGET_MAX,
    hard_max: CHUNK_HARD_MAX,
    absolute_max: CHUNK_ABSOLUTE_MAX,
    min_tokens: CHUNK_MIN_TOKENS,
    min_sentences: CHUNK_MIN_SENTENCES,
    overlap_tokens: CHUNK_OVERLAP_TOKENS,
    overlap_in_embedding: CHUNK_OVERLAP_IN_EMBEDDING,
    embedding_max: CHUNK_EMBEDDING_MAX,
  },
  conversation: {
    recent_window: {
      max_turns: CONVERSATION_RECENT_TURNS,
      max_tokens: CONVERSATION_RECENT_MAX_TOKENS,
    },
    summarization: {
      turn_trigger: SUMMARIZATION_TURN_TRIGGER,
      token_trigger: SUMMARIZATION_TOKEN_TRIGGER,
      model: SUMMARIZATION_MODEL,
      input_budget: SUMMARIZATION_INPUT_BUDGET,
      output_budget: SUMMARIZATION_OUTPUT_BUDGET,
      compression_target: SUMMARIZATION_COMPRESSION_TARGET,
    },
  },
  chunk_retrieval: {
    expansion: {
      enabled: true,
      max_expansion_tokens: CHUNK_EXPANSION_MAX_TOKENS,
      include_adjacent_chunks: CHUNK_ADJACENT_COUNT,
      include_parent_summary: true,
    },
    aggregation: {
      same_doc_threshold: CHUNK_SAME_DOC_THRESHOLD,
      action: 'merge_with_context',
      high_count_threshold: CHUNK_HIGH_COUNT_THRESHOLD,
      high_count_action: 'use_parent_summary_plus_highlights',
    },
  },
} as const;

/**
 * Default conversation history configuration.
 */
export const DEFAULT_CONVERSATION_CONFIG: ConversationHistoryConfig = {
  recent_window: {
    max_turns: CONVERSATION_RECENT_TURNS,
    max_tokens: CONVERSATION_RECENT_MAX_TOKENS,
  },
  summarization: {
    turn_trigger: SUMMARIZATION_TURN_TRIGGER,
    token_trigger: SUMMARIZATION_TOKEN_TRIGGER,
    model: SUMMARIZATION_MODEL,
    input_budget: SUMMARIZATION_INPUT_BUDGET,
    output_budget: SUMMARIZATION_OUTPUT_BUDGET,
    compression_target: SUMMARIZATION_COMPRESSION_TARGET,
  },
} as const;

// ============================================================
// TYPE GUARDS
// ============================================================

/**
 * Type guard for FixedAllocations.
 */
export function isFixedAllocations(value: unknown): value is FixedAllocations {
  return FixedAllocationsSchema.safeParse(value).success;
}

/**
 * Type guard for ModelContextBudget.
 */
export function isModelContextBudget(value: unknown): value is ModelContextBudget {
  return ModelContextBudgetSchema.safeParse(value).success;
}

/**
 * Type guard for ContextAllocationRequest.
 */
export function isContextAllocationRequest(value: unknown): value is ContextAllocationRequest {
  return ContextAllocationRequestSchema.safeParse(value).success;
}

/**
 * Type guard for ContextAllocationResult.
 */
export function isContextAllocationResult(value: unknown): value is ContextAllocationResult {
  return ContextAllocationResultSchema.safeParse(value).success;
}

/**
 * Type guard for PriorityWeights.
 */
export function isPriorityWeights(value: unknown): value is PriorityWeights {
  return PriorityWeightsSchema.safeParse(value).success;
}

/**
 * Type guard for NodePriorityFactors.
 */
export function isNodePriorityFactors(value: unknown): value is NodePriorityFactors {
  return NodePriorityFactorsSchema.safeParse(value).success;
}

/**
 * Type guard for PrioritizedNode.
 */
export function isPrioritizedNode(value: unknown): value is PrioritizedNode {
  return PrioritizedNodeSchema.safeParse(value).success;
}

/**
 * Type guard for PackedContext.
 */
export function isPackedContext(value: unknown): value is PackedContext {
  return PackedContextSchema.safeParse(value).success;
}

/**
 * Type guard for TruncatedContent.
 */
export function isTruncatedContent(value: unknown): value is TruncatedContent {
  return TruncatedContentSchema.safeParse(value).success;
}

/**
 * Type guard for ContextPlacement.
 */
export function isContextPlacement(value: unknown): value is ContextPlacement {
  return ContextPlacementSchema.safeParse(value).success;
}

/**
 * Type guard for ConversationHistoryConfig.
 */
export function isConversationHistoryConfig(value: unknown): value is ConversationHistoryConfig {
  return ConversationHistoryConfigSchema.safeParse(value).success;
}

/**
 * Type guard for ManagedHistory.
 */
export function isManagedHistory(value: unknown): value is ManagedHistory {
  return ManagedHistorySchema.safeParse(value).success;
}

/**
 * Type guard for ChunkingConfig.
 */
export function isChunkingConfig(value: unknown): value is ChunkingConfig {
  return ChunkingConfigSchema.safeParse(value).success;
}

/**
 * Type guard for ChunkFields.
 */
export function isChunkFields(value: unknown): value is ChunkFields {
  return ChunkFieldsSchema.safeParse(value).success;
}

/**
 * Type guard for ParentFields.
 */
export function isParentFields(value: unknown): value is ParentFields {
  return ParentFieldsSchema.safeParse(value).success;
}

/**
 * Type guard for ChunkRetrievalConfig.
 */
export function isChunkRetrievalConfig(value: unknown): value is ChunkRetrievalConfig {
  return ChunkRetrievalConfigSchema.safeParse(value).success;
}

/**
 * Type guard for TokenCountCache.
 */
export function isTokenCountCache(value: unknown): value is TokenCountCache {
  return TokenCountCacheSchema.safeParse(value).success;
}

/**
 * Type guard for ContextAssemblyMetrics.
 */
export function isContextAssemblyMetrics(value: unknown): value is ContextAssemblyMetrics {
  return ContextAssemblyMetricsSchema.safeParse(value).success;
}

/**
 * Type guard for ContextWindowConfig.
 */
export function isContextWindowConfig(value: unknown): value is ContextWindowConfig {
  return ContextWindowConfigSchema.safeParse(value).success;
}

// ============================================================
// RE-EXPORTS FROM CONSTANTS
// ============================================================

export type { TruncationTier, ChunkLevel };
