/**
 * @module @nous/core/context-window
 * @description Context Window & Chunking Strategy - Functions and barrel exports
 * @version 1.0.0
 * @spec Specs/Phase-8-Scaling-Limits/storm-029
 * @storm Brainstorms/Infrastructure/storm-029-context-chunking
 *
 * Two complementary systems:
 * 1. Context Budget Manager (CBM): Dynamic token allocation, node prioritization, truncation, placement
 * 2. Semantic Chunking System (SCS): Chunking thresholds, chunk relationships, retrieval aggregation
 *
 * Dependencies:
 * - storm-015 (llm): MODEL_CONFIGS, getModelConfig, getProviderForModel
 * - storm-012 (adaptive-limits): ThoroughnessLevel (type-only)
 */

// ============================================================
// BARREL EXPORTS
// ============================================================

export * from './constants';
export * from './types';

// ============================================================
// IMPORTS
// ============================================================

import {
  MODEL_CONFIGS,
  getModelConfig,
  getProviderForModel,
} from '../llm';

import {
  CW_SCHEMA_VERSION,
  DEFAULT_SYSTEM_PROMPT_TOKENS,
  DEFAULT_MIN_USER_TOKENS,
  DEFAULT_RESPONSE_BUFFER_FALLBACK,
  PROVIDER_RETRIEVAL_RATIOS,
  DEFAULT_RESPONSE_BUFFERS,
  DEFAULT_PRIORITY_WEIGHTS,
  RECENCY_HALF_LIFE_DAYS,
  CONNECTIVITY_CAP_FACTOR,
  SEMANTIC_TRUNCATION_KEEP_START,
  SEMANTIC_TRUNCATION_KEEP_END,
  SPARSE_RETRIEVAL_THRESHOLD,
  SPARSE_EXTRA_RESPONSE_BUFFER,
  TOKEN_ESTIMATE_CHARS_PER_TOKEN,
  type TruncationTier,
  type ChunkLevel,
} from './constants';

import type {
  ModelContextBudget,
  ContextAllocationRequest,
  ContextAllocationResult,
  PriorityWeights,
  NodePriorityFactors,
  PrioritizedNode,
  PackedContext,
  ChunkingConfig,
  ChunkFields,
  ParentFields,
  ChunkRetrievalConfig,
  ConversationHistoryConfig,
  ManagedHistory,
  ContextWindowConfig,
} from './types';

import { DEFAULT_CONTEXT_WINDOW_CONFIG } from './types';

// ============================================================
// BUDGET ALLOCATION
// ============================================================

/**
 * Gets the model-specific context budget.
 *
 * Looks up MODEL_CONFIGS for context_window size and provider for retrieval
 * ratio. Claude models get 70% retrieval ratio (better long-context handling),
 * GPT models get 65%.
 *
 * Falls back to gpt-4o-mini budget for unknown models.
 *
 * @param modelId - Model ID from storm-015 LLM_MODELS
 * @returns ModelContextBudget with allocations
 *
 * @example
 * ```typescript
 * const budget = getModelContextBudget('claude-sonnet-4');
 * // => {
 * //   model_id: 'claude-sonnet-4',
 * //   total_context: 200000,
 * //   fixed: { system_prompt: 3000, min_user_message: 2000, response_buffer: 16000 },
 * //   flexible_pool: 179000,
 * //   retrieval_ratio: 0.70,
 * //   default_retrieved: 125300,
 * //   default_history: 53700,
 * // }
 * ```
 */
export function getModelContextBudget(modelId: string): ModelContextBudget {
  // Get model config from storm-015
  let config = getModelConfig(modelId);

  // Fall back to gpt-4o-mini if model not found
  if (!config) {
    config = MODEL_CONFIGS['gpt-4o-mini'];
    if (!config) {
      // Absolute fallback if even gpt-4o-mini is missing (should never happen)
      throw new Error('Critical error: gpt-4o-mini not found in MODEL_CONFIGS');
    }
  }

  // Get provider to determine retrieval ratio
  const provider = getProviderForModel(config.id);
  const retrievalRatio = provider ? (PROVIDER_RETRIEVAL_RATIOS[provider] ?? 0.65) : 0.65;

  // Get response buffer (model-specific or fallback)
  const responseBuffer = DEFAULT_RESPONSE_BUFFERS[config.id] ?? DEFAULT_RESPONSE_BUFFER_FALLBACK;

  // Calculate fixed allocations
  const fixedAllocs = {
    system_prompt: DEFAULT_SYSTEM_PROMPT_TOKENS,
    min_user_message: DEFAULT_MIN_USER_TOKENS,
    response_buffer: responseBuffer,
  };

  // Calculate flexible pool
  const flexiblePool = Math.max(
    0,
    config.context_window - fixedAllocs.system_prompt - fixedAllocs.min_user_message - fixedAllocs.response_buffer
  );

  // Calculate defaults
  const defaultRetrieved = Math.floor(flexiblePool * retrievalRatio);
  const defaultHistory = flexiblePool - defaultRetrieved;

  return {
    model_id: config.id,
    total_context: config.context_window,
    fixed: fixedAllocs,
    flexible_pool: flexiblePool,
    retrieval_ratio: retrievalRatio,
    default_retrieved: defaultRetrieved,
    default_history: defaultHistory,
  };
}

