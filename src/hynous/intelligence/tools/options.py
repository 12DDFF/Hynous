"""
Options Flow Tool

Cross-exchange options data from Coinglass.
Answers questions like "where's max pain?" and "what's the put/call ratio?"

Flexible via metrics parameter:
  max_pain: Per-expiry max pain prices with call/put OI and put/call ratio.
    Agent uses this to see where options market expects price to gravitate.

  exchange_oi: Cross-exchange options OI, volume, and market share.
    Agent uses this to see total options positioning and which exchanges dominate.

Standard tool module pattern:
  1. TOOL_DEF — Anthropic JSON schema
  2. handler  — processes the tool call
  3. register — wires into the registry
"""

import logging
from datetime import datetime

from .registry import Tool

logger = logging.getLogger(__name__)


# =============================================================================
# 1. TOOL DEFINITION — Anthropic JSON Schema
# =============================================================================

TOOL_DEF = {
    "name": "get_options_flow",
    "description": (
        "Get cross-exchange options data from Coinglass.\n"
        "Shows max pain levels, put/call ratios, and options OI by exchange.\n\n"
        "Pick which metrics to fetch (can combine):\n"
        "- max_pain: Max pain price per expiry date, call/put OI, put/call ratio.\n"
        "  Good for: 'Where does the options market expect price to settle?'\n"
        "- exchange_oi: Cross-exchange options OI, volume, and market share.\n"
        "  Good for: 'How much options activity is there? Which exchanges lead?'\n\n"
        "Examples:\n"
        '  {"symbol": "BTC", "metrics": ["max_pain"]} → BTC max pain per expiry\n'
        '  {"symbol": "ETH", "metrics": ["exchange_oi"]} → ETH options OI by exchange\n'
        '  {"symbol": "BTC", "metrics": ["max_pain", "exchange_oi"]} → full options picture\n'
        '  {"symbol": "BTC", "metrics": ["max_pain"], "exchange": "Deribit"} → Deribit only'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": 'Coin symbol (e.g., "BTC", "ETH").',
            },
            "metrics": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": ["max_pain", "exchange_oi"],
                },
                "description": 'Which data to fetch. Can combine: ["max_pain", "exchange_oi"]. Default: both.',
            },
            "exchange": {
                "type": "string",
                "description": 'Options exchange (default: "Deribit"). Most options volume is on Deribit.',
            },
        },
        "required": ["symbol"],
    },
}


# =============================================================================
# 2. HANDLER — processes the tool call
# =============================================================================

def handle_get_options_flow(
    symbol: str,
    metrics: list[str] | None = None,
    exchange: str = "Deribit",
) -> str:
    """Handle the get_options_flow tool call."""
    from ...data.providers.coinglass import get_provider

    symbol = symbol.upper()
    provider = get_provider()

    if metrics is None:
        metrics = ["max_pain", "exchange_oi"]

    sections = []

    if "max_pain" in metrics:
        sections.append(_max_pain(provider, symbol, exchange))

    if "exchange_oi" in metrics:
        sections.append(_exchange_oi(provider, symbol, exchange))

    if not sections:
        return "No valid metrics specified. Use: max_pain, exchange_oi."

    return "\n\n".join(sections)


def _max_pain(provider, symbol: str, exchange: str) -> str:
    """Options max pain per expiry date."""
    try:
        expiries = provider.get_options_max_pain(symbol, exchange)
    except Exception as e:
        logger.error(f"Options max pain error for {symbol}: {e}")
        return f"{symbol} Options Max Pain: Error — {e}"

    if not expiries:
        return f"{symbol} Options Max Pain: No data available."

    lines = [f"{symbol} Options Max Pain ({exchange}):"]

    total_call_notional = 0
    total_put_notional = 0

    for exp in expiries:
        date_str = exp.get("date", "?")
        # Parse YYMMDD format
        try:
            dt = datetime.strptime(date_str, "%y%m%d")
            label = dt.strftime("%b %d")
        except ValueError:
            label = date_str

        max_pain = exp.get("max_pain_price", "?")
        call_oi = exp.get("call_open_interest", 0)
        put_oi = exp.get("put_open_interest", 0)
        call_notional = exp.get("call_open_interest_notional", 0)
        put_notional = exp.get("put_open_interest_notional", 0)

        total_call_notional += call_notional
        total_put_notional += put_notional

        pc_ratio = put_oi / call_oi if call_oi > 0 else 0

        lines.append(
            f"  {label}: Max Pain ${max_pain} | "
            f"Calls: {_fmt_big(call_notional)} | "
            f"Puts: {_fmt_big(put_notional)} | "
            f"P/C: {pc_ratio:.2f}"
        )

    # Overall summary
    total_notional = total_call_notional + total_put_notional
    overall_pc = total_put_notional / total_call_notional if total_call_notional > 0 else 0
    sentiment = "Bearish hedge heavy" if overall_pc > 1.2 else "Bullish skew" if overall_pc < 0.7 else "Balanced"
    lines.append("")
    lines.append(
        f"  Total options: {_fmt_big(total_notional)} | "
        f"Overall P/C: {overall_pc:.2f} ({sentiment})"
    )

    return "\n".join(lines)


def _exchange_oi(provider, symbol: str, exchange: str) -> str:
    """Cross-exchange options OI and volume."""
    try:
        exchanges = provider.get_options_info(symbol, exchange)
    except Exception as e:
        logger.error(f"Options info error for {symbol}: {e}")
        return f"{symbol} Options Exchange OI: Error — {e}"

    if not exchanges:
        return f"{symbol} Options Exchange OI: No data available."

    lines = [f"{symbol} Options OI by Exchange:"]

    # Sort by OI
    exchanges.sort(
        key=lambda x: x.get("open_interest_usd", 0) or 0,
        reverse=True,
    )

    for ex in exchanges:
        name = ex.get("exchange_name", "?")
        oi_usd = ex.get("open_interest_usd", 0) or 0
        oi_change = ex.get("open_interest_change_24h", 0) or 0
        vol_24h = ex.get("volume_usd_24h", 0) or 0
        share = ex.get("oi_market_share", 0) or 0

        lines.append(
            f"  {name}: OI {_fmt_big(oi_usd)} ({share:.0f}% share, "
            f"24h: {oi_change:+.1f}%) | Vol: {_fmt_big(vol_24h)}"
        )

    return "\n".join(lines)


# =============================================================================
# 3. REGISTER — wires into the registry
# =============================================================================

def register(registry) -> None:
    """Register options flow tool with the registry."""
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_get_options_flow,
    ))


# =============================================================================
# INTERNAL — formatting helpers
# =============================================================================

def _fmt_big(n: float) -> str:
    """Format large USD numbers compactly."""
    if n >= 1_000_000_000:
        return f"${n / 1_000_000_000:.1f}B"
    elif n >= 1_000_000:
        return f"${n / 1_000_000:.0f}M"
    elif n >= 1_000:
        return f"${n / 1_000:.0f}K"
    else:
        return f"${n:.0f}"
