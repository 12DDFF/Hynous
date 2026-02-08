import { z } from 'zod';

// src/security/constants.ts
var PRIVACY_TIERS = ["standard", "private"];
var PrivacyTierSchema = z.enum(PRIVACY_TIERS);
function isPrivacyTier(value) {
  return PRIVACY_TIERS.includes(value);
}
var AUTH_PROVIDERS = ["clerk"];
var AuthProviderSchema = z.enum(AUTH_PROVIDERS);
var AUTH_METHODS = ["apple", "google", "email_password"];
var AuthMethodSchema = z.enum(AUTH_METHODS);
var PLATFORMS = ["ios", "android", "macos", "windows"];
var PlatformSchema = z.enum(PLATFORMS);
function isPlatform(value) {
  return PLATFORMS.includes(value);
}
var OFFLINE_STATES = [
  "online",
  "short_offline",
  "medium_offline",
  "long_offline",
  "reauth_required"
];
var OfflineStateSchema = z.enum(OFFLINE_STATES);
function isOfflineState(value) {
  return OFFLINE_STATES.includes(value);
}
var OFFLINE_THRESHOLDS = {
  /** <24h since last online: JWT still valid, full functionality */
  short_offline: 24,
  /** <7d (168h) since last online: JWT expired, read-only + queued writes */
  medium_offline: 168,
  /** >7d: refresh token expired, local data only */
  long_offline: Infinity
};
var CONSENT_SCOPES = [
  "per_message",
  "per_conversation",
  "time_based",
  "topic_based"
];
var ConsentScopeSchema = z.enum(CONSENT_SCOPES);
function isConsentScope(value) {
  return CONSENT_SCOPES.includes(value);
}
var DEFAULT_CONSENT_SCOPE = "per_conversation";
var CONVERSATION_TIMEOUT_MINUTES = 30;
var TOPIC_SIMILARITY_THRESHOLD = 0.85;
var CONSENT_DURATIONS = ["1h", "24h", "7d"];
var ConsentDurationSchema = z.enum(CONSENT_DURATIONS);
var CONSENT_REVOCATION_SCOPES = [
  "this_conversation",
  "all_active",
  "everything"
];
var ConsentRevocationScopeSchema = z.enum(CONSENT_REVOCATION_SCOPES);
var ENCRYPTION_ALGORITHM = "AES-256-GCM";
var KEY_DERIVATION_FUNCTION = "HKDF-SHA256";
var MASTER_KEY_LENGTH_BITS = 256;
var NONCE_LENGTH_BYTES = 12;
var KEY_PURPOSES = ["content", "embedding", "metadata"];
var KeyPurposeSchema = z.enum(KEY_PURPOSES);
var DERIVATION_INFO_STRINGS = {
  content: "nous-content",
  embedding: "nous-embedding",
  metadata: "nous-metadata"
};
var ROTATION_BATCH_SIZE = 100;
var ROTATION_PAUSE_BETWEEN_BATCHES_MS = 500;
var ROTATION_MAX_BATCHES_PER_MINUTE = 60;
var ROTATION_MIN_BATTERY_LEVEL = 20;
var DEPRECATED_KEY_RETENTION_DAYS = 30;
var ROTATION_VERIFICATION_SAMPLE_PERCENT = 5;
var KEY_VERSION_STATUSES = ["active", "rotating", "deprecated", "expired"];
var KeyVersionStatusSchema = z.enum(KEY_VERSION_STATUSES);
function isKeyVersionStatus(value) {
  return KEY_VERSION_STATUSES.includes(value);
}
var KEY_ROTATION_TRIGGERS = [
  "passkey_change",
  "scheduled",
  "security_incident",
  "recovery_used"
];
var KeyRotationTriggerSchema = z.enum(KEY_ROTATION_TRIGGERS);
var SCHEDULED_ROTATION_MONTHS = 12;
var ROTATION_TIMING_ESTIMATES = {
  "1k": { reencrypt_seconds: 30, background_minutes: 2 },
  "10k": { reencrypt_seconds: 300, background_minutes: 15 },
  "50k": { reencrypt_seconds: 1500, background_minutes: 60 }
};
var ROTATION_PHASES = ["generating", "reencrypting", "verifying", "completing"];
var RotationPhaseSchema = z.enum(ROTATION_PHASES);
var ROTATION_EVENT_TYPES = [
  "rotation:started",
  "rotation:progress",
  "rotation:paused",
  "rotation:resumed",
  "rotation:completed",
  "rotation:failed"
];
var RotationEventTypeSchema = z.enum(ROTATION_EVENT_TYPES);
var RECOVERY_WORD_COUNT = 24;
var RECOVERY_VERIFICATION_WORD_COUNT = 3;
var RECOVERY_VERIFICATION_ATTEMPT_LIMIT = 3;
var GRACE_PERIOD_DAYS = 7;
var RECOVERY_REMINDER_DAYS = [30, 180];
var RECOVERY_METHODS = [
  "multi_device",
  "recovery_code",
  "grace_period"
];
var RecoveryMethodSchema = z.enum(RECOVERY_METHODS);
var RECOVERY_REMINDER_TYPES = ["initial", "periodic", "new_device"];
var RecoveryReminderTypeSchema = z.enum(RECOVERY_REMINDER_TYPES);
var ACCESS_TOKEN_EXPIRY_MINUTES = 15;
var REFRESH_TOKEN_EXPIRY_DAYS = 30;
var BYOK_MAX_DECRYPTIONS_PER_MINUTE = 5;
var BYOK_LOCKOUT_AFTER_FAILURES = 10;
var BYOK_LOCKOUT_DURATION_MINUTES = 30;
var PRIVATE_TIER_NODE_LIMITS = {
  mobile: 5e4,
  desktop: 1e5
};
var CLIENT_SEARCH_PERFORMANCE = {
  /** Time to decrypt per 1K nodes (milliseconds) */
  decrypt_time_ms_per_1k: 100,
  /** Time to build HNSW index per 1K nodes (milliseconds) */
  index_build_time_ms_per_1k: 200,
  /** Search latency by node count (milliseconds) */
  search_latency_ms: {
    "10k": 20,
    "50k": 40,
    "100k": 60
  },
  /** Memory usage per 10K nodes (megabytes) */
  memory_mb_per_10k: 130
};
var BRUTE_FORCE_LOCKOUT_ATTEMPTS = 5;
var BRUTE_FORCE_LOCKOUT_MINUTES = 15;
var CAPTCHA_AFTER_FAILURES = 3;
var ECCN_CLASSIFICATION = "5D992";
var EXPORT_COMPLIANCE_STATUSES = [
  "exempt",
  "requires_documentation",
  "excluded"
];
var ExportComplianceStatusSchema = z.enum(EXPORT_COMPLIANCE_STATUSES);
var DESKTOP_AUTH_STEPS = [
  "idle",
  "browser_opened",
  "waiting_callback",
  "processing_token",
  "complete",
  "error"
];
var DesktopAuthStepSchema = z.enum(DESKTOP_AUTH_STEPS);
var TIER_MIGRATION_STATUSES = [
  "pending",
  "key_setup",
  "migrating",
  "verifying",
  "complete",
  "failed"
];
var TierMigrationStatusSchema = z.enum(TIER_MIGRATION_STATUSES);
var MIGRATION_RATE_MS_PER_1K_NODES = 6e4;
var CONSENT_EVENT_TYPES = [
  "consent:requested",
  "consent:granted",
  "consent:declined",
  "consent:revoked",
  "consent:expired"
];
var ConsentEventTypeSchema = z.enum(CONSENT_EVENT_TYPES);
var PASSKEY_PLATFORMS = ["apple", "google", "microsoft"];
var PasskeyPlatformSchema = z.enum(PASSKEY_PLATFORMS);
var PASSKEY_SYNC_MECHANISMS = {
  apple: "icloud_keychain",
  google: "google_password_manager",
  microsoft: "microsoft_entra"
};
var RECOVERY_SETUP_STEPS = [
  "generating",
  "displaying",
  "verifying",
  "complete"
];
var RecoverySetupStepSchema = z.enum(RECOVERY_SETUP_STEPS);
var API_KEY_TYPES = ["platform", "byok"];
var ApiKeyTypeSchema = z.enum(API_KEY_TYPES);
var API_CALL_FLOWS = ["proxied", "direct"];
var ApiCallFlowSchema = z.enum(API_CALL_FLOWS);
var BYOK_ENCRYPTION_METHODS = ["server_side", "user_key"];
var BYOKEncryptionMethodSchema = z.enum(BYOK_ENCRYPTION_METHODS);
var MFA_OPTIONS = ["totp", "sms", "passkey"];
var MfaOptionSchema = z.enum(MFA_OPTIONS);
var SIGN_IN_IMPLEMENTATIONS = ["native", "rest_api", "oauth", "clerk_ui", "clerk_web"];
var SignInImplementationSchema = z.enum(SIGN_IN_IMPLEMENTATIONS);
var DEEP_LINK_SCHEME = "nous";
var AUTH_CALLBACK_PATH = "/auth/callback";
var OFFLINE_FUNCTIONALITY_LEVELS = [
  "full",
  "read_write_queued",
  "read_only",
  "local_only"
];
var OfflineFunctionalitySchema = z.enum(OFFLINE_FUNCTIONALITY_LEVELS);
var OFFLINE_SYNC_BEHAVIORS = [
  "realtime",
  "queued",
  "paused",
  "none"
];
var OfflineSyncBehaviorSchema = z.enum(OFFLINE_SYNC_BEHAVIORS);
var QUEUEABLE_TABLES = ["nodes", "edges", "episodes"];
var QUEUE_OPERATION_TYPES = ["create", "update", "delete"];
var DECLINE_ACTIONS = [
  "general_questions",
  "writing_assistance",
  "brainstorming",
  "allow_this_question",
  "end_conversation"
];
var LLM_PROVIDERS = ["openai", "anthropic", "google"];
var LLMProviderSchema = z.enum(LLM_PROVIDERS);
var REENCRYPTION_PRIORITY_ORDER = [
  "recently_accessed",
  "frequently_accessed",
  "oldest_first"
];
var ClerkConfigSchema = z.object({
  publishable_key: z.string().min(1),
  secret_key: z.string().min(1),
  sign_in_methods: z.array(z.enum(AUTH_METHODS)),
  mfa_enabled: z.boolean(),
  session_lifetime_minutes: z.number().int().positive(),
  ios: z.object({ native_sdk: z.boolean() }),
  android: z.object({ native_sdk: z.boolean() }),
  desktop: z.object({
    oauth_redirect_uri: z.string().url(),
    deep_link_scheme: z.string()
  })
});
var PlatformAuthConfigSchema = z.object({
  platform: z.enum(PLATFORMS),
  apple_sign_in: z.enum(SIGN_IN_IMPLEMENTATIONS),
  google_sign_in: z.enum(SIGN_IN_IMPLEMENTATIONS),
  email_password: z.enum(SIGN_IN_IMPLEMENTATIONS)
});
var AuthTokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  issued_at: z.string().datetime(),
  expires_at: z.string().datetime()
});
var AuthStateSchema = z.object({
  user_id: z.string().min(1),
  tokens: AuthTokensSchema,
  last_online: z.string().datetime(),
  offline_state: z.enum(OFFLINE_STATES),
  privacy_tier: z.enum(PRIVACY_TIERS),
  device_id: z.string().min(1)
});
var DesktopAuthFlowSchema = z.object({
  step: z.enum(DESKTOP_AUTH_STEPS),
  redirect_uri: z.string(),
  state_param: z.string().min(1),
  code_verifier: z.string().optional(),
  error: z.string().optional()
});
var AuthSecurityConfigSchema = z.object({
  brute_force_lockout_attempts: z.number().int().positive(),
  brute_force_lockout_minutes: z.number().int().positive(),
  captcha_after_failures: z.number().int().positive(),
  new_device_email_alert: z.boolean(),
  invalidate_sessions_on_password_change: z.boolean(),
  mfa_options: z.array(z.enum(MFA_OPTIONS))
});
var JWTValidationResultSchema = z.object({
  valid: z.boolean(),
  user_id: z.string().optional(),
  error: z.enum(["expired", "invalid_signature", "malformed", "revoked"]).optional()
});
var TierDefinitionSchema = z.object({
  tier: z.enum(PRIVACY_TIERS),
  name: z.string(),
  description: z.string(),
  target_user: z.string(),
  search: z.enum(["cloud", "client_only"]),
  llm_access: z.enum(["direct", "explicit_consent"]),
  key_management: z.enum(["none", "passkey_derived"]),
  data_protection: z.array(z.string()),
  data_exposure: z.array(z.string())
});
var TierComparisonSchema = z.object({
  feature: z.string(),
  standard: z.string(),
  private_tier: z.string()
});
var TierMigrationRequestSchema = z.object({
  user_id: z.string().min(1),
  from_tier: z.enum(PRIVACY_TIERS),
  to_tier: z.enum(PRIVACY_TIERS),
  initiated_at: z.string().datetime()
});
var TierMigrationStateSchema = z.object({
  request: TierMigrationRequestSchema,
  status: z.enum(TIER_MIGRATION_STATUSES),
  progress: z.number().min(0).max(100),
  nodes_processed: z.number().int().min(0),
  nodes_total: z.number().int().min(0),
  estimated_time_remaining_ms: z.number().min(0),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  error: z.string().optional()
});
var EncryptedNodeSchemaZ = z.object({
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
  updated_at: z.number().int()
});
var EncryptionFieldMapSchema = z.object({
  plaintext: z.array(z.string()),
  encrypted_content: z.array(z.string()),
  encrypted_embedding: z.array(z.string()),
  encrypted_metadata: z.array(z.string())
});
var EncryptionResultSchema = z.object({
  encrypted_payload: z.instanceof(Uint8Array),
  encrypted_embedding: z.instanceof(Uint8Array).optional(),
  nonce: z.instanceof(Uint8Array),
  encryption_version: z.number().int().min(1)
});
var DecryptionResultSchema = z.object({
  content: z.object({
    title: z.string(),
    body: z.string().optional(),
    summary: z.string().optional(),
    blocks: z.array(z.unknown()).optional()
  }),
  embedding: z.object({
    vector: z.instanceof(Float32Array),
    model: z.string(),
    created_at: z.string()
  }).optional(),
  temporal: z.object({
    ingestion: z.object({ timestamp: z.string(), timezone: z.string() }),
    event: z.unknown().optional(),
    content_times: z.array(z.unknown()).optional(),
    reference_patterns: z.array(z.string()).optional()
  }),
  neural: z.object({
    stability: z.number(),
    retrievability: z.number(),
    last_accessed: z.string(),
    access_count: z.number()
  }),
  provenance: z.object({
    source: z.string(),
    parent_id: z.string().optional(),
    confidence: z.number()
  }),
  state: z.object({
    extraction_depth: z.string(),
    lifecycle: z.string()
  })
});
var ClientSearchConfigSchema = z.object({
  hnsw_ef_construction: z.number().int().positive(),
  hnsw_ef_search: z.number().int().positive(),
  hnsw_m: z.number().int().positive(),
  max_nodes: z.number().int().positive(),
  index_in_memory: z.boolean()
});
var LocalSearchResultSchema = z.object({
  node_id: z.string(),
  distance: z.number().min(0),
  score: z.number().min(0).max(1)
});
var HNSWIndexSchema = z.object({
  size: z.number().int().min(0),
  ready: z.boolean(),
  memory_bytes: z.number().int().min(0)
});
var PasskeyInfoSchema = z.object({
  id: z.string().min(1),
  created_at: z.string().datetime(),
  platform: z.enum(PASSKEY_PLATFORMS),
  synced_via: z.string().min(1),
  secure_enclave: z.boolean()
});
var MasterKeyInfoSchema = z.object({
  algorithm: z.literal(KEY_DERIVATION_FUNCTION),
  length_bits: z.literal(MASTER_KEY_LENGTH_BITS),
  derivation_salt: z.instanceof(Uint8Array),
  exists_in_memory_only: z.literal(true)
});
var DerivedKeysSchema = z.object({
  content_key: z.any().refine((val) => val != null, { message: "content_key is required" }),
  embedding_key: z.any().refine((val) => val != null, { message: "embedding_key is required" }),
  metadata_key: z.any().refine((val) => val != null, { message: "metadata_key is required" })
});
var KeyHierarchySchema = z.object({
  passkey: PasskeyInfoSchema,
  master_key: MasterKeyInfoSchema,
  derived_keys: DerivedKeysSchema
});
var KeyDerivationParamsSchema = z.object({
  algorithm: z.literal("HKDF"),
  hash: z.literal("SHA-256"),
  salt: z.instanceof(Uint8Array),
  info: z.string().min(1),
  key_length: z.literal(MASTER_KEY_LENGTH_BITS)
});
var MultiDeviceKeySyncSchema = z.object({
  method: z.literal("passkey_platform_sync"),
  description: z.string(),
  sync_mechanisms: z.record(z.enum(PASSKEY_PLATFORMS), z.string())
});
var KeyVersionSchema = z.object({
  version: z.number().int().min(1),
  created_at: z.string().datetime(),
  derivation_salt: z.instanceof(Uint8Array),
  status: z.enum(KEY_VERSION_STATUSES)
});
var UserKeyMetadataSchema = z.object({
  current_version: z.number().int().min(1),
  versions: z.array(KeyVersionSchema),
  rotation_in_progress: z.boolean(),
  rotation_progress: z.number().min(0).max(100),
  rotation_started_at: z.string().datetime().nullable()
});
var RotationProgressSchema = z.object({
  processed_count: z.number().int().min(0),
  total_count: z.number().int().min(0),
  last_processed_id: z.string().nullable(),
  started_at: z.string().datetime(),
  phase: z.enum(ROTATION_PHASES)
});
var RotationConfigSchema = z.object({
  batch_size: z.number().int().positive(),
  pause_between_batches_ms: z.number().int().min(0),
  max_batches_per_minute: z.number().int().positive(),
  require_wifi: z.boolean(),
  require_charging: z.boolean(),
  min_battery_level: z.number().int().min(0).max(100),
  persist_progress: z.boolean(),
  auto_resume_on_launch: z.boolean()
});
var RotationEventSchema = z.object({
  type: z.enum(ROTATION_EVENT_TYPES),
  progress: z.number().min(0).max(100).optional(),
  processed_count: z.number().int().min(0).optional(),
  total_count: z.number().int().min(0).optional(),
  estimated_remaining_ms: z.number().min(0).optional(),
  error: z.string().optional()
});
var RecoveryCodeSchema = z.object({
  mnemonic: z.array(z.string()).length(RECOVERY_WORD_COUNT),
  version: z.number().int().min(1),
  created_at: z.string().datetime(),
  verified: z.boolean()
});
var RecoverySetupStateSchema = z.object({
  step: z.enum(RECOVERY_SETUP_STEPS),
  mnemonic: z.array(z.string()).length(RECOVERY_WORD_COUNT),
  verification_indices: z.array(z.number().int().min(0).max(RECOVERY_WORD_COUNT - 1)).length(RECOVERY_VERIFICATION_WORD_COUNT),
  attempts_remaining: z.number().int().min(0).max(RECOVERY_VERIFICATION_ATTEMPT_LIMIT)
});
var RecoveryAttemptSchema = z.object({
  user_id: z.string().min(1),
  method: z.enum(RECOVERY_METHODS),
  attempted_at: z.string().datetime(),
  success: z.boolean(),
  error: z.string().optional()
});
var GracePeriodStateSchema = z.object({
  enabled: z.boolean(),
  expires_at: z.string().datetime(),
  email_recovery_available: z.boolean()
});
var RecoveryRegenerationResultSchema = z.object({
  new_mnemonic: z.array(z.string()).length(RECOVERY_WORD_COUNT),
  old_code_invalidated: z.boolean(),
  new_encrypted_master: z.instanceof(Uint8Array),
  verification_required: z.boolean()
});
var RecoveryReminderSchema = z.object({
  type: z.enum(RECOVERY_REMINDER_TYPES),
  days_since_setup: z.number().int().min(0),
  last_dismissed: z.string().datetime().nullable(),
  message: z.string().min(1)
});
var ConsentStateSchema = z.object({
  scope: z.enum(CONSENT_SCOPES),
  granted: z.boolean(),
  granted_at: z.string().datetime().optional(),
  expires_at: z.string().datetime().optional(),
  provider: z.string().optional(),
  memories_shared_count: z.number().int().min(0),
  memories_shared_ids: z.array(z.string())
});
var TopicConsentSchema = z.object({
  topic_embedding: z.array(z.number()),
  label: z.string().min(1),
  consented_at: z.string().datetime(),
  query_count: z.number().int().min(0)
});
var ConsentSettingsSchema = z.object({
  default_scope: z.enum(CONSENT_SCOPES),
  time_based_duration: z.enum(CONSENT_DURATIONS),
  topic_similarity_threshold: z.number().min(0.8).max(0.95),
  remembered_topics: z.array(TopicConsentSchema),
  conversation_timeout_minutes: z.number().int().positive(),
  require_explicit_for_sensitive: z.boolean()
});
var ConsentDialogDataSchema = z.object({
  memories: z.array(z.lazy(() => ConsentMemoryPreviewSchema)),
  total_count: z.number().int().min(1),
  provider_name: z.string().min(1),
  provider_privacy_note: z.string(),
  provider_policy_url: z.string().url()
});
var ConsentMemoryPreviewSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  created_at: z.string().datetime(),
  type: z.string().min(1),
  preview: z.string(),
  selected: z.boolean()
});
var ConsentRevocationRequestSchema = z.object({
  scope: z.enum(CONSENT_REVOCATION_SCOPES)
});
var DeclineResultSchema = z.object({
  declined: z.literal(true),
  available_actions: z.array(z.enum(DECLINE_ACTIONS)),
  previous_context_available: z.boolean(),
  message: z.string()
});
var ConsentEventSchema = z.object({
  type: z.enum(CONSENT_EVENT_TYPES),
  user_id: z.string().min(1),
  scope: z.enum(CONSENT_SCOPES),
  memories_count: z.number().int().min(0),
  provider: z.string(),
  timestamp: z.string().datetime()
});
var ConsentVisualIndicatorSchema = z.object({
  memories_shared_count: z.number().int().min(0),
  provider_name: z.string(),
  consent_scope_label: z.string(),
  time_remaining: z.string().optional(),
  transmitting: z.boolean()
});
var SharedMemoryDetailSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  shared_at: z.string().datetime()
});
var PlatformApiKeySchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  encrypted_key: z.string().min(1),
  created_at: z.string().datetime(),
  rotated_at: z.string().datetime(),
  rate_limit: z.object({
    rpm: z.number().int().positive(),
    tpm: z.number().int().positive()
  })
});
var BYOKConfigSchema = z.object({
  user_id: z.string().min(1),
  provider: z.enum(LLM_PROVIDERS),
  encrypted_key: z.instanceof(Uint8Array),
  encryption_method: z.enum(BYOK_ENCRYPTION_METHODS),
  created_at: z.string().datetime(),
  last_used: z.string().datetime().optional()
});
var ApiCallRouteSchema = z.object({
  key_type: z.enum(API_KEY_TYPES),
  flow: z.enum(API_CALL_FLOWS),
  rate_limited: z.boolean(),
  usage_logged: z.boolean()
});
var BYOKRateLimitConfigSchema = z.object({
  max_decryptions_per_minute: z.number().int().positive(),
  exponential_backoff: z.boolean(),
  lockout_after_failures: z.number().int().positive(),
  lockout_duration_minutes: z.number().int().positive()
});
var BYOKDecryptionAttemptSchema = z.object({
  user_id: z.string().min(1),
  attempted_at: z.string().datetime(),
  success: z.boolean(),
  consecutive_failures: z.number().int().min(0),
  locked_out: z.boolean(),
  lockout_expires_at: z.string().datetime().nullable()
});
var ExportComplianceConfigSchema = z.object({
  region: z.string().min(1),
  standard_tier: z.enum(EXPORT_COMPLIANCE_STATUSES),
  private_tier: z.enum(EXPORT_COMPLIANCE_STATUSES),
  documentation_required: z.array(z.string()),
  notes: z.string()
});
var AppStoreDeclarationSchema = z.object({
  platform: z.enum(PLATFORMS),
  uses_non_exempt_encryption: z.boolean(),
  eccn: z.string().optional(),
  mass_market_exemption: z.boolean().optional(),
  self_classification_filed: z.boolean(),
  annual_report_due: z.string().datetime().optional()
});
var ThreatModelEntrySchema = z.object({
  threat: z.string().min(1),
  protected_by_standard: z.boolean(),
  protected_by_private: z.boolean(),
  description: z.string().min(1)
});
var LaunchPhaseSchema = z.object({
  version: z.string().min(1),
  features: z.array(z.string()),
  markets: z.array(z.string()),
  compliance_requirements: z.array(z.string())
});
var OfflineStateConfigSchema = z.object({
  state: z.enum(OFFLINE_STATES),
  max_hours: z.number().min(0),
  functionality: z.enum(OFFLINE_FUNCTIONALITY_LEVELS),
  sync_behavior: z.enum(OFFLINE_SYNC_BEHAVIORS),
  auth_behavior: z.string().min(1),
  private_tier_key_access: z.boolean()
});
var OfflineSyncQueueSchema = z.object({
  operations: z.array(z.lazy(() => QueuedOperationSchema)),
  created_at: z.string().datetime(),
  last_attempted: z.string().datetime().nullable()
});
var QueuedOperationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(QUEUE_OPERATION_TYPES),
  table: z.enum(QUEUEABLE_TABLES),
  data: z.unknown(),
  queued_at: z.string().datetime(),
  priority: z.number().int().min(0)
});
var OfflineCapabilityCheckSchema = z.object({
  can_read: z.boolean(),
  can_write: z.boolean(),
  can_search: z.boolean(),
  can_sync: z.boolean(),
  can_use_llm: z.boolean(),
  reason: z.string().min(1)
});
var QueueSyncResultSchema = z.object({
  synced: z.number().int().min(0),
  failed: z.number().int().min(0),
  errors: z.array(z.object({
    operation_id: z.string(),
    error: z.string()
  })).optional()
});