/**
 * Main budget allocation algorithm.
 *
 * Steps:
 * 1. Get model budget
 * 2. Calculate user allocation (max of min and actual)
 * 3. Calculate flexible pool after user expansion
 * 4. Split by retrieval_ratio
 * 5. Check overflow (retrieved > allocated OR history > allocated)
 * 6. Reallocate unused tokens (if retrieved < 50% of allocation, share with history)
 *
 * Returns action='proceed' if everything fits, action='prioritize_nodes' if
 * retrieved content exceeds budget, or action='summarize_history' if history
 * exceeds budget.
 *
 * @param request - ContextAllocationRequest with model, tokens, thoroughness
 * @returns ContextAllocationResult with action and allocations
 *
 * @example
 * ```typescript
 * const request: ContextAllocationRequest = {
 *   model_id: 'claude-sonnet-4',
 *   user_message_tokens: 2500,
 *   retrieved_tokens: 80000,
 *   history_tokens: 45000,
 * };
 * const result = allocateContext(request);
 * // => { action: 'proceed', allocations: {...}, ... }
 * ```
 */
export function allocateContext(
  request: ContextAllocationRequest
): ContextAllocationResult {
  // Step 1: Get model budget
  const budget = getModelContextBudget(request.model_id);

  // Step 2: Calculate actual user allocation (max of min and actual)
  const userAllocation = Math.max(budget.fixed.min_user_message, request.user_message_tokens);

  // Step 3: Calculate flexible pool after user expansion
  const flexiblePool = Math.max(
    0,
    budget.total_context - budget.fixed.system_prompt - userAllocation - budget.fixed.response_buffer
  );

  // Step 4: Split flexible pool by retrieval ratio
  let retrievedAllocation = Math.floor(flexiblePool * budget.retrieval_ratio);
  let historyAllocation = flexiblePool - retrievedAllocation;

  // Step 5: Check overflow conditions
  let action: 'proceed' | 'prioritize_nodes' | 'summarize_history' = 'proceed';

  if (request.retrieved_tokens > retrievedAllocation) {
    action = 'prioritize_nodes';
  } else if (request.history_tokens > historyAllocation) {
    action = 'summarize_history';
  }

  // Step 6: Reallocate unused space if retrieved is sparse
  if (request.retrieved_tokens < retrievedAllocation * 0.5) {
    const unusedRetrieved = retrievedAllocation - request.retrieved_tokens;
    const sharedAmount = Math.floor(unusedRetrieved / 2);
    retrievedAllocation -= sharedAmount;
    historyAllocation += sharedAmount;
  }

  // Calculate unused tokens
  const usedTokens = budget.fixed.system_prompt + userAllocation +
                     Math.min(request.retrieved_tokens, retrievedAllocation) +
                     Math.min(request.history_tokens, historyAllocation) +
                     budget.fixed.response_buffer;
  const unusedTokens = Math.max(0, budget.total_context - usedTokens);

  return {
    _schemaVersion: CW_SCHEMA_VERSION,
    action,
    allocations: {
      system_prompt: budget.fixed.system_prompt,
      user_message: userAllocation,
      retrieved: retrievedAllocation,
      history: historyAllocation,
      response: budget.fixed.response_buffer,
    },
    flexible_pool: flexiblePool,
    unused_tokens: unusedTokens,
    model_id: request.model_id,
  };
}

