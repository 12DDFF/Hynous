/**
 * @module @nous/core/working-memory
 * @description Working Memory & Consolidation Pipeline for storm-035
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-035
 * @storm Brainstorms/Infrastructure/storm-035-working-memory
 *
 * Working Memory is a trial period for newly extracted content.
 * Content-type aware durations, accumulative scoring with decay,
 * and graceful degradation to dormant state.
 */

import { WORKING_MEMORY_DURATIONS } from '../ingestion/constants';
import { getInitialStability, getInitialDifficulty } from '../params';
import type { AlgorithmNodeType } from '../params';

import {
  PROMOTION_TRIGGERS,
  WM_STATUSES,
  TRIGGER_SCORES,
  PROMOTION_THRESHOLD,
  SCORE_DECAY_PER_DAY,
  WM_CHECK_INTERVAL_MINUTES,
  WM_DURATION_MULTIPLIER_RANGE,
  WM_RETRIEVAL_PRIORITY_MULTIPLIER,
  FADED_RETRIEVABILITY,
  RESTORED_STRENGTH_BONUS,
  WM_CONFIG,
  WM_EVALUATION_JOB_SPEC,
  CATEGORY_TO_NODE_TYPE,
  type PromotionTrigger,
  type WMStatus,
  type WorkingMemoryConfigType,
} from './constants';

import {
  type TriggerEvent,
  type WorkingMemoryState,
  type WorkingMemoryConfig,
  type PromotionResult,
  type FadeResult,
  type RestorationResult,
  type EvaluationResult,
  type WMEntryOptions,
  type ScoreCalculationInput,
  TriggerEventSchema,
  WorkingMemoryStateSchema,
  WorkingMemoryConfigSchema,
  PromotionResultSchema,
  FadeResultSchema,
  RestorationResultSchema,
  EvaluationResultSchema,
  WMEntryOptionsSchema,
  ScoreCalculationInputSchema,
} from './types';

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Calculates hours between two dates.
 */
export function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

/**
 * Calculates days between two dates.
 */
export function daysBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Validates a WorkingMemoryState object.
 */
export function validateWorkingMemoryState(state: unknown): state is WorkingMemoryState {
  return WorkingMemoryStateSchema.safeParse(state).success;
}

// ============================================================
// CONTENT CATEGORY MAPPING
// ============================================================

/**
 * Maps ContentCategory (from storm-014) to AlgorithmNodeType (from storm-028).
 */
export function mapCategoryToNodeType(category: string): AlgorithmNodeType {
  return (CATEGORY_TO_NODE_TYPE[category] ?? 'fact') as AlgorithmNodeType;
}

// ============================================================
// WORKING MEMORY ENTRY
// ============================================================

/**
 * Gets the duration in hours for a content category.
 */
export function getWorkingMemoryDuration(
  category: string,
  multiplier: number = 1.0
): number {
  const baseDuration = WORKING_MEMORY_DURATIONS[category as keyof typeof WORKING_MEMORY_DURATIONS]
    ?? WORKING_MEMORY_DURATIONS.general;
  return baseDuration * Math.max(
    WM_DURATION_MULTIPLIER_RANGE[0],
    Math.min(WM_DURATION_MULTIPLIER_RANGE[1], multiplier)
  );
}

/**
 * Creates a new WorkingMemoryState for a node entering Working Memory.
 */
export function createWorkingMemoryState(
  options: WMEntryOptions,
  _config?: Partial<WorkingMemoryConfig>
): WorkingMemoryState {
  const now = new Date();
  const multiplier = options.durationMultiplier ?? 1.0;
  const durationHours = getWorkingMemoryDuration(options.contentCategory, multiplier);
  const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

  return {
    entered_at: now,
    expires_at: expiresAt,
    content_category: options.contentCategory,
    promotion_score: options.initialScore ?? 0,
    score_last_updated: now,
    trigger_events: [],
    status: 'pending',
  };
}

// ============================================================
// SCORE MANAGEMENT
// ============================================================

/**
 * Calculates the current promotion score with time decay applied.
 */
