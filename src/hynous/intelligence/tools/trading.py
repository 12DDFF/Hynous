"""
Trading Tools — get_account, execute_trade, close_position, modify_position

Gives the agent full trading capabilities on Hyperliquid.
On testnet, all trades execute immediately (autonomous).
On live, write operations would require David's approval (future).

Design principles:
  - get_account: flexible views (summary/positions/orders/full)
  - execute_trade: requires thesis (reasoning), stop loss, and take profit
  - close_position: requires reasoning — every exit is documented
  - modify_position: requires reasoning — every adjustment is documented
  - ALL write operations are stored in Nous memory for learning

Every trade action creates a memory node in Nous. Over time, this builds
a graph of: thesis → entry → modifications → exit → outcome → lessons.
FSRS keeps winning patterns alive and lets failed ones decay naturally.

Standard tool module pattern:
  1. TOOL_DEF dicts
  2. handler functions
  3. register() wires into registry
"""

import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Optional

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


def _fmt_big(n: float) -> str:
    """Format large USD numbers compactly."""
    if abs(n) >= 1_000_000:
        return f"${n / 1_000_000:.1f}M"
    elif abs(n) >= 1_000:
        return f"${n / 1_000:.1f}K"
    else:
        return f"${n:.0f}"


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


# =============================================================================
# 2. EXECUTE TRADE
# =============================================================================

TRADE_TOOL_DEF = {
    "name": "execute_trade",
    "description": (
        "Execute a trade on Hyperliquid. Every trade requires a thesis, stop loss, "
        "and take profit — no exceptions. This is how I learn and manage risk.\n\n"
        "Order types:\n"
        "- market (default): Immediate fill at current price\n"
        "- limit: Resting order at your price, fills when reached\n\n"
        "Position sizing is AUTOMATIC — the system sizes every trade from your confidence score:\n"
        "  High (0.8+) → 30% of portfolio as margin\n"
        "  Medium (0.6-0.79) → 20% of portfolio as margin\n"
        "  Below 0.6 → rejected (not enough conviction)\n"
        "You never pick a size manually — just pass confidence honestly.\n\n"
        "Required parameters:\n"
        "- leverage: minimum 5x (micro requires 20x)\n"
        "- stop_loss: Where my thesis is wrong — auto-placed as trigger order\n"
        "- take_profit: Where I take profit — auto-placed as trigger order\n"
        "- reasoning: My full thesis for this trade — stored in memory\n"
        "- confidence: Conviction score (0.0-1.0) — drives position size\n\n"
        "Examples:\n"
        '  High conviction:\n'
        '    {"symbol": "BTC", "side": "long", "leverage": 20, "stop_loss": 66000, '
        '"take_profit": 72000, "confidence": 0.85, '
        '"reasoning": "Funding just reset after 3 days negative — shorts who were getting paid to hold are now paying to stay in. '
        "That means they'll start covering, which creates buy pressure. The $4.8M bid wall at 66K confirms institutions agree "
        'this is the floor. Targeting the 72K gap that shorts need to cover through."}\n'
        '  Medium conviction:\n'
        '    {"symbol": "ETH", "side": "short", "leverage": 10, "stop_loss": 3900, '
        '"take_profit": 3400, "confidence": 0.65, '
        '"reasoning": "Price has been flat for 2 days while OI keeps climbing — someone is building a big position that hasn\'t '
        "moved price yet. On 4h ETH is making lower highs while OI rises, so it's likely shorts accumulating. "
        'When they push, 3400 is the obvious target where longs get liquidated."}\n'
        '  Speculative:\n'
        '    {"symbol": "SOL", "side": "long", "leverage": 20, "order_type": "limit", '
        '"limit_price": 140, "stop_loss": 130, "take_profit": 165, "confidence": 0.5, '
        '"reasoning": "SOL sitting on 140 support that\'s held 3 times — each bounce weaker but sellers can\'t break it, '
        "which looks like seller exhaustion. If it holds again, 165 is clear air above. "
        'Small bet because I don\'t have a catalyst yet, just structure."}'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": "Asset to trade (e.g. BTC, ETH, SOL).",
            },
            "side": {
                "type": "string",
                "enum": ["long", "short"],
                "description": "Trade direction.",
            },
            "order_type": {
                "type": "string",
                "enum": ["market", "limit"],
                "description": "Order type. Default: market.",
            },
            "limit_price": {
                "type": "number",
                "description": "Price for limit orders. Required when order_type is limit.",
            },
            "leverage": {
                "type": "integer",
                "description": "Leverage for this trade. REQUIRED. Micro: 20x always. Macro: 5-20x (lower = longer hold, more room).",
                "minimum": 5,
            },
            "stop_loss": {
                "type": "number",
                "description": "Stop loss price — where my thesis is wrong. Auto-placed as trigger order.",
            },
            "take_profit": {
                "type": "number",
                "description": "Take profit price — where I exit with profit. Auto-placed as trigger order.",
            },
            "slippage": {
                "type": "number",
                "description": "Max slippage for market orders (e.g. 0.05 = 5%). Default from config.",
                "minimum": 0.001,
                "maximum": 0.5,
            },
            "confidence": {
                "type": "number",
                "description": "Conviction score (0.0-1.0). REQUIRED — the system auto-sizes the trade from this. "
                               "0.8+ = High (30% margin), 0.6-0.79 = Medium (20%), below 0.6 = rejected. "
                               "Be honest — higher conviction = bigger size = bigger P&L.",
                "minimum": 0,
                "maximum": 1,
            },
            "reasoning": {
                "type": "string",
                "description": "Full trade thesis in NARRATIVE form — explain the logic chain: "
                               "what's happening → why it matters → what I expect next. "
                               "Use 'because/so/which means' connectors, not stat lists. "
                               "BAD: 'Funding +0.013%, OI rising, book 77% bids, F&G 8'. "
                               "GOOD: 'Shorts are paying extreme funding to hold, which means they're under pressure to cover. "
                               "The heavy bid wall confirms buyers are waiting — when shorts capitulate, price squeezes up.' "
                               "Stored in memory.",
            },
            "trade_type": {
                "type": "string",
                "enum": ["macro", "micro"],
                "description": "Trade type. 'micro' = 15-60min hold, tight stops. "
                               "'macro' = hours-days, thesis-driven. Defaults to 'macro'.",
            },
        },
        "required": ["symbol", "side", "leverage", "stop_loss", "take_profit", "reasoning", "confidence"],
    },
}


