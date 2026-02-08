import { z } from 'zod';

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

/**
 * Two-tier privacy model.
 *
 * - **standard:** Server-managed encryption (Turso AES-256 at-rest), full cloud search, seamless LLM
 * - **private:** Full E2E encryption (AES-256-GCM client-side), client-side HNSW search, explicit LLM consent
 *
 * @see storm-022 v1 revision Section 2 - Simplified from 3 tiers to 2
 */
declare const PRIVACY_TIERS: readonly ["standard", "private"];
type PrivacyTier = (typeof PRIVACY_TIERS)[number];
declare const PrivacyTierSchema: z.ZodEnum<["standard", "private"]>;
/**
 * Type guard for PrivacyTier.
 */
declare function isPrivacyTier(value: unknown): value is PrivacyTier;
/**
 * Supported authentication providers.
 * Clerk recommended for DX, extensible for future providers.
 *
 * @see storm-022 research.md - Auth provider comparison
 */
declare const AUTH_PROVIDERS: readonly ["clerk"];
type AuthProvider = (typeof AUTH_PROVIDERS)[number];
declare const AuthProviderSchema: z.ZodEnum<["clerk"]>;
/**
 * Supported authentication methods.
 * Sign in with Apple is REQUIRED for iOS if offering social login.
 *
 * @see storm-022 original-prompt.md - User requirements
 */
declare const AUTH_METHODS: readonly ["apple", "google", "email_password"];
type AuthMethod = (typeof AUTH_METHODS)[number];
declare const AuthMethodSchema: z.ZodEnum<["apple", "google", "email_password"]>;
/**
 * Supported platforms.
 * iOS/Android use native Clerk SDKs.
 * macOS/Windows use system browser OAuth with deep links (Tauri).
 *
 * @see storm-022 v1 revision Section 1 - Platform-specific implementation
 */
declare const PLATFORMS: readonly ["ios", "android", "macos", "windows"];
type Platform = (typeof PLATFORMS)[number];
declare const PlatformSchema: z.ZodEnum<["ios", "android", "macos", "windows"]>;
/**
 * Type guard for Platform.
 */
declare function isPlatform(value: unknown): value is Platform;
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
declare const OFFLINE_STATES: readonly ["online", "short_offline", "medium_offline", "long_offline", "reauth_required"];
type OfflineState = (typeof OFFLINE_STATES)[number];
declare const OfflineStateSchema: z.ZodEnum<["online", "short_offline", "medium_offline", "long_offline", "reauth_required"]>;
/**
 * Type guard for OfflineState.
 */
declare function isOfflineState(value: unknown): value is OfflineState;
/**
 * Offline state transition thresholds (in hours).
 *
 * @see storm-022 v1 revision Section 1 - updateOfflineState()
 */
declare const OFFLINE_THRESHOLDS: {
    /** <24h since last online: JWT still valid, full functionality */
    readonly short_offline: 24;
    /** <7d (168h) since last online: JWT expired, read-only + queued writes */
    readonly medium_offline: 168;
    /** >7d: refresh token expired, local data only */
    readonly long_offline: number;
};
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
declare const CONSENT_SCOPES: readonly ["per_message", "per_conversation", "time_based", "topic_based"];
type ConsentScope = (typeof CONSENT_SCOPES)[number];
declare const ConsentScopeSchema: z.ZodEnum<["per_message", "per_conversation", "time_based", "topic_based"]>;
/**
 * Type guard for ConsentScope.
 */
declare function isConsentScope(value: unknown): value is ConsentScope;
/**
 * Default consent scope for new Private tier users.
 * Per-conversation balances security and UX.
 *
 * @see storm-022 _SESSION.md - Decision: per-session consent default
 */
declare const DEFAULT_CONSENT_SCOPE: ConsentScope;
/**
 * Conversation idle timeout before consent resets (minutes).
 * After 30 min idle, per-conversation consent expires.
 *
 * @see storm-022 v2 Section 10.2 - "Conversation" = continuous session, resets after 30 min idle
 */
declare const CONVERSATION_TIMEOUT_MINUTES = 30;
/**
 * Cosine similarity threshold for topic-based consent matching.
 * Queries with >0.85 similarity to remembered topic are auto-approved.
 *
 * @see storm-022 v2 Section 10.2 - Similarity threshold: 0.85 cosine similarity
 */
