/**
 * @module @nous/core/security
 * @description Tests for Security & Auth Architecture (storm-022)
 */

import { describe, it, expect } from 'vitest';
import {
  // Constants - Enums
  PRIVACY_TIERS,
  AUTH_PROVIDERS,
  PLATFORMS,
  OFFLINE_STATES,
  CONSENT_SCOPES,
  CONSENT_REVOCATION_SCOPES,
  KEY_VERSION_STATUSES,
  KEY_ROTATION_TRIGGERS,
  ROTATION_PHASES,
  ROTATION_EVENT_TYPES,
  TIER_MIGRATION_STATUSES,
  API_KEY_TYPES,
  LLM_PROVIDERS,
  SIGN_IN_IMPLEMENTATIONS,
  OFFLINE_FUNCTIONALITY_LEVELS,
  OFFLINE_SYNC_BEHAVIORS,
  QUEUEABLE_TABLES,
  DECLINE_ACTIONS,
  RECOVERY_REMINDER_TYPES,
  REENCRYPTION_PRIORITY_ORDER,

  // Constants - Numeric values
  ENCRYPTION_ALGORITHM,
  NONCE_LENGTH_BYTES,
  MASTER_KEY_LENGTH_BITS,
  DERIVATION_INFO_STRINGS,
  OFFLINE_THRESHOLDS,
  ACCESS_TOKEN_EXPIRY_MINUTES,
  REFRESH_TOKEN_EXPIRY_DAYS,
  ROTATION_BATCH_SIZE,
  ROTATION_PAUSE_BETWEEN_BATCHES_MS,
  ROTATION_MAX_BATCHES_PER_MINUTE,
  ROTATION_MIN_BATTERY_LEVEL,
  DEPRECATED_KEY_RETENTION_DAYS,
  ROTATION_VERIFICATION_SAMPLE_PERCENT,
  SCHEDULED_ROTATION_MONTHS,
  ROTATION_TIMING_ESTIMATES,
  RECOVERY_WORD_COUNT,
  RECOVERY_VERIFICATION_WORD_COUNT,
  GRACE_PERIOD_DAYS,
  RECOVERY_REMINDER_DAYS,
  TOPIC_SIMILARITY_THRESHOLD,
  CONVERSATION_TIMEOUT_MINUTES,
  DEFAULT_CONSENT_SCOPE,
  BYOK_MAX_DECRYPTIONS_PER_MINUTE,
  BYOK_LOCKOUT_AFTER_FAILURES,
  BYOK_LOCKOUT_DURATION_MINUTES,
  ECCN_CLASSIFICATION,
  MIGRATION_RATE_MS_PER_1K_NODES,
  PASSKEY_SYNC_MECHANISMS,
  BRUTE_FORCE_LOCKOUT_ATTEMPTS,
  BRUTE_FORCE_LOCKOUT_MINUTES,
  CAPTCHA_AFTER_FAILURES,
  PRIVATE_TIER_NODE_LIMITS,
  DEEP_LINK_SCHEME,
  AUTH_CALLBACK_PATH,

  // Type guards
  isPrivacyTier,
  isPlatform,
  isOfflineState,
  isConsentScope,
  isKeyVersionStatus,

  // Zod schemas
  PrivacyTierSchema,
  PlatformSchema,
  OfflineStateSchema,
  ConsentScopeSchema,
  TierDefinitionSchema,
  TierComparisonSchema,
  TierMigrationRequestSchema,
  TierMigrationStateSchema,
  EncryptedNodeSchemaZ,
  EncryptionFieldMapSchema,
  EncryptionResultSchema,
  DecryptionResultSchema,
  ClientSearchConfigSchema,
  LocalSearchResultSchema,
  KeyDerivationParamsSchema,
  DerivedKeysSchema,
  MultiDeviceKeySyncSchema,
  KeyVersionSchema,
  UserKeyMetadataSchema,
  RotationProgressSchema,
  RotationConfigSchema,
  RotationEventSchema,
  RecoveryCodeSchema,
  RecoverySetupStateSchema,
  RecoveryAttemptSchema,
  GracePeriodStateSchema,
  RecoveryRegenerationResultSchema,
  RecoveryReminderSchema,
  ConsentStateSchema,
  TopicConsentSchema,
  ConsentSettingsSchema,
  ConsentDialogDataSchema,
  ConsentRevocationRequestSchema,
  DeclineResultSchema,
  SharedMemoryDetailSchema,
  PlatformApiKeySchema,
  BYOKConfigSchema,
  ApiCallRouteSchema,
  BYOKRateLimitConfigSchema,
  ExportComplianceConfigSchema,
  AppStoreDeclarationSchema,
  ThreatModelEntrySchema,
  LaunchPhaseSchema,
  OfflineStateConfigSchema,
  QueuedOperationSchema,
  OfflineCapabilityCheckSchema,
  QueueSyncResultSchema,
  PlatformAuthConfigSchema,
  AuthSecurityConfigSchema,
  AuthTokensSchema,
  AuthStateSchema,
  JWTValidationResultSchema,

  // Auth module
  PLATFORM_AUTH_CONFIGS,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_DESKTOP_CONFIG,
  OFFLINE_STATE_TRANSITION_REFERENCE,
  isTokenValid,
  shouldReauthenticate,
  updateOfflineState,
  getPlatformAuthConfig,
  getClerkConfig,
  validateJWT,

  // Tiers module
  TIER_DEFINITIONS,
  TIER_COMPARISON_TABLE,
  getTierDefinition,
  canMigrateTier,
  estimateMigrationTime,
  startTierMigration,
  getTierMigrationProgress,

  // Encryption module
  ENCRYPTION_FIELD_MAP,
  ENCRYPTED_NODES_ADDITIONAL_SQL,
  DEFAULT_CLIENT_SEARCH_CONFIG_MOBILE,
  DEFAULT_CLIENT_SEARCH_CONFIG_DESKTOP,
  PERFORMANCE_REFERENCE,
  encryptNode,
  decryptNode,
  encryptEmbedding,
  decryptEmbedding,
  buildLocalSearchIndex,
  searchLocalIndex,

  // Keys module
  DEFAULT_MULTI_DEVICE_SYNC,
  DEFAULT_ROTATION_CONFIG,
  ROTATION_TIMING_REFERENCE,
  createDerivationParams,
  deriveMasterKey,
  deriveContentKey,
  deriveEmbeddingKey,
  deriveMetadataKey,
  deriveAllKeys,
  generateSalt,
  initiateKeyRotation,
  backgroundReencrypt,
  getNodesNeedingRotation,
  canContinueRotation,
  saveRotationProgress,
  resumeRotation,
  verifyRotation,
  completeRotation,
  getKeyVersionForNode,

  // Recovery module
  RECOVERY_DERIVATION_INFO,
  RECOVERY_KEY_LENGTH_BYTES,
  RECOVERY_REMINDER_MESSAGES,
  OLD_CODE_ERROR_MESSAGE,
  getVerificationIndices,
  verifyRecoveryWords,
  generateRecoveryCode,
  deriveRecoveryKey,
  encryptMasterKeyForRecovery,
  recoverMasterKey,
  regenerateRecoveryCode,
  isGracePeriodActive,
  recoverViaEmail,
  getRecoveryReminder,
  dismissRecoveryReminder,

  // Consent module
  DEFAULT_CONSENT_SETTINGS,
  DECLINE_MESSAGE,
  isConsentActive,
  handleDecline,
  checkTopicMatch,
  requestConsent,
  grantConsent,
  checkConsent,
  revokeConsent,
  getSharedMemories,
  updateConsentSettings,

  // API Keys module
  API_CALL_ROUTES,
  DEFAULT_BYOK_RATE_LIMIT,
  getApiCallRouteForKeyType,
  encryptBYOKKey,
  decryptBYOKKey,
  getApiCallRoute,
  checkBYOKRateLimit,
  trackBYOKDecryption,
  rotatePlatformKey,
  getBYOKConfig,
  storeBYOKKey,
  revokeBYOKKey,

  // Compliance module
  THREAT_MODEL,
  EXPORT_COMPLIANCE_BY_REGION,
  LAUNCH_STRATEGY,
  APP_STORE_DECLARATIONS,
  getComplianceRequirements,
  getThreatModel,
  getLaunchStrategy,
  isRegionSupported,
  getAppStoreDeclaration,
  getProtectedThreats,
  getUnprotectedThreats,

  // Offline module
  OFFLINE_STATE_CONFIGS,
  getOfflineStateConfig,
  calculateOfflineState,
  getOfflineCapabilities,
  queueOfflineOperation,
  processOfflineQueue,
  getQueueSize,

  // Types
  type PrivacyTier,
  type Platform,
  type OfflineState,
  type ConsentScope,
  type KeyPurpose,
  type AuthTokens,
  type AuthState,
} from './index';

// ============================================================
// CONSTANTS TESTS
// ============================================================

