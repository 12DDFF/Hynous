"""
Trading Tools — get_account, close_position, modify_position

Gives the agent read/close/modify capabilities on Hyperliquid. Entry
execution has moved to the v2 mechanical path
(`src/hynous/mechanical_entry/executor.py`), which imports `_place_triggers`
and `_retry_exchange_call` from this module.

Design principles:
  - get_account: flexible views (summary/positions/orders/full)
  - close_position: requires reasoning — every exit is documented
  - modify_position: requires reasoning — every adjustment is documented

Standard tool module pattern:
  1. TOOL_DEF dicts
  2. handler functions
  3. register() wires into registry
"""

import logging
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _record_trade_span(
    trade_tool: str,
    step: str,
    success: bool,
    detail: str,
    duration_ms: int = 0,
    **extra,
) -> None:
    """Record a trade step span to the active debug trace.

    Silent no-op if no trace is active or if recording fails.
    Must NEVER raise — trading is more important than tracing.

    Args:
        trade_tool: Which trade tool is running ("execute_trade", "close_position", "modify_position").
        step: Step name (e.g. "circuit_breaker", "order_fill", "stop_loss").
        success: Whether this step succeeded.
        detail: Human-readable one-liner (also useful for AI agents parsing the trace).
        duration_ms: Wall clock time for this step (0 if instant/negligible).
        **extra: Additional step-specific fields merged into the span dict.
    """
    try:
        from ...core.request_tracer import get_tracer, get_active_trace, SPAN_TRADE_STEP
        trace_id = get_active_trace()
        if not trace_id:
            return
        span = {
            "type": SPAN_TRADE_STEP,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": duration_ms,
            "trade_tool": trade_tool,
            "step": step,
            "success": success,
            "detail": detail,
        }
        span.update(extra)
        get_tracer().record_span(trace_id, span)
    except Exception:
        pass


# =============================================================================
# Helpers
# =============================================================================

def _is_rate_limit_error(exc: Exception) -> bool:
    """Return True if the exception is a 429 / rate-limit response."""
    msg = str(exc).lower()
    return "429" in msg or "too many requests" in msg or "rate limit" in msg


def _retry_exchange_call(fn, *args, max_attempts: int = 3, wait_s: float = 6.0, **kwargs):
    """Call fn(*args, **kwargs) with retry on rate-limit errors.

    Retries up to max_attempts times, waiting wait_s seconds between each
    attempt on 429 / rate-limit errors only.  Any other exception is
    re-raised immediately without retrying.
    """
    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            if _is_rate_limit_error(exc):
                last_exc = exc
                if attempt < max_attempts - 1:
                    logger.warning(
                        "Rate limit on attempt %d/%d — retrying in %.0fs",
                        attempt + 1, max_attempts, wait_s,
                    )
                    time.sleep(wait_s)
            else:
                raise  # Non-rate-limit error — fail fast
    raise last_exc  # All retries exhausted


def _get_trading_provider():
    """Get the Hyperliquid provider with trading capabilities."""
    from ...data.providers.hyperliquid import get_provider
    from ...core.config import load_config
    config = load_config()
    provider = get_provider(config=config)
    return provider, config


def _get_ml_conditions(symbol: str) -> dict | None:
    """Get latest ML condition predictions for a symbol from daemon cache.

    Returns the conditions dict or None if unavailable/stale (>10min).
    """
    try:
        from ..daemon import get_active_daemon
        daemon = get_active_daemon()
        if not daemon or not hasattr(daemon, '_latest_predictions'):
            return None
        pred = daemon._latest_predictions.get(symbol, {})
        conditions = pred.get("conditions", {})
        cond_ts = conditions.get("timestamp", 0)
        if time.time() - cond_ts > 600:
            return None
        if not conditions:
            return None
        # Include composite entry score in the returned dict
        conditions["_entry_score"] = pred.get("entry_score")
        conditions["_entry_score_label"] = pred.get("entry_score_label")
        conditions["_entry_score_components"] = pred.get("entry_score_components")
        return conditions
    except Exception:
        return None


def _check_trading_allowed(is_new_entry: bool = True, symbol: str | None = None) -> str | None:
    """Check if trading is currently allowed by the daemon's guardrails.

    Returns an error message string if blocked, or None if trading is allowed.

    Args:
        is_new_entry: True for new trades. False for closes/modifies (always allowed).
        symbol: Symbol being traded (for duplicate position check).
    """
    if not is_new_entry:
        return None  # Always allow closing/modifying existing positions

    try:
        from ...intelligence.daemon import get_active_daemon
        daemon = get_active_daemon()
        if daemon is None:
            return None  # Daemon not running — no guardrails to enforce

        if daemon.trading_paused:
            return (
                f"BLOCKED: Circuit breaker active — daily loss ${abs(daemon.daily_realized_pnl):,.2f} "
                f"exceeds limit. Trading paused until UTC midnight. "
                f"Focus on analysis and learning."
            )

        # Duplicate position check — prevent opening on same symbol
        if symbol and symbol.upper() in daemon._prev_positions:
            existing = daemon._prev_positions[symbol.upper()]
            return (
                f"BLOCKED: Already have a {existing['side'].upper()} position in {symbol.upper()}. "
                f"Close or modify it instead of opening a duplicate."
            )

        max_pos = daemon.config.daemon.max_open_positions
        if max_pos > 0 and len(daemon._prev_positions) >= max_pos:
            return (
                f"BLOCKED: Max open positions ({max_pos}) reached. "
                f"Currently holding: {', '.join(daemon._prev_positions.keys())}. "
                f"Close a position before opening a new one."
            )
    except Exception:
        pass  # If daemon module not available, allow trading

    return None


