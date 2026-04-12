"""Capture builders for v2 trade journal.

build_entry_snapshot() — assembles a complete TradeEntrySnapshot from daemon
    state at the moment an order fills.
build_exit_snapshot() — assembles a TradeExitSnapshot when a trade closes.
emit_lifecycle_event() — persists a lifecycle event to the staging store.

All builders follow a graceful-degradation pattern: if any data source is
unavailable, the corresponding fields are set to None. The snapshot is always
persisted; downstream analysis can see what was missing.
"""

from __future__ import annotations

import hashlib
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from .schema import (
    AccountContext,
    Counterfactuals,
    DerivativesState,
    LiquidationTerrain,
    MarketState,
    MLExitComparison,
    MLSnapshot,
    OrderFlowState,
    PriceHistoryContext,
    ROETrajectory,
    SettingsSnapshot,
    SmartMoneyContext,
    TimeContext,
    TradeBasics,
    TradeEntrySnapshot,
    TradeExitSnapshot,
    TradeOutcome,
    TriggerContext,
)

logger = logging.getLogger(__name__)


# ============================================================================
# Entry snapshot
# ============================================================================


def build_entry_snapshot(
    *,
    symbol: str,
    side: str,
    trade_type: str,
    fill_px: float,
    fill_sz: float,
    leverage: int,
    sl_px: float | None,
    tp_px: float | None,
    size_usd: float,
    reference_price: float,
    fees_paid_usd: float,
    daemon: Any,
    trigger_source: str = "manual",
    trigger_type: str = "unknown",
    wake_source_id: str | None = None,
    scanner_detail: dict[str, Any] | None = None,
    scanner_score: float | None = None,
) -> TradeEntrySnapshot:
    """Build a full entry snapshot from daemon state and fill details.

    Called AFTER the order has filled and BEFORE returning from
    handle_execute_trade. Reads live state from the daemon.
    """
    now_ts = datetime.now(timezone.utc).isoformat()
    trade_id = _generate_trade_id()

    margin_usd = size_usd / leverage if leverage > 0 else size_usd
    slippage_bps = (
        (fill_px - reference_price) / reference_price * 10000
        if reference_price > 0
        else 0.0
    )

    basics = TradeBasics(
        trade_id=trade_id,
        symbol=symbol,
        side=side,
        trade_type=trade_type,
        entry_ts=now_ts,
        entry_px=fill_px,
        sl_px=sl_px,
        tp_px=tp_px,
        leverage=leverage,
        size_base=fill_sz,
        size_usd=size_usd,
        margin_usd=margin_usd,
        fill_slippage_bps=round(slippage_bps, 2),
        fees_paid_usd=fees_paid_usd,
    )

    trigger_ctx = TriggerContext(
        trigger_source=trigger_source,
        trigger_type=trigger_type,
        wake_source_id=wake_source_id,
        scanner_score=scanner_score,
        scanner_detail=scanner_detail or {},
    )

    return TradeEntrySnapshot(
        trade_basics=basics,
        trigger_context=trigger_ctx,
        ml_snapshot=_build_ml_snapshot(daemon, symbol),
        market_state=_build_market_state(daemon, symbol, fill_px),
        derivatives_state=_build_derivatives_state(daemon, symbol),
        liquidation_terrain=_build_liquidation_terrain(daemon, symbol),
        order_flow_state=_build_order_flow_state(daemon, symbol),
        smart_money_context=_build_smart_money_context(daemon, symbol),
        time_context=_build_time_context(),
        account_context=_build_account_context(daemon),
        settings_snapshot=_build_settings_snapshot(),
        price_history=_build_price_history(daemon, symbol),
    )


# ============================================================================
# Exit snapshot
# ============================================================================


