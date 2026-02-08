/**
 * @module @nous/core/contradiction
 * @description Contradiction Resolution System (CRS) for storm-009
 * @version 1.0.0
 * @spec Specs/Phase-5-Quality-Control/storm-009
 * @storm Brainstorms/Infrastructure/storm-009-contradiction-handling
 *
 * 6-tier detection pipeline, supersession lifecycle, and user conflict resolution.
 */

import type { NousNode } from '../nodes';

// Re-export all constants
export * from './constants';

// Re-export all types
export * from './types';

// Import for internal use
import {
  type DetectionTier,
  type ConflictType,
  type SupersededState,
  type AccuracyMode,
  type QueryMode,
  type Sentiment,
  type UserResolution,
  CONFLICT_TYPE_RESOLUTION,
  SUPERSEDED_DECAY_MULTIPLIERS,
  SUPERSEDED_ACCESS_DECAY_MULTIPLIER,
  SUPERSEDED_R_THRESHOLDS,
  SUPERSEDED_DORMANT_DAYS,
  DELETION_CRITERIA,
  STORAGE_PRESSURE_THRESHOLD,
  CONFLICT_QUEUE_CONFIG,
  PATTERN_TRIGGERS,
  PATTERN_DISQUALIFIERS,
  PATTERN_CONFIDENCE_WEIGHTS,
  ATTRIBUTE_SYNONYMS,
  TIER_THRESHOLDS,
  HISTORY_MODE_PATTERNS,
  HISTORY_MODE_SUPERSEDED_PENALTY,
  SSA_SUPERSEDED_ACTIVATION_CAP,
  SSA_SUPERSEDED_SPREAD_DECAY,
  CLASSIFIER_TRAINING,
  ACCURACY_TARGETS,
} from './constants';

import {
  type DetectionContext,
  type TypeClassification,
  type TierResult,
  type NormalizationResult,
  type PatternDetection,
  type LLMDetectionOutput,
  type VerificationOutput,
  type SupersededStateConfig,
  type SupersessionFields,
  type DeletionCriteriaResult,
  type SupersededStateTransition,
  type ConflictQueueItem,
  type ContradictionResolution,
  type ConflictQueueStatus,
  type ConflictPresentation,
  type ConflictQueueConfig,
  type AccuracyModeConfig,
  type DetectionEventLog,
  type AccuracyMetrics,
  type SelfImprovementConfig,
  type QCSHistoryModeConfig,
  type HistoryModeDetection,
  type RCSSupersessionFlag,
  type SSASupersededConfig,
  type Phase2ContextInjection,
  type QueryModeConfig,
  type RetrievalIntegrationConfig,
} from './types';

// ============================================================
// PROMPT TEMPLATES
// ============================================================

/**
 * Few-shot classification prompt for Tier 2.5.
 */
export const CLASSIFIER_FEW_SHOT_PROMPT = `Classify if this text is correcting previous information.

Examples of CORRECTIONS:
- "Actually, Sarah's phone is 555-5678" → CORRECTION
- "I was wrong about the meeting date, it's Thursday" → CORRECTION
- "Update: The deadline moved to next week" → CORRECTION

Examples of NOT corrections:
- "Actually, that's a great idea" → NOT (agreement)
- "I was wrong to doubt you" → NOT (apology)
- "I actually enjoyed the movie" → NOT (emphasis)
- "Was I wrong about this?" → NOT (question)

Text to classify: "{input_text}"
Context: "{surrounding_sentences}"

Is this a CORRECTION or NOT? Answer with confidence (0-1).`;

/**
 * Structured LLM detection prompt for Tier 3.
 */
export const LLM_DETECTION_PROMPT = `You are analyzing whether new information contradicts existing information in a personal knowledge base.

EXISTING INFORMATION:
- Entity: {entity_name}
- Type: {entity_type}
- Attribute: {attribute}
- Current value: "{old_value}"
- Recorded on: {old_date}
- Source: {old_source}

NEW INFORMATION:
- Statement: "{new_statement}"
- Context (surrounding text): "{context}"
- Date: {new_date}
- Source: {new_source}

IMPORTANT: Consider these possibilities:
1. TRUE CONTRADICTION: The facts cannot both be true
2. UPDATE: The fact changed over time (both were true at time)
3. EVOLUTION: The belief/opinion developed (not contradiction)
4. DIFFERENT CONTEXT: Both could be true in different contexts
5. UNRELATED: The new info is about something else entirely

Respond with ONLY this JSON (no other text):
{
  "relationship": "contradicts|updates|evolves|coexists|unrelated",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation in 1-2 sentences>",
  "which_is_current": "old|new|both|unclear",
  "both_could_be_true": <true|false>,
  "is_time_dependent": <true|false>,
  "needs_user_input": <true|false>
}`;

/**
 * Adversarial verification prompt for Tier 4.
 */
