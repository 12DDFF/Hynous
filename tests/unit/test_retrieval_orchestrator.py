"""Tests for the Intelligent Retrieval Orchestrator.

Tests decomposition strategies, quality gate logic, merge/select algorithm,
and config loading.
"""

import sys
import types
import pytest
from unittest.mock import MagicMock, patch

# Stub out litellm before importing hynous.intelligence (its __init__ imports Agent → litellm)
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception

from hynous.intelligence.retrieval_orchestrator import (
    _classify,
    _decompose,
    _reformulate,
    _merge_and_select,
    _search_with_quality,
    _broaden_filters,
    _to_float,
    orchestrate_retrieval,
)
from hynous.core.config import OrchestratorConfig, load_config


# ====================================================================
# Decomposition Tests
# ====================================================================

class TestDecompose:
    """Tests for _decompose() — Step 2 of the pipeline."""

    # --- Strategy 1: Conjunction + question word split ---

    def test_conjunction_and_how(self):
        qcs = {"disqualifier_category": "D4"}
        parts = _decompose("What's BTC doing and how is SOL performing?", qcs)
        assert len(parts) == 2
        assert "BTC" in parts[0]
        assert "SOL" in parts[1]

    def test_conjunction_and_why(self):
        qcs = {"disqualifier_category": "D4"}
        parts = _decompose("What's my BTC thesis and why did ETH dump?", qcs)
        assert len(parts) == 2
        assert "BTC" in parts[0]
        assert "ETH" in parts[1]

    def test_conjunction_and_what(self):
        qcs = {"disqualifier_category": "D4"}
        parts = _decompose("Check funding rates and what about open interest?", qcs)
        assert len(parts) == 2

    def test_conjunction_and_when(self):
        qcs = {"disqualifier_category": "D4"}
        parts = _decompose("What's BTC at and when did SOL last pump?", qcs)
        assert len(parts) == 2

    # --- Strategy 2: Multiple question split ---

    def test_multiple_questions(self):
        qcs = {"disqualifier_category": "D4"}
        parts = _decompose("What's BTC at? Did my SOL trade close?", qcs)
        assert len(parts) == 2
        assert "BTC" in parts[0]
        assert "SOL" in parts[1]

    def test_three_questions(self):
        qcs = {"disqualifier_category": "D4"}
        parts = _decompose("What's BTC? How's ETH? Where's SOL?", qcs)
        assert len(parts) == 3

    # --- Strategy 3: "Also" split ---

    def test_also_split(self):
        qcs = {"disqualifier_category": "D4"}
        parts = _decompose("Check BTC, also look at ETH funding", qcs)
        assert len(parts) == 2
        assert "BTC" in parts[0]
        assert "ETH" in parts[1]

    # --- Strategy 4: Entity-based fallback ---

    def test_entity_and_split(self):
        qcs = {"disqualifier_category": "D4", "entity": "BTC"}
        parts = _decompose("BTC and SOL analysis", qcs)
        # Should use strategy 4 (entity "and" split)
        assert len(parts) == 2

    # --- D1 queries (ambiguous, may be compound) ---

    def test_d1_simple_returns_single(self):
        """D1 query with no compound structure stays as single query."""
        qcs = {"disqualifier_category": "D1"}
        parts = _decompose("How does funding relate to price?", qcs)
        assert parts == ["How does funding relate to price?"]

    def test_d1_compound_decomposes(self):
        """D1 query with compound structure should decompose."""
        qcs = {"disqualifier_category": "D1"}
        parts = _decompose("What is BTC doing and how is ETH performing?", qcs)
        assert len(parts) == 2
        assert "BTC" in parts[0]
        assert "ETH" in parts[1]

    def test_d1_multi_question_decomposes(self):
        """D1 query with multiple question marks should decompose."""
        qcs = {"disqualifier_category": "D1"}
        parts = _decompose("What is BTC at? How is ETH doing?", qcs)
        assert len(parts) == 2

    # --- Non-decomposable queries ---

    def test_non_compound_category_returns_single(self):
        qcs = {"disqualifier_category": "D2"}
        parts = _decompose("How does funding relate to price?", qcs)
        assert parts == ["How does funding relate to price?"]

    def test_no_qcs_returns_single(self):
        parts = _decompose("What's BTC doing?", {})
        assert parts == ["What's BTC doing?"]

    def test_not_disqualified_returns_single(self):
        qcs = {"disqualified": False, "query_type": "LOOKUP"}
        parts = _decompose("What's BTC doing?", qcs)
        assert parts == ["What's BTC doing?"]

    # --- Edge cases ---

    def test_very_long_query_no_decompose(self):
        qcs = {"disqualifier_category": "D4"}
        long_query = "x" * 501
        parts = _decompose(long_query, qcs)
        assert len(parts) == 1

    def test_max_sub_queries_cap(self):
        qcs = {"disqualifier_category": "D4"}
        query = "A? B? C? D? E?"
        parts = _decompose(query, qcs, max_parts=3)
        assert len(parts) <= 3

    def test_tiny_parts_filtered(self):
        qcs = {"disqualifier_category": "D4"}
        # Parts < 3 chars should be filtered
        parts = _decompose("ok? no? What's BTC doing?", qcs)
        for p in parts:
            assert len(p) >= 3


