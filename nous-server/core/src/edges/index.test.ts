/**
 * @module @nous/core/edges
 * @description Tests for edges module - Edge schema and relationships
 */

import { describe, it, expect } from 'vitest';
import {
  generateEdgeId,
  createEdge,
  createDefaultEdgeNeuralProperties,
  strengthenEdge,
  decayEdge,
  reactivateEdge,
  updateEdgeConfidence,
  edgeConnects,
  getOtherNode,
  isEdgeDecayed,
  shouldPruneEdge,
  filterEdgesByType,
  getEdgesForNode,
  getOutgoingEdges,
  getIncomingEdges,
  sortEdgesByStrength,
  sortEdgesByCoActivation,
  validateEdge,
  parseEdge,
  safeParseEdge,
  NousEdgeSchema,
  EDGE_CREATION_RULES,
  type NousEdge,
} from './index';

describe('Edges Module', () => {
  describe('generateEdgeId', () => {
    it('should generate edge ID with correct prefix', () => {
      const id = generateEdgeId();

      expect(id).toMatch(/^e_[a-zA-Z0-9_-]{12}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateEdgeId());
      }

      expect(ids.size).toBe(100);
    });
  });

  describe('createEdge', () => {
    it('should create an edge with required fields', () => {
      const edge = createEdge('n_source123456', 'n_target123456', 'relates_to');

      expect(edge.id).toMatch(/^e_/);
      expect(edge.source).toBe('n_source123456');
      expect(edge.target).toBe('n_target123456');
      expect(edge.type).toBe('relates_to');
    });

    it('should set default values', () => {
      const edge = createEdge('n_source123456', 'n_target123456', 'relates_to');

      expect(edge.strength).toBe(0.5);
      expect(edge.confidence).toBe(1.0);
      expect(edge.neural.co_activation_count).toBe(0);
      expect(edge.neural.decay_factor).toBe(1.0);
      expect(edge.provenance.source_type).toBe('manual');
    });

    it('should accept options', () => {
      const edge = createEdge('n_source123456', 'n_target123456', 'causes', {
        subtype: 'direct',
        strength: 0.8,
        confidence: 0.9,
        sourceType: 'extraction',
        extractionConfidence: 0.85,
      });

      expect(edge.subtype).toBe('direct');
      expect(edge.strength).toBe(0.8);
      expect(edge.confidence).toBe(0.9);
      expect(edge.provenance.source_type).toBe('extraction');
      expect(edge.provenance.extraction_confidence).toBe(0.85);
    });
  });

  describe('createDefaultEdgeNeuralProperties', () => {
    it('should create default neural properties', () => {
      const neural = createDefaultEdgeNeuralProperties();

      expect(neural.co_activation_count).toBe(0);
      expect(neural.decay_factor).toBe(1.0);
      expect(neural.last_co_activation).toBeDefined();
    });
  });

  describe('strengthenEdge', () => {
    it('should increase strength', () => {
      let edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      edge = strengthenEdge(edge, 0.2);

      expect(edge.strength).toBe(0.7);
    });

    it('should increment co-activation count', () => {
      let edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      expect(edge.neural.co_activation_count).toBe(0);

      edge = strengthenEdge(edge);
      expect(edge.neural.co_activation_count).toBe(1);

      edge = strengthenEdge(edge);
      expect(edge.neural.co_activation_count).toBe(2);
    });

    it('should cap strength at 1.0', () => {
      let edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to', {
        strength: 0.9,
      });

      edge = strengthenEdge(edge, 0.5);

      expect(edge.strength).toBe(1.0);
    });

    it('should update last_co_activation', async () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');
      const originalTime = edge.neural.last_co_activation;

      await new Promise((resolve) => setTimeout(resolve, 10));

      const strengthened = strengthenEdge(edge);

      expect(new Date(strengthened.neural.last_co_activation).getTime()).toBeGreaterThan(
        new Date(originalTime).getTime()
      );
    });
  });

  describe('decayEdge', () => {
    it('should decrease decay factor', () => {
      let edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      expect(edge.neural.decay_factor).toBe(1.0);

      edge = decayEdge(edge, 0.1);
      expect(edge.neural.decay_factor).toBe(0.9);

      edge = decayEdge(edge, 0.1);
      expect(edge.neural.decay_factor).toBe(0.8);
    });

    it('should not go below 0', () => {
      let edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      edge = decayEdge(edge, 2.0);

      expect(edge.neural.decay_factor).toBe(0);
    });

    it('should use default decay rate', () => {
      let edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      edge = decayEdge(edge);

      expect(edge.neural.decay_factor).toBe(0.95);
    });
  });

  describe('reactivateEdge', () => {
    it('should reset decay factor to 1.0', () => {
      let edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');
      edge = decayEdge(edge, 0.5);

      expect(edge.neural.decay_factor).toBe(0.5);

      edge = reactivateEdge(edge);
      expect(edge.neural.decay_factor).toBe(1.0);
    });

    it('should update last_co_activation', async () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');
      const originalTime = edge.neural.last_co_activation;

      await new Promise((resolve) => setTimeout(resolve, 10));

      const reactivated = reactivateEdge(edge);

      expect(new Date(reactivated.neural.last_co_activation).getTime()).toBeGreaterThan(
        new Date(originalTime).getTime()
      );
    });
  });

  describe('updateEdgeConfidence', () => {
    it('should update confidence', () => {
      let edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      edge = updateEdgeConfidence(edge, 0.75);

      expect(edge.confidence).toBe(0.75);
    });

    it('should clamp confidence to [0, 1]', () => {
      let edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      edge = updateEdgeConfidence(edge, 1.5);
      expect(edge.confidence).toBe(1.0);

      edge = updateEdgeConfidence(edge, -0.5);
      expect(edge.confidence).toBe(0);
    });
  });

  describe('edgeConnects', () => {
    it('should return true for connected nodes', () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      expect(edgeConnects(edge, 'n_a123456789ab', 'n_b123456789ab')).toBe(true);
    });

    it('should work in either direction', () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      expect(edgeConnects(edge, 'n_b123456789ab', 'n_a123456789ab')).toBe(true);
    });

    it('should return false for unconnected nodes', () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      expect(edgeConnects(edge, 'n_a123456789ab', 'n_c123456789ab')).toBe(false);
    });
  });

  describe('getOtherNode', () => {
    it('should return target when given source', () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      expect(getOtherNode(edge, 'n_a123456789ab')).toBe('n_b123456789ab');
    });

    it('should return source when given target', () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      expect(getOtherNode(edge, 'n_b123456789ab')).toBe('n_a123456789ab');
    });

    it('should return undefined for unrelated node', () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      expect(getOtherNode(edge, 'n_c123456789ab')).toBeUndefined();
    });
  });

  describe('isEdgeDecayed', () => {
    it('should return true when below threshold', () => {
      let edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');
      edge = decayEdge(edge, 0.95); // decay_factor = 0.05

      expect(isEdgeDecayed(edge, 0.1)).toBe(true);
    });

    it('should return false when above threshold', () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      expect(isEdgeDecayed(edge, 0.1)).toBe(false);
    });

    it('should use default threshold', () => {
      let edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');
      edge = decayEdge(edge, 0.95);

      expect(isEdgeDecayed(edge)).toBe(true);
    });
  });

  describe('Edge Filtering and Sorting', () => {
    const edges: NousEdge[] = [];

    beforeAll(() => {
      edges.push(
        createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to', { strength: 0.5 }),
        createEdge('n_a123456789ab', 'n_c123456789ab', 'causes', { strength: 0.8 }),
        createEdge('n_b123456789ab', 'n_c123456789ab', 'relates_to', { strength: 0.3 }),
        createEdge('n_d123456789ab', 'n_a123456789ab', 'part_of', { strength: 0.9 })
      );
    });

    describe('filterEdgesByType', () => {
      it('should filter by type', () => {
        const relatesTo = filterEdgesByType(edges, 'relates_to');

        expect(relatesTo).toHaveLength(2);
        expect(relatesTo.every((e) => e.type === 'relates_to')).toBe(true);
      });
    });

    describe('getEdgesForNode', () => {
      it('should get all edges connected to a node', () => {
        const nodeEdges = getEdgesForNode(edges, 'n_a123456789ab');

        expect(nodeEdges).toHaveLength(3);
      });
    });

    describe('getOutgoingEdges', () => {
      it('should get only outgoing edges', () => {
        const outgoing = getOutgoingEdges(edges, 'n_a123456789ab');

        expect(outgoing).toHaveLength(2);
        expect(outgoing.every((e) => e.source === 'n_a123456789ab')).toBe(true);
      });
    });

    describe('getIncomingEdges', () => {
      it('should get only incoming edges', () => {
        const incoming = getIncomingEdges(edges, 'n_a123456789ab');

        expect(incoming).toHaveLength(1);
        expect(incoming[0]?.target).toBe('n_a123456789ab');
      });
    });

    describe('sortEdgesByStrength', () => {
      it('should sort by strength descending', () => {
        const sorted = sortEdgesByStrength(edges);

        expect(sorted[0]?.strength).toBe(0.9);
        expect(sorted[sorted.length - 1]?.strength).toBe(0.3);
      });

      it('should not mutate original array', () => {
        const originalFirst = edges[0];
        sortEdgesByStrength(edges);

        expect(edges[0]).toBe(originalFirst);
      });
    });
  });

  describe('Edge Validation', () => {
    describe('validateEdge', () => {
      it('should return true for valid edge', () => {
        const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

        expect(validateEdge(edge)).toBe(true);
      });

      it('should return false for invalid edge', () => {
        const invalid = { id: 'bad_id', source: 'x', target: 'y', type: 'relates_to' };

        expect(validateEdge(invalid)).toBe(false);
      });
    });

    describe('parseEdge', () => {
      it('should parse valid edge', () => {
        const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');
        const parsed = parseEdge(edge);

        expect(parsed.id).toBe(edge.id);
      });

      it('should throw on invalid edge', () => {
        const invalid = { id: 'bad' };

        expect(() => parseEdge(invalid)).toThrow();
      });
    });

    describe('safeParseEdge', () => {
      it('should return edge for valid data', () => {
        const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');
        const result = safeParseEdge(edge);

        expect(result).not.toBeNull();
        expect(result?.id).toBe(edge.id);
      });

      it('should return null for invalid data', () => {
        const invalid = { id: 'bad' };

        expect(safeParseEdge(invalid)).toBeNull();
      });
    });
  });

  describe('EDGE_CREATION_RULES', () => {
    it('should have co-mention rule', () => {
      expect(EDGE_CREATION_RULES.CO_MENTION.type).toBe('relates_to');
      expect(EDGE_CREATION_RULES.CO_MENTION.defaultStrength).toBe(0.5);
    });

    it('should have explicit causal rule', () => {
      expect(EDGE_CREATION_RULES.EXPLICIT_CAUSAL.type).toBe('causes');
      expect(EDGE_CREATION_RULES.EXPLICIT_CAUSAL.defaultStrength).toBe(0.8);
    });

    it('should have extraction origin rule', () => {
      expect(EDGE_CREATION_RULES.EXTRACTION_ORIGIN.type).toBe('mentioned_in');
      expect(EDGE_CREATION_RULES.EXTRACTION_ORIGIN.defaultStrength).toBe(1.0);
    });

    it('should have embedding similarity rule', () => {
      expect(EDGE_CREATION_RULES.EMBEDDING_SIMILARITY.type).toBe('similar_to');
      expect(EDGE_CREATION_RULES.EMBEDDING_SIMILARITY.threshold).toBe(0.85);
    });
  });

  describe('Schema Validation', () => {
    it('should validate valid edge', () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');

      const result = NousEdgeSchema.safeParse(edge);
      expect(result.success).toBe(true);
    });

    it('should reject invalid edge ID format', () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');
      const invalid = { ...edge, id: 'invalid_id' };

      const result = NousEdgeSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject invalid edge type', () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');
      const invalid = { ...edge, type: 'invalid_type' };

      const result = NousEdgeSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject out-of-range strength', () => {
      const edge = createEdge('n_a123456789ab', 'n_b123456789ab', 'relates_to');
      const invalid = { ...edge, strength: 1.5 };

      const result = NousEdgeSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});

// Polyfill for beforeAll in describe context
import { beforeAll } from 'vitest';
