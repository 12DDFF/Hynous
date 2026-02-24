"""Journal page — Trade history, equity curve, performance stats, and regret tracker."""

import reflex as rx
from ..state import AppState, ClosedTrade, PhantomRecord, PlaybookRecord
from ..components import card, stat_card


# ================================================================
# Trades Tab (existing)
# ================================================================

def _stats_row() -> rx.Component:
    """Top row — 9 stat cards in a 3-column grid."""
    return rx.grid(
        stat_card("Win Rate", AppState.journal_win_rate, "closed trades"),
        stat_card(
            "Account PnL",
            AppState.journal_total_pnl,
            "recorded: " + AppState.journal_recorded_pnl,
            value_color=rx.cond(
                AppState.journal_total_pnl.contains("+"),
                "#4ade80",
                rx.cond(
                    AppState.journal_total_pnl.contains("-"),
                    "#f87171",
                    "#fafafa",
                ),
            ),
        ),
        stat_card("Profit Factor", AppState.journal_profit_factor, "gross profit / loss"),
        stat_card("Total Trades", AppState.journal_total_trades, "closed positions"),
        stat_card(
            "Fee Losses",
            AppState.journal_fee_losses,
            "correct direction · " + AppState.journal_fee_heavy_count + " heavy",
            value_color="#fbbf24",
        ),
        stat_card(
            "Total Fees",
            AppState.journal_total_fees,
            "estimated round-trip paid",
            value_color="#f87171",
        ),
        stat_card(
            "Current Streak",
            AppState.journal_current_streak,
            "consecutive",
            value_color=rx.cond(
                AppState.journal_current_streak.contains("+"),
                "#4ade80",
                rx.cond(
                    AppState.journal_current_streak.contains("L"),
                    "#f87171",
                    "#fafafa",
                ),
            ),
        ),
        stat_card(
            "Max Streaks",
            AppState.journal_max_win_streak + "W / " + AppState.journal_max_loss_streak + "L",
            "win / loss",
        ),
        stat_card("Avg Duration", AppState.journal_avg_duration, "per trade"),
        columns="3",
        spacing="4",
        width="100%",
    )


def _equity_chart() -> rx.Component:
    """Equity curve chart with timeframe selector."""
    return card(
        rx.vstack(
            rx.hstack(
                rx.text(
                    "Equity Curve",
                    font_size="0.8rem",
                    font_weight="600",
                    color="#525252",
                    text_transform="uppercase",
                    letter_spacing="0.05em",
                ),
                rx.spacer(),
                rx.select(
                    ["7", "30", "90"],
                    value=AppState.equity_days.to(str),
                    on_change=AppState.set_equity_days,
                    size="1",
                    variant="ghost",
                    color="#525252",
                ),
                width="100%",
                align="center",
            ),
            rx.cond(
                AppState.journal_equity_data.length() > 0,
                rx.recharts.area_chart(
                    rx.recharts.area(
                        data_key="value",
                        stroke="#4ade80",
                        fill="url(#equityGradient)",
                        type_="monotone",
                    ),
                    rx.recharts.x_axis(
                        data_key="date",
                        tick={"fontSize": 10, "fill": "#525252"},
                        stroke="#1a1a1a",
                    ),
                    rx.recharts.y_axis(
                        tick={"fontSize": 10, "fill": "#525252"},
                        stroke="#1a1a1a",
                        width=60,
                    ),
                    rx.recharts.cartesian_grid(
                        stroke_dasharray="3 3",
                        stroke="#1a1a1a",
                    ),
                    rx.recharts.graphing_tooltip(
                        content_style={"backgroundColor": "#111111", "border": "1px solid #1a1a1a", "borderRadius": "8px", "fontSize": "0.8rem"},
                        label_style={"color": "#525252", "fontSize": "0.7rem"},
                        item_style={"color": "#fafafa"},
                    ),
                    rx.el.defs(
                        rx.el.linear_gradient(
                            rx.el.stop(offset="5%", stop_color="#4ade80", stop_opacity=0.3),
                            rx.el.stop(offset="95%", stop_color="#4ade80", stop_opacity=0.0),
                            id="equityGradient",
                            x1="0", y1="0", x2="0", y2="1",
                        ),
                    ),
                    data=AppState.journal_equity_data,
                    width="100%",
                    height=250,
                ),
                rx.center(
                    rx.text(
                        "No equity data yet — chart populates after daemon runs",
                        font_size="0.85rem",
                        color="#525252",
                    ),
                    height="200px",
                ),
            ),
            spacing="3",
            width="100%",
        ),
        width="100%",
    )


