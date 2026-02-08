/**
 * @module @nous/core/sync/manager
 * @description Sync orchestration and status management
 * @version 1.0.0
 * @spec Brainstorms/Specs/storm-017
 * @storm Brainstorms/Infrastructure/storm-017-infrastructure-architecture
 *
 * Manages sync operations between local database and Turso cloud.
 * Coordinates with conflict resolver for handling version conflicts.
 *
 * @see storm-017 v1.1 - Sync architecture
 * @see storm-033 - Detailed sync engine specification
 */

import { z } from 'zod';
import type { SyncResult } from '../db/adapter';

// Re-export SyncResult for convenience
export type { SyncResult };

// ============================================================
// SYNC STATUS
// ============================================================

/**
 * Sync status enumeration.
 */
export const SYNC_STATUSES = [
  'idle',
  'syncing',
  'paused',
  'error',
  'offline',
] as const;

export type SyncStatus = (typeof SYNC_STATUSES)[number];

/**
 * Detailed sync state.
 */
export interface SyncState {
  /** Current sync status */
  status: SyncStatus;
  /** Last successful sync timestamp (ISO 8601) */
  lastSyncAt: string | null;
  /** Last sync attempt timestamp */
  lastAttemptAt: string | null;
  /** Number of pending local changes */
  pendingChanges: number;
  /** Number of unresolved conflicts */
  unresolvedConflicts: number;
  /** Current sync progress (0-100) */
  progress: number;
  /** Error message (if status is 'error') */
  errorMessage: string | null;
  /** Number of failed attempts */
  failedAttempts: number;
  /** Next scheduled sync timestamp */
  nextSyncAt: string | null;
}

export const SyncStateSchema = z.object({
  status: z.enum(SYNC_STATUSES),
  lastSyncAt: z.string().datetime().nullable(),
  lastAttemptAt: z.string().datetime().nullable(),
  pendingChanges: z.number().int().min(0),
  unresolvedConflicts: z.number().int().min(0),
  progress: z.number().min(0).max(100),
  errorMessage: z.string().nullable(),
  failedAttempts: z.number().int().min(0),
  nextSyncAt: z.string().datetime().nullable(),
});

/**
 * Creates initial sync state.
 */
export function createInitialSyncState(): SyncState {
  return {
    status: 'idle',
    lastSyncAt: null,
    lastAttemptAt: null,
    pendingChanges: 0,
    unresolvedConflicts: 0,
    progress: 0,
    errorMessage: null,
    failedAttempts: 0,
    nextSyncAt: null,
  };
}

// ============================================================
// SYNC EVENTS
// ============================================================

/**
 * Sync event types.
 */
export const SYNC_EVENT_TYPES = [
  'sync_started',
  'sync_progress',
  'sync_completed',
  'sync_failed',
  'conflict_detected',
  'conflict_resolved',
  'offline',
  'online',
] as const;

export type SyncEventType = (typeof SYNC_EVENT_TYPES)[number];

/**
 * Base sync event.
 */
export interface SyncEvent {
  type: SyncEventType;
  timestamp: string;
}

/**
 * Sync started event.
 */
export interface SyncStartedEvent extends SyncEvent {
  type: 'sync_started';
  triggeredBy: 'auto' | 'manual' | 'conflict_resolution';
}

/**
 * Sync progress event.
 */
export interface SyncProgressEvent extends SyncEvent {
  type: 'sync_progress';
  progress: number;
  currentStep: string;
}

/**
 * Sync completed event.
 */
export interface SyncCompletedEvent extends SyncEvent {
  type: 'sync_completed';
  durationMs: number;
  changesSynced: number;
  conflictsResolved: number;
}

/**
 * Sync failed event.
 */
export interface SyncFailedEvent extends SyncEvent {
  type: 'sync_failed';
  error: string;
  retryable: boolean;
  nextRetryAt: string | null;
}

/**
 * Conflict detected event.
 */
export interface ConflictDetectedEvent extends SyncEvent {
  type: 'conflict_detected';
  nodeId: string;
  conflictType: 'weak' | 'strong';
  autoResolved: boolean;
}

/**
 * Union of all sync events.
 */
export type AnySyncEvent =
  | SyncStartedEvent
  | SyncProgressEvent
  | SyncCompletedEvent
  | SyncFailedEvent
  | ConflictDetectedEvent
  | SyncEvent;

// ============================================================
// CONFLICT TYPES
// ============================================================

/**
 * Conflict information.
 */
export interface ConflictInfo {
  nodeId: string;
  conflictType: 'weak' | 'strong';
  localVersion: number;
  cloudVersion: number;
  localModifiedAt: string;
  cloudModifiedAt: string;
  fieldsInConflict: string[];
  localContent?: string;
  cloudContent?: string;
}

/**
 * Conflict resolution choices.
 */
export const CONFLICT_RESOLUTION_CHOICES = [
  'keep_local',
  'keep_cloud',
  'keep_both',
  'merge',
] as const;

export type ConflictResolutionChoice =
  (typeof CONFLICT_RESOLUTION_CHOICES)[number];

