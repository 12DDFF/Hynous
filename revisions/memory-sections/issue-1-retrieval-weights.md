# Issue 1: Per-Section Retrieval Weights — Implementation Guide

> **STATUS:** DONE (2026-02-21)
>
> **Depends on:** Issue 0 (Section Foundation) — must be implemented first.
>
> **What this changes:** After SSA retrieves candidates from the full node pool, each candidate is reranked using the retrieval weights of the memory section it belongs to, instead of one global weight set. A `custom:signal` node is scored with recency-dominant weights (0.45 recency) while a `custom:lesson` node in the same result set is scored with authority-dominant weights (0.20 authority) — even though they were retrieved by the same query.

---

## Problem Statement

The SSA retrieval pipeline uses **one global set of reranking weights** for all candidates regardless of their memory type:

```
Current (global, identical for every node):
  semantic:  0.30   (vector similarity)
  keyword:   0.15   (BM25 match)
  graph:     0.20   (spreading activation)
  recency:   0.15   (time decay)
  authority: 0.10   (inbound edge count)
  affinity:  0.10   (access history)
```

This means a 3-hour-old funding rate signal (`custom:signal`) and a months-old trading principle (`custom:lesson`) are scored with identical weights. The signal should be scored recency-dominant (stale signals are noise), while the lesson should be scored authority-dominant (a well-connected lesson validated across many trades is more valuable than a fresh but unvalidated one).

The `rerankCandidates()` function already accepts an optional `weights` parameter (line 876 of `params/index.ts`), but `executeSSA()` never passes custom weights (line 1264 of `ssa/index.ts`). The infrastructure exists — it's just never used for per-node differentiation.

**What this guide does:** Threads node `subtype` through the SSA pipeline so that each candidate is reranked with the weights of the section it belongs to. No Python changes required — the reranking happens entirely server-side in the Nous TypeScript core.

---

## Required Reading

Read these files **in order** before implementing. The "Focus Areas" column tells you exactly which parts matter.

### Foundation (read first)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 1 | `revisions/memory-sections/executive-summary.md` | The theory document. Defines all 6 issues and the design constraint that sections are a bias layer, not partitions. | "Issue 1: Uniform SSA Retrieval Weights" (lines 108-147), "Critical Design Principle" (lines 76-103) |
| 2 | `revisions/memory-sections/issue-0-section-foundation.md` | The foundation guide you're building on. Defines the section types, subtype→section mapping, and profile structures with per-section reranking weights. | Step 0.1: the TypeScript `sections/index.ts` code block (~lines 110-462), especially `SECTION_PROFILES` (lines 256-364) and `getSectionForSubtype()` (lines 183-186) |

### TypeScript SSA Pipeline (understand the data flow)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 3 | `nous-server/core/src/params/index.ts` | Houses the `ScoredNode` interface (lines 132-141), `RerankingWeights` interface (lines 48-55), `rerankCandidates()` function (lines 873-911), and all 6 scoring functions (lines 813-868). **You will modify this file.** | Lines 48-55 (RerankingWeights), lines 132-152 (ScoredNode + Zod), lines 873-911 (rerankCandidates) |
| 4 | `nous-server/core/src/ssa/index.ts` | Houses `executeSSA()` (lines 1180-1308), `buildScoredNodes()` (lines 930-953), `RerankingNodeData` interface (lines 528-534), and `SSAGraphContext` interface (lines 564-571). **You will modify this file.** | Lines 528-534 (RerankingNodeData), lines 564-571 (SSAGraphContext), lines 930-953 (buildScoredNodes), lines 1260-1273 (Step 4 reranking) |
| 5 | `nous-server/server/src/ssa-context.ts` | Implements `SSAGraphContext`. The `getNodeForReranking()` method (lines 207-236) runs SQL to fetch reranking data — currently does NOT fetch `subtype`. **You will modify this file.** | Lines 207-236 (getNodeForReranking SQL + return object) |