def _pnl_mode_toggle() -> rx.Component:
    """Small % / $ pill toggle — switches PnL column between ROE % and dollar amount."""
    return rx.hstack(
        rx.box(
            rx.text(
                "%",
                font_size="0.7rem",
                font_weight="600",
                color=rx.cond(AppState.journal_pnl_mode == "pct", "#fafafa", "#525252"),
                line_height="1",
            ),
            on_click=AppState.set_journal_pnl_mode("pct"),
            padding_x="7px",
            padding_y="3px",
            cursor="pointer",
            background=rx.cond(AppState.journal_pnl_mode == "pct", "#262626", "transparent"),
            border_radius="4px",
            transition="background 0.15s ease",
        ),
        rx.box(
            rx.text(
                "$",
                font_size="0.7rem",
                font_weight="600",
                color=rx.cond(AppState.journal_pnl_mode == "usd", "#fafafa", "#525252"),
                line_height="1",
            ),
            on_click=AppState.set_journal_pnl_mode("usd"),
            padding_x="7px",
            padding_y="3px",
            cursor="pointer",
            background=rx.cond(AppState.journal_pnl_mode == "usd", "#262626", "transparent"),
            border_radius="4px",
            transition="background 0.15s ease",
        ),
        spacing="0",
        background="#111111",
        border="1px solid #1a1a1a",
        border_radius="6px",
        padding="2px",
    )


