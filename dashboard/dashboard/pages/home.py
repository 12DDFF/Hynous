"""Home page — Hynous profile + dashboard."""

import reflex as rx
from ..state import AppState, DaemonActivity
from ..components import stat_card


def _profile_avatar() -> rx.Component:
    """Large Hynous avatar for the profile card."""
    return rx.image(
        src="/hynous-avatar.png",
        width="80px",
        height="80px",
        border_radius="22px",
        object_fit="cover",
        box_shadow="0 4px 24px rgba(99, 102, 241, 0.25)",
    )


def _status_badge() -> rx.Component:
    """Status indicator: colored dot + text."""
    return rx.hstack(
        rx.box(
            width="8px",
            height="8px",
            border_radius="50%",
            background=AppState.agent_status_color,
            box_shadow=rx.cond(
                AppState.agent_status == "online",
                "0 0 6px rgba(34, 197, 94, 0.5)",
                "none",
            ),
        ),
        rx.text(
            AppState.agent_status_display,
            font_size="0.8rem",
            color="#a3a3a3",
        ),
        spacing="2",
        align="center",
    )


def _stat_column(value: rx.Var[str], label: str) -> rx.Component:
    """Single stat in the social-style stats row (non-clickable fallback)."""
    return rx.vstack(
        rx.text(value, font_size="1.25rem", font_weight="600", color="#fafafa"),
        rx.text(label, font_size="0.7rem", color="#525252"),
        spacing="0",
        align="center",
        flex="1",
    )


def _stat_with_dialog(
    value: rx.Var[str],
    label: str,
    dialog_title: str,
    dialog_content: rx.Component,
) -> rx.Component:
    """Clickable stat that opens a detail dialog."""
    return rx.dialog.root(
        rx.dialog.trigger(
            rx.vstack(
                rx.text(value, font_size="1.25rem", font_weight="600", color="#fafafa"),
                rx.text(label, font_size="0.7rem", color="#525252"),
                spacing="0",
                align="center",
                flex="1",
                cursor="pointer",
                _hover={"opacity": "0.7"},
                transition="opacity 0.15s ease",
            ),
        ),
        rx.dialog.content(
            rx.dialog.title(
                dialog_title,
                font_size="1rem",
                font_weight="600",
                color="#fafafa",
            ),
            dialog_content,
            rx.dialog.close(
                rx.button(
                    "Close",
                    variant="ghost",
                    color="#525252",
                    cursor="pointer",
                    _hover={"color": "#a3a3a3"},
                ),
            ),
            background="#111111",
            border="1px solid #1a1a1a",
            border_radius="14px",
            padding="1.25rem",
            max_width="380px",
        ),
    )


# Per-tool accent colors (matches chat.py tag colors)
_TOOL_COLORS = {
    "get_market_data": ("#60a5fa", "rgba(96,165,250,0.12)"),     # blue
    "get_orderbook": ("#22d3ee", "rgba(34,211,238,0.12)"),       # cyan
    "get_funding_history": ("#fbbf24", "rgba(251,191,36,0.12)"), # amber
    "get_multi_timeframe": ("#a78bfa", "rgba(167,139,250,0.12)"),# purple
    "get_liquidations": ("#fb923c", "rgba(251,146,60,0.12)"),    # orange
    "get_global_sentiment": ("#2dd4bf", "rgba(45,212,191,0.12)"),# teal
    "get_options_flow": ("#f472b6", "rgba(244,114,182,0.12)"),   # pink
    "get_institutional_flow": ("#34d399", "rgba(52,211,153,0.12)"),# emerald
    "search_web": ("#e879f9", "rgba(232,121,249,0.12)"),          # fuchsia
    "get_my_costs": ("#94a3b8", "rgba(148,163,184,0.12)"),        # slate
    "store_memory": ("#a3e635", "rgba(163,230,53,0.12)"),          # lime
    "recall_memory": ("#a3e635", "rgba(163,230,53,0.12)"),         # lime
    "get_account": ("#f59e0b", "rgba(245,158,11,0.12)"),            # amber
    "execute_trade": ("#22c55e", "rgba(34,197,94,0.12)"),          # green
    "close_position": ("#ef4444", "rgba(239,68,68,0.12)"),         # red
    "modify_position": ("#a78bfa", "rgba(167,139,250,0.12)"),     # purple
}


