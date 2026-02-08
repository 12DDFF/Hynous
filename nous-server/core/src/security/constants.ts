/**
 * @module @nous/core/security
 * @description Constants for Nous Security Layer (NSL)
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * All security constants, enums, crypto parameters, thresholds, and configuration
 * defaults for the two-tier privacy model. These values come from storm-022 v2
 * revision and should not be changed without updating the brainstorm.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/Index} - Spec overview
 * @see {@link Brainstorms/Infrastructure/storm-022-security-auth/_SESSION} - Brainstorm
 */

import { z } from 'zod';

// ============================================================
// PRIVACY TIERS
// ============================================================

/**
 * Two-tier privacy model.
 *
 * - **standard:** Server-managed encryption (Turso AES-256 at-rest), full cloud search, seamless LLM
 * - **private:** Full E2E encryption (AES-256-GCM client-side), client-side HNSW search, explicit LLM consent
 *
 * @see storm-022 v1 revision Section 2 - Simplified from 3 tiers to 2
 */
export const PRIVACY_TIERS = ['standard', 'private'] as const;

export type PrivacyTier = (typeof PRIVACY_TIERS)[number];

export const PrivacyTierSchema = z.enum(PRIVACY_TIERS);

/**
 * Type guard for PrivacyTier.
 */
export function isPrivacyTier(value: unknown): value is PrivacyTier {
  return PRIVACY_TIERS.includes(value as PrivacyTier);
}

// ============================================================
// AUTH PROVIDERS
// ============================================================

/**
 * Supported authentication providers.
 * Clerk recommended for DX, extensible for future providers.
 *
 * @see storm-022 research.md - Auth provider comparison
 */
export const AUTH_PROVIDERS = ['clerk'] as const;

export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const AuthProviderSchema = z.enum(AUTH_PROVIDERS);

/**
 * Supported authentication methods.
 * Sign in with Apple is REQUIRED for iOS if offering social login.
 *
 * @see storm-022 original-prompt.md - User requirements
 */
export const AUTH_METHODS = ['apple', 'google', 'email_password'] as const;

export type AuthMethod = (typeof AUTH_METHODS)[number];

export const AuthMethodSchema = z.enum(AUTH_METHODS);

// ============================================================
// PLATFORMS
// ============================================================

/**
 * Supported platforms.
 * iOS/Android use native Clerk SDKs.
 * macOS/Windows use system browser OAuth with deep links (Tauri).
 *
 * @see storm-022 v1 revision Section 1 - Platform-specific implementation
 */
export const PLATFORMS = ['ios', 'android', 'macos', 'windows'] as const;

export type Platform = (typeof PLATFORMS)[number];

export const PlatformSchema = z.enum(PLATFORMS);

/**
 * Type guard for Platform.
 */
export function isPlatform(value: unknown): value is Platform {
  return PLATFORMS.includes(value as Platform);
}

// ============================================================
// OFFLINE STATES
// ============================================================

/**
 * Offline authentication states with graceful degradation.
 *
 * - **online:** Full functionality
 * - **short_offline:** <24h, JWT valid, full functionality
 * - **medium_offline:** <7d, JWT expired, read-only + queued writes
 * - **long_offline:** >7d, refresh expired, local only
 * - **reauth_required:** Must reconnect to continue
 *
 * @see storm-022 v1 revision Section 1 - Token Management & Offline States
 */
export const OFFLINE_STATES = [
  'online',
  'short_offline',
  'medium_offline',
  'long_offline',
  'reauth_required',
] as const;

export type OfflineState = (typeof OFFLINE_STATES)[number];

export const OfflineStateSchema = z.enum(OFFLINE_STATES);

/**
 * Type guard for OfflineState.
 */
export function isOfflineState(value: unknown): value is OfflineState {
  return OFFLINE_STATES.includes(value as OfflineState);
}

/**
 * Offline state transition thresholds (in hours).
 *
 * @see storm-022 v1 revision Section 1 - updateOfflineState()
 */