/**
 * Handles sparse retrieval by reallocating budget.
 *
 * When retrieved content is very sparse (< SPARSE_RETRIEVAL_THRESHOLD,
 * typically 1000 tokens), adds SPARSE_EXTRA_RESPONSE_BUFFER to response
 * allocation to allow more detailed responses.
 *
 * Returns a NEW ModelContextBudget object (immutable - does not mutate input).
 *
 * @param retrievedTokens - Number of tokens in retrieved context
 * @param budget - Original ModelContextBudget
 * @returns New ModelContextBudget with adjusted response buffer
 *
 * @example
 * ```typescript
 * const originalBudget: ModelContextBudget = {
 *   model_id: 'gpt-4o',
 *   total_context: 128000,
 *   fixed: { system_prompt: 3000, min_user_message: 2000, response_buffer: 12000 },
 *   flexible_pool: 111000,
 *   retrieval_ratio: 0.65,
 *   default_retrieved: 72150,
 *   default_history: 38850,
 * };
 * const adjustedBudget = handleSparseRetrieval(500, originalBudget);
 * // => { ...originalBudget, fixed: { ...fixed, response_buffer: 16000 } }
 * ```
 */
export function handleSparseRetrieval(
  retrievedTokens: number,
  budget: ModelContextBudget
): ModelContextBudget {
  // If not sparse, return original budget
  if (retrievedTokens >= SPARSE_RETRIEVAL_THRESHOLD) {
    return budget;
  }

  // Add extra response buffer
  const newResponseBuffer = budget.fixed.response_buffer + SPARSE_EXTRA_RESPONSE_BUFFER;

  // Recalculate flexible pool with new response buffer
  const newFlexiblePool = Math.max(
    0,
    budget.total_context - budget.fixed.system_prompt - budget.fixed.min_user_message - newResponseBuffer
  );

  const newDefaultRetrieved = Math.floor(newFlexiblePool * budget.retrieval_ratio);
  const newDefaultHistory = newFlexiblePool - newDefaultRetrieved;

  // Return new budget object (immutable)
  return {
    ...budget,
    fixed: {
      ...budget.fixed,
      response_buffer: newResponseBuffer,
    },
    flexible_pool: newFlexiblePool,
    default_retrieved: newDefaultRetrieved,
    default_history: newDefaultHistory,
  };
}

// ============================================================
// NODE PRIORITIZATION
// ============================================================

/**
 * Calculates a node's priority score using weighted factors.
 *
 * Pure weighted sum: priority = sum(factor_i * weight_i)
 * Uses DEFAULT_PRIORITY_WEIGHTS from constants if weights omitted.
 *
 * @param factors - Normalized input factors (each 0-1)
 * @param weights - Priority weights (optional, uses defaults)
 * @returns Priority score (0-1)
 *
 * @example
 * const factors: NodePriorityFactors = {
 *   retrieval_score: 1.0,
 *   query_mentioned: 1.0,
 *   recency: 1.0,
 *   connectivity: 1.0,
 *   importance: 1.0,
 * };
 * const score = calculateNodePriority(factors);
 * // => 1.0 (all factors at max, sum of weights is 1.0)
 */
export function calculateNodePriority(
  factors: NodePriorityFactors,
  weights?: PriorityWeights
): number {
  const w = weights ?? DEFAULT_PRIORITY_WEIGHTS;

  return (
    factors.retrieval_score * w.retrieval_score +
    factors.query_mentioned * w.query_mentioned +
    factors.recency * w.recency +
    factors.connectivity * w.connectivity +
    factors.importance * w.importance
  );
}

/**
 * Calculates recency score using exponential decay.
 *
 * Formula: Math.exp(-daysSince / (RECENCY_HALF_LIFE_DAYS * 1.4427))
 * where 1.4427 = 1/ln(2) converts half-life to decay constant.
 *
 * @param lastAccessedIso - ISO 8601 timestamp of last access
 * @returns Recency score (0-1)
 *
 * @example
 * const score0 = calculateRecencyScore(new Date().toISOString());
 * // => ~1.0 (accessed just now)
 *
 * const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
 * const score20 = calculateRecencyScore(twentyDaysAgo);
 * // => ~0.5 (half-life decay)
 */
export function calculateRecencyScore(lastAccessedIso: string): number {
  const now = Date.now();
  const lastAccessed = new Date(lastAccessedIso).getTime();
  const daysSince = (now - lastAccessed) / (1000 * 60 * 60 * 24);

  // Clamp negative days to 0 (future dates become score 1.0)
  if (daysSince < 0) {
    return 1.0;
  }

  // Exponential decay: 1.4427 = 1/ln(2) converts half-life to decay constant
  const decayConstant = RECENCY_HALF_LIFE_DAYS * 1.4427;
  return Math.exp(-daysSince / decayConstant);
}

