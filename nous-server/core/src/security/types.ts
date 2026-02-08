/**
 * @module @nous/core/security
 * @description Types and Zod schemas for Nous Security Layer (NSL)
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * All interfaces, types, and Zod schemas for the security module.
 * Consolidated from spec files: auth-config, privacy-tiers, encryption,
 * key-hierarchy, key-rotation, recovery, consent-ux, api-security,
 * compliance, and offline-auth.
 */

import { z } from 'zod';
import {
  type AuthMethod,
  type Platform,
  type OfflineState,
  type PrivacyTier,
  type DesktopAuthStep,
  type MfaOption,
  type SignInImplementation,
  type PasskeyPlatform,
  type KeyVersionStatus,
  type RotationPhase,
  type RotationEventType,
  type RecoveryMethod,
  type RecoveryReminderType,
  type RecoverySetupStep,
  type ConsentScope,
  type ConsentDuration,
  type ConsentRevocationScope,
  type ConsentEventType,
  type DeclineAction,
  type ApiKeyType,
  type ApiCallFlow,
  type BYOKEncryptionMethod,
  type LLMProvider,
  type ExportComplianceStatus,
  type OfflineFunctionality,
  type OfflineSyncBehavior,
  type QueueableTable,
  type QueueOperationType,
  AUTH_METHODS,
  PLATFORMS,
  OFFLINE_STATES,
  PRIVACY_TIERS,
  DESKTOP_AUTH_STEPS,
  MFA_OPTIONS,
  SIGN_IN_IMPLEMENTATIONS,
  PASSKEY_PLATFORMS,
  KEY_DERIVATION_FUNCTION,
  MASTER_KEY_LENGTH_BITS,
  KEY_VERSION_STATUSES,
  ROTATION_PHASES,
  ROTATION_EVENT_TYPES,
  RECOVERY_METHODS,
  RECOVERY_REMINDER_TYPES,
  RECOVERY_SETUP_STEPS,
  RECOVERY_WORD_COUNT,
  RECOVERY_VERIFICATION_WORD_COUNT,
  RECOVERY_VERIFICATION_ATTEMPT_LIMIT,
  NONCE_LENGTH_BYTES,
  CONSENT_SCOPES,
  CONSENT_DURATIONS,
  CONSENT_REVOCATION_SCOPES,
  CONSENT_EVENT_TYPES,
  DECLINE_ACTIONS,
  API_KEY_TYPES,
  API_CALL_FLOWS,
  BYOK_ENCRYPTION_METHODS,
  LLM_PROVIDERS,
  EXPORT_COMPLIANCE_STATUSES,
  OFFLINE_FUNCTIONALITY_LEVELS,
  OFFLINE_SYNC_BEHAVIORS,
  QUEUEABLE_TABLES,
  QUEUE_OPERATION_TYPES,
  TIER_MIGRATION_STATUSES,
} from './constants';

// ============================================================
// AUTH CONFIGURATION
// ============================================================

/**
 * Clerk authentication provider configuration.
 *
 * @see storm-022 v1 revision Section 1 - Provider Recommendation: Clerk
 */
export interface ClerkConfig {
  publishable_key: string;
  secret_key: string;
  sign_in_methods: AuthMethod[];
  mfa_enabled: boolean;
  session_lifetime_minutes: number;
  ios: { native_sdk: boolean };
  android: { native_sdk: boolean };
  desktop: { oauth_redirect_uri: string; deep_link_scheme: string };
}

export const ClerkConfigSchema = z.object({
  publishable_key: z.string().min(1),
  secret_key: z.string().min(1),
  sign_in_methods: z.array(z.enum(AUTH_METHODS)),
  mfa_enabled: z.boolean(),
  session_lifetime_minutes: z.number().int().positive(),
  ios: z.object({ native_sdk: z.boolean() }),
  android: z.object({ native_sdk: z.boolean() }),
  desktop: z.object({
    oauth_redirect_uri: z.string().url(),
    deep_link_scheme: z.string(),
  }),
});

/**
 * Per-platform authentication method implementation.
 *
 * @see storm-022 v1 revision Section 1 - Platform-Specific Implementation table
 */
export interface PlatformAuthConfig {
  platform: Platform;
  apple_sign_in: SignInImplementation;
  google_sign_in: SignInImplementation;
  email_password: SignInImplementation;
}

export const PlatformAuthConfigSchema = z.object({
  platform: z.enum(PLATFORMS),
  apple_sign_in: z.enum(SIGN_IN_IMPLEMENTATIONS),
  google_sign_in: z.enum(SIGN_IN_IMPLEMENTATIONS),
  email_password: z.enum(SIGN_IN_IMPLEMENTATIONS),
});

/**
 * JWT token pair for authentication state.
 *
 * @see storm-022 v1 revision Section 1 - Offline Token Handling
 */
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  issued_at: string;
  expires_at: string;
}

