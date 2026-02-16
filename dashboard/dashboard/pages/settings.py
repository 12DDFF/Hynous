"""Settings page — runtime-adjustable trading parameters."""

import reflex as rx
from ..state import AppState


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------

def _card(title: str, icon: str, subtitle: str, *children) -> rx.Component:
    """Settings card with icon header, title, and subtitle."""
    return rx.box(
        rx.vstack(
            # Card header
            rx.hstack(
                rx.box(
                    rx.icon(tag=icon, size=16, color="#818cf8"),
                    width="32px",
                    height="32px",
                    display="flex",
                    align_items="center",
                    justify_content="center",
                    background="rgba(99, 102, 241, 0.1)",
                    border_radius="8px",
                    flex_shrink="0",
                ),
                rx.vstack(
                    rx.text(
                        title,
                        font_size="0.9rem",
                        font_weight="600",
                        color="#fafafa",
                    ),
                    rx.text(
                        subtitle,
                        font_size="0.72rem",
                        color="#525252",
                        line_height="1.3",
                    ),
                    spacing="0",
                ),
                spacing="3",
                align="center",
                width="100%",
                padding_bottom="0.75rem",
                border_bottom="1px solid #1a1a1a",
                margin_bottom="0.5rem",
            ),
            # Card body
            *children,
            spacing="0",
            width="100%",
        ),
        background="#111111",
        border="1px solid #1a1a1a",
        border_radius="12px",
        padding="1.25rem",
        width="100%",
    )


def _field(
    label: str,
    hint: str,
    value,
    on_change,
    suffix: str = "",
    input_width: str = "72px",
) -> rx.Component:
    """Setting field: label + hint on left, input + suffix on right."""
    right_side = [
        rx.input(
            value=value.to(str),
            on_change=on_change,
            type="number",
            width=input_width,
            height="34px",
            font_size="0.85rem",
            font_family="JetBrains Mono, monospace",
            background="#0a0a0a",
            border="1px solid #262626",
            border_radius="8px",
            color="#fafafa",
            padding_x="10px",
            text_align="right",
            _focus={"border_color": "#6366f1", "outline": "none", "box_shadow": "0 0 0 2px rgba(99, 102, 241, 0.15)"},
        ),
    ]
    if suffix:
        right_side.append(
            rx.text(suffix, font_size="0.75rem", color="#525252", min_width="16px"),
        )

    return rx.hstack(
        rx.vstack(
            rx.text(label, font_size="0.85rem", color="#d4d4d4", font_weight="500"),
            rx.text(hint, font_size="0.7rem", color="#404040", line_height="1.3"),
            spacing="0",
            flex="1",
            min_width="0",
        ),
        rx.hstack(*right_side, spacing="2", align="center", flex_shrink="0"),
        width="100%",
        justify="between",
        align="center",
        padding_y="0.625rem",
    )


def _toggle(
    label: str,
    hint: str,
    checked,
    on_change,
) -> rx.Component:
    """Setting toggle: label + hint on left, switch on right."""
    return rx.hstack(
        rx.vstack(
            rx.text(label, font_size="0.85rem", color="#d4d4d4", font_weight="500"),
            rx.text(hint, font_size="0.7rem", color="#404040", line_height="1.3"),
            spacing="0",
            flex="1",
            min_width="0",
        ),
        rx.switch(
            checked=checked,
            on_change=on_change,
            color_scheme="iris",
        ),
        width="100%",
        justify="between",
        align="center",
        padding_y="0.625rem",
    )


def _divider() -> rx.Component:
    """Subtle divider between field groups."""
    return rx.box(
        width="100%",
        height="1px",
        background="#1a1a1a",
        margin_y="0.25rem",
    )


# ---------------------------------------------------------------------------
# Cards
# ---------------------------------------------------------------------------

