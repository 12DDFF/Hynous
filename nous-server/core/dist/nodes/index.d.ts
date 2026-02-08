import { z } from 'zod';
import { N as NodeType, S as SourceType, b as ExtractionDepth, L as LifecycleState, M as Modifier, C as ConceptSubtype, c as EpisodeSubtype, R as RawSubtype } from '../constants-Blu2FVkv.js';
import { Block } from '../blocks/index.js';
import { TemporalModel } from '../temporal/index.js';

/**
 * @module @nous/core/nodes
 * @description Node types, schemas, and creation utilities - Universal Node Schema (UNS)
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-011/spec/node-schema.ts
 *
 * This module defines the core data structures for all nodes in Nous.
 * Every other infrastructure component depends on these interfaces.
 */

/**
 * Generates a globally unique node ID.
 * Format: "n_" + 12-character nanoid
 */
declare function generateNodeId(): string;
/**
 * Embedding field structure.
 * Actual embedding logic defined in storm-016.
 */
interface EmbeddingField {
    /** Dense vector representation */
    vector: Float32Array;
    /** Model that generated the embedding */
    model: string;
    /** When embedding was generated (ISO 8601) */
    created_at: string;
}
declare const EmbeddingFieldSchema: z.ZodObject<{
    vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
    model: z.ZodString;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    vector: Float32Array<ArrayBuffer>;
    model: string;
    created_at: string;
}, {
    vector: Float32Array<ArrayBuffer>;
    model: string;
    created_at: string;
}>;
/**
 * Neural properties for SSA activation and decay.
 */
interface NeuralProperties {
    /** Stability: How well-established this memory is (0-1) */
    stability: number;
    /** Retrievability: Current ability to recall (0-1) */
    retrievability: number;
    /** Last time this node was accessed (ISO 8601) */
    last_accessed: string;
    /** Total number of times accessed */
    access_count: number;
}
declare const NeuralPropertiesSchema: z.ZodObject<{
    stability: z.ZodNumber;
    retrievability: z.ZodNumber;
    last_accessed: z.ZodString;
    access_count: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    stability: number;
    retrievability: number;
    last_accessed: string;
    access_count: number;
}, {
    stability: number;
    retrievability: number;
    last_accessed: string;
    access_count: number;
}>;
/**
 * Creates default neural properties for a new node.
 */
declare function createDefaultNeuralProperties(): NeuralProperties;
/**
 * Tracks where content came from.
 */
interface Provenance {
    /** How this node was created */
    source: SourceType;
    /** Parent node ID (episode, document, etc.) */
    parent_id?: string;
    /** Confidence in the extraction/creation (0-1) */
    confidence: number;
}
declare const ProvenanceSchema: z.ZodObject<{
    source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
    parent_id: z.ZodOptional<z.ZodString>;
    confidence: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    confidence: number;
    source: "import" | "extraction" | "manual" | "inference";
    parent_id?: string | undefined;
}, {
    confidence: number;
    source: "import" | "extraction" | "manual" | "inference";
    parent_id?: string | undefined;
}>;
/**
 * Current state of the node.
 */
interface NodeState {
    /** How deeply this node has been extracted */
    extraction_depth: ExtractionDepth;
    /** Current lifecycle state */
    lifecycle: LifecycleState;
}
declare const NodeStateSchema: z.ZodObject<{
    extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
    lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
}, "strip", z.ZodTypeAny, {
    extraction_depth: "section" | "full" | "summary";
    lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
}, {
    extraction_depth: "section" | "full" | "summary";
    lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
}>;
/**
 * Version tracking for conflict detection.
 */
