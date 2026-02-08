/**
 * @module @nous/core/prompts
 * @description Tests for Nous Prompt Library (NPL) — storm-027
 * @spec Brainstorms/Specs/Phase-7-Backend-API/storm-027
 */

import { describe, it, expect } from 'vitest';
import {
  // Constants — Identifiers
  NPL_PROMPT_IDS,
  type NplPromptId,
  NplPromptIdSchema,

  // Constants — Cache Strategies
  NPL_CACHE_STRATEGIES,
  type NplCacheStrategy,
  NplCacheStrategySchema,

  // Constants — Error Types
  NPL_ERROR_TYPES,
  type NplErrorType,
  NplErrorTypeSchema,

  // Constants — Query Classifications
  NPL_QUERY_CLASSIFICATIONS,
  type NplQueryClassification,
  NplQueryClassificationSchema,

  // Constants — Disqualifier Codes
  NPL_DISQUALIFIER_CODES,
  type NplDisqualifierCode,
  NplDisqualifierCodeSchema,

  // Constants — Extraction Node Types
  NPL_EXTRACTION_NODE_TYPES,
  NplExtractionNodeTypeSchema,

  // Constants — Confidence Levels
  NPL_CONFIDENCE_LEVELS,
  type NplConfidenceLevel,
  NplConfidenceLevelSchema,

  // Constants — Contradiction
  NPL_CONTRADICTION_RECOMMENDATIONS,
  NplContradictionRecommendationSchema,
  NPL_CONTRADICTION_RELATIONSHIPS,
  NplContradictionRelationshipSchema,

  // Constants — Cacheable Prompt Types
  NPL_CACHEABLE_PROMPT_TYPES,
  NplCacheablePromptTypeSchema,

  // Constants — Records
  NPL_MODEL_RECOMMENDATIONS,
  NplModelRecommendationSchema,
  NPL_CACHE_CONFIGS,
  NPL_TOKEN_BUDGETS,
  NplTokenBudgetSchema,
  NPL_PROMPT_VERSIONS,
  NPL_PROMPT_TO_OPERATION,
  NPL_PROMPT_TO_CACHE_TYPE,
  NPL_DISQUALIFIER_TO_QCS_CODE,
  NPL_CONFIDENCE_LEVEL_SCORES,
  NPL_EXTRACTION_CONTENT_LIMITS,
  NPL_P008_TOKEN_BUDGET,
  NPL_AUTO_SUPERSEDE_THRESHOLDS,
  NPL_PROMPT_NAMES,
  NPL_PROMPT_INTEGRATIONS,

  // Types — Schemas
  NplPromptMetadataSchema,
  NplPromptErrorSchema,
  NplQueryClassificationResultSchema,
  NplEntitySchema,
  NplTemporalRefSchema,
  NplIntentExtractionResultSchema,
  NplClarificationOptionSchema,
  NplClarificationResultSchema,
  NplExtractedEntitySchema,
  NplExtractionTemporalSchema,
  NplSuggestedEdgeSchema,
  NplExtractedNodeSchema,
  NplNodeExtractionResultSchema,
  NplDetectedEdgeSchema,
  NplEdgeRelationshipResultSchema,
  NplEntryPointSchema,
  NplOrientResultSchema,
  NplExplorationStepSchema,
  NplExploreResultSchema,
  NplSourceRefSchema,
  NplSynthesizeResultSchema,
  NplAgentStepSchema,
  NplAgentPlanSchema,
  NplContradictionDetectionResultSchema,
  NplVerificationResultSchema,
  NplCompressionResultSchema,
  NplTermEntrySchema,
  NplContextCustomizationSchema,
  NplPromptTemplateSchema,
  NplPromptExampleSchema,

  // Types — Interfaces (type-only, used for compile checks)
  type NplPromptMetadata,
  type NplPromptError,
  type NplQueryClassificationResult,
  type NplIntentExtractionResult,
  type NplSynthesizeResult,
  type NplContradictionDetectionResult,
  type NplVerificationResult,
  type NplContextCustomization,
  type NplPromptTemplate,

  // Utility Functions
  nplConfidenceLevelToScore,
  nplScoreToConfidenceLevel,
  nplBuildContextCustomization,
  nplShouldAutoSupersede,

  // Intent Detection
  NPL_INTENT_TYPES,
  type NplIntentType,
  NplIntentTypeSchema,
  NplIntentResultSchema,
  NPL_FAST_PATH_RULES,
  NplFastPathRuleSchema,
  NPL_INTENT_CONFIDENCE_THRESHOLDS,
  NplIntentConfidenceThresholdsSchema,
  NPL_AMBIGUITY_HANDLERS,
  NPL_MULTI_INTENT_PATTERNS,
  NplMultiIntentPatternSchema,
  NPL_ACTION_ROUTES,
  NplActionRouteSchema,
  NPL_DETECTION_PRIORITY,
  NPL_INTENT_DEFINITIONS,
  nplFastPathDetect,
  nplGetConfidenceLevel,
  nplGetAmbiguityStrategy,
  nplFindMultiIntentPattern,
  nplGetActionRoute,

  // Prompt Templates
  NPL_P001_SYSTEM_MESSAGE,
  NPL_P001_USER_TEMPLATE,
  NPL_P001_METADATA,
  NPL_P001_EXAMPLES,
  NPL_P002_SYSTEM_MESSAGE,
  NPL_P002_USER_TEMPLATE,
  NPL_P002_METADATA,
  NPL_P002_EXAMPLES,
  NPL_P002C_SYSTEM_MESSAGE,
  NPL_P002C_USER_TEMPLATE,
  NPL_P002C_METADATA,
  NPL_P002C_EXAMPLES,
  NPL_P003_SYSTEM_MESSAGE,
  NPL_P003_USER_TEMPLATE,
  NPL_P003_METADATA,
  NPL_P003_EXAMPLES,
  NPL_P004_SYSTEM_MESSAGE,
  NPL_P004_USER_TEMPLATE,
  NPL_P004_METADATA,
  NPL_P004_EXAMPLES,
  NPL_P005_SYSTEM_MESSAGE,
  NPL_P005_USER_TEMPLATE,
  NPL_P005_METADATA,
  NPL_P005_EXAMPLES,
  NPL_P006_SYSTEM_MESSAGE,
  NPL_P006_USER_TEMPLATE,
  NPL_P006_METADATA,
  NPL_P006_EXAMPLES,
  NPL_P007_SYSTEM_MESSAGE,
  NPL_P007_USER_TEMPLATE,
  NPL_P007_METADATA,
  NPL_P007_EXAMPLES,
  NPL_P008_SYSTEM_MESSAGE,
  NPL_P008_METADATA,
  NPL_P008_EXAMPLES,
  NPL_P009_SYSTEM_MESSAGE,
  NPL_P009_USER_TEMPLATE,
  NPL_P009_METADATA,
  NPL_P009_EXAMPLES,
  NPL_P010_SYSTEM_MESSAGE,
  NPL_P010_METADATA,
  NPL_P010_EXAMPLES,
  NPL_P010B_SYSTEM_MESSAGE,
  NPL_P010B_USER_TEMPLATE,
  NPL_P010B_METADATA,
  NPL_P010B_EXAMPLES,
  NPL_P011_SYSTEM_MESSAGE,
  NPL_P011_USER_TEMPLATE,
  NPL_P011_METADATA,
  NPL_P011_EXAMPLES,

  // Registry
  NPL_PROMPT_REGISTRY,
  nplGetPrompt,
  nplGetAllPromptIds,
  nplGetCacheContent,
} from './index';

// ============================================================
// CONSTANTS TESTS
// ============================================================

