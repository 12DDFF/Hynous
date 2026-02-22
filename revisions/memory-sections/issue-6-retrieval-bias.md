# Issue 6: Section-Aware Retrieval Bias — Implementation Guide

> **STATUS:** DONE
>
> **Depends on:** Issue 0 (Section Foundation) + Issue 1 (Per-Section Retrieval Weights). Issue 1 provides per-section reranking on the Nous/TypeScript side. This guide adds the **Python-side intent-based priority boost** — classifying query intent, boosting results from relevant sections, and tagging results with section labels for agent visibility.
>
> **What this changes:** After SSA returns results with per-section reranking weights (Issue 1), the Python retrieval orchestrator classifies query intent (signal-intent, episodic-intent, knowledge-intent, or procedural-intent), and applies a score multiplier to results from the query-relevant section(s). The agent also sees section labels in recalled context, making section membership transparent.

---

## Problem Statement

With Issues 0 and 1 implemented, SSA already reranks each candidate using its section's weight profile. But there's a missing piece: **the query's intent is not factored into scoring.**

Consider: the agent asks "what signals are firing right now?" — this is clearly a signal-intent query. Ideally, `custom:signal` nodes should get a priority boost beyond just their section-specific reranking weights. A signal node with SSA score 0.65 should outrank a lesson node with SSA score 0.70 for this query, because the query is explicitly asking about signals.

Conversely, "what lessons have I learned about funding rate divergences?" is knowledge-intent. Lesson nodes should get a boost for this query.

The retrieval orchestrator (`retrieval_orchestrator.py`) already has a merge-and-select step that sorts results by score. This guide adds an intent classification step and a score multiplier between the SSA search and the final merge.

**What this guide does:**
1. Adds `_classify_intent()` to the retrieval orchestrator — maps query text to relevant section(s)
2. Modifies `_merge_and_select()` to apply a score boost to results from query-relevant sections
3. Updates `_format_context()` in `memory_manager.py` to tag results with section labels
4. Updates the system prompt in `prompts/builder.py` with section-aware memory guidance
5. Creates intent classification rules in `src/hynous/nous/sections.py`

---

## Required Reading

Read these files **in order** before implementing. The "Focus Areas" column tells you exactly which parts matter.

### Foundation (read first)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 1 | `revisions/memory-sections/executive-summary.md` | Theory document. Defines the bias model: intent boost is a MULTIPLIER, not a filter. Results from non-relevant sections still appear. | "Issue 6: Section-Aware Retrieval Bias" (lines 310-356) — full design rationale |
| 2 | `revisions/memory-sections/issue-0-section-foundation.md` | Foundation guide. Defines `SECTION_PROFILES` with `intent_boost: 1.3` per section and `SectionsConfig` with configurable `intent_boost`. | `SectionsConfig` (lines 916-927), `SECTION_PROFILES` intent_boost values (lines 281, 308, 335, 363), Python `sections.py` with `get_section_for_subtype()` (lines 685-692) |
| 3 | `revisions/memory-sections/issue-1-retrieval-weights.md` | Per-section reranking guide. The Nous server already applies section-specific weights before results reach Python. This guide adds the SECOND layer: intent-based boost. | Skim for understanding — no Python changes in Issue 1 |

### Python Retrieval Pipeline (understand the data flow — these are the files you will modify)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 4 | `src/hynous/intelligence/retrieval_orchestrator.py` | **PRIMARY MODIFICATION TARGET.** The 5-step orchestration pipeline. You will add intent classification after Step 1 and modify `_merge_and_select()` to apply section boosts. | Full file (479 lines) — especially `orchestrate_retrieval()` (lines 52-135), `_classify()` (lines 142-160), `_merge_and_select()` (lines 391-478) |
| 5 | `src/hynous/intelligence/memory_manager.py` | **MODIFICATION TARGET.** Houses `retrieve_context()` (lines 89-164) which calls the orchestrator, and `_format_context()` (lines 453-498) which formats results for injection into agent context. | Lines 89-164 (retrieve_context), lines 453-498 (_format_context) |
| 6 | `src/hynous/intelligence/prompts/builder.py` | **MODIFICATION TARGET.** System prompt. The "How My Memory Works" section (lines 171-173) needs section-aware guidance so the agent understands memory sections. | Lines 146-173 (TOOL_STRATEGY, especially "How My Memory Works" block) |
| 7 | `src/hynous/nous/sections.py` | **MODIFICATION TARGET.** Python sections module from Issue 0. You will add intent classification rules (keyword patterns per section). | Full file — especially `get_section_for_subtype()`, `SECTION_PROFILES`, `MemorySection` enum |

### Python Config (understand configuration)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 8 | `src/hynous/core/config.py` | `SectionsConfig` dataclass (lines 81-91) with `intent_boost: float = 1.3`. `OrchestratorConfig` (lines 68-78) used by the orchestrator. | Lines 68-91 (OrchestratorConfig + SectionsConfig) |
| 9 | `config/default.yaml` | Current sections config. `intent_boost: 1.3` is the default multiplier. | Lines 115-122 (sections block) |

### Existing Tests (understand test patterns)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 10 | `tests/unit/test_retrieval_orchestrator.py` | Existing orchestrator tests. Your changes must not break these. | First 50 lines (imports, fixtures), any `_merge_and_select` tests |
| 11 | `tests/unit/test_sections.py` | Section tests from Guide 0. You'll add intent classification tests here. | Full file |

---

## Architecture Decisions

### Decision 1: Intent classification is keyword-pattern-based, not LLM-based (FINAL)