// src/security/auth.ts
var PLATFORM_AUTH_CONFIGS = {
  ios: {
    platform: "ios",
    apple_sign_in: "native",
    google_sign_in: "native",
    email_password: "clerk_ui"
  },
  android: {
    platform: "android",
    apple_sign_in: "rest_api",
    google_sign_in: "native",
    email_password: "clerk_ui"
  },
  macos: {
    platform: "macos",
    apple_sign_in: "native",
    google_sign_in: "oauth",
    email_password: "clerk_web"
  },
  windows: {
    platform: "windows",
    apple_sign_in: "oauth",
    google_sign_in: "oauth",
    email_password: "clerk_web"
  }
};
var DEFAULT_SECURITY_CONFIG = {
  brute_force_lockout_attempts: BRUTE_FORCE_LOCKOUT_ATTEMPTS,
  brute_force_lockout_minutes: BRUTE_FORCE_LOCKOUT_MINUTES,
  captcha_after_failures: CAPTCHA_AFTER_FAILURES,
  new_device_email_alert: true,
  invalidate_sessions_on_password_change: true,
  mfa_options: ["totp", "sms", "passkey"]
};
var DEFAULT_DESKTOP_CONFIG = {
  oauth_redirect_uri: `${DEEP_LINK_SCHEME}://${AUTH_CALLBACK_PATH}`,
  deep_link_scheme: DEEP_LINK_SCHEME
};
var OFFLINE_STATE_TRANSITION_REFERENCE = {
  online: "Full functionality",
  short_offline: `<${OFFLINE_THRESHOLDS.short_offline}h, JWT valid, full functionality`,
  medium_offline: `<${OFFLINE_THRESHOLDS.medium_offline}h, JWT expired, read-only + queued writes`,
  long_offline: `>${OFFLINE_THRESHOLDS.medium_offline}h, refresh expired, local only`,
  reauth_required: "Must reconnect to continue"
};
function isTokenValid(tokens) {
  const expiresAt = new Date(tokens.expires_at).getTime();
  return Date.now() < expiresAt;
}
function shouldReauthenticate(auth) {
  const lastOnline = new Date(auth.last_online).getTime();
  const hoursSinceOnline = (Date.now() - lastOnline) / (1e3 * 60 * 60);
  return hoursSinceOnline >= OFFLINE_THRESHOLDS.medium_offline;
}
function updateOfflineState(auth) {
  const lastOnline = new Date(auth.last_online).getTime();
  const hoursSinceOnline = (Date.now() - lastOnline) / (1e3 * 60 * 60);
  if (hoursSinceOnline < 0.01) {
    return "online";
  }
  if (hoursSinceOnline < OFFLINE_THRESHOLDS.short_offline && isTokenValid(auth.tokens)) {
    return "short_offline";
  }
  if (hoursSinceOnline < OFFLINE_THRESHOLDS.medium_offline) {
    return "medium_offline";
  }
  return "long_offline";
}
function getPlatformAuthConfig(platform) {
  return PLATFORM_AUTH_CONFIGS[platform];
}
function getClerkConfig(_platform) {
  throw new Error("getClerkConfig requires Clerk SDK integration");
}
async function validateJWT(_token) {
  throw new Error("validateJWT requires Clerk SDK implementation");
}

