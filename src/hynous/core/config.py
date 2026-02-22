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
    model: str = "openrouter/anthropic/claude-sonnet-4-5-20250929"  # OpenRouter: 1 key, all models
    max_tokens: int = 2048
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
    default_leverage: int = 10
    max_position_usd: float = 10000  # Safety cap per position
    default_slippage: float = 0.05   # 5% slippage tolerance for market orders


@dataclass
class MemoryConfig:
    """Tiered memory settings — working window + Nous-backed compression."""
    window_size: int = 4            # Complete exchanges to keep in working window
    max_context_tokens: int = 4000  # Token budget for injected recalled context
    retrieve_limit: int = 20        # Max Nous results per retrieval (token budget is the real limiter)
    compression_model: str = "openrouter/anthropic/claude-haiku-4-5-20251001"  # OpenRouter
    compress_enabled: bool = True   # Master switch for automatic compression
    gate_filter_enabled: bool = True  # Pre-storage quality gate (MF-15)


@dataclass
class OrchestratorConfig:
    """Intelligent Retrieval Orchestrator — multi-pass memory search."""
    enabled: bool = True                    # Master switch
    quality_threshold: float = 0.20         # Min top-result score to accept
    relevance_ratio: float = 0.4            # Dynamic cutoff: score >= top * ratio
    max_results: int = 20                   # Hard cap on merged results (token budget is the real limiter)
    max_sub_queries: int = 4                # Max decomposition parts
    max_retries: int = 1                    # Reformulation attempts per sub-query
    timeout_seconds: float = 3.0            # Total orchestration timeout
    search_limit_per_query: int = 25        # Results to fetch per sub-query (overfetch for quality gate)


@dataclass
class SectionsConfig:
    """Memory sections — brain-inspired bias layer on retrieval and decay.

    Sections are determined by subtype → section mapping (static lookup).
    These settings control the behavior overlay.
    See: revisions/memory-sections/executive-summary.md
    """
    enabled: bool = True                    # Master switch for section-aware behavior
    intent_boost: float = 1.3              # Score multiplier for query-relevant sections
    default_section: str = "KNOWLEDGE"     # Fallback section for unknown subtypes


@dataclass
class DaemonConfig:
    """Background daemon settings — watchdog + curiosity + periodic review."""
    enabled: bool = False                 # Master switch
    price_poll_interval: int = 60         # Seconds between Hyperliquid price polls
    deriv_poll_interval: int = 300        # Seconds between derivatives/sentiment polls
    periodic_interval: int = 3600         # Seconds between periodic market reviews
    curiosity_threshold: int = 3          # Pending curiosity items before learning session
    curiosity_check_interval: int = 900   # Seconds between curiosity queue checks
    # FSRS memory decay
    decay_interval: int = 21600           # Seconds between batch decay cycles (6 hours)
    # Contradiction queue polling
    conflict_check_interval: int = 1800   # Seconds between conflict queue checks (30 min)
    # Nous health monitoring
    health_check_interval: int = 3600     # Seconds between Nous health checks (1 hour)
    # Embedding backfill
    embedding_backfill_interval: int = 43200  # Seconds between embedding backfill runs (12 hours)
    # Consolidation (cross-episode generalization — Issue 3)
    consolidation_interval: int = 86400  # Seconds between consolidation cycles (24 hours)
    # Risk guardrails
    max_daily_loss_usd: float = 100       # Pause trading after this daily loss
    max_open_positions: int = 3           # Max simultaneous positions
    # Wake rate limiting
    max_wakes_per_hour: int = 6           # Rate limit on agent wakes
    wake_cooldown_seconds: int = 120      # Min seconds between non-priority wakes
    # Phantom tracker (inaction cost)
    phantom_check_interval: int = 1800          # Seconds between phantom evaluations (30 min)
    phantom_max_age_seconds: int = 14400        # Max phantom lifetime (4h, macro default)
    # Playbook matcher (Issue 5: procedural memory)
    playbook_cache_ttl: int = 1800              # Seconds between playbook cache refreshes (30 min)


