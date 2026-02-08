import { h as ApiKeyType, f as ApiCallFlow, ay as Platform, ae as MfaOption, an as OfflineState, aA as PrivacyTier, a8 as LLMProvider, o as BYOKEncryptionMethod, j as AuthMethod, F as ConsentEventType, J as ConsentScope, H as ConsentRevocationScope, D as ConsentDuration, aw as PasskeyPlatform, R as DeclineAction, S as DesktopAuthStep, X as ExportComplianceStatus, ab as MASTER_KEY_LENGTH_BITS, _ as KEY_DERIVATION_FUNCTION, a6 as KeyVersionStatus, al as OfflineFunctionality, ap as OfflineSyncBehavior, aE as QueueOperationType, aF as QueueableTable, b8 as SignInImplementation, aX as RecoveryMethod, aZ as RecoveryReminderType, a$ as RecoverySetupStep, b2 as RotationEventType, b4 as RotationPhase, ba as TIER_MIGRATION_STATUSES, a2 as KeyPurpose, a4 as KeyRotationTrigger } from '../constants-D51NP4v8.js';
export { A as ACCESS_TOKEN_EXPIRY_MINUTES, a as API_CALL_FLOWS, b as API_KEY_TYPES, c as AUTH_CALLBACK_PATH, d as AUTH_METHODS, e as AUTH_PROVIDERS, g as ApiCallFlowSchema, i as ApiKeyTypeSchema, k as AuthMethodSchema, l as AuthProvider, m as AuthProviderSchema, B as BRUTE_FORCE_LOCKOUT_ATTEMPTS, n as BRUTE_FORCE_LOCKOUT_MINUTES, p as BYOKEncryptionMethodSchema, q as BYOK_ENCRYPTION_METHODS, r as BYOK_LOCKOUT_AFTER_FAILURES, s as BYOK_LOCKOUT_DURATION_MINUTES, t as BYOK_MAX_DECRYPTIONS_PER_MINUTE, C as CAPTCHA_AFTER_FAILURES, u as CLIENT_SEARCH_PERFORMANCE, v as CONSENT_DURATIONS, w as CONSENT_EVENT_TYPES, x as CONSENT_REVOCATION_SCOPES, y as CONSENT_SCOPES, z as CONVERSATION_TIMEOUT_MINUTES, E as ConsentDurationSchema, G as ConsentEventTypeSchema, I as ConsentRevocationScopeSchema, K as ConsentScopeSchema, L as DECLINE_ACTIONS, M as DEEP_LINK_SCHEME, N as DEFAULT_CONSENT_SCOPE, O as DEPRECATED_KEY_RETENTION_DAYS, P as DERIVATION_INFO_STRINGS, Q as DESKTOP_AUTH_STEPS, T as DesktopAuthStepSchema, U as ECCN_CLASSIFICATION, V as ENCRYPTION_ALGORITHM, W as EXPORT_COMPLIANCE_STATUSES, Y as ExportComplianceStatusSchema, Z as GRACE_PERIOD_DAYS, $ as KEY_PURPOSES, a0 as KEY_ROTATION_TRIGGERS, a1 as KEY_VERSION_STATUSES, a3 as KeyPurposeSchema, a5 as KeyRotationTriggerSchema, a7 as KeyVersionStatusSchema, a9 as LLMProviderSchema, aa as LLM_PROVIDERS, ac as MFA_OPTIONS, ad as MIGRATION_RATE_MS_PER_1K_NODES, af as MfaOptionSchema, ag as NONCE_LENGTH_BYTES, ah as OFFLINE_FUNCTIONALITY_LEVELS, ai as OFFLINE_STATES, aj as OFFLINE_SYNC_BEHAVIORS, ak as OFFLINE_THRESHOLDS, am as OfflineFunctionalitySchema, ao as OfflineStateSchema, aq as OfflineSyncBehaviorSchema, ar as PASSKEY_PLATFORMS, as as PASSKEY_SYNC_MECHANISMS, at as PLATFORMS, au as PRIVACY_TIERS, av as PRIVATE_TIER_NODE_LIMITS, ax as PasskeyPlatformSchema, az as PlatformSchema, aB as PrivacyTierSchema, aC as QUEUEABLE_TABLES, aD as QUEUE_OPERATION_TYPES, aG as RECOVERY_METHODS, aH as RECOVERY_REMINDER_DAYS, aI as RECOVERY_REMINDER_TYPES, aJ as RECOVERY_SETUP_STEPS, aK as RECOVERY_VERIFICATION_ATTEMPT_LIMIT, aL as RECOVERY_VERIFICATION_WORD_COUNT, aM as RECOVERY_WORD_COUNT, aN as REENCRYPTION_PRIORITY_ORDER, aO as REFRESH_TOKEN_EXPIRY_DAYS, aP as ROTATION_BATCH_SIZE, aQ as ROTATION_EVENT_TYPES, aR as ROTATION_MAX_BATCHES_PER_MINUTE, aS as ROTATION_MIN_BATTERY_LEVEL, aT as ROTATION_PAUSE_BETWEEN_BATCHES_MS, aU as ROTATION_PHASES, aV as ROTATION_TIMING_ESTIMATES, aW as ROTATION_VERIFICATION_SAMPLE_PERCENT, aY as RecoveryMethodSchema, a_ as RecoveryReminderTypeSchema, b0 as RecoverySetupStepSchema, b1 as ReencryptionPriority, b3 as RotationEventTypeSchema, b5 as RotationPhaseSchema, b6 as SCHEDULED_ROTATION_MONTHS, b7 as SIGN_IN_IMPLEMENTATIONS, b9 as SignInImplementationSchema, bb as TOPIC_SIMILARITY_THRESHOLD, bc as TierMigrationStatus, bd as TierMigrationStatusSchema, be as isConsentScope, bf as isKeyVersionStatus, bg as isOfflineState, bh as isPlatform, bi as isPrivacyTier } from '../constants-D51NP4v8.js';
import { z } from 'zod';

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

/**
 * Clerk authentication provider configuration.
 *
 * @see storm-022 v1 revision Section 1 - Provider Recommendation: Clerk
 */
interface ClerkConfig {
    publishable_key: string;
    secret_key: string;
    sign_in_methods: AuthMethod[];
    mfa_enabled: boolean;
    session_lifetime_minutes: number;
    ios: {
        native_sdk: boolean;
    };
    android: {
        native_sdk: boolean;
    };
    desktop: {
        oauth_redirect_uri: string;
        deep_link_scheme: string;
    };
}
declare const ClerkConfigSchema: z.ZodObject<{
    publishable_key: z.ZodString;
    secret_key: z.ZodString;
    sign_in_methods: z.ZodArray<z.ZodEnum<["apple", "google", "email_password"]>, "many">;
    mfa_enabled: z.ZodBoolean;
    session_lifetime_minutes: z.ZodNumber;
    ios: z.ZodObject<{
        native_sdk: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        native_sdk: boolean;
    }, {
        native_sdk: boolean;
    }>;
    android: z.ZodObject<{
        native_sdk: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        native_sdk: boolean;
    }, {
        native_sdk: boolean;
    }>;
    desktop: z.ZodObject<{
        oauth_redirect_uri: z.ZodString;
        deep_link_scheme: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        oauth_redirect_uri: string;
        deep_link_scheme: string;
    }, {
        oauth_redirect_uri: string;
        deep_link_scheme: string;
    }>;
}, "strip", z.ZodTypeAny, {
    ios: {
        native_sdk: boolean;
    };
    android: {
        native_sdk: boolean;
    };
    publishable_key: string;
    secret_key: string;
    sign_in_methods: ("apple" | "google" | "email_password")[];
    mfa_enabled: boolean;
    session_lifetime_minutes: number;
    desktop: {
        oauth_redirect_uri: string;
        deep_link_scheme: string;
    };
}, {
    ios: {
        native_sdk: boolean;
    };
    android: {
        native_sdk: boolean;
    };
    publishable_key: string;
    secret_key: string;
    sign_in_methods: ("apple" | "google" | "email_password")[];
    mfa_enabled: boolean;
    session_lifetime_minutes: number;
    desktop: {
        oauth_redirect_uri: string;
        deep_link_scheme: string;
    };
}>;
/**
 * Per-platform authentication method implementation.
 *
 * @see storm-022 v1 revision Section 1 - Platform-Specific Implementation table
 */
interface PlatformAuthConfig {
    platform: Platform;
    apple_sign_in: SignInImplementation;
    google_sign_in: SignInImplementation;
    email_password: SignInImplementation;
}
declare const PlatformAuthConfigSchema: z.ZodObject<{
    platform: z.ZodEnum<["ios", "android", "macos", "windows"]>;
    apple_sign_in: z.ZodEnum<["native", "rest_api", "oauth", "clerk_ui", "clerk_web"]>;
    google_sign_in: z.ZodEnum<["native", "rest_api", "oauth", "clerk_ui", "clerk_web"]>;
    email_password: z.ZodEnum<["native", "rest_api", "oauth", "clerk_ui", "clerk_web"]>;
}, "strip", z.ZodTypeAny, {
    email_password: "native" | "rest_api" | "oauth" | "clerk_ui" | "clerk_web";
    platform: "ios" | "android" | "macos" | "windows";
    apple_sign_in: "native" | "rest_api" | "oauth" | "clerk_ui" | "clerk_web";
    google_sign_in: "native" | "rest_api" | "oauth" | "clerk_ui" | "clerk_web";
}, {
    email_password: "native" | "rest_api" | "oauth" | "clerk_ui" | "clerk_web";
    platform: "ios" | "android" | "macos" | "windows";
    apple_sign_in: "native" | "rest_api" | "oauth" | "clerk_ui" | "clerk_web";
    google_sign_in: "native" | "rest_api" | "oauth" | "clerk_ui" | "clerk_web";
}>;
/**
 * JWT token pair for authentication state.
 *
 * @see storm-022 v1 revision Section 1 - Offline Token Handling
 */
interface AuthTokens {
    access_token: string;
    refresh_token: string;
    issued_at: string;
    expires_at: string;
}
declare const AuthTokensSchema: z.ZodObject<{
    access_token: z.ZodString;
    refresh_token: z.ZodString;
    issued_at: z.ZodString;
    expires_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    expires_at: string;
    access_token: string;
    refresh_token: string;
    issued_at: string;
}, {
    expires_at: string;
    access_token: string;
    refresh_token: string;
    issued_at: string;
}>;
/**
 * Full authentication state stored on device.
 *
 * @see storm-022 v1 revision Section 1 - AuthState interface
 */
interface AuthState {
    user_id: string;
    tokens: AuthTokens;
    last_online: string;
    offline_state: OfflineState;
    privacy_tier: PrivacyTier;
    device_id: string;
}
declare const AuthStateSchema: z.ZodObject<{
    user_id: z.ZodString;
    tokens: z.ZodObject<{
        access_token: z.ZodString;
        refresh_token: z.ZodString;
        issued_at: z.ZodString;
        expires_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        expires_at: string;
        access_token: string;
        refresh_token: string;
        issued_at: string;
    }, {
        expires_at: string;
        access_token: string;
        refresh_token: string;
        issued_at: string;
    }>;
    last_online: z.ZodString;
    offline_state: z.ZodEnum<["online", "short_offline", "medium_offline", "long_offline", "reauth_required"]>;
    privacy_tier: z.ZodEnum<["standard", "private"]>;
    device_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    device_id: string;
    user_id: string;
    tokens: {
        expires_at: string;
        access_token: string;
        refresh_token: string;
        issued_at: string;
    };
    last_online: string;
    offline_state: "online" | "short_offline" | "medium_offline" | "long_offline" | "reauth_required";
    privacy_tier: "standard" | "private";
}, {
    device_id: string;
    user_id: string;
    tokens: {
        expires_at: string;
        access_token: string;
        refresh_token: string;
        issued_at: string;
    };
    last_online: string;
    offline_state: "online" | "short_offline" | "medium_offline" | "long_offline" | "reauth_required";
    privacy_tier: "standard" | "private";
}>;
/**
 * Desktop authentication flow state for Tauri apps.
 *
 * @see storm-022 v1 revision Section 1 - Desktop Auth Flow
 */
interface DesktopAuthFlow {
    step: DesktopAuthStep;
    redirect_uri: string;
    state_param: string;
    code_verifier?: string;
    error?: string;
}
declare const DesktopAuthFlowSchema: z.ZodObject<{
    step: z.ZodEnum<["idle", "browser_opened", "waiting_callback", "processing_token", "complete", "error"]>;
    redirect_uri: z.ZodString;
    state_param: z.ZodString;
    code_verifier: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    step: "complete" | "error" | "idle" | "browser_opened" | "waiting_callback" | "processing_token";
    redirect_uri: string;
    state_param: string;
    error?: string | undefined;
    code_verifier?: string | undefined;
}, {
    step: "complete" | "error" | "idle" | "browser_opened" | "waiting_callback" | "processing_token";
    redirect_uri: string;
    state_param: string;
    error?: string | undefined;
    code_verifier?: string | undefined;
}>;
/**
 * Security measures configuration (managed by Clerk).
 *
 * @see storm-022 v1 revision Section 1 - Security Measures table
 */
interface AuthSecurityConfig {
    brute_force_lockout_attempts: number;
    brute_force_lockout_minutes: number;
    captcha_after_failures: number;
    new_device_email_alert: boolean;
    invalidate_sessions_on_password_change: boolean;
    mfa_options: MfaOption[];
}
declare const AuthSecurityConfigSchema: z.ZodObject<{
    brute_force_lockout_attempts: z.ZodNumber;
    brute_force_lockout_minutes: z.ZodNumber;
    captcha_after_failures: z.ZodNumber;
    new_device_email_alert: z.ZodBoolean;
    invalidate_sessions_on_password_change: z.ZodBoolean;
    mfa_options: z.ZodArray<z.ZodEnum<["totp", "sms", "passkey"]>, "many">;
}, "strip", z.ZodTypeAny, {
    brute_force_lockout_attempts: number;
    brute_force_lockout_minutes: number;
    captcha_after_failures: number;
    new_device_email_alert: boolean;
    invalidate_sessions_on_password_change: boolean;
    mfa_options: ("totp" | "sms" | "passkey")[];
}, {
    brute_force_lockout_attempts: number;
    brute_force_lockout_minutes: number;
    captcha_after_failures: number;
    new_device_email_alert: boolean;
    invalidate_sessions_on_password_change: boolean;
    mfa_options: ("totp" | "sms" | "passkey")[];
}>;
/**
 * Result of JWT token validation.
 */
