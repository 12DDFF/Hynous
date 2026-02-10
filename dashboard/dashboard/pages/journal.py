"""Journal page — Trade history, equity curve, and performance stats."""

import reflex as rx
from ..state import AppState, ClosedTrade
from ..components import card, stat_card


def _stats_row() -> rx.Component:
    """Top row — 4 stat cards."""
    return rx.hstack(
        stat_card("Win Rate", AppState.journal_win_rate, "closed trades"),
        stat_card(
            "Total PnL",
            AppState.journal_total_pnl,
            "realized",
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
        width="100%",
        spacing="4",
    )


def _equity_chart() -> rx.Component:
    """Equity curve chart (30-day area chart)."""
    return card(
        rx.vstack(
            rx.text(
                "Equity Curve",
                font_size="0.8rem",
                font_weight="600",
                color="#525252",
                text_transform="uppercase",
                letter_spacing="0.05em",
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
                        content_style={"backgroundColor": "#111111", "border": "1px solid #1a1a1a"},
                    ),
                    rx.el.defs(
                        rx.el.linearGradient(
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


def _trade_row(trade: ClosedTrade) -> rx.Component:
    """Single trade row in the history table."""
    pnl_color = rx.cond(trade.pnl_usd > 0, "#4ade80", "#f87171")
    side_color = rx.cond(trade.side == "long", "#4ade80", "#f87171")

    return rx.hstack(
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
        # PnL %
        rx.text(
            trade.pnl_pct.to(str) + "%",
            font_size="0.8rem",
            font_weight="500",
            color=pnl_color,
            min_width="60px",
            font_family="JetBrains Mono",
        ),
        # PnL $
        rx.text(
            "$" + trade.pnl_usd.to(str),
            font_size="0.8rem",
            font_weight="500",
            color=pnl_color,
            min_width="70px",
            font_family="JetBrains Mono",
        ),
        width="100%",
        padding_y="0.5rem",
        border_bottom="1px solid #1a1a1a",
        align="center",
    )


def _trade_table() -> rx.Component:
    """Scrollable trade history table."""
    return card(
        rx.vstack(
            rx.text(
                "Trade History",
                font_size="0.8rem",
                font_weight="600",
                color="#525252",
                text_transform="uppercase",
                letter_spacing="0.05em",
            ),
            # Header
            rx.hstack(
                rx.text("Date", font_size="0.7rem", color="#525252", min_width="80px"),
                rx.text("Symbol", font_size="0.7rem", color="#525252", min_width="50px"),
                rx.text("Side", font_size="0.7rem", color="#525252", min_width="55px"),
                rx.text("Entry", font_size="0.7rem", color="#525252", min_width="80px"),
                rx.text("Exit", font_size="0.7rem", color="#525252", min_width="80px"),
                rx.text("PnL %", font_size="0.7rem", color="#525252", min_width="60px"),
                rx.text("PnL $", font_size="0.7rem", color="#525252", min_width="70px"),
                width="100%",
                padding_y="0.5rem",
                border_bottom="1px solid #262626",
            ),
            # Rows
            rx.cond(
                AppState.closed_trades.length() > 0,
                rx.box(
                    rx.foreach(AppState.closed_trades, _trade_row),
                    max_height="300px",
                    overflow_y="auto",
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
    pnl_val = item["pnl"]
    pnl_color = rx.cond(pnl_val > 0, "#4ade80", "#f87171")

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
            "$" + pnl_val.to(str),
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


def journal_page() -> rx.Component:
    """Journal page — performance stats, equity curve, trade history."""
    return rx.box(
        rx.vstack(
            # Header
            rx.hstack(
                rx.text(
                    "Trade Journal",
                    font_size="1.25rem",
                    font_weight="600",
                    color="#fafafa",
                ),
                rx.spacer(),
                rx.button(
                    "Refresh",
                    on_click=AppState.load_journal,
                    size="1",
                    variant="ghost",
                    color="#525252",
                    cursor="pointer",
                ),
                width="100%",
                align="center",
            ),

            # Stats row
            _stats_row(),

            # Equity curve
            _equity_chart(),

            # Trade history + Symbol breakdown side by side on wider screens
            rx.hstack(
                rx.box(_trade_table(), flex="2"),
                rx.box(_symbol_breakdown(), flex="1"),
                width="100%",
                spacing="4",
                align="start",
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
