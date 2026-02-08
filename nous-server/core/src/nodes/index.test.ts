/**
 * @module @nous/core/nodes
 * @description Tests for nodes module - Universal Node Schema (UNS)
 */

import { describe, it, expect } from 'vitest';
import {
  generateNodeId,
  createDefaultNeuralProperties,
  createInitialVersion,
  createNode,
  createConceptNode,
  createNoteNode,
  recordAccess,
  updateLifecycle,
  NousNodeSchema,
  ConceptNodeSchema,
  EpisodeNodeSchema,
  NoteNodeSchema,
  type NousNode,
  type ConceptNode,
  type NodeContent,
} from './index';

describe('Nodes Module', () => {
  describe('generateNodeId', () => {
    it('should generate node ID with correct prefix', () => {
      const id = generateNodeId();

      expect(id).toMatch(/^n_[a-zA-Z0-9_-]{12}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateNodeId());
      }

      expect(ids.size).toBe(100);
    });
  });

  describe('createDefaultNeuralProperties', () => {
    it('should create neural properties with defaults', () => {
      const neural = createDefaultNeuralProperties();

      expect(neural.stability).toBe(0.5);
      expect(neural.retrievability).toBe(1.0);
      expect(neural.access_count).toBe(0);
      expect(neural.last_accessed).toBeDefined();
    });

    it('should create valid ISO timestamp', () => {
      const neural = createDefaultNeuralProperties();
      const date = new Date(neural.last_accessed);

      expect(date.toISOString()).toBe(neural.last_accessed);
    });
  });

  describe('createInitialVersion', () => {
    it('should create version 1', () => {
      const version = createInitialVersion();

      expect(version.version).toBe(1);
    });

    it('should default to system modifier', () => {
      const version = createInitialVersion();

      expect(version.lastModifier).toBe('system');
    });

    it('should accept custom modifier', () => {
      const version = createInitialVersion('user');

      expect(version.lastModifier).toBe('user');
    });

    it('should have valid timestamp', () => {
      const version = createInitialVersion();
      const date = new Date(version.lastModified);

      expect(date.toISOString()).toBe(version.lastModified);
    });
  });

  describe('createNode', () => {
    it('should create a node with required fields', () => {
      const content: NodeContent = { title: 'Test Node' };
      const node = createNode('note', content);

      expect(node.id).toMatch(/^n_/);
      expect(node.type).toBe('note');
      expect(node.content.title).toBe('Test Node');
      expect(node.temporal).toBeDefined();
      expect(node.neural).toBeDefined();
      expect(node.provenance).toBeDefined();
      expect(node.state).toBeDefined();
      expect(node.versioning).toBeDefined();
    });

    it('should set default values correctly', () => {
      const content: NodeContent = { title: 'Test' };
      const node = createNode('note', content);

      expect(node.provenance.source).toBe('manual');
      expect(node.provenance.confidence).toBe(1.0);
      expect(node.state.extraction_depth).toBe('full');
      expect(node.state.lifecycle).toBe('working');
      expect(node.versioning.lastModifier).toBe('user');
    });

    it('should accept options', () => {
      const content: NodeContent = { title: 'Test' };
      const node = createNode('concept', content, {
        subtype: 'fact',
        source: 'extraction',
        confidence: 0.8,
        parent_id: 'n_parent123456',
        modifier: 'ai',
      });

      expect(node.subtype).toBe('fact');
      expect(node.provenance.source).toBe('extraction');
      expect(node.provenance.confidence).toBe(0.8);
      expect(node.provenance.parent_id).toBe('n_parent123456');
      expect(node.versioning.lastModifier).toBe('ai');
    });
  });

  describe('createConceptNode', () => {
    it('should create a concept node', () => {
      const node = createConceptNode('Photosynthesis', 'The process by which plants convert light to energy', 'fact');

      expect(node.type).toBe('concept');
      expect(node.subtype).toBe('fact');
      expect(node.content.title).toBe('Photosynthesis');
      expect(node.content.body).toBe('The process by which plants convert light to energy');
    });

    it('should accept custom subtypes', () => {
      const node = createConceptNode('Test', 'Body', 'custom:my-type' as any);

      expect(node.subtype).toBe('custom:my-type');
    });
  });

  describe('createNoteNode', () => {
    it('should create a note node', () => {
      const node = createNoteNode('Meeting Notes', 'Discussed project timeline');

      expect(node.type).toBe('note');
      expect(node.content.title).toBe('Meeting Notes');
      expect(node.content.body).toBe('Discussed project timeline');
    });
  });

  describe('recordAccess', () => {
    it('should increment access count', () => {
      const content: NodeContent = { title: 'Test' };
      let node = createNode('note', content);

      expect(node.neural.access_count).toBe(0);

      node = recordAccess(node);
      expect(node.neural.access_count).toBe(1);

      node = recordAccess(node);
      expect(node.neural.access_count).toBe(2);
    });

    it('should update last_accessed timestamp', async () => {
      const content: NodeContent = { title: 'Test' };
      const node = createNode('note', content);
      const originalTimestamp = node.neural.last_accessed;

      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = recordAccess(node);

      expect(new Date(updated.neural.last_accessed).getTime()).toBeGreaterThan(
        new Date(originalTimestamp).getTime()
      );
    });

    it('should not mutate original node', () => {
      const content: NodeContent = { title: 'Test' };
      const node = createNode('note', content);
      const originalCount = node.neural.access_count;

      recordAccess(node);

      expect(node.neural.access_count).toBe(originalCount);
    });
  });

  describe('updateLifecycle', () => {
    it('should update lifecycle state', () => {
      const content: NodeContent = { title: 'Test' };
      const node = createNode('note', content);

      expect(node.state.lifecycle).toBe('working');

      const updated = updateLifecycle(node, 'active');
      expect(updated.state.lifecycle).toBe('active');

      const archived = updateLifecycle(updated, 'archived');
      expect(archived.state.lifecycle).toBe('archived');
    });

    it('should not mutate original node', () => {
      const content: NodeContent = { title: 'Test' };
      const node = createNode('note', content);

      updateLifecycle(node, 'active');

      expect(node.state.lifecycle).toBe('working');
    });
  });

  describe('Schema Validation', () => {
    describe('NousNodeSchema', () => {
      it('should validate a valid node', () => {
        const node = createNode('note', { title: 'Test' });

        const result = NousNodeSchema.safeParse(node);
        expect(result.success).toBe(true);
      });

      it('should reject invalid node ID', () => {
        const node = createNode('note', { title: 'Test' });
        const invalid = { ...node, id: 'invalid_id' };

        const result = NousNodeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject invalid node type', () => {
        const node = createNode('note', { title: 'Test' });
        const invalid = { ...node, type: 'invalid_type' };

        const result = NousNodeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });
    });

    describe('ConceptNodeSchema', () => {
      it('should validate a valid concept node', () => {
        const node = createConceptNode('Test', 'Body', 'fact');

        const result = ConceptNodeSchema.safeParse(node);
        expect(result.success).toBe(true);
      });

      it('should accept custom subtypes', () => {
        const node = createConceptNode('Test', 'Body', 'custom:special' as any);

        const result = ConceptNodeSchema.safeParse(node);
        expect(result.success).toBe(true);
      });

      it('should reject non-concept type', () => {
        const node = createNoteNode('Test', 'Body');

        const result = ConceptNodeSchema.safeParse(node);
        expect(result.success).toBe(false);
      });
    });

    describe('NoteNodeSchema', () => {
      it('should validate a valid note node', () => {
        const node = createNoteNode('Test', 'Body');

        const result = NoteNodeSchema.safeParse(node);
        expect(result.success).toBe(true);
      });

      it('should reject non-note type', () => {
        const node = createConceptNode('Test', 'Body', 'fact');

        const result = NoteNodeSchema.safeParse(node);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Node Content', () => {
    it('should allow body and summary', () => {
      const content: NodeContent = {
        title: 'Test',
        body: 'Full body content',
        summary: 'Brief summary',
      };
      const node = createNode('note', content);

      expect(node.content.body).toBe('Full body content');
      expect(node.content.summary).toBe('Brief summary');
    });

    it('should allow blocks', () => {
      const content: NodeContent = {
        title: 'Test',
        blocks: [
          {
            id: 'b_testblock1234',
            type: 'paragraph',
            content: 'Block content',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
          },
        ],
      };
      const node = createNode('note', content);

      expect(node.content.blocks).toHaveLength(1);
    });
  });

  describe('Neural Properties Range', () => {
    it('should have stability in valid range', () => {
      const neural = createDefaultNeuralProperties();

      expect(neural.stability).toBeGreaterThanOrEqual(0);
      expect(neural.stability).toBeLessThanOrEqual(1);
    });

    it('should have retrievability in valid range', () => {
      const neural = createDefaultNeuralProperties();

      expect(neural.retrievability).toBeGreaterThanOrEqual(0);
      expect(neural.retrievability).toBeLessThanOrEqual(1);
    });
  });

  describe('Provenance', () => {
    it('should track source correctly', () => {
      const node1 = createNode('note', { title: 'Manual' }, { source: 'manual' });
      const node2 = createNode('note', { title: 'Extracted' }, { source: 'extraction' });
      const node3 = createNode('note', { title: 'Inferred' }, { source: 'inference' });

      expect(node1.provenance.source).toBe('manual');
      expect(node2.provenance.source).toBe('extraction');
      expect(node3.provenance.source).toBe('inference');
    });

    it('should track parent relationship', () => {
      const parentId = 'n_parent123456';
      const node = createNode('concept', { title: 'Child' }, { parent_id: parentId });

      expect(node.provenance.parent_id).toBe(parentId);
    });
  });
});
