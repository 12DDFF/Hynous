import { z } from 'zod';
import { nanoid } from 'nanoid';

// src/edges/index.ts

// src/constants.ts
var NANOID_LENGTH = 12;
var EDGE_ID_PREFIX = "e_";
var EDGE_TYPES = [
  "relates_to",
  "part_of",
  "mentioned_in",
  "causes",
  "precedes",
  "contradicts",
  "supersedes",
  "derived_from",
  "similar_to"
];
var SOURCE_TYPES = [
  "extraction",
  "manual",
  "inference",
  "import"
];
var EXTENDED_EDGE_TYPES = [
  // From storm-011
  "relates_to",
  "part_of",
  "mentioned_in",
  "causes",
  "precedes",
  "contradicts",
  "supersedes",
  "derived_from",
  "similar_to",
  // New in storm-031
  "same_entity",
  "user_linked",
  "caused_by",
  "mentioned_together",
  "temporal_adjacent",
  "temporal_continuation",
  "summarizes"
];
var EDGE_WEIGHTS = {
  // Identity / structural (highest)
  same_entity: 0.95,
  summarizes: 0.95,
  // User-created (high trust)
  user_linked: 0.9,
  // Semantic relationships
  part_of: 0.85,
  caused_by: 0.8,
  causes: 0.8,
  contradicts: 0.75,
  supersedes: 0.75,
  derived_from: 0.7,
  precedes: 0.65,
  mentioned_together: 0.6,
  mentioned_in: 0.55,
  relates_to: 0.5,
  similar_to: 0.45,
  // Temporal (lowest)
  temporal_adjacent: 0.4,
  temporal_continuation: 0.3
};
var EDGE_STATUSES = ["confirmed", "provisional"];
var EDGE_CREATION_SOURCES = [
  "extraction",
  "similarity",
  "user",
  "temporal",
  "coactivation",
  "compression"
];
var EXTRACTION_CONFIG = {
  confirmed_threshold: 0.7,
  provisional_threshold: 0.5,
  rejection_threshold: 0.5,
  provisional_weight_factor: 0.5,
  provisional_promotion_activations: 3,
  provisional_expiry_days: 30
};
var SIMILARITY_CONFIG = {
  creation_threshold: 0.85,
  edge_type: "similar_to",
  batch_frequency: "daily",
  max_edges_per_node: 10,
  exclude_same_cluster: false
};
var USER_EDGE_CONFIG = {
  default_strength: 0.9,
  min_strength: 0.5,
  max_strength: 1,
  default_type: "user_linked",
  allowed_types: [
    "user_linked",
    "relates_to",
    "part_of",
    "caused_by",
    "contradicts",
    "supersedes",
    "derived_from"
  ]
};
var TEMPORAL_CONFIG = {
  session_timeout_minutes: 30,
  edge_type: "temporal_adjacent",
  decay_constant: 30,
  max_gap_minutes: 120,
  min_strength: 0.2,
  continuation_max_gap_hours: 24,
  continuation_base_weight: 0.3,
  continuation_same_cluster_required: true,
  continuation_edge_type: "temporal_continuation"
};
var COACTIVATION_CONFIG = {
  strengthen_delta: 0.1,
  decay_delta: 0.02,
  min_weight: 0.1,
  max_weight: 1,
  engagement_threshold_seconds: 5,
  consecutive_ignores_before_decay: 3,
  max_coactivation_bonus: 0.3,
  new_edge_similarity_threshold: 0.5
};
var EDGE_DECAY_CONFIG = {
  decay_start_days: 30,
  decay_rate: 0.95,
  decay_period_days: 30,
  floor: 0.1
};
var COMPRESSION_DEFAULTS = {
  min_nodes_for_compression: 5,
  similarity_threshold: 0.75,
  max_nodes_per_summary: 20,
  restorable_days: 365,
  dormant_days_minimum: 60,
  importance_max: 0.3,
  strong_active_edges_max: 2,
  age_days_minimum: 30
};
var GRAPH_SIZE_THRESHOLDS = {
  small: { max: 500, min_nodes: 3 },
  medium: { max: 5e3, min_nodes: 5 },
  large: { max: Infinity, min_nodes: 10 }
};
var WEIGHT_BOUNDS = {
  min: 0.1,
  max: 1
};
var LEARNED_ADJUSTMENT_BOUNDS = {
  min: -0.3,
  max: 0.3
};
var EdgeWeightComponentsSchema = z.object({
  base_weight: z.number().min(0).max(1),
  learned_adjustment: z.number().min(LEARNED_ADJUSTMENT_BOUNDS.min).max(LEARNED_ADJUSTMENT_BOUNDS.max),
  coactivation_bonus: z.number().min(0).max(COACTIVATION_CONFIG.max_coactivation_bonus)
});
var EdgeStatusSchema = z.enum(EDGE_STATUSES);
var EdgeCreationSourceSchema = z.enum(EDGE_CREATION_SOURCES);
var ProvisionalEdgeStateSchema = z.object({
  created_at: z.string().datetime(),
  activation_count: z.number().int().min(0),
  expires_at: z.string().datetime()
});
var ExtractionEdgeResultSchema = z.object({
  weight: z.number().min(0).max(1),
  status: EdgeStatusSchema,
  components: EdgeWeightComponentsSchema
});
var SessionNodeSchema = z.object({
  id: z.string(),
  cluster_id: z.string(),
  accessed_at: z.string().datetime()
});
var SessionSchema = z.object({
  id: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  accessedNodes: z.array(SessionNodeSchema)
});
var TemporalEdgeResultSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(["temporal_adjacent", "temporal_continuation"]),
  weight: z.number().min(0).max(1),
  components: EdgeWeightComponentsSchema
});
var DecayResultSchema = z.object({
  decay_periods: z.number().int().min(0),
  decay_factor: z.number().min(0).max(1),
  previous_bonus: z.number().min(0),
  new_bonus: z.number().min(0),
  decay_applied: z.boolean()
});
var SummaryContentSchema = z.object({
  title: z.string().max(60),
  body: z.string(),
  preserved_entities: z.array(z.string()),
  key_facts: z.array(z.string()),
  temporal_span: z.string().nullable()
});
var CompressedEdgeRecordSchema = z.object({
  original_source: z.string(),
  target: z.string(),
  original_type: z.string(),
  original_weight: z.number().min(0).max(1)
});
var SummaryNodeSchema = z.object({
  id: z.string(),
  type: z.literal("summary"),
  content: SummaryContentSchema,
  compressed_from: z.array(z.string()),
  compressed_edges: z.array(CompressedEdgeRecordSchema),
  cluster_id: z.string(),
  created_at: z.string().datetime()
});
var NodeCompressionStateSchema = z.object({
  compressed_into: z.string().optional(),
  compressed_at: z.string().datetime().optional(),
  restorable_until: z.string().datetime().optional()
});
var EmbeddingFreshnessStateSchema = z.object({
  embedding_version: z.number().int().min(0),
  last_content_update: z.string().datetime(),
  last_embedding_update: z.string().datetime()
});
function daysBetween(start, end) {
  const startDate = typeof start === "string" ? new Date(start) : start;
  const endDate = typeof end === "string" ? new Date(end) : end;
  return Math.floor((endDate.getTime() - startDate.getTime()) / (1e3 * 60 * 60 * 24));
}
function minutesBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.abs(endDate.getTime() - startDate.getTime()) / (1e3 * 60);
}
function hoursBetween(start, end) {
  return minutesBetween(start, end) / 60;
}
function calculateEffectiveWeight(components) {
  const adjustedBase = components.base_weight * (1 + components.learned_adjustment);
  const rawValue = adjustedBase + components.coactivation_bonus;
  const clamped = Math.max(WEIGHT_BOUNDS.min, Math.min(WEIGHT_BOUNDS.max, rawValue));
  return {
    effective_weight: clamped,
    was_clamped: clamped !== rawValue,
    raw_value: rawValue
  };
}
function createWeightComponents(input) {
  return {
    base_weight: input.base_weight,
    learned_adjustment: input.learned_adjustment ?? 0,
    coactivation_bonus: input.coactivation_bonus ?? 0
  };
}
function applyLearningAdjustment(components, delta) {
  const newAdjustment = components.learned_adjustment + delta;
  const clamped = Math.max(
    LEARNED_ADJUSTMENT_BOUNDS.min,
    Math.min(LEARNED_ADJUSTMENT_BOUNDS.max, newAdjustment)
  );
  return {
    ...components,
    learned_adjustment: clamped
  };
}
function applyCoactivationBonus(components, delta) {
  const newBonus = components.coactivation_bonus + delta;
  const clamped = Math.max(0, Math.min(COACTIVATION_CONFIG.max_coactivation_bonus, newBonus));
  return {
    ...components,
    coactivation_bonus: clamped
  };
}
function decayCoactivationBonus(components, factor) {
  return {
    ...components,
    coactivation_bonus: Math.max(0, components.coactivation_bonus * factor)
  };
}
function calculateExtractionEdge(type, llmConfidence) {
  const baseWeight = EDGE_WEIGHTS[type] ?? 0.5;
  if (llmConfidence >= EXTRACTION_CONFIG.confirmed_threshold) {
    const weight = baseWeight * llmConfidence;
    return {
      weight,
      status: "confirmed",
      components: createWeightComponents({ base_weight: weight })
    };
  }
  if (llmConfidence >= EXTRACTION_CONFIG.provisional_threshold) {
    const weight = baseWeight * llmConfidence * EXTRACTION_CONFIG.provisional_weight_factor;
    return {
      weight,
      status: "provisional",
      components: createWeightComponents({ base_weight: weight })
    };
  }
  return null;
}
function createProvisionalState() {
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + EXTRACTION_CONFIG.provisional_expiry_days);
  return {
    created_at: now.toISOString(),
    activation_count: 0,
    expires_at: expiresAt.toISOString()
  };
}
function shouldPromoteProvisional(state) {
  return state.activation_count >= EXTRACTION_CONFIG.provisional_promotion_activations;
}
function shouldExpireProvisional(state) {
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(state.expires_at);
  return now > expiresAt && state.activation_count < EXTRACTION_CONFIG.provisional_promotion_activations;
}
function incrementProvisionalActivation(state) {
  return {
    ...state,
    activation_count: state.activation_count + 1
  };
}
function meetsSimilarityThreshold(similarity) {
  return similarity >= SIMILARITY_CONFIG.creation_threshold;
}
function isEmbeddingFresh(state) {
  const contentDate = new Date(state.last_content_update);
  const embeddingDate = new Date(state.last_embedding_update);
  return embeddingDate >= contentDate;
}
function calculateSimilarityWeight(cosineSimilarity) {
  return cosineSimilarity;
}
function calculateUserEdgeWeight(userStrength) {
  if (userStrength === void 0) {
    return USER_EDGE_CONFIG.default_strength;
  }
  return Math.max(
    USER_EDGE_CONFIG.min_strength,
    Math.min(USER_EDGE_CONFIG.max_strength, userStrength)
  );
}
function isAllowedUserEdgeType(type) {
  return USER_EDGE_CONFIG.allowed_types.includes(type);
}
function calculateTemporalWeight(minutesApart) {
  if (minutesApart > TEMPORAL_CONFIG.max_gap_minutes) {
    return null;
  }
  const rawWeight = Math.exp(-minutesApart / TEMPORAL_CONFIG.decay_constant);
  return Math.max(TEMPORAL_CONFIG.min_strength, rawWeight);
}
function createTemporalAdjacentEdge(nodeA, nodeB, minutesApart) {
  const weight = calculateTemporalWeight(minutesApart);
  if (weight === null) {
    return null;
  }
  return {
    source: nodeA,
    target: nodeB,
    type: "temporal_adjacent",
    weight,
    components: createWeightComponents({ base_weight: weight })
  };
}
function checkContinuationEligibility(currentSession, previousSession) {
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
    hours_between: gap
  };
}
function detectContinuationEdges(currentSession, previousSession) {
  const eligibility = checkContinuationEligibility(currentSession, previousSession);
  if (!eligibility.should_create) {
    return [];
  }
  const edges = [];
  for (const clusterId of eligibility.overlapping_clusters) {
    const currentNodes = currentSession.accessedNodes.filter((n) => n.cluster_id === clusterId);
    const previousNodes = previousSession.accessedNodes.filter((n) => n.cluster_id === clusterId);
    for (const prev of previousNodes) {
      for (const curr of currentNodes) {
        if (prev.id !== curr.id) {
          edges.push({
            source: prev.id,
            target: curr.id,
            type: "temporal_continuation",
            weight: TEMPORAL_CONFIG.continuation_base_weight,
            components: createWeightComponents({
              base_weight: TEMPORAL_CONFIG.continuation_base_weight
            })
          });
        }
      }
    }
  }
  return edges;
}
function createSessionTemporalEdges(session) {
  const edges = [];
  const sortedNodes = [...session.accessedNodes].sort(
    (a, b) => new Date(a.accessed_at).getTime() - new Date(b.accessed_at).getTime()
  );
  for (let i = 0; i < sortedNodes.length - 1; i++) {
    const current = sortedNodes[i];
    const next = sortedNodes[i + 1];
    const gap = minutesBetween(current.accessed_at, next.accessed_at);
    const edge = createTemporalAdjacentEdge(current.id, next.id, gap);
    if (edge) {
      edges.push(edge);
    }
  }
  return edges;
}
function hasSessionEnded(lastAccessTime, currentTime) {
  const gap = minutesBetween(lastAccessTime, currentTime);
  return gap >= TEMPORAL_CONFIG.session_timeout_minutes;
}
function didUserEngage(viewDurationSeconds) {
  return viewDurationSeconds >= COACTIVATION_CONFIG.engagement_threshold_seconds;
}
function calculateStrengtheningDelta(currentWeight) {
  return COACTIVATION_CONFIG.strengthen_delta * (COACTIVATION_CONFIG.max_weight - currentWeight);
}
function updateCoActivationWeight(edge, userEngaged) {
  const { effective_weight: previousWeight } = calculateEffectiveWeight(edge.components);
  let newEdge = { ...edge };
  let action = "unchanged";
  let reason = "";
  if (userEngaged) {
    newEdge.consecutive_ignored = 0;
    const delta = calculateStrengtheningDelta(previousWeight);
    newEdge.components = applyCoactivationBonus(edge.components, delta);
    action = "strengthened";
    reason = `User engaged - added ${delta.toFixed(3)} to bonus`;
  } else {
    newEdge.consecutive_ignored = edge.consecutive_ignored + 1;
    if (newEdge.consecutive_ignored >= COACTIVATION_CONFIG.consecutive_ignores_before_decay) {
      newEdge.consecutive_ignored = 0;
      newEdge.components = applyCoactivationBonus(edge.components, -COACTIVATION_CONFIG.decay_delta);
      action = "decayed";
      reason = `${COACTIVATION_CONFIG.consecutive_ignores_before_decay}+ consecutive ignores - subtracted ${COACTIVATION_CONFIG.decay_delta} from bonus`;
    } else {
      reason = `Ignored (${newEdge.consecutive_ignored}/${COACTIVATION_CONFIG.consecutive_ignores_before_decay} before decay)`;
    }
  }
  newEdge.activation_count = edge.activation_count + 1;
  newEdge.neural = {
    ...edge.neural,
    co_activation_count: edge.neural.co_activation_count + 1,
    last_co_activation: (/* @__PURE__ */ new Date()).toISOString()
  };
  const { effective_weight: newWeight } = calculateEffectiveWeight(newEdge.components);
  return {
    edge: newEdge,
    action,
    previous_weight: previousWeight,
    new_weight: newWeight,
    reason
  };
}
function applyTimeBasedDecay(edge) {
  const daysSinceActivation = daysBetween(edge.neural.last_co_activation, /* @__PURE__ */ new Date());
  if (daysSinceActivation < EDGE_DECAY_CONFIG.decay_start_days) {
    return {
      decay_periods: 0,
      decay_factor: 1,
      previous_bonus: edge.components.coactivation_bonus,
      new_bonus: edge.components.coactivation_bonus,
      decay_applied: false
    };
  }
  const decayPeriods = Math.floor(
    (daysSinceActivation - EDGE_DECAY_CONFIG.decay_start_days) / EDGE_DECAY_CONFIG.decay_period_days
  );
  if (decayPeriods === 0) {
    return {
      decay_periods: 0,
      decay_factor: 1,
      previous_bonus: edge.components.coactivation_bonus,
      new_bonus: edge.components.coactivation_bonus,
      decay_applied: false
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
    decay_applied: true
  };
}
function shouldConsiderNewEdge(similarity) {
  return similarity > COACTIVATION_CONFIG.new_edge_similarity_threshold;
}
function isEdgeDead(edge) {
  const { effective_weight } = calculateEffectiveWeight(edge.components);
  return effective_weight <= COACTIVATION_CONFIG.min_weight && edge.components.coactivation_bonus <= 0;
}
function getCompressionConfig(graphSize) {
  let minNodes;
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
      age_days_less_than: COMPRESSION_DEFAULTS.age_days_minimum
    },
    candidate_requirements: {
      dormant_days_minimum: COMPRESSION_DEFAULTS.dormant_days_minimum,
      importance_max: COMPRESSION_DEFAULTS.importance_max,
      strong_active_edges_max: COMPRESSION_DEFAULTS.strong_active_edges_max
    },
    clustering: {
      similarity_threshold: COMPRESSION_DEFAULTS.similarity_threshold,
      min_nodes_for_compression: minNodes,
      max_nodes_per_summary: COMPRESSION_DEFAULTS.max_nodes_per_summary
    },
    retention: {
      restorable_days: COMPRESSION_DEFAULTS.restorable_days
    }
  };
}
function isNeverCompress(node, config) {
  if (node.is_pinned && config.never_compress.is_pinned) {
    return true;
  }
  if (node.is_starred && config.never_compress.is_starred) {
    return true;
  }
  const ageDays = daysBetween(node.created_at, /* @__PURE__ */ new Date());
  if (ageDays < config.never_compress.age_days_less_than) {
    return true;
  }
  return false;
}
function meetsCompressionRequirements(node, strongActiveEdges, config) {
  if (node.lifecycle !== "dormant") {
    return false;
  }
  if (!node.dormant_since) {
    return false;
  }
  const dormantDays = daysBetween(node.dormant_since, /* @__PURE__ */ new Date());
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
function createCompressionState(summaryId, restorableDays) {
  const now = /* @__PURE__ */ new Date();
  const restorableUntil = new Date(now);
  restorableUntil.setDate(restorableUntil.getDate() + restorableDays);
  return {
    compressed_into: summaryId,
    compressed_at: now.toISOString(),
    restorable_until: restorableUntil.toISOString()
  };
}
function isRestorable(state) {
  if (!state.restorable_until) {
    return false;
  }
  const expiry = new Date(state.restorable_until);
  const now = /* @__PURE__ */ new Date();
  return now < expiry;
}
function createEdgeRecord(sourceNodeId, targetNodeId, edgeType, weight) {
  return {
    original_source: sourceNodeId,
    target: targetNodeId,
    original_type: edgeType,
    original_weight: weight
  };
}
function calculateAggregatedWeight(records) {
  if (records.length === 0) {
    return null;
  }
  const maxWeight = Math.max(...records.map((r) => r.original_weight));
  return maxWeight >= 0.5 ? maxWeight : null;
}
function generateSummaryNodeId() {
  return "sum_" + nanoid(NANOID_LENGTH);
}
function createWeightedEdge(options) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const baseWeight = options.baseWeight ?? EDGE_WEIGHTS[options.type] ?? 0.5;
  return {
    id: EDGE_ID_PREFIX + nanoid(NANOID_LENGTH),
    source: options.source,
    target: options.target,
    type: options.type,
    status: options.status ?? "confirmed",
    strength: baseWeight,
    confidence: options.confidence ?? 1,
    neural: {
      co_activation_count: 0,
      last_co_activation: now,
      decay_factor: 1
    },
    provenance: {
      source_type: options.creationSource,
      created_at: now
    },
    components: createWeightComponents({ base_weight: baseWeight }),
    creation_source: options.creationSource,
    consecutive_ignored: 0,
    activation_count: 0
  };
}
function validateWeightComponents(components) {
  return EdgeWeightComponentsSchema.safeParse(components).success;
}
function validateProvisionalState(state) {
  return ProvisionalEdgeStateSchema.safeParse(state).success;
}
function validateSession(session) {
  return SessionSchema.safeParse(session).success;
}
function validateSummaryNode(node) {
  return SummaryNodeSchema.safeParse(node).success;
}
function validateCompressionState(state) {
  return NodeCompressionStateSchema.safeParse(state).success;
}
function validateEmbeddingFreshness(state) {
  return EmbeddingFreshnessStateSchema.safeParse(state).success;
}

