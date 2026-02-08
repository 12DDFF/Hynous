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

import { z } from 'zod';

// ============================================================
// HEALTH STATUS
// ============================================================

/**
 * Health status levels.
 */
export const HEALTH_STATUSES = ['healthy', 'warning', 'error'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/**
 * Health check thresholds.
 */
export const HEALTH_THRESHOLDS = {
  /** Max time since last sync before warning (seconds) */
  syncWarningSeconds: 3600, // 1 hour

  /** Max time since last sync before error (seconds) */
  syncErrorSeconds: 86400, // 24 hours

  /** Max pending changes before warning */
  pendingWarningCount: 10,

  /** Max sync errors in 24h before error status */
  errorThreshold24h: 5,

  /** Max conflicts before warning */
  conflictWarningCount: 1,
} as const;

// ============================================================
// HEALTH METRICS
// ============================================================

/**
 * Health metrics collected locally.
 */
export interface HealthMetrics {
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

export const HealthMetricsSchema = z.object({
  lastSuccessfulSync: z.number().nullable(),
  syncErrors24h: z.number().int().min(0),
  pendingChanges: z.number().int().min(0),
  unresolvedConflicts: z.number().int().min(0),
  databaseSizeBytes: z.number().int().min(0),
  nodeCount: z.number().int().min(0),
  edgeCount: z.number().int().min(0),
  appVersion: z.string(),
  updatedAt: z.number(),
});

/**
 * Creates empty health metrics.
 */
export function createEmptyHealthMetrics(appVersion: string): HealthMetrics {
  return {
    lastSuccessfulSync: null,
    syncErrors24h: 0,
    pendingChanges: 0,
    unresolvedConflicts: 0,
    databaseSizeBytes: 0,
    nodeCount: 0,
    edgeCount: 0,
    appVersion,
    updatedAt: Date.now(),
  };
}

// ============================================================
// HEALTH ASSESSMENT
// ============================================================

/**
 * Health assessment result.
 */
export interface HealthAssessment {
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

export const HealthAssessmentSchema = z.object({
  status: z.enum(HEALTH_STATUSES),
  label: z.string(),
  message: z.string(),
  checks: z.array(z.any()),
  issues: z.array(z.string()),
  recommendations: z.array(z.string()),
  assessedAt: z.string().datetime(),
});

/**
 * Individual health check.
 */
export interface HealthCheck {
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

// ============================================================
// HEALTH CHECK FUNCTIONS
// ============================================================

/**
 * Checks sync recency.
 */
function checkSyncRecency(metrics: HealthMetrics): HealthCheck {
  if (metrics.lastSuccessfulSync === null) {
    return {
      name: 'sync_recency',
      status: 'warning',
      message: 'Never synced',
    };
  }

  const secondsSinceSync = (Date.now() - metrics.lastSuccessfulSync) / 1000;

  if (secondsSinceSync > HEALTH_THRESHOLDS.syncErrorSeconds) {
    return {
      name: 'sync_recency',
      status: 'error',
      message: 'Last sync over 24 hours ago',
      value: secondsSinceSync,
      threshold: HEALTH_THRESHOLDS.syncErrorSeconds,
    };
  }

  if (secondsSinceSync > HEALTH_THRESHOLDS.syncWarningSeconds) {
    return {
      name: 'sync_recency',
      status: 'warning',
      message: 'Last sync over 1 hour ago',
      value: secondsSinceSync,
      threshold: HEALTH_THRESHOLDS.syncWarningSeconds,
    };
  }

  return {
    name: 'sync_recency',
    status: 'healthy',
    message: 'Recently synced',
    value: secondsSinceSync,
  };
}

/**
 * Checks sync error count.
 */
function checkSyncErrors(metrics: HealthMetrics): HealthCheck {
  if (metrics.syncErrors24h >= HEALTH_THRESHOLDS.errorThreshold24h) {
    return {
      name: 'sync_errors',
      status: 'error',
      message: `${metrics.syncErrors24h} sync errors in 24h`,
      value: metrics.syncErrors24h,
      threshold: HEALTH_THRESHOLDS.errorThreshold24h,
    };
  }

  if (metrics.syncErrors24h > 0) {
    return {
      name: 'sync_errors',
      status: 'warning',
      message: `${metrics.syncErrors24h} sync error${metrics.syncErrors24h > 1 ? 's' : ''} in 24h`,
      value: metrics.syncErrors24h,
    };
  }

  return {
    name: 'sync_errors',
    status: 'healthy',
    message: 'No sync errors',
    value: 0,
  };
}

/**
 * Checks pending changes count.
 */
function checkPendingChanges(metrics: HealthMetrics): HealthCheck {
  if (metrics.pendingChanges > HEALTH_THRESHOLDS.pendingWarningCount) {
    return {
      name: 'pending_changes',
      status: 'warning',
      message: `${metrics.pendingChanges} changes pending sync`,
      value: metrics.pendingChanges,
      threshold: HEALTH_THRESHOLDS.pendingWarningCount,
    };
  }

  return {
    name: 'pending_changes',
    status: 'healthy',
    message:
      metrics.pendingChanges > 0
        ? `${metrics.pendingChanges} changes pending`
        : 'All synced',
    value: metrics.pendingChanges,
  };
}

/**
 * Checks conflict count.
 */
function checkConflicts(metrics: HealthMetrics): HealthCheck {
  if (metrics.unresolvedConflicts >= HEALTH_THRESHOLDS.conflictWarningCount) {
    return {
      name: 'conflicts',
      status: 'warning',
      message: `${metrics.unresolvedConflicts} unresolved conflict${metrics.unresolvedConflicts > 1 ? 's' : ''}`,
      value: metrics.unresolvedConflicts,
      threshold: HEALTH_THRESHOLDS.conflictWarningCount,
    };
  }

  return {
    name: 'conflicts',
    status: 'healthy',
    message: 'No conflicts',
    value: 0,
  };
}

// ============================================================
// HEALTH ASSESSMENT LOGIC
// ============================================================

/**
 * Assesses health status from metrics.
 *
 * @param metrics - Current health metrics
 * @returns Health assessment
 */
export function assessHealth(metrics: HealthMetrics): HealthAssessment {
  const checks: HealthCheck[] = [];
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check 1: Sync recency
  const syncCheck = checkSyncRecency(metrics);
  checks.push(syncCheck);
  if (syncCheck.status !== 'healthy') {
    issues.push(syncCheck.message);
    recommendations.push(
      'Check your internet connection and try syncing manually.'
    );
  }

  // Check 2: Sync errors
  const errorCheck = checkSyncErrors(metrics);
  checks.push(errorCheck);
  if (errorCheck.status !== 'healthy') {
    issues.push(errorCheck.message);
    recommendations.push(
      'Review sync error logs. You may need to resolve conflicts.'
    );
  }

  // Check 3: Pending changes
  const pendingCheck = checkPendingChanges(metrics);
  checks.push(pendingCheck);
  if (pendingCheck.status !== 'healthy') {
    issues.push(pendingCheck.message);
    recommendations.push('Connect to sync your pending changes.');
  }

  // Check 4: Conflicts
  const conflictCheck = checkConflicts(metrics);
  checks.push(conflictCheck);
  if (conflictCheck.status !== 'healthy') {
    issues.push(conflictCheck.message);
    recommendations.push('Review and resolve sync conflicts.');
  }

  // Determine overall status
  const hasError = checks.some((c) => c.status === 'error');
  const hasWarning = checks.some((c) => c.status === 'warning');

  let status: HealthStatus;
  let label: string;
  let message: string;

  if (hasError) {
    status = 'error';
    label = 'Sync issue';
    message = `${issues.length} issue${issues.length > 1 ? 's' : ''} detected`;
  } else if (hasWarning) {
    status = 'warning';
    label = 'Sync delayed';
    message = 'Some items may not be synced';
  } else {
    status = 'healthy';
    label = 'Everything OK';
    message = 'All systems operational';
  }

  return {
    status,
    label,
    message,
    checks,
    issues,
    recommendations,
    assessedAt: new Date().toISOString(),
  };
}

// ============================================================
// DEBUG REPORT
// ============================================================

/**
 * Sync log entry.
 */
export interface SyncLogEntry {
  timestamp: string;
  event: string;
  success: boolean;
  details?: string;
}

/**
 * Debug report for troubleshooting.
 */
export interface DebugReport {
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
export function generateDebugReport(
  metrics: HealthMetrics,
  deviceInfo: DebugReport['device'],
  syncLogs: SyncLogEntry[],
  dbStats: DebugReport['databaseStats']
): DebugReport {
  return {
    generatedAt: new Date().toISOString(),
    metrics,
    assessment: assessHealth(metrics),
    device: deviceInfo,
    recentSyncLogs: syncLogs.slice(0, 20), // Last 20 entries
    databaseStats: dbStats,
  };
}

// ============================================================
// HEALTH MONITOR INTERFACE
// ============================================================

/**
 * Health monitor interface.
 */
export interface HealthMonitor {
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

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validates health metrics.
 */
export function validateHealthMetrics(
  metrics: unknown
): metrics is HealthMetrics {
  return HealthMetricsSchema.safeParse(metrics).success;
}

/**
 * Validates a health assessment.
 */
export function validateHealthAssessment(
  assessment: unknown
): assessment is HealthAssessment {
  return HealthAssessmentSchema.safeParse(assessment).success;
}