def _tool_row(name: str, icon_name: str, desc: str) -> rx.Component:
    """Single tool in the tools detail view."""
    color, bg = _TOOL_COLORS.get(name, ("#818cf8", "#1e1b4b"))
    return rx.hstack(
        rx.box(
            rx.icon(icon_name, size=16, color=color),
            width="36px",
            height="36px",
            border_radius="10px",
            background=bg,
            display="flex",
            align_items="center",
            justify_content="center",
            flex_shrink="0",
        ),
        rx.vstack(
            rx.text(name, font_size="0.8rem", font_weight="500", color="#e5e5e5"),
            rx.text(desc, font_size="0.7rem", color="#525252", line_height="1.4"),
            spacing="0",
        ),
        spacing="3",
        align="start",
        width="100%",
    )


def _tools_detail() -> rx.Component:
    """Detail view for the Tools stat."""
    return rx.vstack(
        _tool_row(
            "get_market_data",
            "line-chart",
            "Live prices, funding, OI, volume, and period analysis",
        ),
        _tool_row(
            "get_orderbook",
            "book-open",
            "L2 depth, spread, bid/ask walls, imbalance",
        ),
        _tool_row(
            "get_funding_history",
            "bar-chart-3",
            "Funding rate trends, sentiment, cumulative cost",
        ),
        _tool_row(
            "get_multi_timeframe",
            "layers",
            "24h/7d/30d nested analysis, trend alignment, momentum",
        ),
        _tool_row(
            "get_liquidations",
            "flame",
            "Cross-exchange liquidation data, longs vs shorts, by exchange",
        ),
        _tool_row(
            "get_global_sentiment",
            "globe",
            "Cross-exchange OI, funding, Fear & Greed, OI history",
        ),
        _tool_row(
            "get_options_flow",
            "target",
            "Options max pain, put/call ratios, exchange OI",
        ),
        _tool_row(
            "get_institutional_flow",
            "building-2",
            "ETF flows, Coinbase premium, exchange balances",
        ),
        _tool_row(
            "search_web",
            "search",
            "Real-time web search for news, macro events, knowledge gaps",
        ),
        _tool_row(
            "get_my_costs",
            "wallet",
            "Check operating costs — API usage, subscriptions, burn rate",
        ),
        _tool_row(
            "store_memory",
            "brain",
            "Store memories with [[wikilinks]] — batch by calling multiple times",
        ),
        _tool_row(
            "recall_memory",
            "search",
            "Search persistent memory for past analyses and knowledge",
        ),
        _tool_row(
            "get_account",
            "wallet",
            "Balance, positions, orders — flexible views (summary/positions/orders/full)",
        ),
        _tool_row(
            "execute_trade",
            "arrow-up-right",
            "Market or limit orders, optional SL/TP, per-trade leverage",
        ),
        _tool_row(
            "close_position",
            "circle-x",
            "Close positions — market or limit exit, full or partial",
        ),
        _tool_row(
            "modify_position",
            "settings",
            "Update stop loss, take profit, leverage, or cancel orders",
        ),
        spacing="3",
        width="100%",
        padding_top="0.5rem",
    )


