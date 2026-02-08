/**
 * @module @nous/core/forgetting
 * @description Constants for the Forgetting & Persistence Model (storm-007)
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-007
 * @storm Brainstorms/Infrastructure/storm-007-forgetting-model
 *
 * This module defines all constants for the FSRS-inspired forgetting system.
 * It extends storm-028's decay config with content-category specific values.
 */

// ============================================================
// CONTENT CATEGORIES
// ============================================================

/**
 * Content categories for initial stability and difficulty assignment.
 * Each category has distinct decay characteristics based on content nature.
 */
export const CONTENT_CATEGORIES = [
  'identity',      // Personal facts: name, birthday, address
  'academic',      // Concepts, definitions, learned facts
  'conversation',  // Chat messages, casual discussion
  'work',          // Meetings, projects, documents
  'temporal',      // Events, appointments, deadlines
  'document',      // Imported raw documents
  'general',       // Default/unknown
] as const;

export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

// ============================================================
// FORGETTING LIFECYCLE STATES
// ============================================================

/**
 * Extended lifecycle states for the forgetting model.
 * Extends storm-028's 5 states (ACTIVE, WEAK, DORMANT, COMPRESS, ARCHIVE)
 * to 8 states including deletion workflow.
 */
export const FORGETTING_LIFECYCLE_STATES = [
  'ACTIVE',              // R > 0.5 - Full search inclusion
  'WEAK',                // R 0.1-0.5 - Search with penalty
  'DORMANT',             // R < 0.1 for 60+ days - Excluded from search
  'SUMMARIZED',          // 120+ days dormant - Compressed via P-008
  'ARCHIVED',            // 180+ days dormant - Cold storage
  'DELETION_CANDIDATE',  // 365+ days archived - Flagged for review
  'TRASH',               // User confirmed - 30-day buffer
  'DELETED',             // Permanently removed
] as const;

export type ForgettingLifecycleState = (typeof FORGETTING_LIFECYCLE_STATES)[number];

// ============================================================
// STRENGTHENING EVENTS
// ============================================================

/**
 * Events that strengthen a node's neural state.
 * Separate from edge Hebbian learning (storm-031).
 */
export const STRENGTHENING_EVENTS = [
  'direct_retrieval',    // Node was directly retrieved for a query
  'co_activation',       // Activated alongside another node
  'user_interaction',    // User edited, pinned, or expanded
  'external_reference',  // Node mentioned in new input
] as const;

export type StrengtheningEventType = (typeof STRENGTHENING_EVENTS)[number];

// ============================================================
// INITIAL STABILITY BY CONTENT CATEGORY
// ============================================================

/**
 * Initial stability in DAYS by content category.
 * When a node is promoted from Working Memory, it receives this initial stability.
 *
 * Rationale from FSRS research (storm-007 cycle-3/research.md):
 * - identity: 30 days - Emotionally significant, rarely changes
 * - academic: 1 day - Needs spaced repetition to consolidate
 * - conversation: 0.5 days (12h) - Ephemeral, context-dependent
 * - work: 3 days - Project-relevant medium term
 * - temporal: 7 days - Until event passes
 * - document: 1 day - Raw content needs extraction
 * - general: 1 day - Conservative default
 */
export const INITIAL_STABILITY_BY_CATEGORY: Record<ContentCategory, number> = {
  identity: 30,
  academic: 1,
  conversation: 0.5,  // 12 hours
  work: 3,
  temporal: 7,
  document: 1,
  general: 1,
};

// ============================================================
// BASE DIFFICULTY BY CONTENT CATEGORY
// ============================================================

/**
 * Base difficulty (0-1) by content category.
 * Used as starting point for difficulty calculation.
 *
 * Rationale:
 * - identity: 0.1 - Easy due to personal relevance
 * - academic: 0.5 - Medium, requires effort
 * - conversation: 0.2 - Low, natural language
 * - work: 0.4 - Medium, contextual
 * - temporal: 0.2 - Low, time-anchored
 * - document: 0.6 - Higher, dense content
 * - general: 0.3 - Default
 */
export const BASE_DIFFICULTY_BY_CATEGORY: Record<ContentCategory, number> = {
  identity: 0.1,
  academic: 0.5,
  conversation: 0.2,
  work: 0.4,
  temporal: 0.2,
  document: 0.6,
  general: 0.3,
};

// ============================================================
// STRENGTHENING BONUSES
// ============================================================

/**
 * Bonus amounts for each strengthening event type.
 * Applied using Hebbian saturation formula: strength += bonus × (max - strength)
 */
export const STRENGTHENING_BONUSES: Record<StrengtheningEventType, number> = {
  direct_retrieval: 0.10,    // Strong signal - user asked for this
  co_activation: 0.03,       // Weak but cumulative
  user_interaction: 0.15,    // Strongest - edit, pin, expand
  external_reference: 0.05,  // Moderate - mentioned in new input
};