export function calculateCurrentScore(input: ScoreCalculationInput): number {
  const now = input.now ?? new Date();
  const days = daysBetween(input.scoreLastUpdated, now);
  const decay = days * SCORE_DECAY_PER_DAY;
  return Math.max(0, input.promotionScore - decay);
}

/**
 * Records a trigger event and updates the promotion score.
 */
export function recordTriggerEvent(
  wmState: WorkingMemoryState,
  trigger: PromotionTrigger,
  details?: Record<string, unknown>
): { updatedState: WorkingMemoryState; shouldPromote: boolean } {
  const now = new Date();

  // Calculate current score with decay
  const currentScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated,
    now,
  });

  // Create trigger event
  const event: TriggerEvent = {
    type: trigger,
    timestamp: now,
    score_contribution: TRIGGER_SCORES[trigger],
    details,
  };

  // Calculate new score (capped at 1.0)
  const newScore = Math.min(1.0, currentScore + event.score_contribution);

  const updatedState: WorkingMemoryState = {
    ...wmState,
    promotion_score: newScore,
    score_last_updated: now,
    trigger_events: [...wmState.trigger_events, event],
  };

  // Check for instant promotion (explicit_save) or threshold reached
  const shouldPromote = trigger === 'explicit_save' || newScore >= PROMOTION_THRESHOLD;

  return { updatedState, shouldPromote };
}

/**
 * Checks if a node should be promoted based on current score.
 */
export function shouldPromote(wmState: WorkingMemoryState): boolean {
  const currentScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated,
  });
  return currentScore >= PROMOTION_THRESHOLD;
}

// ============================================================
// LIFECYCLE TRANSITIONS
// ============================================================

/**
 * Promotes a node from Working Memory to Long-Term Memory.
 * Note: This is a simulation - actual node updates require database access.
 */
export async function promoteNode(
  nodeId: string,
  wmState: WorkingMemoryState,
  reason?: string
): Promise<PromotionResult> {
  const now = new Date();
  const finalScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated,
    now,
  });

  const nodeType = mapCategoryToNodeType(wmState.content_category);

  return {
    nodeId,
    finalScore,
    durationHours: hoursBetween(wmState.entered_at, now),
    triggerCount: wmState.trigger_events.length,
    reason: reason ?? `Score ${finalScore.toFixed(2)} >= ${PROMOTION_THRESHOLD} threshold`,
    promotedAt: now,
    initialStability: getInitialStability(nodeType),
    initialDifficulty: getInitialDifficulty(nodeType),
  };
}

/**
 * Fades a node to dormant state.
 * Note: This is a simulation - actual node updates require database access.
 */
export async function fadeNode(
  nodeId: string,
  wmState: WorkingMemoryState,
  reason?: string
): Promise<FadeResult> {
  const now = new Date();
  const finalScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated,
    now,
  });

  return {
    nodeId,
    finalScore,
    durationHours: hoursBetween(wmState.entered_at, now),
    triggerCount: wmState.trigger_events.length,
    reason: reason ?? `Expired with score ${finalScore.toFixed(2)} < ${PROMOTION_THRESHOLD} threshold`,
    fadedAt: now,
  };
}

/**
 * Restores a node from dormant state to Long-Term Memory.
 * Note: This is a simulation - actual node updates require database access.
 */
export async function restoreFromDormant(
  nodeId: string,
  contentCategory: string
): Promise<RestorationResult> {
  const now = new Date();
  const nodeType = mapCategoryToNodeType(contentCategory);

  return {
    nodeId,
    restoredAt: now,
    initialStability: getInitialStability(nodeType),
    newStrength: 0.5 + RESTORED_STRENGTH_BONUS,
  };
}

// ============================================================
// EVALUATION
// ============================================================

/**
 * Evaluates a single node for promotion or fade.
 */
export async function evaluateNode(
  wmState: WorkingMemoryState,
  now: Date = new Date()
): Promise<'promoted' | 'faded' | 'pending'> {
  // Only evaluate pending nodes
  if (wmState.status !== 'pending') {
    return wmState.status === 'promoted' ? 'promoted' : 'faded';
  }

  const currentScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated,
    now,
  });

  // Check if score meets threshold
  if (currentScore >= PROMOTION_THRESHOLD) {
    return 'promoted';
  }

  // Check if expired
  if (now >= wmState.expires_at) {
    return 'faded';
  }

  return 'pending';
}

