import { z } from 'zod';
import { B as BlockType, d as ContentSource } from '../constants-Blu2FVkv.js';

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

/**
 * Generates a globally unique block ID.
 * Format: "b_" + 12-character nanoid
 */
declare function generateBlockId(): string;
/**
 * A structural block within a node's content.
 */
interface Block {
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
declare const BlockSchema: z.ZodType<Block>;
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
declare function shouldUseBlocks(content: string, source: ContentSource): boolean;
/**
 * Checks if content contains markdown headings.
 */
declare function hasHeadings(content: string): boolean;
/**
 * Checks if content has multiple list items.
 */
declare function hasMultipleLists(content: string): boolean;
/**
 * Creates a new block with generated ID and timestamps.
 */
declare function createBlock(type: BlockType, content: string, options?: {
    level?: number;
    children?: Block[];
}): Block;
/**
 * Parses markdown content into block structure.
 */
declare function parseIntoBlocks(body: string): Block[];
/**
 * Derives markdown body from block structure.
 * This is the inverse of parseIntoBlocks.
 */
declare function deriveBody(blocks: Block[]): string;
/**
 * Finds a block by ID within a block tree.
 */
declare function findBlockById(blocks: Block[], blockId: string): Block | undefined;
/**
 * Finds a block by heading text.
 */
declare function findBlockByHeading(blocks: Block[], heading: string, level?: number): Block | undefined;
/**
 * Gets all block IDs in a block tree.
 */
declare function getAllBlockIds(blocks: Block[]): string[];
/**
 * Updates a block's modified timestamp.
 */
declare function touchBlock(block: Block): Block;
/**
 * Counts total number of blocks including nested children.
 */
declare function countBlocks(blocks: Block[]): number;

export { type Block, BlockSchema, BlockType, ContentSource, countBlocks, createBlock, deriveBody, findBlockByHeading, findBlockById, generateBlockId, getAllBlockIds, hasHeadings, hasMultipleLists, parseIntoBlocks, shouldUseBlocks, touchBlock };
