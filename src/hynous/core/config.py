"""
Configuration loading for Hynous.

Loads settings from config/default.yaml and environment variables.
"""

import os
import yaml
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional


def _find_project_root() -> Path:
    """Walk up from this file to find the project root (where config/ lives)."""
    current = Path(__file__).resolve().parent
    for _ in range(10):
        if (current / "config").is_dir():
            return current
        current = current.parent
    raise FileNotFoundError("Could not find project root (no config/ directory found)")


@dataclass
class AgentConfig:
    model: str = "claude-sonnet-4-5-20250929"
    max_tokens: int = 4096
    temperature: float = 0.7


@dataclass
class NousConfig:
    url: str = "http://localhost:3100"
    server_dir: str = "~/Desktop/nous-build/packages/server"
    db_path: str = "storage/nous.db"
    auto_retrieve_limit: int = 5


@dataclass
class ExecutionConfig:
    mode: str = "paper"  # paper | testnet | live_confirm | live_auto
    paper_balance: float = 50000
    symbols: list[str] = field(default_factory=lambda: ["BTC", "ETH", "SOL"])


@dataclass
class HyperliquidConfig:
    """Hyperliquid exchange settings."""
    mainnet_url: str = "https://api.hyperliquid.xyz"
    testnet_url: str = "https://api.hyperliquid-testnet.xyz"
    default_leverage: int = 5
    max_position_usd: float = 10000  # Safety cap per position
    default_slippage: float = 0.05   # 5% slippage tolerance for market orders


@dataclass
class MemoryConfig:
    """Tiered memory settings — working window + Nous-backed compression."""
    window_size: int = 6            # Complete exchanges to keep in working window
    max_context_tokens: int = 800   # Token budget for injected recalled context
    retrieve_limit: int = 5         # Max Nous results per retrieval
    compression_model: str = "claude-haiku-4-5-20251001"
    compress_enabled: bool = True   # Master switch for automatic compression


@dataclass
class DaemonConfig:
    """Background daemon settings — watchdog + curiosity + periodic review."""
    enabled: bool = False                 # Master switch
    price_poll_interval: int = 60         # Seconds between Hyperliquid price polls
    deriv_poll_interval: int = 300        # Seconds between derivatives/sentiment polls
    periodic_interval: int = 3600         # Seconds between periodic market reviews
    curiosity_threshold: int = 3          # Pending curiosity items before learning session
    curiosity_check_interval: int = 900   # Seconds between curiosity queue checks
    # Risk guardrails
    max_daily_loss_usd: float = 100       # Pause trading after this daily loss
    max_open_positions: int = 3           # Max simultaneous positions
    # Wake rate limiting
    max_wakes_per_hour: int = 6           # Rate limit on agent wakes
    wake_cooldown_seconds: int = 120      # Min seconds between non-priority wakes


@dataclass
class DiscordConfig:
    """Discord bot settings — chat relay + daemon notifications."""
    enabled: bool = False
    token: str = ""              # from DISCORD_BOT_TOKEN env var
    channel_id: int = 0          # channel for notifications + chat
    stats_channel_id: int = 0    # separate channel for stats panel (0 = use channel_id)
    allowed_user_ids: list[int] = field(default_factory=list)  # only respond to these Discord users (empty = any)


@dataclass
class Config:
    """Main application configuration."""

    # API keys (from environment)
    anthropic_api_key: str = ""
    hyperliquid_private_key: str = ""

    # Sub-configs
    agent: AgentConfig = field(default_factory=AgentConfig)
    nous: NousConfig = field(default_factory=NousConfig)
    execution: ExecutionConfig = field(default_factory=ExecutionConfig)
    memory: MemoryConfig = field(default_factory=MemoryConfig)
    hyperliquid: HyperliquidConfig = field(default_factory=HyperliquidConfig)
    daemon: DaemonConfig = field(default_factory=DaemonConfig)
    discord: DiscordConfig = field(default_factory=DiscordConfig)

    # Paths
    project_root: Path = field(default_factory=_find_project_root)


