"""
Intelligent Retrieval Orchestrator — Multi-Pass Memory Search

Transforms single-shot memory retrieval into a multi-pass research process:
  1. CLASSIFY — QCS pre-check to detect compound queries (D4)
  2. DECOMPOSE — Split compound queries into atomic sub-queries
  3. PARALLEL SEARCH — Execute sub-queries concurrently via ThreadPoolExecutor
  4. QUALITY GATE — Score-based threshold with one retry on failure
  5. MERGE & SELECT — Deduplicate, re-rank, dynamic cutoff

Design constraints:
  - Fast path (simple queries, ~80% of traffic) adds only ~5ms (classify call)
  - No Nous server changes — all orchestration lives Python-side
  - Degrades gracefully: classify failure → single search, timeout → partial results
  - Thread-safe: NousClient uses requests.Session (safe for concurrent calls)
"""

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from ..core.config import Config, OrchestratorConfig
from ..nous.client import NousClient

logger = logging.getLogger(__name__)

# Question words used for conjunction-based splitting
_CONJUNCTION_SPLIT_RE = re.compile(
    r'\band\s+(?:what|when|where|who|how|why)\b',
    re.IGNORECASE,
)

# "also" split pattern
_ALSO_SPLIT_RE = re.compile(r'\balso\b', re.IGNORECASE)

# Question words to strip during reformulation
_QUESTION_WORDS_RE = re.compile(
    r"^(?:what(?:'s|'s| is| are| was| were| do| does| did)?|"
    r"how(?:'s|'s| is| are| was| were| do| does| did| much| many)?|"
    r"why(?:'s|'s| is| are| was| were| do| does| did)?|"
    r"when(?:'s|'s| is| are| was| were| do| does| did)?|"
    r"where(?:'s|'s| is| are| was| were| do| does| did)?|"
    r"who(?:'s|'s| is| are| was| were)?|"
    r"can you|could you|do you|tell me about|show me|"
    r"is there|are there|did|does|has|have)\s+",
    re.IGNORECASE,
)


def orchestrate_retrieval(
    query: str,
    client: NousClient,
    config: Config,
    type_filter: Optional[str] = None,
    subtype_filter: Optional[str] = None,
    lifecycle_filter: Optional[str] = None,
    time_range: Optional[dict] = None,
    cluster_ids: list[str] | None = None,
) -> list[dict]:
    """Main entry point. Runs the 5-step retrieval pipeline.

    Args:
        query: The search query text.
        client: NousClient instance.
        config: Full app config (uses config.orchestrator).
        type_filter: Optional node type filter (passed through to each search).
        subtype_filter: Optional subtype filter.
        lifecycle_filter: Optional lifecycle filter.
        time_range: Optional time range filter dict.
        cluster_ids: Optional cluster ID filter.

    Returns:
        List of node dicts (with score, breakdown, primary_signal) ranked by
        relevance. May be empty if no results pass quality gate.
    """
    orch = config.orchestrator

    if not orch.enabled:
        # Fallback: single search, no orchestration
        return client.search(
            query=query,
            type=type_filter,
            subtype=subtype_filter,
            lifecycle=lifecycle_filter,
            limit=orch.max_results,
            time_range=time_range,
            cluster_ids=cluster_ids,
        )

    # Build common search kwargs (filters passed to every sub-query)
    search_kwargs = {}
    if type_filter:
        search_kwargs["type"] = type_filter
    if subtype_filter:
        search_kwargs["subtype"] = subtype_filter
    if lifecycle_filter:
        search_kwargs["lifecycle"] = lifecycle_filter
    if time_range:
        search_kwargs["time_range"] = time_range
    if cluster_ids:
        search_kwargs["cluster_ids"] = cluster_ids

    _start = time.monotonic()

    # ---- Step 1: CLASSIFY ----
    qcs_result = _classify(client, query)

    # ---- Step 2: DECOMPOSE ----
    sub_queries = _decompose(query, qcs_result, max_parts=orch.max_sub_queries)

    # ---- Steps 3-4: PARALLEL SEARCH + QUALITY GATE ----
    if len(sub_queries) == 1:
        # Single query — skip ThreadPoolExecutor overhead
        sub_results = {
            sub_queries[0]: _search_with_quality(
                client, sub_queries[0], orch, qcs_result, search_kwargs,
            )
        }
    else:
        sub_results = _parallel_search(
            client, sub_queries, orch, qcs_result, search_kwargs,
        )

    # ---- Step 5: MERGE & SELECT ----
    merged = _merge_and_select(sub_results, orch)

    _elapsed = int((time.monotonic() - _start) * 1000)
    logger.info(
        "Orchestrator: %d sub-queries → %d results in %dms (query=%r)",
        len(sub_queries), len(merged), _elapsed, query[:60],
    )

    return merged


