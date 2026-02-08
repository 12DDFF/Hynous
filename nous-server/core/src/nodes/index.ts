/**
 * @module @nous/core/nodes
 * @description Node types, schemas, and creation utilities - Universal Node Schema (UNS)
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-011/spec/node-schema.ts
 *
 * This module defines the core data structures for all nodes in Nous.
 * Every other infrastructure component depends on these interfaces.
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  NANOID_LENGTH,
  NODE_ID_PREFIX,
  NODE_TYPES,
  CONCEPT_SUBTYPES,
  EPISODE_SUBTYPES,
  RAW_SUBTYPES,
  LIFECYCLE_STATES,
  SOURCE_TYPES,
  EXTRACTION_DEPTHS,
  MODIFIERS,
  NEURAL_DEFAULTS,
  type NodeType,
  type ConceptSubtype,
  type EpisodeSubtype,
  type RawSubtype,
  type LifecycleState,
  type SourceType,
  type ExtractionDepth,
  type Modifier,
} from '../constants';
import { type Block, BlockSchema } from '../blocks';
import {
  type TemporalModel,
  TemporalModelSchema,
  createTemporalModel,
} from '../temporal';

// ============================================================
// ID GENERATION
// ============================================================

/**
 * Generates a globally unique node ID.
 * Format: "n_" + 12-character nanoid
 */
export function generateNodeId(): string {
  return NODE_ID_PREFIX + nanoid(NANOID_LENGTH);
}

// ============================================================
// EMBEDDING (Placeholder for storm-016)
// ============================================================

/**
 * Embedding field structure.
 * Actual embedding logic defined in storm-016.
 */
export interface EmbeddingField {
  /** Dense vector representation */
  vector: Float32Array;
  /** Model that generated the embedding */
  model: string;
  /** When embedding was generated (ISO 8601) */
  created_at: string;
}

export const EmbeddingFieldSchema = z.object({
  vector: z.instanceof(Float32Array),
  model: z.string(),
  created_at: z.string().datetime(),
});

// ============================================================
// NEURAL PROPERTIES
// ============================================================

/**
 * Neural properties for SSA activation and decay.
 */
export interface NeuralProperties {
  /** Stability: How well-established this memory is (0-1) */
  stability: number;
  /** Retrievability: Current ability to recall (0-1) */
  retrievability: number;
  /** Last time this node was accessed (ISO 8601) */
  last_accessed: string;
  /** Total number of times accessed */
  access_count: number;
}

export const NeuralPropertiesSchema = z.object({
  stability: z.number().min(0).max(1),
  retrievability: z.number().min(0).max(1),
  last_accessed: z.string().datetime(),
  access_count: z.number().int().min(0),
});

/**
 * Creates default neural properties for a new node.
 */
export function createDefaultNeuralProperties(): NeuralProperties {
  return {
    stability: NEURAL_DEFAULTS.stability,
    retrievability: NEURAL_DEFAULTS.retrievability,
    last_accessed: new Date().toISOString(),
    access_count: NEURAL_DEFAULTS.accessCount,
  };
}

// ============================================================
// PROVENANCE
// ============================================================

/**
 * Tracks where content came from.
 */
export interface Provenance {
  /** How this node was created */
  source: SourceType;
  /** Parent node ID (episode, document, etc.) */
  parent_id?: string;
  /** Confidence in the extraction/creation (0-1) */
  confidence: number;
}

export const ProvenanceSchema = z.object({
  source: z.enum(SOURCE_TYPES),
  parent_id: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

// ============================================================
// NODE STATE
// ============================================================

/**
 * Current state of the node.
 */
export interface NodeState {
  /** How deeply this node has been extracted */
  extraction_depth: ExtractionDepth;
  /** Current lifecycle state */
  lifecycle: LifecycleState;
}

export const NodeStateSchema = z.object({
  extraction_depth: z.enum(EXTRACTION_DEPTHS),
  lifecycle: z.enum(LIFECYCLE_STATES),
});

// ============================================================
// VERSIONING
// ============================================================

/**
 * Version tracking for conflict detection.
 */
export interface NodeVersion {
  /** Increments on every edit */
  version: number;
  /** When last modified (ISO 8601) */
  lastModified: string;
  /** Who made the last modification */
  lastModifier: Modifier;
  /** Content hash for validation (optional) */
  checksum?: string;
}

export const NodeVersionSchema = z.object({
  version: z.number().int().min(1),
  lastModified: z.string().datetime(),
  lastModifier: z.enum(MODIFIERS),
  checksum: z.string().optional(),
});

/**
 * Creates initial versioning for a new node.
 */
export function createInitialVersion(modifier: Modifier = 'system'): NodeVersion {
  return {
    version: 1,
    lastModified: new Date().toISOString(),
    lastModifier: modifier,
  };
}

// ============================================================
// NODE CONTENT
// ============================================================

/**
 * Content structure for nodes.
 */
export interface NodeContent {
  /** Short title/label */
  title: string;
  /** Main content body */
  body?: string;
  /** AI-generated summary */
  summary?: string;
  /** Structured content blocks (optional) */
  blocks?: Block[];
}

export const NodeContentSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().optional(),
  summary: z.string().optional(),
  blocks: z.array(BlockSchema).optional(),
});

