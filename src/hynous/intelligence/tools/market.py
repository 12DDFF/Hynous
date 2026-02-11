"""
Market Data Tool

Flexible market data tool for the Hynous agent.
One tool that supports multiple query modes:

  Quick look (symbols only):
    Current price + 24h change + funding + OI + volume

  Period summary (symbols + period):
    Price action analysis over 24h, 7d, 30d, or 90d

  Custom range (symbols + start_date / end_date):
    Price action between specific dates

Summaries are computed in Python — the agent receives compact,
human-readable text (~20–150 tokens) instead of raw OHLCV.

Standard tool module pattern:
  1. TOOL_DEF — Anthropic JSON schema
  2. handler  — processes the tool call
  3. register — wires into the registry
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from .registry import Tool

logger = logging.getLogger(__name__)


# =============================================================================
# 1. TOOL DEFINITION — Anthropic JSON Schema
# =============================================================================

TOOL_DEF = {
    "name": "get_market_data",
    "description": (
        "Get market data for cryptocurrency symbols on Hyperliquid. Flexible usage:\n"
        "- Current snapshot: just pass symbols\n"
        "- Period analysis (trend, volatility, key levels): pass symbols + period\n"
        "- Custom date range: pass symbols + start_date and/or end_date\n"
        "- Compare multiple assets: pass multiple symbols\n\n"
        "Examples:\n"
        '  {"symbols": ["BTC"]} → current BTC price, funding, OI, volume\n'
        '  {"symbols": ["ETH"], "period": "7d"} → ETH 7-day price action summary\n'
        '  {"symbols": ["BTC", "SOL"], "period": "30d"} → compare BTC vs SOL over 30d\n'
        '  {"symbols": ["DOGE"], "start_date": "2025-01-15", "end_date": "2025-02-01"}'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbols": {
                "type": "array",
                "items": {"type": "string"},
                "description": 'Trading symbols to query (e.g., ["BTC", "ETH", "SOL"])',
            },
            "period": {
                "type": "string",
                "enum": ["5m", "15m", "30m", "1h", "2h", "4h", "8h", "24h", "7d", "30d", "90d"],
                "description": "Analysis period. Short (5m-2h) for micro, longer (24h-90d) for swing.",
            },
            "start_date": {
                "type": "string",
                "description": 'Start date in ISO format (e.g., "2025-01-15"). Use with or without end_date.',
            },
            "end_date": {
                "type": "string",
                "description": 'End date in ISO format (e.g., "2025-02-01"). Defaults to now if omitted.',
            },
        },
        "required": ["symbols"],
    },
}


# =============================================================================
# 2. HANDLER — processes the tool call
# =============================================================================

# Period string → timedelta
_PERIODS = {
    "5m": timedelta(minutes=5),
    "15m": timedelta(minutes=15),
    "30m": timedelta(minutes=30),
    "1h": timedelta(hours=1),
    "2h": timedelta(hours=2),
    "4h": timedelta(hours=4),
    "8h": timedelta(hours=8),
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "90d": timedelta(days=90),
}


def handle_get_market_data(
    symbols: list[str],
    period: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> str:
    """Handle the get_market_data tool call.

    Returns compact text for the agent — not raw data.
    """
    from ...data.providers.hyperliquid import get_provider

    provider = get_provider()
    results = []

    for symbol in symbols:
        symbol = symbol.upper()

        try:
            if period or start_date:
                # --- Summary mode: fetch candles and compute analysis ---
                now = datetime.now(timezone.utc)

                if start_date and end_date:
                    start_dt = _parse_date(start_date)
                    end_dt = _parse_date(end_date)
                    label = f"{start_date} to {end_date}"
                elif start_date:
                    start_dt = _parse_date(start_date)
                    end_dt = now
                    label = f"{start_date} to now"
                elif period:
                    delta = _PERIODS.get(period)
                    if not delta:
                        results.append(f"{symbol}: Invalid period '{period}'. Use: 24h, 7d, 30d, 90d")
                        continue
                    start_dt = now - delta
                    end_dt = now
                    label = period

                duration = end_dt - start_dt
                interval = _pick_interval(duration)

                start_ms = int(start_dt.timestamp() * 1000)
                end_ms = int(end_dt.timestamp() * 1000)

                candles = provider.get_candles(symbol, interval, start_ms, end_ms)

                # Current snapshot for context + period summary
                snapshot = _format_snapshot(provider, symbol)
                summary = _compute_summary(candles, symbol, label)

                results.append(snapshot)
                results.append(summary)
            else:
                # --- Snapshot mode: current price + stats ---
                results.append(_format_snapshot(provider, symbol))

        except Exception as e:
            logger.error(f"Error fetching data for {symbol}: {e}")
            results.append(f"{symbol}: Error — {e}")

    return "\n---\n".join(results)


# =============================================================================
# 3. REGISTER — wires into the registry
# =============================================================================

def register(registry) -> None:
    """Register market data tools with the registry.

    Called by get_registry() in registry.py.
    To add more market tools, add more registry.register() calls here.
    """
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_get_market_data,
    ))


# =============================================================================
# INTERNAL — formatting and computation helpers
# =============================================================================

def _parse_date(date_str: str) -> datetime:
    """Parse an ISO date string to timezone-aware datetime."""
    dt = datetime.fromisoformat(date_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _pick_interval(duration: timedelta) -> str:
    """Auto-select candle interval based on time span."""
    minutes = duration.total_seconds() / 60
    if minutes <= 30:
        return "1m"
    elif minutes <= 120:
        return "5m"
    elif minutes <= 480:
        return "15m"
    days = duration.total_seconds() / 86400
    if days <= 2:
        return "1h"
    elif days <= 30:
        return "4h"
    else:
        return "1d"


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
    """Format large numbers (volume, OI) compactly."""
    if n >= 1_000_000_000:
        return f"${n / 1_000_000_000:.1f}B"
    elif n >= 1_000_000:
        return f"${n / 1_000_000:.1f}M"
    elif n >= 1_000:
        return f"${n / 1_000:.1f}K"
    else:
        return f"${n:.0f}"


def _format_snapshot(provider, symbol: str) -> str:
    """Quick snapshot: price + 24h change + funding + OI + volume."""
    price = provider.get_price(symbol)
    if price is None:
        return f"{symbol}: Not found on Hyperliquid. Check the symbol name."

    parts = [f"{symbol} @ {_fmt_price(price)}"]

    ctx = provider.get_asset_context(symbol)
    if ctx:
        prev = ctx["prev_day_price"]
        if prev and prev > 0:
            change_24h = ((price - prev) / prev) * 100
            sign = "+" if change_24h > 0 else ""
            parts.append(f"24h: {sign}{change_24h:.1f}%")

        parts.append(f"Funding: {ctx['funding']:+.4%}")

        # OI from Hyperliquid is in base asset — convert to USD
        oi_usd = ctx["open_interest"] * price
        parts.append(f"OI: {_fmt_big(oi_usd)}")

        # dayNtlVlm is already notional (USD)
        parts.append(f"Vol: {_fmt_big(ctx['day_volume'])}")

    return " | ".join(parts)


def _compute_summary(candles: list[dict], symbol: str, label: str) -> str:
    """Compute compact price action summary from candle data.

    Returns human-readable text covering:
    - Price change over the period
    - High/low range
    - Trend direction (first-third vs last-third of candle closes)
    - Volatility (avg absolute candle returns)
    - Volume profile (recent vs average)
    - Key support/resistance levels
    """
    if not candles:
        return f"{symbol}: No candle data available for this period."

    closes = [c["c"] for c in candles]
    highs = [c["h"] for c in candles]
    lows = [c["l"] for c in candles]
    volumes = [c["v"] for c in candles]

    start_price = candles[0]["o"]
    end_price = closes[-1]
    change_pct = ((end_price - start_price) / start_price) * 100

    highest = max(highs)
    lowest = min(lows)

    # --- Trend: compare first-third avg vs last-third avg ---
    n = len(closes)
    third = max(n // 3, 1)
    first_avg = sum(closes[:third]) / third
    last_avg = sum(closes[-third:]) / third
    trend_pct = ((last_avg - first_avg) / first_avg) * 100

    if trend_pct > 2:
        trend = "Bullish"
        detail = "steady accumulation" if trend_pct < 8 else "strong uptrend"
    elif trend_pct < -2:
        trend = "Bearish"
        detail = "gradual decline" if trend_pct > -8 else "strong downtrend"
    else:
        trend = "Sideways"
        detail = "range-bound"

    # --- Volatility: avg absolute candle-to-candle returns ---
    returns = []
    for i in range(1, len(closes)):
        if closes[i - 1] > 0:
            ret = abs((closes[i] - closes[i - 1]) / closes[i - 1]) * 100
            returns.append(ret)
    avg_return = sum(returns) / len(returns) if returns else 0

    if avg_return < 0.5:
        vol_label = "Low"
    elif avg_return < 1.5:
        vol_label = "Moderate"
    elif avg_return < 3.0:
        vol_label = "High"
    else:
        vol_label = "Extreme"

    # --- Volume profile: recent quarter vs overall average ---
    avg_vol = sum(volumes) / len(volumes) if volumes else 0
    recent_count = max(len(volumes) // 4, 1)
    recent_avg = sum(volumes[-recent_count:]) / recent_count

    if avg_vol > 0:
        ratio = recent_avg / avg_vol
        if ratio > 1.3:
            vol_profile = f"Increasing (recent {(ratio - 1) * 100:.0f}% above avg)"
        elif ratio < 0.7:
            vol_profile = f"Decreasing (recent {(1 - ratio) * 100:.0f}% below avg)"
        else:
            vol_profile = "Steady"
    else:
        vol_profile = "No volume data"

    sign = "+" if change_pct > 0 else ""

    lines = [
        f"{symbol} {label} Summary:",
        f"  Change: {sign}{change_pct:.1f}% ({_fmt_price(start_price)} -> {_fmt_price(end_price)})",
        f"  Range: {_fmt_price(lowest)} - {_fmt_price(highest)}",
        f"  Trend: {trend} ({detail})",
        f"  Volatility: {vol_label} ({avg_return:.1f}% avg move)",
        f"  Volume: {vol_profile}",
        f"  Key levels: Support ~{_fmt_price(lowest)} | Resistance ~{_fmt_price(highest)}",
    ]

    return "\n".join(lines)