// src/security/tiers.ts
var TIER_DEFINITIONS = {
  standard: {
    tier: "standard",
    name: "Standard",
    description: "Server-managed security with full cloud features. Your data is encrypted at rest and in transit.",
    target_user: "Users who prioritize convenience over maximum privacy. Trust Nous with their data (but not random attackers).",
    search: "cloud",
    llm_access: "direct",
    key_management: "none",
    data_protection: [
      "Data in transit: TLS 1.3 + certificate pinning",
      "Data at rest: Turso built-in encryption (AES-256)",
      "Separation: Database-per-tenant (your data isolated)"
    ],
    data_exposure: [
      "Nous can technically access your data (for support, debugging)",
      "Subpoena could compel disclosure",
      "Server-side breach could expose plaintext"
    ]
  },
  private: {
    tier: "private",
    name: "Private",
    description: "Full end-to-end encryption. Content and embeddings encrypted client-side. Nous cannot access your data.",
    target_user: "Journalists, activists, privacy advocates. Users who don't want ANYONE to access their data. Willing to accept feature limitations.",
    search: "client_only",
    llm_access: "explicit_consent",
    key_management: "passkey_derived",
    data_protection: [
      "Content: AES-256-GCM encrypted (client-side)",
      "Embeddings: AES-256-GCM encrypted (client-side)",
      "Metadata: Type/ID plaintext (for sync), everything else encrypted",
      "Nous CANNOT access your data - we literally don't have the keys"
    ],
    data_exposure: [
      "All search is local (must decrypt to search)",
      "LLM features require explicit consent per-query",
      "Larger devices needed (100MB+ for index)",
      "You can lose your data if you lose keys"
    ]
  }
};
var TIER_COMPARISON_TABLE = [
  {
    feature: "Search",
    standard: "Full cloud (HNSW + BM25)",
    private_tier: "Client-side only"
  },
  {
    feature: "LLM Features",
    standard: "Direct, seamless",
    private_tier: "Explicit consent required"
  },
  {
    feature: "Key Management",
    standard: "None (server-managed)",
    private_tier: "Passkey-derived master key"
  },
  {
    feature: "Data Accessible To",
    standard: "Nous (for support), law enforcement (with subpoena)",
    private_tier: "Only you (with your keys)"
  },
  {
    feature: "Recovery Options",
    standard: "Email, password reset",
    private_tier: "Recovery code only (after 7-day grace)"
  },
  {
    feature: "Offline Experience",
    standard: "Read-only when offline, sync when back",
    private_tier: "Full offline (passkey unlock is local)"
  },
  {
    feature: "Device Requirements",
    standard: "Any",
    private_tier: "100MB+ for search index"
  },
  {
    feature: "Export Compliance",
    standard: "HTTPS exempt, no extra docs",
    private_tier: "ECCN 5D992, requires documentation"
  }
];
function getTierDefinition(tier) {
  return TIER_DEFINITIONS[tier];
}
function canMigrateTier(from, to) {
  return from !== to;
}
function estimateMigrationTime(node_count) {
  return Math.ceil(node_count / 1e3) * MIGRATION_RATE_MS_PER_1K_NODES;
}
async function startTierMigration(_request) {
  throw new Error("startTierMigration requires server-side migration state and encryption services");
}
async function getTierMigrationProgress(_user_id) {
  throw new Error("getTierMigrationProgress requires server-side migration state lookup");
}