/**
 * Maximum strength value (cap).
 */
export const MAX_STRENGTH = 1.0;

/**
 * Default initial strength for promoted nodes.
 */
export const DEFAULT_STRENGTH = 0.5;

// ============================================================
// DIFFICULTY CONFIGURATION
// ============================================================

/**
 * Configuration for difficulty calculation.
 */
export interface DifficultyConfigType {
  /** Weight for complexity factor in difficulty calculation (0.2) */
  complexity_weight: number;
  /** Weight for re-access penalty in difficulty calculation (0.15) */
  reaccess_weight: number;
  /** Weight for connection bonus in difficulty calculation (0.1) */
  connection_weight: number;
  /** Rate of mean reversion toward target difficulty (0.1 = 10%) */
  mean_reversion_rate: number;
  /** Target difficulty for mean reversion (0.3) */
  target_difficulty: number;
  /** Minimum difficulty floor (0.05) */
  min_difficulty: number;
  /** Maximum difficulty cap (0.95) */
  max_difficulty: number;
  /** Days between access that triggers reaccess penalty (< 3 days = penalty) */
  reaccess_penalty_threshold_days: number;
  /** Reaccess penalty amount when triggered (0.2) */
  reaccess_penalty_amount: number;
  /** Maximum connection bonus (0.3) */
  max_connection_bonus: number;
  /** Edges per bonus unit (0.02 per edge) */
  connection_bonus_per_edge: number;
}

export const DIFFICULTY_CONFIG: DifficultyConfigType = {
  complexity_weight: 0.2,
  reaccess_weight: 0.15,
  connection_weight: 0.1,
  mean_reversion_rate: 0.1,
  target_difficulty: 0.3,
  min_difficulty: 0.05,
  max_difficulty: 0.95,
  reaccess_penalty_threshold_days: 3,
  reaccess_penalty_amount: 0.2,
  max_connection_bonus: 0.3,
  connection_bonus_per_edge: 0.02,
};

// ============================================================
// LIFECYCLE THRESHOLDS
// ============================================================

/**
 * Thresholds for lifecycle state transitions.
 * Note: active_threshold, weak_threshold, dormant_days come from storm-028.
 * This module adds compress_days, archive_days, and deletion thresholds.
 */
export interface LifecycleThresholdsType {
  /** R > this = ACTIVE (from storm-028: 0.5) */
  active_threshold: number;
  /** R > this = WEAK, R < this = DORMANT (from storm-028: 0.1) */
  weak_threshold: number;
  /** Days at R < weak_threshold before dormant status (from storm-028: 60) */
  dormant_days: number;
  /** Days dormant before compression eligible (120) */
  compress_days: number;
  /** Days dormant before full archive (180) */
  archive_days: number;
  /** Days archived before becoming deletion candidate (365) */
  deletion_candidate_days: number;
  /** Days in trash before permanent deletion (30) */
  trash_buffer_days: number;
  /** Days since archive search to be considered "recent" (180) */
  recent_search_days: number;
}

export const LIFECYCLE_THRESHOLDS: LifecycleThresholdsType = {
  active_threshold: 0.5,
  weak_threshold: 0.1,
  dormant_days: 60,
  compress_days: 120,
  archive_days: 180,
  deletion_candidate_days: 365,
  trash_buffer_days: 30,
  recent_search_days: 180,
};

// ============================================================
// DELETION EXCLUSION RULES (Option B)
// ============================================================

/**
 * Exclusion rules for deletion candidates.
 * If ANY rule is true, the node is NOT a deletion candidate.
 * Option B: Simple days threshold + exclusion rules.
 */
export interface DeletionExclusionRulesType {
  /** Never suggest deleting identity content */
  exclude_identity_content: boolean;
  /** User explicitly marked as important */
  exclude_pinned: boolean;
  /** Still referenced by active nodes (R > 0.5) */
  exclude_with_active_links: boolean;
  /** User restored from archive/trash before = valuable */
  exclude_if_ever_restored: boolean;
  /** User searched for it via archive search recently */
  exclude_if_searched_recently: boolean;
}

export const DELETION_EXCLUSION_RULES: DeletionExclusionRulesType = {
  exclude_identity_content: true,
  exclude_pinned: true,
  exclude_with_active_links: true,
  exclude_if_ever_restored: true,
  exclude_if_searched_recently: true,
};

/**
 * Full deletion criteria configuration.
 */
export interface DeletionCriteriaType {
  /** Minimum days archived before becoming candidate (365) */
  min_days_archived: number;
  /** Exclusion rules */
  exclusions: DeletionExclusionRulesType;
}

export const DELETION_CRITERIA: DeletionCriteriaType = {
  min_days_archived: LIFECYCLE_THRESHOLDS.deletion_candidate_days,
  exclusions: DELETION_EXCLUSION_RULES,
};