export const VERIFICATION_PROMPT = `A detection system believes these two pieces of information CONTRADICT each other:

EXISTING: "{old_value}" (about {entity}, recorded {old_date})
NEW: "{new_statement}" (from {new_date})

The system wants to AUTOMATICALLY mark the old information as superseded by the new information.

YOUR JOB: Find reasons this might be WRONG. Consider:
- Could they be about different things? (different Sarah?)
- Could both be true? (different contexts, times, aspects?)
- Is the "new" information actually a correction?
- Could this be a misunderstanding or ambiguity?

Respond with ONLY this JSON:
{
  "should_supersede": <true|false>,
  "confidence": <0.0-1.0>,
  "concerns": ["<concern1>", "<concern2>"] or [],
  "recommendation": "auto_supersede|queue_for_user|keep_both"
}`;

// ============================================================
// CONFIGURATION OBJECTS
// ============================================================

/**
 * Superseded state configurations.
 */
export const SUPERSEDED_STATE_CONFIGS: Record<SupersededState, SupersededStateConfig> = {
  SUPERSEDED_ACTIVE: {
    state: 'SUPERSEDED_ACTIVE',
    r_threshold_min: SUPERSEDED_R_THRESHOLDS.active_min,
    r_threshold_max: 1.0,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_ACTIVE,
    retrieval_mode: 'normal_excluded',
    content_state: 'full',
    duration_days: undefined,
  },
  SUPERSEDED_FADING: {
    state: 'SUPERSEDED_FADING',
    r_threshold_min: SUPERSEDED_R_THRESHOLDS.fading_min,
    r_threshold_max: SUPERSEDED_R_THRESHOLDS.active_min,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_FADING,
    retrieval_mode: 'history_only',
    content_state: 'full',
    duration_days: undefined,
  },
  SUPERSEDED_DORMANT: {
    state: 'SUPERSEDED_DORMANT',
    r_threshold_min: 0,
    r_threshold_max: SUPERSEDED_R_THRESHOLDS.dormant_max,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_DORMANT,
    retrieval_mode: 'audit_only',
    content_state: 'summarized',
    duration_days: SUPERSEDED_DORMANT_DAYS,
  },
  SUPERSEDED_ARCHIVED: {
    state: 'SUPERSEDED_ARCHIVED',
    r_threshold_min: undefined,
    r_threshold_max: undefined,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_ARCHIVED,
    retrieval_mode: 'audit_only',
    content_state: 'reference_only',
    duration_days: undefined,
  },
  SUPERSEDED_DELETED: {
    state: 'SUPERSEDED_DELETED',
    r_threshold_min: undefined,
    r_threshold_max: undefined,
    decay_multiplier: 0,
    retrieval_mode: 'none',
    content_state: 'deleted',
    duration_days: undefined,
  },
};

/**
 * Accuracy mode configurations.
 */
export const ACCURACY_MODE_CONFIGS: Record<AccuracyMode, AccuracyModeConfig> = {
  FAST: {
    mode: 'FAST',
    description: "I want quick responses, I'll fix mistakes manually",
    tiers_used: ['STRUCTURAL', 'NORMALIZED', 'PATTERN'],
    auto_supersede_tiers: ['STRUCTURAL'],
    user_involvement: 'high',
    typical_speed_ms: 15,
    typical_cost: 0,
    expected_accuracy: 0.75,
  },
  BALANCED: {
    mode: 'BALANCED',
    description: 'Good accuracy without too much cost/delay',
    tiers_used: ['STRUCTURAL', 'NORMALIZED', 'PATTERN', 'CLASSIFIER', 'LLM'],
    auto_supersede_tiers: ['STRUCTURAL', 'NORMALIZED', 'PATTERN'],
    user_involvement: 'medium',
    typical_speed_ms: 50,
    typical_cost: 0.003,
    expected_accuracy: 0.90,
  },
  THOROUGH: {
    mode: 'THOROUGH',
    description: "I want maximum accuracy, cost/speed doesn't matter",
    tiers_used: ['STRUCTURAL', 'NORMALIZED', 'PATTERN', 'CLASSIFIER', 'LLM', 'VERIFICATION'],
    auto_supersede_tiers: ['STRUCTURAL', 'NORMALIZED', 'PATTERN', 'LLM'],
    user_involvement: 'low',
    typical_speed_ms: 1500,
    typical_cost: 0.006,
    expected_accuracy: 0.97,
  },
  MANUAL: {
    mode: 'MANUAL',
    description: 'I want to approve every change',
    tiers_used: ['STRUCTURAL', 'NORMALIZED', 'PATTERN'],
    auto_supersede_tiers: [],
    user_involvement: 'very_high',
    typical_speed_ms: 15,
    typical_cost: 0,
    expected_accuracy: 1.0,
  },
};

/**
 * Query mode configurations.
 */
export const QUERY_MODE_CONFIGS: Record<QueryMode, QueryModeConfig> = {
  current: {
    mode: 'current',
    include_superseded: false,
    superseded_penalty: 1.0,
    description: 'Only active nodes (default)',
  },
  as_of: {
    mode: 'as_of',
    include_superseded: true,
    superseded_penalty: 0.0,
    description: 'What we knew at that date',
  },
  history: {
    mode: 'history',
    include_superseded: true,
    superseded_penalty: HISTORY_MODE_SUPERSEDED_PENALTY,
    description: 'Include superseded nodes with penalty',
  },
  full_audit: {
    mode: 'full_audit',
    include_superseded: true,
    superseded_penalty: 0.0,
    description: 'Everything including archived',
  },
};

