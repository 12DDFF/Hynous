/**
 * @module @nous/core/sync/nse-types
 * @description Types and Zod schemas for Nous Sync Engine (NSE) v1
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-033
 * @storm Brainstorms/Infrastructure/storm-033-sync-conflict-resolution
 *
 * All interfaces, types, and Zod schemas for the NSE.
 */

import { z } from 'zod';
import {
  type NSEPlatform,
  type NodeSyncStatus,
  type MergeResultStatus,
  type UserResolutionAction,
  type NSEConflictResolver,
  type ReembeddingReason,
  type SyncLogEntryType,
  NSEPlatformSchema,
  NodeSyncStatusSchema,
  MergeResultStatusSchema,
  UserResolutionActionSchema,
  NSEConflictResolverSchema,
  ReembeddingReasonSchema,
  SyncLogEntryTypeSchema,
} from './nse-constants';

// ============================================================
// VERSION VECTOR
// ============================================================

/**
 * Version vector mapping device IDs to Lamport counters.
 * The special key `_inactive` holds compacted sum of inactive devices.
 */
export interface VersionVector {
  [device_id: string]: number;
}

export const VersionVectorSchema = z.record(z.string(), z.number().int().min(0));

// ============================================================
// SYNC METADATA
// ============================================================

export interface SyncMetadata {
  _schemaVersion: number;
  version: VersionVector;
  last_modified_by: string;
  last_modified_at: string;
  sync_status: NodeSyncStatus;
  last_synced_at: string;
  content_checksum?: string;
}

export const SyncMetadataSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  version: VersionVectorSchema,
  last_modified_by: z.string().min(1),
  last_modified_at: z.string().datetime(),
  sync_status: NodeSyncStatusSchema,
  last_synced_at: z.string().datetime(),
  content_checksum: z.string().optional(),
});

// ============================================================
// DEVICE INFO
// ============================================================

export interface DeviceInfo {
  _schemaVersion: number;
  device_id: string;
  platform: NSEPlatform;
  display_name: string;
  created_at: string;
  last_active_at: string;
  clock_drift_ms: number;
  schema_version: string;
}

export const DeviceInfoSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  device_id: z.string().min(1),
  platform: NSEPlatformSchema,
  display_name: z.string().min(1),
  created_at: z.string().datetime(),
  last_active_at: z.string().datetime(),
  clock_drift_ms: z.number(),
  schema_version: z.string().min(1),
});

// ============================================================
// CLOCK SYNC
// ============================================================

export interface ClockSync {
  server_time: string;
  local_time: string;
  drift_ms: number;
  last_sync: string;
}

export const ClockSyncSchema = z.object({
  server_time: z.string().datetime(),
  local_time: z.string().datetime(),
  drift_ms: z.number(),
  last_sync: z.string().datetime(),
});

// ============================================================
// FIELD CHANGE
// ============================================================

export interface FieldChange {
  field: string;
  old_value: unknown;
  new_value: unknown;
}

export const FieldChangeSchema = z.object({
  field: z.string().min(1),
  old_value: z.unknown(),
  new_value: z.unknown(),
});

// ============================================================
// CHANGE SET
// ============================================================

export interface ChangeSet {
  node_id: string;
  device_id: string;
  timestamp: string;
  changes: FieldChange[];
}

export const ChangeSetSchema = z.object({
  node_id: z.string().min(1),
  device_id: z.string().min(1),
  timestamp: z.string().datetime(),
  changes: z.array(FieldChangeSchema),
});

// ============================================================
// STRATEGY RESULT
// ============================================================

export interface StrategyResult {
  value: unknown;
  isConflict: boolean;
}

export const StrategyResultSchema = z.object({
  value: z.unknown(),
  isConflict: z.boolean(),
});

// ============================================================
// CLUSTER MEMBERSHIP FOR MERGE
// ============================================================

export interface ClusterMembershipForMerge {
  cluster_id: string;
  strength: number;
  pinned: boolean;
}

