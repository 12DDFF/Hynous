/**
 * @module @nous/core/operations
 * @description Graceful degradation logic for service outages - storm-034
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-034
 * @storm Brainstorms/Infrastructure/storm-034-backend-operations
 */

import type { DegradableService } from './constants';
import type { DegradationAction } from './types';
import { DEGRADATION_MATRIX } from './constants';

// ============================================================
// FEATURE-SERVICE REQUIREMENTS
// ============================================================

/**
 * Maps features to the services they require.
 * A feature is available only when NONE of its required services are down.
 *
 * Derived from brainstorm's degradation matrix impact analysis.
 */
const FEATURE_SERVICE_REQUIREMENTS: Record<string, readonly DegradableService[]> = {
  'ai-chat': ['openai_llm', 'network'],
  'ai-extraction': ['openai_llm', 'network'],
  'ai-summarization': ['openai_llm', 'network'],
  'semantic-search': ['openai_embedding', 'network'],
  'similarity-detection': ['openai_embedding', 'network'],
  'embedding-generation': ['openai_embedding', 'network'],
  'multi-device-sync': ['turso_cloud', 'network'],
  'cloud-backup': ['turso_cloud', 'network'],
  'background-jobs': ['inngest', 'network'],
  'batch-processing': ['inngest', 'network'],
  'cached-reads': ['redis'],
  'local-search': [],
  'note-editing': [],
  'graph-browsing': [],
  'offline-queue': [],
};

// ============================================================
// DEGRADATION ACTIONS
// ============================================================

/**
 * Get the degradation action for a specific downed service.
 *
 * @throws If `service` is not found in DEGRADATION_MATRIX
 */
export function getDegradationAction(service: DegradableService): DegradationAction {
  const entry = DEGRADATION_MATRIX[service];
  if (!entry) {
    throw new Error(`Unknown degradable service: ${service}`);
  }
  return {
    service,
    impact: entry.impact,
    fallback: entry.fallback,
  };
}

/**
 * Get all active fallback actions for a set of currently-down services.
 * Deduplicates by service name.
 */
export function getActiveFallbacks(
  downServices: readonly DegradableService[],
): DegradationAction[] {
  const seen = new Set<DegradableService>();
  const actions: DegradationAction[] = [];

  for (const service of downServices) {
    if (seen.has(service)) {
      continue;
    }
    seen.add(service);

    const entry = DEGRADATION_MATRIX[service];
    if (entry) {
      actions.push({
        service,
        impact: entry.impact,
        fallback: entry.fallback,
      });
    }
  }

  return actions;
}

// ============================================================
// OFFLINE MODE DETECTION
// ============================================================

/**
 * Check if the system is in full offline mode.
 * Full offline = 'network' service is down.
 */
export function isFullOfflineMode(
  downServices: readonly DegradableService[],
): boolean {
  return (downServices as readonly string[]).includes('network');
}

// ============================================================
// FEATURE AVAILABILITY
// ============================================================

/**
 * Determine which features remain available when specific services are down.
 *
 * A feature is available only when NONE of its required services are down.
 */
export function getAvailableFeatures(
  downServices: readonly DegradableService[],
): string[] {
  const downSet = new Set<string>(downServices);
  const available: string[] = [];

  for (const [feature, requiredServices] of Object.entries(FEATURE_SERVICE_REQUIREMENTS)) {
    const isBlocked = requiredServices.some((svc) => downSet.has(svc));
    if (!isBlocked) {
      available.push(feature);
    }
  }

  return available;
}
