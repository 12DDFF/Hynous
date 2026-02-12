"""Debug dashboard — full pipeline transparency for agent.chat() calls."""

import reflex as rx
from ..state import AppState


# ---- Sidebar Components ----

def _trace_item(trace: dict) -> rx.Component:
    """Single trace row in the sidebar. Single-arg lambda for rx.foreach."""
    return rx.box(
        rx.vstack(
            rx.hstack(
                # Source badge
                rx.text(
                    trace["source"],
                    font_size="0.65rem",
                    font_weight="500",
                    color="#a5b4fc",
                    background="#1e1b4b",
                    padding="1px 6px",
                    border_radius="4px",
                    white_space="nowrap",
                    overflow="hidden",
                    text_overflow="ellipsis",
                    max_width="120px",
                ),
                rx.spacer(),
                # Status dot
                rx.box(
                    width="6px",
                    height="6px",
                    border_radius="50%",
                    background=rx.match(
                        trace["status"],
                        ("completed", "#22c55e"),
                        ("error", "#ef4444"),
                        ("in_progress", "#f59e0b"),
                        "#525252",
                    ),
                    flex_shrink="0",
                ),
                # Duration
                rx.text(
                    trace["total_duration_ms"].to(str) + "ms",
                    font_size="0.65rem",
                    color="#525252",
                    font_family="JetBrains Mono, monospace",
                ),
                spacing="2",
                align="center",
                width="100%",
            ),
            # Input summary
            rx.text(
                trace["input_summary"].to(str),
                font_size="0.72rem",
                color="#a3a3a3",
                overflow="hidden",
                text_overflow="ellipsis",
                white_space="nowrap",
                width="100%",
            ),
            # Timestamp + span count
            rx.hstack(
                rx.text(
                    trace["started_at"].to(str),
                    font_size="0.6rem",
                    color="#404040",
                    font_family="JetBrains Mono, monospace",
                ),
                rx.spacer(),
                rx.text(
                    trace["span_count"].to(str) + " spans",
                    font_size="0.6rem",
                    color="#404040",
                ),
                width="100%",
            ),
            spacing="1",
            width="100%",
        ),
        padding="8px 10px",
        border_radius="6px",
        cursor="pointer",
        background=rx.cond(
            AppState.debug_selected_trace_id == trace["trace_id"],
            "#1a1a1a",
            "transparent",
        ),
        border=rx.cond(
            AppState.debug_selected_trace_id == trace["trace_id"],
            "1px solid #2a2a2a",
            "1px solid transparent",
        ),
        _hover={"background": "#141414"},
        on_click=AppState.select_debug_trace(trace["trace_id"]),
        width="100%",
    )


def _sidebar() -> rx.Component:
    """Trace list sidebar."""
    return rx.vstack(
        # Header
        rx.hstack(
            rx.icon("bug", size=14, color="#6366f1"),
            rx.text(
                "TRACES",
                font_size="0.7rem",
                font_weight="600",
                color="#737373",
                text_transform="uppercase",
                letter_spacing="0.05em",
            ),
            rx.spacer(),
            rx.button(
                rx.icon("refresh-cw", size=12),
                on_click=AppState.refresh_debug_traces,
                background="transparent",
                color="#525252",
                border="none",
                cursor="pointer",
                padding="4px",
                min_width="auto",
                height="auto",
                _hover={"color": "#fafafa"},
            ),
            spacing="2",
            align="center",
            width="100%",
            padding_bottom="8px",
            border_bottom="1px solid #1a1a1a",
        ),

        # Trace list
        rx.cond(
            AppState.debug_traces.length() > 0,
            rx.box(
                rx.foreach(AppState.debug_traces, _trace_item),
                width="100%",
                overflow_y="auto",
                flex="1",
                sx={
                    "&::-webkit-scrollbar": {"width": "4px"},
                    "&::-webkit-scrollbar-track": {"background": "transparent"},
                    "&::-webkit-scrollbar-thumb": {
                        "background": "#2a2a2a",
                        "border_radius": "2px",
                    },
                },
            ),
            rx.center(
                rx.text("No traces yet", font_size="0.75rem", color="#404040"),
                padding="2rem",
                width="100%",
            ),
        ),

        spacing="2",
        width="280px",
        min_width="280px",
        height="100%",
        padding="12px",
        border_right="1px solid #1a1a1a",
        overflow="hidden",
    )


# ---- Span Detail Components ----

def _span_row(span: dict) -> rx.Component:
    """Single span row in the timeline. Single-arg lambda for rx.foreach.

    The span dict is pre-processed by debug_spans_display computed var,
    so it has: span_id, label, color, summary, duration_ms, is_error, detail_json.
    """
    is_expanded = AppState.debug_selected_span_id == span["span_id"]

    return rx.box(
        rx.vstack(
            # Collapsed row — always visible
            rx.hstack(
                rx.icon(
                    rx.cond(is_expanded, "chevron-down", "chevron-right"),
                    size=12, color="#525252",
                ),
                # Span type badge
                rx.text(
                    span["label"],
                    font_size="0.6rem",
                    font_weight="600",
                    color=span["color"],
                    padding="1px 6px",
                    border_radius="3px",
                    text_transform="uppercase",
                    letter_spacing="0.03em",
                    white_space="nowrap",
                ),
                # Summary text
                rx.text(
                    span["summary"],
                    font_size="0.72rem",
                    color="#a3a3a3",
                    overflow="hidden",
                    text_overflow="ellipsis",
                    white_space="nowrap",
                    flex="1",
                ),
                rx.spacer(),
                # Duration
                rx.text(
                    span["duration_ms"].to(str) + "ms",
                    font_size="0.65rem",
                    color="#525252",
                    font_family="JetBrains Mono, monospace",
                ),
                # Error indicator
                rx.cond(
                    span["is_error"],
                    rx.box(
                        width="6px", height="6px", border_radius="50%",
                        background="#ef4444", flex_shrink="0",
                    ),
                    rx.fragment(),
                ),
                spacing="2",
                align="center",
                width="100%",
            ),

            # Expanded detail — shown when this span is selected
            rx.cond(
                is_expanded,
                rx.box(
                    rx.code_block(
                        span["detail_json"],
                        language="json",
                        theme="dark",
                        width="100%",
                    ),
                    padding="8px 0 0 24px",
                    width="100%",
                ),
                rx.fragment(),
            ),

            spacing="1",
            width="100%",
        ),
        padding="6px 8px",
        border_radius="4px",
        cursor="pointer",
        _hover={"background": "#141414"},
        on_click=AppState.toggle_debug_span(span["span_id"]),
        width="100%",
        border_left_width="2px",
        border_left_style="solid",
        border_left_color=span["color"],
        margin_left="8px",
    )


