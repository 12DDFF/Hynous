"""Chat page — messages + activity sidebar."""

import reflex as rx
from ..state import AppState, Position, WakeItem
from ..components import chat_bubble, chat_input, typing_indicator, streaming_bubble, tool_indicator, ticker_badge


# ---------------------------------------------------------------------------
# Chat area (left)
# ---------------------------------------------------------------------------

def _welcome() -> rx.Component:
    """Welcome message when no chat history."""
    return rx.box(
        rx.vstack(
            rx.box(
                rx.text("H", font_size="1.75rem", font_weight="600", color="#a5b4fc"),
                width="72px",
                height="72px",
                border_radius="20px",
                background="linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
                display="flex",
                align_items="center",
                justify_content="center",
                box_shadow="0 4px 24px rgba(99, 102, 241, 0.2)",
            ),
            rx.heading("Hey, I'm Hynous", size="7", color="#fafafa", font_weight="600"),
            rx.text(
                "Your crypto trading partner. Ask me anything about markets, "
                "discuss trade ideas, or just chat about what's happening.",
                color="#525252",
                max_width="400px",
                text_align="center",
                line_height="1.6",
                font_size="0.95rem",
            ),
            spacing="4",
            align="center",
        ),
        display="flex",
        align_items="center",
        justify_content="center",
        flex="1",
        width="100%",
    )


def _messages() -> rx.Component:
    """Scrollable messages container with auto-scroll."""
    return rx.box(
        rx.box(
            rx.vstack(
                rx.foreach(AppState.messages, chat_bubble),
                # Loading state
                rx.cond(
                    AppState.is_loading,
                    rx.vstack(
                        rx.cond(
                            AppState.streaming_text != "",
                            streaming_bubble(AppState.streaming_display, AppState.streaming_show_avatar),
                            rx.fragment(),
                        ),
                        rx.cond(
                            AppState.active_tool != "",
                            tool_indicator(AppState.active_tool_display, AppState.active_tool_color),
                            rx.cond(
                                AppState.streaming_text == "",
                                typing_indicator(),
                                rx.fragment(),
                            ),
                        ),
                        spacing="0",
                        width="100%",
                    ),
                    rx.box(),
                ),
                rx.box(id="chat-bottom"),
                width="100%",
                spacing="0",
            ),
            width="100%",
            max_width="960px",
            padding_x="24px",
            padding_y="24px",
            margin="0 auto",
        ),
        id="messages-container",
        flex="1",
        width="100%",
        overflow_y="auto",
        overscroll_behavior="none",
        style={
            "scrollbar_width": "none",
            "&::-webkit-scrollbar": {"display": "none"},
        },
    )


def _input() -> rx.Component:
    """Fixed input area at bottom."""
    return rx.box(
        rx.vstack(
            rx.box(
                chat_input(
                    on_submit=AppState.send_message,
                    is_loading=AppState.is_loading,
                    on_stop=AppState.stop_generation,
                ),
                width="100%",
                max_width="960px",
            ),
            rx.text(
                "Hynous can make mistakes. Always verify important information.",
                font_size="0.65rem",
                color="#333",
                text_align="center",
                padding_top="8px",
            ),
            width="100%",
            align="center",
            spacing="0",
            padding_x="24px",
        ),
        width="100%",
        padding_y="16px",
        background="#0a0a0a",
        border_top="1px solid #141414",
    )


# ---------------------------------------------------------------------------
# Sidebar primitives
# ---------------------------------------------------------------------------

def _label(text: str) -> rx.Component:
    """Section header in sidebar."""
    return rx.text(
        text,
        font_size="0.6rem",
        font_weight="600",
        color="#404040",
        text_transform="uppercase",
        letter_spacing="0.06em",
    )


def _sep() -> rx.Component:
    """Horizontal separator."""
    return rx.box(width="100%", height="1px", background="#1a1a1a")


def _stat_line(label: str, value) -> rx.Component:
    """Key-value stat row."""
    return rx.hstack(
        rx.text(label, font_size="0.68rem", color="#525252"),
        rx.spacer(),
        rx.text(
            value,
            font_size="0.7rem",
            color="#a3a3a3",
            font_family="JetBrains Mono, monospace",
        ),
        width="100%",
        align="center",
    )


# ---------------------------------------------------------------------------
# Sidebar sections
# ---------------------------------------------------------------------------

