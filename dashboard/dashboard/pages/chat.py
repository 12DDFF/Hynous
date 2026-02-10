"""Chat page component."""

import reflex as rx
from ..state import AppState, Position
from ..components import chat_bubble, chat_input, typing_indicator, streaming_bubble, tool_indicator, ticker_badge


def welcome_state() -> rx.Component:
    """Welcome message when no chat history - centered in the chat area."""
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
            rx.heading(
                "Hey, I'm Hynous",
                size="7",
                color="#fafafa",
                font_weight="600",
            ),
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


def messages_area() -> rx.Component:
    """Scrollable messages container with auto-scroll."""
    return rx.box(
        rx.box(
            rx.vstack(
                rx.foreach(
                    AppState.messages,
                    chat_bubble,
                ),
                # Loading state: streaming text, tool indicator, or typing dots
                rx.cond(
                    AppState.is_loading,
                    rx.vstack(
                        # Streaming text (if any)
                        rx.cond(
                            AppState.streaming_text != "",
                            streaming_bubble(AppState.streaming_display, AppState.streaming_show_avatar),
                            rx.fragment(),
                        ),
                        # Tool indicator or typing dots
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
                # Scroll anchor
                rx.box(id="chat-bottom"),
                width="100%",
                spacing="0",
            ),
            width="100%",
            max_width="800px",
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


def input_area() -> rx.Component:
    """Fixed input area at bottom."""
    return rx.box(
        rx.vstack(
            rx.box(
                chat_input(
                    on_submit=AppState.send_message,
                    is_loading=AppState.is_loading,
                ),
                width="100%",
                max_width="800px",
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


def _pos_chip(pos: Position) -> rx.Component:
    """Compact position chip for the top bar."""
    return rx.hstack(
        ticker_badge(pos.symbol, font_size="0.75rem", font_weight="600"),
        rx.text(
            pos.side.upper(),
            font_size="0.65rem",
            font_weight="500",
            color=rx.cond(pos.side == "long", "#22c55e", "#ef4444"),
        ),
        rx.text(
            pos.pnl.to(str) + "%",
            font_size="0.7rem",
            font_weight="500",
            color=rx.cond(pos.pnl >= 0, "#22c55e", "#ef4444"),
        ),
        spacing="2",
        padding="0.25rem 0.625rem",
        background="#141414",
        border="1px solid #1e1e1e",
        border_radius="6px",
    )


def positions_bar() -> rx.Component:
    """Slim positions strip at top of chat — only shows when positions exist."""
    return rx.cond(
        AppState.positions.length() > 0,
        rx.hstack(
            rx.text("POSITIONS", font_size="0.6rem", color="#525252", font_weight="600", letter_spacing="0.05em"),
            rx.hstack(
                rx.foreach(AppState.positions, _pos_chip),
                spacing="2",
            ),
            spacing="3",
            padding="0.5rem 1rem",
            width="100%",
            border_bottom="1px solid #141414",
            align_items="center",
            flex_shrink="0",
        ),
        rx.fragment(),
    )


def chat_page() -> rx.Component:
    """Full-height immersive chat layout."""
    return rx.fragment(
        rx.box(
            rx.vstack(
                # Positions bar — slim strip at top
                positions_bar(),

                # Messages or welcome
                rx.cond(
                    AppState.messages.length() > 0,
                    messages_area(),
                    welcome_state(),
                ),

                # Input area
                input_area(),

                width="100%",
                height="100%",
                spacing="0",
                align="center",
            ),
            width="100%",
            height="100%",
            background="#0a0a0a",
            display="flex",
            flex_direction="column",
            overflow="hidden",
        ),
    )
