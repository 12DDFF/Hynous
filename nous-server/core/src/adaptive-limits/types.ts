/**
 * @module @nous/core/adaptive-limits
 * @description Type definitions for the Adaptive Budget System (ABS)
 * @version 1.0.0
 * @spec Specs/Phase-8-Scaling-Limits/storm-012
 * @storm Brainstorms/Infrastructure/storm-012-adaptive-limits
 *
 * Defines all interfaces and Zod schemas for the ABS orchestration layer.
 * Uses types from storm-028 (GraphMetrics, BudgetConfig, QualityTarget,
 * AdaptiveLimits) as building blocks.
 */

import { z } from 'zod';
import {
  type ThoroughnessLevel,
  ThoroughnessLevelSchema,
  type BudgetMode,
  BudgetModeSchema,
  BudgetExhaustionReasonSchema,
  type BudgetExhaustionReason,
  ABS_SCHEMA_VERSION,
  THOROUGHNESS_MULTIPLIERS,
  SERENDIPITY_MIN_CANDIDATES,
  SERENDIPITY_PERCENTILE,
  SERENDIPITY_MAX_CANDIDATES,
} from './constants';
import { GraphMetricsSchema } from '../params';

// ============================================================
// REQUEST TYPES
// ============================================================

/**
 * Input to the Adaptive Budget System orchestrator.
 *
 * @example
 * ```typescript
 * const request: AdaptiveBudgetRequest = {
 *   graph_metrics: { total_nodes: 5000, total_edges: 20000, density: 0.0016, avg_inbound_edges: 4, avg_outbound_edges: 4 },
 *   query_type: 'REASONING',
 *   thoroughness: 'balanced',
 * };
 * ```
 */
export interface AdaptiveBudgetRequest {
  /** Graph metrics for adaptive scaling. From storm-028 GraphMetrics. */
  graph_metrics: {
    total_nodes: number;
    total_edges: number;
    density: number;
    avg_inbound_edges: number;
    avg_outbound_edges: number;
  };

  /** QUALITY_TARGETS key: 'LOOKUP' | 'REASONING' | 'EXPLORATORY' | 'TEMPORAL' */
  query_type: string;

  /** User-facing thoroughness. Defaults to 'balanced' if omitted. */
  thoroughness?: ThoroughnessLevel;

  /** OPERATION_BUDGETS key override. If omitted, mapped from query_type. */
  operation?: string;
}

export const AdaptiveBudgetRequestSchema = z.object({
  graph_metrics: GraphMetricsSchema,
  query_type: z.string(),
  thoroughness: ThoroughnessLevelSchema.optional(),
  operation: z.string().optional(),
});

// ============================================================
// EXPLANATION TYPES
// ============================================================

/**
 * User-facing explanation of how the budget was calculated.
 * Addresses brainstorm critique Issue 5: "Natural feel not addressed."
 *
 * @example
 * ```typescript
 * const explanation: BudgetExplanation = {
 *   mode: 'adaptive',
 *   entry_points_reason: '4 entry points (log10 of 10,000 nodes)',
 *   hops_reason: '4 hops (sparse graph, density 0.005)',
 *   node_limit_reason: '500 nodes (5% of 10,000 node graph)',
 *   time_limit_reason: '100ms (standard query budget)',
 * };
 * ```
 */
export interface BudgetExplanation {
  /** Operating mode that produced this budget. */
  mode: BudgetMode;

  /** Why this many entry points. */
  entry_points_reason: string;

  /** Why this many hops. */
  hops_reason: string;

  /** Why this node limit. */
  node_limit_reason: string;

  /** Why this time limit. */
  time_limit_reason: string;
}

export const BudgetExplanationSchema = z.object({
  mode: BudgetModeSchema,
  entry_points_reason: z.string(),
  hops_reason: z.string(),
  node_limit_reason: z.string(),
  time_limit_reason: z.string(),
});

// ============================================================
// RESULT TYPES
// ============================================================

