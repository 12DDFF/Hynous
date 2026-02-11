"""Chat components."""

import reflex as rx
from ..state import Message

# Markdown styles for chat messages — dark theme, compact spacing
_MD_STYLE = {
    "line_height": "1.65",
    "font_size": "0.9rem",
    "word_break": "break-word",
    "overflow_wrap": "anywhere",
    "& p": {"margin": "0 0 0.5em 0"},
    "& p:last-child": {"margin_bottom": "0"},
    "& h1, & h2, & h3, & h4": {
        "font_size": "0.95rem",
        "font_weight": "600",
        "margin": "0.75em 0 0.25em 0",
        "color": "#fafafa",
        "letter_spacing": "0.01em",
    },
    "& h3": {
        "font_size": "0.85rem",
        "color": "#a3a3a3",
        "text_transform": "uppercase",
        "letter_spacing": "0.05em",
        "margin": "1em 0 0.4em 0",
    },
    "& strong": {"font_weight": "600", "color": "#fafafa"},
    "& em": {"font_style": "normal", "color": "#fafafa"},
    "& code": {
        "background": "#262626",
        "padding": "0.15em 0.4em",
        "border_radius": "4px",
        "font_family": "'JetBrains Mono', monospace",
        "font_size": "0.85em",
        "word_break": "break-all",
    },
    "& pre": {
        "background": "#161616",
        "padding": "0.75em 1em",
        "border_radius": "8px",
        "overflow_x": "auto",
        "margin": "0.5em 0",
        "white_space": "pre-wrap",
        "word_break": "break-word",
    },
    "& pre code": {"background": "transparent", "padding": "0", "word_break": "break-word"},
    "& ul, & ol": {
        "padding_left": "1.5em",
        "margin": "0.25em 0",
        "overflow_wrap": "anywhere",
        "word_break": "break-word",
    },
    "& li": {
        "margin": "0.15em 0",
        "overflow_wrap": "anywhere",
        "word_break": "break-word",
    },
    # Blockquote — used for key takeaways / thesis
    "& blockquote": {
        "border_left": "3px solid #6366f1",
        "padding": "0.5em 0.75em",
        "margin": "0.75em 0",
        "background": "rgba(99, 102, 241, 0.06)",
        "border_radius": "0 8px 8px 0",
        "color": "#d4d4d4",
    },
    "& blockquote p": {"margin": "0"},
    "& a": {"color": "#818cf8"},
    # Horizontal rule — section divider
    "& hr": {
        "border": "none",
        "border_top": "1px solid #262626",
        "margin": "1em 0",
    },
    # Tables — for comparative data
    "& table": {
        "width": "100%",
        "border_collapse": "collapse",
        "margin": "0.5em 0",
        "font_size": "0.85rem",
        "display": "block",
        "overflow_x": "auto",
    },
    "& thead": {
        "border_bottom": "1px solid #333",
    },
    "& th": {
        "text_align": "left",
        "padding": "0.4em 0.6em",
        "font_weight": "600",
        "color": "#a3a3a3",
        "font_size": "0.75rem",
        "text_transform": "uppercase",
        "letter_spacing": "0.04em",
        "word_break": "normal",
        "white_space": "nowrap",
    },
    "& td": {
        "padding": "0.35em 0.6em",
        "color": "#e5e5e5",
        "border_bottom": "1px solid #1a1a1a",
        "word_break": "normal",
        "white_space": "nowrap",
    },
    "& tr:last-child td": {
        "border_bottom": "none",
    },
    "& tbody tr": {
        "transition": "background 0.1s ease",
    },
    "& tbody tr:hover": {
        "background": "rgba(255,255,255,0.02)",
    },
}


def hynous_avatar() -> rx.Component:
    """Hynous avatar - pixel punk."""
    return rx.image(
        src="/hynous-avatar.png",
        width="32px",
        height="32px",
        border_radius="10px",
        object_fit="cover",
        flex_shrink="0",
    )


def user_avatar() -> rx.Component:
    """User avatar - simple initial."""
    return rx.box(
        rx.text("Y", font_size="0.75rem", font_weight="500", color="#a3a3a3"),
        width="32px",
        height="32px",
        border_radius="10px",
        background="#262626",
        display="flex",
        align_items="center",
        justify_content="center",
        flex_shrink="0",
    )


def format_time(timestamp: str) -> rx.Component:
    """Format timestamp for display."""
    # Extract just the time portion
    return rx.text(
        timestamp,  # Will format properly when we parse it
        font_size="0.65rem",
        color="#404040",
    )