def build_exit_snapshot(
    *,
    trade_id: str,
    entry_snapshot_json: dict[str, Any],
    exit_event: dict[str, Any],
    daemon: Any,
) -> TradeExitSnapshot:
    """Build a complete exit snapshot from the close event and daemon state.

    Args:
        trade_id: The trade_id from the entry snapshot.
        entry_snapshot_json: The parsed JSON dict of the entry snapshot.
        exit_event: The event dict from provider.check_triggers().
        daemon: The HynousDaemon instance.
    """
    from .counterfactuals import compute_counterfactuals

    exit_ts = datetime.now(timezone.utc).isoformat()
    basics = entry_snapshot_json.get("trade_basics", {})
    entry_ts_str = basics.get("entry_ts", exit_ts)
    entry_px = basics.get("entry_px", 0)
    side = basics.get("side", "long")
    lev = basics.get("leverage", 1)
    symbol = basics.get("symbol", "BTC")

    entry_dt = datetime.fromisoformat(entry_ts_str.replace("Z", "+00:00"))
    exit_dt = datetime.fromisoformat(exit_ts.replace("Z", "+00:00"))
    hold_duration = int((exit_dt - entry_dt).total_seconds())

    exit_px = exit_event.get("exit_px", 0)

    # Fees: entry + exit taker fees
    try:
        from hynous.core.trading_settings import get_trading_settings
        taker_fee_pct = get_trading_settings().taker_fee_pct
    except Exception:
        taker_fee_pct = 0.07
    size_usd = basics.get("size_usd", 0)
    fees_paid = size_usd * (taker_fee_pct / 100) * 2  # entry + exit

    outcome = TradeOutcome(
        exit_ts=exit_ts,
        exit_px=exit_px,
        exit_classification=exit_event.get("classification", "unknown"),
        realized_pnl_usd=exit_event.get("realized_pnl", 0),
        realized_pnl_pct=_compute_pnl_pct(entry_px, exit_px, side),
        roe_at_exit=_compute_roe(entry_px, exit_px, side, lev),
        fees_paid_usd=fees_paid,
        hold_duration_s=hold_duration,
    )

    # ROE trajectory from daemon state
    peak_roe = daemon._peak_roe.get(symbol, 0)
    trough_roe = daemon._trough_roe.get(symbol, 0)
    peak_ts = getattr(daemon, "_peak_roe_ts", {}).get(symbol, "")
    trough_ts = getattr(daemon, "_trough_roe_ts", {}).get(symbol, "")
    peak_price = getattr(daemon, "_peak_roe_price", {}).get(symbol, 0)
    trough_price = getattr(daemon, "_trough_roe_price", {}).get(symbol, 0)

    # Compute time-to-peak/trough from entry
    time_to_peak = 0
    time_to_trough = 0
    if peak_ts:
        try:
            peak_dt = datetime.fromisoformat(peak_ts.replace("Z", "+00:00"))
            time_to_peak = int((peak_dt - entry_dt).total_seconds())
        except Exception:
            pass
    if trough_ts:
        try:
            trough_dt = datetime.fromisoformat(trough_ts.replace("Z", "+00:00"))
            time_to_trough = int((trough_dt - entry_dt).total_seconds())
        except Exception:
            pass

    # MFE/MAE in USD
    mfe_usd = size_usd * (peak_roe / 100 / lev) if lev > 0 else 0
    mae_usd = size_usd * (abs(trough_roe) / 100 / lev) if lev > 0 else 0

    trajectory = ROETrajectory(
        peak_roe=peak_roe,
        peak_roe_ts=peak_ts,
        peak_roe_price=peak_price,
        trough_roe=trough_roe,
        trough_roe_ts=trough_ts,
        trough_roe_price=trough_price,
        time_to_peak_s=time_to_peak,
        time_to_trough_s=time_to_trough,
        mfe_usd=round(mfe_usd, 2),
        mae_usd=round(mae_usd, 2),
    )

    # Counterfactuals
    provider = daemon._get_provider()
    try:
        counterfactuals = compute_counterfactuals(
            provider=provider,
            symbol=symbol,
            side=side,
            entry_px=entry_px,
            entry_ts=entry_ts_str,
            exit_px=exit_px,
            exit_ts=exit_ts,
            sl_px=basics.get("sl_px"),
            tp_px=basics.get("tp_px"),
        )
    except Exception:
        logger.debug("Counterfactual computation failed", exc_info=True)
        counterfactuals = Counterfactuals()

    # ML exit comparison
    ml_exit = _build_ml_exit_comparison(daemon, entry_snapshot_json)

    # Market state at exit
    market_state_exit = _build_market_state(daemon, symbol, exit_px)

    # Price path during hold (best-effort)
    price_path = _fetch_hold_candles(provider, symbol, entry_ts_str, exit_ts)

    return TradeExitSnapshot(
        trade_id=trade_id,
        trade_outcome=outcome,
        roe_trajectory=trajectory,
        counterfactuals=counterfactuals,
        ml_exit_comparison=ml_exit,
        market_state_at_exit=market_state_exit,
        price_path_1m=price_path,
    )


