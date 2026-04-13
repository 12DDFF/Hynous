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
    model: str = "openrouter/x-ai/grok-4.1-fast"  # OpenRouter — runtime override via storage/model_prefs.json
    max_tokens: int = 2048
    temperature: float = 0.7


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
    # Playbook matcher (Issue 5: procedural memory)
    playbook_cache_ttl: int = 1800              # Seconds between playbook cache refreshes (30 min)
    # Peak profit protection
    peak_reversion_threshold_micro: float = 0.40  # Giveback fraction to alert on micro (40% = tight, fast trades)
    peak_reversion_threshold_macro: float = 0.50  # Giveback fraction to alert on macro (50% = swings breathe)
    breakeven_stop_enabled: bool = True            # Auto-move SL to entry buffer once fees are cleared
    breakeven_buffer_micro_pct: float = 0.07       # Price % buffer above entry (long) / below (short) — micro (equals round-trip fee → nets ~0%)
    breakeven_buffer_macro_pct: float = 0.07       # Same for macro — true breakeven regardless of trade type
    dynamic_sl_enabled: bool = True           # Master switch for dynamic protective SL
    # Trailing stop (mechanical exit — no agent involvement)
    trailing_stop_enabled: bool = True              # Master switch for trailing stop system
    trailing_activation_roe: float = 2.8            # ROE % to activate trailing (modeled optimum)
    trailing_retracement_pct: float = 50.0          # % of peak ROE to give back before stop fires (50% = trail at half peak)
    # Candle-based peak tracking (enhances MFE/MAE accuracy)
    candle_peak_tracking_enabled: bool = True       # Use 1m candle high/low for peak/trough tracking
    # WebSocket price feed (sub-second prices for trigger checks)
    ws_price_feed: bool = True               # Enable WS allMids feed for _fast_trigger_check
    # Satellite labeling (outcome labels for ML validation)
    labeler_interval: int = 3600             # Seconds between labeling runs (1 hour)
    labeler_batch_size: int = 50             # Max snapshots to label per coin per run
    # Condition model validation (automated live accuracy checks)
    validation_interval: int = 86400         # Seconds between validation runs (24 hours)
    validation_days: int = 7                 # Days of history to validate against


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
    # Peak reversion detector (mirrors DaemonConfig thresholds — scanner has its own ScannerConfig)
    peak_reversion_threshold_micro: float = 0.40  # Giveback fraction to fire peak_reversion for micro
    peak_reversion_threshold_macro: float = 0.50  # Giveback fraction to fire peak_reversion for macro


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
class SatelliteConfig:
    """ML satellite feature engine (SPEC-02/03)."""
    enabled: bool = False
    db_path: str = "storage/satellite.db"
    data_layer_db_path: str = "data-layer/storage/hynous-data.db"
    snapshot_interval: int = 300
    coins: list[str] = field(default_factory=lambda: ["BTC", "ETH", "SOL"])
    min_position_size_usd: float = 1000
    liq_cascade_threshold: float = 2.5
    liq_cascade_min_usd: float = 500_000
    store_raw_data: bool = True
    funding_settlement_hours: list[int] = field(
        default_factory=lambda: [0, 8, 16]
    )
    # Inference (SPEC-05)
    inference_entry_threshold: float = 3.0
    inference_conflict_margin: float = 1.0
    inference_shadow_mode: bool = True


# ============================================================================
# v2 configuration dataclasses
# ============================================================================

@dataclass
class V2JournalConfig:
    db_path: str = "storage/v2/journal.db"
    embeddings_model: str = "openai/text-embedding-3-small"
    embeddings_dim: int = 1536
    comparison_dim: int = 512
    wal_mode: bool = True
    busy_timeout_ms: int = 5000


@dataclass
class V2AnalysisAgentConfig:
    model: str = "anthropic/claude-sonnet-4.5"
    max_tokens: int = 4096
    temperature: float = 0.2
    retry_on_failure: bool = False
    batch_rejection_interval_s: int = 3600
    timeout_s: int = 60
    prompt_version: str = "v1"


@dataclass
class V2MechanicalEntryConfig:
    trigger_source: str = "ml_signal_driven"
    composite_entry_threshold: int = 50
    direction_confidence_threshold: float = 0.55
    require_entry_quality_pctl: int = 60
    max_vol_regime: str = "high"
    roe_target_pct: float = 10.0
    coin: str = "BTC"


@dataclass
class V2ConsolidationConfig:
    edges_enabled: bool = True
    edge_types: list[str] = field(default_factory=lambda: [
        "preceded_by", "followed_by", "same_regime_bucket",
        "same_rejection_reason", "rejection_vs_contemporaneous_trade",
    ])
    pattern_rollup_enabled: bool = True
    pattern_rollup_interval_hours: int = 168
    pattern_rollup_window_days: int = 30