// ============================================================
// BASE NODE INTERFACE
// ============================================================

/**
 * Universal Node Schema (UNS) - Base interface all nodes extend.
 */
export interface NousNode {
  /** Globally unique identifier */
  id: string;
  /** Node type determines behavior and storage layer */
  type: NodeType;
  /** Type-specific subtype */
  subtype?: string;
  /** The actual content of the node */
  content: NodeContent;
  /** Vector embedding for semantic search */
  embedding?: EmbeddingField;
  /** Four-type temporal model */
  temporal: TemporalModel;
  /** Properties for SSA and decay */
  neural: NeuralProperties;
  /** Where this content came from */
  provenance: Provenance;
  /** Current node state */
  state: NodeState;
  /** Version tracking for editing and sync */
  versioning: NodeVersion;
}

export const NousNodeSchema = z.object({
  id: z.string().regex(/^n_[a-zA-Z0-9_-]{12}$/),
  type: z.enum(NODE_TYPES),
  subtype: z.string().optional(),
  content: NodeContentSchema,
  embedding: EmbeddingFieldSchema.optional(),
  temporal: TemporalModelSchema,
  neural: NeuralPropertiesSchema,
  provenance: ProvenanceSchema,
  state: NodeStateSchema,
  versioning: NodeVersionSchema,
});

// ============================================================
// TYPE-SPECIFIC EXTENSIONS
// ============================================================

/**
 * Concept Node - Atomic piece of knowledge.
 */
export interface ConceptNode extends NousNode {
  type: 'concept';
  subtype: ConceptSubtype;
}

export const ConceptNodeSchema = NousNodeSchema.extend({
  type: z.literal('concept'),
  subtype: z.union([z.enum(CONCEPT_SUBTYPES), z.string().regex(/^custom:.+$/)]),
});

/**
 * Episode-specific metadata.
 */
export interface EpisodeMetadata {
  duration_minutes?: number;
  concept_links: string[];
  archive_link?: string;
  participants?: string[];
  location?: string;
  temporal_confidence: {
    source: number;
    granularity: number;
    interpretation: number;
    combined: number;
  };
}

export const EpisodeMetadataSchema = z.object({
  duration_minutes: z.number().positive().optional(),
  concept_links: z.array(z.string()),
  archive_link: z.string().optional(),
  participants: z.array(z.string()).optional(),
  location: z.string().optional(),
  temporal_confidence: z.object({
    source: z.number().min(0).max(1),
    granularity: z.number().min(0).max(1),
    interpretation: z.number().min(0).max(1),
    combined: z.number().min(0).max(1),
  }),
});

/**
 * Episode Node - Time-anchored event container.
 */
export interface EpisodeNode extends NousNode {
  type: 'episode';
  subtype: EpisodeSubtype;
  episode_specific: EpisodeMetadata;
}

export const EpisodeNodeSchema = NousNodeSchema.extend({
  type: z.literal('episode'),
  subtype: z.union([z.enum(EPISODE_SUBTYPES), z.string().regex(/^custom:.+$/)]),
  episode_specific: EpisodeMetadataSchema,
});

/**
 * Document-specific metadata.
 */
export interface DocumentMetadata {
  format: string;
  page_count?: number;
  word_count: number;
  sections: string[];
  extraction_status: 'minimal' | 'structural' | 'partial' | 'complete';
}

export const DocumentMetadataSchema = z.object({
  format: z.string(),
  page_count: z.number().int().positive().optional(),
  word_count: z.number().int().min(0),
  sections: z.array(z.string()),
  extraction_status: z.enum(['minimal', 'structural', 'partial', 'complete']),
});

/**
 * Document Node - Container for large inputs.
 */
export interface DocumentNode extends NousNode {
  type: 'document';
  document_specific: DocumentMetadata;
}

export const DocumentNodeSchema = NousNodeSchema.extend({
  type: z.literal('document'),
  document_specific: DocumentMetadataSchema,
});

/**
 * Section-specific metadata.
 */
export interface SectionMetadata {
  document_id: string;
  heading: string;
  position: number;
  extracted: boolean;
  concepts: string[];
}

export const SectionMetadataSchema = z.object({
  document_id: z.string(),
  heading: z.string(),
  position: z.number().int().min(0),
  extracted: z.boolean(),
  concepts: z.array(z.string()),
});

