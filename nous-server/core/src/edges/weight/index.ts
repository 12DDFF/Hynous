/**
 * @module @nous/core/edges/weight
 * @description Edge Weight Determination System (EWDS) - 5-source weight calculation with Hebbian evolution
 * @version 1.0.0
 * @spec Brainstorms/Specs/Phase-2-Data-Representation/storm-031
 *
 * This module implements storm-031: Edge Weight Calculation & Clustering.
 *
 * Key concepts:
 * - 5 edge creation sources: extraction, similarity, user, temporal, coactivation
 * - Three-part weight: base × (1 + learned) + coactivation_bonus
 * - Hebbian learning with consecutive ignore tracking
 * - Adaptive compression for graph management
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  NANOID_LENGTH,
  EDGE_ID_PREFIX,
  type SourceType,
} from '../../constants';
import type { NousEdge } from '../index';

// ============================================================
// EXTENDED EDGE TYPES (storm-031 additions)
// ============================================================

/**
 * Extended edge types including storm-031 additions.
 */
export const EXTENDED_EDGE_TYPES = [
  // From storm-011
  'relates_to',
  'part_of',
  'mentioned_in',
  'causes',
  'precedes',
  'contradicts',
  'supersedes',
  'derived_from',
  'similar_to',
  // New in storm-031
  'same_entity',
  'user_linked',
  'caused_by',
  'mentioned_together',
  'temporal_adjacent',
  'temporal_continuation',
  'summarizes',
] as const;

export type ExtendedEdgeType = (typeof EXTENDED_EDGE_TYPES)[number];

// ============================================================
// EDGE TYPE WEIGHTS
// ============================================================

/**
 * Default base weights for each edge type.
 * Higher values = stronger relationships.
 */
export const EDGE_WEIGHTS: Record<ExtendedEdgeType, number> = {
  // Identity / structural (highest)
  same_entity: 0.95,
  summarizes: 0.95,
  // User-created (high trust)
  user_linked: 0.90,
  // Semantic relationships
  part_of: 0.85,
  caused_by: 0.80,
  causes: 0.80,
  contradicts: 0.75,
  supersedes: 0.75,
  derived_from: 0.70,
  precedes: 0.65,
  mentioned_together: 0.60,
  mentioned_in: 0.55,
  relates_to: 0.50,
  similar_to: 0.45,
  // Temporal (lowest)
  temporal_adjacent: 0.40,
  temporal_continuation: 0.30,
};

// ============================================================
// EDGE STATUS & CREATION SOURCE
// ============================================================

export const EDGE_STATUSES = ['confirmed', 'provisional'] as const;
export type EdgeStatus = (typeof EDGE_STATUSES)[number];

export const EDGE_CREATION_SOURCES = [
  'extraction',
  'similarity',
  'user',
  'temporal',
  'coactivation',
  'compression',
] as const;
export type EdgeCreationSource = (typeof EDGE_CREATION_SOURCES)[number];

// ============================================================
// CONFIGURATION CONSTANTS
// ============================================================

/**
 * Extraction-time edge creation configuration.
 */
export const EXTRACTION_CONFIG = {
  confirmed_threshold: 0.70,
  provisional_threshold: 0.50,
  rejection_threshold: 0.50,
  provisional_weight_factor: 0.5,
  provisional_promotion_activations: 3,
  provisional_expiry_days: 30,
} as const;

/**
 * Similarity-based edge creation configuration.
 */
export const SIMILARITY_CONFIG = {
  creation_threshold: 0.85,
  edge_type: 'similar_to' as ExtendedEdgeType,
  batch_frequency: 'daily' as const,
  max_edges_per_node: 10,
  exclude_same_cluster: false,
} as const;

/**
 * User-created edge configuration.
 */
export const USER_EDGE_CONFIG = {
  default_strength: 0.90,
  min_strength: 0.50,
  max_strength: 1.00,
  default_type: 'user_linked' as ExtendedEdgeType,
  allowed_types: [
    'user_linked',
    'relates_to',
    'part_of',
    'caused_by',
    'contradicts',
    'supersedes',
    'derived_from',
  ] as ExtendedEdgeType[],
} as const;

/**
 * Temporal edge configuration.
 */
