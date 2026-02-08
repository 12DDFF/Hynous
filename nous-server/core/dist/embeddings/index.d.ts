import { z } from 'zod';

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

/**
 * Full embedding vector dimensions (OpenAI text-embedding-3-small)
 */
declare const EMBEDDING_DIMENSIONS = 1536;
/**
 * Matryoshka truncation dimensions for staged search
 */
declare const MATRYOSHKA_DIMS: readonly [128, 512, 1536];
/**
 * Dimension used for fast similarity comparisons
 */
declare const COMPARISON_DIMS = 512;
/**
 * Weight for dense (vector) search in hybrid retrieval
 */
declare const DENSE_WEIGHT = 0.7;
/**
 * Weight for BM25 (keyword) search in hybrid retrieval
 */
declare const BM25_WEIGHT = 0.3;
/**
 * Minimum cosine similarity for automatic 'similar_to' edge creation
 */
declare const SIMILARITY_EDGE_THRESHOLD = 0.9;
/**
 * Cosine similarity threshold triggering deduplication check
 */
declare const DEDUP_CHECK_THRESHOLD = 0.95;
/**
 * Minimum similarity for SSA seeding
 */
declare const SSA_SEED_THRESHOLD = 0.6;
/**
 * Threshold for removing stale similarity edges
 */
declare const STALE_EDGE_THRESHOLD = 0.8;
/**
 * Minimum content length before context expansion
 */
declare const MIN_CONTENT_LENGTH = 10;
/**
 * Minimum total length (content + prefix) for embedding
 */
declare const MIN_TOTAL_LENGTH = 50;
/**
 * Stage 1 (coarse): Candidates from HNSW search
 */
declare const STAGE_1_CANDIDATES = 200;
/**
 * Stage 2 (medium): Candidates after rerank
 */
declare const STAGE_2_CANDIDATES = 50;
/**
 * Stage 3 (fine): Final candidates
 */
declare const STAGE_3_CANDIDATES = 30;
/**
 * Primary embedding model
 */
declare const PRIMARY_MODEL: "openai-3-small";
/**
 * Fallback 1: Voyage AI
 */
declare const FALLBACK_1_MODEL: "voyage-3-lite";
/**
 * Fallback 2: Local MiniLM
 */
declare const FALLBACK_2_MODEL: "minilm-v6";
/**
 * All supported embedding models
 */
declare const EMBEDDING_MODELS: readonly ["openai-3-small", "voyage-3-lite", "minilm-v6"];
/**
 * Number of recent nodes to compare against for similarity edges
 */
declare const RECENT_NODE_WINDOW = 100;
/**
 * Retry delay between provider attempts (ms)
 */
declare const FALLBACK_RETRY_DELAY_MS = 1000;
/**
 * Max retries per provider
 */
declare const FALLBACK_MAX_RETRIES = 2;
/**
 * BM25 field weights
 */
declare const BM25_FIELD_WEIGHTS: {
    readonly title: 2;
    readonly body: 1;
    readonly summary: 1.5;
    readonly tags: 1.5;
};
type EmbeddingModelId = (typeof EMBEDDING_MODELS)[number] | string;
type MatryoshkaDim = (typeof MATRYOSHKA_DIMS)[number];
/**
 * Embedding structure attached to each node
 * Extends storm-011's EmbeddingField placeholder
 */
