/**
 * @module @nous/core/db/config
 * @description Database and sync configuration types
 * @version 1.0.0
 * @spec Brainstorms/Specs/storm-017
 * @storm Brainstorms/Infrastructure/storm-017-infrastructure-architecture
 *
 * Implements configuration for Turso/libSQL database with embedded replica pattern.
 */

import { z } from 'zod';

// Re-use canonical privacy tier from security module (avoids duplicate export in barrel)
import { PRIVACY_TIERS, type PrivacyTier } from '../security/constants';

// ============================================================
// DATABASE DEFAULTS
// ============================================================

/**
 * Default database configuration values.
 */
export const DB_DEFAULTS = {
  /** OpenAI embedding dimensions */
  vectorDimensions: 1536,
  /** DiskANN index parameter */
  maxNeighbors: 50,
  /** Default sync batch size */
  syncBatchSize: 100,
  /** Current schema version */
  schemaVersion: 2,
  /** Default sync interval in milliseconds */
  syncIntervalMs: 60_000,
  /** Default connection timeout */
  connectionTimeoutMs: 10_000,
  /** Max retry attempts */
  maxRetries: 3,
  /** Base retry delay */
  retryDelayMs: 1000,
} as const;

// ============================================================
// DATABASE MODE
// ============================================================

/**
 * Database operation modes.
 * - local: SQLite file on device only
 * - cloud: Turso cloud database only
 * - replica: Embedded replica (local + cloud sync)
 */
export const DATABASE_MODES = ['local', 'cloud', 'replica'] as const;
export type DatabaseMode = (typeof DATABASE_MODES)[number];

// ============================================================
// SYNC MODE
// ============================================================

/**
 * Sync behavior modes.
 * - auto: Automatic sync on schedule and changes
 * - manual: Sync only when explicitly triggered
 * - disabled: No sync (local-only)
 */
export const SYNC_MODES = ['auto', 'manual', 'disabled'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

// ============================================================
// PRIVACY TIER
// ============================================================

// PRIVACY_TIERS and PrivacyTier are imported + re-exported from security/constants above

// ============================================================
// TURSO CONFIG
// ============================================================

/**
 * Turso database connection configuration.
 */
export interface TursoConfig {
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

export const TursoConfigSchema = z.object({
  url: z.string().min(1),
  authToken: z.string().optional(),
  syncUrl: z.string().url().optional(),
  syncIntervalMs: z.number().int().positive().optional(),
  encryptionKey: z.string().optional(),
});

// ============================================================
// DATABASE OPTIONS
// ============================================================

/**
 * Database behavior options.
 */
export interface DatabaseOptions {
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

export const DatabaseOptionsSchema = z.object({
  mode: z.enum(DATABASE_MODES),
  enableWAL: z.boolean(),
  connectionTimeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0),
  retryDelayMs: z.number().int().positive(),
  vectorDimensions: z.number().int().positive(),
  maxNeighbors: z.number().int().positive(),
});

/**
 * Creates default database options.
 */
export function createDefaultDatabaseOptions(): DatabaseOptions {
  return {
    mode: 'replica',
    enableWAL: true,
    connectionTimeoutMs: DB_DEFAULTS.connectionTimeoutMs,
    maxRetries: DB_DEFAULTS.maxRetries,
    retryDelayMs: DB_DEFAULTS.retryDelayMs,
    vectorDimensions: DB_DEFAULTS.vectorDimensions,
    maxNeighbors: DB_DEFAULTS.maxNeighbors,
  };
}

// ============================================================
// SYNC CONFIG
// ============================================================

/**
 * Sync behavior configuration.
 */
export interface SyncConfig {
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

export const SyncConfigSchema = z.object({
  mode: z.enum(SYNC_MODES),
  minIntervalMs: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  wifiOnly: z.boolean(),
  chargingOnly: z.boolean(),
  backgroundSync: z.boolean(),
  maxRetries: z.number().int().min(0),
});

/**
 * Creates default sync configuration.
 */
export function createDefaultSyncConfig(): SyncConfig {
  return {
    mode: 'auto',
    minIntervalMs: DB_DEFAULTS.syncIntervalMs,
    batchSize: DB_DEFAULTS.syncBatchSize,
    wifiOnly: false,
    chargingOnly: false,
    backgroundSync: true,
    maxRetries: DB_DEFAULTS.maxRetries,
  };
}

// ============================================================
// TENANT CONFIG
// ============================================================

/**
 * Per-tenant configuration for database-per-user architecture.
 */
export interface TenantConfig {
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

export const TenantConfigSchema = z.object({
  tenantId: z.string().min(1),
  privacyTier: z.enum(PRIVACY_TIERS),
  databaseUrl: z.string().min(1),
  authToken: z.string().min(1),
  storageQuotaBytes: z.number().int().positive(),
  createdAt: z.string().datetime(),
});

// ============================================================
// INFRASTRUCTURE CONFIG
// ============================================================

/**
 * Complete infrastructure configuration.
 */
export interface InfrastructureConfig {
  /** Turso connection settings */
  turso: TursoConfig;
  /** Database behavior options */
  database: DatabaseOptions;
  /** Sync configuration */
  sync: SyncConfig;
}

export const InfrastructureConfigSchema = z.object({
  turso: TursoConfigSchema,
  database: DatabaseOptionsSchema,
  sync: SyncConfigSchema,
});

/**
 * Creates default infrastructure configuration.
 *
 * @param tursoConfig - Turso connection settings
 * @returns Complete infrastructure config with defaults
 */
export function createDefaultInfrastructureConfig(
  tursoConfig: TursoConfig
): InfrastructureConfig {
  return {
    turso: tursoConfig,
    database: createDefaultDatabaseOptions(),
    sync: createDefaultSyncConfig(),
  };
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validates a Turso configuration.
 */
export function validateTursoConfig(config: unknown): config is TursoConfig {
  return TursoConfigSchema.safeParse(config).success;
}

/**
 * Validates database options.
 */
export function validateDatabaseOptions(
  options: unknown
): options is DatabaseOptions {
  return DatabaseOptionsSchema.safeParse(options).success;
}

/**
 * Validates sync configuration.
 */
export function validateSyncConfig(config: unknown): config is SyncConfig {
  return SyncConfigSchema.safeParse(config).success;
}

/**
 * Validates complete infrastructure configuration.
 */
export function validateInfrastructureConfig(
  config: unknown
): config is InfrastructureConfig {
  return InfrastructureConfigSchema.safeParse(config).success;
}