def _fmt_price(price: float) -> str:
    """Format a price for compact display."""
    if abs(price) < 0.005:
        return "$0.00"
    elif abs(price) >= 1000:
        return f"${price:,.0f}"
    elif abs(price) >= 1:
        return f"${price:,.2f}"
    elif abs(price) >= 0.01:
        return f"${price:.4f}"
    else:
        return f"${price:.6f}"


def _fmt_pct(pct: float) -> str:
    """Format a percentage with sign."""
    return f"{pct:+.2f}%"


# =============================================================================
# 1. GET ACCOUNT
# =============================================================================

ACCOUNT_TOOL_DEF = {
    "name": "get_account",
    "description": (
        "Check your Hyperliquid account — balance, positions, and/or orders.\n"
        "Flexible views let you see exactly what you need:\n\n"
        "Views:\n"
        "- summary: Balance, margin, equity overview\n"
        "- positions: Open positions with entry, mark, PnL, leverage, liquidation\n"
        "- orders: All pending orders — resting limits, stop losses, take profits\n"
        "- full: Everything at once\n\n"
        "Smart default: shows full if positions exist, summary if account is empty.\n\n"
        "Examples:\n"
        '  {} → smart default\n'
        '  {"view": "positions"} → just open positions\n'
        '  {"view": "orders"} → see all stop losses, take profits, pending limits\n'
        '  {"view": "orders", "symbol": "BTC"} → only BTC orders\n'
        '  {"view": "positions", "symbol": "ETH"} → only ETH position\n'
        '  {"view": "full"} → complete account state'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "view": {
                "type": "string",
                "enum": ["summary", "positions", "orders", "full"],
                "description": (
                    "What to display. Default: smart — full if you have positions, "
                    "summary if account is empty."
                ),
            },
            "symbol": {
                "type": "string",
                "description": "Filter to a specific symbol (e.g. BTC, ETH, SOL).",
            },
        },
    },
}


def handle_get_account(
    view: str | None = None,
    symbol: str | None = None,
) -> str:
    """Handle the get_account tool call."""
    provider, config = _get_trading_provider()

    if not provider.can_trade:
        return "Trading not available — no private key configured."

    try:
        state = provider.get_user_state()
    except Exception as e:
        return f"Error fetching account state: {e}"

    if symbol:
        symbol = symbol.upper()

    positions = state["positions"]
    has_positions = len(positions) > 0

    # Smart default: full if positions exist, summary if empty
    if view is None:
        view = "full" if has_positions else "summary"

    sections = []

    # --- Summary section ---
    if view in ("summary", "full"):
        sections.append(_account_summary(state))

    # --- Positions section ---
    if view in ("positions", "full"):
        sections.append(_account_positions(state, symbol))

    # --- Orders section ---
    if view in ("orders", "full"):
        try:
            trigger_orders = provider.get_trigger_orders(symbol)
            limit_orders = provider.get_open_orders()
            if symbol:
                limit_orders = [o for o in limit_orders if o["coin"] == symbol]
            sections.append(_account_orders(trigger_orders, limit_orders, symbol))
        except Exception as e:
            sections.append(f"Orders: Error — {e}")

    return "\n\n".join(s for s in sections if s)


def _account_summary(state: dict) -> str:
    """Format account balance summary."""
    acct = state["account_value"]
    margin = state["total_margin"]
    avail = state["withdrawable"]
    pnl = state["unrealized_pnl"]
    margin_pct = (margin / acct * 100) if acct > 0 else 0
    pos_count = len(state["positions"])

    lines = [
        f"Account Value: {_fmt_price(acct)}",
        f"Available Margin: {_fmt_price(avail)}",
        f"Margin Used: {_fmt_price(margin)} ({margin_pct:.1f}%)",
        f"Unrealized PnL: {_fmt_price(pnl)}",
        f"Open Positions: {pos_count}",
    ]
    return "\n".join(lines)


