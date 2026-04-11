"""Post-exit counterfactual computation for closed trades.

Answers questions like:
- Did the original TP hit within N hours after exit?
- Was the SL hunted (touched then price reversed >1% within 10min)?
- What was the optimal exit price and when?
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from .schema import Counterfactuals

logger = logging.getLogger(__name__)


def compute_counterfactual_window(hold_duration_s: int) -> int:
    """Return the counterfactual lookahead window in seconds.

    Rule: max(hold_duration, 2h) capped at 12h.
    """
    return min(max(hold_duration_s, 7200), 43200)


def compute_counterfactuals(
    *,
    provider: Any,
    symbol: str,
    side: str,
    entry_px: float,
    entry_ts: str,
    exit_px: float,
    exit_ts: str,
    sl_px: float | None,
    tp_px: float | None,
) -> Counterfactuals:
    """Compute counterfactuals for a closed trade.

    Fetches 1m candles from entry_ts to exit_ts + window_s and analyzes
    the best/worst prices, whether TP would have hit, and SL hunt patterns.
    """
    entry_dt = datetime.fromisoformat(entry_ts.replace("Z", "+00:00"))
    exit_dt = datetime.fromisoformat(exit_ts.replace("Z", "+00:00"))
    hold_duration = int((exit_dt - entry_dt).total_seconds())
    window_s = compute_counterfactual_window(hold_duration)

    start_ms = int(entry_dt.timestamp() * 1000)
    end_dt = exit_dt + timedelta(seconds=window_s)
    end_ms = int(end_dt.timestamp() * 1000)

    try:
        candles = provider.get_candles(symbol, "1m", start_ms, end_ms) or []
    except Exception:
        logger.debug("Counterfactual candle fetch failed", exc_info=True)
        candles = []

    if not candles:
        return Counterfactuals(
            counterfactual_window_s=window_s,
            max_favorable_price=exit_px,
            max_adverse_price=exit_px,
            optimal_exit_px=exit_px,
            optimal_exit_ts=exit_ts,
        )

    # MFE / MAE from full candle range
    if side == "long":
        max_fav_px = max(c["h"] for c in candles)
        max_adv_px = min(c["l"] for c in candles)
        optimal_exit_px = max_fav_px
    else:
        max_fav_px = min(c["l"] for c in candles)
        max_adv_px = max(c["h"] for c in candles)
        optimal_exit_px = max_fav_px

    optimal_exit_ts = _find_optimal_exit_ts(candles, side)

    # Check TP hit post-exit
    did_tp_hit = False
    did_tp_hit_ts: str | None = None
    exit_ms = int(exit_dt.timestamp() * 1000)
    if tp_px is not None:
        post_exit_candles = [c for c in candles if c["t"] > exit_ms]
        for c in post_exit_candles:
            if side == "long" and c["h"] >= tp_px:
                did_tp_hit = True
                did_tp_hit_ts = _ms_to_iso(c["t"])
                break
            if side == "short" and c["l"] <= tp_px:
                did_tp_hit = True
                did_tp_hit_ts = _ms_to_iso(c["t"])
                break

    # Check SL hunted pattern
    did_sl_hunted = False
    sl_hunt_reversal_pct: float | None = None
    if sl_px is not None:
        for i, c in enumerate(candles):
            touched = False
            if side == "long" and c["l"] <= sl_px:
                touched = True
            elif side == "short" and c["h"] >= sl_px:
                touched = True
            if touched:
                # Look ahead 10 candles (1m each = 10min)
                next_window = candles[i + 1 : i + 11]
                if next_window:
                    if side == "long":
                        max_after = max(c2["h"] for c2 in next_window)
                        reversal = (max_after - sl_px) / sl_px * 100
                    else:
                        min_after = min(c2["l"] for c2 in next_window)
                        reversal = (sl_px - min_after) / sl_px * 100
                    if reversal > 1.0:
                        did_sl_hunted = True
                        sl_hunt_reversal_pct = reversal
                        break

    return Counterfactuals(
        counterfactual_window_s=window_s,
        max_favorable_price=max_fav_px,
        max_adverse_price=max_adv_px,
        optimal_exit_px=optimal_exit_px,
        optimal_exit_ts=optimal_exit_ts,
        did_tp_hit_later=did_tp_hit,
        did_tp_hit_ts=did_tp_hit_ts,
        did_sl_get_hunted=did_sl_hunted,
        sl_hunt_reversal_pct=sl_hunt_reversal_pct,
    )


def _find_optimal_exit_ts(candles: list[dict], side: str) -> str:
    """Find the timestamp of the candle with the best exit price."""
    if side == "long":
        best = max(candles, key=lambda c: c["h"])
    else:
        best = min(candles, key=lambda c: c["l"])
    return _ms_to_iso(best["t"])


def _ms_to_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
