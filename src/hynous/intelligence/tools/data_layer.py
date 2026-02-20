"""
Data Layer Tool

Gives the agent access to hynous-data signals:
  - Liquidation heatmaps (where are pending liqs?)
  - Order flow / CVD (who's buying vs selling?)
  - Whale positions (what are the biggest traders doing?)
  - HLP vault positions (what is the market maker doing?)
  - Smart money rankings (who's most profitable?)

Standard tool module pattern:
  1. TOOL_DEF — Anthropic JSON schema
  2. handler  — processes the tool call
  3. register — wires into the registry
"""

import logging

from .registry import Tool

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "data_layer",
    "description": (
        "Query the Hyperliquid data layer for deep market intelligence.\n\n"
        "Actions:\n"
        "  heatmap — Liquidation heatmap for a coin. Shows price buckets where "
        "liquidations are clustered (pending liqs, not past). Key for gauging "
        "liquidation cascades and magnet zones.\n"
        "  orderflow — Buy/sell volume + Cumulative Volume Delta (CVD) across "
        "1m/5m/15m/1h windows. Shows aggressive buyer vs seller pressure.\n"
        "  whales — Largest positions on a coin sorted by size. Shows what "
        "the biggest traders are doing.\n"
        "  hlp — HLP (Hyperliquid's market-maker vault) current positions. "
        "Shows what side the house is on.\n"
        "  smart_money — Most profitable traders in last 24h + their current "
        "positions.\n\n"
        "Examples:\n"
        '  {"action": "heatmap", "coin": "BTC"}\n'
        '  {"action": "orderflow", "coin": "ETH"}\n'
        '  {"action": "whales", "coin": "SOL", "top_n": 20}\n'
        '  {"action": "hlp"}\n'
        '  {"action": "smart_money", "top_n": 10}'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["heatmap", "orderflow", "whales", "hlp", "smart_money"],
                "description": "Which data layer signal to query.",
            },
            "coin": {
                "type": "string",
                "description": "Coin symbol (required for heatmap, orderflow, whales).",
            },
            "top_n": {
                "type": "integer",
                "description": "Number of results for whales/smart_money (default 20).",
            },
        },
        "required": ["action"],
    },
}


