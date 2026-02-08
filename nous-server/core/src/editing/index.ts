/**
 * @module @nous/core/editing
 * @description Semantic anchor editing, versioning, and history
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-011/spec/edit-system.ts
 *
 * This system enables:
 * - Targeted editing by heading, block ID, or position (not brittle string matching)
 * - Version tracking for conflict detection
 * - Edit history for undo support
 * - Auto-merge when changes don't overlap
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  NANOID_LENGTH,
  EDIT_ID_PREFIX,
  EDIT_TARGET_METHODS,
  EDIT_ACTIONS,
  MODIFIERS,
  EDIT_HISTORY_RETENTION,
  type EditTargetMethod,
  type EditAction,
  type Modifier,
} from '../constants';
import { type Block, findBlockById, findBlockByHeading } from '../blocks';
import { type NousNode, type NodeContent } from '../nodes';

// ============================================================
// ID GENERATION
// ============================================================

/**
 * Generates a unique edit record ID.
 * Format: "edit_" + nanoid(12)
 */
export function generateEditId(): string {
  return EDIT_ID_PREFIX + nanoid(NANOID_LENGTH);
}

// ============================================================
// EDIT TARGET
// ============================================================

/**
 * Specifies WHERE in a node to apply an edit.
 * Supports multiple targeting methods for resilience.
 */
export interface EditTarget {
  /**
   * Targeting method.
   * - block_id: Target specific block by stable ID
   * - heading: Target by heading text
   * - position: Target by position (start/end/before/after)
   * - search: Fuzzy search fallback
   * - full: Replace entire content
   */
  method: EditTargetMethod;
  /** For block_id method: the block ID to target */
  blockId?: string;
  /** For heading method: the heading text to match */
  heading?: string;
  /** For heading method: only match specific heading level */
  headingLevel?: number;
  /** For position method: where relative to target */
  position?: 'start' | 'end' | 'before' | 'after';
  /** For position method: block ID or heading to position relative to */
  relativeTo?: string;
  /** For search method: pattern to find (fuzzy) */
  searchPattern?: string;
  /** For search method: chars of context to include */
  searchContext?: number;
}

export const EditTargetSchema = z.object({
  method: z.enum(EDIT_TARGET_METHODS),
  blockId: z.string().optional(),
  heading: z.string().optional(),
  headingLevel: z.number().int().min(1).max(6).optional(),
  position: z.enum(['start', 'end', 'before', 'after']).optional(),
  relativeTo: z.string().optional(),
  searchPattern: z.string().optional(),
  searchContext: z.number().int().positive().optional(),
});

// ============================================================
// EDIT OPERATION
// ============================================================

/**
 * A single edit operation.
 */
export interface EditOperation {
  /** Where to apply the edit */
  target: EditTarget;
  /** What action to take */
  action: EditAction;
  /** New content (for replace/insert/append) */
  content?: string;
}

export const EditOperationSchema = z.object({
  target: EditTargetSchema,
  action: z.enum(EDIT_ACTIONS),
  content: z.string().optional(),
});

// ============================================================
// EDIT REQUEST
// ============================================================

/**
 * A request to edit a node, including version check.
 */
export interface EditRequest {
  /** Node to edit */
  nodeId: string;
  /**
   * Version when AI/user last viewed the node.
   * Edit fails if this doesn't match current version.
   */
  expectedVersion: number;
  /** The edit operation to apply */
  operation: EditOperation;
  /** How to handle version conflicts */
  conflictResolution?: 'abort' | 'retry' | 'merge' | 'force';
}

export const EditRequestSchema = z.object({
  nodeId: z.string(),
  expectedVersion: z.number().int().min(1),
  operation: EditOperationSchema,
  conflictResolution: z.enum(['abort', 'retry', 'merge', 'force']).optional(),
});

// ============================================================
// EDIT RESULT
// ============================================================

/**
 * Result of an edit operation.
 */