// src/edges/index.ts
function generateEdgeId() {
  return EDGE_ID_PREFIX + nanoid(NANOID_LENGTH);
}
var EdgeNeuralPropertiesSchema = z.object({
  co_activation_count: z.number().int().min(0),
  last_co_activation: z.string().datetime(),
  decay_factor: z.number().min(0).max(1)
});
var EdgeProvenanceSchema = z.object({
  source_type: z.enum(SOURCE_TYPES),
  created_at: z.string().datetime(),
  extraction_confidence: z.number().min(0).max(1).optional()
});
var NousEdgeSchema = z.object({
  id: z.string().regex(/^e_[a-zA-Z0-9_-]{12}$/),
  source: z.string(),
  target: z.string(),
  type: z.enum(EDGE_TYPES),
  subtype: z.string().optional(),
  strength: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  neural: EdgeNeuralPropertiesSchema,
  provenance: EdgeProvenanceSchema
});
var EDGE_CREATION_RULES = {
  /** Rule 1: Co-mention - Entities mentioned in the same sentence */
  CO_MENTION: {
    type: "relates_to",
    defaultStrength: 0.5,
    description: "Entities in same sentence"
  },
  /** Rule 2: Explicit relation - "X causes Y" */
  EXPLICIT_CAUSAL: {
    type: "causes",
    defaultStrength: 0.8,
    description: "Explicit causal statement"
  },
  /** Rule 3: Containment - "X is part of Y" */
  EXPLICIT_CONTAINMENT: {
    type: "part_of",
    defaultStrength: 0.9,
    description: "Explicit containment"
  },
  /** Rule 4: Temporal sequence - Events in order */
  TEMPORAL_SEQUENCE: {
    type: "precedes",
    defaultStrength: 0.7,
    description: "Events in temporal order"
  },
  /** Rule 5: Extraction origin - Concept extracted from Episode */
  EXTRACTION_ORIGIN: {
    type: "mentioned_in",
    defaultStrength: 1,
    description: "Concept from episode"
  },
  /** Rule 6: Embedding similarity - cosine > 0.85 */
  EMBEDDING_SIMILARITY: {
    type: "similar_to",
    threshold: 0.85,
    description: "High semantic similarity"
  }
};
function createEdge(source, target, type, options = {}) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: generateEdgeId(),
    source,
    target,
    type,
    subtype: options.subtype,
    strength: options.strength ?? 0.5,
    confidence: options.confidence ?? 1,
    neural: {
      co_activation_count: 0,
      last_co_activation: now,
      decay_factor: 1
    },
    provenance: {
      source_type: options.sourceType ?? "manual",
      created_at: now,
      extraction_confidence: options.extractionConfidence
    }
  };
}
function createDefaultEdgeNeuralProperties() {
  return {
    co_activation_count: 0,
    last_co_activation: (/* @__PURE__ */ new Date()).toISOString(),
    decay_factor: 1
  };
}
function strengthenEdge(edge, amount = 0.1) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...edge,
    strength: Math.min(1, edge.strength + amount),
    neural: {
      ...edge.neural,
      co_activation_count: edge.neural.co_activation_count + 1,
      last_co_activation: now
    }
  };
}
function decayEdge(edge, decayRate = 0.05) {
  return {
    ...edge,
    neural: {
      ...edge.neural,
      decay_factor: Math.max(0, edge.neural.decay_factor - decayRate)
    }
  };
}
function reactivateEdge(edge) {
  return {
    ...edge,
    neural: {
      ...edge.neural,
      decay_factor: 1,
      last_co_activation: (/* @__PURE__ */ new Date()).toISOString()
    }
  };
}
function updateEdgeConfidence(edge, confidence) {
  return {
    ...edge,
    confidence: Math.max(0, Math.min(1, confidence))
  };
}
function edgeConnects(edge, nodeA, nodeB) {
  return edge.source === nodeA && edge.target === nodeB || edge.source === nodeB && edge.target === nodeA;
}
function getOtherNode(edge, nodeId) {
  if (edge.source === nodeId) return edge.target;
  if (edge.target === nodeId) return edge.source;
  return void 0;
}
function isEdgeDecayed(edge, threshold = 0.1) {
  return edge.neural.decay_factor < threshold;
}
function shouldPruneEdge(edge, maxAgeDays = 90, decayThreshold = 0.1) {
  const ageMs = Date.now() - new Date(edge.neural.last_co_activation).getTime();
  const ageDays = ageMs / (1e3 * 60 * 60 * 24);
  return ageDays > maxAgeDays && edge.neural.decay_factor < decayThreshold;
}
function filterEdgesByType(edges, type) {
  return edges.filter((edge) => edge.type === type);
}
function getEdgesForNode(edges, nodeId) {
  return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
}
function getOutgoingEdges(edges, nodeId) {
  return edges.filter((edge) => edge.source === nodeId);
}
function getIncomingEdges(edges, nodeId) {
  return edges.filter((edge) => edge.target === nodeId);
}
function sortEdgesByStrength(edges) {
  return [...edges].sort((a, b) => b.strength - a.strength);
}
function sortEdgesByCoActivation(edges) {
  return [...edges].sort(
    (a, b) => b.neural.co_activation_count - a.neural.co_activation_count
  );
}
function validateEdge(edge) {
  return NousEdgeSchema.safeParse(edge).success;
}
function parseEdge(data) {
  return NousEdgeSchema.parse(data);
}
function safeParseEdge(data) {
  const result = NousEdgeSchema.safeParse(data);
  return result.success ? result.data : null;
}