export const TEMPORAL_CONFIG = {
  session_timeout_minutes: 30,
  edge_type: 'temporal_adjacent' as ExtendedEdgeType,
  decay_constant: 30,
  max_gap_minutes: 120,
  min_strength: 0.20,
  continuation_max_gap_hours: 24,
  continuation_base_weight: 0.30,
  continuation_same_cluster_required: true,
  continuation_edge_type: 'temporal_continuation' as ExtendedEdgeType,
} as const;

/**
 * Hebbian learning and co-activation configuration.
 */
export const COACTIVATION_CONFIG = {
  strengthen_delta: 0.10,
  decay_delta: 0.02,
  min_weight: 0.10,
  max_weight: 1.00,
  engagement_threshold_seconds: 5,
  consecutive_ignores_before_decay: 3,
  max_coactivation_bonus: 0.30,
  new_edge_similarity_threshold: 0.50,
} as const;

/**
 * Time-based edge decay configuration.
 */
export const EDGE_DECAY_CONFIG = {
  decay_start_days: 30,
  decay_rate: 0.95,
  decay_period_days: 30,
  floor: 0.10,
} as const;

/**
 * Compression default configuration.
 */
export const COMPRESSION_DEFAULTS = {
  min_nodes_for_compression: 5,
  similarity_threshold: 0.75,
  max_nodes_per_summary: 20,
  restorable_days: 365,
  dormant_days_minimum: 60,
  importance_max: 0.3,
  strong_active_edges_max: 2,
  age_days_minimum: 30,
} as const;

/**
 * Graph size thresholds for adaptive compression.
 */
export const GRAPH_SIZE_THRESHOLDS = {
  small: { max: 500, min_nodes: 3 },
  medium: { max: 5000, min_nodes: 5 },
  large: { max: Infinity, min_nodes: 10 },
} as const;

/**
 * Weight bounds for all edges.
 */
export const WEIGHT_BOUNDS = {
  min: 0.10,
  max: 1.00,
} as const;

/**
 * Learned adjustment bounds.
 */
export const LEARNED_ADJUSTMENT_BOUNDS = {
  min: -0.30,
  max: 0.30,
} as const;

// ============================================================
// CORE TYPES
// ============================================================

/**
 * Weight component decomposition.
 */
export interface EdgeWeightComponents {
  base_weight: number;
  learned_adjustment: number;
  coactivation_bonus: number;
}

/**
 * Extended edge with weight components.
 */
export interface WeightedEdge extends Omit<NousEdge, 'type'> {
  type: ExtendedEdgeType;
  status: EdgeStatus;
  components: EdgeWeightComponents;
  creation_source: EdgeCreationSource;
  consecutive_ignored: number;
  activation_count: number;
}

/**
 * Result of calculating effective weight.
 */
export interface EffectiveWeightResult {
  effective_weight: number;
  was_clamped: boolean;
  raw_value: number;
}

/**
 * Provisional edge state tracking.
 */
export interface ProvisionalEdgeState {
  created_at: string;
  activation_count: number;
  expires_at: string;
}

/**
 * Extraction edge result.
 */
export interface ExtractionEdgeResult {
  weight: number;
  status: EdgeStatus;
  components: EdgeWeightComponents;
}

/**
 * Temporal edge result.
 */
export interface TemporalEdgeResult {
  source: string;
  target: string;
  type: 'temporal_adjacent' | 'temporal_continuation';
  weight: number;
  components: EdgeWeightComponents;
}

/**
 * Session for temporal edge detection.
 */
export interface Session {
  id: string;
  start: string;
  end: string;
  accessedNodes: SessionNode[];
}

/**
 * Node accessed during a session.
 */
export interface SessionNode {
  id: string;
  cluster_id: string;
  accessed_at: string;
}

/**
 * Co-activation update result.
 */
export interface CoactivationUpdateResult {
  edge: WeightedEdge;
  action: 'strengthened' | 'decayed' | 'unchanged';
  previous_weight: number;
  new_weight: number;
  reason: string;
}

/**
 * Time-based decay result.
 */
export interface DecayResult {
  decay_periods: number;
  decay_factor: number;
  previous_bonus: number;
  new_bonus: number;
  decay_applied: boolean;
}

/**
 * Compression configuration.
 */
