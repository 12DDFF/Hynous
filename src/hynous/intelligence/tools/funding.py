"""
Funding History Tool

Historical funding rate analysis for the Hynous agent.
Goes beyond the current snapshot — shows trend over time.

Answers questions like "is funding getting more extreme or cooling off?"

Provides:
  - Current vs average funding rate
  - Funding trend (rising/falling/stable)
  - Extremes (max/min over the period)
  - Cumulative cost (what longs/shorts paid over the period)
  - Sentiment read (crowded long/short/neutral)

Standard tool module pattern:
  1. TOOL_DEF — Anthropic JSON schema
  2. handler  — processes the tool call
  3. register — wires into the registry
"""

import logging
from datetime import datetime, timedelta, timezone

from .registry import Tool

logger = logging.getLogger(__name__)


# =============================================================================
# 1. TOOL DEFINITION — Anthropic JSON Schema
# =============================================================================

TOOL_DEF = {
    "name": "get_funding_history",
    "description": (
        "Get historical funding rate analysis for a symbol on Hyperliquid.\n"
        "Shows funding trend, average, extremes, cumulative cost, and sentiment.\n"
        "Funding rates settle every 8 hours on Hyperliquid.\n\n"
        "Examples:\n"
        '  {"symbol": "BTC"} → 7-day funding analysis (default)\n'
        '  {"symbol": "ETH", "period": "30d"} → 30-day funding trend\n'
        '  {"symbol": "SOL", "period": "24h"} → last 3 funding settlements'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": 'Trading symbol (e.g., "BTC", "ETH", "SOL")',
            },
            "period": {
                "type": "string",
                "enum": ["24h", "3d", "7d", "30d"],
                "description": "Lookback period for funding history (default: 7d)",
            },
        },
        "required": ["symbol"],
    },
}


# =============================================================================
# 2. HANDLER — processes the tool call
# =============================================================================

_PERIODS = {
    "24h": timedelta(hours=24),
    "3d": timedelta(days=3),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


def handle_get_funding_history(symbol: str, period: str = "7d") -> str:
    """Handle the get_funding_history tool call.

    Returns compact text summarizing funding rate trends.
    """
    from ...data.providers.hyperliquid import get_provider

    symbol = symbol.upper()
    delta = _PERIODS.get(period)
    if not delta:
        return f"Invalid period '{period}'. Use: 24h, 3d, 7d, 30d"

    provider = get_provider()

    # Check symbol exists
    price = provider.get_price(symbol)
    if price is None:
        return f"{symbol}: Not found on Hyperliquid. Check the symbol name."

    now = datetime.now(timezone.utc)
    start_ms = int((now - delta).timestamp() * 1000)

    rates = provider.get_funding_history(symbol, start_ms)

    if not rates:
        return f"{symbol}: No funding data available for the last {period}."

    funding_vals = [r["rate"] for r in rates]
    n = len(funding_vals)

    # --- Current funding (from asset context for real-time) ---
    ctx = provider.get_asset_context(symbol)
    current_funding = ctx["funding"] if ctx else funding_vals[-1]

    # --- Average ---
    avg_funding = sum(funding_vals) / n

    # --- Extremes ---
    max_funding = max(funding_vals)
    min_funding = min(funding_vals)

    # --- Trend: first half avg vs second half avg ---
    half = max(n // 2, 1)
    first_half_avg = sum(funding_vals[:half]) / half
    second_half_avg = sum(funding_vals[-half:]) / half

    diff = second_half_avg - first_half_avg
    if abs(diff) < 0.00005:
        trend = "Stable"
        trend_detail = "holding steady"
    elif diff > 0:
        trend = "Rising"
        trend_detail = "longs getting more crowded"
    else:
        trend = "Falling"
        trend_detail = "short pressure increasing" if second_half_avg < 0 else "cooling off from longs"

    # --- Cumulative cost (annualized equivalent) ---
    # Each settlement = 8h, so 3 per day
    # Cumulative = sum of all rates in period
    cumulative = sum(funding_vals)
    settlements_per_day = 3
    days = delta.total_seconds() / 86400
    annualized = (cumulative / days) * 365 if days > 0 else 0

    if cumulative > 0:
        payer = "Longs paid"
    else:
        payer = "Shorts paid"

    # --- Sentiment ---
    if avg_funding > 0.0003:
        sentiment = "Crowded long (euphoric)"
    elif avg_funding > 0.0001:
        sentiment = "Moderately long"
    elif avg_funding > -0.0001:
        sentiment = "Neutral"
    elif avg_funding > -0.0003:
        sentiment = "Moderately short"
    else:
        sentiment = "Crowded short (fearful)"

    # --- How many positive vs negative ---
    positive = sum(1 for f in funding_vals if f > 0)
    negative = n - positive

    lines = [
        f"{symbol} Funding ({period}, {n} settlements):",
        f"  Current: {current_funding:+.4%} | Avg: {avg_funding:+.4%}",
        f"  Range: {min_funding:+.4%} to {max_funding:+.4%}",
        f"  Trend: {trend} ({trend_detail})",
        f"  Split: {positive}/{n} positive, {negative}/{n} negative",
        f"  Cumulative: {cumulative:+.4%} ({payer} {abs(cumulative):.4%} over {period})",
        f"  Annualized: {annualized:+.2%}",
        f"  Sentiment: {sentiment}",
    ]

    return "\n".join(lines)


# =============================================================================
# 3. REGISTER — wires into the registry
# =============================================================================

def register(registry) -> None:
    """Register funding history tool with the registry."""
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_get_funding_history,
    ))
