"""Memory Graph — force-directed visualization of the Nous knowledge graph."""

import reflex as rx


def graph_page() -> rx.Component:
    """Full-screen iframe embedding the force-graph visualization."""
    return rx.box(
        rx.el.iframe(
            src="/graph.html",
            width="100%",
            height="100%",
            border="none",
        ),
        width="100%",
        height="100%",
        overflow="hidden",
    )
