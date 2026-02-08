/**
 * @module @nous/core/clusters
 * @description Types and Zod schemas for the Memory Organization System (storm-006)
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-006
 * @storm Brainstorms/Infrastructure/storm-006-memory-organization
 */

import { z } from 'zod';
import {
  UserType,
  USER_TYPES,
  EvolutionTrigger,
  EVOLUTION_TRIGGERS,
  ClusterSource,
  CLUSTER_SOURCES,
  OnboardingState,
  ONBOARDING_STATES,
  DEFAULT_EVOLUTION_THRESHOLDS,
  SELF_TUNING_CONFIG,
} from './constants';

// ============================================================
// CONTEXT PREFERENCES (storm-020 integration)
// ============================================================

/**
 * Context preferences from storm-020.
 * Forward declaration for integration.
 */
export interface ContextPreferences {
  tone?: 'formal' | 'neutral' | 'casual';
  verbosity?: 'concise' | 'adaptive' | 'detailed';
  default_format?: 'prose' | 'bullets' | 'structured';
  use_citations?: boolean;
  retrieval_scope?: 'this_only' | 'this_plus' | 'all';
  include_contexts?: string[];
}

export const ContextPreferencesSchema = z.object({
  tone: z.enum(['formal', 'neutral', 'casual']).optional(),
  verbosity: z.enum(['concise', 'adaptive', 'detailed']).optional(),
  default_format: z.enum(['prose', 'bullets', 'structured']).optional(),
  use_citations: z.boolean().optional(),
  retrieval_scope: z.enum(['this_only', 'this_plus', 'all']).optional(),
  include_contexts: z.array(z.string()).optional(),
});

// ============================================================
// CLUSTER TENDENCIES
// ============================================================

/**
 * Learned behavior patterns per cluster.
 */
export interface ClusterTendencies {
  decay_rate_modifier: number;
  importance_patterns: string[];
  typical_access_interval: number;
  source: 'learned' | 'default';
  confidence: number;
}

export const ClusterTendenciesSchema = z.object({
  decay_rate_modifier: z.number().min(0.1).max(3.0),
  importance_patterns: z.array(z.string()),
  typical_access_interval: z.number().min(0.1),
  source: z.enum(['learned', 'default']),
  confidence: z.number().min(0).max(1),
});

// ============================================================
// CLUSTER MEMBERSHIP
// ============================================================

/**
 * Soft membership linking a node to a cluster.
 */
export interface ClusterMembership {
  cluster_id: string;
  weight: number;
  pinned: boolean;
  updated_at: Date;
}

export const ClusterMembershipSchema = z.object({
  cluster_id: z.string().min(1),
  weight: z.number().min(0).max(1),
  pinned: z.boolean(),
  updated_at: z.date(),
});

// ============================================================
// CLUSTER
// ============================================================

/**
 * A cluster is a container for organizing related memories.
 */
export interface Cluster {
  id: string;
  name: string;
  description: string;
  icon: string;
  pinned: boolean;
  tendencies: ClusterTendencies;
  preferences: Partial<ContextPreferences>;
  source: ClusterSource;
  created_at: Date;
  node_count: number;
}

export const ClusterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50),
  description: z.string().max(200),
  icon: z.string().min(1).max(4),
  pinned: z.boolean(),
  tendencies: ClusterTendenciesSchema,
  preferences: ContextPreferencesSchema.partial(),
  source: z.enum(CLUSTER_SOURCES),
  created_at: z.date(),
  node_count: z.number().int().min(0),
});

// ============================================================
// CLUSTER HEALTH
// ============================================================

/**
 * Health metrics for a cluster.
 */
export interface ClusterHealth {
  cluster_id: string;
  total_nodes: number;
  active_nodes: number;
  weak_nodes: number;
  dormant_nodes: number;
  health_ratio: number;
  avg_similarity: number;
  calculated_at: Date;
}

export const ClusterHealthSchema = z.object({
  cluster_id: z.string().min(1),
  total_nodes: z.number().int().min(0),
  active_nodes: z.number().int().min(0),
  weak_nodes: z.number().int().min(0),
  dormant_nodes: z.number().int().min(0),
  health_ratio: z.number().min(0).max(1),
  avg_similarity: z.number().min(0).max(1),
  calculated_at: z.date(),
});

// ============================================================
// CLUSTER SUMMARY
// ============================================================

/**
 * Lightweight cluster summary for list views.
 */
export interface ClusterSummary {
  id: string;
  name: string;
  icon: string;
  pinned: boolean;
  node_count: number;
  health_ratio: number;
}