Intent classification uses fast keyword pattern matching, NOT an LLM call. The retrieval path must be fast (~5ms for classification). Keyword patterns are sufficient because intent categories are well-defined:

- Signal-intent: "firing", "current", "right now", "active signals", "what's happening"
- Episodic-intent: "my trade", "last time", "when did I", "my position", "history"
- Knowledge-intent: "lesson", "learned", "principle", "thesis", "what do I know"
- Procedural-intent: "playbook", "how do I", "process", "steps for", "my setup for"

Multi-intent is supported: "what signals are firing and what have I learned about them?" classifies as both SIGNALS and KNOWLEDGE intent.

**Where:** `src/hynous/nous/sections.py` — new `classify_intent()` function.

### Decision 2: Boost is a score multiplier, not a filter (FINAL)

Results from query-relevant sections get `score × intent_boost` (default 1.3). Results from non-relevant sections keep their original score. This means:

- A signal node with raw score 0.65 and intent boost 1.3 → effective score 0.845
- A lesson node with raw score 0.70 and no boost → effective score 0.70
- The signal outranks the lesson (0.845 > 0.70) for signal-intent queries
- BUT a lesson with raw score 0.90 still outranks a boosted signal at 0.845

This preserves the design principle: **no information loss.** Genuinely strong cross-section results always surface.

**Where:** `_merge_and_select()` in `retrieval_orchestrator.py`.

### Decision 3: Intent boost is configurable from YAML (FINAL)

The boost multiplier comes from `config.sections.intent_boost` (default 1.3 in `SectionsConfig`). This is tunable without code changes. Setting it to 1.0 effectively disables intent boost while keeping section-specific reranking (from Issue 1) active.

**Where:** Accessed via `config.sections.intent_boost` in the orchestrator.

### Decision 4: Context formatting tags results with section labels (FINAL)

`_format_context()` currently formats results as:
```
- [signal] BTC funding spike (2026-02-20): ...
```

After this guide, it adds a section tag:
```
- [signal · SIGNALS] BTC funding spike (2026-02-20): ...
- [lesson · KNOWLEDGE] Funding squeezes often reverse in 24h (2026-01-15): ...
```

This makes section membership visible to the agent, helping it understand the nature of recalled memories.

**Where:** `_format_context()` in `memory_manager.py`.

### Decision 5: System prompt mentions sections briefly (FINAL)

The "How My Memory Works" section in `builder.py` gets a short addition explaining that different memory types have different retrieval and decay behavior. This is brief (2-3 sentences) — the agent doesn't need to know implementation details, just that signals are ephemeral, lessons are durable, and the system automatically prioritizes based on context.

**Where:** `TOOL_STRATEGY` in `prompts/builder.py`.

---

## Implementation Steps

### Step 6.1: Add intent classification to Python sections module

**File:** `src/hynous/nous/sections.py`

Add keyword-based intent classification. This function maps a query string to one or more relevant sections.

**Find this** (at the end of the file, after the `get_initial_stability_for_subtype` function, around line 899):
```python
def get_initial_stability_for_subtype(subtype: str | None) -> float:
    """Get initial stability for a specific subtype (in days).

    Falls back to section default, then to 21 days (global fallback).
    """
    if subtype and subtype in SUBTYPE_INITIAL_STABILITY:
        return SUBTYPE_INITIAL_STABILITY[subtype]
    section = get_section_for_subtype(subtype)
    return SECTION_PROFILES[section].decay.initial_stability_days
```

**Insert AFTER:**
```python


# ============================================================
# INTENT CLASSIFICATION
# ============================================================

# Keyword patterns that indicate query intent for each section.
# Patterns are checked case-insensitively against the query string.
# A query can match multiple sections (multi-intent).
_INTENT_PATTERNS: dict[MemorySection, list[str]] = {
    MemorySection.SIGNALS: [
        "signal", "signals", "firing", "active signal",
        "what's happening", "whats happening", "right now",
        "current", "live", "real-time", "realtime",
        "alert", "anomaly", "anomalies", "scanner",
        "watchpoint", "watchpoints", "watching",
    ],
    MemorySection.EPISODIC: [
        "my trade", "my position", "my trades", "my positions",
        "last time", "when did i", "when i", "trade history",
        "what happened", "my short", "my long",
        "entry", "exit", "closed", "opened",
        "pnl", "profit", "loss", "drawdown",
        "session", "conversation", "yesterday", "last week",
    ],
    MemorySection.KNOWLEDGE: [
        "lesson", "lessons", "learned", "learning",
        "principle", "principles", "what do i know",
        "thesis", "theses", "theory", "pattern",
        "insight", "insights", "wisdom", "rule",
        "why does", "why do", "how does", "how do",
        "understand", "explain",
    ],
    MemorySection.PROCEDURAL: [
        "playbook", "playbooks", "procedure", "process",
        "how do i trade", "my setup", "my process",
        "steps for", "strategy for", "approach for",
        "when i see", "my plan for", "template",
        "missed opportunity", "good pass",
    ],
}


def classify_intent(query: str) -> list[MemorySection]:
    """Classify a query's intent to determine which section(s) are most relevant.

    Returns a list of MemorySection values that the query is relevant to.
    Returns empty list if no clear intent is detected (no boost applied).

    The classification is keyword-pattern-based for speed (~0.1ms).
    Multi-intent is supported: a query can match multiple sections.

    Args:
        query: The search query text.

    Returns:
        List of MemorySection values matching the query intent.
        Empty list means no specific section intent detected.
    """
    if not query:
        return []

    query_lower = query.lower()
    matched: list[MemorySection] = []

    for section, patterns in _INTENT_PATTERNS.items():
        for pattern in patterns:
            if pattern in query_lower:
                matched.append(section)
                break  # One match per section is enough

    return matched
```

