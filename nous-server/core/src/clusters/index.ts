/**
 * @module @nous/core/clusters
 * @description Memory Organization System (storm-006)
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-006
 * @storm Brainstorms/Infrastructure/storm-006-memory-organization
 *
 * Seeded Emergence with Hybrid Evolution - percentages for scaling,
 * min/max bounds for predictability, and self-tuning from behavior.
 */

// Re-export constants
export {
  USER_TYPES,
  type UserType,
  isUserType,
  EVOLUTION_TRIGGERS,
  type EvolutionTrigger,
  isEvolutionTrigger,
  CLUSTER_SOURCES,
  type ClusterSource,
  isClusterSource,
  ONBOARDING_STATES,
  type OnboardingState,
  isOnboardingState,
  type EvolutionThresholdsType,
  DEFAULT_EVOLUTION_THRESHOLDS,
  type ColdStartConfigType,
  COLD_START_CONFIG,
  type SelfTuningConfigType,
  SELF_TUNING_CONFIG,
  type ClusterHealthThresholdsType,
  CLUSTER_HEALTH_THRESHOLDS,
  type RoutingConfigType,
  ROUTING_CONFIG,
  type TendencyDefaultsType,
  TENDENCY_DEFAULTS,
} from './constants';

// Re-export types
export {
  type ContextPreferences,
  ContextPreferencesSchema,
  type ClusterTendencies,
  ClusterTendenciesSchema,
  isClusterTendencies,
  type ClusterMembership,
  ClusterMembershipSchema,
  isClusterMembership,
  type Cluster,
  ClusterSchema,
  isCluster,
  type ClusterHealth,
  ClusterHealthSchema,
  isClusterHealth,
  type ClusterSummary,
  ClusterSummarySchema,
  isClusterSummary,
  type EmergeConfig,
  EmergeConfigSchema,
  type SplitConfig,
  SplitConfigSchema,
  type MergeConfig,
  MergeConfigSchema,
  type LearningConfig,
  LearningConfigSchema,
  type EvolutionConfig,
  EvolutionConfigSchema,
  EVOLUTION_CONFIG,
  isEvolutionConfig,
  type ManualClusterCreate,
  ManualClusterCreateSchema,
  type ClusterRename,
  ClusterRenameSchema,
  type EvolutionLearning,
  EvolutionLearningSchema,
  isEvolutionLearning,
  type EmergeEventDetails,
  EmergeEventDetailsSchema,
  type SplitEventDetails,
  SplitEventDetailsSchema,
  type MergeEventDetails,
  MergeEventDetailsSchema,
  type LearnEventDetails,
  LearnEventDetailsSchema,
  type EvolutionEventDetails,
  EvolutionEventDetailsSchema,
  type EvolutionUserAction,
  type EvolutionEvent,
  EvolutionEventSchema,
  isEvolutionEvent,
  type DefaultTendencies,
  DefaultTendenciesSchema,
  type ClusterTemplate,
  ClusterTemplateSchema,
  isClusterTemplate,
  type UnifiedTemplate,
  UnifiedTemplateSchema,
  isUnifiedTemplate,
  type OnboardingProgress,
  OnboardingProgressSchema,
  isOnboardingProgress,
  type OnboardingAction,
  OnboardingActionSchema,
  isOnboardingAction,
  type TransitionResult,
  type QueryClusterAffinity,
  QueryClusterAffinitySchema,
  isQueryClusterAffinity,
  type SearchStrategy,
  type ClusterRoutingResult,
  ClusterRoutingResultSchema,
  isClusterRoutingResult,
  type ClusterWithCentroid,
  ClusterWithCentroidSchema,
  isClusterWithCentroid,
  type NodeStateForHealth,
  type ApplyTemplateResult,
} from './types';

import {
  UserType,
  OnboardingState,
  ClusterSource,
  COLD_START_CONFIG,
  CLUSTER_HEALTH_THRESHOLDS,
  SELF_TUNING_CONFIG,
  TENDENCY_DEFAULTS,
  ROUTING_CONFIG,
} from './constants';

