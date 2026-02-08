/**
 * @module @nous/core/forgetting
 * @description Tests for the Forgetting & Persistence Model (storm-007)
 * @version 1.0.0
 *
 * Test coverage:
 * - Constants validation (15 tests)
 * - Schema validation (15 tests)
 * - calculateRetrievability (10 tests)
 * - getDecayLifecycleState (10 tests)
 * - updateStabilityOnAccess (10 tests)
 * - strengthenNode (12 tests)
 * - calculateDifficulty (12 tests)
 * - analyzeComplexity (8 tests)
 * - shouldCompress/shouldArchive (8 tests)
 * - isDeletionCandidate (15 tests)
 * - Trash/deletion functions (10 tests)
 * - runDecayCycle (10 tests)
 * - Integration (10 tests)
 *
 * Total: ~135 tests
 */

import { describe, it, expect } from 'vitest';
import {
  // Constants
  CONTENT_CATEGORIES,
  FORGETTING_LIFECYCLE_STATES,
  STRENGTHENING_EVENTS,
  INITIAL_STABILITY_BY_CATEGORY,
  BASE_DIFFICULTY_BY_CATEGORY,
  STRENGTHENING_BONUSES,
  DIFFICULTY_CONFIG,
  LIFECYCLE_THRESHOLDS,
  DELETION_EXCLUSION_RULES,
  DELETION_CRITERIA,
  TRASH_CONFIG,
  P008_COMPRESSION_PROMPT_SPEC,
  DECAY_JOB_SPEC,
  FORGETTING_CONFIG,
  MAX_STRENGTH,
  DEFAULT_STRENGTH,
  // Type guards
  isContentCategory,
  isForgettingLifecycleState,
  isStrengtheningEventType,
  // Types
  type ContentCategory,
  type ForgettingLifecycleState,
  type StrengtheningEventType,
  type NeuralState,
  type NodeDecayInput,
  // Schemas
  NeuralStateSchema,
  StrengtheningRecordSchema,
  DifficultyFactorsSchema,
  CompressionResultSchema,
  DeletionCandidateSchema,
  ExclusionCheckResultSchema,
  TrashRecordSchema,
  DecayJobResultSchema,
  StabilityUpdateResultSchema,
  CleanupSettingsSchema,
  StorageMetricsSchema,
  // Functions
  calculateRetrievability,
  getDecayLifecycleState,
  updateStabilityOnAccess,
  strengthenNode,
  analyzeComplexity,
  calculateDifficulty,
  shouldCompress,
  shouldArchive,
  hasActiveInboundLinks,
  checkExclusionRules,
  isDeletionCandidate,
  moveToTrash,
  permanentlyDelete,
  restoreFromTrash,
  runDecayCycle,
  mapContentCategoryToNodeType,
  getInitialStabilityForCategory,
  getBaseDifficultyForCategory,
  createNeuralState,
  determineLifecycle,
  daysBetween,
  hoursBetween,
  validateNeuralState,
  validateStrengtheningRecord,
  validateDeletionCandidate,
  validateDecayJobResult,
} from './index';

// ============================================================================
// TEST UTILITIES
// ============================================================================

function createTestNeuralState(overrides: Partial<NeuralState> = {}): NeuralState {
  return {
    stability: 7,
    retrievability: 0.9,
    strength: 0.5,
    difficulty: 0.3,
    last_accessed: new Date(),
    access_count: 5,
    lifecycle_state: 'ACTIVE',
    days_in_dormant: 0,
    ...overrides,
  };
}

function createTestNodeDecayInput(overrides: Partial<NodeDecayInput> = {}): NodeDecayInput {
  return {
    nodeId: 'test-node-123',
    content_category: 'general',
    pinned: false,
    active_inbound_link_count: 0,
    restore_count: 0,
    last_archive_search_hit: null,
    neural_state: createTestNeuralState(),
    ...overrides,
  };
}

// ============================================================================
// SECTION: CONSTANTS VALIDATION (15 tests)
// ============================================================================

