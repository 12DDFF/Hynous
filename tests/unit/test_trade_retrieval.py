"""Unit tests for trade retrieval fixes (Problems 1-3).

Tests event_time on trade nodes, memory_type normalization,
TradeRecord thesis field, _enrich_from_entry(), cache bypass,
TOOL_DEF params, and output formatting.
"""

import json
import sys
import types
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

# Stub out litellm before importing hynous.intelligence (its __init__ imports Agent → litellm)
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception


# ====================================================================
# Problem 1: _store_to_nous() event_time
# ====================================================================


class TestStoreToNousEventTime:
    """Verify _store_to_nous() passes temporal fields to create_node()."""

    def _call_store(self, **kwargs):
        """Helper to call _store_to_nous with mocked dependencies."""
        with (
            patch("hynous.nous.client.get_client") as mock_get_client,
            patch("hynous.core.memory_tracker.get_tracker") as mock_get_tracker,
        ):
            mock_client = MagicMock()
            mock_client.create_node.return_value = {"id": "n_test123"}
            mock_get_client.return_value = mock_client

            mock_tracker = MagicMock()
            mock_get_tracker.return_value = mock_tracker

            from hynous.intelligence.tools.trading import _store_to_nous

            defaults = {
                "subtype": "custom:trade_entry",
                "title": "LONG BTC @ $68,000",
                "content": "Thesis: BTC bullish\nEntry: $68,000",
                "summary": "LONG BTC | Entry $68,000",
            }
            defaults.update(kwargs)
            result = _store_to_nous(**defaults)
            return result, mock_client

    def test_auto_generates_event_time(self):
        """When no event_time provided, auto-generates ISO timestamp."""
        _, mock_client = self._call_store()
        call_kwargs = mock_client.create_node.call_args
        assert call_kwargs.kwargs.get("event_time") is not None
        assert call_kwargs.kwargs.get("event_confidence") == 1.0
        assert call_kwargs.kwargs.get("event_source") == "inferred"

    def test_uses_provided_event_time(self):
        """When event_time is explicitly provided, uses it as-is."""
        explicit_time = "2026-02-14T12:00:00+00:00"
        _, mock_client = self._call_store(event_time=explicit_time)
        call_kwargs = mock_client.create_node.call_args
        assert call_kwargs.kwargs.get("event_time") == explicit_time

    def test_event_time_is_valid_iso_format(self):
        """Auto-generated event_time is parseable ISO 8601."""
        _, mock_client = self._call_store()
        event_time = mock_client.create_node.call_args.kwargs.get("event_time")
        # Should not raise
        parsed = datetime.fromisoformat(event_time)
        assert parsed.tzinfo is not None  # timezone-aware

    def test_all_trade_subtypes_get_event_time(self):
        """trade_entry, trade_close, and trade_modify all get timestamps."""
        for subtype in ("custom:trade_entry", "custom:trade_close", "custom:trade_modify"):
            _, mock_client = self._call_store(subtype=subtype)
            call_kwargs = mock_client.create_node.call_args
            assert call_kwargs.kwargs.get("event_time") is not None, f"Missing event_time for {subtype}"
            assert call_kwargs.kwargs.get("event_confidence") == 1.0


# ====================================================================
# Problem 2: memory_type normalization
# ====================================================================