def _trades_detail() -> rx.Component:
    """Detail view for the Trades stat."""
    return rx.vstack(
        rx.cond(
            AppState.positions.length() > 0,
            rx.vstack(
                rx.foreach(
                    AppState.positions,
                    lambda pos: rx.hstack(
                        rx.text(pos.symbol, color="#e5e5e5", font_size="0.85rem", font_weight="500"),
                        rx.text(
                            pos.side.upper(),
                            color=rx.cond(pos.side == "long", "#22c55e", "#ef4444"),
                            font_size="0.75rem",
                            font_weight="500",
                        ),
                        rx.spacer(),
                        rx.text(
                            pos.pnl.to(str) + "%",
                            color=rx.cond(pos.pnl >= 0, "#22c55e", "#ef4444"),
                            font_size="0.85rem",
                            font_weight="500",
                        ),
                        width="100%",
                        padding_y="0.5rem",
                        border_bottom="1px solid #1a1a1a",
                    ),
                ),
                width="100%",
                spacing="0",
            ),
            rx.vstack(
                rx.icon("inbox", size=24, color="#333"),
                rx.text("No trades yet", font_size="0.85rem", color="#525252"),
                rx.text(
                    "Testnet trading active.",
                    font_size="0.75rem",
                    color="#404040",
                ),
                spacing="2",
                align="center",
                padding_y="1rem",
            ),
        ),
        width="100%",
        padding_top="0.5rem",
    )


def _wallet_detail() -> rx.Component:
    """Detail view for the Wallet dialog — cost breakdown by service."""
    return rx.vstack(
        # Claude API
        rx.hstack(
            rx.box(
                rx.icon("brain", size=16, color="#a78bfa"),
                width="36px",
                height="36px",
                border_radius="10px",
                background="rgba(167,139,250,0.12)",
                display="flex",
                align_items="center",
                justify_content="center",
                flex_shrink="0",
            ),
            rx.vstack(
                rx.text("Claude API", font_size="0.85rem", font_weight="500", color="#e5e5e5"),
                rx.hstack(
                    rx.text(AppState.wallet_claude_cost, font_size="0.8rem", color="#a78bfa", font_weight="500"),
                    rx.text("·", color="#333"),
                    rx.text(AppState.wallet_claude_calls + " calls", font_size="0.75rem", color="#525252"),
                    spacing="2",
                    align="center",
                ),
                rx.text(AppState.wallet_claude_tokens, font_size="0.7rem", color="#404040"),
                spacing="0",
            ),
            spacing="3",
            align="start",
            width="100%",
        ),

        # Perplexity API
        rx.hstack(
            rx.box(
                rx.icon("search", size=16, color="#e879f9"),
                width="36px",
                height="36px",
                border_radius="10px",
                background="rgba(232,121,249,0.12)",
                display="flex",
                align_items="center",
                justify_content="center",
                flex_shrink="0",
            ),
            rx.vstack(
                rx.text("Perplexity API", font_size="0.85rem", font_weight="500", color="#e5e5e5"),
                rx.hstack(
                    rx.text(AppState.wallet_perplexity_cost, font_size="0.8rem", color="#e879f9", font_weight="500"),
                    rx.text("·", color="#333"),
                    rx.text(AppState.wallet_perplexity_calls + " calls", font_size="0.75rem", color="#525252"),
                    spacing="2",
                    align="center",
                ),
                spacing="0",
            ),
            spacing="3",
            align="start",
            width="100%",
        ),

        # Coinglass
        rx.hstack(
            rx.box(
                rx.icon("glasses", size=16, color="#fbbf24"),
                width="36px",
                height="36px",
                border_radius="10px",
                background="rgba(251,191,36,0.12)",
                display="flex",
                align_items="center",
                justify_content="center",
                flex_shrink="0",
            ),
            rx.vstack(
                rx.text("Coinglass", font_size="0.85rem", font_weight="500", color="#e5e5e5"),
                rx.hstack(
                    rx.text(AppState.wallet_coinglass_cost, font_size="0.8rem", color="#fbbf24", font_weight="500"),
                    rx.text("·", color="#333"),
                    rx.text("Subscription", font_size="0.75rem", color="#525252"),
                    spacing="2",
                    align="center",
                ),
                spacing="0",
            ),
            spacing="3",
            align="start",
            width="100%",
        ),

        # Divider + Total
        rx.divider(border_color="#1a1a1a"),
        rx.hstack(
            rx.text("Total this month", font_size="0.85rem", color="#737373"),
            rx.spacer(),
            rx.text(AppState.wallet_total_str, font_size="1rem", font_weight="600", color="#fafafa"),
            width="100%",
            align="center",
        ),

        spacing="3",
        width="100%",
        padding_top="0.5rem",
    )


