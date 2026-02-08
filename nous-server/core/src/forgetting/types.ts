/**
 * @module @nous/core/forgetting/types
 * @description All interfaces and Zod schemas for storm-007 Forgetting & Persistence Model
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-007
 * @storm Brainstorms/Infrastructure/storm-007-forgetting-model
 */

import { z } from 'zod';
import {
  CONTENT_CATEGORIES,
  FORGETTING_LIFECYCLE_STATES,
  STRENGTHENING_EVENTS,
  LIFECYCLE_THRESHOLDS,
  DIFFICULTY_CONFIG,
  MAX_STRENGTH,
  type ContentCategory,
  type ForgettingLifecycleState,
  type StrengtheningEventType,
} from './constants';

// ============================================================
// NEURAL STATE
// ============================================================

/**
 * Node's neural state for the forgetting model.
 * Tracks stability, retrievability, strength, and difficulty.
 */
export interface NeuralState {
  /** Days until 90% recall probability (FSRS: S) */
  stability: number;
  /** Current recall probability 0-1 (FSRS: R) */
  retrievability: number;
  /** Node strength 0-1, used for ranking (Hebbian saturation) */
  strength: number;
  /** Inferred complexity 0-1 (FSRS: D) */
  difficulty: number;
  /** Last time this node was accessed */
  last_accessed: Date;
  /** Total number of accesses */
  access_count: number;
  /** Current lifecycle state */
  lifecycle_state: ForgettingLifecycleState;
  /** Days spent in current dormant-or-worse state */
  days_in_dormant?: number;
}

export const NeuralStateSchema = z.object({
  stability: z.number().positive(),
  retrievability: z.number().min(0).max(1),
  strength: z.number().min(0).max(MAX_STRENGTH),
  difficulty: z.number().min(DIFFICULTY_CONFIG.min_difficulty).max(DIFFICULTY_CONFIG.max_difficulty),
  last_accessed: z.date(),
  access_count: z.number().int().nonnegative(),
  lifecycle_state: z.enum(FORGETTING_LIFECYCLE_STATES),
  days_in_dormant: z.number().nonnegative().optional(),
});

// ============================================================
// STRENGTHENING RECORD
// ============================================================

/**
 * Record of a node strengthening event.
 */
export interface StrengtheningRecord {
  /** Type of strengthening event */
  type: StrengtheningEventType;
  /** When the event occurred */
  timestamp: Date;
  /** Strength value before this event */
  strength_before: number;
  /** Strength value after this event */
  strength_after: number;
  /** Change in strength (positive) */
  strength_delta: number;
}

export const StrengtheningRecordSchema = z.object({
  type: z.enum(STRENGTHENING_EVENTS),
  timestamp: z.date(),
  strength_before: z.number().min(0).max(MAX_STRENGTH),
  strength_after: z.number().min(0).max(MAX_STRENGTH),
  strength_delta: z.number().min(0),
});

// ============================================================
// DIFFICULTY FACTORS
// ============================================================

/**
 * Breakdown of difficulty calculation factors.
 */
export interface DifficultyFactors {
  /** Base difficulty from content category */
  base: number;
  /** Complexity factor from content analysis (0-1) */
  complexity: number;
  /** Re-access penalty (0 or reaccess_penalty_amount) */
  reaccess_penalty: number;
  /** Connection bonus (reduces difficulty) */
  connection_bonus: number;
  /** Final calculated difficulty after mean reversion and clamping */
  calculated: number;
}

export const DifficultyFactorsSchema = z.object({
  base: z.number().min(0).max(1),
  complexity: z.number().min(0).max(1),
  reaccess_penalty: z.number().min(0).max(1),
  connection_bonus: z.number().min(0).max(1),
  calculated: z.number().min(DIFFICULTY_CONFIG.min_difficulty).max(DIFFICULTY_CONFIG.max_difficulty),
});

// ============================================================
// COMPLEXITY ANALYSIS RESULT
// ============================================================

/**
 * Result of content complexity analysis.
 */
export interface ComplexityAnalysis {
  /** Normalized word count score (0-1) */
  length_score: number;
  /** Average sentence length score (0-1) */
  sentence_score: number;
  /** Average word length / vocabulary score (0-1) */
  vocab_score: number;
  /** Final complexity (average of scores) */
  complexity: number;
}

