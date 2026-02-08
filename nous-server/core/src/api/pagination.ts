/**
 * @module @nous/core/api
 * @description Pagination helpers — cursor and offset normalization, result creation
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Pure functions for normalizing pagination parameters and creating pagination results.
 *
 * Two pagination strategies:
 * - Cursor-based: For sync/lists (consistent during concurrent writes)
 * - Offset-based: For search results (familiar jump-to-page UX)
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/pagination.ts} - Spec
 */

import type {
  CursorPaginationRequest,
  CursorPaginationResponse,
  OffsetPaginationRequest,
  OffsetPaginationResponse,
} from './types';

import {
  CURSOR_PAGINATION_DEFAULT_LIMIT,
  CURSOR_PAGINATION_MAX_LIMIT,
  OFFSET_PAGINATION_DEFAULT_LIMIT,
  OFFSET_PAGINATION_MAX_LIMIT,
} from './constants';

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Normalize and clamp cursor pagination parameters.
 * Applies defaults and enforces max limits.
 *
 * @param params - Raw pagination params from request
 * @returns Normalized params with valid limit
 */
export function normalizeCursorParams(params: Partial<CursorPaginationRequest>): CursorPaginationRequest {
  const limit = params.limit !== undefined
    ? Math.min(Math.max(1, params.limit), CURSOR_PAGINATION_MAX_LIMIT)
    : CURSOR_PAGINATION_DEFAULT_LIMIT;

  return {
    cursor: params.cursor,
    limit,
  };
}

/**
 * Normalize and clamp offset pagination parameters.
 * Applies defaults and enforces max limits.
 *
 * @param params - Raw pagination params from request
 * @returns Normalized params with valid offset and limit
 */
export function normalizeOffsetParams(params: Partial<OffsetPaginationRequest>): OffsetPaginationRequest {
  const offset = params.offset !== undefined
    ? Math.max(0, params.offset)
    : 0;

  const limit = params.limit !== undefined
    ? Math.min(Math.max(1, params.limit), OFFSET_PAGINATION_MAX_LIMIT)
    : OFFSET_PAGINATION_DEFAULT_LIMIT;

  return {
    offset,
    limit,
  };
}

/**
 * Create a cursor pagination response from a list of items.
 *
 * The cursor is opaque to the client (base64-encoded).
 * `has_more` is true when items.length === limit (more items may exist).
 *
 * @param items - Items returned from the query
 * @param limit - The limit that was applied
 * @param currentCursor - The cursor from the request (null for first page)
 * @param total - Optional total count (expensive to compute, omit if not needed)
 * @returns Cursor pagination metadata
 */
export function createCursorPaginationResponse(
  items: unknown[],
  limit: number,
  currentCursor: string | null,
  total?: number,
): CursorPaginationResponse {
  const hasMore = items.length >= limit;

  return {
    cursor: currentCursor,
    next_cursor: hasMore && items.length > 0 ? encodeCursor(items.length) : null,
    has_more: hasMore,
    limit,
    total,
  };
}

/**
 * Create an offset pagination response.
 *
 * @param offset - The offset that was applied
 * @param limit - The limit that was applied
 * @param total - Total count of matching items
 * @returns Offset pagination metadata
 */
export function createOffsetPaginationResponse(
  offset: number,
  limit: number,
  total: number,
): OffsetPaginationResponse {
  return {
    offset,
    limit,
    total,
    has_more: offset + limit < total,
  };
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Encode a cursor position as base64 (opaque to the client).
 */
function encodeCursor(position: number): string {
  return btoa(String(position));
}