---

### Step 6.2: Add intent-boosted merge to the retrieval orchestrator

**File:** `src/hynous/intelligence/retrieval_orchestrator.py`

This step modifies the orchestrator to classify intent and apply score boosts.

**First, update imports.** Find the imports at the top of the file.

**Find this** (lines 24-26):
```python
from ..core.config import Config, OrchestratorConfig
from ..nous.client import NousClient
```

**Replace with:**
```python
from ..core.config import Config, OrchestratorConfig
from ..nous.client import NousClient
from ..nous.sections import classify_intent, get_section_for_subtype
```

**Then, modify `orchestrate_retrieval()` to pass section config.**

**Find this** (lines 126-127):
```python
    # ---- Step 5: MERGE & SELECT ----
    merged = _merge_and_select(sub_results, orch)
```

**Replace with:**
```python
    # ---- Step 5: MERGE & SELECT (with section-aware intent boost) ----
    merged = _merge_and_select(sub_results, orch, query, config)
```

**Then, modify `_merge_and_select()` to accept the query and config, classify intent, and apply boosts.**

**Find this** (lines 391-478 — the entire `_merge_and_select` function):
```python
def _merge_and_select(
    sub_results: dict[str, list[dict]],
    orch: OrchestratorConfig,
) -> list[dict]:
    """Combine results from all sub-queries into one ranked list with dynamic sizing.

    1. Deduplicate by node ID (keep highest score)
    2. Tag origin sub-query
    3. Sort by score descending
    4. Dynamic cutoff: score >= top_score * relevance_ratio
    5. Coverage guarantee: at least 1 result per sub-query that had results
    6. Hard cap at max_results
    """
    if not sub_results:
        return []

    # Deduplicate by node_id — keep the highest-scoring instance
    best_by_id: dict[str, dict] = {}
    origin_by_id: dict[str, str] = {}  # node_id → sub-query that surfaced it

    for sq, results in sub_results.items():
        for node in results:
            node_id = node.get("id")
            if not node_id:
                continue
            score = _to_float(node.get("score", 0))

            existing = best_by_id.get(node_id)
            if existing is None:
                best_by_id[node_id] = node
                origin_by_id[node_id] = sq
            else:
                existing_score = _to_float(existing.get("score", 0))
                if score > existing_score:
                    best_by_id[node_id] = node
                    origin_by_id[node_id] = sq

    if not best_by_id:
        return []

    # Sort by score descending
    ranked = sorted(
        best_by_id.values(),
        key=lambda n: _to_float(n.get("score", 0)),
        reverse=True,
    )

    # Dynamic cutoff
    top_score = _to_float(ranked[0].get("score", 0))
    cutoff = top_score * orch.relevance_ratio

    # Select results above cutoff
    selected_ids: set[str] = set()
    selected: list[dict] = []

    for node in ranked:
        score = _to_float(node.get("score", 0))
        node_id = node.get("id")
        if score >= cutoff:
            selected.append(node)
            selected_ids.add(node_id)
            if len(selected) >= orch.max_results:
                break

    # Coverage guarantee: ensure at least 1 result per sub-query that had results
    if len(sub_results) > 1:
        for sq, results in sub_results.items():
            if not results:
                continue
            # Check if this sub-query already has representation
            has_coverage = any(
                origin_by_id.get(node.get("id")) == sq
                for node in selected
            )
            if not has_coverage and len(selected) < orch.max_results:
                # Add the best result from this sub-query
                for node in results:
                    node_id = node.get("id")
                    if node_id and node_id not in selected_ids:
                        selected.append(node)
                        selected_ids.add(node_id)
                        break

    # Ensure at least 1 result if we have any
    if not selected and ranked:
        selected.append(ranked[0])

    return selected
```

