"""Unit tests for PlaybookMatcher — Issue 5: Procedural Memory."""
import json
import pytest
from unittest.mock import patch, MagicMock
from dataclasses import dataclass


@dataclass
class MockAnomaly:
    """Minimal AnomalyEvent mock for testing."""
    type: str
    symbol: str
    severity: float
    headline: str = ""
    detail: str = ""
    fingerprint: str = ""
    detected_at: float = 0
    category: str = "macro"


class TestPlaybookMatch:
    """Test PlaybookMatch dataclass properties."""

    def test_success_rate_with_trades(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatch
        m = PlaybookMatch(
            playbook_id="pb1", title="Test", action="Short",
            direction="short", success_count=7, sample_size=10,
            matched_anomaly_type="funding_extreme",
            matched_symbol="BTC", severity=0.8,
        )
        assert m.success_rate == 0.7

    def test_success_rate_zero_sample(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatch
        m = PlaybookMatch(
            playbook_id="pb1", title="Test", action="Short",
            direction="short", success_count=0, sample_size=0,
            matched_anomaly_type="funding_extreme",
            matched_symbol="BTC", severity=0.8,
        )
        assert m.success_rate == 0.0

    def test_relevance_score_seasoned(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatch
        m = PlaybookMatch(
            playbook_id="pb1", title="Test", action="Short",
            direction="short", success_count=9, sample_size=12,
            matched_anomaly_type="funding_extreme",
            matched_symbol="BTC", severity=0.8,
        )
        # success_rate=0.75, severity=0.8, sample_weight=1.0 (12 > 10)
        assert abs(m.relevance_score - 0.6) < 0.01

    def test_relevance_score_new_playbook(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatch
        m = PlaybookMatch(
            playbook_id="pb1", title="Test", action="Short",
            direction="short", success_count=1, sample_size=1,
            matched_anomaly_type="funding_extreme",
            matched_symbol="BTC", severity=0.8,
        )
        # success_rate=1.0, severity=0.8, sample_weight=0.1 (1/10)
        assert abs(m.relevance_score - 0.08) < 0.01


class TestMatchLogic:
    """Test trigger matching without Nous dependency."""

    def test_anomaly_type_match(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme", "oi_surge"]}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is True

    def test_anomaly_type_no_match(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"]}
        anomaly = MockAnomaly(type="price_spike", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is False

    def test_empty_anomaly_types(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": []}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is False

    def test_symbol_filter_match(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "symbols": ["BTC", "ETH"]}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is True

    def test_symbol_filter_no_match(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "symbols": ["BTC", "ETH"]}
        anomaly = MockAnomaly(type="funding_extreme", symbol="SOL", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is False

    def test_symbol_filter_null_matches_any(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "symbols": None}
        anomaly = MockAnomaly(type="funding_extreme", symbol="DOGE", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is True

    def test_symbol_case_insensitive(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "symbols": ["btc"]}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is True

    def test_severity_floor_pass(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "min_severity": 0.5}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is True

    def test_severity_floor_fail(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "min_severity": 0.9}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.7)
        assert PlaybookMatcher._matches(trigger, anomaly) is False

    def test_severity_floor_default_zero(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"]}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.1)
        assert PlaybookMatcher._matches(trigger, anomaly) is True


class TestFindMatching:
    """Test the full find_matching pipeline with mocked Nous."""

    def _make_parsed_pb(self, node_id, title, trigger, action="", direction="either",
                        success_count=0, sample_size=0):
        body = json.dumps({
            "text": title,
            "trigger": trigger,
            "action": action,
            "direction": direction,
            "success_count": success_count,
            "sample_size": sample_size,
        })
        return {
            "id": node_id,
            "content_title": title,
            "content_body": body,
            "subtype": "custom:playbook",
            "_parsed_trigger": trigger,
            "_action": action,
            "_direction": direction,
            "_success_count": success_count,
            "_sample_size": sample_size,
        }

    @patch("hynous.intelligence.playbook_matcher.PlaybookMatcher._get_cached_playbooks")
    def test_single_match(self, mock_cache):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        pb = self._make_parsed_pb(
            "pb1", "Funding Fade",
            {"anomaly_types": ["funding_extreme"]},
            action="Short with tight stop",
            direction="short", success_count=9, sample_size=12,
        )
        mock_cache.return_value = [pb]

        matcher = PlaybookMatcher()
        anomalies = [MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)

        assert len(matches) == 1
        assert matches[0].playbook_id == "pb1"
        assert matches[0].success_count == 9
        assert matches[0].matched_symbol == "BTC"

    @patch("hynous.intelligence.playbook_matcher.PlaybookMatcher._get_cached_playbooks")
    def test_no_match(self, mock_cache):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        pb = self._make_parsed_pb(
            "pb1", "Funding Fade",
            {"anomaly_types": ["funding_extreme"]},
        )
        mock_cache.return_value = [pb]

        matcher = PlaybookMatcher()
        anomalies = [MockAnomaly(type="price_spike", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)

        assert len(matches) == 0

    @patch("hynous.intelligence.playbook_matcher.PlaybookMatcher._get_cached_playbooks")
    def test_manual_playbook_skipped(self, mock_cache):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        pb = {"id": "pb1", "content_title": "Manual", "content_body": "plain text",
              "_parsed_trigger": None, "_action": "", "_direction": "either",
              "_success_count": 0, "_sample_size": 0}
        mock_cache.return_value = [pb]

        matcher = PlaybookMatcher()
        anomalies = [MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)

        assert len(matches) == 0

    @patch("hynous.intelligence.playbook_matcher.PlaybookMatcher._get_cached_playbooks")
    def test_sorted_by_relevance(self, mock_cache):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        # Seasoned playbook (9/12, 75%)
        pb1 = self._make_parsed_pb(
            "pb1", "Seasoned",
            {"anomaly_types": ["funding_extreme"]},
            action="Short", direction="short",
            success_count=9, sample_size=12,
        )
        # New playbook (1/1, 100% but low sample weight)
        pb2 = self._make_parsed_pb(
            "pb2", "New",
            {"anomaly_types": ["funding_extreme"]},
            action="Short", direction="short",
            success_count=1, sample_size=1,
        )
        mock_cache.return_value = [pb2, pb1]  # Deliberately reversed

        matcher = PlaybookMatcher()
        anomalies = [MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)

        assert len(matches) == 2
        assert matches[0].playbook_id == "pb1"  # Seasoned ranks higher


class TestFormatMatches:
    """Test wake message formatting."""

    def test_format_single_match(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher, PlaybookMatch
        match = PlaybookMatch(
            playbook_id="pb1", title="Funding Fade",
            action="Short with tight stop", direction="short",
            success_count=9, sample_size=12,
            matched_anomaly_type="funding_extreme",
            matched_symbol="BTC", severity=0.8,
        )
        result = PlaybookMatcher.format_matches([match])
        assert "[Matching Playbooks]" in result
        assert "Funding Fade" in result
        assert "75%" in result
        assert "9/12" in result
        assert "SHORT" in result
        assert "pb1" in result

    def test_format_empty(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        result = PlaybookMatcher.format_matches([])
        assert result == ""

    def test_format_new_playbook_shows_new(self):
        """A playbook with 0/0 should show 'new' not '0%'."""
        from hynous.intelligence.playbook_matcher import PlaybookMatcher, PlaybookMatch
        match = PlaybookMatch(
            playbook_id="pb1", title="New Pattern",
            action="", direction="either",
            success_count=0, sample_size=0,
            matched_anomaly_type="oi_surge",
            matched_symbol="ETH", severity=0.7,
        )
        result = PlaybookMatcher.format_matches([match])
        assert "new" in result

    def test_format_includes_instruction(self):
        """Format should include auto-tracking instruction."""
        from hynous.intelligence.playbook_matcher import PlaybookMatcher, PlaybookMatch
        match = PlaybookMatch(
            playbook_id="pb1", title="Test",
            action="", direction="either",
            success_count=5, sample_size=8,
            matched_anomaly_type="funding_extreme",
            matched_symbol="BTC", severity=0.8,
        )
        result = PlaybookMatcher.format_matches([match])
        assert "auto-tracks" in result


class TestCacheLoading:
    """Test Nous integration for cache loading."""

    @patch("hynous.nous.client.get_client")
    def test_cache_loads_and_parses(self, mock_get_client):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        mock_client = MagicMock()
        mock_client.list_nodes.return_value = [{
            "id": "pb1",
            "content_title": "Test",
            "content_body": json.dumps({
                "text": "desc",
                "trigger": {"anomaly_types": ["funding_extreme"]},
                "action": "Short",
                "direction": "short",
                "success_count": 5,
                "sample_size": 8,
            }),
        }]
        mock_get_client.return_value = mock_client

        matcher = PlaybookMatcher(cache_ttl=0)  # Disable caching for test
        playbooks = matcher._get_cached_playbooks()

        assert len(playbooks) == 1
        assert playbooks[0]["_parsed_trigger"] == {"anomaly_types": ["funding_extreme"]}
        assert playbooks[0]["_success_count"] == 5

    @patch("hynous.nous.client.get_client")
    def test_cache_returns_stale_on_error(self, mock_get_client):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        matcher = PlaybookMatcher(cache_ttl=0)
        matcher._cache = [{"id": "stale", "_parsed_trigger": None, "_action": "",
                           "_direction": "either", "_success_count": 0, "_sample_size": 0}]

        mock_get_client.side_effect = Exception("Nous down")
        playbooks = matcher._get_cached_playbooks()

        assert len(playbooks) == 1
        assert playbooks[0]["id"] == "stale"

    def test_invalidate_cache(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        matcher = PlaybookMatcher(cache_ttl=3600)
        matcher._cache_time = 9999999999  # Far future
        matcher.invalidate_cache()
        assert matcher._cache_time == 0

    @patch("hynous.nous.client.get_client")
    def test_cache_ttl_prevents_reload(self, mock_get_client):
        """Should use cached data within TTL window."""
        import time
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        mock_client = MagicMock()
        mock_client.list_nodes.return_value = []
        mock_get_client.return_value = mock_client

        matcher = PlaybookMatcher(cache_ttl=3600)
        matcher._cache = [{"id": "cached", "_parsed_trigger": None, "_action": "",
                           "_direction": "either", "_success_count": 0, "_sample_size": 0}]
        matcher._cache_time = time.time()

        playbooks = matcher._get_cached_playbooks()
        # Should NOT call list_nodes since within TTL
        mock_client.list_nodes.assert_not_called()
        assert len(playbooks) == 1
        assert playbooks[0]["id"] == "cached"

    @patch("hynous.nous.client.get_client")
    def test_plain_text_body_gets_no_trigger(self, mock_get_client):
        """Playbooks with plain text body (not JSON) get no parsed trigger."""
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        mock_client = MagicMock()
        mock_client.list_nodes.return_value = [{
            "id": "pb1",
            "content_title": "Manual playbook",
            "content_body": "When funding is extreme, short BTC.",
        }]
        mock_get_client.return_value = mock_client

        matcher = PlaybookMatcher(cache_ttl=0)
        playbooks = matcher._get_cached_playbooks()

        assert len(playbooks) == 1
        assert playbooks[0]["_parsed_trigger"] is None
