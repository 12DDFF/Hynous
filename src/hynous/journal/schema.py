"""Dataclass definitions for v2 trade journal snapshots, events, and exits.

These dataclasses define the rich capture format for every trade. They are
serialized as JSON blobs in the staging (phase 1) and journal (phase 2)
SQLite databases.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# ============================================================================
# Entry snapshot components
# ============================================================================


@dataclass(slots=True)
class TradeBasics:
    """Core identification + fill details."""

    trade_id: str
    symbol: str
    side: str               # "long" | "short"
    trade_type: str         # "macro" | "micro"
    entry_ts: str           # ISO 8601 UTC
    entry_px: float
    sl_px: float | None
    tp_px: float | None
    leverage: int
    size_base: float        # e.g. 0.05 (BTC amount)
    size_usd: float         # notional in USD
    margin_usd: float       # size_usd / leverage
    fill_slippage_bps: float
    fees_paid_usd: float


@dataclass(slots=True)
class TriggerContext:
    """What caused this entry to fire."""

    trigger_source: str         # "scanner" | "ml_signal" | "manual" | "mechanical"
    trigger_type: str           # e.g. "book_flip" | "composite_score"
    wake_source_id: str | None
    scanner_score: float | None
    scanner_detail: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class MLSnapshot:
    """Complete ML signal state at entry."""

    # Composite entry score
    composite_entry_score: float | None
    composite_label: str | None
    composite_components: dict[str, float] = field(default_factory=dict)

    # Entry quality model
    entry_quality_value: float | None = None
    entry_quality_percentile: int | None = None
    entry_quality_regime: str | None = None

    # Volatility models
    vol_1h_value: float | None = None
    vol_1h_percentile: int | None = None
    vol_1h_regime: str | None = None
    vol_4h_value: float | None = None
    vol_4h_percentile: int | None = None
    vol_4h_regime: str | None = None
    vol_expand_value: float | None = None
    vol_expand_regime: str | None = None
    vol_of_vol_value: float | None = None

    # Range / move models
    range_30m_value: float | None = None
    range_30m_regime: str | None = None
    move_30m_value: float | None = None
    move_30m_regime: str | None = None

    # Volume model
    volume_1h_value: float | None = None
    volume_1h_regime: str | None = None

    # Momentum model
    momentum_quality_value: float | None = None
    momentum_quality_regime: str | None = None

    # MAE models
    mae_long_value: float | None = None
    mae_long_percentile: int | None = None
    mae_long_regime: str | None = None
    mae_short_value: float | None = None
    mae_short_percentile: int | None = None
    mae_short_regime: str | None = None

    # SL survival models
    sl_survival_03: float | None = None
    sl_survival_05: float | None = None

    # Funding model
    funding_4h_value: float | None = None
    funding_4h_percentile: int | None = None
    funding_4h_regime: str | None = None

    # Direction model
    direction_signal: str | None = None
    direction_long_roe: float | None = None
    direction_short_roe: float | None = None
    direction_shap_top5: list[dict[str, Any]] = field(default_factory=list)

    # Metadata
    predictions_timestamp: float | None = None
    predictions_staleness_s: float | None = None


@dataclass(slots=True)
class MarketState:
    """Market data at entry."""

    mid_price: float
    bid: float | None = None
    ask: float | None = None
    spread_bps: float | None = None
    best_bid_size: float | None = None
    best_ask_size: float | None = None
    book_imbalance: float | None = None
    depth_usd_20bp_bid: float | None = None
    depth_usd_20bp_ask: float | None = None

    # Price changes
    pct_change_1m: float | None = None
    pct_change_5m: float | None = None
    pct_change_15m: float | None = None
    pct_change_1h: float | None = None
    pct_change_4h: float | None = None
    pct_change_24h: float | None = None

    # Volume
    volume_1h_usd: float | None = None
    volume_4h_usd: float | None = None
    volume_24h_usd: float | None = None

    # Volatility (realized)
    realized_vol_1h_pct: float | None = None
    realized_vol_4h_pct: float | None = None


@dataclass(slots=True)
class DerivativesState:
    """Derivatives metrics at entry."""

    funding_rate: float | None = None
    funding_8h_cumulative: float | None = None
    hours_to_next_funding: float | None = None
    open_interest: float | None = None
    oi_change_1h_pct: float | None = None
    oi_change_4h_pct: float | None = None
    oi_zscore_30d: float | None = None
    cross_exchange_oi_usd: float | None = None


@dataclass(slots=True)
class LiquidationTerrain:
    """Liquidation clusters at entry."""

    clusters_above: list[dict[str, Any]] = field(default_factory=list)
    clusters_below: list[dict[str, Any]] = field(default_factory=list)
    total_1h_long_liq_usd: float | None = None
    total_1h_short_liq_usd: float | None = None
    total_4h_long_liq_usd: float | None = None
    total_4h_short_liq_usd: float | None = None
    liq_ratio_1h: float | None = None
    cascade_active: bool = False


@dataclass(slots=True)
class OrderFlowState:
    """Order flow metrics from data-layer at entry."""

    cvd_30m: float | None = None
    cvd_1h: float | None = None
    cvd_acceleration: float | None = None
    buy_sell_ratio_1m: float | None = None
    buy_sell_ratio_5m: float | None = None
    buy_sell_ratio_15m: float | None = None
    buy_sell_ratio_1h: float | None = None
    large_trade_count_1h: int | None = None


@dataclass(slots=True)
class SmartMoneyContext:
    """HLP and whale context at entry."""

    hlp_net_delta_usd: float | None = None
    hlp_side: str | None = None
    hlp_size_usd: float | None = None
    top_whale_positions: list[dict[str, Any]] = field(default_factory=list)
    smart_money_opens_1h: int = 0


@dataclass(slots=True)
class TimeContext:
    """Temporal context at entry."""

    hour_utc: int = 0
    day_of_week: int = 0       # 0=Monday, 6=Sunday
    session: str = "unknown"   # "asia" | "eu" | "us" | "overlap_*" | "off_hours"
    time_to_next_funding_s: int = 0


@dataclass(slots=True)
class AccountContext:
    """Account state at entry."""

    portfolio_value_usd: float = 0.0
    portfolio_initial_usd: float = 0.0
    daily_pnl_so_far_usd: float = 0.0
    open_positions_count: int = 0
    open_position_symbols: list[str] = field(default_factory=list)
    entries_today_count: int = 0
    trading_paused: bool = False


@dataclass(slots=True)
class SettingsSnapshot:
    """Reference to active trading settings at entry."""

    settings_hash: str = ""
    settings_version: str | None = None


@dataclass(slots=True)
class PriceHistoryContext:
    """Preceding price path as candle lists."""

    candles_1m_15min: list[list[float]] = field(default_factory=list)
    candles_5m_4h: list[list[float]] = field(default_factory=list)


@dataclass(slots=True)
class TradeEntrySnapshot:
    """Complete entry snapshot. Persisted as JSON in staging/journal."""

    trade_basics: TradeBasics
    trigger_context: TriggerContext
    ml_snapshot: MLSnapshot
    market_state: MarketState
    derivatives_state: DerivativesState
    liquidation_terrain: LiquidationTerrain
    order_flow_state: OrderFlowState
    smart_money_context: SmartMoneyContext
    time_context: TimeContext
    account_context: AccountContext
    settings_snapshot: SettingsSnapshot
    price_history: PriceHistoryContext
    schema_version: str = "1.0.0"


# ============================================================================
# Exit snapshot components
# ============================================================================


@dataclass(slots=True)
class TradeOutcome:
    """Core outcome metrics at exit."""

    exit_ts: str
    exit_px: float
    exit_classification: str
    realized_pnl_usd: float
    realized_pnl_pct: float
    roe_at_exit: float
    fees_paid_usd: float
    hold_duration_s: int
    slippage_vs_trigger_bps: float | None = None


@dataclass(slots=True)
class ROETrajectory:
    """Summary of ROE path during the hold."""

    peak_roe: float = 0.0
    peak_roe_ts: str = ""
    peak_roe_price: float = 0.0
    trough_roe: float = 0.0
    trough_roe_ts: str = ""
    trough_roe_price: float = 0.0
    time_to_peak_s: int = 0
    time_to_trough_s: int = 0
    mfe_usd: float = 0.0
    mae_usd: float = 0.0


@dataclass(slots=True)
class Counterfactuals:
    """Post-hoc analysis of the trade path beyond the exit."""

    counterfactual_window_s: int = 0
    max_favorable_price: float = 0.0
    max_adverse_price: float = 0.0
    optimal_exit_px: float = 0.0
    optimal_exit_ts: str = ""
    did_tp_hit_later: bool = False
    did_tp_hit_ts: str | None = None
    did_sl_get_hunted: bool = False
    sl_hunt_reversal_pct: float | None = None


@dataclass(slots=True)
class MLExitComparison:
    """ML state at exit for comparison vs entry."""

    composite_score_at_exit: float | None = None
    composite_score_delta: float | None = None
    vol_regime_at_exit: str | None = None
    vol_regime_changed: bool = False
    entry_quality_pctl_at_exit: int | None = None
    direction_signal_at_exit: str | None = None
    direction_signal_changed: bool = False
    mae_long_value_at_exit: float | None = None
    mae_short_value_at_exit: float | None = None


@dataclass(slots=True)
class TradeExitSnapshot:
    """Complete exit snapshot. Persisted as JSON in staging/journal."""

    trade_id: str
    trade_outcome: TradeOutcome
    roe_trajectory: ROETrajectory
    counterfactuals: Counterfactuals
    ml_exit_comparison: MLExitComparison
    market_state_at_exit: MarketState
    price_path_1m: list[list[float]] = field(default_factory=list)
    schema_version: str = "1.0.0"


# ============================================================================
# Lifecycle event
# ============================================================================


@dataclass(slots=True)
class LifecycleEvent:
    """A single mechanical event during a trade's hold."""

    event_id: int | None
    trade_id: str
    ts: str
    event_type: str
    payload: dict[str, Any] = field(default_factory=dict)


