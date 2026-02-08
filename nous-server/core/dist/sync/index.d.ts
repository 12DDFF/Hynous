import { z } from 'zod';
import { S as SyncResult } from '../adapter-1wMETV4W.js';
import '../storage/index.js';
import '../constants-Blu2FVkv.js';

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

/**
 * Sync status enumeration.
 */
declare const SYNC_STATUSES: readonly ["idle", "syncing", "paused", "error", "offline"];
type SyncStatus = (typeof SYNC_STATUSES)[number];
/**
 * Detailed sync state.
 */
interface SyncState {
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
declare const SyncStateSchema: z.ZodObject<{
    status: z.ZodEnum<["idle", "syncing", "paused", "error", "offline"]>;
    lastSyncAt: z.ZodNullable<z.ZodString>;
    lastAttemptAt: z.ZodNullable<z.ZodString>;
    pendingChanges: z.ZodNumber;
    unresolvedConflicts: z.ZodNumber;
    progress: z.ZodNumber;
    errorMessage: z.ZodNullable<z.ZodString>;
    failedAttempts: z.ZodNumber;
    nextSyncAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "error" | "idle" | "paused" | "syncing" | "offline";
    lastSyncAt: string | null;
    lastAttemptAt: string | null;
    pendingChanges: number;
    unresolvedConflicts: number;
    progress: number;
    errorMessage: string | null;
    failedAttempts: number;
    nextSyncAt: string | null;
}, {
    status: "error" | "idle" | "paused" | "syncing" | "offline";
    lastSyncAt: string | null;
    lastAttemptAt: string | null;
    pendingChanges: number;
    unresolvedConflicts: number;
    progress: number;
    errorMessage: string | null;
    failedAttempts: number;
    nextSyncAt: string | null;
}>;
/**
 * Creates initial sync state.
 */
declare function createInitialSyncState(): SyncState;
/**
 * Sync event types.
 */
declare const SYNC_EVENT_TYPES: readonly ["sync_started", "sync_progress", "sync_completed", "sync_failed", "conflict_detected", "conflict_resolved", "offline", "online"];
type SyncEventType = (typeof SYNC_EVENT_TYPES)[number];
/**
 * Base sync event.
 */
interface SyncEvent {
    type: SyncEventType;
    timestamp: string;
}
/**
 * Sync started event.
 */
interface SyncStartedEvent extends SyncEvent {
    type: 'sync_started';
    triggeredBy: 'auto' | 'manual' | 'conflict_resolution';
}
/**
 * Sync progress event.
 */
interface SyncProgressEvent extends SyncEvent {
    type: 'sync_progress';
    progress: number;
    currentStep: string;
}
/**
 * Sync completed event.
 */
interface SyncCompletedEvent extends SyncEvent {
    type: 'sync_completed';
    durationMs: number;
    changesSynced: number;
    conflictsResolved: number;
}
/**
 * Sync failed event.
 */
interface SyncFailedEvent extends SyncEvent {
    type: 'sync_failed';
    error: string;
    retryable: boolean;
    nextRetryAt: string | null;
}
/**
 * Conflict detected event.
 */
interface ConflictDetectedEvent extends SyncEvent {
    type: 'conflict_detected';
    nodeId: string;
    conflictType: 'weak' | 'strong';
    autoResolved: boolean;
}
/**
 * Union of all sync events.
 */
type AnySyncEvent = SyncStartedEvent | SyncProgressEvent | SyncCompletedEvent | SyncFailedEvent | ConflictDetectedEvent | SyncEvent;
/**
 * Conflict information.
 */
interface ConflictInfo {
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
declare const CONFLICT_RESOLUTION_CHOICES: readonly ["keep_local", "keep_cloud", "keep_both", "merge"];
type ConflictResolutionChoice = (typeof CONFLICT_RESOLUTION_CHOICES)[number];
/**
 * Sync manager configuration options.
 */
interface SyncManagerOptions {
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
declare const SyncManagerOptionsSchema: z.ZodObject<{
    minIntervalMs: z.ZodNumber;
    maxRetries: z.ZodNumber;
    retryDelayMs: z.ZodNumber;
    batchSize: z.ZodNumber;
    autoSync: z.ZodBoolean;
    wifiOnly: z.ZodBoolean;
    chargingOnly: z.ZodBoolean;
    backgroundSync: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    maxRetries: number;
    retryDelayMs: number;
    minIntervalMs: number;
    batchSize: number;
    wifiOnly: boolean;
    chargingOnly: boolean;
    backgroundSync: boolean;
    autoSync: boolean;
}, {
    maxRetries: number;
    retryDelayMs: number;
    minIntervalMs: number;
    batchSize: number;
    wifiOnly: boolean;
    chargingOnly: boolean;
    backgroundSync: boolean;
    autoSync: boolean;
}>;
/**
 * Creates default sync manager options.
 */
declare function createDefaultSyncManagerOptions(): SyncManagerOptions;
/**
 * Sync lock state (prevents thundering herd).
 *
 * @see storm-033 - 30-second sync lock
 */
interface SyncLock {
    /** Device that holds the lock */
    deviceId: string;
    /** Lock acquired timestamp */
    acquiredAt: string;
    /** Lock expires timestamp */
    expiresAt: string;
}
declare const SyncLockSchema: z.ZodObject<{
    deviceId: z.ZodString;
    acquiredAt: z.ZodString;
    expiresAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    deviceId: string;
    acquiredAt: string;
    expiresAt: string;
}, {
    deviceId: string;
    acquiredAt: string;
    expiresAt: string;
}>;
/**
 * Default lock duration in seconds.
 */
declare const DEFAULT_LOCK_DURATION_SECONDS = 30;
/**
 * Creates a sync lock.
 */
declare function createSyncLock(deviceId: string, durationSeconds?: number): SyncLock;
/**
 * Checks if a sync lock is still valid.
 */
declare function isSyncLockValid(lock: SyncLock): boolean;
/**
 * Checks if a lock is expired.
 */
declare function isSyncLockExpired(lock: SyncLock): boolean;
/**
 * Sync event handler type.
 */
type SyncEventHandler = (event: AnySyncEvent) => void;
/**
 * Sync manager interface.
 *
 * Coordinates sync operations, handles scheduling, and
 * manages sync state.
 */
interface SyncManager {
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
    resolveConflict(nodeId: string, resolution: ConflictResolutionChoice): Promise<void>;
    /**
     * Subscribes to sync events.
     *
     * @param handler - Event handler function
     * @returns Unsubscribe function
     */
    subscribe(handler: SyncEventHandler): () => void;
    /**
     * Starts the sync manager (begin scheduling).
     */
    start(): Promise<void>;
    /**
     * Stops the sync manager.
     */
    stop(): Promise<void>;
}
/**
 * Validates a sync state.
 */
declare function validateSyncState(state: unknown): state is SyncState;
/**
 * Validates sync manager options.
 */
declare function validateSyncManagerOptions(options: unknown): options is SyncManagerOptions;
/**
 * Validates a sync lock.
 */
declare function validateSyncLock(lock: unknown): lock is SyncLock;

/**
 * @module @nous/core/sync/conflict-resolution
 * @description Conflict detection and resolution for sync
 * @version 1.0.0
 * @spec Brainstorms/Specs/storm-017
 * @storm Brainstorms/Infrastructure/storm-017-infrastructure-architecture
 *
 * Implements smart conflict resolution:
 * - Weak conflicts (different fields changed) -> auto-merge
 * - Strong conflicts (same field changed) -> user resolution
 *
 * @see storm-017 v1.1 - Smart auto-merge conflicts
 * @see storm-033 - Detailed conflict resolution specification
 */

/**
 * Conflict strength classification.
 */
declare const CONFLICT_STRENGTHS: readonly ["weak", "strong"];
type ConflictStrength = (typeof CONFLICT_STRENGTHS)[number];
/**
 * Field categories for conflict classification.
 *
 * Different field types have different merge strategies.
 */
declare const FIELD_CATEGORIES: readonly ["content", "metadata", "neural", "structural", "versioning"];
type FieldCategory = (typeof FIELD_CATEGORIES)[number];
/**
 * Maps field names to categories.
 */
declare const FIELD_CATEGORY_MAP: Record<string, FieldCategory>;
/**
 * Detected conflict information.
 */
interface DetectedConflict {
    /** Node ID with conflict */
    nodeId: string;
    /** Conflict strength */
    strength: ConflictStrength;
    /** Local version number */
    localVersion: number;
    /** Cloud version number */
    cloudVersion: number;
    /** Base version (last common ancestor) */
    baseVersion: number;
    /** Local modification timestamp */
    localModifiedAt: string;
    /** Cloud modification timestamp */
    cloudModifiedAt: string;
    /** Fields that differ between local and cloud */
    fieldsInConflict: string[];
    /** Categories of conflicting fields */
    conflictCategories: FieldCategory[];
    /** Whether this can be auto-resolved */
    canAutoResolve: boolean;
    /** Suggested resolution (if auto-resolvable) */
    suggestedResolution?: ConflictResolution;
}
declare const DetectedConflictSchema: z.ZodObject<{
    nodeId: z.ZodString;
    strength: z.ZodEnum<["weak", "strong"]>;
    localVersion: z.ZodNumber;
    cloudVersion: z.ZodNumber;
    baseVersion: z.ZodNumber;
    localModifiedAt: z.ZodString;
    cloudModifiedAt: z.ZodString;
    fieldsInConflict: z.ZodArray<z.ZodString, "many">;
    conflictCategories: z.ZodArray<z.ZodEnum<["content", "metadata", "neural", "structural", "versioning"]>, "many">;
    canAutoResolve: z.ZodBoolean;
    suggestedResolution: z.ZodOptional<z.ZodAny>;
}, "strip", z.ZodTypeAny, {
    strength: "weak" | "strong";
    nodeId: string;
    localVersion: number;
    cloudVersion: number;
    baseVersion: number;
    localModifiedAt: string;
    cloudModifiedAt: string;
    fieldsInConflict: string[];
    conflictCategories: ("content" | "neural" | "versioning" | "structural" | "metadata")[];
    canAutoResolve: boolean;
    suggestedResolution?: any;
}, {
    strength: "weak" | "strong";
    nodeId: string;
    localVersion: number;
    cloudVersion: number;
    baseVersion: number;
    localModifiedAt: string;
    cloudModifiedAt: string;
    fieldsInConflict: string[];
    conflictCategories: ("content" | "neural" | "versioning" | "structural" | "metadata")[];
    canAutoResolve: boolean;
    suggestedResolution?: any;
}>;
/**
 * Gets the category for a field name.
 */
declare function getFieldCategory(fieldName: string): FieldCategory;
/**
 * Gets unique categories from a list of field names.
 */
declare function getFieldCategories(fieldNames: string[]): FieldCategory[];
/**
 * Classifies conflict strength based on changed fields.
 *
 * WEAK CONFLICT (auto-merge):
 * - Metadata-only changes (access_count, last_accessed)
 * - Non-overlapping edits (different fields changed)
 * - Additive changes (both added content, no deletions)
 *
 * STRONG CONFLICT (user resolution):
 * - Same field edited with different values
 * - Content deleted on one side, modified on other
 * - Structural changes (node type changed)
 *
 * @param localChanges - Fields changed locally
 * @param cloudChanges - Fields changed in cloud
 * @returns Conflict strength
 */
declare function classifyConflictStrength(localChanges: string[], cloudChanges: string[]): ConflictStrength;
/**
 * Determines if a conflict can be auto-resolved.
 *
 * @param conflict - Detected conflict
 * @returns Whether conflict can be auto-resolved
 */
declare function canAutoResolveConflict(conflict: DetectedConflict): boolean;
/**
 * Resolution action types.
 */
declare const RESOLUTION_ACTIONS: readonly ["keep_local", "keep_cloud", "keep_both", "merge_fields", "custom"];
type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number];
/**
 * Conflict resolution specification.
 */
interface ConflictResolution {
    /** Resolution action */
    action: ResolutionAction;
    /** For merge_fields: which field takes which value */
    fieldResolutions?: Record<string, 'local' | 'cloud'>;
    /** Resolved version number */
    resolvedVersion: number;
    /** Resolution timestamp */
    resolvedAt: string;
    /** Who resolved (user or auto) */
    resolvedBy: 'user' | 'auto';
    /** Notes about the resolution */
    notes?: string;
}
declare const ConflictResolutionSchema: z.ZodObject<{
    action: z.ZodEnum<["keep_local", "keep_cloud", "keep_both", "merge_fields", "custom"]>;
    fieldResolutions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodEnum<["local", "cloud"]>>>;
    resolvedVersion: z.ZodNumber;
    resolvedAt: z.ZodString;
    resolvedBy: z.ZodEnum<["user", "auto"]>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    action: "custom" | "keep_local" | "keep_cloud" | "keep_both" | "merge_fields";
    resolvedVersion: number;
    resolvedAt: string;
    resolvedBy: "user" | "auto";
    fieldResolutions?: Record<string, "local" | "cloud"> | undefined;
    notes?: string | undefined;
}, {
    action: "custom" | "keep_local" | "keep_cloud" | "keep_both" | "merge_fields";
    resolvedVersion: number;
    resolvedAt: string;
    resolvedBy: "user" | "auto";
    fieldResolutions?: Record<string, "local" | "cloud"> | undefined;
    notes?: string | undefined;
}>;
/**
 * Field merge strategy types.
 */
declare const MERGE_STRATEGIES: readonly ["take_local", "take_cloud", "take_latest", "take_max", "take_min", "sum", "concatenate", "user_choice"];
type MergeStrategy = (typeof MERGE_STRATEGIES)[number];
/**
 * Field-specific merge strategies.
 *
 * @see storm-033 - 13 field-level merge strategies
 */
declare const FIELD_MERGE_STRATEGIES: Record<string, MergeStrategy>;
/**
 * Gets the merge strategy for a field.
 */
declare function getMergeStrategy(fieldName: string): MergeStrategy;
/**
 * Auto-merge result for a single field.
 */
interface FieldMergeResult {
    fieldName: string;
    strategy: MergeStrategy;
    resolvedValue: unknown;
    source: 'local' | 'cloud' | 'merged';
}
/**
 * Auto-merge result.
 */
interface AutoMergeResult {
    /** Whether merge succeeded */
    success: boolean;
    /** Merged field values */
    mergedFields: FieldMergeResult[];
    /** Fields that couldn't be merged */
    unmergeableFields: string[];
    /** Resulting version number */
    resultVersion: number;
}
/**
 * Applies a merge strategy to merge two values.
 *
 * @param strategy - Merge strategy to use
 * @param localValue - Local value
 * @param cloudValue - Cloud value
 * @param localTimestamp - Local modification time
 * @param cloudTimestamp - Cloud modification time
 * @returns Merged value and source
 * @throws Error if strategy is 'user_choice'
 */
declare function applyMergeStrategy(strategy: MergeStrategy, localValue: unknown, cloudValue: unknown, localTimestamp: string, cloudTimestamp: string): {
    value: unknown;
    source: 'local' | 'cloud' | 'merged';
};
/**
 * Attempts to auto-merge a weak conflict.
 */
declare function attemptAutoMerge(localData: Record<string, unknown>, cloudData: Record<string, unknown>, fieldsInConflict: string[], localTimestamp: string, cloudTimestamp: string, baseVersion: number): AutoMergeResult;
/**
 * Conflict resolver interface.
 */
interface ConflictResolver {
    /**
     * Detects conflicts between local and cloud versions.
     *
     * @param nodeId - Node to check
     * @param localData - Local node data
     * @param cloudData - Cloud node data
     * @returns Detected conflict or null if no conflict
     */
    detectConflict(nodeId: string, localData: Record<string, unknown>, cloudData: Record<string, unknown>): DetectedConflict | null;
    /**
     * Attempts auto-merge for a weak conflict.
     *
     * @param conflict - Detected conflict
     * @param localData - Full local node data
     * @param cloudData - Full cloud node data
     * @returns Auto-merge result
     */
    attemptAutoMerge(conflict: DetectedConflict, localData: Record<string, unknown>, cloudData: Record<string, unknown>): AutoMergeResult;
    /**
     * Resolves a conflict with user choice.
     *
     * @param conflict - Detected conflict
     * @param resolution - User's resolution choice
     * @returns Resolution result
     */
    resolveConflict(conflict: DetectedConflict, resolution: ConflictResolution): Promise<void>;
}
/**
 * Validates a detected conflict.
 */
declare function validateDetectedConflict(conflict: unknown): conflict is DetectedConflict;
/**
 * Validates a conflict resolution.
 */
declare function validateConflictResolution(resolution: unknown): resolution is ConflictResolution;

/**
 * @module @nous/core/sync/health
 * @description Health monitoring for database and sync
 * @version 1.0.0
 * @spec Brainstorms/Specs/storm-017
 * @storm Brainstorms/Infrastructure/storm-017-infrastructure-architecture
 *
 * Implements health monitoring as defined in storm-017 MVP extension:
 * - Local health counters
 * - Three-state health status (healthy/warning/error)
 * - Debug report generation
 *
 * @see storm-017 v1.1 - Health Monitoring extension
 */

/**
 * Health status levels.
 */
declare const HEALTH_STATUSES: readonly ["healthy", "warning", "error"];
type HealthStatus = (typeof HEALTH_STATUSES)[number];
/**
 * Health check thresholds.
 */
declare const HEALTH_THRESHOLDS: {
    /** Max time since last sync before warning (seconds) */
    readonly syncWarningSeconds: 3600;
    /** Max time since last sync before error (seconds) */
    readonly syncErrorSeconds: 86400;
    /** Max pending changes before warning */
    readonly pendingWarningCount: 10;
    /** Max sync errors in 24h before error status */
    readonly errorThreshold24h: 5;
    /** Max conflicts before warning */
    readonly conflictWarningCount: 1;
};
/**
 * Health metrics collected locally.
 */
interface HealthMetrics {
    /** Last successful sync timestamp (Unix ms) */
    lastSuccessfulSync: number | null;
    /** Sync errors in rolling 24h window */
    syncErrors24h: number;
    /** Number of pending local changes */
    pendingChanges: number;
    /** Number of unresolved conflicts */
    unresolvedConflicts: number;
    /** Database size in bytes */
    databaseSizeBytes: number;
    /** Node count */
    nodeCount: number;
    /** Edge count */
    edgeCount: number;
    /** App version */
    appVersion: string;
    /** Last metrics update timestamp */
    updatedAt: number;
}
declare const HealthMetricsSchema: z.ZodObject<{
    lastSuccessfulSync: z.ZodNullable<z.ZodNumber>;
    syncErrors24h: z.ZodNumber;
    pendingChanges: z.ZodNumber;
    unresolvedConflicts: z.ZodNumber;
    databaseSizeBytes: z.ZodNumber;
    nodeCount: z.ZodNumber;
    edgeCount: z.ZodNumber;
    appVersion: z.ZodString;
    updatedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    nodeCount: number;
    updatedAt: number;
    pendingChanges: number;
    unresolvedConflicts: number;
    lastSuccessfulSync: number | null;
    syncErrors24h: number;
    databaseSizeBytes: number;
    edgeCount: number;
    appVersion: string;
}, {
    nodeCount: number;
    updatedAt: number;
    pendingChanges: number;
    unresolvedConflicts: number;
    lastSuccessfulSync: number | null;
    syncErrors24h: number;
    databaseSizeBytes: number;
    edgeCount: number;
    appVersion: string;
}>;
/**
 * Creates empty health metrics.
 */
declare function createEmptyHealthMetrics(appVersion: string): HealthMetrics;
/**
 * Health assessment result.
 */
interface HealthAssessment {
    /** Overall health status */
    status: HealthStatus;
    /** Human-readable status label */
    label: string;
    /** Detailed status message */
    message: string;
    /** Individual check results */
    checks: HealthCheck[];
    /** Issues found */
    issues: string[];
    /** Recommendations */
    recommendations: string[];
    /** Assessment timestamp */
    assessedAt: string;
}
declare const HealthAssessmentSchema: z.ZodObject<{
    status: z.ZodEnum<["healthy", "warning", "error"]>;
    label: z.ZodString;
    message: z.ZodString;
    checks: z.ZodArray<z.ZodAny, "many">;
    issues: z.ZodArray<z.ZodString, "many">;
    recommendations: z.ZodArray<z.ZodString, "many">;
    assessedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "error" | "healthy" | "warning";
    issues: string[];
    message: string;
    label: string;
    checks: any[];
    recommendations: string[];
    assessedAt: string;
}, {
    status: "error" | "healthy" | "warning";
    issues: string[];
    message: string;
    label: string;
    checks: any[];
    recommendations: string[];
    assessedAt: string;
}>;
/**
 * Individual health check.
 */
interface HealthCheck {
    /** Check name */
    name: string;
    /** Check status */
    status: HealthStatus;
    /** Check message */
    message: string;
    /** Optional value being checked */
    value?: unknown;
    /** Optional threshold */
    threshold?: unknown;
}
/**
 * Assesses health status from metrics.
 *
 * @param metrics - Current health metrics
 * @returns Health assessment
 */
declare function assessHealth(metrics: HealthMetrics): HealthAssessment;
/**
 * Sync log entry.
 */
interface SyncLogEntry {
    timestamp: string;
    event: string;
    success: boolean;
    details?: string;
}
/**
 * Debug report for troubleshooting.
 */
interface DebugReport {
    /** Report generated timestamp */
    generatedAt: string;
    /** Health metrics */
    metrics: HealthMetrics;
    /** Health assessment */
    assessment: HealthAssessment;
    /** Device information */
    device: {
        platform: string;
        osVersion: string;
        appVersion: string;
        deviceId: string;
    };
    /** Recent sync log entries */
    recentSyncLogs: SyncLogEntry[];
    /** Database statistics */
    databaseStats: {
        sizeBytes: number;
        nodeCount: number;
        edgeCount: number;
        episodeCount: number;
        schemaVersion: number;
    };
}
/**
 * Generates a debug report.
 *
 * @param metrics - Current health metrics
 * @param deviceInfo - Device information
 * @param syncLogs - Recent sync logs (up to 20)
 * @param dbStats - Database statistics
 * @returns Debug report
 */
declare function generateDebugReport(metrics: HealthMetrics, deviceInfo: DebugReport['device'], syncLogs: SyncLogEntry[], dbStats: DebugReport['databaseStats']): DebugReport;
/**
 * Health monitor interface.
 */
interface HealthMonitor {
    /**
     * Gets current health metrics.
     */
    getMetrics(): Promise<HealthMetrics>;
    /**
     * Gets current health assessment.
     */
    getAssessment(): Promise<HealthAssessment>;
    /**
     * Generates a debug report.
     */
    generateReport(): Promise<DebugReport>;
    /**
     * Records a sync success.
     */
    recordSyncSuccess(): Promise<void>;
    /**
     * Records a sync error.
     */
    recordSyncError(error: string): Promise<void>;
    /**
     * Updates pending change count.
     */
    updatePendingCount(count: number): Promise<void>;
    /**
     * Updates conflict count.
     */
    updateConflictCount(count: number): Promise<void>;
}
/**
 * Validates health metrics.
 */
declare function validateHealthMetrics(metrics: unknown): metrics is HealthMetrics;
/**
 * Validates a health assessment.
 */
declare function validateHealthAssessment(assessment: unknown): assessment is HealthAssessment;

/**
 * @module @nous/core/sync/nse-constants
 * @description Constants for Nous Sync Engine (NSE) v1
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-033
 * @storm Brainstorms/Infrastructure/storm-033-sync-conflict-resolution
 *
 * All NSE-specific numeric thresholds, platform types, sync statuses,
 * merge strategies, and configuration defaults.
 *
 * @see storm-033 v1 revision
 */

declare const NSE_PLATFORMS: readonly ["ios", "android", "mac", "win", "web"];
type NSEPlatform = (typeof NSE_PLATFORMS)[number];
declare const NSEPlatformSchema: z.ZodEnum<["ios", "android", "mac", "win", "web"]>;
declare function isNSEPlatform(value: unknown): value is NSEPlatform;
declare const NODE_SYNC_STATUSES: readonly ["synced", "pending", "conflict"];
type NodeSyncStatus = (typeof NODE_SYNC_STATUSES)[number];
declare const NodeSyncStatusSchema: z.ZodEnum<["synced", "pending", "conflict"]>;
declare function isNodeSyncStatus(value: unknown): value is NodeSyncStatus;
declare const VERSION_VECTOR_INACTIVE_KEY = "_inactive";
declare const VECTOR_COMPACTION_THRESHOLD = 10;
declare const DEVICE_INACTIVE_DAYS = 90;
declare const VERSION_COMPARISON_RESULTS: readonly ["a_dominates", "b_dominates", "concurrent", "equal"];
type VersionComparison = (typeof VERSION_COMPARISON_RESULTS)[number];
declare const VersionComparisonSchema: z.ZodEnum<["a_dominates", "b_dominates", "concurrent", "equal"]>;
declare function isVersionComparison(value: unknown): value is VersionComparison;
declare const NSE_SYNC_LOCK_TIMEOUT_SECONDS = 30;
declare const NSE_SYNC_BATCH_SIZE = 100;
declare const UI_YIELD_DELAY_MS = 50;
declare const CONFLICT_HISTORY_RETENTION_DAYS = 30;
declare const BANNER_DISMISS_COOLDOWN_MS = 86400000;
declare const NOTIFICATION_TIERS: readonly ["badge", "banner", "modal"];
type NotificationTier = (typeof NOTIFICATION_TIERS)[number];
declare const NotificationTierSchema: z.ZodEnum<["badge", "banner", "modal"]>;
declare const CLOCK_DRIFT_EMA_WEIGHT = 0.2;
declare const NSE_MERGE_STRATEGIES: readonly ["conflict", "latest_wins", "max", "min", "sum", "average", "max_timestamp", "union", "merge_memberships", "keep_original", "keep_local"];
type NSEMergeStrategy = (typeof NSE_MERGE_STRATEGIES)[number];
declare const NSEMergeStrategySchema: z.ZodEnum<["conflict", "latest_wins", "max", "min", "sum", "average", "max_timestamp", "union", "merge_memberships", "keep_original", "keep_local"]>;
declare function isNSEMergeStrategy(value: unknown): value is NSEMergeStrategy;
declare const SYNCABLE_FIELDS: readonly ["content.title", "content.body", "content.summary", "organization.tags", "organization.cluster_memberships", "neural.stability", "neural.retrievability", "neural.difficulty", "neural.importance", "temporal.last_accessed", "temporal.access_count", "state.lifecycle", "state.flags"];
type SyncableField = (typeof SYNCABLE_FIELDS)[number];
declare const SyncableFieldSchema: z.ZodEnum<["content.title", "content.body", "content.summary", "organization.tags", "organization.cluster_memberships", "neural.stability", "neural.retrievability", "neural.difficulty", "neural.importance", "temporal.last_accessed", "temporal.access_count", "state.lifecycle", "state.flags"]>;
declare const NSE_FIELD_MERGE_STRATEGIES: Record<string, NSEMergeStrategy>;
declare const SYNC_HEADER_DEVICE_ID = "X-Device-Id";
declare const SYNC_HEADER_SCHEMA_VERSION = "X-Schema-Version";
declare const SYNC_HEADER_SERVER_TIME = "X-Server-Time";
declare const HTTP_UPGRADE_REQUIRED = 426;
declare const SYNC_LOG_ENTRY_TYPES: readonly ["resurrection", "conflict_resolved", "schema_mismatch", "recovery", "initial_sync"];
type SyncLogEntryType = (typeof SYNC_LOG_ENTRY_TYPES)[number];
declare const SyncLogEntryTypeSchema: z.ZodEnum<["resurrection", "conflict_resolved", "schema_mismatch", "recovery", "initial_sync"]>;
declare const REEMBEDDING_REASONS: readonly ["model_mismatch", "content_changed", "manual"];
type ReembeddingReason = (typeof REEMBEDDING_REASONS)[number];
declare const ReembeddingReasonSchema: z.ZodEnum<["model_mismatch", "content_changed", "manual"]>;
declare const USER_RESOLUTION_ACTIONS: readonly ["keep_local", "keep_remote", "manual_merge"];
type UserResolutionAction = (typeof USER_RESOLUTION_ACTIONS)[number];
declare const UserResolutionActionSchema: z.ZodEnum<["keep_local", "keep_remote", "manual_merge"]>;
declare const MERGE_RESULT_STATUSES: readonly ["merged", "conflict"];
type MergeResultStatus = (typeof MERGE_RESULT_STATUSES)[number];
declare const MergeResultStatusSchema: z.ZodEnum<["merged", "conflict"]>;
declare const NSE_CONFLICT_RESOLVERS: readonly ["user", "auto"];
type NSEConflictResolver = (typeof NSE_CONFLICT_RESOLVERS)[number];
declare const NSEConflictResolverSchema: z.ZodEnum<["user", "auto"]>;

/**
 * @module @nous/core/sync/nse-types
 * @description Types and Zod schemas for Nous Sync Engine (NSE) v1
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-033
 * @storm Brainstorms/Infrastructure/storm-033-sync-conflict-resolution
 *
 * All interfaces, types, and Zod schemas for the NSE.
 */

/**
 * Version vector mapping device IDs to Lamport counters.
 * The special key `_inactive` holds compacted sum of inactive devices.
 */
interface VersionVector {
    [device_id: string]: number;
}
declare const VersionVectorSchema: z.ZodRecord<z.ZodString, z.ZodNumber>;
interface SyncMetadata {
    _schemaVersion: number;
    version: VersionVector;
    last_modified_by: string;
    last_modified_at: string;
    sync_status: NodeSyncStatus;
    last_synced_at: string;
    content_checksum?: string;
}
declare const SyncMetadataSchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    version: z.ZodRecord<z.ZodString, z.ZodNumber>;
    last_modified_by: z.ZodString;
    last_modified_at: z.ZodString;
    sync_status: z.ZodEnum<["synced", "pending", "conflict"]>;
    last_synced_at: z.ZodString;
    content_checksum: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version: Record<string, number>;
    _schemaVersion: number;
    last_modified_by: string;
    last_modified_at: string;
    sync_status: "pending" | "synced" | "conflict";
    last_synced_at: string;
    content_checksum?: string | undefined;
}, {
    version: Record<string, number>;
    _schemaVersion: number;
    last_modified_by: string;
    last_modified_at: string;
    sync_status: "pending" | "synced" | "conflict";
    last_synced_at: string;
    content_checksum?: string | undefined;
}>;
interface DeviceInfo {
    _schemaVersion: number;
    device_id: string;
    platform: NSEPlatform;
    display_name: string;
    created_at: string;
    last_active_at: string;
    clock_drift_ms: number;
    schema_version: string;
}
declare const DeviceInfoSchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    device_id: z.ZodString;
    platform: z.ZodEnum<["ios", "android", "mac", "win", "web"]>;
    display_name: z.ZodString;
    created_at: z.ZodString;
    last_active_at: z.ZodString;
    clock_drift_ms: z.ZodNumber;
    schema_version: z.ZodString;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    platform: "ios" | "android" | "mac" | "win" | "web";
    _schemaVersion: number;
    device_id: string;
    display_name: string;
    last_active_at: string;
    clock_drift_ms: number;
    schema_version: string;
}, {
    created_at: string;
    platform: "ios" | "android" | "mac" | "win" | "web";
    _schemaVersion: number;
    device_id: string;
    display_name: string;
    last_active_at: string;
    clock_drift_ms: number;
    schema_version: string;
}>;
interface ClockSync {
    server_time: string;
    local_time: string;
    drift_ms: number;
    last_sync: string;
}
declare const ClockSyncSchema: z.ZodObject<{
    server_time: z.ZodString;
    local_time: z.ZodString;
    drift_ms: z.ZodNumber;
    last_sync: z.ZodString;
}, "strip", z.ZodTypeAny, {
    server_time: string;
    local_time: string;
    drift_ms: number;
    last_sync: string;
}, {
    server_time: string;
    local_time: string;
    drift_ms: number;
    last_sync: string;
}>;
interface FieldChange {
    field: string;
    old_value: unknown;
    new_value: unknown;
}
declare const FieldChangeSchema: z.ZodObject<{
    field: z.ZodString;
    old_value: z.ZodUnknown;
    new_value: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    field: string;
    old_value?: unknown;
    new_value?: unknown;
}, {
    field: string;
    old_value?: unknown;
    new_value?: unknown;
}>;
interface ChangeSet {
    node_id: string;
    device_id: string;
    timestamp: string;
    changes: FieldChange[];
}
declare const ChangeSetSchema: z.ZodObject<{
    node_id: z.ZodString;
    device_id: z.ZodString;
    timestamp: z.ZodString;
    changes: z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        old_value: z.ZodUnknown;
        new_value: z.ZodUnknown;
    }, "strip", z.ZodTypeAny, {
        field: string;
        old_value?: unknown;
        new_value?: unknown;
    }, {
        field: string;
        old_value?: unknown;
        new_value?: unknown;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    timestamp: string;
    changes: {
        field: string;
        old_value?: unknown;
        new_value?: unknown;
    }[];
    device_id: string;
    node_id: string;
}, {
    timestamp: string;
    changes: {
        field: string;
        old_value?: unknown;
        new_value?: unknown;
    }[];
    device_id: string;
    node_id: string;
}>;
interface StrategyResult {
    value: unknown;
    isConflict: boolean;
}
declare const StrategyResultSchema: z.ZodObject<{
    value: z.ZodUnknown;
    isConflict: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    isConflict: boolean;
    value?: unknown;
}, {
    isConflict: boolean;
    value?: unknown;
}>;
interface ClusterMembershipForMerge {
    cluster_id: string;
    strength: number;
    pinned: boolean;
}
declare const ClusterMembershipForMergeSchema: z.ZodObject<{
    cluster_id: z.ZodString;
    strength: z.ZodNumber;
    pinned: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    strength: number;
    cluster_id: string;
    pinned: boolean;
}, {
    strength: number;
    cluster_id: string;
    pinned: boolean;
}>;
interface NSEConflictInfo {
    field: string;
    localValue: unknown;
    remoteValue: unknown;
    localTimestamp: string;
    remoteTimestamp: string;
}
declare const NSEConflictInfoSchema: z.ZodObject<{
    field: z.ZodString;
    localValue: z.ZodUnknown;
    remoteValue: z.ZodUnknown;
    localTimestamp: z.ZodString;
    remoteTimestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    field: string;
    localTimestamp: string;
    remoteTimestamp: string;
    localValue?: unknown;
    remoteValue?: unknown;
}, {
    field: string;
    localTimestamp: string;
    remoteTimestamp: string;
    localValue?: unknown;
    remoteValue?: unknown;
}>;
interface NSEMergeResult {
    status: MergeResultStatus;
    mergedNode?: Record<string, unknown>;
    conflicts?: NSEConflictInfo[];
}
declare const NSEMergeResultSchema: z.ZodObject<{
    status: z.ZodEnum<["merged", "conflict"]>;
    mergedNode: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    conflicts: z.ZodOptional<z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        localValue: z.ZodUnknown;
        remoteValue: z.ZodUnknown;
        localTimestamp: z.ZodString;
        remoteTimestamp: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        field: string;
        localTimestamp: string;
        remoteTimestamp: string;
        localValue?: unknown;
        remoteValue?: unknown;
    }, {
        field: string;
        localTimestamp: string;
        remoteTimestamp: string;
        localValue?: unknown;
        remoteValue?: unknown;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    status: "merged" | "conflict";
    conflicts?: {
        field: string;
        localTimestamp: string;
        remoteTimestamp: string;
        localValue?: unknown;
        remoteValue?: unknown;
    }[] | undefined;
    mergedNode?: Record<string, unknown> | undefined;
}, {
    status: "merged" | "conflict";
    conflicts?: {
        field: string;
        localTimestamp: string;
        remoteTimestamp: string;
        localValue?: unknown;
        remoteValue?: unknown;
    }[] | undefined;
    mergedNode?: Record<string, unknown> | undefined;
}>;
interface NSEStoredConflict {
    _schemaVersion: number;
    node_id: string;
    local_version: Record<string, unknown>;
    remote_version: Record<string, unknown>;
    conflicts: NSEConflictInfo[];
    created_at: string;
    expires_at: string;
}
declare const NSEStoredConflictSchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    node_id: z.ZodString;
    local_version: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    remote_version: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    conflicts: z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        localValue: z.ZodUnknown;
        remoteValue: z.ZodUnknown;
        localTimestamp: z.ZodString;
        remoteTimestamp: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        field: string;
        localTimestamp: string;
        remoteTimestamp: string;
        localValue?: unknown;
        remoteValue?: unknown;
    }, {
        field: string;
        localTimestamp: string;
        remoteTimestamp: string;
        localValue?: unknown;
        remoteValue?: unknown;
    }>, "many">;
    created_at: z.ZodString;
    expires_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    expires_at: string;
    conflicts: {
        field: string;
        localTimestamp: string;
        remoteTimestamp: string;
        localValue?: unknown;
        remoteValue?: unknown;
    }[];
    _schemaVersion: number;
    node_id: string;
    local_version: Record<string, unknown>;
    remote_version: Record<string, unknown>;
}, {
    created_at: string;
    expires_at: string;
    conflicts: {
        field: string;
        localTimestamp: string;
        remoteTimestamp: string;
        localValue?: unknown;
        remoteValue?: unknown;
    }[];
    _schemaVersion: number;
    node_id: string;
    local_version: Record<string, unknown>;
    remote_version: Record<string, unknown>;
}>;
interface NSEUserResolution {
    node_id: string;
    resolution: UserResolutionAction;
    field_choices?: Record<string, 'local' | 'remote'>;
    manual_values?: Record<string, unknown>;
    apply_to_similar: boolean;
}
declare const NSEUserResolutionSchema: z.ZodObject<{
    node_id: z.ZodString;
    resolution: z.ZodEnum<["keep_local", "keep_remote", "manual_merge"]>;
    field_choices: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodEnum<["local", "remote"]>>>;
    manual_values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    apply_to_similar: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    node_id: string;
    resolution: "keep_local" | "keep_remote" | "manual_merge";
    apply_to_similar: boolean;
    field_choices?: Record<string, "local" | "remote"> | undefined;
    manual_values?: Record<string, unknown> | undefined;
}, {
    node_id: string;
    resolution: "keep_local" | "keep_remote" | "manual_merge";
    apply_to_similar: boolean;
    field_choices?: Record<string, "local" | "remote"> | undefined;
    manual_values?: Record<string, unknown> | undefined;
}>;
interface ConflictHistoryEntry {
    _schemaVersion: number;
    node_id: string;
    rejected_version: Record<string, unknown>;
    resolved_at: string;
    resolved_by: NSEConflictResolver;
    expires_at: string;
}
declare const ConflictHistoryEntrySchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    node_id: z.ZodString;
    rejected_version: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    resolved_at: z.ZodString;
    resolved_by: z.ZodEnum<["user", "auto"]>;
    expires_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    expires_at: string;
    _schemaVersion: number;
    node_id: string;
    rejected_version: Record<string, unknown>;
    resolved_at: string;
    resolved_by: "user" | "auto";
}, {
    expires_at: string;
    _schemaVersion: number;
    node_id: string;
    rejected_version: Record<string, unknown>;
    resolved_at: string;
    resolved_by: "user" | "auto";
}>;
interface PushPayload {
    id: string;
    version: VersionVector;
    change_set: ChangeSet;
    data: Record<string, unknown>;
    content_checksum?: string;
}
declare const PushPayloadSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodRecord<z.ZodString, z.ZodNumber>;
    change_set: z.ZodObject<{
        node_id: z.ZodString;
        device_id: z.ZodString;
        timestamp: z.ZodString;
        changes: z.ZodArray<z.ZodObject<{
            field: z.ZodString;
            old_value: z.ZodUnknown;
            new_value: z.ZodUnknown;
        }, "strip", z.ZodTypeAny, {
            field: string;
            old_value?: unknown;
            new_value?: unknown;
        }, {
            field: string;
            old_value?: unknown;
            new_value?: unknown;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        timestamp: string;
        changes: {
            field: string;
            old_value?: unknown;
            new_value?: unknown;
        }[];
        device_id: string;
        node_id: string;
    }, {
        timestamp: string;
        changes: {
            field: string;
            old_value?: unknown;
            new_value?: unknown;
        }[];
        device_id: string;
        node_id: string;
    }>;
    data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    content_checksum: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    version: Record<string, number>;
    change_set: {
        timestamp: string;
        changes: {
            field: string;
            old_value?: unknown;
            new_value?: unknown;
        }[];
        device_id: string;
        node_id: string;
    };
    data: Record<string, unknown>;
    content_checksum?: string | undefined;
}, {
    id: string;
    version: Record<string, number>;
    change_set: {
        timestamp: string;
        changes: {
            field: string;
            old_value?: unknown;
            new_value?: unknown;
        }[];
        device_id: string;
        node_id: string;
    };
    data: Record<string, unknown>;
    content_checksum?: string | undefined;
}>;
interface PushResult {
    applied: Array<{
        id: string;
    }>;
    conflicts: Array<{
        id: string;
        remoteVersion: VersionVector;
    }>;
    error?: string;
}
declare const PushResultSchema: z.ZodObject<{
    applied: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>, "many">;
    conflicts: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        remoteVersion: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        remoteVersion: Record<string, number>;
    }, {
        id: string;
        remoteVersion: Record<string, number>;
    }>, "many">;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    conflicts: {
        id: string;
        remoteVersion: Record<string, number>;
    }[];
    applied: {
        id: string;
    }[];
    error?: string | undefined;
}, {
    conflicts: {
        id: string;
        remoteVersion: Record<string, number>;
    }[];
    applied: {
        id: string;
    }[];
    error?: string | undefined;
}>;
interface PullResult {
    applied: string[];
    conflicts: string[];
    error?: string;
}
declare const PullResultSchema: z.ZodObject<{
    applied: z.ZodArray<z.ZodString, "many">;
    conflicts: z.ZodArray<z.ZodString, "many">;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    conflicts: string[];
    applied: string[];
    error?: string | undefined;
}, {
    conflicts: string[];
    applied: string[];
    error?: string | undefined;
}>;
interface BatchSyncResponse {
    changes: PushPayload[];
    next_cursor: string | null;
    total_estimate: number;
    batch_number: number;
}
declare const BatchSyncResponseSchema: z.ZodObject<{
    changes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        version: z.ZodRecord<z.ZodString, z.ZodNumber>;
        change_set: z.ZodObject<{
            node_id: z.ZodString;
            device_id: z.ZodString;
            timestamp: z.ZodString;
            changes: z.ZodArray<z.ZodObject<{
                field: z.ZodString;
                old_value: z.ZodUnknown;
                new_value: z.ZodUnknown;
            }, "strip", z.ZodTypeAny, {
                field: string;
                old_value?: unknown;
                new_value?: unknown;
            }, {
                field: string;
                old_value?: unknown;
                new_value?: unknown;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            changes: {
                field: string;
                old_value?: unknown;
                new_value?: unknown;
            }[];
            device_id: string;
            node_id: string;
        }, {
            timestamp: string;
            changes: {
                field: string;
                old_value?: unknown;
                new_value?: unknown;
            }[];
            device_id: string;
            node_id: string;
        }>;
        data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        content_checksum: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        version: Record<string, number>;
        change_set: {
            timestamp: string;
            changes: {
                field: string;
                old_value?: unknown;
                new_value?: unknown;
            }[];
            device_id: string;
            node_id: string;
        };
        data: Record<string, unknown>;
        content_checksum?: string | undefined;
    }, {
        id: string;
        version: Record<string, number>;
        change_set: {
            timestamp: string;
            changes: {
                field: string;
                old_value?: unknown;
                new_value?: unknown;
            }[];
            device_id: string;
            node_id: string;
        };
        data: Record<string, unknown>;
        content_checksum?: string | undefined;
    }>, "many">;
    next_cursor: z.ZodNullable<z.ZodString>;
    total_estimate: z.ZodNumber;
    batch_number: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    changes: {
        id: string;
        version: Record<string, number>;
        change_set: {
            timestamp: string;
            changes: {
                field: string;
                old_value?: unknown;
                new_value?: unknown;
            }[];
            device_id: string;
            node_id: string;
        };
        data: Record<string, unknown>;
        content_checksum?: string | undefined;
    }[];
    next_cursor: string | null;
    total_estimate: number;
    batch_number: number;
}, {
    changes: {
        id: string;
        version: Record<string, number>;
        change_set: {
            timestamp: string;
            changes: {
                field: string;
                old_value?: unknown;
                new_value?: unknown;
            }[];
            device_id: string;
            node_id: string;
        };
        data: Record<string, unknown>;
        content_checksum?: string | undefined;
    }[];
    next_cursor: string | null;
    total_estimate: number;
    batch_number: number;
}>;
interface NSESyncProgress {
    processed: number;
    total: number;
    percent: number;
    batchNumber: number;
}
declare const NSESyncProgressSchema: z.ZodObject<{
    processed: z.ZodNumber;
    total: z.ZodNumber;
    percent: z.ZodNumber;
    batchNumber: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    processed: number;
    total: number;
    percent: number;
    batchNumber: number;
}, {
    processed: number;
    total: number;
    percent: number;
    batchNumber: number;
}>;
interface LastSyncedVersion {
    _schemaVersion: number;
    node_id: string;
    snapshot: Record<string, unknown>;
    synced_at: string;
}
declare const LastSyncedVersionSchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    node_id: z.ZodString;
    snapshot: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    synced_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    _schemaVersion: number;
    node_id: string;
    snapshot: Record<string, unknown>;
    synced_at: string;
}, {
    _schemaVersion: number;
    node_id: string;
    snapshot: Record<string, unknown>;
    synced_at: string;
}>;
interface PrivateTierPayload {
    id: string;
    version: VersionVector;
    content_checksum: string;
    encrypted_payload: string;
    nonce: string;
    last_modified_at: string;
}
declare const PrivateTierPayloadSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodRecord<z.ZodString, z.ZodNumber>;
    content_checksum: z.ZodString;
    encrypted_payload: z.ZodString;
    nonce: z.ZodString;
    last_modified_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    version: Record<string, number>;
    last_modified_at: string;
    content_checksum: string;
    encrypted_payload: string;
    nonce: string;
}, {
    id: string;
    version: Record<string, number>;
    last_modified_at: string;
    content_checksum: string;
    encrypted_payload: string;
    nonce: string;
}>;
interface PrivateTierConflict {
    node_id: string;
    local_checksum: string;
    remote_checksum: string;
    local_payload: string;
    remote_payload: string;
    detected_at: string;
}
declare const PrivateTierConflictSchema: z.ZodObject<{
    node_id: z.ZodString;
    local_checksum: z.ZodString;
    remote_checksum: z.ZodString;
    local_payload: z.ZodString;
    remote_payload: z.ZodString;
    detected_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    node_id: string;
    local_checksum: string;
    remote_checksum: string;
    local_payload: string;
    remote_payload: string;
    detected_at: string;
}, {
    node_id: string;
    local_checksum: string;
    remote_checksum: string;
    local_payload: string;
    remote_payload: string;
    detected_at: string;
}>;
interface ConflictNotification {
    node_id: string;
    conflict_count: number;
    fields: string[];
    created_at: string;
}
declare const ConflictNotificationSchema: z.ZodObject<{
    node_id: z.ZodString;
    conflict_count: z.ZodNumber;
    fields: z.ZodArray<z.ZodString, "many">;
    created_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    node_id: string;
    conflict_count: number;
    fields: string[];
}, {
    created_at: string;
    node_id: string;
    conflict_count: number;
    fields: string[];
}>;
interface NotificationAction {
    label: string;
    onClick: string;
}
declare const NotificationActionSchema: z.ZodObject<{
    label: z.ZodString;
    onClick: z.ZodString;
}, "strip", z.ZodTypeAny, {
    label: string;
    onClick: string;
}, {
    label: string;
    onClick: string;
}>;
interface BannerNotification {
    type: 'warning';
    message: string;
    actions: NotificationAction[];
    dismissible: boolean;
}
declare const BannerNotificationSchema: z.ZodObject<{
    type: z.ZodLiteral<"warning">;
    message: z.ZodString;
    actions: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        onClick: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        label: string;
        onClick: string;
    }, {
        label: string;
        onClick: string;
    }>, "many">;
    dismissible: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    message: string;
    type: "warning";
    actions: {
        label: string;
        onClick: string;
    }[];
    dismissible: boolean;
}, {
    message: string;
    type: "warning";
    actions: {
        label: string;
        onClick: string;
    }[];
    dismissible: boolean;
}>;
interface BadgeState {
    conflict_count: number;
    visible: boolean;
}
declare const BadgeStateSchema: z.ZodObject<{
    conflict_count: z.ZodNumber;
    visible: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    conflict_count: number;
    visible: boolean;
}, {
    conflict_count: number;
    visible: boolean;
}>;
interface BannerDismissState {
    dismissed_at: string;
    cooldown_expired: boolean;
}
declare const BannerDismissStateSchema: z.ZodObject<{
    dismissed_at: z.ZodString;
    cooldown_expired: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    dismissed_at: string;
    cooldown_expired: boolean;
}, {
    dismissed_at: string;
    cooldown_expired: boolean;
}>;
interface EmbeddingSync {
    vector: number[];
    model: string;
    model_version: string;
    generated_by: string;
    generated_at: string;
}
declare const EmbeddingSyncSchema: z.ZodObject<{
    vector: z.ZodArray<z.ZodNumber, "many">;
    model: z.ZodString;
    model_version: z.ZodString;
    generated_by: z.ZodString;
    generated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    vector: number[];
    model: string;
    model_version: string;
    generated_by: string;
    generated_at: string;
}, {
    vector: number[];
    model: string;
    model_version: string;
    generated_by: string;
    generated_at: string;
}>;
interface ReembeddingQueueEntry {
    _schemaVersion: number;
    node_id: string;
    reason: ReembeddingReason;
    from_model: string;
    to_model: string;
    queued_at: string;
}
declare const ReembeddingQueueEntrySchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    node_id: z.ZodString;
    reason: z.ZodEnum<["model_mismatch", "content_changed", "manual"]>;
    from_model: z.ZodString;
    to_model: z.ZodString;
    queued_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    _schemaVersion: number;
    node_id: string;
    reason: "manual" | "model_mismatch" | "content_changed";
    from_model: string;
    to_model: string;
    queued_at: string;
}, {
    _schemaVersion: number;
    node_id: string;
    reason: "manual" | "model_mismatch" | "content_changed";
    from_model: string;
    to_model: string;
    queued_at: string;
}>;
interface SchemaVersionError {
    min_version: string;
    upgrade_url: string;
    message: string;
}
declare const SchemaVersionErrorSchema: z.ZodObject<{
    min_version: z.ZodString;
    upgrade_url: z.ZodString;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
    min_version: string;
    upgrade_url: string;
}, {
    message: string;
    min_version: string;
    upgrade_url: string;
}>;
interface NSESyncLogEntry {
    _schemaVersion: number;
    type: SyncLogEntryType;
    node_id?: string;
    timestamp: string;
    message: string;
    device_id: string;
}
declare const NSESyncLogEntrySchema: z.ZodObject<{
    _schemaVersion: z.ZodNumber;
    type: z.ZodEnum<["resurrection", "conflict_resolved", "schema_mismatch", "recovery", "initial_sync"]>;
    node_id: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodString;
    message: z.ZodString;
    device_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
    type: "conflict_resolved" | "resurrection" | "schema_mismatch" | "recovery" | "initial_sync";
    timestamp: string;
    _schemaVersion: number;
    device_id: string;
    node_id?: string | undefined;
}, {
    message: string;
    type: "conflict_resolved" | "resurrection" | "schema_mismatch" | "recovery" | "initial_sync";
    timestamp: string;
    _schemaVersion: number;
    device_id: string;
    node_id?: string | undefined;
}>;
interface ServerSyncState {
    current_vector: VersionVector;
    node_count: number;
    schema_version: string;
}
declare const ServerSyncStateSchema: z.ZodObject<{
    current_vector: z.ZodRecord<z.ZodString, z.ZodNumber>;
    node_count: z.ZodNumber;
    schema_version: z.ZodString;
}, "strip", z.ZodTypeAny, {
    schema_version: string;
    current_vector: Record<string, number>;
    node_count: number;
}, {
    schema_version: string;
    current_vector: Record<string, number>;
    node_count: number;
}>;
declare function validateVersionVector(v: unknown): v is VersionVector;
declare function validateSyncMetadata(v: unknown): v is SyncMetadata;
declare function validateDeviceInfo(v: unknown): v is DeviceInfo;
declare function validateChangeSet(v: unknown): v is ChangeSet;
declare function validateNSEMergeResult(v: unknown): v is NSEMergeResult;
declare function validateNSEStoredConflict(v: unknown): v is NSEStoredConflict;
declare function validateNSEUserResolution(v: unknown): v is NSEUserResolution;
declare function validatePushPayload(v: unknown): v is PushPayload;
declare function validatePrivateTierPayload(v: unknown): v is PrivateTierPayload;
declare function validateNSESyncLogEntry(v: unknown): v is NSESyncLogEntry;

