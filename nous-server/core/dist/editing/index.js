import { z } from 'zod';
import { nanoid } from 'nanoid';

// src/editing/index.ts

// src/constants.ts
var NANOID_LENGTH = 12;
var EDIT_ID_PREFIX = "edit_";
var BLOCK_TYPES = [
  "paragraph",
  "heading",
  "list",
  "list_item",
  "code",
  "quote",
  "callout",
  "divider",
  "table",
  "image"
];
var EDIT_TARGET_METHODS = [
  "block_id",
  "heading",
  "position",
  "search",
  "full"
];
var EDIT_ACTIONS = ["replace", "insert", "append", "delete"];
var MODIFIERS = ["user", "ai", "system", "sync"];
var EDIT_HISTORY_RETENTION = {
  maxEdits: 100,
  maxAgeDays: 30,
  undoWindowHours: 24};
var BlockSchema = z.lazy(
  () => z.object({
    id: z.string().regex(/^b_[a-zA-Z0-9_-]{12}$/),
    type: z.enum(BLOCK_TYPES),
    content: z.string(),
    level: z.number().int().min(1).max(6).optional(),
    children: z.array(BlockSchema).optional(),
    created: z.string().datetime(),
    modified: z.string().datetime()
  })
);
function findBlockById(blocks, blockId) {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block;
    }
    if (block.children) {
      const found = findBlockById(block.children, blockId);
      if (found) return found;
    }
  }
  return void 0;
}
function findBlockByHeading(blocks, heading, level) {
  for (const block of blocks) {
    if (block.type === "heading") {
      const matchesText = block.content.toLowerCase() === heading.toLowerCase();
      const matchesLevel = level === void 0 || block.level === level;
      if (matchesText && matchesLevel) {
        return block;
      }
    }
    if (block.children) {
      const found = findBlockByHeading(block.children, heading, level);
      if (found) return found;
    }
  }
  return void 0;
}

