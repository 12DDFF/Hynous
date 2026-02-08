/**
 * @module @nous/core/operations
 * @description Network status evaluation and offline queue management - storm-034
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-034
 * @storm Brainstorms/Infrastructure/storm-034-backend-operations
 */

import type { NetworkStatus, OfflineQueueOpType } from './constants';
import type { QueuedOperation } from './types';
import {
  NETWORK_MONITOR_CONFIG,
  OFFLINE_QUEUE_CONFIG,
} from './constants';

// ============================================================
// NETWORK STATUS EVALUATION
// ============================================================

/**
 * Evaluate the current network status based on consecutive failure/success counts.
 *
 * State transitions (from brainstorm):
 * - 3 consecutive failures -> offline
 * - 1 success from offline -> online
 * - < threshold with no definitive signal -> unknown
 */
export function evaluateNetworkStatus(
  consecutiveFailures: number,
  consecutiveSuccesses: number,
): NetworkStatus {
  // Check for offline threshold (3 failures)
  if (consecutiveFailures >= NETWORK_MONITOR_CONFIG.offlineThreshold) {
    return 'offline';
  }

  // Check for online threshold (1 success)
  if (consecutiveSuccesses >= NETWORK_MONITOR_CONFIG.onlineThreshold) {
    return 'online';
  }

  return 'unknown';
}

/**
 * Check if consecutive failures have crossed the offline threshold.
 */
export function shouldGoOffline(consecutiveFailures: number): boolean {
  return consecutiveFailures >= NETWORK_MONITOR_CONFIG.offlineThreshold;
}

/**
 * Check if the system should transition back to online.
 * Only returns `true` when the system is not already online.
 */
export function shouldGoOnline(
  currentStatus: NetworkStatus,
  successCount: number,
): boolean {
  if (currentStatus === 'online') {
    return false;
  }
  return successCount >= NETWORK_MONITOR_CONFIG.onlineThreshold;
}

// ============================================================
// OFFLINE QUEUE MANAGEMENT
// ============================================================

/**
 * Create a new queued operation for offline processing.
 *
 * Auto-generates: id, createdAt, priority, attempts=0, _schemaVersion=1
 */
export function createQueuedOperation(
  tenantId: string,
  type: OfflineQueueOpType,
  payload: unknown,
): QueuedOperation {
  return {
    _schemaVersion: 1,
    id: generateQueueId(),
    tenantId,
    type,
    payload,
    priority: getQueuePriority(type),
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
}

/**
 * Get the numeric priority for an offline queue operation type.
 *
 * Uses index in OFFLINE_QUEUE_CONFIG.priorityOrder:
 * sync=0, embed=1, edge=2, other=3
 */
export function getQueuePriority(type: OfflineQueueOpType): number {
  const index = (OFFLINE_QUEUE_CONFIG.priorityOrder as readonly string[]).indexOf(type);
  return index >= 0 ? index : OFFLINE_QUEUE_CONFIG.priorityOrder.length;
}

/**
 * Check if the offline queue for a tenant has reached capacity.
 */
export function isQueueFull(currentCount: number): boolean {
  return currentCount >= OFFLINE_QUEUE_CONFIG.maxItemsPerTenant;
}

/**
 * Check if a queue entry has exceeded the maximum age (7 days).
 */
export function isQueueEntryExpired(createdAt: string, now?: Date): boolean {
  const created = new Date(createdAt).getTime();
  const reference = (now ?? new Date()).getTime();
  const maxAgeMs = OFFLINE_QUEUE_CONFIG.maxAgeHours * 60 * 60 * 1000;
  return reference - created > maxAgeMs;
}

/**
 * Sort queued operations by priority (ascending) then by creation time
 * (ascending, oldest first).
 *
 * Does not mutate the input array.
 */
export function sortQueueByPriority(
  operations: readonly QueuedOperation[],
): QueuedOperation[] {
  return [...operations].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function generateQueueId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${hex()}-${hex()}${hex()}${hex()}`;
}
