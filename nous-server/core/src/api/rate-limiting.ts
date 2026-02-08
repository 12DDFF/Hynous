/**
 * @module @nous/core/api
 * @description Rate limiting pure functions and data — tier ranking, Redis key building, retry calculation
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Pure functions for the rate limiting system. These operate on data structures
 * defined in types.ts. Actual Redis I/O happens in the application layer via
 * the RateLimitRedisOps interface.
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/rate-limiting.ts} - Spec
 */

import type { UserTier } from './constants';
import type { RateLimitResult, RateLimitHeaders } from './types';

// ============================================================
// TIER TRANSITION
// ============================================================

/**
 * Tier rank mapping for upgrade/downgrade detection.
 * Higher rank = higher tier. Used to determine tier transition behavior:
 * - Upgrade (rank increases): Apply new higher limits immediately
 * - Downgrade (rank decreases): Wait for current window to reset
 */
export const TIER_RANKS: Record<UserTier, number> = {
  free: 0,
  api_key: 1,
  credits: 2,
  pro: 3,
};

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Get the numeric rank for a user tier.
 * Used for upgrade/downgrade comparison.
 *
 * @param tier - User tier
 * @returns Numeric rank (0 = lowest, 3 = highest)
 *
 * @example
 * ```typescript
 * tierRank('pro')     // 3
 * tierRank('free')    // 0
 * tierRank('pro') > tierRank('free') // true (upgrade)
 * ```
 */
export function tierRank(tier: UserTier): number {
  return TIER_RANKS[tier];
}

/**
 * Build a Redis key from a pattern by substituting placeholders.
 *
 * @param pattern - Key pattern with `{placeholder}` syntax
 * @param params - Values to substitute
 * @returns Fully resolved Redis key
 *
 * @example
 * ```typescript
 * buildRedisKey('ratelimit:api:{user_id}', { user_id: 'user_123' })
 * // => 'ratelimit:api:user_123'
 * ```
 */
export function buildRedisKey(pattern: string, params: Record<string, string>): string {
  let key = pattern;
  for (const [name, value] of Object.entries(params)) {
    key = key.replace(`{${name}}`, value);
  }
  return key;
}

/**
 * Calculate retry_after for a sliding window that is full.
 * Returns the number of seconds until the oldest request in the window expires.
 *
 * @param windowMs - Window duration in milliseconds
 * @param oldestTimestamp - Oldest request timestamp in the window (ms since epoch)
 * @returns Seconds to wait before retrying
 */
export function calculateRetryAfter(windowMs: number, oldestTimestamp: number): number {
  const now = Date.now();
  const expiresAt = oldestTimestamp + windowMs;
  const retryMs = Math.max(0, expiresAt - now);
  return Math.ceil(retryMs / 1000);
}

/**
 * Calculate retry_after for a token bucket that is empty.
 * Returns the number of seconds until enough tokens are refilled.
 *
 * @param tokensNeeded - Number of tokens needed
 * @param refillRate - Tokens per second
 * @returns Seconds to wait before retrying
 */
export function calculateTokenBucketRetryAfter(tokensNeeded: number, refillRate: number): number {
  if (refillRate <= 0) return 60; // Safety fallback
  return Math.ceil(tokensNeeded / refillRate);
}

/**
 * Format rate limit response headers from a check result.
 *
 * @param result - Rate limit check result
 * @param windowSeconds - Window duration in seconds (default 60)
 * @returns Headers object to merge into HTTP response
 */
export function formatRateLimitHeaders(result: RateLimitResult, windowSeconds: number = 60): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    'X-RateLimit-Limit': result.limit,
    'X-RateLimit-Remaining': result.remaining,
    'X-RateLimit-Reset': Math.floor(new Date(result.reset_at).getTime() / 1000),
    'X-RateLimit-Window': windowSeconds,
  };

  if (!result.allowed && result.retry_after !== undefined) {
    headers['Retry-After'] = result.retry_after;
  }

  return headers;
}

// ============================================================
// EXTERNAL STUBS (I/O-BOUND)
// ============================================================

/**
 * Check rate limit for a request (orchestrates all limit checks).
 *
 * **EXTERNAL STUB** — requires Redis client and database access.
 *
 * @param _userId - User ID
 * @param _tier - User tier from JWT/API key
 * @param _endpoint - Request endpoint (e.g. 'POST /v1/chat')
 * @returns Most restrictive rate limit result
 */
export function checkRateLimit(
  _userId: string,
  _tier: UserTier,
  _endpoint: string
): Promise<RateLimitResult> {
  throw new Error('checkRateLimit: External stub — implement in application layer');
}

/**
 * Get user tier with caching for tier transition detection.
 *
 * **EXTERNAL STUB** — requires database access.
 *
 * @param _userId - User ID
 * @param _cacheTtlSeconds - Cache TTL (default 60s)
 * @returns Current user tier from database
 */
export function getTierWithCache(
  _userId: string,
  _cacheTtlSeconds: number = 60
): Promise<UserTier> {
  throw new Error('getTierWithCache: External stub — implement in application layer');
}
