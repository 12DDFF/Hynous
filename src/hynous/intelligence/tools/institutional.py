"""
Institutional Flow Tool

Cross-exchange institutional and on-chain flow data from Coinglass.
Answers questions like "are institutions buying?", "is there a Coinbase premium?",
and "are exchanges seeing inflows or outflows?"

Flexible via metrics parameter:
  etf_flows: BTC/ETH spot ETF daily net flows.
    Agent uses this to gauge institutional demand — inflows = buying, outflows = selling.

  coinbase_premium: Coinbase premium/discount vs other exchanges.
    Agent uses this to detect US institutional buying pressure. Premium = US buying.

  exchange_balance: On-chain exchange balances with 1d/7d/30d changes.
    Agent uses this to spot accumulation (outflows = bullish) vs distribution (inflows = bearish).

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
    "name": "get_institutional_flow",
    "description": (
        "Get institutional and on-chain flow data from Coinglass.\n"
        "Shows ETF flows, Coinbase premium, and exchange balance changes.\n\n"
        "Pick which metrics to fetch (can combine):\n"
        "- etf_flows: BTC/ETH spot ETF daily net flows.\n"
        "  Good for: 'Are institutions buying or selling?'\n"
        "- coinbase_premium: Coinbase price premium/discount vs other exchanges. (May require higher API plan.)\n"
        "  Good for: 'Is there US institutional buying pressure?'\n"
        "- exchange_balance: On-chain exchange holdings with 1d/7d/30d changes.\n"
        "  Good for: 'Are whales moving coins off exchanges (bullish) or on (bearish)?'\n\n"
        "Examples:\n"
        '  {"symbol": "BTC", "metrics": ["etf_flows"]} → recent BTC ETF inflows/outflows\n'
        '  {"symbol": "ETH", "metrics": ["etf_flows"]} → ETH ETF flows\n'
        '  {"symbol": "BTC", "metrics": ["coinbase_premium"]} → Coinbase premium trend\n'
        '  {"symbol": "BTC", "metrics": ["exchange_balance"]} → exchange inflows/outflows\n'
        '  {"symbol": "BTC", "metrics": ["etf_flows", "coinbase_premium", "exchange_balance"]} → full institutional picture'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": 'Coin symbol (e.g., "BTC", "ETH"). Used for exchange_balance. ETF flows auto-select bitcoin/ethereum.',
            },
            "metrics": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": ["etf_flows", "coinbase_premium", "exchange_balance"],
                },
                "description": 'Which data to fetch. Can combine: ["etf_flows", "exchange_balance"]. Default: etf_flows + exchange_balance.',
            },
            "days": {
                "type": "integer",
                "description": "Number of recent days for ETF flows (default: 7). Max 30.",
            },
        },
        "required": ["symbol"],
    },
}


# =============================================================================
# 2. HANDLER — processes the tool call
# =============================================================================

def handle_get_institutional_flow(
    symbol: str,
    metrics: list[str] | None = None,
    days: int = 7,
) -> str:
    """Handle the get_institutional_flow tool call."""
    from ...data.providers.coinglass import get_provider

    symbol = symbol.upper()
    provider = get_provider()

    if metrics is None:
        metrics = ["etf_flows", "exchange_balance"]

    days = min(max(days, 1), 30)

    sections = []

    if "etf_flows" in metrics:
        sections.append(_etf_flows(provider, symbol, days))

    if "coinbase_premium" in metrics:
        sections.append(_coinbase_premium(provider))

    if "exchange_balance" in metrics:
        sections.append(_exchange_balance(provider, symbol))

    if not sections:
        return "No valid metrics specified. Use: etf_flows, coinbase_premium, exchange_balance."

    return "\n\n".join(sections)


def _etf_flows(provider, symbol: str, days: int) -> str:
    """BTC/ETH spot ETF daily net flows."""
    # Map symbol to ETF asset
    asset_map = {"BTC": "bitcoin", "ETH": "ethereum"}
    asset = asset_map.get(symbol)

    if not asset:
        return f"{symbol} ETF Flows: Only BTC and ETH have spot ETFs."

    try:
        all_flows = provider.get_etf_flows(asset)
    except Exception as e:
        logger.error(f"ETF flows error for {symbol}: {e}")
        return f"{symbol} ETF Flows: Error — {e}"

    if not all_flows:
        return f"{symbol} ETF Flows: No data available."

    # Take last N days
    recent = all_flows[-days:]

    lines = [f"{symbol} Spot ETF Flows (last {len(recent)} days):"]

    total_net = 0
    positive_days = 0
    negative_days = 0

    for day in recent:
        ts = day.get("timestamp") or day.get("t")
        flow_usd = day.get("flow_usd") or day.get("totalNetFlow") or 0
        price = day.get("price_usd") or day.get("price") or 0

        # Parse timestamp
        if ts:
            try:
                if isinstance(ts, (int, float)):
                    # Could be seconds or milliseconds
                    if ts > 1e12:
                        ts = ts / 1000
                    dt = datetime.fromtimestamp(ts)
                    label = dt.strftime("%b %d")
                else:
                    label = str(ts)[:10]
            except (ValueError, OSError):
                label = "?"
        else:
            label = "?"

        if isinstance(flow_usd, str):
            try:
                flow_usd = float(flow_usd)
            except ValueError:
                flow_usd = 0

        total_net += flow_usd
        if flow_usd > 0:
            positive_days += 1
        elif flow_usd < 0:
            negative_days += 1

        lines.append(f"  {label}: {_fmt_flow(flow_usd)}")

    # Summary
    lines.append("")
    streak_text = f"{positive_days} inflow days, {negative_days} outflow days"
    sentiment = (
        "Strong institutional demand"
        if total_net > 500_000_000
        else "Net institutional buying"
        if total_net > 0
        else "Net institutional selling"
        if total_net > -500_000_000
        else "Heavy institutional outflows"
    )
    lines.append(
        f"  Net {len(recent)}d: {_fmt_flow(total_net)} | "
        f"{streak_text} | {sentiment}"
    )

    return "\n".join(lines)


def _coinbase_premium(provider) -> str:
    """Coinbase premium/discount index."""
    try:
        data = provider.get_coinbase_premium(interval="1h", limit=24)
    except Exception as e:
        logger.error(f"Coinbase premium error: {e}")
        return f"Coinbase Premium: Error — {e}"

    if not data:
        return "Coinbase Premium: No data available."

    lines = ["BTC Coinbase Premium (24h):"]

    # Get current (latest) and recent trend
    latest = data[-1]
    current_premium = latest.get("premium") or latest.get("p") or 0
    current_rate = latest.get("premium_rate") or latest.get("r") or 0

    if isinstance(current_premium, str):
        current_premium = float(current_premium)
    if isinstance(current_rate, str):
        current_rate = float(current_rate)

    # Calculate trend from all data points
    rates = []
    for entry in data:
        r = entry.get("premium_rate") or entry.get("r") or 0
        if isinstance(r, str):
            r = float(r)
        rates.append(r)

    avg_rate = sum(rates) / len(rates) if rates else 0
    max_rate = max(rates) if rates else 0
    min_rate = min(rates) if rates else 0

    # Premium interpretation
    if current_rate > 0.05:
        signal = "Strong US buying pressure"
    elif current_rate > 0.01:
        signal = "Mild US buying"
    elif current_rate > -0.01:
        signal = "Neutral"
    elif current_rate > -0.05:
        signal = "Mild US selling"
    else:
        signal = "Strong US selling pressure"

    lines.append(
        f"  Current: ${current_premium:+.1f} ({current_rate:+.3f}%)"
    )
    lines.append(
        f"  24h avg: {avg_rate:+.3f}% | Range: {min_rate:+.3f}% to {max_rate:+.3f}%"
    )
    lines.append(f"  Signal: {signal}")

    return "\n".join(lines)


def _exchange_balance(provider, symbol: str) -> str:
    """On-chain exchange balance changes."""
    try:
        exchanges = provider.get_exchange_balance(symbol)
    except Exception as e:
        logger.error(f"Exchange balance error for {symbol}: {e}")
        return f"{symbol} Exchange Balances: Error — {e}"

    if not exchanges:
        return f"{symbol} Exchange Balances: No data available."

    # Sort by total balance
    exchanges.sort(
        key=lambda x: abs(x.get("total_balance", 0) or 0),
        reverse=True,
    )

    lines = [f"{symbol} Exchange Balances (on-chain):"]

    total_balance = 0
    total_change_1d = 0
    net_flow_count_1d = {"inflow": 0, "outflow": 0}

    for ex in exchanges[:8]:
        name = ex.get("exchange_name", "?")
        balance = ex.get("total_balance", 0) or 0
        chg_1d = ex.get("balance_change_percent_1d", 0) or 0
        chg_7d = ex.get("balance_change_percent_7d", 0) or 0
        chg_30d = ex.get("balance_change_percent_30d", 0) or 0

        total_balance += balance
        if chg_1d > 0:
            net_flow_count_1d["inflow"] += 1
        elif chg_1d < 0:
            net_flow_count_1d["outflow"] += 1

        lines.append(
            f"  {name}: {_fmt_coin(balance, symbol)} | "
            f"1d: {chg_1d:+.2f}% | 7d: {chg_7d:+.2f}% | 30d: {chg_30d:+.2f}%"
        )

    # Summary
    lines.append("")
    inflows = net_flow_count_1d["inflow"]
    outflows = net_flow_count_1d["outflow"]

    if outflows > inflows + 2:
        trend = "Net outflows (accumulation — bullish signal)"
    elif inflows > outflows + 2:
        trend = "Net inflows (distribution — bearish signal)"
    else:
        trend = "Mixed flows"

    lines.append(
        f"  Total tracked: {_fmt_coin(total_balance, symbol)} | "
        f"1d: {inflows} inflow / {outflows} outflow exchanges | {trend}"
    )

    return "\n".join(lines)


# =============================================================================
# 3. REGISTER — wires into the registry
# =============================================================================

def register(registry) -> None:
    """Register institutional flow tool with the registry."""
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_get_institutional_flow,
    ))


# =============================================================================
# INTERNAL — formatting helpers
# =============================================================================

def _fmt_flow(n: float) -> str:
    """Format ETF flow with sign and color hint."""
    sign = "+" if n > 0 else ""
    if abs(n) >= 1_000_000_000:
        return f"{sign}${n / 1_000_000_000:.2f}B"
    elif abs(n) >= 1_000_000:
        return f"{sign}${n / 1_000_000:.1f}M"
    elif abs(n) >= 1_000:
        return f"{sign}${n / 1_000:.0f}K"
    else:
        return f"{sign}${n:.0f}"


def _fmt_coin(n: float, symbol: str) -> str:
    """Format coin balance compactly."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.2f}M {symbol}"
    elif n >= 1_000:
        return f"{n / 1_000:.1f}K {symbol}"
    else:
        return f"{n:.2f} {symbol}"


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
