"""Tests for v2 configuration scaffolding (phase 0)."""

import pytest
from hynous.core.config import (
    Config,
    V2Config,
    V2JournalConfig,
    V2AnalysisAgentConfig,
    V2MechanicalEntryConfig,
    V2ConsolidationConfig,
    V2UserChatConfig,
    load_config,
)


def test_v2_config_has_default_values():
    """V2Config instantiates with safe defaults."""
    cfg = V2Config()
    assert cfg.enabled is True
    assert cfg.journal.db_path == "storage/v2/journal.db"
    assert cfg.analysis_agent.model.startswith("anthropic/")
    assert cfg.mechanical_entry.coin == "BTC"


def test_load_config_populates_v2_section():
    """load_config returns a Config with a fully-populated V2Config."""
    cfg = load_config()
    assert isinstance(cfg.v2, V2Config)
    assert cfg.v2.enabled is True
    assert isinstance(cfg.v2.journal, V2JournalConfig)
    assert isinstance(cfg.v2.analysis_agent, V2AnalysisAgentConfig)
    assert isinstance(cfg.v2.mechanical_entry, V2MechanicalEntryConfig)
    assert isinstance(cfg.v2.consolidation, V2ConsolidationConfig)
    assert isinstance(cfg.v2.user_chat, V2UserChatConfig)


def test_v2_journal_db_path_is_under_v2_storage():
    """Journal DB must land in storage/v2/ not storage/ to avoid v1 collision."""
    cfg = load_config()
    assert cfg.v2.journal.db_path.startswith("storage/v2/")


def test_v2_mechanical_entry_coin_is_btc():
    """Phase 1 is BTC-only."""
    cfg = load_config()
    assert cfg.v2.mechanical_entry.coin == "BTC"


def test_v2_mechanical_entry_max_vol_regime_valid():
    """max_vol_regime must be one of the known regime labels."""
    cfg = load_config()
    assert cfg.v2.mechanical_entry.max_vol_regime in {"low", "normal", "high", "extreme"}


def test_v2_analysis_agent_config_has_retry_disabled():
    """Per plan: one-shot analysis with manual re-run, no auto-retry."""
    cfg = load_config()
    assert cfg.v2.analysis_agent.retry_on_failure is False


def test_v2_consolidation_edges_match_plan():
    """The conservative starter edge set per phase 6."""
    cfg = load_config()
    expected = {
        "preceded_by", "followed_by", "same_regime_bucket",
        "same_rejection_reason", "rejection_vs_contemporaneous_trade",
    }
    assert set(cfg.v2.consolidation.edge_types) == expected


def test_v1_config_still_loads():
    """v2 scaffolding must not break v1 config loading."""
    cfg = load_config()
    # Sanity: v1 fields that existed before phase 0 still work
    assert cfg.agent is not None
    assert cfg.daemon is not None
    assert cfg.satellite is not None
