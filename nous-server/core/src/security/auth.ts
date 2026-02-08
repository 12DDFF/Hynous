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

import {
  type Platform,
  type OfflineState,
  type SignInImplementation,
  OFFLINE_THRESHOLDS,
  ACCESS_TOKEN_EXPIRY_MINUTES,
  BRUTE_FORCE_LOCKOUT_ATTEMPTS,
  BRUTE_FORCE_LOCKOUT_MINUTES,
  CAPTCHA_AFTER_FAILURES,
  DEEP_LINK_SCHEME,
  AUTH_CALLBACK_PATH,
} from './constants';

import {
  type AuthState,
  type AuthTokens,
  type PlatformAuthConfig,
  type AuthSecurityConfig,
  type JWTValidationResult,
  type ClerkConfig,
} from './types';

// ============================================================
// PLATFORM AUTH CONFIGURATIONS
// ============================================================

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
export const PLATFORM_AUTH_CONFIGS: Record<Platform, PlatformAuthConfig> = {
  ios: {
    platform: 'ios',
    apple_sign_in: 'native',
    google_sign_in: 'native',
    email_password: 'clerk_ui',
  },
  android: {
    platform: 'android',
    apple_sign_in: 'rest_api',
    google_sign_in: 'native',
    email_password: 'clerk_ui',
  },
  macos: {
    platform: 'macos',
    apple_sign_in: 'native',
    google_sign_in: 'oauth',
    email_password: 'clerk_web',
  },
  windows: {
    platform: 'windows',
    apple_sign_in: 'oauth',
    google_sign_in: 'oauth',
    email_password: 'clerk_web',
  },
} as const;

// ============================================================
// DEFAULT SECURITY CONFIG
// ============================================================

/**
 * Default security configuration from brainstorm.
 *
 * @see storm-022 v1 revision Section 1 - Security Measures table
 */
export const DEFAULT_SECURITY_CONFIG: AuthSecurityConfig = {
  brute_force_lockout_attempts: BRUTE_FORCE_LOCKOUT_ATTEMPTS,
  brute_force_lockout_minutes: BRUTE_FORCE_LOCKOUT_MINUTES,
  captcha_after_failures: CAPTCHA_AFTER_FAILURES,
  new_device_email_alert: true,
  invalidate_sessions_on_password_change: true,
  mfa_options: ['totp', 'sms', 'passkey'],
} as const;

// ============================================================
// DEFAULT DESKTOP CONFIG
// ============================================================

/**
 * Default desktop (Tauri) Clerk configuration.
 */
export const DEFAULT_DESKTOP_CONFIG = {
  oauth_redirect_uri: `${DEEP_LINK_SCHEME}://${AUTH_CALLBACK_PATH}`,
  deep_link_scheme: DEEP_LINK_SCHEME,
} as const;

// ============================================================
// OFFLINE STATE TRANSITION REFERENCE
// ============================================================

/**
 * Reference descriptions for offline state transitions.
 *
 * @see storm-022 v1 revision Section 1 - State transitions
 */
export const OFFLINE_STATE_TRANSITION_REFERENCE = {
  online: 'Full functionality',
  short_offline: `<${OFFLINE_THRESHOLDS.short_offline}h, JWT valid, full functionality`,
  medium_offline: `<${OFFLINE_THRESHOLDS.medium_offline}h, JWT expired, read-only + queued writes`,
  long_offline: `>${OFFLINE_THRESHOLDS.medium_offline}h, refresh expired, local only`,
  reauth_required: 'Must reconnect to continue',
} as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Checks if the access token is still valid (not expired).
 *
 * @param tokens - Current auth tokens
 * @returns True if access token has not expired
 */
export function isTokenValid(tokens: AuthTokens): boolean {
  const expiresAt = new Date(tokens.expires_at).getTime();
  return Date.now() < expiresAt;
}

/**
 * Determines if re-authentication is required.
 * True when refresh token has expired (>30 days).
 *
 * @param auth - Current auth state
 * @returns True if re-auth is needed
 */
export function shouldReauthenticate(auth: AuthState): boolean {
  const lastOnline = new Date(auth.last_online).getTime();
  const hoursSinceOnline = (Date.now() - lastOnline) / (1000 * 60 * 60);
  return hoursSinceOnline >= OFFLINE_THRESHOLDS.medium_offline;
}

/**
 * Calculates the current offline state based on time since last online
 * and token validity.
 *
 * @param auth - Current auth state
 * @returns Updated offline state
 *
 * @see storm-022 v1 revision Section 1 - updateOfflineState() implementation
 */
export function updateOfflineState(auth: AuthState): OfflineState {
  const lastOnline = new Date(auth.last_online).getTime();
  const hoursSinceOnline = (Date.now() - lastOnline) / (1000 * 60 * 60);

  // If very recently online (within margin), treat as online
  if (hoursSinceOnline < 0.01) {
    return 'online';
  }

  if (hoursSinceOnline < OFFLINE_THRESHOLDS.short_offline && isTokenValid(auth.tokens)) {
    return 'short_offline';
  }

  if (hoursSinceOnline < OFFLINE_THRESHOLDS.medium_offline) {
    return 'medium_offline';
  }

  return 'long_offline';
}

/**
 * Gets the platform auth configuration for a specific platform.
 *
 * @param platform - Target platform
 * @returns Platform auth config
 */
export function getPlatformAuthConfig(platform: Platform): PlatformAuthConfig {
  return PLATFORM_AUTH_CONFIGS[platform];
}

// ============================================================
// EXTERNAL SERVICE FUNCTIONS
// ============================================================

/**
 * Gets the Clerk configuration for a specific platform.
 * Requires Clerk SDK integration.
 *
 * @param _platform - Target platform
 * @returns Clerk config for that platform
 */
export function getClerkConfig(_platform: Platform): ClerkConfig {
  throw new Error('getClerkConfig requires Clerk SDK integration');
}

/**
 * Validates a JWT token against Clerk's public keys.
 * Requires Clerk SDK or JWKS endpoint.
 *
 * @param _token - JWT access token
 * @returns Validation result with user_id if valid
 */
export async function validateJWT(_token: string): Promise<JWTValidationResult> {
  throw new Error('validateJWT requires Clerk SDK implementation');
}
