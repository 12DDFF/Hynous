import { z } from 'zod';

// src/qcs/index.ts
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
  inbound_edge_count: z.number().int().nonnegative()
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
z.object({
  same_entity: z.number().min(0).max(1),
  part_of: z.number().min(0).max(1),
  caused_by: z.number().min(0).max(1),
  mentioned_together: z.number().min(0).max(1),
  related_to: z.number().min(0).max(1),
  similar_to: z.number().min(0).max(1),
  user_linked: z.number().min(0).max(1),
  temporal_adjacent: z.number().min(0).max(1)
});
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
var CONFIDENCE_THRESHOLDS = {
  retrieval: {
    high: 0.7,
    medium: 0.45}};
var CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"];
z.object({
  match_quality: z.number().min(0).max(1),
  distinctiveness: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1)
});
var RCS_WEIGHTS = {
  match_quality: 0.4,
  distinctiveness: 0.35,
  completeness: 0.25
};
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

// src/qcs/index.ts
var DISQUALIFIER_CATEGORIES = ["D1", "D2", "D3", "D4", "D5", "D6"];
var QCS_QUERY_TYPES = ["LOOKUP", "AMBIGUOUS"];
var SKIP_DECISIONS = ["SKIP", "SKIP_WITH_CAVEAT", "PHASE2"];
var D1_REASONING_PATTERNS = [
  /\bhow does\b/i,
  /\bhow do\b/i,
  /\bhow is\b/i,
  /\bwhy does\b/i,
  /\bwhy is\b/i,
  /\bwhy did\b/i,
  /\brelate\b/i,
  /\brelationship\b/i,
  /\bconnection\b/i,
  /\bcompare\b/i,
  /\bcomparison\b/i,
  /\bdifference\b/i,
  /\bversus\b/i,
  /\bvs\b/i,
  /\bexplain\b/i,
  /\bsummarize\b/i,
  /\bdescribe\b/i,
  /\bwhat do I know about\b/i,
  /\btell me about\b/i
];
var D2_NEGATION_PATTERNS = [
  /\bnot in\b/i,
  /\bnot included\b/i,
  /\bmissing from\b/i,
  /\bnever\b/i,
  /\bwithout\b/i,
  /\bexcept\b/i,
  /\bwhat don't I\b/i,
  /\bwhat haven't I\b/i
];
var D3_TIME_PATTERNS = [
  // Relative time
  /\blast week\b/i,
  /\byesterday\b/i,
  /\brecently\b/i,
  /\blast month\b/i,
  /\blast year\b/i,
  /\btoday\b/i,
  /\bthis week\b/i,
  /\bthis month\b/i,
  // Specific time
  /\bin (january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\bon (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bin \d{4}\b/i,
  // Time ranges
  /\bbetween\b/i,
  /\bfrom .+ to\b/i,
  /\bduring\b/i
];
var D4_COMPOUND_PATTERNS = [
  /\?\s*\S+.*\?/,
  // Multiple question marks with content between
  /\band what\b/i,
  /\band when\b/i,
  /\band where\b/i,
  /\band who\b/i,
  /\band how\b/i,
  /\band why\b/i,
  /\balso\b.*\?/i
];
var D5_REFERENCE_PATTERNS = [
  /\btheir\b/i,
  /\bhis\b/i,
  /\bher\b/i,
  /\bits\b/i,
  /\bthat\b/i,
  /\bthis\b/i,
  /\bthe same\b/i,
  /\bthe other\b/i
];
var D6_EXPLORATION_PATTERNS = [
  /\bwhat else\b/i,
  /\banything related\b/i,
  /\bmore about\b/i,
  /\bsimilar to\b/i,
  /\blike \S+\b/i,
  /\bbrainstorm\b/i,
  /\bideas for\b/i,
  /\bsuggest\b/i
];
var DISQUALIFIER_PATTERNS = {
  D1: D1_REASONING_PATTERNS,
  D2: D2_NEGATION_PATTERNS,
  D3: D3_TIME_PATTERNS,
  D4: D4_COMPOUND_PATTERNS,
  D5: D5_REFERENCE_PATTERNS,
  D6: D6_EXPLORATION_PATTERNS
};
var LOOKUP_PATTERNS = [
  // "What's X's Y?"
  /\bwhat(?:'s|'s| is)\s+(\S+(?:\s+\S+)?)'s\s+(\S+)/i,
  // "What is X's Y?"
  /\bwhat is\s+(\S+(?:\s+\S+)?)'s\s+(\S+)/i,
  // "X's Y?"
  /^(\S+(?:\s+\S+)?)'s\s+(\S+)\??$/i,
  // "Y for X?"
  /\b(\S+)\s+for\s+(\S+(?:\s+\S+)?)\??$/i,
  // "Who is X?"
  /\bwho is\s+(\S+(?:\s+\S+)?)\??$/i,
  // "Where is X?"
  /\bwhere is\s+(\S+(?:\s+\S+)?)\??$/i,
  // "When is X?"
  /\bwhen is\s+(\S+(?:\s+\S+)?)\??$/i
];
var ATTRIBUTE_KEYWORDS = [
  "phone",
  "email",
  "address",
  "birthday",
  "number",
  "date",
  "name",
  "title",
  "location",
  "id",
  "link",
  "url",
  "contact",
  "age",
  "status",
  "role",
  "position",
  "company",
  "team",
  "project"
];
var DisqualifierResultSchema = z.object({
  disqualified: z.boolean(),
  reason: z.string().optional(),
  category: z.enum(DISQUALIFIER_CATEGORIES).optional(),
  pattern: z.string().optional()
});
var QueryTypeResultSchema = z.object({
  type: z.enum(QCS_QUERY_TYPES),
  entity: z.string().optional(),
  attribute: z.string().optional(),
  confidence: z.number().min(0).max(1)
});
var ClassificationResultSchema = z.object({
  query: z.string(),
  queryType: QueryTypeResultSchema,
  rcs: z.object({
    score: z.number().min(0).max(1),
    level: z.enum(["HIGH", "MEDIUM", "LOW"]),
    flags: z.array(z.string())
  }),
  decision: z.enum(SKIP_DECISIONS),
  explanation: z.string(),
  handoff: z.lazy(() => Phase2HandoffMetadataSchema).optional()
});
var CLASSIFICATION_REASONS = [
  "reasoning_query",
  "low_confidence",
  "no_answer_found",
  "disambiguation",
  "compound_query",
  "time_reference",
  "exploration",
  "unresolved_reference",
  "negation_query",
  "ambiguous_query"
];
var Phase2HandoffMetadataSchema = z.object({
  classification_reason: z.enum(CLASSIFICATION_REASONS),
  phase1_results: z.array(z.object({
    node_id: z.string(),
    score: z.number().min(0).max(1)
  })).max(100),
  query_analysis: z.object({
    type: z.enum(QCS_QUERY_TYPES),
    entities: z.array(z.string()).max(20),
    attribute: z.string().nullable(),
    confidence: z.number().min(0).max(1)
  })
});
var QCSConfigSchema = z.object({
  debug: z.boolean().optional(),
  customDisqualifiers: z.array(z.instanceof(RegExp)).optional(),
  customLookupPatterns: z.array(z.instanceof(RegExp)).optional()
});
function getDisqualifierDescription(category) {
  const descriptions = {
    D1: "Reasoning query (how/why/explain)",
    D2: "Negation query (not/never/except)",
    D3: "Time reference (last week/in September)",
    D4: "Compound query (multiple questions)",
    D5: "Unresolved reference (their/his/it)",
    D6: "Exploration query (what else/similar to)"
  };
  return descriptions[category];
}
function categoryToReason(category) {
  const mapping = {
    D1: "reasoning_query",
    D2: "negation_query",
    D3: "time_reference",
    D4: "compound_query",
    D5: "unresolved_reference",
    D6: "exploration"
  };
  return mapping[category];
}
function isBlockingFlag(flag) {
  const blockingFlags = [
    "disambiguation_needed",
    "sparse_results",
    "no_results"
  ];
  return blockingFlags.includes(flag);
}
function generateDecisionExplanation(decision, queryType, rcsLevel, flags, disqualified) {
  if (disqualified) {
    return `Query disqualified by ${disqualified}: ${getDisqualifierDescription(disqualified)}. Proceeding to Phase 2.`;
  }
  if (queryType === "AMBIGUOUS") {
    return "Query type is AMBIGUOUS. Proceeding to Phase 2 for clarification.";
  }
  const blockingFlags = flags.filter(isBlockingFlag);
  if (blockingFlags.length > 0) {
    return `LOOKUP query with ${rcsLevel} confidence, but blocked by: ${blockingFlags.join(", ")}. Proceeding to Phase 2.`;
  }
  switch (decision) {
    case "SKIP":
      return `LOOKUP query with HIGH confidence and no blocking flags. Answering directly from Phase 1.`;
    case "SKIP_WITH_CAVEAT":
      return `LOOKUP query with MEDIUM confidence. Answering with uncertainty note.`;
    case "PHASE2":
      return `LOOKUP query with ${rcsLevel} confidence. Proceeding to Phase 2 for verification.`;
    default:
      return `Decision: ${decision}`;
  }
}
function checkDisqualifiers(query) {
  for (const category of DISQUALIFIER_CATEGORIES) {
    const patterns = DISQUALIFIER_PATTERNS[category];
    for (const pattern of patterns) {
      if (pattern.test(query)) {
        return {
          disqualified: true,
          reason: getDisqualifierDescription(category),
          category,
          pattern: pattern.source
        };
      }
    }
  }
  return { disqualified: false };
}
function cleanExtractedValue(value) {
  if (!value) return void 0;
  return value.replace(/[?!.,;:]+$/, "").trim();
}
function classifyQueryType(query) {
  for (const pattern of LOOKUP_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      const entity = cleanExtractedValue(match[1]?.trim());
      const attribute = cleanExtractedValue(match[2]?.trim());
      let confidence = 0.7;
      if (attribute && ATTRIBUTE_KEYWORDS.some(
        (kw) => attribute.toLowerCase().includes(kw.toLowerCase())
      )) {
        confidence = Math.min(confidence + 0.15, 1);
      }
      if (query.trim().endsWith("?")) {
        confidence = Math.min(confidence + 0.05, 1);
      }
      if (query.length < 50) {
        confidence = Math.min(confidence + 0.05, 1);
      }
      return {
        type: "LOOKUP",
        entity: entity || void 0,
        attribute: attribute || void 0,
        confidence
      };
    }
  }
  const hasAttributeKeyword = ATTRIBUTE_KEYWORDS.some(
    (kw) => query.toLowerCase().includes(kw.toLowerCase())
  );
  if (hasAttributeKeyword) {
    const simpleMatch = query.match(/(\S+(?:\s+\S+)?)'s\s+(\S+)/i);
    if (simpleMatch) {
      return {
        type: "LOOKUP",
        entity: cleanExtractedValue(simpleMatch[1]?.trim()),
        attribute: cleanExtractedValue(simpleMatch[2]?.trim()),
        confidence: 0.6
      };
    }
    return {
      type: "LOOKUP",
      attribute: ATTRIBUTE_KEYWORDS.find(
        (kw) => query.toLowerCase().includes(kw.toLowerCase())
      ),
      confidence: 0.5
    };
  }
  return {
    type: "AMBIGUOUS",
    confidence: 0.3
  };
}
function extractQueryEntities(query) {
  const entities = [];
  const possessiveMatches = query.matchAll(/(?:^|\s)(\w+)'s\s+/gi);
  for (const match of possessiveMatches) {
    const cleaned = cleanExtractedValue(match[1]);
    if (cleaned) {
      entities.push(cleaned);
    }
  }
  const forMatches = query.matchAll(/\bfor\s+(\w+(?:\s+\w+)?)\b/gi);
  for (const match of forMatches) {
    const cleaned = cleanExtractedValue(match[1]);
    if (cleaned) {
      entities.push(cleaned);
    }
  }
  const isMatches = query.matchAll(/\b(?:who|where|when) is\s+(\w+(?:\s+\w+)?)\b/gi);
  for (const match of isMatches) {
    const cleaned = cleanExtractedValue(match[1]);
    if (cleaned) {
      entities.push(cleaned);
    }
  }
  return [...new Set(entities)];
}
function extractQueryAttribute(query) {
  const possessiveMatch = query.match(/\S+'s\s+(\w+)/i);
  if (possessiveMatch?.[1]) {
    return cleanExtractedValue(possessiveMatch[1].trim()) ?? null;
  }
  const forMatch = query.match(/^(\w+)\s+for\s+/i);
  if (forMatch?.[1]) {
    return cleanExtractedValue(forMatch[1].trim()) ?? null;
  }
  for (const keyword of ATTRIBUTE_KEYWORDS) {
    if (query.toLowerCase().includes(keyword.toLowerCase())) {
      return keyword;
    }
  }
  return null;
}
function classifyQuery(query, ssaResult, _config) {
  const disqualifierResult = checkDisqualifiers(query);
  const queryTypeResult = classifyQueryType(query);
  const entities = extractQueryEntities(query);
  const attribute = extractQueryAttribute(query);
  const relevantNodes = ssaResult.relevant_nodes;
  const topScore = relevantNodes[0]?.score ?? 0;
  const secondScore = relevantNodes.length > 1 ? relevantNodes[1]?.score ?? null : null;
  const resultCount = relevantNodes.length;
  const hasAttribute = attribute !== null;
  const rcsResult = calculateRetrievalConfidence(
    topScore,
    secondScore,
    resultCount,
    hasAttribute
  );
  let decision;
  let classificationReason;
  if (disqualifierResult.disqualified) {
    decision = "PHASE2";
    classificationReason = disqualifierResult.category ? categoryToReason(disqualifierResult.category) : "reasoning_query";
  } else if (queryTypeResult.type === "AMBIGUOUS") {
    decision = "PHASE2";
    classificationReason = "ambiguous_query";
  } else if (resultCount === 0) {
    decision = "PHASE2";
    classificationReason = "no_answer_found";
  } else if (rcsResult.flags.some(isBlockingFlag)) {
    decision = "PHASE2";
    if (rcsResult.flags.includes("disambiguation_needed")) {
      classificationReason = "disambiguation";
    } else if (rcsResult.flags.includes("no_results")) {
      classificationReason = "no_answer_found";
    } else {
      classificationReason = "low_confidence";
    }
  } else {
    switch (rcsResult.level) {
      case "HIGH":
        decision = "SKIP";
        break;
      case "MEDIUM":
        decision = "SKIP_WITH_CAVEAT";
        break;
      case "LOW":
      default:
        decision = "PHASE2";
        classificationReason = "low_confidence";
        break;
    }
  }
  const explanation = generateDecisionExplanation(
    decision,
    queryTypeResult.type,
    rcsResult.level,
    rcsResult.flags,
    disqualifierResult.category
  );
  const result = {
    query,
    queryType: queryTypeResult,
    rcs: {
      score: rcsResult.score,
      level: rcsResult.level,
      flags: rcsResult.flags
    },
    decision,
    explanation
  };
  if (decision === "PHASE2" && classificationReason) {
    result.handoff = buildPhase2Handoff(
      classificationReason,
      relevantNodes,
      queryTypeResult,
      entities,
      attribute
    );
  }
  return result;
}
function shouldSkipPhase2(classification) {
  return classification.decision;
}
function buildPhase2Handoff(reason, relevantNodes, queryType, entities, attribute) {
  return {
    classification_reason: reason,
    phase1_results: relevantNodes.slice(0, 100).map((n) => ({
      node_id: n.node_id,
      score: n.score
    })),
    query_analysis: {
      type: queryType.type,
      entities,
      attribute,
      confidence: queryType.confidence
    }
  };
}
function validateDisqualifierResult(result) {
  return DisqualifierResultSchema.safeParse(result).success;
}
function validateQueryTypeResult(result) {
  return QueryTypeResultSchema.safeParse(result).success;
}
function validateClassificationResult(result) {
  return ClassificationResultSchema.safeParse(result).success;
}
function validatePhase2HandoffMetadata(metadata) {
  return Phase2HandoffMetadataSchema.safeParse(metadata).success;
}
function validateQCSConfig(config) {
  return QCSConfigSchema.safeParse(config).success;
}

export { ATTRIBUTE_KEYWORDS, CLASSIFICATION_REASONS, ClassificationResultSchema, D1_REASONING_PATTERNS, D2_NEGATION_PATTERNS, D3_TIME_PATTERNS, D4_COMPOUND_PATTERNS, D5_REFERENCE_PATTERNS, D6_EXPLORATION_PATTERNS, DISQUALIFIER_CATEGORIES, DISQUALIFIER_PATTERNS, DisqualifierResultSchema, LOOKUP_PATTERNS, Phase2HandoffMetadataSchema, QCSConfigSchema, QCS_QUERY_TYPES, QueryTypeResultSchema, SKIP_DECISIONS, buildPhase2Handoff, categoryToReason, checkDisqualifiers, classifyQuery, classifyQueryType, extractQueryAttribute, extractQueryEntities, generateDecisionExplanation, getDisqualifierDescription, isBlockingFlag, shouldSkipPhase2, validateClassificationResult, validateDisqualifierResult, validatePhase2HandoffMetadata, validateQCSConfig, validateQueryTypeResult };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map