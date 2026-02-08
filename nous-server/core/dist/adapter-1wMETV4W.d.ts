import { z } from 'zod';
import { StorageLayer } from './storage/index.js';

/**
 * @module @nous/core/db/adapter
 * @description Database adapter interface for Turso/libSQL
 * @version 1.0.0
 * @spec Brainstorms/Specs/storm-017
 * @storm Brainstorms/Infrastructure/storm-017-infrastructure-architecture
 *
 * Defines the abstract database adapter interface that can be implemented
 * for different database backends (Turso cloud, local libSQL, etc.)
 */

/**
 * Result of a query execution.
 */
interface QueryResult<T = Record<string, unknown>> {
    /** Rows returned by the query */
    rows: T[];
    /** Number of rows affected (for mutations) */
    rowsAffected: number;
    /** Last inserted row ID (for inserts) */
    lastInsertRowid?: bigint;
}
declare const QueryResultSchema: z.ZodObject<{
    rows: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">;
    rowsAffected: z.ZodNumber;
    lastInsertRowid: z.ZodOptional<z.ZodBigInt>;
}, "strip", z.ZodTypeAny, {
    rows: Record<string, unknown>[];
    rowsAffected: number;
    lastInsertRowid?: bigint | undefined;
}, {
    rows: Record<string, unknown>[];
    rowsAffected: number;
    lastInsertRowid?: bigint | undefined;
}>;
/**
 * Statement for batch execution.
 */
interface BatchStatement {
    /** SQL query */
    sql: string;
    /** Query parameters */
    args?: unknown[];
}
/**
 * Result of a batch operation.
 */
interface BatchResult {
    /** Individual results for each statement */
    results: QueryResult[];
    /** Total rows affected across all statements */
    totalRowsAffected: number;
}
/**
 * Transaction handle for atomic operations.
 */
interface Transaction {
    /** Execute query within transaction */
    execute<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<QueryResult<T>>;
    /** Execute batch within transaction */
    batch(statements: BatchStatement[]): Promise<BatchResult>;
    /** Commit the transaction */
    commit(): Promise<void>;
    /** Rollback the transaction */
    rollback(): Promise<void>;
    /** Check if transaction is still active */
    isActive(): boolean;
}
/**
 * Database connection state information.
 */
interface ConnectionInfo {
    /** Whether connected to database */
    connected: boolean;
    /** Database URL */
    url: string;
    /** Connection mode */
    mode: 'local' | 'cloud' | 'replica';
    /** Time of last successful connection */
    connectedAt?: string;
    /** Current latency to database (ms) */
    latencyMs?: number;
}
/**
 * Options for vector similarity search.
 */
interface VectorSearchOptions {
    /** Query embedding vector */
    embedding: Float32Array;
    /** Maximum number of results */
    limit: number;
    /** Minimum similarity score (0-1) */
    minScore?: number;
    /** Storage layer to search */
    layer?: StorageLayer;
    /** Additional filters */
    filters?: Record<string, unknown>;
    /** Include distance in results */
    includeDistance?: boolean;
}
declare const VectorSearchOptionsSchema: z.ZodObject<{
    embedding: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
    limit: z.ZodNumber;
    minScore: z.ZodOptional<z.ZodNumber>;
    layer: z.ZodOptional<z.ZodEnum<["semantic", "episode", "archive"]>>;
    filters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    includeDistance: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    embedding: Float32Array<ArrayBuffer>;
    limit: number;
    layer?: "episode" | "semantic" | "archive" | undefined;
    minScore?: number | undefined;
    filters?: Record<string, unknown> | undefined;
    includeDistance?: boolean | undefined;
}, {
    embedding: Float32Array<ArrayBuffer>;
    limit: number;
    layer?: "episode" | "semantic" | "archive" | undefined;
    minScore?: number | undefined;
    filters?: Record<string, unknown> | undefined;
    includeDistance?: boolean | undefined;
}>;
/**
 * Result of a vector similarity search.
 */
interface VectorSearchResult {
    /** Node ID */
    nodeId: string;
    /** Node type */
    type: string;
    /** Content title */
    title?: string;
    /** Content summary */
    summary?: string;
    /** Cosine distance (0 = identical, 2 = opposite) */
    distance: number;
    /** Similarity score (1 - distance/2) */
    score: number;
}
/**
 * Result of a sync operation.
 */
