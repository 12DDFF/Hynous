/**
 * @module @nous/core/contradiction
 * @description Types and schemas for Contradiction Resolution System
 * @version 1.0.0
 * @spec Specs/Phase-5-Quality-Control/storm-009
 * @storm Brainstorms/Infrastructure/storm-009-contradiction-handling
 */

import { z } from 'zod';
import {
  type DetectionTier,
  type ConflictType,
  type ResolutionStrategy,
  type SupersededState,
  type ConflictStatus,
  type UserResolution,
  type AccuracyMode,
  type QueryMode,
  DetectionTierSchema,
  ConflictTypeSchema,
  ResolutionStrategySchema,
  SupersededStateSchema,
  ConflictStatusSchema,
  UserResolutionSchema,
  AccuracyModeSchema,
  QueryModeSchema,
} from './constants';

// ============================================================
// DETECTION CONTEXT
// ============================================================

/**
 * Context provided for type classification.
 */
export interface DetectionContext {
  old_value: string;
  new_value: string;
  old_timestamp: string;
  new_timestamp: string;
  old_source_confidence: number;
  new_source_confidence: number;
  has_sentiment_flip: boolean;
  has_scope_expansion: boolean;
  entity_id?: string;
  attribute_type?: string;
  has_correction_pattern: boolean;
}

export const DetectionContextSchema = z.object({
  old_value: z.string(),
  new_value: z.string(),
  old_timestamp: z.string().datetime(),
  new_timestamp: z.string().datetime(),
  old_source_confidence: z.number().min(0).max(1),
  new_source_confidence: z.number().min(0).max(1),
  has_sentiment_flip: z.boolean(),
  has_scope_expansion: z.boolean(),
  entity_id: z.string().optional(),
  attribute_type: z.string().optional(),
  has_correction_pattern: z.boolean(),
});

// ============================================================
// TYPE CLASSIFICATION
// ============================================================

/**
 * Result of classifying a potential contradiction.
 */
export interface TypeClassification {
  type: ConflictType;
  confidence: number;
  auto_supersede: boolean;
  resolution: ResolutionStrategy;
  reasoning: string;
}

export const TypeClassificationSchema = z.object({
  type: ConflictTypeSchema,
  confidence: z.number().min(0).max(1),
  auto_supersede: z.boolean(),
  resolution: ResolutionStrategySchema,
  reasoning: z.string(),
});

// ============================================================
// TIER RESULTS
// ============================================================

/**
 * Result from any detection tier.
 */
export interface TierResult {
  tier: DetectionTier;
  detected: boolean;
  confidence: number;
  conflict_type?: ConflictType;
  should_continue: boolean;
  reasoning?: string;
  time_ms: number;
  cost: number;
}

export const TierResultSchema = z.object({
  tier: DetectionTierSchema,
  detected: z.boolean(),
  confidence: z.number().min(0).max(1),
  conflict_type: ConflictTypeSchema.optional(),
  should_continue: z.boolean(),
  reasoning: z.string().optional(),
  time_ms: z.number().min(0),
  cost: z.number().min(0),
});

/**
 * Tier 1: Structural detection result.
 */
export interface StructuralDetection {
  entity_id?: string;
  attribute_type?: string;
  old_value?: string;
  new_value?: string;
  match_found: boolean;
  values_differ: boolean;
}

export const StructuralDetectionSchema = z.object({
  entity_id: z.string().optional(),
  attribute_type: z.string().optional(),
  old_value: z.string().optional(),
  new_value: z.string().optional(),
  match_found: z.boolean(),
  values_differ: z.boolean(),
});

/**
 * Tier 1.5: Normalization result.
 */
export interface NormalizationResult {
  original_attribute: string;
  normalized_attribute: string;
  synonyms_matched: string[];
  implicit_extraction?: {
    pattern: string;
    extracted_attribute: string;
    extracted_value: string;
  };
}

export const NormalizationResultSchema = z.object({
  original_attribute: z.string(),
  normalized_attribute: z.string(),
  synonyms_matched: z.array(z.string()),
  implicit_extraction: z
    .object({
      pattern: z.string(),
      extracted_attribute: z.string(),
      extracted_value: z.string(),
    })
    .optional(),
});

/**
 * Tier 2: Pattern detection result.
 */
export interface PatternDetection {
  triggers_found: string[];
  entity_nearby: boolean;
  has_value: boolean;
  temporal_signal: boolean;
  disqualifiers_found: string[];
  confidence_score: number;
}