class TestTradeTypeNormalization:
    """Verify recall_memory normalizes 'trade' to 'trade_entry'."""

    def test_trade_maps_to_trade_entry_in_browse(self):
        """memory_type='trade' in browse mode queries custom:trade_entry."""
        with patch("hynous.nous.client.get_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.list_nodes.return_value = []
            mock_get_client.return_value = mock_client

            from hynous.intelligence.tools.memory import handle_recall_memory

            handle_recall_memory(mode="browse", memory_type="trade")
            call_kwargs = mock_client.list_nodes.call_args
            assert call_kwargs.kwargs.get("subtype") == "custom:trade_entry"

    def test_trade_maps_to_trade_entry_in_search(self):
        """memory_type='trade' in search mode uses custom:trade_entry subtype."""
        mock_config = MagicMock()
        mock_config.orchestrator.enabled = True

        with (
            patch("hynous.nous.client.get_client") as mock_get_client,
            patch("hynous.intelligence.retrieval_orchestrator.orchestrate_retrieval") as mock_orch,
            patch("hynous.core.config.load_config", return_value=mock_config),
        ):
            mock_client = MagicMock()
            mock_get_client.return_value = mock_client
            mock_orch.return_value = []

            from hynous.intelligence.tools.memory import handle_recall_memory

            handle_recall_memory(mode="search", query="BTC trades", memory_type="trade")
            call_kwargs = mock_orch.call_args
            assert call_kwargs.kwargs.get("subtype_filter") == "custom:trade_entry"

    def test_trade_entry_still_works_directly(self):
        """memory_type='trade_entry' is not double-mapped."""
        with patch("hynous.nous.client.get_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.list_nodes.return_value = []
            mock_get_client.return_value = mock_client

            from hynous.intelligence.tools.memory import handle_recall_memory

            handle_recall_memory(mode="browse", memory_type="trade_entry")
            call_kwargs = mock_client.list_nodes.call_args
            assert call_kwargs.kwargs.get("subtype") == "custom:trade_entry"

    def test_trade_close_unaffected(self):
        """memory_type='trade_close' still maps to custom:trade_close."""
        with patch("hynous.nous.client.get_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.list_nodes.return_value = []
            mock_get_client.return_value = mock_client

            from hynous.intelligence.tools.memory import handle_recall_memory

            handle_recall_memory(mode="browse", memory_type="trade_close")
            call_kwargs = mock_client.list_nodes.call_args
            assert call_kwargs.kwargs.get("subtype") == "custom:trade_close"

    def test_store_memory_trade_type_unchanged(self):
        """store_memory with memory_type='trade' still creates custom:trade."""
        from hynous.intelligence.tools.memory import _TYPE_MAP

        assert _TYPE_MAP["trade"] == ("concept", "custom:trade")


# ====================================================================
# Problem 3: TradeRecord thesis field
# ====================================================================


class TestTradeRecordThesis:
    """Verify TradeRecord includes thesis field."""

    def test_thesis_field_exists(self):
        from hynous.core.trade_analytics import TradeRecord

        record = TradeRecord(
            symbol="BTC", side="long", entry_px=68000, exit_px=70000,
            pnl_usd=200, pnl_pct=2.9, close_type="full", closed_at="2026-02-14",
        )
        assert record.thesis == ""  # default empty

    def test_thesis_field_stores_value(self):
        from hynous.core.trade_analytics import TradeRecord

        record = TradeRecord(
            symbol="BTC", side="long", entry_px=68000, exit_px=70000,
            pnl_usd=200, pnl_pct=2.9, close_type="full", closed_at="2026-02-14",
            thesis="Funding reset + support held at 67K",
        )
        assert record.thesis == "Funding reset + support held at 67K"


# ====================================================================
# Problem 3: _enrich_from_entry()
# ====================================================================


class TestEnrichFromEntry:
    """Verify _enrich_from_entry() extracts duration and thesis."""

    def _make_close_node(self, node_id="n_close1"):
        return {
            "id": node_id,
            "created_at": "2026-02-14T12:00:00+00:00",
            "content_body": json.dumps({
                "signals": {"action": "close", "symbol": "BTC"},
            }),
        }

    def _make_entry_node(self, thesis_text="Thesis: BTC bullish on funding reset\nEntry: $68,000"):
        return {
            "id": "n_entry1",
            "created_at": "2026-02-13T12:00:00+00:00",
            "content_body": json.dumps({"text": thesis_text}),
        }

    def test_extracts_thesis_from_entry_body(self):
        """Parses 'Thesis: ...' from JSON body of linked entry node."""
        from hynous.core.trade_analytics import _enrich_from_entry

        mock_client = MagicMock()
        mock_client.get_edges.return_value = [
            {"type": "part_of", "source_id": "n_entry1"},
        ]
        mock_client.get_node.return_value = self._make_entry_node()

        close_node = self._make_close_node()
        result = _enrich_from_entry(close_node, mock_client, "2026-02-14T12:00:00+00:00")
        assert result["thesis"] == "BTC bullish on funding reset"

    def test_extracts_duration(self):
        """Calculates hours between entry and close timestamps."""
        from hynous.core.trade_analytics import _enrich_from_entry

        mock_client = MagicMock()
        mock_client.get_edges.return_value = [
            {"type": "part_of", "source_id": "n_entry1"},
        ]
        mock_client.get_node.return_value = self._make_entry_node()

        close_node = self._make_close_node()
        result = _enrich_from_entry(close_node, mock_client, "2026-02-14T12:00:00+00:00")
        assert result["duration_hours"] == 24.0  # 1 day

    def test_returns_empty_thesis_when_no_edge(self):
        """Returns empty thesis when no part_of edge exists."""
        from hynous.core.trade_analytics import _enrich_from_entry

        mock_client = MagicMock()
        mock_client.get_edges.return_value = []

        close_node = self._make_close_node()
        result = _enrich_from_entry(close_node, mock_client, "2026-02-14T12:00:00+00:00")
        assert result["thesis"] == ""

    def test_returns_empty_thesis_on_api_error(self):
        """Handles Nous errors gracefully."""
        from hynous.core.trade_analytics import _enrich_from_entry

        mock_client = MagicMock()
        mock_client.get_edges.side_effect = Exception("Connection refused")

        close_node = self._make_close_node()
        result = _enrich_from_entry(close_node, mock_client, "2026-02-14T12:00:00+00:00")
        assert result["thesis"] == ""
        assert result["duration_hours"] == 0.0

    def test_fallback_first_line_when_no_thesis_prefix(self):
        """Uses first line of body when no 'Thesis:' prefix found."""
        from hynous.core.trade_analytics import _enrich_from_entry

        mock_client = MagicMock()
        mock_client.get_edges.return_value = [
            {"type": "part_of", "source_id": "n_entry1"},
        ]
        mock_client.get_node.return_value = self._make_entry_node(
            thesis_text="Some reasoning about BTC\nMore details",
        )

        close_node = self._make_close_node()
        result = _enrich_from_entry(close_node, mock_client, "2026-02-14T12:00:00+00:00")
        assert result["thesis"] == "Some reasoning about BTC"


# ====================================================================
# Problem 3: get_trade_stats() caching
# ====================================================================


class TestGetTradeStatsCaching:
    """Verify cache bypass for filtered queries."""

    def setup_method(self):
        """Reset module-level cache before each test."""
        import hynous.core.trade_analytics as ta
        ta._cached_stats = None
        ta._cache_time = 0

    def test_default_query_uses_cache(self):
        """get_trade_stats() with no params uses 30s cache."""
        with patch("hynous.core.trade_analytics.fetch_trade_history") as mock_fetch:
            mock_fetch.return_value = []

            from hynous.core.trade_analytics import get_trade_stats

            get_trade_stats()
            get_trade_stats()
            assert mock_fetch.call_count == 1  # cached on second call

    def test_filtered_query_bypasses_cache(self):
        """get_trade_stats(created_after=...) always hits Nous."""
        with patch("hynous.core.trade_analytics.fetch_trade_history") as mock_fetch:
            mock_fetch.return_value = []

            from hynous.core.trade_analytics import get_trade_stats

            get_trade_stats()  # populates cache
            get_trade_stats(created_after="2026-02-01")  # bypasses cache
            assert mock_fetch.call_count == 2

    def test_limit_query_bypasses_cache(self):
        """get_trade_stats(limit=3) bypasses cache."""
        with patch("hynous.core.trade_analytics.fetch_trade_history") as mock_fetch:
            mock_fetch.return_value = []

            from hynous.core.trade_analytics import get_trade_stats

            get_trade_stats()  # populates cache
            get_trade_stats(limit=3)  # bypasses cache
            assert mock_fetch.call_count == 2

    def test_filtered_result_not_cached(self):
        """Filtered queries don't pollute the default cache."""
        import hynous.core.trade_analytics as ta

        with patch("hynous.core.trade_analytics.fetch_trade_history") as mock_fetch:
            mock_fetch.return_value = []

            ta.get_trade_stats(created_after="2026-02-01")
            assert ta._cached_stats is None  # filtered result not stored


# ====================================================================
# Problem 3: TOOL_DEF parameters
# ====================================================================


class TestTradeStatsToolDef:
    """Verify TOOL_DEF has new parameters."""

    def test_has_limit_param(self):
        from hynous.intelligence.tools.trade_stats import TOOL_DEF

        assert "limit" in TOOL_DEF["parameters"]["properties"]

    def test_has_time_start_param(self):
        from hynous.intelligence.tools.trade_stats import TOOL_DEF

        assert "time_start" in TOOL_DEF["parameters"]["properties"]

    def test_has_time_end_param(self):
        from hynous.intelligence.tools.trade_stats import TOOL_DEF

        assert "time_end" in TOOL_DEF["parameters"]["properties"]

    def test_description_mentions_theses(self):
        from hynous.intelligence.tools.trade_stats import TOOL_DEF

        assert "thes" in TOOL_DEF["description"].lower()


# ====================================================================
# Problem 3: Output formatting
# ====================================================================


class TestTradeStatsOutput:
    """Verify output includes thesis text."""

    def _make_stats(self, num_trades=3, thesis="Funding reset"):
        from hynous.core.trade_analytics import TradeRecord, TradeStats

        trades = []
        for i in range(num_trades):
            trades.append(TradeRecord(
                symbol="BTC", side="long", entry_px=68000 + i * 100,
                exit_px=69000 + i * 100, pnl_usd=100 + i * 10,
                pnl_pct=1.5, close_type="full",
                closed_at=f"2026-02-{14-i:02d}T12:00:00+00:00",
                thesis=thesis,
            ))

        return TradeStats(
            total_trades=num_trades,
            wins=num_trades,
            losses=0,
            win_rate=100.0,
            total_pnl=sum(t.pnl_usd for t in trades),
            avg_win=sum(t.pnl_usd for t in trades) / num_trades,
            avg_loss=0,
            profit_factor=float("inf"),
            best_trade=max(t.pnl_usd for t in trades),
            worst_trade=min(t.pnl_usd for t in trades),
            by_symbol={"BTC": {"trades": num_trades, "wins": num_trades, "pnl": 330.0, "win_rate": 100.0}},
            trades=trades,
        )

    def test_full_report_includes_thesis(self):
        """_format_full_report shows thesis under each trade."""
        from hynous.intelligence.tools.trade_stats import _format_full_report

        stats = self._make_stats(thesis="Funding reset + support held at 67K")
        output = _format_full_report(stats, limit=5)
        assert "Thesis: Funding reset + support held at 67K" in output

    def test_full_report_respects_limit(self):
        """_format_full_report shows at most `limit` trades."""
        from hynous.intelligence.tools.trade_stats import _format_full_report

        stats = self._make_stats(num_trades=10)
        output = _format_full_report(stats, limit=3)
        # Count trade lines (indented lines with " | " separator — trade format)
        trade_lines = [l for l in output.split("\n") if l.startswith("  ") and " | " in l]
        assert len(trade_lines) == 3

    def test_full_report_no_thesis_when_empty(self):
        """_format_full_report omits thesis line when thesis is empty."""
        from hynous.intelligence.tools.trade_stats import _format_full_report

        stats = self._make_stats(thesis="")
        output = _format_full_report(stats, limit=5)
        assert "Thesis:" not in output

    def test_symbol_report_includes_thesis(self):
        """_format_symbol_report shows thesis under each trade."""
        from hynous.intelligence.tools.trade_stats import _format_symbol_report

        stats = self._make_stats(thesis="BTC bullish divergence")
        output = _format_symbol_report(stats, "BTC", limit=5)
        assert "Thesis: BTC bullish divergence" in output

    def test_symbol_report_respects_limit(self):
        """_format_symbol_report shows at most `limit` trades."""
        from hynous.intelligence.tools.trade_stats import _format_symbol_report

        stats = self._make_stats(num_trades=10)
        output = _format_symbol_report(stats, "BTC", limit=2)
        # Count trade lines (lines starting with "  LONG")
        trade_lines = [l for l in output.split("\n") if l.strip().startswith("LONG")]
        assert len(trade_lines) == 2