# ============================================================================
# Reconstruction helpers (phase 2)
#
# Phase 1 persists dataclass instances as JSON (via dataclasses.asdict +
# json.dumps). Phase 2 needs the reverse direction so JournalStore.get_trade()
# can return typed objects to the analysis agent. These helpers are
# exhaustive — they enumerate every nested dataclass field explicitly. Do NOT
# attempt to collapse into a generic recursive walker; the dataclasses have
# irregular shapes (list[dict] fields like ``clusters_above``,
# ``top_whale_positions``, ``direction_shap_top5``, ``candles_1m_15min`` stay
# as-is).
# ============================================================================


def entry_snapshot_from_dict(data: dict[str, Any]) -> TradeEntrySnapshot:
    """Reconstruct a ``TradeEntrySnapshot`` from a JSON-loaded dict.

    Args:
        data: dict previously produced by ``dataclasses.asdict(snapshot)``.
            Must contain every top-level key of :class:`TradeEntrySnapshot`.

    Raises:
        KeyError: if a required top-level section key is missing from the
            payload (indicates schema drift or a corrupt row — caller should
            log and skip, not swallow).
        TypeError: if a top-level section is present but cannot be
            reconstructed into its dataclass (missing required fields or
            wrong shape). Treat this the same as schema drift — log and skip.

    Returns:
        Fully-hydrated :class:`TradeEntrySnapshot` with every nested dataclass
        instantiated.
    """
    return TradeEntrySnapshot(
        trade_basics=TradeBasics(**data["trade_basics"]),
        trigger_context=TriggerContext(**data["trigger_context"]),
        ml_snapshot=MLSnapshot(**data["ml_snapshot"]),
        market_state=MarketState(**data["market_state"]),
        derivatives_state=DerivativesState(**data["derivatives_state"]),
        liquidation_terrain=LiquidationTerrain(**data["liquidation_terrain"]),
        order_flow_state=OrderFlowState(**data["order_flow_state"]),
        smart_money_context=SmartMoneyContext(**data["smart_money_context"]),
        time_context=TimeContext(**data["time_context"]),
        account_context=AccountContext(**data["account_context"]),
        settings_snapshot=SettingsSnapshot(**data["settings_snapshot"]),
        price_history=PriceHistoryContext(**data["price_history"]),
        schema_version=data.get("schema_version", "1.0.0"),
    )


