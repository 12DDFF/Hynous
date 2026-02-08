"""Reflex configuration for Hynous Dashboard."""

import reflex as rx

config = rx.Config(
    app_name="dashboard",
    title="Hynous",
    description="Crypto Intelligence Dashboard",

    # Disable sitemap plugin warning
    plugins=[],

    # Theme
    tailwind={
        "theme": {
            "extend": {
                "colors": {
                    "background": "#0a0a0a",
                    "surface": "#141414",
                    "border": "#262626",
                    "muted": "#737373",
                    "accent": "#6366f1",
                    "accent-hover": "#4f46e5",
                    "positive": "#22c55e",
                    "negative": "#ef4444",
                },
            },
        },
    },
)