# ====================================================================
# Step 1: CLASSIFY
# ====================================================================

def _classify(client: NousClient, query: str) -> dict:
    """Call QCS classify endpoint to determine query characteristics.

    Returns QCS metadata dict or empty dict on failure.
    Lightweight call (~5ms to localhost, no DB access).
    """
    try:
        result = client.classify_query(query)
        logger.debug(
            "QCS classify: query=%r → disqualified=%s category=%s type=%s",
            query[:50],
            result.get("disqualified"),
            result.get("disqualifier_category"),
            result.get("query_type"),
        )
        return result
    except Exception as e:
        logger.debug("QCS classify failed, treating as simple query: %s", e)
        return {}


# ====================================================================
# Step 2: DECOMPOSE
# ====================================================================

def _decompose(query: str, qcs_result: dict, max_parts: int = 4) -> list[str]:
    """Split compound queries into atomic sub-queries.

    Triggers on D4 (compound query) and D1 (ambiguous, often compound)
    classifications. The QCS sometimes classifies multi-entity compound
    queries as D1 instead of D4, so we attempt decomposition for both.

    Falls back to single query if decomposition fails or produces < 2 parts.
    """
    # Only decompose D4 compound or D1 ambiguous queries
    category = qcs_result.get("disqualifier_category")
    if category not in ("D4", "D1"):
        return [query]

    # Skip decomposition for very long queries (likely pasted content)
    if len(query) > 500:
        return [query]

    parts = []

    # Strategy 1: Conjunction + question word split ("and what/when/where/who/how/why")
    parts = _CONJUNCTION_SPLIT_RE.split(query)
    if len(parts) >= 2:
        # Re-attach the question word to each part after the first
        matches = list(_CONJUNCTION_SPLIT_RE.finditer(query))
        rebuilt = [parts[0].strip().rstrip(",").strip()]
        for i, match in enumerate(matches):
            word = match.group(0).split()[-1]  # Extract "what", "how", etc.
            part_text = parts[i + 1].strip() if i + 1 < len(parts) else ""
            if part_text:
                rebuilt.append(f"{word} {part_text}".strip())
        parts = [p for p in rebuilt if len(p) >= 3]
        if len(parts) >= 2:
            return parts[:max_parts]

    # Strategy 2: Multiple question split (split on "?" boundaries)
    if query.count("?") >= 2:
        segments = query.split("?")
        parts = [s.strip() for s in segments if s.strip() and len(s.strip()) >= 3]
        if len(parts) >= 2:
            return parts[:max_parts]

    # Strategy 3: "also" split
    also_parts = _ALSO_SPLIT_RE.split(query)
    if len(also_parts) >= 2:
        parts = [p.strip().rstrip(",").strip() for p in also_parts if p.strip() and len(p.strip()) >= 3]
        if len(parts) >= 2:
            return parts[:max_parts]

    # Strategy 4: Entity-based fallback — use QCS entity + original query
    entity = qcs_result.get("entity")
    if entity and " and " in query.lower():
        # Try to extract multiple entities from "X and Y" pattern
        and_parts = re.split(r'\band\b', query, flags=re.IGNORECASE)
        parts = [p.strip().rstrip(",").strip() for p in and_parts if p.strip() and len(p.strip()) >= 3]
        if len(parts) >= 2:
            return parts[:max_parts]

    # Decomposition failed — fall back to single query
    return [query]


# ====================================================================
# Steps 3-4: PARALLEL SEARCH + QUALITY GATE
# ====================================================================

