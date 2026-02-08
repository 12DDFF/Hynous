/**
 * @module @nous/core/operations
 * @description Error creation, classification, and notification mapping - storm-034
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-034
 * @storm Brainstorms/Infrastructure/storm-034-backend-operations
 */

import type { OpsErrorCode, OpsErrorGroup } from './constants';
import type { NousOperationalError, NotificationConfig } from './types';
import {
  OPS_ERROR_CODES,
  ERROR_GROUP_PREFIXES,
  NOTIFICATION_STRATEGY,
} from './constants';

// ============================================================
// ERROR CREATION
// ============================================================

/**
 * Create a structured operational error from a known error code.
 *
 * Looks up the code in OPS_ERROR_CODES to populate category, message,
 * userMessage, retryability, and notification channel. Merges optional
 * context for runtime debugging.
 *
 * @throws If `code` is not found in OPS_ERROR_CODES
 */
export function createOperationalError(
  code: OpsErrorCode,
  context?: Record<string, unknown>,
): NousOperationalError {
  const entry = OPS_ERROR_CODES[code];
  if (!entry) {
    throw new Error(`Unknown operational error code: ${code}`);
  }

  return {
    code,
    category: entry.category,
    message: entry.message,
    userMessage: entry.userMessage,
    retryable: entry.retryable,
    retryAfter: 'retryAfter' in entry ? (entry as { retryAfter: number }).retryAfter : undefined,
    notifyChannel: entry.notifyChannel,
    context,
  };
}

// ============================================================
// RETRYABILITY
// ============================================================

/** Check whether an operational error is retryable. */
export function isRetryableError(error: NousOperationalError): boolean {
  return error.retryable === true;
}

/** Get the suggested retry delay for a rate-limited error. */
export function getRetryAfter(error: NousOperationalError): number | undefined {
  return error.retryAfter;
}

// ============================================================
// NOTIFICATION MAPPING
// ============================================================

/**
 * Map an operational error to its notification configuration.
 *
 * Uses the error's category and notifyChannel to derive the appropriate
 * notification strategy. Falls back to a silent notification.
 */
export function getNotificationForError(
  error: NousOperationalError,
): NotificationConfig {
  // Map error category to notification strategy type
  if (error.category === 'transient') {
    const strategy = NOTIFICATION_STRATEGY['transient_error'];
    if (strategy) {
      return {
        channel: strategy.channel,
        priority: strategy.priority,
        autoDismissMs: strategy.autoDismissMs,
        action: strategy.action ? { label: strategy.action.label, handler: strategy.action.handler } : undefined,
      };
    }
  }

  // Map specific error codes to strategy types
  const group = getErrorGroup(error.code);
  if (group === 'sync') {
    const strategy = NOTIFICATION_STRATEGY['sync_failed'];
    if (strategy) {
      return {
        channel: strategy.channel,
        priority: strategy.priority,
        autoDismissMs: strategy.autoDismissMs,
        action: strategy.action ? { label: strategy.action.label, handler: strategy.action.handler } : undefined,
      };
    }
  }

  if (group === 'auth') {
    const strategy = NOTIFICATION_STRATEGY['auth_expired'];
    if (strategy) {
      return {
        channel: strategy.channel,
        priority: strategy.priority,
        autoDismissMs: strategy.autoDismissMs,
        action: strategy.action ? { label: strategy.action.label, handler: strategy.action.handler } : undefined,
      };
    }
  }

  if (error.code === 'E304') {
    const strategy = NOTIFICATION_STRATEGY['storage_full'];
    if (strategy) {
      return {
        channel: strategy.channel,
        priority: strategy.priority,
        autoDismissMs: strategy.autoDismissMs,
        action: strategy.action ? { label: strategy.action.label, handler: strategy.action.handler } : undefined,
      };
    }
  }

  if (group === 'network' && error.code === 'E601') {
    const strategy = NOTIFICATION_STRATEGY['offline'];
    if (strategy) {
      return {
        channel: strategy.channel,
        priority: strategy.priority,
        autoDismissMs: strategy.autoDismissMs,
        action: strategy.action ? { label: strategy.action.label, handler: strategy.action.handler } : undefined,
      };
    }
  }

  // Default: use the error's own notify channel
  return {
    channel: error.notifyChannel,
    priority: 'immediate',
  };
}