def _macro_card() -> rx.Component:
    return _card(
        "Macro Trades", "trending-up",
        "Swing / positional trade limits. Leverage is auto-derived from SL distance.",
        _field("Stop Loss Min", "Minimum allowed stop-loss distance",
               AppState.settings_macro_sl_min, AppState.set_settings_macro_sl_min, "%"),
        _field("Stop Loss Max", "Maximum allowed stop-loss distance",
               AppState.settings_macro_sl_max, AppState.set_settings_macro_sl_max, "%"),
        _divider(),
        _field("Take Profit Min", "Minimum take-profit target",
               AppState.settings_macro_tp_min, AppState.set_settings_macro_tp_min, "%"),
        _field("Take Profit Max", "Maximum take-profit target",
               AppState.settings_macro_tp_max, AppState.set_settings_macro_tp_max, "%"),
        _divider(),
        _field("Leverage Min", "Floor for auto-calculated leverage",
               AppState.settings_macro_lev_min, AppState.set_settings_macro_lev_min, "x"),
        _field("Leverage Max", "Ceiling for auto-calculated leverage",
               AppState.settings_macro_lev_max, AppState.set_settings_macro_lev_max, "x"),
    )


def _micro_card() -> rx.Component:
    return _card(
        "Micro Trades", "zap",
        "Scalp / quick-flip trades. Fixed leverage, tighter SL ranges.",
        _field("Stop Loss Min", "Below this SL the trade is rejected",
               AppState.settings_micro_sl_min, AppState.set_settings_micro_sl_min, "%"),
        _field("Stop Loss Warn", "Below this SL a warning is shown",
               AppState.settings_micro_sl_warn, AppState.set_settings_micro_sl_warn, "%"),
        _field("Stop Loss Max", "Above this SL the trade is rejected",
               AppState.settings_micro_sl_max, AppState.set_settings_micro_sl_max, "%"),
        _divider(),
        _field("Take Profit Min", "Minimum TP to clear round-trip fees",
               AppState.settings_micro_tp_min, AppState.set_settings_micro_tp_min, "%"),
        _field("Take Profit Max", "Maximum TP for micro trades",
               AppState.settings_micro_tp_max, AppState.set_settings_micro_tp_max, "%"),
        _field("Leverage", "Fixed leverage used for all micro trades",
               AppState.settings_micro_leverage, AppState.set_settings_micro_leverage, "x"),
    )


def _sizing_card() -> rx.Component:
    return _card(
        "Conviction Sizing", "target",
        "Portfolio margin % allocated per confidence tier.",
        _field("High Conviction", "Margin % for high-confidence trades",
               AppState.settings_tier_high, AppState.set_settings_tier_high, "%"),
        _field("Medium Conviction", "Margin % for medium-confidence trades",
               AppState.settings_tier_medium, AppState.set_settings_tier_medium, "%"),
        _field("Speculative", "Margin % for low-confidence / exploratory",
               AppState.settings_tier_speculative, AppState.set_settings_tier_speculative, "%"),
        _divider(),
        _field("Pass Threshold", "Confidence below this skips the trade",
               AppState.settings_tier_pass, AppState.set_settings_tier_pass),
    )


def _risk_card() -> rx.Component:
    return _card(
        "Risk Management", "shield",
        "Guards and limits that reject or warn before a trade executes.",
        _field("R:R Floor (Reject)", "Trades below this risk:reward are blocked",
               AppState.settings_rr_floor_reject, AppState.set_settings_rr_floor_reject),
        _field("R:R Floor (Warn)", "Trades below this get a warning",
               AppState.settings_rr_floor_warn, AppState.set_settings_rr_floor_warn),
        _divider(),
        _field("Portfolio Risk Cap (Reject)", "Max portfolio % at risk — blocked above",
               AppState.settings_risk_cap_reject, AppState.set_settings_risk_cap_reject, "%"),
        _field("Portfolio Risk Cap (Warn)", "Warning threshold for portfolio risk",
               AppState.settings_risk_cap_warn, AppState.set_settings_risk_cap_warn, "%"),
        _divider(),
        _field("ROE at Stop (Reject)", "Max ROE loss if stop hits — blocked above",
               AppState.settings_roe_reject, AppState.set_settings_roe_reject, "%"),
        _field("ROE at Stop (Warn)", "Warning threshold for ROE at stop",
               AppState.settings_roe_warn, AppState.set_settings_roe_warn, "%"),
        _field("ROE Target", "Target ROE used for leverage calculation (lev = target / SL%)",
               AppState.settings_roe_target, AppState.set_settings_roe_target, "%"),
    )


