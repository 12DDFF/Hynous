/**
 * @module @nous/core/contradiction
 * @description Constants for Contradiction Resolution System (CRS)
 * @version 1.0.0
 * @spec Specs/Phase-5-Quality-Control/storm-009
 * @storm Brainstorms/Infrastructure/storm-009-contradiction-handling
 *
 * All numeric thresholds, limits, and configuration defaults.
 * These values are from storm-009 v2 revision and should not be changed
 * without updating the brainstorm.
 */

import { z } from 'zod';

// ============================================================
// DETECTION TIER CONSTANTS
// ============================================================

/**
 * Detection tier names.
 * Pipeline flows: STRUCTURAL → NORMALIZED → PATTERN → CLASSIFIER → LLM → VERIFICATION
 */
export const DETECTION_TIERS = [
  'STRUCTURAL',
  'NORMALIZED',
  'PATTERN',
  'CLASSIFIER',
  'LLM',
  'VERIFICATION',
] as const;

export type DetectionTier = (typeof DETECTION_TIERS)[number];

export const DetectionTierSchema = z.enum(DETECTION_TIERS);

/**
 * Type guard for DetectionTier.
 */
export function isDetectionTier(value: unknown): value is DetectionTier {
  return DETECTION_TIERS.includes(value as DetectionTier);
}

/**
 * Metadata for each detection tier.
 * Speed, cost, and accuracy targets from v2 revision.
 */
export const DETECTION_TIER_METADATA: Record<
  DetectionTier,
  { speed_ms: number; cost: number; accuracy: number }
> = {
  STRUCTURAL: { speed_ms: 1, cost: 0, accuracy: 0.95 },
  NORMALIZED: { speed_ms: 3, cost: 0, accuracy: 0.90 },
  PATTERN: { speed_ms: 10, cost: 0, accuracy: 0.75 },
  CLASSIFIER: { speed_ms: 20, cost: 0.0001, accuracy: 0.85 },
  LLM: { speed_ms: 500, cost: 0.002, accuracy: 0.92 },
  VERIFICATION: { speed_ms: 1000, cost: 0.004, accuracy: 0.97 },
} as const;

/**
 * Confidence thresholds for detection tiers.
 * Determines when to proceed to next tier or stop.
 */
export const TIER_THRESHOLDS = {
  /** Tier 1: Structural match confidence */
  structural_confidence: 0.95,

  /** Tier 1.5: Normalized match confidence */
  normalized_confidence: 0.90,

  /** Tier 2: Pattern high confidence - proceed to resolution */
  pattern_high_threshold: 0.70,

  /** Tier 2: Pattern continue threshold - proceed to Tier 2.5 */
  pattern_continue_threshold: 0.40,

  /** Tier 2.5: Classifier threshold to proceed */
  classifier_threshold: 0.70,

  /** Tier 3: LLM confidence for auto-supersession (requires Tier 4) */
  llm_auto_threshold: 0.80,

  /** Tier 4: Verification confidence for auto-supersession */
  verification_threshold: 0.70,
} as const;

// ============================================================
// CONFLICT TYPE CONSTANTS
// ============================================================

/**
 * The 6 contradiction types.
 */
export const CONFLICT_TYPES = [
  'FACT_UPDATE',
  'CORRECTION',
  'BELIEF_CONTRADICTION',
  'BELIEF_EVOLUTION',
  'SOURCE_CONFLICT',
  'AMBIGUOUS',
] as const;

export type ConflictType = (typeof CONFLICT_TYPES)[number];

export const ConflictTypeSchema = z.enum(CONFLICT_TYPES);

/**
 * Type guard for ConflictType.
 */
export function isConflictType(value: unknown): value is ConflictType {
  return CONFLICT_TYPES.includes(value as ConflictType);
}

/**
 * Resolution strategies.
 */
export const RESOLUTION_STRATEGIES = [
  'supersede_old',
  'keep_both_linked',
  'keep_both_unlinked',
  'queue_for_user',
  'source_ranking',
] as const;

export type ResolutionStrategy = (typeof RESOLUTION_STRATEGIES)[number];

export const ResolutionStrategySchema = z.enum(RESOLUTION_STRATEGIES);

/**
 * Resolution details for each conflict type.
 */
export const CONFLICT_TYPE_RESOLUTION: Record<
  ConflictType,
  {
    auto_supersede: boolean;
    resolution: ResolutionStrategy;
    description: string;
  }
> = {
  FACT_UPDATE: {
    auto_supersede: true,
    resolution: 'supersede_old',
    description: 'Same entity+attribute, different value. New replaces old.',
  },
  CORRECTION: {
    auto_supersede: true,
    resolution: 'supersede_old',
    description: 'Explicit correction marker detected. New replaces old.',
  },
  BELIEF_CONTRADICTION: {
    auto_supersede: true,
    resolution: 'supersede_old',
    description: 'Same topic, sentiment flip (+ to - or - to +). New replaces old.',
  },
  BELIEF_EVOLUTION: {
    auto_supersede: false,
    resolution: 'keep_both_linked',
    description: 'Same topic, similar sentiment, scope expanded. Keep both with evolves_from edge.',
  },
  SOURCE_CONFLICT: {
    auto_supersede: true,
    resolution: 'source_ranking',
    description: 'Same fact from different sources. Higher trust source wins.',
  },
  AMBIGUOUS: {
    auto_supersede: false,
    resolution: 'queue_for_user',
    description: 'LLM confidence < 0.7. Queue for user resolution.',
  },
} as const;

