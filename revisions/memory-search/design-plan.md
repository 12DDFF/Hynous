# Intelligent Retrieval Orchestrator — Design Plan

> **STATUS: IMPLEMENTED.** The orchestrator is live in `src/hynous/intelligence/retrieval_orchestrator.py`. Wired into `memory_manager.py` (auto-retrieval) and `tools/memory.py` (explicit recall). 222/222 tests passing. See implementation notes below.
>
> **Implementation notes:**
> - Added `NousClient.search_full()` method (returns full response `{data, count, metrics, qcs}`)
> - Decomposition triggers on both D4 (compound) AND D1 (ambiguous) — live QCS sometimes classifies compound queries as D1
> - 5-step pipeline (no "Replace Weak" step — quality gate + merge handles this)
> - Uses individual filter parameters instead of `SearchFilters` dataclass
> - `OrchestratorConfig` dataclass in `core/config.py` with YAML section in `config/default.yaml`

## Context & Motivation

Hynous's memory retrieval currently works like typing one Google search and taking the first 5 links — regardless of whether the query has multiple parts, whether those 5 links are actually good, or whether there are better results just below the cutoff.

The agent stores rich, detailed memories (trade theses, lessons, market analyses) into Nous, and Nous has a sophisticated 6-signal SSA retrieval algorithm that ranks them well. But the Python retrieval layer asks one question, takes 5 results, and moves on. For a system whose intelligence depends on memory quality, this is the weakest link.

**The problem manifests in three ways:**

1. **Compound queries get half-answered.** "What's my BTC thesis and how did my last SOL trade go?" becomes a single search that surfaces BTC OR SOL memories, rarely both. The QCS already detects these (D4 pattern) but only uses the flag to toggle embeddings.

2. **No quality awareness.** The system retrieves 5 results regardless of relevance. If 3 are excellent and 2 are noise, all 5 get injected. If all 5 are mediocre and there's a perfect match at position 6, it's invisible.

3. **No retry on failure.** A human Googling "BTC support levels January" who gets bad results would naturally try "BTC price floor Jan 2026" — broadening, narrowing, or rewording. The system gets one shot.

## Vision: Search Like a Researcher, Not a Search Box

The Intelligent Retrieval Orchestrator transforms memory retrieval from a single-shot lookup into a multi-pass research process:

```
USER: "What's my BTC thesis and how did my last SOL trade go?"

BEFORE (current):
  → Single search: "What's my BTC thesis and how did my last SOL trade go?"
  → Returns 5 results (mixed BTC/SOL, some irrelevant)
  → Agent works with whatever it got

AFTER (orchestrator):
  → Classify: D4 compound query detected, 2 entities (BTC, SOL)
  → Decompose: ["BTC thesis", "last SOL trade"]
  → Parallel search: both sub-queries execute simultaneously
  → Quality gate: BTC results score 0.45 (good), SOL results score 0.12 (bad)
  → Retry SOL: reformulate → "SOL trade_entry" → score 0.52 (good)
  → Merge: deduplicate, keep best 4 results (2 BTC + 2 SOL)
  → Agent gets precisely the memories it needs
```

**Core principles:**
- **Fast path stays fast.** Simple queries (80% of traffic) add < 50ms overhead — one classify call, skip decomposition, single search with dynamic cutoff.
- **Compound queries get decomposed.** D4-flagged queries split into sub-queries that run in parallel, bounded by a 3-second timeout.
- **Quality over quantity.** Results must earn their place. A score-based cutoff replaces the fixed limit — 2 excellent results beat 5 mediocre ones.
- **Retry when it matters.** One reformulation attempt per sub-query when results are below threshold. Not infinite loops — one smart retry, then accept what you have.
- **No Nous changes.** All orchestration lives Python-side. The TypeScript SSA engine stays untouched.

---

## Architecture Overview

