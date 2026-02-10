"""
Liquidation Intelligence Tool

Cross-exchange liquidation data from Coinglass.
Answers questions like "how much got liquidated?" and "which exchanges saw the most pain?"

Flexible via two modes:
  overview (default): Aggregate liquidation stats across coins.
    Shows total/long/short liquidation USD at 1h/4h/12h/24h for top coins.
    Agent uses this to gauge market-wide liquidation pressure.

  by_exchange: Per-exchange liquidation breakdown for a single coin.
    Shows which exchanges had the most liquidations and the long/short split.
    Agent uses this to see where the pain is concentrated.

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
    "name": "get_liquidations",
    "description": (
        "Get cross-exchange liquidation data from Coinglass.\n"
        "Shows how much was liquidated (longs vs shorts) across exchanges.\n\n"
        "Two flexible modes:\n"
        "- overview: Aggregate liquidations across top coins (1h/4h/12h/24h).\n"
        "  Good for: 'How much got liquidated market-wide?'\n"
        "- by_exchange: Per-exchange breakdown for one coin.\n"
        "  Good for: 'Where are BTC liquidations concentrated?'\n\n"
        "Examples:\n"
        '  {"view": "overview"} → top coins by 24h liquidation volume\n'
        '  {"view": "overview", "symbols": ["BTC", "ETH", "SOL"]} → compare specific coins\n'
        '  {"view": "by_exchange", "symbol": "BTC"} → BTC liquidations per exchange (24h)\n'
        '  {"view": "by_exchange", "symbol": "ETH", "range": "4h"} → ETH per exchange, last 4h'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "view": {
                "type": "string",
                "enum": ["overview", "by_exchange"],
                "description": "Query mode: 'overview' for multi-coin summary, 'by_exchange' for single-coin exchange breakdown. Default: overview.",
            },
            "symbol": {
                "type": "string",
                "description": 'Coin symbol for by_exchange view (e.g., "BTC", "ETH"). Also used to filter overview to one coin.',
            },
            "symbols": {
                "type": "array",
                "items": {"type": "string"},
                "description": 'Filter overview to specific coins (e.g., ["BTC", "ETH", "SOL"]). Omit for top coins by volume.',
            },
            "range": {
                "type": "string",
                "enum": ["1h", "4h", "12h", "24h"],
                "description": "Time range for by_exchange view. Default: 24h.",
            },
        },
    },
}


# =============================================================================
# 2. HANDLER — processes the tool call
# =============================================================================

def handle_get_liquidations(
    view: str = "overview",
    symbol: str | None = None,
    symbols: list[str] | None = None,
    time_range: str = "24h",
    **kwargs,
) -> str:
    """Handle the get_liquidations tool call."""
    from ...data.providers.coinglass import get_provider

    # Accept both "range" (from TOOL_DEF) and "time_range" (Python-safe)
    time_range = kwargs.get("range", time_range)

    provider = get_provider()

    if view == "by_exchange":
        return _by_exchange(provider, symbol or "BTC", time_range)
    else:
        return _overview(provider, symbols, symbol)


def _overview(provider, symbols: list[str] | None, single_symbol: str | None) -> str:
    """Multi-coin liquidation overview."""
    try:
        all_coins = provider.get_liquidation_coins()
    except Exception as e:
        logger.error(f"Liquidation coin-list error: {e}")
        return f"Error fetching liquidation data: {e}"

    if not all_coins:
        return "No liquidation data available."

    # Filter to requested symbols or take top 10 by 24h volume
    if symbols:
        target = {s.upper() for s in symbols}
        coins = [c for c in all_coins if c["symbol"] in target]
    elif single_symbol:
        target = single_symbol.upper()
        coins = [c for c in all_coins if c["symbol"] == target]
    else:
        coins = sorted(
            all_coins,
            key=lambda c: c.get("liquidation_usd_24h", 0),
            reverse=True,
        )[:10]

    if not coins:
        return "No matching coins found in liquidation data."

    lines = ["Liquidation Overview (cross-exchange):"]

    for coin in coins:
        sym = coin["symbol"]
        total_24h = coin.get("liquidation_usd_24h", 0)
        long_24h = coin.get("long_liquidation_usd_24h", 0)
        short_24h = coin.get("short_liquidation_usd_24h", 0)
        total_4h = coin.get("liquidation_usd_4h", 0)
        total_1h = coin.get("liquidation_usd_1h", 0)

        # Dominant side
        if total_24h > 0:
            long_pct = (long_24h / total_24h) * 100
            dominant = f"{'longs' if long_pct > 50 else 'shorts'} dominant ({max(long_pct, 100 - long_pct):.0f}%)"
        else:
            dominant = "no data"

        lines.append(
            f"  {sym}: "
            f"24h {_fmt_big(total_24h)} "
            f"(L: {_fmt_big(long_24h)} / S: {_fmt_big(short_24h)}) | "
            f"4h {_fmt_big(total_4h)} | "
            f"1h {_fmt_big(total_1h)} | "
            f"{dominant}"
        )

    # Market total
    total_market_24h = sum(c.get("liquidation_usd_24h", 0) for c in all_coins)
    total_market_longs = sum(c.get("long_liquidation_usd_24h", 0) for c in all_coins)
    total_market_shorts = sum(c.get("short_liquidation_usd_24h", 0) for c in all_coins)
    lines.append("")
    lines.append(
        f"  Market total 24h: {_fmt_big(total_market_24h)} "
        f"(L: {_fmt_big(total_market_longs)} / S: {_fmt_big(total_market_shorts)})"
    )

    return "\n".join(lines)


def _by_exchange(provider, symbol: str, time_range: str) -> str:
    """Per-exchange liquidation breakdown for one coin."""
    symbol = symbol.upper()

    try:
        exchanges = provider.get_liquidation_by_exchange(symbol, time_range)
    except Exception as e:
        logger.error(f"Liquidation exchange-list error for {symbol}: {e}")
        return f"Error fetching exchange liquidation data: {e}"

    if not exchanges:
        return f"{symbol}: No exchange liquidation data available."

    # Separate "All" aggregate from individual exchanges
    aggregate = None
    individual = []
    for ex in exchanges:
        if ex.get("exchange") == "All":
            aggregate = ex
        else:
            individual.append(ex)

    # Sort by total liquidation descending
    individual.sort(
        key=lambda x: x.get("liquidation_usd", 0),
        reverse=True,
    )

    lines = [f"{symbol} Liquidations by Exchange ({range}):"]

    if aggregate:
        total = aggregate.get("liquidation_usd", 0)
        longs = aggregate.get("longLiquidation_usd", 0)
        shorts = aggregate.get("shortLiquidation_usd", 0)
        long_pct = (longs / total * 100) if total > 0 else 0
        lines.append(
            f"  Total: {_fmt_big(total)} "
            f"(Longs: {_fmt_big(longs)} [{long_pct:.0f}%] / "
            f"Shorts: {_fmt_big(shorts)} [{100 - long_pct:.0f}%])"
        )
        lines.append("")

    # Show top exchanges (skip tiny ones)
    for ex in individual[:8]:
        name = ex.get("exchange", "?")
        total = ex.get("liquidation_usd", 0)
        longs = ex.get("longLiquidation_usd", 0)
        shorts = ex.get("shortLiquidation_usd", 0)

        if total < 1000:
            continue

        share = ""
        if aggregate and aggregate.get("liquidation_usd", 0) > 0:
            pct = (total / aggregate["liquidation_usd"]) * 100
            share = f" ({pct:.0f}% of total)"

        lines.append(
            f"  {name}: {_fmt_big(total)}{share} — "
            f"L: {_fmt_big(longs)} / S: {_fmt_big(shorts)}"
        )

    return "\n".join(lines)


# =============================================================================
# 3. REGISTER — wires into the registry
# =============================================================================

def register(registry) -> None:
    """Register liquidation tool with the registry."""
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_get_liquidations,
    ))


# =============================================================================
# INTERNAL — formatting helpers
# =============================================================================

def _fmt_big(n: float) -> str:
    """Format large USD numbers compactly."""
    if n >= 1_000_000_000:
        return f"${n / 1_000_000_000:.1f}B"
    elif n >= 1_000_000:
        return f"${n / 1_000_000:.1f}M"
    elif n >= 1_000:
        return f"${n / 1_000:.0f}K"
    else:
        return f"${n:.0f}"
