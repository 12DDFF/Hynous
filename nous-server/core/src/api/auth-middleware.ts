/**
 * @module @nous/core/api
 * @description Auth context extraction — JWT claims parsing, API key detection, token expiry check
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Pure functions for extracting authentication context from JWT tokens and API keys.
 *
 * Dual auth modes:
 * - JWT (Clerk): 15-minute access token, 30-day refresh. Contains tier + privacy in metadata.
 * - API Key: Prefixed with `sk_live_` or `sk_test_`. Separate rate bucket (api_key tier).
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/auth-middleware.ts} - Spec
 */

import type { AuthContext, JWTClaims } from './types';
import { API_KEY_PREFIX_LIVE, API_KEY_PREFIX_TEST } from './constants';

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Extract an AuthContext from validated JWT claims.
 *
 * Called after the JWT has been validated by Clerk. Extracts
 * user ID, tier, and privacy tier from the token claims.
 *
 * @param claims - Validated JWT claims from Clerk
 * @returns AuthContext for route handlers
 */
export function extractAuthContextFromJWT(claims: JWTClaims): AuthContext {
  return {
    user_id: claims.sub,
    tier: claims.metadata.tier,
    privacy_tier: claims.metadata.privacy,
    auth_method: 'jwt',
  };
}

/**
 * Check if a token string is an API key (starts with sk_live_ or sk_test_).
 *
 * @param token - Raw token from the Authorization header
 * @returns true if the token is an API key
 */
export function isApiKeyToken(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX_LIVE) || token.startsWith(API_KEY_PREFIX_TEST);
}

/**
 * Check if a JWT token has expired.
 *
 * @param claims - JWT claims (only needs `exp` field)
 * @returns true if the token's exp timestamp is in the past
 */
export function isTokenExpired(claims: Pick<JWTClaims, 'exp'>): boolean {
  return claims.exp * 1000 < Date.now();
}

// ============================================================
// EXTERNAL STUBS (I/O-BOUND)
// ============================================================

/**
 * Validate an auth token (JWT or API key) and return the AuthContext.
 *
 * **EXTERNAL STUB** — requires Clerk SDK or database access for API key validation.
 *
 * @param _token - Raw token from the Authorization header
 * @returns AuthContext extracted from the validated token
 */
export function validateAuthToken(_token: string): Promise<AuthContext> {
  throw new Error('validateAuthToken: External stub — implement in application layer');
}
