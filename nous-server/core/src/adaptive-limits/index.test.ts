/**
 * @module @nous/core/adaptive-limits
 * @description Tests for the Adaptive Budget System (ABS)
 * @version 1.0.0
 * @spec Specs/Phase-8-Scaling-Limits/storm-012
 */

import { describe, it, expect } from 'vitest';
import {
  // Constants
  THOROUGHNESS_LEVELS,
  THOROUGHNESS_MULTIPLIERS,
  DEFAULT_THOROUGHNESS,
  BUDGET_MODES,
  BUDGET_EXHAUSTION_REASONS,
  SERENDIPITY_MIN_CANDIDATES,
  SERENDIPITY_PERCENTILE,
  SERENDIPITY_MAX_CANDIDATES,
  ABS_SCHEMA_VERSION,
  QUERY_TYPE_TO_QUALITY_KEY,
  QUERY_TYPE_TO_OPERATION_KEY,
  QUALITY_KEY_TO_PARAMS_QUERY_TYPE,
  // Type guards
  isThoroughnessLevel,
  isBudgetMode,
  isBudgetExhaustionReason,
  // Schemas
  AdaptiveBudgetRequestSchema,
  AdaptiveBudgetResultSchema,
  BudgetExhaustionResultSchema,
  ABSConfigSchema,
  BudgetExplanationSchema,
  ScaledSerendipityConfigSchema,
  AdaptiveEvolutionThresholdsSchema,
  ThoroughnessLevelSchema,
  // Types & defaults
  DEFAULT_ABS_CONFIG,
  isAdaptiveBudgetRequest,
  isAdaptiveBudgetResult,
  isBudgetExhaustionResult,
  isABSConfig,
  // Functions
  applyThoroughness,
  calculateAdaptiveBudget,
  handleBudgetExhaustion,
  scaleSerendipity,
  getAdaptiveEvolutionThresholds,
  explainBudget,
  mapRetrievalQueryType,
  mapToOperationBudgetKey,
  mapToParamsQueryType,
} from './index';

import type { GraphMetrics } from '../params';

// ============================================================
// TEST DATA (from planning notes Section 14)
// ============================================================

const SMALL_GRAPH: GraphMetrics = {
  total_nodes: 50,
  total_edges: 80,
  density: 0.065,
  avg_inbound_edges: 1.6,
  avg_outbound_edges: 1.6,
};

const MEDIUM_GRAPH: GraphMetrics = {
  total_nodes: 5000,
  total_edges: 20000,
  density: 0.0016,
  avg_inbound_edges: 4,
  avg_outbound_edges: 4,
};

const LARGE_GRAPH: GraphMetrics = {
  total_nodes: 50000,
  total_edges: 200000,
  density: 0.00016,
  avg_inbound_edges: 4,
  avg_outbound_edges: 4,
};

const BOUNDARY_GRAPH: GraphMetrics = {
  total_nodes: 200,
  total_edges: 600,
  density: 0.03,
  avg_inbound_edges: 3,
  avg_outbound_edges: 3,
};

const JUST_BELOW_BOUNDARY: GraphMetrics = {
  total_nodes: 199,
  total_edges: 590,
  density: 0.03,
  avg_inbound_edges: 2.96,
  avg_outbound_edges: 2.96,
};

// ============================================================
// CONSTANTS
// ============================================================