def _account_positions(state: dict, symbol: str | None) -> str:
    """Format open positions."""
    positions = state["positions"]
    if symbol:
        positions = [p for p in positions if p["coin"] == symbol]

    if not positions:
        label = f"No open {symbol} position." if symbol else "No open positions."
        return label

    lines = []
    for p in positions:
        side = p["side"].upper()
        lines.append(
            f"{p['coin']} {side} | Size: {p['size']:.6g} ({_fmt_price(p['size_usd'])}) | "
            f"Entry: {_fmt_price(p['entry_px'])} | Mark: {_fmt_price(p['mark_px'])}"
        )
        liq_str = _fmt_price(p['liquidation_px']) if p['liquidation_px'] else "N/A"
        lines.append(
            f"  PnL: {_fmt_price(p['unrealized_pnl'])} ({_fmt_pct(p['return_pct'])}) | "
            f"Liq: {liq_str} | Margin: {_fmt_price(p['margin_used'])} | "
            f"Leverage: {p['leverage']}x"
        )

    return "\n".join(lines)


def _account_orders(
    trigger_orders: list[dict],
    limit_orders: list[dict],
    symbol: str | None,
) -> str:
    """Format open orders (triggers + resting limits)."""
    if not trigger_orders and not limit_orders:
        label = f"No open orders for {symbol}." if symbol else "No open orders."
        return label

    lines = []

    # Trigger orders (SL, TP, conditional)
    if trigger_orders:
        lines.append("Trigger Orders:")
        for o in trigger_orders:
            side_label = o["side"].upper()
            otype = o["order_type"].replace("_", " ").upper()
            trigger_str = _fmt_price(o["trigger_px"]) if o["trigger_px"] else "?"
            sz_str = f"{o['size']:.6g}"
            ro = " [reduce-only]" if o["reduce_only"] else ""
            lines.append(
                f"  {o['coin']} {otype} | {side_label} {sz_str} @ trigger {trigger_str}{ro} "
                f"(oid: {o['oid']})"
            )

    # Resting limit orders
    if limit_orders:
        lines.append("Limit Orders:")
        for o in limit_orders:
            side_label = o["side"].upper()
            lines.append(
                f"  {o['coin']} LIMIT | {side_label} {o['size']:.6g} @ {_fmt_price(o['limit_px'])} "
                f"(oid: {o['oid']})"
            )

    return "\n".join(lines)


def _place_triggers(
    provider, symbol: str, is_buy: bool, sz: float,
    stop_loss: float | None, take_profit: float | None,
    lines: list[str],
    entry_px: float = 0,
) -> None:
    """Place stop loss and/or take profit trigger orders. Appends status to lines.

    Uses entry_px for distance display instead of fetching a fresh price,
    avoiding redundant HTTP calls during trade execution.
    """
    if stop_loss is not None:
        try:
            provider.place_trigger_order(
                symbol=symbol,
                is_buy=not is_buy,
                sz=sz,
                trigger_px=stop_loss,
                tpsl="sl",
            )
            if entry_px > 0:
                sl_dist = abs((stop_loss - entry_px) / entry_px * 100)
                lines.append(f"Stop Loss: {_fmt_price(stop_loss)} ({sl_dist:.1f}% from entry) [set]")
            else:
                lines.append(f"Stop Loss: {_fmt_price(stop_loss)} [set]")
        except Exception as e:
            logger.error("Failed to place stop loss: %s", e)
            lines.append(f"Stop Loss: {_fmt_price(stop_loss)} [FAILED: {e}]")

    if take_profit is not None:
        try:
            provider.place_trigger_order(
                symbol=symbol,
                is_buy=not is_buy,
                sz=sz,
                trigger_px=take_profit,
                tpsl="tp",
            )
            if entry_px > 0:
                tp_dist = abs((take_profit - entry_px) / entry_px * 100)
                lines.append(f"Take Profit: {_fmt_price(take_profit)} ({tp_dist:.1f}% from entry) [set]")
            else:
                lines.append(f"Take Profit: {_fmt_price(take_profit)} [set]")
        except Exception as e:
            logger.error("Failed to place take profit: %s", e)
            lines.append(f"Take Profit: {_fmt_price(take_profit)} [FAILED: {e}]")


# =============================================================================
# 3. CLOSE POSITION
# =============================================================================

CLOSE_TOOL_DEF = {
    "name": "close_position",
    "description": (
        "Close an open position — full or partial, market or limit exit.\n"
        "Every close requires reasoning — documenting why builds my learning loop.\n\n"
        "Exit methods:\n"
        "- market (default): Immediate close at current price\n"
        "- limit: Place limit order at target exit price\n\n"
        "Examples:\n"
        '  {"symbol": "BTC", "reasoning": "Thesis invalidated — broke key support at 65K"}\n'
        '  {"symbol": "ETH", "partial_pct": 50, "reasoning": "Taking half off — hit first target"}\n'
        '  {"symbol": "SOL", "order_type": "limit", "limit_price": 180, '
        '"reasoning": "Exit at overhead resistance, patient exit"}'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": "Asset to close (e.g. BTC, ETH, SOL).",
            },
            "order_type": {
                "type": "string",
                "enum": ["market", "limit"],
                "description": "Exit type. Default: market.",
            },
            "limit_price": {
                "type": "number",
                "description": "Exit price for limit close. Required when order_type is limit.",
            },
            "partial_pct": {
                "type": "number",
                "description": "Percentage to close (1-100). Default: 100 (full close).",
                "minimum": 1,
                "maximum": 100,
            },
            "force": {
                "type": "boolean",
                "description": "Deprecated — no longer has any effect. Kept for backward compatibility.",
            },
            "reasoning": {
                "type": "string",
                "description": "Why you're closing — always stored in memory for learning.",
            },
        },
        "required": ["symbol", "reasoning"],
    },
}


