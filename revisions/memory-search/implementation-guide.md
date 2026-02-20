# Intelligent Retrieval Orchestrator — Implementation Guide

> **STATUS: IMPLEMENTED.** The orchestrator is live. This guide was the blueprint; the actual implementation diverged in several areas (noted below). See `src/hynous/intelligence/retrieval_orchestrator.py` for the real code.
>
> **Key divergences from this guide:**
> 1. **Decision #3 (search method):** Guide says "Use existing `search()`, not `search_full()`" — Implementation added `search_full()` to NousClient for the orchestrator's quality gating
> 2. **Decision #5 (D4-only trigger):** Guide says "D4 is the ONLY decomposition trigger" — Implementation also triggers on D1 (live QCS classifies some compound queries as D1)
> 3. **6-step → 5-step pipeline:** Guide has a "Replace Weak" step 6 — Implementation uses a 5-step pipeline (quality gate + merge handles result quality without per-result replacement)
> 4. **SearchFilters dataclass:** Guide uses `SearchFilters` dataclass — Implementation uses individual filter parameters passed as kwargs
> 5. **SPAN_ORCHESTRATION trace:** Guide adds a new trace constant — Implementation records orchestration within existing `SPAN_RETRIEVAL`
> 6. **Sub-query group tagging:** Guide specifies `_sub_query_group` tagging — Implementation doesn't tag results with groups (Hebbian strengthening scoped differently)
> 7. **Grouped Hebbian strengthening:** Guide modifies Hebbian to scope by groups — Not implemented (standard co-retrieval strengthening retained)
>
> **Parameter updates (2026-02-19):** Config values were raised from the original guide: `max_results` 8→20, `search_limit_per_query` 10→25, `retrieve_limit` 5→20, `max_context_tokens` 800→4000. The SSA engine also received tuning: `hop_decay` 0.5→0.80, `min_threshold` 0.05→0.01, plus a query-relevance floor filter and max normalization in `executeSSA()`.
>
> Multi-pass memory retrieval that decomposes compound queries, gates result quality,
> retries with reformulations, and replaces weak results. All Python-side — no Nous changes.

---

## Problem Statement

Hynous's memory retrieval currently works like typing one Google search and taking the first 5 links — regardless of whether the query has multiple parts, whether those 5 links are actually good, or whether there are better results just below the cutoff.

The agent stores rich, detailed memories (trade theses, lessons, market analyses) into Nous, and Nous has a sophisticated 6-signal SSA retrieval algorithm that ranks them well. But the Python retrieval layer asks one question, takes 5 results, and moves on. For a system whose intelligence depends on memory quality, this is the weakest link.

**The problem manifests in three ways:**

1. **Compound queries get half-answered.** "What's my BTC thesis and how did my last SOL trade go?" becomes a single search that surfaces BTC OR SOL memories, rarely both. The QCS already detects these (D4 pattern) but only uses the flag to toggle embeddings.

2. **No quality awareness.** The system retrieves 5 results regardless of relevance. If 3 are excellent and 2 are noise, all 5 get injected. If all 5 are mediocre and there's a perfect match at position 6, it's invisible.

3. **No retry on failure.** A human Googling "BTC support levels January" who gets bad results would naturally try "BTC price floor Jan 2026" — broadening, narrowing, or rewording. The system gets one shot.

**The solution:** An Intelligent Retrieval Orchestrator that transforms memory retrieval from a single-shot lookup into a multi-pass research process with quality gating, reformulation retries, and per-result replacement.

---

## Prerequisites — Read Before Coding

Read these files **in order** before writing any code. Understanding the existing patterns is critical for consistent implementation.

### Must Read (Python — Hynous)

| # | File | Why |
|---|------|-----|
| 1 | `src/hynous/intelligence/memory_manager.py` | **Primary integration target.** Contains `retrieve_context()` (line 89) which currently calls `nous.search()` directly at lines 112-115 — this is where the orchestrator gets wired in. Also contains `_strengthen_co_retrieved()` (line 598) which needs grouped Hebbian scoping, `_format_context()` (line 442) which formats results into injectable text, `_is_trivial()` (line 415) and `_TRIVIAL_MESSAGES` (lines 65-72) which filter before orchestrator runs, and `_extract_query()` (line 404) which strips timestamps. |
| 2 | `src/hynous/nous/client.py` | **NousClient API.** Contains `search()` (line 252) — the HTTP call to Nous that the orchestrator wraps. Returns `list[dict]` where each dict has `score`, `breakdown`, `primary_signal`, `content_title`, `content_body`, `id`, etc. Also contains `classify_query()` (line 329) — the QCS endpoint the orchestrator uses for decomposition decisions. Understand the return shapes. Also used by `_auto_link()`, `_resolve_wikilinks()`, `_auto_link_summary()` in background threads — proves the singleton `requests.Session` is already used concurrently. |
| 3 | `src/hynous/intelligence/tools/memory.py` | **Second integration target.** Contains `handle_recall_memory()` — the agent's explicit recall tool. Search mode (lines 841-849) calls `client.search()` with filters (type, subtype, lifecycle, time_range, cluster). This gets wired to the orchestrator too. Hebbian strengthening at lines 854-858. Also has `_auto_link()`, `_resolve_wikilinks()`, `_auto_assign_clusters()` — background thread patterns to follow. Note `_TYPE_MAP` for memory type → (node_type, subtype) mapping. |
| 4 | `src/hynous/core/config.py` | **Config pattern.** Contains all `@dataclass` configs (`MemoryConfig` at line 57, `DaemonConfig` at line 68, `Config` at line 133) and `load_config()` (line 154). You will add `OrchestratorConfig` dataclass and wire it into `Config` and `load_config()` following the exact same pattern as existing sub-configs. Study how `mem_raw` at line 179 feeds into `MemoryConfig(...)` at line 204 — your `orch_raw` follows the identical pattern. |
| 5 | `config/default.yaml` | **YAML config.** Current memory settings at lines 90-96, no orchestrator section yet. Add the orchestrator section after the memory section following the same comment style. |
| 6 | `src/hynous/core/request_tracer.py` | **Trace recording.** Lines 36-43 define span type constants (`SPAN_RETRIEVAL`, `SPAN_MEMORY_OP`, `SPAN_QUEUE_FLUSH`, etc.). Lines 90-104 show `record_span()` usage. You will add `SPAN_ORCHESTRATION` constant after line 43. |
| 7 | `src/hynous/intelligence/agent.py` | **ThreadPoolExecutor pattern.** `_execute_tools()` uses `ThreadPoolExecutor` with `_run()` closure and timeout handling. The orchestrator's parallel search uses the same pattern. |
| 8 | `src/hynous/intelligence/gate_filter.py` | **Standalone module pattern.** This is a module that was added as a standalone file with pure functions, integrated into the existing flow via a single insertion point. The orchestrator follows the same approach. |

