/**
 * @module @nous/core/backend
 * @description Server configuration — route groups, middleware defaults, error handling, server factory
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Route group data, default middleware configuration, pure functions for
 * API error creation, route lookup, and auth requirement checks.
 * The createServer() stub requires a Hono framework implementation.
 *
 * Middleware application order: cors -> logging -> error -> auth -> rate_limit
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/server-config.ts} - Spec
 */

import type {
  RouteGroup,
  MiddlewareConfig,
  ServerConfig,
  ApiErrorResponse,
  HonoApp,
} from './types';

// ============================================================
// ROUTE GROUP DATA
// ============================================================

/**
 * All API route groups.
 * Each maps to a Hono sub-router via app.route(prefix, router).
 *
 * @see storm-026 spec/server-config.ts - ROUTE_GROUPS
 */
export const ROUTE_GROUPS: readonly RouteGroup[] = [
  { prefix: '/v1/nodes', description: 'Node CRUD operations', auth_required: true, rate_limited: true },
  { prefix: '/v1/edges', description: 'Edge CRUD operations', auth_required: true, rate_limited: true },
  { prefix: '/v1/search', description: 'Vector, text, and hybrid search', auth_required: true, rate_limited: true },
  { prefix: '/v1/chat', description: 'Chat with SSE streaming', auth_required: true, rate_limited: true },
  { prefix: '/v1/agent', description: 'AI agent tool execution', auth_required: true, rate_limited: true },
  { prefix: '/v1/sync', description: 'Multi-device sync protocol', auth_required: true, rate_limited: false },
  { prefix: '/v1/ingest', description: 'Content ingestion pipeline', auth_required: true, rate_limited: true },
  { prefix: '/v1/settings', description: 'User preferences and settings', auth_required: true, rate_limited: false },
  { prefix: '/v1/credits', description: 'Credit balance and transactions', auth_required: true, rate_limited: false },
  { prefix: '/v1/clusters', description: 'Memory cluster management', auth_required: true, rate_limited: true },
  { prefix: '/v1/health', description: 'Health check endpoint', auth_required: false, rate_limited: false },
] as const;

// ============================================================
// DEFAULT MIDDLEWARE CONFIGURATION
// ============================================================

/**
 * Default middleware configuration.
 * Production deployments should override corsOrigins in ServerConfig.
 *
 * @see storm-026 spec/server-config.ts - DEFAULT_MIDDLEWARE_CONFIG
 */
export const DEFAULT_MIDDLEWARE_CONFIG: MiddlewareConfig = {
  cors: {
    origins: ['*'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    headers: ['Content-Type', 'Authorization', 'Last-Event-ID'],
    credentials: true,
  },
  auth: {
    exclude_paths: ['/v1/health'],
    token_header: 'Authorization',
    token_prefix: 'Bearer ',
  },
  rateLimit: {
    requests_per_minute: 60,
    window_ms: 60_000,
    key_prefix: 'rl:',
  },
  logging: {
    level: 'info',
    format: 'json',
    include_request_id: true,
  },
  error: {
    expose_errors: false,
    sentry_dsn: undefined,
  },
} as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Create a structured API error response.
 *
 * @param code - Error code from ERROR_CODES (e.g., 'UNAUTHORIZED', 'NOT_FOUND')
 * @param message - Human-readable message
 * @param details - Optional additional details (only exposed in development)
 * @param request_id - Optional request tracking ID
 * @returns Structured ApiErrorResponse object
 */
export function createApiError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  request_id?: string,
): ApiErrorResponse {
  return {
    code,
    message,
    ...(details && { details }),
    ...(request_id && { request_id }),
  };
}

/**
 * Get the route group configuration for a prefix.
 *
 * @param prefix - Route prefix (e.g., '/v1/nodes')
 * @returns RouteGroup or undefined if not found
 */
export function getRouteGroup(prefix: string): RouteGroup | undefined {
  return ROUTE_GROUPS.find(g => g.prefix === prefix);
}

/**
 * Check if a path requires authentication.
 * Matches against ROUTE_GROUPS by prefix. If no matching group is found,
 * defaults to requiring auth (secure by default).
 *
 * @param path - Request path (e.g., '/v1/health', '/v1/nodes/abc')
 * @returns True if the path requires authentication
 */
export function requiresAuth(path: string): boolean {
  const group = ROUTE_GROUPS.find(g => path.startsWith(g.prefix));
  return group?.auth_required ?? true;
}

// ============================================================
// EXTERNAL STUBS
// ============================================================

/**
 * Create a Hono server wired with all adapters.
 * Requires Hono framework.
 *
 * @param _config - Server configuration with all adapters
 * @returns A Hono app ready to serve requests
 */
export function createServer(_config: ServerConfig): HonoApp {
  throw new Error('createServer requires Hono framework implementation');
}