def chat_bubble(message: Message) -> rx.Component:
    """Chat message bubble with avatar."""
    is_user = message.sender == "user"

    return rx.hstack(
        # Avatar on left for Hynous, hidden for user
        rx.cond(
            is_user,
            rx.box(width="0px"),  # Spacer
            rx.cond(
                message.show_avatar,
                hynous_avatar(),
                rx.box(width="32px", height="32px", flex_shrink="0"),  # Invisible spacer
            ),
        ),

        # Message content
        rx.box(
            rx.vstack(
                # Header with name and time
                rx.hstack(
                    rx.text(
                        rx.cond(is_user, "You", "Hynous"),
                        font_size="0.75rem",
                        font_weight="500",
                        color=rx.cond(is_user, "#737373", "#818cf8"),
                    ),
                    rx.text(
                        "·",
                        font_size="0.7rem",
                        color="#404040",
                        padding_x="0.25rem",
                    ),
                    rx.text(
                        message.timestamp,
                        font_size="0.65rem",
                        color="#404040",
                    ),
                    spacing="0",
                    align="center",
                ),
                # Message content (markdown for hynous, plain text for user)
                rx.cond(
                    is_user,
                    rx.text(
                        message.content,
                        color="#d4d4d4",
                        line_height="1.65",
                        white_space="pre-wrap",
                        font_size="0.9rem",
                        word_break="break-word",
                    ),
                    rx.markdown(
                        message.content,
                        color="#e5e5e5",
                        style=_MD_STYLE,
                        use_math=False,
                        use_katex=False,
                        width="100%",
                    ),
                ),
                # Tool tags (only shown when tools were used)
                rx.cond(
                    message.tools_used.length() > 0,
                    rx.hstack(
                        rx.foreach(
                            message.tools_used,
                            tool_tag,
                        ),
                        spacing="1",
                        padding_top="0.375rem",
                        flex_wrap="wrap",
                    ),
                    rx.fragment(),
                ),
                align_items="start",
                spacing="2",
                width="100%",
            ),
            padding="0.875rem 1rem",
            border_radius="14px",
            max_width="80%",
            min_width="0",
            overflow="hidden",
            background=rx.cond(is_user, "#1f1f1f", "linear-gradient(135deg, #18181b 0%, #1c1c22 100%)"),
            border=rx.cond(is_user, "1px solid #2a2a2a", "1px solid #27272a"),
            box_shadow=rx.cond(is_user, "none", "0 2px 8px rgba(0,0,0,0.15)"),
        ),

        # Avatar on right for user
        rx.cond(
            is_user,
            rx.cond(
                message.show_avatar,
                user_avatar(),
                rx.box(width="32px", height="32px", flex_shrink="0"),
            ),
            rx.box(width="0px"),  # Spacer
        ),

        width="100%",
        justify=rx.cond(is_user, "end", "start"),
        align="start",
        spacing="3",
        padding_y="0.375rem",
    )


def typing_indicator() -> rx.Component:
    """Animated typing indicator — alive, breathing dots with shimmer."""
    return rx.hstack(
        hynous_avatar(),
        rx.box(
            # Keyframe styles
            rx.el.style("""
                @keyframes hynous-dot {
                    0%, 80%, 100% {
                        transform: scale(0.4);
                        opacity: 0.3;
                    }
                    40% {
                        transform: scale(1.0);
                        opacity: 1;
                    }
                }
                @keyframes hynous-glow {
                    0%, 100% {
                        box-shadow: 0 0 4px rgba(99, 102, 241, 0.0);
                    }
                    50% {
                        box-shadow: 0 0 12px rgba(99, 102, 241, 0.3);
                    }
                }
                .hynous-thinking-bubble {
                    animation: hynous-glow 2s ease-in-out infinite;
                }
                .hynous-dot-1 { animation: hynous-dot 1.4s ease-in-out infinite; }
                .hynous-dot-2 { animation: hynous-dot 1.4s ease-in-out 0.2s infinite; }
                .hynous-dot-3 { animation: hynous-dot 1.4s ease-in-out 0.4s infinite; }
            """),
            rx.hstack(
                rx.el.div(
                    class_name="hynous-dot-1",
                    width="7px",
                    height="7px",
                    border_radius="50%",
                    background="linear-gradient(135deg, #818cf8, #6366f1)",
                ),
                rx.el.div(
                    class_name="hynous-dot-2",
                    width="7px",
                    height="7px",
                    border_radius="50%",
                    background="linear-gradient(135deg, #818cf8, #6366f1)",
                ),
                rx.el.div(
                    class_name="hynous-dot-3",
                    width="7px",
                    height="7px",
                    border_radius="50%",
                    background="linear-gradient(135deg, #818cf8, #6366f1)",
                ),
                spacing="2",
                align="center",
                justify="center",
            ),
            class_name="hynous-thinking-bubble",
            padding="0.875rem 1.25rem",
            background="linear-gradient(135deg, #18181b 0%, #1c1c22 100%)",
            border_radius="14px",
            border="1px solid #27272a",
            display="flex",
            align_items="center",
            justify_content="center",
        ),
        spacing="3",
        align="center",
        padding_y="0.375rem",
    )