### Must Read (TypeScript — Reference Only)

| # | File | Why |
|---|------|-----|
| 9 | `nous-server/server/src/routes/search.ts` | **Search response format.** The response shape is `{data: [...], count, metrics, qcs}`. Each item in `data` has `score` (0-1 float), `breakdown` (6-signal dict), `primary_signal` (string). The QCS double-classify is understood and accepted. |
| 10 | `nous-server/server/src/routes/classify.ts` | **Classify response format.** Returns `{query, disqualified, disqualifier_category, disqualifier_reason, query_type, confidence, entity, attribute}`. |
| 11 | `nous-server/core/src/qcs/index.ts` | **D4 compound patterns.** Lines 129-138 define the 7 regex patterns that trigger D4 compound detection. Your decomposition is D4-triggered. |

### Must Read (Tests — Pattern Reference)

| # | File | Why |
|---|------|-----|
| 12 | `tests/unit/test_gate_filter.py` | **Unit test pattern.** Uses pytest classes (`class TestCheckContent`), imports internal helpers for direct testing, tests both pass and reject cases with assertion on `result.passed` and `result.reason`. Follow this structure. |
| 13 | `tests/integration/test_gate_filter_integration.py` | **Integration test pattern.** Uses `unittest.mock.patch` and `MagicMock` for NousClient. Patches at SOURCE module path (`hynous.core.config.load_config`, `hynous.nous.client.get_client`), not at import location. `_make_config()` helper creates mock config. Follow this exact mocking strategy. |

### Must Read (Documentation)

| # | File | Why |
|---|------|-----|
| 14 | `revisions/memory-search/design-plan.md` | **Original engineer design.** The architectural vision this guide implements, with refinements. |
| 15 | `ARCHITECTURE.md` | **System overview.** Understand the 4-layer architecture (Dashboard → FastAPI Gateway → Nous API → SQLite). The orchestrator lives in the FastAPI Gateway layer (intelligence/). |

---

## Architecture Decisions

All decisions are final. Do not deviate.

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **New standalone module `retrieval_orchestrator.py`** | Clean separation. Single insertion point into `memory_manager.py` and `tools/memory.py`. Same pattern as `gate_filter.py`. |
| 2 | **No Nous (TypeScript) changes** | All orchestration is Python-side. SSA engine stays untouched. |
| 3 | **Use existing `search()` method, not a new `search_full()`** | `search()` already returns results with `score` fields embedded in each dict. QCS metadata comes from separate `classify_query()` call. Adding `search_full()` is unnecessary. If SSA metrics (seed_count, spread_depth) are needed for debugging later, add `search_full()` then. |
| 4 | **Accept double QCS classification** | The orchestrator calls `/classify-query` (5ms), then `/search` runs QCS internally again. QCS is pure regex, no DB. 5ms overhead is negligible. |
| 5 | **D4 is the ONLY decomposition trigger** | Only `disqualifier_category == "D4"` triggers decomposition. D1/D2/D3/D5/D6 and non-disqualified queries go through as single queries. |
| 6 | **ThreadPoolExecutor for parallel search** | Same pattern as `agent.py:_execute_tools()`. NousClient singleton is already used concurrently (proven by background threads). |
| 7 | **Hebbian strengthening scoped to sub-query groups** | Compound queries produce results from different topics. Cross-topic edge strengthening creates noise. Tag results with `_sub_query_group: int` and strengthen within groups only. |
| 8 | **Weak results are dropped, not kept** | If replacement search fails (no better candidate), the weak result is removed. Quality > quantity. Exception: always keep at least the single highest-scored result. |
| 9 | **Config toggle with `enabled` field** | `OrchestratorConfig.enabled` (default True). When False, falls through to a single `nous.search()` — zero overhead off-switch. |
| 10 | **Filters propagate to every sub-query** | `SearchFilters` dataclass carries type/subtype/lifecycle/time_range/cluster_ids. Applied identically to all sub-queries. |

---

## How the 6-Step Pipeline Works

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
│  │     │                      │  │  D4 compound? → proceed to decompose
│  │     │                      │  │  Other? → skip to step 3 as single query
│  │  2. DECOMPOSE              │  │  D4 → split; else → single query
│  │     │                      │  │  Strategies: conjunction, question mark,
│  │     │                      │  │  "also" split, entity-based fallback
│  │  3. PARALLEL SEARCH        │  │  ThreadPoolExecutor per sub-query
│  │     │                      │  │  Single query skips executor overhead
│  │  4. QUALITY GATE           │  │  score threshold + reformulation retry
│  │     │                      │  │  Applies to ALL queries (simple + compound)
│  │  5. MERGE & SELECT         │  │  dedup, re-rank, dynamic cutoff
│  │     │                      │  │  Coverage guarantee: 1 result per sub-query
│  │  6. REPLACE WEAK           │  │  Per-result replacement or drop
│  │     │                      │  │  Applies to ALL queries (simple + compound)
│  └────────────────────────────┘  │
│          │                        │
│          ▼                        │
│   formatted context string        │
└──────────────────────────────────┘
    │
    ▼
  Agent LLM call (with injected context)
