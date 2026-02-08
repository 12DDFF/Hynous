/**
 * @module @nous/core/adaptive-limits
 * @description Adaptive Budget System (ABS) - orchestration layer for storm-012
 * @version 1.0.0
 * @spec Specs/Phase-8-Scaling-Limits/storm-012
 * @storm Brainstorms/Infrastructure/storm-012-adaptive-limits
 *
 * Core principle: "Spend budget until quality target met, bounded by hard limits,
 * with graceful degradation."
 *
 * This module composes storm-028's foundational functions (calculateAdaptiveLimits,
 * getBudgetForOperation, getQualityTargetForQueryType) into an orchestration layer
 * with thoroughness control, graceful degradation, serendipity scaling, evolution
 * threshold integration, query type bridging, and user transparency.
 *
 * Dependencies:
 * - storm-028 (params): Foundation types + functions
 * - storm-005 (ssa): SerendipityLevel, SERENDIPITY_THRESHOLDS
 * - storm-006 (clusters): calculateEmergeThreshold, calculateSplitThreshold, EvolutionLearning
 * - storm-003 (retrieval): QueryType (type-only, NOT in root barrel)
 */

// Re-export constants
export {
  THOROUGHNESS_LEVELS,
  type ThoroughnessLevel,
  ThoroughnessLevelSchema,
  isThoroughnessLevel,
  THOROUGHNESS_MULTIPLIERS,
  ThoroughnessMultipliersSchema,
  DEFAULT_THOROUGHNESS,
  BUDGET_MODES,
  type BudgetMode,
  BudgetModeSchema,
  isBudgetMode,
  BUDGET_EXHAUSTION_REASONS,
  type BudgetExhaustionReason,
  BudgetExhaustionReasonSchema,
  isBudgetExhaustionReason,
  SERENDIPITY_MIN_CANDIDATES,
  SERENDIPITY_PERCENTILE,
  SERENDIPITY_MAX_CANDIDATES,
  ABS_SCHEMA_VERSION,
  QUERY_TYPE_TO_QUALITY_KEY,
  QUERY_TYPE_TO_OPERATION_KEY,
  QUALITY_KEY_TO_PARAMS_QUERY_TYPE,
} from './constants';

// Re-export types
export {
  type AdaptiveBudgetRequest,
  AdaptiveBudgetRequestSchema,
  type BudgetExplanation,
  BudgetExplanationSchema,
  type AdaptiveBudgetResult,
  AdaptiveBudgetResultSchema,
  type BudgetExhaustionResult,
  BudgetExhaustionResultSchema,
  type ScaledSerendipityConfig,
  ScaledSerendipityConfigSchema,
  type AdaptiveEvolutionThresholds,
  AdaptiveEvolutionThresholdsSchema,
  type ABSConfig,
  ABSConfigSchema,
  DEFAULT_ABS_CONFIG,
  isAdaptiveBudgetRequest,
  isAdaptiveBudgetResult,
  isBudgetExhaustionResult,
  isABSConfig,
} from './types';

// ============================================================
// IMPORTS FROM DEPENDENCIES
// ============================================================

import {
  type BudgetConfig,
  type QueryType as ParamsQueryType,
  COLD_START_THRESHOLD,
  calculateAdaptiveLimits,
  getBudgetForOperation,
  getQualityTargetForQueryType,
} from '../params';

import {
  type SerendipityLevel,
  SERENDIPITY_THRESHOLDS,
} from '../ssa';

import {
  calculateEmergeThreshold,
  calculateSplitThreshold,
  type EvolutionLearning,
} from '../clusters';

// Internal imports
import {
  type ThoroughnessLevel,
  THOROUGHNESS_MULTIPLIERS,
  DEFAULT_THOROUGHNESS,
  type BudgetExhaustionReason,
  SERENDIPITY_MIN_CANDIDATES,
  SERENDIPITY_PERCENTILE,
  SERENDIPITY_MAX_CANDIDATES,
  ABS_SCHEMA_VERSION,
  QUERY_TYPE_TO_QUALITY_KEY,
  QUERY_TYPE_TO_OPERATION_KEY,
  QUALITY_KEY_TO_PARAMS_QUERY_TYPE,
} from './constants';

import type {
  AdaptiveBudgetRequest,
  AdaptiveBudgetResult,
  BudgetExhaustionResult,
  BudgetExplanation,
  AdaptiveEvolutionThresholds,
} from './types';

// ============================================================
// QUERY TYPE MAPPING
// ============================================================

/**
 * Map storm-003 retrieval QueryType to storm-028 QUALITY_TARGETS key.
 *
 * Mapping:
 * - factual -> LOOKUP
 * - list -> REASONING
 * - exploratory -> EXPLORATORY
 * - temporal -> TEMPORAL
 * - procedural -> REASONING
 * - unknown -> REASONING (safe default)
 */
export function mapRetrievalQueryType(retrievalQueryType: string): string {
  return QUERY_TYPE_TO_QUALITY_KEY[retrievalQueryType] ?? 'REASONING';
}

