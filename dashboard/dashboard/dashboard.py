"""
Hynous Dashboard

Main Reflex application entry point.

Run with:
    cd dashboard
    reflex run
"""

import reflex as rx
from .state import AppState
from .components import navbar
from .pages import home_page, chat_page, graph_page, journal_page, memory_page


def index() -> rx.Component:
    """Main application layout."""
    return rx.box(
        # Smart auto-scroll — ChatGPT-style sticky bottom.
        #
        # How it works:
        #   - wheel up → instantly breaks sticky (no fighting)
        #   - scroll settles at very bottom → re-engages sticky (debounced)
        #   - content changes + sticky → auto-scroll to bottom
        #
        # Key: wheel event only fires from user input, never from
        # programmatic scrolling, so there are no race conditions.
        # The debounced scroll handler prevents re-engage during
        # active scrolling.
        rx.script("""
            (function() {
                var sticky = {};

                function setup(id) {
                    var el = document.getElementById(id);
                    if (!el || el._hs) return;
                    el._hs = true;
                    sticky[id] = true;
                    var timer = null;

                    // Break sticky instantly on scroll up
                    el.addEventListener('wheel', function(e) {
                        if (e.deltaY < 0) {
                            sticky[id] = false;
                            clearTimeout(timer);
                        }
                    }, { passive: true });

                    // Re-enable only after scroll settles at the very bottom
                    el.addEventListener('scroll', function() {
                        clearTimeout(timer);
                        timer = setTimeout(function() {
                            if (el.scrollHeight - el.scrollTop - el.clientHeight < 10) {
                                sticky[id] = true;
                            }
                        }, 150);
                    }, { passive: true });

                    // Auto-scroll on content changes when sticky
                    new MutationObserver(function() {
                        if (sticky[id]) el.scrollTop = el.scrollHeight;
                    }).observe(el, { childList: true, subtree: true, characterData: true });

                    el.scrollTop = el.scrollHeight;
                }

                setInterval(function() {
                    setup('messages-container');
                    setup('quick-chat-messages');
                }, 300);
            })();
        """),

        # Navigation - fixed at top, never scrolls
        rx.box(
            navbar(
                current_page=AppState.current_page,
                on_home=AppState.go_to_home,
                on_chat=AppState.go_to_chat,
                on_journal=AppState.go_to_journal,
                on_memory=AppState.go_to_memory,
            ),
            position="fixed",
            top="0",
            left="0",
            right="0",
            z_index="100",
            background="#0a0a0a",
        ),

        # Page content — only the active page is mounted.
        # Reduces React reconciliation overhead during streaming
        # (hidden pages don't re-render on state updates).
        rx.box(
            rx.cond(
                AppState.current_page == "home",
                home_page(),
                rx.cond(
                    AppState.current_page == "chat",
                    chat_page(),
                    rx.cond(
                        AppState.current_page == "journal",
                        journal_page(),
                        memory_page(),
                    ),
                ),
            ),
            flex="1",
            width="100%",
            height="calc(100vh - 56px)",
            margin_top="56px",
            overflow="hidden",
        ),

        # Global styles
        display="flex",
        flex_direction="column",
        background="#0a0a0a",
        height="100vh",
        color="#fafafa",
        font_family="Inter, system-ui, sans-serif",
        overflow="hidden",
        overscroll_behavior="none",
    )


# Create app
app = rx.App(
    theme=rx.theme(
        appearance="dark",
        accent_color="iris",       # Purple/indigo accent (#6366f1 family)
        gray_color="sand",
        radius="medium",
        scaling="100%",
    ),
    style={
        "background": "#0a0a0a",
        "color": "#fafafa",
        "font_family": "Inter, system-ui, sans-serif",
    },
    stylesheets=[
        "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
        "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap",
    ],
)

app.add_page(index, route="/", title="Hynous", on_load=AppState.load_page)


# Eagerly start agent + daemon when the ASGI backend starts.
# This runs via Reflex's lifespan task system (Starlette lifespan protocol).
async def _eager_agent_start():
    import asyncio, sys
    await asyncio.sleep(3)
    try:
        from .state import _get_agent
        agent = await asyncio.to_thread(_get_agent)
        if agent:
            print("[hynous] Agent + daemon started eagerly on boot", file=sys.stderr, flush=True)
        else:
            print("[hynous] Agent failed to start on boot", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[hynous] Eager start error: {e}", file=sys.stderr, flush=True)

app.register_lifespan_task(_eager_agent_start)