interface NodeVersion {
    /** Increments on every edit */
    version: number;
    /** When last modified (ISO 8601) */
    lastModified: string;
    /** Who made the last modification */
    lastModifier: Modifier;
    /** Content hash for validation (optional) */
    checksum?: string;
}
declare const NodeVersionSchema: z.ZodObject<{
    version: z.ZodNumber;
    lastModified: z.ZodString;
    lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
    checksum: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version: number;
    lastModified: string;
    lastModifier: "user" | "ai" | "system" | "sync";
    checksum?: string | undefined;
}, {
    version: number;
    lastModified: string;
    lastModifier: "user" | "ai" | "system" | "sync";
    checksum?: string | undefined;
}>;
/**
 * Creates initial versioning for a new node.
 */
declare function createInitialVersion(modifier?: Modifier): NodeVersion;
/**
 * Content structure for nodes.
 */
interface NodeContent {
    /** Short title/label */
    title: string;
    /** Main content body */
    body?: string;
    /** AI-generated summary */
    summary?: string;
    /** Structured content blocks (optional) */
    blocks?: Block[];
}
declare const NodeContentSchema: z.ZodObject<{
    title: z.ZodString;
    body: z.ZodOptional<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
}, "strip", z.ZodTypeAny, {
    title: string;
    summary?: string | undefined;
    body?: string | undefined;
    blocks?: Block[] | undefined;
}, {
    title: string;
    summary?: string | undefined;
    body?: string | undefined;
    blocks?: Block[] | undefined;
}>;
/**
 * Universal Node Schema (UNS) - Base interface all nodes extend.
 */