/**
 * Default conflict queue configuration.
 */
export const DEFAULT_QUEUE_CONFIG: ConflictQueueConfig = {
  max_items: CONFLICT_QUEUE_CONFIG.max_items,
  auto_resolve_days: CONFLICT_QUEUE_CONFIG.auto_resolve_days,
  auto_resolve_strategy: CONFLICT_QUEUE_CONFIG.auto_resolve_strategy,
  weekly_prompt_enabled: true,
  weekly_prompt_day: CONFLICT_QUEUE_CONFIG.weekly_prompt_day,
};

/**
 * Default self-improvement configuration.
 */
export const DEFAULT_SELF_IMPROVEMENT_CONFIG: SelfImprovementConfig = {
  classifier_initial_train_examples: CLASSIFIER_TRAINING.initial_train_examples,
  classifier_retrain_examples: CLASSIFIER_TRAINING.retrain_examples,
  accuracy_alert_threshold: CLASSIFIER_TRAINING.accuracy_alert_threshold,
  auto_mode_switch_threshold: CLASSIFIER_TRAINING.auto_mode_switch_threshold,
};

/**
 * QCS history mode configuration.
 */
export const QCS_HISTORY_MODE_CONFIG: QCSHistoryModeConfig = {
  history_patterns: HISTORY_MODE_PATTERNS,
  superseded_penalty: HISTORY_MODE_SUPERSEDED_PENALTY,
};

/**
 * RCS supersession flag configuration.
 */
export const RCS_SUPERSESSION_FLAG: RCSSupersessionFlag = {
  flag: 'has_superseded_history',
  trigger: 'top_result_has_superseded_by_chain',
  explanation_text: 'Note: This topic has historical versions',
};

/**
 * SSA superseded configuration.
 */
export const SSA_SUPERSEDED_CONFIG: SSASupersededConfig = {
  activation_cap: SSA_SUPERSEDED_ACTIVATION_CAP,
  spread_decay: SSA_SUPERSEDED_SPREAD_DECAY,
  spread_to_superseding: true,
};

/**
 * Phase 2 context injection configuration.
 */
export const PHASE2_CONTEXT_INJECTION: Phase2ContextInjection = {
  superseded_context_template: 'Note: "{old_content}" was later updated to "{new_content}"',
  follow_supersedes_for: ['change', 'evolution', 'history', 'before', 'used to'],
};

/**
 * Default retrieval integration configuration.
 */
export const DEFAULT_RETRIEVAL_INTEGRATION_CONFIG: RetrievalIntegrationConfig = {
  qcs: QCS_HISTORY_MODE_CONFIG,
  rcs: RCS_SUPERSESSION_FLAG,
  ssa: SSA_SUPERSEDED_CONFIG,
  phase2: PHASE2_CONTEXT_INJECTION,
};

// ============================================================
// TYPE DETECTION CRITERIA
// ============================================================

/**
 * Detection criteria for each conflict type.
 */
export interface TypeDetectionCriteria {
  type: ConflictType;
  priority: number;
  matches: (context: DetectionContext) => boolean;
  confidence: number;
  auto_supersede: boolean;
  resolution: 'supersede_old' | 'keep_both_linked' | 'keep_both_unlinked' | 'queue_for_user' | 'source_ranking';
}

export const TYPE_DETECTION_CRITERIA: TypeDetectionCriteria[] = [
  {
    type: 'FACT_UPDATE',
    priority: 1,
    matches: (ctx) =>
      ctx.entity_id !== undefined &&
      ctx.attribute_type !== undefined &&
      ctx.old_value !== ctx.new_value &&
      !ctx.has_correction_pattern,
    confidence: 0.95,
    auto_supersede: true,
    resolution: 'supersede_old',
  },
  {
    type: 'CORRECTION',
    priority: 2,
    matches: (ctx) => ctx.has_correction_pattern,
    confidence: 0.90,
    auto_supersede: true,
    resolution: 'supersede_old',
  },
  {
    type: 'BELIEF_CONTRADICTION',
    priority: 3,
    matches: (ctx) => ctx.has_sentiment_flip && !ctx.has_scope_expansion,
    confidence: 0.85,
    auto_supersede: true,
    resolution: 'supersede_old',
  },
  {
    type: 'BELIEF_EVOLUTION',
    priority: 4,
    matches: (ctx) => !ctx.has_sentiment_flip && ctx.has_scope_expansion,
    confidence: 0.80,
    auto_supersede: false,
    resolution: 'keep_both_linked',
  },
  {
    type: 'SOURCE_CONFLICT',
    priority: 5,
    matches: (ctx) =>
      ctx.old_source_confidence !== ctx.new_source_confidence &&
      Math.abs(ctx.old_source_confidence - ctx.new_source_confidence) > 0.2,
    confidence: 0.75,
    auto_supersede: true,
    resolution: 'source_ranking',
  },
  {
    type: 'AMBIGUOUS',
    priority: 6,
    matches: () => true,
    confidence: 0.50,
    auto_supersede: false,
    resolution: 'queue_for_user',
  },
];

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Calculates days since a given ISO timestamp.
 */