/**
 * Calculates connectivity score based on connections to included nodes.
 *
 * Formula: Math.min(1.0, connectedToIncludedCount * CONNECTIVITY_CAP_FACTOR)
 * where CONNECTIVITY_CAP_FACTOR = 0.3
 *
 * @param connectedToIncludedCount - Number of connections to included nodes
 * @returns Connectivity score (0-1)
 *
 * @example
 * calculateConnectivityScore(0);
 * // => 0.0 (no connections)
 *
 * calculateConnectivityScore(3);
 * // => 0.9 (3 * 0.3)
 *
 * calculateConnectivityScore(4);
 * // => 1.0 (capped at 1.0)
 */
export function calculateConnectivityScore(connectedToIncludedCount: number): number {
  return Math.min(1.0, Math.max(0, connectedToIncludedCount) * CONNECTIVITY_CAP_FACTOR);
}

/**
 * Packs nodes into a token budget using greedy algorithm with critical node support.
 *
 * Algorithm:
 * 1. Include critical nodes first (if they fit)
 * 2. Sort remaining by priority_score descending
 * 3. Greedy packing: include nodes while budget allows
 * 4. Track truncated and excluded counts
 *
 * @param candidates - Array of nodes with priority scores
 * @param budgetTokens - Available token budget
 * @param criticalNodeIds - Optional array of critical node IDs
 * @returns Packed context with included nodes and metadata
 *
 * @example
 * const candidates: PrioritizedNode[] = [
 *   { node_id: 'n_1', priority_score: 0.9, tokens: 500, retrieval_score: 0.9, is_critical: true, was_truncated: false },
 *   { node_id: 'n_2', priority_score: 0.8, tokens: 400, retrieval_score: 0.8, is_critical: false, was_truncated: false },
 *   { node_id: 'n_3', priority_score: 0.7, tokens: 300, retrieval_score: 0.7, is_critical: false, was_truncated: false },
 * ];
 * const result = packNodes(candidates, 1000, ['n_1']);
 * // => { nodes: [n_1, n_2, n_3], used_tokens: 1200, truncated_count: 0, excluded_count: 0 }
 * // All fit within budget, critical node included first
 */
export function packNodes(
  candidates: PrioritizedNode[],
  budgetTokens: number,
  criticalNodeIds?: string[]
): PackedContext {
  const included: PrioritizedNode[] = [];
  let usedTokens = 0;
  let truncatedCount = 0;
  let excludedCount = 0;

  // Step 1: Include critical nodes first (if they fit)
  const criticalSet = new Set(criticalNodeIds ?? []);
  const criticalNodes = candidates.filter((n) => criticalSet.has(n.node_id));
  const nonCriticalNodes = candidates.filter((n) => !criticalSet.has(n.node_id));

  for (const node of criticalNodes) {
    if (usedTokens + node.tokens <= budgetTokens) {
      included.push(node);
      usedTokens += node.tokens;
      if (node.was_truncated) {
        truncatedCount++;
      }
    } else {
      excludedCount++;
    }
  }

  // Step 2: Sort remaining by priority_score descending
  const sortedNonCritical = [...nonCriticalNodes].sort(
    (a, b) => b.priority_score - a.priority_score
  );

  // Step 3: Greedy packing
  for (const node of sortedNonCritical) {
    if (usedTokens + node.tokens <= budgetTokens) {
      included.push(node);
      usedTokens += node.tokens;
      if (node.was_truncated) {
        truncatedCount++;
      }
    } else {
      excludedCount++;
    }
  }

  return {
    nodes: included,
    used_tokens: usedTokens,
    budget_tokens: budgetTokens,
    truncated_count: truncatedCount,
    excluded_count: excludedCount,
  };
}

// ============================================================
// TRUNCATION
// ============================================================

/**
 * Selects the appropriate truncation tier based on node size and available options.
 *
 * Decision logic:
 * 1. If node has a summary → 'use_summary' (0ms, cheapest)
 * 2. If node <= 2x target → 'semantic_truncation' (10ms, fast)
 * 3. If node > 2x target → 'extract_relevant' (80ms, query-aware)
 * 4. Fallback → 'hard_truncation' (1ms, always works)
 *
 * @param nodeTokens - Total tokens in the node content
 * @param targetTokens - Target token budget for this node
 * @param hasSummary - Whether the node has a pre-computed summary
 * @returns The recommended truncation tier
 *
 * @example
 * // Node with summary - always prefer summary
 * selectTruncationTier(5000, 1000, true); // → 'use_summary'
 *
 * // Node 1.5x target size - semantic truncation is sufficient
 * selectTruncationTier(3000, 2000, false); // → 'semantic_truncation'
 *
 * // Node 3x target size - extract relevant sections
 * selectTruncationTier(6000, 2000, false); // → 'extract_relevant'
 */
