/**
 * @module @nous/core/backend
 * @description Health checks — service health monitoring and readiness probes
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Pure functions for health status aggregation, HTTP status mapping,
 * and external stubs for adapter health probing.
 *
 * The /v1/health endpoint pings all adapters and aggregates their status:
 * - healthy: All services responding
 * - degraded: Some services failing (returns 503)
 * - unhealthy: Critical services down (returns 503)
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/health-checks.ts} - Spec
 */

import type { HealthStatus } from './constants';
import type { HealthCheckResponse, ServiceHealth } from './types';

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Check if all services in a health response are healthy.
 * @param response - Health check response
 * @returns True if every service is 'healthy'
 */
export function isAllHealthy(response: HealthCheckResponse): boolean {
  return Object.values(response.services).every(s => s.status === 'healthy');
}

/**
 * Determine the overall health status from individual service statuses.
 * @param services - Map of service name to health status
 * @returns Overall system status
 */
export function determineOverallHealth(services: Record<string, ServiceHealth>): HealthStatus {
  const statuses = Object.values(services).map(s => s.status);

  if (statuses.every(s => s === 'healthy')) {
    return 'healthy';
  }
  if (statuses.some(s => s === 'unhealthy')) {
    return 'unhealthy';
  }
  return 'degraded';
}

/**
 * Get the HTTP status code for a health status.
 * - healthy → 200
 * - degraded → 503
 * - unhealthy → 503
 */
export function getHttpStatusForHealth(status: HealthStatus): number {
  return status === 'healthy' ? 200 : 503;
}

// ============================================================
// EXTERNAL STUBS
// ============================================================

/**
 * Check health of all services by pinging their adapters.
 * Requires actual adapter instances.
 *
 * @param _config - Server configuration with adapter references
 * @returns Health check response
 */
export async function checkAllServices(_config: unknown): Promise<HealthCheckResponse> {
  throw new Error('checkAllServices requires adapter instances for health probing');
}

/**
 * Check health of a single service.
 * @param _service - Service name
 * @param _adapter - Adapter with ping() method
 * @returns Service health result
 */
export async function checkServiceHealth(
  _service: string,
  _adapter: { ping(): Promise<boolean> },
): Promise<ServiceHealth> {
  throw new Error('checkServiceHealth requires adapter instance for health probing');
}
