"""
Application State

Central state management for the Hynous dashboard.
All reactive state lives here.
"""

import re
import asyncio
import threading
import reflex as rx
import logging
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

logger = logging.getLogger(__name__)

# Poll interval for live portfolio updates (seconds)
_POLL_INTERVAL = 15

# Background task decorator — rx.background not exposed in Reflex 0.8.x
# but the machinery exists. Setting the marker attribute is all that's needed.
from reflex.state import BACKGROUND_TASK_MARKER

def _background(fn):
    """Mark an async method as a Reflex background task."""
    setattr(fn, BACKGROUND_TASK_MARKER, True)
    return fn

# --- Financial value highlighting ---
# Matches: +1.5%, +$500, +0.0034%, +$1.2M, etc.
_POS_RE = re.compile(r'(\+\$?[\d,]+\.?\d*[KMBkmb]?%?)')
# Matches: -1.5%, -$500, etc. Requires preceding space/paren/pipe to avoid markdown list markers
_NEG_RE = re.compile(r'(?<=[ (|:])(-\$?[\d,]+\.?\d*[KMBkmb]?%?)')

_GREEN = '<span style="color:#4ade80;text-shadow:0 0 6px rgba(74,222,128,0.2)">'
_RED = '<span style="color:#f87171;text-shadow:0 0 6px rgba(248,113,113,0.2)">'
_END = '</span>'


def _highlight(text: str) -> str:
    """Add subtle color glow to financial values in text.

    Positive values (+X%, +$X) get green glow.
    Negative values (-X%, -$X) get red glow.
    Uses raw HTML spans — requires use_raw=True in rx.markdown (default).
    """
    text = _POS_RE.sub(f'{_GREEN}\\1{_END}', text)
    text = _NEG_RE.sub(f'{_RED}\\1{_END}', text)
    return text

# Human-readable names for tool indicators
_TOOL_DISPLAY = {
    "get_market_data": "Fetching market data",
    "get_orderbook": "Reading orderbook",
    "get_funding_history": "Analyzing funding rates",
    "get_multi_timeframe": "Multi-timeframe analysis",
    "get_liquidations": "Checking liquidations",
    "get_global_sentiment": "Reading global sentiment",
    "get_options_flow": "Analyzing options flow",
    "get_institutional_flow": "Tracking institutional flow",
    "search_web": "Searching the web",
    "get_my_costs": "Checking costs",
    "store_memory": "Storing memory",
    "recall_memory": "Searching memories",
    "get_account": "Checking account",
    "execute_trade": "Executing trade",
    "close_position": "Closing position",
    "modify_position": "Modifying position",
    "delete_memory": "Deleting memory",
    "manage_watchpoints": "Managing watchpoints",
    "get_trade_stats": "Checking trade stats",
}
_TOOL_TAG = {
    "get_market_data": "market data",
    "get_orderbook": "orderbook",
    "get_funding_history": "funding",
    "get_multi_timeframe": "multi-TF",
    "get_liquidations": "liquidations",
    "get_global_sentiment": "sentiment",
    "get_options_flow": "options",
    "get_institutional_flow": "institutional",
    "search_web": "web search",
    "get_my_costs": "costs",
    "store_memory": "memory",
    "recall_memory": "memory",
    "get_account": "account",
    "execute_trade": "trade",
    "close_position": "close",
    "modify_position": "modify",
    "delete_memory": "delete",
    "manage_watchpoints": "watchpoints",
    "get_trade_stats": "stats",
}


class Message(BaseModel):
    """Chat message model."""
    sender: str  # "user" or "hynous"
    content: str
    timestamp: str
    tools_used: list[str] = []
    show_avatar: bool = True  # False when grouped with previous same-sender message


class Activity(BaseModel):
    """Activity log entry."""
    type: str  # "chat", "trade", "alert", "system"
    title: str
    level: str  # "info", "success", "warning", "error"
    timestamp: str


class DaemonActivity(BaseModel):
    """Daemon activity log entry (from daemon_log.py)."""
    type: str       # "wake", "watchpoint", "fill", "learning", "review", "error", "skip"
    title: str
    detail: str
    timestamp: str


class Position(BaseModel):
    """Trading position."""
    symbol: str
    side: str  # "long" or "short"
    size: float  # USD notional
    entry: float  # entry price
    mark: float = 0.0  # current mark price
    pnl: float = 0.0  # return % on equity
    pnl_usd: float = 0.0  # unrealized PnL in USD
    leverage: int = 1


class ClosedTrade(BaseModel):
    """Closed trade for journal display."""
    symbol: str
    side: str
    entry_px: float
    exit_px: float
    pnl_pct: float
    pnl_usd: float
    closed_at: str
    close_type: str = "full"
    duration_hours: float = 0.0
    date: str = ""  # Pre-formatted date string (YYYY-MM-DD)


class DaemonActivityFormatted(BaseModel):
    """Daemon activity with pre-formatted relative time."""
    type: str = ""
    title: str = ""
    detail: str = ""
    time_display: str = ""  # "3m ago"


class WatchpointGroup(BaseModel):
    """Watchpoint group for a single symbol (used in accordion)."""
    symbol: str = ""
    count: str = "0"
    detail_html: str = ""


# --- Agent + Daemon singletons (shared across all sessions) ---

