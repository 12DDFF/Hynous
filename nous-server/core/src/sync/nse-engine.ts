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

import { nanoid } from 'nanoid';
import {
  VERSION_VECTOR_INACTIVE_KEY,
  VECTOR_COMPACTION_THRESHOLD,
  DEVICE_INACTIVE_DAYS,
  CLOCK_DRIFT_EMA_WEIGHT,
  NSE_FIELD_MERGE_STRATEGIES,
  SYNCABLE_FIELDS,
  CONFLICT_HISTORY_RETENTION_DAYS,
  type VersionComparison,
  type NSEMergeStrategy,
  type NSEPlatform,
} from './nse-constants';

import {
  type VersionVector,
  type ChangeSet,
  type FieldChange,
  type StrategyResult,
  type ClusterMembershipForMerge,
  type NSEConflictInfo,
  type NSEMergeResult,
  type SyncMetadata,
  type DeviceInfo,
  type PrivateTierPayload,
  type BadgeState,
  type NSEStoredConflict,
  type ConflictHistoryEntry,
} from './nse-types';

// ============================================================
// VERSION VECTOR OPERATIONS
// ============================================================

/**
 * Compare two version vectors for causality.
 * Excludes _inactive key from comparison.
 *
 * @see storm-033 v1 revision Section 1
 */
export function compareVectors(a: VersionVector, b: VersionVector): VersionComparison {
  // Collect all device IDs from both vectors, excluding _inactive
  const allDevices = new Set<string>();
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

  if (aGreater && !bGreater) return 'a_dominates';
  if (bGreater && !aGreater) return 'b_dominates';
  if (!aGreater && !bGreater) return 'equal';
  return 'concurrent';
}

/**
 * Merge two version vectors by taking component-wise maximum.
 */
export function mergeVectors(a: VersionVector, b: VersionVector): VersionVector {
  const result: VersionVector = { ...a };

  for (const [device, counter] of Object.entries(b)) {
    result[device] = Math.max(result[device] ?? 0, counter);
  }

  return result;
}

/**
 * Increment the version vector for a local write.
 */
export function incrementVector(vector: VersionVector, deviceId: string): VersionVector {
  return {
    ...vector,
    [deviceId]: (vector[deviceId] ?? 0) + 1,
  };
}

/**
 * Compact a version vector by merging inactive device counters.
 */