/**
 * Section Node - Hierarchical part of a document.
 */
export interface SectionNode extends NousNode {
  type: 'section';
  section_specific: SectionMetadata;
}

export const SectionNodeSchema = NousNodeSchema.extend({
  type: z.literal('section'),
  section_specific: SectionMetadataSchema,
});

/**
 * Raw-specific metadata.
 */
export interface RawMetadata {
  content_type: 'text' | 'transcript' | 'document' | 'image' | 'audio';
  original_format?: string;
  file_size_bytes?: number;
  word_count?: number;
  episode_link?: string;
  extraction_status: 'pending' | 'processing' | 'complete' | 'failed';
}

export const RawMetadataSchema = z.object({
  content_type: z.enum(['text', 'transcript', 'document', 'image', 'audio']),
  original_format: z.string().optional(),
  file_size_bytes: z.number().int().positive().optional(),
  word_count: z.number().int().min(0).optional(),
  episode_link: z.string().optional(),
  extraction_status: z.enum(['pending', 'processing', 'complete', 'failed']),
});

/**
 * Raw Node - Full verbatim archive content.
 */
export interface RawNode extends NousNode {
  type: 'raw';
  subtype: RawSubtype;
  raw_specific: RawMetadata;
}

export const RawNodeSchema = NousNodeSchema.extend({
  type: z.literal('raw'),
  subtype: z.enum(RAW_SUBTYPES),
  raw_specific: RawMetadataSchema,
});

/**
 * Note Node - User-created note.
 */
export interface NoteNode extends NousNode {
  type: 'note';
}

export const NoteNodeSchema = NousNodeSchema.extend({
  type: z.literal('note'),
});

/**
 * Chunk Node - Semantic unit extracted from content.
 */
export interface ChunkNode extends NousNode {
  type: 'chunk';
}

export const ChunkNodeSchema = NousNodeSchema.extend({
  type: z.literal('chunk'),
});

// ============================================================
// UNION TYPE
// ============================================================

/**
 * Union of all node types.
 */
export type AnyNode =
  | ConceptNode
  | EpisodeNode
  | DocumentNode
  | SectionNode
  | RawNode
  | NoteNode
  | ChunkNode;

/**
 * Schema that validates any node type.
 */
export const AnyNodeSchema = z.discriminatedUnion('type', [
  ConceptNodeSchema,
  EpisodeNodeSchema,
  DocumentNodeSchema,
  SectionNodeSchema,
  RawNodeSchema,
  NoteNodeSchema,
  ChunkNodeSchema,
]);

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

export interface CreateNodeOptions {
  subtype?: string;
  source?: SourceType;
  confidence?: number;
  parent_id?: string;
  modifier?: Modifier;
  timezone?: string;
}

/**
 * Creates a new node with default values.
 */
export function createNode(
  type: NodeType,
  content: NodeContent,
  options: CreateNodeOptions = {}
): NousNode {
  return {
    id: generateNodeId(),
    type,
    subtype: options.subtype,
    content,
    temporal: createTemporalModel(options.timezone),
    neural: createDefaultNeuralProperties(),
    provenance: {
      source: options.source ?? 'manual',
      parent_id: options.parent_id,
      confidence: options.confidence ?? 1.0,
    },
    state: {
      extraction_depth: 'full',
      lifecycle: 'working',
    },
    versioning: createInitialVersion(options.modifier ?? 'user'),
  };
}

/**
 * Creates a concept node.
 */
export function createConceptNode(
  title: string,
  body: string,
  subtype: ConceptSubtype,
  options: CreateNodeOptions = {}
): ConceptNode {
  const base = createNode('concept', { title, body }, { ...options, subtype });
  return base as ConceptNode;
}

/**
 * Creates a note node.
 */
export function createNoteNode(
  title: string,
  body: string,
  options: CreateNodeOptions = {}
): NoteNode {
  const base = createNode('note', { title, body }, options);
  return base as NoteNode;
}

/**
 * Updates a node's access tracking (for SSA/decay).
 */
export function recordAccess(node: NousNode): NousNode {
  return {
    ...node,
    neural: {
      ...node.neural,
      last_accessed: new Date().toISOString(),
      access_count: node.neural.access_count + 1,
    },
  };
}

/**
 * Updates a node's lifecycle state.
 */
export function updateLifecycle(node: NousNode, lifecycle: LifecycleState): NousNode {
  return {
    ...node,
    state: {
      ...node.state,
      lifecycle,
    },
  };
}

// ============================================================
// RE-EXPORTS
// ============================================================

export type {
  NodeType,
  ConceptSubtype,
  EpisodeSubtype,
  RawSubtype,
  LifecycleState,
  SourceType,
  ExtractionDepth,
  Modifier,
  Block,
  TemporalModel,
};