// ============================================================
// SUPERSEDED LIFECYCLE CONSTANTS
// ============================================================

/**
 * Superseded node lifecycle states.
 */
export const SUPERSEDED_STATES = [
  'SUPERSEDED_ACTIVE',
  'SUPERSEDED_FADING',
  'SUPERSEDED_DORMANT',
  'SUPERSEDED_ARCHIVED',
  'SUPERSEDED_DELETED',
] as const;

export type SupersededState = (typeof SUPERSEDED_STATES)[number];

export const SupersededStateSchema = z.enum(SUPERSEDED_STATES);

/**
 * Type guard for SupersededState.
 */
export function isSupersededState(value: unknown): value is SupersededState {
  return SUPERSEDED_STATES.includes(value as SupersededState);
}

/**
 * Decay rate multipliers per superseded state.
 * Applied to normal decay rate (λ_superseded = multiplier × λ_normal).
 */
export const SUPERSEDED_DECAY_MULTIPLIERS: Record<SupersededState, number> = {
  SUPERSEDED_ACTIVE: 3,
  SUPERSEDED_FADING: 4,
  SUPERSEDED_DORMANT: 5,
  SUPERSEDED_ARCHIVED: 5,
  SUPERSEDED_DELETED: 0,
} as const;

/**
 * If user accesses superseded node, reduce decay multiplier to this.
 */
export const SUPERSEDED_ACCESS_DECAY_MULTIPLIER = 2;

/**
 * Retrievability thresholds for superseded state transitions.
 */
export const SUPERSEDED_R_THRESHOLDS = {
  /** Above this: SUPERSEDED_ACTIVE */
  active_min: 0.3,
  /** Between fading_min and active_min: SUPERSEDED_FADING */
  fading_min: 0.1,
  /** Below fading_min: SUPERSEDED_DORMANT */
  dormant_max: 0.1,
} as const;

/**
 * Days in dormant state before archival.
 */
export const SUPERSEDED_DORMANT_DAYS = 90;

// ============================================================
// DELETION CRITERIA CONSTANTS
// ============================================================

/**
 * All 5 conditions must be true for deletion.
 */
export const DELETION_CRITERIA = {
  /** 1. Must be archived for this many days */
  min_archived_days: 180,
  /** 2. Must have zero accesses since archival */
  required_access_count: 0,
  /** 3. No incoming edges with strength above this */
  max_edge_strength: 0.5,
  /** 4. Superseding node must still be active */
  superseding_must_be_active: true,
  /** 5. Raw source must exist in Archive Layer */
  raw_must_exist: true,
} as const;

/**
 * Storage pressure threshold that triggers deletion audit.
 */
export const STORAGE_PRESSURE_THRESHOLD = 0.80;

// ============================================================
// CONFLICT QUEUE CONSTANTS
// ============================================================

/**
 * Conflict resolution queue configuration.
 */
export const CONFLICT_QUEUE_CONFIG = {
  /** Maximum items in queue - oldest auto-resolves on overflow */
  max_items: 20,
  /** Days before auto-resolve to "keep both" */
  auto_resolve_days: 14,
  /** Auto-resolve strategy */
  auto_resolve_strategy: 'keep_both' as const,
  /** Weekly prompt day (0=Sunday, 1=Monday) */
  weekly_prompt_day: 1,
} as const;

/**
 * Conflict statuses.
 */
export const CONFLICT_STATUSES = ['pending', 'resolved', 'auto_resolved'] as const;

export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

export const ConflictStatusSchema = z.enum(CONFLICT_STATUSES);

/**
 * User resolution options.
 */
export const USER_RESOLUTIONS = [
  'old_is_current',
  'new_is_current',
  'keep_both',
  'merge',
] as const;

export type UserResolution = (typeof USER_RESOLUTIONS)[number];

export const UserResolutionSchema = z.enum(USER_RESOLUTIONS);

/**
 * Description of each resolution option.
 */
export const USER_RESOLUTION_DESCRIPTIONS: Record<UserResolution, string> = {
  old_is_current: 'Keep the old information as current. Discard the new.',
  new_is_current: 'The new information supersedes the old.',
  keep_both: 'Both are valid. Keep both without supersession.',
  merge: 'Create a merged version combining both.',
} as const;

// ============================================================
// ACCURACY MODE CONSTANTS
// ============================================================

/**
 * User-selectable accuracy modes.
 */
export const ACCURACY_MODES = ['FAST', 'BALANCED', 'THOROUGH', 'MANUAL'] as const;

export type AccuracyMode = (typeof ACCURACY_MODES)[number];

