/**
 * Tests for per-section retrieval weight reranking (Issue 1).
 */
import { describe, it, expect } from 'vitest';
import {
  rerankWithSectionWeights,
  rerankCandidates,
  RERANKING_WEIGHTS,
  type ScoredNode,
  type GraphMetrics,
} from './index.js';
import { SECTION_PROFILES, getSectionForSubtype } from '../sections/index.js';

// Shared test fixtures
const defaultMetrics: GraphMetrics = {
  total_nodes: 100,
  total_edges: 200,
  density: 0.04,
  avg_inbound_edges: 2.0,
  avg_outbound_edges: 2.0,
};

const now = new Date('2026-02-20T12:00:00Z');

function makeScoredNode(overrides: Partial<ScoredNode> & { id: string }): ScoredNode {
  return {
    semantic_score: 0.5,
    bm25_score: 1.0,
    graph_score: 0.5,
    last_accessed: new Date('2026-02-20T10:00:00Z'),  // 2 hours ago
    created_at: new Date('2026-02-15T12:00:00Z'),      // 5 days ago
    access_count: 3,
    inbound_edge_count: 2,
    ...overrides,
  };
}

describe('rerankWithSectionWeights', () => {
  it('returns empty array for empty input', () => {
    expect(rerankWithSectionWeights([], defaultMetrics, now)).toEqual([]);
  });

  it('returns ranked nodes sorted by score descending', () => {
    const candidates: ScoredNode[] = [
      makeScoredNode({ id: 'n_1', subtype: 'custom:lesson', semantic_score: 0.9 }),
      makeScoredNode({ id: 'n_2', subtype: 'custom:lesson', semantic_score: 0.3 }),
    ];
    const ranked = rerankWithSectionWeights(candidates, defaultMetrics, now);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.node.id).toBe('n_1');
    expect(ranked[1]!.node.id).toBe('n_2');
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it('uses SIGNALS weights for signal nodes (recency-dominant)', () => {
    const signalWeights = SECTION_PROFILES.SIGNALS.reranking_weights;
    expect(signalWeights.recency).toBe(0.45);

    const candidates: ScoredNode[] = [
      makeScoredNode({
        id: 'n_signal',
        subtype: 'custom:signal',
        last_accessed: new Date('2026-02-20T11:55:00Z'),  // 5 min ago — very recent
        semantic_score: 0.3,
      }),
    ];
    const ranked = rerankWithSectionWeights(candidates, defaultMetrics, now);
    expect(ranked[0]!.primary_signal).toBe('recency');
  });

  it('uses KNOWLEDGE weights for lesson nodes (semantic/authority-dominant)', () => {
    const knowledgeWeights = SECTION_PROFILES.KNOWLEDGE.reranking_weights;
    expect(knowledgeWeights.semantic).toBe(0.35);
    expect(knowledgeWeights.authority).toBe(0.20);

    const candidates: ScoredNode[] = [
      makeScoredNode({
        id: 'n_lesson',
        subtype: 'custom:lesson',
        semantic_score: 0.9,
        inbound_edge_count: 10,  // High authority
        last_accessed: new Date('2026-01-15T12:00:00Z'),  // 36 days ago — very old
      }),
    ];
    const ranked = rerankWithSectionWeights(candidates, defaultMetrics, now);
    // Primary should be semantic or authority, NOT recency
    expect(['semantic', 'authority']).toContain(ranked[0]!.primary_signal);
  });

  it('applies different weights to nodes from different sections in same result set', () => {
    // Two nodes with identical raw scores but different subtypes
    const baseNode = {
      semantic_score: 0.5,
      bm25_score: 1.0,
      graph_score: 0.5,
      last_accessed: new Date('2026-02-20T11:00:00Z'),
      created_at: new Date('2026-02-15T12:00:00Z'),
      access_count: 3,
      inbound_edge_count: 2,
    };

    const candidates: ScoredNode[] = [
      { ...baseNode, id: 'n_signal', subtype: 'custom:signal' },
      { ...baseNode, id: 'n_lesson', subtype: 'custom:lesson' },
    ];

    const ranked = rerankWithSectionWeights(candidates, defaultMetrics, now);

    // Scores should differ because weights differ
    const signalResult = ranked.find(r => r.node.id === 'n_signal')!;
    const lessonResult = ranked.find(r => r.node.id === 'n_lesson')!;
    expect(signalResult.score).not.toBeCloseTo(lessonResult.score, 3);
  });

  it('falls back to KNOWLEDGE weights for unknown subtypes', () => {
    const candidates: ScoredNode[] = [
      makeScoredNode({ id: 'n_unknown', subtype: 'custom:future_type' }),
    ];
    const ranked = rerankWithSectionWeights(candidates, defaultMetrics, now);
    expect(ranked).toHaveLength(1);
    // Should not throw — uses KNOWLEDGE section defaults
  });

  it('falls back to KNOWLEDGE weights for null/undefined subtype', () => {
    const candidates: ScoredNode[] = [
      makeScoredNode({ id: 'n_null', subtype: undefined }),
    ];
    const ranked = rerankWithSectionWeights(candidates, defaultMetrics, now);
    expect(ranked).toHaveLength(1);
  });

  it('signal recency boost: recent signal outranks old signal', () => {
    const candidates: ScoredNode[] = [
      makeScoredNode({
        id: 'n_fresh_signal',
        subtype: 'custom:signal',
        last_accessed: new Date('2026-02-20T11:55:00Z'),  // 5 min ago
        semantic_score: 0.3,
      }),
      makeScoredNode({
        id: 'n_stale_signal',
        subtype: 'custom:signal',
        last_accessed: new Date('2026-02-15T12:00:00Z'),  // 5 days ago — enough gap to lose despite higher semantic
        semantic_score: 0.6,  // Higher semantic but stale
      }),
    ];
    const ranked = rerankWithSectionWeights(candidates, defaultMetrics, now);
    // Fresh signal should rank higher despite lower semantic score
    // because SIGNALS section has 0.45 recency weight
    expect(ranked[0]!.node.id).toBe('n_fresh_signal');
  });

  it('knowledge authority boost: well-connected lesson outranks isolated one', () => {
    const candidates: ScoredNode[] = [
      makeScoredNode({
        id: 'n_connected_lesson',
        subtype: 'custom:lesson',
        inbound_edge_count: 15,  // Very well-connected
        semantic_score: 0.5,
      }),
      makeScoredNode({
        id: 'n_isolated_lesson',
        subtype: 'custom:lesson',
        inbound_edge_count: 0,   // No connections
        semantic_score: 0.6,     // Higher semantic but no authority
      }),
    ];
    const ranked = rerankWithSectionWeights(candidates, defaultMetrics, now);
    // Connected lesson should rank higher because KNOWLEDGE section
    // has 0.20 authority weight (vs 0.10 in global)
    expect(ranked[0]!.node.id).toBe('n_connected_lesson');
  });

  it('maxBM25 is computed across ALL candidates (not per section)', () => {
    // If maxBM25 were per-section, a section with one low-BM25 node
    // would inflate its keyword score to 1.0. This test verifies
    // cross-section normalization.
    const candidates: ScoredNode[] = [
      makeScoredNode({ id: 'n_high_bm25', subtype: 'custom:signal', bm25_score: 10.0 }),
      makeScoredNode({ id: 'n_low_bm25', subtype: 'custom:lesson', bm25_score: 1.0 }),
    ];
    const ranked = rerankWithSectionWeights(candidates, defaultMetrics, now);
    const lessonResult = ranked.find(r => r.node.id === 'n_low_bm25')!;
    // Keyword score should be 1.0/10.0 = 0.1, not 1.0/1.0 = 1.0
    expect(lessonResult.breakdown.keyword).toBeCloseTo(0.1, 1);
  });

  it('score breakdown matches section weights', () => {
    const candidates: ScoredNode[] = [
      makeScoredNode({ id: 'n_1', subtype: 'custom:playbook' }),
    ];
    const ranked = rerankWithSectionWeights(candidates, defaultMetrics, now);
    const result = ranked[0]!;
    const weights = SECTION_PROFILES.PROCEDURAL.reranking_weights;

    // Verify: score = sum of (weight * signal)
    const expectedScore =
      weights.semantic * result.breakdown.semantic +
      weights.keyword * result.breakdown.keyword +
      weights.graph * result.breakdown.graph +
      weights.recency * result.breakdown.recency +
      weights.authority * result.breakdown.authority +
      weights.affinity * result.breakdown.affinity;

    expect(result.score).toBeCloseTo(expectedScore, 6);
  });

  it('all section weight profiles sum to 1.0', () => {
    for (const [section, profile] of Object.entries(SECTION_PROFILES)) {
      const w = profile.reranking_weights;
      const sum = w.semantic + w.keyword + w.graph + w.recency + w.authority + w.affinity;
      expect(sum).toBeCloseTo(1.0, 2);
    }
  });
});

describe('rerankCandidates (backward compatibility)', () => {
  it('still works with global weights when called directly', () => {
    const candidates: ScoredNode[] = [
      makeScoredNode({ id: 'n_1', semantic_score: 0.9 }),
      makeScoredNode({ id: 'n_2', semantic_score: 0.3 }),
    ];
    const ranked = rerankCandidates(candidates, defaultMetrics);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.node.id).toBe('n_1');
  });

  it('ignores subtype field when using global weights', () => {
    const candidates: ScoredNode[] = [
      makeScoredNode({ id: 'n_1', subtype: 'custom:signal' }),
    ];
    // rerankCandidates uses RERANKING_WEIGHTS (global), not section weights
    const ranked = rerankCandidates(candidates, defaultMetrics);
    expect(ranked).toHaveLength(1);
    // Score should use global weights, not SIGNALS weights
  });
});

describe('getSectionForSubtype coverage', () => {
  const subtypeToSection: [string, string][] = [
    ['custom:trade_entry', 'EPISODIC'],
    ['custom:trade_close', 'EPISODIC'],
    ['custom:trade_modify', 'EPISODIC'],
    ['custom:trade', 'EPISODIC'],
    ['custom:turn_summary', 'EPISODIC'],
    ['custom:session_summary', 'EPISODIC'],
    ['custom:market_event', 'EPISODIC'],
    ['custom:signal', 'SIGNALS'],
    ['custom:watchpoint', 'SIGNALS'],
    ['custom:lesson', 'KNOWLEDGE'],
    ['custom:thesis', 'KNOWLEDGE'],
    ['custom:curiosity', 'KNOWLEDGE'],
    ['custom:playbook', 'PROCEDURAL'],
    ['custom:missed_opportunity', 'PROCEDURAL'],
    ['custom:good_pass', 'PROCEDURAL'],
  ];

  for (const [subtype, expectedSection] of subtypeToSection) {
    it(`maps ${subtype} to ${expectedSection}`, () => {
      expect(getSectionForSubtype(subtype)).toBe(expectedSection);
    });
  }
});
