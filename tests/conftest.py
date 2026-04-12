"""
Pytest fixtures for Hynous tests.

Fixtures defined here are available to all tests under ``tests/**``.
"""

from __future__ import annotations

from typing import Any

import pytest

# ---------------------------------------------------------------------------
# v1 / pre-v2 placeholder fixtures (kept until phase 4 deletes the subsystems
# they reference).
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_config() -> None:
    """Provide a mock configuration for tests."""
    # TODO: Implement when Config class is created
    return None


@pytest.fixture
def memory_store() -> None:
    """Provide an in-memory Nous store for tests."""
    # TODO: Implement when NousStore is created
    # return NousStore(":memory:")
    return None


@pytest.fixture
def mock_agent() -> None:
    """Provide a mock agent for tests."""
    # TODO: Implement when Agent is created
    return None


# ---------------------------------------------------------------------------
# v2 journal fixtures (phase 2 — Milestone 1/2)
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_journal_db(tmp_path: Any) -> Any:
    """Fresh :class:`JournalStore` in a tmp directory, auto-cleaned.

    Imported lazily so tests that don't need the journal don't pay the import cost.
    """
    from hynous.journal.store import JournalStore

    db_path = tmp_path / "journal.db"
    store = JournalStore(str(db_path))
    yield store
    store.close()