export { COACTIVATION_CONFIG, COMPRESSION_DEFAULTS, CompressedEdgeRecordSchema, DecayResultSchema, EDGE_CREATION_RULES, EDGE_CREATION_SOURCES, EDGE_DECAY_CONFIG, EDGE_STATUSES, EDGE_WEIGHTS, EXTENDED_EDGE_TYPES, EXTRACTION_CONFIG, EdgeCreationSourceSchema, EdgeNeuralPropertiesSchema, EdgeProvenanceSchema, EdgeStatusSchema, EdgeWeightComponentsSchema, EmbeddingFreshnessStateSchema, ExtractionEdgeResultSchema, GRAPH_SIZE_THRESHOLDS, LEARNED_ADJUSTMENT_BOUNDS, NodeCompressionStateSchema, NousEdgeSchema, ProvisionalEdgeStateSchema, SIMILARITY_CONFIG, SessionNodeSchema, SessionSchema, SummaryContentSchema, SummaryNodeSchema, TEMPORAL_CONFIG, TemporalEdgeResultSchema, USER_EDGE_CONFIG, WEIGHT_BOUNDS, applyCoactivationBonus, applyLearningAdjustment, applyTimeBasedDecay, calculateAggregatedWeight, calculateEffectiveWeight, calculateExtractionEdge, calculateSimilarityWeight, calculateStrengtheningDelta, calculateTemporalWeight, calculateUserEdgeWeight, checkContinuationEligibility, createCompressionState, createDefaultEdgeNeuralProperties, createEdge, createEdgeRecord, createProvisionalState, createSessionTemporalEdges, createTemporalAdjacentEdge, createWeightComponents, createWeightedEdge, decayCoactivationBonus, decayEdge, detectContinuationEdges, didUserEngage, edgeConnects, filterEdgesByType, generateEdgeId, generateSummaryNodeId, getCompressionConfig, getEdgesForNode, getIncomingEdges, getOtherNode, getOutgoingEdges, hasSessionEnded, incrementProvisionalActivation, isAllowedUserEdgeType, isEdgeDead, isEdgeDecayed, isEmbeddingFresh, isNeverCompress, isRestorable, meetsCompressionRequirements, meetsSimilarityThreshold, parseEdge, reactivateEdge, safeParseEdge, shouldConsiderNewEdge, shouldExpireProvisional, shouldPromoteProvisional, shouldPruneEdge, sortEdgesByCoActivation, sortEdgesByStrength, strengthenEdge, updateCoActivationWeight, updateEdgeConfidence, validateCompressionState, validateEdge, validateEmbeddingFreshness, validateProvisionalState, validateSession, validateSummaryNode, validateWeightComponents };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map