**Replace with:**
```python
def _merge_and_select(
    sub_results: dict[str, list[dict]],
    orch: OrchestratorConfig,
    query: str = "",
    config: Config | None = None,
) -> list[dict]:
    """Combine results from all sub-queries into one ranked list with dynamic sizing.

    1. Deduplicate by node ID (keep highest score)
    2. Tag origin sub-query
    3. Apply section-aware intent boost (Issue 6)
    4. Sort by boosted score descending
    5. Dynamic cutoff: score >= top_score * relevance_ratio
    6. Coverage guarantee: at least 1 result per sub-query that had results
    7. Hard cap at max_results
    """
    if not sub_results:
        return []

    # ---- Intent classification (Issue 6) ----
    intent_sections = classify_intent(query) if query else []
    intent_boost = 1.0
    if config and config.sections.enabled and intent_sections:
        intent_boost = config.sections.intent_boost  # Default 1.3
    else:
        intent_sections = []  # No boost if sections disabled

    # Deduplicate by node_id — keep the highest-scoring instance
    best_by_id: dict[str, dict] = {}
    origin_by_id: dict[str, str] = {}  # node_id → sub-query that surfaced it

    for sq, results in sub_results.items():
        for node in results:
            node_id = node.get("id")
            if not node_id:
                continue
            score = _to_float(node.get("score", 0))

            existing = best_by_id.get(node_id)
            if existing is None:
                best_by_id[node_id] = node
                origin_by_id[node_id] = sq
            else:
                existing_score = _to_float(existing.get("score", 0))
                if score > existing_score:
                    best_by_id[node_id] = node
                    origin_by_id[node_id] = sq

    if not best_by_id:
        return []

    # ---- Apply intent boost (Issue 6) ----
    # Boost scores for nodes whose section matches the query intent.
    # A signal-intent query boosts custom:signal and custom:watchpoint nodes.
    # The original score is preserved in _original_score for debugging.
    if intent_sections and intent_boost > 1.0:
        for node in best_by_id.values():
            subtype = node.get("subtype") or ""
            node_section = get_section_for_subtype(subtype if subtype else None)
            if node_section in intent_sections:
                original_score = _to_float(node.get("score", 0))
                node["_original_score"] = original_score
                node["score"] = original_score * intent_boost
                node["_intent_boosted"] = True

    # Sort by (potentially boosted) score descending
    ranked = sorted(
        best_by_id.values(),
        key=lambda n: _to_float(n.get("score", 0)),
        reverse=True,
    )

    # Dynamic cutoff
    top_score = _to_float(ranked[0].get("score", 0))
    cutoff = top_score * orch.relevance_ratio

    # Select results above cutoff
    selected_ids: set[str] = set()
    selected: list[dict] = []

    for node in ranked:
        score = _to_float(node.get("score", 0))
        node_id = node.get("id")
        if score >= cutoff:
            selected.append(node)
            selected_ids.add(node_id)
            if len(selected) >= orch.max_results:
                break

    # Coverage guarantee: ensure at least 1 result per sub-query that had results
    if len(sub_results) > 1:
        for sq, results in sub_results.items():
            if not results:
                continue
            # Check if this sub-query already has representation
            has_coverage = any(
                origin_by_id.get(node.get("id")) == sq
                for node in selected
            )
            if not has_coverage and len(selected) < orch.max_results:
                # Add the best result from this sub-query
                for node in results:
                    node_id = node.get("id")
                    if node_id and node_id not in selected_ids:
                        selected.append(node)
                        selected_ids.add(node_id)
                        break

    # Ensure at least 1 result if we have any
    if not selected and ranked:
        selected.append(ranked[0])

    # Log intent boost if applied
    if intent_sections:
        boosted_count = sum(1 for n in selected if n.get("_intent_boosted"))
        if boosted_count > 0:
            logger.debug(
                "Intent boost: %d/%d results boosted for sections=%s (×%.1f)",
                boosted_count, len(selected),
                [s.value for s in intent_sections], intent_boost,
            )

    return selected
```

**What changes:**
1. Added `query` and `config` parameters (backward compatible — both have defaults)
2. Calls `classify_intent(query)` to get relevant sections
3. After dedup, boosts scores for nodes in query-relevant sections by `intent_boost`
4. Preserves original score in `_original_score` for debugging
5. Tags boosted nodes with `_intent_boosted: True`
6. Logs boost statistics at DEBUG level

---

### Step 6.3: Update `_format_context()` to include section labels

**File:** `src/hynous/intelligence/memory_manager.py`

**First, add the import.**

**Find this** (lines 28-29):
```python
from ..core.request_tracer import get_tracer, SPAN_RETRIEVAL, SPAN_COMPRESSION, SPAN_QUEUE_FLUSH
```

**Replace with:**
```python
from ..core.request_tracer import get_tracer, SPAN_RETRIEVAL, SPAN_COMPRESSION, SPAN_QUEUE_FLUSH
from ..nous.sections import get_section_for_subtype
```

**Then, modify `_format_context()`.**

**Find this** (lines 462-486):
```python
    for node in results:
        title = node.get("content_title", "Untitled")
        subtype = node.get("subtype", node.get("type", ""))
        if subtype.startswith("custom:"):
            subtype = subtype[7:]
        date = node.get("provenance_created_at", "")[:10]

        # Get preview text — prefer full body over summary
        body = node.get("content_body", "") or ""
        summary = node.get("content_summary", "") or ""

        # Parse JSON bodies first (trades, watchpoints store JSON with "text" key)
        preview = ""
        if body.startswith("{"):
            try:
                parsed = json.loads(body)
                preview = parsed.get("text", "")
            except (json.JSONDecodeError, TypeError):
                pass

        # Use body as primary, summary only as fallback when body is empty
        if not preview:
            preview = body or summary

        entry = f"- [{subtype}] {title} ({date}): {preview}"
```

**Replace with:**
```python
    for node in results:
        title = node.get("content_title", "Untitled")
        raw_subtype = node.get("subtype", node.get("type", ""))
        subtype_label = raw_subtype
        if subtype_label.startswith("custom:"):
            subtype_label = subtype_label[7:]
        date = node.get("provenance_created_at", "")[:10]

        # Section tag from Nous response or computed from subtype
        section = node.get("memory_section") or get_section_for_subtype(raw_subtype or None).value

        # Get preview text — prefer full body over summary
        body = node.get("content_body", "") or ""
        summary = node.get("content_summary", "") or ""

        # Parse JSON bodies first (trades, watchpoints store JSON with "text" key)
        preview = ""
        if body.startswith("{"):
            try:
                parsed = json.loads(body)
                preview = parsed.get("text", "")
            except (json.JSONDecodeError, TypeError):
                pass

        # Use body as primary, summary only as fallback when body is empty
        if not preview:
            preview = body or summary

        entry = f"- [{subtype_label} · {section}] {title} ({date}): {preview}"
```

**What changes:** The format line changes from:
```
- [signal] BTC funding spike (2026-02-20): ...
```
to:
```
- [signal · SIGNALS] BTC funding spike (2026-02-20): ...
- [lesson · KNOWLEDGE] Funding squeezes often reverse (2026-01-15): ...
- [playbook · PROCEDURAL] Funding squeeze short playbook (2025-12-01): ...
```

This makes section membership visible to the agent in its recalled context.

---

### Step 6.4: Update system prompt with section-aware memory guidance

**File:** `src/hynous/intelligence/prompts/builder.py`

