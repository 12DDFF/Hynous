"""Integration tests for playbook matching in the daemon wake pipeline."""
import json
import pytest
from unittest.mock import patch, MagicMock
from dataclasses import dataclass


@dataclass
class MockAnomaly:
    type: str
    symbol: str
    severity: float
    headline: str = ""
    detail: str = ""
    fingerprint: str = ""
    detected_at: float = 0
    category: str = "macro"


class TestPlaybookWakePipeline:
    """Test the full pipeline from anomaly detection to playbook-enriched wake message."""

    @patch("hynous.nous.client.get_client")
    def test_playbook_injected_into_wake_message(self, mock_get_client):
        """Playbook context should appear in the wake message when a match is found."""
        from hynous.intelligence.playbook_matcher import PlaybookMatcher

        mock_client = MagicMock()
        mock_client.list_nodes.return_value = [{
            "id": "pb-funding-fade",
            "content_title": "Funding Fade Short",
            "content_body": json.dumps({
                "text": "Short when funding is extreme",
                "trigger": {"anomaly_types": ["funding_extreme"]},
                "action": "Short with tight stop above range high",
                "direction": "short",
                "success_count": 9,
                "sample_size": 12,
            }),
        }]
        mock_get_client.return_value = mock_client

        matcher = PlaybookMatcher(cache_ttl=0)
        anomalies = [
            MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8,
                        headline="BTC funding extreme (0.15%/8h)"),
        ]
        matches = matcher.find_matching(anomalies)
        assert len(matches) == 1

        # Format and verify injection
        from hynous.intelligence.scanner import format_scanner_wake
        base_message = format_scanner_wake(anomalies)
        playbook_section = PlaybookMatcher.format_matches(matches)
        full_message = base_message + "\n\n" + playbook_section

        assert "[Matching Playbooks]" in full_message
        assert "Funding Fade Short" in full_message
        assert "75%" in full_message
        assert "9/12" in full_message

    @patch("hynous.nous.client.get_client")
    def test_no_playbook_when_no_match(self, mock_get_client):
        """Wake message should be unchanged when no playbook matches."""
        from hynous.intelligence.playbook_matcher import PlaybookMatcher

        mock_client = MagicMock()
        mock_client.list_nodes.return_value = [{
            "id": "pb1",
            "content_title": "OI Surge Long",
            "content_body": json.dumps({
                "text": "Long when OI surges",
                "trigger": {"anomaly_types": ["oi_surge"]},
            }),
        }]
        mock_get_client.return_value = mock_client

        matcher = PlaybookMatcher(cache_ttl=0)
        # Anomaly is funding_extreme, playbook is for oi_surge — no match
        anomalies = [MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)
        assert len(matches) == 0

    @patch("hynous.nous.client.get_client")
    def test_multiple_playbooks_sorted(self, mock_get_client):
        """Multiple matching playbooks should be sorted by relevance."""
        from hynous.intelligence.playbook_matcher import PlaybookMatcher

        mock_client = MagicMock()
        mock_client.list_nodes.return_value = [
            {
                "id": "pb-new",
                "content_title": "New Pattern",
                "content_body": json.dumps({
                    "text": "Fresh pattern",
                    "trigger": {"anomaly_types": ["funding_extreme"]},
                    "success_count": 1, "sample_size": 1,
                }),
            },
            {
                "id": "pb-seasoned",
                "content_title": "Seasoned Pattern",
                "content_body": json.dumps({
                    "text": "Proven pattern",
                    "trigger": {"anomaly_types": ["funding_extreme"]},
                    "success_count": 15, "sample_size": 20,
                }),
            },
        ]
        mock_get_client.return_value = mock_client

        matcher = PlaybookMatcher(cache_ttl=0)
        anomalies = [MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)

        assert len(matches) == 2
        assert matches[0].playbook_id == "pb-seasoned"  # Higher relevance
        assert matches[1].playbook_id == "pb-new"