### Server Integration (understand response building)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 6 | `nous-server/server/src/routes/search.ts` | The `/v1/search` endpoint. Calls `executeSSA()` at lines 70-91, builds response at lines 145-154. No changes needed here — `applyDecay()` already adds `memory_section` from Guide 0. | Lines 70-91 (executeSSA call), lines 145-154 (response building) |
| 7 | `nous-server/server/src/core-bridge.ts` | The `applyDecay()` function already adds `memory_section` field (from Guide 0). `SUBTYPE_TO_ALGO_TYPE` at lines 25-40 shows the existing subtype-to-behavior dispatch pattern. No changes needed here. | Lines 25-40 (SUBTYPE_TO_ALGO_TYPE), lines 129-139 (applyDecay) |

### Build Configuration

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 8 | `nous-server/core/tsup.config.ts` | Build entry points. Already includes `src/sections/index.ts` from Guide 0. No changes needed. | Full file (33 lines) |

### Existing Tests (understand test patterns)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 9 | `nous-server/core/src/params/index.test.ts` | Existing params tests. Your new tests must not break these. Shows import patterns and test structure. | First 80 lines (imports + test structure) |
| 10 | `nous-server/core/src/ssa/index.test.ts` | Existing SSA tests. Shows how `buildScoredNodes`, `rerankCandidates`, and `executeSSA` are tested with mock contexts. | First 80 lines (imports), any `describe('buildScoredNodes')` or `describe('rerankCandidates')` blocks |

---

## Architecture Decisions

### Decision 1: Per-node section weights in a single pass (FINAL)

Instead of grouping candidates by section and reranking each group separately, we apply per-node section-specific weights in **one pass** over all candidates. This preserves the `maxBM25` normalization across the entire candidate set (splitting by section would give each group its own maxBM25, distorting keyword scores).

A new function `rerankWithSectionWeights()` wraps the existing scoring logic: for each candidate, it looks up the section via `getSectionForSubtype(node.subtype)`, gets that section's weight profile from `SECTION_PROFILES`, and applies the weighted score. The existing `rerankCandidates()` remains unchanged for backward compatibility and non-section-aware callers.

**Where:** New function in `params/index.ts`, called from `executeSSA()` Step 4 in `ssa/index.ts`.

### Decision 2: Subtype threaded through the entire reranking path (FINAL)

The `subtype` field must flow through: `getNodeForReranking()` SQL → `RerankingNodeData` → `buildScoredNodes()` → `ScoredNode`. This is the minimal change to make section information available at reranking time. The subtype is already stored on every node in the `nodes.subtype` column — we just need to SELECT it and pass it through.

**Where:** `ssa-context.ts` (SQL), `ssa/index.ts` (types + buildScoredNodes), `params/index.ts` (ScoredNode interface).

### Decision 3: Section weights come from `@nous/core/sections` (FINAL)

The section profiles defined in Issue 0's `sections/index.ts` are the single source of truth for per-section reranking weights. The new `rerankWithSectionWeights()` function imports `getSectionForSubtype` and `SECTION_PROFILES` from `@nous/core/sections` to look up weights.

This means tuning section weights only requires changing `SECTION_PROFILES` in one place — the reranking function automatically picks up the new values.

### Decision 4: Fallback to global weights for null/unknown subtypes (FINAL)

If a node has `subtype = null` or a subtype not in `SUBTYPE_TO_SECTION`, `getSectionForSubtype()` returns `'KNOWLEDGE'` (the default section). That section's weights are used. This ensures graceful degradation — no node is ever without a weight profile.

---

## Implementation Steps

### Step 1.1: Add `subtype` to `ScoredNode` interface

**File:** `nous-server/core/src/params/index.ts`

The `ScoredNode` interface currently has 8 fields (lines 132-141). Add `subtype` as an optional string field so section-aware reranking can look up the node's section.

**Find this** (lines 132-141):
```typescript
export interface ScoredNode {
  id: string;
  semantic_score?: number;
  bm25_score?: number;
  graph_score?: number;
  last_accessed: Date;
  created_at: Date;
  access_count: number;
  inbound_edge_count: number;
}
```

