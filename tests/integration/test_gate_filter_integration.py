"""Integration tests for gate filter in the store_memory flow."""

from unittest.mock import patch, MagicMock

from hynous.intelligence.tools.memory import _store_memory_impl


def _make_config(gate_enabled: bool = True):
    """Create a minimal mock config for testing."""
    config = MagicMock()
    config.memory.gate_filter_enabled = gate_enabled
    config.memory.compress_enabled = True
    return config


class TestGateFilterIntegration:
    """Test that gate filter correctly blocks junk in _store_memory_impl."""

    # NOTE: load_config and get_client are imported inside the function body
    # (local imports), so we must patch them at their SOURCE modules, not at
    # the hynous.intelligence.tools.memory module level.

    @patch("hynous.core.config.load_config")
    @patch("hynous.nous.client.get_client")
    def test_rejects_short_content(self, mock_get_client, mock_config):
        """Short content should be rejected before any Nous call."""
        mock_config.return_value = _make_config(gate_enabled=True)

        result = _store_memory_impl(
            content="hi",
            memory_type="lesson",
            title="Test",
        )

        assert result.startswith("Not stored:")
        assert "too short" in result.lower()
        mock_get_client.assert_not_called()

    @patch("hynous.core.config.load_config")
    @patch("hynous.nous.client.get_client")
    def test_rejects_spam_content(self, mock_get_client, mock_config):
        """Spam content should be rejected."""
        mock_config.return_value = _make_config(gate_enabled=True)

        # "testtesttesting" = 15 chars (passes R-001), matches ^(test|testing)+$
        result = _store_memory_impl(
            content="testtesttesting",
            memory_type="lesson",
            title="Test",
        )

        assert result.startswith("Not stored:")
        mock_get_client.assert_not_called()

    @patch("hynous.core.config.load_config")
    @patch("hynous.nous.client.get_client")
    def test_rejects_social_only(self, mock_get_client, mock_config):
        """Social pleasantries should be rejected."""
        mock_config.return_value = _make_config(gate_enabled=True)

        result = _store_memory_impl(
            content="Thank you!",
            memory_type="lesson",
            title="Thanks",
        )

        assert result.startswith("Not stored:")
        assert "social" in result.lower() or "pleasantry" in result.lower()
        mock_get_client.assert_not_called()

    @patch("hynous.core.config.load_config")
    @patch("hynous.nous.client.get_client")
    def test_passes_good_content(self, mock_get_client, mock_config):
        """Good content should pass through to Nous."""
        mock_config.return_value = _make_config(gate_enabled=True)
        mock_client = MagicMock()
        mock_client.check_similar.return_value = {
            "recommendation": "unique",
            "matches": [],
        }
        mock_client.create_node.return_value = {"id": "n_test123456"}
        mock_get_client.return_value = mock_client

        result = _store_memory_impl(
            content="BTC funding rate inverted to -0.02% indicating extreme short crowding",
            memory_type="lesson",
            title="Funding inversion signal",
        )

        assert result.startswith("Stored:")
        mock_client.create_node.assert_called_once()

    @patch("hynous.core.config.load_config")
    @patch("hynous.nous.client.get_client")
    def test_gate_disabled_allows_junk(self, mock_get_client, mock_config):
        """When gate_filter_enabled=False, junk content should pass through."""
        mock_config.return_value = _make_config(gate_enabled=False)
        mock_client = MagicMock()
        mock_client.create_node.return_value = {"id": "n_test123456"}
        mock_get_client.return_value = mock_client

        result = _store_memory_impl(
            content="hi",
            memory_type="episode",
            title="Test",
        )

        # Should NOT be rejected — gate is disabled
        assert not result.startswith("Not stored:")
        mock_client.create_node.assert_called_once()

    @patch("hynous.core.config.load_config")
    @patch("hynous.nous.client.get_client")
    def test_rejects_filler(self, mock_get_client, mock_config):
        """Pure filler content should be rejected."""
        mock_config.return_value = _make_config(gate_enabled=True)

        result = _store_memory_impl(
            content="um like basically yeah so anyway hmm",
            memory_type="thesis",
            title="Filler",
        )

        assert result.startswith("Not stored:")
        mock_get_client.assert_not_called()

    @patch("hynous.core.config.load_config")
    @patch("hynous.nous.client.get_client")
    def test_episode_type_also_gated(self, mock_get_client, mock_config):
        """Gate filter applies to all types, not just lesson/curiosity."""
        mock_config.return_value = _make_config(gate_enabled=True)

        # "testtesttesting" = 15 chars (passes R-001), triggers spam_pattern
        result = _store_memory_impl(
            content="testtesttesting",
            memory_type="episode",
            title="Test episode",
        )

        assert result.startswith("Not stored:")
        mock_get_client.assert_not_called()