declare const TOPIC_SIMILARITY_THRESHOLD = 0.85;
/**
 * Time-based consent duration options.
 *
 * @see storm-022 v2 Section 10.2 - Time-Based (Convenience)
 */
declare const CONSENT_DURATIONS: readonly ["1h", "24h", "7d"];
type ConsentDuration = (typeof CONSENT_DURATIONS)[number];
declare const ConsentDurationSchema: z.ZodEnum<["1h", "24h", "7d"]>;
/**
 * Consent revocation granularity options.
 *
 * @see storm-022 v2 Section 10.5 - Consent Revocation Flow
 */
declare const CONSENT_REVOCATION_SCOPES: readonly ["this_conversation", "all_active", "everything"];
type ConsentRevocationScope = (typeof CONSENT_REVOCATION_SCOPES)[number];
declare const ConsentRevocationScopeSchema: z.ZodEnum<["this_conversation", "all_active", "everything"]>;
/**
 * Encryption algorithm for all E2E operations.
 * AES-256-GCM provides authenticated encryption with associated data.
 *
 * @see storm-022 v1 revision Section 2 - E2E Encryption Design
 */
declare const ENCRYPTION_ALGORITHM = "AES-256-GCM";
/**
 * Key derivation function used throughout.
 *
 * @see storm-022 v1 revision Section 3 - Key Hierarchy
 */
declare const KEY_DERIVATION_FUNCTION = "HKDF-SHA256";
/**
 * Master key length in bits. Standard for AES-256.
 */
declare const MASTER_KEY_LENGTH_BITS = 256;
/**
 * AES-GCM nonce length in bytes (96 bits).
 * CRITICAL: Every encryption MUST use a unique nonce. Nonce reuse with same key
 * is catastrophic for AES-GCM security.
 */
declare const NONCE_LENGTH_BYTES = 12;
/**
 * Derived key purpose strings for HKDF.
 * Each derived key uses a unique purpose string to produce
 * cryptographically independent keys from the same master key.
 *
 * @see storm-022 v1 revision Section 3 - HKDF with purpose strings
 */
declare const KEY_PURPOSES: readonly ["content", "embedding", "metadata"];
type KeyPurpose = (typeof KEY_PURPOSES)[number];
declare const KeyPurposeSchema: z.ZodEnum<["content", "embedding", "metadata"]>;
/**
 * HKDF info strings for key derivation.
 * Format: 'nous-{purpose}'
 *
 * @see storm-022 v1 revision Section 3 - HKDF("content"), HKDF("embedding"), HKDF("metadata")
 */
declare const DERIVATION_INFO_STRINGS: Record<KeyPurpose, string>;
/**
 * Number of nodes processed per re-encryption batch.
 *
 * @see storm-022 v2 Section 9.7 - Batch Re-encryption Strategy
 */
declare const ROTATION_BATCH_SIZE = 100;
/**
 * Pause between batches to prevent UI jank (milliseconds).
 *
 * @see storm-022 v2 Section 9.7 - RotationConfig
 */
declare const ROTATION_PAUSE_BETWEEN_BATCHES_MS = 500;
/**
 * Maximum batches per minute (rate limit).
 *
 * @see storm-022 v2 Section 9.7 - RotationConfig
 */
declare const ROTATION_MAX_BATCHES_PER_MINUTE = 60;
/**
 * Minimum battery level to continue rotation (percentage).
 * Rotation pauses if battery drops below this threshold.
 *
 * @see storm-022 v2 Section 9.7 - RotationConfig
 */
declare const ROTATION_MIN_BATTERY_LEVEL = 20;
/**
 * Days to retain deprecated key version after rotation.
 * Handles devices that haven't synced yet.
 *
 * @see storm-022 v2 Section 9.3 - "status: 'deprecated' for old key (kept 30 days for sync lag)"
 */
declare const DEPRECATED_KEY_RETENTION_DAYS = 30;
/**
 * Percentage of nodes to sample for post-rotation verification.
 *
 * @see storm-022 v2 Section 9.3 - "Sample 5% of nodes"
 */
declare const ROTATION_VERIFICATION_SAMPLE_PERCENT = 5;
/**
 * Key version lifecycle statuses.
 *
 * @see storm-022 v2 Section 9.2 - KeyVersion interface
 */
