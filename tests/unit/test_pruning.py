"""Tests for memory pruning tools (analyze_memory + batch_prune)."""

import sys
import types
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone, timedelta

# Stub litellm before importing hynous.intelligence
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception

from hynous.intelligence.tools.pruning import (
    _score_component,
    _generate_group_label,
    _format_analysis,
    _format_prune_result,
    handle_analyze_memory,
    handle_batch_prune,
)


# =============================================================================
# Mock Helpers
# =============================================================================

def _make_node(id, title="Test", subtype="custom:thesis", lifecycle="ACTIVE",
               retrievability=0.8, access_count=5, created_days_ago=7):
    """Create a mock node dict matching the get_graph() response shape."""
    created = (datetime.now(timezone.utc) - timedelta(days=created_days_ago)).isoformat()
    return {
        "id": id,
        "type": "concept",
        "subtype": subtype,
        "title": title,
        "summary": None,
        "retrievability": retrievability,
        "lifecycle": lifecycle,
        "access_count": access_count,
        "created_at": created,
    }


def _make_edge(id, source, target, type="relates_to", strength=0.5):
    """Create a mock edge dict matching the get_graph() response shape."""
    return {
        "id": id,
        "source": source,
        "target": target,
        "type": type,
        "strength": strength,
    }


def _make_full_node(id, title="Test", subtype="custom:thesis", lifecycle="ACTIVE",
                    access_count=5):
    """Create a mock node dict matching the get_node() response shape (for batch_prune)."""
    return {
        "id": id,
        "content_title": title,
        "subtype": subtype,
        "state_lifecycle": lifecycle,
        "neural_access_count": access_count,
    }


def _build_adjacency(node_ids, edges):
    """Build adjacency dict from node IDs and edges for _score_component tests."""
    from collections import defaultdict
    adjacency = defaultdict(set)
    for nid in node_ids:
        adjacency[nid]  # Ensure every node has an entry
    for edge in edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if src and tgt:
            adjacency[src].add(tgt)
            adjacency[tgt].add(src)
    return adjacency


# =============================================================================
# TestScoreComponent
# =============================================================================

class TestScoreComponent:
    """Tests for _score_component() — staleness scoring algorithm."""

    def test_fresh_active_nodes_score_low(self):
        """All ACTIVE, high retrievability, recent -> staleness < 0.3."""
        nodes = [
            _make_node("n1", retrievability=0.9, lifecycle="ACTIVE", access_count=15, created_days_ago=2),
            _make_node("n2", retrievability=0.85, lifecycle="ACTIVE", access_count=10, created_days_ago=3),
        ]
        node_map = {n["id"]: n for n in nodes}
        adjacency = _build_adjacency(["n1", "n2"], [_make_edge("e1", "n1", "n2")])

        result = _score_component(["n1", "n2"], node_map, adjacency)
        assert result["staleness"] < 0.3

    def test_dormant_old_nodes_score_high(self):
        """All DORMANT, low retrievability, old -> staleness > 0.7."""
        nodes = [
            _make_node("n1", retrievability=0.05, lifecycle="DORMANT", access_count=1, created_days_ago=120),
            _make_node("n2", retrievability=0.1, lifecycle="DORMANT", access_count=0, created_days_ago=100),
        ]
        node_map = {n["id"]: n for n in nodes}
        adjacency = _build_adjacency(["n1", "n2"], [_make_edge("e1", "n1", "n2")])

        result = _score_component(["n1", "n2"], node_map, adjacency)
        assert result["staleness"] > 0.7

    def test_mixed_lifecycle_scores_moderate(self):
        """Mix of ACTIVE and DORMANT -> moderate staleness."""
        nodes = [
            _make_node("n1", retrievability=0.7, lifecycle="ACTIVE", access_count=8, created_days_ago=20),
            _make_node("n2", retrievability=0.2, lifecycle="DORMANT", access_count=2, created_days_ago=60),
        ]
        node_map = {n["id"]: n for n in nodes}
        adjacency = _build_adjacency(["n1", "n2"], [_make_edge("e1", "n1", "n2")])

        result = _score_component(["n1", "n2"], node_map, adjacency)
        assert 0.3 <= result["staleness"] <= 0.7

    def test_high_access_count_reduces_staleness(self):
        """High access_count -> lower staleness."""
        # High access
        nodes_high = [
            _make_node("n1", retrievability=0.5, lifecycle="ACTIVE", access_count=25, created_days_ago=30),
        ]
        node_map_high = {n["id"]: n for n in nodes_high}
        adjacency_high = _build_adjacency(["n1"], [])

        # Low access
        nodes_low = [
            _make_node("n1", retrievability=0.5, lifecycle="ACTIVE", access_count=0, created_days_ago=30),
        ]
        node_map_low = {n["id"]: n for n in nodes_low}
        adjacency_low = _build_adjacency(["n1"], [])

        result_high = _score_component(["n1"], node_map_high, adjacency_high)
        result_low = _score_component(["n1"], node_map_low, adjacency_low)
        assert result_high["staleness"] < result_low["staleness"]

    def test_zero_retrievability_scores_high(self):
        """retrievability=0 -> high staleness contribution."""
        nodes = [
            _make_node("n1", retrievability=0.0, lifecycle="ACTIVE", access_count=5, created_days_ago=10),
        ]
        node_map = {n["id"]: n for n in nodes}
        adjacency = _build_adjacency(["n1"], [])

        result = _score_component(["n1"], node_map, adjacency)
        # retrievability component alone is 0.35 (weight) * 1.0 (1 - 0) = 0.35
        assert result["staleness"] >= 0.35

    def test_single_node_component(self):
        """Works correctly with 1 node."""
        nodes = [_make_node("n1")]
        node_map = {n["id"]: n for n in nodes}
        adjacency = _build_adjacency(["n1"], [])

        result = _score_component(["n1"], node_map, adjacency)
        assert result["node_count"] == 1
        assert result["edge_count"] == 0
        assert 0.0 <= result["staleness"] <= 1.0

    def test_empty_component_returns_zero(self):
        """Empty node list -> staleness 0.0."""
        result = _score_component(["nonexistent"], {}, {})
        assert result["staleness"] == 0.0
        assert result["label"] == "Empty"