@dataclass
class V2UserChatConfig:
    enabled: bool = True
    model: str = "anthropic/claude-opus-4"
    max_tokens: int = 4096
    temperature: float = 0.2
    tool_timeout_s: int = 30


# Back-compat alias — the M6 directive names this ``UserChatConfig``;
# the project convention keeps the ``V2`` prefix to group v2 sub-configs.
UserChatConfig = V2UserChatConfig


@dataclass
class V2Config:
    enabled: bool = True
    journal: V2JournalConfig = field(default_factory=V2JournalConfig)
    analysis_agent: V2AnalysisAgentConfig = field(default_factory=V2AnalysisAgentConfig)
    mechanical_entry: V2MechanicalEntryConfig = field(default_factory=V2MechanicalEntryConfig)
    consolidation: V2ConsolidationConfig = field(default_factory=V2ConsolidationConfig)
    user_chat: V2UserChatConfig = field(default_factory=V2UserChatConfig)


@dataclass
class Config:
    """Main application configuration."""

    # API keys (from environment)
    openrouter_api_key: str = ""    # Single key for all LLM providers via OpenRouter
    hyperliquid_private_key: str = ""

    # Sub-configs
    agent: AgentConfig = field(default_factory=AgentConfig)
    execution: ExecutionConfig = field(default_factory=ExecutionConfig)
    hyperliquid: HyperliquidConfig = field(default_factory=HyperliquidConfig)
    daemon: DaemonConfig = field(default_factory=DaemonConfig)
    scanner: ScannerConfig = field(default_factory=ScannerConfig)
    discord: DiscordConfig = field(default_factory=DiscordConfig)
    data_layer: DataLayerConfig = field(default_factory=DataLayerConfig)
    satellite: SatelliteConfig = field(default_factory=SatelliteConfig)
    v2: V2Config = field(default_factory=V2Config)

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
    exec_raw = raw.get("execution", {})
    hl_raw = raw.get("hyperliquid", {})
    daemon_raw = raw.get("daemon", {})
    scanner_raw = raw.get("scanner", {})
    discord_raw = raw.get("discord", {})
    dl_raw = raw.get("data_layer", {})
    sat_raw = raw.get("satellite", {})
    v2_raw = raw.get("v2", {}) or {}

    return Config(
        openrouter_api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        hyperliquid_private_key=os.environ.get("HYPERLIQUID_PRIVATE_KEY", ""),
        agent=AgentConfig(
            model=agent_raw.get("model", "openrouter/x-ai/grok-4.1-fast"),
            max_tokens=agent_raw.get("max_tokens", 2048),
            temperature=agent_raw.get("temperature", 0.7),
        ),
        execution=ExecutionConfig(
            mode=exec_raw.get("mode", "paper"),
            paper_balance=exec_raw.get("paper_balance", 50000),
            symbols=exec_raw.get("symbols", ["BTC", "ETH", "SOL"]),
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
            breakeven_stop_enabled=daemon_raw.get("breakeven_stop_enabled", True),
            breakeven_buffer_micro_pct=daemon_raw.get("breakeven_buffer_micro_pct", 0.07),
            breakeven_buffer_macro_pct=daemon_raw.get("breakeven_buffer_macro_pct", 0.07),
            dynamic_sl_enabled=daemon_raw.get("dynamic_sl_enabled", True),
            trailing_stop_enabled=daemon_raw.get("trailing_stop_enabled", True),
            candle_peak_tracking_enabled=daemon_raw.get("candle_peak_tracking_enabled", True),
            peak_reversion_threshold_micro=daemon_raw.get("peak_reversion_threshold_micro", 0.40),
            peak_reversion_threshold_macro=daemon_raw.get("peak_reversion_threshold_macro", 0.50),
            playbook_cache_ttl=daemon_raw.get("playbook_cache_ttl", 1800),
            ws_price_feed=daemon_raw.get("ws_price_feed", True),
            labeler_interval=daemon_raw.get("labeler_interval", 3600),
            labeler_batch_size=daemon_raw.get("labeler_batch_size", 50),
            validation_interval=daemon_raw.get("validation_interval", 86400),
            validation_days=daemon_raw.get("validation_days", 7),
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
            peak_reversion_threshold_micro=scanner_raw.get("peak_reversion_threshold_micro", 0.40),
            peak_reversion_threshold_macro=scanner_raw.get("peak_reversion_threshold_macro", 0.50),
        ),
        discord=DiscordConfig(
            enabled=discord_raw.get("enabled", False),
            token=os.environ.get("DISCORD_BOT_TOKEN", ""),
            channel_id=discord_raw.get("channel_id", 0),
            stats_channel_id=discord_raw.get("stats_channel_id", 0),
            allowed_user_ids=discord_raw.get("allowed_user_ids", []),
        ),
        data_layer=DataLayerConfig(
            url=dl_raw.get("url", "http://127.0.0.1:8100"),
            enabled=dl_raw.get("enabled", True),
            timeout=dl_raw.get("timeout", 5),
        ),
        satellite=SatelliteConfig(
            enabled=sat_raw.get("enabled", False),
            db_path=sat_raw.get("db_path", "storage/satellite.db"),
            data_layer_db_path=sat_raw.get(
                "data_layer_db_path", "data-layer/storage/hynous-data.db",
            ),
            snapshot_interval=sat_raw.get("snapshot_interval", 300),
            coins=sat_raw.get("coins", ["BTC", "ETH", "SOL"]),
            min_position_size_usd=sat_raw.get("min_position_size_usd", 1000),
            liq_cascade_threshold=sat_raw.get("liq_cascade_threshold", 2.5),
            liq_cascade_min_usd=sat_raw.get("liq_cascade_min_usd", 500_000),
            store_raw_data=sat_raw.get("store_raw_data", True),
            funding_settlement_hours=sat_raw.get(
                "funding_settlement_hours", [0, 8, 16],
            ),
            inference_entry_threshold=sat_raw.get("inference_entry_threshold", 3.0),
            inference_conflict_margin=sat_raw.get("inference_conflict_margin", 1.0),
            inference_shadow_mode=sat_raw.get("inference_shadow_mode", True),
        ),
        v2=V2Config(
            enabled=v2_raw.get("enabled", True),
            journal=V2JournalConfig(
                db_path=v2_raw.get("journal", {}).get("db_path", "storage/v2/journal.db"),
                embeddings_model=v2_raw.get("journal", {}).get("embeddings_model", "openai/text-embedding-3-small"),
                embeddings_dim=v2_raw.get("journal", {}).get("embeddings_dim", 1536),
                comparison_dim=v2_raw.get("journal", {}).get("comparison_dim", 512),
                wal_mode=v2_raw.get("journal", {}).get("wal_mode", True),
                busy_timeout_ms=v2_raw.get("journal", {}).get("busy_timeout_ms", 5000),
            ),
            analysis_agent=V2AnalysisAgentConfig(
                model=v2_raw.get("analysis_agent", {}).get("model", "anthropic/claude-sonnet-4.5"),
                max_tokens=v2_raw.get("analysis_agent", {}).get("max_tokens", 4096),
                temperature=v2_raw.get("analysis_agent", {}).get("temperature", 0.2),
                retry_on_failure=v2_raw.get("analysis_agent", {}).get("retry_on_failure", False),
                batch_rejection_interval_s=v2_raw.get("analysis_agent", {}).get("batch_rejection_interval_s", 3600),
                timeout_s=v2_raw.get("analysis_agent", {}).get("timeout_s", 60),
                prompt_version=v2_raw.get("analysis_agent", {}).get("prompt_version", "v1"),
            ),
            mechanical_entry=V2MechanicalEntryConfig(
                trigger_source=v2_raw.get("mechanical_entry", {}).get("trigger_source", "ml_signal_driven"),
                composite_entry_threshold=v2_raw.get("mechanical_entry", {}).get("composite_entry_threshold", 50),
                direction_confidence_threshold=v2_raw.get("mechanical_entry", {}).get("direction_confidence_threshold", 0.55),
                require_entry_quality_pctl=v2_raw.get("mechanical_entry", {}).get("require_entry_quality_pctl", 60),
                max_vol_regime=v2_raw.get("mechanical_entry", {}).get("max_vol_regime", "high"),
                roe_target_pct=v2_raw.get("mechanical_entry", {}).get("roe_target_pct", 10.0),
                coin=v2_raw.get("mechanical_entry", {}).get("coin", "BTC"),
            ),
            consolidation=V2ConsolidationConfig(
                edges_enabled=v2_raw.get("consolidation", {}).get("edges_enabled", True),
                edge_types=v2_raw.get("consolidation", {}).get("edge_types", [
                    "preceded_by", "followed_by", "same_regime_bucket",
                    "same_rejection_reason", "rejection_vs_contemporaneous_trade",
                ]),
                pattern_rollup_enabled=v2_raw.get("consolidation", {}).get("pattern_rollup_enabled", True),
                pattern_rollup_interval_hours=v2_raw.get("consolidation", {}).get("pattern_rollup_interval_hours", 168),
                pattern_rollup_window_days=v2_raw.get("consolidation", {}).get("pattern_rollup_window_days", 30),
            ),
            user_chat=V2UserChatConfig(
                enabled=v2_raw.get("user_chat", {}).get("enabled", True),
                model=v2_raw.get("user_chat", {}).get("model", "anthropic/claude-opus-4"),
                max_tokens=v2_raw.get("user_chat", {}).get("max_tokens", 4096),
                temperature=v2_raw.get("user_chat", {}).get("temperature", 0.2),
                tool_timeout_s=v2_raw.get("user_chat", {}).get("tool_timeout_s", 30),
            ),
        ),
        project_root=root,
    )
