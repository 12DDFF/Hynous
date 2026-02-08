/**
 * @module @nous/core/backend
 * @description Observability -- structured logging, metrics, request context tracking
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Defines structured logging format, metrics configuration, and
 * request context tracking for the Nous backend.
 *
 * Observability stack:
 * - Structured JSON logging (all environments)
 * - Sentry error tracking (production)
 * - Request correlation via requestId
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/observability.ts} - Spec
 */

import type { LogLevel } from './constants';

import type {
  StructuredLogEntry,
  MetricsConfig,
  RequestContext,
} from './types';

// ============================================================
// DEFAULT CONFIGURATION
// ============================================================

/** Default metrics configuration (all enabled) */
export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  request_count: true,
  request_duration: true,
  llm_cost: true,
  embedding_count: true,
  job_queue_size: true,
} as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Create a new request context with a unique ID.
 * Generates a request ID using timestamp + random suffix for uniqueness.
 * @returns Fresh request context with requestId and startTime set
 */
export function createRequestContext(): RequestContext {
  return {
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    startTime: Date.now(),
  };
}

/**
 * Format a structured log entry as a JSON string.
 * Used by the logging middleware to emit structured logs.
 * @param entry - Log entry to format
 * @returns JSON string representation of the log entry
 */
export function formatLogEntry(entry: StructuredLogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Calculate request duration from context.
 * @param context - Request context with start time
 * @returns Duration in milliseconds since the request started
 */
export function calculateRequestDuration(context: RequestContext): number {
  return Date.now() - context.startTime;
}

/**
 * Check if a log level should be emitted given the configured minimum.
 * Uses ordered severity comparison: debug < info < warn < error < fatal.
 * @param level - Log level to check
 * @param minLevel - Minimum configured log level
 * @returns True if the level should be logged
 */
export function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  const levels: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
  return levels.indexOf(level) >= levels.indexOf(minLevel);
}
