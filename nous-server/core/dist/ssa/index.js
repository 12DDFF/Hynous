import { z } from 'zod';

// src/ssa/index.ts
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
z.object({
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
z.object({
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
z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1)
});
z.object({
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
z.object({
  total_nodes: z.number().int().nonnegative(),
  total_edges: z.number().int().nonnegative(),
  density: z.number().min(0).max(1),
  avg_inbound_edges: z.number().nonnegative(),
  avg_outbound_edges: z.number().nonnegative()
});
z.object({
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
z.object({
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
z.object({
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
z.object({
  id: z.string(),
  activation: z.number().min(0).max(1),
  path: z.array(z.string())
});
z.object({
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
var CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"];
z.object({
  match_quality: z.number().min(0).max(1),
  distinctiveness: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1)
});
z.object({
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
z.object({
  level: z.enum(CONTRADICTION_LEVELS),
  score: z.number().min(0).max(1),
  action: z.enum(["flag_user", "note_internal", "safe_to_store"]),
  explanation: z.string()
});
z.object({
  time_ms: z.number().nonnegative(),
  max_nodes: z.number().int().nonnegative(),
  max_api_calls: z.number().int().nonnegative()
});
z.object({
  confidence: z.number().min(0).max(1),
  min_coverage: z.number().min(0).max(1)
});
z.object({
  coverage: z.number().min(0).max(1),
  match_quality: z.number().min(0).max(1),
  convergence: z.number().min(0).max(1)
});
z.object({
  entry_points: z.number().int().positive(),
  max_hops: z.number().int().positive(),
  max_nodes: z.number().int().positive()
});
z.object({
  terminate: z.boolean(),
  reason: z.string()
});
z.object({
  k1: z.number().positive(),
  b: z.number().min(0).max(1),
  min_term_length: z.number().int().positive(),
  max_term_length: z.number().int().positive(),
  max_doc_frequency_ratio: z.number().min(0).max(1),
  stemmer: z.enum(["porter", "snowball", "none"]),
  preserve_original: z.boolean()
});
z.object({
  field: z.enum(["title", "tags", "headers", "body", "metadata"]),
  boost: z.number().positive()
});
z.object({
  language: z.string(),
  default_list: z.array(z.string()),
  custom_additions: z.array(z.string()),
  behavior: z.enum(["remove_from_query", "remove_from_both", "keep_for_phrases"])
});
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
var EMBEDDING_DIMENSIONS = 1536;
var DENSE_WEIGHT = 0.7;
var BM25_WEIGHT = 0.3;
var SSA_SEED_THRESHOLD = 0.6;
z.object({
  vector: z.instanceof(Float32Array),
  dimensions: z.number().int().positive().max(EMBEDDING_DIMENSIONS),
  model: z.string().min(1),
  contextPrefix: z.string(),
  contextHash: z.string().min(1),
  createdAt: z.string().datetime(),
  provisional: z.boolean(),
  version: z.number().int().nonnegative()
});
z.object({
  template: z.enum([
    "concept_extracted",
    "concept_manual",
    "episode",
    "document_chunk",
    "section",
    "note",
    "raw_archive",
    "query"
  ]),
  generated: z.string(),
  hash: z.string()
});
z.object({
  denseWeight: z.number().min(0).max(1),
  bm25Weight: z.number().min(0).max(1),
  userTunable: z.boolean()
}).refine(
  (data) => Math.abs(data.denseWeight + data.bm25Weight - 1) < 1e-3,
  { message: "Weights must sum to 1.0" }
);
z.object({
  nodeId: z.string(),
  denseScore: z.number().min(0).max(1),
  bm25Score: z.number().min(0).max(1),
  fusedScore: z.number().min(0).max(1)
});
z.object({
  timeRange: z.object({
    start: z.string().datetime(),
    end: z.string().datetime()
  }).optional(),
  nodeTypes: z.array(z.string()).optional(),
  clusterIds: z.array(z.string()).optional(),
  excludeNodeIds: z.array(z.string()).optional()
});
z.object({
  hasTimeReference: z.boolean(),
  hasSemanticContent: z.boolean(),
  expectedTypes: z.array(z.string()),
  semanticPart: z.string(),
  originalQuery: z.string()
});
z.object({
  shouldCreateEdge: z.boolean(),
  shouldCheckDedup: z.boolean(),
  similarity: z.number().min(-1).max(1),
  targetNodeId: z.string()
});
z.enum(["primary", "secondary", "local", "degraded"]);
z.object({
  chain: z.array(z.string()),
  retryDelayMs: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative(),
  autoReEmbed: z.boolean()
});
z.object({
  isAvailable: z.boolean(),
  lastSuccessAt: z.string().datetime().optional(),
  lastFailureAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
  consecutiveFailures: z.number().int().nonnegative()
});

// src/ssa/index.ts
var SERENDIPITY_LEVELS = ["off", "low", "medium", "high"];
var QUERY_COMBINATION_STRATEGIES = ["average", "max_pooling"];
var SERENDIPITY_THRESHOLDS = {
  off: { minGraph: 1, maxSim: 0, count: 0 },
  low: { minGraph: 0.4, maxSim: 0.5, count: 2 },
  medium: { minGraph: 0.3, maxSim: 0.5, count: 5 },
  high: { minGraph: 0.2, maxSim: 0.5, count: 10 }
};
var DateRangeFilterSchema = z.object({
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional()
}).refine(
  (data) => {
    if (data.after && data.before) {
      return new Date(data.after) <= new Date(data.before);
    }
    return true;
  },
  { message: "after must be before or equal to before" }
);
var LastAccessedFilterSchema = z.object({
  within_days: z.number().int().positive()
});
var SSASearchFiltersSchema = z.object({
  date_range: DateRangeFilterSchema.optional(),
  last_accessed: LastAccessedFilterSchema.optional(),
  types: z.array(z.string().max(100)).max(50).optional(),
  exclude_types: z.array(z.string().max(100)).max(50).optional(),
  clusters: z.array(z.string().min(1).max(100)).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
  tags_any: z.array(z.string().min(1).max(50)).optional(),
  exclude_tags: z.array(z.string().min(1).max(50)).optional(),
  relationships: z.array(z.string().max(100)).max(30).optional(),
  connected_to: z.string().min(1).max(100).optional(),
  within_hops: z.number().int().min(1).max(10).optional()
});
var SearchRequestSchema = z.object({
  query: z.string().min(1).max(2e3).optional(),
  queries: z.array(z.string().min(1).max(2e3)).max(10).optional(),
  filters: SSASearchFiltersSchema.optional(),
  serendipity_level: z.enum(SERENDIPITY_LEVELS).optional(),
  query_combination: z.enum(QUERY_COMBINATION_STRATEGIES).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  include_connections: z.boolean().optional()
}).refine(
  (data) => data.query !== void 0 || data.queries !== void 0 && data.queries.length > 0,
  { message: "Either query or queries must be provided" }
);
var SSAScoreBreakdownSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1)
});
var RankingReasonSchema = z.object({
  primary_signal: z.enum(["semantic", "keyword", "graph", "recency", "authority", "affinity"]),
  explanation: z.string(),
  score_breakdown: SSAScoreBreakdownSchema
});
var SSARankedNodeSchema = z.object({
  node_id: z.string(),
  score: z.number().min(0).max(1),
  ranking_reason: RankingReasonSchema
});
var NodeConnectionSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  edge_type: z.string(),
  weight: z.number().min(0).max(1)
});
var ConnectionMapSchema = z.object({
  connections: z.array(NodeConnectionSchema),
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative()
});
var SerendipityCandidateSchema = z.object({
  node_id: z.string(),
  semantic_score: z.number().min(0).max(1),
  graph_score: z.number().min(0).max(1),
  connection_path: z.array(z.string()),
  explanation: z.string()
});
var ExecutionMetricsSchema = z.object({
  total_ms: z.number().nonnegative(),
  parse_filters_ms: z.number().nonnegative(),
  embed_queries_ms: z.number().nonnegative(),
  hybrid_seeding_ms: z.number().nonnegative(),
  spreading_ms: z.number().nonnegative(),
  reranking_ms: z.number().nonnegative(),
  seeds_found: z.number().int().nonnegative(),
  nodes_activated: z.number().int().nonnegative(),
  nodes_filtered: z.number().int().nonnegative(),
  nodes_returned: z.number().int().nonnegative()
});
var SearchResponseSchema = z.object({
  results: z.array(SSARankedNodeSchema),
  filters_applied: SSASearchFiltersSchema,
  total_candidates: z.number().int().nonnegative(),
  execution_time_ms: z.number().nonnegative(),
  metrics: ExecutionMetricsSchema
});
var SSAResultSchema = z.object({
  original_queries: z.array(z.string()),
  filters_applied: SSASearchFiltersSchema,
  relevant_nodes: z.array(SSARankedNodeSchema),
  connection_map: ConnectionMapSchema.optional(),
  ranking_reasons: z.record(z.string(), RankingReasonSchema),
  serendipity_candidates: z.array(SerendipityCandidateSchema).optional(),
  metrics: ExecutionMetricsSchema
});
var SSAConfigSchema = z.object({
  seed_threshold: z.number().min(0).max(1),
  dense_weight: z.number().min(0).max(1),
  bm25_weight: z.number().min(0).max(1),
  max_seeds: z.number().int().positive(),
  initial_activation: z.number().min(0).max(1),
  hop_decay: z.number().min(0).max(1),
  min_threshold: z.number().min(0).max(1),
  max_hops: z.number().int().positive(),
  max_nodes: z.number().int().positive(),
  aggregation: z.enum(["sum", "max"]),
  query_combination: z.enum(QUERY_COMBINATION_STRATEGIES),
  default_limit: z.number().int().positive()
});
var DEFAULT_SSA_CONFIG = {
  seed_threshold: SSA_SEED_THRESHOLD,
  dense_weight: DENSE_WEIGHT,
  bm25_weight: BM25_WEIGHT,
  max_seeds: 15,
  initial_activation: SSA_PARAMS.initial_activation,
  hop_decay: SSA_PARAMS.hop_decay,
  min_threshold: SSA_PARAMS.min_threshold,
  max_hops: SSA_PARAMS.max_hops,
  max_nodes: SSA_PARAMS.max_nodes,
  aggregation: SSA_PARAMS.aggregation,
  query_combination: "average",
  default_limit: 30
};
var SeedNodeSchema = z.object({
  node_id: z.string(),
  vector_score: z.number().min(0).max(1),
  bm25_score: z.number().nonnegative(),
  combined_score: z.number().min(0).max(1)
});
var SeedingResultSchema = z.object({
  seeds: z.array(SeedNodeSchema),
  vector_candidates: z.number().int().nonnegative(),
  bm25_candidates: z.number().int().nonnegative(),
  combined_candidates: z.number().int().nonnegative(),
  execution_ms: z.number().nonnegative()
});
var SSAActivatedNodeSchema = z.object({
  node_id: z.string(),
  activation: z.number().min(0),
  hop_distance: z.number().int().nonnegative(),
  activation_path: z.array(z.string()),
  is_seed: z.boolean(),
  vector_score: z.number().min(0).max(1),
  bm25_score: z.number().nonnegative()
});
var SpreadingResultSchema = z.object({
  activated: z.array(SSAActivatedNodeSchema),
  hops_completed: z.number().int().nonnegative(),
  nodes_visited: z.number().int().nonnegative(),
  edges_traversed: z.number().int().nonnegative(),
  terminated_reason: z.enum(["max_hops", "max_nodes", "no_spread", "threshold"]),
  execution_ms: z.number().nonnegative()
});
var FilterNodeInputSchema = z.object({
  id: z.string(),
  type: z.string(),
  created_at: z.string().datetime(),
  last_accessed: z.string().datetime(),
  clusters: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
});
var FilterEdgeInputSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  target_id: z.string(),
  edge_type: z.string()
});
function buildFilterPredicate(filters) {
  const now = /* @__PURE__ */ new Date();
  const evaluateNode = (node) => {
    if (filters.date_range) {
      const created = new Date(node.created_at);
      if (filters.date_range.after && created < new Date(filters.date_range.after)) {
        return false;
      }
      if (filters.date_range.before && created > new Date(filters.date_range.before)) {
        return false;
      }
    }
    if (filters.last_accessed) {
      const lastAccessed = new Date(node.last_accessed);
      const daysAgo = (now.getTime() - lastAccessed.getTime()) / (1e3 * 60 * 60 * 24);
      if (daysAgo > filters.last_accessed.within_days) {
        return false;
      }
    }
    if (filters.types && filters.types.length > 0) {
      if (!filters.types.includes(node.type)) {
        return false;
      }
    }
    if (filters.exclude_types && filters.exclude_types.length > 0) {
      if (filters.exclude_types.includes(node.type)) {
        return false;
      }
    }
    if (filters.clusters && filters.clusters.length > 0) {
      if (!node.clusters || !filters.clusters.some((c) => node.clusters.includes(c))) {
        return false;
      }
    }
    if (filters.tags && filters.tags.length > 0) {
      if (!node.tags || !filters.tags.every((t) => node.tags.includes(t))) {
        return false;
      }
    }
    if (filters.tags_any && filters.tags_any.length > 0) {
      if (!node.tags || !filters.tags_any.some((t) => node.tags.includes(t))) {
        return false;
      }
    }
    if (filters.exclude_tags && filters.exclude_tags.length > 0) {
      if (node.tags && filters.exclude_tags.some((t) => node.tags.includes(t))) {
        return false;
      }
    }
    return true;
  };
  const evaluateEdge = (edge) => {
    if (filters.relationships && filters.relationships.length > 0) {
      if (!filters.relationships.includes(edge.edge_type)) {
        return false;
      }
    }
    return true;
  };
  return { filters, evaluateNode, evaluateEdge };
}
function parseFilters(filters) {
  const result = SSASearchFiltersSchema.safeParse(filters);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}
async function hybridSeed(queryEmbedding, queryTerms, context, predicate, config) {
  const startTime = performance.now();
  const vectorResults = await context.vectorSearch(queryEmbedding, config.max_seeds * 3);
  const bm25Results = await context.bm25Search(queryTerms, config.max_seeds * 3);
  const scoreMap = /* @__PURE__ */ new Map();
  const maxBm25 = Math.max(...bm25Results.map((r) => r.score), 1);
  for (const result of vectorResults) {
    scoreMap.set(result.nodeId, { vector: result.score, bm25: 0 });
  }
  for (const result of bm25Results) {
    const existing = scoreMap.get(result.nodeId);
    const normalizedBm25 = result.score / maxBm25;
    if (existing) {
      existing.bm25 = normalizedBm25;
    } else {
      scoreMap.set(result.nodeId, { vector: 0, bm25: normalizedBm25 });
    }
  }
  const seeds = [];
  for (const [nodeId, scores] of scoreMap) {
    const combined = config.dense_weight * scores.vector + config.bm25_weight * scores.bm25;
    if (combined >= config.seed_threshold) {
      const node = await context.getNode(nodeId);
      if (node && predicate.evaluateNode(node)) {
        seeds.push({
          node_id: nodeId,
          vector_score: scores.vector,
          bm25_score: scores.bm25,
          combined_score: combined
        });
      }
    }
  }
  seeds.sort((a, b) => b.combined_score - a.combined_score);
  const limitedSeeds = seeds.slice(0, config.max_seeds);
  return {
    seeds: limitedSeeds,
    vector_candidates: vectorResults.length,
    bm25_candidates: bm25Results.length,
    combined_candidates: scoreMap.size,
    execution_ms: performance.now() - startTime
  };
}
function getSSAEdgeWeight(edgeType) {
  const weights = SSA_EDGE_WEIGHTS;
  return weights[edgeType] ?? 0.5;
}
async function spreadActivation(seeds, context, predicate, config) {
  const startTime = performance.now();
  const activations = /* @__PURE__ */ new Map();
  const toProcess = [];
  for (const seed of seeds) {
    const activation = config.initial_activation * seed.combined_score;
    activations.set(seed.node_id, {
      node_id: seed.node_id,
      activation,
      hop_distance: 0,
      activation_path: [seed.node_id],
      is_seed: true,
      vector_score: seed.vector_score,
      bm25_score: seed.bm25_score
    });
    toProcess.push({ nodeId: seed.node_id, activation, hop: 0, path: [seed.node_id] });
  }
  let nodesVisited = seeds.length;
  let edgesTraversed = 0;
  let hopsCompleted = 0;
  let terminatedReason = "max_hops";
  while (toProcess.length > 0 && hopsCompleted < config.max_hops) {
    const nextRound = [];
    hopsCompleted++;
    for (const { nodeId, activation, hop, path } of toProcess) {
      if (activation < config.min_threshold) {
        continue;
      }
      const neighbors = await context.getNeighbors(nodeId);
      for (const neighbor of neighbors) {
        edgesTraversed++;
        if (!predicate.evaluateEdge(neighbor.edge)) {
          continue;
        }
        if (!predicate.evaluateNode(neighbor.node)) {
          continue;
        }
        const edgeWeight = getSSAEdgeWeight(neighbor.edge.edge_type);
        const spread = activation * edgeWeight * config.hop_decay;
        if (spread < config.min_threshold) {
          continue;
        }
        const neighborId = neighbor.node.id;
        const existing = activations.get(neighborId);
        if (existing) {
          if (config.aggregation === "sum") {
            existing.activation += spread;
          } else {
            existing.activation = Math.max(existing.activation, spread);
          }
          if (hop + 1 < existing.hop_distance) {
            existing.hop_distance = hop + 1;
            existing.activation_path = [...path, neighborId];
          }
        } else {
          const newNode = {
            node_id: neighborId,
            activation: spread,
            hop_distance: hop + 1,
            activation_path: [...path, neighborId],
            is_seed: false,
            vector_score: 0,
            bm25_score: 0
          };
          activations.set(neighborId, newNode);
          nodesVisited++;
          if (nodesVisited >= config.max_nodes) {
            terminatedReason = "max_nodes";
            break;
          }
        }
        nextRound.push({
          nodeId: neighborId,
          activation: spread,
          hop: hop + 1,
          path: [...path, neighborId]
        });
      }
      if (nodesVisited >= config.max_nodes) {
        break;
      }
    }
    if (nodesVisited >= config.max_nodes) {
      break;
    }
    if (nextRound.length === 0) {
      terminatedReason = "no_spread";
      break;
    }
    toProcess.length = 0;
    toProcess.push(...nextRound);
  }
  const activated = Array.from(activations.values());
  return {
    activated,
    hops_completed: hopsCompleted,
    nodes_visited: nodesVisited,
    edges_traversed: edgesTraversed,
    terminated_reason: terminatedReason,
    execution_ms: performance.now() - startTime
  };
}
async function buildScoredNodes(activated, context) {
  const scoredNodes = [];
  for (const node of activated) {
    const rerankData = await context.getNodeForReranking(node.node_id);
    if (rerankData) {
      scoredNodes.push({
        id: node.node_id,
        semantic_score: node.vector_score,
        bm25_score: node.bm25_score,
        graph_score: node.activation,
        last_accessed: rerankData.last_accessed,
        created_at: rerankData.created_at,
        access_count: rerankData.access_count,
        inbound_edge_count: rerankData.inbound_edge_count,
        subtype: rerankData.subtype
        // For per-section reranking (Issue 1)
      });
    }
  }
  return scoredNodes;
}
function convertToSSARankedNodes(ranked) {
  return ranked.map((r) => ({
    node_id: r.node.id,
    score: r.score,
    ranking_reason: {
      primary_signal: r.primary_signal,
      explanation: generateExplanation(r.primary_signal, r.breakdown),
      score_breakdown: r.breakdown
    }
  }));
}
function identifySerendipity(activated, level) {
  if (level === "off") {
    return [];
  }
  const threshold = SERENDIPITY_THRESHOLDS[level];
  const candidates = [];
  for (const node of activated) {
    if (node.vector_score < threshold.maxSim && node.activation >= threshold.minGraph) {
      candidates.push({
        node_id: node.node_id,
        semantic_score: node.vector_score,
        graph_score: node.activation,
        connection_path: node.activation_path,
        explanation: `Connected via ${node.hop_distance} hops despite low semantic similarity`
      });
    }
  }
  candidates.sort((a, b) => b.graph_score - a.graph_score);
  return candidates.slice(0, threshold.count);
}
async function buildConnectionMap(activated, context, predicate) {
  const activatedIds = new Set(activated.map((n) => n.node_id));
  const connections = [];
  for (const node of activated) {
    const neighbors = await context.getNeighbors(node.node_id);
    for (const neighbor of neighbors) {
      if (activatedIds.has(neighbor.node.id)) {
        if (predicate.evaluateEdge(neighbor.edge)) {
          connections.push({
            source_id: node.node_id,
            target_id: neighbor.node.id,
            edge_type: neighbor.edge.edge_type,
            weight: neighbor.weight
          });
        }
      }
    }
  }
  return {
    connections,
    node_count: activated.length,
    edge_count: connections.length
  };
}
function getNormalizedQueries(request) {
  if (request.queries && request.queries.length > 0) {
    return request.queries;
  }
  if (request.query) {
    return [request.query];
  }
  return [];
}
function extractQueryTerms(queries) {
  const terms = [];
  for (const query of queries) {
    const tokens = query.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
    terms.push(...tokens);
  }
  return [...new Set(terms)];
}
function mergeSSAConfig(partial) {
  if (!partial) return DEFAULT_SSA_CONFIG;
  return { ...DEFAULT_SSA_CONFIG, ...partial };
}
function createEmptyMetrics() {
  return {
    total_ms: 0,
    parse_filters_ms: 0,
    embed_queries_ms: 0,
    hybrid_seeding_ms: 0,
    spreading_ms: 0,
    reranking_ms: 0,
    seeds_found: 0,
    nodes_activated: 0,
    nodes_filtered: 0,
    nodes_returned: 0
  };
}
function generateExplanation(primary, breakdown) {
  const score = breakdown[primary];
  const percentage = Math.round(score * 100);
  switch (primary) {
    case "semantic":
      return `Strong semantic match (${percentage}% similarity)`;
    case "keyword":
      return `Keyword match in content (${percentage}% BM25 score)`;
    case "graph":
      return `Connected via knowledge graph (${percentage}% activation)`;
    case "recency":
      return `Recently accessed (${percentage}% recency score)`;
    case "authority":
      return `Well-connected node (${percentage}% authority)`;
    case "affinity":
      return `Frequently accessed by user (${percentage}% affinity)`;
    default:
      return `Primary signal: ${primary} (${percentage}%)`;
  }
}
function getSerendipityThreshold(level) {
  return SERENDIPITY_THRESHOLDS[level];
}
function validateSearchRequest(request) {
  return SearchRequestSchema.safeParse(request).success;
}
function validateSearchFilters(filters) {
  return SSASearchFiltersSchema.safeParse(filters).success;
}
function validateSSAConfig(config) {
  return SSAConfigSchema.safeParse(config).success;
}
function validateSSAResult(result) {
  return SSAResultSchema.safeParse(result).success;
}
function parseSearchRequest(request) {
  const result = SearchRequestSchema.safeParse(request);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}
async function executeSSA(options) {
  const startTime = performance.now();
  const metrics = createEmptyMetrics();
  const { request, context, embed, config: partialConfig } = options;
  const config = mergeSSAConfig(partialConfig);
  const parseResult = parseSearchRequest(request);
  if (!parseResult.success) {
    throw new Error("Invalid search request: validation failed. Ensure query or queries is provided.");
  }
  const filterStart = performance.now();
  const filters = request.filters ?? {};
  const predicate = buildFilterPredicate(filters);
  metrics.parse_filters_ms = performance.now() - filterStart;
  const queries = getNormalizedQueries(request);
  if (queries.length === 0) {
    throw new Error("No queries provided");
  }
  const embedStart = performance.now();
  const queryEmbedding = await embed(queries);
  metrics.embed_queries_ms = performance.now() - embedStart;
  const queryTerms = extractQueryTerms(queries);
  const seedingStart = performance.now();
  const seedingResult = await hybridSeed(queryEmbedding, queryTerms, context, predicate, config);
  metrics.hybrid_seeding_ms = performance.now() - seedingStart;
  metrics.seeds_found = seedingResult.seeds.length;
  if (seedingResult.seeds.length === 0) {
    metrics.total_ms = performance.now() - startTime;
    return {
      original_queries: queries,
      filters_applied: filters,
      relevant_nodes: [],
      ranking_reasons: {},
      metrics
    };
  }
  const spreadingStart = performance.now();
  const spreadingResult = await spreadActivation(seedingResult.seeds, context, predicate, config);
  metrics.spreading_ms = performance.now() - spreadingStart;
  metrics.nodes_activated = spreadingResult.activated.length;
  const relevantActivated = spreadingResult.activated.filter(
    (node) => node.is_seed || node.bm25_score > 0 || node.vector_score > 0
  );
  metrics.nodes_filtered = spreadingResult.activated.length - relevantActivated.length;
  if (relevantActivated.length > 0) {
    const maxActivation = Math.max(...relevantActivated.map((n) => n.activation));
    if (maxActivation > 0) {
      for (const node of relevantActivated) {
        node.activation = node.activation / maxActivation;
      }
    }
  }
  const rerankingStart = performance.now();
  const graphMetrics = await context.getGraphMetrics();
  const scoredNodes = await buildScoredNodes(relevantActivated, context);
  const rankedNodes = rerankWithSectionWeights(scoredNodes, graphMetrics);
  metrics.reranking_ms = performance.now() - rerankingStart;
  const limit = request.limit ?? config.default_limit;
  const limitedRanked = rankedNodes.slice(0, limit);
  const ssaRankedNodes = convertToSSARankedNodes(limitedRanked);
  metrics.nodes_returned = ssaRankedNodes.length;
  const rankingReasons = {};
  for (const node of ssaRankedNodes) {
    rankingReasons[node.node_id] = node.ranking_reason;
  }
  const result = {
    original_queries: queries,
    filters_applied: filters,
    relevant_nodes: ssaRankedNodes,
    ranking_reasons: rankingReasons,
    metrics
  };
  if (request.include_connections) {
    result.connection_map = await buildConnectionMap(
      spreadingResult.activated,
      context,
      predicate
    );
  }
  const serendipityLevel = request.serendipity_level ?? "off";
  if (serendipityLevel !== "off") {
    result.serendipity_candidates = identifySerendipity(spreadingResult.activated, serendipityLevel);
  }
  metrics.total_ms = performance.now() - startTime;
  return result;
}
function createSearchResponse(result) {
  return {
    results: result.relevant_nodes,
    filters_applied: result.filters_applied,
    total_candidates: result.metrics.nodes_activated,
    execution_time_ms: result.metrics.total_ms,
    metrics: result.metrics
  };
}

export { ConnectionMapSchema, DEFAULT_SSA_CONFIG, DateRangeFilterSchema, ExecutionMetricsSchema, FilterEdgeInputSchema, FilterNodeInputSchema, LastAccessedFilterSchema, NodeConnectionSchema, QUERY_COMBINATION_STRATEGIES, RankingReasonSchema, SERENDIPITY_LEVELS, SERENDIPITY_THRESHOLDS, SSAActivatedNodeSchema, SSAConfigSchema, SSARankedNodeSchema, SSAResultSchema, SSAScoreBreakdownSchema, SSASearchFiltersSchema, SearchRequestSchema, SearchResponseSchema, SeedNodeSchema, SeedingResultSchema, SerendipityCandidateSchema, SpreadingResultSchema, buildConnectionMap, buildFilterPredicate, buildScoredNodes, convertToSSARankedNodes, createEmptyMetrics, createSearchResponse, executeSSA, extractQueryTerms, generateExplanation, getNormalizedQueries, getSSAEdgeWeight, getSerendipityThreshold, hybridSeed, identifySerendipity, mergeSSAConfig, parseFilters, parseSearchRequest, spreadActivation, validateSSAConfig, validateSSAResult, validateSearchFilters, validateSearchRequest };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map