export const AuthTokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  issued_at: z.string().datetime(),
  expires_at: z.string().datetime(),
});

/**
 * Full authentication state stored on device.
 *
 * @see storm-022 v1 revision Section 1 - AuthState interface
 */
export interface AuthState {
  user_id: string;
  tokens: AuthTokens;
  last_online: string;
  offline_state: OfflineState;
  privacy_tier: PrivacyTier;
  device_id: string;
}

export const AuthStateSchema = z.object({
  user_id: z.string().min(1),
  tokens: AuthTokensSchema,
  last_online: z.string().datetime(),
  offline_state: z.enum(OFFLINE_STATES),
  privacy_tier: z.enum(PRIVACY_TIERS),
  device_id: z.string().min(1),
});

/**
 * Desktop authentication flow state for Tauri apps.
 *
 * @see storm-022 v1 revision Section 1 - Desktop Auth Flow
 */
export interface DesktopAuthFlow {
  step: DesktopAuthStep;
  redirect_uri: string;
  state_param: string;
  code_verifier?: string;
  error?: string;
}

export const DesktopAuthFlowSchema = z.object({
  step: z.enum(DESKTOP_AUTH_STEPS),
  redirect_uri: z.string(),
  state_param: z.string().min(1),
  code_verifier: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Security measures configuration (managed by Clerk).
 *
 * @see storm-022 v1 revision Section 1 - Security Measures table
 */
export interface AuthSecurityConfig {
  brute_force_lockout_attempts: number;
  brute_force_lockout_minutes: number;
  captcha_after_failures: number;
  new_device_email_alert: boolean;
  invalidate_sessions_on_password_change: boolean;
  mfa_options: MfaOption[];
}

export const AuthSecurityConfigSchema = z.object({
  brute_force_lockout_attempts: z.number().int().positive(),
  brute_force_lockout_minutes: z.number().int().positive(),
  captcha_after_failures: z.number().int().positive(),
  new_device_email_alert: z.boolean(),
  invalidate_sessions_on_password_change: z.boolean(),
  mfa_options: z.array(z.enum(MFA_OPTIONS)),
});

/**
 * Result of JWT token validation.
 */
export interface JWTValidationResult {
  valid: boolean;
  user_id?: string;
  error?: 'expired' | 'invalid_signature' | 'malformed' | 'revoked';
}

export const JWTValidationResultSchema = z.object({
  valid: z.boolean(),
  user_id: z.string().optional(),
  error: z.enum(['expired', 'invalid_signature', 'malformed', 'revoked']).optional(),
});

// ============================================================
// PRIVACY TIERS
// ============================================================

/**
 * Complete definition of a privacy tier.
 *
 * @see storm-022 v1 revision Section 2 - Simplified Two-Tier Privacy Model
 */
export interface TierDefinition {
  tier: PrivacyTier;
  name: string;
  description: string;
  target_user: string;
  search: 'cloud' | 'client_only';
  llm_access: 'direct' | 'explicit_consent';
  key_management: 'none' | 'passkey_derived';
  data_protection: string[];
  data_exposure: string[];
}

export const TierDefinitionSchema = z.object({
  tier: z.enum(PRIVACY_TIERS),
  name: z.string(),
  description: z.string(),
  target_user: z.string(),
  search: z.enum(['cloud', 'client_only']),
  llm_access: z.enum(['direct', 'explicit_consent']),
  key_management: z.enum(['none', 'passkey_derived']),
  data_protection: z.array(z.string()),
  data_exposure: z.array(z.string()),
});

/**
 * Feature comparison between tiers (for UI display).
 *
 * @see storm-022 v1 revision Section 2 - Updated Architecture Overview table
 */
export interface TierComparison {
  feature: string;
  standard: string;
  private_tier: string;
}

export const TierComparisonSchema = z.object({
  feature: z.string(),
  standard: z.string(),
  private_tier: z.string(),
});

/**
 * Request to migrate between privacy tiers.
 *
 * @see storm-022 v1 revision Section 4 - Tier Migration flows
 */
export interface TierMigrationRequest {
  user_id: string;
  from_tier: PrivacyTier;
  to_tier: PrivacyTier;
  initiated_at: string;
}

export const TierMigrationRequestSchema = z.object({
  user_id: z.string().min(1),
  from_tier: z.enum(PRIVACY_TIERS),
  to_tier: z.enum(PRIVACY_TIERS),
  initiated_at: z.string().datetime(),
});

/**
 * Tier migration state tracking.
 *
 * @see storm-022 v1 revision Section 4 - Standard -> Private, Private -> Standard
 */
export interface TierMigrationState {
  request: TierMigrationRequest;
  status: typeof TIER_MIGRATION_STATUSES[number];
  progress: number;
  nodes_processed: number;
  nodes_total: number;
  estimated_time_remaining_ms: number;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export const TierMigrationStateSchema = z.object({
  request: TierMigrationRequestSchema,
  status: z.enum(TIER_MIGRATION_STATUSES),
  progress: z.number().min(0).max(100),
  nodes_processed: z.number().int().min(0),
  nodes_total: z.number().int().min(0),
  estimated_time_remaining_ms: z.number().min(0),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  error: z.string().optional(),
});

// ============================================================
// ENCRYPTION
// ============================================================

/**
 * Encrypted node structure for Private tier storage.
 *
 * @see storm-022 v1 revision Section 2 - Encryption Schema (Private Tier)
 */
export interface EncryptedNodeSchema {
  id: string;
  type: string;
  encrypted_payload: Uint8Array;
  encrypted_embedding?: Uint8Array;
  encryption_version: number;
  nonce: Uint8Array;
  encryption_tier: PrivacyTier;
  version: number;
  updated_at: number;
}

export const EncryptedNodeSchemaZ = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  encrypted_payload: z.instanceof(Uint8Array),
  encrypted_embedding: z.instanceof(Uint8Array).optional(),
  encryption_version: z.number().int().min(1),
  nonce: z.instanceof(Uint8Array).refine(
    (val) => val.length === NONCE_LENGTH_BYTES,
    { message: `Nonce must be exactly ${NONCE_LENGTH_BYTES} bytes` }
  ),
  encryption_tier: z.enum(PRIVACY_TIERS),
  version: z.number().int().min(1),
  updated_at: z.number().int(),
});

/**
 * Mapping of which node fields are encrypted vs. stay plaintext.
 *
 * @see storm-022 v1 revision Section 2 - Encrypted node SQL schema
 */
export interface EncryptionFieldMap {
  plaintext: string[];
  encrypted_content: string[];
  encrypted_embedding: string[];
  encrypted_metadata: string[];
}

export const EncryptionFieldMapSchema = z.object({
  plaintext: z.array(z.string()),
  encrypted_content: z.array(z.string()),
  encrypted_embedding: z.array(z.string()),
  encrypted_metadata: z.array(z.string()),
});

/**
 * Result of encrypting a node.
 */
export interface EncryptionResult {
  encrypted_payload: Uint8Array;
  encrypted_embedding?: Uint8Array;
  nonce: Uint8Array;
  encryption_version: number;
}

export const EncryptionResultSchema = z.object({
  encrypted_payload: z.instanceof(Uint8Array),
  encrypted_embedding: z.instanceof(Uint8Array).optional(),
  nonce: z.instanceof(Uint8Array),
  encryption_version: z.number().int().min(1),
});

/**
 * Result of decrypting a node.
 *
 * @see storm-011 spec/node-schema.ts - NousNode interface
 */
export interface DecryptionResult {
  content: {
    title: string;
    body?: string;
    summary?: string;
    blocks?: unknown[];
  };
  embedding?: {
    vector: Float32Array;
    model: string;
    created_at: string;
  };
  temporal: {
    ingestion: { timestamp: string; timezone: string };
    event?: unknown;
    content_times?: unknown[];
    reference_patterns?: string[];
  };
  neural: {
    stability: number;
    retrievability: number;
    last_accessed: string;
    access_count: number;
  };
  provenance: {
    source: string;
    parent_id?: string;
    confidence: number;
  };
  state: {
    extraction_depth: string;
    lifecycle: string;
  };
}

export const DecryptionResultSchema = z.object({
  content: z.object({
    title: z.string(),
    body: z.string().optional(),
    summary: z.string().optional(),
    blocks: z.array(z.unknown()).optional(),
  }),
  embedding: z.object({
    vector: z.instanceof(Float32Array),
    model: z.string(),
    created_at: z.string(),
  }).optional(),
  temporal: z.object({
    ingestion: z.object({ timestamp: z.string(), timezone: z.string() }),
    event: z.unknown().optional(),
    content_times: z.array(z.unknown()).optional(),
    reference_patterns: z.array(z.string()).optional(),
  }),
  neural: z.object({
    stability: z.number(),
    retrievability: z.number(),
    last_accessed: z.string(),
    access_count: z.number(),
  }),
  provenance: z.object({
    source: z.string(),
    parent_id: z.string().optional(),
    confidence: z.number(),
  }),
  state: z.object({
    extraction_depth: z.string(),
    lifecycle: z.string(),
  }),
});

/**
 * HNSW index configuration for client-side search in Private tier.
 *
 * @see storm-022 v1 revision Section 2 - Client-Side Search
 */
export interface ClientSearchConfig {
  hnsw_ef_construction: number;
  hnsw_ef_search: number;
  hnsw_m: number;
  max_nodes: number;
  index_in_memory: boolean;
}

export const ClientSearchConfigSchema = z.object({
  hnsw_ef_construction: z.number().int().positive(),
  hnsw_ef_search: z.number().int().positive(),
  hnsw_m: z.number().int().positive(),
  max_nodes: z.number().int().positive(),
  index_in_memory: z.boolean(),
});

/**
 * Result from local HNSW search.
 */
export interface LocalSearchResult {
  node_id: string;
  distance: number;
  score: number;
}

export const LocalSearchResultSchema = z.object({
  node_id: z.string(),
  distance: z.number().min(0),
  score: z.number().min(0).max(1),
});

/**
 * Opaque type representing an in-memory HNSW index.
 */
export interface HNSWIndex {
  size: number;
  ready: boolean;
  memory_bytes: number;
}

export const HNSWIndexSchema = z.object({
  size: z.number().int().min(0),
  ready: z.boolean(),
  memory_bytes: z.number().int().min(0),
});

// ============================================================
// KEY HIERARCHY
// ============================================================

/**
 * Information about the user's passkey credential.
 *
 * @see storm-022 v1 revision Section 3 - Key Hierarchy
 */
export interface PasskeyInfo {
  id: string;
  created_at: string;
  platform: PasskeyPlatform;
  synced_via: string;
  secure_enclave: boolean;
}

export const PasskeyInfoSchema = z.object({
  id: z.string().min(1),
  created_at: z.string().datetime(),
  platform: z.enum(PASSKEY_PLATFORMS),
  synced_via: z.string().min(1),
  secure_enclave: z.boolean(),
});

/**
 * Master key metadata. The actual CryptoKey is never serialized.
 *
 * CRITICAL: Master key is NEVER stored. Exists in memory only.
 *
 * @see storm-022 v1 revision Section 3
 */
export interface MasterKeyInfo {
  algorithm: typeof KEY_DERIVATION_FUNCTION;
  length_bits: typeof MASTER_KEY_LENGTH_BITS;
  derivation_salt: Uint8Array;
  exists_in_memory_only: true;
}

export const MasterKeyInfoSchema = z.object({
  algorithm: z.literal(KEY_DERIVATION_FUNCTION),
  length_bits: z.literal(MASTER_KEY_LENGTH_BITS),
  derivation_salt: z.instanceof(Uint8Array),
  exists_in_memory_only: z.literal(true),
});

/**
 * Set of derived encryption keys, each for a specific purpose.
 *
 * @see storm-022 v1 revision Section 3 - HKDF with purpose strings
 */
export interface DerivedKeys {
  content_key: CryptoKey;
  embedding_key: CryptoKey;
  metadata_key: CryptoKey;
}

export const DerivedKeysSchema = z.object({
  content_key: z.any().refine((val) => val != null, { message: 'content_key is required' }),
  embedding_key: z.any().refine((val) => val != null, { message: 'embedding_key is required' }),
  metadata_key: z.any().refine((val) => val != null, { message: 'metadata_key is required' }),
});

/**
 * The complete key hierarchy for a Private tier user.
 *
 * @see storm-022 v1 revision Section 3
 */
export interface KeyHierarchy {
  passkey: PasskeyInfo;
  master_key: MasterKeyInfo;
  derived_keys: DerivedKeys;
}

export const KeyHierarchySchema = z.object({
  passkey: PasskeyInfoSchema,
  master_key: MasterKeyInfoSchema,
  derived_keys: DerivedKeysSchema,
});

/**
 * Parameters for a single HKDF key derivation operation.
 *
 * @see storm-022 v1 revision Section 3
 */
export interface KeyDerivationParams {
  algorithm: 'HKDF';
  hash: 'SHA-256';
  salt: Uint8Array;
  info: string;
  key_length: typeof MASTER_KEY_LENGTH_BITS;
}

export const KeyDerivationParamsSchema = z.object({
  algorithm: z.literal('HKDF'),
  hash: z.literal('SHA-256'),
  salt: z.instanceof(Uint8Array),
  info: z.string().min(1),
  key_length: z.literal(MASTER_KEY_LENGTH_BITS),
});

/**
 * Multi-device key sync model.
 *
 * @see storm-022 v1 revision Section 3 - Multi-Device Sync
 */
export interface MultiDeviceKeySync {
  method: 'passkey_platform_sync';
  description: string;
  sync_mechanisms: Record<PasskeyPlatform, string>;
}

export const MultiDeviceKeySyncSchema = z.object({
  method: z.literal('passkey_platform_sync'),
  description: z.string(),
  sync_mechanisms: z.record(z.enum(PASSKEY_PLATFORMS), z.string()),
});

// ============================================================
// KEY ROTATION
// ============================================================

/**
 * Tracks a single key version in the user's key history.
 *
 * @see storm-022 v2 Section 9.2 - Key Versioning Scheme
 */
export interface KeyVersion {
  version: number;
  created_at: string;
  derivation_salt: Uint8Array;
  status: KeyVersionStatus;
}

export const KeyVersionSchema = z.object({
  version: z.number().int().min(1),
  created_at: z.string().datetime(),
  derivation_salt: z.instanceof(Uint8Array),
  status: z.enum(KEY_VERSION_STATUSES),
});

/**
 * Key metadata stored in user's encrypted profile.
 *
 * @see storm-022 v2 Section 9.2
 */
export interface UserKeyMetadata {
  current_version: number;
  versions: KeyVersion[];
  rotation_in_progress: boolean;
  rotation_progress: number;
  rotation_started_at: string | null;
}

export const UserKeyMetadataSchema = z.object({
  current_version: z.number().int().min(1),
  versions: z.array(KeyVersionSchema),
  rotation_in_progress: z.boolean(),
  rotation_progress: z.number().min(0).max(100),
  rotation_started_at: z.string().datetime().nullable(),
});

/**
 * Progress tracking for an active key rotation.
 *
 * @see storm-022 v2 Section 9.6 - Interrupted Rotation
 */
export interface RotationProgress {
  processed_count: number;
  total_count: number;
  last_processed_id: string | null;
  started_at: string;
  phase: RotationPhase;
}

export const RotationProgressSchema = z.object({
  processed_count: z.number().int().min(0),
  total_count: z.number().int().min(0),
  last_processed_id: z.string().nullable(),
  started_at: z.string().datetime(),
  phase: z.enum(ROTATION_PHASES),
});

/**
 * Configuration for the background re-encryption job.
 *
 * @see storm-022 v2 Section 9.7 - Background Job Configuration
 */
export interface RotationConfig {
  batch_size: number;
  pause_between_batches_ms: number;
  max_batches_per_minute: number;
  require_wifi: boolean;
  require_charging: boolean;
  min_battery_level: number;
  persist_progress: boolean;
  auto_resume_on_launch: boolean;
}

export const RotationConfigSchema = z.object({
  batch_size: z.number().int().positive(),
  pause_between_batches_ms: z.number().int().min(0),
  max_batches_per_minute: z.number().int().positive(),
  require_wifi: z.boolean(),
  require_charging: z.boolean(),
  min_battery_level: z.number().int().min(0).max(100),
  persist_progress: z.boolean(),
  auto_resume_on_launch: z.boolean(),
});

/**
 * Event emitted during rotation for UI updates.
 *
 * @see storm-022 v2 Section 9.4 - Migration UX Flow
 */
export interface RotationEvent {
  type: RotationEventType;
  progress?: number;
  processed_count?: number;
  total_count?: number;
  estimated_remaining_ms?: number;
  error?: string;
}

export const RotationEventSchema = z.object({
  type: z.enum(ROTATION_EVENT_TYPES),
  progress: z.number().min(0).max(100).optional(),
  processed_count: z.number().int().min(0).optional(),
  total_count: z.number().int().min(0).optional(),
  estimated_remaining_ms: z.number().min(0).optional(),
  error: z.string().optional(),
});

// ============================================================
// RECOVERY
// ============================================================

/**
 * A generated BIP39 recovery code for key recovery.
 *
 * @see storm-022 v1 revision Section 3
 */
export interface RecoveryCode {
  mnemonic: string[];
  version: number;
  created_at: string;
  verified: boolean;
}

export const RecoveryCodeSchema = z.object({
  mnemonic: z.array(z.string()).length(RECOVERY_WORD_COUNT),
  version: z.number().int().min(1),
  created_at: z.string().datetime(),
  verified: z.boolean(),
});

/**
 * Tracks the recovery code setup flow.
 *
 * @see storm-022 v1 revision Section 3 - FORCED VERIFICATION
 */
export interface RecoverySetupState {
  step: RecoverySetupStep;
  mnemonic: string[];
  verification_indices: number[];
  attempts_remaining: number;
}

export const RecoverySetupStateSchema = z.object({
  step: z.enum(RECOVERY_SETUP_STEPS),
  mnemonic: z.array(z.string()).length(RECOVERY_WORD_COUNT),
  verification_indices: z.array(z.number().int().min(0).max(RECOVERY_WORD_COUNT - 1))
    .length(RECOVERY_VERIFICATION_WORD_COUNT),
  attempts_remaining: z.number().int().min(0).max(RECOVERY_VERIFICATION_ATTEMPT_LIMIT),
});

/**
 * Record of a recovery attempt for audit logging.
 *
 * @see storm-022 v2 Section 9.5
 */
export interface RecoveryAttempt {
  user_id: string;
  method: RecoveryMethod;
  attempted_at: string;
  success: boolean;
  error?: string;
}

export const RecoveryAttemptSchema = z.object({
  user_id: z.string().min(1),
  method: z.enum(RECOVERY_METHODS),
  attempted_at: z.string().datetime(),
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Grace period state for newly activated Private tier users.
 *
 * @see storm-022 v1 revision Section 3 - 7-DAY GRACE PERIOD
 */
export interface GracePeriodState {
  enabled: boolean;
  expires_at: string;
  email_recovery_available: boolean;
}

export const GracePeriodStateSchema = z.object({
  enabled: z.boolean(),
  expires_at: z.string().datetime(),
  email_recovery_available: z.boolean(),
});

/**
 * Result of regenerating a recovery code.
 *
 * @see storm-022 v2 Section 9.5
 */
export interface RecoveryRegenerationResult {
  new_mnemonic: string[];
  old_code_invalidated: boolean;
  new_encrypted_master: Uint8Array;
  verification_required: boolean;
}

export const RecoveryRegenerationResultSchema = z.object({
  new_mnemonic: z.array(z.string()).length(RECOVERY_WORD_COUNT),
  old_code_invalidated: z.boolean(),
  new_encrypted_master: z.instanceof(Uint8Array),
  verification_required: z.boolean(),
});

/**
 * Periodic reminder to verify recovery code is safely stored.
 *
 * @see storm-022 v1 revision Section 3 - Periodic Reminders
 */
export interface RecoveryReminder {
  type: RecoveryReminderType;
  days_since_setup: number;
  last_dismissed: string | null;
  message: string;
}

export const RecoveryReminderSchema = z.object({
  type: z.enum(RECOVERY_REMINDER_TYPES),
  days_since_setup: z.number().int().min(0),
  last_dismissed: z.string().datetime().nullable(),
  message: z.string().min(1),
});

// ============================================================
// CONSENT UX
// ============================================================

/**
 * Current consent state for a user session.
 *
 * @see storm-022 v2 Section 10.3
 */
export interface ConsentState {
  scope: ConsentScope;
  granted: boolean;
  granted_at?: string;
  expires_at?: string;
  provider?: string;
  memories_shared_count: number;
  memories_shared_ids: string[];
}

export const ConsentStateSchema = z.object({
  scope: z.enum(CONSENT_SCOPES),
  granted: z.boolean(),
  granted_at: z.string().datetime().optional(),
  expires_at: z.string().datetime().optional(),
  provider: z.string().optional(),
  memories_shared_count: z.number().int().min(0),
  memories_shared_ids: z.array(z.string()),
});

/**
 * A remembered topic-based consent record.
 *
 * @see storm-022 v2 Section 10.2
 */
export interface TopicConsent {
  topic_embedding: number[];
  label: string;
  consented_at: string;
  query_count: number;
}

export const TopicConsentSchema = z.object({
  topic_embedding: z.array(z.number()),
  label: z.string().min(1),
  consented_at: z.string().datetime(),
  query_count: z.number().int().min(0),
});

/**
 * User preferences for LLM consent behavior.
 *
 * @see storm-022 v2 Section 10.2
 */
export interface ConsentSettings {
  default_scope: ConsentScope;
  time_based_duration: ConsentDuration;
  topic_similarity_threshold: number;
  remembered_topics: TopicConsent[];
  conversation_timeout_minutes: number;
  require_explicit_for_sensitive: boolean;
}

export const ConsentSettingsSchema = z.object({
  default_scope: z.enum(CONSENT_SCOPES),
  time_based_duration: z.enum(CONSENT_DURATIONS),
  topic_similarity_threshold: z.number().min(0.80).max(0.95),
  remembered_topics: z.array(TopicConsentSchema),
  conversation_timeout_minutes: z.number().int().positive(),
  require_explicit_for_sensitive: z.boolean(),
});

/**
 * Data required to render the consent dialog.
 *
 * @see storm-022 v2 Section 10.1
 */
export interface ConsentDialogData {
  memories: ConsentMemoryPreview[];
  total_count: number;
  provider_name: string;
  provider_privacy_note: string;
  provider_policy_url: string;
}

export const ConsentDialogDataSchema = z.object({
  memories: z.array(z.lazy(() => ConsentMemoryPreviewSchema)),
  total_count: z.number().int().min(1),
  provider_name: z.string().min(1),
  provider_privacy_note: z.string(),
  provider_policy_url: z.string().url(),
});

/**
 * Memory preview shown in the consent dialog.
 *
 * @see storm-022 v2 Section 10.1
 */
export interface ConsentMemoryPreview {
  id: string;
  title: string;
  created_at: string;
  type: string;
  preview: string;
  selected: boolean;
}

export const ConsentMemoryPreviewSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  created_at: z.string().datetime(),
  type: z.string().min(1),
  preview: z.string(),
  selected: z.boolean(),
});

/**
 * Request to revoke LLM consent.
 *
 * @see storm-022 v2 Section 10.5
 */
export interface ConsentRevocationRequest {
  scope: ConsentRevocationScope;
}

export const ConsentRevocationRequestSchema = z.object({
  scope: z.enum(CONSENT_REVOCATION_SCOPES),
});

/**
 * Result when a user declines LLM access to their memories.
 *
 * @see storm-022 v2 Section 10.6
 */
export interface DeclineResult {
  declined: true;
  available_actions: DeclineAction[];
  previous_context_available: boolean;
  message: string;
}

export const DeclineResultSchema = z.object({
  declined: z.literal(true),
  available_actions: z.array(z.enum(DECLINE_ACTIONS)),
  previous_context_available: z.boolean(),
  message: z.string(),
});

/**
 * Consent event for logging and analytics.
 *
 * @see storm-022 v2 Section 10
 */
export interface ConsentEvent {
  type: ConsentEventType;
  user_id: string;
  scope: ConsentScope;
  memories_count: number;
  provider: string;
  timestamp: string;
}

export const ConsentEventSchema = z.object({
  type: z.enum(CONSENT_EVENT_TYPES),
  user_id: z.string().min(1),
  scope: z.enum(CONSENT_SCOPES),
  memories_count: z.number().int().min(0),
  provider: z.string(),
  timestamp: z.string().datetime(),
});

/**
 * Visual indicator data during LLM transmission.
 *
 * @see storm-022 v2 Section 10.4
 */
export interface ConsentVisualIndicator {
  memories_shared_count: number;
  provider_name: string;
  consent_scope_label: string;
  time_remaining?: string;
  transmitting: boolean;
}

export const ConsentVisualIndicatorSchema = z.object({
  memories_shared_count: z.number().int().min(0),
  provider_name: z.string(),
  consent_scope_label: z.string(),
  time_remaining: z.string().optional(),
  transmitting: z.boolean(),
});

/**
 * Detailed record of a memory shared with an LLM.
 *
 * @see storm-022 v2 Section 10.4
 */
export interface SharedMemoryDetail {
  id: string;
  title: string;
  shared_at: string;
}

export const SharedMemoryDetailSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  shared_at: z.string().datetime(),
});