/**
 * @module @nous/core/sync/nse-engine
 * @description Nous Sync Engine (NSE) v1 — Core functions
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-033
 * @storm Brainstorms/Infrastructure/storm-033-sync-conflict-resolution
 *
 * Pure function implementations for:
 * - Version vector operations (compare, merge, increment, compact)
 * - Change set computation
 * - Merge strategy application
 * - Auto-merge algorithm
 * - Private tier conflict detection
 * - Utility functions
 *
 * @see storm-033 v1 revision
 */

/**
 * Compare two version vectors for causality.
 * Excludes _inactive key from comparison.
 *
 * @see storm-033 v1 revision Section 1
 */
declare function compareVectors(a: VersionVector, b: VersionVector): VersionComparison;
/**
 * Merge two version vectors by taking component-wise maximum.
 */
declare function mergeVectors(a: VersionVector, b: VersionVector): VersionVector;
/**
 * Increment the version vector for a local write.
 */
declare function incrementVector(vector: VersionVector, deviceId: string): VersionVector;
/**
 * Compact a version vector by merging inactive device counters.
 */
declare function compactVector(vector: VersionVector, deviceLastActive: Map<string, Date>): VersionVector;
/**
 * Generate a device ID with platform prefix.
 */
declare function generateDeviceId(platform: NSEPlatform): string;
/**
 * Update clock drift using exponential moving average.
 */
