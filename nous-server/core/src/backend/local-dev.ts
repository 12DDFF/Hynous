/**
 * @module @nous/core/backend
 * @description Local development -- mock adapter configs, seed data, dev server setup
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Defines configuration for local development mode.
 * Goal: `npm run dev` starts everything with zero external dependencies.
 *
 * - SQLite file for persistence (no Turso needed)
 * - Mock LLM adapter (no API keys needed)
 * - Mock embedding adapter (deterministic outputs)
 * - Local auth (any token accepted)
 * - In-memory job queue (process immediately)
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/local-dev.ts} - Spec
 */

import type {
  LocalDevConfig,
  SeedUser,
  SeedDataConfig,
  MockLLMConfig,
  MockEmbeddingConfig,
  MockJobQueueConfig,
  LocalAuthDevConfig,
} from './types';

// ============================================================
// DEFAULT CONFIGURATION
// ============================================================

/** Default local development configuration */
export const DEFAULT_LOCAL_DEV_CONFIG: LocalDevConfig = {
  port: 3000,
  database_path: './data/dev.db',
  auto_seed: true,
  mock_llm_latency_ms: 100,
  mock_embedding_deterministic: true,
  accept_any_token: true,
  process_jobs_immediately: true,
} as const;

/** Default development user */
export const DEV_USER: SeedUser = {
  id: 'dev-user',
  email: 'dev@localhost',
  tier: 'pro',
} as const;

/** Default seed data configuration */
export const DEFAULT_SEED_DATA: SeedDataConfig = {
  users: [DEV_USER],
  node_count: 10,
  edge_count: 5,
} as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Get default local development configuration.
 * Returns a shallow copy to prevent mutation of the default config.
 * @returns LocalDevConfig with sensible defaults
 */
export function getLocalDevConfig(): LocalDevConfig {
  return { ...DEFAULT_LOCAL_DEV_CONFIG };
}

/**
 * Get default seed users.
 * Returns a new array with a shallow copy of the dev user.
 * @returns Array of seed users (currently just the dev user)
 */
export function getDefaultSeedUsers(): SeedUser[] {
  return [{ ...DEV_USER }];
}

/**
 * Get default mock adapter configurations.
 * Returns configurations for all mock adapters used in local development:
 * LLM, embedding, job queue, and auth.
 * @returns Configurations for all mock adapters
 */
export function getMockAdapterConfigs(): {
  llm: MockLLMConfig;
  embedding: MockEmbeddingConfig;
  jobs: MockJobQueueConfig;
  auth: LocalAuthDevConfig;
} {
  return {
    llm: {
      latencyMs: 100,
      mockResponses: true,
      deterministicOutputs: true,
    },
    embedding: {
      dimensions: 1536,
      deterministic: true,
    },
    jobs: {
      processImmediately: true,
    },
    auth: {
      users: [{ ...DEV_USER }],
      acceptAnyToken: true,
    },
  };
}
