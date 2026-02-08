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

import { z } from 'zod';
import type { StorageLayer } from '../storage';

// ============================================================
// QUERY RESULT
// ============================================================

/**
 * Result of a query execution.
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Rows returned by the query */
  rows: T[];
  /** Number of rows affected (for mutations) */
  rowsAffected: number;
  /** Last inserted row ID (for inserts) */
  lastInsertRowid?: bigint;
}

export const QueryResultSchema = z.object({
  rows: z.array(z.record(z.unknown())),
  rowsAffected: z.number().int().min(0),
  lastInsertRowid: z.bigint().optional(),
});

// ============================================================
// BATCH OPERATIONS
// ============================================================

/**
 * Statement for batch execution.
 */
export interface BatchStatement {
  /** SQL query */
  sql: string;
  /** Query parameters */
  args?: unknown[];
}

/**
 * Result of a batch operation.
 */
export interface BatchResult {
  /** Individual results for each statement */
  results: QueryResult[];
  /** Total rows affected across all statements */
  totalRowsAffected: number;
}

// ============================================================
// TRANSACTION
// ============================================================

/**
 * Transaction handle for atomic operations.
 */
export interface Transaction {
  /** Execute query within transaction */
  execute<T = Record<string, unknown>>(
    sql: string,
    args?: unknown[]
  ): Promise<QueryResult<T>>;

  /** Execute batch within transaction */
  batch(statements: BatchStatement[]): Promise<BatchResult>;

  /** Commit the transaction */
  commit(): Promise<void>;

  /** Rollback the transaction */
  rollback(): Promise<void>;

  /** Check if transaction is still active */
  isActive(): boolean;
}

// ============================================================
// CONNECTION INFO
// ============================================================

/**
 * Database connection state information.
 */
export interface ConnectionInfo {
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

// ============================================================
// VECTOR SEARCH
// ============================================================

/**
 * Options for vector similarity search.
 */
export interface VectorSearchOptions {
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

export const VectorSearchOptionsSchema = z.object({
  embedding: z.instanceof(Float32Array),
  limit: z.number().int().positive().max(1000),
  minScore: z.number().min(0).max(1).optional(),
  layer: z.enum(['semantic', 'episode', 'archive']).optional(),
  filters: z.record(z.unknown()).optional(),
  includeDistance: z.boolean().optional(),
});

/**
 * Result of a vector similarity search.
 */
export interface VectorSearchResult {
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

// ============================================================
// SYNC RESULT
// ============================================================

/**
 * Result of a sync operation.
 */
export interface SyncResult {
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

// ============================================================
// HEALTH CHECK
// ============================================================

/**
 * Result of a health check.
 */
export interface HealthCheckResult {
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

// ============================================================
// DATABASE ADAPTER INTERFACE
// ============================================================

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
export interface DatabaseAdapter {
  // ==================== CONNECTION ====================

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

  // ==================== QUERY EXECUTION ====================

  /**
   * Executes a single SQL query.
   *
   * @param sql - SQL query string
   * @param args - Query parameters
   * @returns Query result
   */
  execute<T = Record<string, unknown>>(
    sql: string,
    args?: unknown[]
  ): Promise<QueryResult<T>>;

  /**
   * Executes multiple queries in a batch.
   *
   * @param statements - Array of SQL statements
   * @returns Batch result
   */
  batch(statements: BatchStatement[]): Promise<BatchResult>;

  // ==================== TRANSACTIONS ====================

  /**
   * Begins a new transaction.
   *
   * @returns Transaction handle
   */
  beginTransaction(): Promise<Transaction>;

  // ==================== VECTOR SEARCH ====================

  /**
   * Performs vector similarity search.
   *
   * @param options - Search options
   * @returns Array of search results ordered by similarity
   */
  vectorSearch(options: VectorSearchOptions): Promise<VectorSearchResult[]>;

  // ==================== SYNC ====================

  /**
   * Syncs with remote database (for replica mode).
   *
   * @returns Sync result
   */
  sync(): Promise<SyncResult>;

  // ==================== SCHEMA ====================

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

  // ==================== HEALTH ====================

  /**
   * Performs a health check.
   */
  healthCheck(): Promise<HealthCheckResult>;
}

// ============================================================
// HELPER TYPES
// ============================================================

/**
 * Type for row transformer functions.
 */
export type RowTransformer<T> = (row: Record<string, unknown>) => T;

/**
 * Creates a type-safe row transformer.
 */
export function createRowTransformer<T>(
  transform: (row: Record<string, unknown>) => T
): RowTransformer<T> {
  return transform;
}

// ============================================================
// ERROR TYPES
// ============================================================

/**
 * Database error codes.
 */
export const DB_ERROR_CODES = [
  'CONNECTION_FAILED',
  'QUERY_FAILED',
  'TRANSACTION_FAILED',
  'SYNC_FAILED',
  'MIGRATION_FAILED',
  'TIMEOUT',
  'CONFLICT',
] as const;

export type DbErrorCode = (typeof DB_ERROR_CODES)[number];

/**
 * Database-specific error.
 */
export class DatabaseError extends Error {
  constructor(
    public code: DbErrorCode,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validates vector search options.
 */
export function validateVectorSearchOptions(
  options: unknown
): options is VectorSearchOptions {
  return VectorSearchOptionsSchema.safeParse(options).success;
}