@dataclass
class ScannerConfig:
    """Market scanner — anomaly detection across all Hyperliquid pairs."""
    enabled: bool = True                       # Master switch (requires daemon enabled)
    wake_threshold: float = 0.5                # Min severity to wake agent (0.0-1.0)
    max_anomalies_per_wake: int = 5            # Max anomalies bundled per wake
    dedup_ttl_minutes: int = 30                # Don't re-alert same anomaly within window
    # Price thresholds
    price_spike_5min_pct: float = 3.0          # % move in 5min
    price_spike_15min_pct: float = 5.0         # % move in 15min
    # Derivatives thresholds
    funding_extreme_percentile: float = 95     # Percentile cutoff
    funding_extreme_absolute: float = 0.001    # Absolute threshold (0.1%/8h)
    oi_surge_pct: float = 10.0                 # % OI change in 5min
    # Liquidation thresholds (USD)
    liq_cascade_min_usd: float = 5_000_000     # Per-coin 1h threshold
    liq_wave_min_usd: float = 50_000_000       # Market-wide 1h threshold
    # Noise filter
    min_oi_usd: float = 1_000_000              # Skip low-liquidity pairs
    # Micro trading (L2 + 5m candle detectors)
    book_poll_enabled: bool = True             # Fetch L2 orderbooks + 5m candles
    book_imbalance_flip_pct: float = 25.0      # Imbalance swing % to trigger book_flip
    momentum_5m_pct: float = 1.5               # 5m candle body % to trigger momentum_burst
    momentum_volume_mult: float = 2.0          # Volume multiplier vs rolling avg
    position_adverse_threshold: float = 0.40   # Imbalance threshold for adverse book signal
    # News integration (CryptoCompare)
    news_poll_enabled: bool = True             # Poll CryptoCompare for news (every deriv cycle)
    news_wake_max_age_minutes: int = 30        # Only alert on news < 30min old


