"""Navigation components."""

import reflex as rx
from ..state import AppState


def nav_item(
    label: str,
    is_active: rx.Var[bool],
    on_click: callable,
    has_unread: rx.Var[bool] | None = None,
) -> rx.Component:
    """Navigation tab item - text only, clean design, optional unread dot.

    Uses rx.box instead of rx.button to avoid Radix button's persistent
    focus/hover styles that cause tabs to appear hovered when they're not.
    """
    children = [
        rx.text(
            label,
            font_size="0.875rem",
            font_weight=rx.cond(is_active, "500", "400"),
            line_height="1",
        ),
    ]
    if has_unread is not None:
        children.append(
            rx.cond(
                has_unread,
                rx.box(
                    width="6px",
                    height="6px",
                    border_radius="50%",
                    background="#6366f1",
                    box_shadow="0 0 6px rgba(99,102,241,0.6)",
                    position="absolute",
                    top="-2px",
                    right="-2px",
                    class_name="unread-dot",
                ),
                rx.fragment(),
            )
        )
    return rx.box(
        *children,
        on_click=on_click,
        position="relative",
        display="flex",
        align_items="center",
        justify_content="center",
        background=rx.cond(is_active, "#1a1a1a", "transparent"),
        color=rx.cond(is_active, "#fafafa", "#737373"),
        padding="0.5rem 1rem",
        border_radius="6px",
        cursor="pointer",
        transition="background 0.15s ease, color 0.15s ease",
        _hover={"background": "#1a1a1a", "color": "#e5e5e5"},
        user_select="none",
    )


def navbar(current_page: rx.Var[str], on_home: callable, on_chat: callable, on_journal: callable, on_memory: callable, on_data: callable = None, on_ml: callable = None, on_settings: callable = None, on_debug: callable = None, on_logout: callable = None) -> rx.Component:
    """Main navigation bar - fixed, clean, aligned."""
    return rx.hstack(
        # Left section - Logo (fixed width for consistency)
        rx.box(
            rx.hstack(
                rx.box(
                    rx.text("H", font_size="0.9rem", font_weight="600", color="#a5b4fc"),
                    width="28px",
                    height="28px",
                    border_radius="8px",
                    background="linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
                    display="flex",
                    align_items="center",
                    justify_content="center",
                ),
                rx.text(
                    "Hynous",
                    font_size="1.125rem",
                    font_weight="600",
                    color="#fafafa",
                ),
                spacing="3",
                align="center",
            ),
            width="160px",
        ),

        # Center section - Nav items (centered)
        rx.hstack(
            nav_item("Home", current_page == "home", on_home),
            nav_item("Chat", current_page == "chat", on_chat, has_unread=AppState.chat_unread),
            nav_item("Journal", current_page == "journal", on_journal, has_unread=AppState.journal_unread),
            nav_item("Memory", current_page == "memory", on_memory, has_unread=AppState.memory_unread),
            nav_item("Data", current_page == "data", on_data),
            nav_item("ML", current_page == "ml", on_ml),
            nav_item("Settings", current_page == "settings", on_settings),
            nav_item("Debug", current_page == "debug", on_debug),
            spacing="1",
            padding="4px",
            background="#0f0f0f",
            border_radius="8px",
            border="1px solid #1a1a1a",
        ),

        # Right section - Clock + status + logout (fixed width, right-aligned)
        rx.box(
            rx.hstack(
                rx.el.span(
                    "",
                    id="live-clock",
                    style={
                        "font_size": "0.7rem",
                        "color": "#404040",
                        "font_family": "JetBrains Mono, monospace",
                        "min_width": "70px",
                    },
                ),
                rx.box(
                    width="6px",
                    height="6px",
                    border_radius="50%",
                    background="#22c55e",
                    box_shadow="0 0 6px #22c55e",
                ),
                rx.text("Online", font_size="0.8rem", color="#525252"),
                # Logout button
                rx.box(
                    rx.text("\u23FB", font_size="0.85rem"),
                    on_click=on_logout,
                    display="flex",
                    align_items="center",
                    justify_content="center",
                    background="transparent",
                    color="#525252",
                    cursor="pointer",
                    padding="4px 6px",
                    border_radius="4px",
                    _hover={"color": "#ef4444", "background": "rgba(239,68,68,0.1)"},
                    title="Logout",
                ),
                spacing="2",
                align="center",
            ),
            width="200px",
            display="flex",
            justify_content="flex-end",
        ),

        justify="between",
        align="center",
        width="100%",
        height="56px",
        padding_x="24px",
        background="#0a0a0a",
        border_bottom="1px solid #1a1a1a",
    )
