"""Memory management page — clusters, health, conflicts, stale cleanup."""

import reflex as rx
from ..state import AppState, ClusterDisplay, ConflictItem


# --- Sidebar Components ---

def _section_header(label: str, icon_name: str, icon_color: str = "#737373") -> rx.Component:
    """Section header with icon + uppercase label."""
    return rx.hstack(
        rx.icon(icon_name, size=14, color=icon_color),
        rx.text(
            label,
            font_size="0.7rem",
            font_weight="600",
            color="#737373",
            text_transform="uppercase",
            letter_spacing="0.05em",
        ),
        spacing="2",
        align="center",
    )


def _cluster_item(cluster) -> rx.Component:
    """Single cluster row in sidebar with health bar."""
    return rx.vstack(
        rx.hstack(
            rx.box(
                width="6px",
                height="6px",
                border_radius="50%",
                background=cluster.accent,
                flex_shrink="0",
            ),
            rx.text(
                cluster.name,
                font_size="0.78rem",
                font_weight="500",
                color="#fafafa",
                flex="1",
                overflow="hidden",
                text_overflow="ellipsis",
                white_space="nowrap",
            ),
            rx.text(
                cluster.node_count,
                font_size="0.72rem",
                color="#525252",
                font_weight="500",
            ),
            spacing="2",
            align="center",
            width="100%",
        ),
        rx.cond(
            cluster.health_html != "",
            rx.html(cluster.health_html),
            rx.fragment(),
        ),
        spacing="0",
        width="100%",
        padding="0.375rem 0.5rem",
        border_radius="6px",
        _hover={"background": "#1a1a1a"},
    )


def _clusters_section() -> rx.Component:
    """Knowledge clusters section."""
    return rx.vstack(
        rx.hstack(
            _section_header("Clusters", "brain", "#a5b4fc"),
            rx.spacer(),
            rx.text(
                AppState.cluster_total,
                font_size="0.65rem",
                color="#404040",
            ),
            width="100%",
            align="center",
        ),
        rx.cond(
            AppState.cluster_displays.length() > 0,
            rx.vstack(
                rx.foreach(AppState.cluster_displays, _cluster_item),
                spacing="0",
                width="100%",
            ),
            rx.text("No clusters", font_size="0.75rem", color="#404040", padding="0.5rem"),
        ),
        spacing="2",
        width="100%",
    )


def _health_section() -> rx.Component:
    """Memory health overview."""
    return rx.vstack(
        _section_header("Health", "activity", "#22c55e"),
        rx.hstack(
            rx.vstack(
                rx.text(AppState.memory_node_count, font_size="1.1rem", font_weight="600", color="#fafafa"),
                rx.text("nodes", font_size="0.65rem", color="#525252"),
                spacing="0",
                align="center",
                flex="1",
            ),
            rx.vstack(
                rx.text(AppState.memory_edge_count, font_size="1.1rem", font_weight="600", color="#fafafa"),
                rx.text("edges", font_size="0.65rem", color="#525252"),
                spacing="0",
                align="center",
                flex="1",
            ),
            rx.vstack(
                rx.text(AppState.memory_health_ratio, font_size="1.1rem", font_weight="600", color="#22c55e"),
                rx.text("healthy", font_size="0.65rem", color="#525252"),
                spacing="0",
                align="center",
                flex="1",
            ),
            width="100%",
        ),
        rx.box(
            rx.html(AppState.memory_lifecycle_html),
            width="100%",
            padding_x="0.25rem",
        ),
        spacing="3",
        width="100%",
    )


def _action_button(label: str, icon_name: str, color: str, on_click, badge_count=None, is_loading=None) -> rx.Component:
    """Action button with optional badge."""
    badge = rx.fragment()
    if badge_count is not None:
        badge = rx.cond(
            badge_count != "0",
            rx.badge(badge_count, variant="soft", color_scheme="red", size="1"),
            rx.fragment(),
        )

    content = rx.hstack(
        rx.icon(icon_name, size=14, color=color),
        rx.text(label, font_size="0.78rem", color="#a3a3a3"),
        rx.spacer(),
        badge,
        spacing="2",
        align="center",
        width="100%",
    )

    if is_loading is not None:
        content = rx.cond(
            is_loading,
            rx.hstack(
                rx.spinner(size="1"),
                rx.text("Running...", font_size="0.78rem", color="#525252"),
                spacing="2",
                align="center",
                width="100%",
            ),
            content,
        )

    return rx.box(
        content,
        padding="0.5rem 0.625rem",
        border_radius="6px",
        cursor="pointer",
        transition="all 0.15s ease",
        _hover={"background": "#1a1a1a"},
        on_click=on_click,
        width="100%",
    )