// src/security/encryption.ts
var ENCRYPTION_FIELD_MAP = {
  plaintext: [
    "id",
    "type",
    "version",
    "updated_at",
    "encryption_version",
    "nonce",
    "encryption_tier"
  ],
  encrypted_content: [
    "content.title",
    "content.body",
    "content.summary",
    "content.blocks"
  ],
  encrypted_embedding: [
    "embedding.vector"
  ],
  encrypted_metadata: [
    "temporal.ingestion",
    "temporal.event",
    "temporal.content_times",
    "temporal.reference_patterns",
    "neural.stability",
    "neural.retrievability",
    "neural.last_accessed",
    "neural.access_count",
    "provenance.source",
    "provenance.parent_id",
    "provenance.confidence",
    "state.extraction_depth",
    "state.lifecycle",
    "versioning.lastModified",
    "versioning.lastModifier",
    "versioning.checksum"
  ]
};
var ENCRYPTED_NODES_ADDITIONAL_SQL = `
-- Additional columns for storm-022 Private tier encryption
-- (encrypted_payload and encryption_tier already exist from storm-017)

ALTER TABLE nodes ADD COLUMN encrypted_embedding BLOB;
ALTER TABLE nodes ADD COLUMN encryption_version INTEGER DEFAULT 1;
ALTER TABLE nodes ADD COLUMN nonce BLOB;

-- Index on encryption version for key rotation queries
CREATE INDEX IF NOT EXISTS idx_nodes_encryption_version ON nodes(encryption_version)
  WHERE encryption_tier = 'private';
`;
var DEFAULT_CLIENT_SEARCH_CONFIG_MOBILE = {
  hnsw_ef_construction: 200,
  hnsw_ef_search: 50,
  hnsw_m: 16,
  max_nodes: PRIVATE_TIER_NODE_LIMITS.mobile,
  index_in_memory: true
};
var DEFAULT_CLIENT_SEARCH_CONFIG_DESKTOP = {
  hnsw_ef_construction: 200,
  hnsw_ef_search: 50,
  hnsw_m: 16,
  max_nodes: PRIVATE_TIER_NODE_LIMITS.desktop,
  index_in_memory: true
};
var PERFORMANCE_REFERENCE = {
  "10k": {
    memory_mb: 130,
    index_build_seconds: 2,
    search_latency_ms: 20
  },
  "50k": {
    memory_mb: 650,
    index_build_seconds: 10,
    search_latency_ms: 40
  },
  "100k": {
    memory_mb: 1300,
    index_build_seconds: 20,
    search_latency_ms: 60
  }
};
async function encryptNode(_node, _keys) {
  throw new Error("encryptNode requires Web Crypto API implementation");
}
async function decryptNode(_encrypted, _keys) {
  throw new Error("decryptNode requires Web Crypto API implementation");
}
async function encryptEmbedding(_vector, _key) {
  throw new Error("encryptEmbedding requires Web Crypto API implementation");
}
async function decryptEmbedding(_encrypted, _key) {
  throw new Error("decryptEmbedding requires Web Crypto API implementation");
}
async function buildLocalSearchIndex(_decryptedEmbeddings, _config) {
  throw new Error("buildLocalSearchIndex requires HNSW library implementation");
}
async function searchLocalIndex(_index, _query, _topK) {
  throw new Error("searchLocalIndex requires HNSW library implementation");
}

