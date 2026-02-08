import { describe, it, expect } from 'vitest';
import {
  // Constants
  NEAS_ERROR_TYPES,
  NEAS_CERTAINTY_LEVELS,
  NEAS_IMPACT_LEVELS,
  NEAS_CLARIFICATION_ACTIONS,
  NEAS_RESPONSE_VERBOSITY_LEVELS,
  NEAS_UNCERTAINTY_RESPONSES,
  NEAS_SEARCH_SCOPES,
  NEAS_SUGGESTION_MODES,
  NEAS_PERMISSION_TIERS,
  NEAS_SESSION_ID_PREFIX,
  NEAS_HIGH_IMPACT_CREDIT_THRESHOLD,
  NEAS_ATSS_ERROR_MAPPING,
  NEAS_FIX_STRATEGIES,
  NEAS_ERROR_EXPLANATIONS,
  NEAS_RECOVERY_SUGGESTIONS,
  NEAS_CLARIFICATION_MATRIX,
  NEAS_TOOL_PERMISSION_TIER,
  NEAS_DEFAULT_AGENT_DEFAULTS,
  NEAS_DEFAULT_AGENT_PERMISSIONS,
  NEAS_DEFAULT_AGENT_LIMITS,
  NEAS_DEFAULT_SUGGESTION_CONFIG,
  NEAS_OFFLINE_AVAILABLE_TOOLS,
  NEAS_ONLINE_ONLY_TOOLS,
  ATSS_TOOL_NAMES,
  // Schemas
  NeasErrorTypeSchema,
  NeasCertaintyLevelSchema,
  NeasImpactLevelSchema,
  NeasClarificationActionSchema,
  NeasResponseVerbositySchema,
  NeasSuggestionModeSchema,
  NeasPermissionTierSchema,
  NeasFixStrategyConfigSchema,
  // Type schemas
  NeasToolCallSchema,
  NeasAgentErrorSchema,
  NeasErrorExplanationSchema,
  NeasCertaintyFactorsSchema,
  NeasImpactFactorsSchema,
  NeasIntentAssessmentSchema,
  NeasAgentDefaultsSchema,
  NeasAgentPermissionsSchema,
  NeasAgentLimitsSchema,
  NeasSessionActionSchema,
  NeasAgentSessionSchema,
  NeasOperationCheckSchema,
  NeasSessionSummarySchema,
  NeasOfflineCapabilitiesSchema,
  NeasSuggestionConfigSchema,
  NeasPermissionCheckResultSchema,
  // Type guards
  isNeasErrorType,
  isNeasCertaintyLevel,
  isNeasImpactLevel,
  isNeasClarificationAction,
  isNeasResponseVerbosity,
  isNeasSuggestionMode,
  isNeasPermissionTier,
  // Functions
  generateSessionId,
  classifyAgentError,
  mapAtssErrorToAgentError,
  getFixStrategy,
  isAutoRetryable,
  generateUserExplanation,
  generateRecoverySuggestion,
  createErrorExplanation,
  assessCertainty,
  assessImpact,
  determineAction,
  assessIntent,
  shouldClarifyFirst,
  shouldActThenClarify,
  createDefaultAgentDefaults,
  createDefaultAgentPermissions,
  createDefaultAgentLimits,
  mergeAgentDefaults,
  isToolAllowedByPermissions,
  getEffectiveConfirmationLevel,
  createAgentSession,
  recordSessionOperation,
  canPerformOperation,
  getSessionSummary,
  getAvailableTools,
  isToolAvailableOffline,
  getOfflineCapabilities,
  createDefaultSuggestionConfig,
  shouldShowSuggestion,
  isInQuietHours,
  canSuggestToday,
  // Types
  type NeasAgentError,
  type NeasToolCall,
  type NeasAgentDefaults,
  type NeasAgentPermissions,
  type NeasAgentLimits,
  type NeasAgentSession,
  type NeasSuggestionConfig,
  type NeasIntentAssessment,
} from './index';

import { ATSS_ERROR_CODES } from '../agent-tools';

// ============================================================
// HELPER FACTORIES
// ============================================================

function makeToolCall(overrides: Partial<NeasToolCall> = {}): NeasToolCall {
  return {
    tool: 'view_node' as const,
    params: { node_ids: ['n_abc123def456'] },
    ...overrides,
  };
}

function makeAgentError(overrides: Partial<NeasAgentError> = {}): NeasAgentError {
  return {
    type: 'NOT_FOUND' as const,
    message: 'Node not found',
    original_action: makeToolCall(),
    atss_error_code: 'E404_NODE_NOT_FOUND',
    recovery_attempted: false,
    ...overrides,
  };
}

function makePermissions(overrides: Partial<NeasAgentPermissions> = {}): NeasAgentPermissions {
  return {
    _schemaVersion: 1,
    can_read: true as const,
    can_write: true,
    can_auto_operations: true,
    can_delete: false,
    can_bulk_operations: false,
    ...overrides,
  };
}

function makeDefaults(overrides: Partial<Omit<NeasAgentDefaults, '_schemaVersion'>> = {}): NeasAgentDefaults {
  return {
    _schemaVersion: 1,
    response_verbosity: 'balanced' as const,
    show_reasoning: false,
    auto_search_before_action: true,
    auto_show_related: true,
    auto_suggest_links: false,
    confirm_threshold_items: 10,
    confirm_threshold_credits: 15,
    confirm_destructive: true,
    uncertainty_response: 'ask' as const,
    default_search_scope: 'all' as const,
    default_time_range_days: 30,
    ...overrides,
  };
}

function makeLimits(overrides: Partial<NeasAgentLimits> = {}): NeasAgentLimits {
  return {
    max_operations_per_request: 100,
    max_credits_per_request: 30,
    preview_threshold: 10,
    context_batch_size: 50,
    ...overrides,
  };
}

function makeSuggestionConfig(overrides: Partial<Omit<NeasSuggestionConfig, '_schemaVersion'>> = {}): NeasSuggestionConfig {
  return {
    _schemaVersion: 1,
    mode: 'off' as const,
    max_per_day: 1,
    min_confidence: 0.9,
    quiet_hours_start: 22,
    quiet_hours_end: 8,
    ...overrides,
  };
}

// ============================================================
// CONSTANTS TESTS
// ============================================================