describe('Adaptive Limits', () => {
  describe('Constants', () => {
    it('THOROUGHNESS_LEVELS has correct values', () => {
      expect(THOROUGHNESS_LEVELS).toEqual(['quick', 'balanced', 'deep']);
    });

    it('THOROUGHNESS_MULTIPLIERS has correct values for each level', () => {
      expect(THOROUGHNESS_MULTIPLIERS.quick).toBe(0.5);
      expect(THOROUGHNESS_MULTIPLIERS.balanced).toBe(1.0);
      expect(THOROUGHNESS_MULTIPLIERS.deep).toBe(2.0);
    });

    it('DEFAULT_THOROUGHNESS is balanced', () => {
      expect(DEFAULT_THOROUGHNESS).toBe('balanced');
    });

    it('BUDGET_MODES has correct values', () => {
      expect(BUDGET_MODES).toEqual(['cold_start', 'adaptive']);
    });

    it('BUDGET_EXHAUSTION_REASONS has correct values', () => {
      expect(BUDGET_EXHAUSTION_REASONS).toEqual([
        'time_exhausted',
        'node_limit_reached',
        'api_calls_exhausted',
      ]);
    });

    it('SERENDIPITY_MIN_CANDIDATES is 3', () => {
      expect(SERENDIPITY_MIN_CANDIDATES).toBe(3);
    });

    it('SERENDIPITY_PERCENTILE is 0.10', () => {
      expect(SERENDIPITY_PERCENTILE).toBe(0.10);
    });

    it('SERENDIPITY_MAX_CANDIDATES is 15', () => {
      expect(SERENDIPITY_MAX_CANDIDATES).toBe(15);
    });

    it('ABS_SCHEMA_VERSION is 1', () => {
      expect(ABS_SCHEMA_VERSION).toBe(1);
    });

    it('QUERY_TYPE_TO_QUALITY_KEY maps all 5 retrieval types', () => {
      expect(QUERY_TYPE_TO_QUALITY_KEY['factual']).toBe('LOOKUP');
      expect(QUERY_TYPE_TO_QUALITY_KEY['list']).toBe('REASONING');
      expect(QUERY_TYPE_TO_QUALITY_KEY['exploratory']).toBe('EXPLORATORY');
      expect(QUERY_TYPE_TO_QUALITY_KEY['temporal']).toBe('TEMPORAL');
      expect(QUERY_TYPE_TO_QUALITY_KEY['procedural']).toBe('REASONING');
    });

    it('QUERY_TYPE_TO_OPERATION_KEY maps all 5 retrieval types', () => {
      expect(QUERY_TYPE_TO_OPERATION_KEY['factual']).toBe('simple_lookup');
      expect(QUERY_TYPE_TO_OPERATION_KEY['list']).toBe('standard_query');
      expect(QUERY_TYPE_TO_OPERATION_KEY['exploratory']).toBe('complex_query');
      expect(QUERY_TYPE_TO_OPERATION_KEY['temporal']).toBe('standard_query');
      expect(QUERY_TYPE_TO_OPERATION_KEY['procedural']).toBe('complex_query');
    });

    it('QUALITY_KEY_TO_PARAMS_QUERY_TYPE maps all 4 quality keys', () => {
      expect(QUALITY_KEY_TO_PARAMS_QUERY_TYPE['LOOKUP']).toBe('simple');
      expect(QUALITY_KEY_TO_PARAMS_QUERY_TYPE['REASONING']).toBe('standard');
      expect(QUALITY_KEY_TO_PARAMS_QUERY_TYPE['EXPLORATORY']).toBe('complex');
      expect(QUALITY_KEY_TO_PARAMS_QUERY_TYPE['TEMPORAL']).toBe('standard');
    });
  });

  // ============================================================
  // TYPE GUARDS
  // ============================================================

  describe('Type Guards', () => {
    it('isThoroughnessLevel: valid values return true', () => {
      expect(isThoroughnessLevel('quick')).toBe(true);
      expect(isThoroughnessLevel('balanced')).toBe(true);
      expect(isThoroughnessLevel('deep')).toBe(true);
    });

    it('isThoroughnessLevel: invalid values return false', () => {
      expect(isThoroughnessLevel('medium')).toBe(false);
      expect(isThoroughnessLevel('')).toBe(false);
      expect(isThoroughnessLevel(null)).toBe(false);
      expect(isThoroughnessLevel(42)).toBe(false);
    });

    it('isBudgetMode: valid values return true', () => {
      expect(isBudgetMode('cold_start')).toBe(true);
      expect(isBudgetMode('adaptive')).toBe(true);
    });

    it('isBudgetMode: invalid values return false', () => {
      expect(isBudgetMode('warm')).toBe(false);
      expect(isBudgetMode('')).toBe(false);
      expect(isBudgetMode(undefined)).toBe(false);
    });

    it('isBudgetExhaustionReason: valid values return true', () => {
      expect(isBudgetExhaustionReason('time_exhausted')).toBe(true);
      expect(isBudgetExhaustionReason('node_limit_reached')).toBe(true);
      expect(isBudgetExhaustionReason('api_calls_exhausted')).toBe(true);
    });

    it('isBudgetExhaustionReason: invalid values return false', () => {
      expect(isBudgetExhaustionReason('memory_exhausted')).toBe(false);
      expect(isBudgetExhaustionReason(null)).toBe(false);
    });
  });

  // ============================================================
  // ZOD SCHEMAS
  // ============================================================

  describe('Zod Schemas', () => {
    it('ThoroughnessLevelSchema validates correctly', () => {
      expect(ThoroughnessLevelSchema.safeParse('quick').success).toBe(true);
      expect(ThoroughnessLevelSchema.safeParse('balanced').success).toBe(true);
      expect(ThoroughnessLevelSchema.safeParse('deep').success).toBe(true);
      expect(ThoroughnessLevelSchema.safeParse('invalid').success).toBe(false);
    });

    it('AdaptiveBudgetRequestSchema: valid input passes', () => {
      const valid = {
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
        thoroughness: 'balanced',
      };
      expect(AdaptiveBudgetRequestSchema.safeParse(valid).success).toBe(true);
    });

    it('AdaptiveBudgetRequestSchema: optional fields are optional', () => {
      const minimal = {
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'LOOKUP',
      };
      expect(AdaptiveBudgetRequestSchema.safeParse(minimal).success).toBe(true);
    });

    it('AdaptiveBudgetRequestSchema: missing required fields fails', () => {
      const invalid = { query_type: 'LOOKUP' };
      expect(AdaptiveBudgetRequestSchema.safeParse(invalid).success).toBe(false);
    });

    it('AdaptiveBudgetResultSchema: valid with _schemaVersion passes', () => {
      const valid = {
        _schemaVersion: 1,
        budget: { time_ms: 100, max_nodes: 500, max_api_calls: 0 },
        limits: { entry_points: 4, max_hops: 4, max_nodes: 250 },
        quality_target: { confidence: 0.70, min_coverage: 0.70 },
        thoroughness_applied: 'balanced',
        is_cold_start: false,
        explanation: {
          mode: 'adaptive',
          entry_points_reason: '4 entry points',
          hops_reason: '4 hops',
          node_limit_reason: '250 nodes',
          time_limit_reason: '100ms',
        },
      };
      expect(AdaptiveBudgetResultSchema.safeParse(valid).success).toBe(true);
    });

    it('AdaptiveBudgetResultSchema: missing _schemaVersion fails', () => {
      const invalid = {
        budget: { time_ms: 100, max_nodes: 500, max_api_calls: 0 },
        limits: { entry_points: 4, max_hops: 4, max_nodes: 250 },
        quality_target: { confidence: 0.70, min_coverage: 0.70 },
        thoroughness_applied: 'balanced',
        is_cold_start: false,
        explanation: {
          mode: 'adaptive',
          entry_points_reason: '4 entry points',
          hops_reason: '4 hops',
          node_limit_reason: '250 nodes',
          time_limit_reason: '100ms',
        },
      };
      expect(AdaptiveBudgetResultSchema.safeParse(invalid).success).toBe(false);
    });

    it('BudgetExhaustionResultSchema: valid input passes', () => {
      const valid = {
        exhausted_resource: 'time_exhausted',
        quality_achieved: 0.58,
        quality_target: 0.70,
        coverage_achieved: 0.01,
        partial: true,
        explanation: 'Reached time limit',
        suggestion: 'Try deeper',
      };
      expect(BudgetExhaustionResultSchema.safeParse(valid).success).toBe(true);
    });

    it('BudgetExhaustionResultSchema: partial must be true', () => {
      const invalid = {
        exhausted_resource: 'time_exhausted',
        quality_achieved: 0.58,
        quality_target: 0.70,
        coverage_achieved: 0.01,
        partial: false,
        explanation: 'Reached time limit',
        suggestion: 'Try deeper',
      };
      expect(BudgetExhaustionResultSchema.safeParse(invalid).success).toBe(false);
    });

    it('ABSConfigSchema: valid with _schemaVersion passes', () => {
      expect(ABSConfigSchema.safeParse(DEFAULT_ABS_CONFIG).success).toBe(true);
    });

    it('BudgetExplanationSchema: valid input passes', () => {
      const valid = {
        mode: 'adaptive',
        entry_points_reason: '4 entry points',
        hops_reason: '4 hops',
        node_limit_reason: '250 nodes',
        time_limit_reason: '100ms',
      };
      expect(BudgetExplanationSchema.safeParse(valid).success).toBe(true);
    });

    it('ScaledSerendipityConfigSchema: valid input passes', () => {
      const valid = {
        min_candidates: 3,
        percentile_threshold: 0.10,
        max_candidates: 15,
      };
      expect(ScaledSerendipityConfigSchema.safeParse(valid).success).toBe(true);
    });

    it('AdaptiveEvolutionThresholdsSchema: valid input passes', () => {
      const valid = {
        emerge_threshold: 50,
        split_threshold: 500,
        serendipity_candidates: 5,
        is_cold_start: false,
      };
      expect(AdaptiveEvolutionThresholdsSchema.safeParse(valid).success).toBe(true);
    });
  });

  // ============================================================
  // TYPE GUARD FUNCTIONS (from types.ts)
  // ============================================================

  describe('Type Guard Functions', () => {
    it('isAdaptiveBudgetRequest validates correctly', () => {
      const valid = { graph_metrics: MEDIUM_GRAPH, query_type: 'REASONING' };
      expect(isAdaptiveBudgetRequest(valid)).toBe(true);
      expect(isAdaptiveBudgetRequest({})).toBe(false);
      expect(isAdaptiveBudgetRequest(null)).toBe(false);
    });

    it('isAdaptiveBudgetResult validates correctly', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
      });
      expect(isAdaptiveBudgetResult(result)).toBe(true);
      expect(isAdaptiveBudgetResult({})).toBe(false);
    });

    it('isBudgetExhaustionResult validates correctly', () => {
      const result = handleBudgetExhaustion('time_exhausted', 0.5, 0.7, 0.3);
      expect(isBudgetExhaustionResult(result)).toBe(true);
      expect(isBudgetExhaustionResult({})).toBe(false);
    });

    it('isABSConfig validates correctly', () => {
      expect(isABSConfig(DEFAULT_ABS_CONFIG)).toBe(true);
      expect(isABSConfig({})).toBe(false);
    });
  });

  // ============================================================
  // applyThoroughness
  // ============================================================

  describe('applyThoroughness', () => {
    const baseBudget = { time_ms: 100, max_nodes: 500, max_api_calls: 5 };

    it('quick (0.5x): halves time_ms and max_nodes', () => {
      const result = applyThoroughness(baseBudget, 'quick');
      expect(result.time_ms).toBe(50);
      expect(result.max_nodes).toBe(250);
    });

    it('balanced (1x): no change', () => {
      const result = applyThoroughness(baseBudget, 'balanced');
      expect(result.time_ms).toBe(100);
      expect(result.max_nodes).toBe(500);
    });

    it('deep (2x): doubles time_ms and max_nodes', () => {
      const result = applyThoroughness(baseBudget, 'deep');
      expect(result.time_ms).toBe(200);
      expect(result.max_nodes).toBe(1000);
    });

    it('does NOT modify max_api_calls', () => {
      expect(applyThoroughness(baseBudget, 'quick').max_api_calls).toBe(5);
      expect(applyThoroughness(baseBudget, 'balanced').max_api_calls).toBe(5);
      expect(applyThoroughness(baseBudget, 'deep').max_api_calls).toBe(5);
    });

    it('does not mutate input', () => {
      const original = { time_ms: 100, max_nodes: 500, max_api_calls: 5 };
      applyThoroughness(original, 'deep');
      expect(original.time_ms).toBe(100);
      expect(original.max_nodes).toBe(500);
    });

    it('works with zero values', () => {
      const zero = { time_ms: 0, max_nodes: 0, max_api_calls: 0 };
      const result = applyThoroughness(zero, 'deep');
      expect(result.time_ms).toBe(0);
      expect(result.max_nodes).toBe(0);
    });
  });

  // ============================================================
  // calculateAdaptiveBudget
  // ============================================================

  describe('calculateAdaptiveBudget', () => {
    it('cold-start mode (50 nodes): returns cold-start limits', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: SMALL_GRAPH,
        query_type: 'REASONING',
      });
      expect(result.is_cold_start).toBe(true);
      expect(result.explanation.mode).toBe('cold_start');
      // storm-028: cold-start entry_points = 2, max_hops = 3
      expect(result.limits.entry_points).toBe(2);
      expect(result.limits.max_hops).toBe(3);
    });

    it('cold-start mode (199 nodes): still cold-start', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: JUST_BELOW_BOUNDARY,
        query_type: 'LOOKUP',
      });
      expect(result.is_cold_start).toBe(true);
    });

    it('boundary (200 nodes): switches to adaptive', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: BOUNDARY_GRAPH,
        query_type: 'REASONING',
      });
      expect(result.is_cold_start).toBe(false);
      expect(result.explanation.mode).toBe('adaptive');
    });

    it('medium graph (5000 nodes): correct entry points', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
      });
      expect(result.is_cold_start).toBe(false);
      // log10(5000) = 3.7, ceil = 4, clamped [2,5] = 4
      expect(result.limits.entry_points).toBe(4);
    });

    it('large graph (50000 nodes): correct entry points', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: LARGE_GRAPH,
        query_type: 'REASONING',
      });
      // log10(50000) = 4.7, ceil = 5, clamped [2,5] = 5
      expect(result.limits.entry_points).toBe(5);
    });

    it('very large graph (100000 nodes): entry points capped at 5', () => {
      const veryLarge: GraphMetrics = {
        total_nodes: 100000,
        total_edges: 400000,
        density: 0.00008,
        avg_inbound_edges: 4,
        avg_outbound_edges: 4,
      };
      const result = calculateAdaptiveBudget({
        graph_metrics: veryLarge,
        query_type: 'REASONING',
      });
      // log10(100000) = 5, ceil = 5, clamped [2,5] = 5
      expect(result.limits.entry_points).toBe(5);
    });

    it('LOOKUP query type: gets correct quality target', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'LOOKUP',
      });
      expect(result.quality_target.confidence).toBe(0.80);
      expect(result.quality_target.min_coverage).toBe(0.60);
    });

    it('REASONING query type: gets correct quality target', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
      });
      expect(result.quality_target.confidence).toBe(0.70);
      expect(result.quality_target.min_coverage).toBe(0.70);
    });

    it('EXPLORATORY query type: gets correct quality target', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'EXPLORATORY',
      });
      expect(result.quality_target.confidence).toBe(0.50);
      expect(result.quality_target.min_coverage).toBe(0.40);
    });

    it('TEMPORAL query type: gets correct quality target', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'TEMPORAL',
      });
      expect(result.quality_target.confidence).toBe(0.75);
      expect(result.quality_target.min_coverage).toBe(0.65);
    });

    it('quick thoroughness: budget is halved', () => {
      const balanced = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
        thoroughness: 'balanced',
      });
      const quick = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
        thoroughness: 'quick',
      });
      expect(quick.budget.time_ms).toBe(Math.round(balanced.budget.time_ms * 0.5));
      expect(quick.budget.max_nodes).toBe(Math.round(balanced.budget.max_nodes * 0.5));
    });

    it('deep thoroughness: budget is doubled', () => {
      const balanced = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
        thoroughness: 'balanced',
      });
      const deep = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
        thoroughness: 'deep',
      });
      expect(deep.budget.time_ms).toBe(Math.round(balanced.budget.time_ms * 2));
      expect(deep.budget.max_nodes).toBe(Math.round(balanced.budget.max_nodes * 2));
    });

    it('defaults to balanced thoroughness', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
      });
      expect(result.thoroughness_applied).toBe('balanced');
    });

    it('custom operation key overrides mapping', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'LOOKUP',
        operation: 'complex_query',
      });
      // complex_query budget: { time_ms: 200, max_nodes: 1000, max_api_calls: 0 }
      expect(result.budget.time_ms).toBe(200);
      expect(result.budget.max_nodes).toBe(1000);
    });

    it('explanation.mode is cold_start for small graphs', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: SMALL_GRAPH,
        query_type: 'REASONING',
      });
      expect(result.explanation.mode).toBe('cold_start');
    });

    it('explanation.mode is adaptive for large graphs', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: LARGE_GRAPH,
        query_type: 'REASONING',
      });
      expect(result.explanation.mode).toBe('adaptive');
    });

    it('_schemaVersion is 1', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
      });
      expect(result._schemaVersion).toBe(1);
    });

    it('unknown query type falls back to REASONING quality target', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'UNKNOWN_TYPE',
      });
      // Falls back to REASONING quality target
      expect(result.quality_target.confidence).toBe(0.70);
      expect(result.quality_target.min_coverage).toBe(0.70);
    });

    it('explanation has non-empty reason strings', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
      });
      expect(result.explanation.entry_points_reason.length).toBeGreaterThan(0);
      expect(result.explanation.hops_reason.length).toBeGreaterThan(0);
      expect(result.explanation.node_limit_reason.length).toBeGreaterThan(0);
      expect(result.explanation.time_limit_reason.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // handleBudgetExhaustion
  // ============================================================

  describe('handleBudgetExhaustion', () => {
    it('time_exhausted: returns correct result', () => {
      const result = handleBudgetExhaustion('time_exhausted', 0.58, 0.70, 0.01);
      expect(result.exhausted_resource).toBe('time_exhausted');
      expect(result.explanation).toContain('time limit');
      expect(result.explanation).toContain('58%');
      expect(result.explanation).toContain('70%');
    });

    it('node_limit_reached: returns correct result', () => {
      const result = handleBudgetExhaustion('node_limit_reached', 0.45, 0.80, 0.05);
      expect(result.exhausted_resource).toBe('node_limit_reached');
      expect(result.explanation).toContain('maximum nodes');
    });

    it('api_calls_exhausted: returns correct result', () => {
      const result = handleBudgetExhaustion('api_calls_exhausted', 0.30, 0.70, 0.02);
      expect(result.exhausted_resource).toBe('api_calls_exhausted');
      expect(result.explanation).toContain('API calls');
    });

    it('partial is always true', () => {
      expect(handleBudgetExhaustion('time_exhausted', 0.5, 0.7, 0.3).partial).toBe(true);
      expect(handleBudgetExhaustion('node_limit_reached', 0.5, 0.7, 0.3).partial).toBe(true);
      expect(handleBudgetExhaustion('api_calls_exhausted', 0.5, 0.7, 0.3).partial).toBe(true);
    });

    it('explanation is non-empty string', () => {
      const result = handleBudgetExhaustion('time_exhausted', 0.5, 0.7, 0.3);
      expect(typeof result.explanation).toBe('string');
      expect(result.explanation.length).toBeGreaterThan(0);
    });

    it('suggestion is non-empty string', () => {
      const result = handleBudgetExhaustion('time_exhausted', 0.5, 0.7, 0.3);
      expect(typeof result.suggestion).toBe('string');
      expect(result.suggestion.length).toBeGreaterThan(0);
    });

    it('preserves quality values', () => {
      const result = handleBudgetExhaustion('time_exhausted', 0.58, 0.70, 0.15);
      expect(result.quality_achieved).toBe(0.58);
      expect(result.quality_target).toBe(0.70);
      expect(result.coverage_achieved).toBe(0.15);
    });

    it('result validates against schema', () => {
      const result = handleBudgetExhaustion('time_exhausted', 0.5, 0.7, 0.3);
      expect(BudgetExhaustionResultSchema.safeParse(result).success).toBe(true);
    });
  });

  // ============================================================
  // scaleSerendipity
  // ============================================================

  describe('scaleSerendipity', () => {
    it("level 'off': returns 0", () => {
      expect(scaleSerendipity(50, 'off')).toBe(0);
      expect(scaleSerendipity(50000, 'off')).toBe(0);
    });

    it('small graph (50 nodes): returns min_candidates (3)', () => {
      // 50 * 0.10 = 5, min(2, 5) = 2 (low count), max(3, 2) = 3
      expect(scaleSerendipity(50, 'low')).toBe(3);
      // 50 * 0.10 = 5, min(5, 5) = 5, max(3, 5) = 5
      expect(scaleSerendipity(50, 'medium')).toBe(5);
    });

    it('very small graph (10 nodes): returns min_candidates (3)', () => {
      // 10 * 0.10 = 1, min(2, 1) = 1 (low count), max(3, 1) = 3
      expect(scaleSerendipity(10, 'low')).toBe(3);
    });

    it("level 'low' (count: 2): returns max of min_candidates and level count", () => {
      // Low's SERENDIPITY_THRESHOLDS count is 2
      // For any graph: max(3, min(2, scaledCount, 15))
      // The min(2, anything) always produces <= 2, so max(3, <=2) = 3
      expect(scaleSerendipity(1000, 'low')).toBe(3);
      expect(scaleSerendipity(50000, 'low')).toBe(3);
    });

    it("level 'medium' (count: 5): scales with graph size", () => {
      // 1000 * 0.10 = 100, min(5, 100, 15) = 5, max(3, 5) = 5
      expect(scaleSerendipity(1000, 'medium')).toBe(5);
      // 20 * 0.10 = 2, min(5, 2, 15) = 2, max(3, 2) = 3
      expect(scaleSerendipity(20, 'medium')).toBe(3);
    });

    it("level 'high' (count: 10): scales with graph size", () => {
      // 50 * 0.10 = 5, min(10, 5, 15) = 5, max(3, 5) = 5
      expect(scaleSerendipity(50, 'high')).toBe(5);
      // 5000 * 0.10 = 500, min(10, 500, 15) = 10, max(3, 10) = 10
      expect(scaleSerendipity(5000, 'high')).toBe(10);
    });

    it('large graph: capped by level max', () => {
      // 50000 * 0.10 = 5000, min(5, 5000, 15) = 5
      expect(scaleSerendipity(50000, 'medium')).toBe(5);
      // 50000 * 0.10 = 5000, min(10, 5000, 15) = 10
      expect(scaleSerendipity(50000, 'high')).toBe(10);
    });

    it('zero nodes graph: returns min_candidates for non-off', () => {
      // 0 * 0.10 = 0, min(2, 0, 15) = 0, max(3, 0) = 3
      expect(scaleSerendipity(0, 'low')).toBe(3);
      expect(scaleSerendipity(0, 'medium')).toBe(3);
      expect(scaleSerendipity(0, 'high')).toBe(3);
    });
  });

  // ============================================================
  // getAdaptiveEvolutionThresholds
  // ============================================================

  describe('getAdaptiveEvolutionThresholds', () => {
    it('cold-start (50 nodes): returns fixed thresholds', () => {
      const result = getAdaptiveEvolutionThresholds(50);
      expect(result.is_cold_start).toBe(true);
      // storm-006: COLD_START_CONFIG.emerge_fixed = 15
      expect(result.emerge_threshold).toBe(15);
      // storm-006: COLD_START_CONFIG.split_fixed = 100
      expect(result.split_threshold).toBe(100);
    });

    it('adaptive (1000 nodes): returns calculated thresholds', () => {
      const result = getAdaptiveEvolutionThresholds(1000);
      expect(result.is_cold_start).toBe(false);
      // storm-006: floor(1000 * 0.01) = 10, clamped [10, 100] = 10
      expect(result.emerge_threshold).toBe(10);
      // storm-006: floor(1000 * 0.10) = 100, clamped [50, 500] = 100
      expect(result.split_threshold).toBe(100);
    });

    it('large graph (50000 nodes): thresholds within bounds', () => {
      const result = getAdaptiveEvolutionThresholds(50000);
      // storm-006: floor(50000 * 0.01) = 500, clamped [10, 100] = 100
      expect(result.emerge_threshold).toBe(100);
      // storm-006: floor(50000 * 0.10) = 5000, clamped [50, 500] = 500
      expect(result.split_threshold).toBe(500);
    });

    it('without learning: uses defaults', () => {
      const result = getAdaptiveEvolutionThresholds(5000);
      expect(result.emerge_threshold).toBeGreaterThan(0);
      expect(result.split_threshold).toBeGreaterThan(0);
    });

    it('includes serendipity_candidates', () => {
      const result = getAdaptiveEvolutionThresholds(5000);
      expect(result.serendipity_candidates).toBeGreaterThanOrEqual(SERENDIPITY_MIN_CANDIDATES);
    });

    it('is_cold_start flag is correct at boundary', () => {
      expect(getAdaptiveEvolutionThresholds(199).is_cold_start).toBe(true);
      expect(getAdaptiveEvolutionThresholds(200).is_cold_start).toBe(false);
    });

    it('result validates against schema', () => {
      const result = getAdaptiveEvolutionThresholds(5000);
      expect(AdaptiveEvolutionThresholdsSchema.safeParse(result).success).toBe(true);
    });
  });

  // ============================================================
  // explainBudget
  // ============================================================

  describe('explainBudget', () => {
    it('cold-start result: mentions "fixed limits" and "small graph"', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: SMALL_GRAPH,
        query_type: 'REASONING',
      });
      const explanation = explainBudget(result);
      expect(explanation).toContain('fixed limits');
      expect(explanation).toContain('small graph');
    });

    it('adaptive result: mentions entry points', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
      });
      const explanation = explainBudget(result);
      expect(explanation).toContain('entry points');
    });

    it('includes node count', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
      });
      const explanation = explainBudget(result);
      expect(explanation).toContain(`${result.limits.max_nodes}`);
    });

    it('adaptive result: mentions confidence target', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
      });
      const explanation = explainBudget(result);
      expect(explanation).toContain('confidence target');
    });

    it('returns a non-empty string', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
      });
      expect(explainBudget(result).length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // mapRetrievalQueryType
  // ============================================================

  describe('mapRetrievalQueryType', () => {
    it('factual -> LOOKUP', () => {
      expect(mapRetrievalQueryType('factual')).toBe('LOOKUP');
    });

    it('list -> REASONING', () => {
      expect(mapRetrievalQueryType('list')).toBe('REASONING');
    });

    it('exploratory -> EXPLORATORY', () => {
      expect(mapRetrievalQueryType('exploratory')).toBe('EXPLORATORY');
    });

    it('temporal -> TEMPORAL', () => {
      expect(mapRetrievalQueryType('temporal')).toBe('TEMPORAL');
    });

    it('procedural -> REASONING', () => {
      expect(mapRetrievalQueryType('procedural')).toBe('REASONING');
    });

    it('unknown -> REASONING (fallback)', () => {
      expect(mapRetrievalQueryType('unknown')).toBe('REASONING');
      expect(mapRetrievalQueryType('')).toBe('REASONING');
      expect(mapRetrievalQueryType('garbage')).toBe('REASONING');
    });
  });

  // ============================================================
  // mapToOperationBudgetKey
  // ============================================================

  describe('mapToOperationBudgetKey', () => {
    it('factual, Phase 1 -> simple_lookup', () => {
      expect(mapToOperationBudgetKey('factual', false)).toBe('simple_lookup');
    });

    it('list, Phase 1 -> standard_query', () => {
      expect(mapToOperationBudgetKey('list', false)).toBe('standard_query');
    });

    it('exploratory, Phase 1 -> complex_query', () => {
      expect(mapToOperationBudgetKey('exploratory', false)).toBe('complex_query');
    });

    it('temporal, Phase 1 -> standard_query', () => {
      expect(mapToOperationBudgetKey('temporal', false)).toBe('standard_query');
    });

    it('procedural, Phase 1 -> complex_query', () => {
      expect(mapToOperationBudgetKey('procedural', false)).toBe('complex_query');
    });

    it('any type, Phase 2 -> phase2_reasoning', () => {
      expect(mapToOperationBudgetKey('factual', true)).toBe('phase2_reasoning');
      expect(mapToOperationBudgetKey('exploratory', true)).toBe('phase2_reasoning');
      expect(mapToOperationBudgetKey('unknown', true)).toBe('phase2_reasoning');
    });

    it('unknown, Phase 1 -> standard_query (fallback)', () => {
      expect(mapToOperationBudgetKey('unknown', false)).toBe('standard_query');
      expect(mapToOperationBudgetKey('', false)).toBe('standard_query');
    });
  });

  // ============================================================
  // mapToParamsQueryType
  // ============================================================

  describe('mapToParamsQueryType', () => {
    it('LOOKUP -> simple', () => {
      expect(mapToParamsQueryType('LOOKUP')).toBe('simple');
    });

    it('REASONING -> standard', () => {
      expect(mapToParamsQueryType('REASONING')).toBe('standard');
    });

    it('EXPLORATORY -> complex', () => {
      expect(mapToParamsQueryType('EXPLORATORY')).toBe('complex');
    });

    it('TEMPORAL -> standard', () => {
      expect(mapToParamsQueryType('TEMPORAL')).toBe('standard');
    });

    it('unknown -> standard (fallback)', () => {
      expect(mapToParamsQueryType('UNKNOWN')).toBe('standard');
      expect(mapToParamsQueryType('')).toBe('standard');
    });
  });

  // ============================================================
  // Integration
  // ============================================================

  describe('Integration', () => {
    it('full pipeline: request -> budget -> limits -> explanation', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'REASONING',
        thoroughness: 'balanced',
      });

      // Budget should have positive values
      expect(result.budget.time_ms).toBeGreaterThan(0);
      expect(result.budget.max_nodes).toBeGreaterThan(0);

      // Limits should be reasonable for 5000 nodes
      expect(result.limits.entry_points).toBeGreaterThanOrEqual(2);
      expect(result.limits.entry_points).toBeLessThanOrEqual(5);
      expect(result.limits.max_hops).toBeGreaterThanOrEqual(2);
      expect(result.limits.max_hops).toBeLessThanOrEqual(5);

      // Quality target should match REASONING
      expect(result.quality_target.confidence).toBe(0.70);

      // Explanation should be valid
      expect(BudgetExplanationSchema.safeParse(result.explanation).success).toBe(true);

      // Full result should be valid
      expect(AdaptiveBudgetResultSchema.safeParse(result).success).toBe(true);
    });

    it('quality target is consistent with params QUALITY_TARGETS', () => {
      const lookupResult = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'LOOKUP',
      });
      expect(lookupResult.quality_target.confidence).toBe(0.80);

      const exploratoryResult = calculateAdaptiveBudget({
        graph_metrics: MEDIUM_GRAPH,
        query_type: 'EXPLORATORY',
      });
      expect(exploratoryResult.quality_target.confidence).toBe(0.50);
    });

    it('mapping chain: retrieval type -> quality key -> params type -> limits', () => {
      // factual -> LOOKUP -> simple -> 2% node budget
      const qualityKey = mapRetrievalQueryType('factual');
      expect(qualityKey).toBe('LOOKUP');

      const paramsType = mapToParamsQueryType(qualityKey);
      expect(paramsType).toBe('simple');

      const operationKey = mapToOperationBudgetKey('factual', false);
      expect(operationKey).toBe('simple_lookup');
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================

  describe('Edge Cases', () => {
    it('zero nodes graph', () => {
      const zeroGraph: GraphMetrics = {
        total_nodes: 0,
        total_edges: 0,
        density: 0,
        avg_inbound_edges: 0,
        avg_outbound_edges: 0,
      };
      const result = calculateAdaptiveBudget({
        graph_metrics: zeroGraph,
        query_type: 'REASONING',
      });
      expect(result.is_cold_start).toBe(true);
    });

    it('1 node graph', () => {
      const oneNode: GraphMetrics = {
        total_nodes: 1,
        total_edges: 0,
        density: 0,
        avg_inbound_edges: 0,
        avg_outbound_edges: 0,
      };
      const result = calculateAdaptiveBudget({
        graph_metrics: oneNode,
        query_type: 'REASONING',
      });
      expect(result.is_cold_start).toBe(true);
      expect(result.limits.entry_points).toBe(2);
    });

    it('exactly 200 nodes (boundary): adaptive mode', () => {
      const result = calculateAdaptiveBudget({
        graph_metrics: BOUNDARY_GRAPH,
        query_type: 'REASONING',
      });
      // 200 is NOT < 200, so adaptive mode
      expect(result.is_cold_start).toBe(false);
    });

    it('201 nodes (just above threshold)', () => {
      const graph201: GraphMetrics = {
        total_nodes: 201,
        total_edges: 610,
        density: 0.03,
        avg_inbound_edges: 3.04,
        avg_outbound_edges: 3.04,
      };
      const result = calculateAdaptiveBudget({
        graph_metrics: graph201,
        query_type: 'REASONING',
      });
      expect(result.is_cold_start).toBe(false);
    });

    it('very sparse graph (density 0.0001)', () => {
      const sparseGraph: GraphMetrics = {
        total_nodes: 10000,
        total_edges: 1000,
        density: 0.0001,
        avg_inbound_edges: 0.1,
        avg_outbound_edges: 0.1,
      };
      const result = calculateAdaptiveBudget({
        graph_metrics: sparseGraph,
        query_type: 'REASONING',
      });
      // Very sparse -> 5 hops
      expect(result.limits.max_hops).toBe(5);
    });

    it('very dense graph (density 0.5)', () => {
      const denseGraph: GraphMetrics = {
        total_nodes: 500,
        total_edges: 62500,
        density: 0.5,
        avg_inbound_edges: 125,
        avg_outbound_edges: 125,
      };
      const result = calculateAdaptiveBudget({
        graph_metrics: denseGraph,
        query_type: 'REASONING',
      });
      // Dense -> 2 hops
      expect(result.limits.max_hops).toBe(2);
    });

    it('100000+ nodes graph', () => {
      const hugeGraph: GraphMetrics = {
        total_nodes: 150000,
        total_edges: 600000,
        density: 0.00005,
        avg_inbound_edges: 4,
        avg_outbound_edges: 4,
      };
      const result = calculateAdaptiveBudget({
        graph_metrics: hugeGraph,
        query_type: 'EXPLORATORY',
      });
      // Entry points: log10(150000) = 5.18, ceil = 6, capped at 5
      expect(result.limits.entry_points).toBe(5);
      expect(result.is_cold_start).toBe(false);
    });

    it('DEFAULT_ABS_CONFIG has correct values', () => {
      expect(DEFAULT_ABS_CONFIG._schemaVersion).toBe(1);
      expect(DEFAULT_ABS_CONFIG.thoroughness_multipliers.quick).toBe(0.5);
      expect(DEFAULT_ABS_CONFIG.thoroughness_multipliers.balanced).toBe(1.0);
      expect(DEFAULT_ABS_CONFIG.thoroughness_multipliers.deep).toBe(2.0);
      expect(DEFAULT_ABS_CONFIG.serendipity.min_candidates).toBe(3);
      expect(DEFAULT_ABS_CONFIG.serendipity.percentile_threshold).toBe(0.10);
      expect(DEFAULT_ABS_CONFIG.serendipity.max_candidates).toBe(15);
      expect(DEFAULT_ABS_CONFIG.cold_start_threshold).toBe(200);
    });
  });
});
