/**
 * @module @nous/core/embeddings
 * @description Contextual Embedding Ecosystem (CEE) - semantic representation for Nous
 * @version 1.0.0
 * @spec Brainstorms/Specs/Phase-2-Data-Representation/storm-016
 *
 * This module implements:
 * - NodeEmbedding interface (expands storm-011 EmbeddingField)
 * - Context prefix generation for all node types
 * - Hybrid search configuration (Dense + BM25)
 * - Matryoshka staged search support
 * - Provider fallback chain
 * - Similarity-based edge creation
 *
 * Core principle: "Context in, context out."
 * Every embedding carries its origins - where information came from,
 * what it relates to, when it happened.
 */

import { z } from 'zod';

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Full embedding vector dimensions (OpenAI text-embedding-3-small)
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Matryoshka truncation dimensions for staged search
 */
export const MATRYOSHKA_DIMS = [128, 512, 1536] as const;

/**
 * Dimension used for fast similarity comparisons
 */
export const COMPARISON_DIMS = 512;

/**
 * Weight for dense (vector) search in hybrid retrieval
 */
export const DENSE_WEIGHT = 0.7;

/**
 * Weight for BM25 (keyword) search in hybrid retrieval
 */
export const BM25_WEIGHT = 0.3;

/**
 * Minimum cosine similarity for automatic 'similar_to' edge creation
 */
export const SIMILARITY_EDGE_THRESHOLD = 0.90;

/**
 * Cosine similarity threshold triggering deduplication check
 */
export const DEDUP_CHECK_THRESHOLD = 0.95;

/**
 * Minimum similarity for SSA seeding
 */
export const SSA_SEED_THRESHOLD = 0.60;

/**
 * Threshold for removing stale similarity edges
 */
export const STALE_EDGE_THRESHOLD = 0.80;

/**
 * Minimum content length before context expansion
 */
export const MIN_CONTENT_LENGTH = 10;

/**
 * Minimum total length (content + prefix) for embedding
 */
export const MIN_TOTAL_LENGTH = 50;

/**
 * Stage 1 (coarse): Candidates from HNSW search
 */
export const STAGE_1_CANDIDATES = 200;

/**
 * Stage 2 (medium): Candidates after rerank
 */
export const STAGE_2_CANDIDATES = 50;

/**
 * Stage 3 (fine): Final candidates
 */
export const STAGE_3_CANDIDATES = 30;

/**
 * Primary embedding model
 */
export const PRIMARY_MODEL = 'openai-3-small' as const;

/**
 * Fallback 1: Voyage AI
 */
export const FALLBACK_1_MODEL = 'voyage-3-lite' as const;

/**
 * Fallback 2: Local MiniLM
 */
export const FALLBACK_2_MODEL = 'minilm-v6' as const;

/**
 * All supported embedding models
 */
export const EMBEDDING_MODELS = [
  PRIMARY_MODEL,
  FALLBACK_1_MODEL,
  FALLBACK_2_MODEL,
] as const;

/**
 * Number of recent nodes to compare against for similarity edges
 */
export const RECENT_NODE_WINDOW = 100;

/**
 * Retry delay between provider attempts (ms)
 */
export const FALLBACK_RETRY_DELAY_MS = 1000;

/**
 * Max retries per provider
 */
export const FALLBACK_MAX_RETRIES = 2;

/**
 * BM25 field weights
 */
export const BM25_FIELD_WEIGHTS = {
  title: 2.0,
  body: 1.0,
  summary: 1.5,
  tags: 1.5,
} as const;

// ============================================================
// TYPES
// ============================================================

export type EmbeddingModelId = (typeof EMBEDDING_MODELS)[number] | string;
export type MatryoshkaDim = (typeof MATRYOSHKA_DIMS)[number];

/**
 * Embedding structure attached to each node
 * Extends storm-011's EmbeddingField placeholder
 */
export interface NodeEmbedding {
  /** The embedding vector (Float32Array) */
  vector: Float32Array;
  /** Number of dimensions in the vector */
  dimensions: number;
  /** Model identifier that generated this embedding */
  model: EmbeddingModelId;
  /** Full context prefix prepended to content */
  contextPrefix: string;
  /** Hash of context prefix for change detection */
  contextHash: string;
  /** ISO 8601 timestamp when embedding was created */
  createdAt: string;
  /** True if embedding was created using a fallback model */
  provisional: boolean;
  /** Version counter, incremented on each re-embedding */
  version: number;
}

