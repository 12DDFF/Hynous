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

import {
  type ApiKeyType,
  type LLMProvider,
  type PrivacyTier,
  BYOK_MAX_DECRYPTIONS_PER_MINUTE,
  BYOK_LOCKOUT_AFTER_FAILURES,
  BYOK_LOCKOUT_DURATION_MINUTES,
} from './constants';

import {
  type ApiCallRoute,
  type BYOKConfig,
  type BYOKRateLimitConfig,
} from './types';

// ============================================================
// API CALL ROUTES
// ============================================================

/**
 * Predefined API call routes for each key type.
 *
 * @see storm-022 v1 revision Section 6 - API Call Flow diagrams
 */
export const API_CALL_ROUTES: Record<ApiKeyType, ApiCallRoute> = {
  platform: {
    key_type: 'platform',
    flow: 'proxied',
    rate_limited: true,
    usage_logged: true,
  },
  byok: {
    key_type: 'byok',
    flow: 'direct',
    rate_limited: true,
    usage_logged: false,
  },
} as const;

// ============================================================
// BYOK RATE LIMIT CONFIG
// ============================================================

/**
 * Default BYOK rate limit configuration from brainstorm.
 *
 * @see storm-022 v1 revision Section 6 - Rate Limiting (BYOK)
 */
export const DEFAULT_BYOK_RATE_LIMIT: BYOKRateLimitConfig = {
  max_decryptions_per_minute: BYOK_MAX_DECRYPTIONS_PER_MINUTE,
  exponential_backoff: true,
  lockout_after_failures: BYOK_LOCKOUT_AFTER_FAILURES,
  lockout_duration_minutes: BYOK_LOCKOUT_DURATION_MINUTES,
} as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Gets the API call route for a given key type.
 *
 * @param keyType - 'platform' or 'byok'
 * @returns Routing configuration
 */
export function getApiCallRouteForKeyType(keyType: ApiKeyType): ApiCallRoute {
  return API_CALL_ROUTES[keyType];
}

// ============================================================
// EXTERNAL SERVICE FUNCTIONS
// ============================================================

/**
 * Encrypts a BYOK API key for storage.
 * Requires Web Crypto API.
 *
 * @param _api_key - Plaintext API key string
 * @param _encryption_key - CryptoKey to encrypt with
 * @returns Encrypted key bytes
 */
export async function encryptBYOKKey(
  _api_key: string,
  _encryption_key: CryptoKey,
): Promise<Uint8Array> {
  throw new Error('encryptBYOKKey requires Web Crypto API implementation');
}

/**
 * Decrypts a BYOK API key from storage.
 * Requires Web Crypto API.
 *
 * @param _encrypted - Encrypted key bytes
 * @param _encryption_key - CryptoKey to decrypt with
 * @returns Plaintext API key string
 */
export async function decryptBYOKKey(
  _encrypted: Uint8Array,
  _encryption_key: CryptoKey,
): Promise<string> {
  throw new Error('decryptBYOKKey requires Web Crypto API implementation');
}

/**
 * Determines the API call route for a user and provider.
 * Requires server-side BYOK config lookup.
 *
 * @param _user_id - User making the call
 * @param _provider - LLM provider
 * @returns Routing configuration
 */
export async function getApiCallRoute(
  _user_id: string,
  _provider: LLMProvider,
): Promise<ApiCallRoute> {
  throw new Error('getApiCallRoute requires server-side BYOK config lookup');
}

/**
 * Checks if a BYOK decryption attempt is allowed (rate limit check).
 * Requires rate limit state tracking.
 *
 * @param _user_id - User attempting decryption
 * @returns True if decryption is allowed
 */
export async function checkBYOKRateLimit(
  _user_id: string,
): Promise<boolean> {
  throw new Error('checkBYOKRateLimit requires rate limit state tracking');
}

/**
 * Records a BYOK decryption attempt for rate limiting.
 * Requires rate limit state tracking.
 *
 * @param _user_id - User who attempted decryption
 * @param _success - Whether decryption succeeded
 */
export function trackBYOKDecryption(
  _user_id: string,
  _success: boolean,
): void {
  throw new Error('trackBYOKDecryption requires rate limit state tracking');
}

/**
 * Rotates a platform API key for a provider.
 * Requires server-side key management.
 *
 * @param _provider - LLM provider to rotate key for
 */
export async function rotatePlatformKey(
  _provider: LLMProvider,
): Promise<void> {
  throw new Error('rotatePlatformKey requires server-side key management');
}

/**
 * Gets the BYOK configuration for a user and provider.
 * Requires server-side BYOK storage.
 *
 * @param _user_id - User to check
 * @param _provider - LLM provider
 * @returns BYOK config or null
 */
export async function getBYOKConfig(
  _user_id: string,
  _provider: LLMProvider,
): Promise<BYOKConfig | null> {
  throw new Error('getBYOKConfig requires server-side BYOK storage');
}

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
export async function storeBYOKKey(
  _user_id: string,
  _provider: LLMProvider,
  _api_key: string,
  _tier: PrivacyTier,
): Promise<BYOKConfig> {
  throw new Error('storeBYOKKey requires Web Crypto API and server-side storage');
}

/**
 * Removes a BYOK key for a user.
 * Requires server-side key deletion.
 *
 * @param _user_id - User revoking the key
 * @param _provider - LLM provider
 */
export async function revokeBYOKKey(
  _user_id: string,
  _provider: LLMProvider,
): Promise<void> {
  throw new Error('revokeBYOKKey requires server-side key deletion');
}