// ============================================================
// API SECURITY
// ============================================================

/**
 * Platform-managed API key (credit system).
 *
 * @see storm-022 v1 revision Section 6
 */
export interface PlatformApiKey {
  provider: LLMProvider;
  encrypted_key: string;
  created_at: string;
  rotated_at: string;
  rate_limit: { rpm: number; tpm: number };
}

export const PlatformApiKeySchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  encrypted_key: z.string().min(1),
  created_at: z.string().datetime(),
  rotated_at: z.string().datetime(),
  rate_limit: z.object({
    rpm: z.number().int().positive(),
    tpm: z.number().int().positive(),
  }),
});

/**
 * BYOK (Bring Your Own Key) configuration per user.
 *
 * @see storm-022 v1 revision Section 6
 */
export interface BYOKConfig {
  user_id: string;
  provider: LLMProvider;
  encrypted_key: Uint8Array;
  encryption_method: BYOKEncryptionMethod;
  created_at: string;
  last_used?: string;
}

export const BYOKConfigSchema = z.object({
  user_id: z.string().min(1),
  provider: z.enum(LLM_PROVIDERS),
  encrypted_key: z.instanceof(Uint8Array),
  encryption_method: z.enum(BYOK_ENCRYPTION_METHODS),
  created_at: z.string().datetime(),
  last_used: z.string().datetime().optional(),
});