```
User Message
    │
    ▼
┌──────────────────────────────────┐
│     retrieve_context(message)     │  memory_manager.py (existing)
│          │                        │
│          ▼                        │
│  ┌────────────────────────────┐  │
│  │  RETRIEVAL ORCHESTRATOR    │  │  retrieval_orchestrator.py (NEW)
│  │                            │  │
│  │  1. CLASSIFY               │  │  classify_query() → QCS metadata
│  │     │                      │  │
│  │  2. DECOMPOSE              │  │  D4 → split; else → single query
│  │     │                      │  │
│  │  3. PARALLEL SEARCH        │  │  ThreadPoolExecutor per sub-query
│  │     │                      │  │
│  │  4. QUALITY GATE           │  │  score threshold + retry
│  │     │                      │  │
│  │  5. MERGE & SELECT         │  │  dedup, re-rank, dynamic cutoff
│  │                            │  │
│  └────────────────────────────┘  │
│          │                        │
│          ▼                        │
│   formatted context string        │
└──────────────────────────────────┘
    │
    ▼
  Agent LLM call (with injected context)
```

**New module:** `src/hynous/intelligence/retrieval_orchestrator.py`
**Modified:** `memory_manager.py`, `tools/memory.py`, `nous/client.py`, `core/config.py`, `config/default.yaml`

---

## Detailed Design

### Step 1: CLASSIFY — Quick QCS Pre-Check

**Purpose:** Determine if the query needs decomposition before doing any search work.

**Implementation:** Call the existing `classify_query()` method on `NousClient` (currently unused — calls `POST /classify-query` on Nous server). This is a lightweight endpoint — no DB access, no embeddings, pure regex/pattern matching. Expected latency: < 5ms.

**Returns:**
```python
{
    "disqualified": True,
    "disqualifier_category": "D4",   # Compound query
    "query_type": "LOOKUP",
    "confidence": 0.65,
    "entity": "BTC",                 # Primary entity
    "attribute": "thesis"            # Primary attribute
}
```

**Decision logic:**
- `D4` (compound) → proceed to decomposition
- `D1/D2/D3/D5/D6` or not disqualified → skip decomposition, single search with quality gating
- Simple LOOKUP with high confidence → single search, fast path

### Step 2: DECOMPOSE — Split Compound Queries

**Purpose:** Break a multi-part query into atomic sub-queries that can be searched independently.

**Triggers:** Only when QCS returns `disqualifier_category == "D4"` (compound query).

**Decomposition strategies (tried in order):**

1. **Conjunction + question word split:** Split on `and what/when/where/who/how/why`
   - "What's BTC doing **and how** is SOL performing?" → ["What's BTC doing", "how is SOL performing"]

2. **Multiple question split:** Split on `?` boundaries
   - "What's BTC at? Did my SOL trade close?" → ["What's BTC at?", "Did my SOL trade close?"]

3. **"Also" split:** Split on `also` boundaries
   - "Check BTC, **also** look at ETH funding" → ["Check BTC", "look at ETH funding"]

4. **Entity-based fallback:** If regex splitting fails, use QCS entity extraction + the original query
   - "BTC and SOL analysis" → ["BTC analysis", "SOL analysis"]

**Validation:** Each sub-query must be > 3 characters. If decomposition produces nothing useful or only 1 part, fall back to single query.

**Max sub-queries:** 4 (configurable). More than 4 means the query is too complex — cap at 4 most distinct parts.

### Step 3: PARALLEL SEARCH — Execute Sub-Queries Concurrently

**Purpose:** Run all sub-queries simultaneously to minimize total latency.

**Implementation:** `ThreadPoolExecutor` (same pattern as `agent.py:_execute_tools()`).

```python
with ThreadPoolExecutor(max_workers=len(sub_queries)) as pool:
    futures = {
        pool.submit(search_with_quality, sq, config): sq
        for sq in sub_queries
    }
    for future in as_completed(futures, timeout=config.orchestrator_timeout):
        results[futures[future]] = future.result()
```

**Per-search parameters:**
- `limit`: Higher than final need — fetch `limit * 2` (e.g., 10) per sub-query to give quality gate material to work with
- Timeout: Individual sub-query timeout of 2s (within overall 3s budget)