# ====================================================================
# Reformulation Tests
# ====================================================================

class TestReformulate:
    """Tests for _reformulate() — query simplification for retry."""

    def test_strips_whats(self):
        result = _reformulate("What's BTC's support level?", {})
        assert result is not None
        assert "what" not in result.lower()
        assert "BTC" in result

    def test_strips_how_is(self):
        result = _reformulate("How is SOL performing?", {})
        assert result is not None
        assert "how" not in result.lower()

    def test_strips_tell_me_about(self):
        result = _reformulate("Tell me about ETH funding rates", {})
        assert result is not None
        assert "tell me about" not in result.lower()

    def test_entity_fallback(self):
        # If simplification doesn't change query, use entity
        result = _reformulate("BTC", {"entity": "BTC"})
        # Already simplified, should return entity
        assert result == "BTC"

    def test_returns_none_for_unstrippable(self):
        # Query that can't be simplified and no entity
        result = _reformulate("BTC", {})
        assert result is None

    def test_strips_trailing_question_mark(self):
        result = _reformulate("What's the funding rate?", {})
        assert result is not None
        assert not result.endswith("?")


# ====================================================================
# Quality Gate Tests
# ====================================================================

class TestSearchWithQuality:
    """Tests for _search_with_quality() — quality threshold + retry."""

    def _make_orch(self, **overrides):
        defaults = {
            "quality_threshold": 0.20,
            "max_retries": 1,
            "search_limit_per_query": 10,
        }
        defaults.update(overrides)
        return OrchestratorConfig(**defaults)

    def test_passes_when_score_above_threshold(self):
        client = MagicMock()
        client.search_full.return_value = {
            "data": [{"id": "n1", "score": 0.50, "content_title": "BTC thesis"}]
        }
        orch = self._make_orch()
        results = _search_with_quality(client, "BTC thesis", orch, {}, {})
        assert len(results) == 1
        assert results[0]["score"] == 0.50

    def test_retries_when_score_below_threshold(self):
        client = MagicMock()
        # First call: low score. Second call (retry): higher score
        client.search_full.side_effect = [
            {"data": [{"id": "n1", "score": 0.10}]},
            {"data": [{"id": "n2", "score": 0.40}]},
        ]
        orch = self._make_orch()
        results = _search_with_quality(
            client, "What's BTC doing?", orch, {"entity": "BTC"}, {},
        )
        assert len(results) == 1
        assert results[0]["score"] == 0.40
        assert client.search_full.call_count == 2

    def test_keeps_original_if_retry_worse(self):
        client = MagicMock()
        # First call: low score. Second call (retry): even lower
        client.search_full.side_effect = [
            {"data": [{"id": "n1", "score": 0.15}]},
            {"data": [{"id": "n2", "score": 0.05}]},
        ]
        orch = self._make_orch()
        results = _search_with_quality(
            client, "What's BTC doing?", orch, {"entity": "BTC"}, {},
        )
        assert results[0]["score"] == 0.15

    def test_no_retry_when_max_retries_zero(self):
        client = MagicMock()
        client.search_full.return_value = {
            "data": [{"id": "n1", "score": 0.05}]
        }
        orch = self._make_orch(max_retries=0)
        results = _search_with_quality(client, "BTC", orch, {}, {})
        assert client.search_full.call_count == 1

    def test_retries_on_empty_results(self):
        client = MagicMock()
        client.search_full.side_effect = [
            {"data": []},
            {"data": [{"id": "n1", "score": 0.30}]},
        ]
        orch = self._make_orch()
        results = _search_with_quality(
            client, "What's BTC doing?", orch, {"entity": "BTC"}, {},
        )
        assert len(results) == 1
        assert client.search_full.call_count == 2

    def test_accepts_empty_after_failed_retry(self):
        client = MagicMock()
        client.search_full.side_effect = [
            {"data": []},
            {"data": []},
        ]
        orch = self._make_orch()
        results = _search_with_quality(
            client, "What's BTC doing?", orch, {"entity": "BTC"}, {},
        )
        assert results == []


# ====================================================================
# Merge & Select Tests
# ====================================================================

