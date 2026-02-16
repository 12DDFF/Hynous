"""
Audit tests for Token Optimization (TO-1 through TO-4).

Tests the actual implementation against the architect's verification checklists.
No mocks of external services needed — these test config values, data structures,
function signatures, and pure logic only.
"""

import inspect
import yaml
from pathlib import Path

import pytest

# ====================================================================
# Helpers
# ====================================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def _load_yaml_config() -> dict:
    """Load the raw YAML config for direct inspection."""
    yaml_path = PROJECT_ROOT / "config" / "default.yaml"
    with open(yaml_path) as f:
        return yaml.safe_load(f)


# ====================================================================
# TO-1: Dynamic max_tokens Per Wake Type
# ====================================================================


class TestTO1DynamicMaxTokens:
    """Verify TO-1: max_tokens parameter threads correctly through the system."""

    # -- Config defaults --

    def test_yaml_max_tokens_is_2048(self):
        """config/default.yaml agent.max_tokens must be 2048 (was 4096)."""
        raw = _load_yaml_config()
        assert raw["agent"]["max_tokens"] == 2048

    def test_dataclass_default_max_tokens_is_2048(self):
        """AgentConfig dataclass default must be 2048."""
        from src.hynous.core.config import AgentConfig
        cfg = AgentConfig()
        assert cfg.max_tokens == 2048

    def test_load_config_fallback_max_tokens_is_2048(self):
        """load_config() fallback for max_tokens must be 2048 (not 4096)."""
        # Read the source to check the hardcoded fallback
        from src.hynous.core import config as config_module
        source = inspect.getsource(config_module.load_config)
        # The fallback should be 2048, not 4096
        assert 'get("max_tokens", 2048)' in source
        assert 'get("max_tokens", 4096)' not in source

    # -- Agent signatures --

    def test_api_kwargs_accepts_max_tokens(self):
        """_api_kwargs() must accept max_tokens: int | None parameter."""
        from src.hynous.intelligence.agent import Agent
        sig = inspect.signature(Agent._api_kwargs)
        params = sig.parameters
        assert "max_tokens" in params
        assert params["max_tokens"].default is None

    def test_chat_accepts_max_tokens(self):
        """chat() must accept max_tokens: int | None parameter."""
        from src.hynous.intelligence.agent import Agent
        sig = inspect.signature(Agent.chat)
        params = sig.parameters
        assert "max_tokens" in params
        assert params["max_tokens"].default is None

    def test_chat_stream_accepts_max_tokens(self):
        """chat_stream() must accept max_tokens: int | None parameter."""
        from src.hynous.intelligence.agent import Agent
        sig = inspect.signature(Agent.chat_stream)
        params = sig.parameters
        assert "max_tokens" in params
        assert params["max_tokens"].default is None

    # -- Daemon signatures and values --

    def test_wake_agent_accepts_max_tokens(self):
        """_wake_agent() must accept max_tokens: int | None parameter."""
        from src.hynous.intelligence.daemon import Daemon
        sig = inspect.signature(Daemon._wake_agent)
        params = sig.parameters
        assert "max_tokens" in params
        assert params["max_tokens"].default is None

    def test_wake_for_watchpoint_passes_1024(self):
        """_wake_for_watchpoint calls _wake_agent with max_tokens=1024."""
        from src.hynous.intelligence.daemon import Daemon
        source = inspect.getsource(Daemon._wake_for_watchpoint)
        assert "max_tokens=1024" in source

    def test_wake_for_fill_distinguishes_sltp_vs_manual(self):
        """_wake_for_fill uses 1536 for SL/TP and 512 for manual."""
        from src.hynous.intelligence.daemon import Daemon
        source = inspect.getsource(Daemon._wake_for_fill)
        # Must compute fill_tokens based on classification
        assert "1536" in source
        assert "512" in source
        # Verify the SL/TP vs manual logic exists
        assert "stop_loss" in source
        assert "take_profit" in source

    def test_wake_for_review_distinguishes_learning_vs_normal(self):
        """_wake_for_review uses 1536 for learning and 512 for normal."""
        from src.hynous.intelligence.daemon import Daemon
        source = inspect.getsource(Daemon._wake_for_review)
        assert "max_tokens=1536" in source  # learning
        assert "max_tokens=512" in source   # normal

    def test_check_conflicts_passes_1024(self):
        """_wake_for_conflicts calls _wake_agent with max_tokens=1024."""
        from src.hynous.intelligence.daemon import Daemon
        source = inspect.getsource(Daemon._wake_for_conflicts)
        assert "max_tokens=1024" in source

    def test_check_curiosity_passes_1536(self):
        """_check_curiosity calls _wake_agent with max_tokens=1536."""
        from src.hynous.intelligence.daemon import Daemon
        source = inspect.getsource(Daemon._check_curiosity)
        assert "max_tokens=1536" in source

    def test_manual_wake_passes_1024(self):
        """_manual_wake calls _wake_agent with max_tokens=1024."""
        from src.hynous.intelligence.daemon import Daemon
        source = inspect.getsource(Daemon._manual_wake)
        assert "max_tokens=1024" in source

    def test_wake_agent_passes_max_tokens_to_chat(self):
        """_wake_agent must pass max_tokens to agent.chat()."""
        from src.hynous.intelligence.daemon import Daemon
        source = inspect.getsource(Daemon._wake_agent)
        assert "max_tokens=max_tokens" in source

    # -- Tool loop preservation --

    def test_tool_loop_does_not_reset_max_tokens(self):
        """kwargs['messages'] = ... in the tool loop must NOT reset max_tokens.

        Both chat() and chat_stream() update only kwargs['messages'] after
        tool use, preserving max_tokens from the initial _api_kwargs() call.
        """
        from src.hynous.intelligence.agent import Agent
        chat_source = inspect.getsource(Agent.chat)
        stream_source = inspect.getsource(Agent.chat_stream)

        # Both should have kwargs["messages"] = ... (updating messages only)
        assert 'kwargs["messages"]' in chat_source
        assert 'kwargs["messages"]' in stream_source

        # Neither should have kwargs = self._api_kwargs after the initial call
        # (i.e., max_tokens is not re-read from config mid-loop)
        # Check that _api_kwargs is called only once per method
        assert chat_source.count("self._api_kwargs") == 1
        assert stream_source.count("self._api_kwargs") == 1

    # -- User chat paths don't pass max_tokens --

    def test_dashboard_uses_default_max_tokens(self):
        """Dashboard calls chat_stream() without max_tokens (inherits config default)."""
        state_path = PROJECT_ROOT / "dashboard" / "dashboard" / "state.py"
        source = state_path.read_text()
        # The call should be agent.chat_stream(user_input) with no max_tokens
        assert "chat_stream(" in source
        assert "max_tokens" not in source

    def test_discord_uses_default_max_tokens(self):
        """Discord bot calls agent.chat() without max_tokens (inherits config default)."""
        bot_path = PROJECT_ROOT / "src" / "hynous" / "discord" / "bot.py"
        source = bot_path.read_text()
        # The call should be self.agent.chat, prefixed — no max_tokens
        assert "self.agent.chat" in source
        assert "max_tokens" not in source


