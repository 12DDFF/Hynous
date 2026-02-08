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

import type {
  DatabaseAdapter,
  QueryResult,
  VectorSearchOptions,
  VectorSearchResult,
  SyncResult,
  RowTransformer,
} from './adapter';
import type { TursoConfig, DatabaseOptions, SyncConfig } from './config';
import type { StorageLayer } from '../storage';

// ============================================================
// TURSO ADAPTER INTERFACE
// ============================================================

/**
 * Turso-specific database adapter.
 *
 * Extends DatabaseAdapter with Turso-specific configuration.
 */
export interface TursoDatabaseAdapter extends DatabaseAdapter {
  /** Turso connection configuration */
  readonly config: TursoConfig;
  /** Database behavior options */
  readonly options: DatabaseOptions;
  /** Sync configuration */
  readonly syncConfig: SyncConfig;
}

// ============================================================
// ROW TRANSFORMER HELPERS
// ============================================================

/**
 * Node row from database.
 */
export interface NodeRow {
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
export interface EdgeRow {
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
export interface EpisodeRow {
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

// Note: createRowTransformer is exported from adapter.ts

/**
 * Transforms a Turso result to QueryResult.
 */
export function transformTursoResult<T>(
  tursoResult: {
    rows: Array<Record<string, unknown>>;
    rowsAffected: number;
    lastInsertRowid?: bigint;
  },
  transformer?: RowTransformer<T>
): QueryResult<T> {
  return {
    rows: transformer
      ? tursoResult.rows.map(transformer)
      : (tursoResult.rows as T[]),
    rowsAffected: tursoResult.rowsAffected,
    lastInsertRowid: tursoResult.lastInsertRowid,
  };
}

// ============================================================
// VECTOR SEARCH HELPERS
// ============================================================

/**
 * Builds a vector search SQL query.
 *
 * @param options - Vector search options
 * @returns Tuple of [sql, params]
 */
export function buildVectorSearchQuery(
  options: VectorSearchOptions
): [string, unknown[]] {
  const params: unknown[] = [options.embedding];
  const conditions: string[] = ['embedding IS NOT NULL'];

  if (options.layer) {
    conditions.push('layer = ?');
    params.push(options.layer);
  }

  if (options.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      if (value !== undefined) {
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
    WHERE ${conditions.join(' AND ')}
    ORDER BY distance ASC
    LIMIT ?
  `;

  return [sql.trim(), params];
}

/**
 * Transforms raw vector search row to VectorSearchResult.
 */
export function transformVectorSearchResult(
  row: Record<string, unknown>
): VectorSearchResult {
  const distance = row['distance'] as number;
  return {
    nodeId: row['id'] as string,
    type: row['type'] as string,
    title: row['content_title'] as string | undefined,
    summary: row['content_summary'] as string | undefined,
    distance,
    score: 1 - distance / 2, // Convert distance to similarity score
  };
}

// ============================================================
// SYNC HELPERS
// ============================================================

/**
 * Sync statistics.
 */
export interface SyncStats {
  framesTotal: number;
  framesSynced: number;
  bytesTransferred: number;
  durationMs: number;
}

/**
 * Calculates sync statistics.
 */
export function calculateSyncStats(
  startTime: number,
  framesTotal: number,
  framesSynced: number,
  bytesTransferred: number
): SyncStats {
  return {
    framesTotal,
    framesSynced,
    bytesTransferred,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Creates a successful sync result.
 */
export function createSuccessSyncResult(stats: SyncStats): SyncResult {
  return {
    success: true,
    framesSynced: stats.framesSynced,
    currentFrame: stats.framesTotal,
    durationMs: stats.durationMs,
    conflictsDetected: 0,
    conflictsAutoResolved: 0,
  };
}

/**
 * Creates a failed sync result.
 */
export function createFailedSyncResult(
  error: string,
  durationMs: number
): SyncResult {
  return {
    success: false,
    framesSynced: 0,
    currentFrame: 0,
    durationMs,
    error,
    conflictsDetected: 0,
    conflictsAutoResolved: 0,
  };
}

// ============================================================
// CONNECTION HELPERS
// ============================================================

/**
 * Parses a database URL to determine the mode.
 */
export function parseDatabaseUrl(
  url: string
): 'local' | 'cloud' | 'replica' {
  if (url.startsWith('file:')) {
    return 'local';
  }
  if (url.startsWith('libsql://') || url.startsWith('https://')) {
    return 'cloud';
  }
  // Default to replica for other cases
  return 'replica';
}

/**
 * Validates a Turso URL format.
 */
export function isValidTursoUrl(url: string): boolean {
  try {
    if (url.startsWith('file:')) {
      return true;
    }
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// RETRY HELPERS
// ============================================================

/**
 * Retry configuration.
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Calculates exponential backoff delay.
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const delay = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Retries an async operation with exponential backoff.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | undefined;

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

// ============================================================
// EMBEDDING HELPERS
// ============================================================

/**
 * Converts an embedding array to Float32Array for database storage.
 */
export function toFloat32Array(embedding: number[]): Float32Array {
  return new Float32Array(embedding);
}

/**
 * Converts a Float32Array to regular array.
 */
export function fromFloat32Array(buffer: Float32Array): number[] {
  return Array.from(buffer);
}

/**
 * Validates embedding dimensions.
 */
export function validateEmbeddingDimensions(
  embedding: Float32Array | number[],
  expectedDimensions: number
): boolean {
  return embedding.length === expectedDimensions;
}

// ============================================================
// LAYER ROUTING
// ============================================================

/**
 * Gets the appropriate layer for a node type.
 *
 * This is a simplified version - the full implementation uses
 * getStorageLayer from ../storage.
 */
export function getLayerForQuery(
  layer?: StorageLayer
): StorageLayer {
  return layer ?? 'semantic';
}