export const ClusterMembershipForMergeSchema = z.object({
  cluster_id: z.string().min(1),
  strength: z.number().min(0).max(1),
  pinned: z.boolean(),
});

// ============================================================
// CONFLICT INFO (NSE)
// ============================================================

export interface NSEConflictInfo {
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  localTimestamp: string;
  remoteTimestamp: string;
}

export const NSEConflictInfoSchema = z.object({
  field: z.string().min(1),
  localValue: z.unknown(),
  remoteValue: z.unknown(),
  localTimestamp: z.string().datetime(),
  remoteTimestamp: z.string().datetime(),
});

// ============================================================
// MERGE RESULT (NSE)
// ============================================================

export interface NSEMergeResult {
  status: MergeResultStatus;
  mergedNode?: Record<string, unknown>;
  conflicts?: NSEConflictInfo[];
}

export const NSEMergeResultSchema = z.object({
  status: MergeResultStatusSchema,
  mergedNode: z.record(z.string(), z.unknown()).optional(),
  conflicts: z.array(NSEConflictInfoSchema).optional(),
});

// ============================================================
// STORED CONFLICT (NSE)
// ============================================================

export interface NSEStoredConflict {
  _schemaVersion: number;
  node_id: string;
  local_version: Record<string, unknown>;
  remote_version: Record<string, unknown>;
  conflicts: NSEConflictInfo[];
  created_at: string;
  expires_at: string;
}

export const NSEStoredConflictSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  local_version: z.record(z.string(), z.unknown()),
  remote_version: z.record(z.string(), z.unknown()),
  conflicts: z.array(NSEConflictInfoSchema),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
});

// ============================================================
// USER RESOLUTION (NSE)
// ============================================================

export interface NSEUserResolution {
  node_id: string;
  resolution: UserResolutionAction;
  field_choices?: Record<string, 'local' | 'remote'>;
  manual_values?: Record<string, unknown>;
  apply_to_similar: boolean;
}

export const NSEUserResolutionSchema = z.object({
  node_id: z.string().min(1),
  resolution: UserResolutionActionSchema,
  field_choices: z.record(z.string(), z.enum(['local', 'remote'])).optional(),
  manual_values: z.record(z.string(), z.unknown()).optional(),
  apply_to_similar: z.boolean(),
});

// ============================================================
// CONFLICT HISTORY ENTRY
// ============================================================

export interface ConflictHistoryEntry {
  _schemaVersion: number;
  node_id: string;
  rejected_version: Record<string, unknown>;
  resolved_at: string;
  resolved_by: NSEConflictResolver;
  expires_at: string;
}

export const ConflictHistoryEntrySchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  rejected_version: z.record(z.string(), z.unknown()),
  resolved_at: z.string().datetime(),
  resolved_by: NSEConflictResolverSchema,
  expires_at: z.string().datetime(),
});

// ============================================================
// PUSH PAYLOAD
// ============================================================

export interface PushPayload {
  id: string;
  version: VersionVector;
  change_set: ChangeSet;
  data: Record<string, unknown>;
  content_checksum?: string;
}

export const PushPayloadSchema = z.object({
  id: z.string().min(1),
  version: VersionVectorSchema,
  change_set: ChangeSetSchema,
  data: z.record(z.string(), z.unknown()),
  content_checksum: z.string().optional(),
});

// ============================================================
// PUSH RESULT
// ============================================================

export interface PushResult {
  applied: Array<{ id: string }>;
  conflicts: Array<{ id: string; remoteVersion: VersionVector }>;
  error?: string;
}

export const PushResultSchema = z.object({
  applied: z.array(z.object({ id: z.string().min(1) })),
  conflicts: z.array(z.object({
    id: z.string().min(1),
    remoteVersion: VersionVectorSchema,
  })),
  error: z.string().optional(),
});

// ============================================================
// PULL RESULT
// ============================================================

