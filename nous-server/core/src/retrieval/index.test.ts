/**
 * @module @nous/core/retrieval/tests
 * @description Comprehensive tests for Two-Phase Cognition retrieval module
 * @version 1.0.0
 * @spec Brainstorms/Specs/Phase-3-Retrieval-Core/storm-003
 */

import { describe, it, expect } from 'vitest';
import {
  // Constants
  PHASE2_MAX_ENTRY_POINTS,
  PHASE2_MAX_ITERATIONS,
  PHASE2_MAX_TOTAL_HOPS,
  PHASE2_TIMEOUT_MS,
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
  TOTAL_TOKEN_BUDGET,
  // Query Types
  QUERY_TYPES,
  QUERY_TYPE_PATTERNS,
  detectQueryType,
  isQueryType,
  validateQueryTypeResult,
  type QueryType,
  type QueryTypeResult,
  // Sufficiency
  THRESHOLDS_BY_QUERY_TYPE,
  AUTHORITATIVE_CONTENT_TYPES,
  FALLBACK_ACTIONS,
  checkResultSufficiency,
  isAuthoritativeResult,
  calculateCoverageScore,
  getThresholdsForQueryType,
  isFallbackAction,
  isAuthoritativeContentType,
  validateSufficiencyResult,
  type SearchResultForSufficiency,
  // Verbosity
  VERBOSITY_LEVELS,
  VERBOSITY_CONFIGS,
  DEFAULT_RETRIEVAL_SETTINGS,
  selectVerbosity,
  getVerbosityConfig,
  getAutoVerbosityConfig,
  isVerbosityLevel,
  validateVerbosityConfig,
  type VerbosityLevel,
  // Extraction
  SEGMENT_TYPES,
  CONTENT_PRIORITIES,
  EXTRACTION_RULES,
  calculateCompressionRatio,
  getExtractedLength,
  combineExtractedContent,
  isSegmentType,
  isContentPriority,
  validateExtractedContent,
  type ExtractedContent,
  type ExtractedSegment,
  // Why Included
  PRIMARY_SIGNALS,
  generateWhyIncluded,
  formatScoreBreakdown,
  isPrimarySignal,
  validateWhyIncluded,
  validateRankingReason,
  type RankingReason,
  type ScoreBreakdown,
  // Phase 2
  PHASE2_STATUSES,
  getPhase2TokenBudget,
  isWithinBudget,
  createSkippedResult,
  createTimeoutResult,
  createErrorResult,
  isPhase2Status,
  isPhase2Completed,
  isPhase2Skipped,
  validatePhase2Result,
  validatePhase2Request,
  type Phase2Result,
  type Phase2Request,
  // Fallback
  FALLBACK_STRATEGIES,
  ALTERNATIVE_STRATEGIES,
  simplifyQuery,
  generateClarificationForQueryType,
  generateMissingExplanation,
  createNoFallbackResult,
  createSimplifyFallbackResult,
  createClarifyFallbackResult,
  createExplainFallbackResult,
  isFallbackStrategy,
  isAlternativeStrategy,
  validateFallbackResult,
  // Prompts
  ORIENT_PROMPT_TEMPLATE,
  EXPLORE_PROMPT_TEMPLATE,
  SYNTHESIZE_PROMPT_TEMPLATE,
  EXTRACTION_PROMPT_TEMPLATE,
  RECOMMENDED_MODELS,
  formatCompressedNode,
  formatCompressedInsight,
  formatReasoningPath,
  formatGraphPath,
  buildOrientPrompt,
  buildExplorePrompt,
  buildSynthesizePrompt,
  buildExtractionPrompt,
  getRecommendedModel,
  // Cognition
  PIPELINE_STAGES,
  normalizeRequest,
  shouldRunPhase2,
  calculateOverallConfidence,
  formatReasoningChain,
  createEmptyMetrics,
  isPipelineStage,
  validateCognitionRequest,
  validateCognitionMetrics,
  type CognitionRequest,
} from './index';

// ============================================================================
// CONSTANTS TESTS
// ============================================================================

describe('Constants', () => {
  describe('Phase 2 Limits', () => {
    it('should have correct Phase 2 limits from storm-003 v3', () => {
      expect(PHASE2_MAX_ENTRY_POINTS).toBe(3);
      expect(PHASE2_MAX_ITERATIONS).toBe(3);
      expect(PHASE2_MAX_TOTAL_HOPS).toBe(6);
      expect(PHASE2_TIMEOUT_MS).toBe(10000);
    });

    it('should have correct confidence thresholds', () => {
      expect(HIGH_CONFIDENCE_THRESHOLD).toBe(0.7);
      expect(MEDIUM_CONFIDENCE_THRESHOLD).toBe(0.5);
    });

    it('should have correct total token budget', () => {
      expect(TOTAL_TOKEN_BUDGET).toBeGreaterThan(0);
      expect(TOTAL_TOKEN_BUDGET).toBe(5700); // 1000 + 2700 + 2000
    });
  });
});