/**
 * Context prefix template identifiers
 */
export type ContextPrefixTemplate =
  | 'concept_extracted'
  | 'concept_manual'
  | 'episode'
  | 'document_chunk'
  | 'section'
  | 'note'
  | 'raw_archive'
  | 'query';

/**
 * Generated context prefix with metadata
 */
export interface ContextPrefix {
  template: ContextPrefixTemplate;
  generated: string;
  hash: string;
}

/**
 * Hybrid search configuration
 */
export interface HybridSearchConfig {
  denseWeight: number;
  bm25Weight: number;
  userTunable: boolean;
}

/**
 * Individual search result with component scores
 */
export interface HybridSearchResult {
  nodeId: string;
  denseScore: number;
  bm25Score: number;
  fusedScore: number;
}

/**
 * Matryoshka stage configuration
 */
export interface MatryoshkaStageConfig {
  stage: 1 | 2 | 3;
  dimensions: 128 | 512 | 1536;
  candidates: number;
  estimatedLatencyMs: number;
}

/**
 * Search filters
 */
export interface SearchFilters {
  timeRange?: { start: string; end: string };
  nodeTypes?: string[];
  clusterIds?: string[];
  excludeNodeIds?: string[];
}

/**
 * Result of processing a query
 */
export interface QueryEmbeddingResult {
  dense: Float32Array;
  bm25Terms: string[];
  timeFilter?: { start: string; end: string; confidence: number };
  typeFilter?: string[];
  isPurelyTemporal: boolean;
}

/**
 * Query analysis result
 */
export interface QueryAnalysis {
  hasTimeReference: boolean;
  hasSemanticContent: boolean;
  expectedTypes: string[];
  semanticPart: string;
  originalQuery: string;
}

/**
 * Similarity check result
 */
export interface SimilarityCheckResult {
  shouldCreateEdge: boolean;
  shouldCheckDedup: boolean;
  similarity: number;
  targetNodeId: string;
}

/**
 * Fallback levels
 */
export type FallbackLevel = 'primary' | 'secondary' | 'local' | 'degraded';

/**
 * Provider health status
 */
export interface ProviderHealth {
  isAvailable: boolean;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  consecutiveFailures: number;
}

/**
 * Fallback configuration
 */
export interface FallbackConfig {
  chain: EmbeddingModelId[];
  retryDelayMs: number;
  maxRetries: number;
  autoReEmbed: boolean;
}

/**
 * Fallback state
 */
export interface FallbackState {
  currentLevel: FallbackLevel;
  lastError?: string;
  recoveryAttempts: number;
  degradedSince?: string;
  providerHealth: Record<string, ProviderHealth>;
}

/**
 * Embedding result
 */
export interface EmbedResult {
  embedding: NodeEmbedding | null;
  fallbackLevel: FallbackLevel;
  modelUsed?: EmbeddingModelId;
  error?: string;
  latencyMs: number;
  isProvisional: boolean;
}

/**
 * Context generator input
 */
export interface ContextGeneratorInput {
  nodeType: string;
  nodeSubtype?: string;
  title: string;
  sourceEpisode?: { title: string; subtype: string };
  clusterInfo?: { name: string; description?: string; keywords?: string[] };
  chunkInfo?: { index: number; total: number; sectionTitle?: string; parentTitle: string };
  eventTimestamp?: string;
  durationMinutes?: number;
  participants?: string[];
  contentType?: string;
  sourceType?: 'extraction' | 'manual' | 'inference' | 'import';
}

/**
 * Similarity edge configuration
 */
export interface SimilarityEdgeConfig {
  edgeThreshold: number;
  dedupThreshold: number;
  staleThreshold: number;
  recentNodeWindow: number;
  comparisonDims: number;
}

/**
 * Provider configuration
 */
export interface EmbeddingProviderConfig {
  id: EmbeddingModelId;
  name: string;
  apiEndpoint: string;
  modelName: string;
  dimensions: number;
  supportsMatryoshka: boolean;
  costPer1MTokens: number;
  maxTokens: number;
  isLocal: boolean;
}

// ============================================================
// ZOD SCHEMAS
// ============================================================

export const NodeEmbeddingSchema = z.object({
  vector: z.instanceof(Float32Array),
  dimensions: z.number().int().positive().max(EMBEDDING_DIMENSIONS),
  model: z.string().min(1),
  contextPrefix: z.string(),
  contextHash: z.string().min(1),
  createdAt: z.string().datetime(),
  provisional: z.boolean(),
  version: z.number().int().nonnegative(),
});