declare function updateClockDrift(currentDrift: number, newSample: number): number;
/**
 * Adjust a local timestamp by the tracked clock drift.
 */
declare function adjustedTimestamp(localTime: Date, driftMs: number): Date;
/**
 * Get a nested value from an object using dot-path notation.
 */
declare function getNestedValue(obj: Record<string, unknown>, fieldPath: string): unknown;
/**
 * Set a nested value on an object using dot-path notation.
 */
declare function setNestedValue(obj: Record<string, unknown>, fieldPath: string, value: unknown): void;
/**
 * Deep equality check for comparing field values.
 */
declare function deepEqual(a: unknown, b: unknown): boolean;
/**
 * Compute a change set by comparing base (last synced) to current.
 */
declare function computeChangeSet(base: Record<string, unknown> | null, current: Record<string, unknown>, deviceId: string): ChangeSet;
/**
 * Get the merge strategy for a given field path.
 */
declare function getFieldMergeStrategy(fieldPath: string): NSEMergeStrategy;
/**
 * Apply a merge strategy to two conflicting field values.
 *
 * @param localOldVal - Base value from local change set (needed for delta-based strategies like 'sum')
 * @param remoteOldVal - Base value from remote change set (needed for delta-based strategies like 'sum')
 *
 * @see storm-033 v1 revision Section 5 - Merge Strategy Table
 */
