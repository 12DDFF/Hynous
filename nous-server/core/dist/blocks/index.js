import { z } from 'zod';
import { nanoid } from 'nanoid';

// src/blocks/index.ts

// src/constants.ts
var NANOID_LENGTH = 12;
var BLOCK_ID_PREFIX = "b_";
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
var BLOCK_LENGTH_THRESHOLD = 1e3;
var BLOCK_LIST_THRESHOLD = 3;
var HEADING_PATTERN = /^#{1,6}\s/m;
var LIST_ITEM_PATTERN = /^[-*]\s/gm;

// src/blocks/index.ts
function generateBlockId() {
  return BLOCK_ID_PREFIX + nanoid(NANOID_LENGTH);
}
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
function shouldUseBlocks(content, source) {
  if (content.length > BLOCK_LENGTH_THRESHOLD) {
    return true;
  }
  if (hasHeadings(content)) {
    return true;
  }
  if (hasMultipleLists(content)) {
    return true;
  }
  if (source === "import" || source === "user_note") {
    return true;
  }
  if (source === "chat_extraction" || source === "fact") {
    return false;
  }
  return false;
}
function hasHeadings(content) {
  return HEADING_PATTERN.test(content);
}
function hasMultipleLists(content) {
  const matches = content.match(LIST_ITEM_PATTERN) || [];
  return matches.length >= BLOCK_LIST_THRESHOLD;
}
function createBlock(type, content, options = {}) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: generateBlockId(),
    type,
    content,
    level: options.level,
    children: options.children,
    created: now,
    modified: now
  };
}
function parseIntoBlocks(body) {
  const blocks = [];
  const lines = body.split("\n");
  let currentParagraph = [];
  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const content = currentParagraph.join("\n").trim();
      if (content) {
        blocks.push(createBlock("paragraph", content));
      }
      currentParagraph = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === void 0) continue;
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      flushParagraph();
      blocks.push(
        createBlock("heading", headingMatch[2], {
          level: headingMatch[1].length
        })
      );
      continue;
    }
    if (line.startsWith("```")) {
      flushParagraph();
      const codeLines = [];
      i++;
      while (i < lines.length) {
        const codeLine = lines[i];
        if (codeLine === void 0 || codeLine.startsWith("```")) break;
        codeLines.push(codeLine);
        i++;
      }
      blocks.push(createBlock("code", codeLines.join("\n")));
      continue;
    }
    if (line.startsWith("> ")) {
      flushParagraph();
      const quoteContent = line.slice(2);
      blocks.push(createBlock("quote", quoteContent));
      continue;
    }
    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch && listMatch[1]) {
      flushParagraph();
      const listItems = [];
      while (i < lines.length) {
        const currentLine = lines[i];
        if (currentLine === void 0) break;
        const itemMatch = currentLine.match(/^[-*]\s+(.+)$/);
        if (!itemMatch || !itemMatch[1]) break;
        listItems.push(createBlock("list_item", itemMatch[1]));
        i++;
      }
      i--;
      blocks.push(createBlock("list", "", { children: listItems }));
      continue;
    }
    if (line.match(/^[-*_]{3,}$/)) {
      flushParagraph();
      blocks.push(createBlock("divider", ""));
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    currentParagraph.push(line);
  }
  flushParagraph();
  return blocks;
}
function deriveBody(blocks) {
  return blocks.map((block) => blockToMarkdown(block)).join("\n\n");
}
function blockToMarkdown(block) {
  switch (block.type) {
    case "heading":
      return "#".repeat(block.level || 1) + " " + block.content;
    case "paragraph":
      return block.content;
    case "list":
      return (block.children || []).map((child) => "- " + child.content).join("\n");
    case "list_item":
      return "- " + block.content;
    case "quote":
      return "> " + block.content;
    case "code":
      return "```\n" + block.content + "\n```";
    case "callout":
      return "> [!note]\n> " + block.content;
    case "divider":
      return "---";
    case "table":
      return block.content;
    case "image":
      return block.content;
    default:
      return block.content;
  }
}
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
function getAllBlockIds(blocks) {
  const ids = [];
  for (const block of blocks) {
    ids.push(block.id);
    if (block.children) {
      ids.push(...getAllBlockIds(block.children));
    }
  }
  return ids;
}
function touchBlock(block) {
  return {
    ...block,
    modified: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function countBlocks(blocks) {
  let count = 0;
  for (const block of blocks) {
    count++;
    if (block.children) {
      count += countBlocks(block.children);
    }
  }
  return count;
}

export { BlockSchema, countBlocks, createBlock, deriveBody, findBlockByHeading, findBlockById, generateBlockId, getAllBlockIds, hasHeadings, hasMultipleLists, parseIntoBlocks, shouldUseBlocks, touchBlock };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map