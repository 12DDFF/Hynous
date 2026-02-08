/**
 * @module @nous/core/blocks
 * @description Block structure for long-form content with stable IDs
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-011/spec/block-schema.ts
 *
 * Blocks enable:
 * - Semantic anchor editing (target by heading, block ID)
 * - Stable references during sync
 * - Structured content preservation
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  NANOID_LENGTH,
  BLOCK_ID_PREFIX,
  BLOCK_TYPES,
  BLOCK_LENGTH_THRESHOLD,
  BLOCK_LIST_THRESHOLD,
  HEADING_PATTERN,
  LIST_ITEM_PATTERN,
  type BlockType,
  type ContentSource,
} from '../constants';

// ============================================================
// ID GENERATION
// ============================================================

/**
 * Generates a globally unique block ID.
 * Format: "b_" + 12-character nanoid
 */
export function generateBlockId(): string {
  return BLOCK_ID_PREFIX + nanoid(NANOID_LENGTH);
}

// ============================================================
// BLOCK INTERFACE
// ============================================================

/**
 * A structural block within a node's content.
 */
export interface Block {
  /** Globally unique block ID. Format: "b_" + nanoid(12) */
  id: string;
  /** Block type determines rendering and behavior */
  type: BlockType;
  /** The actual content of this block */
  content: string;
  /** Heading level (1-6). Only used for 'heading' type blocks. */
  level?: number;
  /** Child blocks for nested content. */
  children?: Block[];
  /** When this block was created (ISO 8601) */
  created: string;
  /** When this block was last modified (ISO 8601) */
  modified: string;
}

export const BlockSchema: z.ZodType<Block> = z.lazy(() =>
  z.object({
    id: z.string().regex(/^b_[a-zA-Z0-9_-]{12}$/),
    type: z.enum(BLOCK_TYPES),
    content: z.string(),
    level: z.number().int().min(1).max(6).optional(),
    children: z.array(BlockSchema).optional(),
    created: z.string().datetime(),
    modified: z.string().datetime(),
  })
);

// ============================================================
// BLOCK DECISION FUNCTIONS
// ============================================================

/**
 * Determines if content should use block structure.
 *
 * Rules (from storm-011 v4):
 * 1. Length > 1000 chars → YES
 * 2. Has markdown headings → YES
 * 3. Has 3+ list items → YES
 * 4. Source is 'import' or 'user_note' → YES
 * 5. Source is 'chat_extraction' or 'fact' → NO
 * 6. Default → NO
 */
export function shouldUseBlocks(content: string, source: ContentSource): boolean {
  // Rule 1: Length threshold
  if (content.length > BLOCK_LENGTH_THRESHOLD) {
    return true;
  }

  // Rule 2: Has natural structure (headings)
  if (hasHeadings(content)) {
    return true;
  }

  // Rule 3: Has natural structure (multiple lists)
  if (hasMultipleLists(content)) {
    return true;
  }

  // Rule 4: Source types that always use blocks
  if (source === 'import' || source === 'user_note') {
    return true;
  }

  // Rule 5: Source types that never use blocks
  if (source === 'chat_extraction' || source === 'fact') {
    return false;
  }

  // Default: no blocks
  return false;
}

/**
 * Checks if content contains markdown headings.
 */
export function hasHeadings(content: string): boolean {
  return HEADING_PATTERN.test(content);
}

/**
 * Checks if content has multiple list items.
 */
export function hasMultipleLists(content: string): boolean {
  const matches = content.match(LIST_ITEM_PATTERN) || [];
  return matches.length >= BLOCK_LIST_THRESHOLD;
}

// ============================================================
// BLOCK CREATION
// ============================================================

/**
 * Creates a new block with generated ID and timestamps.
 */
export function createBlock(
  type: BlockType,
  content: string,
  options: { level?: number; children?: Block[] } = {}
): Block {
  const now = new Date().toISOString();
  return {
    id: generateBlockId(),
    type,
    content,
    level: options.level,
    children: options.children,
    created: now,
    modified: now,
  };
}

// ============================================================
// BLOCK PARSING
// ============================================================

/**
 * Parses markdown content into block structure.
 */