// src/security/keys.ts
var DEFAULT_MULTI_DEVICE_SYNC = {
  method: "passkey_platform_sync",
  description: "Passkey syncs via platform credential manager. On new device: authenticate \u2192 derive keys. No key transmission needed \u2014 derivation is deterministic.",
  sync_mechanisms: PASSKEY_SYNC_MECHANISMS
};
function createDerivationParams(purpose, salt) {
  return {
    algorithm: "HKDF",
    hash: "SHA-256",
    salt,
    info: DERIVATION_INFO_STRINGS[purpose],
    key_length: MASTER_KEY_LENGTH_BITS
  };
}
async function deriveMasterKey(_passkeySecret, _salt) {
  throw new Error("deriveMasterKey requires Web Crypto API implementation");
}
async function deriveContentKey(_masterKey) {
  throw new Error("deriveContentKey requires Web Crypto API implementation");
}
async function deriveEmbeddingKey(_masterKey) {
  throw new Error("deriveEmbeddingKey requires Web Crypto API implementation");
}
async function deriveMetadataKey(_masterKey) {
  throw new Error("deriveMetadataKey requires Web Crypto API implementation");
}
async function deriveAllKeys(_masterKey) {
  throw new Error("deriveAllKeys requires Web Crypto API implementation");
}
function generateSalt() {
  throw new Error("generateSalt requires Web Crypto API implementation");
}
var DEFAULT_ROTATION_CONFIG = {
  batch_size: ROTATION_BATCH_SIZE,
  pause_between_batches_ms: ROTATION_PAUSE_BETWEEN_BATCHES_MS,
  max_batches_per_minute: ROTATION_MAX_BATCHES_PER_MINUTE,
  require_wifi: true,
  require_charging: true,
  min_battery_level: ROTATION_MIN_BATTERY_LEVEL,
  persist_progress: true,
  auto_resume_on_launch: true
};
var ROTATION_TIMING_REFERENCE = ROTATION_TIMING_ESTIMATES;
async function initiateKeyRotation(_user_id, _trigger) {
  throw new Error("initiateKeyRotation requires Web Crypto API and server-side key metadata");
}
async function backgroundReencrypt(_old_key, _new_key, _progress) {
  throw new Error("backgroundReencrypt requires Web Crypto API and database adapter");
}
async function getNodesNeedingRotation(_last_processed_id) {
  throw new Error("getNodesNeedingRotation requires database adapter");
}
async function canContinueRotation() {
  throw new Error("canContinueRotation requires platform battery/network APIs");
}
async function saveRotationProgress(_progress) {
  throw new Error("saveRotationProgress requires server-side progress storage");
}
async function resumeRotation(_user_id) {
  throw new Error("resumeRotation requires server-side progress lookup");
}
async function verifyRotation(_new_key, _sample_percent) {
  throw new Error("verifyRotation requires Web Crypto API and database adapter");
}
async function completeRotation(_user_id) {
  throw new Error("completeRotation requires server-side key metadata update");
}
function getKeyVersionForNode(_node, _metadata) {
  throw new Error("getKeyVersionForNode requires key derivation from stored salts");
}

// src/security/recovery.ts
var RECOVERY_DERIVATION_INFO = "nous-recovery";
var RECOVERY_KEY_LENGTH_BYTES = 32;
var RECOVERY_REMINDER_MESSAGES = {
  initial: "Have you stored your recovery code safely? Without it, your data cannot be recovered if you lose all your devices.",
  periodic: "Recovery code reminder: Make sure your recovery code is still accessible. If you've lost it, regenerate a new one in Settings > Security.",
  new_device: "Welcome to your new device. Remember, your recovery code is the ultimate backup if you lose access to all your devices."
};
var OLD_CODE_ERROR_MESSAGE = "This recovery code is no longer valid. It was replaced on {date}. If you didn't change your passkey, contact support immediately.";
function getVerificationIndices() {
  const indices = [];
  while (indices.length < RECOVERY_VERIFICATION_WORD_COUNT) {
    const idx = Math.floor(Math.random() * RECOVERY_WORD_COUNT);
    if (!indices.includes(idx)) {
      indices.push(idx);
    }
  }
  return indices.sort((a, b) => a - b);
}
function verifyRecoveryWords(mnemonic, indices, answers) {
  if (indices.length !== answers.length) {
    return false;
  }
  return indices.every((index, i) => {
    const expected = mnemonic[index];
    const answer = answers[i];
    if (expected === void 0 || answer === void 0) {
      return false;
    }
    return expected.toLowerCase() === answer.toLowerCase();
  });
}
function generateRecoveryCode() {
  throw new Error("generateRecoveryCode requires BIP39 library implementation");
}
async function deriveRecoveryKey(_mnemonic) {
  throw new Error("deriveRecoveryKey requires BIP39 library and Web Crypto API implementation");
}
async function encryptMasterKeyForRecovery(_master_key, _recovery_key) {
  throw new Error("encryptMasterKeyForRecovery requires Web Crypto API implementation");
}
async function recoverMasterKey(_mnemonic, _encrypted_master) {
  throw new Error("recoverMasterKey requires BIP39 library and Web Crypto API implementation");
}
async function regenerateRecoveryCode(_user_id, _master_key) {
  throw new Error("regenerateRecoveryCode requires BIP39 library and server integration");
}
async function isGracePeriodActive(_user_id) {
  throw new Error("isGracePeriodActive requires server-side state lookup");
}
async function recoverViaEmail(_user_id, _email_token) {
  throw new Error("recoverViaEmail requires server-side email verification implementation");
}
function getRecoveryReminder(_user_id) {
  throw new Error("getRecoveryReminder requires server-side state lookup");
}
async function dismissRecoveryReminder(_user_id, _reminder_type) {
  throw new Error("dismissRecoveryReminder requires server-side state update");
}