// src/editing/index.ts
function generateEditId() {
  return EDIT_ID_PREFIX + nanoid(NANOID_LENGTH);
}
var EditTargetSchema = z.object({
  method: z.enum(EDIT_TARGET_METHODS),
  blockId: z.string().optional(),
  heading: z.string().optional(),
  headingLevel: z.number().int().min(1).max(6).optional(),
  position: z.enum(["start", "end", "before", "after"]).optional(),
  relativeTo: z.string().optional(),
  searchPattern: z.string().optional(),
  searchContext: z.number().int().positive().optional()
});
var EditOperationSchema = z.object({
  target: EditTargetSchema,
  action: z.enum(EDIT_ACTIONS),
  content: z.string().optional()
});
var EditRequestSchema = z.object({
  nodeId: z.string(),
  expectedVersion: z.number().int().min(1),
  operation: EditOperationSchema,
  conflictResolution: z.enum(["abort", "retry", "merge", "force"]).optional()
});
var EditResultSchema = z.object({
  success: z.boolean(),
  newVersion: z.number().int().min(1).optional(),
  editId: z.string().optional(),
  error: z.lazy(() => ConflictErrorSchema).optional()
});
var ConflictErrorSchema = z.object({
  type: z.enum(["VERSION_MISMATCH", "BLOCK_NOT_FOUND", "HEADING_NOT_FOUND", "SEARCH_NOT_FOUND"]),
  expectedVersion: z.number(),
  actualVersion: z.number(),
  changedBy: z.enum(MODIFIERS),
  changedAt: z.string().datetime(),
  diff: z.object({
    blocksAdded: z.array(z.string()),
    blocksModified: z.array(z.string()),
    blocksDeleted: z.array(z.string())
  }).optional()
});
var ChangeSchema = z.object({
  path: z.string(),
  before: z.unknown(),
  after: z.unknown()
});
var EditRecordSchema = z.object({
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
  dependents: z.array(z.string())
});
var RetentionPolicySchema = z.object({
  maxEdits: z.number().int().positive(),
  maxAgeDays: z.number().int().positive(),
  undoWindowHours: z.number().int().positive()
});
var EditHistoryCollectionSchema = z.object({
  nodeId: z.string(),
  edits: z.array(EditRecordSchema),
  retention: RetentionPolicySchema
});
function createDefaultRetentionPolicy() {
  return {
    maxEdits: EDIT_HISTORY_RETENTION.maxEdits,
    maxAgeDays: EDIT_HISTORY_RETENTION.maxAgeDays,
    undoWindowHours: EDIT_HISTORY_RETENTION.undoWindowHours
  };
}
function createEditHistoryCollection(nodeId) {
  return {
    nodeId,
    edits: [],
    retention: createDefaultRetentionPolicy()
  };
}
function validateTarget(content, target) {
  switch (target.method) {
    case "full":
      return { valid: true };
    case "block_id":
      if (!content.blocks || !target.blockId) {
        return { valid: false, errorType: "BLOCK_NOT_FOUND" };
      }
      const blockById = findBlockById(content.blocks, target.blockId);
      return blockById ? { valid: true, targetBlock: blockById } : { valid: false, errorType: "BLOCK_NOT_FOUND" };
    case "heading":
      if (!content.blocks || !target.heading) {
        return { valid: false, errorType: "HEADING_NOT_FOUND" };
      }
      const headingBlock = findBlockByHeading(
        content.blocks,
        target.heading,
        target.headingLevel
      );
      return headingBlock ? { valid: true, targetBlock: headingBlock } : { valid: false, errorType: "HEADING_NOT_FOUND" };
    case "position":
      return { valid: true };
    // Position is always valid
    case "search":
      if (!target.searchPattern) {
        return { valid: false, errorType: "SEARCH_NOT_FOUND" };
      }
      const body = content.body ?? "";
      const found = body.toLowerCase().includes(target.searchPattern.toLowerCase());
      return found ? { valid: true } : { valid: false, errorType: "SEARCH_NOT_FOUND" };
    default:
      return { valid: false, errorType: "BLOCK_NOT_FOUND" };
  }
}
function applyEdit(content, operation) {
  const newContent = JSON.parse(JSON.stringify(content));
  switch (operation.target.method) {
    case "full":
      if (operation.action === "replace") {
        newContent.body = operation.content;
      } else if (operation.action === "append") {
        newContent.body = (newContent.body ?? "") + "\n" + (operation.content ?? "");
      }
      break;
    case "block_id":
      if (newContent.blocks && operation.target.blockId) {
        applyBlockEdit(newContent.blocks, operation.target.blockId, operation);
      }
      break;
    case "heading":
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
    case "position":
      applyPositionEdit(newContent, operation);
      break;
    case "search":
      applySearchEdit(newContent, operation);
      break;
  }
  return newContent;
}
function applyBlockEdit(blocks, blockId, operation) {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;
    if (block.id === blockId) {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      switch (operation.action) {
        case "replace":
          blocks[i] = {
            id: block.id,
            type: block.type,
            content: operation.content ?? "",
            level: block.level,
            children: block.children,
            created: block.created,
            modified: now
          };
          return true;
        case "append":
          blocks[i] = {
            id: block.id,
            type: block.type,
            content: block.content + "\n" + (operation.content ?? ""),
            level: block.level,
            children: block.children,
            created: block.created,
            modified: now
          };
          return true;
        case "insert":
          if (operation.content) {
            const newBlock = {
              id: "b_" + nanoid(NANOID_LENGTH),
              type: "paragraph",
              content: operation.content,
              created: now,
              modified: now
            };
            blocks.splice(i + 1, 0, newBlock);
          }
          return true;
        case "delete":
          blocks.splice(i, 1);
          return true;
      }
    }
    if (block.children) {
      const found = applyBlockEdit(block.children, blockId, operation);
      if (found) return true;
    }
  }
  return false;
}
function applyPositionEdit(content, operation) {
  const { position } = operation.target;
  if (position === "start") {
    content.body = (operation.content ?? "") + "\n" + (content.body ?? "");
  } else if (position === "end") {
    content.body = (content.body ?? "") + "\n" + (operation.content ?? "");
  }
}
function applySearchEdit(content, operation) {
  if (!operation.target.searchPattern || !content.body) return;
  const pattern = operation.target.searchPattern;
  switch (operation.action) {
    case "replace":
      content.body = content.body.replace(
        new RegExp(escapeRegex(pattern), "gi"),
        operation.content ?? ""
      );
      break;
    case "append":
      content.body = content.body.replace(
        new RegExp(escapeRegex(pattern), "gi"),
        (match) => match + (operation.content ?? "")
      );
      break;
    case "delete":
      content.body = content.body.replace(new RegExp(escapeRegex(pattern), "gi"), "");
      break;
  }
}
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function computeChecksum(content) {
  const str = JSON.stringify(content);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}
