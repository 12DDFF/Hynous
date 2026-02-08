"""Card components."""

import reflex as rx


def card(*children, **props) -> rx.Component:
    """Base card component with dark theme styling."""
    return rx.box(
        *children,
        background="#111111",
        border="1px solid #1a1a1a",
        border_radius="12px",
        padding="1rem",
        **props,
    )


def stat_card(
    title: str,
    value,
    subtitle="",
    value_color="#fafafa",
) -> rx.Component:
    """Stat card with title, value, and optional subtitle."""
    return rx.box(
        rx.vstack(
            rx.text(
                title,
                font_size="0.7rem",
                font_weight="600",
                color="#525252",
                text_transform="uppercase",
                letter_spacing="0.05em",
            ),
            rx.text(
                value,
                font_size="1.5rem",
                font_weight="600",
                color=value_color,
                line_height="1.2",
            ),
            rx.text(
                subtitle,
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
    )