/**
 * Routing configuration for an API call.
 *
 * @see storm-022 v1 revision Section 6
 */
export interface ApiCallRoute {
  key_type: ApiKeyType;
  flow: ApiCallFlow;
  rate_limited: boolean;
  usage_logged: boolean;
}

export const ApiCallRouteSchema = z.object({
  key_type: z.enum(API_KEY_TYPES),
  flow: z.enum(API_CALL_FLOWS),
  rate_limited: z.boolean(),
  usage_logged: z.boolean(),
});

/**
 * Rate limiting configuration for BYOK key decryption.
 *
 * @see storm-022 v1 revision Section 6
 */
export interface BYOKRateLimitConfig {
  max_decryptions_per_minute: number;
  exponential_backoff: boolean;
  lockout_after_failures: number;
  lockout_duration_minutes: number;
}

export const BYOKRateLimitConfigSchema = z.object({
  max_decryptions_per_minute: z.number().int().positive(),
  exponential_backoff: z.boolean(),
  lockout_after_failures: z.number().int().positive(),
  lockout_duration_minutes: z.number().int().positive(),
});

/**
 * Tracks BYOK decryption attempts for rate limiting.
 *
 * @see storm-022 v1 revision Section 6
 */
export interface BYOKDecryptionAttempt {
  user_id: string;
  attempted_at: string;
  success: boolean;
  consecutive_failures: number;
  locked_out: boolean;
  lockout_expires_at: string | null;
}