interface JWTValidationResult {
    valid: boolean;
    user_id?: string;
    error?: 'expired' | 'invalid_signature' | 'malformed' | 'revoked';
}
declare const JWTValidationResultSchema: z.ZodObject<{
    valid: z.ZodBoolean;
    user_id: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodEnum<["expired", "invalid_signature", "malformed", "revoked"]>>;
}, "strip", z.ZodTypeAny, {
    valid: boolean;
    error?: "expired" | "invalid_signature" | "malformed" | "revoked" | undefined;
    user_id?: string | undefined;
}, {
    valid: boolean;
    error?: "expired" | "invalid_signature" | "malformed" | "revoked" | undefined;
    user_id?: string | undefined;
}>;
/**
 * Complete definition of a privacy tier.
 *
 * @see storm-022 v1 revision Section 2 - Simplified Two-Tier Privacy Model
 */
interface TierDefinition {
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
declare const TierDefinitionSchema: z.ZodObject<{
    tier: z.ZodEnum<["standard", "private"]>;
    name: z.ZodString;
    description: z.ZodString;
    target_user: z.ZodString;
    search: z.ZodEnum<["cloud", "client_only"]>;
    llm_access: z.ZodEnum<["direct", "explicit_consent"]>;
    key_management: z.ZodEnum<["none", "passkey_derived"]>;
    data_protection: z.ZodArray<z.ZodString, "many">;
    data_exposure: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    search: "cloud" | "client_only";
    name: string;
    description: string;
    tier: "standard" | "private";
    target_user: string;
    llm_access: "direct" | "explicit_consent";
    key_management: "none" | "passkey_derived";
    data_protection: string[];
    data_exposure: string[];
}, {
    search: "cloud" | "client_only";
    name: string;
    description: string;
    tier: "standard" | "private";
    target_user: string;
    llm_access: "direct" | "explicit_consent";
    key_management: "none" | "passkey_derived";
    data_protection: string[];
    data_exposure: string[];
}>;
/**
 * Feature comparison between tiers (for UI display).
 *
 * @see storm-022 v1 revision Section 2 - Updated Architecture Overview table
 */
interface TierComparison {
    feature: string;
    standard: string;
    private_tier: string;
}
declare const TierComparisonSchema: z.ZodObject<{
    feature: z.ZodString;
    standard: z.ZodString;
    private_tier: z.ZodString;
}, "strip", z.ZodTypeAny, {
    standard: string;
    feature: string;
    private_tier: string;
}, {
    standard: string;
    feature: string;
    private_tier: string;
}>;
/**
 * Request to migrate between privacy tiers.
 *
 * @see storm-022 v1 revision Section 4 - Tier Migration flows
 */
interface TierMigrationRequest {
    user_id: string;
    from_tier: PrivacyTier;
    to_tier: PrivacyTier;
    initiated_at: string;
}
declare const TierMigrationRequestSchema: z.ZodObject<{
    user_id: z.ZodString;
    from_tier: z.ZodEnum<["standard", "private"]>;
    to_tier: z.ZodEnum<["standard", "private"]>;
    initiated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    user_id: string;
    from_tier: "standard" | "private";
    to_tier: "standard" | "private";
    initiated_at: string;
}, {
    user_id: string;
    from_tier: "standard" | "private";
    to_tier: "standard" | "private";
    initiated_at: string;
}>;
/**
 * Tier migration state tracking.
 *
 * @see storm-022 v1 revision Section 4 - Standard -> Private, Private -> Standard
 */
interface TierMigrationState {
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
declare const TierMigrationStateSchema: z.ZodObject<{
    request: z.ZodObject<{
        user_id: z.ZodString;
        from_tier: z.ZodEnum<["standard", "private"]>;
        to_tier: z.ZodEnum<["standard", "private"]>;
        initiated_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        user_id: string;
        from_tier: "standard" | "private";
        to_tier: "standard" | "private";
        initiated_at: string;
    }, {
        user_id: string;
        from_tier: "standard" | "private";
        to_tier: "standard" | "private";
        initiated_at: string;
    }>;
    status: z.ZodEnum<["pending", "key_setup", "migrating", "verifying", "complete", "failed"]>;
    progress: z.ZodNumber;
    nodes_processed: z.ZodNumber;
    nodes_total: z.ZodNumber;
    estimated_time_remaining_ms: z.ZodNumber;
    started_at: z.ZodOptional<z.ZodString>;
    completed_at: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "complete" | "pending" | "failed" | "verifying" | "key_setup" | "migrating";
    progress: number;
    request: {
        user_id: string;
        from_tier: "standard" | "private";
        to_tier: "standard" | "private";
        initiated_at: string;
    };
    nodes_processed: number;
    nodes_total: number;
    estimated_time_remaining_ms: number;
    error?: string | undefined;
    started_at?: string | undefined;
    completed_at?: string | undefined;
}, {
    status: "complete" | "pending" | "failed" | "verifying" | "key_setup" | "migrating";
    progress: number;
    request: {
        user_id: string;
        from_tier: "standard" | "private";
        to_tier: "standard" | "private";
        initiated_at: string;
    };
    nodes_processed: number;
    nodes_total: number;
    estimated_time_remaining_ms: number;
    error?: string | undefined;
    started_at?: string | undefined;
    completed_at?: string | undefined;
}>;
/**
 * Encrypted node structure for Private tier storage.
 *
 * @see storm-022 v1 revision Section 2 - Encryption Schema (Private Tier)
 */
interface EncryptedNodeSchema {
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
declare const EncryptedNodeSchemaZ: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    encrypted_payload: z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>;
    encrypted_embedding: z.ZodOptional<z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>>;
    encryption_version: z.ZodNumber;
    nonce: z.ZodEffects<z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>, Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>;
    encryption_tier: z.ZodEnum<["standard", "private"]>;
    version: z.ZodNumber;
    updated_at: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: string;
    id: string;
    version: number;
    encrypted_payload: Uint8Array<ArrayBuffer>;
    nonce: Uint8Array<ArrayBuffer>;
    updated_at: number;
    encryption_version: number;
    encryption_tier: "standard" | "private";
    encrypted_embedding?: Uint8Array<ArrayBuffer> | undefined;
}, {
    type: string;
    id: string;
    version: number;
    encrypted_payload: Uint8Array<ArrayBuffer>;
    nonce: Uint8Array<ArrayBuffer>;
    updated_at: number;
    encryption_version: number;
    encryption_tier: "standard" | "private";
    encrypted_embedding?: Uint8Array<ArrayBuffer> | undefined;
}>;
/**
 * Mapping of which node fields are encrypted vs. stay plaintext.
 *
 * @see storm-022 v1 revision Section 2 - Encrypted node SQL schema
 */
interface EncryptionFieldMap {
    plaintext: string[];
    encrypted_content: string[];
    encrypted_embedding: string[];
    encrypted_metadata: string[];
}
declare const EncryptionFieldMapSchema: z.ZodObject<{
    plaintext: z.ZodArray<z.ZodString, "many">;
    encrypted_content: z.ZodArray<z.ZodString, "many">;
    encrypted_embedding: z.ZodArray<z.ZodString, "many">;
    encrypted_metadata: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    encrypted_embedding: string[];
    plaintext: string[];
    encrypted_content: string[];
    encrypted_metadata: string[];
}, {
    encrypted_embedding: string[];
    plaintext: string[];
    encrypted_content: string[];
    encrypted_metadata: string[];
}>;
/**
 * Result of encrypting a node.
 */
interface EncryptionResult {
    encrypted_payload: Uint8Array;
    encrypted_embedding?: Uint8Array;
    nonce: Uint8Array;
    encryption_version: number;
}
declare const EncryptionResultSchema: z.ZodObject<{
    encrypted_payload: z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>;
    encrypted_embedding: z.ZodOptional<z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>>;
    nonce: z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>;
    encryption_version: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    encrypted_payload: Uint8Array<ArrayBuffer>;
    nonce: Uint8Array<ArrayBuffer>;
    encryption_version: number;
    encrypted_embedding?: Uint8Array<ArrayBuffer> | undefined;
}, {
    encrypted_payload: Uint8Array<ArrayBuffer>;
    nonce: Uint8Array<ArrayBuffer>;
    encryption_version: number;
    encrypted_embedding?: Uint8Array<ArrayBuffer> | undefined;
}>;
/**
 * Result of decrypting a node.
 *
 * @see storm-011 spec/node-schema.ts - NousNode interface
 */
interface DecryptionResult {
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
        ingestion: {
            timestamp: string;
            timezone: string;
        };
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
declare const DecryptionResultSchema: z.ZodObject<{
    content: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        blocks: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: unknown[] | undefined;
    }, {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: unknown[] | undefined;
    }>;
    embedding: z.ZodOptional<z.ZodObject<{
        vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
        model: z.ZodString;
        created_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }, {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    }>>;
    temporal: z.ZodObject<{
        ingestion: z.ZodObject<{
            timestamp: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            timestamp: string;
            timezone: string;
        }, {
            timestamp: string;
            timezone: string;
        }>;
        event: z.ZodOptional<z.ZodUnknown>;
        content_times: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
        reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: unknown;
        content_times?: unknown[] | undefined;
        reference_patterns?: string[] | undefined;
    }, {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: unknown;
        content_times?: unknown[] | undefined;
        reference_patterns?: string[] | undefined;
    }>;
    neural: z.ZodObject<{
        stability: z.ZodNumber;
        retrievability: z.ZodNumber;
        last_accessed: z.ZodString;
        access_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }, {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    }>;
    provenance: z.ZodObject<{
        source: z.ZodString;
        parent_id: z.ZodOptional<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        confidence: number;
        source: string;
        parent_id?: string | undefined;
    }, {
        confidence: number;
        source: string;
        parent_id?: string | undefined;
    }>;
    state: z.ZodObject<{
        extraction_depth: z.ZodString;
        lifecycle: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        extraction_depth: string;
        lifecycle: string;
    }, {
        extraction_depth: string;
        lifecycle: string;
    }>;
}, "strip", z.ZodTypeAny, {
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: unknown[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: unknown;
        content_times?: unknown[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: string;
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: string;
        lifecycle: string;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}, {
    content: {
        title: string;
        summary?: string | undefined;
        body?: string | undefined;
        blocks?: unknown[] | undefined;
    };
    temporal: {
        ingestion: {
            timestamp: string;
            timezone: string;
        };
        event?: unknown;
        content_times?: unknown[] | undefined;
        reference_patterns?: string[] | undefined;
    };
    neural: {
        stability: number;
        retrievability: number;
        last_accessed: string;
        access_count: number;
    };
    provenance: {
        confidence: number;
        source: string;
        parent_id?: string | undefined;
    };
    state: {
        extraction_depth: string;
        lifecycle: string;
    };
    embedding?: {
        vector: Float32Array<ArrayBuffer>;
        model: string;
        created_at: string;
    } | undefined;
}>;
/**
 * HNSW index configuration for client-side search in Private tier.
 *
 * @see storm-022 v1 revision Section 2 - Client-Side Search
 */
interface ClientSearchConfig {
    hnsw_ef_construction: number;
    hnsw_ef_search: number;
    hnsw_m: number;
    max_nodes: number;
    index_in_memory: boolean;
}
declare const ClientSearchConfigSchema: z.ZodObject<{
    hnsw_ef_construction: z.ZodNumber;
    hnsw_ef_search: z.ZodNumber;
    hnsw_m: z.ZodNumber;
    max_nodes: z.ZodNumber;
    index_in_memory: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    max_nodes: number;
    hnsw_ef_construction: number;
    hnsw_ef_search: number;
    hnsw_m: number;
    index_in_memory: boolean;
}, {
    max_nodes: number;
    hnsw_ef_construction: number;
    hnsw_ef_search: number;
    hnsw_m: number;
    index_in_memory: boolean;
}>;
/**
 * Result from local HNSW search.
 */
interface LocalSearchResult {
    node_id: string;
    distance: number;
    score: number;
}
declare const LocalSearchResultSchema: z.ZodObject<{
    node_id: z.ZodString;
    distance: z.ZodNumber;
    score: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    distance: number;
    node_id: string;
    score: number;
}, {
    distance: number;
    node_id: string;
    score: number;
}>;
/**
 * Opaque type representing an in-memory HNSW index.
 */
interface HNSWIndex {
    size: number;
    ready: boolean;
    memory_bytes: number;
}
declare const HNSWIndexSchema: z.ZodObject<{
    size: z.ZodNumber;
    ready: z.ZodBoolean;
    memory_bytes: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    size: number;
    ready: boolean;
    memory_bytes: number;
}, {
    size: number;
    ready: boolean;
    memory_bytes: number;
}>;
/**
 * Information about the user's passkey credential.
 *
 * @see storm-022 v1 revision Section 3 - Key Hierarchy
 */
interface PasskeyInfo {
    id: string;
    created_at: string;
    platform: PasskeyPlatform;
    synced_via: string;
    secure_enclave: boolean;
}
declare const PasskeyInfoSchema: z.ZodObject<{
    id: z.ZodString;
    created_at: z.ZodString;
    platform: z.ZodEnum<["apple", "google", "microsoft"]>;
    synced_via: z.ZodString;
    secure_enclave: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    id: string;
    created_at: string;
    platform: "apple" | "google" | "microsoft";
    synced_via: string;
    secure_enclave: boolean;
}, {
    id: string;
    created_at: string;
    platform: "apple" | "google" | "microsoft";
    synced_via: string;
    secure_enclave: boolean;
}>;
/**
 * Master key metadata. The actual CryptoKey is never serialized.
 *
 * CRITICAL: Master key is NEVER stored. Exists in memory only.
 *
 * @see storm-022 v1 revision Section 3
 */
interface MasterKeyInfo {
    algorithm: typeof KEY_DERIVATION_FUNCTION;
    length_bits: typeof MASTER_KEY_LENGTH_BITS;
    derivation_salt: Uint8Array;
    exists_in_memory_only: true;
}
declare const MasterKeyInfoSchema: z.ZodObject<{
    algorithm: z.ZodLiteral<"HKDF-SHA256">;
    length_bits: z.ZodLiteral<256>;
    derivation_salt: z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>;
    exists_in_memory_only: z.ZodLiteral<true>;
}, "strip", z.ZodTypeAny, {
    algorithm: "HKDF-SHA256";
    length_bits: 256;
    derivation_salt: Uint8Array<ArrayBuffer>;
    exists_in_memory_only: true;
}, {
    algorithm: "HKDF-SHA256";
    length_bits: 256;
    derivation_salt: Uint8Array<ArrayBuffer>;
    exists_in_memory_only: true;
}>;
/**
 * Set of derived encryption keys, each for a specific purpose.
 *
 * @see storm-022 v1 revision Section 3 - HKDF with purpose strings
 */
interface DerivedKeys {
    content_key: CryptoKey;
    embedding_key: CryptoKey;
    metadata_key: CryptoKey;
}
declare const DerivedKeysSchema: z.ZodObject<{
    content_key: z.ZodEffects<z.ZodAny, any, any>;
    embedding_key: z.ZodEffects<z.ZodAny, any, any>;
    metadata_key: z.ZodEffects<z.ZodAny, any, any>;
}, "strip", z.ZodTypeAny, {
    content_key?: any;
    embedding_key?: any;
    metadata_key?: any;
}, {
    content_key?: any;
    embedding_key?: any;
    metadata_key?: any;
}>;
/**
 * The complete key hierarchy for a Private tier user.
 *
 * @see storm-022 v1 revision Section 3
 */
interface KeyHierarchy {
    passkey: PasskeyInfo;
    master_key: MasterKeyInfo;
    derived_keys: DerivedKeys;
}
declare const KeyHierarchySchema: z.ZodObject<{
    passkey: z.ZodObject<{
        id: z.ZodString;
        created_at: z.ZodString;
        platform: z.ZodEnum<["apple", "google", "microsoft"]>;
        synced_via: z.ZodString;
        secure_enclave: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        id: string;
        created_at: string;
        platform: "apple" | "google" | "microsoft";
        synced_via: string;
        secure_enclave: boolean;
    }, {
        id: string;
        created_at: string;
        platform: "apple" | "google" | "microsoft";
        synced_via: string;
        secure_enclave: boolean;
    }>;
    master_key: z.ZodObject<{
        algorithm: z.ZodLiteral<"HKDF-SHA256">;
        length_bits: z.ZodLiteral<256>;
        derivation_salt: z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>;
        exists_in_memory_only: z.ZodLiteral<true>;
    }, "strip", z.ZodTypeAny, {
        algorithm: "HKDF-SHA256";
        length_bits: 256;
        derivation_salt: Uint8Array<ArrayBuffer>;
        exists_in_memory_only: true;
    }, {
        algorithm: "HKDF-SHA256";
        length_bits: 256;
        derivation_salt: Uint8Array<ArrayBuffer>;
        exists_in_memory_only: true;
    }>;
    derived_keys: z.ZodObject<{
        content_key: z.ZodEffects<z.ZodAny, any, any>;
        embedding_key: z.ZodEffects<z.ZodAny, any, any>;
        metadata_key: z.ZodEffects<z.ZodAny, any, any>;
    }, "strip", z.ZodTypeAny, {
        content_key?: any;
        embedding_key?: any;
        metadata_key?: any;
    }, {
        content_key?: any;
        embedding_key?: any;
        metadata_key?: any;
    }>;
}, "strip", z.ZodTypeAny, {
    passkey: {
        id: string;
        created_at: string;
        platform: "apple" | "google" | "microsoft";
        synced_via: string;
        secure_enclave: boolean;
    };
    master_key: {
        algorithm: "HKDF-SHA256";
        length_bits: 256;
        derivation_salt: Uint8Array<ArrayBuffer>;
        exists_in_memory_only: true;
    };
    derived_keys: {
        content_key?: any;
        embedding_key?: any;
        metadata_key?: any;
    };
}, {
    passkey: {
        id: string;
        created_at: string;
        platform: "apple" | "google" | "microsoft";
        synced_via: string;
        secure_enclave: boolean;
    };
    master_key: {
        algorithm: "HKDF-SHA256";
        length_bits: 256;
        derivation_salt: Uint8Array<ArrayBuffer>;
        exists_in_memory_only: true;
    };
    derived_keys: {
        content_key?: any;
        embedding_key?: any;
        metadata_key?: any;
    };
}>;
/**
 * Parameters for a single HKDF key derivation operation.
 *
 * @see storm-022 v1 revision Section 3
 */
interface KeyDerivationParams {
    algorithm: 'HKDF';
    hash: 'SHA-256';
    salt: Uint8Array;
    info: string;
    key_length: typeof MASTER_KEY_LENGTH_BITS;
}
declare const KeyDerivationParamsSchema: z.ZodObject<{
    algorithm: z.ZodLiteral<"HKDF">;
    hash: z.ZodLiteral<"SHA-256">;
    salt: z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>;
    info: z.ZodString;
    key_length: z.ZodLiteral<256>;
}, "strip", z.ZodTypeAny, {
    hash: "SHA-256";
    algorithm: "HKDF";
    salt: Uint8Array<ArrayBuffer>;
    info: string;
    key_length: 256;
}, {
    hash: "SHA-256";
    algorithm: "HKDF";
    salt: Uint8Array<ArrayBuffer>;
    info: string;
    key_length: 256;
}>;
/**
 * Multi-device key sync model.
 *
 * @see storm-022 v1 revision Section 3 - Multi-Device Sync
 */
interface MultiDeviceKeySync {
    method: 'passkey_platform_sync';
    description: string;
    sync_mechanisms: Record<PasskeyPlatform, string>;
}
declare const MultiDeviceKeySyncSchema: z.ZodObject<{
    method: z.ZodLiteral<"passkey_platform_sync">;
    description: z.ZodString;
    sync_mechanisms: z.ZodRecord<z.ZodEnum<["apple", "google", "microsoft"]>, z.ZodString>;
}, "strip", z.ZodTypeAny, {
    method: "passkey_platform_sync";
    description: string;
    sync_mechanisms: Partial<Record<"apple" | "google" | "microsoft", string>>;
}, {
    method: "passkey_platform_sync";
    description: string;
    sync_mechanisms: Partial<Record<"apple" | "google" | "microsoft", string>>;
}>;
/**
 * Tracks a single key version in the user's key history.
 *
 * @see storm-022 v2 Section 9.2 - Key Versioning Scheme
 */
interface KeyVersion {
    version: number;
    created_at: string;
    derivation_salt: Uint8Array;
    status: KeyVersionStatus;
}
declare const KeyVersionSchema: z.ZodObject<{
    version: z.ZodNumber;
    created_at: z.ZodString;
    derivation_salt: z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>;
    status: z.ZodEnum<["active", "rotating", "deprecated", "expired"]>;
}, "strip", z.ZodTypeAny, {
    status: "active" | "rotating" | "deprecated" | "expired";
    created_at: string;
    version: number;
    derivation_salt: Uint8Array<ArrayBuffer>;
}, {
    status: "active" | "rotating" | "deprecated" | "expired";
    created_at: string;
    version: number;
    derivation_salt: Uint8Array<ArrayBuffer>;
}>;
/**
 * Key metadata stored in user's encrypted profile.
 *
 * @see storm-022 v2 Section 9.2
 */
interface UserKeyMetadata {
    current_version: number;
    versions: KeyVersion[];
    rotation_in_progress: boolean;
    rotation_progress: number;
    rotation_started_at: string | null;
}
declare const UserKeyMetadataSchema: z.ZodObject<{
    current_version: z.ZodNumber;
    versions: z.ZodArray<z.ZodObject<{
        version: z.ZodNumber;
        created_at: z.ZodString;
        derivation_salt: z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>;
        status: z.ZodEnum<["active", "rotating", "deprecated", "expired"]>;
    }, "strip", z.ZodTypeAny, {
        status: "active" | "rotating" | "deprecated" | "expired";
        created_at: string;
        version: number;
        derivation_salt: Uint8Array<ArrayBuffer>;
    }, {
        status: "active" | "rotating" | "deprecated" | "expired";
        created_at: string;
        version: number;
        derivation_salt: Uint8Array<ArrayBuffer>;
    }>, "many">;
    rotation_in_progress: z.ZodBoolean;
    rotation_progress: z.ZodNumber;
    rotation_started_at: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    current_version: number;
    versions: {
        status: "active" | "rotating" | "deprecated" | "expired";
        created_at: string;
        version: number;
        derivation_salt: Uint8Array<ArrayBuffer>;
    }[];
    rotation_in_progress: boolean;
    rotation_progress: number;
    rotation_started_at: string | null;
}, {
    current_version: number;
    versions: {
        status: "active" | "rotating" | "deprecated" | "expired";
        created_at: string;
        version: number;
        derivation_salt: Uint8Array<ArrayBuffer>;
    }[];
    rotation_in_progress: boolean;
    rotation_progress: number;
    rotation_started_at: string | null;
}>;
/**
 * Progress tracking for an active key rotation.
 *
 * @see storm-022 v2 Section 9.6 - Interrupted Rotation
 */
interface RotationProgress {
    processed_count: number;
    total_count: number;
    last_processed_id: string | null;
    started_at: string;
    phase: RotationPhase;
}
declare const RotationProgressSchema: z.ZodObject<{
    processed_count: z.ZodNumber;
    total_count: z.ZodNumber;
    last_processed_id: z.ZodNullable<z.ZodString>;
    started_at: z.ZodString;
    phase: z.ZodEnum<["generating", "reencrypting", "verifying", "completing"]>;
}, "strip", z.ZodTypeAny, {
    started_at: string;
    processed_count: number;
    total_count: number;
    last_processed_id: string | null;
    phase: "generating" | "reencrypting" | "verifying" | "completing";
}, {
    started_at: string;
    processed_count: number;
    total_count: number;
    last_processed_id: string | null;
    phase: "generating" | "reencrypting" | "verifying" | "completing";
}>;
/**
 * Configuration for the background re-encryption job.
 *
 * @see storm-022 v2 Section 9.7 - Background Job Configuration
 */
interface RotationConfig {
    batch_size: number;
    pause_between_batches_ms: number;
    max_batches_per_minute: number;
    require_wifi: boolean;
    require_charging: boolean;
    min_battery_level: number;
    persist_progress: boolean;
    auto_resume_on_launch: boolean;
}
declare const RotationConfigSchema: z.ZodObject<{
    batch_size: z.ZodNumber;
    pause_between_batches_ms: z.ZodNumber;
    max_batches_per_minute: z.ZodNumber;
    require_wifi: z.ZodBoolean;
    require_charging: z.ZodBoolean;
    min_battery_level: z.ZodNumber;
    persist_progress: z.ZodBoolean;
    auto_resume_on_launch: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    batch_size: number;
    pause_between_batches_ms: number;
    max_batches_per_minute: number;
    require_wifi: boolean;
    require_charging: boolean;
    min_battery_level: number;
    persist_progress: boolean;
    auto_resume_on_launch: boolean;
}, {
    batch_size: number;
    pause_between_batches_ms: number;
    max_batches_per_minute: number;
    require_wifi: boolean;
    require_charging: boolean;
    min_battery_level: number;
    persist_progress: boolean;
    auto_resume_on_launch: boolean;
}>;
/**
 * Event emitted during rotation for UI updates.
 *
 * @see storm-022 v2 Section 9.4 - Migration UX Flow
 */
interface RotationEvent {
    type: RotationEventType;
    progress?: number;
    processed_count?: number;
    total_count?: number;
    estimated_remaining_ms?: number;
    error?: string;
}
declare const RotationEventSchema: z.ZodObject<{
    type: z.ZodEnum<["rotation:started", "rotation:progress", "rotation:paused", "rotation:resumed", "rotation:completed", "rotation:failed"]>;
    progress: z.ZodOptional<z.ZodNumber>;
    processed_count: z.ZodOptional<z.ZodNumber>;
    total_count: z.ZodOptional<z.ZodNumber>;
    estimated_remaining_ms: z.ZodOptional<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "rotation:started" | "rotation:progress" | "rotation:paused" | "rotation:resumed" | "rotation:completed" | "rotation:failed";
    error?: string | undefined;
    progress?: number | undefined;
    processed_count?: number | undefined;
    total_count?: number | undefined;
    estimated_remaining_ms?: number | undefined;
}, {
    type: "rotation:started" | "rotation:progress" | "rotation:paused" | "rotation:resumed" | "rotation:completed" | "rotation:failed";
    error?: string | undefined;
    progress?: number | undefined;
    processed_count?: number | undefined;
    total_count?: number | undefined;
    estimated_remaining_ms?: number | undefined;
}>;
/**
 * A generated BIP39 recovery code for key recovery.
 *
 * @see storm-022 v1 revision Section 3
 */
interface RecoveryCode {
    mnemonic: string[];
    version: number;
    created_at: string;
    verified: boolean;
}
declare const RecoveryCodeSchema: z.ZodObject<{
    mnemonic: z.ZodArray<z.ZodString, "many">;
    version: z.ZodNumber;
    created_at: z.ZodString;
    verified: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    version: number;
    mnemonic: string[];
    verified: boolean;
}, {
    created_at: string;
    version: number;
    mnemonic: string[];
    verified: boolean;
}>;
/**
 * Tracks the recovery code setup flow.
 *
 * @see storm-022 v1 revision Section 3 - FORCED VERIFICATION
 */
interface RecoverySetupState {
    step: RecoverySetupStep;
    mnemonic: string[];
    verification_indices: number[];
    attempts_remaining: number;
}
declare const RecoverySetupStateSchema: z.ZodObject<{
    step: z.ZodEnum<["generating", "displaying", "verifying", "complete"]>;
    mnemonic: z.ZodArray<z.ZodString, "many">;
    verification_indices: z.ZodArray<z.ZodNumber, "many">;
    attempts_remaining: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    step: "complete" | "generating" | "verifying" | "displaying";
    mnemonic: string[];
    verification_indices: number[];
    attempts_remaining: number;
}, {
    step: "complete" | "generating" | "verifying" | "displaying";
    mnemonic: string[];
    verification_indices: number[];
    attempts_remaining: number;
}>;
/**
 * Record of a recovery attempt for audit logging.
 *
 * @see storm-022 v2 Section 9.5
 */
interface RecoveryAttempt {
    user_id: string;
    method: RecoveryMethod;
    attempted_at: string;
    success: boolean;
    error?: string;
}
declare const RecoveryAttemptSchema: z.ZodObject<{
    user_id: z.ZodString;
    method: z.ZodEnum<["multi_device", "recovery_code", "grace_period"]>;
    attempted_at: z.ZodString;
    success: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    method: "multi_device" | "recovery_code" | "grace_period";
    success: boolean;
    user_id: string;
    attempted_at: string;
    error?: string | undefined;
}, {
    method: "multi_device" | "recovery_code" | "grace_period";
    success: boolean;
    user_id: string;
    attempted_at: string;
    error?: string | undefined;
}>;
/**
 * Grace period state for newly activated Private tier users.
 *
 * @see storm-022 v1 revision Section 3 - 7-DAY GRACE PERIOD
 */
interface GracePeriodState {
    enabled: boolean;
    expires_at: string;
    email_recovery_available: boolean;
}
declare const GracePeriodStateSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    expires_at: z.ZodString;
    email_recovery_available: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    expires_at: string;
    enabled: boolean;
    email_recovery_available: boolean;
}, {
    expires_at: string;
    enabled: boolean;
    email_recovery_available: boolean;
}>;
/**
 * Result of regenerating a recovery code.
 *
 * @see storm-022 v2 Section 9.5
 */
interface RecoveryRegenerationResult {
    new_mnemonic: string[];
    old_code_invalidated: boolean;
    new_encrypted_master: Uint8Array;
    verification_required: boolean;
}
declare const RecoveryRegenerationResultSchema: z.ZodObject<{
    new_mnemonic: z.ZodArray<z.ZodString, "many">;
    old_code_invalidated: z.ZodBoolean;
    new_encrypted_master: z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>;
    verification_required: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    new_mnemonic: string[];
    old_code_invalidated: boolean;
    new_encrypted_master: Uint8Array<ArrayBuffer>;
    verification_required: boolean;
}, {
    new_mnemonic: string[];
    old_code_invalidated: boolean;
    new_encrypted_master: Uint8Array<ArrayBuffer>;
    verification_required: boolean;
}>;
/**
 * Periodic reminder to verify recovery code is safely stored.
 *
 * @see storm-022 v1 revision Section 3 - Periodic Reminders
 */
interface RecoveryReminder {
    type: RecoveryReminderType;
    days_since_setup: number;
    last_dismissed: string | null;
    message: string;
}
declare const RecoveryReminderSchema: z.ZodObject<{
    type: z.ZodEnum<["initial", "periodic", "new_device"]>;
    days_since_setup: z.ZodNumber;
    last_dismissed: z.ZodNullable<z.ZodString>;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
    type: "initial" | "periodic" | "new_device";
    days_since_setup: number;
    last_dismissed: string | null;
}, {
    message: string;
    type: "initial" | "periodic" | "new_device";
    days_since_setup: number;
    last_dismissed: string | null;
}>;
/**
 * Current consent state for a user session.
 *
 * @see storm-022 v2 Section 10.3
 */
interface ConsentState {
    scope: ConsentScope;
    granted: boolean;
    granted_at?: string;
    expires_at?: string;
    provider?: string;
    memories_shared_count: number;
    memories_shared_ids: string[];
}
declare const ConsentStateSchema: z.ZodObject<{
    scope: z.ZodEnum<["per_message", "per_conversation", "time_based", "topic_based"]>;
    granted: z.ZodBoolean;
    granted_at: z.ZodOptional<z.ZodString>;
    expires_at: z.ZodOptional<z.ZodString>;
    provider: z.ZodOptional<z.ZodString>;
    memories_shared_count: z.ZodNumber;
    memories_shared_ids: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    scope: "per_message" | "per_conversation" | "time_based" | "topic_based";
    granted: boolean;
    memories_shared_count: number;
    memories_shared_ids: string[];
    expires_at?: string | undefined;
    provider?: string | undefined;
    granted_at?: string | undefined;
}, {
    scope: "per_message" | "per_conversation" | "time_based" | "topic_based";
    granted: boolean;
    memories_shared_count: number;
    memories_shared_ids: string[];
    expires_at?: string | undefined;
    provider?: string | undefined;
    granted_at?: string | undefined;
}>;
/**
 * A remembered topic-based consent record.
 *
 * @see storm-022 v2 Section 10.2
 */
interface TopicConsent {
    topic_embedding: number[];
    label: string;
    consented_at: string;
    query_count: number;
}
declare const TopicConsentSchema: z.ZodObject<{
    topic_embedding: z.ZodArray<z.ZodNumber, "many">;
    label: z.ZodString;
    consented_at: z.ZodString;
    query_count: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    label: string;
    topic_embedding: number[];
    consented_at: string;
    query_count: number;
}, {
    label: string;
    topic_embedding: number[];
    consented_at: string;
    query_count: number;
}>;
/**
 * User preferences for LLM consent behavior.
 *
 * @see storm-022 v2 Section 10.2
 */
interface ConsentSettings {
    default_scope: ConsentScope;
    time_based_duration: ConsentDuration;
    topic_similarity_threshold: number;
    remembered_topics: TopicConsent[];
    conversation_timeout_minutes: number;
    require_explicit_for_sensitive: boolean;
}
declare const ConsentSettingsSchema: z.ZodObject<{
    default_scope: z.ZodEnum<["per_message", "per_conversation", "time_based", "topic_based"]>;
    time_based_duration: z.ZodEnum<["1h", "24h", "7d"]>;
    topic_similarity_threshold: z.ZodNumber;
    remembered_topics: z.ZodArray<z.ZodObject<{
        topic_embedding: z.ZodArray<z.ZodNumber, "many">;
        label: z.ZodString;
        consented_at: z.ZodString;
        query_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        label: string;
        topic_embedding: number[];
        consented_at: string;
        query_count: number;
    }, {
        label: string;
        topic_embedding: number[];
        consented_at: string;
        query_count: number;
    }>, "many">;
    conversation_timeout_minutes: z.ZodNumber;
    require_explicit_for_sensitive: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    default_scope: "per_message" | "per_conversation" | "time_based" | "topic_based";
    time_based_duration: "1h" | "24h" | "7d";
    topic_similarity_threshold: number;
    remembered_topics: {
        label: string;
        topic_embedding: number[];
        consented_at: string;
        query_count: number;
    }[];
    conversation_timeout_minutes: number;
    require_explicit_for_sensitive: boolean;
}, {
    default_scope: "per_message" | "per_conversation" | "time_based" | "topic_based";
    time_based_duration: "1h" | "24h" | "7d";
    topic_similarity_threshold: number;
    remembered_topics: {
        label: string;
        topic_embedding: number[];
        consented_at: string;
        query_count: number;
    }[];
    conversation_timeout_minutes: number;
    require_explicit_for_sensitive: boolean;
}>;
/**
 * Data required to render the consent dialog.
 *
 * @see storm-022 v2 Section 10.1
 */
interface ConsentDialogData {
    memories: ConsentMemoryPreview[];
    total_count: number;
    provider_name: string;
    provider_privacy_note: string;
    provider_policy_url: string;
}
declare const ConsentDialogDataSchema: z.ZodObject<{
    memories: z.ZodArray<z.ZodLazy<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        created_at: z.ZodString;
        type: z.ZodString;
        preview: z.ZodString;
        selected: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        type: string;
        id: string;
        created_at: string;
        title: string;
        preview: string;
        selected: boolean;
    }, {
        type: string;
        id: string;
        created_at: string;
        title: string;
        preview: string;
        selected: boolean;
    }>>, "many">;
    total_count: z.ZodNumber;
    provider_name: z.ZodString;
    provider_privacy_note: z.ZodString;
    provider_policy_url: z.ZodString;
}, "strip", z.ZodTypeAny, {
    total_count: number;
    memories: {
        type: string;
        id: string;
        created_at: string;
        title: string;
        preview: string;
        selected: boolean;
    }[];
    provider_name: string;
    provider_privacy_note: string;
    provider_policy_url: string;
}, {
    total_count: number;
    memories: {
        type: string;
        id: string;
        created_at: string;
        title: string;
        preview: string;
        selected: boolean;
    }[];
    provider_name: string;
    provider_privacy_note: string;
    provider_policy_url: string;
}>;
/**
 * Memory preview shown in the consent dialog.
 *
 * @see storm-022 v2 Section 10.1
 */
interface ConsentMemoryPreview {
    id: string;
    title: string;
    created_at: string;
    type: string;
    preview: string;
    selected: boolean;
}
declare const ConsentMemoryPreviewSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    created_at: z.ZodString;
    type: z.ZodString;
    preview: z.ZodString;
    selected: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    type: string;
    id: string;
    created_at: string;
    title: string;
    preview: string;
    selected: boolean;
}, {
    type: string;
    id: string;
    created_at: string;
    title: string;
    preview: string;
    selected: boolean;
}>;
/**
 * Request to revoke LLM consent.
 *
 * @see storm-022 v2 Section 10.5
 */
interface ConsentRevocationRequest {
    scope: ConsentRevocationScope;
}
declare const ConsentRevocationRequestSchema: z.ZodObject<{
    scope: z.ZodEnum<["this_conversation", "all_active", "everything"]>;
}, "strip", z.ZodTypeAny, {
    scope: "this_conversation" | "all_active" | "everything";
}, {
    scope: "this_conversation" | "all_active" | "everything";
}>;
/**
 * Result when a user declines LLM access to their memories.
 *
 * @see storm-022 v2 Section 10.6
 */
interface DeclineResult {
    declined: true;
    available_actions: DeclineAction[];
    previous_context_available: boolean;
    message: string;
}
declare const DeclineResultSchema: z.ZodObject<{
    declined: z.ZodLiteral<true>;
    available_actions: z.ZodArray<z.ZodEnum<["general_questions", "writing_assistance", "brainstorming", "allow_this_question", "end_conversation"]>, "many">;
    previous_context_available: z.ZodBoolean;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
    declined: true;
    available_actions: ("general_questions" | "writing_assistance" | "brainstorming" | "allow_this_question" | "end_conversation")[];
    previous_context_available: boolean;
}, {
    message: string;
    declined: true;
    available_actions: ("general_questions" | "writing_assistance" | "brainstorming" | "allow_this_question" | "end_conversation")[];
    previous_context_available: boolean;
}>;
/**
 * Consent event for logging and analytics.
 *
 * @see storm-022 v2 Section 10
 */
interface ConsentEvent {
    type: ConsentEventType;
    user_id: string;
    scope: ConsentScope;
    memories_count: number;
    provider: string;
    timestamp: string;
}
declare const ConsentEventSchema: z.ZodObject<{
    type: z.ZodEnum<["consent:requested", "consent:granted", "consent:declined", "consent:revoked", "consent:expired"]>;
    user_id: z.ZodString;
    scope: z.ZodEnum<["per_message", "per_conversation", "time_based", "topic_based"]>;
    memories_count: z.ZodNumber;
    provider: z.ZodString;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "consent:requested" | "consent:granted" | "consent:declined" | "consent:revoked" | "consent:expired";
    timestamp: string;
    provider: string;
    user_id: string;
    scope: "per_message" | "per_conversation" | "time_based" | "topic_based";
    memories_count: number;
}, {
    type: "consent:requested" | "consent:granted" | "consent:declined" | "consent:revoked" | "consent:expired";
    timestamp: string;
    provider: string;
    user_id: string;
    scope: "per_message" | "per_conversation" | "time_based" | "topic_based";
    memories_count: number;
}>;
/**
 * Visual indicator data during LLM transmission.
 *
 * @see storm-022 v2 Section 10.4
 */
interface ConsentVisualIndicator {
    memories_shared_count: number;
    provider_name: string;
    consent_scope_label: string;
    time_remaining?: string;
    transmitting: boolean;
}
declare const ConsentVisualIndicatorSchema: z.ZodObject<{
    memories_shared_count: z.ZodNumber;
    provider_name: z.ZodString;
    consent_scope_label: z.ZodString;
    time_remaining: z.ZodOptional<z.ZodString>;
    transmitting: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    memories_shared_count: number;
    provider_name: string;
    consent_scope_label: string;
    transmitting: boolean;
    time_remaining?: string | undefined;
}, {
    memories_shared_count: number;
    provider_name: string;
    consent_scope_label: string;
    transmitting: boolean;
    time_remaining?: string | undefined;
}>;
/**
 * Detailed record of a memory shared with an LLM.
 *
 * @see storm-022 v2 Section 10.4
 */
interface SharedMemoryDetail {
    id: string;
    title: string;
    shared_at: string;
}
declare const SharedMemoryDetailSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    shared_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    title: string;
    shared_at: string;
}, {
    id: string;
    title: string;
    shared_at: string;
}>;
/**
 * Platform-managed API key (credit system).
 *
 * @see storm-022 v1 revision Section 6
 */