/**
 * Map storm-003 retrieval QueryType to storm-028 OPERATION_BUDGETS key.
 *
 * If isPhase2 is true, always returns 'phase2_reasoning'.
 *
 * Phase 1 mapping:
 * - factual -> 'simple_lookup'
 * - list -> 'standard_query'
 * - exploratory -> 'complex_query'
 * - temporal -> 'standard_query'
 * - procedural -> 'complex_query'
 * - unknown -> 'standard_query' (safe default)
 */
export function mapToOperationBudgetKey(
  retrievalQueryType: string,
  isPhase2: boolean
): string {
  if (isPhase2) return 'phase2_reasoning';
  return QUERY_TYPE_TO_OPERATION_KEY[retrievalQueryType] ?? 'standard_query';
}

/**
 * Map storm-028 QUALITY_TARGETS key to storm-028 QueryType (params).
 *
 * Used internally by calculateAdaptiveBudget to call storm-028's
 * calculateAdaptiveLimits, which expects 'simple' | 'standard' | 'complex'.
 *
 * Mapping:
 * - LOOKUP -> 'simple'
 * - REASONING -> 'standard'
 * - EXPLORATORY -> 'complex'
 * - TEMPORAL -> 'standard'
 * - unknown -> 'standard' (safe default)
 */
export function mapToParamsQueryType(
  qualityTargetKey: string
): ParamsQueryType {
  const mapped = QUALITY_KEY_TO_PARAMS_QUERY_TYPE[qualityTargetKey];
  return (mapped as ParamsQueryType | undefined) ?? 'standard';
}

// ============================================================
// BUDGET ORCHESTRATION
// ============================================================

/**
 * Apply thoroughness multiplier to a budget.
 *
 * Multiplies time_ms and max_nodes by the thoroughness multiplier.
 * Leaves max_api_calls unchanged (API calls are binary decisions).
 * Returns a new BudgetConfig -- does NOT mutate the input.
 *
 * @param budget - Base budget to modify. From storm-028 BudgetConfig.
 * @param thoroughness - Thoroughness level to apply.
 * @returns New BudgetConfig with multiplied values.
 */
export function applyThoroughness(
  budget: BudgetConfig,
  thoroughness: ThoroughnessLevel
): BudgetConfig {
  const multiplier = THOROUGHNESS_MULTIPLIERS[thoroughness];
  return {
    time_ms: Math.round(budget.time_ms * multiplier),
    max_nodes: Math.round(budget.max_nodes * multiplier),
    max_api_calls: budget.max_api_calls,
  };
}

/**
 * Build a user-facing explanation of the budget calculation.
 */
function buildExplanation(
  limits: { entry_points: number; max_hops: number; max_nodes: number },
  budget: BudgetConfig,
  graphSize: number,
  graphDensity: number,
  isColdStart: boolean
): BudgetExplanation {
  if (isColdStart) {
    return {
      mode: 'cold_start',
      entry_points_reason: `${limits.entry_points} entry points (cold-start mode)`,
      hops_reason: `${limits.max_hops} hops (cold-start mode)`,
      node_limit_reason: `${limits.max_nodes} nodes (cold-start, ${graphSize} total)`,
      time_limit_reason: `${budget.time_ms}ms (budget with thoroughness)`,
    };
  }

  let densityLabel: string;
  if (graphDensity < 0.001) densityLabel = 'very sparse';
  else if (graphDensity < 0.01) densityLabel = 'sparse';
  else if (graphDensity < 0.05) densityLabel = 'medium density';
  else densityLabel = 'dense';

  return {
    mode: 'adaptive',
    entry_points_reason: `${limits.entry_points} entry points (log10 of ${graphSize.toLocaleString()} nodes)`,
    hops_reason: `${limits.max_hops} hops (${densityLabel} graph, density ${graphDensity})`,
    node_limit_reason: `${limits.max_nodes} nodes of ${graphSize.toLocaleString()} total`,
    time_limit_reason: `${budget.time_ms}ms (budget with thoroughness)`,
  };
}

/**
 * Main ABS orchestrator. Calculates adaptive budget, limits, and quality target.
 *
 * Steps:
 * 1. Determine thoroughness (default: balanced)
 * 2. Map query_type to operation budget key
 * 3. Get base budget from storm-028 getBudgetForOperation
 * 4. Apply thoroughness multiplier
 * 5. Map query_type to storm-028 QueryType for adaptive limits
 * 6. Calculate graph-aware limits from storm-028 calculateAdaptiveLimits
 * 7. Get quality target from storm-028 getQualityTargetForQueryType
 * 8. Build user-facing explanation
 * 9. Return AdaptiveBudgetResult
 */
