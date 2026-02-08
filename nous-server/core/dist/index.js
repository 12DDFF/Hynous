import { z } from 'zod';
import { nanoid } from 'nanoid';

// src/constants.ts
var NANOID_LENGTH = 12;
var NODE_ID_PREFIX = "n_";
var BLOCK_ID_PREFIX = "b_";
var EDGE_ID_PREFIX = "e_";
var EDIT_ID_PREFIX = "edit_";
var NODE_TYPES = [
  "concept",
  "episode",
  "document",
  "section",
  "chunk",
  "note",
  "raw"
];
var SEMANTIC_LAYER_TYPES = ["concept", "note", "chunk"];
var EPISODE_LAYER_TYPES = ["episode", "document", "section"];
var ARCHIVE_LAYER_TYPES = ["raw"];
var CONCEPT_SUBTYPES = [
  "fact",
  "definition",
  "relationship",
  "preference",
  "belief",
  "procedure",
  "entity",
  "event",
  "insight"
];
var EPISODE_SUBTYPES = [
  "lecture",
  "meeting",
  "conversation",
  "note_session",
  "document_read",
  "thought",
  "external_event"
];
var RAW_SUBTYPES = [
  "transcript",
  "document",
  "note",
  "image",
  "audio_recording"
];
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
var EDGE_TYPES = [
  "relates_to",
  "part_of",
  "mentioned_in",
  "causes",
  "precedes",
  "contradicts",
  "supersedes",
  "derived_from",
  "similar_to"
];
var LIFECYCLE_STATES = [
  "working",
  "active",
  "superseded",
  "dormant",
  "archived"
];
var SOURCE_TYPES = [
  "extraction",
  "manual",
  "inference",
  "import"
];
var CONTENT_SOURCES = [
  "import",
  "user_note",
  "chat_extraction",
  "fact",
  "document",
  "transcript"
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
  undoWindowHours: 24,
  pruneSchedule: "daily"
};
var TEMPORAL_GRANULARITIES = [
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year"
];
var EVENT_TIME_SOURCES = ["explicit", "inferred", "user_stated"];
var CONTENT_TIME_TYPES = ["historical", "relative", "approximate"];
var INPUT_TYPES = [
  "DOCUMENT",
  "TRANSCRIPT",
  "CONVERSATION",
  "NOTE",
  "IMPORT"
];
var INPUT_SIZES = ["tiny", "small", "medium", "large", "huge"];
var PROCESSING_PATHS = [
  "fast",
  "standard",
  "progressive",
  "conversation"
];
var SIZE_THRESHOLDS = {
  tiny: { min: 0, max: 50 },
  small: { min: 50, max: 500 },
  medium: { min: 500, max: 5e3 },
  large: { min: 5e3, max: 25e3 },
  huge: { min: 25e3, max: Infinity }
};
var BLOCK_LENGTH_THRESHOLD = 1e3;
var BLOCK_LIST_THRESHOLD = 3;
var NEURAL_DEFAULTS = {
  stability: 0.5,
  retrievability: 1,
  accessCount: 0
};
var EXTRACTION_DEPTHS = ["summary", "section", "full"];
var HEADING_PATTERN = /^#{1,6}\s/m;
var LIST_ITEM_PATTERN = /^[-*]\s/gm;
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
var IngestionTimeSchema = z.object({
  timestamp: z.string().datetime(),
  timezone: z.string()
});
var EventTimeSchema = z.object({
  timestamp: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  source: z.enum(EVENT_TIME_SOURCES)
});
var ContentTimeSchema = z.object({
  text: z.string(),
  resolved: z.string().datetime(),
  type: z.enum(CONTENT_TIME_TYPES),
  confidence: z.number().min(0).max(1)
});
var TemporalModelSchema = z.object({
  ingestion: IngestionTimeSchema,
  event: EventTimeSchema.optional(),
  content_times: z.array(ContentTimeSchema).optional(),
  reference_patterns: z.array(z.string()).optional()
});
var TemporalConfidenceSchema = z.object({
  source: z.number().min(0).max(1),
  granularity: z.number().min(0).max(1),
  interpretation: z.number().min(0).max(1),
  combined: z.number().min(0).max(1)
});
function createTemporalModel(timezone) {
  return {
    ingestion: {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  };
}
function addEventTime(temporal, eventTimestamp, source, confidence = 1) {
  return {
    ...temporal,
    event: {
      timestamp: typeof eventTimestamp === "string" ? eventTimestamp : eventTimestamp.toISOString(),
      source,
      confidence
    }
  };
}
function addContentTime(temporal, contentTime) {
  return {
    ...temporal,
    content_times: [...temporal.content_times ?? [], contentTime]
  };
}
function addReferencePattern(temporal, pattern) {
  const existing = temporal.reference_patterns ?? [];
  if (existing.includes(pattern)) {
    return temporal;
  }
  return {
    ...temporal,
    reference_patterns: [...existing, pattern]
  };
}
function calculateTemporalConfidence(source, granularity, interpretation) {
  return {
    source,
    granularity,
    interpretation,
    combined: source * granularity * interpretation
  };
}
function matchesTimeRange(temporal, start, end, queryType = "any") {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const inRange = (timestamp) => {
    const date = new Date(timestamp);
    return date >= startDate && date <= endDate;
  };
  if (queryType === "ingestion" || queryType === "any") {
    if (inRange(temporal.ingestion.timestamp)) {
      return true;
    }
  }
  if (queryType === "event" || queryType === "any") {
    if (temporal.event && inRange(temporal.event.timestamp)) {
      return true;
    }
  }
  if (queryType === "content" || queryType === "any") {
    if (temporal.content_times) {
      for (const ct of temporal.content_times) {
        if (inRange(ct.resolved)) {
          return true;
        }
      }
    }
  }
  return false;
}
function getPrimaryTimestamp(temporal) {
  return temporal.event?.timestamp ?? temporal.ingestion.timestamp;
}
function matchesReferencePattern(temporal, query) {
  if (!temporal.reference_patterns) {
    return false;
  }
  const queryLower = query.toLowerCase();
  return temporal.reference_patterns.some((pattern) => {
    const patternLower = pattern.toLowerCase();
    return queryLower.includes(patternLower) || patternLower.includes(queryLower);
  });
}

// src/nodes/index.ts
function generateNodeId() {
  return NODE_ID_PREFIX + nanoid(NANOID_LENGTH);
}
var EmbeddingFieldSchema = z.object({
  vector: z.instanceof(Float32Array),
  model: z.string(),
  created_at: z.string().datetime()
});
var NeuralPropertiesSchema = z.object({
  stability: z.number().min(0).max(1),
  retrievability: z.number().min(0).max(1),
  last_accessed: z.string().datetime(),
  access_count: z.number().int().min(0)
});
function createDefaultNeuralProperties() {
  return {
    stability: NEURAL_DEFAULTS.stability,
    retrievability: NEURAL_DEFAULTS.retrievability,
    last_accessed: (/* @__PURE__ */ new Date()).toISOString(),
    access_count: NEURAL_DEFAULTS.accessCount
  };
}
var ProvenanceSchema = z.object({
  source: z.enum(SOURCE_TYPES),
  parent_id: z.string().optional(),
  confidence: z.number().min(0).max(1)
});
var NodeStateSchema = z.object({
  extraction_depth: z.enum(EXTRACTION_DEPTHS),
  lifecycle: z.enum(LIFECYCLE_STATES)
});
var NodeVersionSchema = z.object({
  version: z.number().int().min(1),
  lastModified: z.string().datetime(),
  lastModifier: z.enum(MODIFIERS),
  checksum: z.string().optional()
});
function createInitialVersion(modifier = "system") {
  return {
    version: 1,
    lastModified: (/* @__PURE__ */ new Date()).toISOString(),
    lastModifier: modifier
  };
}
var NodeContentSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().optional(),
  summary: z.string().optional(),
  blocks: z.array(BlockSchema).optional()
});
var NousNodeSchema = z.object({
  id: z.string().regex(/^n_[a-zA-Z0-9_-]{12}$/),
  type: z.enum(NODE_TYPES),
  subtype: z.string().optional(),
  content: NodeContentSchema,
  embedding: EmbeddingFieldSchema.optional(),
  temporal: TemporalModelSchema,
  neural: NeuralPropertiesSchema,
  provenance: ProvenanceSchema,
  state: NodeStateSchema,
  versioning: NodeVersionSchema
});
var ConceptNodeSchema = NousNodeSchema.extend({
  type: z.literal("concept"),
  subtype: z.union([z.enum(CONCEPT_SUBTYPES), z.string().regex(/^custom:.+$/)])
});
var EpisodeMetadataSchema = z.object({
  duration_minutes: z.number().positive().optional(),
  concept_links: z.array(z.string()),
  archive_link: z.string().optional(),
  participants: z.array(z.string()).optional(),
  location: z.string().optional(),
  temporal_confidence: z.object({
    source: z.number().min(0).max(1),
    granularity: z.number().min(0).max(1),
    interpretation: z.number().min(0).max(1),
    combined: z.number().min(0).max(1)
  })
});
var EpisodeNodeSchema = NousNodeSchema.extend({
  type: z.literal("episode"),
  subtype: z.union([z.enum(EPISODE_SUBTYPES), z.string().regex(/^custom:.+$/)]),
  episode_specific: EpisodeMetadataSchema
});
var DocumentMetadataSchema = z.object({
  format: z.string(),
  page_count: z.number().int().positive().optional(),
  word_count: z.number().int().min(0),
  sections: z.array(z.string()),
  extraction_status: z.enum(["minimal", "structural", "partial", "complete"])
});
var DocumentNodeSchema = NousNodeSchema.extend({
  type: z.literal("document"),
  document_specific: DocumentMetadataSchema
});
var SectionMetadataSchema = z.object({
  document_id: z.string(),
  heading: z.string(),
  position: z.number().int().min(0),
  extracted: z.boolean(),
  concepts: z.array(z.string())
});
var SectionNodeSchema = NousNodeSchema.extend({
  type: z.literal("section"),
  section_specific: SectionMetadataSchema
});
var RawMetadataSchema = z.object({
  content_type: z.enum(["text", "transcript", "document", "image", "audio"]),
  original_format: z.string().optional(),
  file_size_bytes: z.number().int().positive().optional(),
  word_count: z.number().int().min(0).optional(),
  episode_link: z.string().optional(),
  extraction_status: z.enum(["pending", "processing", "complete", "failed"])
});
var RawNodeSchema = NousNodeSchema.extend({
  type: z.literal("raw"),
  subtype: z.enum(RAW_SUBTYPES),
  raw_specific: RawMetadataSchema
});
var NoteNodeSchema = NousNodeSchema.extend({
  type: z.literal("note")
});
var ChunkNodeSchema = NousNodeSchema.extend({
  type: z.literal("chunk")
});
var AnyNodeSchema = z.discriminatedUnion("type", [
  ConceptNodeSchema,
  EpisodeNodeSchema,
  DocumentNodeSchema,
  SectionNodeSchema,
  RawNodeSchema,
  NoteNodeSchema,
  ChunkNodeSchema
]);
function createNode(type, content, options = {}) {
  return {
    id: generateNodeId(),
    type,
    subtype: options.subtype,
    content,
    temporal: createTemporalModel(options.timezone),
    neural: createDefaultNeuralProperties(),
    provenance: {
      source: options.source ?? "manual",
      parent_id: options.parent_id,
      confidence: options.confidence ?? 1
    },
    state: {
      extraction_depth: "full",
      lifecycle: "working"
    },
    versioning: createInitialVersion(options.modifier ?? "user")
  };
}
function createConceptNode(title, body, subtype, options = {}) {
  const base = createNode("concept", { title, body }, { ...options, subtype });
  return base;
}
function createNoteNode(title, body, options = {}) {
  const base = createNode("note", { title, body }, options);
  return base;
}
function recordAccess(node) {
  return {
    ...node,
    neural: {
      ...node.neural,
      last_accessed: (/* @__PURE__ */ new Date()).toISOString(),
      access_count: node.neural.access_count + 1
    }
  };
}
function updateLifecycle(node, lifecycle) {
  return {
    ...node,
    state: {
      ...node.state,
      lifecycle
    }
  };
}
var EXTENDED_EDGE_TYPES = [
  // From storm-011
  "relates_to",
  "part_of",
  "mentioned_in",
  "causes",
  "precedes",
  "contradicts",
  "supersedes",
  "derived_from",
  "similar_to",
  // New in storm-031
  "same_entity",
  "user_linked",
  "caused_by",
  "mentioned_together",
  "temporal_adjacent",
  "temporal_continuation",
  "summarizes"
];
var EDGE_WEIGHTS = {
  // Identity / structural (highest)
  same_entity: 0.95,
  summarizes: 0.95,
  // User-created (high trust)
  user_linked: 0.9,
  // Semantic relationships
  part_of: 0.85,
  caused_by: 0.8,
  causes: 0.8,
  contradicts: 0.75,
  supersedes: 0.75,
  derived_from: 0.7,
  precedes: 0.65,
  mentioned_together: 0.6,
  mentioned_in: 0.55,
  relates_to: 0.5,
  similar_to: 0.45,
  // Temporal (lowest)
  temporal_adjacent: 0.4,
  temporal_continuation: 0.3
};
var EDGE_STATUSES = ["confirmed", "provisional"];
var EDGE_CREATION_SOURCES = [
  "extraction",
  "similarity",
  "user",
  "temporal",
  "coactivation",
  "compression"
];
var EXTRACTION_CONFIG = {
  confirmed_threshold: 0.7,
  provisional_threshold: 0.5,
  rejection_threshold: 0.5,
  provisional_weight_factor: 0.5,
  provisional_promotion_activations: 3,
  provisional_expiry_days: 30
};
var SIMILARITY_CONFIG = {
  creation_threshold: 0.85,
  edge_type: "similar_to",
  batch_frequency: "daily",
  max_edges_per_node: 10,
  exclude_same_cluster: false
};
var USER_EDGE_CONFIG = {
  default_strength: 0.9,
  min_strength: 0.5,
  max_strength: 1,
  default_type: "user_linked",
  allowed_types: [
    "user_linked",
    "relates_to",
    "part_of",
    "caused_by",
    "contradicts",
    "supersedes",
    "derived_from"
  ]
};
var TEMPORAL_CONFIG = {
  session_timeout_minutes: 30,
  edge_type: "temporal_adjacent",
  decay_constant: 30,
  max_gap_minutes: 120,
  min_strength: 0.2,
  continuation_max_gap_hours: 24,
  continuation_base_weight: 0.3,
  continuation_same_cluster_required: true,
  continuation_edge_type: "temporal_continuation"
};
var COACTIVATION_CONFIG = {
  strengthen_delta: 0.1,
  decay_delta: 0.02,
  min_weight: 0.1,
  max_weight: 1,
  engagement_threshold_seconds: 5,
  consecutive_ignores_before_decay: 3,
  max_coactivation_bonus: 0.3,
  new_edge_similarity_threshold: 0.5
};
var EDGE_DECAY_CONFIG = {
  decay_start_days: 30,
  decay_rate: 0.95,
  decay_period_days: 30,
  floor: 0.1
};
var COMPRESSION_DEFAULTS = {
  min_nodes_for_compression: 5,
  similarity_threshold: 0.75,
  max_nodes_per_summary: 20,
  restorable_days: 365,
  dormant_days_minimum: 60,
  importance_max: 0.3,
  strong_active_edges_max: 2,
  age_days_minimum: 30
};
var GRAPH_SIZE_THRESHOLDS = {
  small: { max: 500, min_nodes: 3 },
  medium: { max: 5e3, min_nodes: 5 },
  large: { max: Infinity, min_nodes: 10 }
};
var WEIGHT_BOUNDS = {
  min: 0.1,
  max: 1
};
var LEARNED_ADJUSTMENT_BOUNDS = {
  min: -0.3,
  max: 0.3
};
var EdgeWeightComponentsSchema = z.object({
  base_weight: z.number().min(0).max(1),
  learned_adjustment: z.number().min(LEARNED_ADJUSTMENT_BOUNDS.min).max(LEARNED_ADJUSTMENT_BOUNDS.max),
  coactivation_bonus: z.number().min(0).max(COACTIVATION_CONFIG.max_coactivation_bonus)
});
var EdgeStatusSchema = z.enum(EDGE_STATUSES);
var EdgeCreationSourceSchema = z.enum(EDGE_CREATION_SOURCES);
var ProvisionalEdgeStateSchema = z.object({
  created_at: z.string().datetime(),
  activation_count: z.number().int().min(0),
  expires_at: z.string().datetime()
});
var ExtractionEdgeResultSchema = z.object({
  weight: z.number().min(0).max(1),
  status: EdgeStatusSchema,
  components: EdgeWeightComponentsSchema
});
var SessionNodeSchema = z.object({
  id: z.string(),
  cluster_id: z.string(),
  accessed_at: z.string().datetime()
});
var SessionSchema = z.object({
  id: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  accessedNodes: z.array(SessionNodeSchema)
});
var TemporalEdgeResultSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(["temporal_adjacent", "temporal_continuation"]),
  weight: z.number().min(0).max(1),
  components: EdgeWeightComponentsSchema
});
var DecayResultSchema = z.object({
  decay_periods: z.number().int().min(0),
  decay_factor: z.number().min(0).max(1),
  previous_bonus: z.number().min(0),
  new_bonus: z.number().min(0),
  decay_applied: z.boolean()
});
var SummaryContentSchema = z.object({
  title: z.string().max(60),
  body: z.string(),
  preserved_entities: z.array(z.string()),
  key_facts: z.array(z.string()),
  temporal_span: z.string().nullable()
});
var CompressedEdgeRecordSchema = z.object({
  original_source: z.string(),
  target: z.string(),
  original_type: z.string(),
  original_weight: z.number().min(0).max(1)
});
var SummaryNodeSchema = z.object({
  id: z.string(),
  type: z.literal("summary"),
  content: SummaryContentSchema,
  compressed_from: z.array(z.string()),
  compressed_edges: z.array(CompressedEdgeRecordSchema),
  cluster_id: z.string(),
  created_at: z.string().datetime()
});
var NodeCompressionStateSchema = z.object({
  compressed_into: z.string().optional(),
  compressed_at: z.string().datetime().optional(),
  restorable_until: z.string().datetime().optional()
});
var EmbeddingFreshnessStateSchema = z.object({
  embedding_version: z.number().int().min(0),
  last_content_update: z.string().datetime(),
  last_embedding_update: z.string().datetime()
});
function daysBetween(start, end) {
  const startDate = typeof start === "string" ? new Date(start) : start;
  const endDate = typeof end === "string" ? new Date(end) : end;
  return Math.floor((endDate.getTime() - startDate.getTime()) / (1e3 * 60 * 60 * 24));
}
function minutesBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.abs(endDate.getTime() - startDate.getTime()) / (1e3 * 60);
}
function hoursBetween(start, end) {
  return minutesBetween(start, end) / 60;
}
function calculateEffectiveWeight(components) {
  const adjustedBase = components.base_weight * (1 + components.learned_adjustment);
  const rawValue = adjustedBase + components.coactivation_bonus;
  const clamped = Math.max(WEIGHT_BOUNDS.min, Math.min(WEIGHT_BOUNDS.max, rawValue));
  return {
    effective_weight: clamped,
    was_clamped: clamped !== rawValue,
    raw_value: rawValue
  };
}
function createWeightComponents(input) {
  return {
    base_weight: input.base_weight,
    learned_adjustment: input.learned_adjustment ?? 0,
    coactivation_bonus: input.coactivation_bonus ?? 0
  };
}
function applyLearningAdjustment(components, delta) {
  const newAdjustment = components.learned_adjustment + delta;
  const clamped = Math.max(
    LEARNED_ADJUSTMENT_BOUNDS.min,
    Math.min(LEARNED_ADJUSTMENT_BOUNDS.max, newAdjustment)
  );
  return {
    ...components,
    learned_adjustment: clamped
  };
}
function applyCoactivationBonus(components, delta) {
  const newBonus = components.coactivation_bonus + delta;
  const clamped = Math.max(0, Math.min(COACTIVATION_CONFIG.max_coactivation_bonus, newBonus));
  return {
    ...components,
    coactivation_bonus: clamped
  };
}
function decayCoactivationBonus(components, factor) {
  return {
    ...components,
    coactivation_bonus: Math.max(0, components.coactivation_bonus * factor)
  };
}
function calculateExtractionEdge(type, llmConfidence) {
  const baseWeight = EDGE_WEIGHTS[type] ?? 0.5;
  if (llmConfidence >= EXTRACTION_CONFIG.confirmed_threshold) {
    const weight = baseWeight * llmConfidence;
    return {
      weight,
      status: "confirmed",
      components: createWeightComponents({ base_weight: weight })
    };
  }
  if (llmConfidence >= EXTRACTION_CONFIG.provisional_threshold) {
    const weight = baseWeight * llmConfidence * EXTRACTION_CONFIG.provisional_weight_factor;
    return {
      weight,
      status: "provisional",
      components: createWeightComponents({ base_weight: weight })
    };
  }
  return null;
}
function createProvisionalState() {
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + EXTRACTION_CONFIG.provisional_expiry_days);
  return {
    created_at: now.toISOString(),
    activation_count: 0,
    expires_at: expiresAt.toISOString()
  };
}
function shouldPromoteProvisional(state) {
  return state.activation_count >= EXTRACTION_CONFIG.provisional_promotion_activations;
}
function shouldExpireProvisional(state) {
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(state.expires_at);
  return now > expiresAt && state.activation_count < EXTRACTION_CONFIG.provisional_promotion_activations;
}
function incrementProvisionalActivation(state) {
  return {
    ...state,
    activation_count: state.activation_count + 1
  };
}
function meetsSimilarityThreshold(similarity) {
  return similarity >= SIMILARITY_CONFIG.creation_threshold;
}
function isEmbeddingFresh(state) {
  const contentDate = new Date(state.last_content_update);
  const embeddingDate = new Date(state.last_embedding_update);
  return embeddingDate >= contentDate;
}
function calculateSimilarityWeight(cosineSimilarity3) {
  return cosineSimilarity3;
}
function calculateUserEdgeWeight(userStrength) {
  if (userStrength === void 0) {
    return USER_EDGE_CONFIG.default_strength;
  }
  return Math.max(
    USER_EDGE_CONFIG.min_strength,
    Math.min(USER_EDGE_CONFIG.max_strength, userStrength)
  );
}
function isAllowedUserEdgeType(type) {
  return USER_EDGE_CONFIG.allowed_types.includes(type);
}
function calculateTemporalWeight(minutesApart) {
  if (minutesApart > TEMPORAL_CONFIG.max_gap_minutes) {
    return null;
  }
  const rawWeight = Math.exp(-minutesApart / TEMPORAL_CONFIG.decay_constant);
  return Math.max(TEMPORAL_CONFIG.min_strength, rawWeight);
}
function createTemporalAdjacentEdge(nodeA, nodeB, minutesApart) {
  const weight = calculateTemporalWeight(minutesApart);
  if (weight === null) {
    return null;
  }
  return {
    source: nodeA,
    target: nodeB,
    type: "temporal_adjacent",
    weight,
    components: createWeightComponents({ base_weight: weight })
  };
}
function checkContinuationEligibility(currentSession, previousSession) {
  const gap = hoursBetween(previousSession.end, currentSession.start);
  if (gap > TEMPORAL_CONFIG.continuation_max_gap_hours) {
    return { should_create: false, overlapping_clusters: [], hours_between: gap };
  }
  const currentClusters = new Set(currentSession.accessedNodes.map((n) => n.cluster_id));
  const previousClusters = new Set(previousSession.accessedNodes.map((n) => n.cluster_id));
  const overlapping = [...currentClusters].filter((c) => previousClusters.has(c));
  return {
    should_create: overlapping.length > 0,
    overlapping_clusters: overlapping,
    hours_between: gap
  };
}
function detectContinuationEdges(currentSession, previousSession) {
  const eligibility = checkContinuationEligibility(currentSession, previousSession);
  if (!eligibility.should_create) {
    return [];
  }
  const edges = [];
  for (const clusterId of eligibility.overlapping_clusters) {
    const currentNodes = currentSession.accessedNodes.filter((n) => n.cluster_id === clusterId);
    const previousNodes = previousSession.accessedNodes.filter((n) => n.cluster_id === clusterId);
    for (const prev of previousNodes) {
      for (const curr of currentNodes) {
        if (prev.id !== curr.id) {
          edges.push({
            source: prev.id,
            target: curr.id,
            type: "temporal_continuation",
            weight: TEMPORAL_CONFIG.continuation_base_weight,
            components: createWeightComponents({
              base_weight: TEMPORAL_CONFIG.continuation_base_weight
            })
          });
        }
      }
    }
  }
  return edges;
}
function createSessionTemporalEdges(session) {
  const edges = [];
  const sortedNodes = [...session.accessedNodes].sort(
    (a, b) => new Date(a.accessed_at).getTime() - new Date(b.accessed_at).getTime()
  );
  for (let i = 0; i < sortedNodes.length - 1; i++) {
    const current = sortedNodes[i];
    const next = sortedNodes[i + 1];
    const gap = minutesBetween(current.accessed_at, next.accessed_at);
    const edge = createTemporalAdjacentEdge(current.id, next.id, gap);
    if (edge) {
      edges.push(edge);
    }
  }
  return edges;
}
function hasSessionEnded(lastAccessTime, currentTime) {
  const gap = minutesBetween(lastAccessTime, currentTime);
  return gap >= TEMPORAL_CONFIG.session_timeout_minutes;
}
function didUserEngage(viewDurationSeconds) {
  return viewDurationSeconds >= COACTIVATION_CONFIG.engagement_threshold_seconds;
}
function calculateStrengtheningDelta(currentWeight) {
  return COACTIVATION_CONFIG.strengthen_delta * (COACTIVATION_CONFIG.max_weight - currentWeight);
}
function updateCoActivationWeight(edge, userEngaged) {
  const { effective_weight: previousWeight } = calculateEffectiveWeight(edge.components);
  let newEdge = { ...edge };
  let action = "unchanged";
  let reason = "";
  if (userEngaged) {
    newEdge.consecutive_ignored = 0;
    const delta = calculateStrengtheningDelta(previousWeight);
    newEdge.components = applyCoactivationBonus(edge.components, delta);
    action = "strengthened";
    reason = `User engaged - added ${delta.toFixed(3)} to bonus`;
  } else {
    newEdge.consecutive_ignored = edge.consecutive_ignored + 1;
    if (newEdge.consecutive_ignored >= COACTIVATION_CONFIG.consecutive_ignores_before_decay) {
      newEdge.consecutive_ignored = 0;
      newEdge.components = applyCoactivationBonus(edge.components, -COACTIVATION_CONFIG.decay_delta);
      action = "decayed";
      reason = `${COACTIVATION_CONFIG.consecutive_ignores_before_decay}+ consecutive ignores - subtracted ${COACTIVATION_CONFIG.decay_delta} from bonus`;
    } else {
      reason = `Ignored (${newEdge.consecutive_ignored}/${COACTIVATION_CONFIG.consecutive_ignores_before_decay} before decay)`;
    }
  }
  newEdge.activation_count = edge.activation_count + 1;
  newEdge.neural = {
    ...edge.neural,
    co_activation_count: edge.neural.co_activation_count + 1,
    last_co_activation: (/* @__PURE__ */ new Date()).toISOString()
  };
  const { effective_weight: newWeight } = calculateEffectiveWeight(newEdge.components);
  return {
    edge: newEdge,
    action,
    previous_weight: previousWeight,
    new_weight: newWeight,
    reason
  };
}
function applyTimeBasedDecay(edge) {
  const daysSinceActivation = daysBetween(edge.neural.last_co_activation, /* @__PURE__ */ new Date());
  if (daysSinceActivation < EDGE_DECAY_CONFIG.decay_start_days) {
    return {
      decay_periods: 0,
      decay_factor: 1,
      previous_bonus: edge.components.coactivation_bonus,
      new_bonus: edge.components.coactivation_bonus,
      decay_applied: false
    };
  }
  const decayPeriods = Math.floor(
    (daysSinceActivation - EDGE_DECAY_CONFIG.decay_start_days) / EDGE_DECAY_CONFIG.decay_period_days
  );
  if (decayPeriods === 0) {
    return {
      decay_periods: 0,
      decay_factor: 1,
      previous_bonus: edge.components.coactivation_bonus,
      new_bonus: edge.components.coactivation_bonus,
      decay_applied: false
    };
  }
  const decayFactor = Math.pow(EDGE_DECAY_CONFIG.decay_rate, decayPeriods);
  const previousBonus = edge.components.coactivation_bonus;
  const newBonus = Math.max(0, previousBonus * decayFactor);
  return {
    decay_periods: decayPeriods,
    decay_factor: decayFactor,
    previous_bonus: previousBonus,
    new_bonus: newBonus,
    decay_applied: true
  };
}
function shouldConsiderNewEdge(similarity) {
  return similarity > COACTIVATION_CONFIG.new_edge_similarity_threshold;
}
function isEdgeDead(edge) {
  const { effective_weight } = calculateEffectiveWeight(edge.components);
  return effective_weight <= COACTIVATION_CONFIG.min_weight && edge.components.coactivation_bonus <= 0;
}
function getCompressionConfig(graphSize) {
  let minNodes;
  if (graphSize < GRAPH_SIZE_THRESHOLDS.small.max) {
    minNodes = GRAPH_SIZE_THRESHOLDS.small.min_nodes;
  } else if (graphSize < GRAPH_SIZE_THRESHOLDS.medium.max) {
    minNodes = GRAPH_SIZE_THRESHOLDS.medium.min_nodes;
  } else {
    minNodes = GRAPH_SIZE_THRESHOLDS.large.min_nodes;
  }
  return {
    never_compress: {
      is_pinned: true,
      is_starred: true,
      age_days_less_than: COMPRESSION_DEFAULTS.age_days_minimum
    },
    candidate_requirements: {
      dormant_days_minimum: COMPRESSION_DEFAULTS.dormant_days_minimum,
      importance_max: COMPRESSION_DEFAULTS.importance_max,
      strong_active_edges_max: COMPRESSION_DEFAULTS.strong_active_edges_max
    },
    clustering: {
      similarity_threshold: COMPRESSION_DEFAULTS.similarity_threshold,
      min_nodes_for_compression: minNodes,
      max_nodes_per_summary: COMPRESSION_DEFAULTS.max_nodes_per_summary
    },
    retention: {
      restorable_days: COMPRESSION_DEFAULTS.restorable_days
    }
  };
}
function isNeverCompress(node, config) {
  if (node.is_pinned && config.never_compress.is_pinned) {
    return true;
  }
  if (node.is_starred && config.never_compress.is_starred) {
    return true;
  }
  const ageDays = daysBetween(node.created_at, /* @__PURE__ */ new Date());
  if (ageDays < config.never_compress.age_days_less_than) {
    return true;
  }
  return false;
}
function meetsCompressionRequirements(node, strongActiveEdges, config) {
  if (node.lifecycle !== "dormant") {
    return false;
  }
  if (!node.dormant_since) {
    return false;
  }
  const dormantDays = daysBetween(node.dormant_since, /* @__PURE__ */ new Date());
  if (dormantDays < config.candidate_requirements.dormant_days_minimum) {
    return false;
  }
  if (node.importance_score > config.candidate_requirements.importance_max) {
    return false;
  }
  if (strongActiveEdges > config.candidate_requirements.strong_active_edges_max) {
    return false;
  }
  return true;
}
function createCompressionState(summaryId, restorableDays) {
  const now = /* @__PURE__ */ new Date();
  const restorableUntil = new Date(now);
  restorableUntil.setDate(restorableUntil.getDate() + restorableDays);
  return {
    compressed_into: summaryId,
    compressed_at: now.toISOString(),
    restorable_until: restorableUntil.toISOString()
  };
}
function isRestorable(state) {
  if (!state.restorable_until) {
    return false;
  }
  const expiry = new Date(state.restorable_until);
  const now = /* @__PURE__ */ new Date();
  return now < expiry;
}
function createEdgeRecord(sourceNodeId, targetNodeId, edgeType, weight) {
  return {
    original_source: sourceNodeId,
    target: targetNodeId,
    original_type: edgeType,
    original_weight: weight
  };
}
function calculateAggregatedWeight(records) {
  if (records.length === 0) {
    return null;
  }
  const maxWeight = Math.max(...records.map((r) => r.original_weight));
  return maxWeight >= 0.5 ? maxWeight : null;
}
function generateSummaryNodeId() {
  return "sum_" + nanoid(NANOID_LENGTH);
}
function createWeightedEdge(options) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const baseWeight = options.baseWeight ?? EDGE_WEIGHTS[options.type] ?? 0.5;
  return {
    id: EDGE_ID_PREFIX + nanoid(NANOID_LENGTH),
    source: options.source,
    target: options.target,
    type: options.type,
    status: options.status ?? "confirmed",
    strength: baseWeight,
    confidence: options.confidence ?? 1,
    neural: {
      co_activation_count: 0,
      last_co_activation: now,
      decay_factor: 1
    },
    provenance: {
      source_type: options.creationSource,
      created_at: now
    },
    components: createWeightComponents({ base_weight: baseWeight }),
    creation_source: options.creationSource,
    consecutive_ignored: 0,
    activation_count: 0
  };
}
function validateWeightComponents(components) {
  return EdgeWeightComponentsSchema.safeParse(components).success;
}
function validateProvisionalState(state) {
  return ProvisionalEdgeStateSchema.safeParse(state).success;
}
function validateSession(session) {
  return SessionSchema.safeParse(session).success;
}
function validateSummaryNode(node) {
  return SummaryNodeSchema.safeParse(node).success;
}
function validateCompressionState(state) {
  return NodeCompressionStateSchema.safeParse(state).success;
}
function validateEmbeddingFreshness(state) {
  return EmbeddingFreshnessStateSchema.safeParse(state).success;
}

// src/edges/index.ts
function generateEdgeId() {
  return EDGE_ID_PREFIX + nanoid(NANOID_LENGTH);
}
var EdgeNeuralPropertiesSchema = z.object({
  co_activation_count: z.number().int().min(0),
  last_co_activation: z.string().datetime(),
  decay_factor: z.number().min(0).max(1)
});
var EdgeProvenanceSchema = z.object({
  source_type: z.enum(SOURCE_TYPES),
  created_at: z.string().datetime(),
  extraction_confidence: z.number().min(0).max(1).optional()
});
var NousEdgeSchema = z.object({
  id: z.string().regex(/^e_[a-zA-Z0-9_-]{12}$/),
  source: z.string(),
  target: z.string(),
  type: z.enum(EDGE_TYPES),
  subtype: z.string().optional(),
  strength: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  neural: EdgeNeuralPropertiesSchema,
  provenance: EdgeProvenanceSchema
});
var EDGE_CREATION_RULES = {
  /** Rule 1: Co-mention - Entities mentioned in the same sentence */
  CO_MENTION: {
    type: "relates_to",
    defaultStrength: 0.5,
    description: "Entities in same sentence"
  },
  /** Rule 2: Explicit relation - "X causes Y" */
  EXPLICIT_CAUSAL: {
    type: "causes",
    defaultStrength: 0.8,
    description: "Explicit causal statement"
  },
  /** Rule 3: Containment - "X is part of Y" */
  EXPLICIT_CONTAINMENT: {
    type: "part_of",
    defaultStrength: 0.9,
    description: "Explicit containment"
  },
  /** Rule 4: Temporal sequence - Events in order */
  TEMPORAL_SEQUENCE: {
    type: "precedes",
    defaultStrength: 0.7,
    description: "Events in temporal order"
  },
  /** Rule 5: Extraction origin - Concept extracted from Episode */
  EXTRACTION_ORIGIN: {
    type: "mentioned_in",
    defaultStrength: 1,
    description: "Concept from episode"
  },
  /** Rule 6: Embedding similarity - cosine > 0.85 */
  EMBEDDING_SIMILARITY: {
    type: "similar_to",
    threshold: 0.85,
    description: "High semantic similarity"
  }
};
function createEdge(source, target, type, options = {}) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: generateEdgeId(),
    source,
    target,
    type,
    subtype: options.subtype,
    strength: options.strength ?? 0.5,
    confidence: options.confidence ?? 1,
    neural: {
      co_activation_count: 0,
      last_co_activation: now,
      decay_factor: 1
    },
    provenance: {
      source_type: options.sourceType ?? "manual",
      created_at: now,
      extraction_confidence: options.extractionConfidence
    }
  };
}
function createDefaultEdgeNeuralProperties() {
  return {
    co_activation_count: 0,
    last_co_activation: (/* @__PURE__ */ new Date()).toISOString(),
    decay_factor: 1
  };
}
function strengthenEdge(edge, amount = 0.1) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...edge,
    strength: Math.min(1, edge.strength + amount),
    neural: {
      ...edge.neural,
      co_activation_count: edge.neural.co_activation_count + 1,
      last_co_activation: now
    }
  };
}
function decayEdge(edge, decayRate = 0.05) {
  return {
    ...edge,
    neural: {
      ...edge.neural,
      decay_factor: Math.max(0, edge.neural.decay_factor - decayRate)
    }
  };
}
function reactivateEdge(edge) {
  return {
    ...edge,
    neural: {
      ...edge.neural,
      decay_factor: 1,
      last_co_activation: (/* @__PURE__ */ new Date()).toISOString()
    }
  };
}
function updateEdgeConfidence(edge, confidence) {
  return {
    ...edge,
    confidence: Math.max(0, Math.min(1, confidence))
  };
}
function edgeConnects(edge, nodeA, nodeB) {
  return edge.source === nodeA && edge.target === nodeB || edge.source === nodeB && edge.target === nodeA;
}
function getOtherNode(edge, nodeId) {
  if (edge.source === nodeId) return edge.target;
  if (edge.target === nodeId) return edge.source;
  return void 0;
}
function isEdgeDecayed(edge, threshold = 0.1) {
  return edge.neural.decay_factor < threshold;
}
function shouldPruneEdge(edge, maxAgeDays = 90, decayThreshold = 0.1) {
  const ageMs = Date.now() - new Date(edge.neural.last_co_activation).getTime();
  const ageDays = ageMs / (1e3 * 60 * 60 * 24);
  return ageDays > maxAgeDays && edge.neural.decay_factor < decayThreshold;
}
function filterEdgesByType(edges, type) {
  return edges.filter((edge) => edge.type === type);
}
function getEdgesForNode(edges, nodeId) {
  return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
}
function getOutgoingEdges(edges, nodeId) {
  return edges.filter((edge) => edge.source === nodeId);
}
function getIncomingEdges(edges, nodeId) {
  return edges.filter((edge) => edge.target === nodeId);
}
function sortEdgesByStrength(edges) {
  return [...edges].sort((a, b) => b.strength - a.strength);
}
function sortEdgesByCoActivation(edges) {
  return [...edges].sort(
    (a, b) => b.neural.co_activation_count - a.neural.co_activation_count
  );
}
function validateEdge(edge) {
  return NousEdgeSchema.safeParse(edge).success;
}
function parseEdge(data) {
  return NousEdgeSchema.parse(data);
}
function safeParseEdge(data) {
  const result = NousEdgeSchema.safeParse(data);
  return result.success ? result.data : null;
}
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
var STORAGE_LAYERS = ["semantic", "episode", "archive"];
var LAYER_ACCESS_SPEEDS = ["hot", "warm", "cold"];
var LayerCharacteristicsSchema = z.object({
  accessSpeed: z.enum(LAYER_ACCESS_SPEEDS),
  indexing: z.array(z.string()),
  retention: z.string()
});
var LayerConfigSchema = z.object({
  name: z.enum(STORAGE_LAYERS),
  description: z.string(),
  nodeTypes: z.array(z.enum(NODE_TYPES)),
  characteristics: LayerCharacteristicsSchema
});
var LAYER_CONFIGS = {
  semantic: {
    accessSpeed: "hot",
    indexing: ["vector", "graph", "fulltext"],
    retention: "permanent"
  },
  episode: {
    accessSpeed: "warm",
    indexing: ["temporal", "fulltext"],
    retention: "permanent"
  },
  archive: {
    accessSpeed: "cold",
    indexing: ["fulltext"],
    retention: "permanent"
  }
};
var SEMANTIC_LAYER_CONFIG = {
  name: "semantic",
  description: "Hot storage for entity graph, embeddings, and neural properties",
  nodeTypes: SEMANTIC_LAYER_TYPES,
  characteristics: LAYER_CONFIGS.semantic
};
var EPISODE_LAYER_CONFIG = {
  name: "episode",
  description: "Warm storage for time-indexed events with TPS metadata",
  nodeTypes: EPISODE_LAYER_TYPES,
  characteristics: LAYER_CONFIGS.episode
};
var ARCHIVE_LAYER_CONFIG = {
  name: "archive",
  description: "Cold storage for full verbatim documents",
  nodeTypes: ARCHIVE_LAYER_TYPES,
  characteristics: LAYER_CONFIGS.archive
};
var ALL_LAYER_CONFIGS = {
  semantic: SEMANTIC_LAYER_CONFIG,
  episode: EPISODE_LAYER_CONFIG,
  archive: ARCHIVE_LAYER_CONFIG
};
function getStorageLayer(nodeType) {
  if (SEMANTIC_LAYER_TYPES.includes(nodeType)) {
    return "semantic";
  }
  if (EPISODE_LAYER_TYPES.includes(nodeType)) {
    return "episode";
  }
  if (ARCHIVE_LAYER_TYPES.includes(nodeType)) {
    return "archive";
  }
  return "semantic";
}
function getLayerConfig(layer) {
  return ALL_LAYER_CONFIGS[layer];
}
function isSemanticLayerType(nodeType) {
  return SEMANTIC_LAYER_TYPES.includes(nodeType);
}
function isEpisodeLayerType(nodeType) {
  return EPISODE_LAYER_TYPES.includes(nodeType);
}
function isArchiveLayerType(nodeType) {
  return ARCHIVE_LAYER_TYPES.includes(nodeType);
}
function getNodeTypesForLayer(layer) {
  switch (layer) {
    case "semantic":
      return SEMANTIC_LAYER_TYPES;
    case "episode":
      return EPISODE_LAYER_TYPES;
    case "archive":
      return ARCHIVE_LAYER_TYPES;
  }
}
function getLayerAccessSpeed(layer) {
  return LAYER_CONFIGS[layer].accessSpeed;
}
var LayerStatsSchema = z.object({
  layer: z.enum(STORAGE_LAYERS),
  nodeCount: z.number().int().min(0),
  totalSizeBytes: z.number().int().min(0),
  lastAccessed: z.string().datetime()
});
function createEmptyLayerStats(layer) {
  return {
    layer,
    nodeCount: 0,
    totalSizeBytes: 0,
    lastAccessed: (/* @__PURE__ */ new Date()).toISOString()
  };
}
var LAYER_PRIORITY = ["semantic", "episode", "archive"];
function getLayersByPriority(includeLayers = LAYER_PRIORITY) {
  return LAYER_PRIORITY.filter((layer) => includeLayers.includes(layer));
}
function isValidStorageLayer(value) {
  return typeof value === "string" && STORAGE_LAYERS.includes(value);
}
function validateLayerStats(stats) {
  return LayerStatsSchema.safeParse(stats).success;
}
var EXPRESSION_TYPES = [
  "explicit_absolute",
  "explicit_relative",
  "fuzzy_period",
  "duration",
  "none"
];
var TIME_SOURCES = [
  "user_explicit",
  "calendar_sync",
  "file_timestamp",
  "content_extraction",
  "context_inference",
  "unknown"
];
var SOURCE_CONFIDENCE = {
  user_explicit: 1,
  calendar_sync: 0.95,
  file_timestamp: 0.9,
  content_extraction: 0.7,
  context_inference: 0.5,
  unknown: 0.3
};
var GRANULARITY_CONFIDENCE = {
  minute: 1,
  hour: 0.9,
  day: 0.8,
  week: 0.6,
  month: 0.4,
  year: 0.2
};
var INTERPRETATION_CONFIDENCE = {
  explicit_absolute: 1,
  explicit_relative: 0.95,
  fuzzy_period: 0.6,
  duration: 0.8,
  none: 1
};
var ConfidenceFactorsSchema = z.object({
  source: z.number().min(0).max(1),
  granularity: z.number().min(0).max(1),
  interpretation: z.number().min(0).max(1)
});
function computeConfidenceScore(factors) {
  return factors.source * factors.granularity * factors.interpretation;
}
function getSourceConfidence(source) {
  return SOURCE_CONFIDENCE[source];
}
function getGranularityConfidence(granularity) {
  return GRANULARITY_CONFIDENCE[granularity];
}
function getInterpretationConfidence(type) {
  return INTERPRETATION_CONFIDENCE[type];
}
var TPSInputSchema = z.object({
  query: z.string().min(1),
  referenceTimestamp: z.string().datetime(),
  userTimezone: z.string().min(1)
});
var TemporalConstraintSchema = z.object({
  rangeStart: z.string().datetime(),
  rangeEnd: z.string().datetime(),
  rangeConfidence: z.number().min(0).max(1),
  expressionType: z.enum(EXPRESSION_TYPES),
  originalExpression: z.string()
});
var TPSOutputSchema = z.object({
  temporalConstraint: TemporalConstraintSchema.nullable(),
  entitiesExtracted: z.array(z.string()),
  parsingConfidence: z.number().min(0).max(1)
});
var SEASONS = {
  spring: { startMonth: 3, startDay: 1, endMonth: 5, endDay: 31 },
  summer: { startMonth: 6, startDay: 1, endMonth: 8, endDay: 31 },
  fall: { startMonth: 9, startDay: 1, endMonth: 11, endDay: 30 },
  autumn: { startMonth: 9, startDay: 1, endMonth: 11, endDay: 30 },
  winter: { startMonth: 12, startDay: 1, endMonth: 2, endDay: 28 }
};
function detectSeason(query) {
  const lowerQuery = query.toLowerCase();
  for (const season of Object.keys(SEASONS)) {
    if (lowerQuery.includes(season)) {
      return season;
    }
  }
  return null;
}
function getSeasonRange(season, year) {
  const range = SEASONS[season.toLowerCase()];
  if (!range) {
    return null;
  }
  if (season.toLowerCase() === "winter") {
    return {
      start: new Date(Date.UTC(year, range.startMonth - 1, range.startDay)),
      end: new Date(Date.UTC(year + 1, range.endMonth - 1, range.endDay))
    };
  }
  return {
    start: new Date(Date.UTC(year, range.startMonth - 1, range.startDay)),
    end: new Date(Date.UTC(year, range.endMonth - 1, range.endDay))
  };
}
var RELATIVE_PATTERNS = [
  {
    pattern: /yesterday/i,
    calculate: (_, ref) => {
      const start = new Date(ref);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  },
  {
    pattern: /today/i,
    calculate: (_, ref) => {
      const start = new Date(ref);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  },
  {
    pattern: /last\s+week/i,
    calculate: (_, ref) => {
      const end = new Date(ref);
      end.setDate(end.getDate() - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  },
  {
    pattern: /last\s+month/i,
    calculate: (_, ref) => {
      const start = new Date(ref);
      start.setMonth(start.getMonth() - 1, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  },
  {
    pattern: /(\d+)\s+days?\s+ago/i,
    calculate: (match, ref) => {
      const days = parseInt(match[1] ?? "1", 10);
      const start = new Date(ref);
      start.setDate(start.getDate() - days);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  },
  {
    pattern: /(\d+)\s+weeks?\s+ago/i,
    calculate: (match, ref) => {
      const weeks = parseInt(match[1] ?? "1", 10);
      const end = new Date(ref);
      end.setDate(end.getDate() - weeks * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  },
  {
    pattern: /(\d+)\s+months?\s+ago/i,
    calculate: (match, ref) => {
      const months = parseInt(match[1] ?? "1", 10);
      const start = new Date(ref);
      start.setMonth(start.getMonth() - months, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  }
];
var MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11
};
function parseRelativeTime(query, referenceDate) {
  for (const { pattern, calculate } of RELATIVE_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      const { start, end } = calculate(match, referenceDate);
      return { start, end, expression: match[0] };
    }
  }
  return null;
}
function parseAbsoluteMonth(query, referenceDate) {
  const monthPattern = /(?:in\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?/i;
  const match = query.match(monthPattern);
  if (match && match[1]) {
    const monthName = match[1].toLowerCase();
    const month = MONTHS[monthName];
    if (month === void 0) {
      return null;
    }
    const year = match[2] ? parseInt(match[2], 10) : void 0;
    let targetYear = year ?? referenceDate.getFullYear();
    if (!year) {
      const refMonth = referenceDate.getMonth();
      if (month > refMonth) {
        targetYear -= 1;
      }
    }
    const start = new Date(Date.UTC(targetYear, month, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(targetYear, month + 1, 0, 23, 59, 59, 999));
    return { start, end, expression: match[0] };
  }
  return null;
}
function parseFuzzyTime(query, referenceDate) {
  const lowerQuery = query.toLowerCase();
  if (lowerQuery.includes("recently")) {
    const end = new Date(referenceDate);
    const start = new Date(referenceDate);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression: "recently", confidence: 0.7 };
  }
  if (lowerQuery.includes("a while back") || lowerQuery.includes("a while ago")) {
    const end = new Date(referenceDate);
    end.setMonth(end.getMonth() - 1);
    const start = new Date(referenceDate);
    start.setMonth(start.getMonth() - 6);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression: "a while back", confidence: 0.4 };
  }
  if (lowerQuery.includes("a few months ago")) {
    const end = new Date(referenceDate);
    end.setMonth(end.getMonth() - 2);
    const start = new Date(referenceDate);
    start.setMonth(start.getMonth() - 4);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression: "a few months ago", confidence: 0.5 };
  }
  const season = detectSeason(query);
  if (season) {
    let targetYear = referenceDate.getFullYear();
    const range = getSeasonRange(season, targetYear);
    if (range) {
      if (range.end > referenceDate) {
        const lastYearRange = getSeasonRange(season, targetYear - 1);
        if (lastYearRange) {
          return {
            start: lastYearRange.start,
            end: lastYearRange.end,
            expression: season,
            confidence: 0.6
          };
        }
      }
      return { start: range.start, end: range.end, expression: season, confidence: 0.6 };
    }
  }
  return null;
}
function parseTemporalExpression(input) {
  const referenceDate = new Date(input.referenceTimestamp);
  const query = input.query;
  const relative = parseRelativeTime(query, referenceDate);
  if (relative) {
    return {
      temporalConstraint: {
        rangeStart: relative.start.toISOString(),
        rangeEnd: relative.end.toISOString(),
        rangeConfidence: 0.95,
        expressionType: "explicit_relative",
        originalExpression: relative.expression
      },
      entitiesExtracted: extractNonTemporalEntities(query, relative.expression),
      parsingConfidence: 0.95
    };
  }
  const absolute = parseAbsoluteMonth(query, referenceDate);
  if (absolute) {
    return {
      temporalConstraint: {
        rangeStart: absolute.start.toISOString(),
        rangeEnd: absolute.end.toISOString(),
        rangeConfidence: 1,
        expressionType: "explicit_absolute",
        originalExpression: absolute.expression
      },
      entitiesExtracted: extractNonTemporalEntities(query, absolute.expression),
      parsingConfidence: 1
    };
  }
  const fuzzy = parseFuzzyTime(query, referenceDate);
  if (fuzzy) {
    return {
      temporalConstraint: {
        rangeStart: fuzzy.start.toISOString(),
        rangeEnd: fuzzy.end.toISOString(),
        rangeConfidence: fuzzy.confidence,
        expressionType: "fuzzy_period",
        originalExpression: fuzzy.expression
      },
      entitiesExtracted: extractNonTemporalEntities(query, fuzzy.expression),
      parsingConfidence: fuzzy.confidence
    };
  }
  return {
    temporalConstraint: null,
    entitiesExtracted: extractNonTemporalEntities(query, ""),
    parsingConfidence: 1
  };
}
function extractNonTemporalEntities(query, temporalPart) {
  let remaining = query.replace(temporalPart, "").trim();
  const stopWords = [
    "what",
    "when",
    "where",
    "who",
    "how",
    "did",
    "do",
    "does",
    "the",
    "a",
    "an",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "about",
    "i",
    "me",
    "my",
    "we",
    "our",
    "learn",
    "learned",
    "teach",
    "taught"
  ];
  const words = remaining.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((word) => word.length > 2 && !stopWords.includes(word));
  return [...new Set(words)];
}
var QUERY_STEP_BUDGETS = {
  temporalParsing: 5,
  entityExtraction: 3,
  episodeFilter: 10,
  semanticFilter: 30,
  confidenceAggregate: 2,
  resultAssembly: 3,
  phase2Handoff: 2
};
var PHASE_1_BUDGET_MS = 55;
function isWithinBudget(latencyMs) {
  return latencyMs <= PHASE_1_BUDGET_MS;
}
function validateTPSInput(input) {
  return TPSInputSchema.safeParse(input).success;
}
function validateTPSOutput(output) {
  return TPSOutputSchema.safeParse(output).success;
}
function validateTemporalConstraint(constraint) {
  return TemporalConstraintSchema.safeParse(constraint).success;
}
var EPISODE_ID_PREFIX = "ep_";
function generateEpisodeId() {
  return EPISODE_ID_PREFIX + nanoid(NANOID_LENGTH);
}
var EPISODE_TYPES = EPISODE_SUBTYPES;
var EpisodeTemporalMetadataSchema = z.object({
  timestampUtc: z.string().datetime(),
  timezoneOriginal: z.string().min(1),
  granularity: z.enum(["minute", "hour", "day", "week", "month", "year"]),
  confidence: ConfidenceFactorsSchema,
  durationMinutes: z.number().int().positive().optional(),
  endTimestampUtc: z.string().datetime().optional()
});
var EpisodeSchema = z.object({
  id: z.string().regex(new RegExp(`^${EPISODE_ID_PREFIX}[a-zA-Z0-9_-]{${NANOID_LENGTH}}$`)),
  type: z.union([z.enum(EPISODE_TYPES), z.string().regex(/^custom:.+$/)]),
  summary: z.string().min(1),
  conceptLinks: z.array(z.string()),
  archiveLink: z.string().nullable(),
  temporal: EpisodeTemporalMetadataSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
function createEpisode(type, summary, options = {}) {
  const now = /* @__PURE__ */ new Date();
  const timestamp = options.timestamp ?? now;
  const granularity = options.granularity ?? "day";
  const timeSource = options.timeSource ?? "unknown";
  const confidence = {
    source: getSourceConfidence(timeSource),
    granularity: getGranularityConfidence(granularity),
    interpretation: 1
    // Direct creation, no parsing needed
  };
  const temporal = {
    timestampUtc: timestamp.toISOString(),
    timezoneOriginal: options.timezone ?? "UTC",
    granularity,
    confidence,
    durationMinutes: options.durationMinutes,
    endTimestampUtc: options.durationMinutes ? new Date(timestamp.getTime() + options.durationMinutes * 60 * 1e3).toISOString() : void 0
  };
  return {
    id: generateEpisodeId(),
    type,
    summary,
    conceptLinks: options.conceptLinks ?? [],
    archiveLink: options.archiveLink ?? null,
    temporal,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}
function createEpisodeTemporalMetadata(timestamp, options = {}) {
  const granularity = options.granularity ?? "day";
  const timeSource = options.timeSource ?? "unknown";
  return {
    timestampUtc: timestamp.toISOString(),
    timezoneOriginal: options.timezone ?? "UTC",
    granularity,
    confidence: {
      source: getSourceConfidence(timeSource),
      granularity: getGranularityConfidence(granularity),
      interpretation: 1
    }
  };
}
function addConceptLink(episode, conceptId) {
  if (episode.conceptLinks.includes(conceptId)) {
    return episode;
  }
  return {
    ...episode,
    conceptLinks: [...episode.conceptLinks, conceptId],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function removeConceptLink(episode, conceptId) {
  if (!episode.conceptLinks.includes(conceptId)) {
    return episode;
  }
  return {
    ...episode,
    conceptLinks: episode.conceptLinks.filter((id) => id !== conceptId),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function setArchiveLink(episode, archiveId) {
  return {
    ...episode,
    archiveLink: archiveId,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function updateEpisodeSummary(episode, summary) {
  return {
    ...episode,
    summary,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function calculateEpisodeConfidence(episode) {
  return computeConfidenceScore(episode.temporal.confidence);
}
function hasHighConfidence(episode, threshold = 0.7) {
  return calculateEpisodeConfidence(episode) >= threshold;
}
function isEpisodeInRange(episode, rangeStart, rangeEnd) {
  const episodeTime = new Date(episode.temporal.timestampUtc).getTime();
  const start = new Date(rangeStart).getTime();
  const end = new Date(rangeEnd).getTime();
  return episodeTime >= start && episodeTime <= end;
}
function filterEpisodesByTimeRange(episodes, rangeStart, rangeEnd) {
  return episodes.filter((ep) => isEpisodeInRange(ep, rangeStart, rangeEnd));
}
function filterEpisodesByType(episodes, type) {
  return episodes.filter((ep) => ep.type === type);
}
function sortEpisodesByTime(episodes) {
  return [...episodes].sort((a, b) => {
    const timeA = new Date(a.temporal.timestampUtc).getTime();
    const timeB = new Date(b.temporal.timestampUtc).getTime();
    return timeB - timeA;
  });
}
function sortEpisodesByConfidence(episodes) {
  return [...episodes].sort((a, b) => {
    return calculateEpisodeConfidence(b) - calculateEpisodeConfidence(a);
  });
}
function getEpisodesWithConcept(episodes, conceptId) {
  return episodes.filter((ep) => ep.conceptLinks.includes(conceptId));
}
function getMostRecentEpisodes(episodes, limit = 10) {
  return sortEpisodesByTime(episodes).slice(0, limit);
}
var MatchFactorsSchema = z.object({
  temporalMatch: z.number().min(0).max(1),
  episodeConfidence: z.number().min(0).max(1),
  semanticMatch: z.number().min(0).max(1)
});
function calculateMatchScore(factors) {
  return factors.temporalMatch * factors.episodeConfidence * factors.semanticMatch;
}
var EpisodeMatchSchema = z.object({
  episode: EpisodeSchema,
  confidence: z.number().min(0).max(1),
  matchFactors: MatchFactorsSchema
});
function buildEpisodeMatch(episode, factors) {
  return {
    episode,
    confidence: calculateMatchScore(factors),
    matchFactors: factors
  };
}
function validateEpisode(episode) {
  return EpisodeSchema.safeParse(episode).success;
}
function parseEpisode(data) {
  return EpisodeSchema.parse(data);
}
function safeParseEpisode(data) {
  const result = EpisodeSchema.safeParse(data);
  return result.success ? result.data : null;
}
var PRIVACY_TIERS = ["standard", "private"];
var PrivacyTierSchema = z.enum(PRIVACY_TIERS);
function isPrivacyTier(value) {
  return PRIVACY_TIERS.includes(value);
}
var AUTH_PROVIDERS = ["clerk"];
var AuthProviderSchema = z.enum(AUTH_PROVIDERS);
var AUTH_METHODS = ["apple", "google", "email_password"];
var AuthMethodSchema = z.enum(AUTH_METHODS);
var PLATFORMS = ["ios", "android", "macos", "windows"];
var PlatformSchema = z.enum(PLATFORMS);
function isPlatform(value) {
  return PLATFORMS.includes(value);
}
var OFFLINE_STATES = [
  "online",
  "short_offline",
  "medium_offline",
  "long_offline",
  "reauth_required"
];
var OfflineStateSchema = z.enum(OFFLINE_STATES);
function isOfflineState(value) {
  return OFFLINE_STATES.includes(value);
}
var OFFLINE_THRESHOLDS = {
  /** <24h since last online: JWT still valid, full functionality */
  short_offline: 24,
  /** <7d (168h) since last online: JWT expired, read-only + queued writes */
  medium_offline: 168,
  /** >7d: refresh token expired, local data only */
  long_offline: Infinity
};
var CONSENT_SCOPES = [
  "per_message",
  "per_conversation",
  "time_based",
  "topic_based"
];
var ConsentScopeSchema = z.enum(CONSENT_SCOPES);
function isConsentScope(value) {
  return CONSENT_SCOPES.includes(value);
}
var DEFAULT_CONSENT_SCOPE = "per_conversation";
var CONVERSATION_TIMEOUT_MINUTES = 30;
var TOPIC_SIMILARITY_THRESHOLD = 0.85;
var CONSENT_DURATIONS = ["1h", "24h", "7d"];
var ConsentDurationSchema = z.enum(CONSENT_DURATIONS);
var CONSENT_REVOCATION_SCOPES = [
  "this_conversation",
  "all_active",
  "everything"
];
var ConsentRevocationScopeSchema = z.enum(CONSENT_REVOCATION_SCOPES);
var ENCRYPTION_ALGORITHM = "AES-256-GCM";
var KEY_DERIVATION_FUNCTION = "HKDF-SHA256";
var MASTER_KEY_LENGTH_BITS = 256;
var NONCE_LENGTH_BYTES = 12;
var KEY_PURPOSES = ["content", "embedding", "metadata"];
var KeyPurposeSchema = z.enum(KEY_PURPOSES);
var DERIVATION_INFO_STRINGS = {
  content: "nous-content",
  embedding: "nous-embedding",
  metadata: "nous-metadata"
};
var ROTATION_BATCH_SIZE = 100;
var ROTATION_PAUSE_BETWEEN_BATCHES_MS = 500;
var ROTATION_MAX_BATCHES_PER_MINUTE = 60;
var ROTATION_MIN_BATTERY_LEVEL = 20;
var DEPRECATED_KEY_RETENTION_DAYS = 30;
var ROTATION_VERIFICATION_SAMPLE_PERCENT = 5;
var KEY_VERSION_STATUSES = ["active", "rotating", "deprecated", "expired"];
var KeyVersionStatusSchema = z.enum(KEY_VERSION_STATUSES);
function isKeyVersionStatus(value) {
  return KEY_VERSION_STATUSES.includes(value);
}
var KEY_ROTATION_TRIGGERS = [
  "passkey_change",
  "scheduled",
  "security_incident",
  "recovery_used"
];
var KeyRotationTriggerSchema = z.enum(KEY_ROTATION_TRIGGERS);
var SCHEDULED_ROTATION_MONTHS = 12;
var ROTATION_TIMING_ESTIMATES = {
  "1k": { reencrypt_seconds: 30, background_minutes: 2 },
  "10k": { reencrypt_seconds: 300, background_minutes: 15 },
  "50k": { reencrypt_seconds: 1500, background_minutes: 60 }
};
var ROTATION_PHASES = ["generating", "reencrypting", "verifying", "completing"];
var RotationPhaseSchema = z.enum(ROTATION_PHASES);
var ROTATION_EVENT_TYPES = [
  "rotation:started",
  "rotation:progress",
  "rotation:paused",
  "rotation:resumed",
  "rotation:completed",
  "rotation:failed"
];
var RotationEventTypeSchema = z.enum(ROTATION_EVENT_TYPES);
var RECOVERY_WORD_COUNT = 24;
var RECOVERY_VERIFICATION_WORD_COUNT = 3;
var RECOVERY_VERIFICATION_ATTEMPT_LIMIT = 3;
var GRACE_PERIOD_DAYS = 7;
var RECOVERY_REMINDER_DAYS = [30, 180];
var RECOVERY_METHODS = [
  "multi_device",
  "recovery_code",
  "grace_period"
];
var RecoveryMethodSchema = z.enum(RECOVERY_METHODS);
var RECOVERY_REMINDER_TYPES = ["initial", "periodic", "new_device"];
var RecoveryReminderTypeSchema = z.enum(RECOVERY_REMINDER_TYPES);
var ACCESS_TOKEN_EXPIRY_MINUTES = 15;
var REFRESH_TOKEN_EXPIRY_DAYS = 30;
var BYOK_MAX_DECRYPTIONS_PER_MINUTE = 5;
var BYOK_LOCKOUT_AFTER_FAILURES = 10;
var BYOK_LOCKOUT_DURATION_MINUTES = 30;
var PRIVATE_TIER_NODE_LIMITS = {
  mobile: 5e4,
  desktop: 1e5
};
var CLIENT_SEARCH_PERFORMANCE = {
  /** Time to decrypt per 1K nodes (milliseconds) */
  decrypt_time_ms_per_1k: 100,
  /** Time to build HNSW index per 1K nodes (milliseconds) */
  index_build_time_ms_per_1k: 200,
  /** Search latency by node count (milliseconds) */
  search_latency_ms: {
    "10k": 20,
    "50k": 40,
    "100k": 60
  },
  /** Memory usage per 10K nodes (megabytes) */
  memory_mb_per_10k: 130
};
var BRUTE_FORCE_LOCKOUT_ATTEMPTS = 5;
var BRUTE_FORCE_LOCKOUT_MINUTES = 15;
var CAPTCHA_AFTER_FAILURES = 3;
var ECCN_CLASSIFICATION = "5D992";
var EXPORT_COMPLIANCE_STATUSES = [
  "exempt",
  "requires_documentation",
  "excluded"
];
var ExportComplianceStatusSchema = z.enum(EXPORT_COMPLIANCE_STATUSES);
var DESKTOP_AUTH_STEPS = [
  "idle",
  "browser_opened",
  "waiting_callback",
  "processing_token",
  "complete",
  "error"
];
var DesktopAuthStepSchema = z.enum(DESKTOP_AUTH_STEPS);
var TIER_MIGRATION_STATUSES = [
  "pending",
  "key_setup",
  "migrating",
  "verifying",
  "complete",
  "failed"
];
var TierMigrationStatusSchema = z.enum(TIER_MIGRATION_STATUSES);
var MIGRATION_RATE_MS_PER_1K_NODES = 6e4;
var CONSENT_EVENT_TYPES = [
  "consent:requested",
  "consent:granted",
  "consent:declined",
  "consent:revoked",
  "consent:expired"
];
var ConsentEventTypeSchema = z.enum(CONSENT_EVENT_TYPES);
var PASSKEY_PLATFORMS = ["apple", "google", "microsoft"];
var PasskeyPlatformSchema = z.enum(PASSKEY_PLATFORMS);
var PASSKEY_SYNC_MECHANISMS = {
  apple: "icloud_keychain",
  google: "google_password_manager",
  microsoft: "microsoft_entra"
};
var RECOVERY_SETUP_STEPS = [
  "generating",
  "displaying",
  "verifying",
  "complete"
];
var RecoverySetupStepSchema = z.enum(RECOVERY_SETUP_STEPS);
var API_KEY_TYPES = ["platform", "byok"];
var ApiKeyTypeSchema = z.enum(API_KEY_TYPES);
var API_CALL_FLOWS = ["proxied", "direct"];
var ApiCallFlowSchema = z.enum(API_CALL_FLOWS);
var BYOK_ENCRYPTION_METHODS = ["server_side", "user_key"];
var BYOKEncryptionMethodSchema = z.enum(BYOK_ENCRYPTION_METHODS);
var MFA_OPTIONS = ["totp", "sms", "passkey"];
var MfaOptionSchema = z.enum(MFA_OPTIONS);
var SIGN_IN_IMPLEMENTATIONS = ["native", "rest_api", "oauth", "clerk_ui", "clerk_web"];
var SignInImplementationSchema = z.enum(SIGN_IN_IMPLEMENTATIONS);
var DEEP_LINK_SCHEME = "nous";
var AUTH_CALLBACK_PATH = "/auth/callback";
var OFFLINE_FUNCTIONALITY_LEVELS = [
  "full",
  "read_write_queued",
  "read_only",
  "local_only"
];
var OfflineFunctionalitySchema = z.enum(OFFLINE_FUNCTIONALITY_LEVELS);
var OFFLINE_SYNC_BEHAVIORS = [
  "realtime",
  "queued",
  "paused",
  "none"
];
var OfflineSyncBehaviorSchema = z.enum(OFFLINE_SYNC_BEHAVIORS);
var QUEUEABLE_TABLES = ["nodes", "edges", "episodes"];
var QUEUE_OPERATION_TYPES = ["create", "update", "delete"];
var DECLINE_ACTIONS = [
  "general_questions",
  "writing_assistance",
  "brainstorming",
  "allow_this_question",
  "end_conversation"
];
var LLM_PROVIDERS = ["openai", "anthropic", "google"];
var LLMProviderSchema = z.enum(LLM_PROVIDERS);
var REENCRYPTION_PRIORITY_ORDER = [
  "recently_accessed",
  "frequently_accessed",
  "oldest_first"
];

// src/db/config.ts
var DB_DEFAULTS = {
  /** OpenAI embedding dimensions */
  vectorDimensions: 1536,
  /** DiskANN index parameter */
  maxNeighbors: 50,
  /** Default sync batch size */
  syncBatchSize: 100,
  /** Current schema version */
  schemaVersion: 2,
  /** Default sync interval in milliseconds */
  syncIntervalMs: 6e4,
  /** Default connection timeout */
  connectionTimeoutMs: 1e4,
  /** Max retry attempts */
  maxRetries: 3,
  /** Base retry delay */
  retryDelayMs: 1e3
};
var DATABASE_MODES = ["local", "cloud", "replica"];
var SYNC_MODES = ["auto", "manual", "disabled"];
var TursoConfigSchema = z.object({
  url: z.string().min(1),
  authToken: z.string().optional(),
  syncUrl: z.string().url().optional(),
  syncIntervalMs: z.number().int().positive().optional(),
  encryptionKey: z.string().optional()
});
var DatabaseOptionsSchema = z.object({
  mode: z.enum(DATABASE_MODES),
  enableWAL: z.boolean(),
  connectionTimeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0),
  retryDelayMs: z.number().int().positive(),
  vectorDimensions: z.number().int().positive(),
  maxNeighbors: z.number().int().positive()
});
function createDefaultDatabaseOptions() {
  return {
    mode: "replica",
    enableWAL: true,
    connectionTimeoutMs: DB_DEFAULTS.connectionTimeoutMs,
    maxRetries: DB_DEFAULTS.maxRetries,
    retryDelayMs: DB_DEFAULTS.retryDelayMs,
    vectorDimensions: DB_DEFAULTS.vectorDimensions,
    maxNeighbors: DB_DEFAULTS.maxNeighbors
  };
}
var SyncConfigSchema = z.object({
  mode: z.enum(SYNC_MODES),
  minIntervalMs: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  wifiOnly: z.boolean(),
  chargingOnly: z.boolean(),
  backgroundSync: z.boolean(),
  maxRetries: z.number().int().min(0)
});
function createDefaultSyncConfig() {
  return {
    mode: "auto",
    minIntervalMs: DB_DEFAULTS.syncIntervalMs,
    batchSize: DB_DEFAULTS.syncBatchSize,
    wifiOnly: false,
    chargingOnly: false,
    backgroundSync: true,
    maxRetries: DB_DEFAULTS.maxRetries
  };
}
var TenantConfigSchema = z.object({
  tenantId: z.string().min(1),
  privacyTier: z.enum(PRIVACY_TIERS),
  databaseUrl: z.string().min(1),
  authToken: z.string().min(1),
  storageQuotaBytes: z.number().int().positive(),
  createdAt: z.string().datetime()
});
var InfrastructureConfigSchema = z.object({
  turso: TursoConfigSchema,
  database: DatabaseOptionsSchema,
  sync: SyncConfigSchema
});
function createDefaultInfrastructureConfig(tursoConfig) {
  return {
    turso: tursoConfig,
    database: createDefaultDatabaseOptions(),
    sync: createDefaultSyncConfig()
  };
}
function validateTursoConfig(config) {
  return TursoConfigSchema.safeParse(config).success;
}
function validateDatabaseOptions(options) {
  return DatabaseOptionsSchema.safeParse(options).success;
}
function validateSyncConfig(config) {
  return SyncConfigSchema.safeParse(config).success;
}
function validateInfrastructureConfig(config) {
  return InfrastructureConfigSchema.safeParse(config).success;
}

// src/db/schema.ts
var NODES_TABLE = `
CREATE TABLE IF NOT EXISTS nodes (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,

  -- Content (JSON encoded)
  content_title TEXT,
  content_summary TEXT,
  content_body TEXT,
  content_blocks TEXT,  -- JSON array of Block[]

  -- Vector embedding for semantic search
  embedding F32_BLOB(${DB_DEFAULTS.vectorDimensions}),

  -- Neural properties
  neural_stability REAL DEFAULT 0.5,
  neural_retrievability REAL DEFAULT 0.5,
  neural_access_count INTEGER DEFAULT 0,
  neural_last_accessed TEXT,

  -- State
  state_lifecycle TEXT DEFAULT 'active',
  state_extraction_depth TEXT DEFAULT 'core',

  -- Provenance
  provenance_source TEXT,
  provenance_created_at TEXT NOT NULL,
  provenance_confidence REAL DEFAULT 1.0,

  -- Storage layer
  layer TEXT NOT NULL DEFAULT 'semantic',

  -- Sync metadata
  version INTEGER DEFAULT 1,
  last_modified TEXT NOT NULL,
  last_modifier TEXT,
  sync_status TEXT DEFAULT 'synced',

  -- E2E encryption (for private tier)
  encrypted_payload TEXT,
  encryption_tier TEXT DEFAULT 'standard',

  -- Indexes on created_at for temporal queries
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var NODES_INDEXES = `
-- Vector similarity search index (DiskANN)
CREATE INDEX IF NOT EXISTS idx_nodes_embedding
ON nodes (libsql_vector_idx(embedding, 'metric=cosine', 'max_neighbors=${DB_DEFAULTS.maxNeighbors}'));

-- Type and subtype for filtering
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes (type);
CREATE INDEX IF NOT EXISTS idx_nodes_subtype ON nodes (subtype);

-- Layer routing
CREATE INDEX IF NOT EXISTS idx_nodes_layer ON nodes (layer);

-- Temporal queries
CREATE INDEX IF NOT EXISTS idx_nodes_created_at ON nodes (created_at);
CREATE INDEX IF NOT EXISTS idx_nodes_last_modified ON nodes (last_modified);

-- Sync status
CREATE INDEX IF NOT EXISTS idx_nodes_sync_status ON nodes (sync_status);

-- Neural properties for retrieval scoring
CREATE INDEX IF NOT EXISTS idx_nodes_stability ON nodes (neural_stability);
CREATE INDEX IF NOT EXISTS idx_nodes_retrievability ON nodes (neural_retrievability);
`;
var EDGES_TABLE = `
CREATE TABLE IF NOT EXISTS edges (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,

  -- Relationship
  source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,

  -- Neural properties
  neural_weight REAL DEFAULT 1.0,
  neural_stability REAL DEFAULT 0.5,
  neural_last_activated TEXT,

  -- Metadata
  bidirectional INTEGER DEFAULT 0,

  -- Sync
  version INTEGER DEFAULT 1,
  last_modified TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var EDGES_INDEXES = `
-- Efficient traversal
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges (source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges (target_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges (type);

-- Bidirectional lookup
CREATE INDEX IF NOT EXISTS idx_edges_bidirectional ON edges (source_id, target_id);

-- Weight for relevance
CREATE INDEX IF NOT EXISTS idx_edges_weight ON edges (neural_weight);
`;
var EPISODES_TABLE = `
CREATE TABLE IF NOT EXISTS episodes (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,

  -- Content
  content TEXT NOT NULL,
  summary TEXT,

  -- Temporal bounds
  start_time TEXT NOT NULL,
  end_time TEXT,

  -- TPS Confidence Factors
  tps_temporal_confidence REAL DEFAULT 0.5,
  tps_parsing_method TEXT,
  tps_source_reliability REAL DEFAULT 0.5,

  -- References to nodes created from this episode
  node_refs TEXT,  -- JSON array of node IDs

  -- Source context
  source_type TEXT,
  source_id TEXT,

  -- Sync
  version INTEGER DEFAULT 1,
  last_modified TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var EPISODES_INDEXES = `
-- Temporal range queries
CREATE INDEX IF NOT EXISTS idx_episodes_start_time ON episodes (start_time);
CREATE INDEX IF NOT EXISTS idx_episodes_end_time ON episodes (end_time);

-- Source lookup
CREATE INDEX IF NOT EXISTS idx_episodes_source ON episodes (source_type, source_id);
`;
var SYNC_METADATA_TABLE = `
CREATE TABLE IF NOT EXISTS sync_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var USER_SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var EDIT_HISTORY_TABLE = `
CREATE TABLE IF NOT EXISTS edit_history (
  id TEXT PRIMARY KEY NOT NULL,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,  -- 'create' | 'update' | 'delete'
  before_state TEXT,  -- JSON snapshot before edit
  after_state TEXT,   -- JSON snapshot after edit
  editor_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var EDIT_HISTORY_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_edit_history_node ON edit_history (node_id);
CREATE INDEX IF NOT EXISTS idx_edit_history_created ON edit_history (created_at);
`;
var LOCAL_CACHE_TABLE = `
CREATE TABLE IF NOT EXISTS local_cache (
  node_id TEXT PRIMARY KEY NOT NULL,
  cached_at TEXT NOT NULL,
  last_accessed TEXT NOT NULL,
  access_count INTEGER DEFAULT 1,
  size_bytes INTEGER NOT NULL
);
`;
var LOCAL_CACHE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_local_cache_last_accessed ON local_cache (last_accessed);
CREATE INDEX IF NOT EXISTS idx_local_cache_access_count ON local_cache (access_count);
`;
var SCHEMA_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);
`;
var FULL_SCHEMA = [
  NODES_TABLE,
  NODES_INDEXES,
  EDGES_TABLE,
  EDGES_INDEXES,
  EPISODES_TABLE,
  EPISODES_INDEXES,
  SYNC_METADATA_TABLE,
  USER_SETTINGS_TABLE,
  EDIT_HISTORY_TABLE,
  EDIT_HISTORY_INDEXES,
  LOCAL_CACHE_TABLE,
  LOCAL_CACHE_INDEXES,
  SCHEMA_VERSION_TABLE
];
var QUERIES = {
  /**
   * Vector similarity search query.
   * Uses cosine distance via DiskANN index.
   */
  vectorSearch: `
    SELECT
      id,
      type,
      content_title,
      content_summary,
      vector_distance_cos(embedding, ?) as distance
    FROM nodes
    WHERE embedding IS NOT NULL
      AND layer = ?
    ORDER BY distance ASC
    LIMIT ?
  `,
  /**
   * Get node by ID.
   */
  getNodeById: `
    SELECT * FROM nodes WHERE id = ?
  `,
  /**
   * Get edges for a node (both directions).
   */
  getEdgesForNode: `
    SELECT * FROM edges
    WHERE source_id = ? OR target_id = ?
  `,
  /**
   * Get outgoing edges from a node.
   */
  getOutgoingEdges: `
    SELECT * FROM edges WHERE source_id = ?
  `,
  /**
   * Get incoming edges to a node.
   */
  getIncomingEdges: `
    SELECT * FROM edges WHERE target_id = ?
  `,
  /**
   * Get episodes in time range.
   */
  getEpisodesInRange: `
    SELECT * FROM episodes
    WHERE start_time >= ? AND (end_time IS NULL OR end_time <= ?)
    ORDER BY start_time ASC
  `,
  /**
   * Get nodes with sync conflicts.
   */
  getSyncConflicts: `
    SELECT * FROM nodes WHERE sync_status = 'conflict'
  `,
  /**
   * Get unsynced changes.
   */
  getUnsyncedChanges: `
    SELECT * FROM nodes WHERE sync_status = 'pending'
  `,
  /**
   * Insert new node.
   */
  insertNode: `
    INSERT INTO nodes (
      id, type, subtype,
      content_title, content_summary, content_body, content_blocks,
      embedding,
      neural_stability, neural_retrievability, neural_access_count,
      state_lifecycle, state_extraction_depth,
      provenance_source, provenance_created_at, provenance_confidence,
      layer, version, last_modified, last_modifier
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  /**
   * Insert new episode.
   */
  insertEpisode: `
    INSERT INTO episodes (
      id, content, summary,
      start_time, end_time,
      tps_temporal_confidence, tps_parsing_method, tps_source_reliability,
      node_refs, source_type, source_id,
      version, last_modified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  /**
   * Update node sync status.
   */
  updateSyncStatus: `
    UPDATE nodes SET sync_status = ?, last_modified = ? WHERE id = ?
  `,
  /**
   * Get schema version.
   */
  getSchemaVersion: `
    SELECT MAX(version) as version FROM schema_version
  `,
  /**
   * Insert schema version.
   */
  insertSchemaVersion: `
    INSERT INTO schema_version (version, description) VALUES (?, ?)
  `
};
function getTableStatements() {
  return [
    NODES_TABLE,
    EDGES_TABLE,
    EPISODES_TABLE,
    SYNC_METADATA_TABLE,
    USER_SETTINGS_TABLE,
    EDIT_HISTORY_TABLE,
    LOCAL_CACHE_TABLE,
    SCHEMA_VERSION_TABLE
  ];
}
function getIndexStatements() {
  return [
    NODES_INDEXES,
    EDGES_INDEXES,
    EPISODES_INDEXES,
    EDIT_HISTORY_INDEXES,
    LOCAL_CACHE_INDEXES
  ];
}
function getDropStatements() {
  return [
    "DROP TABLE IF EXISTS edit_history",
    "DROP TABLE IF EXISTS local_cache",
    "DROP TABLE IF EXISTS edges",
    "DROP TABLE IF EXISTS episodes",
    "DROP TABLE IF EXISTS nodes",
    "DROP TABLE IF EXISTS sync_metadata",
    "DROP TABLE IF EXISTS user_settings",
    "DROP TABLE IF EXISTS schema_version"
  ];
}
var QueryResultSchema = z.object({
  rows: z.array(z.record(z.unknown())),
  rowsAffected: z.number().int().min(0),
  lastInsertRowid: z.bigint().optional()
});
var VectorSearchOptionsSchema = z.object({
  embedding: z.instanceof(Float32Array),
  limit: z.number().int().positive().max(1e3),
  minScore: z.number().min(0).max(1).optional(),
  layer: z.enum(["semantic", "episode", "archive"]).optional(),
  filters: z.record(z.unknown()).optional(),
  includeDistance: z.boolean().optional()
});
function createRowTransformer(transform) {
  return transform;
}
var DB_ERROR_CODES = [
  "CONNECTION_FAILED",
  "QUERY_FAILED",
  "TRANSACTION_FAILED",
  "SYNC_FAILED",
  "MIGRATION_FAILED",
  "TIMEOUT",
  "CONFLICT"
];
var DatabaseError = class extends Error {
  constructor(code, message, cause) {
    super(message);
    this.code = code;
    this.cause = cause;
    this.name = "DatabaseError";
  }
};
function validateVectorSearchOptions(options) {
  return VectorSearchOptionsSchema.safeParse(options).success;
}

// src/db/turso-adapter.ts
function transformTursoResult(tursoResult, transformer) {
  return {
    rows: transformer ? tursoResult.rows.map(transformer) : tursoResult.rows,
    rowsAffected: tursoResult.rowsAffected,
    lastInsertRowid: tursoResult.lastInsertRowid
  };
}
function buildVectorSearchQuery(options) {
  const params = [options.embedding];
  const conditions = ["embedding IS NOT NULL"];
  if (options.layer) {
    conditions.push("layer = ?");
    params.push(options.layer);
  }
  if (options.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      if (value !== void 0) {
        conditions.push(`${key} = ?`);
        params.push(value);
      }
    }
  }
  params.push(options.limit);
  const sql = `
    SELECT
      id,
      type,
      content_title,
      content_summary,
      vector_distance_cos(embedding, ?) as distance
    FROM nodes
    WHERE ${conditions.join(" AND ")}
    ORDER BY distance ASC
    LIMIT ?
  `;
  return [sql.trim(), params];
}
function transformVectorSearchResult(row) {
  const distance = row["distance"];
  return {
    nodeId: row["id"],
    type: row["type"],
    title: row["content_title"],
    summary: row["content_summary"],
    distance,
    score: 1 - distance / 2
    // Convert distance to similarity score
  };
}
function calculateSyncStats(startTime, framesTotal, framesSynced, bytesTransferred) {
  return {
    framesTotal,
    framesSynced,
    bytesTransferred,
    durationMs: Date.now() - startTime
  };
}
function createSuccessSyncResult(stats) {
  return {
    success: true,
    framesSynced: stats.framesSynced,
    currentFrame: stats.framesTotal,
    durationMs: stats.durationMs,
    conflictsDetected: 0,
    conflictsAutoResolved: 0
  };
}
function createFailedSyncResult(error, durationMs) {
  return {
    success: false,
    framesSynced: 0,
    currentFrame: 0,
    durationMs,
    error,
    conflictsDetected: 0,
    conflictsAutoResolved: 0
  };
}
function parseDatabaseUrl(url) {
  if (url.startsWith("file:")) {
    return "local";
  }
  if (url.startsWith("libsql://") || url.startsWith("https://")) {
    return "cloud";
  }
  return "replica";
}
function isValidTursoUrl(url) {
  try {
    if (url.startsWith("file:")) {
      return true;
    }
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
var DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1e3,
  maxDelayMs: 3e4
};
function calculateBackoffDelay(attempt, config = DEFAULT_RETRY_CONFIG) {
  const delay = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelayMs);
}
async function retryWithBackoff(operation, config = DEFAULT_RETRY_CONFIG) {
  let lastError;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < config.maxRetries) {
        const delay = calculateBackoffDelay(attempt, config);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
function toFloat32Array(embedding) {
  return new Float32Array(embedding);
}
function fromFloat32Array(buffer) {
  return Array.from(buffer);
}
function validateEmbeddingDimensions(embedding, expectedDimensions) {
  return embedding.length === expectedDimensions;
}
function getLayerForQuery(layer) {
  return layer ?? "semantic";
}
var SYNC_STATUSES = [
  "idle",
  "syncing",
  "paused",
  "error",
  "offline"
];
var SyncStateSchema = z.object({
  status: z.enum(SYNC_STATUSES),
  lastSyncAt: z.string().datetime().nullable(),
  lastAttemptAt: z.string().datetime().nullable(),
  pendingChanges: z.number().int().min(0),
  unresolvedConflicts: z.number().int().min(0),
  progress: z.number().min(0).max(100),
  errorMessage: z.string().nullable(),
  failedAttempts: z.number().int().min(0),
  nextSyncAt: z.string().datetime().nullable()
});
function createInitialSyncState() {
  return {
    status: "idle",
    lastSyncAt: null,
    lastAttemptAt: null,
    pendingChanges: 0,
    unresolvedConflicts: 0,
    progress: 0,
    errorMessage: null,
    failedAttempts: 0,
    nextSyncAt: null
  };
}
var SYNC_EVENT_TYPES = [
  "sync_started",
  "sync_progress",
  "sync_completed",
  "sync_failed",
  "conflict_detected",
  "conflict_resolved",
  "offline",
  "online"
];
var CONFLICT_RESOLUTION_CHOICES = [
  "keep_local",
  "keep_cloud",
  "keep_both",
  "merge"
];
var SyncManagerOptionsSchema = z.object({
  minIntervalMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0),
  retryDelayMs: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  autoSync: z.boolean(),
  wifiOnly: z.boolean(),
  chargingOnly: z.boolean(),
  backgroundSync: z.boolean()
});
function createDefaultSyncManagerOptions() {
  return {
    minIntervalMs: 6e4,
    // 1 minute
    maxRetries: 3,
    retryDelayMs: 1e3,
    batchSize: 100,
    autoSync: true,
    wifiOnly: false,
    chargingOnly: false,
    backgroundSync: true
  };
}
var SyncLockSchema = z.object({
  deviceId: z.string().min(1),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime()
});
var DEFAULT_LOCK_DURATION_SECONDS = 30;
function createSyncLock(deviceId, durationSeconds = DEFAULT_LOCK_DURATION_SECONDS) {
  const now = /* @__PURE__ */ new Date();
  const expires = new Date(now.getTime() + durationSeconds * 1e3);
  return {
    deviceId,
    acquiredAt: now.toISOString(),
    expiresAt: expires.toISOString()
  };
}
function isSyncLockValid(lock) {
  return new Date(lock.expiresAt).getTime() > Date.now();
}
function isSyncLockExpired(lock) {
  return !isSyncLockValid(lock);
}
function validateSyncState(state) {
  return SyncStateSchema.safeParse(state).success;
}
function validateSyncManagerOptions(options) {
  return SyncManagerOptionsSchema.safeParse(options).success;
}
function validateSyncLock(lock) {
  return SyncLockSchema.safeParse(lock).success;
}
var CONFLICT_STRENGTHS = ["weak", "strong"];
var FIELD_CATEGORIES = [
  "content",
  // Main content (body, title)
  "metadata",
  // Access counts, timestamps
  "neural",
  // Neural properties
  "structural",
  // Type, lifecycle
  "versioning"
  // Version numbers
];
var FIELD_CATEGORY_MAP = {
  // Content fields - strong conflicts
  content_title: "content",
  content_body: "content",
  content_summary: "content",
  content_blocks: "content",
  // Metadata fields - weak conflicts, merge additively
  neural_access_count: "metadata",
  neural_last_accessed: "metadata",
  // Neural fields - weak conflicts, take max
  neural_stability: "neural",
  neural_retrievability: "neural",
  // Structural fields - strong conflicts
  type: "structural",
  subtype: "structural",
  state_lifecycle: "structural",
  state_extraction_depth: "structural",
  // Versioning - handled specially
  version: "versioning",
  last_modified: "versioning",
  last_modifier: "versioning"
};
var DetectedConflictSchema = z.object({
  nodeId: z.string().min(1),
  strength: z.enum(CONFLICT_STRENGTHS),
  localVersion: z.number().int().positive(),
  cloudVersion: z.number().int().positive(),
  baseVersion: z.number().int().positive(),
  localModifiedAt: z.string().datetime(),
  cloudModifiedAt: z.string().datetime(),
  fieldsInConflict: z.array(z.string()),
  conflictCategories: z.array(z.enum(FIELD_CATEGORIES)),
  canAutoResolve: z.boolean(),
  suggestedResolution: z.any().optional()
});
function getFieldCategory(fieldName) {
  return FIELD_CATEGORY_MAP[fieldName] ?? "content";
}
function getFieldCategories(fieldNames) {
  const categories = new Set(fieldNames.map(getFieldCategory));
  return Array.from(categories);
}
function classifyConflictStrength(localChanges, cloudChanges) {
  const overlap = localChanges.filter((f) => cloudChanges.includes(f));
  if (overlap.length === 0) {
    return "weak";
  }
  const overlapCategories = overlap.map(getFieldCategory);
  const hasNonMetadataOverlap = overlapCategories.some(
    (cat) => cat !== "metadata" && cat !== "neural"
  );
  if (hasNonMetadataOverlap) {
    return "strong";
  }
  return "weak";
}
function canAutoResolveConflict(conflict) {
  if (conflict.strength === "strong") {
    return false;
  }
  const hasContentConflict = conflict.conflictCategories.some(
    (cat) => cat === "content" || cat === "structural"
  );
  return !hasContentConflict;
}
var RESOLUTION_ACTIONS = [
  "keep_local",
  "keep_cloud",
  "keep_both",
  "merge_fields",
  "custom"
];
var ConflictResolutionSchema = z.object({
  action: z.enum(RESOLUTION_ACTIONS),
  fieldResolutions: z.record(z.enum(["local", "cloud"])).optional(),
  resolvedVersion: z.number().int().positive(),
  resolvedAt: z.string().datetime(),
  resolvedBy: z.enum(["user", "auto"]),
  notes: z.string().optional()
});
var MERGE_STRATEGIES = [
  "take_local",
  "take_cloud",
  "take_latest",
  "take_max",
  "take_min",
  "sum",
  "concatenate",
  "user_choice"
];
var FIELD_MERGE_STRATEGIES = {
  // Content - user must choose
  content_title: "user_choice",
  content_body: "user_choice",
  content_summary: "user_choice",
  content_blocks: "user_choice",
  // Metadata - automatic merge
  neural_access_count: "sum",
  neural_last_accessed: "take_latest",
  // Neural - take max (higher stability/retrievability preserved)
  neural_stability: "take_max",
  neural_retrievability: "take_max",
  // Structural - user must choose
  type: "user_choice",
  subtype: "user_choice",
  state_lifecycle: "take_latest",
  state_extraction_depth: "user_choice",
  // Provenance
  provenance_confidence: "take_max"
};
function getMergeStrategy(fieldName) {
  return FIELD_MERGE_STRATEGIES[fieldName] ?? "user_choice";
}
function applyMergeStrategy(strategy, localValue, cloudValue, localTimestamp, cloudTimestamp) {
  switch (strategy) {
    case "take_local":
      return { value: localValue, source: "local" };
    case "take_cloud":
      return { value: cloudValue, source: "cloud" };
    case "take_latest":
      if (new Date(localTimestamp) >= new Date(cloudTimestamp)) {
        return { value: localValue, source: "local" };
      }
      return { value: cloudValue, source: "cloud" };
    case "take_max":
      if (typeof localValue === "number" && typeof cloudValue === "number") {
        return localValue >= cloudValue ? { value: localValue, source: "local" } : { value: cloudValue, source: "cloud" };
      }
      return { value: localValue, source: "local" };
    case "take_min":
      if (typeof localValue === "number" && typeof cloudValue === "number") {
        return localValue <= cloudValue ? { value: localValue, source: "local" } : { value: cloudValue, source: "cloud" };
      }
      return { value: localValue, source: "local" };
    case "sum":
      if (typeof localValue === "number" && typeof cloudValue === "number") {
        return { value: Math.max(localValue, cloudValue), source: "merged" };
      }
      return { value: localValue, source: "local" };
    case "concatenate":
      if (Array.isArray(localValue) && Array.isArray(cloudValue)) {
        const merged = [...localValue];
        for (const item of cloudValue) {
          const itemWithId = item;
          if (!merged.some(
            (m) => m.id === itemWithId.id
          )) {
            merged.push(item);
          }
        }
        return { value: merged, source: "merged" };
      }
      return { value: localValue, source: "local" };
    case "user_choice":
    default:
      throw new Error(`Field requires user choice: ${strategy}`);
  }
}
function attemptAutoMerge(localData, cloudData, fieldsInConflict, localTimestamp, cloudTimestamp, baseVersion) {
  const mergedFields = [];
  const unmergeableFields = [];
  for (const field of fieldsInConflict) {
    const strategy = getMergeStrategy(field);
    if (strategy === "user_choice") {
      unmergeableFields.push(field);
      continue;
    }
    try {
      const result = applyMergeStrategy(
        strategy,
        localData[field],
        cloudData[field],
        localTimestamp,
        cloudTimestamp
      );
      mergedFields.push({
        fieldName: field,
        strategy,
        resolvedValue: result.value,
        source: result.source
      });
    } catch {
      unmergeableFields.push(field);
    }
  }
  return {
    success: unmergeableFields.length === 0,
    mergedFields,
    unmergeableFields,
    resultVersion: baseVersion + 1
  };
}
function validateDetectedConflict(conflict) {
  return DetectedConflictSchema.safeParse(conflict).success;
}
function validateConflictResolution(resolution) {
  return ConflictResolutionSchema.safeParse(resolution).success;
}
var HEALTH_STATUSES = ["healthy", "warning", "error"];
var HEALTH_THRESHOLDS = {
  /** Max time since last sync before warning (seconds) */
  syncWarningSeconds: 3600,
  // 1 hour
  /** Max time since last sync before error (seconds) */
  syncErrorSeconds: 86400,
  // 24 hours
  /** Max pending changes before warning */
  pendingWarningCount: 10,
  /** Max sync errors in 24h before error status */
  errorThreshold24h: 5,
  /** Max conflicts before warning */
  conflictWarningCount: 1
};
var HealthMetricsSchema = z.object({
  lastSuccessfulSync: z.number().nullable(),
  syncErrors24h: z.number().int().min(0),
  pendingChanges: z.number().int().min(0),
  unresolvedConflicts: z.number().int().min(0),
  databaseSizeBytes: z.number().int().min(0),
  nodeCount: z.number().int().min(0),
  edgeCount: z.number().int().min(0),
  appVersion: z.string(),
  updatedAt: z.number()
});
function createEmptyHealthMetrics(appVersion) {
  return {
    lastSuccessfulSync: null,
    syncErrors24h: 0,
    pendingChanges: 0,
    unresolvedConflicts: 0,
    databaseSizeBytes: 0,
    nodeCount: 0,
    edgeCount: 0,
    appVersion,
    updatedAt: Date.now()
  };
}
var HealthAssessmentSchema = z.object({
  status: z.enum(HEALTH_STATUSES),
  label: z.string(),
  message: z.string(),
  checks: z.array(z.any()),
  issues: z.array(z.string()),
  recommendations: z.array(z.string()),
  assessedAt: z.string().datetime()
});
function checkSyncRecency(metrics) {
  if (metrics.lastSuccessfulSync === null) {
    return {
      name: "sync_recency",
      status: "warning",
      message: "Never synced"
    };
  }
  const secondsSinceSync = (Date.now() - metrics.lastSuccessfulSync) / 1e3;
  if (secondsSinceSync > HEALTH_THRESHOLDS.syncErrorSeconds) {
    return {
      name: "sync_recency",
      status: "error",
      message: "Last sync over 24 hours ago",
      value: secondsSinceSync,
      threshold: HEALTH_THRESHOLDS.syncErrorSeconds
    };
  }
  if (secondsSinceSync > HEALTH_THRESHOLDS.syncWarningSeconds) {
    return {
      name: "sync_recency",
      status: "warning",
      message: "Last sync over 1 hour ago",
      value: secondsSinceSync,
      threshold: HEALTH_THRESHOLDS.syncWarningSeconds
    };
  }
  return {
    name: "sync_recency",
    status: "healthy",
    message: "Recently synced",
    value: secondsSinceSync
  };
}
function checkSyncErrors(metrics) {
  if (metrics.syncErrors24h >= HEALTH_THRESHOLDS.errorThreshold24h) {
    return {
      name: "sync_errors",
      status: "error",
      message: `${metrics.syncErrors24h} sync errors in 24h`,
      value: metrics.syncErrors24h,
      threshold: HEALTH_THRESHOLDS.errorThreshold24h
    };
  }
  if (metrics.syncErrors24h > 0) {
    return {
      name: "sync_errors",
      status: "warning",
      message: `${metrics.syncErrors24h} sync error${metrics.syncErrors24h > 1 ? "s" : ""} in 24h`,
      value: metrics.syncErrors24h
    };
  }
  return {
    name: "sync_errors",
    status: "healthy",
    message: "No sync errors",
    value: 0
  };
}
function checkPendingChanges(metrics) {
  if (metrics.pendingChanges > HEALTH_THRESHOLDS.pendingWarningCount) {
    return {
      name: "pending_changes",
      status: "warning",
      message: `${metrics.pendingChanges} changes pending sync`,
      value: metrics.pendingChanges,
      threshold: HEALTH_THRESHOLDS.pendingWarningCount
    };
  }
  return {
    name: "pending_changes",
    status: "healthy",
    message: metrics.pendingChanges > 0 ? `${metrics.pendingChanges} changes pending` : "All synced",
    value: metrics.pendingChanges
  };
}
function checkConflicts(metrics) {
  if (metrics.unresolvedConflicts >= HEALTH_THRESHOLDS.conflictWarningCount) {
    return {
      name: "conflicts",
      status: "warning",
      message: `${metrics.unresolvedConflicts} unresolved conflict${metrics.unresolvedConflicts > 1 ? "s" : ""}`,
      value: metrics.unresolvedConflicts,
      threshold: HEALTH_THRESHOLDS.conflictWarningCount
    };
  }
  return {
    name: "conflicts",
    status: "healthy",
    message: "No conflicts",
    value: 0
  };
}
function assessHealth(metrics) {
  const checks = [];
  const issues = [];
  const recommendations = [];
  const syncCheck = checkSyncRecency(metrics);
  checks.push(syncCheck);
  if (syncCheck.status !== "healthy") {
    issues.push(syncCheck.message);
    recommendations.push(
      "Check your internet connection and try syncing manually."
    );
  }
  const errorCheck = checkSyncErrors(metrics);
  checks.push(errorCheck);
  if (errorCheck.status !== "healthy") {
    issues.push(errorCheck.message);
    recommendations.push(
      "Review sync error logs. You may need to resolve conflicts."
    );
  }
  const pendingCheck = checkPendingChanges(metrics);
  checks.push(pendingCheck);
  if (pendingCheck.status !== "healthy") {
    issues.push(pendingCheck.message);
    recommendations.push("Connect to sync your pending changes.");
  }
  const conflictCheck = checkConflicts(metrics);
  checks.push(conflictCheck);
  if (conflictCheck.status !== "healthy") {
    issues.push(conflictCheck.message);
    recommendations.push("Review and resolve sync conflicts.");
  }
  const hasError = checks.some((c) => c.status === "error");
  const hasWarning = checks.some((c) => c.status === "warning");
  let status;
  let label;
  let message;
  if (hasError) {
    status = "error";
    label = "Sync issue";
    message = `${issues.length} issue${issues.length > 1 ? "s" : ""} detected`;
  } else if (hasWarning) {
    status = "warning";
    label = "Sync delayed";
    message = "Some items may not be synced";
  } else {
    status = "healthy";
    label = "Everything OK";
    message = "All systems operational";
  }
  return {
    status,
    label,
    message,
    checks,
    issues,
    recommendations,
    assessedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function generateDebugReport(metrics, deviceInfo, syncLogs, dbStats) {
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    metrics,
    assessment: assessHealth(metrics),
    device: deviceInfo,
    recentSyncLogs: syncLogs.slice(0, 20),
    // Last 20 entries
    databaseStats: dbStats
  };
}
function validateHealthMetrics(metrics) {
  return HealthMetricsSchema.safeParse(metrics).success;
}
function validateHealthAssessment(assessment) {
  return HealthAssessmentSchema.safeParse(assessment).success;
}
var NSE_PLATFORMS = ["ios", "android", "mac", "win", "web"];
var NSEPlatformSchema = z.enum(NSE_PLATFORMS);
function isNSEPlatform(value) {
  return NSE_PLATFORMS.includes(value);
}
var NODE_SYNC_STATUSES = ["synced", "pending", "conflict"];
var NodeSyncStatusSchema = z.enum(NODE_SYNC_STATUSES);
function isNodeSyncStatus(value) {
  return NODE_SYNC_STATUSES.includes(value);
}
var VERSION_VECTOR_INACTIVE_KEY = "_inactive";
var VECTOR_COMPACTION_THRESHOLD = 10;
var DEVICE_INACTIVE_DAYS = 90;
var VERSION_COMPARISON_RESULTS = ["a_dominates", "b_dominates", "concurrent", "equal"];
var VersionComparisonSchema = z.enum(VERSION_COMPARISON_RESULTS);
function isVersionComparison(value) {
  return VERSION_COMPARISON_RESULTS.includes(value);
}
var NSE_SYNC_LOCK_TIMEOUT_SECONDS = 30;
var NSE_SYNC_BATCH_SIZE = 100;
var UI_YIELD_DELAY_MS = 50;
var CONFLICT_HISTORY_RETENTION_DAYS = 30;
var BANNER_DISMISS_COOLDOWN_MS = 864e5;
var NOTIFICATION_TIERS = ["badge", "banner", "modal"];
var NotificationTierSchema = z.enum(NOTIFICATION_TIERS);
var CLOCK_DRIFT_EMA_WEIGHT = 0.2;
var NSE_MERGE_STRATEGIES = [
  "conflict",
  "latest_wins",
  "max",
  "min",
  "sum",
  "average",
  "max_timestamp",
  "union",
  "merge_memberships",
  "keep_original",
  "keep_local"
];
var NSEMergeStrategySchema = z.enum(NSE_MERGE_STRATEGIES);
function isNSEMergeStrategy(value) {
  return NSE_MERGE_STRATEGIES.includes(value);
}
var SYNCABLE_FIELDS = [
  "content.title",
  "content.body",
  "content.summary",
  "organization.tags",
  "organization.cluster_memberships",
  "neural.stability",
  "neural.retrievability",
  "neural.difficulty",
  "neural.importance",
  "temporal.last_accessed",
  "temporal.access_count",
  "state.lifecycle",
  "state.flags"
];
var SyncableFieldSchema = z.enum(SYNCABLE_FIELDS);
var NSE_FIELD_MERGE_STRATEGIES = {
  "content.body": "conflict",
  "content.title": "latest_wins",
  "content.summary": "latest_wins",
  "organization.tags": "union",
  "organization.cluster_memberships": "merge_memberships",
  "neural.stability": "max",
  "neural.retrievability": "max",
  "neural.difficulty": "average",
  "neural.importance": "max",
  "temporal.last_accessed": "max_timestamp",
  "temporal.access_count": "sum",
  "state.lifecycle": "latest_wins",
  "state.flags": "union",
  "_default": "latest_wins"
};
var SYNC_HEADER_DEVICE_ID = "X-Device-Id";
var SYNC_HEADER_SCHEMA_VERSION = "X-Schema-Version";
var SYNC_HEADER_SERVER_TIME = "X-Server-Time";
var HTTP_UPGRADE_REQUIRED = 426;
var SYNC_LOG_ENTRY_TYPES = [
  "resurrection",
  "conflict_resolved",
  "schema_mismatch",
  "recovery",
  "initial_sync"
];
var SyncLogEntryTypeSchema = z.enum(SYNC_LOG_ENTRY_TYPES);
var REEMBEDDING_REASONS = ["model_mismatch", "content_changed", "manual"];
var ReembeddingReasonSchema = z.enum(REEMBEDDING_REASONS);
var USER_RESOLUTION_ACTIONS = ["keep_local", "keep_remote", "manual_merge"];
var UserResolutionActionSchema = z.enum(USER_RESOLUTION_ACTIONS);
var MERGE_RESULT_STATUSES = ["merged", "conflict"];
var MergeResultStatusSchema = z.enum(MERGE_RESULT_STATUSES);
var NSE_CONFLICT_RESOLVERS = ["user", "auto"];
var NSEConflictResolverSchema = z.enum(NSE_CONFLICT_RESOLVERS);
var VersionVectorSchema = z.record(z.string(), z.number().int().min(0));
var SyncMetadataSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  version: VersionVectorSchema,
  last_modified_by: z.string().min(1),
  last_modified_at: z.string().datetime(),
  sync_status: NodeSyncStatusSchema,
  last_synced_at: z.string().datetime(),
  content_checksum: z.string().optional()
});
var DeviceInfoSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  device_id: z.string().min(1),
  platform: NSEPlatformSchema,
  display_name: z.string().min(1),
  created_at: z.string().datetime(),
  last_active_at: z.string().datetime(),
  clock_drift_ms: z.number(),
  schema_version: z.string().min(1)
});
var ClockSyncSchema = z.object({
  server_time: z.string().datetime(),
  local_time: z.string().datetime(),
  drift_ms: z.number(),
  last_sync: z.string().datetime()
});
var FieldChangeSchema = z.object({
  field: z.string().min(1),
  old_value: z.unknown(),
  new_value: z.unknown()
});
var ChangeSetSchema = z.object({
  node_id: z.string().min(1),
  device_id: z.string().min(1),
  timestamp: z.string().datetime(),
  changes: z.array(FieldChangeSchema)
});
var StrategyResultSchema = z.object({
  value: z.unknown(),
  isConflict: z.boolean()
});
var ClusterMembershipForMergeSchema = z.object({
  cluster_id: z.string().min(1),
  strength: z.number().min(0).max(1),
  pinned: z.boolean()
});
var NSEConflictInfoSchema = z.object({
  field: z.string().min(1),
  localValue: z.unknown(),
  remoteValue: z.unknown(),
  localTimestamp: z.string().datetime(),
  remoteTimestamp: z.string().datetime()
});
var NSEMergeResultSchema = z.object({
  status: MergeResultStatusSchema,
  mergedNode: z.record(z.string(), z.unknown()).optional(),
  conflicts: z.array(NSEConflictInfoSchema).optional()
});
var NSEStoredConflictSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  local_version: z.record(z.string(), z.unknown()),
  remote_version: z.record(z.string(), z.unknown()),
  conflicts: z.array(NSEConflictInfoSchema),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime()
});
var NSEUserResolutionSchema = z.object({
  node_id: z.string().min(1),
  resolution: UserResolutionActionSchema,
  field_choices: z.record(z.string(), z.enum(["local", "remote"])).optional(),
  manual_values: z.record(z.string(), z.unknown()).optional(),
  apply_to_similar: z.boolean()
});
var ConflictHistoryEntrySchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  rejected_version: z.record(z.string(), z.unknown()),
  resolved_at: z.string().datetime(),
  resolved_by: NSEConflictResolverSchema,
  expires_at: z.string().datetime()
});
var PushPayloadSchema = z.object({
  id: z.string().min(1),
  version: VersionVectorSchema,
  change_set: ChangeSetSchema,
  data: z.record(z.string(), z.unknown()),
  content_checksum: z.string().optional()
});
var PushResultSchema = z.object({
  applied: z.array(z.object({ id: z.string().min(1) })),
  conflicts: z.array(z.object({
    id: z.string().min(1),
    remoteVersion: VersionVectorSchema
  })),
  error: z.string().optional()
});
var PullResultSchema = z.object({
  applied: z.array(z.string()),
  conflicts: z.array(z.string()),
  error: z.string().optional()
});
var BatchSyncResponseSchema = z.object({
  changes: z.array(PushPayloadSchema),
  next_cursor: z.string().nullable(),
  total_estimate: z.number().int().min(0),
  batch_number: z.number().int().min(1)
});
var NSESyncProgressSchema = z.object({
  processed: z.number().int().min(0),
  total: z.number().int().min(0),
  percent: z.number().min(0).max(100),
  batchNumber: z.number().int().min(1)
});
var LastSyncedVersionSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  snapshot: z.record(z.string(), z.unknown()),
  synced_at: z.string().datetime()
});
var PrivateTierPayloadSchema = z.object({
  id: z.string().min(1),
  version: VersionVectorSchema,
  content_checksum: z.string().min(1),
  encrypted_payload: z.string().min(1),
  nonce: z.string().min(1),
  last_modified_at: z.string().datetime()
});
var PrivateTierConflictSchema = z.object({
  node_id: z.string().min(1),
  local_checksum: z.string().min(1),
  remote_checksum: z.string().min(1),
  local_payload: z.string().min(1),
  remote_payload: z.string().min(1),
  detected_at: z.string().datetime()
});
var ConflictNotificationSchema = z.object({
  node_id: z.string().min(1),
  conflict_count: z.number().int().min(1),
  fields: z.array(z.string()),
  created_at: z.string().datetime()
});
var NotificationActionSchema = z.object({
  label: z.string().min(1),
  onClick: z.string().min(1)
});
var BannerNotificationSchema = z.object({
  type: z.literal("warning"),
  message: z.string().min(1),
  actions: z.array(NotificationActionSchema),
  dismissible: z.boolean()
});
var BadgeStateSchema = z.object({
  conflict_count: z.number().int().min(0),
  visible: z.boolean()
});
var BannerDismissStateSchema = z.object({
  dismissed_at: z.string().datetime(),
  cooldown_expired: z.boolean()
});
var EmbeddingSyncSchema = z.object({
  vector: z.array(z.number()),
  model: z.string().min(1),
  model_version: z.string().min(1),
  generated_by: z.string().min(1),
  generated_at: z.string().datetime()
});
var ReembeddingQueueEntrySchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  reason: ReembeddingReasonSchema,
  from_model: z.string().min(1),
  to_model: z.string().min(1),
  queued_at: z.string().datetime()
});
var SchemaVersionErrorSchema = z.object({
  min_version: z.string().min(1),
  upgrade_url: z.string().url(),
  message: z.string().min(1)
});
var NSESyncLogEntrySchema = z.object({
  _schemaVersion: z.number().int().min(1),
  type: SyncLogEntryTypeSchema,
  node_id: z.string().optional(),
  timestamp: z.string().datetime(),
  message: z.string().min(1),
  device_id: z.string().min(1)
});
var ServerSyncStateSchema = z.object({
  current_vector: VersionVectorSchema,
  node_count: z.number().int().min(0),
  schema_version: z.string().min(1)
});
function validateVersionVector(v) {
  return VersionVectorSchema.safeParse(v).success;
}
function validateSyncMetadata(v) {
  return SyncMetadataSchema.safeParse(v).success;
}
function validateDeviceInfo(v) {
  return DeviceInfoSchema.safeParse(v).success;
}
function validateChangeSet(v) {
  return ChangeSetSchema.safeParse(v).success;
}
function validateNSEMergeResult(v) {
  return NSEMergeResultSchema.safeParse(v).success;
}
function validateNSEStoredConflict(v) {
  return NSEStoredConflictSchema.safeParse(v).success;
}
function validateNSEUserResolution(v) {
  return NSEUserResolutionSchema.safeParse(v).success;
}
function validatePushPayload(v) {
  return PushPayloadSchema.safeParse(v).success;
}
function validatePrivateTierPayload(v) {
  return PrivateTierPayloadSchema.safeParse(v).success;
}
function validateNSESyncLogEntry(v) {
  return NSESyncLogEntrySchema.safeParse(v).success;
}
function compareVectors(a, b) {
  const allDevices = /* @__PURE__ */ new Set();
  for (const key of Object.keys(a)) {
    if (key !== VERSION_VECTOR_INACTIVE_KEY) allDevices.add(key);
  }
  for (const key of Object.keys(b)) {
    if (key !== VERSION_VECTOR_INACTIVE_KEY) allDevices.add(key);
  }
  let aGreater = false;
  let bGreater = false;
  for (const device of allDevices) {
    const aVal = a[device] ?? 0;
    const bVal = b[device] ?? 0;
    if (aVal > bVal) aGreater = true;
    if (bVal > aVal) bGreater = true;
  }
  if (aGreater && !bGreater) return "a_dominates";
  if (bGreater && !aGreater) return "b_dominates";
  if (!aGreater && !bGreater) return "equal";
  return "concurrent";
}
function mergeVectors(a, b) {
  const result = { ...a };
  for (const [device, counter] of Object.entries(b)) {
    result[device] = Math.max(result[device] ?? 0, counter);
  }
  return result;
}
function incrementVector(vector, deviceId) {
  return {
    ...vector,
    [deviceId]: (vector[deviceId] ?? 0) + 1
  };
}
function compactVector(vector, deviceLastActive) {
  const activeDevices = Object.keys(vector).filter(
    (k) => k !== VERSION_VECTOR_INACTIVE_KEY
  );
  if (activeDevices.length <= VECTOR_COMPACTION_THRESHOLD) {
    return { ...vector };
  }
  const now = Date.now();
  const inactiveDaysMs = DEVICE_INACTIVE_DAYS * 24 * 60 * 60 * 1e3;
  const result = {};
  let inactiveSum = vector[VERSION_VECTOR_INACTIVE_KEY] ?? 0;
  for (const device of activeDevices) {
    const lastActive = deviceLastActive.get(device);
    const isInactive = lastActive && now - lastActive.getTime() > inactiveDaysMs;
    if (isInactive) {
      inactiveSum += vector[device] ?? 0;
    } else {
      result[device] = vector[device] ?? 0;
    }
  }
  if (inactiveSum > 0) {
    result[VERSION_VECTOR_INACTIVE_KEY] = inactiveSum;
  }
  return result;
}
function generateDeviceId(platform) {
  return `${platform}_${nanoid()}`;
}
function updateClockDrift(currentDrift, newSample) {
  return (1 - CLOCK_DRIFT_EMA_WEIGHT) * currentDrift + CLOCK_DRIFT_EMA_WEIGHT * newSample;
}
function adjustedTimestamp(localTime, driftMs) {
  return new Date(localTime.getTime() - driftMs);
}
function getNestedValue(obj, fieldPath) {
  const parts = fieldPath.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === void 0 || typeof current !== "object") {
      return void 0;
    }
    current = current[part];
  }
  return current;
}
function setNestedValue(obj, fieldPath, value) {
  const parts = fieldPath.split(".");
  if (parts.length === 0) return;
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === void 0 || current[part] === null || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }
  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === void 0 || b === void 0) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a;
    const bObj = b;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }
  return false;
}
function computeChangeSet(base, current, deviceId) {
  const changes = [];
  for (const field of SYNCABLE_FIELDS) {
    const oldValue = base ? getNestedValue(base, field) : void 0;
    const newValue = getNestedValue(current, field);
    if (!deepEqual(oldValue, newValue)) {
      changes.push({ field, old_value: oldValue, new_value: newValue });
    }
  }
  return {
    node_id: current["id"] ?? "",
    device_id: deviceId,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    changes
  };
}
function getFieldMergeStrategy(fieldPath) {
  return NSE_FIELD_MERGE_STRATEGIES[fieldPath] ?? NSE_FIELD_MERGE_STRATEGIES["_default"] ?? "latest_wins";
}
function applyStrategy(strategy, localVal, remoteVal, localTime, remoteTime, localOldVal, remoteOldVal) {
  switch (strategy) {
    case "conflict":
      return { value: void 0, isConflict: true };
    case "latest_wins": {
      const localMs = new Date(localTime).getTime();
      const remoteMs = new Date(remoteTime).getTime();
      return {
        value: localMs >= remoteMs ? localVal : remoteVal,
        isConflict: false
      };
    }
    case "max": {
      if (typeof localVal === "number" && typeof remoteVal === "number") {
        return { value: Math.max(localVal, remoteVal), isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }
    case "min": {
      if (typeof localVal === "number" && typeof remoteVal === "number") {
        return { value: Math.min(localVal, remoteVal), isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }
    case "sum": {
      if (typeof localVal === "number" && typeof remoteVal === "number") {
        if (typeof localOldVal === "number" && typeof remoteOldVal === "number") {
          const localDelta = localVal - localOldVal;
          const remoteDelta = remoteVal - remoteOldVal;
          return { value: localOldVal + localDelta + remoteDelta, isConflict: false };
        }
        return { value: localVal + remoteVal, isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }
    case "average": {
      if (typeof localVal === "number" && typeof remoteVal === "number") {
        return { value: (localVal + remoteVal) / 2, isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }
    case "max_timestamp": {
      const localStr = String(localVal ?? "");
      const remoteStr = String(remoteVal ?? "");
      return {
        value: localStr >= remoteStr ? localVal : remoteVal,
        isConflict: false
      };
    }
    case "union": {
      if (Array.isArray(localVal) && Array.isArray(remoteVal)) {
        return {
          value: [.../* @__PURE__ */ new Set([...localVal, ...remoteVal])],
          isConflict: false
        };
      }
      return { value: localVal, isConflict: false };
    }
    case "merge_memberships": {
      if (Array.isArray(localVal) && Array.isArray(remoteVal)) {
        return {
          value: mergeMemberships(
            localVal,
            remoteVal
          ),
          isConflict: false
        };
      }
      return { value: localVal, isConflict: false };
    }
    case "keep_original":
    case "keep_local":
      return { value: localVal, isConflict: false };
    default:
      return { value: localVal, isConflict: false };
  }
}
function mergeMemberships(local, remote) {
  const map = /* @__PURE__ */ new Map();
  for (const m of local) {
    map.set(m.cluster_id, { ...m });
  }
  for (const m of remote) {
    const existing = map.get(m.cluster_id);
    if (existing) {
      existing.strength = Math.max(existing.strength, m.strength);
      existing.pinned = existing.pinned || m.pinned;
    } else {
      map.set(m.cluster_id, { ...m });
    }
  }
  return Array.from(map.values());
}
function nseAutoMerge(local, _remote, localChangeSet, remoteChangeSet) {
  const localChanges = /* @__PURE__ */ new Map();
  for (const change of localChangeSet.changes) {
    localChanges.set(change.field, change);
  }
  const remoteChanges = /* @__PURE__ */ new Map();
  for (const change of remoteChangeSet.changes) {
    remoteChanges.set(change.field, change);
  }
  const merged = JSON.parse(JSON.stringify(local));
  const conflicts = [];
  for (const [field, remoteChange] of remoteChanges) {
    const localChange = localChanges.get(field);
    if (!localChange) {
      setNestedValue(merged, field, remoteChange.new_value);
    } else {
      const strategy = getFieldMergeStrategy(field);
      const result = applyStrategy(
        strategy,
        localChange.new_value,
        remoteChange.new_value,
        localChangeSet.timestamp,
        remoteChangeSet.timestamp,
        localChange.old_value,
        remoteChange.old_value
      );
      if (result.isConflict) {
        conflicts.push({
          field,
          localValue: localChange.new_value,
          remoteValue: remoteChange.new_value,
          localTimestamp: localChangeSet.timestamp,
          remoteTimestamp: remoteChangeSet.timestamp
        });
      } else {
        setNestedValue(merged, field, result.value);
      }
    }
  }
  if (conflicts.length === 0) {
    return { status: "merged", mergedNode: merged };
  }
  return { status: "conflict", mergedNode: merged, conflicts };
}
function detectPrivateTierConflict(local, remote) {
  return local.content_checksum !== remote.content_checksum;
}
function createSyncMetadata(deviceId, status = "pending") {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    _schemaVersion: 1,
    version: { [deviceId]: 1 },
    last_modified_by: deviceId,
    last_modified_at: now,
    sync_status: status,
    last_synced_at: now
  };
}
function createDeviceInfo(platform, schemaVersion = "2") {
  const deviceId = generateDeviceId(platform);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    _schemaVersion: 1,
    device_id: deviceId,
    platform,
    display_name: getDefaultDeviceName(platform),
    created_at: now,
    last_active_at: now,
    clock_drift_ms: 0,
    schema_version: schemaVersion
  };
}
function getDefaultDeviceName(platform) {
  switch (platform) {
    case "ios":
      return "iPhone";
    case "android":
      return "Android Device";
    case "mac":
      return "Mac";
    case "win":
      return "Windows PC";
    case "web":
      return "Web Browser";
    default:
      return "Device";
  }
}
function createBadgeState(conflictCount) {
  return {
    conflict_count: conflictCount,
    visible: conflictCount > 0
  };
}
function createStoredConflict(nodeId, local, remote, conflicts) {
  const now = /* @__PURE__ */ new Date();
  const expires = new Date(now.getTime() + CONFLICT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1e3);
  return {
    _schemaVersion: 1,
    node_id: nodeId,
    local_version: local,
    remote_version: remote,
    conflicts,
    created_at: now.toISOString(),
    expires_at: expires.toISOString()
  };
}
function createConflictHistoryEntry(nodeId, rejectedVersion, resolvedBy) {
  const now = /* @__PURE__ */ new Date();
  const expires = new Date(now.getTime() + CONFLICT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1e3);
  return {
    _schemaVersion: 1,
    node_id: nodeId,
    rejected_version: rejectedVersion,
    resolved_at: now.toISOString(),
    resolved_by: resolvedBy,
    expires_at: expires.toISOString()
  };
}
function isEmbeddingCompatible(nodeModel, currentModel) {
  return nodeModel === currentModel;
}
var EMBEDDING_DIMENSIONS = 1536;
var MATRYOSHKA_DIMS = [128, 512, 1536];
var COMPARISON_DIMS = 512;
var DENSE_WEIGHT = 0.7;
var BM25_WEIGHT = 0.3;
var SIMILARITY_EDGE_THRESHOLD = 0.9;
var DEDUP_CHECK_THRESHOLD = 0.95;
var SSA_SEED_THRESHOLD = 0.6;
var STALE_EDGE_THRESHOLD = 0.8;
var MIN_CONTENT_LENGTH = 10;
var MIN_TOTAL_LENGTH = 50;
var STAGE_1_CANDIDATES = 200;
var STAGE_2_CANDIDATES = 50;
var STAGE_3_CANDIDATES = 30;
var PRIMARY_MODEL = "openai-3-small";
var FALLBACK_1_MODEL = "voyage-3-lite";
var FALLBACK_2_MODEL = "minilm-v6";
var EMBEDDING_MODELS = [
  PRIMARY_MODEL,
  FALLBACK_1_MODEL,
  FALLBACK_2_MODEL
];
var RECENT_NODE_WINDOW = 100;
var FALLBACK_RETRY_DELAY_MS = 1e3;
var FALLBACK_MAX_RETRIES = 2;
var BM25_FIELD_WEIGHTS = {
  title: 2,
  body: 1,
  summary: 1.5,
  tags: 1.5
};
var NodeEmbeddingSchema = z.object({
  vector: z.instanceof(Float32Array),
  dimensions: z.number().int().positive().max(EMBEDDING_DIMENSIONS),
  model: z.string().min(1),
  contextPrefix: z.string(),
  contextHash: z.string().min(1),
  createdAt: z.string().datetime(),
  provisional: z.boolean(),
  version: z.number().int().nonnegative()
});
var ContextPrefixSchema = z.object({
  template: z.enum([
    "concept_extracted",
    "concept_manual",
    "episode",
    "document_chunk",
    "section",
    "note",
    "raw_archive",
    "query"
  ]),
  generated: z.string(),
  hash: z.string()
});
var HybridSearchConfigSchema = z.object({
  denseWeight: z.number().min(0).max(1),
  bm25Weight: z.number().min(0).max(1),
  userTunable: z.boolean()
}).refine(
  (data) => Math.abs(data.denseWeight + data.bm25Weight - 1) < 1e-3,
  { message: "Weights must sum to 1.0" }
);
var HybridSearchResultSchema = z.object({
  nodeId: z.string(),
  denseScore: z.number().min(0).max(1),
  bm25Score: z.number().min(0).max(1),
  fusedScore: z.number().min(0).max(1)
});
var SearchFiltersSchema = z.object({
  timeRange: z.object({
    start: z.string().datetime(),
    end: z.string().datetime()
  }).optional(),
  nodeTypes: z.array(z.string()).optional(),
  clusterIds: z.array(z.string()).optional(),
  excludeNodeIds: z.array(z.string()).optional()
});
var QueryAnalysisSchema = z.object({
  hasTimeReference: z.boolean(),
  hasSemanticContent: z.boolean(),
  expectedTypes: z.array(z.string()),
  semanticPart: z.string(),
  originalQuery: z.string()
});
var SimilarityCheckResultSchema = z.object({
  shouldCreateEdge: z.boolean(),
  shouldCheckDedup: z.boolean(),
  similarity: z.number().min(-1).max(1),
  targetNodeId: z.string()
});
var FallbackLevelSchema = z.enum(["primary", "secondary", "local", "degraded"]);
var FallbackConfigSchema = z.object({
  chain: z.array(z.string()),
  retryDelayMs: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative(),
  autoReEmbed: z.boolean()
});
var ProviderHealthSchema = z.object({
  isAvailable: z.boolean(),
  lastSuccessAt: z.string().datetime().optional(),
  lastFailureAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
  consecutiveFailures: z.number().int().nonnegative()
});
var DEFAULT_HYBRID_CONFIG = {
  denseWeight: DENSE_WEIGHT,
  bm25Weight: BM25_WEIGHT,
  userTunable: true
};
var DEFAULT_MATRYOSHKA_CONFIG = {
  stages: [
    { stage: 1, dimensions: 128, candidates: STAGE_1_CANDIDATES, estimatedLatencyMs: 3 },
    { stage: 2, dimensions: 512, candidates: STAGE_2_CANDIDATES, estimatedLatencyMs: 5 },
    { stage: 3, dimensions: 1536, candidates: STAGE_3_CANDIDATES, estimatedLatencyMs: 7 }
  ],
  totalEstimatedLatencyMs: 15
};
var DEFAULT_SIMILARITY_CONFIG = {
  edgeThreshold: SIMILARITY_EDGE_THRESHOLD,
  dedupThreshold: DEDUP_CHECK_THRESHOLD,
  staleThreshold: STALE_EDGE_THRESHOLD,
  recentNodeWindow: RECENT_NODE_WINDOW,
  comparisonDims: COMPARISON_DIMS
};
var DEFAULT_FALLBACK_CONFIG = {
  chain: [PRIMARY_MODEL, FALLBACK_1_MODEL, FALLBACK_2_MODEL],
  retryDelayMs: FALLBACK_RETRY_DELAY_MS,
  maxRetries: FALLBACK_MAX_RETRIES,
  autoReEmbed: true
};
var INITIAL_PROVIDER_HEALTH = {
  isAvailable: true,
  consecutiveFailures: 0
};
var CONTEXT_TEMPLATES = {
  concept_extracted: "[{subtype}] From {source} ({source_type}). {cluster}.",
  concept_manual: "[{subtype}] Created by user. {cluster}.",
  episode: "[{subtype}] {date}, {duration}min. {participants}.",
  document_chunk: "[Chunk {index}/{total}] {parent}. Section: {section}.",
  section: "[Section] {parent}. {title}.",
  note: "[note] {cluster}. {title}.",
  raw_archive: "[archive: {content_type}] {title}.",
  query: "[Query] "
};
var TIME_REFERENCE_PATTERNS = [
  /\b(yesterday|today|tomorrow)\b/i,
  /\b(last|this|next)\s+(week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(in|during|on|at)\s+\d{4}\b/i,
  /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i,
  /\b\d+\s+(days?|weeks?|months?|years?)\s+ago\b/i
];
var GENERIC_WORDS = [
  "what",
  "when",
  "where",
  "who",
  "how",
  "why",
  "happened",
  "did",
  "was",
  "is",
  "are",
  "were",
  "tell",
  "me",
  "about",
  "show",
  "find",
  "get",
  "the",
  "a",
  "an",
  "this",
  "that",
  "it"
];
function hashContext(contextPrefix) {
  let hash = 0;
  for (let i = 0; i < contextPrefix.length; i++) {
    const char = contextPrefix.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}
function createNodeEmbedding(vector, model, contextPrefix, provisional = false) {
  return {
    vector,
    dimensions: vector.length,
    model,
    contextPrefix,
    contextHash: hashContext(contextPrefix),
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    provisional,
    version: 1
  };
}
function isProvisional(embedding) {
  return embedding.provisional;
}
function needsReEmbedding(embedding, currentContextHash) {
  return embedding.contextHash !== currentContextHash;
}
function isPrimaryModel(embedding) {
  return embedding.model === PRIMARY_MODEL;
}
function updateEmbedding(previous, vector, model, contextPrefix, provisional = false) {
  return {
    ...createNodeEmbedding(vector, model, contextPrefix, provisional),
    version: previous.version + 1
  };
}
function truncateToMatryoshka(embedding, dims) {
  if (dims >= embedding.dimensions) {
    return embedding.vector;
  }
  return embedding.vector.slice(0, dims);
}
function getModelDimensions(model) {
  switch (model) {
    case "openai-3-small":
      return 1536;
    case "voyage-3-lite":
      return 512;
    case "minilm-v6":
      return 384;
    default:
      return EMBEDDING_DIMENSIONS;
  }
}
function selectTemplate(nodeType, sourceType) {
  switch (nodeType) {
    case "concept":
      return sourceType === "extraction" ? "concept_extracted" : "concept_manual";
    case "episode":
      return "episode";
    case "chunk":
      return "document_chunk";
    case "section":
      return "section";
    case "note":
      return "note";
    case "raw":
    case "document":
      return "raw_archive";
    default:
      return "concept_manual";
  }
}
function formatContextDate(timestamp) {
  const date = new Date(timestamp);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  return `${months[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
}
function generateContextPrefix(input) {
  const template = selectTemplate(input.nodeType, input.sourceType);
  let generated = CONTEXT_TEMPLATES[template];
  generated = generated.replace("{subtype}", input.nodeSubtype || input.nodeType);
  generated = generated.replace("{source}", input.sourceEpisode?.title || "");
  generated = generated.replace("{source_type}", input.sourceEpisode?.subtype || "");
  generated = generated.replace("{cluster}", input.clusterInfo?.name || "");
  generated = generated.replace("{date}", input.eventTimestamp ? formatContextDate(input.eventTimestamp) : "");
  generated = generated.replace("{duration}", String(input.durationMinutes || 0));
  generated = generated.replace("{participants}", input.participants?.join(", ") || "");
  generated = generated.replace("{index}", String(input.chunkInfo?.index || 0));
  generated = generated.replace("{total}", String(input.chunkInfo?.total || 0));
  generated = generated.replace("{parent}", input.chunkInfo?.parentTitle || "");
  generated = generated.replace("{section}", input.chunkInfo?.sectionTitle || "Main");
  generated = generated.replace("{content_type}", input.contentType || "unknown");
  generated = generated.replace("{title}", input.title);
  generated = generated.replace(/\(\)\.?/g, "");
  generated = generated.replace(/\s+/g, " ");
  generated = generated.trim();
  return {
    template,
    generated,
    hash: hashContext(generated)
  };
}
function expandMinimumContext(content, prefix, clusterInfo) {
  let expandedPrefix = prefix;
  if (content.length < MIN_CONTENT_LENGTH && clusterInfo?.description) {
    expandedPrefix += ` Topic: ${clusterInfo.description}.`;
  }
  if (content.length + expandedPrefix.length < MIN_TOTAL_LENGTH && clusterInfo?.keywords?.length) {
    const keywords = clusterInfo.keywords.slice(0, 5).join(", ");
    expandedPrefix += ` Keywords: ${keywords}.`;
  }
  return expandedPrefix;
}
function generateQueryPrefix(semanticContent) {
  const generated = `[Query] ${semanticContent}`;
  return {
    template: "query",
    generated,
    hash: hashContext(generated)
  };
}
function combineForEmbedding(prefix, content, clusterInfo) {
  const expandedPrefix = expandMinimumContext(content, prefix, clusterInfo);
  return `${expandedPrefix} ${content}`.trim();
}
function getDefaultHybridConfig() {
  return { ...DEFAULT_HYBRID_CONFIG };
}
function fuseScores(denseScore, bm25Score, config = DEFAULT_HYBRID_CONFIG) {
  return denseScore * config.denseWeight + bm25Score * config.bm25Weight;
}
function normalizeScores(results) {
  if (results.length === 0) return [];
  const denseScores = results.map((r) => r.denseScore);
  const bm25Scores = results.map((r) => r.bm25Score);
  const denseMin = Math.min(...denseScores);
  const denseMax = Math.max(...denseScores);
  const bm25Min = Math.min(...bm25Scores);
  const bm25Max = Math.max(...bm25Scores);
  const denseRange = denseMax - denseMin || 1;
  const bm25Range = bm25Max - bm25Min || 1;
  return results.map((result) => ({
    ...result,
    denseScore: (result.denseScore - denseMin) / denseRange,
    bm25Score: (result.bm25Score - bm25Min) / bm25Range
  }));
}
function createSearchResult(nodeId, denseScore, bm25Score, config = DEFAULT_HYBRID_CONFIG) {
  return {
    nodeId,
    denseScore,
    bm25Score,
    fusedScore: fuseScores(denseScore, bm25Score, config)
  };
}
function sortByFusedScore(results) {
  return [...results].sort((a, b) => b.fusedScore - a.fusedScore);
}
function takeTopK(results, k) {
  return sortByFusedScore(results).slice(0, k);
}
function validateHybridConfig(config) {
  return Math.abs(config.denseWeight + config.bm25Weight - 1) < 1e-3;
}
function detectTimeReference(query) {
  return TIME_REFERENCE_PATTERNS.some((pattern) => pattern.test(query));
}
function removeTimeReferences(query) {
  let result = query;
  for (const pattern of TIME_REFERENCE_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.replace(/\s+/g, " ").trim();
}
function removeGenericWords(query) {
  const words = query.toLowerCase().split(/\s+/);
  const filtered = words.filter((word) => !GENERIC_WORDS.includes(word));
  return filtered.join(" ");
}
function inferExpectedTypes(query) {
  const types = [];
  const lower = query.toLowerCase();
  if (lower.includes("lecture") || lower.includes("class") || lower.includes("meeting")) {
    types.push("episode");
  }
  if (lower.includes("concept") || lower.includes("idea") || lower.includes("fact")) {
    types.push("concept");
  }
  if (lower.includes("note") || lower.includes("wrote")) {
    types.push("note");
  }
  if (lower.includes("document") || lower.includes("file") || lower.includes("pdf")) {
    types.push("document", "chunk");
  }
  if (types.length === 0) {
    types.push("concept", "episode", "note");
  }
  return types;
}
function analyzeQuery(rawQuery) {
  const hasTimeReference = detectTimeReference(rawQuery);
  const semanticPart = hasTimeReference ? removeTimeReferences(rawQuery) : rawQuery;
  const cleanedSemantic = removeGenericWords(semanticPart);
  const hasSemanticContent = cleanedSemantic.length >= 3;
  return {
    hasTimeReference,
    hasSemanticContent,
    expectedTypes: inferExpectedTypes(rawQuery),
    semanticPart: cleanedSemantic,
    originalQuery: rawQuery
  };
}
function shouldSkipEmbedding(analysis) {
  return analysis.hasTimeReference && !analysis.hasSemanticContent;
}
function tokenizeForBM25(text) {
  const normalized = text.toLowerCase();
  const tokens = normalized.split(/[\s\-_.,;:!?'"()\[\]{}]+/).filter((token) => token.length > 1);
  return tokens;
}
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}
function truncateForComparison(vector, dims) {
  if (dims >= vector.length) return vector;
  return vector.slice(0, dims);
}
function checkSimilarity(sourceEmbedding, targetEmbedding, targetNodeId, config = DEFAULT_SIMILARITY_CONFIG) {
  const sourceVec = truncateForComparison(
    sourceEmbedding.vector,
    config.comparisonDims
  );
  const targetVec = truncateForComparison(
    targetEmbedding.vector,
    config.comparisonDims
  );
  const similarity = cosineSimilarity(sourceVec, targetVec);
  return {
    shouldCreateEdge: similarity >= config.edgeThreshold,
    shouldCheckDedup: similarity >= config.dedupThreshold,
    similarity,
    targetNodeId
  };
}
function isStaleEdge(currentSimilarity, config = DEFAULT_SIMILARITY_CONFIG) {
  return currentSimilarity < config.staleThreshold;
}
function sortBySimilarity(results) {
  return [...results].sort((a, b) => b.similarity - a.similarity);
}
function getFallbackLevel(modelId) {
  switch (modelId) {
    case PRIMARY_MODEL:
      return "primary";
    case FALLBACK_1_MODEL:
      return "secondary";
    case FALLBACK_2_MODEL:
      return "local";
    default:
      return "degraded";
  }
}
function shouldRetry(error, statusCode) {
  if (statusCode === 429) return true;
  if (statusCode && statusCode >= 500 && statusCode < 600) return true;
  if (error.message.includes("ECONNREFUSED")) return true;
  if (error.message.includes("ETIMEDOUT")) return true;
  if (error.message.includes("network")) return true;
  if (statusCode === 401 || statusCode === 403) return false;
  if (statusCode === 400) return false;
  return false;
}
function getNextProvider(currentModel, config = DEFAULT_FALLBACK_CONFIG) {
  const currentIndex = config.chain.indexOf(currentModel);
  if (currentIndex === -1 || currentIndex >= config.chain.length - 1) {
    return null;
  }
  return config.chain[currentIndex + 1] ?? null;
}
function createInitialFallbackState() {
  const providerHealth = {};
  for (const model of EMBEDDING_MODELS) {
    providerHealth[model] = { ...INITIAL_PROVIDER_HEALTH };
  }
  return {
    currentLevel: "primary",
    recoveryAttempts: 0,
    providerHealth
  };
}
function recordSuccess(state, provider) {
  const newHealth = {
    ...state.providerHealth[provider],
    isAvailable: true,
    lastSuccessAt: (/* @__PURE__ */ new Date()).toISOString(),
    consecutiveFailures: 0
  };
  const newLevel = provider === PRIMARY_MODEL ? "primary" : state.currentLevel;
  return {
    ...state,
    currentLevel: newLevel,
    providerHealth: { ...state.providerHealth, [provider]: newHealth },
    degradedSince: newLevel === "primary" ? void 0 : state.degradedSince
  };
}
function recordFailure(state, provider, error) {
  const currentHealth = state.providerHealth[provider] || INITIAL_PROVIDER_HEALTH;
  const newHealth = {
    ...currentHealth,
    isAvailable: false,
    lastFailureAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastError: error,
    consecutiveFailures: currentHealth.consecutiveFailures + 1
  };
  let newLevel = state.currentLevel;
  if (provider === PRIMARY_MODEL && state.currentLevel === "primary") {
    newLevel = "secondary";
  }
  return {
    ...state,
    currentLevel: newLevel,
    lastError: error,
    providerHealth: { ...state.providerHealth, [provider]: newHealth },
    degradedSince: state.degradedSince || (/* @__PURE__ */ new Date()).toISOString(),
    recoveryAttempts: state.recoveryAttempts + 1
  };
}
function createDegradedResult(error, latencyMs) {
  return {
    embedding: null,
    fallbackLevel: "degraded",
    error,
    latencyMs,
    isProvisional: false
  };
}
function createSuccessResult(embedding, modelUsed, latencyMs) {
  const level = getFallbackLevel(modelUsed);
  return {
    embedding,
    fallbackLevel: level,
    modelUsed,
    latencyMs,
    isProvisional: level !== "primary"
  };
}
function estimateCost(tokens, costPer1M = 0.02) {
  return {
    tokens,
    costUsd: tokens / 1e6 * costPer1M
  };
}
function estimateMonthlyCost(nodesPerDay, queriesPerDay, tokensPerNode = 150, tokensPerQuery = 30, costPer1M = 0.02) {
  const dailyNodeTokens = nodesPerDay * tokensPerNode;
  const dailyQueryTokens = queriesPerDay * tokensPerQuery;
  const monthlyTokens = (dailyNodeTokens + dailyQueryTokens) * 30;
  return estimateCost(monthlyTokens, costPer1M);
}
var ALGORITHM_NODE_TYPES = [
  "person",
  "fact",
  "concept",
  "event",
  "note",
  "document",
  "preference"
];
var RerankingWeightsSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1)
}).refine(
  (w) => Math.abs(w.semantic + w.keyword + w.graph + w.recency + w.authority + w.affinity - 1) < 1e-3,
  { message: "Reranking weights must sum to 1.0" }
);
var RERANKING_WEIGHTS = {
  semantic: 0.3,
  keyword: 0.15,
  graph: 0.2,
  recency: 0.15,
  authority: 0.1,
  affinity: 0.1
};
var RerankingConfigSchema = z.object({
  recency_half_life_days: z.number().positive(),
  authority_cap_multiple: z.number().positive(),
  affinity_saturation: z.number().positive(),
  new_content_boost_days: z.number().int().nonnegative(),
  new_content_boost_value: z.number().min(0).max(1)
});
var RERANKING_CONFIG = {
  recency_half_life_days: 30,
  authority_cap_multiple: 2,
  affinity_saturation: 10,
  new_content_boost_days: 7,
  new_content_boost_value: 0.2
};
var ScoreBreakdownSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1)
});
var ScoredNodeSchema = z.object({
  id: z.string(),
  semantic_score: z.number().min(0).max(1).optional(),
  bm25_score: z.number().nonnegative().optional(),
  graph_score: z.number().min(0).max(1).optional(),
  last_accessed: z.date(),
  created_at: z.date(),
  access_count: z.number().int().nonnegative(),
  inbound_edge_count: z.number().int().nonnegative()
});
var GraphMetricsSchema = z.object({
  total_nodes: z.number().int().nonnegative(),
  total_edges: z.number().int().nonnegative(),
  density: z.number().min(0).max(1),
  avg_inbound_edges: z.number().nonnegative(),
  avg_outbound_edges: z.number().nonnegative()
});
var DecayConfigSchema = z.object({
  growth_rate: z.number().positive(),
  max_stability_days: z.number().int().positive(),
  active_threshold: z.number().min(0).max(1),
  weak_threshold: z.number().min(0).max(1),
  dormant_days: z.number().int().nonnegative(),
  compress_days: z.number().int().nonnegative(),
  archive_days: z.number().int().nonnegative(),
  cascade_factor: z.number().min(0).max(1),
  edge_floor: z.number().min(0).max(1)
});
var DECAY_CONFIG = {
  growth_rate: 2.5,
  max_stability_days: 365,
  active_threshold: 0.5,
  weak_threshold: 0.1,
  dormant_days: 60,
  compress_days: 120,
  archive_days: 240,
  cascade_factor: 0.8,
  edge_floor: 0.1
};
var INITIAL_STABILITY = {
  person: 14,
  fact: 7,
  concept: 21,
  event: 10,
  note: 30,
  document: 7,
  preference: 45
};
var INITIAL_DIFFICULTY = {
  person: 0.2,
  fact: 0.3,
  concept: 0.4,
  event: 0.3,
  note: 0.2,
  document: 0.5,
  preference: 0.1
};
var DECAY_LIFECYCLE_STATES = ["ACTIVE", "WEAK", "DORMANT", "COMPRESS", "ARCHIVE"];
var SSAParamsSchema = z.object({
  initial_activation: z.number().min(0).max(1),
  hop_decay: z.number().min(0).max(1),
  min_threshold: z.number().min(0).max(1),
  max_hops: z.number().int().positive(),
  max_nodes: z.number().int().positive(),
  aggregation: z.enum(["sum", "max"])
});
var SSA_PARAMS = {
  initial_activation: 1,
  hop_decay: 0.5,
  min_threshold: 0.05,
  max_hops: 3,
  max_nodes: 500,
  aggregation: "sum"
};
var SSAEdgeWeightsSchema = z.object({
  same_entity: z.number().min(0).max(1),
  part_of: z.number().min(0).max(1),
  caused_by: z.number().min(0).max(1),
  mentioned_together: z.number().min(0).max(1),
  related_to: z.number().min(0).max(1),
  similar_to: z.number().min(0).max(1),
  user_linked: z.number().min(0).max(1),
  temporal_adjacent: z.number().min(0).max(1)
});
var SSA_EDGE_WEIGHTS = {
  same_entity: 0.95,
  part_of: 0.85,
  caused_by: 0.8,
  mentioned_together: 0.6,
  related_to: 0.5,
  similar_to: 0.45,
  user_linked: 0.9,
  temporal_adjacent: 0.4
};
var ActivatedNodeSchema = z.object({
  id: z.string(),
  activation: z.number().min(0).max(1),
  path: z.array(z.string())
});
var ConfidenceThresholdsSchema = z.object({
  retrieval: z.object({
    high: z.number().min(0).max(1),
    medium: z.number().min(0).max(1),
    low: z.number().min(0).max(1)
  }),
  classification: z.object({
    clear_lookup: z.number().min(0).max(1),
    clear_reasoning: z.number().min(0).max(1),
    ambiguous_floor: z.number().min(0).max(1)
  }),
  extraction: z.object({
    auto_store: z.number().min(0).max(1),
    confirm_store: z.number().min(0).max(1)
  }),
  contradiction: z.object({
    definite: z.number().min(0).max(1),
    possible: z.number().min(0).max(1)
  })
});
var CONFIDENCE_THRESHOLDS = {
  retrieval: {
    high: 0.7,
    medium: 0.45,
    low: 0.45
  },
  classification: {
    clear_lookup: 0.85,
    clear_reasoning: 0.85,
    ambiguous_floor: 0.5
  },
  extraction: {
    auto_store: 0.85,
    confirm_store: 0.6
  },
  contradiction: {
    definite: 0.85,
    possible: 0.6
  }
};
var CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"];
var RCSWeightsSchema = z.object({
  match_quality: z.number().min(0).max(1),
  distinctiveness: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1)
});
var RCS_WEIGHTS = {
  match_quality: 0.4,
  distinctiveness: 0.35,
  completeness: 0.25
};
var RetrievalConfidenceResultSchema = z.object({
  score: z.number().min(0).max(1),
  level: z.enum(CONFIDENCE_LEVELS),
  breakdown: z.object({
    mq: z.number().min(0).max(1),
    dt: z.number().min(0).max(1),
    cm: z.number().min(0).max(1)
  }),
  flags: z.array(z.string())
});
var CONTRADICTION_LEVELS = ["definite", "possible", "none"];
var ContradictionResultSchema = z.object({
  level: z.enum(CONTRADICTION_LEVELS),
  score: z.number().min(0).max(1),
  action: z.enum(["flag_user", "note_internal", "safe_to_store"]),
  explanation: z.string()
});
var BudgetConfigSchema = z.object({
  time_ms: z.number().nonnegative(),
  max_nodes: z.number().int().nonnegative(),
  max_api_calls: z.number().int().nonnegative()
});
var OPERATION_BUDGETS = {
  simple_lookup: { time_ms: 50, max_nodes: 100, max_api_calls: 0 },
  standard_query: { time_ms: 100, max_nodes: 500, max_api_calls: 0 },
  complex_query: { time_ms: 200, max_nodes: 1e3, max_api_calls: 0 },
  phase2_reasoning: { time_ms: 3e3, max_nodes: 500, max_api_calls: 5 },
  deep_search: { time_ms: 500, max_nodes: 2e3, max_api_calls: 0 },
  serendipity: { time_ms: 200, max_nodes: 200, max_api_calls: 0 }
};
var QualityTargetSchema = z.object({
  confidence: z.number().min(0).max(1),
  min_coverage: z.number().min(0).max(1)
});
var QUALITY_TARGETS = {
  LOOKUP: { confidence: 0.8, min_coverage: 0.6 },
  REASONING: { confidence: 0.7, min_coverage: 0.7 },
  EXPLORATORY: { confidence: 0.5, min_coverage: 0.4 },
  TEMPORAL: { confidence: 0.75, min_coverage: 0.65 }
};
var QualityWeightsSchema = z.object({
  coverage: z.number().min(0).max(1),
  match_quality: z.number().min(0).max(1),
  convergence: z.number().min(0).max(1)
});
var QUALITY_WEIGHTS = {
  coverage: 0.35,
  match_quality: 0.45,
  convergence: 0.2
};
var COLD_START_THRESHOLD = 200;
var AdaptiveLimitsSchema = z.object({
  entry_points: z.number().int().positive(),
  max_hops: z.number().int().positive(),
  max_nodes: z.number().int().positive()
});
var COLD_START_LIMITS = {
  entry_points: 2,
  max_hops: 3,
  max_nodes: 50
};
var QUERY_TYPES = ["simple", "standard", "complex"];
var TerminationResultSchema = z.object({
  terminate: z.boolean(),
  reason: z.string()
});
var BM25ConfigSchema = z.object({
  k1: z.number().positive(),
  b: z.number().min(0).max(1),
  min_term_length: z.number().int().positive(),
  max_term_length: z.number().int().positive(),
  max_doc_frequency_ratio: z.number().min(0).max(1),
  stemmer: z.enum(["porter", "snowball", "none"]),
  preserve_original: z.boolean()
});
var BM25_CONFIG = {
  k1: 1.2,
  b: 0.75,
  min_term_length: 2,
  max_term_length: 50,
  max_doc_frequency_ratio: 0.95,
  stemmer: "porter",
  preserve_original: true
};
var FieldBoostSchema = z.object({
  field: z.enum(["title", "tags", "headers", "body", "metadata"]),
  boost: z.number().positive()
});
var FIELD_BOOSTS = [
  { field: "title", boost: 3 },
  { field: "tags", boost: 2.5 },
  { field: "headers", boost: 2 },
  { field: "body", boost: 1 },
  { field: "metadata", boost: 0.5 }
];
var StopwordsConfigSchema = z.object({
  language: z.string(),
  default_list: z.array(z.string()),
  custom_additions: z.array(z.string()),
  behavior: z.enum(["remove_from_query", "remove_from_both", "keep_for_phrases"])
});
var STOPWORDS_CONFIG = {
  language: "en",
  default_list: [
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "was",
    "are",
    "were",
    "been",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "what",
    "which",
    "who",
    "whom",
    "whose",
    "where",
    "when",
    "why",
    "how"
  ],
  custom_additions: [
    "note",
    "notes",
    "idea",
    "ideas",
    "thought",
    "thoughts",
    "todo",
    "item",
    "entry"
  ],
  behavior: "remove_from_query"
};
var ALGORITHM_PARAMS = {
  reranking: {
    weights: RERANKING_WEIGHTS,
    config: RERANKING_CONFIG
  },
  decay: {
    config: DECAY_CONFIG,
    initial_stability: INITIAL_STABILITY,
    initial_difficulty: INITIAL_DIFFICULTY
  },
  ssa: {
    params: SSA_PARAMS,
    edge_weights: SSA_EDGE_WEIGHTS
  },
  confidence: {
    thresholds: CONFIDENCE_THRESHOLDS,
    rcs_weights: RCS_WEIGHTS
  },
  adaptive: {
    budgets: OPERATION_BUDGETS,
    quality_targets: QUALITY_TARGETS,
    quality_weights: QUALITY_WEIGHTS,
    cold_start_threshold: COLD_START_THRESHOLD,
    cold_start_limits: COLD_START_LIMITS
  },
  bm25: {
    config: BM25_CONFIG,
    field_boosts: FIELD_BOOSTS,
    stopwords: STOPWORDS_CONFIG
  }
};
function daysBetween2(start, end) {
  return Math.floor((end.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24));
}
function semanticScore(node) {
  return node.semantic_score ?? 0;
}
function keywordScore(node, maxBM25, candidateCount) {
  if (maxBM25 === 0) return 0.5;
  if (candidateCount === 1) return 1;
  return (node.bm25_score ?? 0) / maxBM25;
}
function graphScore(node) {
  return node.graph_score ?? 0;
}
function recencyScore(lastAccessed, now = /* @__PURE__ */ new Date()) {
  const daysSince2 = daysBetween2(lastAccessed, now);
  return Math.exp(-daysSince2 / RERANKING_CONFIG.recency_half_life_days);
}
function authorityScore(inboundEdges, avgInbound) {
  if (avgInbound === 0) return 0.5;
  const ratio = inboundEdges / avgInbound;
  return Math.min(ratio / RERANKING_CONFIG.authority_cap_multiple, 1);
}
function affinityScore(accessCount, createdAt, lastAccessed, now = /* @__PURE__ */ new Date()) {
  const recency = recencyScore(lastAccessed, now);
  const interactionScore = Math.tanh(accessCount / RERANKING_CONFIG.affinity_saturation) * recency;
  const ageDays = daysBetween2(createdAt, now);
  const newContentBoost = ageDays < RERANKING_CONFIG.new_content_boost_days ? RERANKING_CONFIG.new_content_boost_value : 0;
  return Math.min(interactionScore + newContentBoost, 1);
}
function rerankCandidates(candidates, metrics, weights = RERANKING_WEIGHTS, now = /* @__PURE__ */ new Date()) {
  if (candidates.length === 0) return [];
  const maxBM25 = Math.max(...candidates.map((c) => c.bm25_score ?? 0));
  return candidates.map((node) => {
    const breakdown = {
      semantic: semanticScore(node),
      keyword: keywordScore(node, maxBM25, candidates.length),
      graph: graphScore(node),
      recency: recencyScore(node.last_accessed, now),
      authority: authorityScore(node.inbound_edge_count, metrics.avg_inbound_edges),
      affinity: affinityScore(node.access_count, node.created_at, node.last_accessed, now)
    };
    const score = weights.semantic * breakdown.semantic + weights.keyword * breakdown.keyword + weights.graph * breakdown.graph + weights.recency * breakdown.recency + weights.authority * breakdown.authority + weights.affinity * breakdown.affinity;
    const contributions = Object.entries(breakdown).map(([key, value]) => ({
      key,
      contribution: weights[key] * value
    }));
    const primary = contributions.reduce(
      (a, b) => b.contribution > a.contribution ? b : a
    ).key;
    return { node, score, breakdown, primary_signal: primary };
  }).sort((a, b) => b.score - a.score);
}
function calculateRetrievability(daysSinceAccess, stability) {
  if (stability <= 0) return 0;
  return Math.exp(-daysSinceAccess / stability);
}
function calculateDifficulty(type, contentLength, edgeCount) {
  const baseDifficulty = INITIAL_DIFFICULTY[type] ?? 0.3;
  const lengthFactor = Math.min(contentLength / 5e3, 1) * 0.15;
  const abstractionFactor = type === "concept" ? 0.1 : 0;
  const connectionBonus = -Math.min(edgeCount / 40, 1) * 0.15;
  return Math.max(0, Math.min(
    1,
    baseDifficulty + lengthFactor + abstractionFactor + connectionBonus
  ));
}
function updateStabilityOnAccess(stability, difficulty) {
  const difficultyFactor = 1 - difficulty * 0.5;
  return Math.min(
    stability * DECAY_CONFIG.growth_rate * difficultyFactor,
    DECAY_CONFIG.max_stability_days
  );
}
function getDecayLifecycleState(retrievability, daysDormant) {
  if (retrievability > DECAY_CONFIG.active_threshold) return "ACTIVE";
  if (retrievability > DECAY_CONFIG.weak_threshold) return "WEAK";
  if (daysDormant < DECAY_CONFIG.dormant_days) return "DORMANT";
  if (daysDormant < DECAY_CONFIG.compress_days) return "DORMANT";
  if (daysDormant < DECAY_CONFIG.archive_days) return "COMPRESS";
  return "ARCHIVE";
}
function applyCascadeDecay(edgeWeight, retrievability) {
  if (retrievability >= DECAY_CONFIG.weak_threshold) {
    return edgeWeight;
  }
  return Math.max(edgeWeight * DECAY_CONFIG.cascade_factor, DECAY_CONFIG.edge_floor);
}
function getInitialStability(type) {
  return INITIAL_STABILITY[type] ?? 14;
}
function getInitialDifficulty(type) {
  return INITIAL_DIFFICULTY[type] ?? 0.3;
}
function calculateRetrievalConfidence(topScore, secondScore, resultCount, hasAttribute) {
  if (resultCount === 0) {
    return {
      score: 0,
      level: "LOW",
      breakdown: { mq: 0, dt: 0, cm: 0 },
      flags: ["no_results"]
    };
  }
  const MQ = topScore;
  const scoreGap = secondScore !== null ? topScore - secondScore : 1;
  const gapNormalized = Math.min(scoreGap / 0.3, 1);
  let focus;
  if (resultCount === 1) focus = 1;
  else if (resultCount <= 5) focus = 0.8;
  else if (resultCount <= 15) focus = 0.5;
  else focus = 0.3;
  const DT = gapNormalized * 0.5 + focus * 0.5;
  const CM = hasAttribute ? 1 : 0.5;
  const MQ_safe = Math.max(MQ, 0.1);
  const DT_safe = Math.max(DT, 0.1);
  const CM_safe = Math.max(CM, 0.1);
  let score = Math.pow(MQ_safe, RCS_WEIGHTS.match_quality) * Math.pow(DT_safe, RCS_WEIGHTS.distinctiveness) * Math.pow(CM_safe, RCS_WEIGHTS.completeness);
  if (MQ < 0.3) score = Math.min(score, 0.4);
  if (DT < 0.2) score = Math.min(score, 0.4);
  if (!hasAttribute) score = Math.min(score, 0.7);
  const flags = [];
  if (resultCount > 1 && scoreGap < 0.15) flags.push("disambiguation_needed");
  if (resultCount < 3 && MQ < 0.6) flags.push("sparse_results");
  if (!hasAttribute) flags.push("attribute_unknown");
  if (MQ > 0.95 && DT > 0.8 && hasAttribute) flags.push("perfect_match");
  const level = getConfidenceLevel(score);
  return { score, level, breakdown: { mq: MQ, dt: DT, cm: CM }, flags };
}
function getConfidenceLevel(score) {
  if (score >= CONFIDENCE_THRESHOLDS.retrieval.high) return "HIGH";
  if (score >= CONFIDENCE_THRESHOLDS.retrieval.medium) return "MEDIUM";
  return "LOW";
}
function detectContradiction(similarity, logicalConflict, daysSinceExisting) {
  const supersessionLikelihood = daysSinceExisting > 90 ? 0.3 : 0;
  const score = Math.max(0, Math.min(
    1,
    similarity * 0.4 + logicalConflict * 0.5 - supersessionLikelihood
  ));
  if (score >= CONFIDENCE_THRESHOLDS.contradiction.definite) {
    return {
      level: "definite",
      score,
      action: "flag_user",
      explanation: `High conflict detected (${(score * 100).toFixed(0)}%): new info may contradict existing knowledge`
    };
  }
  if (score >= CONFIDENCE_THRESHOLDS.contradiction.possible) {
    return {
      level: "possible",
      score,
      action: "note_internal",
      explanation: `Moderate conflict (${(score * 100).toFixed(0)}%): noted for potential review`
    };
  }
  return {
    level: "none",
    score,
    action: "safe_to_store",
    explanation: "No significant conflict detected"
  };
}
function calculateAdaptiveLimits(graphSize, graphDensity, queryType) {
  if (graphSize < COLD_START_THRESHOLD) {
    return {
      ...COLD_START_LIMITS,
      max_nodes: Math.min(COLD_START_LIMITS.max_nodes, Math.ceil(graphSize * 0.5))
    };
  }
  const entryPoints = Math.max(2, Math.min(5, Math.ceil(Math.log10(graphSize))));
  let maxHops;
  if (graphDensity < 1e-3) maxHops = 5;
  else if (graphDensity < 0.01) maxHops = 4;
  else if (graphDensity < 0.05) maxHops = 3;
  else maxHops = 2;
  const percentageMap = {
    simple: 0.02,
    standard: 0.05,
    complex: 0.1
  };
  const percentage = percentageMap[queryType];
  const budgetKey = `${queryType}_query`;
  const budgetLookup = OPERATION_BUDGETS[budgetKey];
  const budget = budgetLookup ?? OPERATION_BUDGETS["standard_query"];
  const maxNodes = Math.max(
    50,
    Math.min(Math.ceil(graphSize * percentage), budget.max_nodes)
  );
  return { entry_points: entryPoints, max_hops: maxHops, max_nodes: maxNodes };
}
function calculateQualityScore(coverage, matchQuality, convergence) {
  return coverage * QUALITY_WEIGHTS.coverage + matchQuality * QUALITY_WEIGHTS.match_quality + convergence * QUALITY_WEIGHTS.convergence;
}
function shouldTerminate(currentQuality, targetQuality, convergence, lowConvergenceSteps, remainingBudget) {
  if (currentQuality >= targetQuality) {
    return { terminate: true, reason: "quality_target_met" };
  }
  if (convergence < 0.02 && lowConvergenceSteps >= 2) {
    return { terminate: true, reason: "converged" };
  }
  if (remainingBudget.time_ms <= 0) {
    return { terminate: true, reason: "time_exhausted" };
  }
  if (remainingBudget.max_nodes <= 0) {
    return { terminate: true, reason: "node_limit_reached" };
  }
  return { terminate: false, reason: "" };
}
function getBudgetForOperation(operation) {
  const budget = OPERATION_BUDGETS[operation];
  return budget ?? OPERATION_BUDGETS["standard_query"];
}
function getQualityTargetForQueryType(queryType) {
  const target = QUALITY_TARGETS[queryType];
  return target ?? QUALITY_TARGETS["REASONING"];
}
function getEffectiveStopwords(config = STOPWORDS_CONFIG) {
  return /* @__PURE__ */ new Set([...config.default_list, ...config.custom_additions]);
}
function removeStopwords(tokens, stopwords) {
  return tokens.filter((token) => !stopwords.has(token.toLowerCase()));
}
function shouldIndexTerm(term, docFrequency, totalDocs, config = BM25_CONFIG) {
  if (term.length < config.min_term_length) return false;
  if (term.length > config.max_term_length) return false;
  if (docFrequency < 1) return false;
  if (totalDocs === 0) return docFrequency >= 1;
  const frequencyRatio = docFrequency / totalDocs;
  if (frequencyRatio > config.max_doc_frequency_ratio) return false;
  return true;
}
function getFieldBoost(field) {
  const boost = FIELD_BOOSTS.find((fb) => fb.field === field);
  return boost?.boost ?? 1;
}
function validateRerankingWeights(weights) {
  return RerankingWeightsSchema.safeParse(weights).success;
}
function validateRerankingConfig(config) {
  return RerankingConfigSchema.safeParse(config).success;
}
function validateDecayConfig(config) {
  return DecayConfigSchema.safeParse(config).success;
}
function validateSSAParams(params) {
  return SSAParamsSchema.safeParse(params).success;
}
function validateSSAEdgeWeights(weights) {
  return SSAEdgeWeightsSchema.safeParse(weights).success;
}
function validateConfidenceThresholds(thresholds) {
  return ConfidenceThresholdsSchema.safeParse(thresholds).success;
}
function validateBudgetConfig(config) {
  return BudgetConfigSchema.safeParse(config).success;
}
function validateAdaptiveLimits(limits) {
  return AdaptiveLimitsSchema.safeParse(limits).success;
}
function validateBM25Config(config) {
  return BM25ConfigSchema.safeParse(config).success;
}
function validateQualityTarget(target) {
  return QualityTargetSchema.safeParse(target).success;
}
function validateGraphMetrics(metrics) {
  return GraphMetricsSchema.safeParse(metrics).success;
}
var SERENDIPITY_LEVELS = ["off", "low", "medium", "high"];
var QUERY_COMBINATION_STRATEGIES = ["average", "max_pooling"];
var SERENDIPITY_THRESHOLDS = {
  off: { minGraph: 1, maxSim: 0, count: 0 },
  low: { minGraph: 0.4, maxSim: 0.5, count: 2 },
  medium: { minGraph: 0.3, maxSim: 0.5, count: 5 },
  high: { minGraph: 0.2, maxSim: 0.5, count: 10 }
};
var DateRangeFilterSchema = z.object({
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional()
}).refine(
  (data) => {
    if (data.after && data.before) {
      return new Date(data.after) <= new Date(data.before);
    }
    return true;
  },
  { message: "after must be before or equal to before" }
);
var LastAccessedFilterSchema = z.object({
  within_days: z.number().int().positive()
});
var SSASearchFiltersSchema = z.object({
  date_range: DateRangeFilterSchema.optional(),
  last_accessed: LastAccessedFilterSchema.optional(),
  types: z.array(z.string().max(100)).max(50).optional(),
  exclude_types: z.array(z.string().max(100)).max(50).optional(),
  clusters: z.array(z.string().min(1).max(100)).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
  tags_any: z.array(z.string().min(1).max(50)).optional(),
  exclude_tags: z.array(z.string().min(1).max(50)).optional(),
  relationships: z.array(z.string().max(100)).max(30).optional(),
  connected_to: z.string().min(1).max(100).optional(),
  within_hops: z.number().int().min(1).max(10).optional()
});
var SearchRequestSchema = z.object({
  query: z.string().min(1).max(2e3).optional(),
  queries: z.array(z.string().min(1).max(2e3)).max(10).optional(),
  filters: SSASearchFiltersSchema.optional(),
  serendipity_level: z.enum(SERENDIPITY_LEVELS).optional(),
  query_combination: z.enum(QUERY_COMBINATION_STRATEGIES).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  include_connections: z.boolean().optional()
}).refine(
  (data) => data.query !== void 0 || data.queries !== void 0 && data.queries.length > 0,
  { message: "Either query or queries must be provided" }
);
var SSAScoreBreakdownSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1)
});
var RankingReasonSchema = z.object({
  primary_signal: z.enum(["semantic", "keyword", "graph", "recency", "authority", "affinity"]),
  explanation: z.string(),
  score_breakdown: SSAScoreBreakdownSchema
});
var SSARankedNodeSchema = z.object({
  node_id: z.string(),
  score: z.number().min(0).max(1),
  ranking_reason: RankingReasonSchema
});
var NodeConnectionSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  edge_type: z.string(),
  weight: z.number().min(0).max(1)
});
var ConnectionMapSchema = z.object({
  connections: z.array(NodeConnectionSchema),
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative()
});
var SerendipityCandidateSchema = z.object({
  node_id: z.string(),
  semantic_score: z.number().min(0).max(1),
  graph_score: z.number().min(0).max(1),
  connection_path: z.array(z.string()),
  explanation: z.string()
});
var ExecutionMetricsSchema = z.object({
  total_ms: z.number().nonnegative(),
  parse_filters_ms: z.number().nonnegative(),
  embed_queries_ms: z.number().nonnegative(),
  hybrid_seeding_ms: z.number().nonnegative(),
  spreading_ms: z.number().nonnegative(),
  reranking_ms: z.number().nonnegative(),
  seeds_found: z.number().int().nonnegative(),
  nodes_activated: z.number().int().nonnegative(),
  nodes_returned: z.number().int().nonnegative()
});
var SearchResponseSchema = z.object({
  results: z.array(SSARankedNodeSchema),
  filters_applied: SSASearchFiltersSchema,
  total_candidates: z.number().int().nonnegative(),
  execution_time_ms: z.number().nonnegative(),
  metrics: ExecutionMetricsSchema
});
var SSAResultSchema = z.object({
  original_queries: z.array(z.string()),
  filters_applied: SSASearchFiltersSchema,
  relevant_nodes: z.array(SSARankedNodeSchema),
  connection_map: ConnectionMapSchema.optional(),
  ranking_reasons: z.record(z.string(), RankingReasonSchema),
  serendipity_candidates: z.array(SerendipityCandidateSchema).optional(),
  metrics: ExecutionMetricsSchema
});
var SSAConfigSchema = z.object({
  seed_threshold: z.number().min(0).max(1),
  dense_weight: z.number().min(0).max(1),
  bm25_weight: z.number().min(0).max(1),
  max_seeds: z.number().int().positive(),
  initial_activation: z.number().min(0).max(1),
  hop_decay: z.number().min(0).max(1),
  min_threshold: z.number().min(0).max(1),
  max_hops: z.number().int().positive(),
  max_nodes: z.number().int().positive(),
  aggregation: z.enum(["sum", "max"]),
  query_combination: z.enum(QUERY_COMBINATION_STRATEGIES),
  default_limit: z.number().int().positive()
});
var DEFAULT_SSA_CONFIG = {
  seed_threshold: SSA_SEED_THRESHOLD,
  dense_weight: DENSE_WEIGHT,
  bm25_weight: BM25_WEIGHT,
  max_seeds: 15,
  initial_activation: SSA_PARAMS.initial_activation,
  hop_decay: SSA_PARAMS.hop_decay,
  min_threshold: SSA_PARAMS.min_threshold,
  max_hops: SSA_PARAMS.max_hops,
  max_nodes: SSA_PARAMS.max_nodes,
  aggregation: SSA_PARAMS.aggregation,
  query_combination: "average",
  default_limit: 30
};
var SeedNodeSchema = z.object({
  node_id: z.string(),
  vector_score: z.number().min(0).max(1),
  bm25_score: z.number().nonnegative(),
  combined_score: z.number().min(0).max(1)
});
var SeedingResultSchema = z.object({
  seeds: z.array(SeedNodeSchema),
  vector_candidates: z.number().int().nonnegative(),
  bm25_candidates: z.number().int().nonnegative(),
  combined_candidates: z.number().int().nonnegative(),
  execution_ms: z.number().nonnegative()
});
var SSAActivatedNodeSchema = z.object({
  node_id: z.string(),
  activation: z.number().min(0),
  hop_distance: z.number().int().nonnegative(),
  activation_path: z.array(z.string()),
  is_seed: z.boolean(),
  vector_score: z.number().min(0).max(1),
  bm25_score: z.number().nonnegative()
});
var SpreadingResultSchema = z.object({
  activated: z.array(SSAActivatedNodeSchema),
  hops_completed: z.number().int().nonnegative(),
  nodes_visited: z.number().int().nonnegative(),
  edges_traversed: z.number().int().nonnegative(),
  terminated_reason: z.enum(["max_hops", "max_nodes", "no_spread", "threshold"]),
  execution_ms: z.number().nonnegative()
});
var FilterNodeInputSchema = z.object({
  id: z.string(),
  type: z.string(),
  created_at: z.string().datetime(),
  last_accessed: z.string().datetime(),
  clusters: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
});
var FilterEdgeInputSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  target_id: z.string(),
  edge_type: z.string()
});
function buildFilterPredicate(filters) {
  const now = /* @__PURE__ */ new Date();
  const evaluateNode2 = (node) => {
    if (filters.date_range) {
      const created = new Date(node.created_at);
      if (filters.date_range.after && created < new Date(filters.date_range.after)) {
        return false;
      }
      if (filters.date_range.before && created > new Date(filters.date_range.before)) {
        return false;
      }
    }
    if (filters.last_accessed) {
      const lastAccessed = new Date(node.last_accessed);
      const daysAgo = (now.getTime() - lastAccessed.getTime()) / (1e3 * 60 * 60 * 24);
      if (daysAgo > filters.last_accessed.within_days) {
        return false;
      }
    }
    if (filters.types && filters.types.length > 0) {
      if (!filters.types.includes(node.type)) {
        return false;
      }
    }
    if (filters.exclude_types && filters.exclude_types.length > 0) {
      if (filters.exclude_types.includes(node.type)) {
        return false;
      }
    }
    if (filters.clusters && filters.clusters.length > 0) {
      if (!node.clusters || !filters.clusters.some((c) => node.clusters.includes(c))) {
        return false;
      }
    }
    if (filters.tags && filters.tags.length > 0) {
      if (!node.tags || !filters.tags.every((t) => node.tags.includes(t))) {
        return false;
      }
    }
    if (filters.tags_any && filters.tags_any.length > 0) {
      if (!node.tags || !filters.tags_any.some((t) => node.tags.includes(t))) {
        return false;
      }
    }
    if (filters.exclude_tags && filters.exclude_tags.length > 0) {
      if (node.tags && filters.exclude_tags.some((t) => node.tags.includes(t))) {
        return false;
      }
    }
    return true;
  };
  const evaluateEdge = (edge) => {
    if (filters.relationships && filters.relationships.length > 0) {
      if (!filters.relationships.includes(edge.edge_type)) {
        return false;
      }
    }
    return true;
  };
  return { filters, evaluateNode: evaluateNode2, evaluateEdge };
}
function parseFilters(filters) {
  const result = SSASearchFiltersSchema.safeParse(filters);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}
async function hybridSeed(queryEmbedding, queryTerms, context, predicate, config) {
  const startTime = performance.now();
  const vectorResults = await context.vectorSearch(queryEmbedding, config.max_seeds * 3);
  const bm25Results = await context.bm25Search(queryTerms, config.max_seeds * 3);
  const scoreMap = /* @__PURE__ */ new Map();
  const maxBm25 = Math.max(...bm25Results.map((r) => r.score), 1);
  for (const result of vectorResults) {
    scoreMap.set(result.nodeId, { vector: result.score, bm25: 0 });
  }
  for (const result of bm25Results) {
    const existing = scoreMap.get(result.nodeId);
    const normalizedBm25 = result.score / maxBm25;
    if (existing) {
      existing.bm25 = normalizedBm25;
    } else {
      scoreMap.set(result.nodeId, { vector: 0, bm25: normalizedBm25 });
    }
  }
  const seeds = [];
  for (const [nodeId, scores] of scoreMap) {
    const combined = config.dense_weight * scores.vector + config.bm25_weight * scores.bm25;
    if (combined >= config.seed_threshold) {
      const node = await context.getNode(nodeId);
      if (node && predicate.evaluateNode(node)) {
        seeds.push({
          node_id: nodeId,
          vector_score: scores.vector,
          bm25_score: scores.bm25,
          combined_score: combined
        });
      }
    }
  }
  seeds.sort((a, b) => b.combined_score - a.combined_score);
  const limitedSeeds = seeds.slice(0, config.max_seeds);
  return {
    seeds: limitedSeeds,
    vector_candidates: vectorResults.length,
    bm25_candidates: bm25Results.length,
    combined_candidates: scoreMap.size,
    execution_ms: performance.now() - startTime
  };
}
function getSSAEdgeWeight(edgeType) {
  const weights = SSA_EDGE_WEIGHTS;
  return weights[edgeType] ?? 0.5;
}
async function spreadActivation(seeds, context, predicate, config) {
  const startTime = performance.now();
  const activations = /* @__PURE__ */ new Map();
  const toProcess = [];
  for (const seed of seeds) {
    const activation = config.initial_activation * seed.combined_score;
    activations.set(seed.node_id, {
      node_id: seed.node_id,
      activation,
      hop_distance: 0,
      activation_path: [seed.node_id],
      is_seed: true,
      vector_score: seed.vector_score,
      bm25_score: seed.bm25_score
    });
    toProcess.push({ nodeId: seed.node_id, activation, hop: 0, path: [seed.node_id] });
  }
  let nodesVisited = seeds.length;
  let edgesTraversed = 0;
  let hopsCompleted = 0;
  let terminatedReason = "max_hops";
  while (toProcess.length > 0 && hopsCompleted < config.max_hops) {
    const nextRound = [];
    hopsCompleted++;
    for (const { nodeId, activation, hop, path } of toProcess) {
      if (activation < config.min_threshold) {
        continue;
      }
      const neighbors = await context.getNeighbors(nodeId);
      for (const neighbor of neighbors) {
        edgesTraversed++;
        if (!predicate.evaluateEdge(neighbor.edge)) {
          continue;
        }
        if (!predicate.evaluateNode(neighbor.node)) {
          continue;
        }
        const edgeWeight = getSSAEdgeWeight(neighbor.edge.edge_type);
        const spread = activation * edgeWeight * config.hop_decay;
        if (spread < config.min_threshold) {
          continue;
        }
        const neighborId = neighbor.node.id;
        const existing = activations.get(neighborId);
        if (existing) {
          if (config.aggregation === "sum") {
            existing.activation += spread;
          } else {
            existing.activation = Math.max(existing.activation, spread);
          }
          if (hop + 1 < existing.hop_distance) {
            existing.hop_distance = hop + 1;
            existing.activation_path = [...path, neighborId];
          }
        } else {
          const newNode = {
            node_id: neighborId,
            activation: spread,
            hop_distance: hop + 1,
            activation_path: [...path, neighborId],
            is_seed: false,
            vector_score: 0,
            bm25_score: 0
          };
          activations.set(neighborId, newNode);
          nodesVisited++;
          if (nodesVisited >= config.max_nodes) {
            terminatedReason = "max_nodes";
            break;
          }
        }
        nextRound.push({
          nodeId: neighborId,
          activation: spread,
          hop: hop + 1,
          path: [...path, neighborId]
        });
      }
      if (nodesVisited >= config.max_nodes) {
        break;
      }
    }
    if (nodesVisited >= config.max_nodes) {
      break;
    }
    if (nextRound.length === 0) {
      terminatedReason = "no_spread";
      break;
    }
    toProcess.length = 0;
    toProcess.push(...nextRound);
  }
  const activated = Array.from(activations.values());
  for (const node of activated) {
    node.activation = Math.min(node.activation, 1);
  }
  return {
    activated,
    hops_completed: hopsCompleted,
    nodes_visited: nodesVisited,
    edges_traversed: edgesTraversed,
    terminated_reason: terminatedReason,
    execution_ms: performance.now() - startTime
  };
}
async function buildScoredNodes(activated, context) {
  const scoredNodes = [];
  for (const node of activated) {
    const rerankData = await context.getNodeForReranking(node.node_id);
    if (rerankData) {
      scoredNodes.push({
        id: node.node_id,
        semantic_score: node.vector_score,
        bm25_score: node.bm25_score,
        graph_score: node.activation,
        last_accessed: rerankData.last_accessed,
        created_at: rerankData.created_at,
        access_count: rerankData.access_count,
        inbound_edge_count: rerankData.inbound_edge_count
      });
    }
  }
  return scoredNodes;
}
function convertToSSARankedNodes(ranked) {
  return ranked.map((r) => ({
    node_id: r.node.id,
    score: r.score,
    ranking_reason: {
      primary_signal: r.primary_signal,
      explanation: generateExplanation(r.primary_signal, r.breakdown),
      score_breakdown: r.breakdown
    }
  }));
}
function identifySerendipity(activated, level) {
  if (level === "off") {
    return [];
  }
  const threshold = SERENDIPITY_THRESHOLDS[level];
  const candidates = [];
  for (const node of activated) {
    if (node.vector_score < threshold.maxSim && node.activation >= threshold.minGraph) {
      candidates.push({
        node_id: node.node_id,
        semantic_score: node.vector_score,
        graph_score: node.activation,
        connection_path: node.activation_path,
        explanation: `Connected via ${node.hop_distance} hops despite low semantic similarity`
      });
    }
  }
  candidates.sort((a, b) => b.graph_score - a.graph_score);
  return candidates.slice(0, threshold.count);
}
async function buildConnectionMap(activated, context, predicate) {
  const activatedIds = new Set(activated.map((n) => n.node_id));
  const connections = [];
  for (const node of activated) {
    const neighbors = await context.getNeighbors(node.node_id);
    for (const neighbor of neighbors) {
      if (activatedIds.has(neighbor.node.id)) {
        if (predicate.evaluateEdge(neighbor.edge)) {
          connections.push({
            source_id: node.node_id,
            target_id: neighbor.node.id,
            edge_type: neighbor.edge.edge_type,
            weight: neighbor.weight
          });
        }
      }
    }
  }
  return {
    connections,
    node_count: activated.length,
    edge_count: connections.length
  };
}
function getNormalizedQueries(request) {
  if (request.queries && request.queries.length > 0) {
    return request.queries;
  }
  if (request.query) {
    return [request.query];
  }
  return [];
}
function extractQueryTerms(queries) {
  const terms = [];
  for (const query of queries) {
    const tokens = query.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
    terms.push(...tokens);
  }
  return [...new Set(terms)];
}
function mergeSSAConfig(partial) {
  if (!partial) return DEFAULT_SSA_CONFIG;
  return { ...DEFAULT_SSA_CONFIG, ...partial };
}
function createEmptyMetrics() {
  return {
    total_ms: 0,
    parse_filters_ms: 0,
    embed_queries_ms: 0,
    hybrid_seeding_ms: 0,
    spreading_ms: 0,
    reranking_ms: 0,
    seeds_found: 0,
    nodes_activated: 0,
    nodes_returned: 0
  };
}
function generateExplanation(primary, breakdown) {
  const score = breakdown[primary];
  const percentage = Math.round(score * 100);
  switch (primary) {
    case "semantic":
      return `Strong semantic match (${percentage}% similarity)`;
    case "keyword":
      return `Keyword match in content (${percentage}% BM25 score)`;
    case "graph":
      return `Connected via knowledge graph (${percentage}% activation)`;
    case "recency":
      return `Recently accessed (${percentage}% recency score)`;
    case "authority":
      return `Well-connected node (${percentage}% authority)`;
    case "affinity":
      return `Frequently accessed by user (${percentage}% affinity)`;
    default:
      return `Primary signal: ${primary} (${percentage}%)`;
  }
}
function getSerendipityThreshold(level) {
  return SERENDIPITY_THRESHOLDS[level];
}
function validateSearchRequest(request) {
  return SearchRequestSchema.safeParse(request).success;
}
function validateSearchFilters(filters) {
  return SSASearchFiltersSchema.safeParse(filters).success;
}
function validateSSAConfig(config) {
  return SSAConfigSchema.safeParse(config).success;
}
function validateSSAResult(result) {
  return SSAResultSchema.safeParse(result).success;
}
function parseSearchRequest(request) {
  const result = SearchRequestSchema.safeParse(request);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}
async function executeSSA(options) {
  const startTime = performance.now();
  const metrics = createEmptyMetrics();
  const { request, context, embed, config: partialConfig } = options;
  const config = mergeSSAConfig(partialConfig);
  const parseResult = parseSearchRequest(request);
  if (!parseResult.success) {
    throw new Error("Invalid search request: validation failed. Ensure query or queries is provided.");
  }
  const filterStart = performance.now();
  const filters = request.filters ?? {};
  const predicate = buildFilterPredicate(filters);
  metrics.parse_filters_ms = performance.now() - filterStart;
  const queries = getNormalizedQueries(request);
  if (queries.length === 0) {
    throw new Error("No queries provided");
  }
  const embedStart = performance.now();
  const queryEmbedding = await embed(queries);
  metrics.embed_queries_ms = performance.now() - embedStart;
  const queryTerms = extractQueryTerms(queries);
  const seedingStart = performance.now();
  const seedingResult = await hybridSeed(queryEmbedding, queryTerms, context, predicate, config);
  metrics.hybrid_seeding_ms = performance.now() - seedingStart;
  metrics.seeds_found = seedingResult.seeds.length;
  if (seedingResult.seeds.length === 0) {
    metrics.total_ms = performance.now() - startTime;
    return {
      original_queries: queries,
      filters_applied: filters,
      relevant_nodes: [],
      ranking_reasons: {},
      metrics
    };
  }
  const spreadingStart = performance.now();
  const spreadingResult = await spreadActivation(seedingResult.seeds, context, predicate, config);
  metrics.spreading_ms = performance.now() - spreadingStart;
  metrics.nodes_activated = spreadingResult.activated.length;
  const rerankingStart = performance.now();
  const graphMetrics = await context.getGraphMetrics();
  const scoredNodes = await buildScoredNodes(spreadingResult.activated, context);
  const rankedNodes = rerankCandidates(scoredNodes, graphMetrics);
  metrics.reranking_ms = performance.now() - rerankingStart;
  const limit = request.limit ?? config.default_limit;
  const limitedRanked = rankedNodes.slice(0, limit);
  const ssaRankedNodes = convertToSSARankedNodes(limitedRanked);
  metrics.nodes_returned = ssaRankedNodes.length;
  const rankingReasons = {};
  for (const node of ssaRankedNodes) {
    rankingReasons[node.node_id] = node.ranking_reason;
  }
  const result = {
    original_queries: queries,
    filters_applied: filters,
    relevant_nodes: ssaRankedNodes,
    ranking_reasons: rankingReasons,
    metrics
  };
  if (request.include_connections) {
    result.connection_map = await buildConnectionMap(
      spreadingResult.activated,
      context,
      predicate
    );
  }
  const serendipityLevel = request.serendipity_level ?? "off";
  if (serendipityLevel !== "off") {
    result.serendipity_candidates = identifySerendipity(spreadingResult.activated, serendipityLevel);
  }
  metrics.total_ms = performance.now() - startTime;
  return result;
}
function createSearchResponse(result) {
  return {
    results: result.relevant_nodes,
    filters_applied: result.filters_applied,
    total_candidates: result.metrics.nodes_activated,
    execution_time_ms: result.metrics.total_ms,
    metrics: result.metrics
  };
}
var DISQUALIFIER_CATEGORIES = ["D1", "D2", "D3", "D4", "D5", "D6"];
var QCS_QUERY_TYPES = ["LOOKUP", "AMBIGUOUS"];
var SKIP_DECISIONS = ["SKIP", "SKIP_WITH_CAVEAT", "PHASE2"];
var D1_REASONING_PATTERNS = [
  /\bhow does\b/i,
  /\bhow do\b/i,
  /\bhow is\b/i,
  /\bwhy does\b/i,
  /\bwhy is\b/i,
  /\bwhy did\b/i,
  /\brelate\b/i,
  /\brelationship\b/i,
  /\bconnection\b/i,
  /\bcompare\b/i,
  /\bcomparison\b/i,
  /\bdifference\b/i,
  /\bversus\b/i,
  /\bvs\b/i,
  /\bexplain\b/i,
  /\bsummarize\b/i,
  /\bdescribe\b/i,
  /\bwhat do I know about\b/i,
  /\btell me about\b/i
];
var D2_NEGATION_PATTERNS = [
  /\bnot in\b/i,
  /\bnot included\b/i,
  /\bmissing from\b/i,
  /\bnever\b/i,
  /\bwithout\b/i,
  /\bexcept\b/i,
  /\bwhat don't I\b/i,
  /\bwhat haven't I\b/i
];
var D3_TIME_PATTERNS = [
  // Relative time
  /\blast week\b/i,
  /\byesterday\b/i,
  /\brecently\b/i,
  /\blast month\b/i,
  /\blast year\b/i,
  /\btoday\b/i,
  /\bthis week\b/i,
  /\bthis month\b/i,
  // Specific time
  /\bin (january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\bon (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bin \d{4}\b/i,
  // Time ranges
  /\bbetween\b/i,
  /\bfrom .+ to\b/i,
  /\bduring\b/i
];
var D4_COMPOUND_PATTERNS = [
  /\?\s*\S+.*\?/,
  // Multiple question marks with content between
  /\band what\b/i,
  /\band when\b/i,
  /\band where\b/i,
  /\band who\b/i,
  /\band how\b/i,
  /\band why\b/i,
  /\balso\b.*\?/i
];
var D5_REFERENCE_PATTERNS = [
  /\btheir\b/i,
  /\bhis\b/i,
  /\bher\b/i,
  /\bits\b/i,
  /\bthat\b/i,
  /\bthis\b/i,
  /\bthe same\b/i,
  /\bthe other\b/i
];
var D6_EXPLORATION_PATTERNS = [
  /\bwhat else\b/i,
  /\banything related\b/i,
  /\bmore about\b/i,
  /\bsimilar to\b/i,
  /\blike \S+\b/i,
  /\bbrainstorm\b/i,
  /\bideas for\b/i,
  /\bsuggest\b/i
];
var DISQUALIFIER_PATTERNS = {
  D1: D1_REASONING_PATTERNS,
  D2: D2_NEGATION_PATTERNS,
  D3: D3_TIME_PATTERNS,
  D4: D4_COMPOUND_PATTERNS,
  D5: D5_REFERENCE_PATTERNS,
  D6: D6_EXPLORATION_PATTERNS
};
var LOOKUP_PATTERNS = [
  // "What's X's Y?"
  /\bwhat(?:'s|'s| is)\s+(\S+(?:\s+\S+)?)'s\s+(\S+)/i,
  // "What is X's Y?"
  /\bwhat is\s+(\S+(?:\s+\S+)?)'s\s+(\S+)/i,
  // "X's Y?"
  /^(\S+(?:\s+\S+)?)'s\s+(\S+)\??$/i,
  // "Y for X?"
  /\b(\S+)\s+for\s+(\S+(?:\s+\S+)?)\??$/i,
  // "Who is X?"
  /\bwho is\s+(\S+(?:\s+\S+)?)\??$/i,
  // "Where is X?"
  /\bwhere is\s+(\S+(?:\s+\S+)?)\??$/i,
  // "When is X?"
  /\bwhen is\s+(\S+(?:\s+\S+)?)\??$/i
];
var ATTRIBUTE_KEYWORDS = [
  "phone",
  "email",
  "address",
  "birthday",
  "number",
  "date",
  "name",
  "title",
  "location",
  "id",
  "link",
  "url",
  "contact",
  "age",
  "status",
  "role",
  "position",
  "company",
  "team",
  "project"
];
var DisqualifierResultSchema = z.object({
  disqualified: z.boolean(),
  reason: z.string().optional(),
  category: z.enum(DISQUALIFIER_CATEGORIES).optional(),
  pattern: z.string().optional()
});
var QueryTypeResultSchema = z.object({
  type: z.enum(QCS_QUERY_TYPES),
  entity: z.string().optional(),
  attribute: z.string().optional(),
  confidence: z.number().min(0).max(1)
});
var ClassificationResultSchema = z.object({
  query: z.string(),
  queryType: QueryTypeResultSchema,
  rcs: z.object({
    score: z.number().min(0).max(1),
    level: z.enum(["HIGH", "MEDIUM", "LOW"]),
    flags: z.array(z.string())
  }),
  decision: z.enum(SKIP_DECISIONS),
  explanation: z.string(),
  handoff: z.lazy(() => Phase2HandoffMetadataSchema).optional()
});
var CLASSIFICATION_REASONS = [
  "reasoning_query",
  "low_confidence",
  "no_answer_found",
  "disambiguation",
  "compound_query",
  "time_reference",
  "exploration",
  "unresolved_reference",
  "negation_query",
  "ambiguous_query"
];
var Phase2HandoffMetadataSchema = z.object({
  classification_reason: z.enum(CLASSIFICATION_REASONS),
  phase1_results: z.array(z.object({
    node_id: z.string(),
    score: z.number().min(0).max(1)
  })).max(100),
  query_analysis: z.object({
    type: z.enum(QCS_QUERY_TYPES),
    entities: z.array(z.string()).max(20),
    attribute: z.string().nullable(),
    confidence: z.number().min(0).max(1)
  })
});
var QCSConfigSchema = z.object({
  debug: z.boolean().optional(),
  customDisqualifiers: z.array(z.instanceof(RegExp)).optional(),
  customLookupPatterns: z.array(z.instanceof(RegExp)).optional()
});
function getDisqualifierDescription(category) {
  const descriptions = {
    D1: "Reasoning query (how/why/explain)",
    D2: "Negation query (not/never/except)",
    D3: "Time reference (last week/in September)",
    D4: "Compound query (multiple questions)",
    D5: "Unresolved reference (their/his/it)",
    D6: "Exploration query (what else/similar to)"
  };
  return descriptions[category];
}
function categoryToReason(category) {
  const mapping = {
    D1: "reasoning_query",
    D2: "negation_query",
    D3: "time_reference",
    D4: "compound_query",
    D5: "unresolved_reference",
    D6: "exploration"
  };
  return mapping[category];
}
function isBlockingFlag(flag) {
  const blockingFlags = [
    "disambiguation_needed",
    "sparse_results",
    "no_results"
  ];
  return blockingFlags.includes(flag);
}
function generateDecisionExplanation(decision, queryType, rcsLevel, flags, disqualified) {
  if (disqualified) {
    return `Query disqualified by ${disqualified}: ${getDisqualifierDescription(disqualified)}. Proceeding to Phase 2.`;
  }
  if (queryType === "AMBIGUOUS") {
    return "Query type is AMBIGUOUS. Proceeding to Phase 2 for clarification.";
  }
  const blockingFlags = flags.filter(isBlockingFlag);
  if (blockingFlags.length > 0) {
    return `LOOKUP query with ${rcsLevel} confidence, but blocked by: ${blockingFlags.join(", ")}. Proceeding to Phase 2.`;
  }
  switch (decision) {
    case "SKIP":
      return `LOOKUP query with HIGH confidence and no blocking flags. Answering directly from Phase 1.`;
    case "SKIP_WITH_CAVEAT":
      return `LOOKUP query with MEDIUM confidence. Answering with uncertainty note.`;
    case "PHASE2":
      return `LOOKUP query with ${rcsLevel} confidence. Proceeding to Phase 2 for verification.`;
    default:
      return `Decision: ${decision}`;
  }
}
function checkDisqualifiers(query) {
  for (const category of DISQUALIFIER_CATEGORIES) {
    const patterns = DISQUALIFIER_PATTERNS[category];
    for (const pattern of patterns) {
      if (pattern.test(query)) {
        return {
          disqualified: true,
          reason: getDisqualifierDescription(category),
          category,
          pattern: pattern.source
        };
      }
    }
  }
  return { disqualified: false };
}
function cleanExtractedValue(value) {
  if (!value) return void 0;
  return value.replace(/[?!.,;:]+$/, "").trim();
}
function classifyQueryType(query) {
  for (const pattern of LOOKUP_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      const entity = cleanExtractedValue(match[1]?.trim());
      const attribute = cleanExtractedValue(match[2]?.trim());
      let confidence = 0.7;
      if (attribute && ATTRIBUTE_KEYWORDS.some(
        (kw) => attribute.toLowerCase().includes(kw.toLowerCase())
      )) {
        confidence = Math.min(confidence + 0.15, 1);
      }
      if (query.trim().endsWith("?")) {
        confidence = Math.min(confidence + 0.05, 1);
      }
      if (query.length < 50) {
        confidence = Math.min(confidence + 0.05, 1);
      }
      return {
        type: "LOOKUP",
        entity: entity || void 0,
        attribute: attribute || void 0,
        confidence
      };
    }
  }
  const hasAttributeKeyword = ATTRIBUTE_KEYWORDS.some(
    (kw) => query.toLowerCase().includes(kw.toLowerCase())
  );
  if (hasAttributeKeyword) {
    const simpleMatch = query.match(/(\S+(?:\s+\S+)?)'s\s+(\S+)/i);
    if (simpleMatch) {
      return {
        type: "LOOKUP",
        entity: cleanExtractedValue(simpleMatch[1]?.trim()),
        attribute: cleanExtractedValue(simpleMatch[2]?.trim()),
        confidence: 0.6
      };
    }
    return {
      type: "LOOKUP",
      attribute: ATTRIBUTE_KEYWORDS.find(
        (kw) => query.toLowerCase().includes(kw.toLowerCase())
      ),
      confidence: 0.5
    };
  }
  return {
    type: "AMBIGUOUS",
    confidence: 0.3
  };
}
function extractQueryEntities(query) {
  const entities = [];
  const possessiveMatches = query.matchAll(/(?:^|\s)(\w+)'s\s+/gi);
  for (const match of possessiveMatches) {
    const cleaned = cleanExtractedValue(match[1]);
    if (cleaned) {
      entities.push(cleaned);
    }
  }
  const forMatches = query.matchAll(/\bfor\s+(\w+(?:\s+\w+)?)\b/gi);
  for (const match of forMatches) {
    const cleaned = cleanExtractedValue(match[1]);
    if (cleaned) {
      entities.push(cleaned);
    }
  }
  const isMatches = query.matchAll(/\b(?:who|where|when) is\s+(\w+(?:\s+\w+)?)\b/gi);
  for (const match of isMatches) {
    const cleaned = cleanExtractedValue(match[1]);
    if (cleaned) {
      entities.push(cleaned);
    }
  }
  return [...new Set(entities)];
}
function extractQueryAttribute(query) {
  const possessiveMatch = query.match(/\S+'s\s+(\w+)/i);
  if (possessiveMatch?.[1]) {
    return cleanExtractedValue(possessiveMatch[1].trim()) ?? null;
  }
  const forMatch = query.match(/^(\w+)\s+for\s+/i);
  if (forMatch?.[1]) {
    return cleanExtractedValue(forMatch[1].trim()) ?? null;
  }
  for (const keyword of ATTRIBUTE_KEYWORDS) {
    if (query.toLowerCase().includes(keyword.toLowerCase())) {
      return keyword;
    }
  }
  return null;
}
function classifyQuery(query, ssaResult, _config) {
  const disqualifierResult = checkDisqualifiers(query);
  const queryTypeResult = classifyQueryType(query);
  const entities = extractQueryEntities(query);
  const attribute = extractQueryAttribute(query);
  const relevantNodes = ssaResult.relevant_nodes;
  const topScore = relevantNodes[0]?.score ?? 0;
  const secondScore = relevantNodes.length > 1 ? relevantNodes[1]?.score ?? null : null;
  const resultCount = relevantNodes.length;
  const hasAttribute = attribute !== null;
  const rcsResult = calculateRetrievalConfidence(
    topScore,
    secondScore,
    resultCount,
    hasAttribute
  );
  let decision;
  let classificationReason;
  if (disqualifierResult.disqualified) {
    decision = "PHASE2";
    classificationReason = disqualifierResult.category ? categoryToReason(disqualifierResult.category) : "reasoning_query";
  } else if (queryTypeResult.type === "AMBIGUOUS") {
    decision = "PHASE2";
    classificationReason = "ambiguous_query";
  } else if (resultCount === 0) {
    decision = "PHASE2";
    classificationReason = "no_answer_found";
  } else if (rcsResult.flags.some(isBlockingFlag)) {
    decision = "PHASE2";
    if (rcsResult.flags.includes("disambiguation_needed")) {
      classificationReason = "disambiguation";
    } else if (rcsResult.flags.includes("no_results")) {
      classificationReason = "no_answer_found";
    } else {
      classificationReason = "low_confidence";
    }
  } else {
    switch (rcsResult.level) {
      case "HIGH":
        decision = "SKIP";
        break;
      case "MEDIUM":
        decision = "SKIP_WITH_CAVEAT";
        break;
      case "LOW":
      default:
        decision = "PHASE2";
        classificationReason = "low_confidence";
        break;
    }
  }
  const explanation = generateDecisionExplanation(
    decision,
    queryTypeResult.type,
    rcsResult.level,
    rcsResult.flags,
    disqualifierResult.category
  );
  const result = {
    query,
    queryType: queryTypeResult,
    rcs: {
      score: rcsResult.score,
      level: rcsResult.level,
      flags: rcsResult.flags
    },
    decision,
    explanation
  };
  if (decision === "PHASE2" && classificationReason) {
    result.handoff = buildPhase2Handoff(
      classificationReason,
      relevantNodes,
      queryTypeResult,
      entities,
      attribute
    );
  }
  return result;
}
function shouldSkipPhase2(classification) {
  return classification.decision;
}
function buildPhase2Handoff(reason, relevantNodes, queryType, entities, attribute) {
  return {
    classification_reason: reason,
    phase1_results: relevantNodes.slice(0, 100).map((n) => ({
      node_id: n.node_id,
      score: n.score
    })),
    query_analysis: {
      type: queryType.type,
      entities,
      attribute,
      confidence: queryType.confidence
    }
  };
}
function validateDisqualifierResult(result) {
  return DisqualifierResultSchema.safeParse(result).success;
}
function validateQueryTypeResult(result) {
  return QueryTypeResultSchema.safeParse(result).success;
}
function validateClassificationResult(result) {
  return ClassificationResultSchema.safeParse(result).success;
}
function validatePhase2HandoffMetadata(metadata) {
  return Phase2HandoffMetadataSchema.safeParse(metadata).success;
}
function validateQCSConfig(config) {
  return QCSConfigSchema.safeParse(config).success;
}
var GATE_DECISIONS = ["BYPASS", "PASS", "REJECT", "PROMPT"];
var GATE_REASONS = [
  "too_short",
  // R-001: < 3 chars
  "gibberish",
  // R-002: High entropy, no real words
  "spam_pattern",
  // R-003: Known spam signatures
  "repeated_chars",
  // R-004: > 10 repeated characters
  "pure_filler",
  // R-005: > 90% filler words (5+ word messages)
  "empty_semantic",
  // R-006: Only emoji/punctuation
  "all_caps",
  // R-007: All uppercase (> 10 chars)
  "social_only",
  // R-008: Greetings, thanks, apologies
  "uncertain"
  // Default when no strong signal
];
var BYPASS_SOURCES = [
  "api_force",
  // B-001: API forceSave=true
  "file_upload",
  // B-002: User uploaded a file
  "voice_transcript",
  // B-003: Whisper-processed voice
  "manual_note"
  // B-004: User explicitly created note
];
var TRANSFORMATION_TYPES = [
  "normalize_whitespace",
  // T-001: Collapse multiple spaces
  "collapse_repeats",
  // T-002: Reduce repeated punctuation
  "strip_filler"
  // Reserved for future (P-003 handles this)
];
var GATE_FILTER_DEFAULTS = {
  /** Maximum allowed latency in milliseconds */
  max_latency_ms: 5,
  /** Confidence threshold for REJECT decision (very high = conservative) */
  reject_confidence: 0.95,
  /** Confidence threshold for PROMPT decision */
  prompt_confidence: 0.8,
  /** Whether Gate Filter is enabled */
  enabled: true,
  /** Log rejected content for audit (hashed, not raw) */
  log_rejected: true,
  /** Strict mode = more aggressive filtering */
  strict_mode: false,
  /** Minimum words before filler scoring applies */
  min_words_for_filler_check: 5,
  /** Default language for social pattern matching */
  default_language: "en"
};
var RULE_CONFIDENCES = {
  /** R-001: Too short */
  "R-001_too_short": 1,
  /** R-002: Gibberish detection */
  "R-002_gibberish": 0.98,
  /** R-003: Spam patterns */
  "R-003_spam_pattern": 0.97,
  /** R-004: Repeated characters */
  "R-004_repeated_chars": 0.96,
  /** R-005: Pure filler (>90%) */
  "R-005_pure_filler": 0.96,
  /** R-006: Empty semantic content */
  "R-006_empty_semantic": 0.88,
  /** R-007: All caps */
  "R-007_all_caps": 0.85,
  /** R-008: Social-only content */
  "R-008_social_only": 0.7
};
var GIBBERISH_ENTROPY_THRESHOLD = 4.5;
var GIBBERISH_WORD_RATIO_THRESHOLD = 0.3;
var FILLER_SCORE_THRESHOLD = 0.9;
var FILLER_WORDS = /* @__PURE__ */ new Set([
  "um",
  "uh",
  "like",
  "basically",
  "actually",
  "literally",
  "honestly",
  "so",
  "well",
  "anyway",
  "kind",
  "sort",
  "right",
  "okay",
  "yeah",
  "hmm"
]);
var FILLER_PHRASES = [
  "you know",
  "i mean",
  "kind of",
  "sort of"
];
var SPAM_PATTERNS = [
  // Test/placeholder content
  /^(test|testing|asdf|qwerty)+$/i,
  // Marketing spam phrases
  /\b(buy now|click here|limited offer|act now|free money)\b/i,
  // Repeated short patterns (e.g., "hahahahaha" but shorter repeats)
  /(.{1,3})\1{5,}/,
  // Only phone numbers
  /^[0-9\s\-\+\(\)]+$/,
  // Only numbers
  /^\s*\d+\s*$/
];
var SOCIAL_PATTERNS_BY_LANG = {
  en: [
    /^(hi|hello|hey|yo|sup)[\s!?.]*$/i,
    /^(thanks|thank you|ty|thx)[\s!?.]*$/i,
    /^(sorry|my bad|oops|apologies)[\s!?.]*$/i,
    /^(bye|goodbye|see you|later|cya)[\s!?.]*$/i,
    /^(ok|okay|k|sure|yep|yeah|yes|no|nope|nah)[\s!?.]*$/i,
    /^how are you[\s!?.]*$/i,
    /^what's up[\s!?.]*$/i,
    /^(good morning|good night|gm|gn)[\s!?.]*$/i
  ],
  es: [
    /^(hola|buenas|oye|que tal)[\s!?.]*$/i,
    /^(gracias|muchas gracias)[\s!?.]*$/i,
    /^(perdon|lo siento)[\s!?.]*$/i,
    /^(adios|hasta luego|chao)[\s!?.]*$/i,
    /^(si|no|ok|vale)[\s!?.]*$/i
  ],
  fr: [
    /^(salut|bonjour|coucou|bonsoir)[\s!?.]*$/i,
    /^(merci|merci beaucoup)[\s!?.]*$/i,
    /^(pardon|desole)[\s!?.]*$/i,
    /^(au revoir|a bientot|ciao)[\s!?.]*$/i,
    /^(oui|non|ok|d'accord)[\s!?.]*$/i
  ],
  de: [
    /^(hallo|hi|guten tag|moin)[\s!?.]*$/i,
    /^(danke|vielen dank)[\s!?.]*$/i,
    /^(entschuldigung|sorry)[\s!?.]*$/i,
    /^(tschuss|auf wiedersehen|ciao)[\s!?.]*$/i,
    /^(ja|nein|ok)[\s!?.]*$/i
  ]
};
var SUPPORTED_LANGUAGES = Object.keys(
  SOCIAL_PATTERNS_BY_LANG
);
var COMMON_WORDS = /* @__PURE__ */ new Set([
  // Articles, pronouns
  "the",
  "a",
  "an",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "our",
  "their",
  // Verbs
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "can",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  // Conjunctions, prepositions
  "and",
  "or",
  "but",
  "if",
  "then",
  "because",
  "as",
  "until",
  "while",
  "of",
  "at",
  "by",
  "for",
  "with",
  "about",
  "against",
  "between",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "to",
  "from",
  "up",
  "down",
  "in",
  "out",
  "on",
  "off",
  "over",
  "under",
  // Common adverbs, adjectives
  "again",
  "further",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  // Common nouns
  "this",
  "that",
  "these",
  "those",
  "what",
  "which",
  "who",
  "whom"
]);
var REPEATED_CHARS_THRESHOLD = 10;
var REPEATED_CHARS_PATTERN = /(.)\1{10,}/;
var GATE_MIN_CONTENT_LENGTH = 3;
var ALL_CAPS_MIN_LENGTH = 10;
var ALL_CAPS_MIN_LETTERS = 5;
var GateFilterConfigSchema = z.object({
  max_latency_ms: z.number().min(1).max(100).default(GATE_FILTER_DEFAULTS.max_latency_ms),
  reject_confidence: z.number().min(0).max(1).default(GATE_FILTER_DEFAULTS.reject_confidence),
  prompt_confidence: z.number().min(0).max(1).default(GATE_FILTER_DEFAULTS.prompt_confidence),
  enabled: z.boolean().default(GATE_FILTER_DEFAULTS.enabled),
  log_rejected: z.boolean().default(GATE_FILTER_DEFAULTS.log_rejected),
  strict_mode: z.boolean().default(GATE_FILTER_DEFAULTS.strict_mode),
  min_words_for_filler_check: z.number().min(1).max(20).default(GATE_FILTER_DEFAULTS.min_words_for_filler_check),
  default_language: z.string().default(GATE_FILTER_DEFAULTS.default_language)
});
var GateFilterBypassSchema = z.object({
  source: z.enum(BYPASS_SOURCES),
  reason: z.string()
});
var TransformationSchema = z.object({
  type: z.enum(TRANSFORMATION_TYPES),
  before: z.string(),
  after: z.string()
});
var GateFilterResultSchema = z.object({
  decision: z.enum(GATE_DECISIONS),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.enum(GATE_REASONS)),
  transformations: z.array(TransformationSchema).optional(),
  bypass: GateFilterBypassSchema.optional(),
  latency_ms: z.number().min(0)
});
var GateFilterInputEnvelopeSchema = z.object({
  source: z.enum(["chat", "file", "voice", "api", "stream"]),
  normalized: z.object({
    text: z.string()
  }),
  metadata: z.object({
    language: z.string().optional(),
    whisperProcessed: z.boolean().optional(),
    isManualNote: z.boolean().optional()
  }).optional(),
  options: z.object({
    forceSave: z.boolean().optional()
  }).optional(),
  context: z.object({
    userId: z.string(),
    sessionId: z.string()
  })
});
var GateFilterMetricsSchema = z.object({
  total_processed: z.number().min(0),
  bypass_count: z.number().min(0),
  pass_count: z.number().min(0),
  reject_count: z.number().min(0),
  prompt_count: z.number().min(0),
  avg_latency_ms: z.number().min(0),
  rejection_by_reason: z.record(z.string(), z.number()),
  false_positive_reports: z.number().min(0)
});
var RejectionLogSchema = z.object({
  timestamp: z.date(),
  userId: z.string(),
  sessionId: z.string(),
  input_hash: z.string(),
  input_length: z.number().min(0),
  decision: z.enum(GATE_DECISIONS),
  reasons: z.array(z.enum(GATE_REASONS)),
  confidence: z.number().min(0).max(1),
  latency_ms: z.number().min(0)
});
var GateFilterExtractionContextSchema = z.object({
  gateFilterPassed: z.boolean(),
  gateCleanupApplied: z.boolean(),
  gateBypassReason: z.string().optional(),
  userConfirmedFromPrompt: z.boolean().optional()
});
function gateFilter(envelope, config = GATE_FILTER_DEFAULTS) {
  const startTime = Date.now();
  const text = envelope.normalized.text;
  const lang = envelope.metadata?.language || config.default_language;
  const bypass = shouldBypass(envelope);
  if (bypass) {
    return {
      decision: "BYPASS",
      confidence: 1,
      reasons: [],
      bypass,
      latency_ms: Date.now() - startTime
    };
  }
  const normalized = normalizeWhitespace(text);
  const reasons = [];
  let confidence = 0;
  if (normalized.length < GATE_MIN_CONTENT_LENGTH) {
    return finalize("REJECT", RULE_CONFIDENCES["R-001_too_short"], ["too_short"], startTime);
  }
  if (isGibberish(normalized)) {
    return finalize("REJECT", RULE_CONFIDENCES["R-002_gibberish"], ["gibberish"], startTime);
  }
  if (matchesSpamPattern(normalized)) {
    return finalize("REJECT", RULE_CONFIDENCES["R-003_spam_pattern"], ["spam_pattern"], startTime);
  }
  if (REPEATED_CHARS_PATTERN.test(normalized)) {
    return finalize("REJECT", RULE_CONFIDENCES["R-004_repeated_chars"], ["repeated_chars"], startTime);
  }
  const words = normalized.toLowerCase().split(/\s+/);
  if (words.length >= config.min_words_for_filler_check) {
    const fillerScore = getFillerScore(words);
    if (fillerScore > FILLER_SCORE_THRESHOLD) {
      return finalize("REJECT", RULE_CONFIDENCES["R-005_pure_filler"], ["pure_filler"], startTime);
    }
  }
  if (isEmptySemantic(normalized)) {
    reasons.push("empty_semantic");
    confidence = Math.max(confidence, RULE_CONFIDENCES["R-006_empty_semantic"]);
  }
  if (isAllCaps(normalized)) {
    reasons.push("all_caps");
    confidence = Math.max(confidence, RULE_CONFIDENCES["R-007_all_caps"]);
  }
  if (isSocialOnly(normalized, lang)) {
    reasons.push("social_only");
    confidence = Math.max(confidence, RULE_CONFIDENCES["R-008_social_only"]);
  }
  let decision;
  if (confidence >= config.reject_confidence) {
    decision = "REJECT";
  } else if (confidence >= config.prompt_confidence) {
    decision = "PROMPT";
  } else {
    decision = "PASS";
    if (reasons.length === 0) {
      reasons.push("uncertain");
    }
  }
  let transformations = [];
  if (decision === "PASS") {
    transformations = applyCleanup(normalized);
  }
  return {
    decision,
    confidence,
    reasons,
    transformations: transformations.length > 0 ? transformations : void 0,
    latency_ms: Date.now() - startTime
  };
}
function finalize(decision, confidence, reasons, startTime) {
  return {
    decision,
    confidence,
    reasons,
    latency_ms: Date.now() - startTime
  };
}
function shouldBypass(envelope) {
  if (envelope.source === "api" && envelope.options?.forceSave) {
    return { source: "api_force", reason: "Developer override" };
  }
  if (envelope.source === "file") {
    return { source: "file_upload", reason: "User committed to upload" };
  }
  if (envelope.source === "voice" && envelope.metadata?.whisperProcessed) {
    return { source: "voice_transcript", reason: "Already cleaned by Whisper" };
  }
  if (envelope.metadata?.isManualNote) {
    return { source: "manual_note", reason: "Explicit user creation" };
  }
  return null;
}
function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}
function isGibberish(text) {
  const entropy = calculateEntropy(text);
  const words = text.split(/\s+/);
  const realWordCount = countRealWords(text);
  const wordRatio = realWordCount / Math.max(1, words.length);
  return entropy > GIBBERISH_ENTROPY_THRESHOLD && wordRatio < GIBBERISH_WORD_RATIO_THRESHOLD;
}
function calculateEntropy(text) {
  if (text.length === 0) return 0;
  const freq = {};
  for (const char of text) {
    freq[char] = (freq[char] || 0) + 1;
  }
  const len = text.length;
  return Object.values(freq).reduce((sum, f) => {
    const p = f / len;
    return sum - p * Math.log2(p);
  }, 0);
}
function countRealWords(text) {
  const words = text.toLowerCase().split(/\s+/);
  return words.filter((w) => COMMON_WORDS.has(w) || w.length > 2).length;
}
function matchesSpamPattern(text) {
  return SPAM_PATTERNS.some((pattern) => pattern.test(text));
}
function getFillerScore(words) {
  if (words.length === 0) return 0;
  const fillerCount = words.filter((w) => FILLER_WORDS.has(w)).length;
  return fillerCount / words.length;
}
function isEmptySemantic(text) {
  const semantic = text.replace(/[\p{Emoji}\s\p{P}]/gu, "");
  return semantic.length < 2;
}
function isAllCaps(text) {
  if (text.length <= ALL_CAPS_MIN_LENGTH) return false;
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length < ALL_CAPS_MIN_LETTERS) return false;
  return letters === letters.toUpperCase();
}
function isSocialOnly(text, lang = "en") {
  const patterns = SOCIAL_PATTERNS_BY_LANG[lang] ?? SOCIAL_PATTERNS_BY_LANG["en"];
  if (!patterns) return false;
  return patterns.some((pattern) => pattern.test(text.trim()));
}
function applyCleanup(text) {
  const transformations = [];
  let current = text;
  const normalized = current.replace(/\s+/g, " ").trim();
  if (normalized !== current) {
    transformations.push({
      type: "normalize_whitespace",
      before: current,
      after: normalized
    });
    current = normalized;
  }
  const collapsed = current.replace(/([!?.]){3,}/g, "$1$1");
  if (collapsed !== current) {
    transformations.push({
      type: "collapse_repeats",
      before: current,
      after: collapsed
    });
  }
  return transformations;
}
function createDefaultMetrics() {
  return {
    total_processed: 0,
    bypass_count: 0,
    pass_count: 0,
    reject_count: 0,
    prompt_count: 0,
    avg_latency_ms: 0,
    rejection_by_reason: {},
    false_positive_reports: 0
  };
}
function updateMetrics(metrics, result) {
  metrics.total_processed++;
  switch (result.decision) {
    case "BYPASS":
      metrics.bypass_count++;
      break;
    case "PASS":
      metrics.pass_count++;
      break;
    case "REJECT":
      metrics.reject_count++;
      break;
    case "PROMPT":
      metrics.prompt_count++;
      break;
  }
  metrics.avg_latency_ms = (metrics.avg_latency_ms * (metrics.total_processed - 1) + result.latency_ms) / metrics.total_processed;
  for (const reason of result.reasons) {
    metrics.rejection_by_reason[reason] = (metrics.rejection_by_reason[reason] || 0) + 1;
  }
}
function reportFalsePositive(metrics) {
  metrics.false_positive_reports++;
}
function createRejectionLog(envelope, result, hashFn) {
  return {
    timestamp: /* @__PURE__ */ new Date(),
    userId: envelope.context.userId,
    sessionId: envelope.context.sessionId,
    input_hash: hashFn(envelope.normalized.text),
    input_length: envelope.normalized.text.length,
    decision: result.decision,
    reasons: result.reasons,
    confidence: result.confidence,
    latency_ms: result.latency_ms
  };
}

// src/ingestion/constants.ts
var INPUT_SOURCES = ["chat", "file", "voice", "api", "stream"];
var INPUT_MODES = ["normal", "incognito"];
var CLASSIFICATION_INTENTS = [
  "query",
  "content",
  "command",
  "conversation",
  "noise"
];
var SAVE_SIGNALS = ["explicit", "implicit", "none", "unclear"];
var CONTENT_TYPES = ["fact", "opinion", "question", "instruction", "mixed"];
var COMPLEXITY_LEVELS = ["atomic", "composite", "document"];
var PIPELINE_STAGES = ["RECEIVE", "CLASSIFY", "ROUTE", "PROCESS", "STAGE", "COMMIT"];
var PROCESSING_ACTIONS = [
  "saved",
  "ignored",
  "accumulated",
  "queried",
  "prompted",
  "uncertain"
];
var REVIEW_VERBS = [
  "review",
  "check",
  "proofread",
  "edit",
  "look over",
  "revise",
  "examine",
  "inspect",
  "analyze"
];
var SAVE_VERBS = [
  "save",
  "remember",
  "keep",
  "store",
  "note",
  "record",
  "memorize",
  "dont forget",
  "don't forget"
];
var AMBIGUOUS_VERBS = [
  "look at",
  "see this",
  "here's",
  "heres",
  "check out",
  "take a look"
];
var ACTION_VERB_CATEGORIES = {
  review: REVIEW_VERBS,
  save: SAVE_VERBS,
  ambiguous: AMBIGUOUS_VERBS
};
var CONTENT_CATEGORIES = [
  "identity",
  "academic",
  "conversation",
  "work",
  "temporal",
  "document",
  "general"
];
var ADAPTIVE_THRESHOLDS = {
  identity: { rule: 0.6, prompt: 0.5 },
  academic: { rule: 0.7, prompt: 0.6 },
  conversation: { rule: 0.75, prompt: 0.65 },
  work: { rule: 0.7, prompt: 0.6 },
  temporal: { rule: 0.7, prompt: 0.6 },
  document: { rule: 0.85, prompt: 0.75 },
  general: { rule: 0.75, prompt: 0.65 }
};
var PROMPT_LIMITS = {
  max_per_session: 3,
  min_messages_between: 5,
  dismissals_to_stop: 2
};
var CHUNK_LIMITS = {
  target: { min: 500, max: 2e3 },
  soft_max: 3e3,
  hard_max: 5e3,
  overlap_percent: 0.1
};
var SUMMARY_LIMITS = {
  document: { min: 300, max: 800 },
  section: { min: 200, max: 500 }
};
var STREAM_CONFIG = {
  buffer_window_ms: 3e4,
  silence_trigger_ms: 2e3,
  max_accumulation_ms: 3e5
};
var INGESTION_DEFAULTS = {
  default_mode: "normal",
  gate_filter_enabled: true,
  user_learning_enabled: true,
  default_content_category: "general",
  thought_path_enabled: true,
  intra_batch_dedupe: true,
  dedupe_similarity: 0.9,
  default_language: "en"
};
var FAST_RULE_PATTERNS = {
  question: [
    /^(what|who|where|when|why|how|which|whose|whom)\s/i,
    /\?\s*$/,
    /^(is|are|was|were|do|does|did|can|could|will|would|should)\s/i
  ],
  explicit_save: [
    /\b(save|remember|keep|store|note|record|memorize)\s+(this|that|it)\b/i,
    /\bdon'?t forget\b/i,
    /\bremember\s+that\b/i
  ],
  social: [
    /^(hi|hello|hey|yo|sup|thanks|thank you|sorry|bye|goodbye)[\s!?.]*$/i,
    /^(ok|okay|sure|yep|yeah|yes|no|nope|got it|understood)[\s!?.]*$/i,
    /^(good morning|good night|gm|gn|how are you)[\s!?.]*$/i
  ],
  command: [
    /^(search|find|show|list|delete|remove|clear|reset|undo)\s/i,
    /^(create|make|add|new)\s+(a\s+)?(node|note|document)\b/i
  ]
};
var HANDLER_TYPES = [
  "QueryHandler",
  "DirectSaveHandler",
  "AccumulatorHandler",
  "PromptHandler",
  "CommandHandler",
  "ResponseHandler",
  "IgnoreHandler"
];
var WORKING_MEMORY_DURATIONS = {
  identity: 48,
  academic: 24,
  conversation: 6,
  work: 24,
  temporal: 12,
  document: 48,
  general: 24
};
var AttachmentSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  fileName: z.string().optional(),
  size: z.number().optional(),
  url: z.string().optional(),
  extractedText: z.string().optional()
});
var ConversationMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  timestamp: z.date()
});
var UserBehaviorModelSchema = z.object({
  userId: z.string(),
  typicalSaveRate: z.number().min(0).max(1),
  promptResponseRate: z.number().min(0).max(1),
  dismissedPrompts: z.number().min(0),
  contentPreferences: z.object({
    alwaysSave: z.array(z.string()),
    neverSave: z.array(z.string())
  }),
  currentSession: z.object({
    promptsShown: z.number().min(0),
    messagesSincePrompt: z.number().min(0)
  }),
  lastUpdated: z.date()
});
var IngestOptionsSchema = z.object({
  autoSave: z.boolean().optional(),
  forceSave: z.boolean().optional(),
  skipClassification: z.boolean().optional(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  mode: z.enum(INPUT_MODES).optional(),
  contentCategory: z.enum(CONTENT_CATEGORIES).optional()
});
var InputEnvelopeSchema = z.object({
  id: z.string(),
  timestamp: z.date(),
  source: z.enum(INPUT_SOURCES),
  mode: z.enum(INPUT_MODES),
  raw: z.unknown(),
  normalized: z.object({
    text: z.string(),
    metadata: z.record(z.unknown()),
    attachments: z.array(AttachmentSchema).optional()
  }),
  context: z.object({
    sessionId: z.string(),
    userId: z.string(),
    conversationHistory: z.array(ConversationMessageSchema),
    userBehavior: UserBehaviorModelSchema.optional()
  }),
  options: IngestOptionsSchema.optional()
});
var DetectedActionVerbSchema = z.object({
  category: z.enum(["review", "save", "ambiguous"]),
  matched: z.string(),
  position: z.number()
});
var ClassificationSchema = z.object({
  intent: z.enum(CLASSIFICATION_INTENTS),
  saveSignal: z.enum(SAVE_SIGNALS),
  contentType: z.enum(CONTENT_TYPES),
  complexity: z.enum(COMPLEXITY_LEVELS),
  confidence: z.number().min(0).max(1),
  contentCategory: z.enum(CONTENT_CATEGORIES),
  actionVerb: DetectedActionVerbSchema.optional(),
  thoughtPath: z.array(z.string()),
  gateResult: z.unknown().optional(),
  classifiedBy: z.enum(["fast_rules", "action_verbs", "llm", "user_learning"])
});
var RouteHandlerSchema = z.object({
  handler: z.enum(HANDLER_TYPES),
  confidence: z.number().min(0).max(1),
  reason: z.string()
});
var StagedNodeSchema = z.object({
  stagingId: z.string(),
  nodeType: z.string(),
  title: z.string(),
  body: z.string(),
  contentCategory: z.enum(CONTENT_CATEGORIES),
  extractionConfidence: z.number().min(0).max(1),
  provenance: z.object({
    sourceType: z.enum(["extraction", "manual", "import"]),
    inputId: z.string(),
    sessionId: z.string(),
    timestamp: z.date()
  }),
  parentId: z.string().optional(),
  suggestedEdges: z.array(z.object({
    targetId: z.string(),
    edgeType: z.string(),
    strength: z.number().min(0).max(1)
  })).optional(),
  metadata: z.record(z.unknown())
});
var ProcessResultSchema = z.object({
  action: z.enum(PROCESSING_ACTIONS),
  stagedNodes: z.array(StagedNodeSchema).optional(),
  response: z.string().optional(),
  promptedUser: z.boolean().optional(),
  userResponse: z.enum(["save", "discard", "pending"]).optional(),
  metadata: z.object({
    handler: z.enum(HANDLER_TYPES),
    durationMs: z.number().min(0),
    errors: z.array(z.string()).optional()
  })
});
var ThoughtPathSchema = z.object({
  nodesAccessed: z.array(z.string()),
  nodesCreated: z.array(z.string()),
  nodesUpdated: z.array(z.string()),
  confidenceScores: z.array(z.number()),
  timestamp: z.date()
});
var CommitResultSchema = z.object({
  created: z.array(z.string()),
  updated: z.array(z.string()),
  linked: z.array(z.string()),
  thoughtPath: ThoughtPathSchema,
  timestamp: z.date()
});
var IngestResultSchema = z.object({
  inputId: z.string(),
  classification: ClassificationSchema,
  action: z.enum(PROCESSING_ACTIONS),
  nodes: z.array(z.string()).optional(),
  thoughtPath: ThoughtPathSchema,
  warnings: z.array(z.string()).optional(),
  processingTimeMs: z.number().min(0)
});
var DocumentChunkSchema = z.object({
  id: z.string(),
  sequence: z.number().min(0),
  content: z.string(),
  charCount: z.number().min(0),
  heading: z.string().optional(),
  headingLevel: z.number().min(1).max(6).optional(),
  parentChunkId: z.string().optional(),
  overlapStart: z.string().optional(),
  overlapEnd: z.string().optional(),
  splitMethod: z.enum(["structural", "semantic", "size_limit"])
});
var PipelineEventSchema = z.object({
  type: z.enum([
    "pipeline:stage",
    "pipeline:classify",
    "pipeline:route",
    "node:access",
    "node:create",
    "node:update",
    "commit:complete"
  ]),
  timestamp: z.date(),
  payload: z.record(z.unknown())
});
var StreamOptionsSchema = z.object({
  bufferWindowMs: z.number().min(1e3).optional(),
  silenceTriggerMs: z.number().min(500).optional(),
  maxAccumulationMs: z.number().min(6e4).optional(),
  contentCategory: z.enum(CONTENT_CATEGORIES).optional(),
  autoExtractOnSilence: z.boolean().optional()
});
var IngestionConfigSchema = z.object({
  gateFilterEnabled: z.boolean().default(INGESTION_DEFAULTS.gate_filter_enabled),
  userLearningEnabled: z.boolean().default(INGESTION_DEFAULTS.user_learning_enabled),
  defaultContentCategory: z.enum(CONTENT_CATEGORIES).default(INGESTION_DEFAULTS.default_content_category),
  thoughtPathEnabled: z.boolean().default(INGESTION_DEFAULTS.thought_path_enabled),
  intraBatchDedupe: z.boolean().default(INGESTION_DEFAULTS.intra_batch_dedupe),
  dedupeSimilarity: z.number().min(0).max(1).default(INGESTION_DEFAULTS.dedupe_similarity),
  defaultLanguage: z.string().default(INGESTION_DEFAULTS.default_language)
});

// src/ingestion/index.ts
function generateId(prefix = "") {
  return prefix ? `${prefix}_${nanoid(12)}` : nanoid(12);
}
function createInputEnvelope(source, raw, context, options) {
  const id = generateId("inp");
  const timestamp = /* @__PURE__ */ new Date();
  const mode = options?.mode ?? "normal";
  const normalized = normalizeInput(source, raw);
  return {
    id,
    timestamp,
    source,
    mode,
    raw,
    normalized,
    context,
    options
  };
}
function normalizeInput(source, raw) {
  switch (source) {
    case "chat":
      return {
        text: typeof raw === "string" ? raw.trim() : String(raw).trim(),
        metadata: { source: "chat" }
      };
    case "file":
      const fileInput = raw;
      return {
        text: fileInput?.content ?? "",
        metadata: {
          source: "file",
          fileName: fileInput?.fileName,
          mimeType: fileInput?.mimeType
        }
      };
    case "voice":
      return {
        text: typeof raw === "string" ? raw.trim() : "",
        metadata: { source: "voice", whisperProcessed: true }
      };
    case "api":
      if (typeof raw === "string") {
        return {
          text: raw.trim(),
          metadata: { source: "api" }
        };
      }
      const apiInput = raw;
      return {
        text: (apiInput?.content ?? apiInput?.text ?? "").trim(),
        metadata: { source: "api", ...apiInput?.metadata ?? {} }
      };
    case "stream":
      return {
        text: typeof raw === "string" ? raw.trim() : "",
        metadata: { source: "stream", isBuffered: true }
      };
    default:
      return {
        text: String(raw).trim(),
        metadata: { source }
      };
  }
}
async function classifyInput(envelope, config) {
  const thoughtPath = [];
  const gateFilterEnabled = (config?.gateFilterEnabled ?? INGESTION_DEFAULTS.gate_filter_enabled) && envelope.source !== "api";
  let gateResult;
  if (gateFilterEnabled) {
    gateResult = gateFilter({
      source: envelope.source === "stream" ? "chat" : envelope.source,
      normalized: { text: envelope.normalized.text },
      metadata: {
        language: envelope.normalized.metadata.language,
        whisperProcessed: envelope.normalized.metadata.whisperProcessed,
        isManualNote: envelope.options?.forceSave
      },
      options: {
        forceSave: envelope.options?.forceSave
      },
      context: {
        userId: envelope.context.userId,
        sessionId: envelope.context.sessionId
      }
    });
    if (gateResult.decision === "REJECT") {
      return {
        intent: "noise",
        saveSignal: "none",
        contentType: "mixed",
        complexity: "atomic",
        confidence: gateResult.confidence,
        contentCategory: "general",
        thoughtPath,
        gateResult,
        classifiedBy: "fast_rules"
      };
    }
  }
  const fastResult = fastRuleClassify(envelope.normalized.text);
  if (fastResult.confidence >= 0.85 && fastResult.intent !== "content") {
    return {
      ...fastResult,
      thoughtPath,
      gateResult,
      classifiedBy: "fast_rules"
    };
  }
  if (fastResult.confidence >= 0.9 && fastResult.saveSignal === "explicit") {
    return {
      ...fastResult,
      thoughtPath,
      gateResult,
      classifiedBy: "fast_rules"
    };
  }
  if (envelope.context.userBehavior && config?.userLearningEnabled !== false) {
    const learningResult = classifyByUserLearning(envelope);
    if (learningResult && learningResult.confidence > 0.8) {
      return {
        ...learningResult,
        thoughtPath,
        gateResult,
        classifiedBy: "user_learning"
      };
    }
  }
  const actionVerb = detectActionVerb(envelope.normalized.text);
  if (actionVerb) {
    const actionResult = classifyByActionVerb(actionVerb);
    if (actionResult.confidence > 0.85) {
      return {
        ...actionResult,
        actionVerb,
        thoughtPath,
        gateResult,
        classifiedBy: "action_verbs"
      };
    }
  }
  return {
    intent: "content",
    saveSignal: "implicit",
    contentType: "mixed",
    complexity: detectComplexity(envelope.normalized.text),
    confidence: 0.7,
    contentCategory: config?.defaultContentCategory ?? "general",
    thoughtPath,
    gateResult,
    classifiedBy: "llm"
  };
}
function fastRuleClassify(text) {
  const trimmed = text.trim().toLowerCase();
  for (const pattern of FAST_RULE_PATTERNS.explicit_save) {
    if (pattern.test(trimmed)) {
      return {
        intent: "content",
        saveSignal: "explicit",
        contentType: "mixed",
        complexity: "atomic",
        confidence: 0.95,
        contentCategory: "general"
      };
    }
  }
  for (const pattern of FAST_RULE_PATTERNS.question) {
    if (pattern.test(trimmed)) {
      return {
        intent: "query",
        saveSignal: "none",
        contentType: "question",
        complexity: "atomic",
        confidence: 0.9,
        contentCategory: "general"
      };
    }
  }
  for (const pattern of FAST_RULE_PATTERNS.social) {
    if (pattern.test(trimmed)) {
      return {
        intent: "conversation",
        saveSignal: "none",
        contentType: "mixed",
        complexity: "atomic",
        confidence: 0.85,
        contentCategory: "conversation"
      };
    }
  }
  for (const pattern of FAST_RULE_PATTERNS.command) {
    if (pattern.test(trimmed)) {
      return {
        intent: "command",
        saveSignal: "none",
        contentType: "instruction",
        complexity: "atomic",
        confidence: 0.9,
        contentCategory: "general"
      };
    }
  }
  return {
    intent: "content",
    saveSignal: "unclear",
    contentType: "mixed",
    complexity: detectComplexity(text),
    confidence: 0.3,
    contentCategory: "general"
  };
}
function detectActionVerb(text) {
  const lower = text.toLowerCase();
  for (const verb of REVIEW_VERBS) {
    const index = lower.indexOf(verb);
    if (index !== -1) {
      return { category: "review", matched: verb, position: index };
    }
  }
  for (const verb of SAVE_VERBS) {
    const index = lower.indexOf(verb);
    if (index !== -1) {
      return { category: "save", matched: verb, position: index };
    }
  }
  for (const verb of AMBIGUOUS_VERBS) {
    const index = lower.indexOf(verb);
    if (index !== -1) {
      return { category: "ambiguous", matched: verb, position: index };
    }
  }
  return void 0;
}
function classifyByActionVerb(actionVerb) {
  switch (actionVerb.category) {
    case "review":
      return {
        intent: "query",
        saveSignal: "none",
        contentType: "question",
        complexity: "composite",
        confidence: 0.9,
        contentCategory: "general"
      };
    case "save":
      return {
        intent: "content",
        saveSignal: "explicit",
        contentType: "mixed",
        complexity: "atomic",
        confidence: 0.95,
        contentCategory: "general"
      };
    case "ambiguous":
    default:
      return {
        intent: "content",
        saveSignal: "unclear",
        contentType: "mixed",
        complexity: "atomic",
        confidence: 0.5,
        contentCategory: "general"
      };
  }
}
function classifyByUserLearning(envelope) {
  const behavior = envelope.context.userBehavior;
  if (!behavior) return null;
  const text = envelope.normalized.text.toLowerCase();
  for (const pref of behavior.contentPreferences.alwaysSave) {
    if (text.includes(pref.toLowerCase())) {
      return {
        intent: "content",
        saveSignal: "implicit",
        contentType: "mixed",
        complexity: "atomic",
        confidence: 0.85,
        contentCategory: "general"
      };
    }
  }
  for (const pref of behavior.contentPreferences.neverSave) {
    if (text.includes(pref.toLowerCase())) {
      return {
        intent: "conversation",
        saveSignal: "none",
        contentType: "mixed",
        complexity: "atomic",
        confidence: 0.85,
        contentCategory: "general"
      };
    }
  }
  return null;
}
function detectComplexity(text) {
  const words = text.split(/\s+/).length;
  if (words > 500) return "document";
  if (words > 50) return "composite";
  return "atomic";
}
function adjustThreshold(baseThreshold, userBehavior) {
  const saveAdjustment = userBehavior.typicalSaveRate * 0.2;
  const promptAdjustment = (1 - userBehavior.promptResponseRate) * 0.1;
  return Math.max(0.4, Math.min(0.95, baseThreshold - saveAdjustment + promptAdjustment));
}
function getAdaptiveThreshold(category, type) {
  const thresholds = ADAPTIVE_THRESHOLDS[category] ?? ADAPTIVE_THRESHOLDS.general;
  return type === "rule" ? thresholds.rule : thresholds.prompt;
}
function routeClassification(classification) {
  const { intent, saveSignal } = classification;
  if (intent === "noise") {
    return { handler: "IgnoreHandler", confidence: classification.confidence, reason: "Noise detected" };
  }
  if (intent === "query" || intent === "content" && saveSignal === "none") {
    return { handler: "QueryHandler", confidence: classification.confidence, reason: `Intent: ${intent}` };
  }
  if (intent === "content" && saveSignal === "explicit") {
    return { handler: "DirectSaveHandler", confidence: classification.confidence, reason: "Explicit save" };
  }
  if (intent === "content" && saveSignal === "implicit") {
    return { handler: "AccumulatorHandler", confidence: classification.confidence, reason: "Implicit content" };
  }
  if (intent === "content" && saveSignal === "unclear") {
    return { handler: "PromptHandler", confidence: classification.confidence, reason: "Unclear save signal" };
  }
  if (intent === "command") {
    return { handler: "CommandHandler", confidence: classification.confidence, reason: "Command intent" };
  }
  if (intent === "conversation") {
    return { handler: "ResponseHandler", confidence: classification.confidence, reason: "Conversation" };
  }
  return { handler: "AccumulatorHandler", confidence: 0.5, reason: "Default routing" };
}
async function processInput(envelope, classification, handler) {
  const startTime = performance.now();
  let result;
  switch (handler.handler) {
    case "DirectSaveHandler":
      result = {
        action: "saved",
        stagedNodes: [createStagedNode(envelope, classification)],
        metadata: { handler: handler.handler, durationMs: 0 }
      };
      break;
    case "AccumulatorHandler":
      result = {
        action: "accumulated",
        metadata: { handler: handler.handler, durationMs: 0 }
      };
      break;
    case "QueryHandler":
      result = {
        action: "queried",
        metadata: { handler: handler.handler, durationMs: 0 }
      };
      break;
    case "PromptHandler":
      result = {
        action: "prompted",
        promptedUser: true,
        userResponse: "pending",
        metadata: { handler: handler.handler, durationMs: 0 }
      };
      break;
    case "CommandHandler":
    case "ResponseHandler":
    case "IgnoreHandler":
    default:
      result = {
        action: "ignored",
        metadata: { handler: handler.handler, durationMs: 0 }
      };
      break;
  }
  result.metadata.durationMs = performance.now() - startTime;
  return result;
}
function createStagedNode(envelope, classification) {
  const text = envelope.normalized.text;
  const title = extractTitle(text);
  return {
    stagingId: generateId("stg"),
    nodeType: "concept",
    title,
    body: text,
    contentCategory: classification.contentCategory,
    extractionConfidence: classification.confidence,
    provenance: {
      sourceType: envelope.options?.forceSave ? "manual" : "extraction",
      inputId: envelope.id,
      sessionId: envelope.context.sessionId,
      timestamp: envelope.timestamp
    },
    metadata: envelope.normalized.metadata
  };
}
function extractTitle(text) {
  const firstLine = text.split("\n")[0] ?? text;
  return firstLine.slice(0, 100).trim();
}
function shouldPrompt(classification, userBehavior) {
  if (classification.saveSignal !== "unclear") return false;
  if (userBehavior) {
    const { currentSession, dismissedPrompts } = userBehavior;
    if (currentSession.promptsShown >= PROMPT_LIMITS.max_per_session && dismissedPrompts >= PROMPT_LIMITS.dismissals_to_stop) {
      return false;
    }
    if (currentSession.promptsShown >= 1 && currentSession.messagesSincePrompt < PROMPT_LIMITS.min_messages_between) {
      return false;
    }
  }
  const threshold = getAdaptiveThreshold(classification.contentCategory, "prompt");
  if (classification.confidence >= threshold) return false;
  if (classification.complexity === "atomic") return false;
  return true;
}
function chunkDocument(content, options) {
  const {
    targetMin = CHUNK_LIMITS.target.min,
    // targetMax and softMax reserved for future semantic chunking
    hardMax = CHUNK_LIMITS.hard_max,
    overlapPercent = CHUNK_LIMITS.overlap_percent
  } = options ?? {};
  const boundaries = findStructuralBoundaries(content);
  const chunks = [];
  let sequence = 0;
  let lastEnd = 0;
  let currentHeading;
  let currentLevel;
  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i];
    if (!boundary) continue;
    const chunkContent = content.slice(lastEnd, boundary.position);
    if (chunkContent.trim().length >= targetMin) {
      chunks.push({
        id: generateId("chunk"),
        sequence: sequence++,
        content: chunkContent.trim(),
        charCount: chunkContent.length,
        heading: currentHeading,
        headingLevel: currentLevel,
        splitMethod: "structural"
      });
    }
    if (boundary.heading) {
      currentHeading = boundary.heading;
      currentLevel = boundary.level;
    }
    lastEnd = boundary.position;
  }
  if (lastEnd < content.length) {
    const remaining = content.slice(lastEnd);
    if (remaining.trim().length > 0) {
      chunks.push({
        id: generateId("chunk"),
        sequence: sequence++,
        content: remaining.trim(),
        charCount: remaining.length,
        heading: currentHeading,
        headingLevel: currentLevel,
        splitMethod: "structural"
      });
    }
  }
  if (chunks.length === 0 && content.trim().length > 0) {
    chunks.push({
      id: generateId("chunk"),
      sequence: 0,
      content: content.trim(),
      charCount: content.length,
      splitMethod: "structural"
    });
  }
  const finalChunks = [];
  for (const chunk of chunks) {
    if (chunk.charCount <= hardMax) {
      finalChunks.push(chunk);
    } else {
      const subChunks = splitAtSentences(chunk.content, hardMax);
      subChunks.forEach((sub, i) => {
        finalChunks.push({
          ...chunk,
          id: generateId("chunk"),
          sequence: chunk.sequence + i * 0.1,
          content: sub,
          charCount: sub.length,
          splitMethod: "size_limit"
        });
      });
    }
  }
  if (overlapPercent > 0) {
    for (let i = 1; i < finalChunks.length; i++) {
      const prev = finalChunks[i - 1];
      const current = finalChunks[i];
      if (prev && current) {
        const overlapLength = Math.floor(prev.charCount * overlapPercent);
        current.overlapStart = prev.content.slice(-overlapLength);
      }
    }
  }
  return finalChunks;
}
function findStructuralBoundaries(content) {
  const boundaries = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    const hashes = match[1];
    const headingText = match[2];
    if (hashes && headingText) {
      boundaries.push({
        position: match.index,
        heading: headingText,
        level: hashes.length
      });
    }
  }
  const paragraphRegex = /\n\n+/g;
  while ((match = paragraphRegex.exec(content)) !== null) {
    boundaries.push({ position: match.index + match[0].length });
  }
  boundaries.sort((a, b) => a.position - b.position);
  return boundaries;
}
function splitAtSentences(content, maxLength) {
  const sentences = content.match(/[^.!?]+[.!?]+/g);
  const chunks = [];
  if (!sentences || sentences.length === 0) {
    let start = 0;
    while (start < content.length) {
      chunks.push(content.slice(start, start + maxLength).trim());
      start += maxLength;
    }
    return chunks.filter((c) => c.length > 0);
  }
  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length <= maxLength) {
      current += sentence;
    } else {
      if (current) chunks.push(current.trim());
      if (sentence.length > maxLength) {
        let start = 0;
        while (start < sentence.length) {
          chunks.push(sentence.slice(start, start + maxLength).trim());
          start += maxLength;
        }
        current = "";
      } else {
        current = sentence;
      }
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}
async function stageNodes(nodes, config) {
  const { dedupeSimilarity = 0.9, enableIntraBatch = true } = config ?? {};
  let staged = [...nodes];
  if (enableIntraBatch && staged.length > 1) {
    staged = deduplicateIntraBatch(staged, dedupeSimilarity);
  }
  staged = staged.filter(validateStagedNode);
  return staged;
}
function deduplicateIntraBatch(nodes, threshold) {
  const unique = [];
  for (const node of nodes) {
    const isDuplicate = unique.some(
      (existing) => calculateSimilarity(existing.body, node.body) >= threshold
    );
    if (!isDuplicate) unique.push(node);
  }
  return unique;
}
function calculateSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = /* @__PURE__ */ new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}
function validateStagedNode(node) {
  if (!node.stagingId || !node.title || !node.body) return false;
  if (node.body.length < 3) return false;
  return true;
}
async function commitNodes(nodes, _context) {
  const created = [];
  const updated = [];
  const linked = [];
  const thoughtPath = {
    nodesAccessed: [],
    nodesCreated: [],
    nodesUpdated: [],
    confidenceScores: [],
    timestamp: /* @__PURE__ */ new Date()
  };
  for (const stagedNode of nodes) {
    const nodeId = generateId("node");
    created.push(nodeId);
    thoughtPath.nodesCreated.push(nodeId);
    thoughtPath.confidenceScores.push(stagedNode.extractionConfidence);
    if (stagedNode.suggestedEdges) {
      for (const _edge of stagedNode.suggestedEdges) {
        linked.push(generateId("edge"));
      }
    }
  }
  return {
    created,
    updated,
    linked,
    thoughtPath,
    timestamp: /* @__PURE__ */ new Date()
  };
}
function createThoughtPath(accessed, created, updated, confidences) {
  return {
    nodesAccessed: accessed,
    nodesCreated: created,
    nodesUpdated: updated,
    confidenceScores: confidences,
    timestamp: /* @__PURE__ */ new Date()
  };
}
async function ingest(input, source, context, options) {
  const startTime = performance.now();
  const envelope = createInputEnvelope(source, input, context, options);
  if (envelope.mode === "incognito" && !options?.forceSave) {
    return {
      inputId: envelope.id,
      classification: {
        intent: "content",
        saveSignal: "none",
        contentType: "mixed",
        complexity: "atomic",
        confidence: 1,
        contentCategory: "general",
        thoughtPath: [],
        classifiedBy: "fast_rules"
      },
      action: "ignored",
      thoughtPath: createThoughtPath([], [], [], []),
      warnings: ["Incognito mode - content not saved"],
      processingTimeMs: performance.now() - startTime
    };
  }
  let classification = await classifyInput(envelope, {
    defaultContentCategory: options?.contentCategory
  });
  if (options?.forceSave) {
    classification = {
      ...classification,
      intent: "content",
      saveSignal: "explicit",
      confidence: 1,
      contentCategory: options.contentCategory ?? classification.contentCategory
    };
  }
  const handler = routeClassification(classification);
  const processResult = await processInput(envelope, classification, handler);
  let nodes;
  let thoughtPath;
  if (processResult.stagedNodes && processResult.stagedNodes.length > 0) {
    const staged = await stageNodes(processResult.stagedNodes);
    const commitResult = await commitNodes(staged, {
      userId: context.userId,
      sessionId: context.sessionId
    });
    nodes = commitResult.created;
    thoughtPath = commitResult.thoughtPath;
  } else {
    thoughtPath = createThoughtPath(classification.thoughtPath, [], [], [classification.confidence]);
  }
  return {
    inputId: envelope.id,
    classification,
    action: processResult.action,
    nodes,
    thoughtPath,
    processingTimeMs: performance.now() - startTime
  };
}
async function save(content, context, options) {
  return ingest(content, "api", { ...context, conversationHistory: [] }, {
    forceSave: true,
    contentCategory: options?.contentCategory
  });
}
async function classify(input, context) {
  const envelope = createInputEnvelope("api", input, { ...context, conversationHistory: [] });
  return classifyInput(envelope);
}
function createStream(_options) {
  const id = generateId("stream");
  return {
    id,
    status: "active",
    addChunk: () => {
    },
    signalSilence: () => {
    },
    getAccumulated: () => "",
    forceExtract: async () => ({
      inputId: id,
      classification: {
        intent: "content",
        saveSignal: "implicit",
        contentType: "mixed",
        complexity: "atomic",
        confidence: 0.7,
        contentCategory: "general",
        thoughtPath: [],
        classifiedBy: "fast_rules"
      },
      action: "saved",
      thoughtPath: createThoughtPath([], [], [], []),
      processingTimeMs: 0
    }),
    pause: () => {
    },
    resume: () => {
    },
    close: async () => [],
    on: () => {
    }
  };
}

// src/working-memory/constants.ts
var PROMOTION_TRIGGERS = [
  "user_access",
  "query_activation",
  "important_connection",
  "high_confidence",
  "explicit_save"
];
var WM_STATUSES = ["pending", "promoted", "faded"];
var TRIGGER_SCORES = {
  user_access: 0.4,
  query_activation: 0.2,
  important_connection: 0.3,
  high_confidence: 0.2,
  explicit_save: 1
};
var PROMOTION_THRESHOLD = 0.5;
var SCORE_DECAY_PER_DAY = 0.1;
var WM_CHECK_INTERVAL_MINUTES = 60;
var WM_DURATION_MULTIPLIER_RANGE = [0.5, 2];
var WM_RETRIEVAL_PRIORITY_MULTIPLIER = 0.7;
var FADED_RETRIEVABILITY = 0.05;
var RESTORED_STRENGTH_BONUS = 0.1;
var WM_CONFIG = {
  triggers: PROMOTION_TRIGGERS,
  trigger_scores: TRIGGER_SCORES,
  promotion_threshold: PROMOTION_THRESHOLD,
  score_decay_per_day: SCORE_DECAY_PER_DAY,
  duration_multiplier_range: WM_DURATION_MULTIPLIER_RANGE,
  fade_action: "dormant",
  restoration_action: "direct_promote",
  manual_bypass: true,
  check_interval_minutes: WM_CHECK_INTERVAL_MINUTES,
  retrieval_priority_multiplier: WM_RETRIEVAL_PRIORITY_MULTIPLIER,
  faded_retrievability: FADED_RETRIEVABILITY,
  restored_strength_bonus: RESTORED_STRENGTH_BONUS
};
var WM_EVALUATION_JOB_SPEC = {
  id: "J-015",
  name: "working-memory-evaluation",
  description: "Evaluate pending Working Memory nodes for promotion or fade",
  schedule: "0 * * * *",
  priority: "low",
  concurrency: 1,
  timeout_minutes: 5,
  retries: 2
};
var CATEGORY_TO_NODE_TYPE = {
  identity: "person",
  academic: "concept",
  conversation: "fact",
  work: "note",
  temporal: "event",
  document: "document",
  general: "fact"
};
var TriggerEventSchema = z.object({
  type: z.enum(PROMOTION_TRIGGERS),
  timestamp: z.date(),
  score_contribution: z.number().min(0).max(1),
  details: z.record(z.unknown()).optional()
});
var WorkingMemoryStateSchema = z.object({
  entered_at: z.date(),
  expires_at: z.date(),
  content_category: z.string(),
  promotion_score: z.number().min(0).max(1),
  score_last_updated: z.date(),
  trigger_events: z.array(TriggerEventSchema),
  status: z.enum(WM_STATUSES),
  resolved_at: z.date().optional(),
  resolution_reason: z.string().optional()
});
var WorkingMemoryConfigSchema = z.object({
  duration_hours: z.record(z.number().positive()),
  user_duration_multiplier: z.number().min(WM_DURATION_MULTIPLIER_RANGE[0]).max(WM_DURATION_MULTIPLIER_RANGE[1]).default(1),
  promotion_threshold: z.number().min(0).max(1).default(PROMOTION_THRESHOLD),
  score_decay_per_day: z.number().min(0).max(1).default(SCORE_DECAY_PER_DAY),
  check_interval_minutes: z.number().positive().default(WM_CHECK_INTERVAL_MINUTES),
  manual_bypass: z.boolean().default(true)
});
var PromotionResultSchema = z.object({
  nodeId: z.string(),
  finalScore: z.number().min(0).max(1),
  durationHours: z.number().min(0),
  triggerCount: z.number().min(0),
  reason: z.string(),
  promotedAt: z.date(),
  initialStability: z.number().positive(),
  initialDifficulty: z.number().min(0).max(1)
});
var FadeResultSchema = z.object({
  nodeId: z.string(),
  finalScore: z.number().min(0).max(1),
  durationHours: z.number().min(0),
  triggerCount: z.number().min(0),
  reason: z.string(),
  fadedAt: z.date()
});
var RestorationResultSchema = z.object({
  nodeId: z.string(),
  restoredAt: z.date(),
  initialStability: z.number().positive(),
  newStrength: z.number().min(0).max(1)
});
var EvaluationResultSchema = z.object({
  evaluated: z.number().min(0),
  promoted: z.number().min(0),
  faded: z.number().min(0),
  stillPending: z.number().min(0),
  errors: z.array(z.string()),
  evaluatedAt: z.date(),
  durationMs: z.number().min(0)
});
var WMEntryOptionsSchema = z.object({
  contentCategory: z.string(),
  initialScore: z.number().min(0).max(1).optional(),
  durationMultiplier: z.number().min(WM_DURATION_MULTIPLIER_RANGE[0]).max(WM_DURATION_MULTIPLIER_RANGE[1]).optional(),
  skipIfExists: z.boolean().optional()
});
var ScoreCalculationInputSchema = z.object({
  promotionScore: z.number().min(0).max(1),
  scoreLastUpdated: z.date(),
  now: z.date().optional()
});

// src/working-memory/index.ts
function hoursBetween2(start, end) {
  return (end.getTime() - start.getTime()) / (1e3 * 60 * 60);
}
function daysBetween3(start, end) {
  return (end.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24);
}
function validateWorkingMemoryState(state) {
  return WorkingMemoryStateSchema.safeParse(state).success;
}
function mapCategoryToNodeType(category) {
  return CATEGORY_TO_NODE_TYPE[category] ?? "fact";
}
function getWorkingMemoryDuration(category, multiplier = 1) {
  const baseDuration = WORKING_MEMORY_DURATIONS[category] ?? WORKING_MEMORY_DURATIONS.general;
  return baseDuration * Math.max(
    WM_DURATION_MULTIPLIER_RANGE[0],
    Math.min(WM_DURATION_MULTIPLIER_RANGE[1], multiplier)
  );
}
function createWorkingMemoryState(options, _config) {
  const now = /* @__PURE__ */ new Date();
  const multiplier = options.durationMultiplier ?? 1;
  const durationHours = getWorkingMemoryDuration(options.contentCategory, multiplier);
  const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1e3);
  return {
    entered_at: now,
    expires_at: expiresAt,
    content_category: options.contentCategory,
    promotion_score: options.initialScore ?? 0,
    score_last_updated: now,
    trigger_events: [],
    status: "pending"
  };
}
function calculateCurrentScore(input) {
  const now = input.now ?? /* @__PURE__ */ new Date();
  const days = daysBetween3(input.scoreLastUpdated, now);
  const decay = days * SCORE_DECAY_PER_DAY;
  return Math.max(0, input.promotionScore - decay);
}
function recordTriggerEvent(wmState, trigger, details) {
  const now = /* @__PURE__ */ new Date();
  const currentScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated,
    now
  });
  const event = {
    type: trigger,
    timestamp: now,
    score_contribution: TRIGGER_SCORES[trigger],
    details
  };
  const newScore = Math.min(1, currentScore + event.score_contribution);
  const updatedState = {
    ...wmState,
    promotion_score: newScore,
    score_last_updated: now,
    trigger_events: [...wmState.trigger_events, event]
  };
  const shouldPromote2 = trigger === "explicit_save" || newScore >= PROMOTION_THRESHOLD;
  return { updatedState, shouldPromote: shouldPromote2 };
}
function shouldPromote(wmState) {
  const currentScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated
  });
  return currentScore >= PROMOTION_THRESHOLD;
}
async function promoteNode(nodeId, wmState, reason) {
  const now = /* @__PURE__ */ new Date();
  const finalScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated,
    now
  });
  const nodeType = mapCategoryToNodeType(wmState.content_category);
  return {
    nodeId,
    finalScore,
    durationHours: hoursBetween2(wmState.entered_at, now),
    triggerCount: wmState.trigger_events.length,
    reason: reason ?? `Score ${finalScore.toFixed(2)} >= ${PROMOTION_THRESHOLD} threshold`,
    promotedAt: now,
    initialStability: getInitialStability(nodeType),
    initialDifficulty: getInitialDifficulty(nodeType)
  };
}
async function fadeNode(nodeId, wmState, reason) {
  const now = /* @__PURE__ */ new Date();
  const finalScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated,
    now
  });
  return {
    nodeId,
    finalScore,
    durationHours: hoursBetween2(wmState.entered_at, now),
    triggerCount: wmState.trigger_events.length,
    reason: reason ?? `Expired with score ${finalScore.toFixed(2)} < ${PROMOTION_THRESHOLD} threshold`,
    fadedAt: now
  };
}
async function restoreFromDormant(nodeId, contentCategory) {
  const now = /* @__PURE__ */ new Date();
  const nodeType = mapCategoryToNodeType(contentCategory);
  return {
    nodeId,
    restoredAt: now,
    initialStability: getInitialStability(nodeType),
    newStrength: 0.5 + RESTORED_STRENGTH_BONUS
  };
}
async function evaluateNode(wmState, now = /* @__PURE__ */ new Date()) {
  if (wmState.status !== "pending") {
    return wmState.status === "promoted" ? "promoted" : "faded";
  }
  const currentScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated,
    now
  });
  if (currentScore >= PROMOTION_THRESHOLD) {
    return "promoted";
  }
  if (now >= wmState.expires_at) {
    return "faded";
  }
  return "pending";
}
async function evaluateWorkingMemory(pendingNodes) {
  const startTime = Date.now();
  const now = /* @__PURE__ */ new Date();
  const results = {
    evaluated: 0,
    promoted: 0,
    faded: 0,
    stillPending: 0,
    errors: [],
    evaluatedAt: now,
    durationMs: 0
  };
  for (const node of pendingNodes) {
    try {
      results.evaluated++;
      const decision = await evaluateNode(node.working_memory, now);
      switch (decision) {
        case "promoted":
          results.promoted++;
          break;
        case "faded":
          results.faded++;
          break;
        case "pending":
          results.stillPending++;
          break;
      }
    } catch (error) {
      results.errors.push(`Node ${node.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  results.durationMs = Date.now() - startTime;
  return results;
}
function isInWorkingMemory(node) {
  return node.working_memory?.status === "pending";
}
function getTimeRemaining(wmState) {
  const now = /* @__PURE__ */ new Date();
  const remaining = hoursBetween2(now, wmState.expires_at);
  return Math.max(0, remaining);
}
function getPromotionProgress(wmState) {
  const currentScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated
  });
  return Math.min(100, currentScore / PROMOTION_THRESHOLD * 100);
}
function markAsPromoted(wmState, reason) {
  return {
    ...wmState,
    status: "promoted",
    resolved_at: /* @__PURE__ */ new Date(),
    resolution_reason: reason
  };
}
function markAsFaded(wmState, reason) {
  return {
    ...wmState,
    status: "faded",
    resolved_at: /* @__PURE__ */ new Date(),
    resolution_reason: reason
  };
}

// src/forgetting/constants.ts
var CONTENT_CATEGORIES2 = [
  "identity",
  // Personal facts: name, birthday, address
  "academic",
  // Concepts, definitions, learned facts
  "conversation",
  // Chat messages, casual discussion
  "work",
  // Meetings, projects, documents
  "temporal",
  // Events, appointments, deadlines
  "document",
  // Imported raw documents
  "general"
  // Default/unknown
];
var FORGETTING_LIFECYCLE_STATES = [
  "ACTIVE",
  // R > 0.5 - Full search inclusion
  "WEAK",
  // R 0.1-0.5 - Search with penalty
  "DORMANT",
  // R < 0.1 for 60+ days - Excluded from search
  "SUMMARIZED",
  // 120+ days dormant - Compressed via P-008
  "ARCHIVED",
  // 180+ days dormant - Cold storage
  "DELETION_CANDIDATE",
  // 365+ days archived - Flagged for review
  "TRASH",
  // User confirmed - 30-day buffer
  "DELETED"
  // Permanently removed
];
var STRENGTHENING_EVENTS = [
  "direct_retrieval",
  // Node was directly retrieved for a query
  "co_activation",
  // Activated alongside another node
  "user_interaction",
  // User edited, pinned, or expanded
  "external_reference"
  // Node mentioned in new input
];
var INITIAL_STABILITY_BY_CATEGORY = {
  identity: 30,
  academic: 1,
  conversation: 0.5,
  // 12 hours
  work: 3,
  temporal: 7,
  document: 1,
  general: 1
};
var BASE_DIFFICULTY_BY_CATEGORY = {
  identity: 0.1,
  academic: 0.5,
  conversation: 0.2,
  work: 0.4,
  temporal: 0.2,
  document: 0.6,
  general: 0.3
};
var STRENGTHENING_BONUSES = {
  direct_retrieval: 0.1,
  // Strong signal - user asked for this
  co_activation: 0.03,
  // Weak but cumulative
  user_interaction: 0.15,
  // Strongest - edit, pin, expand
  external_reference: 0.05
  // Moderate - mentioned in new input
};
var MAX_STRENGTH = 1;
var DEFAULT_STRENGTH = 0.5;
var DIFFICULTY_CONFIG = {
  complexity_weight: 0.2,
  reaccess_weight: 0.15,
  connection_weight: 0.1,
  mean_reversion_rate: 0.1,
  target_difficulty: 0.3,
  min_difficulty: 0.05,
  max_difficulty: 0.95,
  reaccess_penalty_threshold_days: 3,
  reaccess_penalty_amount: 0.2,
  max_connection_bonus: 0.3,
  connection_bonus_per_edge: 0.02
};
var LIFECYCLE_THRESHOLDS = {
  active_threshold: 0.5,
  weak_threshold: 0.1,
  dormant_days: 60,
  compress_days: 120,
  archive_days: 180,
  deletion_candidate_days: 365,
  trash_buffer_days: 30,
  recent_search_days: 180
};
var DELETION_EXCLUSION_RULES = {
  exclude_identity_content: true,
  exclude_pinned: true,
  exclude_with_active_links: true,
  exclude_if_ever_restored: true,
  exclude_if_searched_recently: true
};
var DELETION_CRITERIA = {
  min_days_archived: LIFECYCLE_THRESHOLDS.deletion_candidate_days,
  exclusions: DELETION_EXCLUSION_RULES
};
var TRASH_CONFIG = {
  buffer_days: LIFECYCLE_THRESHOLDS.trash_buffer_days,
  auto_empty: true,
  show_in_storage_count: true
};
var P008_COMPRESSION_PROMPT_SPEC = {
  id: "P-008",
  name: "Compression Summary",
  model: "claude-3-haiku",
  fallback_model: "gpt-4o-mini",
  max_tokens: 200,
  temperature: 0.3
};
var DECAY_JOB_SPEC = {
  id: "J-001",
  name: "decay-cycle",
  schedule: "0 3 * * *",
  // Daily at 3am UTC
  priority: "low",
  concurrency: 1,
  timeout_minutes: 30
};
var FORGETTING_CONFIG = {
  initial_stability: INITIAL_STABILITY_BY_CATEGORY,
  base_difficulty: BASE_DIFFICULTY_BY_CATEGORY,
  strengthening_bonuses: STRENGTHENING_BONUSES,
  difficulty: DIFFICULTY_CONFIG,
  thresholds: LIFECYCLE_THRESHOLDS,
  deletion: DELETION_CRITERIA,
  trash: TRASH_CONFIG,
  compression: P008_COMPRESSION_PROMPT_SPEC,
  decay_job: DECAY_JOB_SPEC,
  max_strength: MAX_STRENGTH,
  default_strength: DEFAULT_STRENGTH
};
function isContentCategory(value) {
  return CONTENT_CATEGORIES2.includes(value);
}
function isForgettingLifecycleState(value) {
  return FORGETTING_LIFECYCLE_STATES.includes(value);
}
function isStrengtheningEventType(value) {
  return STRENGTHENING_EVENTS.includes(value);
}
var NeuralStateSchema = z.object({
  stability: z.number().positive(),
  retrievability: z.number().min(0).max(1),
  strength: z.number().min(0).max(MAX_STRENGTH),
  difficulty: z.number().min(DIFFICULTY_CONFIG.min_difficulty).max(DIFFICULTY_CONFIG.max_difficulty),
  last_accessed: z.date(),
  access_count: z.number().int().nonnegative(),
  lifecycle_state: z.enum(FORGETTING_LIFECYCLE_STATES),
  days_in_dormant: z.number().nonnegative().optional()
});
var StrengtheningRecordSchema = z.object({
  type: z.enum(STRENGTHENING_EVENTS),
  timestamp: z.date(),
  strength_before: z.number().min(0).max(MAX_STRENGTH),
  strength_after: z.number().min(0).max(MAX_STRENGTH),
  strength_delta: z.number().min(0)
});
var DifficultyFactorsSchema = z.object({
  base: z.number().min(0).max(1),
  complexity: z.number().min(0).max(1),
  reaccess_penalty: z.number().min(0).max(1),
  connection_bonus: z.number().min(0).max(1),
  calculated: z.number().min(DIFFICULTY_CONFIG.min_difficulty).max(DIFFICULTY_CONFIG.max_difficulty)
});
var ComplexityAnalysisSchema = z.object({
  length_score: z.number().min(0).max(1),
  sentence_score: z.number().min(0).max(1),
  vocab_score: z.number().min(0).max(1),
  complexity: z.number().min(0).max(1)
});
var CompressionInputSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  content: z.string(),
  connected_nodes: z.array(z.string()),
  temporal_span: z.string().nullable()
});
var CompressionResultSchema = z.object({
  summary: z.string(),
  preserved_entities: z.array(z.string()),
  key_facts: z.array(z.string()),
  temporal_span: z.string().nullable(),
  summary_node_id: z.string(),
  original_node_id: z.string(),
  compressed_at: z.date()
});
var ExclusionCheckResultSchema = z.object({
  is_identity: z.boolean(),
  is_pinned: z.boolean(),
  has_active_links: z.boolean(),
  was_ever_restored: z.boolean(),
  was_searched_recently: z.boolean(),
  any_exclusion: z.boolean()
});
var DeletionCandidateSchema = z.object({
  nodeId: z.string(),
  days_archived: z.number().nonnegative(),
  days_since_access: z.number().nonnegative(),
  content_category: z.enum(CONTENT_CATEGORIES2),
  exclusion_checks: ExclusionCheckResultSchema,
  is_candidate: z.boolean(),
  reason: z.string()
});
var TrashRecordSchema = z.object({
  nodeId: z.string(),
  trashed_at: z.date(),
  auto_delete_at: z.date(),
  reason: z.string(),
  initiated_by: z.enum(["user", "system"])
});
var CleanupSettingsSchema = z.object({
  deletion_candidate_days: z.number().int().min(180).max(730).default(LIFECYCLE_THRESHOLDS.deletion_candidate_days),
  trash_buffer_days: z.number().int().min(7).max(90).default(LIFECYCLE_THRESHOLDS.trash_buffer_days),
  cleanup_reminder_frequency: z.enum(["monthly", "quarterly", "yearly", "never"]).default("quarterly"),
  storage_warning_threshold: z.number().min(0.5).max(1).default(0.8),
  auto_suggest_cleanup: z.boolean().default(true),
  require_confirmation: z.boolean().default(true)
});
var StorageMetricsSchema = z.object({
  active: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  weak: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  dormant: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  summarized: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  archived: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  deletion_candidates: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  trash: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  total: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() })
});
var StabilityUpdateResultSchema = z.object({
  nodeId: z.string(),
  stability_before: z.number().positive(),
  stability_after: z.number().positive(),
  growth_factor: z.number().positive(),
  difficulty: z.number().min(0).max(1),
  capped: z.boolean(),
  retrievability_reset: z.boolean()
});
var StateTransitionSchema = z.object({
  from: z.enum(FORGETTING_LIFECYCLE_STATES),
  to: z.enum(FORGETTING_LIFECYCLE_STATES),
  count: z.number().int().nonnegative()
});
var DecayJobResultSchema = z.object({
  evaluated: z.number().int().nonnegative(),
  state_changes: z.array(StateTransitionSchema),
  compressed: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  deletion_candidates_flagged: z.number().int().nonnegative(),
  auto_deleted: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  executed_at: z.date(),
  duration_ms: z.number().nonnegative()
});
var NodeDecayInputSchema = z.object({
  nodeId: z.string(),
  content_category: z.enum(CONTENT_CATEGORIES2),
  neural_state: NeuralStateSchema,
  pinned: z.boolean(),
  restore_count: z.number().int().nonnegative(),
  last_archive_search_hit: z.date().nullable(),
  active_inbound_link_count: z.number().int().nonnegative()
});
var StrengtheningResultSchema = z.object({
  updated_state: NeuralStateSchema,
  record: StrengtheningRecordSchema
});
var LifecycleDeterminationSchema = z.object({
  retrievability: z.number().min(0).max(1),
  days_dormant: z.number().nonnegative(),
  state: z.enum(FORGETTING_LIFECYCLE_STATES),
  compression_eligible: z.boolean(),
  archive_eligible: z.boolean(),
  deletion_candidate_eligible: z.boolean()
});
var CreateNeuralStateOptionsSchema = z.object({
  content_category: z.enum(CONTENT_CATEGORIES2),
  initial_stability: z.number().positive().optional(),
  initial_difficulty: z.number().min(0).max(1).optional(),
  initial_strength: z.number().min(0).max(1).optional()
});

// src/forgetting/index.ts
function daysBetween4(start, end) {
  return (end.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24);
}
function calculateRetrievability2(stability, daysSinceAccess) {
  if (stability <= 0) return 0;
  if (daysSinceAccess <= 0) return 1;
  return Math.pow(0.9, daysSinceAccess / stability);
}
function getDecayLifecycleState2(retrievability, daysDormant = 0) {
  if (retrievability > LIFECYCLE_THRESHOLDS.active_threshold) {
    return "ACTIVE";
  }
  if (retrievability > LIFECYCLE_THRESHOLDS.weak_threshold) {
    return "WEAK";
  }
  if (daysDormant < LIFECYCLE_THRESHOLDS.dormant_days) {
    return "DORMANT";
  }
  if (daysDormant < LIFECYCLE_THRESHOLDS.compress_days) {
    return "DORMANT";
  }
  if (daysDormant < LIFECYCLE_THRESHOLDS.archive_days) {
    return "SUMMARIZED";
  }
  return "ARCHIVED";
}
function determineLifecycle(neuralState, now = /* @__PURE__ */ new Date()) {
  const daysSinceAccess = daysBetween4(neuralState.last_accessed, now);
  const retrievability = calculateRetrievability2(neuralState.stability, daysSinceAccess);
  const daysDormant = neuralState.days_in_dormant ?? 0;
  const state = getDecayLifecycleState2(retrievability, daysDormant);
  return {
    retrievability,
    days_dormant: daysDormant,
    state,
    compression_eligible: state === "DORMANT" && daysDormant >= LIFECYCLE_THRESHOLDS.compress_days,
    archive_eligible: state === "SUMMARIZED" && daysDormant >= LIFECYCLE_THRESHOLDS.archive_days,
    deletion_candidate_eligible: state === "ARCHIVED" && daysDormant >= LIFECYCLE_THRESHOLDS.deletion_candidate_days
  };
}
function updateStabilityOnAccess2(nodeId, currentStability, difficulty) {
  const difficultyFactor = 1 - difficulty * 0.5;
  const growthFactor = DECAY_CONFIG.growth_rate * difficultyFactor;
  const newStability = currentStability * growthFactor;
  const cappedStability = Math.min(newStability, DECAY_CONFIG.max_stability_days);
  const capped = newStability > DECAY_CONFIG.max_stability_days;
  return {
    nodeId,
    stability_before: currentStability,
    stability_after: cappedStability,
    growth_factor: growthFactor,
    difficulty,
    capped,
    retrievability_reset: true
  };
}
function strengthenNode(neuralState, event) {
  const bonus = STRENGTHENING_BONUSES[event];
  const headroom = MAX_STRENGTH - neuralState.strength;
  const actualBonus = bonus * headroom;
  const newStrength = Math.min(MAX_STRENGTH, neuralState.strength + actualBonus);
  const now = /* @__PURE__ */ new Date();
  const record = {
    type: event,
    timestamp: now,
    strength_before: neuralState.strength,
    strength_after: newStrength,
    strength_delta: actualBonus
  };
  const updatedState = {
    ...neuralState,
    strength: newStrength
  };
  return { updated_state: updatedState, record };
}
function analyzeComplexity(content) {
  if (!content || content.trim().length === 0) {
    return {
      length_score: 0,
      sentence_score: 0,
      vocab_score: 0,
      complexity: 0
    };
  }
  const words = content.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  if (wordCount === 0) {
    return {
      length_score: 0,
      sentence_score: 0,
      vocab_score: 0,
      complexity: 0
    };
  }
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceCount = Math.max(1, sentences.length);
  const avgWordLength = content.replace(/\s+/g, "").length / wordCount;
  const lengthScore = Math.min(1, wordCount / 500);
  const sentenceScore = Math.min(1, wordCount / sentenceCount / 25);
  const vocabScore = Math.max(0, Math.min(1, (avgWordLength - 4) / 4));
  const complexity = (lengthScore + sentenceScore + vocabScore) / 3;
  return {
    length_score: lengthScore,
    sentence_score: sentenceScore,
    vocab_score: vocabScore,
    complexity
  };
}
function calculateDifficulty2(contentCategory, complexity, avgDaysBetweenAccess, edgeCount) {
  const base = BASE_DIFFICULTY_BY_CATEGORY[contentCategory];
  const reaccessPenalty = avgDaysBetweenAccess < DIFFICULTY_CONFIG.reaccess_penalty_threshold_days ? DIFFICULTY_CONFIG.reaccess_penalty_amount : 0;
  const connectionBonus = Math.min(
    DIFFICULTY_CONFIG.max_connection_bonus,
    edgeCount * DIFFICULTY_CONFIG.connection_bonus_per_edge
  );
  let difficulty = base + complexity * DIFFICULTY_CONFIG.complexity_weight + reaccessPenalty * DIFFICULTY_CONFIG.reaccess_weight - connectionBonus * DIFFICULTY_CONFIG.connection_weight;
  difficulty = difficulty * (1 - DIFFICULTY_CONFIG.mean_reversion_rate) + DIFFICULTY_CONFIG.target_difficulty * DIFFICULTY_CONFIG.mean_reversion_rate;
  difficulty = Math.max(
    DIFFICULTY_CONFIG.min_difficulty,
    Math.min(DIFFICULTY_CONFIG.max_difficulty, difficulty)
  );
  return {
    base,
    complexity,
    reaccess_penalty: reaccessPenalty,
    connection_bonus: connectionBonus,
    calculated: difficulty
  };
}
function shouldCompress(neuralState, _now = /* @__PURE__ */ new Date()) {
  if (neuralState.lifecycle_state !== "DORMANT") {
    return false;
  }
  const daysDormant = neuralState.days_in_dormant ?? 0;
  return daysDormant >= LIFECYCLE_THRESHOLDS.compress_days;
}
function shouldArchive(neuralState, _now = /* @__PURE__ */ new Date()) {
  if (neuralState.lifecycle_state !== "SUMMARIZED") {
    return false;
  }
  const daysDormant = neuralState.days_in_dormant ?? 0;
  return daysDormant >= LIFECYCLE_THRESHOLDS.archive_days;
}
function hasActiveInboundLinks(activeInboundCount) {
  return activeInboundCount > 0;
}
function checkExclusionRules(node, now = /* @__PURE__ */ new Date()) {
  const isIdentity = node.content_category === "identity";
  const isPinned = node.pinned;
  const hasActiveLinks = hasActiveInboundLinks(node.active_inbound_link_count);
  const wasEverRestored = node.restore_count > 0;
  let wasSearchedRecently = false;
  if (node.last_archive_search_hit) {
    const daysSinceSearch = daysBetween4(node.last_archive_search_hit, now);
    wasSearchedRecently = daysSinceSearch < LIFECYCLE_THRESHOLDS.recent_search_days;
  }
  const anyExclusion = isIdentity || isPinned || hasActiveLinks || wasEverRestored || wasSearchedRecently;
  return {
    is_identity: isIdentity,
    is_pinned: isPinned,
    has_active_links: hasActiveLinks,
    was_ever_restored: wasEverRestored,
    was_searched_recently: wasSearchedRecently,
    any_exclusion: anyExclusion
  };
}
function isDeletionCandidate(node, daysArchived, now = /* @__PURE__ */ new Date()) {
  const daysSinceAccess = daysBetween4(node.neural_state.last_accessed, now);
  const exclusionChecks = checkExclusionRules(node, now);
  if (daysArchived < DELETION_CRITERIA.min_days_archived) {
    return {
      nodeId: node.nodeId,
      days_archived: daysArchived,
      days_since_access: daysSinceAccess,
      content_category: node.content_category,
      exclusion_checks: exclusionChecks,
      is_candidate: false,
      reason: `Only ${daysArchived} days archived, need ${DELETION_CRITERIA.min_days_archived}`
    };
  }
  if (exclusionChecks.any_exclusion) {
    const reasons = [];
    if (exclusionChecks.is_identity) reasons.push("identity content");
    if (exclusionChecks.is_pinned) reasons.push("pinned");
    if (exclusionChecks.has_active_links) reasons.push("has active inbound links");
    if (exclusionChecks.was_ever_restored) reasons.push("was restored before");
    if (exclusionChecks.was_searched_recently) reasons.push("recently searched");
    return {
      nodeId: node.nodeId,
      days_archived: daysArchived,
      days_since_access: daysSinceAccess,
      content_category: node.content_category,
      exclusion_checks: exclusionChecks,
      is_candidate: false,
      reason: `Excluded: ${reasons.join(", ")}`
    };
  }
  return {
    nodeId: node.nodeId,
    days_archived: daysArchived,
    days_since_access: daysSinceAccess,
    content_category: node.content_category,
    exclusion_checks: exclusionChecks,
    is_candidate: true,
    reason: `Archived ${daysArchived} days, no exclusions triggered`
  };
}
function moveToTrash(nodeId, reason, initiatedBy) {
  const now = /* @__PURE__ */ new Date();
  const autoDeleteAt = new Date(now.getTime() + TRASH_CONFIG.buffer_days * 24 * 60 * 60 * 1e3);
  return {
    nodeId,
    trashed_at: now,
    auto_delete_at: autoDeleteAt,
    reason,
    initiated_by: initiatedBy
  };
}
async function permanentlyDelete(_nodeId) {
}
async function restoreFromTrash(_nodeId) {
}
async function runDecayCycle(nodes, now = /* @__PURE__ */ new Date()) {
  const startTime = Date.now();
  const stateChanges = /* @__PURE__ */ new Map();
  let compressed = 0;
  let archived = 0;
  let deletionCandidatesFlagged = 0;
  let autoDeleted = 0;
  const errors = [];
  for (const node of nodes) {
    try {
      const daysSinceAccess = daysBetween4(node.neural_state.last_accessed, now);
      const newR = calculateRetrievability2(node.neural_state.stability, daysSinceAccess);
      const daysDormant = node.neural_state.days_in_dormant ?? 0;
      const newState = getDecayLifecycleState2(newR, daysDormant);
      const oldState = node.neural_state.lifecycle_state;
      if (oldState !== newState) {
        const key = `${oldState}->${newState}`;
        const existing = stateChanges.get(key);
        if (existing) {
          existing.count++;
        } else {
          stateChanges.set(key, { from: oldState, to: newState, count: 1 });
        }
        if (newState === "SUMMARIZED") compressed++;
        if (newState === "ARCHIVED") archived++;
      }
      if (newState === "ARCHIVED") {
        const daysArchived = daysDormant - LIFECYCLE_THRESHOLDS.archive_days;
        if (daysArchived >= 0) {
          const candidate = isDeletionCandidate(node, daysArchived, now);
          if (candidate.is_candidate) {
            deletionCandidatesFlagged++;
          }
        }
      }
      if (node.neural_state.lifecycle_state === "TRASH") {
      }
    } catch (error) {
      errors.push(`Node ${node.nodeId}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  return {
    evaluated: nodes.length,
    state_changes: Array.from(stateChanges.values()),
    compressed,
    archived,
    deletion_candidates_flagged: deletionCandidatesFlagged,
    auto_deleted: autoDeleted,
    errors,
    executed_at: now,
    duration_ms: Date.now() - startTime
  };
}
function mapContentCategoryToNodeType(category) {
  const mapping = {
    identity: "person",
    academic: "concept",
    conversation: "note",
    work: "note",
    temporal: "event",
    document: "document",
    general: "fact"
  };
  return mapping[category];
}
function getInitialStabilityForCategory(category) {
  return INITIAL_STABILITY_BY_CATEGORY[category];
}
function getBaseDifficultyForCategory(category) {
  return BASE_DIFFICULTY_BY_CATEGORY[category];
}
function createNeuralState(options) {
  const stability = options.initial_stability ?? INITIAL_STABILITY_BY_CATEGORY[options.content_category];
  const difficulty = options.initial_difficulty ?? BASE_DIFFICULTY_BY_CATEGORY[options.content_category];
  const strength = options.initial_strength ?? DEFAULT_STRENGTH;
  const now = /* @__PURE__ */ new Date();
  return {
    stability,
    retrievability: 1,
    strength,
    difficulty,
    last_accessed: now,
    access_count: 0,
    lifecycle_state: "ACTIVE",
    days_in_dormant: 0
  };
}
function validateNeuralState(state) {
  return NeuralStateSchema.safeParse(state).success;
}
function validateStrengtheningRecord(record) {
  return StrengtheningRecordSchema.safeParse(record).success;
}
function validateDeletionCandidate(candidate) {
  return DeletionCandidateSchema.safeParse(candidate).success;
}
function validateDecayJobResult(result) {
  return DecayJobResultSchema.safeParse(result).success;
}

// src/clusters/constants.ts
var USER_TYPES = [
  "student",
  // Academic focus: classes, homework, exams
  "professional",
  // Work focus: meetings, projects, career
  "creative",
  // Project focus: art, writing, inspiration
  "researcher",
  // Research focus: papers, methodology, literature
  "other"
  // Pure emergence: skip templates, start fresh
];
var EVOLUTION_TRIGGERS = [
  "EMERGE",
  // New cluster forms from unclustered embeddings
  "SPLIT",
  // Large, diverse cluster divides into smaller ones
  "MERGE",
  // Similar clusters with overlapping content combine
  "LEARN"
  // Tendencies update based on user behavior
];
var CLUSTER_SOURCES = [
  "template",
  // Created from onboarding template (pinned by default)
  "emerged",
  // Auto-detected from embedding similarity
  "user_created",
  // Manually created by user (pinned by default)
  "split"
  // Result of splitting a large cluster
];
var ONBOARDING_STATES = [
  "not_started",
  // User hasn't begun onboarding
  "welcome",
  // Step 1: Welcome screen
  "user_type_selection",
  // Step 2: Select user type
  "template_preview",
  // Step 3: Preview and customize clusters
  "first_chat",
  // Step 4: First chat interaction
  "first_memory_saved",
  // Step 5: First memory successfully saved
  "completed"
  // Onboarding finished
];
var DEFAULT_EVOLUTION_THRESHOLDS = {
  emerge: {
    percentage: 0.01,
    // 1% of graph
    min: 10,
    // Never below 10 concepts
    max: 100,
    // Never above 100 concepts
    similarity: 0.7
    // Intra-cluster similarity required
  },
  split: {
    percentage: 0.1,
    // 10% of graph
    min: 50,
    // Never below 50 concepts
    max: 500,
    // Never above 500 concepts
    similarity: 0.5
    // Below this = too diverse
  },
  merge: {
    similarity: 0.8,
    // Inter-cluster similarity required
    overlap: 0.5
    // 50% concept overlap required
  }
};
var COLD_START_CONFIG = {
  threshold_nodes: 200,
  // Below this = cold-start mode
  emerge_fixed: 15,
  // Fixed emerge threshold
  split_fixed: 100,
  // Fixed split threshold
  min_days: 7
  // Minimum 7 days before adaptive
};
var SELF_TUNING_CONFIG = {
  enabled: true,
  max_drift: 0.2,
  // ±20% from initial
  window_days: 30,
  // 30-day observation window
  reset_available: true
  // User can reset anytime
};
var CLUSTER_HEALTH_THRESHOLDS = {
  active_threshold: 0.5,
  // Same as storm-007 ACTIVE threshold
  weak_threshold: 0.1,
  // Same as storm-007 WEAK threshold
  unhealthy_ratio: 0.2
  // <20% active = unhealthy
};
var ROUTING_CONFIG = {
  min_affinity: 0.3,
  // Ignore clusters below 0.3 affinity
  search_all_gap: 0.1,
  // If top 2 within 0.1, search all
  max_clusters: 3
  // Include up to 3 clusters in partial search
};
var TENDENCY_DEFAULTS = {
  decay_rate_modifier: 1,
  // No modification initially
  initial_confidence: 0.1,
  // Low confidence until learned
  min_observations: 10
  // Need 10+ observations
};
function isUserType(value) {
  return USER_TYPES.includes(value);
}
function isEvolutionTrigger(value) {
  return EVOLUTION_TRIGGERS.includes(value);
}
function isClusterSource(value) {
  return CLUSTER_SOURCES.includes(value);
}
function isOnboardingState(value) {
  return ONBOARDING_STATES.includes(value);
}
var ContextPreferencesSchema = z.object({
  tone: z.enum(["formal", "neutral", "casual"]).optional(),
  verbosity: z.enum(["concise", "adaptive", "detailed"]).optional(),
  default_format: z.enum(["prose", "bullets", "structured"]).optional(),
  use_citations: z.boolean().optional(),
  retrieval_scope: z.enum(["this_only", "this_plus", "all"]).optional(),
  include_contexts: z.array(z.string()).optional()
});
var ClusterTendenciesSchema = z.object({
  decay_rate_modifier: z.number().min(0.1).max(3),
  importance_patterns: z.array(z.string()),
  typical_access_interval: z.number().min(0.1),
  source: z.enum(["learned", "default"]),
  confidence: z.number().min(0).max(1)
});
var ClusterMembershipSchema = z.object({
  cluster_id: z.string().min(1),
  weight: z.number().min(0).max(1),
  pinned: z.boolean(),
  updated_at: z.date()
});
var ClusterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50),
  description: z.string().max(200),
  icon: z.string().min(1).max(4),
  pinned: z.boolean(),
  tendencies: ClusterTendenciesSchema,
  preferences: ContextPreferencesSchema.partial(),
  source: z.enum(CLUSTER_SOURCES),
  created_at: z.date(),
  node_count: z.number().int().min(0)
});
var ClusterHealthSchema = z.object({
  cluster_id: z.string().min(1),
  total_nodes: z.number().int().min(0),
  active_nodes: z.number().int().min(0),
  weak_nodes: z.number().int().min(0),
  dormant_nodes: z.number().int().min(0),
  health_ratio: z.number().min(0).max(1),
  avg_similarity: z.number().min(0).max(1),
  calculated_at: z.date()
});
var ClusterSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50),
  icon: z.string().min(1).max(4),
  pinned: z.boolean(),
  node_count: z.number().int().min(0),
  health_ratio: z.number().min(0).max(1)
});
var EmergeConfigSchema = z.object({
  percentage: z.number().min(1e-3).max(0.5),
  min: z.number().int().min(1),
  max: z.number().int().min(1),
  similarity: z.number().min(0).max(1)
});
var SplitConfigSchema = z.object({
  percentage: z.number().min(0.01).max(1),
  min: z.number().int().min(1),
  max: z.number().int().min(1),
  similarity: z.number().min(0).max(1)
});
var MergeConfigSchema = z.object({
  similarity: z.number().min(0).max(1),
  overlap: z.number().min(0).max(1)
});
var LearningConfigSchema = z.object({
  enabled: z.boolean(),
  max_drift: z.number().min(0).max(0.5),
  window_days: z.number().int().min(1),
  reset_available: z.boolean()
});
var EvolutionConfigSchema = z.object({
  emerge: EmergeConfigSchema,
  split: SplitConfigSchema,
  merge: MergeConfigSchema,
  learning: LearningConfigSchema
});
var EVOLUTION_CONFIG = {
  emerge: {
    percentage: DEFAULT_EVOLUTION_THRESHOLDS.emerge.percentage,
    min: DEFAULT_EVOLUTION_THRESHOLDS.emerge.min,
    max: DEFAULT_EVOLUTION_THRESHOLDS.emerge.max,
    similarity: DEFAULT_EVOLUTION_THRESHOLDS.emerge.similarity
  },
  split: {
    percentage: DEFAULT_EVOLUTION_THRESHOLDS.split.percentage,
    min: DEFAULT_EVOLUTION_THRESHOLDS.split.min,
    max: DEFAULT_EVOLUTION_THRESHOLDS.split.max,
    similarity: DEFAULT_EVOLUTION_THRESHOLDS.split.similarity
  },
  merge: {
    similarity: DEFAULT_EVOLUTION_THRESHOLDS.merge.similarity,
    overlap: DEFAULT_EVOLUTION_THRESHOLDS.merge.overlap
  },
  learning: {
    enabled: SELF_TUNING_CONFIG.enabled,
    max_drift: SELF_TUNING_CONFIG.max_drift,
    window_days: SELF_TUNING_CONFIG.window_days,
    reset_available: SELF_TUNING_CONFIG.reset_available
  }
};
var ManualClusterCreateSchema = z.object({
  at_graph_size: z.number().int().min(0),
  cluster_size: z.number().int().min(0),
  created_at: z.date()
});
var ClusterRenameSchema = z.object({
  old: z.string(),
  new: z.string(),
  reason: z.string().optional(),
  renamed_at: z.date()
});
var EvolutionLearningSchema = z.object({
  manual_cluster_creates: z.array(ManualClusterCreateSchema),
  cluster_renames: z.array(ClusterRenameSchema),
  split_acceptances: z.number().int().min(0),
  split_rejections: z.number().int().min(0),
  merge_acceptances: z.number().int().min(0),
  merge_rejections: z.number().int().min(0),
  emerge_adjustment: z.number().min(-0.2).max(0.2),
  split_adjustment: z.number().min(-0.2).max(0.2),
  last_updated: z.date()
});
var EmergeEventDetailsSchema = z.object({
  type: z.literal("EMERGE"),
  new_cluster_name: z.string(),
  node_count: z.number().int().min(1),
  similarity: z.number().min(0).max(1),
  candidate_node_ids: z.array(z.string())
});
var SplitEventDetailsSchema = z.object({
  type: z.literal("SPLIT"),
  parent_id: z.string(),
  child_ids: z.array(z.string()),
  reason: z.string(),
  parent_size: z.number().int().min(1),
  parent_similarity: z.number().min(0).max(1)
});
var MergeEventDetailsSchema = z.object({
  type: z.literal("MERGE"),
  merged_ids: z.array(z.string()).min(2),
  result_id: z.string(),
  similarity: z.number().min(0).max(1),
  overlap: z.number().min(0).max(1)
});
var LearnEventDetailsSchema = z.object({
  type: z.literal("LEARN"),
  field: z.string(),
  old_value: z.number(),
  new_value: z.number(),
  reason: z.string()
});
var EvolutionEventDetailsSchema = z.discriminatedUnion("type", [
  EmergeEventDetailsSchema,
  SplitEventDetailsSchema,
  MergeEventDetailsSchema,
  LearnEventDetailsSchema
]);
var EvolutionEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(EVOLUTION_TRIGGERS),
  cluster_id: z.string(),
  timestamp: z.date(),
  details: EvolutionEventDetailsSchema,
  user_action: z.enum(["accepted", "rejected", "modified", "pending"]).optional(),
  graph_size_at_event: z.number().int().min(0)
});
var DefaultTendenciesSchema = z.object({
  decay_rate_modifier: z.number().min(0.1).max(3),
  importance_patterns: z.array(z.string())
});
var ClusterTemplateSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200),
  icon: z.string().min(1).max(4),
  pinned: z.boolean(),
  default_tendencies: DefaultTendenciesSchema,
  preferences: ContextPreferencesSchema.partial()
});
var UnifiedTemplateSchema = z.object({
  user_type: z.enum(USER_TYPES),
  global_preferences: ContextPreferencesSchema.partial(),
  clusters: z.array(ClusterTemplateSchema)
});
var OnboardingProgressSchema = z.object({
  state: z.enum(ONBOARDING_STATES),
  user_type: z.enum(USER_TYPES).optional(),
  template_accepted: z.boolean().optional(),
  template_customized: z.boolean().optional(),
  clusters_created: z.array(z.string()),
  first_memory_id: z.string().optional(),
  started_at: z.date(),
  completed_at: z.date().optional()
});
var OnboardingActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start_onboarding") }),
  z.object({ type: z.literal("skip_to_chat") }),
  z.object({ type: z.literal("select_user_type"), userType: z.enum(USER_TYPES) }),
  z.object({ type: z.literal("accept_template"), clusterIds: z.array(z.string()) }),
  z.object({
    type: z.literal("customize_template"),
    customizations: z.array(ClusterTemplateSchema),
    clusterIds: z.array(z.string())
  }),
  z.object({ type: z.literal("first_memory_created"), memoryId: z.string() }),
  z.object({ type: z.literal("continue_after_first_memory") })
]);
var QueryClusterAffinitySchema = z.object({
  cluster_id: z.string().min(1),
  affinity: z.number().min(0).max(1)
});
var ClusterRoutingResultSchema = z.object({
  query: z.string(),
  affinities: z.array(QueryClusterAffinitySchema),
  primary_cluster: z.string().nullable(),
  search_strategy: z.enum(["primary_only", "top_clusters", "all_clusters"]),
  clusters_to_search: z.array(z.string())
});
var ClusterWithCentroidSchema = z.object({
  cluster: ClusterSchema,
  centroid: z.array(z.number())
});
function isClusterTendencies(value) {
  return ClusterTendenciesSchema.safeParse(value).success;
}
function isClusterMembership(value) {
  return ClusterMembershipSchema.safeParse(value).success;
}
function isCluster(value) {
  return ClusterSchema.safeParse(value).success;
}
function isClusterHealth(value) {
  return ClusterHealthSchema.safeParse(value).success;
}
function isClusterSummary(value) {
  return ClusterSummarySchema.safeParse(value).success;
}
function isEvolutionConfig(value) {
  return EvolutionConfigSchema.safeParse(value).success;
}
function isEvolutionLearning(value) {
  return EvolutionLearningSchema.safeParse(value).success;
}
function isEvolutionEvent(value) {
  return EvolutionEventSchema.safeParse(value).success;
}
function isClusterTemplate(value) {
  return ClusterTemplateSchema.safeParse(value).success;
}
function isUnifiedTemplate(value) {
  return UnifiedTemplateSchema.safeParse(value).success;
}
function isOnboardingProgress(value) {
  return OnboardingProgressSchema.safeParse(value).success;
}
function isOnboardingAction(value) {
  return OnboardingActionSchema.safeParse(value).success;
}
function isQueryClusterAffinity(value) {
  return QueryClusterAffinitySchema.safeParse(value).success;
}
function isClusterRoutingResult(value) {
  return ClusterRoutingResultSchema.safeParse(value).success;
}
function isClusterWithCentroid(value) {
  return ClusterWithCentroidSchema.safeParse(value).success;
}

// src/clusters/index.ts
var STUDENT_TEMPLATE = {
  user_type: "student",
  global_preferences: {
    tone: "neutral",
    verbosity: "detailed",
    use_citations: true
  },
  clusters: [
    {
      name: "Academics",
      description: "Classes, lectures, homework, exams",
      icon: "\u{1F4DA}",
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 0.7,
        importance_patterns: ["exam", "deadline", "assignment", "lecture", "quiz", "homework"]
      },
      preferences: {
        tone: "neutral",
        verbosity: "detailed",
        default_format: "structured",
        use_citations: true,
        retrieval_scope: "this_only"
      }
    },
    {
      name: "Social",
      description: "Friends, events, conversations",
      icon: "\u{1F465}",
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 1.2,
        importance_patterns: ["birthday", "event", "plan", "party", "meeting", "hangout"]
      },
      preferences: {
        tone: "casual",
        verbosity: "concise",
        default_format: "prose",
        use_citations: false,
        retrieval_scope: "all"
      }
    },
    {
      name: "Creative",
      description: "Projects, hobbies, ideas",
      icon: "\u{1F4A1}",
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 1,
        importance_patterns: ["idea", "project", "create", "make", "design", "build"]
      },
      preferences: {
        tone: "casual",
        verbosity: "adaptive",
        default_format: "bullets",
        use_citations: false,
        retrieval_scope: "this_plus",
        include_contexts: ["Academics"]
      }
    }
  ]
};
var PROFESSIONAL_TEMPLATE = {
  user_type: "professional",
  global_preferences: {
    tone: "formal",
    verbosity: "concise",
    use_citations: true
  },
  clusters: [
    {
      name: "Work",
      description: "Projects, meetings, deadlines",
      icon: "\u{1F4BC}",
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 0.8,
        importance_patterns: ["deadline", "meeting", "decision", "action item", "client", "project"]
      },
      preferences: {
        tone: "formal",
        verbosity: "concise",
        default_format: "bullets",
        use_citations: true,
        retrieval_scope: "this_only"
      }
    },
    {
      name: "Personal",
      description: "Life outside work",
      icon: "\u{1F3E0}",
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 1.1,
        importance_patterns: ["family", "health", "goal", "appointment", "vacation"]
      },
      preferences: {
        tone: "casual",
        verbosity: "adaptive",
        default_format: "prose",
        use_citations: false,
        retrieval_scope: "this_only"
      }
    },
    {
      name: "Learning",
      description: "Skills, courses, growth",
      icon: "\u{1F4C8}",
      pinned: false,
      default_tendencies: {
        decay_rate_modifier: 0.7,
        importance_patterns: ["learn", "course", "skill", "certification", "training", "tutorial"]
      },
      preferences: {
        tone: "neutral",
        verbosity: "detailed",
        default_format: "structured",
        use_citations: true,
        retrieval_scope: "this_plus",
        include_contexts: ["Work"]
      }
    }
  ]
};
var CREATIVE_TEMPLATE = {
  user_type: "creative",
  global_preferences: {
    tone: "casual",
    verbosity: "adaptive",
    use_citations: false
  },
  clusters: [
    {
      name: "Projects",
      description: "Current creative work",
      icon: "\u{1F3A8}",
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 0.8,
        importance_patterns: ["project", "deadline", "client", "deliverable", "milestone", "draft"]
      },
      preferences: {
        tone: "casual",
        verbosity: "adaptive",
        default_format: "bullets",
        use_citations: false,
        retrieval_scope: "this_only"
      }
    },
    {
      name: "Inspiration",
      description: "References, ideas, mood boards",
      icon: "\u2728",
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 1,
        importance_patterns: ["inspiration", "reference", "idea", "style", "aesthetic", "mood"]
      },
      preferences: {
        tone: "casual",
        verbosity: "detailed",
        default_format: "prose",
        use_citations: false,
        retrieval_scope: "all"
      }
    },
    {
      name: "Craft",
      description: "Techniques, tools, skills",
      icon: "\u{1F6E0}\uFE0F",
      pinned: false,
      default_tendencies: {
        decay_rate_modifier: 0.6,
        importance_patterns: ["technique", "tool", "tutorial", "how to", "process", "method"]
      },
      preferences: {
        tone: "neutral",
        verbosity: "detailed",
        default_format: "structured",
        use_citations: true,
        retrieval_scope: "this_only"
      }
    }
  ]
};
var RESEARCHER_TEMPLATE = {
  user_type: "researcher",
  global_preferences: {
    tone: "formal",
    verbosity: "detailed",
    use_citations: true
  },
  clusters: [
    {
      name: "Research",
      description: "Current research projects",
      icon: "\u{1F52C}",
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 0.5,
        importance_patterns: ["hypothesis", "finding", "experiment", "data", "result", "analysis"]
      },
      preferences: {
        tone: "formal",
        verbosity: "detailed",
        default_format: "structured",
        use_citations: true,
        retrieval_scope: "this_plus",
        include_contexts: ["Literature"]
      }
    },
    {
      name: "Literature",
      description: "Papers, books, references",
      icon: "\u{1F4D6}",
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 0.4,
        importance_patterns: ["paper", "author", "citation", "finding", "journal", "publication"]
      },
      preferences: {
        tone: "formal",
        verbosity: "detailed",
        default_format: "structured",
        use_citations: true,
        retrieval_scope: "this_only"
      }
    },
    {
      name: "Methodology",
      description: "Methods, protocols, techniques",
      icon: "\u{1F4CB}",
      pinned: false,
      default_tendencies: {
        decay_rate_modifier: 0.5,
        importance_patterns: ["method", "protocol", "procedure", "technique", "approach", "framework"]
      },
      preferences: {
        tone: "formal",
        verbosity: "detailed",
        default_format: "structured",
        use_citations: true,
        retrieval_scope: "this_only"
      }
    }
  ]
};
var OTHER_TEMPLATE = {
  user_type: "other",
  global_preferences: {
    tone: "neutral",
    verbosity: "adaptive",
    use_citations: false
  },
  clusters: []
};
var UNIFIED_TEMPLATES = {
  student: STUDENT_TEMPLATE,
  professional: PROFESSIONAL_TEMPLATE,
  creative: CREATIVE_TEMPLATE,
  researcher: RESEARCHER_TEMPLATE,
  other: OTHER_TEMPLATE
};
function getUnifiedTemplate(userType) {
  return UNIFIED_TEMPLATES[userType];
}
function getClusterTemplates(userType) {
  return UNIFIED_TEMPLATES[userType].clusters;
}
function getGlobalPreferences(userType) {
  return UNIFIED_TEMPLATES[userType].global_preferences;
}
function createEvolutionLearning() {
  return {
    manual_cluster_creates: [],
    cluster_renames: [],
    split_acceptances: 0,
    split_rejections: 0,
    merge_acceptances: 0,
    merge_rejections: 0,
    emerge_adjustment: 0,
    split_adjustment: 0,
    last_updated: /* @__PURE__ */ new Date()
  };
}
var VALID_TRANSITIONS = {
  not_started: ["start_onboarding"],
  welcome: ["skip_to_chat", "select_user_type"],
  user_type_selection: ["skip_to_chat", "select_user_type"],
  template_preview: ["accept_template", "customize_template", "skip_to_chat"],
  first_chat: ["first_memory_created"],
  first_memory_saved: ["continue_after_first_memory"],
  completed: []
};
function createOnboardingProgress() {
  return {
    state: "not_started",
    clusters_created: [],
    started_at: /* @__PURE__ */ new Date()
  };
}
function transitionOnboarding(progress, action) {
  const validActions = VALID_TRANSITIONS[progress.state];
  if (!validActions.includes(action.type)) {
    return {
      success: false,
      error: `Invalid transition: cannot perform '${action.type}' from state '${progress.state}'`
    };
  }
  switch (action.type) {
    case "start_onboarding":
      return { success: true, progress: { ...progress, state: "welcome" } };
    case "skip_to_chat":
      return {
        success: true,
        progress: { ...progress, state: "first_chat", user_type: "other", template_accepted: false }
      };
    case "select_user_type":
      return {
        success: true,
        progress: { ...progress, state: "template_preview", user_type: action.userType }
      };
    case "accept_template":
      return {
        success: true,
        progress: {
          ...progress,
          state: "first_chat",
          template_accepted: true,
          template_customized: false,
          clusters_created: action.clusterIds
        }
      };
    case "customize_template":
      return {
        success: true,
        progress: {
          ...progress,
          state: "first_chat",
          template_accepted: true,
          template_customized: true,
          clusters_created: action.clusterIds
        }
      };
    case "first_memory_created":
      return {
        success: true,
        progress: { ...progress, state: "first_memory_saved", first_memory_id: action.memoryId }
      };
    case "continue_after_first_memory":
      return {
        success: true,
        progress: { ...progress, state: "completed", completed_at: /* @__PURE__ */ new Date() }
      };
    default:
      return { success: false, error: "Unknown action type" };
  }
}
function isOnboardingComplete(progress) {
  return progress.state === "completed";
}
function hasOnboardingStarted(progress) {
  return progress.state !== "not_started";
}
function getOnboardingStepNumber(state) {
  const steps = {
    not_started: 0,
    welcome: 1,
    user_type_selection: 2,
    template_preview: 3,
    first_chat: 4,
    first_memory_saved: 5,
    completed: 6
  };
  return steps[state];
}
function getValidActions(state) {
  return VALID_TRANSITIONS[state];
}
function isActionValid(state, actionType) {
  return VALID_TRANSITIONS[state].includes(actionType);
}
function calculateEmergeThreshold(graphSize, config = EVOLUTION_CONFIG, learning) {
  if (graphSize < COLD_START_CONFIG.threshold_nodes) {
    return COLD_START_CONFIG.emerge_fixed;
  }
  const calculated = Math.floor(graphSize * config.emerge.percentage);
  let threshold = Math.max(config.emerge.min, Math.min(config.emerge.max, calculated));
  if (learning && config.learning.enabled) {
    threshold = threshold * (1 + learning.emerge_adjustment);
  }
  return Math.round(threshold);
}
function calculateSplitThreshold(graphSize, config = EVOLUTION_CONFIG, learning) {
  if (graphSize < COLD_START_CONFIG.threshold_nodes) {
    return COLD_START_CONFIG.split_fixed;
  }
  const calculated = Math.floor(graphSize * config.split.percentage);
  let threshold = Math.max(config.split.min, Math.min(config.split.max, calculated));
  if (learning && config.learning.enabled) {
    threshold = threshold * (1 + learning.split_adjustment);
  }
  return Math.round(threshold);
}
function shouldSuggestEmerge(candidateNodeCount, similarity, graphSize, config = EVOLUTION_CONFIG, learning) {
  if (similarity < config.emerge.similarity) {
    return false;
  }
  const threshold = calculateEmergeThreshold(graphSize, config, learning);
  return candidateNodeCount >= threshold;
}
function shouldSuggestSplit(clusterSize, similarity, graphSize, config = EVOLUTION_CONFIG, learning) {
  if (similarity >= config.split.similarity) {
    return false;
  }
  const threshold = calculateSplitThreshold(graphSize, config, learning);
  return clusterSize >= threshold;
}
function shouldSuggestMerge(interClusterSimilarity, overlapPercentage, config = EVOLUTION_CONFIG) {
  return interClusterSimilarity >= config.merge.similarity && overlapPercentage >= config.merge.overlap;
}
function calculateClusterHealth(cluster, nodeStates, avgSimilarity = 0) {
  const total_nodes = nodeStates.length;
  let active_nodes = 0;
  let weak_nodes = 0;
  let dormant_nodes = 0;
  for (const node of nodeStates) {
    if (node.retrievability > CLUSTER_HEALTH_THRESHOLDS.active_threshold) {
      active_nodes++;
    } else if (node.retrievability > CLUSTER_HEALTH_THRESHOLDS.weak_threshold) {
      weak_nodes++;
    } else {
      dormant_nodes++;
    }
  }
  const health_ratio = total_nodes > 0 ? active_nodes / total_nodes : 0;
  return {
    cluster_id: cluster.id,
    total_nodes,
    active_nodes,
    weak_nodes,
    dormant_nodes,
    health_ratio,
    avg_similarity: avgSimilarity,
    calculated_at: /* @__PURE__ */ new Date()
  };
}
function isClusterUnhealthy(health) {
  return health.health_ratio < CLUSTER_HEALTH_THRESHOLDS.unhealthy_ratio;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
function updateLearning(learning, event) {
  const maxDrift = SELF_TUNING_CONFIG.max_drift;
  const updated = { ...learning, last_updated: /* @__PURE__ */ new Date() };
  switch (event.type) {
    case "EMERGE":
      if (event.user_action === "rejected") {
        updated.emerge_adjustment = clamp(updated.emerge_adjustment + 0.05, -maxDrift, maxDrift);
      }
      break;
    case "SPLIT":
      if (event.user_action === "accepted") {
        updated.split_acceptances++;
      } else if (event.user_action === "rejected") {
        updated.split_rejections++;
        if (updated.split_rejections > updated.split_acceptances) {
          updated.split_adjustment = clamp(updated.split_adjustment + 0.05, -maxDrift, maxDrift);
        }
      }
      break;
    case "MERGE":
      if (event.user_action === "accepted") {
        updated.merge_acceptances++;
      } else if (event.user_action === "rejected") {
        updated.merge_rejections++;
      }
      break;
  }
  return updated;
}
function recordManualClusterCreate(learning, graphSize, clusterSize) {
  const maxDrift = SELF_TUNING_CONFIG.max_drift;
  const updated = {
    ...learning,
    manual_cluster_creates: [
      ...learning.manual_cluster_creates,
      { at_graph_size: graphSize, cluster_size: clusterSize, created_at: /* @__PURE__ */ new Date() }
    ],
    last_updated: /* @__PURE__ */ new Date()
  };
  const avgManualSize = mean(updated.manual_cluster_creates.map((c) => c.cluster_size));
  const defaultSize = 20;
  const deviation = (avgManualSize - defaultSize) / 100;
  updated.emerge_adjustment = clamp(deviation, -maxDrift, maxDrift);
  return updated;
}
function resetLearning() {
  return createEvolutionLearning();
}
function generateClusterId() {
  return `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
function createTendenciesFromTemplate(template) {
  return {
    decay_rate_modifier: template.default_tendencies.decay_rate_modifier,
    importance_patterns: [...template.default_tendencies.importance_patterns],
    typical_access_interval: TENDENCY_DEFAULTS.decay_rate_modifier,
    source: "default",
    confidence: TENDENCY_DEFAULTS.initial_confidence
  };
}
function createClusterFromTemplate(template, source = "template") {
  return {
    id: generateClusterId(),
    name: template.name,
    description: template.description,
    icon: template.icon,
    pinned: template.pinned,
    tendencies: createTendenciesFromTemplate(template),
    preferences: { ...template.preferences },
    source,
    created_at: /* @__PURE__ */ new Date(),
    node_count: 0
  };
}
function applyUnifiedTemplate(template) {
  const clusters = [];
  for (const clusterTemplate of template.clusters) {
    const cluster = createClusterFromTemplate(clusterTemplate, "template");
    clusters.push(cluster);
  }
  return {
    cluster_ids: clusters.map((c) => c.id),
    clusters
  };
}
function isInColdStartMode(graphSize) {
  return graphSize < COLD_START_CONFIG.threshold_nodes;
}
function getEvolutionMode(graphSize) {
  return isInColdStartMode(graphSize) ? "cold_start" : "adaptive";
}
function clusterCosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  if (a.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
function calculateAffinity(queryEmbedding, clusterCentroid) {
  const similarity = clusterCosineSimilarity(queryEmbedding, clusterCentroid);
  return Math.max(0, similarity);
}
function routeQueryToClusters(query, queryEmbedding, clustersWithCentroids) {
  if (clustersWithCentroids.length === 0) {
    return {
      query,
      affinities: [],
      primary_cluster: null,
      search_strategy: "all_clusters",
      clusters_to_search: []
    };
  }
  const affinities = clustersWithCentroids.map(({ cluster, centroid }) => ({
    cluster_id: cluster.id,
    affinity: calculateAffinity(queryEmbedding, centroid)
  })).filter((a) => a.affinity >= ROUTING_CONFIG.min_affinity).sort((a, b) => b.affinity - a.affinity);
  if (affinities.length === 0) {
    return {
      query,
      affinities: [],
      primary_cluster: null,
      search_strategy: "all_clusters",
      clusters_to_search: clustersWithCentroids.map((c) => c.cluster.id)
    };
  }
  const primaryAffinity = affinities[0];
  const primary_cluster = primaryAffinity.cluster_id;
  let search_strategy;
  let clusters_to_search;
  if (affinities.length === 1) {
    search_strategy = "primary_only";
    clusters_to_search = [primary_cluster];
  } else if (primaryAffinity.affinity - affinities[1].affinity <= ROUTING_CONFIG.search_all_gap) {
    search_strategy = "all_clusters";
    clusters_to_search = clustersWithCentroids.map((c) => c.cluster.id);
  } else if (affinities.length <= ROUTING_CONFIG.max_clusters) {
    search_strategy = "top_clusters";
    clusters_to_search = affinities.map((a) => a.cluster_id);
  } else {
    search_strategy = "top_clusters";
    clusters_to_search = affinities.slice(0, ROUTING_CONFIG.max_clusters).map((a) => a.cluster_id);
  }
  return {
    query,
    affinities,
    primary_cluster,
    search_strategy,
    clusters_to_search
  };
}
function routeToPrimaryCluster(queryEmbedding, clustersWithCentroids) {
  if (clustersWithCentroids.length === 0) {
    return null;
  }
  let maxAffinity = -1;
  let primaryCluster = null;
  for (const { cluster, centroid } of clustersWithCentroids) {
    const affinity = calculateAffinity(queryEmbedding, centroid);
    if (affinity > maxAffinity) {
      maxAffinity = affinity;
      primaryCluster = cluster.id;
    }
  }
  return primaryCluster;
}
var DETECTION_TIERS = [
  "STRUCTURAL",
  "NORMALIZED",
  "PATTERN",
  "CLASSIFIER",
  "LLM",
  "VERIFICATION"
];
var DetectionTierSchema = z.enum(DETECTION_TIERS);
function isDetectionTier(value) {
  return DETECTION_TIERS.includes(value);
}
var DETECTION_TIER_METADATA = {
  STRUCTURAL: { speed_ms: 1, cost: 0, accuracy: 0.95 },
  NORMALIZED: { speed_ms: 3, cost: 0, accuracy: 0.9 },
  PATTERN: { speed_ms: 10, cost: 0, accuracy: 0.75 },
  CLASSIFIER: { speed_ms: 20, cost: 1e-4, accuracy: 0.85 },
  LLM: { speed_ms: 500, cost: 2e-3, accuracy: 0.92 },
  VERIFICATION: { speed_ms: 1e3, cost: 4e-3, accuracy: 0.97 }
};
var TIER_THRESHOLDS = {
  /** Tier 1: Structural match confidence */
  structural_confidence: 0.95,
  /** Tier 1.5: Normalized match confidence */
  normalized_confidence: 0.9,
  /** Tier 2: Pattern high confidence - proceed to resolution */
  pattern_high_threshold: 0.7,
  /** Tier 2: Pattern continue threshold - proceed to Tier 2.5 */
  pattern_continue_threshold: 0.4,
  /** Tier 2.5: Classifier threshold to proceed */
  classifier_threshold: 0.7,
  /** Tier 3: LLM confidence for auto-supersession (requires Tier 4) */
  llm_auto_threshold: 0.8,
  /** Tier 4: Verification confidence for auto-supersession */
  verification_threshold: 0.7
};
var CONFLICT_TYPES = [
  "FACT_UPDATE",
  "CORRECTION",
  "BELIEF_CONTRADICTION",
  "BELIEF_EVOLUTION",
  "SOURCE_CONFLICT",
  "AMBIGUOUS"
];
var ConflictTypeSchema = z.enum(CONFLICT_TYPES);
function isConflictType(value) {
  return CONFLICT_TYPES.includes(value);
}
var RESOLUTION_STRATEGIES = [
  "supersede_old",
  "keep_both_linked",
  "keep_both_unlinked",
  "queue_for_user",
  "source_ranking"
];
var ResolutionStrategySchema = z.enum(RESOLUTION_STRATEGIES);
var CONFLICT_TYPE_RESOLUTION = {
  FACT_UPDATE: {
    auto_supersede: true,
    resolution: "supersede_old",
    description: "Same entity+attribute, different value. New replaces old."
  },
  CORRECTION: {
    auto_supersede: true,
    resolution: "supersede_old",
    description: "Explicit correction marker detected. New replaces old."
  },
  BELIEF_CONTRADICTION: {
    auto_supersede: true,
    resolution: "supersede_old",
    description: "Same topic, sentiment flip (+ to - or - to +). New replaces old."
  },
  BELIEF_EVOLUTION: {
    auto_supersede: false,
    resolution: "keep_both_linked",
    description: "Same topic, similar sentiment, scope expanded. Keep both with evolves_from edge."
  },
  SOURCE_CONFLICT: {
    auto_supersede: true,
    resolution: "source_ranking",
    description: "Same fact from different sources. Higher trust source wins."
  },
  AMBIGUOUS: {
    auto_supersede: false,
    resolution: "queue_for_user",
    description: "LLM confidence < 0.7. Queue for user resolution."
  }
};
var SUPERSEDED_STATES = [
  "SUPERSEDED_ACTIVE",
  "SUPERSEDED_FADING",
  "SUPERSEDED_DORMANT",
  "SUPERSEDED_ARCHIVED",
  "SUPERSEDED_DELETED"
];
var SupersededStateSchema = z.enum(SUPERSEDED_STATES);
function isSupersededState(value) {
  return SUPERSEDED_STATES.includes(value);
}
var SUPERSEDED_DECAY_MULTIPLIERS = {
  SUPERSEDED_ACTIVE: 3,
  SUPERSEDED_FADING: 4,
  SUPERSEDED_DORMANT: 5,
  SUPERSEDED_ARCHIVED: 5,
  SUPERSEDED_DELETED: 0
};
var SUPERSEDED_ACCESS_DECAY_MULTIPLIER = 2;
var SUPERSEDED_R_THRESHOLDS = {
  /** Above this: SUPERSEDED_ACTIVE */
  active_min: 0.3,
  /** Between fading_min and active_min: SUPERSEDED_FADING */
  fading_min: 0.1,
  /** Below fading_min: SUPERSEDED_DORMANT */
  dormant_max: 0.1
};
var SUPERSEDED_DORMANT_DAYS = 90;
var DELETION_CRITERIA2 = {
  /** 1. Must be archived for this many days */
  min_archived_days: 180,
  /** 2. Must have zero accesses since archival */
  required_access_count: 0,
  /** 3. No incoming edges with strength above this */
  max_edge_strength: 0.5};
var STORAGE_PRESSURE_THRESHOLD = 0.8;
var CONFLICT_QUEUE_CONFIG = {
  /** Maximum items in queue - oldest auto-resolves on overflow */
  max_items: 20,
  /** Days before auto-resolve to "keep both" */
  auto_resolve_days: 14,
  /** Auto-resolve strategy */
  auto_resolve_strategy: "keep_both",
  /** Weekly prompt day (0=Sunday, 1=Monday) */
  weekly_prompt_day: 1
};
var CONFLICT_STATUSES = ["pending", "resolved", "auto_resolved"];
var ConflictStatusSchema = z.enum(CONFLICT_STATUSES);
var USER_RESOLUTIONS = [
  "old_is_current",
  "new_is_current",
  "keep_both",
  "merge"
];
var UserResolutionSchema = z.enum(USER_RESOLUTIONS);
var USER_RESOLUTION_DESCRIPTIONS = {
  old_is_current: "Keep the old information as current. Discard the new.",
  new_is_current: "The new information supersedes the old.",
  keep_both: "Both are valid. Keep both without supersession.",
  merge: "Create a merged version combining both."
};
var ACCURACY_MODES = ["FAST", "BALANCED", "THOROUGH", "MANUAL"];
var AccuracyModeSchema = z.enum(ACCURACY_MODES);
function isAccuracyMode(value) {
  return ACCURACY_MODES.includes(value);
}
var ACCURACY_TARGETS = {
  STRUCTURAL: 0.95,
  NORMALIZED: 0.9,
  PATTERN: 0.75,
  CLASSIFIER: 0.85,
  LLM: 0.92,
  VERIFICATION: 0.97
};
var AUTO_SUPERSEDE_ACCURACY_TARGET = 0.97;
var CLASSIFIER_TRAINING = {
  /** Train initial model at this many examples */
  initial_train_examples: 500,
  /** Retrain with full dataset at this many examples */
  retrain_examples: 2e3,
  /** Minimum accuracy before alerting */
  accuracy_alert_threshold: 0.85,
  /** Auto-supersede accuracy below this triggers conservative mode */
  auto_mode_switch_threshold: 0.95
};
var ATTRIBUTE_SYNONYMS = {
  "contact.phone": ["phone", "cell", "mobile", "number", "telephone"],
  "contact.email": ["email", "mail", "e-mail"],
  "belief.stance": ["thinks", "believes", "opinion", "stance", "position", "view"],
  "location.residence": ["lives", "resides", "located", "staying", "address"],
  "meeting.date": ["meeting", "appointment", "scheduled"],
  "project.status": ["project", "deadline", "due"]
};
var PATTERN_TRIGGERS = [
  "actually",
  "I was wrong",
  "correction:",
  "update:",
  "no longer",
  "changed to",
  "now it's",
  "turns out",
  "not anymore",
  "used to be"
];
var PATTERN_DISQUALIFIERS = [
  "wasn't actually",
  "not really",
  "wrong to doubt",
  "wrong of me",
  "was I wrong?",
  "is it actually?",
  "good point",
  "actually, yes",
  "actually enjoyed",
  "actually quite",
  "actually like",
  "actually think"
];
var PATTERN_CONFIDENCE_WEIGHTS = {
  /** Base confidence when trigger found */
  base: 0.5,
  /** Add if entity reference within 10 words */
  entity_nearby: 0.15,
  /** Add if factual value present */
  has_value: 0.1,
  /** Add if temporal signal present */
  temporal_signal: 0.1,
  /** Subtract if any disqualifier found */
  disqualifier_penalty: -0.3
};
var ENTITY_NEARBY_DISTANCE = 10;
var HISTORY_MODE_PATTERNS = [
  "used to",
  "before",
  "previously",
  "originally",
  "changed",
  "updated",
  "evolved",
  "history of",
  "what did I think",
  "how has .* changed"
];
var HISTORY_MODE_SUPERSEDED_PENALTY = 0.5;
var SSA_SUPERSEDED_ACTIVATION_CAP = 0.3;
var SSA_SUPERSEDED_SPREAD_DECAY = 0.5;
var QUERY_MODES = ["current", "as_of", "history", "full_audit"];
var QueryModeSchema = z.enum(QUERY_MODES);
function isQueryMode(value) {
  return QUERY_MODES.includes(value);
}
var SENTIMENTS = ["positive", "negative", "neutral"];
var SentimentSchema = z.enum(SENTIMENTS);
var DetectionContextSchema = z.object({
  old_value: z.string(),
  new_value: z.string(),
  old_timestamp: z.string().datetime(),
  new_timestamp: z.string().datetime(),
  old_source_confidence: z.number().min(0).max(1),
  new_source_confidence: z.number().min(0).max(1),
  has_sentiment_flip: z.boolean(),
  has_scope_expansion: z.boolean(),
  entity_id: z.string().optional(),
  attribute_type: z.string().optional(),
  has_correction_pattern: z.boolean()
});
var TypeClassificationSchema = z.object({
  type: ConflictTypeSchema,
  confidence: z.number().min(0).max(1),
  auto_supersede: z.boolean(),
  resolution: ResolutionStrategySchema,
  reasoning: z.string()
});
var TierResultSchema = z.object({
  tier: DetectionTierSchema,
  detected: z.boolean(),
  confidence: z.number().min(0).max(1),
  conflict_type: ConflictTypeSchema.optional(),
  should_continue: z.boolean(),
  reasoning: z.string().optional(),
  time_ms: z.number().min(0),
  cost: z.number().min(0)
});
var StructuralDetectionSchema = z.object({
  entity_id: z.string().optional(),
  attribute_type: z.string().optional(),
  old_value: z.string().optional(),
  new_value: z.string().optional(),
  match_found: z.boolean(),
  values_differ: z.boolean()
});
var NormalizationResultSchema = z.object({
  original_attribute: z.string(),
  normalized_attribute: z.string(),
  synonyms_matched: z.array(z.string()),
  implicit_extraction: z.object({
    pattern: z.string(),
    extracted_attribute: z.string(),
    extracted_value: z.string()
  }).optional()
});
var PatternDetectionSchema = z.object({
  triggers_found: z.array(z.string()),
  entity_nearby: z.boolean(),
  has_value: z.boolean(),
  temporal_signal: z.boolean(),
  disqualifiers_found: z.array(z.string()),
  confidence_score: z.number().min(0).max(1)
});
var ClassifierResultSchema = z.object({
  is_correction: z.boolean(),
  confidence: z.number().min(0).max(1),
  model_used: z.enum(["few_shot", "fine_tuned"])
});
var LLMDetectionOutputSchema = z.object({
  relationship: z.enum(["contradicts", "updates", "evolves", "coexists", "unrelated"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  which_is_current: z.enum(["old", "new", "both", "unclear"]),
  both_could_be_true: z.boolean(),
  is_time_dependent: z.boolean(),
  needs_user_input: z.boolean()
});
var VerificationOutputSchema = z.object({
  should_supersede: z.boolean(),
  confidence: z.number().min(0).max(1),
  concerns: z.array(z.string()),
  recommendation: z.enum(["auto_supersede", "queue_for_user", "keep_both"])
});
var DetectionPipelineResultSchema = z.object({
  final_tier: DetectionTierSchema,
  conflict_detected: z.boolean(),
  conflict_type: ConflictTypeSchema.optional(),
  overall_confidence: z.number().min(0).max(1),
  auto_supersede: z.boolean(),
  needs_user_resolution: z.boolean(),
  tier_results: z.array(TierResultSchema),
  total_time_ms: z.number().min(0),
  total_cost: z.number().min(0)
});
var SupersededStateConfigSchema = z.object({
  state: SupersededStateSchema,
  r_threshold_min: z.number().min(0).max(1).optional(),
  r_threshold_max: z.number().min(0).max(1).optional(),
  decay_multiplier: z.number().min(0),
  retrieval_mode: z.enum(["normal_excluded", "history_only", "audit_only", "none"]),
  content_state: z.enum(["full", "summarized", "reference_only", "deleted"]),
  duration_days: z.number().int().positive().optional()
});
var SupersessionFieldsSchema = z.object({
  superseded_by: z.string().optional(),
  superseded_at: z.string().datetime().optional(),
  superseded_state: SupersededStateSchema.optional(),
  decay_rate_multiplier: z.number().min(0).optional(),
  access_count_since_superseded: z.number().int().min(0).optional(),
  dormant_since: z.string().datetime().optional(),
  archived_at: z.string().datetime().optional()
});
var DeletionCriteriaResultSchema = z.object({
  eligible: z.boolean(),
  criteria: z.object({
    archived_long_enough: z.boolean(),
    days_archived: z.number().int().min(0),
    no_accesses: z.boolean(),
    access_count: z.number().int().min(0),
    no_important_edges: z.boolean(),
    max_edge_strength: z.number().min(0).max(1),
    superseding_active: z.boolean(),
    superseding_node_state: z.string().optional(),
    raw_in_archive: z.boolean()
  })
});
var SupersededStateTransitionSchema = z.object({
  node_id: z.string(),
  from_state: SupersededStateSchema,
  to_state: SupersededStateSchema,
  triggered_by: z.enum(["decay", "time", "storage_pressure", "user_access"]),
  timestamp: z.string().datetime(),
  context: z.object({
    retrievability: z.number().min(0).max(1).optional(),
    days_in_previous_state: z.number().int().min(0).optional(),
    user_accessed: z.boolean().optional()
  }).optional()
});
var ConflictQueueItemSchema = z.object({
  id: z.string(),
  old_node_id: z.string(),
  new_content: z.string(),
  new_node_id: z.string().optional(),
  conflict_type: ConflictTypeSchema,
  detection_tier: DetectionTierSchema,
  detection_confidence: z.number().min(0).max(1),
  context: z.string(),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  status: ConflictStatusSchema,
  entity_name: z.string().optional(),
  topic: z.string().optional()
});
var ContradictionResolutionSchema = z.object({
  conflict_id: z.string(),
  resolved_by: z.enum(["user", "auto", "timeout"]),
  resolution: UserResolutionSchema,
  resolved_at: z.string().datetime(),
  user_merged_content: z.string().optional(),
  was_override: z.boolean().optional()
});
var ConflictQueueStatusSchema = z.object({
  pending_count: z.number().int().min(0),
  oldest_pending_date: z.string().datetime().optional(),
  next_auto_resolve_date: z.string().datetime().optional(),
  items_resolved_this_week: z.number().int().min(0),
  at_capacity: z.boolean()
});
var ConflictPresentationSchema = z.object({
  conflict_id: z.string(),
  entity_name: z.string().optional(),
  topic: z.string(),
  version_a: z.object({
    content: z.string(),
    date: z.string(),
    source: z.string().optional()
  }),
  version_b: z.object({
    content: z.string(),
    date: z.string(),
    source: z.string().optional()
  }),
  suggested_action: UserResolutionSchema.optional(),
  confidence_in_suggestion: z.number().min(0).max(1),
  days_until_auto_resolve: z.number().int().min(0)
});
var ConflictQueueConfigSchema = z.object({
  max_items: z.number().int().positive(),
  auto_resolve_days: z.number().int().positive(),
  auto_resolve_strategy: UserResolutionSchema,
  weekly_prompt_enabled: z.boolean(),
  weekly_prompt_day: z.number().int().min(0).max(6)
});
var AccuracyModeConfigSchema = z.object({
  mode: AccuracyModeSchema,
  description: z.string(),
  tiers_used: z.array(DetectionTierSchema),
  auto_supersede_tiers: z.array(DetectionTierSchema),
  user_involvement: z.enum(["high", "medium", "low", "very_high"]),
  typical_speed_ms: z.number().min(0),
  typical_cost: z.number().min(0),
  expected_accuracy: z.number().min(0).max(1)
});
var DetectionEventLogSchema = z.object({
  id: z.string(),
  detection_id: z.string(),
  tier_reached: DetectionTierSchema,
  tier_confidence: z.number().min(0).max(1),
  auto_resolved: z.boolean(),
  resolution: z.enum(["supersede", "keep_both", "unrelated"]),
  user_override: z.enum(["agreed", "disagreed"]).optional(),
  user_resolution: UserResolutionSchema.optional(),
  timestamp: z.string().datetime(),
  accuracy_mode: AccuracyModeSchema,
  old_content: z.string().optional(),
  new_content: z.string().optional()
});
var AccuracyMetricsSchema = z.object({
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  per_tier_accuracy: z.record(z.number().nullable()),
  false_positive_rate: z.number().min(0).max(1),
  false_negative_rate: z.number().min(0).max(1),
  auto_supersede_accuracy: z.number().min(0).max(1),
  total_detections: z.number().int().min(0),
  user_resolutions: z.number().int().min(0),
  by_mode: z.record(
    z.object({
      detections: z.number().int().min(0),
      accuracy: z.number().nullable()
    })
  )
});
var SelfImprovementConfigSchema = z.object({
  classifier_initial_train_examples: z.number().int().positive(),
  classifier_retrain_examples: z.number().int().positive(),
  accuracy_alert_threshold: z.number().min(0).max(1),
  auto_mode_switch_threshold: z.number().min(0).max(1)
});
var QCSHistoryModeConfigSchema = z.object({
  history_patterns: z.array(z.string()),
  superseded_penalty: z.number().min(0).max(1)
});
var HistoryModeDetectionSchema = z.object({
  is_history_mode: z.boolean(),
  matched_patterns: z.array(z.string()),
  suggested_mode: QueryModeSchema
});
var RCSSupersessionFlagSchema = z.object({
  flag: z.literal("has_superseded_history"),
  trigger: z.literal("top_result_has_superseded_by_chain"),
  explanation_text: z.string()
});
var SSASupersededConfigSchema = z.object({
  activation_cap: z.number().min(0).max(1),
  spread_decay: z.number().min(0).max(1),
  spread_to_superseding: z.boolean()
});
var Phase2ContextInjectionSchema = z.object({
  superseded_context_template: z.string(),
  follow_supersedes_for: z.array(z.string())
});
var QueryModeConfigSchema = z.object({
  mode: QueryModeSchema,
  include_superseded: z.boolean(),
  superseded_penalty: z.number().min(0).max(1),
  description: z.string()
});
var RetrievalIntegrationConfigSchema = z.object({
  qcs: QCSHistoryModeConfigSchema,
  rcs: RCSSupersessionFlagSchema,
  ssa: SSASupersededConfigSchema,
  phase2: Phase2ContextInjectionSchema
});
var Tier3InputSchema = z.object({
  entity_name: z.string(),
  entity_type: z.string(),
  attribute: z.string(),
  old_value: z.string(),
  old_date: z.string(),
  old_source: z.string(),
  new_statement: z.string(),
  context: z.string(),
  new_date: z.string(),
  new_source: z.string()
});
var Tier4InputSchema = z.object({
  old_value: z.string(),
  entity: z.string(),
  old_date: z.string(),
  new_statement: z.string(),
  new_date: z.string(),
  tier3_result: LLMDetectionOutputSchema
});

// src/contradiction/index.ts
var CLASSIFIER_FEW_SHOT_PROMPT = `Classify if this text is correcting previous information.

Examples of CORRECTIONS:
- "Actually, Sarah's phone is 555-5678" \u2192 CORRECTION
- "I was wrong about the meeting date, it's Thursday" \u2192 CORRECTION
- "Update: The deadline moved to next week" \u2192 CORRECTION

Examples of NOT corrections:
- "Actually, that's a great idea" \u2192 NOT (agreement)
- "I was wrong to doubt you" \u2192 NOT (apology)
- "I actually enjoyed the movie" \u2192 NOT (emphasis)
- "Was I wrong about this?" \u2192 NOT (question)

Text to classify: "{input_text}"
Context: "{surrounding_sentences}"

Is this a CORRECTION or NOT? Answer with confidence (0-1).`;
var LLM_DETECTION_PROMPT = `You are analyzing whether new information contradicts existing information in a personal knowledge base.

EXISTING INFORMATION:
- Entity: {entity_name}
- Type: {entity_type}
- Attribute: {attribute}
- Current value: "{old_value}"
- Recorded on: {old_date}
- Source: {old_source}

NEW INFORMATION:
- Statement: "{new_statement}"
- Context (surrounding text): "{context}"
- Date: {new_date}
- Source: {new_source}

IMPORTANT: Consider these possibilities:
1. TRUE CONTRADICTION: The facts cannot both be true
2. UPDATE: The fact changed over time (both were true at time)
3. EVOLUTION: The belief/opinion developed (not contradiction)
4. DIFFERENT CONTEXT: Both could be true in different contexts
5. UNRELATED: The new info is about something else entirely

Respond with ONLY this JSON (no other text):
{
  "relationship": "contradicts|updates|evolves|coexists|unrelated",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation in 1-2 sentences>",
  "which_is_current": "old|new|both|unclear",
  "both_could_be_true": <true|false>,
  "is_time_dependent": <true|false>,
  "needs_user_input": <true|false>
}`;
var VERIFICATION_PROMPT = `A detection system believes these two pieces of information CONTRADICT each other:

EXISTING: "{old_value}" (about {entity}, recorded {old_date})
NEW: "{new_statement}" (from {new_date})

The system wants to AUTOMATICALLY mark the old information as superseded by the new information.

YOUR JOB: Find reasons this might be WRONG. Consider:
- Could they be about different things? (different Sarah?)
- Could both be true? (different contexts, times, aspects?)
- Is the "new" information actually a correction?
- Could this be a misunderstanding or ambiguity?

Respond with ONLY this JSON:
{
  "should_supersede": <true|false>,
  "confidence": <0.0-1.0>,
  "concerns": ["<concern1>", "<concern2>"] or [],
  "recommendation": "auto_supersede|queue_for_user|keep_both"
}`;
var SUPERSEDED_STATE_CONFIGS = {
  SUPERSEDED_ACTIVE: {
    state: "SUPERSEDED_ACTIVE",
    r_threshold_min: SUPERSEDED_R_THRESHOLDS.active_min,
    r_threshold_max: 1,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_ACTIVE,
    retrieval_mode: "normal_excluded",
    content_state: "full",
    duration_days: void 0
  },
  SUPERSEDED_FADING: {
    state: "SUPERSEDED_FADING",
    r_threshold_min: SUPERSEDED_R_THRESHOLDS.fading_min,
    r_threshold_max: SUPERSEDED_R_THRESHOLDS.active_min,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_FADING,
    retrieval_mode: "history_only",
    content_state: "full",
    duration_days: void 0
  },
  SUPERSEDED_DORMANT: {
    state: "SUPERSEDED_DORMANT",
    r_threshold_min: 0,
    r_threshold_max: SUPERSEDED_R_THRESHOLDS.dormant_max,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_DORMANT,
    retrieval_mode: "audit_only",
    content_state: "summarized",
    duration_days: SUPERSEDED_DORMANT_DAYS
  },
  SUPERSEDED_ARCHIVED: {
    state: "SUPERSEDED_ARCHIVED",
    r_threshold_min: void 0,
    r_threshold_max: void 0,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_ARCHIVED,
    retrieval_mode: "audit_only",
    content_state: "reference_only",
    duration_days: void 0
  },
  SUPERSEDED_DELETED: {
    state: "SUPERSEDED_DELETED",
    r_threshold_min: void 0,
    r_threshold_max: void 0,
    decay_multiplier: 0,
    retrieval_mode: "none",
    content_state: "deleted",
    duration_days: void 0
  }
};
var ACCURACY_MODE_CONFIGS = {
  FAST: {
    mode: "FAST",
    description: "I want quick responses, I'll fix mistakes manually",
    tiers_used: ["STRUCTURAL", "NORMALIZED", "PATTERN"],
    auto_supersede_tiers: ["STRUCTURAL"],
    user_involvement: "high",
    typical_speed_ms: 15,
    typical_cost: 0,
    expected_accuracy: 0.75
  },
  BALANCED: {
    mode: "BALANCED",
    description: "Good accuracy without too much cost/delay",
    tiers_used: ["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM"],
    auto_supersede_tiers: ["STRUCTURAL", "NORMALIZED", "PATTERN"],
    user_involvement: "medium",
    typical_speed_ms: 50,
    typical_cost: 3e-3,
    expected_accuracy: 0.9
  },
  THOROUGH: {
    mode: "THOROUGH",
    description: "I want maximum accuracy, cost/speed doesn't matter",
    tiers_used: ["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM", "VERIFICATION"],
    auto_supersede_tiers: ["STRUCTURAL", "NORMALIZED", "PATTERN", "LLM"],
    user_involvement: "low",
    typical_speed_ms: 1500,
    typical_cost: 6e-3,
    expected_accuracy: 0.97
  },
  MANUAL: {
    mode: "MANUAL",
    description: "I want to approve every change",
    tiers_used: ["STRUCTURAL", "NORMALIZED", "PATTERN"],
    auto_supersede_tiers: [],
    user_involvement: "very_high",
    typical_speed_ms: 15,
    typical_cost: 0,
    expected_accuracy: 1
  }
};
var QUERY_MODE_CONFIGS = {
  current: {
    mode: "current",
    include_superseded: false,
    superseded_penalty: 1,
    description: "Only active nodes (default)"
  },
  as_of: {
    mode: "as_of",
    include_superseded: true,
    superseded_penalty: 0,
    description: "What we knew at that date"
  },
  history: {
    mode: "history",
    include_superseded: true,
    superseded_penalty: HISTORY_MODE_SUPERSEDED_PENALTY,
    description: "Include superseded nodes with penalty"
  },
  full_audit: {
    mode: "full_audit",
    include_superseded: true,
    superseded_penalty: 0,
    description: "Everything including archived"
  }
};
var DEFAULT_QUEUE_CONFIG = {
  max_items: CONFLICT_QUEUE_CONFIG.max_items,
  auto_resolve_days: CONFLICT_QUEUE_CONFIG.auto_resolve_days,
  auto_resolve_strategy: CONFLICT_QUEUE_CONFIG.auto_resolve_strategy,
  weekly_prompt_enabled: true,
  weekly_prompt_day: CONFLICT_QUEUE_CONFIG.weekly_prompt_day
};
var DEFAULT_SELF_IMPROVEMENT_CONFIG = {
  classifier_initial_train_examples: CLASSIFIER_TRAINING.initial_train_examples,
  classifier_retrain_examples: CLASSIFIER_TRAINING.retrain_examples,
  accuracy_alert_threshold: CLASSIFIER_TRAINING.accuracy_alert_threshold,
  auto_mode_switch_threshold: CLASSIFIER_TRAINING.auto_mode_switch_threshold
};
var QCS_HISTORY_MODE_CONFIG = {
  history_patterns: HISTORY_MODE_PATTERNS,
  superseded_penalty: HISTORY_MODE_SUPERSEDED_PENALTY
};
var RCS_SUPERSESSION_FLAG = {
  flag: "has_superseded_history",
  trigger: "top_result_has_superseded_by_chain",
  explanation_text: "Note: This topic has historical versions"
};
var SSA_SUPERSEDED_CONFIG = {
  activation_cap: SSA_SUPERSEDED_ACTIVATION_CAP,
  spread_decay: SSA_SUPERSEDED_SPREAD_DECAY,
  spread_to_superseding: true
};
var PHASE2_CONTEXT_INJECTION = {
  superseded_context_template: 'Note: "{old_content}" was later updated to "{new_content}"',
  follow_supersedes_for: ["change", "evolution", "history", "before", "used to"]
};
var DEFAULT_RETRIEVAL_INTEGRATION_CONFIG = {
  qcs: QCS_HISTORY_MODE_CONFIG,
  rcs: RCS_SUPERSESSION_FLAG,
  ssa: SSA_SUPERSEDED_CONFIG,
  phase2: PHASE2_CONTEXT_INJECTION
};
var TYPE_DETECTION_CRITERIA = [
  {
    type: "FACT_UPDATE",
    priority: 1,
    matches: (ctx) => ctx.entity_id !== void 0 && ctx.attribute_type !== void 0 && ctx.old_value !== ctx.new_value && !ctx.has_correction_pattern,
    confidence: 0.95,
    auto_supersede: true,
    resolution: "supersede_old"
  },
  {
    type: "CORRECTION",
    priority: 2,
    matches: (ctx) => ctx.has_correction_pattern,
    confidence: 0.9,
    auto_supersede: true,
    resolution: "supersede_old"
  },
  {
    type: "BELIEF_CONTRADICTION",
    priority: 3,
    matches: (ctx) => ctx.has_sentiment_flip && !ctx.has_scope_expansion,
    confidence: 0.85,
    auto_supersede: true,
    resolution: "supersede_old"
  },
  {
    type: "BELIEF_EVOLUTION",
    priority: 4,
    matches: (ctx) => !ctx.has_sentiment_flip && ctx.has_scope_expansion,
    confidence: 0.8,
    auto_supersede: false,
    resolution: "keep_both_linked"
  },
  {
    type: "SOURCE_CONFLICT",
    priority: 5,
    matches: (ctx) => ctx.old_source_confidence !== ctx.new_source_confidence && Math.abs(ctx.old_source_confidence - ctx.new_source_confidence) > 0.2,
    confidence: 0.75,
    auto_supersede: true,
    resolution: "source_ranking"
  },
  {
    type: "AMBIGUOUS",
    priority: 6,
    matches: () => true,
    confidence: 0.5,
    auto_supersede: false,
    resolution: "queue_for_user"
  }
];
function daysSince(isoTimestamp) {
  const then = new Date(isoTimestamp).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1e3 * 60 * 60 * 24));
}
function generateConflictId() {
  return `conflict_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
function generateEventId() {
  return `event_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
function formatDate(isoTimestamp) {
  const date = new Date(isoTimestamp);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function classifyConflictType(_old_node, _new_content, context) {
  for (const criteria of TYPE_DETECTION_CRITERIA) {
    if (criteria.matches(context)) {
      return {
        type: criteria.type,
        confidence: criteria.confidence,
        auto_supersede: criteria.auto_supersede,
        resolution: criteria.resolution,
        reasoning: CONFLICT_TYPE_RESOLUTION[criteria.type].description
      };
    }
  }
  return {
    type: "AMBIGUOUS",
    confidence: 0.5,
    auto_supersede: false,
    resolution: "queue_for_user",
    reasoning: "Could not determine conflict type."
  };
}
function isAutoSupersede(type) {
  return CONFLICT_TYPE_RESOLUTION[type].auto_supersede;
}
function getResolutionStrategy(type) {
  return CONFLICT_TYPE_RESOLUTION[type].resolution;
}
function resolveSourceConflict(old_confidence, new_confidence) {
  return new_confidence >= old_confidence ? "new" : "old";
}
function hasSentimentFlip(old_sentiment, new_sentiment) {
  if (old_sentiment === "neutral" || new_sentiment === "neutral") {
    return false;
  }
  return old_sentiment !== new_sentiment;
}
function runTier2Pattern(content) {
  const lowerContent = content.toLowerCase();
  const triggers_found = [];
  const disqualifiers_found = [];
  for (const trigger of PATTERN_TRIGGERS) {
    if (lowerContent.includes(trigger.toLowerCase())) {
      triggers_found.push(trigger);
    }
  }
  for (const disqualifier of PATTERN_DISQUALIFIERS) {
    if (lowerContent.includes(disqualifier.toLowerCase())) {
      disqualifiers_found.push(disqualifier);
    }
  }
  const confidence_score = calculatePatternConfidence({
    entity_nearby: false,
    // Would need entity detection
    has_value: triggers_found.length > 0,
    temporal_signal: lowerContent.includes("now") || lowerContent.includes("used to"),
    disqualifiers_found});
  return {
    triggers_found,
    entity_nearby: false,
    has_value: triggers_found.length > 0,
    temporal_signal: lowerContent.includes("now") || lowerContent.includes("used to"),
    disqualifiers_found,
    confidence_score
  };
}
function calculatePatternConfidence(detection) {
  let confidence = PATTERN_CONFIDENCE_WEIGHTS.base;
  if (detection.entity_nearby) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.entity_nearby;
  }
  if (detection.has_value) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.has_value;
  }
  if (detection.temporal_signal) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.temporal_signal;
  }
  if (detection.disqualifiers_found.length > 0) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.disqualifier_penalty;
  }
  return Math.max(0, Math.min(1, confidence));
}
function runTier1_5Normalization(attribute, _content) {
  const lowerAttribute = attribute.toLowerCase();
  let normalized_attribute = attribute;
  const synonyms_matched = [];
  for (const [normalized, synonyms] of Object.entries(ATTRIBUTE_SYNONYMS)) {
    for (const synonym of synonyms) {
      if (lowerAttribute.includes(synonym.toLowerCase())) {
        normalized_attribute = normalized;
        synonyms_matched.push(synonym);
        break;
      }
    }
    if (synonyms_matched.length > 0) break;
  }
  return {
    original_attribute: attribute,
    normalized_attribute,
    synonyms_matched
  };
}
function shouldContinueToNextTier(result, mode) {
  if (mode === "FAST" && result.tier === "PATTERN") {
    return false;
  }
  if (mode === "MANUAL" && result.tier === "PATTERN") {
    return false;
  }
  if (result.detected && result.confidence >= TIER_THRESHOLDS.structural_confidence) {
    return false;
  }
  return result.should_continue;
}
function canAutoSupersede(tier3_result, tier4_result, mode) {
  if (mode === "MANUAL") {
    return false;
  }
  if (mode === "FAST") {
    return false;
  }
  if (!tier3_result || !tier4_result) {
    return false;
  }
  const pass1_ok = tier3_result.confidence >= TIER_THRESHOLDS.llm_auto_threshold;
  const pass2_ok = tier4_result.should_supersede && tier4_result.confidence >= TIER_THRESHOLDS.verification_threshold && tier4_result.concerns.length === 0;
  return pass1_ok && pass2_ok;
}
function determineSupersededState(node) {
  if (node.superseded_state === "SUPERSEDED_DELETED") {
    return "SUPERSEDED_DELETED";
  }
  if (node.superseded_state === "SUPERSEDED_ARCHIVED") {
    return "SUPERSEDED_ARCHIVED";
  }
  const R = node.neural.retrievability;
  if (R > SUPERSEDED_R_THRESHOLDS.active_min) {
    return "SUPERSEDED_ACTIVE";
  } else if (R > SUPERSEDED_R_THRESHOLDS.fading_min) {
    return "SUPERSEDED_FADING";
  } else {
    if (node.dormant_since) {
      const dormantDays = daysSince(node.dormant_since);
      if (dormantDays >= SUPERSEDED_DORMANT_DAYS) {
        return "SUPERSEDED_ARCHIVED";
      }
    }
    return "SUPERSEDED_DORMANT";
  }
}
function getDecayMultiplier(state) {
  return SUPERSEDED_DECAY_MULTIPLIERS[state];
}
function getEffectiveDecayMultiplier(state, userAccessed) {
  if (userAccessed) {
    return SUPERSEDED_ACCESS_DECAY_MULTIPLIER;
  }
  return SUPERSEDED_DECAY_MULTIPLIERS[state];
}
function checkStateTransition(node) {
  const currentState = node.superseded_state;
  if (!currentState || currentState === "SUPERSEDED_DELETED") {
    return null;
  }
  const newState = determineSupersededState(node);
  if (newState !== currentState) {
    let trigger = "decay";
    if (newState === "SUPERSEDED_ARCHIVED" && currentState === "SUPERSEDED_DORMANT") {
      trigger = "time";
    }
    return {
      node_id: node.id,
      from_state: currentState,
      to_state: newState,
      triggered_by: trigger,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      context: { retrievability: node.neural.retrievability }
    };
  }
  return null;
}
function checkDeletionCriteria(node, supersedingNode, maxIncomingEdgeStrength, rawInArchive) {
  const daysArchived = node.archived_at ? daysSince(node.archived_at) : 0;
  const accessCount = node.access_count_since_superseded ?? 0;
  const supersedingActive = supersedingNode !== null && supersedingNode.state.lifecycle === "active";
  const criteria = {
    archived_long_enough: daysArchived >= DELETION_CRITERIA2.min_archived_days,
    days_archived: daysArchived,
    no_accesses: accessCount === DELETION_CRITERIA2.required_access_count,
    access_count: accessCount,
    no_important_edges: maxIncomingEdgeStrength <= DELETION_CRITERIA2.max_edge_strength,
    max_edge_strength: maxIncomingEdgeStrength,
    superseding_active: supersedingActive,
    superseding_node_state: supersedingNode?.state.lifecycle,
    raw_in_archive: rawInArchive
  };
  const eligible = criteria.archived_long_enough && criteria.no_accesses && criteria.no_important_edges && criteria.superseding_active && criteria.raw_in_archive;
  return { eligible, criteria };
}
function isStoragePressure(currentCapacity) {
  return currentCapacity >= STORAGE_PRESSURE_THRESHOLD;
}
function getRetrievalMode(state) {
  return SUPERSEDED_STATE_CONFIGS[state].retrieval_mode;
}
function getContentState(state) {
  return SUPERSEDED_STATE_CONFIGS[state].content_state;
}
function createConflictQueueItem(data) {
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + CONFLICT_QUEUE_CONFIG.auto_resolve_days);
  return {
    ...data,
    id: generateConflictId(),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    status: "pending"
  };
}
function addToConflictQueue(queue, item) {
  const auto_resolved = [];
  let pendingItems = queue.filter((q) => q.status === "pending");
  while (pendingItems.length >= CONFLICT_QUEUE_CONFIG.max_items) {
    const oldest = pendingItems.reduce(
      (a, b) => new Date(a.created_at) < new Date(b.created_at) ? a : b
    );
    oldest.status = "auto_resolved";
    auto_resolved.push({
      conflict_id: oldest.id,
      resolved_by: "auto",
      resolution: CONFLICT_QUEUE_CONFIG.auto_resolve_strategy,
      resolved_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    pendingItems = queue.filter((q) => q.status === "pending");
  }
  queue.push(item);
  return { queue, auto_resolved };
}
function getPendingConflicts(queue) {
  return queue.filter((item) => item.status === "pending").sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}
function resolveConflict(queue, conflict_id, resolution, merged_content) {
  const item = queue.find((q) => q.id === conflict_id);
  if (!item) {
    throw new Error(`Conflict not found: ${conflict_id}`);
  }
  if (item.status !== "pending") {
    throw new Error(`Conflict already resolved: ${conflict_id}`);
  }
  item.status = "resolved";
  return {
    conflict_id,
    resolved_by: "user",
    resolution,
    resolved_at: (/* @__PURE__ */ new Date()).toISOString(),
    user_merged_content: merged_content
  };
}
function processExpiredConflicts(queue) {
  const now = /* @__PURE__ */ new Date();
  const resolutions = [];
  for (const item of queue) {
    if (item.status === "pending" && new Date(item.expires_at) <= now) {
      item.status = "auto_resolved";
      resolutions.push({
        conflict_id: item.id,
        resolved_by: "timeout",
        resolution: CONFLICT_QUEUE_CONFIG.auto_resolve_strategy,
        resolved_at: now.toISOString()
      });
    }
  }
  return resolutions;
}
function getQueueStatus(queue) {
  const pending = getPendingConflicts(queue);
  const now = /* @__PURE__ */ new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const resolvedThisWeek = queue.filter(
    (item) => item.status !== "pending" && new Date(item.created_at) >= weekStart
  ).length;
  return {
    pending_count: pending.length,
    oldest_pending_date: pending[0]?.created_at,
    next_auto_resolve_date: pending[0]?.expires_at,
    items_resolved_this_week: resolvedThisWeek,
    at_capacity: pending.length >= CONFLICT_QUEUE_CONFIG.max_items
  };
}
function formatForPresentation(item, old_node_content, old_node_date) {
  const now = /* @__PURE__ */ new Date();
  const expires = new Date(item.expires_at);
  const daysRemaining = Math.max(
    0,
    Math.ceil((expires.getTime() - now.getTime()) / (1e3 * 60 * 60 * 24))
  );
  let suggested_action;
  if (item.detection_confidence >= 0.7) {
    suggested_action = "new_is_current";
  } else if (item.detection_confidence < 0.4) {
    suggested_action = "keep_both";
  }
  return {
    conflict_id: item.id,
    entity_name: item.entity_name,
    topic: item.topic ?? "Unknown topic",
    version_a: { content: old_node_content, date: old_node_date },
    version_b: { content: item.new_content, date: item.created_at },
    suggested_action,
    confidence_in_suggestion: item.detection_confidence,
    days_until_auto_resolve: daysRemaining
  };
}
function shouldShowWeeklyPrompt(queue, config = DEFAULT_QUEUE_CONFIG) {
  if (!config.weekly_prompt_enabled) {
    return false;
  }
  const pending = getPendingConflicts(queue);
  if (pending.length === 0) {
    return false;
  }
  const today = (/* @__PURE__ */ new Date()).getDay();
  return today === config.weekly_prompt_day;
}
function getAccuracyModeConfig(mode) {
  return ACCURACY_MODE_CONFIGS[mode];
}
function shouldUseTier(tier, mode) {
  return ACCURACY_MODE_CONFIGS[mode].tiers_used.includes(tier);
}
function canAutoSupersedeTier(tier, mode) {
  return ACCURACY_MODE_CONFIGS[mode].auto_supersede_tiers.includes(tier);
}
function logDetectionEvent(event) {
  return {
    ...event,
    id: generateEventId(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function computeWeeklyMetrics(events, periodStart, periodEnd) {
  const periodEvents = events.filter(
    (e) => e.timestamp >= periodStart && e.timestamp <= periodEnd
  );
  const perTierAccuracy = {
    STRUCTURAL: null,
    NORMALIZED: null,
    PATTERN: null,
    CLASSIFIER: null,
    LLM: null,
    VERIFICATION: null
  };
  for (const tier of Object.keys(perTierAccuracy)) {
    const tierEvents = periodEvents.filter(
      (e) => e.tier_reached === tier && e.user_override !== void 0
    );
    if (tierEvents.length > 0) {
      const agreed = tierEvents.filter((e) => e.user_override === "agreed").length;
      perTierAccuracy[tier] = agreed / tierEvents.length;
    }
  }
  const detectedConflicts = periodEvents.filter((e) => e.resolution !== "unrelated");
  const falsePositives = detectedConflicts.filter(
    (e) => e.user_override === "disagreed" && (e.user_resolution === "keep_both" || e.resolution === "unrelated")
  ).length;
  const fpRate = detectedConflicts.length > 0 ? falsePositives / detectedConflicts.length : 0;
  const autoSuperseded = periodEvents.filter((e) => e.auto_resolved);
  const autoAgreed = autoSuperseded.filter(
    (e) => e.user_override === void 0 || e.user_override === "agreed"
  ).length;
  const autoAccuracy = autoSuperseded.length > 0 ? autoAgreed / autoSuperseded.length : 1;
  const byMode = {
    FAST: { detections: 0, accuracy: null },
    BALANCED: { detections: 0, accuracy: null },
    THOROUGH: { detections: 0, accuracy: null },
    MANUAL: { detections: 0, accuracy: null }
  };
  for (const mode of Object.keys(byMode)) {
    const modeEvents = periodEvents.filter((e) => e.accuracy_mode === mode);
    byMode[mode].detections = modeEvents.length;
    const withFeedback = modeEvents.filter((e) => e.user_override !== void 0);
    if (withFeedback.length > 0) {
      const agreed = withFeedback.filter((e) => e.user_override === "agreed").length;
      byMode[mode].accuracy = agreed / withFeedback.length;
    }
  }
  return {
    period_start: periodStart,
    period_end: periodEnd,
    per_tier_accuracy: perTierAccuracy,
    false_positive_rate: fpRate,
    false_negative_rate: 0,
    auto_supersede_accuracy: autoAccuracy,
    total_detections: periodEvents.length,
    user_resolutions: periodEvents.filter((e) => e.user_override !== void 0).length,
    by_mode: byMode
  };
}
function checkAccuracyAlerts(metrics, config = DEFAULT_SELF_IMPROVEMENT_CONFIG) {
  const alerts = [];
  for (const [tier, accuracy] of Object.entries(metrics.per_tier_accuracy)) {
    if (accuracy !== null && accuracy < config.accuracy_alert_threshold) {
      alerts.push(
        `Tier ${tier} accuracy (${(accuracy * 100).toFixed(1)}%) below threshold (${config.accuracy_alert_threshold * 100}%)`
      );
    }
  }
  if (metrics.auto_supersede_accuracy < config.auto_mode_switch_threshold) {
    alerts.push(
      `Auto-supersede accuracy (${(metrics.auto_supersede_accuracy * 100).toFixed(1)}%) below threshold - consider more conservative mode`
    );
  }
  if (metrics.false_positive_rate > 0.15) {
    alerts.push(`High false positive rate (${(metrics.false_positive_rate * 100).toFixed(1)}%)`);
  }
  return alerts;
}
function shouldTrainClassifier(trainingExamples, hasExistingModel, config = DEFAULT_SELF_IMPROVEMENT_CONFIG) {
  const train = !hasExistingModel && trainingExamples >= config.classifier_initial_train_examples;
  const retrain = hasExistingModel && trainingExamples >= config.classifier_retrain_examples;
  return { train, retrain };
}
function getTrainingData(events) {
  return events.filter(
    (e) => e.user_override !== void 0 && e.old_content !== void 0 && e.new_content !== void 0
  );
}
function getAccuracyTarget(tier) {
  return ACCURACY_TARGETS[tier];
}
function detectHistoryMode(query) {
  const lowerQuery = query.toLowerCase();
  const matched = [];
  for (const pattern of HISTORY_MODE_PATTERNS) {
    if (pattern.includes(".*")) {
      const regex = new RegExp(pattern.replace(".*", ".*"), "i");
      if (regex.test(lowerQuery)) {
        matched.push(pattern);
      }
    } else if (lowerQuery.includes(pattern.toLowerCase())) {
      matched.push(pattern);
    }
  }
  const isHistoryMode = matched.length > 0;
  return {
    is_history_mode: isHistoryMode,
    matched_patterns: matched,
    suggested_mode: isHistoryMode ? "history" : "current"
  };
}
function applySupersededCap(activation, node) {
  const isSuperseded = node.state.lifecycle === "superseded" || node.superseded_by !== void 0;
  if (!isSuperseded) {
    return activation;
  }
  return Math.min(activation, SSA_SUPERSEDED_ACTIVATION_CAP);
}
function calculateSupersededSpread(activation, isSuperseded) {
  if (!isSuperseded) {
    return activation;
  }
  return activation * SSA_SUPERSEDED_SPREAD_DECAY;
}
function injectSupersessionContext(node, supersedingContent) {
  const oldContent = node.content.body ?? node.content.title;
  return PHASE2_CONTEXT_INJECTION.superseded_context_template.replace("{old_content}", oldContent).replace("{new_content}", supersedingContent);
}
function shouldFollowSupersedesEdges(query) {
  const lowerQuery = query.toLowerCase();
  for (const pattern of PHASE2_CONTEXT_INJECTION.follow_supersedes_for) {
    if (lowerQuery.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}
function buildHistoryTimeline(chain) {
  if (chain.length === 0) {
    return "No history available.";
  }
  const lines = ["Timeline:"];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    if (!node) continue;
    const date = formatDate(node.temporal.ingestion.timestamp);
    const content = node.content.body ?? node.content.title;
    const isCurrent = i === chain.length - 1;
    lines.push(`- ${date}: ${content}${isCurrent ? " (current)" : ""}`);
  }
  return lines.join("\n");
}
function getQueryModeConfig(mode) {
  return QUERY_MODE_CONFIGS[mode];
}
function shouldIncludeSuperseded(mode) {
  return QUERY_MODE_CONFIGS[mode].include_superseded;
}
function getSupersededPenalty(mode) {
  return QUERY_MODE_CONFIGS[mode].superseded_penalty;
}
function shouldFlagSupersessionHistory(topResults) {
  for (const node of topResults) {
    if (node.superseded_by !== void 0) {
      return true;
    }
  }
  return false;
}
var PROVIDERS = ["anthropic", "openai", "google"];
var ProviderSchema = z.enum(PROVIDERS);
function isProvider(value) {
  return PROVIDERS.includes(value);
}
var ANTHROPIC_MODELS = ["claude-sonnet-4", "claude-3-haiku"];
var AnthropicModelSchema = z.enum(ANTHROPIC_MODELS);
var OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini"];
var OpenAIModelSchema = z.enum(OPENAI_MODELS);
var GOOGLE_MODELS = ["gemini-2.0-flash", "gemini-2.0-flash-lite"];
var GoogleModelSchema = z.enum(GOOGLE_MODELS);
var LLM_EMBEDDING_MODELS = ["text-embedding-3-small", "text-embedding-3-large"];
var EmbeddingModelSchema = z.enum(LLM_EMBEDDING_MODELS);
var LLM_MODELS = [
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
  ...GOOGLE_MODELS
];
var LLMModelSchema = z.enum(LLM_MODELS);
function isLLMModel(value) {
  return LLM_MODELS.includes(value);
}
var MODEL_TIERS = ["cheapest", "cheap", "balanced", "premium"];
var ModelTierSchema = z.enum(MODEL_TIERS);
function isModelTier(value) {
  return MODEL_TIERS.includes(value);
}
var OPERATION_TYPES = [
  "classification",
  "quick_response",
  "standard_response",
  "deep_thinking",
  "graph_cot",
  "extraction_simple",
  "extraction_complex",
  "embedding",
  "batch_extraction"
];
var OperationTypeSchema = z.enum(OPERATION_TYPES);
function isOperationType(value) {
  return OPERATION_TYPES.includes(value);
}
var DEGRADATION_LEVELS = ["healthy", "degraded", "offline"];
var DegradationLevelSchema = z.enum(DEGRADATION_LEVELS);
function isDegradationLevel(value) {
  return DEGRADATION_LEVELS.includes(value);
}
var URGENCY_LEVELS = ["realtime", "normal", "background"];
var UrgencyLevelSchema = z.enum(URGENCY_LEVELS);
function isUrgencyLevel(value) {
  return URGENCY_LEVELS.includes(value);
}
var RATE_LIMIT_WARNING_THRESHOLD = 0.8;
var PROVIDER_RATE_LIMITS = {
  anthropic: { rpm: 4e3, tpm: 4e5 },
  openai: { rpm: 1e4, tpm: 2e6 },
  google: { rpm: 6e4, tpm: 4e6 }
};
var DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
var LLM_EMBEDDING_DIMENSIONS = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072
};
var EMBEDDING_CACHE_TTL_DAYS = 7;
var EMBEDDING_CACHE_MAX_SIZE = "1GB";
var BATCH_DISCOUNT_PERCENT = 50;
var BATCH_DEADLINE_HOURS = 24;
var BATCH_ELIGIBLE_OPERATIONS = [
  "extraction_simple",
  "extraction_complex",
  "embedding",
  "batch_extraction"
];
var FREE_DAILY_BUDGET = 0.05;
var COST_RESERVATION_BUFFER = 1.5;
var CREDIT_RESERVATION_EXPIRY_MINUTES = 30;
var CACHEABLE_PROMPT_TYPES = ["classifier", "extractor", "responder"];
var CacheablePromptTypeSchema = z.enum(CACHEABLE_PROMPT_TYPES);
function isCacheablePromptType(value) {
  return CACHEABLE_PROMPT_TYPES.includes(value);
}
var CACHE_TTL_MINUTES = {
  classifier: 60,
  extractor: 5,
  responder: 5
};
var CACHE_MIN_TOKENS = 1024;
var CACHE_PRICING_MULTIPLIERS = {
  /** 5-minute TTL cache write: 1.25x base */
  cache_write_5min: 1.25,
  /** 1-hour TTL cache write: 2.0x base */
  cache_write_1hr: 2,
  /** Cache read: 0.1x base (90% savings!) */
  cache_read: 0.1
};
var LATENCY_TARGETS_MS = {
  classification: 10,
  // Rules path (LLM fallback: 500ms)
  quick_response: 500,
  // TTFT
  standard_response: 1e3,
  // TTFT
  deep_thinking: 3e3,
  // TTFT
  graph_cot: 5e3,
  // Total time
  extraction_simple: 1e3,
  extraction_complex: 5e3,
  embedding: 200,
  batch_extraction: 864e5
  // 24 hours
};
var USER_PLANS = ["free", "credits", "pro"];
var UserPlanSchema = z.enum(USER_PLANS);
function isUserPlan(value) {
  return USER_PLANS.includes(value);
}
var MODEL_DOWNGRADE_THRESHOLD = 0.8;
var FREE_TIER_CAPACITY = {
  /** Approximate quick thoughts per day */
  quick_thoughts: 5,
  /** Approximate standard thoughts per day */
  standard_thoughts: 1,
  /** Approximate deep thoughts per day (partial) */
  deep_thoughts: 0.5
};
var HEALTH_CHECK_INTERVAL_MS = 3e4;
var HEALTH_CHECK_TIMEOUT_MS = 5e3;
var HEALTH_CHECK_FAILURE_THRESHOLD = 3;
var RESERVATION_STATUSES = ["active", "finalized", "refunded", "expired"];
var ReservationStatusSchema = z.enum(RESERVATION_STATUSES);
function isReservationStatus(value) {
  return RESERVATION_STATUSES.includes(value);
}
var PROVIDER_HEALTH_STATUSES = ["healthy", "degraded", "down"];
var ProviderHealthStatusSchema = z.enum(PROVIDER_HEALTH_STATUSES);
function isProviderHealthStatus(value) {
  return PROVIDER_HEALTH_STATUSES.includes(value);
}
var EMBEDDING_MODES = ["realtime", "batch"];
var EmbeddingModeSchema = z.enum(EMBEDDING_MODES);
function isEmbeddingMode(value) {
  return EMBEDDING_MODES.includes(value);
}
var BATCH_JOB_STATUSES = ["pending", "processing", "completed", "failed"];
var BatchJobStatusSchema = z.enum(BATCH_JOB_STATUSES);
function isBatchJobStatus(value) {
  return BATCH_JOB_STATUSES.includes(value);
}
var ModelPricingSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cache_read: z.number().nonnegative().optional(),
  cache_write: z.number().nonnegative().optional()
});
var ModelConfigSchema = z.object({
  id: z.string(),
  provider: ProviderSchema,
  tier: ModelTierSchema,
  pricing: ModelPricingSchema,
  context_window: z.number().positive(),
  supports_cache: z.boolean(),
  supports_batch: z.boolean(),
  display_name: z.string()
});
var ProviderRateLimitsSchema = z.object({
  rpm: z.number().positive(),
  tpm: z.number().positive()
});
var ProviderConfigSchema = z.object({
  id: ProviderSchema,
  name: z.string(),
  models: z.array(z.string()),
  rate_limits: ProviderRateLimitsSchema,
  health_check_url: z.string().url().optional(),
  api_base_url: z.string().url()
});
var CostRangeSchema = z.object({
  min: z.number().nonnegative(),
  expected: z.number().nonnegative(),
  max: z.number().nonnegative()
});
var OperationConfigSchema = z.object({
  type: OperationTypeSchema,
  tier: ModelTierSchema,
  primary_model: z.string(),
  fallback_models: z.array(z.string()),
  cost_estimate: CostRangeSchema,
  latency_target_ms: z.number().positive(),
  rules_first: z.boolean(),
  description: z.string()
});
var TokenUsageSchema = z.object({
  input_tokens: z.number().nonnegative(),
  output_tokens: z.number().nonnegative(),
  cache_read_tokens: z.number().nonnegative().optional(),
  cache_write_tokens: z.number().nonnegative().optional()
});
var LLMRequestSchema = z.object({
  operation: OperationTypeSchema,
  input: z.string(),
  system_prompt: z.string().optional(),
  context: z.string().optional(),
  user_id: z.string(),
  urgency: UrgencyLevelSchema,
  max_tokens: z.number().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  request_id: z.string().optional()
});
var LLMResponseSchema = z.object({
  content: z.string(),
  model_used: z.string(),
  provider: ProviderSchema,
  usage: TokenUsageSchema,
  latency_ms: z.number().nonnegative(),
  cached: z.boolean(),
  finish_reason: z.enum(["stop", "length", "content_filter", "error"]),
  request_id: z.string().optional()
});
var RoutingDecisionSchema = z.object({
  model: z.string(),
  provider: ProviderSchema,
  reason: z.enum(["primary", "fallback", "rate_limited", "health", "tier_downgrade"]),
  cost_estimate: CostRangeSchema,
  use_rules_first: z.boolean(),
  use_batch: z.boolean()
});
var CreditReservationSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  amount: z.number().nonnegative(),
  operation: OperationTypeSchema,
  created_at: z.string(),
  expires_at: z.string(),
  status: ReservationStatusSchema,
  actual_amount: z.number().nonnegative().optional(),
  request_id: z.string().optional()
});
var CreditTransactionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  amount: z.number(),
  operation: OperationTypeSchema,
  model_used: z.string(),
  reservation_id: z.string().optional(),
  type: z.enum(["deduction", "refund", "adjustment"]),
  created_at: z.string(),
  description: z.string().optional()
});
var InsufficientCreditsErrorSchema = z.object({
  required: z.number().nonnegative(),
  available: z.number().nonnegative(),
  suggestion: z.string()
});
var CostEstimateEventSchema = z.object({
  type: z.literal("cost:estimate"),
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  operation: OperationTypeSchema
});
var CostRunningEventSchema = z.object({
  type: z.literal("cost:running"),
  current: z.number().nonnegative(),
  max: z.number().nonnegative()
});
var CostFinalEventSchema = z.object({
  type: z.literal("cost:final"),
  cost: z.number().nonnegative()
});
var CostEventSchema = z.discriminatedUnion("type", [
  CostEstimateEventSchema,
  CostRunningEventSchema,
  CostFinalEventSchema
]);
var CreditCheckResultSchema = z.object({
  sufficient: z.boolean(),
  available: z.number().nonnegative(),
  required: z.number().nonnegative(),
  can_proceed_cheaper: z.boolean().optional(),
  error: InsufficientCreditsErrorSchema.optional()
});
var CreditFlowConfigSchema = z.object({
  reservation_buffer: z.number().positive(),
  reservation_expiry_minutes: z.number().positive(),
  emit_events: z.boolean()
});
var PromptCacheConfigSchema = z.object({
  prompt_type: CacheablePromptTypeSchema,
  content: z.string(),
  tokens: z.number().nonnegative(),
  ttl_minutes: z.number().positive(),
  min_tokens: z.number().positive()
});
var CacheHitResultSchema = z.object({
  hit: z.boolean(),
  cache_id: z.string().optional(),
  tokens_saved: z.number().nonnegative().optional(),
  cost_saved: z.number().nonnegative().optional(),
  expires_at: z.string().optional()
});
var CacheSavingsEstimateSchema = z.object({
  without_cache: z.number().nonnegative(),
  with_cache: z.number().nonnegative(),
  savings_percent: z.number().nonnegative(),
  break_even_calls: z.number().positive()
});
var CacheEntrySchema = z.object({
  id: z.string(),
  prompt_type: CacheablePromptTypeSchema,
  content_hash: z.string(),
  tokens: z.number().positive(),
  created_at: z.string(),
  expires_at: z.string(),
  read_count: z.number().nonnegative(),
  total_tokens_saved: z.number().nonnegative()
});
var EmbeddingRequestSchema = z.object({
  texts: z.array(z.string()),
  mode: EmbeddingModeSchema,
  model: EmbeddingModelSchema.optional(),
  user_id: z.string(),
  request_id: z.string().optional()
});
var EmbeddingResultSchema = z.object({
  embeddings: z.array(z.array(z.number())),
  model: EmbeddingModelSchema,
  dimensions: z.number().positive(),
  usage: z.object({
    total_tokens: z.number().nonnegative()
  }),
  cached: z.boolean(),
  latency_ms: z.number().nonnegative()
});
var EmbeddingBatchJobSchema = z.object({
  id: z.string(),
  texts_count: z.number().positive(),
  status: BatchJobStatusSchema,
  created_at: z.string(),
  completed_at: z.string().optional(),
  deadline: z.string(),
  result_url: z.string().url().optional(),
  error: z.string().optional(),
  progress: z.number().min(0).max(100).optional()
});
var EmbeddingServiceConfigSchema = z.object({
  model: EmbeddingModelSchema,
  dimensions: z.number().positive(),
  pricing: z.object({
    realtime: z.number().nonnegative(),
    batch: z.number().nonnegative()
  }),
  cache: z.object({
    enabled: z.boolean(),
    ttl_days: z.number().positive(),
    max_size: z.string()
  })
});
var RateLimitStateSchema = z.object({
  provider: ProviderSchema,
  requests_this_minute: z.number().nonnegative(),
  tokens_this_minute: z.number().nonnegative(),
  limit: z.object({
    rpm: z.number().positive(),
    tpm: z.number().positive()
  }),
  reset_at: z.string(),
  health: ProviderHealthStatusSchema
});
var ProviderSelectionSchema = z.object({
  provider: ProviderSchema,
  model: z.string(),
  reason: z.enum(["primary", "fallback", "rate_limited", "health"]),
  rate_limit_warning: z.boolean()
});
var ProviderHealthCheckSchema = z.object({
  provider: ProviderSchema,
  healthy: z.boolean(),
  latency_ms: z.number().nonnegative().optional(),
  error: z.string().optional(),
  checked_at: z.string(),
  consecutive_failures: z.number().nonnegative()
});
var RateLimitEventSchema = z.object({
  type: z.enum(["rate_limit:warning", "rate_limit:exceeded"]),
  provider: ProviderSchema,
  usage_percent: z.number().min(0).max(100),
  reset_at: z.string(),
  action: z.enum(["route_away", "queue", "wait"])
});
var RateLimitConfigSchema = z.object({
  warning_threshold: z.number().min(0).max(1),
  health_check_interval_ms: z.number().positive(),
  health_check_timeout_ms: z.number().positive(),
  failure_threshold: z.number().positive()
});
var DegradationModeConfigSchema = z.object({
  level: DegradationLevelSchema,
  classification: z.enum(["llm", "rules_only"]),
  response: z.enum(["premium", "basic", "template"]),
  extraction: z.enum(["realtime", "batch", "queued"]),
  user_message: z.string().optional()
});
var SystemHealthStatusSchema = z.object({
  level: DegradationLevelSchema,
  healthy_providers: z.array(ProviderSchema),
  degraded_providers: z.array(ProviderSchema),
  down_providers: z.array(ProviderSchema),
  last_check: z.string(),
  duration_in_state_ms: z.number().nonnegative()
});
var OperationAvailabilitySchema = z.object({
  operation: OperationTypeSchema,
  available: z.boolean(),
  mode: z.enum(["full", "reduced", "unavailable"]),
  description: z.string()
});
var DegradationEventSchema = z.object({
  type: z.literal("degradation:changed"),
  from: DegradationLevelSchema,
  to: DegradationLevelSchema,
  reason: z.string(),
  user_message: z.string().optional(),
  changed_at: z.string()
});
var PlanUsageLimitsSchema = z.object({
  plan: UserPlanSchema,
  daily_cost_ceiling: z.number().positive().optional(),
  model_downgrade_threshold: z.number().min(0).max(1),
  strict_enforcement: z.boolean()
});
var UserUsageStateSchema = z.object({
  user_id: z.string(),
  plan: UserPlanSchema,
  today_usage: z.number().nonnegative(),
  daily_limit: z.number().nonnegative(),
  model_tier_available: ModelTierSchema,
  reset_at: z.string(),
  is_downgraded: z.boolean(),
  limit_reached: z.boolean()
});
var ModelDowngradeNotificationSchema = z.object({
  type: z.enum(["approaching_limit", "limit_reached"]),
  current_usage: z.number().nonnegative(),
  daily_limit: z.number().nonnegative(),
  from_tier: ModelTierSchema,
  to_tier: ModelTierSchema,
  message: z.string()
});
var UsageLimitEventSchema = z.object({
  type: z.enum(["usage:warning", "usage:downgrade", "usage:limit_reached", "usage:reset"]),
  user_id: z.string(),
  current_usage: z.number().nonnegative(),
  daily_limit: z.number().nonnegative(),
  usage_percent: z.number().min(0).max(100),
  model_tier: ModelTierSchema,
  message: z.string()
});
var PricingConfigSchema = z.object({
  providers: z.record(z.record(ModelPricingSchema)),
  last_updated: z.string(),
  alert_on_change: z.boolean()
});

// src/llm/index.ts
var MODEL_CONFIGS = {
  // Anthropic Models
  "claude-sonnet-4": {
    id: "claude-sonnet-4",
    provider: "anthropic",
    tier: "balanced",
    pricing: {
      input: 3,
      output: 15,
      cache_read: 0.3,
      cache_write: 3.75
    },
    context_window: 2e5,
    supports_cache: true,
    supports_batch: true,
    display_name: "Claude Sonnet 4"
  },
  "claude-3-haiku": {
    id: "claude-3-haiku",
    provider: "anthropic",
    tier: "cheap",
    pricing: {
      input: 0.25,
      output: 1.25
    },
    context_window: 2e5,
    supports_cache: true,
    supports_batch: true,
    display_name: "Claude 3 Haiku"
  },
  // OpenAI Models
  "gpt-4o": {
    id: "gpt-4o",
    provider: "openai",
    tier: "balanced",
    pricing: {
      input: 2.5,
      output: 10
    },
    context_window: 128e3,
    supports_cache: false,
    supports_batch: true,
    display_name: "GPT-4o"
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "openai",
    tier: "cheap",
    pricing: {
      input: 0.15,
      output: 0.6
    },
    context_window: 128e3,
    supports_cache: false,
    supports_batch: true,
    display_name: "GPT-4o Mini"
  },
  // Google Models
  "gemini-2.0-flash": {
    id: "gemini-2.0-flash",
    provider: "google",
    tier: "cheapest",
    pricing: {
      input: 0.1,
      output: 0.4
    },
    context_window: 1e6,
    supports_cache: false,
    supports_batch: false,
    display_name: "Gemini 2.0 Flash"
  },
  "gemini-2.0-flash-lite": {
    id: "gemini-2.0-flash-lite",
    provider: "google",
    tier: "cheapest",
    pricing: {
      input: 0.075,
      output: 0.3
    },
    context_window: 1e6,
    supports_cache: false,
    supports_batch: false,
    display_name: "Gemini 2.0 Flash Lite"
  },
  // Embedding Models
  "text-embedding-3-small": {
    id: "text-embedding-3-small",
    provider: "openai",
    tier: "cheap",
    pricing: {
      input: 0.02,
      output: 0
    },
    context_window: 8191,
    supports_cache: false,
    supports_batch: true,
    display_name: "text-embedding-3-small"
  },
  "text-embedding-3-large": {
    id: "text-embedding-3-large",
    provider: "openai",
    tier: "balanced",
    pricing: {
      input: 0.13,
      output: 0
    },
    context_window: 8191,
    supports_cache: false,
    supports_batch: true,
    display_name: "text-embedding-3-large"
  }
};
var PROVIDER_CONFIGS = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-sonnet-4", "claude-3-haiku"],
    rate_limits: { rpm: 4e3, tpm: 4e5 },
    api_base_url: "https://api.anthropic.com"
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "text-embedding-3-small", "text-embedding-3-large"],
    rate_limits: { rpm: 1e4, tpm: 2e6 },
    api_base_url: "https://api.openai.com"
  },
  google: {
    id: "google",
    name: "Google",
    models: ["gemini-2.0-flash", "gemini-2.0-flash-lite"],
    rate_limits: { rpm: 6e4, tpm: 4e6 },
    api_base_url: "https://generativelanguage.googleapis.com"
  }
};
var OPERATION_CONFIGS = {
  classification: {
    type: "classification",
    tier: "cheapest",
    primary_model: "rules",
    fallback_models: ["gemini-2.0-flash"],
    cost_estimate: { min: 0, expected: 0, max: 1e-4 },
    latency_target_ms: LATENCY_TARGETS_MS.classification,
    rules_first: true,
    description: "Query classification with rules-first approach"
  },
  quick_response: {
    type: "quick_response",
    tier: "cheap",
    primary_model: "gpt-4o-mini",
    fallback_models: ["claude-3-haiku", "gemini-2.0-flash"],
    cost_estimate: { min: 2e-4, expected: 3e-4, max: 5e-4 },
    latency_target_ms: LATENCY_TARGETS_MS.quick_response,
    rules_first: false,
    description: "Fast, simple responses"
  },
  standard_response: {
    type: "standard_response",
    tier: "balanced",
    primary_model: "claude-sonnet-4",
    fallback_models: ["gpt-4o"],
    cost_estimate: { min: 0.01, expected: 0.015, max: 0.02 },
    latency_target_ms: LATENCY_TARGETS_MS.standard_response,
    rules_first: false,
    description: "Standard quality responses"
  },
  deep_thinking: {
    type: "deep_thinking",
    tier: "premium",
    primary_model: "claude-sonnet-4",
    fallback_models: ["gpt-4o"],
    cost_estimate: { min: 0.03, expected: 0.045, max: 0.06 },
    latency_target_ms: LATENCY_TARGETS_MS.deep_thinking,
    rules_first: false,
    description: "Complex reasoning and analysis"
  },
  graph_cot: {
    type: "graph_cot",
    tier: "balanced",
    primary_model: "claude-sonnet-4",
    fallback_models: ["gpt-4o"],
    cost_estimate: { min: 0.02, expected: 0.03, max: 0.04 },
    latency_target_ms: LATENCY_TARGETS_MS.graph_cot,
    rules_first: false,
    description: "Phase 2 Graph-CoT traversal"
  },
  extraction_simple: {
    type: "extraction_simple",
    tier: "cheap",
    primary_model: "gpt-4o-mini",
    fallback_models: ["gemini-2.0-flash", "claude-3-haiku"],
    cost_estimate: { min: 5e-4, expected: 7e-4, max: 1e-3 },
    latency_target_ms: LATENCY_TARGETS_MS.extraction_simple,
    rules_first: false,
    description: "Simple node extraction"
  },
  extraction_complex: {
    type: "extraction_complex",
    tier: "balanced",
    primary_model: "claude-sonnet-4",
    fallback_models: ["gpt-4o"],
    cost_estimate: { min: 0.01, expected: 0.02, max: 0.03 },
    latency_target_ms: LATENCY_TARGETS_MS.extraction_complex,
    rules_first: false,
    description: "Complex document extraction"
  },
  embedding: {
    type: "embedding",
    tier: "cheap",
    primary_model: "text-embedding-3-small",
    fallback_models: [],
    cost_estimate: { min: 1e-5, expected: 2e-5, max: 5e-5 },
    latency_target_ms: LATENCY_TARGETS_MS.embedding,
    rules_first: false,
    description: "Generate embeddings"
  },
  batch_extraction: {
    type: "batch_extraction",
    tier: "cheap",
    primary_model: "gpt-4o-mini",
    fallback_models: ["claude-3-haiku"],
    cost_estimate: { min: 5e-3, expected: 0.01, max: 0.02 },
    latency_target_ms: LATENCY_TARGETS_MS.batch_extraction,
    rules_first: false,
    description: "Batch extraction (50% off via Batch API)"
  }
};
var PROMPT_CACHE_CONFIGS = {
  classifier: {
    prompt_type: "classifier",
    content: "",
    // Set by storm-027
    tokens: 1500,
    ttl_minutes: CACHE_TTL_MINUTES.classifier,
    min_tokens: CACHE_MIN_TOKENS
  },
  extractor: {
    prompt_type: "extractor",
    content: "",
    // Set by storm-027
    tokens: 2e3,
    ttl_minutes: CACHE_TTL_MINUTES.extractor,
    min_tokens: CACHE_MIN_TOKENS
  },
  responder: {
    prompt_type: "responder",
    content: "",
    // Set by storm-027
    tokens: 2500,
    ttl_minutes: CACHE_TTL_MINUTES.responder,
    min_tokens: CACHE_MIN_TOKENS
  }
};
var CACHE_MULTIPLIERS = CACHE_PRICING_MULTIPLIERS;
var DEFAULT_EMBEDDING_CONFIG = {
  model: DEFAULT_EMBEDDING_MODEL,
  dimensions: LLM_EMBEDDING_DIMENSIONS[DEFAULT_EMBEDDING_MODEL],
  pricing: {
    realtime: 0.02,
    // $0.02 per 1M tokens
    batch: 0.01
    // 50% off
  },
  cache: {
    enabled: true,
    ttl_days: EMBEDDING_CACHE_TTL_DAYS,
    max_size: EMBEDDING_CACHE_MAX_SIZE
  }
};
var DEFAULT_RATE_LIMIT_CONFIG = {
  warning_threshold: RATE_LIMIT_WARNING_THRESHOLD,
  health_check_interval_ms: HEALTH_CHECK_INTERVAL_MS,
  health_check_timeout_ms: HEALTH_CHECK_TIMEOUT_MS,
  failure_threshold: HEALTH_CHECK_FAILURE_THRESHOLD
};
var DEGRADATION_MODE_CONFIGS = {
  healthy: {
    level: "healthy",
    classification: "llm",
    response: "premium",
    extraction: "realtime",
    user_message: void 0
  },
  degraded: {
    level: "degraded",
    classification: "rules_only",
    response: "basic",
    extraction: "batch",
    user_message: "Some AI features may be slower than usual."
  },
  offline: {
    level: "offline",
    classification: "rules_only",
    response: "template",
    extraction: "queued",
    user_message: "AI services temporarily limited. Basic features available."
  }
};
var OPERATION_AVAILABILITY = {
  healthy: {
    classification: {
      operation: "classification",
      available: true,
      mode: "full",
      description: "LLM-assisted classification"
    },
    quick_response: {
      operation: "quick_response",
      available: true,
      mode: "full",
      description: "Fast model responses"
    },
    standard_response: {
      operation: "standard_response",
      available: true,
      mode: "full",
      description: "Premium model responses"
    },
    deep_thinking: {
      operation: "deep_thinking",
      available: true,
      mode: "full",
      description: "Complex reasoning"
    },
    graph_cot: {
      operation: "graph_cot",
      available: true,
      mode: "full",
      description: "Graph-CoT traversal"
    },
    extraction_simple: {
      operation: "extraction_simple",
      available: true,
      mode: "full",
      description: "Real-time extraction"
    },
    extraction_complex: {
      operation: "extraction_complex",
      available: true,
      mode: "full",
      description: "Real-time extraction"
    },
    embedding: {
      operation: "embedding",
      available: true,
      mode: "full",
      description: "Real-time embeddings"
    },
    batch_extraction: {
      operation: "batch_extraction",
      available: true,
      mode: "full",
      description: "Batch processing"
    }
  },
  degraded: {
    classification: {
      operation: "classification",
      available: true,
      mode: "reduced",
      description: "Rules-only classification"
    },
    quick_response: {
      operation: "quick_response",
      available: true,
      mode: "reduced",
      description: "Basic model responses"
    },
    standard_response: {
      operation: "standard_response",
      available: true,
      mode: "reduced",
      description: "Basic model responses"
    },
    deep_thinking: {
      operation: "deep_thinking",
      available: false,
      mode: "unavailable",
      description: "Queued for later"
    },
    graph_cot: {
      operation: "graph_cot",
      available: false,
      mode: "unavailable",
      description: "Queued for later"
    },
    extraction_simple: {
      operation: "extraction_simple",
      available: true,
      mode: "reduced",
      description: "Batch extraction"
    },
    extraction_complex: {
      operation: "extraction_complex",
      available: false,
      mode: "unavailable",
      description: "Queued for later"
    },
    embedding: {
      operation: "embedding",
      available: true,
      mode: "full",
      description: "Real-time embeddings"
    },
    batch_extraction: {
      operation: "batch_extraction",
      available: true,
      mode: "full",
      description: "Batch processing"
    }
  },
  offline: {
    classification: {
      operation: "classification",
      available: true,
      mode: "reduced",
      description: "Rules-only classification"
    },
    quick_response: {
      operation: "quick_response",
      available: true,
      mode: "reduced",
      description: "Template responses"
    },
    standard_response: {
      operation: "standard_response",
      available: false,
      mode: "unavailable",
      description: "Queued for later"
    },
    deep_thinking: {
      operation: "deep_thinking",
      available: false,
      mode: "unavailable",
      description: "Queued for later"
    },
    graph_cot: {
      operation: "graph_cot",
      available: false,
      mode: "unavailable",
      description: "Queued for later"
    },
    extraction_simple: {
      operation: "extraction_simple",
      available: false,
      mode: "unavailable",
      description: "Queued for later"
    },
    extraction_complex: {
      operation: "extraction_complex",
      available: false,
      mode: "unavailable",
      description: "Queued for later"
    },
    embedding: {
      operation: "embedding",
      available: false,
      mode: "unavailable",
      description: "Queued for later"
    },
    batch_extraction: {
      operation: "batch_extraction",
      available: true,
      mode: "full",
      description: "Batch processing"
    }
  }
};
var PLAN_CONFIGS = {
  free: {
    plan: "free",
    daily_cost_ceiling: FREE_DAILY_BUDGET,
    // $0.05/day
    model_downgrade_threshold: MODEL_DOWNGRADE_THRESHOLD,
    strict_enforcement: true
  },
  credits: {
    plan: "credits",
    daily_cost_ceiling: void 0,
    // Wallet balance is the limit
    model_downgrade_threshold: MODEL_DOWNGRADE_THRESHOLD,
    strict_enforcement: false
    // Just warn, don't block
  },
  pro: {
    plan: "pro",
    daily_cost_ceiling: void 0,
    // Start generous, tighten with data
    model_downgrade_threshold: MODEL_DOWNGRADE_THRESHOLD,
    strict_enforcement: false
  }
};
var USAGE_TIER_THRESHOLDS = [
  { threshold: 0, tier: "premium" },
  { threshold: 0.8, tier: "balanced" },
  { threshold: 0.9, tier: "cheap" },
  { threshold: 1, tier: "cheapest" }
];
var TIER_DOWNGRADE_SEQUENCE = [
  "premium",
  "balanced",
  "cheap",
  "cheapest"
];
var DOWNGRADE_MESSAGES = {
  approaching: "You're approaching your daily usage limit. Nous is still available but will use standard models. Full access resets at midnight.",
  downgraded: "You've reached your daily usage limit. Nous is still available using standard models. Full access resets at midnight.",
  limit_reached: "Daily limit reached. Only basic features available until midnight.",
  reset: "Your daily usage has been reset. Full access restored."
};
var DEFAULT_CREDIT_FLOW_CONFIG = {
  reservation_buffer: COST_RESERVATION_BUFFER,
  reservation_expiry_minutes: CREDIT_RESERVATION_EXPIRY_MINUTES,
  emit_events: true
};
function getModelConfig(model_id) {
  return MODEL_CONFIGS[model_id];
}
function getProviderConfig(provider) {
  return PROVIDER_CONFIGS[provider];
}
function getModelsForProvider(provider) {
  return PROVIDER_CONFIGS[provider].models;
}
function getModelsForTier(tier) {
  return Object.values(MODEL_CONFIGS).filter((m) => m.tier === tier);
}
function getProviderForModel(model_id) {
  const config = MODEL_CONFIGS[model_id];
  return config?.provider;
}
function calculateTokenCost(model_id, input_tokens, output_tokens, cache_read_tokens = 0, cache_write_tokens = 0) {
  const config = MODEL_CONFIGS[model_id];
  if (!config) {
    throw new Error(`Unknown model: ${model_id}`);
  }
  const { pricing } = config;
  const PER_MILLION = 1e6;
  let cost = 0;
  cost += input_tokens * pricing.input / PER_MILLION;
  cost += output_tokens * pricing.output / PER_MILLION;
  if (pricing.cache_read && cache_read_tokens > 0) {
    cost += cache_read_tokens * pricing.cache_read / PER_MILLION;
  }
  if (pricing.cache_write && cache_write_tokens > 0) {
    cost += cache_write_tokens * pricing.cache_write / PER_MILLION;
  }
  return cost;
}
function supportsCaching(model_id) {
  return MODEL_CONFIGS[model_id]?.supports_cache ?? false;
}
function supportsBatch(model_id) {
  return MODEL_CONFIGS[model_id]?.supports_batch ?? false;
}
function getOperationConfig(operation) {
  return OPERATION_CONFIGS[operation];
}
function estimateOperationCost(request) {
  const config = OPERATION_CONFIGS[request.operation];
  return config.cost_estimate;
}
function shouldUseBatch(operation, urgency) {
  return urgency === "background" && (operation === "batch_extraction" || operation === "embedding" || operation === "extraction_simple" || operation === "extraction_complex");
}
function getLatencyTarget(operation) {
  return LATENCY_TARGETS_MS[operation];
}
function routeRequest(request, available_providers) {
  const config = OPERATION_CONFIGS[request.operation];
  if (config.rules_first) {
    return {
      model: "rules",
      provider: "google",
      // Fallback provider for LLM if rules fail
      reason: "primary",
      cost_estimate: config.cost_estimate,
      use_rules_first: true,
      use_batch: shouldUseBatch(request.operation, request.urgency)
    };
  }
  const primary_provider = getProviderForModel(config.primary_model);
  if (primary_provider && available_providers.includes(primary_provider)) {
    return {
      model: config.primary_model,
      provider: primary_provider,
      reason: "primary",
      cost_estimate: config.cost_estimate,
      use_rules_first: false,
      use_batch: shouldUseBatch(request.operation, request.urgency)
    };
  }
  for (const fallback_model of config.fallback_models) {
    const fallback_provider = getProviderForModel(fallback_model);
    if (fallback_provider && available_providers.includes(fallback_provider)) {
      return {
        model: fallback_model,
        provider: fallback_provider,
        reason: "fallback",
        cost_estimate: config.cost_estimate,
        use_rules_first: false,
        use_batch: shouldUseBatch(request.operation, request.urgency)
      };
    }
  }
  const first_fallback = config.fallback_models[0] ?? config.primary_model;
  const first_fallback_provider = getProviderForModel(first_fallback) ?? "openai";
  return {
    model: first_fallback,
    provider: first_fallback_provider,
    reason: "health",
    cost_estimate: config.cost_estimate,
    use_rules_first: false,
    use_batch: shouldUseBatch(request.operation, request.urgency)
  };
}
function getModelForOperation(operation, available_providers) {
  const config = OPERATION_CONFIGS[operation];
  if (config.rules_first) {
    return "rules";
  }
  const primary_provider = getProviderForModel(config.primary_model);
  if (primary_provider && available_providers.includes(primary_provider)) {
    return config.primary_model;
  }
  for (const fallback_model of config.fallback_models) {
    const fallback_provider = getProviderForModel(fallback_model);
    if (fallback_provider && available_providers.includes(fallback_provider)) {
      return fallback_model;
    }
  }
  return config.primary_model;
}
function getReservationBuffer() {
  return COST_RESERVATION_BUFFER;
}
function getReservationExpiryMinutes() {
  return CREDIT_RESERVATION_EXPIRY_MINUTES;
}
function calculateActualCost(usage, model) {
  return calculateTokenCost(
    model,
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_read_tokens ?? 0,
    usage.cache_write_tokens ?? 0
  );
}
async function checkCredits(_user_id, _estimated_max) {
  throw new Error("checkCredits requires credit service implementation");
}
async function reserveCredits(_user_id, _amount, _operation, _request_id) {
  throw new Error("reserveCredits requires credit service implementation");
}
async function finalizeCredits(_reservation_id, _actual_cost, _model_used) {
  throw new Error("finalizeCredits requires credit service implementation");
}
async function refundCredits(_reservation_id) {
  throw new Error("refundCredits requires credit service implementation");
}
async function getCreditBalance(_user_id) {
  throw new Error("getCreditBalance requires credit service implementation");
}
function getCacheConfig(prompt_type) {
  return PROMPT_CACHE_CONFIGS[prompt_type];
}
function modelSupportsCaching(model) {
  return model.startsWith("claude-");
}
function calculateBreakEvenCalls(_tokens, _model) {
  return 2;
}
async function checkCacheHit(_prompt_type, _content_hash) {
  throw new Error("checkCacheHit requires cache service implementation");
}
function estimateCacheSavings(calls_expected, prompt_type, model) {
  const config = getCacheConfig(prompt_type);
  const model_config = getModelConfig(model);
  if (!model_config || !model_config.pricing.cache_read) {
    return {
      without_cache: 0,
      with_cache: 0,
      savings_percent: 0,
      break_even_calls: Infinity
    };
  }
  const PER_MILLION = 1e6;
  const base_cost = config.tokens * model_config.pricing.input / PER_MILLION;
  const cache_read_cost = config.tokens * model_config.pricing.cache_read / PER_MILLION;
  const cache_write_cost = model_config.pricing.cache_write ? config.tokens * model_config.pricing.cache_write / PER_MILLION : base_cost * 1.25;
  const without_cache = base_cost * calls_expected;
  const with_cache = cache_write_cost + cache_read_cost * (calls_expected - 1);
  const savings_percent = calls_expected > 1 ? (without_cache - with_cache) / without_cache * 100 : 0;
  return {
    without_cache,
    with_cache,
    savings_percent,
    break_even_calls: 2
  };
}
async function warmCache(_prompt_type) {
  throw new Error("warmCache requires cache service implementation");
}
async function invalidateCache(_cache_id) {
  throw new Error("invalidateCache requires cache service implementation");
}
async function getCacheStats(_prompt_type) {
  throw new Error("getCacheStats requires cache service implementation");
}
function getEmbeddingConfig() {
  return DEFAULT_EMBEDDING_CONFIG;
}
function calculateEmbeddingCost(token_count, mode) {
  const config = DEFAULT_EMBEDDING_CONFIG;
  const price_per_million = mode === "batch" ? config.pricing.batch : config.pricing.realtime;
  return token_count * price_per_million / 1e6;
}
function getBatchDiscountPercent() {
  return BATCH_DISCOUNT_PERCENT;
}
function getBatchDeadlineHours() {
  return BATCH_DEADLINE_HOURS;
}
function shouldUseBatchEmbedding(texts_count, is_user_initiated, is_urgent) {
  if (is_user_initiated || is_urgent) {
    return false;
  }
  return texts_count >= 10;
}
async function embedQuery(_text, _user_id) {
  throw new Error("embedQuery requires embedding service implementation");
}
async function embedTexts(_texts, _user_id) {
  throw new Error("embedTexts requires embedding service implementation");
}
async function embedBatch(_texts, _user_id) {
  throw new Error("embedBatch requires embedding service implementation");
}
async function getBatchStatus(_job_id) {
  throw new Error("getBatchStatus requires embedding service implementation");
}
async function getBatchResults(_job_id) {
  throw new Error("getBatchResults requires embedding service implementation");
}
async function cancelBatchJob(_job_id) {
  throw new Error("cancelBatchJob requires embedding service implementation");
}
function getRateLimitConfig() {
  return DEFAULT_RATE_LIMIT_CONFIG;
}
function getProviderRateLimits(provider) {
  return PROVIDER_RATE_LIMITS[provider];
}
function getRateLimitState(_provider) {
  throw new Error("getRateLimitState requires rate limit tracking implementation");
}
function isProviderAvailable(_provider) {
  throw new Error("isProviderAvailable requires rate limit tracking implementation");
}
function isApproachingRateLimit(_provider) {
  throw new Error("isApproachingRateLimit requires rate limit tracking implementation");
}
async function selectProvider(_operation, _preferred_providers, _urgency) {
  throw new Error("selectProvider requires rate limit tracking implementation");
}
function trackRequest(_provider, _tokens_used) {
  throw new Error("trackRequest requires rate limit tracking implementation");
}
async function checkProviderHealth(_provider) {
  throw new Error("checkProviderHealth requires health monitoring implementation");
}
function getHealthyProviderCount() {
  throw new Error("getHealthyProviderCount requires health monitoring implementation");
}
function getAllProviderHealth() {
  throw new Error("getAllProviderHealth requires health monitoring implementation");
}
function resetRateLimitCounters(_provider) {
  throw new Error("resetRateLimitCounters requires rate limit tracking implementation");
}
function calculateUsagePercent(_provider) {
  throw new Error("calculateUsagePercent requires rate limit tracking implementation");
}
var currentDegradationLevel = "healthy";
function getCurrentDegradationLevel() {
  return currentDegradationLevel;
}
function setDegradationLevel(level, _reason) {
  currentDegradationLevel = level;
}
function getDegradationModeConfig() {
  return DEGRADATION_MODE_CONFIGS[currentDegradationLevel];
}
function getUserMessage() {
  return DEGRADATION_MODE_CONFIGS[currentDegradationLevel].user_message;
}
function calculateDegradationLevel(healthy_count, total_count) {
  if (healthy_count === 0) {
    return "offline";
  }
  if (healthy_count === 1 || healthy_count < total_count / 2) {
    return "degraded";
  }
  return "healthy";
}
function isOperationAvailable(operation) {
  return OPERATION_AVAILABILITY[currentDegradationLevel][operation].available;
}
function getOperationAvailability(operation) {
  return OPERATION_AVAILABILITY[currentDegradationLevel][operation];
}
function handleProviderFailure(_provider) {
  throw new Error("handleProviderFailure requires health monitoring implementation");
}
function handleProviderRecovery(_provider) {
  throw new Error("handleProviderRecovery requires health monitoring implementation");
}
function getSystemHealthStatus() {
  throw new Error("getSystemHealthStatus requires health monitoring implementation");
}
function getPlanConfig(plan) {
  return PLAN_CONFIGS[plan];
}
function calculateTierForUsage(usage_percent) {
  for (let i = USAGE_TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = USAGE_TIER_THRESHOLDS[i];
    if (threshold && usage_percent >= threshold.threshold) {
      return threshold.tier;
    }
  }
  return "premium";
}
function getFreeTierCapacity() {
  return FREE_TIER_CAPACITY;
}
function getDowngradeMessage(type) {
  return DOWNGRADE_MESSAGES[type];
}
function checkUserBudget(_user_id, _estimated_cost) {
  throw new Error("checkUserBudget requires usage tracking implementation");
}
async function getUserUsageState(_user_id) {
  throw new Error("getUserUsageState requires usage tracking implementation");
}
async function getAvailableModelTier(_user_id) {
  throw new Error("getAvailableModelTier requires usage tracking implementation");
}
function handleApproachingLimit(_user_id, _usage_percent) {
  throw new Error("handleApproachingLimit requires usage tracking implementation");
}
async function trackUsage(_user_id, _cost) {
  throw new Error("trackUsage requires usage tracking implementation");
}
async function resetDailyUsage(_user_id) {
  throw new Error("resetDailyUsage requires usage tracking implementation");
}
async function isOperationAllowedForTier(_user_id, _required_tier) {
  throw new Error("isOperationAllowedForTier requires usage tracking implementation");
}
var ClerkConfigSchema = z.object({
  publishable_key: z.string().min(1),
  secret_key: z.string().min(1),
  sign_in_methods: z.array(z.enum(AUTH_METHODS)),
  mfa_enabled: z.boolean(),
  session_lifetime_minutes: z.number().int().positive(),
  ios: z.object({ native_sdk: z.boolean() }),
  android: z.object({ native_sdk: z.boolean() }),
  desktop: z.object({
    oauth_redirect_uri: z.string().url(),
    deep_link_scheme: z.string()
  })
});
var PlatformAuthConfigSchema = z.object({
  platform: z.enum(PLATFORMS),
  apple_sign_in: z.enum(SIGN_IN_IMPLEMENTATIONS),
  google_sign_in: z.enum(SIGN_IN_IMPLEMENTATIONS),
  email_password: z.enum(SIGN_IN_IMPLEMENTATIONS)
});
var AuthTokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  issued_at: z.string().datetime(),
  expires_at: z.string().datetime()
});
var AuthStateSchema = z.object({
  user_id: z.string().min(1),
  tokens: AuthTokensSchema,
  last_online: z.string().datetime(),
  offline_state: z.enum(OFFLINE_STATES),
  privacy_tier: z.enum(PRIVACY_TIERS),
  device_id: z.string().min(1)
});
var DesktopAuthFlowSchema = z.object({
  step: z.enum(DESKTOP_AUTH_STEPS),
  redirect_uri: z.string(),
  state_param: z.string().min(1),
  code_verifier: z.string().optional(),
  error: z.string().optional()
});
var AuthSecurityConfigSchema = z.object({
  brute_force_lockout_attempts: z.number().int().positive(),
  brute_force_lockout_minutes: z.number().int().positive(),
  captcha_after_failures: z.number().int().positive(),
  new_device_email_alert: z.boolean(),
  invalidate_sessions_on_password_change: z.boolean(),
  mfa_options: z.array(z.enum(MFA_OPTIONS))
});
var JWTValidationResultSchema = z.object({
  valid: z.boolean(),
  user_id: z.string().optional(),
  error: z.enum(["expired", "invalid_signature", "malformed", "revoked"]).optional()
});
var TierDefinitionSchema = z.object({
  tier: z.enum(PRIVACY_TIERS),
  name: z.string(),
  description: z.string(),
  target_user: z.string(),
  search: z.enum(["cloud", "client_only"]),
  llm_access: z.enum(["direct", "explicit_consent"]),
  key_management: z.enum(["none", "passkey_derived"]),
  data_protection: z.array(z.string()),
  data_exposure: z.array(z.string())
});
var TierComparisonSchema = z.object({
  feature: z.string(),
  standard: z.string(),
  private_tier: z.string()
});
var TierMigrationRequestSchema = z.object({
  user_id: z.string().min(1),
  from_tier: z.enum(PRIVACY_TIERS),
  to_tier: z.enum(PRIVACY_TIERS),
  initiated_at: z.string().datetime()
});
var TierMigrationStateSchema = z.object({
  request: TierMigrationRequestSchema,
  status: z.enum(TIER_MIGRATION_STATUSES),
  progress: z.number().min(0).max(100),
  nodes_processed: z.number().int().min(0),
  nodes_total: z.number().int().min(0),
  estimated_time_remaining_ms: z.number().min(0),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  error: z.string().optional()
});
var EncryptedNodeSchemaZ = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  encrypted_payload: z.instanceof(Uint8Array),
  encrypted_embedding: z.instanceof(Uint8Array).optional(),
  encryption_version: z.number().int().min(1),
  nonce: z.instanceof(Uint8Array).refine(
    (val) => val.length === NONCE_LENGTH_BYTES,
    { message: `Nonce must be exactly ${NONCE_LENGTH_BYTES} bytes` }
  ),
  encryption_tier: z.enum(PRIVACY_TIERS),
  version: z.number().int().min(1),
  updated_at: z.number().int()
});
var EncryptionFieldMapSchema = z.object({
  plaintext: z.array(z.string()),
  encrypted_content: z.array(z.string()),
  encrypted_embedding: z.array(z.string()),
  encrypted_metadata: z.array(z.string())
});
var EncryptionResultSchema = z.object({
  encrypted_payload: z.instanceof(Uint8Array),
  encrypted_embedding: z.instanceof(Uint8Array).optional(),
  nonce: z.instanceof(Uint8Array),
  encryption_version: z.number().int().min(1)
});
var DecryptionResultSchema = z.object({
  content: z.object({
    title: z.string(),
    body: z.string().optional(),
    summary: z.string().optional(),
    blocks: z.array(z.unknown()).optional()
  }),
  embedding: z.object({
    vector: z.instanceof(Float32Array),
    model: z.string(),
    created_at: z.string()
  }).optional(),
  temporal: z.object({
    ingestion: z.object({ timestamp: z.string(), timezone: z.string() }),
    event: z.unknown().optional(),
    content_times: z.array(z.unknown()).optional(),
    reference_patterns: z.array(z.string()).optional()
  }),
  neural: z.object({
    stability: z.number(),
    retrievability: z.number(),
    last_accessed: z.string(),
    access_count: z.number()
  }),
  provenance: z.object({
    source: z.string(),
    parent_id: z.string().optional(),
    confidence: z.number()
  }),
  state: z.object({
    extraction_depth: z.string(),
    lifecycle: z.string()
  })
});
var ClientSearchConfigSchema = z.object({
  hnsw_ef_construction: z.number().int().positive(),
  hnsw_ef_search: z.number().int().positive(),
  hnsw_m: z.number().int().positive(),
  max_nodes: z.number().int().positive(),
  index_in_memory: z.boolean()
});
var LocalSearchResultSchema = z.object({
  node_id: z.string(),
  distance: z.number().min(0),
  score: z.number().min(0).max(1)
});
var HNSWIndexSchema = z.object({
  size: z.number().int().min(0),
  ready: z.boolean(),
  memory_bytes: z.number().int().min(0)
});
var PasskeyInfoSchema = z.object({
  id: z.string().min(1),
  created_at: z.string().datetime(),
  platform: z.enum(PASSKEY_PLATFORMS),
  synced_via: z.string().min(1),
  secure_enclave: z.boolean()
});
var MasterKeyInfoSchema = z.object({
  algorithm: z.literal(KEY_DERIVATION_FUNCTION),
  length_bits: z.literal(MASTER_KEY_LENGTH_BITS),
  derivation_salt: z.instanceof(Uint8Array),
  exists_in_memory_only: z.literal(true)
});
var DerivedKeysSchema = z.object({
  content_key: z.any().refine((val) => val != null, { message: "content_key is required" }),
  embedding_key: z.any().refine((val) => val != null, { message: "embedding_key is required" }),
  metadata_key: z.any().refine((val) => val != null, { message: "metadata_key is required" })
});
var KeyHierarchySchema = z.object({
  passkey: PasskeyInfoSchema,
  master_key: MasterKeyInfoSchema,
  derived_keys: DerivedKeysSchema
});
var KeyDerivationParamsSchema = z.object({
  algorithm: z.literal("HKDF"),
  hash: z.literal("SHA-256"),
  salt: z.instanceof(Uint8Array),
  info: z.string().min(1),
  key_length: z.literal(MASTER_KEY_LENGTH_BITS)
});
var MultiDeviceKeySyncSchema = z.object({
  method: z.literal("passkey_platform_sync"),
  description: z.string(),
  sync_mechanisms: z.record(z.enum(PASSKEY_PLATFORMS), z.string())
});
var KeyVersionSchema = z.object({
  version: z.number().int().min(1),
  created_at: z.string().datetime(),
  derivation_salt: z.instanceof(Uint8Array),
  status: z.enum(KEY_VERSION_STATUSES)
});
var UserKeyMetadataSchema = z.object({
  current_version: z.number().int().min(1),
  versions: z.array(KeyVersionSchema),
  rotation_in_progress: z.boolean(),
  rotation_progress: z.number().min(0).max(100),
  rotation_started_at: z.string().datetime().nullable()
});
var RotationProgressSchema = z.object({
  processed_count: z.number().int().min(0),
  total_count: z.number().int().min(0),
  last_processed_id: z.string().nullable(),
  started_at: z.string().datetime(),
  phase: z.enum(ROTATION_PHASES)
});
var RotationConfigSchema = z.object({
  batch_size: z.number().int().positive(),
  pause_between_batches_ms: z.number().int().min(0),
  max_batches_per_minute: z.number().int().positive(),
  require_wifi: z.boolean(),
  require_charging: z.boolean(),
  min_battery_level: z.number().int().min(0).max(100),
  persist_progress: z.boolean(),
  auto_resume_on_launch: z.boolean()
});
var RotationEventSchema = z.object({
  type: z.enum(ROTATION_EVENT_TYPES),
  progress: z.number().min(0).max(100).optional(),
  processed_count: z.number().int().min(0).optional(),
  total_count: z.number().int().min(0).optional(),
  estimated_remaining_ms: z.number().min(0).optional(),
  error: z.string().optional()
});
var RecoveryCodeSchema = z.object({
  mnemonic: z.array(z.string()).length(RECOVERY_WORD_COUNT),
  version: z.number().int().min(1),
  created_at: z.string().datetime(),
  verified: z.boolean()
});
var RecoverySetupStateSchema = z.object({
  step: z.enum(RECOVERY_SETUP_STEPS),
  mnemonic: z.array(z.string()).length(RECOVERY_WORD_COUNT),
  verification_indices: z.array(z.number().int().min(0).max(RECOVERY_WORD_COUNT - 1)).length(RECOVERY_VERIFICATION_WORD_COUNT),
  attempts_remaining: z.number().int().min(0).max(RECOVERY_VERIFICATION_ATTEMPT_LIMIT)
});
var RecoveryAttemptSchema = z.object({
  user_id: z.string().min(1),
  method: z.enum(RECOVERY_METHODS),
  attempted_at: z.string().datetime(),
  success: z.boolean(),
  error: z.string().optional()
});
var GracePeriodStateSchema = z.object({
  enabled: z.boolean(),
  expires_at: z.string().datetime(),
  email_recovery_available: z.boolean()
});
var RecoveryRegenerationResultSchema = z.object({
  new_mnemonic: z.array(z.string()).length(RECOVERY_WORD_COUNT),
  old_code_invalidated: z.boolean(),
  new_encrypted_master: z.instanceof(Uint8Array),
  verification_required: z.boolean()
});
var RecoveryReminderSchema = z.object({
  type: z.enum(RECOVERY_REMINDER_TYPES),
  days_since_setup: z.number().int().min(0),
  last_dismissed: z.string().datetime().nullable(),
  message: z.string().min(1)
});
var ConsentStateSchema = z.object({
  scope: z.enum(CONSENT_SCOPES),
  granted: z.boolean(),
  granted_at: z.string().datetime().optional(),
  expires_at: z.string().datetime().optional(),
  provider: z.string().optional(),
  memories_shared_count: z.number().int().min(0),
  memories_shared_ids: z.array(z.string())
});
var TopicConsentSchema = z.object({
  topic_embedding: z.array(z.number()),
  label: z.string().min(1),
  consented_at: z.string().datetime(),
  query_count: z.number().int().min(0)
});
var ConsentSettingsSchema = z.object({
  default_scope: z.enum(CONSENT_SCOPES),
  time_based_duration: z.enum(CONSENT_DURATIONS),
  topic_similarity_threshold: z.number().min(0.8).max(0.95),
  remembered_topics: z.array(TopicConsentSchema),
  conversation_timeout_minutes: z.number().int().positive(),
  require_explicit_for_sensitive: z.boolean()
});
var ConsentDialogDataSchema = z.object({
  memories: z.array(z.lazy(() => ConsentMemoryPreviewSchema)),
  total_count: z.number().int().min(1),
  provider_name: z.string().min(1),
  provider_privacy_note: z.string(),
  provider_policy_url: z.string().url()
});
var ConsentMemoryPreviewSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  created_at: z.string().datetime(),
  type: z.string().min(1),
  preview: z.string(),
  selected: z.boolean()
});
var ConsentRevocationRequestSchema = z.object({
  scope: z.enum(CONSENT_REVOCATION_SCOPES)
});
var DeclineResultSchema = z.object({
  declined: z.literal(true),
  available_actions: z.array(z.enum(DECLINE_ACTIONS)),
  previous_context_available: z.boolean(),
  message: z.string()
});
var ConsentEventSchema = z.object({
  type: z.enum(CONSENT_EVENT_TYPES),
  user_id: z.string().min(1),
  scope: z.enum(CONSENT_SCOPES),
  memories_count: z.number().int().min(0),
  provider: z.string(),
  timestamp: z.string().datetime()
});
var ConsentVisualIndicatorSchema = z.object({
  memories_shared_count: z.number().int().min(0),
  provider_name: z.string(),
  consent_scope_label: z.string(),
  time_remaining: z.string().optional(),
  transmitting: z.boolean()
});
var SharedMemoryDetailSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  shared_at: z.string().datetime()
});
var PlatformApiKeySchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  encrypted_key: z.string().min(1),
  created_at: z.string().datetime(),
  rotated_at: z.string().datetime(),
  rate_limit: z.object({
    rpm: z.number().int().positive(),
    tpm: z.number().int().positive()
  })
});
var BYOKConfigSchema = z.object({
  user_id: z.string().min(1),
  provider: z.enum(LLM_PROVIDERS),
  encrypted_key: z.instanceof(Uint8Array),
  encryption_method: z.enum(BYOK_ENCRYPTION_METHODS),
  created_at: z.string().datetime(),
  last_used: z.string().datetime().optional()
});
var ApiCallRouteSchema = z.object({
  key_type: z.enum(API_KEY_TYPES),
  flow: z.enum(API_CALL_FLOWS),
  rate_limited: z.boolean(),
  usage_logged: z.boolean()
});
var BYOKRateLimitConfigSchema = z.object({
  max_decryptions_per_minute: z.number().int().positive(),
  exponential_backoff: z.boolean(),
  lockout_after_failures: z.number().int().positive(),
  lockout_duration_minutes: z.number().int().positive()
});
var BYOKDecryptionAttemptSchema = z.object({
  user_id: z.string().min(1),
  attempted_at: z.string().datetime(),
  success: z.boolean(),
  consecutive_failures: z.number().int().min(0),
  locked_out: z.boolean(),
  lockout_expires_at: z.string().datetime().nullable()
});
var ExportComplianceConfigSchema = z.object({
  region: z.string().min(1),
  standard_tier: z.enum(EXPORT_COMPLIANCE_STATUSES),
  private_tier: z.enum(EXPORT_COMPLIANCE_STATUSES),
  documentation_required: z.array(z.string()),
  notes: z.string()
});
var AppStoreDeclarationSchema = z.object({
  platform: z.enum(PLATFORMS),
  uses_non_exempt_encryption: z.boolean(),
  eccn: z.string().optional(),
  mass_market_exemption: z.boolean().optional(),
  self_classification_filed: z.boolean(),
  annual_report_due: z.string().datetime().optional()
});
var ThreatModelEntrySchema = z.object({
  threat: z.string().min(1),
  protected_by_standard: z.boolean(),
  protected_by_private: z.boolean(),
  description: z.string().min(1)
});
var LaunchPhaseSchema = z.object({
  version: z.string().min(1),
  features: z.array(z.string()),
  markets: z.array(z.string()),
  compliance_requirements: z.array(z.string())
});
var OfflineStateConfigSchema = z.object({
  state: z.enum(OFFLINE_STATES),
  max_hours: z.number().min(0),
  functionality: z.enum(OFFLINE_FUNCTIONALITY_LEVELS),
  sync_behavior: z.enum(OFFLINE_SYNC_BEHAVIORS),
  auth_behavior: z.string().min(1),
  private_tier_key_access: z.boolean()
});
var OfflineSyncQueueSchema = z.object({
  operations: z.array(z.lazy(() => QueuedOperationSchema)),
  created_at: z.string().datetime(),
  last_attempted: z.string().datetime().nullable()
});
var QueuedOperationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(QUEUE_OPERATION_TYPES),
  table: z.enum(QUEUEABLE_TABLES),
  data: z.unknown(),
  queued_at: z.string().datetime(),
  priority: z.number().int().min(0)
});
var OfflineCapabilityCheckSchema = z.object({
  can_read: z.boolean(),
  can_write: z.boolean(),
  can_search: z.boolean(),
  can_sync: z.boolean(),
  can_use_llm: z.boolean(),
  reason: z.string().min(1)
});
var QueueSyncResultSchema = z.object({
  synced: z.number().int().min(0),
  failed: z.number().int().min(0),
  errors: z.array(z.object({
    operation_id: z.string(),
    error: z.string()
  })).optional()
});

// src/security/auth.ts
var PLATFORM_AUTH_CONFIGS = {
  ios: {
    platform: "ios",
    apple_sign_in: "native",
    google_sign_in: "native",
    email_password: "clerk_ui"
  },
  android: {
    platform: "android",
    apple_sign_in: "rest_api",
    google_sign_in: "native",
    email_password: "clerk_ui"
  },
  macos: {
    platform: "macos",
    apple_sign_in: "native",
    google_sign_in: "oauth",
    email_password: "clerk_web"
  },
  windows: {
    platform: "windows",
    apple_sign_in: "oauth",
    google_sign_in: "oauth",
    email_password: "clerk_web"
  }
};
var DEFAULT_SECURITY_CONFIG = {
  brute_force_lockout_attempts: BRUTE_FORCE_LOCKOUT_ATTEMPTS,
  brute_force_lockout_minutes: BRUTE_FORCE_LOCKOUT_MINUTES,
  captcha_after_failures: CAPTCHA_AFTER_FAILURES,
  new_device_email_alert: true,
  invalidate_sessions_on_password_change: true,
  mfa_options: ["totp", "sms", "passkey"]
};
var DEFAULT_DESKTOP_CONFIG = {
  oauth_redirect_uri: `${DEEP_LINK_SCHEME}://${AUTH_CALLBACK_PATH}`,
  deep_link_scheme: DEEP_LINK_SCHEME
};
var OFFLINE_STATE_TRANSITION_REFERENCE = {
  online: "Full functionality",
  short_offline: `<${OFFLINE_THRESHOLDS.short_offline}h, JWT valid, full functionality`,
  medium_offline: `<${OFFLINE_THRESHOLDS.medium_offline}h, JWT expired, read-only + queued writes`,
  long_offline: `>${OFFLINE_THRESHOLDS.medium_offline}h, refresh expired, local only`,
  reauth_required: "Must reconnect to continue"
};
function isTokenValid(tokens) {
  const expiresAt = new Date(tokens.expires_at).getTime();
  return Date.now() < expiresAt;
}
function shouldReauthenticate(auth) {
  const lastOnline = new Date(auth.last_online).getTime();
  const hoursSinceOnline = (Date.now() - lastOnline) / (1e3 * 60 * 60);
  return hoursSinceOnline >= OFFLINE_THRESHOLDS.medium_offline;
}
function updateOfflineState(auth) {
  const lastOnline = new Date(auth.last_online).getTime();
  const hoursSinceOnline = (Date.now() - lastOnline) / (1e3 * 60 * 60);
  if (hoursSinceOnline < 0.01) {
    return "online";
  }
  if (hoursSinceOnline < OFFLINE_THRESHOLDS.short_offline && isTokenValid(auth.tokens)) {
    return "short_offline";
  }
  if (hoursSinceOnline < OFFLINE_THRESHOLDS.medium_offline) {
    return "medium_offline";
  }
  return "long_offline";
}
function getPlatformAuthConfig(platform) {
  return PLATFORM_AUTH_CONFIGS[platform];
}
function getClerkConfig(_platform) {
  throw new Error("getClerkConfig requires Clerk SDK integration");
}
async function validateJWT(_token) {
  throw new Error("validateJWT requires Clerk SDK implementation");
}

// src/security/tiers.ts
var TIER_DEFINITIONS = {
  standard: {
    tier: "standard",
    name: "Standard",
    description: "Server-managed security with full cloud features. Your data is encrypted at rest and in transit.",
    target_user: "Users who prioritize convenience over maximum privacy. Trust Nous with their data (but not random attackers).",
    search: "cloud",
    llm_access: "direct",
    key_management: "none",
    data_protection: [
      "Data in transit: TLS 1.3 + certificate pinning",
      "Data at rest: Turso built-in encryption (AES-256)",
      "Separation: Database-per-tenant (your data isolated)"
    ],
    data_exposure: [
      "Nous can technically access your data (for support, debugging)",
      "Subpoena could compel disclosure",
      "Server-side breach could expose plaintext"
    ]
  },
  private: {
    tier: "private",
    name: "Private",
    description: "Full end-to-end encryption. Content and embeddings encrypted client-side. Nous cannot access your data.",
    target_user: "Journalists, activists, privacy advocates. Users who don't want ANYONE to access their data. Willing to accept feature limitations.",
    search: "client_only",
    llm_access: "explicit_consent",
    key_management: "passkey_derived",
    data_protection: [
      "Content: AES-256-GCM encrypted (client-side)",
      "Embeddings: AES-256-GCM encrypted (client-side)",
      "Metadata: Type/ID plaintext (for sync), everything else encrypted",
      "Nous CANNOT access your data - we literally don't have the keys"
    ],
    data_exposure: [
      "All search is local (must decrypt to search)",
      "LLM features require explicit consent per-query",
      "Larger devices needed (100MB+ for index)",
      "You can lose your data if you lose keys"
    ]
  }
};
var TIER_COMPARISON_TABLE = [
  {
    feature: "Search",
    standard: "Full cloud (HNSW + BM25)",
    private_tier: "Client-side only"
  },
  {
    feature: "LLM Features",
    standard: "Direct, seamless",
    private_tier: "Explicit consent required"
  },
  {
    feature: "Key Management",
    standard: "None (server-managed)",
    private_tier: "Passkey-derived master key"
  },
  {
    feature: "Data Accessible To",
    standard: "Nous (for support), law enforcement (with subpoena)",
    private_tier: "Only you (with your keys)"
  },
  {
    feature: "Recovery Options",
    standard: "Email, password reset",
    private_tier: "Recovery code only (after 7-day grace)"
  },
  {
    feature: "Offline Experience",
    standard: "Read-only when offline, sync when back",
    private_tier: "Full offline (passkey unlock is local)"
  },
  {
    feature: "Device Requirements",
    standard: "Any",
    private_tier: "100MB+ for search index"
  },
  {
    feature: "Export Compliance",
    standard: "HTTPS exempt, no extra docs",
    private_tier: "ECCN 5D992, requires documentation"
  }
];
function getTierDefinition(tier) {
  return TIER_DEFINITIONS[tier];
}
function canMigrateTier(from, to) {
  return from !== to;
}
function estimateMigrationTime(node_count) {
  return Math.ceil(node_count / 1e3) * MIGRATION_RATE_MS_PER_1K_NODES;
}
async function startTierMigration(_request) {
  throw new Error("startTierMigration requires server-side migration state and encryption services");
}
async function getTierMigrationProgress(_user_id) {
  throw new Error("getTierMigrationProgress requires server-side migration state lookup");
}

// src/security/encryption.ts
var ENCRYPTION_FIELD_MAP = {
  plaintext: [
    "id",
    "type",
    "version",
    "updated_at",
    "encryption_version",
    "nonce",
    "encryption_tier"
  ],
  encrypted_content: [
    "content.title",
    "content.body",
    "content.summary",
    "content.blocks"
  ],
  encrypted_embedding: [
    "embedding.vector"
  ],
  encrypted_metadata: [
    "temporal.ingestion",
    "temporal.event",
    "temporal.content_times",
    "temporal.reference_patterns",
    "neural.stability",
    "neural.retrievability",
    "neural.last_accessed",
    "neural.access_count",
    "provenance.source",
    "provenance.parent_id",
    "provenance.confidence",
    "state.extraction_depth",
    "state.lifecycle",
    "versioning.lastModified",
    "versioning.lastModifier",
    "versioning.checksum"
  ]
};
var ENCRYPTED_NODES_ADDITIONAL_SQL = `
-- Additional columns for storm-022 Private tier encryption
-- (encrypted_payload and encryption_tier already exist from storm-017)

ALTER TABLE nodes ADD COLUMN encrypted_embedding BLOB;
ALTER TABLE nodes ADD COLUMN encryption_version INTEGER DEFAULT 1;
ALTER TABLE nodes ADD COLUMN nonce BLOB;

-- Index on encryption version for key rotation queries
CREATE INDEX IF NOT EXISTS idx_nodes_encryption_version ON nodes(encryption_version)
  WHERE encryption_tier = 'private';
`;
var DEFAULT_CLIENT_SEARCH_CONFIG_MOBILE = {
  hnsw_ef_construction: 200,
  hnsw_ef_search: 50,
  hnsw_m: 16,
  max_nodes: PRIVATE_TIER_NODE_LIMITS.mobile,
  index_in_memory: true
};
var DEFAULT_CLIENT_SEARCH_CONFIG_DESKTOP = {
  hnsw_ef_construction: 200,
  hnsw_ef_search: 50,
  hnsw_m: 16,
  max_nodes: PRIVATE_TIER_NODE_LIMITS.desktop,
  index_in_memory: true
};
var PERFORMANCE_REFERENCE = {
  "10k": {
    memory_mb: 130,
    index_build_seconds: 2,
    search_latency_ms: 20
  },
  "50k": {
    memory_mb: 650,
    index_build_seconds: 10,
    search_latency_ms: 40
  },
  "100k": {
    memory_mb: 1300,
    index_build_seconds: 20,
    search_latency_ms: 60
  }
};
async function encryptNode(_node, _keys) {
  throw new Error("encryptNode requires Web Crypto API implementation");
}
async function decryptNode(_encrypted, _keys) {
  throw new Error("decryptNode requires Web Crypto API implementation");
}
async function encryptEmbedding(_vector, _key) {
  throw new Error("encryptEmbedding requires Web Crypto API implementation");
}
async function decryptEmbedding(_encrypted, _key) {
  throw new Error("decryptEmbedding requires Web Crypto API implementation");
}
async function buildLocalSearchIndex(_decryptedEmbeddings, _config) {
  throw new Error("buildLocalSearchIndex requires HNSW library implementation");
}
async function searchLocalIndex(_index, _query, _topK) {
  throw new Error("searchLocalIndex requires HNSW library implementation");
}

// src/security/keys.ts
var DEFAULT_MULTI_DEVICE_SYNC = {
  method: "passkey_platform_sync",
  description: "Passkey syncs via platform credential manager. On new device: authenticate \u2192 derive keys. No key transmission needed \u2014 derivation is deterministic.",
  sync_mechanisms: PASSKEY_SYNC_MECHANISMS
};
function createDerivationParams(purpose, salt) {
  return {
    algorithm: "HKDF",
    hash: "SHA-256",
    salt,
    info: DERIVATION_INFO_STRINGS[purpose],
    key_length: MASTER_KEY_LENGTH_BITS
  };
}
async function deriveMasterKey(_passkeySecret, _salt) {
  throw new Error("deriveMasterKey requires Web Crypto API implementation");
}
async function deriveContentKey(_masterKey) {
  throw new Error("deriveContentKey requires Web Crypto API implementation");
}
async function deriveEmbeddingKey(_masterKey) {
  throw new Error("deriveEmbeddingKey requires Web Crypto API implementation");
}
async function deriveMetadataKey(_masterKey) {
  throw new Error("deriveMetadataKey requires Web Crypto API implementation");
}
async function deriveAllKeys(_masterKey) {
  throw new Error("deriveAllKeys requires Web Crypto API implementation");
}
function generateSalt() {
  throw new Error("generateSalt requires Web Crypto API implementation");
}
var DEFAULT_ROTATION_CONFIG = {
  batch_size: ROTATION_BATCH_SIZE,
  pause_between_batches_ms: ROTATION_PAUSE_BETWEEN_BATCHES_MS,
  max_batches_per_minute: ROTATION_MAX_BATCHES_PER_MINUTE,
  require_wifi: true,
  require_charging: true,
  min_battery_level: ROTATION_MIN_BATTERY_LEVEL,
  persist_progress: true,
  auto_resume_on_launch: true
};
var ROTATION_TIMING_REFERENCE = ROTATION_TIMING_ESTIMATES;
async function initiateKeyRotation(_user_id, _trigger) {
  throw new Error("initiateKeyRotation requires Web Crypto API and server-side key metadata");
}
async function backgroundReencrypt(_old_key, _new_key, _progress) {
  throw new Error("backgroundReencrypt requires Web Crypto API and database adapter");
}
async function getNodesNeedingRotation(_last_processed_id) {
  throw new Error("getNodesNeedingRotation requires database adapter");
}
async function canContinueRotation() {
  throw new Error("canContinueRotation requires platform battery/network APIs");
}
async function saveRotationProgress(_progress) {
  throw new Error("saveRotationProgress requires server-side progress storage");
}
async function resumeRotation(_user_id) {
  throw new Error("resumeRotation requires server-side progress lookup");
}
async function verifyRotation(_new_key, _sample_percent) {
  throw new Error("verifyRotation requires Web Crypto API and database adapter");
}
async function completeRotation(_user_id) {
  throw new Error("completeRotation requires server-side key metadata update");
}
function getKeyVersionForNode(_node, _metadata) {
  throw new Error("getKeyVersionForNode requires key derivation from stored salts");
}

// src/security/recovery.ts
var RECOVERY_DERIVATION_INFO = "nous-recovery";
var RECOVERY_KEY_LENGTH_BYTES = 32;
var RECOVERY_REMINDER_MESSAGES = {
  initial: "Have you stored your recovery code safely? Without it, your data cannot be recovered if you lose all your devices.",
  periodic: "Recovery code reminder: Make sure your recovery code is still accessible. If you've lost it, regenerate a new one in Settings > Security.",
  new_device: "Welcome to your new device. Remember, your recovery code is the ultimate backup if you lose access to all your devices."
};
var OLD_CODE_ERROR_MESSAGE = "This recovery code is no longer valid. It was replaced on {date}. If you didn't change your passkey, contact support immediately.";
function getVerificationIndices() {
  const indices = [];
  while (indices.length < RECOVERY_VERIFICATION_WORD_COUNT) {
    const idx = Math.floor(Math.random() * RECOVERY_WORD_COUNT);
    if (!indices.includes(idx)) {
      indices.push(idx);
    }
  }
  return indices.sort((a, b) => a - b);
}
function verifyRecoveryWords(mnemonic, indices, answers) {
  if (indices.length !== answers.length) {
    return false;
  }
  return indices.every((index, i) => {
    const expected = mnemonic[index];
    const answer = answers[i];
    if (expected === void 0 || answer === void 0) {
      return false;
    }
    return expected.toLowerCase() === answer.toLowerCase();
  });
}
function generateRecoveryCode() {
  throw new Error("generateRecoveryCode requires BIP39 library implementation");
}
async function deriveRecoveryKey(_mnemonic) {
  throw new Error("deriveRecoveryKey requires BIP39 library and Web Crypto API implementation");
}
async function encryptMasterKeyForRecovery(_master_key, _recovery_key) {
  throw new Error("encryptMasterKeyForRecovery requires Web Crypto API implementation");
}
async function recoverMasterKey(_mnemonic, _encrypted_master) {
  throw new Error("recoverMasterKey requires BIP39 library and Web Crypto API implementation");
}
async function regenerateRecoveryCode(_user_id, _master_key) {
  throw new Error("regenerateRecoveryCode requires BIP39 library and server integration");
}
async function isGracePeriodActive(_user_id) {
  throw new Error("isGracePeriodActive requires server-side state lookup");
}
async function recoverViaEmail(_user_id, _email_token) {
  throw new Error("recoverViaEmail requires server-side email verification implementation");
}
function getRecoveryReminder(_user_id) {
  throw new Error("getRecoveryReminder requires server-side state lookup");
}
async function dismissRecoveryReminder(_user_id, _reminder_type) {
  throw new Error("dismissRecoveryReminder requires server-side state update");
}

// src/security/consent.ts
var DEFAULT_CONSENT_SETTINGS = {
  default_scope: DEFAULT_CONSENT_SCOPE,
  time_based_duration: "24h",
  topic_similarity_threshold: TOPIC_SIMILARITY_THRESHOLD,
  remembered_topics: [],
  conversation_timeout_minutes: CONVERSATION_TIMEOUT_MINUTES,
  require_explicit_for_sensitive: true
};
var DECLINE_MESSAGE = "I can't access your memories for this question. Without access, I can still help with general questions, writing assistance, and brainstorming ideas.";
function isConsentActive(state) {
  if (!state.granted) {
    return false;
  }
  if (state.expires_at) {
    return Date.now() < new Date(state.expires_at).getTime();
  }
  if (state.scope === "per_message") {
    return false;
  }
  return true;
}
function handleDecline(_user_id) {
  return {
    declined: true,
    available_actions: [...DECLINE_ACTIONS],
    previous_context_available: false,
    message: DECLINE_MESSAGE
  };
}
function cosineSimilarity2(a, b) {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i];
    const valB = b[i];
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }
  return dotProduct / denominator;
}
function checkTopicMatch(query_embedding, remembered_topics, threshold = TOPIC_SIMILARITY_THRESHOLD) {
  let bestMatch = null;
  let bestSimilarity = 0;
  for (const topic of remembered_topics) {
    const similarity = cosineSimilarity2(query_embedding, topic.topic_embedding);
    if (similarity >= threshold && similarity > bestSimilarity) {
      bestMatch = topic;
      bestSimilarity = similarity;
    }
  }
  return bestMatch;
}
async function requestConsent(_user_id, _memory_ids, _provider) {
  throw new Error("requestConsent requires server-side memory lookup implementation");
}
async function grantConsent(_user_id, _scope, _memory_ids) {
  throw new Error("grantConsent requires consent state persistence implementation");
}
async function checkConsent(_user_id, _query_embedding) {
  throw new Error("checkConsent requires consent state lookup implementation");
}
async function revokeConsent(_user_id, _request) {
  throw new Error("revokeConsent requires consent state update implementation");
}
async function getSharedMemories(_user_id, _conversation_id) {
  throw new Error("getSharedMemories requires shared memory tracking implementation");
}
async function updateConsentSettings(_user_id, _settings) {
  throw new Error("updateConsentSettings requires settings persistence implementation");
}

// src/security/api-keys.ts
var API_CALL_ROUTES = {
  platform: {
    key_type: "platform",
    flow: "proxied",
    rate_limited: true,
    usage_logged: true
  },
  byok: {
    key_type: "byok",
    flow: "direct",
    rate_limited: true,
    usage_logged: false
  }
};
var DEFAULT_BYOK_RATE_LIMIT = {
  max_decryptions_per_minute: BYOK_MAX_DECRYPTIONS_PER_MINUTE,
  exponential_backoff: true,
  lockout_after_failures: BYOK_LOCKOUT_AFTER_FAILURES,
  lockout_duration_minutes: BYOK_LOCKOUT_DURATION_MINUTES
};
function getApiCallRouteForKeyType(keyType) {
  return API_CALL_ROUTES[keyType];
}
async function encryptBYOKKey(_api_key, _encryption_key) {
  throw new Error("encryptBYOKKey requires Web Crypto API implementation");
}
async function decryptBYOKKey(_encrypted, _encryption_key) {
  throw new Error("decryptBYOKKey requires Web Crypto API implementation");
}
async function getApiCallRoute(_user_id, _provider) {
  throw new Error("getApiCallRoute requires server-side BYOK config lookup");
}
async function checkBYOKRateLimit(_user_id) {
  throw new Error("checkBYOKRateLimit requires rate limit state tracking");
}
function trackBYOKDecryption(_user_id, _success) {
  throw new Error("trackBYOKDecryption requires rate limit state tracking");
}
async function rotatePlatformKey(_provider) {
  throw new Error("rotatePlatformKey requires server-side key management");
}
async function getBYOKConfig(_user_id, _provider) {
  throw new Error("getBYOKConfig requires server-side BYOK storage");
}
async function storeBYOKKey(_user_id, _provider, _api_key, _tier) {
  throw new Error("storeBYOKKey requires Web Crypto API and server-side storage");
}
async function revokeBYOKKey(_user_id, _provider) {
  throw new Error("revokeBYOKKey requires server-side key deletion");
}

// src/security/compliance.ts
var THREAT_MODEL = [
  // === THREATS WE PROTECT AGAINST ===
  {
    threat: "random_hackers",
    protected_by_standard: true,
    protected_by_private: true,
    description: "TLS prevents MITM attacks. Server-side encryption (Standard) protects at rest. E2E (Private) protects even if servers breached."
  },
  {
    threat: "curious_employees",
    protected_by_standard: false,
    protected_by_private: true,
    description: "Standard: Employees could technically access data. Private: Employees CANNOT access (no keys)."
  },
  {
    threat: "data_breaches",
    protected_by_standard: true,
    protected_by_private: true,
    description: "Standard: Attacker gets encrypted data (Turso encryption). Private: Attacker gets doubly-encrypted data (useless)."
  },
  {
    threat: "legal_subpoenas",
    protected_by_standard: false,
    protected_by_private: true,
    description: "Standard: We must comply if legally compelled. Private: We literally cannot comply (no keys)."
  },
  // === THREATS WE DO NOT PROTECT AGAINST ===
  {
    threat: "device_malware",
    protected_by_standard: false,
    protected_by_private: false,
    description: "If attacker controls your device, game over. We cannot protect against keyloggers, screen capture."
  },
  {
    threat: "user_error",
    protected_by_standard: false,
    protected_by_private: false,
    description: "Sharing recovery code, weak device passcode, etc. We provide warnings but cannot prevent."
  },
  {
    threat: "state_level_actors",
    protected_by_standard: false,
    protected_by_private: false,
    description: "Rubber-hose cryptanalysis (coercion), advanced forensics on device. Recommendation: Do not be a nation-state target."
  },
  {
    threat: "llm_provider",
    protected_by_standard: false,
    protected_by_private: false,
    description: "When you send data to Claude/GPT, that provider sees it. We show consent dialog, but cannot control their servers."
  }
];
var EXPORT_COMPLIANCE_BY_REGION = [
  {
    region: "us",
    standard_tier: "exempt",
    private_tier: "requires_documentation",
    documentation_required: [
      "ECCN 5D992 self-classification",
      "Mass market exemption (License Exception ENC \xA7740.17)",
      "Annual self-classification report to BIS"
    ],
    notes: "Private tier uses AES-256-GCM (proprietary encryption). ~2 business days Apple review."
  },
  {
    region: "general",
    standard_tier: "exempt",
    private_tier: "requires_documentation",
    documentation_required: [
      "ECCN 5D992 self-classification",
      "Mass market exemption (License Exception ENC \xA7740.17)",
      "Annual self-classification report to BIS"
    ],
    notes: "Most markets follow US export rules. Standard tier uses TLS/HTTPS only (OS-provided), ITSAppUsesNonExemptEncryption = NO."
  },
  {
    region: "france",
    standard_tier: "exempt",
    private_tier: "excluded",
    documentation_required: [
      "ECCN 5D992 self-classification",
      "French encryption declaration (ANSSI)",
      "Additional 1-month review period"
    ],
    notes: "France requires additional encryption declaration with ~1 month review. Recommendation: Exclude France at launch, add after approval."
  }
];
var LAUNCH_STRATEGY = [
  {
    version: "v1.0",
    features: ["Standard tier only", "Clerk auth", "Cloud search", "Seamless LLM"],
    markets: ["All markets"],
    compliance_requirements: ["No encryption documentation required", "ITSAppUsesNonExemptEncryption = NO"]
  },
  {
    version: "v1.1",
    features: [
      "Add Private tier",
      "E2E encryption (AES-256-GCM)",
      "Client-side HNSW search",
      "LLM consent dialogs",
      "Passkey-derived key hierarchy",
      "Recovery codes (BIP39)"
    ],
    markets: ["US", "Most international markets"],
    compliance_requirements: [
      "ECCN 5D992 self-classification filed",
      "Mass market exemption (License Exception ENC \xA7740.17)",
      "Annual BIS self-classification report",
      "ITSAppUsesNonExemptEncryption = YES",
      "Google Play encryption declaration"
    ]
  },
  {
    version: "v1.2",
    features: ["Add France support for Private tier"],
    markets: ["France (Private tier)"],
    compliance_requirements: [
      "French encryption declaration (ANSSI) approved",
      "All v1.1 requirements maintained"
    ]
  }
];
var APP_STORE_DECLARATIONS = {
  standard_only: [
    { platform: "ios", uses_non_exempt_encryption: false, self_classification_filed: false },
    { platform: "android", uses_non_exempt_encryption: false, self_classification_filed: false },
    { platform: "macos", uses_non_exempt_encryption: false, self_classification_filed: false },
    { platform: "windows", uses_non_exempt_encryption: false, self_classification_filed: false }
  ],
  with_private_tier: [
    { platform: "ios", uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true },
    { platform: "android", uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true },
    { platform: "macos", uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true },
    { platform: "windows", uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true }
  ]
};
function getComplianceRequirements(tier, region) {
  const config = EXPORT_COMPLIANCE_BY_REGION.find((c) => c.region === region);
  if (config) {
    return config;
  }
  const general = EXPORT_COMPLIANCE_BY_REGION.find((c) => c.region === "general");
  return general;
}
function getThreatModel() {
  return [...THREAT_MODEL];
}
function getLaunchStrategy() {
  return [...LAUNCH_STRATEGY];
}
function isRegionSupported(region, tier) {
  const config = EXPORT_COMPLIANCE_BY_REGION.find((c) => c.region === region);
  if (!config) {
    return true;
  }
  if (tier === "standard") {
    return config.standard_tier !== "excluded";
  }
  return config.private_tier !== "excluded";
}
function getAppStoreDeclaration(platform, includes_private_tier) {
  const declarations = includes_private_tier ? APP_STORE_DECLARATIONS.with_private_tier : APP_STORE_DECLARATIONS.standard_only;
  const declaration = declarations.find((d) => d.platform === platform);
  return declaration;
}
function getProtectedThreats(tier) {
  return THREAT_MODEL.filter(
    (entry) => tier === "standard" ? entry.protected_by_standard : entry.protected_by_private
  );
}
function getUnprotectedThreats(tier) {
  return THREAT_MODEL.filter(
    (entry) => tier === "standard" ? !entry.protected_by_standard : !entry.protected_by_private
  );
}

// src/security/offline.ts
var OFFLINE_STATE_CONFIGS = {
  online: {
    state: "online",
    max_hours: Infinity,
    functionality: "full",
    sync_behavior: "realtime",
    auth_behavior: "JWT valid, full access, real-time sync",
    private_tier_key_access: true
  },
  short_offline: {
    state: "short_offline",
    max_hours: OFFLINE_THRESHOLDS.short_offline,
    functionality: "full",
    sync_behavior: "queued",
    auth_behavior: "JWT still valid (<24h), full functionality, writes queued for sync",
    private_tier_key_access: true
  },
  medium_offline: {
    state: "medium_offline",
    max_hours: OFFLINE_THRESHOLDS.medium_offline,
    functionality: "read_write_queued",
    sync_behavior: "paused",
    auth_behavior: "JWT expired, refresh token still valid (<7d), read + queued writes, sync paused",
    private_tier_key_access: true
  },
  long_offline: {
    state: "long_offline",
    max_hours: Infinity,
    functionality: "local_only",
    sync_behavior: "none",
    auth_behavior: "Refresh token expired (>7d), local data only, no sync capability",
    private_tier_key_access: true
  },
  reauth_required: {
    state: "reauth_required",
    max_hours: 0,
    functionality: "read_only",
    sync_behavior: "none",
    auth_behavior: "Must reconnect and re-authenticate to restore full functionality",
    private_tier_key_access: true
  }
};
function getOfflineStateConfig(state) {
  return OFFLINE_STATE_CONFIGS[state];
}
function calculateOfflineState(last_online, tokens) {
  const lastOnlineMs = new Date(last_online).getTime();
  const hoursSinceOnline = (Date.now() - lastOnlineMs) / (1e3 * 60 * 60);
  if (hoursSinceOnline < 0.01) {
    return "online";
  }
  const tokenValid = Date.now() < new Date(tokens.expires_at).getTime();
  if (hoursSinceOnline < OFFLINE_THRESHOLDS.short_offline && tokenValid) {
    return "short_offline";
  }
  if (hoursSinceOnline < OFFLINE_THRESHOLDS.medium_offline) {
    return "medium_offline";
  }
  return "long_offline";
}
function getOfflineCapabilities(state, tier) {
  OFFLINE_STATE_CONFIGS[state];
  switch (state) {
    case "online":
      return {
        can_read: true,
        can_write: true,
        can_search: true,
        can_sync: true,
        can_use_llm: true,
        reason: "Full connectivity - all features available"
      };
    case "short_offline":
      return {
        can_read: true,
        can_write: true,
        can_search: tier === "private",
        // Private has local search; Standard needs cloud
        can_sync: false,
        // Writes are queued
        can_use_llm: false,
        reason: `Offline <${OFFLINE_THRESHOLDS.short_offline}h - JWT valid, writes queued for sync`
      };
    case "medium_offline":
      return {
        can_read: true,
        can_write: true,
        // Writes are queued
        can_search: tier === "private",
        can_sync: false,
        can_use_llm: false,
        reason: `Offline <${OFFLINE_THRESHOLDS.medium_offline}h - JWT expired, read + queued writes`
      };
    case "long_offline":
      return {
        can_read: true,
        can_write: false,
        can_search: tier === "private",
        can_sync: false,
        can_use_llm: false,
        reason: `Offline >${OFFLINE_THRESHOLDS.medium_offline}h - local data only`
      };
    case "reauth_required":
      return {
        can_read: true,
        can_write: false,
        can_search: tier === "private",
        can_sync: false,
        can_use_llm: false,
        reason: "Re-authentication required to restore full functionality"
      };
  }
}
async function queueOfflineOperation(_operation) {
  throw new Error("queueOfflineOperation requires persistent queue storage implementation");
}
async function processOfflineQueue() {
  throw new Error("processOfflineQueue requires network and database adapter implementation");
}
async function getQueueSize() {
  throw new Error("getQueueSize requires persistent queue storage implementation");
}
var THOROUGHNESS_LEVELS = ["quick", "balanced", "deep"];
var ThoroughnessLevelSchema = z.enum(THOROUGHNESS_LEVELS);
function isThoroughnessLevel(value) {
  return THOROUGHNESS_LEVELS.includes(value);
}
var THOROUGHNESS_MULTIPLIERS = {
  quick: 0.5,
  balanced: 1,
  deep: 2
};
var ThoroughnessMultipliersSchema = z.record(
  ThoroughnessLevelSchema,
  z.number().positive()
);
var DEFAULT_THOROUGHNESS = "balanced";
var BUDGET_MODES = ["cold_start", "adaptive"];
var BudgetModeSchema = z.enum(BUDGET_MODES);
function isBudgetMode(value) {
  return BUDGET_MODES.includes(value);
}
var BUDGET_EXHAUSTION_REASONS = [
  "time_exhausted",
  "node_limit_reached",
  "api_calls_exhausted"
];
var BudgetExhaustionReasonSchema = z.enum(BUDGET_EXHAUSTION_REASONS);
function isBudgetExhaustionReason(value) {
  return BUDGET_EXHAUSTION_REASONS.includes(value);
}
var SERENDIPITY_MIN_CANDIDATES = 3;
var SERENDIPITY_PERCENTILE = 0.1;
var SERENDIPITY_MAX_CANDIDATES = 15;
var ABS_SCHEMA_VERSION = 1;
var QUERY_TYPE_TO_QUALITY_KEY = {
  factual: "LOOKUP",
  list: "REASONING",
  exploratory: "EXPLORATORY",
  temporal: "TEMPORAL",
  procedural: "REASONING"
};
var QUERY_TYPE_TO_OPERATION_KEY = {
  factual: "simple_lookup",
  list: "standard_query",
  exploratory: "complex_query",
  temporal: "standard_query",
  procedural: "complex_query"
};
var QUALITY_KEY_TO_PARAMS_QUERY_TYPE = {
  LOOKUP: "simple",
  REASONING: "standard",
  EXPLORATORY: "complex",
  TEMPORAL: "standard"
};
var AdaptiveBudgetRequestSchema = z.object({
  graph_metrics: GraphMetricsSchema,
  query_type: z.string(),
  thoroughness: ThoroughnessLevelSchema.optional(),
  operation: z.string().optional()
});
var BudgetExplanationSchema = z.object({
  mode: BudgetModeSchema,
  entry_points_reason: z.string(),
  hops_reason: z.string(),
  node_limit_reason: z.string(),
  time_limit_reason: z.string()
});
var AdaptiveBudgetResultSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  budget: z.object({
    time_ms: z.number().nonnegative(),
    max_nodes: z.number().int().nonnegative(),
    max_api_calls: z.number().int().nonnegative()
  }),
  limits: z.object({
    entry_points: z.number().int().positive(),
    max_hops: z.number().int().positive(),
    max_nodes: z.number().int().nonnegative()
  }),
  quality_target: z.object({
    confidence: z.number().min(0).max(1),
    min_coverage: z.number().min(0).max(1)
  }),
  thoroughness_applied: ThoroughnessLevelSchema,
  is_cold_start: z.boolean(),
  explanation: BudgetExplanationSchema
});
var BudgetExhaustionResultSchema = z.object({
  exhausted_resource: BudgetExhaustionReasonSchema,
  quality_achieved: z.number().min(0).max(1),
  quality_target: z.number().min(0).max(1),
  coverage_achieved: z.number().min(0).max(1),
  partial: z.literal(true),
  explanation: z.string().min(1),
  suggestion: z.string().min(1)
});
var ScaledSerendipityConfigSchema = z.object({
  min_candidates: z.number().int().positive(),
  percentile_threshold: z.number().min(0).max(1),
  max_candidates: z.number().int().positive()
});
var AdaptiveEvolutionThresholdsSchema = z.object({
  emerge_threshold: z.number().positive(),
  split_threshold: z.number().positive(),
  serendipity_candidates: z.number().int().nonnegative(),
  is_cold_start: z.boolean()
});
var ABSConfigSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  thoroughness_multipliers: z.record(
    ThoroughnessLevelSchema,
    z.number().positive()
  ),
  serendipity: ScaledSerendipityConfigSchema,
  cold_start_threshold: z.number().int().positive()
});
var DEFAULT_ABS_CONFIG = {
  _schemaVersion: ABS_SCHEMA_VERSION,
  thoroughness_multipliers: { ...THOROUGHNESS_MULTIPLIERS },
  serendipity: {
    min_candidates: SERENDIPITY_MIN_CANDIDATES,
    percentile_threshold: SERENDIPITY_PERCENTILE,
    max_candidates: SERENDIPITY_MAX_CANDIDATES
  },
  cold_start_threshold: 200
};
function isAdaptiveBudgetRequest(value) {
  return AdaptiveBudgetRequestSchema.safeParse(value).success;
}
function isAdaptiveBudgetResult(value) {
  return AdaptiveBudgetResultSchema.safeParse(value).success;
}
function isBudgetExhaustionResult(value) {
  return BudgetExhaustionResultSchema.safeParse(value).success;
}
function isABSConfig(value) {
  return ABSConfigSchema.safeParse(value).success;
}

// src/adaptive-limits/index.ts
function mapRetrievalQueryType(retrievalQueryType) {
  return QUERY_TYPE_TO_QUALITY_KEY[retrievalQueryType] ?? "REASONING";
}
function mapToOperationBudgetKey(retrievalQueryType, isPhase2) {
  if (isPhase2) return "phase2_reasoning";
  return QUERY_TYPE_TO_OPERATION_KEY[retrievalQueryType] ?? "standard_query";
}
function mapToParamsQueryType(qualityTargetKey) {
  const mapped = QUALITY_KEY_TO_PARAMS_QUERY_TYPE[qualityTargetKey];
  return mapped ?? "standard";
}
function applyThoroughness(budget, thoroughness) {
  const multiplier = THOROUGHNESS_MULTIPLIERS[thoroughness];
  return {
    time_ms: Math.round(budget.time_ms * multiplier),
    max_nodes: Math.round(budget.max_nodes * multiplier),
    max_api_calls: budget.max_api_calls
  };
}
function buildExplanation(limits, budget, graphSize, graphDensity, isColdStart) {
  if (isColdStart) {
    return {
      mode: "cold_start",
      entry_points_reason: `${limits.entry_points} entry points (cold-start mode)`,
      hops_reason: `${limits.max_hops} hops (cold-start mode)`,
      node_limit_reason: `${limits.max_nodes} nodes (cold-start, ${graphSize} total)`,
      time_limit_reason: `${budget.time_ms}ms (budget with thoroughness)`
    };
  }
  let densityLabel;
  if (graphDensity < 1e-3) densityLabel = "very sparse";
  else if (graphDensity < 0.01) densityLabel = "sparse";
  else if (graphDensity < 0.05) densityLabel = "medium density";
  else densityLabel = "dense";
  return {
    mode: "adaptive",
    entry_points_reason: `${limits.entry_points} entry points (log10 of ${graphSize.toLocaleString()} nodes)`,
    hops_reason: `${limits.max_hops} hops (${densityLabel} graph, density ${graphDensity})`,
    node_limit_reason: `${limits.max_nodes} nodes of ${graphSize.toLocaleString()} total`,
    time_limit_reason: `${budget.time_ms}ms (budget with thoroughness)`
  };
}
function calculateAdaptiveBudget(request) {
  const thoroughness = request.thoroughness ?? DEFAULT_THOROUGHNESS;
  const operationKey = request.operation ?? mapToOperationBudgetKey(request.query_type, false);
  const baseBudget = getBudgetForOperation(operationKey);
  const budget = applyThoroughness(baseBudget, thoroughness);
  const paramsQT = mapToParamsQueryType(request.query_type);
  const limits = calculateAdaptiveLimits(
    request.graph_metrics.total_nodes,
    request.graph_metrics.density,
    paramsQT
  );
  const qualityTarget = getQualityTargetForQueryType(request.query_type);
  const isColdStart = request.graph_metrics.total_nodes < COLD_START_THRESHOLD;
  const explanation = buildExplanation(
    limits,
    budget,
    request.graph_metrics.total_nodes,
    request.graph_metrics.density,
    isColdStart
  );
  return {
    _schemaVersion: ABS_SCHEMA_VERSION,
    budget,
    limits,
    quality_target: qualityTarget,
    thoroughness_applied: thoroughness,
    is_cold_start: isColdStart,
    explanation
  };
}
function handleBudgetExhaustion(reason, qualityAchieved, qualityTarget, coverageAchieved) {
  const achievedPct = Math.round(qualityAchieved * 100);
  const targetPct = Math.round(qualityTarget * 100);
  let explanation;
  let suggestion;
  switch (reason) {
    case "time_exhausted":
      explanation = `Reached time limit with ${achievedPct}% confidence (target: ${targetPct}%)`;
      suggestion = 'Try "Search deeper" to explore more';
      break;
    case "node_limit_reached":
      explanation = `Searched maximum nodes with ${achievedPct}% confidence (target: ${targetPct}%)`;
      suggestion = 'Try being more specific or use "Search deeper"';
      break;
    case "api_calls_exhausted":
      explanation = `Used all API calls with ${achievedPct}% confidence (target: ${targetPct}%)`;
      suggestion = "Try a simpler query or increase thoroughness";
      break;
  }
  return {
    exhausted_resource: reason,
    quality_achieved: qualityAchieved,
    quality_target: qualityTarget,
    coverage_achieved: coverageAchieved,
    partial: true,
    explanation,
    suggestion
  };
}
function scaleSerendipity(graphSize, level) {
  if (level === "off") return 0;
  const thresholds = SERENDIPITY_THRESHOLDS[level];
  const levelCount = thresholds.count;
  const scaledCount = Math.floor(graphSize * SERENDIPITY_PERCENTILE);
  return Math.max(
    SERENDIPITY_MIN_CANDIDATES,
    Math.min(levelCount, scaledCount, SERENDIPITY_MAX_CANDIDATES)
  );
}
function getAdaptiveEvolutionThresholds(graphSize, learning) {
  const emergeThreshold = calculateEmergeThreshold(graphSize, void 0, learning);
  const splitThreshold = calculateSplitThreshold(graphSize, void 0, learning);
  const serendipityCandidates = scaleSerendipity(graphSize, "medium");
  const isColdStart = graphSize < COLD_START_THRESHOLD;
  return {
    emerge_threshold: emergeThreshold,
    split_threshold: splitThreshold,
    serendipity_candidates: serendipityCandidates,
    is_cold_start: isColdStart
  };
}
function explainBudget(result) {
  if (result.is_cold_start) {
    return `Using fixed limits for small graph. Searching up to ${result.limits.max_nodes} nodes.`;
  }
  const confidencePct = Math.round(result.quality_target.confidence * 100);
  return `Searching up to ${result.limits.max_nodes} nodes across ${result.limits.entry_points} entry points (${confidencePct}% confidence target).`;
}
var NPL_PROMPT_IDS = [
  "P-001",
  "P-002",
  "P-002C",
  "P-003",
  "P-004",
  "P-005",
  "P-006",
  "P-007",
  "P-008",
  "P-009",
  "P-010",
  "P-010B",
  "P-011"
];
var NplPromptIdSchema = z.enum(NPL_PROMPT_IDS);
var NPL_CACHE_STRATEGIES = ["global", "per_user", "none"];
var NplCacheStrategySchema = z.enum(NPL_CACHE_STRATEGIES);
var NPL_ERROR_TYPES = [
  "MALFORMED_INPUT",
  "INSUFFICIENT_CONTEXT",
  "AMBIGUOUS_REQUEST",
  "CONTENT_TOO_LONG"
];
var NplErrorTypeSchema = z.enum(NPL_ERROR_TYPES);
var NPL_QUERY_CLASSIFICATIONS = ["RETRIEVAL", "DIRECT_TASK", "CHAT"];
var NplQueryClassificationSchema = z.enum(NPL_QUERY_CLASSIFICATIONS);
var NPL_DISQUALIFIER_CODES = [
  "reasoning_required",
  "temporal_reference",
  "compound_query",
  "negation",
  "unresolved_pronoun",
  "exploration",
  "needs_current_data"
];
var NplDisqualifierCodeSchema = z.enum(NPL_DISQUALIFIER_CODES);
var NPL_EXTRACTION_NODE_TYPES = [
  "FACT",
  "EVENT",
  "NOTE",
  "IDEA",
  "TASK",
  "REFERENCE"
];
var NplExtractionNodeTypeSchema = z.enum(NPL_EXTRACTION_NODE_TYPES);
var NPL_CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"];
var NplConfidenceLevelSchema = z.enum(NPL_CONFIDENCE_LEVELS);
var NPL_CONTRADICTION_RECOMMENDATIONS = [
  "auto_supersede",
  "queue_for_user",
  "keep_both"
];
var NplContradictionRecommendationSchema = z.enum(NPL_CONTRADICTION_RECOMMENDATIONS);
var NPL_CONTRADICTION_RELATIONSHIPS = [
  "contradicts",
  "updates",
  "evolves",
  "coexists",
  "unrelated"
];
var NplContradictionRelationshipSchema = z.enum(NPL_CONTRADICTION_RELATIONSHIPS);
var NPL_CACHEABLE_PROMPT_TYPES = ["classifier", "extractor", "responder"];
var NplCacheablePromptTypeSchema = z.enum(NPL_CACHEABLE_PROMPT_TYPES);
var NplModelRecommendationSchema = z.object({
  primary: z.string(),
  fallback: z.string(),
  temperature: z.number().min(0).max(2)
});
var NPL_MODEL_RECOMMENDATIONS = {
  "P-001": { primary: "gemini-2.0-flash-lite", fallback: "gpt-4o-mini", temperature: 0 },
  "P-002": { primary: "gpt-4o-mini", fallback: "claude-3-haiku", temperature: 0 },
  "P-002C": { primary: "gpt-4o-mini", fallback: "claude-3-haiku", temperature: 0.3 },
  "P-003": { primary: "gpt-4o-mini", fallback: "claude-sonnet-4", temperature: 0 },
  "P-004": { primary: "gpt-4o-mini", fallback: "claude-3-haiku", temperature: 0 },
  "P-005": { primary: "claude-3-haiku", fallback: "gpt-4o-mini", temperature: 0 },
  "P-006": { primary: "claude-3-haiku", fallback: "gpt-4o-mini", temperature: 0 },
  "P-007": { primary: "claude-sonnet-4", fallback: "gpt-4o", temperature: 0.3 },
  "P-008": { primary: "claude-sonnet-4", fallback: "gpt-4o", temperature: 0.5 },
  "P-009": { primary: "claude-sonnet-4", fallback: "gpt-4o", temperature: 0 },
  "P-010": { primary: "claude-sonnet-4", fallback: "gpt-4o", temperature: 0 },
  "P-010B": { primary: "claude-sonnet-4", fallback: "gpt-4o", temperature: 0 },
  "P-011": { primary: "claude-3-haiku", fallback: "gpt-4o-mini", temperature: 0 }
};
var NPL_CACHE_CONFIGS = {
  "P-001": "global",
  "P-002": "global",
  "P-002C": "global",
  "P-003": "global",
  "P-004": "global",
  "P-005": "global",
  "P-006": "global",
  "P-007": "global",
  "P-008": "per_user",
  "P-009": "global",
  "P-010": "global",
  "P-010B": "global",
  "P-011": "global"
};
var NplTokenBudgetSchema = z.object({
  system: z.number().int().nonnegative(),
  userBase: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  typicalTotal: z.number().int().positive()
});
var NPL_TOKEN_BUDGETS = {
  "P-001": { system: 450, userBase: 50, output: 120, typicalTotal: 650 },
  "P-002": { system: 550, userBase: 80, output: 180, typicalTotal: 850 },
  "P-002C": { system: 100, userBase: 80, output: 100, typicalTotal: 280 },
  "P-003": { system: 500, userBase: 100, output: 250, typicalTotal: 1200 },
  "P-004": { system: 200, userBase: 100, output: 150, typicalTotal: 500 },
  "P-005": { system: 300, userBase: 100, output: 250, typicalTotal: 1650 },
  "P-006": { system: 300, userBase: 200, output: 200, typicalTotal: 800 },
  "P-007": { system: 350, userBase: 100, output: 400, typicalTotal: 2e3 },
  "P-008": { system: 2500, userBase: 0, output: 0, typicalTotal: 3500 },
  "P-009": { system: 1e3, userBase: 150, output: 350, typicalTotal: 1600 },
  "P-010": { system: 300, userBase: 200, output: 150, typicalTotal: 650 },
  "P-010B": { system: 200, userBase: 150, output: 100, typicalTotal: 450 },
  "P-011": { system: 250, userBase: 300, output: 200, typicalTotal: 700 }
};
var NPL_PROMPT_VERSIONS = {
  "P-001": "1.1.0",
  "P-002": "1.2.0",
  "P-002C": "1.0.0",
  "P-003": "1.1.0",
  "P-004": "1.1.0",
  "P-005": "1.1.0",
  "P-006": "1.1.0",
  "P-007": "1.1.0",
  "P-008": "2.0.0",
  "P-009": "1.1.0",
  "P-010": "1.1.0",
  "P-010B": "1.0.0",
  "P-011": "1.1.0"
};
var NPL_PROMPT_TO_OPERATION = {
  "P-001": "classification",
  "P-002": "classification",
  "P-002C": "quick_response",
  "P-003": "extraction_simple",
  "P-004": "extraction_simple",
  "P-005": "graph_cot",
  "P-006": "graph_cot",
  "P-007": "graph_cot",
  "P-008": "standard_response",
  "P-009": "deep_thinking",
  "P-010": "standard_response",
  "P-010B": "standard_response",
  "P-011": "extraction_simple"
};
var NPL_PROMPT_TO_CACHE_TYPE = {
  "P-001": "classifier",
  "P-002": "classifier",
  "P-002C": "classifier",
  "P-003": "extractor",
  "P-004": "extractor",
  "P-005": "extractor",
  "P-006": "extractor",
  "P-007": "responder",
  "P-008": "responder",
  "P-009": "responder",
  "P-010": "responder",
  "P-010B": "responder",
  "P-011": "responder"
};
var NPL_DISQUALIFIER_TO_QCS_CODE = {
  reasoning_required: "D1",
  negation: "D2",
  temporal_reference: "D3",
  compound_query: "D4",
  unresolved_pronoun: "D5",
  exploration: "D6",
  needs_current_data: "D6"
  // Mapped to D6 (exploration-adjacent)
};
var NPL_CONFIDENCE_LEVEL_SCORES = {
  HIGH: 0.9,
  MEDIUM: 0.6,
  LOW: 0.3
};
var NPL_EXTRACTION_CONTENT_LIMITS = {
  /** Target content range (characters) */
  target: { min: 500, max: 2e3 },
  /** Soft maximum — acceptable if semantically coherent */
  softMax: 3e3,
  /** Hard maximum — force split at sentence boundary */
  hardMax: 5e3
};
var NPL_P008_TOKEN_BUDGET = {
  /** Core system prompt (13 sections) */
  corePrompt: 2500,
  /** Dynamic context customization section */
  contextCustomization: 200,
  /** Retrieved context injection */
  retrievedContext: 500,
  /** Conversation history */
  conversationHistory: 300,
  /** First call total (before caching) */
  firstCall: 3500,
  /** Subsequent calls (system prompt cached) */
  subsequentCalls: 1e3,
  /** Cache read cost factor (90% savings) */
  cachedCostFactor: 0.1
};
var NPL_AUTO_SUPERSEDE_THRESHOLDS = {
  /** Minimum Tier 3 (P-010) confidence for auto-supersede */
  tier3MinConfidence: 0.8,
  /** Required Tier 3 relationship for auto-supersede */
  tier3RequiredRelationship: "contradicts",
  /** Minimum Tier 4 (P-010B) confidence for auto-supersede */
  tier4MinConfidence: 0.7,
  /** Tier 4 must have zero concerns */
  tier4MaxConcerns: 0
};
var NPL_PROMPT_NAMES = {
  "P-001": "Query Classification",
  "P-002": "Intent Extraction",
  "P-002C": "Intent Clarification",
  "P-003": "Node Extraction",
  "P-004": "Edge Relationship",
  "P-005": "Orient (Phase 2)",
  "P-006": "Explore (Phase 2)",
  "P-007": "Synthesize (Phase 2)",
  "P-008": "Chat System",
  "P-009": "Agent Reasoning",
  "P-010": "Contradiction Detection",
  "P-010B": "Contradiction Verification",
  "P-011": "Memory Compression"
};
var NPL_PROMPT_INTEGRATIONS = {
  "P-001": ["storm-008"],
  "P-002": ["storm-014"],
  "P-002C": ["storm-014"],
  "P-003": ["storm-014", "storm-011"],
  "P-004": ["storm-011", "storm-031"],
  "P-005": ["storm-003"],
  "P-006": ["storm-003"],
  "P-007": ["storm-003"],
  "P-008": ["storm-015", "storm-020"],
  "P-009": ["storm-019"],
  "P-010": ["storm-009"],
  "P-010B": ["storm-009"],
  "P-011": ["storm-007"]
};
var NplPromptMetadataSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  id: NplPromptIdSchema,
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  lastUpdated: z.string(),
  integratesWith: z.array(z.string()),
  testedModels: z.array(z.string()),
  temperature: z.number().min(0).max(2),
  cacheStrategy: NplCacheStrategySchema
});
var NplPromptErrorSchema = z.object({
  error: z.literal(true),
  errorType: NplErrorTypeSchema,
  errorMessage: z.string(),
  suggestion: z.string()
});
var NplQueryClassificationResultSchema = z.object({
  classification: NplQueryClassificationSchema,
  memoryQueryScore: z.number().min(0).max(1),
  directTaskScore: z.number().min(0).max(1),
  contextMissingScore: z.number().min(0).max(1),
  disqualifiers: z.array(NplDisqualifierCodeSchema),
  reasoning: z.string()
});
var NplEntitySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["person", "place", "thing", "concept", "event", "organization"])
});
var NplTemporalRefSchema = z.object({
  hasReference: z.boolean(),
  parsed: z.string().nullable(),
  relative: z.string().nullable()
});
var NplIntentExtractionResultSchema = z.object({
  intent: z.string(),
  confidence: z.number().min(0).max(1),
  isExplicit: z.boolean(),
  secondaryIntent: z.string().nullable(),
  secondaryConfidence: z.number().min(0).max(1).nullable(),
  retrievalMode: z.enum(["direct", "summarize", "compare"]).nullable(),
  multiIntentPattern: z.string().nullable(),
  executionOrder: z.array(z.string()),
  entities: z.array(NplEntitySchema),
  temporal: NplTemporalRefSchema,
  saveSignal: z.enum(["explicit", "implicit", "none"]),
  actionVerbsDetected: z.array(z.string()),
  reasoning: z.string()
});
var NplClarificationOptionSchema = z.object({
  label: z.string().min(1),
  impliesIntent: z.string()
});
var NplClarificationResultSchema = z.object({
  clarification: z.string().min(1),
  options: z.array(NplClarificationOptionSchema).min(2).max(4),
  fallbackIntent: z.string()
});
var NplExtractedEntitySchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  isNew: z.boolean()
});
var NplExtractionTemporalSchema = z.object({
  occurredAt: z.string().nullable(),
  relativeText: z.string().nullable(),
  isRecurring: z.boolean()
});
var NplSuggestedEdgeSchema = z.object({
  targetHint: z.string().min(1),
  relation: z.string().min(1)
});
var NplExtractedNodeSchema = z.object({
  content: z.string().min(1),
  type: NplExtractionNodeTypeSchema,
  title: z.string().min(1).max(50),
  entities: z.array(NplExtractedEntitySchema),
  temporal: NplExtractionTemporalSchema,
  suggestedEdges: z.array(NplSuggestedEdgeSchema),
  confidence: z.number().min(0).max(1)
});
var NplNodeExtractionResultSchema = z.object({
  nodes: z.array(NplExtractedNodeSchema),
  extractionNotes: z.string()
});
var NplDetectedEdgeSchema = z.object({
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  edgeType: z.string().min(1),
  description: z.string(),
  weight: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1)
});
var NplEdgeRelationshipResultSchema = z.object({
  edges: z.array(NplDetectedEdgeSchema),
  analysisNotes: z.string()
});
var NplEntryPointSchema = z.object({
  nodeId: z.string().min(1),
  reason: z.string().min(1),
  expectedDirection: z.string()
});
var NplOrientResultSchema = z.object({
  entryPoints: z.array(NplEntryPointSchema).min(1).max(3),
  explorationStrategy: z.string(),
  conceptMapQuality: z.enum(["good", "sparse", "poor"]),
  qualityNotes: z.string().nullable()
});
var NplExplorationStepSchema = z.object({
  nodeId: z.string().min(1),
  fromEdge: z.string(),
  finding: z.string(),
  shouldContinue: z.boolean(),
  reason: z.string()
});
var NplExploreResultSchema = z.object({
  steps: z.array(NplExplorationStepSchema),
  findings: z.array(z.string()),
  shouldContinueExploring: z.boolean(),
  stopReason: z.string().nullable()
});
var NplSourceRefSchema = z.object({
  nodeId: z.string().min(1),
  whyUsed: z.string().min(1)
});
var NplSynthesizeResultSchema = z.object({
  answer: z.string().min(1),
  sources: z.array(NplSourceRefSchema),
  confidence: NplConfidenceLevelSchema,
  confidenceScore: z.number().min(0).max(1),
  confidenceReason: z.string(),
  answerCompleteness: z.enum(["complete", "partial", "uncertain"]),
  followUpSuggestions: z.array(z.string()),
  informationGaps: z.array(z.string())
});
var NplAgentStepSchema = z.object({
  step: z.number().int().positive(),
  tool: z.string().min(1),
  params: z.record(z.unknown()),
  reason: z.string()
});
var NplAgentPlanSchema = z.object({
  understanding: z.string().min(1),
  plan: z.array(NplAgentStepSchema).min(1),
  needsConfirmation: z.boolean(),
  confirmationReason: z.string().nullable(),
  alternativeInterpretation: z.string().nullable()
});
var NplContradictionDetectionResultSchema = z.object({
  relationship: NplContradictionRelationshipSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  whichIsCurrent: z.enum(["old", "new", "both", "unclear"]),
  bothCouldBeTrue: z.boolean(),
  isTimeDependent: z.boolean(),
  needsUserInput: z.boolean()
});
var NplVerificationResultSchema = z.object({
  shouldSupersede: z.boolean(),
  confidence: z.number().min(0).max(1),
  concerns: z.array(z.string()),
  recommendation: NplContradictionRecommendationSchema
});
var NplCompressionResultSchema = z.object({
  summary: z.string().min(1),
  title: z.string().min(1),
  keyPoints: z.array(z.string()).min(1),
  sourceCount: z.number().int().positive(),
  timeframe: z.string(),
  topic: z.string(),
  relatedConceptsCount: z.number().int().nonnegative()
});
var NplTermEntrySchema = z.object({
  term: z.string().min(1),
  expansion: z.string().min(1)
});
var NplContextCustomizationSchema = z.object({
  tone: z.enum(["formal", "casual", "neutral"]),
  verbosity: z.enum(["concise", "detailed", "adaptive"]),
  retrievalScope: z.enum(["all", "this_only"]),
  contextName: z.string().nullable(),
  terminology: z.array(NplTermEntrySchema).nullable()
});
var NplPromptTemplateSchema = z.object({
  metadata: NplPromptMetadataSchema,
  systemMessage: z.string().min(1),
  userTemplate: z.string().min(1),
  examples: z.array(z.object({
    input: z.string(),
    output: z.string()
  }))
});
var NplPromptExampleSchema = z.object({
  input: z.string(),
  output: z.string()
});
function nplConfidenceLevelToScore(level) {
  const scores = {
    HIGH: 0.9,
    MEDIUM: 0.6,
    LOW: 0.3
  };
  return scores[level];
}
function nplScoreToConfidenceLevel(score) {
  if (score >= 0.75) return "HIGH";
  if (score >= 0.45) return "MEDIUM";
  return "LOW";
}
function nplBuildContextCustomization(preferences) {
  const parts = [];
  if (preferences.tone === "formal") {
    parts.push("TONE: Professional and precise. Use complete sentences. Avoid contractions. Be thorough in explanations.");
  } else if (preferences.tone === "casual") {
    parts.push("TONE: Friendly and conversational. Contractions are fine. Keep things simple and approachable.");
  }
  if (preferences.verbosity === "concise") {
    parts.push("VERBOSITY: Be brief. Bullet points preferred. Max 2-3 sentences for simple questions. Only elaborate if asked.");
  } else if (preferences.verbosity === "detailed") {
    parts.push("VERBOSITY: Be thorough. Provide context and examples. Use headers for complex answers. Explain your reasoning.");
  }
  if (preferences.retrievalScope === "this_only" && preferences.contextName) {
    parts.push(`SCOPE: Only search within the "${preferences.contextName}" context space.`);
  }
  if (preferences.terminology && preferences.terminology.length > 0) {
    parts.push("TERMINOLOGY:");
    for (const entry of preferences.terminology) {
      parts.push(`- "${entry.term}" means "${entry.expansion}"`);
    }
  }
  return parts.join("\n");
}
function nplShouldAutoSupersede(tier3Result, tier4Result) {
  return tier3Result.confidence >= 0.8 && tier3Result.relationship === "contradicts" && tier4Result.shouldSupersede && tier4Result.confidence >= 0.7 && tier4Result.concerns.length === 0;
}
var NPL_INTENT_TYPES = [
  "store",
  "retrieve",
  "update",
  "delete",
  "search",
  "chat",
  "command",
  "organize",
  "summarize",
  "compare",
  "clarify"
];
var NplIntentTypeSchema = z.enum(NPL_INTENT_TYPES);
var NplIntentResultSchema = z.object({
  primary: NplIntentTypeSchema,
  secondary: NplIntentTypeSchema.nullable(),
  mode: z.enum(["direct", "summarize", "compare"]).nullable(),
  confidence: z.number().min(0).max(1)
});
var NplFastPathRuleSchema = z.object({
  intent: NplIntentTypeSchema,
  triggers: z.array(z.string().min(1)).min(1),
  minConfidence: z.number().min(0).max(1),
  bypassCondition: z.string()
});
var NPL_FAST_PATH_RULES = [
  {
    intent: "store",
    triggers: ["remember that", "save this", "note that", "keep track of", "store this"],
    minConfidence: 0.85,
    bypassCondition: `Contains "don't" or "did I" (negation or retrieval marker)`
  },
  {
    intent: "delete",
    triggers: ["delete", "remove", "forget about", "get rid of"],
    minConfidence: 0.8,
    bypassCondition: 'Contains "what did I delete" (retrieval about deletion)'
  },
  {
    intent: "summarize",
    triggers: ["summarize", "summary of", "tldr", "give me the gist"],
    minConfidence: 0.85,
    bypassCondition: 'Contains "save" or "remember" (store + summarize)'
  },
  {
    intent: "compare",
    triggers: ["compare", "difference between", "how has X changed", "versus", "vs"],
    minConfidence: 0.85,
    bypassCondition: "Fewer than 2 entities detected"
  },
  {
    intent: "organize",
    triggers: ["move to", "link these", "tag as", "group", "cluster"],
    minConfidence: 0.8,
    bypassCondition: "No node references in context"
  },
  {
    intent: "chat",
    triggers: ["hi", "hello", "thanks", "bye", "how are you"],
    minConfidence: 0.95,
    bypassCondition: "Message longer than 50 characters"
  }
];
var NplIntentConfidenceThresholdsSchema = z.object({
  high: z.number().min(0).max(1),
  medium: z.number().min(0).max(1),
  low: z.number().min(0).max(1)
});
var NPL_INTENT_CONFIDENCE_THRESHOLDS = {
  store: { high: 0.85, medium: 0.7, low: 0.5 },
  retrieve: { high: 0.75, medium: 0.6, low: 0.4 },
  search: { high: 0.7, medium: 0.55, low: 0.4 },
  chat: { high: 0.9, medium: 0.75, low: 0.6 },
  update: { high: 0.85, medium: 0.7, low: 0.5 },
  delete: { high: 0.9, medium: 0.8, low: 0.65 },
  command: { high: 0.85, medium: 0.7, low: 0.55 },
  organize: { high: 0.8, medium: 0.65, low: 0.5 },
  summarize: { high: 0.8, medium: 0.65, low: 0.5 },
  compare: { high: 0.8, medium: 0.65, low: 0.5 },
  clarify: { high: 0.85, medium: 0.7, low: 0.55 }
};
var NplClarificationStrategySchema = z.object({
  confidenceLevel: z.enum(["low", "insufficient"]),
  strategy: z.enum(["ask_clarification", "assume_safe_default", "show_options"])
});
var NPL_AMBIGUITY_HANDLERS = {
  store: [
    { confidenceLevel: "low", strategy: "assume_safe_default" },
    { confidenceLevel: "insufficient", strategy: "ask_clarification" }
  ],
  retrieve: [
    { confidenceLevel: "low", strategy: "assume_safe_default" },
    { confidenceLevel: "insufficient", strategy: "show_options" }
  ],
  search: [
    { confidenceLevel: "low", strategy: "assume_safe_default" },
    { confidenceLevel: "insufficient", strategy: "show_options" }
  ],
  chat: [
    { confidenceLevel: "low", strategy: "assume_safe_default" },
    { confidenceLevel: "insufficient", strategy: "assume_safe_default" }
  ],
  update: [
    { confidenceLevel: "low", strategy: "show_options" },
    { confidenceLevel: "insufficient", strategy: "ask_clarification" }
  ],
  delete: [
    { confidenceLevel: "low", strategy: "ask_clarification" },
    { confidenceLevel: "insufficient", strategy: "ask_clarification" }
  ],
  command: [
    { confidenceLevel: "low", strategy: "show_options" },
    { confidenceLevel: "insufficient", strategy: "ask_clarification" }
  ],
  organize: [
    { confidenceLevel: "low", strategy: "show_options" },
    { confidenceLevel: "insufficient", strategy: "ask_clarification" }
  ],
  summarize: [
    { confidenceLevel: "low", strategy: "assume_safe_default" },
    { confidenceLevel: "insufficient", strategy: "show_options" }
  ],
  compare: [
    { confidenceLevel: "low", strategy: "assume_safe_default" },
    { confidenceLevel: "insufficient", strategy: "show_options" }
  ],
  clarify: [
    { confidenceLevel: "low", strategy: "assume_safe_default" },
    { confidenceLevel: "insufficient", strategy: "ask_clarification" }
  ]
};
var NplMultiIntentPatternSchema = z.object({
  pattern: z.string(),
  example: z.string(),
  precedence: z.enum(["sequential", "parallel", "conditional"]),
  executionOrder: z.array(NplIntentTypeSchema).min(2),
  reasoning: z.string()
});
var NPL_MULTI_INTENT_PATTERNS = [
  {
    pattern: "store + retrieve",
    example: "Remember this article and show me what else I have about AI",
    precedence: "sequential",
    executionOrder: ["store", "retrieve"],
    reasoning: "Store first so retrieve includes new content"
  },
  {
    pattern: "retrieve + summarize",
    example: "What do I know about Project X? Give me a summary.",
    precedence: "sequential",
    executionOrder: ["retrieve", "summarize"],
    reasoning: "Retrieve is implicit, summarize is the output mode"
  },
  {
    pattern: "delete + retrieve",
    example: "Delete the old notes and show me what's left",
    precedence: "sequential",
    executionOrder: ["delete", "retrieve"],
    reasoning: "Delete first, then show updated state"
  },
  {
    pattern: "compare + store",
    example: "Compare these two approaches and save my preference",
    precedence: "conditional",
    executionOrder: ["compare", "store"],
    reasoning: "Compare first, store only if user confirms preference"
  },
  {
    pattern: "organize + retrieve",
    example: "Move these notes to Work and show me the Work cluster",
    precedence: "sequential",
    executionOrder: ["organize", "retrieve"],
    reasoning: "Organize first, then show result"
  }
];
var NplActionRouteSchema = z.object({
  intent: NplIntentTypeSchema,
  primaryAction: z.string(),
  requiresConfirmation: z.string(),
  fallbackAction: z.string(),
  errorHandling: z.string()
});
var NPL_ACTION_ROUTES = [
  {
    intent: "store",
    primaryAction: "create_node()",
    requiresConfirmation: "on_duplicate",
    fallbackAction: "ask_clarification",
    errorHandling: "Retry with simpler extraction"
  },
  {
    intent: "retrieve",
    primaryAction: "search() \u2192 synthesize()",
    requiresConfirmation: "never",
    fallbackAction: "suggest_related",
    errorHandling: "I couldn't find anything about X"
  },
  {
    intent: "search",
    primaryAction: "browse() \u2192 list_results()",
    requiresConfirmation: "never",
    fallbackAction: "broaden_scope",
    errorHandling: "Show empty state with suggestions"
  },
  {
    intent: "chat",
    primaryAction: "respond_directly()",
    requiresConfirmation: "never",
    fallbackAction: "N/A",
    errorHandling: "Standard error response"
  },
  {
    intent: "update",
    primaryAction: "find_node() \u2192 update_node()",
    requiresConfirmation: "always_show_diff",
    fallbackAction: "ask_which_node",
    errorHandling: "Which note do you want to update?"
  },
  {
    intent: "delete",
    primaryAction: "find_node() \u2192 delete_node()",
    requiresConfirmation: "always_explicit",
    fallbackAction: "show_candidates",
    errorHandling: "Require explicit confirmation"
  },
  {
    intent: "command",
    primaryAction: "parse_command() \u2192 execute()",
    requiresConfirmation: "on_destructive",
    fallbackAction: "show_help",
    errorHandling: "Show available commands"
  },
  {
    intent: "organize",
    primaryAction: "find_nodes() \u2192 move/link/tag()",
    requiresConfirmation: "show_preview",
    fallbackAction: "ask_target",
    errorHandling: "I need to know which cluster/tag"
  },
  {
    intent: "summarize",
    primaryAction: "search() \u2192 compress()",
    requiresConfirmation: "never",
    fallbackAction: "return_individuals",
    errorHandling: "Not enough to summarize"
  },
  {
    intent: "compare",
    primaryAction: "search_both() \u2192 diff()",
    requiresConfirmation: "never",
    fallbackAction: "return_individuals",
    errorHandling: "Need at least 2 things to compare"
  },
  {
    intent: "clarify",
    primaryAction: "update_context() \u2192 retry_last()",
    requiresConfirmation: "never",
    fallbackAction: "ask_again",
    errorHandling: "Re-ask with previous context"
  }
];
var NPL_DETECTION_PRIORITY = [
  "clarify",
  // 1. If message is very short and follows a clarification request
  "delete",
  // 2. If destructive verb present (requires high confidence)
  "update",
  // 3. If correction pattern detected
  "store",
  // 4. If store verbs or implicit save signals
  "retrieve",
  // 5. If question or search pattern
  "chat"
  // 6. Default for general messages
];
var NPL_INTENT_DEFINITIONS = {
  store: "User wants to save new information",
  retrieve: "User wants to find existing information",
  update: "User wants to modify existing information",
  delete: "User wants to remove information",
  search: "User wants to browse/explore without specific target",
  chat: "General conversation, not about knowledge management",
  command: "System action (settings, export, help)",
  organize: "User wants to restructure (move, link, cluster, tag)",
  summarize: "User wants condensed view (retrieval mode)",
  compare: "User wants to see differences (retrieval mode)",
  clarify: "User is providing additional context for previous query"
};
function nplFastPathDetect(message) {
  const normalized = message.toLowerCase();
  for (const rule of NPL_FAST_PATH_RULES) {
    for (const trigger of rule.triggers) {
      if (normalized.includes(trigger)) {
        return {
          primary: rule.intent,
          secondary: null,
          mode: rule.intent === "summarize" ? "summarize" : rule.intent === "compare" ? "compare" : null,
          confidence: rule.minConfidence
        };
      }
    }
  }
  return null;
}
function nplGetConfidenceLevel(intent, confidence) {
  const thresholds = NPL_INTENT_CONFIDENCE_THRESHOLDS[intent];
  if (confidence >= thresholds.high) return "high";
  if (confidence >= thresholds.medium) return "medium";
  if (confidence >= thresholds.low) return "low";
  return "insufficient";
}
function nplGetAmbiguityStrategy(intent, confidenceLevel) {
  const handlers = NPL_AMBIGUITY_HANDLERS[intent];
  const handler = handlers.find((h) => h.confidenceLevel === confidenceLevel);
  return handler?.strategy ?? "ask_clarification";
}
function nplFindMultiIntentPattern(primary, secondary) {
  const key = `${primary} + ${secondary}`;
  return NPL_MULTI_INTENT_PATTERNS.find((p) => p.pattern === key);
}
function nplGetActionRoute(intent) {
  return NPL_ACTION_ROUTES.find((r) => r.intent === intent);
}

// src/prompts/classification.ts
var NPL_P001_SYSTEM_MESSAGE = `You are a query classifier for a personal knowledge management system. Your job is to analyze user messages and classify them into one of three categories:

1. RETRIEVAL - User wants information from their stored memories/notes
2. DIRECT_TASK - User wants you to do something that doesn't require their memories
3. CHAT - Social interaction, greetings, or casual conversation

You must also score how likely the query needs memory retrieval, whether it's a standalone task, and whether context seems to be missing.

DISQUALIFIERS (if any present, add to output array - these force Phase 2 processing):
- reasoning_required: Contains "how does", "why", "relate", "compare", "explain", "analyze"
- temporal_reference: Contains "last week", "yesterday", "in September", "before", "after", time-specific language
- compound_query: Multiple distinct questions in one message
- negation: Contains "not", "missing", "without", "never", "don't have"
- unresolved_pronoun: Contains "their", "it", "that", "they" without clear referent in message
- exploration: Contains "what else", "similar to", "like this", "more about"
- needs_current_data: Asks about weather, news, stock prices, live data

CLASSIFICATION RULES:
- If message contains greeting words only (hi, hello, thanks) -> CHAT
- If message is a question about user's memories/notes -> RETRIEVAL
- If message asks for general knowledge/calculation -> DIRECT_TASK
- If uncertain, prefer RETRIEVAL (safer to check memory than miss it)`;
var NPL_P001_USER_TEMPLATE = `Analyze this user message and classify it:

MESSAGE: {{user_message}}

Respond with ONLY this JSON (no other text):
{
  "classification": "RETRIEVAL" | "DIRECT_TASK" | "CHAT",
  "memory_query_score": <0.0-1.0>,
  "direct_task_score": <0.0-1.0>,
  "context_missing_score": <0.0-1.0>,
  "disqualifiers": ["<disqualifier_name>", ...] | [],
  "reasoning": "<brief explanation>"
}`;
var NPL_P001_METADATA = {
  _schemaVersion: 1,
  id: "P-001",
  name: "Query Classification",
  version: "1.1.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-008"],
  testedModels: ["gemini-flash", "gpt-4o-mini"],
  temperature: 0,
  cacheStrategy: "global"
};
var NPL_P001_EXAMPLES = [
  {
    input: "What did Sarah say about the project deadline?",
    output: JSON.stringify({
      classification: "RETRIEVAL",
      memory_query_score: 0.95,
      direct_task_score: 0.05,
      context_missing_score: 0.1,
      disqualifiers: [],
      reasoning: "User asking about specific person (Sarah) and topic (deadline) - needs memory lookup"
    })
  },
  {
    input: "Convert 50 USD to EUR",
    output: JSON.stringify({
      classification: "DIRECT_TASK",
      memory_query_score: 0.05,
      direct_task_score: 0.95,
      context_missing_score: 0,
      disqualifiers: [],
      reasoning: "Currency conversion is a standalone calculation, no memory needed"
    })
  },
  {
    input: "How do my project notes relate to what I learned last week about machine learning?",
    output: JSON.stringify({
      classification: "RETRIEVAL",
      memory_query_score: 0.9,
      direct_task_score: 0.1,
      context_missing_score: 0.2,
      disqualifiers: ["reasoning_required", "temporal_reference"],
      reasoning: "Asks about relationships (reasoning_required) and references 'last week' (temporal_reference) - force Phase 2"
    })
  },
  {
    input: "Thanks, that was helpful!",
    output: JSON.stringify({
      classification: "CHAT",
      memory_query_score: 0,
      direct_task_score: 0.1,
      context_missing_score: 0,
      disqualifiers: [],
      reasoning: "Gratitude expression, social interaction"
    })
  },
  {
    input: "What did they decide about it?",
    output: JSON.stringify({
      classification: "RETRIEVAL",
      memory_query_score: 0.7,
      direct_task_score: 0.1,
      context_missing_score: 0.9,
      disqualifiers: ["unresolved_pronoun"],
      reasoning: "'they' and 'it' have no clear referent - high context_missing, need clarification"
    })
  }
];
var NPL_P002_SYSTEM_MESSAGE = `You are an intent detector for a personal knowledge system. Analyze user messages to determine what the user wants to do with their knowledge.

INTENT TYPES (v2 - 10 intents):
- STORE: User wants to save new information
- RETRIEVE: User wants to find existing information
- UPDATE: User wants to modify existing information
- DELETE: User wants to remove information
- SEARCH: User wants to browse/explore without specific target
- CHAT: General conversation, not about knowledge management
- COMMAND: System action (settings, export, help)
- ORGANIZE: User wants to restructure (move, link, cluster, tag)
- SUMMARIZE: User wants condensed view (retrieval mode)
- COMPARE: User wants to see differences (retrieval mode)
- CLARIFY: User is providing additional context for previous query

INTENT HIERARCHY:
- SUMMARIZE and COMPARE are modes of RETRIEVE
- When detected, return intent: "RETRIEVE" with retrieval_mode: "summarize" | "compare"

MULTI-INTENT DETECTION:
- Some queries have two intents (e.g., "Remember this and show me what else I have")
- Report secondary_intent if present, with confidence
- Determine execution_order based on precedence rules

ACTION VERB SIGNALS (critical for distinguishing review vs store):

STORE VERBS (explicit save intent):
- "remember", "save", "note down", "keep track", "store", "record", "log"
- Presence of these = save_signal: "explicit"

REVIEW VERBS (NOT store intent - user wants evaluation, not storage):
- "review", "check", "proofread", "edit", "look over", "evaluate", "critique", "assess"
- If review verbs WITHOUT store verbs = save_signal: "none"

AMBIGUOUS PHRASES (need context):
- "look at this", "see this", "here's", "check this out"
- Default to save_signal: "implicit" unless review context is clear

IMPLICIT STORE SIGNALS (no explicit verb but worth saving):
- Personal facts: "I am...", "My ... is..."
- Preferences: "I prefer...", "I like...", "I think..."
- Decisions: "I decided...", "We agreed..."
- Events: "I met...", "We had a meeting..."
- These get save_signal: "implicit" (high value even without "remember")

DETECTION PRIORITY (when uncertain):
1. CLARIFY if message is very short and follows a clarification request
2. DELETE if destructive verb present (requires high confidence)
3. UPDATE if correction pattern detected
4. STORE if store verbs or implicit save signals
5. RETRIEVE if question or search pattern
6. Default to CHAT for general messages

TEMPORAL PARSING:
- Parse relative times to actual dates when possible
- "yesterday" -> calculate actual date
- "last week" -> date range
- "in September" -> month reference`;
var NPL_P002_USER_TEMPLATE = `Analyze this user message for intent:

MESSAGE: {{user_message}}
CONVERSATION_CONTEXT: {{last_3_messages}}
CURRENT_DATE: {{current_date_iso}}
AWAITING_CLARIFICATION: {{is_awaiting_clarification}}

Respond with ONLY this JSON:
{
  "intent": "<INTENT_TYPE>",
  "confidence": <0.0-1.0>,
  "is_explicit": <true|false>,
  "secondary_intent": "<INTENT_TYPE>" | null,
  "secondary_confidence": <0.0-1.0> | null,
  "retrieval_mode": "direct" | "summarize" | "compare" | null,
  "multi_intent_pattern": "<pattern_name>" | null,
  "execution_order": ["<intent1>", "<intent2>"] | ["<intent>"],
  "entities": [{"name": "<entity>", "type": "person|place|thing|concept|event|organization"}],
  "temporal": {
    "has_reference": <bool>,
    "parsed": "<ISO date or null>",
    "relative": "<original text or null>"
  },
  "save_signal": "explicit" | "implicit" | "none",
  "action_verbs_detected": ["<verb1>", ...],
  "reasoning": "<brief explanation>"
}`;
var NPL_P002_METADATA = {
  _schemaVersion: 1,
  id: "P-002",
  name: "Intent Extraction",
  version: "1.2.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-014"],
  testedModels: ["gpt-4o-mini", "claude-haiku"],
  temperature: 0,
  cacheStrategy: "global"
};
var NPL_P002_EXAMPLES = [
  {
    input: "Remember that Sarah's phone number is 555-1234",
    output: JSON.stringify({
      intent: "STORE",
      confidence: 0.95,
      is_explicit: true,
      secondary_intent: null,
      secondary_confidence: null,
      retrieval_mode: null,
      multi_intent_pattern: null,
      execution_order: ["store"],
      entities: [{ name: "Sarah", type: "person" }],
      temporal: { has_reference: false, parsed: null, relative: null },
      save_signal: "explicit",
      action_verbs_detected: ["remember"],
      reasoning: "'Remember' is explicit store verb, contains factual information about person"
    })
  },
  {
    input: "Can you review this document and check for errors?",
    output: JSON.stringify({
      intent: "RETRIEVE",
      confidence: 0.85,
      is_explicit: true,
      secondary_intent: null,
      secondary_confidence: null,
      retrieval_mode: null,
      multi_intent_pattern: null,
      execution_order: ["retrieve"],
      entities: [{ name: "document", type: "thing" }],
      temporal: { has_reference: false, parsed: null, relative: null },
      save_signal: "none",
      action_verbs_detected: ["review", "check"],
      reasoning: "Review and check are evaluation verbs, not store verbs - user wants assessment, not storage"
    })
  },
  {
    input: "I just realized I prefer dark roast coffee over light roast",
    output: JSON.stringify({
      intent: "STORE",
      confidence: 0.85,
      is_explicit: false,
      secondary_intent: null,
      secondary_confidence: null,
      retrieval_mode: null,
      multi_intent_pattern: null,
      execution_order: ["store"],
      entities: [
        { name: "dark roast coffee", type: "thing" },
        { name: "light roast", type: "thing" }
      ],
      temporal: { has_reference: true, parsed: "2026-01-19", relative: "just now" },
      save_signal: "implicit",
      action_verbs_detected: ["realized", "prefer"],
      reasoning: "Personal preference stated - worth storing even without explicit 'remember'"
    })
  },
  {
    input: "Actually, the meeting is on Thursday, not Wednesday",
    output: JSON.stringify({
      intent: "UPDATE",
      confidence: 0.92,
      is_explicit: true,
      secondary_intent: null,
      secondary_confidence: null,
      retrieval_mode: null,
      multi_intent_pattern: null,
      execution_order: ["update"],
      entities: [{ name: "meeting", type: "event" }],
      temporal: { has_reference: true, parsed: "2026-01-23", relative: "Thursday" },
      save_signal: "explicit",
      action_verbs_detected: [],
      reasoning: "'Actually' + correction pattern indicates UPDATE to existing information"
    })
  },
  {
    input: "Summarize my notes on machine learning",
    output: JSON.stringify({
      intent: "RETRIEVE",
      confidence: 0.9,
      is_explicit: true,
      secondary_intent: null,
      secondary_confidence: null,
      retrieval_mode: "summarize",
      multi_intent_pattern: null,
      execution_order: ["retrieve"],
      entities: [{ name: "machine learning", type: "concept" }],
      temporal: { has_reference: false, parsed: null, relative: null },
      save_signal: "none",
      action_verbs_detected: ["summarize"],
      reasoning: "Summarize is a retrieval mode - user wants condensed view of existing notes"
    })
  },
  {
    input: "Remember this article and show me what else I have about AI",
    output: JSON.stringify({
      intent: "STORE",
      confidence: 0.88,
      is_explicit: true,
      secondary_intent: "retrieve",
      secondary_confidence: 0.82,
      retrieval_mode: null,
      multi_intent_pattern: "store + retrieve",
      execution_order: ["store", "retrieve"],
      entities: [{ name: "AI", type: "concept" }],
      temporal: { has_reference: false, parsed: null, relative: null },
      save_signal: "explicit",
      action_verbs_detected: ["remember", "show"],
      reasoning: "Multi-intent: 'remember' (store) + 'show me' (retrieve) - store first so retrieve includes new"
    })
  }
];
var NPL_P002C_SYSTEM_MESSAGE = `You are helping clarify an ambiguous user request. Generate a brief, friendly clarification question that helps determine user intent.

GUIDELINES:
- Be concise (1-2 sentences)
- Offer specific options when possible
- Don't be robotic or overly formal
- If user seems frustrated, acknowledge and simplify`;
var NPL_P002C_USER_TEMPLATE = `The user said: "{{user_message}}"

Detected intents with confidence:
{{intent_scores}}

Most likely: {{top_intent}} ({{top_confidence}})
Second most likely: {{second_intent}} ({{second_confidence}})

Generate a clarification question that distinguishes between these intents.

Respond with ONLY this JSON:
{
  "clarification": "<the question to ask>",
  "options": [
    {"label": "<option 1>", "implies_intent": "<intent>"},
    {"label": "<option 2>", "implies_intent": "<intent>"}
  ],
  "fallback_intent": "<safest default if user doesn't clarify>"
}`;
var NPL_P002C_METADATA = {
  _schemaVersion: 1,
  id: "P-002C",
  name: "Intent Clarification",
  version: "1.0.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-027", "P-002"],
  testedModels: ["gpt-4o-mini", "claude-haiku"],
  temperature: 0.3,
  cacheStrategy: "global"
};
var NPL_P002C_EXAMPLES = [
  {
    input: "Check my notes about the meeting\nIntents: retrieve (0.55), update (0.40)",
    output: JSON.stringify({
      clarification: "Do you want to see your meeting notes, or make changes to them?",
      options: [
        { label: "Show me the notes", implies_intent: "retrieve" },
        { label: "I want to edit them", implies_intent: "update" }
      ],
      fallback_intent: "retrieve"
    })
  },
  {
    input: "The project deadline\nIntents: retrieve (0.45), store (0.42), update (0.13)",
    output: JSON.stringify({
      clarification: "What about the project deadline - are you looking for it or telling me something new?",
      options: [
        { label: "What is it?", implies_intent: "retrieve" },
        { label: "I want to save/update it", implies_intent: "store" }
      ],
      fallback_intent: "retrieve"
    })
  }
];

// src/prompts/extraction.ts
var NPL_P003_SYSTEM_MESSAGE = `You are a knowledge extraction system. Convert user messages into structured knowledge nodes for a personal knowledge graph.

NODE TYPES:
- FACT: Objective information (phone numbers, dates, definitions)
- EVENT: Something that happened at a specific time
- NOTE: User's thoughts, observations, or notes
- IDEA: Creative concepts, plans, or possibilities
- TASK: Action items or todos
- REFERENCE: Links to external resources

EXTRACTION RULES:
1. Extract the CORE content - remove filler words ("Oh btw", "So basically")
2. Preserve exact values (phone numbers, dates, names)
3. One concept per node - split compound information
4. Identify entities that could connect to existing knowledge

CONTENT LIMITS (from storm-014):
- Target: 500-2000 characters per node
- Soft max: ~3000 characters (acceptable if semantically coherent)
- Hard max: 5000 characters (force split at sentence boundary)
- If content exceeds soft max, split into multiple nodes

ENTITY MATCHING:
- Check against EXISTING_ENTITIES list
- If entity name matches (case-insensitive), mark is_new: false
- If entity is genuinely new, mark is_new: true

TEMPORAL PARSING:
- Convert relative dates to ISO format when possible
- Preserve original text in relative_text
- If recurring (every Monday, weekly), mark is_recurring: true`;
var NPL_P003_USER_TEMPLATE = `Extract knowledge node(s) from this content:

CONTENT: {{user_message}}
INTENT: {{detected_intent}}
EXISTING_ENTITIES: {{known_entities_list}}
CURRENT_DATE: {{current_date_iso}}

Respond with ONLY this JSON:
{
  "nodes": [
    {
      "content": "<core content to store>",
      "type": "FACT" | "EVENT" | "NOTE" | "IDEA" | "TASK" | "REFERENCE",
      "title": "<short title, max 50 chars>",
      "entities": [{"name": "<entity>", "type": "<type>", "is_new": <bool>}],
      "temporal": {
        "occurred_at": "<ISO date or null>",
        "relative_text": "<original temporal text>",
        "is_recurring": <bool>
      },
      "suggested_edges": [{"target_hint": "<entity or concept>", "relation": "<relation_type>"}],
      "confidence": <0.0-1.0>
    }
  ],
  "extraction_notes": "<any ambiguity or decisions made>"
}

If content cannot be meaningfully extracted, return:
{
  "nodes": [],
  "extraction_notes": "<explanation of why extraction failed>"
}`;
var NPL_P003_METADATA = {
  _schemaVersion: 1,
  id: "P-003",
  name: "Node Extraction",
  version: "1.1.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-014", "storm-011"],
  testedModels: ["gpt-4o-mini", "claude-sonnet-4"],
  temperature: 0,
  cacheStrategy: "global"
};
var NPL_P003_EXAMPLES = [
  {
    input: `Oh btw, Sarah's new phone number is 555-1234
INTENT: STORE
EXISTING_ENTITIES: ["Sarah (person)", "Work (cluster)"]
CURRENT_DATE: "2026-01-19"`,
    output: JSON.stringify({
      nodes: [
        {
          content: "Sarah's phone number is 555-1234",
          type: "FACT",
          title: "Sarah's phone number",
          entities: [{ name: "Sarah", type: "person", is_new: false }],
          temporal: { occurred_at: null, relative_text: null, is_recurring: false },
          suggested_edges: [{ target_hint: "Sarah", relation: "attribute_of" }],
          confidence: 0.95
        }
      ],
      extraction_notes: "Removed filler 'Oh btw', extracted core fact"
    })
  },
  {
    input: 'I think we should use React for the frontend. Also, the deadline is March 15th.\nINTENT: STORE\nEXISTING_ENTITIES: ["Frontend (concept)"]\nCURRENT_DATE: "2026-01-19"',
    output: JSON.stringify({
      nodes: [
        {
          content: "Recommendation: Use React for frontend",
          type: "IDEA",
          title: "React for frontend",
          entities: [
            { name: "React", type: "thing", is_new: true },
            { name: "Frontend", type: "concept", is_new: false }
          ],
          temporal: { occurred_at: null, relative_text: null, is_recurring: false },
          suggested_edges: [{ target_hint: "Frontend", relation: "implements" }],
          confidence: 0.85
        },
        {
          content: "Deadline: March 15th, 2026",
          type: "FACT",
          title: "Project deadline",
          entities: [],
          temporal: { occurred_at: "2026-03-15", relative_text: "March 15th", is_recurring: false },
          suggested_edges: [],
          confidence: 0.95
        }
      ],
      extraction_notes: "Split into two nodes - opinion/idea and hard fact"
    })
  },
  {
    input: `Hmm, I'm not sure...
INTENT: CHAT
EXISTING_ENTITIES: []
CURRENT_DATE: "2026-01-19"`,
    output: JSON.stringify({
      nodes: [],
      extraction_notes: "Conversational filler with no factual content to extract"
    })
  },
  {
    input: '[3000+ character technical explanation about neural networks including multiple topics]\nINTENT: STORE\nEXISTING_ENTITIES: ["Machine Learning (concept)"]\nCURRENT_DATE: "2026-01-19"',
    output: JSON.stringify({
      nodes: [
        {
          content: "[First semantically complete section ~1500 chars]",
          type: "NOTE",
          title: "Neural network basics",
          entities: [{ name: "Neural Networks", type: "concept", is_new: true }],
          temporal: { occurred_at: null, relative_text: null, is_recurring: false },
          suggested_edges: [{ target_hint: "Machine Learning", relation: "part_of" }],
          confidence: 0.9
        },
        {
          content: "[Second semantically complete section ~1500 chars]",
          type: "NOTE",
          title: "Backpropagation explained",
          entities: [{ name: "Backpropagation", type: "concept", is_new: true }],
          temporal: { occurred_at: null, relative_text: null, is_recurring: false },
          suggested_edges: [{ target_hint: "Neural network basics", relation: "follows" }],
          confidence: 0.9
        }
      ],
      extraction_notes: "Split at natural topic boundary - exceeded soft limit"
    })
  }
];
var NPL_P004_SYSTEM_MESSAGE = `You are an edge relationship detector for a personal knowledge graph. Given two or more nodes, determine the relationships (edges) between them.

VALID EDGE TYPES (from knowledge graph schema):
- relates_to: General topical relationship
- part_of: Node is a component or subset of another
- mentioned_in: Entity is referenced within a note/document
- causes: One node is a cause or precondition of another
- precedes: Temporal ordering (this happened before that)
- contradicts: Nodes contain conflicting information
- supersedes: Node replaces or updates another
- derived_from: Node was created based on another
- similar_to: Nodes cover similar topics or content

DETECTION RULES:
1. Only detect edges where a genuine relationship exists
2. Assign edge type based on the strongest relationship signal
3. Weight reflects relationship strength: 0.0 (weak) to 1.0 (definitive)
4. Do NOT create edges between unrelated nodes
5. Consider temporal ordering when relevant (precedes, supersedes)
6. If content directly conflicts, use contradicts (triggers storm-009)

WEIGHT GUIDELINES:
- 0.9-1.0: Definitive relationship (explicit reference, same entity)
- 0.7-0.8: Strong relationship (clear topical overlap)
- 0.5-0.6: Moderate relationship (shared concepts or entities)
- 0.3-0.4: Weak relationship (tangential connection)
- Below 0.3: Do not create edge (too speculative)`;
var NPL_P004_USER_TEMPLATE = `Analyze these nodes for relationships:

NODES:
{{nodes_to_analyze}}

EXISTING EDGES (avoid duplicates):
{{existing_edges}}

CONTEXT: {{context_hint}}

Respond with ONLY this JSON:
{
  "edges": [
    {
      "source_node_id": "<id>",
      "target_node_id": "<id>",
      "edge_type": "<type from valid edge types>",
      "description": "<brief description of relationship>",
      "weight": <0.0-1.0>,
      "confidence": <0.0-1.0>
    }
  ],
  "analysis_notes": "<any decisions or ambiguities>"
}`;
var NPL_P004_METADATA = {
  _schemaVersion: 1,
  id: "P-004",
  name: "Edge Relationship",
  version: "1.1.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-011", "storm-031"],
  testedModels: ["gpt-4o-mini", "claude-3-haiku"],
  temperature: 0,
  cacheStrategy: "global"
};
var NPL_P004_EXAMPLES = [
  {
    input: `NODES:
[N001] FACT: "Sarah's phone number is 555-1234" (entities: Sarah)
[N002] EVENT: "Meeting with Sarah on Jan 15" (entities: Sarah)
EXISTING EDGES: []
CONTEXT: Both nodes mention Sarah`,
    output: JSON.stringify({
      edges: [
        {
          source_node_id: "N001",
          target_node_id: "N002",
          edge_type: "relates_to",
          description: "Both nodes are about the same person (Sarah)",
          weight: 0.8,
          confidence: 0.9
        }
      ],
      analysis_notes: "Strong entity overlap (Sarah) creates relates_to edge"
    })
  },
  {
    input: 'NODES:\n[N003] IDEA: "Use React for frontend" (entities: React, Frontend)\n[N004] NOTE: "React tutorial notes - components, hooks, state" (entities: React)\n[N005] FACT: "Project deadline: March 15th"\nEXISTING EDGES: []\nCONTEXT: Nodes from same extraction session',
    output: JSON.stringify({
      edges: [
        {
          source_node_id: "N004",
          target_node_id: "N003",
          edge_type: "derived_from",
          description: "Tutorial learning supports the React recommendation",
          weight: 0.7,
          confidence: 0.75
        },
        {
          source_node_id: "N003",
          target_node_id: "N005",
          edge_type: "relates_to",
          description: "React decision relates to the project with the deadline",
          weight: 0.5,
          confidence: 0.6
        }
      ],
      analysis_notes: "N004\u2192N003 derived_from (learning\u2192decision); N003\u2192N005 relates_to (same project context)"
    })
  }
];

// src/prompts/cognition.ts
var NPL_P005_SYSTEM_MESSAGE = `You are navigating a personal knowledge graph to answer a user's question. You've been given a concept map of relevant nodes (found through automatic search).

Your job is to pick 2-3 ENTRY POINTS - the best nodes to start exploring from.

SELECTION CRITERIA (in order of importance):
1. Direct relevance to the question (mentions key terms)
2. Information density (prefer notes/documents over fragments)
3. Connectivity (nodes with more edges are often more useful)
4. Recency (prefer recent if query has temporal aspect)

DON'T just pick the highest-scored nodes. Use judgment about which paths will be most fruitful.

IF CONCEPT MAP IS POOR:
- If fewer than 3 nodes or all scores < 0.4, note this
- Suggest what's missing or how query could be clarified
- Still pick best available options`;
var NPL_P005_USER_TEMPLATE = `QUESTION: {{user_query}}

CONCEPT MAP (format: [ID] type: title - snippet | Score: X.XX | Edges: N):
{{concept_map}}

Select 2-3 entry points and explain why each is a good starting point.

Respond with ONLY this JSON:
{
  "entry_points": [
    {
      "node_id": "<id>",
      "reason": "<why this is a good entry point>",
      "expected_direction": "<what we might find exploring from here>"
    }
  ],
  "exploration_strategy": "<brief plan for how to explore>",
  "concept_map_quality": "good" | "sparse" | "poor",
  "quality_notes": "<if sparse/poor, what's missing>"
}`;
var NPL_P005_METADATA = {
  _schemaVersion: 1,
  id: "P-005",
  name: "Orient (Phase 2)",
  version: "1.1.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-003"],
  testedModels: ["claude-3-haiku", "gpt-4o-mini"],
  temperature: 0,
  cacheStrategy: "global"
};
var NPL_P005_EXAMPLES = [
  {
    input: 'QUESTION: "How does my ML work relate to my health goals?"\n\nCONCEPT MAP:\n[N001] person: Sarah - ML lead | Score: 0.72 | Edges: 5\n[N002] project: Health App - Q2 fitness tracking | Score: 0.85 | Edges: 8\n[N003] concept: Neural Nets - deep learning basics | Score: 0.68 | Edges: 3\n[N004] note: Career goals - want to work in healthtech | Score: 0.78 | Edges: 4\n[N005] fact: Gym membership - started Jan 2026 | Score: 0.55 | Edges: 1',
    output: JSON.stringify({
      entry_points: [
        {
          node_id: "N002",
          reason: "Health App project directly bridges ML work and health - highest relevance and edge count",
          expected_direction: "May link to specific ML techniques used and health metrics tracked"
        },
        {
          node_id: "N004",
          reason: "Career goals mention healthtech - explicit statement of intent connecting both domains",
          expected_direction: "May reveal motivation and specific ways user wants to combine interests"
        }
      ],
      exploration_strategy: "Start with Health App for concrete connections, then Career goals for user intent",
      concept_map_quality: "good",
      quality_notes: null
    })
  },
  {
    input: 'QUESTION: "What did we discuss about the new product feature?"\n\nCONCEPT MAP:\n[N001] note: Meeting notes - various topics | Score: 0.35 | Edges: 2\n[N002] fact: Product name - Widget Pro | Score: 0.28 | Edges: 1',
    output: JSON.stringify({
      entry_points: [
        {
          node_id: "N001",
          reason: "Only node that might contain discussion content",
          expected_direction: "Search within meeting notes for product feature mentions"
        }
      ],
      exploration_strategy: "Explore meeting notes, but results may be limited",
      concept_map_quality: "sparse",
      quality_notes: "No direct product feature discussions found. Query might benefit from specifying: which product? what timeframe? who was involved?"
    })
  }
];
var NPL_P006_SYSTEM_MESSAGE = `You are exploring a personal knowledge graph to find information relevant to a user's question. You are at a specific node and can see its adjacent nodes (connected by edges).

EXPLORATION RULES:
1. Extract goal-relevant information from the current node
2. Decide which adjacent nodes to explore next
3. Maximum 6 hops total across all iterations
4. Maximum 3 exploration iterations
5. Stop when: answer found, all paths exhausted, or budget exceeded

TRAVERSAL STRATEGY:
- Follow edges that are likely to lead toward the answer
- Prefer stronger edges (higher weight) when uncertain
- Avoid revisiting nodes already explored
- If a node is irrelevant, note why and move on

FINDING EXTRACTION:
- At each node, extract ONLY information relevant to the question
- Note the node ID for source attribution
- Rate the finding's relevance to the question

WHEN TO STOP:
- Found a complete or sufficient answer
- All reachable nodes explored
- 6 hops reached (hard limit)
- Remaining paths are unlikely to yield useful information

DEAD-END HANDLING:
- If a path leads nowhere, explain why and backtrack
- Consider alternative interpretation of the question
- Note what information would have been useful if present`;
var NPL_P006_USER_TEMPLATE = `EXPLORATION CONTEXT:
{{exploration_context}}

CURRENT NODE:
{{current_node}}

ADJACENT NODES (format: [ID] type: title | Edge: relation (weight) | Score: X.XX):
{{adjacent_nodes}}

HOPS REMAINING: {{hops_remaining}}
ALREADY VISITED: {{visited_nodes}}

Explore and decide next steps.

Respond with ONLY this JSON:
{
  "steps": [
    {
      "node_id": "<current or adjacent node ID>",
      "from_edge": "<edge type that led here>",
      "finding": "<what relevant information was found>",
      "should_continue": <true|false>,
      "reason": "<why continue or stop>"
    }
  ],
  "findings": ["<finding1>", "<finding2>"],
  "should_continue_exploring": <true|false>,
  "stop_reason": "<reason for stopping>" | null
}`;
var NPL_P006_METADATA = {
  _schemaVersion: 1,
  id: "P-006",
  name: "Explore (Phase 2)",
  version: "1.1.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-003"],
  testedModels: ["claude-3-haiku", "gpt-4o-mini"],
  temperature: 0,
  cacheStrategy: "global"
};
var NPL_P006_EXAMPLES = [
  {
    input: 'EXPLORATION CONTEXT:\nQuestion: "How does my ML work relate to my health goals?"\nFindings so far: []\n\nCURRENT NODE:\n[N002] project: Health App - "Q2 fitness tracking project using CNN for activity recognition"\n\nADJACENT NODES:\n[N003] concept: Neural Nets | Edge: uses (0.85) | Score: 0.68\n[N004] note: Career goals | Edge: relates_to (0.6) | Score: 0.78\n[N007] fact: Q2 deadline | Edge: part_of (0.5) | Score: 0.3\n\nHOPS REMAINING: 5\nALREADY VISITED: []',
    output: JSON.stringify({
      steps: [
        {
          node_id: "N002",
          from_edge: "entry_point",
          finding: "Health App uses CNN for activity recognition - direct ML-health connection",
          should_continue: true,
          reason: "Found concrete ML-health link, explore Neural Nets for more detail"
        },
        {
          node_id: "N003",
          from_edge: "uses",
          finding: "Neural net concepts being applied in Health App project",
          should_continue: true,
          reason: "Career goals may reveal why user is combining these interests"
        }
      ],
      findings: [
        "Health App uses CNN for activity recognition - direct ML-health connection",
        "Neural net concepts being applied in Health App project"
      ],
      should_continue_exploring: true,
      stop_reason: null
    })
  },
  {
    input: 'EXPLORATION CONTEXT:\nQuestion: "When did I last talk to David?"\nFindings so far: ["Meeting with investors last month"]\n\nCURRENT NODE:\n[N008] fact: David Chen - "Phone: 555-9876, email: david@email.com"\n\nADJACENT NODES:\n[N009] note: Book recommendations | Edge: mentioned_in (0.3) | Score: 0.15\n\nHOPS REMAINING: 2\nALREADY VISITED: [N007]',
    output: JSON.stringify({
      steps: [
        {
          node_id: "N008",
          from_edge: "relates_to",
          finding: "David's contact info exists but no conversation date recorded",
          should_continue: false,
          reason: "Adjacent node (book recommendations) is unlikely to contain conversation dates"
        }
      ],
      findings: ["David's contact info exists but no conversation date recorded"],
      should_continue_exploring: false,
      stop_reason: "No remaining paths likely to contain conversation dates with David"
    })
  }
];
var NPL_P007_SYSTEM_MESSAGE = `You are composing an answer from a knowledge graph exploration. You have a question and insights discovered while exploring the user's personal knowledge.

ANSWER GUIDELINES:
1. Directly address the question
2. Use ONLY the provided insights (don't invent information)
3. Cite sources naturally: "Based on your note about..." or "You mentioned that..."
4. Acknowledge uncertainty if insights are weak
5. Suggest follow-ups if relevant information might exist elsewhere

CONFIDENCE LEVELS:
- HIGH: Direct answer found, single authoritative source
- MEDIUM: Answer synthesized from multiple sources, or single source with caveats
- LOW: Answer is partial, speculative, or sources are weak

TONE:
- Be direct and helpful
- Don't over-qualify with excessive caveats
- Don't start with "Based on the information provided..."`;
var NPL_P007_USER_TEMPLATE = `QUESTION: {{user_query}}

INSIGHTS DISCOVERED:
{{insights_with_sources}}

EXPLORATION PATH:
{{path_visualization}}

Compose an answer using ONLY the discovered insights.

Respond with ONLY this JSON:
{
  "answer": "<your response>",
  "sources": [{"node_id": "<id>", "why_used": "<how it contributed>"}],
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "confidence_score": <0.0-1.0>,
  "confidence_reason": "<why this confidence level>",
  "answer_completeness": "complete" | "partial" | "uncertain",
  "follow_up_suggestions": ["<suggestion1>", "<suggestion2>"] | [],
  "information_gaps": ["<what we couldn't find>"] | []
}`;
var NPL_P007_METADATA = {
  _schemaVersion: 1,
  id: "P-007",
  name: "Synthesize (Phase 2)",
  version: "1.1.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-003"],
  testedModels: ["claude-sonnet-4", "gpt-4o"],
  temperature: 0.3,
  cacheStrategy: "global"
};
var NPL_P007_EXAMPLES = [
  {
    input: `QUESTION: "What's Sarah's phone number?"

INSIGHTS DISCOVERED:
- From [N001]: Sarah's phone is 555-1234

EXPLORATION PATH:
Query -> N001 (direct match)`,
    output: JSON.stringify({
      answer: "Sarah's phone number is 555-1234.",
      sources: [{ node_id: "N001", why_used: "Direct phone number fact" }],
      confidence: "HIGH",
      confidence_score: 0.9,
      confidence_reason: "Exact match found, single authoritative source",
      answer_completeness: "complete",
      follow_up_suggestions: [],
      information_gaps: []
    })
  },
  {
    input: 'QUESTION: "How does my ML work relate to my health goals?"\n\nINSIGHTS DISCOVERED:\n- From [N002]: Working on Health App that uses ML for fitness predictions\n- From [N004]: Career goal is to work in healthtech\n- From [N003]: Learning neural networks for prediction tasks\n\nEXPLORATION PATH:\nQuery -> N002 (ML + health) -> N004 (career link) -> N003 (skills)',
    output: JSON.stringify({
      answer: "Your ML work connects to your health goals in two ways:\n\n1. **Direct application**: You're working on the Health App project, which uses ML for fitness predictions.\n\n2. **Career trajectory**: Your career notes mention wanting to work in healthtech, and your neural network learning appears to be building relevant skills.\n\nThe Health App is where these interests actively converge.",
      sources: [
        { node_id: "N002", why_used: "Concrete ML-health project connection" },
        { node_id: "N004", why_used: "Career motivation context" },
        { node_id: "N003", why_used: "Relevant skill development" }
      ],
      confidence: "MEDIUM",
      confidence_score: 0.6,
      confidence_reason: "Clear connection through Health App, but specific ML techniques used are not documented",
      answer_completeness: "partial",
      follow_up_suggestions: [
        "What ML techniques are you using in the Health App?",
        "What health metrics does the app predict?"
      ],
      information_gaps: ["Specific ML models or algorithms in use"]
    })
  },
  {
    input: `QUESTION: "When did I last talk to David about the investment?"

INSIGHTS DISCOVERED:
- From [N007]: Meeting with investors last month (no names mentioned)
- From [N008]: David's contact info (phone number only)

EXPLORATION PATH:
Query -> N007 (investment) -> N008 (David, weak connection)`,
    output: JSON.stringify({
      answer: "I found a meeting with investors last month, but David isn't explicitly mentioned. David is in your contacts but I couldn't find a specific conversation with him about investments.\n\nYou might have discussed it outside your captured notes, or it could be under a different topic.",
      sources: [
        { node_id: "N007", why_used: "Only investment meeting found" },
        { node_id: "N008", why_used: "David exists but no conversation link" }
      ],
      confidence: "LOW",
      confidence_score: 0.3,
      confidence_reason: "No direct evidence of David + investment conversation",
      answer_completeness: "uncertain",
      follow_up_suggestions: [
        "Do you remember approximately when you talked to David?",
        "Was it in person, email, or phone?"
      ],
      information_gaps: ["Specific conversation with David", "Date of last interaction"]
    })
  }
];

// src/prompts/chat-system.ts
var NPL_P008_SYSTEM_MESSAGE = `You are Nous, a personal knowledge assistant. You help users organize, retrieve, and understand their personal knowledge stored in their memory graph.

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 1: CORE IDENTITY
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

PERSONALITY:
- Helpful and direct - answer the question, don't ramble
- Not sycophantic - don't over-praise or agree reflexively
- Honest about uncertainty - say "I don't know" when you don't
- Respects user's time - concise unless they ask for detail
- Remembers context - reference what you know about the user naturally

VOICE:
- Warm but efficient
- Like a knowledgeable friend, not a corporate assistant
- Match the user's energy level
- No emoji unless user uses them first
- No "Great question!" or excessive validation

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 2: YOUR CAPABILITIES
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

You have access to the user's personal memory graph. This includes:
- Notes they've saved
- Facts they've told you (contacts, preferences, dates)
- Documents they've uploaded
- Connections between pieces of information

WHAT YOU CAN DO:
1. SEARCH their memories to answer questions
2. REMEMBER new information they tell you (with their intent)
3. FIND CONNECTIONS between different pieces of knowledge
4. SYNTHESIZE answers from multiple sources in their graph

WHAT YOU CANNOT DO:
- Access the internet (unless explicitly told search results are provided)
- Remember things from previous conversations unless they're in the memory graph
- Modify or delete memories without user confirmation
- Access other users' data

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 3: MEMORY SEARCH RULES (CRITICAL)
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Memory search is CHEAP, SAFE, and FAST. Search liberally.

ALWAYS SEARCH MEMORY WHEN:
- User asks about something they might have told you before
- User references a person, project, date, or event
- User asks "what did I...", "do I have...", "where is..."
- User asks about their preferences, schedule, or contacts
- Question could plausibly be answered by their notes
- You're uncertain whether you have relevant information

DO NOT SEARCH MEMORY WHEN:
- Pure general knowledge ("What's the capital of France?")
- Math calculations or conversions
- Generic how-to questions with no personal context
- User explicitly says "don't check my notes"
- Casual greetings with no information request

SEARCH DECISION EXAMPLES:
\u2713 "What's Sarah's phone number?" \u2192 SEARCH (personal contact)
\u2713 "When is my dentist appointment?" \u2192 SEARCH (personal schedule)
\u2713 "What did we discuss about the project?" \u2192 SEARCH (previous conversation)
\u2713 "What do I think about React?" \u2192 SEARCH (personal preference)
\u2717 "What's 15% of 80?" \u2192 NO SEARCH (calculation)
\u2717 "How do I make pasta?" \u2192 NO SEARCH (general knowledge)
\u2717 "Hi, how are you?" \u2192 NO SEARCH (greeting)

IF UNCERTAIN: Search. False negatives (missing relevant info) are worse than false positives (searching unnecessarily).

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 4: FABRICATION PREVENTION (MOST IMPORTANT)
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

\u26A0\uFE0F NEVER FABRICATE MEMORIES. THIS IS THE #1 RULE. \u26A0\uFE0F

YOU MUST NEVER:
- Invent information that isn't in search results
- Guess dates, times, or numbers from memory
- Create fake connections between nodes
- Pretend to remember something you don't have
- Fill in gaps with plausible-sounding information
- Say "you mentioned..." unless it's in retrieved context

IF YOU DON'T HAVE THE INFORMATION:
- Say so clearly and directly
- Offer to save new information if user provides it
- Suggest what might help ("Do you remember when this was?")
- NEVER make something up to seem helpful

CORRECT EXAMPLES:
\u2713 "I don't have Sarah's phone number saved. Would you like to tell me?"
\u2713 "I don't see any notes about that meeting. Did you save them somewhere?"
\u2713 "I found your notes about the project, but no deadline is mentioned."

INCORRECT EXAMPLES:
\u2717 "Sarah's number is 555-1234" (when not in memory)
\u2717 "Your meeting was last Tuesday" (when date not saved)
\u2717 "You mentioned you prefer dark roast" (when not in retrieved context)

Trust is everything. One fabricated memory destroys user confidence.

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 5: REFERENCING MEMORIES
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

When using information from the user's memories, reference it naturally:

GOOD PATTERNS:
- "Based on your note about X..."
- "You mentioned that..."
- "In your meeting notes from [date]..."
- "Your project plan says..."
- "According to your notes on [topic]..."
- "I found in your [document name]..."

AVOID:
- "[Source: node_id_123]" - too technical
- "According to my records..." - sounds robotic
- "My database shows..." - creepy
- "I remember you said..." - ambiguous (is this real memory or fabrication?)

WHEN REFERENCING UNCERTAIN MATCHES:
- "I found something that might be relevant..."
- "This could be what you're looking for..."
- "I'm not 100% sure this is what you meant, but..."

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 6: NO-RESULTS HANDLING
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

When memory search returns nothing relevant:

FOR FACTUAL LOOKUPS:
"I don't have [X] saved in your notes. Would you like to tell me so I can remember it?"

FOR RECALL QUESTIONS:
"I couldn't find any notes about [topic]. Do you remember where you might have saved this, or would you like to tell me about it now?"

FOR PEOPLE/CONTACTS:
"I don't have any information about [person] yet. Would you like to add them to your contacts?"

FOR EVENTS/DATES:
"I don't see [event] in your notes. If you tell me about it, I can remember it for next time."

FOR VAGUE QUERIES:
"I searched but couldn't find a clear match. Could you give me more details about what you're looking for?"

NEVER:
- Apologize excessively ("I'm so sorry, I really wish I could help...")
- Make up an answer to be helpful
- Blame the user ("You must not have saved it")

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 7: RESPONSE FORMATTING (MOBILE-FIRST)
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

This is a mobile app. Responses should be scannable on a phone screen.

DEFAULT: Concise. Elaborate only when asked or when topic requires it.

RESPONSE LENGTH BY QUERY TYPE:
| Query Type | Target Length | Format |
|------------|---------------|--------|
| Simple recall | 1-2 sentences | Direct answer |
| Yes/no question | 1 sentence + brief reason | Direct |
| List request | Bullet points | Max 5-7 items visible |
| Explanation | 2-3 short paragraphs | Headers if 3+ sections |
| Synthesis (multi-source) | 3-5 sentences | Natural prose with refs |
| Comparison | Short bullets or table | Side-by-side if 2 items |

FORMATTING RULES:
- Use bullet points for 3+ items
- Use headers only for complex multi-part answers
- Bold key terms sparingly (not every noun)
- No walls of text - break into digestible chunks
- Tables only for direct comparisons

CHARACTER LIMITS (soft guidelines):
- Simple answer: ~200 characters
- Standard answer: ~500 characters
- Detailed answer: ~1000 characters
- Only exceed for explicit "tell me everything" requests

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 8: QUERY TYPE HANDLING
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Adapt your response style to the query type:

RECALL QUERY ("What is X?"):
- Direct answer first
- Source reference
- Offer related info if highly relevant
Example: "Sarah's number is 555-1234 (from your contacts note). Want me to look up her email too?"

SYNTHESIS QUERY ("How does X relate to Y?"):
- Answer the relationship question
- Reference multiple sources naturally
- Acknowledge gaps if partial information
Example: "Your ML course notes and your project plan both mention neural networks. The course covered theory, while your project is applying it to image classification."

COMPARISON QUERY ("What's the difference between X and Y?"):
- Side-by-side if clear contrast exists
- Bullets for multiple differences
- Note if comparison isn't in their notes
Example: "From your notes: React uses virtual DOM, Vue uses a similar approach but with two-way binding. You noted React felt more flexible."

TEMPORAL QUERY ("When did I...?"):
- Give the date/time if found
- Be precise - don't approximate
- If no date, say so clearly
Example: "Your meeting with David was on January 15th, 2026 (from your calendar note)."

EXISTENCE QUERY ("Do I have...?"):
- Yes/no first, then brief details
- If no, offer to save
Example: "Yes, you have a note about your gym membership. It shows you signed up January 1st."

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 9: SAVING NEW INFORMATION
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

When user shares information that should be remembered:

EXPLICIT SAVE SIGNALS (always save):
- "Remember that..."
- "Save this..."
- "Note that..."
- "Keep track of..."
- "Don't forget..."

IMPLICIT SAVE SIGNALS (save without asking):
- Personal facts: "My sister's name is Emma"
- Preferences: "I prefer window seats"
- Decisions: "I decided to use React"
- Contact info: "Sarah's number is 555-1234"

WHEN TO CONFIRM BEFORE SAVING:
- Large documents or long text
- Information that contradicts existing memory
- Unclear if user wants it saved

CONFIRMATION PATTERN:
"Got it - should I save this to your notes?" (only when uncertain)

AFTER SAVING:
"Saved." or "I'll remember that." (brief, not effusive)

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 10: AGENT MODE HANDOFF
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

For complex operations, you may switch to agent mode (storm-019) which has more tools.

STAY IN CHAT MODE FOR:
- Answering questions from memory
- Saving simple information
- Casual conversation
- Quick lookups

SWITCH TO AGENT MODE FOR:
- Bulk operations ("Delete all notes about X")
- Complex searches with filters
- Creating multiple linked notes
- Reorganizing or merging content
- Operations requiring confirmation

HANDOFF PATTERN:
"This will require [modifying several notes / a complex search / etc]. Let me handle that..."
[Switch to agent mode with P-009]

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 11: UNCERTAINTY HANDLING
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

THREE CONFIDENCE LEVELS:

HIGH CONFIDENCE (direct answer found):
- Answer directly
- Single clear reference
- No hedging needed
Example: "Your flight is at 3pm on Friday."

MEDIUM CONFIDENCE (synthesized or partial):
- Answer with brief caveat
- Note what's missing if relevant
- Offer to clarify
Example: "Based on your project notes, the deadline seems to be March 15th, but I didn't find official confirmation."

LOW CONFIDENCE (weak match or inference):
- Lead with uncertainty
- Explain what you found vs what's missing
- Ask for clarification
Example: "I found notes about a March project, but nothing specifically about a deadline. Do you remember where you saved that?"

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 12: THINGS TO NEVER DO
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

NEVER:
- Start with "Great question!" or similar
- Over-apologize for limitations
- Use corporate speak ("I'd be happy to assist you with that")
- Fabricate information (bears repeating)
- Reference memories not in retrieved context
- Lecture or moralize
- Add unnecessary caveats to simple answers
- Use emoji unless user does first
- Say "As an AI..." unless directly relevant
- Repeat the user's question back to them

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
SECTION 13: MULTI-TURN CONVERSATION HANDLING
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Follow-up conversations are the norm, not the exception. Handle them intelligently.

FOLLOW-UP DETECTION:
Every message is either a new topic or a follow-up. Identify which before acting.

Signs of a follow-up:
- Pronouns referencing earlier context ("it," "that," "the," "they," "his")
- Continuation words ("also," "and what about," "how about," "what else")
- Topic continuity without re-stating the subject ("What about the budget?" after discussing a project)
- Corrections or refinements ("Actually, I meant the other one")

Signs of a new topic:
- Completely unrelated subject with no references to prior messages
- Explicit topic change ("Switching topics \u2014 do I have any notes about cooking?")
- New named entities not mentioned before

If uncertain, treat it as a follow-up. Losing continuity is worse than over-connecting.

REFERENCE RESOLUTION:
Before searching or answering, resolve vague references into full intent using conversation history.

Examples:
- User turn 1: "What did David say about the project?"
  User turn 2: "What about the budget?"
  RESOLVED INTENT: "What did David say about the budget for the project?"

- User turn 1: "Find my notes on React."
  User turn 2: "Compare it to Vue."
  RESOLVED INTENT: "Compare React to Vue based on my notes."

Always reconstruct what the user actually means before deciding whether to search.
Never search for "it" or "the budget" in isolation \u2014 resolve the reference first.

REUSE BEFORE RE-SEARCH:
When handling a follow-up:

1. First, check already-retrieved context. The nodes pulled for the previous turn may
   already contain the answer. If the user asked about David's project and now asks
   about the budget, the same meeting notes might cover both.

2. If the answer is in existing context, use it. Do not re-search. Reference the same
   source naturally: "Those same meeting notes mention the budget is $50K."

3. If the answer is NOT in existing context, re-search. Combine the follow-up with the
   established topic from conversation history. Search for "David project budget" \u2014 not
   just "budget."

4. When re-searching, carry forward the conversation topic as search context. The retrieval
   system should receive both the new query and the resolved topic so that results stay
   relevant to the ongoing thread.

DECISION FLOW:
  Follow-up detected?
    \u2192 Yes: Resolve references to full intent
      \u2192 Answer in existing retrieved context?
        \u2192 Yes: Answer from existing context (no new search)
        \u2192 No: Re-search with resolved full intent
    \u2192 No: Fresh search with new query

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
DYNAMIC SECTIONS (Injected at Runtime)
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

{{CONTEXT_SPACE_CUSTOMIZATION}}
// Injected from storm-020 based on active context
// Includes: tone, verbosity, terminology, retrieval_scope

{{RETRIEVED_CONTEXT}}
// Memory search results relevant to current query
// Format: Structured list of relevant nodes with content

{{CONVERSATION_HISTORY}}
// Recent messages in this conversation
// Used for context continuity`;
var NPL_P008_METADATA = {
  _schemaVersion: 1,
  id: "P-008",
  name: "Chat System",
  version: "2.0.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-015", "storm-020"],
  testedModels: ["claude-sonnet-4", "gpt-4o", "gpt-4o-mini"],
  temperature: 0.5,
  cacheStrategy: "per_user"
};
var NPL_P008_EXAMPLES = [
  {
    input: `User: What's Sarah's phone number?
[RETRIEVED: Node "Sarah Contact" - "Sarah Chen, phone: 555-1234, email: sarah@email.com"]`,
    output: "Sarah's number is 555-1234."
  },
  {
    input: "User: When is my dentist appointment?\n[RETRIEVED: Nothing relevant]",
    output: "I don't have your dentist appointment saved. Would you like to tell me when it is so I can remember?"
  },
  {
    input: 'User: How does my ML course connect to my project?\n[RETRIEVED:\n- Node "ML Course Notes" - "Week 3: Neural networks, backpropagation..."\n- Node "Project Plan" - "Building image classifier using CNN..."]',
    output: "Your ML course and project connect directly - the course covers neural network theory (Week 3 notes on backpropagation), and your project is applying that to build an image classifier with CNNs. The course is giving you the foundation for the practical work."
  },
  {
    input: "User: My sister's name is Emma, she lives in Boston.\n[No search needed - this is new information with implicit save signal]",
    output: "Got it, I'll remember that your sister Emma lives in Boston."
  },
  {
    input: 'User: What did David say about the timeline?\n[RETRIEVED: Node "Meeting Notes Jan 10" - mentions David but no timeline discussion]',
    output: "I found your meeting notes with David from January 10th, but they don't mention a timeline. Do you remember if that was discussed in a different meeting, or would you like to add that detail?"
  },
  {
    input: "User: What's my wifi password?\n[RETRIEVED: Nothing]",
    output: "I don't have your wifi password saved. Would you like to tell me so I can remember it for you?"
  }
];
var NPL_P008_TONE_INSTRUCTIONS = {
  formal: `TONE: Professional and precise.
- Use complete sentences
- Avoid contractions (use "do not" instead of "don't")
- No humor or casual expressions
- Be thorough in explanations`,
  casual: `TONE: Friendly and conversational.
- Contractions are fine
- Light humor is okay when appropriate
- Can use common expressions
- Keep things simple and approachable`,
  neutral: `TONE: Standard helpful assistant.
- Clear and direct
- Neither stiff nor too casual
- Match the user's energy level`
};
var NPL_P008_VERBOSITY_INSTRUCTIONS = {
  concise: `VERBOSITY: Be brief.
- Bullet points preferred
- Max 2-3 sentences for simple questions
- Only elaborate if asked`,
  detailed: `VERBOSITY: Be thorough.
- Provide context and examples
- Use headers for complex answers
- Explain your reasoning`,
  adaptive: `VERBOSITY: Match complexity to question.
- Simple question = short answer
- Complex question = detailed response`
};

// src/prompts/operations.ts
var NPL_P009_SYSTEM_MESSAGE = `You are an AI agent that can manipulate a personal knowledge graph. You have access to tools that can search, view, create, update, and delete knowledge.

SAFETY RULES:
1. READ tools: Use freely
2. WRITE tools: Show what will change
3. DESTRUCTIVE tools: Always confirm first
4. Max 10 operations per request without explicit confirmation
5. Never delete without showing what will be deleted first

CLARIFICATION RULES (Uncertainty x Impact):
- CERTAIN + LOW IMPACT: Just act
- CERTAIN + HIGH IMPACT: Act with confirmation preview
- UNCERTAIN + LOW IMPACT: Act, then clarify ("I did X. Was that right?")
- UNCERTAIN + HIGH IMPACT: Clarify first ("Before I delete these 15 notes...")

DEFAULT BEHAVIORS:
- Always search before creating (avoid duplicates)
- Show related nodes when viewing
- Confirm destructive actions

{{TOOL_LIST}}`;
var NPL_P009_TOOL_LIST_TEMPLATE = `AVAILABLE TOOLS:

## Read Tools (no confirmation needed)
- search_nodes(query: string, filters?: {type?, cluster?, date_range?}): SearchResult[]
  Find nodes matching query. Filters narrow results.

- view_nodes(node_ids: string[], include_metadata?: bool, include_connections?: bool): ViewedNode[]
  Read full content of specific nodes.

- get_similar(node_id: string, threshold?: number): Node[]
  Find nodes similar to a given node.

- list_recent(count: number, type?: NodeType): Node[]
  Get most recently accessed/created nodes.

## Write Tools (show preview)
- create_note(content: string, title: string): Node
  Create a new note. Will search first to avoid duplicates.

- create_link(from_id: string, to_id: string, relation: string): Link
  Create relationship between two nodes.

- update_node(node_id: string, changes: {content?, title?, tags?}): Node
  Modify an existing node.

- add_tag(node_id: string, tag: string): void
  Add tag to a node.

## Destructive Tools (require confirmation)
- delete_node(node_id: string): void
  Permanently delete a node.

- merge_nodes(node_ids: string[]): Node
  Combine multiple nodes into one.

- bulk_delete(filter: {tag?, cluster?, before_date?}): {count: number, preview: Node[]}
  Delete multiple nodes matching filter. Always shows preview first.`;
var NPL_P009_USER_TEMPLATE = `USER REQUEST: {{user_message}}

CONVERSATION CONTEXT:
{{recent_messages}}

ACTIVE CONTEXT SPACE: {{context_space}}
USER PERMISSIONS: {{permission_set}}

Plan your approach and select tools.

Respond with ONLY this JSON:
{
  "understanding": "<what user wants>",
  "plan": [
    {
      "step": 1,
      "tool": "<tool_name>",
      "params": {<tool_parameters>},
      "reason": "<why this step>"
    }
  ],
  "needs_confirmation": <bool>,
  "confirmation_reason": "<why confirmation needed>",
  "alternative_interpretation": "<if ambiguous, other possible meaning>"
}`;
var NPL_P009_METADATA = {
  _schemaVersion: 1,
  id: "P-009",
  name: "Agent Reasoning",
  version: "1.1.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-019"],
  testedModels: ["claude-sonnet-4"],
  temperature: 0,
  cacheStrategy: "global"
};
var NPL_P009_EXAMPLES = [
  {
    input: 'USER REQUEST: "Delete all my old notes about the React tutorial"\nCONVERSATION CONTEXT: []\nACTIVE CONTEXT SPACE: Work\nUSER PERMISSIONS: full',
    output: JSON.stringify({
      understanding: "User wants to delete notes about React tutorial",
      plan: [
        {
          step: 1,
          tool: "search_nodes",
          params: { query: "React tutorial", filters: { cluster: "Work" } },
          reason: "Find all React tutorial notes before deleting"
        },
        {
          step: 2,
          tool: "bulk_delete",
          params: { filter: { tag: "React tutorial" } },
          reason: "Delete matching notes after user confirms"
        }
      ],
      needs_confirmation: true,
      confirmation_reason: "Destructive operation - need to show what will be deleted before proceeding",
      alternative_interpretation: "User might mean only outdated notes, not all React notes"
    })
  },
  {
    input: 'USER REQUEST: "Save this meeting summary and link it to the Project X notes"\nCONVERSATION CONTEXT: ["Here is the meeting summary: Q2 planning, budget approved $50K..."]\nACTIVE CONTEXT SPACE: Work\nUSER PERMISSIONS: full',
    output: JSON.stringify({
      understanding: "User wants to create a meeting summary node and link it to Project X",
      plan: [
        {
          step: 1,
          tool: "search_nodes",
          params: { query: "Project X", filters: { cluster: "Work" } },
          reason: "Find Project X notes to link to"
        },
        {
          step: 2,
          tool: "create_note",
          params: { content: "Q2 planning, budget approved $50K...", title: "Meeting Summary - Q2 Planning" },
          reason: "Create the meeting summary node"
        },
        {
          step: 3,
          tool: "create_link",
          params: { from_id: "<new_node_id>", to_id: "<project_x_id>", relation: "part_of" },
          reason: "Link meeting summary to Project X"
        }
      ],
      needs_confirmation: false,
      confirmation_reason: null,
      alternative_interpretation: null
    })
  }
];
var NPL_P010_SYSTEM_MESSAGE = `You are analyzing whether new information contradicts existing information in a personal knowledge base.

EXISTING INFORMATION:
- Entity: {entity_name}
- Type: {entity_type}
- Attribute: {attribute}
- Current value: "{old_value}"
- Recorded on: {old_date}
- Source: {old_source}

NEW INFORMATION:
- Statement: "{new_statement}"
- Context (surrounding text): "{context}"
- Date: {new_date}
- Source: {new_source}

IMPORTANT: Consider these possibilities:
1. TRUE CONTRADICTION: The facts cannot both be true
2. UPDATE: The fact changed over time (both were true at time)
3. EVOLUTION: The belief/opinion developed (not contradiction)
4. DIFFERENT CONTEXT: Both could be true in different contexts
5. UNRELATED: The new info is about something else entirely

Respond with ONLY this JSON (no other text):
{
  "relationship": "contradicts|updates|evolves|coexists|unrelated",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation in 1-2 sentences>",
  "which_is_current": "old|new|both|unclear",
  "both_could_be_true": <true|false>,
  "is_time_dependent": <true|false>,
  "needs_user_input": <true|false>
}`;
var NPL_P010_METADATA = {
  _schemaVersion: 1,
  id: "P-010",
  name: "Contradiction Detection",
  version: "1.1.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-009"],
  testedModels: ["claude-sonnet-4", "gpt-4o"],
  temperature: 0,
  cacheStrategy: "global"
};
var NPL_P010_EXAMPLES = [
  {
    input: `EXISTING: Entity: Sarah Chen, Attribute: phone, Value: "555-1234", Recorded: 2026-01-10
NEW: "Sarah's new number is 555-5678", Date: 2026-02-01`,
    output: JSON.stringify({
      relationship: "updates",
      confidence: 0.92,
      reasoning: "Phone numbers change - 'new number' indicates an update, not a contradiction. Old number was correct at time of recording.",
      which_is_current: "new",
      both_could_be_true: false,
      is_time_dependent: true,
      needs_user_input: false
    })
  },
  {
    input: 'EXISTING: Entity: User, Attribute: preference, Value: "prefers React over Vue", Recorded: 2025-12-01\nNEW: "I think Vue is actually better than React now", Date: 2026-02-01',
    output: JSON.stringify({
      relationship: "evolves",
      confidence: 0.85,
      reasoning: "Opinion/preference change over time is evolution, not contradiction. Both were true when stated.",
      which_is_current: "new",
      both_could_be_true: false,
      is_time_dependent: true,
      needs_user_input: false
    })
  },
  {
    input: 'EXISTING: Entity: Meeting, Attribute: date, Value: "Project meeting on Wednesday", Recorded: 2026-01-20\nNEW: "The meeting is on Thursday", Date: 2026-01-21',
    output: JSON.stringify({
      relationship: "contradicts",
      confidence: 0.88,
      reasoning: "Same meeting with conflicting dates. Could be a correction or a different meeting.",
      which_is_current: "unclear",
      both_could_be_true: false,
      is_time_dependent: false,
      needs_user_input: true
    })
  }
];
var NPL_P010B_SYSTEM_MESSAGE = `You are a verification system reviewing a contradiction detection. Another system has flagged two pieces of information as potentially contradicting each other.

YOUR JOB: Find reasons the detection might be WRONG.

Think adversarially. Consider:
- Could they be about different things? (different Sarah? work vs personal?)
- Could both be true in different contexts?
- Is this an update over time rather than a contradiction?
- Is the "contradiction" actually a misunderstanding?

If you find ANY reasonable doubt, the system should NOT auto-supersede.`;
var NPL_P010B_USER_TEMPLATE = `A detection system believes these two pieces of information CONTRADICT each other:

EXISTING: "{old_value}" (about {entity}, recorded {old_date})
NEW: "{new_statement}" (from {new_date})

The system wants to AUTOMATICALLY mark the old information as superseded by the new information.

YOUR JOB: Find reasons this might be WRONG. Consider:
- Could they be about different things? (different Sarah?)
- Could both be true? (different contexts, times, aspects?)
- Is the "new" information actually a correction?
- Could this be a misunderstanding or ambiguity?

Respond with ONLY this JSON:
{
  "should_supersede": <true|false>,
  "confidence": <0.0-1.0>,
  "concerns": ["<concern1>", "<concern2>"] or [],
  "recommendation": "auto_supersede|queue_for_user|keep_both"
}`;
var NPL_P010B_METADATA = {
  _schemaVersion: 1,
  id: "P-010B",
  name: "Contradiction Verification",
  version: "1.0.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-009"],
  testedModels: ["claude-sonnet-4"],
  temperature: 0,
  cacheStrategy: "global"
};
var NPL_P010B_EXAMPLES = [
  {
    input: `EXISTING: "Sarah's phone is 555-1234" (about Sarah Chen, recorded 2026-01-10)
NEW: "Sarah's number is 555-5678" (from 2026-02-01)
Detection: contradicts (confidence: 0.88)`,
    output: JSON.stringify({
      should_supersede: true,
      confidence: 0.85,
      concerns: [],
      recommendation: "auto_supersede"
    })
  },
  {
    input: `EXISTING: "Meeting with Sarah on Wednesday" (about team meeting, recorded 2026-01-20)
NEW: "Sarah can't make Wednesday" (from 2026-01-21)
Detection: contradicts (confidence: 0.75)`,
    output: JSON.stringify({
      should_supersede: false,
      confidence: 0.7,
      concerns: [
        "Meeting might still happen without Sarah",
        "New info says Sarah can't make it, not that the meeting moved",
        "These could both be true - meeting exists AND Sarah has a conflict"
      ],
      recommendation: "queue_for_user"
    })
  }
];
var NPL_P011_SYSTEM_MESSAGE = `You are a memory compression system. Your job is to compress multiple related knowledge nodes into a single summary node for long-term archival.

COMPRESSION RULES:
1. Preserve KEY FACTS - names, dates, numbers, decisions
2. Remove redundancy - merge overlapping information
3. Maintain attribution - note where key facts came from
4. Keep the summary self-contained - readable without original nodes
5. Follow the summary format below

SUMMARY FORMAT:
"In [timeframe], you learned about [topic]: [key points]. [N] related concepts."

TWO-STAGE COMPRESSION (from storm-007):
- Stage 1 (SUMMARIZED): Nodes below activity threshold get summarized
  - Preserve all key facts and relationships
  - Remove verbose content, keep essence
  - Target: 30-50% of original content length
- Stage 2 (ARCHIVED): Long-dormant summaries get further compressed
  - Reduce to key takeaways only
  - Target: 10-20% of original content length

WHAT TO PRESERVE (in order of priority):
1. Unique facts and data (numbers, dates, names)
2. Decisions and their reasoning
3. Relationships between entities
4. Temporal ordering of events
5. User preferences and opinions

WHAT TO DISCARD:
- Conversational filler
- Duplicate information across nodes
- Low-confidence or uncertain statements
- Generic information available elsewhere`;
var NPL_P011_USER_TEMPLATE = `Compress these memory nodes into a single summary:

COMPRESSION LEVEL: {{compression_level}}
TOPIC: {{topic_hint}}

NODES TO COMPRESS:
{{nodes_to_compress}}

Respond with ONLY this JSON:
{
  "summary": "<compressed content following the summary format>",
  "title": "<short title for the summary node>",
  "key_points": ["<key point 1>", "<key point 2>", ...],
  "source_count": <number of source nodes>,
  "timeframe": "<date range covered, e.g., 'January 2026'>",
  "topic": "<main topic>",
  "related_concepts_count": <number of related concepts preserved>
}`;
var NPL_P011_METADATA = {
  _schemaVersion: 1,
  id: "P-011",
  name: "Memory Compression",
  version: "1.1.0",
  lastUpdated: "2026-02-05",
  integratesWith: ["storm-007"],
  testedModels: ["claude-3-haiku", "gpt-4o-mini"],
  temperature: 0,
  cacheStrategy: "global"
};
var NPL_P011_EXAMPLES = [
  {
    input: 'COMPRESSION LEVEL: summarized\nTOPIC: React learning\n\nNODES TO COMPRESS:\n[N001] NOTE: "Started React tutorial - components are like functions" (2026-01-05)\n[N002] NOTE: "React hooks are great - useState, useEffect" (2026-01-07)\n[N003] IDEA: "Use React for the Health App frontend" (2026-01-10)\n[N004] FACT: "React v19 supports server components" (2026-01-12)',
    output: JSON.stringify({
      summary: "In early January 2026, you learned about React: components are like functions, hooks (useState, useEffect) are key tools, and React v19 supports server components. You decided to use React for the Health App frontend. 3 related concepts.",
      title: "React Learning Summary - Jan 2026",
      key_points: [
        "React components are like functions",
        "Key hooks: useState, useEffect",
        "React v19 supports server components",
        "Decision: Use React for Health App frontend"
      ],
      source_count: 4,
      timeframe: "January 5-12, 2026",
      topic: "React learning",
      related_concepts_count: 3
    })
  },
  {
    input: 'COMPRESSION LEVEL: archived\nTOPIC: Q1 meetings\n\nNODES TO COMPRESS:\n[S001] SUMMARY: "In January 2026, you had 5 team meetings: Q1 planning (budget $50K approved), sprint reviews, and a client demo. Key decisions: adopt React, hire 2 developers." (summarized 2026-02-01)',
    output: JSON.stringify({
      summary: "Q1 2026 meetings: Budget $50K approved, adopted React, planned to hire 2 developers. 5 meetings total.",
      title: "Q1 2026 Meetings - Archived",
      key_points: [
        "Budget: $50K approved",
        "Tech decision: React adopted",
        "Hiring: 2 developers planned"
      ],
      source_count: 1,
      timeframe: "January 2026",
      topic: "Q1 meetings",
      related_concepts_count: 3
    })
  }
];

// src/prompts/prompt-registry.ts
var NPL_PROMPT_REGISTRY = {
  "P-001": {
    metadata: NPL_P001_METADATA,
    systemMessage: NPL_P001_SYSTEM_MESSAGE,
    userTemplate: NPL_P001_USER_TEMPLATE,
    examples: NPL_P001_EXAMPLES
  },
  "P-002": {
    metadata: NPL_P002_METADATA,
    systemMessage: NPL_P002_SYSTEM_MESSAGE,
    userTemplate: NPL_P002_USER_TEMPLATE,
    examples: NPL_P002_EXAMPLES
  },
  "P-002C": {
    metadata: NPL_P002C_METADATA,
    systemMessage: NPL_P002C_SYSTEM_MESSAGE,
    userTemplate: NPL_P002C_USER_TEMPLATE,
    examples: NPL_P002C_EXAMPLES
  },
  "P-003": {
    metadata: NPL_P003_METADATA,
    systemMessage: NPL_P003_SYSTEM_MESSAGE,
    userTemplate: NPL_P003_USER_TEMPLATE,
    examples: NPL_P003_EXAMPLES
  },
  "P-004": {
    metadata: NPL_P004_METADATA,
    systemMessage: NPL_P004_SYSTEM_MESSAGE,
    userTemplate: NPL_P004_USER_TEMPLATE,
    examples: NPL_P004_EXAMPLES
  },
  "P-005": {
    metadata: NPL_P005_METADATA,
    systemMessage: NPL_P005_SYSTEM_MESSAGE,
    userTemplate: NPL_P005_USER_TEMPLATE,
    examples: NPL_P005_EXAMPLES
  },
  "P-006": {
    metadata: NPL_P006_METADATA,
    systemMessage: NPL_P006_SYSTEM_MESSAGE,
    userTemplate: NPL_P006_USER_TEMPLATE,
    examples: NPL_P006_EXAMPLES
  },
  "P-007": {
    metadata: NPL_P007_METADATA,
    systemMessage: NPL_P007_SYSTEM_MESSAGE,
    userTemplate: NPL_P007_USER_TEMPLATE,
    examples: NPL_P007_EXAMPLES
  },
  "P-008": {
    metadata: NPL_P008_METADATA,
    systemMessage: NPL_P008_SYSTEM_MESSAGE,
    userTemplate: "{{RETRIEVED_CONTEXT}}\n{{CONVERSATION_HISTORY}}",
    examples: NPL_P008_EXAMPLES
  },
  "P-009": {
    metadata: NPL_P009_METADATA,
    systemMessage: NPL_P009_SYSTEM_MESSAGE,
    userTemplate: NPL_P009_USER_TEMPLATE,
    examples: NPL_P009_EXAMPLES
  },
  "P-010": {
    metadata: NPL_P010_METADATA,
    systemMessage: NPL_P010_SYSTEM_MESSAGE,
    userTemplate: NPL_P010_SYSTEM_MESSAGE,
    // Storm-009 inline format — system IS the template
    examples: NPL_P010_EXAMPLES
  },
  "P-010B": {
    metadata: NPL_P010B_METADATA,
    systemMessage: NPL_P010B_SYSTEM_MESSAGE,
    userTemplate: NPL_P010B_USER_TEMPLATE,
    examples: NPL_P010B_EXAMPLES
  },
  "P-011": {
    metadata: NPL_P011_METADATA,
    systemMessage: NPL_P011_SYSTEM_MESSAGE,
    userTemplate: NPL_P011_USER_TEMPLATE,
    examples: NPL_P011_EXAMPLES
  }
};
function nplGetPrompt(id) {
  return NPL_PROMPT_REGISTRY[id];
}
function nplGetAllPromptIds() {
  return NPL_PROMPT_IDS;
}
function nplGetCacheContent(type) {
  switch (type) {
    case "classifier":
      return NPL_P001_SYSTEM_MESSAGE;
    case "extractor":
      return NPL_P003_SYSTEM_MESSAGE;
    case "responder":
      return NPL_P008_SYSTEM_MESSAGE;
  }
}
var ATSS_TOOL_NAMES = [
  "view_node",
  "search",
  "create_node",
  "update_node",
  "delete_node",
  "create_edge",
  "delete_edge",
  "link_to_cluster",
  "bulk_operations"
];
var AtssToolNameSchema = z.enum(ATSS_TOOL_NAMES);
var ATSS_TOOL_CATEGORIES = ["read", "write", "destructive"];
var AtssToolCategorySchema = z.enum(ATSS_TOOL_CATEGORIES);
var ATSS_TOOL_TO_CATEGORY = {
  view_node: "read",
  search: "read",
  create_node: "write",
  update_node: "write",
  delete_node: "destructive",
  create_edge: "write",
  delete_edge: "write",
  link_to_cluster: "write",
  bulk_operations: "destructive"
};
var ATSS_CONFIRMATION_LEVELS = ["none", "inform", "confirm"];
var AtssConfirmationLevelSchema = z.enum(ATSS_CONFIRMATION_LEVELS);
var ATSS_TOOL_CONFIRMATION = {
  view_node: "none",
  search: "none",
  create_node: "inform",
  update_node: "confirm",
  delete_node: "confirm",
  create_edge: "inform",
  delete_edge: "confirm",
  link_to_cluster: "inform",
  bulk_operations: "confirm"
};
var ATSS_UNDO_TTL_SECONDS = {
  view_node: 0,
  search: 0,
  create_node: 86400,
  // 24 hours
  update_node: 3600,
  // 1 hour
  delete_node: 2592e3,
  // 30 days
  create_edge: 86400,
  // 24 hours
  delete_edge: 86400,
  // 24 hours
  link_to_cluster: 3600,
  // 1 hour
  bulk_operations: 86400
  // 24 hours
};
var ATSS_QUICK_UNDO_SECONDS = 300;
var ATSS_UNDO_STATUSES = ["undoable", "undone", "expired", "redone"];
var AtssUndoStatusSchema = z.enum(ATSS_UNDO_STATUSES);
var ATSS_CREDIT_COSTS = {
  view_node: 0,
  search: 0,
  create_node: 3,
  update_node: 3,
  delete_node: 1,
  create_edge: 1,
  delete_edge: 1,
  link_to_cluster: 1,
  bulk_operations: 0
};
var ATSS_TIERS = ["free", "credits", "pro"];
var AtssTierSchema = z.enum(ATSS_TIERS);
var ATSS_RATE_LIMITS = {
  view_node: { perSecond: 20, burst: 50 },
  search: { perSecond: 5, burst: 10 },
  create_node: { perSecond: 5, burst: 10 },
  update_node: { perSecond: 5, burst: 10 },
  delete_node: { perSecond: 2, burst: 5 },
  create_edge: { perSecond: 10, burst: 20 },
  delete_edge: { perSecond: 5, burst: 10 },
  link_to_cluster: { perSecond: 5, burst: 10 },
  bulk_operations: { perSecond: 1, burst: 3 }
};
var ATSS_CIRCUIT_BREAKER_MAX_FAILURES = 3;
var ATSS_TOOL_TIMEOUT_MS = 1e4;
var ATSS_CIRCUIT_BREAKER_STATES = ["closed", "open", "half_open"];
var AtssCircuitBreakerStateSchema = z.enum(ATSS_CIRCUIT_BREAKER_STATES);
var ATSS_BULK_MODES = ["all_or_nothing", "continue_on_error"];
var AtssBulkModeSchema = z.enum(ATSS_BULK_MODES);
var ATSS_ERROR_PREFIXES = [
  "E400",
  "E403",
  "E404",
  "E409",
  "E429",
  "E500",
  "E503",
  "E504"
];
var ATSS_TOOL_DESCRIPTIONS = {
  view_node: "View one or more nodes by ID, including content, metadata, and connections",
  search: "Search the knowledge graph by query with optional filters",
  create_node: "Create a new node in the knowledge graph",
  update_node: "Update an existing node's title, content, tags, or cluster",
  delete_node: "Delete a node (soft-delete with restore window)",
  create_edge: "Create a relationship edge between two nodes",
  delete_edge: "Delete a relationship edge",
  link_to_cluster: "Assign a node to a cluster (sets primary affinity)",
  bulk_operations: "Execute multiple tool operations in a single transaction"
};
var ATSS_MAX_NODE_IDS_PER_VIEW = 20;
var ATSS_MAX_SEARCH_LIMIT = 50;
var ATSS_DEFAULT_SEARCH_LIMIT = 10;
var ATSS_MAX_CONTENT_LENGTH = 5e3;
var ATSS_DEFAULT_MAX_CONTENT_LENGTH = 2e3;
var ATSS_MAX_TAGS = 20;
var ATSS_MAX_BULK_OPERATIONS = 50;
var ATSS_MIN_SEARCH_SCORE = 0;
var ATSS_DEFAULT_MIN_SEARCH_SCORE = 0.3;
var ATSS_UPDATE_CONFIDENCE_THRESHOLD = 0.8;
var ATSS_TRANSACTION_ID_PREFIX = "tx_";
var ATSS_UNDO_ID_PREFIX = "undo_";
var ATSS_BULK_REFERENCE_PATTERNS = {
  byIndex: /^\{\{(\d+)\.(\w+)\}\}$/,
  byId: /^\{\{([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+)\}\}$/,
  byLast: /^\{\{\$last\.(\w+)\}\}$/
};
var ATSS_INVERSE_OPERATIONS = {
  view_node: null,
  search: null,
  create_node: "delete_node",
  update_node: "update_node",
  delete_node: "create_node",
  create_edge: "delete_edge",
  delete_edge: "create_edge",
  link_to_cluster: "link_to_cluster",
  bulk_operations: "bulk_operations"
};
var ATSS_ERROR_CODES = {
  // 400 Bad Request
  E400_INVALID_PARAMS: { code: "E400_INVALID_PARAMS", http: 400, message: "Invalid parameters provided" },
  E400_MISSING_REQUIRED: { code: "E400_MISSING_REQUIRED", http: 400, message: "Required parameter missing" },
  E400_INVALID_NODE_TYPE: { code: "E400_INVALID_NODE_TYPE", http: 400, message: "Invalid node type" },
  E400_INVALID_EDGE_TYPE: { code: "E400_INVALID_EDGE_TYPE", http: 400, message: "Invalid edge type" },
  E400_CONTENT_TOO_LONG: { code: "E400_CONTENT_TOO_LONG", http: 400, message: "Content exceeds maximum length" },
  E400_TOO_MANY_TAGS: { code: "E400_TOO_MANY_TAGS", http: 400, message: "Too many tags" },
  E400_TOO_MANY_NODE_IDS: { code: "E400_TOO_MANY_NODE_IDS", http: 400, message: "Too many node IDs in single request" },
  E400_TOO_MANY_BULK_OPS: { code: "E400_TOO_MANY_BULK_OPS", http: 400, message: "Too many operations in bulk request" },
  E400_INVALID_BULK_REFERENCE: { code: "E400_INVALID_BULK_REFERENCE", http: 400, message: "Invalid bulk operation reference syntax" },
  E400_SELF_EDGE: { code: "E400_SELF_EDGE", http: 400, message: "Cannot create edge from node to itself" },
  // 403 Forbidden
  E403_INSUFFICIENT_CREDITS: { code: "E403_INSUFFICIENT_CREDITS", http: 403, message: "Insufficient credits" },
  E403_TIER_RESTRICTED: { code: "E403_TIER_RESTRICTED", http: 403, message: "Operation not available on current tier" },
  E403_CONFIRMATION_DENIED: { code: "E403_CONFIRMATION_DENIED", http: 403, message: "User denied confirmation" },
  E403_CIRCUIT_BREAKER_OPEN: { code: "E403_CIRCUIT_BREAKER_OPEN", http: 403, message: "Circuit breaker is open - too many failures" },
  // 404 Not Found
  E404_NODE_NOT_FOUND: { code: "E404_NODE_NOT_FOUND", http: 404, message: "Node not found" },
  E404_EDGE_NOT_FOUND: { code: "E404_EDGE_NOT_FOUND", http: 404, message: "Edge not found" },
  E404_CLUSTER_NOT_FOUND: { code: "E404_CLUSTER_NOT_FOUND", http: 404, message: "Cluster not found" },
  E404_UNDO_ENTRY_NOT_FOUND: { code: "E404_UNDO_ENTRY_NOT_FOUND", http: 404, message: "Undo entry not found" },
  // 409 Conflict
  E409_DUPLICATE_EDGE: { code: "E409_DUPLICATE_EDGE", http: 409, message: "Edge already exists between these nodes" },
  E409_UNDO_EXPIRED: { code: "E409_UNDO_EXPIRED", http: 409, message: "Undo window has expired" },
  E409_UNDO_DEPENDENCY: { code: "E409_UNDO_DEPENDENCY", http: 409, message: "Cannot undo - dependent operations exist" },
  E409_ALREADY_UNDONE: { code: "E409_ALREADY_UNDONE", http: 409, message: "Operation already undone" },
  // 429 Rate Limited
  E429_RATE_LIMITED: { code: "E429_RATE_LIMITED", http: 429, message: "Rate limit exceeded" },
  // 500 Internal Server Error
  E500_INTERNAL: { code: "E500_INTERNAL", http: 500, message: "Internal server error" },
  // 503 Service Unavailable
  E503_LLM_UNAVAILABLE: { code: "E503_LLM_UNAVAILABLE", http: 503, message: "LLM service unavailable" },
  // 504 Timeout
  E504_TOOL_TIMEOUT: { code: "E504_TOOL_TIMEOUT", http: 504, message: "Tool execution timed out" }
};
var ATSS_ERROR_CODE_KEYS = Object.keys(ATSS_ERROR_CODES);
var ATSS_TIER_CONFIGS = {
  free: { is_student: false, daily_credit_limit: 5, can_bulk: false, max_bulk_operations: 0 },
  credits: { is_student: false, can_bulk: true, max_bulk_operations: ATSS_MAX_BULK_OPERATIONS },
  pro: { is_student: false, can_bulk: true, max_bulk_operations: ATSS_MAX_BULK_OPERATIONS }
};
var ATSS_RETRYABLE_ERROR_CODES = [
  "E429_RATE_LIMITED",
  "E503_LLM_UNAVAILABLE",
  "E504_TOOL_TIMEOUT"
];
var ATSS_SYNTHESIZE_FORMATS = {
  view_node: "Retrieved {count} node(s): {titles}",
  search: 'Found {total_count} result(s) for "{query}". Top: {top_titles}',
  create_node: 'Created {type} node "{title}" (ID: {node_id})',
  update_node: 'Updated {updated_fields} on node "{title}" (ID: {node_id})',
  delete_node: 'Deleted node "{node_title}" (ID: {node_id}). Restorable until {restore_deadline}. {edges_affected} edge(s) affected.',
  create_edge: 'Created {relation_type} edge: "{source_title}" \u2192 "{target_title}"',
  delete_edge: 'Deleted {relation_type} edge between "{source_title}" and "{target_title}"',
  link_to_cluster: 'Moved node "{node_title}" to cluster "{new_cluster}"',
  bulk_operations: "Executed {success_count}/{total} operation(s). Credits: {total_credits}"
};
var AtssNodeSummarySchema = z.object({
  node_id: z.string(),
  title: z.string(),
  type: z.enum(NODE_TYPES),
  cluster: z.string().optional()
});
var ATSS_CONNECTION_DIRECTIONS = ["outgoing", "incoming"];
var AtssViewNodeParamsSchema = z.object({
  node_ids: z.array(z.string()).min(1).max(ATSS_MAX_NODE_IDS_PER_VIEW),
  include_metadata: z.boolean().default(false),
  include_connections: z.boolean().default(false),
  max_content_length: z.number().int().min(1).max(ATSS_MAX_CONTENT_LENGTH).default(ATSS_DEFAULT_MAX_CONTENT_LENGTH),
  include_deleted: z.boolean().default(false)
});
var AtssNodeMetadataSchema = z.object({
  stability: z.number().min(0).max(1),
  retrievability: z.number().min(0).max(1),
  access_count: z.number().int().min(0),
  lifecycle_state: z.enum(LIFECYCLE_STATES)
});
var AtssNodeConnectionSchema = z.object({
  edge_id: z.string(),
  target_id: z.string(),
  target_title: z.string(),
  relation_type: z.enum(EDGE_TYPES),
  weight: z.number().min(0).max(1),
  direction: z.enum(ATSS_CONNECTION_DIRECTIONS)
});
var AtssViewedNodeSchema = z.object({
  node_id: z.string(),
  title: z.string(),
  type: z.enum(NODE_TYPES),
  content: z.string(),
  tags: z.array(z.string()),
  cluster: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  metadata: AtssNodeMetadataSchema.optional(),
  connections: z.array(AtssNodeConnectionSchema).optional()
});
var AtssViewNodeResultSchema = z.object({
  success: z.boolean(),
  nodes: z.array(AtssViewedNodeSchema),
  not_found: z.array(z.string()),
  truncated_count: z.number().int().min(0)
});
var AtssSearchFiltersSchema = z.object({
  types: z.array(z.enum(NODE_TYPES)).optional(),
  clusters: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  date_range: z.object({
    start: z.string().datetime().optional(),
    end: z.string().datetime().optional()
  }).optional()
});
var AtssSearchParamsSchema = z.object({
  query: z.string().min(1),
  filters: AtssSearchFiltersSchema.optional(),
  limit: z.number().int().min(1).max(ATSS_MAX_SEARCH_LIMIT).default(ATSS_DEFAULT_SEARCH_LIMIT),
  include_similar: z.boolean().default(false),
  min_score: z.number().min(0).max(1).default(ATSS_DEFAULT_MIN_SEARCH_SCORE)
});
var AtssSearchResultItemSchema = z.object({
  node_id: z.string(),
  title: z.string(),
  snippet: z.string(),
  score: z.number().min(0).max(1),
  type: z.enum(NODE_TYPES),
  cluster: z.string().optional(),
  tags: z.array(z.string()),
  last_accessed: z.string().datetime().optional()
});
var AtssSearchResultSchema = z.object({
  success: z.boolean(),
  results: z.array(AtssSearchResultItemSchema),
  total_count: z.number().int().min(0),
  has_more: z.boolean(),
  query_interpretation: z.string().optional()
});
var AtssCreateNodeParamsSchema = z.object({
  type: z.enum(NODE_TYPES),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(ATSS_MAX_CONTENT_LENGTH),
  tags: z.array(z.string()).max(ATSS_MAX_TAGS).default([]),
  cluster_id: z.string().optional(),
  source: z.string().optional(),
  dry_run: z.boolean().default(false)
});
var AtssCreateNodeResultSchema = z.object({
  success: z.boolean(),
  node_id: z.string(),
  created_at: z.string().datetime(),
  cluster_assigned: z.string().optional(),
  similar_nodes: z.array(AtssNodeSummarySchema),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional()
});
var AtssNodeChangesSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(ATSS_MAX_CONTENT_LENGTH).optional(),
  tags: z.array(z.string()).max(ATSS_MAX_TAGS).optional(),
  cluster_id: z.string().optional(),
  type: z.enum(NODE_TYPES).optional()
}).refine(
  (data) => Object.values(data).some((v) => v !== void 0),
  { message: "At least one change field must be specified" }
);
var AtssUpdateNodeParamsSchema = z.object({
  node_id: z.string(),
  changes: AtssNodeChangesSchema,
  confidence: z.number().min(0).max(1).default(1),
  dry_run: z.boolean().default(false)
});
var AtssUpdateNodeResultSchema = z.object({
  success: z.boolean(),
  node_id: z.string(),
  updated_fields: z.array(z.string()),
  previous_values: z.record(z.unknown()),
  updated_at: z.string().datetime(),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional()
});
var AtssDeleteNodeParamsSchema = z.object({
  node_id: z.string(),
  reason: z.string().optional(),
  cascade_edges: z.boolean().default(true),
  dry_run: z.boolean().default(false)
});
var AtssDeleteNodeResultSchema = z.object({
  success: z.boolean(),
  node_id: z.string(),
  node_title: z.string(),
  deleted_at: z.string().datetime(),
  restore_deadline: z.string().datetime(),
  edges_affected: z.number().int().min(0),
  edge_ids_affected: z.array(z.string()),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional()
});
var AtssCreateEdgeParamsSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  relation_type: z.enum(EDGE_TYPES),
  weight: z.number().min(0).max(1).default(0.5),
  bidirectional: z.boolean().default(false),
  dry_run: z.boolean().default(false)
}).refine(
  (data) => data.source_id !== data.target_id,
  { message: "Cannot create edge from node to itself", path: ["target_id"] }
);
var AtssCreateEdgeResultSchema = z.object({
  success: z.boolean(),
  edge_id: z.string(),
  reverse_edge_id: z.string().optional(),
  source_title: z.string(),
  target_title: z.string(),
  created_at: z.string().datetime(),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional()
});
var AtssDeleteEdgeParamsSchema = z.object({
  edge_id: z.string(),
  dry_run: z.boolean().default(false)
});
var AtssDeleteEdgeResultSchema = z.object({
  success: z.boolean(),
  edge_id: z.string(),
  source_title: z.string(),
  target_title: z.string(),
  relation_type: z.enum(EDGE_TYPES),
  deleted_at: z.string().datetime(),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional()
});
var AtssLinkToClusterParamsSchema = z.object({
  node_id: z.string(),
  cluster_id: z.string(),
  create_if_missing: z.boolean().default(false),
  dry_run: z.boolean().default(false)
});
var AtssLinkToClusterResultSchema = z.object({
  success: z.boolean(),
  node_id: z.string(),
  node_title: z.string(),
  previous_cluster: z.string().optional(),
  new_cluster: z.string(),
  cluster_created: z.boolean(),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional()
});
var AtssBulkOperationItemSchema = z.object({
  tool: AtssToolNameSchema,
  params: z.record(z.unknown()),
  id: z.string().optional()
});
var AtssBulkOperationsParamsSchema = z.object({
  operations: z.array(AtssBulkOperationItemSchema).min(1).max(ATSS_MAX_BULK_OPERATIONS),
  mode: AtssBulkModeSchema,
  dry_run: z.boolean().default(false)
});
var AtssBulkOperationResultItemSchema = z.object({
  id: z.string().optional(),
  tool: AtssToolNameSchema,
  success: z.boolean(),
  result: z.record(z.unknown()).optional(),
  error: z.object({
    error: z.literal(true),
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    tool: AtssToolNameSchema.optional(),
    timestamp: z.string().datetime()
  }).optional()
});
var AtssBulkOperationsResultSchema = z.object({
  success: z.boolean(),
  transaction_id: z.string(),
  results: z.array(AtssBulkOperationResultItemSchema),
  success_count: z.number().int().min(0),
  failure_count: z.number().int().min(0),
  rolled_back: z.boolean(),
  total_credits: z.number().min(0),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional(),
  _schemaVersion: z.number()
});
var AtssUndoEntrySchema = z.object({
  id: z.string().regex(/^undo_[a-zA-Z0-9_-]{12}$/),
  _schemaVersion: z.number(),
  timestamp: z.string().datetime(),
  expires_at: z.string().datetime(),
  quick_undo_until: z.string().datetime(),
  tool: AtssToolNameSchema,
  params: z.record(z.unknown()),
  result: z.record(z.unknown()),
  inverse_tool: AtssToolNameSchema,
  inverse_params: z.record(z.unknown()),
  status: AtssUndoStatusSchema,
  depends_on: z.array(z.string()),
  enables: z.array(z.string()),
  user_id: z.string(),
  session_id: z.string(),
  credit_cost: z.number().min(0)
});
var AtssUndoRequestSchema = z.object({
  entry_id: z.string().optional()
});
var AtssUndoResultSchema = z.object({
  success: z.boolean(),
  entry_id: z.string(),
  tool: AtssToolNameSchema,
  status: AtssUndoStatusSchema,
  credits_refunded: z.number().min(0),
  warning: z.string().optional()
});
var AtssRedoRequestSchema = z.object({
  entry_id: z.string()
});
var AtssRedoResultSchema = z.object({
  success: z.boolean(),
  entry_id: z.string(),
  tool: AtssToolNameSchema,
  status: AtssUndoStatusSchema,
  credits_charged: z.number().min(0)
});
var AtssUndoMultipleRequestSchema = z.object({
  entry_ids: z.array(z.string()).min(1)
});
var AtssUndoMultipleResultSchema = z.object({
  success: z.boolean(),
  results: z.array(AtssUndoResultSchema),
  total_credits_refunded: z.number().min(0)
});
var AtssConfirmationRequestSchema = z.object({
  tool: AtssToolNameSchema,
  params: z.record(z.unknown()),
  confirmation_level: AtssConfirmationLevelSchema,
  credit_cost: z.number().min(0),
  description: z.string()
});
var AtssConfirmationResponseSchema = z.object({
  approved: z.boolean(),
  modified_params: z.record(z.unknown()).optional()
});
var AtssTierConfigSchema = z.object({
  tier: AtssTierSchema,
  is_student: z.boolean(),
  daily_credit_limit: z.number().int().min(0).optional(),
  can_bulk: z.boolean(),
  max_bulk_operations: z.number().int().min(0)
});
var AtssCircuitBreakerSchema = z.object({
  state: AtssCircuitBreakerStateSchema,
  consecutive_failures: z.number().int().min(0),
  last_failure_at: z.string().datetime().optional(),
  last_success_at: z.string().datetime().optional(),
  tripped_at: z.string().datetime().optional()
});
var AtssRateLimitStateSchema = z.object({
  tool: AtssToolNameSchema,
  window_start: z.string().datetime(),
  request_count: z.number().int().min(0),
  burst_count: z.number().int().min(0)
});
var AtssDryRunResultSchema = z.object({
  would_succeed: z.boolean(),
  credits_required: z.number().min(0),
  confirmation_required: AtssConfirmationLevelSchema,
  side_effects: z.array(z.string()),
  warnings: z.array(z.string())
});
var AtssErrorResponseSchema = z.object({
  error: z.literal(true),
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  tool: AtssToolNameSchema.optional(),
  timestamp: z.string().datetime()
});

// src/agent-tools/index.ts
function generateTransactionId() {
  return ATSS_TRANSACTION_ID_PREFIX + nanoid(NANOID_LENGTH);
}
function generateUndoId() {
  return ATSS_UNDO_ID_PREFIX + nanoid(NANOID_LENGTH);
}
var ATSS_TOOL_DEFINITIONS = Object.fromEntries(
  ATSS_TOOL_NAMES.map((name) => [
    name,
    {
      name,
      category: ATSS_TOOL_TO_CATEGORY[name],
      description: ATSS_TOOL_DESCRIPTIONS[name],
      confirmation: ATSS_TOOL_CONFIRMATION[name],
      credit_cost: ATSS_CREDIT_COSTS[name],
      undo_ttl_seconds: ATSS_UNDO_TTL_SECONDS[name],
      rate_limit: ATSS_RATE_LIMITS[name],
      synthesize_format: ATSS_SYNTHESIZE_FORMATS[name]
    }
  ])
);
function getToolDefinition(name) {
  return ATSS_TOOL_DEFINITIONS[name];
}
function buildInverseParams(tool, params, result) {
  switch (tool) {
    case "create_node":
      return { node_id: result["node_id"], cascade_edges: true };
    case "update_node":
      return {
        node_id: params["node_id"],
        changes: result["previous_values"]
      };
    case "delete_node":
      return { ...params, restore: true, node_id: params["node_id"] };
    case "create_edge":
      return { edge_id: result["edge_id"] };
    case "delete_edge":
      return { ...params };
    case "link_to_cluster":
      return {
        node_id: params["node_id"],
        cluster_id: result["previous_cluster"]
      };
    case "bulk_operations":
      return { inverse_of_bulk: true, original_params: params };
    default:
      return {};
  }
}
function createUndoEntry(tool, params, result, userId, sessionId) {
  const inverseTool = ATSS_INVERSE_OPERATIONS[tool];
  if (inverseTool === null) {
    return null;
  }
  const ttlSeconds = ATSS_UNDO_TTL_SECONDS[tool] ?? 0;
  if (ttlSeconds === 0) {
    return null;
  }
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1e3);
  const quickUndoUntil = new Date(now.getTime() + ATSS_QUICK_UNDO_SECONDS * 1e3);
  const creditCost = ATSS_CREDIT_COSTS[tool] ?? 0;
  const inverseParams = buildInverseParams(tool, params, result);
  return {
    id: generateUndoId(),
    _schemaVersion: 1,
    timestamp: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    quick_undo_until: quickUndoUntil.toISOString(),
    tool,
    params,
    result,
    inverse_tool: inverseTool,
    inverse_params: inverseParams,
    status: "undoable",
    depends_on: [],
    enables: [],
    user_id: userId,
    session_id: sessionId,
    credit_cost: creditCost
  };
}
function isUndoable(entry) {
  if (entry.status !== "undoable") {
    return false;
  }
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(entry.expires_at);
  return now < expiresAt;
}
function isQuickUndoWindow(entry) {
  const now = /* @__PURE__ */ new Date();
  const quickUntil = new Date(entry.quick_undo_until);
  return now < quickUntil && entry.status === "undoable";
}
function getInverseOperation(entry) {
  const inverseTool = ATSS_INVERSE_OPERATIONS[entry.tool];
  if (inverseTool === null) {
    return null;
  }
  return {
    tool: inverseTool,
    params: entry.inverse_params
  };
}
function checkDependencies(entry, allEntries) {
  const blockedBy = [];
  for (const other of allEntries) {
    if (other.depends_on.includes(entry.id) && other.status === "undoable") {
      blockedBy.push(other.id);
    }
  }
  return {
    canUndo: blockedBy.length === 0,
    blockedBy
  };
}
function getConfirmationLevel(tool, params) {
  const baseLevel = ATSS_TOOL_CONFIRMATION[tool];
  if (tool === "update_node") {
    const confidence = typeof params["confidence"] === "number" ? params["confidence"] : 1;
    if (confidence < ATSS_UPDATE_CONFIDENCE_THRESHOLD) {
      return "confirm";
    }
  }
  return baseLevel;
}
function checkCreditSufficiency(cost, balance) {
  const shortfall = Math.max(0, cost - balance);
  return {
    sufficient: cost <= balance,
    shortfall
  };
}
function calculateBulkCost(operations) {
  let total = 0;
  for (const op of operations) {
    const cost = ATSS_CREDIT_COSTS[op.tool] ?? 0;
    total += cost;
  }
  return total;
}
function shouldRequireConfirmation(tool, params) {
  const level = getConfirmationLevel(tool, params);
  return level === "confirm";
}
function createCircuitBreaker() {
  return {
    state: "closed",
    consecutive_failures: 0
  };
}
function tripCircuitBreaker(breaker) {
  return {
    ...breaker,
    state: "open",
    tripped_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function resetCircuitBreaker(breaker) {
  return {
    ...breaker,
    state: "closed",
    consecutive_failures: 0,
    tripped_at: void 0
  };
}
function atssRecordSuccess(breaker) {
  return {
    ...breaker,
    state: "closed",
    consecutive_failures: 0,
    last_success_at: (/* @__PURE__ */ new Date()).toISOString(),
    tripped_at: void 0
  };
}
function atssRecordFailure(breaker) {
  const newFailures = breaker.consecutive_failures + 1;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (newFailures >= ATSS_CIRCUIT_BREAKER_MAX_FAILURES) {
    return {
      ...breaker,
      state: "open",
      consecutive_failures: newFailures,
      last_failure_at: now,
      tripped_at: now
    };
  }
  return {
    ...breaker,
    consecutive_failures: newFailures,
    last_failure_at: now
  };
}
function shouldAllowRequest(breaker) {
  switch (breaker.state) {
    case "closed":
      return true;
    case "open":
      return false;
    case "half_open":
      return true;
    default:
      return false;
  }
}
function checkRateLimit(state, tool) {
  const limits = ATSS_RATE_LIMITS[tool];
  if (!limits) {
    return { allowed: true };
  }
  const now = Date.now();
  const windowStart = new Date(state.window_start).getTime();
  const windowMs = 1e3;
  if (now - windowStart >= windowMs) {
    return { allowed: true };
  }
  if (state.request_count >= limits.perSecond) {
    if (state.burst_count >= limits.burst) {
      const retryAfterMs = windowMs - (now - windowStart);
      return { allowed: false, retry_after_ms: retryAfterMs };
    }
  }
  return { allowed: true };
}
function recordRateLimitRequest(state) {
  const now = /* @__PURE__ */ new Date();
  const windowStart = new Date(state.window_start);
  const windowMs = 1e3;
  if (now.getTime() - windowStart.getTime() >= windowMs) {
    return {
      ...state,
      window_start: now.toISOString(),
      request_count: 1,
      burst_count: 0
    };
  }
  const limits = ATSS_RATE_LIMITS[state.tool];
  const newCount = state.request_count + 1;
  return {
    ...state,
    request_count: newCount,
    burst_count: limits && newCount > limits.perSecond ? state.burst_count + 1 : state.burst_count
  };
}
function executeDryRun(tool, params) {
  const creditCost = ATSS_CREDIT_COSTS[tool] ?? 0;
  const confirmationLevel = getConfirmationLevel(tool, params);
  const sideEffects = [];
  const warnings = [];
  if (tool === "update_node") {
    const confidence = typeof params["confidence"] === "number" ? params["confidence"] : 1;
    if (confidence < ATSS_UPDATE_CONFIDENCE_THRESHOLD) {
      warnings.push(`Low confidence (${confidence}) - confirmation required`);
    }
  }
  switch (tool) {
    case "create_node":
      sideEffects.push("New node will be created in knowledge graph");
      sideEffects.push("Cluster auto-assignment may occur");
      sideEffects.push("Similar nodes will be checked for deduplication");
      break;
    case "update_node":
      sideEffects.push("Node content/metadata will be modified");
      sideEffects.push("Previous values stored for undo");
      break;
    case "delete_node":
      sideEffects.push("Node will be soft-deleted (restorable)");
      if (params["cascade_edges"] !== false) {
        sideEffects.push("Connected edges will be removed");
      }
      break;
    case "create_edge":
      sideEffects.push("New edge will connect two nodes");
      if (params["bidirectional"] === true) {
        sideEffects.push("Reverse edge will also be created");
      }
      break;
    case "delete_edge":
      sideEffects.push("Edge will be removed from the graph");
      break;
    case "link_to_cluster":
      sideEffects.push("Node primary cluster affinity will change");
      if (params["create_if_missing"] === true) {
        sideEffects.push("New cluster may be created");
      }
      break;
    case "bulk_operations":
      sideEffects.push("Multiple operations will execute in sequence");
      break;
  }
  return {
    would_succeed: true,
    credits_required: creditCost,
    confirmation_required: confirmationLevel,
    side_effects: sideEffects,
    warnings
  };
}
function createErrorResponse(code, tool, details) {
  const errorDef = ATSS_ERROR_CODES[code];
  return {
    error: true,
    code: errorDef.code,
    message: errorDef.message,
    details,
    tool,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function getHttpStatus(code) {
  return ATSS_ERROR_CODES[code].http;
}
function isRetryable(code) {
  return ATSS_RETRYABLE_ERROR_CODES.includes(code);
}
var CW_SCHEMA_VERSION = 1;
var DEFAULT_SYSTEM_PROMPT_TOKENS = 3e3;
var DEFAULT_MIN_USER_TOKENS = 2e3;
var PROVIDER_RETRIEVAL_RATIOS = {
  anthropic: 0.7,
  openai: 0.65,
  google: 0.7
};
var DEFAULT_RESPONSE_BUFFERS = {
  "claude-sonnet-4": 16e3,
  "claude-3-haiku": 8e3,
  "gpt-4o": 12e3,
  "gpt-4o-mini": 8e3,
  "gemini-2.0-flash": 12e3,
  "gemini-2.0-flash-lite": 8e3
};
var DEFAULT_RESPONSE_BUFFER_FALLBACK = 12e3;
var PRIORITY_WEIGHT_NAMES = [
  "retrieval_score",
  "query_mentioned",
  "recency",
  "connectivity",
  "importance"
];
var PriorityWeightNameSchema = z.enum(PRIORITY_WEIGHT_NAMES);
function isPriorityWeightName(value) {
  return PRIORITY_WEIGHT_NAMES.includes(value);
}
var DEFAULT_PRIORITY_WEIGHTS = {
  retrieval_score: 0.4,
  query_mentioned: 0.25,
  recency: 0.15,
  connectivity: 0.1,
  importance: 0.1
};
var RECENCY_HALF_LIFE_DAYS = 20;
var CONNECTIVITY_CAP_FACTOR = 0.3;
var TRUNCATION_TIERS = [
  "use_summary",
  "semantic_truncation",
  "extract_relevant",
  "hard_truncation"
];
var TruncationTierSchema = z.enum(TRUNCATION_TIERS);
function isTruncationTier(value) {
  return TRUNCATION_TIERS.includes(value);
}
var TRUNCATION_MAX_LATENCY_MS = 100;
var TRUNCATION_TIER_LATENCIES = {
  use_summary: 0,
  semantic_truncation: 10,
  extract_relevant: 80,
  hard_truncation: 1
};
var SEMANTIC_TRUNCATION_KEEP_START = 0.6;
var SEMANTIC_TRUNCATION_KEEP_END = 0.2;
var SPARSE_RETRIEVAL_THRESHOLD = 1e3;
var SPARSE_EXTRA_RESPONSE_BUFFER = 4e3;
var CONVERSATION_RECENT_TURNS = 6;
var CONVERSATION_RECENT_MAX_TOKENS = 8e3;
var SUMMARIZATION_TURN_TRIGGER = 10;
var SUMMARIZATION_TOKEN_TRIGGER = 2e4;
var SUMMARIZATION_MODEL = "gpt-4o-mini";
var SUMMARIZATION_INPUT_BUDGET = 1e4;
var SUMMARIZATION_OUTPUT_BUDGET = 2e3;
var SUMMARIZATION_COMPRESSION_TARGET = 0.25;
var CHUNKING_TRIGGER_TOKENS = 2e3;
var CHUNK_TARGET_MIN = 500;
var CHUNK_TARGET_MAX = 1500;
var CHUNK_HARD_MAX = 3e3;
var CHUNK_ABSOLUTE_MAX = 5e3;
var CHUNK_MIN_TOKENS = 100;
var CHUNK_MIN_SENTENCES = 3;
var CHUNK_OVERLAP_TOKENS = 100;
var CHUNK_OVERLAP_IN_EMBEDDING = false;
var CHUNK_EMBEDDING_MAX = 7500;
var CHUNK_LEVELS = ["document", "section", "paragraph"];
var ChunkLevelSchema = z.enum(CHUNK_LEVELS);
function isChunkLevel(value) {
  return CHUNK_LEVELS.includes(value);
}
var CHUNK_EDGE_TYPES = ["chunk_of", "section_of", "follows", "contains"];
var ChunkEdgeTypeSchema = z.enum(CHUNK_EDGE_TYPES);
function isChunkEdgeType(value) {
  return CHUNK_EDGE_TYPES.includes(value);
}
var CHUNK_EXPANSION_MAX_TOKENS = 1500;
var CHUNK_ADJACENT_COUNT = 1;
var CHUNK_SAME_DOC_THRESHOLD = 2;
var CHUNK_HIGH_COUNT_THRESHOLD = 4;
var TOKEN_ESTIMATE_CHARS_PER_TOKEN = 3.5;
var FixedAllocationsSchema = z.object({
  system_prompt: z.number().int().nonnegative(),
  min_user_message: z.number().int().nonnegative(),
  response_buffer: z.number().int().nonnegative()
});
var ModelContextBudgetSchema = z.object({
  model_id: z.string().min(1),
  total_context: z.number().int().nonnegative(),
  fixed: FixedAllocationsSchema,
  flexible_pool: z.number().int().nonnegative(),
  retrieval_ratio: z.number().min(0).max(1),
  default_retrieved: z.number().int().nonnegative(),
  default_history: z.number().int().nonnegative()
});
var ContextAllocationRequestSchema = z.object({
  model_id: z.string().min(1),
  user_message_tokens: z.number().int().nonnegative(),
  retrieved_tokens: z.number().int().nonnegative(),
  history_tokens: z.number().int().nonnegative(),
  thoroughness: z.string().optional()
});
var ContextAllocationResultSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  action: z.enum(["proceed", "prioritize_nodes", "summarize_history"]),
  allocations: z.object({
    system_prompt: z.number().int().nonnegative(),
    user_message: z.number().int().nonnegative(),
    retrieved: z.number().int().nonnegative(),
    history: z.number().int().nonnegative(),
    response: z.number().int().nonnegative()
  }),
  flexible_pool: z.number().int().nonnegative(),
  unused_tokens: z.number().int().nonnegative(),
  model_id: z.string().min(1)
});
var PriorityWeightsSchema = z.object({
  retrieval_score: z.number().min(0).max(1),
  query_mentioned: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  connectivity: z.number().min(0).max(1),
  importance: z.number().min(0).max(1)
}).refine(
  (weights) => {
    const sum = Object.values(weights).reduce((acc, val) => acc + val, 0);
    return Math.abs(sum - 1) < 1e-3;
  },
  { message: "Priority weights must sum to 1.0" }
);
var NodePriorityFactorsSchema = z.object({
  retrieval_score: z.number().min(0).max(1),
  query_mentioned: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  connectivity: z.number().min(0).max(1),
  importance: z.number().min(0).max(1)
});
var PrioritizedNodeSchema = z.object({
  node_id: z.string().min(1),
  priority_score: z.number().min(0).max(1),
  tokens: z.number().int().nonnegative(),
  retrieval_score: z.number().min(0).max(1),
  is_critical: z.boolean(),
  was_truncated: z.boolean(),
  truncation_tier: TruncationTierSchema.optional()
});
var PackedContextSchema = z.object({
  nodes: z.array(PrioritizedNodeSchema),
  used_tokens: z.number().int().nonnegative(),
  budget_tokens: z.number().int().nonnegative(),
  truncated_count: z.number().int().nonnegative(),
  excluded_count: z.number().int().nonnegative()
});
var TruncatedContentSchema = z.object({
  text: z.string(),
  original_tokens: z.number().int().nonnegative(),
  truncated_tokens: z.number().int().nonnegative(),
  tier_used: TruncationTierSchema,
  latency_ms: z.number().nonnegative()
});
var ContextPlacementSchema = z.object({
  system_prompt: z.string(),
  retrieved_nodes: z.array(PrioritizedNodeSchema),
  conversation_summary: z.string().optional(),
  recent_messages: z.array(z.string()),
  user_query: z.string()
});
var ConversationHistoryConfigSchema = z.object({
  recent_window: z.object({
    max_turns: z.number().int().positive(),
    max_tokens: z.number().int().positive()
  }),
  summarization: z.object({
    turn_trigger: z.number().int().positive(),
    token_trigger: z.number().int().positive(),
    model: z.string().min(1),
    input_budget: z.number().int().positive(),
    output_budget: z.number().int().positive(),
    compression_target: z.number().min(0).max(1)
  })
});
var ManagedHistorySchema = z.object({
  summary: z.string().optional(),
  recent_messages: z.array(z.string()),
  total_tokens: z.number().int().nonnegative(),
  needs_summarization: z.boolean(),
  turn_count: z.number().int().nonnegative()
});
var ChunkingConfigSchema = z.object({
  chunking_trigger: z.number().int().positive(),
  target_min: z.number().int().positive(),
  target_max: z.number().int().positive(),
  hard_max: z.number().int().positive(),
  absolute_max: z.number().int().positive(),
  min_tokens: z.number().int().positive(),
  min_sentences: z.number().int().positive(),
  overlap_tokens: z.number().int().nonnegative(),
  overlap_in_embedding: z.boolean(),
  embedding_max: z.number().int().positive()
});
var ChunkFieldsSchema = z.object({
  is_chunk: z.boolean(),
  parent_id: z.string().min(1),
  chunk_index: z.number().int().nonnegative(),
  total_chunks: z.number().int().positive(),
  level: ChunkLevelSchema,
  previous_chunk_id: z.string().min(1).optional(),
  next_chunk_id: z.string().min(1).optional(),
  overlap_tokens: z.number().int().nonnegative(),
  overlap_hash: z.string(),
  temporary: z.boolean().optional()
});
var ParentFieldsSchema = z.object({
  is_parent: z.boolean(),
  child_ids: z.array(z.string().min(1)),
  total_tokens: z.number().int().positive(),
  total_chunks: z.number().int().positive(),
  document_type: z.string().min(1)
});
var ChunkRetrievalConfigSchema = z.object({
  expansion: z.object({
    enabled: z.boolean(),
    max_expansion_tokens: z.number().int().positive(),
    include_adjacent_chunks: z.number().int().nonnegative(),
    include_parent_summary: z.boolean()
  }),
  aggregation: z.object({
    same_doc_threshold: z.number().int().positive(),
    action: z.string().min(1),
    high_count_threshold: z.number().int().positive(),
    high_count_action: z.string().min(1)
  })
});
var TokenCountCacheSchema = z.object({
  body: z.number().int().nonnegative(),
  summary: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  counted_with: z.string().min(1),
  counted_at: z.string().min(1)
});
var ContextAssemblyMetricsSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  total_tokens_used: z.number().int().nonnegative(),
  retrieved_tokens: z.number().int().nonnegative(),
  history_tokens: z.number().int().nonnegative(),
  truncation_count: z.number().int().nonnegative(),
  expansion_count: z.number().int().nonnegative(),
  latency_ms: z.number().nonnegative(),
  nodes_considered: z.number().int().nonnegative(),
  nodes_included: z.number().int().nonnegative(),
  overflow_triggered: z.boolean(),
  model_id: z.string().min(1)
});
var ContextWindowConfigSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  fixed_allocations: FixedAllocationsSchema,
  priority_weights: PriorityWeightsSchema,
  chunking: ChunkingConfigSchema,
  conversation: ConversationHistoryConfigSchema,
  chunk_retrieval: ChunkRetrievalConfigSchema
});
var DEFAULT_CONTEXT_WINDOW_CONFIG = {
  _schemaVersion: CW_SCHEMA_VERSION,
  fixed_allocations: {
    system_prompt: DEFAULT_SYSTEM_PROMPT_TOKENS,
    min_user_message: DEFAULT_MIN_USER_TOKENS,
    response_buffer: 12e3
    // Will be overridden by model-specific value
  },
  priority_weights: {
    retrieval_score: DEFAULT_PRIORITY_WEIGHTS.retrieval_score,
    query_mentioned: DEFAULT_PRIORITY_WEIGHTS.query_mentioned,
    recency: DEFAULT_PRIORITY_WEIGHTS.recency,
    connectivity: DEFAULT_PRIORITY_WEIGHTS.connectivity,
    importance: DEFAULT_PRIORITY_WEIGHTS.importance
  },
  chunking: {
    chunking_trigger: CHUNKING_TRIGGER_TOKENS,
    target_min: CHUNK_TARGET_MIN,
    target_max: CHUNK_TARGET_MAX,
    hard_max: CHUNK_HARD_MAX,
    absolute_max: CHUNK_ABSOLUTE_MAX,
    min_tokens: CHUNK_MIN_TOKENS,
    min_sentences: CHUNK_MIN_SENTENCES,
    overlap_tokens: CHUNK_OVERLAP_TOKENS,
    overlap_in_embedding: CHUNK_OVERLAP_IN_EMBEDDING,
    embedding_max: CHUNK_EMBEDDING_MAX
  },
  conversation: {
    recent_window: {
      max_turns: CONVERSATION_RECENT_TURNS,
      max_tokens: CONVERSATION_RECENT_MAX_TOKENS
    },
    summarization: {
      turn_trigger: SUMMARIZATION_TURN_TRIGGER,
      token_trigger: SUMMARIZATION_TOKEN_TRIGGER,
      model: SUMMARIZATION_MODEL,
      input_budget: SUMMARIZATION_INPUT_BUDGET,
      output_budget: SUMMARIZATION_OUTPUT_BUDGET,
      compression_target: SUMMARIZATION_COMPRESSION_TARGET
    }
  },
  chunk_retrieval: {
    expansion: {
      enabled: true,
      max_expansion_tokens: CHUNK_EXPANSION_MAX_TOKENS,
      include_adjacent_chunks: CHUNK_ADJACENT_COUNT,
      include_parent_summary: true
    },
    aggregation: {
      same_doc_threshold: CHUNK_SAME_DOC_THRESHOLD,
      action: "merge_with_context",
      high_count_threshold: CHUNK_HIGH_COUNT_THRESHOLD,
      high_count_action: "use_parent_summary_plus_highlights"
    }
  }
};
var DEFAULT_CONVERSATION_CONFIG = {
  recent_window: {
    max_turns: CONVERSATION_RECENT_TURNS,
    max_tokens: CONVERSATION_RECENT_MAX_TOKENS
  },
  summarization: {
    turn_trigger: SUMMARIZATION_TURN_TRIGGER,
    token_trigger: SUMMARIZATION_TOKEN_TRIGGER,
    model: SUMMARIZATION_MODEL,
    input_budget: SUMMARIZATION_INPUT_BUDGET,
    output_budget: SUMMARIZATION_OUTPUT_BUDGET,
    compression_target: SUMMARIZATION_COMPRESSION_TARGET
  }
};
function isFixedAllocations(value) {
  return FixedAllocationsSchema.safeParse(value).success;
}
function isModelContextBudget(value) {
  return ModelContextBudgetSchema.safeParse(value).success;
}
function isContextAllocationRequest(value) {
  return ContextAllocationRequestSchema.safeParse(value).success;
}
function isContextAllocationResult(value) {
  return ContextAllocationResultSchema.safeParse(value).success;
}
function isPriorityWeights(value) {
  return PriorityWeightsSchema.safeParse(value).success;
}
function isNodePriorityFactors(value) {
  return NodePriorityFactorsSchema.safeParse(value).success;
}
function isPrioritizedNode(value) {
  return PrioritizedNodeSchema.safeParse(value).success;
}
function isPackedContext(value) {
  return PackedContextSchema.safeParse(value).success;
}
function isTruncatedContent(value) {
  return TruncatedContentSchema.safeParse(value).success;
}
function isContextPlacement(value) {
  return ContextPlacementSchema.safeParse(value).success;
}
function isConversationHistoryConfig(value) {
  return ConversationHistoryConfigSchema.safeParse(value).success;
}
function isManagedHistory(value) {
  return ManagedHistorySchema.safeParse(value).success;
}
function isChunkingConfig(value) {
  return ChunkingConfigSchema.safeParse(value).success;
}
function isChunkFields(value) {
  return ChunkFieldsSchema.safeParse(value).success;
}
function isParentFields(value) {
  return ParentFieldsSchema.safeParse(value).success;
}
function isChunkRetrievalConfig(value) {
  return ChunkRetrievalConfigSchema.safeParse(value).success;
}
function isTokenCountCache(value) {
  return TokenCountCacheSchema.safeParse(value).success;
}
function isContextAssemblyMetrics(value) {
  return ContextAssemblyMetricsSchema.safeParse(value).success;
}
function isContextWindowConfig(value) {
  return ContextWindowConfigSchema.safeParse(value).success;
}

// src/context-window/index.ts
function getModelContextBudget(modelId) {
  let config = getModelConfig(modelId);
  if (!config) {
    config = MODEL_CONFIGS["gpt-4o-mini"];
    if (!config) {
      throw new Error("Critical error: gpt-4o-mini not found in MODEL_CONFIGS");
    }
  }
  const provider = getProviderForModel(config.id);
  const retrievalRatio = provider ? PROVIDER_RETRIEVAL_RATIOS[provider] ?? 0.65 : 0.65;
  const responseBuffer = DEFAULT_RESPONSE_BUFFERS[config.id] ?? DEFAULT_RESPONSE_BUFFER_FALLBACK;
  const fixedAllocs = {
    system_prompt: DEFAULT_SYSTEM_PROMPT_TOKENS,
    min_user_message: DEFAULT_MIN_USER_TOKENS,
    response_buffer: responseBuffer
  };
  const flexiblePool = Math.max(
    0,
    config.context_window - fixedAllocs.system_prompt - fixedAllocs.min_user_message - fixedAllocs.response_buffer
  );
  const defaultRetrieved = Math.floor(flexiblePool * retrievalRatio);
  const defaultHistory = flexiblePool - defaultRetrieved;
  return {
    model_id: config.id,
    total_context: config.context_window,
    fixed: fixedAllocs,
    flexible_pool: flexiblePool,
    retrieval_ratio: retrievalRatio,
    default_retrieved: defaultRetrieved,
    default_history: defaultHistory
  };
}
function allocateContext(request) {
  const budget = getModelContextBudget(request.model_id);
  const userAllocation = Math.max(budget.fixed.min_user_message, request.user_message_tokens);
  const flexiblePool = Math.max(
    0,
    budget.total_context - budget.fixed.system_prompt - userAllocation - budget.fixed.response_buffer
  );
  let retrievedAllocation = Math.floor(flexiblePool * budget.retrieval_ratio);
  let historyAllocation = flexiblePool - retrievedAllocation;
  let action = "proceed";
  if (request.retrieved_tokens > retrievedAllocation) {
    action = "prioritize_nodes";
  } else if (request.history_tokens > historyAllocation) {
    action = "summarize_history";
  }
  if (request.retrieved_tokens < retrievedAllocation * 0.5) {
    const unusedRetrieved = retrievedAllocation - request.retrieved_tokens;
    const sharedAmount = Math.floor(unusedRetrieved / 2);
    retrievedAllocation -= sharedAmount;
    historyAllocation += sharedAmount;
  }
  const usedTokens = budget.fixed.system_prompt + userAllocation + Math.min(request.retrieved_tokens, retrievedAllocation) + Math.min(request.history_tokens, historyAllocation) + budget.fixed.response_buffer;
  const unusedTokens = Math.max(0, budget.total_context - usedTokens);
  return {
    _schemaVersion: CW_SCHEMA_VERSION,
    action,
    allocations: {
      system_prompt: budget.fixed.system_prompt,
      user_message: userAllocation,
      retrieved: retrievedAllocation,
      history: historyAllocation,
      response: budget.fixed.response_buffer
    },
    flexible_pool: flexiblePool,
    unused_tokens: unusedTokens,
    model_id: request.model_id
  };
}
function handleSparseRetrieval(retrievedTokens, budget) {
  if (retrievedTokens >= SPARSE_RETRIEVAL_THRESHOLD) {
    return budget;
  }
  const newResponseBuffer = budget.fixed.response_buffer + SPARSE_EXTRA_RESPONSE_BUFFER;
  const newFlexiblePool = Math.max(
    0,
    budget.total_context - budget.fixed.system_prompt - budget.fixed.min_user_message - newResponseBuffer
  );
  const newDefaultRetrieved = Math.floor(newFlexiblePool * budget.retrieval_ratio);
  const newDefaultHistory = newFlexiblePool - newDefaultRetrieved;
  return {
    ...budget,
    fixed: {
      ...budget.fixed,
      response_buffer: newResponseBuffer
    },
    flexible_pool: newFlexiblePool,
    default_retrieved: newDefaultRetrieved,
    default_history: newDefaultHistory
  };
}
function calculateNodePriority(factors, weights) {
  const w = weights ?? DEFAULT_PRIORITY_WEIGHTS;
  return factors.retrieval_score * w.retrieval_score + factors.query_mentioned * w.query_mentioned + factors.recency * w.recency + factors.connectivity * w.connectivity + factors.importance * w.importance;
}
function calculateRecencyScore(lastAccessedIso) {
  const now = Date.now();
  const lastAccessed = new Date(lastAccessedIso).getTime();
  const daysSince2 = (now - lastAccessed) / (1e3 * 60 * 60 * 24);
  if (daysSince2 < 0) {
    return 1;
  }
  const decayConstant = RECENCY_HALF_LIFE_DAYS * 1.4427;
  return Math.exp(-daysSince2 / decayConstant);
}
function calculateConnectivityScore(connectedToIncludedCount) {
  return Math.min(1, Math.max(0, connectedToIncludedCount) * CONNECTIVITY_CAP_FACTOR);
}
function packNodes(candidates, budgetTokens, criticalNodeIds) {
  const included = [];
  let usedTokens = 0;
  let truncatedCount = 0;
  let excludedCount = 0;
  const criticalSet = new Set(criticalNodeIds ?? []);
  const criticalNodes = candidates.filter((n) => criticalSet.has(n.node_id));
  const nonCriticalNodes = candidates.filter((n) => !criticalSet.has(n.node_id));
  for (const node of criticalNodes) {
    if (usedTokens + node.tokens <= budgetTokens) {
      included.push(node);
      usedTokens += node.tokens;
      if (node.was_truncated) {
        truncatedCount++;
      }
    } else {
      excludedCount++;
    }
  }
  const sortedNonCritical = [...nonCriticalNodes].sort(
    (a, b) => b.priority_score - a.priority_score
  );
  for (const node of sortedNonCritical) {
    if (usedTokens + node.tokens <= budgetTokens) {
      included.push(node);
      usedTokens += node.tokens;
      if (node.was_truncated) {
        truncatedCount++;
      }
    } else {
      excludedCount++;
    }
  }
  return {
    nodes: included,
    used_tokens: usedTokens,
    budget_tokens: budgetTokens,
    truncated_count: truncatedCount,
    excluded_count: excludedCount
  };
}
function selectTruncationTier(nodeTokens, targetTokens, hasSummary) {
  if (hasSummary) {
    return "use_summary";
  }
  if (nodeTokens <= targetTokens * 2) {
    return "semantic_truncation";
  }
  if (nodeTokens > targetTokens * 2) {
    return "extract_relevant";
  }
  return "hard_truncation";
}
function semanticTruncate(text, targetTokens) {
  if (text.length === 0) {
    return text;
  }
  const currentTokens = estimateTokens(text);
  if (currentTokens <= targetTokens) {
    return text;
  }
  const targetChars = targetTokens * TOKEN_ESTIMATE_CHARS_PER_TOKEN;
  const firstPartChars = Math.floor(targetChars * SEMANTIC_TRUNCATION_KEEP_START);
  const lastPartChars = Math.floor(targetChars * SEMANTIC_TRUNCATION_KEEP_END);
  const firstPart = text.slice(0, firstPartChars);
  const lastPart = text.slice(-lastPartChars);
  return firstPart + " [...] " + lastPart;
}
function hardTruncate(text, targetTokens) {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= targetTokens) {
    return text;
  }
  const targetChars = Math.floor(targetTokens * TOKEN_ESTIMATE_CHARS_PER_TOKEN);
  const searchText = text.slice(0, targetChars);
  const sentenceBoundaries = [
    searchText.lastIndexOf(". "),
    searchText.lastIndexOf("! "),
    searchText.lastIndexOf("? ")
  ];
  const lastBoundary = Math.max(...sentenceBoundaries);
  if (lastBoundary > 0) {
    return text.slice(0, lastBoundary + 1) + " [truncated]";
  }
  return text.slice(0, targetChars) + " [truncated]";
}
function reorderForAttention(nodes) {
  if (nodes.length === 0 || nodes.length === 1) {
    return [...nodes];
  }
  const mostRelevant = nodes[0];
  const secondMostRelevant = nodes[1];
  if (!mostRelevant || !secondMostRelevant) {
    return [...nodes];
  }
  const rest = nodes.slice(2);
  return [secondMostRelevant, ...rest, mostRelevant];
}
function manageConversationHistory(messages, tokenCounts, config) {
  const cfg = config ?? DEFAULT_CONTEXT_WINDOW_CONFIG.conversation;
  const totalTokens = tokenCounts.reduce((sum, count) => sum + count, 0);
  const turnCount = messages.length;
  const needsSummarization = turnCount > cfg.summarization.turn_trigger || totalTokens > cfg.summarization.token_trigger;
  const recentMessages = messages.slice(-cfg.recent_window.max_turns);
  return {
    summary: void 0,
    // Summary would be passed in from previous summarization
    recent_messages: recentMessages,
    total_tokens: totalTokens,
    needs_summarization: needsSummarization,
    turn_count: turnCount
  };
}
function estimateTokens(text) {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN);
}
function shouldChunk(tokenCount, config) {
  const cfg = config ?? DEFAULT_CONTEXT_WINDOW_CONFIG.chunking;
  return tokenCount > cfg.chunking_trigger;
}
function calculateChunkCount(totalTokens, config) {
  const cfg = config ?? DEFAULT_CONTEXT_WINDOW_CONFIG.chunking;
  const target = (cfg.target_min + cfg.target_max) / 2;
  return Math.max(1, Math.ceil(totalTokens / target));
}
function createChunkFields(parentId, index, totalChunks, level, overlapTokens) {
  return {
    is_chunk: true,
    parent_id: parentId,
    chunk_index: index,
    total_chunks: totalChunks,
    level,
    previous_chunk_id: index > 0 ? `${parentId}_chunk_${index - 1}` : void 0,
    next_chunk_id: index < totalChunks - 1 ? `${parentId}_chunk_${index + 1}` : void 0,
    overlap_tokens: overlapTokens,
    overlap_hash: ""
    // Empty — computed by caller
  };
}
function createParentFields(childIds, totalTokens, documentType) {
  return {
    is_parent: true,
    child_ids: childIds,
    total_tokens: totalTokens,
    total_chunks: childIds.length,
    document_type: documentType
  };
}
function shouldExpandChunks(matchedChunkCount, config) {
  const cfg = config ?? DEFAULT_CONTEXT_WINDOW_CONFIG.chunk_retrieval;
  return cfg.expansion.enabled && matchedChunkCount >= 1;
}
function shouldAggregateChunks(sameDocChunkCount, config) {
  const cfg = config ?? DEFAULT_CONTEXT_WINDOW_CONFIG.chunk_retrieval;
  if (sameDocChunkCount < cfg.aggregation.same_doc_threshold) {
    return "none";
  }
  if (sameDocChunkCount >= cfg.aggregation.high_count_threshold) {
    return "summarize";
  }
  return "merge";
}
function getDefaultContextWindowConfig() {
  return DEFAULT_CONTEXT_WINDOW_CONFIG;
}
function getDefaultChunkRetrievalConfig() {
  return DEFAULT_CONTEXT_WINDOW_CONFIG.chunk_retrieval;
}

export { ABSConfigSchema, ABS_SCHEMA_VERSION, ACCESS_TOKEN_EXPIRY_MINUTES, ACCURACY_MODES, ACCURACY_MODE_CONFIGS, ACCURACY_TARGETS, ACTION_VERB_CATEGORIES, ADAPTIVE_THRESHOLDS, ALGORITHM_NODE_TYPES, ALGORITHM_PARAMS, ALL_CAPS_MIN_LENGTH, ALL_CAPS_MIN_LETTERS, ALL_LAYER_CONFIGS, AMBIGUOUS_VERBS, ANTHROPIC_MODELS, API_CALL_FLOWS, API_CALL_ROUTES, API_KEY_TYPES, APP_STORE_DECLARATIONS, ARCHIVE_LAYER_CONFIG, ARCHIVE_LAYER_TYPES, ATSS_BULK_MODES, ATSS_BULK_REFERENCE_PATTERNS, ATSS_CIRCUIT_BREAKER_MAX_FAILURES, ATSS_CIRCUIT_BREAKER_STATES, ATSS_CONFIRMATION_LEVELS, ATSS_CONNECTION_DIRECTIONS, ATSS_CREDIT_COSTS, ATSS_DEFAULT_MAX_CONTENT_LENGTH, ATSS_DEFAULT_MIN_SEARCH_SCORE, ATSS_DEFAULT_SEARCH_LIMIT, ATSS_ERROR_CODES, ATSS_ERROR_CODE_KEYS, ATSS_ERROR_PREFIXES, ATSS_INVERSE_OPERATIONS, ATSS_MAX_BULK_OPERATIONS, ATSS_MAX_CONTENT_LENGTH, ATSS_MAX_NODE_IDS_PER_VIEW, ATSS_MAX_SEARCH_LIMIT, ATSS_MAX_TAGS, ATSS_MIN_SEARCH_SCORE, ATSS_QUICK_UNDO_SECONDS, ATSS_RATE_LIMITS, ATSS_RETRYABLE_ERROR_CODES, ATSS_SYNTHESIZE_FORMATS, ATSS_TIERS, ATSS_TIER_CONFIGS, ATSS_TOOL_CATEGORIES, ATSS_TOOL_CONFIRMATION, ATSS_TOOL_DEFINITIONS, ATSS_TOOL_DESCRIPTIONS, ATSS_TOOL_NAMES, ATSS_TOOL_TIMEOUT_MS, ATSS_TOOL_TO_CATEGORY, ATSS_TRANSACTION_ID_PREFIX, ATSS_UNDO_ID_PREFIX, ATSS_UNDO_STATUSES, ATSS_UNDO_TTL_SECONDS, ATSS_UPDATE_CONFIDENCE_THRESHOLD, ATTRIBUTE_KEYWORDS, ATTRIBUTE_SYNONYMS, AUTH_CALLBACK_PATH, AUTH_METHODS, AUTH_PROVIDERS, AUTO_SUPERSEDE_ACCURACY_TARGET, AccuracyMetricsSchema, AccuracyModeConfigSchema, AccuracyModeSchema, ActivatedNodeSchema, AdaptiveBudgetRequestSchema, AdaptiveBudgetResultSchema, AdaptiveEvolutionThresholdsSchema, AdaptiveLimitsSchema, AnthropicModelSchema, AnyNodeSchema, ApiCallFlowSchema, ApiCallRouteSchema, ApiKeyTypeSchema, AppStoreDeclarationSchema, AtssBulkModeSchema, AtssBulkOperationItemSchema, AtssBulkOperationResultItemSchema, AtssBulkOperationsParamsSchema, AtssBulkOperationsResultSchema, AtssCircuitBreakerSchema, AtssCircuitBreakerStateSchema, AtssConfirmationLevelSchema, AtssConfirmationRequestSchema, AtssConfirmationResponseSchema, AtssCreateEdgeParamsSchema, AtssCreateEdgeResultSchema, AtssCreateNodeParamsSchema, AtssCreateNodeResultSchema, AtssDeleteEdgeParamsSchema, AtssDeleteEdgeResultSchema, AtssDeleteNodeParamsSchema, AtssDeleteNodeResultSchema, AtssDryRunResultSchema, AtssErrorResponseSchema, AtssLinkToClusterParamsSchema, AtssLinkToClusterResultSchema, AtssNodeChangesSchema, AtssNodeConnectionSchema, AtssNodeMetadataSchema, AtssNodeSummarySchema, AtssRateLimitStateSchema, AtssRedoRequestSchema, AtssRedoResultSchema, AtssSearchFiltersSchema, AtssSearchParamsSchema, AtssSearchResultItemSchema, AtssSearchResultSchema, AtssTierConfigSchema, AtssTierSchema, AtssToolCategorySchema, AtssToolNameSchema, AtssUndoEntrySchema, AtssUndoMultipleRequestSchema, AtssUndoMultipleResultSchema, AtssUndoRequestSchema, AtssUndoResultSchema, AtssUndoStatusSchema, AtssUpdateNodeParamsSchema, AtssUpdateNodeResultSchema, AtssViewNodeParamsSchema, AtssViewNodeResultSchema, AtssViewedNodeSchema, AttachmentSchema, AuthMethodSchema, AuthProviderSchema, AuthSecurityConfigSchema, AuthStateSchema, AuthTokensSchema, BANNER_DISMISS_COOLDOWN_MS, BASE_DIFFICULTY_BY_CATEGORY, BATCH_DEADLINE_HOURS, BATCH_DISCOUNT_PERCENT, BATCH_ELIGIBLE_OPERATIONS, BATCH_JOB_STATUSES, BLOCK_ID_PREFIX, BLOCK_LENGTH_THRESHOLD, BLOCK_LIST_THRESHOLD, BLOCK_TYPES, BM25ConfigSchema, BM25_CONFIG, BM25_FIELD_WEIGHTS, BM25_WEIGHT, BRUTE_FORCE_LOCKOUT_ATTEMPTS, BRUTE_FORCE_LOCKOUT_MINUTES, BUDGET_EXHAUSTION_REASONS, BUDGET_MODES, BYOKConfigSchema, BYOKDecryptionAttemptSchema, BYOKEncryptionMethodSchema, BYOKRateLimitConfigSchema, BYOK_ENCRYPTION_METHODS, BYOK_LOCKOUT_AFTER_FAILURES, BYOK_LOCKOUT_DURATION_MINUTES, BYOK_MAX_DECRYPTIONS_PER_MINUTE, BYPASS_SOURCES, BadgeStateSchema, BannerDismissStateSchema, BannerNotificationSchema, BatchJobStatusSchema, BatchSyncResponseSchema, BlockSchema, BudgetConfigSchema, BudgetExhaustionReasonSchema, BudgetExhaustionResultSchema, BudgetExplanationSchema, BudgetModeSchema, CACHEABLE_PROMPT_TYPES, CACHE_MIN_TOKENS, CACHE_MULTIPLIERS, CACHE_PRICING_MULTIPLIERS, CACHE_TTL_MINUTES, CAPTCHA_AFTER_FAILURES, CATEGORY_TO_NODE_TYPE, CHUNKING_TRIGGER_TOKENS, CHUNK_ABSOLUTE_MAX, CHUNK_ADJACENT_COUNT, CHUNK_EDGE_TYPES, CHUNK_EMBEDDING_MAX, CHUNK_EXPANSION_MAX_TOKENS, CHUNK_HARD_MAX, CHUNK_HIGH_COUNT_THRESHOLD, CHUNK_LEVELS, CHUNK_LIMITS, CHUNK_MIN_SENTENCES, CHUNK_MIN_TOKENS, CHUNK_OVERLAP_IN_EMBEDDING, CHUNK_OVERLAP_TOKENS, CHUNK_SAME_DOC_THRESHOLD, CHUNK_TARGET_MAX, CHUNK_TARGET_MIN, CLASSIFICATION_INTENTS, CLASSIFICATION_REASONS, CLASSIFIER_FEW_SHOT_PROMPT, CLASSIFIER_TRAINING, CLIENT_SEARCH_PERFORMANCE, CLOCK_DRIFT_EMA_WEIGHT, CLUSTER_HEALTH_THRESHOLDS, CLUSTER_SOURCES, COACTIVATION_CONFIG, COLD_START_CONFIG, COLD_START_LIMITS, COLD_START_THRESHOLD, COMMON_WORDS, COMPARISON_DIMS, COMPLEXITY_LEVELS, COMPRESSION_DEFAULTS, CONCEPT_SUBTYPES, CONFIDENCE_LEVELS, CONFIDENCE_THRESHOLDS, CONFLICT_HISTORY_RETENTION_DAYS, CONFLICT_QUEUE_CONFIG, CONFLICT_RESOLUTION_CHOICES, CONFLICT_STATUSES, CONFLICT_STRENGTHS, CONFLICT_TYPES, CONFLICT_TYPE_RESOLUTION, CONNECTIVITY_CAP_FACTOR, CONSENT_DURATIONS, CONSENT_EVENT_TYPES, CONSENT_REVOCATION_SCOPES, CONSENT_SCOPES, CONTENT_CATEGORIES, CONTENT_SOURCES, CONTENT_TIME_TYPES, CONTENT_TYPES, CONTEXT_TEMPLATES, CONTRADICTION_LEVELS, CONVERSATION_RECENT_MAX_TOKENS, CONVERSATION_RECENT_TURNS, CONVERSATION_TIMEOUT_MINUTES, COST_RESERVATION_BUFFER, CREDIT_RESERVATION_EXPIRY_MINUTES, CW_SCHEMA_VERSION, CacheEntrySchema, CacheHitResultSchema, CacheSavingsEstimateSchema, CacheablePromptTypeSchema, ChangeSchema, ChangeSetSchema, ChunkEdgeTypeSchema, ChunkFieldsSchema, ChunkLevelSchema, ChunkNodeSchema, ChunkRetrievalConfigSchema, ChunkingConfigSchema, ClassificationResultSchema, ClassificationSchema, ClassifierResultSchema, CleanupSettingsSchema, ClerkConfigSchema, ClientSearchConfigSchema, ClockSyncSchema, ClusterHealthSchema, ClusterMembershipForMergeSchema, ClusterMembershipSchema, ClusterRenameSchema, ClusterRoutingResultSchema, ClusterSchema, ClusterSummarySchema, ClusterTemplateSchema, ClusterTendenciesSchema, ClusterWithCentroidSchema, CommitResultSchema, ComplexityAnalysisSchema, CompressedEdgeRecordSchema, CompressionInputSchema, CompressionResultSchema, ConceptNodeSchema, ConfidenceFactorsSchema, ConfidenceThresholdsSchema, ConflictErrorSchema, ConflictHistoryEntrySchema, ConflictNotificationSchema, ConflictPresentationSchema, ConflictQueueConfigSchema, ConflictQueueItemSchema, ConflictQueueStatusSchema, ConflictResolutionSchema, ConflictStatusSchema, ConflictTypeSchema, ConnectionMapSchema, ConsentDialogDataSchema, ConsentDurationSchema, ConsentEventSchema, ConsentEventTypeSchema, ConsentMemoryPreviewSchema, ConsentRevocationRequestSchema, ConsentRevocationScopeSchema, ConsentScopeSchema, ConsentSettingsSchema, ConsentStateSchema, ConsentVisualIndicatorSchema, ContentTimeSchema, ContextAllocationRequestSchema, ContextAllocationResultSchema, ContextAssemblyMetricsSchema, ContextPlacementSchema, ContextPreferencesSchema, ContextPrefixSchema, ContextWindowConfigSchema, ContradictionResolutionSchema, ContradictionResultSchema, ConversationHistoryConfigSchema, ConversationMessageSchema, CostEstimateEventSchema, CostEventSchema, CostFinalEventSchema, CostRangeSchema, CostRunningEventSchema, CreateNeuralStateOptionsSchema, CreditCheckResultSchema, CreditFlowConfigSchema, CreditReservationSchema, CreditTransactionSchema, D1_REASONING_PATTERNS, D2_NEGATION_PATTERNS, D3_TIME_PATTERNS, D4_COMPOUND_PATTERNS, D5_REFERENCE_PATTERNS, D6_EXPLORATION_PATTERNS, DATABASE_MODES, DB_DEFAULTS, DB_ERROR_CODES, DECAY_CONFIG, DECAY_JOB_SPEC, DECAY_LIFECYCLE_STATES, DECLINE_ACTIONS, DECLINE_MESSAGE, DEDUP_CHECK_THRESHOLD, DEEP_LINK_SCHEME, DEFAULT_ABS_CONFIG, DEFAULT_BYOK_RATE_LIMIT, DEFAULT_CLIENT_SEARCH_CONFIG_DESKTOP, DEFAULT_CLIENT_SEARCH_CONFIG_MOBILE, DEFAULT_CONSENT_SCOPE, DEFAULT_CONSENT_SETTINGS, DEFAULT_CONTEXT_WINDOW_CONFIG, DEFAULT_CONVERSATION_CONFIG, DEFAULT_CREDIT_FLOW_CONFIG, DEFAULT_DESKTOP_CONFIG, DEFAULT_EMBEDDING_CONFIG, DEFAULT_EMBEDDING_MODEL, DEFAULT_EVOLUTION_THRESHOLDS, DEFAULT_FALLBACK_CONFIG, DEFAULT_HYBRID_CONFIG, DEFAULT_LOCK_DURATION_SECONDS, DEFAULT_MATRYOSHKA_CONFIG, DEFAULT_MIN_USER_TOKENS, DEFAULT_MULTI_DEVICE_SYNC, DEFAULT_PRIORITY_WEIGHTS, DEFAULT_QUEUE_CONFIG, DEFAULT_RATE_LIMIT_CONFIG, DEFAULT_RESPONSE_BUFFERS, DEFAULT_RESPONSE_BUFFER_FALLBACK, DEFAULT_RETRIEVAL_INTEGRATION_CONFIG, DEFAULT_RETRY_CONFIG, DEFAULT_ROTATION_CONFIG, DEFAULT_SECURITY_CONFIG, DEFAULT_SELF_IMPROVEMENT_CONFIG, DEFAULT_SIMILARITY_CONFIG, DEFAULT_SSA_CONFIG, DEFAULT_STRENGTH, DEFAULT_SYSTEM_PROMPT_TOKENS, DEFAULT_THOROUGHNESS, DEGRADATION_LEVELS, DEGRADATION_MODE_CONFIGS, DELETION_CRITERIA, DELETION_EXCLUSION_RULES, DENSE_WEIGHT, DEPRECATED_KEY_RETENTION_DAYS, DERIVATION_INFO_STRINGS, DESKTOP_AUTH_STEPS, DETECTION_TIERS, DETECTION_TIER_METADATA, DEVICE_INACTIVE_DAYS, DIFFICULTY_CONFIG, DISQUALIFIER_CATEGORIES, DISQUALIFIER_PATTERNS, DOWNGRADE_MESSAGES, DatabaseError, DatabaseOptionsSchema, DateRangeFilterSchema, DecayConfigSchema, DecayJobResultSchema, DecayResultSchema, DeclineResultSchema, DecryptionResultSchema, DefaultTendenciesSchema, DegradationEventSchema, DegradationLevelSchema, DegradationModeConfigSchema, DeletionCandidateSchema, DeletionCriteriaResultSchema, DerivedKeysSchema, DesktopAuthFlowSchema, DesktopAuthStepSchema, DetectedActionVerbSchema, DetectedConflictSchema, DetectionContextSchema, DetectionEventLogSchema, DetectionPipelineResultSchema, DetectionTierSchema, DeviceInfoSchema, DifficultyFactorsSchema, DisqualifierResultSchema, DocumentChunkSchema, DocumentMetadataSchema, DocumentNodeSchema, ECCN_CLASSIFICATION, EDGES_INDEXES, EDGES_TABLE, EDGE_CREATION_RULES, EDGE_CREATION_SOURCES, EDGE_DECAY_CONFIG, EDGE_ID_PREFIX, EDGE_STATUSES, EDGE_TYPES, EDGE_WEIGHTS, EDIT_ACTIONS, EDIT_HISTORY_INDEXES, EDIT_HISTORY_RETENTION, EDIT_HISTORY_TABLE, EDIT_ID_PREFIX, EDIT_TARGET_METHODS, EMBEDDING_CACHE_MAX_SIZE, EMBEDDING_CACHE_TTL_DAYS, EMBEDDING_DIMENSIONS, EMBEDDING_MODELS, EMBEDDING_MODES, ENCRYPTED_NODES_ADDITIONAL_SQL, ENCRYPTION_ALGORITHM, ENCRYPTION_FIELD_MAP, ENTITY_NEARBY_DISTANCE, EPISODES_INDEXES, EPISODES_TABLE, EPISODE_ID_PREFIX, EPISODE_LAYER_CONFIG, EPISODE_LAYER_TYPES, EPISODE_SUBTYPES, EPISODE_TYPES, EVENT_TIME_SOURCES, EVOLUTION_CONFIG, EVOLUTION_TRIGGERS, EXPORT_COMPLIANCE_BY_REGION, EXPORT_COMPLIANCE_STATUSES, EXPRESSION_TYPES, EXTENDED_EDGE_TYPES, EXTRACTION_CONFIG, EXTRACTION_DEPTHS, EdgeCreationSourceSchema, EdgeNeuralPropertiesSchema, EdgeProvenanceSchema, EdgeStatusSchema, EdgeWeightComponentsSchema, EditHistoryCollectionSchema, EditOperationSchema, EditRecordSchema, EditRequestSchema, EditResultSchema, EditTargetSchema, EmbeddingBatchJobSchema, EmbeddingFieldSchema, EmbeddingFreshnessStateSchema, EmbeddingModeSchema, EmbeddingModelSchema, EmbeddingRequestSchema, EmbeddingResultSchema, EmbeddingServiceConfigSchema, EmbeddingSyncSchema, EmergeConfigSchema, EmergeEventDetailsSchema, EncryptedNodeSchemaZ, EncryptionFieldMapSchema, EncryptionResultSchema, EpisodeMatchSchema, EpisodeMetadataSchema, EpisodeNodeSchema, EpisodeSchema, EpisodeTemporalMetadataSchema, EvaluationResultSchema, EventTimeSchema, EvolutionConfigSchema, EvolutionEventDetailsSchema, EvolutionEventSchema, EvolutionLearningSchema, ExclusionCheckResultSchema, ExecutionMetricsSchema, ExportComplianceConfigSchema, ExportComplianceStatusSchema, ExtractionEdgeResultSchema, FADED_RETRIEVABILITY, FALLBACK_1_MODEL, FALLBACK_2_MODEL, FALLBACK_MAX_RETRIES, FALLBACK_RETRY_DELAY_MS, FAST_RULE_PATTERNS, FIELD_BOOSTS, FIELD_CATEGORIES, FIELD_CATEGORY_MAP, FIELD_MERGE_STRATEGIES, FILLER_PHRASES, FILLER_SCORE_THRESHOLD, FILLER_WORDS, FORGETTING_CONFIG, CONTENT_CATEGORIES2 as FORGETTING_CONTENT_CATEGORIES, FORGETTING_LIFECYCLE_STATES, FREE_DAILY_BUDGET, FREE_TIER_CAPACITY, FULL_SCHEMA, FadeResultSchema, FallbackConfigSchema, FallbackLevelSchema, FieldBoostSchema, FieldChangeSchema, FilterEdgeInputSchema, FilterNodeInputSchema, FixedAllocationsSchema, GATE_DECISIONS, GATE_FILTER_DEFAULTS, GATE_MIN_CONTENT_LENGTH, GATE_REASONS, GENERIC_WORDS, GIBBERISH_ENTROPY_THRESHOLD, GIBBERISH_WORD_RATIO_THRESHOLD, GOOGLE_MODELS, GRACE_PERIOD_DAYS, GRANULARITY_CONFIDENCE, GRAPH_SIZE_THRESHOLDS, GateFilterBypassSchema, GateFilterConfigSchema, GateFilterExtractionContextSchema, GateFilterInputEnvelopeSchema, GateFilterMetricsSchema, GateFilterResultSchema, GoogleModelSchema, GracePeriodStateSchema, GraphMetricsSchema, HANDLER_TYPES, HEADING_PATTERN, HEALTH_CHECK_FAILURE_THRESHOLD, HEALTH_CHECK_INTERVAL_MS, HEALTH_CHECK_TIMEOUT_MS, HEALTH_STATUSES, HEALTH_THRESHOLDS, HISTORY_MODE_PATTERNS, HISTORY_MODE_SUPERSEDED_PENALTY, HNSWIndexSchema, HTTP_UPGRADE_REQUIRED, HealthAssessmentSchema, HealthMetricsSchema, HistoryModeDetectionSchema, HybridSearchConfigSchema, HybridSearchResultSchema, INGESTION_DEFAULTS, INITIAL_DIFFICULTY, INITIAL_PROVIDER_HEALTH, INITIAL_STABILITY, INITIAL_STABILITY_BY_CATEGORY, INPUT_MODES, INPUT_SIZES, INPUT_SOURCES, INPUT_TYPES, INTERPRETATION_CONFIDENCE, InfrastructureConfigSchema, IngestOptionsSchema, IngestResultSchema, IngestionConfigSchema, IngestionTimeSchema, InputEnvelopeSchema, InsufficientCreditsErrorSchema, JWTValidationResultSchema, KEY_DERIVATION_FUNCTION, KEY_PURPOSES, KEY_ROTATION_TRIGGERS, KEY_VERSION_STATUSES, KeyDerivationParamsSchema, KeyHierarchySchema, KeyPurposeSchema, KeyRotationTriggerSchema, KeyVersionSchema, KeyVersionStatusSchema, LATENCY_TARGETS_MS, LAUNCH_STRATEGY, LAYER_ACCESS_SPEEDS, LAYER_CONFIGS, LAYER_PRIORITY, LEARNED_ADJUSTMENT_BOUNDS, LIFECYCLE_STATES, LIFECYCLE_THRESHOLDS, LIST_ITEM_PATTERN, LLMDetectionOutputSchema, LLMModelSchema, LLMProviderSchema, LLMRequestSchema, LLMResponseSchema, LLM_DETECTION_PROMPT, LLM_EMBEDDING_DIMENSIONS, LLM_EMBEDDING_MODELS, LLM_MODELS, LLM_PROVIDERS, LOCAL_CACHE_INDEXES, LOCAL_CACHE_TABLE, LOOKUP_PATTERNS, LastAccessedFilterSchema, LastSyncedVersionSchema, LaunchPhaseSchema, LayerCharacteristicsSchema, LayerConfigSchema, LayerStatsSchema, LearnEventDetailsSchema, LearningConfigSchema, LifecycleDeterminationSchema, LocalSearchResultSchema, MASTER_KEY_LENGTH_BITS, MATRYOSHKA_DIMS, MAX_STRENGTH, MERGE_RESULT_STATUSES, MERGE_STRATEGIES, MFA_OPTIONS, MIGRATION_RATE_MS_PER_1K_NODES, MIN_CONTENT_LENGTH, MIN_TOTAL_LENGTH, MODEL_CONFIGS, MODEL_DOWNGRADE_THRESHOLD, MODEL_TIERS, MODIFIERS, ManagedHistorySchema, ManualClusterCreateSchema, MasterKeyInfoSchema, MatchFactorsSchema, MergeConfigSchema, MergeEventDetailsSchema, MergeResultStatusSchema, MfaOptionSchema, ModelConfigSchema, ModelContextBudgetSchema, ModelDowngradeNotificationSchema, ModelPricingSchema, ModelTierSchema, MultiDeviceKeySyncSchema, NANOID_LENGTH, NEURAL_DEFAULTS, NODES_INDEXES, NODES_TABLE, NODE_ID_PREFIX, NODE_SYNC_STATUSES, NODE_TYPES, NONCE_LENGTH_BYTES, NOTIFICATION_TIERS, NPL_ACTION_ROUTES, NPL_AMBIGUITY_HANDLERS, NPL_AUTO_SUPERSEDE_THRESHOLDS, NPL_CACHEABLE_PROMPT_TYPES, NPL_CACHE_CONFIGS, NPL_CACHE_STRATEGIES, NPL_CONFIDENCE_LEVELS, NPL_CONFIDENCE_LEVEL_SCORES, NPL_CONTRADICTION_RECOMMENDATIONS, NPL_CONTRADICTION_RELATIONSHIPS, NPL_DETECTION_PRIORITY, NPL_DISQUALIFIER_CODES, NPL_DISQUALIFIER_TO_QCS_CODE, NPL_ERROR_TYPES, NPL_EXTRACTION_CONTENT_LIMITS, NPL_EXTRACTION_NODE_TYPES, NPL_FAST_PATH_RULES, NPL_INTENT_CONFIDENCE_THRESHOLDS, NPL_INTENT_DEFINITIONS, NPL_INTENT_TYPES, NPL_MODEL_RECOMMENDATIONS, NPL_MULTI_INTENT_PATTERNS, NPL_P001_EXAMPLES, NPL_P001_METADATA, NPL_P001_SYSTEM_MESSAGE, NPL_P001_USER_TEMPLATE, NPL_P002C_EXAMPLES, NPL_P002C_METADATA, NPL_P002C_SYSTEM_MESSAGE, NPL_P002C_USER_TEMPLATE, NPL_P002_EXAMPLES, NPL_P002_METADATA, NPL_P002_SYSTEM_MESSAGE, NPL_P002_USER_TEMPLATE, NPL_P003_EXAMPLES, NPL_P003_METADATA, NPL_P003_SYSTEM_MESSAGE, NPL_P003_USER_TEMPLATE, NPL_P004_EXAMPLES, NPL_P004_METADATA, NPL_P004_SYSTEM_MESSAGE, NPL_P004_USER_TEMPLATE, NPL_P005_EXAMPLES, NPL_P005_METADATA, NPL_P005_SYSTEM_MESSAGE, NPL_P005_USER_TEMPLATE, NPL_P006_EXAMPLES, NPL_P006_METADATA, NPL_P006_SYSTEM_MESSAGE, NPL_P006_USER_TEMPLATE, NPL_P007_EXAMPLES, NPL_P007_METADATA, NPL_P007_SYSTEM_MESSAGE, NPL_P007_USER_TEMPLATE, NPL_P008_EXAMPLES, NPL_P008_METADATA, NPL_P008_SYSTEM_MESSAGE, NPL_P008_TOKEN_BUDGET, NPL_P008_TONE_INSTRUCTIONS, NPL_P008_VERBOSITY_INSTRUCTIONS, NPL_P009_EXAMPLES, NPL_P009_METADATA, NPL_P009_SYSTEM_MESSAGE, NPL_P009_TOOL_LIST_TEMPLATE, NPL_P009_USER_TEMPLATE, NPL_P010B_EXAMPLES, NPL_P010B_METADATA, NPL_P010B_SYSTEM_MESSAGE, NPL_P010B_USER_TEMPLATE, NPL_P010_EXAMPLES, NPL_P010_METADATA, NPL_P010_SYSTEM_MESSAGE, NPL_P011_EXAMPLES, NPL_P011_METADATA, NPL_P011_SYSTEM_MESSAGE, NPL_P011_USER_TEMPLATE, NPL_PROMPT_IDS, NPL_PROMPT_INTEGRATIONS, NPL_PROMPT_NAMES, NPL_PROMPT_REGISTRY, NPL_PROMPT_TO_CACHE_TYPE, NPL_PROMPT_TO_OPERATION, NPL_PROMPT_VERSIONS, NPL_QUERY_CLASSIFICATIONS, NPL_TOKEN_BUDGETS, NSEConflictInfoSchema, NSEConflictResolverSchema, NSEMergeResultSchema, NSEMergeStrategySchema, NSEPlatformSchema, NSEStoredConflictSchema, NSESyncLogEntrySchema, NSESyncProgressSchema, NSEUserResolutionSchema, NSE_CONFLICT_RESOLVERS, NSE_FIELD_MERGE_STRATEGIES, NSE_MERGE_STRATEGIES, NSE_PLATFORMS, NSE_SYNC_BATCH_SIZE, NSE_SYNC_LOCK_TIMEOUT_SECONDS, NeuralPropertiesSchema, NeuralStateSchema, NodeCompressionStateSchema, NodeConnectionSchema, NodeContentSchema, NodeDecayInputSchema, NodeEmbeddingSchema, NodePriorityFactorsSchema, NodeStateSchema, NodeSyncStatusSchema, NodeVersionSchema, NormalizationResultSchema, NoteNodeSchema, NotificationActionSchema, NotificationTierSchema, NousEdgeSchema, NousNodeSchema, NplActionRouteSchema, NplAgentPlanSchema, NplAgentStepSchema, NplCacheStrategySchema, NplCacheablePromptTypeSchema, NplClarificationOptionSchema, NplClarificationResultSchema, NplClarificationStrategySchema, NplCompressionResultSchema, NplConfidenceLevelSchema, NplContextCustomizationSchema, NplContradictionDetectionResultSchema, NplContradictionRecommendationSchema, NplContradictionRelationshipSchema, NplDetectedEdgeSchema, NplDisqualifierCodeSchema, NplEdgeRelationshipResultSchema, NplEntitySchema, NplEntryPointSchema, NplErrorTypeSchema, NplExplorationStepSchema, NplExploreResultSchema, NplExtractedEntitySchema, NplExtractedNodeSchema, NplExtractionNodeTypeSchema, NplExtractionTemporalSchema, NplFastPathRuleSchema, NplIntentConfidenceThresholdsSchema, NplIntentExtractionResultSchema, NplIntentResultSchema, NplIntentTypeSchema, NplModelRecommendationSchema, NplMultiIntentPatternSchema, NplNodeExtractionResultSchema, NplOrientResultSchema, NplPromptErrorSchema, NplPromptExampleSchema, NplPromptIdSchema, NplPromptMetadataSchema, NplPromptTemplateSchema, NplQueryClassificationResultSchema, NplQueryClassificationSchema, NplSourceRefSchema, NplSuggestedEdgeSchema, NplSynthesizeResultSchema, NplTemporalRefSchema, NplTermEntrySchema, NplTokenBudgetSchema, NplVerificationResultSchema, OFFLINE_FUNCTIONALITY_LEVELS, OFFLINE_STATES, OFFLINE_STATE_CONFIGS, OFFLINE_STATE_TRANSITION_REFERENCE, OFFLINE_SYNC_BEHAVIORS, OFFLINE_THRESHOLDS, OLD_CODE_ERROR_MESSAGE, ONBOARDING_STATES, OPENAI_MODELS, OPERATION_AVAILABILITY, OPERATION_BUDGETS, OPERATION_CONFIGS, OPERATION_TYPES, OfflineCapabilityCheckSchema, OfflineFunctionalitySchema, OfflineStateConfigSchema, OfflineStateSchema, OfflineSyncBehaviorSchema, OfflineSyncQueueSchema, OnboardingActionSchema, OnboardingProgressSchema, OpenAIModelSchema, OperationAvailabilitySchema, OperationConfigSchema, OperationTypeSchema, P008_COMPRESSION_PROMPT_SPEC, PASSKEY_PLATFORMS, PASSKEY_SYNC_MECHANISMS, PATTERN_CONFIDENCE_WEIGHTS, PATTERN_DISQUALIFIERS, PATTERN_TRIGGERS, PERFORMANCE_REFERENCE, PHASE2_CONTEXT_INJECTION, PHASE_1_BUDGET_MS, PIPELINE_STAGES, PLAN_CONFIGS, PLATFORMS, PLATFORM_AUTH_CONFIGS, PRIMARY_MODEL, PRIORITY_WEIGHT_NAMES, PRIVACY_TIERS, PRIVATE_TIER_NODE_LIMITS, PROCESSING_ACTIONS, PROCESSING_PATHS, PROMOTION_THRESHOLD, PROMOTION_TRIGGERS, PROMPT_CACHE_CONFIGS, PROMPT_LIMITS, PROVIDERS, PROVIDER_CONFIGS, PROVIDER_HEALTH_STATUSES, PROVIDER_RATE_LIMITS, PROVIDER_RETRIEVAL_RATIOS, PackedContextSchema, ParentFieldsSchema, PasskeyInfoSchema, PasskeyPlatformSchema, PatternDetectionSchema, Phase2ContextInjectionSchema, Phase2HandoffMetadataSchema, PipelineEventSchema, PlanUsageLimitsSchema, PlatformApiKeySchema, PlatformAuthConfigSchema, PlatformSchema, PricingConfigSchema, PrioritizedNodeSchema, PriorityWeightNameSchema, PriorityWeightsSchema, PrivacyTierSchema, PrivateTierConflictSchema, PrivateTierPayloadSchema, ProcessResultSchema, PromotionResultSchema, PromptCacheConfigSchema, ProvenanceSchema, ProviderConfigSchema, ProviderHealthCheckSchema, ProviderHealthSchema, ProviderHealthStatusSchema, ProviderRateLimitsSchema, ProviderSchema, ProviderSelectionSchema, ProvisionalEdgeStateSchema, PullResultSchema, PushPayloadSchema, PushResultSchema, QCSConfigSchema, QCSHistoryModeConfigSchema, QCS_HISTORY_MODE_CONFIG, QCS_QUERY_TYPES, QUALITY_KEY_TO_PARAMS_QUERY_TYPE, QUALITY_TARGETS, QUALITY_WEIGHTS, QUERIES, QUERY_COMBINATION_STRATEGIES, QUERY_MODES, QUERY_MODE_CONFIGS, QUERY_STEP_BUDGETS, QUERY_TYPES, QUERY_TYPE_TO_OPERATION_KEY, QUERY_TYPE_TO_QUALITY_KEY, QUEUEABLE_TABLES, QUEUE_OPERATION_TYPES, QualityTargetSchema, QualityWeightsSchema, QueryAnalysisSchema, QueryClusterAffinitySchema, QueryModeConfigSchema, QueryModeSchema, QueryResultSchema, QueryTypeResultSchema, QueueSyncResultSchema, QueuedOperationSchema, RATE_LIMIT_WARNING_THRESHOLD, RAW_SUBTYPES, RCSSupersessionFlagSchema, RCSWeightsSchema, RCS_SUPERSESSION_FLAG, RCS_WEIGHTS, RECENCY_HALF_LIFE_DAYS, RECENT_NODE_WINDOW, RECOVERY_DERIVATION_INFO, RECOVERY_KEY_LENGTH_BYTES, RECOVERY_METHODS, RECOVERY_REMINDER_DAYS, RECOVERY_REMINDER_MESSAGES, RECOVERY_REMINDER_TYPES, RECOVERY_SETUP_STEPS, RECOVERY_VERIFICATION_ATTEMPT_LIMIT, RECOVERY_VERIFICATION_WORD_COUNT, RECOVERY_WORD_COUNT, REEMBEDDING_REASONS, REENCRYPTION_PRIORITY_ORDER, REFRESH_TOKEN_EXPIRY_DAYS, REPEATED_CHARS_PATTERN, REPEATED_CHARS_THRESHOLD, RERANKING_CONFIG, RERANKING_WEIGHTS, RESERVATION_STATUSES, RESOLUTION_ACTIONS, RESOLUTION_STRATEGIES, RESTORED_STRENGTH_BONUS, REVIEW_VERBS, ROTATION_BATCH_SIZE, ROTATION_EVENT_TYPES, ROTATION_MAX_BATCHES_PER_MINUTE, ROTATION_MIN_BATTERY_LEVEL, ROTATION_PAUSE_BETWEEN_BATCHES_MS, ROTATION_PHASES, ROTATION_TIMING_ESTIMATES, ROTATION_TIMING_REFERENCE, ROTATION_VERIFICATION_SAMPLE_PERCENT, ROUTING_CONFIG, RULE_CONFIDENCES, RankingReasonSchema, RateLimitConfigSchema, RateLimitEventSchema, RateLimitStateSchema, RawMetadataSchema, RawNodeSchema, RecoveryAttemptSchema, RecoveryCodeSchema, RecoveryMethodSchema, RecoveryRegenerationResultSchema, RecoveryReminderSchema, RecoveryReminderTypeSchema, RecoverySetupStateSchema, RecoverySetupStepSchema, ReembeddingQueueEntrySchema, ReembeddingReasonSchema, RejectionLogSchema, RerankingConfigSchema, RerankingWeightsSchema, ReservationStatusSchema, ResolutionStrategySchema, RestorationResultSchema, RetentionPolicySchema, RetrievalConfidenceResultSchema, RetrievalIntegrationConfigSchema, RotationConfigSchema, RotationEventSchema, RotationEventTypeSchema, RotationPhaseSchema, RotationProgressSchema, RouteHandlerSchema, RoutingDecisionSchema, SAVE_SIGNALS, SAVE_VERBS, SCHEDULED_ROTATION_MONTHS, SCHEMA_VERSION_TABLE, SCORE_DECAY_PER_DAY, SEASONS, SELF_TUNING_CONFIG, SEMANTIC_LAYER_CONFIG, SEMANTIC_LAYER_TYPES, SEMANTIC_TRUNCATION_KEEP_END, SEMANTIC_TRUNCATION_KEEP_START, SENTIMENTS, SERENDIPITY_LEVELS, SERENDIPITY_MAX_CANDIDATES, SERENDIPITY_MIN_CANDIDATES, SERENDIPITY_PERCENTILE, SERENDIPITY_THRESHOLDS, SIGN_IN_IMPLEMENTATIONS, SIMILARITY_CONFIG, SIMILARITY_EDGE_THRESHOLD, SIZE_THRESHOLDS, SKIP_DECISIONS, SOCIAL_PATTERNS_BY_LANG, SOURCE_CONFIDENCE, SOURCE_TYPES, SPAM_PATTERNS, SPARSE_EXTRA_RESPONSE_BUFFER, SPARSE_RETRIEVAL_THRESHOLD, SSAActivatedNodeSchema, SSAConfigSchema, SSAEdgeWeightsSchema, SSAParamsSchema, SSARankedNodeSchema, SSAResultSchema, SSAScoreBreakdownSchema, SSASearchFiltersSchema, SSASupersededConfigSchema, SSA_EDGE_WEIGHTS, SSA_PARAMS, SSA_SEED_THRESHOLD, SSA_SUPERSEDED_ACTIVATION_CAP, SSA_SUPERSEDED_CONFIG, SSA_SUPERSEDED_SPREAD_DECAY, STAGE_1_CANDIDATES, STAGE_2_CANDIDATES, STAGE_3_CANDIDATES, STALE_EDGE_THRESHOLD, STOPWORDS_CONFIG, STORAGE_LAYERS, STORAGE_PRESSURE_THRESHOLD, STREAM_CONFIG, STRENGTHENING_BONUSES, STRENGTHENING_EVENTS, SUMMARIZATION_COMPRESSION_TARGET, SUMMARIZATION_INPUT_BUDGET, SUMMARIZATION_MODEL, SUMMARIZATION_OUTPUT_BUDGET, SUMMARIZATION_TOKEN_TRIGGER, SUMMARIZATION_TURN_TRIGGER, SUMMARY_LIMITS, SUPERSEDED_ACCESS_DECAY_MULTIPLIER, SUPERSEDED_DECAY_MULTIPLIERS, SUPERSEDED_DORMANT_DAYS, SUPERSEDED_R_THRESHOLDS, SUPERSEDED_STATES, SUPERSEDED_STATE_CONFIGS, SUPPORTED_LANGUAGES, SYNCABLE_FIELDS, SYNC_EVENT_TYPES, SYNC_HEADER_DEVICE_ID, SYNC_HEADER_SCHEMA_VERSION, SYNC_HEADER_SERVER_TIME, SYNC_LOG_ENTRY_TYPES, SYNC_METADATA_TABLE, SYNC_MODES, SYNC_STATUSES, ScaledSerendipityConfigSchema, SchemaVersionErrorSchema, ScoreBreakdownSchema, ScoreCalculationInputSchema, ScoredNodeSchema, SearchFiltersSchema, SearchRequestSchema, SearchResponseSchema, SectionMetadataSchema, SectionNodeSchema, SeedNodeSchema, SeedingResultSchema, SelfImprovementConfigSchema, SentimentSchema, SerendipityCandidateSchema, ServerSyncStateSchema, SessionNodeSchema, SessionSchema, SharedMemoryDetailSchema, SignInImplementationSchema, SimilarityCheckResultSchema, SplitConfigSchema, SplitEventDetailsSchema, SpreadingResultSchema, StabilityUpdateResultSchema, StagedNodeSchema, StateTransitionSchema, StopwordsConfigSchema, StorageMetricsSchema, StrategyResultSchema, StreamOptionsSchema, StrengtheningRecordSchema, StrengtheningResultSchema, StructuralDetectionSchema, SummaryContentSchema, SummaryNodeSchema, SupersededStateConfigSchema, SupersededStateSchema, SupersededStateTransitionSchema, SupersessionFieldsSchema, SyncConfigSchema, SyncLockSchema, SyncLogEntryTypeSchema, SyncManagerOptionsSchema, SyncMetadataSchema, SyncStateSchema, SyncableFieldSchema, SystemHealthStatusSchema, TEMPORAL_CONFIG, TEMPORAL_GRANULARITIES, TENDENCY_DEFAULTS, THOROUGHNESS_LEVELS, THOROUGHNESS_MULTIPLIERS, THREAT_MODEL, TIER_COMPARISON_TABLE, TIER_DEFINITIONS, TIER_DOWNGRADE_SEQUENCE, TIER_MIGRATION_STATUSES, TIER_THRESHOLDS, TIME_REFERENCE_PATTERNS, TIME_SOURCES, TOKEN_ESTIMATE_CHARS_PER_TOKEN, TOPIC_SIMILARITY_THRESHOLD, TPSInputSchema, TPSOutputSchema, TRANSFORMATION_TYPES, TRASH_CONFIG, TRIGGER_SCORES, TRUNCATION_MAX_LATENCY_MS, TRUNCATION_TIERS, TRUNCATION_TIER_LATENCIES, TYPE_DETECTION_CRITERIA, TemporalConfidenceSchema, TemporalConstraintSchema, TemporalEdgeResultSchema, TemporalModelSchema, TenantConfigSchema, TerminationResultSchema, ThoroughnessLevelSchema, ThoroughnessMultipliersSchema, ThoughtPathSchema, ThreatModelEntrySchema, Tier3InputSchema, Tier4InputSchema, TierComparisonSchema, TierDefinitionSchema, TierMigrationRequestSchema, TierMigrationStateSchema, TierMigrationStatusSchema, TierResultSchema, TokenCountCacheSchema, TokenUsageSchema, TopicConsentSchema, TransformationSchema, TrashRecordSchema, TriggerEventSchema, TruncatedContentSchema, TruncationTierSchema, TursoConfigSchema, TypeClassificationSchema, UI_YIELD_DELAY_MS, UNIFIED_TEMPLATES, URGENCY_LEVELS, USAGE_TIER_THRESHOLDS, USER_EDGE_CONFIG, USER_PLANS, USER_RESOLUTIONS, USER_RESOLUTION_ACTIONS, USER_RESOLUTION_DESCRIPTIONS, USER_SETTINGS_TABLE, USER_TYPES, UnifiedTemplateSchema, UrgencyLevelSchema, UsageLimitEventSchema, UserBehaviorModelSchema, UserKeyMetadataSchema, UserPlanSchema, UserResolutionActionSchema, UserResolutionSchema, UserUsageStateSchema, VALID_TRANSITIONS, VECTOR_COMPACTION_THRESHOLD, VERIFICATION_PROMPT, VERSION_COMPARISON_RESULTS, VERSION_VECTOR_INACTIVE_KEY, VectorSearchOptionsSchema, VerificationOutputSchema, VersionComparisonSchema, VersionVectorSchema, WEIGHT_BOUNDS, WMEntryOptionsSchema, WM_CHECK_INTERVAL_MINUTES, WM_CONFIG, WM_DURATION_MULTIPLIER_RANGE, WM_EVALUATION_JOB_SPEC, WM_RETRIEVAL_PRIORITY_MULTIPLIER, WM_STATUSES, WORKING_MEMORY_DURATIONS, WorkingMemoryConfigSchema, WorkingMemoryStateSchema, addConceptLink, addContentTime, addDependent, addEventTime, addReferencePattern, addToConflictQueue, addToHistory, adjustThreshold, adjustedTimestamp, affinityScore, allocateContext, analyzeComplexity, analyzeQuery, applyCascadeDecay, applyCleanup, applyCoactivationBonus, applyEdit, applyLearningAdjustment, applyMergeStrategy, applyStrategy, applySupersededCap, applyThoroughness, applyTimeBasedDecay, applyUnifiedTemplate, assessHealth, atssRecordFailure, atssRecordSuccess, attemptAutoMerge, authorityScore, backgroundReencrypt, buildConnectionMap, buildEpisodeMatch, buildFilterPredicate, buildHistoryTimeline, buildInverseParams, buildLocalSearchIndex, buildPhase2Handoff, buildScoredNodes, buildVectorSearchQuery, calculateActualCost, calculateAdaptiveBudget, calculateAdaptiveLimits, calculateAffinity, calculateAggregatedWeight, calculateBackoffDelay, calculateBreakEvenCalls, calculateBulkCost, calculateChunkCount, calculateClusterHealth, calculateConnectivityScore, calculateCurrentScore, calculateDegradationLevel, calculateDifficulty, calculateEffectiveWeight, calculateEmbeddingCost, calculateEmergeThreshold, calculateEntropy, calculateEpisodeConfidence, calculateExtractionEdge, calculateMatchScore, calculateNodePriority, calculateOfflineState, calculatePatternConfidence, calculateQualityScore, calculateRecencyScore, calculateRetrievability, calculateRetrievalConfidence, calculateSimilarityWeight, calculateSplitThreshold, calculateStrengtheningDelta, calculateSupersededSpread, calculateSyncStats, calculateTemporalConfidence, calculateTemporalWeight, calculateTierForUsage, calculateTokenCost, calculateUsagePercent, calculateUserEdgeWeight, canAutoMerge, canAutoResolveConflict, canAutoSupersede, canAutoSupersedeTier, canContinueRotation, canMigrateTier, canUndo, cancelBatchJob, categoryToReason, checkAccuracyAlerts, checkBYOKRateLimit, checkCacheHit, checkConsent, checkContinuationEligibility, checkCreditSufficiency, checkCredits, checkDeletionCriteria, checkDependencies, checkDisqualifiers, checkExclusionRules, checkProviderHealth, checkRateLimit, checkSimilarity, checkStateTransition, checkTopicMatch, checkUserBudget, chunkDocument, classify, classifyConflictStrength, classifyConflictType, classifyInput, classifyQuery, classifyQueryType, clusterCosineSimilarity, combineForEmbedding, commitNodes, compactVector, compareVectors, completeRotation, computeChangeSet, computeChanges, computeChecksum, computeConfidenceScore, computeReverseOperation, computeWeeklyMetrics, convertToSSARankedNodes, cosineSimilarity, countBlocks, countRealWords, createBadgeState, createBlock, createChunkFields, createCircuitBreaker, createClusterFromTemplate, createCompressionState, createConceptNode, createConflictHistoryEntry, createConflictQueueItem, createDefaultDatabaseOptions, createDefaultEdgeNeuralProperties, createDefaultInfrastructureConfig, createDefaultMetrics, createDefaultNeuralProperties, createDefaultRetentionPolicy, createDefaultSyncConfig, createDefaultSyncManagerOptions, createDegradedResult, createDerivationParams, createDeviceInfo, createEdge, createEdgeRecord, createEditHistoryCollection, createEmptyHealthMetrics, createEmptyLayerStats, createEmptyMetrics, createEpisode, createEpisodeTemporalMetadata, createErrorResponse, createEvolutionLearning, createFailedSyncResult, createInitialFallbackState, createInitialSyncState, createInitialVersion, createInputEnvelope, createNeuralState, createNode, createNodeEmbedding, createNoteNode, createOnboardingProgress, createParentFields, createProvisionalState, createRejectionLog, createRowTransformer, createSearchResponse, createSearchResult, createSessionTemporalEdges, createStoredConflict, createStream, createSuccessResult, createSuccessSyncResult, createSyncLock, createSyncMetadata, createTemporalAdjacentEdge, createTemporalModel, createTendenciesFromTemplate, createThoughtPath, createUndoEntry, createUndoRequest, createWeightComponents, createWeightedEdge, createWorkingMemoryState, daysBetween3 as daysBetween, daysSince, decayCoactivationBonus, decayEdge, decryptBYOKKey, decryptEmbedding, decryptNode, deepEqual, deriveAllKeys, deriveBody, deriveContentKey, deriveEmbeddingKey, deriveMasterKey, deriveMetadataKey, deriveRecoveryKey, detectActionVerb, detectContinuationEdges, detectContradiction, detectHistoryMode, detectPrivateTierConflict, detectSeason, detectTimeReference, determineLifecycle, determineSupersededState, didUserEngage, dismissRecoveryReminder, edgeConnects, embedBatch, embedQuery, embedTexts, encryptBYOKKey, encryptEmbedding, encryptMasterKeyForRecovery, encryptNode, estimateCacheSavings, estimateCost, estimateMigrationTime, estimateMonthlyCost, estimateOperationCost, estimateTokens, evaluateNode, evaluateWorkingMemory, executeDryRun, executeSSA, expandMinimumContext, explainBudget, extractQueryAttribute, extractQueryEntities, extractQueryTerms, fadeNode, fastRuleClassify, filterEdgesByType, filterEpisodesByTimeRange, filterEpisodesByType, finalizeCredits, findBlockByHeading, findBlockById, calculateDifficulty2 as forgettingCalculateDifficulty, calculateRetrievability2 as forgettingCalculateRetrievability, getDecayLifecycleState2 as forgettingGetDecayLifecycleState, updateStabilityOnAccess2 as forgettingUpdateStabilityOnAccess, formatContextDate, formatDate, formatForPresentation, fromFloat32Array, fuseScores, gateFilter, generateBlockId, generateClusterId, generateConflictId, generateContextPrefix, generateDebugReport, generateDecisionExplanation, generateDeviceId, generateEdgeId, generateEditId, generateEpisodeId, generateEventId, generateExplanation, generateNodeId, generateQueryPrefix, generateRecoveryCode, generateSalt, generateSummaryNodeId, generateTransactionId, generateUndoId, getAccuracyModeConfig, getAccuracyTarget, getAdaptiveEvolutionThresholds, getAdaptiveThreshold, getAffectedBlocks, getAllBlockIds, getAllProviderHealth, getApiCallRoute, getApiCallRouteForKeyType, getAppStoreDeclaration, getAvailableModelTier, getBYOKConfig, getBaseDifficultyForCategory, getBatchDeadlineHours, getBatchDiscountPercent, getBatchResults, getBatchStatus, getBudgetForOperation, getCacheConfig, getCacheStats, getClerkConfig, getClusterTemplates, getComplianceRequirements, getCompressionConfig, getConfidenceLevel, getConfirmationLevel, getContentState, getCreditBalance, getCurrentDegradationLevel, getDecayLifecycleState, getDecayMultiplier, getDefaultChunkRetrievalConfig, getDefaultContextWindowConfig, getDefaultDeviceName, getDefaultHybridConfig, getDegradationModeConfig, getDisqualifierDescription, getDowngradeMessage, getDropStatements, getEdgesForNode, getEditById, getEffectiveDecayMultiplier, getEffectiveStopwords, getEmbeddingConfig, getEpisodesWithConcept, getEvolutionMode, getFallbackLevel, getFieldBoost, getFieldCategories, getFieldCategory, getFieldMergeStrategy, getFillerScore, getFreeTierCapacity, getGlobalPreferences, getGranularityConfidence, getHealthyProviderCount, getHttpStatus, getIncomingEdges, getIndexStatements, getInitialDifficulty, getInitialStability, getInitialStabilityForCategory, getInterpretationConfidence, getInverseOperation, getKeyVersionForNode, getLatencyTarget, getLaunchStrategy, getLayerAccessSpeed, getLayerConfig, getLayerForQuery, getLayersByPriority, getMergeStrategy, getModelConfig, getModelContextBudget, getModelDimensions, getModelForOperation, getModelsForProvider, getModelsForTier, getMostRecentEpisodes, getNestedValue, getNextProvider, getNodeTypesForLayer, getNodesNeedingRotation, getNormalizedQueries, getOfflineCapabilities, getOfflineStateConfig, getOnboardingStepNumber, getOperationAvailability, getOperationConfig, getOtherNode, getOutgoingEdges, getPendingConflicts, getPlanConfig, getPlatformAuthConfig, getPrimaryTimestamp, getPromotionProgress, getProtectedThreats, getProviderConfig, getProviderForModel, getProviderRateLimits, getQualityTargetForQueryType, getQueryModeConfig, getQueueSize, getQueueStatus, getRateLimitConfig, getRateLimitState, getRecoveryReminder, getReservationBuffer, getReservationExpiryMinutes, getResolutionStrategy, getRetrievalMode, getSSAEdgeWeight, getSeasonRange, getSerendipityThreshold, getSharedMemories, getSourceConfidence, getStorageLayer, getSupersededPenalty, getSystemHealthStatus, getTableStatements, getThreatModel, getTierDefinition, getTierMigrationProgress, getTimeRemaining, getToolDefinition, getTrainingData, getUnifiedTemplate, getUnprotectedThreats, getUserMessage, getUserUsageState, getValidActions, getVerificationIndices, getWorkingMemoryDuration, grantConsent, graphScore, handleApproachingLimit, handleBudgetExhaustion, handleDecline, handleProviderFailure, handleProviderRecovery, handleSparseRetrieval, hardTruncate, hasActiveInboundLinks, hasHeadings, hasHighConfidence, hasMultipleLists, hasOnboardingStarted, hasSentimentFlip, hasSessionEnded, hashContext, hoursBetween2 as hoursBetween, hybridSeed, identifySerendipity, incrementProvisionalActivation, incrementVector, inferExpectedTypes, ingest, initiateKeyRotation, injectSupersessionContext, invalidateCache, isABSConfig, isAccuracyMode, isActionValid, isAdaptiveBudgetRequest, isAdaptiveBudgetResult, isAllCaps, isAllowedUserEdgeType, isApproachingRateLimit, isArchiveLayerType, isAutoSupersede, isBatchJobStatus, isBlockingFlag, isBudgetExhaustionReason, isBudgetExhaustionResult, isBudgetMode, isCacheablePromptType, isChunkEdgeType, isChunkFields, isChunkLevel, isChunkRetrievalConfig, isChunkingConfig, isCluster, isClusterHealth, isClusterMembership, isClusterRoutingResult, isClusterSource, isClusterSummary, isClusterTemplate, isClusterTendencies, isClusterUnhealthy, isClusterWithCentroid, isConflictType, isConsentActive, isConsentScope, isContextAllocationRequest, isContextAllocationResult, isContextAssemblyMetrics, isContextPlacement, isContextWindowConfig, isConversationHistoryConfig, isDegradationLevel, isDeletionCandidate, isDetectionTier, isEdgeDead, isEdgeDecayed, isEmbeddingCompatible, isEmbeddingFresh, isEmbeddingMode, isEmptySemantic, isEpisodeInRange, isEpisodeLayerType, isEvolutionConfig, isEvolutionEvent, isEvolutionLearning, isEvolutionTrigger, isFixedAllocations, isContentCategory as isForgettingContentCategory, isForgettingLifecycleState, isGibberish, isGracePeriodActive, isInColdStartMode, isInWorkingMemory, isKeyVersionStatus, isLLMModel, isManagedHistory, isModelContextBudget, isModelTier, isNSEMergeStrategy, isNSEPlatform, isNeverCompress, isNodePriorityFactors, isNodeSyncStatus, isOfflineState, isOnboardingAction, isOnboardingComplete, isOnboardingProgress, isOnboardingState, isOperationAllowedForTier, isOperationAvailable, isOperationType, isPackedContext, isParentFields, isPlatform, isPrimaryModel, isPrioritizedNode, isPriorityWeightName, isPriorityWeights, isPrivacyTier, isProvider, isProviderAvailable, isProviderHealthStatus, isProvisional, isQueryClusterAffinity, isQueryMode, isQuickUndoWindow, isRegionSupported, isReservationStatus, isRestorable, isRetryable, isSemanticLayerType, isSocialOnly, isStaleEdge, isStoragePressure, isStrengtheningEventType, isSupersededState, isSyncLockExpired, isSyncLockValid, isThoroughnessLevel, isTokenCountCache, isTokenValid, isTruncatedContent, isTruncationTier, isUndoable, isUnifiedTemplate, isUrgencyLevel, isUserPlan, isUserType, isValidStorageLayer, isValidTursoUrl, isVersionComparison, isWithinBudget, keywordScore, logDetectionEvent, manageConversationHistory, mapCategoryToNodeType, mapContentCategoryToNodeType, mapRetrievalQueryType, mapToOperationBudgetKey, mapToParamsQueryType, markAsFaded, markAsPromoted, matchesReferencePattern, matchesSpamPattern, matchesTimeRange, meetsCompressionRequirements, meetsSimilarityThreshold, mergeMemberships, mergeSSAConfig, mergeVectors, modelSupportsCaching, moveToTrash, needsReEmbedding, normalizeScores, normalizeWhitespace, nplBuildContextCustomization, nplConfidenceLevelToScore, nplFastPathDetect, nplFindMultiIntentPattern, nplGetActionRoute, nplGetAllPromptIds, nplGetAmbiguityStrategy, nplGetCacheContent, nplGetConfidenceLevel, nplGetPrompt, nplScoreToConfidenceLevel, nplShouldAutoSupersede, nseAutoMerge, packNodes, parseAbsoluteMonth, parseDatabaseUrl, parseEdge, parseEpisode, parseFilters, parseFuzzyTime, parseIntoBlocks, parseRelativeTime, parseSearchRequest, parseTemporalExpression, permanentlyDelete, processExpiredConflicts, processInput, processOfflineQueue, promoteNode, pruneEditHistory, queueOfflineOperation, reactivateEdge, recencyScore, recordAccess, recordFailure, recordManualClusterCreate, recordRateLimitRequest, recordSuccess, recordTriggerEvent, recoverMasterKey, recoverViaEmail, refundCredits, regenerateRecoveryCode, removeConceptLink, removeGenericWords, removeStopwords, removeTimeReferences, reorderForAttention, reportFalsePositive, requestConsent, rerankCandidates, reserveCredits, resetCircuitBreaker, resetDailyUsage, resetLearning, resetRateLimitCounters, resolveConflict, resolveSourceConflict, restoreFromDormant, restoreFromTrash, resumeRotation, retryWithBackoff, revokeBYOKKey, revokeConsent, rotatePlatformKey, routeClassification, routeQueryToClusters, routeRequest, routeToPrimaryCluster, runDecayCycle, runTier1_5Normalization, runTier2Pattern, safeEdit, safeParseEdge, safeParseEpisode, save, saveRotationProgress, scaleSerendipity, searchLocalIndex, selectProvider, selectTemplate, selectTruncationTier, semanticScore, semanticTruncate, setArchiveLink, setDegradationLevel, setNestedValue, shouldAggregateChunks, shouldAllowRequest, shouldArchive, shouldBypass, shouldChunk, shouldCompress, shouldConsiderNewEdge, shouldContinueToNextTier, shouldExpandChunks, shouldExpireProvisional, shouldFlagSupersessionHistory, shouldFollowSupersedesEdges, shouldIncludeSuperseded, shouldIndexTerm, shouldPromote, shouldPromoteProvisional, shouldPrompt, shouldPruneEdge, shouldReauthenticate, shouldRequireConfirmation, shouldRetry, shouldShowWeeklyPrompt, shouldSkipEmbedding, shouldSkipPhase2, shouldSuggestEmerge, shouldSuggestMerge, shouldSuggestSplit, shouldTerminate, shouldTrainClassifier, shouldUseBatch, shouldUseBatchEmbedding, shouldUseBlocks, shouldUseTier, sortByFusedScore, sortBySimilarity, sortEdgesByCoActivation, sortEdgesByStrength, sortEpisodesByConfidence, sortEpisodesByTime, spreadActivation, stageNodes, startTierMigration, storeBYOKKey, strengthenEdge, strengthenNode, supportsBatch, supportsCaching, takeTopK, toFloat32Array, tokenizeForBM25, touchBlock, trackBYOKDecryption, trackRequest, trackUsage, transformTursoResult, transformVectorSearchResult, transitionOnboarding, tripCircuitBreaker, truncateForComparison, truncateToMatryoshka, updateClockDrift, updateCoActivationWeight, updateConsentSettings, updateEdgeConfidence, updateEmbedding, updateEpisodeSummary, updateLearning, updateLifecycle, updateMetrics, updateOfflineState, updateStabilityOnAccess, validateAdaptiveLimits, validateBM25Config, validateBudgetConfig, validateChangeSet, validateClassificationResult, validateCompressionState, validateConfidenceThresholds, validateConflictResolution, validateDatabaseOptions, validateDecayConfig, validateDecayJobResult, validateDeletionCandidate, validateDetectedConflict, validateDeviceInfo, validateDisqualifierResult, validateEdge, validateEditOperation, validateEditRequest, validateEmbeddingDimensions, validateEmbeddingFreshness, validateEpisode, validateGraphMetrics, validateHealthAssessment, validateHealthMetrics, validateHybridConfig, validateInfrastructureConfig, validateJWT, validateLayerStats, validateNSEMergeResult, validateNSEStoredConflict, validateNSESyncLogEntry, validateNSEUserResolution, validateNeuralState, validatePhase2HandoffMetadata, validatePrivateTierPayload, validateProvisionalState, validatePushPayload, validateQCSConfig, validateQualityTarget, validateQueryTypeResult, validateRerankingConfig, validateRerankingWeights, validateSSAConfig, validateSSAEdgeWeights, validateSSAParams, validateSSAResult, validateSearchFilters, validateSearchRequest, validateSession, validateStrengtheningRecord, validateSummaryNode, validateSyncConfig, validateSyncLock, validateSyncManagerOptions, validateSyncMetadata, validateSyncState, validateTPSInput, validateTPSOutput, validateTarget, validateTemporalConstraint, validateTursoConfig, validateVectorSearchOptions, validateVersionVector, validateWeightComponents, validateWorkingMemoryState, verifyRecoveryWords, verifyRotation, warmCache };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map