interface PlatformApiKey {
    provider: LLMProvider;
    encrypted_key: string;
    created_at: string;
    rotated_at: string;
    rate_limit: {
        rpm: number;
        tpm: number;
    };
}
declare const PlatformApiKeySchema: z.ZodObject<{
    provider: z.ZodEnum<["openai", "anthropic", "google"]>;
    encrypted_key: z.ZodString;
    created_at: z.ZodString;
    rotated_at: z.ZodString;
    rate_limit: z.ZodObject<{
        rpm: z.ZodNumber;
        tpm: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        rpm: number;
        tpm: number;
    }, {
        rpm: number;
        tpm: number;
    }>;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    provider: "google" | "openai" | "anthropic";
    encrypted_key: string;
    rotated_at: string;
    rate_limit: {
        rpm: number;
        tpm: number;
    };
}, {
    created_at: string;
    provider: "google" | "openai" | "anthropic";
    encrypted_key: string;
    rotated_at: string;
    rate_limit: {
        rpm: number;
        tpm: number;
    };
}>;
/**
 * BYOK (Bring Your Own Key) configuration per user.
 *
 * @see storm-022 v1 revision Section 6
 */
interface BYOKConfig {
    user_id: string;
    provider: LLMProvider;
    encrypted_key: Uint8Array;
    encryption_method: BYOKEncryptionMethod;
    created_at: string;
    last_used?: string;
}
declare const BYOKConfigSchema: z.ZodObject<{
    user_id: z.ZodString;
    provider: z.ZodEnum<["openai", "anthropic", "google"]>;
    encrypted_key: z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>;
    encryption_method: z.ZodEnum<["server_side", "user_key"]>;
    created_at: z.ZodString;
    last_used: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    provider: "google" | "openai" | "anthropic";
    user_id: string;
    encrypted_key: Uint8Array<ArrayBuffer>;
    encryption_method: "server_side" | "user_key";
    last_used?: string | undefined;
}, {
    created_at: string;
    provider: "google" | "openai" | "anthropic";
    user_id: string;
    encrypted_key: Uint8Array<ArrayBuffer>;
    encryption_method: "server_side" | "user_key";
    last_used?: string | undefined;
}>;
/**
 * Routing configuration for an API call.
 *
 * @see storm-022 v1 revision Section 6
 */