export interface EditResult {
  /** Whether edit succeeded */
  success: boolean;
  /** New version number (if success) */
  newVersion?: number;
  /** Edit record ID (for undo) */
  editId?: string;
  /** Error details (if failed) */
  error?: ConflictError;
}

export const EditResultSchema = z.object({
  success: z.boolean(),
  newVersion: z.number().int().min(1).optional(),
  editId: z.string().optional(),
  error: z.lazy(() => ConflictErrorSchema).optional(),
});

/**
 * Conflict error details.
 */
export interface ConflictError {
  type: 'VERSION_MISMATCH' | 'BLOCK_NOT_FOUND' | 'HEADING_NOT_FOUND' | 'SEARCH_NOT_FOUND';
  expectedVersion: number;
  actualVersion: number;
  changedBy: Modifier;
  changedAt: string;
  /** What changed (for smart merge) */
  diff?: {
    blocksAdded: string[];
    blocksModified: string[];
    blocksDeleted: string[];
  };
}

export const ConflictErrorSchema = z.object({
  type: z.enum(['VERSION_MISMATCH', 'BLOCK_NOT_FOUND', 'HEADING_NOT_FOUND', 'SEARCH_NOT_FOUND']),
  expectedVersion: z.number(),
  actualVersion: z.number(),
  changedBy: z.enum(MODIFIERS),
  changedAt: z.string().datetime(),
  diff: z
    .object({
      blocksAdded: z.array(z.string()),
      blocksModified: z.array(z.string()),
      blocksDeleted: z.array(z.string()),
    })
    .optional(),
});

// ============================================================
// EDIT HISTORY
// ============================================================

/**
 * A single change within an edit.
 */
export interface Change {
  /** JSON path to the change (e.g., 'content.blocks.b_003.content') */
  path: string;
  /** Value before change */
  before: unknown;
  /** Value after change */
  after: unknown;
}

export const ChangeSchema = z.object({
  path: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});

/**
 * A recorded edit for history/undo.
 */
export interface EditRecord {
  /** Unique edit ID */
  id: string;
  /** Node this edit applies to */
  nodeId: string;
  /** When edit occurred */
  timestamp: string;
  /** Who made the edit */
  actor: Modifier;
  /** For AI: which operation/request ID */
  actorId?: string;
  /** Version before edit */
  fromVersion: number;
  /** Version after edit */
  toVersion: number;
  /** The operation that was applied */
  operation: EditOperation;
  /** Detailed changes */
  changes: Change[];
  /** Whether this edit can be undone */
  undoable: boolean;
  /** When undo window expires */
  undoExpires: string;
  /** How to reverse this edit */
  reverseOperation: EditOperation;
  /** Edit IDs this depends on */
  dependsOn: string[];
  /** Edit IDs that depend on this */
  dependents: string[];
}

export const EditRecordSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  timestamp: z.string().datetime(),
  actor: z.enum(MODIFIERS),
  actorId: z.string().optional(),
  fromVersion: z.number().int(),
  toVersion: z.number().int(),
  operation: EditOperationSchema,
  changes: z.array(ChangeSchema),
  undoable: z.boolean(),
  undoExpires: z.string().datetime(),
  reverseOperation: EditOperationSchema,
  dependsOn: z.array(z.string()),
  dependents: z.array(z.string()),
});

/**
 * Edit history collection for a node.
 * Stored SEPARATELY from the node (lazy loaded).
 */
export interface EditHistoryCollection {
  /** Node ID this history belongs to */
  nodeId: string;
  /** Edit records, newest first */
  edits: EditRecord[];
  /** Retention policy */
  retention: RetentionPolicy;
}

export interface RetentionPolicy {
  maxEdits: number;
  maxAgeDays: number;
  undoWindowHours: number;
}

export const RetentionPolicySchema = z.object({
  maxEdits: z.number().int().positive(),
  maxAgeDays: z.number().int().positive(),
  undoWindowHours: z.number().int().positive(),
});

