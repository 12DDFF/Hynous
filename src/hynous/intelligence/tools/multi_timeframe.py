"""
Multi-Timeframe Analysis Tool

Single call that gives nested context across 24h, 7d, and 30d simultaneously.
Answers "is the 30d downtrend reversing on shorter timeframes?" without
the agent needing to make 3 separate get_market_data calls.

Computes per-timeframe summaries plus a cross-timeframe layer:
  - Trend alignment (all bullish, divergent, etc.)
  - Volatility profile (compressing, expanding, stable)
  - Momentum (confirming trend or fading)

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
    "name": "get_multi_timeframe",
    "description": (
        "Get multi-timeframe price analysis for a symbol on Hyperliquid.\n"
        "Analyzes 24h, 7d, and 30d simultaneously in one call.\n"
        "Shows per-timeframe trend + volatility, and cross-timeframe alignment.\n"
        "Use this when you need to see how an asset behaves across timeframes at once.\n\n"
        "Examples:\n"
        '  {"symbol": "BTC"} → full 24h/7d/30d analysis with cross-timeframe context\n'
        '  {"symbol": "ETH"} → is the short-term trend confirming or diverging from long-term?'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": 'Trading symbol (e.g., "BTC", "ETH", "SOL")',
            },
        },
        "required": ["symbol"],
    },
}


# =============================================================================
# 2. HANDLER — processes the tool call
# =============================================================================

# Timeframes to analyze: (label, timedelta, candle_interval)
_TIMEFRAMES = [
    ("24h", timedelta(hours=24), "1h"),
    ("7d", timedelta(days=7), "4h"),
    ("30d", timedelta(days=30), "1d"),
]


def handle_get_multi_timeframe(symbol: str) -> str:
    """Handle the get_multi_timeframe tool call.

    Fetches candles for 3 timeframes, computes per-timeframe summaries,
    then adds cross-timeframe analysis on top.
    """
    from ...data.providers.hyperliquid import get_provider

    symbol = symbol.upper()
    provider = get_provider()

    price = provider.get_price(symbol)
    if price is None:
        return f"{symbol}: Not found on Hyperliquid. Check the symbol name."

    now = datetime.now(timezone.utc)
    tf_data = []  # list of {label, change, trend, trend_pct, vol_label, vol_score, high, low}

    per_tf_lines = []

    for label, delta, interval in _TIMEFRAMES:
        start_ms = int((now - delta).timestamp() * 1000)
        end_ms = int(now.timestamp() * 1000)

        try:
            candles = provider.get_candles(symbol, interval, start_ms, end_ms)
        except Exception as e:
            logger.error(f"Candle fetch error for {symbol} {label}: {e}")
            per_tf_lines.append(f"  {label}: Error fetching data")
            continue

        if not candles:
            per_tf_lines.append(f"  {label}: No data")
            continue

        analysis = _analyze_timeframe(candles)
        tf_data.append({"label": label, **analysis})

        sign = "+" if analysis["change"] > 0 else ""
        per_tf_lines.append(
            f"  {label}: {sign}{analysis['change']:.1f}% | "
            f"{analysis['trend']} | "
            f"Vol: {analysis['vol_label']} | "
            f"Range: {_fmt_price(analysis['low'])} - {_fmt_price(analysis['high'])}"
        )

    # Current snapshot
    ctx = provider.get_asset_context(symbol)
    snapshot_parts = [f"{symbol} @ {_fmt_price(price)}"]
    if ctx:
        prev = ctx["prev_day_price"]
        if prev and prev > 0:
            c24 = ((price - prev) / prev) * 100
            snapshot_parts.append(f"24h: {'+' if c24 > 0 else ''}{c24:.1f}%")
        snapshot_parts.append(f"Funding: {ctx['funding']:+.4%}")

    lines = [" | ".join(snapshot_parts), ""]
    lines.append("Timeframes:")
    lines.extend(per_tf_lines)

    # Cross-timeframe analysis (need at least 2 timeframes)
    if len(tf_data) >= 2:
        lines.append("")
        lines.append("Cross-Timeframe:")
        lines.extend(_cross_timeframe(tf_data))

    return "\n".join(lines)


# =============================================================================
# 3. REGISTER — wires into the registry
# =============================================================================

def register(registry) -> None:
    """Register multi-timeframe tool with the registry."""
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_get_multi_timeframe,
    ))


# =============================================================================
# INTERNAL — analysis helpers
# =============================================================================

def _analyze_timeframe(candles: list[dict]) -> dict:
    """Compute trend, volatility, and range for a set of candles.

    Returns dict with: change, trend, trend_pct, vol_label, vol_score, high, low
    """
    closes = [c["c"] for c in candles]
    highs = [c["h"] for c in candles]
    lows = [c["l"] for c in candles]

    start_price = candles[0]["o"]
    end_price = closes[-1]
    change = ((end_price - start_price) / start_price) * 100

    # Trend: first-third avg vs last-third avg
    n = len(closes)
    third = max(n // 3, 1)
    first_avg = sum(closes[:third]) / third
    last_avg = sum(closes[-third:]) / third
    trend_pct = ((last_avg - first_avg) / first_avg) * 100

    if trend_pct > 2:
        trend = "Bullish"
    elif trend_pct < -2:
        trend = "Bearish"
    else:
        trend = "Sideways"

    # Volatility: avg absolute candle-to-candle returns
    returns = []
    for i in range(1, len(closes)):
        if closes[i - 1] > 0:
            returns.append(abs((closes[i] - closes[i - 1]) / closes[i - 1]) * 100)
    vol_score = sum(returns) / len(returns) if returns else 0

    if vol_score < 0.5:
        vol_label = "Low"
    elif vol_score < 1.5:
        vol_label = "Moderate"
    elif vol_score < 3.0:
        vol_label = "High"
    else:
        vol_label = "Extreme"

    return {
        "change": change,
        "trend": trend,
        "trend_pct": trend_pct,
        "vol_label": vol_label,
        "vol_score": vol_score,
        "high": max(highs),
        "low": min(lows),
    }


def _cross_timeframe(tf_data: list[dict]) -> list[str]:
    """Compute cross-timeframe insights from multiple timeframe analyses."""
    lines = []
    trends = [tf["trend"] for tf in tf_data]
    labels = [tf["label"] for tf in tf_data]

    # --- Trend Alignment ---
    unique_trends = set(trends)
    if len(unique_trends) == 1:
        lines.append(f"  Alignment: All {trends[0].lower()} across timeframes")
    else:
        # Find the dominant long-term trend (last entry = longest)
        long_trend = trends[-1]
        short_trend = trends[0]
        if long_trend == "Bullish" and short_trend == "Bearish":
            lines.append("  Alignment: Divergent — pullback within longer uptrend")
        elif long_trend == "Bearish" and short_trend == "Bullish":
            lines.append("  Alignment: Divergent — bounce within longer downtrend")
        elif long_trend == "Sideways":
            lines.append(f"  Alignment: Mixed — long-term range, short-term {short_trend.lower()}")
        else:
            tf_summary = ", ".join(f"{d['label']} {d['trend'].lower()}" for d in tf_data)
            lines.append(f"  Alignment: Mixed ({tf_summary})")

    # --- Volatility Profile ---
    vol_scores = [tf["vol_score"] for tf in tf_data]
    if len(vol_scores) >= 2:
        long_vol = vol_scores[-1]
        short_vol = vol_scores[0]
        if long_vol > 0:
            ratio = short_vol / long_vol
            if ratio < 0.6:
                lines.append("  Volatility: Compressing (short-term calmer than long-term)")
            elif ratio > 1.5:
                lines.append("  Volatility: Expanding (short-term more volatile)")
            else:
                lines.append("  Volatility: Stable across timeframes")
        else:
            lines.append("  Volatility: Stable")

    # --- Momentum ---
    if len(tf_data) >= 2:
        long_tf = tf_data[-1]
        short_tf = tf_data[0]

        if long_tf["trend"] == short_tf["trend"] and long_tf["trend"] != "Sideways":
            lines.append(f"  Momentum: Strong — {short_tf['label']} confirms {long_tf['label']} {long_tf['trend'].lower()} trend")
        elif long_tf["trend"] != "Sideways" and short_tf["trend"] == "Sideways":
            lines.append(f"  Momentum: Stalling — {long_tf['label']} {long_tf['trend'].lower()} but {short_tf['label']} consolidating")
        elif long_tf["trend"] != short_tf["trend"] and short_tf["trend"] != "Sideways":
            lines.append(f"  Momentum: Fading — {short_tf['label']} diverging from {long_tf['label']} trend")
        else:
            lines.append("  Momentum: Neutral — no clear directional bias")

    # --- Key Levels (widest range from longest timeframe) ---
    longest = tf_data[-1]
    lines.append(f"  Key levels: Support ~{_fmt_price(longest['low'])} | Resistance ~{_fmt_price(longest['high'])}")

    return lines


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