export const OFFLINE_THRESHOLDS = {
  /** <24h since last online: JWT still valid, full functionality */
  short_offline: 24,
  /** <7d (168h) since last online: JWT expired, read-only + queued writes */
  medium_offline: 168,
  /** >7d: refresh token expired, local data only */
  long_offline: Infinity,
} as const;

// ============================================================
// CONSENT SCOPES
// ============================================================

/**
 * LLM consent scope options for Private tier users.
 *
 * - **per_message:** Every LLM query shows consent dialog (most secure)
 * - **per_conversation:** First query shows dialog; subsequent auto-approved (default)
 * - **time_based:** Consent valid for chosen duration (1h, 24h, 7d)
 * - **topic_based:** "Remember for similar questions" using embedding similarity
 *
 * @see storm-022 v2 Section 10.2 - Per-Message vs Per-Session Consent
 */
export const CONSENT_SCOPES = [
  'per_message',
  'per_conversation',
  'time_based',
  'topic_based',
] as const;

export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const ConsentScopeSchema = z.enum(CONSENT_SCOPES);

/**
 * Type guard for ConsentScope.
 */
export function isConsentScope(value: unknown): value is ConsentScope {
  return CONSENT_SCOPES.includes(value as ConsentScope);
}

/**
 * Default consent scope for new Private tier users.
 * Per-conversation balances security and UX.
 *
 * @see storm-022 _SESSION.md - Decision: per-session consent default
 */
export const DEFAULT_CONSENT_SCOPE: ConsentScope = 'per_conversation';

/**
 * Conversation idle timeout before consent resets (minutes).
 * After 30 min idle, per-conversation consent expires.
 *
 * @see storm-022 v2 Section 10.2 - "Conversation" = continuous session, resets after 30 min idle
 */
export const CONVERSATION_TIMEOUT_MINUTES = 30;

/**
 * Cosine similarity threshold for topic-based consent matching.
 * Queries with >0.85 similarity to remembered topic are auto-approved.
 *
 * @see storm-022 v2 Section 10.2 - Similarity threshold: 0.85 cosine similarity
 */
export const TOPIC_SIMILARITY_THRESHOLD = 0.85;

/**
 * Time-based consent duration options.
 *
 * @see storm-022 v2 Section 10.2 - Time-Based (Convenience)
 */
export const CONSENT_DURATIONS = ['1h', '24h', '7d'] as const;

export type ConsentDuration = (typeof CONSENT_DURATIONS)[number];

export const ConsentDurationSchema = z.enum(CONSENT_DURATIONS);

// ============================================================
// CONSENT REVOCATION SCOPES
// ============================================================

/**
 * Consent revocation granularity options.
 *
 * @see storm-022 v2 Section 10.5 - Consent Revocation Flow
 */
export const CONSENT_REVOCATION_SCOPES = [
  'this_conversation',
  'all_active',
  'everything',
] as const;

export type ConsentRevocationScope = (typeof CONSENT_REVOCATION_SCOPES)[number];

export const ConsentRevocationScopeSchema = z.enum(CONSENT_REVOCATION_SCOPES);

// ============================================================
// ENCRYPTION CONSTANTS
// ============================================================

/**
 * Encryption algorithm for all E2E operations.
 * AES-256-GCM provides authenticated encryption with associated data.
 *
 * @see storm-022 v1 revision Section 2 - E2E Encryption Design
 */
export const ENCRYPTION_ALGORITHM = 'AES-256-GCM';

/**
 * Key derivation function used throughout.
 *
 * @see storm-022 v1 revision Section 3 - Key Hierarchy
 */
export const KEY_DERIVATION_FUNCTION = 'HKDF-SHA256';

/**
 * Master key length in bits. Standard for AES-256.
 */
export const MASTER_KEY_LENGTH_BITS = 256;

/**
 * AES-GCM nonce length in bytes (96 bits).
 * CRITICAL: Every encryption MUST use a unique nonce. Nonce reuse with same key
 * is catastrophic for AES-GCM security.
 */
export const NONCE_LENGTH_BYTES = 12;