def streaming_bubble(text: rx.Var[str], show_avatar: rx.Var[bool] = True) -> rx.Component:
    """Hynous message bubble that displays streaming text as it arrives.

    Looks identical to a regular hynous chat_bubble so there's no visual
    jump when streaming finishes and the final message replaces it.
    """
    return rx.hstack(
        rx.cond(
            show_avatar,
            hynous_avatar(),
            rx.box(width="32px", height="32px", flex_shrink="0"),
        ),

        rx.box(
            rx.vstack(
                rx.hstack(
                    rx.text(
                        "Hynous",
                        font_size="0.75rem",
                        font_weight="500",
                        color="#818cf8",
                    ),
                    spacing="0",
                    align="center",
                ),
                rx.markdown(
                    text,
                    color="#e5e5e5",
                    style=_MD_STYLE,
                    use_math=False,
                    use_katex=False,
                    width="100%",
                ),
                align_items="start",
                spacing="2",
                width="100%",
            ),
            padding="0.875rem 1rem",
            border_radius="14px",
            max_width="80%",
            min_width="0",
            overflow="hidden",
            background="linear-gradient(135deg, #18181b 0%, #1c1c22 100%)",
            border="1px solid #27272a",
            box_shadow="0 2px 8px rgba(0,0,0,0.15)",
        ),

        rx.box(width="0px"),

        width="100%",
        justify="start",
        align="start",
        spacing="3",
        padding_y="0.375rem",
    )


def tool_indicator(tool_name: rx.Var[str], tool_color: rx.Var[str] = "#a5b4fc") -> rx.Component:
    """Status indicator shown when agent is calling a tool."""
    return rx.hstack(
        hynous_avatar(),
        rx.hstack(
            rx.spinner(size="1"),
            rx.text(
                tool_name,
                font_size="0.8rem",
                color=tool_color,
                font_weight="500",
            ),
            spacing="2",
            align="center",
            padding="0.625rem 1rem",
            border_radius="12px",
            background="#141418",
            border="1px solid #232328",
        ),
        spacing="3",
        align="center",
        padding_y="0.25rem",
    )


# Per-tool colors for tags and indicators
_TOOL_COLOR = {
    "market data": "#60a5fa",   # blue
    "orderbook": "#22d3ee",     # cyan
    "funding": "#fbbf24",       # amber
    "multi-TF": "#a78bfa",      # purple
    "liquidations": "#fb923c",  # orange
    "sentiment": "#2dd4bf",     # teal
    "options": "#f472b6",       # pink
    "institutional": "#34d399", # emerald
    "web search": "#e879f9",   # fuchsia
    "costs": "#94a3b8",         # slate
    "memory": "#a3e635",        # lime
}
_TOOL_BG = {
    "market data": "rgba(96,165,250,0.1)",
    "orderbook": "rgba(34,211,238,0.1)",
    "funding": "rgba(251,191,36,0.1)",
    "multi-TF": "rgba(167,139,250,0.1)",
    "liquidations": "rgba(251,146,60,0.1)",
    "sentiment": "rgba(45,212,191,0.1)",
    "options": "rgba(244,114,182,0.1)",
    "institutional": "rgba(52,211,153,0.1)",
    "web search": "rgba(232,121,249,0.1)",
    "costs": "rgba(148,163,184,0.1)",
    "memory": "rgba(163,230,53,0.1)",
}