def handle_execute_trade(
    symbol: str,
    side: str,
    size_usd: float | None = None,
    size: float | None = None,
    order_type: str = "market",
    limit_price: float | None = None,
    leverage: int | None = None,
    stop_loss: float | None = None,
    take_profit: float | None = None,
    slippage: float | None = None,
    confidence: float | None = None,
    reasoning: str | None = None,
    trade_type: str = "macro",
) -> str:
    """Handle the execute_trade tool call."""
    # Check circuit breaker, duplicate position, and position limits
    blocked = _check_trading_allowed(is_new_entry=True, symbol=symbol)
    if blocked:
        _record_trade_span("execute_trade", "circuit_breaker", False, f"Blocked: {blocked[:150]}", symbol=symbol)
        return blocked
    _record_trade_span("execute_trade", "circuit_breaker", True, f"Trading allowed for {symbol}", symbol=symbol)

    # Load runtime-adjustable settings
    from ...core.trading_settings import get_trading_settings
    ts = get_trading_settings()
    _warnings: list[str] = []

    # --- Micro trade enforcement ---
    if trade_type == "micro":
        pass  # No confidence cap — micros size by conviction like any trade

    provider, config = _get_trading_provider()

    if not provider.can_trade:
        return "Trading not available — no private key configured."

    symbol = symbol.upper()
    is_buy = side == "long"

    # --- Validate leverage (mandatory, min depends on trade type) ---
    min_lev = ts.micro_leverage if trade_type == "micro" else ts.macro_leverage_min
    if leverage is None or leverage < min_lev:
        if trade_type == "micro":
            return f"Error: micro trades require {ts.micro_leverage}x leverage."
        return f"Error: leverage is required and must be at least {ts.macro_leverage_min}x."
    if trade_type == "micro" and leverage < ts.micro_leverage:
        leverage = ts.micro_leverage

    # --- Get current price (needed for sizing) ---
    try:
        price = provider.get_price(symbol)
        if not price:
            return f"Error: Could not get price for {symbol}. Check symbol name."
    except Exception as e:
        return f"Error getting price: {e}"

    # --- Price drift check: compare live price vs briefing price ---
    # Agent reasons on briefing prices, but we execute at live price.
    # Warn if significant drift so agent knows its SL/TP may need adjustment.
    try:
        from ...intelligence.daemon import get_active_daemon
        _d = get_active_daemon()
        if _d and _d.snapshot and _d.snapshot.prices.get(symbol):
            _briefing_px = _d.snapshot.prices[symbol]
            _drift_pct = abs(price - _briefing_px) / _briefing_px * 100
            if _drift_pct > 0.3:
                _direction = "up" if price > _briefing_px else "down"
                _warnings.append(
                    f"Note: {symbol} moved {_direction} {_drift_pct:.2f}% since briefing "
                    f"({_fmt_price(_briefing_px)} -> {_fmt_price(price)}). "
                    f"Verify SL/TP still make sense at current price."
                )
    except Exception:
        pass

    # --- Conviction-based sizing ---
    # When confidence is provided, the system calculates the correct size.
    # Agent CAN override with size_usd/size, but auto-sizing from conviction is preferred.
    tier = None
    recommended_margin = None
    oversized = False
    portfolio = 1000
    if confidence is not None:
        if confidence < ts.tier_pass_threshold:
            return (
                f"Conviction too low ({confidence:.0%}). "
                f"Set a watchpoint and revisit when thesis strengthens."
            )

        try:
            pf_state = provider.get_user_state()
            portfolio = pf_state.get("account_value", 1000)
        except Exception:
            portfolio = 1000

        if confidence >= 0.8:
            recommended_margin = portfolio * (ts.tier_high_margin_pct / 100)
            tier = "High"
        elif confidence >= 0.6:
            recommended_margin = portfolio * (ts.tier_medium_margin_pct / 100)
            tier = "Medium"
        else:
            recommended_margin = portfolio * (ts.tier_speculative_margin_pct / 100)
            tier = "Speculative"

        # Auto-size from conviction — conviction always drives sizing
        size_usd = recommended_margin * leverage
        size = None  # clear any manual override
        logger.info("Auto-sized from %s conviction: $%.2f margin × %dx = $%.2f notional",
                    tier, recommended_margin, leverage, size_usd)

    # --- Validate sizing ---
    if size_usd is None and size is None:
        return "Error: Provide either size_usd (USD amount), size (base asset amount), or confidence for auto-sizing."

    # --- Safety cap ---
    max_size = min(config.hyperliquid.max_position_usd, ts.max_position_usd)
    if size_usd and size_usd > max_size:
        return (
            f"Error: ${size_usd:,.0f} exceeds safety cap of ${max_size:,.0f}. "
            f"Reduce size or adjust max_position_usd in config."
        )

    # Check USD-equivalent when sizing by base asset
    if size is not None and size_usd is None:
        equiv_usd = size * price
        if equiv_usd > max_size:
            return (
                f"Error: {size} {symbol} = ~${equiv_usd:,.0f} exceeds safety cap ${max_size:,.0f}."
            )

    if confidence is not None and recommended_margin:
        # Compare actual margin vs recommended
        effective_notional = size_usd if size_usd else (size * price if size else 0)
        actual_margin = effective_notional / leverage if leverage else effective_notional
        oversized = actual_margin > recommended_margin * 1.5 if actual_margin else False

        # Warn if undersized (agent manually picked a tiny size)
        if actual_margin and actual_margin < recommended_margin * 0.25:
            _warnings.append(
                f"Warning: Margin ${actual_margin:,.2f} is far below {tier} recommendation "
                f"of ${recommended_margin:,.2f} ({ts.tier_speculative_margin_pct}% of ${portfolio:,.0f}). "
                f"Expected profit may not cover fees. Consider omitting size_usd to auto-size from conviction."
            )
    else:
        effective_notional = size_usd if size_usd else (size * price if size else 0)
        actual_margin = effective_notional / leverage if leverage else effective_notional

    # --- Validate limit order ---
    if order_type == "limit":
        if limit_price is None:
            return "Error: limit_price required for limit orders."

    # --- Validate SL/TP vs side (only if provided) ---
    ref_price = limit_price if order_type == "limit" and limit_price else price

    if stop_loss is not None:
        if is_buy and stop_loss >= ref_price:
            return (
                f"Error: Stop loss ({_fmt_price(stop_loss)}) must be below "
                f"{'limit' if order_type == 'limit' else 'current'} price ({_fmt_price(ref_price)}) for a long."
            )
        if not is_buy and stop_loss <= ref_price:
            return (
                f"Error: Stop loss ({_fmt_price(stop_loss)}) must be above "
                f"{'limit' if order_type == 'limit' else 'current'} price ({_fmt_price(ref_price)}) for a short."
            )

    if take_profit is not None:
        if is_buy and take_profit <= ref_price:
            return (
                f"Error: Take profit ({_fmt_price(take_profit)}) must be above "
                f"{'limit' if order_type == 'limit' else 'current'} price ({_fmt_price(ref_price)}) for a long."
            )
        if not is_buy and take_profit >= ref_price:
            return (
                f"Error: Take profit ({_fmt_price(take_profit)}) must be below "
                f"{'limit' if order_type == 'limit' else 'current'} price ({_fmt_price(ref_price)}) for a short."
            )

    # --- Micro trade SL/TP distance validation ---
    if trade_type == "micro" and ref_price and ref_price > 0:
        micro_sl_min = ts.micro_sl_min_pct / 100
        micro_sl_warn = ts.micro_sl_warn_pct / 100
        micro_sl_max = ts.micro_sl_max_pct / 100
        micro_tp_max = ts.micro_tp_max_pct / 100
        if stop_loss is not None:
            sl_dist = abs(stop_loss - ref_price) / ref_price
            if sl_dist < micro_sl_min:
                suggested_sl = ref_price * (1 - micro_sl_warn) if is_buy else ref_price * (1 + micro_sl_warn)
                return (
                    f"Error: SL distance {sl_dist*100:.2f}% is too tight for a micro trade "
                    f"(minimum {ts.micro_sl_min_pct}%, recommended {ts.micro_sl_warn_pct}%). "
                    f"Try again with SL at {_fmt_price(suggested_sl)} ({ts.micro_sl_warn_pct}% from entry {_fmt_price(ref_price)})."
                )
            if sl_dist < micro_sl_warn:
                _warnings.append(
                    f"Warning: SL distance {sl_dist*100:.2f}% is tighter than {ts.micro_sl_warn_pct}% recommended for micro — high risk of noise stop"
                )
            elif sl_dist > micro_sl_max:
                _warnings.append(f"Note: SL distance {sl_dist*100:.1f}% is wider than {ts.micro_sl_max_pct}% recommended for micro trades")
        if take_profit is not None:
            tp_dist = abs(take_profit - ref_price) / ref_price
            micro_tp_min = ts.micro_tp_min_pct / 100
            if tp_dist < micro_tp_min:
                suggested_tp = ref_price * (1 + ts.micro_tp_min_pct / 100) if is_buy else ref_price * (1 - ts.micro_tp_min_pct / 100)
                fee_roe = round(0.07 * leverage, 1)  # round-trip taker fee as ROE%
                return (
                    f"Error: TP distance {tp_dist*100:.2f}% won't cover round-trip fees "
                    f"(~{fee_roe}% ROE at {leverage}x). Minimum {ts.micro_tp_min_pct}% "
                    f"({ts.micro_tp_min_pct * leverage:.0f}% ROE). "
                    f"Try TP at {_fmt_price(suggested_tp)}."
                )
            if tp_dist > micro_tp_max:
                _warnings.append(f"Note: TP distance {tp_dist*100:.1f}% is wider than {ts.micro_tp_max_pct}% recommended for micro trades")

    # --- SL/TP distances (used by R:R, leverage coherence, portfolio risk) ---
    sl_distance_pct = 0.0
    tp_distance_pct = 0.0
    if ref_price and ref_price > 0:
        if stop_loss is not None:
            sl_distance_pct = abs(stop_loss - ref_price) / ref_price
        if take_profit is not None:
            tp_distance_pct = abs(take_profit - ref_price) / ref_price

    # --- R:R Floor ---
    if stop_loss is not None and take_profit is not None and sl_distance_pct > 0:
        if is_buy:
            risk_dist = ref_price - stop_loss
            reward_dist = take_profit - ref_price
        else:
            risk_dist = stop_loss - ref_price
            reward_dist = ref_price - take_profit
        pre_rr = reward_dist / risk_dist if risk_dist > 0 else 0

        if pre_rr < ts.rr_floor_reject:
            return (
                f"REJECTED: R:R is {pre_rr:.2f}:1 — risking more than the potential gain.\n"
                f"  Risk: {sl_distance_pct*100:.2f}% to SL ({_fmt_price(stop_loss)})\n"
                f"  Reward: {tp_distance_pct*100:.2f}% to TP ({_fmt_price(take_profit)})\n"
                f"Fix: Widen TP or tighten SL. Minimum {ts.rr_floor_warn}:1."
            )
        if pre_rr < ts.rr_floor_warn:
            _warnings.append(
                f"Warning: R:R is {pre_rr:.2f}:1 — thin edge. Standard minimum is {ts.rr_floor_warn}:1."
            )

    # --- Leverage-SL Coherence (macro only) ---
    if trade_type != "micro" and sl_distance_pct > 0 and leverage is not None:
        roe_at_stop = leverage * sl_distance_pct * 100
        suggested_lev = max(ts.macro_leverage_min, min(ts.macro_leverage_max, round(ts.roe_target / (sl_distance_pct * 100))))

        if roe_at_stop > ts.roe_at_stop_reject:
            return (
                f"REJECTED: {leverage}x with {sl_distance_pct*100:.1f}% SL = "
                f"{roe_at_stop:.0f}% ROE at stop — near liquidation.\n"
                f"  Math: {leverage}x × {sl_distance_pct*100:.1f}% = {roe_at_stop:.0f}% of margin lost at SL\n"
                f"  Suggested: {suggested_lev}x → {suggested_lev * sl_distance_pct * 100:.0f}% ROE at stop\n"
                f"Fix: Use {suggested_lev}x, or tighten SL to {_fmt_pct(ts.roe_target / leverage)}."
            )
        if roe_at_stop > ts.roe_at_stop_warn:
            _warnings.append(
                f"Warning: {leverage}x × {sl_distance_pct*100:.1f}% SL = {roe_at_stop:.0f}% ROE at stop. "
                f"Consider {suggested_lev}x ({suggested_lev * sl_distance_pct * 100:.0f}% ROE)."
            )

    # --- Portfolio Risk Cap ---
    if sl_distance_pct > 0 and actual_margin and portfolio and portfolio > 0:
        loss_at_stop = actual_margin * (leverage * sl_distance_pct)
        portfolio_risk_pct = (loss_at_stop / portfolio) * 100

        if portfolio_risk_pct > ts.portfolio_risk_cap_reject:
            return (
                f"REJECTED: This trade risks {portfolio_risk_pct:.1f}% of portfolio at stop.\n"
                f"  Margin: ${actual_margin:,.0f} × {leverage}x × {sl_distance_pct*100:.1f}% SL "
                f"= ${loss_at_stop:,.0f} loss\n"
                f"  Portfolio: ${portfolio:,.0f} → {portfolio_risk_pct:.1f}% at risk\n"
                f"Max: {ts.portfolio_risk_cap_reject:.0f}%. Reduce size or leverage."
            )
        if portfolio_risk_pct > ts.portfolio_risk_cap_warn:
            _warnings.append(
                f"Warning: {portfolio_risk_pct:.1f}% of portfolio at risk at stop "
                f"(${loss_at_stop:,.0f} / ${portfolio:,.0f}). Target: under {ts.portfolio_risk_cap_warn:.0f}%."
            )

    # --- Validation summary span ---
    _record_trade_span(
        "execute_trade", "validation", True,
        f"{side.upper()} {symbol} | {leverage}x | R:R {pre_rr:.1f}:1 | "
        f"Confidence {confidence:.0%} ({tier}) | Portfolio risk {portfolio_risk_pct:.1f}%"
        if confidence is not None and 'pre_rr' in locals() and 'portfolio_risk_pct' in locals()
        else f"{side.upper()} {symbol} | {leverage}x | Confidence {confidence:.0%}" if confidence is not None
        else f"{side.upper()} {symbol} | {leverage}x",
        symbol=symbol, side=side, leverage=leverage,
        confidence=confidence, tier=tier,
        rr_ratio=pre_rr if 'pre_rr' in locals() else None,
        portfolio_risk_pct=portfolio_risk_pct if 'portfolio_risk_pct' in locals() else None,
        oversized=oversized,
        warnings=_warnings if _warnings else None,
    )

    # --- Set leverage if specified ---
    if leverage is not None:
        _lev_start = time.monotonic()
        try:
            provider.update_leverage(symbol, leverage)
        except Exception as e:
            _record_trade_span("execute_trade", "leverage_set", False, f"Failed to set {leverage}x on {symbol}: {e}", duration_ms=int((time.monotonic() - _lev_start) * 1000), symbol=symbol, leverage=leverage, error=str(e))
            return f"Error setting leverage to {leverage}x: {e}"
        _record_trade_span("execute_trade", "leverage_set", True, f"Set {leverage}x on {symbol}", duration_ms=int((time.monotonic() - _lev_start) * 1000), symbol=symbol, leverage=leverage)

    # --- Execute order ---
    if order_type == "limit":
        _order_start = time.monotonic()
        try:
            result = provider.limit_open(
                symbol=symbol,
                is_buy=is_buy,
                limit_px=limit_price,
                size_usd=size_usd,
                sz=size,
            )
        except Exception as e:
            _record_trade_span("execute_trade", "order_fill", False, f"Limit order failed: {e}", duration_ms=int((time.monotonic() - _order_start) * 1000), symbol=symbol, side=side, order_type="limit", error=str(e))
            return f"Error placing limit order: {e}"

        fill_px = limit_price
        fill_sz = result.get("filled_sz", 0)
        is_resting = result["status"] == "resting"
        _record_trade_span(
            "execute_trade", "order_fill", True,
            f"LIMIT {'resting' if is_resting else 'filled'} {side.upper()} {symbol} @ {_fmt_price(limit_price)}",
            duration_ms=int((time.monotonic() - _order_start) * 1000),
            symbol=symbol, side=side, order_type="limit",
            limit_price=limit_price, status=result.get("status"),
            oid=result.get("oid"), filled_sz=result.get("filled_sz", 0),
        )

        if is_resting:
            # Limit order resting — not filled yet
            sz_placed = size if size else round(size_usd / limit_price, 6)
            lines = [
                f"LIMIT ORDER PLACED: {symbol} {side.upper()}",
                f"Price: {_fmt_price(limit_price)}",
                f"Size: {sz_placed:.6g} {symbol}" + (f" (~${size_usd:,.0f})" if size_usd else ""),
                f"Status: Resting (oid: {result.get('oid', '?')})",
            ]

            # SL/TP for limit orders: place after fill (agent should use modify_position
            # once the limit fills, or we place them now for immediate trigger)
            if stop_loss is not None or take_profit is not None:
                lines.append(
                    "Note: SL/TP will activate once this limit order fills. "
                    "Use modify_position after fill to set them, or they'll be placed "
                    "as trigger orders on the current position size."
                )
                # Still place triggers — they'll apply to any existing position of same side
                _place_triggers(provider, symbol, is_buy, sz_placed, stop_loss, take_profit, lines, entry_px=limit_price)

            if leverage is not None:
                lines.append(f"Leverage: {leverage}x")

            # Store in memory — every trade is documented
            if is_buy:
                risk = limit_price - stop_loss
                reward = take_profit - limit_price
            else:
                risk = stop_loss - limit_price
                reward = limit_price - take_profit
            rr_val = round(reward / risk, 2) if risk > 0 else 0

            _store_trade_memory(
                side, symbol, f"LIMIT@{_fmt_price(limit_price)}",
                limit_price, stop_loss, take_profit, confidence,
                size_usd or (sz_placed * limit_price), sz_placed, rr_val, reasoning, lines,
                trade_type=trade_type,
            )

            lines.extend(_warnings)
            return "\n".join(lines)

    else:
        # Market order — retries on 429 (rate limit) up to 3×, 6s apart
        slip = slippage or config.hyperliquid.default_slippage
        _order_start = time.monotonic()
        try:
            if size is not None:
                # Base-asset sizing: convert to USD for market_open
                effective_usd = size * price
                result = _retry_exchange_call(
                    provider.market_open, symbol, is_buy, effective_usd, slip,
                )
            else:
                result = _retry_exchange_call(
                    provider.market_open, symbol, is_buy, size_usd, slip,
                )
        except Exception as e:
            _record_trade_span("execute_trade", "order_fill", False, f"Market order failed: {e}", duration_ms=int((time.monotonic() - _order_start) * 1000), symbol=symbol, side=side, order_type="market", error=str(e))
            return f"Error executing market order: {e}"

    if not isinstance(result, dict):
        _record_trade_span("execute_trade", "order_fill", False, "Unexpected order response", duration_ms=int((time.monotonic() - _order_start) * 1000), symbol=symbol, side=side, order_type="market")
        return f"Unexpected order response. Try again."

    fill_px = result.get("avg_px", price)
    fill_sz = result.get("filled_sz", 0)

    if result.get("status") != "filled" or fill_sz == 0:
        _record_trade_span("execute_trade", "order_fill", False, f"Not filled: {result.get('status', 'unknown')}", duration_ms=int((time.monotonic() - _order_start) * 1000), symbol=symbol, side=side, order_type="market", status=result.get("status"))
        return f"Order not filled. Status: {result.get('status', 'unknown')}. Try again or adjust size."

    # Calculate slippage vs reference price
    _slippage_pct = abs(fill_px - price) / price * 100 if price > 0 else 0
    _record_trade_span(
        "execute_trade", "order_fill", True,
        f"MARKET {side.upper()} {fill_sz:.6g} {symbol} @ {_fmt_price(fill_px)} (slippage: {_slippage_pct:.3f}%)",
        duration_ms=int((time.monotonic() - _order_start) * 1000),
        symbol=symbol, side=side, order_type="market",
        fill_px=fill_px, fill_sz=fill_sz, requested_price=price,
        slippage_pct=round(_slippage_pct, 4), status="filled",
    )

    # Invalidate snapshot + briefing cache so next chat() gets fresh position data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass
    _record_trade_span("execute_trade", "cache_invalidation", True, "Snapshot + briefing cache cleared")

    # --- Build result ---
    effective_usd = size_usd if size_usd else fill_sz * fill_px
    margin_usd = effective_usd / leverage if leverage else effective_usd
    lines = [
        f"EXECUTED: {symbol} {side.upper()}",
        f"Entry: {_fmt_price(fill_px)} (filled {fill_sz:.6g} {symbol})",
        f"Size: ${effective_usd:,.0f} notional | ${margin_usd:,.0f} margin (from account)",
    ]

    if leverage is not None:
        lines.append(f"Leverage: {leverage}x")

    # --- Place SL/TP if requested ---
    _place_triggers(provider, symbol, is_buy, fill_sz, stop_loss, take_profit, lines, entry_px=fill_px)

    # --- Risk/reward if both SL and TP given ---
    if stop_loss is not None and take_profit is not None:
        if is_buy:
            risk = fill_px - stop_loss
            reward = take_profit - fill_px
        else:
            risk = stop_loss - fill_px
            reward = fill_px - take_profit
        rr = reward / risk if risk > 0 else 0
        lines.append(f"Risk/Reward: {rr:.1f}:1")

    # --- Conviction tier ---
    if confidence is not None and tier and recommended_margin:
        pct_of_portfolio = recommended_margin / portfolio * 100 if portfolio else 0
        lines.append(f"Conviction: {confidence:.0%} → {tier} tier → ${recommended_margin:,.0f} margin ({pct_of_portfolio:.0f}% of ${portfolio:,.0f} portfolio)")
    elif confidence is not None:
        lines.append(f"Confidence: {confidence:.0%}")

    # --- Record entry for activity tracking + position type registry ---
    try:
        from ...intelligence.daemon import get_active_daemon
        daemon = get_active_daemon()
        if daemon:
            daemon.record_trade_entry()
            daemon.register_position_type(symbol, trade_type)
            if trade_type == "micro":
                daemon.record_micro_entry()
            _record_trade_span("execute_trade", "daemon_record", True, f"Entry #{daemon.entries_today} recorded, type={trade_type}", trade_type=trade_type)
    except Exception:
        pass

    # --- Store trade in memory (always — every trade is documented) ---
    rr_val = 0
    if stop_loss is not None and take_profit is not None:
        if is_buy:
            risk = fill_px - stop_loss
            reward = take_profit - fill_px
        else:
            risk = stop_loss - fill_px
            reward = fill_px - take_profit
        rr_val = round(reward / risk, 2) if risk > 0 else 0

    _mem_start = time.monotonic()
    _mem_node_id = _store_trade_memory(
        side, symbol, _fmt_price(fill_px), fill_px,
        stop_loss, take_profit, confidence,
        effective_usd, fill_sz, rr_val, reasoning, lines,
        trade_type=trade_type,
    )
    _record_trade_span(
        "execute_trade", "memory_store",
        _mem_node_id is not None,
        f"Node {_mem_node_id} created" if _mem_node_id else "Memory store failed",
        duration_ms=int((time.monotonic() - _mem_start) * 1000),
        node_id=_mem_node_id, subtype="custom:trade_entry",
    )

    lines.extend(_warnings)
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


