/**
 * @module @nous/core/blocks
 * @description Tests for blocks module - Block structure and parsing
 */

import { describe, it, expect } from 'vitest';
import {
  generateBlockId,
  shouldUseBlocks,
  hasHeadings,
  hasMultipleLists,
  createBlock,
  parseIntoBlocks,
  deriveBody,
  findBlockById,
  findBlockByHeading,
  getAllBlockIds,
  touchBlock,
  countBlocks,
  BlockSchema,
  type Block,
} from './index';

describe('Blocks Module', () => {
  describe('generateBlockId', () => {
    it('should generate block ID with correct prefix', () => {
      const id = generateBlockId();

      expect(id).toMatch(/^b_[a-zA-Z0-9_-]{12}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateBlockId());
      }

      expect(ids.size).toBe(100);
    });
  });

  describe('shouldUseBlocks', () => {
    it('should return true for long content', () => {
      const longContent = 'a'.repeat(1001);

      expect(shouldUseBlocks(longContent, 'fact')).toBe(true);
    });

    it('should return true for content with headings', () => {
      const content = '# Heading\nSome content';

      expect(shouldUseBlocks(content, 'fact')).toBe(true);
    });

    it('should return true for content with multiple lists', () => {
      const content = '- item 1\n- item 2\n- item 3';

      expect(shouldUseBlocks(content, 'fact')).toBe(true);
    });

    it('should return true for import source', () => {
      expect(shouldUseBlocks('short', 'import')).toBe(true);
    });

    it('should return true for user_note source', () => {
      expect(shouldUseBlocks('short', 'user_note')).toBe(true);
    });

    it('should return false for chat_extraction source', () => {
      expect(shouldUseBlocks('short', 'chat_extraction')).toBe(false);
    });

    it('should return false for fact source', () => {
      expect(shouldUseBlocks('short', 'fact')).toBe(false);
    });
  });

  describe('hasHeadings', () => {
    it('should detect h1 headings', () => {
      expect(hasHeadings('# Heading')).toBe(true);
    });

    it('should detect h2-h6 headings', () => {
      expect(hasHeadings('## Heading')).toBe(true);
      expect(hasHeadings('### Heading')).toBe(true);
      expect(hasHeadings('###### Heading')).toBe(true);
    });

    it('should return false for non-headings', () => {
      expect(hasHeadings('No heading here')).toBe(false);
      expect(hasHeadings('#NoSpace')).toBe(false);
    });
  });

  describe('hasMultipleLists', () => {
    it('should detect 3+ list items', () => {
      const content = '- item 1\n- item 2\n- item 3';
      expect(hasMultipleLists(content)).toBe(true);
    });

    it('should return false for 2 or fewer items', () => {
      const content = '- item 1\n- item 2';
      expect(hasMultipleLists(content)).toBe(false);
    });

    it('should work with asterisk lists', () => {
      const content = '* item 1\n* item 2\n* item 3';
      expect(hasMultipleLists(content)).toBe(true);
    });
  });

  describe('createBlock', () => {
    it('should create a block with all required fields', () => {
      const block = createBlock('paragraph', 'Test content');

      expect(block.id).toMatch(/^b_/);
      expect(block.type).toBe('paragraph');
      expect(block.content).toBe('Test content');
      expect(block.created).toBeDefined();
      expect(block.modified).toBeDefined();
    });

    it('should handle heading level option', () => {
      const block = createBlock('heading', 'Title', { level: 2 });

      expect(block.level).toBe(2);
    });

    it('should handle children option', () => {
      const child = createBlock('list_item', 'Item 1');
      const parent = createBlock('list', '', { children: [child] });

      expect(parent.children).toHaveLength(1);
      expect(parent.children?.[0].content).toBe('Item 1');
    });
  });

  describe('parseIntoBlocks', () => {
    it('should parse plain paragraphs', () => {
      const body = 'First paragraph\n\nSecond paragraph';
      const blocks = parseIntoBlocks(body);

      expect(blocks).toHaveLength(2);
      expect(blocks[0]?.type).toBe('paragraph');
      expect(blocks[1]?.type).toBe('paragraph');
    });

    it('should parse headings', () => {
      const body = '# Main Title\n\nContent\n\n## Subtitle';
      const blocks = parseIntoBlocks(body);

      expect(blocks[0]?.type).toBe('heading');
      expect(blocks[0]?.level).toBe(1);
      expect(blocks[0]?.content).toBe('Main Title');
      expect(blocks[2]?.type).toBe('heading');
      expect(blocks[2]?.level).toBe(2);
    });

    it('should parse code blocks', () => {
      const body = '```\nconst x = 1;\n```';
      const blocks = parseIntoBlocks(body);

      expect(blocks[0]?.type).toBe('code');
      expect(blocks[0]?.content).toBe('const x = 1;');
    });

    it('should parse quotes', () => {
      const body = '> This is a quote';
      const blocks = parseIntoBlocks(body);

      expect(blocks[0]?.type).toBe('quote');
      expect(blocks[0]?.content).toBe('This is a quote');
    });

    it('should parse lists', () => {
      const body = '- Item 1\n- Item 2\n- Item 3';
      const blocks = parseIntoBlocks(body);

      expect(blocks[0]?.type).toBe('list');
      expect(blocks[0]?.children).toHaveLength(3);
    });

    it('should parse dividers', () => {
      const body = 'Before\n\n---\n\nAfter';
      const blocks = parseIntoBlocks(body);

      expect(blocks[1]?.type).toBe('divider');
    });

    it('should handle mixed content', () => {
      const body = `# Title

Some paragraph text.

- Item 1
- Item 2
- Item 3

> A quote

\`\`\`
code here
\`\`\``;

      const blocks = parseIntoBlocks(body);

      expect(blocks.length).toBeGreaterThanOrEqual(5);
      expect(blocks.some((b) => b.type === 'heading')).toBe(true);
      expect(blocks.some((b) => b.type === 'paragraph')).toBe(true);
      expect(blocks.some((b) => b.type === 'list')).toBe(true);
      expect(blocks.some((b) => b.type === 'quote')).toBe(true);
      expect(blocks.some((b) => b.type === 'code')).toBe(true);
    });
  });

  describe('deriveBody', () => {
    it('should convert blocks back to markdown', () => {
      const blocks: Block[] = [
        createBlock('heading', 'Title', { level: 1 }),
        createBlock('paragraph', 'Some text'),
      ];

      const body = deriveBody(blocks);

      expect(body).toContain('# Title');
      expect(body).toContain('Some text');
    });

    it('should handle lists', () => {
      const listItems = [
        createBlock('list_item', 'Item 1'),
        createBlock('list_item', 'Item 2'),
      ];
      const blocks: Block[] = [createBlock('list', '', { children: listItems })];

      const body = deriveBody(blocks);

      expect(body).toContain('- Item 1');
      expect(body).toContain('- Item 2');
    });

    it('should handle code blocks', () => {
      const blocks: Block[] = [createBlock('code', 'const x = 1;')];

      const body = deriveBody(blocks);

      expect(body).toContain('```');
      expect(body).toContain('const x = 1;');
    });

    it('should roundtrip content', () => {
      const original = `# Title

Some paragraph.

- Item 1
- Item 2

> Quote`;

      const blocks = parseIntoBlocks(original);
      const derived = deriveBody(blocks);
      const reparsed = parseIntoBlocks(derived);

      // Same structure
      expect(reparsed.length).toBe(blocks.length);
      expect(reparsed[0]?.type).toBe(blocks[0]?.type);
    });
  });

  describe('findBlockById', () => {
    it('should find block by ID', () => {
      const block = createBlock('paragraph', 'Test');
      const blocks = [block];

      const found = findBlockById(blocks, block.id);

      expect(found).toBe(block);
    });

    it('should find nested blocks', () => {
      const child = createBlock('list_item', 'Item');
      const parent = createBlock('list', '', { children: [child] });
      const blocks = [parent];

      const found = findBlockById(blocks, child.id);

      expect(found).toBe(child);
    });

    it('should return undefined for non-existent ID', () => {
      const blocks = [createBlock('paragraph', 'Test')];

      const found = findBlockById(blocks, 'b_nonexistent1');

      expect(found).toBeUndefined();
    });
  });

  describe('findBlockByHeading', () => {
    it('should find heading by text', () => {
      const heading = createBlock('heading', 'Important', { level: 2 });
      const blocks = [heading];

      const found = findBlockByHeading(blocks, 'Important');

      expect(found).toBe(heading);
    });

    it('should be case insensitive', () => {
      const heading = createBlock('heading', 'Title', { level: 1 });
      const blocks = [heading];

      const found = findBlockByHeading(blocks, 'TITLE');

      expect(found).toBe(heading);
    });

    it('should filter by level', () => {
      const h1 = createBlock('heading', 'Title', { level: 1 });
      const h2 = createBlock('heading', 'Title', { level: 2 });
      const blocks = [h1, h2];

      const found = findBlockByHeading(blocks, 'Title', 2);

      expect(found).toBe(h2);
    });

    it('should return undefined for non-existent heading', () => {
      const blocks = [createBlock('heading', 'Existing', { level: 1 })];

      const found = findBlockByHeading(blocks, 'Missing');

      expect(found).toBeUndefined();
    });
  });

  describe('getAllBlockIds', () => {
    it('should get all IDs including nested', () => {
      const child1 = createBlock('list_item', 'Item 1');
      const child2 = createBlock('list_item', 'Item 2');
      const parent = createBlock('list', '', { children: [child1, child2] });
      const paragraph = createBlock('paragraph', 'Text');
      const blocks = [parent, paragraph];

      const ids = getAllBlockIds(blocks);

      expect(ids).toHaveLength(4);
      expect(ids).toContain(parent.id);
      expect(ids).toContain(child1.id);
      expect(ids).toContain(child2.id);
      expect(ids).toContain(paragraph.id);
    });
  });

  describe('touchBlock', () => {
    it('should update modified timestamp', async () => {
      const block = createBlock('paragraph', 'Test');
      const originalModified = block.modified;

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const touched = touchBlock(block);

      expect(touched.modified).not.toBe(originalModified);
      expect(new Date(touched.modified).getTime()).toBeGreaterThan(
        new Date(originalModified).getTime()
      );
    });

    it('should not mutate original block', () => {
      const block = createBlock('paragraph', 'Test');
      const originalModified = block.modified;

      touchBlock(block);

      expect(block.modified).toBe(originalModified);
    });
  });

  describe('countBlocks', () => {
    it('should count flat blocks', () => {
      const blocks = [
        createBlock('paragraph', 'One'),
        createBlock('paragraph', 'Two'),
        createBlock('paragraph', 'Three'),
      ];

      expect(countBlocks(blocks)).toBe(3);
    });

    it('should count nested blocks', () => {
      const children = [
        createBlock('list_item', 'Item 1'),
        createBlock('list_item', 'Item 2'),
      ];
      const blocks = [
        createBlock('list', '', { children }),
        createBlock('paragraph', 'Text'),
      ];

      expect(countBlocks(blocks)).toBe(4); // list + 2 items + paragraph
    });
  });

  describe('Schema Validation', () => {
    it('should validate a valid block', () => {
      const block = createBlock('paragraph', 'Test content');

      const result = BlockSchema.safeParse(block);

      expect(result.success).toBe(true);
    });

    it('should reject invalid block type', () => {
      const invalid = {
        id: 'b_123456789012',
        type: 'invalid_type',
        content: 'Test',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const result = BlockSchema.safeParse(invalid);

      expect(result.success).toBe(false);
    });

    it('should reject invalid block ID format', () => {
      const invalid = {
        id: 'invalid_id',
        type: 'paragraph',
        content: 'Test',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const result = BlockSchema.safeParse(invalid);

      expect(result.success).toBe(false);
    });
  });
});