// ============================================================
// SYNC MANAGER OPTIONS
// ============================================================

/**
 * Sync manager configuration options.
 */
export interface SyncManagerOptions {
  /** Minimum interval between syncs (ms) */
  minIntervalMs: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Base retry delay (ms) - uses exponential backoff */
  retryDelayMs: number;
  /** Batch size for sync operations */
  batchSize: number;
  /** Enable automatic sync */
  autoSync: boolean;
  /** WiFi-only sync */
  wifiOnly: boolean;
  /** Sync only when charging */
  chargingOnly: boolean;
  /** Enable background sync */
  backgroundSync: boolean;
}

export const SyncManagerOptionsSchema = z.object({
  minIntervalMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0),
  retryDelayMs: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  autoSync: z.boolean(),
  wifiOnly: z.boolean(),
  chargingOnly: z.boolean(),
  backgroundSync: z.boolean(),
});

/**
 * Creates default sync manager options.
 */
export function createDefaultSyncManagerOptions(): SyncManagerOptions {
  return {
    minIntervalMs: 60_000, // 1 minute
    maxRetries: 3,
    retryDelayMs: 1000,
    batchSize: 100,
    autoSync: true,
    wifiOnly: false,
    chargingOnly: false,
    backgroundSync: true,
  };
}

// ============================================================
// SYNC LOCK
// ============================================================

/**
 * Sync lock state (prevents thundering herd).
 *
 * @see storm-033 - 30-second sync lock
 */
export interface SyncLock {
  /** Device that holds the lock */
  deviceId: string;
  /** Lock acquired timestamp */
  acquiredAt: string;
  /** Lock expires timestamp */
  expiresAt: string;
}

export const SyncLockSchema = z.object({
  deviceId: z.string().min(1),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

/**
 * Default lock duration in seconds.
 */
export const DEFAULT_LOCK_DURATION_SECONDS = 30;

/**
 * Creates a sync lock.
 */
export function createSyncLock(
  deviceId: string,
  durationSeconds: number = DEFAULT_LOCK_DURATION_SECONDS
): SyncLock {
  const now = new Date();
  const expires = new Date(now.getTime() + durationSeconds * 1000);

  return {
    deviceId,
    acquiredAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
}

/**
 * Checks if a sync lock is still valid.
 */
export function isSyncLockValid(lock: SyncLock): boolean {
  return new Date(lock.expiresAt).getTime() > Date.now();
}

/**
 * Checks if a lock is expired.
 */
export function isSyncLockExpired(lock: SyncLock): boolean {
  return !isSyncLockValid(lock);
}

// ============================================================
// SYNC EVENT HANDLER
// ============================================================

/**
 * Sync event handler type.
 */
export type SyncEventHandler = (event: AnySyncEvent) => void;

// ============================================================
// SYNC MANAGER INTERFACE
// ============================================================

/**
 * Sync manager interface.
 *
 * Coordinates sync operations, handles scheduling, and
 * manages sync state.
 */
export interface SyncManager {
  // ==================== STATE ====================

  /**
   * Gets current sync state.
   */
  getState(): SyncState;

  /**
   * Checks if currently syncing.
   */
  isSyncing(): boolean;

  /**
   * Checks if online (network available).
   */
  isOnline(): boolean;

  // ==================== SYNC OPERATIONS ====================

  /**
   * Triggers a sync operation.
   *
   * @param force - Force sync even if recently synced
   * @returns Promise that resolves when sync completes
   */
  sync(force?: boolean): Promise<SyncResult>;

  /**
   * Pauses automatic sync.
   */
  pause(): void;

  /**
   * Resumes automatic sync.
   */
  resume(): void;

  // ==================== CONFLICT HANDLING ====================

  /**
   * Gets list of unresolved conflicts.
   */
  getUnresolvedConflicts(): Promise<ConflictInfo[]>;

  /**
   * Resolves a specific conflict.
   *
   * @param nodeId - Node with conflict
   * @param resolution - How to resolve
   */
  resolveConflict(
    nodeId: string,
    resolution: ConflictResolutionChoice
  ): Promise<void>;

  // ==================== EVENT HANDLING ====================

  /**
   * Subscribes to sync events.
   *
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  subscribe(handler: SyncEventHandler): () => void;

  // ==================== LIFECYCLE ====================

  /**
   * Starts the sync manager (begin scheduling).
   */
  start(): Promise<void>;

  /**
   * Stops the sync manager.
   */
  stop(): Promise<void>;
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validates a sync state.
 */
export function validateSyncState(state: unknown): state is SyncState {
  return SyncStateSchema.safeParse(state).success;
}

/**
 * Validates sync manager options.
 */
export function validateSyncManagerOptions(
  options: unknown
): options is SyncManagerOptions {
  return SyncManagerOptionsSchema.safeParse(options).success;
}

/**
 * Validates a sync lock.
 */
export function validateSyncLock(lock: unknown): lock is SyncLock {
  return SyncLockSchema.safeParse(lock).success;
}
