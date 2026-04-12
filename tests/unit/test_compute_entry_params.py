"""Unit tests for compute_entry_params (phase 5 M1).

Tests 8–12 from the phase 5 plan, plus two explicit extras:
- determinism (pure-function guarantee)
- SL floor clamp at low vol (verifies clarification 2).

All fixture values for trading_settings are read live via
``get_trading_settings()`` so the tests don't drift if a default is edited
in trading_settings.py.
"""

from __future__ import annotations

import pytest

from hynous.core.trading_settings import get_trading_settings
from hynous.mechanical_entry.compute_entry_params import (
    EntryParams,
    compute_entry_params,
)
from hynous.mechanical_entry.interface import EntrySignal


def _make_signal(*, side: str = "long", conviction: float = 0.85) -> EntrySignal:
    return EntrySignal(
        symbol="BTC",
        side=side,
        trade_type="macro",
        conviction=conviction,
        trigger_source="ml_signal_driven",
        trigger_type="composite_score_plus_direction",
        trigger_detail={},
        ml_snapshot_ref={},
    )


def test_compute_entry_params_high_conviction_uses_high_tier() -> None:
    ts = get_trading_settings()
    signal = _make_signal(conviction=0.85)

    params = compute_entry_params(
        signal=signal,
        entry_price=60_000.0,
        portfolio_value_usd=1000.0,
        vol_regime="normal",
        roe_target_pct=10.0,
    )

    # leverage = macro_leverage_max (normal vol) = 20
    expected_leverage = ts.macro_leverage_max
    expected_size = round(
        min(1000.0 * (ts.tier_high_margin_pct / 100) * expected_leverage, ts.max_position_usd),
        2,
    )
    assert params.leverage == expected_leverage
    assert params.size_usd == expected_size
    # sanity: long SL below entry
    assert params.sl_px < 60_000.0
    assert params.tp_px > 60_000.0


def test_compute_entry_params_caps_leverage_for_extreme_vol() -> None:
    ts = get_trading_settings()
    signal = _make_signal()

    params = compute_entry_params(
        signal=signal,
        entry_price=60_000.0,
        portfolio_value_usd=1000.0,
        vol_regime="extreme",
        roe_target_pct=10.0,
    )

    assert params.leverage == ts.ml_vol_leverage_cap_extreme


@pytest.mark.parametrize("vol_regime", ["low", "normal", "high", "extreme"])
def test_compute_entry_params_sl_distance_matches_vol_regime(vol_regime: str) -> None:
    ts = get_trading_settings()
    entry_price = 60_000.0
    signal = _make_signal(side="long")

    params = compute_entry_params(
        signal=signal,
        entry_price=entry_price,
        portfolio_value_usd=1000.0,
        vol_regime=vol_regime,
        roe_target_pct=10.0,
    )

    base_map = {
        "low": ts.dynamic_sl_low_vol,
        "normal": ts.dynamic_sl_normal_vol,
        "high": ts.dynamic_sl_high_vol,
        "extreme": ts.dynamic_sl_extreme_vol,
    }
    clamped_roe = max(ts.dynamic_sl_floor, min(base_map[vol_regime], ts.dynamic_sl_cap))

    # Recover ROE distance from sl_px for a long: (entry - sl)/entry * leverage * 100.
    sl_roe = (entry_price - params.sl_px) / entry_price * params.leverage * 100
    assert sl_roe == pytest.approx(clamped_roe, rel=1e-5, abs=1e-5)
    # Long: sl_px < entry_price
    assert params.sl_px < entry_price


def test_compute_entry_params_tp_uses_roe_target() -> None:
    entry_price = 60_000.0
    signal = _make_signal(side="long")

    params = compute_entry_params(
        signal=signal,
        entry_price=entry_price,
        portfolio_value_usd=1000.0,
        vol_regime="normal",
        roe_target_pct=10.0,
    )

    tp_roe = (params.tp_px - entry_price) / entry_price * params.leverage * 100
    assert tp_roe == pytest.approx(10.0, abs=1e-4)


def test_compute_entry_params_respects_max_position_usd() -> None:
    ts = get_trading_settings()
    signal = _make_signal(conviction=0.95)

    params = compute_entry_params(
        signal=signal,
        entry_price=60_000.0,
        portfolio_value_usd=1_000_000.0,
        vol_regime="normal",
        roe_target_pct=10.0,
    )

    assert params.size_usd == ts.max_position_usd


def test_compute_entry_params_determinism() -> None:
    signal = _make_signal(conviction=0.72)
    kwargs = dict(
        signal=signal,
        entry_price=60_123.45,
        portfolio_value_usd=2_500.0,
        vol_regime="normal",
        roe_target_pct=10.0,
    )

    p1 = compute_entry_params(**kwargs)  # type: ignore[arg-type]
    p2 = compute_entry_params(**kwargs)  # type: ignore[arg-type]

    assert isinstance(p1, EntryParams)
    assert p1 == p2
    # Short-circuit: every field identical.
    assert p1.symbol == p2.symbol
    assert p1.side == p2.side
    assert p1.leverage == p2.leverage
    assert p1.size_usd == p2.size_usd
    assert p1.sl_px == p2.sl_px
    assert p1.tp_px == p2.tp_px
    assert p1.trade_type == p2.trade_type


@pytest.mark.parametrize("side", ["long", "short"])
def test_compute_entry_params_sl_floor_clamps_low_vol(side: str) -> None:
    """At low vol the base SL (2.5%) is already above the 1.5% floor, so this
    test confirms the clamp never produces a distance below the floor — in
    particular that after dividing by leverage the recovered ROE distance
    still equals max(floor, base) rather than falling through raw.

    Parametrized over long/short to serve as the long-vs-short parity sanity
    check the directive requires: SL sign must match the side.
    """
    ts = get_trading_settings()
    entry_price = 60_000.0
    signal = _make_signal(side=side)

    params = compute_entry_params(
        signal=signal,
        entry_price=entry_price,
        portfolio_value_usd=1000.0,
        vol_regime="low",
        roe_target_pct=10.0,
    )

    # SL sign must match side: long → SL below entry; short → SL above entry.
    if side == "long":
        assert params.sl_px < entry_price
        assert params.tp_px > entry_price
        sl_roe = (entry_price - params.sl_px) / entry_price * params.leverage * 100
    else:
        assert params.sl_px > entry_price
        assert params.tp_px < entry_price
        sl_roe = (params.sl_px - entry_price) / entry_price * params.leverage * 100

    # Clamped distance must never drop below the configured floor.
    assert sl_roe + 1e-6 >= ts.dynamic_sl_floor
    # And it must equal the max of (floor, base) because low base=2.5 > floor=1.5.
    expected = max(ts.dynamic_sl_floor, min(ts.dynamic_sl_low_vol, ts.dynamic_sl_cap))
    assert sl_roe == pytest.approx(expected, rel=1e-5, abs=1e-5)