export const ComplexityAnalysisSchema = z.object({
  length_score: z.number().min(0).max(1),
  sentence_score: z.number().min(0).max(1),
  vocab_score: z.number().min(0).max(1),
  complexity: z.number().min(0).max(1),
});

// ============================================================
// COMPRESSION INPUT/OUTPUT
// ============================================================

/**
 * Input for compression operation.
 */
export interface CompressionInput {
  /** Node ID to compress */
  nodeId: string;
  /** Node title */
  title: string;
  /** Node content */
  content: string;
  /** Connected node titles (1 hop) */
  connected_nodes: string[];
  /** Temporal span if known */
  temporal_span: string | null;
}

export const CompressionInputSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  content: z.string(),
  connected_nodes: z.array(z.string()),
  temporal_span: z.string().nullable(),
});

/**
 * Result of compression operation (P-008 output).
 */
export interface CompressionResult {
  /** Brief 1-3 sentence summary */
  summary: string;
  /** Preserved entity names */
  preserved_entities: string[];
  /** Key facts extracted */
  key_facts: string[];
  /** Temporal span if detected */
  temporal_span: string | null;
  /** ID of created summary node */
  summary_node_id: string;
  /** ID of original node (now archived) */
  original_node_id: string;
  /** When compression occurred */
  compressed_at: Date;
}

export const CompressionResultSchema = z.object({
  summary: z.string(),
  preserved_entities: z.array(z.string()),
  key_facts: z.array(z.string()),
  temporal_span: z.string().nullable(),
  summary_node_id: z.string(),
  original_node_id: z.string(),
  compressed_at: z.date(),
});

// ============================================================
// EXCLUSION CHECK RESULT
// ============================================================

/**
 * Result of checking deletion exclusion rules.
 */
export interface ExclusionCheckResult {
  /** Is identity content (excluded) */
  is_identity: boolean;
  /** Is pinned (excluded) */
  is_pinned: boolean;
  /** Has active inbound links (excluded) */
  has_active_links: boolean;
  /** Was ever restored from archive/trash (excluded) */
  was_ever_restored: boolean;
  /** Was searched recently via archive search (excluded) */
  was_searched_recently: boolean;
  /** Any exclusion triggered = not a candidate */
  any_exclusion: boolean;
}

export const ExclusionCheckResultSchema = z.object({
  is_identity: z.boolean(),
  is_pinned: z.boolean(),
  has_active_links: z.boolean(),
  was_ever_restored: z.boolean(),
  was_searched_recently: z.boolean(),
  any_exclusion: z.boolean(),
});

// ============================================================
// DELETION CANDIDATE
// ============================================================

/**
 * Result of deletion candidate check.
 */
export interface DeletionCandidate {
  /** Node ID */
  nodeId: string;
  /** Days since archived */
  days_archived: number;
  /** Days since any access (including archive search) */
  days_since_access: number;
  /** Content category for reference */
  content_category: ContentCategory;
  /** Exclusion check results */
  exclusion_checks: ExclusionCheckResult;
  /** Final determination: is this a deletion candidate? */
  is_candidate: boolean;
  /** Reason for determination */
  reason: string;
}

export const DeletionCandidateSchema = z.object({
  nodeId: z.string(),
  days_archived: z.number().nonnegative(),
  days_since_access: z.number().nonnegative(),
  content_category: z.enum(CONTENT_CATEGORIES),
  exclusion_checks: ExclusionCheckResultSchema,
  is_candidate: z.boolean(),
  reason: z.string(),
});

// ============================================================
// TRASH RECORD
// ============================================================

/**
 * Record of a node in trash.
 */
export interface TrashRecord {
  /** Node ID */
  nodeId: string;
  /** When moved to trash */
  trashed_at: Date;
  /** When it will auto-delete (trashed_at + buffer_days) */
  auto_delete_at: Date;
  /** Reason for deletion */
  reason: string;
  /** Who initiated (user or system) */
  initiated_by: 'user' | 'system';
}