# ====================================================================
# TO-2: Schema Trimming
# ====================================================================


class TestTO2SchemaTrimming:
    """Verify TO-2: tool schema descriptions are trimmed, structure preserved."""

    def test_store_tool_def_structure(self):
        """STORE_TOOL_DEF preserves all required fields, enums, and types."""
        from src.hynous.intelligence.tools.memory import STORE_TOOL_DEF

        assert STORE_TOOL_DEF["name"] == "store_memory"
        assert isinstance(STORE_TOOL_DEF["description"], str)

        params = STORE_TOOL_DEF["parameters"]
        assert params["required"] == ["content", "memory_type", "title"]
        assert params["type"] == "object"

        props = params["properties"]
        # All properties must exist
        expected_props = {
            "content", "memory_type", "title", "trigger", "signals",
            "link_ids", "event_time", "cluster",
        }
        assert set(props.keys()) == expected_props

        # memory_type enum must be unchanged
        assert props["memory_type"]["enum"] == [
            "watchpoint", "curiosity", "lesson", "thesis", "episode", "trade", "signal",
        ]
        assert props["memory_type"]["type"] == "string"

        # Type checks
        assert props["content"]["type"] == "string"
        assert props["title"]["type"] == "string"
        assert props["trigger"]["type"] == "object"
        assert props["signals"]["type"] == "object"
        assert props["link_ids"]["type"] == "array"
        assert props["event_time"]["type"] == "string"
        assert props["cluster"]["type"] == "string"

    def test_recall_tool_def_structure(self):
        """RECALL_TOOL_DEF preserves all required fields, enums, and types."""
        from src.hynous.intelligence.tools.memory import RECALL_TOOL_DEF

        assert RECALL_TOOL_DEF["name"] == "recall_memory"
        assert isinstance(RECALL_TOOL_DEF["description"], str)

        params = RECALL_TOOL_DEF["parameters"]
        assert params["required"] == []
        assert params["type"] == "object"

        props = params["properties"]
        expected_props = {
            "mode", "query", "memory_type", "active_only", "limit",
            "time_start", "time_end", "time_type", "cluster",
        }
        assert set(props.keys()) == expected_props

        # mode enum
        assert props["mode"]["enum"] == ["search", "browse"]
        # memory_type enum must include trade lifecycle subtypes
        assert props["memory_type"]["enum"] == [
            "watchpoint", "curiosity", "lesson", "thesis", "episode", "trade", "signal",
            "trade_entry", "trade_modify", "trade_close",
        ]
        # time_type enum
        assert props["time_type"]["enum"] == ["event", "ingestion", "any"]

        # Type checks
        assert props["query"]["type"] == "string"
        assert props["active_only"]["type"] == "boolean"
        assert props["limit"]["type"] == "integer"
        assert props["cluster"]["type"] == "string"

    def test_store_description_contains_essentials(self):
        """Trimmed store_memory description still contains critical info."""
        from src.hynous.intelligence.tools.memory import STORE_TOOL_DEF
        desc = STORE_TOOL_DEF["description"]

        # All 7 memory types mentioned
        for mtype in ["episode", "lesson", "thesis", "signal", "watchpoint", "curiosity", "trade"]:
            assert mtype in desc, f"Memory type '{mtype}' missing from description"

        # Wikilink syntax
        assert "[[" in desc
        assert "wikilink" in desc.lower()

        # Dedup mention
        assert "duplicate" in desc.lower()

    def test_recall_description_contains_essentials(self):
        """Trimmed recall_memory description still contains critical info."""
        from src.hynous.intelligence.tools.memory import RECALL_TOOL_DEF
        desc = RECALL_TOOL_DEF["description"]

        # Search vs browse modes
        assert "search" in desc
        assert "browse" in desc

        # At least 1 example per mode
        assert '"query"' in desc
        assert '"mode": "browse"' in desc

    def test_store_description_is_trimmed(self):
        """store_memory description should be ~850 chars (was ~2666)."""
        from src.hynous.intelligence.tools.memory import STORE_TOOL_DEF
        desc = STORE_TOOL_DEF["description"]
        # Should be roughly 850 chars ± tolerance, definitely under 1200
        assert len(desc) < 1200, f"Description still too long: {len(desc)} chars"
        # Should NOT contain removed sections
        assert "BATCHING" not in desc
        assert "DEDUPLICATION" not in desc
        assert "Rule of thumb" not in desc

    def test_recall_description_is_trimmed(self):
        """recall_memory description should be ~500 chars (was ~1441)."""
        from src.hynous.intelligence.tools.memory import RECALL_TOOL_DEF
        desc = RECALL_TOOL_DEF["description"]
        # Should be roughly 500 chars ± tolerance, definitely under 800
        assert len(desc) < 800, f"Description still too long: {len(desc)} chars"

    def test_update_tool_def_not_modified(self):
        """UPDATE_TOOL_DEF must NOT be modified (out of scope for TO-2)."""
        from src.hynous.intelligence.tools.memory import UPDATE_TOOL_DEF
        assert UPDATE_TOOL_DEF["name"] == "update_memory"
        assert UPDATE_TOOL_DEF["parameters"]["required"] == ["node_id"]

    def test_handlers_not_modified(self):
        """Handler function signatures must be unchanged."""
        from src.hynous.intelligence.tools.memory import handle_store_memory, handle_recall_memory

        store_params = set(inspect.signature(handle_store_memory).parameters.keys())
        assert store_params == {
            "content", "memory_type", "title", "trigger", "signals",
            "link_ids", "event_time", "cluster",
        }

        recall_params = set(inspect.signature(handle_recall_memory).parameters.keys())
        assert recall_params == {
            "mode", "query", "memory_type", "active_only", "limit",
            "time_start", "time_end", "time_type", "cluster",
        }

    def test_register_function_exists(self):
        """register() function must still exist and be callable."""
        from src.hynous.intelligence.tools.memory import register
        assert callable(register)