# =============================================================================
# TestGenerateGroupLabel
# =============================================================================

class TestGenerateGroupLabel:
    """Tests for _generate_group_label()."""

    def test_trade_nodes_use_symbol(self):
        """Nodes with trade subtypes extract symbol from title."""
        nodes = [
            {"title": "LONG BTC @ $68K", "subtype": "custom:trade_entry"},
            {"title": "CLOSED BTC @ $72K", "subtype": "custom:trade_close"},
        ]
        label = _generate_group_label(nodes, ["custom:trade_entry", "custom:trade_close"])
        assert "BTC" in label
        assert "trade lifecycle" in label

    def test_non_trade_uses_dominant_subtype(self):
        """Non-trade nodes use most common subtype."""
        nodes = [
            {"title": "Funding thesis", "subtype": "custom:thesis"},
            {"title": "Another thesis", "subtype": "custom:thesis"},
            {"title": "A lesson", "subtype": "custom:lesson"},
        ]
        label = _generate_group_label(nodes, ["custom:thesis", "custom:thesis", "custom:lesson"])
        assert "thesis" in label
        assert "group:" in label

    def test_single_node_label(self):
        """Single node shows 'subtype: title'."""
        nodes = [{"title": "My thesis", "subtype": "custom:thesis"}]
        label = _generate_group_label(nodes, ["custom:thesis"])
        assert label == "thesis: My thesis"

    def test_long_title_truncated(self):
        """Titles over 40 chars get truncated."""
        long_title = "A" * 50
        nodes = [{"title": long_title, "subtype": "custom:thesis"}]
        label = _generate_group_label(nodes, ["custom:thesis"])
        assert len(label) < 60  # subtype: + truncated title
        assert "..." in label


# =============================================================================
# TestFormatAnalysis
# =============================================================================

class TestFormatAnalysis:
    """Tests for _format_analysis()."""

    def test_empty_groups_healthy_message(self):
        """No stale groups -> healthy message."""
        result = _format_analysis([], 50, 30, 10, 20, 15)
        assert "healthy" in result.lower()
        assert "50 nodes" in result
        assert "30 edges" in result

    def test_groups_show_all_metadata(self):
        """Groups include staleness, retrievability, lifecycle, node list."""
        groups = [{
            "staleness": 0.75,
            "label": "SOL trade lifecycle",
            "node_count": 3,
            "edge_count": 2,
            "avg_retrievability": 0.12,
            "days_since_active": 45.0,
            "lifecycle_breakdown": {"ACTIVE": 0, "WEAK": 1, "DORMANT": 2},
            "nodes": [
                {"id": "n1", "title": "LONG SOL", "subtype": "custom:trade_entry", "lifecycle": "DORMANT"},
                {"id": "n2", "title": "CLOSED SOL", "subtype": "custom:trade_close", "lifecycle": "DORMANT"},
                {"id": "n3", "title": "SOL thesis", "subtype": "custom:thesis", "lifecycle": "WEAK"},
            ],
        }]
        result = _format_analysis(groups, 100, 50, 20, 30, 25)
        assert "SOL trade lifecycle" in result
        assert "0.75" in result
        assert "0.12" in result
        assert "45d ago" in result
        assert "2 dormant" in result
        assert "1 weak" in result

    def test_includes_node_ids_in_brackets(self):
        """Each node line ends with [node_id]."""
        groups = [{
            "staleness": 0.5,
            "label": "Test group",
            "node_count": 1,
            "edge_count": 0,
            "avg_retrievability": 0.5,
            "days_since_active": 10.0,
            "lifecycle_breakdown": {"ACTIVE": 1, "WEAK": 0, "DORMANT": 0},
            "nodes": [
                {"id": "n_abc123", "title": "Test node", "subtype": "custom:thesis", "lifecycle": "ACTIVE"},
            ],
        }]
        result = _format_analysis(groups, 10, 5, 5, 5, 10)
        assert "[n_abc123]" in result


