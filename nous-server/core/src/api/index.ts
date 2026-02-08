/**
 * @module @nous/core/api
 * @description Nous REST API — 10 resource groups, 40+ endpoints, rate limiting, SSE streaming
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Module structure:
 * - constants: Tiers, limits, SSE events, error codes, timeouts
 * - types: All interfaces and Zod schemas (consolidated)
 * - error-handling: Error creation, validation error formatting
 * - pagination: Cursor and offset pagination helpers
 * - rate-limiting: Tier ranking, Redis key building, retry calculation
 * - auth-middleware: Auth context extraction, token type detection
 * - sse-chat: Chat SSE event formatting, reconnection validation
 * - validators: Request body validation using Zod schemas
 * - data-flows: Pipeline step definitions (Chat, Sync, Ingestion)
 */

// ============================================================
// RE-EXPORTS: CONSTANTS & TYPES
// ============================================================

// Constants (enums, type guards, numeric thresholds, error codes)
export * from './constants';

// Types (all interfaces, Zod schemas)
export * from './types';

// ============================================================
// RE-EXPORTS: DOMAIN MODULES
// ============================================================

// Error handling (error creation, validation errors, content limit errors)
export * from './error-handling';

// Pagination (cursor/offset normalization, result creation)
export * from './pagination';

// Rate limiting (tier ranking, Redis keys, retry calculation, external stubs)
export * from './rate-limiting';

// Auth middleware (JWT context extraction, API key detection, external stubs)
export * from './auth-middleware';

// Chat SSE (event formatting, reconnection validation, event ID generation)
export * from './sse-chat';

// Request validators (Zod-based request body validation)
export * from './validators';

// Data flows (pipeline step definitions, flow step lookup)
export * from './data-flows';