**Single query optimization:** If only 1 sub-query (no decomposition), skip executor overhead and call directly.

### Step 4: QUALITY GATE — Ensure Results Are Worth Using

**Purpose:** Each sub-query's results must meet a relevance bar. Bad results get one retry with a reformulated query.

**Quality metric:** The `score` field from SSA (0-1 composite of semantic + keyword + graph + recency + authority + affinity signals).

**Threshold logic:**
```
Top result score >= quality_threshold (default 0.20) → PASS
Top result score < quality_threshold → RETRY once with reformulated query
Retry also fails → ACCEPT whatever we have (may be empty)
```

**Why 0.20?** SSA scores are a weighted combination of 6 signals. A score of 0.20 means at least moderate activation across multiple signals. Below that, the result is likely noise — a keyword fragment match with no semantic or graph support. This can be tuned.

**Reformulation strategy (one attempt):**
1. **Simplify:** Strip question words, keep just nouns/entities → "What's BTC's support level?" becomes "BTC support level"
2. **Broaden type filter:** If the original search had a subtype filter, drop it
3. **Entity-only fallback:** If QCS extracted an entity, try just the entity name → "BTC"

The reformulated query runs as a normal `nous.search()` call. If it also fails the threshold, accept whatever results exist (including empty).

### Step 5: MERGE & SELECT — Combine and Pick the Best

**Purpose:** Combine results from all sub-queries into one ranked list with dynamic sizing.

**Merge algorithm:**
1. **Deduplicate by node_id** — If the same memory appeared in multiple sub-queries, keep the highest score
2. **Tag origin** — Each result knows which sub-query surfaced it (useful for ensuring coverage)
3. **Sort by score** (descending)
4. **Dynamic cutoff** — Apply score-based selection instead of fixed limit:

**Dynamic sizing rules:**
```
- Always include the top result (if it passed quality gate)
- Include subsequent results if: score >= top_score * relevance_ratio (default 0.4)
  (i.e., within 60% of the best result's score)
- Ensure at least 1 result per sub-query that passed quality gate (coverage guarantee)
- Hard cap at max_results (default 8) to respect token budget
- Minimum 1 result total (if anything passed quality gate)
```

**Why `top_score * 0.4`?** This means if the best result scores 0.60, we include everything down to 0.24. This keeps tightly relevant results while cutting obvious noise. A result scoring 40% as well as the best is still meaningfully related.

**Coverage guarantee:** If "BTC thesis" returned 2 great results and "SOL trade" returned 1 decent result, all 3 are included even if the SOL result would fall below the cutoff. Each sub-query that passed quality gate gets at least 1 representative.

---

## File Changes

### NEW: `src/hynous/intelligence/retrieval_orchestrator.py`

The main module. Contains:

| Function | Purpose |
|----------|---------|
| `orchestrate_retrieval(query, config) → list[dict]` | Main entry point. Runs the 5-step pipeline |
| `_classify(client, query) → dict` | Step 1: Call QCS classify endpoint |
| `_decompose(query, qcs_result) → list[str]` | Step 2: Split compound queries |
| `_search_with_quality(client, query, config) → list[dict]` | Steps 3-4: Search + quality gate + retry |
| `_reformulate(query, qcs_result) → str \| None` | Generate reformulated query for retry |
| `_merge_and_select(sub_results, config) → list[dict]` | Step 5: Dedup, rank, dynamic cutoff |

### MODIFY: `src/hynous/nous/client.py`

**Change `search()` to also return QCS metadata.** Currently it returns `data.get("data", [])` — just nodes. We need score breakdowns and QCS info for quality gating.

Options:
- **Option A:** Add a `search_full()` method that returns `{"data": [...], "qcs": {...}, "metrics": {...}}` — leaves `search()` unchanged for backward compat
- **Option B:** Change `search()` return type to include metadata — breaking change for all callers

Recommend **Option A** — `search_full()` for the orchestrator, existing `search()` untouched.