def handle_data_layer(action: str, coin: str = "", top_n: int = 20, **kwargs) -> str:
    """Handle data layer tool calls."""
    from ...data.providers.hynous_data import get_client

    client = get_client()

    # Check availability (skip health call if already known available)
    if not client.is_available and not client.health():
        return "Data layer unavailable — hynous-data service not running."

    if action == "heatmap":
        if not coin:
            return "Error: coin is required for heatmap."
        data = client.heatmap(coin)
        if not data:
            return f"No heatmap data for {coin}."
        if "error" in data:
            return f"{data['error']}. Available: {', '.join(data.get('available', []))}"

        s = data.get("summary", {})
        mid = data.get("mid_price", 0)
        if mid <= 0:
            return f"Heatmap data incomplete for {coin} (no mid price)."
        lines = [
            f"Liquidation Heatmap — {coin} (mid ${mid:,.0f})",
            f"Total long liqs: ${s.get('total_long_liq_usd', 0):,.0f}",
            f"Total short liqs: ${s.get('total_short_liq_usd', 0):,.0f}",
            f"Positions tracked: {s.get('total_positions', 0)}",
            "",
            "Densest zones (top 5 by liq USD):",
        ]

        # Sort buckets by total liq
        buckets = data.get("buckets", [])
        sorted_b = sorted(
            buckets,
            key=lambda b: b.get("long_liq_usd", 0) + b.get("short_liq_usd", 0),
            reverse=True,
        )
        for b in sorted_b[:5]:
            long_liq = b.get("long_liq_usd", 0)
            short_liq = b.get("short_liq_usd", 0)
            total = long_liq + short_liq
            if total == 0:
                continue
            price_mid = b.get("price_mid", 0)
            pct_from_mid = (price_mid - mid) / mid * 100 if mid else 0
            lines.append(
                f"  ${price_mid:,.0f} ({pct_from_mid:+.1f}%): "
                f"L ${long_liq:,.0f} ({b.get('long_count', 0)}), "
                f"S ${short_liq:,.0f} ({b.get('short_count', 0)})"
            )

        return "\n".join(lines)

    elif action == "orderflow":
        if not coin:
            return "Error: coin is required for orderflow."
        data = client.order_flow(coin)
        if not data:
            return f"No order flow data for {coin}."

        lines = [f"Order Flow — {coin} (total trades: {data.get('total_trades', 0)})"]
        for label, w in data.get("windows", {}).items():
            cvd = w.get("cvd", 0)
            buy_pct = w.get("buy_pct", 50)
            direction = "BUY pressure" if cvd > 0 else "SELL pressure"
            lines.append(
                f"  {label}: buy ${w.get('buy_volume_usd', 0):,.0f} / sell ${w.get('sell_volume_usd', 0):,.0f} "
                f"| CVD ${cvd:+,.0f} | {buy_pct:.0f}% buys -> {direction}"
            )

        return "\n".join(lines)

    elif action == "whales":
        if not coin:
            return "Error: coin is required for whales."
        data = client.whales(coin, top_n)
        if not data:
            return f"No whale data for {coin}."

        net = data.get("net_usd", 0)
        bias = "LONG-biased" if net > 0 else "SHORT-biased"
        lines = [
            f"Whale Positions — {coin} (top {data.get('count', 0)})",
            f"Long total: ${data.get('total_long_usd', 0):,.0f} | Short total: ${data.get('total_short_usd', 0):,.0f}",
            f"Net: {bias} ${abs(net):,.0f}",
            "",
        ]
        for p in data.get("positions", [])[:top_n]:
            addr = p.get("address", "")[:10]
            lines.append(
                f"  {addr}… {p['side']} ${p['size_usd']:,.0f} "
                f"({p.get('leverage', 1):.0f}x) entry ${p.get('entry_px', 0):,.2f} "
                f"PnL ${p.get('unrealized_pnl', 0):+,.0f}"
            )

        return "\n".join(lines)

    elif action == "hlp":
        data = client.hlp_positions()
        if not data:
            return "HLP data unavailable."

        positions = data.get("positions", [])
        if not positions:
            return "HLP: no open positions."

        sorted_pos = sorted(positions, key=lambda p: p.get("size_usd", 0), reverse=True)
        lines = [f"HLP Vault Positions ({len(positions)} total):", ""]
        for p in sorted_pos[:15]:
            lines.append(
                f"  {p.get('coin', '?'):>6} {p.get('side', '?'):>5} ${p.get('size_usd', 0):>12,.0f} "
                f"({p.get('leverage', 1):.0f}x) PnL ${p.get('unrealized_pnl', 0):+,.0f}"
            )

        # Summary
        long_usd = sum(p.get("size_usd", 0) for p in positions if p.get("side") == "long")
        short_usd = sum(p.get("size_usd", 0) for p in positions if p.get("side") == "short")
        lines.append(f"\nTotal: ${long_usd:,.0f} long, ${short_usd:,.0f} short")
        return "\n".join(lines)

    elif action == "smart_money":
        data = client.smart_money(top_n)
        if not data:
            return "Smart money data unavailable."

        rankings = data.get("rankings", [])
        if not rankings:
            return "Smart money: insufficient data (need 24h+ of snapshots)."

        lines = [f"Smart Money — Top {len(rankings)} by 24h PnL:", ""]
        for r in rankings[:top_n]:
            addr = r.get("address", "")[:10]
            pos_text = ", ".join(
                f"{p.get('coin', '?')} {p.get('side', '?')}"
                for p in r.get("positions", [])[:3]
            ) or "no positions"
            lines.append(
                f"  {addr}... PnL ${r.get('pnl_24h', 0):+,.0f} ({r.get('pnl_pct_24h', 0):+.1f}%) "
                f"equity ${r.get('equity', 0):,.0f} | {pos_text}"
            )

        return "\n".join(lines)

    else:
        return f"Unknown action: {action}. Use: heatmap, orderflow, whales, hlp, smart_money"


def register(registry) -> None:
    """Register data layer tool."""
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_data_layer,
    ))
