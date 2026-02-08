/**
 * @module @nous/core/editing
 * @description Tests for editing module - Semantic anchor editing system
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateEditId,
  validateTarget,
  applyEdit,
  computeChecksum,
  computeChanges,
  computeReverseOperation,
  safeEdit,
  canAutoMerge,
  getAffectedBlocks,
  canUndo,
  createUndoRequest,
  pruneEditHistory,
  addToHistory,
  getEditById,
  addDependent,
  createDefaultRetentionPolicy,
  createEditHistoryCollection,
  validateEditOperation,
  validateEditRequest,
  EditTargetSchema,
  EditOperationSchema,
  EditRequestSchema,
  type EditTarget,
  type EditOperation,
  type EditRequest,
  type EditRecord,
  type EditHistoryCollection,
} from './index';
import { createNode, type NousNode, type NodeContent } from '../nodes';
import { createBlock, type Block } from '../blocks';

describe('Editing Module', () => {
  describe('generateEditId', () => {
    it('should generate edit ID with correct prefix', () => {
      const id = generateEditId();

      expect(id).toMatch(/^edit_[a-zA-Z0-9_-]{12}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateEditId());
      }

      expect(ids.size).toBe(100);
    });
  });

  describe('validateTarget', () => {
    let content: NodeContent;

    beforeEach(() => {
      content = {
        title: 'Test Node',
        body: 'Some body content to search',
        blocks: [
          createBlock('heading', 'Introduction', { level: 1 }),
          createBlock('paragraph', 'First paragraph'),
          createBlock('heading', 'Details', { level: 2 }),
        ],
      };
    });

    it('should validate full target', () => {
      const target: EditTarget = { method: 'full' };

      const result = validateTarget(content, target);

      expect(result.valid).toBe(true);
    });

    it('should validate block_id target when block exists', () => {
      const blockId = content.blocks![0]!.id;
      const target: EditTarget = { method: 'block_id', blockId };

      const result = validateTarget(content, target);

      expect(result.valid).toBe(true);
      expect(result.targetBlock).toBeDefined();
    });

    it('should reject block_id target when block not found', () => {
      const target: EditTarget = { method: 'block_id', blockId: 'b_nonexistent1' };

      const result = validateTarget(content, target);

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe('BLOCK_NOT_FOUND');
    });

    it('should validate heading target when heading exists', () => {
      const target: EditTarget = { method: 'heading', heading: 'Introduction' };

      const result = validateTarget(content, target);

      expect(result.valid).toBe(true);
      expect(result.targetBlock?.content).toBe('Introduction');
    });

    it('should validate heading target with level', () => {
      const target: EditTarget = { method: 'heading', heading: 'Details', headingLevel: 2 };

      const result = validateTarget(content, target);

      expect(result.valid).toBe(true);
    });

    it('should reject heading when not found', () => {
      const target: EditTarget = { method: 'heading', heading: 'Missing' };

      const result = validateTarget(content, target);

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe('HEADING_NOT_FOUND');
    });

    it('should validate position target', () => {
      const target: EditTarget = { method: 'position', position: 'end' };

      const result = validateTarget(content, target);

      expect(result.valid).toBe(true);
    });

    it('should validate search target when pattern found', () => {
      const target: EditTarget = { method: 'search', searchPattern: 'body content' };

      const result = validateTarget(content, target);

      expect(result.valid).toBe(true);
    });

    it('should reject search target when pattern not found', () => {
      const target: EditTarget = { method: 'search', searchPattern: 'not found xyz' };

      const result = validateTarget(content, target);

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe('SEARCH_NOT_FOUND');
    });
  });

  describe('applyEdit', () => {
    let content: NodeContent;

    beforeEach(() => {
      content = {
        title: 'Test Node',
        body: 'Original body content',
        blocks: [
          createBlock('heading', 'Title', { level: 1 }),
          createBlock('paragraph', 'Original paragraph'),
        ],
      };
    });

    it('should apply full replace', () => {
      const operation: EditOperation = {
        target: { method: 'full' },
        action: 'replace',
        content: 'New body content',
      };

      const updated = applyEdit(content, operation);

      expect(updated.body).toBe('New body content');
    });

    it('should apply full append', () => {
      const operation: EditOperation = {
        target: { method: 'full' },
        action: 'append',
        content: 'Appended text',
      };

      const updated = applyEdit(content, operation);

      expect(updated.body).toContain('Original body content');
      expect(updated.body).toContain('Appended text');
    });

    it('should apply block_id replace', () => {
      const blockId = content.blocks![1]!.id;
      const operation: EditOperation = {
        target: { method: 'block_id', blockId },
        action: 'replace',
        content: 'Updated paragraph',
      };

      const updated = applyEdit(content, operation);

      expect(updated.blocks![1]!.content).toBe('Updated paragraph');
    });

    it('should apply block_id append', () => {
      const blockId = content.blocks![1]!.id;
      const operation: EditOperation = {
        target: { method: 'block_id', blockId },
        action: 'append',
        content: ' with more text',
      };

      const updated = applyEdit(content, operation);

      expect(updated.blocks![1]!.content).toContain('Original paragraph');
      expect(updated.blocks![1]!.content).toContain('with more text');
    });

    it('should apply block_id delete', () => {
      const blockId = content.blocks![1]!.id;
      const operation: EditOperation = {
        target: { method: 'block_id', blockId },
        action: 'delete',
      };

      const updated = applyEdit(content, operation);

      expect(updated.blocks).toHaveLength(1);
    });

    it('should apply position start', () => {
      const operation: EditOperation = {
        target: { method: 'position', position: 'start' },
        action: 'insert',
        content: 'Prefix: ',
      };

      const updated = applyEdit(content, operation);

      expect(updated.body?.startsWith('Prefix:')).toBe(true);
    });

    it('should apply position end', () => {
      const operation: EditOperation = {
        target: { method: 'position', position: 'end' },
        action: 'append',
        content: ' Suffix',
      };

      const updated = applyEdit(content, operation);

      expect(updated.body?.endsWith('Suffix')).toBe(true);
    });

    it('should apply search replace', () => {
      const operation: EditOperation = {
        target: { method: 'search', searchPattern: 'body' },
        action: 'replace',
        content: 'BODY',
      };

      const updated = applyEdit(content, operation);

      expect(updated.body).toContain('BODY');
      expect(updated.body).not.toContain('body');
    });

    it('should not mutate original content', () => {
      const originalBody = content.body;
      const operation: EditOperation = {
        target: { method: 'full' },
        action: 'replace',
        content: 'New content',
      };

      applyEdit(content, operation);

      expect(content.body).toBe(originalBody);
    });
  });

  describe('computeChecksum', () => {
    it('should generate consistent checksums', () => {
      const content: NodeContent = { title: 'Test', body: 'Content' };

      const checksum1 = computeChecksum(content);
      const checksum2 = computeChecksum(content);

      expect(checksum1).toBe(checksum2);
    });

    it('should generate different checksums for different content', () => {
      const content1: NodeContent = { title: 'Test', body: 'Content 1' };
      const content2: NodeContent = { title: 'Test', body: 'Content 2' };

      expect(computeChecksum(content1)).not.toBe(computeChecksum(content2));
    });
  });

  describe('computeChanges', () => {
    it('should detect title change', () => {
      const before: NodeContent = { title: 'Old Title' };
      const after: NodeContent = { title: 'New Title' };

      const changes = computeChanges(before, after);

      expect(changes.some((c) => c.path === 'content.title')).toBe(true);
    });

    it('should detect body change', () => {
      const before: NodeContent = { title: 'Test', body: 'Old body' };
      const after: NodeContent = { title: 'Test', body: 'New body' };

      const changes = computeChanges(before, after);

      expect(changes.some((c) => c.path === 'content.body')).toBe(true);
      expect(changes.find((c) => c.path === 'content.body')?.before).toBe('Old body');
      expect(changes.find((c) => c.path === 'content.body')?.after).toBe('New body');
    });

    it('should return empty for no changes', () => {
      const content: NodeContent = { title: 'Test', body: 'Body' };

      const changes = computeChanges(content, content);

      expect(changes).toHaveLength(0);
    });
  });

  describe('computeReverseOperation', () => {
    it('should create reverse for replace', () => {
      const operation: EditOperation = {
        target: { method: 'full' },
        action: 'replace',
        content: 'New content',
      };
      const before: NodeContent = { title: 'Test', body: 'Original content' };

      const reverse = computeReverseOperation(operation, before);

      expect(reverse.action).toBe('replace');
      expect(reverse.content).toBe('Original content');
    });

    it('should create reverse for insert', () => {
      const operation: EditOperation = {
        target: { method: 'block_id', blockId: 'b_test123456ab' },
        action: 'insert',
        content: 'New block',
      };
      const before: NodeContent = { title: 'Test' };

      const reverse = computeReverseOperation(operation, before);

      expect(reverse.action).toBe('delete');
    });

    it('should create reverse for delete', () => {
      const operation: EditOperation = {
        target: { method: 'block_id', blockId: 'b_test123456ab' },
        action: 'delete',
      };
      const before: NodeContent = {
        title: 'Test',
        blocks: [
          {
            id: 'b_test123456ab',
            type: 'paragraph',
            content: 'Deleted content',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
          },
        ],
      };

      const reverse = computeReverseOperation(operation, before);

      expect(reverse.action).toBe('insert');
      expect(reverse.content).toBe('Deleted content');
    });
  });

  describe('safeEdit', () => {
    let node: NousNode;

    beforeEach(() => {
      node = createNode('note', {
        title: 'Test Note',
        body: 'Original content',
      });
    });

    it('should succeed with matching version', () => {
      const request: EditRequest = {
        nodeId: node.id,
        expectedVersion: 1,
        operation: {
          target: { method: 'full' },
          action: 'replace',
          content: 'Updated content',
        },
      };

      const { result, updatedNode } = safeEdit(node, request);

      expect(result.success).toBe(true);
      expect(result.newVersion).toBe(2);
      expect(updatedNode?.content.body).toBe('Updated content');
    });

    it('should fail with version mismatch', () => {
      const request: EditRequest = {
        nodeId: node.id,
        expectedVersion: 2, // Wrong version
        operation: {
          target: { method: 'full' },
          action: 'replace',
          content: 'Updated content',
        },
      };

      const { result, updatedNode } = safeEdit(node, request);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('VERSION_MISMATCH');
      expect(updatedNode).toBeUndefined();
    });

    it('should fail with invalid target', () => {
      const request: EditRequest = {
        nodeId: node.id,
        expectedVersion: 1,
        operation: {
          target: { method: 'block_id', blockId: 'b_nonexistent1' },
          action: 'replace',
          content: 'Updated',
        },
      };

      const { result } = safeEdit(node, request);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('BLOCK_NOT_FOUND');
    });

    it('should create edit record', () => {
      const request: EditRequest = {
        nodeId: node.id,
        expectedVersion: 1,
        operation: {
          target: { method: 'full' },
          action: 'replace',
          content: 'Updated',
        },
      };

      const { editRecord } = safeEdit(node, request);

      expect(editRecord).toBeDefined();
      expect(editRecord?.fromVersion).toBe(1);
      expect(editRecord?.toVersion).toBe(2);
      expect(editRecord?.undoable).toBe(true);
    });

    it('should set actor from options', () => {
      const request: EditRequest = {
        nodeId: node.id,
        expectedVersion: 1,
        operation: {
          target: { method: 'full' },
          action: 'replace',
          content: 'Updated',
        },
      };

      const { editRecord, updatedNode } = safeEdit(node, request, { actor: 'ai' });

      expect(editRecord?.actor).toBe('ai');
      expect(updatedNode?.versioning.lastModifier).toBe('ai');
    });
  });

  describe('canAutoMerge', () => {
    it('should allow merge when blocks do not overlap', () => {
      const content: NodeContent = { title: 'Test' };
      const theirChanges: EditOperation[] = [
        { target: { method: 'block_id', blockId: 'b_block1234567' }, action: 'replace', content: 'X' },
      ];
      const ourChange: EditOperation = {
        target: { method: 'block_id', blockId: 'b_block7654321' },
        action: 'replace',
        content: 'Y',
      };

      expect(canAutoMerge(content, theirChanges, ourChange)).toBe(true);
    });

    it('should reject merge when blocks overlap', () => {
      const content: NodeContent = { title: 'Test' };
      const theirChanges: EditOperation[] = [
        { target: { method: 'block_id', blockId: 'b_same12345678' }, action: 'replace', content: 'X' },
      ];
      const ourChange: EditOperation = {
        target: { method: 'block_id', blockId: 'b_same12345678' },
        action: 'append',
        content: 'Y',
      };

      expect(canAutoMerge(content, theirChanges, ourChange)).toBe(false);
    });

    it('should reject merge when either is full', () => {
      const content: NodeContent = { title: 'Test' };
      const theirChanges: EditOperation[] = [
        { target: { method: 'full' }, action: 'replace', content: 'X' },
      ];
      const ourChange: EditOperation = {
        target: { method: 'block_id', blockId: 'b_block1234567' },
        action: 'replace',
        content: 'Y',
      };

      expect(canAutoMerge(content, theirChanges, ourChange)).toBe(false);
    });
  });

  describe('getAffectedBlocks', () => {
    it('should return block ID for block_id target', () => {
      const operation: EditOperation = {
        target: { method: 'block_id', blockId: 'b_test12345678' },
        action: 'replace',
        content: 'X',
      };

      expect(getAffectedBlocks(operation)).toEqual(['b_test12345678']);
    });

    it('should return __full__ for full target', () => {
      const operation: EditOperation = {
        target: { method: 'full' },
        action: 'replace',
        content: 'X',
      };

      expect(getAffectedBlocks(operation)).toEqual(['__full__']);
    });

    it('should return empty for other targets', () => {
      const operation: EditOperation = {
        target: { method: 'position', position: 'end' },
        action: 'append',
        content: 'X',
      };

      expect(getAffectedBlocks(operation)).toEqual([]);
    });
  });

  describe('canUndo', () => {
    it('should allow undo for undoable edit within window', () => {
      const record: EditRecord = {
        id: 'edit_test1234567',
        nodeId: 'n_node12345678',
        timestamp: new Date().toISOString(),
        actor: 'user',
        fromVersion: 1,
        toVersion: 2,
        operation: { target: { method: 'full' }, action: 'replace', content: 'X' },
        changes: [],
        undoable: true,
        undoExpires: new Date(Date.now() + 86400000).toISOString(), // +24h
        reverseOperation: { target: { method: 'full' }, action: 'replace', content: 'Y' },
        dependsOn: [],
        dependents: [],
      };

      expect(canUndo(record).canUndo).toBe(true);
    });

    it('should reject non-undoable edit', () => {
      const record: EditRecord = {
        id: 'edit_test1234567',
        nodeId: 'n_node12345678',
        timestamp: new Date().toISOString(),
        actor: 'user',
        fromVersion: 1,
        toVersion: 2,
        operation: { target: { method: 'full' }, action: 'replace', content: 'X' },
        changes: [],
        undoable: false,
        undoExpires: new Date(Date.now() + 86400000).toISOString(),
        reverseOperation: { target: { method: 'full' }, action: 'replace', content: 'Y' },
        dependsOn: [],
        dependents: [],
      };

      const result = canUndo(record);
      expect(result.canUndo).toBe(false);
      expect(result.reason).toBe('Edit not undoable');
    });

    it('should reject expired undo window', () => {
      const record: EditRecord = {
        id: 'edit_test1234567',
        nodeId: 'n_node12345678',
        timestamp: new Date().toISOString(),
        actor: 'user',
        fromVersion: 1,
        toVersion: 2,
        operation: { target: { method: 'full' }, action: 'replace', content: 'X' },
        changes: [],
        undoable: true,
        undoExpires: new Date(Date.now() - 1000).toISOString(), // Expired
        reverseOperation: { target: { method: 'full' }, action: 'replace', content: 'Y' },
        dependsOn: [],
        dependents: [],
      };

      const result = canUndo(record);
      expect(result.canUndo).toBe(false);
      expect(result.reason).toBe('Undo window expired');
    });

    it('should reject edit with dependents', () => {
      const record: EditRecord = {
        id: 'edit_test1234567',
        nodeId: 'n_node12345678',
        timestamp: new Date().toISOString(),
        actor: 'user',
        fromVersion: 1,
        toVersion: 2,
        operation: { target: { method: 'full' }, action: 'replace', content: 'X' },
        changes: [],
        undoable: true,
        undoExpires: new Date(Date.now() + 86400000).toISOString(),
        reverseOperation: { target: { method: 'full' }, action: 'replace', content: 'Y' },
        dependsOn: [],
        dependents: ['edit_dependent12'],
      };

      const result = canUndo(record);
      expect(result.canUndo).toBe(false);
      expect(result.reason).toBe('Has dependent edits');
    });
  });

  describe('Edit History Management', () => {
    describe('createEditHistoryCollection', () => {
      it('should create empty collection', () => {
        const collection = createEditHistoryCollection('n_node12345678');

        expect(collection.nodeId).toBe('n_node12345678');
        expect(collection.edits).toHaveLength(0);
        expect(collection.retention).toBeDefined();
      });
    });

    describe('createDefaultRetentionPolicy', () => {
      it('should create policy with defaults', () => {
        const policy = createDefaultRetentionPolicy();

        expect(policy.maxEdits).toBe(100);
        expect(policy.maxAgeDays).toBe(30);
        expect(policy.undoWindowHours).toBe(24);
      });
    });

    describe('addToHistory', () => {
      it('should add record to beginning', () => {
        const collection = createEditHistoryCollection('n_node12345678');
        const record: EditRecord = {
          id: 'edit_record12345',
          nodeId: 'n_node12345678',
          timestamp: new Date().toISOString(),
          actor: 'user',
          fromVersion: 1,
          toVersion: 2,
          operation: { target: { method: 'full' }, action: 'replace', content: 'X' },
          changes: [],
          undoable: true,
          undoExpires: new Date(Date.now() + 86400000).toISOString(),
          reverseOperation: { target: { method: 'full' }, action: 'replace', content: 'Y' },
          dependsOn: [],
          dependents: [],
        };

        const updated = addToHistory(collection, record);

        expect(updated.edits).toHaveLength(1);
        expect(updated.edits[0]).toBe(record);
      });
    });

    describe('getEditById', () => {
      it('should find edit by ID', () => {
        let collection = createEditHistoryCollection('n_node12345678');
        const record: EditRecord = {
          id: 'edit_find1234567',
          nodeId: 'n_node12345678',
          timestamp: new Date().toISOString(),
          actor: 'user',
          fromVersion: 1,
          toVersion: 2,
          operation: { target: { method: 'full' }, action: 'replace', content: 'X' },
          changes: [],
          undoable: true,
          undoExpires: new Date(Date.now() + 86400000).toISOString(),
          reverseOperation: { target: { method: 'full' }, action: 'replace', content: 'Y' },
          dependsOn: [],
          dependents: [],
        };
        collection = addToHistory(collection, record);

        const found = getEditById(collection, 'edit_find1234567');

        expect(found).toBe(record);
      });

      it('should return undefined for not found', () => {
        const collection = createEditHistoryCollection('n_node12345678');

        expect(getEditById(collection, 'edit_nonexistent')).toBeUndefined();
      });
    });

    describe('addDependent', () => {
      it('should add dependent to specific edit', () => {
        let collection = createEditHistoryCollection('n_node12345678');
        const record: EditRecord = {
          id: 'edit_parent12345',
          nodeId: 'n_node12345678',
          timestamp: new Date().toISOString(),
          actor: 'user',
          fromVersion: 1,
          toVersion: 2,
          operation: { target: { method: 'full' }, action: 'replace', content: 'X' },
          changes: [],
          undoable: true,
          undoExpires: new Date(Date.now() + 86400000).toISOString(),
          reverseOperation: { target: { method: 'full' }, action: 'replace', content: 'Y' },
          dependsOn: [],
          dependents: [],
        };
        collection = addToHistory(collection, record);

        collection = addDependent(collection, 'edit_parent12345', 'edit_child123456');

        const updated = getEditById(collection, 'edit_parent12345');
        expect(updated?.dependents).toContain('edit_child123456');
      });
    });
  });

  describe('Schema Validation', () => {
    describe('EditTargetSchema', () => {
      it('should validate full target', () => {
        const result = EditTargetSchema.safeParse({ method: 'full' });
        expect(result.success).toBe(true);
      });

      it('should validate block_id target', () => {
        const result = EditTargetSchema.safeParse({
          method: 'block_id',
          blockId: 'b_test12345678',
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid method', () => {
        const result = EditTargetSchema.safeParse({ method: 'invalid' });
        expect(result.success).toBe(false);
      });
    });

    describe('EditOperationSchema', () => {
      it('should validate valid operation', () => {
        const result = EditOperationSchema.safeParse({
          target: { method: 'full' },
          action: 'replace',
          content: 'New content',
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid action', () => {
        const result = EditOperationSchema.safeParse({
          target: { method: 'full' },
          action: 'invalid_action',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('EditRequestSchema', () => {
      it('should validate valid request', () => {
        const result = EditRequestSchema.safeParse({
          nodeId: 'n_node12345678',
          expectedVersion: 1,
          operation: {
            target: { method: 'full' },
            action: 'replace',
            content: 'X',
          },
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid version', () => {
        const result = EditRequestSchema.safeParse({
          nodeId: 'n_node12345678',
          expectedVersion: 0, // Must be >= 1
          operation: {
            target: { method: 'full' },
            action: 'replace',
          },
        });
        expect(result.success).toBe(false);
      });
    });
  });
});