export function parseIntoBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.split('\n');

  let currentParagraph: string[] = [];

  const flushParagraph = (): void => {
    if (currentParagraph.length > 0) {
      const content = currentParagraph.join('\n').trim();
      if (content) {
        blocks.push(createBlock('paragraph', content));
      }
      currentParagraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Heading detection
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      flushParagraph();
      blocks.push(
        createBlock('heading', headingMatch[2], {
          level: headingMatch[1].length,
        })
      );
      continue;
    }

    // Code block detection
    if (line.startsWith('```')) {
      flushParagraph();
      const codeLines: string[] = [];
      i++; // Move past opening ```
      while (i < lines.length) {
        const codeLine = lines[i];
        if (codeLine === undefined || codeLine.startsWith('```')) break;
        codeLines.push(codeLine);
        i++;
      }
      blocks.push(createBlock('code', codeLines.join('\n')));
      continue;
    }

    // Quote detection
    if (line.startsWith('> ')) {
      flushParagraph();
      const quoteContent = line.slice(2);
      blocks.push(createBlock('quote', quoteContent));
      continue;
    }

    // List detection
    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch && listMatch[1]) {
      flushParagraph();

      // Collect all consecutive list items
      const listItems: Block[] = [];
      while (i < lines.length) {
        const currentLine = lines[i];
        if (currentLine === undefined) break;
        const itemMatch = currentLine.match(/^[-*]\s+(.+)$/);
        if (!itemMatch || !itemMatch[1]) break;
        listItems.push(createBlock('list_item', itemMatch[1]));
        i++;
      }
      i--; // Back up one since loop will increment

      blocks.push(createBlock('list', '', { children: listItems }));
      continue;
    }

    // Divider detection
    if (line.match(/^[-*_]{3,}$/)) {
      flushParagraph();
      blocks.push(createBlock('divider', ''));
      continue;
    }

    // Empty line ends paragraph
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    // Regular content → accumulate in paragraph
    currentParagraph.push(line);
  }

  // Flush any remaining paragraph
  flushParagraph();

  return blocks;
}

// ============================================================
// BODY DERIVATION
// ============================================================

/**
 * Derives markdown body from block structure.
 * This is the inverse of parseIntoBlocks.
 */
export function deriveBody(blocks: Block[]): string {
  return blocks.map((block) => blockToMarkdown(block)).join('\n\n');
}

/**
 * Converts a single block to markdown.
 */
function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case 'heading':
      return '#'.repeat(block.level || 1) + ' ' + block.content;

    case 'paragraph':
      return block.content;

    case 'list':
      return (block.children || []).map((child) => '- ' + child.content).join('\n');

    case 'list_item':
      return '- ' + block.content;

    case 'quote':
      return '> ' + block.content;

    case 'code':
      return '```\n' + block.content + '\n```';

    case 'callout':
      return '> [!note]\n> ' + block.content;

    case 'divider':
      return '---';

    case 'table':
      return block.content;

    case 'image':
      return block.content;

    default:
      return block.content;
  }
}

// ============================================================
// BLOCK UTILITIES
// ============================================================

/**
 * Finds a block by ID within a block tree.
 */
export function findBlockById(blocks: Block[], blockId: string): Block | undefined {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block;
    }
    if (block.children) {
      const found = findBlockById(block.children, blockId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Finds a block by heading text.
 */
export function findBlockByHeading(
  blocks: Block[],
  heading: string,
  level?: number
): Block | undefined {
  for (const block of blocks) {
    if (block.type === 'heading') {
      const matchesText = block.content.toLowerCase() === heading.toLowerCase();
      const matchesLevel = level === undefined || block.level === level;
      if (matchesText && matchesLevel) {
        return block;
      }
    }
    if (block.children) {
      const found = findBlockByHeading(block.children, heading, level);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Gets all block IDs in a block tree.
 */
export function getAllBlockIds(blocks: Block[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    ids.push(block.id);
    if (block.children) {
      ids.push(...getAllBlockIds(block.children));
    }
  }
  return ids;
}

/**
 * Updates a block's modified timestamp.
 */
export function touchBlock(block: Block): Block {
  return {
    ...block,
    modified: new Date().toISOString(),
  };
}

/**
 * Counts total number of blocks including nested children.
 */
export function countBlocks(blocks: Block[]): number {
  let count = 0;
  for (const block of blocks) {
    count++;
    if (block.children) {
      count += countBlocks(block.children);
    }
  }
  return count;
}

// ============================================================
// RE-EXPORTS
// ============================================================

export type { BlockType, ContentSource };
