import { z } from 'zod';
import { aA as PrivacyTier } from '../constants-D51NP4v8.js';
import { b as DatabaseAdapter, V as VectorSearchOptions, S as SyncResult, R as RowTransformer, Q as QueryResult, g as VectorSearchResult } from '../adapter-1wMETV4W.js';
export { B as BatchResult, a as BatchStatement, C as ConnectionInfo, D as DB_ERROR_CODES, c as DatabaseError, d as DbErrorCode, H as HealthCheckResult, e as QueryResultSchema, T as Transaction, f as VectorSearchOptionsSchema, h as createRowTransformer, v as validateVectorSearchOptions } from '../adapter-1wMETV4W.js';
import { StorageLayer } from '../storage/index.js';
import '../constants-Blu2FVkv.js';

/**
 * @module @nous/core/db/config
 * @description Database and sync configuration types
 * @version 1.0.0
 * @spec Brainstorms/Specs/storm-017
 * @storm Brainstorms/Infrastructure/storm-017-infrastructure-architecture
 *
 * Implements configuration for Turso/libSQL database with embedded replica pattern.
 */

/**
 * Default database configuration values.
 */
declare const DB_DEFAULTS: {
    /** OpenAI embedding dimensions */
    readonly vectorDimensions: 1536;
    /** DiskANN index parameter */
    readonly maxNeighbors: 50;
    /** Default sync batch size */
    readonly syncBatchSize: 100;
    /** Current schema version */
    readonly schemaVersion: 2;
    /** Default sync interval in milliseconds */
    readonly syncIntervalMs: 60000;
    /** Default connection timeout */
    readonly connectionTimeoutMs: 10000;
    /** Max retry attempts */
    readonly maxRetries: 3;
    /** Base retry delay */
    readonly retryDelayMs: 1000;
};
/**
 * Database operation modes.
 * - local: SQLite file on device only
 * - cloud: Turso cloud database only
 * - replica: Embedded replica (local + cloud sync)
 */
declare const DATABASE_MODES: readonly ["local", "cloud", "replica"];
type DatabaseMode = (typeof DATABASE_MODES)[number];
/**
 * Sync behavior modes.
 * - auto: Automatic sync on schedule and changes
 * - manual: Sync only when explicitly triggered
 * - disabled: No sync (local-only)
 */
declare const SYNC_MODES: readonly ["auto", "manual", "disabled"];
type SyncMode = (typeof SYNC_MODES)[number];
/**
 * Turso database connection configuration.
 */
interface TursoConfig {
    /** Database URL (libsql:// or file://) */
    url: string;
    /** Authentication token for Turso cloud */
    authToken?: string;
    /** Sync URL for embedded replica mode */
    syncUrl?: string;
    /** Sync interval in milliseconds */
    syncIntervalMs?: number;
    /** Enable encryption at rest */
    encryptionKey?: string;
}
declare const TursoConfigSchema: z.ZodObject<{
    url: z.ZodString;
    authToken: z.ZodOptional<z.ZodString>;
    syncUrl: z.ZodOptional<z.ZodString>;
    syncIntervalMs: z.ZodOptional<z.ZodNumber>;
    encryptionKey: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    url: string;
    authToken?: string | undefined;
    syncUrl?: string | undefined;
    syncIntervalMs?: number | undefined;
    encryptionKey?: string | undefined;
}, {
    url: string;
    authToken?: string | undefined;
    syncUrl?: string | undefined;
    syncIntervalMs?: number | undefined;
    encryptionKey?: string | undefined;
}>;
/**
 * Database behavior options.
 */