export function selectTruncationTier(
  nodeTokens: number,
  targetTokens: number,
  hasSummary: boolean
): TruncationTier {
  // Tier 1: Use summary if available
  if (hasSummary) {
    return 'use_summary';
  }

  // Tier 2: Semantic truncation if node is <= 2x target
  if (nodeTokens <= targetTokens * 2) {
    return 'semantic_truncation';
  }

  // Tier 3: Extract relevant if node is > 2x target
  if (nodeTokens > targetTokens * 2) {
    return 'extract_relevant';
  }

  // Tier 4: Hard truncation as fallback
  return 'hard_truncation';
}

/**
 * Performs semantic truncation by keeping the first 60% and last 20% of content.
 *
 * This preserves introduction/context (beginning) and conclusions (end)
 * while removing the middle section. A ' [...] ' marker is inserted
 * between the two sections.
 *
 * Uses token estimation (estimateTokens) to determine split points.
 * Text shorter than target is returned as-is.
 *
 * @param text - The text to truncate
 * @param targetTokens - Target token count
 * @returns Truncated text with [...] separator
 *
 * @example
 * const original = "Introduction to ML. Neural networks are... [3000 tokens total] ...in conclusion, backprop is essential.";
 * const truncated = semanticTruncate(original, 1200);
 * // Result:
 * // "Introduction to ML. Neural networks are... [first 60%] [...] ...in conclusion, backprop is essential. [last 20%]"
 * // Total: ~1200 tokens
 */
export function semanticTruncate(text: string, targetTokens: number): string {
  if (text.length === 0) {
    return text;
  }

  const currentTokens = estimateTokens(text);
  if (currentTokens <= targetTokens) {
    return text;
  }

  // Calculate target characters
  const targetChars = targetTokens * TOKEN_ESTIMATE_CHARS_PER_TOKEN;
  const firstPartChars = Math.floor(targetChars * SEMANTIC_TRUNCATION_KEEP_START);
  const lastPartChars = Math.floor(targetChars * SEMANTIC_TRUNCATION_KEEP_END);

  const firstPart = text.slice(0, firstPartChars);
  const lastPart = text.slice(-lastPartChars);

  return firstPart + ' [...] ' + lastPart;
}

/**
 * Performs hard truncation at the nearest sentence boundary to the target.
 *
 * Finds the sentence boundary (. ! ?) closest to targetTokens and
 * truncates there. Adds ' [truncated]' suffix to indicate content was cut.
 *
 * If the text is shorter than the target, returns it as-is without the
 * [truncated] marker.
 *
 * This is the fastest fallback method (1ms latency) and always succeeds.
 *
 * @param text - The text to truncate
 * @param targetTokens - Target token count
 * @returns Truncated text with [truncated] suffix
 *
 * @example
 * const original = "First sentence. Second sentence. Third sentence. Fourth sentence.";
 * const truncated = hardTruncate(original, 15); // Assume ~15 tokens ≈ 2 sentences
 * // Result: "First sentence. Second sentence. [truncated]"
 *
 * // Text already fits
 * const short = "Just one sentence.";
 * hardTruncate(short, 100); // → "Just one sentence." (no [truncated] marker)
 */
export function hardTruncate(text: string, targetTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= targetTokens) {
    return text;
  }

  // Calculate target character position
  const targetChars = Math.floor(targetTokens * TOKEN_ESTIMATE_CHARS_PER_TOKEN);

  // Find last sentence boundary before target
  const searchText = text.slice(0, targetChars);
  const sentenceBoundaries = [
    searchText.lastIndexOf('. '),
    searchText.lastIndexOf('! '),
    searchText.lastIndexOf('? '),
  ];

  const lastBoundary = Math.max(...sentenceBoundaries);

  if (lastBoundary > 0) {
    // Include the punctuation mark
    return text.slice(0, lastBoundary + 1) + ' [truncated]';
  }

  // No sentence boundary found, just cut at target
  return text.slice(0, targetChars) + ' [truncated]';
}

// ============================================================
// CONTEXT PLACEMENT
// ============================================================