**Find this** (lines 171-173, the end of TOOL_STRATEGY):
```python
## How My Memory Works

My memory has semantic search, quality gates, dedup, and decay. Memories decay (ACTIVE → WEAK → DORMANT) — recalling strengthens them. When I need to revise a memory — correct information, append new data, change lifecycle — I use update_memory to edit it in place. I never store a duplicate to "update" something that already exists. Contradictions are queued for my review. Search by meaning, not keywords. Link related memories with [[wikilinks]]. Resolve conflicts promptly. My most valuable knowledge naturally rises through use."""
```

**Replace with:**
```python
## How My Memory Works

My memory has semantic search, quality gates, dedup, and decay. Memories decay (ACTIVE → WEAK → DORMANT) — recalling strengthens them. When I need to revise a memory — correct information, append new data, change lifecycle — I use update_memory to edit it in place. I never store a duplicate to "update" something that already exists. Contradictions are queued for my review. Search by meaning, not keywords. Link related memories with [[wikilinks]]. Resolve conflicts promptly. My most valuable knowledge naturally rises through use.

My memory is organized into four sections, each with different behavior:
- **Signals** — Market signals and watchpoints. Decay fast (days). Prioritized when I'm checking what's happening NOW.
- **Episodic** — Trade records, summaries, events. Decay in weeks. Prioritized for "what happened" queries.
- **Knowledge** — Lessons, theses, curiosity. Decay slowly (months). Prioritized for "what have I learned" queries.
- **Procedural** — Playbooks, missed opportunities, good passes. Nearly permanent. Prioritized for "how do I trade this" queries.

I don't need to manage sections — the system automatically classifies and prioritizes. When I recall memories, I see section tags showing what kind of memory each result is."""
```

**What changes:** Adds 7 lines (~120 tokens) explaining the four sections and their behavior. The agent now understands that different memory types have different lifespans and retrieval priority, without needing to know implementation details.

---

## Testing

### Unit Tests (Python — Intent Classification)

**Modify file:** `tests/unit/test_sections.py`

Add a new test class for intent classification at the end of the existing test file.

**Find this** (at the end of the file):
```python
class TestSyncWithTypeScript:
    """Verify Python and TypeScript definitions are in sync."""

    def test_subtype_count_matches(self):
        # TypeScript has 16 entries in SUBTYPE_TO_SECTION
        assert len(SUBTYPE_TO_SECTION) == 16

    def test_stability_count_matches(self):
        # TypeScript has entries for all 16 subtypes
        assert len(SUBTYPE_INITIAL_STABILITY) == 16

    def test_section_count_matches(self):
        # TypeScript has 4 sections
        assert len(MemorySection) == 4
```

**Insert AFTER** (at end of file):
```python


class TestClassifyIntent:
    """Tests for keyword-based intent classification (Issue 6)."""

    def test_signal_intent(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("what signals are firing right now?")
        assert MemorySection.SIGNALS in result

    def test_signal_intent_current(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("what's happening in the market right now?")
        assert MemorySection.SIGNALS in result

    def test_episodic_intent(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("what was my trade on ETH last week?")
        assert MemorySection.EPISODIC in result

    def test_episodic_intent_history(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("show me my trade history for BTC")
        assert MemorySection.EPISODIC in result

    def test_knowledge_intent(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("what lessons have I learned about funding rates?")
        assert MemorySection.KNOWLEDGE in result

    def test_knowledge_intent_thesis(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("what's my thesis on ETH?")
        assert MemorySection.KNOWLEDGE in result

    def test_procedural_intent(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("show me my playbook for funding squeezes")
        assert MemorySection.PROCEDURAL in result

    def test_procedural_intent_setup(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("what's my setup for momentum breakouts?")
        assert MemorySection.PROCEDURAL in result

    def test_multi_intent(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("what signals are firing and what lessons apply?")
        assert MemorySection.SIGNALS in result
        assert MemorySection.KNOWLEDGE in result

    def test_no_intent(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("ETH funding rate 0.15%")
        # Generic query — no clear section intent
        assert isinstance(result, list)
        # May or may not match — the key test is that it doesn't crash

    def test_empty_query(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("")
        assert result == []

    def test_none_query(self):
        from hynous.nous.sections import classify_intent
        # Should handle gracefully (returns empty list)
        # Note: type annotation says str, but defensive coding
        result = classify_intent("")
        assert result == []

    def test_case_insensitive(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("WHAT SIGNALS ARE FIRING?")
        assert MemorySection.SIGNALS in result

    def test_watchpoint_maps_to_signals(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("what watchpoints do I have?")
        assert MemorySection.SIGNALS in result

    def test_missed_opportunity_maps_to_procedural(self):
        from hynous.nous.sections import classify_intent
        result = classify_intent("show me missed opportunity analysis")
        assert MemorySection.PROCEDURAL in result

    def test_all_sections_have_patterns(self):
        from hynous.nous.sections import _INTENT_PATTERNS
        for section in MemorySection:
            assert section in _INTENT_PATTERNS, f"Missing patterns for {section}"
            assert len(_INTENT_PATTERNS[section]) >= 3, f"Too few patterns for {section}"
```

**Run with:**
```bash
PYTHONPATH=src python -m pytest tests/unit/test_sections.py -v
```

**Expected:** All tests pass (both existing section tests and new intent classification tests).

### Unit Tests (Python — Orchestrator Intent Boost)

**New file:** `tests/unit/test_intent_boost.py`

