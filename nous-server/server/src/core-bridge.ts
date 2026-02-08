/**
 * Core Bridge — Adapter between DB rows and @nous/core functions
 *
 * The server stores flat SQL rows. @nous/core operates on typed objects.
 * This module converts between the two, and applies FSRS decay + lifecycle
 * transitions on read.
 */

import {
  calculateRetrievability,
  getDecayLifecycleState,
  updateStabilityOnAccess,
  getInitialStability,
  getInitialDifficulty,
  DECAY_CONFIG,
  SSA_EDGE_WEIGHTS,
  type ScoredNode,
  type AlgorithmNodeType,
  type DecayLifecycleState,
} from '@nous/core/params';

// ---- Type mappings ----

/** Map our node subtypes to @nous/core AlgorithmNodeType for FSRS defaults */
const SUBTYPE_TO_ALGO_TYPE: Record<string, AlgorithmNodeType> = {
  'custom:watchpoint': 'concept',
  'custom:curiosity': 'concept',
  'custom:lesson': 'fact',
  'custom:thesis': 'concept',
  'custom:market_event': 'event',
  'custom:trade': 'fact',
  'custom:signal': 'fact',
  'custom:preference': 'preference',
  'custom:turn_summary': 'event',     // Compressed exchange — stability ~10 days, decays fast
  'custom:session_summary': 'note',   // Session digest — stability ~30 days, more durable
  // Trade lifecycle — concept type for 21-day stability (trade memories should persist)
  'custom:trade_entry': 'concept',    // Thesis + entry — 21 days, durable
  'custom:trade_close': 'concept',    // Outcome + PnL — 21 days, durable (outcomes are lessons)
  'custom:trade_modify': 'concept',   // Position adjustment — 21 days, part of trade lifecycle
};

/** Map node type to AlgorithmNodeType fallback */
const TYPE_TO_ALGO_TYPE: Record<string, AlgorithmNodeType> = {
  concept: 'concept',
  episode: 'event',
  person: 'person',
  document: 'document',
  note: 'note',
};

export function getAlgoType(type: string, subtype?: string | null): AlgorithmNodeType {
  if (subtype && subtype in SUBTYPE_TO_ALGO_TYPE) {
    return SUBTYPE_TO_ALGO_TYPE[subtype]!;
  }
  return TYPE_TO_ALGO_TYPE[type] ?? 'concept';
}

// ---- Row types (what the DB returns) ----

export interface NodeRow {
  id: string;
  type: string;
  subtype: string | null;
  content_title: string | null;
  content_summary: string | null;
  content_body: string | null;
  neural_stability: number;
  neural_retrievability: number;
  neural_difficulty: number;
  neural_access_count: number;
  neural_last_accessed: string | null;
  state_lifecycle: string;
  provenance_source: string;
  provenance_created_at: string;
  layer: string;
  version: number;
  last_modified: string;
  created_at: string;
  // Embedding (Phase 1)
  embedding_vector: ArrayBuffer | null;
  embedding_model: string | null;
  // Temporal (Phase 2)
  temporal_event_time: string | null;
  temporal_event_confidence: number | null;
  temporal_event_source: string | null;
}

export interface EdgeRow {
  id: string;
  type: string;
  subtype: string | null;
  source_id: string;
  target_id: string;
  neural_weight: number;
  strength: number;
  confidence: number;
  created_at: string;
}

// ---- FSRS Decay Application ----

/**
 * Compute current retrievability and lifecycle state from a node row.
 * Pure function — does not modify the row or write to DB.
 */
export function computeDecay(row: NodeRow): {
  retrievability: number;
  lifecycle_state: DecayLifecycleState;
  days_since_access: number;
} {
  const lastAccessed = row.neural_last_accessed
    ? new Date(row.neural_last_accessed)
    : new Date(row.provenance_created_at);
  const daysSinceAccess = Math.max(0, (Date.now() - lastAccessed.getTime()) / 86_400_000);

  const retrievability = calculateRetrievability(daysSinceAccess, row.neural_stability);

  // Days dormant = days below weak threshold
  const daysDormant = retrievability < DECAY_CONFIG.weak_threshold ? daysSinceAccess : 0;
  const lifecycle_state = getDecayLifecycleState(retrievability, daysDormant);

  return { retrievability, lifecycle_state, days_since_access: daysSinceAccess };
}

/**
 * Apply decay to a node row, returning the row with updated computed fields.
 * Does NOT mutate the input row.
 */
export function applyDecay<T extends NodeRow>(row: T): T & {
  neural_retrievability: number;
  state_lifecycle: string;
} {
  const { retrievability, lifecycle_state } = computeDecay(row);
  return {
    ...row,
    neural_retrievability: Math.round(retrievability * 10000) / 10000,
    state_lifecycle: lifecycle_state,
  };
}

// ---- Stability Update on Access ----

/**
 * Calculate new stability after a recall event (FSRS growth).
 * Returns the new stability value (in days).
 */
export function computeStabilityGrowth(
  currentStability: number,
  difficulty: number,
): number {
  return updateStabilityOnAccess(currentStability, difficulty);
}

// ---- Neural Defaults for New Nodes ----

/**
 * Get FSRS-appropriate neural defaults for a new node.
 */
export function getNeuralDefaults(type: string, subtype?: string | null): {
  neural_stability: number;
  neural_retrievability: number;
  neural_difficulty: number;
} {
  const algoType = getAlgoType(type, subtype);
  return {
    neural_stability: getInitialStability(algoType),
    neural_retrievability: 1.0, // just created = perfect recall
    neural_difficulty: getInitialDifficulty(algoType),
  };
}

// ---- Edge Weight Defaults ----

/** Map @nous/core edge types to their SSA default weights */
const EDGE_TYPE_WEIGHTS: Record<string, number> = {
  relates_to: SSA_EDGE_WEIGHTS.related_to,
  part_of: SSA_EDGE_WEIGHTS.part_of,
  causes: SSA_EDGE_WEIGHTS.caused_by,
  precedes: SSA_EDGE_WEIGHTS.temporal_adjacent,
  similar_to: SSA_EDGE_WEIGHTS.similar_to,
  mentioned_in: SSA_EDGE_WEIGHTS.mentioned_together,
  derived_from: SSA_EDGE_WEIGHTS.related_to,
  contradicts: SSA_EDGE_WEIGHTS.related_to,
  supersedes: SSA_EDGE_WEIGHTS.related_to,
  user_linked: SSA_EDGE_WEIGHTS.user_linked ?? 0.90,
};

export function getDefaultEdgeWeight(edgeType: string): number {
  return EDGE_TYPE_WEIGHTS[edgeType] ?? 0.5;
}

// ---- Row → ScoredNode (for reranking) ----

/**
 * Convert a node DB row + optional BM25 rank to a ScoredNode for reranking.
 */
export function rowToScoredNode(
  row: NodeRow,
  bm25Score?: number,
  inboundEdgeCount?: number,
): ScoredNode {
  return {
    id: row.id,
    bm25_score: bm25Score ?? 0,
    last_accessed: row.neural_last_accessed
      ? new Date(row.neural_last_accessed)
      : new Date(row.provenance_created_at),
    created_at: new Date(row.created_at),
    access_count: row.neural_access_count,
    inbound_edge_count: inboundEdgeCount ?? 0,
  };
}
