/**
 * @module @nous/core/backend
 * @description Nous Backend Infrastructure — adapters, jobs, config, deployment, health
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Modular backend infrastructure with swappable adapters, tiered job system,
 * Zod-validated configuration, health monitoring, and deployment targets.
 *
 * Module structure:
 * - constants: Deployment targets, job tiers, SSE limits, error codes, type guards
 * - types: Interfaces and Zod schemas for all backend domains
 * - adapters: Schema factories and adapter utilities
 * - server: Route groups, middleware config, API error creation
 * - jobs: Job tier assignments, job creation, expiry checks
 * - config: Environment variable mapping, config validation
 * - deployment: Decision matrix, self-hosting, Docker services
 * - health: Health status aggregation, HTTP code mapping
 * - observability: Structured logging, metrics, request context
 * - sse: SSE event formatting, stream state, reconnection
 * - local-dev: Mock adapter configs, seed data, dev defaults
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/Index} - Spec overview
 */

// ============================================================
// RE-EXPORTS: CONSTANTS & TYPES
// ============================================================

// Constants (enums, type guards, numeric thresholds, error codes)
export * from './constants';

// Types (interfaces, Zod schemas)
export * from './types';

// Adapter utilities (schema factories)
export * from './adapters';

// ============================================================
// RE-EXPORTS: DOMAIN MODULES
// ============================================================

// Server configuration (route groups, middleware defaults, API errors)
export * from './server';

// Job system (tier assignments, job creation, expiry)
export * from './jobs';

// Configuration (env var mapping, validation)
export * from './config';

// Deployment (decision matrix, self-hosting, Docker)
export * from './deployment';

// Health checks (status aggregation, HTTP mapping)
export * from './health';

// Observability (logging, metrics, request context)
export * from './observability';

// SSE streaming (event formatting, stream state)
export * from './sse';

// Local development (mock configs, seed data)
export * from './local-dev';