import {
  ContextPreferences,
  Cluster,
  ClusterTendencies,
  ClusterHealth,
  EvolutionConfig,
  EvolutionLearning,
  EvolutionEvent,
  ClusterTemplate,
  UnifiedTemplate,
  OnboardingProgress,
  OnboardingAction,
  TransitionResult,
  QueryClusterAffinity,
  ClusterRoutingResult,
  ClusterWithCentroid,
  NodeStateForHealth,
  ApplyTemplateResult,
  EVOLUTION_CONFIG,
} from './types';

// ============================================================
// UNIFIED TEMPLATES
// ============================================================

const STUDENT_TEMPLATE: UnifiedTemplate = {
  user_type: 'student',
  global_preferences: {
    tone: 'neutral',
    verbosity: 'detailed',
    use_citations: true,
  },
  clusters: [
    {
      name: 'Academics',
      description: 'Classes, lectures, homework, exams',
      icon: '📚',
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 0.7,
        importance_patterns: ['exam', 'deadline', 'assignment', 'lecture', 'quiz', 'homework'],
      },
      preferences: {
        tone: 'neutral',
        verbosity: 'detailed',
        default_format: 'structured',
        use_citations: true,
        retrieval_scope: 'this_only',
      },
    },
    {
      name: 'Social',
      description: 'Friends, events, conversations',
      icon: '👥',
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 1.2,
        importance_patterns: ['birthday', 'event', 'plan', 'party', 'meeting', 'hangout'],
      },
      preferences: {
        tone: 'casual',
        verbosity: 'concise',
        default_format: 'prose',
        use_citations: false,
        retrieval_scope: 'all',
      },
    },
    {
      name: 'Creative',
      description: 'Projects, hobbies, ideas',
      icon: '💡',
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 1.0,
        importance_patterns: ['idea', 'project', 'create', 'make', 'design', 'build'],
      },
      preferences: {
        tone: 'casual',
        verbosity: 'adaptive',
        default_format: 'bullets',
        use_citations: false,
        retrieval_scope: 'this_plus',
        include_contexts: ['Academics'],
      },
    },
  ],
};

const PROFESSIONAL_TEMPLATE: UnifiedTemplate = {
  user_type: 'professional',
  global_preferences: {
    tone: 'formal',
    verbosity: 'concise',
    use_citations: true,
  },
  clusters: [
    {
      name: 'Work',
      description: 'Projects, meetings, deadlines',
      icon: '💼',
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 0.8,
        importance_patterns: ['deadline', 'meeting', 'decision', 'action item', 'client', 'project'],
      },
      preferences: {
        tone: 'formal',
        verbosity: 'concise',
        default_format: 'bullets',
        use_citations: true,
        retrieval_scope: 'this_only',
      },
    },
    {
      name: 'Personal',
      description: 'Life outside work',
      icon: '🏠',
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 1.1,
        importance_patterns: ['family', 'health', 'goal', 'appointment', 'vacation'],
      },
      preferences: {
        tone: 'casual',
        verbosity: 'adaptive',
        default_format: 'prose',
        use_citations: false,
        retrieval_scope: 'this_only',
      },
    },
    {
      name: 'Learning',
      description: 'Skills, courses, growth',
      icon: '📈',
      pinned: false,
      default_tendencies: {
        decay_rate_modifier: 0.7,
        importance_patterns: ['learn', 'course', 'skill', 'certification', 'training', 'tutorial'],
      },
      preferences: {
        tone: 'neutral',
        verbosity: 'detailed',
        default_format: 'structured',
        use_citations: true,
        retrieval_scope: 'this_plus',
        include_contexts: ['Work'],
      },
    },
  ],
};