describe('Security Constants', () => {
  describe('Privacy Tier Constants', () => {
    it('should have exactly 2 privacy tiers', () => {
      expect(PRIVACY_TIERS).toEqual(['standard', 'private']);
      expect(PRIVACY_TIERS.length).toBe(2);
    });

    it('should have valid privacy tier type guard', () => {
      expect(isPrivacyTier('standard')).toBe(true);
      expect(isPrivacyTier('private')).toBe(true);
      expect(isPrivacyTier('premium')).toBe(false);
      expect(isPrivacyTier(123)).toBe(false);
    });
  });

  describe('Auth Provider Constants', () => {
    it('should have Clerk as auth provider', () => {
      expect(AUTH_PROVIDERS).toContain('clerk');
      expect(AUTH_PROVIDERS.length).toBe(1);
    });
  });

  describe('Platform Constants', () => {
    it('should have all 4 platforms', () => {
      expect(PLATFORMS).toEqual(['ios', 'android', 'macos', 'windows']);
      expect(PLATFORMS.length).toBe(4);
    });

    it('should have valid platform type guard', () => {
      expect(isPlatform('ios')).toBe(true);
      expect(isPlatform('android')).toBe(true);
      expect(isPlatform('macos')).toBe(true);
      expect(isPlatform('windows')).toBe(true);
      expect(isPlatform('linux')).toBe(false);
    });
  });

  describe('Offline State Constants', () => {
    it('should have all 5 offline states', () => {
      expect(OFFLINE_STATES).toContain('online');
      expect(OFFLINE_STATES).toContain('short_offline');
      expect(OFFLINE_STATES).toContain('medium_offline');
      expect(OFFLINE_STATES).toContain('long_offline');
      expect(OFFLINE_STATES).toContain('reauth_required');
      expect(OFFLINE_STATES.length).toBe(5);
    });

    it('should have valid offline state type guard', () => {
      expect(isOfflineState('online')).toBe(true);
      expect(isOfflineState('long_offline')).toBe(true);
      expect(isOfflineState('disconnected')).toBe(false);
    });
  });

  describe('Consent Scope Constants', () => {
    it('should have all 4 consent scopes', () => {
      expect(CONSENT_SCOPES).toContain('per_message');
      expect(CONSENT_SCOPES).toContain('per_conversation');
      expect(CONSENT_SCOPES).toContain('time_based');
      expect(CONSENT_SCOPES).toContain('topic_based');
      expect(CONSENT_SCOPES.length).toBe(4);
    });

    it('should have valid consent scope type guard', () => {
      expect(isConsentScope('per_message')).toBe(true);
      expect(isConsentScope('topic_based')).toBe(true);
      expect(isConsentScope('forever')).toBe(false);
    });
  });

  describe('Encryption Constants', () => {
    it('should use AES-256-GCM encryption', () => {
      expect(ENCRYPTION_ALGORITHM).toBe('AES-256-GCM');
    });

    it('should use 12-byte nonces', () => {
      expect(NONCE_LENGTH_BYTES).toBe(12);
    });

    it('should have 256-bit master key length', () => {
      expect(MASTER_KEY_LENGTH_BITS).toBe(256);
    });

    it('should have derivation info strings for all key purposes', () => {
      expect(DERIVATION_INFO_STRINGS.content).toBe('nous-content');
      expect(DERIVATION_INFO_STRINGS.embedding).toBe('nous-embedding');
      expect(DERIVATION_INFO_STRINGS.metadata).toBe('nous-metadata');
    });
  });

  describe('Offline Threshold Constants', () => {
    it('should have correct offline thresholds', () => {
      expect(OFFLINE_THRESHOLDS.short_offline).toBe(24);
      expect(OFFLINE_THRESHOLDS.medium_offline).toBe(168);
    });
  });

  describe('Token Constants', () => {
    it('should have correct token lifetimes', () => {
      expect(ACCESS_TOKEN_EXPIRY_MINUTES).toBe(15);
      expect(REFRESH_TOKEN_EXPIRY_DAYS).toBe(30);
    });
  });

  describe('Key Rotation Constants', () => {
    it('should have correct rotation batch config', () => {
      expect(ROTATION_BATCH_SIZE).toBe(100);
      expect(ROTATION_PAUSE_BETWEEN_BATCHES_MS).toBe(500);
      expect(ROTATION_MAX_BATCHES_PER_MINUTE).toBe(60);
    });

    it('should have correct rotation thresholds', () => {
      expect(ROTATION_MIN_BATTERY_LEVEL).toBe(20);
      expect(DEPRECATED_KEY_RETENTION_DAYS).toBe(30);
      expect(ROTATION_VERIFICATION_SAMPLE_PERCENT).toBe(5);
      expect(SCHEDULED_ROTATION_MONTHS).toBe(12);
    });

    it('should have timing estimates', () => {
      expect(ROTATION_TIMING_ESTIMATES['1k']).toBeDefined();
      expect(ROTATION_TIMING_ESTIMATES['10k']).toBeDefined();
      expect(ROTATION_TIMING_ESTIMATES['50k']).toBeDefined();
    });

    it('should have rotation phases', () => {
      expect(ROTATION_PHASES).toContain('generating');
      expect(ROTATION_PHASES).toContain('reencrypting');
      expect(ROTATION_PHASES).toContain('verifying');
      expect(ROTATION_PHASES).toContain('completing');
      expect(ROTATION_PHASES.length).toBe(4);
    });

    it('should have key version statuses', () => {
      expect(KEY_VERSION_STATUSES).toContain('active');
      expect(KEY_VERSION_STATUSES).toContain('rotating');
      expect(KEY_VERSION_STATUSES).toContain('deprecated');
      expect(KEY_VERSION_STATUSES).toContain('expired');
      expect(KEY_VERSION_STATUSES.length).toBe(4);
    });

    it('should have re-encryption priority order', () => {
      expect(REENCRYPTION_PRIORITY_ORDER).toContain('recently_accessed');
      expect(REENCRYPTION_PRIORITY_ORDER).toContain('frequently_accessed');
      expect(REENCRYPTION_PRIORITY_ORDER).toContain('oldest_first');
    });
  });

  describe('Recovery Constants', () => {
    it('should use 24-word BIP39 recovery', () => {
      expect(RECOVERY_WORD_COUNT).toBe(24);
    });

    it('should verify 3 random words', () => {
      expect(RECOVERY_VERIFICATION_WORD_COUNT).toBe(3);
    });

    it('should have 7-day grace period', () => {
      expect(GRACE_PERIOD_DAYS).toBe(7);
    });

    it('should have recovery reminder schedule', () => {
      expect(RECOVERY_REMINDER_DAYS).toContain(30);
      expect(RECOVERY_REMINDER_DAYS).toContain(180);
    });
  });

  describe('Consent Constants', () => {
    it('should have 0.85 topic similarity threshold', () => {
      expect(TOPIC_SIMILARITY_THRESHOLD).toBe(0.85);
    });

    it('should have 30-minute conversation timeout', () => {
      expect(CONVERSATION_TIMEOUT_MINUTES).toBe(30);
    });

    it('should default to per_conversation scope', () => {
      expect(DEFAULT_CONSENT_SCOPE).toBe('per_conversation');
    });
  });

  describe('BYOK Constants', () => {
    it('should have correct BYOK rate limits', () => {
      expect(BYOK_MAX_DECRYPTIONS_PER_MINUTE).toBe(5);
      expect(BYOK_LOCKOUT_AFTER_FAILURES).toBe(10);
      expect(BYOK_LOCKOUT_DURATION_MINUTES).toBe(30);
    });
  });

  describe('Compliance Constants', () => {
    it('should have correct ECCN classification', () => {
      expect(ECCN_CLASSIFICATION).toBe('5D992');
    });
  });

  describe('Security Measure Constants', () => {
    it('should have brute force protection', () => {
      expect(BRUTE_FORCE_LOCKOUT_ATTEMPTS).toBe(5);
      expect(BRUTE_FORCE_LOCKOUT_MINUTES).toBe(15);
      expect(CAPTCHA_AFTER_FAILURES).toBe(3);
    });
  });

  describe('Client Search Constants', () => {
    it('should have device-specific node limits', () => {
      expect(PRIVATE_TIER_NODE_LIMITS.mobile).toBe(50000);
      expect(PRIVATE_TIER_NODE_LIMITS.desktop).toBe(100000);
    });
  });

  describe('Additional Type Guards', () => {
    it('should validate key version status', () => {
      expect(isKeyVersionStatus('active')).toBe(true);
      expect(isKeyVersionStatus('rotating')).toBe(true);
      expect(isKeyVersionStatus('deprecated')).toBe(true);
      expect(isKeyVersionStatus('expired')).toBe(true);
      expect(isKeyVersionStatus('invalid')).toBe(false);
    });

    it('should validate consent scope', () => {
      expect(isConsentScope('per_message')).toBe(true);
      expect(isConsentScope('per_conversation')).toBe(true);
      expect(isConsentScope('time_based')).toBe(true);
      expect(isConsentScope('topic_based')).toBe(true);
      expect(isConsentScope('invalid')).toBe(false);
    });

    it('should have enum arrays for types without type guards', () => {
      expect(KEY_ROTATION_TRIGGERS.length).toBeGreaterThan(0);
      expect(ROTATION_EVENT_TYPES.length).toBeGreaterThan(0);
      expect(TIER_MIGRATION_STATUSES.length).toBeGreaterThan(0);
      expect(API_KEY_TYPES).toEqual(['platform', 'byok']);
      expect(LLM_PROVIDERS).toEqual(['openai', 'anthropic', 'google']);
      expect(SIGN_IN_IMPLEMENTATIONS.length).toBe(5);
      expect(OFFLINE_FUNCTIONALITY_LEVELS.length).toBeGreaterThan(0);
      expect(OFFLINE_SYNC_BEHAVIORS.length).toBe(4);
      expect(QUEUEABLE_TABLES).toContain('nodes');
      expect(QUEUEABLE_TABLES).toContain('edges');
      expect(DECLINE_ACTIONS.length).toBeGreaterThan(0);
      expect(RECOVERY_REMINDER_TYPES).toEqual(['initial', 'periodic', 'new_device']);
    });
  });
});