export const BYOKDecryptionAttemptSchema = z.object({
  user_id: z.string().min(1),
  attempted_at: z.string().datetime(),
  success: z.boolean(),
  consecutive_failures: z.number().int().min(0),
  locked_out: z.boolean(),
  lockout_expires_at: z.string().datetime().nullable(),
});

// ============================================================
// COMPLIANCE
// ============================================================

/**
 * Export compliance requirements per region and tier.
 *
 * @see storm-022 v1 revision Section 7
 */
export interface ExportComplianceConfig {
  region: string;
  standard_tier: ExportComplianceStatus;
  private_tier: ExportComplianceStatus;
  documentation_required: string[];
  notes: string;
}

export const ExportComplianceConfigSchema = z.object({
  region: z.string().min(1),
  standard_tier: z.enum(EXPORT_COMPLIANCE_STATUSES),
  private_tier: z.enum(EXPORT_COMPLIANCE_STATUSES),
  documentation_required: z.array(z.string()),
  notes: z.string(),
});

/**
 * App store encryption declarations per platform.
 *
 * @see storm-022 v1 revision Section 7
 */
export interface AppStoreDeclaration {
  platform: Platform;
  uses_non_exempt_encryption: boolean;
  eccn?: string;
  mass_market_exemption?: boolean;
  self_classification_filed: boolean;
  annual_report_due?: string;
}