const CREATIVE_TEMPLATE: UnifiedTemplate = {
  user_type: 'creative',
  global_preferences: {
    tone: 'casual',
    verbosity: 'adaptive',
    use_citations: false,
  },
  clusters: [
    {
      name: 'Projects',
      description: 'Current creative work',
      icon: '🎨',
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 0.8,
        importance_patterns: ['project', 'deadline', 'client', 'deliverable', 'milestone', 'draft'],
      },
      preferences: {
        tone: 'casual',
        verbosity: 'adaptive',
        default_format: 'bullets',
        use_citations: false,
        retrieval_scope: 'this_only',
      },
    },
    {
      name: 'Inspiration',
      description: 'References, ideas, mood boards',
      icon: '✨',
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 1.0,
        importance_patterns: ['inspiration', 'reference', 'idea', 'style', 'aesthetic', 'mood'],
      },
      preferences: {
        tone: 'casual',
        verbosity: 'detailed',
        default_format: 'prose',
        use_citations: false,
        retrieval_scope: 'all',
      },
    },
    {
      name: 'Craft',
      description: 'Techniques, tools, skills',
      icon: '🛠️',
      pinned: false,
      default_tendencies: {
        decay_rate_modifier: 0.6,
        importance_patterns: ['technique', 'tool', 'tutorial', 'how to', 'process', 'method'],
      },
      preferences: {
        tone: 'neutral',
        verbosity: 'detailed',
        default_format: 'structured',
        use_citations: true,
        retrieval_scope: 'this_only',
      },
    },
  ],
};

const RESEARCHER_TEMPLATE: UnifiedTemplate = {
  user_type: 'researcher',
  global_preferences: {
    tone: 'formal',
    verbosity: 'detailed',
    use_citations: true,
  },
  clusters: [
    {
      name: 'Research',
      description: 'Current research projects',
      icon: '🔬',
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 0.5,
        importance_patterns: ['hypothesis', 'finding', 'experiment', 'data', 'result', 'analysis'],
      },
      preferences: {
        tone: 'formal',
        verbosity: 'detailed',
        default_format: 'structured',
        use_citations: true,
        retrieval_scope: 'this_plus',
        include_contexts: ['Literature'],
      },
    },
    {
      name: 'Literature',
      description: 'Papers, books, references',
      icon: '📖',
      pinned: true,
      default_tendencies: {
        decay_rate_modifier: 0.4,
        importance_patterns: ['paper', 'author', 'citation', 'finding', 'journal', 'publication'],
      },
      preferences: {
        tone: 'formal',
        verbosity: 'detailed',
        default_format: 'structured',
        use_citations: true,
        retrieval_scope: 'this_only',
      },
    },
    {
      name: 'Methodology',
      description: 'Methods, protocols, techniques',
      icon: '📋',
      pinned: false,
      default_tendencies: {
        decay_rate_modifier: 0.5,
        importance_patterns: ['method', 'protocol', 'procedure', 'technique', 'approach', 'framework'],
      },
      preferences: {
        tone: 'formal',
        verbosity: 'detailed',
        default_format: 'structured',
        use_citations: true,
        retrieval_scope: 'this_only',
      },
    },
  ],
};

const OTHER_TEMPLATE: UnifiedTemplate = {
  user_type: 'other',
  global_preferences: {
    tone: 'neutral',
    verbosity: 'adaptive',
    use_citations: false,
  },
  clusters: [],
};

/**
 * All unified templates keyed by user type.
 */
export const UNIFIED_TEMPLATES: Record<UserType, UnifiedTemplate> = {
  student: STUDENT_TEMPLATE,
  professional: PROFESSIONAL_TEMPLATE,
  creative: CREATIVE_TEMPLATE,
  researcher: RESEARCHER_TEMPLATE,
  other: OTHER_TEMPLATE,
};

/**
 * Get a unified template by user type.
 */
export function getUnifiedTemplate(userType: UserType): UnifiedTemplate {
  return UNIFIED_TEMPLATES[userType];
}

/**
 * Get all cluster templates for a user type.
 */
export function getClusterTemplates(userType: UserType): ClusterTemplate[] {
  return UNIFIED_TEMPLATES[userType].clusters;
}

/**
 * Get global preferences for a user type.
 */
