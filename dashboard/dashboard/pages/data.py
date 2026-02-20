"""Data Intelligence page — iframe wrapper for data.html."""

import time
import reflex as rx

# Cache-bust: appended to iframe src so browser fetches fresh after deploys
_CACHE_BUST = str(int(time.time()))


def data_page() -> rx.Component:
    """Full-screen data intelligence dashboard via iframe."""
    return rx.box(
        rx.el.iframe(
            src=f"/data.html?v={_CACHE_BUST}",
            width="100%",
            height="100%",
            border="none",
        ),
        width="100%",
        height="100%",
    )