export function calculateAdaptiveBudget(
  request: AdaptiveBudgetRequest
): AdaptiveBudgetResult {
  const thoroughness = request.thoroughness ?? DEFAULT_THOROUGHNESS;
  const operationKey = request.operation ?? mapToOperationBudgetKey(request.query_type, false);
  const baseBudget = getBudgetForOperation(operationKey);
  const budget = applyThoroughness(baseBudget, thoroughness);

  const paramsQT = mapToParamsQueryType(request.query_type);
  const limits = calculateAdaptiveLimits(
    request.graph_metrics.total_nodes,
    request.graph_metrics.density,
    paramsQT
  );

  const qualityTarget = getQualityTargetForQueryType(request.query_type);
  const isColdStart = request.graph_metrics.total_nodes < COLD_START_THRESHOLD;

  const explanation = buildExplanation(
    limits,
    budget,
    request.graph_metrics.total_nodes,
    request.graph_metrics.density,
    isColdStart
  );

  return {
    _schemaVersion: ABS_SCHEMA_VERSION,
    budget,
    limits,
    quality_target: qualityTarget,
    thoroughness_applied: thoroughness,
    is_cold_start: isColdStart,
    explanation,
  };
}

/**
 * Handle budget exhaustion with graceful degradation.
 *
 * Called when shouldTerminate (storm-028) returns a budget-exhaustion reason
 * but quality target was not met. Returns a result with human-readable
 * explanation and actionable suggestion.
 *
 * From brainstorm revision.md Part 7: "Graceful Degradation."
 */
export function handleBudgetExhaustion(
  reason: BudgetExhaustionReason,
  qualityAchieved: number,
  qualityTarget: number,
  coverageAchieved: number
): BudgetExhaustionResult {
  const achievedPct = Math.round(qualityAchieved * 100);
  const targetPct = Math.round(qualityTarget * 100);

  let explanation: string;
  let suggestion: string;

  switch (reason) {
    case 'time_exhausted':
      explanation = `Reached time limit with ${achievedPct}% confidence (target: ${targetPct}%)`;
      suggestion = 'Try "Search deeper" to explore more';
      break;
    case 'node_limit_reached':
      explanation = `Searched maximum nodes with ${achievedPct}% confidence (target: ${targetPct}%)`;
      suggestion = 'Try being more specific or use "Search deeper"';
      break;
    case 'api_calls_exhausted':
      explanation = `Used all API calls with ${achievedPct}% confidence (target: ${targetPct}%)`;
      suggestion = 'Try a simpler query or increase thoroughness';
      break;
  }

  return {
    exhausted_resource: reason,
    quality_achieved: qualityAchieved,
    quality_target: qualityTarget,
    coverage_achieved: coverageAchieved,
    partial: true,
    explanation,
    suggestion,
  };
}

// ============================================================
// SERENDIPITY
// ============================================================

/**
 * Calculate graph-size-aware serendipity candidate count.
 *
 * Combines storm-005's fixed per-level counts with graph-size scaling.
 * - level 'off': returns 0
 * - Small graphs: always at least SERENDIPITY_MIN_CANDIDATES (3)
 * - Large graphs: capped by the level's count from SERENDIPITY_THRESHOLDS
 *
 * From brainstorm revision.md Part 5: "Hybrid Percentile + Minimum."
 */
export function scaleSerendipity(
  graphSize: number,
  level: SerendipityLevel
): number {
  if (level === 'off') return 0;

  const thresholds = SERENDIPITY_THRESHOLDS[level];
  const levelCount = thresholds.count;
  const scaledCount = Math.floor(graphSize * SERENDIPITY_PERCENTILE);

  return Math.max(
    SERENDIPITY_MIN_CANDIDATES,
    Math.min(levelCount, scaledCount, SERENDIPITY_MAX_CANDIDATES)
  );
}

// ============================================================
// EVOLUTION
// ============================================================

/**
 * Get adaptive evolution thresholds for a graph size.
 *
 * Wraps storm-006's calculateEmergeThreshold and calculateSplitThreshold
 * with graph-size-aware serendipity scaling.
 *
 * From brainstorm revision.md Part 6: "Cluster Evolution (Self-Tuning)."
 */
export function getAdaptiveEvolutionThresholds(
  graphSize: number,
  learning?: EvolutionLearning
): AdaptiveEvolutionThresholds {
  const emergeThreshold = calculateEmergeThreshold(graphSize, undefined, learning);
  const splitThreshold = calculateSplitThreshold(graphSize, undefined, learning);
  const serendipityCandidates = scaleSerendipity(graphSize, 'medium');
  const isColdStart = graphSize < COLD_START_THRESHOLD;

  return {
    emerge_threshold: emergeThreshold,
    split_threshold: splitThreshold,
    serendipity_candidates: serendipityCandidates,
    is_cold_start: isColdStart,
  };
}

// ============================================================
// USER TRANSPARENCY
// ============================================================

/**
 * Generate human-readable explanation of a budget result.
 *
 * From brainstorm revision.md Part 7: "User-Facing Transparency."
 */
export function explainBudget(result: AdaptiveBudgetResult): string {
  if (result.is_cold_start) {
    return `Using fixed limits for small graph. Searching up to ${result.limits.max_nodes} nodes.`;
  }

  const confidencePct = Math.round(result.quality_target.confidence * 100);
  return `Searching up to ${result.limits.max_nodes} nodes across ${result.limits.entry_points} entry points (${confidencePct}% confidence target).`;
}