export const ContextPrefixSchema = z.object({
  template: z.enum([
    'concept_extracted',
    'concept_manual',
    'episode',
    'document_chunk',
    'section',
    'note',
    'raw_archive',
    'query',
  ]),
  generated: z.string(),
  hash: z.string(),
});

export const HybridSearchConfigSchema = z.object({
  denseWeight: z.number().min(0).max(1),
  bm25Weight: z.number().min(0).max(1),
  userTunable: z.boolean(),
}).refine(
  (data) => Math.abs(data.denseWeight + data.bm25Weight - 1) < 0.001,
  { message: 'Weights must sum to 1.0' }
);

export const HybridSearchResultSchema = z.object({
  nodeId: z.string(),
  denseScore: z.number().min(0).max(1),
  bm25Score: z.number().min(0).max(1),
  fusedScore: z.number().min(0).max(1),
});

export const SearchFiltersSchema = z.object({
  timeRange: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }).optional(),
  nodeTypes: z.array(z.string()).optional(),
  clusterIds: z.array(z.string()).optional(),
  excludeNodeIds: z.array(z.string()).optional(),
});

export const QueryAnalysisSchema = z.object({
  hasTimeReference: z.boolean(),
  hasSemanticContent: z.boolean(),
  expectedTypes: z.array(z.string()),
  semanticPart: z.string(),
  originalQuery: z.string(),
});

export const SimilarityCheckResultSchema = z.object({
  shouldCreateEdge: z.boolean(),
  shouldCheckDedup: z.boolean(),
  similarity: z.number().min(-1).max(1),
  targetNodeId: z.string(),
});

export const FallbackLevelSchema = z.enum(['primary', 'secondary', 'local', 'degraded']);

export const FallbackConfigSchema = z.object({
  chain: z.array(z.string()),
  retryDelayMs: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative(),
  autoReEmbed: z.boolean(),
});

export const ProviderHealthSchema = z.object({
  isAvailable: z.boolean(),
  lastSuccessAt: z.string().datetime().optional(),
  lastFailureAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
  consecutiveFailures: z.number().int().nonnegative(),
});

// ============================================================
// DEFAULT CONFIGURATIONS
// ============================================================

export const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  denseWeight: DENSE_WEIGHT,
  bm25Weight: BM25_WEIGHT,
  userTunable: true,
};

export const DEFAULT_MATRYOSHKA_CONFIG = {
  stages: [
    { stage: 1 as const, dimensions: 128 as const, candidates: STAGE_1_CANDIDATES, estimatedLatencyMs: 3 },
    { stage: 2 as const, dimensions: 512 as const, candidates: STAGE_2_CANDIDATES, estimatedLatencyMs: 5 },
    { stage: 3 as const, dimensions: 1536 as const, candidates: STAGE_3_CANDIDATES, estimatedLatencyMs: 7 },
  ],
  totalEstimatedLatencyMs: 15,
};

export const DEFAULT_SIMILARITY_CONFIG: SimilarityEdgeConfig = {
  edgeThreshold: SIMILARITY_EDGE_THRESHOLD,
  dedupThreshold: DEDUP_CHECK_THRESHOLD,
  staleThreshold: STALE_EDGE_THRESHOLD,
  recentNodeWindow: RECENT_NODE_WINDOW,
  comparisonDims: COMPARISON_DIMS,
};

export const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  chain: [PRIMARY_MODEL, FALLBACK_1_MODEL, FALLBACK_2_MODEL],
  retryDelayMs: FALLBACK_RETRY_DELAY_MS,
  maxRetries: FALLBACK_MAX_RETRIES,
  autoReEmbed: true,
};

export const INITIAL_PROVIDER_HEALTH: ProviderHealth = {
  isAvailable: true,
  consecutiveFailures: 0,
};

/**
 * Context template definitions
 */
export const CONTEXT_TEMPLATES: Record<ContextPrefixTemplate, string> = {
  concept_extracted: '[{subtype}] From {source} ({source_type}). {cluster}.',
  concept_manual: '[{subtype}] Created by user. {cluster}.',
  episode: '[{subtype}] {date}, {duration}min. {participants}.',
  document_chunk: '[Chunk {index}/{total}] {parent}. Section: {section}.',
  section: '[Section] {parent}. {title}.',
  note: '[note] {cluster}. {title}.',
  raw_archive: '[archive: {content_type}] {title}.',
  query: '[Query] ',
};