export const AppStoreDeclarationSchema = z.object({
  platform: z.enum(PLATFORMS),
  uses_non_exempt_encryption: z.boolean(),
  eccn: z.string().optional(),
  mass_market_exemption: z.boolean().optional(),
  self_classification_filed: z.boolean(),
  annual_report_due: z.string().datetime().optional(),
});

/**
 * A single entry in the threat model.
 *
 * @see storm-022 v1 revision Section 8
 */
export interface ThreatModelEntry {
  threat: string;
  protected_by_standard: boolean;
  protected_by_private: boolean;
  description: string;
}

export const ThreatModelEntrySchema = z.object({
  threat: z.string().min(1),
  protected_by_standard: z.boolean(),
  protected_by_private: z.boolean(),
  description: z.string().min(1),
});

/**
 * A single phase in the staged launch strategy.
 *
 * @see storm-022 v1 revision Section 7
 */
export interface LaunchPhase {
  version: string;
  features: string[];
  markets: string[];
  compliance_requirements: string[];
}

export const LaunchPhaseSchema = z.object({
  version: z.string().min(1),
  features: z.array(z.string()),
  markets: z.array(z.string()),
  compliance_requirements: z.array(z.string()),
});

// ============================================================
// OFFLINE AUTH
// ============================================================

/**
 * Configuration for a single offline state.
 *
 * @see storm-022 v1 revision Section 1
 */