declare function applyStrategy(strategy: NSEMergeStrategy, localVal: unknown, remoteVal: unknown, localTime: string, remoteTime: string, localOldVal?: unknown, remoteOldVal?: unknown): StrategyResult;
/**
 * Special handler for cluster membership merge.
 */
declare function mergeMemberships(local: ClusterMembershipForMerge[], remote: ClusterMembershipForMerge[]): ClusterMembershipForMerge[];
/**
 * Attempt auto-merge of two concurrent node versions.
 *
 * Algorithm:
 * 1. Build maps of local and remote changes
 * 2. For each remote change, check if local also changed that field
 * 3. If only remote changed → apply remote value
 * 4. If both changed → apply field-level merge strategy
 * 5. Collect any unresolvable conflicts
 * 6. Return merged node (with non-conflicting fields applied) + any conflicts
 *
 * When status is 'conflict', mergedNode contains the partially merged state
 * (all non-conflicting fields applied). The caller can store both versions
 * for user resolution of conflicting fields only.
 *
 * @see storm-033 v1 revision Section 6
 */
declare function nseAutoMerge(local: Record<string, unknown>, _remote: Record<string, unknown>, localChangeSet: ChangeSet, remoteChangeSet: ChangeSet): NSEMergeResult;
/**
 * Detect conflict for Private tier using checksums.
 * Returns true if conflict detected (checksums differ).
 */
