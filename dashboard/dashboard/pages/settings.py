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


def _smart_money_card() -> rx.Component:
    return _card(
        "Smart Money", "brain",
        "Wallet tracking & copy trade alerts.",
        _toggle("Copy Trade Alerts", "Wake agent when tracked wallet enters a position",
                AppState.settings_sm_copy_alerts, AppState.set_settings_sm_copy_alerts),
        _toggle("Exit Alerts", "Wake agent when tracked wallet exits a position",
                AppState.settings_sm_exit_alerts, AppState.set_settings_sm_exit_alerts),
        _divider(),
        _field("Min Win Rate", "Minimum win rate for alerts (0.0 - 1.0)",
               AppState.settings_sm_min_win_rate, AppState.set_settings_sm_min_win_rate),
        _field("Min Position Size", "Minimum size to trigger alert",
               AppState.settings_sm_min_size, AppState.set_settings_sm_min_size, "$", input_width="90px"),
        _divider(),
        _toggle("Auto-Curation", "Automatically track profitable wallets",
                AppState.settings_sm_auto_curate, AppState.set_settings_sm_auto_curate),
        _field("Min Win Rate", "Auto-curate wallets above this win rate",
               AppState.settings_sm_auto_min_wr, AppState.set_settings_sm_auto_min_wr),
        _field("Min Trades", "Minimum trade count to qualify",
               AppState.settings_sm_auto_min_trades, AppState.set_settings_sm_auto_min_trades),
        _field("Min Profit Factor", "Minimum profit factor to qualify",
               AppState.settings_sm_auto_min_pf, AppState.set_settings_sm_auto_min_pf),
        _field("Max Auto Wallets", "Cap on total auto-curated wallets",
               AppState.settings_sm_auto_max_wallets, AppState.set_settings_sm_auto_max_wallets),
    )


def _preview_row(label: str, value, color: str = "#a3a3a3") -> rx.Component:
    """Single row in the Small Wins preview table."""
    return rx.hstack(
        rx.text(label, font_size="0.72rem", color="#525252", flex="1"),
        rx.text(value, font_size="0.72rem", color=color,
                font_family="JetBrains Mono, monospace", font_weight="500"),
        width="100%",
        justify="between",
        padding_y="0.2rem",
    )