/**
 * Reorders nodes to maximize LLM attention on most relevant content.
 *
 * Implements the Lost-in-the-Middle attention fix by placing:
 * - Most relevant node → last position (highest recency attention)
 * - 2nd most relevant node → first position (high primacy attention)
 * - Remaining nodes → middle positions (buried, lower attention)
 *
 * Special cases:
 * - 0 nodes: Returns empty array
 * - 1 node: Returns as-is (single node gets high attention regardless)
 * - 2 nodes: [2nd, 1st] → both get high attention
 * - 3+ nodes: [2nd, 3rd, 4th, ..., 1st]
 *
 * Does NOT mutate input array — returns a new array.
 *
 * @param nodes - Nodes sorted by priority_score descending (highest priority first)
 * @returns New array with nodes reordered for optimal attention
 *
 * @example
 * // Input: 5 nodes sorted by priority (highest first)
 * const sorted = [
 *   { node_id: 'n_1', priority_score: 0.92, ... }, // Most relevant
 *   { node_id: 'n_2', priority_score: 0.85, ... }, // 2nd most
 *   { node_id: 'n_3', priority_score: 0.78, ... }, // 3rd
 *   { node_id: 'n_4', priority_score: 0.71, ... }, // 4th
 *   { node_id: 'n_5', priority_score: 0.65, ... }, // 5th (least)
 * ];
 *
 * const reordered = reorderForAttention(sorted);
 * // Output: [n_2, n_3, n_4, n_5, n_1]
 * //          ^^^^                ^^^^
 * //        primacy             recency
 * //                ^^^^^^^^^^^^^
 * //                buried zone
 */
export function reorderForAttention(nodes: PrioritizedNode[]): PrioritizedNode[] {
  // Handle edge cases
  if (nodes.length === 0 || nodes.length === 1) {
    return [...nodes]; // Return copy
  }

  // Extract first (most relevant) and second (2nd most relevant)
  const mostRelevant = nodes[0];
  const secondMostRelevant = nodes[1];

  if (!mostRelevant || !secondMostRelevant) {
    return [...nodes];
  }

  // Rest of nodes (lower relevance)
  const rest = nodes.slice(2);

  // Return: [2nd most, ...rest, most relevant]
  return [secondMostRelevant, ...rest, mostRelevant];
}

// ============================================================
// CONVERSATION HISTORY
// ============================================================

/**
 * Manages conversation history for a request.
 *
 * Determines what to include in context:
 * - Existing summary (if any)
 * - Recent N messages (verbatim)
 * - Whether summarization is needed (for background processing)
 *
 * Does NOT perform actual summarization (that's I/O - deferred to service layer).
 * Just calculates state and sets flags.
 *
 * @param messages - All messages in conversation history
 * @param tokenCounts - Token count for each message (parallel array)
 * @param config - History management configuration (optional)
 * @returns Managed history with summary, recent messages, and metadata
 *
 * @example
 * // 3-turn conversation - no summarization needed
 * const messages = [
 *   'User: Hello',
 *   'Assistant: Hi!',
 *   'User: What is SSA?',
 *   'Assistant: Spreading activation algorithm...',
 *   'User: How does it work?',
 *   'Assistant: It starts with vector seeding...',
 * ];
 * const counts = [50, 30, 80, 250, 90, 300];
 *
 * const result = manageConversationHistory(messages, counts);
 * // => {
 * //   summary: undefined,
 * //   recent_messages: [...all 6 messages],
 * //   total_tokens: 800,
 * //   needs_summarization: false,
 * //   turn_count: 6,
 * // }
 */
export function manageConversationHistory(
  messages: string[],
  tokenCounts: number[],
  config?: ConversationHistoryConfig
): ManagedHistory {
  const cfg = config ?? DEFAULT_CONTEXT_WINDOW_CONFIG.conversation;

  // Calculate total tokens and turn count
  const totalTokens = tokenCounts.reduce((sum, count) => sum + count, 0);
  const turnCount = messages.length;

  // Check if summarization is needed
  const needsSummarization =
    turnCount > cfg.summarization.turn_trigger ||
    totalTokens > cfg.summarization.token_trigger;

  // Get recent messages (last N turns)
  const recentMessages = messages.slice(-cfg.recent_window.max_turns);

  return {
    summary: undefined, // Summary would be passed in from previous summarization
    recent_messages: recentMessages,
    total_tokens: totalTokens,
    needs_summarization: needsSummarization,
    turn_count: turnCount,
  };
}

// ============================================================
// TOKEN ESTIMATION
// ============================================================

