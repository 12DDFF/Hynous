"""Ticker symbol badge with auto-detected brand color."""

import reflex as rx


def _symbol_color(symbol: rx.Var[str]) -> rx.Var[str]:
    """Map crypto ticker to its brand color."""
    return rx.match(
        symbol,
        ("BTC", "#f7931a"),
        ("ETH", "#627eea"),
        ("SOL", "#14f195"),
        ("AVAX", "#e84142"),
        ("DOGE", "#c2a633"),
        ("XRP", "#00c4e6"),
        ("LINK", "#2a5ada"),
        ("ADA", "#3cc8c8"),
        ("DOT", "#e6007a"),
        ("MATIC", "#8247e5"),
        ("POL", "#8247e5"),
        ("NEAR", "#00c1de"),
        ("ARB", "#28a0f0"),
        ("OP", "#ff0420"),
        ("APT", "#00bcd4"),
        ("SUI", "#6fbcf0"),
        ("UNI", "#ff007a"),
        ("AAVE", "#b6509e"),
        ("MKR", "#1aab9b"),
        ("PEPE", "#4ca843"),
        ("WIF", "#f5a623"),
        ("BONK", "#f5a623"),
        ("FIL", "#0090ff"),
        ("TIA", "#7b2bf9"),
        ("INJ", "#00f2fe"),
        ("SEI", "#9b1c1c"),
        ("JUP", "#00b386"),
        ("RENDER", "#e64dff"),
        ("FET", "#1d1d42"),
        ("WLD", "#1a1a2e"),
        ("PENDLE", "#2563eb"),
        ("STX", "#5546ff"),
        ("TRX", "#eb0029"),
        ("LTC", "#bfbbbb"),
        ("BCH", "#0ac18e"),
        ("HYPE", "#80ff00"),
        "#818cf8",  # fallback indigo
    )


def ticker_badge(
    symbol: rx.Var[str],
    font_size: str = "0.85rem",
    font_weight: str = "500",
    color: str = "#e5e5e5",
) -> rx.Component:
    """Ticker symbol with colored dot indicator."""
    return rx.hstack(
        rx.box(
            width="8px",
            height="8px",
            border_radius="50%",
            background=_symbol_color(symbol),
            flex_shrink="0",
        ),
        rx.text(
            symbol,
            font_size=font_size,
            font_weight=font_weight,
            color=color,
        ),
        spacing="1",
        align="center",
    )