def _trade_row(trade: ClosedTrade) -> rx.Component:
    """Single trade row — clickable to expand details."""
    # Fee losses get amber — directionally correct but fees ate profit
    pnl_color = rx.cond(
        trade.fee_loss,
        "#fbbf24",  # amber for fee losses
        rx.cond(trade.pnl_usd > 0, "#4ade80", "#f87171"),
    )
    side_color = rx.cond(trade.side == "long", "#4ade80", "#f87171")
    is_expanded = AppState.journal_expanded_trades.contains(trade.trade_id)
    # Trade type dot color
    type_color = rx.cond(
        trade.trade_type == "micro",
        "#a855f7",
        rx.cond(trade.trade_type == "macro", "#3b82f6", "transparent"),
    )

    return rx.box(
        # Summary row (always visible)
        rx.hstack(
            # Chevron
            rx.icon(
                rx.cond(is_expanded, "chevron-down", "chevron-right"),
                size=12,
                color="#525252",
                flex_shrink="0",
            ),
            # Type dot
            rx.box(
                width="6px",
                height="6px",
                border_radius="50%",
                background=type_color,
                flex_shrink="0",
            ),
            # Date
            rx.text(
                trade.date,
                font_size="0.8rem",
                color="#737373",
                min_width="80px",
            ),
            # Symbol
            rx.text(
                trade.symbol,
                font_size="0.85rem",
                font_weight="500",
                color="#fafafa",
                min_width="50px",
            ),
            # Side
            rx.text(
                trade.side.upper(),
                font_size="0.75rem",
                font_weight="500",
                color=side_color,
                min_width="55px",
            ),
            # Entry
            rx.text(
                "$" + trade.entry_px.to(str),
                font_size="0.8rem",
                color="#a3a3a3",
                min_width="80px",
                font_family="JetBrains Mono",
            ),
            # Exit
            rx.text(
                "$" + trade.exit_px.to(str),
                font_size="0.8rem",
                color="#a3a3a3",
                min_width="80px",
                font_family="JetBrains Mono",
            ),
            # PnL — toggles between ROE % and dollar amount
            rx.hstack(
                rx.cond(
                    AppState.journal_pnl_mode == "pct",
                    rx.cond(
                        (trade.lev_return_pct == 0.0) & (trade.pnl_usd != 0.0),
                        rx.text(
                            "—",
                            font_size="0.8rem",
                            color="#525252",
                            font_family="JetBrains Mono",
                        ),
                        rx.text(
                            trade.lev_return_pct.to(str) + "%",
                            font_size="0.8rem",
                            font_weight="500",
                            color=pnl_color,
                            font_family="JetBrains Mono",
                        ),
                    ),
                    rx.text(
                        rx.cond(trade.pnl_usd < 0, "-$", "+$")
                        + rx.cond(trade.pnl_usd < 0, (-trade.pnl_usd).to(str), trade.pnl_usd.to(str)),
                        font_size="0.8rem",
                        font_weight="500",
                        color=pnl_color,
                        font_family="JetBrains Mono",
                    ),
                ),
                rx.cond(
                    trade.fee_loss,
                    rx.text(
                        "FEE",
                        font_size="0.55rem",
                        font_weight="600",
                        color="#fbbf24",
                        padding_x="3px",
                        padding_y="1px",
                        border="1px solid #fbbf24",
                        border_radius="3px",
                        line_height="1",
                    ),
                    rx.fragment(),
                ),
                rx.cond(
                    trade.fee_heavy,
                    rx.text(
                        "FEES",
                        font_size="0.55rem",
                        font_weight="600",
                        color="#f97316",
                        padding_x="3px",
                        padding_y="1px",
                        border="1px solid #f97316",
                        border_radius="3px",
                        line_height="1",
                    ),
                    rx.fragment(),
                ),
                min_width="85px",
                spacing="1",
                align="center",
            ),
            # Peak — toggles between ROE % and dollar amount
            # Green  = peak cleared fee break-even (mfe_pct > 0.07 × leverage)
            # Amber  = peaked in profit but never enough to cover fees (fee trap)
            # Gray   = leverage unknown (old trade) or no favorable excursion
            rx.cond(
                AppState.journal_pnl_mode == "pct",
                rx.cond(
                    trade.mfe_pct > 0,
                    rx.text(
                        "+" + trade.mfe_pct.to(str) + "%",
                        font_size="0.8rem",
                        font_weight="500",
                        color=rx.cond(
                            trade.leverage == 0,
                            "#525252",  # unknown leverage — don't mislead
                            rx.cond(
                                trade.mfe_pct > (trade.leverage * 0.07),
                                "#4ade80",   # fee-profitable at peak
                                "#fbbf24",   # fee trap — peaked but below break-even
                            ),
                        ),
                        min_width="70px",
                        font_family="JetBrains Mono",
                    ),
                    rx.text("—", font_size="0.8rem", color="#525252", min_width="70px"),
                ),
                rx.cond(
                    trade.mfe_usd > 0,
                    rx.text(
                        "+$" + trade.mfe_usd.to(str),
                        font_size="0.8rem",
                        font_weight="500",
                        color=rx.cond(
                            trade.leverage == 0,
                            "#525252",
                            rx.cond(
                                trade.mfe_pct > (trade.leverage * 0.07),
                                "#4ade80",
                                "#fbbf24",
                            ),
                        ),
                        min_width="70px",
                        font_family="JetBrains Mono",
                    ),
                    rx.text("—", font_size="0.8rem", color="#525252", min_width="70px"),
                ),
            ),
            # Duration
            rx.text(
                trade.duration_str,
                font_size="0.8rem",
                color="#737373",
                min_width="50px",
                font_family="JetBrains Mono",
            ),
            width="100%",
            align="center",
            spacing="2",
        ),
        # Detail panel (only when expanded)
        rx.cond(
            is_expanded & (trade.detail_html != ""),
            rx.box(
                rx.html(trade.detail_html),
                padding="0.75rem 1rem",
                margin_left="20px",
                background="#0a0a0a",
                border="1px solid #1a1a1a",
                border_radius="6px",
                margin_top="4px",
            ),
            rx.fragment(),
        ),
        on_click=AppState.toggle_trade_detail(trade.trade_id),
        cursor="pointer",
        padding_y="0.5rem",
        border_bottom="1px solid #1a1a1a",
        width="100%",
        _hover={"background": "#0d0d0d"},
        transition="background 0.1s ease",
    )