// ============================================================
// ERROR CLASSIFICATION
// ============================================================

/**
 * Classify a raw (possibly unknown) error into an operational error code.
 *
 * Uses heuristic matching on error message content.
 */
export function classifyError(error: unknown): OpsErrorCode {
  const msg = extractErrorMessage(error).toLowerCase();

  // Timeout classification
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
    if (msg.includes('llm') || msg.includes('openai') || msg.includes('anthropic') || msg.includes('completion')) {
      return 'E100';
    }
    if (msg.includes('embed') || msg.includes('vector')) {
      return 'E200';
    }
    if (msg.includes('db') || msg.includes('database') || msg.includes('sql')) {
      return 'E300';
    }
    return 'E600';
  }

  // Rate limit classification
  if (msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('429') || msg.includes('too many requests')) {
    if (msg.includes('embed') || msg.includes('vector')) {
      return 'E201';
    }
    return 'E101';
  }

  // Auth classification
  if (msg.includes('token expired') || msg.includes('jwt expired') || msg.includes('token_expired')) {
    return 'E500';
  }
  if (msg.includes('unauthorized') || msg.includes('401') || msg.includes('forbidden') || msg.includes('403')) {
    return 'E501';
  }

  // Sync classification
  if (msg.includes('sync') && msg.includes('conflict')) {
    return 'E401';
  }
  if (msg.includes('sync') && (msg.includes('fail') || msg.includes('error'))) {
    return 'E400';
  }

  // Network classification
  if (msg.includes('econnrefused') || msg.includes('connection refused') || msg.includes('econnreset')) {
    return 'E601';
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('enotfound') || msg.includes('dns')) {
    return 'E602';
  }

  // Database classification
  if (msg.includes('constraint') || msg.includes('unique') || msg.includes('duplicate')) {
    return 'E302';
  }
  if (msg.includes('database') || msg.includes('sql') || msg.includes('db')) {
    return 'E303';
  }

  // Storage
  if (msg.includes('quota') || msg.includes('storage full') || msg.includes('disk full')) {
    return 'E304';
  }

  // Fallback: generic database error (system_error)
  return 'E303';
}

// ============================================================
// CATEGORY CHECKS
// ============================================================

/** Check if the error is transient (temporary, likely to self-resolve). */
export function isTransientError(error: NousOperationalError): boolean {
  return error.category === 'transient';
}

/** Check if the error is caused by rate limiting. */
export function isRateLimitedError(error: NousOperationalError): boolean {
  return error.category === 'rate_limited';
}

/** Check if the error is permanent (will not resolve on retry). */
export function isPermanentError(error: NousOperationalError): boolean {
  return error.category === 'permanent';
}

/** Check if the error originated from user input or action. */
export function isUserError(error: NousOperationalError): boolean {
  return error.category === 'user_error';
}

/** Check if the error is a system/infrastructure error. */
export function isSystemError(error: NousOperationalError): boolean {
  return error.category === 'system_error';
}

// ============================================================
// ERROR GROUP RESOLUTION
// ============================================================

/**
 * Derive the error group from an error code.
 *
 * Groups by prefix: E1xx=llm, E2xx=embedding, E3xx=database,
 * E4xx=sync, E5xx=auth, E6xx=network
 */
export function getErrorGroup(code: OpsErrorCode): OpsErrorGroup {
  const prefix = code.slice(0, 2);
  const group = ERROR_GROUP_PREFIXES[prefix];
  return group ?? 'network';
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error !== null && error !== undefined && typeof (error as Record<string, unknown>).message === 'string') {
    return (error as Record<string, unknown>).message as string;
  }
  return String(error);
}