# ====================================================================
# TO-3: Tiered Stale Tool Result Truncation
# ====================================================================


class TestTO3TieredTruncation:
    """Verify TO-3: tiered truncation map and _truncate_tool_entry logic."""

    def test_old_constant_removed(self):
        """_MAX_STALE_RESULT_CHARS must no longer exist."""
        from src.hynous.intelligence import agent as agent_module
        assert not hasattr(agent_module, "_MAX_STALE_RESULT_CHARS")

    def test_stale_truncation_dict_exists(self):
        """_STALE_TRUNCATION dict must exist with tiered limits."""
        from src.hynous.intelligence.agent import _STALE_TRUNCATION
        assert isinstance(_STALE_TRUNCATION, dict)
        assert len(_STALE_TRUNCATION) == 25

    def test_default_stale_limit_is_800(self):
        """_DEFAULT_STALE_LIMIT must be 800 (backward compat for unknown tools)."""
        from src.hynous.intelligence.agent import _DEFAULT_STALE_LIMIT
        assert _DEFAULT_STALE_LIMIT == 800

    def test_confirmation_tier_150(self):
        """Confirmation tools must have limit 150."""
        from src.hynous.intelligence.agent import _STALE_TRUNCATION
        confirmation_tools = [
            "store_memory", "update_memory", "delete_memory",
            "explore_memory", "manage_clusters",
        ]
        for tool in confirmation_tools:
            assert _STALE_TRUNCATION[tool] == 150, f"{tool} should be 150"

    def test_action_tier_300(self):
        """Action tools must have limit 300."""
        from src.hynous.intelligence.agent import _STALE_TRUNCATION
        action_tools = [
            "execute_trade", "close_position", "modify_position",
            "manage_watchpoints", "manage_conflicts",
        ]
        for tool in action_tools:
            assert _STALE_TRUNCATION[tool] == 300, f"{tool} should be 300"

    def test_data_tier_400(self):
        """Data tools must have limit 400."""
        from src.hynous.intelligence.agent import _STALE_TRUNCATION
        data_tools = [
            "get_market_data", "get_multi_timeframe", "get_orderbook",
            "get_funding_history", "get_liquidations", "get_options_flow",
            "get_institutional_flow", "get_global_sentiment",
            "get_trade_stats", "get_my_costs", "get_account",
        ]
        for tool in data_tools:
            assert _STALE_TRUNCATION[tool] == 400, f"{tool} should be 400"

    def test_search_tier_600(self):
        """Search tools must have limit 600."""
        from src.hynous.intelligence.agent import _STALE_TRUNCATION
        search_tools = ["recall_memory", "search_web"]
        for tool in search_tools:
            assert _STALE_TRUNCATION[tool] == 600, f"{tool} should be 600"

    def test_compact_messages_uses_tiered_truncation(self):
        """_compact_messages source must reference _STALE_TRUNCATION for tiered limits."""
        from src.hynous.intelligence.agent import Agent
        source = inspect.getsource(Agent._compact_messages)
        assert "_STALE_TRUNCATION" in source
        assert "_DEFAULT_STALE_LIMIT" in source

    def test_compact_messages_uses_tool_name(self):
        """_compact_messages looks up tool name for tiered limit (OpenAI format)."""
        from src.hynous.intelligence.agent import Agent
        source = inspect.getsource(Agent._compact_messages)
        # OpenAI format: tool name is directly on the message
        assert 'entry.get("name"' in source

    def test_truncate_confirmation_tool(self):
        """A store_memory result > 150 chars should be truncated to 150."""
        from src.hynous.intelligence.agent import _STALE_TRUNCATION, _DEFAULT_STALE_LIMIT
        content = "Stored: " + "x" * 200  # 208 chars, > 150
        tool_name = "store_memory"
        limit = _STALE_TRUNCATION.get(tool_name, _DEFAULT_STALE_LIMIT)
        assert limit == 150
        truncated = content[:limit] + "\n...[truncated, already processed]"
        assert len(truncated) < 200
        assert truncated.endswith("\n...[truncated, already processed]")

    def test_truncate_data_tool(self):
        """A get_market_data result > 400 chars should be truncated to 400."""
        from src.hynous.intelligence.agent import _STALE_TRUNCATION, _DEFAULT_STALE_LIMIT
        content = "BTC " + "data " * 200  # ~1004 chars
        tool_name = "get_market_data"
        limit = _STALE_TRUNCATION.get(tool_name, _DEFAULT_STALE_LIMIT)
        assert limit == 400
        truncated = content[:limit] + "\n...[truncated, already processed]"
        assert truncated.startswith("BTC data")
        suffix = "\n...[truncated, already processed]"
        assert len(truncated) == 400 + len(suffix)

    def test_truncate_search_tool(self):
        """A recall_memory result > 600 chars should be truncated to 600."""
        from src.hynous.intelligence.agent import _STALE_TRUNCATION, _DEFAULT_STALE_LIMIT
        content = "Found 10 memories:\n" + "result " * 200
        tool_name = "recall_memory"
        limit = _STALE_TRUNCATION.get(tool_name, _DEFAULT_STALE_LIMIT)
        assert limit == 600
        truncated = content[:limit] + "\n...[truncated, already processed]"
        suffix = "\n...[truncated, already processed]"
        assert len(truncated) == 600 + len(suffix)

    def test_truncate_unknown_tool_uses_default(self):
        """An unknown tool should use _DEFAULT_STALE_LIMIT (800)."""
        from src.hynous.intelligence.agent import _STALE_TRUNCATION, _DEFAULT_STALE_LIMIT
        content = "x" * 1000
        tool_name = "some_future_tool"
        limit = _STALE_TRUNCATION.get(tool_name, _DEFAULT_STALE_LIMIT)
        assert limit == 800
        truncated = content[:limit] + "\n...[truncated, already processed]"
        suffix = "\n...[truncated, already processed]"
        assert len(truncated) == 800 + len(suffix)

    def test_short_content_not_truncated(self):
        """Content under the limit should pass through unchanged."""
        from src.hynous.intelligence.agent import _STALE_TRUNCATION, _DEFAULT_STALE_LIMIT
        short_content = "Stored: ok"  # Well under 150
        tool_name = "store_memory"
        limit = _STALE_TRUNCATION.get(tool_name, _DEFAULT_STALE_LIMIT)
        assert len(short_content) <= limit  # No truncation needed

    def test_truncation_suffix_format(self):
        """The truncation suffix must be '\\n...[truncated, already processed]'."""
        from src.hynous.intelligence.agent import Agent
        source = inspect.getsource(Agent._compact_messages)
        assert "\\n...[truncated, already processed]" in source

    def test_memory_manager_format_exchange_not_modified(self):
        """_format_exchange in memory_manager.py must have its own 800-char truncation."""
        from src.hynous.intelligence.memory_manager import _format_exchange
        source = inspect.getsource(_format_exchange)
        assert "800" in source  # Independent 800-char truncation for Haiku compression


