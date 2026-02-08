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

import { z } from 'zod';

// ============================================================
// PLATFORM CONSTANTS
// ============================================================

export const NSE_PLATFORMS = ['ios', 'android', 'mac', 'win', 'web'] as const;
export type NSEPlatform = (typeof NSE_PLATFORMS)[number];
export const NSEPlatformSchema = z.enum(NSE_PLATFORMS);

export function isNSEPlatform(value: unknown): value is NSEPlatform {
  return NSE_PLATFORMS.includes(value as NSEPlatform);
}

// ============================================================
// NODE SYNC STATUS CONSTANTS
// ============================================================

export const NODE_SYNC_STATUSES = ['synced', 'pending', 'conflict'] as const;
export type NodeSyncStatus = (typeof NODE_SYNC_STATUSES)[number];
export const NodeSyncStatusSchema = z.enum(NODE_SYNC_STATUSES);

export function isNodeSyncStatus(value: unknown): value is NodeSyncStatus {
  return NODE_SYNC_STATUSES.includes(value as NodeSyncStatus);
}

// ============================================================
// VERSION VECTOR CONSTANTS
// ============================================================

export const VERSION_VECTOR_INACTIVE_KEY = '_inactive';
export const VECTOR_COMPACTION_THRESHOLD = 10;
export const DEVICE_INACTIVE_DAYS = 90;

// ============================================================
// VERSION COMPARISON CONSTANTS
// ============================================================

export const VERSION_COMPARISON_RESULTS = ['a_dominates', 'b_dominates', 'concurrent', 'equal'] as const;
export type VersionComparison = (typeof VERSION_COMPARISON_RESULTS)[number];
export const VersionComparisonSchema = z.enum(VERSION_COMPARISON_RESULTS);

export function isVersionComparison(value: unknown): value is VersionComparison {
  return VERSION_COMPARISON_RESULTS.includes(value as VersionComparison);
}

// ============================================================
// SYNC LOCK CONSTANTS
// ============================================================

export const NSE_SYNC_LOCK_TIMEOUT_SECONDS = 30;

// ============================================================
// BATCH SYNC CONSTANTS
// ============================================================

export const NSE_SYNC_BATCH_SIZE = 100;
export const UI_YIELD_DELAY_MS = 50;

// ============================================================
// CONFLICT HISTORY CONSTANTS
// ============================================================

export const CONFLICT_HISTORY_RETENTION_DAYS = 30;

// ============================================================
// NOTIFICATION CONSTANTS
// ============================================================

export const BANNER_DISMISS_COOLDOWN_MS = 86_400_000;

export const NOTIFICATION_TIERS = ['badge', 'banner', 'modal'] as const;
export type NotificationTier = (typeof NOTIFICATION_TIERS)[number];
export const NotificationTierSchema = z.enum(NOTIFICATION_TIERS);

// ============================================================
// CLOCK DRIFT CONSTANTS
// ============================================================

export const CLOCK_DRIFT_EMA_WEIGHT = 0.2;

// ============================================================
// NSE MERGE STRATEGY CONSTANTS
// ============================================================

export const NSE_MERGE_STRATEGIES = [
  'conflict',
  'latest_wins',
  'max',
  'min',
  'sum',
  'average',
  'max_timestamp',
  'union',
  'merge_memberships',
  'keep_original',
  'keep_local',
] as const;

export type NSEMergeStrategy = (typeof NSE_MERGE_STRATEGIES)[number];
export const NSEMergeStrategySchema = z.enum(NSE_MERGE_STRATEGIES);

export function isNSEMergeStrategy(value: unknown): value is NSEMergeStrategy {
  return NSE_MERGE_STRATEGIES.includes(value as NSEMergeStrategy);
}

// ============================================================
// SYNCABLE FIELDS
// ============================================================

export const SYNCABLE_FIELDS = [
  'content.title',
  'content.body',
  'content.summary',
  'organization.tags',
  'organization.cluster_memberships',
  'neural.stability',
  'neural.retrievability',
  'neural.difficulty',
  'neural.importance',
  'temporal.last_accessed',
  'temporal.access_count',
  'state.lifecycle',
  'state.flags',
] as const;

export type SyncableField = (typeof SYNCABLE_FIELDS)[number];
export const SyncableFieldSchema = z.enum(SYNCABLE_FIELDS);

// ============================================================
// FIELD-TO-STRATEGY MAPPING
// ============================================================

export const NSE_FIELD_MERGE_STRATEGIES: Record<string, NSEMergeStrategy> = {
  'content.body': 'conflict',
  'content.title': 'latest_wins',
  'content.summary': 'latest_wins',
  'organization.tags': 'union',
  'organization.cluster_memberships': 'merge_memberships',
  'neural.stability': 'max',
  'neural.retrievability': 'max',
  'neural.difficulty': 'average',
  'neural.importance': 'max',
  'temporal.last_accessed': 'max_timestamp',
  'temporal.access_count': 'sum',
  'state.lifecycle': 'latest_wins',
  'state.flags': 'union',
  '_default': 'latest_wins',
};

// ============================================================
// SYNC PROTOCOL CONSTANTS
// ============================================================

export const SYNC_HEADER_DEVICE_ID = 'X-Device-Id';
export const SYNC_HEADER_SCHEMA_VERSION = 'X-Schema-Version';
export const SYNC_HEADER_SERVER_TIME = 'X-Server-Time';
export const HTTP_UPGRADE_REQUIRED = 426;

// ============================================================
// SYNC LOG ENTRY TYPES
// ============================================================

export const SYNC_LOG_ENTRY_TYPES = [
  'resurrection',
  'conflict_resolved',
  'schema_mismatch',
  'recovery',
  'initial_sync',
] as const;

export type SyncLogEntryType = (typeof SYNC_LOG_ENTRY_TYPES)[number];
export const SyncLogEntryTypeSchema = z.enum(SYNC_LOG_ENTRY_TYPES);

// ============================================================
// RE-EMBEDDING REASON CONSTANTS
// ============================================================

export const REEMBEDDING_REASONS = ['model_mismatch', 'content_changed', 'manual'] as const;
export type ReembeddingReason = (typeof REEMBEDDING_REASONS)[number];
export const ReembeddingReasonSchema = z.enum(REEMBEDDING_REASONS);

// ============================================================
// USER RESOLUTION ACTION CONSTANTS
// ============================================================

export const USER_RESOLUTION_ACTIONS = ['keep_local', 'keep_remote', 'manual_merge'] as const;
export type UserResolutionAction = (typeof USER_RESOLUTION_ACTIONS)[number];
export const UserResolutionActionSchema = z.enum(USER_RESOLUTION_ACTIONS);

// ============================================================
// MERGE RESULT STATUS CONSTANTS
// ============================================================

export const MERGE_RESULT_STATUSES = ['merged', 'conflict'] as const;
export type MergeResultStatus = (typeof MERGE_RESULT_STATUSES)[number];
export const MergeResultStatusSchema = z.enum(MERGE_RESULT_STATUSES);

// ============================================================
// CONFLICT RESOLVER CONSTANTS
// ============================================================

export const NSE_CONFLICT_RESOLVERS = ['user', 'auto'] as const;
export type NSEConflictResolver = (typeof NSE_CONFLICT_RESOLVERS)[number];
export const NSEConflictResolverSchema = z.enum(NSE_CONFLICT_RESOLVERS);