declare const KEY_VERSION_STATUSES: readonly ["active", "rotating", "deprecated", "expired"];
type KeyVersionStatus = (typeof KEY_VERSION_STATUSES)[number];
declare const KeyVersionStatusSchema: z.ZodEnum<["active", "rotating", "deprecated", "expired"]>;
/**
 * Type guard for KeyVersionStatus.
 */
declare function isKeyVersionStatus(value: unknown): value is KeyVersionStatus;
/**
 * Key rotation triggers.
 *
 * @see storm-022 v2 Section 9.1 - When Key Rotation Occurs
 */
declare const KEY_ROTATION_TRIGGERS: readonly ["passkey_change", "scheduled", "security_incident", "recovery_used"];
type KeyRotationTrigger = (typeof KEY_ROTATION_TRIGGERS)[number];
declare const KeyRotationTriggerSchema: z.ZodEnum<["passkey_change", "scheduled", "security_incident", "recovery_used"]>;
/**
 * Scheduled rotation interval in months.
 *
 * @see storm-022 v2 Section 9.1 - "Scheduled rotation: Every 12 months"
 */
declare const SCHEDULED_ROTATION_MONTHS = 12;
/**
 * Rotation re-encryption timing estimates (throttled, Wi-Fi + charging).
 *
 * @see storm-022 v2 Section 9.3 - Timing Estimates table
 */
declare const ROTATION_TIMING_ESTIMATES: {
    readonly '1k': {
        readonly reencrypt_seconds: 30;
        readonly background_minutes: 2;
    };
    readonly '10k': {
        readonly reencrypt_seconds: 300;
        readonly background_minutes: 15;
    };
    readonly '50k': {
        readonly reencrypt_seconds: 1500;
        readonly background_minutes: 60;
    };
};
/**
 * Phases of the key rotation process.
 *
 * @see storm-022 v2 Section 9.3 - 3-phase rotation flow
 */
declare const ROTATION_PHASES: readonly ["generating", "reencrypting", "verifying", "completing"];
type RotationPhase = (typeof ROTATION_PHASES)[number];
declare const RotationPhaseSchema: z.ZodEnum<["generating", "reencrypting", "verifying", "completing"]>;
/**
 * Rotation event types for UI updates.
 *
 * @see storm-022 v2 Section 9.4 - Migration UX Flow
 */
declare const ROTATION_EVENT_TYPES: readonly ["rotation:started", "rotation:progress", "rotation:paused", "rotation:resumed", "rotation:completed", "rotation:failed"];
type RotationEventType = (typeof ROTATION_EVENT_TYPES)[number];
declare const RotationEventTypeSchema: z.ZodEnum<["rotation:started", "rotation:progress", "rotation:paused", "rotation:resumed", "rotation:completed", "rotation:failed"]>;
/**
 * BIP39 mnemonic word count for recovery code.
 *
 * @see storm-022 v1 revision Section 3 - "24-word BIP39 mnemonic"
 */
declare const RECOVERY_WORD_COUNT = 24;
/**
 * Number of random words user must enter during forced verification.
 *
 * @see storm-022 v1 revision Section 3 - "Enter words 3, 8, and 17"
 */
declare const RECOVERY_VERIFICATION_WORD_COUNT = 3;
/**
 * Maximum verification attempts before requiring code regeneration.
 */
declare const RECOVERY_VERIFICATION_ATTEMPT_LIMIT = 3;
/**
 * Grace period duration in days.
 * During this time, email recovery is available as a fallback.
 * After expiry, true E2E promise is honored (no backdoor).
 *
 * @see storm-022 v1 revision Section 3 - "7-DAY GRACE PERIOD"
 */
declare const GRACE_PERIOD_DAYS = 7;
/**
 * Recovery reminder schedule (days after Private tier setup).
 *
 * @see storm-022 v1 revision Section 3 - Periodic Reminders
 */
declare const RECOVERY_REMINDER_DAYS: readonly [30, 180];
/**
 * Recovery methods available to users.
 *
 * @see storm-022 v1 revision Section 3 - Recovery Options
 */
declare const RECOVERY_METHODS: readonly ["multi_device", "recovery_code", "grace_period"];
type RecoveryMethod = (typeof RECOVERY_METHODS)[number];
declare const RecoveryMethodSchema: z.ZodEnum<["multi_device", "recovery_code", "grace_period"]>;
/**
 * Recovery reminder types.
 */