export const ClusterSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50),
  icon: z.string().min(1).max(4),
  pinned: z.boolean(),
  node_count: z.number().int().min(0),
  health_ratio: z.number().min(0).max(1),
});

// ============================================================
// EVOLUTION CONFIG
// ============================================================

export interface EmergeConfig {
  percentage: number;
  min: number;
  max: number;
  similarity: number;
}

export const EmergeConfigSchema = z.object({
  percentage: z.number().min(0.001).max(0.5),
  min: z.number().int().min(1),
  max: z.number().int().min(1),
  similarity: z.number().min(0).max(1),
});

export interface SplitConfig {
  percentage: number;
  min: number;
  max: number;
  similarity: number;
}

export const SplitConfigSchema = z.object({
  percentage: z.number().min(0.01).max(1),
  min: z.number().int().min(1),
  max: z.number().int().min(1),
  similarity: z.number().min(0).max(1),
});

export interface MergeConfig {
  similarity: number;
  overlap: number;
}

export const MergeConfigSchema = z.object({
  similarity: z.number().min(0).max(1),
  overlap: z.number().min(0).max(1),
});

export interface LearningConfig {
  enabled: boolean;
  max_drift: number;
  window_days: number;
  reset_available: boolean;
}

export const LearningConfigSchema = z.object({
  enabled: z.boolean(),
  max_drift: z.number().min(0).max(0.5),
  window_days: z.number().int().min(1),
  reset_available: z.boolean(),
});

export interface EvolutionConfig {
  emerge: EmergeConfig;
  split: SplitConfig;
  merge: MergeConfig;
  learning: LearningConfig;
}

export const EvolutionConfigSchema = z.object({
  emerge: EmergeConfigSchema,
  split: SplitConfigSchema,
  merge: MergeConfigSchema,
  learning: LearningConfigSchema,
});

export const EVOLUTION_CONFIG: EvolutionConfig = {
  emerge: {
    percentage: DEFAULT_EVOLUTION_THRESHOLDS.emerge.percentage,
    min: DEFAULT_EVOLUTION_THRESHOLDS.emerge.min,
    max: DEFAULT_EVOLUTION_THRESHOLDS.emerge.max,
    similarity: DEFAULT_EVOLUTION_THRESHOLDS.emerge.similarity,
  },
  split: {
    percentage: DEFAULT_EVOLUTION_THRESHOLDS.split.percentage,
    min: DEFAULT_EVOLUTION_THRESHOLDS.split.min,
    max: DEFAULT_EVOLUTION_THRESHOLDS.split.max,
    similarity: DEFAULT_EVOLUTION_THRESHOLDS.split.similarity,
  },
  merge: {
    similarity: DEFAULT_EVOLUTION_THRESHOLDS.merge.similarity,
    overlap: DEFAULT_EVOLUTION_THRESHOLDS.merge.overlap,
  },
  learning: {
    enabled: SELF_TUNING_CONFIG.enabled,
    max_drift: SELF_TUNING_CONFIG.max_drift,
    window_days: SELF_TUNING_CONFIG.window_days,
    reset_available: SELF_TUNING_CONFIG.reset_available,
  },
};

// ============================================================
// EVOLUTION LEARNING
// ============================================================

export interface ManualClusterCreate {
  at_graph_size: number;
  cluster_size: number;
  created_at: Date;
}

export const ManualClusterCreateSchema = z.object({
  at_graph_size: z.number().int().min(0),
  cluster_size: z.number().int().min(0),
  created_at: z.date(),
});

export interface ClusterRename {
  old: string;
  new: string;
  reason?: string;
  renamed_at: Date;
}

export const ClusterRenameSchema = z.object({
  old: z.string(),
  new: z.string(),
  reason: z.string().optional(),
  renamed_at: z.date(),
});

export interface EvolutionLearning {
  manual_cluster_creates: ManualClusterCreate[];
  cluster_renames: ClusterRename[];
  split_acceptances: number;
  split_rejections: number;
  merge_acceptances: number;
  merge_rejections: number;
  emerge_adjustment: number;
  split_adjustment: number;
  last_updated: Date;
}

export const EvolutionLearningSchema = z.object({
  manual_cluster_creates: z.array(ManualClusterCreateSchema),
  cluster_renames: z.array(ClusterRenameSchema),
  split_acceptances: z.number().int().min(0),
  split_rejections: z.number().int().min(0),
  merge_acceptances: z.number().int().min(0),
  merge_rejections: z.number().int().min(0),
  emerge_adjustment: z.number().min(-0.20).max(0.20),
  split_adjustment: z.number().min(-0.20).max(0.20),
  last_updated: z.date(),
});

// ============================================================
// EVOLUTION EVENTS
// ============================================================