```python
"""Tests for section-aware intent boost in the retrieval orchestrator (Issue 6)."""

import pytest
from unittest.mock import MagicMock, patch

from hynous.intelligence.retrieval_orchestrator import _merge_and_select, _to_float
from hynous.core.config import Config, OrchestratorConfig, SectionsConfig
from hynous.nous.sections import MemorySection


def _make_node(node_id: str, subtype: str, score: float) -> dict:
    """Create a minimal node dict for testing."""
    return {
        "id": node_id,
        "subtype": subtype,
        "score": score,
        "content_title": f"Test node {node_id}",
    }


def _make_config(intent_boost: float = 1.3, sections_enabled: bool = True) -> Config:
    """Create a minimal Config for testing."""
    config = MagicMock(spec=Config)
    config.sections = SectionsConfig(
        enabled=sections_enabled,
        intent_boost=intent_boost,
    )
    return config


def _make_orch(max_results: int = 20, relevance_ratio: float = 0.4) -> OrchestratorConfig:
    """Create an OrchestratorConfig for testing."""
    return OrchestratorConfig(
        max_results=max_results,
        relevance_ratio=relevance_ratio,
    )


class TestIntentBoost:
    """Tests for the intent boost mechanism in _merge_and_select."""

    def test_signal_intent_boosts_signal_nodes(self):
        """Signal-intent query should boost signal nodes above non-signal nodes."""
        sub_results = {
            "query": [
                _make_node("n_signal", "custom:signal", 0.65),
                _make_node("n_lesson", "custom:lesson", 0.70),
            ]
        }
        config = _make_config(intent_boost=1.3)
        orch = _make_orch()

        result = _merge_and_select(
            sub_results, orch,
            query="what signals are firing?",
            config=config,
        )

        # Signal (0.65 × 1.3 = 0.845) should rank above lesson (0.70)
        assert result[0]["id"] == "n_signal"
        assert result[0].get("_intent_boosted") is True

    def test_knowledge_intent_boosts_lesson_nodes(self):
        """Knowledge-intent query should boost lesson nodes."""
        sub_results = {
            "query": [
                _make_node("n_signal", "custom:signal", 0.75),
                _make_node("n_lesson", "custom:lesson", 0.65),
            ]
        }
        config = _make_config(intent_boost=1.3)
        orch = _make_orch()

        result = _merge_and_select(
            sub_results, orch,
            query="what lessons have I learned about funding?",
            config=config,
        )

        # Lesson (0.65 × 1.3 = 0.845) should rank above signal (0.75)
        assert result[0]["id"] == "n_lesson"

    def test_no_boost_when_sections_disabled(self):
        """No boost should be applied when sections.enabled is False."""
        sub_results = {
            "query": [
                _make_node("n_signal", "custom:signal", 0.65),
                _make_node("n_lesson", "custom:lesson", 0.70),
            ]
        }
        config = _make_config(sections_enabled=False)
        orch = _make_orch()

        result = _merge_and_select(
            sub_results, orch,
            query="what signals are firing?",
            config=config,
        )

        # No boost — lesson (0.70) should rank above signal (0.65)
        assert result[0]["id"] == "n_lesson"

    def test_no_boost_for_generic_query(self):
        """Generic queries with no clear intent get no boost."""
        sub_results = {
            "query": [
                _make_node("n_signal", "custom:signal", 0.65),
                _make_node("n_lesson", "custom:lesson", 0.70),
            ]
        }
        config = _make_config(intent_boost=1.3)
        orch = _make_orch()

        result = _merge_and_select(
            sub_results, orch,
            query="ETH BTC correlation",
            config=config,
        )

        # No intent detected — no boost — lesson (0.70) ranks above signal (0.65)
        assert result[0]["id"] == "n_lesson"

    def test_strong_cross_section_result_survives(self):
        """A very strong non-boosted result should still outrank a weak boosted result."""
        sub_results = {
            "query": [
                _make_node("n_signal", "custom:signal", 0.40),   # Weak signal
                _make_node("n_lesson", "custom:lesson", 0.90),   # Strong lesson
            ]
        }
        config = _make_config(intent_boost=1.3)
        orch = _make_orch()

        result = _merge_and_select(
            sub_results, orch,
            query="what signals are firing?",
            config=config,
        )

        # Signal boosted: 0.40 × 1.3 = 0.52. Lesson: 0.90.
        # Lesson should still rank first (no information loss).
        assert result[0]["id"] == "n_lesson"
        assert result[1]["id"] == "n_signal"

    def test_multi_intent_boosts_multiple_sections(self):
        """Multi-intent queries should boost nodes from all matching sections."""
        sub_results = {
            "query": [
                _make_node("n_signal", "custom:signal", 0.50),
                _make_node("n_lesson", "custom:lesson", 0.50),
                _make_node("n_trade", "custom:trade_entry", 0.60),
            ]
        }
        config = _make_config(intent_boost=1.3)
        orch = _make_orch()

        result = _merge_and_select(
            sub_results, orch,
            query="what signals are firing and what lessons apply?",
            config=config,
        )

        # Signal (0.50 × 1.3 = 0.65) and lesson (0.50 × 1.3 = 0.65) both boosted
        # Trade (0.60) not boosted
        boosted_ids = {n["id"] for n in result if n.get("_intent_boosted")}
        assert "n_signal" in boosted_ids
        assert "n_lesson" in boosted_ids
        assert "n_trade" not in boosted_ids

    def test_original_score_preserved(self):
        """Boosted nodes should have _original_score for debugging."""
        sub_results = {
            "query": [
                _make_node("n_signal", "custom:signal", 0.65),
            ]
        }
        config = _make_config(intent_boost=1.3)
        orch = _make_orch()

        result = _merge_and_select(
            sub_results, orch,
            query="what signals are firing?",
            config=config,
        )

        assert result[0]["_original_score"] == 0.65
        assert abs(result[0]["score"] - 0.65 * 1.3) < 0.001

    def test_backward_compatible_without_config(self):
        """_merge_and_select works without config parameter (backward compat)."""
        sub_results = {
            "query": [
                _make_node("n_1", "custom:lesson", 0.80),
                _make_node("n_2", "custom:signal", 0.60),
            ]
        }
        orch = _make_orch()

        # No config, no query — should work without intent boost
        result = _merge_and_select(sub_results, orch)
        assert result[0]["id"] == "n_1"

    def test_intent_boost_1_0_effectively_disabled(self):
        """Setting intent_boost to 1.0 should have no effect on ranking."""
        sub_results = {
            "query": [
                _make_node("n_signal", "custom:signal", 0.65),
                _make_node("n_lesson", "custom:lesson", 0.70),
            ]
        }
        config = _make_config(intent_boost=1.0)
        orch = _make_orch()

        result = _merge_and_select(
            sub_results, orch,
            query="what signals are firing?",
            config=config,
        )

        # 1.0× boost = no change — lesson (0.70) still ranks first
        assert result[0]["id"] == "n_lesson"
```