@dataclass
class DataLayerConfig:
    """Hynous-Data service — Hyperliquid market intelligence."""
    url: str = "http://127.0.0.1:8100"
    enabled: bool = True
    timeout: int = 5


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
    openrouter_api_key: str = ""    # Single key for all LLM providers via OpenRouter
    hyperliquid_private_key: str = ""

    # Sub-configs
    agent: AgentConfig = field(default_factory=AgentConfig)
    nous: NousConfig = field(default_factory=NousConfig)
    execution: ExecutionConfig = field(default_factory=ExecutionConfig)
    memory: MemoryConfig = field(default_factory=MemoryConfig)
    hyperliquid: HyperliquidConfig = field(default_factory=HyperliquidConfig)
    daemon: DaemonConfig = field(default_factory=DaemonConfig)
    scanner: ScannerConfig = field(default_factory=ScannerConfig)
    discord: DiscordConfig = field(default_factory=DiscordConfig)
    orchestrator: OrchestratorConfig = field(default_factory=OrchestratorConfig)
    data_layer: DataLayerConfig = field(default_factory=DataLayerConfig)
    sections: SectionsConfig = field(default_factory=SectionsConfig)

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
    scanner_raw = raw.get("scanner", {})
    discord_raw = raw.get("discord", {})
    orch_raw = raw.get("orchestrator", {})
    dl_raw = raw.get("data_layer", {})
    sections_raw = raw.get("sections", {})

    return Config(
        openrouter_api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        hyperliquid_private_key=os.environ.get("HYPERLIQUID_PRIVATE_KEY", ""),
        agent=AgentConfig(
            model=agent_raw.get("model", "openrouter/anthropic/claude-sonnet-4-5-20250929"),
            max_tokens=agent_raw.get("max_tokens", 2048),
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
            window_size=mem_raw.get("window_size", 4),
            max_context_tokens=mem_raw.get("max_context_tokens", 4000),
            retrieve_limit=mem_raw.get("retrieve_limit", 20),
            compression_model=mem_raw.get("compression_model", "openrouter/anthropic/claude-haiku-4-5-20251001"),
            compress_enabled=mem_raw.get("compress_enabled", True),
            gate_filter_enabled=mem_raw.get("gate_filter_enabled", True),
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
            decay_interval=daemon_raw.get("decay_interval", 21600),
            conflict_check_interval=daemon_raw.get("conflict_check_interval", 1800),
            health_check_interval=daemon_raw.get("health_check_interval", 3600),
            embedding_backfill_interval=daemon_raw.get("embedding_backfill_interval", 43200),
            consolidation_interval=daemon_raw.get("consolidation_interval", 86400),
            max_daily_loss_usd=daemon_raw.get("max_daily_loss_usd", 100),
            max_open_positions=daemon_raw.get("max_open_positions", 3),
            max_wakes_per_hour=daemon_raw.get("max_wakes_per_hour", 6),
            wake_cooldown_seconds=daemon_raw.get("wake_cooldown_seconds", 120),
            phantom_check_interval=daemon_raw.get("phantom_check_interval", 1800),
            phantom_max_age_seconds=daemon_raw.get("phantom_max_age_seconds", 14400),
            playbook_cache_ttl=daemon_raw.get("playbook_cache_ttl", 1800),
        ),
        scanner=ScannerConfig(
            enabled=scanner_raw.get("enabled", True),
            wake_threshold=scanner_raw.get("wake_threshold", 0.5),
            max_anomalies_per_wake=scanner_raw.get("max_anomalies_per_wake", 5),
            dedup_ttl_minutes=scanner_raw.get("dedup_ttl_minutes", 30),
            price_spike_5min_pct=scanner_raw.get("price_spike_5min_pct", 3.0),
            price_spike_15min_pct=scanner_raw.get("price_spike_15min_pct", 5.0),
            funding_extreme_percentile=scanner_raw.get("funding_extreme_percentile", 95),
            funding_extreme_absolute=scanner_raw.get("funding_extreme_absolute", 0.001),
            oi_surge_pct=scanner_raw.get("oi_surge_pct", 10.0),
            liq_cascade_min_usd=scanner_raw.get("liq_cascade_min_usd", 5_000_000),
            liq_wave_min_usd=scanner_raw.get("liq_wave_min_usd", 50_000_000),
            min_oi_usd=scanner_raw.get("min_oi_usd", 1_000_000),
            book_poll_enabled=scanner_raw.get("book_poll_enabled", True),
            book_imbalance_flip_pct=scanner_raw.get("book_imbalance_flip_pct", 15.0),
            momentum_5m_pct=scanner_raw.get("momentum_5m_pct", 1.5),
            momentum_volume_mult=scanner_raw.get("momentum_volume_mult", 2.0),
            position_adverse_threshold=scanner_raw.get("position_adverse_threshold", 0.40),
            news_poll_enabled=scanner_raw.get("news_poll_enabled", True),
            news_wake_max_age_minutes=scanner_raw.get("news_wake_max_age_minutes", 30),
        ),
        discord=DiscordConfig(
            enabled=discord_raw.get("enabled", False),
            token=os.environ.get("DISCORD_BOT_TOKEN", ""),
            channel_id=discord_raw.get("channel_id", 0),
            stats_channel_id=discord_raw.get("stats_channel_id", 0),
            allowed_user_ids=discord_raw.get("allowed_user_ids", []),
        ),
        orchestrator=OrchestratorConfig(
            enabled=orch_raw.get("enabled", True),
            quality_threshold=orch_raw.get("quality_threshold", 0.20),
            relevance_ratio=orch_raw.get("relevance_ratio", 0.4),
            max_results=orch_raw.get("max_results", 20),
            max_sub_queries=orch_raw.get("max_sub_queries", 4),
            max_retries=orch_raw.get("max_retries", 1),
            timeout_seconds=orch_raw.get("timeout_seconds", 3.0),
            search_limit_per_query=orch_raw.get("search_limit_per_query", 25),
        ),
        data_layer=DataLayerConfig(
            url=dl_raw.get("url", "http://127.0.0.1:8100"),
            enabled=dl_raw.get("enabled", True),
            timeout=dl_raw.get("timeout", 5),
        ),
        sections=SectionsConfig(
            enabled=sections_raw.get("enabled", True),
            intent_boost=sections_raw.get("intent_boost", 1.3),
            default_section=sections_raw.get("default_section", "KNOWLEDGE"),
        ),
        project_root=root,
    )
