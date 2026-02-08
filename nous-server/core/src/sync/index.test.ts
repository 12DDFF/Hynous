/**
 * @module @nous/core/sync
 * @description Tests for sync infrastructure
 */

import { describe, it, expect } from 'vitest';
import {
  // Sync Manager
  SYNC_STATUSES,
  SYNC_EVENT_TYPES,
  CONFLICT_RESOLUTION_CHOICES,
  DEFAULT_LOCK_DURATION_SECONDS,
  createInitialSyncState,
  createDefaultSyncManagerOptions,
  createSyncLock,
  isSyncLockValid,
  isSyncLockExpired,
  validateSyncState,
  validateSyncManagerOptions,
  validateSyncLock,
  type SyncState,
  type SyncManagerOptions,
  type SyncLock,

  // Conflict Resolution
  CONFLICT_STRENGTHS,
  FIELD_CATEGORIES,
  RESOLUTION_ACTIONS,
  MERGE_STRATEGIES,
  FIELD_CATEGORY_MAP,
  FIELD_MERGE_STRATEGIES,
  getFieldCategory,
  getFieldCategories,
  classifyConflictStrength,
  canAutoResolveConflict,
  getMergeStrategy,
  applyMergeStrategy,
  attemptAutoMerge,
  validateDetectedConflict,
  validateConflictResolution,
  type DetectedConflict,
  type ConflictResolution,

  // Health
  HEALTH_STATUSES,
  HEALTH_THRESHOLDS,
  createEmptyHealthMetrics,
  assessHealth,
  generateDebugReport,
  validateHealthMetrics,
  validateHealthAssessment,
  type HealthMetrics,
  type HealthAssessment,
} from './index';

describe('Sync Manager', () => {
  describe('SYNC_STATUSES', () => {
    it('should have all expected statuses', () => {
      expect(SYNC_STATUSES).toEqual([
        'idle',
        'syncing',
        'paused',
        'error',
        'offline',
      ]);
    });
  });

  describe('SYNC_EVENT_TYPES', () => {
    it('should have all expected event types', () => {
      expect(SYNC_EVENT_TYPES).toContain('sync_started');
      expect(SYNC_EVENT_TYPES).toContain('sync_completed');
      expect(SYNC_EVENT_TYPES).toContain('sync_failed');
      expect(SYNC_EVENT_TYPES).toContain('conflict_detected');
    });
  });

  describe('createInitialSyncState', () => {
    it('should create valid initial state', () => {
      const state = createInitialSyncState();

      expect(state.status).toBe('idle');
      expect(state.lastSyncAt).toBeNull();
      expect(state.pendingChanges).toBe(0);
      expect(state.unresolvedConflicts).toBe(0);
      expect(state.progress).toBe(0);
      expect(state.failedAttempts).toBe(0);
    });

    it('should pass validation', () => {
      const state = createInitialSyncState();
      expect(validateSyncState(state)).toBe(true);
    });
  });

  describe('createDefaultSyncManagerOptions', () => {
    it('should create valid default options', () => {
      const options = createDefaultSyncManagerOptions();

      expect(options.minIntervalMs).toBe(60_000);
      expect(options.maxRetries).toBe(3);
      expect(options.batchSize).toBe(100);
      expect(options.autoSync).toBe(true);
    });

    it('should pass validation', () => {
      const options = createDefaultSyncManagerOptions();
      expect(validateSyncManagerOptions(options)).toBe(true);
    });
  });

  describe('Sync Lock', () => {
    it('should have default lock duration', () => {
      expect(DEFAULT_LOCK_DURATION_SECONDS).toBe(30);
    });

    it('should create sync lock', () => {
      const lock = createSyncLock('device-123');

      expect(lock.deviceId).toBe('device-123');
      expect(lock.acquiredAt).toBeDefined();
      expect(lock.expiresAt).toBeDefined();
    });

    it('should create lock with custom duration', () => {
      const lock = createSyncLock('device-123', 60);

      const acquired = new Date(lock.acquiredAt).getTime();
      const expires = new Date(lock.expiresAt).getTime();

      expect(expires - acquired).toBe(60_000);
    });

    it('should validate fresh lock as valid', () => {
      const lock = createSyncLock('device-123');
      expect(isSyncLockValid(lock)).toBe(true);
      expect(isSyncLockExpired(lock)).toBe(false);
    });

    it('should validate expired lock as invalid', () => {
      const lock: SyncLock = {
        deviceId: 'device-123',
        acquiredAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() - 30_000).toISOString(),
      };

      expect(isSyncLockValid(lock)).toBe(false);
      expect(isSyncLockExpired(lock)).toBe(true);
    });

    it('should pass validation for valid lock', () => {
      const lock = createSyncLock('device-123');
      expect(validateSyncLock(lock)).toBe(true);
    });
  });

  describe('CONFLICT_RESOLUTION_CHOICES', () => {
    it('should have all expected choices', () => {
      expect(CONFLICT_RESOLUTION_CHOICES).toEqual([
        'keep_local',
        'keep_cloud',
        'keep_both',
        'merge',
      ]);
    });
  });
});