def handle_close_position(
    symbol: str,
    reasoning: str,
    order_type: str = "market",
    limit_price: float | None = None,
    partial_pct: float = 100,
    force: bool = False,
) -> str:
    """Handle the close_position tool call."""
    provider, config = _get_trading_provider()

    if not provider.can_trade:
        return "Trading not available — no private key configured."

    symbol = symbol.upper()

    # --- Get current position ---
    _pos_start = time.monotonic()
    try:
        state = provider.get_user_state()
    except Exception as e:
        _record_trade_span("close_position", "position_lookup", False, f"Failed to fetch state: {e}", duration_ms=int((time.monotonic() - _pos_start) * 1000), symbol=symbol, error=str(e))
        return f"Error fetching account state: {e}"

    position = None
    for p in state["positions"]:
        if p["coin"] == symbol:
            position = p
            break

    if not position:
        _record_trade_span("close_position", "position_lookup", False, f"No open position for {symbol}", duration_ms=int((time.monotonic() - _pos_start) * 1000), symbol=symbol)
        return f"No open position for {symbol}."

    _record_trade_span(
        "close_position", "position_lookup", True,
        f"Found {position['side'].upper()} {symbol} | Entry: {_fmt_price(position.get('entry_px', 0))} | Size: {position['size']:.6g}",
        duration_ms=int((time.monotonic() - _pos_start) * 1000),
        symbol=symbol, side=position["side"],
        entry_px=position.get("entry_px", 0), size=position["size"],
    )

    # --- Autonomous close lockout: agent cannot close from daemon wakes ---
    # Mechanical exits (trailing stop, dynamic SL, fee-BE) handle all exits.
    # Only user-initiated closes (chat, Discord) are allowed through.
    try:
        from ...core.trading_settings import get_trading_settings
        _ts = get_trading_settings()
        if _ts.autonomous_close_lockout:
            from ...core.request_tracer import get_active_trace, get_tracer
            _trace_id = get_active_trace()
            if _trace_id:
                _trace = get_tracer()._active.get(_trace_id)
                if _trace and _trace.get("source", "").startswith("daemon:"):
                    _record_trade_span(
                        "close_position", "autonomous_lockout", False,
                        f"BLOCKED: autonomous close not allowed (source={_trace['source']})",
                    )
                    return (
                        f"BLOCKED: You cannot close {symbol} during autonomous operation. "
                        f"The mechanical exit system (dynamic SL / fee-BE / trailing stop) "
                        f"manages all exits. Only the user can close positions manually via chat. "
                        f"Focus on entries — exits are mechanical."
                    )
    except Exception:
        pass  # If tracing unavailable, allow the close (safety fallback)

    # --- Trailing stop lockout: agent cannot close when trail is active ---
    # Once the trailing stop activates, the mechanical system owns the exit.
    # The agent's job is entries only — exits are fully mechanical.
    try:
        from ...intelligence.daemon import get_active_daemon
        _daemon = get_active_daemon()
        if _daemon and _daemon.is_trailing_active(symbol):
            trail_px = _daemon._trailing_stop_px.get(symbol, 0)
            peak = _daemon.get_peak_roe(symbol)
            _record_trade_span(
                "close_position", "trailing_lockout", False,
                f"BLOCKED: trailing stop active (peak {peak:.1f}%, trail @ ${trail_px:,.2f})",
            )
            return (
                f"BLOCKED: Trailing stop is active for {symbol}. "
                f"The mechanical exit system owns this position "
                f"(peak ROE {peak:+.1f}%, trail SL @ ${trail_px:,.2f}). "
                f"You cannot close manually while the trail is active. "
                f"The trailing stop will exit when the price reverses to the trail level."
            )
    except Exception:
        pass  # If daemon unavailable, allow the close (safety fallback)

    # --- Validate limit close ---
    if order_type == "limit" and limit_price is None:
        return "Error: limit_price required for limit close."

    # --- Calculate close size ---
    full_size = position["size"]
    is_long = position["side"] == "long"

    if partial_pct < 100:
        sz_decimals = provider._get_sz_decimals(symbol)
        close_size = round(full_size * (partial_pct / 100), sz_decimals)
        close_label = f"{partial_pct:.0f}% partial"
    else:
        close_size = None  # None = full close
        close_label = "full"

    # --- Execute close ---
    if order_type == "limit":
        try:
            actual_sz = close_size or full_size
            result = provider.limit_open(
                symbol=symbol,
                is_buy=not is_long,  # Close: sell if long, buy if short
                limit_px=limit_price,
                sz=actual_sz,
            )
        except Exception as e:
            return f"Error placing limit close: {e}"

        if result["status"] == "resting":
            lines = [
                f"LIMIT CLOSE PLACED: {symbol} {position['side'].upper()} ({close_label})",
                f"Exit price: {_fmt_price(limit_price)}",
                f"Size: {actual_sz:.6g} {symbol}",
                f"Status: Resting (oid: {result.get('oid', '?')})",
                f"Reason: {reasoning}",
            ]
            return "\n".join(lines)

        # Limit filled immediately
        exit_px = result.get("avg_px", limit_price)
        closed_sz = result.get("filled_sz", actual_sz)
    else:
        # Market close — retries on 429 (rate limit) up to 3×, 6s apart
        slip = config.hyperliquid.default_slippage
        _close_start = time.monotonic()
        try:
            result = _retry_exchange_call(
                provider.market_close, symbol, size=close_size, slippage=slip,
            )
        except Exception as e:
            _record_trade_span("close_position", "order_fill", False, f"Close failed: {e}", duration_ms=int((time.monotonic() - _close_start) * 1000), symbol=symbol, error=str(e))
            return f"Error closing position: {e}"

        if not isinstance(result, dict):
            _record_trade_span("close_position", "order_fill", False, "Unexpected response", duration_ms=int((time.monotonic() - _close_start) * 1000), symbol=symbol)
            return "Unexpected close response. Try again."
        exit_px = result.get("avg_px", 0)
        closed_sz = result.get("filled_sz", close_size or full_size)
        _record_trade_span(
            "close_position", "order_fill", True,
            f"Closed {closed_sz:.6g} {symbol} @ {_fmt_price(exit_px)}",
            duration_ms=int((time.monotonic() - _close_start) * 1000),
            symbol=symbol, exit_px=exit_px, closed_sz=closed_sz,
        )

    # Invalidate briefing cache so next chat() gets fresh position data
    try:
        from ..briefing import invalidate_briefing_cache
        invalidate_briefing_cache()
    except Exception:
        pass
    _record_trade_span("close_position", "cache_invalidation", True, "Briefing cache cleared")

    # --- Calculate realized PnL ---
    entry_px = position.get("entry_px", 0)
    if is_long:
        pnl_per_unit = exit_px - entry_px
    else:
        pnl_per_unit = entry_px - exit_px
    realized_pnl = pnl_per_unit * closed_sz
    # Fee estimate (taker 0.035% per side — entry + exit)
    entry_fee = closed_sz * entry_px * 0.00035
    exit_fee = closed_sz * exit_px * 0.00035
    fee_estimate = entry_fee + exit_fee
    realized_pnl_net = realized_pnl - fee_estimate
    pnl_pct = (pnl_per_unit / entry_px * 100) if entry_px > 0 else 0
    # Leveraged return on margin for consistency with position display
    margin_used = position.get("margin_used", 0)
    if margin_used > 0 and partial_pct < 100:
        lev_return = realized_pnl_net / (margin_used * partial_pct / 100) * 100
    elif margin_used > 0:
        lev_return = realized_pnl_net / margin_used * 100
    else:
        lev_return = pnl_pct

    _record_trade_span(
        "close_position", "pnl_calculation", True,
        f"PnL: {'+'if realized_pnl_net >= 0 else ''}{_fmt_price(realized_pnl_net)} "
        f"({lev_return:+.1f}% on margin, {_fmt_pct(pnl_pct)} price)",
        entry_px=entry_px, exit_px=exit_px,
        pnl_gross=round(realized_pnl, 2), fee_estimate=round(fee_estimate, 2),
        pnl_net=round(realized_pnl_net, 2), pnl_pct=round(pnl_pct, 2),
        lev_return_pct=round(lev_return, 2),
    )

    # --- Cancel associated orders on full close ---
    cancelled = 0
    if partial_pct >= 100:
        _cancel_start = time.monotonic()
        try:
            # Cancel trigger orders (SL/TP) — cancel_all_orders only handles limits
            triggers = provider.get_trigger_orders(symbol)
            for t in triggers:
                if t.get("oid"):
                    provider.cancel_order(symbol, t["oid"])
                    cancelled += 1
            # Cancel resting limit orders
            cancelled += provider.cancel_all_orders(symbol)
            _record_trade_span("close_position", "order_cancellation", True, f"Cancelled {cancelled} order(s)", duration_ms=int((time.monotonic() - _cancel_start) * 1000), symbol=symbol, count=cancelled)
        except Exception as e:
            logger.error("Failed to cancel orders for %s: %s", symbol, e)
            _record_trade_span("close_position", "order_cancellation", False, f"Cancel failed: {e}", duration_ms=int((time.monotonic() - _cancel_start) * 1000), symbol=symbol, error=str(e))

    pnl_sign = "+" if realized_pnl_net >= 0 else ""
    action_label_upper = "PARTIAL CLOSE" if partial_pct < 100 else "CLOSED"

    # Detect fee-loss: directionally correct but fees ate the profit
    is_fee_loss  = realized_pnl > 0 and realized_pnl_net < 0
    is_fee_heavy = (not is_fee_loss) and realized_pnl > 0 and fee_estimate > realized_pnl * 0.5

    # --- Build result ---
    lines = [
        f"{action_label_upper}: {symbol} {position['side'].upper()} ({close_label})",
        f"Entry: {_fmt_price(entry_px)} → Exit: {_fmt_price(exit_px)}",
        f"Realized PnL: {pnl_sign}{_fmt_price(realized_pnl_net)} ({lev_return:+.1f}% on margin, {_fmt_pct(pnl_pct)} price move)",
        f"Size closed: {closed_sz:.6g} {symbol}",
    ]
    if is_fee_loss:
        lines.append(
            f"⚠ FEE LOSS: Trade was directionally correct (gross +{_fmt_price(realized_pnl)}) "
            f"but fees ({_fmt_price(fee_estimate)}) ate the profit. "
            f"This does NOT count as a bad trade — the direction was right, the exit was too early. "
            f"Let TP work or need wider targets to clear fees."
        )
    if is_fee_heavy:
        lines.append(
            f"Note: Fees ({_fmt_price(fee_estimate)}) took "
            f"{fee_estimate/realized_pnl*100:.0f}% of gross profit "
            f"({_fmt_price(realized_pnl)}). Exit was early — let TP work next time."
        )
    if cancelled > 0:
        lines.append(f"Cancelled {cancelled} associated order(s)")
    lines.append(f"Reason: {reasoning}")

    return "\n".join(lines)


