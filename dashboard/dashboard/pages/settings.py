"""Settings page — runtime-adjustable trading parameters."""

import reflex as rx
from ..state import AppState
from ..components import card


def _section_header(title: str) -> rx.Component:
    """Section header inside a settings card."""
    return rx.text(
        title,
        font_size="0.7rem",
        font_weight="600",
        color="#525252",
        text_transform="uppercase",
        letter_spacing="0.05em",
        margin_bottom="0.75rem",
    )


def _field_row(
    label: str,
    value,
    on_change,
    suffix: str = "",
    width: str = "80px",
) -> rx.Component:
    """A single settings field: label + number input."""
    children = [
        rx.text(label, font_size="0.85rem", color="#a3a3a3", flex="1"),
        rx.hstack(
            rx.input(
                value=value.to(str),
                on_change=on_change,
                type="number",
                width=width,
                height="32px",
                font_size="0.85rem",
                background="#0a0a0a",
                border="1px solid #262626",
                border_radius="6px",
                color="#fafafa",
                padding_x="8px",
                text_align="right",
                _focus={"border_color": "#6366f1", "outline": "none"},
            ),
            rx.text(suffix, font_size="0.75rem", color="#525252", min_width="20px") if suffix else rx.fragment(),
            spacing="1",
            align="center",
        ),
    ]
    return rx.hstack(
        *children,
        width="100%",
        justify="between",
        align="center",
        padding_y="0.25rem",
    )


def _switch_row(
    label: str,
    checked,
    on_change,
) -> rx.Component:
    """A settings field with a toggle switch."""
    return rx.hstack(
        rx.text(label, font_size="0.85rem", color="#a3a3a3", flex="1"),
        rx.switch(
            checked=checked,
            on_change=on_change,
            color_scheme="iris",
        ),
        width="100%",
        justify="between",
        align="center",
        padding_y="0.25rem",
    )


def _macro_card() -> rx.Component:
    """Macro trade settings card."""
    return card(
        rx.vstack(
            _section_header("Macro Trades"),
            _field_row("SL Min", AppState.settings_macro_sl_min, AppState.set_settings_macro_sl_min, "%"),
            _field_row("SL Max", AppState.settings_macro_sl_max, AppState.set_settings_macro_sl_max, "%"),
            _field_row("TP Min", AppState.settings_macro_tp_min, AppState.set_settings_macro_tp_min, "%"),
            _field_row("TP Max", AppState.settings_macro_tp_max, AppState.set_settings_macro_tp_max, "%"),
            _field_row("Leverage Min", AppState.settings_macro_lev_min, AppState.set_settings_macro_lev_min, "x"),
            _field_row("Leverage Max", AppState.settings_macro_lev_max, AppState.set_settings_macro_lev_max, "x"),
            spacing="1",
            width="100%",
        ),
    )


def _micro_card() -> rx.Component:
    """Micro trade settings card."""
    return card(
        rx.vstack(
            _section_header("Micro Trades"),
            _field_row("SL Min", AppState.settings_micro_sl_min, AppState.set_settings_micro_sl_min, "%"),
            _field_row("SL Warn", AppState.settings_micro_sl_warn, AppState.set_settings_micro_sl_warn, "%"),
            _field_row("SL Max", AppState.settings_micro_sl_max, AppState.set_settings_micro_sl_max, "%"),
            _field_row("TP Max", AppState.settings_micro_tp_max, AppState.set_settings_micro_tp_max, "%"),
            _field_row("Leverage", AppState.settings_micro_leverage, AppState.set_settings_micro_leverage, "x"),
            _field_row("Max / Day", AppState.settings_micro_max_per_day, AppState.set_settings_micro_max_per_day),
            spacing="1",
            width="100%",
        ),
    )