export function daysSince(isoTimestamp: string): number {
  const then = new Date(isoTimestamp).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

/**
 * Generates a unique conflict ID.
 */
export function generateConflictId(): string {
  return `conflict_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Generates a unique event ID.
 */
export function generateEventId(): string {
  return `event_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Formats a date for timeline display.
 */
export function formatDate(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================================
// CONTRADICTION TYPE FUNCTIONS
// ============================================================

/**
 * Classifies a potential contradiction into one of 6 types.
 */
export function classifyConflictType(
  _old_node: NousNode,
  _new_content: string,
  context: DetectionContext
): TypeClassification {
  for (const criteria of TYPE_DETECTION_CRITERIA) {
    if (criteria.matches(context)) {
      return {
        type: criteria.type,
        confidence: criteria.confidence,
        auto_supersede: criteria.auto_supersede,
        resolution: criteria.resolution,
        reasoning: CONFLICT_TYPE_RESOLUTION[criteria.type].description,
      };
    }
  }

  return {
    type: 'AMBIGUOUS',
    confidence: 0.50,
    auto_supersede: false,
    resolution: 'queue_for_user',
    reasoning: 'Could not determine conflict type.',
  };
}

/**
 * Checks if a conflict type auto-supersedes.
 */
export function isAutoSupersede(type: ConflictType): boolean {
  return CONFLICT_TYPE_RESOLUTION[type].auto_supersede;
}

/**
 * Gets the resolution strategy for a conflict type.
 */
export function getResolutionStrategy(type: ConflictType): string {
  return CONFLICT_TYPE_RESOLUTION[type].resolution;
}

/**
 * Determines the winning node in a source conflict.
 */
export function resolveSourceConflict(old_confidence: number, new_confidence: number): 'old' | 'new' {
  return new_confidence >= old_confidence ? 'new' : 'old';
}

/**
 * Detects if two statements have opposite sentiments.
 */
export function hasSentimentFlip(old_sentiment: Sentiment, new_sentiment: Sentiment): boolean {
  if (old_sentiment === 'neutral' || new_sentiment === 'neutral') {
    return false;
  }
  return old_sentiment !== new_sentiment;
}

// ============================================================
// DETECTION PIPELINE FUNCTIONS
// ============================================================

/**
 * Runs Tier 2: Contextual pattern detection.
 */
export function runTier2Pattern(content: string): PatternDetection {
  const lowerContent = content.toLowerCase();
  const triggers_found: string[] = [];
  const disqualifiers_found: string[] = [];

  for (const trigger of PATTERN_TRIGGERS) {
    if (lowerContent.includes(trigger.toLowerCase())) {
      triggers_found.push(trigger);
    }
  }

  for (const disqualifier of PATTERN_DISQUALIFIERS) {
    if (lowerContent.includes(disqualifier.toLowerCase())) {
      disqualifiers_found.push(disqualifier);
    }
  }

  const confidence_score = calculatePatternConfidence({
    triggers_found,
    entity_nearby: false, // Would need entity detection
    has_value: triggers_found.length > 0,
    temporal_signal: lowerContent.includes('now') || lowerContent.includes('used to'),
    disqualifiers_found,
    confidence_score: 0,
  });

  return {
    triggers_found,
    entity_nearby: false,
    has_value: triggers_found.length > 0,
    temporal_signal: lowerContent.includes('now') || lowerContent.includes('used to'),
    disqualifiers_found,
    confidence_score,
  };
}

/**
 * Calculates pattern confidence score.
 */
export function calculatePatternConfidence(detection: PatternDetection): number {
  let confidence = PATTERN_CONFIDENCE_WEIGHTS.base;

  if (detection.entity_nearby) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.entity_nearby;
  }
  if (detection.has_value) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.has_value;
  }
  if (detection.temporal_signal) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.temporal_signal;
  }
  if (detection.disqualifiers_found.length > 0) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.disqualifier_penalty;
  }

  return Math.max(0, Math.min(1, confidence));
}

/**
 * Runs Tier 1.5: Attribute normalization.
 */
export function runTier1_5Normalization(attribute: string, _content: string): NormalizationResult {
  const lowerAttribute = attribute.toLowerCase();
  let normalized_attribute = attribute;
  const synonyms_matched: string[] = [];

  for (const [normalized, synonyms] of Object.entries(ATTRIBUTE_SYNONYMS)) {
    for (const synonym of synonyms) {
      if (lowerAttribute.includes(synonym.toLowerCase())) {
        normalized_attribute = normalized;
        synonyms_matched.push(synonym);
        break;
      }
    }
    if (synonyms_matched.length > 0) break;
  }

  return {
    original_attribute: attribute,
    normalized_attribute,
    synonyms_matched,
  };
}

/**
 * Determines if pipeline should continue to next tier.
 */
