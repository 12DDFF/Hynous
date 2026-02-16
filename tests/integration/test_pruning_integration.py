"""Integration tests for memory pruning tools (analyze_memory + batch_prune).

These tests mock the NousClient at the HTTP level and test the full flow.
"""

import sys
import types
import time
import pytest
from unittest.mock import MagicMock, patch, call
from datetime import datetime, timezone, timedelta

# Stub litellm before importing hynous.intelligence
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception

from hynous.intelligence.tools.pruning import (
    handle_analyze_memory,
    handle_batch_prune,
)


# =============================================================================
# Helpers
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


# =============================================================================
# Integration Tests
# =============================================================================

class TestAnalyzeThenPruneFlow:
    """Full E2E: analyze -> review -> prune."""

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_analyze_then_prune_flow(self, mock_get_client, _mock_trace):
        """Create mock graph with stale + fresh groups -> analyze -> batch_prune."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        # Build graph: one stale SOL trade lifecycle + one fresh BTC thesis group
        mock_client.get_graph.return_value = {
            "nodes": [
                # Stale group: SOL trade lifecycle (old, dormant, low retrievability)
                _make_node("n1", "LONG SOL @ $140", "custom:trade_entry", "DORMANT", 0.05, 1, 100),
                _make_node("n2", "MODIFIED LONG SOL", "custom:trade_modify", "DORMANT", 0.08, 0, 95),
                _make_node("n3", "CLOSED SOL @ $155", "custom:trade_close", "DORMANT", 0.03, 0, 90),
                # Fresh group: BTC thesis (recent, active, high retrievability)
                _make_node("n4", "BTC breakout thesis", "custom:thesis", "ACTIVE", 0.95, 18, 2),
                _make_node("n5", "BTC funding analysis", "custom:lesson", "ACTIVE", 0.88, 12, 3),
            ],
            "edges": [
                _make_edge("e1", "n1", "n2"),
                _make_edge("e2", "n1", "n3"),
                _make_edge("e3", "n4", "n5"),
            ],
        }

        # Phase 1: Analyze
        analysis = handle_analyze_memory(min_staleness=0.3)
        assert "SOL" in analysis
        assert "Group" in analysis

        # Phase 2: Agent decides to prune the stale SOL group
        stale_ids = ["n1", "n2", "n3"]

        # Set up get_node mocks for batch_prune
        def mock_get_node(nid):
            node_map = {
                "n1": _make_full_node("n1", "LONG SOL @ $140", "custom:trade_entry", "DORMANT", 1),
                "n2": _make_full_node("n2", "MODIFIED LONG SOL", "custom:trade_modify", "DORMANT", 0),
                "n3": _make_full_node("n3", "CLOSED SOL @ $155", "custom:trade_close", "DORMANT", 0),
            }
            return node_map.get(nid)

        mock_client.get_node.side_effect = mock_get_node
        mock_client.update_node.return_value = {}

        # Phase 3: Archive the stale group
        # All 3 are already DORMANT → all skipped (correct behavior)
        prune_result = handle_batch_prune(node_ids=stale_ids, action="archive")
        assert "0/3" in prune_result
        assert "Skipped" in prune_result
        assert "already DORMANT" in prune_result


class TestLargeGraphPerformance:
    """Performance test with large graph."""

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_large_graph_performance(self, mock_get_client, _mock_trace):
        """Mock graph with 200+ nodes -> analyze completes in < 2 seconds."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        # Create 250 nodes in 50 groups of 5
        nodes = []
        edges = []
        for group_idx in range(50):
            for node_idx in range(5):
                nid = f"n_{group_idx}_{node_idx}"
                nodes.append(_make_node(
                    nid,
                    f"Node {group_idx}-{node_idx}",
                    "custom:thesis",
                    "DORMANT" if group_idx < 25 else "ACTIVE",
                    retrievability=0.1 if group_idx < 25 else 0.9,
                    access_count=1 if group_idx < 25 else 15,
                    created_days_ago=100 if group_idx < 25 else 5,
                ))
                # Connect nodes within each group
                if node_idx > 0:
                    prev_nid = f"n_{group_idx}_{node_idx - 1}"
                    edges.append(_make_edge(f"e_{group_idx}_{node_idx}", prev_nid, nid))

        mock_client.get_graph.return_value = {"nodes": nodes, "edges": edges}

        start = time.monotonic()
        result = handle_analyze_memory(min_staleness=0.3)
        elapsed = time.monotonic() - start

        assert elapsed < 2.0, f"analyze_memory took {elapsed:.2f}s, expected < 2s"
        assert "Group" in result