/**
 * Derived key purpose strings for HKDF.
 * Each derived key uses a unique purpose string to produce
 * cryptographically independent keys from the same master key.
 *
 * @see storm-022 v1 revision Section 3 - HKDF with purpose strings
 */
export const KEY_PURPOSES = ['content', 'embedding', 'metadata'] as const;

export type KeyPurpose = (typeof KEY_PURPOSES)[number];

export const KeyPurposeSchema = z.enum(KEY_PURPOSES);

/**
 * HKDF info strings for key derivation.
 * Format: 'nous-{purpose}'
 *
 * @see storm-022 v1 revision Section 3 - HKDF("content"), HKDF("embedding"), HKDF("metadata")
 */
export const DERIVATION_INFO_STRINGS: Record<KeyPurpose, string> = {
  content: 'nous-content',
  embedding: 'nous-embedding',
  metadata: 'nous-metadata',
} as const;

// ============================================================
// KEY ROTATION CONSTANTS
// ============================================================

/**
 * Number of nodes processed per re-encryption batch.
 *
 * @see storm-022 v2 Section 9.7 - Batch Re-encryption Strategy
 */
export const ROTATION_BATCH_SIZE = 100;

/**
 * Pause between batches to prevent UI jank (milliseconds).
 *
 * @see storm-022 v2 Section 9.7 - RotationConfig
 */
export const ROTATION_PAUSE_BETWEEN_BATCHES_MS = 500;

/**
 * Maximum batches per minute (rate limit).
 *
 * @see storm-022 v2 Section 9.7 - RotationConfig
 */
export const ROTATION_MAX_BATCHES_PER_MINUTE = 60;

/**
 * Minimum battery level to continue rotation (percentage).
 * Rotation pauses if battery drops below this threshold.
 *
 * @see storm-022 v2 Section 9.7 - RotationConfig
 */
export const ROTATION_MIN_BATTERY_LEVEL = 20;

/**
 * Days to retain deprecated key version after rotation.
 * Handles devices that haven't synced yet.
 *
 * @see storm-022 v2 Section 9.3 - "status: 'deprecated' for old key (kept 30 days for sync lag)"
 */
export const DEPRECATED_KEY_RETENTION_DAYS = 30;

/**
 * Percentage of nodes to sample for post-rotation verification.
 *
 * @see storm-022 v2 Section 9.3 - "Sample 5% of nodes"
 */
export const ROTATION_VERIFICATION_SAMPLE_PERCENT = 5;

/**
 * Key version lifecycle statuses.
 *
 * @see storm-022 v2 Section 9.2 - KeyVersion interface
 */
export const KEY_VERSION_STATUSES = ['active', 'rotating', 'deprecated', 'expired'] as const;

export type KeyVersionStatus = (typeof KEY_VERSION_STATUSES)[number];

export const KeyVersionStatusSchema = z.enum(KEY_VERSION_STATUSES);

/**
 * Type guard for KeyVersionStatus.
 */
export function isKeyVersionStatus(value: unknown): value is KeyVersionStatus {
  return KEY_VERSION_STATUSES.includes(value as KeyVersionStatus);
}

/**
 * Key rotation triggers.
 *
 * @see storm-022 v2 Section 9.1 - When Key Rotation Occurs
 */
export const KEY_ROTATION_TRIGGERS = [
  'passkey_change',
  'scheduled',
  'security_incident',
  'recovery_used',
] as const;

export type KeyRotationTrigger = (typeof KEY_ROTATION_TRIGGERS)[number];

export const KeyRotationTriggerSchema = z.enum(KEY_ROTATION_TRIGGERS);

/**
 * Scheduled rotation interval in months.
 *
 * @see storm-022 v2 Section 9.1 - "Scheduled rotation: Every 12 months"
 */
export const SCHEDULED_ROTATION_MONTHS = 12;

/**
 * Rotation re-encryption timing estimates (throttled, Wi-Fi + charging).
 *
 * @see storm-022 v2 Section 9.3 - Timing Estimates table
 */
export const ROTATION_TIMING_ESTIMATES = {
  '1k': { reencrypt_seconds: 30, background_minutes: 2 },
  '10k': { reencrypt_seconds: 300, background_minutes: 15 },
  '50k': { reencrypt_seconds: 1500, background_minutes: 60 },
} as const;

