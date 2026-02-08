/**
 * @module @nous/core/working-memory/tests
 * @description Test suite for storm-035 Working Memory & Consolidation Pipeline
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-035
 * @storm Brainstorms/Infrastructure/storm-035-working-memory
 *
 * Test Categories:
 * - Constants validation (~10 tests)
 * - Schema validation (~15 tests)
 * - Score management (~10 tests)
 * - Trigger events (~15 tests)
 * - Lifecycle transitions (~15 tests)
 * - Evaluation (~10 tests)
 * - Integration (~10 tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  // Constants
  PROMOTION_TRIGGERS,
  WM_STATUSES,
  TRIGGER_SCORES,
  PROMOTION_THRESHOLD,
  SCORE_DECAY_PER_DAY,
  WM_CHECK_INTERVAL_MINUTES,
  WM_DURATION_MULTIPLIER_RANGE,
  WM_RETRIEVAL_PRIORITY_MULTIPLIER,
  FADED_RETRIEVABILITY,
  RESTORED_STRENGTH_BONUS,
  WM_CONFIG,
  WM_EVALUATION_JOB_SPEC,
  CATEGORY_TO_NODE_TYPE,
  type PromotionTrigger,
  type WMStatus,
  // Types and Schemas
  type TriggerEvent,
  type WorkingMemoryState,
  type WorkingMemoryConfig,
  type PromotionResult,
  type FadeResult,
  type RestorationResult,
  type EvaluationResult,
  type WMEntryOptions,
  type ScoreCalculationInput,
  TriggerEventSchema,
  WorkingMemoryStateSchema,
  WorkingMemoryConfigSchema,
  PromotionResultSchema,
  FadeResultSchema,
  RestorationResultSchema,
  EvaluationResultSchema,
  WMEntryOptionsSchema,
  ScoreCalculationInputSchema,
  // Functions
  hoursBetween,
  daysBetween,
  validateWorkingMemoryState,
  mapCategoryToNodeType,
  getWorkingMemoryDuration,
  createWorkingMemoryState,
  calculateCurrentScore,
  recordTriggerEvent,
  shouldPromote,
  promoteNode,
  fadeNode,
  restoreFromDormant,
  evaluateNode,
  evaluateWorkingMemory,
  isInWorkingMemory,
  getTimeRemaining,
  getPromotionProgress,
  markAsPromoted,
  markAsFaded,
} from './index';

// ============================================================
// TEST CATEGORY 1: CONSTANTS VALIDATION (~10 tests)
// ============================================================

describe('Working Memory Constants', () => {
  describe('PROMOTION_TRIGGERS', () => {
    it('should have exactly 5 trigger types', () => {
      expect(PROMOTION_TRIGGERS).toHaveLength(5);
    });

    it('should contain all expected triggers', () => {
      expect(PROMOTION_TRIGGERS).toContain('user_access');
      expect(PROMOTION_TRIGGERS).toContain('query_activation');
      expect(PROMOTION_TRIGGERS).toContain('important_connection');
      expect(PROMOTION_TRIGGERS).toContain('high_confidence');
      expect(PROMOTION_TRIGGERS).toContain('explicit_save');
    });
  });

  describe('WM_STATUSES', () => {
    it('should have exactly 3 status types', () => {
      expect(WM_STATUSES).toHaveLength(3);
    });

    it('should contain pending, promoted, and faded', () => {
      expect(WM_STATUSES).toContain('pending');
      expect(WM_STATUSES).toContain('promoted');
      expect(WM_STATUSES).toContain('faded');
    });
  });

  describe('TRIGGER_SCORES', () => {
    it('should have score for each trigger type', () => {
      expect(Object.keys(TRIGGER_SCORES)).toHaveLength(5);
      for (const trigger of PROMOTION_TRIGGERS) {
        expect(TRIGGER_SCORES[trigger]).toBeDefined();
      }
    });

    it('should have correct score values from brainstorm', () => {
      expect(TRIGGER_SCORES.user_access).toBe(0.4);
      expect(TRIGGER_SCORES.query_activation).toBe(0.2);
      expect(TRIGGER_SCORES.important_connection).toBe(0.3);
      expect(TRIGGER_SCORES.high_confidence).toBe(0.2);
      expect(TRIGGER_SCORES.explicit_save).toBe(1.0);
    });

    it('should have explicit_save as instant promotion (score = 1.0)', () => {
      expect(TRIGGER_SCORES.explicit_save).toBe(1.0);
    });
  });

  describe('Threshold Constants', () => {
    it('should have PROMOTION_THRESHOLD = 0.5', () => {
      expect(PROMOTION_THRESHOLD).toBe(0.5);
    });

    it('should have SCORE_DECAY_PER_DAY = 0.1', () => {
      expect(SCORE_DECAY_PER_DAY).toBe(0.1);
    });

    it('should have WM_CHECK_INTERVAL_MINUTES = 60', () => {
      expect(WM_CHECK_INTERVAL_MINUTES).toBe(60);
    });

    it('should have WM_DURATION_MULTIPLIER_RANGE = [0.5, 2.0]', () => {
      expect(WM_DURATION_MULTIPLIER_RANGE).toEqual([0.5, 2.0]);
    });
  });

  describe('WM_CONFIG aggregate', () => {
    it('should contain all configuration values', () => {
      expect(WM_CONFIG.triggers).toEqual(PROMOTION_TRIGGERS);
      expect(WM_CONFIG.trigger_scores).toEqual(TRIGGER_SCORES);
      expect(WM_CONFIG.promotion_threshold).toBe(PROMOTION_THRESHOLD);
      expect(WM_CONFIG.score_decay_per_day).toBe(SCORE_DECAY_PER_DAY);
      expect(WM_CONFIG.manual_bypass).toBe(true);
      expect(WM_CONFIG.fade_action).toBe('dormant');
      expect(WM_CONFIG.restoration_action).toBe('direct_promote');
    });
  });

  describe('WM_EVALUATION_JOB_SPEC (J-015)', () => {
    it('should have correct job specification', () => {
      expect(WM_EVALUATION_JOB_SPEC.id).toBe('J-015');
      expect(WM_EVALUATION_JOB_SPEC.name).toBe('working-memory-evaluation');
      expect(WM_EVALUATION_JOB_SPEC.schedule).toBe('0 * * * *');
      expect(WM_EVALUATION_JOB_SPEC.priority).toBe('low');
      expect(WM_EVALUATION_JOB_SPEC.concurrency).toBe(1);
      expect(WM_EVALUATION_JOB_SPEC.timeout_minutes).toBe(5);
    });
  });

  describe('CATEGORY_TO_NODE_TYPE mapping', () => {
    it('should map content categories to algorithm node types', () => {
      expect(CATEGORY_TO_NODE_TYPE.identity).toBe('person');
      expect(CATEGORY_TO_NODE_TYPE.academic).toBe('concept');
      expect(CATEGORY_TO_NODE_TYPE.conversation).toBe('fact');
      expect(CATEGORY_TO_NODE_TYPE.work).toBe('note');
      expect(CATEGORY_TO_NODE_TYPE.temporal).toBe('event');
      expect(CATEGORY_TO_NODE_TYPE.document).toBe('document');
      expect(CATEGORY_TO_NODE_TYPE.general).toBe('fact');
    });
  });
});

// ============================================================
// TEST CATEGORY 2: SCHEMA VALIDATION (~15 tests)
// ============================================================

describe('Working Memory Schemas', () => {
  describe('TriggerEventSchema', () => {
    it('should validate a valid trigger event', () => {
      const event: TriggerEvent = {
        type: 'user_access',
        timestamp: new Date(),
        score_contribution: 0.4,
      };
      const result = TriggerEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it('should validate trigger event with details', () => {
      const event: TriggerEvent = {
        type: 'query_activation',
        timestamp: new Date(),
        score_contribution: 0.2,
        details: { query: 'test query', activation: 0.75 },
      };
      const result = TriggerEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it('should reject invalid trigger type', () => {
      const event = {
        type: 'invalid_trigger',
        timestamp: new Date(),
        score_contribution: 0.4,
      };
      const result = TriggerEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it('should reject score_contribution > 1', () => {
      const event = {
        type: 'user_access',
        timestamp: new Date(),
        score_contribution: 1.5,
      };
      const result = TriggerEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it('should reject negative score_contribution', () => {
      const event = {
        type: 'user_access',
        timestamp: new Date(),
        score_contribution: -0.1,
      };
      const result = TriggerEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });

  describe('WorkingMemoryStateSchema', () => {
    const validState: WorkingMemoryState = {
      entered_at: new Date(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      content_category: 'general',
      promotion_score: 0.0,
      score_last_updated: new Date(),
      trigger_events: [],
      status: 'pending',
    };

    it('should validate a valid pending state', () => {
      const result = WorkingMemoryStateSchema.safeParse(validState);
      expect(result.success).toBe(true);
    });

    it('should validate state with trigger events', () => {
      const state: WorkingMemoryState = {
        ...validState,
        trigger_events: [
          { type: 'user_access', timestamp: new Date(), score_contribution: 0.4 },
        ],
        promotion_score: 0.4,
      };
      const result = WorkingMemoryStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    it('should validate promoted state with resolved_at', () => {
      const state: WorkingMemoryState = {
        ...validState,
        status: 'promoted',
        resolved_at: new Date(),
        resolution_reason: 'Score >= threshold',
        promotion_score: 0.6,
      };
      const result = WorkingMemoryStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const state = {
        ...validState,
        status: 'invalid_status',
      };
      const result = WorkingMemoryStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });

    it('should reject promotion_score > 1', () => {
      const state = {
        ...validState,
        promotion_score: 1.5,
      };
      const result = WorkingMemoryStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });

    it('should reject negative promotion_score', () => {
      const state = {
        ...validState,
        promotion_score: -0.1,
      };
      const result = WorkingMemoryStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });
  });

  describe('WorkingMemoryConfigSchema', () => {
    it('should validate a valid config', () => {
      const config: WorkingMemoryConfig = {
        duration_hours: { general: 24 },
        user_duration_multiplier: 1.0,
        promotion_threshold: 0.5,
        score_decay_per_day: 0.1,
        check_interval_minutes: 60,
        manual_bypass: true,
      };
      const result = WorkingMemoryConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject multiplier below minimum', () => {
      const config = {
        duration_hours: { general: 24 },
        user_duration_multiplier: 0.3, // Below 0.5 minimum
        promotion_threshold: 0.5,
        score_decay_per_day: 0.1,
        check_interval_minutes: 60,
        manual_bypass: true,
      };
      const result = WorkingMemoryConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject multiplier above maximum', () => {
      const config = {
        duration_hours: { general: 24 },
        user_duration_multiplier: 2.5, // Above 2.0 maximum
        promotion_threshold: 0.5,
        score_decay_per_day: 0.1,
        check_interval_minutes: 60,
        manual_bypass: true,
      };
      const result = WorkingMemoryConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('WMEntryOptionsSchema', () => {
    it('should validate minimal entry options', () => {
      const options: WMEntryOptions = {
        contentCategory: 'general',
      };
      const result = WMEntryOptionsSchema.safeParse(options);
      expect(result.success).toBe(true);
    });

    it('should validate full entry options', () => {
      const options: WMEntryOptions = {
        contentCategory: 'identity',
        initialScore: 0.2,
        durationMultiplier: 1.5,
        skipIfExists: true,
      };
      const result = WMEntryOptionsSchema.safeParse(options);
      expect(result.success).toBe(true);
    });
  });

  describe('ScoreCalculationInputSchema', () => {
    it('should validate score calculation input', () => {
      const input: ScoreCalculationInput = {
        promotionScore: 0.4,
        scoreLastUpdated: new Date(),
      };
      const result = ScoreCalculationInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate with optional now parameter', () => {
      const input: ScoreCalculationInput = {
        promotionScore: 0.4,
        scoreLastUpdated: new Date(),
        now: new Date(),
      };
      const result = ScoreCalculationInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================
// TEST CATEGORY 3: SCORE MANAGEMENT (~10 tests)
// ============================================================

describe('Score Management', () => {
  describe('hoursBetween', () => {
    it('should calculate hours between two dates', () => {
      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-01T12:00:00Z');
      expect(hoursBetween(start, end)).toBe(12);
    });

    it('should return negative for reversed dates', () => {
      const start = new Date('2026-01-01T12:00:00Z');
      const end = new Date('2026-01-01T00:00:00Z');
      expect(hoursBetween(start, end)).toBe(-12);
    });
  });

  describe('daysBetween', () => {
    it('should calculate days between two dates', () => {
      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-03T00:00:00Z');
      expect(daysBetween(start, end)).toBe(2);
    });

    it('should handle fractional days', () => {
      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-01T12:00:00Z');
      expect(daysBetween(start, end)).toBe(0.5);
    });
  });

  describe('calculateCurrentScore', () => {
    it('should return original score with no time elapsed', () => {
      const now = new Date();
      const score = calculateCurrentScore({
        promotionScore: 0.4,
        scoreLastUpdated: now,
        now,
      });
      expect(score).toBe(0.4);
    });

    it('should apply decay after 1 day', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const score = calculateCurrentScore({
        promotionScore: 0.4,
        scoreLastUpdated: yesterday,
      });
      expect(score).toBeCloseTo(0.3, 5); // 0.4 - 0.1 = 0.3
    });

    it('should apply decay after 2 days', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const score = calculateCurrentScore({
        promotionScore: 0.5,
        scoreLastUpdated: twoDaysAgo,
      });
      expect(score).toBeCloseTo(0.3, 5); // 0.5 - 0.2 = 0.3
    });

    it('should floor score at 0', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const score = calculateCurrentScore({
        promotionScore: 0.4,
        scoreLastUpdated: tenDaysAgo,
      });
      expect(score).toBe(0); // Would be -0.6 but floored at 0
    });

    it('should handle partial day decay', () => {
      const halfDayAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
      const score = calculateCurrentScore({
        promotionScore: 0.4,
        scoreLastUpdated: halfDayAgo,
      });
      expect(score).toBeCloseTo(0.35, 5); // 0.4 - 0.05 = 0.35
    });
  });

  describe('shouldPromote', () => {
    it('should return true when score >= threshold', () => {
      const now = new Date();
      const wmState: WorkingMemoryState = {
        entered_at: now,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.5,
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };
      expect(shouldPromote(wmState)).toBe(true);
    });

    it('should return false when score < threshold', () => {
      const now = new Date();
      const wmState: WorkingMemoryState = {
        entered_at: now,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.4,
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };
      expect(shouldPromote(wmState)).toBe(false);
    });

    it('should account for decay when checking promotion', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const now = new Date();
      const wmState: WorkingMemoryState = {
        entered_at: yesterday,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.55, // Would be 0.45 after 1 day decay
        score_last_updated: yesterday,
        trigger_events: [],
        status: 'pending',
      };
      expect(shouldPromote(wmState)).toBe(false); // 0.55 - 0.1 = 0.45 < 0.5
    });
  });
});

// ============================================================
// TEST CATEGORY 4: TRIGGER EVENTS (~15 tests)
// ============================================================

describe('Trigger Events', () => {
  describe('recordTriggerEvent', () => {
    let baseState: WorkingMemoryState;

    beforeEach(() => {
      const now = new Date();
      baseState = {
        entered_at: now,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.0,
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };
    });

    it('should add user_access score (0.4)', () => {
      const { updatedState, shouldPromote } = recordTriggerEvent(baseState, 'user_access');
      expect(updatedState.promotion_score).toBe(0.4);
      expect(updatedState.trigger_events).toHaveLength(1);
      expect(updatedState.trigger_events[0].type).toBe('user_access');
      expect(shouldPromote).toBe(false); // 0.4 < 0.5
    });

    it('should add query_activation score (0.2)', () => {
      const { updatedState } = recordTriggerEvent(baseState, 'query_activation');
      expect(updatedState.promotion_score).toBe(0.2);
    });

    it('should add important_connection score (0.3)', () => {
      const { updatedState } = recordTriggerEvent(baseState, 'important_connection');
      expect(updatedState.promotion_score).toBe(0.3);
    });

    it('should add high_confidence score (0.2)', () => {
      const { updatedState } = recordTriggerEvent(baseState, 'high_confidence');
      expect(updatedState.promotion_score).toBe(0.2);
    });

    it('should trigger instant promotion for explicit_save', () => {
      const { updatedState, shouldPromote } = recordTriggerEvent(baseState, 'explicit_save');
      expect(updatedState.promotion_score).toBe(1.0);
      expect(shouldPromote).toBe(true);
    });

    it('should accumulate scores from multiple triggers', () => {
      let state = baseState;
      const result1 = recordTriggerEvent(state, 'user_access');
      state = result1.updatedState;
      const result2 = recordTriggerEvent(state, 'query_activation');

      expect(result2.updatedState.promotion_score).toBeCloseTo(0.6, 5); // 0.4 + 0.2
      expect(result2.updatedState.trigger_events).toHaveLength(2);
    });

    it('should trigger promotion when accumulated score >= threshold', () => {
      let state = baseState;
      const result1 = recordTriggerEvent(state, 'user_access'); // 0.4
      state = result1.updatedState;
      const result2 = recordTriggerEvent(state, 'important_connection'); // 0.3

      expect(result2.shouldPromote).toBe(true); // 0.4 + 0.3 = 0.7 >= 0.5
    });

    it('should cap score at 1.0', () => {
      let state = { ...baseState, promotion_score: 0.9 };
      const { updatedState } = recordTriggerEvent(state, 'user_access'); // +0.4
      expect(updatedState.promotion_score).toBe(1.0); // Capped, not 1.3
    });

    it('should include details in trigger event', () => {
      const details = { query: 'test query', activation_score: 0.75 };
      const { updatedState } = recordTriggerEvent(baseState, 'query_activation', details);
      expect(updatedState.trigger_events[0].details).toEqual(details);
    });

    it('should update score_last_updated timestamp', () => {
      const oldTimestamp = baseState.score_last_updated;
      const { updatedState } = recordTriggerEvent(baseState, 'user_access');
      expect(updatedState.score_last_updated.getTime()).toBeGreaterThanOrEqual(oldTimestamp.getTime());
    });

    it('should apply decay before adding new score', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const staleState: WorkingMemoryState = {
        ...baseState,
        promotion_score: 0.4,
        score_last_updated: yesterday,
      };

      const { updatedState } = recordTriggerEvent(staleState, 'query_activation');
      // Decayed score: 0.4 - 0.1 = 0.3, then add 0.2 = 0.5
      expect(updatedState.promotion_score).toBeCloseTo(0.5, 5);
    });

    it('should record correct score_contribution in event', () => {
      const { updatedState } = recordTriggerEvent(baseState, 'important_connection');
      expect(updatedState.trigger_events[0].score_contribution).toBe(0.3);
    });

    it('should handle multiple triggers of same type', () => {
      let state = baseState;
      const result1 = recordTriggerEvent(state, 'query_activation'); // 0.2
      state = result1.updatedState;
      const result2 = recordTriggerEvent(state, 'query_activation'); // +0.2

      expect(result2.updatedState.promotion_score).toBeCloseTo(0.4, 5);
      expect(result2.updatedState.trigger_events).toHaveLength(2);
    });
  });
});

// ============================================================
// TEST CATEGORY 5: LIFECYCLE TRANSITIONS (~15 tests)
// ============================================================

describe('Lifecycle Transitions', () => {
  describe('createWorkingMemoryState', () => {
    it('should create state with correct initial values', () => {
      const options: WMEntryOptions = { contentCategory: 'general' };
      const state = createWorkingMemoryState(options);

      expect(state.status).toBe('pending');
      expect(state.promotion_score).toBe(0);
      expect(state.content_category).toBe('general');
      expect(state.trigger_events).toEqual([]);
    });

    it('should set correct expiration for conversation (6h)', () => {
      const options: WMEntryOptions = { contentCategory: 'conversation' };
      const state = createWorkingMemoryState(options);

      const expectedDuration = 6 * 60 * 60 * 1000;
      const actualDuration = state.expires_at.getTime() - state.entered_at.getTime();
      expect(actualDuration).toBeCloseTo(expectedDuration, -3); // Within 1 second
    });

    it('should set correct expiration for identity (48h)', () => {
      const options: WMEntryOptions = { contentCategory: 'identity' };
      const state = createWorkingMemoryState(options);

      const expectedDuration = 48 * 60 * 60 * 1000;
      const actualDuration = state.expires_at.getTime() - state.entered_at.getTime();
      expect(actualDuration).toBeCloseTo(expectedDuration, -3);
    });

    it('should set correct expiration for document (48h)', () => {
      const options: WMEntryOptions = { contentCategory: 'document' };
      const state = createWorkingMemoryState(options);

      const expectedDuration = 48 * 60 * 60 * 1000;
      const actualDuration = state.expires_at.getTime() - state.entered_at.getTime();
      expect(actualDuration).toBeCloseTo(expectedDuration, -3);
    });

    it('should apply duration multiplier', () => {
      const options: WMEntryOptions = {
        contentCategory: 'general', // 24h base
        durationMultiplier: 2.0,
      };
      const state = createWorkingMemoryState(options);

      const expectedDuration = 48 * 60 * 60 * 1000; // 24h * 2.0
      const actualDuration = state.expires_at.getTime() - state.entered_at.getTime();
      expect(actualDuration).toBeCloseTo(expectedDuration, -3);
    });

    it('should clamp multiplier to minimum (0.5)', () => {
      const options: WMEntryOptions = {
        contentCategory: 'general', // 24h base
        durationMultiplier: 0.1, // Below minimum
      };
      const state = createWorkingMemoryState(options);

      const expectedDuration = 12 * 60 * 60 * 1000; // 24h * 0.5 (clamped)
      const actualDuration = state.expires_at.getTime() - state.entered_at.getTime();
      expect(actualDuration).toBeCloseTo(expectedDuration, -3);
    });

    it('should clamp multiplier to maximum (2.0)', () => {
      const options: WMEntryOptions = {
        contentCategory: 'general', // 24h base
        durationMultiplier: 5.0, // Above maximum
      };
      const state = createWorkingMemoryState(options);

      const expectedDuration = 48 * 60 * 60 * 1000; // 24h * 2.0 (clamped)
      const actualDuration = state.expires_at.getTime() - state.entered_at.getTime();
      expect(actualDuration).toBeCloseTo(expectedDuration, -3);
    });

    it('should set initial score if provided', () => {
      const options: WMEntryOptions = {
        contentCategory: 'general',
        initialScore: 0.2, // high_confidence
      };
      const state = createWorkingMemoryState(options);
      expect(state.promotion_score).toBe(0.2);
    });

    it('should use general duration for unknown category', () => {
      const options: WMEntryOptions = { contentCategory: 'unknown_category' };
      const state = createWorkingMemoryState(options);

      const expectedDuration = 24 * 60 * 60 * 1000; // general = 24h
      const actualDuration = state.expires_at.getTime() - state.entered_at.getTime();
      expect(actualDuration).toBeCloseTo(expectedDuration, -3);
    });
  });

  describe('promoteNode', () => {
    let pendingState: WorkingMemoryState;

    beforeEach(() => {
      const now = new Date();
      pendingState = {
        entered_at: new Date(now.getTime() - 12 * 60 * 60 * 1000), // 12h ago
        expires_at: new Date(now.getTime() + 12 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.6,
        score_last_updated: now,
        trigger_events: [
          { type: 'user_access', timestamp: now, score_contribution: 0.4 },
          { type: 'query_activation', timestamp: now, score_contribution: 0.2 },
        ],
        status: 'pending',
      };
    });

    it('should return PromotionResult with correct nodeId', async () => {
      const result = await promoteNode('node-123', pendingState);
      expect(result.nodeId).toBe('node-123');
    });

    it('should return final score', async () => {
      const result = await promoteNode('node-123', pendingState);
      expect(result.finalScore).toBeCloseTo(0.6, 5);
    });

    it('should calculate duration in hours', async () => {
      const result = await promoteNode('node-123', pendingState);
      expect(result.durationHours).toBeCloseTo(12, 0);
    });

    it('should count trigger events', async () => {
      const result = await promoteNode('node-123', pendingState);
      expect(result.triggerCount).toBe(2);
    });

    it('should include reason', async () => {
      const result = await promoteNode('node-123', pendingState, 'User explicit save');
      expect(result.reason).toBe('User explicit save');
    });

    it('should return initialStability based on node type', async () => {
      const result = await promoteNode('node-123', pendingState);
      expect(result.initialStability).toBeGreaterThan(0);
    });
  });

  describe('fadeNode', () => {
    let expiredState: WorkingMemoryState;

    beforeEach(() => {
      const now = new Date();
      expiredState = {
        entered_at: new Date(now.getTime() - 48 * 60 * 60 * 1000), // 48h ago
        expires_at: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Expired 24h ago
        content_category: 'general',
        promotion_score: 0.3,
        score_last_updated: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        trigger_events: [],
        status: 'pending',
      };
    });

    it('should return FadeResult with correct nodeId', async () => {
      const result = await fadeNode('node-456', expiredState);
      expect(result.nodeId).toBe('node-456');
    });

    it('should return final score with decay', async () => {
      const result = await fadeNode('node-456', expiredState);
      // Score decayed from 0.3 over 1 day = 0.2
      expect(result.finalScore).toBeCloseTo(0.2, 5);
    });

    it('should include fade reason', async () => {
      const result = await fadeNode('node-456', expiredState);
      expect(result.reason).toContain('Expired');
    });
  });

  describe('restoreFromDormant', () => {
    it('should return RestorationResult with correct nodeId', async () => {
      const result = await restoreFromDormant('node-789', 'general');
      expect(result.nodeId).toBe('node-789');
    });

    it('should set initialStability based on category', async () => {
      const result = await restoreFromDormant('node-789', 'identity');
      expect(result.initialStability).toBeGreaterThan(0);
    });

    it('should apply strength bonus on restoration', async () => {
      const result = await restoreFromDormant('node-789', 'general');
      expect(result.newStrength).toBe(0.5 + RESTORED_STRENGTH_BONUS);
    });
  });

  describe('mapCategoryToNodeType', () => {
    it('should map identity to person', () => {
      expect(mapCategoryToNodeType('identity')).toBe('person');
    });

    it('should map academic to concept', () => {
      expect(mapCategoryToNodeType('academic')).toBe('concept');
    });

    it('should map work to note', () => {
      expect(mapCategoryToNodeType('work')).toBe('note');
    });

    it('should default to fact for unknown categories', () => {
      expect(mapCategoryToNodeType('unknown')).toBe('fact');
    });
  });
});

// ============================================================
// TEST CATEGORY 6: EVALUATION (~10 tests)
// ============================================================

describe('Evaluation', () => {
  describe('evaluateNode', () => {
    it('should return "promoted" when score >= threshold', async () => {
      const now = new Date();
      const state: WorkingMemoryState = {
        entered_at: now,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.6,
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };

      const result = await evaluateNode(state, now);
      expect(result).toBe('promoted');
    });

    it('should return "faded" when expired and score < threshold', async () => {
      const now = new Date();
      const state: WorkingMemoryState = {
        entered_at: new Date(now.getTime() - 48 * 60 * 60 * 1000),
        expires_at: new Date(now.getTime() - 1000), // Already expired
        content_category: 'general',
        promotion_score: 0.3,
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };

      const result = await evaluateNode(state, now);
      expect(result).toBe('faded');
    });

    it('should return "pending" when not expired and score < threshold', async () => {
      const now = new Date();
      const state: WorkingMemoryState = {
        entered_at: now,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.3,
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };

      const result = await evaluateNode(state, now);
      expect(result).toBe('pending');
    });

    it('should return existing status for non-pending nodes', async () => {
      const now = new Date();
      const promotedState: WorkingMemoryState = {
        entered_at: now,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.6,
        score_last_updated: now,
        trigger_events: [],
        status: 'promoted',
      };

      const result = await evaluateNode(promotedState, now);
      expect(result).toBe('promoted');
    });

    it('should account for score decay in evaluation', async () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const state: WorkingMemoryState = {
        entered_at: twoDaysAgo,
        expires_at: new Date(now.getTime() - 1000), // Expired
        content_category: 'general',
        promotion_score: 0.6, // Would be 0.4 after 2 days decay
        score_last_updated: twoDaysAgo,
        trigger_events: [],
        status: 'pending',
      };

      const result = await evaluateNode(state, now);
      expect(result).toBe('faded'); // 0.6 - 0.2 = 0.4 < 0.5
    });
  });

  describe('evaluateWorkingMemory', () => {
    it('should return empty result for empty input', async () => {
      const result = await evaluateWorkingMemory([]);
      expect(result.evaluated).toBe(0);
      expect(result.promoted).toBe(0);
      expect(result.faded).toBe(0);
      expect(result.stillPending).toBe(0);
    });

    it('should count promoted nodes', async () => {
      const now = new Date();
      const nodes = [
        {
          id: 'node-1',
          working_memory: {
            entered_at: now,
            expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            content_category: 'general',
            promotion_score: 0.6,
            score_last_updated: now,
            trigger_events: [],
            status: 'pending' as const,
          },
        },
      ];

      const result = await evaluateWorkingMemory(nodes);
      expect(result.evaluated).toBe(1);
      expect(result.promoted).toBe(1);
    });

    it('should count faded nodes', async () => {
      const now = new Date();
      const nodes = [
        {
          id: 'node-1',
          working_memory: {
            entered_at: new Date(now.getTime() - 48 * 60 * 60 * 1000),
            expires_at: new Date(now.getTime() - 1000),
            content_category: 'general',
            promotion_score: 0.3,
            score_last_updated: now,
            trigger_events: [],
            status: 'pending' as const,
          },
        },
      ];

      const result = await evaluateWorkingMemory(nodes);
      expect(result.evaluated).toBe(1);
      expect(result.faded).toBe(1);
    });

    it('should count still pending nodes', async () => {
      const now = new Date();
      const nodes = [
        {
          id: 'node-1',
          working_memory: {
            entered_at: now,
            expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            content_category: 'general',
            promotion_score: 0.3,
            score_last_updated: now,
            trigger_events: [],
            status: 'pending' as const,
          },
        },
      ];

      const result = await evaluateWorkingMemory(nodes);
      expect(result.evaluated).toBe(1);
      expect(result.stillPending).toBe(1);
    });

    it('should process multiple nodes correctly', async () => {
      const now = new Date();
      const nodes = [
        {
          id: 'promoted-node',
          working_memory: {
            entered_at: now,
            expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            content_category: 'general',
            promotion_score: 0.6,
            score_last_updated: now,
            trigger_events: [],
            status: 'pending' as const,
          },
        },
        {
          id: 'faded-node',
          working_memory: {
            entered_at: new Date(now.getTime() - 48 * 60 * 60 * 1000),
            expires_at: new Date(now.getTime() - 1000),
            content_category: 'general',
            promotion_score: 0.2,
            score_last_updated: now,
            trigger_events: [],
            status: 'pending' as const,
          },
        },
        {
          id: 'pending-node',
          working_memory: {
            entered_at: now,
            expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            content_category: 'general',
            promotion_score: 0.3,
            score_last_updated: now,
            trigger_events: [],
            status: 'pending' as const,
          },
        },
      ];

      const result = await evaluateWorkingMemory(nodes);
      expect(result.evaluated).toBe(3);
      expect(result.promoted).toBe(1);
      expect(result.faded).toBe(1);
      expect(result.stillPending).toBe(1);
    });

    it('should include duration in result', async () => {
      const result = await evaluateWorkingMemory([]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================
// TEST CATEGORY 7: INTEGRATION TESTS (~10 tests)
// ============================================================

describe('Integration', () => {
  describe('Full lifecycle: Enter → Trigger → Promote', () => {
    it('should complete full promotion lifecycle', async () => {
      // Step 1: Create Working Memory state
      const state = createWorkingMemoryState({ contentCategory: 'general' });
      expect(state.status).toBe('pending');
      expect(state.promotion_score).toBe(0);

      // Step 2: Add user_access trigger (0.4)
      const afterUserAccess = recordTriggerEvent(state, 'user_access');
      expect(afterUserAccess.updatedState.promotion_score).toBe(0.4);
      expect(afterUserAccess.shouldPromote).toBe(false);

      // Step 3: Add important_connection trigger (0.3)
      const afterConnection = recordTriggerEvent(
        afterUserAccess.updatedState,
        'important_connection'
      );
      expect(afterConnection.updatedState.promotion_score).toBeCloseTo(0.7, 5);
      expect(afterConnection.shouldPromote).toBe(true); // 0.7 >= 0.5

      // Step 4: Promote
      const promotionResult = await promoteNode('node-full', afterConnection.updatedState);
      expect(promotionResult.finalScore).toBeCloseTo(0.7, 5);
      expect(promotionResult.triggerCount).toBe(2);
    });
  });

  describe('Full lifecycle: Enter → Expire → Fade', () => {
    it('should complete full fade lifecycle', async () => {
      // Step 1: Create state that appears to have expired
      const now = new Date();
      const expiredState: WorkingMemoryState = {
        entered_at: new Date(now.getTime() - 48 * 60 * 60 * 1000),
        expires_at: new Date(now.getTime() - 1000),
        content_category: 'conversation',
        promotion_score: 0.2, // Below threshold
        score_last_updated: now,
        trigger_events: [
          { type: 'query_activation', timestamp: now, score_contribution: 0.2 },
        ],
        status: 'pending',
      };

      // Step 2: Evaluate
      const decision = await evaluateNode(expiredState, now);
      expect(decision).toBe('faded');

      // Step 3: Fade
      const fadeResult = await fadeNode('node-fade', expiredState);
      expect(fadeResult.finalScore).toBeLessThan(PROMOTION_THRESHOLD);
    });
  });

  describe('Explicit save instant promotion', () => {
    it('should instantly promote on explicit_save', () => {
      const state = createWorkingMemoryState({ contentCategory: 'general' });
      const { updatedState, shouldPromote } = recordTriggerEvent(state, 'explicit_save');

      expect(updatedState.promotion_score).toBe(1.0);
      expect(shouldPromote).toBe(true);
    });
  });

  describe('Duration by content type', () => {
    it('should use correct durations for each category', () => {
      const categories = ['identity', 'academic', 'conversation', 'work', 'temporal', 'document', 'general'];
      const expectedHours = [48, 24, 6, 24, 12, 48, 24];

      categories.forEach((category, i) => {
        const state = createWorkingMemoryState({ contentCategory: category });
        const duration = hoursBetween(state.entered_at, state.expires_at);
        expect(duration).toBeCloseTo(expectedHours[i], 0);
      });
    });
  });

  describe('getWorkingMemoryDuration', () => {
    it('should return correct duration for each category', () => {
      expect(getWorkingMemoryDuration('identity')).toBe(48);
      expect(getWorkingMemoryDuration('academic')).toBe(24);
      expect(getWorkingMemoryDuration('conversation')).toBe(6);
      expect(getWorkingMemoryDuration('work')).toBe(24);
      expect(getWorkingMemoryDuration('temporal')).toBe(12);
      expect(getWorkingMemoryDuration('document')).toBe(48);
      expect(getWorkingMemoryDuration('general')).toBe(24);
    });

    it('should apply multiplier', () => {
      expect(getWorkingMemoryDuration('general', 2.0)).toBe(48);
      expect(getWorkingMemoryDuration('general', 0.5)).toBe(12);
    });
  });

  describe('Helper functions', () => {
    it('isInWorkingMemory should detect pending nodes', () => {
      const now = new Date();
      const pendingNode = {
        working_memory: {
          entered_at: now,
          expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          content_category: 'general',
          promotion_score: 0.3,
          score_last_updated: now,
          trigger_events: [],
          status: 'pending' as const,
        },
      };
      expect(isInWorkingMemory(pendingNode)).toBe(true);
    });

    it('isInWorkingMemory should return false for promoted nodes', () => {
      const now = new Date();
      const promotedNode = {
        working_memory: {
          entered_at: now,
          expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          content_category: 'general',
          promotion_score: 0.6,
          score_last_updated: now,
          trigger_events: [],
          status: 'promoted' as const,
        },
      };
      expect(isInWorkingMemory(promotedNode)).toBe(false);
    });

    it('getTimeRemaining should return positive hours for active trial', () => {
      const now = new Date();
      const state: WorkingMemoryState = {
        entered_at: now,
        expires_at: new Date(now.getTime() + 12 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.3,
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };
      const remaining = getTimeRemaining(state);
      expect(remaining).toBeGreaterThan(11);
      expect(remaining).toBeLessThanOrEqual(12);
    });

    it('getTimeRemaining should return 0 for expired trial', () => {
      const now = new Date();
      const state: WorkingMemoryState = {
        entered_at: new Date(now.getTime() - 48 * 60 * 60 * 1000),
        expires_at: new Date(now.getTime() - 1000),
        content_category: 'general',
        promotion_score: 0.3,
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };
      expect(getTimeRemaining(state)).toBe(0);
    });

    it('getPromotionProgress should calculate percentage', () => {
      const now = new Date();
      const state: WorkingMemoryState = {
        entered_at: now,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.25, // 50% of 0.5 threshold
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };
      expect(getPromotionProgress(state)).toBe(50);
    });

    it('getPromotionProgress should cap at 100%', () => {
      const now = new Date();
      const state: WorkingMemoryState = {
        entered_at: now,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.8, // 160% of threshold
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };
      expect(getPromotionProgress(state)).toBe(100);
    });
  });

  describe('State marking functions', () => {
    it('markAsPromoted should update state correctly', () => {
      const now = new Date();
      const state: WorkingMemoryState = {
        entered_at: now,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.6,
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };

      const promoted = markAsPromoted(state, 'Score reached threshold');
      expect(promoted.status).toBe('promoted');
      expect(promoted.resolution_reason).toBe('Score reached threshold');
      expect(promoted.resolved_at).toBeDefined();
    });

    it('markAsFaded should update state correctly', () => {
      const now = new Date();
      const state: WorkingMemoryState = {
        entered_at: now,
        expires_at: new Date(now.getTime() - 1000),
        content_category: 'general',
        promotion_score: 0.3,
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };

      const faded = markAsFaded(state, 'Expired without promotion');
      expect(faded.status).toBe('faded');
      expect(faded.resolution_reason).toBe('Expired without promotion');
      expect(faded.resolved_at).toBeDefined();
    });
  });

  describe('validateWorkingMemoryState', () => {
    it('should return true for valid state', () => {
      const now = new Date();
      const state: WorkingMemoryState = {
        entered_at: now,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        content_category: 'general',
        promotion_score: 0.3,
        score_last_updated: now,
        trigger_events: [],
        status: 'pending',
      };
      expect(validateWorkingMemoryState(state)).toBe(true);
    });

    it('should return false for invalid state', () => {
      const invalidState = {
        entered_at: 'not a date',
        status: 'invalid',
      };
      expect(validateWorkingMemoryState(invalidState)).toBe(false);
    });
  });
});