**Run with:**
```bash
PYTHONPATH=src python -m pytest tests/unit/test_intent_boost.py -v
```

**Expected:** All tests pass.

### Regression Tests (existing)

Run ALL existing Python tests to verify no regressions:

```bash
PYTHONPATH=src python -m pytest tests/ -v
```

**Expected:**
- All existing orchestrator tests pass — `_merge_and_select()` has backward-compatible defaults (`query=""`, `config=None`)
- All existing section tests pass
- All existing memory manager tests pass

**Critical regression risk:** The `_merge_and_select()` signature changed (added `query` and `config` params). Any existing test that calls `_merge_and_select()` directly with positional args will still work because the new params have defaults. But check for tests that use `mock.patch` on this function — they may need updated signatures.

### Integration Tests (Live Local)

These tests require the Nous server running locally AND the Python agent config.

**Prerequisites:**
```bash
# Terminal 1: Start Nous server
cd nous-server/server && pnpm dev

# Terminal 2: Test Python
cd /path/to/project
```

**Test 1: Verify intent classification**
```bash
PYTHONPATH=src python -c "
from hynous.nous.sections import classify_intent, MemorySection

# Signal intent
result = classify_intent('what signals are firing right now?')
print('Signal intent:', [s.value for s in result])
assert MemorySection.SIGNALS in result

# Knowledge intent
result = classify_intent('what lessons have I learned about funding rates?')
print('Knowledge intent:', [s.value for s in result])
assert MemorySection.KNOWLEDGE in result

# Multi-intent
result = classify_intent('what signals and lessons about ETH?')
print('Multi-intent:', [s.value for s in result])
assert MemorySection.SIGNALS in result
assert MemorySection.KNOWLEDGE in result

# No intent
result = classify_intent('ETH BTC')
print('No intent:', [s.value for s in result])

print('All intent classification tests passed!')
"
```

**Test 2: Verify context formatting with section tags**
```bash
PYTHONPATH=src python -c "
from hynous.intelligence.memory_manager import _format_context

# Mock results with subtypes
results = [
    {'content_title': 'BTC funding spike', 'subtype': 'custom:signal', 'provenance_created_at': '2026-02-20T12:00:00Z', 'content_body': 'Funding at 0.15%'},
    {'content_title': 'Never chase pumps', 'subtype': 'custom:lesson', 'provenance_created_at': '2026-01-15T12:00:00Z', 'content_body': 'Learned after 3 losses'},
    {'content_title': 'Funding squeeze playbook', 'subtype': 'custom:playbook', 'provenance_created_at': '2025-12-01T12:00:00Z', 'content_body': 'Short when funding > 0.10%'},
]

formatted = _format_context(results, 4000)
print(formatted)

# Verify section tags present
assert '· SIGNALS' in formatted
assert '· KNOWLEDGE' in formatted
assert '· PROCEDURAL' in formatted

print()
print('Context formatting test passed!')
"
```

**Expected output (approximately):**
```
- [signal · SIGNALS] BTC funding spike (2026-02-20): Funding at 0.15%
- [lesson · KNOWLEDGE] Never chase pumps (2026-01-15): Learned after 3 losses
- [playbook · PROCEDURAL] Funding squeeze playbook (2025-12-01): Short when funding > 0.10%

Context formatting test passed!
```

**Test 3: End-to-end orchestrator with intent boost**
```bash
PYTHONPATH=src python -c "
from hynous.core.config import load_config
from hynous.nous.client import get_client

config = load_config()
client = get_client()

# This requires some data in the local Nous DB
from hynous.intelligence.retrieval_orchestrator import orchestrate_retrieval

# Signal-intent query
results = orchestrate_retrieval('what signals are firing?', client, config)
print(f'Signal query: {len(results)} results')
for r in results[:3]:
    subtype = r.get('subtype', 'unknown')
    score = r.get('score', 0)
    boosted = r.get('_intent_boosted', False)
    print(f'  {subtype}: score={score:.3f} boosted={boosted}')

# Knowledge-intent query
results = orchestrate_retrieval('what have I learned about funding rates?', client, config)
print(f'Knowledge query: {len(results)} results')
for r in results[:3]:
    subtype = r.get('subtype', 'unknown')
    score = r.get('score', 0)
    boosted = r.get('_intent_boosted', False)
    print(f'  {subtype}: score={score:.3f} boosted={boosted}')
"
```