// ============================================================================
// QUERY TYPES TESTS
// ============================================================================

describe('Query Types', () => {
  describe('QUERY_TYPES constant', () => {
    it('should include all 5 query types from storm-003 v5', () => {
      expect(QUERY_TYPES).toEqual(['factual', 'list', 'exploratory', 'temporal', 'procedural']);
    });
  });

  describe('detectQueryType', () => {
    it('should detect factual queries', () => {
      const result = detectQueryType("What's Sarah's birthday?");
      expect(result.type).toBe('factual');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('should detect list queries', () => {
      const result = detectQueryType('What are all the project deadlines?');
      expect(result.type).toBe('list');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should detect exploratory queries', () => {
      const result = detectQueryType('Tell me about quantum physics');
      expect(result.type).toBe('exploratory');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should detect temporal queries', () => {
      const result = detectQueryType('What happened last week?');
      expect(result.type).toBe('temporal');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should detect procedural queries', () => {
      const result = detectQueryType('How do I set up the project?');
      expect(result.type).toBe('procedural');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should fallback to exploratory for ambiguous queries', () => {
      const result = detectQueryType('random text here');
      expect(result.type).toBe('exploratory');
      expect(result.fallbackUsed).toBe(true);
    });

    it('should include matched pattern for high-confidence matches', () => {
      const result = detectQueryType('List all my tasks');
      expect(result.matchedPattern).toBeDefined();
      expect(result.fallbackUsed).toBe(false);
    });
  });

  describe('isQueryType', () => {
    it('should return true for valid query types', () => {
      expect(isQueryType('factual')).toBe(true);
      expect(isQueryType('list')).toBe(true);
      expect(isQueryType('exploratory')).toBe(true);
      expect(isQueryType('temporal')).toBe(true);
      expect(isQueryType('procedural')).toBe(true);
    });

    it('should return false for invalid query types', () => {
      expect(isQueryType('invalid')).toBe(false);
      expect(isQueryType('')).toBe(false);
    });
  });

  describe('validateQueryTypeResult', () => {
    it('should validate correct query type result', () => {
      const result: QueryTypeResult = {
        type: 'factual',
        confidence: 0.9,
        matchedPattern: 'test',
        fallbackUsed: false,
      };
      expect(validateQueryTypeResult(result)).toBe(true);
    });

    it('should reject invalid query type result', () => {
      expect(validateQueryTypeResult({ type: 'invalid' })).toBe(false);
      expect(validateQueryTypeResult(null)).toBe(false);
    });
  });
});

// ============================================================================
// SUFFICIENCY TESTS
// ============================================================================

describe('Sufficiency', () => {
  describe('THRESHOLDS_BY_QUERY_TYPE', () => {
    it('should have thresholds for all query types', () => {
      for (const queryType of QUERY_TYPES) {
        expect(THRESHOLDS_BY_QUERY_TYPE[queryType]).toBeDefined();
        expect(THRESHOLDS_BY_QUERY_TYPE[queryType].min_results).toBeGreaterThanOrEqual(1);
      }
    });

    it('should have correct factual thresholds (1 result with high confidence)', () => {
      const factual = THRESHOLDS_BY_QUERY_TYPE.factual;
      expect(factual.min_results).toBe(1);
      expect(factual.min_top_score).toBe(0.7);
      expect(factual.require_high_confidence).toBe(true);
    });

    it('should have correct list thresholds (5+ results with coverage)', () => {
      const list = THRESHOLDS_BY_QUERY_TYPE.list;
      expect(list.min_results).toBe(5);
      expect(list.min_coverage_score).toBe(0.6);
      expect(list.require_high_confidence).toBe(false);
    });
  });

  describe('checkResultSufficiency', () => {
    const createResult = (score: number, confidence: 'HIGH' | 'MEDIUM' | 'LOW', nodeType?: string): SearchResultForSufficiency => ({
      node_id: 'test-node',
      score,
      confidence,
      node_type: nodeType,
    });

    it('should return sufficient for factual query with authoritative result', () => {
      const results = [createResult(0.85, 'HIGH', 'person')];
      const sufficiency = checkResultSufficiency(results, "What's Sarah's birthday?", 'factual');
      expect(sufficiency.is_sufficient).toBe(true);
    });

    it('should return insufficient for factual query without high confidence', () => {
      const results = [createResult(0.85, 'MEDIUM')];
      const sufficiency = checkResultSufficiency(results, "What's Sarah's birthday?", 'factual');
      expect(sufficiency.is_sufficient).toBe(false);
      expect(sufficiency.suggested_action).toBe('clarify');
    });

    it('should return insufficient for list query with too few results', () => {
      const results = [createResult(0.8, 'HIGH'), createResult(0.7, 'HIGH')];
      const sufficiency = checkResultSufficiency(results, 'What are all the deadlines?', 'list');
      expect(sufficiency.is_sufficient).toBe(false);
      expect(sufficiency.suggested_action).toBe('simplify');
    });

    it('should suggest explain when no results', () => {
      const sufficiency = checkResultSufficiency([], 'test query', 'factual');
      expect(sufficiency.is_sufficient).toBe(false);
      expect(sufficiency.suggested_action).toBe('explain');
    });
  });

  describe('calculateCoverageScore', () => {
    it('should return 0 for empty results', () => {
      expect(calculateCoverageScore([])).toBe(0);
    });

    it('should weight earlier results higher', () => {
      const results = [
        { node_id: '1', score: 0.9 },
        { node_id: '2', score: 0.5 },
        { node_id: '3', score: 0.3 },
      ];
      const score = calculateCoverageScore(results);
      expect(score).toBeGreaterThan(0.5); // Heavily weighted toward first result
    });
  });

  describe('isAuthoritativeResult', () => {
    it('should return true for authoritative factual result', () => {
      const result: SearchResultForSufficiency = {
        node_id: 'test',
        score: 0.85,
        confidence: 'HIGH',
        node_type: 'person',
      };
      expect(isAuthoritativeResult(result, 'factual')).toBe(true);
    });

    it('should return false for non-factual queries', () => {
      const result: SearchResultForSufficiency = {
        node_id: 'test',
        score: 0.85,
        confidence: 'HIGH',
        node_type: 'person',
      };
      expect(isAuthoritativeResult(result, 'list')).toBe(false);
    });
  });
});

// ============================================================================
// VERBOSITY TESTS
// ============================================================================

describe('Verbosity', () => {
  describe('VERBOSITY_LEVELS', () => {
    it('should include all verbosity levels', () => {
      expect(VERBOSITY_LEVELS).toEqual(['minimal', 'standard', 'verbose']);
    });
  });

  describe('selectVerbosity', () => {
    it('should return minimal for high confidence factual', () => {
      expect(selectVerbosity(0.85, 'factual')).toBe('minimal');
    });

    it('should return standard for high confidence non-factual', () => {
      expect(selectVerbosity(0.85, 'list')).toBe('standard');
    });

    it('should return verbose for low confidence', () => {
      expect(selectVerbosity(0.3, 'factual')).toBe('verbose');
    });

    it('should respect user preference', () => {
      expect(selectVerbosity(0.9, 'factual', 'verbose')).toBe('verbose');
    });
  });

  describe('VERBOSITY_CONFIGS', () => {
    it('should have correct minimal config', () => {
      const minimal = VERBOSITY_CONFIGS.minimal;
      expect(minimal.show_score).toBe(false);
      expect(minimal.show_ranking_factors).toBe(false);
      expect(minimal.show_what_matched).toBe(true);
    });

    it('should have correct verbose config', () => {
      const verbose = VERBOSITY_CONFIGS.verbose;
      expect(verbose.show_score).toBe(true);
      expect(verbose.show_ranking_factors).toBe(true);
    });
  });

  describe('getAutoVerbosityConfig', () => {
    it('should auto-select based on confidence and query type', () => {
      const config = getAutoVerbosityConfig(0.9, 'factual');
      expect(config.level).toBe('minimal');
    });

    it('should respect user settings override', () => {
      const settings = { ...DEFAULT_RETRIEVAL_SETTINGS, explanation_verbosity: 'verbose' as const };
      const config = getAutoVerbosityConfig(0.9, 'factual', settings);
      expect(config.level).toBe('verbose');
    });
  });
});

// ============================================================================
// EXTRACTION TESTS
// ============================================================================

describe('Extraction', () => {
  describe('SEGMENT_TYPES', () => {
    it('should include all segment types from storm-003 v4', () => {
      expect(SEGMENT_TYPES).toEqual(['answer', 'definition', 'number', 'name', 'decision', 'action']);
    });
  });

  describe('calculateCompressionRatio', () => {
    it('should calculate correct ratio', () => {
      expect(calculateCompressionRatio(1000, 200)).toBe(0.8);
      expect(calculateCompressionRatio(1000, 1000)).toBe(0);
      expect(calculateCompressionRatio(1000, 0)).toBe(1);
    });

    it('should handle zero original length', () => {
      expect(calculateCompressionRatio(0, 0)).toBe(0);
    });
  });

  describe('getExtractedLength', () => {
    it('should sum high and medium priority lengths', () => {
      const extracted: ExtractedContent = {
        node_id: 'test',
        original_length: 1000,
        extracted_length: 200,
        compression_ratio: 0.8,
        high_priority: [{ text: 'hello', type: 'answer', relevance_score: 0.9, source_location: 'test' }],
        medium_priority: [{ text: 'world', type: 'name', relevance_score: 0.6, source_location: 'test' }],
        omitted_sections: [],
      };
      expect(getExtractedLength(extracted)).toBe(10); // 5 + 5
    });
  });

  describe('combineExtractedContent', () => {
    it('should combine and sort by relevance', () => {
      const extractions: ExtractedContent[] = [
        {
          node_id: '1',
          original_length: 100,
          extracted_length: 10,
          compression_ratio: 0.9,
          high_priority: [{ text: 'low', type: 'answer', relevance_score: 0.5, source_location: 'a' }],
          medium_priority: [],
          omitted_sections: [],
        },
        {
          node_id: '2',
          original_length: 100,
          extracted_length: 10,
          compression_ratio: 0.9,
          high_priority: [{ text: 'high', type: 'answer', relevance_score: 0.9, source_location: 'b' }],
          medium_priority: [],
          omitted_sections: [],
        },
      ];
      const combined = combineExtractedContent(extractions);
      expect(combined[0].text).toBe('high');
      expect(combined[1].text).toBe('low');
    });
  });
});

// ============================================================================
// WHY INCLUDED TESTS
// ============================================================================

describe('Why Included', () => {
  describe('PRIMARY_SIGNALS', () => {
    it('should include all 6 signals from storm-005', () => {
      expect(PRIMARY_SIGNALS).toEqual(['semantic', 'keyword', 'graph', 'recency', 'authority', 'affinity']);
    });
  });

  describe('generateWhyIncluded', () => {
    it('should generate explanation from ranking reason', () => {
      const rankingReason: RankingReason = {
        primary_signal: 'semantic',
        explanation: 'test',
        score_breakdown: {
          semantic: 0.9,
          keyword: 0.3,
          graph: 0.2,
          recency: 0.5,
          authority: 0.4,
          affinity: 0.3,
        },
      };
      const why = generateWhyIncluded(rankingReason, { query: 'test query' });
      expect(why.primary_reason).toContain('semantically');
      expect(why.ranking_factors.length).toBeGreaterThan(0);
    });

    it('should include connection path for graph signal', () => {
      const rankingReason: RankingReason = {
        primary_signal: 'graph',
        explanation: 'test',
        score_breakdown: {
          semantic: 0.3,
          keyword: 0.3,
          graph: 0.9,
          recency: 0.2,
          authority: 0.2,
          affinity: 0.2,
        },
      };
      const why = generateWhyIncluded(rankingReason, { query: 'test' });
      expect(why.connection_path).toBeDefined();
    });
  });

  describe('formatScoreBreakdown', () => {
    it('should format non-zero scores', () => {
      const breakdown: ScoreBreakdown = {
        semantic: 0.8,
        keyword: 0.6,
        graph: 0,
        recency: 0.5,
        authority: 0,
        affinity: 0,
      };
      const lines = formatScoreBreakdown(breakdown);
      expect(lines).toContain('Semantic: 80%');
      expect(lines).toContain('Keyword: 60%');
      expect(lines).not.toContain('Graph');
    });
  });
});

// ============================================================================
// PHASE 2 TESTS
// ============================================================================

describe('Phase 2', () => {
  describe('PHASE2_STATUSES', () => {
    it('should include all status values', () => {
      expect(PHASE2_STATUSES).toEqual(['skipped', 'running', 'completed', 'timeout', 'error']);
    });
  });

  describe('getPhase2TokenBudget', () => {
    it('should return correct total budget', () => {
      expect(getPhase2TokenBudget()).toBe(TOTAL_TOKEN_BUDGET);
    });
  });

  describe('isWithinBudget', () => {
    it('should return true for within budget', () => {
      const result: Phase2Result = {
        status: 'completed',
        total_tokens_used: 1000,
        total_duration_ms: 5000,
        within_budget: true,
      };
      expect(isWithinBudget(result)).toBe(true);
    });

    it('should return false for over budget', () => {
      const result: Phase2Result = {
        status: 'completed',
        total_tokens_used: 10000,
        total_duration_ms: 15000,
        within_budget: false,
      };
      expect(isWithinBudget(result)).toBe(false);
    });
  });

  describe('createSkippedResult', () => {
    it('should create skipped result with reason', () => {
      const result = createSkippedResult('High confidence');
      expect(result.status).toBe('skipped');
      expect(result.total_tokens_used).toBe(0);
      expect(result.within_budget).toBe(true);
      expect(result.error).toBe('High confidence');
    });
  });

  describe('createTimeoutResult', () => {
    it('should create timeout result with partial data', () => {
      const partial = {
        orient: {
          entry_points: [{ node_id: 'test', reason: 'test', relevance_score: 0.9 }],
          questions_addressed: ['test'],
          tokens_used: 500,
          duration_ms: 200,
        },
      };
      const result = createTimeoutResult(partial, 12000);
      expect(result.status).toBe('timeout');
      expect(result.orient).toBeDefined();
      expect(result.within_budget).toBe(false);
    });
  });

  describe('createErrorResult', () => {
    it('should create error result', () => {
      const result = createErrorResult('API failed', 1000);
      expect(result.status).toBe('error');
      expect(result.error).toBe('API failed');
      expect(result.total_duration_ms).toBe(1000);
    });
  });

  describe('isPhase2Completed', () => {
    it('should return true for completed with synthesize', () => {
      const result: Phase2Result = {
        status: 'completed',
        synthesize: {
          answer: 'test',
          sources: [],
          confidence: 0.9,
          answer_completeness: 'complete',
          tokens_used: 100,
          duration_ms: 50,
        },
        total_tokens_used: 1000,
        total_duration_ms: 2000,
        within_budget: true,
      };
      expect(isPhase2Completed(result)).toBe(true);
    });

    it('should return false for completed without synthesize', () => {
      const result: Phase2Result = {
        status: 'completed',
        total_tokens_used: 1000,
        total_duration_ms: 2000,
        within_budget: true,
      };
      expect(isPhase2Completed(result)).toBe(false);
    });
  });

  describe('validatePhase2Request', () => {
    it('should validate correct request', () => {
      const request: Phase2Request = {
        questions: ['What is X?'],
        ssa_results: [{ node_id: 'test', score: 0.9 }],
      };
      expect(validatePhase2Request(request)).toBe(true);
    });

    it('should reject empty questions', () => {
      expect(validatePhase2Request({ questions: [], ssa_results: [] })).toBe(false);
    });
  });
});

// ============================================================================
// FALLBACK TESTS
// ============================================================================

describe('Fallback', () => {
  describe('FALLBACK_STRATEGIES', () => {
    it('should include all strategies', () => {
      expect(FALLBACK_STRATEGIES).toEqual(['simplify', 'switch', 'clarify', 'explain']);
    });
  });

  describe('ALTERNATIVE_STRATEGIES', () => {
    it('should include all alternative strategies', () => {
      expect(ALTERNATIVE_STRATEGIES).toEqual(['title_only', 'tags', 'recent', 'connected']);
    });
  });

  describe('simplifyQuery', () => {
    it('should remove date constraints', () => {
      const result = simplifyQuery('project deadlines in Q1');
      expect(result.simplified).not.toContain('Q1');
      expect(result.removed_constraints).toContain('in Q1');
    });

    it('should remove time references', () => {
      const result = simplifyQuery('meetings last week');
      expect(result.simplified).not.toContain('last week');
    });

    it('should preserve original if no constraints', () => {
      const result = simplifyQuery('project deadlines');
      expect(result.simplified).toBe('project deadlines');
      expect(result.removed_constraints).toHaveLength(0);
    });
  });

  describe('generateClarificationForQueryType', () => {
    it('should generate appropriate suggestions for factual', () => {
      const clarification = generateClarificationForQueryType('test', 'factual');
      expect(clarification.suggestions.length).toBeGreaterThan(0);
      expect(clarification.suggestions[0]).toContain('name');
    });

    it('should generate appropriate suggestions for list', () => {
      const clarification = generateClarificationForQueryType('test', 'list');
      expect(clarification.suggestions.length).toBeGreaterThan(0);
      expect(clarification.suggestions.some(s => s.includes('category'))).toBe(true);
    });
  });

  describe('generateMissingExplanation', () => {
    it('should include query in message', () => {
      const explanation = generateMissingExplanation('quantum physics', 'factual');
      expect(explanation.message).toContain('quantum physics');
    });

    it('should provide reasons and actions', () => {
      const explanation = generateMissingExplanation('test', 'list');
      expect(explanation.possible_reasons.length).toBeGreaterThan(0);
      expect(explanation.suggested_actions.length).toBeGreaterThan(0);
    });
  });

  describe('Fallback result creators', () => {
    const baseSufficiency = { is_sufficient: false, reason: 'test' };

    it('createNoFallbackResult should work', () => {
      const result = createNoFallbackResult(baseSufficiency);
      expect(result.fallback_used).toBe('none');
      expect(result.strategies_tried).toHaveLength(0);
    });

    it('createSimplifyFallbackResult should work', () => {
      const result = createSimplifyFallbackResult(baseSufficiency, {
        original: 'test in Q1',
        simplified: 'test',
        removed_constraints: ['in Q1'],
      });
      expect(result.fallback_used).toBe('simplify');
      expect(result.simplified_query).toBeDefined();
    });

    it('createClarifyFallbackResult should preserve previous strategies', () => {
      const result = createClarifyFallbackResult(
        baseSufficiency,
        { question: 'test', suggestions: [], context: 'test' },
        ['simplify']
      );
      expect(result.strategies_tried).toEqual(['simplify', 'clarify']);
    });
  });
});

// ============================================================================
// PROMPTS TESTS
// ============================================================================

describe('Prompts', () => {
  describe('Template constants', () => {
    it('should have non-empty templates', () => {
      expect(ORIENT_PROMPT_TEMPLATE.length).toBeGreaterThan(100);
      expect(EXPLORE_PROMPT_TEMPLATE.length).toBeGreaterThan(100);
      expect(SYNTHESIZE_PROMPT_TEMPLATE.length).toBeGreaterThan(100);
      expect(EXTRACTION_PROMPT_TEMPLATE.length).toBeGreaterThan(100);
    });

    it('should include placeholder variables', () => {
      expect(ORIENT_PROMPT_TEMPLATE).toContain('{query}');
      expect(ORIENT_PROMPT_TEMPLATE).toContain('{compressed_concept_map}');
      expect(EXPLORE_PROMPT_TEMPLATE).toContain('{neighbors_compressed}');
      expect(SYNTHESIZE_PROMPT_TEMPLATE).toContain('{extracted_insights}');
    });
  });

  describe('RECOMMENDED_MODELS', () => {
    it('should have model for each step', () => {
      expect(RECOMMENDED_MODELS.orient).toBe('haiku');
      expect(RECOMMENDED_MODELS.explore).toBe('sonnet');
      expect(RECOMMENDED_MODELS.synthesize).toBe('sonnet');
      expect(RECOMMENDED_MODELS.extraction).toBe('haiku');
    });
  });

  describe('formatCompressedNode', () => {
    it('should format node correctly', () => {
      const result = formatCompressedNode({
        id: 'N001',
        type: 'person',
        name: 'Sarah Chen',
        keyFact: 'ML team lead',
      });
      expect(result).toBe('[N001] person: Sarah Chen - ML team lead');
    });
  });

  describe('formatCompressedInsight', () => {
    it('should format insight correctly', () => {
      const result = formatCompressedInsight('N001', 'This is important');
      expect(result).toBe('From N001: This is important');
    });
  });

  describe('formatReasoningPath', () => {
    it('should format path with numbered steps', () => {
      const path = [
        { nodeId: 'N001', nodeName: 'Project', reason: 'Direct match' },
        { nodeId: 'N002', nodeName: 'Timeline', reason: 'Contains dates' },
      ];
      const result = formatReasoningPath(path);
      expect(result).toContain('1. Project (N001)');
      expect(result).toContain('2. Timeline (N002)');
    });
  });

  describe('formatGraphPath', () => {
    it('should join nodes with arrows', () => {
      const result = formatGraphPath(['A', 'B', 'C']);
      expect(result).toBe('A -> B -> C');
    });
  });

  describe('Prompt builders', () => {
    it('buildOrientPrompt should replace variables', () => {
      const result = buildOrientPrompt({
        query: 'test query',
        compressed_concept_map: 'node list',
      });
      expect(result).toContain('test query');
      expect(result).toContain('node list');
      expect(result).not.toContain('{query}');
    });

    it('buildExplorePrompt should replace variables', () => {
      const result = buildExplorePrompt({
        query: 'test',
        current_node_full_context: 'context',
        neighbors_compressed: 'neighbors',
        accumulated_context: 'accumulated',
      });
      expect(result).not.toContain('{');
    });

    it('buildSynthesizePrompt should replace variables', () => {
      const result = buildSynthesizePrompt({
        query: 'test',
        extracted_insights: 'insights',
        path_visualization: 'path',
      });
      expect(result).not.toContain('{');
    });

    it('buildExtractionPrompt should replace variables', () => {
      const result = buildExtractionPrompt({
        questions: '["Q1", "Q2"]',
        full_content: 'content here',
      });
      expect(result).not.toContain('{');
    });
  });

  describe('getRecommendedModel', () => {
    it('should return correct model for each step', () => {
      expect(getRecommendedModel('orient')).toBe('haiku');
      expect(getRecommendedModel('explore')).toBe('sonnet');
      expect(getRecommendedModel('synthesize')).toBe('sonnet');
      expect(getRecommendedModel('extraction')).toBe('haiku');
    });
  });
});

// ============================================================================
// COGNITION TESTS
// ============================================================================

describe('Cognition', () => {
  describe('PIPELINE_STAGES', () => {
    it('should include all stages', () => {
      expect(PIPELINE_STAGES).toEqual([
        'query_analysis',
        'phase1_ssa',
        'qcs_decision',
        'sufficiency_check',
        'phase2_cognition',
        'fallback',
        'response_assembly',
      ]);
    });
  });

  describe('normalizeRequest', () => {
    it('should return questions array if provided', () => {
      const request: CognitionRequest = { questions: ['Q1', 'Q2'] };
      expect(normalizeRequest(request)).toEqual(['Q1', 'Q2']);
    });

    it('should wrap single question in array', () => {
      const request: CognitionRequest = { question: 'Q1' };
      expect(normalizeRequest(request)).toEqual(['Q1']);
    });

    it('should return empty array if no questions', () => {
      const request: CognitionRequest = {};
      expect(normalizeRequest(request)).toEqual([]);
    });

    it('should prefer questions over question', () => {
      const request: CognitionRequest = { question: 'Q1', questions: ['Q2'] };
      expect(normalizeRequest(request)).toEqual(['Q2']);
    });
  });

  describe('shouldRunPhase2', () => {
    it('should respect force_skip_phase2', () => {
      const request: CognitionRequest = { force_skip_phase2: true };
      expect(shouldRunPhase2(request, false)).toBe(false);
    });

    it('should respect force_phase2', () => {
      const request: CognitionRequest = { force_phase2: true };
      expect(shouldRunPhase2(request, true)).toBe(true);
    });

    it('should invert QCS decision', () => {
      expect(shouldRunPhase2({}, true)).toBe(false); // QCS says skip
      expect(shouldRunPhase2({}, false)).toBe(true); // QCS says run
    });
  });

  describe('calculateOverallConfidence', () => {
    it('should return LOW for empty results', () => {
      expect(calculateOverallConfidence([])).toBe('LOW');
    });

    it('should return HIGH for high confidence with good score', () => {
      const results = [
        { confidence: 'HIGH' as const, score: 0.85 },
        { confidence: 'MEDIUM' as const, score: 0.6 },
      ];
      expect(calculateOverallConfidence(results)).toBe('HIGH');
    });

    it('should return MEDIUM for medium scores', () => {
      const results = [{ confidence: 'MEDIUM' as const, score: 0.6 }];
      expect(calculateOverallConfidence(results)).toBe('MEDIUM');
    });

    it('should return LOW for low scores', () => {
      const results = [{ confidence: 'LOW' as const, score: 0.3 }];
      expect(calculateOverallConfidence(results)).toBe('LOW');
    });
  });

  describe('formatReasoningChain', () => {
    it('should format complete Phase 2 result', () => {
      const phase2Result: Phase2Result = {
        status: 'completed',
        orient: {
          entry_points: [{ node_id: 'N001', reason: 'test', relevance_score: 0.9 }],
          questions_addressed: ['test'],
          tokens_used: 100,
          duration_ms: 50,
        },
        explore: {
          iterations: [],
          total_hops: 2,
          all_nodes_visited: ['N001', 'N002'],
          all_findings: ['Finding 1', 'Finding 2'],
          tokens_used: 200,
          duration_ms: 100,
        },
        synthesize: {
          answer: 'test answer',
          sources: [],
          confidence: 0.85,
          answer_completeness: 'complete',
          tokens_used: 100,
          duration_ms: 50,
        },
        total_tokens_used: 400,
        total_duration_ms: 200,
        within_budget: true,
      };
      const chain = formatReasoningChain(phase2Result);
      expect(chain).toContain('N001');
      expect(chain).toContain('Finding 1');
      expect(chain).toContain('Confidence');
    });
  });

  describe('createEmptyMetrics', () => {
    it('should create metrics with all zeros', () => {
      const metrics = createEmptyMetrics();
      expect(metrics.total_duration_ms).toBe(0);
      expect(metrics.phase1_duration_ms).toBe(0);
      expect(metrics.phase2_duration_ms).toBe(0);
      expect(metrics.ssa_results_count).toBe(0);
      expect(metrics.final_results_count).toBe(0);
      expect(metrics.tokens_used).toBe(0);
      expect(metrics.api_calls).toBe(0);
    });
  });

  describe('isPipelineStage', () => {
    it('should return true for valid stages', () => {
      expect(isPipelineStage('query_analysis')).toBe(true);
      expect(isPipelineStage('phase2_cognition')).toBe(true);
    });

    it('should return false for invalid stages', () => {
      expect(isPipelineStage('invalid')).toBe(false);
    });
  });

  describe('validateCognitionRequest', () => {
    it('should validate correct request', () => {
      const request: CognitionRequest = { question: 'test' };
      expect(validateCognitionRequest(request)).toBe(true);
    });

    it('should validate request with filters', () => {
      const request: CognitionRequest = {
        questions: ['Q1'],
        filters: { clusters: ['work'], node_types: ['note'] },
      };
      expect(validateCognitionRequest(request)).toBe(true);
    });
  });

  describe('validateCognitionMetrics', () => {
    it('should validate correct metrics', () => {
      const metrics = createEmptyMetrics();
      expect(validateCognitionMetrics(metrics)).toBe(true);
    });

    it('should reject negative values', () => {
      expect(validateCognitionMetrics({ total_duration_ms: -1 })).toBe(false);
    });
  });
});

// ============================================================================
// TYPE GUARDS TESTS
// ============================================================================

describe('Type Guards', () => {
  it('all type guards should return boolean', () => {
    expect(typeof isQueryType('factual')).toBe('boolean');
    expect(typeof isFallbackAction('simplify')).toBe('boolean');
    expect(typeof isAuthoritativeContentType('person')).toBe('boolean');
    expect(typeof isVerbosityLevel('minimal')).toBe('boolean');
    expect(typeof isSegmentType('answer')).toBe('boolean');
    expect(typeof isContentPriority('high')).toBe('boolean');
    expect(typeof isPrimarySignal('semantic')).toBe('boolean');
    expect(typeof isPhase2Status('completed')).toBe('boolean');
    expect(typeof isFallbackStrategy('simplify')).toBe('boolean');
    expect(typeof isAlternativeStrategy('title_only')).toBe('boolean');
    expect(typeof isPipelineStage('query_analysis')).toBe('boolean');
  });
});

// ============================================================================
// VALIDATION FUNCTIONS TESTS
// ============================================================================

describe('Validation Functions', () => {
  it('all validators should handle null/undefined', () => {
    expect(validateQueryTypeResult(null)).toBe(false);
    expect(validateQueryTypeResult(undefined)).toBe(false);
    expect(validateSufficiencyResult(null)).toBe(false);
    expect(validateVerbosityConfig(null)).toBe(false);
    expect(validateExtractedContent(null)).toBe(false);
    expect(validateWhyIncluded(null)).toBe(false);
    expect(validateRankingReason(null)).toBe(false);
    expect(validatePhase2Result(null)).toBe(false);
    expect(validateFallbackResult(null)).toBe(false);
    expect(validateCognitionRequest(null)).toBe(false);
    expect(validateCognitionMetrics(null)).toBe(false);
  });

  it('all validators should handle empty objects gracefully', () => {
    expect(validateQueryTypeResult({})).toBe(false);
    expect(validateSufficiencyResult({})).toBe(false);
    expect(validatePhase2Result({})).toBe(false);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  describe('Query Type to Sufficiency flow', () => {
    it('should work together for factual query', () => {
      const query = "What's Sarah's birthday?";
      const queryType = detectQueryType(query);

      expect(queryType.type).toBe('factual');

      const results: SearchResultForSufficiency[] = [
        { node_id: '1', score: 0.9, confidence: 'HIGH', node_type: 'person' },
      ];

      const sufficiency = checkResultSufficiency(results, query, queryType.type);
      expect(sufficiency.is_sufficient).toBe(true);
    });

    it('should work together for list query', () => {
      const query = 'What are all my tasks?';
      const queryType = detectQueryType(query);

      expect(queryType.type).toBe('list');

      const results: SearchResultForSufficiency[] = [
        { node_id: '1', score: 0.8, confidence: 'HIGH' },
        { node_id: '2', score: 0.7, confidence: 'HIGH' },
      ];

      const sufficiency = checkResultSufficiency(results, query, queryType.type);
      expect(sufficiency.is_sufficient).toBe(false); // Need 5+ results
    });
  });

  describe('Verbosity selection flow', () => {
    it('should select appropriate verbosity based on results', () => {
      const highConfidenceFactual = selectVerbosity(0.9, 'factual');
      expect(highConfidenceFactual).toBe('minimal');

      const lowConfidenceExploratory = selectVerbosity(0.3, 'exploratory');
      expect(lowConfidenceExploratory).toBe('verbose');
    });
  });

  describe('Fallback chain flow', () => {
    it('should progress through fallback chain', () => {
      const query = 'project alpha deadlines in Q1';
      const queryType = detectQueryType(query);
      const results: SearchResultForSufficiency[] = [];

      const sufficiency = checkResultSufficiency(results, query, queryType.type);
      expect(sufficiency.is_sufficient).toBe(false);
      expect(sufficiency.suggested_action).toBe('explain');

      // Try simplify
      const simplified = simplifyQuery(query);
      expect(simplified.simplified).not.toBe(query);

      // If still no results, generate explanation
      const explanation = generateMissingExplanation(query, queryType.type);
      expect(explanation.message).toContain(query);
    });
  });

  describe('Phase 2 prompt building flow', () => {
    it('should build complete prompts from results', () => {
      const nodes = [
        { id: 'N001', type: 'note', name: 'Project Plan', keyFact: 'Contains timeline' },
        { id: 'N002', type: 'note', name: 'Meeting Notes', keyFact: 'Deadline discussion' },
      ];

      const conceptMap = nodes.map(formatCompressedNode).join('\n');
      const orientPrompt = buildOrientPrompt({
        query: 'What are the deadlines?',
        compressed_concept_map: conceptMap,
      });

      expect(orientPrompt).toContain('What are the deadlines?');
      expect(orientPrompt).toContain('N001');
      expect(orientPrompt).toContain('N002');
    });
  });
});
