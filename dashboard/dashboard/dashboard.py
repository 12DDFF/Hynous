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
from .pages import home_page, chat_page, graph_page, journal_page, memory_page, login_page, debug_page, settings_page


def _dashboard_content() -> rx.Component:
    """Authenticated dashboard content."""
    return rx.box(
        # Global animation keyframes
        rx.el.style("""
            @keyframes pnl-pulse-green {
                0% { text-shadow: 0 0 0 rgba(74,222,128,0); }
                50% { text-shadow: 0 0 12px rgba(74,222,128,0.4); }
                100% { text-shadow: 0 0 0 rgba(74,222,128,0); }
            }
            @keyframes pnl-pulse-red {
                0% { text-shadow: 0 0 0 rgba(248,113,113,0); }
                50% { text-shadow: 0 0 12px rgba(248,113,113,0.4); }
                100% { text-shadow: 0 0 0 rgba(248,113,113,0); }
            }
            @keyframes radar-sweep {
                0% { opacity: 1; }
                50% { opacity: 0.4; }
                100% { opacity: 1; }
            }
            @keyframes unread-pulse {
                0%, 100% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.3); opacity: 0.7; }
            }
            @keyframes fade-slide-in {
                0% { opacity: 0; transform: translateY(4px); }
                100% { opacity: 1; transform: translateY(0); }
            }
            .pnl-pulse-green { animation: pnl-pulse-green 0.8s ease-out; }
            .pnl-pulse-red { animation: pnl-pulse-red 0.8s ease-out; }
            .scanner-radar-active { animation: radar-sweep 2s ease-in-out infinite; }
            .unread-dot { animation: unread-pulse 2s ease-in-out infinite; }
            /* Move Reflex watermark off-screen — blocks bottom-pinned UI */
            a[href*="reflex.dev"] {
                position: fixed !important;
                bottom: -200px !important;
                pointer-events: none !important;
                opacity: 0 !important;
            }
        """),

        # Live clock + animated number counter
        rx.script("""
            (function() {
                // Live clock
                setInterval(function() {
                    var el = document.getElementById('live-clock');
                    if (el) {
                        var now = new Date();
                        var h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
                        var ampm = h >= 12 ? 'PM' : 'AM';
                        h = h % 12 || 12;
                        el.textContent = h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + ' ' + ampm;
                    }
                }, 1000);

                // Tick counter — animates number changes
                var prev = {};
                setInterval(function() {
                    document.querySelectorAll('[data-tick-target]').forEach(function(el) {
                        var id = el.getAttribute('data-tick-target');
                        var raw = el.getAttribute('data-tick-value');
                        if (!raw) return;
                        var target = parseFloat(raw);
                        if (isNaN(target)) return;
                        var current = prev[id];
                        if (current === undefined) { prev[id] = target; return; }
                        if (Math.abs(current - target) < 0.005) return;
                        var start = current, startTime = Date.now(), duration = 600;
                        var decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
                        function step() {
                            var elapsed = Date.now() - startTime;
                            var t = Math.min(elapsed / duration, 1);
                            t = 1 - Math.pow(1 - t, 3);
                            var v = start + (target - start) * t;
                            el.textContent = el.getAttribute('data-tick-prefix') + v.toFixed(decimals) + el.getAttribute('data-tick-suffix');
                            if (t < 1) requestAnimationFrame(step);
                            else prev[id] = target;
                        }
                        prev[id] = target;
                        el.classList.remove('pnl-pulse-green', 'pnl-pulse-red');
                        if (target > current) el.classList.add('pnl-pulse-green');
                        else el.classList.add('pnl-pulse-red');
                        setTimeout(function() { el.classList.remove('pnl-pulse-green', 'pnl-pulse-red'); }, 800);
                        requestAnimationFrame(step);
                    });
                }, 1000);
            })();
        """),

        # Smart auto-scroll — ChatGPT-style sticky bottom.
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
                on_settings=AppState.go_to_settings,
                on_debug=AppState.go_to_debug,
                on_logout=AppState.logout,
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
                        rx.cond(
                            AppState.current_page == "settings",
                            settings_page(),
                            rx.cond(
                                AppState.current_page == "debug",
                                debug_page(),
                                memory_page(),
                            ),
                        ),
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


def index() -> rx.Component:
    """Main entry point — gates on authentication."""
    return rx.cond(
        AppState.is_authenticated,
        _dashboard_content(),
        login_page(),
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


# Proxy Nous API through the Reflex backend so the browser doesn't need
# direct access to port 3100 (blocked by UFW).
async def _nous_proxy(request):
    """Proxy /api/nous/* → localhost:3100/v1/*"""
    import httpx
    from starlette.responses import JSONResponse
    path = request.path_params.get("path", "graph")
    qs = str(request.query_params)
    url = f"http://localhost:3100/v1/{path}"
    if qs:
        url += f"?{qs}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            return JSONResponse(resp.json(), status_code=resp.status_code)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


app._api.add_route("/api/nous/{path:path}", _nous_proxy)


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
