"""Deterministic mapping from an EntrySignal to concrete trade parameters.

Pure function — no LLM, no conviction overrides, no free parameters beyond
TradingSettings and the explicitly-passed roe_target_pct. Identical inputs
produce identical outputs (tested by test_compute_entry_params_determinism).

Clarifications applied vs the phase 5 plan sketch (08-phase-5-mechanical-entry.md
lines 346–441):

1. TP source: the plan sketch reads ``ts.roe_target`` (15.0), but phase 0
   wired a v2-specific ``V2MechanicalEntryConfig.roe_target_pct`` (10.0) into
   the YAML. The v2 config value takes precedence per the master plan's
   hierarchy ("v2 config overrides trading_settings where they overlap"),
   so this function accepts ``roe_target_pct`` as an explicit parameter —
   the caller pulls it from ``cfg.v2.mechanical_entry.roe_target_pct``.

2. SL floor + cap clamp: the plan sketch sets
   ``sl_pct = ts.dynamic_sl_<regime>_vol / leverage / 100`` without consulting
   ``dynamic_sl_floor`` / ``dynamic_sl_cap``. The live daemon's dynamic SL
   layer clamps both. We mirror that here:
   ``sl_roe_pct = max(ts.dynamic_sl_floor, min(ts.dynamic_sl_<regime>_vol,
   ts.dynamic_sl_cap))`` before dividing by leverage. Without the floor,
   low-vol (2.5%) at leverage 20 would drop below the 1.5% ROE minimum.
"""

from __future__ import annotations

from dataclasses import dataclass

from hynous.core.trading_settings import get_trading_settings

from .interface import EntrySignal


@dataclass(slots=True)
class EntryParams:
    """Concrete parameters for execute_trade_mechanical."""

    symbol: str
    side: str
    leverage: int
    size_usd: float
    sl_px: float
    tp_px: float
    trade_type: str


def compute_entry_params(
    *,
    signal: EntrySignal,
    entry_price: float,
    portfolio_value_usd: float,
    vol_regime: str,
    roe_target_pct: float,
) -> EntryParams:
    """Deterministic mapping from ML signal to exact trade params.

    No LLM. No conviction overrides. No free parameters beyond TradingSettings
    and ``roe_target_pct``. Identical inputs produce identical outputs.

    Args:
        signal: EntrySignal to translate into concrete params.
        entry_price: Live/reference entry price for SL/TP computation.
        portfolio_value_usd: Account value used for tier sizing.
        vol_regime: One of "low" / "normal" / "high" / "extreme".
        roe_target_pct: TP target in ROE % (read from
            ``cfg.v2.mechanical_entry.roe_target_pct``). See clarification 1.
    """
    ts = get_trading_settings()

    # --- Leverage: vol-regime capped, then floored at macro minimum ---
    if vol_regime == "extreme":
        leverage = ts.ml_vol_leverage_cap_extreme
    elif vol_regime == "high":
        leverage = ts.ml_vol_leverage_cap_high
    else:
        leverage = ts.macro_leverage_max
    leverage = max(leverage, ts.macro_leverage_min)

    # --- Size: conviction-tier margin, clamped by max_position_usd cap ---
    if signal.conviction >= 0.8:
        margin_pct = ts.tier_high_margin_pct / 100
    elif signal.conviction >= 0.6:
        margin_pct = ts.tier_medium_margin_pct / 100
    else:
        margin_pct = ts.tier_speculative_margin_pct / 100

    margin_usd = portfolio_value_usd * margin_pct
    size_usd = min(margin_usd * leverage, ts.max_position_usd)

    # --- SL: dynamic protective SL distance per vol regime, clamped by
    #         dynamic_sl_floor / dynamic_sl_cap. See clarification 2. ---
    if vol_regime == "extreme":
        sl_roe_base = ts.dynamic_sl_extreme_vol
    elif vol_regime == "high":
        sl_roe_base = ts.dynamic_sl_high_vol
    elif vol_regime == "low":
        sl_roe_base = ts.dynamic_sl_low_vol
    else:
        sl_roe_base = ts.dynamic_sl_normal_vol

    sl_roe_pct = max(ts.dynamic_sl_floor, min(sl_roe_base, ts.dynamic_sl_cap))
    sl_pct_of_price = sl_roe_pct / leverage / 100

    if signal.side == "long":
        sl_px = entry_price * (1 - sl_pct_of_price)
    else:
        sl_px = entry_price * (1 + sl_pct_of_price)

    # --- TP: fixed ROE target from v2 config (see clarification 1) ---
    tp_pct_of_price = roe_target_pct / leverage / 100
    if signal.side == "long":
        tp_px = entry_price * (1 + tp_pct_of_price)
    else:
        tp_px = entry_price * (1 - tp_pct_of_price)

    return EntryParams(
        symbol=signal.symbol,
        side=signal.side,
        leverage=int(leverage),
        size_usd=round(size_usd, 2),
        sl_px=round(sl_px, 6),
        tp_px=round(tp_px, 6),
        trade_type=signal.trade_type,
    )