interface NodeEmbedding {
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
type ContextPrefixTemplate = 'concept_extracted' | 'concept_manual' | 'episode' | 'document_chunk' | 'section' | 'note' | 'raw_archive' | 'query';
/**
 * Generated context prefix with metadata
 */
interface ContextPrefix {
    template: ContextPrefixTemplate;
    generated: string;
    hash: string;
}
/**
 * Hybrid search configuration
 */
interface HybridSearchConfig {
    denseWeight: number;
    bm25Weight: number;
    userTunable: boolean;
}
/**
 * Individual search result with component scores
 */
interface HybridSearchResult {
    nodeId: string;
    denseScore: number;
    bm25Score: number;
    fusedScore: number;
}
/**
 * Matryoshka stage configuration
 */
interface MatryoshkaStageConfig {
    stage: 1 | 2 | 3;
    dimensions: 128 | 512 | 1536;
    candidates: number;
    estimatedLatencyMs: number;
}
/**
 * Search filters
 */
interface SearchFilters {
    timeRange?: {
        start: string;
        end: string;
    };
    nodeTypes?: string[];
    clusterIds?: string[];
    excludeNodeIds?: string[];
}
/**
 * Result of processing a query
 */
interface QueryEmbeddingResult {
    dense: Float32Array;
    bm25Terms: string[];
    timeFilter?: {
        start: string;
        end: string;
        confidence: number;
    };
    typeFilter?: string[];
    isPurelyTemporal: boolean;
}
/**
 * Query analysis result
 */
interface QueryAnalysis {
    hasTimeReference: boolean;
    hasSemanticContent: boolean;
    expectedTypes: string[];
    semanticPart: string;
    originalQuery: string;
}
/**
 * Similarity check result
 */
interface SimilarityCheckResult {
    shouldCreateEdge: boolean;
    shouldCheckDedup: boolean;
    similarity: number;
    targetNodeId: string;
}
/**
 * Fallback levels
 */
type FallbackLevel = 'primary' | 'secondary' | 'local' | 'degraded';
/**
 * Provider health status
 */
interface ProviderHealth {
    isAvailable: boolean;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastError?: string;
    consecutiveFailures: number;
}
/**
 * Fallback configuration
 */
interface FallbackConfig {
    chain: EmbeddingModelId[];
    retryDelayMs: number;
    maxRetries: number;
    autoReEmbed: boolean;
}
/**
 * Fallback state
 */
interface FallbackState {
    currentLevel: FallbackLevel;
    lastError?: string;
    recoveryAttempts: number;
    degradedSince?: string;
    providerHealth: Record<string, ProviderHealth>;
}
/**
 * Embedding result
 */
interface EmbedResult {
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
interface ContextGeneratorInput {
    nodeType: string;
    nodeSubtype?: string;
    title: string;
    sourceEpisode?: {
        title: string;
        subtype: string;
    };
    clusterInfo?: {
        name: string;
        description?: string;
        keywords?: string[];
    };
    chunkInfo?: {
        index: number;
        total: number;
        sectionTitle?: string;
        parentTitle: string;
    };
    eventTimestamp?: string;
    durationMinutes?: number;
    participants?: string[];
    contentType?: string;
    sourceType?: 'extraction' | 'manual' | 'inference' | 'import';
}
/**
 * Similarity edge configuration
 */
interface SimilarityEdgeConfig {
    edgeThreshold: number;
    dedupThreshold: number;
    staleThreshold: number;
    recentNodeWindow: number;
    comparisonDims: number;
}
/**
 * Provider configuration
 */
interface EmbeddingProviderConfig {
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
declare const NodeEmbeddingSchema: z.ZodObject<{
    vector: z.ZodType<Float32Array<ArrayBuffer>, z.ZodTypeDef, Float32Array<ArrayBuffer>>;
    dimensions: z.ZodNumber;
    model: z.ZodString;
    contextPrefix: z.ZodString;
    contextHash: z.ZodString;
    createdAt: z.ZodString;
    provisional: z.ZodBoolean;
    version: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    vector: Float32Array<ArrayBuffer>;
    model: string;
    version: number;
    provisional: boolean;
    createdAt: string;
    dimensions: number;
    contextPrefix: string;
    contextHash: string;
}, {
    vector: Float32Array<ArrayBuffer>;
    model: string;
    version: number;
    provisional: boolean;
    createdAt: string;
    dimensions: number;
    contextPrefix: string;
    contextHash: string;
}>;
declare const ContextPrefixSchema: z.ZodObject<{
    template: z.ZodEnum<["concept_extracted", "concept_manual", "episode", "document_chunk", "section", "note", "raw_archive", "query"]>;
    generated: z.ZodString;
    hash: z.ZodString;
}, "strip", z.ZodTypeAny, {
    template: "episode" | "section" | "note" | "query" | "concept_extracted" | "concept_manual" | "document_chunk" | "raw_archive";
    generated: string;
    hash: string;
}, {
    template: "episode" | "section" | "note" | "query" | "concept_extracted" | "concept_manual" | "document_chunk" | "raw_archive";
    generated: string;
    hash: string;
}>;
declare const HybridSearchConfigSchema: z.ZodEffects<z.ZodObject<{
    denseWeight: z.ZodNumber;
    bm25Weight: z.ZodNumber;
    userTunable: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    denseWeight: number;
    bm25Weight: number;
    userTunable: boolean;
}, {
    denseWeight: number;
    bm25Weight: number;
    userTunable: boolean;
}>, {
    denseWeight: number;
    bm25Weight: number;
    userTunable: boolean;
}, {
    denseWeight: number;
    bm25Weight: number;
    userTunable: boolean;
}>;
declare const HybridSearchResultSchema: z.ZodObject<{
    nodeId: z.ZodString;
    denseScore: z.ZodNumber;
    bm25Score: z.ZodNumber;
    fusedScore: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    nodeId: string;
    denseScore: number;
    bm25Score: number;
    fusedScore: number;
}, {
    nodeId: string;
    denseScore: number;
    bm25Score: number;
    fusedScore: number;
}>;
declare const SearchFiltersSchema: z.ZodObject<{
    timeRange: z.ZodOptional<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        start: string;
        end: string;
    }, {
        start: string;
        end: string;
    }>>;
    nodeTypes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    clusterIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    excludeNodeIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    nodeTypes?: string[] | undefined;
    timeRange?: {
        start: string;
        end: string;
    } | undefined;
    clusterIds?: string[] | undefined;
    excludeNodeIds?: string[] | undefined;
}, {
    nodeTypes?: string[] | undefined;
    timeRange?: {
        start: string;
        end: string;
    } | undefined;
    clusterIds?: string[] | undefined;
    excludeNodeIds?: string[] | undefined;
}>;
declare const QueryAnalysisSchema: z.ZodObject<{
    hasTimeReference: z.ZodBoolean;
    hasSemanticContent: z.ZodBoolean;
    expectedTypes: z.ZodArray<z.ZodString, "many">;
    semanticPart: z.ZodString;
    originalQuery: z.ZodString;
}, "strip", z.ZodTypeAny, {
    hasTimeReference: boolean;
    hasSemanticContent: boolean;
    expectedTypes: string[];
    semanticPart: string;
    originalQuery: string;
}, {
    hasTimeReference: boolean;
    hasSemanticContent: boolean;
    expectedTypes: string[];
    semanticPart: string;
    originalQuery: string;
}>;
declare const SimilarityCheckResultSchema: z.ZodObject<{
    shouldCreateEdge: z.ZodBoolean;
    shouldCheckDedup: z.ZodBoolean;
    similarity: z.ZodNumber;
    targetNodeId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    similarity: number;
    shouldCreateEdge: boolean;
    shouldCheckDedup: boolean;
    targetNodeId: string;
}, {
    similarity: number;
    shouldCreateEdge: boolean;
    shouldCheckDedup: boolean;
    targetNodeId: string;
}>;
declare const FallbackLevelSchema: z.ZodEnum<["primary", "secondary", "local", "degraded"]>;
declare const FallbackConfigSchema: z.ZodObject<{
    chain: z.ZodArray<z.ZodString, "many">;
    retryDelayMs: z.ZodNumber;
    maxRetries: z.ZodNumber;
    autoReEmbed: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    maxRetries: number;
    retryDelayMs: number;
    chain: string[];
    autoReEmbed: boolean;
}, {
    maxRetries: number;
    retryDelayMs: number;
    chain: string[];
    autoReEmbed: boolean;
}>;
declare const ProviderHealthSchema: z.ZodObject<{
    isAvailable: z.ZodBoolean;
    lastSuccessAt: z.ZodOptional<z.ZodString>;
    lastFailureAt: z.ZodOptional<z.ZodString>;
    lastError: z.ZodOptional<z.ZodString>;
    consecutiveFailures: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    isAvailable: boolean;
    consecutiveFailures: number;
    lastSuccessAt?: string | undefined;
    lastFailureAt?: string | undefined;
    lastError?: string | undefined;
}, {
    isAvailable: boolean;
    consecutiveFailures: number;
    lastSuccessAt?: string | undefined;
    lastFailureAt?: string | undefined;
    lastError?: string | undefined;
}>;
declare const DEFAULT_HYBRID_CONFIG: HybridSearchConfig;
declare const DEFAULT_MATRYOSHKA_CONFIG: {
    stages: ({
        stage: 1;
        dimensions: 128;
        candidates: number;
        estimatedLatencyMs: number;
    } | {
        stage: 2;
        dimensions: 512;
        candidates: number;
        estimatedLatencyMs: number;
    } | {
        stage: 3;
        dimensions: 1536;
        candidates: number;
        estimatedLatencyMs: number;
    })[];
    totalEstimatedLatencyMs: number;
};
declare const DEFAULT_SIMILARITY_CONFIG: SimilarityEdgeConfig;
declare const DEFAULT_FALLBACK_CONFIG: FallbackConfig;
declare const INITIAL_PROVIDER_HEALTH: ProviderHealth;
/**
 * Context template definitions
 */
declare const CONTEXT_TEMPLATES: Record<ContextPrefixTemplate, string>;
/**
 * Time reference patterns for detection
 */
declare const TIME_REFERENCE_PATTERNS: RegExp[];
/**
 * Generic words to filter from semantic queries
 */
declare const GENERIC_WORDS: string[];
/**
 * Compute a hash of the context prefix for change detection.
 * Simple but effective hash for fast comparison.
 */
declare function hashContext(contextPrefix: string): string;
/**
 * Create a new node embedding
 */
declare function createNodeEmbedding(vector: Float32Array, model: EmbeddingModelId, contextPrefix: string, provisional?: boolean): NodeEmbedding;
/**
 * Check if an embedding is provisional
 */
declare function isProvisional(embedding: NodeEmbedding): boolean;
/**
 * Check if an embedding needs re-embedding due to context changes
 */
declare function needsReEmbedding(embedding: NodeEmbedding, currentContextHash: string): boolean;
/**
 * Check if an embedding uses the primary model
 */
declare function isPrimaryModel(embedding: NodeEmbedding): boolean;
/**
 * Update an embedding (increments version)
 */
declare function updateEmbedding(previous: NodeEmbedding, vector: Float32Array, model: EmbeddingModelId, contextPrefix: string, provisional?: boolean): NodeEmbedding;
/**
 * Truncate embedding vector to Matryoshka dimension
 */
declare function truncateToMatryoshka(embedding: NodeEmbedding, dims: 128 | 512 | 1536): Float32Array;
/**
 * Get dimensions for a model
 */
declare function getModelDimensions(model: EmbeddingModelId): number;
/**
 * Select the appropriate template for a node
 */
declare function selectTemplate(nodeType: string, sourceType?: 'extraction' | 'manual' | 'inference' | 'import'): ContextPrefixTemplate;
/**
 * Format a date for context prefix
 */
declare function formatContextDate(timestamp: string): string;
/**
 * Generate context prefix for a node
 */
declare function generateContextPrefix(input: ContextGeneratorInput): ContextPrefix;
/**
 * Expand short content with additional context
 */
declare function expandMinimumContext(content: string, prefix: string, clusterInfo?: {
    name: string;
    description?: string;
    keywords?: string[];
}): string;
/**
 * Generate query prefix
 */
declare function generateQueryPrefix(semanticContent: string): ContextPrefix;
/**
 * Combine prefix and content for embedding
 */
declare function combineForEmbedding(prefix: string, content: string, clusterInfo?: {
    name: string;
    description?: string;
    keywords?: string[];
}): string;
/**
 * Get default hybrid search configuration
 */
declare function getDefaultHybridConfig(): HybridSearchConfig;
/**
 * Fuse dense and BM25 scores
 */
declare function fuseScores(denseScore: number, bm25Score: number, config?: HybridSearchConfig): number;
/**
 * Normalize scores to 0-1 range
 */
declare function normalizeScores(results: HybridSearchResult[]): HybridSearchResult[];
/**
 * Create a search result
 */
declare function createSearchResult(nodeId: string, denseScore: number, bm25Score: number, config?: HybridSearchConfig): HybridSearchResult;
/**
 * Sort results by fused score descending
 */
declare function sortByFusedScore(results: HybridSearchResult[]): HybridSearchResult[];
/**
 * Take top k results
 */
declare function takeTopK(results: HybridSearchResult[], k: number): HybridSearchResult[];
/**
 * Validate hybrid config
 */
declare function validateHybridConfig(config: HybridSearchConfig): boolean;
/**
 * Detect if a query contains time references
 */
declare function detectTimeReference(query: string): boolean;
/**
 * Remove time references from query
 */
declare function removeTimeReferences(query: string): string;
/**
 * Remove generic words from query
 */
declare function removeGenericWords(query: string): string;
/**
 * Infer expected node types from query
 */
declare function inferExpectedTypes(query: string): string[];
/**
 * Analyze a raw query
 */
declare function analyzeQuery(rawQuery: string): QueryAnalysis;
/**
 * Determine if query should skip embedding
 */
declare function shouldSkipEmbedding(analysis: QueryAnalysis): boolean;
/**
 * Tokenize text for BM25 search
 */
declare function tokenizeForBM25(text: string): string[];
/**
 * Compute cosine similarity between two vectors
 */
declare function cosineSimilarity(a: Float32Array, b: Float32Array): number;
/**
 * Truncate vector for fast comparison
 */
declare function truncateForComparison(vector: Float32Array, dims: number): Float32Array;
/**
 * Check similarity between embeddings
 */
declare function checkSimilarity(sourceEmbedding: NodeEmbedding, targetEmbedding: NodeEmbedding, targetNodeId: string, config?: SimilarityEdgeConfig): SimilarityCheckResult;
/**
 * Check if edge is stale
 */
declare function isStaleEdge(currentSimilarity: number, config?: SimilarityEdgeConfig): boolean;
/**
 * Sort results by similarity descending
 */
declare function sortBySimilarity(results: SimilarityCheckResult[]): SimilarityCheckResult[];
/**
 * Get fallback level for a model
 */
declare function getFallbackLevel(modelId: EmbeddingModelId): FallbackLevel;
/**
 * Determine if an error is retryable
 */
declare function shouldRetry(error: Error, statusCode?: number): boolean;
/**
 * Get next provider in fallback chain
 */
declare function getNextProvider(currentModel: EmbeddingModelId, config?: FallbackConfig): EmbeddingModelId | null;
/**
 * Create initial fallback state
 */
declare function createInitialFallbackState(): FallbackState;
/**
 * Record provider success
 */
declare function recordSuccess(state: FallbackState, provider: EmbeddingModelId): FallbackState;
/**
 * Record provider failure
 */
declare function recordFailure(state: FallbackState, provider: EmbeddingModelId, error: string): FallbackState;
/**
 * Create degraded result (no embedding)
 */
declare function createDegradedResult(error: string, latencyMs: number): EmbedResult;
/**
 * Create success result
 */
declare function createSuccessResult(embedding: NodeEmbedding, modelUsed: EmbeddingModelId, latencyMs: number): EmbedResult;
/**
 * Estimate embedding cost
 */
declare function estimateCost(tokens: number, costPer1M?: number): {
    tokens: number;
    costUsd: number;
};
/**
 * Estimate monthly cost
 */
declare function estimateMonthlyCost(nodesPerDay: number, queriesPerDay: number, tokensPerNode?: number, tokensPerQuery?: number, costPer1M?: number): {
    tokens: number;
    costUsd: number;
};

export { BM25_FIELD_WEIGHTS, BM25_WEIGHT, COMPARISON_DIMS, CONTEXT_TEMPLATES, type ContextGeneratorInput, type ContextPrefix, ContextPrefixSchema, type ContextPrefixTemplate, DEDUP_CHECK_THRESHOLD, DEFAULT_FALLBACK_CONFIG, DEFAULT_HYBRID_CONFIG, DEFAULT_MATRYOSHKA_CONFIG, DEFAULT_SIMILARITY_CONFIG, DENSE_WEIGHT, EMBEDDING_DIMENSIONS, EMBEDDING_MODELS, type EmbedResult, type EmbeddingModelId, type EmbeddingProviderConfig, FALLBACK_1_MODEL, FALLBACK_2_MODEL, FALLBACK_MAX_RETRIES, FALLBACK_RETRY_DELAY_MS, type FallbackConfig, FallbackConfigSchema, type FallbackLevel, FallbackLevelSchema, type FallbackState, GENERIC_WORDS, type HybridSearchConfig, HybridSearchConfigSchema, type HybridSearchResult, HybridSearchResultSchema, INITIAL_PROVIDER_HEALTH, MATRYOSHKA_DIMS, MIN_CONTENT_LENGTH, MIN_TOTAL_LENGTH, type MatryoshkaDim, type MatryoshkaStageConfig, type NodeEmbedding, NodeEmbeddingSchema, PRIMARY_MODEL, type ProviderHealth, ProviderHealthSchema, type QueryAnalysis, QueryAnalysisSchema, type QueryEmbeddingResult, RECENT_NODE_WINDOW, SIMILARITY_EDGE_THRESHOLD, SSA_SEED_THRESHOLD, STAGE_1_CANDIDATES, STAGE_2_CANDIDATES, STAGE_3_CANDIDATES, STALE_EDGE_THRESHOLD, type SearchFilters, SearchFiltersSchema, type SimilarityCheckResult, SimilarityCheckResultSchema, type SimilarityEdgeConfig, TIME_REFERENCE_PATTERNS, analyzeQuery, checkSimilarity, combineForEmbedding, cosineSimilarity, createDegradedResult, createInitialFallbackState, createNodeEmbedding, createSearchResult, createSuccessResult, detectTimeReference, estimateCost, estimateMonthlyCost, expandMinimumContext, formatContextDate, fuseScores, generateContextPrefix, generateQueryPrefix, getDefaultHybridConfig, getFallbackLevel, getModelDimensions, getNextProvider, hashContext, inferExpectedTypes, isPrimaryModel, isProvisional, isStaleEdge, needsReEmbedding, normalizeScores, recordFailure, recordSuccess, removeGenericWords, removeTimeReferences, selectTemplate, shouldRetry, shouldSkipEmbedding, sortByFusedScore, sortBySimilarity, takeTopK, tokenizeForBM25, truncateForComparison, truncateToMatryoshka, updateEmbedding, validateHybridConfig };