def exit_snapshot_from_dict(data: dict[str, Any]) -> TradeExitSnapshot:
    """Reconstruct a ``TradeExitSnapshot`` from a JSON-loaded dict.

    Args:
        data: dict previously produced by ``dataclasses.asdict(snapshot)``.
            Must contain every top-level key of :class:`TradeExitSnapshot`.

    Raises:
        KeyError: if a required top-level section key is missing from the
            payload (indicates schema drift or a corrupt row — caller should
            log and skip, not swallow).
        TypeError: if a top-level section is present but cannot be
            reconstructed into its dataclass (missing required fields or
            wrong shape). Treat this the same as schema drift — log and skip.

    Returns:
        Fully-hydrated :class:`TradeExitSnapshot` with every nested dataclass
        instantiated.
    """
    return TradeExitSnapshot(
        trade_id=data["trade_id"],
        trade_outcome=TradeOutcome(**data["trade_outcome"]),
        roe_trajectory=ROETrajectory(**data["roe_trajectory"]),
        counterfactuals=Counterfactuals(**data["counterfactuals"]),
        ml_exit_comparison=MLExitComparison(**data["ml_exit_comparison"]),
        market_state_at_exit=MarketState(**data["market_state_at_exit"]),
        price_path_1m=data.get("price_path_1m", []),
        schema_version=data.get("schema_version", "1.0.0"),
    )