_agent = None
_agent_error: Optional[str] = None
_daemon = None
_agent_lock = threading.Lock()


def _get_agent():
    """Lazily initialize the Hynous agent and daemon.

    Thread-safe: uses double-checked locking so only one Agent is created
    even when called concurrently from stream_response and init_and_start_daemon.
    """
    global _agent, _agent_error, _daemon

    if _agent is not None:
        return _agent

    with _agent_lock:
        # Double-check after acquiring lock
        if _agent is not None:
            return _agent

        try:
            from hynous.nous.server import ensure_running
            if not ensure_running():
                logger.warning("Nous server not available — memory tools will fail")

            from hynous.intelligence import Agent
            _agent = Agent()
            _agent_error = None
            logger.info("Hynous agent initialized successfully")

            if _agent.config.daemon.enabled and _daemon is None:
                from hynous.intelligence.daemon import Daemon
                _daemon = Daemon(_agent, _agent.config)
                _daemon.start()
                logger.info("Daemon auto-started")

            if _agent.config.discord.enabled:
                try:
                    from hynous.discord.bot import start_bot
                    start_bot(_agent, _agent.config)
                except Exception as e:
                    logger.warning("Discord bot failed to start: %s", e)

            return _agent
        except Exception as e:
            _agent_error = str(e)
            logger.error(f"Failed to initialize agent: {e}")
            return None


def _reset_agent():
    """Force re-initialization of the agent. Call after code changes."""
    global _agent, _agent_error
    _agent = None
    _agent_error = None