export const AccuracyModeSchema = z.enum(ACCURACY_MODES);

/**
 * Type guard for AccuracyMode.
 */
export function isAccuracyMode(value: unknown): value is AccuracyMode {
  return ACCURACY_MODES.includes(value as AccuracyMode);
}

/**
 * Accuracy targets per tier for monitoring.
 */
export const ACCURACY_TARGETS: Record<DetectionTier, number> = {
  STRUCTURAL: 0.95,
  NORMALIZED: 0.90,
  PATTERN: 0.75,
  CLASSIFIER: 0.85,
  LLM: 0.92,
  VERIFICATION: 0.97,
} as const;

/**
 * Overall auto-supersede accuracy target.
 */
export const AUTO_SUPERSEDE_ACCURACY_TARGET = 0.97;

// ============================================================
// CLASSIFIER TRAINING CONSTANTS
// ============================================================

/**
 * Thresholds for classifier training (self-improvement).
 */
export const CLASSIFIER_TRAINING = {
  /** Train initial model at this many examples */
  initial_train_examples: 500,
  /** Retrain with full dataset at this many examples */
  retrain_examples: 2000,
  /** Minimum accuracy before alerting */
  accuracy_alert_threshold: 0.85,
  /** Auto-supersede accuracy below this triggers conservative mode */
  auto_mode_switch_threshold: 0.95,
} as const;

// ============================================================
// PATTERN MATCHING CONSTANTS
// ============================================================

/**
 * Attribute synonym mappings for Tier 1.5 normalization.
 */
export const ATTRIBUTE_SYNONYMS: Record<string, string[]> = {
  'contact.phone': ['phone', 'cell', 'mobile', 'number', 'telephone'],
  'contact.email': ['email', 'mail', 'e-mail'],
  'belief.stance': ['thinks', 'believes', 'opinion', 'stance', 'position', 'view'],
  'location.residence': ['lives', 'resides', 'located', 'staying', 'address'],
  'meeting.date': ['meeting', 'appointment', 'scheduled'],
  'project.status': ['project', 'deadline', 'due'],
} as const;

/**
 * Correction marker patterns for Tier 2.
 */
export const PATTERN_TRIGGERS = [
  'actually',
  'I was wrong',
  'correction:',
  'update:',
  'no longer',
  'changed to',
  "now it's",
  'turns out',
  'not anymore',
  'used to be',
] as const;

/**
 * Disqualifier patterns for Tier 2.
 */
export const PATTERN_DISQUALIFIERS = [
  "wasn't actually",
  'not really',
  'wrong to doubt',
  'wrong of me',
  'was I wrong?',
  'is it actually?',
  'good point',
  'actually, yes',
  'actually enjoyed',
  'actually quite',
  'actually like',
  'actually think',
] as const;

/**
 * Confidence scoring weights for Tier 2 pattern detection.
 */
export const PATTERN_CONFIDENCE_WEIGHTS = {
  /** Base confidence when trigger found */
  base: 0.50,
  /** Add if entity reference within 10 words */
  entity_nearby: 0.15,
  /** Add if factual value present */
  has_value: 0.10,
  /** Add if temporal signal present */
  temporal_signal: 0.10,
  /** Subtract if any disqualifier found */
  disqualifier_penalty: -0.30,
} as const;

/**
 * Maximum distance (in words) for entity to be considered "nearby".
 */
export const ENTITY_NEARBY_DISTANCE = 10;

// ============================================================
// RETRIEVAL INTEGRATION CONSTANTS
// ============================================================

/**
 * Patterns that trigger history mode in QCS.
 */
export const HISTORY_MODE_PATTERNS = [
  'used to',
  'before',
  'previously',
  'originally',
  'changed',
  'updated',
  'evolved',
  'history of',
  'what did I think',
  'how has .* changed',
] as const;

/**
 * Penalty applied to superseded nodes in history mode.
 */
export const HISTORY_MODE_SUPERSEDED_PENALTY = 0.5;

/**
 * SSA activation cap for superseded nodes.
 */
export const SSA_SUPERSEDED_ACTIVATION_CAP = 0.3;

/**
 * Spread decay factor for superseded nodes.
 */
export const SSA_SUPERSEDED_SPREAD_DECAY = 0.5;

// ============================================================
// QUERY MODE CONSTANTS
// ============================================================

/**
 * Query modes for retrieval.
 */
export const QUERY_MODES = ['current', 'as_of', 'history', 'full_audit'] as const;

export type QueryMode = (typeof QUERY_MODES)[number];

export const QueryModeSchema = z.enum(QUERY_MODES);

/**
 * Type guard for QueryMode.
 */
export function isQueryMode(value: unknown): value is QueryMode {
  return QUERY_MODES.includes(value as QueryMode);
}

// ============================================================
// SENTIMENT CONSTANTS
// ============================================================

/**
 * Sentiment categories for belief analysis.
 */
export const SENTIMENTS = ['positive', 'negative', 'neutral'] as const;

export type Sentiment = (typeof SENTIMENTS)[number];

export const SentimentSchema = z.enum(SENTIMENTS);