def _store_to_nous(
    subtype: str,
    title: str,
    content: str,
    summary: str,
    signals: dict | None = None,
    link_to: str | None = None,
    edge_type: str = "part_of",
    event_time: str | None = None,
) -> str | None:
    """Store a trade memory node in Nous with proper structure and linking.

    Creates a node with structured JSON body and optional edge to a related
    node. Uses specific subtypes (trade_entry, trade_close, trade_modify)
    and 'part_of' edges (SSA weight 0.85) to build the trade lifecycle graph.

    Stakes weighting (Issue 4): calculates salience from the signals dict
    and passes a stability override to Nous when the event is non-routine.

    Returns node_id or None.
    """
    from ...nous.client import get_client
    from ...core.memory_tracker import get_tracker

    tracker = get_tracker()

    # Build structured body — always JSON for trade memories
    body_data: dict = {"text": content}
    if signals:
        body_data["signals"] = signals
    body = json.dumps(body_data)

    # Auto-set event_time if not provided (trade events happen NOW)
    if not event_time:
        from datetime import datetime, timezone
        event_time = datetime.now(timezone.utc).isoformat()

    # Stakes weighting: calculate salience-modulated stability
    _neural_stability = None
    try:
        from ...nous.sections import calculate_salience, modulate_stability
        salience = calculate_salience(subtype, signals)
        _neural_stability = modulate_stability(subtype, salience)
        if _neural_stability is not None:
            logger.debug(
                "Stakes weighting: %s salience=%.2f → stability=%.1f days",
                subtype, salience, _neural_stability,
            )
    except Exception as e:
        logger.debug("Stakes weighting skipped: %s", e)

    try:
        client = get_client()
        node = client.create_node(
            type="concept",
            subtype=subtype,
            title=title,
            body=body,
            summary=summary,
            event_time=event_time,
            event_confidence=1.0,
            event_source="inferred",
            neural_stability=_neural_stability,
        )
        node_id = node.get("id")

        # Track mutation
        if node_id:
            tracker.record_create(subtype, title, node_id)

        # Link to related trade node (entry → modify, entry → close)
        if link_to and node_id:
            try:
                client.create_edge(
                    source_id=link_to,
                    target_id=node_id,
                    type=edge_type,
                )
                tracker.record_edge(link_to, node_id, edge_type, "trade lifecycle")
            except Exception as e:
                logger.warning("Failed to create trade edge %s → %s: %s", link_to, node_id, e)
                tracker.record_fail("create_edge", str(e))

        # Auto-assign to clusters (subtype + keyword match, background)
        if node_id:
            from .memory import _auto_assign_clusters
            _auto_assign_clusters(client, node_id, subtype, title=title, content=content)

        return node_id
    except Exception as e:
        logger.error("Failed to store trade memory: %s", e)
        tracker.record_fail("create_node", str(e))
        return None


