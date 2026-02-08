/**
 * @module @nous/core/context-window
 * @description Constants for the Context Window & Chunking Strategy
 * @version 1.0.0
 * @spec Specs/Phase-8-Scaling-Limits/storm-029
 * @storm Brainstorms/Infrastructure/storm-029-context-chunking
 *
 * Defines token budget allocations, priority weights, truncation tiers,
 * conversation history thresholds, chunking configuration, and token
 * estimation parameters.
 *
 * NOTE: Model context windows and provider information are defined in
 * storm-015 (llm). This module adds the context-window-specific constants
 * that storm-029 introduces for budget allocation and chunking.
 */

import { z } from 'zod';

// ============================================================
// SCHEMA VERSION
// ============================================================

/**
 * Schema version for persisted context-window types.
 * All persisted types must include _schemaVersion per Technical Audit requirement.
 */
export const CW_SCHEMA_VERSION = 1;

// ============================================================
// FIXED ALLOCATIONS
// ============================================================

/**
 * Default system prompt token budget.
 * Informed by storm-027 P-008 chat system prompt (2500 tokens).
 * 3000 provides headroom for context customization.
 */
export const DEFAULT_SYSTEM_PROMPT_TOKENS = 3000;

/**
 * Default minimum user message token budget.
 * Guaranteed minimum allocation for user input.
 */
export const DEFAULT_MIN_USER_TOKENS = 2000;

// ============================================================
// PROVIDER RETRIEVAL RATIOS
// ============================================================

/**
 * Retrieval allocation ratio by provider.
 * Anthropic and Google models get 70% (better at long context).
 * OpenAI models get 65% (slightly more history-focused).
 *
 * From brainstorm revision.md Part 1:
 * "Claude models get higher retrieved allocation (70% vs 65%)
 *  due to better long-context handling."
 */
export const PROVIDER_RETRIEVAL_RATIOS: Record<string, number> = {
  anthropic: 0.70,
  openai: 0.65,
  google: 0.70,
};

// ============================================================
// RESPONSE BUFFERS
// ============================================================

/**
 * Response token buffer per model.
 * Premium models get larger buffers for detailed responses.
 *
 * From brainstorm revision.md Part 1:
 * "Larger response buffer for advanced models (12-16K)
 *  to allow more detailed responses."
 */
export const DEFAULT_RESPONSE_BUFFERS: Record<string, number> = {
  'claude-sonnet-4': 16000,
  'claude-3-haiku': 8000,
  'gpt-4o': 12000,
  'gpt-4o-mini': 8000,
  'gemini-2.0-flash': 12000,
  'gemini-2.0-flash-lite': 8000,
};

/**
 * Fallback response buffer for unknown models.
 */
export const DEFAULT_RESPONSE_BUFFER_FALLBACK = 12000;

// ============================================================
// PRIORITY WEIGHTS
// ============================================================

/**
 * Priority weight factor names for Weighted Priority Scoring (WPS).
 *
 * From brainstorm revision.md Part 1, Node Prioritization Algorithm:
 * - retrievalScore: SSA reranked score (most important)
 * - queryMentioned: 1.0 if query directly mentions node, else 0.0
 * - recency: exponential decay from last access
 * - connectivity: bonus for connections to already-included nodes
 * - importance: neural importance score from node metadata
 */
export const PRIORITY_WEIGHT_NAMES = [
  'retrieval_score',
  'query_mentioned',
  'recency',
  'connectivity',
  'importance',
] as const;

export type PriorityWeightName = (typeof PRIORITY_WEIGHT_NAMES)[number];

export const PriorityWeightNameSchema = z.enum(PRIORITY_WEIGHT_NAMES);

/**
 * Type guard for PriorityWeightName.
 */
export function isPriorityWeightName(value: unknown): value is PriorityWeightName {
  return PRIORITY_WEIGHT_NAMES.includes(value as PriorityWeightName);
}

/**
 * Default priority weights for Weighted Priority Scoring.
 * Sum to 1.0.
 *
 * From brainstorm revision.md Part 1:
 * "Learnable defaults with A/B framework."
 * v1 uses static weights; learning infrastructure is deferred.
 */
export const DEFAULT_PRIORITY_WEIGHTS: Record<PriorityWeightName, number> = {
  retrieval_score: 0.40,
  query_mentioned: 0.25,
  recency: 0.15,
  connectivity: 0.10,
  importance: 0.10,
};

/**
 * Recency score half-life in days.
 * After this many days, recency score decays to ~0.5.
 *
 * From brainstorm revision.md Part 1:
 * "Math.exp(-daysSince / 30)" with half-life of ~20 days.
 */
export const RECENCY_HALF_LIFE_DAYS = 20;

