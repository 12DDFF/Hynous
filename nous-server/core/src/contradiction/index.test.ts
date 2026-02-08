/**
 * @module @nous/core/contradiction
 * @description Tests for the Contradiction Resolution System (storm-009)
 * @version 1.0.0
 *
 * Test coverage:
 * - Constants validation (15 tests)
 * - Schema validation (15 tests)
 * - Type classification (12 tests)
 * - Detection pipeline (15 tests)
 * - Superseded lifecycle (15 tests)
 * - Conflict queue (15 tests)
 * - Accuracy modes (10 tests)
 * - Retrieval integration (10 tests)
 *
 * Total: ~107 tests
 */

import { describe, it, expect } from 'vitest';
import type { NousNode } from '../nodes';
import {
  // Constants
  DETECTION_TIERS,
  CONFLICT_TYPES,
  RESOLUTION_STRATEGIES,
  SUPERSEDED_STATES,
  ACCURACY_MODES,
  QUERY_MODES,
  SENTIMENTS,
  CONFLICT_STATUSES,
  USER_RESOLUTIONS,
  TIER_THRESHOLDS,
  DETECTION_TIER_METADATA,
  CONFLICT_TYPE_RESOLUTION,
  SUPERSEDED_DECAY_MULTIPLIERS,
  SUPERSEDED_R_THRESHOLDS,
  SUPERSEDED_DORMANT_DAYS,
  DELETION_CRITERIA,
  STORAGE_PRESSURE_THRESHOLD,
  CONFLICT_QUEUE_CONFIG,
  PATTERN_TRIGGERS,
  PATTERN_DISQUALIFIERS,
  PATTERN_CONFIDENCE_WEIGHTS,
  ATTRIBUTE_SYNONYMS,
  HISTORY_MODE_PATTERNS,
  CLASSIFIER_TRAINING,
  ACCURACY_TARGETS,
  SUPERSEDED_ACCESS_DECAY_MULTIPLIER,
  HISTORY_MODE_SUPERSEDED_PENALTY,
  SSA_SUPERSEDED_ACTIVATION_CAP,
  SSA_SUPERSEDED_SPREAD_DECAY,
  // Type guards
  isDetectionTier,
  isConflictType,
  isSupersededState,
  isAccuracyMode,
  isQueryMode,
  // Schemas
  DetectionContextSchema,
  TypeClassificationSchema,
  TierResultSchema,
  PatternDetectionSchema,
  LLMDetectionOutputSchema,
  VerificationOutputSchema,
  DetectionPipelineResultSchema,
  SupersededStateConfigSchema,
  SupersessionFieldsSchema,
  DeletionCriteriaResultSchema,
  ConflictQueueItemSchema,
  ContradictionResolutionSchema,
  ConflictQueueStatusSchema,
  AccuracyModeConfigSchema,
  DetectionEventLogSchema,
  HistoryModeDetectionSchema,
  QueryModeConfigSchema,
  // Types
  type DetectionContext,
  type PatternDetection,
  type ConflictQueueItem,
  type DetectionEventLog,
  type SupersessionFields,
  type AccuracyMode,
  type DetectionTier,
  // Config objects
  SUPERSEDED_STATE_CONFIGS,
  ACCURACY_MODE_CONFIGS,
  QUERY_MODE_CONFIGS,
  DEFAULT_QUEUE_CONFIG,
  DEFAULT_SELF_IMPROVEMENT_CONFIG,
  QCS_HISTORY_MODE_CONFIG,
  RCS_SUPERSESSION_FLAG,
  SSA_SUPERSEDED_CONFIG,
  PHASE2_CONTEXT_INJECTION,
  DEFAULT_RETRIEVAL_INTEGRATION_CONFIG,
  TYPE_DETECTION_CRITERIA,
  // Prompts
  CLASSIFIER_FEW_SHOT_PROMPT,
  LLM_DETECTION_PROMPT,
  VERIFICATION_PROMPT,
  // Functions
  daysSince,
  generateConflictId,
  generateEventId,
  formatDate,
  classifyConflictType,
  isAutoSupersede,
  getResolutionStrategy,
  resolveSourceConflict,
  hasSentimentFlip,
  runTier2Pattern,
  calculatePatternConfidence,
  runTier1_5Normalization,
  shouldContinueToNextTier,
  canAutoSupersede,
  determineSupersededState,
  getDecayMultiplier,
  getEffectiveDecayMultiplier,
  checkStateTransition,
  checkDeletionCriteria,
  isStoragePressure,
  getRetrievalMode,
  getContentState,
  createConflictQueueItem,
  addToConflictQueue,
  getPendingConflicts,
  resolveConflict,
  processExpiredConflicts,
  getQueueStatus,
  formatForPresentation,
  shouldShowWeeklyPrompt,
  getAccuracyModeConfig,
  shouldUseTier,
  canAutoSupersedeTier,
  logDetectionEvent,
  computeWeeklyMetrics,
  checkAccuracyAlerts,
  shouldTrainClassifier,
  getTrainingData,
  getAccuracyTarget,
  detectHistoryMode,
  applySupersededCap,
  calculateSupersededSpread,
  injectSupersessionContext,
  shouldFollowSupersedesEdges,
  buildHistoryTimeline,
  getQueryModeConfig,
  shouldIncludeSuperseded,
  getSupersededPenalty,
  shouldFlagSupersessionHistory,
} from './index';

// ============================================================================
// TEST UTILITIES
// ============================================================================

function createMockNousNode(overrides: Partial<NousNode> = {}): NousNode {
  return {
    id: 'node-1',
    version: 1,
    type: 'semantic',
    content: {
      type: 'semantic',
      title: 'Test node',
      body: 'This is test content',
    },
    state: {
      lifecycle: 'active',
      visibility: 'normal',
    },
    temporal: {
      creation: {
        type: 'created',
        timestamp: new Date().toISOString(),
      },
      ingestion: {
        timestamp: new Date().toISOString(),
      },
    },
    neural: {
      stability: 7,
      difficulty: 0.3,
      strength: 1.0,
      retrievability: 0.8,
      last_access: new Date().toISOString(),
      access_count: 5,
    },
    graph: {
      inbound_count: 2,
      outbound_count: 3,
      cluster_ids: [],
    },
    metadata: {},
    ...overrides,
  } as NousNode;
}

function createMockDetectionContext(overrides: Partial<DetectionContext> = {}): DetectionContext {
  return {
    old_value: 'old value',
    new_value: 'new value',
    old_timestamp: new Date().toISOString(),
    new_timestamp: new Date().toISOString(),
    old_source_confidence: 0.8,
    new_source_confidence: 0.9,
    has_sentiment_flip: false,
    has_scope_expansion: false,
    has_correction_pattern: false,
    ...overrides,
  };
}

function createMockConflictQueueItem(overrides: Partial<ConflictQueueItem> = {}): ConflictQueueItem {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 14);

  return {
    id: 'conflict-1',
    old_node_id: 'node-1',
    new_content: 'New content',
    conflict_type: 'AMBIGUOUS',
    detection_tier: 'LLM',
    detection_confidence: 0.6,
    context: 'Some context',
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    status: 'pending',
    entity_name: 'Test Entity',
    topic: 'Test Topic',
    ...overrides,
  };
}