/**
 * Main output of the ABS orchestrator.
 * Combines budget, limits, quality target, and explanation.
 *
 * This is a persisted type and includes _schemaVersion per Technical Audit.
 *
 * @example
 * ```typescript
 * const result: AdaptiveBudgetResult = {
 *   _schemaVersion: 1,
 *   budget: { time_ms: 100, max_nodes: 500, max_api_calls: 0 },
 *   limits: { entry_points: 4, max_hops: 4, max_nodes: 500 },
 *   quality_target: { confidence: 0.70, min_coverage: 0.70 },
 *   thoroughness_applied: 'balanced',
 *   is_cold_start: false,
 *   explanation: { mode: 'adaptive', ... },
 * };
 * ```
 */
export interface AdaptiveBudgetResult {
  /** Schema version for migration safety. Always ABS_SCHEMA_VERSION. */
  _schemaVersion: number;

  /** Budget with thoroughness applied. From storm-028 BudgetConfig. */
  budget: {
    time_ms: number;
    max_nodes: number;
    max_api_calls: number;
  };

  /** Graph-aware limits. From storm-028 AdaptiveLimits. */
  limits: {
    entry_points: number;
    max_hops: number;
    max_nodes: number;
  };

  /** Quality target for the query type. From storm-028 QualityTarget. */
  quality_target: {
    confidence: number;
    min_coverage: number;
  };

  /** Which thoroughness level was applied. */
  thoroughness_applied: ThoroughnessLevel;

  /** Whether the graph is in cold-start mode (<200 nodes). */
  is_cold_start: boolean;

  /** User-facing explanation of the budget calculation. */
  explanation: BudgetExplanation;
}

export const AdaptiveBudgetResultSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  budget: z.object({
    time_ms: z.number().nonnegative(),
    max_nodes: z.number().int().nonnegative(),
    max_api_calls: z.number().int().nonnegative(),
  }),
  limits: z.object({
    entry_points: z.number().int().positive(),
    max_hops: z.number().int().positive(),
    max_nodes: z.number().int().nonnegative(),
  }),
  quality_target: z.object({
    confidence: z.number().min(0).max(1),
    min_coverage: z.number().min(0).max(1),
  }),
  thoroughness_applied: ThoroughnessLevelSchema,
  is_cold_start: z.boolean(),
  explanation: BudgetExplanationSchema,
});

/**
 * Graceful degradation result when budget is exhausted before quality target met.
 * Addresses brainstorm critique Issue 8: "No fallback for budget exhaustion."
 *
 * From brainstorm revision.md Part 7:
 * "When budget exhausted but quality target not met, return partial results
 *  with warning, suggestion, confidence, and search coverage."
 *
 * @example
 * ```typescript
 * const exhaustion: BudgetExhaustionResult = {
 *   exhausted_resource: 'time_exhausted',
 *   quality_achieved: 0.58,
 *   quality_target: 0.70,
 *   coverage_achieved: 0.01,
 *   partial: true,
 *   explanation: 'Searched 500 nodes but only reached 58% confidence (target: 70%)',
 *   suggestion: 'Try "Search deeper" or be more specific',
 * };
 * ```
 */
export interface BudgetExhaustionResult {
  /** Which resource was exhausted. */
  exhausted_resource: BudgetExhaustionReason;

  /** Actual quality score achieved (0-1). */
  quality_achieved: number;

  /** Quality target that was not met (0-1). */
  quality_target: number;

  /** Coverage fraction achieved (0-1). */
  coverage_achieved: number;

  /** Always true when this result is returned. */
  partial: true;

  /** Human-readable explanation for the user. */
  explanation: string;

  /** Actionable suggestion for the user. */
  suggestion: string;
}

export const BudgetExhaustionResultSchema = z.object({
  exhausted_resource: BudgetExhaustionReasonSchema,
  quality_achieved: z.number().min(0).max(1),
  quality_target: z.number().min(0).max(1),
  coverage_achieved: z.number().min(0).max(1),
  partial: z.literal(true),
  explanation: z.string().min(1),
  suggestion: z.string().min(1),
});

// ============================================================
// SERENDIPITY TYPES
// ============================================================

