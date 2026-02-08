/**
 * @module @nous/core/constants
 * @description All constants, enums, and configuration values
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-011/spec/constants.ts
 */
/** Length of nanoid for globally unique IDs */
declare const NANOID_LENGTH = 12;
/** Prefix for node IDs: "n_" + nanoid(12) */
declare const NODE_ID_PREFIX = "n_";
/** Prefix for block IDs: "b_" + nanoid(12) */
declare const BLOCK_ID_PREFIX = "b_";
/** Prefix for edge IDs: "e_" + nanoid(12) */
declare const EDGE_ID_PREFIX = "e_";
/** Prefix for edit record IDs: "edit_" + nanoid(12) */
declare const EDIT_ID_PREFIX = "edit_";
declare const NODE_TYPES: readonly ["concept", "episode", "document", "section", "chunk", "note", "raw"];
type NodeType = (typeof NODE_TYPES)[number];
declare const SEMANTIC_LAYER_TYPES: NodeType[];
declare const EPISODE_LAYER_TYPES: NodeType[];
declare const ARCHIVE_LAYER_TYPES: NodeType[];
declare const CONCEPT_SUBTYPES: readonly ["fact", "definition", "relationship", "preference", "belief", "procedure", "entity", "event", "insight"];
type ConceptSubtype = (typeof CONCEPT_SUBTYPES)[number] | `custom:${string}`;
declare const EPISODE_SUBTYPES: readonly ["lecture", "meeting", "conversation", "note_session", "document_read", "thought", "external_event"];
type EpisodeSubtype = (typeof EPISODE_SUBTYPES)[number] | `custom:${string}`;
declare const RAW_SUBTYPES: readonly ["transcript", "document", "note", "image", "audio_recording"];
type RawSubtype = (typeof RAW_SUBTYPES)[number];
declare const BLOCK_TYPES: readonly ["paragraph", "heading", "list", "list_item", "code", "quote", "callout", "divider", "table", "image"];
type BlockType = (typeof BLOCK_TYPES)[number];
declare const EDGE_TYPES: readonly ["relates_to", "part_of", "mentioned_in", "causes", "precedes", "contradicts", "supersedes", "derived_from", "similar_to"];
type EdgeType = (typeof EDGE_TYPES)[number];
declare const LIFECYCLE_STATES: readonly ["working", "active", "superseded", "dormant", "archived"];
type LifecycleState = (typeof LIFECYCLE_STATES)[number];
declare const SOURCE_TYPES: readonly ["extraction", "manual", "inference", "import"];
type SourceType = (typeof SOURCE_TYPES)[number];
declare const CONTENT_SOURCES: readonly ["import", "user_note", "chat_extraction", "fact", "document", "transcript"];
type ContentSource = (typeof CONTENT_SOURCES)[number];
declare const EDIT_TARGET_METHODS: readonly ["block_id", "heading", "position", "search", "full"];
type EditTargetMethod = (typeof EDIT_TARGET_METHODS)[number];
declare const EDIT_ACTIONS: readonly ["replace", "insert", "append", "delete"];
type EditAction = (typeof EDIT_ACTIONS)[number];
declare const MODIFIERS: readonly ["user", "ai", "system", "sync"];
type Modifier = (typeof MODIFIERS)[number];
declare const EDIT_HISTORY_RETENTION: {
    readonly maxEdits: 100;
    readonly maxAgeDays: 30;
    readonly undoWindowHours: 24;
    readonly pruneSchedule: "daily";
};
declare const TEMPORAL_GRANULARITIES: readonly ["minute", "hour", "day", "week", "month", "year"];
type TemporalGranularity = (typeof TEMPORAL_GRANULARITIES)[number];
declare const EVENT_TIME_SOURCES: readonly ["explicit", "inferred", "user_stated"];
type EventTimeSource = (typeof EVENT_TIME_SOURCES)[number];
declare const CONTENT_TIME_TYPES: readonly ["historical", "relative", "approximate"];
type ContentTimeType = (typeof CONTENT_TIME_TYPES)[number];
declare const INPUT_TYPES: readonly ["DOCUMENT", "TRANSCRIPT", "CONVERSATION", "NOTE", "IMPORT"];
type InputType = (typeof INPUT_TYPES)[number];
declare const INPUT_SIZES: readonly ["tiny", "small", "medium", "large", "huge"];
type InputSize = (typeof INPUT_SIZES)[number];
declare const PROCESSING_PATHS: readonly ["fast", "standard", "progressive", "conversation"];
type ProcessingPath = (typeof PROCESSING_PATHS)[number];
declare const SIZE_THRESHOLDS: {
    readonly tiny: {
        readonly min: 0;
        readonly max: 50;
    };
    readonly small: {
        readonly min: 50;
        readonly max: 500;
    };
    readonly medium: {
        readonly min: 500;
        readonly max: 5000;
    };
    readonly large: {
        readonly min: 5000;
        readonly max: 25000;
    };
    readonly huge: {
        readonly min: 25000;
        readonly max: number;
    };
};
declare const BLOCK_LENGTH_THRESHOLD = 1000;
declare const BLOCK_LIST_THRESHOLD = 3;
declare const NEURAL_DEFAULTS: {
    readonly stability: 0.5;
    readonly retrievability: 1;
    readonly accessCount: 0;
};
declare const EXTRACTION_DEPTHS: readonly ["summary", "section", "full"];
type ExtractionDepth = (typeof EXTRACTION_DEPTHS)[number];
declare const HEADING_PATTERN: RegExp;
declare const LIST_ITEM_PATTERN: RegExp;

export { ARCHIVE_LAYER_TYPES as A, type BlockType as B, type ConceptSubtype as C, type InputType as D, type EditTargetMethod as E, LIFECYCLE_STATES as F, LIST_ITEM_PATTERN as G, HEADING_PATTERN as H, INPUT_SIZES as I, MODIFIERS as J, NANOID_LENGTH as K, type LifecycleState as L, type Modifier as M, type NodeType as N, NEURAL_DEFAULTS as O, NODE_ID_PREFIX as P, NODE_TYPES as Q, type RawSubtype as R, type SourceType as S, type TemporalGranularity as T, PROCESSING_PATHS as U, type ProcessingPath as V, RAW_SUBTYPES as W, SEMANTIC_LAYER_TYPES as X, SIZE_THRESHOLDS as Y, SOURCE_TYPES as Z, TEMPORAL_GRANULARITIES as _, type EditAction as a, type ExtractionDepth as b, type EpisodeSubtype as c, type ContentSource as d, type EventTimeSource as e, type ContentTimeType as f, type EdgeType as g, BLOCK_ID_PREFIX as h, BLOCK_LENGTH_THRESHOLD as i, BLOCK_LIST_THRESHOLD as j, BLOCK_TYPES as k, CONCEPT_SUBTYPES as l, CONTENT_SOURCES as m, CONTENT_TIME_TYPES as n, EDGE_ID_PREFIX as o, EDGE_TYPES as p, EDIT_ACTIONS as q, EDIT_HISTORY_RETENTION as r, EDIT_ID_PREFIX as s, EDIT_TARGET_METHODS as t, EPISODE_LAYER_TYPES as u, EPISODE_SUBTYPES as v, EVENT_TIME_SOURCES as w, EXTRACTION_DEPTHS as x, INPUT_TYPES as y, type InputSize as z };
