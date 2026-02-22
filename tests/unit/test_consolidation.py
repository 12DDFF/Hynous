"""Unit tests for the consolidation engine (Issue 3)."""

import sys
import types
import json
import pytest
from unittest.mock import MagicMock, patch

# Stub out litellm before importing hynous.intelligence (pre-existing test env issue)
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception

from hynous.intelligence.consolidation import (
    ConsolidationEngine,
    _extract_symbol,
    _build_analysis_prompt,
    _parse_pattern_output,
    _SOURCE_SUBTYPES,
    _MIN_GROUP_SIZE,
    _MAX_GROUPS_PER_CYCLE,
)


# ---- Symbol extraction ----

class TestExtractSymbol:
    def test_symbol_in_title(self):
        node = {"content_title": "BTC short at $68K", "content_body": ""}
        assert _extract_symbol(node) == "BTC"

    def test_symbol_in_body(self):
        node = {"content_title": "Market event", "content_body": "ETH funding spike"}
        assert _extract_symbol(node) == "ETH"

    def test_symbol_from_json_signals(self):
        body = json.dumps({"text": "Trade closed", "signals": {"symbol": "SOL"}})
        node = {"content_title": "Trade close", "content_body": body}
        assert _extract_symbol(node) == "SOL"

    def test_symbol_from_json_coin_field(self):
        body = json.dumps({"text": "Entry", "signals": {"coin": "eth"}})
        node = {"content_title": "Trade", "content_body": body}
        assert _extract_symbol(node) == "ETH"

    def test_no_symbol_returns_none(self):
        node = {"content_title": "General market thoughts", "content_body": "Nothing specific"}
        assert _extract_symbol(node) is None

    def test_title_takes_priority_over_body(self):
        node = {"content_title": "BTC analysis", "content_body": "ETH is also interesting"}
        assert _extract_symbol(node) == "BTC"

    def test_case_insensitive(self):
        node = {"content_title": "btc short squeeze", "content_body": ""}
        assert _extract_symbol(node) == "BTC"

    def test_symbol_boundary_match(self):
        """Should not match 'ABTC' or 'BTCX'."""
        node = {"content_title": "ABTCX token analysis", "content_body": ""}
        assert _extract_symbol(node) is None

    def test_empty_node(self):
        assert _extract_symbol({}) is None
        assert _extract_symbol({"content_title": "", "content_body": ""}) is None

    def test_malformed_json_body(self):
        node = {"content_title": "BTC trade", "content_body": "{invalid json"}
        assert _extract_symbol(node) == "BTC"

    def test_none_values_handled(self):
        """None title/body should not raise."""
        node = {"content_title": None, "content_body": None}
        assert _extract_symbol(node) is None

    def test_json_body_without_signals(self):
        body = json.dumps({"text": "BTC funding was elevated"})
        node = {"content_title": "Summary", "content_body": body}
        assert _extract_symbol(node) == "BTC"


# ---- Prompt building ----

class TestBuildAnalysisPrompt:
    def test_includes_group_key_and_count(self):
        episodes = [
            {"content_title": "Trade 1", "subtype": "custom:trade_close",
             "content_body": "Closed BTC short", "provenance_created_at": "2026-02-15T10:00:00Z"},
        ]
        prompt = _build_analysis_prompt("BTC", episodes)
        assert "1 episodes for BTC" in prompt
        assert "Trade 1" in prompt

    def test_truncates_long_bodies(self):
        long_body = "x" * 600
        episodes = [
            {"content_title": "T", "subtype": "custom:trade_entry",
             "content_body": long_body, "provenance_created_at": "2026-02-15T10:00:00Z"},
        ]
        prompt = _build_analysis_prompt("ETH", episodes)
        assert "..." in prompt
        assert len(prompt) < len(long_body) + 500

    def test_parses_json_body(self):
        body = json.dumps({"text": "Closed short at profit", "signals": {"pnl_pct": 5.0}})
        episodes = [
            {"content_title": "ETH close", "subtype": "custom:trade_close",
             "content_body": body, "provenance_created_at": "2026-02-15T10:00:00Z"},
        ]
        prompt = _build_analysis_prompt("ETH", episodes)
        assert "Closed short at profit" in prompt

    def test_strips_custom_prefix_from_subtype(self):
        episodes = [
            {"content_title": "T", "subtype": "custom:trade_entry",
             "content_body": "", "provenance_created_at": "2026-02-15T10:00:00Z"},
        ]
        prompt = _build_analysis_prompt("BTC", episodes)
        assert "[trade_entry]" in prompt
        assert "custom:" not in prompt

    def test_multiple_episodes_numbered(self):
        episodes = [
            {"content_title": "T1", "subtype": "custom:trade_close",
             "content_body": "A", "provenance_created_at": "2026-02-15T10:00:00Z"},
            {"content_title": "T2", "subtype": "custom:trade_close",
             "content_body": "B", "provenance_created_at": "2026-02-16T10:00:00Z"},
        ]
        prompt = _build_analysis_prompt("SOL", episodes)
        assert "Episode 1" in prompt
        assert "Episode 2" in prompt
        assert "2 episodes for SOL" in prompt


# ---- Pattern output parsing ----