# =============================================================================
# 4. MODIFY POSITION
# =============================================================================

MODIFY_TOOL_DEF = {
    "name": "modify_position",
    "description": (
        "Modify an existing position — update stop loss, take profit, leverage, "
        "or manage orders. Every modification requires reasoning — documenting "
        "adjustments is how I learn position management.\n\n"
        "Examples:\n"
        '  {"symbol": "BTC", "stop_loss": 65000, "reasoning": "Trailing stop to breakeven after 3% move"}\n'
        '  {"symbol": "ETH", "take_profit": 4200, "stop_loss": 3400, '
        '"reasoning": "Tightening range — volatility compressing"}\n'
        '  {"symbol": "SOL", "leverage": 20, "reasoning": "Thesis confirmed — increasing conviction"}\n'
        '  {"symbol": "BTC", "cancel_orders": true, '
        '"reasoning": "Removing all triggers — managing manually on breakout"}\n'
        '  {"symbol": "ETH", "cancel_orders": true, "stop_loss": 3200, '
        '"reasoning": "Replacing tight SL with wider one — giving more room"}'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": "Asset to modify (e.g. BTC, ETH, SOL).",
            },
            "stop_loss": {
                "type": "number",
                "description": "New stop loss price. Only the existing SL is replaced — TP is preserved.",
            },
            "take_profit": {
                "type": "number",
                "description": "New take profit price. Only the existing TP is replaced — SL is preserved.",
            },
            "leverage": {
                "type": "integer",
                "description": "New leverage for this symbol.",
                "minimum": 1,
            },
            "cancel_orders": {
                "type": "boolean",
                "description": "Cancel all existing orders for this symbol. Happens before placing new ones.",
            },
            "reasoning": {
                "type": "string",
                "description": "Why you're modifying — always stored in memory for learning position management.",
            },
        },
        "required": ["symbol", "reasoning"],
    },
}