class TestMergeAndSelect:
    """Tests for _merge_and_select() — dedup, dynamic cutoff, coverage."""

    def _make_orch(self, **overrides):
        defaults = {
            "relevance_ratio": 0.4,
            "max_results": 8,
        }
        defaults.update(overrides)
        return OrchestratorConfig(**defaults)

    def test_deduplicates_by_node_id(self):
        sub_results = {
            "q1": [{"id": "n1", "score": 0.50}, {"id": "n2", "score": 0.40}],
            "q2": [{"id": "n1", "score": 0.60}, {"id": "n3", "score": 0.30}],
        }
        orch = self._make_orch()
        merged = _merge_and_select(sub_results, orch)
        ids = [n["id"] for n in merged]
        assert ids.count("n1") == 1
        # n1 should have the higher score (0.60)
        n1 = next(n for n in merged if n["id"] == "n1")
        assert n1["score"] == 0.60

    def test_sorts_by_score_descending(self):
        sub_results = {
            "q1": [
                {"id": "n1", "score": 0.30},
                {"id": "n2", "score": 0.60},
                {"id": "n3", "score": 0.10},
            ],
        }
        orch = self._make_orch()
        merged = _merge_and_select(sub_results, orch)
        scores = [n["score"] for n in merged]
        assert scores == sorted(scores, reverse=True)

    def test_dynamic_cutoff(self):
        # Top score = 0.60, cutoff = 0.60 * 0.4 = 0.24
        # n3 (score=0.10) should be cut
        sub_results = {
            "q1": [
                {"id": "n1", "score": 0.60},
                {"id": "n2", "score": 0.40},
                {"id": "n3", "score": 0.10},
            ],
        }
        orch = self._make_orch()
        merged = _merge_and_select(sub_results, orch)
        ids = [n["id"] for n in merged]
        assert "n1" in ids
        assert "n2" in ids
        assert "n3" not in ids

    def test_coverage_guarantee(self):
        # q2's best result (0.10) is below cutoff (0.60 * 0.4 = 0.24)
        # but coverage guarantee should include it anyway
        sub_results = {
            "q1": [{"id": "n1", "score": 0.60}, {"id": "n2", "score": 0.50}],
            "q2": [{"id": "n3", "score": 0.10}],
        }
        orch = self._make_orch()
        merged = _merge_and_select(sub_results, orch)
        ids = [n["id"] for n in merged]
        assert "n3" in ids  # Coverage guarantee

    def test_hard_cap_max_results(self):
        sub_results = {
            "q1": [{"id": f"n{i}", "score": 0.90 - i * 0.01} for i in range(15)],
        }
        orch = self._make_orch(max_results=5)
        merged = _merge_and_select(sub_results, orch)
        assert len(merged) <= 5

    def test_empty_input_returns_empty(self):
        orch = self._make_orch()
        assert _merge_and_select({}, orch) == []

    def test_all_empty_sub_results(self):
        sub_results = {"q1": [], "q2": []}
        orch = self._make_orch()
        assert _merge_and_select(sub_results, orch) == []

    def test_minimum_one_result(self):
        sub_results = {"q1": [{"id": "n1", "score": 0.01}]}
        orch = self._make_orch()
        merged = _merge_and_select(sub_results, orch)
        assert len(merged) >= 1

    def test_handles_string_scores(self):
        sub_results = {
            "q1": [{"id": "n1", "score": "0.50"}, {"id": "n2", "score": "0.30"}],
        }
        orch = self._make_orch()
        merged = _merge_and_select(sub_results, orch)
        assert len(merged) >= 1


# ====================================================================
# Helper Tests
# ====================================================================

class TestBroadenFilters:
    """Tests for _broaden_filters()."""

    def test_drops_subtype(self):
        kwargs = {"type": "concept", "subtype": "custom:thesis", "lifecycle": "ACTIVE"}
        broadened = _broaden_filters(kwargs)
        assert "subtype" not in broadened
        assert broadened["type"] == "concept"
        assert broadened["lifecycle"] == "ACTIVE"

    def test_returns_same_if_no_subtype(self):
        kwargs = {"type": "concept", "lifecycle": "ACTIVE"}
        result = _broaden_filters(kwargs)
        assert result is kwargs  # Identity check — same object

    def test_empty_kwargs(self):
        result = _broaden_filters({})
        assert result == {}


class TestToFloat:
    """Tests for _to_float()."""

    def test_int(self):
        assert _to_float(5) == 5.0

    def test_float(self):
        assert _to_float(0.42) == 0.42

    def test_string(self):
        assert _to_float("0.75") == 0.75

    def test_none(self):
        assert _to_float(None) == 0.0

    def test_invalid_string(self):
        assert _to_float("not_a_number") == 0.0


# ====================================================================
# Config Tests
# ====================================================================

class TestOrchestratorConfig:
    """Tests for OrchestratorConfig dataclass and YAML loading."""

    def test_default_values(self):
        orch = OrchestratorConfig()
        assert orch.enabled is True
        assert orch.quality_threshold == 0.20
        assert orch.relevance_ratio == 0.4
        assert orch.max_results == 8
        assert orch.max_sub_queries == 4
        assert orch.max_retries == 1
        assert orch.timeout_seconds == 3.0
        assert orch.search_limit_per_query == 10

    def test_loads_from_yaml(self):
        config = load_config()
        orch = config.orchestrator
        assert orch.enabled is True
        assert orch.quality_threshold == 0.20
        assert orch.max_results == 8
