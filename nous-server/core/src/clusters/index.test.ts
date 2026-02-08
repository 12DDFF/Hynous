/**
 * @module @nous/core/clusters
 * @description Tests for the Memory Organization System (storm-006)
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Constants
  USER_TYPES,
  EVOLUTION_TRIGGERS,
  CLUSTER_SOURCES,
  ONBOARDING_STATES,
  DEFAULT_EVOLUTION_THRESHOLDS,
  COLD_START_CONFIG,
  SELF_TUNING_CONFIG,
  CLUSTER_HEALTH_THRESHOLDS,
  ROUTING_CONFIG,
  TENDENCY_DEFAULTS,

  // Type guards
  isUserType,
  isEvolutionTrigger,
  isClusterSource,
  isOnboardingState,

  // Types and schemas
  EVOLUTION_CONFIG,
  UNIFIED_TEMPLATES,
  ClusterSchema,
  ClusterTendenciesSchema,
  ClusterMembershipSchema,
  ClusterHealthSchema,
  EvolutionConfigSchema,
  EvolutionLearningSchema,
  EvolutionEventSchema,
  ClusterTemplateSchema,
  UnifiedTemplateSchema,
  OnboardingProgressSchema,
  OnboardingActionSchema,
  QueryClusterAffinitySchema,
  ClusterRoutingResultSchema,
  isCluster,
  isClusterTendencies,
  isClusterMembership,
  isClusterHealth,
  isEvolutionConfig,
  isEvolutionLearning,
  isEvolutionEvent,
  isClusterTemplate,
  isUnifiedTemplate,
  isOnboardingProgress,
  isOnboardingAction,
  isQueryClusterAffinity,
  isClusterRoutingResult,

  // Template functions
  getUnifiedTemplate,
  getClusterTemplates,
  getGlobalPreferences,

  // Onboarding functions
  createOnboardingProgress,
  transitionOnboarding,
  isOnboardingComplete,
  hasOnboardingStarted,
  getOnboardingStepNumber,
  getValidActions,
  isActionValid,
  VALID_TRANSITIONS,

  // Threshold calculations
  calculateEmergeThreshold,
  calculateSplitThreshold,

  // Evolution suggestions
  shouldSuggestEmerge,
  shouldSuggestSplit,
  shouldSuggestMerge,

  // Cluster health
  calculateClusterHealth,
  isClusterUnhealthy,

  // Learning
  createEvolutionLearning,
  updateLearning,
  recordManualClusterCreate,
  resetLearning,

  // Template application
  generateClusterId,
  createTendenciesFromTemplate,
  createClusterFromTemplate,
  applyUnifiedTemplate,

  // Cold-start helpers
  isInColdStartMode,
  getEvolutionMode,

  // Routing
  clusterCosineSimilarity,
  calculateAffinity,
  routeQueryToClusters,
  routeToPrimaryCluster,

  // Types
  type Cluster,
  type ClusterTendencies,
  type ClusterHealth,
  type EvolutionLearning,
  type EvolutionEvent,
  type OnboardingProgress,
  type OnboardingAction,
  type ClusterWithCentroid,
  type NodeStateForHealth,
} from './index';

// ============================================================
// CONSTANTS TESTS
// ============================================================

describe('Constants', () => {
  describe('USER_TYPES', () => {
    it('should have 5 user types', () => {
      expect(USER_TYPES).toHaveLength(5);
    });

    it('should include all expected types', () => {
      expect(USER_TYPES).toContain('student');
      expect(USER_TYPES).toContain('professional');
      expect(USER_TYPES).toContain('creative');
      expect(USER_TYPES).toContain('researcher');
      expect(USER_TYPES).toContain('other');
    });
  });

  describe('EVOLUTION_TRIGGERS', () => {
    it('should have 4 triggers', () => {
      expect(EVOLUTION_TRIGGERS).toHaveLength(4);
    });

    it('should include all expected triggers', () => {
      expect(EVOLUTION_TRIGGERS).toContain('EMERGE');
      expect(EVOLUTION_TRIGGERS).toContain('SPLIT');
      expect(EVOLUTION_TRIGGERS).toContain('MERGE');
      expect(EVOLUTION_TRIGGERS).toContain('LEARN');
    });
  });

  describe('CLUSTER_SOURCES', () => {
    it('should have 4 sources', () => {
      expect(CLUSTER_SOURCES).toHaveLength(4);
    });

    it('should include all expected sources', () => {
      expect(CLUSTER_SOURCES).toContain('template');
      expect(CLUSTER_SOURCES).toContain('emerged');
      expect(CLUSTER_SOURCES).toContain('user_created');
      expect(CLUSTER_SOURCES).toContain('split');
    });
  });

  describe('ONBOARDING_STATES', () => {
    it('should have 7 states', () => {
      expect(ONBOARDING_STATES).toHaveLength(7);
    });

    it('should include all expected states', () => {
      expect(ONBOARDING_STATES).toContain('not_started');
      expect(ONBOARDING_STATES).toContain('welcome');
      expect(ONBOARDING_STATES).toContain('user_type_selection');
      expect(ONBOARDING_STATES).toContain('template_preview');
      expect(ONBOARDING_STATES).toContain('first_chat');
      expect(ONBOARDING_STATES).toContain('first_memory_saved');
      expect(ONBOARDING_STATES).toContain('completed');
    });
  });

  describe('DEFAULT_EVOLUTION_THRESHOLDS', () => {
    it('should have correct emerge values', () => {
      expect(DEFAULT_EVOLUTION_THRESHOLDS.emerge.percentage).toBe(0.01);
      expect(DEFAULT_EVOLUTION_THRESHOLDS.emerge.min).toBe(10);
      expect(DEFAULT_EVOLUTION_THRESHOLDS.emerge.max).toBe(100);
      expect(DEFAULT_EVOLUTION_THRESHOLDS.emerge.similarity).toBe(0.70);
    });

    it('should have correct split values', () => {
      expect(DEFAULT_EVOLUTION_THRESHOLDS.split.percentage).toBe(0.10);
      expect(DEFAULT_EVOLUTION_THRESHOLDS.split.min).toBe(50);
      expect(DEFAULT_EVOLUTION_THRESHOLDS.split.max).toBe(500);
      expect(DEFAULT_EVOLUTION_THRESHOLDS.split.similarity).toBe(0.50);
    });

    it('should have correct merge values', () => {
      expect(DEFAULT_EVOLUTION_THRESHOLDS.merge.similarity).toBe(0.80);
      expect(DEFAULT_EVOLUTION_THRESHOLDS.merge.overlap).toBe(0.50);
    });
  });

  describe('COLD_START_CONFIG', () => {
    it('should have correct values', () => {
      expect(COLD_START_CONFIG.threshold_nodes).toBe(200);
      expect(COLD_START_CONFIG.emerge_fixed).toBe(15);
      expect(COLD_START_CONFIG.split_fixed).toBe(100);
      expect(COLD_START_CONFIG.min_days).toBe(7);
    });
  });

  describe('SELF_TUNING_CONFIG', () => {
    it('should have correct values', () => {
      expect(SELF_TUNING_CONFIG.enabled).toBe(true);
      expect(SELF_TUNING_CONFIG.max_drift).toBe(0.20);
      expect(SELF_TUNING_CONFIG.window_days).toBe(30);
      expect(SELF_TUNING_CONFIG.reset_available).toBe(true);
    });
  });

  describe('Type Guards', () => {
    it('isUserType should validate correctly', () => {
      expect(isUserType('student')).toBe(true);
      expect(isUserType('invalid')).toBe(false);
    });

    it('isEvolutionTrigger should validate correctly', () => {
      expect(isEvolutionTrigger('EMERGE')).toBe(true);
      expect(isEvolutionTrigger('INVALID')).toBe(false);
    });

    it('isClusterSource should validate correctly', () => {
      expect(isClusterSource('template')).toBe(true);
      expect(isClusterSource('invalid')).toBe(false);
    });

    it('isOnboardingState should validate correctly', () => {
      expect(isOnboardingState('welcome')).toBe(true);
      expect(isOnboardingState('invalid')).toBe(false);
    });
  });
});

// ============================================================
// SCHEMA VALIDATION TESTS
// ============================================================

describe('Schema Validation', () => {
  describe('ClusterTendenciesSchema', () => {
    it('should validate valid tendencies', () => {
      const valid: ClusterTendencies = {
        decay_rate_modifier: 0.7,
        importance_patterns: ['exam', 'deadline'],
        typical_access_interval: 3,
        source: 'default',
        confidence: 0.5,
      };
      expect(ClusterTendenciesSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject invalid decay_rate_modifier', () => {
      const invalid = {
        decay_rate_modifier: 5, // Too high
        importance_patterns: [],
        typical_access_interval: 1,
        source: 'default',
        confidence: 0.5,
      };
      expect(ClusterTendenciesSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('ClusterSchema', () => {
    it('should validate valid cluster', () => {
      const valid: Cluster = {
        id: 'cluster_123',
        name: 'Academics',
        description: 'Academic content',
        icon: '📚',
        pinned: true,
        tendencies: {
          decay_rate_modifier: 0.7,
          importance_patterns: ['exam'],
          typical_access_interval: 3,
          source: 'default',
          confidence: 0.5,
        },
        preferences: { tone: 'neutral' },
        source: 'template',
        created_at: new Date(),
        node_count: 10,
      };
      expect(ClusterSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject cluster with empty name', () => {
      const invalid = {
        id: 'cluster_123',
        name: '',
        description: '',
        icon: '📚',
        pinned: true,
        tendencies: {
          decay_rate_modifier: 1,
          importance_patterns: [],
          typical_access_interval: 1,
          source: 'default',
          confidence: 0.5,
        },
        preferences: {},
        source: 'template',
        created_at: new Date(),
        node_count: 0,
      };
      expect(ClusterSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('ClusterHealthSchema', () => {
    it('should validate valid health', () => {
      const valid: ClusterHealth = {
        cluster_id: 'cluster_123',
        total_nodes: 100,
        active_nodes: 60,
        weak_nodes: 30,
        dormant_nodes: 10,
        health_ratio: 0.6,
        avg_similarity: 0.75,
        calculated_at: new Date(),
      };
      expect(ClusterHealthSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject health with invalid ratio', () => {
      const invalid = {
        cluster_id: 'cluster_123',
        total_nodes: 100,
        active_nodes: 60,
        weak_nodes: 30,
        dormant_nodes: 10,
        health_ratio: 1.5, // Too high
        avg_similarity: 0.75,
        calculated_at: new Date(),
      };
      expect(ClusterHealthSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('EvolutionLearningSchema', () => {
    it('should validate valid learning', () => {
      const valid: EvolutionLearning = {
        manual_cluster_creates: [],
        cluster_renames: [],
        split_acceptances: 5,
        split_rejections: 2,
        merge_acceptances: 3,
        merge_rejections: 1,
        emerge_adjustment: 0.05,
        split_adjustment: -0.10,
        last_updated: new Date(),
      };
      expect(EvolutionLearningSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject learning with out of range adjustment', () => {
      const invalid = {
        manual_cluster_creates: [],
        cluster_renames: [],
        split_acceptances: 0,
        split_rejections: 0,
        merge_acceptances: 0,
        merge_rejections: 0,
        emerge_adjustment: 0.50, // Too high
        split_adjustment: 0,
        last_updated: new Date(),
      };
      expect(EvolutionLearningSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('OnboardingProgressSchema', () => {
    it('should validate valid progress', () => {
      const valid: OnboardingProgress = {
        state: 'template_preview',
        user_type: 'student',
        clusters_created: [],
        started_at: new Date(),
      };
      expect(OnboardingProgressSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('Type Guard Functions', () => {
    it('isCluster should work correctly', () => {
      const valid: Cluster = {
        id: 'cluster_123',
        name: 'Test',
        description: 'Test',
        icon: '📚',
        pinned: false,
        tendencies: {
          decay_rate_modifier: 1,
          importance_patterns: [],
          typical_access_interval: 1,
          source: 'default',
          confidence: 0.5,
        },
        preferences: {},
        source: 'template',
        created_at: new Date(),
        node_count: 0,
      };
      expect(isCluster(valid)).toBe(true);
      expect(isCluster({})).toBe(false);
    });
  });
});

// ============================================================
// TEMPLATE TESTS
// ============================================================

describe('Templates', () => {
  describe('UNIFIED_TEMPLATES', () => {
    it('should have templates for all user types', () => {
      expect(UNIFIED_TEMPLATES.student).toBeDefined();
      expect(UNIFIED_TEMPLATES.professional).toBeDefined();
      expect(UNIFIED_TEMPLATES.creative).toBeDefined();
      expect(UNIFIED_TEMPLATES.researcher).toBeDefined();
      expect(UNIFIED_TEMPLATES.other).toBeDefined();
    });

    it('student template should have 3 clusters', () => {
      expect(UNIFIED_TEMPLATES.student.clusters).toHaveLength(3);
    });

    it('professional template should have 3 clusters', () => {
      expect(UNIFIED_TEMPLATES.professional.clusters).toHaveLength(3);
    });

    it('creative template should have 3 clusters', () => {
      expect(UNIFIED_TEMPLATES.creative.clusters).toHaveLength(3);
    });

    it('researcher template should have 3 clusters', () => {
      expect(UNIFIED_TEMPLATES.researcher.clusters).toHaveLength(3);
    });

    it('other template should have 0 clusters (pure emergence)', () => {
      expect(UNIFIED_TEMPLATES.other.clusters).toHaveLength(0);
    });

    it('all templates should pass schema validation', () => {
      for (const userType of USER_TYPES) {
        const template = UNIFIED_TEMPLATES[userType];
        expect(UnifiedTemplateSchema.safeParse(template).success).toBe(true);
      }
    });
  });

  describe('getUnifiedTemplate', () => {
    it('should return correct template', () => {
      expect(getUnifiedTemplate('student').user_type).toBe('student');
      expect(getUnifiedTemplate('professional').user_type).toBe('professional');
    });
  });

  describe('getClusterTemplates', () => {
    it('should return cluster array', () => {
      const clusters = getClusterTemplates('student');
      expect(clusters).toHaveLength(3);
      expect(clusters[0]?.name).toBe('Academics');
    });
  });

  describe('getGlobalPreferences', () => {
    it('should return preferences', () => {
      const prefs = getGlobalPreferences('student');
      expect(prefs.tone).toBe('neutral');
      expect(prefs.verbosity).toBe('detailed');
    });
  });
});

// ============================================================
// ONBOARDING TESTS
// ============================================================

describe('Onboarding', () => {
  describe('createOnboardingProgress', () => {
    it('should create initial progress', () => {
      const progress = createOnboardingProgress();
      expect(progress.state).toBe('not_started');
      expect(progress.clusters_created).toEqual([]);
      expect(progress.started_at).toBeInstanceOf(Date);
    });
  });

  describe('transitionOnboarding', () => {
    let progress: OnboardingProgress;

    beforeEach(() => {
      progress = createOnboardingProgress();
    });

    it('should transition from not_started to welcome', () => {
      const result = transitionOnboarding(progress, { type: 'start_onboarding' });
      expect(result.success).toBe(true);
      expect(result.progress?.state).toBe('welcome');
    });

    it('should transition from welcome to template_preview on select_user_type', () => {
      progress.state = 'welcome';
      const result = transitionOnboarding(progress, { type: 'select_user_type', userType: 'student' });
      expect(result.success).toBe(true);
      expect(result.progress?.state).toBe('template_preview');
      expect(result.progress?.user_type).toBe('student');
    });

    it('should transition from welcome to first_chat on skip_to_chat', () => {
      progress.state = 'welcome';
      const result = transitionOnboarding(progress, { type: 'skip_to_chat' });
      expect(result.success).toBe(true);
      expect(result.progress?.state).toBe('first_chat');
      expect(result.progress?.user_type).toBe('other');
    });

    it('should transition from template_preview to first_chat on accept_template', () => {
      progress.state = 'template_preview';
      progress.user_type = 'student';
      const result = transitionOnboarding(progress, { type: 'accept_template', clusterIds: ['c1', 'c2'] });
      expect(result.success).toBe(true);
      expect(result.progress?.state).toBe('first_chat');
      expect(result.progress?.template_accepted).toBe(true);
      expect(result.progress?.clusters_created).toEqual(['c1', 'c2']);
    });

    it('should transition from first_chat to first_memory_saved', () => {
      progress.state = 'first_chat';
      const result = transitionOnboarding(progress, { type: 'first_memory_created', memoryId: 'mem_123' });
      expect(result.success).toBe(true);
      expect(result.progress?.state).toBe('first_memory_saved');
      expect(result.progress?.first_memory_id).toBe('mem_123');
    });

    it('should transition from first_memory_saved to completed', () => {
      progress.state = 'first_memory_saved';
      const result = transitionOnboarding(progress, { type: 'continue_after_first_memory' });
      expect(result.success).toBe(true);
      expect(result.progress?.state).toBe('completed');
      expect(result.progress?.completed_at).toBeInstanceOf(Date);
    });

    it('should reject invalid transitions', () => {
      const result = transitionOnboarding(progress, { type: 'accept_template', clusterIds: [] });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
    });
  });

  describe('Onboarding helpers', () => {
    it('isOnboardingComplete should return true only for completed state', () => {
      expect(isOnboardingComplete({ state: 'completed', clusters_created: [], started_at: new Date() })).toBe(true);
      expect(isOnboardingComplete({ state: 'first_chat', clusters_created: [], started_at: new Date() })).toBe(false);
    });

    it('hasOnboardingStarted should return false only for not_started', () => {
      expect(hasOnboardingStarted({ state: 'not_started', clusters_created: [], started_at: new Date() })).toBe(false);
      expect(hasOnboardingStarted({ state: 'welcome', clusters_created: [], started_at: new Date() })).toBe(true);
    });

    it('getOnboardingStepNumber should return correct step', () => {
      expect(getOnboardingStepNumber('not_started')).toBe(0);
      expect(getOnboardingStepNumber('welcome')).toBe(1);
      expect(getOnboardingStepNumber('user_type_selection')).toBe(2);
      expect(getOnboardingStepNumber('template_preview')).toBe(3);
      expect(getOnboardingStepNumber('first_chat')).toBe(4);
      expect(getOnboardingStepNumber('first_memory_saved')).toBe(5);
      expect(getOnboardingStepNumber('completed')).toBe(6);
    });

    it('getValidActions should return correct actions', () => {
      expect(getValidActions('not_started')).toEqual(['start_onboarding']);
      expect(getValidActions('welcome')).toContain('skip_to_chat');
      expect(getValidActions('completed')).toEqual([]);
    });

    it('isActionValid should check correctly', () => {
      expect(isActionValid('not_started', 'start_onboarding')).toBe(true);
      expect(isActionValid('not_started', 'skip_to_chat')).toBe(false);
    });
  });
});

// ============================================================
// THRESHOLD CALCULATION TESTS
// ============================================================

describe('Threshold Calculations', () => {
  describe('calculateEmergeThreshold', () => {
    it('should return cold-start fixed value for small graphs', () => {
      expect(calculateEmergeThreshold(50)).toBe(15);
      expect(calculateEmergeThreshold(100)).toBe(15);
      expect(calculateEmergeThreshold(199)).toBe(15);
    });

    it('should return min bound for moderate graphs', () => {
      expect(calculateEmergeThreshold(200)).toBe(10); // 1% of 200 = 2, but min is 10
      expect(calculateEmergeThreshold(500)).toBe(10); // 1% of 500 = 5, but min is 10
    });

    it('should return percentage for larger graphs', () => {
      expect(calculateEmergeThreshold(2000)).toBe(20); // 1% of 2000
      expect(calculateEmergeThreshold(5000)).toBe(50); // 1% of 5000
    });

    it('should return max bound for very large graphs', () => {
      expect(calculateEmergeThreshold(10000)).toBe(100); // 1% of 10000 = 100
      expect(calculateEmergeThreshold(50000)).toBe(100); // 1% of 50000 = 500, but max is 100
    });

    it('should apply learning adjustment', () => {
      const learning = createEvolutionLearning();
      learning.emerge_adjustment = 0.10; // +10%
      expect(calculateEmergeThreshold(2000, EVOLUTION_CONFIG, learning)).toBe(22); // 20 * 1.10 = 22
    });
  });

  describe('calculateSplitThreshold', () => {
    it('should return cold-start fixed value for small graphs', () => {
      expect(calculateSplitThreshold(100)).toBe(100);
      expect(calculateSplitThreshold(199)).toBe(100);
    });

    it('should return min bound for moderate graphs', () => {
      expect(calculateSplitThreshold(200)).toBe(50); // 10% of 200 = 20, but min is 50
      expect(calculateSplitThreshold(400)).toBe(50); // 10% of 400 = 40, but min is 50
    });

    it('should return percentage for larger graphs', () => {
      expect(calculateSplitThreshold(1000)).toBe(100); // 10% of 1000
      expect(calculateSplitThreshold(2000)).toBe(200); // 10% of 2000
    });

    it('should return max bound for very large graphs', () => {
      expect(calculateSplitThreshold(10000)).toBe(500); // 10% of 10000 = 1000, but max is 500
    });
  });
});

// ============================================================
// EVOLUTION SUGGESTION TESTS
// ============================================================

describe('Evolution Suggestions', () => {
  describe('shouldSuggestEmerge', () => {
    it('should return true when conditions are met', () => {
      expect(shouldSuggestEmerge(20, 0.75, 2000)).toBe(true);
    });

    it('should return false when similarity is too low', () => {
      expect(shouldSuggestEmerge(20, 0.60, 2000)).toBe(false);
    });

    it('should return false when node count is too low', () => {
      expect(shouldSuggestEmerge(5, 0.75, 2000)).toBe(false);
    });
  });

  describe('shouldSuggestSplit', () => {
    it('should return true when cluster is large and diverse', () => {
      expect(shouldSuggestSplit(200, 0.40, 2000)).toBe(true);
    });

    it('should return false when similarity is acceptable', () => {
      expect(shouldSuggestSplit(200, 0.60, 2000)).toBe(false);
    });

    it('should return false when cluster is too small', () => {
      expect(shouldSuggestSplit(100, 0.40, 2000)).toBe(false);
    });
  });

  describe('shouldSuggestMerge', () => {
    it('should return true when similarity and overlap are high', () => {
      expect(shouldSuggestMerge(0.85, 0.55)).toBe(true);
    });

    it('should return false when similarity is too low', () => {
      expect(shouldSuggestMerge(0.70, 0.55)).toBe(false);
    });

    it('should return false when overlap is too low', () => {
      expect(shouldSuggestMerge(0.85, 0.40)).toBe(false);
    });
  });
});

// ============================================================
// CLUSTER HEALTH TESTS
// ============================================================

describe('Cluster Health', () => {
  const mockCluster: Cluster = {
    id: 'cluster_123',
    name: 'Test',
    description: 'Test cluster',
    icon: '📚',
    pinned: false,
    tendencies: {
      decay_rate_modifier: 1,
      importance_patterns: [],
      typical_access_interval: 1,
      source: 'default',
      confidence: 0.5,
    },
    preferences: {},
    source: 'template',
    created_at: new Date(),
    node_count: 10,
  };

  describe('calculateClusterHealth', () => {
    it('should categorize nodes correctly', () => {
      const nodeStates: NodeStateForHealth[] = [
        { node_id: '1', retrievability: 0.8 }, // Active
        { node_id: '2', retrievability: 0.6 }, // Active
        { node_id: '3', retrievability: 0.3 }, // Weak
        { node_id: '4', retrievability: 0.2 }, // Weak
        { node_id: '5', retrievability: 0.05 }, // Dormant
      ];

      const health = calculateClusterHealth(mockCluster, nodeStates, 0.75);

      expect(health.cluster_id).toBe('cluster_123');
      expect(health.total_nodes).toBe(5);
      expect(health.active_nodes).toBe(2);
      expect(health.weak_nodes).toBe(2);
      expect(health.dormant_nodes).toBe(1);
      expect(health.health_ratio).toBe(0.4);
      expect(health.avg_similarity).toBe(0.75);
    });

    it('should handle empty node list', () => {
      const health = calculateClusterHealth(mockCluster, []);
      expect(health.total_nodes).toBe(0);
      expect(health.health_ratio).toBe(0);
    });
  });

  describe('isClusterUnhealthy', () => {
    it('should return true when health ratio is low', () => {
      const health: ClusterHealth = {
        cluster_id: 'c1',
        total_nodes: 100,
        active_nodes: 10,
        weak_nodes: 40,
        dormant_nodes: 50,
        health_ratio: 0.10,
        avg_similarity: 0.5,
        calculated_at: new Date(),
      };
      expect(isClusterUnhealthy(health)).toBe(true);
    });

    it('should return false when health ratio is acceptable', () => {
      const health: ClusterHealth = {
        cluster_id: 'c1',
        total_nodes: 100,
        active_nodes: 30,
        weak_nodes: 40,
        dormant_nodes: 30,
        health_ratio: 0.30,
        avg_similarity: 0.5,
        calculated_at: new Date(),
      };
      expect(isClusterUnhealthy(health)).toBe(false);
    });
  });
});

// ============================================================
// LEARNING TESTS
// ============================================================

describe('Learning', () => {
  describe('createEvolutionLearning', () => {
    it('should create default learning state', () => {
      const learning = createEvolutionLearning();
      expect(learning.manual_cluster_creates).toEqual([]);
      expect(learning.cluster_renames).toEqual([]);
      expect(learning.split_acceptances).toBe(0);
      expect(learning.split_rejections).toBe(0);
      expect(learning.emerge_adjustment).toBe(0);
      expect(learning.split_adjustment).toBe(0);
    });
  });

  describe('updateLearning', () => {
    it('should increment split_acceptances on accepted split', () => {
      const learning = createEvolutionLearning();
      const event: EvolutionEvent = {
        id: 'evt_1',
        type: 'SPLIT',
        cluster_id: 'c1',
        timestamp: new Date(),
        details: {
          type: 'SPLIT',
          parent_id: 'p1',
          child_ids: ['c2', 'c3'],
          reason: 'Too diverse',
          parent_size: 200,
          parent_similarity: 0.4,
        },
        user_action: 'accepted',
        graph_size_at_event: 2000,
      };

      const updated = updateLearning(learning, event);
      expect(updated.split_acceptances).toBe(1);
    });

    it('should adjust split threshold on repeated rejections', () => {
      let learning = createEvolutionLearning();
      learning.split_rejections = 5;
      learning.split_acceptances = 2;

      const event: EvolutionEvent = {
        id: 'evt_1',
        type: 'SPLIT',
        cluster_id: 'c1',
        timestamp: new Date(),
        details: {
          type: 'SPLIT',
          parent_id: 'p1',
          child_ids: ['c2', 'c3'],
          reason: 'Too diverse',
          parent_size: 200,
          parent_similarity: 0.4,
        },
        user_action: 'rejected',
        graph_size_at_event: 2000,
      };

      const updated = updateLearning(learning, event);
      expect(updated.split_rejections).toBe(6);
      expect(updated.split_adjustment).toBe(0.05);
    });

    it('should adjust emerge threshold on rejected emerge', () => {
      const learning = createEvolutionLearning();
      const event: EvolutionEvent = {
        id: 'evt_1',
        type: 'EMERGE',
        cluster_id: 'c1',
        timestamp: new Date(),
        details: {
          type: 'EMERGE',
          new_cluster_name: 'Photography',
          node_count: 15,
          similarity: 0.75,
          candidate_node_ids: ['n1', 'n2'],
        },
        user_action: 'rejected',
        graph_size_at_event: 500,
      };

      const updated = updateLearning(learning, event);
      expect(updated.emerge_adjustment).toBe(0.05);
    });
  });

  describe('recordManualClusterCreate', () => {
    it('should record manual create and adjust threshold', () => {
      const learning = createEvolutionLearning();
      const updated = recordManualClusterCreate(learning, 500, 10);

      expect(updated.manual_cluster_creates).toHaveLength(1);
      expect(updated.manual_cluster_creates[0]?.cluster_size).toBe(10);
    });
  });

  describe('resetLearning', () => {
    it('should reset to default values', () => {
      const learning = createEvolutionLearning();
      learning.split_acceptances = 10;
      learning.emerge_adjustment = 0.15;

      const reset = resetLearning();
      expect(reset.split_acceptances).toBe(0);
      expect(reset.emerge_adjustment).toBe(0);
    });
  });
});

// ============================================================
// TEMPLATE APPLICATION TESTS
// ============================================================

describe('Template Application', () => {
  describe('generateClusterId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateClusterId();
      const id2 = generateClusterId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^cluster_\d+_[a-z0-9]+$/);
    });
  });

  describe('createClusterFromTemplate', () => {
    it('should create cluster from template', () => {
      const template = UNIFIED_TEMPLATES.student.clusters[0]!;
      const cluster = createClusterFromTemplate(template);

      expect(cluster.name).toBe('Academics');
      expect(cluster.icon).toBe('📚');
      expect(cluster.pinned).toBe(true);
      expect(cluster.source).toBe('template');
      expect(cluster.node_count).toBe(0);
      expect(cluster.tendencies.decay_rate_modifier).toBe(0.7);
    });
  });

  describe('applyUnifiedTemplate', () => {
    it('should create all clusters from template', () => {
      const template = UNIFIED_TEMPLATES.student;
      const result = applyUnifiedTemplate(template);

      expect(result.clusters).toHaveLength(3);
      expect(result.cluster_ids).toHaveLength(3);
      expect(result.clusters[0]?.name).toBe('Academics');
      expect(result.clusters[1]?.name).toBe('Social');
      expect(result.clusters[2]?.name).toBe('Creative');
    });

    it('should return empty for other template', () => {
      const template = UNIFIED_TEMPLATES.other;
      const result = applyUnifiedTemplate(template);

      expect(result.clusters).toHaveLength(0);
    });
  });
});

// ============================================================
// COLD-START HELPER TESTS
// ============================================================

describe('Cold-Start Helpers', () => {
  describe('isInColdStartMode', () => {
    it('should return true for small graphs', () => {
      expect(isInColdStartMode(50)).toBe(true);
      expect(isInColdStartMode(199)).toBe(true);
    });

    it('should return false for larger graphs', () => {
      expect(isInColdStartMode(200)).toBe(false);
      expect(isInColdStartMode(1000)).toBe(false);
    });
  });

  describe('getEvolutionMode', () => {
    it('should return cold_start for small graphs', () => {
      expect(getEvolutionMode(100)).toBe('cold_start');
    });

    it('should return adaptive for larger graphs', () => {
      expect(getEvolutionMode(500)).toBe('adaptive');
    });
  });
});

// ============================================================
// ROUTING TESTS
// ============================================================

describe('Routing', () => {
  describe('clusterCosineSimilarity', () => {
    it('should calculate similarity correctly', () => {
      expect(clusterCosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
      expect(clusterCosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
      expect(clusterCosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    });

    it('should return 0 for empty vectors', () => {
      expect(clusterCosineSimilarity([], [])).toBe(0);
    });

    it('should throw for mismatched lengths', () => {
      expect(() => clusterCosineSimilarity([1, 0], [1, 0, 0])).toThrow();
    });
  });

  describe('calculateAffinity', () => {
    it('should clamp negative similarities to 0', () => {
      expect(calculateAffinity([1, 0], [-1, 0])).toBe(0);
    });

    it('should return positive similarities as-is', () => {
      expect(calculateAffinity([1, 0], [1, 0])).toBeCloseTo(1);
    });
  });

  describe('routeQueryToClusters', () => {
    const mockCluster = (id: string): Cluster => ({
      id,
      name: id,
      description: '',
      icon: '📚',
      pinned: false,
      tendencies: {
        decay_rate_modifier: 1,
        importance_patterns: [],
        typical_access_interval: 1,
        source: 'default',
        confidence: 0.5,
      },
      preferences: {},
      source: 'template',
      created_at: new Date(),
      node_count: 10,
    });

    it('should return all_clusters for empty clusters', () => {
      const result = routeQueryToClusters('test', [1, 0], []);
      expect(result.search_strategy).toBe('all_clusters');
      expect(result.primary_cluster).toBeNull();
    });

    it('should return primary_only when one cluster has clear affinity', () => {
      const clusters: ClusterWithCentroid[] = [
        { cluster: mockCluster('c1'), centroid: [1, 0] },
        { cluster: mockCluster('c2'), centroid: [0, 1] },
      ];

      const result = routeQueryToClusters('test', [1, 0], clusters);
      expect(result.primary_cluster).toBe('c1');
      expect(result.affinities[0]?.cluster_id).toBe('c1');
    });

    it('should return all_clusters when top affinities are close', () => {
      const clusters: ClusterWithCentroid[] = [
        { cluster: mockCluster('c1'), centroid: [1, 0] },
        { cluster: mockCluster('c2'), centroid: [0.99, 0.1] },
      ];

      const result = routeQueryToClusters('test', [1, 0], clusters);
      // Both should have very similar affinity
      if (result.affinities.length >= 2) {
        const gap = result.affinities[0]!.affinity - result.affinities[1]!.affinity;
        if (gap <= ROUTING_CONFIG.search_all_gap) {
          expect(result.search_strategy).toBe('all_clusters');
        }
      }
    });
  });

  describe('routeToPrimaryCluster', () => {
    const mockCluster = (id: string): Cluster => ({
      id,
      name: id,
      description: '',
      icon: '📚',
      pinned: false,
      tendencies: {
        decay_rate_modifier: 1,
        importance_patterns: [],
        typical_access_interval: 1,
        source: 'default',
        confidence: 0.5,
      },
      preferences: {},
      source: 'template',
      created_at: new Date(),
      node_count: 10,
    });

    it('should return null for empty clusters', () => {
      expect(routeToPrimaryCluster([1, 0], [])).toBeNull();
    });

    it('should return cluster with highest affinity', () => {
      const clusters: ClusterWithCentroid[] = [
        { cluster: mockCluster('c1'), centroid: [0, 1] },
        { cluster: mockCluster('c2'), centroid: [1, 0] },
      ];

      expect(routeToPrimaryCluster([1, 0], clusters)).toBe('c2');
    });
  });
});

// ============================================================
// INTEGRATION TESTS
// ============================================================

describe('Integration', () => {
  it('should complete full onboarding flow', () => {
    let progress = createOnboardingProgress();

    // Start
    let result = transitionOnboarding(progress, { type: 'start_onboarding' });
    expect(result.success).toBe(true);
    progress = result.progress!;

    // Select user type
    result = transitionOnboarding(progress, { type: 'select_user_type', userType: 'student' });
    expect(result.success).toBe(true);
    progress = result.progress!;

    // Apply template
    const template = getUnifiedTemplate('student');
    const { cluster_ids } = applyUnifiedTemplate(template);

    // Accept template
    result = transitionOnboarding(progress, { type: 'accept_template', clusterIds: cluster_ids });
    expect(result.success).toBe(true);
    progress = result.progress!;
    expect(progress.clusters_created).toHaveLength(3);

    // First memory
    result = transitionOnboarding(progress, { type: 'first_memory_created', memoryId: 'mem_1' });
    expect(result.success).toBe(true);
    progress = result.progress!;

    // Complete
    result = transitionOnboarding(progress, { type: 'continue_after_first_memory' });
    expect(result.success).toBe(true);
    progress = result.progress!;
    expect(isOnboardingComplete(progress)).toBe(true);
  });

  it('should handle full evolution cycle', () => {
    let learning = createEvolutionLearning();

    // Simulate emergence detection
    const graphSize = 2000;
    const emergeThreshold = calculateEmergeThreshold(graphSize, EVOLUTION_CONFIG, learning);
    expect(emergeThreshold).toBe(20);

    // User rejects emergence suggestion
    const rejectEvent: EvolutionEvent = {
      id: 'evt_1',
      type: 'EMERGE',
      cluster_id: 'new_cluster',
      timestamp: new Date(),
      details: {
        type: 'EMERGE',
        new_cluster_name: 'Photography',
        node_count: 25,
        similarity: 0.75,
        candidate_node_ids: [],
      },
      user_action: 'rejected',
      graph_size_at_event: graphSize,
    };

    learning = updateLearning(learning, rejectEvent);
    expect(learning.emerge_adjustment).toBe(0.05);

    // New threshold should be higher
    const newThreshold = calculateEmergeThreshold(graphSize, EVOLUTION_CONFIG, learning);
    expect(newThreshold).toBe(21); // 20 * 1.05 = 21
  });
});