export function getGlobalPreferences(userType: UserType): Partial<ContextPreferences> {
  return UNIFIED_TEMPLATES[userType].global_preferences;
}

// ============================================================
// EVOLUTION LEARNING
// ============================================================

/**
 * Creates a new EvolutionLearning with default values.
 */
export function createEvolutionLearning(): EvolutionLearning {
  return {
    manual_cluster_creates: [],
    cluster_renames: [],
    split_acceptances: 0,
    split_rejections: 0,
    merge_acceptances: 0,
    merge_rejections: 0,
    emerge_adjustment: 0,
    split_adjustment: 0,
    last_updated: new Date(),
  };
}

// ============================================================
// ONBOARDING
// ============================================================

/**
 * Valid transitions for each onboarding state.
 */
export const VALID_TRANSITIONS: Record<OnboardingState, OnboardingAction['type'][]> = {
  not_started: ['start_onboarding'],
  welcome: ['skip_to_chat', 'select_user_type'],
  user_type_selection: ['skip_to_chat', 'select_user_type'],
  template_preview: ['accept_template', 'customize_template', 'skip_to_chat'],
  first_chat: ['first_memory_created'],
  first_memory_saved: ['continue_after_first_memory'],
  completed: [],
};

/**
 * Creates a new OnboardingProgress with default values.
 */
export function createOnboardingProgress(): OnboardingProgress {
  return {
    state: 'not_started',
    clusters_created: [],
    started_at: new Date(),
  };
}

/**
 * Transition the onboarding state machine.
 */
export function transitionOnboarding(
  progress: OnboardingProgress,
  action: OnboardingAction
): TransitionResult {
  const validActions = VALID_TRANSITIONS[progress.state];

  if (!validActions.includes(action.type)) {
    return {
      success: false,
      error: `Invalid transition: cannot perform '${action.type}' from state '${progress.state}'`,
    };
  }

  switch (action.type) {
    case 'start_onboarding':
      return { success: true, progress: { ...progress, state: 'welcome' } };

    case 'skip_to_chat':
      return {
        success: true,
        progress: { ...progress, state: 'first_chat', user_type: 'other', template_accepted: false },
      };

    case 'select_user_type':
      return {
        success: true,
        progress: { ...progress, state: 'template_preview', user_type: action.userType },
      };

    case 'accept_template':
      return {
        success: true,
        progress: {
          ...progress,
          state: 'first_chat',
          template_accepted: true,
          template_customized: false,
          clusters_created: action.clusterIds,
        },
      };

    case 'customize_template':
      return {
        success: true,
        progress: {
          ...progress,
          state: 'first_chat',
          template_accepted: true,
          template_customized: true,
          clusters_created: action.clusterIds,
        },
      };

    case 'first_memory_created':
      return {
        success: true,
        progress: { ...progress, state: 'first_memory_saved', first_memory_id: action.memoryId },
      };

    case 'continue_after_first_memory':
      return {
        success: true,
        progress: { ...progress, state: 'completed', completed_at: new Date() },
      };

    default:
      return { success: false, error: 'Unknown action type' };
  }
}

/**
 * Check if onboarding is complete.
 */
export function isOnboardingComplete(progress: OnboardingProgress): boolean {
  return progress.state === 'completed';
}

/**
 * Check if onboarding has started.
 */
export function hasOnboardingStarted(progress: OnboardingProgress): boolean {
  return progress.state !== 'not_started';
}

/**
 * Get the current step number (1-5) or 0 if not started, 6 if complete.
 */
export function getOnboardingStepNumber(state: OnboardingState): number {
  const steps: Record<OnboardingState, number> = {
    not_started: 0,
    welcome: 1,
    user_type_selection: 2,
    template_preview: 3,
    first_chat: 4,
    first_memory_saved: 5,
    completed: 6,
  };
  return steps[state];
}

/**
 * Get next valid actions for current state.
 */
export function getValidActions(state: OnboardingState): OnboardingAction['type'][] {
  return VALID_TRANSITIONS[state];
}

