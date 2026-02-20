"""Data Intelligence page — iframe wrapper for data.html."""

import reflex as rx


def data_page() -> rx.Component:
    """Full-screen data intelligence dashboard via iframe."""
    return rx.box(
        rx.el.iframe(
            src="/data.html",
            width="100%",
            height="100%",
            border="none",
        ),
        width="100%",
        height="100%",
    )
