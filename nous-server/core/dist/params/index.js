import { z } from 'zod';

// src/params/index.ts
var SUBTYPE_TO_SECTION = {
  // EPISODIC — What happened
  "custom:trade_entry": "EPISODIC",
  "custom:trade_close": "EPISODIC",
  "custom:trade_modify": "EPISODIC",
  "custom:trade": "EPISODIC",
  // Legacy subtype, rarely used
  "custom:turn_summary": "EPISODIC",
  "custom:session_summary": "EPISODIC",
  "custom:market_event": "EPISODIC",
  // SIGNALS — What to watch
  "custom:signal": "SIGNALS",
  "custom:watchpoint": "SIGNALS",
  // KNOWLEDGE — What I've learned
  "custom:lesson": "KNOWLEDGE",
  "custom:thesis": "KNOWLEDGE",
  "custom:curiosity": "KNOWLEDGE",
  // PROCEDURAL — How to act
  "custom:playbook": "PROCEDURAL",
  "custom:missed_opportunity": "PROCEDURAL",
  "custom:good_pass": "PROCEDURAL"
};
function getSectionForSubtype(subtype) {
  if (!subtype) return "KNOWLEDGE";
  return SUBTYPE_TO_SECTION[subtype] ?? "KNOWLEDGE";
}
var SECTION_PROFILES = {
  EPISODIC: {
    name: "Episodic",
    section: "EPISODIC",
    reranking_weights: {
      semantic: 0.2,
      keyword: 0.15,
      graph: 0.15,
      recency: 0.3,
      authority: 0.1,
      affinity: 0.1
    },
    decay: {
      initial_stability_days: 14,
      growth_rate: 2,
      active_threshold: 0.5,
      weak_threshold: 0.1,
      max_stability_days: 180
    },
    encoding: {
      base_difficulty: 0.3,
      salience_enabled: true,
      max_salience_multiplier: 2
    },
    consolidation_role: "source",
    intent_boost: 1.3
  },
  SIGNALS: {
    name: "Signals",
    section: "SIGNALS",
    reranking_weights: {
      semantic: 0.15,
      keyword: 0.1,
      graph: 0.1,
      recency: 0.45,
      authority: 0.1,
      affinity: 0.1
    },
    decay: {
      initial_stability_days: 2,
      growth_rate: 1.5,
      active_threshold: 0.5,
      weak_threshold: 0.15,
      max_stability_days: 30
    },
    encoding: {
      base_difficulty: 0.2,
      salience_enabled: false,
      max_salience_multiplier: 1
    },
    consolidation_role: "source",
    intent_boost: 1.3
  },
  KNOWLEDGE: {
    name: "Knowledge",
    section: "KNOWLEDGE",
    reranking_weights: {
      semantic: 0.35,
      keyword: 0.15,
      graph: 0.2,
      recency: 0.05,
      authority: 0.2,
      affinity: 0.05
    },
    decay: {
      initial_stability_days: 60,
      growth_rate: 3,
      active_threshold: 0.4,
      weak_threshold: 0.05,
      max_stability_days: 365
    },
    encoding: {
      base_difficulty: 0.4,
      salience_enabled: true,
      max_salience_multiplier: 2
    },
    consolidation_role: "target",
    intent_boost: 1.3
  },
  PROCEDURAL: {
    name: "Procedural",
    section: "PROCEDURAL",
    reranking_weights: {
      semantic: 0.25,
      keyword: 0.25,
      graph: 0.2,
      recency: 0.05,
      authority: 0.15,
      affinity: 0.1
    },
    decay: {
      initial_stability_days: 120,
      growth_rate: 3.5,
      active_threshold: 0.3,
      weak_threshold: 0.03,
      max_stability_days: 365
    },
    encoding: {
      base_difficulty: 0.5,
      salience_enabled: true,
      max_salience_multiplier: 3
    },
    consolidation_role: "target",
    intent_boost: 1.3
  }
};
var SectionDecayConfigSchema = z.object({
  initial_stability_days: z.number().positive(),
  growth_rate: z.number().positive(),
  active_threshold: z.number().min(0).max(1),
  weak_threshold: z.number().min(0).max(1),
  max_stability_days: z.number().positive()
});
var SectionEncodingConfigSchema = z.object({
  base_difficulty: z.number().min(0).max(1),
  salience_enabled: z.boolean(),
  max_salience_multiplier: z.number().min(1)
});
var SectionRerankingWeightsSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1)
}).refine(
  (w) => Math.abs(w.semantic + w.keyword + w.graph + w.recency + w.authority + w.affinity - 1) < 0.01,
  { message: "Reranking weights must sum to 1.0" }
);
function validateSectionProfiles() {
  for (const [section, profile] of Object.entries(SECTION_PROFILES)) {
    SectionDecayConfigSchema.parse(profile.decay);
    SectionEncodingConfigSchema.parse(profile.encoding);
    SectionRerankingWeightsSchema.parse(profile.reranking_weights);
    if (profile.decay.weak_threshold >= profile.decay.active_threshold) {
      throw new Error(`Section ${section}: weak_threshold must be < active_threshold`);
    }
  }
}
validateSectionProfiles();