export function shouldContinueToNextTier(result: TierResult, mode: AccuracyMode): boolean {
  if (mode === 'FAST' && result.tier === 'PATTERN') {
    return false;
  }
  if (mode === 'MANUAL' && result.tier === 'PATTERN') {
    return false;
  }
  if (result.detected && result.confidence >= TIER_THRESHOLDS.structural_confidence) {
    return false;
  }
  return result.should_continue;
}

/**
 * Determines if auto-supersession is allowed.
 */
export function canAutoSupersede(
  tier3_result: LLMDetectionOutput | undefined,
  tier4_result: VerificationOutput | undefined,
  mode: AccuracyMode
): boolean {
  if (mode === 'MANUAL') {
    return false;
  }
  if (mode === 'FAST') {
    return false;
  }
  if (!tier3_result || !tier4_result) {
    return false;
  }

  const pass1_ok = tier3_result.confidence >= TIER_THRESHOLDS.llm_auto_threshold;
  const pass2_ok =
    tier4_result.should_supersede &&
    tier4_result.confidence >= TIER_THRESHOLDS.verification_threshold &&
    tier4_result.concerns.length === 0;

  return pass1_ok && pass2_ok;
}

// ============================================================
// SUPERSEDED LIFECYCLE FUNCTIONS
// ============================================================

/**
 * Determines the current superseded state based on node properties.
 */
export function determineSupersededState(node: NousNode & Partial<SupersessionFields>): SupersededState {
  if (node.superseded_state === 'SUPERSEDED_DELETED') {
    return 'SUPERSEDED_DELETED';
  }
  if (node.superseded_state === 'SUPERSEDED_ARCHIVED') {
    return 'SUPERSEDED_ARCHIVED';
  }

  const R = node.neural.retrievability;

  if (R > SUPERSEDED_R_THRESHOLDS.active_min) {
    return 'SUPERSEDED_ACTIVE';
  } else if (R > SUPERSEDED_R_THRESHOLDS.fading_min) {
    return 'SUPERSEDED_FADING';
  } else {
    if (node.dormant_since) {
      const dormantDays = daysSince(node.dormant_since);
      if (dormantDays >= SUPERSEDED_DORMANT_DAYS) {
        return 'SUPERSEDED_ARCHIVED';
      }
    }
    return 'SUPERSEDED_DORMANT';
  }
}

/**
 * Gets the decay multiplier for a superseded state.
 */
export function getDecayMultiplier(state: SupersededState): number {
  return SUPERSEDED_DECAY_MULTIPLIERS[state];
}

/**
 * Gets the decay multiplier accounting for user access.
 */
export function getEffectiveDecayMultiplier(state: SupersededState, userAccessed: boolean): number {
  if (userAccessed) {
    return SUPERSEDED_ACCESS_DECAY_MULTIPLIER;
  }
  return SUPERSEDED_DECAY_MULTIPLIERS[state];
}

/**
 * Checks if a node should transition to a new superseded state.
 */
export function checkStateTransition(node: NousNode & Partial<SupersessionFields>): SupersededStateTransition | null {
  const currentState = node.superseded_state;
  if (!currentState || currentState === 'SUPERSEDED_DELETED') {
    return null;
  }

  const newState = determineSupersededState(node);

  if (newState !== currentState) {
    let trigger: SupersededStateTransition['triggered_by'] = 'decay';
    if (newState === 'SUPERSEDED_ARCHIVED' && currentState === 'SUPERSEDED_DORMANT') {
      trigger = 'time';
    }

    return {
      node_id: node.id,
      from_state: currentState,
      to_state: newState,
      triggered_by: trigger,
      timestamp: new Date().toISOString(),
      context: { retrievability: node.neural.retrievability },
    };
  }

  return null;
}

/**
 * Checks if a superseded node meets all 5 deletion criteria.
 */
export function checkDeletionCriteria(
  node: NousNode & Partial<SupersessionFields>,
  supersedingNode: NousNode | null,
  maxIncomingEdgeStrength: number,
  rawInArchive: boolean
): DeletionCriteriaResult {
  const daysArchived = node.archived_at ? daysSince(node.archived_at) : 0;
  const accessCount = node.access_count_since_superseded ?? 0;
  const supersedingActive = supersedingNode !== null && supersedingNode.state.lifecycle === 'active';

  const criteria = {
    archived_long_enough: daysArchived >= DELETION_CRITERIA.min_archived_days,
    days_archived: daysArchived,
    no_accesses: accessCount === DELETION_CRITERIA.required_access_count,
    access_count: accessCount,
    no_important_edges: maxIncomingEdgeStrength <= DELETION_CRITERIA.max_edge_strength,
    max_edge_strength: maxIncomingEdgeStrength,
    superseding_active: supersedingActive,
    superseding_node_state: supersedingNode?.state.lifecycle,
    raw_in_archive: rawInArchive,
  };

  const eligible =
    criteria.archived_long_enough &&
    criteria.no_accesses &&
    criteria.no_important_edges &&
    criteria.superseding_active &&
    criteria.raw_in_archive;

  return { eligible, criteria };
}

/**
 * Checks if system is under storage pressure.
 */
export function isStoragePressure(currentCapacity: number): boolean {
  return currentCapacity >= STORAGE_PRESSURE_THRESHOLD;
}

