"""Journal page (v2) — trade list, detail view, and pattern browser.

Consumes `/api/v2/journal/*` via the fetchers in ``state.py``. All data is
served by the dashboard-owned ``JournalStore`` mounted in
``dashboard/dashboard/dashboard.py``.
"""

import reflex as rx
from ..state import AppState, TradeRow
from ..components import card, stat_card


# =============================================================================
# Top-level page
# =============================================================================

def journal_page() -> rx.Component:
    """v2 Journal — primary destination for trade transparency."""
    return rx.box(
        _header_stats(),
        _filters_bar(),
        rx.cond(
            AppState.journal_view_mode == "detail",
            _trade_detail_view(),
            rx.cond(
                AppState.journal_view_mode == "patterns",
                _patterns_view(),
                _trade_list_view(),
            ),
        ),
        padding="1.5rem",
        padding_top="5rem",
        width="100%",
    )


# =============================================================================
# Header stats
# =============================================================================

def _header_stats() -> rx.Component:
    """Top bar with aggregate stats pulled from /api/v2/journal/stats."""
    stats = AppState.journal_stats
    return rx.grid(
        stat_card("Win Rate", stats["win_rate"].to_string() + "%", "closed trades"),
        stat_card(
            "Total PnL",
            "$" + stats["total_pnl"].to_string(),
            "net realized",
        ),
        stat_card("Profit Factor", stats["profit_factor"].to_string(), "gross profit / loss"),
        stat_card("Trades", stats["total_trades"].to_string(), "all statuses"),
        stat_card("Avg Hold", stats["avg_hold_s"].to_string() + "s", "per trade"),
        columns="5",
        gap="3",
        width="100%",
    )


# =============================================================================
# Filters / view-mode bar
# =============================================================================

def _filters_bar() -> rx.Component:
    return rx.hstack(
        rx.select(
            ["all", "closed", "rejected", "analyzed", "open"],
            value=AppState.journal_filter_status,
            on_change=AppState.set_journal_filter_status,
        ),
        rx.select(
            [
                "all",
                "trailing_stop",
                "breakeven_stop",
                "dynamic_protective_sl",
                "tp_hit",
                "manual_close",
                "liquidation",
            ],
            value=AppState.journal_filter_exit_classification,
            on_change=AppState.set_journal_filter_exit_classification,
        ),
        rx.input(
            placeholder="Semantic search…",
            on_blur=AppState.search_journal,
            width="260px",
        ),
        rx.spacer(),
        rx.button(
            "List",
            on_click=AppState.set_journal_view_mode("list"),
            background=rx.cond(AppState.journal_view_mode == "list", "#262626", "transparent"),
            color="#e5e5e5",
            border="1px solid #262626",
            size="2",
        ),
        rx.button(
            "Patterns",
            on_click=AppState.set_journal_view_mode("patterns"),
            background=rx.cond(AppState.journal_view_mode == "patterns", "#262626", "transparent"),
            color="#e5e5e5",
            border="1px solid #262626",
            size="2",
        ),
        padding_y="1rem",
        width="100%",
        align="center",
        spacing="2",
    )


# =============================================================================
# Trade list view
# =============================================================================

def _trade_list_view() -> rx.Component:
    return rx.cond(
        AppState.journal_trades.length() > 0,
        rx.vstack(
            rx.foreach(AppState.journal_trades, _trade_row),
            spacing="1",
            width="100%",
        ),
        card(
            rx.vstack(
                rx.icon("inbox", size=28, color="#333"),
                rx.text("No trades match these filters.", color="#525252", font_size="0.9rem"),
                spacing="2",
                align="center",
                padding_y="2rem",
            ),
            width="100%",
        ),
    )


def _trade_row(trade: TradeRow) -> rx.Component:
    return rx.box(
        rx.hstack(
            rx.text(trade.symbol, font_weight="600", color="#e5e5e5", width="80px"),
            rx.text(
                trade.side,
                color=rx.cond(trade.side == "long", "#4ade80", "#f87171"),
                font_weight="500",
                width="60px",
            ),
            rx.text(trade.entry_ts[:16], color="#737373", font_size="0.8rem", width="140px"),
            rx.text("$" + trade.entry_px.to_string(), color="#a3a3a3", width="110px"),
            rx.text("→ $" + trade.exit_px.to_string(), color="#a3a3a3", width="120px"),
            rx.text(
                trade.roe_pct.to_string() + "%",
                color=rx.cond(trade.roe_pct >= 0, "#4ade80", "#f87171"),
                font_weight="500",
                width="80px",
            ),
            rx.text(trade.exit_classification, color="#737373", font_size="0.8rem", width="160px"),
            rx.cond(
                trade.process_quality_score > 0,
                rx.text("Grade " + trade.process_quality_score.to_string(), color="#a78bfa", font_size="0.8rem"),
                rx.fragment(),
            ),
            rx.text(trade.one_line_summary, color="#888", font_size="0.8rem"),
            spacing="3",
            align="center",
            width="100%",
        ),
        padding="0.6rem 0.75rem",
        border_bottom="1px solid #1a1a1a",
        cursor="pointer",
        on_click=AppState.select_trade(trade.trade_id),
        _hover={"background": "#111"},
        width="100%",
    )