// ============================================================
// TRASH CONFIGURATION
// ============================================================

/**
 * Trash buffer configuration for safety net before permanent deletion.
 */
export interface TrashConfigType {
  /** Days before auto-empty (30) */
  buffer_days: number;
  /** Automatically empty after buffer_days */
  auto_empty: boolean;
  /** Show trash in storage count */
  show_in_storage_count: boolean;
}

export const TRASH_CONFIG: TrashConfigType = {
  buffer_days: LIFECYCLE_THRESHOLDS.trash_buffer_days,
  auto_empty: true,
  show_in_storage_count: true,
};

// ============================================================
// COMPRESSION PROMPT SPEC (P-008)
// ============================================================

/**
 * P-008 Compression Summary prompt specification.
 * Note: Actual prompt content is storm-027's responsibility.
 * This defines the interface and parameters.
 */
export interface CompressionPromptSpecType {
  /** Prompt identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Model to use (fast/cheap) */
  model: string;
  /** Fallback model */
  fallback_model: string;
  /** Max output tokens */
  max_tokens: number;
  /** Temperature (low for consistency) */
  temperature: number;
}

export const P008_COMPRESSION_PROMPT_SPEC: CompressionPromptSpecType = {
  id: 'P-008',
  name: 'Compression Summary',
  model: 'claude-3-haiku',
  fallback_model: 'gpt-4o-mini',
  max_tokens: 200,
  temperature: 0.3,
};

// ============================================================
// DECAY JOB SPECIFICATION (J-001)
// ============================================================

/**
 * J-001 Decay Cycle Job specification for storm-034.
 */
export interface DecayJobSpecType {
  /** Job identifier */
  id: string;
  /** Job name */
  name: string;
  /** Cron schedule (daily at 3am UTC) */
  schedule: string;
  /** Priority level */
  priority: 'low' | 'medium' | 'high';
  /** Max concurrent instances */
  concurrency: number;
  /** Timeout in minutes */
  timeout_minutes: number;
}

export const DECAY_JOB_SPEC: DecayJobSpecType = {
  id: 'J-001',
  name: 'decay-cycle',
  schedule: '0 3 * * *',  // Daily at 3am UTC
  priority: 'low',
  concurrency: 1,
  timeout_minutes: 30,
};

// ============================================================
// AGGREGATE FORGETTING CONFIG
// ============================================================

/**
 * Aggregate forgetting configuration combining all settings.
 */
export interface ForgettingConfigType {
  /** Initial stability by content category */
  initial_stability: Record<ContentCategory, number>;
  /** Base difficulty by content category */
  base_difficulty: Record<ContentCategory, number>;
  /** Strengthening bonuses by event type */
  strengthening_bonuses: Record<StrengtheningEventType, number>;
  /** Difficulty calculation config */
  difficulty: DifficultyConfigType;
  /** Lifecycle thresholds */
  thresholds: LifecycleThresholdsType;
  /** Deletion criteria */
  deletion: DeletionCriteriaType;
  /** Trash config */
  trash: TrashConfigType;
  /** Compression prompt spec */
  compression: CompressionPromptSpecType;
  /** Decay job spec */
  decay_job: DecayJobSpecType;
  /** Max strength cap */
  max_strength: number;
  /** Default initial strength */
  default_strength: number;
}

export const FORGETTING_CONFIG: ForgettingConfigType = {
  initial_stability: INITIAL_STABILITY_BY_CATEGORY,
  base_difficulty: BASE_DIFFICULTY_BY_CATEGORY,
  strengthening_bonuses: STRENGTHENING_BONUSES,
  difficulty: DIFFICULTY_CONFIG,
  thresholds: LIFECYCLE_THRESHOLDS,
  deletion: DELETION_CRITERIA,
  trash: TRASH_CONFIG,
  compression: P008_COMPRESSION_PROMPT_SPEC,
  decay_job: DECAY_JOB_SPEC,
  max_strength: MAX_STRENGTH,
  default_strength: DEFAULT_STRENGTH,
};

// ============================================================
// TYPE GUARDS
// ============================================================

/**
 * Type guard for ContentCategory.
 */
export function isContentCategory(value: string): value is ContentCategory {
  return CONTENT_CATEGORIES.includes(value as ContentCategory);
}

/**
 * Type guard for ForgettingLifecycleState.
 */
export function isForgettingLifecycleState(value: string): value is ForgettingLifecycleState {
  return FORGETTING_LIFECYCLE_STATES.includes(value as ForgettingLifecycleState);
}

/**
 * Type guard for StrengtheningEventType.
 */
export function isStrengtheningEventType(value: string): value is StrengtheningEventType {
  return STRENGTHENING_EVENTS.includes(value as StrengtheningEventType);
}
