/**
 * @module @nous/core/clusters
 * @description Constants for the Memory Organization System (storm-006)
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-006
 * @storm Brainstorms/Infrastructure/storm-006-memory-organization
 *
 * This module defines all constants for the memory organization system.
 * Core approach: "Seeded Emergence with Hybrid Evolution" - percentages for
 * scaling, min/max bounds for predictability, and self-tuning from behavior.
 */

// ============================================================
// USER TYPES
// ============================================================

/**
 * User types for onboarding templates.
 * Each type maps to a UnifiedTemplate with predefined clusters and preferences.
 */
export const USER_TYPES = [
  'student',      // Academic focus: classes, homework, exams
  'professional', // Work focus: meetings, projects, career
  'creative',     // Project focus: art, writing, inspiration
  'researcher',   // Research focus: papers, methodology, literature
  'other',        // Pure emergence: skip templates, start fresh
] as const;

export type UserType = (typeof USER_TYPES)[number];

// ============================================================
// EVOLUTION TRIGGERS
// ============================================================

/**
 * Types of cluster evolution events.
 * The system suggests these; user controls whether to accept.
 */
export const EVOLUTION_TRIGGERS = [
  'EMERGE',  // New cluster forms from unclustered embeddings
  'SPLIT',   // Large, diverse cluster divides into smaller ones
  'MERGE',   // Similar clusters with overlapping content combine
  'LEARN',   // Tendencies update based on user behavior
] as const;

export type EvolutionTrigger = (typeof EVOLUTION_TRIGGERS)[number];

// ============================================================
// CLUSTER SOURCES
// ============================================================

/**
 * How a cluster was created.
 * Affects pinning defaults and evolution behavior.
 */
export const CLUSTER_SOURCES = [
  'template',     // Created from onboarding template (pinned by default)
  'emerged',      // Auto-detected from embedding similarity
  'user_created', // Manually created by user (pinned by default)
  'split',        // Result of splitting a large cluster
] as const;

export type ClusterSource = (typeof CLUSTER_SOURCES)[number];

// ============================================================
// ONBOARDING STATES
// ============================================================

/**
 * State machine states for the 5-step onboarding flow.
 * Flow: Welcome → Type Select → Preview → First Chat → First Memory → Complete
 */
export const ONBOARDING_STATES = [
  'not_started',           // User hasn't begun onboarding
  'welcome',               // Step 1: Welcome screen
  'user_type_selection',   // Step 2: Select user type
  'template_preview',      // Step 3: Preview and customize clusters
  'first_chat',            // Step 4: First chat interaction
  'first_memory_saved',    // Step 5: First memory successfully saved
  'completed',             // Onboarding finished
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

// ============================================================
// DEFAULT EVOLUTION THRESHOLDS
// ============================================================

/**
 * Default thresholds for cluster evolution.
 * Uses hybrid approach: percentage-based scaling with min/max bounds.
 */
export interface EvolutionThresholdsType {
  emerge: {
    percentage: number;
    min: number;
    max: number;
    similarity: number;
  };
  split: {
    percentage: number;
    min: number;
    max: number;
    similarity: number;
  };
  merge: {
    similarity: number;
    overlap: number;
  };
}

export const DEFAULT_EVOLUTION_THRESHOLDS: EvolutionThresholdsType = {
  emerge: {
    percentage: 0.01,     // 1% of graph
    min: 10,              // Never below 10 concepts
    max: 100,             // Never above 100 concepts
    similarity: 0.70,     // Intra-cluster similarity required
  },
  split: {
    percentage: 0.10,     // 10% of graph
    min: 50,              // Never below 50 concepts
    max: 500,             // Never above 500 concepts
    similarity: 0.50,     // Below this = too diverse
  },
  merge: {
    similarity: 0.80,     // Inter-cluster similarity required
    overlap: 0.50,        // 50% concept overlap required
  },
};

// ============================================================
// COLD-START CONFIGURATION
// ============================================================

/**
 * Cold-start mode configuration for small graphs.
 * Uses fixed thresholds instead of percentage-based until graph matures.
 */
export interface ColdStartConfigType {
  threshold_nodes: number;
  emerge_fixed: number;
  split_fixed: number;
  min_days: number;
}

export const COLD_START_CONFIG: ColdStartConfigType = {
  threshold_nodes: 200,   // Below this = cold-start mode
  emerge_fixed: 15,       // Fixed emerge threshold
  split_fixed: 100,       // Fixed split threshold
  min_days: 7,            // Minimum 7 days before adaptive
};

// ============================================================
// SELF-TUNING CONFIGURATION
// ============================================================

/**
 * Self-tuning configuration for learning from user behavior.
 */
export interface SelfTuningConfigType {
  enabled: boolean;
  max_drift: number;
  window_days: number;
  reset_available: boolean;
}

export const SELF_TUNING_CONFIG: SelfTuningConfigType = {
  enabled: true,
  max_drift: 0.20,        // ±20% from initial
  window_days: 30,        // 30-day observation window
  reset_available: true,  // User can reset anytime
};

// ============================================================
// CLUSTER HEALTH THRESHOLDS
// ============================================================

/**
 * Thresholds for calculating cluster health.
 * Uses retrievability (R) from storm-007 to categorize node states.
 */
export interface ClusterHealthThresholdsType {
  active_threshold: number;
  weak_threshold: number;
  unhealthy_ratio: number;
}

export const CLUSTER_HEALTH_THRESHOLDS: ClusterHealthThresholdsType = {
  active_threshold: 0.5,   // Same as storm-007 ACTIVE threshold
  weak_threshold: 0.1,     // Same as storm-007 WEAK threshold
  unhealthy_ratio: 0.2,    // <20% active = unhealthy
};

// ============================================================
// ROUTING CONFIGURATION
// ============================================================

/**
 * Configuration for soft query routing to clusters.
 */
export interface RoutingConfigType {
  min_affinity: number;
  search_all_gap: number;
  max_clusters: number;
}

export const ROUTING_CONFIG: RoutingConfigType = {
  min_affinity: 0.3,      // Ignore clusters below 0.3 affinity
  search_all_gap: 0.1,    // If top 2 within 0.1, search all
  max_clusters: 3,        // Include up to 3 clusters in partial search
};

// ============================================================
// TENDENCY DEFAULTS
// ============================================================

/**
 * Default values for cluster tendencies.
 */
export interface TendencyDefaultsType {
  decay_rate_modifier: number;
  initial_confidence: number;
  min_observations: number;
}

export const TENDENCY_DEFAULTS: TendencyDefaultsType = {
  decay_rate_modifier: 1.0,  // No modification initially
  initial_confidence: 0.1,   // Low confidence until learned
  min_observations: 10,      // Need 10+ observations
};

// ============================================================
// TYPE GUARDS
// ============================================================

/**
 * Type guard for UserType.
 */
export function isUserType(value: string): value is UserType {
  return USER_TYPES.includes(value as UserType);
}

/**
 * Type guard for EvolutionTrigger.
 */
export function isEvolutionTrigger(value: string): value is EvolutionTrigger {
  return EVOLUTION_TRIGGERS.includes(value as EvolutionTrigger);
}

/**
 * Type guard for ClusterSource.
 */
export function isClusterSource(value: string): value is ClusterSource {
  return CLUSTER_SOURCES.includes(value as ClusterSource);
}

/**
 * Type guard for OnboardingState.
 */
export function isOnboardingState(value: string): value is OnboardingState {
  return ONBOARDING_STATES.includes(value as OnboardingState);
}