def _parallel_search(
    client: NousClient,
    sub_queries: list[str],
    orch: OrchestratorConfig,
    qcs_result: dict,
    search_kwargs: dict,
) -> dict[str, list[dict]]:
    """Execute sub-queries concurrently and return results per sub-query.

    If the overall timeout is hit, returns whatever results have completed so far.
    """
    results: dict[str, list[dict]] = {}

    with ThreadPoolExecutor(max_workers=len(sub_queries)) as pool:
        futures = {
            pool.submit(
                _search_with_quality, client, sq, orch, qcs_result, search_kwargs,
            ): sq
            for sq in sub_queries
        }
        try:
            for future in as_completed(futures, timeout=orch.timeout_seconds):
                sq = futures[future]
                try:
                    results[sq] = future.result()
                except Exception as e:
                    logger.warning("Sub-query failed: %r — %s", sq, e)
                    results[sq] = []
        except TimeoutError:
            logger.warning(
                "Orchestrator timeout (%.1fs): returning %d/%d sub-query results",
                orch.timeout_seconds, len(results), len(sub_queries),
            )

    return results


def _search_with_quality(
    client: NousClient,
    query: str,
    orch: OrchestratorConfig,
    qcs_result: dict,
    search_kwargs: dict,
) -> list[dict]:
    """Search with quality gating and optional retry.

    Returns list of node dicts that passed quality threshold,
    or best available results if threshold was never met.

    Retry strategy (one attempt):
    1. Reformulate the query text (strip question words / entity-only)
    2. Broaden type filter: drop subtype filter if present
    """
    results = _do_search(client, query, orch.search_limit_per_query, search_kwargs)

    if not results:
        # No results — try one reformulation with broadened filters
        if orch.max_retries > 0:
            reformulated = _reformulate(query, qcs_result)
            retry_kwargs = _broaden_filters(search_kwargs)
            retry_query = reformulated or query
            if reformulated or retry_kwargs is not search_kwargs:
                logger.debug("Reformulating (empty): %r → %r", query[:50], retry_query[:50])
                results = _do_search(client, retry_query, orch.search_limit_per_query, retry_kwargs)
        return results

    # Check quality threshold
    top_score = _to_float(results[0].get("score", 0))

    if top_score >= orch.quality_threshold:
        return results  # Quality is good

    # Below threshold — try one reformulation with broadened filters
    if orch.max_retries > 0:
        reformulated = _reformulate(query, qcs_result)
        retry_kwargs = _broaden_filters(search_kwargs)
        retry_query = reformulated or query

        if reformulated or retry_kwargs is not search_kwargs:
            logger.debug(
                "Quality gate: top_score=%.3f < threshold=%.2f, retrying: %r → %r",
                top_score, orch.quality_threshold, query[:50], retry_query[:50],
            )
            retry_results = _do_search(
                client, retry_query, orch.search_limit_per_query, retry_kwargs,
            )
            if retry_results:
                retry_top = _to_float(retry_results[0].get("score", 0))
                if retry_top > top_score:
                    return retry_results  # Retry was better

    # Accept whatever we have (don't return nothing just because threshold wasn't met)
    return results


def _do_search(
    client: NousClient,
    query: str,
    limit: int,
    search_kwargs: dict,
) -> list[dict]:
    """Execute a single search call via search_full() and return data array."""
    try:
        response = client.search_full(query=query, limit=limit, **search_kwargs)
        return response.get("data", [])
    except Exception as e:
        logger.warning("Search failed for query=%r: %s", query[:50], e)
        return []


def _broaden_filters(search_kwargs: dict) -> dict:
    """Drop subtype filter to broaden retry search.

    Returns a new dict without 'subtype' if it was present,
    or the same dict (identity) if no broadening was needed.
    """
    if "subtype" in search_kwargs:
        broadened = {k: v for k, v in search_kwargs.items() if k != "subtype"}
        return broadened
    return search_kwargs


def _to_float(value) -> float:
    """Safely convert a score value to float."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


# ====================================================================
# REFORMULATION
# ====================================================================

def _reformulate(query: str, qcs_result: dict) -> Optional[str]:
    """Generate a reformulated query for retry when quality is low.

    Strategies (in order):
    1. Strip question words, keep nouns/entities
    2. Entity-only fallback if QCS extracted an entity
    """
    # Strategy 1: Simplify — strip question words and trailing punctuation
    simplified = _QUESTION_WORDS_RE.sub("", query).strip().rstrip("?").strip()
    if simplified and len(simplified) >= 3 and simplified.lower() != query.lower():
        return simplified

    # Strategy 2: Entity-only fallback
    entity = qcs_result.get("entity")
    if entity and len(entity) >= 2:
        return entity

    return None


# ====================================================================
# Step 5: MERGE & SELECT
# ====================================================================

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
