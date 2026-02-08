/**
 * @module @nous/core/backend
 * @description Job system — tier assignments, job creation, expiration checks
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Job tier assignment data and pure functions for the three-tier execution model:
 *
 * ```
 * TIER 1: INLINE    (<50ms)   Classification, token validation
 * TIER 2: QUEUED    (<30s)    Embedding, dedup, edge inference
 * TIER 3: REGIONAL  (<10min)  Document processing, batch embed
 * ```
 *
 * Tier 1 jobs run inline in the request handler (no queue needed).
 * Tier 2 jobs go through Cloudflare Queues (cloud) or BullMQ (self-host).
 * Tier 3 jobs go through Fly.io Machines (cloud) or BullMQ (self-host).
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/job-system.ts} - Spec
 */

import type { Job, JobTierConfig } from './types';
import type { JobTier, JobType, CronJobType, JobPriority } from './constants';

// ============================================================
// JOB TIER ASSIGNMENTS
// ============================================================

/**
 * Tier assignment for each job type.
 * Determines where each job runs and its execution constraints.
 *
 * @see storm-026 spec/job-system.ts - JOB_TIER_ASSIGNMENTS
 */
export const JOB_TIER_ASSIGNMENTS: Record<JobType | CronJobType, JobTierConfig> = {
  // Tier 2: Queued (<30s)
  'embed': {
    type: 'embed',
    tier: 'queued',
    max_duration_ms: 10_000,
    retry_count: 3,
    retry_delay_ms: 1_000,
  },
  'deduplicate': {
    type: 'deduplicate',
    tier: 'queued',
    max_duration_ms: 15_000,
    retry_count: 3,
    retry_delay_ms: 1_000,
  },
  'infer-edges': {
    type: 'infer-edges',
    tier: 'queued',
    max_duration_ms: 20_000,
    retry_count: 3,
    retry_delay_ms: 2_000,
  },
  'sync-push-notification': {
    type: 'sync-push-notification',
    tier: 'queued',
    max_duration_ms: 5_000,
    retry_count: 5,
    retry_delay_ms: 500,
  },

  // Tier 3: Regional (<10min)
  'process-document': {
    type: 'process-document',
    tier: 'regional',
    max_duration_ms: 300_000,
    retry_count: 2,
    retry_delay_ms: 5_000,
  },
  'batch-embed': {
    type: 'batch-embed',
    tier: 'regional',
    max_duration_ms: 600_000,
    retry_count: 2,
    retry_delay_ms: 10_000,
  },

  // Cron jobs: Regional
  'decay-cycle': {
    type: 'decay-cycle',
    tier: 'regional',
    max_duration_ms: 300_000,
    retry_count: 1,
    retry_delay_ms: 60_000,
  },
  'reorganize': {
    type: 'reorganize',
    tier: 'regional',
    max_duration_ms: 600_000,
    retry_count: 1,
    retry_delay_ms: 60_000,
  },
  'cleanup-expired': {
    type: 'cleanup-expired',
    tier: 'regional',
    max_duration_ms: 120_000,
    retry_count: 1,
    retry_delay_ms: 30_000,
  },
} as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Get the execution tier for a job type.
 *
 * @param type - Job or cron job type
 * @returns The tier this job should run at ('inline' | 'queued' | 'regional')
 */
export function getJobTierForType(type: JobType | CronJobType): JobTier {
  return JOB_TIER_ASSIGNMENTS[type].tier;
}

/**
 * Get the full tier configuration for a job type.
 *
 * @param type - Job or cron job type
 * @returns Tier configuration including limits and retry settings
 */
export function getJobTierConfig(type: JobType | CronJobType): JobTierConfig {
  return JOB_TIER_ASSIGNMENTS[type];
}

/**
 * Create a new job instance with a generated ID and timestamp.
 *
 * @param type - Job type
 * @param payload - Job-specific data
 * @param tenantId - Tenant the job belongs to
 * @param options - Optional priority and correlation ID
 * @returns A fully formed Job object ready for enqueue
 */
export function createJob<T extends JobType>(
  type: T,
  payload: Record<string, unknown>,
  tenantId: string,
  options?: { priority?: JobPriority; correlationId?: string },
): Job<T> {
  return {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    priority: options?.priority ?? 'normal',
    correlationId: options?.correlationId,
    tenantId,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Check if a job has exceeded its tier's maximum duration.
 *
 * @param job - The job to check
 * @param startedAt - When the job started processing (ISO 8601)
 * @returns True if the job has exceeded its time limit
 */
export function isJobExpired(job: Job<JobType | CronJobType>, startedAt: string): boolean {
  const config = JOB_TIER_ASSIGNMENTS[job.type];
  const elapsed = Date.now() - new Date(startedAt).getTime();
  return elapsed > config.max_duration_ms;
}
