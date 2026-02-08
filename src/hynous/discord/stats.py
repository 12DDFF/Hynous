"""
Discord Stats Embed Builder

Builds a clean, rich embed showing portfolio, positions, market data,
and daemon status. Called every 30s by the bot's background task to
keep the stats panel updated in-place.

Zero Claude tokens — uses daemon snapshot + provider HTTP only.
"""

import logging
import time
from datetime import datetime, timezone

import discord

logger = logging.getLogger(__name__)


def build_stats_embed(provider, daemon, config) -> discord.Embed:
    """Build a rich embed from provider state + daemon snapshot."""

    # 1. Fetch portfolio data (1 HTTP call)
    try:
        state = provider.get_user_state()
        account_value = state["account_value"]
        unrealized = state["unrealized_pnl"]
        positions = state["positions"]
    except Exception as e:
        logger.debug("Stats: provider fetch failed: %s", e)
        embed = discord.Embed(
            title="HYNOUS",
            description="Failed to fetch portfolio data.",
            color=0x6b7280,
        )
        embed.set_footer(text="Refreshes every 30s")
        embed.timestamp = datetime.now(timezone.utc)
        return embed

    initial = getattr(provider, "_initial_balance", config.execution.paper_balance)
    change_pct = ((account_value - initial) / initial * 100) if initial else 0

    # 2. Embed color: green if up, red if down, gray if no positions
    if not positions:
        color = 0x6b7280
    elif change_pct >= 0:
        color = 0x22c55e
    else:
        color = 0xef4444

    embed = discord.Embed(title="HYNOUS", color=color)

    # 3. Portfolio section (description)
    daily_pnl = daemon._daily_realized_pnl if daemon else 0
    embed.description = (
        f"**Portfolio** \u2014 ${account_value:,.2f}  ({change_pct:+.2f}%)\n"
        f"Unrealized \u2014 ${unrealized:+,.2f}\n"
        f"Daily PnL \u2014 ${daily_pnl:+,.2f}"
    )

    # 4. Positions section
    if positions:
        pos_lines = []
        for p in positions:
            symbol = p["coin"]
            side = p["side"].upper()
            size = p["size"]
            entry = p["entry_px"]
            pnl = p["unrealized_pnl"]
            ret = p["return_pct"]
            liq = p["liquidation_px"]
            line = (
                f"**{symbol} {side}**  {size} @ ${entry:,.2f}\n"
                f"PnL: ${pnl:+,.2f} ({ret:+.2f}%)  \u2022  Liq: ${liq:,.0f}"
            )
            pos_lines.append(line)

        # Append SL/TP info if paper provider has trigger orders
        try:
            triggers = provider.get_trigger_orders()
            if triggers:
                _attach_triggers(pos_lines, positions, triggers)
        except Exception:
            pass

        embed.add_field(
            name="Positions",
            value="\n\n".join(pos_lines),
            inline=False,
        )
    else:
        embed.add_field(
            name="Positions",
            value="No open positions",
            inline=False,
        )

    # 5. Market section (from daemon snapshot — zero cost)
    if daemon and daemon.snapshot.prices:
        prices = daemon.snapshot.prices
        price_parts = []
        for sym in ["BTC", "ETH", "SOL"]:
            px = prices.get(sym)
            if px:
                if px >= 1000:
                    price_parts.append(f"{sym} ${px / 1000:.1f}K")
                else:
                    price_parts.append(f"{sym} ${px:,.1f}")
        fg = daemon.snapshot.fear_greed
        fg_label = _fg_label(fg)
        market_text = "  ".join(price_parts)
        if fg:
            market_text += f"\nFear & Greed: {fg} ({fg_label})"
    else:
        market_text = "Daemon not running"
    embed.add_field(name="Market", value=market_text, inline=False)

    # 6. Daemon section
    if daemon and daemon.is_running:
        now = time.time()

        # Next review countdown (doubles on weekends)
        review_interval = config.daemon.periodic_interval
        if datetime.now(timezone.utc).weekday() >= 5:
            review_interval *= 2
        next_review = max(0, daemon._last_review + review_interval - now)
        next_review_min = int(next_review // 60)

        # Wakes this hour
        wakes_hr = len([t for t in daemon._wake_timestamps if t > now - 3600])
        max_hr = config.daemon.max_wakes_per_hour

        paused = "\u26a0\ufe0f PAUSED" if daemon._trading_paused else "OK"
        daemon_text = (
            f"Status: Running  \u2502  Wakes: {wakes_hr}/{max_hr} hr\n"
            f"Next Review: {next_review_min}m  \u2502  Circuit: {paused}"
        )
    else:
        daemon_text = "Daemon not running"
    embed.add_field(name="Daemon", value=daemon_text, inline=False)

    # 7. Footer + timestamp
    mode = config.execution.mode.upper()
    embed.set_footer(text=f"{mode} \u2022 Refreshes every 30s")
    embed.timestamp = datetime.now(timezone.utc)

    return embed


def _attach_triggers(pos_lines: list[str], positions: list[dict], triggers: list[dict]):
    """Append SL/TP lines to matching position entries."""
    by_coin: dict[str, dict[str, float]] = {}
    for t in triggers:
        coin = t.get("coin", "")
        trigger_px = t.get("trigger_px", 0)
        order_type = t.get("order_type", "")
        if order_type == "stop_loss":
            by_coin.setdefault(coin, {})["sl"] = trigger_px
        elif order_type == "take_profit":
            by_coin.setdefault(coin, {})["tp"] = trigger_px

    for i, p in enumerate(positions):
        coin = p["coin"]
        if coin in by_coin:
            parts = []
            if "sl" in by_coin[coin]:
                parts.append(f"SL: ${by_coin[coin]['sl']:,.0f}")
            if "tp" in by_coin[coin]:
                parts.append(f"TP: ${by_coin[coin]['tp']:,.0f}")
            if parts:
                pos_lines[i] += "\n" + " \u2192 ".join(parts)


def _fg_label(fg: int) -> str:
    """Fear & Greed index label."""
    if fg <= 25:
        return "Extreme Fear"
    if fg <= 45:
        return "Fear"
    if fg <= 55:
        return "Neutral"
    if fg <= 75:
        return "Greed"
    return "Extreme Greed"