interface DatabaseOptions {
    /** Database operation mode */
    mode: DatabaseMode;
    /** Enable WAL mode for better concurrency */
    enableWAL: boolean;
    /** Connection timeout in milliseconds */
    connectionTimeoutMs: number;
    /** Max retry attempts for failed operations */
    maxRetries: number;
    /** Base delay between retries (exponential backoff) */
    retryDelayMs: number;
    /** Vector dimensions for embeddings */
    vectorDimensions: number;
    /** Max neighbors for DiskANN index */
    maxNeighbors: number;
}
declare const DatabaseOptionsSchema: z.ZodObject<{
    mode: z.ZodEnum<["local", "cloud", "replica"]>;
    enableWAL: z.ZodBoolean;
    connectionTimeoutMs: z.ZodNumber;
    maxRetries: z.ZodNumber;
    retryDelayMs: z.ZodNumber;
    vectorDimensions: z.ZodNumber;
    maxNeighbors: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    mode: "local" | "cloud" | "replica";
    enableWAL: boolean;
    connectionTimeoutMs: number;
    maxRetries: number;
    retryDelayMs: number;
    vectorDimensions: number;
    maxNeighbors: number;
}, {
    mode: "local" | "cloud" | "replica";
    enableWAL: boolean;
    connectionTimeoutMs: number;
    maxRetries: number;
    retryDelayMs: number;
    vectorDimensions: number;
    maxNeighbors: number;
}>;
/**
 * Creates default database options.
 */
declare function createDefaultDatabaseOptions(): DatabaseOptions;
/**
 * Sync behavior configuration.
 */
interface SyncConfig {
    /** Sync mode */
    mode: SyncMode;
    /** Minimum interval between syncs (ms) */
    minIntervalMs: number;
    /** Batch size for sync operations */
    batchSize: number;
    /** WiFi-only sync */
    wifiOnly: boolean;
    /** Sync only when charging */
    chargingOnly: boolean;
    /** Enable background sync */
    backgroundSync: boolean;
    /** Max retry attempts */
    maxRetries: number;
}
declare const SyncConfigSchema: z.ZodObject<{
    mode: z.ZodEnum<["auto", "manual", "disabled"]>;
    minIntervalMs: z.ZodNumber;
    batchSize: z.ZodNumber;
    wifiOnly: z.ZodBoolean;
    chargingOnly: z.ZodBoolean;
    backgroundSync: z.ZodBoolean;
    maxRetries: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    mode: "manual" | "auto" | "disabled";
    maxRetries: number;
    minIntervalMs: number;
    batchSize: number;
    wifiOnly: boolean;
    chargingOnly: boolean;
    backgroundSync: boolean;
}, {
    mode: "manual" | "auto" | "disabled";
    maxRetries: number;
    minIntervalMs: number;
    batchSize: number;
    wifiOnly: boolean;
    chargingOnly: boolean;
    backgroundSync: boolean;
}>;
/**
 * Creates default sync configuration.
 */
declare function createDefaultSyncConfig(): SyncConfig;
/**
 * Per-tenant configuration for database-per-user architecture.
 */
interface TenantConfig {
    /** Unique tenant identifier */
    tenantId: string;
    /** Privacy tier for this tenant */
    privacyTier: PrivacyTier;
    /** Tenant-specific database URL */
    databaseUrl: string;
    /** Tenant authentication token */
    authToken: string;
    /** Storage quota in bytes */
    storageQuotaBytes: number;
    /** Created timestamp */
    createdAt: string;
}
declare const TenantConfigSchema: z.ZodObject<{
    tenantId: z.ZodString;
    privacyTier: z.ZodEnum<["standard", "private"]>;
    databaseUrl: z.ZodString;
    authToken: z.ZodString;
    storageQuotaBytes: z.ZodNumber;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    createdAt: string;
    authToken: string;
    tenantId: string;
    privacyTier: "standard" | "private";
    databaseUrl: string;
    storageQuotaBytes: number;
}, {
    createdAt: string;
    authToken: string;
    tenantId: string;
    privacyTier: "standard" | "private";
    databaseUrl: string;
    storageQuotaBytes: number;
}>;
/**
 * Complete infrastructure configuration.
 */