interface ApiCallRoute {
    key_type: ApiKeyType;
    flow: ApiCallFlow;
    rate_limited: boolean;
    usage_logged: boolean;
}
declare const ApiCallRouteSchema: z.ZodObject<{
    key_type: z.ZodEnum<["platform", "byok"]>;
    flow: z.ZodEnum<["proxied", "direct"]>;
    rate_limited: z.ZodBoolean;
    usage_logged: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    rate_limited: boolean;
    key_type: "platform" | "byok";
    flow: "proxied" | "direct";
    usage_logged: boolean;
}, {
    rate_limited: boolean;
    key_type: "platform" | "byok";
    flow: "proxied" | "direct";
    usage_logged: boolean;
}>;
/**
 * Rate limiting configuration for BYOK key decryption.
 *
 * @see storm-022 v1 revision Section 6
 */
interface BYOKRateLimitConfig {
    max_decryptions_per_minute: number;
    exponential_backoff: boolean;
    lockout_after_failures: number;
    lockout_duration_minutes: number;
}
declare const BYOKRateLimitConfigSchema: z.ZodObject<{
    max_decryptions_per_minute: z.ZodNumber;
    exponential_backoff: z.ZodBoolean;
    lockout_after_failures: z.ZodNumber;
    lockout_duration_minutes: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    max_decryptions_per_minute: number;
    exponential_backoff: boolean;
    lockout_after_failures: number;
    lockout_duration_minutes: number;
}, {
    max_decryptions_per_minute: number;
    exponential_backoff: boolean;
    lockout_after_failures: number;
    lockout_duration_minutes: number;
}>;
/**
 * Tracks BYOK decryption attempts for rate limiting.
 *
 * @see storm-022 v1 revision Section 6
 */