```

**Key: Steps 4 and 6 apply to ALL queries, not just compound ones.** A simple "BTC thesis" query still gets quality-gated (retry if top score < 0.20) and weak results get replaced/dropped. The decomposition path (steps 1-2) is the only thing gated behind D4 detection.

---

## Implementation Steps

### Step 1: Add `OrchestratorConfig` to config.py

**File:** `src/hynous/core/config.py`

**What to do:** Add a new dataclass after `MemoryConfig` (after line 65), add the field to `Config`, and wire it in `load_config()`.

**1a. Add the dataclass** (insert after the `MemoryConfig` class at line 65, before `DaemonConfig` at line 68):

```python
@dataclass
class OrchestratorConfig:
    """Retrieval orchestrator — intelligent multi-pass memory search."""
    enabled: bool = True                    # Master switch
    quality_threshold: float = 0.20         # Min top-result score to accept per sub-query
    relevance_ratio: float = 0.4            # Dynamic cutoff: include if score >= top * ratio
    max_results: int = 8                    # Hard cap on merged results
    max_sub_queries: int = 4                # Max decomposition parts
    max_retries: int = 1                    # Reformulation attempts per sub-query
    timeout_seconds: float = 3.0            # Total orchestration timeout
    search_limit_per_query: int = 10        # Results to fetch per sub-query (overfetch)
    replacement_floor: float = 0.25         # Score below which replacement is attempted
    max_replacements: int = 2               # Max replacement searches per orchestration call
```

**1b. Add field to `Config`** (in the `Config` class at line 133, after `memory` field at line 144):

```python
    orchestrator: OrchestratorConfig = field(default_factory=OrchestratorConfig)
```

**1c. Wire in `load_config()`** (in the `load_config` function starting at line 154):

Add this raw parsing line alongside the other raw lines (after `discord_raw` at line 183):

```python
    orch_raw = raw.get("orchestrator", {})
```

Add this to the `Config(...)` constructor call (inside the `return Config(...)` block starting at line 185, after the `discord=DiscordConfig(...)` section and before `project_root=root`):

```python
        orchestrator=OrchestratorConfig(
            enabled=orch_raw.get("enabled", True),
            quality_threshold=orch_raw.get("quality_threshold", 0.20),
            relevance_ratio=orch_raw.get("relevance_ratio", 0.4),
            max_results=orch_raw.get("max_results", 8),
            max_sub_queries=orch_raw.get("max_sub_queries", 4),
            max_retries=orch_raw.get("max_retries", 1),
            timeout_seconds=orch_raw.get("timeout_seconds", 3.0),
            search_limit_per_query=orch_raw.get("search_limit_per_query", 10),
            replacement_floor=orch_raw.get("replacement_floor", 0.25),
            max_replacements=orch_raw.get("max_replacements", 2),
        ),
```

**Verification:** `python -c "from hynous.core.config import load_config; c = load_config(); print(c.orchestrator.enabled)"` → prints `True`

---

### Step 2: Add YAML config section

**File:** `config/default.yaml`

**What to do:** Add orchestrator section after the memory section (after line 96, before the events section at line 98).

```yaml
# Retrieval orchestrator (intelligent multi-pass memory search)
orchestrator:
  enabled: true
  quality_threshold: 0.20         # Min top-result score to accept per sub-query
  relevance_ratio: 0.4            # Dynamic cutoff: include if score >= top_score * ratio
  max_results: 8                  # Hard cap on merged results
  max_sub_queries: 4              # Max decomposition parts
  max_retries: 1                  # Reformulation attempts per sub-query
  timeout_seconds: 3.0            # Total orchestration timeout
  search_limit_per_query: 10      # Overfetch per sub-query (quality gate narrows)
  replacement_floor: 0.25         # Score below which per-result replacement is attempted
  max_replacements: 2             # Max replacement searches per orchestration call
```

**CRITICAL:** Config defaults in `config.py` dataclass MUST match the values in `default.yaml`. Both use the same numbers.

---

### Step 3: Add trace constant

**File:** `src/hynous/core/request_tracer.py`

**What to do:** Add one line after `SPAN_QUEUE_FLUSH = "queue_flush"` (line 43):

```python
SPAN_ORCHESTRATION = "orchestration"
```

---

### Step 4: Create the orchestrator module

**File:** `src/hynous/intelligence/retrieval_orchestrator.py` (NEW)

This is the core module. ~280 lines. Every function is specified below with full implementation details. The entire file content follows — write it exactly as shown.

```python
"""
Retrieval Orchestrator — Intelligent Multi-Pass Memory Search

Transforms single-shot retrieval into a 6-step pipeline:
  1. Classify — QCS pre-check for compound query detection
  2. Decompose — Split D4 compound queries into sub-queries
  3. Parallel Search — Execute sub-queries concurrently
  4. Quality Gate — Retry if top result is below threshold
  5. Merge & Select — Dedup, rank, dynamic cutoff
  6. Replace Weak — Per-result upgrade or drop

Invoked from memory_manager.py (auto-retrieval) and tools/memory.py (explicit recall).
"""

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from ..core.config import Config
from ..core.request_tracer import get_tracer, SPAN_ORCHESTRATION

logger = logging.getLogger(__name__)


@dataclass
class SearchFilters:
    """Filters propagated to every sub-query's search call."""
    type: str | None = None
    subtype: str | None = None
    lifecycle: str | None = None
    time_range: dict | None = None
    cluster_ids: list[str] | None = None


# ====================================================================
# MAIN ENTRY POINT
# ====================================================================