def _trace_detail() -> rx.Component:
    """Main area: selected trace detail view."""
    trace = AppState.debug_selected_trace

    return rx.cond(
        AppState.debug_selected_trace_id != "",
        rx.vstack(
            # Header
            rx.vstack(
                rx.hstack(
                    rx.text(
                        trace["trace_id"].to(str),
                        font_size="0.85rem",
                        font_weight="600",
                        color="#fafafa",
                        font_family="JetBrains Mono, monospace",
                    ),
                    rx.spacer(),
                    rx.text(
                        trace.get("status", ""),
                        font_size="0.7rem",
                        font_weight="500",
                        color=rx.match(
                            trace.get("status", ""),
                            ("completed", "#22c55e"),
                            ("error", "#ef4444"),
                            ("in_progress", "#f59e0b"),
                            "#525252",
                        ),
                        text_transform="uppercase",
                    ),
                    width="100%",
                    align="center",
                ),
                rx.hstack(
                    rx.text("Source: ", font_size="0.7rem", color="#525252"),
                    rx.text(trace.get("source", ""), font_size="0.7rem", color="#a5b4fc"),
                    rx.text(" | Duration: ", font_size="0.7rem", color="#525252"),
                    rx.text(
                        trace.get("total_duration_ms", 0).to(str) + "ms",
                        font_size="0.7rem", color="#fafafa",
                        font_family="JetBrains Mono, monospace",
                    ),
                    spacing="1",
                    align="center",
                ),
                rx.text(
                    trace.get("input_summary", ""),
                    font_size="0.75rem",
                    color="#a3a3a3",
                    padding_top="4px",
                ),
                spacing="1",
                width="100%",
                padding="12px 16px",
                background="#141414",
                border_radius="8px",
                border="1px solid #1a1a1a",
            ),

            # Error panel (if error)
            rx.cond(
                trace.get("error", "") != "",
                rx.box(
                    rx.hstack(
                        rx.icon("triangle-alert", size=14, color="#ef4444"),
                        rx.text("Error", font_size="0.75rem", font_weight="600", color="#ef4444"),
                        spacing="2",
                        align="center",
                    ),
                    rx.text(
                        trace.get("error", ""),
                        font_size="0.72rem",
                        color="#fca5a5",
                        font_family="JetBrains Mono, monospace",
                        white_space="pre-wrap",
                        padding_top="4px",
                    ),
                    padding="10px 14px",
                    background="#1c0a0a",
                    border="1px solid #3b1111",
                    border_radius="6px",
                    width="100%",
                ),
                rx.fragment(),
            ),

            # Timeline — uses debug_spans_display (pre-processed in state)
            rx.vstack(
                rx.text(
                    "TIMELINE",
                    font_size="0.65rem",
                    font_weight="600",
                    color="#525252",
                    text_transform="uppercase",
                    letter_spacing="0.05em",
                    padding_bottom="4px",
                ),
                rx.foreach(
                    AppState.debug_spans_display,
                    _span_row,
                ),
                spacing="1",
                width="100%",
            ),

            # Output summary
            rx.cond(
                trace.get("output_summary", "") != "",
                rx.box(
                    rx.text(
                        "OUTPUT",
                        font_size="0.65rem",
                        font_weight="600",
                        color="#525252",
                        text_transform="uppercase",
                        letter_spacing="0.05em",
                    ),
                    rx.text(
                        trace.get("output_summary", ""),
                        font_size="0.75rem",
                        color="#a3a3a3",
                        padding_top="4px",
                    ),
                    padding="12px 16px",
                    background="#141414",
                    border_radius="8px",
                    border="1px solid #1a1a1a",
                    width="100%",
                ),
                rx.fragment(),
            ),

            spacing="3",
            width="100%",
            padding="16px",
            overflow_y="auto",
            flex="1",
            sx={
                "&::-webkit-scrollbar": {"width": "4px"},
                "&::-webkit-scrollbar-track": {"background": "transparent"},
                "&::-webkit-scrollbar-thumb": {
                    "background": "#2a2a2a",
                    "border_radius": "2px",
                },
            },
        ),
        # Empty state
        rx.center(
            rx.vstack(
                rx.icon("terminal", size=32, color="#2a2a2a"),
                rx.text(
                    "Select a trace to inspect",
                    font_size="0.85rem",
                    color="#404040",
                ),
                spacing="3",
                align="center",
            ),
            width="100%",
            height="100%",
        ),
    )


# ---- Main Page ----

def debug_page() -> rx.Component:
    """Debug dashboard page — trace list + detail view."""
    return rx.hstack(
        _sidebar(),
        _trace_detail(),
        spacing="0",
        width="100%",
        height="100%",
        background="#0a0a0a",
    )