class AppState(rx.State):
    """Main application state."""

    # === Chat State ===
    messages: List[Message] = []
    current_input: str = ""
    is_loading: bool = False
    streaming_text: str = ""
    active_tool: str = ""
    _pending_input: str = ""  # Backend-only: passed to background streaming task

    # === Agent State ===
    agent_status: str = "idle"  # "idle", "thinking", "online", "error"

    # === Portfolio State (updated by background poller) ===
    portfolio_value: float = 0.0  # Live account value
    portfolio_initial: float = 0.0  # Set from config/provider on first poll
    portfolio_change: float = 0.0  # % change from initial
    positions: List[Position] = []
    _polling: bool = False  # Guard against duplicate pollers

    # === Activity State ===
    activities: List[Activity] = []

    # === Navigation ===
    current_page: str = "home"

    # === Chat Actions ===

    def set_input(self, value: str):
        """Update the current input value."""
        self.current_input = value

    def _append_msg(self, msg: Message):
        """Append a message, setting show_avatar based on previous sender."""
        if self.messages and self.messages[-1].sender == msg.sender:
            msg.show_avatar = False
        self.messages.append(msg)

    def _recompute_avatars(self):
        """Recompute show_avatar for all messages (used after bulk load)."""
        for i, msg in enumerate(self.messages):
            if i == 0:
                msg.show_avatar = True
            else:
                msg.show_avatar = msg.sender != self.messages[i - 1].sender

    def _format_time(self) -> str:
        """Format current time for display (Pacific timezone)."""
        from hynous.core.clock import now as pacific_now
        t = pacific_now()
        tz = t.strftime("%Z").lower()  # "pst" or "pdt"
        return t.strftime("%I:%M %p").lstrip("0").lower() + f" {tz}"

    def send_message(self, form_data: dict = {}):
        """Send a message and kick off background streaming.

        Accepts form data from the uncontrolled input (form submit sends
        {message: str}). Can also be called programmatically via
        _pending_input for suggestions and quick-chat.
        """
        # Get message from form data or _pending_input (for programmatic sends)
        text = form_data.get("message", "").strip() if form_data else ""
        if not text:
            text = self._pending_input.strip()
        if not text:
            return

        # Add user message
        user_msg = Message(
            sender="user",
            content=text,
            timestamp=self._format_time()
        )
        self._append_msg(user_msg)

        # Store input for background task
        self._pending_input = text
        self.is_loading = True
        self.streaming_text = ""
        self.active_tool = ""
        self.agent_status = "thinking"

        # Chain to background streaming task (state delta with user msg is sent first)
        return AppState.stream_response

    @_background
    async def stream_response(self):
        """Stream agent response as a background task.

        Runs chat_stream() in a thread so it never blocks the event loop.
        State updates are pushed via async with self between chunks.
        """
        async with self:
            user_input = self._pending_input

        # Run in thread so agent init (7s on first call) doesn't block event loop
        agent = await asyncio.to_thread(_get_agent)
        tools_used = []

        if agent:
            try:
                # Run sync streaming generator in a thread, consume via queue
                import queue
                chunk_queue: queue.Queue = queue.Queue()
                sentinel = object()

                def _produce():
                    try:
                        for chunk_type, chunk_data in agent.chat_stream(user_input):
                            chunk_queue.put((chunk_type, chunk_data))
                    except Exception as e:
                        chunk_queue.put(("error", str(e)))
                    chunk_queue.put(sentinel)

                # Start producer thread
                import threading
                producer = threading.Thread(target=_produce, daemon=True)
                producer.start()

                # Consume chunks in batches — push state every ~80ms
                # instead of per-token. Reduces state lock acquisitions
                # and computed var evaluations by ~10-50x.
                done = False
                while not done:
                    text_batch = []
                    tool_event = None
                    error_msg = None

                    # Drain all available chunks without blocking
                    while True:
                        try:
                            item = chunk_queue.get_nowait()
                        except Exception:
                            break  # queue empty

                        if item is sentinel:
                            done = True
                            break
                        chunk_type, chunk_data = item
                        if chunk_type == "error":
                            error_msg = chunk_data
                            done = True
                            break
                        elif chunk_type == "text":
                            text_batch.append(chunk_data)
                        elif chunk_type == "tool":
                            tool_event = chunk_data
                            break  # Push tool events immediately

                    # Push batched updates in a single state lock
                    if text_batch or tool_event or error_msg:
                        async with self:
                            if error_msg:
                                self.streaming_text += f"\n\nSomething went wrong: {error_msg}"
                                self.agent_status = "error"
                            if text_batch:
                                self.active_tool = ""
                                self.streaming_text += "".join(text_batch)
                            if tool_event:
                                if self.streaming_text.strip():
                                    self._append_msg(Message(
                                        sender="hynous",
                                        content=_highlight(self.streaming_text),
                                        timestamp=self._format_time(),
                                    ))
                                    self.streaming_text = ""
                                self.active_tool = tool_event
                                if tool_event not in tools_used:
                                    tools_used.append(tool_event)

                    if not done:
                        await asyncio.sleep(0.08)  # ~80ms between UI pushes

                producer.join(timeout=5)

            except Exception as e:
                logger.error(f"Agent chat error: {e}")
                async with self:
                    self.streaming_text += "\n\nSomething went wrong on my end. Give me a moment and try again."
                    self.agent_status = "error"
        else:
            async with self:
                self.streaming_text = (
                    f"I can't connect to my brain right now. "
                    f"Make sure ANTHROPIC_API_KEY is set in your .env file.\n\n"
                    f"Error: {_agent_error or 'Unknown'}"
                )
                self.agent_status = "error"

        # Finalize
        async with self:
            response = self.streaming_text
            display_tools = [_TOOL_TAG.get(t, t) for t in tools_used]
            hynous_msg = Message(
                sender="hynous",
                content=_highlight(response),
                timestamp=self._format_time(),
                tools_used=display_tools,
            )
            self._append_msg(hynous_msg)

            self.streaming_text = ""
            self.active_tool = ""
            self._add_activity("chat", f"Chat: {user_input[:30]}...", "info")
            self.is_loading = False
            if self.agent_status != "error":
                self.agent_status = "idle"

        # Persist to disk (outside state lock)
        self._save_chat(agent)

    def send_suggestion(self, suggestion: str):
        """Send a suggestion as a message."""
        self._pending_input = suggestion
        return self.send_message()

    def load_page(self):
        """Load persisted messages + start portfolio polling on page load."""
        # Load chat history
        if not self.messages:
            try:
                from hynous.core.persistence import load
                saved_messages, _ = load()
                if saved_messages:
                    self.messages = [Message(**m) for m in saved_messages]
                    self._recompute_avatars()
            except Exception as e:
                logger.error(f"Failed to load persisted chat: {e}")

        # Start background tasks
        return [AppState.poll_portfolio, AppState.load_watchpoints]

    def _save_chat(self, agent=None):
        """Persist current messages and agent history to disk."""
        try:
            from hynous.core.persistence import save
            ui_data = [m.model_dump() for m in self.messages]
            history = agent._history if agent else []
            save(ui_data, history)
        except Exception as e:
            logger.error(f"Failed to save chat: {e}")

    def clear_messages(self):
        """Clear all messages, agent history, and persisted data."""
        self.messages = []
        agent = _get_agent()
        if agent:
            agent.clear_history()
        try:
            from hynous.core.persistence import clear
            clear()
        except Exception:
            pass

    # === Portfolio Polling ===

    def start_polling(self):
        """Start the background portfolio poller on page load."""
        if not self._polling:
            return AppState.poll_portfolio

    @_background
    async def poll_portfolio(self):
        """Poll Hyperliquid testnet every few seconds for live portfolio data.

        Runs as a Reflex background task — outside the main state lock.
        Updates portfolio_value, portfolio_change, and positions.
        Zero LLM tokens — pure Python → Hyperliquid REST.
        """
        async with self:
            if self._polling:
                return
            self._polling = True

        while True:
            try:
                # Run sync Hyperliquid API call in a thread so it doesn't
                # block the Reflex event loop (call takes ~5-7s on testnet).
                state_data = await asyncio.to_thread(self._fetch_portfolio)

                if state_data is not None:
                    value, positions, initial = state_data
                    async with self:
                        self.portfolio_value = round(value, 2)
                        if initial > 0:
                            self.portfolio_initial = initial
                            self.portfolio_change = round(
                                ((value - initial) / initial) * 100, 2
                            )
                        self.positions = positions
            except Exception as e:
                logger.debug(f"Portfolio poll error: {e}")

            # Drain daemon chat queue — show daemon wakes in the chat feed
            try:
                from hynous.intelligence.daemon import get_daemon_chat_queue
                dq = get_daemon_chat_queue()
                new_daemon_msgs = []
                while not dq.empty():
                    try:
                        new_daemon_msgs.append(dq.get_nowait())
                    except Exception:
                        break
                if new_daemon_msgs:
                    async with self:
                        self.is_waking = False  # Clear manual wake indicator
                        for item in new_daemon_msgs:
                            header = f"**Daemon Wake — {item['type']}: {item['title']}**"
                            self._append_msg(Message(
                                sender="hynous",
                                content=_highlight(f"> {header}\n\n{item['response']}"),
                                timestamp=self._format_time(),
                                tools_used=["daemon"],
                            ))
                    # Persist after adding daemon messages
                    self._save_chat(_agent)
            except Exception:
                pass

            await asyncio.sleep(_POLL_INTERVAL)

    # === Activity Actions ===

    def _add_activity(self, type: str, title: str, level: str = "info"):
        """Add an activity to the log."""
        activity = Activity(
            type=type,
            title=title,
            level=level,
            timestamp=datetime.now().isoformat()
        )
        self.activities.insert(0, activity)
        # Keep only last 50 activities
        self.activities = self.activities[:50]

    # === Computed Vars ===

    @staticmethod
    def _fetch_portfolio() -> tuple[float, list["Position"]] | None:
        """Fetch portfolio data from Hyperliquid (sync, runs in thread)."""
        from hynous.data.providers.hyperliquid import get_provider
        from hynous.core.config import load_config

        config = load_config()
        provider = get_provider(config=config)

        if not provider.can_trade:
            return None

        state = provider.get_user_state()
        value = state["account_value"]
        raw_positions = state["positions"]
        initial = getattr(provider, "_initial_balance", config.execution.paper_balance)

        positions = [
            Position(
                symbol=p["coin"],
                side=p["side"],
                size=round(p["size_usd"], 2),
                entry=p["entry_px"],
                mark=p["mark_px"],
                pnl=round(p["return_pct"], 2),
                pnl_usd=round(p["unrealized_pnl"], 2),
                leverage=p["leverage"],
            )
            for p in raw_positions
        ]

        return (round(value, 2), positions, initial)

    @rx.var
    def portfolio_value_str(self) -> str:
        """Formatted portfolio value — updated by background poller."""
        if self.portfolio_value > 0:
            return f"${self.portfolio_value:,.2f}"
        return "Connecting..."

    @rx.var
    def portfolio_change_str(self) -> str:
        """Formatted portfolio change %."""
        if self.portfolio_value == 0:
            return "Waiting for data"
        if self.portfolio_change == 0:
            return "Testnet trading"
        sign = "+" if self.portfolio_change > 0 else ""
        return f"{sign}{self.portfolio_change:.2f}% all time"

    @rx.var
    def portfolio_change_color(self) -> str:
        """Color for portfolio change."""
        if self.portfolio_change > 0:
            return "#22c55e"
        elif self.portfolio_change < 0:
            return "#ef4444"
        return "#fafafa"

    @rx.var(cache=False)
    def wallet_total_str(self) -> str:
        """Total monthly cost as formatted string."""
        try:
            from hynous.core.costs import get_month_summary
            s = get_month_summary()
            return f"${s['total_usd']:.2f}"
        except Exception:
            return "$0.00"

    @rx.var(cache=False)
    def wallet_subtitle(self) -> str:
        """Subtitle for wallet card."""
        try:
            from hynous.core.costs import get_month_summary
            s = get_month_summary()
            return f"{s['month']} operating costs"
        except Exception:
            return "This month"

    @rx.var(cache=False)
    def wallet_claude_cost(self) -> str:
        """Claude API cost string."""
        try:
            from hynous.core.costs import get_month_summary
            s = get_month_summary()
            c = s["claude"]
            return f"${c['cost_usd']:.2f}"
        except Exception:
            return "$0.00"

    @rx.var(cache=False)
    def wallet_claude_calls(self) -> str:
        """Claude API call count."""
        try:
            from hynous.core.costs import get_month_summary
            return str(get_month_summary()["claude"]["calls"])
        except Exception:
            return "0"

    @rx.var(cache=False)
    def wallet_claude_tokens(self) -> str:
        """Claude token usage string."""
        try:
            from hynous.core.costs import get_month_summary
            c = get_month_summary()["claude"]
            return f"{c['input_tokens']:,} in / {c['output_tokens']:,} out"
        except Exception:
            return "0 in / 0 out"

    @rx.var(cache=False)
    def wallet_perplexity_cost(self) -> str:
        """Perplexity API cost string."""
        try:
            from hynous.core.costs import get_month_summary
            return f"${get_month_summary()['perplexity']['cost_usd']:.2f}"
        except Exception:
            return "$0.00"

    @rx.var(cache=False)
    def wallet_perplexity_calls(self) -> str:
        """Perplexity API call count."""
        try:
            from hynous.core.costs import get_month_summary
            return str(get_month_summary()["perplexity"]["calls"])
        except Exception:
            return "0"

    @rx.var
    def wallet_coinglass_cost(self) -> str:
        """Coinglass monthly subscription cost."""
        return "$35.00"

    @rx.var
    def positions_count(self) -> str:
        """Number of open positions — updated by background poller."""
        return str(len(self.positions))

    @rx.var
    def message_count(self) -> str:
        """Number of messages as string."""
        return str(len(self.messages))

    @rx.var(cache=False)
    def daemon_running(self) -> bool:
        """Whether the background daemon is active.

        cache=False because this reads module-level _daemon which Reflex
        auto_deps can't track. Without this, the value is permanently cached.
        """
        return _daemon is not None and _daemon.is_running

    @rx.var(cache=False)
    def daemon_wake_count(self) -> str:
        """Total daemon wakes this session."""
        if _daemon is None:
            return "0"
        return str(_daemon.wake_count)

    @rx.var(cache=False)
    def daemon_status_text(self) -> str:
        """Daemon status: Running / Stopped / Paused."""
        if _daemon is None or not _daemon.is_running:
            return "Stopped"
        if _daemon.trading_paused:
            return "Paused"
        return "Running"

    @rx.var(cache=False)
    def daemon_status_color(self) -> str:
        """Color for daemon status dot."""
        if _daemon is None or not _daemon.is_running:
            return "#525252"
        if _daemon.trading_paused:
            return "#ef4444"
        return "#22c55e"

    @rx.var(cache=False)
    def daemon_daily_pnl(self) -> str:
        """Today's realized PnL string."""
        if _daemon is None:
            return "$0.00"
        pnl = _daemon.daily_realized_pnl
        sign = "+" if pnl >= 0 else ""
        return f"{sign}${pnl:,.2f}"

    @rx.var(cache=False)
    def daemon_trading_paused(self) -> bool:
        """Whether circuit breaker is active."""
        return _daemon is not None and _daemon.trading_paused

    @rx.var(cache=False)
    def daemon_activities(self) -> list[DaemonActivity]:
        """Last 20 daemon events from the activity log."""
        try:
            from hynous.core.daemon_log import get_events
            raw = get_events(limit=20)
            return [DaemonActivity(**e) for e in raw]
        except Exception:
            return []

    @rx.var(cache=False)
    def events_macro_html(self) -> str:
        """Pre-rendered HTML for macro economic events."""
        if _daemon is None:
            return ""
        data = _daemon.cached_events
        if not data or not isinstance(data, dict):
            return ""
        macro = data.get("macro", [])
        if not macro:
            return ""
        from html import escape
        rows = []
        for e in macro:
            name = escape(str(e.get("name", "")))
            date = escape(str(e.get("date", "")))
            country = escape(str(e.get("country", "")))
            impact = str(e.get("impact", "")).lower()
            estimate = escape(str(e.get("estimate", "")))
            previous = escape(str(e.get("previous", "")))
            # Impact dot color
            dot_color = "#ef4444" if impact == "high" else "#fbbf24" if impact == "medium" else "#525252"
            # Values line
            vals = ""
            if estimate or previous:
                parts = []
                if estimate:
                    parts.append(f"Est: {estimate}")
                if previous:
                    parts.append(f"Prev: {previous}")
                vals = (
                    f'<span style="font-size:0.68rem;color:#525252;margin-left:4px">'
                    f'{" / ".join(parts)}</span>'
                )
            rows.append(
                f'<div style="display:flex;align-items:center;gap:6px;padding:4px 0;'
                f'border-bottom:1px solid #1a1a1a">'
                f'<span style="font-size:0.7rem;color:#525252;min-width:42px;flex-shrink:0">{date}</span>'
                f'<span style="width:6px;height:6px;border-radius:50%;background:{dot_color};flex-shrink:0"></span>'
                f'<span style="font-size:0.75rem;color:#e5e5e5">{name}'
                f'<span style="color:#525252;font-size:0.68rem"> ({country})</span>'
                f'{vals}</span>'
                f'</div>'
            )
        return "".join(rows)

    @rx.var(cache=False)
    def events_crypto_html(self) -> str:
        """Pre-rendered HTML for crypto events."""
        if _daemon is None:
            return ""
        data = _daemon.cached_events
        if not data or not isinstance(data, dict):
            return ""
        crypto = data.get("crypto", [])
        if not crypto:
            return ""
        from html import escape
        rows = []
        for e in crypto:
            title = escape(str(e.get("title", "")))
            date = escape(str(e.get("date", "")))
            coins = e.get("coins", [])
            category = escape(str(e.get("category", "")))
            # Format date to short
            if len(date) == 10:  # YYYY-MM-DD
                try:
                    from datetime import datetime
                    dt = datetime.strptime(date, "%Y-%m-%d")
                    date = dt.strftime("%b %d")
                except Exception:
                    pass
            # Coin badges
            coin_html = ""
            for sym in coins[:3]:
                coin_html += (
                    f'<span style="font-size:0.7rem;font-weight:600;color:#818cf8;'
                    f'margin-right:4px">{escape(sym)}</span>'
                )
            # Category badge
            cat_html = ""
            if category:
                cat_html = (
                    f'<span style="font-size:0.62rem;color:#525252;background:#1a1a1a;'
                    f'padding:1px 5px;border-radius:4px;margin-left:4px">{category}</span>'
                )
            rows.append(
                f'<div style="display:flex;align-items:center;gap:6px;padding:4px 0;'
                f'border-bottom:1px solid #1a1a1a">'
                f'<span style="font-size:0.7rem;color:#525252;min-width:42px;flex-shrink:0">{date}</span>'
                f'{coin_html}'
                f'<span style="font-size:0.73rem;color:#a3a3a3;flex:1;min-width:0;'
                f'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{title}{cat_html}</span>'
                f'</div>'
            )
        return "".join(rows)

    @rx.var(cache=False)
    def events_age_str(self) -> str:
        """How long ago events were fetched."""
        if _daemon is None:
            return ""
        data = _daemon.cached_events
        if not data or not isinstance(data, dict):
            age = _daemon.events_age_seconds
        else:
            fetched_at = data.get("fetched_at", 0)
            if not fetched_at:
                return ""
            import time as _time
            age = _time.time() - fetched_at
        if age == float("inf") or age < 0:
            return ""
        mins = int(age / 60)
        if mins < 60:
            return f"Updated {mins}m ago"
        hours = mins // 60
        return f"Updated {hours}h ago"

    @rx.var(cache=False)
    def events_funding_html(self) -> str:
        """Pre-rendered HTML badges for current funding rates."""
        if _daemon is None:
            return ""
        rates = _daemon.current_funding_rates
        if not rates:
            return ""
        from html import escape
        parts = []
        for sym in sorted(rates.keys()):
            rate = rates[sym]
            pct = rate * 100
            color = "#4ade80" if rate >= 0 else "#f87171"
            bg = "rgba(74,222,128,0.08)" if rate >= 0 else "rgba(248,113,113,0.08)"
            sign = "+" if rate >= 0 else ""
            parts.append(
                f'<span style="display:inline-flex;align-items:center;gap:4px;'
                f'padding:3px 8px;border-radius:6px;background:{bg};'
                f'border:1px solid {color}22;margin:2px 4px 2px 0;font-size:0.75rem">'
                f'<span style="color:#a3a3a3;font-weight:500">{escape(sym)}</span>'
                f'<span style="color:{color};font-weight:600">{sign}{pct:.4f}%</span>'
                f'</span>'
            )
        return "".join(parts)

    @rx.var(cache=False)
    def daemon_next_review(self) -> str:
        """Countdown to next periodic review."""
        if _daemon is None or not _daemon.is_running:
            return "—"
        secs = _daemon.next_review_seconds
        if secs <= 0:
            return "Soon"
        mins = secs // 60
        if mins >= 60:
            return f"{mins // 60}h {mins % 60}m"
        return f"{mins}m"

    @rx.var(cache=False)
    def daemon_cooldown(self) -> str:
        """Wake cooldown status."""
        if _daemon is None or not _daemon.is_running:
            return "—"
        remaining = _daemon.cooldown_remaining
        if remaining <= 0:
            return "Ready"
        return f"{remaining}s"

    @rx.var(cache=False)
    def daemon_cooldown_active(self) -> bool:
        """Whether wake cooldown is active."""
        if _daemon is None:
            return False
        return _daemon.cooldown_remaining > 0

    @rx.var(cache=False)
    def daemon_wake_rate(self) -> str:
        """Wakes this hour / max."""
        if _daemon is None or not _daemon.is_running:
            return "—"
        current = _daemon.wakes_this_hour
        max_h = _daemon.config.daemon.max_wakes_per_hour
        return f"{current}/{max_h}"

    @rx.var(cache=False)
    def daemon_reviews_until_learning(self) -> str:
        """Reviews until next learning session."""
        if _daemon is None or not _daemon.is_running:
            return "—"
        n = _daemon.reviews_until_learning
        if n <= 1:
            return "Next review"
        return f"In {n} reviews"

    @rx.var(cache=False)
    def daemon_last_wake_ago(self) -> str:
        """Time since last wake."""
        if _daemon is None or not _daemon.is_running:
            return "—"
        ts = _daemon.last_wake_time
        if not ts:
            return "Never"
        import time as _time
        elapsed = int(_time.time() - ts)
        if elapsed < 60:
            return "Just now"
        mins = elapsed // 60
        if mins < 60:
            return f"{mins}m ago"
        hours = mins // 60
        return f"{hours}h {mins % 60}m ago"

    @rx.var(cache=False)
    def daemon_review_count(self) -> str:
        """Total reviews completed."""
        if _daemon is None:
            return "0"
        return str(_daemon.review_count)

    @rx.var(cache=False)
    def daemon_today_wakes(self) -> list[DaemonActivityFormatted]:
        """Today's daemon events with relative timestamps."""
        try:
            from hynous.core.daemon_log import get_events
            from datetime import datetime, timezone, timedelta
            raw = get_events(limit=50)
            today = datetime.now(timezone.utc).date()
            result = []
            for e in raw:
                ts_str = e.get("timestamp", "")
                if not ts_str:
                    continue
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                except Exception:
                    continue
                if ts.date() != today:
                    continue
                # Skip "skip" events for cleaner display
                if e.get("type") == "skip":
                    continue
                # Format relative time
                now = datetime.now(timezone.utc)
                delta = int((now - ts).total_seconds())
                if delta < 60:
                    age = "Just now"
                elif delta < 3600:
                    age = f"{delta // 60}m ago"
                else:
                    age = f"{delta // 3600}h {(delta % 3600) // 60}m ago"
                result.append(DaemonActivityFormatted(
                    type=e.get("type", ""),
                    title=e.get("title", ""),
                    detail=e.get("detail", ""),
                    time_display=age,
                ))
            return result[:15]  # Cap at 15
        except Exception:
            return []

    @rx.var
    def agent_status_display(self) -> str:
        """Capitalized agent status."""
        return self.agent_status.capitalize()

    @rx.var
    def agent_status_color(self) -> str:
        """Color for agent status dot."""
        colors = {
            "online": "#22c55e",
            "thinking": "#eab308",
            "error": "#ef4444",
        }
        return colors.get(self.agent_status, "#525252")

    @rx.var
    def streaming_show_avatar(self) -> bool:
        """Whether the streaming bubble should show the Hynous avatar.

        False when the last saved message is already from Hynous (grouped).
        """
        if not self.messages:
            return True
        return self.messages[-1].sender != "hynous"

    @rx.var
    def streaming_display(self) -> str:
        """Streaming text with financial highlights applied."""
        if not self.streaming_text:
            return ""
        return _highlight(self.streaming_text)

    @rx.var
    def active_tool_display(self) -> str:
        """Human-readable name for the currently active tool."""
        if not self.active_tool:
            return ""
        return _TOOL_DISPLAY.get(self.active_tool, self.active_tool)

    @rx.var
    def active_tool_color(self) -> str:
        """Accent color for the currently active tool indicator."""
        colors = {
            "get_market_data": "#60a5fa",
            "get_orderbook": "#22d3ee",
            "get_funding_history": "#fbbf24",
            "get_multi_timeframe": "#a78bfa",
            "get_liquidations": "#fb923c",
            "get_global_sentiment": "#2dd4bf",
            "get_options_flow": "#f472b6",
            "get_institutional_flow": "#34d399",
            "search_web": "#e879f9",
            "get_my_costs": "#94a3b8",
            "store_memory": "#a3e635",
            "recall_memory": "#a3e635",
            "get_account": "#f59e0b",
            "execute_trade": "#22c55e",
            "close_position": "#ef4444",
            "modify_position": "#a78bfa",
            "get_trade_stats": "#f97316",
        }
        return colors.get(self.active_tool, "#a5b4fc")

    # === Daemon Controls ===

    is_waking: bool = False  # True while a manual wake is in progress

    def wake_agent_now(self):
        """Trigger an immediate daemon review wake.

        Non-blocking: fires the wake in a daemon background thread.
        Response appears in chat feed via the daemon chat queue.
        The is_waking flag is cleared by poll_portfolio when the response arrives.
        """
        if _daemon is None or not _daemon.is_running:
            self._add_activity("system", "Cannot wake — daemon not running", "warning")
            return
        if self.is_waking:
            return  # Already waking

        self.is_waking = True
        _daemon.trigger_manual_wake()
        self._add_activity("system", "Manual wake triggered", "info")

    def toggle_daemon(self, checked: bool = True):
        """Toggle daemon on/off.

        Fully synchronous — if agent needs init on first toggle, this blocks
        for ~7s. Acceptable since the user explicitly requested the action.
        After first init, toggling is instant.
        """
        global _daemon

        if not checked:
            # Stop — always instant
            if _daemon is not None and _daemon.is_running:
                _daemon.stop()
                self._add_activity("system", "Daemon stopped", "info")
            return

        # Start — initialize agent if needed
        agent = _get_agent()
        if not agent:
            self._add_activity("system", f"Daemon failed: {_agent_error}", "error")
            return

        if _daemon is None:
            from hynous.intelligence.daemon import Daemon
            _daemon = Daemon(agent, agent.config)
        if not _daemon.is_running:
            _daemon.start()
        self._add_activity("system", "Daemon started", "info")

    # === Navigation ===

    def go_to_home(self):
        """Navigate to home page."""
        self.current_page = "home"

    def go_to_chat(self):
        """Navigate to chat page."""
        self.current_page = "chat"

    def go_to_graph(self):
        """Navigate to memory graph page."""
        self.current_page = "graph"

    def go_to_chat_with_message(self, msg: str):
        """Navigate to chat and send a message."""
        self.current_page = "chat"
        self._pending_input = msg
        return self.send_message()

    # === Watchlist State ===

    watchpoint_groups: List[WatchpointGroup] = []
    watchpoint_count: str = "0"

    @_background
    async def load_watchpoints(self):
        """Fetch active watchpoints from Nous, grouped by symbol."""
        data = await asyncio.to_thread(self._fetch_watchpoints)
        async with self:
            self.watchpoint_groups = data["groups"]
            self.watchpoint_count = str(data["count"])

    @staticmethod
    def _fetch_watchpoints() -> dict:
        """Fetch watchpoints from Nous (sync, runs in thread).

        Returns WatchpointGroup list with pre-rendered HTML detail.
        """
        try:
            from hynous.nous.client import get_client
            import json as _json
            from html import escape

            client = get_client()
            nodes = client.list_nodes(subtype="custom:watchpoint", lifecycle="ACTIVE", limit=50)

            # Group by symbol
            by_symbol: dict[str, list[tuple[bool, str, str]]] = {}
            for n in nodes:
                body = _json.loads(n.get("content_body", "{}"))
                trigger = body.get("trigger", {})
                symbol = trigger.get("symbol", "?")
                condition = trigger.get("condition", "?")
                value = trigger.get("value", 0)
                title = n.get("content_title", "")

                # Format value
                if "price" in condition and value >= 1000:
                    val_str = f"${value:,.0f}"
                elif "price" in condition:
                    val_str = f"${value}"
                else:
                    val_str = str(value)

                # Short title: strip symbol/price prefix
                title_short = title
                for prefix in [f"{symbol} ${value:,.0f}", f"{symbol} ${value}", symbol]:
                    if title_short.startswith(prefix):
                        title_short = title_short[len(prefix):].lstrip(" —-")
                        break

                # Condition + direction
                is_up = "above" in condition or condition == "fear_greed_extreme"
                if condition == "fear_greed_extreme":
                    cond_label = f"F&G < {int(value)}"
                elif "above" in condition:
                    cond_label = f"above {val_str}"
                else:
                    cond_label = f"below {val_str}"

                by_symbol.setdefault(symbol, []).append(
                    (is_up, cond_label, title_short[:50])
                )

            # Build groups with pre-rendered HTML
            groups: list[WatchpointGroup] = []
            for sym in sorted(by_symbol.keys()):
                wp_items = by_symbol[sym]
                html_parts = []
                for is_up, cond, title in wp_items:
                    color = "#4ade80" if is_up else "#f87171"
                    bg = "rgba(74,222,128,0.05)" if is_up else "rgba(248,113,113,0.05)"
                    icon = "↗" if is_up else "↘"
                    title_html = (
                        f'<div style="font-size:0.72rem;color:#a3a3a3;padding-top:2px;line-height:1.4">'
                        f'{escape(title)}</div>'
                    ) if title else ""
                    html_parts.append(
                        f'<div style="padding:0.5rem 0.625rem;border-left:2px solid {color};'
                        f'background:{bg};border-radius:0 6px 6px 0;margin-bottom:0.375rem">'
                        f'<div style="display:flex;align-items:center;gap:0.375rem">'
                        f'<span style="color:{color};font-size:0.82rem">{icon}</span>'
                        f'<span style="font-size:0.78rem;font-weight:500;color:{color}">'
                        f'{escape(cond)}</span>'
                        f'</div>{title_html}</div>'
                    )
                groups.append(WatchpointGroup(
                    symbol=sym,
                    count=str(len(wp_items)),
                    detail_html="".join(html_parts),
                ))

            return {"groups": groups, "count": len(nodes)}
        except Exception:
            return {"groups": [], "count": 0}

    # === Journal State ===

    journal_win_rate: str = "—"
    journal_total_pnl: str = "—"
    journal_profit_factor: str = "—"
    journal_total_trades: str = "0"
    closed_trades: List[ClosedTrade] = []
    symbol_breakdown: list[dict] = []

    def go_to_journal(self):
        """Navigate to journal page and load data."""
        self.current_page = "journal"
        return AppState.load_journal

    @_background
    async def load_journal(self):
        """Load trade stats and equity data for journal page."""
        data = await asyncio.to_thread(self._fetch_journal_data)
        if data:
            async with self:
                stats, trades, breakdown = data
                self.journal_win_rate = f"{stats['win_rate']:.0f}%" if stats['total_trades'] > 0 else "—"
                sign = "+" if stats['total_pnl'] >= 0 else ""
                self.journal_total_pnl = f"{sign}${stats['total_pnl']:.2f}" if stats['total_trades'] > 0 else "—"
                pf = stats['profit_factor']
                self.journal_profit_factor = f"{pf:.2f}" if pf != float('inf') else "∞" if stats['total_trades'] > 0 else "—"
                self.journal_total_trades = str(stats['total_trades'])
                self.closed_trades = trades
                self.symbol_breakdown = breakdown

    @staticmethod
    def _fetch_journal_data():
        """Fetch journal data from trade analytics (sync, runs in thread)."""
        try:
            from hynous.core.trade_analytics import get_trade_stats
            stats = get_trade_stats()
            trades = [
                ClosedTrade(
                    symbol=t.symbol,
                    side=t.side,
                    entry_px=t.entry_px,
                    exit_px=t.exit_px,
                    pnl_pct=round(t.pnl_pct, 2),
                    pnl_usd=round(t.pnl_usd, 2),
                    closed_at=t.closed_at,
                    close_type=t.close_type,
                    duration_hours=round(t.duration_hours, 1),
                    date=t.closed_at.split("T")[0] if "T" in t.closed_at else t.closed_at[:10],
                )
                for t in stats.trades[:30]
            ]
            breakdown = [
                {
                    "symbol": sym,
                    "trades": d["trades"],
                    "win_rate": d["win_rate"],
                    "pnl": f"${d['pnl']:.2f}",
                    "pnl_positive": d["pnl"] >= 0,
                }
                for sym, d in sorted(stats.by_symbol.items())
            ]
            return (
                {
                    "win_rate": stats.win_rate,
                    "total_pnl": stats.total_pnl,
                    "profit_factor": stats.profit_factor,
                    "total_trades": stats.total_trades,
                },
                trades,
                breakdown,
            )
        except Exception:
            return None

    @rx.var(cache=False)
    def journal_equity_data(self) -> list[dict]:
        """Equity curve data for chart. cache=False: reads external file."""
        try:
            from hynous.core.equity_tracker import get_equity_data
            data = get_equity_data(days=30)
            # Format for recharts
            result = []
            for point in data:
                ts = point.get("timestamp", 0)
                from datetime import datetime, timezone
                dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                result.append({
                    "date": dt.strftime("%m/%d"),
                    "value": point.get("account_value", 0),
                    "pnl": point.get("unrealized_pnl", 0),
                })
            return result
        except Exception:
            return []