interface BYOKDecryptionAttempt {
    user_id: string;
    attempted_at: string;
    success: boolean;
    consecutive_failures: number;
    locked_out: boolean;
    lockout_expires_at: string | null;
}
declare const BYOKDecryptionAttemptSchema: z.ZodObject<{
    user_id: z.ZodString;
    attempted_at: z.ZodString;
    success: z.ZodBoolean;
    consecutive_failures: z.ZodNumber;
    locked_out: z.ZodBoolean;
    lockout_expires_at: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    success: boolean;
    user_id: string;
    consecutive_failures: number;
    attempted_at: string;
    locked_out: boolean;
    lockout_expires_at: string | null;
}, {
    success: boolean;
    user_id: string;
    consecutive_failures: number;
    attempted_at: string;
    locked_out: boolean;
    lockout_expires_at: string | null;
}>;
/**
 * Export compliance requirements per region and tier.
 *
 * @see storm-022 v1 revision Section 7
 */
interface ExportComplianceConfig {
    region: string;
    standard_tier: ExportComplianceStatus;
    private_tier: ExportComplianceStatus;
    documentation_required: string[];
    notes: string;
}
declare const ExportComplianceConfigSchema: z.ZodObject<{
    region: z.ZodString;
    standard_tier: z.ZodEnum<["exempt", "requires_documentation", "excluded"]>;
    private_tier: z.ZodEnum<["exempt", "requires_documentation", "excluded"]>;
    documentation_required: z.ZodArray<z.ZodString, "many">;
    notes: z.ZodString;
}, "strip", z.ZodTypeAny, {
    notes: string;
    private_tier: "exempt" | "requires_documentation" | "excluded";
    region: string;
    standard_tier: "exempt" | "requires_documentation" | "excluded";
    documentation_required: string[];
}, {
    notes: string;
    private_tier: "exempt" | "requires_documentation" | "excluded";
    region: string;
    standard_tier: "exempt" | "requires_documentation" | "excluded";
    documentation_required: string[];
}>;
/**
 * App store encryption declarations per platform.
 *
 * @see storm-022 v1 revision Section 7
 */
interface AppStoreDeclaration {
    platform: Platform;
    uses_non_exempt_encryption: boolean;
    eccn?: string;
    mass_market_exemption?: boolean;
    self_classification_filed: boolean;
    annual_report_due?: string;
}
declare const AppStoreDeclarationSchema: z.ZodObject<{
    platform: z.ZodEnum<["ios", "android", "macos", "windows"]>;
    uses_non_exempt_encryption: z.ZodBoolean;
    eccn: z.ZodOptional<z.ZodString>;
    mass_market_exemption: z.ZodOptional<z.ZodBoolean>;
    self_classification_filed: z.ZodBoolean;
    annual_report_due: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    platform: "ios" | "android" | "macos" | "windows";
    uses_non_exempt_encryption: boolean;
    self_classification_filed: boolean;
    eccn?: string | undefined;
    mass_market_exemption?: boolean | undefined;
    annual_report_due?: string | undefined;
}, {
    platform: "ios" | "android" | "macos" | "windows";
    uses_non_exempt_encryption: boolean;
    self_classification_filed: boolean;
    eccn?: string | undefined;
    mass_market_exemption?: boolean | undefined;
    annual_report_due?: string | undefined;
}>;
/**
 * A single entry in the threat model.
 *
 * @see storm-022 v1 revision Section 8
 */
interface ThreatModelEntry {
    threat: string;
    protected_by_standard: boolean;
    protected_by_private: boolean;
    description: string;
}
declare const ThreatModelEntrySchema: z.ZodObject<{
    threat: z.ZodString;
    protected_by_standard: z.ZodBoolean;
    protected_by_private: z.ZodBoolean;
    description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    description: string;
    threat: string;
    protected_by_standard: boolean;
    protected_by_private: boolean;
}, {
    description: string;
    threat: string;
    protected_by_standard: boolean;
    protected_by_private: boolean;
}>;
/**
 * A single phase in the staged launch strategy.
 *
 * @see storm-022 v1 revision Section 7
 */
interface LaunchPhase {
    version: string;
    features: string[];
    markets: string[];
    compliance_requirements: string[];
}
declare const LaunchPhaseSchema: z.ZodObject<{
    version: z.ZodString;
    features: z.ZodArray<z.ZodString, "many">;
    markets: z.ZodArray<z.ZodString, "many">;
    compliance_requirements: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    version: string;
    features: string[];
    markets: string[];
    compliance_requirements: string[];
}, {
    version: string;
    features: string[];
    markets: string[];
    compliance_requirements: string[];
}>;
/**
 * Configuration for a single offline state.
 *
 * @see storm-022 v1 revision Section 1
 */
interface OfflineStateConfig {
    state: OfflineState;
    max_hours: number;
    functionality: OfflineFunctionality;
    sync_behavior: OfflineSyncBehavior;
    auth_behavior: string;
    private_tier_key_access: boolean;
}
declare const OfflineStateConfigSchema: z.ZodObject<{
    state: z.ZodEnum<["online", "short_offline", "medium_offline", "long_offline", "reauth_required"]>;
    max_hours: z.ZodNumber;
    functionality: z.ZodEnum<["full", "read_write_queued", "read_only", "local_only"]>;
    sync_behavior: z.ZodEnum<["realtime", "queued", "paused", "none"]>;
    auth_behavior: z.ZodString;
    private_tier_key_access: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    state: "online" | "short_offline" | "medium_offline" | "long_offline" | "reauth_required";
    max_hours: number;
    functionality: "full" | "read_write_queued" | "read_only" | "local_only";
    sync_behavior: "none" | "realtime" | "queued" | "paused";
    auth_behavior: string;
    private_tier_key_access: boolean;
}, {
    state: "online" | "short_offline" | "medium_offline" | "long_offline" | "reauth_required";
    max_hours: number;
    functionality: "full" | "read_write_queued" | "read_only" | "local_only";
    sync_behavior: "none" | "realtime" | "queued" | "paused";
    auth_behavior: string;
    private_tier_key_access: boolean;
}>;
/**
 * Queue of operations pending sync when device comes back online.
 */
interface OfflineSyncQueue {
    operations: QueuedOperation[];
    created_at: string;
    last_attempted: string | null;
}
declare const OfflineSyncQueueSchema: z.ZodObject<{
    operations: z.ZodArray<z.ZodLazy<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<["create", "update", "delete"]>;
        table: z.ZodEnum<["nodes", "edges", "episodes"]>;
        data: z.ZodUnknown;
        queued_at: z.ZodString;
        priority: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        table: "nodes" | "edges" | "episodes";
        type: "delete" | "create" | "update";
        id: string;
        queued_at: string;
        priority: number;
        data?: unknown;
    }, {
        table: "nodes" | "edges" | "episodes";
        type: "delete" | "create" | "update";
        id: string;
        queued_at: string;
        priority: number;
        data?: unknown;
    }>>, "many">;
    created_at: z.ZodString;
    last_attempted: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    created_at: string;
    operations: {
        table: "nodes" | "edges" | "episodes";
        type: "delete" | "create" | "update";
        id: string;
        queued_at: string;
        priority: number;
        data?: unknown;
    }[];
    last_attempted: string | null;
}, {
    created_at: string;
    operations: {
        table: "nodes" | "edges" | "episodes";
        type: "delete" | "create" | "update";
        id: string;
        queued_at: string;
        priority: number;
        data?: unknown;
    }[];
    last_attempted: string | null;
}>;
/**
 * A single queued operation waiting to sync.
 */
interface QueuedOperation {
    id: string;
    type: QueueOperationType;
    table: QueueableTable;
    data: unknown;
    queued_at: string;
    priority: number;
}
declare const QueuedOperationSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["create", "update", "delete"]>;
    table: z.ZodEnum<["nodes", "edges", "episodes"]>;
    data: z.ZodUnknown;
    queued_at: z.ZodString;
    priority: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    table: "nodes" | "edges" | "episodes";
    type: "delete" | "create" | "update";
    id: string;
    queued_at: string;
    priority: number;
    data?: unknown;
}, {
    table: "nodes" | "edges" | "episodes";
    type: "delete" | "create" | "update";
    id: string;
    queued_at: string;
    priority: number;
    data?: unknown;
}>;
/**
 * Result of checking what's available in the current offline state.
 *
 * @see storm-022 v1 revision Section 1
 */
interface OfflineCapabilityCheck {
    can_read: boolean;
    can_write: boolean;
    can_search: boolean;
    can_sync: boolean;
    can_use_llm: boolean;
    reason: string;
}
declare const OfflineCapabilityCheckSchema: z.ZodObject<{
    can_read: z.ZodBoolean;
    can_write: z.ZodBoolean;
    can_search: z.ZodBoolean;
    can_sync: z.ZodBoolean;
    can_use_llm: z.ZodBoolean;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    reason: string;
    can_read: boolean;
    can_write: boolean;
    can_search: boolean;
    can_sync: boolean;
    can_use_llm: boolean;
}, {
    reason: string;
    can_read: boolean;
    can_write: boolean;
    can_search: boolean;
    can_sync: boolean;
    can_use_llm: boolean;
}>;
/**
 * Result of processing the offline sync queue.
 */