def _trade_table() -> rx.Component:
    """Scrollable trade history table."""
    return card(
        rx.vstack(
            rx.hstack(
                rx.text(
                    "Trade History",
                    font_size="0.8rem",
                    font_weight="600",
                    color="#525252",
                    text_transform="uppercase",
                    letter_spacing="0.05em",
                ),
                rx.spacer(),
                _pnl_mode_toggle(),
                width="100%",
                align="center",
            ),
            # Header
            rx.hstack(
                rx.box(width="12px", flex_shrink="0"),  # chevron spacer
                rx.box(width="6px", flex_shrink="0"),  # type dot spacer
                rx.text("Date", font_size="0.7rem", color="#525252", min_width="80px"),
                rx.text("Symbol", font_size="0.7rem", color="#525252", min_width="50px"),
                rx.text("Side", font_size="0.7rem", color="#525252", min_width="55px"),
                rx.text("Entry", font_size="0.7rem", color="#525252", min_width="80px"),
                rx.text("Exit", font_size="0.7rem", color="#525252", min_width="80px"),
                rx.cond(
                    AppState.journal_pnl_mode == "pct",
                    rx.text("ROE %", font_size="0.7rem", color="#525252", min_width="85px"),
                    rx.text("PnL $", font_size="0.7rem", color="#525252", min_width="85px"),
                ),
                rx.cond(
                    AppState.journal_pnl_mode == "pct",
                    rx.text("Peak ROE", font_size="0.7rem", color="#525252", min_width="70px"),
                    rx.text("Peak $", font_size="0.7rem", color="#525252", min_width="70px"),
                ),
                rx.text("Duration", font_size="0.7rem", color="#525252", min_width="50px"),
                width="100%",
                padding_y="0.5rem",
                border_bottom="1px solid #262626",
                spacing="2",
            ),
            # Rows
            rx.cond(
                AppState.closed_trades.length() > 0,
                rx.vstack(
                    rx.box(
                        rx.foreach(AppState.closed_trades, _trade_row),
                        max_height=rx.cond(AppState.journal_show_all_trades, "none", "300px"),
                        overflow_y="auto",
                        width="100%",
                    ),
                    rx.box(
                        rx.text(
                            rx.cond(AppState.journal_show_all_trades, "Collapse", "Show all"),
                            font_size="0.72rem",
                            color="#525252",
                            _hover={"color": "#a3a3a3"},
                        ),
                        on_click=AppState.toggle_show_all_trades,
                        cursor="pointer",
                        padding_top="6px",
                        text_align="center",
                        width="100%",
                    ),
                    spacing="0",
                    width="100%",
                ),
                rx.center(
                    rx.text(
                        "No closed trades yet",
                        font_size="0.85rem",
                        color="#525252",
                    ),
                    padding="2rem",
                ),
            ),
            spacing="2",
            width="100%",
        ),
        width="100%",
    )


def _symbol_row(item: dict) -> rx.Component:
    """Single row in per-symbol breakdown table."""
    pnl_color = rx.cond(item["pnl_positive"], "#4ade80", "#f87171")

    return rx.hstack(
        rx.text(
            item["symbol"],
            font_size="0.85rem",
            font_weight="500",
            color="#fafafa",
            min_width="60px",
        ),
        rx.text(
            item["trades"].to(str),
            font_size="0.8rem",
            color="#a3a3a3",
            min_width="60px",
        ),
        rx.text(
            item["win_rate"].to(str) + "%",
            font_size="0.8rem",
            color="#a3a3a3",
            min_width="70px",
            font_family="JetBrains Mono",
        ),
        rx.text(
            item["pnl"],
            font_size="0.8rem",
            font_weight="500",
            color=pnl_color,
            min_width="80px",
            font_family="JetBrains Mono",
        ),
        width="100%",
        padding_y="0.4rem",
        border_bottom="1px solid #1a1a1a",
        align="center",
    )


