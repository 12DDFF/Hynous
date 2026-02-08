/**
 * @module @nous/core/sync/nse
 * @description Tests for Nous Sync Engine (NSE) v1
 * @spec Specs/Phase-6-Technical-Services/storm-033
 * @storm Brainstorms/Infrastructure/storm-033-sync-conflict-resolution
 */

import { describe, it, expect } from 'vitest';
import {
  // ── Constants ──────────────────────────────────────────────
  NSE_PLATFORMS,
  NODE_SYNC_STATUSES,
  VERSION_VECTOR_INACTIVE_KEY,
  VECTOR_COMPACTION_THRESHOLD,
  DEVICE_INACTIVE_DAYS,
  NSE_SYNC_LOCK_TIMEOUT_SECONDS,
  NSE_SYNC_BATCH_SIZE,
  UI_YIELD_DELAY_MS,
  CONFLICT_HISTORY_RETENTION_DAYS,
  BANNER_DISMISS_COOLDOWN_MS,
  CLOCK_DRIFT_EMA_WEIGHT,
  NSE_MERGE_STRATEGIES,
  SYNCABLE_FIELDS,
  NSE_FIELD_MERGE_STRATEGIES,
  VERSION_COMPARISON_RESULTS,
  SYNC_HEADER_DEVICE_ID,
  SYNC_HEADER_SCHEMA_VERSION,
  SYNC_HEADER_SERVER_TIME,
  HTTP_UPGRADE_REQUIRED,
  SYNC_LOG_ENTRY_TYPES,
  REEMBEDDING_REASONS,
  USER_RESOLUTION_ACTIONS,
  MERGE_RESULT_STATUSES,
  NSE_CONFLICT_RESOLVERS,
  NOTIFICATION_TIERS,

  // ── Type Guards ────────────────────────────────────────────
  isNSEPlatform,
  isNodeSyncStatus,
  isVersionComparison,
  isNSEMergeStrategy,

  // ── Validation Functions ───────────────────────────────────
  validateVersionVector,
  validateSyncMetadata,
  validateDeviceInfo,
  validateChangeSet,
  validateNSEMergeResult,
  validateNSEStoredConflict,
  validateNSEUserResolution,
  validatePushPayload,
  validatePrivateTierPayload,
  validateNSESyncLogEntry,

  // ── Zod Schemas ────────────────────────────────────────────
  VersionVectorSchema,
  SyncMetadataSchema,
  DeviceInfoSchema,
  FieldChangeSchema,
  ChangeSetSchema,
  StrategyResultSchema,
  ClusterMembershipForMergeSchema,
  NSEConflictInfoSchema,
  NSEMergeResultSchema,
  NSEStoredConflictSchema,
  NSEUserResolutionSchema,
  ConflictHistoryEntrySchema,
  PushPayloadSchema,
  PushResultSchema,
  PullResultSchema,
  BatchSyncResponseSchema,
  NSESyncProgressSchema,
  LastSyncedVersionSchema,
  PrivateTierPayloadSchema,
  ConflictNotificationSchema,
  BannerNotificationSchema,
  BadgeStateSchema,
  EmbeddingSyncSchema,
  ReembeddingQueueEntrySchema,
  SchemaVersionErrorSchema,
  NSESyncLogEntrySchema,
  ServerSyncStateSchema,

  // ── Engine Functions ───────────────────────────────────────
  compareVectors,
  mergeVectors,
  incrementVector,
  compactVector,
  generateDeviceId,
  updateClockDrift,
  adjustedTimestamp,
  getNestedValue,
  setNestedValue,
  deepEqual,
  computeChangeSet,
  getFieldMergeStrategy,
  applyStrategy,
  mergeMemberships,
  nseAutoMerge,
  detectPrivateTierConflict,
  createSyncMetadata,
  createDeviceInfo,
  getDefaultDeviceName,
  createBadgeState,
  createStoredConflict,
  createConflictHistoryEntry,
  isEmbeddingCompatible,

  // ── Types ──────────────────────────────────────────────────
  type VersionVector,
  type ChangeSet,
  type FieldChange,
  type ClusterMembershipForMerge,
  type PrivateTierPayload,
} from './index';

// ============================================================
// NSE CONSTANTS
// ============================================================

