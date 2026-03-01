"""Machine Learning page — iframe wrapper for ml.html with satellite toggle."""

import time
import reflex as rx
from ..state import AppState

# Cache-bust: appended to iframe src so browser fetches fresh after deploys
_CACHE_BUST = str(int(time.time()))


def ml_page() -> rx.Component:
    """Full-screen ML dashboard with satellite toggle overlay."""
    return rx.box(
        # Satellite toggle — Reflex component (has access to daemon)
        rx.box(
            rx.hstack(
                rx.text(
                    "Satellite",
                    font_size="0.75rem",
                    color="#737373",
                ),
                rx.switch(
                    checked=AppState.satellite_running,
                    on_change=AppState.toggle_satellite,
                    size="1",
                    color_scheme="green",
                ),
                spacing="2",
                align="center",
            ),
            position="absolute",
            top="16px",
            right="180px",
            z_index="10",
            background="#0c0c0c",
            border="1px solid #1a1a1a",
            border_radius="8px",
            padding="6px 14px",
        ),
        # Iframe — the full ML dashboard HTML page
        rx.el.iframe(
            src=f"/ml.html?v={_CACHE_BUST}",
            width="100%",
            height="100%",
            border="none",
        ),
        width="100%",
        height="100%",
        position="relative",
    )