export interface PullResult {
  applied: string[];
  conflicts: string[];
  error?: string;
}

export const PullResultSchema = z.object({
  applied: z.array(z.string()),
  conflicts: z.array(z.string()),
  error: z.string().optional(),
});

// ============================================================
// BATCH SYNC RESPONSE
// ============================================================

export interface BatchSyncResponse {
  changes: PushPayload[];
  next_cursor: string | null;
  total_estimate: number;
  batch_number: number;
}

export const BatchSyncResponseSchema = z.object({
  changes: z.array(PushPayloadSchema),
  next_cursor: z.string().nullable(),
  total_estimate: z.number().int().min(0),
  batch_number: z.number().int().min(1),
});

// ============================================================
// SYNC PROGRESS
// ============================================================

export interface NSESyncProgress {
  processed: number;
  total: number;
  percent: number;
  batchNumber: number;
}

export const NSESyncProgressSchema = z.object({
  processed: z.number().int().min(0),
  total: z.number().int().min(0),
  percent: z.number().min(0).max(100),
  batchNumber: z.number().int().min(1),
});

// ============================================================
// LAST SYNCED VERSION
// ============================================================

export interface LastSyncedVersion {
  _schemaVersion: number;
  node_id: string;
  snapshot: Record<string, unknown>;
  synced_at: string;
}

export const LastSyncedVersionSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  snapshot: z.record(z.string(), z.unknown()),
  synced_at: z.string().datetime(),
});

// ============================================================
// PRIVATE TIER PAYLOAD
// ============================================================

export interface PrivateTierPayload {
  id: string;
  version: VersionVector;
  content_checksum: string;
  encrypted_payload: string;
  nonce: string;
  last_modified_at: string;
}

export const PrivateTierPayloadSchema = z.object({
  id: z.string().min(1),
  version: VersionVectorSchema,
  content_checksum: z.string().min(1),
  encrypted_payload: z.string().min(1),
  nonce: z.string().min(1),
  last_modified_at: z.string().datetime(),
});

// ============================================================
// PRIVATE TIER CONFLICT
// ============================================================

export interface PrivateTierConflict {
  node_id: string;
  local_checksum: string;
  remote_checksum: string;
  local_payload: string;
  remote_payload: string;
  detected_at: string;
}

export const PrivateTierConflictSchema = z.object({
  node_id: z.string().min(1),
  local_checksum: z.string().min(1),
  remote_checksum: z.string().min(1),
  local_payload: z.string().min(1),
  remote_payload: z.string().min(1),
  detected_at: z.string().datetime(),
});

// ============================================================
// CONFLICT NOTIFICATION
// ============================================================

export interface ConflictNotification {
  node_id: string;
  conflict_count: number;
  fields: string[];
  created_at: string;
}

export const ConflictNotificationSchema = z.object({
  node_id: z.string().min(1),
  conflict_count: z.number().int().min(1),
  fields: z.array(z.string()),
  created_at: z.string().datetime(),
});

// ============================================================
// BANNER NOTIFICATION
// ============================================================

export interface NotificationAction {
  label: string;
  onClick: string;
}

export const NotificationActionSchema = z.object({
  label: z.string().min(1),
  onClick: z.string().min(1),
});

export interface BannerNotification {
  type: 'warning';
  message: string;
  actions: NotificationAction[];
  dismissible: boolean;
}

export const BannerNotificationSchema = z.object({
  type: z.literal('warning'),
  message: z.string().min(1),
  actions: z.array(NotificationActionSchema),
  dismissible: z.boolean(),
});

// ============================================================
// BADGE STATE
// ============================================================

export interface BadgeState {
  conflict_count: number;
  visible: boolean;
}

export const BadgeStateSchema = z.object({
  conflict_count: z.number().int().min(0),
  visible: z.boolean(),
});

// ============================================================
// BANNER DISMISS STATE
// ============================================================

export interface BannerDismissState {
  dismissed_at: string;
  cooldown_expired: boolean;
}

