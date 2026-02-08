"""
Orderbook Tool

L2 orderbook depth analysis for the Hynous agent.
Answers questions like "is $60k real support or paper thin?"

Provides:
  - Spread (absolute + percentage)
  - Depth on each side (USD value in top N levels)
  - Bid/ask walls (largest single level)
  - Imbalance (bid depth vs ask depth ratio)
  - Thin/thick assessment

Standard tool module pattern:
  1. TOOL_DEF — Anthropic JSON schema
  2. handler  — processes the tool call
  3. register — wires into the registry
"""

import logging

from .registry import Tool

logger = logging.getLogger(__name__)


# =============================================================================
# 1. TOOL DEFINITION — Anthropic JSON Schema
# =============================================================================

TOOL_DEF = {
    "name": "get_orderbook",
    "description": (
        "Get L2 orderbook depth for a symbol on Hyperliquid.\n"
        "Shows bid/ask spread, depth on each side, largest walls, and imbalance.\n"
        "Useful for gauging support/resistance strength and market microstructure.\n\n"
        "Examples:\n"
        '  {"symbol": "BTC"} → full orderbook analysis\n'
        '  {"symbol": "ETH", "levels": 5} → top 5 levels only'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": 'Trading symbol (e.g., "BTC", "ETH", "SOL")',
            },
            "levels": {
                "type": "integer",
                "description": "Number of price levels to analyze per side (default: 10, max: 20)",
            },
        },
        "required": ["symbol"],
    },
}


# =============================================================================
# 2. HANDLER — processes the tool call
# =============================================================================

def handle_get_orderbook(symbol: str, levels: int = 10) -> str:
    """Handle the get_orderbook tool call.

    Returns compact text summarizing orderbook depth.
    """
    from ...data.providers.hyperliquid import get_provider

    symbol = symbol.upper()
    levels = max(1, min(levels, 20))

    provider = get_provider()

    # Get current price for USD calculations
    price = provider.get_price(symbol)
    if price is None:
        return f"{symbol}: Not found on Hyperliquid. Check the symbol name."

    book = provider.get_l2_book(symbol)
    if book is None:
        return f"{symbol}: Could not fetch orderbook data."

    bids = book["bids"][:levels]
    asks = book["asks"][:levels]

    if not bids or not asks:
        return f"{symbol}: Orderbook is empty or unavailable."

    # --- Spread ---
    best_bid = book["best_bid"]
    best_ask = book["best_ask"]
    spread = best_ask - best_bid
    spread_pct = (spread / book["mid_price"]) * 100 if book["mid_price"] > 0 else 0

    # --- Depth in USD (price * size for each level) ---
    bid_depth_usd = sum(lv["price"] * lv["size"] for lv in bids)
    ask_depth_usd = sum(lv["price"] * lv["size"] for lv in asks)
    total_depth = bid_depth_usd + ask_depth_usd

    # --- Imbalance ---
    if total_depth > 0:
        bid_pct = (bid_depth_usd / total_depth) * 100
        ask_pct = (ask_depth_usd / total_depth) * 100
        if bid_pct > 60:
            imbalance = f"Bid-heavy ({bid_pct:.0f}% bids)"
        elif ask_pct > 60:
            imbalance = f"Ask-heavy ({ask_pct:.0f}% asks)"
        else:
            imbalance = f"Balanced ({bid_pct:.0f}/{ask_pct:.0f})"
    else:
        imbalance = "No depth"

    # --- Walls (largest single level by USD notional) ---
    bid_wall = max(bids, key=lambda lv: lv["price"] * lv["size"])
    ask_wall = max(asks, key=lambda lv: lv["price"] * lv["size"])
    bid_wall_usd = bid_wall["price"] * bid_wall["size"]
    ask_wall_usd = ask_wall["price"] * ask_wall["size"]

    # --- Thickness assessment ---
    # Compare depth to daily volume for context
    ctx = provider.get_asset_context(symbol)
    if ctx and ctx["day_volume"] > 0:
        depth_ratio = total_depth / ctx["day_volume"]
        if depth_ratio > 0.01:
            thickness = "Thick (deep liquidity)"
        elif depth_ratio > 0.003:
            thickness = "Normal"
        else:
            thickness = "Thin (low liquidity)"
    else:
        thickness = "Unknown (no volume reference)"

    lines = [
        f"{symbol} Orderbook ({levels} levels/side):",
        f"  Spread: {_fmt_price(spread)} ({spread_pct:.3f}%)",
        f"  Bid depth: {_fmt_big(bid_depth_usd)} | Ask depth: {_fmt_big(ask_depth_usd)}",
        f"  Imbalance: {imbalance}",
        f"  Bid wall: {_fmt_big(bid_wall_usd)} @ {_fmt_price(bid_wall['price'])} ({bid_wall['orders']} orders)",
        f"  Ask wall: {_fmt_big(ask_wall_usd)} @ {_fmt_price(ask_wall['price'])} ({ask_wall['orders']} orders)",
        f"  Liquidity: {thickness}",
    ]

    return "\n".join(lines)


# =============================================================================
# 3. REGISTER — wires into the registry
# =============================================================================

def register(registry) -> None:
    """Register orderbook tool with the registry."""
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_get_orderbook,
    ))


# =============================================================================
# INTERNAL — formatting helpers (duplicated from market.py to keep self-contained)
# =============================================================================

def _fmt_price(price: float) -> str:
    """Format a price for compact display."""
    if price >= 1000:
        return f"${price:,.0f}"
    elif price >= 1:
        return f"${price:,.2f}"
    elif price >= 0.01:
        return f"${price:.4f}"
    else:
        return f"${price:.6f}"


def _fmt_big(n: float) -> str:
    """Format large numbers compactly."""
    if n >= 1_000_000_000:
        return f"${n / 1_000_000_000:.1f}B"
    elif n >= 1_000_000:
        return f"${n / 1_000_000:.1f}M"
    elif n >= 1_000:
        return f"${n / 1_000:.1f}K"
    else:
        return f"${n:.0f}"