// ============================================================
// ROTATION PHASES
// ============================================================

/**
 * Phases of the key rotation process.
 *
 * @see storm-022 v2 Section 9.3 - 3-phase rotation flow
 */
export const ROTATION_PHASES = ['generating', 'reencrypting', 'verifying', 'completing'] as const;

export type RotationPhase = (typeof ROTATION_PHASES)[number];

export const RotationPhaseSchema = z.enum(ROTATION_PHASES);

// ============================================================
// ROTATION EVENTS
// ============================================================

/**
 * Rotation event types for UI updates.
 *
 * @see storm-022 v2 Section 9.4 - Migration UX Flow
 */
export const ROTATION_EVENT_TYPES = [
  'rotation:started',
  'rotation:progress',
  'rotation:paused',
  'rotation:resumed',
  'rotation:completed',
  'rotation:failed',
] as const;

export type RotationEventType = (typeof ROTATION_EVENT_TYPES)[number];

export const RotationEventTypeSchema = z.enum(ROTATION_EVENT_TYPES);

// ============================================================
// RECOVERY CONSTANTS
// ============================================================

/**
 * BIP39 mnemonic word count for recovery code.
 *
 * @see storm-022 v1 revision Section 3 - "24-word BIP39 mnemonic"
 */
export const RECOVERY_WORD_COUNT = 24;

/**
 * Number of random words user must enter during forced verification.
 *
 * @see storm-022 v1 revision Section 3 - "Enter words 3, 8, and 17"
 */
export const RECOVERY_VERIFICATION_WORD_COUNT = 3;

/**
 * Maximum verification attempts before requiring code regeneration.
 */
export const RECOVERY_VERIFICATION_ATTEMPT_LIMIT = 3;

/**
 * Grace period duration in days.
 * During this time, email recovery is available as a fallback.
 * After expiry, true E2E promise is honored (no backdoor).
 *
 * @see storm-022 v1 revision Section 3 - "7-DAY GRACE PERIOD"
 */
export const GRACE_PERIOD_DAYS = 7;

/**
 * Recovery reminder schedule (days after Private tier setup).
 *
 * @see storm-022 v1 revision Section 3 - Periodic Reminders
 */
export const RECOVERY_REMINDER_DAYS = [30, 180] as const;

/**
 * Recovery methods available to users.
 *
 * @see storm-022 v1 revision Section 3 - Recovery Options
 */
export const RECOVERY_METHODS = [
  'multi_device',
  'recovery_code',
  'grace_period',
] as const;

export type RecoveryMethod = (typeof RECOVERY_METHODS)[number];

export const RecoveryMethodSchema = z.enum(RECOVERY_METHODS);

/**
 * Recovery reminder types.
 */
export const RECOVERY_REMINDER_TYPES = ['initial', 'periodic', 'new_device'] as const;

export type RecoveryReminderType = (typeof RECOVERY_REMINDER_TYPES)[number];

export const RecoveryReminderTypeSchema = z.enum(RECOVERY_REMINDER_TYPES);

// ============================================================
// TOKEN CONFIGURATION
// ============================================================

/**
 * JWT access token lifetime in minutes.
 *
 * @see storm-022 v1 revision Section 1 - "Short-lived (15 min)"
 */
export const ACCESS_TOKEN_EXPIRY_MINUTES = 15;

/**
 * Refresh token lifetime in days.
 *
 * @see storm-022 v1 revision Section 1 - "Long-lived (30 days)"
 */
export const REFRESH_TOKEN_EXPIRY_DAYS = 30;

// ============================================================
// BYOK RATE LIMITING
// ============================================================

/**
 * Maximum BYOK key decryption attempts per minute.
 * Prevents brute force attacks on encrypted API keys.
 *
 * @see storm-022 v1 revision Section 6 - "Max 5 key decryptions per minute"
 */
export const BYOK_MAX_DECRYPTIONS_PER_MINUTE = 5;