function computeChanges(before, after) {
  const changes = [];
  if (before.title !== after.title) {
    changes.push({ path: "content.title", before: before.title, after: after.title });
  }
  if (before.body !== after.body) {
    changes.push({ path: "content.body", before: before.body, after: after.body });
  }
  if (before.summary !== after.summary) {
    changes.push({ path: "content.summary", before: before.summary, after: after.summary });
  }
  const beforeBlocks = JSON.stringify(before.blocks ?? []);
  const afterBlocks = JSON.stringify(after.blocks ?? []);
  if (beforeBlocks !== afterBlocks) {
    changes.push({ path: "content.blocks", before: before.blocks, after: after.blocks });
  }
  return changes;
}
function computeReverseOperation(operation, beforeContent) {
  switch (operation.action) {
    case "replace":
      return {
        target: operation.target,
        action: "replace",
        content: operation.target.method === "full" ? beforeContent.body : getTargetContent(beforeContent, operation.target)
      };
    case "append":
      return {
        target: operation.target,
        action: "replace",
        content: getTargetContent(beforeContent, operation.target)
      };
    case "insert":
      return {
        target: operation.target,
        action: "delete"
      };
    case "delete":
      return {
        target: operation.target,
        action: "insert",
        content: getTargetContent(beforeContent, operation.target)
      };
    default:
      return {
        target: { method: "full" },
        action: "replace",
        content: beforeContent.body
      };
  }
}
function getTargetContent(content, target) {
  switch (target.method) {
    case "full":
      return content.body;
    case "block_id":
      if (content.blocks && target.blockId) {
        const block = findBlockById(content.blocks, target.blockId);
        return block?.content;
      }
      return void 0;
    case "heading":
      if (content.blocks && target.heading) {
        const block = findBlockByHeading(content.blocks, target.heading, target.headingLevel);
        return block?.content;
      }
      return void 0;
    default:
      return content.body;
  }
}
function safeEdit(node, request, options = {}) {
  const actor = options.actor ?? "user";
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (node.versioning.version !== request.expectedVersion) {
    return {
      result: {
        success: false,
        error: {
          type: "VERSION_MISMATCH",
          expectedVersion: request.expectedVersion,
          actualVersion: node.versioning.version,
          changedBy: node.versioning.lastModifier,
          changedAt: node.versioning.lastModified
        }
      }
    };
  }
  const targetValidation = validateTarget(node.content, request.operation.target);
  if (!targetValidation.valid) {
    return {
      result: {
        success: false,
        error: {
          type: targetValidation.errorType,
          expectedVersion: request.expectedVersion,
          actualVersion: node.versioning.version,
          changedBy: node.versioning.lastModifier,
          changedAt: node.versioning.lastModified
        }
      }
    };
  }
  const beforeContent = JSON.parse(JSON.stringify(node.content));
  const updatedContent = applyEdit(node.content, request.operation);
  const newVersion = node.versioning.version + 1;
  const updatedNode = {
    ...node,
    content: updatedContent,
    versioning: {
      version: newVersion,
      lastModified: now,
      lastModifier: actor,
      checksum: computeChecksum(updatedContent)
    }
  };
  const editId = generateEditId();
  const editRecord = {
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
      Date.now() + EDIT_HISTORY_RETENTION.undoWindowHours * 60 * 60 * 1e3
    ).toISOString(),
    reverseOperation: computeReverseOperation(request.operation, beforeContent),
    dependsOn: [],
    dependents: []
  };
  return {
    result: {
      success: true,
      newVersion,
      editId
    },
    updatedNode,
    editRecord
  };
}
function canAutoMerge(_baseContent, theirChanges, ourChange) {
  const theirBlocks = theirChanges.flatMap((c) => getAffectedBlocks(c));
  const ourBlocks = getAffectedBlocks(ourChange);
  if (theirBlocks.includes("__full__") || ourBlocks.includes("__full__")) {
    return false;
  }
  const overlap = theirBlocks.filter((b) => ourBlocks.includes(b));
  return overlap.length === 0;
}
function getAffectedBlocks(operation) {
  if (operation.target.method === "block_id" && operation.target.blockId) {
    return [operation.target.blockId];
  }
  if (operation.target.method === "full") {
    return ["__full__"];
  }
  return [];
}
function canUndo(record) {
  if (!record.undoable) {
    return { canUndo: false, reason: "Edit not undoable" };
  }
  if (/* @__PURE__ */ new Date() > new Date(record.undoExpires)) {
    return { canUndo: false, reason: "Undo window expired" };
  }
  if (record.dependents.length > 0) {
    return { canUndo: false, reason: "Has dependent edits" };
  }
  return { canUndo: true };
}
function createUndoRequest(record, currentVersion) {
  return {
    nodeId: record.nodeId,
    expectedVersion: currentVersion,
    operation: record.reverseOperation,
    conflictResolution: "abort"
  };
}
function pruneEditHistory(history) {
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setDate(cutoffDate.getDate() - history.retention.maxAgeDays);
  const cutoff = cutoffDate.toISOString();
  let edits = history.edits.filter((edit) => {
    const tooOld = edit.timestamp < cutoff;
    const undoExpired = /* @__PURE__ */ new Date() > new Date(edit.undoExpires);
    return !(tooOld && undoExpired);
  });
  if (edits.length > history.retention.maxEdits) {
    edits = edits.slice(0, history.retention.maxEdits);
  }
  return {
    ...history,
    edits
  };
}
function addToHistory(history, record) {
  return {
    ...history,
    edits: [record, ...history.edits]
  };
}
function getEditById(history, editId) {
  return history.edits.find((e) => e.id === editId);
}
function addDependent(history, editId, dependentId) {
  return {
    ...history,
    edits: history.edits.map(
      (e) => e.id === editId ? { ...e, dependents: [...e.dependents, dependentId] } : e
    )
  };
}
function validateEditOperation(operation) {
  return EditOperationSchema.safeParse(operation).success;
}
function validateEditRequest(request) {
  return EditRequestSchema.safeParse(request).success;
}

export { ChangeSchema, ConflictErrorSchema, EditHistoryCollectionSchema, EditOperationSchema, EditRecordSchema, EditRequestSchema, EditResultSchema, EditTargetSchema, RetentionPolicySchema, addDependent, addToHistory, applyEdit, canAutoMerge, canUndo, computeChanges, computeChecksum, computeReverseOperation, createDefaultRetentionPolicy, createEditHistoryCollection, createUndoRequest, generateEditId, getAffectedBlocks, getEditById, pruneEditHistory, safeEdit, validateEditOperation, validateEditRequest, validateTarget };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map