export const TrashRecordSchema = z.object({
  nodeId: z.string(),
  trashed_at: z.date(),
  auto_delete_at: z.date(),
  reason: z.string(),
  initiated_by: z.enum(['user', 'system']),
});

// ============================================================
// CLEANUP SETTINGS
// ============================================================

/**
 * User-configurable cleanup preferences.
 */
export interface CleanupSettings {
  /** Days archived before becoming candidate (default: 365, range: 180-730) */
  deletion_candidate_days: number;
  /** Days in trash before auto-delete (default: 30, range: 7-90) */
  trash_buffer_days: number;
  /** How often to remind about cleanup */
  cleanup_reminder_frequency: 'monthly' | 'quarterly' | 'yearly' | 'never';
  /** Storage percentage that triggers warning (default: 0.8) */
  storage_warning_threshold: number;
  /** Auto-suggest cleanup when candidates exist */
  auto_suggest_cleanup: boolean;
  /** Always require confirmation for deletion */
  require_confirmation: boolean;
}

export const CleanupSettingsSchema = z.object({
  deletion_candidate_days: z.number().int().min(180).max(730).default(LIFECYCLE_THRESHOLDS.deletion_candidate_days),
  trash_buffer_days: z.number().int().min(7).max(90).default(LIFECYCLE_THRESHOLDS.trash_buffer_days),
  cleanup_reminder_frequency: z.enum(['monthly', 'quarterly', 'yearly', 'never']).default('quarterly'),
  storage_warning_threshold: z.number().min(0.5).max(1.0).default(0.8),
  auto_suggest_cleanup: z.boolean().default(true),
  require_confirmation: z.boolean().default(true),
});

// ============================================================
// STORAGE METRICS
// ============================================================

/**
 * Storage breakdown by lifecycle state.
 */
export interface StorageMetrics {
  /** Active nodes (R > 0.5) */
  active: { count: number; size_bytes: number };
  /** Weak nodes (R 0.1-0.5) */
  weak: { count: number; size_bytes: number };
  /** Dormant nodes */
  dormant: { count: number; size_bytes: number };
  /** Summarized nodes */
  summarized: { count: number; size_bytes: number };
  /** Archived nodes */
  archived: { count: number; size_bytes: number };
  /** Deletion candidates */
  deletion_candidates: { count: number; size_bytes: number };
  /** Trash */
  trash: { count: number; size_bytes: number };
  /** Total */
  total: { count: number; size_bytes: number };
}

export const StorageMetricsSchema = z.object({
  active: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  weak: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  dormant: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  summarized: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  archived: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  deletion_candidates: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  trash: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
  total: z.object({ count: z.number().int().nonnegative(), size_bytes: z.number().nonnegative() }),
});

// ============================================================
// STABILITY UPDATE RESULT
// ============================================================

/**
 * Result of updating stability on access.
 */
export interface StabilityUpdateResult {
  /** Node ID */
  nodeId: string;
  /** Stability before update */
  stability_before: number;
  /** Stability after update */
  stability_after: number;
  /** Growth factor applied (growth_rate × difficultyFactor) */
  growth_factor: number;
  /** Difficulty at time of update */
  difficulty: number;
  /** Whether capped at max_stability_days */
  capped: boolean;
  /** Retrievability reset to 1.0 */
  retrievability_reset: boolean;
}

export const StabilityUpdateResultSchema = z.object({
  nodeId: z.string(),
  stability_before: z.number().positive(),
  stability_after: z.number().positive(),
  growth_factor: z.number().positive(),
  difficulty: z.number().min(0).max(1),
  capped: z.boolean(),
  retrievability_reset: z.boolean(),
});

// ============================================================
// STATE TRANSITION
// ============================================================

/**
 * Record of a lifecycle state transition.
 */
export interface StateTransition {
  /** From state */
  from: ForgettingLifecycleState;
  /** To state */
  to: ForgettingLifecycleState;
  /** Count of nodes that transitioned */
  count: number;
}

export const StateTransitionSchema = z.object({
  from: z.enum(FORGETTING_LIFECYCLE_STATES),
  to: z.enum(FORGETTING_LIFECYCLE_STATES),
  count: z.number().int().nonnegative(),
});