interface InfrastructureConfig {
    /** Turso connection settings */
    turso: TursoConfig;
    /** Database behavior options */
    database: DatabaseOptions;
    /** Sync configuration */
    sync: SyncConfig;
}
declare const InfrastructureConfigSchema: z.ZodObject<{
    turso: z.ZodObject<{
        url: z.ZodString;
        authToken: z.ZodOptional<z.ZodString>;
        syncUrl: z.ZodOptional<z.ZodString>;
        syncIntervalMs: z.ZodOptional<z.ZodNumber>;
        encryptionKey: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        authToken?: string | undefined;
        syncUrl?: string | undefined;
        syncIntervalMs?: number | undefined;
        encryptionKey?: string | undefined;
    }, {
        url: string;
        authToken?: string | undefined;
        syncUrl?: string | undefined;
        syncIntervalMs?: number | undefined;
        encryptionKey?: string | undefined;
    }>;
    database: z.ZodObject<{
        mode: z.ZodEnum<["local", "cloud", "replica"]>;
        enableWAL: z.ZodBoolean;
        connectionTimeoutMs: z.ZodNumber;
        maxRetries: z.ZodNumber;
        retryDelayMs: z.ZodNumber;
        vectorDimensions: z.ZodNumber;
        maxNeighbors: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        mode: "local" | "cloud" | "replica";
        enableWAL: boolean;
        connectionTimeoutMs: number;
        maxRetries: number;
        retryDelayMs: number;
        vectorDimensions: number;
        maxNeighbors: number;
    }, {
        mode: "local" | "cloud" | "replica";
        enableWAL: boolean;
        connectionTimeoutMs: number;
        maxRetries: number;
        retryDelayMs: number;
        vectorDimensions: number;
        maxNeighbors: number;
    }>;
    sync: z.ZodObject<{
        mode: z.ZodEnum<["auto", "manual", "disabled"]>;
        minIntervalMs: z.ZodNumber;
        batchSize: z.ZodNumber;
        wifiOnly: z.ZodBoolean;
        chargingOnly: z.ZodBoolean;
        backgroundSync: z.ZodBoolean;
        maxRetries: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        mode: "manual" | "auto" | "disabled";
        maxRetries: number;
        minIntervalMs: number;
        batchSize: number;
        wifiOnly: boolean;
        chargingOnly: boolean;
        backgroundSync: boolean;
    }, {
        mode: "manual" | "auto" | "disabled";
        maxRetries: number;
        minIntervalMs: number;
        batchSize: number;
        wifiOnly: boolean;
        chargingOnly: boolean;
        backgroundSync: boolean;
    }>;
}, "strip", z.ZodTypeAny, {
    sync: {
        mode: "manual" | "auto" | "disabled";
        maxRetries: number;
        minIntervalMs: number;
        batchSize: number;
        wifiOnly: boolean;
        chargingOnly: boolean;
        backgroundSync: boolean;
    };
    turso: {
        url: string;
        authToken?: string | undefined;
        syncUrl?: string | undefined;
        syncIntervalMs?: number | undefined;
        encryptionKey?: string | undefined;
    };
    database: {
        mode: "local" | "cloud" | "replica";
        enableWAL: boolean;
        connectionTimeoutMs: number;
        maxRetries: number;
        retryDelayMs: number;
        vectorDimensions: number;
        maxNeighbors: number;
    };
}, {
    sync: {
        mode: "manual" | "auto" | "disabled";
        maxRetries: number;
        minIntervalMs: number;
        batchSize: number;
        wifiOnly: boolean;
        chargingOnly: boolean;
        backgroundSync: boolean;
    };
    turso: {
        url: string;
        authToken?: string | undefined;
        syncUrl?: string | undefined;
        syncIntervalMs?: number | undefined;
        encryptionKey?: string | undefined;
    };
    database: {
        mode: "local" | "cloud" | "replica";
        enableWAL: boolean;
        connectionTimeoutMs: number;
        maxRetries: number;
        retryDelayMs: number;
        vectorDimensions: number;
        maxNeighbors: number;
    };
}>;
/**
 * Creates default infrastructure configuration.
 *
 * @param tursoConfig - Turso connection settings
 * @returns Complete infrastructure config with defaults
 */
declare function createDefaultInfrastructureConfig(tursoConfig: TursoConfig): InfrastructureConfig;
/**
 * Validates a Turso configuration.
 */
declare function validateTursoConfig(config: unknown): config is TursoConfig;
/**
 * Validates database options.
 */
declare function validateDatabaseOptions(options: unknown): options is DatabaseOptions;
/**
 * Validates sync configuration.
 */
declare function validateSyncConfig(config: unknown): config is SyncConfig;
/**
 * Validates complete infrastructure configuration.
 */