def handle_modify_position(
    symbol: str,
    reasoning: str,
    stop_loss: float | None = None,
    take_profit: float | None = None,
    leverage: int | None = None,
    cancel_orders: bool | None = None,
) -> str:
    """Handle the modify_position tool call."""
    provider, config = _get_trading_provider()

    if not provider.can_trade:
        return "Trading not available — no private key configured."

    symbol = symbol.upper()

    # Check something was requested
    if not any([stop_loss, take_profit, leverage, cancel_orders]):
        return "Nothing to modify. Provide stop_loss, take_profit, leverage, or cancel_orders."

    # --- Get current position ---
    _pos_start = time.monotonic()
    try:
        state = provider.get_user_state()
    except Exception as e:
        _record_trade_span("modify_position", "position_lookup", False, f"Failed to fetch state: {e}", duration_ms=int((time.monotonic() - _pos_start) * 1000), symbol=symbol, error=str(e))
        return f"Error fetching account state: {e}"

    position = None
    for p in state["positions"]:
        if p["coin"] == symbol:
            position = p
            break

    if not position:
        _record_trade_span("modify_position", "position_lookup", False, f"No open position for {symbol}", duration_ms=int((time.monotonic() - _pos_start) * 1000), symbol=symbol)
        return f"No open position for {symbol}."

    _record_trade_span(
        "modify_position", "position_lookup", True,
        f"Found {position['side'].upper()} {symbol} | Mark: {_fmt_price(position.get('mark_px', 0))} | Size: {position.get('size', 0):.6g}",
        duration_ms=int((time.monotonic() - _pos_start) * 1000),
        symbol=symbol, side=position.get("side"), mark_px=position.get("mark_px", 0), size=position.get("size", 0),
    )

    is_long = position.get("side") == "long"
    mark_px = position.get("mark_px", 0)
    sz = position.get("size", 0)

    # --- Validate new levels vs current mark ---
    if stop_loss is not None:
        if is_long and stop_loss >= mark_px:
            return (
                f"Error: Stop loss ({_fmt_price(stop_loss)}) must be below "
                f"mark price ({_fmt_price(mark_px)}) for a long."
            )
        if not is_long and stop_loss <= mark_px:
            return (
                f"Error: Stop loss ({_fmt_price(stop_loss)}) must be above "
                f"mark price ({_fmt_price(mark_px)}) for a short."
            )

    if take_profit is not None:
        if is_long and take_profit <= mark_px:
            return (
                f"Error: Take profit ({_fmt_price(take_profit)}) must be above "
                f"mark price ({_fmt_price(mark_px)}) for a long."
            )
        if not is_long and take_profit >= mark_px:
            return (
                f"Error: Take profit ({_fmt_price(take_profit)}) must be below "
                f"mark price ({_fmt_price(mark_px)}) for a short."
            )

    # --- Autonomous modify lockout: restrict destructive modifications from daemon wakes ---
    # During daemon wakes: block cancel_orders (nukes SL+TP) and TP changes.
    # SL tightening remains allowed (reinforces mechanical exits).
    try:
        from ...core.trading_settings import get_trading_settings as _gts
        _ts_mod = _gts()
        if _ts_mod.autonomous_close_lockout:
            from ...core.request_tracer import get_active_trace as _gat, get_tracer as _gt
            _tid = _gat()
            if _tid:
                _tr = _gt()._active.get(_tid)
                if _tr and _tr.get("source", "").startswith("daemon:"):
                    if cancel_orders:
                        return (
                            f"BLOCKED: Cannot cancel orders for {symbol} during autonomous operation. "
                            f"Mechanical stops must remain in place. Only the user can cancel orders via chat."
                        )
                    if take_profit is not None:
                        return (
                            f"BLOCKED: Cannot modify take profit for {symbol} during autonomous operation. "
                            f"Only the user can adjust take profits via chat."
                        )
    except Exception:
        pass

    # --- Mechanical TP lockout: LLM can only TIGHTEN take profits, never widen ---
    # Mirrors the SL widening guard. Prevents the agent from defeating its own TP
    # by moving it out of reach. TP can only move closer to current price.
    if take_profit is not None:
        _tp_triggers = []
        try:
            _tp_triggers = provider.get_trigger_orders(symbol)
        except Exception:
            pass
        for t in _tp_triggers:
            if t.get("order_type") == "take_profit":
                existing_tp = t.get("trigger_px")
                if existing_tp is not None:
                    if is_long and take_profit > existing_tp:
                        return (
                            f"BLOCKED: Cannot widen take profit from ${existing_tp:,.2f} to ${take_profit:,.2f}. "
                            f"Take profits can only be TIGHTENED (moved closer to current price). "
                            f"Your TP must be <= ${existing_tp:,.2f} for this long."
                        )
                    if not is_long and take_profit < existing_tp:
                        return (
                            f"BLOCKED: Cannot widen take profit from ${existing_tp:,.2f} to ${take_profit:,.2f}. "
                            f"Take profits can only be TIGHTENED (moved closer to current price). "
                            f"Your TP must be >= ${existing_tp:,.2f} for this short."
                        )
                break

    # --- Fetch existing trigger orders (used by lockout check AND cancel-replace flow) ---
    existing_triggers = []
    try:
        existing_triggers = provider.get_trigger_orders(symbol)
    except Exception as e:
        logger.warning("Failed to fetch trigger orders: %s", e)

    # --- Mechanical stop lockout: LLM can only TIGHTEN stops, never widen ---
    # Protects trailing/breakeven stops set by the daemon from being overridden.
    if stop_loss is not None:
        existing_sl = None
        for t in existing_triggers:
            if t.get("order_type") == "stop_loss":
                existing_sl = t.get("trigger_px")
                break
        if existing_sl is not None:
            if is_long and stop_loss < existing_sl:
                return (
                    f"BLOCKED: Cannot widen stop loss from ${existing_sl:,.2f} to ${stop_loss:,.2f}. "
                    f"Mechanical stops can only be TIGHTENED (moved closer to current price). "
                    f"Your SL must be >= ${existing_sl:,.2f} for this long."
                )
            if not is_long and stop_loss > existing_sl:
                return (
                    f"BLOCKED: Cannot widen stop loss from ${existing_sl:,.2f} to ${stop_loss:,.2f}. "
                    f"Mechanical stops can only be TIGHTENED (moved closer to current price). "
                    f"Your SL must be <= ${existing_sl:,.2f} for this short."
                )

    changes = []

    # --- Cancel orders ---
    if cancel_orders:
        # Explicit cancel: nuke everything for this symbol
        try:
            # Cancel trigger orders (SL/TP)
            for t in existing_triggers:
                if t.get("oid"):
                    provider.cancel_order(symbol, t["oid"])
            # Cancel resting limit orders
            cancelled = provider.cancel_all_orders(symbol)
            total = len(existing_triggers) + cancelled
            changes.append(f"Cancelled {total} existing order(s)")
        except Exception as e:
            logger.error("Failed to cancel orders: %s", e)
            changes.append(f"Cancel orders failed: {e}")
    else:
        # Selective cancel: only cancel the specific type being replaced
        for t in existing_triggers:
            oid = t.get("oid")
            if not oid:
                continue
            otype = t.get("order_type", "")
            # Cancel old SL if we're placing a new SL
            if stop_loss is not None and otype == "stop_loss":
                try:
                    provider.cancel_order(symbol, oid)
                    changes.append(f"Cancelled old stop loss @ {_fmt_price(t['trigger_px'])}")
                except Exception as e:
                    logger.warning("Failed to cancel old SL: %s", e)
            # Cancel old TP if we're placing a new TP
            if take_profit is not None and otype == "take_profit":
                try:
                    provider.cancel_order(symbol, oid)
                    changes.append(f"Cancelled old take profit @ {_fmt_price(t['trigger_px'])}")
                except Exception as e:
                    logger.warning("Failed to cancel old TP: %s", e)

    # --- Place new stop loss ---
    if stop_loss is not None:
        try:
            provider.place_trigger_order(
                symbol=symbol,
                is_buy=not is_long,
                sz=sz,
                trigger_px=stop_loss,
                tpsl="sl",
            )
            sl_dist = abs((stop_loss - mark_px) / mark_px * 100)
            changes.append(f"Stop loss set: {_fmt_price(stop_loss)} ({sl_dist:.1f}% from mark)")
        except Exception as e:
            changes.append(f"Stop loss FAILED: {e}")

    # --- Place new take profit ---
    if take_profit is not None:
        try:
            provider.place_trigger_order(
                symbol=symbol,
                is_buy=not is_long,
                sz=sz,
                trigger_px=take_profit,
                tpsl="tp",
            )
            tp_dist = abs((take_profit - mark_px) / mark_px * 100)
            changes.append(f"Take profit set: {_fmt_price(take_profit)} ({tp_dist:.1f}% from mark)")
        except Exception as e:
            changes.append(f"Take profit FAILED: {e}")

    # --- Update leverage ---
    if leverage is not None:
        try:
            provider.update_leverage(symbol, leverage)
            changes.append(f"Leverage updated: {leverage}x")
        except Exception as e:
            changes.append(f"Leverage update FAILED: {e}")

    # Record order management span summarizing all changes
    _record_trade_span(
        "modify_position", "order_management",
        bool(changes),
        "; ".join(changes) if changes else "No changes applied",
        symbol=symbol,
        new_stop=stop_loss, new_target=take_profit, new_leverage=leverage,
        cancel_all=cancel_orders,
    )

    # Invalidate briefing cache so next chat() gets fresh data
    try:
        from ..briefing import invalidate_briefing_cache
        invalidate_briefing_cache()
    except Exception:
        pass
    _record_trade_span("modify_position", "cache_invalidation", True, "Briefing cache cleared")

    # --- Build result ---
    lines = [
        f"MODIFIED: {symbol} {position['side'].upper()}",
        f"Mark: {_fmt_price(mark_px)} | Size: {sz:.6g} {symbol}",
    ]
    lines.extend(f"  {c}" for c in changes)
    lines.append(f"Reason: {reasoning}")

    return "\n".join(lines)


# =============================================================================
# 5. REGISTRATION
# =============================================================================

def register(registry) -> None:
    """Register trading tools with the registry."""
    from .registry import Tool

    registry.register(Tool(
        name=ACCOUNT_TOOL_DEF["name"],
        description=ACCOUNT_TOOL_DEF["description"],
        parameters=ACCOUNT_TOOL_DEF["parameters"],
        handler=handle_get_account,
    ))

    registry.register(Tool(
        name=CLOSE_TOOL_DEF["name"],
        description=CLOSE_TOOL_DEF["description"],
        parameters=CLOSE_TOOL_DEF["parameters"],
        handler=handle_close_position,
    ))

    registry.register(Tool(
        name=MODIFY_TOOL_DEF["name"],
        description=MODIFY_TOOL_DEF["description"],
        parameters=MODIFY_TOOL_DEF["parameters"],
        handler=handle_modify_position,
    ))