def _tag_color(name: rx.Var[str]) -> rx.Var[str]:
    """Resolve tool tag name to its accent color."""
    return rx.match(
        name,
        ("market data", "#60a5fa"),
        ("orderbook", "#22d3ee"),
        ("funding", "#fbbf24"),
        ("multi-TF", "#a78bfa"),
        ("liquidations", "#fb923c"),
        ("sentiment", "#2dd4bf"),
        ("options", "#f472b6"),
        ("institutional", "#34d399"),
        ("web search", "#e879f9"),
        ("costs", "#94a3b8"),
        ("memory", "#a3e635"),
        ("daemon", "#818cf8"),
        ("delete", "#f87171"),
        ("watchpoints", "#fbbf24"),
        "#737373",  # fallback
    )

def _tag_bg(name: rx.Var[str]) -> rx.Var[str]:
    """Resolve tool tag name to its tinted background."""
    return rx.match(
        name,
        ("market data", "rgba(96,165,250,0.1)"),
        ("orderbook", "rgba(34,211,238,0.1)"),
        ("funding", "rgba(251,191,36,0.1)"),
        ("multi-TF", "rgba(167,139,250,0.1)"),
        ("liquidations", "rgba(251,146,60,0.1)"),
        ("sentiment", "rgba(45,212,191,0.1)"),
        ("options", "rgba(244,114,182,0.1)"),
        ("institutional", "rgba(52,211,153,0.1)"),
        ("web search", "rgba(232,121,249,0.1)"),
        ("costs", "rgba(148,163,184,0.1)"),
        ("memory", "rgba(163,230,53,0.1)"),
        ("daemon", "rgba(129,140,248,0.1)"),
        ("delete", "rgba(248,113,113,0.1)"),
        ("watchpoints", "rgba(251,191,36,0.1)"),
        "#1a1a1e",  # fallback
    )


def tool_tag(name: rx.Var[str]) -> rx.Component:
    """Small tag showing a tool that was used in a saved message."""
    return rx.hstack(
        rx.icon("zap", size=10, color=_tag_color(name)),
        rx.text(name, font_size="0.65rem", color=_tag_color(name)),
        spacing="1",
        align="center",
        padding="0.125rem 0.5rem",
        border_radius="4px",
        background=_tag_bg(name),
    )


def chat_input(
    on_submit: callable,
    placeholder: str = "Message Hynous...",
    is_loading: rx.Var[bool] = False,
) -> rx.Component:
    """Chat input with send button.

    Uses an uncontrolled input (no value/on_change binding) so typing
    is purely client-side with zero server round-trips. The message is
    sent to the server only on form submit (Enter or click).
    """
    return rx.form(
        rx.hstack(
            rx.el.textarea(
                name="message",
                placeholder=placeholder,
                rows=1,
                style={
                    "background": "#111111",
                    "border": "1px solid #1a1a1a",
                    "border_radius": "10px",
                    "color": "#e5e5e5",
                    "padding": "12px 16px",
                    "flex": "1",
                    "font_size": "0.9rem",
                    "font_family": "inherit",
                    "resize": "none",
                    "overflow": "hidden",
                    "max_height": "200px",
                    "line_height": "1.5",
                    "outline": "none",
                },
            ),
            rx.button(
                rx.cond(
                    is_loading,
                    rx.spinner(size="1"),
                    rx.icon("arrow-up", size=18),
                ),
                type="submit",
                background="#e5e5e5",
                color="#0a0a0a",
                width="46px",
                height="46px",
                border_radius="10px",
                cursor="pointer",
                display="flex",
                align_items="center",
                justify_content="center",
                flex_shrink="0",
                _hover={
                    "background": "#fafafa",
                },
                _disabled={
                    "opacity": "0.5",
                    "cursor": "not-allowed",
                },
                disabled=is_loading,
                transition="all 0.1s ease",
            ),
            width="100%",
            spacing="2",
            align="end",
        ),
        # JS: auto-grow textarea, Enter to submit, Shift+Enter for newline, reset on submit
        rx.script("""
            (function() {
                const form = document.querySelector('form');
                if (!form) return;
                const ta = form.querySelector('textarea[name="message"]');
                if (!ta) return;

                ta.addEventListener('input', function() {
                    this.style.height = 'auto';
                    this.style.height = Math.min(this.scrollHeight, 200) + 'px';
                    this.style.overflow = this.scrollHeight > 200 ? 'auto' : 'hidden';
                });

                ta.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (this.value.trim()) {
                            form.requestSubmit();
                        }
                    }
                });

                form.addEventListener('submit', function() {
                    setTimeout(function() {
                        ta.style.height = 'auto';
                        ta.style.overflow = 'hidden';
                    }, 0);
                });
            })();
        """),
        on_submit=on_submit,
        reset_on_submit=True,
        width="100%",
    )
