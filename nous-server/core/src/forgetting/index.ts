/**
 * @module @nous/core/forgetting
 * @description Forgetting & Persistence Model for storm-007
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-007
 * @storm Brainstorms/Infrastructure/storm-007-forgetting-model
 *
 * FSRS-inspired decay system that determines how memories fade,
 * what persists, and how content is compressed and archived.
 */

import { DECAY_CONFIG } from '../params';

import {
  CONTENT_CATEGORIES,
  FORGETTING_LIFECYCLE_STATES,
  STRENGTHENING_EVENTS,
  INITIAL_STABILITY_BY_CATEGORY,
  BASE_DIFFICULTY_BY_CATEGORY,
  STRENGTHENING_BONUSES,
  DIFFICULTY_CONFIG,
  LIFECYCLE_THRESHOLDS,
  DELETION_EXCLUSION_RULES,
  DELETION_CRITERIA,
  TRASH_CONFIG,
  P008_COMPRESSION_PROMPT_SPEC,
  DECAY_JOB_SPEC,
  FORGETTING_CONFIG,
  MAX_STRENGTH,
  DEFAULT_STRENGTH,
  isContentCategory,
  isForgettingLifecycleState,
  isStrengtheningEventType,
  type ContentCategory,
  type ForgettingLifecycleState,
  type StrengtheningEventType,
  type DifficultyConfigType,
  type LifecycleThresholdsType,
  type DeletionExclusionRulesType,
  type DeletionCriteriaType,
  type TrashConfigType,
  type CompressionPromptSpecType,
  type DecayJobSpecType,
  type ForgettingConfigType,
} from './constants';

import {
  type NeuralState,
  type StrengtheningRecord,
  type StrengtheningResult,
  type DifficultyFactors,
  type ComplexityAnalysis,
  type CompressionInput,
  type CompressionResult,
  type ExclusionCheckResult,
  type DeletionCandidate,
  type TrashRecord,
  type CleanupSettings,
  type StorageMetrics,
  type StabilityUpdateResult,
  type StateTransition,
  type DecayJobResult,
  type NodeDecayInput,
  type LifecycleDetermination,
  type CreateNeuralStateOptions,
  NeuralStateSchema,
  StrengtheningRecordSchema,
  StrengtheningResultSchema,
  DifficultyFactorsSchema,
  ComplexityAnalysisSchema,
  CompressionInputSchema,
  CompressionResultSchema,
  ExclusionCheckResultSchema,
  DeletionCandidateSchema,
  TrashRecordSchema,
  CleanupSettingsSchema,
  StorageMetricsSchema,
  StabilityUpdateResultSchema,
  StateTransitionSchema,
  DecayJobResultSchema,
  NodeDecayInputSchema,
  LifecycleDeterminationSchema,
  CreateNeuralStateOptionsSchema,
} from './types';

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Calculates days between two dates.
 */
export function daysBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Calculates hours between two dates.
 */
export function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

// ============================================================
// RETRIEVABILITY CALCULATION
// ============================================================

/**
 * Calculates retrievability using FSRS exponential decay formula.
 *
 * Formula: R = 0.9^(t / S)
 *
 * When t = S, R = 0.9 (90% recall probability).
 */
export function calculateRetrievability(stability: number, daysSinceAccess: number): number {
  if (stability <= 0) return 0;
  if (daysSinceAccess <= 0) return 1;
  return Math.pow(0.9, daysSinceAccess / stability);
}

// ============================================================
// LIFECYCLE STATE DETERMINATION
// ============================================================

/**
 * Determines the lifecycle state based on retrievability and dormant duration.
 */
export function getDecayLifecycleState(
  retrievability: number,
  daysDormant: number = 0
): ForgettingLifecycleState {
  if (retrievability > LIFECYCLE_THRESHOLDS.active_threshold) {
    return 'ACTIVE';
  }
  if (retrievability > LIFECYCLE_THRESHOLDS.weak_threshold) {
    return 'WEAK';
  }

  // R <= weak_threshold (0.1) - dormant or worse
  if (daysDormant < LIFECYCLE_THRESHOLDS.dormant_days) {
    return 'DORMANT';
  }
  if (daysDormant < LIFECYCLE_THRESHOLDS.compress_days) {
    return 'DORMANT';
  }
  if (daysDormant < LIFECYCLE_THRESHOLDS.archive_days) {
    return 'SUMMARIZED';
  }

  return 'ARCHIVED';
}

/**
 * Full lifecycle determination with eligibility checks.
 */