// src/params/index.ts
var ALGORITHM_NODE_TYPES = [
  "person",
  "fact",
  "concept",
  "event",
  "note",
  "document",
  "preference"
];
var RerankingWeightsSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1)
}).refine(
  (w) => Math.abs(w.semantic + w.keyword + w.graph + w.recency + w.authority + w.affinity - 1) < 1e-3,
  { message: "Reranking weights must sum to 1.0" }
);
var RERANKING_WEIGHTS = {
  semantic: 0.3,
  keyword: 0.15,
  graph: 0.2,
  recency: 0.15,
  authority: 0.1,
  affinity: 0.1
};
var RerankingConfigSchema = z.object({
  recency_half_life_days: z.number().positive(),
  authority_cap_multiple: z.number().positive(),
  affinity_saturation: z.number().positive(),
  new_content_boost_days: z.number().int().nonnegative(),
  new_content_boost_value: z.number().min(0).max(1)
});
var RERANKING_CONFIG = {
  recency_half_life_days: 30,
  authority_cap_multiple: 2,
  affinity_saturation: 10,
  new_content_boost_days: 7,
  new_content_boost_value: 0.2
};
var ScoreBreakdownSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1)
});
var ScoredNodeSchema = z.object({
  id: z.string(),
  semantic_score: z.number().min(0).max(1).optional(),
  bm25_score: z.number().nonnegative().optional(),
  graph_score: z.number().min(0).max(1).optional(),
  last_accessed: z.date(),
  created_at: z.date(),
  access_count: z.number().int().nonnegative(),
  inbound_edge_count: z.number().int().nonnegative(),
  subtype: z.string().optional()
});
var GraphMetricsSchema = z.object({
  total_nodes: z.number().int().nonnegative(),
  total_edges: z.number().int().nonnegative(),
  density: z.number().min(0).max(1),
  avg_inbound_edges: z.number().nonnegative(),
  avg_outbound_edges: z.number().nonnegative()
});
var DecayConfigSchema = z.object({
  growth_rate: z.number().positive(),
  max_stability_days: z.number().int().positive(),
  active_threshold: z.number().min(0).max(1),
  weak_threshold: z.number().min(0).max(1),
  dormant_days: z.number().int().nonnegative(),
  compress_days: z.number().int().nonnegative(),
  archive_days: z.number().int().nonnegative(),
  cascade_factor: z.number().min(0).max(1),
  edge_floor: z.number().min(0).max(1)
});
var DECAY_CONFIG = {
  growth_rate: 2.5,
  max_stability_days: 365,
  active_threshold: 0.5,
  weak_threshold: 0.1,
  dormant_days: 60,
  compress_days: 120,
  archive_days: 240,
  cascade_factor: 0.8,
  edge_floor: 0.1
};
var INITIAL_STABILITY = {
  person: 14,
  fact: 7,
  concept: 21,
  event: 10,
  note: 30,
  document: 7,
  preference: 45
};
var INITIAL_DIFFICULTY = {
  person: 0.2,
  fact: 0.3,
  concept: 0.4,
  event: 0.3,
  note: 0.2,
  document: 0.5,
  preference: 0.1
};
var DECAY_LIFECYCLE_STATES = ["ACTIVE", "WEAK", "DORMANT", "COMPRESS", "ARCHIVE"];
var SSAParamsSchema = z.object({
  initial_activation: z.number().min(0).max(1),
  hop_decay: z.number().min(0).max(1),
  min_threshold: z.number().min(0).max(1),
  max_hops: z.number().int().positive(),
  max_nodes: z.number().int().positive(),
  aggregation: z.enum(["sum", "max"])
});
var SSA_PARAMS = {
  initial_activation: 1,
  hop_decay: 0.8,
  min_threshold: 0.01,
  max_hops: 3,
  max_nodes: 500,
  aggregation: "sum"
};
var SSAEdgeWeightsSchema = z.object({
  same_entity: z.number().min(0).max(1),
  part_of: z.number().min(0).max(1),
  caused_by: z.number().min(0).max(1),
  mentioned_together: z.number().min(0).max(1),
  related_to: z.number().min(0).max(1),
  similar_to: z.number().min(0).max(1),
  user_linked: z.number().min(0).max(1),
  temporal_adjacent: z.number().min(0).max(1),
  generalizes: z.number().min(0).max(1),
  applied_to: z.number().min(0).max(1)
});
var SSA_EDGE_WEIGHTS = {
  same_entity: 0.95,
  part_of: 0.85,
  caused_by: 0.8,
  applied_to: 0.75,
  // Playbook applied to trade entry (procedural — Issue 5)
  generalizes: 0.7,
  // Knowledge generalized from episodes (consolidation — Issue 3)
  mentioned_together: 0.6,
  related_to: 0.5,
  similar_to: 0.45,
  user_linked: 0.9,
  temporal_adjacent: 0.4
};
var ActivatedNodeSchema = z.object({
  id: z.string(),
  activation: z.number().min(0).max(1),
  path: z.array(z.string())
});
var ConfidenceThresholdsSchema = z.object({
  retrieval: z.object({
    high: z.number().min(0).max(1),
    medium: z.number().min(0).max(1),
    low: z.number().min(0).max(1)
  }),
  classification: z.object({
    clear_lookup: z.number().min(0).max(1),
    clear_reasoning: z.number().min(0).max(1),
    ambiguous_floor: z.number().min(0).max(1)
  }),
  extraction: z.object({
    auto_store: z.number().min(0).max(1),
    confirm_store: z.number().min(0).max(1)
  }),
  contradiction: z.object({
    definite: z.number().min(0).max(1),
    possible: z.number().min(0).max(1)
  })
});
var CONFIDENCE_THRESHOLDS = {
  retrieval: {
    high: 0.7,
    medium: 0.45,
    low: 0.45
  },
  classification: {
    clear_lookup: 0.85,
    clear_reasoning: 0.85,
    ambiguous_floor: 0.5
  },
  extraction: {
    auto_store: 0.85,
    confirm_store: 0.6
  },
  contradiction: {
    definite: 0.85,
    possible: 0.6
  }
};
var CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"];
var RCSWeightsSchema = z.object({
  match_quality: z.number().min(0).max(1),
  distinctiveness: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1)
});
var RCS_WEIGHTS = {
  match_quality: 0.4,
  distinctiveness: 0.35,
  completeness: 0.25
};
var RetrievalConfidenceResultSchema = z.object({
  score: z.number().min(0).max(1),
  level: z.enum(CONFIDENCE_LEVELS),
  breakdown: z.object({
    mq: z.number().min(0).max(1),
    dt: z.number().min(0).max(1),
    cm: z.number().min(0).max(1)
  }),
  flags: z.array(z.string())
});
var CONTRADICTION_LEVELS = ["definite", "possible", "none"];
var ContradictionResultSchema = z.object({
  level: z.enum(CONTRADICTION_LEVELS),
  score: z.number().min(0).max(1),
  action: z.enum(["flag_user", "note_internal", "safe_to_store"]),
  explanation: z.string()
});
var BudgetConfigSchema = z.object({
  time_ms: z.number().nonnegative(),
  max_nodes: z.number().int().nonnegative(),
  max_api_calls: z.number().int().nonnegative()
});
var OPERATION_BUDGETS = {
  simple_lookup: { time_ms: 50, max_nodes: 100, max_api_calls: 0 },
  standard_query: { time_ms: 100, max_nodes: 500, max_api_calls: 0 },
  complex_query: { time_ms: 200, max_nodes: 1e3, max_api_calls: 0 },
  phase2_reasoning: { time_ms: 3e3, max_nodes: 500, max_api_calls: 5 },
  deep_search: { time_ms: 500, max_nodes: 2e3, max_api_calls: 0 },
  serendipity: { time_ms: 200, max_nodes: 200, max_api_calls: 0 }
};
var QualityTargetSchema = z.object({
  confidence: z.number().min(0).max(1),
  min_coverage: z.number().min(0).max(1)
});
var QUALITY_TARGETS = {
  LOOKUP: { confidence: 0.8, min_coverage: 0.6 },
  REASONING: { confidence: 0.7, min_coverage: 0.7 },
  EXPLORATORY: { confidence: 0.5, min_coverage: 0.4 },
  TEMPORAL: { confidence: 0.75, min_coverage: 0.65 }
};
var QualityWeightsSchema = z.object({
  coverage: z.number().min(0).max(1),
  match_quality: z.number().min(0).max(1),
  convergence: z.number().min(0).max(1)
});
var QUALITY_WEIGHTS = {
  coverage: 0.35,
  match_quality: 0.45,
  convergence: 0.2
};
var COLD_START_THRESHOLD = 200;
var AdaptiveLimitsSchema = z.object({
  entry_points: z.number().int().positive(),
  max_hops: z.number().int().positive(),
  max_nodes: z.number().int().positive()
});
var COLD_START_LIMITS = {
  entry_points: 2,
  max_hops: 3,
  max_nodes: 50
};
var QUERY_TYPES = ["simple", "standard", "complex"];
var TerminationResultSchema = z.object({
  terminate: z.boolean(),
  reason: z.string()
});
var BM25ConfigSchema = z.object({
  k1: z.number().positive(),
  b: z.number().min(0).max(1),
  min_term_length: z.number().int().positive(),
  max_term_length: z.number().int().positive(),
  max_doc_frequency_ratio: z.number().min(0).max(1),
  stemmer: z.enum(["porter", "snowball", "none"]),
  preserve_original: z.boolean()
});
var BM25_CONFIG = {
  k1: 1.2,
  b: 0.75,
  min_term_length: 2,
  max_term_length: 50,
  max_doc_frequency_ratio: 0.95,
  stemmer: "porter",
  preserve_original: true
};
var FieldBoostSchema = z.object({
  field: z.enum(["title", "tags", "headers", "body", "metadata"]),
  boost: z.number().positive()
});
var FIELD_BOOSTS = [
  { field: "title", boost: 3 },
  { field: "tags", boost: 2.5 },
  { field: "headers", boost: 2 },
  { field: "body", boost: 1 },
  { field: "metadata", boost: 0.5 }
];
var StopwordsConfigSchema = z.object({
  language: z.string(),
  default_list: z.array(z.string()),
  custom_additions: z.array(z.string()),
  behavior: z.enum(["remove_from_query", "remove_from_both", "keep_for_phrases"])
});
var STOPWORDS_CONFIG = {
  language: "en",
  default_list: [
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "was",
    "are",
    "were",
    "been",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "what",
    "which",
    "who",
    "whom",
    "whose",
    "where",
    "when",
    "why",
    "how"
  ],
  custom_additions: [
    "note",
    "notes",
    "idea",
    "ideas",
    "thought",
    "thoughts",
    "todo",
    "item",
    "entry"
  ],
  behavior: "remove_from_query"
};
var ALGORITHM_PARAMS = {
  reranking: {
    weights: RERANKING_WEIGHTS,
    config: RERANKING_CONFIG
  },
  decay: {
    config: DECAY_CONFIG,
    initial_stability: INITIAL_STABILITY,
    initial_difficulty: INITIAL_DIFFICULTY
  },
  ssa: {
    params: SSA_PARAMS,
    edge_weights: SSA_EDGE_WEIGHTS
  },
  confidence: {
    thresholds: CONFIDENCE_THRESHOLDS,
    rcs_weights: RCS_WEIGHTS
  },
  adaptive: {
    budgets: OPERATION_BUDGETS,
    quality_targets: QUALITY_TARGETS,
    quality_weights: QUALITY_WEIGHTS,
    cold_start_threshold: COLD_START_THRESHOLD,
    cold_start_limits: COLD_START_LIMITS
  },
  bm25: {
    config: BM25_CONFIG,
    field_boosts: FIELD_BOOSTS,
    stopwords: STOPWORDS_CONFIG
  }
};
function daysBetween(start, end) {
  return Math.floor((end.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24));
}
function semanticScore(node) {
  return node.semantic_score ?? 0;
}
function keywordScore(node, maxBM25, candidateCount) {
  if (maxBM25 === 0) return 0.5;
  if (candidateCount === 1) return 1;
  return (node.bm25_score ?? 0) / maxBM25;
}
function graphScore(node) {
  return node.graph_score ?? 0;
}
function recencyScore(lastAccessed, now = /* @__PURE__ */ new Date()) {
  const daysSince = daysBetween(lastAccessed, now);
  return Math.exp(-daysSince / RERANKING_CONFIG.recency_half_life_days);
}
function authorityScore(inboundEdges, avgInbound) {
  if (avgInbound === 0) return 0.5;
  const ratio = inboundEdges / avgInbound;
  return Math.min(ratio / RERANKING_CONFIG.authority_cap_multiple, 1);
}
function affinityScore(accessCount, createdAt, lastAccessed, now = /* @__PURE__ */ new Date()) {
  const recency = recencyScore(lastAccessed, now);
  const interactionScore = Math.tanh(accessCount / RERANKING_CONFIG.affinity_saturation) * recency;
  const ageDays = daysBetween(createdAt, now);
  const newContentBoost = ageDays < RERANKING_CONFIG.new_content_boost_days ? RERANKING_CONFIG.new_content_boost_value : 0;
  return Math.min(interactionScore + newContentBoost, 1);
}
function rerankCandidates(candidates, metrics, weights = RERANKING_WEIGHTS, now = /* @__PURE__ */ new Date()) {
  if (candidates.length === 0) return [];
  const maxBM25 = Math.max(...candidates.map((c) => c.bm25_score ?? 0));
  return candidates.map((node) => {
    const breakdown = {
      semantic: semanticScore(node),
      keyword: keywordScore(node, maxBM25, candidates.length),
      graph: graphScore(node),
      recency: recencyScore(node.last_accessed, now),
      authority: authorityScore(node.inbound_edge_count, metrics.avg_inbound_edges),
      affinity: affinityScore(node.access_count, node.created_at, node.last_accessed, now)
    };
    const score = weights.semantic * breakdown.semantic + weights.keyword * breakdown.keyword + weights.graph * breakdown.graph + weights.recency * breakdown.recency + weights.authority * breakdown.authority + weights.affinity * breakdown.affinity;
    const contributions = Object.entries(breakdown).map(([key, value]) => ({
      key,
      contribution: weights[key] * value
    }));
    const primary = contributions.reduce(
      (a, b) => b.contribution > a.contribution ? b : a
    ).key;
    return { node, score, breakdown, primary_signal: primary };
  }).sort((a, b) => b.score - a.score);
}
function rerankWithSectionWeights(candidates, metrics, now = /* @__PURE__ */ new Date()) {
  if (candidates.length === 0) return [];
  const maxBM25 = Math.max(...candidates.map((c) => c.bm25_score ?? 0));
  return candidates.map((node) => {
    const section = getSectionForSubtype(node.subtype);
    const weights = SECTION_PROFILES[section].reranking_weights;
    const breakdown = {
      semantic: semanticScore(node),
      keyword: keywordScore(node, maxBM25, candidates.length),
      graph: graphScore(node),
      recency: recencyScore(node.last_accessed, now),
      authority: authorityScore(node.inbound_edge_count, metrics.avg_inbound_edges),
      affinity: affinityScore(node.access_count, node.created_at, node.last_accessed, now)
    };
    const score = weights.semantic * breakdown.semantic + weights.keyword * breakdown.keyword + weights.graph * breakdown.graph + weights.recency * breakdown.recency + weights.authority * breakdown.authority + weights.affinity * breakdown.affinity;
    const contributions = Object.entries(breakdown).map(([key, value]) => ({
      key,
      contribution: weights[key] * value
    }));
    const primary = contributions.reduce(
      (a, b) => b.contribution > a.contribution ? b : a
    ).key;
    return { node, score, breakdown, primary_signal: primary };
  }).sort((a, b) => b.score - a.score);
}
function calculateRetrievability(daysSinceAccess, stability) {
  if (stability <= 0) return 0;
  return Math.exp(-daysSinceAccess / stability);
}
function calculateDifficulty(type, contentLength, edgeCount) {
  const baseDifficulty = INITIAL_DIFFICULTY[type] ?? 0.3;
  const lengthFactor = Math.min(contentLength / 5e3, 1) * 0.15;
  const abstractionFactor = type === "concept" ? 0.1 : 0;
  const connectionBonus = -Math.min(edgeCount / 40, 1) * 0.15;
  return Math.max(0, Math.min(
    1,
    baseDifficulty + lengthFactor + abstractionFactor + connectionBonus
  ));
}
function updateStabilityOnAccess(stability, difficulty) {
  const difficultyFactor = 1 - difficulty * 0.5;
  return Math.min(
    stability * DECAY_CONFIG.growth_rate * difficultyFactor,
    DECAY_CONFIG.max_stability_days
  );
}
function getDecayLifecycleState(retrievability, daysDormant) {
  if (retrievability > DECAY_CONFIG.active_threshold) return "ACTIVE";
  if (retrievability > DECAY_CONFIG.weak_threshold) return "WEAK";
  if (daysDormant < DECAY_CONFIG.dormant_days) return "DORMANT";
  if (daysDormant < DECAY_CONFIG.compress_days) return "DORMANT";
  if (daysDormant < DECAY_CONFIG.archive_days) return "COMPRESS";
  return "ARCHIVE";
}
function applyCascadeDecay(edgeWeight, retrievability) {
  if (retrievability >= DECAY_CONFIG.weak_threshold) {
    return edgeWeight;
  }
  return Math.max(edgeWeight * DECAY_CONFIG.cascade_factor, DECAY_CONFIG.edge_floor);
}
function getInitialStability(type) {
  return INITIAL_STABILITY[type] ?? 14;
}
function getInitialDifficulty(type) {
  return INITIAL_DIFFICULTY[type] ?? 0.3;
}
function getDecayLifecycleStateForSection(retrievability, daysDormant, decay) {
  if (retrievability > decay.active_threshold) return "ACTIVE";
  if (retrievability > decay.weak_threshold) return "WEAK";
  if (daysDormant < DECAY_CONFIG.dormant_days) return "DORMANT";
  if (daysDormant < DECAY_CONFIG.compress_days) return "COMPRESS";
  if (daysDormant < DECAY_CONFIG.archive_days) return "ARCHIVE";
  return "ARCHIVE";
}
function updateStabilityOnAccessForSection(stability, difficulty, decay) {
  const difficultyFactor = 1 - difficulty * 0.5;
  return Math.min(
    stability * decay.growth_rate * difficultyFactor,
    decay.max_stability_days
  );
}
function calculateRetrievalConfidence(topScore, secondScore, resultCount, hasAttribute) {
  if (resultCount === 0) {
    return {
      score: 0,
      level: "LOW",
      breakdown: { mq: 0, dt: 0, cm: 0 },
      flags: ["no_results"]
    };
  }
  const MQ = topScore;
  const scoreGap = secondScore !== null ? topScore - secondScore : 1;
  const gapNormalized = Math.min(scoreGap / 0.3, 1);
  let focus;
  if (resultCount === 1) focus = 1;
  else if (resultCount <= 5) focus = 0.8;
  else if (resultCount <= 15) focus = 0.5;
  else focus = 0.3;
  const DT = gapNormalized * 0.5 + focus * 0.5;
  const CM = hasAttribute ? 1 : 0.5;
  const MQ_safe = Math.max(MQ, 0.1);
  const DT_safe = Math.max(DT, 0.1);
  const CM_safe = Math.max(CM, 0.1);
  let score = Math.pow(MQ_safe, RCS_WEIGHTS.match_quality) * Math.pow(DT_safe, RCS_WEIGHTS.distinctiveness) * Math.pow(CM_safe, RCS_WEIGHTS.completeness);
  if (MQ < 0.3) score = Math.min(score, 0.4);
  if (DT < 0.2) score = Math.min(score, 0.4);
  if (!hasAttribute) score = Math.min(score, 0.7);
  const flags = [];
  if (resultCount > 1 && scoreGap < 0.15) flags.push("disambiguation_needed");
  if (resultCount < 3 && MQ < 0.6) flags.push("sparse_results");
  if (!hasAttribute) flags.push("attribute_unknown");
  if (MQ > 0.95 && DT > 0.8 && hasAttribute) flags.push("perfect_match");
  const level = getConfidenceLevel(score);
  return { score, level, breakdown: { mq: MQ, dt: DT, cm: CM }, flags };
}
function getConfidenceLevel(score) {
  if (score >= CONFIDENCE_THRESHOLDS.retrieval.high) return "HIGH";
  if (score >= CONFIDENCE_THRESHOLDS.retrieval.medium) return "MEDIUM";
  return "LOW";
}
function detectContradiction(similarity, logicalConflict, daysSinceExisting) {
  const supersessionLikelihood = daysSinceExisting > 90 ? 0.3 : 0;
  const score = Math.max(0, Math.min(
    1,
    similarity * 0.4 + logicalConflict * 0.5 - supersessionLikelihood
  ));
  if (score >= CONFIDENCE_THRESHOLDS.contradiction.definite) {
    return {
      level: "definite",
      score,
      action: "flag_user",
      explanation: `High conflict detected (${(score * 100).toFixed(0)}%): new info may contradict existing knowledge`
    };
  }
  if (score >= CONFIDENCE_THRESHOLDS.contradiction.possible) {
    return {
      level: "possible",
      score,
      action: "note_internal",
      explanation: `Moderate conflict (${(score * 100).toFixed(0)}%): noted for potential review`
    };
  }
  return {
    level: "none",
    score,
    action: "safe_to_store",
    explanation: "No significant conflict detected"
  };
}
function calculateAdaptiveLimits(graphSize, graphDensity, queryType) {
  if (graphSize < COLD_START_THRESHOLD) {
    return {
      ...COLD_START_LIMITS,
      max_nodes: Math.min(COLD_START_LIMITS.max_nodes, Math.ceil(graphSize * 0.5))
    };
  }
  const entryPoints = Math.max(2, Math.min(5, Math.ceil(Math.log10(graphSize))));
  let maxHops;
  if (graphDensity < 1e-3) maxHops = 5;
  else if (graphDensity < 0.01) maxHops = 4;
  else if (graphDensity < 0.05) maxHops = 3;
  else maxHops = 2;
  const percentageMap = {
    simple: 0.02,
    standard: 0.05,
    complex: 0.1
  };
  const percentage = percentageMap[queryType];
  const budgetKey = `${queryType}_query`;
  const budgetLookup = OPERATION_BUDGETS[budgetKey];
  const budget = budgetLookup ?? OPERATION_BUDGETS["standard_query"];
  const maxNodes = Math.max(
    50,
    Math.min(Math.ceil(graphSize * percentage), budget.max_nodes)
  );
  return { entry_points: entryPoints, max_hops: maxHops, max_nodes: maxNodes };
}
function calculateQualityScore(coverage, matchQuality, convergence) {
  return coverage * QUALITY_WEIGHTS.coverage + matchQuality * QUALITY_WEIGHTS.match_quality + convergence * QUALITY_WEIGHTS.convergence;
}
function shouldTerminate(currentQuality, targetQuality, convergence, lowConvergenceSteps, remainingBudget) {
  if (currentQuality >= targetQuality) {
    return { terminate: true, reason: "quality_target_met" };
  }
  if (convergence < 0.02 && lowConvergenceSteps >= 2) {
    return { terminate: true, reason: "converged" };
  }
  if (remainingBudget.time_ms <= 0) {
    return { terminate: true, reason: "time_exhausted" };
  }
  if (remainingBudget.max_nodes <= 0) {
    return { terminate: true, reason: "node_limit_reached" };
  }
  return { terminate: false, reason: "" };
}
function getBudgetForOperation(operation) {
  const budget = OPERATION_BUDGETS[operation];
  return budget ?? OPERATION_BUDGETS["standard_query"];
}
function getQualityTargetForQueryType(queryType) {
  const target = QUALITY_TARGETS[queryType];
  return target ?? QUALITY_TARGETS["REASONING"];
}
function getEffectiveStopwords(config = STOPWORDS_CONFIG) {
  return /* @__PURE__ */ new Set([...config.default_list, ...config.custom_additions]);
}
function removeStopwords(tokens, stopwords) {
  return tokens.filter((token) => !stopwords.has(token.toLowerCase()));
}
function shouldIndexTerm(term, docFrequency, totalDocs, config = BM25_CONFIG) {
  if (term.length < config.min_term_length) return false;
  if (term.length > config.max_term_length) return false;
  if (docFrequency < 1) return false;
  if (totalDocs === 0) return docFrequency >= 1;
  const frequencyRatio = docFrequency / totalDocs;
  if (frequencyRatio > config.max_doc_frequency_ratio) return false;
  return true;
}
function getFieldBoost(field) {
  const boost = FIELD_BOOSTS.find((fb) => fb.field === field);
  return boost?.boost ?? 1;
}
function validateRerankingWeights(weights) {
  return RerankingWeightsSchema.safeParse(weights).success;
}
function validateRerankingConfig(config) {
  return RerankingConfigSchema.safeParse(config).success;
}
function validateDecayConfig(config) {
  return DecayConfigSchema.safeParse(config).success;
}
function validateSSAParams(params) {
  return SSAParamsSchema.safeParse(params).success;
}
function validateSSAEdgeWeights(weights) {
  return SSAEdgeWeightsSchema.safeParse(weights).success;
}
function validateConfidenceThresholds(thresholds) {
  return ConfidenceThresholdsSchema.safeParse(thresholds).success;
}
function validateBudgetConfig(config) {
  return BudgetConfigSchema.safeParse(config).success;
}
function validateAdaptiveLimits(limits) {
  return AdaptiveLimitsSchema.safeParse(limits).success;
}
function validateBM25Config(config) {
  return BM25ConfigSchema.safeParse(config).success;
}
function validateQualityTarget(target) {
  return QualityTargetSchema.safeParse(target).success;
}
function validateGraphMetrics(metrics) {
  return GraphMetricsSchema.safeParse(metrics).success;
}