def orchestrate_retrieval(
    query: str,
    client,  # NousClient instance
    config: Config,
    filters: SearchFilters | None = None,
    trace_id: str | None = None,
) -> list[dict]:
    """Run the 6-step retrieval pipeline.

    Args:
        query: The search query (timestamp already stripped).
        client: NousClient instance for HTTP calls.
        config: App config (has config.orchestrator).
        filters: Optional type/subtype/lifecycle/time_range/cluster_ids to
                 apply to every sub-query.
        trace_id: Debug trace ID for span recording.

    Returns:
        List of node dicts, each with 'score' and '_sub_query_group' fields.
        May be empty if nothing relevant found.
    """
    orch = config.orchestrator

    # Off-switch: fall through to single search
    if not orch.enabled:
        return _single_search(client, query, orch.search_limit_per_query, filters)

    _start = time.monotonic()
    stats = {
        "was_decomposed": False,
        "sub_query_count": 1,
        "sub_queries": [query],
        "retry_count": 0,
        "replacements_attempted": 0,
        "replacements_successful": 0,
    }

    try:
        # Step 1: Classify
        qcs = _classify(client, query)

        # Step 2: Decompose (D4 only)
        sub_queries = [query]
        if (
            qcs
            and qcs.get("disqualifier_category") == "D4"
            and len(query) <= 500
        ):
            decomposed = _decompose(query, qcs)
            if len(decomposed) > 1:
                sub_queries = decomposed[:orch.max_sub_queries]
                stats["was_decomposed"] = True

        stats["sub_query_count"] = len(sub_queries)
        stats["sub_queries"] = sub_queries

        # Step 3 + 4: Parallel search with quality gate
        all_sub_results: dict[int, list[dict]] = {}
        total_retries = 0

        if len(sub_queries) == 1:
            # Single query — skip executor overhead
            results, retried = _search_with_quality(
                client, sub_queries[0], orch, filters, qcs,
            )
            all_sub_results[0] = results
            if retried:
                total_retries += 1
        else:
            # Parallel execution
            with ThreadPoolExecutor(max_workers=len(sub_queries)) as pool:
                future_to_idx = {
                    pool.submit(
                        _search_with_quality, client, sq, orch, filters, qcs,
                    ): i
                    for i, sq in enumerate(sub_queries)
                }
                for future in as_completed(future_to_idx, timeout=orch.timeout_seconds):
                    idx = future_to_idx[future]
                    try:
                        results, retried = future.result()
                        all_sub_results[idx] = results
                        if retried:
                            total_retries += 1
                    except Exception as e:
                        logger.debug("Sub-query %d failed: %s", idx, e)
                        all_sub_results[idx] = []

        stats["retry_count"] = total_retries

        # Step 5: Merge & Select
        merged = _merge_and_select(all_sub_results, orch)

        # Step 6: Replace Weak
        final, attempted, successful = _replace_weak(
            client, merged, orch, filters,
        )
        stats["replacements_attempted"] = attempted
        stats["replacements_successful"] = successful
        stats["pre_merge_count"] = sum(len(r) for r in all_sub_results.values())
        stats["final_count"] = len(final)
        stats["top_score"] = final[0].get("score", 0) if final else 0

        return final

    except Exception as e:
        logger.warning("Orchestrator failed, falling back to single search: %s", e)
        return _single_search(client, query, orch.search_limit_per_query, filters)

    finally:
        # Record orchestration span
        _duration = int((time.monotonic() - _start) * 1000)
        try:
            if trace_id:
                from datetime import datetime, timezone
                get_tracer().record_span(trace_id, {
                    "type": SPAN_ORCHESTRATION,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "duration_ms": _duration,
                    **stats,
                })
        except Exception:
            pass


# ====================================================================
# HELPERS
# ====================================================================


def _single_search(
    client, query: str, limit: int, filters: SearchFilters | None,
) -> list[dict]:
    """Direct search without orchestration. Used as fallback and off-switch path."""
    kwargs = _build_search_kwargs(query, limit, filters)
    results = client.search(**kwargs)
    # Tag all results with group 0 for Hebbian compatibility
    for r in results:
        r["_sub_query_group"] = 0
    return results


def _build_search_kwargs(
    query: str, limit: int, filters: SearchFilters | None,
) -> dict:
    """Build kwargs dict for NousClient.search()."""
    kwargs: dict = {"query": query, "limit": limit}
    if filters:
        if filters.type:
            kwargs["type"] = filters.type
        if filters.subtype:
            kwargs["subtype"] = filters.subtype
        if filters.lifecycle:
            kwargs["lifecycle"] = filters.lifecycle
        if filters.time_range:
            kwargs["time_range"] = filters.time_range
        if filters.cluster_ids:
            kwargs["cluster_ids"] = filters.cluster_ids
    return kwargs


# ====================================================================
# STEP 1: CLASSIFY
# ====================================================================


def _classify(client, query: str) -> dict | None:
    """Call QCS classify endpoint. Returns None on failure (graceful degradation)."""
    try:
        return client.classify_query(query)
    except Exception as e:
        logger.debug("QCS classify failed, skipping: %s", e)
        return None


# ====================================================================
# STEP 2: DECOMPOSE
# ====================================================================

# Decomposition regex patterns (matching D4 triggers from nous-server/core/src/qcs)
_CONJUNCTION_SPLIT = re.compile(
    r"\b(?:and\s+(?:what|when|where|who|how|why))\b", re.IGNORECASE,
)
_ALSO_SPLIT = re.compile(r"\balso\b", re.IGNORECASE)


def _decompose(query: str, qcs: dict) -> list[str]:
    """Split a compound query into atomic sub-queries.

    Strategies tried in order:
    1. Conjunction + question word split ("X and what Y")
    2. Multiple question mark split ("X? Y?")
    3. "Also" split ("X, also Y")
    4. Entity-based fallback (QCS entity + original structure)

    Returns 1+ sub-queries. If decomposition fails, returns [query].
    """
    # Strategy 1: Conjunction split
    parts = _CONJUNCTION_SPLIT.split(query)
    if len(parts) > 1:
        cleaned = [p.strip().rstrip("?").strip() for p in parts if p.strip()]
        valid = [p for p in cleaned if len(p) > 3]
        if len(valid) > 1:
            return valid

    # Strategy 2: Multiple question marks
    if query.count("?") > 1:
        parts = [p.strip() for p in query.split("?") if p.strip()]
        valid = [p for p in parts if len(p) > 3]
        if len(valid) > 1:
            return valid

    # Strategy 3: "Also" split
    parts = _ALSO_SPLIT.split(query)
    if len(parts) > 1:
        cleaned = [p.strip().strip(",").strip() for p in parts if p.strip()]
        valid = [p for p in cleaned if len(p) > 3]
        if len(valid) > 1:
            return valid

    # Strategy 4: Entity-based fallback
    entity = qcs.get("entity")
    if entity and entity.lower() != query.lower():
        # Extract other potential entities from the query
        # Look for capitalized words that aren't common question words
        _skip = {"what", "when", "where", "who", "how", "why", "is", "are",
                 "was", "were", "my", "the", "and", "also", "did", "does"}
        words = query.split()
        entities = [
            w.strip("?,!.") for w in words
            if len(w) > 2 and w[0].isupper() and w.lower() not in _skip
        ]
        # If we found multiple distinct entities, create per-entity queries
        unique = list(dict.fromkeys(entities))  # preserve order, dedup
        if len(unique) > 1:
            # Use the attribute from QCS if available for context
            attr = qcs.get("attribute", "")
            if attr:
                return [f"{e} {attr}" for e in unique]
            return unique

    # Decomposition failed — single query
    return [query]