export const PatternDetectionSchema = z.object({
  triggers_found: z.array(z.string()),
  entity_nearby: z.boolean(),
  has_value: z.boolean(),
  temporal_signal: z.boolean(),
  disqualifiers_found: z.array(z.string()),
  confidence_score: z.number().min(0).max(1),
});

/**
 * Tier 2.5: Classifier result.
 */
export interface ClassifierResult {
  is_correction: boolean;
  confidence: number;
  model_used: 'few_shot' | 'fine_tuned';
}

export const ClassifierResultSchema = z.object({
  is_correction: z.boolean(),
  confidence: z.number().min(0).max(1),
  model_used: z.enum(['few_shot', 'fine_tuned']),
});

/**
 * Tier 3: LLM detection output.
 */
export interface LLMDetectionOutput {
  relationship: 'contradicts' | 'updates' | 'evolves' | 'coexists' | 'unrelated';
  confidence: number;
  reasoning: string;
  which_is_current: 'old' | 'new' | 'both' | 'unclear';
  both_could_be_true: boolean;
  is_time_dependent: boolean;
  needs_user_input: boolean;
}

export const LLMDetectionOutputSchema = z.object({
  relationship: z.enum(['contradicts', 'updates', 'evolves', 'coexists', 'unrelated']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  which_is_current: z.enum(['old', 'new', 'both', 'unclear']),
  both_could_be_true: z.boolean(),
  is_time_dependent: z.boolean(),
  needs_user_input: z.boolean(),
});

/**
 * Tier 4: Verification output.
 */
export interface VerificationOutput {
  should_supersede: boolean;
  confidence: number;
  concerns: string[];
  recommendation: 'auto_supersede' | 'queue_for_user' | 'keep_both';
}

export const VerificationOutputSchema = z.object({
  should_supersede: z.boolean(),
  confidence: z.number().min(0).max(1),
  concerns: z.array(z.string()),
  recommendation: z.enum(['auto_supersede', 'queue_for_user', 'keep_both']),
});

/**
 * Full pipeline result.
 */
export interface DetectionPipelineResult {
  final_tier: DetectionTier;
  conflict_detected: boolean;
  conflict_type?: ConflictType;
  overall_confidence: number;
  auto_supersede: boolean;
  needs_user_resolution: boolean;
  tier_results: TierResult[];
  total_time_ms: number;
  total_cost: number;
}

export const DetectionPipelineResultSchema = z.object({
  final_tier: DetectionTierSchema,
  conflict_detected: z.boolean(),
  conflict_type: ConflictTypeSchema.optional(),
  overall_confidence: z.number().min(0).max(1),
  auto_supersede: z.boolean(),
  needs_user_resolution: z.boolean(),
  tier_results: z.array(TierResultSchema),
  total_time_ms: z.number().min(0),
  total_cost: z.number().min(0),
});

// ============================================================
// SUPERSEDED LIFECYCLE
// ============================================================

/**
 * Configuration for each superseded state.
 */
export interface SupersededStateConfig {
  state: SupersededState;
  r_threshold_min?: number;
  r_threshold_max?: number;
  decay_multiplier: number;
  retrieval_mode: 'normal_excluded' | 'history_only' | 'audit_only' | 'none';
  content_state: 'full' | 'summarized' | 'reference_only' | 'deleted';
  duration_days?: number;
}

export const SupersededStateConfigSchema = z.object({
  state: SupersededStateSchema,
  r_threshold_min: z.number().min(0).max(1).optional(),
  r_threshold_max: z.number().min(0).max(1).optional(),
  decay_multiplier: z.number().min(0),
  retrieval_mode: z.enum(['normal_excluded', 'history_only', 'audit_only', 'none']),
  content_state: z.enum(['full', 'summarized', 'reference_only', 'deleted']),
  duration_days: z.number().int().positive().optional(),
});

/**
 * Fields added to a node when superseded.
 */
export interface SupersessionFields {
  superseded_by?: string;
  superseded_at?: string;
  superseded_state?: SupersededState;
  decay_rate_multiplier?: number;
  access_count_since_superseded?: number;
  dormant_since?: string;
  archived_at?: string;
}

export const SupersessionFieldsSchema = z.object({
  superseded_by: z.string().optional(),
  superseded_at: z.string().datetime().optional(),
  superseded_state: SupersededStateSchema.optional(),
  decay_rate_multiplier: z.number().min(0).optional(),
  access_count_since_superseded: z.number().int().min(0).optional(),
  dormant_since: z.string().datetime().optional(),
  archived_at: z.string().datetime().optional(),
});

/**
 * Deletion criteria result.
 */
export interface DeletionCriteriaResult {
  eligible: boolean;
  criteria: {
    archived_long_enough: boolean;
    days_archived: number;
    no_accesses: boolean;
    access_count: number;
    no_important_edges: boolean;
    max_edge_strength: number;
    superseding_active: boolean;
    superseding_node_state?: string;
    raw_in_archive: boolean;
  };
}

export const DeletionCriteriaResultSchema = z.object({
  eligible: z.boolean(),
  criteria: z.object({
    archived_long_enough: z.boolean(),
    days_archived: z.number().int().min(0),
    no_accesses: z.boolean(),
    access_count: z.number().int().min(0),
    no_important_edges: z.boolean(),
    max_edge_strength: z.number().min(0).max(1),
    superseding_active: z.boolean(),
    superseding_node_state: z.string().optional(),
    raw_in_archive: z.boolean(),
  }),
});

/**
 * State transition event.
 */
export interface SupersededStateTransition {
  node_id: string;
  from_state: SupersededState;
  to_state: SupersededState;
  triggered_by: 'decay' | 'time' | 'storage_pressure' | 'user_access';
  timestamp: string;
  context?: {
    retrievability?: number;
    days_in_previous_state?: number;
    user_accessed?: boolean;
  };
}

export const SupersededStateTransitionSchema = z.object({
  node_id: z.string(),
  from_state: SupersededStateSchema,
  to_state: SupersededStateSchema,
  triggered_by: z.enum(['decay', 'time', 'storage_pressure', 'user_access']),
  timestamp: z.string().datetime(),
  context: z
    .object({
      retrievability: z.number().min(0).max(1).optional(),
      days_in_previous_state: z.number().int().min(0).optional(),
      user_accessed: z.boolean().optional(),
    })
    .optional(),
});

// ============================================================
// CONFLICT QUEUE
// ============================================================

/**
 * An item in the conflict resolution queue.
 */
export interface ConflictQueueItem {
  id: string;
  old_node_id: string;
  new_content: string;
  new_node_id?: string;
  conflict_type: ConflictType;
  detection_tier: DetectionTier;
  detection_confidence: number;
  context: string;
  created_at: string;
  expires_at: string;
  status: ConflictStatus;
  entity_name?: string;
  topic?: string;
}

export const ConflictQueueItemSchema = z.object({
  id: z.string(),
  old_node_id: z.string(),
  new_content: z.string(),
  new_node_id: z.string().optional(),
  conflict_type: ConflictTypeSchema,
  detection_tier: DetectionTierSchema,
  detection_confidence: z.number().min(0).max(1),
  context: z.string(),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  status: ConflictStatusSchema,
  entity_name: z.string().optional(),
  topic: z.string().optional(),
});

/**
 * Contradiction resolution event.
 * Note: Named ContradictionResolution to avoid collision with sync module's ConflictResolution.
 */
export interface ContradictionResolution {
  conflict_id: string;
  resolved_by: 'user' | 'auto' | 'timeout';
  resolution: UserResolution;
  resolved_at: string;
  user_merged_content?: string;
  was_override?: boolean;
}

export const ContradictionResolutionSchema = z.object({
  conflict_id: z.string(),
  resolved_by: z.enum(['user', 'auto', 'timeout']),
  resolution: UserResolutionSchema,
  resolved_at: z.string().datetime(),
  user_merged_content: z.string().optional(),
  was_override: z.boolean().optional(),
});

/**
 * Queue status.
 */
export interface ConflictQueueStatus {
  pending_count: number;
  oldest_pending_date?: string;
  next_auto_resolve_date?: string;
  items_resolved_this_week: number;
  at_capacity: boolean;
}

export const ConflictQueueStatusSchema = z.object({
  pending_count: z.number().int().min(0),
  oldest_pending_date: z.string().datetime().optional(),
  next_auto_resolve_date: z.string().datetime().optional(),
  items_resolved_this_week: z.number().int().min(0),
  at_capacity: z.boolean(),
});

/**
 * Conflict presentation for UI.
 */
export interface ConflictPresentation {
  conflict_id: string;
  entity_name?: string;
  topic: string;
  version_a: {
    content: string;
    date: string;
    source?: string;
  };
  version_b: {
    content: string;
    date: string;
    source?: string;
  };
  suggested_action?: UserResolution;
  confidence_in_suggestion: number;
  days_until_auto_resolve: number;
}

export const ConflictPresentationSchema = z.object({
  conflict_id: z.string(),
  entity_name: z.string().optional(),
  topic: z.string(),
  version_a: z.object({
    content: z.string(),
    date: z.string(),
    source: z.string().optional(),
  }),
  version_b: z.object({
    content: z.string(),
    date: z.string(),
    source: z.string().optional(),
  }),
  suggested_action: UserResolutionSchema.optional(),
  confidence_in_suggestion: z.number().min(0).max(1),
  days_until_auto_resolve: z.number().int().min(0),
});

/**
 * Queue configuration.
 */
export interface ConflictQueueConfig {
  max_items: number;
  auto_resolve_days: number;
  auto_resolve_strategy: UserResolution;
  weekly_prompt_enabled: boolean;
  weekly_prompt_day: number;
}

export const ConflictQueueConfigSchema = z.object({
  max_items: z.number().int().positive(),
  auto_resolve_days: z.number().int().positive(),
  auto_resolve_strategy: UserResolutionSchema,
  weekly_prompt_enabled: z.boolean(),
  weekly_prompt_day: z.number().int().min(0).max(6),
});

// ============================================================
// ACCURACY MODES
// ============================================================

/**
 * Accuracy mode configuration.
 */
export interface AccuracyModeConfig {
  mode: AccuracyMode;
  description: string;
  tiers_used: DetectionTier[];
  auto_supersede_tiers: DetectionTier[];
  user_involvement: 'high' | 'medium' | 'low' | 'very_high';
  typical_speed_ms: number;
  typical_cost: number;
  expected_accuracy: number;
}

export const AccuracyModeConfigSchema = z.object({
  mode: AccuracyModeSchema,
  description: z.string(),
  tiers_used: z.array(DetectionTierSchema),
  auto_supersede_tiers: z.array(DetectionTierSchema),
  user_involvement: z.enum(['high', 'medium', 'low', 'very_high']),
  typical_speed_ms: z.number().min(0),
  typical_cost: z.number().min(0),
  expected_accuracy: z.number().min(0).max(1),
});

/**
 * Detection event log.
 */
export interface DetectionEventLog {
  id: string;
  detection_id: string;
  tier_reached: DetectionTier;
  tier_confidence: number;
  auto_resolved: boolean;
  resolution: 'supersede' | 'keep_both' | 'unrelated';
  user_override?: 'agreed' | 'disagreed';
  user_resolution?: UserResolution;
  timestamp: string;
  accuracy_mode: AccuracyMode;
  old_content?: string;
  new_content?: string;
}

export const DetectionEventLogSchema = z.object({
  id: z.string(),
  detection_id: z.string(),
  tier_reached: DetectionTierSchema,
  tier_confidence: z.number().min(0).max(1),
  auto_resolved: z.boolean(),
  resolution: z.enum(['supersede', 'keep_both', 'unrelated']),
  user_override: z.enum(['agreed', 'disagreed']).optional(),
  user_resolution: UserResolutionSchema.optional(),
  timestamp: z.string().datetime(),
  accuracy_mode: AccuracyModeSchema,
  old_content: z.string().optional(),
  new_content: z.string().optional(),
});

/**
 * Accuracy metrics.
 */
export interface AccuracyMetrics {
  period_start: string;
  period_end: string;
  per_tier_accuracy: Record<DetectionTier, number | null>;
  false_positive_rate: number;
  false_negative_rate: number;
  auto_supersede_accuracy: number;
  total_detections: number;
  user_resolutions: number;
  by_mode: Record<AccuracyMode, { detections: number; accuracy: number | null }>;
}

export const AccuracyMetricsSchema = z.object({
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  per_tier_accuracy: z.record(z.number().nullable()),
  false_positive_rate: z.number().min(0).max(1),
  false_negative_rate: z.number().min(0).max(1),
  auto_supersede_accuracy: z.number().min(0).max(1),
  total_detections: z.number().int().min(0),
  user_resolutions: z.number().int().min(0),
  by_mode: z.record(
    z.object({
      detections: z.number().int().min(0),
      accuracy: z.number().nullable(),
    })
  ),
});

/**
 * Self-improvement configuration.
 */
export interface SelfImprovementConfig {
  classifier_initial_train_examples: number;
  classifier_retrain_examples: number;
  accuracy_alert_threshold: number;
  auto_mode_switch_threshold: number;
}

export const SelfImprovementConfigSchema = z.object({
  classifier_initial_train_examples: z.number().int().positive(),
  classifier_retrain_examples: z.number().int().positive(),
  accuracy_alert_threshold: z.number().min(0).max(1),
  auto_mode_switch_threshold: z.number().min(0).max(1),
});

// ============================================================
// RETRIEVAL INTEGRATION
// ============================================================

/**
 * QCS history mode configuration.
 */
export interface QCSHistoryModeConfig {
  history_patterns: readonly string[];
  superseded_penalty: number;
}

export const QCSHistoryModeConfigSchema = z.object({
  history_patterns: z.array(z.string()),
  superseded_penalty: z.number().min(0).max(1),
});

/**
 * History mode detection result.
 */
export interface HistoryModeDetection {
  is_history_mode: boolean;
  matched_patterns: string[];
  suggested_mode: QueryMode;
}

export const HistoryModeDetectionSchema = z.object({
  is_history_mode: z.boolean(),
  matched_patterns: z.array(z.string()),
  suggested_mode: QueryModeSchema,
});

/**
 * RCS supersession flag.
 */
export interface RCSSupersessionFlag {
  flag: 'has_superseded_history';
  trigger: 'top_result_has_superseded_by_chain';
  explanation_text: string;
}

export const RCSSupersessionFlagSchema = z.object({
  flag: z.literal('has_superseded_history'),
  trigger: z.literal('top_result_has_superseded_by_chain'),
  explanation_text: z.string(),
});

/**
 * SSA superseded configuration.
 */
export interface SSASupersededConfig {
  activation_cap: number;
  spread_decay: number;
  spread_to_superseding: boolean;
}

export const SSASupersededConfigSchema = z.object({
  activation_cap: z.number().min(0).max(1),
  spread_decay: z.number().min(0).max(1),
  spread_to_superseding: z.boolean(),
});

/**
 * Phase 2 context injection configuration.
 */
export interface Phase2ContextInjection {
  superseded_context_template: string;
  follow_supersedes_for: readonly string[];
}

export const Phase2ContextInjectionSchema = z.object({
  superseded_context_template: z.string(),
  follow_supersedes_for: z.array(z.string()),
});

/**
 * Query mode configuration.
 */
export interface QueryModeConfig {
  mode: QueryMode;
  include_superseded: boolean;
  superseded_penalty: number;
  description: string;
}

export const QueryModeConfigSchema = z.object({
  mode: QueryModeSchema,
  include_superseded: z.boolean(),
  superseded_penalty: z.number().min(0).max(1),
  description: z.string(),
});

/**
 * Combined retrieval integration configuration.
 */
export interface RetrievalIntegrationConfig {
  qcs: QCSHistoryModeConfig;
  rcs: RCSSupersessionFlag;
  ssa: SSASupersededConfig;
  phase2: Phase2ContextInjection;
}

export const RetrievalIntegrationConfigSchema = z.object({
  qcs: QCSHistoryModeConfigSchema,
  rcs: RCSSupersessionFlagSchema,
  ssa: SSASupersededConfigSchema,
  phase2: Phase2ContextInjectionSchema,
});

// ============================================================
// INPUT TYPES FOR TIER FUNCTIONS
// ============================================================

/**
 * Input for Tier 3 LLM detection.
 */
export interface Tier3Input {
  entity_name: string;
  entity_type: string;
  attribute: string;
  old_value: string;
  old_date: string;
  old_source: string;
  new_statement: string;
  context: string;
  new_date: string;
  new_source: string;
}

export const Tier3InputSchema = z.object({
  entity_name: z.string(),
  entity_type: z.string(),
  attribute: z.string(),
  old_value: z.string(),
  old_date: z.string(),
  old_source: z.string(),
  new_statement: z.string(),
  context: z.string(),
  new_date: z.string(),
  new_source: z.string(),
});

/**
 * Input for Tier 4 verification.
 */
export interface Tier4Input {
  old_value: string;
  entity: string;
  old_date: string;
  new_statement: string;
  new_date: string;
  tier3_result: LLMDetectionOutput;
}

export const Tier4InputSchema = z.object({
  old_value: z.string(),
  entity: z.string(),
  old_date: z.string(),
  new_statement: z.string(),
  new_date: z.string(),
  tier3_result: LLMDetectionOutputSchema,
});