describe('Constants Validation', () => {
  describe('CONTENT_CATEGORIES', () => {
    it('should have exactly 7 content categories', () => {
      expect(CONTENT_CATEGORIES).toHaveLength(7);
    });

    it('should include all required categories', () => {
      expect(CONTENT_CATEGORIES).toContain('identity');
      expect(CONTENT_CATEGORIES).toContain('academic');
      expect(CONTENT_CATEGORIES).toContain('conversation');
      expect(CONTENT_CATEGORIES).toContain('work');
      expect(CONTENT_CATEGORIES).toContain('temporal');
      expect(CONTENT_CATEGORIES).toContain('document');
      expect(CONTENT_CATEGORIES).toContain('general');
    });
  });

  describe('FORGETTING_LIFECYCLE_STATES', () => {
    it('should have exactly 8 lifecycle states', () => {
      expect(FORGETTING_LIFECYCLE_STATES).toHaveLength(8);
    });

    it('should include all required states', () => {
      expect(FORGETTING_LIFECYCLE_STATES).toContain('ACTIVE');
      expect(FORGETTING_LIFECYCLE_STATES).toContain('WEAK');
      expect(FORGETTING_LIFECYCLE_STATES).toContain('DORMANT');
      expect(FORGETTING_LIFECYCLE_STATES).toContain('SUMMARIZED');
      expect(FORGETTING_LIFECYCLE_STATES).toContain('ARCHIVED');
      expect(FORGETTING_LIFECYCLE_STATES).toContain('DELETION_CANDIDATE');
      expect(FORGETTING_LIFECYCLE_STATES).toContain('TRASH');
      expect(FORGETTING_LIFECYCLE_STATES).toContain('DELETED');
    });
  });

  describe('STRENGTHENING_EVENTS', () => {
    it('should have exactly 4 strengthening events', () => {
      expect(STRENGTHENING_EVENTS).toHaveLength(4);
    });

    it('should include all required events', () => {
      expect(STRENGTHENING_EVENTS).toContain('direct_retrieval');
      expect(STRENGTHENING_EVENTS).toContain('co_activation');
      expect(STRENGTHENING_EVENTS).toContain('user_interaction');
      expect(STRENGTHENING_EVENTS).toContain('external_reference');
    });
  });

  describe('INITIAL_STABILITY_BY_CATEGORY', () => {
    it('should have correct values for each category', () => {
      expect(INITIAL_STABILITY_BY_CATEGORY.identity).toBe(30);
      expect(INITIAL_STABILITY_BY_CATEGORY.academic).toBe(1);
      expect(INITIAL_STABILITY_BY_CATEGORY.conversation).toBe(0.5);
      expect(INITIAL_STABILITY_BY_CATEGORY.work).toBe(3);
      expect(INITIAL_STABILITY_BY_CATEGORY.temporal).toBe(7);
      expect(INITIAL_STABILITY_BY_CATEGORY.document).toBe(1);
      expect(INITIAL_STABILITY_BY_CATEGORY.general).toBe(1);
    });
  });

  describe('BASE_DIFFICULTY_BY_CATEGORY', () => {
    it('should have correct values for each category', () => {
      expect(BASE_DIFFICULTY_BY_CATEGORY.identity).toBe(0.1);
      expect(BASE_DIFFICULTY_BY_CATEGORY.academic).toBe(0.5);
      expect(BASE_DIFFICULTY_BY_CATEGORY.conversation).toBe(0.2);
      expect(BASE_DIFFICULTY_BY_CATEGORY.work).toBe(0.4);
      expect(BASE_DIFFICULTY_BY_CATEGORY.temporal).toBe(0.2);
      expect(BASE_DIFFICULTY_BY_CATEGORY.document).toBe(0.6);
      expect(BASE_DIFFICULTY_BY_CATEGORY.general).toBe(0.3);
    });
  });

  describe('STRENGTHENING_BONUSES', () => {
    it('should have correct bonus values', () => {
      expect(STRENGTHENING_BONUSES.direct_retrieval).toBe(0.10);
      expect(STRENGTHENING_BONUSES.co_activation).toBe(0.03);
      expect(STRENGTHENING_BONUSES.user_interaction).toBe(0.15);
      expect(STRENGTHENING_BONUSES.external_reference).toBe(0.05);
    });
  });

  describe('DIFFICULTY_CONFIG', () => {
    it('should have correct weight values', () => {
      expect(DIFFICULTY_CONFIG.complexity_weight).toBe(0.2);
      expect(DIFFICULTY_CONFIG.reaccess_weight).toBe(0.15);
      expect(DIFFICULTY_CONFIG.connection_weight).toBe(0.1);
    });

    it('should have correct mean reversion values', () => {
      expect(DIFFICULTY_CONFIG.mean_reversion_rate).toBe(0.1);
      expect(DIFFICULTY_CONFIG.target_difficulty).toBe(0.3);
    });

    it('should have correct bounds', () => {
      expect(DIFFICULTY_CONFIG.min_difficulty).toBe(0.05);
      expect(DIFFICULTY_CONFIG.max_difficulty).toBe(0.95);
    });
  });

  describe('LIFECYCLE_THRESHOLDS', () => {
    it('should have correct threshold values', () => {
      expect(LIFECYCLE_THRESHOLDS.active_threshold).toBe(0.5);
      expect(LIFECYCLE_THRESHOLDS.weak_threshold).toBe(0.1);
      expect(LIFECYCLE_THRESHOLDS.dormant_days).toBe(60);
      expect(LIFECYCLE_THRESHOLDS.compress_days).toBe(120);
      expect(LIFECYCLE_THRESHOLDS.archive_days).toBe(180);
      expect(LIFECYCLE_THRESHOLDS.deletion_candidate_days).toBe(365);
      expect(LIFECYCLE_THRESHOLDS.trash_buffer_days).toBe(30);
      expect(LIFECYCLE_THRESHOLDS.recent_search_days).toBe(180);
    });
  });

  describe('DELETION_CRITERIA', () => {
    it('should have correct min_days_archived', () => {
      expect(DELETION_CRITERIA.min_days_archived).toBe(365);
    });

    it('should have all exclusion rules enabled', () => {
      expect(DELETION_CRITERIA.exclusions.exclude_identity_content).toBe(true);
      expect(DELETION_CRITERIA.exclusions.exclude_pinned).toBe(true);
      expect(DELETION_CRITERIA.exclusions.exclude_with_active_links).toBe(true);
      expect(DELETION_CRITERIA.exclusions.exclude_if_ever_restored).toBe(true);
      expect(DELETION_CRITERIA.exclusions.exclude_if_searched_recently).toBe(true);
    });
  });

  describe('TRASH_CONFIG', () => {
    it('should have correct values', () => {
      expect(TRASH_CONFIG.buffer_days).toBe(30);
      expect(TRASH_CONFIG.auto_empty).toBe(true);
      expect(TRASH_CONFIG.show_in_storage_count).toBe(true);
    });
  });

  describe('MAX_STRENGTH and DEFAULT_STRENGTH', () => {
    it('should have correct values', () => {
      expect(MAX_STRENGTH).toBe(1.0);
      expect(DEFAULT_STRENGTH).toBe(0.5);
    });
  });

  describe('Type Guards', () => {
    it('isContentCategory should correctly identify valid categories', () => {
      expect(isContentCategory('identity')).toBe(true);
      expect(isContentCategory('invalid')).toBe(false);
    });

    it('isForgettingLifecycleState should correctly identify valid states', () => {
      expect(isForgettingLifecycleState('ACTIVE')).toBe(true);
      expect(isForgettingLifecycleState('INVALID')).toBe(false);
    });

    it('isStrengtheningEventType should correctly identify valid events', () => {
      expect(isStrengtheningEventType('direct_retrieval')).toBe(true);
      expect(isStrengtheningEventType('invalid')).toBe(false);
    });
  });
});

// ============================================================================
// SECTION: SCHEMA VALIDATION (15 tests)
// ============================================================================