declare const RECOVERY_REMINDER_TYPES: readonly ["initial", "periodic", "new_device"];
type RecoveryReminderType = (typeof RECOVERY_REMINDER_TYPES)[number];
declare const RecoveryReminderTypeSchema: z.ZodEnum<["initial", "periodic", "new_device"]>;
/**
 * JWT access token lifetime in minutes.
 *
 * @see storm-022 v1 revision Section 1 - "Short-lived (15 min)"
 */
declare const ACCESS_TOKEN_EXPIRY_MINUTES = 15;
/**
 * Refresh token lifetime in days.
 *
 * @see storm-022 v1 revision Section 1 - "Long-lived (30 days)"
 */
declare const REFRESH_TOKEN_EXPIRY_DAYS = 30;
/**
 * Maximum BYOK key decryption attempts per minute.
 * Prevents brute force attacks on encrypted API keys.
 *
 * @see storm-022 v1 revision Section 6 - "Max 5 key decryptions per minute"
 */
declare const BYOK_MAX_DECRYPTIONS_PER_MINUTE = 5;
/**
 * Number of BYOK decryption failures before lockout.
 */
declare const BYOK_LOCKOUT_AFTER_FAILURES = 10;
/**
 * BYOK lockout duration in minutes after exceeding failure limit.
 */
declare const BYOK_LOCKOUT_DURATION_MINUTES = 30;
/**
 * Maximum recommended node counts for Private tier client-side search.
 *
 * @see storm-022 v1 revision Section 2 - "Private tier practical limit ~50K nodes on mobile"
 */
declare const PRIVATE_TIER_NODE_LIMITS: {
    readonly mobile: 50000;
    readonly desktop: 100000;
};
/**
 * Client-side search performance estimates.
 *
 * @see storm-022 v1 revision Section 2 - Performance Limits table
 */
declare const CLIENT_SEARCH_PERFORMANCE: {
    /** Time to decrypt per 1K nodes (milliseconds) */
    readonly decrypt_time_ms_per_1k: 100;
    /** Time to build HNSW index per 1K nodes (milliseconds) */
    readonly index_build_time_ms_per_1k: 200;
    /** Search latency by node count (milliseconds) */
    readonly search_latency_ms: {
        readonly '10k': 20;
        readonly '50k': 40;
        readonly '100k': 60;
    };
    /** Memory usage per 10K nodes (megabytes) */
    readonly memory_mb_per_10k: 130;
};
/**
 * Brute force lockout threshold (login attempts).
 *
 * @see storm-022 v1 revision Section 1 - Security Measures via Clerk
 */
declare const BRUTE_FORCE_LOCKOUT_ATTEMPTS = 5;
/**
 * Brute force lockout duration (minutes).
 */
declare const BRUTE_FORCE_LOCKOUT_MINUTES = 15;
/**
 * CAPTCHA trigger threshold (failed attempts).
 */
declare const CAPTCHA_AFTER_FAILURES = 3;
/**
 * Export Control Classification Number for Private tier encryption.
 *
 * @see storm-022 v1 revision Section 7 - "Self-classification under ECCN 5D992"
 */
declare const ECCN_CLASSIFICATION = "5D992";
/**
 * Export compliance status levels.
 *
 * @see storm-022 v1 revision Section 7 - Export Compliance
 */
declare const EXPORT_COMPLIANCE_STATUSES: readonly ["exempt", "requires_documentation", "excluded"];
type ExportComplianceStatus = (typeof EXPORT_COMPLIANCE_STATUSES)[number];
declare const ExportComplianceStatusSchema: z.ZodEnum<["exempt", "requires_documentation", "excluded"]>;
/**
 * Desktop (Tauri) auth flow steps.
 *
 * @see storm-022 v1 revision Section 1 - Desktop Auth Flow
 */
declare const DESKTOP_AUTH_STEPS: readonly ["idle", "browser_opened", "waiting_callback", "processing_token", "complete", "error"];
type DesktopAuthStep = (typeof DESKTOP_AUTH_STEPS)[number];
declare const DesktopAuthStepSchema: z.ZodEnum<["idle", "browser_opened", "waiting_callback", "processing_token", "complete", "error"]>;
/**
 * Tier migration process statuses.
 *
 * @see storm-022 v1 revision Section 4 - Tier Migration
 */