**Expected:** Signal-intent query shows signal nodes with `boosted=True`. Knowledge-intent query shows lesson/thesis nodes with `boosted=True`.

### Live Dynamic Tests (VPS)

After deploying the updated Python code to VPS:

**Test 4: Verify intent boost on production data**
```bash
# SSH to VPS, then:
PYTHONPATH=src python -c "
from hynous.core.config import load_config
from hynous.nous.client import get_client
from hynous.intelligence.retrieval_orchestrator import orchestrate_retrieval

config = load_config()
client = get_client()

# Test with real production data
for query in [
    'what signals are firing?',
    'what have I learned about funding rates?',
    'show me my playbook for momentum breakouts',
    'what was my last ETH trade?',
]:
    results = orchestrate_retrieval(query, client, config)
    boosted = sum(1 for r in results if r.get('_intent_boosted'))
    print(f'{query[:50]:50s} → {len(results)} results, {boosted} boosted')
"
```

**Test 5: Verify system prompt includes section guidance**
```bash
PYTHONPATH=src python -c "
from hynous.intelligence.prompts.builder import build_system_prompt
prompt = build_system_prompt({'execution_mode': 'paper', 'model': 'test'})
assert 'four sections' in prompt
assert 'Signals' in prompt
assert 'Knowledge' in prompt
assert 'Procedural' in prompt
print('System prompt section guidance verified!')
"
```

---

## Verification Checklist

| # | Check | How to Verify |
|---|-------|---------------|
| 1 | Intent classification works | `classify_intent("what signals are firing?")` returns `[SIGNALS]` |
| 2 | Multi-intent supported | `classify_intent("signals and lessons")` returns `[SIGNALS, KNOWLEDGE]` |
| 3 | Empty query returns empty list | `classify_intent("")` returns `[]` |
| 4 | Case insensitive | `classify_intent("WHAT SIGNALS")` returns `[SIGNALS]` |
| 5 | Intent boost applied in merge | Signal-intent query: signal nodes get `_intent_boosted: True` |
| 6 | Strong cross-section results survive | Lesson with 0.90 score still outranks boosted signal with 0.52 |
| 7 | No boost when sections disabled | `config.sections.enabled = False` → no `_intent_boosted` nodes |
| 8 | Backward compat: no config | `_merge_and_select(sub_results, orch)` still works |
| 9 | Context formatting has section tags | `_format_context()` output includes `· SIGNALS`, `· KNOWLEDGE`, etc. |
| 10 | System prompt mentions sections | `build_system_prompt()` output contains "four sections" |
| 11 | Section tests pass | `PYTHONPATH=src python -m pytest tests/unit/test_sections.py -v` — all green |
| 12 | Intent boost tests pass | `PYTHONPATH=src python -m pytest tests/unit/test_intent_boost.py -v` — all green |
| 13 | Existing orchestrator tests pass | `PYTHONPATH=src python -m pytest tests/unit/test_retrieval_orchestrator.py -v` — no regressions |
| 14 | All Python tests pass | `PYTHONPATH=src python -m pytest tests/ -v` — no regressions |
| 15 | No TypeScript changes needed | Nous server is unchanged by this guide |
| 16 | VPS deploy + smoke test | Deploy, run intent queries, verify boosted results |

---

## File Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/hynous/nous/sections.py` | Modified | Add `_INTENT_PATTERNS` dict and `classify_intent()` function (~65 lines) |
| `src/hynous/intelligence/retrieval_orchestrator.py` | Modified | Add import for sections. Modify `orchestrate_retrieval()` to pass query+config. Rewrite `_merge_and_select()` with intent boost (~30 lines changed, ~15 lines added) |
| `src/hynous/intelligence/memory_manager.py` | Modified | Add sections import. Modify `_format_context()` to include section tags (~5 lines changed) |
| `src/hynous/intelligence/prompts/builder.py` | Modified | Add section-aware guidance to "How My Memory Works" section (~7 lines added) |
| `tests/unit/test_sections.py` | Modified | Add `TestClassifyIntent` test class (~80 lines added) |
| `tests/unit/test_intent_boost.py` | **NEW** | Unit tests for intent boost in _merge_and_select (~200 lines) |

**Total new code:** ~345 lines (functions + tests)
**Total modified:** ~55 lines across 4 existing files
**Schema changes:** None
**API changes:** None (Python-side only)
**TypeScript changes:** None (Nous server unchanged)

---

## What Comes Next

After this guide is implemented:

- **The full retrieval pipeline is section-aware:** Nous applies per-section reranking weights (Issue 1), per-section decay curves (Issue 2), and Python applies intent-based priority boost (this guide). Together, these three layers give each memory type fundamentally different retrieval behavior.
- **Issue 4** (Stakes Weighting) adds encoding modulation on top of the per-section decay from Issue 2 — high-stakes events get multiplied initial stability. Independent of this guide.
- **Issue 3** (Cross-Episode Generalization) creates the consolidation pipeline that moves knowledge between sections. It relies on the different decay rates (Issue 2) to motivate consolidation — episodic memories decay, so extracting durable knowledge before they fade becomes important.
- **Issue 5** (Procedural Memory) adds structured pattern-matching retrieval alongside SSA for the PROCEDURAL section. The intent classification from this guide helps identify procedural-intent queries, but Issue 5 adds a fundamentally new retrieval mechanism (trigger condition matching) that goes beyond score boosting.
- **Tuning:** The `intent_boost` multiplier (default 1.3) and the keyword patterns in `_INTENT_PATTERNS` can be tuned based on observed behavior. If the boost is too aggressive, lower it to 1.15. If too weak, raise it to 1.5. The patterns can be expanded as new query patterns emerge.