// src/security/consent.ts
var DEFAULT_CONSENT_SETTINGS = {
  default_scope: DEFAULT_CONSENT_SCOPE,
  time_based_duration: "24h",
  topic_similarity_threshold: TOPIC_SIMILARITY_THRESHOLD,
  remembered_topics: [],
  conversation_timeout_minutes: CONVERSATION_TIMEOUT_MINUTES,
  require_explicit_for_sensitive: true
};
var DECLINE_MESSAGE = "I can't access your memories for this question. Without access, I can still help with general questions, writing assistance, and brainstorming ideas.";
function isConsentActive(state) {
  if (!state.granted) {
    return false;
  }
  if (state.expires_at) {
    return Date.now() < new Date(state.expires_at).getTime();
  }
  if (state.scope === "per_message") {
    return false;
  }
  return true;
}
function handleDecline(_user_id) {
  return {
    declined: true,
    available_actions: [...DECLINE_ACTIONS],
    previous_context_available: false,
    message: DECLINE_MESSAGE
  };
}
function cosineSimilarity(a, b) {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i];
    const valB = b[i];
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }
  return dotProduct / denominator;
}
function checkTopicMatch(query_embedding, remembered_topics, threshold = TOPIC_SIMILARITY_THRESHOLD) {
  let bestMatch = null;
  let bestSimilarity = 0;
  for (const topic of remembered_topics) {
    const similarity = cosineSimilarity(query_embedding, topic.topic_embedding);
    if (similarity >= threshold && similarity > bestSimilarity) {
      bestMatch = topic;
      bestSimilarity = similarity;
    }
  }
  return bestMatch;
}
async function requestConsent(_user_id, _memory_ids, _provider) {
  throw new Error("requestConsent requires server-side memory lookup implementation");
}
async function grantConsent(_user_id, _scope, _memory_ids) {
  throw new Error("grantConsent requires consent state persistence implementation");
}
async function checkConsent(_user_id, _query_embedding) {
  throw new Error("checkConsent requires consent state lookup implementation");
}
async function revokeConsent(_user_id, _request) {
  throw new Error("revokeConsent requires consent state update implementation");
}
async function getSharedMemories(_user_id, _conversation_id) {
  throw new Error("getSharedMemories requires shared memory tracking implementation");
}
async function updateConsentSettings(_user_id, _settings) {
  throw new Error("updateConsentSettings requires settings persistence implementation");
}

// src/security/api-keys.ts
var API_CALL_ROUTES = {
  platform: {
    key_type: "platform",
    flow: "proxied",
    rate_limited: true,
    usage_logged: true
  },
  byok: {
    key_type: "byok",
    flow: "direct",
    rate_limited: true,
    usage_logged: false
  }
};
var DEFAULT_BYOK_RATE_LIMIT = {
  max_decryptions_per_minute: BYOK_MAX_DECRYPTIONS_PER_MINUTE,
  exponential_backoff: true,
  lockout_after_failures: BYOK_LOCKOUT_AFTER_FAILURES,
  lockout_duration_minutes: BYOK_LOCKOUT_DURATION_MINUTES
};
function getApiCallRouteForKeyType(keyType) {
  return API_CALL_ROUTES[keyType];
}
async function encryptBYOKKey(_api_key, _encryption_key) {
  throw new Error("encryptBYOKKey requires Web Crypto API implementation");
}
async function decryptBYOKKey(_encrypted, _encryption_key) {
  throw new Error("decryptBYOKKey requires Web Crypto API implementation");
}
async function getApiCallRoute(_user_id, _provider) {
  throw new Error("getApiCallRoute requires server-side BYOK config lookup");
}
async function checkBYOKRateLimit(_user_id) {
  throw new Error("checkBYOKRateLimit requires rate limit state tracking");
}
function trackBYOKDecryption(_user_id, _success) {
  throw new Error("trackBYOKDecryption requires rate limit state tracking");
}
async function rotatePlatformKey(_provider) {
  throw new Error("rotatePlatformKey requires server-side key management");
}
async function getBYOKConfig(_user_id, _provider) {
  throw new Error("getBYOKConfig requires server-side BYOK storage");
}
async function storeBYOKKey(_user_id, _provider, _api_key, _tier) {
  throw new Error("storeBYOKKey requires Web Crypto API and server-side storage");
}
async function revokeBYOKKey(_user_id, _provider) {
  throw new Error("revokeBYOKKey requires server-side key deletion");
}

