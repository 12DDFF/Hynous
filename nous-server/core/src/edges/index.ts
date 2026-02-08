/**
 * @module @nous/core/edges
 * @description Edge schema for relationships between nodes
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-011/spec/edge-schema.ts
 *
 * Edges are first-class citizens in Nous. They enable:
 * - Graph traversal in SSA
 * - Relationship-aware retrieval
 * - Contradiction/supersession tracking
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  NANOID_LENGTH,
  EDGE_ID_PREFIX,
  EDGE_TYPES,
  SOURCE_TYPES,
  type EdgeType,
  type SourceType,
} from '../constants';

// ============================================================
// ID GENERATION
// ============================================================

/**
 * Generates a globally unique edge ID.
 * Format: "e_" + 12-character nanoid
 */
export function generateEdgeId(): string {
  return EDGE_ID_PREFIX + nanoid(NANOID_LENGTH);
}

// ============================================================
// EDGE NEURAL PROPERTIES
// ============================================================

/**
 * Neural properties for edge decay and strengthening.
 * Supports Hebbian learning ("neurons that fire together wire together").
 */
export interface EdgeNeuralProperties {
  /** How many times these nodes were activated together */
  co_activation_count: number;
  /** When nodes were last co-activated (ISO 8601) */
  last_co_activation: string;
  /** Current decay factor (0-1). Lower = more decayed */
  decay_factor: number;
}

export const EdgeNeuralPropertiesSchema = z.object({
  co_activation_count: z.number().int().min(0),
  last_co_activation: z.string().datetime(),
  decay_factor: z.number().min(0).max(1),
});

// ============================================================
// EDGE PROVENANCE
// ============================================================

/**
 * How this edge was created.
 */
export interface EdgeProvenance {
  /** How the edge was created */
  source_type: SourceType;
  /** When the edge was created (ISO 8601) */
  created_at: string;
  /** Confidence in extraction (if applicable) */
  extraction_confidence?: number;
}

export const EdgeProvenanceSchema = z.object({
  source_type: z.enum(SOURCE_TYPES),
  created_at: z.string().datetime(),
  extraction_confidence: z.number().min(0).max(1).optional(),
});

// ============================================================
// EDGE INTERFACE
// ============================================================

/**
 * A relationship between two nodes.
 *
 * Edges enable:
 * - SSA graph traversal (storm-005)
 * - Contradiction detection (storm-009)
 * - Cluster organization (storm-006)
 * - Weight-based retrieval ranking (storm-031)
 */
export interface NousEdge {
  /** Globally unique edge ID */
  id: string;
  /** Source node ID (where edge originates) */
  source: string;
  /** Target node ID (where edge points) */
  target: string;
  /** Relationship type */
  type: EdgeType;
  /** More specific subtype (e.g., "sibling", "parent") */
  subtype?: string;
  /** Connection strength (0-1). Higher = stronger relationship */
  strength: number;
  /** Confidence in this edge (0-1). Higher = more certain */
  confidence: number;
  /** Neural properties for decay/strengthening */
  neural: EdgeNeuralProperties;
  /** Where this edge came from */
  provenance: EdgeProvenance;
}

export const NousEdgeSchema = z.object({
  id: z.string().regex(/^e_[a-zA-Z0-9_-]{12}$/),
  source: z.string(),
  target: z.string(),
  type: z.enum(EDGE_TYPES),
  subtype: z.string().optional(),
  strength: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  neural: EdgeNeuralPropertiesSchema,
  provenance: EdgeProvenanceSchema,
});

// ============================================================
// EDGE CREATION RULES
// ============================================================

/**
 * Edge creation rule definitions.
 * These rules determine how edges are automatically created during extraction.
 */
export const EDGE_CREATION_RULES = {
  /** Rule 1: Co-mention - Entities mentioned in the same sentence */
  CO_MENTION: {
    type: 'relates_to' as EdgeType,
    defaultStrength: 0.5,
    description: 'Entities in same sentence',
  },

  /** Rule 2: Explicit relation - "X causes Y" */
  EXPLICIT_CAUSAL: {
    type: 'causes' as EdgeType,
    defaultStrength: 0.8,
    description: 'Explicit causal statement',
  },

  /** Rule 3: Containment - "X is part of Y" */
  EXPLICIT_CONTAINMENT: {
    type: 'part_of' as EdgeType,
    defaultStrength: 0.9,
    description: 'Explicit containment',
  },

  /** Rule 4: Temporal sequence - Events in order */
  TEMPORAL_SEQUENCE: {
    type: 'precedes' as EdgeType,
    defaultStrength: 0.7,
    description: 'Events in temporal order',
  },

  /** Rule 5: Extraction origin - Concept extracted from Episode */
  EXTRACTION_ORIGIN: {
    type: 'mentioned_in' as EdgeType,
    defaultStrength: 1.0,
    description: 'Concept from episode',
  },

  /** Rule 6: Embedding similarity - cosine > 0.85 */
  EMBEDDING_SIMILARITY: {
    type: 'similar_to' as EdgeType,
    threshold: 0.85,
    description: 'High semantic similarity',
  },
} as const;

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

export interface CreateEdgeOptions {
  subtype?: string;
  strength?: number;
  confidence?: number;
  sourceType?: SourceType;
  extractionConfidence?: number;
}

/**
 * Creates a new edge with default values.
 */