/**
 * Time reference patterns for detection
 */
export const TIME_REFERENCE_PATTERNS = [
  /\b(yesterday|today|tomorrow)\b/i,
  /\b(last|this|next)\s+(week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(in|during|on|at)\s+\d{4}\b/i,
  /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i,
  /\b\d+\s+(days?|weeks?|months?|years?)\s+ago\b/i,
];

/**
 * Generic words to filter from semantic queries
 */
export const GENERIC_WORDS = [
  'what', 'when', 'where', 'who', 'how', 'why',
  'happened', 'did', 'was', 'is', 'are', 'were',
  'tell', 'me', 'about', 'show', 'find', 'get',
  'the', 'a', 'an', 'this', 'that', 'it',
];

// ============================================================
// HASH FUNCTION
// ============================================================

/**
 * Compute a hash of the context prefix for change detection.
 * Simple but effective hash for fast comparison.
 */
export function hashContext(contextPrefix: string): string {
  let hash = 0;
  for (let i = 0; i < contextPrefix.length; i++) {
    const char = contextPrefix.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ============================================================
// NODE EMBEDDING FUNCTIONS
// ============================================================

/**
 * Create a new node embedding
 */
export function createNodeEmbedding(
  vector: Float32Array,
  model: EmbeddingModelId,
  contextPrefix: string,
  provisional = false
): NodeEmbedding {
  return {
    vector,
    dimensions: vector.length,
    model,
    contextPrefix,
    contextHash: hashContext(contextPrefix),
    createdAt: new Date().toISOString(),
    provisional,
    version: 1,
  };
}

/**
 * Check if an embedding is provisional
 */
export function isProvisional(embedding: NodeEmbedding): boolean {
  return embedding.provisional;
}

/**
 * Check if an embedding needs re-embedding due to context changes
 */
export function needsReEmbedding(
  embedding: NodeEmbedding,
  currentContextHash: string
): boolean {
  return embedding.contextHash !== currentContextHash;
}

/**
 * Check if an embedding uses the primary model
 */
export function isPrimaryModel(embedding: NodeEmbedding): boolean {
  return embedding.model === PRIMARY_MODEL;
}

/**
 * Update an embedding (increments version)
 */
export function updateEmbedding(
  previous: NodeEmbedding,
  vector: Float32Array,
  model: EmbeddingModelId,
  contextPrefix: string,
  provisional = false
): NodeEmbedding {
  return {
    ...createNodeEmbedding(vector, model, contextPrefix, provisional),
    version: previous.version + 1,
  };
}

/**
 * Truncate embedding vector to Matryoshka dimension
 */
export function truncateToMatryoshka(
  embedding: NodeEmbedding,
  dims: 128 | 512 | 1536
): Float32Array {
  if (dims >= embedding.dimensions) {
    return embedding.vector;
  }
  return embedding.vector.slice(0, dims);
}

/**
 * Get dimensions for a model
 */
export function getModelDimensions(model: EmbeddingModelId): number {
  switch (model) {
    case 'openai-3-small':
      return 1536;
    case 'voyage-3-lite':
      return 512;
    case 'minilm-v6':
      return 384;
    default:
      return EMBEDDING_DIMENSIONS;
  }
}

// ============================================================
// CONTEXT PREFIX FUNCTIONS
// ============================================================

/**
 * Select the appropriate template for a node
 */
export function selectTemplate(
  nodeType: string,
  sourceType?: 'extraction' | 'manual' | 'inference' | 'import'
): ContextPrefixTemplate {
  switch (nodeType) {
    case 'concept':
      return sourceType === 'extraction' ? 'concept_extracted' : 'concept_manual';
    case 'episode':
      return 'episode';
    case 'chunk':
      return 'document_chunk';
    case 'section':
      return 'section';
    case 'note':
      return 'note';
    case 'raw':
    case 'document':
      return 'raw_archive';
    default:
      return 'concept_manual';
  }
}

/**
 * Format a date for context prefix
 */
export function formatContextDate(timestamp: string): string {
  const date = new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
}

/**
 * Generate context prefix for a node
 */
export function generateContextPrefix(input: ContextGeneratorInput): ContextPrefix {
  const template = selectTemplate(input.nodeType, input.sourceType);
  let generated = CONTEXT_TEMPLATES[template];

  // Replace placeholders
  generated = generated.replace('{subtype}', input.nodeSubtype || input.nodeType);
  generated = generated.replace('{source}', input.sourceEpisode?.title || '');
  generated = generated.replace('{source_type}', input.sourceEpisode?.subtype || '');
  generated = generated.replace('{cluster}', input.clusterInfo?.name || '');
  generated = generated.replace('{date}', input.eventTimestamp
    ? formatContextDate(input.eventTimestamp)
    : '');
  generated = generated.replace('{duration}', String(input.durationMinutes || 0));
  generated = generated.replace('{participants}', input.participants?.join(', ') || '');
  generated = generated.replace('{index}', String(input.chunkInfo?.index || 0));
  generated = generated.replace('{total}', String(input.chunkInfo?.total || 0));
  generated = generated.replace('{parent}', input.chunkInfo?.parentTitle || '');
  generated = generated.replace('{section}', input.chunkInfo?.sectionTitle || 'Main');
  generated = generated.replace('{content_type}', input.contentType || 'unknown');
  generated = generated.replace('{title}', input.title);

  // Clean up empty segments
  generated = generated.replace(/\(\)\.?/g, '');
  generated = generated.replace(/\s+/g, ' ');
  generated = generated.trim();

  return {
    template,
    generated,
    hash: hashContext(generated),
  };
}

/**
 * Expand short content with additional context
 */
export function expandMinimumContext(
  content: string,
  prefix: string,
  clusterInfo?: { name: string; description?: string; keywords?: string[] }
): string {
  let expandedPrefix = prefix;

  if (content.length < MIN_CONTENT_LENGTH && clusterInfo?.description) {
    expandedPrefix += ` Topic: ${clusterInfo.description}.`;
  }

  if (
    (content.length + expandedPrefix.length) < MIN_TOTAL_LENGTH &&
    clusterInfo?.keywords?.length
  ) {
    const keywords = clusterInfo.keywords.slice(0, 5).join(', ');
    expandedPrefix += ` Keywords: ${keywords}.`;
  }

  return expandedPrefix;
}

/**
 * Generate query prefix
 */
export function generateQueryPrefix(semanticContent: string): ContextPrefix {
  const generated = `[Query] ${semanticContent}`;
  return {
    template: 'query',
    generated,
    hash: hashContext(generated),
  };
}

/**
 * Combine prefix and content for embedding
 */
export function combineForEmbedding(
  prefix: string,
  content: string,
  clusterInfo?: { name: string; description?: string; keywords?: string[] }
): string {
  const expandedPrefix = expandMinimumContext(content, prefix, clusterInfo);
  return `${expandedPrefix} ${content}`.trim();
}

// ============================================================
// HYBRID SEARCH FUNCTIONS
// ============================================================

/**
 * Get default hybrid search configuration
 */
export function getDefaultHybridConfig(): HybridSearchConfig {
  return { ...DEFAULT_HYBRID_CONFIG };
}

/**
 * Fuse dense and BM25 scores
 */
export function fuseScores(
  denseScore: number,
  bm25Score: number,
  config: HybridSearchConfig = DEFAULT_HYBRID_CONFIG
): number {
  return (denseScore * config.denseWeight) + (bm25Score * config.bm25Weight);
}

/**
 * Normalize scores to 0-1 range
 */
export function normalizeScores(
  results: HybridSearchResult[]
): HybridSearchResult[] {
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
    bm25Score: (result.bm25Score - bm25Min) / bm25Range,
  }));
}