interface NousNode {
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
declare const NousNodeSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["concept", "episode", "document", "section", "chunk", "note", "raw"]>;
    subtype: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "document" | "concept" | "episode" | "section" | "chunk" | "note" | "raw";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "document" | "concept" | "episode" | "section" | "chunk" | "note" | "raw";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>;
/**
 * Concept Node - Atomic piece of knowledge.
 */
interface ConceptNode extends NousNode {
    type: 'concept';
    subtype: ConceptSubtype;
}
declare const ConceptNodeSchema: z.ZodObject<{
    id: z.ZodString;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"concept">;
    subtype: z.ZodUnion<[z.ZodEnum<["fact", "definition", "relationship", "preference", "belief", "procedure", "entity", "event", "insight"]>, z.ZodString]>;
}, "strip", z.ZodTypeAny, {
    type: "concept";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: string;
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "concept";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: string;
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>;
/**
 * Episode-specific metadata.
 */
interface EpisodeMetadata {
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
declare const EpisodeMetadataSchema: z.ZodObject<{
    duration_minutes: z.ZodOptional<z.ZodNumber>;
    concept_links: z.ZodArray<z.ZodString, "many">;
    archive_link: z.ZodOptional<z.ZodString>;
    participants: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    location: z.ZodOptional<z.ZodString>;
    temporal_confidence: z.ZodObject<{
        source: z.ZodNumber;
        granularity: z.ZodNumber;
        interpretation: z.ZodNumber;
        combined: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        source: number;
        granularity: number;
        interpretation: number;
        combined: number;
    }, {
        source: number;
        granularity: number;
        interpretation: number;
        combined: number;
    }>;
}, "strip", z.ZodTypeAny, {
    concept_links: string[];
    temporal_confidence: {
        source: number;
        granularity: number;
        interpretation: number;
        combined: number;
    };
    duration_minutes?: number | undefined;
    archive_link?: string | undefined;
    participants?: string[] | undefined;
    location?: string | undefined;
}, {
    concept_links: string[];
    temporal_confidence: {
        source: number;
        granularity: number;
        interpretation: number;
        combined: number;
    };
    duration_minutes?: number | undefined;
    archive_link?: string | undefined;
    participants?: string[] | undefined;
    location?: string | undefined;
}>;
/**
 * Episode Node - Time-anchored event container.
 */
interface EpisodeNode extends NousNode {
    type: 'episode';
    subtype: EpisodeSubtype;
    episode_specific: EpisodeMetadata;
}
declare const EpisodeNodeSchema: z.ZodObject<{
    id: z.ZodString;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"episode">;
    subtype: z.ZodUnion<[z.ZodEnum<["lecture", "meeting", "conversation", "note_session", "document_read", "thought", "external_event"]>, z.ZodString]>;
    episode_specific: z.ZodObject<{
        duration_minutes: z.ZodOptional<z.ZodNumber>;
        concept_links: z.ZodArray<z.ZodString, "many">;
        archive_link: z.ZodOptional<z.ZodString>;
        participants: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        location: z.ZodOptional<z.ZodString>;
        temporal_confidence: z.ZodObject<{
            source: z.ZodNumber;
            granularity: z.ZodNumber;
            interpretation: z.ZodNumber;
            combined: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        }, {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        }>;
    }, "strip", z.ZodTypeAny, {
        concept_links: string[];
        temporal_confidence: {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        };
        duration_minutes?: number | undefined;
        archive_link?: string | undefined;
        participants?: string[] | undefined;
        location?: string | undefined;
    }, {
        concept_links: string[];
        temporal_confidence: {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        };
        duration_minutes?: number | undefined;
        archive_link?: string | undefined;
        participants?: string[] | undefined;
        location?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "episode";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: string;
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    episode_specific: {
        concept_links: string[];
        temporal_confidence: {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        };
        duration_minutes?: number | undefined;
        archive_link?: string | undefined;
        participants?: string[] | undefined;
        location?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "episode";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: string;
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    episode_specific: {
        concept_links: string[];
        temporal_confidence: {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        };
        duration_minutes?: number | undefined;
        archive_link?: string | undefined;
        participants?: string[] | undefined;
        location?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>;
/**
 * Document-specific metadata.
 */
interface DocumentMetadata {
    format: string;
    page_count?: number;
    word_count: number;
    sections: string[];
    extraction_status: 'minimal' | 'structural' | 'partial' | 'complete';
}
declare const DocumentMetadataSchema: z.ZodObject<{
    format: z.ZodString;
    page_count: z.ZodOptional<z.ZodNumber>;
    word_count: z.ZodNumber;
    sections: z.ZodArray<z.ZodString, "many">;
    extraction_status: z.ZodEnum<["minimal", "structural", "partial", "complete"]>;
}, "strip", z.ZodTypeAny, {
    format: string;
    word_count: number;
    sections: string[];
    extraction_status: "minimal" | "structural" | "partial" | "complete";
    page_count?: number | undefined;
}, {
    format: string;
    word_count: number;
    sections: string[];
    extraction_status: "minimal" | "structural" | "partial" | "complete";
    page_count?: number | undefined;
}>;
/**
 * Document Node - Container for large inputs.
 */
interface DocumentNode extends NousNode {
    type: 'document';
    document_specific: DocumentMetadata;
}
declare const DocumentNodeSchema: z.ZodObject<{
    id: z.ZodString;
    subtype: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"document">;
    document_specific: z.ZodObject<{
        format: z.ZodString;
        page_count: z.ZodOptional<z.ZodNumber>;
        word_count: z.ZodNumber;
        sections: z.ZodArray<z.ZodString, "many">;
        extraction_status: z.ZodEnum<["minimal", "structural", "partial", "complete"]>;
    }, "strip", z.ZodTypeAny, {
        format: string;
        word_count: number;
        sections: string[];
        extraction_status: "minimal" | "structural" | "partial" | "complete";
        page_count?: number | undefined;
    }, {
        format: string;
        word_count: number;
        sections: string[];
        extraction_status: "minimal" | "structural" | "partial" | "complete";
        page_count?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "document";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    document_specific: {
        format: string;
        word_count: number;
        sections: string[];
        extraction_status: "minimal" | "structural" | "partial" | "complete";
        page_count?: number | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "document";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    document_specific: {
        format: string;
        word_count: number;
        sections: string[];
        extraction_status: "minimal" | "structural" | "partial" | "complete";
        page_count?: number | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>;
/**
 * Section-specific metadata.
 */
interface SectionMetadata {
    document_id: string;
    heading: string;
    position: number;
    extracted: boolean;
    concepts: string[];
}
declare const SectionMetadataSchema: z.ZodObject<{
    document_id: z.ZodString;
    heading: z.ZodString;
    position: z.ZodNumber;
    extracted: z.ZodBoolean;
    concepts: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    heading: string;
    position: number;
    document_id: string;
    extracted: boolean;
    concepts: string[];
}, {
    heading: string;
    position: number;
    document_id: string;
    extracted: boolean;
    concepts: string[];
}>;
/**
 * Section Node - Hierarchical part of a document.
 */
interface SectionNode extends NousNode {
    type: 'section';
    section_specific: SectionMetadata;
}
declare const SectionNodeSchema: z.ZodObject<{
    id: z.ZodString;
    subtype: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"section">;
    section_specific: z.ZodObject<{
        document_id: z.ZodString;
        heading: z.ZodString;
        position: z.ZodNumber;
        extracted: z.ZodBoolean;
        concepts: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        heading: string;
        position: number;
        document_id: string;
        extracted: boolean;
        concepts: string[];
    }, {
        heading: string;
        position: number;
        document_id: string;
        extracted: boolean;
        concepts: string[];
    }>;
}, "strip", z.ZodTypeAny, {
    type: "section";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    section_specific: {
        heading: string;
        position: number;
        document_id: string;
        extracted: boolean;
        concepts: string[];
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "section";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    section_specific: {
        heading: string;
        position: number;
        document_id: string;
        extracted: boolean;
        concepts: string[];
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>;
/**
 * Raw-specific metadata.
 */
interface RawMetadata {
    content_type: 'text' | 'transcript' | 'document' | 'image' | 'audio';
    original_format?: string;
    file_size_bytes?: number;
    word_count?: number;
    episode_link?: string;
    extraction_status: 'pending' | 'processing' | 'complete' | 'failed';
}
declare const RawMetadataSchema: z.ZodObject<{
    content_type: z.ZodEnum<["text", "transcript", "document", "image", "audio"]>;
    original_format: z.ZodOptional<z.ZodString>;
    file_size_bytes: z.ZodOptional<z.ZodNumber>;
    word_count: z.ZodOptional<z.ZodNumber>;
    episode_link: z.ZodOptional<z.ZodString>;
    extraction_status: z.ZodEnum<["pending", "processing", "complete", "failed"]>;
}, "strip", z.ZodTypeAny, {
    extraction_status: "complete" | "pending" | "processing" | "failed";
    content_type: "image" | "document" | "transcript" | "text" | "audio";
    word_count?: number | undefined;
    original_format?: string | undefined;
    file_size_bytes?: number | undefined;
    episode_link?: string | undefined;
}, {
    extraction_status: "complete" | "pending" | "processing" | "failed";
    content_type: "image" | "document" | "transcript" | "text" | "audio";
    word_count?: number | undefined;
    original_format?: string | undefined;
    file_size_bytes?: number | undefined;
    episode_link?: string | undefined;
}>;
/**
 * Raw Node - Full verbatim archive content.
 */
interface RawNode extends NousNode {
    type: 'raw';
    subtype: RawSubtype;
    raw_specific: RawMetadata;
}
declare const RawNodeSchema: z.ZodObject<{
    id: z.ZodString;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"raw">;
    subtype: z.ZodEnum<["transcript", "document", "note", "image", "audio_recording"]>;
    raw_specific: z.ZodObject<{
        content_type: z.ZodEnum<["text", "transcript", "document", "image", "audio"]>;
        original_format: z.ZodOptional<z.ZodString>;
        file_size_bytes: z.ZodOptional<z.ZodNumber>;
        word_count: z.ZodOptional<z.ZodNumber>;
        episode_link: z.ZodOptional<z.ZodString>;
        extraction_status: z.ZodEnum<["pending", "processing", "complete", "failed"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_status: "complete" | "pending" | "processing" | "failed";
        content_type: "image" | "document" | "transcript" | "text" | "audio";
        word_count?: number | undefined;
        original_format?: string | undefined;
        file_size_bytes?: number | undefined;
        episode_link?: string | undefined;
    }, {
        extraction_status: "complete" | "pending" | "processing" | "failed";
        content_type: "image" | "document" | "transcript" | "text" | "audio";
        word_count?: number | undefined;
        original_format?: string | undefined;
        file_size_bytes?: number | undefined;
        episode_link?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "raw";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: "image" | "document" | "transcript" | "note" | "audio_recording";
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    raw_specific: {
        extraction_status: "complete" | "pending" | "processing" | "failed";
        content_type: "image" | "document" | "transcript" | "text" | "audio";
        word_count?: number | undefined;
        original_format?: string | undefined;
        file_size_bytes?: number | undefined;
        episode_link?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "raw";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: "image" | "document" | "transcript" | "note" | "audio_recording";
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    raw_specific: {
        extraction_status: "complete" | "pending" | "processing" | "failed";
        content_type: "image" | "document" | "transcript" | "text" | "audio";
        word_count?: number | undefined;
        original_format?: string | undefined;
        file_size_bytes?: number | undefined;
        episode_link?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>;
/**
 * Note Node - User-created note.
 */
interface NoteNode extends NousNode {
    type: 'note';
}
declare const NoteNodeSchema: z.ZodObject<{
    id: z.ZodString;
    subtype: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"note">;
}, "strip", z.ZodTypeAny, {
    type: "note";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "note";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>;
/**
 * Chunk Node - Semantic unit extracted from content.
 */
interface ChunkNode extends NousNode {
    type: 'chunk';
}
declare const ChunkNodeSchema: z.ZodObject<{
    id: z.ZodString;
    subtype: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"chunk">;
}, "strip", z.ZodTypeAny, {
    type: "chunk";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "chunk";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>;
/**
 * Union of all node types.
 */
type AnyNode = ConceptNode | EpisodeNode | DocumentNode | SectionNode | RawNode | NoteNode | ChunkNode;
/**
 * Schema that validates any node type.
 */
declare const AnyNodeSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    id: z.ZodString;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"concept">;
    subtype: z.ZodUnion<[z.ZodEnum<["fact", "definition", "relationship", "preference", "belief", "procedure", "entity", "event", "insight"]>, z.ZodString]>;
}, "strip", z.ZodTypeAny, {
    type: "concept";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: string;
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "concept";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: string;
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"episode">;
    subtype: z.ZodUnion<[z.ZodEnum<["lecture", "meeting", "conversation", "note_session", "document_read", "thought", "external_event"]>, z.ZodString]>;
    episode_specific: z.ZodObject<{
        duration_minutes: z.ZodOptional<z.ZodNumber>;
        concept_links: z.ZodArray<z.ZodString, "many">;
        archive_link: z.ZodOptional<z.ZodString>;
        participants: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        location: z.ZodOptional<z.ZodString>;
        temporal_confidence: z.ZodObject<{
            source: z.ZodNumber;
            granularity: z.ZodNumber;
            interpretation: z.ZodNumber;
            combined: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        }, {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        }>;
    }, "strip", z.ZodTypeAny, {
        concept_links: string[];
        temporal_confidence: {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        };
        duration_minutes?: number | undefined;
        archive_link?: string | undefined;
        participants?: string[] | undefined;
        location?: string | undefined;
    }, {
        concept_links: string[];
        temporal_confidence: {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        };
        duration_minutes?: number | undefined;
        archive_link?: string | undefined;
        participants?: string[] | undefined;
        location?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "episode";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: string;
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    episode_specific: {
        concept_links: string[];
        temporal_confidence: {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        };
        duration_minutes?: number | undefined;
        archive_link?: string | undefined;
        participants?: string[] | undefined;
        location?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "episode";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: string;
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    episode_specific: {
        concept_links: string[];
        temporal_confidence: {
            source: number;
            granularity: number;
            interpretation: number;
            combined: number;
        };
        duration_minutes?: number | undefined;
        archive_link?: string | undefined;
        participants?: string[] | undefined;
        location?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    subtype: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"document">;
    document_specific: z.ZodObject<{
        format: z.ZodString;
        page_count: z.ZodOptional<z.ZodNumber>;
        word_count: z.ZodNumber;
        sections: z.ZodArray<z.ZodString, "many">;
        extraction_status: z.ZodEnum<["minimal", "structural", "partial", "complete"]>;
    }, "strip", z.ZodTypeAny, {
        format: string;
        word_count: number;
        sections: string[];
        extraction_status: "minimal" | "structural" | "partial" | "complete";
        page_count?: number | undefined;
    }, {
        format: string;
        word_count: number;
        sections: string[];
        extraction_status: "minimal" | "structural" | "partial" | "complete";
        page_count?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "document";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    document_specific: {
        format: string;
        word_count: number;
        sections: string[];
        extraction_status: "minimal" | "structural" | "partial" | "complete";
        page_count?: number | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "document";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    document_specific: {
        format: string;
        word_count: number;
        sections: string[];
        extraction_status: "minimal" | "structural" | "partial" | "complete";
        page_count?: number | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    subtype: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"section">;
    section_specific: z.ZodObject<{
        document_id: z.ZodString;
        heading: z.ZodString;
        position: z.ZodNumber;
        extracted: z.ZodBoolean;
        concepts: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        heading: string;
        position: number;
        document_id: string;
        extracted: boolean;
        concepts: string[];
    }, {
        heading: string;
        position: number;
        document_id: string;
        extracted: boolean;
        concepts: string[];
    }>;
}, "strip", z.ZodTypeAny, {
    type: "section";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    section_specific: {
        heading: string;
        position: number;
        document_id: string;
        extracted: boolean;
        concepts: string[];
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "section";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    section_specific: {
        heading: string;
        position: number;
        document_id: string;
        extracted: boolean;
        concepts: string[];
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"raw">;
    subtype: z.ZodEnum<["transcript", "document", "note", "image", "audio_recording"]>;
    raw_specific: z.ZodObject<{
        content_type: z.ZodEnum<["text", "transcript", "document", "image", "audio"]>;
        original_format: z.ZodOptional<z.ZodString>;
        file_size_bytes: z.ZodOptional<z.ZodNumber>;
        word_count: z.ZodOptional<z.ZodNumber>;
        episode_link: z.ZodOptional<z.ZodString>;
        extraction_status: z.ZodEnum<["pending", "processing", "complete", "failed"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_status: "complete" | "pending" | "processing" | "failed";
        content_type: "image" | "document" | "transcript" | "text" | "audio";
        word_count?: number | undefined;
        original_format?: string | undefined;
        file_size_bytes?: number | undefined;
        episode_link?: string | undefined;
    }, {
        extraction_status: "complete" | "pending" | "processing" | "failed";
        content_type: "image" | "document" | "transcript" | "text" | "audio";
        word_count?: number | undefined;
        original_format?: string | undefined;
        file_size_bytes?: number | undefined;
        episode_link?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "raw";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: "image" | "document" | "transcript" | "note" | "audio_recording";
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    raw_specific: {
        extraction_status: "complete" | "pending" | "processing" | "failed";
        content_type: "image" | "document" | "transcript" | "text" | "audio";
        word_count?: number | undefined;
        original_format?: string | undefined;
        file_size_bytes?: number | undefined;
        episode_link?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "raw";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    subtype: "image" | "document" | "transcript" | "note" | "audio_recording";
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    raw_specific: {
        extraction_status: "complete" | "pending" | "processing" | "failed";
        content_type: "image" | "document" | "transcript" | "text" | "audio";
        word_count?: number | undefined;
        original_format?: string | undefined;
        file_size_bytes?: number | undefined;
        episode_link?: string | undefined;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    subtype: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"note">;
}, "strip", z.ZodTypeAny, {
    type: "note";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "note";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    subtype: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodType<Block, z.ZodTypeDef, Block>, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            confidence: z.ZodNumber;
            source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }, {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        }>>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            resolved: z.ZodString;
            type: z.ZodEnum<["historical", "relative", "approximate"]>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }, {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }>, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodEnum<["extraction", "manual", "inference", "import"]>;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodEnum<["summary", "section", "full"]>;
        lifecycle: z.ZodEnum<["working", "active", "superseded", "dormant", "archived"]>;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }, {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    }>;
    versioning: z.ZodObject<{
        version: z.ZodNumber;
        lastModified: z.ZodString;
        lastModifier: z.ZodEnum<["user", "ai", "system", "sync"]>;
        checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }, {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    }>;
} & {
    type: z.ZodLiteral<"chunk">;
}, "strip", z.ZodTypeAny, {
    type: "chunk";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    type: "chunk";
    id: string;
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: Block[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: {
            timestamp: string;
            confidence: number;
            source: "explicit" | "inferred" | "user_stated";
        } | undefined;
        content_times?: {
            type: "historical" | "relative" | "approximate";
            confidence: number;
            text: string;
            resolved: string;
        }[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: "import" | "extraction" | "manual" | "inference";
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: "section" | "full" | "summary";
        lifecycle: "working" | "active" | "superseded" | "dormant" | "archived";
    };
    versioning: {
        version: number;
        lastModified: string;
        lastModifier: "user" | "ai" | "system" | "sync";
        checksum?: string | undefined;
    };
    subtype?: string | undefined;
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>]>;
interface CreateNodeOptions {
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
declare function createNode(type: NodeType, content: NodeContent, options?: CreateNodeOptions): NousNode;
/**
 * Creates a concept node.
 */
declare function createConceptNode(title: string, body: string, subtype: ConceptSubtype, options?: CreateNodeOptions): ConceptNode;
/**
 * Creates a note node.
 */
declare function createNoteNode(title: string, body: string, options?: CreateNodeOptions): NoteNode;
/**
 * Updates a node's access tracking (for SSA/decay).
 */
declare function recordAccess(node: NousNode): NousNode;
/**
 * Updates a node's lifecycle state.
 */
declare function updateLifecycle(node: NousNode, lifecycle: LifecycleState): NousNode;

export { type AnyNode, AnyNodeSchema, Block, type ChunkNode, ChunkNodeSchema, type ConceptNode, ConceptNodeSchema, ConceptSubtype, type CreateNodeOptions, type DocumentMetadata, DocumentMetadataSchema, type DocumentNode, DocumentNodeSchema, type EmbeddingField, EmbeddingFieldSchema, type EpisodeMetadata, EpisodeMetadataSchema, type EpisodeNode, EpisodeNodeSchema, EpisodeSubtype, ExtractionDepth, LifecycleState, Modifier, type NeuralProperties, NeuralPropertiesSchema, type NodeContent, NodeContentSchema, type NodeState, NodeStateSchema, NodeType, type NodeVersion, NodeVersionSchema, type NoteNode, NoteNodeSchema, type NousNode, NousNodeSchema, type Provenance, ProvenanceSchema, type RawMetadata, RawMetadataSchema, type RawNode, RawNodeSchema, RawSubtype, type SectionMetadata, SectionMetadataSchema, type SectionNode, SectionNodeSchema, SourceType, TemporalModel, createConceptNode, createDefaultNeuralProperties, createInitialVersion, createNode, createNoteNode, generateNodeId, recordAccess, updateLifecycle };
