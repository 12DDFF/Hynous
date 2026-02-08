/**
 * @module @nous/core/api
 * @description Error creation and formatting — extended API errors, validation errors, content limit errors
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Pure functions for creating structured error responses.
 * Extends storm-026's base ApiErrorResponse with retry_after, docs_url, and field-level validation.
 *
 * Error response variants:
 * 1. Standard error — code, message, request_id, docs_url
 * 2. Rate limit 429 — adds retry_after, limit, remaining, window, reset_at
 * 3. Validation error — adds details.fields[] with per-field errors
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/error-handling.ts} - Spec
 */

import type { ApiErrorCode } from './constants';
import type {
  ApiErrorResponseExtended,
  ValidationFieldError,
  ContentLimitsInfo,
} from './types';

import { API_ERROR_CODES, CONTENT_LIMITS } from './constants';

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Get the HTTP status code for an API error code.
 *
 * @param code - One of the 17 API error codes
 * @returns HTTP status code (400, 401, 403, 404, 409, 422, 429, 500, 502, 503)
 */
export function getHttpStatusForErrorCode(code: ApiErrorCode): number {
  return API_ERROR_CODES[code].status;
}

/**
 * Get the documentation URL for an error code.
 *
 * @param code - API error code
 * @returns URL to the error documentation page
 */
export function getDocsUrl(code: ApiErrorCode): string {
  return `https://docs.nous.app/errors/${code}`;
}

/**
 * Get the content size limits for node creation/update validation.
 *
 * @returns Content limits reference with title, body_soft, body_hard, summary
 */
export function getContentLimits(): ContentLimitsInfo {
  return {
    title: CONTENT_LIMITS.title,
    body_soft: CONTENT_LIMITS.body_soft,
    body_hard: CONTENT_LIMITS.body_hard,
    summary: CONTENT_LIMITS.summary,
  };
}

/**
 * Create an extended API error response with optional rate-limit and retry fields.
 *
 * @param code - API error code
 * @param message - Human-readable error message
 * @param options - Optional fields: request_id, retry_after, docs_url override
 * @returns Structured error response
 */
export function createExtendedApiError(
  code: ApiErrorCode,
  message: string,
  options?: {
    request_id?: string;
    retry_after?: number;
    details?: Record<string, unknown>;
    docs_url?: string;
  },
): ApiErrorResponseExtended {
  return {
    code,
    message,
    request_id: options?.request_id ?? '',
    retry_after: options?.retry_after,
    details: options?.details,
    docs_url: options?.docs_url ?? getDocsUrl(code),
  };
}

/**
 * Create a VALIDATION_ERROR response with field-level error details.
 *
 * @param fields - Array of field validation errors
 * @param requestId - Optional request ID for tracing
 * @returns Structured validation error response
 */
export function createValidationError(
  fields: ValidationFieldError[],
  requestId?: string,
): ApiErrorResponseExtended {
  return createExtendedApiError('VALIDATION_ERROR', API_ERROR_CODES.VALIDATION_ERROR.message, {
    request_id: requestId,
    details: { fields },
  });
}

/**
 * Create a CONTENT_LIMIT_EXCEEDED error for a specific field.
 *
 * @param field - Field name that exceeded the limit (e.g., 'content.title')
 * @param limit - The limit that was exceeded
 * @param actual - The actual size of the content
 * @param requestId - Optional request ID for tracing
 * @returns Structured content limit error response
 */
export function createContentLimitError(
  field: string,
  limit: number,
  actual: number,
  requestId?: string,
): ApiErrorResponseExtended {
  return createExtendedApiError(
    'CONTENT_LIMIT_EXCEEDED',
    API_ERROR_CODES.CONTENT_LIMIT_EXCEEDED.message,
    {
      request_id: requestId,
      details: {
        field,
        limit,
        actual,
        limits: getContentLimits(),
      },
    },
  );
}

/**
 * Create a BATCH_SIZE_EXCEEDED error.
 *
 * @param maxSize - Maximum allowed batch size
 * @param actualSize - Actual batch size submitted
 * @param requestId - Optional request ID for tracing
 * @returns Structured batch size error response
 */
export function createBatchSizeError(
  maxSize: number,
  actualSize: number,
  requestId?: string,
): ApiErrorResponseExtended {
  return createExtendedApiError(
    'BATCH_SIZE_EXCEEDED',
    API_ERROR_CODES.BATCH_SIZE_EXCEEDED.message,
    {
      request_id: requestId,
      details: {
        max_size: maxSize,
        actual_size: actualSize,
      },
    },
  );
}