# ====================================================================
# TO-4: Window Size Reduction
# ====================================================================


class TestTO4WindowSize:
    """Verify TO-4: window_size is consistently 4 across all 3 locations."""

    def test_yaml_window_size_is_4(self):
        """config/default.yaml memory.window_size must be 4 (was 6)."""
        raw = _load_yaml_config()
        assert raw["memory"]["window_size"] == 4

    def test_dataclass_default_window_size_is_4(self):
        """MemoryConfig dataclass default must be 4."""
        from src.hynous.core.config import MemoryConfig
        cfg = MemoryConfig()
        assert cfg.window_size == 4

    def test_load_config_fallback_window_size_is_4(self):
        """load_config() hardcoded fallback for window_size must be 4 (not 6).

        This is the critical gotcha from TO-4: the fallback on line ~173
        must match the new default.
        """
        from src.hynous.core import config as config_module
        source = inspect.getsource(config_module.load_config)
        # Must have the new fallback value
        assert 'get("window_size", 4)' in source
        # Must NOT have the old fallback value
        assert 'get("window_size", 6)' not in source

    def test_maybe_compress_not_modified(self):
        """maybe_compress() must NOT be modified (reads from config dynamically)."""
        from src.hynous.intelligence.memory_manager import MemoryManager
        source = inspect.getsource(MemoryManager.maybe_compress)
        assert "self.config.memory.window_size" in source

    def test_group_exchanges_not_modified(self):
        """group_exchanges() must still be a staticmethod that groups history entries."""
        from src.hynous.intelligence.memory_manager import MemoryManager
        assert isinstance(
            inspect.getattr_static(MemoryManager, "group_exchanges"),
            staticmethod,
        )

    def test_all_three_locations_consistent(self):
        """All 3 locations (YAML, dataclass, load_config fallback) must agree on 4."""
        # YAML
        raw = _load_yaml_config()
        yaml_value = raw["memory"]["window_size"]

        # Dataclass default
        from src.hynous.core.config import MemoryConfig
        dataclass_value = MemoryConfig().window_size

        # load_config() output (reads from actual YAML)
        from src.hynous.core.config import load_config
        config = load_config()
        config_value = config.memory.window_size

        assert yaml_value == 4
        assert dataclass_value == 4
        assert config_value == 4
        assert yaml_value == dataclass_value == config_value


# ====================================================================
# Cross-cutting: Ensure no regressions
# ====================================================================


class TestCrossCutting:
    """Cross-cutting checks that span multiple TOs."""

    def test_load_config_produces_valid_config(self):
        """load_config() must still return a valid Config with all sections."""
        from src.hynous.core.config import load_config, Config
        config = load_config()
        assert isinstance(config, Config)
        assert config.agent.max_tokens == 2048
        assert config.memory.window_size == 4
        assert "claude-sonnet-4-5-20250929" in config.agent.model
        assert config.agent.temperature == 0.7

    def test_max_context_tokens_dataclass_vs_yaml(self):
        """Note: max_context_tokens dataclass default (800) differs from YAML (4000).

        This is a pre-existing inconsistency, NOT introduced by the TOs.
        The YAML value (4000) takes precedence at runtime.
        """
        from src.hynous.core.config import MemoryConfig, load_config
        # Dataclass default
        assert MemoryConfig().max_context_tokens == 800
        # YAML-loaded value
        config = load_config()
        assert config.memory.max_context_tokens == 4000