export interface EmergeEventDetails {
  type: 'EMERGE';
  new_cluster_name: string;
  node_count: number;
  similarity: number;
  candidate_node_ids: string[];
}

export const EmergeEventDetailsSchema = z.object({
  type: z.literal('EMERGE'),
  new_cluster_name: z.string(),
  node_count: z.number().int().min(1),
  similarity: z.number().min(0).max(1),
  candidate_node_ids: z.array(z.string()),
});

export interface SplitEventDetails {
  type: 'SPLIT';
  parent_id: string;
  child_ids: string[];
  reason: string;
  parent_size: number;
  parent_similarity: number;
}

export const SplitEventDetailsSchema = z.object({
  type: z.literal('SPLIT'),
  parent_id: z.string(),
  child_ids: z.array(z.string()),
  reason: z.string(),
  parent_size: z.number().int().min(1),
  parent_similarity: z.number().min(0).max(1),
});

export interface MergeEventDetails {
  type: 'MERGE';
  merged_ids: string[];
  result_id: string;
  similarity: number;
  overlap: number;
}

export const MergeEventDetailsSchema = z.object({
  type: z.literal('MERGE'),
  merged_ids: z.array(z.string()).min(2),
  result_id: z.string(),
  similarity: z.number().min(0).max(1),
  overlap: z.number().min(0).max(1),
});

export interface LearnEventDetails {
  type: 'LEARN';
  field: string;
  old_value: number;
  new_value: number;
  reason: string;
}

export const LearnEventDetailsSchema = z.object({
  type: z.literal('LEARN'),
  field: z.string(),
  old_value: z.number(),
  new_value: z.number(),
  reason: z.string(),
});

export type EvolutionEventDetails =
  | EmergeEventDetails
  | SplitEventDetails
  | MergeEventDetails
  | LearnEventDetails;

export const EvolutionEventDetailsSchema = z.discriminatedUnion('type', [
  EmergeEventDetailsSchema,
  SplitEventDetailsSchema,
  MergeEventDetailsSchema,
  LearnEventDetailsSchema,
]);

export type EvolutionUserAction = 'accepted' | 'rejected' | 'modified' | 'pending';

export interface EvolutionEvent {
  id: string;
  type: EvolutionTrigger;
  cluster_id: string;
  timestamp: Date;
  details: EvolutionEventDetails;
  user_action?: EvolutionUserAction;
  graph_size_at_event: number;
}

export const EvolutionEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(EVOLUTION_TRIGGERS),
  cluster_id: z.string(),
  timestamp: z.date(),
  details: EvolutionEventDetailsSchema,
  user_action: z.enum(['accepted', 'rejected', 'modified', 'pending']).optional(),
  graph_size_at_event: z.number().int().min(0),
});

// ============================================================
// TEMPLATES
// ============================================================

export interface DefaultTendencies {
  decay_rate_modifier: number;
  importance_patterns: string[];
}

export const DefaultTendenciesSchema = z.object({
  decay_rate_modifier: z.number().min(0.1).max(3.0),
  importance_patterns: z.array(z.string()),
});

export interface ClusterTemplate {
  name: string;
  description: string;
  icon: string;
  pinned: boolean;
  default_tendencies: DefaultTendencies;
  preferences: Partial<ContextPreferences>;
}

export const ClusterTemplateSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200),
  icon: z.string().min(1).max(4),
  pinned: z.boolean(),
  default_tendencies: DefaultTendenciesSchema,
  preferences: ContextPreferencesSchema.partial(),
});

export interface UnifiedTemplate {
  user_type: UserType;
  global_preferences: Partial<ContextPreferences>;
  clusters: ClusterTemplate[];
}

export const UnifiedTemplateSchema = z.object({
  user_type: z.enum(USER_TYPES),
  global_preferences: ContextPreferencesSchema.partial(),
  clusters: z.array(ClusterTemplateSchema),
});

// ============================================================
// ONBOARDING
// ============================================================

export interface OnboardingProgress {
  state: OnboardingState;
  user_type?: UserType;
  template_accepted?: boolean;
  template_customized?: boolean;
  clusters_created: string[];
  first_memory_id?: string;
  started_at: Date;
  completed_at?: Date;
}

export const OnboardingProgressSchema = z.object({
  state: z.enum(ONBOARDING_STATES),
  user_type: z.enum(USER_TYPES).optional(),
  template_accepted: z.boolean().optional(),
  template_customized: z.boolean().optional(),
  clusters_created: z.array(z.string()),
  first_memory_id: z.string().optional(),
  started_at: z.date(),
  completed_at: z.date().optional(),
});

