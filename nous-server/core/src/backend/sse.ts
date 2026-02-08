/**
 * @module @nous/core/backend
 * @description SSE streaming -- event formatting, reconnection, edge timeout strategy
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Server-Sent Events (SSE) streaming utilities for the Nous API.
 * Handles Cloudflare Workers' 30-second connection limit by:
 * 1. Capping streams at 25 seconds
 * 2. Sending timeout events with last event ID
 * 3. Supporting client reconnection via Last-Event-ID header
 * 4. Sending heartbeat pings every 15 seconds to keep connections alive
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/sse-streaming.ts} - Spec
 */

import type {
  SSEEvent,
  SSEOptions,
  SSEStreamState,
} from './types';

// ============================================================
// DEFAULT CONFIGURATION
// ============================================================

/** Default SSE options */
export const DEFAULT_SSE_OPTIONS: Required<SSEOptions> = {
  maxDurationMs: 25_000,
  heartbeatMs: 15_000,
  reconnectable: true,
} as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Format an SSE event as a string for the wire protocol.
 * Produces the standard SSE text format with event, optional id, and data fields.
 *
 * @example
 * formatSSEEvent({ event: 'data', id: '1', data: '{"token":"hello"}' })
 * // => 'event: data\nid: 1\ndata: {"token":"hello"}\n\n'
 *
 * @param event - SSE event to format
 * @returns Wire-format string ready to be written to the response stream
 */
export function formatSSEEvent(event: SSEEvent): string {
  let result = `event: ${event.event}\n`;
  if (event.id !== undefined) {
    result += `id: ${event.id}\n`;
  }
  result += `data: ${event.data}\n\n`;
  return result;
}

/**
 * Parse the Last-Event-ID header for reconnection.
 * Returns undefined for empty or missing header values.
 * @param header - Value of the Last-Event-ID header
 * @returns The trimmed event ID string, or undefined if not present
 */
export function parseLastEventId(header: string | undefined): string | undefined {
  if (!header || header.trim() === '') {
    return undefined;
  }
  return header.trim();
}

/**
 * Create initial SSE stream state.
 * Initializes event counter at 0, records start time, and parses
 * the Last-Event-ID header for reconnection support.
 * @param lastEventIdHeader - Value of Last-Event-ID header (for reconnection)
 * @returns Initial stream state
 */
export function createSSEStreamState(lastEventIdHeader?: string): SSEStreamState {
  return {
    eventId: 0,
    startTime: Date.now(),
    lastEventId: parseLastEventId(lastEventIdHeader),
    closed: false,
  };
}

/**
 * Check if an SSE stream has exceeded its maximum duration.
 * Used to proactively close streams before Cloudflare's 30s limit.
 * @param state - Current stream state
 * @param maxDurationMs - Maximum duration in milliseconds
 * @returns True if the stream should be closed
 */
export function isStreamExpired(state: SSEStreamState, maxDurationMs: number): boolean {
  return (Date.now() - state.startTime) > maxDurationMs;
}

// ============================================================
// EXTERNAL STUBS
// ============================================================

/**
 * Create an SSE stream response.
 * Requires Hono's streamSSE utility for actual implementation.
 *
 * @param _context - Hono request context
 * @param _generator - Async generator producing stream chunks
 * @param _options - SSE configuration options
 * @returns HTTP Response with SSE content type
 */
export function createSSEStream(
  _context: unknown,
  _generator: AsyncGenerator<unknown>,
  _options?: SSEOptions,
): Promise<Response> {
  throw new Error('createSSEStream requires Hono framework implementation');
}