def _small_wins_card() -> rx.Component:
    p = AppState.small_wins_preview
    return _card(
        "Small Wins Mode", "trending-up",
        "Daemon auto-exits at a small profit target. Agent handles entries; system handles exits.",
        _toggle(
            "Enable Small Wins Mode",
            "When ON: daemon market-closes positions at the ROE target below. Toggle off to restore normal TP exits.",
            AppState.settings_small_wins_mode,
            AppState.set_settings_small_wins_mode,
        ),
        _divider(),
        _field(
            "Exit ROE Target",
            "Gross ROE % to trigger mechanical exit. Fee break-even is enforced as minimum floor.",
            AppState.settings_small_wins_roe_pct,
            AppState.set_settings_small_wins_roe_pct,
            "%",
        ),
        _field(
            "Taker Fee (round-trip)",
            "TOTAL fee for entry + exit both sides (e.g. 0.07% = 3.5bps per side). Adjust to match your Hyperliquid tier.",
            AppState.settings_taker_fee_pct,
            AppState.set_settings_taker_fee_pct,
            "%",
        ),
        _divider(),
        # Live preview box
        rx.box(
            rx.vstack(
                rx.hstack(
                    rx.icon(tag="calculator", size=12, color="#6366f1"),
                    rx.text(
                        "Live Preview — what you earn per trade",
                        font_size="0.68rem",
                        font_weight="600",
                        color="#6366f1",
                        text_transform="uppercase",
                        letter_spacing="0.05em",
                    ),
                    spacing="2",
                    align="center",
                ),
                # Micro scenario (20x fixed)
                rx.text(
                    "Micro / Scalp  (" + p["leverage"].to(str) + "x)",
                    font_size="0.63rem", font_weight="600",
                    color="#6366f1", padding_bottom="0.15rem",
                    text_transform="uppercase", letter_spacing="0.04em",
                ),
                _preview_row(
                    "Round-trip fees:",
                    p["fee_be_roe"].to(str) + "% ROE  ←  " + p["fee_pct"].to(str) + "% × " + p["leverage"].to(str) + "x",
                    "#737373",
                ),
                _preview_row("Gross exit ROE:", p["exit_roe"].to(str) + "%", "#d4d4d4"),
                _preview_row("Net ROE after fees:", "+" + p["net_roe"].to(str) + "%", "#22c55e"),
                rx.box(height="0.4rem"),
                # Macro scenario (avg of configured macro leverage range)
                rx.text(
                    "Macro / Swing  (~" + p["macro_lev"].to(str) + "x avg)",
                    font_size="0.63rem", font_weight="600",
                    color="#a78bfa", padding_bottom="0.15rem",
                    text_transform="uppercase", letter_spacing="0.04em",
                ),
                _preview_row(
                    "Round-trip fees:",
                    p["macro_fee_be_roe"].to(str) + "% ROE  ←  " + p["fee_pct"].to(str) + "% × " + p["macro_lev"].to(str) + "x",
                    "#737373",
                ),
                _preview_row("Gross exit ROE:", p["macro_exit_roe"].to(str) + "%", "#d4d4d4"),
                _preview_row("Net ROE after fees:", "+" + p["macro_net_roe"].to(str) + "%", "#22c55e"),
                rx.box(height="0.4rem"),
                # Per-conviction dollar breakdown (macro — more representative for swing trades)
                rx.text(
                    rx.cond(
                        AppState.portfolio_value > 0,
                        "Portfolio: " + AppState.portfolio_value_str + "  (macro scenario)",
                        "Portfolio: —  (connect wallet to see $ amounts)",
                    ),
                    font_size="0.68rem",
                    color="#404040",
                    padding_bottom="0.2rem",
                ),
                _preview_row(
                    "High conviction (" + AppState.settings_tier_high.to(str) + "% margin = $" + p["high_margin"].to(str) + "):",
                    "+$" + p["macro_high_net_usd"].to(str) + " net",
                    rx.cond(AppState.portfolio_value > 0, "#4ade80", "#404040"),
                ),
                _preview_row(
                    "Medium conviction (" + AppState.settings_tier_medium.to(str) + "% margin = $" + p["med_margin"].to(str) + "):",
                    "+$" + p["macro_med_net_usd"].to(str) + " net",
                    rx.cond(AppState.portfolio_value > 0, "#4ade80", "#404040"),
                ),
                _preview_row(
                    "Speculative (" + AppState.settings_tier_speculative.to(str) + "% margin = $" + p["spec_margin"].to(str) + "):",
                    "+$" + p["macro_spec_net_usd"].to(str) + " net",
                    rx.cond(AppState.portfolio_value > 0, "#4ade80", "#404040"),
                ),
                spacing="0",
                width="100%",
            ),
            background="#0a0a0a",
            border="1px solid #1e1e2e",
            border_radius="8px",
            padding="0.75rem",
            margin_top="0.25rem",
            width="100%",
        ),
        # Status badge
        rx.cond(
            AppState.settings_small_wins_mode,
            rx.box(
                rx.hstack(
                    rx.icon(tag="zap", size=12, color="#eab308"),
                    rx.text(
                        "Mode is ON — daemon will override exits. Save settings to apply.",
                        font_size="0.7rem",
                        color="#eab308",
                    ),
                    spacing="2",
                    align="center",
                ),
                background="rgba(234, 179, 8, 0.06)",
                border="1px solid rgba(234, 179, 8, 0.2)",
                border_radius="6px",
                padding="0.5rem 0.75rem",
                margin_top="0.5rem",
                width="100%",
            ),
            rx.box(
                rx.hstack(
                    rx.icon(tag="circle", size=12, color="#404040"),
                    rx.text(
                        "Mode is OFF — normal TP/SL exits apply.",
                        font_size="0.7rem",
                        color="#404040",
                    ),
                    spacing="2",
                    align="center",
                ),
                margin_top="0.5rem",
                width="100%",
            ),
        ),
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
                        _small_wins_card(),
                        spacing="5",
                        width="100%",
                    ),
                    # Right column
                    rx.vstack(
                        _risk_card(),
                        _limits_card(),
                        _scanner_card(),
                        _smart_money_card(),
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
