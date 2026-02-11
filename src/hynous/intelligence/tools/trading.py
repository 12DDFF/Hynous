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
from typing import Optional

logger = logging.getLogger(__name__)


# =============================================================================
# Helpers
# =============================================================================

def _get_trading_provider():
    """Get the Hyperliquid provider with trading capabilities."""
    from ...data.providers.hyperliquid import get_provider
    from ...core.config import load_config
    config = load_config()
    provider = get_provider(config=config)
    return provider, config


def _check_trading_allowed(is_new_entry: bool = True) -> str | None:
    """Check if trading is currently allowed by the daemon's guardrails.

    Returns an error message string if blocked, or None if trading is allowed.

    Args:
        is_new_entry: True for new trades. False for closes/modifies (always allowed).
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
        "Position sizing (provide one):\n"
        "- size_usd: NOTIONAL size in USD. Margin from account = size_usd / leverage.\n"
        "  E.g. size_usd=500 at 20x → $25 margin from account, $500 notional exposure.\n"
        "- size: Size in base asset (e.g. 0.03 BTC)\n\n"
        "Risk management (ALL required):\n"
        "- leverage: REQUIRED, minimum 20x\n"
        "- stop_loss: Where my thesis is wrong — auto-placed as trigger order\n"
        "- take_profit: Where I take profit — auto-placed as trigger order\n"
        "- reasoning: My full thesis for this trade — stored in memory\n"
        "- confidence: REQUIRED conviction score (0.0-1.0) — determines size tier\n\n"
        "Optional:\n"
        "- slippage: Max slippage for market orders (default from config)\n\n"
        "Examples:\n"
        '  High conviction:\n'
        '    {"symbol": "BTC", "side": "long", "size_usd": 300, "leverage": 20, "stop_loss": 66000, '
        '"take_profit": 72000, "confidence": 0.85, '
        '"reasoning": "Funding reset, shorts crowding, support held with strong bid wall. R:R ~3:1."}\n'
        '  Medium conviction:\n'
        '    {"symbol": "ETH", "side": "short", "size_usd": 200, "leverage": 20, "stop_loss": 3900, '
        '"take_profit": 3400, "confidence": 0.65, '
        '"reasoning": "Bearish divergence on 4h, OI rising but price flat..."}\n'
        '  Speculative:\n'
        '    {"symbol": "SOL", "side": "long", "size_usd": 100, "order_type": "limit", '
        '"limit_price": 140, "stop_loss": 130, "take_profit": 165, "confidence": 0.5, '
        '"reasoning": "Key support zone, interesting divergence but uncertain..."}'
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
            "size_usd": {
                "type": "number",
                "description": "Notional position size in USD. Margin deducted from account = size_usd / leverage. "
                               "E.g. size_usd=500 at 20x = $25 margin from account.",
                "minimum": 10,
            },
            "size": {
                "type": "number",
                "description": "Position size in base asset (e.g. 0.03 BTC). Use instead of size_usd.",
                "exclusiveMinimum": 0,
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
                "description": "Leverage for this trade. REQUIRED — minimum 20x.",
                "minimum": 20,
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
                "description": "Conviction score (0.0-1.0). REQUIRED — determines position size tier. "
                               "0.8+ = full base, 0.6-0.79 = half, 0.4-0.59 = quarter, <0.4 = rejected.",
                "minimum": 0,
                "maximum": 1,
            },
            "reasoning": {
                "type": "string",
                "description": "Full trade thesis — why entering, what signals support it. Always stored in memory.",
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
) -> str:
    """Handle the execute_trade tool call."""
    # Check circuit breaker and position limits BEFORE anything else
    blocked = _check_trading_allowed(is_new_entry=True)
    if blocked:
        return blocked

    provider, config = _get_trading_provider()

    if not provider.can_trade:
        return "Trading not available — no private key configured."

    symbol = symbol.upper()
    is_buy = side == "long"

    # --- Validate leverage (mandatory, minimum 20x) ---
    if leverage is None or leverage < 20:
        return "Error: leverage is required and must be at least 20x."

    # --- Validate sizing ---
    if size_usd is None and size is None:
        return "Error: Provide either size_usd (USD amount) or size (base asset amount)."

    # --- Safety cap ---
    max_size = config.hyperliquid.max_position_usd
    if size_usd and size_usd > max_size:
        return (
            f"Error: ${size_usd:,.0f} exceeds safety cap of ${max_size:,.0f}. "
            f"Reduce size or adjust max_position_usd in config."
        )

    # --- Get current price ---
    try:
        price = provider.get_price(symbol)
        if not price:
            return f"Error: Could not get price for {symbol}. Check symbol name."
    except Exception as e:
        return f"Error getting price: {e}"

    # Check USD-equivalent when sizing by base asset
    if size is not None and size_usd is None:
        equiv_usd = size * price
        if equiv_usd > max_size:
            return (
                f"Error: {size} {symbol} = ~${equiv_usd:,.0f} exceeds safety cap ${max_size:,.0f}."
            )

    # --- Conviction-based size validation ---
    # Sizing is in MARGIN (money from account), not notional.
    # 15% base = 15% of portfolio at risk. Leverage amplifies exposure.
    tier = None
    recommended_margin = None
    oversized = False
    if confidence is not None:
        if confidence < 0.4:
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
            recommended_margin = portfolio * 0.30
            tier = "High"
        elif confidence >= 0.6:
            recommended_margin = portfolio * 0.20
            tier = "Medium"
        else:
            recommended_margin = portfolio * 0.10
            tier = "Speculative"

        # Compare actual margin vs recommended
        effective_notional = size_usd if size_usd else (size * price if size else 0)
        actual_margin = effective_notional / leverage if leverage else effective_notional
        oversized = actual_margin > recommended_margin * 1.5 if actual_margin else False

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

    # --- Set leverage if specified ---
    if leverage is not None:
        try:
            provider.update_leverage(symbol, leverage)
        except Exception as e:
            return f"Error setting leverage to {leverage}x: {e}"

    # --- Execute order ---
    if order_type == "limit":
        try:
            result = provider.limit_open(
                symbol=symbol,
                is_buy=is_buy,
                limit_px=limit_price,
                size_usd=size_usd,
                sz=size,
            )
        except Exception as e:
            return f"Error placing limit order: {e}"

        fill_px = limit_price
        fill_sz = result.get("filled_sz", 0)
        is_resting = result["status"] == "resting"

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
                _place_triggers(provider, symbol, is_buy, sz_placed, stop_loss, take_profit, lines)

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
            )

            return "\n".join(lines)

    else:
        # Market order
        slip = slippage or config.hyperliquid.default_slippage
        try:
            if size is not None:
                # Base-asset sizing: convert to USD for market_open
                effective_usd = size * price
                result = provider.market_open(symbol, is_buy, effective_usd, slip)
            else:
                result = provider.market_open(symbol, is_buy, size_usd, slip)
        except Exception as e:
            return f"Error executing market order: {e}"

    if not isinstance(result, dict):
        return f"Unexpected order response. Try again."

    fill_px = result.get("avg_px", price)
    fill_sz = result.get("filled_sz", 0)

    if result.get("status") != "filled" or fill_sz == 0:
        return f"Order not filled. Status: {result.get('status', 'unknown')}. Try again or adjust size."

    # Invalidate snapshot + briefing cache so next chat() gets fresh position data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass

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
    _place_triggers(provider, symbol, is_buy, fill_sz, stop_loss, take_profit, lines)

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
        lines.append(f"Confidence: {confidence:.0%} ({tier} — up to {pct_of_portfolio:.0f}% of account)")
        if oversized:
            lines.append(f"Warning: Margin ${actual_margin:,.0f} exceeds recommended ${recommended_margin:,.0f}")
    elif confidence is not None:
        lines.append(f"Confidence: {confidence:.0%}")

    # --- Record entry for activity tracking ---
    try:
        from ...intelligence.daemon import get_active_daemon
        daemon = get_active_daemon()
        if daemon:
            daemon.record_trade_entry()
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

    _store_trade_memory(
        side, symbol, _fmt_price(fill_px), fill_px,
        stop_loss, take_profit, confidence,
        effective_usd, fill_sz, rr_val, reasoning, lines,
    )

    return "\n".join(lines)


def _place_triggers(
    provider, symbol: str, is_buy: bool, sz: float,
    stop_loss: float | None, take_profit: float | None,
    lines: list[str],
) -> None:
    """Place stop loss and/or take profit trigger orders. Appends status to lines."""
    if stop_loss is not None:
        try:
            provider.place_trigger_order(
                symbol=symbol,
                is_buy=not is_buy,
                sz=sz,
                trigger_px=stop_loss,
                tpsl="sl",
            )
            sl_dist = abs((stop_loss - provider.get_price(symbol)) / provider.get_price(symbol) * 100)
            lines.append(f"Stop Loss: {_fmt_price(stop_loss)} ({sl_dist:.1f}% away) [set]")
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
            tp_dist = abs((take_profit - provider.get_price(symbol)) / provider.get_price(symbol) * 100)
            lines.append(f"Take Profit: {_fmt_price(take_profit)} ({tp_dist:.1f}% away) [set]")
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
) -> str | None:
    """Store a trade memory node in Nous with proper structure and linking.

    Creates a node with structured JSON body and optional edge to a related
    node. Uses specific subtypes (trade_entry, trade_close, trade_modify)
    and 'part_of' edges (SSA weight 0.85) to build the trade lifecycle graph.

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

    try:
        client = get_client()
        node = client.create_node(
            type="concept",
            subtype=subtype,
            title=title,
            body=body,
            summary=summary,
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
    """
    from ...nous.client import get_client

    try:
        client = get_client()
        results = client.search(
            query=symbol,
            subtype="custom:trade_entry",
            limit=5,
        )
        # Return the most relevant match for this symbol
        symbol_upper = symbol.upper()
        for node in results:
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

    # Auto-link to active thesis about this symbol
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
                lines.append(f"Linked to thesis: {thesis.get('content_title', 'unknown')}")
    except Exception as e:
        logger.debug("Auto-link thesis failed: %s", e)

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
) -> str:
    """Handle the close_position tool call."""
    provider, config = _get_trading_provider()

    if not provider.can_trade:
        return "Trading not available — no private key configured."

    symbol = symbol.upper()

    # --- Get current position ---
    try:
        state = provider.get_user_state()
    except Exception as e:
        return f"Error fetching account state: {e}"

    position = None
    for p in state["positions"]:
        if p["coin"] == symbol:
            position = p
            break

    if not position:
        return f"No open position for {symbol}."

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
        # Market close
        slip = config.hyperliquid.default_slippage
        try:
            result = provider.market_close(symbol, size=close_size, slippage=slip)
        except Exception as e:
            return f"Error closing position: {e}"

        if not isinstance(result, dict):
            return "Unexpected close response. Try again."
        exit_px = result.get("avg_px", 0)
        closed_sz = result.get("filled_sz", close_size or full_size)

    # Invalidate snapshot + briefing cache so next chat() gets fresh position data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass

    # --- Calculate realized PnL ---
    entry_px = position.get("entry_px", 0)
    if is_long:
        pnl_per_unit = exit_px - entry_px
    else:
        pnl_per_unit = entry_px - exit_px
    realized_pnl = pnl_per_unit * closed_sz
    # Fee estimate (taker 0.035% per side)
    fee_estimate = closed_sz * exit_px * 0.00035
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

    # --- Cancel associated orders on full close ---
    cancelled = 0
    if partial_pct >= 100:
        try:
            # Cancel trigger orders (SL/TP) — cancel_all_orders only handles limits
            triggers = provider.get_trigger_orders(symbol)
            for t in triggers:
                if t.get("oid"):
                    provider.cancel_order(symbol, t["oid"])
                    cancelled += 1
            # Cancel resting limit orders
            cancelled += provider.cancel_all_orders(symbol)
        except Exception as e:
            logger.error("Failed to cancel orders for %s: %s", symbol, e)

    # --- Store outcome in memory (always — every close is documented) ---
    # Find the entry node to link this close back to it (builds trade lifecycle graph)
    entry_node_id = _find_trade_entry(symbol)

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
        },
        link_to=entry_node_id,  # Edge: entry --part_of--> close (SSA 0.85)
        edge_type="part_of",
    )

    # Hebbian: strengthen the trade lifecycle edge (MF-1)
    if close_node_id and entry_node_id:
        _strengthen_trade_edge(entry_node_id, close_node_id)

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
    try:
        state = provider.get_user_state()
    except Exception as e:
        return f"Error fetching account state: {e}"

    position = None
    for p in state["positions"]:
        if p["coin"] == symbol:
            position = p
            break

    if not position:
        return f"No open position for {symbol}."

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

    # Invalidate snapshot + briefing cache so next chat() gets fresh data
    try:
        from ..context_snapshot import invalidate_snapshot
        from ..briefing import invalidate_briefing_cache
        invalidate_snapshot()
        invalidate_briefing_cache()
    except Exception:
        pass

    # --- Store modification in memory (always — every adjustment is documented) ---
    # Find the entry node to link this modification back to it
    entry_node_id = _find_trade_entry(symbol)

    mod_details = "; ".join(changes) if changes else "no changes applied"
    mod_content = (
        f"Modified {position['side']} {symbol} position.\n"
        f"Changes: {mod_details}\n"
        f"Mark price: {_fmt_price(mark_px)} | Size: {sz:.6g} {symbol}\n"
        f"Reason: {reasoning}"
    )

    mod_summary = f"MODIFIED {position['side'].upper()} {symbol} | {mod_details}"

    mod_signals: dict = {
        "action": "modify",
        "side": position["side"],
        "symbol": symbol,
        "mark_px": mark_px,
        "size": sz,
    }
    if stop_loss is not None:
        mod_signals["new_stop"] = stop_loss
    if take_profit is not None:
        mod_signals["new_target"] = take_profit
    if leverage is not None:
        mod_signals["new_leverage"] = leverage

    mem_id = _store_to_nous(
        subtype="custom:trade_modify",
        title=f"MODIFIED {position['side'].upper()} {symbol}",
        content=mod_content,
        summary=mod_summary,
        signals=mod_signals,
        link_to=entry_node_id,  # Edge: entry --part_of--> modify (SSA 0.85)
        edge_type="part_of",
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
