"""Integration tests for trade retrieval fixes.

Tests full flows: store → recall → verify thesis and time filtering.
Follows pattern from test_orchestrator_integration.py.
"""

import json
import sys
import types
from unittest.mock import MagicMock, patch

import pytest

# Stub out litellm before importing hynous.intelligence (its __init__ imports Agent → litellm)
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception


def _make_trade_close_node(
    node_id="n_close1",
    symbol="BTC",
    side="long",
    entry_px=68000,
    exit_px=70000,
    pnl_usd=200,
    pnl_pct=2.9,
    created_at="2026-02-14T12:00:00+00:00",
):
    """Build a mock trade_close node dict."""
    return {
        "id": node_id,
        "type": "concept",
        "subtype": "custom:trade_close",
        "content_title": f"CLOSED {side.upper()} {symbol} @ ${exit_px:,.0f}",
        "content_body": json.dumps({
            "text": f"Closed {side} {symbol}",
            "signals": {
                "action": "close",
                "symbol": symbol,
                "side": side,
                "entry": entry_px,
                "exit": exit_px,
                "pnl_usd": pnl_usd,
                "pnl_pct": pnl_pct,
                "close_type": "full",
                "size_usd": 1000,
            },
        }),
        "created_at": created_at,
    }


def _make_trade_entry_node(
    node_id="n_entry1",
    symbol="BTC",
    thesis="Funding reset + support held at 67K",
    created_at="2026-02-13T12:00:00+00:00",
):
    """Build a mock trade_entry node dict."""
    return {
        "id": node_id,
        "type": "concept",
        "subtype": "custom:trade_entry",
        "content_title": f"LONG {symbol} @ $68,000",
        "content_body": json.dumps({
            "text": f"Thesis: {thesis}\nEntry: $68,000\nStop: $66,500\nTarget: $72,000",
        }),
        "created_at": created_at,
    }


class TestTradeRetrievalFlow:
    """Full flow: store → recall → verify thesis and time filtering."""

    def test_recall_trade_by_browse_returns_entry(self):
        """recall_memory(mode='browse', memory_type='trade') returns trade_entry nodes."""
        with patch("hynous.nous.client.get_client") as mock_get_client:
            mock_client = MagicMock()
            entry_node = _make_trade_entry_node()
            mock_client.list_nodes.return_value = [entry_node]
            mock_get_client.return_value = mock_client

            from hynous.intelligence.tools.memory import handle_recall_memory

            result = handle_recall_memory(mode="browse", memory_type="trade")

            # Verify list_nodes was called with correct subtype (normalized)
            call_kwargs = mock_client.list_nodes.call_args
            assert call_kwargs.kwargs.get("subtype") == "custom:trade_entry"

            # Verify output contains node content
            assert "LONG BTC" in result

    def test_trade_stats_with_time_filter(self):
        """get_trade_stats with time range passes filters to list_nodes."""
        import hynous.core.trade_analytics as ta
        ta._cached_stats = None
        ta._cache_time = 0

        with patch("hynous.core.trade_analytics.fetch_trade_history") as mock_fetch:
            mock_fetch.return_value = []

            from hynous.intelligence.tools.trade_stats import handle_get_trade_stats

            handle_get_trade_stats(time_start="2026-02-01", time_end="2026-02-14")

            call_kwargs = mock_fetch.call_args
            assert call_kwargs.kwargs.get("created_after") == "2026-02-01"
            assert call_kwargs.kwargs.get("created_before") == "2026-02-14"

    def test_trade_stats_thesis_in_output(self):
        """Full pipeline: close node → edge → entry node → thesis extracted → shown in output."""
        import hynous.core.trade_analytics as ta
        ta._cached_stats = None
        ta._cache_time = 0

        close_node = _make_trade_close_node()
        entry_node = _make_trade_entry_node(thesis="BTC bullish on funding reset")

        mock_client = MagicMock()
        mock_client.list_nodes.return_value = [close_node]
        mock_client.get_edges.return_value = [
            {"type": "part_of", "source_id": "n_entry1"},
        ]
        mock_client.get_node.return_value = entry_node

        # Call the full pipeline via get_trade_stats
        stats = ta.get_trade_stats(nous_client=mock_client)

        assert stats.total_trades == 1
        assert stats.trades[0].thesis == "BTC bullish on funding reset"

        # Format the output and verify thesis appears
        from hynous.intelligence.tools.trade_stats import _format_full_report

        output = _format_full_report(stats, limit=5)
        assert "Thesis: BTC bullish on funding reset" in output

    def test_trade_stats_time_filter_passes_to_list_nodes(self):
        """get_trade_stats with time filter passes created_after/before to list_nodes."""
        import hynous.core.trade_analytics as ta
        ta._cached_stats = None
        ta._cache_time = 0

        mock_client = MagicMock()
        mock_client.list_nodes.return_value = []

        ta.get_trade_stats(
            nous_client=mock_client,
            created_after="2026-02-01",
            created_before="2026-02-14",
        )

        call_kwargs = mock_client.list_nodes.call_args
        assert call_kwargs.kwargs.get("created_after") == "2026-02-01"
        assert call_kwargs.kwargs.get("created_before") == "2026-02-14"

    def test_handler_no_time_filter_returns_empty_message(self):
        """Handler with time filter and no results shows time-specific message."""
        import hynous.core.trade_analytics as ta
        ta._cached_stats = None
        ta._cache_time = 0

        with patch("hynous.core.trade_analytics.fetch_trade_history") as mock_fetch:
            mock_fetch.return_value = []

            from hynous.intelligence.tools.trade_stats import handle_get_trade_stats

            result = handle_get_trade_stats(time_start="2026-02-01", time_end="2026-02-14")
            assert "time range" in result.lower()

    def test_handler_no_filter_returns_default_message(self):
        """Handler with no trades and no filters shows default message."""
        import hynous.core.trade_analytics as ta
        ta._cached_stats = None
        ta._cache_time = 0

        with patch("hynous.core.trade_analytics.fetch_trade_history") as mock_fetch:
            mock_fetch.return_value = []

            from hynous.intelligence.tools.trade_stats import handle_get_trade_stats

            result = handle_get_trade_stats()
            assert "start trading" in result.lower()
