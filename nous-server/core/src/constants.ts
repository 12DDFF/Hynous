/**
 * @module @nous/core/constants
 * @description All constants, enums, and configuration values
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-011/spec/constants.ts
 */

// ============================================================
// ID CONFIGURATION
// ============================================================

/** Length of nanoid for globally unique IDs */
export const NANOID_LENGTH = 12;

/** Prefix for node IDs: "n_" + nanoid(12) */
export const NODE_ID_PREFIX = 'n_';

/** Prefix for block IDs: "b_" + nanoid(12) */
export const BLOCK_ID_PREFIX = 'b_';

/** Prefix for edge IDs: "e_" + nanoid(12) */
export const EDGE_ID_PREFIX = 'e_';

/** Prefix for edit record IDs: "edit_" + nanoid(12) */
export const EDIT_ID_PREFIX = 'edit_';

// ============================================================
// NODE TYPES
// ============================================================

export const NODE_TYPES = [
  'concept',
  'episode',
  'document',
  'section',
  'chunk',
  'note',
  'raw',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const SEMANTIC_LAYER_TYPES: NodeType[] = ['concept', 'note', 'chunk'];
export const EPISODE_LAYER_TYPES: NodeType[] = ['episode', 'document', 'section'];
export const ARCHIVE_LAYER_TYPES: NodeType[] = ['raw'];

// ============================================================
// SUBTYPES
// ============================================================

export const CONCEPT_SUBTYPES = [
  'fact',
  'definition',
  'relationship',
  'preference',
  'belief',
  'procedure',
  'entity',
  'event',
  'insight',
] as const;

export type ConceptSubtype = (typeof CONCEPT_SUBTYPES)[number] | `custom:${string}`;

export const EPISODE_SUBTYPES = [
  'lecture',
  'meeting',
  'conversation',
  'note_session',
  'document_read',
  'thought',
  'external_event',
] as const;

export type EpisodeSubtype = (typeof EPISODE_SUBTYPES)[number] | `custom:${string}`;

export const RAW_SUBTYPES = [
  'transcript',
  'document',
  'note',
  'image',
  'audio_recording',
] as const;

export type RawSubtype = (typeof RAW_SUBTYPES)[number];

// ============================================================
// BLOCK TYPES
// ============================================================

export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'list',
  'list_item',
  'code',
  'quote',
  'callout',
  'divider',
  'table',
  'image',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

// ============================================================
// EDGE TYPES
// ============================================================

export const EDGE_TYPES = [
  'relates_to',
  'part_of',
  'mentioned_in',
  'causes',
  'precedes',
  'contradicts',
  'supersedes',
  'derived_from',
  'similar_to',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

// ============================================================
// LIFECYCLE STATES
// ============================================================

export const LIFECYCLE_STATES = [
  'working',
  'active',
  'superseded',
  'dormant',
  'archived',
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

// ============================================================
// SOURCE TYPES
// ============================================================

export const SOURCE_TYPES = [
  'extraction',
  'manual',
  'inference',
  'import',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

// ============================================================
// CONTENT SOURCES
// ============================================================

export const CONTENT_SOURCES = [
  'import',
  'user_note',
  'chat_extraction',
  'fact',
  'document',
  'transcript',
] as const;

export type ContentSource = (typeof CONTENT_SOURCES)[number];

// ============================================================
// EDIT SYSTEM
// ============================================================

export const EDIT_TARGET_METHODS = [
  'block_id',
  'heading',
  'position',
  'search',
  'full',
] as const;

export type EditTargetMethod = (typeof EDIT_TARGET_METHODS)[number];

export const EDIT_ACTIONS = ['replace', 'insert', 'append', 'delete'] as const;

export type EditAction = (typeof EDIT_ACTIONS)[number];

export const MODIFIERS = ['user', 'ai', 'system', 'sync'] as const;

export type Modifier = (typeof MODIFIERS)[number];

export const EDIT_HISTORY_RETENTION = {
  maxEdits: 100,
  maxAgeDays: 30,
  undoWindowHours: 24,
  pruneSchedule: 'daily',
} as const;

// ============================================================
// TEMPORAL
// ============================================================

export const TEMPORAL_GRANULARITIES = [
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'year',
] as const;

export type TemporalGranularity = (typeof TEMPORAL_GRANULARITIES)[number];

export const EVENT_TIME_SOURCES = ['explicit', 'inferred', 'user_stated'] as const;

export type EventTimeSource = (typeof EVENT_TIME_SOURCES)[number];

export const CONTENT_TIME_TYPES = ['historical', 'relative', 'approximate'] as const;

export type ContentTimeType = (typeof CONTENT_TIME_TYPES)[number];

// ============================================================
// PROCESSING PATHS
// ============================================================

export const INPUT_TYPES = [
  'DOCUMENT',
  'TRANSCRIPT',
  'CONVERSATION',
  'NOTE',
  'IMPORT',
] as const;

export type InputType = (typeof INPUT_TYPES)[number];

export const INPUT_SIZES = ['tiny', 'small', 'medium', 'large', 'huge'] as const;

export type InputSize = (typeof INPUT_SIZES)[number];

export const PROCESSING_PATHS = [
  'fast',
  'standard',
  'progressive',
  'conversation',
] as const;

export type ProcessingPath = (typeof PROCESSING_PATHS)[number];

export const SIZE_THRESHOLDS = {
  tiny: { min: 0, max: 50 },
  small: { min: 50, max: 500 },
  medium: { min: 500, max: 5000 },
  large: { min: 5000, max: 25000 },
  huge: { min: 25000, max: Infinity },
} as const;

// ============================================================
// BLOCK DECISION THRESHOLDS
// ============================================================

export const BLOCK_LENGTH_THRESHOLD = 1000;
export const BLOCK_LIST_THRESHOLD = 3;

// ============================================================
// NEURAL DEFAULTS
// ============================================================

export const NEURAL_DEFAULTS = {
  stability: 0.5,
  retrievability: 1.0,
  accessCount: 0,
} as const;

// ============================================================
// EXTRACTION DEPTH
// ============================================================

export const EXTRACTION_DEPTHS = ['summary', 'section', 'full'] as const;

export type ExtractionDepth = (typeof EXTRACTION_DEPTHS)[number];

// ============================================================
// REGEX PATTERNS
// ============================================================

export const HEADING_PATTERN = /^#{1,6}\s/m;
export const LIST_ITEM_PATTERN = /^[-*]\s/gm;