def _symbol_breakdown() -> rx.Component:
    """Per-symbol performance breakdown table."""
    return card(
        rx.vstack(
            rx.text(
                "By Symbol",
                font_size="0.8rem",
                font_weight="600",
                color="#525252",
                text_transform="uppercase",
                letter_spacing="0.05em",
            ),
            # Header
            rx.hstack(
                rx.text("Symbol", font_size="0.7rem", color="#525252", min_width="60px"),
                rx.text("Trades", font_size="0.7rem", color="#525252", min_width="60px"),
                rx.text("Win Rate", font_size="0.7rem", color="#525252", min_width="70px"),
                rx.text("PnL", font_size="0.7rem", color="#525252", min_width="80px"),
                width="100%",
                padding_y="0.5rem",
                border_bottom="1px solid #262626",
            ),
            rx.cond(
                AppState.symbol_breakdown.length() > 0,
                rx.foreach(AppState.symbol_breakdown, _symbol_row),
                rx.center(
                    rx.text("—", color="#525252"),
                    padding="1rem",
                ),
            ),
            spacing="2",
            width="100%",
        ),
        width="100%",
    )


def _trades_content() -> rx.Component:
    """Existing trades tab content — stats, equity, tables."""
    return rx.vstack(
        _stats_row(),
        _equity_chart(),
        rx.hstack(
            rx.box(_trade_table(), flex="2"),
            rx.box(_symbol_breakdown(), flex="1"),
            width="100%",
            spacing="4",
            align="start",
        ),
        spacing="5",
        width="100%",
    )


# ================================================================
# Regret Tab (new)
# ================================================================

def _regret_stats_row() -> rx.Component:
    """3 stat cards: Missed, Good Passes, Miss Rate."""
    return rx.grid(
        stat_card(
            "Missed",
            AppState.regret_missed_count,
            "would have won",
            value_color="#f87171",
        ),
        stat_card(
            "Good Passes",
            AppState.regret_good_pass_count,
            "correctly avoided",
            value_color="#4ade80",
        ),
        stat_card(
            "Miss Rate",
            AppState.regret_miss_rate,
            "missed / total",
            value_color=rx.cond(
                AppState.regret_miss_rate.contains("—"),
                "#fafafa",
                rx.cond(
                    AppState.regret_miss_rate_high,
                    "#f87171",
                    "#4ade80",
                ),
            ),
        ),
        columns="3",
        spacing="4",
        width="100%",
    )