/**
 * Create a search result
 */
export function createSearchResult(
  nodeId: string,
  denseScore: number,
  bm25Score: number,
  config: HybridSearchConfig = DEFAULT_HYBRID_CONFIG
): HybridSearchResult {
  return {
    nodeId,
    denseScore,
    bm25Score,
    fusedScore: fuseScores(denseScore, bm25Score, config),
  };
}

/**
 * Sort results by fused score descending
 */
export function sortByFusedScore(
  results: HybridSearchResult[]
): HybridSearchResult[] {
  return [...results].sort((a, b) => b.fusedScore - a.fusedScore);
}

/**
 * Take top k results
 */
export function takeTopK(
  results: HybridSearchResult[],
  k: number
): HybridSearchResult[] {
  return sortByFusedScore(results).slice(0, k);
}

/**
 * Validate hybrid config
 */
export function validateHybridConfig(config: HybridSearchConfig): boolean {
  return Math.abs(config.denseWeight + config.bm25Weight - 1) < 0.001;
}

// ============================================================
// QUERY PROCESSING FUNCTIONS
// ============================================================

/**
 * Detect if a query contains time references
 */
export function detectTimeReference(query: string): boolean {
  return TIME_REFERENCE_PATTERNS.some((pattern) => pattern.test(query));
}