/**
 * Gets the retrieval mode for a superseded state.
 */
export function getRetrievalMode(state: SupersededState): SupersededStateConfig['retrieval_mode'] {
  return SUPERSEDED_STATE_CONFIGS[state].retrieval_mode;
}

/**
 * Gets the content state for a superseded state.
 */
export function getContentState(state: SupersededState): SupersededStateConfig['content_state'] {
  return SUPERSEDED_STATE_CONFIGS[state].content_state;
}

// ============================================================
// CONFLICT QUEUE FUNCTIONS
// ============================================================

/**
 * Creates a new conflict queue item.
 */
export function createConflictQueueItem(
  data: Omit<ConflictQueueItem, 'id' | 'created_at' | 'expires_at' | 'status'>
): ConflictQueueItem {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + CONFLICT_QUEUE_CONFIG.auto_resolve_days);

  return {
    ...data,
    id: generateConflictId(),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    status: 'pending',
  };
}

/**
 * Adds an item to the conflict queue.
 */
export function addToConflictQueue(
  queue: ConflictQueueItem[],
  item: ConflictQueueItem
): { queue: ConflictQueueItem[]; auto_resolved: ContradictionResolution[] } {
  const auto_resolved: ContradictionResolution[] = [];
  let pendingItems = queue.filter((q) => q.status === 'pending');

  while (pendingItems.length >= CONFLICT_QUEUE_CONFIG.max_items) {
    const oldest = pendingItems.reduce((a, b) =>
      new Date(a.created_at) < new Date(b.created_at) ? a : b
    );
    oldest.status = 'auto_resolved';
    auto_resolved.push({
      conflict_id: oldest.id,
      resolved_by: 'auto',
      resolution: CONFLICT_QUEUE_CONFIG.auto_resolve_strategy,
      resolved_at: new Date().toISOString(),
    });
    pendingItems = queue.filter((q) => q.status === 'pending');
  }

  queue.push(item);
  return { queue, auto_resolved };
}

/**
 * Gets all pending conflicts from the queue.
 */