# ====================================================================
# STEPS 3-4: SEARCH WITH QUALITY GATE
# ====================================================================

# Words to strip for query simplification
_QUESTION_WORDS = re.compile(
    r"\b(what|what's|whats|when|where|who|how|why|is|are|was|were|did|does|do|"
    r"tell me about|show me|give me|find|get|check)\b",
    re.IGNORECASE,
)


def _search_with_quality(
    client,
    query: str,
    orch,  # OrchestratorConfig
    filters: SearchFilters | None,
    qcs: dict | None,
) -> tuple[list[dict], bool]:
    """Search with quality gate. Returns (results, did_retry).

    If top result score < quality_threshold, retries once with reformulated query.
    """
    kwargs = _build_search_kwargs(query, orch.search_limit_per_query, filters)
    results = client.search(**kwargs)
    retried = False

    # Quality gate: check top result score
    if results:
        top_score = results[0].get("score", 0)
        if isinstance(top_score, (int, float)) and top_score < orch.quality_threshold:
            # Top result below threshold — retry with reformulated query
            reformed = _reformulate(query, qcs)
            if reformed and reformed != query:
                retry_kwargs = _build_search_kwargs(
                    reformed, orch.search_limit_per_query, filters,
                )
                # If original had subtype filter, broaden by dropping it
                retry_kwargs.pop("subtype", None)
                retry_results = client.search(**retry_kwargs)
                retried = True

                # Merge: keep all unique results, let merge step handle ranking
                existing_ids = {r.get("id") for r in results}
                for r in retry_results:
                    if r.get("id") not in existing_ids:
                        results.append(r)
                        existing_ids.add(r.get("id"))

    return results, retried


def _reformulate(query: str, qcs: dict | None) -> str | None:
    """Generate a reformulated query for retry.

    Strategies:
    1. Simplify: strip question words, keep nouns/entities
    2. Entity-only: if QCS extracted an entity, use just that

    Returns None if no useful reformulation possible.
    """
    # Strategy 1: Simplify — strip question words
    simplified = _QUESTION_WORDS.sub("", query).strip()
    simplified = re.sub(r"\s+", " ", simplified).strip("? ")
    if simplified and len(simplified) > 3 and simplified != query:
        return simplified

    # Strategy 2: Entity-only from QCS
    if qcs:
        entity = qcs.get("entity")
        if entity and len(entity) > 2:
            return entity

    return None


# ====================================================================
# STEP 5: MERGE & SELECT
# ====================================================================


def _merge_and_select(
    sub_results: dict[int, list[dict]],
    orch,  # OrchestratorConfig
) -> list[dict]:
    """Merge results from sub-queries. Dedup, rank, dynamic cutoff, coverage guarantee.

    Each result gets '_sub_query_group' tag for Hebbian scoping.
    """
    # Tag each result with its sub-query group
    seen_ids: dict[str, dict] = {}  # node_id -> best result dict
    group_has_result: dict[int, bool] = {}

    for group_idx, results in sub_results.items():
        for r in results:
            r["_sub_query_group"] = group_idx
            node_id = r.get("id")
            if not node_id:
                continue
            existing = seen_ids.get(node_id)
            if existing is None or r.get("score", 0) > existing.get("score", 0):
                seen_ids[node_id] = r
        if results:
            group_has_result[group_idx] = True

    # Sort by score descending
    all_results = sorted(
        seen_ids.values(),
        key=lambda r: r.get("score", 0),
        reverse=True,
    )

    if not all_results:
        return []

    # Dynamic cutoff
    top_score = all_results[0].get("score", 0)
    cutoff = top_score * orch.relevance_ratio if isinstance(top_score, (int, float)) else 0
    selected: list[dict] = []
    groups_represented: set[int] = set()

    for r in all_results:
        score = r.get("score", 0)
        group = r.get("_sub_query_group", 0)

        if len(selected) >= orch.max_results:
            break

        # Always include if above cutoff
        if score >= cutoff:
            selected.append(r)
            groups_represented.add(group)
        # Coverage guarantee: include at least 1 from each group with results
        elif group not in groups_represented and group in group_has_result:
            selected.append(r)
            groups_represented.add(group)

    return selected


# ====================================================================
# STEP 6: REPLACE WEAK
# ====================================================================


def _replace_weak(
    client,
    results: list[dict],
    orch,  # OrchestratorConfig
    filters: SearchFilters | None,
) -> tuple[list[dict], int, int]:
    """Replace weak results with better candidates. Drop if no replacement found.

    Returns (final_results, attempts, successes).
    """
    if not results or orch.max_replacements <= 0:
        return results, 0, 0

    attempts = 0
    successes = 0
    existing_ids = {r.get("id") for r in results}
    final: list[dict] = []

    for r in results:
        score = r.get("score", 0)

        # Above floor — keep as-is
        if not isinstance(score, (int, float)) or score >= orch.replacement_floor:
            final.append(r)
            continue

        # Below floor — attempt replacement (if budget remains)
        if attempts >= orch.max_replacements:
            # Budget exhausted — drop weak result
            continue

        title = r.get("content_title", "")
        if not title or len(title) < 3:
            # No title to derive query from — drop
            continue

        attempts += 1
        try:
            kwargs = _build_search_kwargs(title, 3, filters)
            candidates = client.search(**kwargs)

            # Find best candidate not already in result set
            best = None
            for c in candidates:
                cid = c.get("id")
                c_score = c.get("score", 0)
                if cid and cid not in existing_ids and c_score > score:
                    if best is None or c_score > best.get("score", 0):
                        best = c

            if best:
                best["_sub_query_group"] = r.get("_sub_query_group", 0)
                final.append(best)
                existing_ids.add(best.get("id"))
                successes += 1
                logger.debug(
                    "Replaced weak result (%.2f) with better (%.2f) via '%s'",
                    score, best.get("score", 0), title[:40],
                )
            else:
                # No better candidate — drop the weak result
                logger.debug(
                    "Dropped weak result (%.2f) '%s' — no replacement found",
                    score, title[:40],
                )
        except Exception as e:
            logger.debug("Replacement search failed for '%s': %s", title[:40], e)
            # Drop the weak result on error

    # Safety: always return at least the top result if we had any
    if not final and results:
        best_original = max(results, key=lambda r: r.get("score", 0))
        best_original["_sub_query_group"] = best_original.get("_sub_query_group", 0)
        final = [best_original]

    return final, attempts, successes
