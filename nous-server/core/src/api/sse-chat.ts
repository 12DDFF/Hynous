/**
 * @module @nous/core/api
 * @description Chat SSE event formatting — event serialization, reconnection validation, event IDs
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Pure functions for Server-Sent Events (SSE) in the chat endpoint.
 *
 * SSE event types (10):
 * session_start -> retrieval_start -> retrieval_node (xN) -> retrieval_complete
 *   -> response_start -> response_chunk (xN) -> response_complete -> done
 * Plus: ping (keepalive every 15s), session_expired (reconnection too late)
 *
 * Reconnection: Client sends Last-Event-ID header. Server resumes if within 5-minute window.
 *
 * Chat SSE runs on regional containers (120s max), NOT edge workers (25s max from storm-026).
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/sse-chat.ts} - Spec
 */

import type { ChatSSEEventType } from './constants';
import { CHAT_SSE_RECONNECT_WINDOW_MS } from './constants';

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Format a chat SSE event for transmission over the wire.
 *
 * SSE wire format:
 * ```
 * event: <type>
 * id: <eventId>
 * data: <JSON>
 *
 * ```
 *
 * @param eventType - One of the 10 chat SSE event types
 * @param data - Event payload (will be JSON.stringify'd)
 * @param eventId - Unique event ID for reconnection support
 * @returns SSE-formatted string ready to write to response stream
 */
export function formatChatSSEEvent(
  eventType: ChatSSEEventType,
  data: unknown,
  eventId: string,
): string {
  return `event: ${eventType}\nid: ${eventId}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Check if a reconnection attempt is within the allowed time window.
 *
 * When a client reconnects with a Last-Event-ID, the server checks if the
 * original session is still within the reconnection window (default 5 minutes).
 *
 * @param lastEventTimestamp - Timestamp (ms since epoch) of the last event sent
 * @param windowMs - Reconnection window in milliseconds (default: CHAT_SSE_RECONNECT_WINDOW_MS = 300,000)
 * @returns true if the reconnection is within the allowed window
 */
export function isReconnectionValid(
  lastEventTimestamp: number,
  windowMs: number = CHAT_SSE_RECONNECT_WINDOW_MS,
): boolean {
  return Date.now() - lastEventTimestamp < windowMs;
}

/**
 * Generate a sequential event ID for SSE events.
 *
 * Format: `{prefix}_{sequence}` where sequence is zero-padded to 3 digits.
 *
 * @param prefix - Session prefix (e.g., session ID)
 * @param sequence - Sequential event number (0-indexed)
 * @returns Event ID string (e.g., "sess_abc_001")
 */
export function generateEventId(prefix: string, sequence: number): string {
  return `${prefix}_${sequence.toString().padStart(3, '0')}`;
}
