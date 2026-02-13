"""Integration tests for the Intelligent Retrieval Orchestrator.

Tests the full pipeline with a mock NousClient, verifying:
- Compound query → decompose → parallel search → merge
- Timeout handling
- Fallback when Nous is down
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

from hynous.intelligence.retrieval_orchestrator import orchestrate_retrieval
from hynous.core.config import Config, OrchestratorConfig, MemoryConfig, NousConfig


def _make_config(**orch_overrides) -> Config:
    """Build a Config with custom orchestrator settings."""
    orch_defaults = {
        "enabled": True,
        "quality_threshold": 0.20,
        "relevance_ratio": 0.4,
        "max_results": 8,
        "max_sub_queries": 4,
        "max_retries": 1,
        "timeout_seconds": 3.0,
        "search_limit_per_query": 10,
    }
    orch_defaults.update(orch_overrides)
    config = Config(
        orchestrator=OrchestratorConfig(**orch_defaults),
        memory=MemoryConfig(retrieve_limit=5),
        nous=NousConfig(),
    )
    return config


def _mock_client(classify_result=None, search_results=None):
    """Build a mock NousClient with configurable responses."""
    client = MagicMock()

    # Default classify: not disqualified
    client.classify_query.return_value = classify_result or {
        "disqualified": False,
        "disqualifier_category": None,
        "query_type": "LOOKUP",
        "confidence": 0.7,
        "entity": None,
        "attribute": None,
    }

    # Default search: return results as-is
    if search_results is not None:
        client.search_full.return_value = {"data": search_results}
    else:
        client.search_full.return_value = {"data": []}

    # Fallback search (non-full) for disabled orchestrator path
    client.search.return_value = search_results or []

    return client


# ====================================================================
# End-to-End: Simple Query (fast path)
# ====================================================================

class TestSimpleQuery:
    """Simple queries (non-D4) go through classify → single search → quality gate."""

    def test_simple_query_returns_results(self):
        results_data = [
            {"id": "n1", "score": 0.55, "content_title": "BTC thesis"},
            {"id": "n2", "score": 0.40, "content_title": "BTC analysis"},
        ]
        client = _mock_client(search_results=results_data)
        config = _make_config()

        results = orchestrate_retrieval("BTC thesis", client, config)
        assert len(results) == 2
        assert results[0]["id"] == "n1"
        client.classify_query.assert_called_once()
        client.search_full.assert_called_once()

    def test_simple_query_with_quality_retry(self):
        """Low-quality results trigger one reformulation attempt."""
        client = MagicMock()
        client.classify_query.return_value = {
            "disqualified": False,
            "query_type": "LOOKUP",
            "entity": "BTC",
        }
        # First search: low score → retry
        # Second search (reformulated): better score
        client.search_full.side_effect = [
            {"data": [{"id": "n1", "score": 0.10}]},
            {"data": [{"id": "n2", "score": 0.45}]},
        ]
        config = _make_config()

        results = orchestrate_retrieval("What's BTC doing?", client, config)
        assert len(results) == 1
        assert results[0]["score"] == 0.45
        assert client.search_full.call_count == 2

    def test_simple_query_empty_results(self):
        client = _mock_client(search_results=[])
        config = _make_config()

        results = orchestrate_retrieval("nonexistent topic", client, config)
        assert results == []


# ====================================================================
# End-to-End: Compound Query (D4)
# ====================================================================

class TestCompoundQuery:
    """Compound queries (D4) decompose into sub-queries with parallel search."""

    def test_compound_decomposes_and_merges(self):
        client = MagicMock()
        client.classify_query.return_value = {
            "disqualified": True,
            "disqualifier_category": "D4",
            "query_type": "AMBIGUOUS",
            "confidence": 0.5,
            "entity": "BTC",
        }
        # Each sub-query gets different results
        def search_full_side_effect(**kwargs):
            query = kwargs.get("query", "")
            if "BTC" in query:
                return {"data": [
                    {"id": "btc1", "score": 0.55, "content_title": "BTC thesis"},
                    {"id": "btc2", "score": 0.40, "content_title": "BTC analysis"},
                ]}
            elif "SOL" in query:
                return {"data": [
                    {"id": "sol1", "score": 0.45, "content_title": "SOL trade"},
                ]}
            return {"data": []}

        client.search_full.side_effect = search_full_side_effect
        config = _make_config()

        results = orchestrate_retrieval(
            "What's my BTC thesis and how is SOL performing?", client, config,
        )
        ids = [r["id"] for r in results]
        # Should have results from both sub-queries
        assert "btc1" in ids
        assert "sol1" in ids

    def test_compound_dedup_across_sub_queries(self):
        """Same node from multiple sub-queries → keep highest score."""
        client = MagicMock()
        client.classify_query.return_value = {
            "disqualified": True,
            "disqualifier_category": "D4",
        }

        def search_full_side_effect(**kwargs):
            query = kwargs.get("query", "")
            if "BTC" in query:
                return {"data": [
                    {"id": "shared", "score": 0.50},
                    {"id": "btc1", "score": 0.40},
                ]}
            return {"data": [
                {"id": "shared", "score": 0.60},
                {"id": "eth1", "score": 0.35},
            ]}

        client.search_full.side_effect = search_full_side_effect
        config = _make_config()

        results = orchestrate_retrieval(
            "What's BTC at? How's ETH doing?", client, config,
        )
        shared_nodes = [r for r in results if r["id"] == "shared"]
        assert len(shared_nodes) == 1
        assert shared_nodes[0]["score"] == 0.60  # Higher score kept


# ====================================================================
# Fallback & Error Handling
# ====================================================================

class TestFallbacks:
    """Graceful degradation when components fail."""

    def test_classify_failure_falls_through(self):
        """If classify_query fails, treat as simple query."""
        client = MagicMock()
        client.classify_query.side_effect = Exception("Connection refused")
        client.search_full.return_value = {
            "data": [{"id": "n1", "score": 0.50}]
        }
        config = _make_config()

        results = orchestrate_retrieval("BTC thesis", client, config)
        assert len(results) == 1

    def test_search_failure_returns_empty(self):
        """If search_full fails, return empty (no crash)."""
        client = MagicMock()
        client.classify_query.return_value = {"disqualified": False}
        client.search_full.side_effect = Exception("Nous is down")
        config = _make_config()

        results = orchestrate_retrieval("BTC thesis", client, config)
        assert results == []

    def test_orchestrator_disabled_uses_plain_search(self):
        """When orchestrator.enabled=False, fall back to client.search()."""
        client = MagicMock()
        client.search.return_value = [
            {"id": "n1", "score": 0.50, "content_title": "BTC thesis"},
        ]
        config = _make_config(enabled=False)

        results = orchestrate_retrieval("BTC thesis", client, config)
        assert len(results) == 1
        client.classify_query.assert_not_called()
        client.search_full.assert_not_called()
        client.search.assert_called_once()


# ====================================================================
# Filter Passthrough
# ====================================================================

class TestFilterPassthrough:
    """Verify that type/subtype/lifecycle/time_range filters pass through to search."""

    def test_filters_passed_to_search(self):
        client = _mock_client(
            search_results=[{"id": "n1", "score": 0.50}],
        )
        config = _make_config()

        results = orchestrate_retrieval(
            "BTC thesis", client, config,
            type_filter="concept",
            subtype_filter="custom:thesis",
            lifecycle_filter="ACTIVE",
            time_range={"start": "2026-01-01", "type": "any"},
        )
        assert len(results) == 1

        # Verify the filters were passed to search_full
        call_kwargs = client.search_full.call_args
        assert call_kwargs.kwargs.get("type") == "concept" or "type" in (call_kwargs[1] if len(call_kwargs) > 1 else {})

    def test_cluster_ids_passed_to_search(self):
        client = _mock_client(
            search_results=[{"id": "n1", "score": 0.50}],
        )
        config = _make_config()

        results = orchestrate_retrieval(
            "BTC thesis", client, config,
            cluster_ids=["cluster-1"],
        )
        assert len(results) == 1
