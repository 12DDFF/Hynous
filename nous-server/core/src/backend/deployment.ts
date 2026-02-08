/**
 * @module @nous/core/backend
 * @description Deployment configuration — targets, decision matrix, self-hosting, Docker Compose
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Deployment decision matrix data, self-hosting defaults, Docker service
 * definitions, and pure functions for deployment scenario lookups.
 *
 * | Scenario          | API                | Jobs       | Database | Auth   |
 * |-------------------|--------------------|------------|----------|--------|
 * | Nous Cloud        | Cloudflare Workers | Cloudflare | Turso    | Clerk  |
 * | Self-Host (Small) | Docker (Bun)       | Memory     | SQLite   | Local  |
 * | Self-Host (Scale) | Docker (multiple)  | BullMQ     | SQLite   | Local  |
 * | Enterprise        | Docker/K8s         | BullMQ     | SQLite   | Local  |
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/deployment.ts} - Spec
 */

import type {
  DeploymentMatrixEntry,
  SelfHostConfig,
  DockerServiceConfig,
} from './types';
import type { DeploymentScenario } from './constants';

// ============================================================
// DEPLOYMENT MATRIX
// ============================================================

/**
 * Deployment decision matrix.
 * Maps named scenarios to their infrastructure choices.
 *
 * @see storm-026 spec/deployment.ts - DEPLOYMENT_MATRIX
 */
export const DEPLOYMENT_MATRIX: Record<DeploymentScenario, DeploymentMatrixEntry> = {
  nous_cloud: {
    scenario: 'nous_cloud',
    api: 'cloudflare_workers',
    jobs: 'cloudflare',
    database: 'turso',
    auth: 'clerk',
    description: 'Production Nous Cloud: edge API + Turso + Clerk + Cloudflare Queues',
  },
  self_host_small: {
    scenario: 'self_host_small',
    api: 'docker',
    jobs: 'memory',
    database: 'sqlite',
    auth: 'local',
    description: 'Small self-hosted: single Docker container, in-process jobs, SQLite file',
  },
  self_host_scale: {
    scenario: 'self_host_scale',
    api: 'docker',
    jobs: 'bullmq',
    database: 'sqlite',
    auth: 'local',
    description: 'Scaled self-hosted: multiple Docker containers, BullMQ + Redis, SQLite file',
  },
  enterprise: {
    scenario: 'enterprise',
    api: 'docker',
    jobs: 'bullmq',
    database: 'sqlite',
    auth: 'local',
    description: 'Enterprise: Kubernetes-ready, BullMQ + Redis, SQLite (or community Postgres adapter)',
  },
} as const;

// ============================================================
// DEFAULT SELF-HOST CONFIGURATION
// ============================================================

/**
 * Default self-hosting configuration with system requirements.
 *
 * @see storm-026 spec/deployment.ts - DEFAULT_SELF_HOST_CONFIG
 */
export const DEFAULT_SELF_HOST_CONFIG: SelfHostConfig = {
  docker_compose_services: ['api', 'jobs', 'redis'],
  required_env_vars: ['OPENAI_API_KEY'],
  optional_env_vars: [
    'DATABASE_PATH',
    'PORT',
    'JWT_SECRET',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'REDIS_URL',
    'SENTRY_DSN',
    'LOG_LEVEL',
  ],
  min_ram_mb: 1024,
  recommended_ram_mb: 2048,
  volumes: ['/data/nous.db'],
} as const;

// ============================================================
// DOCKER SERVICE DEFINITIONS
// ============================================================

/**
 * Docker Compose service definitions for self-hosting.
 * These define the three services in the self-host stack.
 *
 * @see storm-026 spec/deployment.ts - DOCKER_SERVICES
 */
export const DOCKER_SERVICES: readonly DockerServiceConfig[] = [
  {
    name: 'api',
    image: 'nous-api:latest',
    ports: ['3000:3000'],
    environment: [
      'DATABASE_PATH=/data/nous.db',
      'AUTH_MODE=local',
      'REDIS_URL=redis://redis:6379',
    ],
    volumes: ['nous-data:/data'],
    depends_on: ['redis'],
  },
  {
    name: 'jobs',
    image: 'nous-jobs:latest',
    environment: [
      'DATABASE_PATH=/data/nous.db',
      'REDIS_URL=redis://redis:6379',
    ],
    volumes: ['nous-data:/data'],
    depends_on: ['redis'],
  },
  {
    name: 'redis',
    image: 'redis:7-alpine',
    ports: ['6379:6379'],
    environment: [],
  },
] as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Get deployment configuration for a named scenario.
 *
 * @param scenario - Named deployment scenario
 * @returns Deployment matrix entry with all infrastructure choices
 */
export function getDeploymentConfig(scenario: DeploymentScenario): DeploymentMatrixEntry {
  return DEPLOYMENT_MATRIX[scenario];
}

/**
 * Get self-hosting system requirements.
 *
 * @returns Self-host configuration with required env vars, RAM, and volumes
 */
export function getSelfHostRequirements(): SelfHostConfig {
  return DEFAULT_SELF_HOST_CONFIG;
}

/**
 * Get Docker Compose service definitions for a scenario.
 * Small deployments get only the API service (in-process jobs, no Redis).
 * Scale and enterprise deployments get the full stack (api + jobs + redis).
 *
 * @param scenario - Deployment scenario
 * @returns Array of Docker service configurations
 */
export function getDockerServices(scenario: DeploymentScenario): readonly DockerServiceConfig[] {
  if (scenario === 'self_host_small') {
    // Small deployment: no Redis, in-process jobs
    return DOCKER_SERVICES.filter(s => s.name === 'api');
  }
  // Scale and enterprise: full stack
  return DOCKER_SERVICES;
}

/**
 * Check if a scenario requires Redis.
 * Only BullMQ-based job queues need Redis.
 *
 * @param scenario - Deployment scenario
 * @returns True if Redis is needed
 */
export function requiresRedis(scenario: DeploymentScenario): boolean {
  const config = DEPLOYMENT_MATRIX[scenario];
  return config.jobs === 'bullmq';
}