// ============================================================================
// CONSTANTS VALIDATION TESTS
// ============================================================================

describe('Constants', () => {
  describe('DETECTION_TIERS', () => {
    it('should have 6 detection tiers', () => {
      expect(DETECTION_TIERS).toHaveLength(6);
    });

    it('should contain correct tier names', () => {
      expect(DETECTION_TIERS).toContain('STRUCTURAL');
      expect(DETECTION_TIERS).toContain('NORMALIZED');
      expect(DETECTION_TIERS).toContain('PATTERN');
      expect(DETECTION_TIERS).toContain('CLASSIFIER');
      expect(DETECTION_TIERS).toContain('LLM');
      expect(DETECTION_TIERS).toContain('VERIFICATION');
    });
  });

  describe('CONFLICT_TYPES', () => {
    it('should have 6 conflict types', () => {
      expect(CONFLICT_TYPES).toHaveLength(6);
    });

    it('should contain correct type names', () => {
      expect(CONFLICT_TYPES).toContain('FACT_UPDATE');
      expect(CONFLICT_TYPES).toContain('CORRECTION');
      expect(CONFLICT_TYPES).toContain('BELIEF_CONTRADICTION');
      expect(CONFLICT_TYPES).toContain('BELIEF_EVOLUTION');
      expect(CONFLICT_TYPES).toContain('SOURCE_CONFLICT');
      expect(CONFLICT_TYPES).toContain('AMBIGUOUS');
    });
  });

  describe('SUPERSEDED_STATES', () => {
    it('should have 5 superseded states', () => {
      expect(SUPERSEDED_STATES).toHaveLength(5);
    });

    it('should contain correct state names', () => {
      expect(SUPERSEDED_STATES).toContain('SUPERSEDED_ACTIVE');
      expect(SUPERSEDED_STATES).toContain('SUPERSEDED_FADING');
      expect(SUPERSEDED_STATES).toContain('SUPERSEDED_DORMANT');
      expect(SUPERSEDED_STATES).toContain('SUPERSEDED_ARCHIVED');
      expect(SUPERSEDED_STATES).toContain('SUPERSEDED_DELETED');
    });
  });

  describe('TIER_THRESHOLDS', () => {
    it('should have correct threshold values from spec', () => {
      expect(TIER_THRESHOLDS.structural_confidence).toBe(0.95);
      expect(TIER_THRESHOLDS.normalized_confidence).toBe(0.90);
      expect(TIER_THRESHOLDS.pattern_high_threshold).toBe(0.70);
      expect(TIER_THRESHOLDS.pattern_continue_threshold).toBe(0.40);
      expect(TIER_THRESHOLDS.classifier_threshold).toBe(0.70);
      expect(TIER_THRESHOLDS.llm_auto_threshold).toBe(0.80);
      expect(TIER_THRESHOLDS.verification_threshold).toBe(0.70);
    });
  });

  describe('SUPERSEDED_DECAY_MULTIPLIERS', () => {
    it('should have correct multiplier values from spec', () => {
      expect(SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_ACTIVE).toBe(3);
      expect(SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_FADING).toBe(4);
      expect(SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_DORMANT).toBe(5);
      expect(SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_ARCHIVED).toBe(5);
      expect(SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_DELETED).toBe(0);
    });
  });

  describe('DELETION_CRITERIA', () => {
    it('should have correct criteria values from spec', () => {
      expect(DELETION_CRITERIA.min_archived_days).toBe(180);
      expect(DELETION_CRITERIA.required_access_count).toBe(0);
      expect(DELETION_CRITERIA.max_edge_strength).toBe(0.5);
      expect(DELETION_CRITERIA.superseding_must_be_active).toBe(true);
      expect(DELETION_CRITERIA.raw_must_exist).toBe(true);
    });
  });

  describe('CONFLICT_QUEUE_CONFIG', () => {
    it('should have correct queue config values from spec', () => {
      expect(CONFLICT_QUEUE_CONFIG.max_items).toBe(20);
      expect(CONFLICT_QUEUE_CONFIG.auto_resolve_days).toBe(14);
      expect(CONFLICT_QUEUE_CONFIG.auto_resolve_strategy).toBe('keep_both');
      expect(CONFLICT_QUEUE_CONFIG.weekly_prompt_day).toBe(1);
    });
  });

  describe('PATTERN_TRIGGERS', () => {
    it('should contain expected trigger patterns', () => {
      expect(PATTERN_TRIGGERS).toContain('actually');
      expect(PATTERN_TRIGGERS).toContain('I was wrong');
      expect(PATTERN_TRIGGERS).toContain('correction:');
      expect(PATTERN_TRIGGERS).toContain('update:');
    });
  });

  describe('PATTERN_DISQUALIFIERS', () => {
    it('should contain expected disqualifier patterns', () => {
      expect(PATTERN_DISQUALIFIERS).toContain("wasn't actually");
      expect(PATTERN_DISQUALIFIERS).toContain('not really');
      expect(PATTERN_DISQUALIFIERS).toContain('actually enjoyed');
    });
  });
});

// ============================================================================
// TYPE GUARD TESTS
// ============================================================================

describe('Type Guards', () => {
  describe('isDetectionTier', () => {
    it('should return true for valid detection tiers', () => {
      expect(isDetectionTier('STRUCTURAL')).toBe(true);
      expect(isDetectionTier('LLM')).toBe(true);
      expect(isDetectionTier('VERIFICATION')).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isDetectionTier('INVALID')).toBe(false);
      expect(isDetectionTier(123)).toBe(false);
      expect(isDetectionTier(null)).toBe(false);
    });
  });

  describe('isConflictType', () => {
    it('should return true for valid conflict types', () => {
      expect(isConflictType('FACT_UPDATE')).toBe(true);
      expect(isConflictType('CORRECTION')).toBe(true);
      expect(isConflictType('AMBIGUOUS')).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isConflictType('INVALID')).toBe(false);
    });
  });

  describe('isSupersededState', () => {
    it('should return true for valid superseded states', () => {
      expect(isSupersededState('SUPERSEDED_ACTIVE')).toBe(true);
      expect(isSupersededState('SUPERSEDED_DELETED')).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isSupersededState('INVALID')).toBe(false);
    });
  });

  describe('isAccuracyMode', () => {
    it('should return true for valid accuracy modes', () => {
      expect(isAccuracyMode('FAST')).toBe(true);
      expect(isAccuracyMode('BALANCED')).toBe(true);
      expect(isAccuracyMode('THOROUGH')).toBe(true);
      expect(isAccuracyMode('MANUAL')).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isAccuracyMode('INVALID')).toBe(false);
    });
  });

  describe('isQueryMode', () => {
    it('should return true for valid query modes', () => {
      expect(isQueryMode('current')).toBe(true);
      expect(isQueryMode('history')).toBe(true);
      expect(isQueryMode('full_audit')).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isQueryMode('INVALID')).toBe(false);
    });
  });
});