export function compactVector(
  vector: VersionVector,
  deviceLastActive: Map<string, Date>
): VersionVector {
  const activeDevices = Object.keys(vector).filter(
    (k) => k !== VERSION_VECTOR_INACTIVE_KEY
  );

  // Only compact if above threshold
  if (activeDevices.length <= VECTOR_COMPACTION_THRESHOLD) {
    return { ...vector };
  }

  const now = Date.now();
  const inactiveDaysMs = DEVICE_INACTIVE_DAYS * 24 * 60 * 60 * 1000;
  const result: VersionVector = {};
  let inactiveSum = vector[VERSION_VECTOR_INACTIVE_KEY] ?? 0;

  for (const device of activeDevices) {
    const lastActive = deviceLastActive.get(device);
    const isInactive = lastActive && (now - lastActive.getTime()) > inactiveDaysMs;

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

// ============================================================
// DEVICE ID GENERATION
// ============================================================

/**
 * Generate a device ID with platform prefix.
 */
export function generateDeviceId(platform: NSEPlatform): string {
  return `${platform}_${nanoid()}`;
}

// ============================================================
// CLOCK DRIFT
// ============================================================

/**
 * Update clock drift using exponential moving average.
 */
export function updateClockDrift(currentDrift: number, newSample: number): number {
  return (1 - CLOCK_DRIFT_EMA_WEIGHT) * currentDrift + CLOCK_DRIFT_EMA_WEIGHT * newSample;
}

/**
 * Adjust a local timestamp by the tracked clock drift.
 */
export function adjustedTimestamp(localTime: Date, driftMs: number): Date {
  return new Date(localTime.getTime() - driftMs);
}

// ============================================================
// NESTED VALUE UTILITIES
// ============================================================

/**
 * Get a nested value from an object using dot-path notation.
 */
export function getNestedValue(obj: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a nested value on an object using dot-path notation.
 */
export function setNestedValue(obj: Record<string, unknown>, fieldPath: string, value: unknown): void {
  const parts = fieldPath.split('.');
  if (parts.length === 0) return;

  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1] as string;
  current[lastPart] = value;
}

/**
 * Deep equality check for comparing field values.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}

// ============================================================
// CHANGE SET COMPUTATION
// ============================================================

/**
 * Compute a change set by comparing base (last synced) to current.
 */
export function computeChangeSet(
  base: Record<string, unknown> | null,
  current: Record<string, unknown>,
  deviceId: string
): ChangeSet {
  const changes: FieldChange[] = [];

  for (const field of SYNCABLE_FIELDS) {
    const oldValue = base ? getNestedValue(base, field) : undefined;
    const newValue = getNestedValue(current, field);

    if (!deepEqual(oldValue, newValue)) {
      changes.push({ field, old_value: oldValue, new_value: newValue });
    }
  }

  return {
    node_id: (current['id'] as string) ?? '',
    device_id: deviceId,
    timestamp: new Date().toISOString(),
    changes,
  };
}

// ============================================================
// MERGE STRATEGY FUNCTIONS
// ============================================================

/**
 * Get the merge strategy for a given field path.
 */
export function getFieldMergeStrategy(fieldPath: string): NSEMergeStrategy {
  return NSE_FIELD_MERGE_STRATEGIES[fieldPath] ?? NSE_FIELD_MERGE_STRATEGIES['_default'] ?? 'latest_wins';
}

/**
 * Apply a merge strategy to two conflicting field values.
 *
 * @param localOldVal - Base value from local change set (needed for delta-based strategies like 'sum')
 * @param remoteOldVal - Base value from remote change set (needed for delta-based strategies like 'sum')
 *
 * @see storm-033 v1 revision Section 5 - Merge Strategy Table
 */
export function applyStrategy(
  strategy: NSEMergeStrategy,
  localVal: unknown,
  remoteVal: unknown,
  localTime: string,
  remoteTime: string,
  localOldVal?: unknown,
  remoteOldVal?: unknown
): StrategyResult {
  switch (strategy) {
    case 'conflict':
      return { value: undefined, isConflict: true };

    case 'latest_wins': {
      const localMs = new Date(localTime).getTime();
      const remoteMs = new Date(remoteTime).getTime();
      return {
        value: localMs >= remoteMs ? localVal : remoteVal,
        isConflict: false,
      };
    }

    case 'max': {
      if (typeof localVal === 'number' && typeof remoteVal === 'number') {
        return { value: Math.max(localVal, remoteVal), isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }

    case 'min': {
      if (typeof localVal === 'number' && typeof remoteVal === 'number') {
        return { value: Math.min(localVal, remoteVal), isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }

    case 'sum': {
      // CRITICAL: Sum DELTAS from base, not absolute values.
      // If base=10, local=15 (+5), remote=13 (+3), result = 10 + 5 + 3 = 18.
      // @see planning-notes.md Critical Note #5
      if (typeof localVal === 'number' && typeof remoteVal === 'number') {
        if (typeof localOldVal === 'number' && typeof remoteOldVal === 'number') {
          const localDelta = localVal - localOldVal;
          const remoteDelta = remoteVal - remoteOldVal;
          return { value: localOldVal + localDelta + remoteDelta, isConflict: false };
        }
        // Fallback when old values unavailable: sum absolute values
        return { value: localVal + remoteVal, isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }

    case 'average': {
      if (typeof localVal === 'number' && typeof remoteVal === 'number') {
        return { value: (localVal + remoteVal) / 2, isConflict: false };
      }
      return { value: localVal, isConflict: false };
    }

    case 'max_timestamp': {
      const localStr = String(localVal ?? '');
      const remoteStr = String(remoteVal ?? '');
      return {
        value: localStr >= remoteStr ? localVal : remoteVal,
        isConflict: false,
      };
    }

    case 'union': {
      if (Array.isArray(localVal) && Array.isArray(remoteVal)) {
        return {
          value: [...new Set([...localVal, ...remoteVal])],
          isConflict: false,
        };
      }
      return { value: localVal, isConflict: false };
    }

    case 'merge_memberships': {
      if (Array.isArray(localVal) && Array.isArray(remoteVal)) {
        return {
          value: mergeMemberships(
            localVal as ClusterMembershipForMerge[],
            remoteVal as ClusterMembershipForMerge[]
          ),
          isConflict: false,
        };
      }
      return { value: localVal, isConflict: false };
    }

    case 'keep_original':
    case 'keep_local':
      return { value: localVal, isConflict: false };

    default:
      return { value: localVal, isConflict: false };
  }
}

/**
 * Special handler for cluster membership merge.
 */
export function mergeMemberships(
  local: ClusterMembershipForMerge[],
  remote: ClusterMembershipForMerge[]
): ClusterMembershipForMerge[] {
  const map = new Map<string, ClusterMembershipForMerge>();

  // Add all local memberships
  for (const m of local) {
    map.set(m.cluster_id, { ...m });
  }

  // Merge remote memberships
  for (const m of remote) {
    const existing = map.get(m.cluster_id);
    if (existing) {
      // Overlap: take max strength, preserve pinned from either
      existing.strength = Math.max(existing.strength, m.strength);
      existing.pinned = existing.pinned || m.pinned;
    } else {
      map.set(m.cluster_id, { ...m });
    }
  }

  return Array.from(map.values());
}

// ============================================================
// AUTO-MERGE ALGORITHM
// ============================================================

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
export function nseAutoMerge(
  local: Record<string, unknown>,
  _remote: Record<string, unknown>,
  localChangeSet: ChangeSet,
  remoteChangeSet: ChangeSet
): NSEMergeResult {
  // Build maps of changes
  const localChanges = new Map<string, FieldChange>();
  for (const change of localChangeSet.changes) {
    localChanges.set(change.field, change);
  }

  const remoteChanges = new Map<string, FieldChange>();
  for (const change of remoteChangeSet.changes) {
    remoteChanges.set(change.field, change);
  }

  // Start with a deep copy of local
  const merged: Record<string, unknown> = JSON.parse(JSON.stringify(local));
  const conflicts: NSEConflictInfo[] = [];

  // Process each remote change
  for (const [field, remoteChange] of remoteChanges) {
    const localChange = localChanges.get(field);

    if (!localChange) {
      // Local did NOT change this field → apply remote value
      setNestedValue(merged, field, remoteChange.new_value);
    } else {
      // Both changed this field → apply merge strategy
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
          remoteTimestamp: remoteChangeSet.timestamp,
        });
      } else {
        setNestedValue(merged, field, result.value);
      }
    }
  }

  if (conflicts.length === 0) {
    return { status: 'merged', mergedNode: merged };
  }

  // Return partially merged node + conflicts for user resolution
  return { status: 'conflict', mergedNode: merged, conflicts };
}

// ============================================================
// PRIVATE TIER CONFLICT DETECTION
// ============================================================

/**
 * Detect conflict for Private tier using checksums.
 * Returns true if conflict detected (checksums differ).
 */
export function detectPrivateTierConflict(
  local: PrivateTierPayload,
  remote: PrivateTierPayload
): boolean {
  return local.content_checksum !== remote.content_checksum;
}

// ============================================================
// SYNC METADATA CREATION
// ============================================================

/**
 * Creates initial sync metadata for a new node.
 */
export function createSyncMetadata(
  deviceId: string,
  status: 'synced' | 'pending' | 'conflict' = 'pending'
): SyncMetadata {
  const now = new Date().toISOString();
  return {
    _schemaVersion: 1,
    version: { [deviceId]: 1 },
    last_modified_by: deviceId,
    last_modified_at: now,
    sync_status: status,
    last_synced_at: now,
  };
}

/**
 * Creates initial device info.
 */
export function createDeviceInfo(
  platform: NSEPlatform,
  schemaVersion: string = '2'
): DeviceInfo {
  const deviceId = generateDeviceId(platform);
  const now = new Date().toISOString();
  return {
    _schemaVersion: 1,
    device_id: deviceId,
    platform,
    display_name: getDefaultDeviceName(platform),
    created_at: now,
    last_active_at: now,
    clock_drift_ms: 0,
    schema_version: schemaVersion,
  };
}

/**
 * Get default display name for a device platform.
 */
export function getDefaultDeviceName(platform: NSEPlatform): string {
  switch (platform) {
    case 'ios': return 'iPhone';
    case 'android': return 'Android Device';
    case 'mac': return 'Mac';
    case 'win': return 'Windows PC';
    case 'web': return 'Web Browser';
    default: return 'Device';
  }
}

// ============================================================
// BADGE STATE
// ============================================================

/**
 * Create badge state from conflict count.
 */
export function createBadgeState(conflictCount: number): BadgeState {
  return {
    conflict_count: conflictCount,
    visible: conflictCount > 0,
  };
}

// ============================================================
// STORED CONFLICT CREATION
// ============================================================

/**
 * Creates a stored conflict record.
 */
export function createStoredConflict(
  nodeId: string,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  conflicts: NSEConflictInfo[]
): NSEStoredConflict {
  const now = new Date();
  const expires = new Date(now.getTime() + CONFLICT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return {
    _schemaVersion: 1,
    node_id: nodeId,
    local_version: local,
    remote_version: remote,
    conflicts,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  };
}

/**
 * Creates a conflict history entry for the rejected version.
 */
export function createConflictHistoryEntry(
  nodeId: string,
  rejectedVersion: Record<string, unknown>,
  resolvedBy: 'user' | 'auto'
): ConflictHistoryEntry {
  const now = new Date();
  const expires = new Date(now.getTime() + CONFLICT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return {
    _schemaVersion: 1,
    node_id: nodeId,
    rejected_version: rejectedVersion,
    resolved_at: now.toISOString(),
    resolved_by: resolvedBy,
    expires_at: expires.toISOString(),
  };
}

// ============================================================
// EMBEDDING COMPATIBILITY
// ============================================================

/**
 * Check if an embedding model matches the current model.
 */
export function isEmbeddingCompatible(nodeModel: string, currentModel: string): boolean {
  return nodeModel === currentModel;
}
