"""
Global Sentiment Tool

Cross-exchange derivatives positioning data from Coinglass.
Gives the agent a "whole market" view beyond just Hyperliquid.

The agent picks which metrics to fetch via the `metrics` parameter:
  open_interest: Aggregate OI across all exchanges + % changes at multiple timeframes.
  funding: Current funding rate on every exchange for comparison.
  funding_trend: Weighted aggregate funding history (OI-weight or vol-weight).
  fear_greed: Crypto Fear & Greed index — market-wide sentiment gauge.
  oi_history: Cross-exchange OI over time — is leverage building or unwinding?

One tool call can combine metrics, e.g., metrics=["open_interest", "funding"]
gives both OI and funding in a single response.

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
    "name": "get_global_sentiment",
    "description": (
        "Get cross-exchange derivatives sentiment from Coinglass.\n"
        "Shows the broader market picture beyond just Hyperliquid.\n\n"
        "Pick which metrics to fetch (can combine multiple):\n"
        "- open_interest: Aggregate OI across all exchanges + recent % changes.\n"
        "  Good for: 'Is the whole market building leverage?'\n"
        "- funding: Current funding rate on every exchange, side by side.\n"
        "  Good for: 'Is Hyperliquid funding in line with Binance?'\n"
        "- funding_trend: Weighted aggregate funding rate history.\n"
        "  Good for: 'Has aggregate funding been rising or falling?'\n"
        "- fear_greed: Crypto Fear & Greed index (0-100).\n"
        "  Good for: 'What's the overall market mood? Is the crowd fearful or greedy?'\n"
        "- oi_history: Cross-exchange OI over time for a coin.\n"
        "  Good for: 'Is leverage building or unwinding over the last 4h/24h?'\n\n"
        "Examples:\n"
        '  {"symbol": "BTC", "metrics": ["open_interest"]} → cross-exchange OI\n'
        '  {"symbol": "ETH", "metrics": ["funding"]} → ETH funding on all exchanges\n'
        '  {"symbol": "BTC", "metrics": ["open_interest", "funding"]} → both in one call\n'
        '  {"symbol": "BTC", "metrics": ["funding_trend"], "period": "7d"} → 7-day aggregate funding trend\n'
        '  {"symbol": "BTC", "metrics": ["fear_greed"]} → Fear & Greed index\n'
        '  {"symbol": "BTC", "metrics": ["oi_history"], "period": "24h"} → BTC OI over last 24h\n'
        '  {"symbol": "SOL", "metrics": ["open_interest", "funding", "funding_trend"]} → full derivatives picture'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": 'Coin symbol (e.g., "BTC", "ETH", "SOL").',
            },
            "metrics": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": ["open_interest", "funding", "funding_trend", "fear_greed", "oi_history"],
                },
                "description": 'Which data to fetch. Can combine: ["open_interest", "funding", "fear_greed"]. Default: open_interest + funding + funding_trend.',
            },
            "period": {
                "type": "string",
                "enum": ["24h", "3d", "7d", "30d"],
                "description": "Lookback period for funding_trend and oi_history. Default: 7d for funding_trend, 24h for oi_history.",
            },
            "weight": {
                "type": "string",
                "enum": ["oi", "vol"],
                "description": "Weighting method for funding_trend: 'oi' (open-interest-weighted) or 'vol' (volume-weighted). Default: oi.",
            },
        },
        "required": ["symbol"],
    },
}


# =============================================================================
# 2. HANDLER — processes the tool call
# =============================================================================

# Period → number of 8h candles
_PERIOD_LIMITS = {
    "24h": 3,
    "3d": 9,
    "7d": 21,
    "30d": 90,
}


def handle_get_global_sentiment(
    symbol: str,
    metrics: list[str] | None = None,
    period: str = "7d",
    weight: str = "oi",
) -> str:
    """Handle the get_global_sentiment tool call."""
    from ...data.providers.coinglass import get_provider

    symbol = symbol.upper()
    provider = get_provider()

    if metrics is None:
        metrics = ["open_interest", "funding", "funding_trend"]

    sections = []

    if "open_interest" in metrics:
        sections.append(_open_interest(provider, symbol))

    if "funding" in metrics:
        sections.append(_funding(provider, symbol))

    if "funding_trend" in metrics:
        sections.append(_funding_trend(provider, symbol, period, weight))

    if "fear_greed" in metrics:
        sections.append(_fear_greed(provider))

    if "oi_history" in metrics:
        # OI history API supports "4h" and "12h" on Hobbyist plan
        oi_range_map = {"24h": "4h", "3d": "4h", "7d": "12h", "30d": "12h"}
        oi_range = oi_range_map.get(period, "4h")
        sections.append(_oi_history(provider, symbol, oi_range))

    if not sections:
        return "No valid metrics specified. Use: open_interest, funding, funding_trend, fear_greed, oi_history."

    return "\n\n".join(sections)


def _open_interest(provider, symbol: str) -> str:
    """Cross-exchange open interest section."""
    try:
        exchanges = provider.get_oi_by_exchange(symbol)
    except Exception as e:
        logger.error(f"OI exchange-list error for {symbol}: {e}")
        return f"{symbol} Open Interest: Error — {e}"

    if not exchanges:
        return f"{symbol} Open Interest: No data available."

    # Find aggregate and top exchanges
    aggregate = None
    individual = []
    for ex in exchanges:
        if ex.get("exchange") == "All":
            aggregate = ex
        else:
            individual.append(ex)

    individual.sort(
        key=lambda x: x.get("open_interest_usd", 0),
        reverse=True,
    )

    lines = [f"{symbol} Open Interest (cross-exchange):"]

    if aggregate:
        total_oi = aggregate.get("open_interest_usd", 0)
        chg_1h = aggregate.get("open_interest_change_percent_1h", 0)
        chg_4h = aggregate.get("open_interest_change_percent_4h", 0)
        chg_24h = aggregate.get("open_interest_change_percent_24h", 0)
        coin_margin = aggregate.get("open_interest_by_coin_margin", 0)
        stable_margin = aggregate.get("open_interest_by_stable_coin_margin", 0)

        lines.append(f"  Total: {_fmt_big(total_oi)}")
        lines.append(
            f"  Changes: 1h {chg_1h:+.2f}% | 4h {chg_4h:+.2f}% | 24h {chg_24h:+.2f}%"
        )

        if total_oi > 0:
            stable_pct = (stable_margin / total_oi) * 100
            lines.append(
                f"  Margin: {stable_pct:.0f}% stablecoin / "
                f"{100 - stable_pct:.0f}% coin-margined"
            )
        lines.append("")

    # Top 6 exchanges
    lines.append("  By exchange:")
    for ex in individual[:6]:
        name = ex.get("exchange", "?")
        oi = ex.get("open_interest_usd", 0)
        chg_24h = ex.get("open_interest_change_percent_24h", 0)

        share = ""
        if aggregate and aggregate.get("open_interest_usd", 0) > 0:
            pct = (oi / aggregate["open_interest_usd"]) * 100
            share = f" [{pct:.0f}%]"

        lines.append(
            f"    {name}: {_fmt_big(oi)}{share} (24h: {chg_24h:+.1f}%)"
        )

    return "\n".join(lines)


def _funding(provider, symbol: str) -> str:
    """Cross-exchange funding rate comparison."""
    try:
        data = provider.get_funding_by_exchange(symbol)
    except Exception as e:
        logger.error(f"Funding exchange-list error for {symbol}: {e}")
        return f"{symbol} Funding Rates: Error — {e}"

    if not data:
        return f"{symbol} Funding Rates: No data available."

    stablecoin_list = data.get("stablecoin_margin_list", [])
    if not stablecoin_list:
        return f"{symbol} Funding Rates: No exchange data."

    # Sort by absolute funding rate (most extreme first)
    stablecoin_list.sort(
        key=lambda x: abs(x.get("funding_rate", 0)),
        reverse=True,
    )

    lines = [f"{symbol} Funding Rates (cross-exchange):"]

    rates = [ex.get("funding_rate", 0) for ex in stablecoin_list if ex.get("funding_rate") is not None]
    if rates:
        avg_rate = sum(rates) / len(rates)
        max_rate = max(rates)
        min_rate = min(rates)
        lines.append(
            f"  Avg: {avg_rate / 100:+.4%} | "
            f"Range: {min_rate / 100:+.4%} to {max_rate / 100:+.4%}"
        )

        # Sentiment from average
        if avg_rate > 0.03:
            sentiment = "Crowded long"
        elif avg_rate > 0.005:
            sentiment = "Moderately long"
        elif avg_rate > -0.005:
            sentiment = "Neutral"
        elif avg_rate > -0.03:
            sentiment = "Moderately short"
        else:
            sentiment = "Crowded short"
        lines.append(f"  Sentiment: {sentiment}")
        lines.append("")

    for ex in stablecoin_list[:8]:
        name = ex.get("exchange", "?")
        rate = ex.get("funding_rate", 0)
        interval = ex.get("funding_rate_interval", "?")
        lines.append(
            f"  {name}: {rate / 100:+.4%} (every {interval}h)"
        )

    return "\n".join(lines)


def _funding_trend(provider, symbol: str, period: str, weight: str) -> str:
    """Aggregate weighted funding rate trend."""
    limit = _PERIOD_LIMITS.get(period, 21)

    try:
        candles = provider.get_funding_history_weighted(
            symbol=symbol,
            weight=weight,
            interval="8h",
            limit=limit,
        )
    except Exception as e:
        logger.error(f"Funding trend error for {symbol}: {e}")
        return f"{symbol} Funding Trend: Error — {e}"

    if not candles:
        return f"{symbol} Funding Trend: No data available for {period}."

    weight_label = "OI-weighted" if weight == "oi" else "Vol-weighted"
    lines = [f"{symbol} Funding Trend ({period}, {weight_label}):"]

    closes = [c["close"] for c in candles]
    n = len(closes)

    # Current (latest candle close)
    current = closes[-1]

    # Average
    avg = sum(closes) / n

    # Extremes
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]
    max_rate = max(highs)
    min_rate = min(lows)

    # Trend: first half vs second half
    half = max(n // 2, 1)
    first_avg = sum(closes[:half]) / half
    second_avg = sum(closes[-half:]) / half
    diff = second_avg - first_avg

    if abs(diff) < 0.002:
        trend = "Stable"
    elif diff > 0:
        trend = "Rising (longs getting more crowded)"
    else:
        trend = "Falling (short pressure building)" if second_avg < 0 else "Falling (cooling off)"

    # Cumulative cost
    cumulative = sum(closes)

    # Values are in percent (e.g., -0.02 = -0.02%)
    # Convert to Hyperliquid-compatible format (divide by 100 for display as %)
    lines.append(
        f"  Current: {current / 100:+.4%} | Avg: {avg / 100:+.4%}"
    )
    lines.append(
        f"  Range: {min_rate / 100:+.4%} to {max_rate / 100:+.4%}"
    )
    lines.append(f"  Trend: {trend}")
    lines.append(
        f"  Cumulative ({n} settlements): {cumulative / 100:+.4%}"
    )

    return "\n".join(lines)


def _fear_greed(provider) -> str:
    """Crypto Fear & Greed index."""
    try:
        data = provider.get_fear_greed()
    except Exception as e:
        logger.error(f"Fear & Greed error: {e}")
        return f"Fear & Greed Index: Error — {e}"

    if not data:
        return "Fear & Greed Index: No data available."

    # Data structure: {data_list, price_list, time_list}
    values = data.get("data_list") or data.get("dataList") or []
    prices = data.get("price_list") or data.get("priceList") or []
    times = data.get("time_list") or data.get("timeList") or []

    if not values:
        return "Fear & Greed Index: No data available."

    lines = ["Crypto Fear & Greed Index:"]

    # Current value (latest)
    current = values[-1] if values else 0
    if isinstance(current, str):
        current = float(current)

    # Classification
    if current <= 25:
        label = "Extreme Fear"
    elif current <= 40:
        label = "Fear"
    elif current <= 60:
        label = "Neutral"
    elif current <= 75:
        label = "Greed"
    else:
        label = "Extreme Greed"

    lines.append(f"  Current: {current:.0f}/100 ({label})")

    # Recent trend (last 7 data points if available)
    recent = values[-7:] if len(values) >= 7 else values
    recent_floats = [float(v) if isinstance(v, str) else v for v in recent]

    if len(recent_floats) >= 2:
        avg = sum(recent_floats) / len(recent_floats)
        first = recent_floats[0]
        last = recent_floats[-1]
        change = last - first

        direction = "Rising" if change > 5 else "Falling" if change < -5 else "Stable"
        lines.append(f"  7d avg: {avg:.0f} | Trend: {direction} ({change:+.0f})")

    # Contrarian signal
    if current <= 20:
        signal = "Historically, extreme fear = buying opportunity"
    elif current >= 80:
        signal = "Historically, extreme greed = caution zone"
    else:
        signal = ""

    if signal:
        lines.append(f"  Note: {signal}")

    return "\n".join(lines)


def _oi_history(provider, symbol: str, range: str) -> str:
    """Cross-exchange OI over time."""
    try:
        data = provider.get_oi_history_chart(symbol, range)
    except Exception as e:
        logger.error(f"OI history error for {symbol}: {e}")
        return f"{symbol} OI History: Error — {e}"

    if not data:
        return f"{symbol} OI History ({range}): No data available."

    time_list = data.get("time_list") or data.get("timeList") or []
    price_list = data.get("price_list") or data.get("priceList") or []
    data_map = data.get("data_map") or data.get("dataMap") or {}

    if not time_list or not data_map:
        return f"{symbol} OI History ({range}): No data available."

    lines = [f"{symbol} OI History ({range}):"]

    # Calculate total OI at start and end across all exchanges
    total_start = 0
    total_end = 0
    exchange_changes = []

    for exchange, oi_values in data_map.items():
        if not oi_values or exchange == "All":
            continue

        vals = [float(v) if isinstance(v, str) else (v or 0) for v in oi_values]
        if len(vals) < 2:
            continue

        # Find first and last non-zero values
        start_val = vals[0]
        end_val = vals[-1]

        total_start += start_val
        total_end += end_val

        if start_val > 0:
            pct_change = ((end_val - start_val) / start_val) * 100
            exchange_changes.append((exchange, end_val, pct_change))

    # Check for "All" aggregate
    if "All" in data_map:
        all_vals = [float(v) if isinstance(v, str) else (v or 0) for v in data_map["All"]]
        if len(all_vals) >= 2:
            total_start = all_vals[0]
            total_end = all_vals[-1]

    # Total OI change
    if total_start > 0:
        total_change = ((total_end - total_start) / total_start) * 100
        lines.append(
            f"  Total OI: {_fmt_big(total_end)} ({total_change:+.2f}% over {range})"
        )

        if total_change > 5:
            signal = "Leverage building rapidly"
        elif total_change > 1:
            signal = "OI expanding"
        elif total_change > -1:
            signal = "OI stable"
        elif total_change > -5:
            signal = "OI contracting"
        else:
            signal = "Leverage unwinding rapidly"
        lines.append(f"  Signal: {signal}")
    else:
        lines.append(f"  Total OI: {_fmt_big(total_end)}")

    # Price at start/end
    if price_list and len(price_list) >= 2:
        p_start = float(price_list[0]) if isinstance(price_list[0], str) else (price_list[0] or 0)
        p_end = float(price_list[-1]) if isinstance(price_list[-1], str) else (price_list[-1] or 0)
        if p_start > 0:
            p_change = ((p_end - p_start) / p_start) * 100
            lines.append(f"  Price: ${p_end:,.0f} ({p_change:+.2f}% over {range})")

    # Top exchanges by change
    if exchange_changes:
        exchange_changes.sort(key=lambda x: abs(x[2]), reverse=True)
        lines.append("")
        lines.append("  By exchange:")
        for name, oi, chg in exchange_changes[:5]:
            lines.append(f"    {name}: {_fmt_big(oi)} ({chg:+.1f}%)")

    return "\n".join(lines)


# =============================================================================
# 3. REGISTER — wires into the registry
# =============================================================================

def register(registry) -> None:
    """Register global sentiment tool with the registry."""
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_get_global_sentiment,
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