/**
 * Check if a specific action is valid from current state.
 */
export function isActionValid(state: OnboardingState, actionType: OnboardingAction['type']): boolean {
  return VALID_TRANSITIONS[state].includes(actionType);
}

// ============================================================
// THRESHOLD CALCULATIONS
// ============================================================

/**
 * Calculate the emergence threshold for creating new clusters.
 */
export function calculateEmergeThreshold(
  graphSize: number,
  config: EvolutionConfig = EVOLUTION_CONFIG,
  learning?: EvolutionLearning
): number {
  if (graphSize < COLD_START_CONFIG.threshold_nodes) {
    return COLD_START_CONFIG.emerge_fixed;
  }

  const calculated = Math.floor(graphSize * config.emerge.percentage);
  let threshold = Math.max(config.emerge.min, Math.min(config.emerge.max, calculated));

  if (learning && config.learning.enabled) {
    threshold = threshold * (1 + learning.emerge_adjustment);
  }

  return Math.round(threshold);
}

/**
 * Calculate the split threshold for dividing large clusters.
 */
export function calculateSplitThreshold(
  graphSize: number,
  config: EvolutionConfig = EVOLUTION_CONFIG,
  learning?: EvolutionLearning
): number {
  if (graphSize < COLD_START_CONFIG.threshold_nodes) {
    return COLD_START_CONFIG.split_fixed;
  }

  const calculated = Math.floor(graphSize * config.split.percentage);
  let threshold = Math.max(config.split.min, Math.min(config.split.max, calculated));

  if (learning && config.learning.enabled) {
    threshold = threshold * (1 + learning.split_adjustment);
  }

  return Math.round(threshold);
}

// ============================================================
// EVOLUTION SUGGESTIONS
// ============================================================

/**
 * Check if emergence conditions are met.
 */
export function shouldSuggestEmerge(
  candidateNodeCount: number,
  similarity: number,
  graphSize: number,
  config: EvolutionConfig = EVOLUTION_CONFIG,
  learning?: EvolutionLearning
): boolean {
  if (similarity < config.emerge.similarity) {
    return false;
  }
  const threshold = calculateEmergeThreshold(graphSize, config, learning);
  return candidateNodeCount >= threshold;
}

/**
 * Check if split conditions are met.
 */
export function shouldSuggestSplit(
  clusterSize: number,
  similarity: number,
  graphSize: number,
  config: EvolutionConfig = EVOLUTION_CONFIG,
  learning?: EvolutionLearning
): boolean {
  if (similarity >= config.split.similarity) {
    return false;
  }
  const threshold = calculateSplitThreshold(graphSize, config, learning);
  return clusterSize >= threshold;
}

/**
 * Check if merge conditions are met.
 */
export function shouldSuggestMerge(
  interClusterSimilarity: number,
  overlapPercentage: number,
  config: EvolutionConfig = EVOLUTION_CONFIG
): boolean {
  return (
    interClusterSimilarity >= config.merge.similarity &&
    overlapPercentage >= config.merge.overlap
  );
}

// ============================================================
// CLUSTER HEALTH
// ============================================================

/**
 * Calculate health metrics for a cluster.
 */
export function calculateClusterHealth(
  cluster: Cluster,
  nodeStates: NodeStateForHealth[],
  avgSimilarity: number = 0
): ClusterHealth {
  const total_nodes = nodeStates.length;
  let active_nodes = 0;
  let weak_nodes = 0;
  let dormant_nodes = 0;

  for (const node of nodeStates) {
    if (node.retrievability > CLUSTER_HEALTH_THRESHOLDS.active_threshold) {
      active_nodes++;
    } else if (node.retrievability > CLUSTER_HEALTH_THRESHOLDS.weak_threshold) {
      weak_nodes++;
    } else {
      dormant_nodes++;
    }
  }

  const health_ratio = total_nodes > 0 ? active_nodes / total_nodes : 0;

  return {
    cluster_id: cluster.id,
    total_nodes,
    active_nodes,
    weak_nodes,
    dormant_nodes,
    health_ratio,
    avg_similarity: avgSimilarity,
    calculated_at: new Date(),
  };
}