def _status_section() -> rx.Component:
    """Agent + Daemon status in one compact row."""
    return rx.hstack(
        # Agent
        rx.hstack(
            rx.box(
                width="6px",
                height="6px",
                border_radius="50%",
                background=AppState.agent_status_color,
                flex_shrink="0",
            ),
            rx.text("Agent", font_size="0.65rem", color="#525252"),
            rx.text(AppState.agent_status_display, font_size="0.68rem", color="#a3a3a3"),
            spacing="1",
            align="center",
        ),
        rx.spacer(),
        # Daemon
        rx.hstack(
            rx.box(
                width="6px",
                height="6px",
                border_radius="50%",
                background=AppState.daemon_status_color,
                flex_shrink="0",
            ),
            rx.text(AppState.daemon_status_text, font_size="0.68rem", color="#a3a3a3"),
            spacing="1",
            align="center",
        ),
        width="100%",
        align="center",
    )


def _position_row(pos: Position) -> rx.Component:
    """Single position in sidebar — clickable to expand chart."""
    return rx.hstack(
        rx.icon(
            rx.cond(AppState.expanded_position == pos.symbol, "chevron-down", "chevron-right"),
            size=12,
            color="#525252",
            flex_shrink="0",
        ),
        ticker_badge(pos.symbol, font_size="0.7rem", font_weight="600"),
        rx.text(
            pos.side.upper(),
            font_size="0.58rem",
            font_weight="600",
            color=rx.cond(pos.side == "long", "#22c55e", "#ef4444"),
        ),
        rx.spacer(),
        rx.text(
            pos.pnl.to(str) + "%",
            font_size="0.7rem",
            font_weight="500",
            color=rx.cond(pos.pnl >= 0, "#22c55e", "#ef4444"),
            font_family="JetBrains Mono, monospace",
        ),
        rx.cond(
            pos.realized_pnl != 0,
            rx.text(
                rx.cond(pos.realized_pnl >= 0, "+$", "-$")
                + rx.cond(pos.realized_pnl >= 0, pos.realized_pnl, pos.realized_pnl * -1).to(str),
                font_size="0.55rem",
                color=rx.cond(pos.realized_pnl >= 0, "#4ade80", "#f87171"),
            ),
            rx.fragment(),
        ),
        width="100%",
        align="center",
        spacing="2",
        padding_y="2px",
        padding_x="4px",
        cursor="pointer",
        border_radius="4px",
        _hover={"background": "#141414"},
        on_click=AppState.toggle_position_chart(pos.symbol),
    )


def _position_chart_panel() -> rx.Component:
    """Expandable chart panel below position rows."""
    return rx.cond(
        AppState.expanded_position != "",
        rx.vstack(
            rx.cond(
                AppState.position_chart_loading,
                rx.hstack(
                    rx.spinner(size="1"),
                    rx.text("Loading chart...", font_size="0.65rem", color="#525252"),
                    spacing="2",
                    align="center",
                    padding="8px 4px",
                ),
                rx.fragment(),
            ),
            rx.cond(
                AppState.position_chart_html != "",
                rx.html(AppState.position_chart_html),
                rx.fragment(),
            ),
            spacing="0",
            width="100%",
        ),
        rx.fragment(),
    )


def _positions_section() -> rx.Component:
    """Positions — only rendered when positions exist."""
    return rx.cond(
        AppState.positions.length() > 0,
        rx.vstack(
            _label("Positions"),
            rx.vstack(
                rx.foreach(AppState.positions, _position_row),
                spacing="1",
                width="100%",
            ),
            _position_chart_panel(),
            spacing="2",
            width="100%",
        ),
        rx.fragment(),
    )


def _scanner_section() -> rx.Component:
    """Scanner status indicator."""
    return rx.vstack(
        _label("Scanner"),
        rx.hstack(
            rx.box(
                width="6px",
                height="6px",
                border_radius="50%",
                background=AppState.scanner_status_color,
                flex_shrink="0",
            ),
            rx.text(
                AppState.scanner_status_text,
                font_size="0.72rem",
                color="#a3a3a3",
            ),
            spacing="2",
            align="center",
        ),
        rx.cond(
            AppState.scanner_subtitle != "",
            rx.text(
                AppState.scanner_subtitle,
                font_size="0.65rem",
                color="#525252",
            ),
            rx.fragment(),
        ),
        spacing="1",
        width="100%",
    )


def _dot_color(category):
    """Dot color by wake category."""
    return rx.cond(
        category == "scanner", "#2dd4bf",
        rx.cond(
            category == "fill", "#22c55e",
            rx.cond(
                category == "review", "#818cf8",
                rx.cond(
                    category == "error", "#ef4444",
                    rx.cond(
                        category == "watchpoint", "#fbbf24",
                        "#60a5fa",
                    )
                )
            )
        )
    )