/**
 * Estimates token count for text using conservative character-based heuristic.
 *
 * Formula: Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN)
 * where TOKEN_ESTIMATE_CHARS_PER_TOKEN = 3.5 (conservative estimate)
 *
 * This is a fallback when model-specific tokenizers (tiktoken, claude)
 * are not available. It over-estimates slightly to be safe.
 *
 * @param text - The text to estimate
 * @returns Estimated token count
 *
 * @example
 * estimateTokens('');
 * // => 0
 *
 * estimateTokens('hello');
 * // => 2 (5 chars / 3.5 = 1.43, ceil = 2)
 *
 * estimateTokens('This is a longer sentence with more tokens.');
 * // => 13 (44 chars / 3.5 = 12.57, ceil = 13)
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN);
}

// ============================================================
// CHUNK UTILITIES
// ============================================================

/**
 * Determines if content should be chunked based on token count.
 *
 * Returns true if tokenCount exceeds the chunking_trigger threshold
 * (default: 2000 tokens). Content below this threshold is kept as a
 * single node.
 *
 * @param tokenCount - Total token count of content
 * @param config - Optional chunking configuration (uses defaults if omitted)
 * @returns True if content should be chunked
 *
 * @example
 * shouldChunk(1000);  // => false (below trigger)
 * shouldChunk(2001);  // => true (exceeds trigger)
 */
export function shouldChunk(tokenCount: number, config?: ChunkingConfig): boolean {
  const cfg = config ?? DEFAULT_CONTEXT_WINDOW_CONFIG.chunking;
  return tokenCount > cfg.chunking_trigger;
}

/**
 * Calculates the number of chunks needed for total token count.
 *
 * Uses the midpoint of target_min and target_max as the target chunk size.
 * Returns Math.ceil(totalTokens / target) to ensure all content is covered.
 *
 * @param totalTokens - Total token count of content to chunk
 * @param config - Optional chunking configuration (uses defaults if omitted)
 * @returns Number of chunks needed
 *
 * @example
 * calculateChunkCount(2000);  // => 2 (2000 / 1000 = 2)
 * calculateChunkCount(2500);  // => 3 (2500 / 1000 = 2.5, ceil = 3)
 */
export function calculateChunkCount(totalTokens: number, config?: ChunkingConfig): number {
  const cfg = config ?? DEFAULT_CONTEXT_WINDOW_CONFIG.chunking;
  const target = (cfg.target_min + cfg.target_max) / 2;
  return Math.max(1, Math.ceil(totalTokens / target));
}

/**
 * Factory function for creating ChunkFields.
 *
 * Creates chunk metadata with position information, navigation links, and
 * overlap tracking. First chunk has no previous_chunk_id, last chunk has
 * no next_chunk_id.
 *
 * @param parentId - Parent document/section node ID
 * @param index - 0-based chunk index
 * @param totalChunks - Total number of chunks
 * @param level - Chunk hierarchy level
 * @param overlapTokens - Number of overlap tokens
 * @returns ChunkFields object
 *
 * @example
 * // First chunk (index 0)
 * createChunkFields('n_parent', 0, 3, 'section', 100);
 * // => { is_chunk: true, parent_id: 'n_parent', chunk_index: 0,
 * //      total_chunks: 3, level: 'section', next_chunk_id: 'n_parent_chunk_1',
 * //      overlap_tokens: 100, ... }
 *
 * // Middle chunk (index 1)
 * createChunkFields('n_parent', 1, 3, 'section', 100);
 * // => { ..., previous_chunk_id: 'n_parent_chunk_0', next_chunk_id: 'n_parent_chunk_2', ... }
 *
 * // Last chunk (index 2)
 * createChunkFields('n_parent', 2, 3, 'section', 100);
 * // => { ..., previous_chunk_id: 'n_parent_chunk_1', ... } (no next_chunk_id)
 */
export function createChunkFields(
  parentId: string,
  index: number,
  totalChunks: number,
  level: ChunkLevel,
  overlapTokens: number
): ChunkFields {
  return {
    is_chunk: true,
    parent_id: parentId,
    chunk_index: index,
    total_chunks: totalChunks,
    level,
    previous_chunk_id: index > 0 ? `${parentId}_chunk_${index - 1}` : undefined,
    next_chunk_id: index < totalChunks - 1 ? `${parentId}_chunk_${index + 1}` : undefined,
    overlap_tokens: overlapTokens,
    overlap_hash: '', // Empty — computed by caller
  };
}