// src/security/compliance.ts
var THREAT_MODEL = [
  // === THREATS WE PROTECT AGAINST ===
  {
    threat: "random_hackers",
    protected_by_standard: true,
    protected_by_private: true,
    description: "TLS prevents MITM attacks. Server-side encryption (Standard) protects at rest. E2E (Private) protects even if servers breached."
  },
  {
    threat: "curious_employees",
    protected_by_standard: false,
    protected_by_private: true,
    description: "Standard: Employees could technically access data. Private: Employees CANNOT access (no keys)."
  },
  {
    threat: "data_breaches",
    protected_by_standard: true,
    protected_by_private: true,
    description: "Standard: Attacker gets encrypted data (Turso encryption). Private: Attacker gets doubly-encrypted data (useless)."
  },
  {
    threat: "legal_subpoenas",
    protected_by_standard: false,
    protected_by_private: true,
    description: "Standard: We must comply if legally compelled. Private: We literally cannot comply (no keys)."
  },
  // === THREATS WE DO NOT PROTECT AGAINST ===
  {
    threat: "device_malware",
    protected_by_standard: false,
    protected_by_private: false,
    description: "If attacker controls your device, game over. We cannot protect against keyloggers, screen capture."
  },
  {
    threat: "user_error",
    protected_by_standard: false,
    protected_by_private: false,
    description: "Sharing recovery code, weak device passcode, etc. We provide warnings but cannot prevent."
  },
  {
    threat: "state_level_actors",
    protected_by_standard: false,
    protected_by_private: false,
    description: "Rubber-hose cryptanalysis (coercion), advanced forensics on device. Recommendation: Do not be a nation-state target."
  },
  {
    threat: "llm_provider",
    protected_by_standard: false,
    protected_by_private: false,
    description: "When you send data to Claude/GPT, that provider sees it. We show consent dialog, but cannot control their servers."
  }
];
var EXPORT_COMPLIANCE_BY_REGION = [
  {
    region: "us",
    standard_tier: "exempt",
    private_tier: "requires_documentation",
    documentation_required: [
      "ECCN 5D992 self-classification",
      "Mass market exemption (License Exception ENC \xA7740.17)",
      "Annual self-classification report to BIS"
    ],
    notes: "Private tier uses AES-256-GCM (proprietary encryption). ~2 business days Apple review."
  },
  {
    region: "general",
    standard_tier: "exempt",
    private_tier: "requires_documentation",
    documentation_required: [
      "ECCN 5D992 self-classification",
      "Mass market exemption (License Exception ENC \xA7740.17)",
      "Annual self-classification report to BIS"
    ],
    notes: "Most markets follow US export rules. Standard tier uses TLS/HTTPS only (OS-provided), ITSAppUsesNonExemptEncryption = NO."
  },
  {
    region: "france",
    standard_tier: "exempt",
    private_tier: "excluded",
    documentation_required: [
      "ECCN 5D992 self-classification",
      "French encryption declaration (ANSSI)",
      "Additional 1-month review period"
    ],
    notes: "France requires additional encryption declaration with ~1 month review. Recommendation: Exclude France at launch, add after approval."
  }
];
var LAUNCH_STRATEGY = [
  {
    version: "v1.0",
    features: ["Standard tier only", "Clerk auth", "Cloud search", "Seamless LLM"],
    markets: ["All markets"],
    compliance_requirements: ["No encryption documentation required", "ITSAppUsesNonExemptEncryption = NO"]
  },
  {
    version: "v1.1",
    features: [
      "Add Private tier",
      "E2E encryption (AES-256-GCM)",
      "Client-side HNSW search",
      "LLM consent dialogs",
      "Passkey-derived key hierarchy",
      "Recovery codes (BIP39)"
    ],
    markets: ["US", "Most international markets"],
    compliance_requirements: [
      "ECCN 5D992 self-classification filed",
      "Mass market exemption (License Exception ENC \xA7740.17)",
      "Annual BIS self-classification report",
      "ITSAppUsesNonExemptEncryption = YES",
      "Google Play encryption declaration"
    ]
  },
  {
    version: "v1.2",
    features: ["Add France support for Private tier"],
    markets: ["France (Private tier)"],
    compliance_requirements: [
      "French encryption declaration (ANSSI) approved",
      "All v1.1 requirements maintained"
    ]
  }
];
var APP_STORE_DECLARATIONS = {
  standard_only: [
    { platform: "ios", uses_non_exempt_encryption: false, self_classification_filed: false },
    { platform: "android", uses_non_exempt_encryption: false, self_classification_filed: false },
    { platform: "macos", uses_non_exempt_encryption: false, self_classification_filed: false },
    { platform: "windows", uses_non_exempt_encryption: false, self_classification_filed: false }
  ],
  with_private_tier: [
    { platform: "ios", uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true },
    { platform: "android", uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true },
    { platform: "macos", uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true },
    { platform: "windows", uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true }
  ]
};
function getComplianceRequirements(tier, region) {
  const config = EXPORT_COMPLIANCE_BY_REGION.find((c) => c.region === region);
  if (config) {
    return config;
  }
  const general = EXPORT_COMPLIANCE_BY_REGION.find((c) => c.region === "general");
  return general;
}
function getThreatModel() {
  return [...THREAT_MODEL];
}
function getLaunchStrategy() {
  return [...LAUNCH_STRATEGY];
}
function isRegionSupported(region, tier) {
  const config = EXPORT_COMPLIANCE_BY_REGION.find((c) => c.region === region);
  if (!config) {
    return true;
  }
  if (tier === "standard") {
    return config.standard_tier !== "excluded";
  }
  return config.private_tier !== "excluded";
}
function getAppStoreDeclaration(platform, includes_private_tier) {
  const declarations = includes_private_tier ? APP_STORE_DECLARATIONS.with_private_tier : APP_STORE_DECLARATIONS.standard_only;
  const declaration = declarations.find((d) => d.platform === platform);
  return declaration;
}
function getProtectedThreats(tier) {
  return THREAT_MODEL.filter(
    (entry) => tier === "standard" ? entry.protected_by_standard : entry.protected_by_private
  );
}
function getUnprotectedThreats(tier) {
  return THREAT_MODEL.filter(
    (entry) => tier === "standard" ? !entry.protected_by_standard : !entry.protected_by_private
  );
}

// src/security/offline.ts
var OFFLINE_STATE_CONFIGS = {
  online: {
    state: "online",
    max_hours: Infinity,
    functionality: "full",
    sync_behavior: "realtime",
    auth_behavior: "JWT valid, full access, real-time sync",
    private_tier_key_access: true
  },
  short_offline: {
    state: "short_offline",
    max_hours: OFFLINE_THRESHOLDS.short_offline,
    functionality: "full",
    sync_behavior: "queued",
    auth_behavior: "JWT still valid (<24h), full functionality, writes queued for sync",
    private_tier_key_access: true
  },
  medium_offline: {
    state: "medium_offline",
    max_hours: OFFLINE_THRESHOLDS.medium_offline,
    functionality: "read_write_queued",
    sync_behavior: "paused",
    auth_behavior: "JWT expired, refresh token still valid (<7d), read + queued writes, sync paused",
    private_tier_key_access: true
  },
  long_offline: {
    state: "long_offline",
    max_hours: Infinity,
    functionality: "local_only",
    sync_behavior: "none",
    auth_behavior: "Refresh token expired (>7d), local data only, no sync capability",
    private_tier_key_access: true
  },
  reauth_required: {
    state: "reauth_required",
    max_hours: 0,
    functionality: "read_only",
    sync_behavior: "none",
    auth_behavior: "Must reconnect and re-authenticate to restore full functionality",
    private_tier_key_access: true
  }
};
function getOfflineStateConfig(state) {
  return OFFLINE_STATE_CONFIGS[state];
}
function calculateOfflineState(last_online, tokens) {
  const lastOnlineMs = new Date(last_online).getTime();
  const hoursSinceOnline = (Date.now() - lastOnlineMs) / (1e3 * 60 * 60);
  if (hoursSinceOnline < 0.01) {
    return "online";
  }
  const tokenValid = Date.now() < new Date(tokens.expires_at).getTime();
  if (hoursSinceOnline < OFFLINE_THRESHOLDS.short_offline && tokenValid) {
    return "short_offline";
  }
  if (hoursSinceOnline < OFFLINE_THRESHOLDS.medium_offline) {
    return "medium_offline";
  }
  return "long_offline";
}
function getOfflineCapabilities(state, tier) {
  OFFLINE_STATE_CONFIGS[state];
  switch (state) {
    case "online":
      return {
        can_read: true,
        can_write: true,
        can_search: true,
        can_sync: true,
        can_use_llm: true,
        reason: "Full connectivity - all features available"
      };
    case "short_offline":
      return {
        can_read: true,
        can_write: true,
        can_search: tier === "private",
        // Private has local search; Standard needs cloud
        can_sync: false,
        // Writes are queued
        can_use_llm: false,
        reason: `Offline <${OFFLINE_THRESHOLDS.short_offline}h - JWT valid, writes queued for sync`
      };
    case "medium_offline":
      return {
        can_read: true,
        can_write: true,
        // Writes are queued
        can_search: tier === "private",
        can_sync: false,
        can_use_llm: false,
        reason: `Offline <${OFFLINE_THRESHOLDS.medium_offline}h - JWT expired, read + queued writes`
      };
    case "long_offline":
      return {
        can_read: true,
        can_write: false,
        can_search: tier === "private",
        can_sync: false,
        can_use_llm: false,
        reason: `Offline >${OFFLINE_THRESHOLDS.medium_offline}h - local data only`
      };
    case "reauth_required":
      return {
        can_read: true,
        can_write: false,
        can_search: tier === "private",
        can_sync: false,
        can_use_llm: false,
        reason: "Re-authentication required to restore full functionality"
      };
  }
}
async function queueOfflineOperation(_operation) {
  throw new Error("queueOfflineOperation requires persistent queue storage implementation");
}
async function processOfflineQueue() {
  throw new Error("processOfflineQueue requires network and database adapter implementation");
}
async function getQueueSize() {
  throw new Error("getQueueSize requires persistent queue storage implementation");
}