interface QueueSyncResult {
    synced: number;
    failed: number;
    errors?: Array<{
        operation_id: string;
        error: string;
    }>;
}
declare const QueueSyncResultSchema: z.ZodObject<{
    synced: z.ZodNumber;
    failed: z.ZodNumber;
    errors: z.ZodOptional<z.ZodArray<z.ZodObject<{
        operation_id: z.ZodString;
        error: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        error: string;
        operation_id: string;
    }, {
        error: string;
        operation_id: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    failed: number;
    synced: number;
    errors?: {
        error: string;
        operation_id: string;
    }[] | undefined;
}, {
    failed: number;
    synced: number;
    errors?: {
        error: string;
        operation_id: string;
    }[] | undefined;
}>;

/**
 * @module @nous/core/security
 * @description Authentication configuration, token validation, offline state transitions
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Clerk configuration, platform-specific auth, token management,
 * desktop OAuth flow (Tauri), and security measures.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/auth-config.ts} - Spec
 */

/**
 * Platform auth configurations from brainstorm.
 *
 * | Platform  | Sign in Apple | Google Sign-In | Email/Password |
 * |-----------|---------------|----------------|----------------|
 * | iOS       | native        | native         | clerk_ui       |
 * | Android   | rest_api      | native         | clerk_ui       |
 * | macOS     | native        | oauth          | clerk_web      |
 * | Windows   | oauth         | oauth          | clerk_web      |
 *
 * @see storm-022 v1 revision Section 1 - Platform-Specific Implementation table
 */
declare const PLATFORM_AUTH_CONFIGS: Record<Platform, PlatformAuthConfig>;
/**
 * Default security configuration from brainstorm.
 *
 * @see storm-022 v1 revision Section 1 - Security Measures table
 */
declare const DEFAULT_SECURITY_CONFIG: AuthSecurityConfig;
/**
 * Default desktop (Tauri) Clerk configuration.
 */
declare const DEFAULT_DESKTOP_CONFIG: {
    readonly oauth_redirect_uri: "nous:///auth/callback";
    readonly deep_link_scheme: "nous";
};
/**
 * Reference descriptions for offline state transitions.
 *
 * @see storm-022 v1 revision Section 1 - State transitions
 */
declare const OFFLINE_STATE_TRANSITION_REFERENCE: {
    readonly online: "Full functionality";
    readonly short_offline: "<24h, JWT valid, full functionality";
    readonly medium_offline: "<168h, JWT expired, read-only + queued writes";
    readonly long_offline: ">168h, refresh expired, local only";
    readonly reauth_required: "Must reconnect to continue";
};
/**
 * Checks if the access token is still valid (not expired).
 *
 * @param tokens - Current auth tokens
 * @returns True if access token has not expired
 */
declare function isTokenValid(tokens: AuthTokens): boolean;
/**
 * Determines if re-authentication is required.
 * True when refresh token has expired (>30 days).
 *
 * @param auth - Current auth state
 * @returns True if re-auth is needed
 */
declare function shouldReauthenticate(auth: AuthState): boolean;
/**
 * Calculates the current offline state based on time since last online
 * and token validity.
 *
 * @param auth - Current auth state
 * @returns Updated offline state
 *
 * @see storm-022 v1 revision Section 1 - updateOfflineState() implementation
 */
declare function updateOfflineState(auth: AuthState): OfflineState;
/**
 * Gets the platform auth configuration for a specific platform.
 *
 * @param platform - Target platform
 * @returns Platform auth config
 */
declare function getPlatformAuthConfig(platform: Platform): PlatformAuthConfig;
/**
 * Gets the Clerk configuration for a specific platform.
 * Requires Clerk SDK integration.
 *
 * @param _platform - Target platform
 * @returns Clerk config for that platform
 */
declare function getClerkConfig(_platform: Platform): ClerkConfig;
/**
 * Validates a JWT token against Clerk's public keys.
 * Requires Clerk SDK or JWKS endpoint.
 *
 * @param _token - JWT access token
 * @returns Validation result with user_id if valid
 */
declare function validateJWT(_token: string): Promise<JWTValidationResult>;

/**
 * @module @nous/core/security
 * @description Two-tier privacy model: definitions, comparison, tier migration
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Simplified two-tier privacy model (Standard vs Private).
 * Key insight: Don't offer "partial" encryption. Either data is
 * protected (Private) or it's convenient (Standard).
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/privacy-tiers.ts} - Spec
 */

/**
 * Complete tier definitions from brainstorm.
 *
 * @see storm-022 v1 revision Section 2 - Tier 1: Standard, Tier 2: Private
 */
declare const TIER_DEFINITIONS: Record<PrivacyTier, TierDefinition>;
/**
 * Feature comparison between tiers (for UI display).
 *
 * @see storm-022 v1 revision Section 2 - Updated Architecture Overview table
 */
declare const TIER_COMPARISON_TABLE: TierComparison[];
/**
 * Gets the complete tier definition.
 *
 * @param tier - Privacy tier
 * @returns Complete tier definition
 */
declare function getTierDefinition(tier: PrivacyTier): TierDefinition;
/**
 * Checks if migration between two tiers is possible.
 * Both directions are valid: standard -> private and private -> standard.
 * Migration from a tier to itself is not valid.
 *
 * @param from - Current tier
 * @param to - Target tier
 * @returns True if migration is possible
 */
declare function canMigrateTier(from: PrivacyTier, to: PrivacyTier): boolean;
/**
 * Estimates migration time in milliseconds based on node count.
 * Uses MIGRATION_RATE_MS_PER_1K_NODES (~60s per 1K nodes).
 *
 * @param node_count - Total number of nodes to migrate
 * @returns Estimated time in milliseconds
 *
 * @see storm-022 v1 revision Section 4 - "Duration: ~1 minute per 1K nodes"
 */
declare function estimateMigrationTime(node_count: number): number;
/**
 * Initiates a tier migration. Creates the migration state
 * and begins the background process.
 * Requires server-side migration state tracking and encryption services.
 *
 * @param _request - Migration request
 * @returns Initial migration state
 */
declare function startTierMigration(_request: TierMigrationRequest): Promise<TierMigrationState>;
/**
 * Gets current migration progress for a user.
 * Returns null if no migration is in progress.
 * Requires server-side migration state lookup.
 *
 * @param _user_id - User ID
 * @returns Current migration state or null
 */
declare function getTierMigrationProgress(_user_id: string): Promise<TierMigrationState | null>;

/**
 * @module @nous/core/security
 * @description E2E encryption schema, encrypted node structure, client-side search
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Encryption field mapping, client-side search configs, and encrypt/decrypt
 * operations for Private tier nodes.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/encryption.ts} - Spec
 */

/**
 * Concrete field mapping for Private tier encryption.
 * Defines which node fields are encrypted vs. stay plaintext.
 *
 * Design principle: Minimal plaintext. Only fields absolutely required
 * for sync and basic filtering remain unencrypted.
 *
 * @see storm-022 v1 revision Section 2 - SQL schema comments
 * @see storm-011 spec/node-schema.ts - NousNode interface fields
 */
declare const ENCRYPTION_FIELD_MAP: EncryptionFieldMap;
/**
 * Additional SQL columns for encrypted nodes.
 * These extend the storm-017 nodes table which already has
 * encrypted_payload and encryption_tier.
 *
 * @see storm-017 spec/schema.ts - Existing NODES_TABLE
 */
declare const ENCRYPTED_NODES_ADDITIONAL_SQL = "\n-- Additional columns for storm-022 Private tier encryption\n-- (encrypted_payload and encryption_tier already exist from storm-017)\n\nALTER TABLE nodes ADD COLUMN encrypted_embedding BLOB;\nALTER TABLE nodes ADD COLUMN encryption_version INTEGER DEFAULT 1;\nALTER TABLE nodes ADD COLUMN nonce BLOB;\n\n-- Index on encryption version for key rotation queries\nCREATE INDEX IF NOT EXISTS idx_nodes_encryption_version ON nodes(encryption_version)\n  WHERE encryption_tier = 'private';\n";
/**
 * Default client search configuration for mobile devices.
 */
declare const DEFAULT_CLIENT_SEARCH_CONFIG_MOBILE: ClientSearchConfig;
/**
 * Default client search configuration for desktop devices.
 */
declare const DEFAULT_CLIENT_SEARCH_CONFIG_DESKTOP: ClientSearchConfig;
/**
 * Client-side search performance reference table.
 *
 * | Node Count | Memory   | Index Build  | Search Latency |
 * |------------|----------|--------------|----------------|
 * | 10K        | ~130 MB  | ~2 seconds   | ~20ms          |
 * | 50K        | ~650 MB  | ~10 seconds  | ~40ms          |
 * | 100K       | ~1.3 GB  | ~20 seconds  | ~60ms          |
 *
 * @see storm-022 v1 revision Section 2 - Performance Limits table
 */
declare const PERFORMANCE_REFERENCE: {
    readonly '10k': {
        readonly memory_mb: 130;
        readonly index_build_seconds: 2;
        readonly search_latency_ms: 20;
    };
    readonly '50k': {
        readonly memory_mb: 650;
        readonly index_build_seconds: 10;
        readonly search_latency_ms: 40;
    };
    readonly '100k': {
        readonly memory_mb: 1300;
        readonly index_build_seconds: 20;
        readonly search_latency_ms: 60;
    };
};
/**
 * Encrypts a full node for Private tier storage.
 * Separates content into encrypted_payload and encrypted_embedding.
 * Requires Web Crypto API.
 *
 * @param _node - The plaintext NousNode to encrypt
 * @param _keys - Derived encryption keys (content, embedding, metadata)
 * @returns Encryption result with payload, embedding, nonce, and version
 */
declare function encryptNode(_node: unknown, _keys: DerivedKeys): Promise<EncryptionResult>;
/**
 * Decrypts an encrypted node back to its component fields.
 * Requires Web Crypto API.
 *
 * @param _encrypted - The encrypted node schema
 * @param _keys - Derived decryption keys
 * @returns Decrypted node fields
 */
declare function decryptNode(_encrypted: EncryptedNodeSchema, _keys: DerivedKeys): Promise<DecryptionResult>;
/**
 * Encrypts an embedding vector with the embedding key.
 * Requires Web Crypto API.
 *
 * @param _vector - Float32Array embedding
 * @param _key - Embedding encryption key
 * @returns Encrypted embedding bytes
 */
declare function encryptEmbedding(_vector: Float32Array, _key: CryptoKey): Promise<Uint8Array>;
/**
 * Decrypts an encrypted embedding back to Float32Array.
 * Requires Web Crypto API.
 *
 * @param _encrypted - Encrypted embedding bytes
 * @param _key - Embedding decryption key
 * @returns Decrypted Float32Array
 */
declare function decryptEmbedding(_encrypted: Uint8Array, _key: CryptoKey): Promise<Float32Array>;
/**
 * Builds an in-memory HNSW index from decrypted embeddings.
 * Requires HNSW library (e.g., hnswlib-node).
 *
 * @param _decryptedEmbeddings - Map of node_id to decrypted Float32Array
 * @param _config - HNSW configuration
 * @returns In-memory HNSW index
 */
declare function buildLocalSearchIndex(_decryptedEmbeddings: Map<string, Float32Array>, _config: ClientSearchConfig): Promise<HNSWIndex>;
/**
 * Searches the local HNSW index.
 * Requires HNSW library.
 *
 * @param _index - In-memory HNSW index
 * @param _query - Query embedding vector
 * @param _topK - Number of results to return
 * @returns Search results ordered by similarity
 */
declare function searchLocalIndex(_index: HNSWIndex, _query: Float32Array, _topK: number): Promise<LocalSearchResult[]>;

/**
 * @module @nous/core/security
 * @description Key hierarchy, derivation, master key, derived keys, multi-device sync, key rotation
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Key hierarchy for Private tier: Passkey -> HKDF-SHA256 -> Master Key -> Derived Keys
 * Key rotation: incremental background re-encryption (100 nodes/batch, throttled).
 *
 * CRITICAL: Master key is NEVER stored. It exists in memory only.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/key-hierarchy.ts} - Spec
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/key-rotation.ts} - Spec
 */

/**
 * Default multi-device sync configuration.
 * Passkey syncs via platform credential manager.
 * No key transmission needed — derivation is deterministic.
 *
 * @see storm-022 v1 revision Section 3 - Multi-Device Sync
 */
declare const DEFAULT_MULTI_DEVICE_SYNC: MultiDeviceKeySync;
/**
 * Creates KeyDerivationParams for a specific purpose.
 *
 * @param purpose - Key purpose ('content', 'embedding', 'metadata')
 * @param salt - Per-version unique salt
 * @returns Params for HKDF derivation
 */
declare function createDerivationParams(purpose: KeyPurpose, salt: Uint8Array): KeyDerivationParams;
/**
 * Derives a master key from a passkey secret and salt.
 * Uses HKDF-SHA256 to produce a 256-bit AES key.
 * Requires Web Crypto API.
 *
 * @param _passkeySecret - Raw secret from passkey authentication
 * @param _salt - Per-version derivation salt (stored server-side)
 * @returns Master CryptoKey (in-memory only, never persist)
 */
declare function deriveMasterKey(_passkeySecret: Uint8Array, _salt: Uint8Array): Promise<CryptoKey>;
/**
 * Derives the content encryption key from the master key.
 * Uses HKDF with info string 'nous-content'.
 * Requires Web Crypto API.
 *
 * @param _masterKey - Master CryptoKey
 * @returns Content encryption CryptoKey (AES-256-GCM)
 */
declare function deriveContentKey(_masterKey: CryptoKey): Promise<CryptoKey>;
/**
 * Derives the embedding encryption key from the master key.
 * Uses HKDF with info string 'nous-embedding'.
 * Requires Web Crypto API.
 *
 * @param _masterKey - Master CryptoKey
 * @returns Embedding encryption CryptoKey (AES-256-GCM)
 */
declare function deriveEmbeddingKey(_masterKey: CryptoKey): Promise<CryptoKey>;
/**
 * Derives the metadata encryption key from the master key.
 * Uses HKDF with info string 'nous-metadata'.
 * Requires Web Crypto API.
 *
 * @param _masterKey - Master CryptoKey
 * @returns Metadata encryption CryptoKey (AES-256-GCM)
 */
declare function deriveMetadataKey(_masterKey: CryptoKey): Promise<CryptoKey>;
/**
 * Derives all three sub-keys from the master key in one operation.
 * Requires Web Crypto API.
 *
 * @param _masterKey - Master CryptoKey
 * @returns All derived keys (content, embedding, metadata)
 */
declare function deriveAllKeys(_masterKey: CryptoKey): Promise<DerivedKeys>;
/**
 * Generates a cryptographically random salt for key derivation.
 * Requires Web Crypto API (crypto.getRandomValues).
 *
 * @returns Random salt bytes (32 bytes)
 */
declare function generateSalt(): Uint8Array;
/**
 * Default rotation configuration from brainstorm.
 *
 * Design principles:
 * - Battery-aware: Only runs on Wi-Fi + charging (mobile)
 * - Resumable: Progress persisted after each batch
 * - Throttled: 500ms pause between batches prevents UI jank
 * - Non-blocking: User can continue using app during rotation
 *
 * @see storm-022 v2 Section 9.7 - RotationConfig
 */
declare const DEFAULT_ROTATION_CONFIG: RotationConfig;
/**
 * Re-encryption timing estimates (throttled, Wi-Fi + charging).
 *
 * | Node Count | Re-encryption Time | Background (throttled) |
 * |------------|--------------------|-----------------------|
 * | 1,000      | ~30 seconds        | ~2 minutes            |
 * | 10,000     | ~5 minutes         | ~15 minutes           |
 * | 50,000     | ~25 minutes        | ~1 hour               |
 *
 * @see storm-022 v2 Section 9.3 - Timing Estimates table
 */
declare const ROTATION_TIMING_REFERENCE: {
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
 * Initiates key rotation for a user.
 * Creates new key version, starts background re-encryption.
 * Requires Web Crypto API and server-side key metadata storage.
 *
 * @param _user_id - User initiating rotation
 * @param _trigger - What triggered this rotation
 * @returns Initial rotation progress
 *
 * @see storm-022 v2 Section 9.3 - Phase 1: New Key Generation
 */
declare function initiateKeyRotation(_user_id: string, _trigger: KeyRotationTrigger): Promise<RotationProgress>;
/**
 * Background re-encryption of nodes from old key to new key.
 * Processes in batches, respects battery/Wi-Fi conditions,
 * persists progress for resumption.
 *
 * IMPORTANT: New writes during rotation always use the new key (N+1).
 * Old reads check encryption_version and use the appropriate key.
 * Requires Web Crypto API and database adapter.
 *
 * @param _old_key - Previous version CryptoKey
 * @param _new_key - New version CryptoKey
 * @param _progress - Current rotation progress (for resumption)
 *
 * @see storm-022 v2 Section 9.7 - backgroundReencrypt()
 */
declare function backgroundReencrypt(_old_key: CryptoKey, _new_key: CryptoKey, _progress: RotationProgress): Promise<void>;
/**
 * Gets nodes that still need re-encryption.
 * Returns batch of nodes with old encryption_version.
 * Requires database adapter.
 *
 * @param _last_processed_id - Resume from this node ID (null for start)
 * @returns Array of encrypted nodes needing rotation
 */
declare function getNodesNeedingRotation(_last_processed_id: string | null): Promise<EncryptedNodeSchema[]>;
/**
 * Checks whether rotation can continue based on device conditions.
 * Returns false if: no Wi-Fi, not charging, battery low.
 * Requires platform-specific battery/network APIs.
 *
 * @returns True if conditions allow rotation to continue
 *
 * @see storm-022 v2 Section 9.7 - Conditions for background execution
 */
declare function canContinueRotation(): Promise<boolean>;
/**
 * Saves rotation progress to persistent storage.
 * Called after each batch so rotation can resume after interruption.
 * Requires server-side progress storage.
 *
 * @param _progress - Current rotation state
 *
 * @see storm-022 v2 Section 9.6 - "Progress saved after each batch"
 */
declare function saveRotationProgress(_progress: RotationProgress): Promise<void>;
/**
 * Resumes an interrupted rotation.
 * Returns null if no rotation was in progress.
 * Requires server-side progress lookup.
 *
 * @param _user_id - User ID
 * @returns Saved progress or null
 *
 * @see storm-022 v2 Section 9.6 - "Rotation continues from last successful batch"
 */
declare function resumeRotation(_user_id: string): Promise<RotationProgress | null>;
/**
 * Verifies rotation integrity by sampling nodes.
 * Decrypts a percentage of nodes with the new key and
 * verifies content integrity via hash check.
 * Requires Web Crypto API and database adapter.
 *
 * @param _new_key - New CryptoKey to verify with
 * @param _sample_percent - Percentage of nodes to sample (default: 5%)
 * @returns True if all sampled nodes decrypt correctly
 *
 * @see storm-022 v2 Section 9.3 - "Sample 5% of nodes"
 */
declare function verifyRotation(_new_key: CryptoKey, _sample_percent: number): Promise<boolean>;
/**
 * Completes rotation: marks new key active, old key deprecated.
 * Old key retained for 30 days to handle devices that haven't synced yet.
 * Requires server-side key metadata update.
 *
 * @param _user_id - User ID
 *
 * @see storm-022 v2 Section 9.3 - Phase 3: Cleanup
 */
declare function completeRotation(_user_id: string): Promise<void>;
/**
 * Gets the appropriate CryptoKey for decrypting a specific node.
 * Checks the node's encryption_version against available key versions.
 * Requires key derivation from stored salts.
 *
 * @param _node - Encrypted node with encryption_version field
 * @param _metadata - User's key metadata with all versions
 * @returns The correct CryptoKey for this node's version
 *
 * @see storm-022 v2 Section 9.6 - READ OPERATION during rotation
 */
declare function getKeyVersionForNode(_node: EncryptedNodeSchema, _metadata: UserKeyMetadata): CryptoKey;

/**
 * @module @nous/core/security
 * @description Recovery system: BIP39 codes, forced verification, grace period
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * 24-word BIP39 recovery, forced verification, 7-day grace period,
 * recovery code regeneration, and periodic reminders.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/recovery.ts} - Spec
 */

/**
 * HKDF info string for deriving recovery key from BIP39 entropy.
 *
 * @see storm-022 v2 Section 9.5
 */
declare const RECOVERY_DERIVATION_INFO = "nous-recovery";
/**
 * Recovery key length in bytes (32 bytes = 256 bits).
 */
declare const RECOVERY_KEY_LENGTH_BYTES = 32;
/**
 * Default reminder messages for each recovery reminder type.
 *
 * @see storm-022 v1 revision Section 3 - Periodic Reminders
 */
declare const RECOVERY_REMINDER_MESSAGES: Record<RecoveryReminderType, string>;
/**
 * Error message shown when user attempts to use an invalidated recovery code.
 *
 * @see storm-022 v2 Section 9.5 - Old Code Behavior
 */
declare const OLD_CODE_ERROR_MESSAGE = "This recovery code is no longer valid. It was replaced on {date}. If you didn't change your passkey, contact support immediately.";
/**
 * Selects random word indices for forced verification.
 * Returns RECOVERY_VERIFICATION_WORD_COUNT (3) random indices
 * from the 24-word mnemonic.
 *
 * @returns Array of 3 unique random indices (0 to 23)
 */
declare function getVerificationIndices(): number[];
/**
 * Verifies the user's answers during forced verification.
 * Checks that the words at the specified indices match.
 *
 * @param mnemonic - The full 24-word recovery code
 * @param indices - The 3 indices being verified
 * @param answers - The user's 3 answers
 * @returns True if all answers match (case-insensitive)
 */
declare function verifyRecoveryWords(mnemonic: string[], indices: number[], answers: string[]): boolean;
/**
 * Generates a new 24-word BIP39 recovery mnemonic.
 * Requires BIP39 library and crypto.getRandomValues.
 *
 * @returns Array of 24 BIP39-compliant words
 */
declare function generateRecoveryCode(): string[];
/**
 * Derives a CryptoKey from a BIP39 mnemonic for recovery purposes.
 * Requires BIP39 library and Web Crypto API.
 *
 * @param _mnemonic - The 24-word BIP39 mnemonic
 * @returns Recovery CryptoKey (AES-256-GCM)
 */
declare function deriveRecoveryKey(_mnemonic: string[]): Promise<CryptoKey>;
/**
 * Encrypts the user's master key with the recovery key.
 * Requires Web Crypto API.
 *
 * @param _master_key - The user's master CryptoKey
 * @param _recovery_key - CryptoKey derived from recovery mnemonic
 * @returns Encrypted master key blob
 */
declare function encryptMasterKeyForRecovery(_master_key: CryptoKey, _recovery_key: CryptoKey): Promise<Uint8Array>;
/**
 * Recovers the master key using a recovery mnemonic.
 * Requires BIP39 library and Web Crypto API.
 *
 * @param _mnemonic - The 24-word BIP39 mnemonic
 * @param _encrypted_master - Encrypted master key blob from server
 * @returns Recovered master CryptoKey
 */
declare function recoverMasterKey(_mnemonic: string[], _encrypted_master: Uint8Array): Promise<CryptoKey>;
/**
 * Regenerates the recovery code, invalidating the old one.
 * Requires BIP39 library, Web Crypto API, and server-side storage.
 *
 * @param _user_id - User whose recovery code is being regenerated
 * @param _master_key - Current master CryptoKey
 * @returns Regeneration result with new mnemonic
 */
declare function regenerateRecoveryCode(_user_id: string, _master_key: CryptoKey): Promise<RecoveryRegenerationResult>;
/**
 * Checks whether the grace period is still active for a user.
 * Requires server-side grace period state lookup.
 *
 * @param _user_id - User ID
 * @returns True if grace period is active
 */
declare function isGracePeriodActive(_user_id: string): Promise<boolean>;
/**
 * Recovers the master key via email during the grace period.
 * Requires server-side email verification.
 *
 * @param _user_id - User ID
 * @param _email_token - Email verification token
 * @returns Recovered master CryptoKey
 */
declare function recoverViaEmail(_user_id: string, _email_token: string): Promise<CryptoKey>;
/**
 * Gets the current recovery reminder for a user, if any.
 * Requires server-side reminder state lookup.
 *
 * @param _user_id - User ID
 * @returns Recovery reminder or null if none due
 */
declare function getRecoveryReminder(_user_id: string): RecoveryReminder | null;
/**
 * Dismisses a recovery reminder for a user.
 * Requires server-side state update.
 *
 * @param _user_id - User ID
 * @param _reminder_type - Type of reminder being dismissed
 */
declare function dismissRecoveryReminder(_user_id: string, _reminder_type: RecoveryReminderType): Promise<void>;

/**
 * @module @nous/core/security
 * @description LLM consent UX: scopes, dialog types, visual indicators, revocation
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Consent state management, topic matching, decline handling,
 * and revocation for Private tier LLM access.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/consent-ux.ts} - Spec
 */

/**
 * Default consent settings for new Private tier users.
 *
 * @see storm-022 v2 Section 10.2 - Defaults
 */
declare const DEFAULT_CONSENT_SETTINGS: ConsentSettings;
/**
 * Default message shown when user declines LLM memory access.
 *
 * @see storm-022 v2 Section 10.6 - Decline dialog copy
 */
declare const DECLINE_MESSAGE = "I can't access your memories for this question. Without access, I can still help with general questions, writing assistance, and brainstorming ideas.";
/**
 * Checks if a consent state is still active (not expired).
 *
 * @param state - Consent state to check
 * @returns True if consent is still active
 */
declare function isConsentActive(state: ConsentState): boolean;
/**
 * Handles user declining LLM access to memories.
 * Returns available fallback actions.
 *
 * @param _user_id - User declining access (unused in pure computation)
 * @returns Decline result with available actions
 */
declare function handleDecline(_user_id: string): DeclineResult;
/**
 * Checks if a query embedding matches any remembered topic.
 * Uses cosine similarity against stored topic embeddings.
 *
 * @param query_embedding - Embedding of the current query
 * @param remembered_topics - User's remembered topic consents
 * @param threshold - Cosine similarity threshold (default: 0.85)
 * @returns Matching topic consent, or null if no match
 *
 * @see storm-022 v2 Section 10.2 - "Similarity threshold: 0.85 cosine similarity"
 */
declare function checkTopicMatch(query_embedding: number[], remembered_topics: TopicConsent[], threshold?: number): TopicConsent | null;
/**
 * Prepares consent dialog data for a set of memories and LLM provider.
 * Requires server-side memory lookup.
 *
 * @param _user_id - User requesting LLM access
 * @param _memory_ids - IDs of memories that would be shared
 * @param _provider - LLM provider identifier
 * @returns Data to render the consent dialog
 */
declare function requestConsent(_user_id: string, _memory_ids: string[], _provider: string): Promise<ConsentDialogData>;
/**
 * Records that the user has granted consent.
 * Requires server-side consent state persistence.
 *
 * @param _user_id - User granting consent
 * @param _scope - Chosen consent scope
 * @param _memory_ids - IDs of memories being shared
 * @returns Updated consent state
 */
declare function grantConsent(_user_id: string, _scope: ConsentScope, _memory_ids: string[]): Promise<ConsentState>;
/**
 * Checks if the user has active consent for a given query.
 * Requires server-side consent state lookup.
 *
 * @param _user_id - User ID
 * @param _query_embedding - Embedding of the current query
 * @returns Active consent state, or null if no active consent
 */
declare function checkConsent(_user_id: string, _query_embedding: number[]): Promise<ConsentState | null>;
/**
 * Revokes consent at the specified granularity.
 * Requires server-side consent state update.
 *
 * @param _user_id - User revoking consent
 * @param _request - Revocation scope
 */
declare function revokeConsent(_user_id: string, _request: ConsentRevocationRequest): Promise<void>;
/**
 * Gets all memories shared in a specific conversation.
 * Requires server-side shared memory tracking.
 *
 * @param _user_id - User ID
 * @param _conversation_id - Conversation ID
 * @returns Array of shared memory details
 */
declare function getSharedMemories(_user_id: string, _conversation_id: string): Promise<SharedMemoryDetail[]>;
/**
 * Updates consent settings for a user.
 * Requires server-side settings persistence.
 *
 * @param _user_id - User ID
 * @param _settings - Partial settings to update
 */
declare function updateConsentSettings(_user_id: string, _settings: Partial<ConsentSettings>): Promise<void>;

/**
 * @module @nous/core/security
 * @description API key security: platform keys, BYOK encryption, rate limiting
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Two API key models: Platform Keys (credit system) and BYOK (Bring Your Own Key).
 * Rate limiting, call routing, and BYOK encryption management.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/api-security.ts} - Spec
 */

/**
 * Predefined API call routes for each key type.
 *
 * @see storm-022 v1 revision Section 6 - API Call Flow diagrams
 */
declare const API_CALL_ROUTES: Record<ApiKeyType, ApiCallRoute>;
/**
 * Default BYOK rate limit configuration from brainstorm.
 *
 * @see storm-022 v1 revision Section 6 - Rate Limiting (BYOK)
 */
declare const DEFAULT_BYOK_RATE_LIMIT: BYOKRateLimitConfig;
/**
 * Gets the API call route for a given key type.
 *
 * @param keyType - 'platform' or 'byok'
 * @returns Routing configuration
 */
declare function getApiCallRouteForKeyType(keyType: ApiKeyType): ApiCallRoute;
/**
 * Encrypts a BYOK API key for storage.
 * Requires Web Crypto API.
 *
 * @param _api_key - Plaintext API key string
 * @param _encryption_key - CryptoKey to encrypt with
 * @returns Encrypted key bytes
 */
declare function encryptBYOKKey(_api_key: string, _encryption_key: CryptoKey): Promise<Uint8Array>;
/**
 * Decrypts a BYOK API key from storage.
 * Requires Web Crypto API.
 *
 * @param _encrypted - Encrypted key bytes
 * @param _encryption_key - CryptoKey to decrypt with
 * @returns Plaintext API key string
 */
declare function decryptBYOKKey(_encrypted: Uint8Array, _encryption_key: CryptoKey): Promise<string>;
/**
 * Determines the API call route for a user and provider.
 * Requires server-side BYOK config lookup.
 *
 * @param _user_id - User making the call
 * @param _provider - LLM provider
 * @returns Routing configuration
 */
declare function getApiCallRoute(_user_id: string, _provider: LLMProvider): Promise<ApiCallRoute>;
/**
 * Checks if a BYOK decryption attempt is allowed (rate limit check).
 * Requires rate limit state tracking.
 *
 * @param _user_id - User attempting decryption
 * @returns True if decryption is allowed
 */
declare function checkBYOKRateLimit(_user_id: string): Promise<boolean>;
/**
 * Records a BYOK decryption attempt for rate limiting.
 * Requires rate limit state tracking.
 *
 * @param _user_id - User who attempted decryption
 * @param _success - Whether decryption succeeded
 */
declare function trackBYOKDecryption(_user_id: string, _success: boolean): void;
/**
 * Rotates a platform API key for a provider.
 * Requires server-side key management.
 *
 * @param _provider - LLM provider to rotate key for
 */
declare function rotatePlatformKey(_provider: LLMProvider): Promise<void>;
/**
 * Gets the BYOK configuration for a user and provider.
 * Requires server-side BYOK storage.
 *
 * @param _user_id - User to check
 * @param _provider - LLM provider
 * @returns BYOK config or null
 */
declare function getBYOKConfig(_user_id: string, _provider: LLMProvider): Promise<BYOKConfig | null>;
/**
 * Stores a new BYOK key for a user.
 * Requires Web Crypto API and server-side storage.
 *
 * @param _user_id - User storing the key
 * @param _provider - LLM provider
 * @param _api_key - Plaintext API key
 * @param _tier - User's privacy tier (determines encryption method)
 * @returns BYOK configuration
 */
declare function storeBYOKKey(_user_id: string, _provider: LLMProvider, _api_key: string, _tier: PrivacyTier): Promise<BYOKConfig>;
/**
 * Removes a BYOK key for a user.
 * Requires server-side key deletion.
 *
 * @param _user_id - User revoking the key
 * @param _provider - LLM provider
 */
declare function revokeBYOKKey(_user_id: string, _provider: LLMProvider): Promise<void>;

/**
 * @module @nous/core/security
 * @description Export compliance, threat model, app store declarations, launch strategy
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Export compliance by region, threat model, app store encryption
 * declarations, and phased launch strategy. All functions are pure.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/compliance.ts} - Spec
 */

/**
 * Complete threat model from brainstorm Section 8.
 *
 * @see storm-022 v1 revision Section 8 - Threat Model
 */
declare const THREAT_MODEL: ThreatModelEntry[];
/**
 * Export compliance requirements by region.
 *
 * @see storm-022 v1 revision Section 7 - Export Compliance
 */
declare const EXPORT_COMPLIANCE_BY_REGION: ExportComplianceConfig[];
/**
 * Three-phase launch strategy for compliance rollout.
 *
 * @see storm-022 v1 revision Section 7 - Launch Strategy
 */
declare const LAUNCH_STRATEGY: LaunchPhase[];
/**
 * App store encryption declarations for both launch phases.
 *
 * @see storm-022 v1 revision Section 7 - iOS/Google Play compliance
 */
declare const APP_STORE_DECLARATIONS: {
    standard_only: AppStoreDeclaration[];
    with_private_tier: AppStoreDeclaration[];
};
/**
 * Gets export compliance requirements for a tier in a region.
 *
 * @param tier - Privacy tier to check
 * @param region - Region identifier (e.g., 'us', 'france', 'general')
 * @returns Compliance config for the region, or general config if region not found
 */
declare function getComplianceRequirements(tier: PrivacyTier, region: string): ExportComplianceConfig;
/**
 * Returns the complete threat model.
 *
 * @returns All threat model entries
 */
declare function getThreatModel(): ThreatModelEntry[];
/**
 * Returns the phased launch strategy.
 *
 * @returns All launch phases in order
 */
declare function getLaunchStrategy(): LaunchPhase[];
/**
 * Checks whether a region supports a given privacy tier.
 *
 * @param region - Region identifier
 * @param tier - Privacy tier to check
 * @returns True if the tier is available in the region (not 'excluded')
 */
declare function isRegionSupported(region: string, tier: PrivacyTier): boolean;
/**
 * Gets app store declarations for a platform based on current launch phase.
 *
 * @param platform - Target platform
 * @param includes_private_tier - Whether Private tier is enabled
 * @returns App store declaration for the platform
 */
declare function getAppStoreDeclaration(platform: Platform, includes_private_tier: boolean): AppStoreDeclaration;
/**
 * Gets threats that a specific tier protects against.
 *
 * @param tier - Privacy tier to check
 * @returns Threat entries where the tier provides protection
 */
declare function getProtectedThreats(tier: PrivacyTier): ThreatModelEntry[];
/**
 * Gets threats that a specific tier does NOT protect against.
 *
 * @param tier - Privacy tier to check
 * @returns Threat entries where the tier provides no protection
 */
declare function getUnprotectedThreats(tier: PrivacyTier): ThreatModelEntry[];

/**
 * @module @nous/core/security
 * @description Offline auth states, token expiry, state transitions, sync queue
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Five offline states with graceful degradation, offline sync queue,
 * and capability checks per state and tier.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/offline-auth.ts} - Spec
 */

/**
 * Configuration for each of the five offline states.
 *
 * Note: Private tier passkey unlock works in ALL states because
 * the Secure Enclave is local to the device.
 *
 * @see storm-022 v1 revision Section 1 - Token Management & Offline States
 */
declare const OFFLINE_STATE_CONFIGS: Record<OfflineState, OfflineStateConfig>;
/**
 * Gets the offline state configuration for a given state.
 *
 * @param state - The offline state to look up
 * @returns Configuration for that state
 */
declare function getOfflineStateConfig(state: OfflineState): OfflineStateConfig;
/**
 * Calculates the current offline state based on last online time and token status.
 *
 * @param last_online - ISO 8601 timestamp of last known online state
 * @param tokens - Current auth tokens (for expiry checking)
 * @returns Calculated offline state
 *
 * @see storm-022 v1 revision Section 1 - updateOfflineState()
 */
declare function calculateOfflineState(last_online: string, tokens: AuthTokens): OfflineState;
/**
 * Gets capabilities available in a given offline state and tier.
 *
 * Note: Private tier has local search (client-side HNSW) available
 * in all offline states. Standard tier search requires network.
 *
 * @param state - Current offline state
 * @param tier - User's privacy tier
 * @returns Capability check result
 */
declare function getOfflineCapabilities(state: OfflineState, tier: PrivacyTier): OfflineCapabilityCheck;
/**
 * Queues an operation for sync when back online.
 * Requires persistent queue storage.
 *
 * @param _operation - The operation to queue
 */
declare function queueOfflineOperation(_operation: QueuedOperation): Promise<void>;
/**
 * Processes the offline sync queue when connectivity is restored.
 * Requires network access and database adapter.
 *
 * @returns Sync result with counts of synced and failed operations
 */
declare function processOfflineQueue(): Promise<QueueSyncResult>;
/**
 * Gets the current number of queued operations.
 * Requires persistent queue storage.
 *
 * @returns Number of pending operations in the queue
 */
declare function getQueueSize(): Promise<number>;

export { API_CALL_ROUTES, APP_STORE_DECLARATIONS, ApiCallFlow, type ApiCallRoute, ApiCallRouteSchema, ApiKeyType, type AppStoreDeclaration, AppStoreDeclarationSchema, AuthMethod, type AuthSecurityConfig, AuthSecurityConfigSchema, type AuthState, AuthStateSchema, type AuthTokens, AuthTokensSchema, type BYOKConfig, BYOKConfigSchema, type BYOKDecryptionAttempt, BYOKDecryptionAttemptSchema, BYOKEncryptionMethod, type BYOKRateLimitConfig, BYOKRateLimitConfigSchema, type ClerkConfig, ClerkConfigSchema, type ClientSearchConfig, ClientSearchConfigSchema, type ConsentDialogData, ConsentDialogDataSchema, ConsentDuration, type ConsentEvent, ConsentEventSchema, ConsentEventType, type ConsentMemoryPreview, ConsentMemoryPreviewSchema, type ConsentRevocationRequest, ConsentRevocationRequestSchema, ConsentRevocationScope, ConsentScope, type ConsentSettings, ConsentSettingsSchema, type ConsentState, ConsentStateSchema, type ConsentVisualIndicator, ConsentVisualIndicatorSchema, DECLINE_MESSAGE, DEFAULT_BYOK_RATE_LIMIT, DEFAULT_CLIENT_SEARCH_CONFIG_DESKTOP, DEFAULT_CLIENT_SEARCH_CONFIG_MOBILE, DEFAULT_CONSENT_SETTINGS, DEFAULT_DESKTOP_CONFIG, DEFAULT_MULTI_DEVICE_SYNC, DEFAULT_ROTATION_CONFIG, DEFAULT_SECURITY_CONFIG, DeclineAction, type DeclineResult, DeclineResultSchema, type DecryptionResult, DecryptionResultSchema, type DerivedKeys, DerivedKeysSchema, type DesktopAuthFlow, DesktopAuthFlowSchema, DesktopAuthStep, ENCRYPTED_NODES_ADDITIONAL_SQL, ENCRYPTION_FIELD_MAP, EXPORT_COMPLIANCE_BY_REGION, type EncryptedNodeSchema, EncryptedNodeSchemaZ, type EncryptionFieldMap, EncryptionFieldMapSchema, type EncryptionResult, EncryptionResultSchema, type ExportComplianceConfig, ExportComplianceConfigSchema, ExportComplianceStatus, type GracePeriodState, GracePeriodStateSchema, type HNSWIndex, HNSWIndexSchema, type JWTValidationResult, JWTValidationResultSchema, KEY_DERIVATION_FUNCTION, type KeyDerivationParams, KeyDerivationParamsSchema, type KeyHierarchy, KeyHierarchySchema, KeyPurpose, KeyRotationTrigger, type KeyVersion, KeyVersionSchema, KeyVersionStatus, LAUNCH_STRATEGY, LLMProvider, type LaunchPhase, LaunchPhaseSchema, type LocalSearchResult, LocalSearchResultSchema, MASTER_KEY_LENGTH_BITS, type MasterKeyInfo, MasterKeyInfoSchema, MfaOption, type MultiDeviceKeySync, MultiDeviceKeySyncSchema, OFFLINE_STATE_CONFIGS, OFFLINE_STATE_TRANSITION_REFERENCE, OLD_CODE_ERROR_MESSAGE, type OfflineCapabilityCheck, OfflineCapabilityCheckSchema, OfflineFunctionality, OfflineState, type OfflineStateConfig, OfflineStateConfigSchema, OfflineSyncBehavior, type OfflineSyncQueue, OfflineSyncQueueSchema, PERFORMANCE_REFERENCE, PLATFORM_AUTH_CONFIGS, type PasskeyInfo, PasskeyInfoSchema, PasskeyPlatform, Platform, type PlatformApiKey, PlatformApiKeySchema, type PlatformAuthConfig, PlatformAuthConfigSchema, PrivacyTier, QueueOperationType, type QueueSyncResult, QueueSyncResultSchema, QueueableTable, type QueuedOperation, QueuedOperationSchema, RECOVERY_DERIVATION_INFO, RECOVERY_KEY_LENGTH_BYTES, RECOVERY_REMINDER_MESSAGES, ROTATION_TIMING_REFERENCE, type RecoveryAttempt, RecoveryAttemptSchema, type RecoveryCode, RecoveryCodeSchema, RecoveryMethod, type RecoveryRegenerationResult, RecoveryRegenerationResultSchema, type RecoveryReminder, RecoveryReminderSchema, RecoveryReminderType, type RecoverySetupState, RecoverySetupStateSchema, RecoverySetupStep, type RotationConfig, RotationConfigSchema, type RotationEvent, RotationEventSchema, RotationEventType, RotationPhase, type RotationProgress, RotationProgressSchema, type SharedMemoryDetail, SharedMemoryDetailSchema, SignInImplementation, THREAT_MODEL, TIER_COMPARISON_TABLE, TIER_DEFINITIONS, TIER_MIGRATION_STATUSES, type ThreatModelEntry, ThreatModelEntrySchema, type TierComparison, TierComparisonSchema, type TierDefinition, TierDefinitionSchema, type TierMigrationRequest, TierMigrationRequestSchema, type TierMigrationState, TierMigrationStateSchema, type TopicConsent, TopicConsentSchema, type UserKeyMetadata, UserKeyMetadataSchema, backgroundReencrypt, buildLocalSearchIndex, calculateOfflineState, canContinueRotation, canMigrateTier, checkBYOKRateLimit, checkConsent, checkTopicMatch, completeRotation, createDerivationParams, decryptBYOKKey, decryptEmbedding, decryptNode, deriveAllKeys, deriveContentKey, deriveEmbeddingKey, deriveMasterKey, deriveMetadataKey, deriveRecoveryKey, dismissRecoveryReminder, encryptBYOKKey, encryptEmbedding, encryptMasterKeyForRecovery, encryptNode, estimateMigrationTime, generateRecoveryCode, generateSalt, getApiCallRoute, getApiCallRouteForKeyType, getAppStoreDeclaration, getBYOKConfig, getClerkConfig, getComplianceRequirements, getKeyVersionForNode, getLaunchStrategy, getNodesNeedingRotation, getOfflineCapabilities, getOfflineStateConfig, getPlatformAuthConfig, getProtectedThreats, getQueueSize, getRecoveryReminder, getSharedMemories, getThreatModel, getTierDefinition, getTierMigrationProgress, getUnprotectedThreats, getVerificationIndices, grantConsent, handleDecline, initiateKeyRotation, isConsentActive, isGracePeriodActive, isRegionSupported, isTokenValid, processOfflineQueue, queueOfflineOperation, recoverMasterKey, recoverViaEmail, regenerateRecoveryCode, requestConsent, resumeRotation, revokeBYOKKey, revokeConsent, rotatePlatformKey, saveRotationProgress, searchLocalIndex, shouldReauthenticate, startTierMigration, storeBYOKKey, trackBYOKDecryption, updateConsentSettings, updateOfflineState, validateJWT, verifyRecoveryWords, verifyRotation };