### MODIFY: `src/hynous/intelligence/memory_manager.py`

**`retrieve_context()`** changes from:
```python
results = nous.search(query=query, limit=self.config.memory.retrieve_limit)
```
to:
```python
from .retrieval_orchestrator import orchestrate_retrieval
results = orchestrate_retrieval(query, self.config)
```

The Hebbian co-retrieval strengthening, trace recording, and context formatting stay as-is — they work on the result list regardless of how it was produced.

### MODIFY: `src/hynous/intelligence/tools/memory.py`

**`handle_recall_memory()`** (explicit agent recall) can also benefit from orchestration. When the agent calls `recall_memory(query="...")`, the query goes through the same orchestrator. The tool already supports type/subtype/time filters — these pass through to each sub-query's search call.

### MODIFY: `src/hynous/core/config.py`

Add `OrchestratorConfig` dataclass:
```python
@dataclass
class OrchestratorConfig:
    enabled: bool = True                    # Master switch
    quality_threshold: float = 0.20         # Min top-result score to accept
    relevance_ratio: float = 0.4            # Dynamic cutoff: score >= top * ratio
    max_results: int = 8                    # Hard cap on merged results
    max_sub_queries: int = 4                # Max decomposition parts
    max_retries: int = 1                    # Reformulation attempts per sub-query
    timeout_seconds: float = 3.0            # Total orchestration timeout
    search_limit_per_query: int = 10        # Results to fetch per sub-query (overfetch)
```

### MODIFY: `config/default.yaml`

```yaml
orchestrator:
  enabled: true
  quality_threshold: 0.20
  relevance_ratio: 0.4
  max_results: 8
  max_sub_queries: 4
  max_retries: 1
  timeout_seconds: 3.0
  search_limit_per_query: 10
```

---

## Edge Cases & Failure Modes

| Scenario | Behavior |
|----------|----------|
| Nous is down | `classify_query()` fails → fall back to single search (existing degraded path) |
| Classify endpoint fails | Skip classification, treat as simple query |
| All sub-queries return empty | Return empty list (same as current behavior) |
| Timeout hit mid-search | Return whatever results have completed so far |
| Decomposition produces 1 part | Treat as simple query (no executor overhead) |
| Query is trivial ("ok", "thanks") | Caught by existing `_is_trivial()` before orchestrator runs |
| Very long query (> 500 chars) | Don't decompose — likely pasted content, not a question |
| All results below quality threshold after retry | Return best available (don't return nothing just because threshold wasn't met) |

---

## Latency Analysis

| Path | Added Latency | When |
|------|---------------|------|
| Simple query (80% of traffic) | ~5ms (classify) + quality gate overhead | Every non-trivial message |
| Compound query, all pass quality | ~5ms (classify) + parallel searches (max of sub-queries, not sum) | D4 compound queries |
| Compound query, one retry | ~5ms + parallel + one serial retry (~50-500ms) | Quality gate fails on a sub-query |
| Worst case | 3s timeout cap | Multiple retries hitting timeout |

**The fast path (simple query) adds only the classify call (~5ms HTTP to localhost).** This is the critical constraint — auto-retrieval runs on every message, so the overhead for simple queries must be negligible.

---

## Verification Plan

1. **Unit tests** (`tests/unit/test_retrieval_orchestrator.py`):
   - Decomposition: test each strategy (conjunction split, question split, also split, entity fallback)
   - Quality gate: test threshold pass/fail/retry logic
   - Merge: test dedup, dynamic cutoff, coverage guarantee
   - Config: test all config fields load correctly

2. **Integration tests** (`tests/integration/test_orchestrator_integration.py`):
   - End-to-end with mock Nous server
   - Compound query → decompose → parallel search → merge
   - Timeout handling
   - Fallback when Nous is down

3. **Manual testing**:
   - Run the dashboard, send compound queries to chat
   - Verify debug traces show decomposition + parallel searches
   - Check that auto-retrieval latency for simple queries hasn't regressed