declare function validateInfrastructureConfig(config: unknown): config is InfrastructureConfig;

/**
 * @module @nous/core/db/schema
 * @description SQL schema definitions for Turso/libSQL database
 * @version 1.0.0
 * @spec Brainstorms/Specs/storm-017
 * @storm Brainstorms/Infrastructure/storm-017-infrastructure-architecture
 *
 * Defines all database tables, indexes, and common queries.
 * Uses F32_BLOB for vector storage with DiskANN index.
 */
/**
 * Main nodes table storing all node types with embeddings.
 *
 * Maps to NousNode interface from storm-011.
 * Supports vector search via DiskANN index.
 */
declare const NODES_TABLE: string;
/**
 * Indexes for the nodes table.
 */
declare const NODES_INDEXES: string;
/**
 * Edges table for relationships between nodes.
 *
 * Maps to NousEdge interface from storm-011.
 */
declare const EDGES_TABLE = "\nCREATE TABLE IF NOT EXISTS edges (\n  -- Identity\n  id TEXT PRIMARY KEY NOT NULL,\n  type TEXT NOT NULL,\n\n  -- Relationship\n  source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,\n  target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,\n\n  -- Neural properties\n  neural_weight REAL DEFAULT 1.0,\n  neural_stability REAL DEFAULT 0.5,\n  neural_last_activated TEXT,\n\n  -- Metadata\n  bidirectional INTEGER DEFAULT 0,\n\n  -- Sync\n  version INTEGER DEFAULT 1,\n  last_modified TEXT NOT NULL,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n";
/**
 * Indexes for the edges table.
 */
declare const EDGES_INDEXES = "\n-- Efficient traversal\nCREATE INDEX IF NOT EXISTS idx_edges_source ON edges (source_id);\nCREATE INDEX IF NOT EXISTS idx_edges_target ON edges (target_id);\nCREATE INDEX IF NOT EXISTS idx_edges_type ON edges (type);\n\n-- Bidirectional lookup\nCREATE INDEX IF NOT EXISTS idx_edges_bidirectional ON edges (source_id, target_id);\n\n-- Weight for relevance\nCREATE INDEX IF NOT EXISTS idx_edges_weight ON edges (neural_weight);\n";
/**
 * Episodes table for time-indexed events.
 *
 * Maps to Episode interface from storm-004.
 * Includes TPS (Temporal Parsing System) metadata.
 */
declare const EPISODES_TABLE = "\nCREATE TABLE IF NOT EXISTS episodes (\n  -- Identity\n  id TEXT PRIMARY KEY NOT NULL,\n\n  -- Content\n  content TEXT NOT NULL,\n  summary TEXT,\n\n  -- Temporal bounds\n  start_time TEXT NOT NULL,\n  end_time TEXT,\n\n  -- TPS Confidence Factors\n  tps_temporal_confidence REAL DEFAULT 0.5,\n  tps_parsing_method TEXT,\n  tps_source_reliability REAL DEFAULT 0.5,\n\n  -- References to nodes created from this episode\n  node_refs TEXT,  -- JSON array of node IDs\n\n  -- Source context\n  source_type TEXT,\n  source_id TEXT,\n\n  -- Sync\n  version INTEGER DEFAULT 1,\n  last_modified TEXT NOT NULL,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n";
/**
 * Indexes for the episodes table.
 */
declare const EPISODES_INDEXES = "\n-- Temporal range queries\nCREATE INDEX IF NOT EXISTS idx_episodes_start_time ON episodes (start_time);\nCREATE INDEX IF NOT EXISTS idx_episodes_end_time ON episodes (end_time);\n\n-- Source lookup\nCREATE INDEX IF NOT EXISTS idx_episodes_source ON episodes (source_type, source_id);\n";
/**
 * Sync metadata table for tracking sync state.
 */
declare const SYNC_METADATA_TABLE = "\nCREATE TABLE IF NOT EXISTS sync_metadata (\n  key TEXT PRIMARY KEY NOT NULL,\n  value TEXT NOT NULL,\n  updated_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n";
/**
 * User settings table for preferences.
 */