# =============================================================================
# Trade detail view
# =============================================================================

def _trade_detail_view() -> rx.Component:
    return rx.vstack(
        rx.button(
            "← Back to list",
            on_click=AppState.set_journal_view_mode("list"),
            background="transparent",
            color="#a3a3a3",
            size="2",
        ),
        _trade_summary_panel(),
        _trade_narrative_with_citations(),
        _trade_grades_panel(),
        _trade_mistake_tags(),
        _trade_findings_list(),
        _trade_events_timeline(),
        _trade_related_panel(),
        rx.button(
            "Re-analyze (coming soon)",
            disabled=True,
            background="#1a1a1a",
            color="#525252",
            size="2",
        ),
        spacing="4",
        width="100%",
        align_items="stretch",
    )


def _trade_summary_panel() -> rx.Component:
    detail = AppState.journal_selected_trade_detail
    return card(
        rx.vstack(
            rx.heading(detail["symbol"].to_string() + "  " + detail["side"].to_string(), size="4"),
            rx.text("Entry: $" + detail["entry_px"].to_string() + " at " + detail["entry_ts"].to_string(), color="#a3a3a3"),
            rx.text("Exit: $" + detail["exit_px"].to_string() + " at " + detail["exit_ts"].to_string(), color="#a3a3a3"),
            rx.text("PnL: $" + detail["realized_pnl_usd"].to_string(), color="#e5e5e5"),
            rx.text("ROE: " + detail["roe_pct"].to_string() + "%", color="#e5e5e5"),
            rx.text("Classification: " + detail["exit_classification"].to_string(), color="#737373", font_size="0.85rem"),
            spacing="1",
            align_items="start",
        ),
        width="100%",
    )


def _trade_narrative_with_citations() -> rx.Component:
    analysis = AppState.journal_selected_trade_analysis
    return card(
        rx.vstack(
            rx.heading("Analysis", size="4"),
            rx.text(analysis["narrative"].to_string(), color="#e5e5e5", line_height="1.55"),
            rx.hstack(
                rx.foreach(analysis["narrative_citations"].to(list[str]), _citation_chip),
                spacing="2",
                wrap="wrap",
            ),
            spacing="3",
            align_items="start",
        ),
        width="100%",
    )


def _citation_chip(cite) -> rx.Component:
    return rx.text(
        cite.to_string(),
        padding="0.2rem 0.5rem",
        background="#1a1a1a",
        color="#737373",
        border_radius="4px",
        font_size="0.7rem",
        font_family="monospace",
    )


def _trade_grades_panel() -> rx.Component:
    grades = AppState.journal_selected_trade_analysis["grades"].to(dict)
    score = AppState.journal_selected_trade_analysis["process_quality_score"].to(int)
    return card(
        rx.vstack(
            rx.heading("Grades", size="4"),
            _grade_bar("Entry Quality", grades["entry_quality_grade"].to(int)),
            _grade_bar("Entry Timing", grades["entry_timing_grade"].to(int)),
            _grade_bar("SL Placement", grades["sl_placement_grade"].to(int)),
            _grade_bar("TP Placement", grades["tp_placement_grade"].to(int)),
            _grade_bar("Size / Leverage", grades["size_leverage_grade"].to(int)),
            _grade_bar("Exit Quality", grades["exit_quality_grade"].to(int)),
            rx.text(
                "Process Quality: " + score.to_string() + "/100",
                color="#a78bfa",
                font_weight="500",
            ),
            spacing="2",
            align_items="start",
        ),
        width="100%",
    )


def _grade_bar(label: str, value) -> rx.Component:
    return rx.hstack(
        rx.text(label, color="#a3a3a3", font_size="0.85rem", width="140px"),
        rx.box(
            background=rx.cond(
                value >= 70,
                "#4ade80",
                rx.cond(value >= 40, "#fbbf24", "#f87171"),
            ),
            width=value.to_string() + "%",
            height="10px",
            border_radius="4px",
            max_width="300px",
        ),
        rx.text(value.to_string(), color="#a3a3a3", font_size="0.8rem"),
        spacing="3",
        align="center",
    )


def _trade_mistake_tags() -> rx.Component:
    tags = AppState.journal_selected_trade_analysis["mistake_tags"].to(list[str])
    return card(
        rx.vstack(
            rx.heading("Mistake Tags", size="4"),
            rx.hstack(rx.foreach(tags, _tag_chip), wrap="wrap", spacing="2"),
            spacing="2",
            align_items="start",
        ),
        width="100%",
    )