def load_config(config_path: Optional[str] = None) -> Config:
    """Load configuration from YAML file and environment variables."""
    root = _find_project_root()

    # Load YAML
    yaml_path = Path(config_path) if config_path else root / "config" / "default.yaml"
    raw = {}
    if yaml_path.exists():
        with open(yaml_path) as f:
            raw = yaml.safe_load(f) or {}

    # Load .env if it exists (simple key=value parsing)
    env_path = root / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip())

    # Build config
    agent_raw = raw.get("agent", {})
    nous_raw = raw.get("nous", {})
    exec_raw = raw.get("execution", {})
    mem_raw = raw.get("memory", {})
    hl_raw = raw.get("hyperliquid", {})
    daemon_raw = raw.get("daemon", {})
    discord_raw = raw.get("discord", {})

    return Config(
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        hyperliquid_private_key=os.environ.get("HYPERLIQUID_PRIVATE_KEY", ""),
        agent=AgentConfig(
            model=agent_raw.get("model", "claude-sonnet-4-5-20250929"),
            max_tokens=agent_raw.get("max_tokens", 4096),
            temperature=agent_raw.get("temperature", 0.7),
        ),
        nous=NousConfig(
            url=nous_raw.get("url", "http://localhost:3100"),
            server_dir=nous_raw.get("server_dir", "~/Desktop/nous-build/packages/server"),
            db_path=nous_raw.get("db_path", "storage/nous.db"),
            auto_retrieve_limit=nous_raw.get("auto_retrieve_limit", 5),
        ),
        execution=ExecutionConfig(
            mode=exec_raw.get("mode", "paper"),
            paper_balance=exec_raw.get("paper_balance", 50000),
            symbols=exec_raw.get("symbols", ["BTC", "ETH", "SOL"]),
        ),
        memory=MemoryConfig(
            window_size=mem_raw.get("window_size", 6),
            max_context_tokens=mem_raw.get("max_context_tokens", 800),
            retrieve_limit=mem_raw.get("retrieve_limit", 5),
            compression_model=mem_raw.get("compression_model", "claude-haiku-4-5-20251001"),
            compress_enabled=mem_raw.get("compress_enabled", True),
        ),
        hyperliquid=HyperliquidConfig(
            mainnet_url=hl_raw.get("mainnet_url", "https://api.hyperliquid.xyz"),
            testnet_url=hl_raw.get("testnet_url", "https://api.hyperliquid-testnet.xyz"),
            default_leverage=hl_raw.get("default_leverage", 5),
            max_position_usd=hl_raw.get("max_position_usd", 10000),
            default_slippage=hl_raw.get("default_slippage", 0.05),
        ),
        daemon=DaemonConfig(
            enabled=daemon_raw.get("enabled", False),
            price_poll_interval=daemon_raw.get("price_poll_interval", 60),
            deriv_poll_interval=daemon_raw.get("deriv_poll_interval", 300),
            periodic_interval=daemon_raw.get("periodic_interval", 3600),
            curiosity_threshold=daemon_raw.get("curiosity_threshold", 3),
            curiosity_check_interval=daemon_raw.get("curiosity_check_interval", 900),
            max_daily_loss_usd=daemon_raw.get("max_daily_loss_usd", 100),
            max_open_positions=daemon_raw.get("max_open_positions", 3),
            max_wakes_per_hour=daemon_raw.get("max_wakes_per_hour", 6),
            wake_cooldown_seconds=daemon_raw.get("wake_cooldown_seconds", 120),
        ),
        discord=DiscordConfig(
            enabled=discord_raw.get("enabled", False),
            token=os.environ.get("DISCORD_BOT_TOKEN", ""),
            channel_id=discord_raw.get("channel_id", 0),
            stats_channel_id=discord_raw.get("stats_channel_id", 0),
            allowed_user_ids=discord_raw.get("allowed_user_ids", []),
        ),
        project_root=root,
    )