@pytest.fixture
def sample_entry_snapshot() -> Any:
    """A :class:`TradeEntrySnapshot` with every field populated.

    Full population is deliberate — if any field defaulted to ``None``, a bug
    in the reconstruction helper that dropped or mis-wired that field would
    be invisible to dataclass ``__eq__``. Every field non-None makes the
    round-trip tests meaningfully exhaustive.
    """
    from hynous.journal.schema import (
        AccountContext,
        DerivativesState,
        LiquidationTerrain,
        MarketState,
        MLSnapshot,
        OrderFlowState,
        PriceHistoryContext,
        SettingsSnapshot,
        SmartMoneyContext,
        TimeContext,
        TradeBasics,
        TradeEntrySnapshot,
        TriggerContext,
    )

    return TradeEntrySnapshot(
        trade_basics=TradeBasics(
            trade_id="trade_abc1234567890a",
            symbol="BTC",
            side="long",
            trade_type="macro",
            entry_ts="2026-04-12T10:15:30.000000+00:00",
            entry_px=64321.5,
            sl_px=63500.0,
            tp_px=66000.0,
            leverage=20,
            size_base=0.05,
            size_usd=3216.08,
            margin_usd=160.80,
            fill_slippage_bps=1.2,
            fees_paid_usd=1.45,
        ),
        trigger_context=TriggerContext(
            trigger_source="scanner",
            trigger_type="composite_score",
            wake_source_id="wake_xyz_001",
            scanner_score=0.82,
            scanner_detail={"book_flip": True, "depth_ratio": 1.8},
        ),
        ml_snapshot=MLSnapshot(
            composite_entry_score=0.71,
            composite_label="strong",
            composite_components={"momentum": 0.4, "entry_quality": 0.9, "vol": 0.6},
            entry_quality_value=0.88,
            entry_quality_percentile=93,
            entry_quality_regime="high",
            vol_1h_value=0.012,
            vol_1h_percentile=58,
            vol_1h_regime="normal",
            vol_4h_value=0.024,
            vol_4h_percentile=62,
            vol_4h_regime="normal",
            vol_expand_value=1.15,
            vol_expand_regime="expanding",
            vol_of_vol_value=0.18,
            range_30m_value=0.006,
            range_30m_regime="normal",
            move_30m_value=0.003,
            move_30m_regime="normal",
            volume_1h_value=1.5e9,
            volume_1h_regime="high",
            momentum_quality_value=0.65,
            momentum_quality_regime="positive",
            mae_long_value=1.1,
            mae_long_percentile=42,
            mae_long_regime="favorable",
            mae_short_value=2.3,
            mae_short_percentile=71,
            mae_short_regime="unfavorable",
            sl_survival_03=0.72,
            sl_survival_05=0.89,
            funding_4h_value=0.00012,
            funding_4h_percentile=55,
            funding_4h_regime="neutral",
            direction_signal="long",
            direction_long_roe=3.2,
            direction_short_roe=-1.1,
            direction_shap_top5=[
                {"feature": "momentum_1h", "shap": 0.4},
                {"feature": "funding_velocity", "shap": 0.3},
                {"feature": "cvd_ratio_1h", "shap": 0.25},
                {"feature": "body_ratio_1h", "shap": 0.18},
                {"feature": "hour_sin", "shap": 0.12},
            ],
            predictions_timestamp=1744452930.0,
            predictions_staleness_s=1.75,
        ),
        market_state=MarketState(
            mid_price=64320.0,
            bid=64319.5,
            ask=64320.5,
            spread_bps=0.15,
            best_bid_size=1.2,
            best_ask_size=0.9,
            book_imbalance=0.07,
            depth_usd_20bp_bid=120_000.0,
            depth_usd_20bp_ask=110_000.0,
            pct_change_1m=0.0004,
            pct_change_5m=0.002,
            pct_change_15m=0.0055,
            pct_change_1h=0.012,
            pct_change_4h=0.024,
            pct_change_24h=0.031,
            volume_1h_usd=1.4e9,
            volume_4h_usd=5.2e9,
            volume_24h_usd=2.8e10,
            realized_vol_1h_pct=0.012,
            realized_vol_4h_pct=0.024,
        ),
        derivatives_state=DerivativesState(
            funding_rate=0.00008,
            funding_8h_cumulative=0.00064,
            hours_to_next_funding=3.5,
            open_interest=1.2e10,
            oi_change_1h_pct=0.015,
            oi_change_4h_pct=0.042,
            oi_zscore_30d=1.3,
            cross_exchange_oi_usd=3.4e10,
        ),
        liquidation_terrain=LiquidationTerrain(
            clusters_above=[
                {"price": 64800.0, "size_usd": 1.5e7, "confidence": 0.82},
                {"price": 65200.0, "size_usd": 9.0e6, "confidence": 0.74},
            ],
            clusters_below=[
                {"price": 63800.0, "size_usd": 2.1e7, "confidence": 0.88},
            ],
            total_1h_long_liq_usd=4.2e6,
            total_1h_short_liq_usd=1.8e6,
            total_4h_long_liq_usd=1.5e7,
            total_4h_short_liq_usd=7.2e6,
            liq_ratio_1h=0.43,
            cascade_active=True,
        ),
        order_flow_state=OrderFlowState(
            cvd_30m=125_000.0,
            cvd_1h=312_000.0,
            cvd_acceleration=1.4,
            buy_sell_ratio_1m=1.12,
            buy_sell_ratio_5m=1.08,
            buy_sell_ratio_15m=1.05,
            buy_sell_ratio_1h=1.02,
            large_trade_count_1h=7,
        ),
        smart_money_context=SmartMoneyContext(
            hlp_net_delta_usd=-1_200_000.0,
            hlp_side="short",
            hlp_size_usd=8_400_000.0,
            top_whale_positions=[
                {"wallet": "0xabc", "side": "long", "size_usd": 3.2e6},
                {"wallet": "0xdef", "side": "long", "size_usd": 2.1e6},
            ],
            smart_money_opens_1h=3,
        ),
        time_context=TimeContext(
            hour_utc=10,
            day_of_week=2,
            session="eu",
            time_to_next_funding_s=12600,
        ),
        account_context=AccountContext(
            portfolio_value_usd=10_450.0,
            portfolio_initial_usd=10_000.0,
            daily_pnl_so_far_usd=125.5,
            open_positions_count=1,
            open_position_symbols=["ETH"],
            entries_today_count=3,
            trading_paused=False,
        ),
        settings_snapshot=SettingsSnapshot(
            settings_hash="a1b2c3d4e5f6a7b8",
            settings_version="v2.0.1",
        ),
        price_history=PriceHistoryContext(
            candles_1m_15min=[
                [1744452000.0, 64300.0, 64325.0, 64290.0, 64320.0, 12.5],
                [1744452060.0, 64320.0, 64340.0, 64310.0, 64321.5, 10.2],
            ],
            candles_5m_4h=[
                [1744438800.0, 64100.0, 64180.0, 64080.0, 64150.0, 55.0],
                [1744439100.0, 64150.0, 64220.0, 64130.0, 64200.0, 48.5],
            ],
        ),
        schema_version="1.0.0",
    )