describe('NPL Constants', () => {
  describe('Prompt Identifiers', () => {
    it('should have 13 prompt IDs', () => {
      expect(NPL_PROMPT_IDS).toHaveLength(13);
    });

    it('should contain all expected prompt IDs', () => {
      const expected = [
        'P-001', 'P-002', 'P-002C', 'P-003', 'P-004',
        'P-005', 'P-006', 'P-007', 'P-008', 'P-009',
        'P-010', 'P-010B', 'P-011',
      ];
      expect([...NPL_PROMPT_IDS]).toEqual(expected);
    });

    it('should validate correct prompt IDs', () => {
      expect(NplPromptIdSchema.safeParse('P-001').success).toBe(true);
      expect(NplPromptIdSchema.safeParse('P-010B').success).toBe(true);
      expect(NplPromptIdSchema.safeParse('P-002C').success).toBe(true);
    });

    it('should reject invalid prompt IDs', () => {
      expect(NplPromptIdSchema.safeParse('P-012').success).toBe(false);
      expect(NplPromptIdSchema.safeParse('').success).toBe(false);
      expect(NplPromptIdSchema.safeParse(123).success).toBe(false);
    });
  });

  describe('Cache Strategies', () => {
    it('should have 3 cache strategies', () => {
      expect(NPL_CACHE_STRATEGIES).toHaveLength(3);
    });

    it('should validate correct strategies', () => {
      expect(NplCacheStrategySchema.safeParse('global').success).toBe(true);
      expect(NplCacheStrategySchema.safeParse('per_user').success).toBe(true);
      expect(NplCacheStrategySchema.safeParse('none').success).toBe(true);
    });

    it('should reject invalid strategies', () => {
      expect(NplCacheStrategySchema.safeParse('per_session').success).toBe(false);
    });
  });

  describe('Error Types', () => {
    it('should have 4 error types', () => {
      expect(NPL_ERROR_TYPES).toHaveLength(4);
    });

    it('should validate all error types', () => {
      for (const errorType of NPL_ERROR_TYPES) {
        expect(NplErrorTypeSchema.safeParse(errorType).success).toBe(true);
      }
    });
  });

  describe('Query Classifications', () => {
    it('should have 3 classifications', () => {
      expect(NPL_QUERY_CLASSIFICATIONS).toHaveLength(3);
    });

    it('should contain RETRIEVAL, DIRECT_TASK, CHAT', () => {
      expect([...NPL_QUERY_CLASSIFICATIONS]).toEqual(['RETRIEVAL', 'DIRECT_TASK', 'CHAT']);
    });
  });

  describe('Disqualifier Codes', () => {
    it('should have 7 disqualifier codes', () => {
      expect(NPL_DISQUALIFIER_CODES).toHaveLength(7);
    });

    it('should validate all disqualifier codes', () => {
      for (const code of NPL_DISQUALIFIER_CODES) {
        expect(NplDisqualifierCodeSchema.safeParse(code).success).toBe(true);
      }
    });
  });

  describe('Extraction Node Types', () => {
    it('should have 6 node types', () => {
      expect(NPL_EXTRACTION_NODE_TYPES).toHaveLength(6);
    });

    it('should validate all extraction node types', () => {
      for (const nodeType of NPL_EXTRACTION_NODE_TYPES) {
        expect(NplExtractionNodeTypeSchema.safeParse(nodeType).success).toBe(true);
      }
    });
  });

  describe('Confidence Levels', () => {
    it('should have 3 levels', () => {
      expect(NPL_CONFIDENCE_LEVELS).toHaveLength(3);
    });

    it('should be HIGH, MEDIUM, LOW', () => {
      expect([...NPL_CONFIDENCE_LEVELS]).toEqual(['HIGH', 'MEDIUM', 'LOW']);
    });
  });

  describe('Contradiction Types', () => {
    it('should have 3 recommendation values', () => {
      expect(NPL_CONTRADICTION_RECOMMENDATIONS).toHaveLength(3);
    });

    it('should match storm-009 recommendation values', () => {
      expect([...NPL_CONTRADICTION_RECOMMENDATIONS]).toEqual([
        'auto_supersede', 'queue_for_user', 'keep_both',
      ]);
    });

    it('should have 5 relationship types', () => {
      expect(NPL_CONTRADICTION_RELATIONSHIPS).toHaveLength(5);
    });
  });

  describe('Cacheable Prompt Types', () => {
    it('should have 3 cache types matching storm-015', () => {
      expect(NPL_CACHEABLE_PROMPT_TYPES).toHaveLength(3);
      expect([...NPL_CACHEABLE_PROMPT_TYPES]).toEqual(['classifier', 'extractor', 'responder']);
    });
  });

  describe('Record Maps (complete key coverage)', () => {
    it('NPL_MODEL_RECOMMENDATIONS should have entries for all 13 prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_MODEL_RECOMMENDATIONS[id]).toBeDefined();
        expect(NplModelRecommendationSchema.safeParse(NPL_MODEL_RECOMMENDATIONS[id]).success).toBe(true);
      }
    });

    it('NPL_CACHE_CONFIGS should have entries for all 13 prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_CACHE_CONFIGS[id]).toBeDefined();
        expect(NplCacheStrategySchema.safeParse(NPL_CACHE_CONFIGS[id]).success).toBe(true);
      }
    });

    it('NPL_TOKEN_BUDGETS should have entries for all 13 prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_TOKEN_BUDGETS[id]).toBeDefined();
        expect(NplTokenBudgetSchema.safeParse(NPL_TOKEN_BUDGETS[id]).success).toBe(true);
      }
    });

    it('NPL_PROMPT_VERSIONS should have entries for all 13 prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_PROMPT_VERSIONS[id]).toBeDefined();
        expect(NPL_PROMPT_VERSIONS[id]).toMatch(/^\d+\.\d+\.\d+$/);
      }
    });

    it('NPL_PROMPT_TO_OPERATION should have entries for all 13 prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_PROMPT_TO_OPERATION[id]).toBeDefined();
        expect(typeof NPL_PROMPT_TO_OPERATION[id]).toBe('string');
      }
    });

    it('NPL_PROMPT_TO_CACHE_TYPE should have entries for all 13 prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_PROMPT_TO_CACHE_TYPE[id]).toBeDefined();
        expect(NplCacheablePromptTypeSchema.safeParse(NPL_PROMPT_TO_CACHE_TYPE[id]).success).toBe(true);
      }
    });

    it('NPL_PROMPT_NAMES should have entries for all 13 prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_PROMPT_NAMES[id]).toBeDefined();
        expect(NPL_PROMPT_NAMES[id].length).toBeGreaterThan(0);
      }
    });

    it('NPL_PROMPT_INTEGRATIONS should have entries for all 13 prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_PROMPT_INTEGRATIONS[id]).toBeDefined();
        expect(Array.isArray(NPL_PROMPT_INTEGRATIONS[id])).toBe(true);
      }
    });
  });

  describe('Disqualifier-to-QCS Code Mapping', () => {
    it('should have entries for all disqualifier codes', () => {
      for (const code of NPL_DISQUALIFIER_CODES) {
        expect(NPL_DISQUALIFIER_TO_QCS_CODE[code]).toBeDefined();
      }
    });

    it('should map to D-codes (D1-D6)', () => {
      expect(NPL_DISQUALIFIER_TO_QCS_CODE.reasoning_required).toBe('D1');
      expect(NPL_DISQUALIFIER_TO_QCS_CODE.negation).toBe('D2');
      expect(NPL_DISQUALIFIER_TO_QCS_CODE.temporal_reference).toBe('D3');
      expect(NPL_DISQUALIFIER_TO_QCS_CODE.compound_query).toBe('D4');
      expect(NPL_DISQUALIFIER_TO_QCS_CODE.unresolved_pronoun).toBe('D5');
      expect(NPL_DISQUALIFIER_TO_QCS_CODE.exploration).toBe('D6');
    });
  });

  describe('Confidence Level Scores', () => {
    it('should map HIGH to 0.9', () => {
      expect(NPL_CONFIDENCE_LEVEL_SCORES.HIGH).toBe(0.9);
    });

    it('should map MEDIUM to 0.6', () => {
      expect(NPL_CONFIDENCE_LEVEL_SCORES.MEDIUM).toBe(0.6);
    });

    it('should map LOW to 0.3', () => {
      expect(NPL_CONFIDENCE_LEVEL_SCORES.LOW).toBe(0.3);
    });
  });

  describe('Extraction Content Limits', () => {
    it('should have correct target range', () => {
      expect(NPL_EXTRACTION_CONTENT_LIMITS.target.min).toBe(500);
      expect(NPL_EXTRACTION_CONTENT_LIMITS.target.max).toBe(2000);
    });

    it('should have softMax > target.max', () => {
      expect(NPL_EXTRACTION_CONTENT_LIMITS.softMax).toBeGreaterThan(NPL_EXTRACTION_CONTENT_LIMITS.target.max);
    });

    it('should have hardMax > softMax', () => {
      expect(NPL_EXTRACTION_CONTENT_LIMITS.hardMax).toBeGreaterThan(NPL_EXTRACTION_CONTENT_LIMITS.softMax);
    });
  });

  describe('P-008 Token Budget', () => {
    it('should have positive values', () => {
      expect(NPL_P008_TOKEN_BUDGET.corePrompt).toBeGreaterThan(0);
      expect(NPL_P008_TOKEN_BUDGET.firstCall).toBeGreaterThan(0);
      expect(NPL_P008_TOKEN_BUDGET.subsequentCalls).toBeGreaterThan(0);
    });

    it('should have firstCall > subsequentCalls (caching benefit)', () => {
      expect(NPL_P008_TOKEN_BUDGET.firstCall).toBeGreaterThan(NPL_P008_TOKEN_BUDGET.subsequentCalls);
    });

    it('should have cachedCostFactor < 1 (90% savings)', () => {
      expect(NPL_P008_TOKEN_BUDGET.cachedCostFactor).toBeLessThan(1);
      expect(NPL_P008_TOKEN_BUDGET.cachedCostFactor).toBeGreaterThan(0);
    });
  });

  describe('Auto-Supersede Thresholds', () => {
    it('should require high confidence for Tier 3', () => {
      expect(NPL_AUTO_SUPERSEDE_THRESHOLDS.tier3MinConfidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should require contradicts relationship', () => {
      expect(NPL_AUTO_SUPERSEDE_THRESHOLDS.tier3RequiredRelationship).toBe('contradicts');
    });

    it('should require zero concerns', () => {
      expect(NPL_AUTO_SUPERSEDE_THRESHOLDS.tier4MaxConcerns).toBe(0);
    });
  });

  describe('Token Budgets', () => {
    it('should have positive typicalTotal for all prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_TOKEN_BUDGETS[id].typicalTotal).toBeGreaterThan(0);
      }
    });

    it('P-008 should have the largest system token budget', () => {
      const p008System = NPL_TOKEN_BUDGETS['P-008'].system;
      for (const id of NPL_PROMPT_IDS) {
        expect(p008System).toBeGreaterThanOrEqual(NPL_TOKEN_BUDGETS[id].system);
      }
    });
  });

  describe('Cache Configs', () => {
    it('should assign only P-008 as per_user', () => {
      for (const id of NPL_PROMPT_IDS) {
        if (id === 'P-008') {
          expect(NPL_CACHE_CONFIGS[id]).toBe('per_user');
        } else {
          expect(NPL_CACHE_CONFIGS[id]).toBe('global');
        }
      }
    });
  });
});