export { ALGORITHM_NODE_TYPES, ALGORITHM_PARAMS, ActivatedNodeSchema, AdaptiveLimitsSchema, BM25ConfigSchema, BM25_CONFIG, BudgetConfigSchema, COLD_START_LIMITS, COLD_START_THRESHOLD, CONFIDENCE_LEVELS, CONFIDENCE_THRESHOLDS, CONTRADICTION_LEVELS, ConfidenceThresholdsSchema, ContradictionResultSchema, DECAY_CONFIG, DECAY_LIFECYCLE_STATES, DecayConfigSchema, FIELD_BOOSTS, FieldBoostSchema, GraphMetricsSchema, INITIAL_DIFFICULTY, INITIAL_STABILITY, OPERATION_BUDGETS, QUALITY_TARGETS, QUALITY_WEIGHTS, QUERY_TYPES, QualityTargetSchema, QualityWeightsSchema, RCSWeightsSchema, RCS_WEIGHTS, RERANKING_CONFIG, RERANKING_WEIGHTS, RerankingConfigSchema, RerankingWeightsSchema, RetrievalConfidenceResultSchema, SSAEdgeWeightsSchema, SSAParamsSchema, SSA_EDGE_WEIGHTS, SSA_PARAMS, STOPWORDS_CONFIG, ScoreBreakdownSchema, ScoredNodeSchema, StopwordsConfigSchema, TerminationResultSchema, affinityScore, applyCascadeDecay, authorityScore, calculateAdaptiveLimits, calculateDifficulty, calculateQualityScore, calculateRetrievability, calculateRetrievalConfidence, detectContradiction, getBudgetForOperation, getConfidenceLevel, getDecayLifecycleState, getDecayLifecycleStateForSection, getEffectiveStopwords, getFieldBoost, getInitialDifficulty, getInitialStability, getQualityTargetForQueryType, graphScore, keywordScore, recencyScore, removeStopwords, rerankCandidates, rerankWithSectionWeights, semanticScore, shouldIndexTerm, shouldTerminate, updateStabilityOnAccess, updateStabilityOnAccessForSection, validateAdaptiveLimits, validateBM25Config, validateBudgetConfig, validateConfidenceThresholds, validateDecayConfig, validateGraphMetrics, validateQualityTarget, validateRerankingConfig, validateRerankingWeights, validateSSAEdgeWeights, validateSSAParams };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map