# =============================================================================
# TestFormatPruneResult
# =============================================================================

class TestFormatPruneResult:
    """Tests for _format_prune_result()."""

    def test_all_succeeded(self):
        """All nodes pruned -> clean summary."""
        succeeded = [
            {"id": "n1", "title": "Node 1", "action": "archived"},
            {"id": "n2", "title": "Node 2", "action": "archived"},
        ]
        result = _format_prune_result(succeeded, [], [], "archive", 50)
        assert "2/2" in result
        assert "archived" in result.lower()
        assert "Node 1" in result
        assert "Node 2" in result

    def test_with_skipped_and_failed(self):
        """Mix of succeeded/skipped/failed -> all sections shown."""
        succeeded = [{"id": "n1", "title": "Good", "action": "archived"}]
        skipped = [{"id": "n2", "title": "Skip", "reason": "already DORMANT"}]
        failed = [{"id": "n3", "reason": "not found"}]
        result = _format_prune_result(succeeded, skipped, failed, "archive", 50)
        assert "1/3" in result
        assert "Skipped (1)" in result
        assert "Failed (1)" in result
        assert "already DORMANT" in result
        assert "not found" in result

    def test_delete_shows_edge_count(self):
        """Delete action shows edges_removed."""
        succeeded = [{"id": "n1", "title": "Node", "action": "deleted", "edges_removed": 3}]
        result = _format_prune_result(succeeded, [], [], "delete", 30)
        assert "3 edges" in result
        assert "Deleted" in result


# =============================================================================
# TestHandleAnalyzeMemory (mocked NousClient)
# =============================================================================