declare const TIER_MIGRATION_STATUSES: readonly ["pending", "key_setup", "migrating", "verifying", "complete", "failed"];
type TierMigrationStatus = (typeof TIER_MIGRATION_STATUSES)[number];
declare const TierMigrationStatusSchema: z.ZodEnum<["pending", "key_setup", "migrating", "verifying", "complete", "failed"]>;
/**
 * Tier migration rate: milliseconds per 1K nodes.
 * ~1 minute per 1K nodes.
 *
 * @see storm-022 v1 revision Section 4 - "Duration: ~1 minute per 1K nodes"
 */
declare const MIGRATION_RATE_MS_PER_1K_NODES = 60000;
/**
 * Consent event types for logging and analytics.
 *
 * @see storm-022 v2 Section 10 - LLM Consent UX
 */
declare const CONSENT_EVENT_TYPES: readonly ["consent:requested", "consent:granted", "consent:declined", "consent:revoked", "consent:expired"];
type ConsentEventType = (typeof CONSENT_EVENT_TYPES)[number];
declare const ConsentEventTypeSchema: z.ZodEnum<["consent:requested", "consent:granted", "consent:declined", "consent:revoked", "consent:expired"]>;
/**
 * Passkey sync platforms (for multi-device key management).
 *
 * @see storm-022 v1 revision Section 3 - Key Hierarchy
 */
declare const PASSKEY_PLATFORMS: readonly ["apple", "google", "microsoft"];
type PasskeyPlatform = (typeof PASSKEY_PLATFORMS)[number];
declare const PasskeyPlatformSchema: z.ZodEnum<["apple", "google", "microsoft"]>;
/**
 * Passkey sync mechanisms by platform.
 */
declare const PASSKEY_SYNC_MECHANISMS: Record<PasskeyPlatform, string>;
/**
 * Steps in the recovery code setup flow.
 *
 * @see storm-022 v1 revision Section 3 - Forced Verification setup flow
 */
declare const RECOVERY_SETUP_STEPS: readonly ["generating", "displaying", "verifying", "complete"];
type RecoverySetupStep = (typeof RECOVERY_SETUP_STEPS)[number];
declare const RecoverySetupStepSchema: z.ZodEnum<["generating", "displaying", "verifying", "complete"]>;
/**
 * API key ownership types.
 *
 * @see storm-022 v1 revision Section 6 - API Key Security
 */
declare const API_KEY_TYPES: readonly ["platform", "byok"];
type ApiKeyType = (typeof API_KEY_TYPES)[number];
declare const ApiKeyTypeSchema: z.ZodEnum<["platform", "byok"]>;
/**
 * API call flow modes.
 *
 * - **proxied:** Platform keys - calls go through Nous API proxy
 * - **direct:** BYOK - calls go directly from client to LLM provider
 *
 * @see storm-022 v1 revision Section 6 - API Call Flow diagrams
 */
declare const API_CALL_FLOWS: readonly ["proxied", "direct"];
type ApiCallFlow = (typeof API_CALL_FLOWS)[number];
declare const ApiCallFlowSchema: z.ZodEnum<["proxied", "direct"]>;
/**
 * BYOK key encryption methods by tier.
 *
 * - **server_side:** Standard tier - Nous API decrypts
 * - **user_key:** Private tier - only user's device can decrypt
 *
 * @see storm-022 v1 revision Section 6 - BYOK Key Storage
 */
declare const BYOK_ENCRYPTION_METHODS: readonly ["server_side", "user_key"];
type BYOKEncryptionMethod = (typeof BYOK_ENCRYPTION_METHODS)[number];
declare const BYOKEncryptionMethodSchema: z.ZodEnum<["server_side", "user_key"]>;
/**
 * Multi-factor authentication options (via Clerk).
 *
 * @see storm-022 v1 revision Section 1 - Security Measures
 */
declare const MFA_OPTIONS: readonly ["totp", "sms", "passkey"];
type MfaOption = (typeof MFA_OPTIONS)[number];
declare const MfaOptionSchema: z.ZodEnum<["totp", "sms", "passkey"]>;
/**
 * Sign-in method implementation approaches by platform.
 *
 * @see storm-022 v1 revision Section 1 - Platform-Specific Implementation table
 */
declare const SIGN_IN_IMPLEMENTATIONS: readonly ["native", "rest_api", "oauth", "clerk_ui", "clerk_web"];
type SignInImplementation = (typeof SIGN_IN_IMPLEMENTATIONS)[number];
declare const SignInImplementationSchema: z.ZodEnum<["native", "rest_api", "oauth", "clerk_ui", "clerk_web"]>;
/**
 * Deep link scheme for desktop (Tauri) OAuth callback.
 *
 * @see storm-022 v1 revision Section 1 - "nous://auth/callback?token=..."
 */