export { ACCESS_TOKEN_EXPIRY_MINUTES, API_CALL_FLOWS, API_CALL_ROUTES, API_KEY_TYPES, APP_STORE_DECLARATIONS, AUTH_CALLBACK_PATH, AUTH_METHODS, AUTH_PROVIDERS, ApiCallFlowSchema, ApiCallRouteSchema, ApiKeyTypeSchema, AppStoreDeclarationSchema, AuthMethodSchema, AuthProviderSchema, AuthSecurityConfigSchema, AuthStateSchema, AuthTokensSchema, BRUTE_FORCE_LOCKOUT_ATTEMPTS, BRUTE_FORCE_LOCKOUT_MINUTES, BYOKConfigSchema, BYOKDecryptionAttemptSchema, BYOKEncryptionMethodSchema, BYOKRateLimitConfigSchema, BYOK_ENCRYPTION_METHODS, BYOK_LOCKOUT_AFTER_FAILURES, BYOK_LOCKOUT_DURATION_MINUTES, BYOK_MAX_DECRYPTIONS_PER_MINUTE, CAPTCHA_AFTER_FAILURES, CLIENT_SEARCH_PERFORMANCE, CONSENT_DURATIONS, CONSENT_EVENT_TYPES, CONSENT_REVOCATION_SCOPES, CONSENT_SCOPES, CONVERSATION_TIMEOUT_MINUTES, ClerkConfigSchema, ClientSearchConfigSchema, ConsentDialogDataSchema, ConsentDurationSchema, ConsentEventSchema, ConsentEventTypeSchema, ConsentMemoryPreviewSchema, ConsentRevocationRequestSchema, ConsentRevocationScopeSchema, ConsentScopeSchema, ConsentSettingsSchema, ConsentStateSchema, ConsentVisualIndicatorSchema, DECLINE_ACTIONS, DECLINE_MESSAGE, DEEP_LINK_SCHEME, DEFAULT_BYOK_RATE_LIMIT, DEFAULT_CLIENT_SEARCH_CONFIG_DESKTOP, DEFAULT_CLIENT_SEARCH_CONFIG_MOBILE, DEFAULT_CONSENT_SCOPE, DEFAULT_CONSENT_SETTINGS, DEFAULT_DESKTOP_CONFIG, DEFAULT_MULTI_DEVICE_SYNC, DEFAULT_ROTATION_CONFIG, DEFAULT_SECURITY_CONFIG, DEPRECATED_KEY_RETENTION_DAYS, DERIVATION_INFO_STRINGS, DESKTOP_AUTH_STEPS, DeclineResultSchema, DecryptionResultSchema, DerivedKeysSchema, DesktopAuthFlowSchema, DesktopAuthStepSchema, ECCN_CLASSIFICATION, ENCRYPTED_NODES_ADDITIONAL_SQL, ENCRYPTION_ALGORITHM, ENCRYPTION_FIELD_MAP, EXPORT_COMPLIANCE_BY_REGION, EXPORT_COMPLIANCE_STATUSES, EncryptedNodeSchemaZ, EncryptionFieldMapSchema, EncryptionResultSchema, ExportComplianceConfigSchema, ExportComplianceStatusSchema, GRACE_PERIOD_DAYS, GracePeriodStateSchema, HNSWIndexSchema, JWTValidationResultSchema, KEY_DERIVATION_FUNCTION, KEY_PURPOSES, KEY_ROTATION_TRIGGERS, KEY_VERSION_STATUSES, KeyDerivationParamsSchema, KeyHierarchySchema, KeyPurposeSchema, KeyRotationTriggerSchema, KeyVersionSchema, KeyVersionStatusSchema, LAUNCH_STRATEGY, LLMProviderSchema, LLM_PROVIDERS, LaunchPhaseSchema, LocalSearchResultSchema, MASTER_KEY_LENGTH_BITS, MFA_OPTIONS, MIGRATION_RATE_MS_PER_1K_NODES, MasterKeyInfoSchema, MfaOptionSchema, MultiDeviceKeySyncSchema, NONCE_LENGTH_BYTES, OFFLINE_FUNCTIONALITY_LEVELS, OFFLINE_STATES, OFFLINE_STATE_CONFIGS, OFFLINE_STATE_TRANSITION_REFERENCE, OFFLINE_SYNC_BEHAVIORS, OFFLINE_THRESHOLDS, OLD_CODE_ERROR_MESSAGE, OfflineCapabilityCheckSchema, OfflineFunctionalitySchema, OfflineStateConfigSchema, OfflineStateSchema, OfflineSyncBehaviorSchema, OfflineSyncQueueSchema, PASSKEY_PLATFORMS, PASSKEY_SYNC_MECHANISMS, PERFORMANCE_REFERENCE, PLATFORMS, PLATFORM_AUTH_CONFIGS, PRIVACY_TIERS, PRIVATE_TIER_NODE_LIMITS, PasskeyInfoSchema, PasskeyPlatformSchema, PlatformApiKeySchema, PlatformAuthConfigSchema, PlatformSchema, PrivacyTierSchema, QUEUEABLE_TABLES, QUEUE_OPERATION_TYPES, QueueSyncResultSchema, QueuedOperationSchema, RECOVERY_DERIVATION_INFO, RECOVERY_KEY_LENGTH_BYTES, RECOVERY_METHODS, RECOVERY_REMINDER_DAYS, RECOVERY_REMINDER_MESSAGES, RECOVERY_REMINDER_TYPES, RECOVERY_SETUP_STEPS, RECOVERY_VERIFICATION_ATTEMPT_LIMIT, RECOVERY_VERIFICATION_WORD_COUNT, RECOVERY_WORD_COUNT, REENCRYPTION_PRIORITY_ORDER, REFRESH_TOKEN_EXPIRY_DAYS, ROTATION_BATCH_SIZE, ROTATION_EVENT_TYPES, ROTATION_MAX_BATCHES_PER_MINUTE, ROTATION_MIN_BATTERY_LEVEL, ROTATION_PAUSE_BETWEEN_BATCHES_MS, ROTATION_PHASES, ROTATION_TIMING_ESTIMATES, ROTATION_TIMING_REFERENCE, ROTATION_VERIFICATION_SAMPLE_PERCENT, RecoveryAttemptSchema, RecoveryCodeSchema, RecoveryMethodSchema, RecoveryRegenerationResultSchema, RecoveryReminderSchema, RecoveryReminderTypeSchema, RecoverySetupStateSchema, RecoverySetupStepSchema, RotationConfigSchema, RotationEventSchema, RotationEventTypeSchema, RotationPhaseSchema, RotationProgressSchema, SCHEDULED_ROTATION_MONTHS, SIGN_IN_IMPLEMENTATIONS, SharedMemoryDetailSchema, SignInImplementationSchema, THREAT_MODEL, TIER_COMPARISON_TABLE, TIER_DEFINITIONS, TIER_MIGRATION_STATUSES, TOPIC_SIMILARITY_THRESHOLD, ThreatModelEntrySchema, TierComparisonSchema, TierDefinitionSchema, TierMigrationRequestSchema, TierMigrationStateSchema, TierMigrationStatusSchema, TopicConsentSchema, UserKeyMetadataSchema, backgroundReencrypt, buildLocalSearchIndex, calculateOfflineState, canContinueRotation, canMigrateTier, checkBYOKRateLimit, checkConsent, checkTopicMatch, completeRotation, createDerivationParams, decryptBYOKKey, decryptEmbedding, decryptNode, deriveAllKeys, deriveContentKey, deriveEmbeddingKey, deriveMasterKey, deriveMetadataKey, deriveRecoveryKey, dismissRecoveryReminder, encryptBYOKKey, encryptEmbedding, encryptMasterKeyForRecovery, encryptNode, estimateMigrationTime, generateRecoveryCode, generateSalt, getApiCallRoute, getApiCallRouteForKeyType, getAppStoreDeclaration, getBYOKConfig, getClerkConfig, getComplianceRequirements, getKeyVersionForNode, getLaunchStrategy, getNodesNeedingRotation, getOfflineCapabilities, getOfflineStateConfig, getPlatformAuthConfig, getProtectedThreats, getQueueSize, getRecoveryReminder, getSharedMemories, getThreatModel, getTierDefinition, getTierMigrationProgress, getUnprotectedThreats, getVerificationIndices, grantConsent, handleDecline, initiateKeyRotation, isConsentActive, isConsentScope, isGracePeriodActive, isKeyVersionStatus, isOfflineState, isPlatform, isPrivacyTier, isRegionSupported, isTokenValid, processOfflineQueue, queueOfflineOperation, recoverMasterKey, recoverViaEmail, regenerateRecoveryCode, requestConsent, resumeRotation, revokeBYOKKey, revokeConsent, rotatePlatformKey, saveRotationProgress, searchLocalIndex, shouldReauthenticate, startTierMigration, storeBYOKKey, trackBYOKDecryption, updateConsentSettings, updateOfflineState, validateJWT, verifyRecoveryWords, verifyRotation };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map