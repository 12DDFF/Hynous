"""Configuration loading for hynous-data."""

import os
import yaml
from pathlib import Path
from dataclasses import dataclass, field


def _find_project_root() -> Path:
    """Walk up from this file to find the project root (where config/ lives)."""
    current = Path(__file__).resolve().parent
    for _ in range(10):
        if (current / "config").is_dir():
            return current
        current = current.parent
    raise FileNotFoundError("Could not find project root (no config/ directory found)")


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8100


@dataclass
class DbConfig:
    path: str = "storage/hynous-data.db"
    prune_days: int = 7


@dataclass
class RateLimitConfig:
    max_weight_per_min: int = 1200
    safety_pct: int = 85


@dataclass
class TradeStreamConfig:
    enabled: bool = True


@dataclass
class PositionPollerConfig:
    enabled: bool = True
    workers: int = 8
    tier1_interval: int = 30
    tier2_interval: int = 120
    tier3_interval: int = 600
    whale_threshold: float = 1_000_000
    mid_threshold: float = 100_000


@dataclass
class HlpTrackerConfig:
    enabled: bool = True
    poll_interval: int = 60
    vaults: list[str] = field(default_factory=lambda: [
        "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303",
        "0x010461c14e146ac35fe42271bdc1134ee31c703a",
        "0x35cfc9c671b9a2f43fa23f3f08fb46e6a893463e",
    ])


@dataclass
class HeatmapConfig:
    recompute_interval: int = 10
    bucket_count: int = 50
    range_pct: float = 15.0


@dataclass
class OrderFlowConfig:
    windows: list[int] = field(default_factory=lambda: [60, 300, 900, 3600])


@dataclass
class SmartMoneyConfig:
    profile_window_days: int = 7
    profile_refresh_hours: int = 2
    min_equity: float = 50_000
    min_trades_for_profile: int = 5
    bot_trades_per_day: float = 50
    bot_avg_hold_min: float = 2
    max_profiles_per_cycle: int = 50
    alert_min_size_usd: float = 50_000
    alert_min_win_rate: float = 0.55
    # Auto-curation
    auto_curate_enabled: bool = True
    auto_curate_min_win_rate: float = 0.55
    auto_curate_min_trades: int = 10
    auto_curate_min_profit_factor: float = 1.5
    auto_curate_max_wallets: int = 20
    auto_curate_exclude_bots: bool = True


@dataclass
class Config:
    server: ServerConfig = field(default_factory=ServerConfig)
    db: DbConfig = field(default_factory=DbConfig)
    rate_limit: RateLimitConfig = field(default_factory=RateLimitConfig)
    trade_stream: TradeStreamConfig = field(default_factory=TradeStreamConfig)
    position_poller: PositionPollerConfig = field(default_factory=PositionPollerConfig)
    hlp_tracker: HlpTrackerConfig = field(default_factory=HlpTrackerConfig)
    heatmap: HeatmapConfig = field(default_factory=HeatmapConfig)
    order_flow: OrderFlowConfig = field(default_factory=OrderFlowConfig)
    smart_money: SmartMoneyConfig = field(default_factory=SmartMoneyConfig)
    project_root: Path = field(default_factory=_find_project_root)


def load_config(config_path: str | None = None) -> Config:
    """Load configuration from YAML file."""
    root = _find_project_root()

    yaml_path = Path(config_path) if config_path else root / "config" / "default.yaml"
    raw: dict = {}
    if yaml_path.exists():
        with open(yaml_path) as f:
            raw = yaml.safe_load(f) or {}

    # Load .env if present
    env_path = root / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip())

    def _sub(cls, key):
        d = raw.get(key, {})
        # Only pass keys that match dataclass fields
        valid = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**valid)

    return Config(
        server=_sub(ServerConfig, "server"),
        db=_sub(DbConfig, "db"),
        rate_limit=_sub(RateLimitConfig, "rate_limit"),
        trade_stream=_sub(TradeStreamConfig, "trade_stream"),
        position_poller=_sub(PositionPollerConfig, "position_poller"),
        hlp_tracker=_sub(HlpTrackerConfig, "hlp_tracker"),
        heatmap=_sub(HeatmapConfig, "heatmap"),
        order_flow=_sub(OrderFlowConfig, "order_flow"),
        smart_money=_sub(SmartMoneyConfig, "smart_money"),
        project_root=root,
    )