```

**Verification for Step 4:**
- Module imports cleanly: `python -c "from hynous.intelligence.retrieval_orchestrator import orchestrate_retrieval, SearchFilters; print('OK')"` → prints `OK`
- With `enabled=False`, `orchestrate_retrieval()` returns results from a single `search()` call
- With `enabled=True` and a simple query, runs Steps 1-6 and returns tagged results
- `_decompose()` splits `"What's BTC doing and how is SOL?"` into 2 parts
- `_reformulate()` turns `"What's BTC support level?"` into `"BTC support level"`

---

### Step 5: Wire into memory_manager.py

**File:** `src/hynous/intelligence/memory_manager.py`

**5a. Replace the search call in `retrieve_context()`** (lines 111-116):

Find this exact code:
```python
            _ret_start = time.monotonic()
            results = nous.search(
                query=query,
                limit=self.config.memory.retrieve_limit,
            )
            _ret_ms = int((time.monotonic() - _ret_start) * 1000)
```

Replace with:
```python
            from .retrieval_orchestrator import orchestrate_retrieval

            _ret_start = time.monotonic()
            results = orchestrate_retrieval(
                query, nous, self.config, trace_id=_trace_id,
            )
            _ret_ms = int((time.monotonic() - _ret_start) * 1000)
```

**IMPORTANT:** The trace span recording block immediately after (lines 118-140) stays unchanged — it records the existing `SPAN_RETRIEVAL` with results. The orchestrator records its own `SPAN_ORCHESTRATION` internally. Both spans coexist in the trace for debugging.

**5b. Replace Hebbian strengthening** (lines 145-147):

Find this exact code:
```python
            # Hebbian: strengthen edges between co-retrieved memories (MF-1)
            if len(results) > 1:
                _strengthen_co_retrieved(nous, results, amount=0.03)
```

Replace with:
```python
            # Hebbian: strengthen edges between co-retrieved memories (MF-1)
            # Scope to sub-query groups to prevent cross-topic edge noise
            if len(results) > 1:
                from collections import defaultdict
                groups = defaultdict(list)
                for r in results:
                    groups[r.get("_sub_query_group", 0)].append(r)
                for group_results in groups.values():
                    if len(group_results) > 1:
                        _strengthen_co_retrieved(nous, group_results, amount=0.03)
```

**Why grouped Hebbian?** When a compound query like "BTC thesis and SOL trade" returns 2 BTC results + 2 SOL results, we don't want to strengthen edges between BTC nodes and SOL nodes — they co-appeared due to query decomposition, not because they're actually related. Only strengthen within the same sub-query group.

**Verification for Step 5:**
- `retrieve_context("What's BTC doing?")` calls the orchestrator instead of `nous.search()` directly
- Simple queries still return results (orchestrator fast path)
- Trivial queries still return None (caught by `_is_trivial()` at line 415 before orchestrator runs)
- Hebbian strengthening only applies within sub-query groups

---

### Step 6: Wire into tools/memory.py

**File:** `src/hynous/intelligence/tools/memory.py`

**6a. Replace the search call in `handle_recall_memory()`** search mode (lines 841-849):

Find this exact code in the `else` branch (search mode):
```python
            results = client.search(
                query=query,
                type=node_type,
                subtype=subtype,
                lifecycle=lifecycle,
                limit=limit,
                time_range=time_range,
                cluster_ids=[cluster] if cluster else None,
            )
```

Replace with:
```python
            from ..retrieval_orchestrator import orchestrate_retrieval, SearchFilters
            from ...core.config import load_config

            _cfg = load_config()
            _filters = SearchFilters(
                type=node_type,
                subtype=subtype,
                lifecycle=lifecycle,
                time_range=time_range,
                cluster_ids=[cluster] if cluster else None,
            )
            results = orchestrate_retrieval(query, client, _cfg, filters=_filters)
```

**6b. Replace Hebbian strengthening** (lines 854-858):

Find this exact code:
```python
            # Hebbian: strengthen edges between co-retrieved memories (MF-1)
            # Higher amount (0.05) than auto-retrieval (0.03) since agent explicitly asked
            if len(results) > 1:
                from ..memory_manager import _strengthen_co_retrieved
                _strengthen_co_retrieved(client, results, amount=0.05)
```

Replace with:
```python
            # Hebbian: strengthen edges between co-retrieved memories (MF-1)
            # Higher amount (0.05) than auto-retrieval (0.03) since agent explicitly asked
            # Scope to sub-query groups to prevent cross-topic edge noise
            if len(results) > 1:
                from collections import defaultdict
                from ..memory_manager import _strengthen_co_retrieved
                groups = defaultdict(list)
                for r in results:
                    groups[r.get("_sub_query_group", 0)].append(r)
                for group_results in groups.values():
                    if len(group_results) > 1:
                        _strengthen_co_retrieved(client, group_results, amount=0.05)
```

**Verification for Step 6:**
- `handle_recall_memory(query="BTC thesis")` calls orchestrator with correct filters
- `handle_recall_memory(query="BTC and SOL analysis")` decomposes into sub-queries
- `handle_recall_memory(memory_type="thesis", active_only=True, query="BTC")` passes SearchFilters with subtype and lifecycle correctly
- Browse mode is unchanged (no query → no orchestrator)

---

### Step 7: Unit tests

**File:** `tests/unit/test_retrieval_orchestrator.py` (NEW)

Create this file with pytest tests. Follow the exact pattern from `tests/unit/test_gate_filter.py`.

```python
"""Tests for the retrieval orchestrator module."""

import pytest
from unittest.mock import MagicMock, patch