/**
 * Check if a cluster is considered unhealthy.
 */
export function isClusterUnhealthy(health: ClusterHealth): boolean {
  return health.health_ratio < CLUSTER_HEALTH_THRESHOLDS.unhealthy_ratio;
}

// ============================================================
// SELF-TUNING / LEARNING
// ============================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Update learning data based on an evolution event.
 */
export function updateLearning(
  learning: EvolutionLearning,
  event: EvolutionEvent
): EvolutionLearning {
  const maxDrift = SELF_TUNING_CONFIG.max_drift;
  const updated = { ...learning, last_updated: new Date() };

  switch (event.type) {
    case 'EMERGE':
      if (event.user_action === 'rejected') {
        updated.emerge_adjustment = clamp(updated.emerge_adjustment + 0.05, -maxDrift, maxDrift);
      }
      break;

    case 'SPLIT':
      if (event.user_action === 'accepted') {
        updated.split_acceptances++;
      } else if (event.user_action === 'rejected') {
        updated.split_rejections++;
        if (updated.split_rejections > updated.split_acceptances) {
          updated.split_adjustment = clamp(updated.split_adjustment + 0.05, -maxDrift, maxDrift);
        }
      }
      break;

    case 'MERGE':
      if (event.user_action === 'accepted') {
        updated.merge_acceptances++;
      } else if (event.user_action === 'rejected') {
        updated.merge_rejections++;
      }
      break;

    case 'LEARN':
      break;
  }

  return updated;
}

/**
 * Record a manual cluster creation for learning.
 */
export function recordManualClusterCreate(
  learning: EvolutionLearning,
  graphSize: number,
  clusterSize: number
): EvolutionLearning {
  const maxDrift = SELF_TUNING_CONFIG.max_drift;
  const updated = {
    ...learning,
    manual_cluster_creates: [
      ...learning.manual_cluster_creates,
      { at_graph_size: graphSize, cluster_size: clusterSize, created_at: new Date() },
    ],
    last_updated: new Date(),
  };

  const avgManualSize = mean(updated.manual_cluster_creates.map(c => c.cluster_size));
  const defaultSize = 20;
  const deviation = (avgManualSize - defaultSize) / 100;
  updated.emerge_adjustment = clamp(deviation, -maxDrift, maxDrift);

  return updated;
}

/**
 * Reset learning data to defaults.
 */
export function resetLearning(): EvolutionLearning {
  return createEvolutionLearning();
}

// ============================================================
// TEMPLATE APPLICATION
// ============================================================

/**
 * Generate a unique cluster ID.
 */