describe('Conflict Resolution', () => {
  describe('CONFLICT_STRENGTHS', () => {
    it('should have weak and strong', () => {
      expect(CONFLICT_STRENGTHS).toEqual(['weak', 'strong']);
    });
  });

  describe('FIELD_CATEGORIES', () => {
    it('should have all expected categories', () => {
      expect(FIELD_CATEGORIES).toContain('content');
      expect(FIELD_CATEGORIES).toContain('metadata');
      expect(FIELD_CATEGORIES).toContain('neural');
      expect(FIELD_CATEGORIES).toContain('structural');
    });
  });

  describe('FIELD_CATEGORY_MAP', () => {
    it('should categorize content fields', () => {
      expect(FIELD_CATEGORY_MAP['content_title']).toBe('content');
      expect(FIELD_CATEGORY_MAP['content_body']).toBe('content');
    });

    it('should categorize neural fields', () => {
      expect(FIELD_CATEGORY_MAP['neural_stability']).toBe('neural');
      expect(FIELD_CATEGORY_MAP['neural_retrievability']).toBe('neural');
    });

    it('should categorize metadata fields', () => {
      expect(FIELD_CATEGORY_MAP['neural_access_count']).toBe('metadata');
    });
  });

  describe('getFieldCategory', () => {
    it('should return category for known fields', () => {
      expect(getFieldCategory('content_title')).toBe('content');
      expect(getFieldCategory('neural_stability')).toBe('neural');
    });

    it('should default to content for unknown fields', () => {
      expect(getFieldCategory('unknown_field')).toBe('content');
    });
  });

  describe('getFieldCategories', () => {
    it('should return unique categories', () => {
      const categories = getFieldCategories([
        'content_title',
        'content_body',
        'neural_stability',
      ]);

      expect(categories).toContain('content');
      expect(categories).toContain('neural');
      expect(categories.length).toBe(2);
    });
  });

  describe('classifyConflictStrength', () => {
    it('should return weak for non-overlapping changes', () => {
      const strength = classifyConflictStrength(
        ['content_title'],
        ['content_summary']
      );
      expect(strength).toBe('weak');
    });

    it('should return strong for overlapping content changes', () => {
      const strength = classifyConflictStrength(
        ['content_title'],
        ['content_title']
      );
      expect(strength).toBe('strong');
    });

    it('should return weak for overlapping metadata only', () => {
      const strength = classifyConflictStrength(
        ['neural_access_count'],
        ['neural_access_count']
      );
      expect(strength).toBe('weak');
    });
  });

  describe('canAutoResolveConflict', () => {
    it('should return false for strong conflicts', () => {
      const conflict: DetectedConflict = {
        nodeId: 'node-123',
        strength: 'strong',
        localVersion: 2,
        cloudVersion: 2,
        baseVersion: 1,
        localModifiedAt: new Date().toISOString(),
        cloudModifiedAt: new Date().toISOString(),
        fieldsInConflict: ['content_title'],
        conflictCategories: ['content'],
        canAutoResolve: false,
      };

      expect(canAutoResolveConflict(conflict)).toBe(false);
    });

    it('should return true for weak metadata-only conflicts', () => {
      const conflict: DetectedConflict = {
        nodeId: 'node-123',
        strength: 'weak',
        localVersion: 2,
        cloudVersion: 2,
        baseVersion: 1,
        localModifiedAt: new Date().toISOString(),
        cloudModifiedAt: new Date().toISOString(),
        fieldsInConflict: ['neural_access_count'],
        conflictCategories: ['metadata'],
        canAutoResolve: true,
      };

      expect(canAutoResolveConflict(conflict)).toBe(true);
    });
  });

  describe('MERGE_STRATEGIES', () => {
    it('should have all expected strategies', () => {
      expect(MERGE_STRATEGIES).toContain('take_local');
      expect(MERGE_STRATEGIES).toContain('take_cloud');
      expect(MERGE_STRATEGIES).toContain('take_latest');
      expect(MERGE_STRATEGIES).toContain('take_max');
      expect(MERGE_STRATEGIES).toContain('sum');
      expect(MERGE_STRATEGIES).toContain('user_choice');
    });
  });

  describe('FIELD_MERGE_STRATEGIES', () => {
    it('should require user choice for content', () => {
      expect(FIELD_MERGE_STRATEGIES['content_title']).toBe('user_choice');
      expect(FIELD_MERGE_STRATEGIES['content_body']).toBe('user_choice');
    });

    it('should use take_max for neural fields', () => {
      expect(FIELD_MERGE_STRATEGIES['neural_stability']).toBe('take_max');
      expect(FIELD_MERGE_STRATEGIES['neural_retrievability']).toBe('take_max');
    });

    it('should use sum for access count', () => {
      expect(FIELD_MERGE_STRATEGIES['neural_access_count']).toBe('sum');
    });
  });

  describe('getMergeStrategy', () => {
    it('should return strategy for known fields', () => {
      expect(getMergeStrategy('neural_stability')).toBe('take_max');
    });

    it('should default to user_choice for unknown fields', () => {
      expect(getMergeStrategy('unknown_field')).toBe('user_choice');
    });
  });

  describe('applyMergeStrategy', () => {
    const localTime = '2024-01-01T10:00:00Z';
    const cloudTime = '2024-01-01T11:00:00Z';

    it('should take local value', () => {
      const result = applyMergeStrategy(
        'take_local',
        'local',
        'cloud',
        localTime,
        cloudTime
      );
      expect(result.value).toBe('local');
      expect(result.source).toBe('local');
    });

    it('should take cloud value', () => {
      const result = applyMergeStrategy(
        'take_cloud',
        'local',
        'cloud',
        localTime,
        cloudTime
      );
      expect(result.value).toBe('cloud');
      expect(result.source).toBe('cloud');
    });

    it('should take latest value', () => {
      const result = applyMergeStrategy(
        'take_latest',
        'local',
        'cloud',
        localTime,
        cloudTime
      );
      expect(result.value).toBe('cloud'); // cloudTime is later
      expect(result.source).toBe('cloud');
    });

    it('should take max value', () => {
      const result = applyMergeStrategy(
        'take_max',
        0.7,
        0.9,
        localTime,
        cloudTime
      );
      expect(result.value).toBe(0.9);
      expect(result.source).toBe('cloud');
    });

    it('should take min value', () => {
      const result = applyMergeStrategy(
        'take_min',
        0.7,
        0.9,
        localTime,
        cloudTime
      );
      expect(result.value).toBe(0.7);
      expect(result.source).toBe('local');
    });

    it('should throw for user_choice', () => {
      expect(() =>
        applyMergeStrategy('user_choice', 'local', 'cloud', localTime, cloudTime)
      ).toThrow();
    });
  });

  describe('attemptAutoMerge', () => {
    it('should merge metadata fields', () => {
      const localData = { neural_access_count: 5, neural_stability: 0.7 };
      const cloudData = { neural_access_count: 3, neural_stability: 0.9 };

      const result = attemptAutoMerge(
        localData,
        cloudData,
        ['neural_access_count', 'neural_stability'],
        '2024-01-01T10:00:00Z',
        '2024-01-01T11:00:00Z',
        1
      );

      expect(result.success).toBe(true);
      expect(result.mergedFields.length).toBe(2);
      expect(result.unmergeableFields.length).toBe(0);
    });

    it('should fail for content fields', () => {
      const localData = { content_title: 'Local Title' };
      const cloudData = { content_title: 'Cloud Title' };

      const result = attemptAutoMerge(
        localData,
        cloudData,
        ['content_title'],
        '2024-01-01T10:00:00Z',
        '2024-01-01T11:00:00Z',
        1
      );

      expect(result.success).toBe(false);
      expect(result.unmergeableFields).toContain('content_title');
    });
  });

  describe('Validation', () => {
    it('should validate detected conflict', () => {
      const conflict: DetectedConflict = {
        nodeId: 'node-123',
        strength: 'weak',
        localVersion: 2,
        cloudVersion: 2,
        baseVersion: 1,
        localModifiedAt: new Date().toISOString(),
        cloudModifiedAt: new Date().toISOString(),
        fieldsInConflict: ['content_title'],
        conflictCategories: ['content'],
        canAutoResolve: false,
      };

      expect(validateDetectedConflict(conflict)).toBe(true);
    });

    it('should validate conflict resolution', () => {
      const resolution: ConflictResolution = {
        action: 'keep_local',
        resolvedVersion: 3,
        resolvedAt: new Date().toISOString(),
        resolvedBy: 'user',
      };

      expect(validateConflictResolution(resolution)).toBe(true);
    });
  });
});