export function determineLifecycle(
  neuralState: NeuralState,
  now: Date = new Date()
): LifecycleDetermination {
  const daysSinceAccess = daysBetween(neuralState.last_accessed, now);
  const retrievability = calculateRetrievability(neuralState.stability, daysSinceAccess);
  const daysDormant = neuralState.days_in_dormant ?? 0;
  const state = getDecayLifecycleState(retrievability, daysDormant);

  return {
    retrievability,
    days_dormant: daysDormant,
    state,
    compression_eligible: state === 'DORMANT' && daysDormant >= LIFECYCLE_THRESHOLDS.compress_days,
    archive_eligible: state === 'SUMMARIZED' && daysDormant >= LIFECYCLE_THRESHOLDS.archive_days,
    deletion_candidate_eligible: state === 'ARCHIVED' && daysDormant >= LIFECYCLE_THRESHOLDS.deletion_candidate_days,
  };
}

// ============================================================
// STABILITY UPDATE
// ============================================================

/**
 * Updates stability when a node is accessed.
 *
 * Formula: S_new = S × growth_rate × (1 - difficulty × 0.5)
 */
export function updateStabilityOnAccess(
  nodeId: string,
  currentStability: number,
  difficulty: number
): StabilityUpdateResult {
  const difficultyFactor = 1 - (difficulty * 0.5);
  const growthFactor = DECAY_CONFIG.growth_rate * difficultyFactor;
  const newStability = currentStability * growthFactor;
  const cappedStability = Math.min(newStability, DECAY_CONFIG.max_stability_days);
  const capped = newStability > DECAY_CONFIG.max_stability_days;

  return {
    nodeId,
    stability_before: currentStability,
    stability_after: cappedStability,
    growth_factor: growthFactor,
    difficulty,
    capped,
    retrievability_reset: true,
  };
}

// ============================================================
// NODE STRENGTHENING
// ============================================================

/**
 * Strengthens a node using Hebbian saturation formula.
 *
 * Formula: strength_new = strength + bonus × (max_strength - strength)
 */
export function strengthenNode(
  neuralState: NeuralState,
  event: StrengtheningEventType
): StrengtheningResult {
  const bonus = STRENGTHENING_BONUSES[event];
  const headroom = MAX_STRENGTH - neuralState.strength;
  const actualBonus = bonus * headroom;
  const newStrength = Math.min(MAX_STRENGTH, neuralState.strength + actualBonus);
  const now = new Date();

  const record: StrengtheningRecord = {
    type: event,
    timestamp: now,
    strength_before: neuralState.strength,
    strength_after: newStrength,
    strength_delta: actualBonus,
  };

  const updatedState: NeuralState = {
    ...neuralState,
    strength: newStrength,
  };

  return { updated_state: updatedState, record };
}

// ============================================================
// COMPLEXITY ANALYSIS
// ============================================================

/**
 * Analyzes content complexity for difficulty calculation.
 */
export function analyzeComplexity(content: string): ComplexityAnalysis {
  if (!content || content.trim().length === 0) {
    return {
      length_score: 0,
      sentence_score: 0,
      vocab_score: 0,
      complexity: 0,
    };
  }

  const words = content.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  if (wordCount === 0) {
    return {
      length_score: 0,
      sentence_score: 0,
      vocab_score: 0,
      complexity: 0,
    };
  }

  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentenceCount = Math.max(1, sentences.length);
  const avgWordLength = content.replace(/\s+/g, '').length / wordCount;

  // Normalize each factor to 0-1
  const lengthScore = Math.min(1, wordCount / 500);
  const sentenceScore = Math.min(1, (wordCount / sentenceCount) / 25);
  const vocabScore = Math.max(0, Math.min(1, (avgWordLength - 4) / 4));

  const complexity = (lengthScore + sentenceScore + vocabScore) / 3;

  return {
    length_score: lengthScore,
    sentence_score: sentenceScore,
    vocab_score: vocabScore,
    complexity,
  };
}

// ============================================================
// DIFFICULTY CALCULATION
// ============================================================

/**
 * Calculates difficulty with all factors and mean reversion.
 */