export type OnboardingAction =
  | { type: 'start_onboarding' }
  | { type: 'skip_to_chat' }
  | { type: 'select_user_type'; userType: UserType }
  | { type: 'accept_template'; clusterIds: string[] }
  | { type: 'customize_template'; customizations: ClusterTemplate[]; clusterIds: string[] }
  | { type: 'first_memory_created'; memoryId: string }
  | { type: 'continue_after_first_memory' };

export const OnboardingActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start_onboarding') }),
  z.object({ type: z.literal('skip_to_chat') }),
  z.object({ type: z.literal('select_user_type'), userType: z.enum(USER_TYPES) }),
  z.object({ type: z.literal('accept_template'), clusterIds: z.array(z.string()) }),
  z.object({
    type: z.literal('customize_template'),
    customizations: z.array(ClusterTemplateSchema),
    clusterIds: z.array(z.string()),
  }),
  z.object({ type: z.literal('first_memory_created'), memoryId: z.string() }),
  z.object({ type: z.literal('continue_after_first_memory') }),
]);

export interface TransitionResult {
  success: boolean;
  progress?: OnboardingProgress;
  error?: string;
}

// ============================================================
// ROUTING
// ============================================================

export interface QueryClusterAffinity {
  cluster_id: string;
  affinity: number;
}

export const QueryClusterAffinitySchema = z.object({
  cluster_id: z.string().min(1),
  affinity: z.number().min(0).max(1),
});

export type SearchStrategy = 'primary_only' | 'top_clusters' | 'all_clusters';

export interface ClusterRoutingResult {
  query: string;
  affinities: QueryClusterAffinity[];
  primary_cluster: string | null;
  search_strategy: SearchStrategy;
  clusters_to_search: string[];
}

export const ClusterRoutingResultSchema = z.object({
  query: z.string(),
  affinities: z.array(QueryClusterAffinitySchema),
  primary_cluster: z.string().nullable(),
  search_strategy: z.enum(['primary_only', 'top_clusters', 'all_clusters']),
  clusters_to_search: z.array(z.string()),
});

export interface ClusterWithCentroid {
  cluster: Cluster;
  centroid: number[];
}

export const ClusterWithCentroidSchema = z.object({
  cluster: ClusterSchema,
  centroid: z.array(z.number()),
});

// ============================================================
// FUNCTION INPUT TYPES
// ============================================================

export interface NodeStateForHealth {
  node_id: string;
  retrievability: number;
}

export interface ApplyTemplateResult {
  cluster_ids: string[];
  clusters: Cluster[];
}

// ============================================================
// TYPE GUARDS
// ============================================================

export function isClusterTendencies(value: unknown): value is ClusterTendencies {
  return ClusterTendenciesSchema.safeParse(value).success;
}

export function isClusterMembership(value: unknown): value is ClusterMembership {
  return ClusterMembershipSchema.safeParse(value).success;
}

export function isCluster(value: unknown): value is Cluster {
  return ClusterSchema.safeParse(value).success;
}

export function isClusterHealth(value: unknown): value is ClusterHealth {
  return ClusterHealthSchema.safeParse(value).success;
}

export function isClusterSummary(value: unknown): value is ClusterSummary {
  return ClusterSummarySchema.safeParse(value).success;
}

export function isEvolutionConfig(value: unknown): value is EvolutionConfig {
  return EvolutionConfigSchema.safeParse(value).success;
}

export function isEvolutionLearning(value: unknown): value is EvolutionLearning {
  return EvolutionLearningSchema.safeParse(value).success;
}

export function isEvolutionEvent(value: unknown): value is EvolutionEvent {
  return EvolutionEventSchema.safeParse(value).success;
}

export function isClusterTemplate(value: unknown): value is ClusterTemplate {
  return ClusterTemplateSchema.safeParse(value).success;
}

export function isUnifiedTemplate(value: unknown): value is UnifiedTemplate {
  return UnifiedTemplateSchema.safeParse(value).success;
}

export function isOnboardingProgress(value: unknown): value is OnboardingProgress {
  return OnboardingProgressSchema.safeParse(value).success;
}

export function isOnboardingAction(value: unknown): value is OnboardingAction {
  return OnboardingActionSchema.safeParse(value).success;
}

export function isQueryClusterAffinity(value: unknown): value is QueryClusterAffinity {
  return QueryClusterAffinitySchema.safeParse(value).success;
}

export function isClusterRoutingResult(value: unknown): value is ClusterRoutingResult {
  return ClusterRoutingResultSchema.safeParse(value).success;
}

export function isClusterWithCentroid(value: unknown): value is ClusterWithCentroid {
  return ClusterWithCentroidSchema.safeParse(value).success;
}