def _find_trade_entry(symbol: str) -> str | None:
    """Find the most recent trade_entry node for a symbol in Nous.

    Used by close and modify handlers to link back to the original entry,
    building the trade lifecycle graph: entry → modify → close.

    Uses list_nodes (not search) because trade nodes often lack embeddings,
    making semantic search return empty results.
    """
    from ...nous.client import get_client

    try:
        client = get_client()
        # list_nodes returns newest first — find the most recent entry for this symbol
        nodes = client.list_nodes(
            subtype="custom:trade_entry",
            limit=10,
        )
        symbol_upper = symbol.upper()
        for node in nodes:
            title = node.get("content_title", "")
            if symbol_upper in title.upper():
                return node.get("id")
        return None
    except Exception:
        return None


def _store_trade_memory(
    side: str, symbol: str, price_label: str, entry_px: float,
    stop_loss: float, take_profit: float,
    confidence: float | None, size_usd: float, fill_sz: float,
    rr_ratio: float, reasoning: str, lines: list[str],
    trade_type: str = "macro",
) -> str | None:
    """Store trade entry in Nous memory. Returns node_id or None.

    Creates a 'custom:trade_entry' node with:
    - Structured content: thesis + all trade parameters
    - Scannable summary for search results
    - Signals dict for data-level recall
    - FSRS: concept type → 21 day stability (durable — thesis should persist)
    """
    # Structured content — thesis + trade context in one body
    content = (
        f"Thesis: {reasoning}\n"
        f"Entry: {price_label} | Size: {fill_sz:.6g} {symbol} (~{_fmt_big(size_usd)})\n"
        f"Stop Loss: {_fmt_price(stop_loss)} | Take Profit: {_fmt_price(take_profit)}"
    )
    if rr_ratio:
        content += f" | R:R: {rr_ratio}:1"
    if confidence is not None:
        content += f"\nConfidence: {confidence * 100:.0f}%"

    # Scannable summary — one-liner for search previews
    summary = (
        f"{side.upper()} {symbol} @ {price_label} | "
        f"SL {_fmt_price(stop_loss)} | TP {_fmt_price(take_profit)} | "
        f"{_fmt_big(size_usd)}"
    )
    if rr_ratio:
        summary += f" | R:R {rr_ratio}:1"

    # Signals dict — structured data for programmatic access
    signals = {
        "action": "entry",
        "side": side,
        "symbol": symbol,
        "entry": entry_px,
        "stop": stop_loss,
        "target": take_profit,
        "size_usd": round(size_usd, 2),
        "fill_sz": fill_sz,
    }
    if confidence is not None:
        signals["confidence"] = confidence
    if rr_ratio:
        signals["rr_ratio"] = rr_ratio
    signals["trade_type"] = trade_type

    node_id = _store_to_nous(
        subtype="custom:trade_entry",
        title=f"{side.upper()} {symbol} @ {price_label}",
        content=content,
        summary=summary,
        signals=signals,
    )

    if not node_id:
        lines.append("Warning: trade memory store failed — trade executed but not recorded in Nous")
        return None

    lines.append(f"Trade stored in memory (id: {node_id})")

    # Auto-link to active thesis about this symbol (background — doesn't block trade response)
    def _link_theses():
        try:
            from ...nous.client import get_client
            from ...core.memory_tracker import get_tracker
            client = get_client()
            tracker = get_tracker()
            thesis_nodes = client.search(
                query=symbol,
                subtype="custom:thesis",
                lifecycle="ACTIVE",
                limit=3,
            )
            for thesis in thesis_nodes:
                thesis_id = thesis.get("id")
                if thesis_id and thesis_id != node_id:
                    client.create_edge(
                        source_id=node_id,
                        target_id=thesis_id,
                        type="supports",
                        strength=0.8,
                    )
                    tracker.record_edge(node_id, thesis_id, "supports", "auto thesis link")
        except Exception as e:
            logger.debug("Auto-link thesis failed: %s", e)

    threading.Thread(target=_link_theses, daemon=True).start()

    return node_id


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
                "description": (
                    "Override fee-loss pre-flight check. Default false. "
                    "Pass true ONLY when closing for risk management (broken thesis, "
                    "stop management) — not to harvest a tiny green. "
                    "Fee losses are directionally correct exits that still cost money."
                ),
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

    # --- Pre-flight fee check ---
    # If closing would be a fee loss (direction correct but net < 0), block unless force=True
    if not force:
        mark_px = float(position.get("mark_px", 0))
        unrealized_pnl = float(position.get("unrealized_pnl", 0))
        full_size_pre = float(position.get("size", 0))
        entry_px_pre = float(position.get("entry_px", 0))
        if mark_px > 0 and full_size_pre > 0 and entry_px_pre > 0:
            proj_size = full_size_pre * (partial_pct / 100.0)
            proj_gross = unrealized_pnl * (partial_pct / 100.0)
            proj_fees = proj_size * (entry_px_pre + mark_px) * 0.00035
            proj_net = proj_gross - proj_fees
            if proj_gross > 0 and proj_net < 0:
                return (
                    f"⚠ FEE BLOCK — closing {symbol} now would be a fee loss.\n"
                    f"  Projected gross: {_fmt_price(proj_gross)}  |  "
                    f"  Est. fees: ~{_fmt_price(proj_fees)}  |  "
                    f"  Net: {_fmt_price(proj_net)}\n"
                    f"Direction is correct. If you are closing for risk management "
                    f"(thesis broken, stop management), pass force=True. "
                    f"Otherwise, let TP work."
                )

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

    # Invalidate snapshot + briefing cache so next chat() gets fresh position data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass
    _record_trade_span("close_position", "cache_invalidation", True, "Snapshot + briefing cache cleared")

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

    # --- Store outcome in memory (always — every close is documented) ---
    # Find the entry node to link this close back to it (builds trade lifecycle graph)
    _entry_start = time.monotonic()
    entry_node_id = _find_trade_entry(symbol)
    _record_trade_span(
        "close_position", "entry_lookup",
        entry_node_id is not None,
        f"Found entry node {entry_node_id}" if entry_node_id else f"No entry node found for {symbol}",
        duration_ms=int((time.monotonic() - _entry_start) * 1000),
        symbol=symbol, entry_node_id=entry_node_id,
    )

    # Resolve opened_at: position field → daemon registry → entry node timestamp
    opened_at = position.get("opened_at", "")
    if not opened_at:
        # Hyperliquid live doesn't provide opened_at — get from daemon's position type registry
        try:
            from ...intelligence.daemon import get_active_daemon
            daemon = get_active_daemon()
            if daemon:
                type_info = daemon.get_position_type(symbol)
                entry_time = type_info.get("entry_time", 0)
                if entry_time > 0:
                    from datetime import datetime as _dt, timezone as _tz
                    opened_at = _dt.fromtimestamp(entry_time, tz=_tz.utc).isoformat()
        except Exception:
            pass
    if not opened_at and entry_node_id:
        try:
            from ...nous.client import get_client
            entry_node = get_client().get_node(entry_node_id)
            if entry_node:
                opened_at = entry_node.get("created_at", "")
        except Exception:
            pass

    pnl_sign = "+" if realized_pnl_net >= 0 else ""
    action_label = "Partial close" if partial_pct < 100 else "Closed"
    action_label_upper = "PARTIAL CLOSE" if partial_pct < 100 else "CLOSED"
    outcome_content = (
        f"{action_label} {close_label} {position['side']} {symbol}.\n"
        f"Entry: {_fmt_price(entry_px)} → Exit: {_fmt_price(exit_px)}\n"
        f"PnL: {pnl_sign}{_fmt_price(realized_pnl_net)} ({lev_return:+.1f}% on margin, {_fmt_pct(pnl_pct)} price)\n"
        f"Reason: {reasoning}"
    )

    outcome_summary = (
        f"{action_label_upper} {position['side'].upper()} {symbol} | "
        f"{_fmt_price(entry_px)} → {_fmt_price(exit_px)} | "
        f"PnL {pnl_sign}{_fmt_price(realized_pnl_net)} ({lev_return:+.1f}%)"
    )

    # Detect fee-loss: directionally correct but fees ate the profit
    is_fee_loss  = realized_pnl > 0 and realized_pnl_net < 0
    is_fee_heavy = (not is_fee_loss) and realized_pnl > 0 and fee_estimate > realized_pnl * 0.5

    # Get peak ROE (MFE) and trade_type from daemon before position cleanup
    mfe_pct = 0.0
    close_trade_type = "macro"
    try:
        from ...intelligence.daemon import get_active_daemon
        daemon = get_active_daemon()
        if daemon:
            mfe_pct = daemon.get_peak_roe(symbol)
            close_trade_type = daemon.get_position_type(symbol).get("type", "macro")
    except Exception:
        pass

    _mem_start = time.monotonic()
    close_node_id = _store_to_nous(
        subtype="custom:trade_close",
        title=f"{action_label_upper} {position['side'].upper()} {symbol} @ {_fmt_price(exit_px)}",
        content=outcome_content,
        summary=outcome_summary,
        signals={
            "action": "partial_close" if partial_pct < 100 else "close",
            "side": position["side"],
            "symbol": symbol,
            "entry": entry_px,
            "exit": exit_px,
            "pnl_usd": round(realized_pnl_net, 2),
            "pnl_pct": round(pnl_pct, 2),
            "lev_return_pct": round(lev_return, 2),
            "close_type": close_label,
            "size_usd": round(closed_sz * exit_px, 2),
            "opened_at": opened_at,
            "mfe_pct": round(mfe_pct, 2),
            "trade_type": close_trade_type,
            "fee_loss":    is_fee_loss,
            "fee_heavy":   is_fee_heavy,
            "pnl_gross":   round(realized_pnl, 2),
            "fee_estimate": round(fee_estimate, 2),
            "margin_used": round(margin_used, 2),
            "leverage":    int(position.get("leverage", 0)),
            "mfe_usd":     round(mfe_pct / 100 * margin_used, 2) if margin_used > 0 else 0.0,
        },
        link_to=entry_node_id,  # Edge: entry --part_of--> close (SSA 0.85)
        edge_type="part_of",
    )

    # Hebbian: strengthen the trade lifecycle edge (MF-1)
    if close_node_id and entry_node_id:
        _strengthen_trade_edge(entry_node_id, close_node_id)
        # Issue 5: update playbook metrics if this trade followed a playbook
        _update_playbook_metrics(entry_node_id, pnl_pct > 0)

    _record_trade_span(
        "close_position", "memory_store",
        close_node_id is not None,
        f"Node {close_node_id} created, linked to entry {entry_node_id}" if close_node_id and entry_node_id
        else f"Node {close_node_id} created (no entry link)" if close_node_id
        else "Memory store failed",
        duration_ms=int((time.monotonic() - _mem_start) * 1000),
        node_id=close_node_id, entry_node_id=entry_node_id,
        subtype="custom:trade_close", edge_strengthened=bool(close_node_id and entry_node_id),
    )

    lines_append_id = None
    if close_node_id:
        msg = f"Outcome stored in memory (id: {close_node_id})"
        if entry_node_id:
            msg += f" [linked to entry {entry_node_id}]"
        lines_append_id = msg

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
    if lines_append_id:
        lines.append(lines_append_id)

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

    changes = []

    # --- Fetch existing trigger orders ONCE for selective cancellation ---
    existing_triggers = []
    try:
        existing_triggers = provider.get_trigger_orders(symbol)
    except Exception as e:
        logger.warning("Failed to fetch trigger orders: %s", e)

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

    # Invalidate snapshot + briefing cache so next chat() gets fresh data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass
    _record_trade_span("modify_position", "cache_invalidation", True, "Snapshot + briefing cache cleared")

    # --- Store modification in memory (always — every adjustment is documented) ---
    # Find the entry node to link this modification back to it
    _entry_start = time.monotonic()
    entry_node_id = _find_trade_entry(symbol)
    _record_trade_span(
        "modify_position", "entry_lookup",
        entry_node_id is not None,
        f"Found entry node {entry_node_id}" if entry_node_id else f"No entry node found for {symbol}",
        duration_ms=int((time.monotonic() - _entry_start) * 1000),
        symbol=symbol, entry_node_id=entry_node_id,
    )

    mod_details = "; ".join(changes) if changes else "no changes applied"
    mod_content = (
        f"Modified {position['side']} {symbol} position.\n"
        f"Changes: {mod_details}\n"
        f"Mark price: {_fmt_price(mark_px)} | Size: {sz:.6g} {symbol}\n"
        f"Reason: {reasoning}"
    )

    mod_summary = f"MODIFIED {position['side'].upper()} {symbol} | {mod_details}"

    # Get trade_type from daemon's position type registry
    mod_trade_type = "macro"
    try:
        from ...intelligence.daemon import get_active_daemon
        daemon = get_active_daemon()
        if daemon:
            mod_trade_type = daemon.get_position_type(symbol).get("type", "macro")
    except Exception:
        pass

    mod_signals: dict = {
        "action": "modify",
        "side": position["side"],
        "symbol": symbol,
        "mark_px": mark_px,
        "size": sz,
        "trade_type": mod_trade_type,
    }
    if stop_loss is not None:
        mod_signals["new_stop"] = stop_loss
    if take_profit is not None:
        mod_signals["new_target"] = take_profit
    if leverage is not None:
        mod_signals["new_leverage"] = leverage

    _mem_start = time.monotonic()
    mem_id = _store_to_nous(
        subtype="custom:trade_modify",
        title=f"MODIFIED {position['side'].upper()} {symbol}",
        content=mod_content,
        summary=mod_summary,
        signals=mod_signals,
        link_to=entry_node_id,  # Edge: entry --part_of--> modify (SSA 0.85)
        edge_type="part_of",
    )

    _record_trade_span(
        "modify_position", "memory_store",
        mem_id is not None,
        f"Node {mem_id} created, linked to entry {entry_node_id}" if mem_id and entry_node_id
        else f"Node {mem_id} created (no entry link)" if mem_id
        else "Memory store failed",
        duration_ms=int((time.monotonic() - _mem_start) * 1000),
        node_id=mem_id, entry_node_id=entry_node_id,
        subtype="custom:trade_modify",
    )

    # --- Build result ---
    lines = [
        f"MODIFIED: {symbol} {position['side'].upper()}",
        f"Mark: {_fmt_price(mark_px)} | Size: {sz:.6g} {symbol}",
    ]
    lines.extend(f"  {c}" for c in changes)
    lines.append(f"Reason: {reasoning}")
    if mem_id:
        msg = f"Modification stored in memory (id: {mem_id})"
        if entry_node_id:
            msg += f" [linked to entry {entry_node_id}]"
        lines.append(msg)

    return "\n".join(lines)