def _decision_chip(decision: rx.Var[str]) -> rx.Component:
    """Colored chip showing agent decision (TRADE/MONITOR/MANAGE/PASS)."""
    color = rx.match(
        decision,
        ("trade", "#22c55e"),
        ("monitor", "#f59e0b"),
        ("manage", "#a78bfa"),
        "#525252",
    )
    bg = rx.match(
        decision,
        ("trade", "rgba(34,197,94,0.12)"),
        ("monitor", "rgba(245,158,11,0.12)"),
        ("manage", "rgba(167,139,250,0.12)"),
        "rgba(64,64,64,0.12)",
    )
    label = rx.match(
        decision,
        ("trade", "TRADE"),
        ("monitor", "MONITOR"),
        ("manage", "MANAGE"),
        "PASS",
    )
    return rx.box(
        rx.text(label, font_size="0.55rem", font_weight="700", color=color, letter_spacing="0.06em"),
        padding="1px 5px",
        border_radius="3px",
        background=bg,
    )


def _wake_row(item: WakeItem) -> rx.Component:
    """Single wake event — click to view full details."""
    color = _dot_color(item.category)
    return rx.hstack(
        rx.box(
            width="5px",
            height="5px",
            border_radius="50%",
            background=color,
            flex_shrink="0",
            margin_top="5px",
        ),
        rx.vstack(
            rx.text(
                item.timestamp,
                font_size="0.58rem",
                color="#333",
                font_family="JetBrains Mono, monospace",
            ),
            rx.text(
                item.content,
                font_size="0.72rem",
                color="#737373",
                overflow="hidden",
                text_overflow="ellipsis",
                white_space="nowrap",
                max_width="100%",
            ),
            spacing="0",
            flex="1",
            min_width="0",
        ),
        rx.cond(item.decision != "", _decision_chip(item.decision), rx.fragment()),
        spacing="2",
        width="100%",
        align="start",
        padding_y="3px",
        cursor="pointer",
        border_radius="4px",
        _hover={"background": "#141414"},
        on_click=AppState.view_wake_detail(
            item.full_content, item.category, item.timestamp,
            item.tool_trace_text, item.signal_header, item.decision,
        ),
    )


def _watches_section() -> rx.Component:
    """Pulsing indicator when monitor_signal watches are active."""
    return rx.cond(
        AppState.active_watches.length() > 0,
        rx.vstack(
            rx.hstack(
                rx.box(
                    width="6px",
                    height="6px",
                    border_radius="50%",
                    background="#f59e0b",
                    style={"animation": "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite"},
                ),
                _label("Watching"),
                spacing="2",
                align="center",
            ),
            rx.foreach(
                AppState.active_watches,
                lambda w: rx.text(
                    w,
                    font_size="0.7rem",
                    color="#a3a3a3",
                    font_family="JetBrains Mono, monospace",
                ),
            ),
            spacing="1",
            width="100%",
            padding_bottom="0.5rem",
        ),
        rx.fragment(),
    )


def _activity_section() -> rx.Component:
    """Scrollable activity feed — newest events first."""
    return rx.box(
        rx.vstack(
            _label("Activity"),
            rx.cond(
                AppState.wake_feed.length() > 0,
                rx.vstack(
                    rx.foreach(AppState.wake_feed, _wake_row),
                    spacing="0",
                    width="100%",
                ),
                rx.text(
                    "No activity yet",
                    font_size="0.7rem",
                    color="#333",
                    font_style="italic",
                    padding_y="0.5rem",
                ),
            ),
            spacing="2",
            width="100%",
        ),
        flex="1",
        min_height="0",
        width="100%",
        overflow_y="auto",
        style={
            "scrollbar_width": "none",
            "&::-webkit-scrollbar": {"display": "none"},
        },
    )


def _stats_section() -> rx.Component:
    """Compact stats footer."""
    return rx.vstack(
        _label("Stats"),
        _stat_line("Daily PnL", AppState.daemon_daily_pnl),
        _stat_line("Wakes", AppState.daemon_wake_count),
        _stat_line("Next Review", AppState.daemon_next_review),
        _stat_line("Last Wake", AppState.daemon_last_wake_ago),
        spacing="1",
        width="100%",
    )


# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------

def _sidebar() -> rx.Component:
    """Right activity sidebar — status, positions, scanner, feed, stats."""
    return rx.box(
        # Top — fixed sections
        rx.vstack(
            _status_section(),
            _sep(),
            _positions_section(),
            rx.cond(
                AppState.positions.length() > 0,
                _sep(),
                rx.fragment(),
            ),
            _scanner_section(),
            _sep(),
            spacing="3",
            width="100%",
            flex_shrink="0",
        ),
        # Active watches indicator (only when monitor_signal is ticking)
        _watches_section(),
        # Middle — scrollable activity feed
        _activity_section(),
        # Bottom — pinned stats
        rx.vstack(
            _sep(),
            _stats_section(),
            spacing="3",
            width="100%",
            flex_shrink="0",
        ),
        width="280px",
        min_width="280px",
        height="100%",
        padding="0.75rem",
        border_left="1px solid #141414",
        background="#0c0c0c",
        display="flex",
        flex_direction="column",
        gap="0.5rem",
    )