declare const USER_SETTINGS_TABLE = "\nCREATE TABLE IF NOT EXISTS user_settings (\n  key TEXT PRIMARY KEY NOT NULL,\n  value TEXT NOT NULL,\n  updated_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n";
/**
 * Edit history table for undo capability.
 *
 * Maps to EditRecord interface from storm-011.
 */
declare const EDIT_HISTORY_TABLE = "\nCREATE TABLE IF NOT EXISTS edit_history (\n  id TEXT PRIMARY KEY NOT NULL,\n  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,\n  operation TEXT NOT NULL,  -- 'create' | 'update' | 'delete'\n  before_state TEXT,  -- JSON snapshot before edit\n  after_state TEXT,   -- JSON snapshot after edit\n  editor_id TEXT,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n";
/**
 * Indexes for edit history.
 */
declare const EDIT_HISTORY_INDEXES = "\nCREATE INDEX IF NOT EXISTS idx_edit_history_node ON edit_history (node_id);\nCREATE INDEX IF NOT EXISTS idx_edit_history_created ON edit_history (created_at);\n";
/**
 * Local cache table for LRU cache on limited storage.
 */
declare const LOCAL_CACHE_TABLE = "\nCREATE TABLE IF NOT EXISTS local_cache (\n  node_id TEXT PRIMARY KEY NOT NULL,\n  cached_at TEXT NOT NULL,\n  last_accessed TEXT NOT NULL,\n  access_count INTEGER DEFAULT 1,\n  size_bytes INTEGER NOT NULL\n);\n";
/**
 * Indexes for local cache.
 */
declare const LOCAL_CACHE_INDEXES = "\nCREATE INDEX IF NOT EXISTS idx_local_cache_last_accessed ON local_cache (last_accessed);\nCREATE INDEX IF NOT EXISTS idx_local_cache_access_count ON local_cache (access_count);\n";
/**
 * Schema version table for migration tracking.
 */
declare const SCHEMA_VERSION_TABLE = "\nCREATE TABLE IF NOT EXISTS schema_version (\n  version INTEGER PRIMARY KEY NOT NULL,\n  applied_at TEXT NOT NULL DEFAULT (datetime('now')),\n  description TEXT\n);\n";
/**
 * Complete schema creation statements in order.
 *
 * Execute in order to create full database schema.
 */
declare const FULL_SCHEMA: string[];
/**
 * Common query templates.
 */
declare const QUERIES: {
    /**
     * Vector similarity search query.
     * Uses cosine distance via DiskANN index.
     */
    readonly vectorSearch: "\n    SELECT\n      id,\n      type,\n      content_title,\n      content_summary,\n      vector_distance_cos(embedding, ?) as distance\n    FROM nodes\n    WHERE embedding IS NOT NULL\n      AND layer = ?\n    ORDER BY distance ASC\n    LIMIT ?\n  ";
    /**
     * Get node by ID.
     */
    readonly getNodeById: "\n    SELECT * FROM nodes WHERE id = ?\n  ";
    /**
     * Get edges for a node (both directions).
     */
    readonly getEdgesForNode: "\n    SELECT * FROM edges\n    WHERE source_id = ? OR target_id = ?\n  ";
    /**
     * Get outgoing edges from a node.
     */
    readonly getOutgoingEdges: "\n    SELECT * FROM edges WHERE source_id = ?\n  ";
    /**
     * Get incoming edges to a node.
     */
    readonly getIncomingEdges: "\n    SELECT * FROM edges WHERE target_id = ?\n  ";
    /**
     * Get episodes in time range.
     */
    readonly getEpisodesInRange: "\n    SELECT * FROM episodes\n    WHERE start_time >= ? AND (end_time IS NULL OR end_time <= ?)\n    ORDER BY start_time ASC\n  ";
    /**
     * Get nodes with sync conflicts.
     */
    readonly getSyncConflicts: "\n    SELECT * FROM nodes WHERE sync_status = 'conflict'\n  ";
    /**
     * Get unsynced changes.
     */
    readonly getUnsyncedChanges: "\n    SELECT * FROM nodes WHERE sync_status = 'pending'\n  ";
    /**
     * Insert new node.
     */
    readonly insertNode: "\n    INSERT INTO nodes (\n      id, type, subtype,\n      content_title, content_summary, content_body, content_blocks,\n      embedding,\n      neural_stability, neural_retrievability, neural_access_count,\n      state_lifecycle, state_extraction_depth,\n      provenance_source, provenance_created_at, provenance_confidence,\n      layer, version, last_modified, last_modifier\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n  ";
    /**
     * Insert new episode.
     */
    readonly insertEpisode: "\n    INSERT INTO episodes (\n      id, content, summary,\n      start_time, end_time,\n      tps_temporal_confidence, tps_parsing_method, tps_source_reliability,\n      node_refs, source_type, source_id,\n      version, last_modified\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n  ";
    /**
     * Update node sync status.
     */
    readonly updateSyncStatus: "\n    UPDATE nodes SET sync_status = ?, last_modified = ? WHERE id = ?\n  ";
    /**
     * Get schema version.
     */
    readonly getSchemaVersion: "\n    SELECT MAX(version) as version FROM schema_version\n  ";
    /**
     * Insert schema version.
     */
    readonly insertSchemaVersion: "\n    INSERT INTO schema_version (version, description) VALUES (?, ?)\n  ";
};
/**
 * Gets all CREATE TABLE statements.
 */