# ============================================================================
# Lifecycle event emitter
# ============================================================================


def emit_lifecycle_event(
    *,
    journal_store: Any,
    trade_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """Emit a lifecycle event and persist it.

    Non-blocking: failures are logged and swallowed so a failed emit
    does not crash the trigger check loop.
    """
    try:
        now_ts = datetime.now(timezone.utc).isoformat()
        journal_store.insert_lifecycle_event(
            trade_id=trade_id,
            ts=now_ts,
            event_type=event_type,
            payload=payload,
        )
    except Exception:
        logger.exception(
            "Failed to emit lifecycle event type=%s for trade_id=%s",
            event_type,
            trade_id,
        )


# ============================================================================
# Internal builders
# ============================================================================


def _generate_trade_id() -> str:
    """UUID-based trade id for unique identification across restarts."""
    return f"trade_{uuid.uuid4().hex[:16]}"


def _build_ml_snapshot(daemon: Any, symbol: str) -> MLSnapshot:
    """Read daemon._latest_predictions[symbol] and build an MLSnapshot."""
    try:
        with daemon._latest_predictions_lock:
            preds = dict(daemon._latest_predictions.get(symbol, {}))
    except Exception:
        return MLSnapshot(composite_entry_score=None, composite_label=None)

    conditions = preds.get("conditions", {})
    ts = conditions.get("timestamp", 0)
    now = time.time()
    staleness = now - ts if ts > 0 else None

    def _cond(name: str, field: str, default=None):
        return conditions.get(name, {}).get(field, default)

    # Note: daemon stores entry_score keys WITHOUT underscore prefix.
    # The _get_ml_conditions() helper in trading.py adds _ prefix when
    # copying into ml_cond dict, but we read directly from predictions.
    return MLSnapshot(
        composite_entry_score=preds.get("entry_score"),
        composite_label=preds.get("entry_score_label"),
        composite_components=preds.get("entry_score_components", {}),
        entry_quality_value=_cond("entry_quality", "value"),
        entry_quality_percentile=_cond("entry_quality", "percentile"),
        entry_quality_regime=_cond("entry_quality", "regime"),
        vol_1h_value=_cond("vol_1h", "value"),
        vol_1h_percentile=_cond("vol_1h", "percentile"),
        vol_1h_regime=_cond("vol_1h", "regime"),
        vol_4h_value=_cond("vol_4h", "value"),
        vol_4h_percentile=_cond("vol_4h", "percentile"),
        vol_4h_regime=_cond("vol_4h", "regime"),
        vol_expand_value=_cond("vol_expand", "value"),
        vol_expand_regime=_cond("vol_expand", "regime"),
        vol_of_vol_value=_cond("vol_of_vol", "value"),
        range_30m_value=_cond("range_30m", "value"),
        range_30m_regime=_cond("range_30m", "regime"),
        move_30m_value=_cond("move_30m", "value"),
        move_30m_regime=_cond("move_30m", "regime"),
        volume_1h_value=_cond("volume_1h", "value"),
        volume_1h_regime=_cond("volume_1h", "regime"),
        momentum_quality_value=_cond("momentum_quality", "value"),
        momentum_quality_regime=_cond("momentum_quality", "regime"),
        mae_long_value=_cond("mae_long", "value"),
        mae_long_percentile=_cond("mae_long", "percentile"),
        mae_long_regime=_cond("mae_long", "regime"),
        mae_short_value=_cond("mae_short", "value"),
        mae_short_percentile=_cond("mae_short", "percentile"),
        mae_short_regime=_cond("mae_short", "regime"),
        sl_survival_03=_cond("sl_survival_03", "value"),
        sl_survival_05=_cond("sl_survival_05", "value"),
        funding_4h_value=_cond("funding_4h", "value"),
        funding_4h_percentile=_cond("funding_4h", "percentile"),
        funding_4h_regime=_cond("funding_4h", "regime"),
        direction_signal=preds.get("signal"),
        direction_long_roe=preds.get("long_roe"),
        direction_short_roe=preds.get("short_roe"),
        direction_shap_top5=preds.get("shap_top5", []),
        predictions_timestamp=ts if ts > 0 else None,
        predictions_staleness_s=staleness,
    )


def _build_market_state(daemon: Any, symbol: str, fill_px: float) -> MarketState:
    """Read L2 book + candle data for market state."""
    bid = None
    ask = None
    spread_bps = None
    best_bid_size = None
    best_ask_size = None
    book_imbalance = None
    depth_bid = None
    depth_ask = None

    try:
        provider = daemon._get_provider()
        book = provider.get_l2_book(symbol)
        if book:
            bid = book.get("best_bid")
            ask = book.get("best_ask")
            if bid and ask and ask > 0:
                spread_bps = (ask - bid) / ask * 10000
            bids = book.get("bids", [])
            asks = book.get("asks", [])
            if bids:
                best_bid_size = bids[0].get("size")
            if asks:
                best_ask_size = asks[0].get("size")
            mid = (bid + ask) / 2 if (bid and ask) else fill_px
            depth_bid = _sum_depth_within_bps(bids, mid, 20, "bid")
            depth_ask = _sum_depth_within_bps(asks, mid, 20, "ask")
            total_depth = (depth_bid or 0) + (depth_ask or 0)
            if total_depth > 0:
                book_imbalance = ((depth_bid or 0) - (depth_ask or 0)) / total_depth
    except Exception:
        logger.debug("Failed to fetch L2 book for entry snapshot", exc_info=True)

    pct_changes = _compute_pct_changes(daemon, symbol, fill_px)

    # Realized vol from ML conditions
    try:
        with daemon._latest_predictions_lock:
            preds = dict(daemon._latest_predictions.get(symbol, {}))
        cond = preds.get("conditions", {})
    except Exception:
        cond = {}
    realized_vol_1h = cond.get("vol_1h", {}).get("value")
    realized_vol_4h = cond.get("vol_4h", {}).get("value")

    return MarketState(
        mid_price=fill_px,
        bid=bid,
        ask=ask,
        spread_bps=spread_bps,
        best_bid_size=best_bid_size,
        best_ask_size=best_ask_size,
        book_imbalance=book_imbalance,
        depth_usd_20bp_bid=depth_bid,
        depth_usd_20bp_ask=depth_ask,
        pct_change_1m=pct_changes.get("1m"),
        pct_change_5m=pct_changes.get("5m"),
        pct_change_15m=pct_changes.get("15m"),
        pct_change_1h=pct_changes.get("1h"),
        pct_change_4h=pct_changes.get("4h"),
        pct_change_24h=pct_changes.get("24h"),
        realized_vol_1h_pct=realized_vol_1h,
        realized_vol_4h_pct=realized_vol_4h,
    )


def _build_derivatives_state(daemon: Any, symbol: str) -> DerivativesState:
    """Read daemon snapshot for funding, OI, etc."""
    try:
        snap = daemon.snapshot
        funding = snap.funding.get(symbol)
        oi_usd = snap.oi_usd.get(symbol)
    except Exception:
        funding = None
        oi_usd = None

    # Additional fields from ML conditions
    try:
        with daemon._latest_predictions_lock:
            preds = dict(daemon._latest_predictions.get(symbol, {}))
        cond = preds.get("conditions", {})
    except Exception:
        cond = {}

    return DerivativesState(
        funding_rate=funding,
        open_interest=oi_usd,
        oi_zscore_30d=cond.get("funding_4h", {}).get("value"),
    )


def _build_liquidation_terrain(daemon: Any, symbol: str) -> LiquidationTerrain:
    """Read liquidation data from data-layer or satellite features."""
    try:
        with daemon._latest_predictions_lock:
            preds = dict(daemon._latest_predictions.get(symbol, {}))
        cond = preds.get("conditions", {})
        cascade_active = bool(cond.get("liq_cascade_active", {}).get("value", 0) > 0.5)
    except Exception:
        cascade_active = False

    return LiquidationTerrain(cascade_active=cascade_active)


def _build_order_flow_state(daemon: Any, symbol: str) -> OrderFlowState:
    """Populate OrderFlowState from the data-layer service (:8100).

    Reads ``/v1/orderflow/{coin}`` for windowed CVD / buy-sell ratios and
    ``/v1/orderflow/{coin}/large-trade-count`` for the >1%-of-volume count.
    Every individual call is try/except-wrapped — a single endpoint outage
    cannot strand an entry snapshot. Missing fields become None.

    ``cvd_acceleration`` is computed client-side as ``cvd_5m − cvd_15m / 3``
    (5m actual vs one-third of the 15m accumulation — a trailing-baseline
    proxy). Returns the dataclass in its all-None state if the data-layer
    client itself is unreachable.
    """
    try:
        from hynous.data.providers.hynous_data import get_client
        client = get_client()
    except Exception:
        logger.debug("data-layer client unavailable for order flow", exc_info=True)
        return OrderFlowState()

    # Windowed CVD / buy-pct
    flow = None
    try:
        flow = client.order_flow(symbol)
    except Exception:
        logger.debug("order_flow fetch failed", exc_info=True)

    if not flow or "windows" not in flow:
        # Populate only large_trade_count if we can, then bail.
        ltc_only = _fetch_large_trade_count(client, symbol)
        return OrderFlowState(large_trade_count_1h=ltc_only)

    windows = flow["windows"]

    def _ratio(label: str) -> float | None:
        win = windows.get(label)
        if not win:
            return None
        bp = win.get("buy_pct")
        return bp / 100.0 if bp is not None else None

    def _cvd(label: str) -> float | None:
        win = windows.get(label)
        return win.get("cvd") if win else None

    cvd_5m = _cvd("5m")
    cvd_15m = _cvd("15m")
    if cvd_5m is not None and cvd_15m is not None:
        cvd_accel: float | None = cvd_5m - (cvd_15m / 3.0)
    else:
        cvd_accel = None

    ltc = _fetch_large_trade_count(client, symbol)

    return OrderFlowState(
        cvd_30m=_cvd("30m"),
        cvd_1h=_cvd("1h"),
        cvd_acceleration=cvd_accel,
        buy_sell_ratio_1m=_ratio("1m"),
        buy_sell_ratio_5m=_ratio("5m"),
        buy_sell_ratio_15m=_ratio("15m"),
        buy_sell_ratio_1h=_ratio("1h"),
        large_trade_count_1h=ltc,
    )


def _fetch_large_trade_count(client: Any, symbol: str) -> int | None:
    """Best-effort large-trade count over the 1h window. Returns None on failure."""
    try:
        resp = client.large_trade_count(symbol, window_s=3600)
        if resp and isinstance(resp.get("count"), int):
            return int(resp["count"])
    except Exception:
        logger.debug("large_trade_count fetch failed", exc_info=True)
    return None


def _build_smart_money_context(daemon: Any, symbol: str) -> SmartMoneyContext:
    """Populate SmartMoneyContext from HLP, whale, and smart-money data-layer feeds.

    Graceful degradation per-call — each endpoint is try/except-wrapped. A
    ``sm_changes`` response uses the DB column name ``action`` with values
    ``"entry"``, ``"flip"``, ``"increase"``, ``"exit"``; we count the first
    three as position-opening events for the symbol (architect delta 2 —
    plan sketch at lines 1820-1828 had the wrong key ``change_type`` and
    wrong values ``"open"``/``"opened"``/``"new_position"``).
    """
    try:
        from hynous.data.providers.hynous_data import get_client
        client = get_client()
    except Exception:
        logger.debug("data-layer client unavailable for smart money", exc_info=True)
        return SmartMoneyContext(top_whale_positions=[], smart_money_opens_1h=0)

    hlp_net: float | None = None
    hlp_size: float | None = None
    hlp_side: str | None = None
    try:
        hlp = client.hlp_positions()
        if hlp and isinstance(hlp.get("positions"), list):
            long_usd = sum(
                p.get("size_usd", 0)
                for p in hlp["positions"]
                if p.get("coin") == symbol and p.get("side") == "long"
            )
            short_usd = sum(
                p.get("size_usd", 0)
                for p in hlp["positions"]
                if p.get("coin") == symbol and p.get("side") == "short"
            )
            hlp_net = long_usd - short_usd
            hlp_size = long_usd + short_usd
            if hlp_net > 0:
                hlp_side = "long"
            elif hlp_net < 0:
                hlp_side = "short"
            elif hlp_size == 0:
                hlp_side = None  # no position on this coin
            else:
                hlp_side = "flat"  # equal longs and shorts — rare
    except Exception:
        logger.debug("hlp_positions fetch failed", exc_info=True)

    top_whales: list[dict[str, Any]] = []
    try:
        whales = client.whales(symbol, top_n=5)
        if whales and isinstance(whales.get("positions"), list):
            top_whales = whales["positions"][:5]
    except Exception:
        logger.debug("whales fetch failed", exc_info=True)

    sm_opens = 0
    try:
        changes = client.sm_changes(minutes=60)
        if changes and isinstance(changes.get("changes"), list):
            # Architect delta 2: real column is `action`, opening values are
            # "entry" (new position), "flip" (reverse side), "increase"
            # (size up). Excludes "exit" (closures).
            sm_opens = sum(
                1 for ch in changes["changes"]
                if ch.get("coin") == symbol
                and ch.get("action") in ("entry", "flip", "increase")
            )
    except Exception:
        logger.debug("sm_changes fetch failed", exc_info=True)

    return SmartMoneyContext(
        hlp_net_delta_usd=hlp_net,
        hlp_side=hlp_side,
        hlp_size_usd=hlp_size,
        top_whale_positions=top_whales,
        smart_money_opens_1h=sm_opens,
    )


def _build_time_context() -> TimeContext:
    """Pure datetime computation."""
    now = datetime.now(timezone.utc)
    hour = now.hour
    dow = now.weekday()

    # Session determination
    if 0 <= hour < 7:
        session = "asia"
    elif 7 <= hour < 8:
        session = "overlap_asia_eu"
    elif 8 <= hour < 13:
        session = "eu"
    elif 13 <= hour < 14:
        session = "overlap_eu_us"
    elif 14 <= hour < 21:
        session = "us"
    else:
        session = "off_hours"

    return TimeContext(
        hour_utc=hour,
        day_of_week=dow,
        session=session,
    )


def _build_account_context(daemon: Any) -> AccountContext:
    """Read account state from provider."""
    try:
        provider = daemon._get_provider()
        state = provider.get_user_state()
        portfolio_value = state.get("account_value", 0)
        positions = state.get("positions", [])
    except Exception:
        return AccountContext()

    trading_paused = getattr(daemon, "trading_paused", False)
    daily_pnl = getattr(daemon, "_daily_realized_pnl", 0)
    entries_today = getattr(daemon, "_entries_today", 0)
    initial_balance = getattr(daemon, "_initial_balance", portfolio_value)

    return AccountContext(
        portfolio_value_usd=portfolio_value,
        portfolio_initial_usd=initial_balance,
        daily_pnl_so_far_usd=daily_pnl,
        open_positions_count=len(positions),
        open_position_symbols=[p["coin"] for p in positions],
        entries_today_count=entries_today,
        trading_paused=trading_paused,
    )


def _build_settings_snapshot() -> SettingsSnapshot:
    """Read trading_settings.json and compute hash."""
    try:
        from pathlib import Path

        from hynous.core.trading_settings import get_trading_settings

        get_trading_settings()  # ensure settings loaded
        settings_path = Path("storage/trading_settings.json")
        if settings_path.exists():
            content = settings_path.read_bytes()
            h = hashlib.sha256(content).hexdigest()[:16]
        else:
            h = "default"
        return SettingsSnapshot(settings_hash=h)
    except Exception:
        return SettingsSnapshot(settings_hash="unknown")


def _build_price_history(daemon: Any, symbol: str) -> PriceHistoryContext:
    """Fetch recent candles for preceding price path context."""
    candles_1m: list[list[float]] = []
    candles_5m: list[list[float]] = []

    try:
        provider = daemon._get_provider()
        raw_1m = provider.get_candles(symbol, "1m") if hasattr(provider, "get_candles") else None
        if raw_1m:
            # Take last 15 candles
            for c in raw_1m[-15:]:
                candles_1m.append([c["t"], c["o"], c["h"], c["l"], c["c"], c.get("v", 0)])

        raw_5m = provider.get_candles(symbol, "5m") if hasattr(provider, "get_candles") else None
        if raw_5m:
            # Take last 48 candles (4 hours)
            for c in raw_5m[-48:]:
                candles_5m.append([c["t"], c["o"], c["h"], c["l"], c["c"], c.get("v", 0)])
    except Exception:
        logger.debug("Failed to fetch candles for price history", exc_info=True)

    return PriceHistoryContext(
        candles_1m_15min=candles_1m,
        candles_5m_4h=candles_5m,
    )


def _build_ml_exit_comparison(
    daemon: Any, entry_snapshot_json: dict[str, Any],
) -> MLExitComparison:
    """Compare ML state at exit vs entry."""
    entry_ml = entry_snapshot_json.get("ml_snapshot", {})
    symbol = entry_snapshot_json.get("trade_basics", {}).get("symbol", "BTC")

    try:
        with daemon._latest_predictions_lock:
            preds = dict(daemon._latest_predictions.get(symbol, {}))
    except Exception:
        return MLExitComparison()

    cond = preds.get("conditions", {})

    exit_composite = preds.get("entry_score")
    entry_composite = entry_ml.get("composite_entry_score")
    delta = None
    if exit_composite is not None and entry_composite is not None:
        delta = exit_composite - entry_composite

    exit_vol_regime = cond.get("vol_1h", {}).get("regime")
    entry_vol_regime = entry_ml.get("vol_1h_regime")

    exit_direction = preds.get("signal")
    entry_direction = entry_ml.get("direction_signal")

    return MLExitComparison(
        composite_score_at_exit=exit_composite,
        composite_score_delta=delta,
        vol_regime_at_exit=exit_vol_regime,
        vol_regime_changed=exit_vol_regime != entry_vol_regime,
        entry_quality_pctl_at_exit=cond.get("entry_quality", {}).get("percentile"),
        direction_signal_at_exit=exit_direction,
        direction_signal_changed=exit_direction != entry_direction,
        mae_long_value_at_exit=cond.get("mae_long", {}).get("value"),
        mae_short_value_at_exit=cond.get("mae_short", {}).get("value"),
    )


# ============================================================================
# Utility helpers
# ============================================================================


def _sum_depth_within_bps(
    levels: list[dict], mid: float, bps: int, side: str,
) -> float:
    """Sum USD depth within N bps of mid on one side of the book."""
    if side == "bid":
        threshold = mid * (1 - bps / 10000)
    else:
        threshold = mid * (1 + bps / 10000)

    total = 0.0
    for level in levels:
        px = level.get("price", 0)
        sz = level.get("size", 0)
        if side == "bid" and px < threshold:
            break
        if side == "ask" and px > threshold:
            break
        total += px * sz
    return total


def _compute_pct_changes(
    daemon: Any, symbol: str, current_px: float,
) -> dict[str, float | None]:
    """Compute % price change over 1m/5m/15m/1h/4h/24h using candle data."""
    out: dict[str, float | None] = {
        "1m": None, "5m": None, "15m": None,
        "1h": None, "4h": None, "24h": None,
    }
    try:
        provider = daemon._get_provider()
        candles_1m = provider.get_candles(symbol, "1m") if hasattr(provider, "get_candles") else None
        if candles_1m and len(candles_1m) >= 2:
            now_px = candles_1m[-1].get("c", current_px)
            if len(candles_1m) >= 2:
                out["1m"] = _pct_diff(candles_1m[-2].get("c"), now_px)
            if len(candles_1m) >= 6:
                out["5m"] = _pct_diff(candles_1m[-6].get("c"), now_px)
            if len(candles_1m) >= 16:
                out["15m"] = _pct_diff(candles_1m[-16].get("c"), now_px)
            if len(candles_1m) >= 61:
                out["1h"] = _pct_diff(candles_1m[-61].get("c"), now_px)
    except Exception:
        pass
    return out


def _pct_diff(old: float | None, new: float | None) -> float | None:
    if old is None or new is None or old == 0:
        return None
    return round((new - old) / old * 100, 4)


def _compute_pnl_pct(entry_px: float, exit_px: float, side: str) -> float:
    if entry_px == 0:
        return 0.0
    raw = (exit_px - entry_px) / entry_px * 100
    return raw if side == "long" else -raw


def _compute_roe(
    entry_px: float, exit_px: float, side: str, leverage: int,
) -> float:
    return _compute_pnl_pct(entry_px, exit_px, side) * leverage


def _fetch_hold_candles(
    provider: Any, symbol: str, entry_ts: str, exit_ts: str,
) -> list[list[float]]:
    """Fetch 1m candles covering the trade hold period."""
    try:
        entry_dt = datetime.fromisoformat(entry_ts.replace("Z", "+00:00"))
        exit_dt = datetime.fromisoformat(exit_ts.replace("Z", "+00:00"))
        start_ms = int(entry_dt.timestamp() * 1000)
        end_ms = int(exit_dt.timestamp() * 1000)
        candles = provider.get_candles(symbol, "1m", start_ms, end_ms) or []
        return [
            [c["t"], c["o"], c["h"], c["l"], c["c"], c.get("v", 0)]
            for c in candles
        ]
    except Exception:
        logger.debug("Failed to fetch hold candles", exc_info=True)
        return []
