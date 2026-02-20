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
        "positions. Supports filters: min_win_rate, style (scalper/swing/mixed), "
        "exclude_bots, min_trades.\n"
        "  track_wallet — Add an address to the watchlist for position change alerts.\n"
        "  untrack_wallet — Remove an address from the watchlist.\n"
        "  watchlist — View all tracked wallets with win rates and positions.\n"
        "  wallet_profile — FULL deep dive on any address in ONE call: "
        "win rate, profit factor, style, equity, positions, recent activity, "
        "AND trade history (30 days of fills from Hyperliquid, FIFO matched). "
        "This is the primary tool for investigating any wallet.\n"
        "  relabel_wallet — Update label/notes/tags on a tracked wallet.\n"
        "  wallet_alerts — Create/list/delete per-wallet custom alerts. "
        "Types: any_trade, entry_only, exit_only, size_above, coin_specific.\n"
        "  analyze_wallet — Deep analysis mode: fetches full profile and returns "
        "structured data for your assessment (Edge / Positions / Patterns / Risk / Verdict).\n\n"
        "Examples:\n"
        '  {"action": "heatmap", "coin": "BTC"}\n'
        '  {"action": "orderflow", "coin": "ETH"}\n'
        '  {"action": "whales", "coin": "SOL", "top_n": 20}\n'
        '  {"action": "hlp"}\n'
        '  {"action": "smart_money", "top_n": 10}\n'
        '  {"action": "smart_money", "min_win_rate": 0.6, "style": "swing", "exclude_bots": true}\n'
        '  {"action": "track_wallet", "address": "0x...", "label": "Top trader"}\n'
        '  {"action": "wallet_profile", "address": "0x..."}\n'
        '  {"action": "relabel_wallet", "address": "0x...", "label": "SOL sniper", "notes": "Consistently front-runs listings", "tags": "SOL,scalper,high-wr"}\n'
        '  {"action": "wallet_alerts", "alert_action": "create", "address": "0x...", "alert_type": "entry_only"}\n'
        '  {"action": "wallet_alerts", "alert_action": "create", "address": "0x...", "alert_type": "size_above", "min_size_usd": 100000}\n'
        '  {"action": "wallet_alerts", "alert_action": "list", "address": "0x..."}\n'
        '  {"action": "wallet_alerts", "alert_action": "delete", "alert_id": 5}\n'
        '  {"action": "analyze_wallet", "address": "0x..."}\n'
        '  {"action": "watchlist"}'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "heatmap", "orderflow", "whales", "hlp", "smart_money",
                    "track_wallet", "untrack_wallet", "watchlist", "wallet_profile",
                    "relabel_wallet", "wallet_alerts", "analyze_wallet",
                ],
                "description": "Which data layer signal to query.",
            },
            "coin": {
                "type": "string",
                "description": "Coin symbol (required for heatmap, orderflow, whales).",
            },
            "top_n": {
                "type": "integer",
                "description": "Number of results for whales/smart_money/wallet_trades (default 20).",
            },
            "address": {
                "type": "string",
                "description": "Wallet address (required for track/untrack/wallet_profile/wallet_trades).",
            },
            "label": {
                "type": "string",
                "description": "Optional label for track_wallet.",
            },
            "min_win_rate": {
                "type": "number",
                "description": "Filter smart_money by minimum win rate (0.0-1.0).",
            },
            "style": {
                "type": "string",
                "description": "Filter smart_money by style: scalper, swing, mixed.",
            },
            "exclude_bots": {
                "type": "boolean",
                "description": "Filter smart_money: exclude bot-classified wallets.",
            },
            "min_trades": {
                "type": "integer",
                "description": "Filter smart_money by minimum trade count.",
            },
            "notes": {
                "type": "string",
                "description": "Notes text for relabel_wallet.",
            },
            "tags": {
                "type": "string",
                "description": "Comma-separated tags for relabel_wallet.",
            },
            "alert_action": {
                "type": "string",
                "enum": ["create", "list", "delete"],
                "description": "Sub-action for wallet_alerts.",
            },
            "alert_type": {
                "type": "string",
                "enum": ["any_trade", "entry_only", "exit_only", "size_above", "coin_specific"],
                "description": "Alert type for wallet_alerts create.",
            },
            "alert_id": {
                "type": "integer",
                "description": "Alert ID for wallet_alerts delete.",
            },
            "alert_coins": {
                "type": "string",
                "description": "Comma-separated coins for coin_specific alert.",
            },
            "min_size_usd": {
                "type": "number",
                "description": "Minimum size USD for size_above alert.",
            },
        },
        "required": ["action"],
    },
}