declare const DEEP_LINK_SCHEME = "nous";
/**
 * OAuth callback path.
 */
declare const AUTH_CALLBACK_PATH = "/auth/callback";
/**
 * Functionality levels available in offline states.
 *
 * @see storm-022 v1 revision Section 1 - Offline States table
 */
declare const OFFLINE_FUNCTIONALITY_LEVELS: readonly ["full", "read_write_queued", "read_only", "local_only"];
type OfflineFunctionality = (typeof OFFLINE_FUNCTIONALITY_LEVELS)[number];
declare const OfflineFunctionalitySchema: z.ZodEnum<["full", "read_write_queued", "read_only", "local_only"]>;
/**
 * Sync behaviors for each offline state.
 */
declare const OFFLINE_SYNC_BEHAVIORS: readonly ["realtime", "queued", "paused", "none"];
type OfflineSyncBehavior = (typeof OFFLINE_SYNC_BEHAVIORS)[number];
declare const OfflineSyncBehaviorSchema: z.ZodEnum<["realtime", "queued", "paused", "none"]>;
/**
 * Tables that can have queued offline operations.
 */
declare const QUEUEABLE_TABLES: readonly ["nodes", "edges", "episodes"];
type QueueableTable = (typeof QUEUEABLE_TABLES)[number];
/**
 * Operation types for the offline sync queue.
 */
declare const QUEUE_OPERATION_TYPES: readonly ["create", "update", "delete"];
type QueueOperationType = (typeof QUEUE_OPERATION_TYPES)[number];
/**
 * Actions available to the user after declining LLM memory access.
 *
 * @see storm-022 v2 Section 10.6 - Graceful Degradation Rules
 */
declare const DECLINE_ACTIONS: readonly ["general_questions", "writing_assistance", "brainstorming", "allow_this_question", "end_conversation"];
type DeclineAction = (typeof DECLINE_ACTIONS)[number];
/**
 * Supported LLM providers for API key management.
 *
 * @see storm-022 v1 revision Section 6 - API Key Security
 * @see storm-015 - LLM Integration provider pool
 */
declare const LLM_PROVIDERS: readonly ["openai", "anthropic", "google"];
type LLMProvider = (typeof LLM_PROVIDERS)[number];
declare const LLMProviderSchema: z.ZodEnum<["openai", "anthropic", "google"]>;
/**
 * Priority ordering for re-encryption during key rotation.
 *
 * @see storm-022 v2 Section 9.7 - Priority Ordering
 */
declare const REENCRYPTION_PRIORITY_ORDER: readonly ["recently_accessed", "frequently_accessed", "oldest_first"];
type ReencryptionPriority = (typeof REENCRYPTION_PRIORITY_ORDER)[number];