declare function detectPrivateTierConflict(local: PrivateTierPayload, remote: PrivateTierPayload): boolean;
/**
 * Creates initial sync metadata for a new node.
 */
declare function createSyncMetadata(deviceId: string, status?: 'synced' | 'pending' | 'conflict'): SyncMetadata;
/**
 * Creates initial device info.
 */
declare function createDeviceInfo(platform: NSEPlatform, schemaVersion?: string): DeviceInfo;
/**
 * Get default display name for a device platform.
 */
declare function getDefaultDeviceName(platform: NSEPlatform): string;
/**
 * Create badge state from conflict count.
 */
declare function createBadgeState(conflictCount: number): BadgeState;
/**
 * Creates a stored conflict record.
 */
declare function createStoredConflict(nodeId: string, local: Record<string, unknown>, remote: Record<string, unknown>, conflicts: NSEConflictInfo[]): NSEStoredConflict;
/**
 * Creates a conflict history entry for the rejected version.
 */
declare function createConflictHistoryEntry(nodeId: string, rejectedVersion: Record<string, unknown>, resolvedBy: 'user' | 'auto'): ConflictHistoryEntry;
/**
 * Check if an embedding model matches the current model.
 */
declare function isEmbeddingCompatible(nodeModel: string, currentModel: string): boolean;