// ============================================================================
// SCHEMA VALIDATION TESTS
// ============================================================================

describe('Schema Validation', () => {
  describe('DetectionContextSchema', () => {
    it('should validate a valid detection context', () => {
      const context = createMockDetectionContext();
      const result = DetectionContextSchema.safeParse(context);
      expect(result.success).toBe(true);
    });

    it('should reject invalid detection context', () => {
      const result = DetectionContextSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('TypeClassificationSchema', () => {
    it('should validate a valid type classification', () => {
      const classification = {
        type: 'FACT_UPDATE',
        confidence: 0.9,
        auto_supersede: true,
        resolution: 'supersede_old',
        reasoning: 'Test reasoning',
      };
      const result = TypeClassificationSchema.safeParse(classification);
      expect(result.success).toBe(true);
    });
  });

  describe('TierResultSchema', () => {
    it('should validate a valid tier result', () => {
      const tierResult = {
        tier: 'STRUCTURAL',
        detected: true,
        confidence: 0.95,
        should_continue: false,
        time_ms: 1,
        cost: 0,
      };
      const result = TierResultSchema.safeParse(tierResult);
      expect(result.success).toBe(true);
    });
  });

  describe('PatternDetectionSchema', () => {
    it('should validate a valid pattern detection', () => {
      const pattern = {
        triggers_found: ['actually'],
        entity_nearby: true,
        has_value: true,
        temporal_signal: false,
        disqualifiers_found: [],
        confidence_score: 0.75,
      };
      const result = PatternDetectionSchema.safeParse(pattern);
      expect(result.success).toBe(true);
    });
  });

  describe('LLMDetectionOutputSchema', () => {
    it('should validate a valid LLM detection output', () => {
      const output = {
        relationship: 'contradicts',
        confidence: 0.85,
        reasoning: 'Values conflict',
        which_is_current: 'new',
        both_could_be_true: false,
        is_time_dependent: true,
        needs_user_input: false,
      };
      const result = LLMDetectionOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });
  });

  describe('VerificationOutputSchema', () => {
    it('should validate a valid verification output', () => {
      const output = {
        should_supersede: true,
        confidence: 0.9,
        concerns: [],
        recommendation: 'auto_supersede',
      };
      const result = VerificationOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });
  });

  describe('ConflictQueueItemSchema', () => {
    it('should validate a valid conflict queue item', () => {
      const item = createMockConflictQueueItem();
      const result = ConflictQueueItemSchema.safeParse(item);
      expect(result.success).toBe(true);
    });
  });

  describe('ContradictionResolutionSchema', () => {
    it('should validate a valid contradiction resolution', () => {
      const resolution = {
        conflict_id: 'conflict-1',
        resolved_by: 'user',
        resolution: 'new_is_current',
        resolved_at: new Date().toISOString(),
      };
      const result = ContradictionResolutionSchema.safeParse(resolution);
      expect(result.success).toBe(true);
    });
  });

  describe('AccuracyModeConfigSchema', () => {
    it('should validate a valid accuracy mode config', () => {
      const config = ACCURACY_MODE_CONFIGS.BALANCED;
      const result = AccuracyModeConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('QueryModeConfigSchema', () => {
    it('should validate a valid query mode config', () => {
      const config = QUERY_MODE_CONFIGS.history;
      const result = QueryModeConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// TYPE CLASSIFICATION TESTS
// ============================================================================

describe('Type Classification', () => {
  describe('classifyConflictType', () => {
    it('should classify FACT_UPDATE when entity and attribute match with different values', () => {
      const node = createMockNousNode();
      const context = createMockDetectionContext({
        entity_id: 'entity-1',
        attribute_type: 'phone',
        old_value: '555-1234',
        new_value: '555-5678',
      });
      const result = classifyConflictType(node, 'new content', context);
      expect(result.type).toBe('FACT_UPDATE');
      expect(result.auto_supersede).toBe(true);
      expect(result.resolution).toBe('supersede_old');
    });

    it('should classify CORRECTION when correction pattern is present', () => {
      const node = createMockNousNode();
      const context = createMockDetectionContext({
        has_correction_pattern: true,
      });
      const result = classifyConflictType(node, 'Actually, it is different', context);
      expect(result.type).toBe('CORRECTION');
      expect(result.auto_supersede).toBe(true);
    });

    it('should classify BELIEF_CONTRADICTION when sentiment flips', () => {
      const node = createMockNousNode();
      const context = createMockDetectionContext({
        has_sentiment_flip: true,
        has_scope_expansion: false,
      });
      const result = classifyConflictType(node, 'new content', context);
      expect(result.type).toBe('BELIEF_CONTRADICTION');
      expect(result.auto_supersede).toBe(true);
    });

    it('should classify BELIEF_EVOLUTION when scope expands without sentiment flip', () => {
      const node = createMockNousNode();
      const context = createMockDetectionContext({
        has_sentiment_flip: false,
        has_scope_expansion: true,
      });
      const result = classifyConflictType(node, 'new content', context);
      expect(result.type).toBe('BELIEF_EVOLUTION');
      expect(result.auto_supersede).toBe(false);
      expect(result.resolution).toBe('keep_both_linked');
    });

    it('should classify SOURCE_CONFLICT when source confidences differ significantly', () => {
      const node = createMockNousNode();
      const context = createMockDetectionContext({
        old_source_confidence: 0.5,
        new_source_confidence: 0.9,
      });
      const result = classifyConflictType(node, 'new content', context);
      expect(result.type).toBe('SOURCE_CONFLICT');
      expect(result.resolution).toBe('source_ranking');
    });

    it('should classify AMBIGUOUS as fallback', () => {
      const node = createMockNousNode();
      const context = createMockDetectionContext({
        old_source_confidence: 0.8,
        new_source_confidence: 0.8,
      });
      const result = classifyConflictType(node, 'new content', context);
      expect(result.type).toBe('AMBIGUOUS');
      expect(result.auto_supersede).toBe(false);
      expect(result.resolution).toBe('queue_for_user');
    });
  });

  describe('isAutoSupersede', () => {
    it('should return true for auto-supersede types', () => {
      expect(isAutoSupersede('FACT_UPDATE')).toBe(true);
      expect(isAutoSupersede('CORRECTION')).toBe(true);
      expect(isAutoSupersede('BELIEF_CONTRADICTION')).toBe(true);
      expect(isAutoSupersede('SOURCE_CONFLICT')).toBe(true);
    });

    it('should return false for non-auto-supersede types', () => {
      expect(isAutoSupersede('BELIEF_EVOLUTION')).toBe(false);
      expect(isAutoSupersede('AMBIGUOUS')).toBe(false);
    });
  });

  describe('getResolutionStrategy', () => {
    it('should return correct strategy for each type', () => {
      expect(getResolutionStrategy('FACT_UPDATE')).toBe('supersede_old');
      expect(getResolutionStrategy('BELIEF_EVOLUTION')).toBe('keep_both_linked');
      expect(getResolutionStrategy('AMBIGUOUS')).toBe('queue_for_user');
      expect(getResolutionStrategy('SOURCE_CONFLICT')).toBe('source_ranking');
    });
  });

  describe('resolveSourceConflict', () => {
    it('should return new when new confidence is higher', () => {
      expect(resolveSourceConflict(0.7, 0.9)).toBe('new');
    });

    it('should return old when old confidence is higher', () => {
      expect(resolveSourceConflict(0.9, 0.7)).toBe('old');
    });

    it('should return new when confidences are equal', () => {
      expect(resolveSourceConflict(0.8, 0.8)).toBe('new');
    });
  });

  describe('hasSentimentFlip', () => {
    it('should detect positive to negative flip', () => {
      expect(hasSentimentFlip('positive', 'negative')).toBe(true);
    });

    it('should detect negative to positive flip', () => {
      expect(hasSentimentFlip('negative', 'positive')).toBe(true);
    });

    it('should not detect flip when neutral is involved', () => {
      expect(hasSentimentFlip('positive', 'neutral')).toBe(false);
      expect(hasSentimentFlip('neutral', 'negative')).toBe(false);
    });

    it('should not detect flip when same sentiment', () => {
      expect(hasSentimentFlip('positive', 'positive')).toBe(false);
    });
  });
});

// ============================================================================
// DETECTION PIPELINE TESTS
// ============================================================================

describe('Detection Pipeline', () => {
  describe('runTier2Pattern', () => {
    it('should detect trigger patterns', () => {
      const result = runTier2Pattern('Actually, the meeting is on Thursday');
      expect(result.triggers_found).toContain('actually');
      expect(result.confidence_score).toBeGreaterThan(0);
    });

    it('should detect disqualifier patterns', () => {
      const result = runTier2Pattern("I wasn't actually sure about that");
      expect(result.disqualifiers_found).toContain("wasn't actually");
    });

    it('should detect temporal signals', () => {
      const result = runTier2Pattern('I used to think that, but now I know better');
      expect(result.temporal_signal).toBe(true);
    });

    it('should return base confidence when no triggers found', () => {
      const result = runTier2Pattern('The weather is nice today');
      expect(result.triggers_found).toHaveLength(0);
      expect(result.confidence_score).toBe(PATTERN_CONFIDENCE_WEIGHTS.base);
    });

    it('should apply disqualifier penalty', () => {
      const withDisqualifier = runTier2Pattern('Actually, I actually enjoyed it');
      const withoutDisqualifier = runTier2Pattern('Actually, the date changed');
      expect(withDisqualifier.confidence_score).toBeLessThan(withoutDisqualifier.confidence_score);
    });
  });

  describe('calculatePatternConfidence', () => {
    it('should calculate base confidence', () => {
      const detection: PatternDetection = {
        triggers_found: ['actually'],
        entity_nearby: false,
        has_value: false,
        temporal_signal: false,
        disqualifiers_found: [],
        confidence_score: 0,
      };
      const confidence = calculatePatternConfidence(detection);
      expect(confidence).toBe(PATTERN_CONFIDENCE_WEIGHTS.base);
    });

    it('should add entity nearby bonus', () => {
      const detection: PatternDetection = {
        triggers_found: ['actually'],
        entity_nearby: true,
        has_value: false,
        temporal_signal: false,
        disqualifiers_found: [],
        confidence_score: 0,
      };
      const confidence = calculatePatternConfidence(detection);
      expect(confidence).toBe(PATTERN_CONFIDENCE_WEIGHTS.base + PATTERN_CONFIDENCE_WEIGHTS.entity_nearby);
    });

    it('should cap confidence at 1.0', () => {
      const detection: PatternDetection = {
        triggers_found: ['actually'],
        entity_nearby: true,
        has_value: true,
        temporal_signal: true,
        disqualifiers_found: [],
        confidence_score: 0,
      };
      const confidence = calculatePatternConfidence(detection);
      expect(confidence).toBeLessThanOrEqual(1.0);
    });

    it('should floor confidence at 0', () => {
      const detection: PatternDetection = {
        triggers_found: [],
        entity_nearby: false,
        has_value: false,
        temporal_signal: false,
        disqualifiers_found: ['not really', 'actually enjoyed'],
        confidence_score: 0,
      };
      const confidence = calculatePatternConfidence(detection);
      expect(confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('runTier1_5Normalization', () => {
    it('should normalize phone attribute', () => {
      const result = runTier1_5Normalization('cell', 'Sarah cell is 555-1234');
      expect(result.normalized_attribute).toBe('contact.phone');
      expect(result.synonyms_matched).toContain('cell');
    });

    it('should normalize email attribute', () => {
      const result = runTier1_5Normalization('mail', 'Send mail to test@example.com');
      expect(result.normalized_attribute).toBe('contact.email');
    });

    it('should keep original if no synonym matches', () => {
      const result = runTier1_5Normalization('unknown_attr', 'Some content');
      expect(result.normalized_attribute).toBe('unknown_attr');
      expect(result.synonyms_matched).toHaveLength(0);
    });
  });

  describe('shouldContinueToNextTier', () => {
    it('should stop in FAST mode after PATTERN tier', () => {
      const result = {
        tier: 'PATTERN' as DetectionTier,
        detected: true,
        confidence: 0.6,
        should_continue: true,
        time_ms: 10,
        cost: 0,
      };
      expect(shouldContinueToNextTier(result, 'FAST')).toBe(false);
    });

    it('should stop when high confidence detection', () => {
      const result = {
        tier: 'STRUCTURAL' as DetectionTier,
        detected: true,
        confidence: 0.95,
        should_continue: true,
        time_ms: 1,
        cost: 0,
      };
      expect(shouldContinueToNextTier(result, 'BALANCED')).toBe(false);
    });

    it('should continue when should_continue is true and confidence is low', () => {
      const result = {
        tier: 'PATTERN' as DetectionTier,
        detected: true,
        confidence: 0.5,
        should_continue: true,
        time_ms: 10,
        cost: 0,
      };
      expect(shouldContinueToNextTier(result, 'THOROUGH')).toBe(true);
    });
  });

  describe('canAutoSupersede', () => {
    it('should return false in MANUAL mode', () => {
      const tier3 = {
        relationship: 'contradicts' as const,
        confidence: 0.9,
        reasoning: 'Test',
        which_is_current: 'new' as const,
        both_could_be_true: false,
        is_time_dependent: false,
        needs_user_input: false,
      };
      const tier4 = {
        should_supersede: true,
        confidence: 0.9,
        concerns: [],
        recommendation: 'auto_supersede' as const,
      };
      expect(canAutoSupersede(tier3, tier4, 'MANUAL')).toBe(false);
    });

    it('should return true when both tiers pass thresholds', () => {
      const tier3 = {
        relationship: 'contradicts' as const,
        confidence: 0.85,
        reasoning: 'Test',
        which_is_current: 'new' as const,
        both_could_be_true: false,
        is_time_dependent: false,
        needs_user_input: false,
      };
      const tier4 = {
        should_supersede: true,
        confidence: 0.75,
        concerns: [],
        recommendation: 'auto_supersede' as const,
      };
      expect(canAutoSupersede(tier3, tier4, 'THOROUGH')).toBe(true);
    });

    it('should return false when concerns exist', () => {
      const tier3 = {
        relationship: 'contradicts' as const,
        confidence: 0.85,
        reasoning: 'Test',
        which_is_current: 'new' as const,
        both_could_be_true: false,
        is_time_dependent: false,
        needs_user_input: false,
      };
      const tier4 = {
        should_supersede: true,
        confidence: 0.75,
        concerns: ['Possible ambiguity'],
        recommendation: 'queue_for_user' as const,
      };
      expect(canAutoSupersede(tier3, tier4, 'THOROUGH')).toBe(false);
    });
  });
});

// ============================================================================
// SUPERSEDED LIFECYCLE TESTS
// ============================================================================

describe('Superseded Lifecycle', () => {
  describe('determineSupersededState', () => {
    it('should return SUPERSEDED_ACTIVE when R > 0.3', () => {
      const node = createMockNousNode({
        neural: {
          stability: 7,
          difficulty: 0.3,
          strength: 1.0,
          retrievability: 0.5,
          last_access: new Date().toISOString(),
          access_count: 5,
        },
      }) as NousNode & Partial<SupersessionFields>;
      expect(determineSupersededState(node)).toBe('SUPERSEDED_ACTIVE');
    });

    it('should return SUPERSEDED_FADING when R between 0.1 and 0.3', () => {
      const node = createMockNousNode({
        neural: {
          stability: 7,
          difficulty: 0.3,
          strength: 1.0,
          retrievability: 0.2,
          last_access: new Date().toISOString(),
          access_count: 5,
        },
      }) as NousNode & Partial<SupersessionFields>;
      expect(determineSupersededState(node)).toBe('SUPERSEDED_FADING');
    });

    it('should return SUPERSEDED_DORMANT when R < 0.1', () => {
      const node = createMockNousNode({
        neural: {
          stability: 7,
          difficulty: 0.3,
          strength: 1.0,
          retrievability: 0.05,
          last_access: new Date().toISOString(),
          access_count: 5,
        },
      }) as NousNode & Partial<SupersessionFields>;
      expect(determineSupersededState(node)).toBe('SUPERSEDED_DORMANT');
    });

    it('should return SUPERSEDED_DELETED when already deleted', () => {
      const node = createMockNousNode() as NousNode & Partial<SupersessionFields>;
      node.superseded_state = 'SUPERSEDED_DELETED';
      expect(determineSupersededState(node)).toBe('SUPERSEDED_DELETED');
    });

    it('should return SUPERSEDED_ARCHIVED when already archived', () => {
      const node = createMockNousNode() as NousNode & Partial<SupersessionFields>;
      node.superseded_state = 'SUPERSEDED_ARCHIVED';
      expect(determineSupersededState(node)).toBe('SUPERSEDED_ARCHIVED');
    });
  });

  describe('getDecayMultiplier', () => {
    it('should return 3 for SUPERSEDED_ACTIVE', () => {
      expect(getDecayMultiplier('SUPERSEDED_ACTIVE')).toBe(3);
    });

    it('should return 4 for SUPERSEDED_FADING', () => {
      expect(getDecayMultiplier('SUPERSEDED_FADING')).toBe(4);
    });

    it('should return 5 for SUPERSEDED_DORMANT', () => {
      expect(getDecayMultiplier('SUPERSEDED_DORMANT')).toBe(5);
    });

    it('should return 0 for SUPERSEDED_DELETED', () => {
      expect(getDecayMultiplier('SUPERSEDED_DELETED')).toBe(0);
    });
  });

  describe('getEffectiveDecayMultiplier', () => {
    it('should return 2 when user accessed', () => {
      expect(getEffectiveDecayMultiplier('SUPERSEDED_ACTIVE', true)).toBe(SUPERSEDED_ACCESS_DECAY_MULTIPLIER);
    });

    it('should return normal multiplier when not accessed', () => {
      expect(getEffectiveDecayMultiplier('SUPERSEDED_ACTIVE', false)).toBe(3);
    });
  });

  describe('checkStateTransition', () => {
    it('should detect transition from ACTIVE to FADING', () => {
      const node = createMockNousNode({
        neural: {
          stability: 7,
          difficulty: 0.3,
          strength: 1.0,
          retrievability: 0.2,
          last_access: new Date().toISOString(),
          access_count: 5,
        },
      }) as NousNode & Partial<SupersessionFields>;
      node.superseded_state = 'SUPERSEDED_ACTIVE';

      const transition = checkStateTransition(node);
      expect(transition).not.toBeNull();
      expect(transition?.from_state).toBe('SUPERSEDED_ACTIVE');
      expect(transition?.to_state).toBe('SUPERSEDED_FADING');
    });

    it('should return null when no transition needed', () => {
      const node = createMockNousNode({
        neural: {
          stability: 7,
          difficulty: 0.3,
          strength: 1.0,
          retrievability: 0.5,
          last_access: new Date().toISOString(),
          access_count: 5,
        },
      }) as NousNode & Partial<SupersessionFields>;
      node.superseded_state = 'SUPERSEDED_ACTIVE';

      const transition = checkStateTransition(node);
      expect(transition).toBeNull();
    });

    it('should return null for SUPERSEDED_DELETED', () => {
      const node = createMockNousNode() as NousNode & Partial<SupersessionFields>;
      node.superseded_state = 'SUPERSEDED_DELETED';
      expect(checkStateTransition(node)).toBeNull();
    });
  });

  describe('checkDeletionCriteria', () => {
    it('should return eligible when all 5 criteria met', () => {
      const node = createMockNousNode({
        state: { lifecycle: 'active', visibility: 'normal' },
      }) as NousNode & Partial<SupersessionFields>;

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 200);
      node.archived_at = pastDate.toISOString();
      node.access_count_since_superseded = 0;

      const supersedingNode = createMockNousNode({
        state: { lifecycle: 'active', visibility: 'normal' },
      });

      const result = checkDeletionCriteria(node, supersedingNode, 0.3, true);
      expect(result.eligible).toBe(true);
      expect(result.criteria.archived_long_enough).toBe(true);
      expect(result.criteria.no_accesses).toBe(true);
      expect(result.criteria.no_important_edges).toBe(true);
      expect(result.criteria.superseding_active).toBe(true);
      expect(result.criteria.raw_in_archive).toBe(true);
    });

    it('should return not eligible when not archived long enough', () => {
      const node = createMockNousNode() as NousNode & Partial<SupersessionFields>;
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 100);
      node.archived_at = pastDate.toISOString();
      node.access_count_since_superseded = 0;

      const supersedingNode = createMockNousNode({
        state: { lifecycle: 'active', visibility: 'normal' },
      });

      const result = checkDeletionCriteria(node, supersedingNode, 0.3, true);
      expect(result.eligible).toBe(false);
      expect(result.criteria.archived_long_enough).toBe(false);
    });

    it('should return not eligible when superseding node is not active', () => {
      const node = createMockNousNode() as NousNode & Partial<SupersessionFields>;
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 200);
      node.archived_at = pastDate.toISOString();
      node.access_count_since_superseded = 0;

      const result = checkDeletionCriteria(node, null, 0.3, true);
      expect(result.eligible).toBe(false);
      expect(result.criteria.superseding_active).toBe(false);
    });
  });

  describe('isStoragePressure', () => {
    it('should return true when at or above threshold', () => {
      expect(isStoragePressure(0.80)).toBe(true);
      expect(isStoragePressure(0.90)).toBe(true);
    });

    it('should return false when below threshold', () => {
      expect(isStoragePressure(0.70)).toBe(false);
    });
  });

  describe('getRetrievalMode', () => {
    it('should return correct retrieval mode for each state', () => {
      expect(getRetrievalMode('SUPERSEDED_ACTIVE')).toBe('normal_excluded');
      expect(getRetrievalMode('SUPERSEDED_FADING')).toBe('history_only');
      expect(getRetrievalMode('SUPERSEDED_DORMANT')).toBe('audit_only');
      expect(getRetrievalMode('SUPERSEDED_DELETED')).toBe('none');
    });
  });
});

// ============================================================================
// CONFLICT QUEUE TESTS
// ============================================================================

describe('Conflict Queue', () => {
  describe('createConflictQueueItem', () => {
    it('should create item with generated id and timestamps', () => {
      const item = createConflictQueueItem({
        old_node_id: 'node-1',
        new_content: 'New content',
        conflict_type: 'AMBIGUOUS',
        detection_tier: 'LLM',
        detection_confidence: 0.6,
        context: 'Context',
      });

      expect(item.id).toMatch(/^conflict_/);
      expect(item.created_at).toBeDefined();
      expect(item.expires_at).toBeDefined();
      expect(item.status).toBe('pending');
    });

    it('should set expiry to 14 days from creation', () => {
      const item = createConflictQueueItem({
        old_node_id: 'node-1',
        new_content: 'New content',
        conflict_type: 'AMBIGUOUS',
        detection_tier: 'LLM',
        detection_confidence: 0.6,
        context: 'Context',
      });

      const created = new Date(item.created_at);
      const expires = new Date(item.expires_at);
      const daysDiff = Math.round((expires.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBe(14);
    });
  });

  describe('addToConflictQueue', () => {
    it('should add item to queue', () => {
      const queue: ConflictQueueItem[] = [];
      const item = createMockConflictQueueItem();
      const { queue: newQueue } = addToConflictQueue(queue, item);
      expect(newQueue).toHaveLength(1);
    });

    it('should auto-resolve oldest when queue exceeds max', () => {
      const queue: ConflictQueueItem[] = [];
      for (let i = 0; i < 20; i++) {
        const item = createMockConflictQueueItem({ id: `conflict-${i}` });
        item.created_at = new Date(Date.now() - i * 1000).toISOString();
        queue.push(item);
      }

      const newItem = createMockConflictQueueItem({ id: 'conflict-new' });
      const { auto_resolved } = addToConflictQueue(queue, newItem);

      expect(auto_resolved.length).toBeGreaterThan(0);
      expect(auto_resolved[0].resolved_by).toBe('auto');
      expect(auto_resolved[0].resolution).toBe('keep_both');
    });
  });

  describe('getPendingConflicts', () => {
    it('should return only pending conflicts', () => {
      const queue = [
        createMockConflictQueueItem({ id: 'c1', status: 'pending' }),
        createMockConflictQueueItem({ id: 'c2', status: 'resolved' }),
        createMockConflictQueueItem({ id: 'c3', status: 'pending' }),
      ];

      const pending = getPendingConflicts(queue);
      expect(pending).toHaveLength(2);
      expect(pending.every((p) => p.status === 'pending')).toBe(true);
    });

    it('should sort by created_at ascending', () => {
      const now = Date.now();
      const queue = [
        createMockConflictQueueItem({ id: 'c1', created_at: new Date(now).toISOString() }),
        createMockConflictQueueItem({ id: 'c2', created_at: new Date(now - 10000).toISOString() }),
        createMockConflictQueueItem({ id: 'c3', created_at: new Date(now - 5000).toISOString() }),
      ];

      const pending = getPendingConflicts(queue);
      expect(pending[0].id).toBe('c2');
      expect(pending[1].id).toBe('c3');
      expect(pending[2].id).toBe('c1');
    });
  });

  describe('resolveConflict', () => {
    it('should mark conflict as resolved', () => {
      const queue = [createMockConflictQueueItem({ id: 'c1', status: 'pending' })];
      const resolution = resolveConflict(queue, 'c1', 'new_is_current');

      expect(resolution.conflict_id).toBe('c1');
      expect(resolution.resolved_by).toBe('user');
      expect(resolution.resolution).toBe('new_is_current');
      expect(queue[0].status).toBe('resolved');
    });

    it('should throw when conflict not found', () => {
      const queue: ConflictQueueItem[] = [];
      expect(() => resolveConflict(queue, 'nonexistent', 'keep_both')).toThrow('Conflict not found');
    });

    it('should throw when conflict already resolved', () => {
      const queue = [createMockConflictQueueItem({ id: 'c1', status: 'resolved' })];
      expect(() => resolveConflict(queue, 'c1', 'keep_both')).toThrow('already resolved');
    });

    it('should include merged content when provided', () => {
      const queue = [createMockConflictQueueItem({ id: 'c1', status: 'pending' })];
      const resolution = resolveConflict(queue, 'c1', 'merge', 'Merged content');
      expect(resolution.user_merged_content).toBe('Merged content');
    });
  });

  describe('processExpiredConflicts', () => {
    it('should auto-resolve expired conflicts', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const queue = [
        createMockConflictQueueItem({ id: 'c1', expires_at: pastDate.toISOString() }),
      ];

      const resolutions = processExpiredConflicts(queue);
      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].resolved_by).toBe('timeout');
      expect(queue[0].status).toBe('auto_resolved');
    });

    it('should not resolve non-expired conflicts', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const queue = [
        createMockConflictQueueItem({ id: 'c1', expires_at: futureDate.toISOString() }),
      ];

      const resolutions = processExpiredConflicts(queue);
      expect(resolutions).toHaveLength(0);
      expect(queue[0].status).toBe('pending');
    });
  });

  describe('getQueueStatus', () => {
    it('should return correct queue status', () => {
      const queue = [
        createMockConflictQueueItem({ id: 'c1', status: 'pending' }),
        createMockConflictQueueItem({ id: 'c2', status: 'pending' }),
        createMockConflictQueueItem({ id: 'c3', status: 'resolved' }),
      ];

      const status = getQueueStatus(queue);
      expect(status.pending_count).toBe(2);
      expect(status.at_capacity).toBe(false);
    });

    it('should indicate at capacity when 20 pending', () => {
      const queue: ConflictQueueItem[] = [];
      for (let i = 0; i < 20; i++) {
        queue.push(createMockConflictQueueItem({ id: `c${i}`, status: 'pending' }));
      }

      const status = getQueueStatus(queue);
      expect(status.at_capacity).toBe(true);
    });
  });

  describe('formatForPresentation', () => {
    it('should format conflict for UI presentation', () => {
      const item = createMockConflictQueueItem({
        detection_confidence: 0.75,
      });

      const presentation = formatForPresentation(item, 'Old content', '2024-01-01');
      expect(presentation.conflict_id).toBe(item.id);
      expect(presentation.version_a.content).toBe('Old content');
      expect(presentation.version_b.content).toBe(item.new_content);
      expect(presentation.suggested_action).toBe('new_is_current');
    });

    it('should suggest keep_both when confidence is low', () => {
      const item = createMockConflictQueueItem({
        detection_confidence: 0.3,
      });

      const presentation = formatForPresentation(item, 'Old content', '2024-01-01');
      expect(presentation.suggested_action).toBe('keep_both');
    });
  });
});

// ============================================================================
// ACCURACY MODE TESTS
// ============================================================================

describe('Accuracy Modes', () => {
  describe('getAccuracyModeConfig', () => {
    it('should return correct config for FAST', () => {
      const config = getAccuracyModeConfig('FAST');
      expect(config.mode).toBe('FAST');
      expect(config.user_involvement).toBe('high');
      expect(config.auto_supersede_tiers).toContain('STRUCTURAL');
      expect(config.auto_supersede_tiers).not.toContain('LLM');
    });

    it('should return correct config for BALANCED', () => {
      const config = getAccuracyModeConfig('BALANCED');
      expect(config.mode).toBe('BALANCED');
      expect(config.user_involvement).toBe('medium');
    });

    it('should return correct config for THOROUGH', () => {
      const config = getAccuracyModeConfig('THOROUGH');
      expect(config.mode).toBe('THOROUGH');
      expect(config.user_involvement).toBe('low');
      expect(config.tiers_used).toContain('VERIFICATION');
    });

    it('should return correct config for MANUAL', () => {
      const config = getAccuracyModeConfig('MANUAL');
      expect(config.mode).toBe('MANUAL');
      expect(config.user_involvement).toBe('very_high');
      expect(config.auto_supersede_tiers).toHaveLength(0);
    });
  });

  describe('shouldUseTier', () => {
    it('should allow STRUCTURAL in all modes', () => {
      expect(shouldUseTier('STRUCTURAL', 'FAST')).toBe(true);
      expect(shouldUseTier('STRUCTURAL', 'BALANCED')).toBe(true);
      expect(shouldUseTier('STRUCTURAL', 'THOROUGH')).toBe(true);
      expect(shouldUseTier('STRUCTURAL', 'MANUAL')).toBe(true);
    });

    it('should not allow VERIFICATION in FAST mode', () => {
      expect(shouldUseTier('VERIFICATION', 'FAST')).toBe(false);
    });

    it('should allow VERIFICATION in THOROUGH mode', () => {
      expect(shouldUseTier('VERIFICATION', 'THOROUGH')).toBe(true);
    });
  });

  describe('canAutoSupersedeTier', () => {
    it('should never auto-supersede in MANUAL mode', () => {
      expect(canAutoSupersedeTier('STRUCTURAL', 'MANUAL')).toBe(false);
      expect(canAutoSupersedeTier('LLM', 'MANUAL')).toBe(false);
    });

    it('should allow LLM auto-supersede in THOROUGH mode', () => {
      expect(canAutoSupersedeTier('LLM', 'THOROUGH')).toBe(true);
    });
  });

  describe('logDetectionEvent', () => {
    it('should create event with generated id and timestamp', () => {
      const event = logDetectionEvent({
        detection_id: 'det-1',
        tier_reached: 'LLM',
        tier_confidence: 0.85,
        auto_resolved: true,
        resolution: 'supersede',
        accuracy_mode: 'BALANCED',
      });

      expect(event.id).toMatch(/^event_/);
      expect(event.timestamp).toBeDefined();
      expect(event.tier_reached).toBe('LLM');
    });
  });

  describe('checkAccuracyAlerts', () => {
    it('should alert when tier accuracy drops below threshold', () => {
      const metrics = {
        period_start: new Date().toISOString(),
        period_end: new Date().toISOString(),
        per_tier_accuracy: {
          STRUCTURAL: 0.95,
          NORMALIZED: 0.90,
          PATTERN: 0.70,
          CLASSIFIER: 0.80,
          LLM: 0.85,
          VERIFICATION: 0.95,
        },
        false_positive_rate: 0.1,
        false_negative_rate: 0.05,
        auto_supersede_accuracy: 0.96,
        total_detections: 100,
        user_resolutions: 20,
        by_mode: {
          FAST: { detections: 30, accuracy: 0.9 },
          BALANCED: { detections: 50, accuracy: 0.92 },
          THOROUGH: { detections: 15, accuracy: 0.95 },
          MANUAL: { detections: 5, accuracy: 1.0 },
        },
      };

      const alerts = checkAccuracyAlerts(metrics);
      expect(alerts.some((a) => a.includes('PATTERN'))).toBe(true);
      expect(alerts.some((a) => a.includes('CLASSIFIER'))).toBe(true);
    });
  });

  describe('shouldTrainClassifier', () => {
    it('should recommend initial training at 500 examples', () => {
      const result = shouldTrainClassifier(500, false);
      expect(result.train).toBe(true);
      expect(result.retrain).toBe(false);
    });

    it('should recommend retraining at 2000 examples', () => {
      const result = shouldTrainClassifier(2000, true);
      expect(result.train).toBe(false);
      expect(result.retrain).toBe(true);
    });

    it('should not train when below thresholds', () => {
      const result = shouldTrainClassifier(300, false);
      expect(result.train).toBe(false);
      expect(result.retrain).toBe(false);
    });
  });
});

// ============================================================================
// RETRIEVAL INTEGRATION TESTS
// ============================================================================

describe('Retrieval Integration', () => {
  describe('detectHistoryMode', () => {
    it('should detect history mode patterns', () => {
      const result = detectHistoryMode('What did I used to think about this?');
      expect(result.is_history_mode).toBe(true);
      expect(result.matched_patterns.length).toBeGreaterThan(0);
      expect(result.suggested_mode).toBe('history');
    });

    it('should not detect history mode for normal queries', () => {
      const result = detectHistoryMode('What is the current status?');
      expect(result.is_history_mode).toBe(false);
      expect(result.suggested_mode).toBe('current');
    });

    it('should detect multiple patterns', () => {
      const result = detectHistoryMode('How has this changed previously?');
      expect(result.matched_patterns.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('applySupersededCap', () => {
    it('should cap activation for superseded nodes', () => {
      const node = createMockNousNode({
        state: { lifecycle: 'superseded', visibility: 'normal' },
      }) as NousNode & Partial<SupersessionFields>;

      const capped = applySupersededCap(0.8, node);
      expect(capped).toBe(SSA_SUPERSEDED_ACTIVATION_CAP);
    });

    it('should not cap activation for active nodes', () => {
      const node = createMockNousNode() as NousNode & Partial<SupersessionFields>;
      const capped = applySupersededCap(0.8, node);
      expect(capped).toBe(0.8);
    });

    it('should not increase below-cap activations', () => {
      const node = createMockNousNode({
        state: { lifecycle: 'superseded', visibility: 'normal' },
      }) as NousNode & Partial<SupersessionFields>;

      const capped = applySupersededCap(0.2, node);
      expect(capped).toBe(0.2);
    });
  });

  describe('calculateSupersededSpread', () => {
    it('should apply decay factor for superseded nodes', () => {
      const spread = calculateSupersededSpread(0.8, true);
      expect(spread).toBe(0.8 * SSA_SUPERSEDED_SPREAD_DECAY);
    });

    it('should not apply decay for non-superseded nodes', () => {
      const spread = calculateSupersededSpread(0.8, false);
      expect(spread).toBe(0.8);
    });
  });

  describe('injectSupersessionContext', () => {
    it('should inject context template with values', () => {
      const node = createMockNousNode({
        content: {
          type: 'semantic',
          title: 'Old title',
          body: 'Old content',
        },
      });

      const context = injectSupersessionContext(node, 'New content');
      expect(context).toContain('Old content');
      expect(context).toContain('New content');
      expect(context).toContain('was later updated');
    });
  });

  describe('shouldFollowSupersedesEdges', () => {
    it('should return true for history-related queries', () => {
      expect(shouldFollowSupersedesEdges('What changed in this project?')).toBe(true);
      expect(shouldFollowSupersedesEdges('What was it before?')).toBe(true);
    });

    it('should return false for current queries', () => {
      expect(shouldFollowSupersedesEdges('What is the current status?')).toBe(false);
    });
  });

  describe('buildHistoryTimeline', () => {
    it('should build timeline from chain', () => {
      const nodes = [
        createMockNousNode({ content: { type: 'semantic', title: 'Version 1', body: 'First version' } }),
        createMockNousNode({ content: { type: 'semantic', title: 'Version 2', body: 'Second version' } }),
      ];

      const timeline = buildHistoryTimeline(nodes);
      expect(timeline).toContain('Timeline:');
      expect(timeline).toContain('First version');
      expect(timeline).toContain('Second version');
      expect(timeline).toContain('(current)');
    });

    it('should handle empty chain', () => {
      const timeline = buildHistoryTimeline([]);
      expect(timeline).toBe('No history available.');
    });
  });

  describe('getQueryModeConfig', () => {
    it('should return correct config for each mode', () => {
      expect(getQueryModeConfig('current').include_superseded).toBe(false);
      expect(getQueryModeConfig('history').include_superseded).toBe(true);
      expect(getQueryModeConfig('full_audit').include_superseded).toBe(true);
    });
  });

  describe('shouldIncludeSuperseded', () => {
    it('should return true for history mode', () => {
      expect(shouldIncludeSuperseded('history')).toBe(true);
    });

    it('should return false for current mode', () => {
      expect(shouldIncludeSuperseded('current')).toBe(false);
    });
  });

  describe('getSupersededPenalty', () => {
    it('should return correct penalties', () => {
      expect(getSupersededPenalty('current')).toBe(1.0);
      expect(getSupersededPenalty('history')).toBe(HISTORY_MODE_SUPERSEDED_PENALTY);
      expect(getSupersededPenalty('full_audit')).toBe(0.0);
    });
  });

  describe('shouldFlagSupersessionHistory', () => {
    it('should flag when top result has superseded history', () => {
      const nodes = [
        { ...createMockNousNode(), superseded_by: 'node-2' } as NousNode & Partial<SupersessionFields>,
      ];
      expect(shouldFlagSupersessionHistory(nodes)).toBe(true);
    });

    it('should not flag when no supersession history', () => {
      const nodes = [createMockNousNode() as NousNode & Partial<SupersessionFields>];
      expect(shouldFlagSupersessionHistory(nodes)).toBe(false);
    });
  });
});

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('Utility Functions', () => {
  describe('daysSince', () => {
    it('should calculate days since timestamp', () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      expect(daysSince(tenDaysAgo.toISOString())).toBe(10);
    });

    it('should return 0 for today', () => {
      const today = new Date();
      expect(daysSince(today.toISOString())).toBe(0);
    });
  });

  describe('generateConflictId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateConflictId();
      const id2 = generateConflictId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^conflict_/);
    });
  });

  describe('generateEventId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateEventId();
      const id2 = generateEventId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^event_/);
    });
  });

  describe('formatDate', () => {
    it('should format date for display', () => {
      const date = '2024-06-15T10:30:00Z';
      const formatted = formatDate(date);
      expect(formatted).toContain('Jun');
      expect(formatted).toContain('15');
    });
  });
});

// ============================================================================
// CONFIG OBJECT TESTS
// ============================================================================

describe('Config Objects', () => {
  describe('SUPERSEDED_STATE_CONFIGS', () => {
    it('should have configs for all states', () => {
      expect(SUPERSEDED_STATE_CONFIGS.SUPERSEDED_ACTIVE).toBeDefined();
      expect(SUPERSEDED_STATE_CONFIGS.SUPERSEDED_FADING).toBeDefined();
      expect(SUPERSEDED_STATE_CONFIGS.SUPERSEDED_DORMANT).toBeDefined();
      expect(SUPERSEDED_STATE_CONFIGS.SUPERSEDED_ARCHIVED).toBeDefined();
      expect(SUPERSEDED_STATE_CONFIGS.SUPERSEDED_DELETED).toBeDefined();
    });

    it('should have correct R thresholds', () => {
      expect(SUPERSEDED_STATE_CONFIGS.SUPERSEDED_ACTIVE.r_threshold_min).toBe(0.3);
      expect(SUPERSEDED_STATE_CONFIGS.SUPERSEDED_FADING.r_threshold_min).toBe(0.1);
    });
  });

  describe('TYPE_DETECTION_CRITERIA', () => {
    it('should have 6 criteria entries', () => {
      expect(TYPE_DETECTION_CRITERIA).toHaveLength(6);
    });

    it('should have AMBIGUOUS as fallback', () => {
      const ambiguous = TYPE_DETECTION_CRITERIA.find((c) => c.type === 'AMBIGUOUS');
      expect(ambiguous?.matches({} as DetectionContext)).toBe(true);
    });
  });

  describe('Prompt Templates', () => {
    it('should have classifier prompt', () => {
      expect(CLASSIFIER_FEW_SHOT_PROMPT).toContain('Classify');
      expect(CLASSIFIER_FEW_SHOT_PROMPT).toContain('{input_text}');
    });

    it('should have LLM detection prompt', () => {
      expect(LLM_DETECTION_PROMPT).toContain('EXISTING INFORMATION');
      expect(LLM_DETECTION_PROMPT).toContain('NEW INFORMATION');
      expect(LLM_DETECTION_PROMPT).toContain('{entity_name}');
    });

    it('should have verification prompt', () => {
      expect(VERIFICATION_PROMPT).toContain('CONTRADICT');
      expect(VERIFICATION_PROMPT).toContain('should_supersede');
    });
  });
});