def _actions_section() -> rx.Component:
    """Actions panel."""
    return rx.vstack(
        _section_header("Actions", "settings", "#737373"),
        _action_button(
            "Run Decay", "zap", "#eab308",
            AppState.run_decay,
            is_loading=AppState.decay_running,
        ),
        _action_button(
            "Conflicts", "triangle-alert", "#ef4444",
            AppState.toggle_conflicts,
            badge_count=AppState.conflict_count,
        ),
        _action_button(
            "Stale Memories", "archive", "#525252",
            AppState.toggle_stale,
            badge_count=AppState.stale_count,
        ),
        _action_button(
            "Backfill Embeddings", "sparkles", "#a5b4fc",
            AppState.run_backfill,
            is_loading=AppState.backfill_running,
        ),
        # Backfill result display
        rx.cond(
            AppState.backfill_result != "",
            rx.text(
                AppState.backfill_result,
                font_size="0.7rem",
                color="#525252",
                padding="0.25rem 0.625rem",
            ),
            rx.fragment(),
        ),
        _action_button(
            "Backfill Clusters", "brain", "#a5b4fc",
            AppState.run_cluster_backfill,
            is_loading=AppState.cluster_backfill_running,
        ),
        # Cluster backfill result display
        rx.cond(
            AppState.cluster_backfill_result != "",
            rx.text(
                AppState.cluster_backfill_result,
                font_size="0.7rem",
                color="#525252",
                padding="0.25rem 0.625rem",
            ),
            rx.fragment(),
        ),
        # Decay result display
        rx.cond(
            AppState.decay_result != "",
            rx.text(
                AppState.decay_result,
                font_size="0.7rem",
                color="#525252",
                padding="0.25rem 0.625rem",
            ),
            rx.fragment(),
        ),
        spacing="1",
        width="100%",
    )


def _sidebar() -> rx.Component:
    """Left sidebar — Health first, then Clusters, then Actions."""
    return rx.box(
        rx.vstack(
            _health_section(),
            rx.divider(border_color="#1a1a1a"),
            _clusters_section(),
            rx.divider(border_color="#1a1a1a"),
            _actions_section(),
            spacing="4",
            width="100%",
            padding="1rem",
        ),
        width="280px",
        min_width="280px",
        height="100%",
        overflow_y="auto",
        background="#0d0d0d",
        border_right="1px solid #1a1a1a",
        style={
            "scrollbar_width": "thin",
            "scrollbar_color": "#262626 transparent",
        },
    )


# --- Main Area ---

def _main_area() -> rx.Component:
    """Right side: graph only (stats are in the graph's built-in overlay)."""
    return rx.box(
        rx.el.iframe(
            src="/graph.html",
            width="100%",
            height="100%",
            border="none",
        ),
        flex="1",
        width="100%",
        height="100%",
    )


# --- Dialogs ---

def _conflict_card(item: ConflictItem) -> rx.Component:
    """Single conflict card with per-item resolve buttons."""
    return rx.box(
        rx.vstack(
            # Header: type + confidence
            rx.hstack(
                rx.text(item.conflict_type, font_size="0.72rem", font_weight="500", color="#eab308"),
                rx.spacer(),
                rx.text(item.confidence + " confidence", font_size="0.7rem", color="#525252"),
                width="100%",
                align="center",
            ),
            # OLD block
            rx.box(
                rx.text("OLD", font_size="0.7rem", color="#a3a3a3", margin_bottom="2px"),
                rx.text(item.old_title, font_size="0.78rem", font_weight="500", color="#fafafa"),
                rx.cond(
                    item.old_body != "",
                    rx.text(item.old_body, font_size="0.7rem", color="#737373", margin_top="2px"),
                    rx.fragment(),
                ),
                padding="0.5rem",
                background="#111",
                border_left="2px solid #ef4444",
                border_radius="0 4px 4px 0",
            ),
            # NEW block
            rx.box(
                rx.text("NEW", font_size="0.7rem", color="#a3a3a3", margin_bottom="2px"),
                rx.text(item.new_title, font_size="0.78rem", font_weight="500", color="#fafafa"),
                rx.cond(
                    item.new_body != "",
                    rx.text(item.new_body, font_size="0.7rem", color="#737373", margin_top="2px"),
                    rx.fragment(),
                ),
                padding="0.5rem",
                background="#111",
                border_left="2px solid #22c55e",
                border_radius="0 4px 4px 0",
            ),
            # Action buttons
            rx.hstack(
                rx.button(
                    "Keep New",
                    variant="soft",
                    color_scheme="green",
                    size="1",
                    on_click=lambda: AppState.resolve_one_conflict(item.conflict_id, "new_is_current"),
                ),
                rx.button(
                    "Keep Old",
                    variant="soft",
                    color_scheme="red",
                    size="1",
                    on_click=lambda: AppState.resolve_one_conflict(item.conflict_id, "old_is_current"),
                ),
                rx.button(
                    "Keep Both",
                    variant="soft",
                    color_scheme="gray",
                    size="1",
                    on_click=lambda: AppState.resolve_one_conflict(item.conflict_id, "keep_both"),
                ),
                spacing="2",
            ),
            spacing="2",
            width="100%",
        ),
        padding="0.75rem",
        background="#0d0d0d",
        border="1px solid #1a1a1a",
        border_radius="8px",
        margin_bottom="0.5rem",
        width="100%",
    )