from hynous.intelligence.retrieval_orchestrator import (
    orchestrate_retrieval,
    SearchFilters,
    _classify,
    _decompose,
    _search_with_quality,
    _reformulate,
    _merge_and_select,
    _replace_weak,
)
```

**Mock helpers** (place at module top, after imports):

```python
def _make_config(enabled=True, **overrides):
    """Create a mock config with OrchestratorConfig."""
    config = MagicMock()
    config.orchestrator.enabled = enabled
    config.orchestrator.quality_threshold = overrides.get("quality_threshold", 0.20)
    config.orchestrator.relevance_ratio = overrides.get("relevance_ratio", 0.4)
    config.orchestrator.max_results = overrides.get("max_results", 8)
    config.orchestrator.max_sub_queries = overrides.get("max_sub_queries", 4)
    config.orchestrator.max_retries = overrides.get("max_retries", 1)
    config.orchestrator.timeout_seconds = overrides.get("timeout_seconds", 3.0)
    config.orchestrator.search_limit_per_query = overrides.get("search_limit_per_query", 10)
    config.orchestrator.replacement_floor = overrides.get("replacement_floor", 0.25)
    config.orchestrator.max_replacements = overrides.get("max_replacements", 2)
    config.memory.retrieve_limit = 5
    return config


def _make_result(node_id, score, title="Test", group=0):
    """Create a mock search result dict."""
    return {
        "id": node_id,
        "score": score,
        "content_title": title,
        "content_body": "Test body content",
        "type": "concept",
        "subtype": "custom:thesis",
        "provenance_created_at": "2026-02-12T00:00:00Z",
        "state_lifecycle": "ACTIVE",
        "_sub_query_group": group,
    }
```

**Test classes to implement:**

**1. `class TestDecompose`** — test each decomposition strategy:

| Test | Input | Expected |
|------|-------|----------|
| `test_conjunction_split` | `"What's BTC doing and how is SOL?"` | 2 parts |
| `test_question_mark_split` | `"What's BTC at? Did SOL close?"` | 2 parts |
| `test_also_split` | `"Check BTC, also look at ETH"` | 2 parts |
| `test_entity_fallback` | `"BTC and SOL analysis"` with QCS `entity="BTC"` | 2 parts |
| `test_single_query_unchanged` | `"BTC support levels"` with QCS `entity="BTC"` | 1 part (`[query]`) |
| `test_short_parts_filtered` | Parts that are < 3 chars are dropped |

For `_decompose`, pass a mock QCS dict: `{"disqualifier_category": "D4", "entity": "BTC", "attribute": "analysis"}`.

**2. `class TestReformulate`** — test reformulation strategies:

| Test | Input | Expected |
|------|-------|----------|
| `test_simplify` | `"What's BTC support level?"` | `"BTC support level"` |
| `test_entity_fallback` | Query that simplifies to empty + QCS `entity="BTC"` | `"BTC"` |
| `test_no_reformulation` | `"BTC"` (already simple, can't simplify further) | `None` |
| `test_strips_question_words` | `"How does funding rate affect price?"` | `"funding rate affect price"` |

**3. `class TestMergeAndSelect`** — test merge logic:

| Test | Setup | Expected |
|------|-------|----------|
| `test_dedup_keeps_highest_score` | Same `node_id` in group 0 (score=0.3) and group 1 (score=0.5) | Kept once with score=0.5 |
| `test_dynamic_cutoff` | Top score=0.60, cutoff=0.24 (0.60×0.4). Result at 0.20 excluded | Result below cutoff excluded |
| `test_coverage_guarantee` | Group 1 result scores 0.10 (below cutoff) but it's the only rep for group 1 | Included anyway |
| `test_hard_cap` | 12 results, `max_results=8` | Only 8 returned |
| `test_empty_input` | Empty `sub_results` | Empty output |
| `test_tags_sub_query_group` | Results from group 0 and group 1 | Each result has correct `_sub_query_group` |

Use `_make_config()` to create a mock config with orchestrator attributes. Use `_make_result()` for result dicts.

**4. `class TestReplaceWeak`** — test replacement logic:

| Test | Setup | Expected |
|------|-------|----------|
| `test_replaces_below_floor` | Result with score=0.15, mock client returns candidate with score=0.35 | Replacement used |
| `test_drops_when_no_better` | Result with score=0.15, mock client returns no better candidates | Result dropped |
| `test_max_replacements_cap` | 5 weak results, `max_replacements=2` | Only 2 replacement attempts, rest dropped |
| `test_above_floor_kept` | All results score >= 0.25 | All kept unchanged |
| `test_safety_keeps_one` | All results would be dropped → safety net keeps best | 1 result returned |

**5. `class TestSearchWithQuality`** — test quality gate:

| Test | Setup | Expected |
|------|-------|----------|
| `test_passes_above_threshold` | Top score=0.45 (>= 0.20) | No retry, `did_retry=False` |
| `test_retries_below_threshold` | Top score=0.10 (< 0.20), reformulate returns different query | Retry called, `did_retry=True` |
| `test_retry_merges_results` | Original returns ids [A, B], retry returns ids [B, C] | Merged to [A, B, C] (no dupe B) |

Mock `client.search` to return controlled results. Mock `client.classify_query` if needed.

**6. `class TestOrchestrateRetrieval`** — test full pipeline:

| Test | Setup | Expected |
|------|-------|----------|
| `test_disabled_falls_through` | `enabled=False` | Single `client.search()` call, no classify |
| `test_simple_query_fast_path` | Non-D4 classify result | Single search, no decomposition |
| `test_compound_query_decomposes` | D4 classify result for compound query | Multiple search calls |
| `test_classify_failure_graceful` | `client.classify_query` raises Exception | Continues with single query, no crash |
| `test_all_results_have_group_tag` | Any query | Every result dict has `_sub_query_group` key |

**Mock patterns** (CRITICAL — patch at source, not import):
```python
# For testing the full orchestrate_retrieval function:
mock_client = MagicMock()
mock_client.search.return_value = [_make_result("n1", 0.45), _make_result("n2", 0.30)]
mock_client.classify_query.return_value = {"disqualified": False, "query_type": "LOOKUP"}

config = _make_config(enabled=True)
results = orchestrate_retrieval("BTC thesis", mock_client, config)
```

---

### Step 8: Integration tests

**File:** `tests/integration/test_orchestrator_integration.py` (NEW)

Follow the exact pattern from `tests/integration/test_gate_filter_integration.py` — patch at source modules.

```python
"""Integration tests for retrieval orchestrator in the retrieve_context flow."""

