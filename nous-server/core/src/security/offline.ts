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

import {
  type OfflineState,
  type PrivacyTier,
  OFFLINE_THRESHOLDS,
} from './constants';

import {
  type OfflineStateConfig,
  type OfflineCapabilityCheck,
  type QueuedOperation,
  type QueueSyncResult,
  type AuthTokens,
} from './types';

// ============================================================
// OFFLINE STATE CONFIGURATIONS
// ============================================================

/**
 * Configuration for each of the five offline states.
 *
 * Note: Private tier passkey unlock works in ALL states because
 * the Secure Enclave is local to the device.
 *
 * @see storm-022 v1 revision Section 1 - Token Management & Offline States
 */
export const OFFLINE_STATE_CONFIGS: Record<OfflineState, OfflineStateConfig> = {
  online: {
    state: 'online',
    max_hours: Infinity,
    functionality: 'full',
    sync_behavior: 'realtime',
    auth_behavior: 'JWT valid, full access, real-time sync',
    private_tier_key_access: true,
  },
  short_offline: {
    state: 'short_offline',
    max_hours: OFFLINE_THRESHOLDS.short_offline,
    functionality: 'full',
    sync_behavior: 'queued',
    auth_behavior: 'JWT still valid (<24h), full functionality, writes queued for sync',
    private_tier_key_access: true,
  },
  medium_offline: {
    state: 'medium_offline',
    max_hours: OFFLINE_THRESHOLDS.medium_offline,
    functionality: 'read_write_queued',
    sync_behavior: 'paused',
    auth_behavior: 'JWT expired, refresh token still valid (<7d), read + queued writes, sync paused',
    private_tier_key_access: true,
  },
  long_offline: {
    state: 'long_offline',
    max_hours: Infinity,
    functionality: 'local_only',
    sync_behavior: 'none',
    auth_behavior: 'Refresh token expired (>7d), local data only, no sync capability',
    private_tier_key_access: true,
  },
  reauth_required: {
    state: 'reauth_required',
    max_hours: 0,
    functionality: 'read_only',
    sync_behavior: 'none',
    auth_behavior: 'Must reconnect and re-authenticate to restore full functionality',
    private_tier_key_access: true,
  },
} as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Gets the offline state configuration for a given state.
 *
 * @param state - The offline state to look up
 * @returns Configuration for that state
 */
export function getOfflineStateConfig(state: OfflineState): OfflineStateConfig {
  return OFFLINE_STATE_CONFIGS[state];
}

/**
 * Calculates the current offline state based on last online time and token status.
 *
 * @param last_online - ISO 8601 timestamp of last known online state
 * @param tokens - Current auth tokens (for expiry checking)
 * @returns Calculated offline state
 *
 * @see storm-022 v1 revision Section 1 - updateOfflineState()
 */
export function calculateOfflineState(
  last_online: string,
  tokens: AuthTokens,
): OfflineState {
  const lastOnlineMs = new Date(last_online).getTime();
  const hoursSinceOnline = (Date.now() - lastOnlineMs) / (1000 * 60 * 60);

  // If very recently online
  if (hoursSinceOnline < 0.01) {
    return 'online';
  }

  // Check JWT validity
  const tokenValid = Date.now() < new Date(tokens.expires_at).getTime();

  if (hoursSinceOnline < OFFLINE_THRESHOLDS.short_offline && tokenValid) {
    return 'short_offline';
  }

  if (hoursSinceOnline < OFFLINE_THRESHOLDS.medium_offline) {
    return 'medium_offline';
  }

  return 'long_offline';
}

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
export function getOfflineCapabilities(
  state: OfflineState,
  tier: PrivacyTier,
): OfflineCapabilityCheck {
  const config = OFFLINE_STATE_CONFIGS[state];

  switch (state) {
    case 'online':
      return {
        can_read: true,
        can_write: true,
        can_search: true,
        can_sync: true,
        can_use_llm: true,
        reason: 'Full connectivity - all features available',
      };

    case 'short_offline':
      return {
        can_read: true,
        can_write: true,
        can_search: tier === 'private', // Private has local search; Standard needs cloud
        can_sync: false, // Writes are queued
        can_use_llm: false,
        reason: `Offline <${OFFLINE_THRESHOLDS.short_offline}h - JWT valid, writes queued for sync`,
      };

    case 'medium_offline':
      return {
        can_read: true,
        can_write: true, // Writes are queued
        can_search: tier === 'private',
        can_sync: false,
        can_use_llm: false,
        reason: `Offline <${OFFLINE_THRESHOLDS.medium_offline}h - JWT expired, read + queued writes`,
      };

    case 'long_offline':
      return {
        can_read: true,
        can_write: false,
        can_search: tier === 'private',
        can_sync: false,
        can_use_llm: false,
        reason: `Offline >${OFFLINE_THRESHOLDS.medium_offline}h - local data only`,
      };

    case 'reauth_required':
      return {
        can_read: true,
        can_write: false,
        can_search: tier === 'private',
        can_sync: false,
        can_use_llm: false,
        reason: 'Re-authentication required to restore full functionality',
      };
  }
}

// ============================================================
// EXTERNAL SERVICE FUNCTIONS
// ============================================================

/**
 * Queues an operation for sync when back online.
 * Requires persistent queue storage.
 *
 * @param _operation - The operation to queue
 */
export async function queueOfflineOperation(
  _operation: QueuedOperation,
): Promise<void> {
  throw new Error('queueOfflineOperation requires persistent queue storage implementation');
}

/**
 * Processes the offline sync queue when connectivity is restored.
 * Requires network access and database adapter.
 *
 * @returns Sync result with counts of synced and failed operations
 */
export async function processOfflineQueue(): Promise<QueueSyncResult> {
  throw new Error('processOfflineQueue requires network and database adapter implementation');
}

/**
 * Gets the current number of queued operations.
 * Requires persistent queue storage.
 *
 * @returns Number of pending operations in the queue
 */
export async function getQueueSize(): Promise<number> {
  throw new Error('getQueueSize requires persistent queue storage implementation');
}