export function generateClusterId(): string {
  return `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create default tendencies from a cluster template.
 */
export function createTendenciesFromTemplate(template: ClusterTemplate): ClusterTendencies {
  return {
    decay_rate_modifier: template.default_tendencies.decay_rate_modifier,
    importance_patterns: [...template.default_tendencies.importance_patterns],
    typical_access_interval: TENDENCY_DEFAULTS.decay_rate_modifier,
    source: 'default',
    confidence: TENDENCY_DEFAULTS.initial_confidence,
  };
}

/**
 * Create a cluster from a template.
 */
export function createClusterFromTemplate(
  template: ClusterTemplate,
  source: ClusterSource = 'template'
): Cluster {
  return {
    id: generateClusterId(),
    name: template.name,
    description: template.description,
    icon: template.icon,
    pinned: template.pinned,
    tendencies: createTendenciesFromTemplate(template),
    preferences: { ...template.preferences },
    source,
    created_at: new Date(),
    node_count: 0,
  };
}

/**
 * Apply a unified template to create clusters.
 */
export function applyUnifiedTemplate(template: UnifiedTemplate): ApplyTemplateResult {
  const clusters: Cluster[] = [];

  for (const clusterTemplate of template.clusters) {
    const cluster = createClusterFromTemplate(clusterTemplate, 'template');
    clusters.push(cluster);
  }

  return {
    cluster_ids: clusters.map(c => c.id),
    clusters,
  };
}

// ============================================================
// COLD-START HELPERS
// ============================================================

/**
 * Check if the graph is in cold-start mode.
 */
export function isInColdStartMode(graphSize: number): boolean {
  return graphSize < COLD_START_CONFIG.threshold_nodes;
}

/**
 * Get the current evolution mode.
 */
export function getEvolutionMode(graphSize: number): 'cold_start' | 'adaptive' {
  return isInColdStartMode(graphSize) ? 'cold_start' : 'adaptive';
}

// ============================================================
// ROUTING
// ============================================================

/**
 * Calculate cosine similarity between two number arrays.
 * Note: For Float32Array embeddings, use cosineSimilarity from @nous/core/embeddings.
 */
export function clusterCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  if (a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Calculate affinity between a query embedding and a cluster centroid.
 */
export function calculateAffinity(queryEmbedding: number[], clusterCentroid: number[]): number {
  const similarity = clusterCosineSimilarity(queryEmbedding, clusterCentroid);
  return Math.max(0, similarity);
}

/**
 * Route a query to clusters based on embedding similarity.
 */
export function routeQueryToClusters(
  query: string,
  queryEmbedding: number[],
  clustersWithCentroids: ClusterWithCentroid[]
): ClusterRoutingResult {
  if (clustersWithCentroids.length === 0) {
    return {
      query,
      affinities: [],
      primary_cluster: null,
      search_strategy: 'all_clusters',
      clusters_to_search: [],
    };
  }

  const affinities: QueryClusterAffinity[] = clustersWithCentroids
    .map(({ cluster, centroid }) => ({
      cluster_id: cluster.id,
      affinity: calculateAffinity(queryEmbedding, centroid),
    }))
    .filter(a => a.affinity >= ROUTING_CONFIG.min_affinity)
    .sort((a, b) => b.affinity - a.affinity);

  if (affinities.length === 0) {
    return {
      query,
      affinities: [],
      primary_cluster: null,
      search_strategy: 'all_clusters',
      clusters_to_search: clustersWithCentroids.map(c => c.cluster.id),
    };
  }

  const primaryAffinity = affinities[0]!;
  const primary_cluster = primaryAffinity.cluster_id;

  let search_strategy: 'primary_only' | 'top_clusters' | 'all_clusters';
  let clusters_to_search: string[];

  if (affinities.length === 1) {
    search_strategy = 'primary_only';
    clusters_to_search = [primary_cluster];
  } else if (primaryAffinity.affinity - affinities[1]!.affinity <= ROUTING_CONFIG.search_all_gap) {
    search_strategy = 'all_clusters';
    clusters_to_search = clustersWithCentroids.map(c => c.cluster.id);
  } else if (affinities.length <= ROUTING_CONFIG.max_clusters) {
    search_strategy = 'top_clusters';
    clusters_to_search = affinities.map(a => a.cluster_id);
  } else {
    search_strategy = 'top_clusters';
    clusters_to_search = affinities.slice(0, ROUTING_CONFIG.max_clusters).map(a => a.cluster_id);
  }

  return {
    query,
    affinities,
    primary_cluster,
    search_strategy,
    clusters_to_search,
  };
}

/**
 * Simple routing that returns only the primary cluster.
 */
export function routeToPrimaryCluster(
  queryEmbedding: number[],
  clustersWithCentroids: ClusterWithCentroid[]
): string | null {
  if (clustersWithCentroids.length === 0) {
    return null;
  }

  let maxAffinity = -1;
  let primaryCluster: string | null = null;

  for (const { cluster, centroid } of clustersWithCentroids) {
    const affinity = calculateAffinity(queryEmbedding, centroid);
    if (affinity > maxAffinity) {
      maxAffinity = affinity;
      primaryCluster = cluster.id;
    }
  }

  return primaryCluster;
}