export interface OfflineStateConfig {
  state: OfflineState;
  max_hours: number;
  functionality: OfflineFunctionality;
  sync_behavior: OfflineSyncBehavior;
  auth_behavior: string;
  private_tier_key_access: boolean;
}

export const OfflineStateConfigSchema = z.object({
  state: z.enum(OFFLINE_STATES),
  max_hours: z.number().min(0),
  functionality: z.enum(OFFLINE_FUNCTIONALITY_LEVELS),
  sync_behavior: z.enum(OFFLINE_SYNC_BEHAVIORS),
  auth_behavior: z.string().min(1),
  private_tier_key_access: z.boolean(),
});

/**
 * Queue of operations pending sync when device comes back online.
 */
export interface OfflineSyncQueue {
  operations: QueuedOperation[];
  created_at: string;
  last_attempted: string | null;
}

export const OfflineSyncQueueSchema = z.object({
  operations: z.array(z.lazy(() => QueuedOperationSchema)),
  created_at: z.string().datetime(),
  last_attempted: z.string().datetime().nullable(),
});

/**
 * A single queued operation waiting to sync.
 */
export interface QueuedOperation {
  id: string;
  type: QueueOperationType;
  table: QueueableTable;
  data: unknown;
  queued_at: string;
  priority: number;
}

export const QueuedOperationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(QUEUE_OPERATION_TYPES),
  table: z.enum(QUEUEABLE_TABLES),
  data: z.unknown(),
  queued_at: z.string().datetime(),
  priority: z.number().int().min(0),
});

/**
 * Result of checking what's available in the current offline state.
 *
 * @see storm-022 v1 revision Section 1
 */
export interface OfflineCapabilityCheck {
  can_read: boolean;
  can_write: boolean;
  can_search: boolean;
  can_sync: boolean;
  can_use_llm: boolean;
  reason: string;
}

export const OfflineCapabilityCheckSchema = z.object({
  can_read: z.boolean(),
  can_write: z.boolean(),
  can_search: z.boolean(),
  can_sync: z.boolean(),
  can_use_llm: z.boolean(),
  reason: z.string().min(1),
});

/**
 * Result of processing the offline sync queue.
 */
export interface QueueSyncResult {
  synced: number;
  failed: number;
  errors?: Array<{ operation_id: string; error: string }>;
}

export const QueueSyncResultSchema = z.object({
  synced: z.number().int().min(0),
  failed: z.number().int().min(0),
  errors: z.array(z.object({
    operation_id: z.string(),
    error: z.string(),
  })).optional(),
});
