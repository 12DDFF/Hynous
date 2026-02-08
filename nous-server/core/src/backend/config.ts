/**
 * @module @nous/core/backend
 * @description Configuration schema — environment variable mapping, validation, config loading
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Environment variable mapping data, pure functions for Zod-validated
 * configuration, and the loadConfig() stub for application-level
 * environment reading.
 *
 * @example
 * ```typescript
 * // Validate raw config
 * const config = validateConfig(rawConfigObject);
 *
 * // Safe validation (no throw)
 * const result = safeValidateConfig(rawConfigObject);
 * if (result.success) {
 *   console.log(result.data.port);
 * }
 *
 * // Look up env var name
 * getEnvVarName('database.turso.url'); // 'TURSO_URL'
 * ```
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/config-schema.ts} - Spec
 */

import type { z } from 'zod';
import type { NousConfig } from './types';
import { NousConfigSchema } from './types';

// ============================================================
// ENVIRONMENT VARIABLE MAPPING
// ============================================================

/**
 * Maps configuration fields to environment variable names.
 * Used by loadConfig() to read from process.env.
 *
 * @see storm-026 spec/config-schema.ts - ENV_VAR_MAPPING
 */
export const ENV_VAR_MAPPING = {
  'env': 'NODE_ENV',
  'port': 'PORT',
  'host': 'HOST',
  'database.turso.url': 'TURSO_URL',
  'database.turso.authToken': 'TURSO_AUTH_TOKEN',
  'database.sqlite.path': 'DATABASE_PATH',
  'auth.clerk.secretKey': 'CLERK_SECRET_KEY',
  'auth.clerk.publishableKey': 'CLERK_PUBLISHABLE_KEY',
  'auth.local.jwtSecret': 'JWT_SECRET',
  'llm.openai.apiKey': 'OPENAI_API_KEY',
  'llm.anthropic.apiKey': 'ANTHROPIC_API_KEY',
  'llm.google.apiKey': 'GOOGLE_API_KEY',
  'jobs.bullmq.redisUrl': 'REDIS_URL',
  'observability.sentryDsn': 'SENTRY_DSN',
  'observability.logLevel': 'LOG_LEVEL',
} as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Validate a raw configuration object against the NousConfigSchema.
 * Throws a ZodError if validation fails -- use for fail-fast startup.
 *
 * @param raw - Raw configuration (e.g., from environment)
 * @returns Validated NousConfig
 * @throws ZodError if validation fails
 */
export function validateConfig(raw: unknown): NousConfig {
  return NousConfigSchema.parse(raw);
}

/**
 * Safely validate configuration without throwing.
 * Returns a Zod SafeParseReturnType with either data or error details.
 *
 * @param raw - Raw configuration
 * @returns Success result with data, or error result with issues
 */
export function safeValidateConfig(raw: unknown): z.SafeParseReturnType<unknown, NousConfig> {
  return NousConfigSchema.safeParse(raw);
}

/**
 * Get the environment variable name for a config field path.
 *
 * @param configPath - Dot-separated config path (e.g., 'database.turso.url')
 * @returns Environment variable name or undefined if not mapped
 */
export function getEnvVarName(configPath: string): string | undefined {
  return ENV_VAR_MAPPING[configPath as keyof typeof ENV_VAR_MAPPING];
}

// ============================================================
// EXTERNAL STUBS
// ============================================================

/**
 * Load configuration from environment variables.
 * Reads process.env, maps to config schema, and validates.
 * Exits with error message if validation fails.
 *
 * This must be implemented at the application level where process.env
 * (or platform-specific env access) is available.
 *
 * @returns Validated NousConfig
 */
export function loadConfig(): NousConfig {
  throw new Error('loadConfig requires process.env access and should be implemented at the application level');
}
