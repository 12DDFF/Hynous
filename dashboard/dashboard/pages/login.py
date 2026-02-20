"""Login page — password gate for the dashboard."""

import reflex as rx
from ..state import AppState


def login_page() -> rx.Component:
    """Centered login form matching the app's dark Iris theme."""
    return rx.center(
        rx.vstack(
            # Logo
            rx.hstack(
                rx.box(
                    rx.text("H", font_size="1.1rem", font_weight="600", color="#a5b4fc"),
                    width="36px",
                    height="36px",
                    border_radius="10px",
                    background="linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
                    display="flex",
                    align_items="center",
                    justify_content="center",
                ),
                rx.text(
                    "Hynous",
                    font_size="1.5rem",
                    font_weight="600",
                    color="#fafafa",
                ),
                spacing="3",
                align="center",
            ),

            rx.text(
                "Enter password to continue",
                font_size="0.85rem",
                color="#525252",
            ),

            # Login form
            rx.form(
                rx.vstack(
                    rx.input(
                        name="password",
                        type="password",
                        placeholder="Password",
                        auto_focus=True,
                        width="100%",
                        height="44px",
                        background="#0f0f0f",
                        border="1px solid #262626",
                        border_radius="8px",
                        color="#fafafa",
                        padding_x="14px",
                        font_size="0.9rem",
                        _focus={
                            "border_color": "#6366f1",
                            "box_shadow": "0 0 0 1px #6366f1",
                            "outline": "none",
                        },
                        _placeholder={"color": "#404040"},
                    ),
                    # Error message
                    rx.cond(
                        AppState.login_error != "",
                        rx.text(
                            AppState.login_error,
                            font_size="0.78rem",
                            color="#ef4444",
                        ),
                    ),
                    rx.button(
                        "Sign in",
                        type="submit",
                        width="100%",
                        height="44px",
                        background="linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
                        color="#fafafa",
                        font_weight="500",
                        font_size="0.9rem",
                        border="none",
                        border_radius="8px",
                        cursor="pointer",
                        _hover={"opacity": "0.9"},
                    ),
                    spacing="3",
                    width="100%",
                ),
                on_submit=AppState.authenticate,
                reset_on_submit=True,
                method="POST",
                width="100%",
            ),

            spacing="4",
            align="center",
            width="320px",
            padding="32px",
            background="#0a0a0a",
            border="1px solid #1a1a1a",
            border_radius="12px",
        ),
        width="100%",
        height="100vh",
        background="#0a0a0a",
    )