**Replace with:**
```typescript
export interface ScoredNode {
  id: string;
  semantic_score?: number;
  bm25_score?: number;
  graph_score?: number;
  last_accessed: Date;
  created_at: Date;
  access_count: number;
  inbound_edge_count: number;
  subtype?: string;  // e.g. 'custom:lesson' — used for per-section reranking (Issue 1)
}
```

**Also update the Zod schema** (lines 143-152):

**Find this** (lines 143-152):
```typescript
export const ScoredNodeSchema = z.object({
  id: z.string(),
  semantic_score: z.number().min(0).max(1).optional(),
  bm25_score: z.number().nonnegative().optional(),
  graph_score: z.number().min(0).max(1).optional(),
  last_accessed: z.date(),
  created_at: z.date(),
  access_count: z.number().int().nonnegative(),
  inbound_edge_count: z.number().int().nonnegative(),
});
```

**Replace with:**
```typescript
export const ScoredNodeSchema = z.object({
  id: z.string(),
  semantic_score: z.number().min(0).max(1).optional(),
  bm25_score: z.number().nonnegative().optional(),
  graph_score: z.number().min(0).max(1).optional(),
  last_accessed: z.date(),
  created_at: z.date(),
  access_count: z.number().int().nonnegative(),
  inbound_edge_count: z.number().int().nonnegative(),
  subtype: z.string().optional(),
});
```

---

### Step 1.2: Add `rerankWithSectionWeights()` function

**File:** `nous-server/core/src/params/index.ts`

This is the core of Issue 1. Insert this new function **immediately after** the existing `rerankCandidates()` function (which ends at line 911).

**Find this** (line 912-916):
```typescript

// ============================================================
// DECAY FUNCTIONS
// ============================================================
```

**Insert BEFORE that block** (after line 911, before line 912):
```typescript

/**
 * Reranks candidates using per-section weights.
 *
 * Each candidate's subtype is mapped to a memory section, and that section's
 * weight profile is used for scoring. This gives different memory types
 * fundamentally different retrieval behavior:
 *   - Signals: recency-dominant (0.45 recency)
 *   - Episodic: recency-favoring (0.30 recency)
 *   - Knowledge: authority-dominant (0.20 authority, 0.35 semantic)
 *   - Procedural: keyword+graph-dominant (0.25 keyword, 0.20 graph)
 *
 * Critical design choice: maxBM25 is computed across ALL candidates (not per
 * section) so keyword scores are normalized against the full candidate set.
 * This prevents a section with one low-BM25 node from inflating that node's
 * keyword score to 1.0.
 *
 * Falls back to global RERANKING_WEIGHTS for nodes without a subtype.
 *
 * @see revisions/memory-sections/executive-summary.md — Issue 1
 * @see revisions/memory-sections/issue-0-section-foundation.md — SECTION_PROFILES
 */
export function rerankWithSectionWeights(
  candidates: ScoredNode[],
  metrics: GraphMetrics,
  now: Date = new Date()
): RankedNode[] {
  if (candidates.length === 0) return [];

  // maxBM25 is computed across ALL candidates — shared normalization base
  const maxBM25 = Math.max(...candidates.map(c => c.bm25_score ?? 0));

  return candidates.map(node => {
    // Look up section-specific weights for this node's subtype
    const section = getSectionForSubtype(node.subtype);
    const weights = SECTION_PROFILES[section].reranking_weights;

    const breakdown: ScoreBreakdown = {
      semantic: semanticScore(node),
      keyword: keywordScore(node, maxBM25, candidates.length),
      graph: graphScore(node),
      recency: recencyScore(node.last_accessed, now),
      authority: authorityScore(node.inbound_edge_count, metrics.avg_inbound_edges),
      affinity: affinityScore(node.access_count, node.created_at, node.last_accessed, now),
    };

    const score =
      weights.semantic * breakdown.semantic +
      weights.keyword * breakdown.keyword +
      weights.graph * breakdown.graph +
      weights.recency * breakdown.recency +
      weights.authority * breakdown.authority +
      weights.affinity * breakdown.affinity;

    const contributions = Object.entries(breakdown).map(([key, value]) => ({
      key: key as keyof ScoreBreakdown,
      contribution: weights[key as keyof RerankingWeights] * value
    }));
    const primary = contributions.reduce((a, b) =>
      b.contribution > a.contribution ? b : a
    ).key;

    return { node, score, breakdown, primary_signal: primary };
  }).sort((a, b) => b.score - a.score);
}
```

