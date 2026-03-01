"""Satellite configuration."""

from dataclasses import dataclass, field

from satellite.safety import SafetyConfig


@dataclass
class SatelliteConfig:
    enabled: bool = True
    db_path: str = "storage/satellite.db"
    snapshot_interval: int = 300  # seconds between snapshots
    coins: list[str] = field(default_factory=lambda: ["BTC", "ETH", "SOL"])

    # Feature computation
    min_position_size_usd: float = 1000  # noise filter for heatmap features
    liq_cascade_threshold: float = 2.5   # liq_1h_vs_4h_avg ratio for cascade flag
    liq_cascade_min_usd: float = 500_000  # minimum total liq USD for cascade

    # Data-layer DB path (for read-only historical queries)
    data_layer_db_path: str = "storage/hynous-data.db"

    # Raw data storage
    store_raw_data: bool = True  # store raw API responses (~1.5GB/yr)

    # Funding settlement times (UTC hours)
    funding_settlement_hours: list[int] = field(
        default_factory=lambda: [0, 8, 16],
    )

    # Safety (SPEC-06)
    safety: SafetyConfig = field(default_factory=SafetyConfig)

    # Monitoring
    health_report_interval: int = 86400    # daily health report (seconds)
    health_report_discord: bool = True     # send to Discord