export { type AnySyncEvent, type AutoMergeResult, BANNER_DISMISS_COOLDOWN_MS, type BadgeState, BadgeStateSchema, type BannerDismissState, BannerDismissStateSchema, type BannerNotification, BannerNotificationSchema, type BatchSyncResponse, BatchSyncResponseSchema, CLOCK_DRIFT_EMA_WEIGHT, CONFLICT_HISTORY_RETENTION_DAYS, CONFLICT_RESOLUTION_CHOICES, CONFLICT_STRENGTHS, type ChangeSet, ChangeSetSchema, type ClockSync, ClockSyncSchema, type ClusterMembershipForMerge, ClusterMembershipForMergeSchema, type ConflictDetectedEvent, type ConflictHistoryEntry, ConflictHistoryEntrySchema, type ConflictInfo, type ConflictNotification, ConflictNotificationSchema, type ConflictResolution, type ConflictResolutionChoice, ConflictResolutionSchema, type ConflictResolver, type ConflictStrength, DEFAULT_LOCK_DURATION_SECONDS, DEVICE_INACTIVE_DAYS, type DebugReport, type DetectedConflict, DetectedConflictSchema, type DeviceInfo, DeviceInfoSchema, type EmbeddingSync, EmbeddingSyncSchema, FIELD_CATEGORIES, FIELD_CATEGORY_MAP, FIELD_MERGE_STRATEGIES, type FieldCategory, type FieldChange, FieldChangeSchema, type FieldMergeResult, HEALTH_STATUSES, HEALTH_THRESHOLDS, HTTP_UPGRADE_REQUIRED, type HealthAssessment, HealthAssessmentSchema, type HealthCheck, type HealthMetrics, HealthMetricsSchema, type HealthMonitor, type HealthStatus, type LastSyncedVersion, LastSyncedVersionSchema, MERGE_RESULT_STATUSES, MERGE_STRATEGIES, type MergeResultStatus, MergeResultStatusSchema, type MergeStrategy, NODE_SYNC_STATUSES, NOTIFICATION_TIERS, type NSEConflictInfo, NSEConflictInfoSchema, type NSEConflictResolver, NSEConflictResolverSchema, type NSEMergeResult, NSEMergeResultSchema, type NSEMergeStrategy, NSEMergeStrategySchema, type NSEPlatform, NSEPlatformSchema, type NSEStoredConflict, NSEStoredConflictSchema, type NSESyncLogEntry, NSESyncLogEntrySchema, type NSESyncProgress, NSESyncProgressSchema, type NSEUserResolution, NSEUserResolutionSchema, NSE_CONFLICT_RESOLVERS, NSE_FIELD_MERGE_STRATEGIES, NSE_MERGE_STRATEGIES, NSE_PLATFORMS, NSE_SYNC_BATCH_SIZE, NSE_SYNC_LOCK_TIMEOUT_SECONDS, type NodeSyncStatus, NodeSyncStatusSchema, type NotificationAction, NotificationActionSchema, type NotificationTier, NotificationTierSchema, type PrivateTierConflict, PrivateTierConflictSchema, type PrivateTierPayload, PrivateTierPayloadSchema, type PullResult, PullResultSchema, type PushPayload, PushPayloadSchema, type PushResult, PushResultSchema, REEMBEDDING_REASONS, RESOLUTION_ACTIONS, type ReembeddingQueueEntry, ReembeddingQueueEntrySchema, type ReembeddingReason, ReembeddingReasonSchema, type ResolutionAction, SYNCABLE_FIELDS, SYNC_EVENT_TYPES, SYNC_HEADER_DEVICE_ID, SYNC_HEADER_SCHEMA_VERSION, SYNC_HEADER_SERVER_TIME, SYNC_LOG_ENTRY_TYPES, SYNC_STATUSES, type SchemaVersionError, SchemaVersionErrorSchema, type ServerSyncState, ServerSyncStateSchema, type StrategyResult, StrategyResultSchema, type SyncCompletedEvent, type SyncEvent, type SyncEventHandler, type SyncEventType, type SyncFailedEvent, type SyncLock, SyncLockSchema, type SyncLogEntry, type SyncLogEntryType, SyncLogEntryTypeSchema, type SyncManager, type SyncManagerOptions, SyncManagerOptionsSchema, type SyncMetadata, SyncMetadataSchema, type SyncProgressEvent, SyncResult, type SyncStartedEvent, type SyncState, SyncStateSchema, type SyncStatus, type SyncableField, SyncableFieldSchema, UI_YIELD_DELAY_MS, USER_RESOLUTION_ACTIONS, type UserResolutionAction, UserResolutionActionSchema, VECTOR_COMPACTION_THRESHOLD, VERSION_COMPARISON_RESULTS, VERSION_VECTOR_INACTIVE_KEY, type VersionComparison, VersionComparisonSchema, type VersionVector, VersionVectorSchema, adjustedTimestamp, applyMergeStrategy, applyStrategy, assessHealth, attemptAutoMerge, canAutoResolveConflict, classifyConflictStrength, compactVector, compareVectors, computeChangeSet, createBadgeState, createConflictHistoryEntry, createDefaultSyncManagerOptions, createDeviceInfo, createEmptyHealthMetrics, createInitialSyncState, createStoredConflict, createSyncLock, createSyncMetadata, deepEqual, detectPrivateTierConflict, generateDebugReport, generateDeviceId, getDefaultDeviceName, getFieldCategories, getFieldCategory, getFieldMergeStrategy, getMergeStrategy, getNestedValue, incrementVector, isEmbeddingCompatible, isNSEMergeStrategy, isNSEPlatform, isNodeSyncStatus, isSyncLockExpired, isSyncLockValid, isVersionComparison, mergeMemberships, mergeVectors, nseAutoMerge, setNestedValue, updateClockDrift, validateChangeSet, validateConflictResolution, validateDetectedConflict, validateDeviceInfo, validateHealthAssessment, validateHealthMetrics, validateNSEMergeResult, validateNSEStoredConflict, validateNSESyncLogEntry, validateNSEUserResolution, validatePrivateTierPayload, validatePushPayload, validateSyncLock, validateSyncManagerOptions, validateSyncMetadata, validateSyncState, validateVersionVector };