export function createEdge(
  source: string,
  target: string,
  type: EdgeType,
  options: CreateEdgeOptions = {}
): NousEdge {
  const now = new Date().toISOString();

  return {
    id: generateEdgeId(),
    source,
    target,
    type,
    subtype: options.subtype,
    strength: options.strength ?? 0.5,
    confidence: options.confidence ?? 1.0,
    neural: {
      co_activation_count: 0,
      last_co_activation: now,
      decay_factor: 1.0,
    },
    provenance: {
      source_type: options.sourceType ?? 'manual',
      created_at: now,
      extraction_confidence: options.extractionConfidence,
    },
  };
}

/**
 * Creates default neural properties for a new edge.
 */
export function createDefaultEdgeNeuralProperties(): EdgeNeuralProperties {
  return {
    co_activation_count: 0,
    last_co_activation: new Date().toISOString(),
    decay_factor: 1.0,
  };
}

// ============================================================
// EDGE MODIFICATION FUNCTIONS
// ============================================================

/**
 * Strengthens an edge based on co-activation (Hebbian learning).
 * "Neurons that fire together wire together."
 */
export function strengthenEdge(edge: NousEdge, amount: number = 0.1): NousEdge {
  const now = new Date().toISOString();

  return {
    ...edge,
    strength: Math.min(1.0, edge.strength + amount),
    neural: {
      ...edge.neural,
      co_activation_count: edge.neural.co_activation_count + 1,
      last_co_activation: now,
    },
  };
}

/**
 * Applies decay to an edge.
 * Used by the forgetting model (storm-007).
 */
export function decayEdge(edge: NousEdge, decayRate: number = 0.05): NousEdge {
  return {
    ...edge,
    neural: {
      ...edge.neural,
      decay_factor: Math.max(0, edge.neural.decay_factor - decayRate),
    },
  };
}

/**
 * Resets an edge's decay factor (reactivation).
 */
export function reactivateEdge(edge: NousEdge): NousEdge {
  return {
    ...edge,
    neural: {
      ...edge.neural,
      decay_factor: 1.0,
      last_co_activation: new Date().toISOString(),
    },
  };
}

/**
 * Updates an edge's confidence.
 */
export function updateEdgeConfidence(edge: NousEdge, confidence: number): NousEdge {
  return {
    ...edge,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

// ============================================================
// QUERY HELPERS
// ============================================================

/**
 * Checks if an edge connects two specific nodes (in either direction).
 */
export function edgeConnects(edge: NousEdge, nodeA: string, nodeB: string): boolean {
  return (
    (edge.source === nodeA && edge.target === nodeB) ||
    (edge.source === nodeB && edge.target === nodeA)
  );
}

/**
 * Gets the other node in an edge.
 */
export function getOtherNode(edge: NousEdge, nodeId: string): string | undefined {
  if (edge.source === nodeId) return edge.target;
  if (edge.target === nodeId) return edge.source;
  return undefined;
}

/**
 * Checks if an edge is below the decay threshold.
 */
export function isEdgeDecayed(edge: NousEdge, threshold: number = 0.1): boolean {
  return edge.neural.decay_factor < threshold;
}

/**
 * Checks if an edge should be pruned based on age and decay.
 */
export function shouldPruneEdge(
  edge: NousEdge,
  maxAgeDays: number = 90,
  decayThreshold: number = 0.1
): boolean {
  const ageMs = Date.now() - new Date(edge.neural.last_co_activation).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  return ageDays > maxAgeDays && edge.neural.decay_factor < decayThreshold;
}

/**
 * Filters edges by type.
 */
export function filterEdgesByType(edges: NousEdge[], type: EdgeType): NousEdge[] {
  return edges.filter((edge) => edge.type === type);
}

/**
 * Gets all edges connected to a node.
 */
export function getEdgesForNode(edges: NousEdge[], nodeId: string): NousEdge[] {
  return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
}

/**
 * Gets outgoing edges from a node.
 */
export function getOutgoingEdges(edges: NousEdge[], nodeId: string): NousEdge[] {
  return edges.filter((edge) => edge.source === nodeId);
}

/**
 * Gets incoming edges to a node.
 */
export function getIncomingEdges(edges: NousEdge[], nodeId: string): NousEdge[] {
  return edges.filter((edge) => edge.target === nodeId);
}

/**
 * Sorts edges by strength (descending).
 */
export function sortEdgesByStrength(edges: NousEdge[]): NousEdge[] {
  return [...edges].sort((a, b) => b.strength - a.strength);
}

/**
 * Sorts edges by co-activation count (descending).
 */
export function sortEdgesByCoActivation(edges: NousEdge[]): NousEdge[] {
  return [...edges].sort(
    (a, b) => b.neural.co_activation_count - a.neural.co_activation_count
  );
}

// ============================================================
// EDGE VALIDATION
// ============================================================

/**
 * Validates an edge against the schema.
 */
export function validateEdge(edge: unknown): edge is NousEdge {
  return NousEdgeSchema.safeParse(edge).success;
}

/**
 * Parses and validates edge data.
 */
export function parseEdge(data: unknown): NousEdge {
  return NousEdgeSchema.parse(data);
}

/**
 * Safely parses edge data, returning null on failure.
 */
export function safeParseEdge(data: unknown): NousEdge | null {
  const result = NousEdgeSchema.safeParse(data);
  return result.success ? result.data : null;
}

// ============================================================
// RE-EXPORTS
// ============================================================

export type { EdgeType, SourceType };

// Export weight module (storm-031)
export * from './weight/index';