/**
 * Per-connected-node bonus for connectivity scoring.
 * Score = min(1.0, connectedCount * CONNECTIVITY_CAP_FACTOR).
 *
 * From brainstorm revision.md Part 1:
 * "Math.min(1.0, connectedCount * 0.3)"
 */
export const CONNECTIVITY_CAP_FACTOR = 0.3;

// ============================================================
// TRUNCATION
// ============================================================

/**
 * Truncation tier identifiers, ordered by preference.
 * Tier 1 is preferred (cheapest), Tier 4 is fallback.
 *
 * From brainstorm revision.md Part 1, Truncation Strategy:
 * - use_summary: Use existing node summary (0ms)
 * - semantic_truncation: Keep first 60% + last 20% (5-10ms)
 * - extract_relevant: Query-relevant sentences (50-80ms)
 * - hard_truncation: Truncate at sentence boundary (1ms)
 */
export const TRUNCATION_TIERS = [
  'use_summary',
  'semantic_truncation',
  'extract_relevant',
  'hard_truncation',
] as const;

export type TruncationTier = (typeof TRUNCATION_TIERS)[number];

export const TruncationTierSchema = z.enum(TRUNCATION_TIERS);

/**
 * Type guard for TruncationTier.
 */
export function isTruncationTier(value: unknown): value is TruncationTier {
  return TRUNCATION_TIERS.includes(value as TruncationTier);
}

/**
 * Hard limit for all truncation operations in milliseconds.
 *
 * From brainstorm revision.md Part 1:
 * "maxLatency: 100 // ms - hard limit for truncation"
 */
export const TRUNCATION_MAX_LATENCY_MS = 100;

/**
 * Expected latency per truncation tier in milliseconds.
 */
export const TRUNCATION_TIER_LATENCIES: Record<TruncationTier, number> = {
  use_summary: 0,
  semantic_truncation: 10,
  extract_relevant: 80,
  hard_truncation: 1,
};

/**
 * Fraction of content to keep from the start during semantic truncation.
 *
 * From brainstorm revision.md Part 1:
 * "Keep first 60% + last 20%"
 */
export const SEMANTIC_TRUNCATION_KEEP_START = 0.6;

/**
 * Fraction of content to keep from the end during semantic truncation.
 */
export const SEMANTIC_TRUNCATION_KEEP_END = 0.2;

// ============================================================
// SPARSE RETRIEVAL
// ============================================================

/**
 * Token threshold below which retrieval is considered "sparse".
 *
 * From brainstorm revision.md Part 1, Empty/Sparse Retrieval Handling:
 * "if (retrievedTokens < 1000)"
 */
export const SPARSE_RETRIEVAL_THRESHOLD = 1000;

/**
 * Extra response buffer tokens when retrieval is sparse.
 *
 * From brainstorm revision.md Part 1:
 * "budget.fixed.responseBuffer += 4000"
 */
export const SPARSE_EXTRA_RESPONSE_BUFFER = 4000;

// ============================================================
// CONVERSATION HISTORY
// ============================================================

/**
 * Number of recent turns to keep verbatim.
 *
 * From brainstorm revision.md Part 1, Conversation History Management:
 * "maxTurns: 6 // 3 exchanges"
 */
export const CONVERSATION_RECENT_TURNS = 6;

/**
 * Maximum tokens for the recent verbatim window.
 */
export const CONVERSATION_RECENT_MAX_TOKENS = 8000;

/**
 * Summarize conversation after this many total turns.
 *
 * From brainstorm revision.md Part 1:
 * "turnCount: 10 // After 10 total turns"
 */
export const SUMMARIZATION_TURN_TRIGGER = 10;

/**
 * Summarize conversation after this many total tokens.
 *
 * From brainstorm revision.md Part 1:
 * "tokenCount: 20000 // OR after 20K tokens"
 */
export const SUMMARIZATION_TOKEN_TRIGGER = 20000;

/**
 * Model used for background summarization.
 * Uses a cheap model to minimize cost.
 *
 * From brainstorm revision.md Part 1:
 * "model: 'gpt-4o-mini' // Not the main conversation model"
 */
export const SUMMARIZATION_MODEL = 'gpt-4o-mini';

/**
 * Maximum input tokens to the summarization model.
 */
export const SUMMARIZATION_INPUT_BUDGET = 10000;

/**
 * Maximum output tokens from the summarization model.
 */
export const SUMMARIZATION_OUTPUT_BUDGET = 2000;

/**
 * Target compression ratio for summarization.
 * 0.25 = 75% reduction (keep 25% of original).
 *
 * From brainstorm revision.md Part 1:
 * "targetRatio: 0.25 // 75% reduction"
 */