def _phantom_row(phantom: PhantomRecord) -> rx.Component:
    """Single row in phantom history table — clickable to expand details."""
    result_color = rx.cond(
        phantom.result == "missed_opportunity",
        "#f87171",
        "#4ade80",
    )
    result_label = rx.cond(
        phantom.result == "missed_opportunity",
        "MISSED",
        "GOOD PASS",
    )
    pnl_color = rx.cond(phantom.pnl_pct > 0, "#4ade80", "#f87171")
    side_color = rx.cond(phantom.side == "long", "#4ade80", "#f87171")
    is_expanded = AppState.journal_expanded_phantoms.contains(phantom.phantom_id)

    return rx.box(
        # Summary row
        rx.hstack(
            rx.icon(
                rx.cond(is_expanded, "chevron-down", "chevron-right"),
                size=12,
                color="#525252",
                flex_shrink="0",
            ),
            rx.text(
                phantom.date,
                font_size="0.8rem",
                color="#737373",
                min_width="80px",
            ),
            rx.text(
                phantom.symbol,
                font_size="0.85rem",
                font_weight="500",
                color="#fafafa",
                min_width="50px",
            ),
            rx.text(
                phantom.side.upper(),
                font_size="0.75rem",
                font_weight="500",
                color=side_color,
                min_width="50px",
            ),
            rx.text(
                result_label,
                font_size="0.75rem",
                font_weight="600",
                color=result_color,
                min_width="85px",
            ),
            rx.text(
                phantom.pnl_pct.to(str) + "%",
                font_size="0.8rem",
                font_weight="500",
                color=pnl_color,
                min_width="60px",
                font_family="JetBrains Mono",
            ),
            rx.text(
                phantom.anomaly_type,
                font_size="0.8rem",
                color="#a3a3a3",
                min_width="90px",
            ),
            rx.text(
                phantom.category,
                font_size="0.75rem",
                color="#525252",
                min_width="50px",
            ),
            width="100%",
            align="center",
            spacing="2",
        ),
        # Detail panel
        rx.cond(
            is_expanded & (phantom.detail_html != ""),
            rx.box(
                rx.html(phantom.detail_html),
                padding="0.75rem 1rem",
                margin_left="20px",
                background="#0a0a0a",
                border="1px solid #1a1a1a",
                border_radius="6px",
                margin_top="4px",
            ),
            rx.fragment(),
        ),
        on_click=AppState.toggle_phantom_detail(phantom.phantom_id),
        cursor="pointer",
        padding_y="0.5rem",
        border_bottom="1px solid #1a1a1a",
        width="100%",
        _hover={"background": "#0d0d0d"},
        transition="background 0.1s ease",
    )


def _phantom_table() -> rx.Component:
    """Phantom history table."""
    return card(
        rx.vstack(
            rx.text(
                "Phantom History",
                font_size="0.8rem",
                font_weight="600",
                color="#525252",
                text_transform="uppercase",
                letter_spacing="0.05em",
            ),
            # Header
            rx.hstack(
                rx.box(width="12px", flex_shrink="0"),  # chevron spacer
                rx.text("Date", font_size="0.7rem", color="#525252", min_width="80px"),
                rx.text("Symbol", font_size="0.7rem", color="#525252", min_width="50px"),
                rx.text("Side", font_size="0.7rem", color="#525252", min_width="50px"),
                rx.text("Result", font_size="0.7rem", color="#525252", min_width="85px"),
                rx.text("PnL %", font_size="0.7rem", color="#525252", min_width="60px"),
                rx.text("Signal", font_size="0.7rem", color="#525252", min_width="90px"),
                rx.text("Type", font_size="0.7rem", color="#525252", min_width="50px"),
                width="100%",
                padding_y="0.5rem",
                border_bottom="1px solid #262626",
                spacing="2",
            ),
            rx.cond(
                AppState.regret_phantoms.length() > 0,
                rx.vstack(
                    rx.box(
                        rx.foreach(AppState.regret_phantoms, _phantom_row),
                        max_height=rx.cond(AppState.journal_show_all_phantoms, "none", "350px"),
                        overflow_y="auto",
                        width="100%",
                    ),
                    rx.box(
                        rx.text(
                            rx.cond(AppState.journal_show_all_phantoms, "Collapse", "Show all"),
                            font_size="0.72rem",
                            color="#525252",
                            _hover={"color": "#a3a3a3"},
                        ),
                        on_click=AppState.toggle_show_all_phantoms,
                        cursor="pointer",
                        padding_top="6px",
                        text_align="center",
                        width="100%",
                    ),
                    spacing="0",
                    width="100%",
                ),
                rx.center(
                    rx.text(
                        "No phantom data yet — phantoms are created when the agent passes on scanner alerts",
                        font_size="0.85rem",
                        color="#525252",
                    ),
                    padding="2rem",
                ),
            ),
            spacing="2",
            width="100%",
        ),
        width="100%",
    )