// ============================================================
// DECAY JOB RESULT
// ============================================================

/**
 * Result of J-001 decay cycle job.
 */
export interface DecayJobResult {
  /** Total nodes evaluated */
  evaluated: number;
  /** State transitions that occurred */
  state_changes: StateTransition[];
  /** Nodes compressed */
  compressed: number;
  /** Nodes archived */
  archived: number;
  /** New deletion candidates flagged */
  deletion_candidates_flagged: number;
  /** Nodes auto-deleted from trash */
  auto_deleted: number;
  /** Errors encountered */
  errors: string[];
  /** When the job ran */
  executed_at: Date;
  /** Duration in milliseconds */
  duration_ms: number;
}

export const DecayJobResultSchema = z.object({
  evaluated: z.number().int().nonnegative(),
  state_changes: z.array(StateTransitionSchema),
  compressed: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  deletion_candidates_flagged: z.number().int().nonnegative(),
  auto_deleted: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  executed_at: z.date(),
  duration_ms: z.number().nonnegative(),
});

// ============================================================
// NODE DECAY INPUT
// ============================================================

/**
 * Input for decay calculation on a single node.
 */
export interface NodeDecayInput {
  /** Node ID */
  nodeId: string;
  /** Content category */
  content_category: ContentCategory;
  /** Current neural state */
  neural_state: NeuralState;
  /** Is pinned by user */
  pinned: boolean;
  /** Times restored from archive/trash */
  restore_count: number;
  /** Last archive search hit */
  last_archive_search_hit: Date | null;
  /** Inbound edge count from active nodes */
  active_inbound_link_count: number;
}

export const NodeDecayInputSchema = z.object({
  nodeId: z.string(),
  content_category: z.enum(CONTENT_CATEGORIES),
  neural_state: NeuralStateSchema,
  pinned: z.boolean(),
  restore_count: z.number().int().nonnegative(),
  last_archive_search_hit: z.date().nullable(),
  active_inbound_link_count: z.number().int().nonnegative(),
});

// ============================================================
// STRENGTHENING RESULT
// ============================================================

/**
 * Result of strengthening a node.
 */
export interface StrengtheningResult {
  /** Updated neural state */
  updated_state: NeuralState;
  /** Record of the strengthening event */
  record: StrengtheningRecord;
}

export const StrengtheningResultSchema = z.object({
  updated_state: NeuralStateSchema,
  record: StrengtheningRecordSchema,
});

// ============================================================
// LIFECYCLE DETERMINATION RESULT
// ============================================================

/**
 * Result of determining lifecycle state.
 */
export interface LifecycleDetermination {
  /** Current retrievability */
  retrievability: number;
  /** Days in dormant-or-worse state */
  days_dormant: number;
  /** Determined state */
  state: ForgettingLifecycleState;
  /** Whether eligible for compression */
  compression_eligible: boolean;
  /** Whether eligible for archive */
  archive_eligible: boolean;
  /** Whether eligible for deletion candidacy */
  deletion_candidate_eligible: boolean;
}

export const LifecycleDeterminationSchema = z.object({
  retrievability: z.number().min(0).max(1),
  days_dormant: z.number().nonnegative(),
  state: z.enum(FORGETTING_LIFECYCLE_STATES),
  compression_eligible: z.boolean(),
  archive_eligible: z.boolean(),
  deletion_candidate_eligible: z.boolean(),
});

// ============================================================
// CREATE NEURAL STATE OPTIONS
// ============================================================

/**
 * Options for creating initial neural state.
 */
export interface CreateNeuralStateOptions {
  /** Content category for initial values */
  content_category: ContentCategory;
  /** Override initial stability (optional) */
  initial_stability?: number;
  /** Override initial difficulty (optional) */
  initial_difficulty?: number;
  /** Override initial strength (optional, default: 0.5) */
  initial_strength?: number;
}

export const CreateNeuralStateOptionsSchema = z.object({
  content_category: z.enum(CONTENT_CATEGORIES),
  initial_stability: z.number().positive().optional(),
  initial_difficulty: z.number().min(0).max(1).optional(),
  initial_strength: z.number().min(0).max(1).optional(),
});
