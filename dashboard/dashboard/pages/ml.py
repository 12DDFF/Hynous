"""Machine Learning page — iframe wrapper for ml.html."""

import time
import reflex as rx

# Cache-bust: appended to iframe src so browser fetches fresh after deploys
_CACHE_BUST = str(int(time.time()))


def ml_page() -> rx.Component:
    """Full-screen ML dashboard via iframe."""
    return rx.box(
        rx.el.iframe(
            src=f"/ml.html?v={_CACHE_BUST}",
            width="100%",
            height="100%",
            border="none",
        ),
        width="100%",
        height="100%",
    )