export const SUMMARIZATION_COMPRESSION_TARGET = 0.25;

// ============================================================
// CHUNKING
// ============================================================

/**
 * Token count above which content should be chunked.
 *
 * From brainstorm revision.md Part 2, Chunking Thresholds:
 * "chunkingTrigger: 2000 // tokens - start chunking above this"
 */
export const CHUNKING_TRIGGER_TOKENS = 2000;

/**
 * Minimum target chunk size in tokens.
 */
export const CHUNK_TARGET_MIN = 500;

/**
 * Maximum target chunk size in tokens.
 */
export const CHUNK_TARGET_MAX = 1500;

/**
 * Force split above this token count.
 */
export const CHUNK_HARD_MAX = 3000;

/**
 * Emergency split above this token count.
 */
export const CHUNK_ABSOLUTE_MAX = 5000;

/**
 * Minimum tokens per chunk (avoid fragments).
 */
export const CHUNK_MIN_TOKENS = 100;

/**
 * Minimum sentences per chunk.
 */
export const CHUNK_MIN_SENTENCES = 3;

/**
 * Overlap tokens between adjacent chunks for reading context.
 *
 * From brainstorm revision.md Part 2:
 * "overlapTokens: 100 // ~10% overlap for context"
 */
export const CHUNK_OVERLAP_TOKENS = 100;

/**
 * Whether overlap content is included in the embedded portion.
 * FALSE = overlap is excluded from embedding to prevent duplicate retrieval.
 *
 * From brainstorm revision.md Part 2:
 * "overlapInEmbedding: false // NEW: Overlap NOT included in embedding"
 */
export const CHUNK_OVERLAP_IN_EMBEDDING = false;

/**
 * Maximum token count for embedding a single chunk.
 * OpenAI embedding model limit with buffer.
 */
export const CHUNK_EMBEDDING_MAX = 7500;

/**
 * Chunk hierarchy levels.
 *
 * From brainstorm revision.md Part 2, Chunk Relationship Schema:
 * "level: 'document' | 'section' | 'paragraph'"
 */
export const CHUNK_LEVELS = ['document', 'section', 'paragraph'] as const;

export type ChunkLevel = (typeof CHUNK_LEVELS)[number];

export const ChunkLevelSchema = z.enum(CHUNK_LEVELS);

/**
 * Type guard for ChunkLevel.
 */
export function isChunkLevel(value: unknown): value is ChunkLevel {
  return CHUNK_LEVELS.includes(value as ChunkLevel);
}

/**
 * Edge types for chunk relationships.
 *
 * From brainstorm revision.md Part 2, Chunk Relationship Schema:
 * - chunk_of: Chunk -> Parent
 * - section_of: Section -> Document
 * - follows: Chunk -> Previous
 * - contains: Section -> Chunk
 */
export const CHUNK_EDGE_TYPES = ['chunk_of', 'section_of', 'follows', 'contains'] as const;

export type ChunkEdgeType = (typeof CHUNK_EDGE_TYPES)[number];

export const ChunkEdgeTypeSchema = z.enum(CHUNK_EDGE_TYPES);

/**
 * Type guard for ChunkEdgeType.
 */
export function isChunkEdgeType(value: unknown): value is ChunkEdgeType {
  return CHUNK_EDGE_TYPES.includes(value as ChunkEdgeType);
}

// ============================================================
// CHUNK RETRIEVAL
// ============================================================

/**
 * Maximum expansion tokens when including adjacent chunks.
 *
 * From brainstorm revision.md Part 2, Retrieval Behavior:
 * "maxExpansionTokens: 1500"
 */
export const CHUNK_EXPANSION_MAX_TOKENS = 1500;

/**
 * Number of adjacent chunks to include (1 before + 1 after).
 *
 * From brainstorm revision.md Part 2:
 * "includeAdjacentChunks: 1"
 */
export const CHUNK_ADJACENT_COUNT = 1;

/**
 * Minimum chunks from same document to trigger merge.
 *
 * From brainstorm revision.md Part 2:
 * "sameDocThreshold: 2 // If 2+ chunks from same doc"
 */
export const CHUNK_SAME_DOC_THRESHOLD = 2;

/**
 * Chunk count above which parent summary is used instead.
 *
 * From brainstorm revision.md Part 2:
 * "highCountThreshold: 4"
 */
export const CHUNK_HIGH_COUNT_THRESHOLD = 4;

// ============================================================
// TOKEN ESTIMATION
// ============================================================

/**
 * Conservative characters-per-token ratio for estimation.
 * Used as fallback when model-specific tokenizer is not available.
 *
 * From brainstorm revision.md Part 1:
 * "1 token ~ 3.5 characters"
 */
export const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 3.5;