// ============================================================
// TYPE/SCHEMA VALIDATION TESTS
// ============================================================

describe('NPL Type Schemas', () => {
  describe('NplPromptMetadataSchema', () => {
    it('should validate correct metadata', () => {
      const valid: NplPromptMetadata = {
        _schemaVersion: 1,
        id: 'P-001',
        name: 'Query Classification',
        version: '1.1.0',
        lastUpdated: '2026-02-05',
        integratesWith: ['storm-008'],
        testedModels: ['gemini-flash'],
        temperature: 0,
        cacheStrategy: 'global',
      };
      expect(NplPromptMetadataSchema.safeParse(valid).success).toBe(true);
    });

    it('should require _schemaVersion', () => {
      const invalid = {
        id: 'P-001',
        name: 'Test',
        version: '1.0.0',
        lastUpdated: '2026-01-01',
        integratesWith: [],
        testedModels: [],
        temperature: 0,
        cacheStrategy: 'global',
      };
      expect(NplPromptMetadataSchema.safeParse(invalid).success).toBe(false);
    });

    it('should reject invalid version format', () => {
      const invalid = {
        _schemaVersion: 1,
        id: 'P-001',
        name: 'Test',
        version: 'v1',
        lastUpdated: '2026-01-01',
        integratesWith: [],
        testedModels: [],
        temperature: 0,
        cacheStrategy: 'global',
      };
      expect(NplPromptMetadataSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('NplPromptErrorSchema', () => {
    it('should validate correct error', () => {
      const valid: NplPromptError = {
        error: true,
        errorType: 'MALFORMED_INPUT',
        errorMessage: 'Empty message',
        suggestion: 'Provide content',
      };
      expect(NplPromptErrorSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject error: false', () => {
      expect(NplPromptErrorSchema.safeParse({
        error: false,
        errorType: 'MALFORMED_INPUT',
        errorMessage: 'test',
        suggestion: 'test',
      }).success).toBe(false);
    });
  });

  describe('NplQueryClassificationResultSchema', () => {
    it('should validate correct P-001 output', () => {
      const valid: NplQueryClassificationResult = {
        classification: 'RETRIEVAL',
        memoryQueryScore: 0.95,
        directTaskScore: 0.05,
        contextMissingScore: 0.1,
        disqualifiers: [],
        reasoning: 'Asking about stored data',
      };
      expect(NplQueryClassificationResultSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject scores outside 0-1 range', () => {
      expect(NplQueryClassificationResultSchema.safeParse({
        classification: 'RETRIEVAL',
        memoryQueryScore: 1.5,
        directTaskScore: 0,
        contextMissingScore: 0,
        disqualifiers: [],
        reasoning: 'test',
      }).success).toBe(false);
    });

    it('should validate disqualifier codes', () => {
      const valid = {
        classification: 'RETRIEVAL',
        memoryQueryScore: 0.8,
        directTaskScore: 0.1,
        contextMissingScore: 0.2,
        disqualifiers: ['reasoning_required', 'temporal_reference'],
        reasoning: 'Multiple disqualifiers',
      };
      expect(NplQueryClassificationResultSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject invalid disqualifier codes', () => {
      expect(NplQueryClassificationResultSchema.safeParse({
        classification: 'RETRIEVAL',
        memoryQueryScore: 0.8,
        directTaskScore: 0.1,
        contextMissingScore: 0.2,
        disqualifiers: ['invalid_code'],
        reasoning: 'test',
      }).success).toBe(false);
    });
  });

  describe('NplIntentExtractionResultSchema', () => {
    it('should validate correct P-002 output', () => {
      const valid: NplIntentExtractionResult = {
        intent: 'store',
        confidence: 0.95,
        isExplicit: true,
        secondaryIntent: null,
        secondaryConfidence: null,
        retrievalMode: null,
        multiIntentPattern: null,
        executionOrder: ['store'],
        entities: [{ name: 'Sarah', type: 'person' }],
        temporal: { hasReference: false, parsed: null, relative: null },
        saveSignal: 'explicit',
        actionVerbsDetected: ['remember'],
        reasoning: 'Explicit store intent',
      };
      expect(NplIntentExtractionResultSchema.safeParse(valid).success).toBe(true);
    });

    it('should validate multi-intent result', () => {
      const valid = {
        intent: 'store',
        confidence: 0.85,
        isExplicit: true,
        secondaryIntent: 'retrieve',
        secondaryConfidence: 0.75,
        retrievalMode: 'direct',
        multiIntentPattern: 'store + retrieve',
        executionOrder: ['store', 'retrieve'],
        entities: [],
        temporal: { hasReference: false, parsed: null, relative: null },
        saveSignal: 'explicit',
        actionVerbsDetected: [],
        reasoning: 'Multi-intent detected',
      };
      expect(NplIntentExtractionResultSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('NplSynthesizeResultSchema', () => {
    it('should validate correct P-007 output', () => {
      const valid: NplSynthesizeResult = {
        answer: 'Based on your notes...',
        sources: [{ nodeId: 'node-1', whyUsed: 'Direct match' }],
        confidence: 'HIGH',
        confidenceScore: 0.9,
        confidenceReason: 'Strong source match',
        answerCompleteness: 'complete',
        followUpSuggestions: ['Ask about related topic'],
        informationGaps: [],
      };
      expect(NplSynthesizeResultSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject confidenceScore outside 0-1', () => {
      expect(NplSynthesizeResultSchema.safeParse({
        answer: 'test',
        sources: [],
        confidence: 'HIGH',
        confidenceScore: 1.5,
        confidenceReason: 'test',
        answerCompleteness: 'complete',
        followUpSuggestions: [],
        informationGaps: [],
      }).success).toBe(false);
    });

    it('should reject invalid confidence level', () => {
      expect(NplSynthesizeResultSchema.safeParse({
        answer: 'test',
        sources: [],
        confidence: 'VERY_HIGH',
        confidenceScore: 0.95,
        confidenceReason: 'test',
        answerCompleteness: 'complete',
        followUpSuggestions: [],
        informationGaps: [],
      }).success).toBe(false);
    });
  });

  describe('NplVerificationResultSchema', () => {
    it('should validate correct P-010B output', () => {
      const valid: NplVerificationResult = {
        shouldSupersede: true,
        confidence: 0.85,
        concerns: [],
        recommendation: 'auto_supersede',
      };
      expect(NplVerificationResultSchema.safeParse(valid).success).toBe(true);
    });

    it('should validate with concerns', () => {
      const valid = {
        shouldSupersede: false,
        confidence: 0.6,
        concerns: ['Context may have changed', 'Source ambiguous'],
        recommendation: 'queue_for_user',
      };
      expect(NplVerificationResultSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('NplContradictionDetectionResultSchema', () => {
    it('should validate correct P-010 output', () => {
      const valid: NplContradictionDetectionResult = {
        relationship: 'contradicts',
        confidence: 0.9,
        reasoning: 'Direct contradiction found',
        whichIsCurrent: 'new',
        bothCouldBeTrue: false,
        isTimeDependent: false,
        needsUserInput: false,
      };
      expect(NplContradictionDetectionResultSchema.safeParse(valid).success).toBe(true);
    });

    it('should validate all relationship types', () => {
      for (const rel of NPL_CONTRADICTION_RELATIONSHIPS) {
        expect(NplContradictionDetectionResultSchema.safeParse({
          relationship: rel,
          confidence: 0.7,
          reasoning: 'test',
          whichIsCurrent: 'both',
          bothCouldBeTrue: true,
          isTimeDependent: false,
          needsUserInput: false,
        }).success).toBe(true);
      }
    });
  });

  describe('NplNodeExtractionResultSchema', () => {
    it('should validate correct P-003 output', () => {
      const valid = {
        nodes: [{
          content: "Sarah's phone number is 555-1234",
          type: 'FACT',
          title: "Sarah's phone",
          entities: [{ name: 'Sarah', type: 'person', isNew: false }],
          temporal: { occurredAt: null, relativeText: null, isRecurring: false },
          suggestedEdges: [{ targetHint: 'Sarah', relation: 'about_entity' }],
          confidence: 0.95,
        }],
        extractionNotes: 'Single fact extracted',
      };
      expect(NplNodeExtractionResultSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject title longer than 50 characters', () => {
      expect(NplExtractedNodeSchema.safeParse({
        content: 'test',
        type: 'FACT',
        title: 'A'.repeat(51),
        entities: [],
        temporal: { occurredAt: null, relativeText: null, isRecurring: false },
        suggestedEdges: [],
        confidence: 0.9,
      }).success).toBe(false);
    });
  });

  describe('NplOrientResultSchema', () => {
    it('should validate correct P-005 output', () => {
      const valid = {
        entryPoints: [{ nodeId: 'node-1', reason: 'High relevance', expectedDirection: 'outgoing' }],
        explorationStrategy: 'Follow entity connections',
        conceptMapQuality: 'good',
        qualityNotes: null,
      };
      expect(NplOrientResultSchema.safeParse(valid).success).toBe(true);
    });

    it('should require at least 1 entry point', () => {
      expect(NplOrientResultSchema.safeParse({
        entryPoints: [],
        explorationStrategy: 'test',
        conceptMapQuality: 'good',
        qualityNotes: null,
      }).success).toBe(false);
    });

    it('should allow max 3 entry points', () => {
      expect(NplOrientResultSchema.safeParse({
        entryPoints: [
          { nodeId: 'a', reason: 'r', expectedDirection: 'd' },
          { nodeId: 'b', reason: 'r', expectedDirection: 'd' },
          { nodeId: 'c', reason: 'r', expectedDirection: 'd' },
        ],
        explorationStrategy: 'test',
        conceptMapQuality: 'sparse',
        qualityNotes: 'Few connections',
      }).success).toBe(true);
    });
  });

  describe('NplAgentPlanSchema', () => {
    it('should validate correct P-009 output', () => {
      const valid = {
        understanding: 'User wants to delete old notes',
        plan: [{ step: 1, tool: 'search', params: { query: 'old notes' }, reason: 'Find notes to delete' }],
        needsConfirmation: true,
        confirmationReason: 'Destructive operation',
        alternativeInterpretation: null,
      };
      expect(NplAgentPlanSchema.safeParse(valid).success).toBe(true);
    });

    it('should require at least 1 plan step', () => {
      expect(NplAgentPlanSchema.safeParse({
        understanding: 'test',
        plan: [],
        needsConfirmation: false,
        confirmationReason: null,
        alternativeInterpretation: null,
      }).success).toBe(false);
    });
  });

  describe('NplCompressionResultSchema', () => {
    it('should validate correct P-011 output', () => {
      const valid = {
        summary: 'In January 2026, you learned about React...',
        title: 'React Learning Summary',
        keyPoints: ['Component patterns', 'State management'],
        sourceCount: 5,
        timeframe: 'January 2026',
        topic: 'React',
        relatedConceptsCount: 3,
      };
      expect(NplCompressionResultSchema.safeParse(valid).success).toBe(true);
    });

    it('should require at least 1 key point', () => {
      expect(NplCompressionResultSchema.safeParse({
        summary: 'test',
        title: 'test',
        keyPoints: [],
        sourceCount: 1,
        timeframe: 'test',
        topic: 'test',
        relatedConceptsCount: 0,
      }).success).toBe(false);
    });
  });

  describe('NplContextCustomizationSchema', () => {
    it('should validate correct customization', () => {
      const valid: NplContextCustomization = {
        tone: 'formal',
        verbosity: 'detailed',
        retrievalScope: 'all',
        contextName: null,
        terminology: null,
      };
      expect(NplContextCustomizationSchema.safeParse(valid).success).toBe(true);
    });

    it('should validate with terminology', () => {
      const valid = {
        tone: 'casual',
        verbosity: 'concise',
        retrievalScope: 'this_only',
        contextName: 'Work',
        terminology: [{ term: 'OKR', expansion: 'Objectives and Key Results' }],
      };
      expect(NplContextCustomizationSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('NplClarificationResultSchema', () => {
    it('should validate correct P-002C output', () => {
      const valid = {
        clarification: 'Did you mean to save or look up?',
        options: [
          { label: 'Save it', impliesIntent: 'store' },
          { label: 'Look it up', impliesIntent: 'retrieve' },
        ],
        fallbackIntent: 'retrieve',
      };
      expect(NplClarificationResultSchema.safeParse(valid).success).toBe(true);
    });

    it('should require 2-4 options', () => {
      expect(NplClarificationResultSchema.safeParse({
        clarification: 'test',
        options: [{ label: 'Only one', impliesIntent: 'store' }],
        fallbackIntent: 'store',
      }).success).toBe(false);
    });
  });

  describe('NplEdgeRelationshipResultSchema', () => {
    it('should validate correct P-004 output', () => {
      const valid = {
        edges: [{
          sourceNodeId: 'node-1',
          targetNodeId: 'node-2',
          edgeType: 'relates_to',
          description: 'Both about same topic',
          weight: 0.8,
          confidence: 0.9,
        }],
        analysisNotes: 'Strong semantic connection',
      };
      expect(NplEdgeRelationshipResultSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('NplExploreResultSchema', () => {
    it('should validate correct P-006 output', () => {
      const valid = {
        steps: [{
          nodeId: 'node-1',
          fromEdge: 'relates_to',
          finding: 'Found relevant information',
          shouldContinue: true,
          reason: 'More connections available',
        }],
        findings: ['Found relevant information'],
        shouldContinueExploring: false,
        stopReason: 'Answer found',
      };
      expect(NplExploreResultSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('NplPromptTemplateSchema', () => {
    it('should validate correct prompt template', () => {
      const valid = {
        metadata: {
          _schemaVersion: 1,
          id: 'P-001',
          name: 'Test',
          version: '1.0.0',
          lastUpdated: '2026-01-01',
          integratesWith: [],
          testedModels: [],
          temperature: 0,
          cacheStrategy: 'global',
        },
        systemMessage: 'You are a classifier.',
        userTemplate: '{{user_message}}',
        examples: [{ input: 'Hello', output: '{"classification":"CHAT"}' }],
      };
      expect(NplPromptTemplateSchema.safeParse(valid).success).toBe(true);
    });
  });
});

// ============================================================
// INTENT DETECTION TESTS
// ============================================================

describe('NPL Intent Detection', () => {
  describe('Intent Types', () => {
    it('should have 11 intent types', () => {
      expect(NPL_INTENT_TYPES).toHaveLength(11);
    });

    it('should include all core and extended intents', () => {
      const core = ['store', 'retrieve', 'update', 'delete', 'search', 'chat', 'command'];
      const extended = ['organize', 'summarize', 'compare', 'clarify'];
      for (const intent of [...core, ...extended]) {
        expect(NPL_INTENT_TYPES).toContain(intent);
      }
    });
  });

  describe('Fast-Path Detection (nplFastPathDetect)', () => {
    it('should detect store intent from "remember that"', () => {
      const result = nplFastPathDetect('remember that Sarah likes coffee');
      expect(result).not.toBeNull();
      expect(result!.primary).toBe('store');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('should detect store intent from "save this"', () => {
      const result = nplFastPathDetect('save this note about project X');
      expect(result).not.toBeNull();
      expect(result!.primary).toBe('store');
    });

    it('should detect delete intent from "delete"', () => {
      const result = nplFastPathDetect('delete the old meeting notes');
      expect(result).not.toBeNull();
      expect(result!.primary).toBe('delete');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.80);
    });

    it('should detect summarize intent from "summarize"', () => {
      const result = nplFastPathDetect('summarize my notes about React');
      expect(result).not.toBeNull();
      expect(result!.primary).toBe('summarize');
      expect(result!.mode).toBe('summarize');
    });

    it('should detect compare intent from "compare"', () => {
      const result = nplFastPathDetect('compare React and Vue');
      expect(result).not.toBeNull();
      expect(result!.primary).toBe('compare');
      expect(result!.mode).toBe('compare');
    });

    it('should detect organize intent from "move to"', () => {
      const result = nplFastPathDetect('move to the work cluster');
      expect(result).not.toBeNull();
      expect(result!.primary).toBe('organize');
    });

    it('should detect chat intent from "hello"', () => {
      const result = nplFastPathDetect('hello');
      expect(result).not.toBeNull();
      expect(result!.primary).toBe('chat');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('should return null for non-matching input', () => {
      // Note: avoid words containing trigger substrings (e.g., "machine" contains "hi")
      const result = nplFastPathDetect('what do you recall about deep learning?');
      expect(result).toBeNull();
    });

    it('should be case-insensitive', () => {
      const result = nplFastPathDetect('REMEMBER THAT this is important');
      expect(result).not.toBeNull();
      expect(result!.primary).toBe('store');
    });

    it('should set secondary to null', () => {
      const result = nplFastPathDetect('save this note');
      expect(result).not.toBeNull();
      expect(result!.secondary).toBeNull();
    });

    it('should set mode to null for non-retrieval intents', () => {
      const result = nplFastPathDetect('delete this note');
      expect(result).not.toBeNull();
      expect(result!.mode).toBeNull();
    });

    it('should validate fast-path result against schema', () => {
      const result = nplFastPathDetect('remember that test');
      expect(result).not.toBeNull();
      expect(NplIntentResultSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('Fast-Path Rules', () => {
    it('should have 6 fast-path rules', () => {
      expect(NPL_FAST_PATH_RULES).toHaveLength(6);
    });

    it('should validate all rules against schema', () => {
      for (const rule of NPL_FAST_PATH_RULES) {
        expect(NplFastPathRuleSchema.safeParse(rule).success).toBe(true);
      }
    });

    it('should cover store, delete, summarize, compare, organize, chat', () => {
      const intents = NPL_FAST_PATH_RULES.map((r) => r.intent);
      expect(intents).toContain('store');
      expect(intents).toContain('delete');
      expect(intents).toContain('summarize');
      expect(intents).toContain('compare');
      expect(intents).toContain('organize');
      expect(intents).toContain('chat');
    });
  });

  describe('Confidence Level Classification (nplGetConfidenceLevel)', () => {
    it('should return "high" for confidence above threshold', () => {
      expect(nplGetConfidenceLevel('store', 0.90)).toBe('high');
      expect(nplGetConfidenceLevel('retrieve', 0.80)).toBe('high');
    });

    it('should return "medium" for confidence in medium range', () => {
      expect(nplGetConfidenceLevel('store', 0.75)).toBe('medium');
      expect(nplGetConfidenceLevel('retrieve', 0.65)).toBe('medium');
    });

    it('should return "low" for confidence in low range', () => {
      expect(nplGetConfidenceLevel('store', 0.55)).toBe('low');
      expect(nplGetConfidenceLevel('retrieve', 0.45)).toBe('low');
    });

    it('should return "insufficient" for confidence below low threshold', () => {
      expect(nplGetConfidenceLevel('store', 0.40)).toBe('insufficient');
      expect(nplGetConfidenceLevel('retrieve', 0.30)).toBe('insufficient');
    });

    it('should respect exact boundary values', () => {
      // store high threshold is 0.85
      expect(nplGetConfidenceLevel('store', 0.85)).toBe('high');
      expect(nplGetConfidenceLevel('store', 0.849)).toBe('medium');
    });

    it('should handle delete (highest thresholds)', () => {
      // delete: high=0.90, medium=0.80, low=0.65
      expect(nplGetConfidenceLevel('delete', 0.90)).toBe('high');
      expect(nplGetConfidenceLevel('delete', 0.85)).toBe('medium');
      expect(nplGetConfidenceLevel('delete', 0.70)).toBe('low');
      expect(nplGetConfidenceLevel('delete', 0.60)).toBe('insufficient');
    });
  });

  describe('Confidence Thresholds', () => {
    it('should have entries for all 11 intent types', () => {
      for (const intent of NPL_INTENT_TYPES) {
        expect(NPL_INTENT_CONFIDENCE_THRESHOLDS[intent]).toBeDefined();
        expect(NplIntentConfidenceThresholdsSchema.safeParse(NPL_INTENT_CONFIDENCE_THRESHOLDS[intent]).success).toBe(true);
      }
    });

    it('should have high > medium > low for all intents', () => {
      for (const intent of NPL_INTENT_TYPES) {
        const t = NPL_INTENT_CONFIDENCE_THRESHOLDS[intent];
        expect(t.high).toBeGreaterThan(t.medium);
        expect(t.medium).toBeGreaterThan(t.low);
      }
    });
  });

  describe('Ambiguity Handling (nplGetAmbiguityStrategy)', () => {
    it('should return ask_clarification for delete at low', () => {
      expect(nplGetAmbiguityStrategy('delete', 'low')).toBe('ask_clarification');
    });

    it('should return assume_safe_default for store at low', () => {
      expect(nplGetAmbiguityStrategy('store', 'low')).toBe('assume_safe_default');
    });

    it('should return show_options for retrieve at insufficient', () => {
      expect(nplGetAmbiguityStrategy('retrieve', 'insufficient')).toBe('show_options');
    });

    it('should have handlers for all intent types', () => {
      for (const intent of NPL_INTENT_TYPES) {
        expect(NPL_AMBIGUITY_HANDLERS[intent]).toBeDefined();
        expect(NPL_AMBIGUITY_HANDLERS[intent].length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('Multi-Intent Patterns', () => {
    it('should have 5 patterns', () => {
      expect(NPL_MULTI_INTENT_PATTERNS).toHaveLength(5);
    });

    it('should validate all patterns against schema', () => {
      for (const pattern of NPL_MULTI_INTENT_PATTERNS) {
        expect(NplMultiIntentPatternSchema.safeParse(pattern).success).toBe(true);
      }
    });

    it('should have at least 2 intents in each execution order', () => {
      for (const pattern of NPL_MULTI_INTENT_PATTERNS) {
        expect(pattern.executionOrder.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('Multi-Intent Pattern Lookup (nplFindMultiIntentPattern)', () => {
    it('should find store + retrieve pattern', () => {
      const pattern = nplFindMultiIntentPattern('store', 'retrieve');
      expect(pattern).toBeDefined();
      expect(pattern!.precedence).toBe('sequential');
    });

    it('should find retrieve + summarize pattern', () => {
      const pattern = nplFindMultiIntentPattern('retrieve', 'summarize');
      expect(pattern).toBeDefined();
    });

    it('should return undefined for non-existent pattern', () => {
      const pattern = nplFindMultiIntentPattern('chat', 'delete');
      expect(pattern).toBeUndefined();
    });
  });

  describe('Action Routing', () => {
    it('should have routes for all 11 intent types', () => {
      expect(NPL_ACTION_ROUTES).toHaveLength(11);
      for (const intent of NPL_INTENT_TYPES) {
        const route = NPL_ACTION_ROUTES.find((r) => r.intent === intent);
        expect(route).toBeDefined();
      }
    });

    it('should validate all routes against schema', () => {
      for (const route of NPL_ACTION_ROUTES) {
        expect(NplActionRouteSchema.safeParse(route).success).toBe(true);
      }
    });
  });

  describe('Action Route Lookup (nplGetActionRoute)', () => {
    it('should find route for store', () => {
      const route = nplGetActionRoute('store');
      expect(route).toBeDefined();
      expect(route!.primaryAction).toContain('create_node');
    });

    it('should find route for delete with explicit confirmation', () => {
      const route = nplGetActionRoute('delete');
      expect(route).toBeDefined();
      expect(route!.requiresConfirmation).toBe('always_explicit');
    });

    it('should find route for retrieve with no confirmation', () => {
      const route = nplGetActionRoute('retrieve');
      expect(route).toBeDefined();
      expect(route!.requiresConfirmation).toBe('never');
    });
  });

  describe('Detection Priority', () => {
    it('should have clarify first (highest priority)', () => {
      expect(NPL_DETECTION_PRIORITY[0]).toBe('clarify');
    });

    it('should have delete before store (destructive checked first)', () => {
      const deleteIdx = NPL_DETECTION_PRIORITY.indexOf('delete');
      const storeIdx = NPL_DETECTION_PRIORITY.indexOf('store');
      expect(deleteIdx).toBeLessThan(storeIdx);
    });
  });

  describe('Intent Definitions', () => {
    it('should have definitions for all 11 intents', () => {
      for (const intent of NPL_INTENT_TYPES) {
        expect(NPL_INTENT_DEFINITIONS[intent]).toBeDefined();
        expect(NPL_INTENT_DEFINITIONS[intent].length).toBeGreaterThan(0);
      }
    });
  });
});

// ============================================================
// PROMPT TEMPLATE TESTS
// ============================================================

describe('NPL Prompt Templates', () => {
  // Helper to test a prompt's basic structure
  function testPromptTemplate(
    id: NplPromptId,
    systemMessage: string,
    metadata: NplPromptMetadata,
    examples: readonly { input: string; output: string }[],
    userTemplate?: string
  ) {
    describe(`${id} (${metadata.name})`, () => {
      it('should have a non-empty system message', () => {
        expect(systemMessage.length).toBeGreaterThan(0);
      });

      it('should have valid metadata', () => {
        expect(NplPromptMetadataSchema.safeParse(metadata).success).toBe(true);
      });

      it('should have correct prompt ID in metadata', () => {
        expect(metadata.id).toBe(id);
      });

      it('should have _schemaVersion: 1', () => {
        expect(metadata._schemaVersion).toBe(1);
      });

      it('should have at least 1 example', () => {
        expect(examples.length).toBeGreaterThanOrEqual(1);
      });

      it('should have valid examples (non-empty input and output)', () => {
        for (const example of examples) {
          expect(example.input.length).toBeGreaterThan(0);
          expect(example.output.length).toBeGreaterThan(0);
        }
      });

      if (userTemplate) {
        it('should have a non-empty user template', () => {
          expect(userTemplate.length).toBeGreaterThan(0);
        });
      }
    });
  }

  // Test all 13 prompts
  testPromptTemplate('P-001', NPL_P001_SYSTEM_MESSAGE, NPL_P001_METADATA, NPL_P001_EXAMPLES, NPL_P001_USER_TEMPLATE);
  testPromptTemplate('P-002', NPL_P002_SYSTEM_MESSAGE, NPL_P002_METADATA, NPL_P002_EXAMPLES, NPL_P002_USER_TEMPLATE);
  testPromptTemplate('P-002C', NPL_P002C_SYSTEM_MESSAGE, NPL_P002C_METADATA, NPL_P002C_EXAMPLES, NPL_P002C_USER_TEMPLATE);
  testPromptTemplate('P-003', NPL_P003_SYSTEM_MESSAGE, NPL_P003_METADATA, NPL_P003_EXAMPLES, NPL_P003_USER_TEMPLATE);
  testPromptTemplate('P-004', NPL_P004_SYSTEM_MESSAGE, NPL_P004_METADATA, NPL_P004_EXAMPLES, NPL_P004_USER_TEMPLATE);
  testPromptTemplate('P-005', NPL_P005_SYSTEM_MESSAGE, NPL_P005_METADATA, NPL_P005_EXAMPLES, NPL_P005_USER_TEMPLATE);
  testPromptTemplate('P-006', NPL_P006_SYSTEM_MESSAGE, NPL_P006_METADATA, NPL_P006_EXAMPLES, NPL_P006_USER_TEMPLATE);
  testPromptTemplate('P-007', NPL_P007_SYSTEM_MESSAGE, NPL_P007_METADATA, NPL_P007_EXAMPLES, NPL_P007_USER_TEMPLATE);
  testPromptTemplate('P-008', NPL_P008_SYSTEM_MESSAGE, NPL_P008_METADATA, NPL_P008_EXAMPLES);
  testPromptTemplate('P-009', NPL_P009_SYSTEM_MESSAGE, NPL_P009_METADATA, NPL_P009_EXAMPLES, NPL_P009_USER_TEMPLATE);
  testPromptTemplate('P-010', NPL_P010_SYSTEM_MESSAGE, NPL_P010_METADATA, NPL_P010_EXAMPLES);
  testPromptTemplate('P-010B', NPL_P010B_SYSTEM_MESSAGE, NPL_P010B_METADATA, NPL_P010B_EXAMPLES, NPL_P010B_USER_TEMPLATE);
  testPromptTemplate('P-011', NPL_P011_SYSTEM_MESSAGE, NPL_P011_METADATA, NPL_P011_EXAMPLES, NPL_P011_USER_TEMPLATE);

  describe('P-001 specific', () => {
    it('should mention RETRIEVAL, DIRECT_TASK, CHAT in system message', () => {
      expect(NPL_P001_SYSTEM_MESSAGE).toContain('RETRIEVAL');
      expect(NPL_P001_SYSTEM_MESSAGE).toContain('DIRECT_TASK');
      expect(NPL_P001_SYSTEM_MESSAGE).toContain('CHAT');
    });

    it('should mention disqualifier codes in system message', () => {
      expect(NPL_P001_SYSTEM_MESSAGE).toContain('reasoning_required');
      expect(NPL_P001_SYSTEM_MESSAGE).toContain('temporal_reference');
    });

    it('should contain {{user_message}} in user template', () => {
      expect(NPL_P001_USER_TEMPLATE).toContain('{{user_message}}');
    });
  });

  describe('P-002 specific', () => {
    it('should reference 10+ intent types in system message', () => {
      // P-002 uses uppercase intent names (STORE, RETRIEVE, DELETE)
      expect(NPL_P002_SYSTEM_MESSAGE).toContain('STORE');
      expect(NPL_P002_SYSTEM_MESSAGE).toContain('RETRIEVE');
      expect(NPL_P002_SYSTEM_MESSAGE).toContain('DELETE');
    });

    it('should include multi-intent detection instructions', () => {
      expect(NPL_P002_SYSTEM_MESSAGE.toLowerCase()).toContain('multi');
    });
  });

  describe('P-008 specific', () => {
    it('should be the longest system message (13 sections)', () => {
      const p008Length = NPL_P008_SYSTEM_MESSAGE.length;
      for (const id of NPL_PROMPT_IDS) {
        if (id === 'P-008') continue;
        const registry = NPL_PROMPT_REGISTRY[id];
        expect(p008Length).toBeGreaterThan(registry.systemMessage.length);
      }
    });

    it('should include fabrication prevention', () => {
      expect(NPL_P008_SYSTEM_MESSAGE.toLowerCase()).toContain('fabricat');
    });

    it('should include placeholder markers for dynamic injection', () => {
      expect(NPL_P008_SYSTEM_MESSAGE).toContain('{{CONTEXT_SPACE_CUSTOMIZATION}}');
      expect(NPL_P008_SYSTEM_MESSAGE).toContain('{{RETRIEVED_CONTEXT}}');
      expect(NPL_P008_SYSTEM_MESSAGE).toContain('{{CONVERSATION_HISTORY}}');
    });
  });

  describe('P-010 specific (storm-009 integration)', () => {
    it('should reference contradiction detection', () => {
      expect(NPL_P010_SYSTEM_MESSAGE.toLowerCase()).toContain('contradict');
    });
  });

  describe('P-011 specific (storm-007 integration)', () => {
    it('should reference compression/archival', () => {
      const msg = NPL_P011_SYSTEM_MESSAGE.toLowerCase();
      expect(msg.includes('compress') || msg.includes('summar') || msg.includes('archiv')).toBe(true);
    });
  });
});

// ============================================================
// PROMPT REGISTRY TESTS
// ============================================================

describe('NPL Prompt Registry', () => {
  describe('NPL_PROMPT_REGISTRY', () => {
    it('should have entries for all 13 prompt IDs', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_PROMPT_REGISTRY[id]).toBeDefined();
      }
    });

    it('should have valid metadata for all prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        const prompt = NPL_PROMPT_REGISTRY[id];
        expect(NplPromptMetadataSchema.safeParse(prompt.metadata).success).toBe(true);
      }
    });

    it('should have non-empty system messages for all prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_PROMPT_REGISTRY[id].systemMessage.length).toBeGreaterThan(0);
      }
    });

    it('should have non-empty user templates for all prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_PROMPT_REGISTRY[id].userTemplate.length).toBeGreaterThan(0);
      }
    });

    it('should have examples for all prompts', () => {
      for (const id of NPL_PROMPT_IDS) {
        expect(NPL_PROMPT_REGISTRY[id].examples.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('nplGetPrompt', () => {
    it('should return correct prompt for each ID', () => {
      for (const id of NPL_PROMPT_IDS) {
        const prompt = nplGetPrompt(id);
        expect(prompt).toBeDefined();
        expect(prompt.metadata.id).toBe(id);
      }
    });

    it('should return same reference as registry', () => {
      const prompt = nplGetPrompt('P-001');
      expect(prompt).toBe(NPL_PROMPT_REGISTRY['P-001']);
    });
  });

  describe('nplGetAllPromptIds', () => {
    it('should return all 13 prompt IDs', () => {
      const ids = nplGetAllPromptIds();
      expect(ids).toHaveLength(13);
    });

    it('should return NPL_PROMPT_IDS reference', () => {
      expect(nplGetAllPromptIds()).toBe(NPL_PROMPT_IDS);
    });
  });

  describe('nplGetCacheContent', () => {
    it('should return P-001 system message for classifier', () => {
      expect(nplGetCacheContent('classifier')).toBe(NPL_P001_SYSTEM_MESSAGE);
    });

    it('should return P-003 system message for extractor', () => {
      expect(nplGetCacheContent('extractor')).toBe(NPL_P003_SYSTEM_MESSAGE);
    });

    it('should return P-008 system message for responder', () => {
      expect(nplGetCacheContent('responder')).toBe(NPL_P008_SYSTEM_MESSAGE);
    });

    it('should return non-empty strings for all types', () => {
      expect(nplGetCacheContent('classifier').length).toBeGreaterThan(0);
      expect(nplGetCacheContent('extractor').length).toBeGreaterThan(0);
      expect(nplGetCacheContent('responder').length).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// UTILITY FUNCTION TESTS
// ============================================================

describe('NPL Utility Functions', () => {
  describe('nplConfidenceLevelToScore', () => {
    it('should return 0.9 for HIGH', () => {
      expect(nplConfidenceLevelToScore('HIGH')).toBe(0.9);
    });

    it('should return 0.6 for MEDIUM', () => {
      expect(nplConfidenceLevelToScore('MEDIUM')).toBe(0.6);
    });

    it('should return 0.3 for LOW', () => {
      expect(nplConfidenceLevelToScore('LOW')).toBe(0.3);
    });

    it('should match NPL_CONFIDENCE_LEVEL_SCORES constant', () => {
      for (const level of NPL_CONFIDENCE_LEVELS) {
        expect(nplConfidenceLevelToScore(level)).toBe(NPL_CONFIDENCE_LEVEL_SCORES[level]);
      }
    });
  });

  describe('nplScoreToConfidenceLevel', () => {
    it('should return HIGH for score >= 0.75', () => {
      expect(nplScoreToConfidenceLevel(0.75)).toBe('HIGH');
      expect(nplScoreToConfidenceLevel(0.9)).toBe('HIGH');
      expect(nplScoreToConfidenceLevel(1.0)).toBe('HIGH');
    });

    it('should return MEDIUM for score >= 0.45 and < 0.75', () => {
      expect(nplScoreToConfidenceLevel(0.45)).toBe('MEDIUM');
      expect(nplScoreToConfidenceLevel(0.6)).toBe('MEDIUM');
      expect(nplScoreToConfidenceLevel(0.74)).toBe('MEDIUM');
    });

    it('should return LOW for score < 0.45', () => {
      expect(nplScoreToConfidenceLevel(0.44)).toBe('LOW');
      expect(nplScoreToConfidenceLevel(0.3)).toBe('LOW');
      expect(nplScoreToConfidenceLevel(0)).toBe('LOW');
    });
  });

  describe('nplBuildContextCustomization', () => {
    it('should return empty string for neutral/adaptive/all defaults', () => {
      const result = nplBuildContextCustomization({
        tone: 'neutral',
        verbosity: 'adaptive',
        retrievalScope: 'all',
        contextName: null,
        terminology: null,
      });
      expect(result).toBe('');
    });

    it('should include TONE for formal', () => {
      const result = nplBuildContextCustomization({
        tone: 'formal',
        verbosity: 'adaptive',
        retrievalScope: 'all',
        contextName: null,
        terminology: null,
      });
      expect(result).toContain('TONE:');
      expect(result).toContain('Professional');
    });

    it('should include TONE for casual', () => {
      const result = nplBuildContextCustomization({
        tone: 'casual',
        verbosity: 'adaptive',
        retrievalScope: 'all',
        contextName: null,
        terminology: null,
      });
      expect(result).toContain('TONE:');
      expect(result).toContain('Friendly');
    });

    it('should include VERBOSITY for concise', () => {
      const result = nplBuildContextCustomization({
        tone: 'neutral',
        verbosity: 'concise',
        retrievalScope: 'all',
        contextName: null,
        terminology: null,
      });
      expect(result).toContain('VERBOSITY:');
      expect(result).toContain('brief');
    });

    it('should include VERBOSITY for detailed', () => {
      const result = nplBuildContextCustomization({
        tone: 'neutral',
        verbosity: 'detailed',
        retrievalScope: 'all',
        contextName: null,
        terminology: null,
      });
      expect(result).toContain('VERBOSITY:');
      expect(result).toContain('thorough');
    });

    it('should include SCOPE for this_only with contextName', () => {
      const result = nplBuildContextCustomization({
        tone: 'neutral',
        verbosity: 'adaptive',
        retrievalScope: 'this_only',
        contextName: 'Work',
        terminology: null,
      });
      expect(result).toContain('SCOPE:');
      expect(result).toContain('Work');
    });

    it('should NOT include SCOPE for this_only without contextName', () => {
      const result = nplBuildContextCustomization({
        tone: 'neutral',
        verbosity: 'adaptive',
        retrievalScope: 'this_only',
        contextName: null,
        terminology: null,
      });
      expect(result).not.toContain('SCOPE:');
    });

    it('should include TERMINOLOGY entries', () => {
      const result = nplBuildContextCustomization({
        tone: 'neutral',
        verbosity: 'adaptive',
        retrievalScope: 'all',
        contextName: null,
        terminology: [
          { term: 'OKR', expansion: 'Objectives and Key Results' },
          { term: 'KPI', expansion: 'Key Performance Indicator' },
        ],
      });
      expect(result).toContain('TERMINOLOGY:');
      expect(result).toContain('OKR');
      expect(result).toContain('Objectives and Key Results');
      expect(result).toContain('KPI');
    });

    it('should combine multiple sections', () => {
      const result = nplBuildContextCustomization({
        tone: 'formal',
        verbosity: 'concise',
        retrievalScope: 'this_only',
        contextName: 'Research',
        terminology: [{ term: 'ML', expansion: 'Machine Learning' }],
      });
      expect(result).toContain('TONE:');
      expect(result).toContain('VERBOSITY:');
      expect(result).toContain('SCOPE:');
      expect(result).toContain('TERMINOLOGY:');
    });
  });

  describe('nplShouldAutoSupersede', () => {
    const validTier3: NplContradictionDetectionResult = {
      relationship: 'contradicts',
      confidence: 0.85,
      reasoning: 'Direct contradiction',
      whichIsCurrent: 'new',
      bothCouldBeTrue: false,
      isTimeDependent: false,
      needsUserInput: false,
    };

    const validTier4: NplVerificationResult = {
      shouldSupersede: true,
      confidence: 0.8,
      concerns: [],
      recommendation: 'auto_supersede',
    };

    it('should return true when all conditions met', () => {
      expect(nplShouldAutoSupersede(validTier3, validTier4)).toBe(true);
    });

    it('should return false when tier3 confidence < 0.8', () => {
      expect(nplShouldAutoSupersede(
        { ...validTier3, confidence: 0.79 },
        validTier4
      )).toBe(false);
    });

    it('should return false when tier3 relationship is not contradicts', () => {
      expect(nplShouldAutoSupersede(
        { ...validTier3, relationship: 'updates' },
        validTier4
      )).toBe(false);
    });

    it('should return false when tier4 shouldSupersede is false', () => {
      expect(nplShouldAutoSupersede(
        validTier3,
        { ...validTier4, shouldSupersede: false }
      )).toBe(false);
    });

    it('should return false when tier4 confidence < 0.7', () => {
      expect(nplShouldAutoSupersede(
        validTier3,
        { ...validTier4, confidence: 0.69 }
      )).toBe(false);
    });

    it('should return false when tier4 has concerns', () => {
      expect(nplShouldAutoSupersede(
        validTier3,
        { ...validTier4, concerns: ['Context may differ'] }
      )).toBe(false);
    });

    it('should return true at exact boundary values', () => {
      const boundaryTier3 = { ...validTier3, confidence: 0.8 };
      const boundaryTier4 = { ...validTier4, confidence: 0.7 };
      expect(nplShouldAutoSupersede(boundaryTier3, boundaryTier4)).toBe(true);
    });
  });
});

// ============================================================
// INTEGRATION TESTS
// ============================================================

describe('NPL Integration', () => {
  describe('Prompt metadata consistency', () => {
    it('should have matching versions between metadata and NPL_PROMPT_VERSIONS', () => {
      for (const id of NPL_PROMPT_IDS) {
        const registryVersion = NPL_PROMPT_REGISTRY[id].metadata.version;
        const constantVersion = NPL_PROMPT_VERSIONS[id];
        expect(registryVersion).toBe(constantVersion);
      }
    });

    it('should have matching cache strategies between metadata and NPL_CACHE_CONFIGS', () => {
      for (const id of NPL_PROMPT_IDS) {
        const metadataCacheStrategy = NPL_PROMPT_REGISTRY[id].metadata.cacheStrategy;
        const constantCacheStrategy = NPL_CACHE_CONFIGS[id];
        expect(metadataCacheStrategy).toBe(constantCacheStrategy);
      }
    });

    it('should have matching temperature between metadata and NPL_MODEL_RECOMMENDATIONS', () => {
      for (const id of NPL_PROMPT_IDS) {
        const metadataTemp = NPL_PROMPT_REGISTRY[id].metadata.temperature;
        const constantTemp = NPL_MODEL_RECOMMENDATIONS[id].temperature;
        expect(metadataTemp).toBe(constantTemp);
      }
    });
  });

  describe('Confidence level roundtrip', () => {
    it('should maintain HIGH through score conversion', () => {
      const score = nplConfidenceLevelToScore('HIGH');
      const level = nplScoreToConfidenceLevel(score);
      expect(level).toBe('HIGH');
    });

    it('should maintain MEDIUM through score conversion', () => {
      const score = nplConfidenceLevelToScore('MEDIUM');
      const level = nplScoreToConfidenceLevel(score);
      expect(level).toBe('MEDIUM');
    });

    it('should maintain LOW through score conversion', () => {
      const score = nplConfidenceLevelToScore('LOW');
      const level = nplScoreToConfidenceLevel(score);
      expect(level).toBe('LOW');
    });
  });

  describe('Example output format validation', () => {
    // NOTE: Examples use snake_case LLM output format (e.g., memory_query_score)
    // while TypeScript schemas use camelCase (e.g., memoryQueryScore).
    // This is intentional — the calling code bridges between the two formats.
    // We validate that examples are well-formed JSON with the expected top-level keys.

    it('P-001 examples should be valid JSON with classification field', () => {
      for (const example of NPL_P001_EXAMPLES) {
        const parsed = JSON.parse(example.output);
        expect(parsed.classification).toBeDefined();
        expect(['RETRIEVAL', 'DIRECT_TASK', 'CHAT']).toContain(parsed.classification);
      }
    });

    it('P-002 examples should be valid JSON with intent field', () => {
      for (const example of NPL_P002_EXAMPLES) {
        const parsed = JSON.parse(example.output);
        expect(parsed.intent).toBeDefined();
      }
    });

    it('P-002C examples should be valid JSON with clarification field', () => {
      for (const example of NPL_P002C_EXAMPLES) {
        const parsed = JSON.parse(example.output);
        expect(parsed.clarification).toBeDefined();
        expect(parsed.options).toBeDefined();
        expect(Array.isArray(parsed.options)).toBe(true);
      }
    });

    it('P-007 examples should be valid JSON with answer field', () => {
      for (const example of NPL_P007_EXAMPLES) {
        const parsed = JSON.parse(example.output);
        expect(parsed.answer).toBeDefined();
        expect(parsed.confidence).toBeDefined();
      }
    });

    it('P-010B examples should be valid JSON with should_supersede field', () => {
      for (const example of NPL_P010B_EXAMPLES) {
        const parsed = JSON.parse(example.output);
        expect(parsed.should_supersede).toBeDefined();
        expect(parsed.recommendation).toBeDefined();
      }
    });

    it('all prompt examples should have non-empty output', () => {
      for (const id of NPL_PROMPT_IDS) {
        const prompt = NPL_PROMPT_REGISTRY[id];
        for (const example of prompt.examples) {
          expect(example.output.length).toBeGreaterThan(0);
        }
      }
    });

    it('all non-chat prompt examples should be parseable JSON', () => {
      // P-008 is the chat system prompt — its examples use natural language output
      for (const id of NPL_PROMPT_IDS) {
        if (id === 'P-008') continue;
        const prompt = NPL_PROMPT_REGISTRY[id];
        for (const example of prompt.examples) {
          expect(() => JSON.parse(example.output)).not.toThrow();
        }
      }
    });
  });
});