/**
 * Number of BYOK decryption failures before lockout.
 */
export const BYOK_LOCKOUT_AFTER_FAILURES = 10;

/**
 * BYOK lockout duration in minutes after exceeding failure limit.
 */
export const BYOK_LOCKOUT_DURATION_MINUTES = 30;

// ============================================================
// CLIENT-SIDE SEARCH LIMITS (Private tier)
// ============================================================

/**
 * Maximum recommended node counts for Private tier client-side search.
 *
 * @see storm-022 v1 revision Section 2 - "Private tier practical limit ~50K nodes on mobile"
 */
export const PRIVATE_TIER_NODE_LIMITS = {
  mobile: 50_000,
  desktop: 100_000,
} as const;

/**
 * Client-side search performance estimates.
 *
 * @see storm-022 v1 revision Section 2 - Performance Limits table
 */
export const CLIENT_SEARCH_PERFORMANCE = {
  /** Time to decrypt per 1K nodes (milliseconds) */
  decrypt_time_ms_per_1k: 100,
  /** Time to build HNSW index per 1K nodes (milliseconds) */
  index_build_time_ms_per_1k: 200,
  /** Search latency by node count (milliseconds) */
  search_latency_ms: {
    '10k': 20,
    '50k': 40,
    '100k': 60,
  },
  /** Memory usage per 10K nodes (megabytes) */
  memory_mb_per_10k: 130,
} as const;

// ============================================================
// AUTH SECURITY DEFAULTS
// ============================================================

/**
 * Brute force lockout threshold (login attempts).
 *
 * @see storm-022 v1 revision Section 1 - Security Measures via Clerk
 */
export const BRUTE_FORCE_LOCKOUT_ATTEMPTS = 5;

/**
 * Brute force lockout duration (minutes).
 */
export const BRUTE_FORCE_LOCKOUT_MINUTES = 15;

/**
 * CAPTCHA trigger threshold (failed attempts).
 */
export const CAPTCHA_AFTER_FAILURES = 3;

// ============================================================
// EXPORT COMPLIANCE
// ============================================================

/**
 * Export Control Classification Number for Private tier encryption.
 *
 * @see storm-022 v1 revision Section 7 - "Self-classification under ECCN 5D992"
 */
export const ECCN_CLASSIFICATION = '5D992';

/**
 * Export compliance status levels.
 *
 * @see storm-022 v1 revision Section 7 - Export Compliance
 */
export const EXPORT_COMPLIANCE_STATUSES = [
  'exempt',
  'requires_documentation',
  'excluded',
] as const;

export type ExportComplianceStatus = (typeof EXPORT_COMPLIANCE_STATUSES)[number];

export const ExportComplianceStatusSchema = z.enum(EXPORT_COMPLIANCE_STATUSES);

// ============================================================
// DESKTOP AUTH FLOW STEPS
// ============================================================

/**
 * Desktop (Tauri) auth flow steps.
 *
 * @see storm-022 v1 revision Section 1 - Desktop Auth Flow
 */
export const DESKTOP_AUTH_STEPS = [
  'idle',
  'browser_opened',
  'waiting_callback',
  'processing_token',
  'complete',
  'error',
] as const;

export type DesktopAuthStep = (typeof DESKTOP_AUTH_STEPS)[number];

export const DesktopAuthStepSchema = z.enum(DESKTOP_AUTH_STEPS);

// ============================================================
// TIER MIGRATION STATUSES
// ============================================================

/**
 * Tier migration process statuses.
 *
 * @see storm-022 v1 revision Section 4 - Tier Migration
 */
export const TIER_MIGRATION_STATUSES = [
  'pending',
  'key_setup',
  'migrating',
  'verifying',
  'complete',
  'failed',
] as const;

export type TierMigrationStatus = (typeof TIER_MIGRATION_STATUSES)[number];

export const TierMigrationStatusSchema = z.enum(TIER_MIGRATION_STATUSES);

/**
 * Tier migration rate: milliseconds per 1K nodes.
 * ~1 minute per 1K nodes.
 *
 * @see storm-022 v1 revision Section 4 - "Duration: ~1 minute per 1K nodes"
 */