describe('NSE Constants', () => {
  describe('NSE_PLATFORMS', () => {
    it('should have all 5 platforms', () => {
      expect(NSE_PLATFORMS).toEqual(['ios', 'android', 'mac', 'win', 'web']);
      expect(NSE_PLATFORMS.length).toBe(5);
    });
  });

  describe('NODE_SYNC_STATUSES', () => {
    it('should have synced, pending, and conflict', () => {
      expect(NODE_SYNC_STATUSES).toEqual(['synced', 'pending', 'conflict']);
    });
  });

  describe('VERSION_VECTOR constants', () => {
    it('should have correct inactive key', () => {
      expect(VERSION_VECTOR_INACTIVE_KEY).toBe('_inactive');
    });

    it('should have correct compaction threshold', () => {
      expect(VECTOR_COMPACTION_THRESHOLD).toBe(10);
    });

    it('should have correct inactive days', () => {
      expect(DEVICE_INACTIVE_DAYS).toBe(90);
    });
  });

  describe('Sync lock constants', () => {
    it('should have 30-second timeout matching storm-017', () => {
      expect(NSE_SYNC_LOCK_TIMEOUT_SECONDS).toBe(30);
    });
  });

  describe('Batch sync constants', () => {
    it('should have batch size of 100', () => {
      expect(NSE_SYNC_BATCH_SIZE).toBe(100);
    });

    it('should have UI yield delay of 50ms', () => {
      expect(UI_YIELD_DELAY_MS).toBe(50);
    });
  });

  describe('Conflict history constants', () => {
    it('should retain for 30 days', () => {
      expect(CONFLICT_HISTORY_RETENTION_DAYS).toBe(30);
    });
  });

  describe('Notification constants', () => {
    it('should have 24-hour banner cooldown', () => {
      expect(BANNER_DISMISS_COOLDOWN_MS).toBe(86_400_000);
    });

    it('should have badge, banner, and modal tiers', () => {
      expect(NOTIFICATION_TIERS).toEqual(['badge', 'banner', 'modal']);
    });
  });

  describe('Clock drift constant', () => {
    it('should have EMA weight of 0.2', () => {
      expect(CLOCK_DRIFT_EMA_WEIGHT).toBe(0.2);
    });
  });

  describe('NSE_MERGE_STRATEGIES', () => {
    it('should have all 11 strategies', () => {
      expect(NSE_MERGE_STRATEGIES).toEqual([
        'conflict', 'latest_wins', 'max', 'min', 'sum', 'average',
        'max_timestamp', 'union', 'merge_memberships', 'keep_original', 'keep_local',
      ]);
      expect(NSE_MERGE_STRATEGIES.length).toBe(11);
    });
  });

  describe('SYNCABLE_FIELDS', () => {
    it('should have all 13 syncable fields', () => {
      expect(SYNCABLE_FIELDS.length).toBe(13);
      expect(SYNCABLE_FIELDS).toContain('content.title');
      expect(SYNCABLE_FIELDS).toContain('content.body');
      expect(SYNCABLE_FIELDS).toContain('content.summary');
      expect(SYNCABLE_FIELDS).toContain('organization.tags');
      expect(SYNCABLE_FIELDS).toContain('organization.cluster_memberships');
      expect(SYNCABLE_FIELDS).toContain('neural.stability');
      expect(SYNCABLE_FIELDS).toContain('neural.retrievability');
      expect(SYNCABLE_FIELDS).toContain('neural.difficulty');
      expect(SYNCABLE_FIELDS).toContain('neural.importance');
      expect(SYNCABLE_FIELDS).toContain('temporal.last_accessed');
      expect(SYNCABLE_FIELDS).toContain('temporal.access_count');
      expect(SYNCABLE_FIELDS).toContain('state.lifecycle');
      expect(SYNCABLE_FIELDS).toContain('state.flags');
    });
  });

  describe('NSE_FIELD_MERGE_STRATEGIES', () => {
    it('should use conflict for content.body', () => {
      expect(NSE_FIELD_MERGE_STRATEGIES['content.body']).toBe('conflict');
    });

    it('should use latest_wins for content.title', () => {
      expect(NSE_FIELD_MERGE_STRATEGIES['content.title']).toBe('latest_wins');
    });

    it('should use union for organization.tags', () => {
      expect(NSE_FIELD_MERGE_STRATEGIES['organization.tags']).toBe('union');
    });

    it('should use merge_memberships for cluster_memberships', () => {
      expect(NSE_FIELD_MERGE_STRATEGIES['organization.cluster_memberships']).toBe('merge_memberships');
    });

    it('should use max for neural.stability', () => {
      expect(NSE_FIELD_MERGE_STRATEGIES['neural.stability']).toBe('max');
    });

    it('should use average for neural.difficulty', () => {
      expect(NSE_FIELD_MERGE_STRATEGIES['neural.difficulty']).toBe('average');
    });

    it('should use sum for temporal.access_count', () => {
      expect(NSE_FIELD_MERGE_STRATEGIES['temporal.access_count']).toBe('sum');
    });

    it('should use max_timestamp for temporal.last_accessed', () => {
      expect(NSE_FIELD_MERGE_STRATEGIES['temporal.last_accessed']).toBe('max_timestamp');
    });

    it('should have latest_wins as default', () => {
      expect(NSE_FIELD_MERGE_STRATEGIES['_default']).toBe('latest_wins');
    });
  });

  describe('VERSION_COMPARISON_RESULTS', () => {
    it('should have all 4 comparison results', () => {
      expect(VERSION_COMPARISON_RESULTS).toEqual([
        'a_dominates', 'b_dominates', 'concurrent', 'equal',
      ]);
    });
  });

  describe('Sync protocol constants', () => {
    it('should have correct headers', () => {
      expect(SYNC_HEADER_DEVICE_ID).toBe('X-Device-Id');
      expect(SYNC_HEADER_SCHEMA_VERSION).toBe('X-Schema-Version');
      expect(SYNC_HEADER_SERVER_TIME).toBe('X-Server-Time');
    });

    it('should use HTTP 426 for upgrade required', () => {
      expect(HTTP_UPGRADE_REQUIRED).toBe(426);
    });
  });

  describe('SYNC_LOG_ENTRY_TYPES', () => {
    it('should have all expected types', () => {
      expect(SYNC_LOG_ENTRY_TYPES).toContain('resurrection');
      expect(SYNC_LOG_ENTRY_TYPES).toContain('conflict_resolved');
      expect(SYNC_LOG_ENTRY_TYPES).toContain('schema_mismatch');
      expect(SYNC_LOG_ENTRY_TYPES).toContain('recovery');
      expect(SYNC_LOG_ENTRY_TYPES).toContain('initial_sync');
    });
  });

  describe('REEMBEDDING_REASONS', () => {
    it('should have all reasons', () => {
      expect(REEMBEDDING_REASONS).toEqual(['model_mismatch', 'content_changed', 'manual']);
    });
  });

  describe('USER_RESOLUTION_ACTIONS', () => {
    it('should have all actions', () => {
      expect(USER_RESOLUTION_ACTIONS).toEqual(['keep_local', 'keep_remote', 'manual_merge']);
    });
  });

  describe('MERGE_RESULT_STATUSES', () => {
    it('should have merged and conflict', () => {
      expect(MERGE_RESULT_STATUSES).toEqual(['merged', 'conflict']);
    });
  });

  describe('NSE_CONFLICT_RESOLVERS', () => {
    it('should have user and auto', () => {
      expect(NSE_CONFLICT_RESOLVERS).toEqual(['user', 'auto']);
    });
  });
});

// ============================================================
// TYPE GUARDS
// ============================================================

describe('NSE Type Guards', () => {
  describe('isNSEPlatform', () => {
    it('should return true for valid platforms', () => {
      expect(isNSEPlatform('ios')).toBe(true);
      expect(isNSEPlatform('android')).toBe(true);
      expect(isNSEPlatform('mac')).toBe(true);
      expect(isNSEPlatform('win')).toBe(true);
      expect(isNSEPlatform('web')).toBe(true);
    });

    it('should return false for invalid platforms', () => {
      expect(isNSEPlatform('linux')).toBe(false);
      expect(isNSEPlatform('')).toBe(false);
      expect(isNSEPlatform(42)).toBe(false);
    });
  });

  describe('isNodeSyncStatus', () => {
    it('should return true for valid statuses', () => {
      expect(isNodeSyncStatus('synced')).toBe(true);
      expect(isNodeSyncStatus('pending')).toBe(true);
      expect(isNodeSyncStatus('conflict')).toBe(true);
    });

    it('should return false for invalid statuses', () => {
      expect(isNodeSyncStatus('error')).toBe(false);
      expect(isNodeSyncStatus('')).toBe(false);
    });
  });

  describe('isVersionComparison', () => {
    it('should return true for valid comparisons', () => {
      expect(isVersionComparison('a_dominates')).toBe(true);
      expect(isVersionComparison('b_dominates')).toBe(true);
      expect(isVersionComparison('concurrent')).toBe(true);
      expect(isVersionComparison('equal')).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isVersionComparison('unknown')).toBe(false);
    });
  });

  describe('isNSEMergeStrategy', () => {
    it('should return true for all valid strategies', () => {
      for (const strategy of NSE_MERGE_STRATEGIES) {
        expect(isNSEMergeStrategy(strategy)).toBe(true);
      }
    });

    it('should return false for invalid strategies', () => {
      expect(isNSEMergeStrategy('take_local')).toBe(false);
      expect(isNSEMergeStrategy('')).toBe(false);
    });
  });
});

// ============================================================
// ZOD SCHEMA VALIDATION
// ============================================================