class TestParsePatternOutput:
    def test_valid_title_and_body(self):
        text = "TITLE: Funding squeeze pattern on ETH\n\nWhen ETH funding exceeds 0.08%..."
        title, body = _parse_pattern_output(text)
        assert title == "Funding squeeze pattern on ETH"
        assert body.startswith("When ETH funding")

    def test_no_pattern(self):
        title, body = _parse_pattern_output("NO_PATTERN")
        assert title is None
        assert body is None

    def test_no_pattern_case_insensitive(self):
        title, body = _parse_pattern_output("no_pattern - episodes are too diverse")
        assert title is None
        assert body is None

    def test_title_truncated_to_60_chars(self):
        long_title = "TITLE: " + "A" * 80 + "\n\nBody text here."
        title, body = _parse_pattern_output(long_title)
        assert title is not None
        assert len(title) <= 60

    def test_fallback_first_line_as_title(self):
        text = "Short funding squeezes are reliable\nI've noticed that when..."
        title, body = _parse_pattern_output(text)
        assert title is not None
        assert body is not None

    def test_empty_string(self):
        assert _parse_pattern_output("") == (None, None)

    def test_none(self):
        assert _parse_pattern_output(None) == (None, None)

    def test_long_text_without_title(self):
        text = "A" * 100
        title, body = _parse_pattern_output(text)
        assert title is not None
        assert body == text

    def test_title_body_separation(self):
        text = "TITLE: My Pattern\n\nThis is the body of the pattern."
        title, body = _parse_pattern_output(text)
        assert title == "My Pattern"
        assert "body of the pattern" in body


# ---- ConsolidationEngine grouping ----

class TestConsolidationGrouping:
    def _make_engine(self):
        config = MagicMock()
        config.memory.compression_model = "test-model"
        return ConsolidationEngine(config)

    def test_groups_by_symbol(self):
        engine = self._make_engine()
        episodes = [
            {"content_title": "BTC short", "content_body": ""},
            {"content_title": "BTC long", "content_body": ""},
            {"content_title": "ETH entry", "content_body": ""},
        ]
        groups = engine._group_episodes(episodes)
        assert "BTC" in groups
        assert len(groups["BTC"]) == 2
        assert "ETH" in groups
        assert len(groups["ETH"]) == 1

    def test_no_symbol_goes_to_general(self):
        engine = self._make_engine()
        episodes = [
            {"content_title": "General thoughts", "content_body": "Just thinking"},
        ]
        groups = engine._group_episodes(episodes)
        assert "_general" in groups

    def test_mixed_symbol_and_general(self):
        engine = self._make_engine()
        episodes = [
            {"content_title": "BTC trade", "content_body": ""},
            {"content_title": "No symbol here", "content_body": "just text"},
        ]
        groups = engine._group_episodes(episodes)
        assert "BTC" in groups
        assert "_general" in groups

    def test_json_body_symbol_grouped_correctly(self):
        engine = self._make_engine()
        body = json.dumps({"text": "closed", "signals": {"symbol": "SOL"}})
        episodes = [
            {"content_title": "Trade", "content_body": body},
            {"content_title": "Trade 2", "content_body": body},
            {"content_title": "Trade 3", "content_body": body},
        ]
        groups = engine._group_episodes(episodes)
        assert "SOL" in groups
        assert len(groups["SOL"]) == 3


# ---- Source subtypes ----

class TestSourceSubtypes:
    def test_source_subtypes_are_from_source_sections(self):
        """All source subtypes should belong to sections with consolidation_role='source'."""
        from hynous.nous.sections import SECTION_PROFILES, get_section_for_subtype
        for subtype in _SOURCE_SUBTYPES:
            section = get_section_for_subtype(subtype)
            profile = SECTION_PROFILES[section]
            assert profile.consolidation_role == "source", (
                f"{subtype} is in section {section.value} with "
                f"consolidation_role={profile.consolidation_role}, expected 'source'"
            )

    def test_all_source_subtypes_known(self):
        """All source subtypes should be in SUBTYPE_TO_SECTION."""
        from hynous.nous.sections import SUBTYPE_TO_SECTION
        for subtype in _SOURCE_SUBTYPES:
            assert subtype in SUBTYPE_TO_SECTION, f"Missing: {subtype}"


# ---- Constants ----

class TestConstants:
    def test_min_group_size_positive(self):
        assert _MIN_GROUP_SIZE >= 2

    def test_max_groups_positive(self):
        assert _MAX_GROUPS_PER_CYCLE >= 1

    def test_source_subtypes_not_empty(self):
        assert len(_SOURCE_SUBTYPES) >= 3


# ---- run_cycle stats shape ----

class TestRunCycleStats:
    def test_returns_expected_keys(self):
        """run_cycle should return a dict with all expected stat keys."""
        config = MagicMock()
        config.memory.compression_model = "test-model"
        engine = ConsolidationEngine(config)

        # Mock nous client to raise on first call (simulates Nous unavailable)
        with patch("hynous.intelligence.consolidation.ConsolidationEngine._fetch_recent_episodes",
                   side_effect=Exception("Nous unavailable")):
            stats = engine.run_cycle()

        assert "episodes_reviewed" in stats
        assert "groups_found" in stats
        assert "groups_analyzed" in stats
        assert "patterns_created" in stats
        assert "patterns_strengthened" in stats
        assert "errors" in stats

    def test_returns_zero_stats_on_empty_fetch(self):
        """If no episodes fetched, stats should show 0 everywhere."""
        config = MagicMock()
        config.memory.compression_model = "test-model"
        engine = ConsolidationEngine(config)

        with patch("hynous.intelligence.consolidation.ConsolidationEngine._fetch_recent_episodes",
                   return_value=[]):
            stats = engine.run_cycle()

        assert stats["episodes_reviewed"] == 0
        assert stats["patterns_created"] == 0