export function getPendingConflicts(queue: ConflictQueueItem[]): ConflictQueueItem[] {
  return queue
    .filter((item) => item.status === 'pending')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

/**
 * Resolves a conflict with user's choice.
 */
export function resolveConflict(
  queue: ConflictQueueItem[],
  conflict_id: string,
  resolution: UserResolution,
  merged_content?: string
): ContradictionResolution {
  const item = queue.find((q) => q.id === conflict_id);
  if (!item) {
    throw new Error(`Conflict not found: ${conflict_id}`);
  }
  if (item.status !== 'pending') {
    throw new Error(`Conflict already resolved: ${conflict_id}`);
  }

  item.status = 'resolved';
  return {
    conflict_id,
    resolved_by: 'user',
    resolution,
    resolved_at: new Date().toISOString(),
    user_merged_content: merged_content,
  };
}

/**
 * Processes all expired conflicts.
 */
export function processExpiredConflicts(queue: ConflictQueueItem[]): ContradictionResolution[] {
  const now = new Date();
  const resolutions: ContradictionResolution[] = [];

  for (const item of queue) {
    if (item.status === 'pending' && new Date(item.expires_at) <= now) {
      item.status = 'auto_resolved';
      resolutions.push({
        conflict_id: item.id,
        resolved_by: 'timeout',
        resolution: CONFLICT_QUEUE_CONFIG.auto_resolve_strategy,
        resolved_at: now.toISOString(),
      });
    }
  }

  return resolutions;
}

/**
 * Gets current queue status.
 */
export function getQueueStatus(queue: ConflictQueueItem[]): ConflictQueueStatus {
  const pending = getPendingConflicts(queue);
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const resolvedThisWeek = queue.filter(
    (item) => item.status !== 'pending' && new Date(item.created_at) >= weekStart
  ).length;

  return {
    pending_count: pending.length,
    oldest_pending_date: pending[0]?.created_at,
    next_auto_resolve_date: pending[0]?.expires_at,
    items_resolved_this_week: resolvedThisWeek,
    at_capacity: pending.length >= CONFLICT_QUEUE_CONFIG.max_items,
  };
}

/**
 * Formats a conflict for presentation to user.
 */
export function formatForPresentation(
  item: ConflictQueueItem,
  old_node_content: string,
  old_node_date: string
): ConflictPresentation {
  const now = new Date();
  const expires = new Date(item.expires_at);
  const daysRemaining = Math.max(
    0,
    Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  );

  let suggested_action: UserResolution | undefined;
  if (item.detection_confidence >= 0.7) {
    suggested_action = 'new_is_current';
  } else if (item.detection_confidence < 0.4) {
    suggested_action = 'keep_both';
  }

  return {
    conflict_id: item.id,
    entity_name: item.entity_name,
    topic: item.topic ?? 'Unknown topic',
    version_a: { content: old_node_content, date: old_node_date },
    version_b: { content: item.new_content, date: item.created_at },
    suggested_action,
    confidence_in_suggestion: item.detection_confidence,
    days_until_auto_resolve: daysRemaining,
  };
}

/**
 * Checks if weekly prompt should be shown.
 */
export function shouldShowWeeklyPrompt(
  queue: ConflictQueueItem[],
  config: ConflictQueueConfig = DEFAULT_QUEUE_CONFIG
): boolean {
  if (!config.weekly_prompt_enabled) {
    return false;
  }
  const pending = getPendingConflicts(queue);
  if (pending.length === 0) {
    return false;
  }
  const today = new Date().getDay();
  return today === config.weekly_prompt_day;
}

// ============================================================
// ACCURACY MODE FUNCTIONS
// ============================================================

/**
 * Gets the configuration for an accuracy mode.
 */
export function getAccuracyModeConfig(mode: AccuracyMode): AccuracyModeConfig {
  return ACCURACY_MODE_CONFIGS[mode];
}

/**
 * Checks if a tier should be used in a given mode.
 */
export function shouldUseTier(tier: DetectionTier, mode: AccuracyMode): boolean {
  return ACCURACY_MODE_CONFIGS[mode].tiers_used.includes(tier);
}

/**
 * Checks if a tier can trigger auto-supersession in a given mode.
 */
export function canAutoSupersedeTier(tier: DetectionTier, mode: AccuracyMode): boolean {
  return ACCURACY_MODE_CONFIGS[mode].auto_supersede_tiers.includes(tier);
}

/**
 * Logs a detection event.
 */
export function logDetectionEvent(
  event: Omit<DetectionEventLog, 'id' | 'timestamp'>
): DetectionEventLog {
  return {
    ...event,
    id: generateEventId(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Computes weekly accuracy metrics.
 */
export function computeWeeklyMetrics(
  events: DetectionEventLog[],
  periodStart: string,
  periodEnd: string
): AccuracyMetrics {
  const periodEvents = events.filter(
    (e) => e.timestamp >= periodStart && e.timestamp <= periodEnd
  );

  const perTierAccuracy: Record<DetectionTier, number | null> = {
    STRUCTURAL: null,
    NORMALIZED: null,
    PATTERN: null,
    CLASSIFIER: null,
    LLM: null,
    VERIFICATION: null,
  };

  for (const tier of Object.keys(perTierAccuracy) as DetectionTier[]) {
    const tierEvents = periodEvents.filter(
      (e) => e.tier_reached === tier && e.user_override !== undefined
    );
    if (tierEvents.length > 0) {
      const agreed = tierEvents.filter((e) => e.user_override === 'agreed').length;
      perTierAccuracy[tier] = agreed / tierEvents.length;
    }
  }

  const detectedConflicts = periodEvents.filter((e) => e.resolution !== 'unrelated');
  const falsePositives = detectedConflicts.filter(
    (e) =>
      e.user_override === 'disagreed' &&
      (e.user_resolution === 'keep_both' || e.resolution === 'unrelated')
  ).length;
  const fpRate = detectedConflicts.length > 0 ? falsePositives / detectedConflicts.length : 0;

  const autoSuperseded = periodEvents.filter((e) => e.auto_resolved);
  const autoAgreed = autoSuperseded.filter(
    (e) => e.user_override === undefined || e.user_override === 'agreed'
  ).length;
  const autoAccuracy = autoSuperseded.length > 0 ? autoAgreed / autoSuperseded.length : 1;

  const byMode: AccuracyMetrics['by_mode'] = {
    FAST: { detections: 0, accuracy: null },
    BALANCED: { detections: 0, accuracy: null },
    THOROUGH: { detections: 0, accuracy: null },
    MANUAL: { detections: 0, accuracy: null },
  };

  for (const mode of Object.keys(byMode) as AccuracyMode[]) {
    const modeEvents = periodEvents.filter((e) => e.accuracy_mode === mode);
    byMode[mode].detections = modeEvents.length;
    const withFeedback = modeEvents.filter((e) => e.user_override !== undefined);
    if (withFeedback.length > 0) {
      const agreed = withFeedback.filter((e) => e.user_override === 'agreed').length;
      byMode[mode].accuracy = agreed / withFeedback.length;
    }
  }

  return {
    period_start: periodStart,
    period_end: periodEnd,
    per_tier_accuracy: perTierAccuracy,
    false_positive_rate: fpRate,
    false_negative_rate: 0,
    auto_supersede_accuracy: autoAccuracy,
    total_detections: periodEvents.length,
    user_resolutions: periodEvents.filter((e) => e.user_override !== undefined).length,
    by_mode: byMode,
  };
}

/**
 * Checks for accuracy alerts.
 */
export function checkAccuracyAlerts(
  metrics: AccuracyMetrics,
  config: SelfImprovementConfig = DEFAULT_SELF_IMPROVEMENT_CONFIG
): string[] {
  const alerts: string[] = [];

  for (const [tier, accuracy] of Object.entries(metrics.per_tier_accuracy)) {
    if (accuracy !== null && accuracy < config.accuracy_alert_threshold) {
      alerts.push(
        `Tier ${tier} accuracy (${(accuracy * 100).toFixed(1)}%) below threshold (${config.accuracy_alert_threshold * 100}%)`
      );
    }
  }

  if (metrics.auto_supersede_accuracy < config.auto_mode_switch_threshold) {
    alerts.push(
      `Auto-supersede accuracy (${(metrics.auto_supersede_accuracy * 100).toFixed(1)}%) below threshold - consider more conservative mode`
    );
  }

  if (metrics.false_positive_rate > 0.15) {
    alerts.push(`High false positive rate (${(metrics.false_positive_rate * 100).toFixed(1)}%)`);
  }

  return alerts;
}

/**
 * Checks if classifier should be trained/retrained.
 */
export function shouldTrainClassifier(
  trainingExamples: number,
  hasExistingModel: boolean,
  config: SelfImprovementConfig = DEFAULT_SELF_IMPROVEMENT_CONFIG
): { train: boolean; retrain: boolean } {
  const train = !hasExistingModel && trainingExamples >= config.classifier_initial_train_examples;
  const retrain = hasExistingModel && trainingExamples >= config.classifier_retrain_examples;
  return { train, retrain };
}

/**
 * Gets training data from detection events.
 */
export function getTrainingData(events: DetectionEventLog[]): DetectionEventLog[] {
  return events.filter(
    (e) => e.user_override !== undefined && e.old_content !== undefined && e.new_content !== undefined
  );
}

/**
 * Gets the accuracy target for a tier.
 */
export function getAccuracyTarget(tier: DetectionTier): number {
  return ACCURACY_TARGETS[tier];
}

// ============================================================
// RETRIEVAL INTEGRATION FUNCTIONS
// ============================================================

/**
 * Checks if a query should enable history mode.
 */
export function detectHistoryMode(query: string): HistoryModeDetection {
  const lowerQuery = query.toLowerCase();
  const matched: string[] = [];

  for (const pattern of HISTORY_MODE_PATTERNS) {
    if (pattern.includes('.*')) {
      const regex = new RegExp(pattern.replace('.*', '.*'), 'i');
      if (regex.test(lowerQuery)) {
        matched.push(pattern);
      }
    } else if (lowerQuery.includes(pattern.toLowerCase())) {
      matched.push(pattern);
    }
  }

  const isHistoryMode = matched.length > 0;
  return {
    is_history_mode: isHistoryMode,
    matched_patterns: matched,
    suggested_mode: isHistoryMode ? 'history' : 'current',
  };
}

/**
 * Applies activation cap to a superseded node.
 */
export function applySupersededCap(activation: number, node: NousNode & Partial<SupersessionFields>): number {
  const isSuperseded = node.state.lifecycle === 'superseded' || node.superseded_by !== undefined;
  if (!isSuperseded) {
    return activation;
  }
  return Math.min(activation, SSA_SUPERSEDED_ACTIVATION_CAP);
}

/**
 * Calculates spread activation from a superseded node.
 */
export function calculateSupersededSpread(activation: number, isSuperseded: boolean): number {
  if (!isSuperseded) {
    return activation;
  }
  return activation * SSA_SUPERSEDED_SPREAD_DECAY;
}

/**
 * Injects supersession context for Phase 2 LLM traversal.
 */
export function injectSupersessionContext(node: NousNode, supersedingContent: string): string {
  const oldContent = node.content.body ?? node.content.title;
  return PHASE2_CONTEXT_INJECTION.superseded_context_template
    .replace('{old_content}', oldContent)
    .replace('{new_content}', supersedingContent);
}

/**
 * Checks if supersedes edges should be followed for a query.
 */
export function shouldFollowSupersedesEdges(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  for (const pattern of PHASE2_CONTEXT_INJECTION.follow_supersedes_for) {
    if (lowerQuery.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Builds a history timeline from a supersession chain.
 */
export function buildHistoryTimeline(chain: NousNode[]): string {
  if (chain.length === 0) {
    return 'No history available.';
  }

  const lines = ['Timeline:'];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    if (!node) continue;
    const date = formatDate(node.temporal.ingestion.timestamp);
    const content = node.content.body ?? node.content.title;
    const isCurrent = i === chain.length - 1;
    lines.push(`- ${date}: ${content}${isCurrent ? ' (current)' : ''}`);
  }

  return lines.join('\n');
}

/**
 * Gets the query mode configuration.
 */
export function getQueryModeConfig(mode: QueryMode): QueryModeConfig {
  return QUERY_MODE_CONFIGS[mode];
}

/**
 * Checks if superseded nodes should be included for a query mode.
 */
export function shouldIncludeSuperseded(mode: QueryMode): boolean {
  return QUERY_MODE_CONFIGS[mode].include_superseded;
}

/**
 * Gets the superseded penalty for a query mode.
 */
export function getSupersededPenalty(mode: QueryMode): number {
  return QUERY_MODE_CONFIGS[mode].superseded_penalty;
}

/**
 * Checks if RCS should flag supersession history.
 */
export function shouldFlagSupersessionHistory(topResults: (NousNode & Partial<SupersessionFields>)[]): boolean {
  for (const node of topResults) {
    if (node.superseded_by !== undefined) {
      return true;
    }
  }
  return false;
}
