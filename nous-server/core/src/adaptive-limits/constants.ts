/**
 * @module @nous/core/adaptive-limits
 * @description Constants for the Adaptive Budget System (ABS)
 * @version 1.0.0
 * @spec Specs/Phase-8-Scaling-Limits/storm-012
 * @storm Brainstorms/Infrastructure/storm-012-adaptive-limits
 *
 * Defines thoroughness levels, operating modes, budget exhaustion reasons,
 * serendipity scaling configuration, and query type mapping records.
 *
 * NOTE: The foundational adaptive limit constants (OPERATION_BUDGETS,
 * QUALITY_TARGETS, COLD_START_THRESHOLD, COLD_START_LIMITS, QUALITY_WEIGHTS)
 * are defined in storm-028 (params). This module adds the orchestration-layer
 * constants that storm-012 introduces.
 */

import { z } from 'zod';

// ============================================================
// THOROUGHNESS
// ============================================================

/**
 * User-facing thoroughness levels.
 * Maps to budget multipliers that scale time and node limits.
 *
 * From brainstorm revision.md Part 2:
 * - Quick: 0.5x time, 0.5x nodes -> faster but may miss things
 * - Balanced: 1x (default)
 * - Deep: 2x time, 2x nodes -> slower but more thorough
 */
export const THOROUGHNESS_LEVELS = ['quick', 'balanced', 'deep'] as const;

export type ThoroughnessLevel = (typeof THOROUGHNESS_LEVELS)[number];

export const ThoroughnessLevelSchema = z.enum(THOROUGHNESS_LEVELS);

/**
 * Type guard for ThoroughnessLevel.
 */
export function isThoroughnessLevel(value: unknown): value is ThoroughnessLevel {
  return THOROUGHNESS_LEVELS.includes(value as ThoroughnessLevel);
}

/**
 * Budget multipliers per thoroughness level.
 * Applied to time_ms and max_nodes. max_api_calls is NOT multiplied
 * because API calls are binary decisions (call or don't call).
 */
export const THOROUGHNESS_MULTIPLIERS: Record<ThoroughnessLevel, number> = {
  quick: 0.5,
  balanced: 1.0,
  deep: 2.0,
};

export const ThoroughnessMultipliersSchema = z.record(
  ThoroughnessLevelSchema,
  z.number().positive()
);

/**
 * Default thoroughness level for new requests.
 */
export const DEFAULT_THOROUGHNESS: ThoroughnessLevel = 'balanced';

// ============================================================
// OPERATING MODES
// ============================================================

/**
 * ABS operating modes.
 * - cold_start: Graph has <200 nodes, uses fixed limits
 * - adaptive: Graph has 200+ nodes, uses graph-aware scaling
 *
 * The 200-node threshold is consistent with:
 * - storm-028: COLD_START_THRESHOLD = 200
 * - storm-006: COLD_START_CONFIG.threshold_nodes = 200
 */
export const BUDGET_MODES = ['cold_start', 'adaptive'] as const;

export type BudgetMode = (typeof BUDGET_MODES)[number];

export const BudgetModeSchema = z.enum(BUDGET_MODES);

/**
 * Type guard for BudgetMode.
 */
export function isBudgetMode(value: unknown): value is BudgetMode {
  return BUDGET_MODES.includes(value as BudgetMode);
}

// ============================================================
// BUDGET EXHAUSTION
// ============================================================

/**
 * Reasons why a budget can be exhausted before quality target is met.
 * Used in graceful degradation (brainstorm revision.md Part 7, critique Issue 8).
 */
export const BUDGET_EXHAUSTION_REASONS = [
  'time_exhausted',
  'node_limit_reached',
  'api_calls_exhausted',
] as const;

export type BudgetExhaustionReason = (typeof BUDGET_EXHAUSTION_REASONS)[number];

export const BudgetExhaustionReasonSchema = z.enum(BUDGET_EXHAUSTION_REASONS);

/**
 * Type guard for BudgetExhaustionReason.
 */
export function isBudgetExhaustionReason(value: unknown): value is BudgetExhaustionReason {
  return BUDGET_EXHAUSTION_REASONS.includes(value as BudgetExhaustionReason);
}

// ============================================================
// SERENDIPITY SCALING
// ============================================================

/**
 * Minimum serendipity candidates regardless of graph size.
 * Ensures small graphs still get serendipitous suggestions.
 *
 * From brainstorm critique Issue 6:
 * "With 50 nodes, percentile-based selection may not find meaningful serendipity."
 * Fix: Hybrid approach with minimums.
 */
export const SERENDIPITY_MIN_CANDIDATES = 3;

/**
 * Percentile threshold for serendipity scaling.
 * Top 10% of activated nodes considered for serendipity.
 *
 * From brainstorm revision.md Part 5:
 * Hybrid percentile + minimum approach.
 */
export const SERENDIPITY_PERCENTILE = 0.10;

/**
 * Maximum serendipity candidates.
 * Upper bound to prevent excessive serendipity results.
 */
export const SERENDIPITY_MAX_CANDIDATES = 15;

// ============================================================
// SCHEMA VERSION
// ============================================================

/**
 * Schema version for persisted ABS types.
 * All persisted types must include _schemaVersion per Technical Audit requirement.
 */
export const ABS_SCHEMA_VERSION = 1;

// ============================================================
// QUERY TYPE MAPPINGS
// ============================================================

/**
 * Maps storm-003 retrieval QueryType -> storm-028 QUALITY_TARGETS keys.
 *
 * Three different query type systems exist in the codebase:
 * 1. storm-003 (retrieval): factual | list | exploratory | temporal | procedural
 * 2. storm-028 QUALITY_TARGETS: LOOKUP | REASONING | EXPLORATORY | TEMPORAL
 * 3. storm-028 QueryType (params): simple | standard | complex
 *
 * Storm-012 bridges these with explicit mapping records.
 */
export const QUERY_TYPE_TO_QUALITY_KEY: Record<string, string> = {
  factual: 'LOOKUP',
  list: 'REASONING',
  exploratory: 'EXPLORATORY',
  temporal: 'TEMPORAL',
  procedural: 'REASONING',
};

/**
 * Maps storm-003 retrieval QueryType -> storm-028 OPERATION_BUDGETS keys.
 * Phase 2 always maps to 'phase2_reasoning' (handled in function, not here).
 */
export const QUERY_TYPE_TO_OPERATION_KEY: Record<string, string> = {
  factual: 'simple_lookup',
  list: 'standard_query',
  exploratory: 'complex_query',
  temporal: 'standard_query',
  procedural: 'complex_query',
};

/**
 * Maps storm-028 QUALITY_TARGETS keys -> storm-028 QueryType (params).
 * Used by calculateAdaptiveLimits which expects 'simple' | 'standard' | 'complex'.
 */
export const QUALITY_KEY_TO_PARAMS_QUERY_TYPE: Record<string, string> = {
  LOOKUP: 'simple',
  REASONING: 'standard',
  EXPLORATORY: 'complex',
  TEMPORAL: 'standard',
};