def _risk_card() -> rx.Component:
    """Risk management settings card."""
    return card(
        rx.vstack(
            _section_header("Risk Management"),
            _field_row("R:R Reject", AppState.settings_rr_floor_reject, AppState.set_settings_rr_floor_reject),
            _field_row("R:R Warn", AppState.settings_rr_floor_warn, AppState.set_settings_rr_floor_warn),
            _field_row("Risk Cap Reject", AppState.settings_risk_cap_reject, AppState.set_settings_risk_cap_reject, "%"),
            _field_row("Risk Cap Warn", AppState.settings_risk_cap_warn, AppState.set_settings_risk_cap_warn, "%"),
            _field_row("ROE at Stop Reject", AppState.settings_roe_reject, AppState.set_settings_roe_reject, "%"),
            _field_row("ROE at Stop Warn", AppState.settings_roe_warn, AppState.set_settings_roe_warn, "%"),
            _field_row("ROE Target", AppState.settings_roe_target, AppState.set_settings_roe_target, "%"),
            spacing="1",
            width="100%",
        ),
    )


def _sizing_card() -> rx.Component:
    """Position sizing settings card."""
    return card(
        rx.vstack(
            _section_header("Conviction Sizing"),
            _field_row("High Tier Margin", AppState.settings_tier_high, AppState.set_settings_tier_high, "%"),
            _field_row("Medium Tier Margin", AppState.settings_tier_medium, AppState.set_settings_tier_medium, "%"),
            _field_row("Speculative Margin", AppState.settings_tier_speculative, AppState.set_settings_tier_speculative, "%"),
            _field_row("Pass Threshold", AppState.settings_tier_pass, AppState.set_settings_tier_pass),
            spacing="1",
            width="100%",
        ),
    )


def _limits_card() -> rx.Component:
    """General limits card."""
    return card(
        rx.vstack(
            _section_header("General Limits"),
            _field_row("Max Position", AppState.settings_max_position, AppState.set_settings_max_position, "$", width="100px"),
            _field_row("Max Open Positions", AppState.settings_max_positions, AppState.set_settings_max_positions),
            _field_row("Max Daily Loss", AppState.settings_max_daily_loss, AppState.set_settings_max_daily_loss, "$", width="100px"),
            spacing="1",
            width="100%",
        ),
    )


def _scanner_card() -> rx.Component:
    """Scanner settings card."""
    return card(
        rx.vstack(
            _section_header("Scanner"),
            _field_row("Wake Threshold", AppState.settings_scanner_threshold, AppState.set_settings_scanner_threshold),
            _switch_row("Micro Detectors", AppState.settings_scanner_micro, AppState.set_settings_scanner_micro),
            _field_row("Max Wakes / Cycle", AppState.settings_scanner_max_wakes, AppState.set_settings_scanner_max_wakes),
            _switch_row("News Alerts", AppState.settings_scanner_news, AppState.set_settings_scanner_news),
            spacing="1",
            width="100%",
        ),
    )


def _header_bar() -> rx.Component:
    """Settings page header with save/reset buttons."""
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
        ),
        rx.hstack(
            rx.button(
                "Reset Defaults",
                on_click=AppState.reset_settings,
                variant="ghost",
                color="#737373",
                size="2",
                cursor="pointer",
                _hover={"color": "#ef4444"},
            ),
            rx.button(
                "Save",
                on_click=AppState.save_settings,
                background=rx.cond(AppState.settings_dirty, "#6366f1", "#333"),
                color="#fafafa",
                size="2",
                cursor="pointer",
                border="none",
                border_radius="6px",
                padding_x="1.5rem",
                _hover={"opacity": "0.9"},
            ),
            spacing="2",
        ),
        width="100%",
        justify="between",
        align="center",
        padding_bottom="1rem",
    )


def settings_page() -> rx.Component:
    """Settings page — two-column layout."""
    return rx.box(
        rx.vstack(
            _header_bar(),
            rx.hstack(
                # Left column
                rx.vstack(
                    _macro_card(),
                    _micro_card(),
                    _sizing_card(),
                    spacing="4",
                    flex="1",
                    min_width="0",
                ),
                # Right column
                rx.vstack(
                    _risk_card(),
                    _limits_card(),
                    _scanner_card(),
                    spacing="4",
                    flex="1",
                    min_width="0",
                ),
                spacing="4",
                width="100%",
                align_items="start",
            ),
            width="100%",
            max_width="960px",
            margin="0 auto",
            spacing="0",
        ),
        width="100%",
        height="100%",
        padding="24px",
        overflow_y="auto",
        style={
            "scrollbar_width": "none",
            "&::-webkit-scrollbar": {"display": "none"},
        },
    )