/**
 * Configuration for graph-size-aware serendipity scaling.
 * From brainstorm revision.md Part 5: "Hybrid Percentile + Minimum."
 *
 * Small graphs: always at least min_candidates (3).
 * Large graphs: percentile-based, capped by max_candidates.
 */
export interface ScaledSerendipityConfig {
  /** Minimum serendipity candidates regardless of graph size. */
  min_candidates: number;

  /** Percentile threshold (fraction of graph size). */
  percentile_threshold: number;

  /** Upper bound on serendipity candidates. */
  max_candidates: number;
}

export const ScaledSerendipityConfigSchema = z.object({
  min_candidates: z.number().int().positive(),
  percentile_threshold: z.number().min(0).max(1),
  max_candidates: z.number().int().positive(),
});

// ============================================================
// EVOLUTION TYPES
// ============================================================

/**
 * Combined adaptive evolution thresholds.
 * Wraps storm-006's calculateEmergeThreshold and calculateSplitThreshold
 * with graph-size-aware serendipity scaling.
 *
 * From brainstorm revision.md Part 6: "Cluster Evolution (Self-Tuning)."
 */
export interface AdaptiveEvolutionThresholds {
  /** Node count that triggers cluster emergence. From storm-006. */
  emerge_threshold: number;

  /** Node count that triggers cluster splitting. From storm-006. */
  split_threshold: number;

  /** Number of serendipity candidates for this graph size. */
  serendipity_candidates: number;

  /** Whether the graph is in cold-start mode. */
  is_cold_start: boolean;
}

export const AdaptiveEvolutionThresholdsSchema = z.object({
  emerge_threshold: z.number().positive(),
  split_threshold: z.number().positive(),
  serendipity_candidates: z.number().int().nonnegative(),
  is_cold_start: z.boolean(),
});

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Master configuration for the Adaptive Budget System.
 * This is a persisted type and includes _schemaVersion per Technical Audit.
 */
export interface ABSConfig {
  /** Schema version for migration safety. */
  _schemaVersion: number;

  /** Budget multipliers per thoroughness level. */
  thoroughness_multipliers: Record<ThoroughnessLevel, number>;

  /** Serendipity scaling configuration. */
  serendipity: ScaledSerendipityConfig;

  /** Node count below which cold-start mode is used. */
  cold_start_threshold: number;
}

export const ABSConfigSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  thoroughness_multipliers: z.record(
    ThoroughnessLevelSchema,
    z.number().positive()
  ),
  serendipity: ScaledSerendipityConfigSchema,
  cold_start_threshold: z.number().int().positive(),
});

/**
 * Default ABS configuration.
 * Values align with storm-028 (cold_start_threshold = 200)
 * and brainstorm revision.md (thoroughness multipliers, serendipity).
 */
export const DEFAULT_ABS_CONFIG: ABSConfig = {
  _schemaVersion: ABS_SCHEMA_VERSION,
  thoroughness_multipliers: { ...THOROUGHNESS_MULTIPLIERS },
  serendipity: {
    min_candidates: SERENDIPITY_MIN_CANDIDATES,
    percentile_threshold: SERENDIPITY_PERCENTILE,
    max_candidates: SERENDIPITY_MAX_CANDIDATES,
  },
  cold_start_threshold: 200,
};

// ============================================================
// TYPE GUARDS
// ============================================================

/**
 * Type guard for AdaptiveBudgetRequest.
 */
export function isAdaptiveBudgetRequest(value: unknown): value is AdaptiveBudgetRequest {
  return AdaptiveBudgetRequestSchema.safeParse(value).success;
}

/**
 * Type guard for AdaptiveBudgetResult.
 */
export function isAdaptiveBudgetResult(value: unknown): value is AdaptiveBudgetResult {
  return AdaptiveBudgetResultSchema.safeParse(value).success;
}

/**
 * Type guard for BudgetExhaustionResult.
 */
export function isBudgetExhaustionResult(value: unknown): value is BudgetExhaustionResult {
  return BudgetExhaustionResultSchema.safeParse(value).success;
}

/**
 * Type guard for ABSConfig.
 */
export function isABSConfig(value: unknown): value is ABSConfig {
  return ABSConfigSchema.safeParse(value).success;
}
