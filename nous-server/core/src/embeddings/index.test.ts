/**
 * @module @nous/core/embeddings
 * @description Tests for Contextual Embedding Ecosystem (CEE)
 * @spec Brainstorms/Specs/Phase-2-Data-Representation/storm-016
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Constants
  EMBEDDING_DIMENSIONS,
  MATRYOSHKA_DIMS,
  DENSE_WEIGHT,
  BM25_WEIGHT,
  SIMILARITY_EDGE_THRESHOLD,
  DEDUP_CHECK_THRESHOLD,
  SSA_SEED_THRESHOLD,
  STALE_EDGE_THRESHOLD,
  MIN_CONTENT_LENGTH,
  MIN_TOTAL_LENGTH,
  PRIMARY_MODEL,
  FALLBACK_1_MODEL,
  FALLBACK_2_MODEL,
  EMBEDDING_MODELS,
  CONTEXT_TEMPLATES,
  TIME_REFERENCE_PATTERNS,
  GENERIC_WORDS,
  DEFAULT_HYBRID_CONFIG,
  DEFAULT_SIMILARITY_CONFIG,
  DEFAULT_FALLBACK_CONFIG,

  // Hash function
  hashContext,

  // Node embedding functions
  createNodeEmbedding,
  isProvisional,
  needsReEmbedding,
  isPrimaryModel,
  updateEmbedding,
  truncateToMatryoshka,
  getModelDimensions,

  // Context prefix functions
  selectTemplate,
  formatContextDate,
  generateContextPrefix,
  expandMinimumContext,
  generateQueryPrefix,
  combineForEmbedding,

  // Hybrid search functions
  getDefaultHybridConfig,
  fuseScores,
  normalizeScores,
  createSearchResult,
  sortByFusedScore,
  takeTopK,
  validateHybridConfig,

  // Query processing functions
  detectTimeReference,
  removeTimeReferences,
  removeGenericWords,
  inferExpectedTypes,
  analyzeQuery,
  shouldSkipEmbedding,
  tokenizeForBM25,

  // Similarity functions
  cosineSimilarity,
  truncateForComparison,
  checkSimilarity,
  isStaleEdge,
  sortBySimilarity,

  // Fallback functions
  getFallbackLevel,
  shouldRetry,
  getNextProvider,
  createInitialFallbackState,
  recordSuccess,
  recordFailure,
  createDegradedResult,
  createSuccessResult,

  // Cost estimation
  estimateCost,
  estimateMonthlyCost,

  // Types
  type NodeEmbedding,
  type HybridSearchResult,
  type QueryAnalysis,
  type SimilarityCheckResult,
  type FallbackState,
} from './index';

// ============================================================
// CONSTANTS TESTS
// ============================================================

describe('Constants', () => {
  describe('Embedding dimensions', () => {
    it('should have correct full dimensions', () => {
      expect(EMBEDDING_DIMENSIONS).toBe(1536);
    });

    it('should have correct Matryoshka dimensions', () => {
      expect(MATRYOSHKA_DIMS).toEqual([128, 512, 1536]);
    });
  });

  describe('Hybrid search weights', () => {
    it('should have weights summing to 1.0', () => {
      expect(DENSE_WEIGHT + BM25_WEIGHT).toBe(1.0);
    });

    it('should have dense weight at 0.7', () => {
      expect(DENSE_WEIGHT).toBe(0.7);
    });

    it('should have BM25 weight at 0.3', () => {
      expect(BM25_WEIGHT).toBe(0.3);
    });
  });

  describe('Similarity thresholds', () => {
    it('should have conservative edge threshold at 0.90', () => {
      expect(SIMILARITY_EDGE_THRESHOLD).toBe(0.90);
    });

    it('should have dedup threshold at 0.95', () => {
      expect(DEDUP_CHECK_THRESHOLD).toBe(0.95);
    });

    it('should have SSA seed threshold at 0.60', () => {
      expect(SSA_SEED_THRESHOLD).toBe(0.60);
    });

    it('should have stale edge threshold at 0.80', () => {
      expect(STALE_EDGE_THRESHOLD).toBe(0.80);
    });

    it('should have thresholds in correct order', () => {
      expect(SSA_SEED_THRESHOLD).toBeLessThan(STALE_EDGE_THRESHOLD);
      expect(STALE_EDGE_THRESHOLD).toBeLessThan(SIMILARITY_EDGE_THRESHOLD);
      expect(SIMILARITY_EDGE_THRESHOLD).toBeLessThan(DEDUP_CHECK_THRESHOLD);
    });
  });

  describe('Embedding models', () => {
    it('should have primary model as OpenAI', () => {
      expect(PRIMARY_MODEL).toBe('openai-3-small');
    });

    it('should have all models in array', () => {
      expect(EMBEDDING_MODELS).toContain(PRIMARY_MODEL);
      expect(EMBEDDING_MODELS).toContain(FALLBACK_1_MODEL);
      expect(EMBEDDING_MODELS).toContain(FALLBACK_2_MODEL);
    });
  });

  describe('Context templates', () => {
    it('should have all required templates', () => {
      expect(CONTEXT_TEMPLATES.concept_extracted).toBeDefined();
      expect(CONTEXT_TEMPLATES.concept_manual).toBeDefined();
      expect(CONTEXT_TEMPLATES.episode).toBeDefined();
      expect(CONTEXT_TEMPLATES.document_chunk).toBeDefined();
      expect(CONTEXT_TEMPLATES.query).toBeDefined();
    });
  });
});

// ============================================================
// HASH FUNCTION TESTS
// ============================================================

describe('hashContext', () => {
  it('should produce consistent hashes', () => {
    const prefix = '[fact] From Signals Lecture. Engineering.';
    const hash1 = hashContext(prefix);
    const hash2 = hashContext(prefix);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = hashContext('prefix one');
    const hash2 = hashContext('prefix two');
    expect(hash1).not.toBe(hash2);
  });

  it('should produce 8-character hex strings', () => {
    const hash = hashContext('test');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should handle empty string', () => {
    const hash = hashContext('');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ============================================================
// NODE EMBEDDING TESTS
// ============================================================

describe('Node Embedding Functions', () => {
  const testVector = new Float32Array(1536).fill(0.1);
  const testPrefix = '[fact] From lecture. Science.';

  describe('createNodeEmbedding', () => {
    it('should create embedding with correct fields', () => {
      const embedding = createNodeEmbedding(testVector, PRIMARY_MODEL, testPrefix);

      expect(embedding.vector).toBe(testVector);
      expect(embedding.dimensions).toBe(1536);
      expect(embedding.model).toBe(PRIMARY_MODEL);
      expect(embedding.contextPrefix).toBe(testPrefix);
      expect(embedding.contextHash).toMatch(/^[0-9a-f]{8}$/);
      expect(embedding.provisional).toBe(false);
      expect(embedding.version).toBe(1);
    });

    it('should set provisional flag when specified', () => {
      const embedding = createNodeEmbedding(testVector, FALLBACK_1_MODEL, testPrefix, true);
      expect(embedding.provisional).toBe(true);
    });

    it('should set createdAt to current time', () => {
      const before = new Date().toISOString();
      const embedding = createNodeEmbedding(testVector, PRIMARY_MODEL, testPrefix);
      const after = new Date().toISOString();

      expect(embedding.createdAt >= before).toBe(true);
      expect(embedding.createdAt <= after).toBe(true);
    });
  });

  describe('isProvisional', () => {
    it('should return true for provisional embeddings', () => {
      const embedding = createNodeEmbedding(testVector, FALLBACK_1_MODEL, testPrefix, true);
      expect(isProvisional(embedding)).toBe(true);
    });

    it('should return false for primary embeddings', () => {
      const embedding = createNodeEmbedding(testVector, PRIMARY_MODEL, testPrefix);
      expect(isProvisional(embedding)).toBe(false);
    });
  });

  describe('needsReEmbedding', () => {
    it('should return true when context hash differs', () => {
      const embedding = createNodeEmbedding(testVector, PRIMARY_MODEL, testPrefix);
      const newHash = hashContext('[fact] Different context.');
      expect(needsReEmbedding(embedding, newHash)).toBe(true);
    });

    it('should return false when context hash matches', () => {
      const embedding = createNodeEmbedding(testVector, PRIMARY_MODEL, testPrefix);
      expect(needsReEmbedding(embedding, embedding.contextHash)).toBe(false);
    });
  });

  describe('isPrimaryModel', () => {
    it('should return true for primary model', () => {
      const embedding = createNodeEmbedding(testVector, PRIMARY_MODEL, testPrefix);
      expect(isPrimaryModel(embedding)).toBe(true);
    });

    it('should return false for fallback models', () => {
      const embedding = createNodeEmbedding(testVector, FALLBACK_1_MODEL, testPrefix);
      expect(isPrimaryModel(embedding)).toBe(false);
    });
  });

  describe('updateEmbedding', () => {
    it('should increment version', () => {
      const original = createNodeEmbedding(testVector, PRIMARY_MODEL, testPrefix);
      const newVector = new Float32Array(1536).fill(0.2);
      const updated = updateEmbedding(original, newVector, PRIMARY_MODEL, testPrefix);

      expect(updated.version).toBe(2);
    });

    it('should preserve new content', () => {
      const original = createNodeEmbedding(testVector, PRIMARY_MODEL, testPrefix);
      const newVector = new Float32Array(1536).fill(0.2);
      const newPrefix = '[fact] Updated context.';
      const updated = updateEmbedding(original, newVector, PRIMARY_MODEL, newPrefix);

      expect(updated.vector).toBe(newVector);
      expect(updated.contextPrefix).toBe(newPrefix);
    });
  });

  describe('truncateToMatryoshka', () => {
    it('should truncate to 128 dimensions', () => {
      const embedding = createNodeEmbedding(testVector, PRIMARY_MODEL, testPrefix);
      const truncated = truncateToMatryoshka(embedding, 128);
      expect(truncated.length).toBe(128);
    });

    it('should truncate to 512 dimensions', () => {
      const embedding = createNodeEmbedding(testVector, PRIMARY_MODEL, testPrefix);
      const truncated = truncateToMatryoshka(embedding, 512);
      expect(truncated.length).toBe(512);
    });

    it('should return full vector for 1536', () => {
      const embedding = createNodeEmbedding(testVector, PRIMARY_MODEL, testPrefix);
      const truncated = truncateToMatryoshka(embedding, 1536);
      expect(truncated.length).toBe(1536);
    });
  });

  describe('getModelDimensions', () => {
    it('should return 1536 for OpenAI', () => {
      expect(getModelDimensions('openai-3-small')).toBe(1536);
    });

    it('should return 512 for Voyage', () => {
      expect(getModelDimensions('voyage-3-lite')).toBe(512);
    });

    it('should return 384 for MiniLM', () => {
      expect(getModelDimensions('minilm-v6')).toBe(384);
    });

    it('should return default for unknown', () => {
      expect(getModelDimensions('unknown-model')).toBe(EMBEDDING_DIMENSIONS);
    });
  });
});

// ============================================================
// CONTEXT PREFIX TESTS
// ============================================================

describe('Context Prefix Functions', () => {
  describe('selectTemplate', () => {
    it('should select concept_extracted for extracted concepts', () => {
      expect(selectTemplate('concept', 'extraction')).toBe('concept_extracted');
    });

    it('should select concept_manual for manual concepts', () => {
      expect(selectTemplate('concept', 'manual')).toBe('concept_manual');
    });

    it('should select episode for episode nodes', () => {
      expect(selectTemplate('episode')).toBe('episode');
    });

    it('should select document_chunk for chunks', () => {
      expect(selectTemplate('chunk')).toBe('document_chunk');
    });

    it('should select note for notes', () => {
      expect(selectTemplate('note')).toBe('note');
    });
  });

  describe('formatContextDate', () => {
    it('should format date correctly', () => {
      const formatted = formatContextDate('2026-01-15T10:00:00Z');
      expect(formatted).toBe('Jan 15 2026');
    });

    it('should handle different months', () => {
      expect(formatContextDate('2026-06-20T10:00:00Z')).toBe('Jun 20 2026');
      expect(formatContextDate('2026-12-01T10:00:00Z')).toBe('Dec 1 2026');
    });
  });

  describe('generateContextPrefix', () => {
    it('should generate concept prefix from extraction', () => {
      const prefix = generateContextPrefix({
        nodeType: 'concept',
        nodeSubtype: 'fact',
        title: 'Fourier transforms',
        sourceEpisode: { title: 'Signals Lecture Week 3', subtype: 'lecture' },
        clusterInfo: { name: 'Engineering' },
        sourceType: 'extraction',
      });

      expect(prefix.template).toBe('concept_extracted');
      expect(prefix.generated).toContain('[fact]');
      expect(prefix.generated).toContain('Signals Lecture Week 3');
      expect(prefix.generated).toContain('Engineering');
      expect(prefix.hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should generate manual concept prefix', () => {
      const prefix = generateContextPrefix({
        nodeType: 'concept',
        nodeSubtype: 'belief',
        title: 'My opinion',
        clusterInfo: { name: 'Personal' },
        sourceType: 'manual',
      });

      expect(prefix.template).toBe('concept_manual');
      expect(prefix.generated).toContain('[belief]');
      expect(prefix.generated).toContain('Created by user');
    });

    it('should generate episode prefix', () => {
      const prefix = generateContextPrefix({
        nodeType: 'episode',
        nodeSubtype: 'lecture',
        title: 'Math 101',
        eventTimestamp: '2026-01-15T10:00:00Z',
        durationMinutes: 50,
        participants: ['Prof. Smith'],
      });

      expect(prefix.template).toBe('episode');
      expect(prefix.generated).toContain('[lecture]');
      expect(prefix.generated).toContain('Jan 15 2026');
      expect(prefix.generated).toContain('50min');
    });

    it('should generate chunk prefix', () => {
      const prefix = generateContextPrefix({
        nodeType: 'chunk',
        title: 'Section content',
        chunkInfo: {
          index: 3,
          total: 12,
          parentTitle: 'ML Textbook Chapter 5',
          sectionTitle: 'Gradient Descent',
        },
      });

      expect(prefix.template).toBe('document_chunk');
      expect(prefix.generated).toContain('[Chunk 3/12]');
      expect(prefix.generated).toContain('ML Textbook Chapter 5');
      expect(prefix.generated).toContain('Gradient Descent');
    });
  });

  describe('expandMinimumContext', () => {
    it('should expand very short content', () => {
      const expanded = expandMinimumContext(
        'Hi',
        '[note]',
        { name: 'Personal', description: 'Daily notes', keywords: ['reminder', 'todo'] }
      );

      expect(expanded).toContain('Topic:');
      expect(expanded).toContain('Keywords:');
    });

    it('should not expand long content', () => {
      const expanded = expandMinimumContext(
        'This is a longer piece of content that does not need expansion',
        '[note] Personal.',
        { name: 'Personal' }
      );

      expect(expanded).not.toContain('Topic:');
    });
  });

  describe('generateQueryPrefix', () => {
    it('should create query prefix', () => {
      const prefix = generateQueryPrefix('learn Python');
      expect(prefix.template).toBe('query');
      expect(prefix.generated).toBe('[Query] learn Python');
    });
  });

  describe('combineForEmbedding', () => {
    it('should combine prefix and content', () => {
      const combined = combineForEmbedding('[fact] Science.', 'The sun is hot.');
      expect(combined).toBe('[fact] Science. The sun is hot.');
    });
  });
});

// ============================================================
// HYBRID SEARCH TESTS
// ============================================================

describe('Hybrid Search Functions', () => {
  describe('getDefaultHybridConfig', () => {
    it('should return valid config', () => {
      const config = getDefaultHybridConfig();
      expect(config.denseWeight).toBe(0.7);
      expect(config.bm25Weight).toBe(0.3);
      expect(config.userTunable).toBe(true);
    });
  });

  describe('fuseScores', () => {
    it('should fuse scores with default weights', () => {
      const fused = fuseScores(0.8, 0.6);
      // 0.8 * 0.7 + 0.6 * 0.3 = 0.56 + 0.18 = 0.74
      expect(fused).toBeCloseTo(0.74);
    });

    it('should fuse scores with custom weights', () => {
      const config = { denseWeight: 0.5, bm25Weight: 0.5, userTunable: false };
      const fused = fuseScores(0.8, 0.6, config);
      expect(fused).toBeCloseTo(0.7);
    });

    it('should handle edge cases', () => {
      expect(fuseScores(1.0, 1.0)).toBeCloseTo(1.0);
      expect(fuseScores(0.0, 0.0)).toBeCloseTo(0.0);
    });
  });

  describe('normalizeScores', () => {
    it('should normalize scores to 0-1 range', () => {
      const results: HybridSearchResult[] = [
        { nodeId: 'n_1', denseScore: 0.5, bm25Score: 0.3, fusedScore: 0 },
        { nodeId: 'n_2', denseScore: 1.0, bm25Score: 0.9, fusedScore: 0 },
        { nodeId: 'n_3', denseScore: 0.0, bm25Score: 0.0, fusedScore: 0 },
      ];

      const normalized = normalizeScores(results);

      expect(normalized[0].denseScore).toBe(0.5);
      expect(normalized[1].denseScore).toBe(1.0);
      expect(normalized[2].denseScore).toBe(0.0);
    });

    it('should handle empty array', () => {
      expect(normalizeScores([])).toEqual([]);
    });
  });

  describe('createSearchResult', () => {
    it('should create result with fused score', () => {
      const result = createSearchResult('n_123', 0.8, 0.6);
      expect(result.nodeId).toBe('n_123');
      expect(result.denseScore).toBe(0.8);
      expect(result.bm25Score).toBe(0.6);
      expect(result.fusedScore).toBeCloseTo(0.74);
    });
  });

  describe('sortByFusedScore', () => {
    it('should sort by fused score descending', () => {
      const results: HybridSearchResult[] = [
        { nodeId: 'n_1', denseScore: 0.5, bm25Score: 0.5, fusedScore: 0.5 },
        { nodeId: 'n_2', denseScore: 0.9, bm25Score: 0.9, fusedScore: 0.9 },
        { nodeId: 'n_3', denseScore: 0.3, bm25Score: 0.3, fusedScore: 0.3 },
      ];

      const sorted = sortByFusedScore(results);

      expect(sorted[0].nodeId).toBe('n_2');
      expect(sorted[1].nodeId).toBe('n_1');
      expect(sorted[2].nodeId).toBe('n_3');
    });
  });

  describe('takeTopK', () => {
    it('should take top k results', () => {
      const results: HybridSearchResult[] = [
        { nodeId: 'n_1', denseScore: 0.5, bm25Score: 0.5, fusedScore: 0.5 },
        { nodeId: 'n_2', denseScore: 0.9, bm25Score: 0.9, fusedScore: 0.9 },
        { nodeId: 'n_3', denseScore: 0.3, bm25Score: 0.3, fusedScore: 0.3 },
      ];

      const top2 = takeTopK(results, 2);

      expect(top2.length).toBe(2);
      expect(top2[0].nodeId).toBe('n_2');
      expect(top2[1].nodeId).toBe('n_1');
    });
  });

  describe('validateHybridConfig', () => {
    it('should validate correct config', () => {
      expect(validateHybridConfig({ denseWeight: 0.7, bm25Weight: 0.3, userTunable: true })).toBe(true);
    });

    it('should reject incorrect weights', () => {
      expect(validateHybridConfig({ denseWeight: 0.5, bm25Weight: 0.3, userTunable: true })).toBe(false);
    });
  });
});

// ============================================================
// QUERY PROCESSING TESTS
// ============================================================

describe('Query Processing Functions', () => {
  describe('detectTimeReference', () => {
    it('should detect "yesterday"', () => {
      expect(detectTimeReference('What happened yesterday')).toBe(true);
    });

    it('should detect "last week"', () => {
      expect(detectTimeReference('Notes from last week')).toBe(true);
    });

    it('should detect "3 days ago"', () => {
      expect(detectTimeReference('Something from 3 days ago')).toBe(true);
    });

    it('should not detect non-temporal queries', () => {
      expect(detectTimeReference('What is machine learning')).toBe(false);
    });
  });

  describe('removeTimeReferences', () => {
    it('should remove "yesterday"', () => {
      const result = removeTimeReferences('What happened yesterday about Python');
      expect(result).not.toContain('yesterday');
      expect(result).toContain('Python');
    });

    it('should remove "last week"', () => {
      const result = removeTimeReferences('Notes from last week about math');
      expect(result).not.toContain('last week');
      expect(result).toContain('math');
    });
  });

  describe('removeGenericWords', () => {
    it('should remove generic words', () => {
      const result = removeGenericWords('what is the meaning of life');
      expect(result).not.toContain('what');
      expect(result).not.toContain('is');
      expect(result).not.toContain('the');
      expect(result).toContain('meaning');
      expect(result).toContain('life');
    });
  });

  describe('inferExpectedTypes', () => {
    it('should infer episode for "lecture"', () => {
      const types = inferExpectedTypes('What was in the lecture about Python');
      expect(types).toContain('episode');
    });

    it('should infer concept for "fact"', () => {
      const types = inferExpectedTypes('What is the fact about gravity');
      expect(types).toContain('concept');
    });

    it('should return defaults for generic queries', () => {
      const types = inferExpectedTypes('something random');
      expect(types).toContain('concept');
      expect(types).toContain('episode');
      expect(types).toContain('note');
    });
  });

  describe('analyzeQuery', () => {
    it('should analyze temporal query with semantic content', () => {
      const analysis = analyzeQuery('What did I learn last week about Python');
      expect(analysis.hasTimeReference).toBe(true);
      expect(analysis.hasSemanticContent).toBe(true);
      expect(analysis.semanticPart).toContain('learn');
      expect(analysis.semanticPart).toContain('python');
    });

    it('should analyze purely temporal query', () => {
      const analysis = analyzeQuery('What happened yesterday');
      expect(analysis.hasTimeReference).toBe(true);
      expect(analysis.hasSemanticContent).toBe(false);
    });

    it('should analyze semantic-only query', () => {
      const analysis = analyzeQuery('How do neural networks work');
      expect(analysis.hasTimeReference).toBe(false);
      expect(analysis.hasSemanticContent).toBe(true);
    });
  });

  describe('shouldSkipEmbedding', () => {
    it('should skip purely temporal queries', () => {
      const analysis = analyzeQuery('What happened yesterday');
      expect(shouldSkipEmbedding(analysis)).toBe(true);
    });

    it('should not skip semantic queries', () => {
      const analysis = analyzeQuery('What is machine learning');
      expect(shouldSkipEmbedding(analysis)).toBe(false);
    });
  });

  describe('tokenizeForBM25', () => {
    it('should tokenize text', () => {
      const tokens = tokenizeForBM25('Hello, World! How are you?');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
      expect(tokens).toContain('how');
      expect(tokens).toContain('are');
      expect(tokens).toContain('you');
    });

    it('should filter single-character tokens', () => {
      const tokens = tokenizeForBM25('a b c hello');
      expect(tokens).not.toContain('a');
      expect(tokens).not.toContain('b');
      expect(tokens).not.toContain('c');
      expect(tokens).toContain('hello');
    });
  });
});

// ============================================================
// SIMILARITY TESTS
// ============================================================

describe('Similarity Functions', () => {
  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const vec = new Float32Array([1, 0, 0]);
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0.0);
    });

    it('should return -1 for opposite vectors', () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([-1, 0, 0]);
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1.0);
    });

    it('should throw for mismatched lengths', () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([1, 0]);
      expect(() => cosineSimilarity(vec1, vec2)).toThrow('Vector length mismatch');
    });

    it('should handle zero vectors', () => {
      const vec1 = new Float32Array([0, 0, 0]);
      const vec2 = new Float32Array([1, 0, 0]);
      expect(cosineSimilarity(vec1, vec2)).toBe(0);
    });
  });

  describe('truncateForComparison', () => {
    it('should truncate to specified dimensions', () => {
      const vec = new Float32Array(1536).fill(0.1);
      const truncated = truncateForComparison(vec, 512);
      expect(truncated.length).toBe(512);
    });

    it('should return original if dims >= length', () => {
      const vec = new Float32Array(100).fill(0.1);
      const truncated = truncateForComparison(vec, 512);
      expect(truncated).toBe(vec);
    });
  });

  describe('checkSimilarity', () => {
    it('should detect similar vectors', () => {
      const vec1 = new Float32Array(512).fill(0.1);
      const vec2 = new Float32Array(512).fill(0.1);
      const emb1 = createNodeEmbedding(vec1, PRIMARY_MODEL, 'test1');
      const emb2 = createNodeEmbedding(vec2, PRIMARY_MODEL, 'test2');

      const result = checkSimilarity(emb1, emb2, 'n_target');

      expect(result.similarity).toBeCloseTo(1.0);
      expect(result.shouldCreateEdge).toBe(true);
      expect(result.shouldCheckDedup).toBe(true);
    });

    it('should not create edge for dissimilar vectors', () => {
      const vec1 = new Float32Array(512);
      const vec2 = new Float32Array(512);
      vec1[0] = 1;
      vec2[1] = 1;
      const emb1 = createNodeEmbedding(vec1, PRIMARY_MODEL, 'test1');
      const emb2 = createNodeEmbedding(vec2, PRIMARY_MODEL, 'test2');

      const result = checkSimilarity(emb1, emb2, 'n_target');

      expect(result.shouldCreateEdge).toBe(false);
    });
  });

  describe('isStaleEdge', () => {
    it('should detect stale edges', () => {
      expect(isStaleEdge(0.75)).toBe(true);
    });

    it('should not flag fresh edges', () => {
      expect(isStaleEdge(0.85)).toBe(false);
    });
  });

  describe('sortBySimilarity', () => {
    it('should sort by similarity descending', () => {
      const results: SimilarityCheckResult[] = [
        { shouldCreateEdge: true, shouldCheckDedup: false, similarity: 0.5, targetNodeId: 'n_1' },
        { shouldCreateEdge: true, shouldCheckDedup: true, similarity: 0.95, targetNodeId: 'n_2' },
        { shouldCreateEdge: false, shouldCheckDedup: false, similarity: 0.3, targetNodeId: 'n_3' },
      ];

      const sorted = sortBySimilarity(results);

      expect(sorted[0].targetNodeId).toBe('n_2');
      expect(sorted[1].targetNodeId).toBe('n_1');
      expect(sorted[2].targetNodeId).toBe('n_3');
    });
  });
});

// ============================================================
// FALLBACK TESTS
// ============================================================

describe('Fallback Functions', () => {
  describe('getFallbackLevel', () => {
    it('should return primary for OpenAI', () => {
      expect(getFallbackLevel('openai-3-small')).toBe('primary');
    });

    it('should return secondary for Voyage', () => {
      expect(getFallbackLevel('voyage-3-lite')).toBe('secondary');
    });

    it('should return local for MiniLM', () => {
      expect(getFallbackLevel('minilm-v6')).toBe('local');
    });

    it('should return degraded for unknown', () => {
      expect(getFallbackLevel('unknown')).toBe('degraded');
    });
  });

  describe('shouldRetry', () => {
    it('should retry on rate limit', () => {
      expect(shouldRetry(new Error('Rate limit'), 429)).toBe(true);
    });

    it('should retry on server error', () => {
      expect(shouldRetry(new Error('Server error'), 500)).toBe(true);
    });

    it('should not retry on auth error', () => {
      expect(shouldRetry(new Error('Unauthorized'), 401)).toBe(false);
    });

    it('should not retry on bad request', () => {
      expect(shouldRetry(new Error('Bad request'), 400)).toBe(false);
    });

    it('should retry on network errors', () => {
      expect(shouldRetry(new Error('ECONNREFUSED'))).toBe(true);
      expect(shouldRetry(new Error('ETIMEDOUT'))).toBe(true);
    });
  });

  describe('getNextProvider', () => {
    it('should return next provider in chain', () => {
      expect(getNextProvider('openai-3-small')).toBe('voyage-3-lite');
      expect(getNextProvider('voyage-3-lite')).toBe('minilm-v6');
    });

    it('should return null at end of chain', () => {
      expect(getNextProvider('minilm-v6')).toBe(null);
    });

    it('should return null for unknown provider', () => {
      expect(getNextProvider('unknown')).toBe(null);
    });
  });

  describe('createInitialFallbackState', () => {
    it('should create state with all providers healthy', () => {
      const state = createInitialFallbackState();

      expect(state.currentLevel).toBe('primary');
      expect(state.recoveryAttempts).toBe(0);
      expect(Object.keys(state.providerHealth).length).toBe(3);

      for (const model of EMBEDDING_MODELS) {
        expect(state.providerHealth[model].isAvailable).toBe(true);
        expect(state.providerHealth[model].consecutiveFailures).toBe(0);
      }
    });
  });

  describe('recordSuccess', () => {
    it('should update provider health on success', () => {
      const initial = createInitialFallbackState();
      const updated = recordSuccess(initial, PRIMARY_MODEL);

      expect(updated.providerHealth[PRIMARY_MODEL].isAvailable).toBe(true);
      expect(updated.providerHealth[PRIMARY_MODEL].consecutiveFailures).toBe(0);
      expect(updated.currentLevel).toBe('primary');
    });
  });

  describe('recordFailure', () => {
    it('should update provider health on failure', () => {
      const initial = createInitialFallbackState();
      const updated = recordFailure(initial, PRIMARY_MODEL, 'API error');

      expect(updated.providerHealth[PRIMARY_MODEL].isAvailable).toBe(false);
      expect(updated.providerHealth[PRIMARY_MODEL].consecutiveFailures).toBe(1);
      expect(updated.providerHealth[PRIMARY_MODEL].lastError).toBe('API error');
      expect(updated.currentLevel).toBe('secondary');
    });
  });

  describe('createDegradedResult', () => {
    it('should create degraded result', () => {
      const result = createDegradedResult('All providers failed', 5000);

      expect(result.embedding).toBe(null);
      expect(result.fallbackLevel).toBe('degraded');
      expect(result.error).toBe('All providers failed');
      expect(result.latencyMs).toBe(5000);
      expect(result.isProvisional).toBe(false);
    });
  });

  describe('createSuccessResult', () => {
    it('should create success result for primary', () => {
      const vec = new Float32Array(1536).fill(0.1);
      const embedding = createNodeEmbedding(vec, PRIMARY_MODEL, 'test');
      const result = createSuccessResult(embedding, PRIMARY_MODEL, 100);

      expect(result.embedding).toBe(embedding);
      expect(result.fallbackLevel).toBe('primary');
      expect(result.isProvisional).toBe(false);
    });

    it('should mark fallback as provisional', () => {
      const vec = new Float32Array(512).fill(0.1);
      const embedding = createNodeEmbedding(vec, FALLBACK_1_MODEL, 'test', true);
      const result = createSuccessResult(embedding, FALLBACK_1_MODEL, 100);

      expect(result.fallbackLevel).toBe('secondary');
      expect(result.isProvisional).toBe(true);
    });
  });
});

// ============================================================
// COST ESTIMATION TESTS
// ============================================================

describe('Cost Estimation', () => {
  describe('estimateCost', () => {
    it('should estimate cost correctly', () => {
      const estimate = estimateCost(1_000_000);
      expect(estimate.tokens).toBe(1_000_000);
      expect(estimate.costUsd).toBe(0.02);
    });

    it('should handle small token counts', () => {
      const estimate = estimateCost(1000);
      expect(estimate.costUsd).toBeCloseTo(0.00002);
    });
  });

  describe('estimateMonthlyCost', () => {
    it('should estimate monthly cost for active user', () => {
      const estimate = estimateMonthlyCost(50, 50); // 50 nodes/day, 50 queries/day
      // Daily: 50*150 + 50*30 = 7500 + 1500 = 9000 tokens
      // Monthly: 9000 * 30 = 270000 tokens
      // Cost: 270000 / 1M * 0.02 = 0.0054
      expect(estimate.tokens).toBe(270000);
      expect(estimate.costUsd).toBeCloseTo(0.0054);
    });

    it('should estimate monthly cost for power user', () => {
      const estimate = estimateMonthlyCost(200, 200);
      // Daily: 200*150 + 200*30 = 30000 + 6000 = 36000 tokens
      // Monthly: 36000 * 30 = 1080000 tokens
      // Cost: 1080000 / 1M * 0.02 = 0.0216
      expect(estimate.costUsd).toBeCloseTo(0.0216);
    });
  });
});