describe('NEAS Module', () => {
  describe('Constants', () => {
    describe('NEAS_ERROR_TYPES', () => {
      it('should have exactly 6 error types', () => {
        expect(NEAS_ERROR_TYPES).toHaveLength(6);
      });

      it('should contain all expected error types', () => {
        expect(NEAS_ERROR_TYPES).toEqual([
          'NOT_FOUND',
          'PERMISSION_DENIED',
          'LIMIT_EXCEEDED',
          'INVALID_INPUT',
          'CONFLICT',
          'NETWORK',
        ]);
      });

      it('should be defined as a const array', () => {
        expect(Array.isArray(NEAS_ERROR_TYPES)).toBe(true);
      });
    });

    describe('NEAS_CERTAINTY_LEVELS', () => {
      it('should have exactly 3 levels', () => {
        expect(NEAS_CERTAINTY_LEVELS).toHaveLength(3);
      });

      it('should contain high, medium, low', () => {
        expect(NEAS_CERTAINTY_LEVELS).toEqual(['high', 'medium', 'low']);
      });
    });

    describe('NEAS_IMPACT_LEVELS', () => {
      it('should have exactly 3 levels', () => {
        expect(NEAS_IMPACT_LEVELS).toHaveLength(3);
      });

      it('should contain low, medium, high', () => {
        expect(NEAS_IMPACT_LEVELS).toEqual(['low', 'medium', 'high']);
      });
    });

    describe('NEAS_CLARIFICATION_ACTIONS', () => {
      it('should have exactly 3 actions', () => {
        expect(NEAS_CLARIFICATION_ACTIONS).toHaveLength(3);
      });

      it('should contain act, act_then_clarify, clarify_first', () => {
        expect(NEAS_CLARIFICATION_ACTIONS).toEqual(['act', 'act_then_clarify', 'clarify_first']);
      });
    });

    describe('NEAS_RESPONSE_VERBOSITY_LEVELS', () => {
      it('should have exactly 3 levels', () => {
        expect(NEAS_RESPONSE_VERBOSITY_LEVELS).toHaveLength(3);
      });

      it('should contain terse, balanced, detailed', () => {
        expect(NEAS_RESPONSE_VERBOSITY_LEVELS).toEqual(['terse', 'balanced', 'detailed']);
      });
    });

    describe('NEAS_UNCERTAINTY_RESPONSES', () => {
      it('should have exactly 3 responses', () => {
        expect(NEAS_UNCERTAINTY_RESPONSES).toHaveLength(3);
      });

      it('should contain ask, best_guess, refuse', () => {
        expect(NEAS_UNCERTAINTY_RESPONSES).toEqual(['ask', 'best_guess', 'refuse']);
      });
    });

    describe('NEAS_SEARCH_SCOPES', () => {
      it('should have exactly 3 scopes', () => {
        expect(NEAS_SEARCH_SCOPES).toHaveLength(3);
      });

      it('should contain all, recent, current_cluster', () => {
        expect(NEAS_SEARCH_SCOPES).toEqual(['all', 'recent', 'current_cluster']);
      });
    });

    describe('NEAS_SUGGESTION_MODES', () => {
      it('should have exactly 3 modes', () => {
        expect(NEAS_SUGGESTION_MODES).toHaveLength(3);
      });

      it('should contain off, important_only, all', () => {
        expect(NEAS_SUGGESTION_MODES).toEqual(['off', 'important_only', 'all']);
      });
    });

    describe('NEAS_PERMISSION_TIERS', () => {
      it('should have exactly 3 tiers', () => {
        expect(NEAS_PERMISSION_TIERS).toHaveLength(3);
      });

      it('should contain always_on, on_by_default, off_by_default', () => {
        expect(NEAS_PERMISSION_TIERS).toEqual(['always_on', 'on_by_default', 'off_by_default']);
      });
    });

    describe('NEAS_SESSION_ID_PREFIX', () => {
      it('should be ses_', () => {
        expect(NEAS_SESSION_ID_PREFIX).toBe('ses_');
      });
    });

    describe('NEAS_HIGH_IMPACT_CREDIT_THRESHOLD', () => {
      it('should be 10', () => {
        expect(NEAS_HIGH_IMPACT_CREDIT_THRESHOLD).toBe(10);
      });
    });
  });

  // ============================================================
  // ATSS ERROR MAPPING TESTS
  // ============================================================

  describe('ATSS Error Mapping', () => {
    it('should have 26 error code mappings', () => {
      expect(Object.keys(NEAS_ATSS_ERROR_MAPPING)).toHaveLength(26);
    });

    describe('400 errors - INVALID_INPUT', () => {
      it('should map E400_INVALID_PARAMS to INVALID_INPUT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E400_INVALID_PARAMS']).toBe('INVALID_INPUT');
      });

      it('should map E400_MISSING_REQUIRED to INVALID_INPUT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E400_MISSING_REQUIRED']).toBe('INVALID_INPUT');
      });

      it('should map E400_INVALID_NODE_TYPE to INVALID_INPUT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E400_INVALID_NODE_TYPE']).toBe('INVALID_INPUT');
      });

      it('should map E400_INVALID_EDGE_TYPE to INVALID_INPUT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E400_INVALID_EDGE_TYPE']).toBe('INVALID_INPUT');
      });

      it('should map E400_CONTENT_TOO_LONG to INVALID_INPUT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E400_CONTENT_TOO_LONG']).toBe('INVALID_INPUT');
      });

      it('should map E400_TOO_MANY_TAGS to INVALID_INPUT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E400_TOO_MANY_TAGS']).toBe('INVALID_INPUT');
      });

      it('should map E400_INVALID_BULK_REFERENCE to INVALID_INPUT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E400_INVALID_BULK_REFERENCE']).toBe('INVALID_INPUT');
      });

      it('should map E400_SELF_EDGE to INVALID_INPUT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E400_SELF_EDGE']).toBe('INVALID_INPUT');
      });
    });

    describe('400 errors - LIMIT_EXCEEDED', () => {
      it('should map E400_TOO_MANY_NODE_IDS to LIMIT_EXCEEDED', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E400_TOO_MANY_NODE_IDS']).toBe('LIMIT_EXCEEDED');
      });

      it('should map E400_TOO_MANY_BULK_OPS to LIMIT_EXCEEDED', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E400_TOO_MANY_BULK_OPS']).toBe('LIMIT_EXCEEDED');
      });
    });

    describe('403 errors - PERMISSION_DENIED', () => {
      it('should map E403_INSUFFICIENT_CREDITS to PERMISSION_DENIED', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E403_INSUFFICIENT_CREDITS']).toBe('PERMISSION_DENIED');
      });

      it('should map E403_TIER_RESTRICTED to PERMISSION_DENIED', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E403_TIER_RESTRICTED']).toBe('PERMISSION_DENIED');
      });

      it('should map E403_CONFIRMATION_DENIED to PERMISSION_DENIED', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E403_CONFIRMATION_DENIED']).toBe('PERMISSION_DENIED');
      });
    });

    describe('403 errors - NETWORK (circuit breaker)', () => {
      it('should map E403_CIRCUIT_BREAKER_OPEN to NETWORK', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E403_CIRCUIT_BREAKER_OPEN']).toBe('NETWORK');
      });
    });

    describe('404 errors - NOT_FOUND', () => {
      it('should map E404_NODE_NOT_FOUND to NOT_FOUND', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E404_NODE_NOT_FOUND']).toBe('NOT_FOUND');
      });

      it('should map E404_EDGE_NOT_FOUND to NOT_FOUND', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E404_EDGE_NOT_FOUND']).toBe('NOT_FOUND');
      });

      it('should map E404_CLUSTER_NOT_FOUND to NOT_FOUND', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E404_CLUSTER_NOT_FOUND']).toBe('NOT_FOUND');
      });

      it('should map E404_UNDO_ENTRY_NOT_FOUND to NOT_FOUND', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E404_UNDO_ENTRY_NOT_FOUND']).toBe('NOT_FOUND');
      });
    });

    describe('409 errors - CONFLICT', () => {
      it('should map E409_DUPLICATE_EDGE to CONFLICT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E409_DUPLICATE_EDGE']).toBe('CONFLICT');
      });

      it('should map E409_UNDO_EXPIRED to CONFLICT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E409_UNDO_EXPIRED']).toBe('CONFLICT');
      });

      it('should map E409_UNDO_DEPENDENCY to CONFLICT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E409_UNDO_DEPENDENCY']).toBe('CONFLICT');
      });

      it('should map E409_ALREADY_UNDONE to CONFLICT', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E409_ALREADY_UNDONE']).toBe('CONFLICT');
      });
    });

    describe('429 errors - LIMIT_EXCEEDED', () => {
      it('should map E429_RATE_LIMITED to LIMIT_EXCEEDED', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E429_RATE_LIMITED']).toBe('LIMIT_EXCEEDED');
      });
    });

    describe('5xx errors - NETWORK', () => {
      it('should map E500_INTERNAL to NETWORK', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E500_INTERNAL']).toBe('NETWORK');
      });

      it('should map E503_LLM_UNAVAILABLE to NETWORK', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E503_LLM_UNAVAILABLE']).toBe('NETWORK');
      });

      it('should map E504_TOOL_TIMEOUT to NETWORK', () => {
        expect(NEAS_ATSS_ERROR_MAPPING['E504_TOOL_TIMEOUT']).toBe('NETWORK');
      });
    });

    it('should map every ATSS error code key', () => {
      const atssKeys = Object.keys(ATSS_ERROR_CODES);
      for (const key of atssKeys) {
        expect(NEAS_ATSS_ERROR_MAPPING[key]).toBeDefined();
      }
    });
  });

  // ============================================================
  // FIX STRATEGIES TESTS
  // ============================================================

  describe('Fix Strategies', () => {
    it('should have a strategy for every error type', () => {
      for (const errorType of NEAS_ERROR_TYPES) {
        expect(NEAS_FIX_STRATEGIES[errorType]).toBeDefined();
      }
    });

    it('should NOT auto-retry NOT_FOUND', () => {
      expect(NEAS_FIX_STRATEGIES['NOT_FOUND'].retry_automatically).toBe(false);
    });

    it('should NOT auto-retry PERMISSION_DENIED', () => {
      expect(NEAS_FIX_STRATEGIES['PERMISSION_DENIED'].retry_automatically).toBe(false);
    });

    it('should NOT auto-retry LIMIT_EXCEEDED', () => {
      expect(NEAS_FIX_STRATEGIES['LIMIT_EXCEEDED'].retry_automatically).toBe(false);
    });

    it('should NOT auto-retry INVALID_INPUT', () => {
      expect(NEAS_FIX_STRATEGIES['INVALID_INPUT'].retry_automatically).toBe(false);
    });

    it('should auto-retry CONFLICT', () => {
      expect(NEAS_FIX_STRATEGIES['CONFLICT'].retry_automatically).toBe(true);
    });

    it('should auto-retry NETWORK', () => {
      expect(NEAS_FIX_STRATEGIES['NETWORK'].retry_automatically).toBe(true);
    });

    it('should have a description for NOT_FOUND mentioning search', () => {
      expect(NEAS_FIX_STRATEGIES['NOT_FOUND'].description).toBe('Search for similar items, suggest creation');
    });

    it('should have descriptions for all strategies', () => {
      for (const errorType of NEAS_ERROR_TYPES) {
        expect(NEAS_FIX_STRATEGIES[errorType].description.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================
  // CLARIFICATION MATRIX TESTS
  // ============================================================

  describe('Clarification Matrix', () => {
    it('should have entries for all certainty levels', () => {
      for (const certainty of NEAS_CERTAINTY_LEVELS) {
        expect(NEAS_CLARIFICATION_MATRIX[certainty]).toBeDefined();
      }
    });

    it('should have entries for all impact levels within each certainty', () => {
      for (const certainty of NEAS_CERTAINTY_LEVELS) {
        for (const impact of NEAS_IMPACT_LEVELS) {
          expect(NEAS_CLARIFICATION_MATRIX[certainty][impact]).toBeDefined();
        }
      }
    });

    it('should map high+low to act', () => {
      expect(NEAS_CLARIFICATION_MATRIX['high']['low']).toBe('act');
    });

    it('should map high+medium to act', () => {
      expect(NEAS_CLARIFICATION_MATRIX['high']['medium']).toBe('act');
    });

    it('should map high+high to act', () => {
      expect(NEAS_CLARIFICATION_MATRIX['high']['high']).toBe('act');
    });

    it('should map medium+low to act', () => {
      expect(NEAS_CLARIFICATION_MATRIX['medium']['low']).toBe('act');
    });

    it('should map medium+medium to act_then_clarify', () => {
      expect(NEAS_CLARIFICATION_MATRIX['medium']['medium']).toBe('act_then_clarify');
    });

    it('should map medium+high to clarify_first', () => {
      expect(NEAS_CLARIFICATION_MATRIX['medium']['high']).toBe('clarify_first');
    });

    it('should map low+low to act_then_clarify', () => {
      expect(NEAS_CLARIFICATION_MATRIX['low']['low']).toBe('act_then_clarify');
    });

    it('should map low+medium to clarify_first', () => {
      expect(NEAS_CLARIFICATION_MATRIX['low']['medium']).toBe('clarify_first');
    });

    it('should map low+high to clarify_first', () => {
      expect(NEAS_CLARIFICATION_MATRIX['low']['high']).toBe('clarify_first');
    });
  });

  // ============================================================
  // TOOL PERMISSION TIER MAPPING TESTS
  // ============================================================

  describe('Tool Permission Tier Mapping', () => {
    it('should have a tier for every ATSS tool', () => {
      for (const tool of ATSS_TOOL_NAMES) {
        expect(NEAS_TOOL_PERMISSION_TIER[tool]).toBeDefined();
      }
    });

    it('should map view_node to always_on', () => {
      expect(NEAS_TOOL_PERMISSION_TIER['view_node']).toBe('always_on');
    });

    it('should map search to always_on', () => {
      expect(NEAS_TOOL_PERMISSION_TIER['search']).toBe('always_on');
    });

    it('should map create_node to on_by_default', () => {
      expect(NEAS_TOOL_PERMISSION_TIER['create_node']).toBe('on_by_default');
    });

    it('should map update_node to on_by_default', () => {
      expect(NEAS_TOOL_PERMISSION_TIER['update_node']).toBe('on_by_default');
    });

    it('should map create_edge to on_by_default', () => {
      expect(NEAS_TOOL_PERMISSION_TIER['create_edge']).toBe('on_by_default');
    });

    it('should map delete_edge to on_by_default', () => {
      expect(NEAS_TOOL_PERMISSION_TIER['delete_edge']).toBe('on_by_default');
    });

    it('should map link_to_cluster to on_by_default', () => {
      expect(NEAS_TOOL_PERMISSION_TIER['link_to_cluster']).toBe('on_by_default');
    });

    it('should map delete_node to off_by_default', () => {
      expect(NEAS_TOOL_PERMISSION_TIER['delete_node']).toBe('off_by_default');
    });

    it('should map bulk_operations to off_by_default', () => {
      expect(NEAS_TOOL_PERMISSION_TIER['bulk_operations']).toBe('off_by_default');
    });
  });

  // ============================================================
  // OFFLINE TOOLS TESTS
  // ============================================================

  describe('Offline Tools', () => {
    it('should have 2 offline-available tools', () => {
      expect(NEAS_OFFLINE_AVAILABLE_TOOLS).toHaveLength(2);
    });

    it('should include view_node and search', () => {
      expect(NEAS_OFFLINE_AVAILABLE_TOOLS).toContain('view_node');
      expect(NEAS_OFFLINE_AVAILABLE_TOOLS).toContain('search');
    });

    it('should have 7 online-only tools', () => {
      expect(NEAS_ONLINE_ONLY_TOOLS).toHaveLength(7);
    });

    it('should include all write and destructive tools in online-only', () => {
      expect(NEAS_ONLINE_ONLY_TOOLS).toContain('create_node');
      expect(NEAS_ONLINE_ONLY_TOOLS).toContain('update_node');
      expect(NEAS_ONLINE_ONLY_TOOLS).toContain('delete_node');
      expect(NEAS_ONLINE_ONLY_TOOLS).toContain('create_edge');
      expect(NEAS_ONLINE_ONLY_TOOLS).toContain('delete_edge');
      expect(NEAS_ONLINE_ONLY_TOOLS).toContain('link_to_cluster');
      expect(NEAS_ONLINE_ONLY_TOOLS).toContain('bulk_operations');
    });

    it('should cover all 9 tools between offline and online-only', () => {
      const combined = [...NEAS_OFFLINE_AVAILABLE_TOOLS, ...NEAS_ONLINE_ONLY_TOOLS];
      expect(combined).toHaveLength(9);
      for (const tool of ATSS_TOOL_NAMES) {
        expect(combined).toContain(tool);
      }
    });
  });

  // ============================================================
  // DEFAULT CONFIG CONSTANTS TESTS
  // ============================================================

  describe('Default Configurations', () => {
    describe('NEAS_DEFAULT_AGENT_DEFAULTS', () => {
      it('should have balanced response verbosity', () => {
        expect(NEAS_DEFAULT_AGENT_DEFAULTS.response_verbosity).toBe('balanced');
      });

      it('should have show_reasoning false', () => {
        expect(NEAS_DEFAULT_AGENT_DEFAULTS.show_reasoning).toBe(false);
      });

      it('should have auto_search_before_action true', () => {
        expect(NEAS_DEFAULT_AGENT_DEFAULTS.auto_search_before_action).toBe(true);
      });

      it('should have auto_show_related true', () => {
        expect(NEAS_DEFAULT_AGENT_DEFAULTS.auto_show_related).toBe(true);
      });

      it('should have auto_suggest_links false', () => {
        expect(NEAS_DEFAULT_AGENT_DEFAULTS.auto_suggest_links).toBe(false);
      });

      it('should have confirm_threshold_items 10', () => {
        expect(NEAS_DEFAULT_AGENT_DEFAULTS.confirm_threshold_items).toBe(10);
      });

      it('should have confirm_threshold_credits 15', () => {
        expect(NEAS_DEFAULT_AGENT_DEFAULTS.confirm_threshold_credits).toBe(15);
      });

      it('should have confirm_destructive true', () => {
        expect(NEAS_DEFAULT_AGENT_DEFAULTS.confirm_destructive).toBe(true);
      });

      it('should have uncertainty_response ask', () => {
        expect(NEAS_DEFAULT_AGENT_DEFAULTS.uncertainty_response).toBe('ask');
      });

      it('should have default_search_scope all', () => {
        expect(NEAS_DEFAULT_AGENT_DEFAULTS.default_search_scope).toBe('all');
      });

      it('should have default_time_range_days 30', () => {
        expect(NEAS_DEFAULT_AGENT_DEFAULTS.default_time_range_days).toBe(30);
      });
    });

    describe('NEAS_DEFAULT_AGENT_PERMISSIONS', () => {
      it('should have can_read true', () => {
        expect(NEAS_DEFAULT_AGENT_PERMISSIONS.can_read).toBe(true);
      });

      it('should have can_write true', () => {
        expect(NEAS_DEFAULT_AGENT_PERMISSIONS.can_write).toBe(true);
      });

      it('should have can_auto_operations true', () => {
        expect(NEAS_DEFAULT_AGENT_PERMISSIONS.can_auto_operations).toBe(true);
      });

      it('should have can_delete false', () => {
        expect(NEAS_DEFAULT_AGENT_PERMISSIONS.can_delete).toBe(false);
      });

      it('should have can_bulk_operations false', () => {
        expect(NEAS_DEFAULT_AGENT_PERMISSIONS.can_bulk_operations).toBe(false);
      });
    });

    describe('NEAS_DEFAULT_AGENT_LIMITS', () => {
      it('should have max_operations_per_request 100', () => {
        expect(NEAS_DEFAULT_AGENT_LIMITS.max_operations_per_request).toBe(100);
      });

      it('should have max_credits_per_request 30', () => {
        expect(NEAS_DEFAULT_AGENT_LIMITS.max_credits_per_request).toBe(30);
      });

      it('should have preview_threshold 10', () => {
        expect(NEAS_DEFAULT_AGENT_LIMITS.preview_threshold).toBe(10);
      });

      it('should have context_batch_size 50', () => {
        expect(NEAS_DEFAULT_AGENT_LIMITS.context_batch_size).toBe(50);
      });
    });

    describe('NEAS_DEFAULT_SUGGESTION_CONFIG', () => {
      it('should have mode off', () => {
        expect(NEAS_DEFAULT_SUGGESTION_CONFIG.mode).toBe('off');
      });

      it('should have max_per_day 1', () => {
        expect(NEAS_DEFAULT_SUGGESTION_CONFIG.max_per_day).toBe(1);
      });

      it('should have min_confidence 0.9', () => {
        expect(NEAS_DEFAULT_SUGGESTION_CONFIG.min_confidence).toBe(0.9);
      });

      it('should have quiet_hours_start 22', () => {
        expect(NEAS_DEFAULT_SUGGESTION_CONFIG.quiet_hours_start).toBe(22);
      });

      it('should have quiet_hours_end 8', () => {
        expect(NEAS_DEFAULT_SUGGESTION_CONFIG.quiet_hours_end).toBe(8);
      });
    });
  });

  // ============================================================
  // TYPE GUARD TESTS
  // ============================================================

  describe('Type Guards', () => {
    describe('isNeasErrorType', () => {
      it('should return true for all valid error types', () => {
        for (const errorType of NEAS_ERROR_TYPES) {
          expect(isNeasErrorType(errorType)).toBe(true);
        }
      });

      it('should return false for invalid strings', () => {
        expect(isNeasErrorType('UNKNOWN')).toBe(false);
        expect(isNeasErrorType('')).toBe(false);
        expect(isNeasErrorType('not_found')).toBe(false);
      });
    });

    describe('isNeasCertaintyLevel', () => {
      it('should return true for all valid certainty levels', () => {
        for (const level of NEAS_CERTAINTY_LEVELS) {
          expect(isNeasCertaintyLevel(level)).toBe(true);
        }
      });

      it('should return false for invalid strings', () => {
        expect(isNeasCertaintyLevel('very_high')).toBe(false);
        expect(isNeasCertaintyLevel('')).toBe(false);
      });
    });

    describe('isNeasImpactLevel', () => {
      it('should return true for all valid impact levels', () => {
        for (const level of NEAS_IMPACT_LEVELS) {
          expect(isNeasImpactLevel(level)).toBe(true);
        }
      });

      it('should return false for invalid strings', () => {
        expect(isNeasImpactLevel('critical')).toBe(false);
        expect(isNeasImpactLevel('')).toBe(false);
      });
    });

    describe('isNeasClarificationAction', () => {
      it('should return true for all valid actions', () => {
        for (const action of NEAS_CLARIFICATION_ACTIONS) {
          expect(isNeasClarificationAction(action)).toBe(true);
        }
      });

      it('should return false for invalid strings', () => {
        expect(isNeasClarificationAction('abort')).toBe(false);
        expect(isNeasClarificationAction('')).toBe(false);
      });
    });

    describe('isNeasResponseVerbosity', () => {
      it('should return true for all valid verbosity levels', () => {
        for (const level of NEAS_RESPONSE_VERBOSITY_LEVELS) {
          expect(isNeasResponseVerbosity(level)).toBe(true);
        }
      });

      it('should return false for invalid strings', () => {
        expect(isNeasResponseVerbosity('verbose')).toBe(false);
        expect(isNeasResponseVerbosity('')).toBe(false);
      });
    });

    describe('isNeasSuggestionMode', () => {
      it('should return true for all valid suggestion modes', () => {
        for (const mode of NEAS_SUGGESTION_MODES) {
          expect(isNeasSuggestionMode(mode)).toBe(true);
        }
      });

      it('should return false for invalid strings', () => {
        expect(isNeasSuggestionMode('auto')).toBe(false);
        expect(isNeasSuggestionMode('')).toBe(false);
      });
    });

    describe('isNeasPermissionTier', () => {
      it('should return true for all valid permission tiers', () => {
        for (const tier of NEAS_PERMISSION_TIERS) {
          expect(isNeasPermissionTier(tier)).toBe(true);
        }
      });

      it('should return false for invalid strings', () => {
        expect(isNeasPermissionTier('admin')).toBe(false);
        expect(isNeasPermissionTier('')).toBe(false);
      });
    });
  });

  // ============================================================
  // SESSION ID GENERATION TESTS
  // ============================================================

  describe('generateSessionId', () => {
    it('should start with ses_ prefix', () => {
      const id = generateSessionId();
      expect(id.startsWith('ses_')).toBe(true);
    });

    it('should be 16 characters total', () => {
      const id = generateSessionId();
      expect(id).toHaveLength(16);
    });

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
      expect(ids.size).toBe(100);
    });

    it('should match expected format', () => {
      const id = generateSessionId();
      expect(id).toMatch(/^ses_[a-zA-Z0-9_-]{12}$/);
    });
  });

  // ============================================================
  // ERROR CLASSIFICATION FUNCTION TESTS
  // ============================================================

  describe('Error Handling Functions', () => {
    describe('classifyAgentError', () => {
      it('should classify all 26 ATSS error codes correctly', () => {
        for (const [code, expectedType] of Object.entries(NEAS_ATSS_ERROR_MAPPING)) {
          expect(classifyAgentError(code)).toBe(expectedType);
        }
      });

      it('should return NETWORK for unknown error codes', () => {
        expect(classifyAgentError('E999_UNKNOWN')).toBe('NETWORK');
        expect(classifyAgentError('GARBAGE')).toBe('NETWORK');
        expect(classifyAgentError('')).toBe('NETWORK');
      });
    });

    describe('mapAtssErrorToAgentError', () => {
      it('should create an agent error with correct type', () => {
        const action = makeToolCall();
        const error = mapAtssErrorToAgentError('E404_NODE_NOT_FOUND', 'Node not found', action);
        expect(error.type).toBe('NOT_FOUND');
      });

      it('should preserve the message', () => {
        const action = makeToolCall();
        const error = mapAtssErrorToAgentError('E404_NODE_NOT_FOUND', 'Custom message', action);
        expect(error.message).toBe('Custom message');
      });

      it('should preserve the original action', () => {
        const action = makeToolCall({ tool: 'search' as const, params: { query: 'test' } });
        const error = mapAtssErrorToAgentError('E500_INTERNAL', 'Error', action);
        expect(error.original_action).toEqual(action);
      });

      it('should store the ATSS error code', () => {
        const action = makeToolCall();
        const error = mapAtssErrorToAgentError('E409_DUPLICATE_EDGE', 'Dupe', action);
        expect(error.atss_error_code).toBe('E409_DUPLICATE_EDGE');
      });

      it('should set recovery_attempted to false', () => {
        const action = makeToolCall();
        const error = mapAtssErrorToAgentError('E500_INTERNAL', 'Error', action);
        expect(error.recovery_attempted).toBe(false);
      });

      it('should handle unknown ATSS codes by mapping to NETWORK', () => {
        const action = makeToolCall();
        const error = mapAtssErrorToAgentError('E999_MADE_UP', 'Unknown', action);
        expect(error.type).toBe('NETWORK');
      });
    });

    describe('getFixStrategy', () => {
      it('should return correct strategy for each error type', () => {
        for (const errorType of NEAS_ERROR_TYPES) {
          const strategy = getFixStrategy(errorType);
          expect(strategy).toEqual(NEAS_FIX_STRATEGIES[errorType]);
        }
      });

      it('should return NOT_FOUND strategy with no retry', () => {
        const strategy = getFixStrategy('NOT_FOUND');
        expect(strategy.retry_automatically).toBe(false);
        expect(strategy.description).toBe('Search for similar items, suggest creation');
      });

      it('should return CONFLICT strategy with retry', () => {
        const strategy = getFixStrategy('CONFLICT');
        expect(strategy.retry_automatically).toBe(true);
      });

      it('should return NETWORK strategy with retry', () => {
        const strategy = getFixStrategy('NETWORK');
        expect(strategy.retry_automatically).toBe(true);
      });
    });

    describe('isAutoRetryable', () => {
      it('should return true for CONFLICT', () => {
        expect(isAutoRetryable('CONFLICT')).toBe(true);
      });

      it('should return true for NETWORK', () => {
        expect(isAutoRetryable('NETWORK')).toBe(true);
      });

      it('should return false for NOT_FOUND', () => {
        expect(isAutoRetryable('NOT_FOUND')).toBe(false);
      });

      it('should return false for PERMISSION_DENIED', () => {
        expect(isAutoRetryable('PERMISSION_DENIED')).toBe(false);
      });

      it('should return false for LIMIT_EXCEEDED', () => {
        expect(isAutoRetryable('LIMIT_EXCEEDED')).toBe(false);
      });

      it('should return false for INVALID_INPUT', () => {
        expect(isAutoRetryable('INVALID_INPUT')).toBe(false);
      });
    });

    describe('generateUserExplanation', () => {
      it('should return a template-based explanation for NOT_FOUND', () => {
        const error = makeAgentError({ type: 'NOT_FOUND' as const });
        const result = generateUserExplanation(error, { target: 'the note' });
        expect(result).toContain('the note');
      });

      it('should replace {target} placeholder in NOT_FOUND', () => {
        const error = makeAgentError({ type: 'NOT_FOUND' as const });
        const result = generateUserExplanation(error, { target: 'my document' });
        expect(result).toContain('my document');
        expect(result).not.toContain('{target}');
      });

      it('should replace {action} placeholder in PERMISSION_DENIED', () => {
        const error = makeAgentError({ type: 'PERMISSION_DENIED' as const });
        const result = generateUserExplanation(error, { action: 'delete this node' });
        expect(result).toContain('delete this node');
      });

      it('should include recovery suggestion via {suggestion} placeholder', () => {
        const error = makeAgentError({ type: 'NOT_FOUND' as const });
        const result = generateUserExplanation(error);
        // The {suggestion} is replaced with the recovery suggestion
        expect(result).toContain('search for something similar');
      });

      it('should handle missing context gracefully', () => {
        const error = makeAgentError({ type: 'NETWORK' as const });
        const result = generateUserExplanation(error);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      });
    });

    describe('generateRecoverySuggestion', () => {
      it('should return suggestion for NOT_FOUND', () => {
        const error = makeAgentError({ type: 'NOT_FOUND' as const });
        const result = generateRecoverySuggestion(error);
        expect(result).toContain('search for something similar');
      });

      it('should return suggestion for PERMISSION_DENIED', () => {
        const error = makeAgentError({ type: 'PERMISSION_DENIED' as const });
        const result = generateRecoverySuggestion(error);
        expect(result).toContain('Settings');
      });

      it('should replace {max} in LIMIT_EXCEEDED suggestion', () => {
        const error = makeAgentError({ type: 'LIMIT_EXCEEDED' as const });
        const result = generateRecoverySuggestion(error, { max: '10' });
        expect(result).toContain('10');
        expect(result).not.toContain('{max}');
      });

      it('should replace {field} in INVALID_INPUT suggestion', () => {
        const error = makeAgentError({ type: 'INVALID_INPUT' as const });
        const result = generateRecoverySuggestion(error, { field: 'title' });
        expect(result).toContain('title');
      });

      it('should return retry message for CONFLICT', () => {
        const error = makeAgentError({ type: 'CONFLICT' as const });
        const result = generateRecoverySuggestion(error);
        expect(result).toContain('re-read');
      });

      it('should return queue message for NETWORK', () => {
        const error = makeAgentError({ type: 'NETWORK' as const });
        const result = generateRecoverySuggestion(error);
        expect(result).toContain('queue');
      });

      it('should return default message for unknown types', () => {
        // Force a type that does not exist in the templates
        const error = { ...makeAgentError(), type: 'UNKNOWN' as never };
        const result = generateRecoverySuggestion(error as NeasAgentError);
        expect(result).toBe('Please try again or rephrase your request.');
      });
    });

    describe('createErrorExplanation', () => {
      it('should combine user_message and suggestion', () => {
        const error = makeAgentError({ type: 'NOT_FOUND' as const });
        const explanation = createErrorExplanation(error, { target: 'the note' });
        expect(explanation.user_message).toBeDefined();
        expect(explanation.suggestion).toBeDefined();
        expect(explanation.original_error).toEqual(error);
      });

      it('should include original error', () => {
        const error = makeAgentError();
        const explanation = createErrorExplanation(error);
        expect(explanation.original_error).toBe(error);
      });

      it('should have user_message from generateUserExplanation', () => {
        const error = makeAgentError({ type: 'NETWORK' as const });
        const explanation = createErrorExplanation(error);
        const expectedMsg = generateUserExplanation(error);
        expect(explanation.user_message).toBe(expectedMsg);
      });

      it('should have suggestion from generateRecoverySuggestion', () => {
        const error = makeAgentError({ type: 'CONFLICT' as const });
        const explanation = createErrorExplanation(error);
        const expectedSuggestion = generateRecoverySuggestion(error);
        expect(explanation.suggestion).toBe(expectedSuggestion);
      });
    });
  });

  // ============================================================
  // INTENT ASSESSMENT FUNCTION TESTS
  // ============================================================

  describe('Intent Assessment Functions', () => {
    describe('assessCertainty', () => {
      it('should return high when has_specific_target AND has_clear_action', () => {
        expect(assessCertainty({
          has_specific_target: true,
          has_clear_action: true,
          matches_prior_pattern: false,
          unambiguous_scope: false,
        })).toBe('high');
      });

      it('should return high even with other factors true', () => {
        expect(assessCertainty({
          has_specific_target: true,
          has_clear_action: true,
          matches_prior_pattern: true,
          unambiguous_scope: true,
        })).toBe('high');
      });

      it('should return medium when matches_prior_pattern is true', () => {
        expect(assessCertainty({
          has_specific_target: false,
          has_clear_action: false,
          matches_prior_pattern: true,
          unambiguous_scope: false,
        })).toBe('medium');
      });

      it('should return medium when unambiguous_scope is true', () => {
        expect(assessCertainty({
          has_specific_target: false,
          has_clear_action: false,
          matches_prior_pattern: false,
          unambiguous_scope: true,
        })).toBe('medium');
      });

      it('should return medium when has_specific_target but not has_clear_action with pattern', () => {
        expect(assessCertainty({
          has_specific_target: true,
          has_clear_action: false,
          matches_prior_pattern: true,
          unambiguous_scope: false,
        })).toBe('medium');
      });

      it('should return low when no factors are true', () => {
        expect(assessCertainty({
          has_specific_target: false,
          has_clear_action: false,
          matches_prior_pattern: false,
          unambiguous_scope: false,
        })).toBe('low');
      });

      it('should return low when only has_clear_action is true', () => {
        expect(assessCertainty({
          has_specific_target: false,
          has_clear_action: true,
          matches_prior_pattern: false,
          unambiguous_scope: false,
        })).toBe('low');
      });

      it('should return low when only has_specific_target is true (no clear action)', () => {
        expect(assessCertainty({
          has_specific_target: true,
          has_clear_action: false,
          matches_prior_pattern: false,
          unambiguous_scope: false,
        })).toBe('low');
      });
    });

    describe('assessImpact', () => {
      it('should return high when is_destructive', () => {
        expect(assessImpact({
          is_destructive: true,
          affects_many: false,
          is_reversible: true,
          estimated_cost: 0,
        })).toBe('high');
      });

      it('should return high when affects_many', () => {
        expect(assessImpact({
          is_destructive: false,
          affects_many: true,
          is_reversible: true,
          estimated_cost: 0,
        })).toBe('high');
      });

      it('should return high when both destructive and affects_many', () => {
        expect(assessImpact({
          is_destructive: true,
          affects_many: true,
          is_reversible: false,
          estimated_cost: 100,
        })).toBe('high');
      });

      it('should return medium when cost exceeds default threshold (10)', () => {
        expect(assessImpact({
          is_destructive: false,
          affects_many: false,
          is_reversible: true,
          estimated_cost: 11,
        })).toBe('medium');
      });

      it('should return low when cost equals threshold (not greater)', () => {
        expect(assessImpact({
          is_destructive: false,
          affects_many: false,
          is_reversible: true,
          estimated_cost: 10,
        })).toBe('low');
      });

      it('should return low when cost is below threshold', () => {
        expect(assessImpact({
          is_destructive: false,
          affects_many: false,
          is_reversible: true,
          estimated_cost: 5,
        })).toBe('low');
      });

      it('should use custom credit threshold when provided', () => {
        expect(assessImpact({
          is_destructive: false,
          affects_many: false,
          is_reversible: true,
          estimated_cost: 6,
        }, 5)).toBe('medium');
      });

      it('should return low when cost equals custom threshold', () => {
        expect(assessImpact({
          is_destructive: false,
          affects_many: false,
          is_reversible: true,
          estimated_cost: 5,
        }, 5)).toBe('low');
      });

      it('should return low with zero cost', () => {
        expect(assessImpact({
          is_destructive: false,
          affects_many: false,
          is_reversible: true,
          estimated_cost: 0,
        })).toBe('low');
      });
    });

    describe('determineAction', () => {
      it('should return act for high certainty regardless of impact', () => {
        expect(determineAction('high', 'low')).toBe('act');
        expect(determineAction('high', 'medium')).toBe('act');
        expect(determineAction('high', 'high')).toBe('act');
      });

      it('should return act for medium certainty + low impact', () => {
        expect(determineAction('medium', 'low')).toBe('act');
      });

      it('should return act_then_clarify for medium certainty + medium impact', () => {
        expect(determineAction('medium', 'medium')).toBe('act_then_clarify');
      });

      it('should return clarify_first for medium certainty + high impact', () => {
        expect(determineAction('medium', 'high')).toBe('clarify_first');
      });

      it('should return act_then_clarify for low certainty + low impact', () => {
        expect(determineAction('low', 'low')).toBe('act_then_clarify');
      });

      it('should return clarify_first for low certainty + medium impact', () => {
        expect(determineAction('low', 'medium')).toBe('clarify_first');
      });

      it('should return clarify_first for low certainty + high impact', () => {
        expect(determineAction('low', 'high')).toBe('clarify_first');
      });
    });

    describe('assessIntent', () => {
      it('should combine certainty, impact, and action correctly', () => {
        const result = assessIntent(
          { has_specific_target: true, has_clear_action: true, matches_prior_pattern: false, unambiguous_scope: false },
          { is_destructive: false, affects_many: false, is_reversible: true, estimated_cost: 1 },
        );
        expect(result.certainty).toBe('high');
        expect(result.impact).toBe('low');
        expect(result.action).toBe('act');
      });

      it('should return clarify_first for low certainty + high impact', () => {
        const result = assessIntent(
          { has_specific_target: false, has_clear_action: false, matches_prior_pattern: false, unambiguous_scope: false },
          { is_destructive: true, affects_many: false, is_reversible: false, estimated_cost: 50 },
        );
        expect(result.certainty).toBe('low');
        expect(result.impact).toBe('high');
        expect(result.action).toBe('clarify_first');
      });

      it('should return act_then_clarify for medium certainty + medium impact', () => {
        const result = assessIntent(
          { has_specific_target: false, has_clear_action: false, matches_prior_pattern: true, unambiguous_scope: false },
          { is_destructive: false, affects_many: false, is_reversible: true, estimated_cost: 15 },
        );
        expect(result.certainty).toBe('medium');
        expect(result.impact).toBe('medium');
        expect(result.action).toBe('act_then_clarify');
      });
    });

    describe('shouldClarifyFirst', () => {
      it('should return true when action is clarify_first', () => {
        expect(shouldClarifyFirst({ certainty: 'low', impact: 'high', action: 'clarify_first' })).toBe(true);
      });

      it('should return false when action is act', () => {
        expect(shouldClarifyFirst({ certainty: 'high', impact: 'low', action: 'act' })).toBe(false);
      });

      it('should return false when action is act_then_clarify', () => {
        expect(shouldClarifyFirst({ certainty: 'low', impact: 'low', action: 'act_then_clarify' })).toBe(false);
      });
    });

    describe('shouldActThenClarify', () => {
      it('should return true when action is act_then_clarify', () => {
        expect(shouldActThenClarify({ certainty: 'medium', impact: 'medium', action: 'act_then_clarify' })).toBe(true);
      });

      it('should return false when action is act', () => {
        expect(shouldActThenClarify({ certainty: 'high', impact: 'low', action: 'act' })).toBe(false);
      });

      it('should return false when action is clarify_first', () => {
        expect(shouldActThenClarify({ certainty: 'low', impact: 'high', action: 'clarify_first' })).toBe(false);
      });
    });
  });

  // ============================================================
  // AGENT CONFIG FUNCTION TESTS
  // ============================================================

  describe('Agent Configuration Functions', () => {
    describe('createDefaultAgentDefaults', () => {
      it('should return _schemaVersion 1', () => {
        const defaults = createDefaultAgentDefaults();
        expect(defaults._schemaVersion).toBe(1);
      });

      it('should have all default values', () => {
        const defaults = createDefaultAgentDefaults();
        expect(defaults.response_verbosity).toBe('balanced');
        expect(defaults.show_reasoning).toBe(false);
        expect(defaults.auto_search_before_action).toBe(true);
        expect(defaults.auto_show_related).toBe(true);
        expect(defaults.auto_suggest_links).toBe(false);
        expect(defaults.confirm_threshold_items).toBe(10);
        expect(defaults.confirm_threshold_credits).toBe(15);
        expect(defaults.confirm_destructive).toBe(true);
        expect(defaults.uncertainty_response).toBe('ask');
        expect(defaults.default_search_scope).toBe('all');
        expect(defaults.default_time_range_days).toBe(30);
      });

      it('should return a new copy each time (deep copy)', () => {
        const a = createDefaultAgentDefaults();
        const b = createDefaultAgentDefaults();
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
      });

      it('should not be affected by mutations', () => {
        const a = createDefaultAgentDefaults();
        a.response_verbosity = 'terse';
        const b = createDefaultAgentDefaults();
        expect(b.response_verbosity).toBe('balanced');
      });
    });

    describe('createDefaultAgentPermissions', () => {
      it('should return _schemaVersion 1', () => {
        const perms = createDefaultAgentPermissions();
        expect(perms._schemaVersion).toBe(1);
      });

      it('should have safe defaults', () => {
        const perms = createDefaultAgentPermissions();
        expect(perms.can_read).toBe(true);
        expect(perms.can_write).toBe(true);
        expect(perms.can_auto_operations).toBe(true);
        expect(perms.can_delete).toBe(false);
        expect(perms.can_bulk_operations).toBe(false);
      });

      it('should return a new copy each time', () => {
        const a = createDefaultAgentPermissions();
        const b = createDefaultAgentPermissions();
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
      });
    });

    describe('createDefaultAgentLimits', () => {
      it('should return a copy of default limits', () => {
        const limits = createDefaultAgentLimits();
        expect(limits.max_operations_per_request).toBe(100);
        expect(limits.max_credits_per_request).toBe(30);
        expect(limits.preview_threshold).toBe(10);
        expect(limits.context_batch_size).toBe(50);
      });

      it('should return a new copy each time', () => {
        const a = createDefaultAgentLimits();
        const b = createDefaultAgentLimits();
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
      });

      it('should not be affected by mutations', () => {
        const a = createDefaultAgentLimits();
        a.max_operations_per_request = 999;
        const b = createDefaultAgentLimits();
        expect(b.max_operations_per_request).toBe(100);
      });
    });

    describe('mergeAgentDefaults', () => {
      it('should apply overrides to base', () => {
        const base = createDefaultAgentDefaults();
        const merged = mergeAgentDefaults(base, { response_verbosity: 'terse' });
        expect(merged.response_verbosity).toBe('terse');
      });

      it('should preserve _schemaVersion from base', () => {
        const base = createDefaultAgentDefaults();
        const merged = mergeAgentDefaults(base, { response_verbosity: 'detailed' });
        expect(merged._schemaVersion).toBe(1);
      });

      it('should not mutate the base object', () => {
        const base = createDefaultAgentDefaults();
        const originalVerbosity = base.response_verbosity;
        mergeAgentDefaults(base, { response_verbosity: 'detailed' });
        expect(base.response_verbosity).toBe(originalVerbosity);
      });

      it('should preserve non-overridden values', () => {
        const base = createDefaultAgentDefaults();
        const merged = mergeAgentDefaults(base, { show_reasoning: true });
        expect(merged.response_verbosity).toBe('balanced');
        expect(merged.show_reasoning).toBe(true);
        expect(merged.auto_search_before_action).toBe(true);
      });

      it('should allow overriding multiple values at once', () => {
        const base = createDefaultAgentDefaults();
        const merged = mergeAgentDefaults(base, {
          response_verbosity: 'detailed',
          show_reasoning: true,
          default_time_range_days: 7,
        });
        expect(merged.response_verbosity).toBe('detailed');
        expect(merged.show_reasoning).toBe(true);
        expect(merged.default_time_range_days).toBe(7);
      });

      it('should handle empty overrides', () => {
        const base = createDefaultAgentDefaults();
        const merged = mergeAgentDefaults(base, {});
        expect(merged).toEqual(base);
      });
    });

    describe('isToolAllowedByPermissions', () => {
      it('should always allow view_node (always_on)', () => {
        expect(isToolAllowedByPermissions('view_node', makePermissions({ can_write: false }))).toBe(true);
      });

      it('should always allow search (always_on)', () => {
        expect(isToolAllowedByPermissions('search', makePermissions({ can_write: false }))).toBe(true);
      });

      it('should allow create_node when can_write is true', () => {
        expect(isToolAllowedByPermissions('create_node', makePermissions({ can_write: true }))).toBe(true);
      });

      it('should deny create_node when can_write is false', () => {
        expect(isToolAllowedByPermissions('create_node', makePermissions({ can_write: false }))).toBe(false);
      });

      it('should allow update_node when can_write is true', () => {
        expect(isToolAllowedByPermissions('update_node', makePermissions({ can_write: true }))).toBe(true);
      });

      it('should deny update_node when can_write is false', () => {
        expect(isToolAllowedByPermissions('update_node', makePermissions({ can_write: false }))).toBe(false);
      });

      it('should allow delete_node when can_delete is true', () => {
        expect(isToolAllowedByPermissions('delete_node', makePermissions({ can_delete: true }))).toBe(true);
      });

      it('should deny delete_node when can_delete is false', () => {
        expect(isToolAllowedByPermissions('delete_node', makePermissions({ can_delete: false }))).toBe(false);
      });

      it('should allow bulk_operations when can_bulk_operations is true', () => {
        expect(isToolAllowedByPermissions('bulk_operations', makePermissions({ can_bulk_operations: true }))).toBe(true);
      });

      it('should deny bulk_operations when can_bulk_operations is false', () => {
        expect(isToolAllowedByPermissions('bulk_operations', makePermissions({ can_bulk_operations: false }))).toBe(false);
      });

      it('should allow create_edge when can_write is true', () => {
        expect(isToolAllowedByPermissions('create_edge', makePermissions({ can_write: true }))).toBe(true);
      });

      it('should allow delete_edge when can_write is true', () => {
        expect(isToolAllowedByPermissions('delete_edge', makePermissions({ can_write: true }))).toBe(true);
      });

      it('should allow link_to_cluster when can_write is true', () => {
        expect(isToolAllowedByPermissions('link_to_cluster', makePermissions({ can_write: true }))).toBe(true);
      });
    });

    describe('getEffectiveConfirmationLevel', () => {
      it('should return denied result when tool is not allowed', () => {
        const perms = makePermissions({ can_write: false });
        const defaults = makeDefaults();
        const result = getEffectiveConfirmationLevel('create_node', perms, defaults, {});
        expect(result.allowed).toBe(false);
        expect(result.denied_reason).toBeDefined();
        expect(result.effective_confirmation).toBe('confirm');
      });

      it('should return allowed for always_on tools', () => {
        const perms = makePermissions({ can_write: false });
        const defaults = makeDefaults();
        const result = getEffectiveConfirmationLevel('view_node', perms, defaults, {});
        expect(result.allowed).toBe(true);
        expect(result.effective_confirmation).toBe('none');
      });

      it('should return ATSS confirmation level when allowed', () => {
        const perms = makePermissions();
        const defaults = makeDefaults();
        const result = getEffectiveConfirmationLevel('create_node', perms, defaults, {});
        expect(result.allowed).toBe(true);
        expect(result.effective_confirmation).toBe('inform');
      });

      it('should upgrade to confirm for destructive tools when confirm_destructive is true', () => {
        const perms = makePermissions({ can_delete: true });
        const defaults = makeDefaults({ confirm_destructive: true });
        const result = getEffectiveConfirmationLevel('delete_node', perms, defaults, {});
        expect(result.allowed).toBe(true);
        expect(result.effective_confirmation).toBe('confirm');
      });

      it('should include permission_tier in result', () => {
        const perms = makePermissions();
        const defaults = makeDefaults();
        const result = getEffectiveConfirmationLevel('search', perms, defaults, {});
        expect(result.permission_tier).toBe('always_on');
      });

      it('should return on_by_default tier for create_node', () => {
        const perms = makePermissions();
        const defaults = makeDefaults();
        const result = getEffectiveConfirmationLevel('create_node', perms, defaults, {});
        expect(result.permission_tier).toBe('on_by_default');
      });

      it('should return off_by_default tier for delete_node', () => {
        const perms = makePermissions({ can_delete: true });
        const defaults = makeDefaults();
        const result = getEffectiveConfirmationLevel('delete_node', perms, defaults, {});
        expect(result.permission_tier).toBe('off_by_default');
      });
    });

    describe('createAgentSession', () => {
      it('should have _schemaVersion 1', () => {
        const session = createAgentSession('user_abc');
        expect(session._schemaVersion).toBe(1);
      });

      it('should generate an id starting with ses_', () => {
        const session = createAgentSession('user_abc');
        expect(session.id.startsWith('ses_')).toBe(true);
      });

      it('should generate a 16-character id', () => {
        const session = createAgentSession('user_abc');
        expect(session.id).toHaveLength(16);
      });

      it('should store the user_id', () => {
        const session = createAgentSession('user_xyz');
        expect(session.user_id).toBe('user_xyz');
      });

      it('should have a valid ISO 8601 started_at timestamp', () => {
        const session = createAgentSession('user_abc');
        expect(() => new Date(session.started_at)).not.toThrow();
        expect(new Date(session.started_at).toISOString()).toBe(session.started_at);
      });

      it('should start with 0 operations', () => {
        const session = createAgentSession('user_abc');
        expect(session.operations_count).toBe(0);
      });

      it('should start with 0 credits spent', () => {
        const session = createAgentSession('user_abc');
        expect(session.credits_spent).toBe(0);
      });

      it('should start with empty action_log', () => {
        const session = createAgentSession('user_abc');
        expect(session.action_log).toEqual([]);
      });

      it('should generate unique session ids', () => {
        const ids = new Set(Array.from({ length: 50 }, () => createAgentSession('user_abc').id));
        expect(ids.size).toBe(50);
      });
    });

    describe('recordSessionOperation', () => {
      it('should increment operations_count', () => {
        const session = createAgentSession('user_abc');
        const updated = recordSessionOperation(session, 'create_node', 3, 'undo_abc123def456');
        expect(updated.operations_count).toBe(1);
      });

      it('should add to credits_spent', () => {
        const session = createAgentSession('user_abc');
        const updated = recordSessionOperation(session, 'create_node', 3, 'undo_abc123def456');
        expect(updated.credits_spent).toBe(3);
      });

      it('should append to action_log', () => {
        const session = createAgentSession('user_abc');
        const updated = recordSessionOperation(session, 'create_node', 3, 'undo_abc123def456');
        expect(updated.action_log).toHaveLength(1);
        expect(updated.action_log[0].tool).toBe('create_node');
        expect(updated.action_log[0].credit_cost).toBe(3);
        expect(updated.action_log[0].atss_undo_entry_id).toBe('undo_abc123def456');
      });

      it('should not mutate the original session (immutable)', () => {
        const session = createAgentSession('user_abc');
        const updated = recordSessionOperation(session, 'create_node', 3, 'undo_abc123def456');
        expect(session.operations_count).toBe(0);
        expect(session.credits_spent).toBe(0);
        expect(session.action_log).toHaveLength(0);
        expect(updated).not.toBe(session);
      });

      it('should handle null undo entry for read operations', () => {
        const session = createAgentSession('user_abc');
        const updated = recordSessionOperation(session, 'view_node', 0, null);
        expect(updated.action_log[0].atss_undo_entry_id).toBeNull();
        expect(updated.credits_spent).toBe(0);
      });

      it('should accumulate multiple operations', () => {
        let session = createAgentSession('user_abc');
        session = recordSessionOperation(session, 'create_node', 3, 'undo_1');
        session = recordSessionOperation(session, 'create_edge', 1, 'undo_2');
        session = recordSessionOperation(session, 'view_node', 0, null);
        expect(session.operations_count).toBe(3);
        expect(session.credits_spent).toBe(4);
        expect(session.action_log).toHaveLength(3);
      });

      it('should add timestamps to each action', () => {
        const session = createAgentSession('user_abc');
        const updated = recordSessionOperation(session, 'search', 0, null);
        expect(updated.action_log[0].timestamp).toBeDefined();
        expect(() => new Date(updated.action_log[0].timestamp)).not.toThrow();
      });
    });

    describe('canPerformOperation', () => {
      it('should allow operations within limits', () => {
        const session = createAgentSession('user_abc');
        const limits = makeLimits();
        const result = canPerformOperation(session, limits, 5);
        expect(result.allowed).toBe(true);
        expect(result.remaining_operations).toBe(99);
        expect(result.remaining_credits).toBe(25);
      });

      it('should deny when operations limit reached', () => {
        const session: NeasAgentSession = {
          _schemaVersion: 1,
          id: 'ses_test12345678',
          user_id: 'user_abc',
          started_at: new Date().toISOString(),
          operations_count: 100,
          credits_spent: 0,
          action_log: [],
        };
        const limits = makeLimits();
        const result = canPerformOperation(session, limits, 1);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Operation limit reached');
        expect(result.remaining_operations).toBe(0);
      });

      it('should deny when credit limit would be exceeded', () => {
        const session: NeasAgentSession = {
          _schemaVersion: 1,
          id: 'ses_test12345678',
          user_id: 'user_abc',
          started_at: new Date().toISOString(),
          operations_count: 5,
          credits_spent: 28,
          action_log: [],
        };
        const limits = makeLimits();
        const result = canPerformOperation(session, limits, 5);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Credit limit');
      });

      it('should allow when exactly at credit limit', () => {
        const session: NeasAgentSession = {
          _schemaVersion: 1,
          id: 'ses_test12345678',
          user_id: 'user_abc',
          started_at: new Date().toISOString(),
          operations_count: 5,
          credits_spent: 27,
          action_log: [],
        };
        const limits = makeLimits();
        const result = canPerformOperation(session, limits, 3);
        expect(result.allowed).toBe(true);
        expect(result.remaining_credits).toBe(0);
      });

      it('should allow zero-cost operations even near credit limit', () => {
        const session: NeasAgentSession = {
          _schemaVersion: 1,
          id: 'ses_test12345678',
          user_id: 'user_abc',
          started_at: new Date().toISOString(),
          operations_count: 5,
          credits_spent: 30,
          action_log: [],
        };
        const limits = makeLimits();
        const result = canPerformOperation(session, limits, 0);
        expect(result.allowed).toBe(true);
      });

      it('should provide correct remaining values', () => {
        const session: NeasAgentSession = {
          _schemaVersion: 1,
          id: 'ses_test12345678',
          user_id: 'user_abc',
          started_at: new Date().toISOString(),
          operations_count: 50,
          credits_spent: 15,
          action_log: [],
        };
        const limits = makeLimits();
        const result = canPerformOperation(session, limits, 5);
        expect(result.allowed).toBe(true);
        expect(result.remaining_operations).toBe(49);
        expect(result.remaining_credits).toBe(10);
      });
    });

    describe('getSessionSummary', () => {
      it('should return correct totals for empty session', () => {
        const session = createAgentSession('user_abc');
        const summary = getSessionSummary(session);
        expect(summary.total_operations).toBe(0);
        expect(summary.total_credits).toBe(0);
        expect(summary.tools_used).toEqual({});
      });

      it('should count tools_used from action_log', () => {
        let session = createAgentSession('user_abc');
        session = recordSessionOperation(session, 'create_node', 3, 'undo_1');
        session = recordSessionOperation(session, 'create_node', 3, 'undo_2');
        session = recordSessionOperation(session, 'search', 0, null);
        const summary = getSessionSummary(session);
        expect(summary.tools_used).toEqual({
          create_node: 2,
          search: 1,
        });
      });

      it('should return correct total_operations and total_credits', () => {
        let session = createAgentSession('user_abc');
        session = recordSessionOperation(session, 'create_node', 3, 'undo_1');
        session = recordSessionOperation(session, 'create_edge', 1, 'undo_2');
        const summary = getSessionSummary(session);
        expect(summary.total_operations).toBe(2);
        expect(summary.total_credits).toBe(4);
      });

      it('should have non-negative duration_ms', () => {
        const session = createAgentSession('user_abc');
        const summary = getSessionSummary(session);
        expect(summary.duration_ms).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ============================================================
  // OFFLINE & SUGGESTION FUNCTION TESTS
  // ============================================================

  describe('Offline & Suggestion Functions', () => {
    describe('getAvailableTools', () => {
      it('should return all 9 tools when online', () => {
        const tools = getAvailableTools(true);
        expect(tools).toHaveLength(9);
        for (const tool of ATSS_TOOL_NAMES) {
          expect(tools).toContain(tool);
        }
      });

      it('should return only 2 tools when offline', () => {
        const tools = getAvailableTools(false);
        expect(tools).toHaveLength(2);
        expect(tools).toContain('view_node');
        expect(tools).toContain('search');
      });

      it('should not include write tools when offline', () => {
        const tools = getAvailableTools(false);
        expect(tools).not.toContain('create_node');
        expect(tools).not.toContain('update_node');
        expect(tools).not.toContain('delete_node');
      });
    });

    describe('isToolAvailableOffline', () => {
      it('should return true for view_node', () => {
        expect(isToolAvailableOffline('view_node')).toBe(true);
      });

      it('should return true for search', () => {
        expect(isToolAvailableOffline('search')).toBe(true);
      });

      it('should return false for create_node', () => {
        expect(isToolAvailableOffline('create_node')).toBe(false);
      });

      it('should return false for update_node', () => {
        expect(isToolAvailableOffline('update_node')).toBe(false);
      });

      it('should return false for delete_node', () => {
        expect(isToolAvailableOffline('delete_node')).toBe(false);
      });

      it('should return false for create_edge', () => {
        expect(isToolAvailableOffline('create_edge')).toBe(false);
      });

      it('should return false for delete_edge', () => {
        expect(isToolAvailableOffline('delete_edge')).toBe(false);
      });

      it('should return false for link_to_cluster', () => {
        expect(isToolAvailableOffline('link_to_cluster')).toBe(false);
      });

      it('should return false for bulk_operations', () => {
        expect(isToolAvailableOffline('bulk_operations')).toBe(false);
      });
    });

    describe('getOfflineCapabilities', () => {
      it('should return read_only true', () => {
        const caps = getOfflineCapabilities();
        expect(caps.read_only).toBe(true);
      });

      it('should return cached_suggestions_available true', () => {
        const caps = getOfflineCapabilities();
        expect(caps.cached_suggestions_available).toBe(true);
      });

      it('should return correct available_tools', () => {
        const caps = getOfflineCapabilities();
        expect(caps.available_tools).toHaveLength(2);
        expect(caps.available_tools).toContain('view_node');
        expect(caps.available_tools).toContain('search');
      });
    });

    describe('createDefaultSuggestionConfig', () => {
      it('should return _schemaVersion 1', () => {
        const config = createDefaultSuggestionConfig();
        expect(config._schemaVersion).toBe(1);
      });

      it('should have mode off', () => {
        const config = createDefaultSuggestionConfig();
        expect(config.mode).toBe('off');
      });

      it('should have max_per_day 1', () => {
        const config = createDefaultSuggestionConfig();
        expect(config.max_per_day).toBe(1);
      });

      it('should have min_confidence 0.9', () => {
        const config = createDefaultSuggestionConfig();
        expect(config.min_confidence).toBe(0.9);
      });

      it('should have quiet_hours_start 22', () => {
        const config = createDefaultSuggestionConfig();
        expect(config.quiet_hours_start).toBe(22);
      });

      it('should have quiet_hours_end 8', () => {
        const config = createDefaultSuggestionConfig();
        expect(config.quiet_hours_end).toBe(8);
      });

      it('should return a new copy each time', () => {
        const a = createDefaultSuggestionConfig();
        const b = createDefaultSuggestionConfig();
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
      });
    });

    describe('shouldShowSuggestion', () => {
      it('should return false when mode is off', () => {
        const config = makeSuggestionConfig({ mode: 'off' as const });
        expect(shouldShowSuggestion(config, null, 0.95, 12)).toBe(false);
      });

      it('should return true when mode is all and all conditions met', () => {
        const config = makeSuggestionConfig({ mode: 'all' as const });
        expect(shouldShowSuggestion(config, null, 0.5, 12)).toBe(true);
      });

      it('should return false for important_only mode when confidence below threshold', () => {
        const config = makeSuggestionConfig({ mode: 'important_only' as const, min_confidence: 0.9 });
        expect(shouldShowSuggestion(config, null, 0.85, 12)).toBe(false);
      });

      it('should return true for important_only mode when confidence meets threshold', () => {
        const config = makeSuggestionConfig({ mode: 'important_only' as const, min_confidence: 0.9 });
        expect(shouldShowSuggestion(config, null, 0.95, 12)).toBe(true);
      });

      it('should return false during quiet hours', () => {
        const config = makeSuggestionConfig({ mode: 'all' as const, quiet_hours_start: 22, quiet_hours_end: 8 });
        expect(shouldShowSuggestion(config, null, 0.95, 23)).toBe(false);
      });

      it('should return false during quiet hours (early morning)', () => {
        const config = makeSuggestionConfig({ mode: 'all' as const, quiet_hours_start: 22, quiet_hours_end: 8 });
        expect(shouldShowSuggestion(config, null, 0.95, 3)).toBe(false);
      });

      it('should return true outside quiet hours', () => {
        const config = makeSuggestionConfig({ mode: 'all' as const });
        expect(shouldShowSuggestion(config, null, 0.95, 14)).toBe(true);
      });

      it('should return false when daily limit reached (same day)', () => {
        const config = makeSuggestionConfig({ mode: 'all' as const, max_per_day: 1 });
        const today = new Date().toISOString();
        expect(shouldShowSuggestion(config, today, 0.95, 12)).toBe(false);
      });
    });

    describe('isInQuietHours', () => {
      it('should return true for hour within wraparound range (late night)', () => {
        expect(isInQuietHours(23, 22, 8)).toBe(true);
      });

      it('should return true for hour within wraparound range (early morning)', () => {
        expect(isInQuietHours(3, 22, 8)).toBe(true);
      });

      it('should return true at start of quiet hours', () => {
        expect(isInQuietHours(22, 22, 8)).toBe(true);
      });

      it('should return false at end of quiet hours (boundary)', () => {
        expect(isInQuietHours(8, 22, 8)).toBe(false);
      });

      it('should return false during daytime', () => {
        expect(isInQuietHours(14, 22, 8)).toBe(false);
      });

      it('should handle normal (non-wraparound) range', () => {
        expect(isInQuietHours(12, 9, 17)).toBe(true);
        expect(isInQuietHours(8, 9, 17)).toBe(false);
        expect(isInQuietHours(17, 9, 17)).toBe(false);
      });

      it('should return false when start equals end (no quiet hours)', () => {
        expect(isInQuietHours(12, 12, 12)).toBe(false);
      });

      it('should handle midnight boundary', () => {
        expect(isInQuietHours(0, 22, 8)).toBe(true);
      });

      it('should return false for hour just before wraparound start', () => {
        expect(isInQuietHours(21, 22, 8)).toBe(false);
      });
    });

    describe('canSuggestToday', () => {
      it('should return true when lastSuggestionAt is null (never suggested)', () => {
        expect(canSuggestToday(null, 1, '2025-01-15')).toBe(true);
      });

      it('should return true when last suggestion was on a different day', () => {
        expect(canSuggestToday('2025-01-14T10:00:00Z', 1, '2025-01-15')).toBe(true);
      });

      it('should return false when last suggestion was today', () => {
        expect(canSuggestToday('2025-01-15T10:00:00Z', 1, '2025-01-15')).toBe(false);
      });

      it('should return false when maxPerDay is 0', () => {
        expect(canSuggestToday(null, 0, '2025-01-15')).toBe(false);
      });

      it('should return false when maxPerDay is negative', () => {
        expect(canSuggestToday(null, -1, '2025-01-15')).toBe(false);
      });

      it('should handle ISO timestamp with time zone correctly', () => {
        expect(canSuggestToday('2025-01-15T23:59:59.999Z', 1, '2025-01-15')).toBe(false);
      });
    });
  });

  // ============================================================
  // ZOD SCHEMA VALIDATION TESTS
  // ============================================================

  describe('Zod Schema Validation', () => {
    describe('Enum Schemas', () => {
      it('should validate NeasErrorTypeSchema', () => {
        expect(NeasErrorTypeSchema.safeParse('NOT_FOUND').success).toBe(true);
        expect(NeasErrorTypeSchema.safeParse('INVALID').success).toBe(false);
      });

      it('should validate NeasCertaintyLevelSchema', () => {
        expect(NeasCertaintyLevelSchema.safeParse('high').success).toBe(true);
        expect(NeasCertaintyLevelSchema.safeParse('very_high').success).toBe(false);
      });

      it('should validate NeasImpactLevelSchema', () => {
        expect(NeasImpactLevelSchema.safeParse('low').success).toBe(true);
        expect(NeasImpactLevelSchema.safeParse('critical').success).toBe(false);
      });

      it('should validate NeasClarificationActionSchema', () => {
        expect(NeasClarificationActionSchema.safeParse('act').success).toBe(true);
        expect(NeasClarificationActionSchema.safeParse('skip').success).toBe(false);
      });

      it('should validate NeasResponseVerbositySchema', () => {
        expect(NeasResponseVerbositySchema.safeParse('balanced').success).toBe(true);
        expect(NeasResponseVerbositySchema.safeParse('verbose').success).toBe(false);
      });

      it('should validate NeasSuggestionModeSchema', () => {
        expect(NeasSuggestionModeSchema.safeParse('off').success).toBe(true);
        expect(NeasSuggestionModeSchema.safeParse('auto').success).toBe(false);
      });

      it('should validate NeasPermissionTierSchema', () => {
        expect(NeasPermissionTierSchema.safeParse('always_on').success).toBe(true);
        expect(NeasPermissionTierSchema.safeParse('admin').success).toBe(false);
      });
    });

    describe('NeasFixStrategyConfigSchema', () => {
      it('should accept valid fix strategy', () => {
        const result = NeasFixStrategyConfigSchema.safeParse({
          retry_automatically: false,
          description: 'Test strategy',
        });
        expect(result.success).toBe(true);
      });

      it('should reject missing fields', () => {
        expect(NeasFixStrategyConfigSchema.safeParse({}).success).toBe(false);
        expect(NeasFixStrategyConfigSchema.safeParse({ retry_automatically: true }).success).toBe(false);
      });
    });

    describe('NeasToolCallSchema', () => {
      it('should accept valid tool call', () => {
        const result = NeasToolCallSchema.safeParse({
          tool: 'view_node',
          params: { node_ids: ['n_123'] },
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid tool name', () => {
        const result = NeasToolCallSchema.safeParse({
          tool: 'invalid_tool',
          params: {},
        });
        expect(result.success).toBe(false);
      });

      it('should accept empty params', () => {
        const result = NeasToolCallSchema.safeParse({
          tool: 'search',
          params: {},
        });
        expect(result.success).toBe(true);
      });
    });

    describe('NeasAgentErrorSchema', () => {
      it('should accept valid agent error', () => {
        const result = NeasAgentErrorSchema.safeParse({
          type: 'NOT_FOUND',
          message: 'Node not found',
          original_action: { tool: 'view_node', params: {} },
          atss_error_code: 'E404_NODE_NOT_FOUND',
          recovery_attempted: false,
        });
        expect(result.success).toBe(true);
      });

      it('should accept error with recovery_result', () => {
        const result = NeasAgentErrorSchema.safeParse({
          type: 'CONFLICT',
          message: 'Conflict',
          original_action: { tool: 'update_node', params: {} },
          atss_error_code: 'E409_DUPLICATE_EDGE',
          recovery_attempted: true,
          recovery_result: 'success',
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid error type', () => {
        const result = NeasAgentErrorSchema.safeParse({
          type: 'UNKNOWN_TYPE',
          message: 'Error',
          original_action: { tool: 'search', params: {} },
          atss_error_code: 'E500_INTERNAL',
          recovery_attempted: false,
        });
        expect(result.success).toBe(false);
      });

      it('should reject invalid recovery_result', () => {
        const result = NeasAgentErrorSchema.safeParse({
          type: 'NETWORK',
          message: 'Error',
          original_action: { tool: 'search', params: {} },
          atss_error_code: 'E500_INTERNAL',
          recovery_attempted: true,
          recovery_result: 'partial',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('NeasErrorExplanationSchema', () => {
      it('should accept valid error explanation', () => {
        const result = NeasErrorExplanationSchema.safeParse({
          user_message: 'Could not find the node.',
          suggestion: 'Try searching for something similar.',
          original_error: {
            type: 'NOT_FOUND',
            message: 'Node not found',
            original_action: { tool: 'view_node', params: {} },
            atss_error_code: 'E404_NODE_NOT_FOUND',
            recovery_attempted: false,
          },
        });
        expect(result.success).toBe(true);
      });

      it('should reject missing original_error', () => {
        const result = NeasErrorExplanationSchema.safeParse({
          user_message: 'Error',
          suggestion: 'Try again',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('NeasIntentAssessmentSchema', () => {
      it('should accept valid intent assessment', () => {
        const result = NeasIntentAssessmentSchema.safeParse({
          certainty: 'high',
          impact: 'low',
          action: 'act',
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid certainty', () => {
        const result = NeasIntentAssessmentSchema.safeParse({
          certainty: 'very_high',
          impact: 'low',
          action: 'act',
        });
        expect(result.success).toBe(false);
      });

      it('should reject invalid action', () => {
        const result = NeasIntentAssessmentSchema.safeParse({
          certainty: 'high',
          impact: 'low',
          action: 'skip',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('NeasCertaintyFactorsSchema', () => {
      it('should accept valid factors', () => {
        const result = NeasCertaintyFactorsSchema.safeParse({
          has_specific_target: true,
          has_clear_action: false,
          matches_prior_pattern: true,
          unambiguous_scope: false,
        });
        expect(result.success).toBe(true);
      });

      it('should reject missing factors', () => {
        const result = NeasCertaintyFactorsSchema.safeParse({
          has_specific_target: true,
        });
        expect(result.success).toBe(false);
      });
    });

    describe('NeasImpactFactorsSchema', () => {
      it('should accept valid factors', () => {
        const result = NeasImpactFactorsSchema.safeParse({
          is_destructive: false,
          affects_many: false,
          is_reversible: true,
          estimated_cost: 5,
        });
        expect(result.success).toBe(true);
      });

      it('should reject negative estimated_cost', () => {
        const result = NeasImpactFactorsSchema.safeParse({
          is_destructive: false,
          affects_many: false,
          is_reversible: true,
          estimated_cost: -1,
        });
        expect(result.success).toBe(false);
      });
    });

    describe('NeasAgentDefaultsSchema', () => {
      it('should accept valid defaults', () => {
        const result = NeasAgentDefaultsSchema.safeParse(createDefaultAgentDefaults());
        expect(result.success).toBe(true);
      });

      it('should reject missing _schemaVersion', () => {
        const data = { ...createDefaultAgentDefaults() } as Record<string, unknown>;
        delete data._schemaVersion;
        expect(NeasAgentDefaultsSchema.safeParse(data).success).toBe(false);
      });

      it('should reject _schemaVersion of 0', () => {
        const data = createDefaultAgentDefaults();
        (data as Record<string, unknown>)._schemaVersion = 0;
        expect(NeasAgentDefaultsSchema.safeParse(data).success).toBe(false);
      });

      it('should reject invalid response_verbosity', () => {
        const data = createDefaultAgentDefaults();
        (data as Record<string, unknown>).response_verbosity = 'verbose';
        expect(NeasAgentDefaultsSchema.safeParse(data).success).toBe(false);
      });

      it('should reject default_time_range_days over 365', () => {
        const data = createDefaultAgentDefaults();
        data.default_time_range_days = 366;
        expect(NeasAgentDefaultsSchema.safeParse(data).success).toBe(false);
      });
    });

    describe('NeasAgentPermissionsSchema', () => {
      it('should accept valid permissions', () => {
        const result = NeasAgentPermissionsSchema.safeParse(createDefaultAgentPermissions());
        expect(result.success).toBe(true);
      });

      it('should require can_read to be true (literal)', () => {
        const data = { ...createDefaultAgentPermissions(), can_read: false };
        expect(NeasAgentPermissionsSchema.safeParse(data).success).toBe(false);
      });

      it('should accept can_delete as true', () => {
        const data = { ...createDefaultAgentPermissions(), can_delete: true };
        expect(NeasAgentPermissionsSchema.safeParse(data).success).toBe(true);
      });
    });

    describe('NeasAgentLimitsSchema', () => {
      it('should accept valid limits', () => {
        const result = NeasAgentLimitsSchema.safeParse(createDefaultAgentLimits());
        expect(result.success).toBe(true);
      });

      it('should reject zero max_operations_per_request', () => {
        const data = { ...createDefaultAgentLimits(), max_operations_per_request: 0 };
        expect(NeasAgentLimitsSchema.safeParse(data).success).toBe(false);
      });

      it('should reject negative preview_threshold', () => {
        const data = { ...createDefaultAgentLimits(), preview_threshold: -1 };
        expect(NeasAgentLimitsSchema.safeParse(data).success).toBe(false);
      });
    });

    describe('NeasAgentSessionSchema', () => {
      it('should accept valid session', () => {
        const session = createAgentSession('user_abc');
        const result = NeasAgentSessionSchema.safeParse(session);
        expect(result.success).toBe(true);
      });

      it('should accept session with action_log entries', () => {
        let session = createAgentSession('user_abc');
        session = recordSessionOperation(session, 'create_node', 3, 'undo_abc123def456');
        const result = NeasAgentSessionSchema.safeParse(session);
        expect(result.success).toBe(true);
      });

      it('should reject negative operations_count', () => {
        const session = { ...createAgentSession('user_abc'), operations_count: -1 };
        expect(NeasAgentSessionSchema.safeParse(session).success).toBe(false);
      });
    });

    describe('NeasSessionActionSchema', () => {
      it('should accept valid session action', () => {
        const result = NeasSessionActionSchema.safeParse({
          tool: 'create_node',
          atss_undo_entry_id: 'undo_abc',
          timestamp: new Date().toISOString(),
          credit_cost: 3,
        });
        expect(result.success).toBe(true);
      });

      it('should accept null undo entry id', () => {
        const result = NeasSessionActionSchema.safeParse({
          tool: 'view_node',
          atss_undo_entry_id: null,
          timestamp: new Date().toISOString(),
          credit_cost: 0,
        });
        expect(result.success).toBe(true);
      });

      it('should reject negative credit_cost', () => {
        const result = NeasSessionActionSchema.safeParse({
          tool: 'create_node',
          atss_undo_entry_id: null,
          timestamp: new Date().toISOString(),
          credit_cost: -1,
        });
        expect(result.success).toBe(false);
      });
    });

    describe('NeasOperationCheckSchema', () => {
      it('should accept allowed operation', () => {
        const result = NeasOperationCheckSchema.safeParse({
          allowed: true,
          remaining_operations: 99,
          remaining_credits: 25,
        });
        expect(result.success).toBe(true);
      });

      it('should accept denied operation with reason', () => {
        const result = NeasOperationCheckSchema.safeParse({
          allowed: false,
          reason: 'Operation limit reached',
          remaining_operations: 0,
          remaining_credits: 30,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('NeasSessionSummarySchema', () => {
      it('should accept valid summary', () => {
        const result = NeasSessionSummarySchema.safeParse({
          total_operations: 5,
          total_credits: 12,
          duration_ms: 1500,
          tools_used: { create_node: 3, search: 2 },
        });
        expect(result.success).toBe(true);
      });

      it('should reject negative total_operations', () => {
        const result = NeasSessionSummarySchema.safeParse({
          total_operations: -1,
          total_credits: 0,
          duration_ms: 0,
          tools_used: {},
        });
        expect(result.success).toBe(false);
      });
    });

    describe('NeasOfflineCapabilitiesSchema', () => {
      it('should accept valid capabilities', () => {
        const result = NeasOfflineCapabilitiesSchema.safeParse({
          available_tools: ['view_node', 'search'],
          read_only: true,
          cached_suggestions_available: true,
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid tool names in available_tools', () => {
        const result = NeasOfflineCapabilitiesSchema.safeParse({
          available_tools: ['invalid_tool'],
          read_only: true,
          cached_suggestions_available: true,
        });
        expect(result.success).toBe(false);
      });
    });

    describe('NeasSuggestionConfigSchema', () => {
      it('should accept valid suggestion config', () => {
        const result = NeasSuggestionConfigSchema.safeParse(createDefaultSuggestionConfig());
        expect(result.success).toBe(true);
      });

      it('should reject min_confidence over 1', () => {
        const config = { ...createDefaultSuggestionConfig(), min_confidence: 1.5 };
        expect(NeasSuggestionConfigSchema.safeParse(config).success).toBe(false);
      });

      it('should reject min_confidence below 0', () => {
        const config = { ...createDefaultSuggestionConfig(), min_confidence: -0.1 };
        expect(NeasSuggestionConfigSchema.safeParse(config).success).toBe(false);
      });

      it('should reject quiet_hours_start over 23', () => {
        const config = { ...createDefaultSuggestionConfig(), quiet_hours_start: 24 };
        expect(NeasSuggestionConfigSchema.safeParse(config).success).toBe(false);
      });

      it('should reject quiet_hours_end over 23', () => {
        const config = { ...createDefaultSuggestionConfig(), quiet_hours_end: 24 };
        expect(NeasSuggestionConfigSchema.safeParse(config).success).toBe(false);
      });

      it('should accept quiet_hours at 0', () => {
        const config = { ...createDefaultSuggestionConfig(), quiet_hours_start: 0, quiet_hours_end: 0 };
        expect(NeasSuggestionConfigSchema.safeParse(config).success).toBe(true);
      });
    });

    describe('NeasPermissionCheckResultSchema', () => {
      it('should accept allowed result', () => {
        const result = NeasPermissionCheckResultSchema.safeParse({
          allowed: true,
          effective_confirmation: 'none',
          permission_tier: 'always_on',
        });
        expect(result.success).toBe(true);
      });

      it('should accept denied result with reason', () => {
        const result = NeasPermissionCheckResultSchema.safeParse({
          allowed: false,
          denied_reason: 'Not allowed',
          effective_confirmation: 'confirm',
          permission_tier: 'off_by_default',
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid confirmation level', () => {
        const result = NeasPermissionCheckResultSchema.safeParse({
          allowed: true,
          effective_confirmation: 'maybe',
          permission_tier: 'always_on',
        });
        expect(result.success).toBe(false);
      });

      it('should reject invalid permission tier', () => {
        const result = NeasPermissionCheckResultSchema.safeParse({
          allowed: true,
          effective_confirmation: 'none',
          permission_tier: 'superadmin',
        });
        expect(result.success).toBe(false);
      });
    });
  });

  // ============================================================
  // EXPLANATION TEMPLATES TESTS
  // ============================================================

  describe('Error Explanation Templates', () => {
    it('should have a template for every error type', () => {
      for (const errorType of NEAS_ERROR_TYPES) {
        expect(NEAS_ERROR_EXPLANATIONS[errorType]).toBeDefined();
        expect(NEAS_ERROR_EXPLANATIONS[errorType].length).toBeGreaterThan(0);
      }
    });

    it('should have a recovery suggestion for every error type', () => {
      for (const errorType of NEAS_ERROR_TYPES) {
        expect(NEAS_RECOVERY_SUGGESTIONS[errorType]).toBeDefined();
        expect(NEAS_RECOVERY_SUGGESTIONS[errorType].length).toBeGreaterThan(0);
      }
    });

    it('should contain {suggestion} placeholder in explanation templates', () => {
      for (const errorType of NEAS_ERROR_TYPES) {
        expect(NEAS_ERROR_EXPLANATIONS[errorType]).toContain('{suggestion}');
      }
    });
  });
});
