"""Tests for section-aware intent boost in the retrieval orchestrator (Issue 6)."""

import sys
import types
import pytest
from unittest.mock import MagicMock

# Stub out litellm before importing hynous.intelligence
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception

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