export const EditHistoryCollectionSchema = z.object({
  nodeId: z.string(),
  edits: z.array(EditRecordSchema),
  retention: RetentionPolicySchema,
});

// ============================================================
// DEFAULT RETENTION POLICY
// ============================================================

/**
 * Creates a default retention policy.
 */
export function createDefaultRetentionPolicy(): RetentionPolicy {
  return {
    maxEdits: EDIT_HISTORY_RETENTION.maxEdits,
    maxAgeDays: EDIT_HISTORY_RETENTION.maxAgeDays,
    undoWindowHours: EDIT_HISTORY_RETENTION.undoWindowHours,
  };
}

/**
 * Creates a new edit history collection for a node.
 */
export function createEditHistoryCollection(nodeId: string): EditHistoryCollection {
  return {
    nodeId,
    edits: [],
    retention: createDefaultRetentionPolicy(),
  };
}

// ============================================================
// TARGET VALIDATION
// ============================================================

export interface TargetValidationResult {
  valid: boolean;
  errorType?: ConflictError['type'];
  targetBlock?: Block;
}

/**
 * Validates that an edit target exists in the content.
 */
export function validateTarget(
  content: NodeContent,
  target: EditTarget
): TargetValidationResult {
  switch (target.method) {
    case 'full':
      return { valid: true };

    case 'block_id':
      if (!content.blocks || !target.blockId) {
        return { valid: false, errorType: 'BLOCK_NOT_FOUND' };
      }
      const blockById = findBlockById(content.blocks, target.blockId);
      return blockById
        ? { valid: true, targetBlock: blockById }
        : { valid: false, errorType: 'BLOCK_NOT_FOUND' };

    case 'heading':
      if (!content.blocks || !target.heading) {
        return { valid: false, errorType: 'HEADING_NOT_FOUND' };
      }
      const headingBlock = findBlockByHeading(
        content.blocks,
        target.heading,
        target.headingLevel
      );
      return headingBlock
        ? { valid: true, targetBlock: headingBlock }
        : { valid: false, errorType: 'HEADING_NOT_FOUND' };

    case 'position':
      return { valid: true }; // Position is always valid

    case 'search':
      if (!target.searchPattern) {
        return { valid: false, errorType: 'SEARCH_NOT_FOUND' };
      }
      const body = content.body ?? '';
      const found = body.toLowerCase().includes(target.searchPattern.toLowerCase());
      return found ? { valid: true } : { valid: false, errorType: 'SEARCH_NOT_FOUND' };

    default:
      return { valid: false, errorType: 'BLOCK_NOT_FOUND' };
  }
}

// ============================================================
// APPLY EDIT
// ============================================================

/**
 * Applies an edit operation to content.
 * Returns new content (does not mutate).
 */
export function applyEdit(content: NodeContent, operation: EditOperation): NodeContent {
  const newContent = JSON.parse(JSON.stringify(content)) as NodeContent;

  switch (operation.target.method) {
    case 'full':
      if (operation.action === 'replace') {
        newContent.body = operation.content;
      } else if (operation.action === 'append') {
        newContent.body = (newContent.body ?? '') + '\n' + (operation.content ?? '');
      }
      break;

    case 'block_id':
      if (newContent.blocks && operation.target.blockId) {
        applyBlockEdit(newContent.blocks, operation.target.blockId, operation);
      }
      break;

    case 'heading':
      if (newContent.blocks && operation.target.heading) {
        const block = findBlockByHeading(
          newContent.blocks,
          operation.target.heading,
          operation.target.headingLevel
        );
        if (block) {
          applyBlockEdit(newContent.blocks, block.id, operation);
        }
      }
      break;

    case 'position':
      applyPositionEdit(newContent, operation);
      break;

    case 'search':
      applySearchEdit(newContent, operation);
      break;
  }

  return newContent;
}

/**
 * Applies edit to a specific block.
 */