interface SyncResult {
    /** Whether sync succeeded */
    success: boolean;
    /** Number of frames synced */
    framesSynced: number;
    /** Current frame number */
    currentFrame: number;
    /** Duration in milliseconds */
    durationMs: number;
    /** Error message if failed */
    error?: string;
    /** Number of conflicts detected */
    conflictsDetected: number;
    /** Number of conflicts auto-resolved */
    conflictsAutoResolved: number;
}
/**
 * Result of a health check.
 */
interface HealthCheckResult {
    /** Overall health status */
    healthy: boolean;
    /** Database connection status */
    connected: boolean;
    /** Sync status */
    syncStatus: 'synced' | 'pending' | 'error';
    /** Latency in milliseconds */
    latencyMs: number;
    /** Pending changes count */
    pendingChanges: number;
    /** Unresolved conflicts count */
    unresolvedConflicts: number;
    /** Last successful sync */
    lastSyncAt?: string;
    /** Any error messages */
    errors: string[];
}
/**
 * Abstract database adapter interface.
 *
 * Provides a common interface for database operations that can be
 * implemented for different backends (Turso, local SQLite, etc.)
 *
 * @example
 * ```typescript
 * const adapter: DatabaseAdapter = new TursoDatabaseAdapter(config);
 * await adapter.connect();
 * const result = await adapter.execute('SELECT * FROM nodes WHERE id = ?', ['node-123']);
 * await adapter.disconnect();
 * ```
 */
interface DatabaseAdapter {
    /**
     * Connects to the database.
     *
     * @throws Error if connection fails
     */
    connect(): Promise<void>;
    /**
     * Disconnects from the database.
     */
    disconnect(): Promise<void>;
    /**
     * Gets current connection info.
     */
    getConnectionInfo(): ConnectionInfo;
    /**
     * Executes a single SQL query.
     *
     * @param sql - SQL query string
     * @param args - Query parameters
     * @returns Query result
     */
    execute<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<QueryResult<T>>;
    /**
     * Executes multiple queries in a batch.
     *
     * @param statements - Array of SQL statements
     * @returns Batch result
     */
    batch(statements: BatchStatement[]): Promise<BatchResult>;
    /**
     * Begins a new transaction.
     *
     * @returns Transaction handle
     */
    beginTransaction(): Promise<Transaction>;
    /**
     * Performs vector similarity search.
     *
     * @param options - Search options
     * @returns Array of search results ordered by similarity
     */
    vectorSearch(options: VectorSearchOptions): Promise<VectorSearchResult[]>;
    /**
     * Syncs with remote database (for replica mode).
     *
     * @returns Sync result
     */
    sync(): Promise<SyncResult>;
    /**
     * Gets the current schema version.
     */
    getSchemaVersion(): Promise<number>;
    /**
     * Runs pending migrations.
     *
     * @param targetVersion - Target schema version (default: latest)
     */
    runMigrations(targetVersion?: number): Promise<void>;
    /**
     * Performs a health check.
     */
    healthCheck(): Promise<HealthCheckResult>;
}
/**
 * Type for row transformer functions.
 */
type RowTransformer<T> = (row: Record<string, unknown>) => T;
/**
 * Creates a type-safe row transformer.
 */
declare function createRowTransformer<T>(transform: (row: Record<string, unknown>) => T): RowTransformer<T>;
/**
 * Database error codes.
 */
declare const DB_ERROR_CODES: readonly ["CONNECTION_FAILED", "QUERY_FAILED", "TRANSACTION_FAILED", "SYNC_FAILED", "MIGRATION_FAILED", "TIMEOUT", "CONFLICT"];
type DbErrorCode = (typeof DB_ERROR_CODES)[number];
/**
 * Database-specific error.
 */
declare class DatabaseError extends Error {
    code: DbErrorCode;
    cause?: Error | undefined;
    constructor(code: DbErrorCode, message: string, cause?: Error | undefined);
}
/**
 * Validates vector search options.
 */
declare function validateVectorSearchOptions(options: unknown): options is VectorSearchOptions;

export { type BatchResult as B, type ConnectionInfo as C, DB_ERROR_CODES as D, type HealthCheckResult as H, type QueryResult as Q, type RowTransformer as R, type SyncResult as S, type Transaction as T, type VectorSearchOptions as V, type BatchStatement as a, type DatabaseAdapter as b, DatabaseError as c, type DbErrorCode as d, QueryResultSchema as e, VectorSearchOptionsSchema as f, type VectorSearchResult as g, createRowTransformer as h, validateVectorSearchOptions as v };