def handle_data_layer(action: str, coin: str = "", top_n: int = 20, address: str = "",
                      label: str = "", min_win_rate: float = 0, style: str = "",
                      exclude_bots: bool = False, min_trades: int = 0,
                      notes: str = "", tags: str = "",
                      alert_action: str = "", alert_type: str = "",
                      alert_id: int = 0, alert_coins: str = "",
                      min_size_usd: float = 0, **kwargs) -> str:
    """Handle data layer tool calls."""
    from ...data.providers.hynous_data import get_client

    # Normalize address for wallet actions
    if address:
        address = address.strip().lower()

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
        for window_name, w in data.get("windows", {}).items():
            cvd = w.get("cvd", 0)
            buy_pct = w.get("buy_pct", 50)
            direction = "BUY pressure" if cvd > 0 else "SELL pressure"
            lines.append(
                f"  {window_name}: buy ${w.get('buy_volume_usd', 0):,.0f} / sell ${w.get('sell_volume_usd', 0):,.0f} "
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
        data = client.smart_money(top_n, min_win_rate=min_win_rate, style=style,
                                  exclude_bots=exclude_bots, min_trades=min_trades)
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
            wr = r.get("win_rate")
            wr_str = f" WR {wr:.0%}" if wr is not None else ""
            style = r.get("style", "")
            style_str = f" [{style}]" if style else ""
            tc = r.get("trade_count")
            tc_str = f" {tc}trades" if tc else ""
            bot_str = " [BOT]" if r.get("is_bot") else ""
            lines.append(
                f"  {addr}... PnL ${r.get('pnl_24h', 0):+,.0f} ({r.get('pnl_pct_24h', 0):+.1f}%) "
                f"equity ${r.get('equity', 0):,.0f}{wr_str}{tc_str}{style_str}{bot_str} | {pos_text}"
            )

        return "\n".join(lines)

    elif action == "track_wallet":
        if not address:
            return "Error: address is required for track_wallet."
        data = client.sm_watch(address, label)
        if not data:
            return "Failed to track wallet — data layer unavailable."
        return f"Tracking wallet {address[:10]}... ({label or 'no label'}). Profile will be computed within 6h or on next wallet_profile call."

    elif action == "untrack_wallet":
        if not address:
            return "Error: address is required for untrack_wallet."
        data = client.sm_unwatch(address)
        if not data:
            return "Failed to untrack wallet — data layer unavailable."
        return f"Stopped tracking wallet {address[:10]}..."

    elif action == "watchlist":
        data = client.sm_watchlist()
        if not data:
            return "Watchlist unavailable — data layer not running."

        wallets = data.get("wallets", [])
        if not wallets:
            return "Watchlist is empty. Use track_wallet to add addresses."

        lines = [f"Tracked Wallets ({len(wallets)}):", ""]
        for w in wallets:
            addr = w.get("address", "")[:10]
            lbl = w.get("label", "")
            wr = w.get("win_rate")
            eq = w.get("equity")
            style = w.get("style", "")
            pos = w.get("positions_count", 0)
            is_bot = w.get("is_bot", 0)

            wr_str = f"{wr:.0%}" if wr is not None else "—"
            eq_str = f"${eq:,.0f}" if eq else "—"
            bot_tag = " [BOT]" if is_bot else ""
            style_tag = f" ({style})" if style else ""
            pos_tag = f" {pos} pos" if pos else " idle"

            lines.append(f"  {addr}... {lbl:<12} WR {wr_str} eq {eq_str}{style_tag}{bot_tag}{pos_tag}")

        return "\n".join(lines)

    elif action == "wallet_profile":
        if not address:
            return "Error: address is required for wallet_profile."
        return _format_profile(client.sm_profile(address), address, top_n)

    elif action == "relabel_wallet":
        if not address:
            return "Error: address is required for relabel_wallet."
        update_kwargs: dict = {}
        if label:
            update_kwargs["label"] = label
        if notes:
            update_kwargs["notes"] = notes
        if tags:
            update_kwargs["tags"] = tags
        if not update_kwargs:
            return "Error: provide at least one of: label, notes, tags."
        data = client.sm_update(address, **update_kwargs)
        if not data:
            return f"Failed to update wallet {address[:10]}... — not tracked or data layer unavailable."
        fields = ", ".join(f"{k}={v!r}" for k, v in update_kwargs.items())
        return f"Updated wallet {address[:10]}...: {fields}"

    elif action == "wallet_alerts":
        if not alert_action:
            return "Error: alert_action is required (create/list/delete)."

        if alert_action == "create":
            if not address:
                return "Error: address is required for alert creation."
            if not alert_type:
                return "Error: alert_type is required (any_trade/entry_only/exit_only/size_above/coin_specific)."
            data = client.sm_create_alert(address, alert_type, min_size_usd, alert_coins)
            if not data:
                return "Failed to create alert — data layer unavailable."
            coins_str = f", coins={alert_coins}" if alert_coins else ""
            size_str = f", min_size=${min_size_usd:,.0f}" if min_size_usd else ""
            return f"Alert created (id={data.get('id')}): {alert_type} on {address[:10]}...{size_str}{coins_str}"

        elif alert_action == "list":
            if not address:
                return "Error: address is required for alert listing."
            data = client.sm_list_alerts(address)
            if not data:
                return "Failed to list alerts — data layer unavailable."
            alerts = data.get("alerts", [])
            if not alerts:
                return f"No active alerts for {address[:10]}..."
            lines = [f"Active alerts for {address[:10]}... ({len(alerts)}):"]
            for a in alerts:
                coins_str = f" coins={a.get('coins')}" if a.get("coins") else ""
                size_str = f" min=${a.get('min_size_usd', 0):,.0f}" if a.get("min_size_usd") else ""
                lines.append(f"  #{a['id']} {a['alert_type']}{size_str}{coins_str}")
            return "\n".join(lines)

        elif alert_action == "delete":
            if not alert_id:
                return "Error: alert_id is required for deletion."
            data = client.sm_delete_alert(alert_id)
            if not data:
                return "Failed to delete alert — data layer unavailable."
            return f"Alert #{alert_id} deleted."
        else:
            return f"Unknown alert_action: {alert_action}. Use: create, list, delete."

    elif action == "analyze_wallet":
        if not address:
            return "Error: address is required for analyze_wallet."
        data = client.sm_profile(address)
        profile_text = _format_profile(data, address, top_n)
        return (
            "=== ANALYSIS DATA ===\n"
            f"{profile_text}\n"
            "=== END DATA ===\n\n"
            "Provide your structured assessment:\n"
            "1. EDGE — What makes this trader worth watching? (win rate, profit factor, style)\n"
            "2. POSITIONS — Current exposure and thesis\n"
            "3. PATTERNS — Recurring setups, preferred coins, time-of-day\n"
            "4. RISK — Red flags, drawdown, bot behavior\n"
            "5. VERDICT — Track / label / set alerts recommendations\n\n"
            "After analysis, offer to relabel_wallet and set wallet_alerts."
        )

    else:
        return (
            f"Unknown action: {action}. Use: heatmap, orderflow, whales, hlp, "
            f"smart_money, track_wallet, untrack_wallet, watchlist, wallet_profile, "
            f"relabel_wallet, wallet_alerts, analyze_wallet"
        )


def _format_profile(data: dict | None, address: str, top_n: int = 15) -> str:
    """Format a wallet profile into readable text."""
    if not data:
        return f"No profile data for {address[:10]}... (insufficient trades or unavailable)."

    import datetime
    lines = [f"Wallet Profile — {address[:10]}..."]
    lbl = data.get("label", "")
    if lbl:
        lines[0] += f' "{lbl}"'

    style = data.get("style", "unknown")
    is_bot = data.get("is_bot", 0)
    bot_str = " [BOT]" if is_bot else ""
    lines.append(f"Style: {style}{bot_str}")

    wr = data.get("win_rate")
    pf = data.get("profit_factor")
    tc = data.get("trade_count")
    ah = data.get("avg_hold_hours")
    eq = data.get("equity")
    dd = data.get("max_drawdown")

    stats = []
    if wr is not None:
        stats.append(f"Win Rate: {wr:.0%}")
    if pf is not None:
        stats.append(f"Profit Factor: {pf:.1f}")
    if tc is not None:
        stats.append(f"Trades: {tc}")
    if ah is not None:
        stats.append(f"Avg Hold: {ah:.1f}h")
    if eq is not None:
        stats.append(f"Equity: ${eq:,.0f}")
    if dd is not None and dd > 0:
        stats.append(f"Max DD: ${dd:,.0f}")
    lines.append(" | ".join(stats))

    # Notes/tags if present
    notes = data.get("notes", "")
    tags = data.get("tags", "")
    if notes:
        lines.append(f"Notes: {notes}")
    if tags:
        lines.append(f"Tags: {tags}")

    # Active alerts
    alerts = data.get("alerts", [])
    if alerts:
        lines.append(f"\nCustom Alerts ({len(alerts)}):")
        for a in alerts:
            coins_str = f" coins={a.get('coins')}" if a.get("coins") else ""
            size_str = f" min=${a.get('min_size_usd', 0):,.0f}" if a.get("min_size_usd") else ""
            lines.append(f"  #{a['id']} {a['alert_type']}{size_str}{coins_str}")

    # Current positions
    positions = data.get("positions", [])
    if positions:
        lines.append(f"\nCurrent Positions ({len(positions)}):")
        for p in positions:
            upnl = p.get("unrealized_pnl", 0)
            c = "+" if upnl >= 0 else ""
            lines.append(
                f"  {p.get('coin', '?')} {p.get('side', '?')} "
                f"${p.get('size_usd', 0):,.0f} ({p.get('leverage', 1):.0f}x) "
                f"entry ${p.get('entry_px', 0):,.2f} PnL ${upnl:{c},.0f}"
            )
    else:
        lines.append("\nNo open positions.")

    # Recent changes
    changes = data.get("recent_changes", [])
    if changes:
        lines.append(f"\nRecent Activity ({len(changes)} events, last 24h):")
        for ch in changes[:10]:
            ts = ch.get("detected_at", 0)
            t_str = datetime.datetime.fromtimestamp(ts).strftime("%H:%M") if ts else "?"
            lines.append(
                f"  {t_str} {ch.get('action', '?').upper()} {ch.get('coin', '?')} "
                f"{ch.get('side', '')} ${ch.get('size_usd', 0):,.0f}"
            )

    # Trade history
    trades = data.get("trades", [])
    if trades:
        lines.append(f"\nTrade History ({len(trades)} recent trades):")
        for t in trades[:top_n or 15]:
            ts = t.get("exit_time") or t.get("entry_time", 0)
            d_str = datetime.datetime.fromtimestamp(ts).strftime("%m/%d %H:%M") if ts else "?"
            pnl = t.get("pnl_usd", 0)
            hold = t.get("hold_hours", 0)
            hold_str = f"{hold * 60:.0f}m" if hold < 1 else f"{hold:.1f}h"
            result = "WIN" if pnl > 0 else "LOSS"
            lines.append(
                f"  {d_str} {t.get('coin', '?')} {t.get('side', '?')} "
                f"${t.get('size_usd', 0):,.0f} entry ${t.get('entry_px', 0):,.2f} "
                f"exit ${t.get('exit_px', 0):,.2f} PnL ${pnl:+,.0f} ({hold_str}) {result}"
            )
    else:
        lines.append("\nNo trade history (computed on next profile refresh).")

    return "\n".join(lines)


def register(registry) -> None:
    """Register data layer tool."""
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_data_layer,
    ))