// ============================================================
// ZOD SCHEMA TESTS
// ============================================================

describe('Security Zod Schemas', () => {
  describe('PrivacyTierSchema', () => {
    it('should accept valid tiers', () => {
      expect(PrivacyTierSchema.parse('standard')).toBe('standard');
      expect(PrivacyTierSchema.parse('private')).toBe('private');
    });

    it('should reject invalid tiers', () => {
      expect(() => PrivacyTierSchema.parse('premium')).toThrow();
    });
  });

  describe('PlatformSchema', () => {
    it('should accept valid platforms', () => {
      expect(PlatformSchema.parse('ios')).toBe('ios');
      expect(PlatformSchema.parse('android')).toBe('android');
      expect(PlatformSchema.parse('macos')).toBe('macos');
      expect(PlatformSchema.parse('windows')).toBe('windows');
    });

    it('should reject invalid platforms', () => {
      expect(() => PlatformSchema.parse('linux')).toThrow();
    });
  });

  describe('TierDefinitionSchema', () => {
    it('should validate a tier definition', () => {
      const result = TierDefinitionSchema.safeParse({
        tier: 'standard',
        name: 'Standard',
        description: 'Test description',
        target_user: 'Test user',
        search: 'cloud',
        llm_access: 'direct',
        key_management: 'none',
        data_protection: ['TLS'],
        data_exposure: ['Server access'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid search type', () => {
      const result = TierDefinitionSchema.safeParse({
        tier: 'standard',
        name: 'Standard',
        description: 'Test',
        target_user: 'Test',
        search: 'hybrid',
        llm_access: 'direct',
        key_management: 'none',
        data_protection: [],
        data_exposure: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('TierMigrationRequestSchema', () => {
    it('should validate a migration request', () => {
      const result = TierMigrationRequestSchema.safeParse({
        user_id: 'user_123',
        from_tier: 'standard',
        to_tier: 'private',
        initiated_at: new Date().toISOString(),
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty user_id', () => {
      const result = TierMigrationRequestSchema.safeParse({
        user_id: '',
        from_tier: 'standard',
        to_tier: 'private',
        initiated_at: new Date().toISOString(),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AuthTokensSchema', () => {
    it('should validate auth tokens', () => {
      const result = AuthTokensSchema.safeParse({
        access_token: 'jwt_token_here',
        refresh_token: 'refresh_token_here',
        issued_at: new Date().toISOString(),
        expires_at: new Date().toISOString(),
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing fields', () => {
      const result = AuthTokensSchema.safeParse({
        access_token: 'token',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('EncryptedNodeSchemaZ', () => {
    it('should validate an encrypted node', () => {
      const result = EncryptedNodeSchemaZ.safeParse({
        id: 'node_123',
        type: 'memory',
        encrypted_payload: new Uint8Array([1, 2, 3]),
        encrypted_embedding: new Uint8Array([4, 5, 6]),
        nonce: new Uint8Array(12),
        encryption_version: 1,
        encryption_tier: 'private',
        version: 1,
        updated_at: Date.now(),
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid encryption version', () => {
      const result = EncryptedNodeSchemaZ.safeParse({
        id: 'node_123',
        type: 'memory',
        encrypted_payload: new Uint8Array([1, 2, 3]),
        nonce: new Uint8Array(12),
        encryption_version: 0,
        encryption_tier: 'private',
        version: 1,
        updated_at: Date.now(),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('KeyVersionSchema', () => {
    it('should validate a key version', () => {
      const result = KeyVersionSchema.safeParse({
        version: 1,
        created_at: new Date().toISOString(),
        derivation_salt: new Uint8Array(32),
        status: 'active',
      });
      expect(result.success).toBe(true);
    });

    it('should reject version 0', () => {
      const result = KeyVersionSchema.safeParse({
        version: 0,
        created_at: new Date().toISOString(),
        derivation_salt: new Uint8Array(32),
        status: 'active',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('RotationProgressSchema', () => {
    it('should validate rotation progress', () => {
      const result = RotationProgressSchema.safeParse({
        processed_count: 50,
        total_count: 100,
        last_processed_id: 'node_50',
        started_at: new Date().toISOString(),
        phase: 'reencrypting',
      });
      expect(result.success).toBe(true);
    });

    it('should accept null last_processed_id', () => {
      const result = RotationProgressSchema.safeParse({
        processed_count: 0,
        total_count: 100,
        last_processed_id: null,
        started_at: new Date().toISOString(),
        phase: 'generating',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('RotationConfigSchema', () => {
    it('should validate rotation config', () => {
      const result = RotationConfigSchema.safeParse(DEFAULT_ROTATION_CONFIG);
      expect(result.success).toBe(true);
    });
  });

  describe('ConsentStateSchema', () => {
    it('should validate active consent', () => {
      const result = ConsentStateSchema.safeParse({
        granted: true,
        scope: 'per_conversation',
        granted_at: new Date().toISOString(),
        memories_shared_count: 2,
        memories_shared_ids: ['mem_1', 'mem_2'],
        provider: 'anthropic',
      });
      expect(result.success).toBe(true);
    });

    it('should validate expired consent with expires_at', () => {
      const result = ConsentStateSchema.safeParse({
        granted: true,
        scope: 'time_based',
        granted_at: new Date().toISOString(),
        expires_at: new Date().toISOString(),
        memories_shared_count: 1,
        memories_shared_ids: ['mem_1'],
        provider: 'openai',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ConsentSettingsSchema', () => {
    it('should validate default consent settings', () => {
      const result = ConsentSettingsSchema.safeParse(DEFAULT_CONSENT_SETTINGS);
      expect(result.success).toBe(true);
    });
  });

  describe('RecoveryCodeSchema', () => {
    it('should validate a recovery code', () => {
      const words = Array.from({ length: 24 }, (_, i) => `word${i}`);
      const result = RecoveryCodeSchema.safeParse({
        mnemonic: words,
        version: 1,
        created_at: new Date().toISOString(),
        verified: false,
      });
      expect(result.success).toBe(true);
    });

    it('should reject wrong word count', () => {
      const result = RecoveryCodeSchema.safeParse({
        mnemonic: ['word1', 'word2'],
        version: 1,
        created_at: new Date().toISOString(),
        verified: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ApiCallRouteSchema', () => {
    it('should validate an API call route', () => {
      const result = ApiCallRouteSchema.safeParse({
        key_type: 'platform',
        flow: 'proxied',
        rate_limited: true,
        usage_logged: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('BYOKRateLimitConfigSchema', () => {
    it('should validate default BYOK rate limit', () => {
      const result = BYOKRateLimitConfigSchema.safeParse(DEFAULT_BYOK_RATE_LIMIT);
      expect(result.success).toBe(true);
    });
  });

  describe('ThreatModelEntrySchema', () => {
    it('should validate a threat model entry', () => {
      const result = ThreatModelEntrySchema.safeParse({
        threat: 'test_threat',
        protected_by_standard: true,
        protected_by_private: true,
        description: 'Test description',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('OfflineStateConfigSchema', () => {
    it('should validate an offline state config', () => {
      const result = OfflineStateConfigSchema.safeParse({
        state: 'online',
        max_hours: Infinity,
        functionality: 'full',
        sync_behavior: 'realtime',
        auth_behavior: 'JWT valid',
        private_tier_key_access: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('OfflineCapabilityCheckSchema', () => {
    it('should validate a capability check', () => {
      const result = OfflineCapabilityCheckSchema.safeParse({
        can_read: true,
        can_write: true,
        can_search: true,
        can_sync: true,
        can_use_llm: true,
        reason: 'Full connectivity',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ExportComplianceConfigSchema', () => {
    it('should validate a compliance config', () => {
      const result = ExportComplianceConfigSchema.safeParse({
        region: 'us',
        standard_tier: 'exempt',
        private_tier: 'requires_documentation',
        documentation_required: ['ECCN 5D992'],
        notes: 'Test notes',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('LaunchPhaseSchema', () => {
    it('should validate a launch phase', () => {
      const result = LaunchPhaseSchema.safeParse({
        version: 'v1.0',
        features: ['Feature A'],
        markets: ['US'],
        compliance_requirements: ['None'],
      });
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================
// AUTH MODULE TESTS
// ============================================================

describe('Auth Module', () => {
  describe('PLATFORM_AUTH_CONFIGS', () => {
    it('should have configs for all 4 platforms', () => {
      expect(PLATFORM_AUTH_CONFIGS.ios).toBeDefined();
      expect(PLATFORM_AUTH_CONFIGS.android).toBeDefined();
      expect(PLATFORM_AUTH_CONFIGS.macos).toBeDefined();
      expect(PLATFORM_AUTH_CONFIGS.windows).toBeDefined();
    });

    it('should use native Apple Sign-In on iOS', () => {
      expect(PLATFORM_AUTH_CONFIGS.ios.apple_sign_in).toBe('native');
    });

    it('should use REST API for Apple Sign-In on Android', () => {
      expect(PLATFORM_AUTH_CONFIGS.android.apple_sign_in).toBe('rest_api');
    });

    it('should use OAuth for Google on desktop', () => {
      expect(PLATFORM_AUTH_CONFIGS.macos.google_sign_in).toBe('oauth');
      expect(PLATFORM_AUTH_CONFIGS.windows.google_sign_in).toBe('oauth');
    });

    it('should use Clerk web UI for email on desktop', () => {
      expect(PLATFORM_AUTH_CONFIGS.macos.email_password).toBe('clerk_web');
      expect(PLATFORM_AUTH_CONFIGS.windows.email_password).toBe('clerk_web');
    });

    it('should use Clerk UI for email on mobile', () => {
      expect(PLATFORM_AUTH_CONFIGS.ios.email_password).toBe('clerk_ui');
      expect(PLATFORM_AUTH_CONFIGS.android.email_password).toBe('clerk_ui');
    });
  });

  describe('DEFAULT_SECURITY_CONFIG', () => {
    it('should have brute force protection settings', () => {
      expect(DEFAULT_SECURITY_CONFIG.brute_force_lockout_attempts).toBe(BRUTE_FORCE_LOCKOUT_ATTEMPTS);
      expect(DEFAULT_SECURITY_CONFIG.brute_force_lockout_minutes).toBe(BRUTE_FORCE_LOCKOUT_MINUTES);
      expect(DEFAULT_SECURITY_CONFIG.captcha_after_failures).toBe(CAPTCHA_AFTER_FAILURES);
    });

    it('should enable new device alerts', () => {
      expect(DEFAULT_SECURITY_CONFIG.new_device_email_alert).toBe(true);
    });

    it('should invalidate sessions on password change', () => {
      expect(DEFAULT_SECURITY_CONFIG.invalidate_sessions_on_password_change).toBe(true);
    });

    it('should support MFA options', () => {
      expect(DEFAULT_SECURITY_CONFIG.mfa_options).toContain('totp');
      expect(DEFAULT_SECURITY_CONFIG.mfa_options).toContain('passkey');
    });
  });

  describe('DEFAULT_DESKTOP_CONFIG', () => {
    it('should have deep link scheme', () => {
      expect(DEFAULT_DESKTOP_CONFIG.deep_link_scheme).toBe(DEEP_LINK_SCHEME);
    });

    it('should construct OAuth redirect URI', () => {
      expect(DEFAULT_DESKTOP_CONFIG.oauth_redirect_uri).toBe(
        `${DEEP_LINK_SCHEME}://${AUTH_CALLBACK_PATH}`
      );
    });
  });

  describe('OFFLINE_STATE_TRANSITION_REFERENCE', () => {
    it('should have descriptions for all offline states', () => {
      expect(OFFLINE_STATE_TRANSITION_REFERENCE.online).toBeDefined();
      expect(OFFLINE_STATE_TRANSITION_REFERENCE.short_offline).toBeDefined();
      expect(OFFLINE_STATE_TRANSITION_REFERENCE.medium_offline).toBeDefined();
      expect(OFFLINE_STATE_TRANSITION_REFERENCE.long_offline).toBeDefined();
      expect(OFFLINE_STATE_TRANSITION_REFERENCE.reauth_required).toBeDefined();
    });
  });

  describe('isTokenValid', () => {
    it('should return true for future expiry', () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const tokens: AuthTokens = {
        access_token: 'test',
        refresh_token: 'test',
        expires_at: futureDate,
      };
      expect(isTokenValid(tokens)).toBe(true);
    });

    it('should return false for past expiry', () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const tokens: AuthTokens = {
        access_token: 'test',
        refresh_token: 'test',
        expires_at: pastDate,
      };
      expect(isTokenValid(tokens)).toBe(false);
    });
  });

  describe('shouldReauthenticate', () => {
    it('should return true when offline > medium threshold', () => {
      const pastDate = new Date(Date.now() - (OFFLINE_THRESHOLDS.medium_offline + 1) * 60 * 60 * 1000).toISOString();
      const auth: AuthState = {
        user_id: 'user_1',
        privacy_tier: 'standard',
        tokens: { access_token: 't', refresh_token: 'r', issued_at: pastDate, expires_at: pastDate },
        last_online: pastDate,
        offline_state: 'long_offline',
        device_id: 'dev_1',
      };
      expect(shouldReauthenticate(auth)).toBe(true);
    });

    it('should return false when recently online', () => {
      const recentDate = new Date().toISOString();
      const auth: AuthState = {
        user_id: 'user_1',
        privacy_tier: 'standard',
        tokens: { access_token: 't', refresh_token: 'r', issued_at: recentDate, expires_at: recentDate },
        last_online: recentDate,
        offline_state: 'online',
        device_id: 'dev_1',
      };
      expect(shouldReauthenticate(auth)).toBe(false);
    });
  });

  describe('updateOfflineState', () => {
    it('should return online when very recently online', () => {
      const now = new Date().toISOString();
      const auth: AuthState = {
        user_id: 'user_1',
        privacy_tier: 'standard',
        tokens: { access_token: 't', refresh_token: 'r', issued_at: now, expires_at: new Date(Date.now() + 3600000).toISOString() },
        last_online: now,
        offline_state: 'online',
        device_id: 'dev_1',
      };
      expect(updateOfflineState(auth)).toBe('online');
    });

    it('should return short_offline when token is valid and within 24h', () => {
      const hoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const auth: AuthState = {
        user_id: 'user_1',
        privacy_tier: 'standard',
        tokens: { access_token: 't', refresh_token: 'r', issued_at: hoursAgo, expires_at: new Date(Date.now() + 3600000).toISOString() },
        last_online: hoursAgo,
        offline_state: 'online',
        device_id: 'dev_1',
      };
      expect(updateOfflineState(auth)).toBe('short_offline');
    });

    it('should return medium_offline when beyond 24h but within 168h', () => {
      const daysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const auth: AuthState = {
        user_id: 'user_1',
        privacy_tier: 'standard',
        tokens: { access_token: 't', refresh_token: 'r', issued_at: daysAgo, expires_at: new Date(Date.now() - 3600000).toISOString() },
        last_online: daysAgo,
        offline_state: 'online',
        device_id: 'dev_1',
      };
      expect(updateOfflineState(auth)).toBe('medium_offline');
    });

    it('should return long_offline when beyond 168h', () => {
      const weeksAgo = new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString();
      const auth: AuthState = {
        user_id: 'user_1',
        privacy_tier: 'standard',
        tokens: { access_token: 't', refresh_token: 'r', issued_at: weeksAgo, expires_at: new Date(Date.now() - 3600000).toISOString() },
        last_online: weeksAgo,
        offline_state: 'online',
        device_id: 'dev_1',
      };
      expect(updateOfflineState(auth)).toBe('long_offline');
    });
  });

  describe('getPlatformAuthConfig', () => {
    it('should return config for each platform', () => {
      expect(getPlatformAuthConfig('ios').platform).toBe('ios');
      expect(getPlatformAuthConfig('android').platform).toBe('android');
      expect(getPlatformAuthConfig('macos').platform).toBe('macos');
      expect(getPlatformAuthConfig('windows').platform).toBe('windows');
    });
  });

  describe('External service stubs', () => {
    it('getClerkConfig should throw', () => {
      expect(() => getClerkConfig('ios')).toThrow('Clerk SDK');
    });

    it('validateJWT should throw', async () => {
      await expect(validateJWT('token')).rejects.toThrow('Clerk SDK');
    });
  });
});

// ============================================================
// TIERS MODULE TESTS
// ============================================================

describe('Tiers Module', () => {
  describe('TIER_DEFINITIONS', () => {
    it('should have definitions for both tiers', () => {
      expect(TIER_DEFINITIONS.standard).toBeDefined();
      expect(TIER_DEFINITIONS.private).toBeDefined();
    });

    it('should have correct Standard tier properties', () => {
      const std = TIER_DEFINITIONS.standard;
      expect(std.name).toBe('Standard');
      expect(std.search).toBe('cloud');
      expect(std.llm_access).toBe('direct');
      expect(std.key_management).toBe('none');
    });

    it('should have correct Private tier properties', () => {
      const priv = TIER_DEFINITIONS.private;
      expect(priv.name).toBe('Private');
      expect(priv.search).toBe('client_only');
      expect(priv.llm_access).toBe('explicit_consent');
      expect(priv.key_management).toBe('passkey_derived');
    });

    it('should have honest data protection lists', () => {
      expect(TIER_DEFINITIONS.standard.data_protection.length).toBeGreaterThan(0);
      expect(TIER_DEFINITIONS.standard.data_exposure.length).toBeGreaterThan(0);
      expect(TIER_DEFINITIONS.private.data_protection.length).toBeGreaterThan(0);
      expect(TIER_DEFINITIONS.private.data_exposure.length).toBeGreaterThan(0);
    });
  });

  describe('TIER_COMPARISON_TABLE', () => {
    it('should have 8 comparison features', () => {
      expect(TIER_COMPARISON_TABLE.length).toBe(8);
    });

    it('should include key features', () => {
      const features = TIER_COMPARISON_TABLE.map(c => c.feature);
      expect(features).toContain('Search');
      expect(features).toContain('LLM Features');
      expect(features).toContain('Key Management');
      expect(features).toContain('Recovery Options');
    });
  });

  describe('getTierDefinition', () => {
    it('should return Standard tier definition', () => {
      expect(getTierDefinition('standard').tier).toBe('standard');
    });

    it('should return Private tier definition', () => {
      expect(getTierDefinition('private').tier).toBe('private');
    });
  });

  describe('canMigrateTier', () => {
    it('should allow standard -> private migration', () => {
      expect(canMigrateTier('standard', 'private')).toBe(true);
    });

    it('should allow private -> standard migration', () => {
      expect(canMigrateTier('private', 'standard')).toBe(true);
    });

    it('should not allow same-tier migration', () => {
      expect(canMigrateTier('standard', 'standard')).toBe(false);
      expect(canMigrateTier('private', 'private')).toBe(false);
    });
  });

  describe('estimateMigrationTime', () => {
    it('should estimate ~60s for 1K nodes', () => {
      expect(estimateMigrationTime(1000)).toBe(MIGRATION_RATE_MS_PER_1K_NODES);
    });

    it('should estimate ~120s for 2K nodes', () => {
      expect(estimateMigrationTime(2000)).toBe(2 * MIGRATION_RATE_MS_PER_1K_NODES);
    });

    it('should round up for partial thousands', () => {
      expect(estimateMigrationTime(1500)).toBe(2 * MIGRATION_RATE_MS_PER_1K_NODES);
    });

    it('should handle 0 nodes', () => {
      expect(estimateMigrationTime(0)).toBe(0);
    });
  });

  describe('External service stubs', () => {
    it('startTierMigration should throw', async () => {
      await expect(startTierMigration({
        user_id: 'u1',
        from_tier: 'standard',
        to_tier: 'private',
        initiated_at: new Date().toISOString(),
      })).rejects.toThrow();
    });

    it('getTierMigrationProgress should throw', async () => {
      await expect(getTierMigrationProgress('u1')).rejects.toThrow();
    });
  });
});

// ============================================================
// ENCRYPTION MODULE TESTS
// ============================================================

describe('Encryption Module', () => {
  describe('ENCRYPTION_FIELD_MAP', () => {
    it('should have plaintext fields including id and type', () => {
      expect(ENCRYPTION_FIELD_MAP.plaintext).toContain('id');
      expect(ENCRYPTION_FIELD_MAP.plaintext).toContain('type');
    });

    it('should have encrypted content fields', () => {
      expect(ENCRYPTION_FIELD_MAP.encrypted_content).toContain('content.title');
      expect(ENCRYPTION_FIELD_MAP.encrypted_content).toContain('content.body');
    });

    it('should have encrypted embedding fields', () => {
      expect(ENCRYPTION_FIELD_MAP.encrypted_embedding).toContain('embedding.vector');
    });

    it('should have encrypted metadata fields', () => {
      expect(ENCRYPTION_FIELD_MAP.encrypted_metadata.length).toBeGreaterThan(0);
    });
  });

  describe('Client Search Configs', () => {
    it('should have mobile config with correct max nodes', () => {
      expect(DEFAULT_CLIENT_SEARCH_CONFIG_MOBILE.max_nodes).toBe(PRIVATE_TIER_NODE_LIMITS.mobile);
    });

    it('should have desktop config with correct max nodes', () => {
      expect(DEFAULT_CLIENT_SEARCH_CONFIG_DESKTOP.max_nodes).toBe(PRIVATE_TIER_NODE_LIMITS.desktop);
    });

    it('should have HNSW parameters', () => {
      expect(DEFAULT_CLIENT_SEARCH_CONFIG_MOBILE.hnsw_ef_construction).toBe(200);
      expect(DEFAULT_CLIENT_SEARCH_CONFIG_DESKTOP.hnsw_ef_construction).toBe(200);
    });
  });

  describe('PERFORMANCE_REFERENCE', () => {
    it('should have performance data for node counts', () => {
      expect(PERFORMANCE_REFERENCE).toBeDefined();
    });
  });

  describe('ENCRYPTED_NODES_ADDITIONAL_SQL', () => {
    it('should contain SQL fragment', () => {
      expect(ENCRYPTED_NODES_ADDITIONAL_SQL).toBeDefined();
      expect(typeof ENCRYPTED_NODES_ADDITIONAL_SQL).toBe('string');
    });
  });

  describe('External service stubs', () => {
    it('encryptNode should throw', async () => {
      await expect(encryptNode({} as any, {} as any)).rejects.toThrow();
    });

    it('decryptNode should throw', async () => {
      await expect(decryptNode({} as any, {} as any)).rejects.toThrow();
    });

    it('encryptEmbedding should throw', async () => {
      await expect(encryptEmbedding([], {} as any)).rejects.toThrow();
    });

    it('decryptEmbedding should throw', async () => {
      await expect(decryptEmbedding(new Uint8Array(), {} as any)).rejects.toThrow();
    });

    it('buildLocalSearchIndex should throw', async () => {
      await expect(buildLocalSearchIndex('user1', {} as any)).rejects.toThrow();
    });

    it('searchLocalIndex should throw', async () => {
      await expect(searchLocalIndex({} as any, [], 10)).rejects.toThrow();
    });
  });
});

// ============================================================
// KEYS MODULE TESTS
// ============================================================

describe('Keys Module', () => {
  describe('DEFAULT_MULTI_DEVICE_SYNC', () => {
    it('should use passkey platform sync method', () => {
      expect(DEFAULT_MULTI_DEVICE_SYNC.method).toBe('passkey_platform_sync');
    });

    it('should have sync mechanisms', () => {
      expect(DEFAULT_MULTI_DEVICE_SYNC.sync_mechanisms).toEqual(PASSKEY_SYNC_MECHANISMS);
    });
  });

  describe('createDerivationParams', () => {
    it('should create params for content key', () => {
      const salt = new Uint8Array(32);
      const params = createDerivationParams('content', salt);
      expect(params.algorithm).toBe('HKDF');
      expect(params.hash).toBe('SHA-256');
      expect(params.info).toBe('nous-content');
      expect(params.key_length).toBe(MASTER_KEY_LENGTH_BITS);
      expect(params.salt).toBe(salt);
    });

    it('should create params for embedding key', () => {
      const salt = new Uint8Array(32);
      const params = createDerivationParams('embedding', salt);
      expect(params.info).toBe('nous-embedding');
    });

    it('should create params for metadata key', () => {
      const salt = new Uint8Array(32);
      const params = createDerivationParams('metadata', salt);
      expect(params.info).toBe('nous-metadata');
    });
  });

  describe('DEFAULT_ROTATION_CONFIG', () => {
    it('should have correct batch size', () => {
      expect(DEFAULT_ROTATION_CONFIG.batch_size).toBe(ROTATION_BATCH_SIZE);
    });

    it('should have correct pause between batches', () => {
      expect(DEFAULT_ROTATION_CONFIG.pause_between_batches_ms).toBe(ROTATION_PAUSE_BETWEEN_BATCHES_MS);
    });

    it('should require wifi and charging', () => {
      expect(DEFAULT_ROTATION_CONFIG.require_wifi).toBe(true);
      expect(DEFAULT_ROTATION_CONFIG.require_charging).toBe(true);
    });

    it('should persist progress and auto-resume', () => {
      expect(DEFAULT_ROTATION_CONFIG.persist_progress).toBe(true);
      expect(DEFAULT_ROTATION_CONFIG.auto_resume_on_launch).toBe(true);
    });

    it('should have minimum battery level', () => {
      expect(DEFAULT_ROTATION_CONFIG.min_battery_level).toBe(ROTATION_MIN_BATTERY_LEVEL);
    });
  });

  describe('ROTATION_TIMING_REFERENCE', () => {
    it('should match ROTATION_TIMING_ESTIMATES', () => {
      expect(ROTATION_TIMING_REFERENCE).toBe(ROTATION_TIMING_ESTIMATES);
    });
  });

  describe('Key derivation stubs', () => {
    it('deriveMasterKey should throw', async () => {
      await expect(deriveMasterKey(new Uint8Array(), new Uint8Array())).rejects.toThrow('Web Crypto API');
    });

    it('deriveContentKey should throw', async () => {
      await expect(deriveContentKey({} as CryptoKey)).rejects.toThrow('Web Crypto API');
    });

    it('deriveEmbeddingKey should throw', async () => {
      await expect(deriveEmbeddingKey({} as CryptoKey)).rejects.toThrow('Web Crypto API');
    });

    it('deriveMetadataKey should throw', async () => {
      await expect(deriveMetadataKey({} as CryptoKey)).rejects.toThrow('Web Crypto API');
    });

    it('deriveAllKeys should throw', async () => {
      await expect(deriveAllKeys({} as CryptoKey)).rejects.toThrow('Web Crypto API');
    });

    it('generateSalt should throw', () => {
      expect(() => generateSalt()).toThrow('Web Crypto API');
    });
  });

  describe('Key rotation stubs', () => {
    it('initiateKeyRotation should throw', async () => {
      await expect(initiateKeyRotation('user1', 'manual')).rejects.toThrow();
    });

    it('backgroundReencrypt should throw', async () => {
      await expect(backgroundReencrypt({} as CryptoKey, {} as CryptoKey, {} as any)).rejects.toThrow();
    });

    it('getNodesNeedingRotation should throw', async () => {
      await expect(getNodesNeedingRotation(null)).rejects.toThrow();
    });

    it('canContinueRotation should throw', async () => {
      await expect(canContinueRotation()).rejects.toThrow();
    });

    it('saveRotationProgress should throw', async () => {
      await expect(saveRotationProgress({} as any)).rejects.toThrow();
    });

    it('resumeRotation should throw', async () => {
      await expect(resumeRotation('user1')).rejects.toThrow();
    });

    it('verifyRotation should throw', async () => {
      await expect(verifyRotation({} as CryptoKey, 5)).rejects.toThrow();
    });

    it('completeRotation should throw', async () => {
      await expect(completeRotation('user1')).rejects.toThrow();
    });

    it('getKeyVersionForNode should throw', () => {
      expect(() => getKeyVersionForNode({} as any, {} as any)).toThrow();
    });
  });
});

// ============================================================
// RECOVERY MODULE TESTS
// ============================================================

describe('Recovery Module', () => {
  describe('Recovery constants', () => {
    it('should have correct derivation info', () => {
      expect(RECOVERY_DERIVATION_INFO).toBe('nous-recovery');
    });

    it('should have 32-byte key length', () => {
      expect(RECOVERY_KEY_LENGTH_BYTES).toBe(32);
    });

    it('should have reminder messages for all types', () => {
      expect(RECOVERY_REMINDER_MESSAGES.initial).toBeDefined();
      expect(RECOVERY_REMINDER_MESSAGES.periodic).toBeDefined();
      expect(RECOVERY_REMINDER_MESSAGES.new_device).toBeDefined();
    });

    it('should have old code error message with date placeholder', () => {
      expect(OLD_CODE_ERROR_MESSAGE).toContain('{date}');
    });
  });

  describe('getVerificationIndices', () => {
    it('should return exactly 3 indices', () => {
      const indices = getVerificationIndices();
      expect(indices.length).toBe(3);
    });

    it('should return indices in range 0-23', () => {
      const indices = getVerificationIndices();
      for (const idx of indices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(24);
      }
    });

    it('should return unique indices', () => {
      const indices = getVerificationIndices();
      const unique = new Set(indices);
      expect(unique.size).toBe(3);
    });

    it('should return sorted indices', () => {
      const indices = getVerificationIndices();
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    });
  });

  describe('verifyRecoveryWords', () => {
    const mnemonic = Array.from({ length: 24 }, (_, i) => `word${i}`);

    it('should return true for correct words', () => {
      const indices = [0, 5, 10];
      const answers = ['word0', 'word5', 'word10'];
      expect(verifyRecoveryWords(mnemonic, indices, answers)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const indices = [0, 5, 10];
      const answers = ['WORD0', 'Word5', 'wOrD10'];
      expect(verifyRecoveryWords(mnemonic, indices, answers)).toBe(true);
    });

    it('should return false for wrong words', () => {
      const indices = [0, 5, 10];
      const answers = ['wrong', 'word5', 'word10'];
      expect(verifyRecoveryWords(mnemonic, indices, answers)).toBe(false);
    });

    it('should return false for mismatched array lengths', () => {
      const indices = [0, 5, 10];
      const answers = ['word0', 'word5'];
      expect(verifyRecoveryWords(mnemonic, indices, answers)).toBe(false);
    });

    it('should handle empty arrays', () => {
      expect(verifyRecoveryWords(mnemonic, [], [])).toBe(true);
    });
  });

  describe('External service stubs', () => {
    it('generateRecoveryCode should throw', () => {
      expect(() => generateRecoveryCode()).toThrow('BIP39');
    });

    it('deriveRecoveryKey should throw', async () => {
      await expect(deriveRecoveryKey([])).rejects.toThrow('BIP39');
    });

    it('encryptMasterKeyForRecovery should throw', async () => {
      await expect(encryptMasterKeyForRecovery({} as CryptoKey, {} as CryptoKey)).rejects.toThrow('Web Crypto API');
    });

    it('recoverMasterKey should throw', async () => {
      await expect(recoverMasterKey([], new Uint8Array())).rejects.toThrow('BIP39');
    });

    it('regenerateRecoveryCode should throw', async () => {
      await expect(regenerateRecoveryCode('u1', {} as CryptoKey)).rejects.toThrow('BIP39');
    });

    it('isGracePeriodActive should throw', async () => {
      await expect(isGracePeriodActive('u1')).rejects.toThrow('server-side');
    });

    it('recoverViaEmail should throw', async () => {
      await expect(recoverViaEmail('u1', 'token')).rejects.toThrow('server-side');
    });

    it('getRecoveryReminder should throw', () => {
      expect(() => getRecoveryReminder('u1')).toThrow('server-side');
    });

    it('dismissRecoveryReminder should throw', async () => {
      await expect(dismissRecoveryReminder('u1', 'initial')).rejects.toThrow('server-side');
    });
  });
});

// ============================================================
// CONSENT MODULE TESTS
// ============================================================

describe('Consent Module', () => {
  describe('DEFAULT_CONSENT_SETTINGS', () => {
    it('should default to per_conversation scope', () => {
      expect(DEFAULT_CONSENT_SETTINGS.default_scope).toBe('per_conversation');
    });

    it('should have 24h time-based duration', () => {
      expect(DEFAULT_CONSENT_SETTINGS.time_based_duration).toBe('24h');
    });

    it('should have 0.85 similarity threshold', () => {
      expect(DEFAULT_CONSENT_SETTINGS.topic_similarity_threshold).toBe(0.85);
    });

    it('should start with empty remembered topics', () => {
      expect(DEFAULT_CONSENT_SETTINGS.remembered_topics).toEqual([]);
    });

    it('should require explicit consent for sensitive content', () => {
      expect(DEFAULT_CONSENT_SETTINGS.require_explicit_for_sensitive).toBe(true);
    });
  });

  describe('DECLINE_MESSAGE', () => {
    it('should be a non-empty string', () => {
      expect(DECLINE_MESSAGE.length).toBeGreaterThan(0);
    });

    it('should mention limited capabilities', () => {
      expect(DECLINE_MESSAGE).toContain('general questions');
    });
  });

  describe('isConsentActive', () => {
    it('should return false when not granted', () => {
      expect(isConsentActive({
        granted: false,
        scope: 'per_conversation',
        granted_at: new Date().toISOString(),
        memories_shared_count: 0,
        memories_shared_ids: [],
        provider: 'anthropic',
      })).toBe(false);
    });

    it('should return true for active per_conversation consent', () => {
      expect(isConsentActive({
        granted: true,
        scope: 'per_conversation',
        granted_at: new Date().toISOString(),
        memories_shared_count: 1,
        memories_shared_ids: ['m1'],
        provider: 'anthropic',
      })).toBe(true);
    });

    it('should return false for per_message scope (always requires new consent)', () => {
      expect(isConsentActive({
        granted: true,
        scope: 'per_message',
        granted_at: new Date().toISOString(),
        memories_shared_count: 1,
        memories_shared_ids: ['m1'],
        provider: 'anthropic',
      })).toBe(false);
    });

    it('should return false for expired time_based consent', () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      expect(isConsentActive({
        granted: true,
        scope: 'time_based',
        granted_at: pastDate,
        expires_at: pastDate,
        memories_shared_count: 1,
        memories_shared_ids: ['m1'],
        provider: 'anthropic',
      })).toBe(false);
    });

    it('should return true for non-expired time_based consent', () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      expect(isConsentActive({
        granted: true,
        scope: 'time_based',
        granted_at: new Date().toISOString(),
        expires_at: futureDate,
        memories_shared_count: 1,
        memories_shared_ids: ['m1'],
        provider: 'anthropic',
      })).toBe(true);
    });
  });

  describe('handleDecline', () => {
    it('should return declined result', () => {
      const result = handleDecline('user1');
      expect(result.declined).toBe(true);
    });

    it('should include available actions', () => {
      const result = handleDecline('user1');
      expect(result.available_actions.length).toBeGreaterThan(0);
      expect(result.available_actions).toEqual([...DECLINE_ACTIONS]);
    });

    it('should not have previous context available', () => {
      const result = handleDecline('user1');
      expect(result.previous_context_available).toBe(false);
    });

    it('should include decline message', () => {
      const result = handleDecline('user1');
      expect(result.message).toBe(DECLINE_MESSAGE);
    });
  });

  describe('checkTopicMatch', () => {
    it('should return null for empty topics', () => {
      expect(checkTopicMatch([1, 0, 0], [])).toBeNull();
    });

    it('should match identical vectors', () => {
      const embedding = [1, 0, 0];
      const topics = [{
        label: 'test',
        topic_embedding: [1, 0, 0],
        consented_at: new Date().toISOString(),
        query_count: 0,
      }];
      const match = checkTopicMatch(embedding, topics);
      expect(match).not.toBeNull();
      expect(match!.label).toBe('test');
    });

    it('should not match orthogonal vectors', () => {
      const embedding = [1, 0, 0];
      const topics = [{
        label: 'test',
        topic_embedding: [0, 1, 0],
        consented_at: new Date().toISOString(),
        query_count: 0,
      }];
      expect(checkTopicMatch(embedding, topics)).toBeNull();
    });

    it('should return best match when multiple topics match', () => {
      const embedding = [1, 0.1, 0];
      const topics = [
        {
          label: 'partial',
          topic_embedding: [0.9, 0.4, 0.1],
          consented_at: new Date().toISOString(),
          query_count: 0,
        },
        {
          label: 'close',
          topic_embedding: [1, 0.1, 0],
          consented_at: new Date().toISOString(),
          query_count: 0,
        },
      ];
      const match = checkTopicMatch(embedding, topics);
      expect(match).not.toBeNull();
      expect(match!.label).toBe('close');
    });

    it('should respect custom threshold', () => {
      const embedding = [1, 0, 0];
      const topics = [{
        label: 'test',
        topic_embedding: [0.9, 0.3, 0.1],
        consented_at: new Date().toISOString(),
        query_count: 0,
      }];
      // Very high threshold should reject
      expect(checkTopicMatch(embedding, topics, 0.99)).toBeNull();
      // Very low threshold should accept
      expect(checkTopicMatch(embedding, topics, 0.5)).not.toBeNull();
    });
  });

  describe('External service stubs', () => {
    it('requestConsent should throw', async () => {
      await expect(requestConsent('u1', ['m1'], 'anthropic')).rejects.toThrow();
    });

    it('grantConsent should throw', async () => {
      await expect(grantConsent('u1', 'per_conversation', ['m1'])).rejects.toThrow();
    });

    it('checkConsent should throw', async () => {
      await expect(checkConsent('u1', [1, 0, 0])).rejects.toThrow();
    });

    it('revokeConsent should throw', async () => {
      await expect(revokeConsent('u1', {} as any)).rejects.toThrow();
    });

    it('getSharedMemories should throw', async () => {
      await expect(getSharedMemories('u1', 'conv1')).rejects.toThrow();
    });

    it('updateConsentSettings should throw', async () => {
      await expect(updateConsentSettings('u1', {})).rejects.toThrow();
    });
  });
});

// ============================================================
// API KEYS MODULE TESTS
// ============================================================

describe('API Keys Module', () => {
  describe('API_CALL_ROUTES', () => {
    it('should have platform route as proxied', () => {
      expect(API_CALL_ROUTES.platform.flow).toBe('proxied');
      expect(API_CALL_ROUTES.platform.rate_limited).toBe(true);
      expect(API_CALL_ROUTES.platform.usage_logged).toBe(true);
    });

    it('should have byok route as direct', () => {
      expect(API_CALL_ROUTES.byok.flow).toBe('direct');
      expect(API_CALL_ROUTES.byok.rate_limited).toBe(true);
      expect(API_CALL_ROUTES.byok.usage_logged).toBe(false);
    });
  });

  describe('DEFAULT_BYOK_RATE_LIMIT', () => {
    it('should have correct rate limit values', () => {
      expect(DEFAULT_BYOK_RATE_LIMIT.max_decryptions_per_minute).toBe(BYOK_MAX_DECRYPTIONS_PER_MINUTE);
      expect(DEFAULT_BYOK_RATE_LIMIT.exponential_backoff).toBe(true);
      expect(DEFAULT_BYOK_RATE_LIMIT.lockout_after_failures).toBe(BYOK_LOCKOUT_AFTER_FAILURES);
      expect(DEFAULT_BYOK_RATE_LIMIT.lockout_duration_minutes).toBe(BYOK_LOCKOUT_DURATION_MINUTES);
    });
  });

  describe('getApiCallRouteForKeyType', () => {
    it('should return platform route', () => {
      const route = getApiCallRouteForKeyType('platform');
      expect(route.key_type).toBe('platform');
      expect(route.flow).toBe('proxied');
    });

    it('should return byok route', () => {
      const route = getApiCallRouteForKeyType('byok');
      expect(route.key_type).toBe('byok');
      expect(route.flow).toBe('direct');
    });
  });

  describe('External service stubs', () => {
    it('encryptBYOKKey should throw', async () => {
      await expect(encryptBYOKKey('key', {} as CryptoKey)).rejects.toThrow('Web Crypto API');
    });

    it('decryptBYOKKey should throw', async () => {
      await expect(decryptBYOKKey(new Uint8Array(), {} as CryptoKey)).rejects.toThrow('Web Crypto API');
    });

    it('getApiCallRoute should throw', async () => {
      await expect(getApiCallRoute('u1', 'anthropic')).rejects.toThrow();
    });

    it('checkBYOKRateLimit should throw', async () => {
      await expect(checkBYOKRateLimit('u1')).rejects.toThrow();
    });

    it('trackBYOKDecryption should throw', () => {
      expect(() => trackBYOKDecryption('u1', true)).toThrow();
    });

    it('rotatePlatformKey should throw', async () => {
      await expect(rotatePlatformKey('anthropic')).rejects.toThrow();
    });

    it('getBYOKConfig should throw', async () => {
      await expect(getBYOKConfig('u1', 'anthropic')).rejects.toThrow();
    });

    it('storeBYOKKey should throw', async () => {
      await expect(storeBYOKKey('u1', 'anthropic', 'key', 'private')).rejects.toThrow();
    });

    it('revokeBYOKKey should throw', async () => {
      await expect(revokeBYOKKey('u1', 'anthropic')).rejects.toThrow();
    });
  });
});

// ============================================================
// COMPLIANCE MODULE TESTS
// ============================================================

describe('Compliance Module', () => {
  describe('THREAT_MODEL', () => {
    it('should have 8 threat entries', () => {
      expect(THREAT_MODEL.length).toBe(8);
    });

    it('should include threats we protect against', () => {
      const threats = THREAT_MODEL.map(t => t.threat);
      expect(threats).toContain('random_hackers');
      expect(threats).toContain('data_breaches');
    });

    it('should include threats we do NOT protect against', () => {
      const threats = THREAT_MODEL.map(t => t.threat);
      expect(threats).toContain('device_malware');
      expect(threats).toContain('state_level_actors');
      expect(threats).toContain('llm_provider');
    });

    it('should have Private tier protecting against curious employees', () => {
      const entry = THREAT_MODEL.find(t => t.threat === 'curious_employees');
      expect(entry).toBeDefined();
      expect(entry!.protected_by_standard).toBe(false);
      expect(entry!.protected_by_private).toBe(true);
    });

    it('should have Private tier protecting against subpoenas', () => {
      const entry = THREAT_MODEL.find(t => t.threat === 'legal_subpoenas');
      expect(entry).toBeDefined();
      expect(entry!.protected_by_standard).toBe(false);
      expect(entry!.protected_by_private).toBe(true);
    });
  });

  describe('EXPORT_COMPLIANCE_BY_REGION', () => {
    it('should have 3 regions', () => {
      expect(EXPORT_COMPLIANCE_BY_REGION.length).toBe(3);
    });

    it('should have US region', () => {
      const us = EXPORT_COMPLIANCE_BY_REGION.find(c => c.region === 'us');
      expect(us).toBeDefined();
      expect(us!.standard_tier).toBe('exempt');
      expect(us!.private_tier).toBe('requires_documentation');
    });

    it('should exclude France from Private tier at launch', () => {
      const france = EXPORT_COMPLIANCE_BY_REGION.find(c => c.region === 'france');
      expect(france).toBeDefined();
      expect(france!.private_tier).toBe('excluded');
    });
  });

  describe('LAUNCH_STRATEGY', () => {
    it('should have 3 phases', () => {
      expect(LAUNCH_STRATEGY.length).toBe(3);
    });

    it('should start with v1.0 Standard only', () => {
      expect(LAUNCH_STRATEGY[0].version).toBe('v1.0');
      expect(LAUNCH_STRATEGY[0].features).toContain('Standard tier only');
    });

    it('should add Private tier in v1.1', () => {
      expect(LAUNCH_STRATEGY[1].version).toBe('v1.1');
      expect(LAUNCH_STRATEGY[1].features).toContain('Add Private tier');
    });

    it('should add France in v1.2', () => {
      expect(LAUNCH_STRATEGY[2].version).toBe('v1.2');
      expect(LAUNCH_STRATEGY[2].features).toContain('Add France support for Private tier');
    });
  });

  describe('APP_STORE_DECLARATIONS', () => {
    it('should have standard_only declarations for all platforms', () => {
      expect(APP_STORE_DECLARATIONS.standard_only.length).toBe(4);
    });

    it('should have with_private_tier declarations for all platforms', () => {
      expect(APP_STORE_DECLARATIONS.with_private_tier.length).toBe(4);
    });

    it('should not use non-exempt encryption for standard only', () => {
      for (const decl of APP_STORE_DECLARATIONS.standard_only) {
        expect(decl.uses_non_exempt_encryption).toBe(false);
      }
    });

    it('should use non-exempt encryption for private tier', () => {
      for (const decl of APP_STORE_DECLARATIONS.with_private_tier) {
        expect(decl.uses_non_exempt_encryption).toBe(true);
        expect(decl.eccn).toBe(ECCN_CLASSIFICATION);
      }
    });
  });

  describe('getComplianceRequirements', () => {
    it('should return US config for us region', () => {
      const config = getComplianceRequirements('standard', 'us');
      expect(config.region).toBe('us');
    });

    it('should return France config for france region', () => {
      const config = getComplianceRequirements('private', 'france');
      expect(config.region).toBe('france');
    });

    it('should fall back to general for unknown regions', () => {
      const config = getComplianceRequirements('standard', 'germany');
      expect(config.region).toBe('general');
    });
  });

  describe('getThreatModel', () => {
    it('should return a copy of the threat model', () => {
      const model = getThreatModel();
      expect(model).toEqual(THREAT_MODEL);
      expect(model).not.toBe(THREAT_MODEL); // Should be a copy
    });
  });

  describe('getLaunchStrategy', () => {
    it('should return a copy of the launch strategy', () => {
      const strategy = getLaunchStrategy();
      expect(strategy).toEqual(LAUNCH_STRATEGY);
      expect(strategy).not.toBe(LAUNCH_STRATEGY);
    });
  });

  describe('isRegionSupported', () => {
    it('should support standard tier everywhere', () => {
      expect(isRegionSupported('us', 'standard')).toBe(true);
      expect(isRegionSupported('france', 'standard')).toBe(true);
      expect(isRegionSupported('unknown', 'standard')).toBe(true);
    });

    it('should support private tier in US and general', () => {
      expect(isRegionSupported('us', 'private')).toBe(true);
      expect(isRegionSupported('general', 'private')).toBe(true);
    });

    it('should NOT support private tier in France', () => {
      expect(isRegionSupported('france', 'private')).toBe(false);
    });

    it('should support unknown regions (fallback to general)', () => {
      expect(isRegionSupported('brazil', 'private')).toBe(true);
    });
  });

  describe('getAppStoreDeclaration', () => {
    it('should return standard-only iOS declaration', () => {
      const decl = getAppStoreDeclaration('ios', false);
      expect(decl.platform).toBe('ios');
      expect(decl.uses_non_exempt_encryption).toBe(false);
    });

    it('should return private-tier Android declaration', () => {
      const decl = getAppStoreDeclaration('android', true);
      expect(decl.platform).toBe('android');
      expect(decl.uses_non_exempt_encryption).toBe(true);
      expect(decl.eccn).toBe(ECCN_CLASSIFICATION);
    });
  });

  describe('getProtectedThreats', () => {
    it('should return threats Standard tier protects against', () => {
      const threats = getProtectedThreats('standard');
      const names = threats.map(t => t.threat);
      expect(names).toContain('random_hackers');
      expect(names).toContain('data_breaches');
      expect(names).not.toContain('curious_employees');
    });

    it('should return threats Private tier protects against', () => {
      const threats = getProtectedThreats('private');
      const names = threats.map(t => t.threat);
      expect(names).toContain('random_hackers');
      expect(names).toContain('data_breaches');
      expect(names).toContain('curious_employees');
      expect(names).toContain('legal_subpoenas');
    });
  });

  describe('getUnprotectedThreats', () => {
    it('should return threats Standard tier does NOT protect against', () => {
      const threats = getUnprotectedThreats('standard');
      const names = threats.map(t => t.threat);
      expect(names).toContain('curious_employees');
      expect(names).toContain('device_malware');
      expect(names).toContain('state_level_actors');
    });

    it('should return threats Private tier does NOT protect against', () => {
      const threats = getUnprotectedThreats('private');
      const names = threats.map(t => t.threat);
      expect(names).toContain('device_malware');
      expect(names).toContain('state_level_actors');
      expect(names).not.toContain('curious_employees');
    });
  });
});

// ============================================================
// OFFLINE MODULE TESTS
// ============================================================

describe('Offline Module', () => {
  describe('OFFLINE_STATE_CONFIGS', () => {
    it('should have configs for all 5 states', () => {
      expect(OFFLINE_STATE_CONFIGS.online).toBeDefined();
      expect(OFFLINE_STATE_CONFIGS.short_offline).toBeDefined();
      expect(OFFLINE_STATE_CONFIGS.medium_offline).toBeDefined();
      expect(OFFLINE_STATE_CONFIGS.long_offline).toBeDefined();
      expect(OFFLINE_STATE_CONFIGS.reauth_required).toBeDefined();
    });

    it('should have full functionality when online', () => {
      expect(OFFLINE_STATE_CONFIGS.online.functionality).toBe('full');
      expect(OFFLINE_STATE_CONFIGS.online.sync_behavior).toBe('realtime');
    });

    it('should have queued sync for short offline', () => {
      expect(OFFLINE_STATE_CONFIGS.short_offline.sync_behavior).toBe('queued');
    });

    it('should have no sync for long offline', () => {
      expect(OFFLINE_STATE_CONFIGS.long_offline.sync_behavior).toBe('none');
    });

    it('should always allow private tier key access', () => {
      for (const state of OFFLINE_STATES) {
        expect(OFFLINE_STATE_CONFIGS[state].private_tier_key_access).toBe(true);
      }
    });
  });

  describe('getOfflineStateConfig', () => {
    it('should return config for each state', () => {
      for (const state of OFFLINE_STATES) {
        const config = getOfflineStateConfig(state);
        expect(config.state).toBe(state);
      }
    });
  });

  describe('calculateOfflineState', () => {
    it('should return online for very recent time', () => {
      const now = new Date().toISOString();
      const tokens: AuthTokens = {
        access_token: 't',
        refresh_token: 'r',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };
      expect(calculateOfflineState(now, tokens)).toBe('online');
    });

    it('should return short_offline with valid token and < 24h', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const tokens: AuthTokens = {
        access_token: 't',
        refresh_token: 'r',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };
      expect(calculateOfflineState(twoHoursAgo, tokens)).toBe('short_offline');
    });

    it('should return medium_offline between 24h-168h', () => {
      const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      const tokens: AuthTokens = {
        access_token: 't',
        refresh_token: 'r',
        expires_at: new Date(Date.now() - 3600000).toISOString(),
      };
      expect(calculateOfflineState(threeDaysAgo, tokens)).toBe('medium_offline');
    });

    it('should return long_offline after 168h', () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const tokens: AuthTokens = {
        access_token: 't',
        refresh_token: 'r',
        expires_at: new Date(Date.now() - 3600000).toISOString(),
      };
      expect(calculateOfflineState(twoWeeksAgo, tokens)).toBe('long_offline');
    });
  });

  describe('getOfflineCapabilities', () => {
    it('should return full capabilities when online', () => {
      const caps = getOfflineCapabilities('online', 'standard');
      expect(caps.can_read).toBe(true);
      expect(caps.can_write).toBe(true);
      expect(caps.can_search).toBe(true);
      expect(caps.can_sync).toBe(true);
      expect(caps.can_use_llm).toBe(true);
    });

    it('should allow search in short_offline for private tier only', () => {
      expect(getOfflineCapabilities('short_offline', 'private').can_search).toBe(true);
      expect(getOfflineCapabilities('short_offline', 'standard').can_search).toBe(false);
    });

    it('should allow write in short_offline', () => {
      expect(getOfflineCapabilities('short_offline', 'standard').can_write).toBe(true);
    });

    it('should not allow write in long_offline', () => {
      expect(getOfflineCapabilities('long_offline', 'standard').can_write).toBe(false);
    });

    it('should not allow sync in any offline state', () => {
      expect(getOfflineCapabilities('short_offline', 'standard').can_sync).toBe(false);
      expect(getOfflineCapabilities('medium_offline', 'standard').can_sync).toBe(false);
      expect(getOfflineCapabilities('long_offline', 'standard').can_sync).toBe(false);
    });

    it('should not allow LLM in any offline state', () => {
      expect(getOfflineCapabilities('short_offline', 'standard').can_use_llm).toBe(false);
      expect(getOfflineCapabilities('medium_offline', 'standard').can_use_llm).toBe(false);
      expect(getOfflineCapabilities('long_offline', 'standard').can_use_llm).toBe(false);
    });

    it('should always allow read', () => {
      for (const state of OFFLINE_STATES) {
        expect(getOfflineCapabilities(state, 'standard').can_read).toBe(true);
      }
    });

    it('should allow private tier search in all offline states', () => {
      for (const state of OFFLINE_STATES) {
        if (state === 'online') continue; // Online always has search for both tiers
        expect(getOfflineCapabilities(state, 'private').can_search).toBe(true);
      }
    });
  });

  describe('External service stubs', () => {
    it('queueOfflineOperation should throw', async () => {
      await expect(queueOfflineOperation({} as any)).rejects.toThrow('persistent queue');
    });

    it('processOfflineQueue should throw', async () => {
      await expect(processOfflineQueue()).rejects.toThrow('network');
    });

    it('getQueueSize should throw', async () => {
      await expect(getQueueSize()).rejects.toThrow('persistent queue');
    });
  });
});