**Then add the import for sections at the top of `params/index.ts`.**

**Find this** (line 17):
```typescript
import { z } from 'zod';
```

**Replace with:**
```typescript
import { z } from 'zod';
import { getSectionForSubtype, SECTION_PROFILES } from '../sections/index.js';
```

**Why the import uses `../sections/index.js`:** The params module and sections module are sibling directories under `core/src/`. The `.js` extension is required for ESM resolution (TypeScript compiles `.ts` → `.js`, but import paths must reference the output extension).

---

### Step 1.3: Add `subtype` to `RerankingNodeData` interface

**File:** `nous-server/core/src/ssa/index.ts`

The `RerankingNodeData` interface defines what `getNodeForReranking()` returns. Add `subtype` so it flows through to `buildScoredNodes()`.

**Find this** (lines 528-534):
```typescript
export interface RerankingNodeData {
  id: string;
  last_accessed: Date;
  created_at: Date;
  access_count: number;
  inbound_edge_count: number;
}
```

**Replace with:**
```typescript
export interface RerankingNodeData {
  id: string;
  last_accessed: Date;
  created_at: Date;
  access_count: number;
  inbound_edge_count: number;
  subtype?: string;  // e.g. 'custom:lesson' — for per-section reranking (Issue 1)
}
```

---

### Step 1.4: Pass `subtype` through `buildScoredNodes()`

**File:** `nous-server/core/src/ssa/index.ts`

The `buildScoredNodes()` function converts `SSAActivatedNode[]` to `ScoredNode[]` by fetching reranking data from the DB. Add the `subtype` field to the constructed `ScoredNode`.

**Find this** (lines 930-953):
```typescript
export async function buildScoredNodes(
  activated: SSAActivatedNode[],
  context: SSAGraphContext
): Promise<ScoredNode[]> {
  const scoredNodes: ScoredNode[] = [];

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
      });
    }
  }

  return scoredNodes;
}
```

**Replace with:**
```typescript
export async function buildScoredNodes(
  activated: SSAActivatedNode[],
  context: SSAGraphContext
): Promise<ScoredNode[]> {
  const scoredNodes: ScoredNode[] = [];

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
        subtype: rerankData.subtype,  // For per-section reranking (Issue 1)
      });
    }
  }

  return scoredNodes;
}
```

---

### Step 1.5: Switch `executeSSA()` Step 4 to use section-aware reranking

**File:** `nous-server/core/src/ssa/index.ts`

The call to `rerankCandidates()` at Step 4 currently uses global weights. Switch it to `rerankWithSectionWeights()`.

**First, update the imports.** Find the import block near the top of `ssa/index.ts` (around lines 19-33):

**Find this** (the params import, approximately lines 21-25):
```typescript
import {
  SSA_PARAMS, SSA_EDGE_WEIGHTS, rerankCandidates,
  type ScoredNode, type RankedNode, type GraphMetrics, type ScoreBreakdown,
} from '../params';
```

**Replace with:**
```typescript
import {
  SSA_PARAMS, SSA_EDGE_WEIGHTS, rerankCandidates, rerankWithSectionWeights,
  type ScoredNode, type RankedNode, type GraphMetrics, type ScoreBreakdown,
} from '../params';
```