def _wallet_card() -> rx.Component:
    """Clickable wallet stat card that opens cost breakdown dialog."""
    return rx.dialog.root(
        rx.dialog.trigger(
            rx.box(
                rx.vstack(
                    rx.text(
                        "Wallet",
                        font_size="0.7rem",
                        font_weight="600",
                        color="#525252",
                        text_transform="uppercase",
                        letter_spacing="0.05em",
                    ),
                    rx.text(
                        AppState.wallet_total_str,
                        font_size="1.5rem",
                        font_weight="600",
                        color="#fafafa",
                        line_height="1.2",
                    ),
                    rx.text(
                        AppState.wallet_subtitle,
                        font_size="0.75rem",
                        color="#525252",
                    ),
                    align_items="start",
                    spacing="1",
                ),
                background="#111111",
                border="1px solid #1a1a1a",
                border_radius="12px",
                padding="1rem",
                flex="1",
                cursor="pointer",
                transition="all 0.15s ease",
                _hover={"border_color": "#2a2a2a", "background": "#131313"},
            ),
        ),
        rx.dialog.content(
            rx.dialog.title(
                "Operating Costs",
                font_size="1rem",
                font_weight="600",
                color="#fafafa",
            ),
            rx.dialog.description(
                AppState.wallet_subtitle,
                font_size="0.75rem",
                color="#525252",
            ),
            _wallet_detail(),
            rx.dialog.close(
                rx.button(
                    "Close",
                    variant="ghost",
                    color="#525252",
                    cursor="pointer",
                    _hover={"color": "#a3a3a3"},
                ),
            ),
            background="#111111",
            border="1px solid #1a1a1a",
            border_radius="14px",
            padding="1.25rem",
            max_width="380px",
        ),
    )


_DAEMON_EVENT_STYLES = {
    "wake": ("brain", "#a78bfa"),
    "watchpoint": ("bell", "#fbbf24"),
    "fill": ("arrow-right-left", "#22c55e"),
    "learning": ("book-open", "#a3e635"),
    "review": ("clock", "#60a5fa"),
    "error": ("alert-triangle", "#ef4444"),
    "skip": ("pause", "#525252"),
    "circuit_breaker": ("shield-alert", "#ef4444"),
}


def _event_icon(event_type: rx.Var[str]) -> rx.Var[str]:
    """Resolve daemon event type to icon name."""
    return rx.match(
        event_type,
        ("wake", "brain"),
        ("watchpoint", "bell"),
        ("fill", "arrow-right-left"),
        ("learning", "book-open"),
        ("review", "clock"),
        ("error", "alert-triangle"),
        ("skip", "pause"),
        ("circuit_breaker", "shield-alert"),
        "circle",
    )


def _event_color(event_type: rx.Var[str]) -> rx.Var[str]:
    """Resolve daemon event type to accent color."""
    return rx.match(
        event_type,
        ("wake", "#a78bfa"),
        ("watchpoint", "#fbbf24"),
        ("fill", "#22c55e"),
        ("learning", "#a3e635"),
        ("review", "#60a5fa"),
        ("error", "#ef4444"),
        ("skip", "#525252"),
        ("circuit_breaker", "#ef4444"),
        "#525252",
    )


def _event_bg(event_type: rx.Var[str]) -> rx.Var[str]:
    """Resolve daemon event type to icon box background (12% opacity accent)."""
    return rx.match(
        event_type,
        ("wake", "color-mix(in srgb, #a78bfa 12%, transparent)"),
        ("watchpoint", "color-mix(in srgb, #fbbf24 12%, transparent)"),
        ("fill", "color-mix(in srgb, #22c55e 12%, transparent)"),
        ("learning", "color-mix(in srgb, #a3e635 12%, transparent)"),
        ("review", "color-mix(in srgb, #60a5fa 12%, transparent)"),
        ("error", "color-mix(in srgb, #ef4444 12%, transparent)"),
        ("skip", "color-mix(in srgb, #525252 12%, transparent)"),
        ("circuit_breaker", "color-mix(in srgb, #ef4444 12%, transparent)"),
        "color-mix(in srgb, #525252 12%, transparent)",
    )