describe('Health Monitoring', () => {
  describe('HEALTH_STATUSES', () => {
    it('should have all expected statuses', () => {
      expect(HEALTH_STATUSES).toEqual(['healthy', 'warning', 'error']);
    });
  });

  describe('HEALTH_THRESHOLDS', () => {
    it('should have sync warning threshold', () => {
      expect(HEALTH_THRESHOLDS.syncWarningSeconds).toBe(3600);
    });

    it('should have sync error threshold', () => {
      expect(HEALTH_THRESHOLDS.syncErrorSeconds).toBe(86400);
    });

    it('should have error threshold for 24h', () => {
      expect(HEALTH_THRESHOLDS.errorThreshold24h).toBe(5);
    });
  });

  describe('createEmptyHealthMetrics', () => {
    it('should create valid empty metrics', () => {
      const metrics = createEmptyHealthMetrics('1.0.0');

      expect(metrics.lastSuccessfulSync).toBeNull();
      expect(metrics.syncErrors24h).toBe(0);
      expect(metrics.pendingChanges).toBe(0);
      expect(metrics.appVersion).toBe('1.0.0');
    });

    it('should pass validation', () => {
      const metrics = createEmptyHealthMetrics('1.0.0');
      expect(validateHealthMetrics(metrics)).toBe(true);
    });
  });

  describe('assessHealth', () => {
    it('should return healthy for good metrics', () => {
      const metrics: HealthMetrics = {
        lastSuccessfulSync: Date.now() - 60_000, // 1 minute ago
        syncErrors24h: 0,
        pendingChanges: 0,
        unresolvedConflicts: 0,
        databaseSizeBytes: 1024,
        nodeCount: 10,
        edgeCount: 5,
        appVersion: '1.0.0',
        updatedAt: Date.now(),
      };

      const assessment = assessHealth(metrics);

      expect(assessment.status).toBe('healthy');
      expect(assessment.label).toBe('Everything OK');
      expect(assessment.issues.length).toBe(0);
    });

    it('should return warning for stale sync', () => {
      const metrics: HealthMetrics = {
        lastSuccessfulSync: Date.now() - 2 * 3600_000, // 2 hours ago
        syncErrors24h: 0,
        pendingChanges: 0,
        unresolvedConflicts: 0,
        databaseSizeBytes: 1024,
        nodeCount: 10,
        edgeCount: 5,
        appVersion: '1.0.0',
        updatedAt: Date.now(),
      };

      const assessment = assessHealth(metrics);

      expect(assessment.status).toBe('warning');
      expect(assessment.issues.length).toBeGreaterThan(0);
    });

    it('should return error for very stale sync', () => {
      const metrics: HealthMetrics = {
        lastSuccessfulSync: Date.now() - 25 * 3600_000, // 25 hours ago
        syncErrors24h: 0,
        pendingChanges: 0,
        unresolvedConflicts: 0,
        databaseSizeBytes: 1024,
        nodeCount: 10,
        edgeCount: 5,
        appVersion: '1.0.0',
        updatedAt: Date.now(),
      };

      const assessment = assessHealth(metrics);

      expect(assessment.status).toBe('error');
    });

    it('should return error for many sync errors', () => {
      const metrics: HealthMetrics = {
        lastSuccessfulSync: Date.now(),
        syncErrors24h: 10,
        pendingChanges: 0,
        unresolvedConflicts: 0,
        databaseSizeBytes: 1024,
        nodeCount: 10,
        edgeCount: 5,
        appVersion: '1.0.0',
        updatedAt: Date.now(),
      };

      const assessment = assessHealth(metrics);

      expect(assessment.status).toBe('error');
    });

    it('should return warning for conflicts', () => {
      const metrics: HealthMetrics = {
        lastSuccessfulSync: Date.now(),
        syncErrors24h: 0,
        pendingChanges: 0,
        unresolvedConflicts: 1,
        databaseSizeBytes: 1024,
        nodeCount: 10,
        edgeCount: 5,
        appVersion: '1.0.0',
        updatedAt: Date.now(),
      };

      const assessment = assessHealth(metrics);

      expect(assessment.status).toBe('warning');
      expect(assessment.recommendations.length).toBeGreaterThan(0);
    });

    it('should pass validation', () => {
      const metrics = createEmptyHealthMetrics('1.0.0');
      const assessment = assessHealth(metrics);
      expect(validateHealthAssessment(assessment)).toBe(true);
    });
  });

  describe('generateDebugReport', () => {
    it('should generate complete report', () => {
      const metrics = createEmptyHealthMetrics('1.0.0');
      const deviceInfo = {
        platform: 'ios',
        osVersion: '17.0',
        appVersion: '1.0.0',
        deviceId: 'device-123',
      };
      const dbStats = {
        sizeBytes: 1024,
        nodeCount: 10,
        edgeCount: 5,
        episodeCount: 2,
        schemaVersion: 2,
      };

      const report = generateDebugReport(metrics, deviceInfo, [], dbStats);

      expect(report.generatedAt).toBeDefined();
      expect(report.metrics).toBe(metrics);
      expect(report.assessment).toBeDefined();
      expect(report.device.platform).toBe('ios');
      expect(report.databaseStats.nodeCount).toBe(10);
    });

    it('should limit sync logs to 20', () => {
      const metrics = createEmptyHealthMetrics('1.0.0');
      const deviceInfo = {
        platform: 'ios',
        osVersion: '17.0',
        appVersion: '1.0.0',
        deviceId: 'device-123',
      };
      const dbStats = {
        sizeBytes: 1024,
        nodeCount: 10,
        edgeCount: 5,
        episodeCount: 2,
        schemaVersion: 2,
      };

      const manyLogs = Array(30)
        .fill(null)
        .map((_, i) => ({
          timestamp: new Date().toISOString(),
          event: `sync_${i}`,
          success: true,
        }));

      const report = generateDebugReport(metrics, deviceInfo, manyLogs, dbStats);

      expect(report.recentSyncLogs.length).toBe(20);
    });
  });
});