def _tag_chip(tag) -> rx.Component:
    return rx.text(
        tag,
        padding="0.25rem 0.55rem",
        background="#2a1a1a",
        color="#f87171",
        border_radius="4px",
        font_size="0.75rem",
        font_weight="500",
    )


def _trade_findings_list() -> rx.Component:
    findings = AppState.journal_selected_trade_analysis["findings"].to(list[dict])
    return card(
        rx.vstack(
            rx.heading("Findings (evidence)", size="4"),
            rx.foreach(findings, _finding_row),
            spacing="2",
            align_items="start",
        ),
        width="100%",
    )


def _finding_row(finding) -> rx.Component:
    return rx.box(
        rx.hstack(
            rx.text(finding["id"], font_weight="600", font_family="monospace", color="#e5e5e5", width="120px"),
            rx.text(finding["type"], color="#a78bfa", font_size="0.8rem", width="140px"),
            rx.text(finding["severity"], color="#a3a3a3", font_size="0.8rem", width="80px"),
            rx.text(finding["interpretation"], color="#a3a3a3", font_size="0.85rem"),
            spacing="3",
            align="center",
        ),
        padding="0.5rem 0.75rem",
        border_left=rx.cond(
            finding["severity"] == "high",
            "3px solid #f87171",
            rx.cond(finding["severity"] == "medium", "3px solid #fbbf24", "3px solid #4ade80"),
        ),
        padding_left="1rem",
        margin_bottom="0.35rem",
        background="#0f0f0f",
        border_radius="4px",
    )


def _trade_events_timeline() -> rx.Component:
    events = AppState.journal_selected_trade_events.to(list[dict])
    return card(
        rx.vstack(
            rx.heading("Lifecycle", size="4"),
            rx.foreach(events, _event_row),
            spacing="1",
            align_items="start",
        ),
        width="100%",
    )


def _event_row(event) -> rx.Component:
    return rx.hstack(
        rx.text(event["ts"].to_string()[:19], color="#525252", font_size="0.75rem", width="150px"),
        rx.text(event["event_type"].to_string(), color="#e5e5e5", font_weight="500", width="180px"),
        rx.code(
            event["payload"].to_string()[:120],
            color="#737373",
            font_size="0.7rem",
        ),
        spacing="3",
        align="center",
        width="100%",
    )


def _trade_related_panel() -> rx.Component:
    related = AppState.journal_selected_trade_related.to(list[dict])
    return card(
        rx.vstack(
            rx.heading("Related Trades", size="4"),
            rx.foreach(related, _related_row),
            spacing="1",
            align_items="start",
        ),
        width="100%",
    )


def _related_row(item) -> rx.Component:
    return rx.hstack(
        rx.text(
            item["side"].to_string() + " " + item["symbol"].to_string(),
            padding="0.15rem 0.5rem",
            background="#1a1a1a",
            color="#e5e5e5",
            border_radius="4px",
            font_size="0.75rem",
            font_weight="500",
        ),
        rx.text(item["edge_type"].to_string(), color="#a78bfa", font_size="0.8rem", width="140px"),
        rx.text(item["reason"].to_string(), color="#a3a3a3", font_size="0.8rem"),
        rx.text("(" + item["status"].to_string() + ")", color="#525252", font_size="0.75rem"),
        spacing="3",
        align="center",
        cursor="pointer",
        on_click=AppState.select_trade(item["other_id"]),
        padding_y="0.3rem",
        width="100%",
        _hover={"background": "#111"},
    )


# =============================================================================
# Patterns view
# =============================================================================

def _patterns_view() -> rx.Component:
    return rx.vstack(
        rx.heading("System Health Reports", size="5", color="#e5e5e5"),
        rx.cond(
            AppState.journal_patterns.length() > 0,
            rx.vstack(
                rx.foreach(AppState.journal_patterns, _pattern_card),
                spacing="3",
                width="100%",
            ),
            card(
                rx.vstack(
                    rx.icon("calendar", size=28, color="#333"),
                    rx.text("No pattern rollups available yet.", color="#525252", font_size="0.9rem"),
                    spacing="2",
                    align="center",
                    padding_y="2rem",
                ),
                width="100%",
            ),
        ),
        spacing="3",
        width="100%",
    )


def _pattern_card(pattern) -> rx.Component:
    return card(
        rx.vstack(
            rx.heading(pattern["title"].to_string(), size="4", color="#e5e5e5"),
            rx.text(pattern["description"].to_string(), color="#a3a3a3", line_height="1.5"),
            rx.text(
                "updated " + pattern["updated_at"].to_string()[:16],
                color="#666",
                font_size="0.75rem",
            ),
            spacing="2",
            align_items="start",
        ),
        width="100%",
    )