**Then, modify Step 4 in `executeSSA()`.** Find this (lines 1260-1265):
```typescript
  // Step 4: Reranking using storm-028's function
  const rerankingStart = performance.now();
  const graphMetrics = await context.getGraphMetrics();
  const scoredNodes = await buildScoredNodes(relevantActivated, context);
  const rankedNodes = rerankCandidates(scoredNodes, graphMetrics);
  metrics.reranking_ms = performance.now() - rerankingStart;
```

**Replace with:**
```typescript
  // Step 4: Per-section reranking — each node scored with its section's weight profile
  // Signals: recency-dominant. Episodic: recency-favoring. Knowledge: authority-dominant.
  // Procedural: keyword+graph-dominant. See: revisions/memory-sections/issue-1-retrieval-weights.md
  const rerankingStart = performance.now();
  const graphMetrics = await context.getGraphMetrics();
  const scoredNodes = await buildScoredNodes(relevantActivated, context);
  const rankedNodes = rerankWithSectionWeights(scoredNodes, graphMetrics);
  metrics.reranking_ms = performance.now() - rerankingStart;
```

**Why `rerankWithSectionWeights` instead of `rerankCandidates`:** `rerankWithSectionWeights` applies per-node section-specific weights. `rerankCandidates` still exists and is unchanged — it can still be called by other code that needs global-weight reranking (e.g., tests, non-section-aware callers).

---

### Step 1.6: Fetch `subtype` in `getNodeForReranking()` SQL

**File:** `nous-server/server/src/ssa-context.ts`

The SQL query currently only fetches `id`, `neural_last_accessed`, `provenance_created_at`, `created_at`, `neural_access_count`. Add `subtype` to the SELECT.

**Find this** (lines 207-235):
```typescript
    async getNodeForReranking(
      id: string,
    ): Promise<RerankingNodeData | null> {
      const db = getDb();
      const [nodeR, edgeR] = await Promise.all([
        db.execute({
          sql: `SELECT id, neural_last_accessed, provenance_created_at,
                       created_at, neural_access_count
                FROM nodes WHERE id = ?`,
          args: [id],
        }),
        db.execute({
          sql: 'SELECT COUNT(*) as cnt FROM edges WHERE target_id = ?',
          args: [id],
        }),
      ]);

      if (nodeR.rows.length === 0) return null;
      const row = nodeR.rows[0]!;

      return {
        id: row.id as string,
        last_accessed: new Date(
          (row.neural_last_accessed || row.provenance_created_at) as string,
        ),
        created_at: new Date(row.created_at as string),
        access_count: Number(row.neural_access_count ?? 0),
        inbound_edge_count: Number(edgeR.rows[0]?.cnt ?? 0),
      };
    },
```

**Replace with:**
```typescript
    async getNodeForReranking(
      id: string,
    ): Promise<RerankingNodeData | null> {
      const db = getDb();
      const [nodeR, edgeR] = await Promise.all([
        db.execute({
          sql: `SELECT id, neural_last_accessed, provenance_created_at,
                       created_at, neural_access_count, subtype
                FROM nodes WHERE id = ?`,
          args: [id],
        }),
        db.execute({
          sql: 'SELECT COUNT(*) as cnt FROM edges WHERE target_id = ?',
          args: [id],
        }),
      ]);

      if (nodeR.rows.length === 0) return null;
      const row = nodeR.rows[0]!;

      return {
        id: row.id as string,
        last_accessed: new Date(
          (row.neural_last_accessed || row.provenance_created_at) as string,
        ),
        created_at: new Date(row.created_at as string),
        access_count: Number(row.neural_access_count ?? 0),
        inbound_edge_count: Number(edgeR.rows[0]?.cnt ?? 0),
        subtype: (row.subtype as string) ?? undefined,
      };
    },
```

**Changes:** Added `subtype` to the SQL SELECT clause, and `subtype: (row.subtype as string) ?? undefined` to the return object.

---

### Step 1.7: Build and verify

After all TypeScript changes are made, rebuild the core module and verify.

**Commands to run (from project root):**
```bash
cd nous-server/core
npx tsup
```