declare function getTableStatements(): string[];
/**
 * Gets all CREATE INDEX statements.
 */
declare function getIndexStatements(): string[];
/**
 * Gets drop statements for all tables (for testing/reset).
 */
declare function getDropStatements(): string[];

/**
 * @module @nous/core/db/turso-adapter
 * @description Turso/libSQL specific adapter implementation
 * @version 1.0.0
 * @spec Brainstorms/Specs/storm-017
 * @storm Brainstorms/Infrastructure/storm-017-infrastructure-architecture
 *
 * Provides Turso-specific implementation of DatabaseAdapter interface.
 * Uses @libsql/client for database operations.
 *
 * Note: This file defines interfaces and helpers. The actual implementation
 * using @libsql/client should be done in the apps that use this package.
 */

/**
 * Turso-specific database adapter.
 *
 * Extends DatabaseAdapter with Turso-specific configuration.
 */
interface TursoDatabaseAdapter extends DatabaseAdapter {
    /** Turso connection configuration */
    readonly config: TursoConfig;
    /** Database behavior options */
    readonly options: DatabaseOptions;
    /** Sync configuration */
    readonly syncConfig: SyncConfig;
}
/**
 * Node row from database.
 */
interface NodeRow {
    id: string;
    type: string;
    subtype: string | null;
    content_title: string | null;
    content_summary: string | null;
    content_body: string | null;
    content_blocks: string | null;
    embedding: ArrayBuffer | null;
    neural_stability: number;
    neural_retrievability: number;
    neural_access_count: number;
    neural_last_accessed: string | null;
    state_lifecycle: string;
    state_extraction_depth: string;
    provenance_source: string | null;
    provenance_created_at: string;
    provenance_confidence: number;
    layer: string;
    version: number;
    last_modified: string;
    last_modifier: string | null;
    sync_status: string;
    encrypted_payload: string | null;
    encryption_tier: string;
    created_at: string;
}
/**
 * Edge row from database.
 */
interface EdgeRow {
    id: string;
    type: string;
    source_id: string;
    target_id: string;
    neural_weight: number;
    neural_stability: number;
    neural_last_activated: string | null;
    bidirectional: number;
    version: number;
    last_modified: string;
    created_at: string;
}
/**
 * Episode row from database.
 */
interface EpisodeRow {
    id: string;
    content: string;
    summary: string | null;
    start_time: string;
    end_time: string | null;
    tps_temporal_confidence: number;
    tps_parsing_method: string | null;
    tps_source_reliability: number;
    node_refs: string | null;
    source_type: string | null;
    source_id: string | null;
    version: number;
    last_modified: string;
    created_at: string;
}
/**
 * Transforms a Turso result to QueryResult.
 */
declare function transformTursoResult<T>(tursoResult: {
    rows: Array<Record<string, unknown>>;
    rowsAffected: number;
    lastInsertRowid?: bigint;
}, transformer?: RowTransformer<T>): QueryResult<T>;
/**
 * Builds a vector search SQL query.
 *
 * @param options - Vector search options
 * @returns Tuple of [sql, params]
 */