export const BannerDismissStateSchema = z.object({
  dismissed_at: z.string().datetime(),
  cooldown_expired: z.boolean(),
});

// ============================================================
// EMBEDDING SYNC
// ============================================================

export interface EmbeddingSync {
  vector: number[];
  model: string;
  model_version: string;
  generated_by: string;
  generated_at: string;
}

export const EmbeddingSyncSchema = z.object({
  vector: z.array(z.number()),
  model: z.string().min(1),
  model_version: z.string().min(1),
  generated_by: z.string().min(1),
  generated_at: z.string().datetime(),
});

// ============================================================
// RE-EMBEDDING QUEUE ENTRY
// ============================================================

export interface ReembeddingQueueEntry {
  _schemaVersion: number;
  node_id: string;
  reason: ReembeddingReason;
  from_model: string;
  to_model: string;
  queued_at: string;
}

export const ReembeddingQueueEntrySchema = z.object({
  _schemaVersion: z.number().int().min(1),
  node_id: z.string().min(1),
  reason: ReembeddingReasonSchema,
  from_model: z.string().min(1),
  to_model: z.string().min(1),
  queued_at: z.string().datetime(),
});

// ============================================================
// SCHEMA VERSION ERROR
// ============================================================

export interface SchemaVersionError {
  min_version: string;
  upgrade_url: string;
  message: string;
}

export const SchemaVersionErrorSchema = z.object({
  min_version: z.string().min(1),
  upgrade_url: z.string().url(),
  message: z.string().min(1),
});

// ============================================================
// SYNC LOG ENTRY
// ============================================================

export interface NSESyncLogEntry {
  _schemaVersion: number;
  type: SyncLogEntryType;
  node_id?: string;
  timestamp: string;
  message: string;
  device_id: string;
}

export const NSESyncLogEntrySchema = z.object({
  _schemaVersion: z.number().int().min(1),
  type: SyncLogEntryTypeSchema,
  node_id: z.string().optional(),
  timestamp: z.string().datetime(),
  message: z.string().min(1),
  device_id: z.string().min(1),
});

// ============================================================
// SERVER SYNC STATE
// ============================================================

export interface ServerSyncState {
  current_vector: VersionVector;
  node_count: number;
  schema_version: string;
}

export const ServerSyncStateSchema = z.object({
  current_vector: VersionVectorSchema,
  node_count: z.number().int().min(0),
  schema_version: z.string().min(1),
});

// ============================================================
// VALIDATION FUNCTIONS
// ============================================================

export function validateVersionVector(v: unknown): v is VersionVector {
  return VersionVectorSchema.safeParse(v).success;
}

export function validateSyncMetadata(v: unknown): v is SyncMetadata {
  return SyncMetadataSchema.safeParse(v).success;
}

export function validateDeviceInfo(v: unknown): v is DeviceInfo {
  return DeviceInfoSchema.safeParse(v).success;
}

export function validateChangeSet(v: unknown): v is ChangeSet {
  return ChangeSetSchema.safeParse(v).success;
}

export function validateNSEMergeResult(v: unknown): v is NSEMergeResult {
  return NSEMergeResultSchema.safeParse(v).success;
}

export function validateNSEStoredConflict(v: unknown): v is NSEStoredConflict {
  return NSEStoredConflictSchema.safeParse(v).success;
}

export function validateNSEUserResolution(v: unknown): v is NSEUserResolution {
  return NSEUserResolutionSchema.safeParse(v).success;
}

export function validatePushPayload(v: unknown): v is PushPayload {
  return PushPayloadSchema.safeParse(v).success;
}

export function validatePrivateTierPayload(v: unknown): v is PrivateTierPayload {
  return PrivateTierPayloadSchema.safeParse(v).success;
}

export function validateNSESyncLogEntry(v: unknown): v is NSESyncLogEntry {
  return NSESyncLogEntrySchema.safeParse(v).success;
}