export function calculateDifficulty(
  contentCategory: ContentCategory,
  complexity: number,
  avgDaysBetweenAccess: number,
  edgeCount: number
): DifficultyFactors {
  const base = BASE_DIFFICULTY_BY_CATEGORY[contentCategory];

  // Re-access penalty: if user keeps coming back frequently, it might be hard
  const reaccessPenalty = avgDaysBetweenAccess < DIFFICULTY_CONFIG.reaccess_penalty_threshold_days
    ? DIFFICULTY_CONFIG.reaccess_penalty_amount
    : 0;

  // Connection bonus: more edges = easier to remember
  const connectionBonus = Math.min(
    DIFFICULTY_CONFIG.max_connection_bonus,
    edgeCount * DIFFICULTY_CONFIG.connection_bonus_per_edge
  );

  // Calculate raw difficulty
  let difficulty = base
    + (complexity * DIFFICULTY_CONFIG.complexity_weight)
    + (reaccessPenalty * DIFFICULTY_CONFIG.reaccess_weight)
    - (connectionBonus * DIFFICULTY_CONFIG.connection_weight);

  // Mean reversion (prevent "ease hell")
  difficulty = difficulty * (1 - DIFFICULTY_CONFIG.mean_reversion_rate)
    + DIFFICULTY_CONFIG.target_difficulty * DIFFICULTY_CONFIG.mean_reversion_rate;

  // Clamp to bounds
  difficulty = Math.max(
    DIFFICULTY_CONFIG.min_difficulty,
    Math.min(DIFFICULTY_CONFIG.max_difficulty, difficulty)
  );

  return {
    base,
    complexity,
    reaccess_penalty: reaccessPenalty,
    connection_bonus: connectionBonus,
    calculated: difficulty,
  };
}

// ============================================================
// COMPRESSION ELIGIBILITY
// ============================================================

/**
 * Checks if a node should be compressed (P-008).
 */
export function shouldCompress(neuralState: NeuralState, _now: Date = new Date()): boolean {
  if (neuralState.lifecycle_state !== 'DORMANT') {
    return false;
  }
  const daysDormant = neuralState.days_in_dormant ?? 0;
  return daysDormant >= LIFECYCLE_THRESHOLDS.compress_days;
}

/**
 * Checks if a node should be fully archived.
 */
export function shouldArchive(neuralState: NeuralState, _now: Date = new Date()): boolean {
  if (neuralState.lifecycle_state !== 'SUMMARIZED') {
    return false;
  }
  const daysDormant = neuralState.days_in_dormant ?? 0;
  return daysDormant >= LIFECYCLE_THRESHOLDS.archive_days;
}

// ============================================================
// DELETION CANDIDATE FUNCTIONS
// ============================================================

/**
 * Checks if a node has active inbound links.
 */
export function hasActiveInboundLinks(activeInboundCount: number): boolean {
  return activeInboundCount > 0;
}

/**
 * Checks all exclusion rules for a node.
 */
export function checkExclusionRules(
  node: NodeDecayInput,
  now: Date = new Date()
): ExclusionCheckResult {
  const isIdentity = node.content_category === 'identity';
  const isPinned = node.pinned;
  const hasActiveLinks = hasActiveInboundLinks(node.active_inbound_link_count);
  const wasEverRestored = node.restore_count > 0;

  let wasSearchedRecently = false;
  if (node.last_archive_search_hit) {
    const daysSinceSearch = daysBetween(node.last_archive_search_hit, now);
    wasSearchedRecently = daysSinceSearch < LIFECYCLE_THRESHOLDS.recent_search_days;
  }

  const anyExclusion = isIdentity || isPinned || hasActiveLinks || wasEverRestored || wasSearchedRecently;

  return {
    is_identity: isIdentity,
    is_pinned: isPinned,
    has_active_links: hasActiveLinks,
    was_ever_restored: wasEverRestored,
    was_searched_recently: wasSearchedRecently,
    any_exclusion: anyExclusion,
  };
}

/**
 * Determines if an archived node is a deletion candidate.
 */
export function isDeletionCandidate(
  node: NodeDecayInput,
  daysArchived: number,
  now: Date = new Date()
): DeletionCandidate {
  const daysSinceAccess = daysBetween(node.neural_state.last_accessed, now);
  const exclusionChecks = checkExclusionRules(node, now);

  // Must meet time threshold
  if (daysArchived < DELETION_CRITERIA.min_days_archived) {
    return {
      nodeId: node.nodeId,
      days_archived: daysArchived,
      days_since_access: daysSinceAccess,
      content_category: node.content_category,
      exclusion_checks: exclusionChecks,
      is_candidate: false,
      reason: `Only ${daysArchived} days archived, need ${DELETION_CRITERIA.min_days_archived}`,
    };
  }

  // Check exclusions
  if (exclusionChecks.any_exclusion) {
    const reasons: string[] = [];
    if (exclusionChecks.is_identity) reasons.push('identity content');
    if (exclusionChecks.is_pinned) reasons.push('pinned');
    if (exclusionChecks.has_active_links) reasons.push('has active inbound links');
    if (exclusionChecks.was_ever_restored) reasons.push('was restored before');
    if (exclusionChecks.was_searched_recently) reasons.push('recently searched');

    return {
      nodeId: node.nodeId,
      days_archived: daysArchived,
      days_since_access: daysSinceAccess,
      content_category: node.content_category,
      exclusion_checks: exclusionChecks,
      is_candidate: false,
      reason: `Excluded: ${reasons.join(', ')}`,
    };
  }

  return {
    nodeId: node.nodeId,
    days_archived: daysArchived,
    days_since_access: daysSinceAccess,
    content_category: node.content_category,
    exclusion_checks: exclusionChecks,
    is_candidate: true,
    reason: `Archived ${daysArchived} days, no exclusions triggered`,
  };
}