def _daemon_event_row(event: DaemonActivity) -> rx.Component:
    """Single event in the daemon activity feed."""
    icon = _event_icon(event.type)
    color = _event_color(event.type)
    bg = _event_bg(event.type)

    return rx.hstack(
        rx.box(
            rx.icon(icon, size=14, color=color),
            width="28px",
            height="28px",
            border_radius="8px",
            background=bg,
            display="flex",
            align_items="center",
            justify_content="center",
            flex_shrink="0",
        ),
        rx.vstack(
            rx.text(event.title, font_size="0.8rem", font_weight="500", color="#e5e5e5"),
            rx.text(event.detail, font_size="0.7rem", color="#525252", line_height="1.3"),
            spacing="0",
        ),
        spacing="3",
        align="start",
        width="100%",
        padding_y="0.375rem",
        border_bottom="1px solid #1a1a1a",
    )


def _daemon_detail() -> rx.Component:
    """Detail view for the Daemon dialog — activity feed + controls."""
    return rx.vstack(
        # Daily PnL
        rx.hstack(
            rx.text("Daily PnL", font_size="0.8rem", color="#737373"),
            rx.spacer(),
            rx.text(
                AppState.daemon_daily_pnl,
                font_size="0.9rem",
                font_weight="600",
                color=rx.cond(AppState.daemon_trading_paused, "#ef4444", "#fafafa"),
            ),
            width="100%",
            align="center",
        ),
        rx.cond(
            AppState.daemon_trading_paused,
            rx.text(
                "Circuit breaker active — trading paused until UTC midnight",
                font_size="0.7rem",
                color="#ef4444",
                padding_y="0.25rem",
            ),
            rx.fragment(),
        ),

        rx.divider(border_color="#1a1a1a"),

        # Toggle
        rx.hstack(
            rx.text("Daemon", font_size="0.85rem", color="#e5e5e5"),
            rx.spacer(),
            rx.switch(
                checked=AppState.daemon_running,
                on_change=AppState.toggle_daemon,
                color_scheme="indigo",
                cursor="pointer",
            ),
            width="100%",
            align="center",
        ),

        # Manual wake button
        rx.cond(
            AppState.daemon_running,
            rx.button(
                rx.cond(
                    AppState.is_waking,
                    rx.hstack(
                        rx.spinner(size="1", color="#fafafa"),
                        rx.text("Waking...", font_size="0.8rem"),
                        spacing="2",
                        align="center",
                    ),
                    rx.hstack(
                        rx.icon("zap", size=14),
                        rx.text("Wake Agent Now", font_size="0.8rem"),
                        spacing="2",
                        align="center",
                    ),
                ),
                on_click=AppState.wake_agent_now,
                disabled=AppState.is_waking,
                width="100%",
                background="linear-gradient(135deg, #4338ca 0%, #6366f1 100%)",
                color="#fafafa",
                border="none",
                border_radius="8px",
                height="36px",
                font_weight="500",
                cursor=rx.cond(AppState.is_waking, "wait", "pointer"),
                _hover={"opacity": "0.9"},
                opacity=rx.cond(AppState.is_waking, "0.7", "1"),
            ),
            rx.fragment(),
        ),

        rx.divider(border_color="#1a1a1a"),

        # Activity feed
        rx.text(
            "RECENT ACTIVITY",
            font_size="0.65rem",
            font_weight="600",
            color="#525252",
            letter_spacing="0.05em",
        ),
        rx.cond(
            AppState.daemon_activities.length() > 0,
            rx.vstack(
                rx.foreach(AppState.daemon_activities, _daemon_event_row),
                spacing="0",
                width="100%",
                max_height="300px",
                overflow_y="auto",
                style={
                    "scrollbar_width": "thin",
                    "scrollbar_color": "#262626 transparent",
                },
            ),
            rx.text(
                "No activity yet. Enable the daemon to start watching markets.",
                font_size="0.8rem",
                color="#404040",
                padding_y="1rem",
            ),
        ),

        spacing="3",
        width="100%",
        padding_top="0.5rem",
    )


