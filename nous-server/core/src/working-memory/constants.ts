/**
 * @module @nous/core/working-memory/constants
 * @description All constants, triggers, and configuration for storm-035 Working Memory
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-035
 * @storm Brainstorms/Infrastructure/storm-035-working-memory
 *
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for Working Memory constants.
 * Duration values are imported from storm-014 (WORKING_MEMORY_DURATIONS).
 */

// ============================================================
// PROMOTION TRIGGERS
// ============================================================

/**
 * Five triggers that can contribute to a node's promotion score.
 * Each trigger has an associated score (see TRIGGER_SCORES).
 */
export const PROMOTION_TRIGGERS = [
  'user_access',
  'query_activation',
  'important_connection',
  'high_confidence',
  'explicit_save',
] as const;

export type PromotionTrigger = (typeof PROMOTION_TRIGGERS)[number];

// ============================================================
// WORKING MEMORY STATUS
// ============================================================

/**
 * Status of a node in Working Memory.
 */
export const WM_STATUSES = ['pending', 'promoted', 'faded'] as const;

export type WMStatus = (typeof WM_STATUSES)[number];

// ============================================================
// TRIGGER SCORES
// ============================================================

/**
 * Score contribution for each trigger type.
 */
export const TRIGGER_SCORES: Record<PromotionTrigger, number> = {
  user_access: 0.4,
  query_activation: 0.2,
  important_connection: 0.3,
  high_confidence: 0.2,
  explicit_save: 1.0,
};

// ============================================================
// THRESHOLDS AND LIMITS
// ============================================================

export const PROMOTION_THRESHOLD = 0.5;
export const SCORE_DECAY_PER_DAY = 0.1;
export const WM_CHECK_INTERVAL_MINUTES = 60;
export const WM_DURATION_MULTIPLIER_RANGE: [number, number] = [0.5, 2.0];

// ============================================================
// RETRIEVAL PRIORITY
// ============================================================

export const WM_RETRIEVAL_PRIORITY_MULTIPLIER = 0.7;

// ============================================================
// DORMANT STATE VALUES
// ============================================================

export const FADED_RETRIEVABILITY = 0.05;
export const RESTORED_STRENGTH_BONUS = 0.1;

// ============================================================
// WORKING MEMORY CONFIG (Aggregate)
// ============================================================

export const WM_CONFIG = {
  triggers: PROMOTION_TRIGGERS,
  trigger_scores: TRIGGER_SCORES,
  promotion_threshold: PROMOTION_THRESHOLD,
  score_decay_per_day: SCORE_DECAY_PER_DAY,
  duration_multiplier_range: WM_DURATION_MULTIPLIER_RANGE,
  fade_action: 'dormant' as const,
  restoration_action: 'direct_promote' as const,
  manual_bypass: true,
  check_interval_minutes: WM_CHECK_INTERVAL_MINUTES,
  retrieval_priority_multiplier: WM_RETRIEVAL_PRIORITY_MULTIPLIER,
  faded_retrievability: FADED_RETRIEVABILITY,
  restored_strength_bonus: RESTORED_STRENGTH_BONUS,
} as const;

export type WorkingMemoryConfigType = typeof WM_CONFIG;

// ============================================================
// J-015 JOB SPECIFICATION
// ============================================================

export const WM_EVALUATION_JOB_SPEC = {
  id: 'J-015',
  name: 'working-memory-evaluation',
  description: 'Evaluate pending Working Memory nodes for promotion or fade',
  schedule: '0 * * * *',
  priority: 'low' as const,
  concurrency: 1,
  timeout_minutes: 5,
  retries: 2,
} as const;

// ============================================================
// CONTENT CATEGORY TO NODE TYPE MAPPING
// ============================================================

/**
 * Maps ContentCategory (from storm-014) to AlgorithmNodeType (from storm-028).
 */
export const CATEGORY_TO_NODE_TYPE: Record<string, string> = {
  identity: 'person',
  academic: 'concept',
  conversation: 'fact',
  work: 'note',
  temporal: 'event',
  document: 'document',
  general: 'fact',
};