@pytest.fixture
def sample_exit_snapshot() -> Any:
    """A :class:`TradeExitSnapshot` with every field populated."""
    from hynous.journal.schema import (
        Counterfactuals,
        MarketState,
        MLExitComparison,
        ROETrajectory,
        TradeExitSnapshot,
        TradeOutcome,
    )

    return TradeExitSnapshot(
        trade_id="trade_abc1234567890a",
        trade_outcome=TradeOutcome(
            exit_ts="2026-04-12T11:47:12.000000+00:00",
            exit_px=65110.0,
            exit_classification="trailing_stop",
            realized_pnl_usd=39.45,
            realized_pnl_pct=0.0123,
            roe_at_exit=24.6,
            fees_paid_usd=2.90,
            hold_duration_s=5502,
            slippage_vs_trigger_bps=0.9,
        ),
        roe_trajectory=ROETrajectory(
            peak_roe=31.2,
            peak_roe_ts="2026-04-12T11:31:05.000000+00:00",
            peak_roe_price=65380.0,
            trough_roe=-3.1,
            trough_roe_ts="2026-04-12T10:22:40.000000+00:00",
            trough_roe_price=64280.0,
            time_to_peak_s=4535,
            time_to_trough_s=430,
            mfe_usd=51.0,
            mae_usd=-4.9,
        ),
        counterfactuals=Counterfactuals(
            counterfactual_window_s=7200,
            max_favorable_price=65700.0,
            max_adverse_price=64200.0,
            optimal_exit_px=65700.0,
            optimal_exit_ts="2026-04-12T12:05:00.000000+00:00",
            did_tp_hit_later=False,
            did_tp_hit_ts=None,
            did_sl_get_hunted=False,
            sl_hunt_reversal_pct=None,
        ),
        ml_exit_comparison=MLExitComparison(
            composite_score_at_exit=0.52,
            composite_score_delta=-0.19,
            vol_regime_at_exit="high",
            vol_regime_changed=True,
            entry_quality_pctl_at_exit=68,
            direction_signal_at_exit="skip",
            direction_signal_changed=True,
            mae_long_value_at_exit=1.4,
            mae_short_value_at_exit=2.1,
        ),
        market_state_at_exit=MarketState(
            mid_price=65110.0,
            bid=65109.5,
            ask=65110.5,
            spread_bps=0.15,
            best_bid_size=0.8,
            best_ask_size=1.1,
            book_imbalance=-0.04,
            depth_usd_20bp_bid=95_000.0,
            depth_usd_20bp_ask=108_000.0,
            pct_change_1m=-0.0005,
            pct_change_5m=-0.002,
            pct_change_15m=-0.004,
            pct_change_1h=0.006,
            pct_change_4h=0.018,
            pct_change_24h=0.025,
            volume_1h_usd=1.3e9,
            volume_4h_usd=5.0e9,
            volume_24h_usd=2.7e10,
            realized_vol_1h_pct=0.015,
            realized_vol_4h_pct=0.026,
        ),
        price_path_1m=[
            [1744452930.0, 64320.0, 64345.0, 64310.0, 64330.0, 11.0],
            [1744452990.0, 64330.0, 64360.0, 64320.0, 64345.0, 9.8],
            [1744458420.0, 65080.0, 65120.0, 65070.0, 65110.0, 8.4],
        ],
        schema_version="1.0.0",
    )
