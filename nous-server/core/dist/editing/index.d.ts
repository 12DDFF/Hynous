import { z } from 'zod';
import { M as Modifier, E as EditTargetMethod, a as EditAction } from '../constants-Blu2FVkv.js';
import { Block } from '../blocks/index.js';
import { NousNode, NodeContent } from '../nodes/index.js';
import '../temporal/index.js';

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

/**
 * Generates a unique edit record ID.
 * Format: "edit_" + nanoid(12)
 */
declare function generateEditId(): string;
/**
 * Specifies WHERE in a node to apply an edit.
 * Supports multiple targeting methods for resilience.
 */
interface EditTarget {
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
declare const EditTargetSchema: z.ZodObject<{
    method: z.ZodEnum<["block_id", "heading", "position", "search", "full"]>;
    blockId: z.ZodOptional<z.ZodString>;
    heading: z.ZodOptional<z.ZodString>;
    headingLevel: z.ZodOptional<z.ZodNumber>;
    position: z.ZodOptional<z.ZodEnum<["start", "end", "before", "after"]>>;
    relativeTo: z.ZodOptional<z.ZodString>;
    searchPattern: z.ZodOptional<z.ZodString>;
    searchContext: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    method: "heading" | "block_id" | "position" | "search" | "full";
    heading?: string | undefined;
    position?: "start" | "end" | "before" | "after" | undefined;
    blockId?: string | undefined;
    headingLevel?: number | undefined;
    relativeTo?: string | undefined;
    searchPattern?: string | undefined;
    searchContext?: number | undefined;
}, {
    method: "heading" | "block_id" | "position" | "search" | "full";
    heading?: string | undefined;
    position?: "start" | "end" | "before" | "after" | undefined;
    blockId?: string | undefined;
    headingLevel?: number | undefined;
    relativeTo?: string | undefined;
    searchPattern?: string | undefined;
    searchContext?: number | undefined;
}>;
/**
 * A single edit operation.
 */
interface EditOperation {
    /** Where to apply the edit */
    target: EditTarget;
    /** What action to take */
    action: EditAction;
    /** New content (for replace/insert/append) */
    content?: string;
}
declare const EditOperationSchema: z.ZodObject<{
    target: z.ZodObject<{
        method: z.ZodEnum<["block_id", "heading", "position", "search", "full"]>;
        blockId: z.ZodOptional<z.ZodString>;
        heading: z.ZodOptional<z.ZodString>;
        headingLevel: z.ZodOptional<z.ZodNumber>;
        position: z.ZodOptional<z.ZodEnum<["start", "end", "before", "after"]>>;
        relativeTo: z.ZodOptional<z.ZodString>;
        searchPattern: z.ZodOptional<z.ZodString>;
        searchContext: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        method: "heading" | "block_id" | "position" | "search" | "full";
        heading?: string | undefined;
        position?: "start" | "end" | "before" | "after" | undefined;
        blockId?: string | undefined;
        headingLevel?: number | undefined;
        relativeTo?: string | undefined;
        searchPattern?: string | undefined;
        searchContext?: number | undefined;
    }, {
        method: "heading" | "block_id" | "position" | "search" | "full";
        heading?: string | undefined;
        position?: "start" | "end" | "before" | "after" | undefined;
        blockId?: string | undefined;
        headingLevel?: number | undefined;
        relativeTo?: string | undefined;
        searchPattern?: string | undefined;
        searchContext?: number | undefined;
    }>;
    action: z.ZodEnum<["replace", "insert", "append", "delete"]>;
    content: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    target: {
        method: "heading" | "block_id" | "position" | "search" | "full";
        heading?: string | undefined;
        position?: "start" | "end" | "before" | "after" | undefined;
        blockId?: string | undefined;
        headingLevel?: number | undefined;
        relativeTo?: string | undefined;
        searchPattern?: string | undefined;
        searchContext?: number | undefined;
    };
    action: "replace" | "insert" | "append" | "delete";
    content?: string | undefined;
}, {
    target: {
        method: "heading" | "block_id" | "position" | "search" | "full";
        heading?: string | undefined;
        position?: "start" | "end" | "before" | "after" | undefined;
        blockId?: string | undefined;
        headingLevel?: number | undefined;
        relativeTo?: string | undefined;
        searchPattern?: string | undefined;
        searchContext?: number | undefined;
    };
    action: "replace" | "insert" | "append" | "delete";
    content?: string | undefined;
}>;
/**
 * A request to edit a node, including version check.
 */
interface EditRequest {
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
declare const EditRequestSchema: z.ZodObject<{
    nodeId: z.ZodString;
    expectedVersion: z.ZodNumber;
    operation: z.ZodObject<{
        target: z.ZodObject<{
            method: z.ZodEnum<["block_id", "heading", "position", "search", "full"]>;
            blockId: z.ZodOptional<z.ZodString>;
            heading: z.ZodOptional<z.ZodString>;
            headingLevel: z.ZodOptional<z.ZodNumber>;
            position: z.ZodOptional<z.ZodEnum<["start", "end", "before", "after"]>>;
            relativeTo: z.ZodOptional<z.ZodString>;
            searchPattern: z.ZodOptional<z.ZodString>;
            searchContext: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        }, {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        }>;
        action: z.ZodEnum<["replace", "insert", "append", "delete"]>;
        content: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    }, {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    }>;
    conflictResolution: z.ZodOptional<z.ZodEnum<["abort", "retry", "merge", "force"]>>;
}, "strip", z.ZodTypeAny, {
    nodeId: string;
    expectedVersion: number;
    operation: {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    };
    conflictResolution?: "abort" | "retry" | "merge" | "force" | undefined;
}, {
    nodeId: string;
    expectedVersion: number;
    operation: {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    };
    conflictResolution?: "abort" | "retry" | "merge" | "force" | undefined;
}>;
/**
 * Result of an edit operation.
 */
interface EditResult {
    /** Whether edit succeeded */
    success: boolean;
    /** New version number (if success) */
    newVersion?: number;
    /** Edit record ID (for undo) */
    editId?: string;
    /** Error details (if failed) */
    error?: ConflictError;
}
declare const EditResultSchema: z.ZodObject<{
    success: z.ZodBoolean;
    newVersion: z.ZodOptional<z.ZodNumber>;
    editId: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodLazy<z.ZodObject<{
        type: z.ZodEnum<["VERSION_MISMATCH", "BLOCK_NOT_FOUND", "HEADING_NOT_FOUND", "SEARCH_NOT_FOUND"]>;
        expectedVersion: z.ZodNumber;
        actualVersion: z.ZodNumber;
        changedBy: z.ZodEnum<["user", "ai", "system", "sync"]>;
        changedAt: z.ZodString;
        diff: z.ZodOptional<z.ZodObject<{
            blocksAdded: z.ZodArray<z.ZodString, "many">;
            blocksModified: z.ZodArray<z.ZodString, "many">;
            blocksDeleted: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            blocksAdded: string[];
            blocksModified: string[];
            blocksDeleted: string[];
        }, {
            blocksAdded: string[];
            blocksModified: string[];
            blocksDeleted: string[];
        }>>;
    }, "strip", z.ZodTypeAny, {
        type: "VERSION_MISMATCH" | "BLOCK_NOT_FOUND" | "HEADING_NOT_FOUND" | "SEARCH_NOT_FOUND";
        expectedVersion: number;
        actualVersion: number;
        changedBy: "user" | "ai" | "system" | "sync";
        changedAt: string;
        diff?: {
            blocksAdded: string[];
            blocksModified: string[];
            blocksDeleted: string[];
        } | undefined;
    }, {
        type: "VERSION_MISMATCH" | "BLOCK_NOT_FOUND" | "HEADING_NOT_FOUND" | "SEARCH_NOT_FOUND";
        expectedVersion: number;
        actualVersion: number;
        changedBy: "user" | "ai" | "system" | "sync";
        changedAt: string;
        diff?: {
            blocksAdded: string[];
            blocksModified: string[];
            blocksDeleted: string[];
        } | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    success: boolean;
    newVersion?: number | undefined;
    editId?: string | undefined;
    error?: {
        type: "VERSION_MISMATCH" | "BLOCK_NOT_FOUND" | "HEADING_NOT_FOUND" | "SEARCH_NOT_FOUND";
        expectedVersion: number;
        actualVersion: number;
        changedBy: "user" | "ai" | "system" | "sync";
        changedAt: string;
        diff?: {
            blocksAdded: string[];
            blocksModified: string[];
            blocksDeleted: string[];
        } | undefined;
    } | undefined;
}, {
    success: boolean;
    newVersion?: number | undefined;
    editId?: string | undefined;
    error?: {
        type: "VERSION_MISMATCH" | "BLOCK_NOT_FOUND" | "HEADING_NOT_FOUND" | "SEARCH_NOT_FOUND";
        expectedVersion: number;
        actualVersion: number;
        changedBy: "user" | "ai" | "system" | "sync";
        changedAt: string;
        diff?: {
            blocksAdded: string[];
            blocksModified: string[];
            blocksDeleted: string[];
        } | undefined;
    } | undefined;
}>;
/**
 * Conflict error details.
 */
interface ConflictError {
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
declare const ConflictErrorSchema: z.ZodObject<{
    type: z.ZodEnum<["VERSION_MISMATCH", "BLOCK_NOT_FOUND", "HEADING_NOT_FOUND", "SEARCH_NOT_FOUND"]>;
    expectedVersion: z.ZodNumber;
    actualVersion: z.ZodNumber;
    changedBy: z.ZodEnum<["user", "ai", "system", "sync"]>;
    changedAt: z.ZodString;
    diff: z.ZodOptional<z.ZodObject<{
        blocksAdded: z.ZodArray<z.ZodString, "many">;
        blocksModified: z.ZodArray<z.ZodString, "many">;
        blocksDeleted: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        blocksAdded: string[];
        blocksModified: string[];
        blocksDeleted: string[];
    }, {
        blocksAdded: string[];
        blocksModified: string[];
        blocksDeleted: string[];
    }>>;
}, "strip", z.ZodTypeAny, {
    type: "VERSION_MISMATCH" | "BLOCK_NOT_FOUND" | "HEADING_NOT_FOUND" | "SEARCH_NOT_FOUND";
    expectedVersion: number;
    actualVersion: number;
    changedBy: "user" | "ai" | "system" | "sync";
    changedAt: string;
    diff?: {
        blocksAdded: string[];
        blocksModified: string[];
        blocksDeleted: string[];
    } | undefined;
}, {
    type: "VERSION_MISMATCH" | "BLOCK_NOT_FOUND" | "HEADING_NOT_FOUND" | "SEARCH_NOT_FOUND";
    expectedVersion: number;
    actualVersion: number;
    changedBy: "user" | "ai" | "system" | "sync";
    changedAt: string;
    diff?: {
        blocksAdded: string[];
        blocksModified: string[];
        blocksDeleted: string[];
    } | undefined;
}>;
/**
 * A single change within an edit.
 */
interface Change {
    /** JSON path to the change (e.g., 'content.blocks.b_003.content') */
    path: string;
    /** Value before change */
    before: unknown;
    /** Value after change */
    after: unknown;
}
declare const ChangeSchema: z.ZodObject<{
    path: z.ZodString;
    before: z.ZodUnknown;
    after: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    path: string;
    before?: unknown;
    after?: unknown;
}, {
    path: string;
    before?: unknown;
    after?: unknown;
}>;
/**
 * A recorded edit for history/undo.
 */
interface EditRecord {
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
declare const EditRecordSchema: z.ZodObject<{
    id: z.ZodString;
    nodeId: z.ZodString;
    timestamp: z.ZodString;
    actor: z.ZodEnum<["user", "ai", "system", "sync"]>;
    actorId: z.ZodOptional<z.ZodString>;
    fromVersion: z.ZodNumber;
    toVersion: z.ZodNumber;
    operation: z.ZodObject<{
        target: z.ZodObject<{
            method: z.ZodEnum<["block_id", "heading", "position", "search", "full"]>;
            blockId: z.ZodOptional<z.ZodString>;
            heading: z.ZodOptional<z.ZodString>;
            headingLevel: z.ZodOptional<z.ZodNumber>;
            position: z.ZodOptional<z.ZodEnum<["start", "end", "before", "after"]>>;
            relativeTo: z.ZodOptional<z.ZodString>;
            searchPattern: z.ZodOptional<z.ZodString>;
            searchContext: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        }, {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        }>;
        action: z.ZodEnum<["replace", "insert", "append", "delete"]>;
        content: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    }, {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    }>;
    changes: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        before: z.ZodUnknown;
        after: z.ZodUnknown;
    }, "strip", z.ZodTypeAny, {
        path: string;
        before?: unknown;
        after?: unknown;
    }, {
        path: string;
        before?: unknown;
        after?: unknown;
    }>, "many">;
    undoable: z.ZodBoolean;
    undoExpires: z.ZodString;
    reverseOperation: z.ZodObject<{
        target: z.ZodObject<{
            method: z.ZodEnum<["block_id", "heading", "position", "search", "full"]>;
            blockId: z.ZodOptional<z.ZodString>;
            heading: z.ZodOptional<z.ZodString>;
            headingLevel: z.ZodOptional<z.ZodNumber>;
            position: z.ZodOptional<z.ZodEnum<["start", "end", "before", "after"]>>;
            relativeTo: z.ZodOptional<z.ZodString>;
            searchPattern: z.ZodOptional<z.ZodString>;
            searchContext: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        }, {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        }>;
        action: z.ZodEnum<["replace", "insert", "append", "delete"]>;
        content: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    }, {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    }>;
    dependsOn: z.ZodArray<z.ZodString, "many">;
    dependents: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    id: string;
    timestamp: string;
    nodeId: string;
    operation: {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    };
    actor: "user" | "ai" | "system" | "sync";
    fromVersion: number;
    toVersion: number;
    changes: {
        path: string;
        before?: unknown;
        after?: unknown;
    }[];
    undoable: boolean;
    undoExpires: string;
    reverseOperation: {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    };
    dependsOn: string[];
    dependents: string[];
    actorId?: string | undefined;
}, {
    id: string;
    timestamp: string;
    nodeId: string;
    operation: {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    };
    actor: "user" | "ai" | "system" | "sync";
    fromVersion: number;
    toVersion: number;
    changes: {
        path: string;
        before?: unknown;
        after?: unknown;
    }[];
    undoable: boolean;
    undoExpires: string;
    reverseOperation: {
        target: {
            method: "heading" | "block_id" | "position" | "search" | "full";
            heading?: string | undefined;
            position?: "start" | "end" | "before" | "after" | undefined;
            blockId?: string | undefined;
            headingLevel?: number | undefined;
            relativeTo?: string | undefined;
            searchPattern?: string | undefined;
            searchContext?: number | undefined;
        };
        action: "replace" | "insert" | "append" | "delete";
        content?: string | undefined;
    };
    dependsOn: string[];
    dependents: string[];
    actorId?: string | undefined;
}>;
/**
 * Edit history collection for a node.
 * Stored SEPARATELY from the node (lazy loaded).
 */
interface EditHistoryCollection {
    /** Node ID this history belongs to */
    nodeId: string;
    /** Edit records, newest first */
    edits: EditRecord[];
    /** Retention policy */
    retention: RetentionPolicy;
}
interface RetentionPolicy {
    maxEdits: number;
    maxAgeDays: number;
    undoWindowHours: number;
}
declare const RetentionPolicySchema: z.ZodObject<{
    maxEdits: z.ZodNumber;
    maxAgeDays: z.ZodNumber;
    undoWindowHours: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    maxEdits: number;
    maxAgeDays: number;
    undoWindowHours: number;
}, {
    maxEdits: number;
    maxAgeDays: number;
    undoWindowHours: number;
}>;
declare const EditHistoryCollectionSchema: z.ZodObject<{
    nodeId: z.ZodString;
    edits: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        nodeId: z.ZodString;
        timestamp: z.ZodString;
        actor: z.ZodEnum<["user", "ai", "system", "sync"]>;
        actorId: z.ZodOptional<z.ZodString>;
        fromVersion: z.ZodNumber;
        toVersion: z.ZodNumber;
        operation: z.ZodObject<{
            target: z.ZodObject<{
                method: z.ZodEnum<["block_id", "heading", "position", "search", "full"]>;
                blockId: z.ZodOptional<z.ZodString>;
                heading: z.ZodOptional<z.ZodString>;
                headingLevel: z.ZodOptional<z.ZodNumber>;
                position: z.ZodOptional<z.ZodEnum<["start", "end", "before", "after"]>>;
                relativeTo: z.ZodOptional<z.ZodString>;
                searchPattern: z.ZodOptional<z.ZodString>;
                searchContext: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            }, {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            }>;
            action: z.ZodEnum<["replace", "insert", "append", "delete"]>;
            content: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        }, {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        }>;
        changes: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            before: z.ZodUnknown;
            after: z.ZodUnknown;
        }, "strip", z.ZodTypeAny, {
            path: string;
            before?: unknown;
            after?: unknown;
        }, {
            path: string;
            before?: unknown;
            after?: unknown;
        }>, "many">;
        undoable: z.ZodBoolean;
        undoExpires: z.ZodString;
        reverseOperation: z.ZodObject<{
            target: z.ZodObject<{
                method: z.ZodEnum<["block_id", "heading", "position", "search", "full"]>;
                blockId: z.ZodOptional<z.ZodString>;
                heading: z.ZodOptional<z.ZodString>;
                headingLevel: z.ZodOptional<z.ZodNumber>;
                position: z.ZodOptional<z.ZodEnum<["start", "end", "before", "after"]>>;
                relativeTo: z.ZodOptional<z.ZodString>;
                searchPattern: z.ZodOptional<z.ZodString>;
                searchContext: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            }, {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            }>;
            action: z.ZodEnum<["replace", "insert", "append", "delete"]>;
            content: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        }, {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        }>;
        dependsOn: z.ZodArray<z.ZodString, "many">;
        dependents: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        id: string;
        timestamp: string;
        nodeId: string;
        operation: {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        };
        actor: "user" | "ai" | "system" | "sync";
        fromVersion: number;
        toVersion: number;
        changes: {
            path: string;
            before?: unknown;
            after?: unknown;
        }[];
        undoable: boolean;
        undoExpires: string;
        reverseOperation: {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        };
        dependsOn: string[];
        dependents: string[];
        actorId?: string | undefined;
    }, {
        id: string;
        timestamp: string;
        nodeId: string;
        operation: {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        };
        actor: "user" | "ai" | "system" | "sync";
        fromVersion: number;
        toVersion: number;
        changes: {
            path: string;
            before?: unknown;
            after?: unknown;
        }[];
        undoable: boolean;
        undoExpires: string;
        reverseOperation: {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        };
        dependsOn: string[];
        dependents: string[];
        actorId?: string | undefined;
    }>, "many">;
    retention: z.ZodObject<{
        maxEdits: z.ZodNumber;
        maxAgeDays: z.ZodNumber;
        undoWindowHours: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        maxEdits: number;
        maxAgeDays: number;
        undoWindowHours: number;
    }, {
        maxEdits: number;
        maxAgeDays: number;
        undoWindowHours: number;
    }>;
}, "strip", z.ZodTypeAny, {
    nodeId: string;
    edits: {
        id: string;
        timestamp: string;
        nodeId: string;
        operation: {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        };
        actor: "user" | "ai" | "system" | "sync";
        fromVersion: number;
        toVersion: number;
        changes: {
            path: string;
            before?: unknown;
            after?: unknown;
        }[];
        undoable: boolean;
        undoExpires: string;
        reverseOperation: {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        };
        dependsOn: string[];
        dependents: string[];
        actorId?: string | undefined;
    }[];
    retention: {
        maxEdits: number;
        maxAgeDays: number;
        undoWindowHours: number;
    };
}, {
    nodeId: string;
    edits: {
        id: string;
        timestamp: string;
        nodeId: string;
        operation: {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        };
        actor: "user" | "ai" | "system" | "sync";
        fromVersion: number;
        toVersion: number;
        changes: {
            path: string;
            before?: unknown;
            after?: unknown;
        }[];
        undoable: boolean;
        undoExpires: string;
        reverseOperation: {
            target: {
                method: "heading" | "block_id" | "position" | "search" | "full";
                heading?: string | undefined;
                position?: "start" | "end" | "before" | "after" | undefined;
                blockId?: string | undefined;
                headingLevel?: number | undefined;
                relativeTo?: string | undefined;
                searchPattern?: string | undefined;
                searchContext?: number | undefined;
            };
            action: "replace" | "insert" | "append" | "delete";
            content?: string | undefined;
        };
        dependsOn: string[];
        dependents: string[];
        actorId?: string | undefined;
    }[];
    retention: {
        maxEdits: number;
        maxAgeDays: number;
        undoWindowHours: number;
    };
}>;
/**
 * Creates a default retention policy.
 */
declare function createDefaultRetentionPolicy(): RetentionPolicy;
/**
 * Creates a new edit history collection for a node.
 */
declare function createEditHistoryCollection(nodeId: string): EditHistoryCollection;
interface TargetValidationResult {
    valid: boolean;
    errorType?: ConflictError['type'];
    targetBlock?: Block;
}
/**
 * Validates that an edit target exists in the content.
 */
declare function validateTarget(content: NodeContent, target: EditTarget): TargetValidationResult;
/**
 * Applies an edit operation to content.
 * Returns new content (does not mutate).
 */
declare function applyEdit(content: NodeContent, operation: EditOperation): NodeContent;
/**
 * Computes a checksum for content.
 */
declare function computeChecksum(content: NodeContent): string;
/**
 * Computes detailed changes between before/after content.
 */
declare function computeChanges(before: NodeContent, after: NodeContent): Change[];
/**
 * Computes the reverse operation for undo.
 */
declare function computeReverseOperation(operation: EditOperation, beforeContent: NodeContent): EditOperation;
interface SafeEditOptions {
    actor?: Modifier;
    actorId?: string;
}
interface SafeEditResult {
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
declare function safeEdit(node: NousNode, request: EditRequest, options?: SafeEditOptions): SafeEditResult;
/**
 * Checks if conflicting edits can be auto-merged.
 * Safe when changes don't overlap.
 */
declare function canAutoMerge(_baseContent: NodeContent, theirChanges: EditOperation[], ourChange: EditOperation): boolean;
/**
 * Gets block IDs affected by an edit operation.
 */
declare function getAffectedBlocks(operation: EditOperation): string[];
/**
 * Result of an undo operation.
 */
interface UndoResult {
    success: boolean;
    reason?: string;
    dependents?: string[];
    options?: ('undo_all' | 'force_undo')[];
}
/**
 * Checks if an edit can be undone.
 */
declare function canUndo(record: EditRecord): {
    canUndo: boolean;
    reason?: string;
};
/**
 * Creates an edit request to undo a previous edit.
 */
declare function createUndoRequest(record: EditRecord, currentVersion: number): EditRequest;
/**
 * Prunes old edit history based on retention policy.
 */
declare function pruneEditHistory(history: EditHistoryCollection): EditHistoryCollection;
/**
 * Adds an edit record to history.
 */
declare function addToHistory(history: EditHistoryCollection, record: EditRecord): EditHistoryCollection;
/**
 * Gets an edit record by ID from history.
 */
declare function getEditById(history: EditHistoryCollection, editId: string): EditRecord | undefined;
/**
 * Marks an edit as having a dependent.
 */
declare function addDependent(history: EditHistoryCollection, editId: string, dependentId: string): EditHistoryCollection;
/**
 * Validates an edit operation.
 */
declare function validateEditOperation(operation: unknown): operation is EditOperation;
/**
 * Validates an edit request.
 */
declare function validateEditRequest(request: unknown): request is EditRequest;

export { type Change, ChangeSchema, type ConflictError, ConflictErrorSchema, EditAction, type EditHistoryCollection, EditHistoryCollectionSchema, type EditOperation, EditOperationSchema, type EditRecord, EditRecordSchema, type EditRequest, EditRequestSchema, type EditResult, EditResultSchema, type EditTarget, EditTargetMethod, EditTargetSchema, Modifier, type RetentionPolicy, RetentionPolicySchema, type SafeEditOptions, type SafeEditResult, type TargetValidationResult, type UndoResult, addDependent, addToHistory, applyEdit, canAutoMerge, canUndo, computeChanges, computeChecksum, computeReverseOperation, createDefaultRetentionPolicy, createEditHistoryCollection, createUndoRequest, generateEditId, getAffectedBlocks, getEditById, pruneEditHistory, safeEdit, validateEditOperation, validateEditRequest, validateTarget };