# ---------------------------------------------------------------------------
# Wake detail dialog
# ---------------------------------------------------------------------------

def _wake_detail_dialog() -> rx.Component:
    """Dialog showing full wake response with tool trace and decision."""
    color = _dot_color(AppState.wake_detail_category)
    return rx.dialog.root(
        rx.dialog.content(
            rx.vstack(
                # 1. Header row
                rx.hstack(
                    rx.box(
                        width="8px",
                        height="8px",
                        border_radius="50%",
                        background=color,
                        flex_shrink="0",
                    ),
                    rx.text(
                        AppState.wake_detail_category.upper(),
                        font_size="0.7rem",
                        font_weight="600",
                        color=color,
                        letter_spacing="0.04em",
                    ),
                    rx.cond(
                        AppState.wake_detail_signal_header != "",
                        rx.text(
                            AppState.wake_detail_signal_header,
                            font_size="0.68rem",
                            color="#525252",
                            font_family="JetBrains Mono, monospace",
                        ),
                        rx.fragment(),
                    ),
                    rx.cond(
                        AppState.wake_detail_decision != "",
                        _decision_chip(AppState.wake_detail_decision),
                        rx.fragment(),
                    ),
                    rx.spacer(),
                    rx.text(
                        AppState.wake_detail_time,
                        font_size="0.65rem",
                        color="#404040",
                        font_family="JetBrains Mono, monospace",
                    ),
                    rx.dialog.close(
                        rx.icon(
                            "x",
                            size=16,
                            color="#525252",
                            cursor="pointer",
                            _hover={"color": "#fafafa"},
                        ),
                    ),
                    spacing="2",
                    align="center",
                    width="100%",
                ),
                # 2. Validation trace (only when present)
                rx.cond(
                    AppState.wake_detail_tool_trace_text != "",
                    rx.vstack(
                        rx.box(height="1px", background="#1f1f1f", width="100%"),
                        rx.text(
                            "VALIDATION TRACE",
                            font_size="0.6rem",
                            font_weight="600",
                            color="#3f3f3f",
                            letter_spacing="0.08em",
                        ),
                        rx.text(
                            AppState.wake_detail_tool_trace_text,
                            font_size="0.72rem",
                            color="#6b7280",
                            white_space="pre-wrap",
                            font_family="JetBrains Mono, monospace",
                            line_height="1.7",
                        ),
                        spacing="2",
                        width="100%",
                        align_items="start",
                    ),
                    rx.fragment(),
                ),
                # 3. Response as plain pre-wrap text (rx.markdown breaks on >> and > in agent text)
                rx.box(
                    rx.box(height="1px", background="#1f1f1f", width="100%", margin_bottom="0.5rem"),
                    rx.text(
                        AppState.wake_detail_content,
                        font_size="0.82rem",
                        color="#d4d4d4",
                        line_height="1.6",
                        white_space="pre-wrap",
                        style={"word_break": "break-word"},
                    ),
                    max_height="52vh",
                    overflow_y="auto",
                    width="100%",
                    style={
                        "scrollbar_width": "thin",
                        "scrollbar_color": "#262626 transparent",
                    },
                ),
                spacing="3",
                width="100%",
            ),
            max_width="560px",
            max_height="90vh",
            overflow_y="auto",
            background="#111111",
            border="1px solid #1a1a1a",
            border_radius="12px",
            padding="1.25rem",
            style={
                "scrollbar_width": "thin",
                "scrollbar_color": "#262626 transparent",
            },
        ),
        open=AppState.wake_detail_open,
        on_open_change=lambda _: AppState.close_wake_detail(),
    )


# ---------------------------------------------------------------------------
# Page
# ---------------------------------------------------------------------------

def chat_page() -> rx.Component:
    """Full-height chat layout with activity sidebar."""
    return rx.box(
        rx.hstack(
            # Main chat area
            rx.box(
                rx.vstack(
                    rx.cond(
                        AppState.messages.length() > 0,
                        _messages(),
                        _welcome(),
                    ),
                    _input(),
                    width="100%",
                    height="100%",
                    spacing="0",
                    align="center",
                ),
                flex="1",
                height="100%",
                background="#0a0a0a",
                display="flex",
                flex_direction="column",
                overflow="hidden",
            ),
            # Activity sidebar
            _sidebar(),
            spacing="0",
            width="100%",
            height="100%",
            overflow="hidden",
        ),
        # Wake detail dialog (rendered outside flex to avoid layout issues)
        _wake_detail_dialog(),
        width="100%",
        height="100%",
        position="relative",
    )