describe('NSE Zod Schemas', () => {
  describe('VersionVectorSchema', () => {
    it('should accept valid version vector', () => {
      const result = VersionVectorSchema.safeParse({ dev1: 3, dev2: 5 });
      expect(result.success).toBe(true);
    });

    it('should accept vector with _inactive', () => {
      const result = VersionVectorSchema.safeParse({ dev1: 3, _inactive: 10 });
      expect(result.success).toBe(true);
    });

    it('should reject non-integer values', () => {
      const result = VersionVectorSchema.safeParse({ dev1: 3.5 });
      expect(result.success).toBe(false);
    });

    it('should reject negative values', () => {
      const result = VersionVectorSchema.safeParse({ dev1: -1 });
      expect(result.success).toBe(false);
    });
  });

  describe('SyncMetadataSchema', () => {
    it('should accept valid metadata', () => {
      const metadata = {
        _schemaVersion: 1,
        version: { dev1: 1 },
        last_modified_by: 'dev1',
        last_modified_at: '2024-01-01T00:00:00Z',
        sync_status: 'synced',
        last_synced_at: '2024-01-01T00:00:00Z',
      };
      expect(validateSyncMetadata(metadata)).toBe(true);
    });

    it('should accept metadata with optional checksum', () => {
      const metadata = {
        _schemaVersion: 1,
        version: { dev1: 1 },
        last_modified_by: 'dev1',
        last_modified_at: '2024-01-01T00:00:00Z',
        sync_status: 'pending',
        last_synced_at: '2024-01-01T00:00:00Z',
        content_checksum: 'abc123',
      };
      expect(validateSyncMetadata(metadata)).toBe(true);
    });

    it('should reject invalid sync status', () => {
      const metadata = {
        _schemaVersion: 1,
        version: { dev1: 1 },
        last_modified_by: 'dev1',
        last_modified_at: '2024-01-01T00:00:00Z',
        sync_status: 'invalid',
        last_synced_at: '2024-01-01T00:00:00Z',
      };
      expect(validateSyncMetadata(metadata)).toBe(false);
    });
  });

  describe('DeviceInfoSchema', () => {
    it('should accept valid device info', () => {
      const info = {
        _schemaVersion: 1,
        device_id: 'ios_abc123',
        platform: 'ios',
        display_name: 'My iPhone',
        created_at: '2024-01-01T00:00:00Z',
        last_active_at: '2024-01-01T00:00:00Z',
        clock_drift_ms: 50,
        schema_version: '2',
      };
      expect(validateDeviceInfo(info)).toBe(true);
    });
  });

  describe('ChangeSetSchema', () => {
    it('should accept valid change set', () => {
      const cs = {
        node_id: 'node-1',
        device_id: 'dev-1',
        timestamp: '2024-01-01T00:00:00Z',
        changes: [
          { field: 'content.title', old_value: 'Old', new_value: 'New' },
        ],
      };
      expect(validateChangeSet(cs)).toBe(true);
    });

    it('should accept empty changes array', () => {
      const cs = {
        node_id: 'node-1',
        device_id: 'dev-1',
        timestamp: '2024-01-01T00:00:00Z',
        changes: [],
      };
      expect(validateChangeSet(cs)).toBe(true);
    });
  });

  describe('NSEMergeResultSchema', () => {
    it('should accept merged result', () => {
      const result = { status: 'merged', mergedNode: { id: 'test' } };
      expect(validateNSEMergeResult(result)).toBe(true);
    });

    it('should accept conflict result', () => {
      const result = {
        status: 'conflict',
        conflicts: [{
          field: 'content.body',
          localValue: 'local',
          remoteValue: 'remote',
          localTimestamp: '2024-01-01T00:00:00Z',
          remoteTimestamp: '2024-01-01T01:00:00Z',
        }],
      };
      expect(validateNSEMergeResult(result)).toBe(true);
    });
  });

  describe('NSEStoredConflictSchema', () => {
    it('should accept valid stored conflict', () => {
      const conflict = {
        _schemaVersion: 1,
        node_id: 'node-1',
        local_version: { title: 'Local' },
        remote_version: { title: 'Remote' },
        conflicts: [{
          field: 'content.body',
          localValue: 'local text',
          remoteValue: 'remote text',
          localTimestamp: '2024-01-01T00:00:00Z',
          remoteTimestamp: '2024-01-01T01:00:00Z',
        }],
        created_at: '2024-01-01T00:00:00Z',
        expires_at: '2024-02-01T00:00:00Z',
      };
      expect(validateNSEStoredConflict(conflict)).toBe(true);
    });
  });

  describe('NSEUserResolutionSchema', () => {
    it('should accept keep_local resolution', () => {
      const res = {
        node_id: 'node-1',
        resolution: 'keep_local',
        apply_to_similar: false,
      };
      expect(validateNSEUserResolution(res)).toBe(true);
    });

    it('should accept manual_merge with field choices', () => {
      const res = {
        node_id: 'node-1',
        resolution: 'manual_merge',
        field_choices: { 'content.title': 'local', 'content.body': 'remote' },
        apply_to_similar: true,
      };
      expect(validateNSEUserResolution(res)).toBe(true);
    });
  });

  describe('PushPayloadSchema', () => {
    it('should accept valid payload', () => {
      const payload = {
        id: 'node-1',
        version: { dev1: 1 },
        change_set: {
          node_id: 'node-1',
          device_id: 'dev1',
          timestamp: '2024-01-01T00:00:00Z',
          changes: [],
        },
        data: { title: 'Test' },
      };
      expect(validatePushPayload(payload)).toBe(true);
    });
  });

  describe('PrivateTierPayloadSchema', () => {
    it('should accept valid private payload', () => {
      const payload = {
        id: 'node-1',
        version: { dev1: 1 },
        content_checksum: 'sha256hash',
        encrypted_payload: 'encrypted_data_base64',
        nonce: 'nonce_base64',
        last_modified_at: '2024-01-01T00:00:00Z',
      };
      expect(validatePrivateTierPayload(payload)).toBe(true);
    });
  });

  describe('NSESyncLogEntrySchema', () => {
    it('should accept valid log entry', () => {
      const entry = {
        _schemaVersion: 1,
        type: 'resurrection',
        node_id: 'node-1',
        timestamp: '2024-01-01T00:00:00Z',
        message: 'Node restored from delete',
        device_id: 'dev1',
      };
      expect(validateNSESyncLogEntry(entry)).toBe(true);
    });

    it('should accept log entry without node_id', () => {
      const entry = {
        _schemaVersion: 1,
        type: 'initial_sync',
        timestamp: '2024-01-01T00:00:00Z',
        message: 'Initial sync completed',
        device_id: 'dev1',
      };
      expect(validateNSESyncLogEntry(entry)).toBe(true);
    });
  });

  describe('Additional schemas', () => {
    it('should validate PullResult', () => {
      const result = PullResultSchema.safeParse({
        applied: ['node-1', 'node-2'],
        conflicts: ['node-3'],
      });
      expect(result.success).toBe(true);
    });

    it('should validate BatchSyncResponse', () => {
      const result = BatchSyncResponseSchema.safeParse({
        changes: [],
        next_cursor: 'cursor123',
        total_estimate: 500,
        batch_number: 1,
      });
      expect(result.success).toBe(true);
    });

    it('should validate NSESyncProgress', () => {
      const result = NSESyncProgressSchema.safeParse({
        processed: 50,
        total: 100,
        percent: 50,
        batchNumber: 1,
      });
      expect(result.success).toBe(true);
    });

    it('should validate LastSyncedVersion', () => {
      const result = LastSyncedVersionSchema.safeParse({
        _schemaVersion: 1,
        node_id: 'node-1',
        snapshot: { title: 'Test' },
        synced_at: '2024-01-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
    });

    it('should validate ConflictNotification', () => {
      const result = ConflictNotificationSchema.safeParse({
        node_id: 'node-1',
        conflict_count: 3,
        fields: ['content.body', 'content.title'],
        created_at: '2024-01-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
    });

    it('should validate BannerNotification', () => {
      const result = BannerNotificationSchema.safeParse({
        type: 'warning',
        message: '3 sync conflicts need attention',
        actions: [{ label: 'Resolve', onClick: 'navigate_conflicts' }],
        dismissible: true,
      });
      expect(result.success).toBe(true);
    });

    it('should validate BadgeState', () => {
      const result = BadgeStateSchema.safeParse({
        conflict_count: 3,
        visible: true,
      });
      expect(result.success).toBe(true);
    });

    it('should validate EmbeddingSync', () => {
      const result = EmbeddingSyncSchema.safeParse({
        vector: [0.1, 0.2, 0.3],
        model: 'openai-3-small',
        model_version: '2024-01',
        generated_by: 'dev1',
        generated_at: '2024-01-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
    });

    it('should validate ReembeddingQueueEntry', () => {
      const result = ReembeddingQueueEntrySchema.safeParse({
        _schemaVersion: 1,
        node_id: 'node-1',
        reason: 'model_mismatch',
        from_model: 'openai-3-small',
        to_model: 'openai-3-large',
        queued_at: '2024-01-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
    });

    it('should validate SchemaVersionError', () => {
      const result = SchemaVersionErrorSchema.safeParse({
        min_version: '2.0.0',
        upgrade_url: 'https://example.com/update',
        message: 'Please update your app',
      });
      expect(result.success).toBe(true);
    });

    it('should validate ServerSyncState', () => {
      const result = ServerSyncStateSchema.safeParse({
        current_vector: { dev1: 5, dev2: 3 },
        node_count: 100,
        schema_version: '2',
      });
      expect(result.success).toBe(true);
    });

    it('should validate ConflictHistoryEntry', () => {
      const result = ConflictHistoryEntrySchema.safeParse({
        _schemaVersion: 1,
        node_id: 'node-1',
        rejected_version: { title: 'Rejected' },
        resolved_at: '2024-01-01T00:00:00Z',
        resolved_by: 'user',
        expires_at: '2024-02-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
    });

    it('should validate PushResult', () => {
      const result = PushResultSchema.safeParse({
        applied: [{ id: 'node-1' }],
        conflicts: [{ id: 'node-2', remoteVersion: { dev1: 5 } }],
      });
      expect(result.success).toBe(true);
    });

    it('should validate FieldChange', () => {
      const result = FieldChangeSchema.safeParse({
        field: 'content.title',
        old_value: 'Old',
        new_value: 'New',
      });
      expect(result.success).toBe(true);
    });

    it('should validate StrategyResult', () => {
      const result = StrategyResultSchema.safeParse({
        value: 'merged_value',
        isConflict: false,
      });
      expect(result.success).toBe(true);
    });

    it('should validate ClusterMembershipForMerge', () => {
      const result = ClusterMembershipForMergeSchema.safeParse({
        cluster_id: 'cluster-1',
        strength: 0.8,
        pinned: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject ClusterMembershipForMerge with out-of-range strength', () => {
      const result = ClusterMembershipForMergeSchema.safeParse({
        cluster_id: 'cluster-1',
        strength: 1.5,
        pinned: false,
      });
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================
// VERSION VECTOR OPERATIONS
// ============================================================

describe('Version Vector Operations', () => {
  describe('compareVectors', () => {
    it('should return equal for identical vectors', () => {
      const a: VersionVector = { dev1: 3, dev2: 5 };
      const b: VersionVector = { dev1: 3, dev2: 5 };
      expect(compareVectors(a, b)).toBe('equal');
    });

    it('should return equal for empty vectors', () => {
      expect(compareVectors({}, {})).toBe('equal');
    });

    it('should return a_dominates when a is strictly greater', () => {
      const a: VersionVector = { dev1: 3, dev2: 6 };
      const b: VersionVector = { dev1: 3, dev2: 5 };
      expect(compareVectors(a, b)).toBe('a_dominates');
    });

    it('should return b_dominates when b is strictly greater', () => {
      const a: VersionVector = { dev1: 3, dev2: 5 };
      const b: VersionVector = { dev1: 4, dev2: 5 };
      expect(compareVectors(a, b)).toBe('b_dominates');
    });

    it('should return concurrent when both have higher elements', () => {
      const a: VersionVector = { dev1: 4, dev2: 3 };
      const b: VersionVector = { dev1: 3, dev2: 5 };
      expect(compareVectors(a, b)).toBe('concurrent');
    });

    it('should handle missing keys as 0', () => {
      const a: VersionVector = { dev1: 3 };
      const b: VersionVector = { dev2: 5 };
      expect(compareVectors(a, b)).toBe('concurrent');
    });

    it('should return a_dominates when a has extra devices', () => {
      const a: VersionVector = { dev1: 3, dev2: 1 };
      const b: VersionVector = { dev1: 3 };
      expect(compareVectors(a, b)).toBe('a_dominates');
    });

    it('should exclude _inactive from comparison', () => {
      const a: VersionVector = { dev1: 3, _inactive: 100 };
      const b: VersionVector = { dev1: 3, _inactive: 50 };
      expect(compareVectors(a, b)).toBe('equal');
    });

    it('should handle one-sided _inactive correctly', () => {
      const a: VersionVector = { dev1: 3, _inactive: 100 };
      const b: VersionVector = { dev1: 3 };
      expect(compareVectors(a, b)).toBe('equal');
    });
  });

  describe('mergeVectors', () => {
    it('should take component-wise maximum', () => {
      const a: VersionVector = { dev1: 3, dev2: 5 };
      const b: VersionVector = { dev1: 4, dev2: 2 };
      const result = mergeVectors(a, b);
      expect(result).toEqual({ dev1: 4, dev2: 5 });
    });

    it('should include devices from both vectors', () => {
      const a: VersionVector = { dev1: 3 };
      const b: VersionVector = { dev2: 5 };
      const result = mergeVectors(a, b);
      expect(result).toEqual({ dev1: 3, dev2: 5 });
    });

    it('should handle empty vectors', () => {
      expect(mergeVectors({}, {})).toEqual({});
      expect(mergeVectors({ dev1: 3 }, {})).toEqual({ dev1: 3 });
    });

    it('should not mutate inputs', () => {
      const a: VersionVector = { dev1: 3 };
      const b: VersionVector = { dev1: 5 };
      mergeVectors(a, b);
      expect(a.dev1).toBe(3);
    });
  });

  describe('incrementVector', () => {
    it('should increment existing device counter', () => {
      const vector: VersionVector = { dev1: 3, dev2: 5 };
      const result = incrementVector(vector, 'dev1');
      expect(result.dev1).toBe(4);
      expect(result.dev2).toBe(5);
    });

    it('should start new device at 1', () => {
      const vector: VersionVector = { dev1: 3 };
      const result = incrementVector(vector, 'dev2');
      expect(result.dev2).toBe(1);
    });

    it('should not mutate input', () => {
      const vector: VersionVector = { dev1: 3 };
      incrementVector(vector, 'dev1');
      expect(vector.dev1).toBe(3);
    });
  });

  describe('compactVector', () => {
    it('should not compact when below threshold', () => {
      const vector: VersionVector = { dev1: 1, dev2: 2, dev3: 3 };
      const lastActive = new Map<string, Date>();
      const result = compactVector(vector, lastActive);
      expect(result).toEqual(vector);
    });

    it('should compact inactive devices when above threshold', () => {
      // Create 12 devices (> 10 threshold)
      const vector: VersionVector = {};
      const lastActive = new Map<string, Date>();
      const now = Date.now();
      const ninetyOneDaysAgo = new Date(now - 91 * 24 * 60 * 60 * 1000);
      const yesterday = new Date(now - 24 * 60 * 60 * 1000);

      // 8 active devices
      for (let i = 0; i < 8; i++) {
        vector[`active_${i}`] = i + 1;
        lastActive.set(`active_${i}`, yesterday);
      }

      // 4 inactive devices (>90 days)
      for (let i = 0; i < 4; i++) {
        vector[`inactive_${i}`] = (i + 1) * 10;
        lastActive.set(`inactive_${i}`, ninetyOneDaysAgo);
      }

      const result = compactVector(vector, lastActive);

      // Should have 8 active + _inactive key
      for (let i = 0; i < 8; i++) {
        expect(result[`active_${i}`]).toBe(i + 1);
      }

      // Inactive should be compacted: 10 + 20 + 30 + 40 = 100
      expect(result._inactive).toBe(100);
      expect(result['inactive_0']).toBeUndefined();
    });

    it('should preserve existing _inactive and add to it', () => {
      const vector: VersionVector = { _inactive: 50 };
      const lastActive = new Map<string, Date>();
      const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Add 11 devices to trigger compaction
      for (let i = 0; i < 8; i++) {
        vector[`active_${i}`] = 1;
        lastActive.set(`active_${i}`, yesterday);
      }
      for (let i = 0; i < 3; i++) {
        vector[`old_${i}`] = 10;
        lastActive.set(`old_${i}`, ninetyOneDaysAgo);
      }

      const result = compactVector(vector, lastActive);
      // _inactive should be 50 (existing) + 30 (3 devices * 10)
      expect(result._inactive).toBe(80);
    });
  });
});

// ============================================================
// DEVICE & CLOCK FUNCTIONS
// ============================================================

describe('Device & Clock Functions', () => {
  describe('generateDeviceId', () => {
    it('should prefix with platform name', () => {
      const id = generateDeviceId('ios');
      expect(id.startsWith('ios_')).toBe(true);
    });

    it('should generate unique IDs', () => {
      const id1 = generateDeviceId('mac');
      const id2 = generateDeviceId('mac');
      expect(id1).not.toBe(id2);
    });

    it('should work for all platforms', () => {
      for (const platform of NSE_PLATFORMS) {
        const id = generateDeviceId(platform);
        expect(id.startsWith(`${platform}_`)).toBe(true);
      }
    });
  });

  describe('updateClockDrift', () => {
    it('should apply EMA with weight 0.2', () => {
      const result = updateClockDrift(100, 200);
      // (1-0.2)*100 + 0.2*200 = 80 + 40 = 120
      expect(result).toBe(120);
    });

    it('should converge on stable samples', () => {
      let drift = 0;
      for (let i = 0; i < 20; i++) {
        drift = updateClockDrift(drift, 100);
      }
      // After many samples of 100, should be close to 100
      expect(drift).toBeGreaterThan(95);
    });

    it('should handle zero drift', () => {
      expect(updateClockDrift(0, 0)).toBe(0);
    });
  });

  describe('adjustedTimestamp', () => {
    it('should subtract drift from local time', () => {
      const local = new Date('2024-01-01T12:00:00Z');
      const adjusted = adjustedTimestamp(local, 5000); // 5s drift
      expect(adjusted.getTime()).toBe(local.getTime() - 5000);
    });

    it('should handle negative drift', () => {
      const local = new Date('2024-01-01T12:00:00Z');
      const adjusted = adjustedTimestamp(local, -3000);
      expect(adjusted.getTime()).toBe(local.getTime() + 3000);
    });

    it('should handle zero drift', () => {
      const local = new Date('2024-01-01T12:00:00Z');
      const adjusted = adjustedTimestamp(local, 0);
      expect(adjusted.getTime()).toBe(local.getTime());
    });
  });

  describe('getDefaultDeviceName', () => {
    it('should return iPhone for ios', () => {
      expect(getDefaultDeviceName('ios')).toBe('iPhone');
    });

    it('should return correct names for all platforms', () => {
      expect(getDefaultDeviceName('android')).toBe('Android Device');
      expect(getDefaultDeviceName('mac')).toBe('Mac');
      expect(getDefaultDeviceName('win')).toBe('Windows PC');
      expect(getDefaultDeviceName('web')).toBe('Web Browser');
    });
  });
});

// ============================================================
// NESTED VALUE UTILITIES
// ============================================================

describe('Nested Value Utilities', () => {
  describe('getNestedValue', () => {
    it('should access top-level properties', () => {
      expect(getNestedValue({ title: 'Test' }, 'title')).toBe('Test');
    });

    it('should access nested properties', () => {
      const obj = { content: { title: 'Hello' } };
      expect(getNestedValue(obj, 'content.title')).toBe('Hello');
    });

    it('should return undefined for missing paths', () => {
      const obj = { content: {} };
      expect(getNestedValue(obj, 'content.title')).toBeUndefined();
    });

    it('should return undefined for completely missing parent', () => {
      const obj = {};
      expect(getNestedValue(obj, 'content.title')).toBeUndefined();
    });

    it('should handle deeply nested paths', () => {
      const obj = { a: { b: { c: { d: 42 } } } };
      expect(getNestedValue(obj, 'a.b.c.d')).toBe(42);
    });
  });

  describe('setNestedValue', () => {
    it('should set top-level properties', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'title', 'Test');
      expect(obj.title).toBe('Test');
    });

    it('should set nested properties', () => {
      const obj: Record<string, unknown> = { content: {} };
      setNestedValue(obj, 'content.title', 'Hello');
      expect((obj.content as Record<string, unknown>).title).toBe('Hello');
    });

    it('should create intermediate objects', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'content.title', 'Hello');
      expect((obj.content as Record<string, unknown>).title).toBe('Hello');
    });

    it('should overwrite existing values', () => {
      const obj: Record<string, unknown> = { content: { title: 'Old' } };
      setNestedValue(obj, 'content.title', 'New');
      expect((obj.content as Record<string, unknown>).title).toBe('New');
    });
  });

  describe('deepEqual', () => {
    it('should return true for identical primitives', () => {
      expect(deepEqual(42, 42)).toBe(true);
      expect(deepEqual('hello', 'hello')).toBe(true);
      expect(deepEqual(true, true)).toBe(true);
    });

    it('should return false for different primitives', () => {
      expect(deepEqual(42, 43)).toBe(false);
      expect(deepEqual('hello', 'world')).toBe(false);
    });

    it('should handle null and undefined', () => {
      expect(deepEqual(null, null)).toBe(true);
      expect(deepEqual(undefined, undefined)).toBe(true);
      expect(deepEqual(null, undefined)).toBe(false);
    });

    it('should compare arrays', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
      expect(deepEqual([1, 2, 3], [1, 3, 2])).toBe(false);
    });

    it('should compare objects', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
      expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });

    it('should compare nested structures', () => {
      const a = { x: { y: [1, 2, 3] } };
      const b = { x: { y: [1, 2, 3] } };
      expect(deepEqual(a, b)).toBe(true);
    });

    it('should handle type mismatches', () => {
      expect(deepEqual(42, '42')).toBe(false);
      expect(deepEqual([], {})).toBe(false);
    });
  });
});

// ============================================================
// CHANGE SET COMPUTATION
// ============================================================

describe('Change Set Computation', () => {
  describe('computeChangeSet', () => {
    it('should detect changed fields', () => {
      const base = {
        id: 'node-1',
        content: { title: 'Old Title', body: 'Same', summary: 'Summary' },
        organization: { tags: ['a'], cluster_memberships: [] },
        neural: { stability: 0.5, retrievability: 0.5, difficulty: 0.5, importance: 0.5 },
        temporal: { last_accessed: '2024-01-01T00:00:00Z', access_count: 10 },
        state: { lifecycle: 'active', flags: [] },
      };

      const current = {
        id: 'node-1',
        content: { title: 'New Title', body: 'Same', summary: 'Summary' },
        organization: { tags: ['a', 'b'], cluster_memberships: [] },
        neural: { stability: 0.5, retrievability: 0.5, difficulty: 0.5, importance: 0.5 },
        temporal: { last_accessed: '2024-01-01T00:00:00Z', access_count: 12 },
        state: { lifecycle: 'active', flags: [] },
      };

      const cs = computeChangeSet(base, current, 'dev1');

      expect(cs.node_id).toBe('node-1');
      expect(cs.device_id).toBe('dev1');
      expect(cs.changes.length).toBe(3); // title, tags, access_count

      const changedFields = cs.changes.map(c => c.field);
      expect(changedFields).toContain('content.title');
      expect(changedFields).toContain('organization.tags');
      expect(changedFields).toContain('temporal.access_count');
    });

    it('should handle null base (new node)', () => {
      const current = {
        id: 'node-1',
        content: { title: 'Title', body: 'Body', summary: '' },
        organization: { tags: [], cluster_memberships: [] },
        neural: { stability: 0.5, retrievability: 0.5, difficulty: 0.5, importance: 0.5 },
        temporal: { last_accessed: '2024-01-01T00:00:00Z', access_count: 1 },
        state: { lifecycle: 'active', flags: [] },
      };

      const cs = computeChangeSet(null, current, 'dev1');

      // All fields with non-undefined values should appear as changes
      expect(cs.changes.length).toBeGreaterThan(0);
      expect(cs.node_id).toBe('node-1');
    });

    it('should return empty changes for identical nodes', () => {
      const node = {
        id: 'node-1',
        content: { title: 'Title', body: 'Body', summary: '' },
        organization: { tags: ['a'], cluster_memberships: [] },
        neural: { stability: 0.5, retrievability: 0.5, difficulty: 0.5, importance: 0.5 },
        temporal: { last_accessed: '2024-01-01T00:00:00Z', access_count: 1 },
        state: { lifecycle: 'active', flags: [] },
      };

      const cs = computeChangeSet(node, node, 'dev1');
      expect(cs.changes.length).toBe(0);
    });

    it('should include old and new values in changes', () => {
      const base = {
        id: 'node-1',
        content: { title: 'Old' },
      };
      const current = {
        id: 'node-1',
        content: { title: 'New' },
      };

      const cs = computeChangeSet(base, current, 'dev1');
      const titleChange = cs.changes.find(c => c.field === 'content.title');
      expect(titleChange?.old_value).toBe('Old');
      expect(titleChange?.new_value).toBe('New');
    });
  });
});

// ============================================================
// MERGE STRATEGIES
// ============================================================

describe('Merge Strategies', () => {
  const localTime = '2024-01-01T10:00:00Z';
  const remoteTime = '2024-01-01T11:00:00Z';

  describe('getFieldMergeStrategy', () => {
    it('should return correct strategy for known fields', () => {
      expect(getFieldMergeStrategy('content.body')).toBe('conflict');
      expect(getFieldMergeStrategy('content.title')).toBe('latest_wins');
      expect(getFieldMergeStrategy('neural.stability')).toBe('max');
      expect(getFieldMergeStrategy('temporal.access_count')).toBe('sum');
    });

    it('should default to latest_wins for unknown fields', () => {
      expect(getFieldMergeStrategy('unknown.field')).toBe('latest_wins');
    });
  });

  describe('applyStrategy - conflict', () => {
    it('should always return isConflict: true', () => {
      const result = applyStrategy('conflict', 'local', 'remote', localTime, remoteTime);
      expect(result.isConflict).toBe(true);
      expect(result.value).toBeUndefined();
    });
  });

  describe('applyStrategy - latest_wins', () => {
    it('should take remote when remote is later', () => {
      const result = applyStrategy('latest_wins', 'local', 'remote', localTime, remoteTime);
      expect(result.value).toBe('remote');
      expect(result.isConflict).toBe(false);
    });

    it('should take local when local is later', () => {
      const result = applyStrategy('latest_wins', 'local', 'remote', remoteTime, localTime);
      expect(result.value).toBe('local');
    });

    it('should take local when timestamps are equal', () => {
      const result = applyStrategy('latest_wins', 'local', 'remote', localTime, localTime);
      expect(result.value).toBe('local');
    });
  });

  describe('applyStrategy - max', () => {
    it('should return maximum of two numbers', () => {
      const result = applyStrategy('max', 0.7, 0.9, localTime, remoteTime);
      expect(result.value).toBe(0.9);
      expect(result.isConflict).toBe(false);
    });

    it('should handle equal values', () => {
      const result = applyStrategy('max', 0.5, 0.5, localTime, remoteTime);
      expect(result.value).toBe(0.5);
    });

    it('should fall back to local for non-numbers', () => {
      const result = applyStrategy('max', 'a', 'b', localTime, remoteTime);
      expect(result.value).toBe('a');
    });
  });

  describe('applyStrategy - min', () => {
    it('should return minimum of two numbers', () => {
      const result = applyStrategy('min', 0.7, 0.3, localTime, remoteTime);
      expect(result.value).toBe(0.3);
    });
  });

  describe('applyStrategy - sum (delta-based)', () => {
    it('should sum deltas from base values', () => {
      // base=10, local=15(+5), remote=13(+3) → 10+5+3=18
      const result = applyStrategy('sum', 15, 13, localTime, remoteTime, 10, 10);
      expect(result.value).toBe(18);
      expect(result.isConflict).toBe(false);
    });

    it('should handle different base values correctly', () => {
      // localOld=10, localNew=15(+5), remoteOld=10, remoteNew=12(+2) → 10+5+2=17
      const result = applyStrategy('sum', 15, 12, localTime, remoteTime, 10, 10);
      expect(result.value).toBe(17);
    });

    it('should fall back to absolute sum when old values missing', () => {
      const result = applyStrategy('sum', 5, 3, localTime, remoteTime);
      expect(result.value).toBe(8);
    });

    it('should handle zero deltas', () => {
      // base=10, local=10(+0), remote=10(+0) → 10
      const result = applyStrategy('sum', 10, 10, localTime, remoteTime, 10, 10);
      expect(result.value).toBe(10);
    });

    it('should handle negative deltas', () => {
      // base=10, local=8(-2), remote=7(-3) → 10-2-3=5
      const result = applyStrategy('sum', 8, 7, localTime, remoteTime, 10, 10);
      expect(result.value).toBe(5);
    });
  });

  describe('applyStrategy - average', () => {
    it('should return average of two numbers', () => {
      const result = applyStrategy('average', 0.4, 0.6, localTime, remoteTime);
      expect(result.value).toBe(0.5);
    });
  });

  describe('applyStrategy - max_timestamp', () => {
    it('should take later timestamp', () => {
      const result = applyStrategy(
        'max_timestamp',
        '2024-01-01T10:00:00Z',
        '2024-01-01T12:00:00Z',
        localTime,
        remoteTime
      );
      expect(result.value).toBe('2024-01-01T12:00:00Z');
    });
  });

  describe('applyStrategy - union', () => {
    it('should merge arrays with deduplication', () => {
      const result = applyStrategy('union', ['a', 'b'], ['b', 'c'], localTime, remoteTime);
      const arr = result.value as string[];
      expect(arr).toContain('a');
      expect(arr).toContain('b');
      expect(arr).toContain('c');
      expect(arr.length).toBe(3);
    });

    it('should handle empty arrays', () => {
      const result = applyStrategy('union', [], ['a'], localTime, remoteTime);
      expect(result.value).toEqual(['a']);
    });

    it('should fall back to local for non-arrays', () => {
      const result = applyStrategy('union', 'not_array', 'also_not', localTime, remoteTime);
      expect(result.value).toBe('not_array');
    });
  });

  describe('applyStrategy - merge_memberships', () => {
    it('should merge cluster memberships', () => {
      const local: ClusterMembershipForMerge[] = [
        { cluster_id: 'c1', strength: 0.8, pinned: false },
      ];
      const remote: ClusterMembershipForMerge[] = [
        { cluster_id: 'c1', strength: 0.9, pinned: true },
        { cluster_id: 'c2', strength: 0.5, pinned: false },
      ];

      const result = applyStrategy('merge_memberships', local, remote, localTime, remoteTime);
      const merged = result.value as ClusterMembershipForMerge[];

      expect(merged.length).toBe(2);
      const c1 = merged.find(m => m.cluster_id === 'c1');
      expect(c1?.strength).toBe(0.9); // max strength
      expect(c1?.pinned).toBe(true); // pinned preserved from either side
    });
  });

  describe('applyStrategy - keep_original / keep_local', () => {
    it('should always return local value for keep_original', () => {
      const result = applyStrategy('keep_original', 'local', 'remote', localTime, remoteTime);
      expect(result.value).toBe('local');
    });

    it('should always return local value for keep_local', () => {
      const result = applyStrategy('keep_local', 'local', 'remote', localTime, remoteTime);
      expect(result.value).toBe('local');
    });
  });

  describe('mergeMemberships', () => {
    it('should union memberships from both sides', () => {
      const local: ClusterMembershipForMerge[] = [
        { cluster_id: 'c1', strength: 0.7, pinned: false },
      ];
      const remote: ClusterMembershipForMerge[] = [
        { cluster_id: 'c2', strength: 0.5, pinned: true },
      ];

      const result = mergeMemberships(local, remote);
      expect(result.length).toBe(2);
    });

    it('should take max strength for overlapping clusters', () => {
      const local: ClusterMembershipForMerge[] = [
        { cluster_id: 'c1', strength: 0.7, pinned: false },
      ];
      const remote: ClusterMembershipForMerge[] = [
        { cluster_id: 'c1', strength: 0.9, pinned: false },
      ];

      const result = mergeMemberships(local, remote);
      expect(result.length).toBe(1);
      expect(result[0]?.strength).toBe(0.9);
    });

    it('should preserve pinned from either side', () => {
      const local: ClusterMembershipForMerge[] = [
        { cluster_id: 'c1', strength: 0.5, pinned: true },
      ];
      const remote: ClusterMembershipForMerge[] = [
        { cluster_id: 'c1', strength: 0.5, pinned: false },
      ];

      const result = mergeMemberships(local, remote);
      expect(result[0]?.pinned).toBe(true);
    });

    it('should handle empty arrays', () => {
      expect(mergeMemberships([], []).length).toBe(0);
      expect(mergeMemberships([{ cluster_id: 'c1', strength: 0.5, pinned: false }], []).length).toBe(1);
    });
  });
});

// ============================================================
// AUTO-MERGE ALGORITHM
// ============================================================

describe('Auto-Merge Algorithm', () => {
  const makeNode = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'node-1',
    content: { title: 'Title', body: 'Body', summary: 'Summary' },
    organization: { tags: ['a'], cluster_memberships: [] },
    neural: { stability: 0.5, retrievability: 0.5, difficulty: 0.5, importance: 0.5 },
    temporal: { last_accessed: '2024-01-01T00:00:00Z', access_count: 10 },
    state: { lifecycle: 'active', flags: [] },
    ...overrides,
  });

  const makeChangeSet = (
    changes: FieldChange[],
    timestamp = '2024-01-01T10:00:00Z'
  ): ChangeSet => ({
    node_id: 'node-1',
    device_id: 'dev1',
    timestamp,
    changes,
  });

  it('should auto-merge when fields do not overlap', () => {
    const local = makeNode();
    const remote = makeNode();

    const localCS = makeChangeSet([
      { field: 'content.title', old_value: 'Old', new_value: 'New Title' },
    ], '2024-01-01T10:00:00Z');

    const remoteCS = makeChangeSet([
      { field: 'organization.tags', old_value: ['a'], new_value: ['a', 'b'] },
    ], '2024-01-01T11:00:00Z');

    const result = nseAutoMerge(local, remote, localCS, remoteCS);

    expect(result.status).toBe('merged');
    expect(result.mergedNode).toBeDefined();
    // Remote tag change should be applied
    expect(getNestedValue(result.mergedNode!, 'organization.tags')).toEqual(['a', 'b']);
  });

  it('should auto-resolve neural fields with max strategy', () => {
    const local = makeNode();
    const remote = makeNode();

    const localCS = makeChangeSet([
      { field: 'neural.stability', old_value: 0.5, new_value: 0.7 },
    ]);
    const remoteCS = makeChangeSet([
      { field: 'neural.stability', old_value: 0.5, new_value: 0.9 },
    ]);

    const result = nseAutoMerge(local, remote, localCS, remoteCS);

    expect(result.status).toBe('merged');
    expect(getNestedValue(result.mergedNode!, 'neural.stability')).toBe(0.9);
  });

  it('should produce conflict for content.body changes', () => {
    const local = makeNode();
    const remote = makeNode();

    const localCS = makeChangeSet([
      { field: 'content.body', old_value: 'Body', new_value: 'Local edit' },
    ], '2024-01-01T10:00:00Z');
    const remoteCS = makeChangeSet([
      { field: 'content.body', old_value: 'Body', new_value: 'Remote edit' },
    ], '2024-01-01T11:00:00Z');

    const result = nseAutoMerge(local, remote, localCS, remoteCS);

    expect(result.status).toBe('conflict');
    expect(result.conflicts).toBeDefined();
    expect(result.conflicts!.length).toBe(1);
    expect(result.conflicts![0]?.field).toBe('content.body');
    expect(result.conflicts![0]?.localValue).toBe('Local edit');
    expect(result.conflicts![0]?.remoteValue).toBe('Remote edit');
  });

  it('should return partially merged node even on conflict', () => {
    const local = makeNode();
    const remote = makeNode();

    // Both: content.body conflict. Remote-only: tags change.
    const localCS = makeChangeSet([
      { field: 'content.body', old_value: 'Body', new_value: 'Local edit' },
    ]);
    const remoteCS = makeChangeSet([
      { field: 'content.body', old_value: 'Body', new_value: 'Remote edit' },
      { field: 'organization.tags', old_value: ['a'], new_value: ['a', 'b'] },
    ]);

    const result = nseAutoMerge(local, remote, localCS, remoteCS);

    expect(result.status).toBe('conflict');
    expect(result.mergedNode).toBeDefined();
    // Non-conflicting tag change should be applied to mergedNode
    expect(getNestedValue(result.mergedNode!, 'organization.tags')).toEqual(['a', 'b']);
  });

  it('should handle empty change sets', () => {
    const local = makeNode();
    const remote = makeNode();

    const localCS = makeChangeSet([]);
    const remoteCS = makeChangeSet([]);

    const result = nseAutoMerge(local, remote, localCS, remoteCS);
    expect(result.status).toBe('merged');
  });

  it('should use sum with deltas for access_count', () => {
    const local = makeNode();
    const remote = makeNode();

    // base was 10, local went to 15 (+5), remote went to 13 (+3)
    const localCS = makeChangeSet([
      { field: 'temporal.access_count', old_value: 10, new_value: 15 },
    ]);
    const remoteCS = makeChangeSet([
      { field: 'temporal.access_count', old_value: 10, new_value: 13 },
    ]);

    const result = nseAutoMerge(local, remote, localCS, remoteCS);
    expect(result.status).toBe('merged');
    // Should be 10 + 5 + 3 = 18, NOT 15 + 13 = 28
    expect(getNestedValue(result.mergedNode!, 'temporal.access_count')).toBe(18);
  });

  it('should apply remote-only changes without conflict', () => {
    const local = makeNode();
    const remote = makeNode();

    const localCS = makeChangeSet([]); // No local changes
    const remoteCS = makeChangeSet([
      { field: 'content.title', old_value: 'Title', new_value: 'Updated Title' },
      { field: 'neural.stability', old_value: 0.5, new_value: 0.8 },
    ]);

    const result = nseAutoMerge(local, remote, localCS, remoteCS);
    expect(result.status).toBe('merged');
    expect(getNestedValue(result.mergedNode!, 'content.title')).toBe('Updated Title');
    expect(getNestedValue(result.mergedNode!, 'neural.stability')).toBe(0.8);
  });

  it('should use latest_wins for overlapping title changes', () => {
    const local = makeNode();
    const remote = makeNode();

    const localCS = makeChangeSet([
      { field: 'content.title', old_value: 'Title', new_value: 'Local Title' },
    ], '2024-01-01T10:00:00Z');
    const remoteCS = makeChangeSet([
      { field: 'content.title', old_value: 'Title', new_value: 'Remote Title' },
    ], '2024-01-01T11:00:00Z'); // Remote is later

    const result = nseAutoMerge(local, remote, localCS, remoteCS);
    expect(result.status).toBe('merged');
    expect(getNestedValue(result.mergedNode!, 'content.title')).toBe('Remote Title');
  });
});

// ============================================================
// PRIVATE TIER
// ============================================================

describe('Private Tier', () => {
  describe('detectPrivateTierConflict', () => {
    it('should detect conflict when checksums differ', () => {
      const local: PrivateTierPayload = {
        id: 'node-1',
        version: { dev1: 1 },
        content_checksum: 'checksum_a',
        encrypted_payload: 'encrypted_a',
        nonce: 'nonce_a',
        last_modified_at: '2024-01-01T00:00:00Z',
      };

      const remote: PrivateTierPayload = {
        id: 'node-1',
        version: { dev2: 1 },
        content_checksum: 'checksum_b',
        encrypted_payload: 'encrypted_b',
        nonce: 'nonce_b',
        last_modified_at: '2024-01-01T01:00:00Z',
      };

      expect(detectPrivateTierConflict(local, remote)).toBe(true);
    });

    it('should not detect conflict when checksums match', () => {
      const local: PrivateTierPayload = {
        id: 'node-1',
        version: { dev1: 1 },
        content_checksum: 'same_checksum',
        encrypted_payload: 'encrypted_a',
        nonce: 'nonce_a',
        last_modified_at: '2024-01-01T00:00:00Z',
      };

      const remote: PrivateTierPayload = {
        id: 'node-1',
        version: { dev2: 1 },
        content_checksum: 'same_checksum',
        encrypted_payload: 'encrypted_a',
        nonce: 'nonce_a',
        last_modified_at: '2024-01-01T01:00:00Z',
      };

      expect(detectPrivateTierConflict(local, remote)).toBe(false);
    });
  });
});

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

describe('Factory Functions', () => {
  describe('createSyncMetadata', () => {
    it('should create metadata with correct defaults', () => {
      const meta = createSyncMetadata('dev1');

      expect(meta._schemaVersion).toBe(1);
      expect(meta.version).toEqual({ dev1: 1 });
      expect(meta.last_modified_by).toBe('dev1');
      expect(meta.sync_status).toBe('pending');
      expect(meta.last_modified_at).toBeDefined();
      expect(meta.last_synced_at).toBeDefined();
    });

    it('should accept custom sync status', () => {
      const meta = createSyncMetadata('dev1', 'synced');
      expect(meta.sync_status).toBe('synced');
    });

    it('should pass validation', () => {
      const meta = createSyncMetadata('dev1');
      expect(validateSyncMetadata(meta)).toBe(true);
    });
  });

  describe('createDeviceInfo', () => {
    it('should create device info with platform prefix', () => {
      const info = createDeviceInfo('ios');

      expect(info._schemaVersion).toBe(1);
      expect(info.device_id.startsWith('ios_')).toBe(true);
      expect(info.platform).toBe('ios');
      expect(info.display_name).toBe('iPhone');
      expect(info.clock_drift_ms).toBe(0);
      expect(info.schema_version).toBe('2');
    });

    it('should accept custom schema version', () => {
      const info = createDeviceInfo('mac', '3');
      expect(info.schema_version).toBe('3');
    });

    it('should pass validation', () => {
      const info = createDeviceInfo('web');
      expect(validateDeviceInfo(info)).toBe(true);
    });
  });

  describe('createBadgeState', () => {
    it('should be visible when conflicts > 0', () => {
      const state = createBadgeState(3);
      expect(state.conflict_count).toBe(3);
      expect(state.visible).toBe(true);
    });

    it('should not be visible when conflicts = 0', () => {
      const state = createBadgeState(0);
      expect(state.conflict_count).toBe(0);
      expect(state.visible).toBe(false);
    });
  });

  describe('createStoredConflict', () => {
    it('should create stored conflict with 30-day expiry', () => {
      const conflict = createStoredConflict(
        'node-1',
        { title: 'Local' },
        { title: 'Remote' },
        [{
          field: 'content.body',
          localValue: 'local text',
          remoteValue: 'remote text',
          localTimestamp: '2024-01-01T00:00:00Z',
          remoteTimestamp: '2024-01-01T01:00:00Z',
        }]
      );

      expect(conflict._schemaVersion).toBe(1);
      expect(conflict.node_id).toBe('node-1');
      expect(conflict.conflicts.length).toBe(1);

      // Verify expiry is ~30 days in the future
      const created = new Date(conflict.created_at).getTime();
      const expires = new Date(conflict.expires_at).getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(expires - created).toBe(thirtyDaysMs);
    });

    it('should pass validation', () => {
      const conflict = createStoredConflict(
        'node-1',
        { title: 'Local' },
        { title: 'Remote' },
        [{
          field: 'content.body',
          localValue: 'local',
          remoteValue: 'remote',
          localTimestamp: '2024-01-01T00:00:00Z',
          remoteTimestamp: '2024-01-01T01:00:00Z',
        }]
      );
      expect(validateNSEStoredConflict(conflict)).toBe(true);
    });
  });

  describe('createConflictHistoryEntry', () => {
    it('should create history entry with 30-day expiry', () => {
      const entry = createConflictHistoryEntry('node-1', { title: 'Rejected' }, 'user');

      expect(entry._schemaVersion).toBe(1);
      expect(entry.node_id).toBe('node-1');
      expect(entry.resolved_by).toBe('user');

      const resolved = new Date(entry.resolved_at).getTime();
      const expires = new Date(entry.expires_at).getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(expires - resolved).toBe(thirtyDaysMs);
    });

    it('should accept auto resolver', () => {
      const entry = createConflictHistoryEntry('node-1', {}, 'auto');
      expect(entry.resolved_by).toBe('auto');
    });
  });

  describe('isEmbeddingCompatible', () => {
    it('should return true for matching models', () => {
      expect(isEmbeddingCompatible('openai-3-small', 'openai-3-small')).toBe(true);
    });

    it('should return false for different models', () => {
      expect(isEmbeddingCompatible('openai-3-small', 'openai-3-large')).toBe(false);
    });

    it('should return false for different versions', () => {
      expect(isEmbeddingCompatible('openai-3-small-2024', 'openai-3-small-2025')).toBe(false);
    });
  });
});

// ============================================================
// VALIDATION FUNCTIONS
// ============================================================

describe('Validation Functions', () => {
  it('should validate version vectors', () => {
    expect(validateVersionVector({ dev1: 3, dev2: 5 })).toBe(true);
    expect(validateVersionVector({ dev1: -1 })).toBe(false);
    expect(validateVersionVector('not_an_object')).toBe(false);
  });

  it('should reject invalid push payload', () => {
    expect(validatePushPayload({})).toBe(false);
    expect(validatePushPayload({ id: '' })).toBe(false);
  });

  it('should reject invalid private tier payload', () => {
    expect(validatePrivateTierPayload({})).toBe(false);
  });

  it('should reject invalid user resolution', () => {
    expect(validateNSEUserResolution({})).toBe(false);
    expect(validateNSEUserResolution({ node_id: 'x', resolution: 'invalid' })).toBe(false);
  });
});