def _daemon_card() -> rx.Component:
    """Clickable daemon status card that opens activity feed dialog."""
    return rx.dialog.root(
        rx.dialog.trigger(
            rx.box(
                rx.vstack(
                    rx.text(
                        "Daemon",
                        font_size="0.7rem",
                        font_weight="600",
                        color="#525252",
                        text_transform="uppercase",
                        letter_spacing="0.05em",
                    ),
                    rx.hstack(
                        rx.box(
                            width="8px",
                            height="8px",
                            border_radius="50%",
                            background=AppState.daemon_status_color,
                            box_shadow=rx.cond(
                                AppState.daemon_running,
                                "0 0 6px rgba(34, 197, 94, 0.5)",
                                "none",
                            ),
                        ),
                        rx.text(
                            AppState.daemon_status_text,
                            font_size="1.5rem",
                            font_weight="600",
                            color="#fafafa",
                            line_height="1.2",
                        ),
                        spacing="2",
                        align="center",
                    ),
                    rx.text(
                        AppState.daemon_wake_count + " wakes",
                        font_size="0.75rem",
                        color="#525252",
                    ),
                    align_items="start",
                    spacing="1",
                ),
                background="#111111",
                border="1px solid #1a1a1a",
                border_radius="12px",
                padding="1rem",
                flex="1",
                cursor="pointer",
                transition="all 0.15s ease",
                _hover={"border_color": "#2a2a2a", "background": "#131313"},
            ),
        ),
        rx.dialog.content(
            rx.dialog.title(
                "Daemon Activity",
                font_size="1rem",
                font_weight="600",
                color="#fafafa",
            ),
            rx.dialog.description(
                "Background watchdog — fills, watchpoints, reviews",
                font_size="0.75rem",
                color="#525252",
            ),
            _daemon_detail(),
            rx.dialog.close(
                rx.button(
                    "Close",
                    variant="ghost",
                    color="#525252",
                    cursor="pointer",
                    _hover={"color": "#a3a3a3"},
                ),
            ),
            background="#111111",
            border="1px solid #1a1a1a",
            border_radius="14px",
            padding="1.25rem",
            max_width="420px",
        ),
    )


def _messages_detail() -> rx.Component:
    """Detail view for the Messages stat."""
    return rx.vstack(
        rx.hstack(
            rx.icon("message-square", size=18, color="#818cf8"),
            rx.text(
                AppState.message_count + " messages exchanged",
                font_size="0.85rem",
                color="#e5e5e5",
            ),
            spacing="2",
            align="center",
        ),
        rx.text(
            "Conversations persist across sessions. "
            "Use the Clear History button to start fresh.",
            font_size="0.75rem",
            color="#525252",
            line_height="1.5",
        ),
        spacing="3",
        width="100%",
        padding_top="0.5rem",
    )