declare function buildVectorSearchQuery(options: VectorSearchOptions): [string, unknown[]];
/**
 * Transforms raw vector search row to VectorSearchResult.
 */
declare function transformVectorSearchResult(row: Record<string, unknown>): VectorSearchResult;
/**
 * Sync statistics.
 */
interface SyncStats {
    framesTotal: number;
    framesSynced: number;
    bytesTransferred: number;
    durationMs: number;
}
/**
 * Calculates sync statistics.
 */
declare function calculateSyncStats(startTime: number, framesTotal: number, framesSynced: number, bytesTransferred: number): SyncStats;
/**
 * Creates a successful sync result.
 */
declare function createSuccessSyncResult(stats: SyncStats): SyncResult;
/**
 * Creates a failed sync result.
 */
declare function createFailedSyncResult(error: string, durationMs: number): SyncResult;
/**
 * Parses a database URL to determine the mode.
 */
declare function parseDatabaseUrl(url: string): 'local' | 'cloud' | 'replica';
/**
 * Validates a Turso URL format.
 */
declare function isValidTursoUrl(url: string): boolean;
/**
 * Retry configuration.
 */
interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}
/**
 * Default retry configuration.
 */
declare const DEFAULT_RETRY_CONFIG: RetryConfig;
/**
 * Calculates exponential backoff delay.
 */
declare function calculateBackoffDelay(attempt: number, config?: RetryConfig): number;
/**
 * Retries an async operation with exponential backoff.
 */
declare function retryWithBackoff<T>(operation: () => Promise<T>, config?: RetryConfig): Promise<T>;
/**
 * Converts an embedding array to Float32Array for database storage.
 */
declare function toFloat32Array(embedding: number[]): Float32Array;
/**
 * Converts a Float32Array to regular array.
 */
declare function fromFloat32Array(buffer: Float32Array): number[];
/**
 * Validates embedding dimensions.
 */
declare function validateEmbeddingDimensions(embedding: Float32Array | number[], expectedDimensions: number): boolean;
/**
 * Gets the appropriate layer for a node type.
 *
 * This is a simplified version - the full implementation uses
 * getStorageLayer from ../storage.
 */
declare function getLayerForQuery(layer?: StorageLayer): StorageLayer;

export { DATABASE_MODES, DB_DEFAULTS, DEFAULT_RETRY_CONFIG, DatabaseAdapter, type DatabaseMode, type DatabaseOptions, DatabaseOptionsSchema, EDGES_INDEXES, EDGES_TABLE, EDIT_HISTORY_INDEXES, EDIT_HISTORY_TABLE, EPISODES_INDEXES, EPISODES_TABLE, type EdgeRow, type EpisodeRow, FULL_SCHEMA, type InfrastructureConfig, InfrastructureConfigSchema, LOCAL_CACHE_INDEXES, LOCAL_CACHE_TABLE, NODES_INDEXES, NODES_TABLE, type NodeRow, QUERIES, QueryResult, type RetryConfig, RowTransformer, SCHEMA_VERSION_TABLE, SYNC_METADATA_TABLE, SYNC_MODES, type SyncConfig, SyncConfigSchema, type SyncMode, SyncResult, type SyncStats, type TenantConfig, TenantConfigSchema, type TursoConfig, TursoConfigSchema, type TursoDatabaseAdapter, USER_SETTINGS_TABLE, VectorSearchOptions, VectorSearchResult, buildVectorSearchQuery, calculateBackoffDelay, calculateSyncStats, createDefaultDatabaseOptions, createDefaultInfrastructureConfig, createDefaultSyncConfig, createFailedSyncResult, createSuccessSyncResult, fromFloat32Array, getDropStatements, getIndexStatements, getLayerForQuery, getTableStatements, isValidTursoUrl, parseDatabaseUrl, retryWithBackoff, toFloat32Array, transformTursoResult, transformVectorSearchResult, validateDatabaseOptions, validateEmbeddingDimensions, validateInfrastructureConfig, validateSyncConfig, validateTursoConfig };
