"""Mechanical entry executor — fire the exchange call and persist the snapshot.

Plain function (no LLM, no validation gates — those ran in the trigger source).
Given a pre-validated ``EntrySignal`` and a daemon handle, this function:

1. Fetches live price + portfolio state from the provider.
2. Computes deterministic trade params via ``compute_entry_params``.
3. Sets leverage, fires the market order (with rate-limit retries).
4. Places SL/TP triggers (best-effort — failure does NOT abort the position).
5. Builds and persists a rich entry snapshot into the journal.
6. Mutates daemon state (open trade-id, entry counter, position type).

Returns the ``trade_id`` string on success, ``None`` on any failure path.

Clarifications vs the phase 5 plan sketch
(``v2-planning/08-phase-5-mechanical-entry.md`` lines 448–583):

1. **``compute_entry_params`` takes a required ``roe_target_pct``** (added in
   M1). The sketch omits it. We read it from
   ``daemon.config.v2.mechanical_entry.roe_target_pct``.

2. **``_retry_exchange_call`` and ``_place_triggers`` are imported lazily
   from the v1 tool module**, per the directive, to avoid logic duplication
   and keep the executor module import-cheap for tests. ``_place_triggers``
   takes a ``lines: list[str]`` sink; we pass ``[]`` because the executor
   has no display output to build.

3. **Trigger placement failure does NOT abort the position.** ``_place_triggers``
   catches its own per-leg exceptions internally, but we still wrap the call
   for belt-and-suspenders; any raised exception is logged and swallowed so
   the live position can fall through to snapshot-persistence and hand off
   to subsequent mechanical-exit layers (dynamic SL).

4. **Snapshot-persistence failure returns ``None``** (per sketch line 582).
   The position is live but orphaned — phase 6 reconciliation will detect
   and recover. For M3 we accept the orphan risk as the sketch specifies.

5. **No ``invalidate_briefing_cache()``** — that's v1-briefing infra; the
   mechanical flow does not serve a briefing.

6. **No ``record_micro_entry()``** — v1 micro path is not wired into the
   mechanical flow; simpler to omit than to conditionalize.
"""

from __future__ import annotations

import logging
from typing import Any

from hynous.core.trading_settings import get_trading_settings
from hynous.journal.capture import build_entry_snapshot

from .compute_entry_params import compute_entry_params
from .interface import EntrySignal

logger = logging.getLogger(__name__)


def execute_trade_mechanical(
    *,
    signal: EntrySignal,
    daemon: Any,
) -> str | None:
    """Execute a mechanical entry for the given pre-validated signal.

    Args:
        signal: EntrySignal returned by an ``EntryTriggerSource.evaluate``.
            Assumed fully gated; no re-validation is performed here.
        daemon: HynousDaemon instance (typed ``Any`` so this module stays
            independent of the intelligence package).

    Returns:
        ``trade_id`` of the persisted entry snapshot on success, or ``None``
        on any failure path (bad price, leverage-set failure, order not
        filled, snapshot persistence failure). Trigger placement failure
        does NOT cause a ``None`` return — see clarification 3.
    """
    provider = daemon._get_provider()

    # --- Pre-execution state fetch (price + portfolio) ---
    try:
        price = provider.get_price(signal.symbol)
        if not price:
            logger.error("No price for %s", signal.symbol)
            return None
        user_state = provider.get_user_state()
        portfolio_value = user_state.get("account_value", 1000)
    except Exception:
        logger.exception("Pre-execution state fetch failed for %s", signal.symbol)
        return None

    vol_regime = signal.trigger_detail.get("vol_regime", "normal")

    # --- Compute deterministic params ---
    params = compute_entry_params(
        signal=signal,
        entry_price=price,
        portfolio_value_usd=portfolio_value,
        vol_regime=vol_regime,
        roe_target_pct=daemon.config.v2.mechanical_entry.roe_target_pct,
    )

    logger.info(
        "Mechanical entry: %s %s %dx size $%.0f SL %.4f TP %.4f",
        params.symbol, params.side, params.leverage, params.size_usd,
        params.sl_px, params.tp_px,
    )

    # --- Set leverage ---
    try:
        provider.update_leverage(params.symbol, params.leverage)
    except Exception:
        logger.exception("Leverage set failed for %s", params.symbol)
        return None

    # --- Execute market order (lazy import to reuse v1 retry helper) ---
    is_buy = params.side == "long"
    slippage = daemon.config.hyperliquid.default_slippage
    try:
        from hynous.intelligence.tools.trading import _retry_exchange_call
        result = _retry_exchange_call(
            provider.market_open,
            params.symbol, is_buy, params.size_usd, slippage,
        )
    except Exception:
        logger.exception("Market order failed for %s", params.symbol)
        return None

    if not isinstance(result, dict):
        logger.error("Unexpected order response for %s: %r", params.symbol, result)
        return None
    if result.get("status") != "filled":
        logger.error(
            "Order not filled for %s: status=%r",
            params.symbol, result.get("status"),
        )
        return None

    fill_px = result.get("avg_px", price)
    fill_sz = result.get("filled_sz", 0)

    if fill_sz == 0:
        logger.error("Zero fill for %s", params.symbol)
        return None

    # --- Place SL/TP triggers (best-effort; failure does NOT abort) ---
    try:
        from hynous.intelligence.tools.trading import _place_triggers
        _place_triggers(
            provider, params.symbol, is_buy, fill_sz,
            params.sl_px, params.tp_px, [], entry_px=fill_px,
        )
    except Exception:
        logger.exception("Trigger placement failed for %s", params.symbol)
        # Intentional fall-through: position is live, mechanical exits will protect it.

    # --- Build + persist rich entry snapshot ---
    ts = get_trading_settings()
    effective_usd = params.size_usd
    fees_paid = effective_usd * (ts.taker_fee_pct / 100)

    try:
        snapshot = build_entry_snapshot(
            symbol=params.symbol,
            side=params.side,
            trade_type=params.trade_type,
            fill_px=fill_px,
            fill_sz=fill_sz,
            leverage=params.leverage,
            sl_px=params.sl_px,
            tp_px=params.tp_px,
            size_usd=effective_usd,
            reference_price=price,
            fees_paid_usd=fees_paid,
            daemon=daemon,
            trigger_source=signal.trigger_source,
            trigger_type=signal.trigger_type,
            wake_source_id=None,
            scanner_detail=signal.trigger_detail,
            scanner_score=signal.conviction,
        )
        daemon._journal_store.insert_entry_snapshot(snapshot)
    except Exception:
        logger.exception(
            "Entry snapshot persistence failed for %s — position is live but orphaned",
            params.symbol,
        )
        return None

    # --- Daemon state mutations (post-persist) ---
    daemon._open_trade_ids[params.symbol] = snapshot.trade_basics.trade_id
    daemon.record_trade_entry()
    daemon.register_position_type(params.symbol, params.trade_type)

    logger.info("Entry snapshot persisted: %s", snapshot.trade_basics.trade_id)
    return snapshot.trade_basics.trade_id