# =============================================================================
# 5. HEBBIAN EDGE STRENGTHENING
# =============================================================================

def _strengthen_trade_edge(entry_node_id: str, close_node_id: str) -> None:
    """Hebbian: strengthen the part_of edge between trade entry and close nodes.

    The close event confirms the trade lifecycle connection is real and important.
    Runs in background thread to avoid blocking the tool response.
    """
    def _do_strengthen():
        try:
            from ...nous.client import get_client
            client = get_client()
            edges = client.get_edges(entry_node_id, direction="out")
            for edge in edges:
                if edge.get("target_id") == close_node_id:
                    eid = edge.get("id")
                    if eid:
                        client.strengthen_edge(eid, amount=0.1)
                        logger.info(
                            "Hebbian: strengthened trade lifecycle edge %s (entry→close)",
                            eid,
                        )
                    break
        except Exception as e:
            logger.debug("Trade edge strengthening failed: %s", e)

    threading.Thread(target=_do_strengthen, daemon=True).start()


def _update_playbook_metrics(entry_node_id: str, was_profitable: bool) -> None:
    """Update playbook success metrics after a trade close.

    Checks if the trade entry has incoming `applied_to` edges from
    playbook nodes (created by daemon._link_playbooks_to_trade when
    the agent trades following a playbook match). For each linked
    playbook, increments sample_size and optionally success_count.

    Runs in background thread to avoid blocking the tool response.
    """
    def _do_update():
        try:
            from ...nous.client import get_client
            client = get_client()
            edges = client.get_edges(entry_node_id, direction="in")
            for edge in edges:
                # Edge route returns raw DB rows: field is "type" not "edge_type"
                if edge.get("type") != "applied_to":
                    continue
                pb_id = edge.get("source_id")
                if not pb_id:
                    continue
                pb_node = client.get_node(pb_id)
                # Node route returns raw DB rows: field is "subtype" not "content_subtype"
                if not pb_node or pb_node.get("subtype") != "custom:playbook":
                    continue

                # Parse body and update metrics
                body = pb_node.get("content_body", "")
                try:
                    data = json.loads(body)
                except (json.JSONDecodeError, TypeError):
                    continue

                data["sample_size"] = data.get("sample_size", 0) + 1
                if was_profitable:
                    data["success_count"] = data.get("success_count", 0) + 1

                from datetime import datetime, timezone
                data["last_applied"] = datetime.now(timezone.utc).isoformat()

                client.update_node(pb_id, content_body=json.dumps(data))

                # Hebbian: strengthen the applied_to edge on profitable trade
                edge_id = edge.get("id")
                if edge_id and was_profitable:
                    client.strengthen_edge(edge_id, amount=0.10)

                logger.info(
                    "Playbook %s metrics updated: %d/%d (profitable: %s)",
                    pb_id, data.get("success_count", 0),
                    data["sample_size"], was_profitable,
                )
        except Exception as e:
            logger.debug("Playbook metrics update failed: %s", e)

    threading.Thread(target=_do_update, daemon=True, name="hynous-pb-metrics").start()


# =============================================================================
# 6. REGISTRATION
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
        name=TRADE_TOOL_DEF["name"],
        description=TRADE_TOOL_DEF["description"],
        parameters=TRADE_TOOL_DEF["parameters"],
        handler=handle_execute_trade,
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