export { KEY_PURPOSES as $, ACCESS_TOKEN_EXPIRY_MINUTES as A, BRUTE_FORCE_LOCKOUT_ATTEMPTS as B, CAPTCHA_AFTER_FAILURES as C, type ConsentDuration as D, ConsentDurationSchema as E, type ConsentEventType as F, ConsentEventTypeSchema as G, type ConsentRevocationScope as H, ConsentRevocationScopeSchema as I, type ConsentScope as J, ConsentScopeSchema as K, DECLINE_ACTIONS as L, DEEP_LINK_SCHEME as M, DEFAULT_CONSENT_SCOPE as N, DEPRECATED_KEY_RETENTION_DAYS as O, DERIVATION_INFO_STRINGS as P, DESKTOP_AUTH_STEPS as Q, type DeclineAction as R, type DesktopAuthStep as S, DesktopAuthStepSchema as T, ECCN_CLASSIFICATION as U, ENCRYPTION_ALGORITHM as V, EXPORT_COMPLIANCE_STATUSES as W, type ExportComplianceStatus as X, ExportComplianceStatusSchema as Y, GRACE_PERIOD_DAYS as Z, KEY_DERIVATION_FUNCTION as _, API_CALL_FLOWS as a, type RecoverySetupStep as a$, KEY_ROTATION_TRIGGERS as a0, KEY_VERSION_STATUSES as a1, type KeyPurpose as a2, KeyPurposeSchema as a3, type KeyRotationTrigger as a4, KeyRotationTriggerSchema as a5, type KeyVersionStatus as a6, KeyVersionStatusSchema as a7, type LLMProvider as a8, LLMProviderSchema as a9, type PrivacyTier as aA, PrivacyTierSchema as aB, QUEUEABLE_TABLES as aC, QUEUE_OPERATION_TYPES as aD, type QueueOperationType as aE, type QueueableTable as aF, RECOVERY_METHODS as aG, RECOVERY_REMINDER_DAYS as aH, RECOVERY_REMINDER_TYPES as aI, RECOVERY_SETUP_STEPS as aJ, RECOVERY_VERIFICATION_ATTEMPT_LIMIT as aK, RECOVERY_VERIFICATION_WORD_COUNT as aL, RECOVERY_WORD_COUNT as aM, REENCRYPTION_PRIORITY_ORDER as aN, REFRESH_TOKEN_EXPIRY_DAYS as aO, ROTATION_BATCH_SIZE as aP, ROTATION_EVENT_TYPES as aQ, ROTATION_MAX_BATCHES_PER_MINUTE as aR, ROTATION_MIN_BATTERY_LEVEL as aS, ROTATION_PAUSE_BETWEEN_BATCHES_MS as aT, ROTATION_PHASES as aU, ROTATION_TIMING_ESTIMATES as aV, ROTATION_VERIFICATION_SAMPLE_PERCENT as aW, type RecoveryMethod as aX, RecoveryMethodSchema as aY, type RecoveryReminderType as aZ, RecoveryReminderTypeSchema as a_, LLM_PROVIDERS as aa, MASTER_KEY_LENGTH_BITS as ab, MFA_OPTIONS as ac, MIGRATION_RATE_MS_PER_1K_NODES as ad, type MfaOption as ae, MfaOptionSchema as af, NONCE_LENGTH_BYTES as ag, OFFLINE_FUNCTIONALITY_LEVELS as ah, OFFLINE_STATES as ai, OFFLINE_SYNC_BEHAVIORS as aj, OFFLINE_THRESHOLDS as ak, type OfflineFunctionality as al, OfflineFunctionalitySchema as am, type OfflineState as an, OfflineStateSchema as ao, type OfflineSyncBehavior as ap, OfflineSyncBehaviorSchema as aq, PASSKEY_PLATFORMS as ar, PASSKEY_SYNC_MECHANISMS as as, PLATFORMS as at, PRIVACY_TIERS as au, PRIVATE_TIER_NODE_LIMITS as av, type PasskeyPlatform as aw, PasskeyPlatformSchema as ax, type Platform as ay, PlatformSchema as az, API_KEY_TYPES as b, RecoverySetupStepSchema as b0, type ReencryptionPriority as b1, type RotationEventType as b2, RotationEventTypeSchema as b3, type RotationPhase as b4, RotationPhaseSchema as b5, SCHEDULED_ROTATION_MONTHS as b6, SIGN_IN_IMPLEMENTATIONS as b7, type SignInImplementation as b8, SignInImplementationSchema as b9, TIER_MIGRATION_STATUSES as ba, TOPIC_SIMILARITY_THRESHOLD as bb, type TierMigrationStatus as bc, TierMigrationStatusSchema as bd, isConsentScope as be, isKeyVersionStatus as bf, isOfflineState as bg, isPlatform as bh, isPrivacyTier as bi, AUTH_CALLBACK_PATH as c, AUTH_METHODS as d, AUTH_PROVIDERS as e, type ApiCallFlow as f, ApiCallFlowSchema as g, type ApiKeyType as h, ApiKeyTypeSchema as i, type AuthMethod as j, AuthMethodSchema as k, type AuthProvider as l, AuthProviderSchema as m, BRUTE_FORCE_LOCKOUT_MINUTES as n, type BYOKEncryptionMethod as o, BYOKEncryptionMethodSchema as p, BYOK_ENCRYPTION_METHODS as q, BYOK_LOCKOUT_AFTER_FAILURES as r, BYOK_LOCKOUT_DURATION_MINUTES as s, BYOK_MAX_DECRYPTIONS_PER_MINUTE as t, CLIENT_SEARCH_PERFORMANCE as u, CONSENT_DURATIONS as v, CONSENT_EVENT_TYPES as w, CONSENT_REVOCATION_SCOPES as x, CONSENT_SCOPES as y, CONVERSATION_TIMEOUT_MINUTES as z };