def _limits_card() -> rx.Component:
    return _card(
        "General Limits", "lock",
        "Hard caps on position size, count, and daily drawdown.",
        _field("Max Position Size", "Largest single position in USD",
               AppState.settings_max_position, AppState.set_settings_max_position, "$", input_width="90px"),
        _field("Max Open Positions", "Concurrent positions allowed",
               AppState.settings_max_positions, AppState.set_settings_max_positions),
        _field("Max Daily Loss", "Stop trading if daily loss exceeds this",
               AppState.settings_max_daily_loss, AppState.set_settings_max_daily_loss, "$", input_width="90px"),
    )


def _scanner_card() -> rx.Component:
    return _card(
        "Scanner", "radar",
        "Market scanner detection sensitivity and wake behavior.",
        _field("Wake Threshold", "Minimum severity to trigger a wake (0.0 - 1.0)",
               AppState.settings_scanner_threshold, AppState.set_settings_scanner_threshold),
        _field("Max Wakes / Cycle", "Cap on anomalies reported per scan cycle",
               AppState.settings_scanner_max_wakes, AppState.set_settings_scanner_max_wakes),
        _divider(),
        _toggle("Micro Detectors", "Enable L2 orderbook & 5m candle micro-structure detectors",
                AppState.settings_scanner_micro, AppState.set_settings_scanner_micro),
        _toggle("News Alerts", "Enable CryptoCompare news-based wake alerts",
                AppState.settings_scanner_news, AppState.set_settings_scanner_news),
    )


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

def _header_bar() -> rx.Component:
    return rx.hstack(
        rx.hstack(
            rx.heading("Settings", size="5", font_weight="600"),
            rx.cond(
                AppState.settings_dirty,
                rx.badge(
                    "Unsaved changes",
                    color_scheme="yellow",
                    variant="soft",
                    size="1",
                ),
                rx.fragment(),
            ),
            spacing="3",
            align="center",
            min_width="0",
        ),
        rx.hstack(
            rx.button(
                "Reset Defaults",
                on_click=AppState.reset_settings,
                variant="ghost",
                color="#737373",
                size="2",
                cursor="pointer",
                white_space="nowrap",
                _hover={"color": "#ef4444"},
            ),
            rx.button(
                "Save",
                on_click=AppState.save_settings,
                background=rx.cond(AppState.settings_dirty, "#6366f1", "#262626"),
                color=rx.cond(AppState.settings_dirty, "#fafafa", "#737373"),
                size="2",
                cursor="pointer",
                border="none",
                border_radius="8px",
                padding_x="1.5rem",
                font_weight="500",
                white_space="nowrap",
                _hover={"opacity": "0.9"},
            ),
            spacing="3",
            flex_shrink="0",
            align="center",
        ),
        width="100%",
        justify="between",
        align="center",
        flex_wrap="wrap",
        gap="0.75rem",
        margin_bottom="1.5rem",
    )


# ---------------------------------------------------------------------------
# Page
# ---------------------------------------------------------------------------

def settings_page() -> rx.Component:
    """Settings page — two-column grid layout."""
    return rx.box(
        rx.vstack(
            _header_bar(),
            # Two-column grid
            rx.box(
                rx.box(
                    # Left column
                    rx.vstack(
                        _macro_card(),
                        _micro_card(),
                        _sizing_card(),
                        spacing="5",
                        width="100%",
                    ),
                    # Right column
                    rx.vstack(
                        _risk_card(),
                        _limits_card(),
                        _scanner_card(),
                        spacing="5",
                        width="100%",
                    ),
                    display="grid",
                    grid_template_columns=rx.breakpoints(
                        initial="1fr",
                        md="1fr 1fr",
                    ),
                    gap="1.25rem",
                    width="100%",
                    align_items="start",
                ),
                width="100%",
            ),
            width="100%",
            max_width="1000px",
            margin="0 auto",
            spacing="0",
        ),
        width="100%",
        height="100%",
        padding="1.5rem 1.5rem 3rem 1.5rem",
        overflow_y="auto",
        style={
            "scrollbar_width": "none",
            "&::-webkit-scrollbar": {"display": "none"},
        },
    )
