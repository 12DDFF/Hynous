import { z } from 'zod';
import { nanoid } from 'nanoid';

// src/sync/sync-manager.ts
var SYNC_STATUSES = [
  "idle",
  "syncing",
  "paused",
  "error",
  "offline"
];
var SyncStateSchema = z.object({
  status: z.enum(SYNC_STATUSES),
  lastSyncAt: z.string().datetime().nullable(),
  lastAttemptAt: z.string().datetime().nullable(),
  pendingChanges: z.number().int().min(0),
  unresolvedConflicts: z.number().int().min(0),
  progress: z.number().min(0).max(100),
  errorMessage: z.string().nullable(),
  failedAttempts: z.number().int().min(0),
  nextSyncAt: z.string().datetime().nullable()
});
function createInitialSyncState() {
  return {
    status: "idle",
    lastSyncAt: null,
    lastAttemptAt: null,
    pendingChanges: 0,
    unresolvedConflicts: 0,
    progress: 0,
    errorMessage: null,
    failedAttempts: 0,
    nextSyncAt: null
  };
}
var SYNC_EVENT_TYPES = [
  "sync_started",
  "sync_progress",
  "sync_completed",
  "sync_failed",
  "conflict_detected",
  "conflict_resolved",
  "offline",
  "online"
];
var CONFLICT_RESOLUTION_CHOICES = [
  "keep_local",
  "keep_cloud",
  "keep_both",
  "merge"
];
var SyncManagerOptionsSchema = z.object({
  minIntervalMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0),
  retryDelayMs: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  autoSync: z.boolean(),
  wifiOnly: z.boolean(),
  chargingOnly: z.boolean(),
  backgroundSync: z.boolean()
});
function createDefaultSyncManagerOptions() {
  return {
    minIntervalMs: 6e4,
    // 1 minute
    maxRetries: 3,
    retryDelayMs: 1e3,
    batchSize: 100,
    autoSync: true,
    wifiOnly: false,
    chargingOnly: false,
    backgroundSync: true
  };
}
var SyncLockSchema = z.object({
  deviceId: z.string().min(1),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime()
});
var DEFAULT_LOCK_DURATION_SECONDS = 30;
function createSyncLock(deviceId, durationSeconds = DEFAULT_LOCK_DURATION_SECONDS) {
  const now = /* @__PURE__ */ new Date();
  const expires = new Date(now.getTime() + durationSeconds * 1e3);
  return {
    deviceId,
    acquiredAt: now.toISOString(),
    expiresAt: expires.toISOString()
  };
}
function isSyncLockValid(lock) {
  return new Date(lock.expiresAt).getTime() > Date.now();
}
function isSyncLockExpired(lock) {
  return !isSyncLockValid(lock);
}
function validateSyncState(state) {
  return SyncStateSchema.safeParse(state).success;
}
function validateSyncManagerOptions(options) {
  return SyncManagerOptionsSchema.safeParse(options).success;
}
function validateSyncLock(lock) {
  return SyncLockSchema.safeParse(lock).success;
}
var CONFLICT_STRENGTHS = ["weak", "strong"];
var FIELD_CATEGORIES = [
  "content",
  // Main content (body, title)
  "metadata",
  // Access counts, timestamps
  "neural",
  // Neural properties
  "structural",
  // Type, lifecycle
  "versioning"
  // Version numbers
];
var FIELD_CATEGORY_MAP = {
  // Content fields - strong conflicts
  content_title: "content",
  content_body: "content",
  content_summary: "content",
  content_blocks: "content",
  // Metadata fields - weak conflicts, merge additively
  neural_access_count: "metadata",
  neural_last_accessed: "metadata",
  // Neural fields - weak conflicts, take max
  neural_stability: "neural",
  neural_retrievability: "neural",
  // Structural fields - strong conflicts
  type: "structural",
  subtype: "structural",
  state_lifecycle: "structural",
  state_extraction_depth: "structural",
  // Versioning - handled specially
  version: "versioning",
  last_modified: "versioning",
  last_modifier: "versioning"
};
var DetectedConflictSchema = z.object({
  nodeId: z.string().min(1),
  strength: z.enum(CONFLICT_STRENGTHS),
  localVersion: z.number().int().positive(),
  cloudVersion: z.number().int().positive(),
  baseVersion: z.number().int().positive(),
  localModifiedAt: z.string().datetime(),
  cloudModifiedAt: z.string().datetime(),
  fieldsInConflict: z.array(z.string()),
  conflictCategories: z.array(z.enum(FIELD_CATEGORIES)),
  canAutoResolve: z.boolean(),
  suggestedResolution: z.any().optional()
});
function getFieldCategory(fieldName) {
  return FIELD_CATEGORY_MAP[fieldName] ?? "content";
}
function getFieldCategories(fieldNames) {
  const categories = new Set(fieldNames.map(getFieldCategory));
  return Array.from(categories);
}
function classifyConflictStrength(localChanges, cloudChanges) {
  const overlap = localChanges.filter((f) => cloudChanges.includes(f));
  if (overlap.length === 0) {
    return "weak";
  }
  const overlapCategories = overlap.map(getFieldCategory);
  const hasNonMetadataOverlap = overlapCategories.some(
    (cat) => cat !== "metadata" && cat !== "neural"
  );
  if (hasNonMetadataOverlap) {
    return "strong";
  }
  return "weak";
}
function canAutoResolveConflict(conflict) {
  if (conflict.strength === "strong") {
    return false;
  }
  const hasContentConflict = conflict.conflictCategories.some(
    (cat) => cat === "content" || cat === "structural"
  );
  return !hasContentConflict;
}
var RESOLUTION_ACTIONS = [
  "keep_local",
  "keep_cloud",
  "keep_both",
  "merge_fields",
  "custom"
];
var ConflictResolutionSchema = z.object({
  action: z.enum(RESOLUTION_ACTIONS),
  fieldResolutions: z.record(z.enum(["local", "cloud"])).optional(),
  resolvedVersion: z.number().int().positive(),
  resolvedAt: z.string().datetime(),
  resolvedBy: z.enum(["user", "auto"]),
  notes: z.string().optional()
});
var MERGE_STRATEGIES = [
  "take_local",
  "take_cloud",
  "take_latest",
  "take_max",
  "take_min",
  "sum",
  "concatenate",
  "user_choice"
];
var FIELD_MERGE_STRATEGIES = {
  // Content - user must choose
  content_title: "user_choice",
  content_body: "user_choice",
  content_summary: "user_choice",
  content_blocks: "user_choice",
  // Metadata - automatic merge
  neural_access_count: "sum",
  neural_last_accessed: "take_latest",
  // Neural - take max (higher stability/retrievability preserved)
  neural_stability: "take_max",
  neural_retrievability: "take_max",
  // Structural - user must choose
  type: "user_choice",
  subtype: "user_choice",
  state_lifecycle: "take_latest",
  state_extraction_depth: "user_choice",
  // Provenance
  provenance_confidence: "take_max"
};
function getMergeStrategy(fieldName) {
  return FIELD_MERGE_STRATEGIES[fieldName] ?? "user_choice";
}
function applyMergeStrategy(strategy, localValue, cloudValue, localTimestamp, cloudTimestamp) {
  switch (strategy) {
    case "take_local":
      return { value: localValue, source: "local" };
    case "take_cloud":
      return { value: cloudValue, source: "cloud" };
    case "take_latest":
      if (new Date(localTimestamp) >= new Date(cloudTimestamp)) {
        return { value: localValue, source: "local" };
      }
      return { value: cloudValue, source: "cloud" };
    case "take_max":
      if (typeof localValue === "number" && typeof cloudValue === "number") {
        return localValue >= cloudValue ? { value: localValue, source: "local" } : { value: cloudValue, source: "cloud" };
      }
      return { value: localValue, source: "local" };
    case "take_min":
      if (typeof localValue === "number" && typeof cloudValue === "number") {
        return localValue <= cloudValue ? { value: localValue, source: "local" } : { value: cloudValue, source: "cloud" };
      }
      return { value: localValue, source: "local" };
    case "sum":
      if (typeof localValue === "number" && typeof cloudValue === "number") {
        return { value: Math.max(localValue, cloudValue), source: "merged" };
      }
      return { value: localValue, source: "local" };
    case "concatenate":
      if (Array.isArray(localValue) && Array.isArray(cloudValue)) {
        const merged = [...localValue];
        for (const item of cloudValue) {
          const itemWithId = item;
          if (!merged.some(
            (m) => m.id === itemWithId.id
          )) {
            merged.push(item);
          }
        }
        return { value: merged, source: "merged" };
      }
      return { value: localValue, source: "local" };
    case "user_choice":
    default:
      throw new Error(`Field requires user choice: ${strategy}`);
  }
}
function attemptAutoMerge(localData, cloudData, fieldsInConflict, localTimestamp, cloudTimestamp, baseVersion) {
  const mergedFields = [];
  const unmergeableFields = [];
  for (const field of fieldsInConflict) {
    const strategy = getMergeStrategy(field);
    if (strategy === "user_choice") {
      unmergeableFields.push(field);
      continue;
    }
    try {
      const result = applyMergeStrategy(
        strategy,
        localData[field],
        cloudData[field],
        localTimestamp,
        cloudTimestamp
      );
      mergedFields.push({
        fieldName: field,
        strategy,
        resolvedValue: result.value,
        source: result.source
      });
    } catch {
      unmergeableFields.push(field);
    }
  }
  return {
    success: unmergeableFields.length === 0,
    mergedFields,
    unmergeableFields,
    resultVersion: baseVersion + 1
  };
}
function validateDetectedConflict(conflict) {
  return DetectedConflictSchema.safeParse(conflict).success;
}
function validateConflictResolution(resolution) {
  return ConflictResolutionSchema.safeParse(resolution).success;
}
var HEALTH_STATUSES = ["healthy", "warning", "error"];
var HEALTH_THRESHOLDS = {
  /** Max time since last sync before warning (seconds) */
  syncWarningSeconds: 3600,
  // 1 hour
  /** Max time since last sync before error (seconds) */
  syncErrorSeconds: 86400,
  // 24 hours
  /** Max pending changes before warning */
  pendingWarningCount: 10,
  /** Max sync errors in 24h before error status */
  errorThreshold24h: 5,
  /** Max conflicts before warning */
  conflictWarningCount: 1
};
var HealthMetricsSchema = z.object({
  lastSuccessfulSync: z.number().nullable(),
  syncErrors24h: z.number().int().min(0),
  pendingChanges: z.number().int().min(0),
  unresolvedConflicts: z.number().int().min(0),
  databaseSizeBytes: z.number().int().min(0),
  nodeCount: z.number().int().min(0),
  edgeCount: z.number().int().min(0),
  appVersion: z.string(),
  updatedAt: z.number()
});
function createEmptyHealthMetrics(appVersion) {
  return {
    lastSuccessfulSync: null,
    syncErrors24h: 0,
    pendingChanges: 0,
    unresolvedConflicts: 0,
    databaseSizeBytes: 0,
    nodeCount: 0,
    edgeCount: 0,
    appVersion,
    updatedAt: Date.now()
  };
}
var HealthAssessmentSchema = z.object({
  status: z.enum(HEALTH_STATUSES),
  label: z.string(),
  message: z.string(),
  checks: z.array(z.any()),
  issues: z.array(z.string()),
  recommendations: z.array(z.string()),
  assessedAt: z.string().datetime()
});
function checkSyncRecency(metrics) {
  if (metrics.lastSuccessfulSync === null) {
    return {
      name: "sync_recency",
      status: "warning",
      message: "Never synced"
    };
  }
  const secondsSinceSync = (Date.now() - metrics.lastSuccessfulSync) / 1e3;
  if (secondsSinceSync > HEALTH_THRESHOLDS.syncErrorSeconds) {
    return {
      name: "sync_recency",
      status: "error",
      message: "Last sync over 24 hours ago",
      value: secondsSinceSync,
      threshold: HEALTH_THRESHOLDS.syncErrorSeconds
    };
  }
  if (secondsSinceSync > HEALTH_THRESHOLDS.syncWarningSeconds) {
    return {
      name: "sync_recency",
      status: "warning",
      message: "Last sync over 1 hour ago",
      value: secondsSinceSync,
      threshold: HEALTH_THRESHOLDS.syncWarningSeconds
    };
  }
  return {
    name: "sync_recency",
    status: "healthy",
    message: "Recently synced",
    value: secondsSinceSync
  };
}
function checkSyncErrors(metrics) {
  if (metrics.syncErrors24h >= HEALTH_THRESHOLDS.errorThreshold24h) {
    return {
      name: "sync_errors",
      status: "error",
      message: `${metrics.syncErrors24h} sync errors in 24h`,
      value: metrics.syncErrors24h,
      threshold: HEALTH_THRESHOLDS.errorThreshold24h
    };
  }
  if (metrics.syncErrors24h > 0) {
    return {
      name: "sync_errors",
      status: "warning",
      message: `${metrics.syncErrors24h} sync error${metrics.syncErrors24h > 1 ? "s" : ""} in 24h`,
      value: metrics.syncErrors24h
    };
  }
  return {
    name: "sync_errors",
    status: "healthy",
    message: "No sync errors",
    value: 0
  };
}
function checkPendingChanges(metrics) {
  if (metrics.pendingChanges > HEALTH_THRESHOLDS.pendingWarningCount) {
    return {
      name: "pending_changes",
      status: "warning",
      message: `${metrics.pendingChanges} changes pending sync`,
      value: metrics.pendingChanges,
      threshold: HEALTH_THRESHOLDS.pendingWarningCount
    };
  }
  return {
    name: "pending_changes",
    status: "healthy",
    message: metrics.pendingChanges > 0 ? `${metrics.pendingChanges} changes pending` : "All synced",
    value: metrics.pendingChanges
  };
}
function checkConflicts(metrics) {
  if (metrics.unresolvedConflicts >= HEALTH_THRESHOLDS.conflictWarningCount) {
    return {
      name: "conflicts",
      status: "warning",
      message: `${metrics.unresolvedConflicts} unresolved conflict${metrics.unresolvedConflicts > 1 ? "s" : ""}`,
      value: metrics.unresolvedConflicts,
      threshold: HEALTH_THRESHOLDS.conflictWarningCount
    };
  }
  return {
    name: "conflicts",
    status: "healthy",
    message: "No conflicts",
    value: 0
  };
}
function assessHealth(metrics) {
  const checks = [];
  const issues = [];
  const recommendations = [];
  const syncCheck = checkSyncRecency(metrics);
  checks.push(syncCheck);
  if (syncCheck.status !== "healthy") {
    issues.push(syncCheck.message);
    recommendations.push(
      "Check your internet connection and try syncing manually."
    );
  }
  const errorCheck = checkSyncErrors(metrics);
  checks.push(errorCheck);
  if (errorCheck.status !== "healthy") {
    issues.push(errorCheck.message);
    recommendations.push(
      "Review sync error logs. You may need to resolve conflicts."
    );
  }
  const pendingCheck = checkPendingChanges(metrics);
  checks.push(pendingCheck);
  if (pendingCheck.status !== "healthy") {
    issues.push(pendingCheck.message);
    recommendations.push("Connect to sync your pending changes.");
  }
  const conflictCheck = checkConflicts(metrics);
  checks.push(conflictCheck);
  if (conflictCheck.status !== "healthy") {
    issues.push(conflictCheck.message);
    recommendations.push("Review and resolve sync conflicts.");
  }
  const hasError = checks.some((c) => c.status === "error");
  const hasWarning = checks.some((c) => c.status === "warning");
  let status;
  let label;
  let message;
  if (hasError) {
    status = "error";
    label = "Sync issue";
    message = `${issues.length} issue${issues.length > 1 ? "s" : ""} detected`;
  } else if (hasWarning) {
    status = "warning";
    label = "Sync delayed";
    message = "Some items may not be synced";
  } else {
    status = "healthy";
    label = "Everything OK";
    message = "All systems operational";
  }
  return {
    status,
    label,
    message,
    checks,
    issues,
    recommendations,
    assessedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function generateDebugReport(metrics, deviceInfo, syncLogs, dbStats) {
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    metrics,
    assessment: assessHealth(metrics),
    device: deviceInfo,
    recentSyncLogs: syncLogs.slice(0, 20),
    // Last 20 entries
    databaseStats: dbStats
  };
}
function validateHealthMetrics(metrics) {
  return HealthMetricsSchema.safeParse(metrics).success;
}
function validateHealthAssessment(assessment) {
  return HealthAssessmentSchema.safeParse(assessment).success;
}
var NSE_PLATFORMS = ["ios", "android", "mac", "win", "web"];
var NSEPlatformSchema = z.enum(NSE_PLATFORMS);
function isNSEPlatform(value) {
  return NSE_PLATFORMS.includes(value);
}
var NODE_SYNC_STATUSES = ["synced", "pending", "conflict"];
var NodeSyncStatusSchema = z.enum(NODE_SYNC_STATUSES);
function isNodeSyncStatus(value) {
  return NODE_SYNC_STATUSES.includes(value);
}
var VERSION_VECTOR_INACTIVE_KEY = "_inactive";
var VECTOR_COMPACTION_THRESHOLD = 10;
var DEVICE_INACTIVE_DAYS = 90;
var VERSION_COMPARISON_RESULTS = ["a_dominates", "b_dominates", "concurrent", "equal"];
var VersionComparisonSchema = z.enum(VERSION_COMPARISON_RESULTS);
function isVersionComparison(value) {
  return VERSION_COMPARISON_RESULTS.includes(value);
}
var NSE_SYNC_LOCK_TIMEOUT_SECONDS = 30;
var NSE_SYNC_BATCH_SIZE = 100;
var UI_YIELD_DELAY_MS = 50;
var CONFLICT_HISTORY_RETENTION_DAYS = 30;
var BANNER_DISMISS_COOLDOWN_MS = 864e5;
var NOTIFICATION_TIERS = ["badge", "banner", "modal"];
var NotificationTierSchema = z.enum(NOTIFICATION_TIERS);
var CLOCK_DRIFT_EMA_WEIGHT = 0.2;
var NSE_MERGE_STRATEGIES = [
  "conflict",
  "latest_wins",
  "max",
  "min",
  "sum",
  "average",
  "max_timestamp",
  "union",
  "merge_memberships",
  "keep_original",
  "keep_local"
];
var NSEMergeStrategySchema = z.enum(NSE_MERGE_STRATEGIES);
function isNSEMergeStrategy(value) {
  return NSE_MERGE_STRATEGIES.includes(value);
}
var SYNCABLE_FIELDS = [
  "content.title",
  "content.body",
  "content.summary",
  "organization.tags",
  "organization.cluster_memberships",
  "neural.stability",
  "neural.retrievability",
  "neural.difficulty",
  "neural.importance",
  "temporal.last_accessed",
  "temporal.access_count",
  "state.lifecycle",
  "state.flags"
];
var SyncableFieldSchema = z.enum(SYNCABLE_FIELDS);
var NSE_FIELD_MERGE_STRATEGIES = {
  "content.body": "conflict",
  "content.title": "latest_wins",
  "content.summary": "latest_wins",
  "organization.tags": "union",
  "organization.cluster_memberships": "merge_memberships",
  "neural.stability": "max",
  "neural.retrievability": "max",
  "neural.difficulty": "average",
  "neural.importance": "max",
  "temporal.last_accessed": "max_timestamp",
  "temporal.access_count": "sum",
  "state.lifecycle": "latest_wins",
  "state.flags": "union",
  "_default": "latest_wins"
};
var SYNC_HEADER_DEVICE_ID = "X-Device-Id";
var SYNC_HEADER_SCHEMA_VERSION = "X-Schema-Version";
var SYNC_HEADER_SERVER_TIME = "X-Server-Time";
var HTTP_UPGRADE_REQUIRED = 426;
var SYNC_LOG_ENTRY_TYPES = [
  "resurrection",
  "conflict_resolved",
  "schema_mismatch",
  "recovery",
  "initial_sync"
];
var SyncLogEntryTypeSchema = z.enum(SYNC_LOG_ENTRY_TYPES);
var REEMBEDDING_REASONS = ["model_mismatch", "content_changed", "manual"];
var ReembeddingReasonSchema = z.enum(REEMBEDDING_REASONS);
var USER_RESOLUTION_ACTIONS = ["keep_local", "keep_remote", "manual_merge"];
var UserResolutionActionSchema = z.enum(USER_RESOLUTION_ACTIONS);
var MERGE_RESULT_STATUSES = ["merged", "conflict"];
var MergeResultStatusSchema = z.enum(MERGE_RESULT_STATUSES);
var NSE_CONFLICT_RESOLVERS = ["user", "auto"];
var NSEConflictResolverSchema = z.enum(NSE_CONFLICT_RESOLVERS);
var VersionVectorSchema = z.record(z.string(), z.number().int().min(0));
var SyncMetadataSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  version: VersionVectorSchema,
  last_modified_by: z.string().min(1),
  last_modified_at: z.string().datetime(),
  sync_status: NodeSyncStatusSchema,
  last_synced_at: z.string().datetime(),
  content_checksum: z.string().optional()
});
var DeviceInfoSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  device_id: z.string().min(1),
  platform: NSEPlatformSchema,
  display_name: z.string().min(1),
  created_at: z.string().datetime(),
  last_active_at: z.string().datetime(),
  clock_drift_ms: z.number(),
  schema_version: z.string().min(1)
});
var ClockSyncSchema = z.object({
  server_time: z.string().datetime(),
  local_time: z.string().datetime(),
  drift_ms: z.number(),
  last_sync: z.string().datetime()
});
var FieldChangeSchema = z.object({
  field: z.string().min(1),
  old_value: z.unknown(),
  new_value: z.unknown()
});
var ChangeSetSchema = z.object({
  node_id: z.string().min(1),
  device_id: z.string().min(1),
  timestamp: z.string().datetime(),
  changes: z.array(FieldChangeSchema)
});
var StrategyResultSchema = z.object({
  value: z.unknown(),
  isConflict: z.boolean()
});
var ClusterMembershipForMergeSchema = z.object({
  cluster_id: z.string().min(1),
  strength: z.number().min(0).max(1),
  pinned: z.boolean()
});
var NSEConflictInfoSchema = z.object({
  field: z.string().min(1),
  localValue: z.unknown(),
  remoteValue: z.unknown(),
  localTimestamp: z.string().datetime(),
  remoteTimestamp: z.string().datetime()
});
var NSEMergeResultSchema = z.object({
  status: MergeResultStatusSchema,
  mergedNode: z.record(z.string(), z.unknown()).optional(),
  conflicts: z.array(NSEConflictInfoSchema).optional()
});
var NSEStoredConflictSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  local_version: z.record(z.string(), z.unknown()),
  remote_version: z.record(z.string(), z.unknown()),
  conflicts: z.array(NSEConflictInfoSchema),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime()
});
var NSEUserResolutionSchema = z.object({
  node_id: z.string().min(1),
  resolution: UserResolutionActionSchema,
  field_choices: z.record(z.string(), z.enum(["local", "remote"])).optional(),
  manual_values: z.record(z.string(), z.unknown()).optional(),
  apply_to_similar: z.boolean()
});
var ConflictHistoryEntrySchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  rejected_version: z.record(z.string(), z.unknown()),
  resolved_at: z.string().datetime(),
  resolved_by: NSEConflictResolverSchema,
  expires_at: z.string().datetime()
});
var PushPayloadSchema = z.object({
  id: z.string().min(1),
  version: VersionVectorSchema,
  change_set: ChangeSetSchema,
  data: z.record(z.string(), z.unknown()),
  content_checksum: z.string().optional()
});
var PushResultSchema = z.object({
  applied: z.array(z.object({ id: z.string().min(1) })),
  conflicts: z.array(z.object({
    id: z.string().min(1),
    remoteVersion: VersionVectorSchema
  })),
  error: z.string().optional()
});
var PullResultSchema = z.object({
  applied: z.array(z.string()),
  conflicts: z.array(z.string()),
  error: z.string().optional()
});
var BatchSyncResponseSchema = z.object({
  changes: z.array(PushPayloadSchema),
  next_cursor: z.string().nullable(),
  total_estimate: z.number().int().min(0),
  batch_number: z.number().int().min(1)
});
var NSESyncProgressSchema = z.object({
  processed: z.number().int().min(0),
  total: z.number().int().min(0),
  percent: z.number().min(0).max(100),
  batchNumber: z.number().int().min(1)
});
var LastSyncedVersionSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  snapshot: z.record(z.string(), z.unknown()),
  synced_at: z.string().datetime()
});
var PrivateTierPayloadSchema = z.object({
  id: z.string().min(1),
  version: VersionVectorSchema,
  content_checksum: z.string().min(1),
  encrypted_payload: z.string().min(1),
  nonce: z.string().min(1),
  last_modified_at: z.string().datetime()
});
var PrivateTierConflictSchema = z.object({
  node_id: z.string().min(1),
  local_checksum: z.string().min(1),
  remote_checksum: z.string().min(1),
  local_payload: z.string().min(1),
  remote_payload: z.string().min(1),
  detected_at: z.string().datetime()
});
var ConflictNotificationSchema = z.object({
  node_id: z.string().min(1),
  conflict_count: z.number().int().min(1),
  fields: z.array(z.string()),
  created_at: z.string().datetime()
});
var NotificationActionSchema = z.object({
  label: z.string().min(1),
  onClick: z.string().min(1)
});
var BannerNotificationSchema = z.object({
  type: z.literal("warning"),
  message: z.string().min(1),
  actions: z.array(NotificationActionSchema),
  dismissible: z.boolean()
});
var BadgeStateSchema = z.object({
  conflict_count: z.number().int().min(0),
  visible: z.boolean()
});
var BannerDismissStateSchema = z.object({
  dismissed_at: z.string().datetime(),
  cooldown_expired: z.boolean()
});
var EmbeddingSyncSchema = z.object({
  vector: z.array(z.number()),
  model: z.string().min(1),
  model_version: z.string().min(1),
  generated_by: z.string().min(1),
  generated_at: z.string().datetime()
});
var ReembeddingQueueEntrySchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  reason: ReembeddingReasonSchema,
  from_model: z.string().min(1),
  to_model: z.string().min(1),
  queued_at: z.string().datetime()
});
var SchemaVersionErrorSchema = z.object({
  min_version: z.string().min(1),
  upgrade_url: z.string().url(),
  message: z.string().min(1)
});
var NSESyncLogEntrySchema = z.object({
  _schemaVersion: z.number().int().min(1),
  type: SyncLogEntryTypeSchema,
  node_id: z.string().optional(),
  timestamp: z.string().datetime(),
  message: z.string().min(1),
  device_id: z.string().min(1)
});
var ServerSyncStateSchema = z.object({
  current_vector: VersionVectorSchema,
  node_count: z.number().int().min(0),
  schema_version: z.string().min(1)
});
function validateVersionVector(v) {
  return VersionVectorSchema.safeParse(v).success;
}
function validateSyncMetadata(v) {
  return SyncMetadataSchema.safeParse(v).success;
}
function validateDeviceInfo(v) {
  return DeviceInfoSchema.safeParse(v).success;
}
function validateChangeSet(v) {
  return ChangeSetSchema.safeParse(v).success;
}
function validateNSEMergeResult(v) {
  return NSEMergeResultSchema.safeParse(v).success;
}
function validateNSEStoredConflict(v) {
  return NSEStoredConflictSchema.safeParse(v).success;
}
function validateNSEUserResolution(v) {
  return NSEUserResolutionSchema.safeParse(v).success;
}
function validatePushPayload(v) {
  return PushPayloadSchema.safeParse(v).success;
}
function validatePrivateTierPayload(v) {
  return PrivateTierPayloadSchema.safeParse(v).success;
}
function validateNSESyncLogEntry(v) {
  return NSESyncLogEntrySchema.safeParse(v).success;
}
function compareVectors(a, b) {
  const allDevices = /* @__PURE__ */ new Set();
  for (const key of Object.keys(a)) {
    if (key !== VERSION_VECTOR_INACTIVE_KEY) allDevices.add(key);
  }
  for (const key of Object.keys(b)) {
    if (key !== VERSION_VECTOR_INACTIVE_KEY) allDevices.add(key);
  }
  let aGreater = false;
  let bGreater = false;
  for (const device of allDevices) {
    const aVal = a[device] ?? 0;
    const bVal = b[device] ?? 0;
    if (aVal > bVal) aGreater = true;
    if (bVal > aVal) bGreater = true;
  }
  if (aGreater && !bGreater) return "a_dominates";
  if (bGreater && !aGreater) return "b_dominates";
  if (!aGreater && !bGreater) return "equal";
  return "concurrent";
}
function mergeVectors(a, b) {
  const result = { ...a };
  for (const [device, counter] of Object.entries(b)) {
    result[device] = Math.max(result[device] ?? 0, counter);
  }
  return result;
}
function incrementVector(vector, deviceId) {
  return {
    ...vector,
    [deviceId]: (vector[deviceId] ?? 0) + 1
  };
}
function compactVector(vector, deviceLastActive) {
  const activeDevices = Object.keys(vector).filter(
    (k) => k !== VERSION_VECTOR_INACTIVE_KEY
  );
  if (activeDevices.length <= VECTOR_COMPACTION_THRESHOLD) {
    return { ...vector };
  }
  const now = Date.now();
  const inactiveDaysMs = DEVICE_INACTIVE_DAYS * 24 * 60 * 60 * 1e3;
  const result = {};
  let inactiveSum = vector[VERSION_VECTOR_INACTIVE_KEY] ?? 0;
  for (const device of activeDevices) {
    const lastActive = deviceLastActive.get(device);
    const isInactive = lastActive && now - lastActive.getTime() > inactiveDaysMs;
    if (isInactive) {
      inactiveSum += vector[device] ?? 0;
    } else {
      result[device] = vector[device] ?? 0;
    }
  }
  if (inactiveSum > 0) {
    result[VERSION_VECTOR_INACTIVE_KEY] = inactiveSum;
  }
  return result;
}
function generateDeviceId(platform) {
  return `${platform}_${nanoid()}`;
}
function updateClockDrift(currentDrift, newSample) {
  return (1 - CLOCK_DRIFT_EMA_WEIGHT) * currentDrift + CLOCK_DRIFT_EMA_WEIGHT * newSample;
}
function adjustedTimestamp(localTime, driftMs) {
  return new Date(localTime.getTime() - driftMs);
}
function getNestedValue(obj, fieldPath) {
  const parts = fieldPath.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === void 0 || typeof current !== "object") {
      return void 0;
    }
    current = current[part];
  }
  return current;
}
function setNestedValue(obj, fieldPath, value) {
  const parts = fieldPath.split(".");
  if (parts.length === 0) return;
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === void 0 || current[part] === null || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }
  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === void 0 || b === void 0) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a;
    const bObj = b;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }
  return false;
}
function computeChangeSet(base, current, deviceId) {
  const changes = [];
  for (const field of SYNCABLE_FIELDS) {
    const oldValue = base ? getNestedValue(base, field) : void 0;
    const newValue = getNestedValue(current, field);
    if (!deepEqual(oldValue, newValue)) {
      changes.push({ field, old_value: oldValue, new_value: newValue });
    }
  }
  return {
    node_id: current["id"] ?? "",
    device_id: deviceId,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    changes
  };
}
function getFieldMergeStrategy(fieldPath) {
  return NSE_FIELD_MERGE_STRATEGIES[fieldPath] ?? NSE_FIELD_MERGE_STRATEGIES["_default"] ?? "latest_wins";
}
function applyStrategy(strategy, localVal, remoteVal, localTime, remoteTime, localOldVal, remoteOldVal) {
  switch (strategy) {
    case "conflict":
      return { value: void 0, isConflict: true };
    case "latest_wins": {
      const localMs = new Date(localTime).getTime();
      const remoteMs = new Date(remoteTime).getTime();
      return {
        value: localMs >= remoteMs ? localVal : remoteVal,
        isConflict: false
      };
    }
    case "max": {
      if (typeof localVal === "number" && typeof remoteVal === "number") {
        return { value: Math.max(localVal, remoteVal), isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }
    case "min": {
      if (typeof localVal === "number" && typeof remoteVal === "number") {
        return { value: Math.min(localVal, remoteVal), isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }
    case "sum": {
      if (typeof localVal === "number" && typeof remoteVal === "number") {
        if (typeof localOldVal === "number" && typeof remoteOldVal === "number") {
          const localDelta = localVal - localOldVal;
          const remoteDelta = remoteVal - remoteOldVal;
          return { value: localOldVal + localDelta + remoteDelta, isConflict: false };
        }
        return { value: localVal + remoteVal, isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }
    case "average": {
      if (typeof localVal === "number" && typeof remoteVal === "number") {
        return { value: (localVal + remoteVal) / 2, isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }
    case "max_timestamp": {
      const localStr = String(localVal ?? "");
      const remoteStr = String(remoteVal ?? "");
      return {
        value: localStr >= remoteStr ? localVal : remoteVal,
        isConflict: false
      };
    }
    case "union": {
      if (Array.isArray(localVal) && Array.isArray(remoteVal)) {
        return {
          value: [.../* @__PURE__ */ new Set([...localVal, ...remoteVal])],
          isConflict: false
        };
      }
      return { value: localVal, isConflict: false };
    }
    case "merge_memberships": {
      if (Array.isArray(localVal) && Array.isArray(remoteVal)) {
        return {
          value: mergeMemberships(
            localVal,
            remoteVal
          ),
          isConflict: false
        };
      }
      return { value: localVal, isConflict: false };
    }
    case "keep_original":
    case "keep_local":
      return { value: localVal, isConflict: false };
    default:
      return { value: localVal, isConflict: false };
  }
}
function mergeMemberships(local, remote) {
  const map = /* @__PURE__ */ new Map();
  for (const m of local) {
    map.set(m.cluster_id, { ...m });
  }
  for (const m of remote) {
    const existing = map.get(m.cluster_id);
    if (existing) {
      existing.strength = Math.max(existing.strength, m.strength);
      existing.pinned = existing.pinned || m.pinned;
    } else {
      map.set(m.cluster_id, { ...m });
    }
  }
  return Array.from(map.values());
}
function nseAutoMerge(local, _remote, localChangeSet, remoteChangeSet) {
  const localChanges = /* @__PURE__ */ new Map();
  for (const change of localChangeSet.changes) {
    localChanges.set(change.field, change);
  }
  const remoteChanges = /* @__PURE__ */ new Map();
  for (const change of remoteChangeSet.changes) {
    remoteChanges.set(change.field, change);
  }
  const merged = JSON.parse(JSON.stringify(local));
  const conflicts = [];
  for (const [field, remoteChange] of remoteChanges) {
    const localChange = localChanges.get(field);
    if (!localChange) {
      setNestedValue(merged, field, remoteChange.new_value);
    } else {
      const strategy = getFieldMergeStrategy(field);
      const result = applyStrategy(
        strategy,
        localChange.new_value,
        remoteChange.new_value,
        localChangeSet.timestamp,
        remoteChangeSet.timestamp,
        localChange.old_value,
        remoteChange.old_value
      );
      if (result.isConflict) {
        conflicts.push({
          field,
          localValue: localChange.new_value,
          remoteValue: remoteChange.new_value,
          localTimestamp: localChangeSet.timestamp,
          remoteTimestamp: remoteChangeSet.timestamp
        });
      } else {
        setNestedValue(merged, field, result.value);
      }
    }
  }
  if (conflicts.length === 0) {
    return { status: "merged", mergedNode: merged };
  }
  return { status: "conflict", mergedNode: merged, conflicts };
}
function detectPrivateTierConflict(local, remote) {
  return local.content_checksum !== remote.content_checksum;
}
function createSyncMetadata(deviceId, status = "pending") {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    _schemaVersion: 1,
    version: { [deviceId]: 1 },
    last_modified_by: deviceId,
    last_modified_at: now,
    sync_status: status,
    last_synced_at: now
  };
}
function createDeviceInfo(platform, schemaVersion = "2") {
  const deviceId = generateDeviceId(platform);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    _schemaVersion: 1,
    device_id: deviceId,
    platform,
    display_name: getDefaultDeviceName(platform),
    created_at: now,
    last_active_at: now,
    clock_drift_ms: 0,
    schema_version: schemaVersion
  };
}
function getDefaultDeviceName(platform) {
  switch (platform) {
    case "ios":
      return "iPhone";
    case "android":
      return "Android Device";
    case "mac":
      return "Mac";
    case "win":
      return "Windows PC";
    case "web":
      return "Web Browser";
    default:
      return "Device";
  }
}
function createBadgeState(conflictCount) {
  return {
    conflict_count: conflictCount,
    visible: conflictCount > 0
  };
}
function createStoredConflict(nodeId, local, remote, conflicts) {
  const now = /* @__PURE__ */ new Date();
  const expires = new Date(now.getTime() + CONFLICT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1e3);
  return {
    _schemaVersion: 1,
    node_id: nodeId,
    local_version: local,
    remote_version: remote,
    conflicts,
    created_at: now.toISOString(),
    expires_at: expires.toISOString()
  };
}
function createConflictHistoryEntry(nodeId, rejectedVersion, resolvedBy) {
  const now = /* @__PURE__ */ new Date();
  const expires = new Date(now.getTime() + CONFLICT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1e3);
  return {
    _schemaVersion: 1,
    node_id: nodeId,
    rejected_version: rejectedVersion,
    resolved_at: now.toISOString(),
    resolved_by: resolvedBy,
    expires_at: expires.toISOString()
  };
}
function isEmbeddingCompatible(nodeModel, currentModel) {
  return nodeModel === currentModel;
}

export { BANNER_DISMISS_COOLDOWN_MS, BadgeStateSchema, BannerDismissStateSchema, BannerNotificationSchema, BatchSyncResponseSchema, CLOCK_DRIFT_EMA_WEIGHT, CONFLICT_HISTORY_RETENTION_DAYS, CONFLICT_RESOLUTION_CHOICES, CONFLICT_STRENGTHS, ChangeSetSchema, ClockSyncSchema, ClusterMembershipForMergeSchema, ConflictHistoryEntrySchema, ConflictNotificationSchema, ConflictResolutionSchema, DEFAULT_LOCK_DURATION_SECONDS, DEVICE_INACTIVE_DAYS, DetectedConflictSchema, DeviceInfoSchema, EmbeddingSyncSchema, FIELD_CATEGORIES, FIELD_CATEGORY_MAP, FIELD_MERGE_STRATEGIES, FieldChangeSchema, HEALTH_STATUSES, HEALTH_THRESHOLDS, HTTP_UPGRADE_REQUIRED, HealthAssessmentSchema, HealthMetricsSchema, LastSyncedVersionSchema, MERGE_RESULT_STATUSES, MERGE_STRATEGIES, MergeResultStatusSchema, NODE_SYNC_STATUSES, NOTIFICATION_TIERS, NSEConflictInfoSchema, NSEConflictResolverSchema, NSEMergeResultSchema, NSEMergeStrategySchema, NSEPlatformSchema, NSEStoredConflictSchema, NSESyncLogEntrySchema, NSESyncProgressSchema, NSEUserResolutionSchema, NSE_CONFLICT_RESOLVERS, NSE_FIELD_MERGE_STRATEGIES, NSE_MERGE_STRATEGIES, NSE_PLATFORMS, NSE_SYNC_BATCH_SIZE, NSE_SYNC_LOCK_TIMEOUT_SECONDS, NodeSyncStatusSchema, NotificationActionSchema, NotificationTierSchema, PrivateTierConflictSchema, PrivateTierPayloadSchema, PullResultSchema, PushPayloadSchema, PushResultSchema, REEMBEDDING_REASONS, RESOLUTION_ACTIONS, ReembeddingQueueEntrySchema, ReembeddingReasonSchema, SYNCABLE_FIELDS, SYNC_EVENT_TYPES, SYNC_HEADER_DEVICE_ID, SYNC_HEADER_SCHEMA_VERSION, SYNC_HEADER_SERVER_TIME, SYNC_LOG_ENTRY_TYPES, SYNC_STATUSES, SchemaVersionErrorSchema, ServerSyncStateSchema, StrategyResultSchema, SyncLockSchema, SyncLogEntryTypeSchema, SyncManagerOptionsSchema, SyncMetadataSchema, SyncStateSchema, SyncableFieldSchema, UI_YIELD_DELAY_MS, USER_RESOLUTION_ACTIONS, UserResolutionActionSchema, VECTOR_COMPACTION_THRESHOLD, VERSION_COMPARISON_RESULTS, VERSION_VECTOR_INACTIVE_KEY, VersionComparisonSchema, VersionVectorSchema, adjustedTimestamp, applyMergeStrategy, applyStrategy, assessHealth, attemptAutoMerge, canAutoResolveConflict, classifyConflictStrength, compactVector, compareVectors, computeChangeSet, createBadgeState, createConflictHistoryEntry, createDefaultSyncManagerOptions, createDeviceInfo, createEmptyHealthMetrics, createInitialSyncState, createStoredConflict, createSyncLock, createSyncMetadata, deepEqual, detectPrivateTierConflict, generateDebugReport, generateDeviceId, getDefaultDeviceName, getFieldCategories, getFieldCategory, getFieldMergeStrategy, getMergeStrategy, getNestedValue, incrementVector, isEmbeddingCompatible, isNSEMergeStrategy, isNSEPlatform, isNodeSyncStatus, isSyncLockExpired, isSyncLockValid, isVersionComparison, mergeMemberships, mergeVectors, nseAutoMerge, setNestedValue, updateClockDrift, validateChangeSet, validateConflictResolution, validateDetectedConflict, validateDeviceInfo, validateHealthAssessment, validateHealthMetrics, validateNSEMergeResult, validateNSEStoredConflict, validateNSESyncLogEntry, validateNSEUserResolution, validatePrivateTierPayload, validatePushPayload, validateSyncLock, validateSyncManagerOptions, validateSyncMetadata, validateSyncState, validateVersionVector };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map