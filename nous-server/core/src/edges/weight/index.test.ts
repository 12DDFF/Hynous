/**
 * @module @nous/core/edges/weight
 * @description Tests for Edge Weight Determination System (storm-031)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Constants
  EDGE_WEIGHTS,
  EXTENDED_EDGE_TYPES,
  EXTRACTION_CONFIG,
  SIMILARITY_CONFIG,
  USER_EDGE_CONFIG,
  TEMPORAL_CONFIG,
  COACTIVATION_CONFIG,
  EDGE_DECAY_CONFIG,
  COMPRESSION_DEFAULTS,
  GRAPH_SIZE_THRESHOLDS,
  WEIGHT_BOUNDS,
  LEARNED_ADJUSTMENT_BOUNDS,
  // Core weight functions
  calculateEffectiveWeight,
  createWeightComponents,
  applyLearningAdjustment,
  applyCoactivationBonus,
  decayCoactivationBonus,
  // Extraction functions
  calculateExtractionEdge,
  createProvisionalState,
  shouldPromoteProvisional,
  shouldExpireProvisional,
  incrementProvisionalActivation,
  // Similarity functions
  meetsSimilarityThreshold,
  isEmbeddingFresh,
  calculateSimilarityWeight,
  // User edge functions
  calculateUserEdgeWeight,
  isAllowedUserEdgeType,
  // Temporal functions
  calculateTemporalWeight,
  createTemporalAdjacentEdge,
  checkContinuationEligibility,
  detectContinuationEdges,
  createSessionTemporalEdges,
  hasSessionEnded,
  // Co-activation functions
  didUserEngage,
  calculateStrengtheningDelta,
  updateCoActivationWeight,
  applyTimeBasedDecay,
  shouldConsiderNewEdge,
  isEdgeDead,
  // Compression functions
  getCompressionConfig,
  isNeverCompress,
  meetsCompressionRequirements,
  createCompressionState,
  isRestorable,
  createEdgeRecord,
  calculateAggregatedWeight,
  generateSummaryNodeId,
  // Factory
  createWeightedEdge,
  // Validation
  validateWeightComponents,
  validateProvisionalState,
  validateSession,
  validateSummaryNode,
  validateCompressionState,
  validateEmbeddingFreshness,
  // Types
  type EdgeWeightComponents,
  type WeightedEdge,
  type Session,
  type ProvisionalEdgeState,
} from './index';

// ============================================================
// CONSTANTS TESTS
// ============================================================

describe('Constants', () => {
  describe('EXTENDED_EDGE_TYPES', () => {
    it('should include all storm-011 edge types', () => {
      expect(EXTENDED_EDGE_TYPES).toContain('relates_to');
      expect(EXTENDED_EDGE_TYPES).toContain('part_of');
      expect(EXTENDED_EDGE_TYPES).toContain('similar_to');
    });

    it('should include new storm-031 edge types', () => {
      expect(EXTENDED_EDGE_TYPES).toContain('temporal_adjacent');
      expect(EXTENDED_EDGE_TYPES).toContain('temporal_continuation');
      expect(EXTENDED_EDGE_TYPES).toContain('summarizes');
      expect(EXTENDED_EDGE_TYPES).toContain('user_linked');
      expect(EXTENDED_EDGE_TYPES).toContain('same_entity');
    });
  });

  describe('EDGE_WEIGHTS', () => {
    it('should have highest weights for identity relationships', () => {
      expect(EDGE_WEIGHTS.same_entity).toBe(0.95);
      expect(EDGE_WEIGHTS.summarizes).toBe(0.95);
    });

    it('should have lowest weights for temporal relationships', () => {
      expect(EDGE_WEIGHTS.temporal_adjacent).toBe(0.40);
      expect(EDGE_WEIGHTS.temporal_continuation).toBe(0.30);
    });

    it('should have user_linked at 0.90', () => {
      expect(EDGE_WEIGHTS.user_linked).toBe(0.90);
    });

    it('should have all weights between 0.30 and 0.95', () => {
      for (const [type, weight] of Object.entries(EDGE_WEIGHTS)) {
        expect(weight).toBeGreaterThanOrEqual(0.30);
        expect(weight).toBeLessThanOrEqual(0.95);
      }
    });
  });

  describe('EXTRACTION_CONFIG', () => {
    it('should have confirmed threshold at 0.70', () => {
      expect(EXTRACTION_CONFIG.confirmed_threshold).toBe(0.70);
    });

    it('should have provisional threshold at 0.50', () => {
      expect(EXTRACTION_CONFIG.provisional_threshold).toBe(0.50);
    });

    it('should require 3 activations for promotion', () => {
      expect(EXTRACTION_CONFIG.provisional_promotion_activations).toBe(3);
    });
  });

  describe('COACTIVATION_CONFIG', () => {
    it('should have 5 second engagement threshold', () => {
      expect(COACTIVATION_CONFIG.engagement_threshold_seconds).toBe(5);
    });

    it('should require 3 consecutive ignores before decay', () => {
      expect(COACTIVATION_CONFIG.consecutive_ignores_before_decay).toBe(3);
    });

    it('should have max coactivation bonus of 0.30', () => {
      expect(COACTIVATION_CONFIG.max_coactivation_bonus).toBe(0.30);
    });
  });
});

// ============================================================
// CORE WEIGHT FUNCTION TESTS
// ============================================================

describe('Core Weight Functions', () => {
  describe('calculateEffectiveWeight', () => {
    it('should calculate base weight correctly when no adjustments', () => {
      const components: EdgeWeightComponents = {
        base_weight: 0.85,
        learned_adjustment: 0,
        coactivation_bonus: 0,
      };
      const result = calculateEffectiveWeight(components);
      expect(result.effective_weight).toBeCloseTo(0.85);
      expect(result.was_clamped).toBe(false);
    });

    it('should apply learned adjustment correctly', () => {
      const components: EdgeWeightComponents = {
        base_weight: 0.85,
        learned_adjustment: 0.1,
        coactivation_bonus: 0,
      };
      const result = calculateEffectiveWeight(components);
      // 0.85 * (1 + 0.1) = 0.935
      expect(result.effective_weight).toBeCloseTo(0.935);
    });

    it('should add coactivation bonus', () => {
      const components: EdgeWeightComponents = {
        base_weight: 0.80,
        learned_adjustment: 0,
        coactivation_bonus: 0.15,
      };
      const result = calculateEffectiveWeight(components);
      // 0.80 + 0.15 = 0.95
      expect(result.effective_weight).toBeCloseTo(0.95);
    });

    it('should combine all components correctly', () => {
      const components: EdgeWeightComponents = {
        base_weight: 0.50,
        learned_adjustment: 0.2,
        coactivation_bonus: 0.10,
      };
      const result = calculateEffectiveWeight(components);
      // 0.50 * (1 + 0.2) + 0.10 = 0.60 + 0.10 = 0.70
      expect(result.effective_weight).toBeCloseTo(0.70);
    });

    it('should clamp to maximum of 1.00', () => {
      const components: EdgeWeightComponents = {
        base_weight: 0.90,
        learned_adjustment: 0.3,
        coactivation_bonus: 0.30,
      };
      const result = calculateEffectiveWeight(components);
      expect(result.effective_weight).toBe(1.00);
      expect(result.was_clamped).toBe(true);
    });

    it('should clamp to minimum of 0.10', () => {
      const components: EdgeWeightComponents = {
        base_weight: 0.05,
        learned_adjustment: -0.3,
        coactivation_bonus: 0,
      };
      const result = calculateEffectiveWeight(components);
      expect(result.effective_weight).toBe(0.10);
      expect(result.was_clamped).toBe(true);
    });
  });

  describe('createWeightComponents', () => {
    it('should create components with defaults', () => {
      const components = createWeightComponents({ base_weight: 0.75 });
      expect(components.base_weight).toBe(0.75);
      expect(components.learned_adjustment).toBe(0);
      expect(components.coactivation_bonus).toBe(0);
    });

    it('should accept optional parameters', () => {
      const components = createWeightComponents({
        base_weight: 0.60,
        learned_adjustment: 0.1,
        coactivation_bonus: 0.05,
      });
      expect(components.base_weight).toBe(0.60);
      expect(components.learned_adjustment).toBe(0.1);
      expect(components.coactivation_bonus).toBe(0.05);
    });
  });

  describe('applyLearningAdjustment', () => {
    it('should add positive adjustment', () => {
      const components = createWeightComponents({ base_weight: 0.50 });
      const updated = applyLearningAdjustment(components, 0.1);
      expect(updated.learned_adjustment).toBe(0.1);
    });

    it('should add negative adjustment', () => {
      const components = createWeightComponents({ base_weight: 0.50 });
      const updated = applyLearningAdjustment(components, -0.15);
      expect(updated.learned_adjustment).toBe(-0.15);
    });

    it('should clamp to max of 0.30', () => {
      const components = createWeightComponents({
        base_weight: 0.50,
        learned_adjustment: 0.2,
      });
      const updated = applyLearningAdjustment(components, 0.2);
      expect(updated.learned_adjustment).toBe(0.30);
    });

    it('should clamp to min of -0.30', () => {
      const components = createWeightComponents({
        base_weight: 0.50,
        learned_adjustment: -0.2,
      });
      const updated = applyLearningAdjustment(components, -0.2);
      expect(updated.learned_adjustment).toBe(-0.30);
    });

    it('should not mutate original', () => {
      const original = createWeightComponents({ base_weight: 0.50 });
      applyLearningAdjustment(original, 0.1);
      expect(original.learned_adjustment).toBe(0);
    });
  });

  describe('applyCoactivationBonus', () => {
    it('should add positive bonus', () => {
      const components = createWeightComponents({ base_weight: 0.50 });
      const updated = applyCoactivationBonus(components, 0.1);
      expect(updated.coactivation_bonus).toBe(0.1);
    });

    it('should clamp to max of 0.30', () => {
      const components = createWeightComponents({
        base_weight: 0.50,
        coactivation_bonus: 0.25,
      });
      const updated = applyCoactivationBonus(components, 0.1);
      expect(updated.coactivation_bonus).toBe(0.30);
    });

    it('should clamp to min of 0', () => {
      const components = createWeightComponents({
        base_weight: 0.50,
        coactivation_bonus: 0.05,
      });
      const updated = applyCoactivationBonus(components, -0.1);
      expect(updated.coactivation_bonus).toBe(0);
    });
  });

  describe('decayCoactivationBonus', () => {
    it('should decay by factor', () => {
      const components = createWeightComponents({
        base_weight: 0.50,
        coactivation_bonus: 0.20,
      });
      const updated = decayCoactivationBonus(components, 0.95);
      expect(updated.coactivation_bonus).toBeCloseTo(0.19);
    });

    it('should not go below zero', () => {
      const components = createWeightComponents({
        base_weight: 0.50,
        coactivation_bonus: 0.01,
      });
      const updated = decayCoactivationBonus(components, 0.01);
      expect(updated.coactivation_bonus).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================
// EXTRACTION EDGE TESTS
// ============================================================

describe('Extraction Edge Functions', () => {
  describe('calculateExtractionEdge', () => {
    it('should create confirmed edge for high confidence', () => {
      const result = calculateExtractionEdge('part_of', 0.85);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('confirmed');
      // 0.85 * 0.85 = 0.7225
      expect(result!.weight).toBeCloseTo(0.7225);
    });

    it('should create provisional edge for medium confidence', () => {
      const result = calculateExtractionEdge('part_of', 0.60);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('provisional');
      // 0.85 * 0.60 * 0.5 = 0.255
      expect(result!.weight).toBeCloseTo(0.255);
    });

    it('should return null for low confidence', () => {
      const result = calculateExtractionEdge('part_of', 0.40);
      expect(result).toBeNull();
    });

    it('should use edge type base weight', () => {
      const highResult = calculateExtractionEdge('same_entity', 0.80);
      const lowResult = calculateExtractionEdge('relates_to', 0.80);
      expect(highResult!.weight).toBeGreaterThan(lowResult!.weight);
    });
  });

  describe('Provisional State Functions', () => {
    let state: ProvisionalEdgeState;

    beforeEach(() => {
      state = createProvisionalState();
    });

    it('should create state with zero activations', () => {
      expect(state.activation_count).toBe(0);
    });

    it('should set expires_at 30 days in future', () => {
      const created = new Date(state.created_at);
      const expires = new Date(state.expires_at);
      const daysDiff = (expires.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
      expect(Math.round(daysDiff)).toBe(30);
    });

    it('should not promote with 0 activations', () => {
      expect(shouldPromoteProvisional(state)).toBe(false);
    });

    it('should promote after 3 activations', () => {
      state = incrementProvisionalActivation(state);
      state = incrementProvisionalActivation(state);
      state = incrementProvisionalActivation(state);
      expect(shouldPromoteProvisional(state)).toBe(true);
    });

    it('should expire if past expiry with low activations', () => {
      const expiredState: ProvisionalEdgeState = {
        created_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        activation_count: 1,
        expires_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      };
      expect(shouldExpireProvisional(expiredState)).toBe(true);
    });

    it('should not expire if past expiry but enough activations', () => {
      const state: ProvisionalEdgeState = {
        created_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        activation_count: 3,
        expires_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      };
      expect(shouldExpireProvisional(state)).toBe(false);
    });
  });
});

// ============================================================
// SIMILARITY EDGE TESTS
// ============================================================

describe('Similarity Edge Functions', () => {
  describe('meetsSimilarityThreshold', () => {
    it('should return true for similarity >= 0.85', () => {
      expect(meetsSimilarityThreshold(0.85)).toBe(true);
      expect(meetsSimilarityThreshold(0.90)).toBe(true);
      expect(meetsSimilarityThreshold(1.00)).toBe(true);
    });

    it('should return false for similarity < 0.85', () => {
      expect(meetsSimilarityThreshold(0.84)).toBe(false);
      expect(meetsSimilarityThreshold(0.50)).toBe(false);
      expect(meetsSimilarityThreshold(0)).toBe(false);
    });
  });

  describe('isEmbeddingFresh', () => {
    it('should return true if embedding is newer than content', () => {
      expect(
        isEmbeddingFresh({
          embedding_version: 1,
          last_content_update: '2024-01-01T00:00:00.000Z',
          last_embedding_update: '2024-01-02T00:00:00.000Z',
        })
      ).toBe(true);
    });

    it('should return true if same time', () => {
      expect(
        isEmbeddingFresh({
          embedding_version: 1,
          last_content_update: '2024-01-01T00:00:00.000Z',
          last_embedding_update: '2024-01-01T00:00:00.000Z',
        })
      ).toBe(true);
    });

    it('should return false if embedding is older than content', () => {
      expect(
        isEmbeddingFresh({
          embedding_version: 1,
          last_content_update: '2024-01-02T00:00:00.000Z',
          last_embedding_update: '2024-01-01T00:00:00.000Z',
        })
      ).toBe(false);
    });
  });

  describe('calculateSimilarityWeight', () => {
    it('should return raw similarity as weight', () => {
      expect(calculateSimilarityWeight(0.92)).toBe(0.92);
      expect(calculateSimilarityWeight(0.85)).toBe(0.85);
      expect(calculateSimilarityWeight(1.0)).toBe(1.0);
    });
  });
});

// ============================================================
// USER EDGE TESTS
// ============================================================

describe('User Edge Functions', () => {
  describe('calculateUserEdgeWeight', () => {
    it('should return default 0.90 when no strength provided', () => {
      expect(calculateUserEdgeWeight()).toBe(0.90);
    });

    it('should return provided strength when valid', () => {
      expect(calculateUserEdgeWeight(0.75)).toBe(0.75);
    });

    it('should clamp to minimum 0.50', () => {
      expect(calculateUserEdgeWeight(0.30)).toBe(0.50);
    });

    it('should clamp to maximum 1.00', () => {
      expect(calculateUserEdgeWeight(1.50)).toBe(1.00);
    });
  });

  describe('isAllowedUserEdgeType', () => {
    it('should allow user_linked', () => {
      expect(isAllowedUserEdgeType('user_linked')).toBe(true);
    });

    it('should allow relates_to', () => {
      expect(isAllowedUserEdgeType('relates_to')).toBe(true);
    });

    it('should not allow temporal_adjacent', () => {
      expect(isAllowedUserEdgeType('temporal_adjacent')).toBe(false);
    });

    it('should not allow similar_to', () => {
      expect(isAllowedUserEdgeType('similar_to')).toBe(false);
    });
  });
});

// ============================================================
// TEMPORAL EDGE TESTS
// ============================================================

describe('Temporal Edge Functions', () => {
  describe('calculateTemporalWeight', () => {
    it('should return 1.0 for 0 minutes apart', () => {
      const weight = calculateTemporalWeight(0);
      expect(weight).toBeCloseTo(1.0);
    });

    it('should return ~0.37 for 30 minutes apart', () => {
      const weight = calculateTemporalWeight(30);
      expect(weight).toBeCloseTo(0.368, 2);
    });

    it('should return min_strength (0.20) for 60 minutes apart (clamped)', () => {
      const weight = calculateTemporalWeight(60);
      // e^(-60/30) = e^(-2) ≈ 0.135, but clamped to min_strength 0.20
      expect(weight).toBeCloseTo(0.20, 2);
    });

    it('should return null for > 120 minutes', () => {
      expect(calculateTemporalWeight(121)).toBeNull();
      expect(calculateTemporalWeight(200)).toBeNull();
    });

    it('should clamp to min_strength 0.20', () => {
      const weight = calculateTemporalWeight(100);
      expect(weight).toBeGreaterThanOrEqual(0.20);
    });
  });

  describe('createTemporalAdjacentEdge', () => {
    it('should create edge for valid gap', () => {
      const edge = createTemporalAdjacentEdge('n_1', 'n_2', 15);
      expect(edge).not.toBeNull();
      expect(edge!.type).toBe('temporal_adjacent');
      expect(edge!.source).toBe('n_1');
      expect(edge!.target).toBe('n_2');
    });

    it('should return null for gap > 120', () => {
      const edge = createTemporalAdjacentEdge('n_1', 'n_2', 150);
      expect(edge).toBeNull();
    });
  });

  describe('Session Functions', () => {
    const baseTime = new Date('2024-06-01T10:00:00.000Z').getTime();

    const createSession = (startOffset: number, endOffset: number, nodes: Array<{id: string, cluster: string, offset: number}>): Session => ({
      id: 'session_1',
      start: new Date(baseTime + startOffset * 60000).toISOString(),
      end: new Date(baseTime + endOffset * 60000).toISOString(),
      accessedNodes: nodes.map(n => ({
        id: n.id,
        cluster_id: n.cluster,
        accessed_at: new Date(baseTime + n.offset * 60000).toISOString(),
      })),
    });

    describe('checkContinuationEligibility', () => {
      it('should return true for overlapping clusters within 24 hours', () => {
        const prev = createSession(0, 60, [{ id: 'n1', cluster: 'c1', offset: 30 }]);
        const curr = createSession(120, 180, [{ id: 'n2', cluster: 'c1', offset: 150 }]);
        const result = checkContinuationEligibility(curr, prev);
        expect(result.should_create).toBe(true);
        expect(result.overlapping_clusters).toContain('c1');
      });

      it('should return false for gap > 24 hours', () => {
        const prev = createSession(0, 60, [{ id: 'n1', cluster: 'c1', offset: 30 }]);
        // Gap must be > 24 hours, so use 26 hours from prev.end (which is at 1 hour)
        // prev.end = baseTime + 60 min = baseTime + 1 hour
        // curr.start needs to be > 25 hours from baseTime for gap > 24 hours
        const curr: Session = {
          id: 'session_2',
          start: new Date(baseTime + 26 * 60 * 60 * 1000).toISOString(),
          end: new Date(baseTime + 27 * 60 * 60 * 1000).toISOString(),
          accessedNodes: [{ id: 'n2', cluster_id: 'c1', accessed_at: new Date(baseTime + 26 * 60 * 60 * 1000).toISOString() }],
        };
        const result = checkContinuationEligibility(curr, prev);
        expect(result.should_create).toBe(false);
      });

      it('should return false for no overlapping clusters', () => {
        const prev = createSession(0, 60, [{ id: 'n1', cluster: 'c1', offset: 30 }]);
        const curr = createSession(120, 180, [{ id: 'n2', cluster: 'c2', offset: 150 }]);
        const result = checkContinuationEligibility(curr, prev);
        expect(result.should_create).toBe(false);
        expect(result.overlapping_clusters).toHaveLength(0);
      });
    });

    describe('detectContinuationEdges', () => {
      it('should create edges between nodes in overlapping clusters', () => {
        const prev = createSession(0, 60, [
          { id: 'n1', cluster: 'c1', offset: 30 },
          { id: 'n2', cluster: 'c1', offset: 45 },
        ]);
        const curr = createSession(120, 180, [
          { id: 'n3', cluster: 'c1', offset: 150 },
        ]);
        const edges = detectContinuationEdges(curr, prev);
        expect(edges.length).toBe(2);
        expect(edges.every(e => e.type === 'temporal_continuation')).toBe(true);
        expect(edges.every(e => e.weight === 0.30)).toBe(true);
      });

      it('should not create edges for same node', () => {
        const prev = createSession(0, 60, [{ id: 'n1', cluster: 'c1', offset: 30 }]);
        const curr = createSession(120, 180, [{ id: 'n1', cluster: 'c1', offset: 150 }]);
        const edges = detectContinuationEdges(curr, prev);
        expect(edges.length).toBe(0);
      });
    });

    describe('createSessionTemporalEdges', () => {
      it('should create edges between consecutive nodes', () => {
        const session = createSession(0, 60, [
          { id: 'n1', cluster: 'c1', offset: 5 },
          { id: 'n2', cluster: 'c1', offset: 15 },
          { id: 'n3', cluster: 'c1', offset: 25 },
        ]);
        const edges = createSessionTemporalEdges(session);
        expect(edges.length).toBe(2);
        expect(edges[0].source).toBe('n1');
        expect(edges[0].target).toBe('n2');
        expect(edges[1].source).toBe('n2');
        expect(edges[1].target).toBe('n3');
      });

      it('should skip edges where gap > 120 minutes', () => {
        const session: Session = {
          id: 'session_1',
          start: new Date(baseTime).toISOString(),
          end: new Date(baseTime + 180 * 60000).toISOString(),
          accessedNodes: [
            { id: 'n1', cluster_id: 'c1', accessed_at: new Date(baseTime + 5 * 60000).toISOString() },
            { id: 'n2', cluster_id: 'c1', accessed_at: new Date(baseTime + 150 * 60000).toISOString() },
          ],
        };
        const edges = createSessionTemporalEdges(session);
        expect(edges.length).toBe(0);
      });
    });

    describe('hasSessionEnded', () => {
      it('should return true after 30 minutes', () => {
        const lastAccess = new Date(baseTime).toISOString();
        const currentTime = new Date(baseTime + 31 * 60000).toISOString();
        expect(hasSessionEnded(lastAccess, currentTime)).toBe(true);
      });

      it('should return false within 30 minutes', () => {
        const lastAccess = new Date(baseTime).toISOString();
        const currentTime = new Date(baseTime + 25 * 60000).toISOString();
        expect(hasSessionEnded(lastAccess, currentTime)).toBe(false);
      });
    });
  });
});

// ============================================================
// CO-ACTIVATION TESTS
// ============================================================

describe('Co-activation Functions', () => {
  describe('didUserEngage', () => {
    it('should return true for >= 5 seconds', () => {
      expect(didUserEngage(5)).toBe(true);
      expect(didUserEngage(10)).toBe(true);
      expect(didUserEngage(100)).toBe(true);
    });

    it('should return false for < 5 seconds', () => {
      expect(didUserEngage(4)).toBe(false);
      expect(didUserEngage(0)).toBe(false);
      expect(didUserEngage(4.9)).toBe(false);
    });
  });

  describe('calculateStrengtheningDelta', () => {
    it('should give higher delta for lower weights', () => {
      const lowWeightDelta = calculateStrengtheningDelta(0.30);
      const highWeightDelta = calculateStrengtheningDelta(0.90);
      expect(lowWeightDelta).toBeGreaterThan(highWeightDelta);
    });

    it('should approach zero as weight approaches 1.0', () => {
      const delta = calculateStrengtheningDelta(0.99);
      expect(delta).toBeCloseTo(0.001);
    });
  });

  describe('updateCoActivationWeight', () => {
    let baseEdge: WeightedEdge;

    beforeEach(() => {
      baseEdge = createWeightedEdge({
        source: 'n1',
        target: 'n2',
        type: 'relates_to',
        creationSource: 'extraction',
      });
    });

    it('should strengthen on engagement', () => {
      const result = updateCoActivationWeight(baseEdge, true);
      expect(result.action).toBe('strengthened');
      expect(result.new_weight).toBeGreaterThan(result.previous_weight);
      expect(result.edge.consecutive_ignored).toBe(0);
    });

    it('should increment ignore counter on non-engagement', () => {
      const result = updateCoActivationWeight(baseEdge, false);
      expect(result.action).toBe('unchanged');
      expect(result.edge.consecutive_ignored).toBe(1);
    });

    it('should decay after 3 consecutive ignores', () => {
      let edge = baseEdge;
      edge = { ...edge, components: applyCoactivationBonus(edge.components, 0.1) };
      edge.consecutive_ignored = 2;

      const result = updateCoActivationWeight(edge, false);
      expect(result.action).toBe('decayed');
      expect(result.edge.consecutive_ignored).toBe(0);
    });

    it('should increment activation_count', () => {
      const result = updateCoActivationWeight(baseEdge, true);
      expect(result.edge.activation_count).toBe(1);
    });

    it('should update neural.co_activation_count', () => {
      const result = updateCoActivationWeight(baseEdge, true);
      expect(result.edge.neural.co_activation_count).toBe(1);
    });
  });

  describe('applyTimeBasedDecay', () => {
    it('should not decay within 30 days', () => {
      const edge = createWeightedEdge({
        source: 'n1',
        target: 'n2',
        type: 'relates_to',
        creationSource: 'extraction',
      });
      edge.components.coactivation_bonus = 0.2;
      edge.neural.last_co_activation = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

      const result = applyTimeBasedDecay(edge);
      expect(result.decay_applied).toBe(false);
      expect(result.new_bonus).toBe(0.2);
    });

    it('should decay after 60 days (1 period past start)', () => {
      const edge = createWeightedEdge({
        source: 'n1',
        target: 'n2',
        type: 'relates_to',
        creationSource: 'extraction',
      });
      edge.components.coactivation_bonus = 0.2;
      edge.neural.last_co_activation = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString();

      const result = applyTimeBasedDecay(edge);
      expect(result.decay_applied).toBe(true);
      expect(result.decay_periods).toBe(1);
      expect(result.new_bonus).toBeCloseTo(0.2 * 0.95);
    });
  });

  describe('shouldConsiderNewEdge', () => {
    it('should return true for similarity > 0.50', () => {
      expect(shouldConsiderNewEdge(0.51)).toBe(true);
      expect(shouldConsiderNewEdge(0.80)).toBe(true);
    });

    it('should return false for similarity <= 0.50', () => {
      expect(shouldConsiderNewEdge(0.50)).toBe(false);
      expect(shouldConsiderNewEdge(0.30)).toBe(false);
    });
  });

  describe('isEdgeDead', () => {
    it('should return true for minimum weight and no bonus', () => {
      const edge = createWeightedEdge({
        source: 'n1',
        target: 'n2',
        type: 'relates_to',
        creationSource: 'extraction',
        baseWeight: 0.10,
      });
      edge.components.coactivation_bonus = 0;
      expect(isEdgeDead(edge)).toBe(true);
    });

    it('should return false if has bonus', () => {
      const edge = createWeightedEdge({
        source: 'n1',
        target: 'n2',
        type: 'relates_to',
        creationSource: 'extraction',
        baseWeight: 0.10,
      });
      edge.components.coactivation_bonus = 0.05;
      expect(isEdgeDead(edge)).toBe(false);
    });
  });
});

// ============================================================
// COMPRESSION TESTS
// ============================================================

describe('Compression Functions', () => {
  describe('getCompressionConfig', () => {
    it('should require 3 min nodes for small graphs', () => {
      const config = getCompressionConfig(100);
      expect(config.clustering.min_nodes_for_compression).toBe(3);
    });

    it('should require 5 min nodes for medium graphs', () => {
      const config = getCompressionConfig(1000);
      expect(config.clustering.min_nodes_for_compression).toBe(5);
    });

    it('should require 10 min nodes for large graphs', () => {
      const config = getCompressionConfig(10000);
      expect(config.clustering.min_nodes_for_compression).toBe(10);
    });

    it('should set 365 day restoration window', () => {
      const config = getCompressionConfig(100);
      expect(config.retention.restorable_days).toBe(365);
    });
  });

  describe('isNeverCompress', () => {
    const config = getCompressionConfig(100);

    it('should return true for pinned nodes', () => {
      expect(
        isNeverCompress(
          { is_pinned: true, is_starred: false, created_at: '2020-01-01T00:00:00.000Z' },
          config
        )
      ).toBe(true);
    });

    it('should return true for starred nodes', () => {
      expect(
        isNeverCompress(
          { is_pinned: false, is_starred: true, created_at: '2020-01-01T00:00:00.000Z' },
          config
        )
      ).toBe(true);
    });

    it('should return true for recent nodes (< 30 days)', () => {
      const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      expect(
        isNeverCompress({ is_pinned: false, is_starred: false, created_at: recentDate }, config)
      ).toBe(true);
    });

    it('should return false for old, non-pinned, non-starred nodes', () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      expect(
        isNeverCompress({ is_pinned: false, is_starred: false, created_at: oldDate }, config)
      ).toBe(false);
    });
  });

  describe('meetsCompressionRequirements', () => {
    const config = getCompressionConfig(100);

    it('should return false for non-dormant nodes', () => {
      expect(
        meetsCompressionRequirements({ lifecycle: 'active', importance_score: 0.1 }, 0, config)
      ).toBe(false);
    });

    it('should return false for recently dormant nodes', () => {
      const recentDormant = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      expect(
        meetsCompressionRequirements(
          { lifecycle: 'dormant', dormant_since: recentDormant, importance_score: 0.1 },
          0,
          config
        )
      ).toBe(false);
    });

    it('should return false for high importance nodes', () => {
      const oldDormant = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      expect(
        meetsCompressionRequirements(
          { lifecycle: 'dormant', dormant_since: oldDormant, importance_score: 0.5 },
          0,
          config
        )
      ).toBe(false);
    });

    it('should return false for nodes with too many strong edges', () => {
      const oldDormant = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      expect(
        meetsCompressionRequirements(
          { lifecycle: 'dormant', dormant_since: oldDormant, importance_score: 0.1 },
          5,
          config
        )
      ).toBe(false);
    });

    it('should return true for qualifying nodes', () => {
      const oldDormant = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      expect(
        meetsCompressionRequirements(
          { lifecycle: 'dormant', dormant_since: oldDormant, importance_score: 0.1 },
          1,
          config
        )
      ).toBe(true);
    });
  });

  describe('createCompressionState', () => {
    it('should set restorable_until correctly', () => {
      const state = createCompressionState('sum_123', 365);
      const compressed = new Date(state.compressed_at!);
      const restorable = new Date(state.restorable_until!);
      const daysDiff = (restorable.getTime() - compressed.getTime()) / (1000 * 60 * 60 * 24);
      expect(Math.round(daysDiff)).toBe(365);
    });
  });

  describe('isRestorable', () => {
    it('should return true within restoration window', () => {
      const state = createCompressionState('sum_123', 365);
      expect(isRestorable(state)).toBe(true);
    });

    it('should return false after window expires', () => {
      const expiredState = {
        compressed_into: 'sum_123',
        compressed_at: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
        restorable_until: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
      };
      expect(isRestorable(expiredState)).toBe(false);
    });

    it('should return false if no restorable_until', () => {
      expect(isRestorable({})).toBe(false);
    });
  });

  describe('createEdgeRecord', () => {
    it('should create record with all fields', () => {
      const record = createEdgeRecord('n1', 'n2', 'relates_to', 0.75);
      expect(record.original_source).toBe('n1');
      expect(record.target).toBe('n2');
      expect(record.original_type).toBe('relates_to');
      expect(record.original_weight).toBe(0.75);
    });
  });

  describe('calculateAggregatedWeight', () => {
    it('should return max weight for multiple records', () => {
      const records = [
        { original_source: 'n1', target: 'n3', original_type: 'relates_to', original_weight: 0.6 },
        { original_source: 'n2', target: 'n3', original_type: 'part_of', original_weight: 0.8 },
      ];
      expect(calculateAggregatedWeight(records)).toBe(0.8);
    });

    it('should return null for empty records', () => {
      expect(calculateAggregatedWeight([])).toBeNull();
    });

    it('should return null if max weight < 0.5', () => {
      const records = [
        { original_source: 'n1', target: 'n3', original_type: 'relates_to', original_weight: 0.3 },
        { original_source: 'n2', target: 'n3', original_type: 'part_of', original_weight: 0.4 },
      ];
      expect(calculateAggregatedWeight(records)).toBeNull();
    });
  });

  describe('generateSummaryNodeId', () => {
    it('should generate ID with sum_ prefix', () => {
      const id = generateSummaryNodeId();
      expect(id.startsWith('sum_')).toBe(true);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSummaryNodeId());
      }
      expect(ids.size).toBe(100);
    });
  });
});

// ============================================================
// FACTORY TESTS
// ============================================================

describe('createWeightedEdge', () => {
  it('should create edge with correct ID format', () => {
    const edge = createWeightedEdge({
      source: 'n1',
      target: 'n2',
      type: 'relates_to',
      creationSource: 'extraction',
    });
    expect(edge.id).toMatch(/^e_[a-zA-Z0-9_-]{12}$/);
  });

  it('should use edge type weight as base', () => {
    const edge = createWeightedEdge({
      source: 'n1',
      target: 'n2',
      type: 'part_of',
      creationSource: 'extraction',
    });
    expect(edge.components.base_weight).toBe(0.85);
  });

  it('should default to confirmed status', () => {
    const edge = createWeightedEdge({
      source: 'n1',
      target: 'n2',
      type: 'relates_to',
      creationSource: 'extraction',
    });
    expect(edge.status).toBe('confirmed');
  });

  it('should allow custom base weight', () => {
    const edge = createWeightedEdge({
      source: 'n1',
      target: 'n2',
      type: 'relates_to',
      creationSource: 'extraction',
      baseWeight: 0.33,
    });
    expect(edge.components.base_weight).toBe(0.33);
  });

  it('should initialize counters to zero', () => {
    const edge = createWeightedEdge({
      source: 'n1',
      target: 'n2',
      type: 'relates_to',
      creationSource: 'extraction',
    });
    expect(edge.consecutive_ignored).toBe(0);
    expect(edge.activation_count).toBe(0);
    expect(edge.neural.co_activation_count).toBe(0);
  });
});

// ============================================================
// VALIDATION TESTS
// ============================================================

describe('Validation Functions', () => {
  describe('validateWeightComponents', () => {
    it('should accept valid components', () => {
      expect(
        validateWeightComponents({
          base_weight: 0.5,
          learned_adjustment: 0.1,
          coactivation_bonus: 0.05,
        })
      ).toBe(true);
    });

    it('should reject invalid base_weight', () => {
      expect(
        validateWeightComponents({
          base_weight: 1.5,
          learned_adjustment: 0,
          coactivation_bonus: 0,
        })
      ).toBe(false);
    });

    it('should reject invalid learned_adjustment', () => {
      expect(
        validateWeightComponents({
          base_weight: 0.5,
          learned_adjustment: 0.5,
          coactivation_bonus: 0,
        })
      ).toBe(false);
    });
  });

  describe('validateSession', () => {
    it('should accept valid session', () => {
      expect(
        validateSession({
          id: 'session_1',
          start: '2024-01-01T10:00:00.000Z',
          end: '2024-01-01T11:00:00.000Z',
          accessedNodes: [
            { id: 'n1', cluster_id: 'c1', accessed_at: '2024-01-01T10:30:00.000Z' },
          ],
        })
      ).toBe(true);
    });

    it('should reject invalid datetime', () => {
      expect(
        validateSession({
          id: 'session_1',
          start: 'invalid',
          end: '2024-01-01T11:00:00.000Z',
          accessedNodes: [],
        })
      ).toBe(false);
    });
  });

  describe('validateCompressionState', () => {
    it('should accept valid state', () => {
      expect(
        validateCompressionState({
          compressed_into: 'sum_123',
          compressed_at: '2024-01-01T10:00:00.000Z',
          restorable_until: '2025-01-01T10:00:00.000Z',
        })
      ).toBe(true);
    });

    it('should accept empty state', () => {
      expect(validateCompressionState({})).toBe(true);
    });
  });
});