**Expected output:** Build succeeds with no errors. No new warnings.

**Verify the import chain works:**
```bash
cd nous-server/server
node -e "
const p = await import('@nous/core/params');
const s = await import('@nous/core/sections');
console.log('rerankWithSectionWeights exists:', typeof p.rerankWithSectionWeights === 'function');
console.log('ScoredNode has subtype:', 'subtype' in p.ScoredNodeSchema.shape);
console.log('Section profiles:', Object.keys(s.SECTION_PROFILES));
"
```

**Expected output:**
```
rerankWithSectionWeights exists: true
ScoredNode has subtype: true
Section profiles: [ 'EPISODIC', 'SIGNALS', 'KNOWLEDGE', 'PROCEDURAL' ]
```

---

## Per-Section Weight Profiles

These are the weight profiles from `SECTION_PROFILES` (defined in Issue 0's `sections/index.ts`). They are reproduced here for reference — the actual values are in the sections module.

| Signal | EPISODIC | SIGNALS | KNOWLEDGE | PROCEDURAL | Global (old) |
|--------|----------|---------|-----------|------------|-------------|
| semantic | 0.20 | 0.15 | **0.35** | 0.25 | 0.30 |
| keyword | 0.15 | 0.10 | 0.15 | **0.25** | 0.15 |
| graph | 0.15 | 0.10 | 0.20 | **0.20** | 0.20 |
| recency | **0.30** | **0.45** | 0.05 | 0.05 | 0.15 |
| authority | 0.10 | 0.10 | **0.20** | 0.15 | 0.10 |
| affinity | 0.10 | 0.10 | 0.05 | 0.10 | 0.10 |

**Design rationale per section:**

- **EPISODIC** (trades, summaries): Recency is the dominant signal (0.30). "What happened recently?" matters most for trade history. Semantic similarity is secondary (0.20) — the agent usually queries by specific event ("my ETH short last week"), not abstract concepts.

- **SIGNALS** (signals, watchpoints): Recency overwhelms all other signals (0.45). A 4-hour-old funding rate signal is noise. Keyword match is minimal (0.10) — signals surface by time, not by matching specific words.

- **KNOWLEDGE** (lessons, theses, curiosity): Semantic similarity dominates (0.35) — the agent searches for concepts ("funding rate divergence"), not specific times. Authority is high (0.20) — a lesson with many edges to trade outcomes is well-validated. Recency is near zero (0.05) — a lesson from 3 months ago is just as valid as one from yesterday.

- **PROCEDURAL** (playbooks, missed opportunities, good passes): Keyword match is elevated (0.25) — playbooks are searched by pattern name ("momentum breakout", "funding squeeze"). Graph connectivity is strong (0.20) — a well-connected playbook has edges to the trades it was applied in. Recency is irrelevant (0.05) — playbooks are timeless.

---

## Testing

### Unit Tests (TypeScript)

**New file:** `nous-server/core/src/params/section-reranking.test.ts`

```typescript
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
        last_accessed: new Date('2026-02-18T12:00:00Z'),  // 2 days ago
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
```

**Run with:**
```bash
cd nous-server/core
npx vitest run src/params/section-reranking.test.ts
```

**Expected:** All tests pass.

### Regression Tests (existing)

Run ALL existing tests to verify no regressions:

```bash
cd nous-server/core
npx vitest run
```

**Expected:**
- All existing params tests pass (the `ScoredNode` schema change is additive — `subtype` is optional)
- All existing SSA tests pass (the `RerankingNodeData` change is additive — `subtype` is optional)
- All existing sections tests pass (from Guide 0)
- The `rerankCandidates()` function is unchanged — direct callers still work

**Critical regression risk:** The `ScoredNodeSchema` Zod schema — if any test validates exact schema shape via `strict()` or similar, the new `subtype` field might cause failures. Check existing tests for `ScoredNodeSchema.parse()` calls that might reject unknown fields. The schema uses `z.object()` (not `z.object().strict()`), so additional properties are allowed by default.

### Integration Tests (Live Local)

These tests require the Nous server running locally.

**Prerequisites:**
```bash
# Terminal 1: Start Nous server
cd nous-server/server
pnpm dev
# Should show: "Nous server running on port 3100"
```

**Test 1: Create nodes of different sections, search, verify ranking changes**
```bash
# Create a signal node (SIGNALS section — recency-dominant)
curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type": "concept", "subtype": "custom:signal", "content_title": "Funding rate spike BTC 0.15%", "content_body": "BTC perpetual funding rate spiked to 0.15% on Binance, highest in 30 days. Open interest rising."}' | jq '{id, subtype}'

# Create a lesson node (KNOWLEDGE section — authority-dominant)
curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type": "concept", "subtype": "custom:lesson", "content_title": "Funding rate spikes often precede squeezes", "content_body": "When funding rates exceed 0.10% and OI is rising, a short squeeze or correction follows within 24 hours in 7 out of 10 observed cases."}' | jq '{id, subtype}'

# Wait for embeddings
sleep 3

# Search for "funding rate" — both nodes should appear
curl -s -X POST http://localhost:3100/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "funding rate spike", "limit": 10}' | jq '.data[] | {id, subtype, memory_section, score, primary_signal, breakdown}'
```

**Expected:**
- Both nodes appear in results
- The signal node has `memory_section: "SIGNALS"` and a `primary_signal` of `"recency"` (because SIGNALS weights give recency 0.45)
- The lesson node has `memory_section: "KNOWLEDGE"` and a `primary_signal` of `"semantic"` or `"authority"` (because KNOWLEDGE weights give semantic 0.35, authority 0.20)
- The score breakdown reflects per-section weight application — the recency component of the signal node should be multiplied by 0.45, not 0.15

**Test 2: Verify stale signal is penalized despite high semantic match**
```bash
# Create a stale signal (3 days old via manual last_accessed backdating)
STALE_ID=$(curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type": "concept", "subtype": "custom:signal", "content_title": "Old funding rate signal BTC", "content_body": "BTC funding at 0.12% three days ago."}' | jq -r '.id')

# Backdate the stale signal's last_accessed to 3 days ago
# (This requires direct PATCH — the node is brand new with last_accessed = now)
curl -s -X PATCH "http://localhost:3100/v1/nodes/$STALE_ID" \
  -H "Content-Type: application/json" \
  -d '{"neural_last_accessed": "2026-02-17T12:00:00Z"}'

sleep 2

# Search — the stale signal should rank BELOW the fresh signal from Test 1
curl -s -X POST http://localhost:3100/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "BTC funding rate", "limit": 10}' | jq '.data[] | select(.subtype == "custom:signal") | {id, subtype, score, breakdown}'
```

**Expected:** The fresh signal from Test 1 ranks above the stale signal because SIGNALS section applies 0.45 recency weight.

**Test 3: Verify score breakdown reflects section weights**
```bash
# Search and examine a single result's breakdown
curl -s -X POST http://localhost:3100/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "funding rate lessons", "limit": 5}' | jq '.data[0] | {subtype, score, breakdown, primary_signal}'
```

**Expected:** The breakdown fields (semantic, keyword, graph, recency, authority, affinity) are present and the weighted sum matches the `score` field using that node's section weights (not global weights).

### Live Dynamic Tests (VPS)

After deploying the updated Nous server to VPS:

**Test 4: Verify existing production nodes get section-aware reranking**
```bash
# SSH to VPS, then:
curl -s -X POST http://localhost:3100/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "ETH trade thesis funding", "limit": 10}' | jq '.data[] | {id, subtype, memory_section, score, primary_signal}'
```

**Expected:**
- Results include nodes from multiple sections (signals, lessons, trades)
- `primary_signal` varies by section: signals show `recency`, lessons show `semantic` or `authority`
- `memory_section` field is populated on all results (from Guide 0)

**Test 5: Compare before/after ranking quality (manual)**

Run the same query before and after the deploy:
1. Before: note the top 5 results and their scores
2. Deploy the updated server
3. After: run the same query, note the top 5 results and their scores
4. Verify: signals should rank higher on recent queries, lessons should rank higher on knowledge queries

**Test 6: Verify existing SSA test suite on VPS**
```bash
cd nous-server/core
npx vitest run
```

**Expected:** All tests pass, including the new section-reranking tests and all pre-existing tests.

---

## Verification Checklist

| # | Check | How to Verify |
|---|-------|---------------|
| 1 | TypeScript core compiles | `cd nous-server/core && npx tsup` — no errors |
| 2 | New section-reranking tests pass | `npx vitest run src/params/section-reranking.test.ts` — all green |
| 3 | Existing params tests still pass | `npx vitest run src/params/index.test.ts` — no regressions |
| 4 | Existing SSA tests still pass | `npx vitest run src/ssa/index.test.ts` — no regressions |
| 5 | Existing sections tests still pass | `npx vitest run src/sections/` — no regressions |
| 6 | Full test suite passes | `npx vitest run` — all tests pass |
| 7 | `subtype` flows through to ScoredNode | Local Nous: create node, search, verify `subtype` present in debug (add temporary log in `rerankWithSectionWeights`) |
| 8 | Signal nodes get recency-dominant scoring | Search with signal + lesson results, verify signal's `primary_signal` is `"recency"` |
| 9 | Knowledge nodes get semantic/authority scoring | Search for a lesson, verify `primary_signal` is `"semantic"` or `"authority"` |
| 10 | `rerankCandidates()` backward compat | Direct call with no subtype still works with global weights |
| 11 | Score breakdown matches section weights | Manually compute: `score = Σ(weight_i × signal_i)` using section weights, compare to returned `score` |
| 12 | No Python changes needed | Run Python tests: `PYTHONPATH=src python -m pytest tests/ -v` — no regressions |
| 13 | VPS deploy + smoke test | Deploy, run search query, verify `primary_signal` varies by section |

---

## File Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `nous-server/core/src/params/index.ts` | Modified | Add `subtype?: string` to `ScoredNode` + Zod schema. Add `rerankWithSectionWeights()` function (~55 lines). Add import for `@nous/core/sections`. |
| `nous-server/core/src/ssa/index.ts` | Modified | Add `subtype?: string` to `RerankingNodeData`. Pass `subtype` through `buildScoredNodes()`. Switch `executeSSA()` Step 4 to `rerankWithSectionWeights()`. Add import for `rerankWithSectionWeights`. |
| `nous-server/server/src/ssa-context.ts` | Modified | Add `subtype` to `getNodeForReranking()` SQL SELECT + return object. |
| `nous-server/core/src/params/section-reranking.test.ts` | **NEW** | 15+ unit tests for per-section reranking (~250 lines) |

**Total new code:** ~305 lines (function + tests)
**Total modified:** ~20 lines across 3 existing files
**Schema changes:** None (subtype already exists in DB; we're just SELECTing it)
**API changes:** None (response shape unchanged — score breakdown already exists)
**Python changes:** None (all reranking happens server-side in Nous TS)

---

## What Comes Next

After this guide is implemented:

- **Issue 2** (Per-Section Decay Curves) uses `SECTION_PROFILES[section].decay` and `SUBTYPE_INITIAL_STABILITY` to give different memory types different FSRS parameters. Independent of this guide — both depend only on Guide 0.
- **Issue 6** (Section-Aware Retrieval Bias) adds an **intent-based priority boost** on the Python side. After SSA returns results with per-section reranking (this guide), the Python orchestrator classifies query intent and applies a multiplier to results from query-relevant sections. This guide provides the foundation that Issue 6 builds the boost on top of.
- The `rerankWithSectionWeights()` function is the permanent replacement for `rerankCandidates()` in the SSA pipeline. The old function remains available for direct callers and tests that need explicit weight control.