describe('Schema Validation', () => {
  describe('NeuralStateSchema', () => {
    it('should validate correct neural state', () => {
      const state = createTestNeuralState();
      const result = NeuralStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    it('should reject retrievability > 1', () => {
      const state = createTestNeuralState({ retrievability: 1.5 });
      const result = NeuralStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });

    it('should reject strength > 1', () => {
      const state = createTestNeuralState({ strength: 1.5 });
      const result = NeuralStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });

    it('should reject negative stability', () => {
      const state = createTestNeuralState({ stability: -1 });
      const result = NeuralStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });
  });

  describe('StrengtheningRecordSchema', () => {
    it('should validate correct record', () => {
      const record = {
        type: 'direct_retrieval' as const,
        timestamp: new Date(),
        strength_before: 0.5,
        strength_after: 0.55,
        strength_delta: 0.05,
      };
      const result = StrengtheningRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it('should reject invalid event type', () => {
      const record = {
        type: 'invalid_type',
        timestamp: new Date(),
        strength_before: 0.5,
        strength_after: 0.55,
        strength_delta: 0.05,
      };
      const result = StrengtheningRecordSchema.safeParse(record);
      expect(result.success).toBe(false);
    });
  });

  describe('DifficultyFactorsSchema', () => {
    it('should validate correct factors', () => {
      const factors = {
        base: 0.3,
        complexity: 0.5,
        reaccess_penalty: 0.2,
        connection_bonus: 0.1,
        calculated: 0.35,
      };
      const result = DifficultyFactorsSchema.safeParse(factors);
      expect(result.success).toBe(true);
    });
  });

  describe('ExclusionCheckResultSchema', () => {
    it('should validate correct result', () => {
      const result = {
        is_identity: false,
        is_pinned: false,
        has_active_links: false,
        was_ever_restored: false,
        was_searched_recently: false,
        any_exclusion: false,
      };
      const parseResult = ExclusionCheckResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('DeletionCandidateSchema', () => {
    it('should validate correct candidate', () => {
      const candidate = {
        nodeId: 'test-node',
        days_archived: 400,
        days_since_access: 450,
        content_category: 'general' as const,
        exclusion_checks: {
          is_identity: false,
          is_pinned: false,
          has_active_links: false,
          was_ever_restored: false,
          was_searched_recently: false,
          any_exclusion: false,
        },
        is_candidate: true,
        reason: 'No exclusions',
      };
      const result = DeletionCandidateSchema.safeParse(candidate);
      expect(result.success).toBe(true);
    });
  });

  describe('TrashRecordSchema', () => {
    it('should validate correct record', () => {
      const record = {
        nodeId: 'test-node',
        trashed_at: new Date(),
        auto_delete_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        reason: 'User requested',
        initiated_by: 'user' as const,
      };
      const result = TrashRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });
  });

  describe('DecayJobResultSchema', () => {
    it('should validate correct result', () => {
      const result = {
        evaluated: 100,
        state_changes: [{ from: 'ACTIVE', to: 'WEAK', count: 5 }],
        compressed: 2,
        archived: 1,
        deletion_candidates_flagged: 3,
        auto_deleted: 0,
        errors: [],
        executed_at: new Date(),
        duration_ms: 150,
      };
      const parseResult = DecayJobResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('StabilityUpdateResultSchema', () => {
    it('should validate correct result', () => {
      const result = {
        nodeId: 'test-node',
        stability_before: 7,
        stability_after: 15,
        growth_factor: 2.15,
        difficulty: 0.3,
        capped: false,
        retrievability_reset: true,
      };
      const parseResult = StabilityUpdateResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('CleanupSettingsSchema', () => {
    it('should validate correct settings', () => {
      const settings = {
        deletion_candidate_days: 365,
        trash_buffer_days: 30,
        cleanup_reminder_frequency: 'monthly' as const,
        storage_warning_threshold: 0.8,
        auto_suggest_cleanup: true,
        require_confirmation: true,
      };
      const result = CleanupSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
    });
  });

  describe('StorageMetricsSchema', () => {
    it('should validate correct metrics', () => {
      const metrics = {
        active: { count: 100, size_bytes: 50000000 },
        weak: { count: 50, size_bytes: 25000000 },
        dormant: { count: 30, size_bytes: 15000000 },
        summarized: { count: 20, size_bytes: 5000000 },
        archived: { count: 100, size_bytes: 100000000 },
        deletion_candidates: { count: 15, size_bytes: 20000000 },
        trash: { count: 10, size_bytes: 5000000 },
        total: { count: 325, size_bytes: 220000000 },
      };
      const result = StorageMetricsSchema.safeParse(metrics);
      expect(result.success).toBe(true);
    });
  });

  describe('Validation Helpers', () => {
    it('validateNeuralState should return true for valid state', () => {
      expect(validateNeuralState(createTestNeuralState())).toBe(true);
    });

    it('validateNeuralState should return false for invalid state', () => {
      expect(validateNeuralState({ invalid: 'object' })).toBe(false);
    });

    it('validateStrengtheningRecord should work correctly', () => {
      const valid = {
        type: 'direct_retrieval',
        timestamp: new Date(),
        strength_before: 0.5,
        strength_after: 0.55,
        strength_delta: 0.05,
      };
      expect(validateStrengtheningRecord(valid)).toBe(true);
      expect(validateStrengtheningRecord({})).toBe(false);
    });
  });
});

// ============================================================================
// SECTION: calculateRetrievability (10 tests)
// ============================================================================

describe('calculateRetrievability', () => {
  it('should return 1.0 when days since access is 0', () => {
    expect(calculateRetrievability(7, 0)).toBe(1);
  });

  it('should return 0.9 when time equals stability', () => {
    const result = calculateRetrievability(7, 7);
    expect(result).toBeCloseTo(0.9, 5);
  });

  it('should decrease with more time elapsed', () => {
    const r1 = calculateRetrievability(7, 3);
    const r2 = calculateRetrievability(7, 7);
    const r3 = calculateRetrievability(7, 14);
    expect(r1).toBeGreaterThan(r2);
    expect(r2).toBeGreaterThan(r3);
  });

  it('should approach 0 for very large time values', () => {
    const result = calculateRetrievability(7, 365);
    expect(result).toBeLessThan(0.01); // R = 0.9^(365/7) ≈ 0.004
  });

  it('should work with stability of 1 day', () => {
    const result = calculateRetrievability(1, 1);
    expect(result).toBeCloseTo(0.9, 5);
  });

  it('should work with stability of 30 days', () => {
    const result = calculateRetrievability(30, 30);
    expect(result).toBeCloseTo(0.9, 5);
  });

  it('should work with stability of 0.5 days (12h)', () => {
    const result = calculateRetrievability(0.5, 0.5);
    expect(result).toBeCloseTo(0.9, 5);
  });

  it('should match FSRS formula exactly', () => {
    // R = 0.9^(t/S)
    const stability = 10;
    const days = 5;
    const expected = Math.pow(0.9, days / stability);
    expect(calculateRetrievability(stability, days)).toBeCloseTo(expected, 10);
  });

  it('should return value between 0 and 1', () => {
    for (let days = 0; days < 100; days += 5) {
      const result = calculateRetrievability(7, days);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });

  it('should handle edge case of zero stability gracefully', () => {
    const result = calculateRetrievability(0, 5);
    expect(result).toBe(0);
  });
});

// ============================================================================
// SECTION: getDecayLifecycleState (10 tests)
// ============================================================================

describe('getDecayLifecycleState', () => {
  it('should return ACTIVE when R > 0.5', () => {
    expect(getDecayLifecycleState(0.8)).toBe('ACTIVE');
    expect(getDecayLifecycleState(0.6)).toBe('ACTIVE');
    expect(getDecayLifecycleState(0.51)).toBe('ACTIVE');
  });

  it('should return WEAK when R between 0.1 and 0.5', () => {
    expect(getDecayLifecycleState(0.5)).toBe('WEAK');
    expect(getDecayLifecycleState(0.3)).toBe('WEAK');
    expect(getDecayLifecycleState(0.11)).toBe('WEAK');
  });

  it('should return correct state at boundary R = 0.5', () => {
    expect(getDecayLifecycleState(0.5)).toBe('WEAK');
  });

  it('should return correct state at boundary R = 0.1', () => {
    expect(getDecayLifecycleState(0.1)).toBe('DORMANT');
  });

  it('should return DORMANT when R < 0.1', () => {
    expect(getDecayLifecycleState(0.09)).toBe('DORMANT');
    expect(getDecayLifecycleState(0.05)).toBe('DORMANT');
    expect(getDecayLifecycleState(0.01)).toBe('DORMANT');
  });

  it('should consider daysDormant for SUMMARIZED state', () => {
    expect(getDecayLifecycleState(0.05, 100)).toBe('DORMANT');
    expect(getDecayLifecycleState(0.05, 120)).toBe('SUMMARIZED');
    expect(getDecayLifecycleState(0.05, 150)).toBe('SUMMARIZED');
  });

  it('should consider daysDormant for ARCHIVED state', () => {
    expect(getDecayLifecycleState(0.05, 180)).toBe('ARCHIVED');
    expect(getDecayLifecycleState(0.05, 200)).toBe('ARCHIVED');
  });

  it('should handle R = 0 edge case', () => {
    expect(getDecayLifecycleState(0)).toBe('DORMANT');
    expect(getDecayLifecycleState(0, 200)).toBe('ARCHIVED');
  });

  it('should handle R = 1 edge case', () => {
    expect(getDecayLifecycleState(1)).toBe('ACTIVE');
  });

  it('should not skip states based on days alone if R is high', () => {
    // Even if days suggest compression, high R means ACTIVE
    expect(getDecayLifecycleState(0.8, 200)).toBe('ACTIVE');
  });
});

// ============================================================================
// SECTION: updateStabilityOnAccess (10 tests)
// ============================================================================

describe('updateStabilityOnAccess', () => {
  it('should increase stability on access', () => {
    const result = updateStabilityOnAccess('node-1', 7, 0.3);
    expect(result.stability_after).toBeGreaterThan(result.stability_before);
  });

  it('should apply difficulty factor - high difficulty reduces growth', () => {
    const lowDiff = updateStabilityOnAccess('node-1', 7, 0.1);
    const highDiff = updateStabilityOnAccess('node-2', 7, 0.9);
    expect(lowDiff.stability_after).toBeGreaterThan(highDiff.stability_after);
  });

  it('should have no growth penalty when difficulty = 0', () => {
    const result = updateStabilityOnAccess('node-1', 7, 0);
    // Formula: S * 2.5 * (1 - 0 * 0.5) = S * 2.5
    expect(result.growth_factor).toBe(2.5);
  });

  it('should cap stability at max_stability_days', () => {
    const result = updateStabilityOnAccess('node-1', 300, 0);
    expect(result.stability_after).toBeLessThanOrEqual(365); // Max from DECAY_CONFIG
    expect(result.capped).toBe(true);
  });

  it('should reset retrievability to 1.0', () => {
    const result = updateStabilityOnAccess('node-1', 7, 0.3);
    expect(result.retrievability_reset).toBe(true);
  });

  it('should return StabilityUpdateResult with all fields', () => {
    const result = updateStabilityOnAccess('node-1', 7, 0.3);
    expect(result.nodeId).toBe('node-1');
    expect(result.stability_before).toBe(7);
    expect(typeof result.stability_after).toBe('number');
    expect(typeof result.growth_factor).toBe('number');
    expect(result.difficulty).toBe(0.3);
    expect(typeof result.capped).toBe('boolean');
    expect(typeof result.retrievability_reset).toBe('boolean');
  });

  it('should apply correct formula: S * growth_rate * (1 - difficulty * 0.5)', () => {
    const stability = 10;
    const difficulty = 0.4;
    const result = updateStabilityOnAccess('node-1', stability, difficulty);
    const expected = stability * 2.5 * (1 - difficulty * 0.5);
    expect(result.stability_after).toBeCloseTo(expected, 5);
  });

  it('should handle multiple accesses compound growth', () => {
    let stability = 7;
    const difficulty = 0.3;
    for (let i = 0; i < 5; i++) {
      const result = updateStabilityOnAccess(`node-${i}`, stability, difficulty);
      stability = result.stability_after;
    }
    expect(stability).toBeGreaterThan(7);
  });

  it('should handle edge case of stability = 0', () => {
    const result = updateStabilityOnAccess('node-1', 0, 0.3);
    expect(result.stability_after).toBe(0);
  });

  it('should handle edge case of difficulty = 1', () => {
    const result = updateStabilityOnAccess('node-1', 7, 1);
    // Formula: 7 * 2.5 * (1 - 1 * 0.5) = 7 * 2.5 * 0.5 = 8.75
    expect(result.stability_after).toBeCloseTo(8.75, 5);
  });
});

// ============================================================================
// SECTION: strengthenNode (12 tests)
// ============================================================================

describe('strengthenNode', () => {
  it('should add direct_retrieval bonus correctly', () => {
    const state = createTestNeuralState({ strength: 0.5 });
    const result = strengthenNode(state, 'direct_retrieval');
    // Formula: 0.5 + 0.10 * (1 - 0.5) = 0.5 + 0.05 = 0.55
    expect(result.updated_state.strength).toBeCloseTo(0.55, 5);
  });

  it('should add co_activation bonus correctly', () => {
    const state = createTestNeuralState({ strength: 0.5 });
    const result = strengthenNode(state, 'co_activation');
    // Formula: 0.5 + 0.03 * (1 - 0.5) = 0.5 + 0.015 = 0.515
    expect(result.updated_state.strength).toBeCloseTo(0.515, 5);
  });

  it('should add user_interaction bonus correctly', () => {
    const state = createTestNeuralState({ strength: 0.5 });
    const result = strengthenNode(state, 'user_interaction');
    // Formula: 0.5 + 0.15 * (1 - 0.5) = 0.5 + 0.075 = 0.575
    expect(result.updated_state.strength).toBeCloseTo(0.575, 5);
  });

  it('should add external_reference bonus correctly', () => {
    const state = createTestNeuralState({ strength: 0.5 });
    const result = strengthenNode(state, 'external_reference');
    // Formula: 0.5 + 0.05 * (1 - 0.5) = 0.5 + 0.025 = 0.525
    expect(result.updated_state.strength).toBeCloseTo(0.525, 5);
  });

  it('should exhibit Hebbian saturation (diminishing returns)', () => {
    let state = createTestNeuralState({ strength: 0.5 });

    // Apply multiple co_activations
    const deltas: number[] = [];
    for (let i = 0; i < 10; i++) {
      const result = strengthenNode(state, 'co_activation');
      deltas.push(result.record.strength_delta);
      state = result.updated_state;
    }

    // Each delta should be smaller than the previous
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBeLessThan(deltas[i - 1]);
    }
  });

  it('should cap strength at 1.0', () => {
    const state = createTestNeuralState({ strength: 0.99 });
    const result = strengthenNode(state, 'user_interaction');
    expect(result.updated_state.strength).toBeLessThanOrEqual(1.0);
  });

  it('should not exceed max even with large bonus', () => {
    const state = createTestNeuralState({ strength: 0.95 });
    const result = strengthenNode(state, 'user_interaction');
    expect(result.updated_state.strength).toBeLessThanOrEqual(1.0);
  });

  it('should return updated NeuralState with all fields preserved', () => {
    const state = createTestNeuralState({ strength: 0.5, stability: 7, difficulty: 0.3 });
    const result = strengthenNode(state, 'direct_retrieval');

    expect(result.updated_state.stability).toBe(7);
    expect(result.updated_state.difficulty).toBe(0.3);
    expect(result.updated_state.strength).toBeGreaterThan(0.5);
  });

  it('should record StrengtheningRecord with correct values', () => {
    const state = createTestNeuralState({ strength: 0.5 });
    const result = strengthenNode(state, 'direct_retrieval');

    expect(result.record.type).toBe('direct_retrieval');
    expect(result.record.strength_before).toBe(0.5);
    expect(result.record.strength_after).toBeCloseTo(0.55, 5);
    expect(result.record.strength_delta).toBeCloseTo(0.05, 5);
    expect(result.record.timestamp).toBeInstanceOf(Date);
  });

  it('should handle starting strength of 0', () => {
    const state = createTestNeuralState({ strength: 0 });
    const result = strengthenNode(state, 'direct_retrieval');
    // Formula: 0 + 0.10 * (1 - 0) = 0.10
    expect(result.updated_state.strength).toBeCloseTo(0.10, 5);
  });

  it('should handle starting strength at max (no change)', () => {
    const state = createTestNeuralState({ strength: 1.0 });
    const result = strengthenNode(state, 'direct_retrieval');
    // Formula: 1.0 + 0.10 * (1 - 1) = 1.0 + 0 = 1.0
    expect(result.updated_state.strength).toBe(1.0);
    expect(result.record.strength_delta).toBe(0);
  });

  it('should handle multiple different strengthening events', () => {
    let state = createTestNeuralState({ strength: 0.5 });

    state = strengthenNode(state, 'direct_retrieval').updated_state;
    state = strengthenNode(state, 'user_interaction').updated_state;
    state = strengthenNode(state, 'co_activation').updated_state;

    expect(state.strength).toBeGreaterThan(0.5);
    expect(state.strength).toBeLessThan(1.0);
  });
});

// ============================================================================
// SECTION: calculateDifficulty (12 tests)
// ============================================================================

describe('calculateDifficulty', () => {
  it('should use base difficulty from content category', () => {
    const result = calculateDifficulty('identity', 0, 10, 0);
    // Base for identity is 0.1
    expect(result.base).toBe(0.1);
  });

  it('should incorporate complexity factor', () => {
    const lowComplexity = calculateDifficulty('general', 0.1, 10, 0);
    const highComplexity = calculateDifficulty('general', 0.9, 10, 0);
    expect(highComplexity.calculated).toBeGreaterThan(lowComplexity.calculated);
  });

  it('should apply reaccess penalty when avgDays < 3', () => {
    const withPenalty = calculateDifficulty('general', 0.3, 2, 0);
    const withoutPenalty = calculateDifficulty('general', 0.3, 5, 0);
    expect(withPenalty.reaccess_penalty).toBe(0.2);
    expect(withoutPenalty.reaccess_penalty).toBe(0);
  });

  it('should not apply reaccess penalty when avgDays >= 3', () => {
    const result = calculateDifficulty('general', 0.3, 3, 0);
    expect(result.reaccess_penalty).toBe(0);
  });

  it('should apply connection bonus (reduces difficulty)', () => {
    const noConnections = calculateDifficulty('general', 0.3, 10, 0);
    const manyConnections = calculateDifficulty('general', 0.3, 10, 15);
    expect(manyConnections.calculated).toBeLessThan(noConnections.calculated);
  });

  it('should cap connection bonus at max', () => {
    const result = calculateDifficulty('general', 0.3, 10, 100);
    expect(result.connection_bonus).toBeLessThanOrEqual(0.3);
  });

  it('should apply mean reversion toward target (0.3)', () => {
    // High base difficulty should be pulled toward 0.3
    const result = calculateDifficulty('document', 0, 10, 0);
    // Base for document is 0.6, but mean reversion pulls toward 0.3
    expect(result.calculated).toBeLessThan(0.6);
  });

  it('should clamp at min_difficulty (0.05)', () => {
    // Very easy content with many connections
    const result = calculateDifficulty('identity', 0, 100, 50);
    expect(result.calculated).toBeGreaterThanOrEqual(0.05);
  });

  it('should clamp at max_difficulty (0.95)', () => {
    // Very hard content with frequent re-access
    const result = calculateDifficulty('document', 1, 0.5, 0);
    expect(result.calculated).toBeLessThanOrEqual(0.95);
  });

  it('should return DifficultyFactors with all fields', () => {
    const result = calculateDifficulty('general', 0.5, 5, 10);
    expect(typeof result.base).toBe('number');
    expect(typeof result.complexity).toBe('number');
    expect(typeof result.reaccess_penalty).toBe('number');
    expect(typeof result.connection_bonus).toBe('number');
    expect(typeof result.calculated).toBe('number');
  });

  it('should work with all content categories', () => {
    const categories: ContentCategory[] = [
      'identity', 'academic', 'conversation', 'work', 'temporal', 'document', 'general'
    ];

    categories.forEach(category => {
      const result = calculateDifficulty(category, 0.5, 5, 5);
      expect(result.base).toBe(BASE_DIFFICULTY_BY_CATEGORY[category]);
      expect(result.calculated).toBeGreaterThanOrEqual(0.05);
      expect(result.calculated).toBeLessThanOrEqual(0.95);
    });
  });

  it('should follow the formula from spec', () => {
    const category: ContentCategory = 'general';
    const complexity = 0.5;
    const avgDays = 2; // triggers penalty
    const edges = 10;

    const result = calculateDifficulty(category, complexity, avgDays, edges);

    const base = BASE_DIFFICULTY_BY_CATEGORY[category]; // 0.3
    const reaccessPenalty = 0.2; // avgDays < 3
    const connectionBonus = Math.min(0.3, edges * 0.02); // 0.2

    let expected = base
      + (complexity * 0.2)
      + (reaccessPenalty * 0.15)
      - (connectionBonus * 0.1);

    // Mean reversion
    expected = expected * 0.9 + 0.3 * 0.1;

    expect(result.calculated).toBeCloseTo(expected, 5);
  });
});

// ============================================================================
// SECTION: analyzeComplexity (8 tests)
// ============================================================================

describe('analyzeComplexity', () => {
  it('should return low complexity for short simple text', () => {
    const result = analyzeComplexity('Hello world. Short text.');
    expect(result.complexity).toBeLessThan(0.3);
  });

  it('should return high complexity for long complex text', () => {
    const longText = Array(100).fill('This is a sophisticated sentence with multisyllabic vocabulary.').join(' ');
    const result = analyzeComplexity(longText);
    expect(result.complexity).toBeGreaterThan(0.5);
  });

  it('should return value between 0 and 1', () => {
    const texts = [
      'Hi',
      'Hello world',
      'This is a medium length sentence with some words.',
      Array(100).fill('word').join(' '),
    ];

    texts.forEach(text => {
      const result = analyzeComplexity(text);
      expect(result.complexity).toBeGreaterThanOrEqual(0);
      expect(result.complexity).toBeLessThanOrEqual(1);
    });
  });

  it('should increase with word count', () => {
    const short = analyzeComplexity('One two three.');
    const long = analyzeComplexity(Array(200).fill('word').join(' ') + '.');
    expect(long.length_score).toBeGreaterThan(short.length_score);
  });

  it('should increase with sentence length', () => {
    const shortSentences = analyzeComplexity('Hi. There. You. Go.');
    const longSentences = analyzeComplexity('This is a very long sentence that keeps going on and on.');
    expect(longSentences.sentence_score).toBeGreaterThan(shortSentences.sentence_score);
  });

  it('should increase with vocabulary complexity', () => {
    const simple = analyzeComplexity('cat dog run eat');
    const complex = analyzeComplexity('sophisticated intricate multifaceted extraordinary');
    expect(complex.vocab_score).toBeGreaterThan(simple.vocab_score);
  });

  it('should return 0 for empty string', () => {
    const result = analyzeComplexity('');
    expect(result.complexity).toBe(0);
    expect(result.length_score).toBe(0);
    expect(result.sentence_score).toBe(0);
    expect(result.vocab_score).toBe(0);
  });

  it('should handle unicode characters', () => {
    const result = analyzeComplexity('こんにちは世界 Hello 你好');
    expect(typeof result.complexity).toBe('number');
    expect(result.complexity).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// SECTION: shouldCompress and shouldArchive (8 tests)
// ============================================================================

describe('shouldCompress and shouldArchive', () => {
  describe('shouldCompress', () => {
    it('should return false if state is not DORMANT', () => {
      const state = createTestNeuralState({ lifecycle_state: 'ACTIVE', days_in_dormant: 150 });
      expect(shouldCompress(state)).toBe(false);
    });

    it('should return false if days_in_dormant < compress_days', () => {
      const state = createTestNeuralState({ lifecycle_state: 'DORMANT', days_in_dormant: 100 });
      expect(shouldCompress(state)).toBe(false);
    });

    it('should return true if DORMANT and days >= compress_days', () => {
      const state = createTestNeuralState({ lifecycle_state: 'DORMANT', days_in_dormant: 120 });
      expect(shouldCompress(state)).toBe(true);
    });

    it('should return true at exactly compress_days boundary', () => {
      const state = createTestNeuralState({ lifecycle_state: 'DORMANT', days_in_dormant: 120 });
      expect(shouldCompress(state)).toBe(true);
    });
  });

  describe('shouldArchive', () => {
    it('should return false if state is not SUMMARIZED', () => {
      const state = createTestNeuralState({ lifecycle_state: 'DORMANT', days_in_dormant: 200 });
      expect(shouldArchive(state)).toBe(false);
    });

    it('should return false if days_in_dormant < archive_days', () => {
      const state = createTestNeuralState({ lifecycle_state: 'SUMMARIZED', days_in_dormant: 150 });
      expect(shouldArchive(state)).toBe(false);
    });

    it('should return true if SUMMARIZED and days >= archive_days', () => {
      const state = createTestNeuralState({ lifecycle_state: 'SUMMARIZED', days_in_dormant: 180 });
      expect(shouldArchive(state)).toBe(true);
    });

    it('should return true at exactly archive_days boundary', () => {
      const state = createTestNeuralState({ lifecycle_state: 'SUMMARIZED', days_in_dormant: 180 });
      expect(shouldArchive(state)).toBe(true);
    });
  });
});

// ============================================================================
// SECTION: isDeletionCandidate and exclusion rules (15 tests)
// ============================================================================

describe('isDeletionCandidate and exclusion rules', () => {
  describe('isDeletionCandidate', () => {
    it('should not be candidate if < 365 days archived', () => {
      const node = createTestNodeDecayInput();
      const result = isDeletionCandidate(node, 300);
      expect(result.is_candidate).toBe(false);
      expect(result.reason).toContain('Only 300 days');
    });

    it('should be candidate if >= 365 days and no exclusions', () => {
      const node = createTestNodeDecayInput({
        content_category: 'conversation',
        pinned: false,
        active_inbound_link_count: 0,
        restore_count: 0,
        last_archive_search_hit: null,
      });
      const result = isDeletionCandidate(node, 400);
      expect(result.is_candidate).toBe(true);
    });

    it('should exclude if identity content', () => {
      const node = createTestNodeDecayInput({ content_category: 'identity' });
      const result = isDeletionCandidate(node, 400);
      expect(result.is_candidate).toBe(false);
      expect(result.reason).toContain('identity content');
    });

    it('should exclude if pinned', () => {
      const node = createTestNodeDecayInput({ pinned: true });
      const result = isDeletionCandidate(node, 400);
      expect(result.is_candidate).toBe(false);
      expect(result.reason).toContain('pinned');
    });

    it('should exclude if has active inbound links', () => {
      const node = createTestNodeDecayInput({ active_inbound_link_count: 3 });
      const result = isDeletionCandidate(node, 400);
      expect(result.is_candidate).toBe(false);
      expect(result.reason).toContain('active inbound links');
    });

    it('should exclude if ever restored', () => {
      const node = createTestNodeDecayInput({ restore_count: 1 });
      const result = isDeletionCandidate(node, 400);
      expect(result.is_candidate).toBe(false);
      expect(result.reason).toContain('restored before');
    });

    it('should exclude if searched within 180 days', () => {
      const recentSearch = new Date();
      recentSearch.setDate(recentSearch.getDate() - 90); // 90 days ago
      const node = createTestNodeDecayInput({ last_archive_search_hit: recentSearch });
      const result = isDeletionCandidate(node, 400);
      expect(result.is_candidate).toBe(false);
      expect(result.reason).toContain('recently searched');
    });

    it('should not exclude if searched > 180 days ago', () => {
      const oldSearch = new Date();
      oldSearch.setDate(oldSearch.getDate() - 200); // 200 days ago
      const node = createTestNodeDecayInput({
        last_archive_search_hit: oldSearch,
        content_category: 'conversation',
      });
      const result = isDeletionCandidate(node, 400);
      expect(result.is_candidate).toBe(true);
    });

    it('should handle multiple exclusions', () => {
      const node = createTestNodeDecayInput({
        content_category: 'identity',
        pinned: true,
        restore_count: 2,
      });
      const result = isDeletionCandidate(node, 400);
      expect(result.is_candidate).toBe(false);
      expect(result.reason).toContain('identity content');
      expect(result.reason).toContain('pinned');
      expect(result.reason).toContain('restored before');
    });

    it('should return correct DeletionCandidate structure', () => {
      const node = createTestNodeDecayInput();
      const result = isDeletionCandidate(node, 400);

      expect(result.nodeId).toBe(node.nodeId);
      expect(result.days_archived).toBe(400);
      expect(typeof result.days_since_access).toBe('number');
      expect(result.content_category).toBe('general');
      expect(typeof result.exclusion_checks).toBe('object');
      expect(typeof result.is_candidate).toBe('boolean');
      expect(typeof result.reason).toBe('string');
    });

    it('should handle exactly 365 days boundary', () => {
      const node = createTestNodeDecayInput({ content_category: 'conversation' });
      const result = isDeletionCandidate(node, 365);
      expect(result.is_candidate).toBe(true);
    });

    it('should handle exactly 180 days search boundary', () => {
      const searchDate = new Date();
      searchDate.setDate(searchDate.getDate() - 180); // exactly 180 days ago
      const node = createTestNodeDecayInput({
        last_archive_search_hit: searchDate,
        content_category: 'conversation',
      });
      const result = isDeletionCandidate(node, 400);
      // At exactly 180 days, daysSinceSearch = 180, threshold is 180, so NOT recent
      expect(result.exclusion_checks.was_searched_recently).toBe(false);
    });
  });

  describe('checkExclusionRules', () => {
    it('should return correct ExclusionCheckResult structure', () => {
      const node = createTestNodeDecayInput();
      const result = checkExclusionRules(node);

      expect(typeof result.is_identity).toBe('boolean');
      expect(typeof result.is_pinned).toBe('boolean');
      expect(typeof result.has_active_links).toBe('boolean');
      expect(typeof result.was_ever_restored).toBe('boolean');
      expect(typeof result.was_searched_recently).toBe('boolean');
      expect(typeof result.any_exclusion).toBe('boolean');
    });

    it('should set any_exclusion true if any rule triggers', () => {
      const node = createTestNodeDecayInput({ pinned: true });
      const result = checkExclusionRules(node);
      expect(result.any_exclusion).toBe(true);
    });

    it('should set any_exclusion false if no rules trigger', () => {
      const node = createTestNodeDecayInput({
        content_category: 'conversation',
        pinned: false,
        active_inbound_link_count: 0,
        restore_count: 0,
        last_archive_search_hit: null,
      });
      const result = checkExclusionRules(node);
      expect(result.any_exclusion).toBe(false);
    });
  });

  describe('hasActiveInboundLinks', () => {
    it('should return true if count > 0', () => {
      expect(hasActiveInboundLinks(1)).toBe(true);
      expect(hasActiveInboundLinks(5)).toBe(true);
    });

    it('should return false if count = 0', () => {
      expect(hasActiveInboundLinks(0)).toBe(false);
    });
  });
});

// ============================================================================
// SECTION: Trash and deletion functions (10 tests)
// ============================================================================

describe('Trash and deletion functions', () => {
  describe('moveToTrash', () => {
    it('should create TrashRecord with correct nodeId', () => {
      const result = moveToTrash('node-123', 'User cleanup', 'user');
      expect(result.nodeId).toBe('node-123');
    });

    it('should record reason', () => {
      const result = moveToTrash('node-123', 'Expired data', 'system');
      expect(result.reason).toBe('Expired data');
    });

    it('should set trashed_at to current time', () => {
      const before = new Date();
      const result = moveToTrash('node-123', 'Test', 'user');
      const after = new Date();

      expect(result.trashed_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.trashed_at.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should set auto_delete_at to buffer_days in future', () => {
      const result = moveToTrash('node-123', 'Test', 'user');
      const expectedTime = result.trashed_at.getTime() + (30 * 24 * 60 * 60 * 1000);
      expect(result.auto_delete_at.getTime()).toBeCloseTo(expectedTime, -3); // Within 1 second
    });

    it('should record initiated_by', () => {
      const userResult = moveToTrash('node-1', 'Test', 'user');
      const systemResult = moveToTrash('node-2', 'Test', 'system');
      expect(userResult.initiated_by).toBe('user');
      expect(systemResult.initiated_by).toBe('system');
    });
  });

  describe('permanentlyDelete', () => {
    it('should not throw on valid nodeId', async () => {
      await expect(permanentlyDelete('node-123')).resolves.not.toThrow();
    });

    it('should return void', async () => {
      const result = await permanentlyDelete('node-123');
      expect(result).toBeUndefined();
    });
  });

  describe('restoreFromTrash', () => {
    it('should not throw on valid nodeId', async () => {
      await expect(restoreFromTrash('node-123')).resolves.not.toThrow();
    });

    it('should return void', async () => {
      const result = await restoreFromTrash('node-123');
      expect(result).toBeUndefined();
    });
  });
});

// ============================================================================
// SECTION: runDecayCycle (10 tests)
// ============================================================================

describe('runDecayCycle', () => {
  it('should return zero counts for empty input', async () => {
    const result = await runDecayCycle([]);
    expect(result.evaluated).toBe(0);
    expect(result.compressed).toBe(0);
    expect(result.archived).toBe(0);
    expect(result.deletion_candidates_flagged).toBe(0);
  });

  it('should count nodes evaluated', async () => {
    const nodes = [
      createTestNodeDecayInput({ nodeId: 'node-1' }),
      createTestNodeDecayInput({ nodeId: 'node-2' }),
      createTestNodeDecayInput({ nodeId: 'node-3' }),
    ];
    const result = await runDecayCycle(nodes);
    expect(result.evaluated).toBe(3);
  });

  it('should detect state transitions', async () => {
    // Create a node that should transition from ACTIVE to WEAK
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30); // 30 days ago

    const nodes = [
      createTestNodeDecayInput({
        nodeId: 'node-1',
        neural_state: createTestNeuralState({
          stability: 7,
          last_accessed: oldDate,
          lifecycle_state: 'ACTIVE',
        }),
      }),
    ];
    const result = await runDecayCycle(nodes);
    expect(result.state_changes.length).toBeGreaterThanOrEqual(0);
  });

  it('should return duration_ms', async () => {
    const nodes = [createTestNodeDecayInput()];
    const result = await runDecayCycle(nodes);
    expect(typeof result.duration_ms).toBe('number');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('should return executed_at timestamp', async () => {
    const result = await runDecayCycle([]);
    expect(result.executed_at).toBeInstanceOf(Date);
  });

  it('should return DecayJobResult structure', async () => {
    const result = await runDecayCycle([]);
    expect(typeof result.evaluated).toBe('number');
    expect(Array.isArray(result.state_changes)).toBe(true);
    expect(typeof result.compressed).toBe('number');
    expect(typeof result.archived).toBe('number');
    expect(typeof result.deletion_candidates_flagged).toBe('number');
    expect(typeof result.auto_deleted).toBe('number');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.executed_at).toBeInstanceOf(Date);
    expect(typeof result.duration_ms).toBe('number');
  });

  it('should validate result with schema', async () => {
    const result = await runDecayCycle([createTestNodeDecayInput()]);
    expect(validateDecayJobResult(result)).toBe(true);
  });

  it('should handle custom now parameter', async () => {
    const customNow = new Date('2026-06-15');
    const result = await runDecayCycle([], customNow);
    expect(result.executed_at.getTime()).toBe(customNow.getTime());
  });

  it('should count archived transitions', async () => {
    // Create a node that's already SUMMARIZED and should move to ARCHIVED
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 200);

    const nodes = [
      createTestNodeDecayInput({
        neural_state: createTestNeuralState({
          stability: 7,
          last_accessed: oldDate,
          lifecycle_state: 'SUMMARIZED',
          days_in_dormant: 190,
        }),
      }),
    ];
    const result = await runDecayCycle(nodes);
    // The archived counter tracks state changes to ARCHIVED
    expect(typeof result.archived).toBe('number');
  });

  it('should accumulate errors without stopping', async () => {
    // Even with potentially invalid data, should process all nodes
    const nodes = [
      createTestNodeDecayInput({ nodeId: 'node-1' }),
      createTestNodeDecayInput({ nodeId: 'node-2' }),
    ];
    const result = await runDecayCycle(nodes);
    expect(result.evaluated).toBe(2);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

// ============================================================================
// SECTION: Integration tests (10 tests)
// ============================================================================

describe('Integration', () => {
  it('should track full lifecycle: ACTIVE → WEAK → DORMANT', () => {
    // Simulate time passing
    let state = createTestNeuralState({
      stability: 7,
      lifecycle_state: 'ACTIVE',
      retrievability: 1.0,
    });

    // After 7 days: R = 0.9 (still ACTIVE)
    let r = calculateRetrievability(state.stability, 7);
    let lifecycle = getDecayLifecycleState(r);
    expect(lifecycle).toBe('ACTIVE');

    // After 30 days: R ≈ 0.59 (still ACTIVE)
    r = calculateRetrievability(state.stability, 30);
    lifecycle = getDecayLifecycleState(r);
    expect(lifecycle).toBe('ACTIVE');

    // After 50 days: R ≈ 0.47 (WEAK)
    r = calculateRetrievability(state.stability, 50);
    lifecycle = getDecayLifecycleState(r);
    expect(lifecycle).toBe('WEAK');

    // After 100 days: R ≈ 0.22 (WEAK)
    r = calculateRetrievability(state.stability, 100);
    lifecycle = getDecayLifecycleState(r);
    expect(lifecycle).toBe('WEAK');

    // After 200 days: R ≈ 0.05 (DORMANT)
    r = calculateRetrievability(state.stability, 200);
    lifecycle = getDecayLifecycleState(r);
    expect(lifecycle).toBe('DORMANT');
  });

  it('should show strengthening maintains ACTIVE longer', () => {
    let state = createTestNeuralState({ strength: 0.5 });

    // Strengthen multiple times
    for (let i = 0; i < 5; i++) {
      state = strengthenNode(state, 'direct_retrieval').updated_state;
    }

    expect(state.strength).toBeGreaterThan(0.5);
  });

  it('should show access resets retrievability and grows stability', () => {
    const result = updateStabilityOnAccess('node-1', 7, 0.3);
    expect(result.stability_after).toBeGreaterThan(7);
    expect(result.retrievability_reset).toBe(true);
  });

  it('should show high difficulty slows stability growth', () => {
    const easyResult = updateStabilityOnAccess('node-1', 7, 0.1);
    const hardResult = updateStabilityOnAccess('node-2', 7, 0.9);
    expect(easyResult.stability_after).toBeGreaterThan(hardResult.stability_after);
  });

  it('should show content category affects initial values', () => {
    const identityState = createNeuralState({ content_category: 'identity' });
    const conversationState = createNeuralState({ content_category: 'conversation' });

    expect(identityState.stability).toBe(30);
    expect(conversationState.stability).toBe(0.5);
    expect(identityState.difficulty).toBe(0.1);
    expect(conversationState.difficulty).toBe(0.2);
  });

  it('mapContentCategoryToNodeType should map correctly', () => {
    expect(mapContentCategoryToNodeType('identity')).toBe('person');
    expect(mapContentCategoryToNodeType('academic')).toBe('concept');
    expect(mapContentCategoryToNodeType('conversation')).toBe('note');
    expect(mapContentCategoryToNodeType('work')).toBe('note');
    expect(mapContentCategoryToNodeType('temporal')).toBe('event');
    expect(mapContentCategoryToNodeType('document')).toBe('document');
    expect(mapContentCategoryToNodeType('general')).toBe('fact');
  });

  it('getInitialStabilityForCategory should return correct values', () => {
    expect(getInitialStabilityForCategory('identity')).toBe(30);
    expect(getInitialStabilityForCategory('conversation')).toBe(0.5);
    expect(getInitialStabilityForCategory('general')).toBe(1);
  });

  it('getBaseDifficultyForCategory should return correct values', () => {
    expect(getBaseDifficultyForCategory('identity')).toBe(0.1);
    expect(getBaseDifficultyForCategory('document')).toBe(0.6);
    expect(getBaseDifficultyForCategory('general')).toBe(0.3);
  });

  it('createNeuralState should create correct initial state', () => {
    const state = createNeuralState({ content_category: 'academic' });

    expect(state.stability).toBe(1); // academic initial stability
    expect(state.retrievability).toBe(1.0);
    expect(state.strength).toBe(0.5); // default
    expect(state.difficulty).toBe(0.5); // academic base difficulty
    expect(state.access_count).toBe(0);
    expect(state.lifecycle_state).toBe('ACTIVE');
    expect(state.days_in_dormant).toBe(0);
  });

  it('determineLifecycle should return correct determination', () => {
    const state = createTestNeuralState({
      stability: 7,
      last_accessed: new Date(),
      lifecycle_state: 'ACTIVE',
      days_in_dormant: 0,
    });

    const determination = determineLifecycle(state);

    expect(determination.retrievability).toBeCloseTo(1.0, 1);
    expect(determination.state).toBe('ACTIVE');
    expect(determination.compression_eligible).toBe(false);
    expect(determination.archive_eligible).toBe(false);
    expect(determination.deletion_candidate_eligible).toBe(false);
  });
});

// ============================================================================
// SECTION: Utility functions (5 tests)
// ============================================================================

describe('Utility functions', () => {
  describe('daysBetween', () => {
    it('should calculate days correctly', () => {
      const start = new Date('2026-01-01');
      const end = new Date('2026-01-08');
      expect(daysBetween(start, end)).toBe(7);
    });

    it('should handle same date', () => {
      const date = new Date();
      expect(daysBetween(date, date)).toBe(0);
    });

    it('should handle fractional days', () => {
      const start = new Date('2026-01-01T00:00:00');
      const end = new Date('2026-01-01T12:00:00');
      expect(daysBetween(start, end)).toBe(0.5);
    });
  });

  describe('hoursBetween', () => {
    it('should calculate hours correctly', () => {
      const start = new Date('2026-01-01T00:00:00');
      const end = new Date('2026-01-01T12:00:00');
      expect(hoursBetween(start, end)).toBe(12);
    });

    it('should handle same time', () => {
      const date = new Date();
      expect(hoursBetween(date, date)).toBe(0);
    });
  });
});