export interface CompressionConfig {
  never_compress: {
    is_pinned: boolean;
    is_starred: boolean;
    age_days_less_than: number;
  };
  candidate_requirements: {
    dormant_days_minimum: number;
    importance_max: number;
    strong_active_edges_max: number;
  };
  clustering: {
    similarity_threshold: number;
    min_nodes_for_compression: number;
    max_nodes_per_summary: number;
  };
  retention: {
    restorable_days: number;
  };
}

/**
 * Summary node content.
 */
export interface SummaryContent {
  title: string;
  body: string;
  preserved_entities: string[];
  key_facts: string[];
  temporal_span: string | null;
}

/**
 * Compressed edge record for restoration.
 */
export interface CompressedEdgeRecord {
  original_source: string;
  target: string;
  original_type: string;
  original_weight: number;
}

/**
 * Summary node from compression.
 */
export interface SummaryNode {
  id: string;
  type: 'summary';
  content: SummaryContent;
  compressed_from: string[];
  compressed_edges: CompressedEdgeRecord[];
  cluster_id: string;
  created_at: string;
}

/**
 * Node compression state.
 */
export interface NodeCompressionState {
  compressed_into?: string;
  compressed_at?: string;
  restorable_until?: string;
}

/**
 * Embedding freshness state.
 */
export interface EmbeddingFreshnessState {
  embedding_version: number;
  last_content_update: string;
  last_embedding_update: string;
}

// ============================================================
// ZOD SCHEMAS
// ============================================================

export const EdgeWeightComponentsSchema = z.object({
  base_weight: z.number().min(0).max(1),
  learned_adjustment: z.number().min(LEARNED_ADJUSTMENT_BOUNDS.min).max(LEARNED_ADJUSTMENT_BOUNDS.max),
  coactivation_bonus: z.number().min(0).max(COACTIVATION_CONFIG.max_coactivation_bonus),
});

export const EdgeStatusSchema = z.enum(EDGE_STATUSES);
export const EdgeCreationSourceSchema = z.enum(EDGE_CREATION_SOURCES);

export const ProvisionalEdgeStateSchema = z.object({
  created_at: z.string().datetime(),
  activation_count: z.number().int().min(0),
  expires_at: z.string().datetime(),
});

export const ExtractionEdgeResultSchema = z.object({
  weight: z.number().min(0).max(1),
  status: EdgeStatusSchema,
  components: EdgeWeightComponentsSchema,
});

export const SessionNodeSchema = z.object({
  id: z.string(),
  cluster_id: z.string(),
  accessed_at: z.string().datetime(),
});

export const SessionSchema = z.object({
  id: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  accessedNodes: z.array(SessionNodeSchema),
});

export const TemporalEdgeResultSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(['temporal_adjacent', 'temporal_continuation']),
  weight: z.number().min(0).max(1),
  components: EdgeWeightComponentsSchema,
});

export const DecayResultSchema = z.object({
  decay_periods: z.number().int().min(0),
  decay_factor: z.number().min(0).max(1),
  previous_bonus: z.number().min(0),
  new_bonus: z.number().min(0),
  decay_applied: z.boolean(),
});

export const SummaryContentSchema = z.object({
  title: z.string().max(60),
  body: z.string(),
  preserved_entities: z.array(z.string()),
  key_facts: z.array(z.string()),
  temporal_span: z.string().nullable(),
});

export const CompressedEdgeRecordSchema = z.object({
  original_source: z.string(),
  target: z.string(),
  original_type: z.string(),
  original_weight: z.number().min(0).max(1),
});

export const SummaryNodeSchema = z.object({
  id: z.string(),
  type: z.literal('summary'),
  content: SummaryContentSchema,
  compressed_from: z.array(z.string()),
  compressed_edges: z.array(CompressedEdgeRecordSchema),
  cluster_id: z.string(),
  created_at: z.string().datetime(),
});

export const NodeCompressionStateSchema = z.object({
  compressed_into: z.string().optional(),
  compressed_at: z.string().datetime().optional(),
  restorable_until: z.string().datetime().optional(),
});