function applyBlockEdit(
  blocks: Block[],
  blockId: string,
  operation: EditOperation
): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;

    if (block.id === blockId) {
      const now = new Date().toISOString();
      switch (operation.action) {
        case 'replace':
          blocks[i] = {
            id: block.id,
            type: block.type,
            content: operation.content ?? '',
            level: block.level,
            children: block.children,
            created: block.created,
            modified: now,
          };
          return true;
        case 'append':
          blocks[i] = {
            id: block.id,
            type: block.type,
            content: block.content + '\n' + (operation.content ?? ''),
            level: block.level,
            children: block.children,
            created: block.created,
            modified: now,
          };
          return true;
        case 'insert':
          // Insert after this block
          if (operation.content) {
            const newBlock: Block = {
              id: 'b_' + nanoid(NANOID_LENGTH),
              type: 'paragraph',
              content: operation.content,
              created: now,
              modified: now,
            };
            blocks.splice(i + 1, 0, newBlock);
          }
          return true;
        case 'delete':
          blocks.splice(i, 1);
          return true;
      }
    }
    // Check children recursively
    if (block.children) {
      const found = applyBlockEdit(block.children, blockId, operation);
      if (found) return true;
    }
  }
  return false;
}

/**
 * Applies a position-based edit.
 */
function applyPositionEdit(content: NodeContent, operation: EditOperation): void {
  const { position } = operation.target;

  if (position === 'start') {
    content.body = (operation.content ?? '') + '\n' + (content.body ?? '');
  } else if (position === 'end') {
    content.body = (content.body ?? '') + '\n' + (operation.content ?? '');
  }
  // 'before' and 'after' would need relativeTo to be implemented
}

/**
 * Applies a search-based edit.
 */
function applySearchEdit(content: NodeContent, operation: EditOperation): void {
  if (!operation.target.searchPattern || !content.body) return;

  const pattern = operation.target.searchPattern;

  switch (operation.action) {
    case 'replace':
      content.body = content.body.replace(
        new RegExp(escapeRegex(pattern), 'gi'),
        operation.content ?? ''
      );
      break;
    case 'append':
      // Append after the found pattern
      content.body = content.body.replace(
        new RegExp(escapeRegex(pattern), 'gi'),
        (match) => match + (operation.content ?? '')
      );
      break;
    case 'delete':
      content.body = content.body.replace(new RegExp(escapeRegex(pattern), 'gi'), '');
      break;
  }
}

/**
 * Escapes special regex characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// CHECKSUM
// ============================================================

/**
 * Computes a checksum for content.
 */