from unittest.mock import patch, MagicMock
from hynous.intelligence.memory_manager import MemoryManager
```

**Test class: `class TestRetrieveContextIntegration`**

| Test | What it does | How to mock |
|------|-------------|-------------|
| `test_simple_query_returns_results` | Patches `get_client()`, verifies `retrieve_context()` returns formatted context string | Mock client.search returns results, mock client.classify_query returns non-D4 |
| `test_compound_query_decomposes` | Mock client.classify_query returns D4, verify multiple search calls | `client.classify_query.return_value = {"disqualified": True, "disqualifier_category": "D4", "entity": "BTC"}` then check `client.search.call_count > 1` |
| `test_graceful_degradation_nous_down` | Mock client raises Exception on all calls → returns None | `mock_get_client.return_value.search.side_effect = Exception("Nous down")` |
| `test_trivial_message_skips_orchestrator` | "ok" → returns None, no search calls | `mock_get_client.return_value.search.assert_not_called()` |

**Patch targets** (CRITICAL — patch at source, not import):
```python
@patch("hynous.nous.client.get_client")
@patch("hynous.core.config.load_config")
def test_xxx(self, mock_config, mock_get_client):
    ...
```

Note: The `@patch` decorators pass mock objects as parameters in **reverse order** — the last `@patch` becomes the first parameter, and so on. This is standard `unittest.mock` behavior.

**Config mock for integration tests:**
```python
def _make_config():
    """Create a minimal mock config for integration tests."""
    config = MagicMock()
    config.memory.compress_enabled = True
    config.memory.retrieve_limit = 5
    config.memory.max_context_tokens = 800
    config.orchestrator.enabled = True
    config.orchestrator.quality_threshold = 0.20
    config.orchestrator.relevance_ratio = 0.4
    config.orchestrator.max_results = 8
    config.orchestrator.max_sub_queries = 4
    config.orchestrator.max_retries = 1
    config.orchestrator.timeout_seconds = 3.0
    config.orchestrator.search_limit_per_query = 10
    config.orchestrator.replacement_floor = 0.25
    config.orchestrator.max_replacements = 2
    return config
```

---

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Nous is down | `classify_query()` fails → `_classify()` returns None → continues as simple query. `search()` fails → orchestrator catches exception, falls back to `_single_search()`. If that also fails, `retrieve_context()` catches and returns None. |
| Classify endpoint fails | `_classify()` returns None → skip decomposition, treat as simple query |
| All sub-queries return empty | `_merge_and_select()` returns `[]` → `_replace_weak()` returns `([], 0, 0)` → `retrieve_context()` returns None |
| Timeout hit mid-search | `as_completed(timeout=3.0)` stops collecting futures → returns whatever results completed so far |
| Decomposition produces 1 part | Treated as simple query (no executor overhead, direct call) |
| Query is trivial ("ok", "thanks") | Caught by `_is_trivial()` in `memory_manager.py` BEFORE orchestrator runs → returns None |
| Very long query (> 500 chars) | Decomposition skipped (line `len(query) <= 500` check) — likely pasted content, not a question |
| All results below quality threshold after retry | `_search_with_quality()` returns all results (original + retry merged). `_replace_weak()` may drop some, but safety net keeps best one. |
| All results below replacement_floor and no better candidates found | Safety net: `if not final and results: final = [best_original]` — always returns at least the single highest-scored result |

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

## Code Consistency Checklist

Before considering implementation complete, verify:

- [ ] All new functions have docstrings matching the codebase style (`"""One-line summary.\n\nDetails."""`)
- [ ] Logger usage: `logger = logging.getLogger(__name__)` at module top, `logger.debug/info/warning/error` for messages
- [ ] Error handling: `try/except Exception as e:` with `logger.debug` for expected failures, `logger.warning` for degraded paths, `logger.error` for unexpected failures
- [ ] Background thread pattern: NOT used in orchestrator (all calls are synchronous within the request)
- [ ] Trace recording: wrapped in `try/except Exception: pass` to never break the agent
- [ ] Config defaults match between `config.py` dataclass and `default.yaml`
- [ ] `load_config()` uses `.get(field, default)` pattern for every field
- [ ] No circular imports: `retrieval_orchestrator.py` imports from `..core.config` and `..core.request_tracer` only
- [ ] `memory_manager.py` imports orchestrator with local import (inside function body) to avoid circular deps
- [ ] `tools/memory.py` imports orchestrator with local import (inside function body) to match existing pattern
- [ ] All test files can be run: `pytest tests/unit/test_retrieval_orchestrator.py -v` and `pytest tests/integration/test_orchestrator_integration.py -v`
- [ ] Existing tests still pass: `pytest tests/ -v` — no regressions

---

## System Verification

After all steps are complete, verify the full system:

1. **Config loads**: `python -c "from hynous.core.config import load_config; c = load_config(); print(c.orchestrator.enabled)"` → prints `True`
2. **Module imports**: `python -c "from hynous.intelligence.retrieval_orchestrator import orchestrate_retrieval, SearchFilters; print('OK')"` → prints `OK`
3. **Unit tests**: `pytest tests/unit/test_retrieval_orchestrator.py -v` → all pass
4. **Integration tests**: `pytest tests/integration/test_orchestrator_integration.py -v` → all pass
5. **All tests**: `pytest tests/ -v` → no regressions
6. **Manual**: If Nous server is running, start the dashboard and send a compound query in chat. Check debug traces for `SPAN_ORCHESTRATION` with `was_decomposed: true`.

---

## Future Considerations

- **SSA metrics for debugging:** The Nous `/search` endpoint returns `metrics` (seed_count, spread_depth) and `qcs` in the response, but `NousClient.search()` currently only returns `data.get("data", [])`. If deeper debugging of the orchestrator is needed, add a `search_full()` method that returns the full response including metrics. Not needed for initial implementation.
- **Threshold tuning:** The `quality_threshold` (0.20) and `replacement_floor` (0.25) are initial estimates. As the memory store grows, these may need adjustment. Monitor the trace data's `retry_count` and `replacements_attempted` fields to understand how often the quality mechanisms fire.
- **Decomposition evolution:** The current regex-based decomposition handles the most common compound query patterns. If users consistently write compound queries that aren't D4-detected, the QCS patterns in `nous-server/core/src/qcs/index.ts` can be extended (but that's a Nous-side change).