/**
 * Evaluates all pending Working Memory nodes.
 * Note: This is a simulation - actual implementation queries database.
 */
export async function evaluateWorkingMemory(
  pendingNodes: Array<{ id: string; working_memory: WorkingMemoryState }>
): Promise<EvaluationResult> {
  const startTime = Date.now();
  const now = new Date();
  const results: EvaluationResult = {
    evaluated: 0,
    promoted: 0,
    faded: 0,
    stillPending: 0,
    errors: [],
    evaluatedAt: now,
    durationMs: 0,
  };

  for (const node of pendingNodes) {
    try {
      results.evaluated++;
      const decision = await evaluateNode(node.working_memory, now);

      switch (decision) {
        case 'promoted':
          results.promoted++;
          break;
        case 'faded':
          results.faded++;
          break;
        case 'pending':
          results.stillPending++;
          break;
      }
    } catch (error) {
      results.errors.push(`Node ${node.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  results.durationMs = Date.now() - startTime;
  return results;
}

// ============================================================
// QUERY HELPERS
// ============================================================

/**
 * Checks if a node is currently in Working Memory trial.
 */
export function isInWorkingMemory(node: { working_memory?: WorkingMemoryState }): boolean {
  return node.working_memory?.status === 'pending';
}

/**
 * Gets time remaining in Working Memory trial.
 */
export function getTimeRemaining(wmState: WorkingMemoryState): number {
  const now = new Date();
  const remaining = hoursBetween(now, wmState.expires_at);
  return Math.max(0, remaining);
}

/**
 * Gets progress toward promotion (score / threshold).
 */
export function getPromotionProgress(wmState: WorkingMemoryState): number {
  const currentScore = calculateCurrentScore({
    promotionScore: wmState.promotion_score,
    scoreLastUpdated: wmState.score_last_updated,
  });
  return Math.min(100, (currentScore / PROMOTION_THRESHOLD) * 100);
}

/**
 * Updates WorkingMemoryState status to promoted.
 */
export function markAsPromoted(
  wmState: WorkingMemoryState,
  reason: string
): WorkingMemoryState {
  return {
    ...wmState,
    status: 'promoted',
    resolved_at: new Date(),
    resolution_reason: reason,
  };
}

/**
 * Updates WorkingMemoryState status to faded.
 */
export function markAsFaded(
  wmState: WorkingMemoryState,
  reason: string
): WorkingMemoryState {
  return {
    ...wmState,
    status: 'faded',
    resolved_at: new Date(),
    resolution_reason: reason,
  };
}

// ============================================================
// EXPORTS
// ============================================================

export {
  // Constants
  PROMOTION_TRIGGERS,
  WM_STATUSES,
  TRIGGER_SCORES,
  PROMOTION_THRESHOLD,
  SCORE_DECAY_PER_DAY,
  WM_CHECK_INTERVAL_MINUTES,
  WM_DURATION_MULTIPLIER_RANGE,
  WM_RETRIEVAL_PRIORITY_MULTIPLIER,
  FADED_RETRIEVABILITY,
  RESTORED_STRENGTH_BONUS,
  WM_CONFIG,
  WM_EVALUATION_JOB_SPEC,
  CATEGORY_TO_NODE_TYPE,
  type PromotionTrigger,
  type WMStatus,
  type WorkingMemoryConfigType,
};

export {
  // Types
  type TriggerEvent,
  type WorkingMemoryState,
  type WorkingMemoryConfig,
  type PromotionResult,
  type FadeResult,
  type RestorationResult,
  type EvaluationResult,
  type WMEntryOptions,
  type ScoreCalculationInput,
  // Schemas
  TriggerEventSchema,
  WorkingMemoryStateSchema,
  WorkingMemoryConfigSchema,
  PromotionResultSchema,
  FadeResultSchema,
  RestorationResultSchema,
  EvaluationResultSchema,
  WMEntryOptionsSchema,
  ScoreCalculationInputSchema,
};
