import { z } from 'zod';
import { nanoid } from 'nanoid';

// src/nodes/index.ts

// src/constants.ts
var NANOID_LENGTH = 12;
var NODE_ID_PREFIX = "n_";
var NODE_TYPES = [
  "concept",
  "episode",
  "document",
  "section",
  "chunk",
  "note",
  "raw"
];
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
var MODIFIERS = ["user", "ai", "system", "sync"];
var EVENT_TIME_SOURCES = ["explicit", "inferred", "user_stated"];
var CONTENT_TIME_TYPES = ["historical", "relative", "approximate"];
var NEURAL_DEFAULTS = {
  stability: 0.5,
  retrievability: 1,
  accessCount: 0
};
var EXTRACTION_DEPTHS = ["summary", "section", "full"];
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
z.object({
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

export { AnyNodeSchema, ChunkNodeSchema, ConceptNodeSchema, DocumentMetadataSchema, DocumentNodeSchema, EmbeddingFieldSchema, EpisodeMetadataSchema, EpisodeNodeSchema, NeuralPropertiesSchema, NodeContentSchema, NodeStateSchema, NodeVersionSchema, NoteNodeSchema, NousNodeSchema, ProvenanceSchema, RawMetadataSchema, RawNodeSchema, SectionMetadataSchema, SectionNodeSchema, createConceptNode, createDefaultNeuralProperties, createInitialVersion, createNode, createNoteNode, generateNodeId, recordAccess, updateLifecycle };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map