def profile_card() -> rx.Component:
    """Hynous profile card — left sidebar."""
    return rx.box(
        rx.vstack(
            # Avatar
            _profile_avatar(),

            # Name
            rx.text("Hynous", font_size="1.25rem", font_weight="600", color="#fafafa"),

            # Status
            _status_badge(),

            # Bio
            rx.text(
                "Your crypto trading partner. Watches markets, "
                "analyzes data, and trades with conviction.",
                font_size="0.8rem",
                color="#737373",
                text_align="center",
                line_height="1.5",
                padding_x="0.5rem",
            ),

            # Divider
            rx.divider(border_color="#1a1a1a"),

            # Stats row (clickable — opens detail dialogs)
            rx.hstack(
                _stat_with_dialog("16", "Tools", "Available Tools", _tools_detail()),
                rx.divider(orientation="vertical", height="32px", border_color="#1a1a1a"),
                _stat_with_dialog(AppState.positions_count, "Trades", "Trades", _trades_detail()),
                rx.divider(orientation="vertical", height="32px", border_color="#1a1a1a"),
                _stat_with_dialog(AppState.message_count, "Messages", "Messages", _messages_detail()),
                width="100%",
                justify="center",
                spacing="4",
            ),

            # Divider
            rx.divider(border_color="#1a1a1a"),

            # Action buttons
            rx.vstack(
                rx.button(
                    rx.icon("message-circle", size=16),
                    "Chat with Hynous",
                    on_click=AppState.go_to_chat,
                    width="100%",
                    background="linear-gradient(135deg, #4338ca 0%, #6366f1 100%)",
                    color="#fafafa",
                    border="none",
                    border_radius="10px",
                    height="40px",
                    font_size="0.85rem",
                    font_weight="500",
                    cursor="pointer",
                    _hover={"opacity": "0.9"},
                ),
                rx.button(
                    rx.icon("trash-2", size=14),
                    "Clear History",
                    on_click=AppState.clear_messages,
                    width="100%",
                    background="transparent",
                    color="#525252",
                    border="1px solid #1a1a1a",
                    border_radius="10px",
                    height="36px",
                    font_size="0.8rem",
                    font_weight="400",
                    cursor="pointer",
                    _hover={"border_color": "#2a2a2a", "color": "#737373"},
                ),
                width="100%",
                spacing="2",
            ),

            spacing="4",
            align="center",
            width="100%",
        ),
        background="#111111",
        border="1px solid #1a1a1a",
        border_radius="16px",
        padding="1.5rem",
        width="280px",
        flex_shrink="0",
    )


def _suggestion(text: str, icon_name: str) -> rx.Component:
    """Single suggestion card."""
    return rx.box(
        rx.hstack(
            rx.icon(icon_name, size=16, color="#525252"),
            rx.text(text, font_size="0.8rem", color="#a3a3a3"),
            spacing="2",
            align="center",
        ),
        padding="0.75rem 1rem",
        background="#111111",
        border="1px solid #1a1a1a",
        border_radius="10px",
        cursor="pointer",
        transition="all 0.15s ease",
        _hover={"border_color": "#2a2a2a", "background": "#151515"},
        on_click=AppState.go_to_chat_with_message(text),
    )


def suggestion_cards() -> rx.Component:
    """Conversation starters that navigate to chat."""
    return rx.box(
        rx.vstack(
            rx.text(
                "Start a Conversation",
                font_size="0.75rem",
                font_weight="600",
                color="#737373",
                text_transform="uppercase",
                letter_spacing="0.05em",
            ),
            rx.grid(
                _suggestion("How's the market looking?", "trending-up"),
                _suggestion("Check BTC price", "bitcoin"),
                _suggestion("What should I watch today?", "eye"),
                _suggestion("Analyze ETH funding rates", "bar-chart-3"),
                columns="2",
                spacing="3",
                width="100%",
            ),
            spacing="3",
            width="100%",
        ),
        background="#111111",
        border="1px solid #1a1a1a",
        border_radius="12px",
        padding="1rem",
    )


