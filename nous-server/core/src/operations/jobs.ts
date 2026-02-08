/**
 * @module @nous/core/operations
 * @description Job scheduling, dependency resolution, and failure handling - storm-034
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-034
 * @storm Brainstorms/Infrastructure/storm-034-backend-operations
 */

import type { NBOSJobId, BackoffStrategy } from './constants';
import type { JobFailureConfig, NBOSJobPayload } from './types';
import {
  NBOS_CRON_SCHEDULES,
  NBOS_BATCH_SIZES,
  NBOS_TIMEOUTS,
  NBOS_CONCURRENCY,
  NBOS_JOB_NAMES,
  NBOS_JOB_PRIORITIES,
  NBOS_JOB_DEPENDENCIES,
  NBOS_CRON_JOBS,
  NBOS_EVENT_JOBS,
  DAILY_CHAIN_ORDER,
  JOB_FAILURE_CONFIGS,
} from './constants';

// ============================================================
// JOB METADATA LOOKUPS
// ============================================================

/**
 * Get the cron schedule string for a given job.
 *
 * @returns The cron expression, or `null` if the job is event-driven
 */
export function getJobSchedule(jobId: NBOSJobId): string | null {
  return NBOS_CRON_SCHEDULES[jobId] ?? null;
}

/**
 * Get the batch size for a given job.
 *
 * @returns The maximum batch size, or `null` for unbounded processing
 */
export function getJobBatchSize(jobId: NBOSJobId): number | null {
  return NBOS_BATCH_SIZES[jobId] ?? null;
}

/**
 * Get the execution timeout in milliseconds for a given job.
 */
export function getJobTimeout(jobId: NBOSJobId): number {
  return NBOS_TIMEOUTS[jobId] ?? 30_000;
}

/**
 * Get the concurrency limit for a given job.
 */
export function getJobConcurrency(jobId: NBOSJobId): number {
  return NBOS_CONCURRENCY[jobId] ?? 1;
}

/**
 * Get the priority for a given job.
 */
export function getJobPriority(jobId: NBOSJobId): 'high' | 'normal' | 'low' {
  return NBOS_JOB_PRIORITIES[jobId] ?? 'normal';
}

/**
 * Get the human-readable job name from a job ID.
 */
export function getJobName(jobId: NBOSJobId): string {
  return NBOS_JOB_NAMES[jobId] ?? jobId;
}

// ============================================================
// DEPENDENCY RESOLUTION
// ============================================================

/**
 * Get the ordered dependency chain for a job.
 *
 * @returns Array of prerequisite job IDs (empty if no dependencies)
 */
export function getJobDependencies(jobId: NBOSJobId): readonly NBOSJobId[] {
  return NBOS_JOB_DEPENDENCIES[jobId] ?? [];
}

/**
 * Check whether a job is blocked by incomplete dependencies.
 *
 * @param jobId - The job to evaluate
 * @param completedJobs - Jobs that have already completed successfully
 * @returns `true` if the job cannot run yet
 */
export function isJobBlocked(
  jobId: NBOSJobId,
  completedJobs: readonly NBOSJobId[],
): boolean {
  const deps = getJobDependencies(jobId);
  if (deps.length === 0) {
    return false;
  }
  const completedSet = new Set(completedJobs);
  return deps.some((dep) => !completedSet.has(dep));
}

// ============================================================
// FAILURE HANDLING
// ============================================================

/**
 * Get the failure-handling configuration for a job by its name.
 *
 * @param jobName - The human-readable job name (e.g. 'decay-cycle')
 * @returns The failure config, or `undefined` if no config exists
 */
export function getJobFailureConfig(jobName: string): JobFailureConfig | undefined {
  const entry = JOB_FAILURE_CONFIGS[jobName];
  if (!entry) {
    return undefined;
  }
  return {
    retries: entry.retries,
    backoff: entry.backoff,
    baseDelayMs: entry.baseDelayMs,
    maxDelayMs: entry.maxDelayMs,
    deadLetterAfter: entry.deadLetterAfter,
    alertAfter: entry.alertAfter,
    userNotify: entry.userNotify,
    notifyChannel: entry.notifyChannel,
  };
}

/**
 * Calculate the retry delay in milliseconds.
 *
 * - exponential: min(baseDelay * 2^attempt, maxDelay)
 * - linear: min(baseDelay * (attempt + 1), maxDelay)
 * - fixed: baseDelay
 */
export function calculateRetryDelay(config: JobFailureConfig, attempt: number): number {
  const strategy: BackoffStrategy = config.backoff;

  switch (strategy) {
    case 'exponential':
      return Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
    case 'linear':
      return Math.min(config.baseDelayMs * (attempt + 1), config.maxDelayMs);
    case 'fixed':
      return config.baseDelayMs;
    default: {
      const _exhaustive: never = strategy;
      throw new Error(`Unknown backoff strategy: ${_exhaustive}`);
    }
  }
}

/**
 * Determine whether a job should be moved to the dead-letter queue.
 */
export function shouldDeadLetter(config: JobFailureConfig, attempts: number): boolean {
  return attempts >= config.deadLetterAfter;
}

/**
 * Determine whether the operations team should be alerted.
 */
export function shouldAlertOps(config: JobFailureConfig, failures: number): boolean {
  return failures >= config.alertAfter;
}

// ============================================================
// JOB CLASSIFICATION
// ============================================================

/** Check if a job is cron-triggered (has a schedule). */
export function isNBOSCronJob(jobId: NBOSJobId): boolean {
  return (NBOS_CRON_JOBS as readonly NBOSJobId[]).includes(jobId);
}

/** Check if a job is event-triggered (no schedule). */
export function isNBOSEventJob(jobId: NBOSJobId): boolean {
  return (NBOS_EVENT_JOBS as readonly NBOSJobId[]).includes(jobId);
}

// ============================================================
// DAILY CHAIN
// ============================================================

/** Get the ordered list of job IDs for the daily processing chain. */
export function getDailyChainOrder(): readonly NBOSJobId[] {
  return DAILY_CHAIN_ORDER;
}

// ============================================================
// PAYLOAD FACTORY
// ============================================================

/**
 * Create a fully-formed job payload with auto-generated metadata.
 *
 * Stamps `correlationId` and `triggeredAt` onto the provided payload.
 */
export function createJobPayload<T extends NBOSJobPayload>(
  payload: Omit<T, 'correlationId' | 'triggeredAt'>,
): T {
  return {
    ...payload,
    correlationId: generateCorrelationId(),
    triggeredAt: new Date().toISOString(),
  } as T;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${hex()}-${hex()}${hex()}${hex()}`;
}