/**
 * Remove time references from query
 */
export function removeTimeReferences(query: string): string {
  let result = query;
  for (const pattern of TIME_REFERENCE_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Remove generic words from query
 */
export function removeGenericWords(query: string): string {
  const words = query.toLowerCase().split(/\s+/);
  const filtered = words.filter((word) => !GENERIC_WORDS.includes(word));
  return filtered.join(' ');
}

/**
 * Infer expected node types from query
 */
export function inferExpectedTypes(query: string): string[] {
  const types: string[] = [];
  const lower = query.toLowerCase();

  if (lower.includes('lecture') || lower.includes('class') || lower.includes('meeting')) {
    types.push('episode');
  }
  if (lower.includes('concept') || lower.includes('idea') || lower.includes('fact')) {
    types.push('concept');
  }
  if (lower.includes('note') || lower.includes('wrote')) {
    types.push('note');
  }
  if (lower.includes('document') || lower.includes('file') || lower.includes('pdf')) {
    types.push('document', 'chunk');
  }

  if (types.length === 0) {
    types.push('concept', 'episode', 'note');
  }

  return types;
}

/**
 * Analyze a raw query
 */
export function analyzeQuery(rawQuery: string): QueryAnalysis {
  const hasTimeReference = detectTimeReference(rawQuery);
  const semanticPart = hasTimeReference
    ? removeTimeReferences(rawQuery)
    : rawQuery;
  const cleanedSemantic = removeGenericWords(semanticPart);
  const hasSemanticContent = cleanedSemantic.length >= 3;

  return {
    hasTimeReference,
    hasSemanticContent,
    expectedTypes: inferExpectedTypes(rawQuery),
    semanticPart: cleanedSemantic,
    originalQuery: rawQuery,
  };
}

/**
 * Determine if query should skip embedding
 */
export function shouldSkipEmbedding(analysis: QueryAnalysis): boolean {
  return analysis.hasTimeReference && !analysis.hasSemanticContent;
}

/**
 * Tokenize text for BM25 search
 */
export function tokenizeForBM25(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens = normalized
    .split(/[\s\-_.,;:!?'"()\[\]{}]+/)
    .filter((token) => token.length > 1);
  return tokens;
}

// ============================================================
// SIMILARITY FUNCTIONS
// ============================================================

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Truncate vector for fast comparison
 */
export function truncateForComparison(
  vector: Float32Array,
  dims: number
): Float32Array {
  if (dims >= vector.length) return vector;
  return vector.slice(0, dims);
}

/**
 * Check similarity between embeddings
 */
export function checkSimilarity(
  sourceEmbedding: NodeEmbedding,
  targetEmbedding: NodeEmbedding,
  targetNodeId: string,
  config: SimilarityEdgeConfig = DEFAULT_SIMILARITY_CONFIG
): SimilarityCheckResult {
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
    targetNodeId,
  };
}

/**
 * Check if edge is stale
 */
export function isStaleEdge(
  currentSimilarity: number,
  config: SimilarityEdgeConfig = DEFAULT_SIMILARITY_CONFIG
): boolean {
  return currentSimilarity < config.staleThreshold;
}

/**
 * Sort results by similarity descending
 */
export function sortBySimilarity(
  results: SimilarityCheckResult[]
): SimilarityCheckResult[] {
  return [...results].sort((a, b) => b.similarity - a.similarity);
}

// ============================================================
// FALLBACK FUNCTIONS
// ============================================================

/**
 * Get fallback level for a model
 */
export function getFallbackLevel(modelId: EmbeddingModelId): FallbackLevel {
  switch (modelId) {
    case PRIMARY_MODEL:
      return 'primary';
    case FALLBACK_1_MODEL:
      return 'secondary';
    case FALLBACK_2_MODEL:
      return 'local';
    default:
      return 'degraded';
  }
}

/**
 * Determine if an error is retryable
 */
export function shouldRetry(error: Error, statusCode?: number): boolean {
  if (statusCode === 429) return true;
  if (statusCode && statusCode >= 500 && statusCode < 600) return true;
  if (error.message.includes('ECONNREFUSED')) return true;
  if (error.message.includes('ETIMEDOUT')) return true;
  if (error.message.includes('network')) return true;
  if (statusCode === 401 || statusCode === 403) return false;
  if (statusCode === 400) return false;
  return false;
}

/**
 * Get next provider in fallback chain
 */
export function getNextProvider(
  currentModel: EmbeddingModelId,
  config: FallbackConfig = DEFAULT_FALLBACK_CONFIG
): EmbeddingModelId | null {
  const currentIndex = config.chain.indexOf(currentModel);
  if (currentIndex === -1 || currentIndex >= config.chain.length - 1) {
    return null;
  }
  return config.chain[currentIndex + 1] ?? null;
}

/**
 * Create initial fallback state
 */
export function createInitialFallbackState(): FallbackState {
  const providerHealth: Record<string, ProviderHealth> = {};
  for (const model of EMBEDDING_MODELS) {
    providerHealth[model] = { ...INITIAL_PROVIDER_HEALTH };
  }

  return {
    currentLevel: 'primary',
    recoveryAttempts: 0,
    providerHealth,
  };
}

/**
 * Record provider success
 */
export function recordSuccess(
  state: FallbackState,
  provider: EmbeddingModelId
): FallbackState {
  const newHealth: ProviderHealth = {
    ...state.providerHealth[provider],
    isAvailable: true,
    lastSuccessAt: new Date().toISOString(),
    consecutiveFailures: 0,
  };

  const newLevel = provider === PRIMARY_MODEL ? 'primary' : state.currentLevel;

  return {
    ...state,
    currentLevel: newLevel,
    providerHealth: { ...state.providerHealth, [provider]: newHealth },
    degradedSince: newLevel === 'primary' ? undefined : state.degradedSince,
  };
}

/**
 * Record provider failure
 */
export function recordFailure(
  state: FallbackState,
  provider: EmbeddingModelId,
  error: string
): FallbackState {
  const currentHealth = state.providerHealth[provider] || INITIAL_PROVIDER_HEALTH;
  const newHealth: ProviderHealth = {
    ...currentHealth,
    isAvailable: false,
    lastFailureAt: new Date().toISOString(),
    lastError: error,
    consecutiveFailures: currentHealth.consecutiveFailures + 1,
  };

  let newLevel = state.currentLevel;
  if (provider === PRIMARY_MODEL && state.currentLevel === 'primary') {
    newLevel = 'secondary';
  }

  return {
    ...state,
    currentLevel: newLevel,
    lastError: error,
    providerHealth: { ...state.providerHealth, [provider]: newHealth },
    degradedSince: state.degradedSince || new Date().toISOString(),
    recoveryAttempts: state.recoveryAttempts + 1,
  };
}

/**
 * Create degraded result (no embedding)
 */
export function createDegradedResult(error: string, latencyMs: number): EmbedResult {
  return {
    embedding: null,
    fallbackLevel: 'degraded',
    error,
    latencyMs,
    isProvisional: false,
  };
}

/**
 * Create success result
 */
export function createSuccessResult(
  embedding: NodeEmbedding,
  modelUsed: EmbeddingModelId,
  latencyMs: number
): EmbedResult {
  const level = getFallbackLevel(modelUsed);
  return {
    embedding,
    fallbackLevel: level,
    modelUsed,
    latencyMs,
    isProvisional: level !== 'primary',
  };
}

// ============================================================
// COST ESTIMATION
// ============================================================

/**
 * Estimate embedding cost
 */
export function estimateCost(
  tokens: number,
  costPer1M = 0.02
): { tokens: number; costUsd: number } {
  return {
    tokens,
    costUsd: (tokens / 1_000_000) * costPer1M,
  };
}

/**
 * Estimate monthly cost
 */
export function estimateMonthlyCost(
  nodesPerDay: number,
  queriesPerDay: number,
  tokensPerNode = 150,
  tokensPerQuery = 30,
  costPer1M = 0.02
): { tokens: number; costUsd: number } {
  const dailyNodeTokens = nodesPerDay * tokensPerNode;
  const dailyQueryTokens = queriesPerDay * tokensPerQuery;
  const monthlyTokens = (dailyNodeTokens + dailyQueryTokens) * 30;
  return estimateCost(monthlyTokens, costPer1M);
}