def position_row(pos) -> rx.Component:
    """Single position row."""
    return rx.hstack(
        # Symbol + Side
        rx.hstack(
            rx.text(pos.symbol, color="#e5e5e5", font_size="0.85rem", font_weight="500"),
            rx.text(
                pos.side.upper(),
                color=rx.cond(pos.side == "long", "#22c55e", "#ef4444"),
                font_size="0.7rem",
                font_weight="600",
            ),
            spacing="1",
            width="18%",
            align_items="center",
        ),
        # Margin (size / leverage)
        rx.text("$" + (pos.size / pos.leverage).to(int).to(str), color="#a3a3a3", font_size="0.85rem", width="14%"),
        # Size (notional)
        rx.text("$" + pos.size.to(int).to(str), color="#a3a3a3", font_size="0.85rem", width="14%"),
        # Leverage
        rx.text(
            pos.leverage.to(str) + "x",
            color="#fbbf24",
            font_size="0.85rem",
            font_weight="500",
            width="10%",
        ),
        # Entry price
        rx.text("$" + pos.entry.to(str), color="#a3a3a3", font_size="0.85rem", width="18%"),
        # P&L %
        rx.text(
            pos.pnl.to(str) + "%",
            color=rx.cond(pos.pnl >= 0, "#22c55e", "#ef4444"),
            font_size="0.85rem",
            font_weight="500",
            width="13%",
        ),
        # P&L $
        rx.text(
            rx.cond(pos.pnl_usd >= 0, "+$", "-$") + rx.cond(pos.pnl_usd >= 0, pos.pnl_usd, pos.pnl_usd * -1).to(str),
            color=rx.cond(pos.pnl_usd >= 0, "#22c55e", "#ef4444"),
            font_size="0.85rem",
            font_weight="600",
            width="13%",
        ),
        width="100%",
        padding_y="0.625rem",
        border_bottom="1px solid #1a1a1a",
    )


def positions_section() -> rx.Component:
    """Open positions section."""
    return rx.box(
        rx.vstack(
            rx.text(
                "Positions",
                font_size="0.75rem",
                font_weight="600",
                color="#737373",
                text_transform="uppercase",
                letter_spacing="0.05em",
            ),
            rx.cond(
                AppState.positions.length() > 0,
                rx.vstack(
                    rx.hstack(
                        rx.text("Symbol", color="#525252", font_size="0.7rem", width="18%"),
                        rx.text("Margin", color="#525252", font_size="0.7rem", width="14%"),
                        rx.text("Size", color="#525252", font_size="0.7rem", width="14%"),
                        rx.text("Lev", color="#525252", font_size="0.7rem", width="10%"),
                        rx.text("Entry", color="#525252", font_size="0.7rem", width="18%"),
                        rx.text("P&L %", color="#525252", font_size="0.7rem", width="13%"),
                        rx.text("P&L $", color="#525252", font_size="0.7rem", width="13%"),
                        width="100%",
                        padding_bottom="0.5rem",
                        border_bottom="1px solid #1a1a1a",
                    ),
                    rx.foreach(AppState.positions, position_row),
                    width="100%",
                    spacing="0",
                ),
                rx.box(
                    rx.text(
                        "No open positions",
                        color="#404040",
                        font_size="0.875rem",
                    ),
                    padding="2rem 0",
                    text_align="center",
                ),
            ),
            width="100%",
            spacing="3",
            align_items="stretch",
        ),
        background="#111111",
        border="1px solid #1a1a1a",
        border_radius="12px",
        padding="1rem",
    )


def home_page() -> rx.Component:
    """Home page — profile card + dashboard info."""
    return rx.box(
        rx.hstack(
            # Left: Hynous profile
            profile_card(),

            # Right: Dashboard content
            rx.vstack(
                # Stats row — 2 cards only (portfolio + status)
                rx.hstack(
                    stat_card(
                        title="Portfolio Value",
                        value=AppState.portfolio_value_str,
                        subtitle=AppState.portfolio_change_str,
                        value_color=AppState.portfolio_change_color,
                    ),
                    _wallet_card(),
                    _daemon_card(),
                    spacing="4",
                    width="100%",
                ),

                # Positions + Suggestions side by side
                rx.hstack(
                    rx.box(positions_section(), flex="1", min_width="0"),
                    rx.box(suggestion_cards(), flex="1", min_width="0"),
                    spacing="4",
                    width="100%",
                    align_items="stretch",
                ),

                flex="1",
                spacing="4",
                width="100%",
                min_width="0",
            ),

            width="100%",
            spacing="4",
            align_items="start",
        ),
        width="100%",
        height="100%",
        padding="24px",
        max_width="1200px",
        margin="0 auto",
        overflow_y="auto",
        overscroll_behavior="none",
        style={
            "scrollbar_width": "thin",
            "scrollbar_color": "#262626 transparent",
        },
    )
