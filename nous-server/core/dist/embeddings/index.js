import { z } from 'zod';

// src/embeddings/index.ts
var EMBEDDING_DIMENSIONS = 1536;
var MATRYOSHKA_DIMS = [128, 512, 1536];
var COMPARISON_DIMS = 512;
var DENSE_WEIGHT = 0.7;
var BM25_WEIGHT = 0.3;
var SIMILARITY_EDGE_THRESHOLD = 0.9;
var DEDUP_CHECK_THRESHOLD = 0.95;
var SSA_SEED_THRESHOLD = 0.6;
var STALE_EDGE_THRESHOLD = 0.8;
var MIN_CONTENT_LENGTH = 10;
var MIN_TOTAL_LENGTH = 50;
var STAGE_1_CANDIDATES = 200;
var STAGE_2_CANDIDATES = 50;
var STAGE_3_CANDIDATES = 30;
var PRIMARY_MODEL = "openai-3-small";
var FALLBACK_1_MODEL = "voyage-3-lite";
var FALLBACK_2_MODEL = "minilm-v6";
var EMBEDDING_MODELS = [
  PRIMARY_MODEL,
  FALLBACK_1_MODEL,
  FALLBACK_2_MODEL
];
var RECENT_NODE_WINDOW = 100;
var FALLBACK_RETRY_DELAY_MS = 1e3;
var FALLBACK_MAX_RETRIES = 2;
var BM25_FIELD_WEIGHTS = {
  title: 2,
  body: 1,
  summary: 1.5,
  tags: 1.5
};
var NodeEmbeddingSchema = z.object({
  vector: z.instanceof(Float32Array),
  dimensions: z.number().int().positive().max(EMBEDDING_DIMENSIONS),
  model: z.string().min(1),
  contextPrefix: z.string(),
  contextHash: z.string().min(1),
  createdAt: z.string().datetime(),
  provisional: z.boolean(),
  version: z.number().int().nonnegative()
});
var ContextPrefixSchema = z.object({
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
var HybridSearchConfigSchema = z.object({
  denseWeight: z.number().min(0).max(1),
  bm25Weight: z.number().min(0).max(1),
  userTunable: z.boolean()
}).refine(
  (data) => Math.abs(data.denseWeight + data.bm25Weight - 1) < 1e-3,
  { message: "Weights must sum to 1.0" }
);
var HybridSearchResultSchema = z.object({
  nodeId: z.string(),
  denseScore: z.number().min(0).max(1),
  bm25Score: z.number().min(0).max(1),
  fusedScore: z.number().min(0).max(1)
});
var SearchFiltersSchema = z.object({
  timeRange: z.object({
    start: z.string().datetime(),
    end: z.string().datetime()
  }).optional(),
  nodeTypes: z.array(z.string()).optional(),
  clusterIds: z.array(z.string()).optional(),
  excludeNodeIds: z.array(z.string()).optional()
});
var QueryAnalysisSchema = z.object({
  hasTimeReference: z.boolean(),
  hasSemanticContent: z.boolean(),
  expectedTypes: z.array(z.string()),
  semanticPart: z.string(),
  originalQuery: z.string()
});
var SimilarityCheckResultSchema = z.object({
  shouldCreateEdge: z.boolean(),
  shouldCheckDedup: z.boolean(),
  similarity: z.number().min(-1).max(1),
  targetNodeId: z.string()
});
var FallbackLevelSchema = z.enum(["primary", "secondary", "local", "degraded"]);
var FallbackConfigSchema = z.object({
  chain: z.array(z.string()),
  retryDelayMs: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative(),
  autoReEmbed: z.boolean()
});
var ProviderHealthSchema = z.object({
  isAvailable: z.boolean(),
  lastSuccessAt: z.string().datetime().optional(),
  lastFailureAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
  consecutiveFailures: z.number().int().nonnegative()
});
var DEFAULT_HYBRID_CONFIG = {
  denseWeight: DENSE_WEIGHT,
  bm25Weight: BM25_WEIGHT,
  userTunable: true
};
var DEFAULT_MATRYOSHKA_CONFIG = {
  stages: [
    { stage: 1, dimensions: 128, candidates: STAGE_1_CANDIDATES, estimatedLatencyMs: 3 },
    { stage: 2, dimensions: 512, candidates: STAGE_2_CANDIDATES, estimatedLatencyMs: 5 },
    { stage: 3, dimensions: 1536, candidates: STAGE_3_CANDIDATES, estimatedLatencyMs: 7 }
  ],
  totalEstimatedLatencyMs: 15
};
var DEFAULT_SIMILARITY_CONFIG = {
  edgeThreshold: SIMILARITY_EDGE_THRESHOLD,
  dedupThreshold: DEDUP_CHECK_THRESHOLD,
  staleThreshold: STALE_EDGE_THRESHOLD,
  recentNodeWindow: RECENT_NODE_WINDOW,
  comparisonDims: COMPARISON_DIMS
};
var DEFAULT_FALLBACK_CONFIG = {
  chain: [PRIMARY_MODEL, FALLBACK_1_MODEL, FALLBACK_2_MODEL],
  retryDelayMs: FALLBACK_RETRY_DELAY_MS,
  maxRetries: FALLBACK_MAX_RETRIES,
  autoReEmbed: true
};
var INITIAL_PROVIDER_HEALTH = {
  isAvailable: true,
  consecutiveFailures: 0
};
var CONTEXT_TEMPLATES = {
  concept_extracted: "[{subtype}] From {source} ({source_type}). {cluster}.",
  concept_manual: "[{subtype}] Created by user. {cluster}.",
  episode: "[{subtype}] {date}, {duration}min. {participants}.",
  document_chunk: "[Chunk {index}/{total}] {parent}. Section: {section}.",
  section: "[Section] {parent}. {title}.",
  note: "[note] {cluster}. {title}.",
  raw_archive: "[archive: {content_type}] {title}.",
  query: "[Query] "
};
var TIME_REFERENCE_PATTERNS = [
  /\b(yesterday|today|tomorrow)\b/i,
  /\b(last|this|next)\s+(week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(in|during|on|at)\s+\d{4}\b/i,
  /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i,
  /\b\d+\s+(days?|weeks?|months?|years?)\s+ago\b/i
];
var GENERIC_WORDS = [
  "what",
  "when",
  "where",
  "who",
  "how",
  "why",
  "happened",
  "did",
  "was",
  "is",
  "are",
  "were",
  "tell",
  "me",
  "about",
  "show",
  "find",
  "get",
  "the",
  "a",
  "an",
  "this",
  "that",
  "it"
];
function hashContext(contextPrefix) {
  let hash = 0;
  for (let i = 0; i < contextPrefix.length; i++) {
    const char = contextPrefix.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}
function createNodeEmbedding(vector, model, contextPrefix, provisional = false) {
  return {
    vector,
    dimensions: vector.length,
    model,
    contextPrefix,
    contextHash: hashContext(contextPrefix),
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    provisional,
    version: 1
  };
}
function isProvisional(embedding) {
  return embedding.provisional;
}
function needsReEmbedding(embedding, currentContextHash) {
  return embedding.contextHash !== currentContextHash;
}
function isPrimaryModel(embedding) {
  return embedding.model === PRIMARY_MODEL;
}
function updateEmbedding(previous, vector, model, contextPrefix, provisional = false) {
  return {
    ...createNodeEmbedding(vector, model, contextPrefix, provisional),
    version: previous.version + 1
  };
}
function truncateToMatryoshka(embedding, dims) {
  if (dims >= embedding.dimensions) {
    return embedding.vector;
  }
  return embedding.vector.slice(0, dims);
}
function getModelDimensions(model) {
  switch (model) {
    case "openai-3-small":
      return 1536;
    case "voyage-3-lite":
      return 512;
    case "minilm-v6":
      return 384;
    default:
      return EMBEDDING_DIMENSIONS;
  }
}
function selectTemplate(nodeType, sourceType) {
  switch (nodeType) {
    case "concept":
      return sourceType === "extraction" ? "concept_extracted" : "concept_manual";
    case "episode":
      return "episode";
    case "chunk":
      return "document_chunk";
    case "section":
      return "section";
    case "note":
      return "note";
    case "raw":
    case "document":
      return "raw_archive";
    default:
      return "concept_manual";
  }
}
function formatContextDate(timestamp) {
  const date = new Date(timestamp);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  return `${months[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
}
function generateContextPrefix(input) {
  const template = selectTemplate(input.nodeType, input.sourceType);
  let generated = CONTEXT_TEMPLATES[template];
  generated = generated.replace("{subtype}", input.nodeSubtype || input.nodeType);
  generated = generated.replace("{source}", input.sourceEpisode?.title || "");
  generated = generated.replace("{source_type}", input.sourceEpisode?.subtype || "");
  generated = generated.replace("{cluster}", input.clusterInfo?.name || "");
  generated = generated.replace("{date}", input.eventTimestamp ? formatContextDate(input.eventTimestamp) : "");
  generated = generated.replace("{duration}", String(input.durationMinutes || 0));
  generated = generated.replace("{participants}", input.participants?.join(", ") || "");
  generated = generated.replace("{index}", String(input.chunkInfo?.index || 0));
  generated = generated.replace("{total}", String(input.chunkInfo?.total || 0));
  generated = generated.replace("{parent}", input.chunkInfo?.parentTitle || "");
  generated = generated.replace("{section}", input.chunkInfo?.sectionTitle || "Main");
  generated = generated.replace("{content_type}", input.contentType || "unknown");
  generated = generated.replace("{title}", input.title);
  generated = generated.replace(/\(\)\.?/g, "");
  generated = generated.replace(/\s+/g, " ");
  generated = generated.trim();
  return {
    template,
    generated,
    hash: hashContext(generated)
  };
}
function expandMinimumContext(content, prefix, clusterInfo) {
  let expandedPrefix = prefix;
  if (content.length < MIN_CONTENT_LENGTH && clusterInfo?.description) {
    expandedPrefix += ` Topic: ${clusterInfo.description}.`;
  }
  if (content.length + expandedPrefix.length < MIN_TOTAL_LENGTH && clusterInfo?.keywords?.length) {
    const keywords = clusterInfo.keywords.slice(0, 5).join(", ");
    expandedPrefix += ` Keywords: ${keywords}.`;
  }
  return expandedPrefix;
}
function generateQueryPrefix(semanticContent) {
  const generated = `[Query] ${semanticContent}`;
  return {
    template: "query",
    generated,
    hash: hashContext(generated)
  };
}
function combineForEmbedding(prefix, content, clusterInfo) {
  const expandedPrefix = expandMinimumContext(content, prefix, clusterInfo);
  return `${expandedPrefix} ${content}`.trim();
}
function getDefaultHybridConfig() {
  return { ...DEFAULT_HYBRID_CONFIG };
}
function fuseScores(denseScore, bm25Score, config = DEFAULT_HYBRID_CONFIG) {
  return denseScore * config.denseWeight + bm25Score * config.bm25Weight;
}
function normalizeScores(results) {
  if (results.length === 0) return [];
  const denseScores = results.map((r) => r.denseScore);
  const bm25Scores = results.map((r) => r.bm25Score);
  const denseMin = Math.min(...denseScores);
  const denseMax = Math.max(...denseScores);
  const bm25Min = Math.min(...bm25Scores);
  const bm25Max = Math.max(...bm25Scores);
  const denseRange = denseMax - denseMin || 1;
  const bm25Range = bm25Max - bm25Min || 1;
  return results.map((result) => ({
    ...result,
    denseScore: (result.denseScore - denseMin) / denseRange,
    bm25Score: (result.bm25Score - bm25Min) / bm25Range
  }));
}
function createSearchResult(nodeId, denseScore, bm25Score, config = DEFAULT_HYBRID_CONFIG) {
  return {
    nodeId,
    denseScore,
    bm25Score,
    fusedScore: fuseScores(denseScore, bm25Score, config)
  };
}
function sortByFusedScore(results) {
  return [...results].sort((a, b) => b.fusedScore - a.fusedScore);
}
function takeTopK(results, k) {
  return sortByFusedScore(results).slice(0, k);
}
function validateHybridConfig(config) {
  return Math.abs(config.denseWeight + config.bm25Weight - 1) < 1e-3;
}
function detectTimeReference(query) {
  return TIME_REFERENCE_PATTERNS.some((pattern) => pattern.test(query));
}
function removeTimeReferences(query) {
  let result = query;
  for (const pattern of TIME_REFERENCE_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.replace(/\s+/g, " ").trim();
}
function removeGenericWords(query) {
  const words = query.toLowerCase().split(/\s+/);
  const filtered = words.filter((word) => !GENERIC_WORDS.includes(word));
  return filtered.join(" ");
}
function inferExpectedTypes(query) {
  const types = [];
  const lower = query.toLowerCase();
  if (lower.includes("lecture") || lower.includes("class") || lower.includes("meeting")) {
    types.push("episode");
  }
  if (lower.includes("concept") || lower.includes("idea") || lower.includes("fact")) {
    types.push("concept");
  }
  if (lower.includes("note") || lower.includes("wrote")) {
    types.push("note");
  }
  if (lower.includes("document") || lower.includes("file") || lower.includes("pdf")) {
    types.push("document", "chunk");
  }
  if (types.length === 0) {
    types.push("concept", "episode", "note");
  }
  return types;
}
function analyzeQuery(rawQuery) {
  const hasTimeReference = detectTimeReference(rawQuery);
  const semanticPart = hasTimeReference ? removeTimeReferences(rawQuery) : rawQuery;
  const cleanedSemantic = removeGenericWords(semanticPart);
  const hasSemanticContent = cleanedSemantic.length >= 3;
  return {
    hasTimeReference,
    hasSemanticContent,
    expectedTypes: inferExpectedTypes(rawQuery),
    semanticPart: cleanedSemantic,
    originalQuery: rawQuery
  };
}
function shouldSkipEmbedding(analysis) {
  return analysis.hasTimeReference && !analysis.hasSemanticContent;
}
function tokenizeForBM25(text) {
  const normalized = text.toLowerCase();
  const tokens = normalized.split(/[\s\-_.,;:!?'"()\[\]{}]+/).filter((token) => token.length > 1);
  return tokens;
}
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}
function truncateForComparison(vector, dims) {
  if (dims >= vector.length) return vector;
  return vector.slice(0, dims);
}
function checkSimilarity(sourceEmbedding, targetEmbedding, targetNodeId, config = DEFAULT_SIMILARITY_CONFIG) {
  const sourceVec = truncateForComparison(
    sourceEmbedding.vector,
    config.comparisonDims
  );
  const targetVec = truncateForComparison(
    targetEmbedding.vector,
    config.comparisonDims
  );
  const similarity = cosineSimilarity(sourceVec, targetVec);
  return {
    shouldCreateEdge: similarity >= config.edgeThreshold,
    shouldCheckDedup: similarity >= config.dedupThreshold,
    similarity,
    targetNodeId
  };
}
function isStaleEdge(currentSimilarity, config = DEFAULT_SIMILARITY_CONFIG) {
  return currentSimilarity < config.staleThreshold;
}
function sortBySimilarity(results) {
  return [...results].sort((a, b) => b.similarity - a.similarity);
}
function getFallbackLevel(modelId) {
  switch (modelId) {
    case PRIMARY_MODEL:
      return "primary";
    case FALLBACK_1_MODEL:
      return "secondary";
    case FALLBACK_2_MODEL:
      return "local";
    default:
      return "degraded";
  }
}
function shouldRetry(error, statusCode) {
  if (statusCode === 429) return true;
  if (statusCode && statusCode >= 500 && statusCode < 600) return true;
  if (error.message.includes("ECONNREFUSED")) return true;
  if (error.message.includes("ETIMEDOUT")) return true;
  if (error.message.includes("network")) return true;
  if (statusCode === 401 || statusCode === 403) return false;
  if (statusCode === 400) return false;
  return false;
}
function getNextProvider(currentModel, config = DEFAULT_FALLBACK_CONFIG) {
  const currentIndex = config.chain.indexOf(currentModel);
  if (currentIndex === -1 || currentIndex >= config.chain.length - 1) {
    return null;
  }
  return config.chain[currentIndex + 1] ?? null;
}
function createInitialFallbackState() {
  const providerHealth = {};
  for (const model of EMBEDDING_MODELS) {
    providerHealth[model] = { ...INITIAL_PROVIDER_HEALTH };
  }
  return {
    currentLevel: "primary",
    recoveryAttempts: 0,
    providerHealth
  };
}
function recordSuccess(state, provider) {
  const newHealth = {
    ...state.providerHealth[provider],
    isAvailable: true,
    lastSuccessAt: (/* @__PURE__ */ new Date()).toISOString(),
    consecutiveFailures: 0
  };
  const newLevel = provider === PRIMARY_MODEL ? "primary" : state.currentLevel;
  return {
    ...state,
    currentLevel: newLevel,
    providerHealth: { ...state.providerHealth, [provider]: newHealth },
    degradedSince: newLevel === "primary" ? void 0 : state.degradedSince
  };
}
function recordFailure(state, provider, error) {
  const currentHealth = state.providerHealth[provider] || INITIAL_PROVIDER_HEALTH;
  const newHealth = {
    ...currentHealth,
    isAvailable: false,
    lastFailureAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastError: error,
    consecutiveFailures: currentHealth.consecutiveFailures + 1
  };
  let newLevel = state.currentLevel;
  if (provider === PRIMARY_MODEL && state.currentLevel === "primary") {
    newLevel = "secondary";
  }
  return {
    ...state,
    currentLevel: newLevel,
    lastError: error,
    providerHealth: { ...state.providerHealth, [provider]: newHealth },
    degradedSince: state.degradedSince || (/* @__PURE__ */ new Date()).toISOString(),
    recoveryAttempts: state.recoveryAttempts + 1
  };
}
function createDegradedResult(error, latencyMs) {
  return {
    embedding: null,
    fallbackLevel: "degraded",
    error,
    latencyMs,
    isProvisional: false
  };
}
function createSuccessResult(embedding, modelUsed, latencyMs) {
  const level = getFallbackLevel(modelUsed);
  return {
    embedding,
    fallbackLevel: level,
    modelUsed,
    latencyMs,
    isProvisional: level !== "primary"
  };
}
function estimateCost(tokens, costPer1M = 0.02) {
  return {
    tokens,
    costUsd: tokens / 1e6 * costPer1M
  };
}
function estimateMonthlyCost(nodesPerDay, queriesPerDay, tokensPerNode = 150, tokensPerQuery = 30, costPer1M = 0.02) {
  const dailyNodeTokens = nodesPerDay * tokensPerNode;
  const dailyQueryTokens = queriesPerDay * tokensPerQuery;
  const monthlyTokens = (dailyNodeTokens + dailyQueryTokens) * 30;
  return estimateCost(monthlyTokens, costPer1M);
}

export { BM25_FIELD_WEIGHTS, BM25_WEIGHT, COMPARISON_DIMS, CONTEXT_TEMPLATES, ContextPrefixSchema, DEDUP_CHECK_THRESHOLD, DEFAULT_FALLBACK_CONFIG, DEFAULT_HYBRID_CONFIG, DEFAULT_MATRYOSHKA_CONFIG, DEFAULT_SIMILARITY_CONFIG, DENSE_WEIGHT, EMBEDDING_DIMENSIONS, EMBEDDING_MODELS, FALLBACK_1_MODEL, FALLBACK_2_MODEL, FALLBACK_MAX_RETRIES, FALLBACK_RETRY_DELAY_MS, FallbackConfigSchema, FallbackLevelSchema, GENERIC_WORDS, HybridSearchConfigSchema, HybridSearchResultSchema, INITIAL_PROVIDER_HEALTH, MATRYOSHKA_DIMS, MIN_CONTENT_LENGTH, MIN_TOTAL_LENGTH, NodeEmbeddingSchema, PRIMARY_MODEL, ProviderHealthSchema, QueryAnalysisSchema, RECENT_NODE_WINDOW, SIMILARITY_EDGE_THRESHOLD, SSA_SEED_THRESHOLD, STAGE_1_CANDIDATES, STAGE_2_CANDIDATES, STAGE_3_CANDIDATES, STALE_EDGE_THRESHOLD, SearchFiltersSchema, SimilarityCheckResultSchema, TIME_REFERENCE_PATTERNS, analyzeQuery, checkSimilarity, combineForEmbedding, cosineSimilarity, createDegradedResult, createInitialFallbackState, createNodeEmbedding, createSearchResult, createSuccessResult, detectTimeReference, estimateCost, estimateMonthlyCost, expandMinimumContext, formatContextDate, fuseScores, generateContextPrefix, generateQueryPrefix, getDefaultHybridConfig, getFallbackLevel, getModelDimensions, getNextProvider, hashContext, inferExpectedTypes, isPrimaryModel, isProvisional, isStaleEdge, needsReEmbedding, normalizeScores, recordFailure, recordSuccess, removeGenericWords, removeTimeReferences, selectTemplate, shouldRetry, shouldSkipEmbedding, sortByFusedScore, sortBySimilarity, takeTopK, tokenizeForBM25, truncateForComparison, truncateToMatryoshka, updateEmbedding, validateHybridConfig };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map