export const EmbeddingFreshnessStateSchema = z.object({
  embedding_version: z.number().int().min(0),
  last_content_update: z.string().datetime(),
  last_embedding_update: z.string().datetime(),
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Calculates days between two dates.
 */
function daysBetween(start: string | Date, end: string | Date): number {
  const startDate = typeof start === 'string' ? new Date(start) : start;
  const endDate = typeof end === 'string' ? new Date(end) : end;
  return Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Calculates minutes between two timestamps.
 */
function minutesBetween(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.abs(endDate.getTime() - startDate.getTime()) / (1000 * 60);
}

/**
 * Calculates hours between two timestamps.
 */
function hoursBetween(start: string, end: string): number {
  return minutesBetween(start, end) / 60;
}

// ============================================================
// CORE WEIGHT FUNCTIONS
// ============================================================

/**
 * Calculates effective weight from components.
 * Formula: effective = base × (1 + learned) + coactivation
 */
export function calculateEffectiveWeight(components: EdgeWeightComponents): EffectiveWeightResult {
  const adjustedBase = components.base_weight * (1 + components.learned_adjustment);
  const rawValue = adjustedBase + components.coactivation_bonus;

  const clamped = Math.max(WEIGHT_BOUNDS.min, Math.min(WEIGHT_BOUNDS.max, rawValue));

  return {
    effective_weight: clamped,
    was_clamped: clamped !== rawValue,
    raw_value: rawValue,
  };
}

/**
 * Creates weight components with defaults.
 */
export function createWeightComponents(input: {
  base_weight: number;
  learned_adjustment?: number;
  coactivation_bonus?: number;
}): EdgeWeightComponents {
  return {
    base_weight: input.base_weight,
    learned_adjustment: input.learned_adjustment ?? 0,
    coactivation_bonus: input.coactivation_bonus ?? 0,
  };
}

/**
 * Applies a learning adjustment to components.
 */
export function applyLearningAdjustment(
  components: EdgeWeightComponents,
  delta: number
): EdgeWeightComponents {
  const newAdjustment = components.learned_adjustment + delta;
  const clamped = Math.max(
    LEARNED_ADJUSTMENT_BOUNDS.min,
    Math.min(LEARNED_ADJUSTMENT_BOUNDS.max, newAdjustment)
  );

  return {
    ...components,
    learned_adjustment: clamped,
  };
}

/**
 * Applies a coactivation bonus to components.
 */
export function applyCoactivationBonus(
  components: EdgeWeightComponents,
  delta: number
): EdgeWeightComponents {
  const newBonus = components.coactivation_bonus + delta;
  const clamped = Math.max(0, Math.min(COACTIVATION_CONFIG.max_coactivation_bonus, newBonus));

  return {
    ...components,
    coactivation_bonus: clamped,
  };
}

/**
 * Decays coactivation bonus by a factor.
 */
export function decayCoactivationBonus(
  components: EdgeWeightComponents,
  factor: number
): EdgeWeightComponents {
  return {
    ...components,
    coactivation_bonus: Math.max(0, components.coactivation_bonus * factor),
  };
}

// ============================================================
// EXTRACTION EDGE FUNCTIONS
// ============================================================

/**
 * Calculates extraction edge result based on LLM confidence.
 */
export function calculateExtractionEdge(
  type: ExtendedEdgeType,
  llmConfidence: number
): ExtractionEdgeResult | null {
  const baseWeight = EDGE_WEIGHTS[type] ?? 0.5;

  if (llmConfidence >= EXTRACTION_CONFIG.confirmed_threshold) {
    const weight = baseWeight * llmConfidence;
    return {
      weight,
      status: 'confirmed',
      components: createWeightComponents({ base_weight: weight }),
    };
  }

  if (llmConfidence >= EXTRACTION_CONFIG.provisional_threshold) {
    const weight = baseWeight * llmConfidence * EXTRACTION_CONFIG.provisional_weight_factor;
    return {
      weight,
      status: 'provisional',
      components: createWeightComponents({ base_weight: weight }),
    };
  }

  return null;
}

/**
 * Creates provisional edge state.
 */
export function createProvisionalState(): ProvisionalEdgeState {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + EXTRACTION_CONFIG.provisional_expiry_days);

  return {
    created_at: now.toISOString(),
    activation_count: 0,
    expires_at: expiresAt.toISOString(),
  };
}

/**
 * Checks if provisional edge should be promoted.
 */
export function shouldPromoteProvisional(state: ProvisionalEdgeState): boolean {
  return state.activation_count >= EXTRACTION_CONFIG.provisional_promotion_activations;
}

/**
 * Checks if provisional edge has expired.
 */
export function shouldExpireProvisional(state: ProvisionalEdgeState): boolean {
  const now = new Date();
  const expiresAt = new Date(state.expires_at);

  return now > expiresAt && state.activation_count < EXTRACTION_CONFIG.provisional_promotion_activations;
}

/**
 * Increments provisional edge activation count.
 */
export function incrementProvisionalActivation(state: ProvisionalEdgeState): ProvisionalEdgeState {
  return {
    ...state,
    activation_count: state.activation_count + 1,
  };
}

// ============================================================
// SIMILARITY EDGE FUNCTIONS
// ============================================================

/**
 * Checks if similarity meets threshold for edge creation.
 */
export function meetsSimilarityThreshold(similarity: number): boolean {
  return similarity >= SIMILARITY_CONFIG.creation_threshold;
}

/**
 * Checks if embedding is fresh.
 */
export function isEmbeddingFresh(state: EmbeddingFreshnessState): boolean {
  const contentDate = new Date(state.last_content_update);
  const embeddingDate = new Date(state.last_embedding_update);
  return embeddingDate >= contentDate;
}

/**
 * Calculates similarity edge weight.
 */
export function calculateSimilarityWeight(cosineSimilarity: number): number {
  return cosineSimilarity;
}

// ============================================================
// USER EDGE FUNCTIONS
// ============================================================

/**
 * Calculates user edge weight with bounds.
 */
export function calculateUserEdgeWeight(userStrength?: number): number {
  if (userStrength === undefined) {
    return USER_EDGE_CONFIG.default_strength;
  }
  return Math.max(
    USER_EDGE_CONFIG.min_strength,
    Math.min(USER_EDGE_CONFIG.max_strength, userStrength)
  );
}

/**
 * Checks if edge type is allowed for user creation.
 */
export function isAllowedUserEdgeType(type: string): boolean {
  return USER_EDGE_CONFIG.allowed_types.includes(type as ExtendedEdgeType);
}

// ============================================================
// TEMPORAL EDGE FUNCTIONS
// ============================================================

/**
 * Calculates temporal weight based on time gap.
 * Uses exponential decay: e^(-t/30)
 */
export function calculateTemporalWeight(minutesApart: number): number | null {
  if (minutesApart > TEMPORAL_CONFIG.max_gap_minutes) {
    return null;
  }

  const rawWeight = Math.exp(-minutesApart / TEMPORAL_CONFIG.decay_constant);
  return Math.max(TEMPORAL_CONFIG.min_strength, rawWeight);
}

/**
 * Creates a temporal adjacent edge.
 */
export function createTemporalAdjacentEdge(
  nodeA: string,
  nodeB: string,
  minutesApart: number
): TemporalEdgeResult | null {
  const weight = calculateTemporalWeight(minutesApart);

  if (weight === null) {
    return null;
  }

  return {
    source: nodeA,
    target: nodeB,
    type: 'temporal_adjacent',
    weight,
    components: createWeightComponents({ base_weight: weight }),
  };
}

/**
 * Checks continuation edge eligibility between sessions.
 */
export function checkContinuationEligibility(
  currentSession: Session,
  previousSession: Session
): { should_create: boolean; overlapping_clusters: string[]; hours_between: number } {
  const gap = hoursBetween(previousSession.end, currentSession.start);

  if (gap > TEMPORAL_CONFIG.continuation_max_gap_hours) {
    return { should_create: false, overlapping_clusters: [], hours_between: gap };
  }

  const currentClusters = new Set(currentSession.accessedNodes.map((n) => n.cluster_id));
  const previousClusters = new Set(previousSession.accessedNodes.map((n) => n.cluster_id));
  const overlapping = [...currentClusters].filter((c) => previousClusters.has(c));

  return {
    should_create: overlapping.length > 0,
    overlapping_clusters: overlapping,
    hours_between: gap,
  };
}

/**
 * Detects continuation edges between sessions.
 */
export function detectContinuationEdges(
  currentSession: Session,
  previousSession: Session
): TemporalEdgeResult[] {
  const eligibility = checkContinuationEligibility(currentSession, previousSession);

  if (!eligibility.should_create) {
    return [];
  }

  const edges: TemporalEdgeResult[] = [];

  for (const clusterId of eligibility.overlapping_clusters) {
    const currentNodes = currentSession.accessedNodes.filter((n) => n.cluster_id === clusterId);
    const previousNodes = previousSession.accessedNodes.filter((n) => n.cluster_id === clusterId);

    for (const prev of previousNodes) {
      for (const curr of currentNodes) {
        if (prev.id !== curr.id) {
          edges.push({
            source: prev.id,
            target: curr.id,
            type: 'temporal_continuation',
            weight: TEMPORAL_CONFIG.continuation_base_weight,
            components: createWeightComponents({
              base_weight: TEMPORAL_CONFIG.continuation_base_weight,
            }),
          });
        }
      }
    }
  }

  return edges;
}

/**
 * Creates temporal edges for nodes in a session.
 */
export function createSessionTemporalEdges(session: Session): TemporalEdgeResult[] {
  const edges: TemporalEdgeResult[] = [];

  const sortedNodes = [...session.accessedNodes].sort(
    (a, b) => new Date(a.accessed_at).getTime() - new Date(b.accessed_at).getTime()
  );

  for (let i = 0; i < sortedNodes.length - 1; i++) {
    const current = sortedNodes[i]!;
    const next = sortedNodes[i + 1]!;
    const gap = minutesBetween(current.accessed_at, next.accessed_at);

    const edge = createTemporalAdjacentEdge(current.id, next.id, gap);
    if (edge) {
      edges.push(edge);
    }
  }

  return edges;
}

/**
 * Checks if a session has ended.
 */
export function hasSessionEnded(lastAccessTime: string, currentTime: string): boolean {
  const gap = minutesBetween(lastAccessTime, currentTime);
  return gap >= TEMPORAL_CONFIG.session_timeout_minutes;
}

// ============================================================
// CO-ACTIVATION FUNCTIONS
// ============================================================

/**
 * Determines if user engaged based on view duration.
 */
export function didUserEngage(viewDurationSeconds: number): boolean {
  return viewDurationSeconds >= COACTIVATION_CONFIG.engagement_threshold_seconds;
}

/**
 * Calculates strengthening delta using asymptotic formula.
 */
export function calculateStrengtheningDelta(currentWeight: number): number {
  return COACTIVATION_CONFIG.strengthen_delta * (COACTIVATION_CONFIG.max_weight - currentWeight);
}

/**
 * Updates co-activation weight based on user engagement.
 */
export function updateCoActivationWeight(
  edge: WeightedEdge,
  userEngaged: boolean
): CoactivationUpdateResult {
  const { effective_weight: previousWeight } = calculateEffectiveWeight(edge.components);
  let newEdge = { ...edge };
  let action: 'strengthened' | 'decayed' | 'unchanged' = 'unchanged';
  let reason = '';

  if (userEngaged) {
    newEdge.consecutive_ignored = 0;
    const delta = calculateStrengtheningDelta(previousWeight);
    newEdge.components = applyCoactivationBonus(edge.components, delta);
    action = 'strengthened';
    reason = `User engaged - added ${delta.toFixed(3)} to bonus`;
  } else {
    newEdge.consecutive_ignored = edge.consecutive_ignored + 1;

    if (newEdge.consecutive_ignored >= COACTIVATION_CONFIG.consecutive_ignores_before_decay) {
      newEdge.consecutive_ignored = 0;
      newEdge.components = applyCoactivationBonus(edge.components, -COACTIVATION_CONFIG.decay_delta);
      action = 'decayed';
      reason = `${COACTIVATION_CONFIG.consecutive_ignores_before_decay}+ consecutive ignores - subtracted ${COACTIVATION_CONFIG.decay_delta} from bonus`;
    } else {
      reason = `Ignored (${newEdge.consecutive_ignored}/${COACTIVATION_CONFIG.consecutive_ignores_before_decay} before decay)`;
    }
  }

  newEdge.activation_count = edge.activation_count + 1;
  newEdge.neural = {
    ...edge.neural,
    co_activation_count: edge.neural.co_activation_count + 1,
    last_co_activation: new Date().toISOString(),
  };

  const { effective_weight: newWeight } = calculateEffectiveWeight(newEdge.components);

  return {
    edge: newEdge,
    action,
    previous_weight: previousWeight,
    new_weight: newWeight,
    reason,
  };
}

/**
 * Applies time-based decay to an edge.
 */
export function applyTimeBasedDecay(edge: WeightedEdge): DecayResult {
  const daysSinceActivation = daysBetween(edge.neural.last_co_activation, new Date());

  if (daysSinceActivation < EDGE_DECAY_CONFIG.decay_start_days) {
    return {
      decay_periods: 0,
      decay_factor: 1.0,
      previous_bonus: edge.components.coactivation_bonus,
      new_bonus: edge.components.coactivation_bonus,
      decay_applied: false,
    };
  }

  const decayPeriods = Math.floor(
    (daysSinceActivation - EDGE_DECAY_CONFIG.decay_start_days) / EDGE_DECAY_CONFIG.decay_period_days
  );

  if (decayPeriods === 0) {
    return {
      decay_periods: 0,
      decay_factor: 1.0,
      previous_bonus: edge.components.coactivation_bonus,
      new_bonus: edge.components.coactivation_bonus,
      decay_applied: false,
    };
  }

  const decayFactor = Math.pow(EDGE_DECAY_CONFIG.decay_rate, decayPeriods);
  const previousBonus = edge.components.coactivation_bonus;
  const newBonus = Math.max(0, previousBonus * decayFactor);

  return {
    decay_periods: decayPeriods,
    decay_factor: decayFactor,
    previous_bonus: previousBonus,
    new_bonus: newBonus,
    decay_applied: true,
  };
}

/**
 * Checks if nodes are eligible for new co-activation edge.
 */
export function shouldConsiderNewEdge(similarity: number): boolean {
  return similarity > COACTIVATION_CONFIG.new_edge_similarity_threshold;
}

/**
 * Checks if an edge is "dead" (at minimum weight).
 */
export function isEdgeDead(edge: WeightedEdge): boolean {
  const { effective_weight } = calculateEffectiveWeight(edge.components);
  return effective_weight <= COACTIVATION_CONFIG.min_weight && edge.components.coactivation_bonus <= 0;
}

// ============================================================
// COMPRESSION FUNCTIONS
// ============================================================

/**
 * Gets compression configuration based on graph size.
 */
export function getCompressionConfig(graphSize: number): CompressionConfig {
  let minNodes: number;

  if (graphSize < GRAPH_SIZE_THRESHOLDS.small.max) {
    minNodes = GRAPH_SIZE_THRESHOLDS.small.min_nodes;
  } else if (graphSize < GRAPH_SIZE_THRESHOLDS.medium.max) {
    minNodes = GRAPH_SIZE_THRESHOLDS.medium.min_nodes;
  } else {
    minNodes = GRAPH_SIZE_THRESHOLDS.large.min_nodes;
  }

  return {
    never_compress: {
      is_pinned: true,
      is_starred: true,
      age_days_less_than: COMPRESSION_DEFAULTS.age_days_minimum,
    },
    candidate_requirements: {
      dormant_days_minimum: COMPRESSION_DEFAULTS.dormant_days_minimum,
      importance_max: COMPRESSION_DEFAULTS.importance_max,
      strong_active_edges_max: COMPRESSION_DEFAULTS.strong_active_edges_max,
    },
    clustering: {
      similarity_threshold: COMPRESSION_DEFAULTS.similarity_threshold,
      min_nodes_for_compression: minNodes,
      max_nodes_per_summary: COMPRESSION_DEFAULTS.max_nodes_per_summary,
    },
    retention: {
      restorable_days: COMPRESSION_DEFAULTS.restorable_days,
    },
  };
}

/**
 * Checks if a node should never be compressed.
 */
export function isNeverCompress(
  node: { is_pinned: boolean; is_starred: boolean; created_at: string },
  config: CompressionConfig
): boolean {
  if (node.is_pinned && config.never_compress.is_pinned) {
    return true;
  }
  if (node.is_starred && config.never_compress.is_starred) {
    return true;
  }

  const ageDays = daysBetween(node.created_at, new Date());
  if (ageDays < config.never_compress.age_days_less_than) {
    return true;
  }

  return false;
}

/**
 * Checks if a node meets compression requirements.
 */
export function meetsCompressionRequirements(
  node: { lifecycle: string; dormant_since?: string; importance_score: number },
  strongActiveEdges: number,
  config: CompressionConfig
): boolean {
  if (node.lifecycle !== 'dormant') {
    return false;
  }
  if (!node.dormant_since) {
    return false;
  }

  const dormantDays = daysBetween(node.dormant_since, new Date());
  if (dormantDays < config.candidate_requirements.dormant_days_minimum) {
    return false;
  }
  if (node.importance_score > config.candidate_requirements.importance_max) {
    return false;
  }
  if (strongActiveEdges > config.candidate_requirements.strong_active_edges_max) {
    return false;
  }

  return true;
}

/**
 * Creates compression state for a node.
 */
export function createCompressionState(
  summaryId: string,
  restorableDays: number
): NodeCompressionState {
  const now = new Date();
  const restorableUntil = new Date(now);
  restorableUntil.setDate(restorableUntil.getDate() + restorableDays);

  return {
    compressed_into: summaryId,
    compressed_at: now.toISOString(),
    restorable_until: restorableUntil.toISOString(),
  };
}

/**
 * Checks if a compressed node is still restorable.
 */
export function isRestorable(state: NodeCompressionState): boolean {
  if (!state.restorable_until) {
    return false;
  }
  const expiry = new Date(state.restorable_until);
  const now = new Date();
  return now < expiry;
}

/**
 * Creates an edge record for preservation.
 */
export function createEdgeRecord(
  sourceNodeId: string,
  targetNodeId: string,
  edgeType: string,
  weight: number
): CompressedEdgeRecord {
  return {
    original_source: sourceNodeId,
    target: targetNodeId,
    original_type: edgeType,
    original_weight: weight,
  };
}

/**
 * Calculates aggregated weight for summary edges.
 */
export function calculateAggregatedWeight(records: CompressedEdgeRecord[]): number | null {
  if (records.length === 0) {
    return null;
  }
  const maxWeight = Math.max(...records.map((r) => r.original_weight));
  return maxWeight >= 0.5 ? maxWeight : null;
}

/**
 * Generates a summary node ID.
 */
export function generateSummaryNodeId(): string {
  return 'sum_' + nanoid(NANOID_LENGTH);
}

// ============================================================
// WEIGHTED EDGE FACTORY
// ============================================================

/**
 * Creates a weighted edge from base properties.
 */
export function createWeightedEdge(options: {
  source: string;
  target: string;
  type: ExtendedEdgeType;
  status?: EdgeStatus;
  creationSource: EdgeCreationSource;
  baseWeight?: number;
  confidence?: number;
}): WeightedEdge {
  const now = new Date().toISOString();
  const baseWeight = options.baseWeight ?? EDGE_WEIGHTS[options.type] ?? 0.5;

  return {
    id: EDGE_ID_PREFIX + nanoid(NANOID_LENGTH),
    source: options.source,
    target: options.target,
    type: options.type,
    status: options.status ?? 'confirmed',
    strength: baseWeight,
    confidence: options.confidence ?? 1.0,
    neural: {
      co_activation_count: 0,
      last_co_activation: now,
      decay_factor: 1.0,
    },
    provenance: {
      source_type: options.creationSource as SourceType,
      created_at: now,
    },
    components: createWeightComponents({ base_weight: baseWeight }),
    creation_source: options.creationSource,
    consecutive_ignored: 0,
    activation_count: 0,
  };
}

// ============================================================
// VALIDATION FUNCTIONS
// ============================================================

export function validateWeightComponents(components: unknown): components is EdgeWeightComponents {
  return EdgeWeightComponentsSchema.safeParse(components).success;
}

export function validateProvisionalState(state: unknown): state is ProvisionalEdgeState {
  return ProvisionalEdgeStateSchema.safeParse(state).success;
}

export function validateSession(session: unknown): session is Session {
  return SessionSchema.safeParse(session).success;
}

export function validateSummaryNode(node: unknown): node is SummaryNode {
  return SummaryNodeSchema.safeParse(node).success;
}

export function validateCompressionState(state: unknown): state is NodeCompressionState {
  return NodeCompressionStateSchema.safeParse(state).success;
}

export function validateEmbeddingFreshness(state: unknown): state is EmbeddingFreshnessState {
  return EmbeddingFreshnessStateSchema.safeParse(state).success;
}