export const MIGRATION_RATE_MS_PER_1K_NODES = 60_000;

// ============================================================
// CONSENT EVENT TYPES
// ============================================================

/**
 * Consent event types for logging and analytics.
 *
 * @see storm-022 v2 Section 10 - LLM Consent UX
 */
export const CONSENT_EVENT_TYPES = [
  'consent:requested',
  'consent:granted',
  'consent:declined',
  'consent:revoked',
  'consent:expired',
] as const;

export type ConsentEventType = (typeof CONSENT_EVENT_TYPES)[number];

export const ConsentEventTypeSchema = z.enum(CONSENT_EVENT_TYPES);

// ============================================================
// PASSKEY PLATFORMS
// ============================================================

/**
 * Passkey sync platforms (for multi-device key management).
 *
 * @see storm-022 v1 revision Section 3 - Key Hierarchy
 */
export const PASSKEY_PLATFORMS = ['apple', 'google', 'microsoft'] as const;

export type PasskeyPlatform = (typeof PASSKEY_PLATFORMS)[number];

export const PasskeyPlatformSchema = z.enum(PASSKEY_PLATFORMS);

/**
 * Passkey sync mechanisms by platform.
 */
export const PASSKEY_SYNC_MECHANISMS: Record<PasskeyPlatform, string> = {
  apple: 'icloud_keychain',
  google: 'google_password_manager',
  microsoft: 'microsoft_entra',
} as const;

// ============================================================
// RECOVERY SETUP STEPS
// ============================================================

/**
 * Steps in the recovery code setup flow.
 *
 * @see storm-022 v1 revision Section 3 - Forced Verification setup flow
 */
export const RECOVERY_SETUP_STEPS = [
  'generating',
  'displaying',
  'verifying',
  'complete',
] as const;

export type RecoverySetupStep = (typeof RECOVERY_SETUP_STEPS)[number];

export const RecoverySetupStepSchema = z.enum(RECOVERY_SETUP_STEPS);

// ============================================================
// API KEY TYPES
// ============================================================

/**
 * API key ownership types.
 *
 * @see storm-022 v1 revision Section 6 - API Key Security
 */
export const API_KEY_TYPES = ['platform', 'byok'] as const;

export type ApiKeyType = (typeof API_KEY_TYPES)[number];

export const ApiKeyTypeSchema = z.enum(API_KEY_TYPES);

/**
 * API call flow modes.
 *
 * - **proxied:** Platform keys - calls go through Nous API proxy
 * - **direct:** BYOK - calls go directly from client to LLM provider
 *
 * @see storm-022 v1 revision Section 6 - API Call Flow diagrams
 */
export const API_CALL_FLOWS = ['proxied', 'direct'] as const;

export type ApiCallFlow = (typeof API_CALL_FLOWS)[number];

export const ApiCallFlowSchema = z.enum(API_CALL_FLOWS);

// ============================================================
// BYOK ENCRYPTION METHODS
// ============================================================

/**
 * BYOK key encryption methods by tier.
 *
 * - **server_side:** Standard tier - Nous API decrypts
 * - **user_key:** Private tier - only user's device can decrypt
 *
 * @see storm-022 v1 revision Section 6 - BYOK Key Storage
 */
export const BYOK_ENCRYPTION_METHODS = ['server_side', 'user_key'] as const;

export type BYOKEncryptionMethod = (typeof BYOK_ENCRYPTION_METHODS)[number];

export const BYOKEncryptionMethodSchema = z.enum(BYOK_ENCRYPTION_METHODS);

// ============================================================
// MFA OPTIONS
// ============================================================

/**
 * Multi-factor authentication options (via Clerk).
 *
 * @see storm-022 v1 revision Section 1 - Security Measures
 */
export const MFA_OPTIONS = ['totp', 'sms', 'passkey'] as const;

export type MfaOption = (typeof MFA_OPTIONS)[number];

export const MfaOptionSchema = z.enum(MFA_OPTIONS);

// ============================================================
// SIGN-IN METHOD IMPLEMENTATIONS
// ============================================================