def _playbook_entry(pb: PlaybookRecord) -> rx.Component:
    """Single playbook card entry."""
    return rx.box(
        rx.vstack(
            rx.hstack(
                rx.text(
                    pb.title,
                    font_size="0.85rem",
                    font_weight="500",
                    color="#fafafa",
                ),
                rx.spacer(),
                rx.text(
                    pb.date,
                    font_size="0.75rem",
                    color="#525252",
                ),
                width="100%",
                align="center",
            ),
            rx.text(
                pb.content,
                font_size="0.8rem",
                color="#a3a3a3",
                line_height="1.5",
                no_of_lines=4,
            ),
            spacing="2",
            width="100%",
        ),
        padding="0.75rem",
        border_bottom="1px solid #1a1a1a",
        width="100%",
    )


def _playbook_list() -> rx.Component:
    """Playbook library card."""
    return card(
        rx.vstack(
            rx.text(
                "Playbook Library",
                font_size="0.8rem",
                font_weight="600",
                color="#525252",
                text_transform="uppercase",
                letter_spacing="0.05em",
            ),
            rx.cond(
                AppState.regret_playbooks.length() > 0,
                rx.box(
                    rx.foreach(AppState.regret_playbooks, _playbook_entry),
                    max_height="400px",
                    overflow_y="auto",
                    width="100%",
                ),
                rx.center(
                    rx.text(
                        "No playbooks yet — playbooks are stored after profitable trade closes",
                        font_size="0.85rem",
                        color="#525252",
                    ),
                    padding="2rem",
                ),
            ),
            spacing="2",
            width="100%",
        ),
        width="100%",
    )


def _regret_content() -> rx.Component:
    """Regret tab — phantom stats, history table, playbook library."""
    return rx.vstack(
        _regret_stats_row(),
        _phantom_table(),
        _playbook_list(),
        spacing="5",
        width="100%",
    )


# ================================================================
# Page
# ================================================================

def _tab_pill(label: str, tab_value: str) -> rx.Component:
    """Single pill in the segmented tab bar."""
    return rx.box(
        rx.text(
            label,
            font_size="0.8rem",
            font_weight="500",
            color=rx.cond(
                AppState.journal_tab == tab_value,
                "#fafafa",
                "#525252",
            ),
            transition="color 0.15s ease",
        ),
        on_click=AppState.set_journal_tab(tab_value),
        background=rx.cond(
            AppState.journal_tab == tab_value,
            "#262626",
            "transparent",
        ),
        padding_x="14px",
        padding_y="6px",
        border_radius="8px",
        cursor="pointer",
        transition="background 0.15s ease",
        _hover={"background": rx.cond(
            AppState.journal_tab == tab_value,
            "#262626",
            "#1a1a1a",
        )},
    )


def _tab_bar() -> rx.Component:
    """Segmented tab bar — Trades / Regret."""
    return rx.hstack(
        _tab_pill("Trades", "trades"),
        _tab_pill("Regret", "regret"),
        spacing="1",
        background="#111111",
        border="1px solid #1a1a1a",
        border_radius="10px",
        padding="3px",
    )


def journal_page() -> rx.Component:
    """Journal page — performance stats, equity curve, trade history, regret tracker."""
    return rx.box(
        rx.vstack(
            # Header row: title left, tabs center, refresh right
            rx.hstack(
                rx.text(
                    "Trade Journal",
                    font_size="1.25rem",
                    font_weight="600",
                    color="#fafafa",
                    flex_shrink="0",
                ),
                rx.spacer(),
                _tab_bar(),
                rx.spacer(),
                rx.box(
                    rx.icon(
                        "refresh-cw",
                        size=14,
                        color="#525252",
                        cursor="pointer",
                        _hover={"color": "#a3a3a3"},
                    ),
                    on_click=AppState.load_journal,
                    padding="6px",
                    border_radius="6px",
                    cursor="pointer",
                    flex_shrink="0",
                    _hover={"background": "#1a1a1a"},
                    transition="background 0.15s ease",
                ),
                width="100%",
                align="center",
            ),

            # Tab content
            rx.cond(
                AppState.journal_tab == "trades",
                _trades_content(),
                _regret_content(),
            ),

            spacing="5",
            width="100%",
            max_width="1000px",
            margin_x="auto",
            padding="1.5rem",
        ),
        width="100%",
        height="100%",
        overflow_y="auto",
    )