// ============================================================
// TRASH AND DELETION FUNCTIONS
// ============================================================

/**
 * Moves a node to trash with a buffer period.
 */
export function moveToTrash(
  nodeId: string,
  reason: string,
  initiatedBy: 'user' | 'system'
): TrashRecord {
  const now = new Date();
  const autoDeleteAt = new Date(now.getTime() + TRASH_CONFIG.buffer_days * 24 * 60 * 60 * 1000);

  return {
    nodeId,
    trashed_at: now,
    auto_delete_at: autoDeleteAt,
    reason,
    initiated_by: initiatedBy,
  };
}

/**
 * Permanently deletes a node from all storage.
 * Note: This is a stub - actual implementation requires DB layer.
 */
export async function permanentlyDelete(_nodeId: string): Promise<void> {
  // Stub: In actual implementation, this would:
  // 1. Remove from all storage layers
  // 2. Delete embeddings
  // 3. Clean up edges
  // 4. Record analytics metadata
}

/**
 * Restores a node from trash to archived state.
 * Note: This is a stub - actual implementation requires DB layer.
 */
export async function restoreFromTrash(_nodeId: string): Promise<void> {
  // Stub: In actual implementation, this would:
  // 1. Move from trash back to archived
  // 2. Reset deletion_candidate_at
  // 3. Increment restore_count
}

// ============================================================
// DECAY CYCLE BATCH FUNCTION
// ============================================================

/**
 * Runs the J-001 decay cycle on a batch of nodes.
 */