/**
 * Sign-in method implementation approaches by platform.
 *
 * @see storm-022 v1 revision Section 1 - Platform-Specific Implementation table
 */
export const SIGN_IN_IMPLEMENTATIONS = ['native', 'rest_api', 'oauth', 'clerk_ui', 'clerk_web'] as const;

export type SignInImplementation = (typeof SIGN_IN_IMPLEMENTATIONS)[number];

export const SignInImplementationSchema = z.enum(SIGN_IN_IMPLEMENTATIONS);

// ============================================================
// DEEP LINK SCHEME
// ============================================================

/**
 * Deep link scheme for desktop (Tauri) OAuth callback.
 *
 * @see storm-022 v1 revision Section 1 - "nous://auth/callback?token=..."
 */
export const DEEP_LINK_SCHEME = 'nous';

/**
 * OAuth callback path.
 */
export const AUTH_CALLBACK_PATH = '/auth/callback';

// ============================================================
// OFFLINE FUNCTIONALITY LEVELS
// ============================================================

/**
 * Functionality levels available in offline states.
 *
 * @see storm-022 v1 revision Section 1 - Offline States table
 */
export const OFFLINE_FUNCTIONALITY_LEVELS = [
  'full',
  'read_write_queued',
  'read_only',
  'local_only',
] as const;

export type OfflineFunctionality = (typeof OFFLINE_FUNCTIONALITY_LEVELS)[number];

export const OfflineFunctionalitySchema = z.enum(OFFLINE_FUNCTIONALITY_LEVELS);

// ============================================================
// OFFLINE SYNC BEHAVIORS
// ============================================================

/**
 * Sync behaviors for each offline state.
 */
export const OFFLINE_SYNC_BEHAVIORS = [
  'realtime',
  'queued',
  'paused',
  'none',
] as const;

export type OfflineSyncBehavior = (typeof OFFLINE_SYNC_BEHAVIORS)[number];

export const OfflineSyncBehaviorSchema = z.enum(OFFLINE_SYNC_BEHAVIORS);

// ============================================================
// QUEUEABLE TABLES
// ============================================================

/**
 * Tables that can have queued offline operations.
 */
export const QUEUEABLE_TABLES = ['nodes', 'edges', 'episodes'] as const;

export type QueueableTable = (typeof QUEUEABLE_TABLES)[number];

/**
 * Operation types for the offline sync queue.
 */
export const QUEUE_OPERATION_TYPES = ['create', 'update', 'delete'] as const;

export type QueueOperationType = (typeof QUEUE_OPERATION_TYPES)[number];

// ============================================================
// DECLINE ACTIONS (Consent)
// ============================================================

/**
 * Actions available to the user after declining LLM memory access.
 *
 * @see storm-022 v2 Section 10.6 - Graceful Degradation Rules
 */
export const DECLINE_ACTIONS = [
  'general_questions',
  'writing_assistance',
  'brainstorming',
  'allow_this_question',
  'end_conversation',
] as const;

export type DeclineAction = (typeof DECLINE_ACTIONS)[number];

// ============================================================
// LLM PROVIDERS (API Key Management)
// ============================================================

/**
 * Supported LLM providers for API key management.
 *
 * @see storm-022 v1 revision Section 6 - API Key Security
 * @see storm-015 - LLM Integration provider pool
 */
export const LLM_PROVIDERS = ['openai', 'anthropic', 'google'] as const;

export type LLMProvider = (typeof LLM_PROVIDERS)[number];

export const LLMProviderSchema = z.enum(LLM_PROVIDERS);

// ============================================================
// RE-ENCRYPTION PRIORITY
// ============================================================

/**
 * Priority ordering for re-encryption during key rotation.
 *
 * @see storm-022 v2 Section 9.7 - Priority Ordering
 */
export const REENCRYPTION_PRIORITY_ORDER = [
  'recently_accessed',
  'frequently_accessed',
  'oldest_first',
] as const;

export type ReencryptionPriority = (typeof REENCRYPTION_PRIORITY_ORDER)[number];