class TestHandleAnalyzeMemory:
    """Tests for handle_analyze_memory() with mocked NousClient."""

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_returns_analysis_for_stale_graph(self, mock_get_client, _mock_trace):
        """Mock get_graph() with stale nodes -> formatted output."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        mock_client.get_graph.return_value = {
            "nodes": [
                _make_node("n1", "LONG SOL", "custom:trade_entry", "DORMANT", 0.05, 1, 100),
                _make_node("n2", "CLOSED SOL", "custom:trade_close", "DORMANT", 0.08, 0, 95),
                _make_node("n3", "Fresh thesis", "custom:thesis", "ACTIVE", 0.95, 20, 1),
            ],
            "edges": [
                _make_edge("e1", "n1", "n2"),
            ],
        }

        result = handle_analyze_memory(min_staleness=0.3)
        assert "SOL" in result
        assert "Group" in result or "group" in result

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_empty_graph_returns_message(self, mock_get_client, _mock_trace):
        """No nodes -> 'No memories found'."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_client.get_graph.return_value = {"nodes": [], "edges": []}

        result = handle_analyze_memory()
        assert "No memories found" in result

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_min_staleness_filters_groups(self, mock_get_client, _mock_trace):
        """High threshold filters out less-stale groups."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        # Create two connected groups:
        # Group 1: stale (DORMANT, old, low retrievability)
        # Group 2: fresh (ACTIVE, recent, high retrievability)
        mock_client.get_graph.return_value = {
            "nodes": [
                _make_node("n1", "Old node A", "custom:thesis", "DORMANT", 0.05, 0, 120),
                _make_node("n2", "Old node B", "custom:thesis", "DORMANT", 0.1, 1, 100),
                _make_node("n3", "Fresh node A", "custom:thesis", "ACTIVE", 0.95, 20, 1),
                _make_node("n4", "Fresh node B", "custom:thesis", "ACTIVE", 0.9, 15, 2),
            ],
            "edges": [
                _make_edge("e1", "n1", "n2"),
                _make_edge("e2", "n3", "n4"),
            ],
        }

        # With high threshold, only the stale group should appear
        result = handle_analyze_memory(min_staleness=0.7)
        assert "Old node" in result
        # Fresh group should not be in the output at staleness >= 0.7
        assert "Fresh node" not in result or "healthy" in result

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_include_isolated_flag(self, mock_get_client, _mock_trace):
        """With flag, isolated nodes appear; without, they don't."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        mock_client.get_graph.return_value = {
            "nodes": [
                _make_node("n1", "Isolated stale", "custom:thesis", "DORMANT", 0.05, 0, 120),
            ],
            "edges": [],
        }

        # Without include_isolated: isolated node excluded from connected groups
        result_without = handle_analyze_memory(min_staleness=0.0, include_isolated=False)
        # The stale isolated node shouldn't appear in connected groups analysis
        # It should report 0 connected groups
        assert "healthy" in result_without.lower() or "0 connected groups" in result_without

        # With include_isolated: isolated node included
        result_with = handle_analyze_memory(min_staleness=0.0, include_isolated=True)
        assert "Isolated" in result_with

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_nous_connection_error(self, mock_get_client, _mock_trace):
        """NousClient raises -> error message, not crash."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_client.get_graph.side_effect = ConnectionError("Connection refused")

        result = handle_analyze_memory()
        assert "Error" in result
        assert "Connection refused" in result


# =============================================================================
# TestHandleBatchPrune (mocked NousClient)
# =============================================================================

class TestHandleBatchPrune:
    """Tests for handle_batch_prune() with mocked NousClient."""

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_archive_sets_dormant(self, mock_get_client, _mock_trace):
        """Archive calls update_node with state_lifecycle='DORMANT'."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        mock_client.get_node.return_value = _make_full_node("n1", "Test Node", lifecycle="ACTIVE")
        mock_client.update_node.return_value = {}

        result = handle_batch_prune(node_ids=["n1"], action="archive")
        mock_client.update_node.assert_called_once_with("n1", state_lifecycle="DORMANT")
        assert "Archived" in result
        assert "Test Node" in result

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_delete_removes_edges_then_node(self, mock_get_client, _mock_trace):
        """Delete calls get_edges, delete_edge for each, then delete_node."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        mock_client.get_node.return_value = _make_full_node("n1", "Test Node", lifecycle="WEAK", access_count=2)
        mock_client.get_edges.return_value = [
            {"id": "e1", "source_id": "n1", "target_id": "n2"},
            {"id": "e2", "source_id": "n3", "target_id": "n1"},
        ]
        mock_client.delete_edge.return_value = True
        mock_client.delete_node.return_value = True

        result = handle_batch_prune(node_ids=["n1"], action="delete")
        mock_client.get_edges.assert_called_once_with("n1", direction="both")
        assert mock_client.delete_edge.call_count == 2
        mock_client.delete_node.assert_called_once_with("n1")
        assert "Deleted" in result
        assert "2 edges" in result

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_skips_already_dormant_on_archive(self, mock_get_client, _mock_trace):
        """Already DORMANT nodes are skipped."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        mock_client.get_node.return_value = _make_full_node("n1", "Already dormant", lifecycle="DORMANT")

        result = handle_batch_prune(node_ids=["n1"], action="archive")
        mock_client.update_node.assert_not_called()
        assert "Skipped" in result
        assert "already DORMANT" in result

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_safety_skips_high_value_active(self, mock_get_client, _mock_trace):
        """ACTIVE + access_count > 10 -> skipped on delete."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        mock_client.get_node.return_value = _make_full_node(
            "n1", "Important node", lifecycle="ACTIVE", access_count=15,
        )

        result = handle_batch_prune(node_ids=["n1"], action="delete")
        mock_client.delete_node.assert_not_called()
        assert "Skipped" in result
        assert "ACTIVE with 15 accesses" in result

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_not_found_reported_as_failed(self, mock_get_client, _mock_trace):
        """Missing node_id -> failed list."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        mock_client.get_node.return_value = None

        result = handle_batch_prune(node_ids=["n_missing"], action="archive")
        assert "Failed" in result
        assert "not found" in result

    def test_empty_node_ids_returns_error(self):
        """Empty list -> error message."""
        result = handle_batch_prune(node_ids=[], action="archive")
        assert "Error" in result
        assert "empty" in result.lower()

    def test_invalid_action_returns_error(self):
        """Bad action string -> error message."""
        result = handle_batch_prune(node_ids=["n1"], action="destroy")
        assert "Error" in result
        assert "destroy" in result