export async function runDecayCycle(
  nodes: NodeDecayInput[],
  now: Date = new Date()
): Promise<DecayJobResult> {
  const startTime = Date.now();
  const stateChanges: Map<string, StateTransition> = new Map();
  let compressed = 0;
  let archived = 0;
  let deletionCandidatesFlagged = 0;
  let autoDeleted = 0;
  const errors: string[] = [];

  for (const node of nodes) {
    try {
      const daysSinceAccess = daysBetween(node.neural_state.last_accessed, now);
      const newR = calculateRetrievability(node.neural_state.stability, daysSinceAccess);
      const daysDormant = node.neural_state.days_in_dormant ?? 0;
      const newState = getDecayLifecycleState(newR, daysDormant);
      const oldState = node.neural_state.lifecycle_state;

      if (oldState !== newState) {
        const key = `${oldState}->${newState}`;
        const existing = stateChanges.get(key);
        if (existing) {
          existing.count++;
        } else {
          stateChanges.set(key, { from: oldState, to: newState, count: 1 });
        }

        if (newState === 'SUMMARIZED') compressed++;
        if (newState === 'ARCHIVED') archived++;
      }

      // Check for deletion candidates
      if (newState === 'ARCHIVED') {
        const daysArchived = daysDormant - LIFECYCLE_THRESHOLDS.archive_days;
        if (daysArchived >= 0) {
          const candidate = isDeletionCandidate(node, daysArchived, now);
          if (candidate.is_candidate) {
            deletionCandidatesFlagged++;
          }
        }
      }

      // Check for trash auto-deletion
      if (node.neural_state.lifecycle_state === 'TRASH') {
        // Would need trashed_at date to check auto-deletion
        // For now, this is handled externally
      }
    } catch (error) {
      errors.push(`Node ${node.nodeId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return {
    evaluated: nodes.length,
    state_changes: Array.from(stateChanges.values()),
    compressed,
    archived,
    deletion_candidates_flagged: deletionCandidatesFlagged,
    auto_deleted: autoDeleted,
    errors,
    executed_at: now,
    duration_ms: Date.now() - startTime,
  };
}

// ============================================================
// CATEGORY MAPPING
// ============================================================

/**
 * Maps ContentCategory to AlgorithmNodeType for storm-028 lookup.
 */
export function mapContentCategoryToNodeType(category: ContentCategory): string {
  const mapping: Record<ContentCategory, string> = {
    identity: 'person',
    academic: 'concept',
    conversation: 'note',
    work: 'note',
    temporal: 'event',
    document: 'document',
    general: 'fact',
  };
  return mapping[category];
}

// ============================================================
// INITIAL VALUE HELPERS
// ============================================================

/**
 * Gets initial stability for a content category.
 */
export function getInitialStabilityForCategory(category: ContentCategory): number {
  return INITIAL_STABILITY_BY_CATEGORY[category];
}

/**
 * Gets base difficulty for a content category.
 */
export function getBaseDifficultyForCategory(category: ContentCategory): number {
  return BASE_DIFFICULTY_BY_CATEGORY[category];
}

/**
 * Creates initial neural state for a promoted node.
 */
export function createNeuralState(options: CreateNeuralStateOptions): NeuralState {
  const stability = options.initial_stability ?? INITIAL_STABILITY_BY_CATEGORY[options.content_category];
  const difficulty = options.initial_difficulty ?? BASE_DIFFICULTY_BY_CATEGORY[options.content_category];
  const strength = options.initial_strength ?? DEFAULT_STRENGTH;
  const now = new Date();

  return {
    stability,
    retrievability: 1.0,
    strength,
    difficulty,
    last_accessed: now,
    access_count: 0,
    lifecycle_state: 'ACTIVE',
    days_in_dormant: 0,
  };
}

// ============================================================
// VALIDATION HELPERS
// ============================================================

/**
 * Validates a NeuralState object.
 */
export function validateNeuralState(state: unknown): state is NeuralState {
  return NeuralStateSchema.safeParse(state).success;
}

/**
 * Validates a StrengtheningRecord object.
 */
export function validateStrengtheningRecord(record: unknown): record is StrengtheningRecord {
  return StrengtheningRecordSchema.safeParse(record).success;
}

/**
 * Validates a DeletionCandidate object.
 */
export function validateDeletionCandidate(candidate: unknown): candidate is DeletionCandidate {
  return DeletionCandidateSchema.safeParse(candidate).success;
}

/**
 * Validates a DecayJobResult object.
 */
export function validateDecayJobResult(result: unknown): result is DecayJobResult {
  return DecayJobResultSchema.safeParse(result).success;
}

// ============================================================
// EXPORTS
// ============================================================

// Re-export constants
export {
  CONTENT_CATEGORIES,
  FORGETTING_LIFECYCLE_STATES,
  STRENGTHENING_EVENTS,
  INITIAL_STABILITY_BY_CATEGORY,
  BASE_DIFFICULTY_BY_CATEGORY,
  STRENGTHENING_BONUSES,
  DIFFICULTY_CONFIG,
  LIFECYCLE_THRESHOLDS,
  DELETION_EXCLUSION_RULES,
  DELETION_CRITERIA,
  TRASH_CONFIG,
  P008_COMPRESSION_PROMPT_SPEC,
  DECAY_JOB_SPEC,
  FORGETTING_CONFIG,
  MAX_STRENGTH,
  DEFAULT_STRENGTH,
  isContentCategory,
  isForgettingLifecycleState,
  isStrengtheningEventType,
  type ContentCategory,
  type ForgettingLifecycleState,
  type StrengtheningEventType,
  type DifficultyConfigType,
  type LifecycleThresholdsType,
  type DeletionExclusionRulesType,
  type DeletionCriteriaType,
  type TrashConfigType,
  type CompressionPromptSpecType,
  type DecayJobSpecType,
  type ForgettingConfigType,
};

// Re-export types
export {
  type NeuralState,
  type StrengtheningRecord,
  type StrengtheningResult,
  type DifficultyFactors,
  type ComplexityAnalysis,
  type CompressionInput,
  type CompressionResult,
  type ExclusionCheckResult,
  type DeletionCandidate,
  type TrashRecord,
  type CleanupSettings,
  type StorageMetrics,
  type StabilityUpdateResult,
  type StateTransition,
  type DecayJobResult,
  type NodeDecayInput,
  type LifecycleDetermination,
  type CreateNeuralStateOptions,
  NeuralStateSchema,
  StrengtheningRecordSchema,
  StrengtheningResultSchema,
  DifficultyFactorsSchema,
  ComplexityAnalysisSchema,
  CompressionInputSchema,
  CompressionResultSchema,
  ExclusionCheckResultSchema,
  DeletionCandidateSchema,
  TrashRecordSchema,
  CleanupSettingsSchema,
  StorageMetricsSchema,
  StabilityUpdateResultSchema,
  StateTransitionSchema,
  DecayJobResultSchema,
  NodeDecayInputSchema,
  LifecycleDeterminationSchema,
  CreateNeuralStateOptionsSchema,
};