export function computeChecksum(content: NodeContent): string {
  const str = JSON.stringify(content);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ============================================================
// CHANGE COMPUTATION
// ============================================================

/**
 * Computes detailed changes between before/after content.
 */
export function computeChanges(before: NodeContent, after: NodeContent): Change[] {
  const changes: Change[] = [];

  if (before.title !== after.title) {
    changes.push({ path: 'content.title', before: before.title, after: after.title });
  }
  if (before.body !== after.body) {
    changes.push({ path: 'content.body', before: before.body, after: after.body });
  }
  if (before.summary !== after.summary) {
    changes.push({ path: 'content.summary', before: before.summary, after: after.summary });
  }

  // Block changes - compare stringified for now
  const beforeBlocks = JSON.stringify(before.blocks ?? []);
  const afterBlocks = JSON.stringify(after.blocks ?? []);
  if (beforeBlocks !== afterBlocks) {
    changes.push({ path: 'content.blocks', before: before.blocks, after: after.blocks });
  }

  return changes;
}

/**
 * Computes the reverse operation for undo.
 */
export function computeReverseOperation(
  operation: EditOperation,
  beforeContent: NodeContent
): EditOperation {
  switch (operation.action) {
    case 'replace':
      return {
        target: operation.target,
        action: 'replace',
        content:
          operation.target.method === 'full'
            ? beforeContent.body
            : getTargetContent(beforeContent, operation.target),
      };
    case 'append':
      // Reverse of append is to remove what was appended
      return {
        target: operation.target,
        action: 'replace',
        content: getTargetContent(beforeContent, operation.target),
      };
    case 'insert':
      return {
        target: operation.target,
        action: 'delete',
      };
    case 'delete':
      return {
        target: operation.target,
        action: 'insert',
        content: getTargetContent(beforeContent, operation.target),
      };
    default:
      return {
        target: { method: 'full' },
        action: 'replace',
        content: beforeContent.body,
      };
  }
}

/**
 * Gets content at a specific target location.
 */
function getTargetContent(content: NodeContent, target: EditTarget): string | undefined {
  switch (target.method) {
    case 'full':
      return content.body;
    case 'block_id':
      if (content.blocks && target.blockId) {
        const block = findBlockById(content.blocks, target.blockId);
        return block?.content;
      }
      return undefined;
    case 'heading':
      if (content.blocks && target.heading) {
        const block = findBlockByHeading(content.blocks, target.heading, target.headingLevel);
        return block?.content;
      }
      return undefined;
    default:
      return content.body;
  }
}

// ============================================================
// SAFE EDIT FUNCTION
// ============================================================

export interface SafeEditOptions {
  actor?: Modifier;
  actorId?: string;
}

export interface SafeEditResult {
  result: EditResult;
  updatedNode?: NousNode;
  editRecord?: EditRecord;
}

/**
 * Applies an edit with version checking.
 *
 * Flow:
 * 1. Check version matches expected
 * 2. Validate target exists
 * 3. Apply edit
 * 4. Increment version
 * 5. Create edit record
 */
export function safeEdit(
  node: NousNode,
  request: EditRequest,
  options: SafeEditOptions = {}
): SafeEditResult {
  const actor = options.actor ?? 'user';
  const now = new Date().toISOString();

  // 1. Check version
  if (node.versioning.version !== request.expectedVersion) {
    return {
      result: {
        success: false,
        error: {
          type: 'VERSION_MISMATCH',
          expectedVersion: request.expectedVersion,
          actualVersion: node.versioning.version,
          changedBy: node.versioning.lastModifier,
          changedAt: node.versioning.lastModified,
        },
      },
    };
  }

  // 2. Validate target exists
  const targetValidation = validateTarget(node.content, request.operation.target);
  if (!targetValidation.valid) {
    return {
      result: {
        success: false,
        error: {
          type: targetValidation.errorType!,
          expectedVersion: request.expectedVersion,
          actualVersion: node.versioning.version,
          changedBy: node.versioning.lastModifier,
          changedAt: node.versioning.lastModified,
        },
      },
    };
  }

  // 3. Apply edit
  const beforeContent = JSON.parse(JSON.stringify(node.content)) as NodeContent;
  const updatedContent = applyEdit(node.content, request.operation);

  // 4. Update versioning
  const newVersion = node.versioning.version + 1;
  const updatedNode: NousNode = {
    ...node,
    content: updatedContent,
    versioning: {
      version: newVersion,
      lastModified: now,
      lastModifier: actor,
      checksum: computeChecksum(updatedContent),
    },
  };

  // 5. Create edit record
  const editId = generateEditId();
  const editRecord: EditRecord = {
    id: editId,
    nodeId: node.id,
    timestamp: now,
    actor,
    actorId: options.actorId,
    fromVersion: node.versioning.version,
    toVersion: newVersion,
    operation: request.operation,
    changes: computeChanges(beforeContent, updatedContent),
    undoable: true,
    undoExpires: new Date(
      Date.now() + EDIT_HISTORY_RETENTION.undoWindowHours * 60 * 60 * 1000
    ).toISOString(),
    reverseOperation: computeReverseOperation(request.operation, beforeContent),
    dependsOn: [],
    dependents: [],
  };

  return {
    result: {
      success: true,
      newVersion,
      editId,
    },
    updatedNode,
    editRecord,
  };
}

// ============================================================
// AUTO-MERGE
// ============================================================

/**
 * Checks if conflicting edits can be auto-merged.
 * Safe when changes don't overlap.
 */
export function canAutoMerge(
  _baseContent: NodeContent,
  theirChanges: EditOperation[],
  ourChange: EditOperation
): boolean {
  const theirBlocks = theirChanges.flatMap((c) => getAffectedBlocks(c));
  const ourBlocks = getAffectedBlocks(ourChange);

  // If either side edits the full content, cannot merge
  if (theirBlocks.includes('__full__') || ourBlocks.includes('__full__')) {
    return false;
  }

  // No overlap = safe to merge
  const overlap = theirBlocks.filter((b) => ourBlocks.includes(b));
  return overlap.length === 0;
}

/**
 * Gets block IDs affected by an edit operation.
 */
export function getAffectedBlocks(operation: EditOperation): string[] {
  if (operation.target.method === 'block_id' && operation.target.blockId) {
    return [operation.target.blockId];
  }
  if (operation.target.method === 'full') {
    return ['__full__'];
  }
  return [];
}

// ============================================================
// UNDO
// ============================================================

/**
 * Result of an undo operation.
 */
export interface UndoResult {
  success: boolean;
  reason?: string;
  dependents?: string[];
  options?: ('undo_all' | 'force_undo')[];
}

/**
 * Checks if an edit can be undone.
 */
export function canUndo(record: EditRecord): { canUndo: boolean; reason?: string } {
  if (!record.undoable) {
    return { canUndo: false, reason: 'Edit not undoable' };
  }

  if (new Date() > new Date(record.undoExpires)) {
    return { canUndo: false, reason: 'Undo window expired' };
  }

  if (record.dependents.length > 0) {
    return { canUndo: false, reason: 'Has dependent edits' };
  }

  return { canUndo: true };
}

/**
 * Creates an edit request to undo a previous edit.
 */
export function createUndoRequest(record: EditRecord, currentVersion: number): EditRequest {
  return {
    nodeId: record.nodeId,
    expectedVersion: currentVersion,
    operation: record.reverseOperation,
    conflictResolution: 'abort',
  };
}

// ============================================================
// PRUNING
// ============================================================

/**
 * Prunes old edit history based on retention policy.
 */
export function pruneEditHistory(history: EditHistoryCollection): EditHistoryCollection {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - history.retention.maxAgeDays);
  const cutoff = cutoffDate.toISOString();

  // Remove old edits
  let edits = history.edits.filter((edit) => {
    const tooOld = edit.timestamp < cutoff;
    const undoExpired = new Date() > new Date(edit.undoExpires);
    return !(tooOld && undoExpired);
  });

  // Trim to max edits (keep newest)
  if (edits.length > history.retention.maxEdits) {
    edits = edits.slice(0, history.retention.maxEdits);
  }

  return {
    ...history,
    edits,
  };
}

/**
 * Adds an edit record to history.
 */
export function addToHistory(
  history: EditHistoryCollection,
  record: EditRecord
): EditHistoryCollection {
  return {
    ...history,
    edits: [record, ...history.edits],
  };
}

/**
 * Gets an edit record by ID from history.
 */
export function getEditById(
  history: EditHistoryCollection,
  editId: string
): EditRecord | undefined {
  return history.edits.find((e) => e.id === editId);
}

/**
 * Marks an edit as having a dependent.
 */
export function addDependent(
  history: EditHistoryCollection,
  editId: string,
  dependentId: string
): EditHistoryCollection {
  return {
    ...history,
    edits: history.edits.map((e) =>
      e.id === editId ? { ...e, dependents: [...e.dependents, dependentId] } : e
    ),
  };
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validates an edit operation.
 */
export function validateEditOperation(operation: unknown): operation is EditOperation {
  return EditOperationSchema.safeParse(operation).success;
}

/**
 * Validates an edit request.
 */
export function validateEditRequest(request: unknown): request is EditRequest {
  return EditRequestSchema.safeParse(request).success;
}

// ============================================================
// RE-EXPORTS
// ============================================================

export type { EditTargetMethod, EditAction, Modifier };