class TestAnalyzeWithClusters:
    """Graph with cluster memberships — components still detected correctly."""

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_analyze_with_clusters(self, mock_get_client, _mock_trace):
        """Cluster memberships don't affect connected component detection."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        # Graph with clusters — analyze_memory only uses nodes + edges
        mock_client.get_graph.return_value = {
            "nodes": [
                _make_node("n1", "Thesis A", "custom:thesis", "DORMANT", 0.1, 1, 60),
                _make_node("n2", "Thesis B", "custom:thesis", "DORMANT", 0.15, 2, 55),
                _make_node("n3", "Lesson C", "custom:lesson", "ACTIVE", 0.9, 10, 3),
            ],
            "edges": [
                _make_edge("e1", "n1", "n2"),
            ],
            "clusters": [
                {"id": "cl1", "name": "Theses", "icon": None, "pinned": False},
            ],
            "memberships": [
                {"cluster_id": "cl1", "node_id": "n1", "weight": 1.0},
                {"cluster_id": "cl1", "node_id": "n2", "weight": 1.0},
            ],
        }

        result = handle_analyze_memory(min_staleness=0.3)
        # n1 and n2 should be in one connected group, n3 is isolated
        assert "Thesis A" in result or "thesis group" in result


class TestPruneWithPartialFailures:
    """Some nodes fail to delete -> succeeded + failed both reported."""

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_prune_with_partial_failures(self, mock_get_client, _mock_trace):
        """Some nodes fail to delete -> both succeeded and failed reported."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        # n1 exists, n2 not found, n3 raises exception on delete
        def mock_get_node(nid):
            if nid == "n1":
                return _make_full_node("n1", "Good node", lifecycle="WEAK", access_count=2)
            if nid == "n2":
                return None
            if nid == "n3":
                return _make_full_node("n3", "Bad node", lifecycle="WEAK", access_count=1)
            return None

        mock_client.get_node.side_effect = mock_get_node
        mock_client.get_edges.side_effect = lambda nid, **kw: (
            [] if nid == "n1" else (_ for _ in ()).throw(RuntimeError("edge fetch failed"))
        )
        mock_client.delete_node.return_value = True

        result = handle_batch_prune(node_ids=["n1", "n2", "n3"], action="delete")
        assert "1/3" in result  # Only n1 succeeded
        assert "Failed" in result
        assert "not found" in result  # n2


class TestAnalyzeIsolatedNodes:
    """Graph with many isolated nodes -> include_isolated toggle works."""

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_analyze_isolated_nodes(self, mock_get_client, _mock_trace):
        """include_isolated=True shows isolated nodes, False excludes them."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        mock_client.get_graph.return_value = {
            "nodes": [
                _make_node("n1", "Isolated stale 1", "custom:thesis", "DORMANT", 0.05, 0, 120),
                _make_node("n2", "Isolated stale 2", "custom:lesson", "DORMANT", 0.08, 1, 100),
                _make_node("n3", "Isolated fresh", "custom:thesis", "ACTIVE", 0.95, 20, 1),
            ],
            "edges": [],
        }

        # Without isolated: all are isolated, no connected groups
        result_without = handle_analyze_memory(min_staleness=0.0, include_isolated=False)
        assert "healthy" in result_without.lower() or "0 connected groups" in result_without

        # With isolated: stale isolated nodes appear
        result_with = handle_analyze_memory(min_staleness=0.3, include_isolated=True)
        assert "Isolated" in result_with
        assert "stale 1" in result_with or "stale 2" in result_with


class TestLargeBatchPruneConcurrent:
    """Concurrent batch prune with many nodes — full E2E flow."""

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_analyze_then_bulk_archive_50_nodes(self, mock_get_client, _mock_trace):
        """Analyze graph with 50 stale + 10 fresh -> archive all 50 stale concurrently."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        # Build graph: 50 stale ACTIVE nodes in 10 groups + 10 fresh nodes
        nodes = []
        edges = []
        stale_ids = []
        for g in range(10):
            for i in range(5):
                nid = f"stale_{g}_{i}"
                nodes.append(_make_node(
                    nid, f"Old trade {g}-{i}", "custom:trade_entry", "ACTIVE",
                    retrievability=0.05, access_count=1, created_days_ago=120,
                ))
                stale_ids.append(nid)
                if i > 0:
                    edges.append(_make_edge(f"e_{g}_{i}", f"stale_{g}_{i-1}", nid))

        for i in range(10):
            nid = f"fresh_{i}"
            nodes.append(_make_node(
                nid, f"Active thesis {i}", "custom:thesis", "ACTIVE",
                retrievability=0.95, access_count=20, created_days_ago=2,
            ))

        mock_client.get_graph.return_value = {"nodes": nodes, "edges": edges}

        # Phase 1: Analyze
        analysis = handle_analyze_memory(min_staleness=0.3)
        assert "Group" in analysis

        # Phase 2: Bulk archive all 50 stale nodes
        def mock_get_node(nid):
            if nid.startswith("stale_"):
                return _make_full_node(nid, f"Old trade {nid}", "custom:trade_entry", "ACTIVE", 1)
            return None

        mock_client.get_node.side_effect = mock_get_node
        mock_client.update_node.return_value = {}

        start = time.monotonic()
        result = handle_batch_prune(node_ids=stale_ids, action="archive")
        elapsed = time.monotonic() - start

        assert "50/50" in result
        assert mock_client.update_node.call_count == 50
        # Concurrent execution should be fast even with 50 nodes
        assert elapsed < 5.0, f"Batch archive of 50 nodes took {elapsed:.2f}s"

    @patch("hynous.intelligence.tools.pruning.get_active_trace", return_value=None)
    @patch("hynous.nous.client.get_client")
    def test_bulk_delete_with_edge_cleanup(self, mock_get_client, _mock_trace):
        """Delete 30 nodes concurrently, each with edges — all cleaned up."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        ids = [f"n{i}" for i in range(30)]
        mock_client.get_node.side_effect = lambda nid: _make_full_node(
            nid, f"Node {nid}", "custom:thesis", "WEAK", 2,
        )
        mock_client.get_edges.side_effect = lambda nid, **kw: [
            {"id": f"{nid}_e1"}, {"id": f"{nid}_e2"},
        ]
        mock_client.delete_edge.return_value = True
        mock_client.delete_node.return_value = True

        result = handle_batch_prune(node_ids=ids, action="delete")
        assert "30/30" in result
        assert mock_client.delete_node.call_count == 30
        assert mock_client.delete_edge.call_count == 60  # 30 * 2 edges each