def _conflicts_dialog() -> rx.Component:
    """Conflict resolution dialog."""
    return rx.dialog.root(
        rx.dialog.content(
            rx.vstack(
                rx.hstack(
                    rx.icon("triangle-alert", size=18, color="#ef4444"),
                    rx.text("Pending Conflicts", font_weight="600", font_size="1rem"),
                    rx.spacer(),
                    rx.badge(AppState.conflict_count, variant="soft", color_scheme="red"),
                    rx.dialog.close(
                        rx.icon("x", size=16, color="#525252", cursor="pointer", _hover={"color": "#fafafa"}),
                    ),
                    spacing="2",
                    align="center",
                    width="100%",
                ),
                rx.text(
                    "Contradictions detected in your knowledge base. Resolve them below.",
                    font_size="0.8rem",
                    color="#525252",
                ),
                # Batch action bar
                rx.cond(
                    AppState.conflict_count != "0",
                    rx.hstack(
                        rx.button(
                            "Resolve All: Keep New",
                            variant="soft",
                            color_scheme="green",
                            size="1",
                            on_click=AppState.resolve_all_conflicts,
                        ),
                        rx.button(
                            "Resolve All: Keep Both",
                            variant="soft",
                            color_scheme="gray",
                            size="1",
                            on_click=AppState.resolve_all_keep_both,
                        ),
                        spacing="2",
                    ),
                    rx.fragment(),
                ),
                # Conflict list
                rx.cond(
                    AppState.conflict_count != "0",
                    rx.scroll_area(
                        rx.vstack(
                            rx.foreach(AppState.conflict_items, _conflict_card),
                            spacing="0",
                            width="100%",
                        ),
                        max_height="450px",
                        width="100%",
                    ),
                    rx.center(
                        rx.text("No pending conflicts", color="#404040", font_size="0.85rem"),
                        padding="2rem",
                    ),
                ),
                spacing="3",
                width="100%",
            ),
            max_width="640px",
            background="#0a0a0a",
            border="1px solid #1a1a1a",
            padding="1.25rem",
        ),
        open=AppState.show_conflicts,
        on_open_change=lambda _: AppState.toggle_conflicts(),
    )


def _stale_dialog() -> rx.Component:
    """Stale memories management dialog with lifecycle filter."""
    return rx.dialog.root(
        rx.dialog.content(
            rx.vstack(
                rx.hstack(
                    rx.icon("archive", size=18, color="#525252"),
                    rx.text(
                        AppState.stale_filter + " Memories",
                        font_weight="600",
                        font_size="1rem",
                    ),
                    rx.spacer(),
                    rx.select(
                        ["DORMANT", "WEAK", "ACTIVE"],
                        value=AppState.stale_filter,
                        on_change=AppState.set_stale_filter,
                        size="1",
                        variant="ghost",
                        color="#525252",
                    ),
                    rx.badge(AppState.stale_count, variant="soft", color_scheme="gray"),
                    rx.dialog.close(
                        rx.icon("x", size=16, color="#525252", cursor="pointer", _hover={"color": "#fafafa"}),
                    ),
                    spacing="2",
                    align="center",
                    width="100%",
                ),
                rx.text(
                    "Browse memories by lifecycle state. Archive dormant ones to clean up recall.",
                    font_size="0.8rem",
                    color="#525252",
                ),
                # Bulk action
                rx.cond(
                    AppState.stale_count != "0",
                    rx.box(
                        rx.button(
                            "Archive All Dormant",
                            variant="soft",
                            color_scheme="red",
                            size="1",
                            on_click=AppState.bulk_archive_stale,
                        ),
                    ),
                    rx.fragment(),
                ),
                # Stale list
                rx.cond(
                    AppState.stale_count != "0",
                    rx.scroll_area(
                        rx.html(AppState.stale_html),
                        max_height="450px",
                        width="100%",
                    ),
                    rx.center(
                        rx.text("No dormant memories", color="#404040", font_size="0.85rem"),
                        padding="2rem",
                    ),
                ),
                spacing="3",
                width="100%",
            ),
            max_width="550px",
            background="#0a0a0a",
            border="1px solid #1a1a1a",
            padding="1.25rem",
        ),
        open=AppState.show_stale,
        on_open_change=lambda _: AppState.toggle_stale(),
    )


# --- Page ---

def memory_page() -> rx.Component:
    """Memory management page — sidebar + graph + dialogs."""
    return rx.box(
        rx.hstack(
            _sidebar(),
            _main_area(),
            spacing="0",
            width="100%",
            height="100%",
        ),
        _conflicts_dialog(),
        _stale_dialog(),
        width="100%",
        height="100%",
        position="relative",
    )
