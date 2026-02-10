"""
Trade Stats Tool — Agent tool #19 for viewing trading performance.

Gives the agent self-awareness of its own performance: win rate, PnL,
profit factor, per-symbol breakdown, and recent trade history.

Standard tool module pattern: TOOL_DEF, handler, register().
"""

import logging

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "get_trade_stats",
    "description": (
        "View your trading performance — win rate, total PnL, profit factor, "
        "per-symbol breakdown, and recent trade history.\n\n"
        "Use this to review how you're doing before making trading decisions.\n\n"
        "Examples:\n"
        '  {} → full performance report\n'
        '  {"symbol": "BTC"} → BTC-only stats\n'
        '  {"symbol": "ETH"} → ETH-only stats'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": "Filter to a specific symbol (e.g. BTC, ETH, SOL). Omit for all.",
            },
        },
    },
}


def handle_get_trade_stats(symbol: str | None = None) -> str:
    """Handle the get_trade_stats tool call."""
    from ...core.trade_analytics import get_trade_stats

    stats = get_trade_stats()

    if stats.total_trades == 0:
        return "No closed trades yet. Start trading to build your track record."

    if symbol:
        symbol = symbol.upper()
        return _format_symbol_report(stats, symbol)

    return _format_full_report(stats)


def _format_full_report(stats) -> str:
    """Format a full performance report."""
    pf_str = f"{stats.profit_factor:.2f}" if stats.profit_factor != float('inf') else "∞"
    sign = "+" if stats.total_pnl >= 0 else ""

    lines = [
        "=== Trading Performance ===",
        f"Total Trades: {stats.total_trades} ({stats.wins}W / {stats.losses}L)",
        f"Win Rate: {stats.win_rate:.1f}%",
        f"Total PnL: {sign}${stats.total_pnl:.2f}",
        f"Profit Factor: {pf_str}",
        f"Avg Win: +${stats.avg_win:.2f} | Avg Loss: ${stats.avg_loss:.2f}",
        f"Best: +${stats.best_trade:.2f} | Worst: ${stats.worst_trade:.2f}",
    ]

    # Streaks
    streak_parts = []
    if stats.current_streak > 0:
        streak_parts.append(f"Current: {stats.current_streak}W")
    elif stats.current_streak < 0:
        streak_parts.append(f"Current: {abs(stats.current_streak)}L")
    if stats.max_win_streak:
        streak_parts.append(f"Max win: {stats.max_win_streak}")
    if stats.max_loss_streak:
        streak_parts.append(f"Max loss: {stats.max_loss_streak}")
    if streak_parts:
        lines.append(f"Streaks: {' | '.join(streak_parts)}")

    # Duration
    if stats.avg_duration_hours > 0:
        if stats.avg_duration_hours >= 24:
            lines.append(f"Avg Duration: {stats.avg_duration_hours / 24:.1f} days")
        else:
            lines.append(f"Avg Duration: {stats.avg_duration_hours:.1f} hours")

    # Per-symbol breakdown
    if stats.by_symbol:
        lines.append("")
        lines.append("--- By Symbol ---")
        for sym, data in sorted(stats.by_symbol.items()):
            s = "+" if data["pnl"] >= 0 else ""
            lines.append(
                f"{sym}: {data['trades']} trades, "
                f"{data['win_rate']}% win, "
                f"{s}${data['pnl']:.2f}"
            )

    # Recent trades (last 5)
    if stats.trades:
        lines.append("")
        lines.append("--- Recent Trades ---")
        for t in stats.trades[:5]:
            s = "+" if t.pnl_usd >= 0 else ""
            dur_str = ""
            if t.duration_hours > 0:
                if t.duration_hours >= 24:
                    dur_str = f" ({t.duration_hours / 24:.1f}d)"
                else:
                    dur_str = f" ({t.duration_hours:.1f}h)"
            lines.append(
                f"  {t.symbol} {t.side.upper()} | "
                f"${t.entry_px:,.0f} → ${t.exit_px:,.0f} | "
                f"{s}${t.pnl_usd:.2f} ({t.pnl_pct:+.1f}%){dur_str}"
            )

    return "\n".join(lines)


def _format_symbol_report(stats, symbol: str) -> str:
    """Format a symbol-filtered report."""
    sym_data = stats.by_symbol.get(symbol)
    if not sym_data:
        return f"No closed trades for {symbol}."

    s = "+" if sym_data["pnl"] >= 0 else ""
    lines = [
        f"=== {symbol} Performance ===",
        f"Trades: {sym_data['trades']} ({sym_data['wins']}W / {sym_data['trades'] - sym_data['wins']}L)",
        f"Win Rate: {sym_data['win_rate']}%",
        f"PnL: {s}${sym_data['pnl']:.2f}",
    ]

    # Recent trades for this symbol
    sym_trades = [t for t in stats.trades if t.symbol == symbol]
    if sym_trades:
        lines.append("")
        lines.append("--- Recent ---")
        for t in sym_trades[:5]:
            ts = "+" if t.pnl_usd >= 0 else ""
            lines.append(
                f"  {t.side.upper()} | "
                f"${t.entry_px:,.0f} → ${t.exit_px:,.0f} | "
                f"{ts}${t.pnl_usd:.2f} ({t.pnl_pct:+.1f}%)"
            )

    return "\n".join(lines)


def register(registry) -> None:
    """Register the trade stats tool."""
    from .registry import Tool

    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_get_trade_stats,
    ))