/**
 * Factory function for creating ParentFields.
 *
 * Creates parent document metadata from chunk IDs and document info.
 * Sets total_chunks from childIds.length.
 *
 * @param childIds - Ordered array of child chunk node IDs
 * @param totalTokens - Total token count of full document
 * @param documentType - Classification of document type
 * @returns ParentFields object
 *
 * @example
 * createParentFields(
 *   ['n_chunk0', 'n_chunk1', 'n_chunk2'],
 *   4500,
 *   'manual_note'
 * );
 * // => { is_parent: true, child_ids: [...], total_tokens: 4500,
 * //      total_chunks: 3, document_type: 'manual_note' }
 */
export function createParentFields(
  childIds: string[],
  totalTokens: number,
  documentType: string
): ParentFields {
  return {
    is_parent: true,
    child_ids: childIds,
    total_tokens: totalTokens,
    total_chunks: childIds.length,
    document_type: documentType,
  };
}

/**
 * Determines if chunks should be expanded with adjacent chunks.
 *
 * Returns true if expansion is enabled and at least one chunk matched.
 * Expansion includes adjacent chunks (before/after) for context.
 *
 * @param matchedChunkCount - Number of chunks that matched retrieval
 * @param config - Optional retrieval configuration (uses defaults if omitted)
 * @returns True if chunks should be expanded
 *
 * @example
 * shouldExpandChunks(0);  // => false (no chunks matched)
 * shouldExpandChunks(1);  // => true (at least one chunk matched)
 * shouldExpandChunks(3);  // => true (multiple chunks matched)
 */
export function shouldExpandChunks(
  matchedChunkCount: number,
  config?: ChunkRetrievalConfig
): boolean {
  const cfg = config ?? DEFAULT_CONTEXT_WINDOW_CONFIG.chunk_retrieval;
  return cfg.expansion.enabled && matchedChunkCount >= 1;
}

/**
 * Determines aggregation strategy when multiple chunks from same document match.
 *
 * Returns:
 * - 'none': less than same_doc_threshold (default: 2)
 * - 'merge': >= same_doc_threshold but < high_count_threshold (default: 4)
 * - 'summarize': >= high_count_threshold
 *
 * @param sameDocChunkCount - Number of chunks from same document
 * @param config - Optional retrieval configuration (uses defaults if omitted)
 * @returns Aggregation action: 'none' | 'merge' | 'summarize'
 *
 * @example
 * shouldAggregateChunks(1);  // => 'none' (below threshold)
 * shouldAggregateChunks(2);  // => 'merge' (at threshold)
 * shouldAggregateChunks(3);  // => 'merge' (between thresholds)
 * shouldAggregateChunks(4);  // => 'summarize' (high count)
 * shouldAggregateChunks(5);  // => 'summarize' (above high count)
 */
export function shouldAggregateChunks(
  sameDocChunkCount: number,
  config?: ChunkRetrievalConfig
): 'none' | 'merge' | 'summarize' {
  const cfg = config ?? DEFAULT_CONTEXT_WINDOW_CONFIG.chunk_retrieval;

  if (sameDocChunkCount < cfg.aggregation.same_doc_threshold) {
    return 'none';
  }

  if (sameDocChunkCount >= cfg.aggregation.high_count_threshold) {
    return 'summarize';
  }

  return 'merge';
}

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Returns the default context window configuration.
 *
 * @returns DEFAULT_CONTEXT_WINDOW_CONFIG
 *
 * @example
 * const config = getDefaultContextWindowConfig();
 * // => {
 * //   _schemaVersion: 1,
 * //   fixed_allocations: { system_prompt: 3000, min_user_message: 2000 },
 * //   priority_weights: { retrieval_score: 0.40, ... },
 * //   chunking: { chunking_trigger: 2000, ... },
 * //   conversation: { recent_window: { max_turns: 6, ... }, ... },
 * //   chunk_retrieval: { expansion: { ... }, aggregation: { ... } },
 * // }
 */
export function getDefaultContextWindowConfig(): ContextWindowConfig {
  return DEFAULT_CONTEXT_WINDOW_CONFIG;
}

/**
 * Returns the default chunk retrieval configuration.
 *
 * Provides default values for expansion and aggregation behavior.
 * All values match constants defined in constants.ts.
 *
 * @returns Default ChunkRetrievalConfig
 *
 * @example
 * const config = getDefaultChunkRetrievalConfig();
 * // => { expansion: { enabled: true, max_expansion_tokens: 1500, ... },
 * //      aggregation: { same_doc_threshold: 2, ... } }
 */
export function getDefaultChunkRetrievalConfig(): ChunkRetrievalConfig {
  return DEFAULT_CONTEXT_WINDOW_CONFIG.chunk_retrieval;
}
