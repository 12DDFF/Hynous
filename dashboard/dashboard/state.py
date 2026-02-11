"""
Application State

Central state management for the Hynous dashboard.
All reactive state lives here.
"""

import json
import re
import asyncio
import threading
import reflex as rx
import logging
from pathlib import Path
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
# --- Model preference persistence ---
_MODEL_PREFS_FILE = Path(__file__).resolve().parents[2] / "storage" / "model_prefs.json"

def _save_model_prefs(main: str, sub: str) -> None:
    """Persist model selection to disk so it survives restarts."""
    try:
        _MODEL_PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _MODEL_PREFS_FILE.write_text(json.dumps({"model": main, "sub_model": sub}))
    except Exception:
        pass

def _load_model_prefs() -> tuple[str, str] | None:
    """Load saved model preferences, or None if not saved."""
    try:
        if _MODEL_PREFS_FILE.exists():
            d = json.loads(_MODEL_PREFS_FILE.read_text())
            return d.get("model", ""), d.get("sub_model", "")
    except Exception:
        pass
    return None


# --- Model selection options (label, litellm model ID) ---
_MODEL_OPTIONS: list[tuple[str, str]] = [
    # Anthropic
    ("Claude Opus 4.6", "openrouter/anthropic/claude-opus-4.6"),
    ("Claude Opus 4.5", "openrouter/anthropic/claude-opus-4.5"),
    ("Claude Sonnet 4.5", "openrouter/anthropic/claude-sonnet-4-5-20250929"),
    ("Claude Haiku 4.5", "openrouter/anthropic/claude-haiku-4-5-20251001"),
    # OpenAI — GPT-5.2
    ("GPT-5.2 Pro", "openrouter/openai/gpt-5.2-pro"),
    ("GPT-5.2", "openrouter/openai/gpt-5.2"),
    ("GPT-5.2 Codex", "openrouter/openai/gpt-5.2-codex"),
    ("GPT-5.2 Chat", "openrouter/openai/gpt-5.2-chat"),
    # OpenAI — GPT-5.1
    ("GPT-5.1", "openrouter/openai/gpt-5.1"),
    ("GPT-5.1 Codex Max", "openrouter/openai/gpt-5.1-codex-max"),
    ("GPT-5.1 Codex", "openrouter/openai/gpt-5.1-codex"),
    ("GPT-5.1 Codex Mini", "openrouter/openai/gpt-5.1-codex-mini"),
    ("GPT-5.1 Chat", "openrouter/openai/gpt-5.1-chat"),
    # OpenAI — GPT-5
    ("GPT-5", "openrouter/openai/gpt-5-2025-08-07"),
    ("GPT-5 Mini", "openrouter/openai/gpt-5-mini-2025-08-07"),
    ("GPT-5 Nano", "openrouter/openai/gpt-5-nano-2025-08-07"),
    # OpenAI — GPT-4.1
    ("GPT-4.1", "openrouter/openai/gpt-4.1-2025-04-14"),
    ("GPT-4.1 Mini", "openrouter/openai/gpt-4.1-mini-2025-04-14"),
    ("GPT-4.1 Nano", "openrouter/openai/gpt-4.1-nano-2025-04-14"),
    # xAI — Grok
    ("Grok 4.1 Fast", "openrouter/x-ai/grok-4.1-fast"),
    ("Grok 4 Fast", "openrouter/x-ai/grok-4-fast"),
    ("Grok 4", "openrouter/x-ai/grok-4-07-09"),
    ("Grok 3", "openrouter/x-ai/grok-3"),
    ("Grok 3 Mini", "openrouter/x-ai/grok-3-mini"),
    ("Grok Code Fast", "openrouter/x-ai/grok-code-fast-1"),
    # DeepSeek
    ("DeepSeek V3.2", "openrouter/deepseek/deepseek-v3.2"),
    ("DeepSeek V3.2 Speciale", "openrouter/deepseek/deepseek-v3.2-speciale"),
    # Google
    ("Gemini 3 Pro", "openrouter/google/gemini-3-pro-preview"),
    ("Gemini 3 Flash", "openrouter/google/gemini-3-flash-preview"),
    # Mistral
    ("Mistral Large 3", "openrouter/mistralai/mistral-large-2512"),
    ("Devstral 2", "openrouter/mistralai/devstral-2512"),
    # Qwen
    ("Qwen3 Max", "openrouter/qwen/qwen3-max-thinking"),
    ("Qwen3 Coder", "openrouter/qwen/qwen3-coder-next"),
]
_LABEL_TO_MODEL = {label: model_id for label, model_id in _MODEL_OPTIONS}
_MODEL_TO_LABEL = {model_id: label for label, model_id in _MODEL_OPTIONS}
MODEL_LABELS = [label for label, _ in _MODEL_OPTIONS]

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
    duration_str: str = ""  # Pre-formatted: "4.2h" or "1.3d"
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


class ClusterDisplay(BaseModel):
    """Cluster card data with pre-rendered health bar HTML."""
    name: str = ""
    node_count: str = "0"
    health_html: str = ""
    accent: str = "#525252"


class ConflictItem(BaseModel):
    """Structured conflict for per-item resolution UI."""
    conflict_id: str = ""
    conflict_type: str = ""
    confidence: str = ""
    old_title: str = ""
    old_body: str = ""
    new_title: str = ""
    new_body: str = ""


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

            # Apply saved model preferences (survives restarts)
            prefs = _load_model_prefs()
            if prefs:
                main, sub = prefs
                if main:
                    _agent.config.agent.model = main
                if sub:
                    _agent.config.memory.compression_model = sub
                logger.info("Applied saved model prefs: %s / %s", main, sub)

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

    # === Auth State ===
    is_authenticated: bool = False
    login_error: str = ""
    _session_token: str = rx.Cookie(name="hynous_session", max_age=86400 * 7)

    # === Auth Methods ===

    def authenticate(self, form_data: dict):
        """Validate password, set session cookie."""
        import hashlib, hmac, os
        password = form_data.get("password", "")
        expected = os.getenv("DASHBOARD_PASSWORD", "")
        if not expected:
            self.is_authenticated = True
            return
        if hmac.compare_digest(password, expected):
            token = hashlib.sha256(expected.encode()).hexdigest()
            self._session_token = token
            self.is_authenticated = True
            self.login_error = ""
        else:
            self.login_error = "Wrong password"

    def logout(self):
        """Clear auth state and cookie."""
        self.is_authenticated = False
        self._session_token = ""

    def _check_session(self):
        """Validate session cookie against expected password hash."""
        import hashlib, os
        expected = os.getenv("DASHBOARD_PASSWORD", "")
        if not expected:
            self.is_authenticated = True
            return True
        valid_token = hashlib.sha256(expected.encode()).hexdigest()
        if self._session_token == valid_token:
            self.is_authenticated = True
            return True
        self.is_authenticated = False
        return False

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
                    replace_text = None

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
                        elif chunk_type == "replace":
                            replace_text = chunk_data

                    # Push batched updates in a single state lock
                    if text_batch or tool_event or error_msg or replace_text:
                        async with self:
                            if error_msg:
                                self.streaming_text += f"\n\nSomething went wrong: {error_msg}"
                                self.agent_status = "error"
                            if replace_text:
                                # Agent stripped text tool calls — replace with clean version
                                self.streaming_text = replace_text
                            elif text_batch:
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
                    f"Make sure OPENROUTER_API_KEY is set in your .env file.\n\n"
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
        # Check session cookie before loading anything
        if not self._check_session():
            return

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

        # Start background tasks (init_daemon ensures agent+daemon start)
        return [AppState.init_daemon, AppState.poll_portfolio, AppState.load_watchpoints, AppState.load_clusters]

    @_background
    async def init_daemon(self):
        """Ensure agent + daemon are initialized (runs in background on page load)."""
        agent = await asyncio.to_thread(_get_agent)
        if agent:
            async with self:
                self.selected_model = agent.config.agent.model
                self.selected_sub_model = agent.config.memory.compression_model

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

        _cluster_tick = 0
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

            # Refresh memory + scanner data every ~60s (4 polls)
            _cluster_tick += 1
            if _cluster_tick % 4 == 0:
                try:
                    cluster_data, health_data, conflict_data, wp_data, scanner_data = await asyncio.to_thread(
                        lambda: (
                            AppState._fetch_clusters(),
                            AppState._fetch_memory_health(),
                            AppState._fetch_conflicts(),
                            AppState._fetch_watchpoints(),
                            AppState._fetch_scanner_status(),
                        )
                    )
                    async with self:
                        self.cluster_displays = cluster_data["clusters"]
                        self.cluster_total = str(cluster_data["total"])
                        self.memory_node_count = health_data["node_count"]
                        self.memory_edge_count = health_data["edge_count"]
                        self.memory_health_ratio = health_data["health_ratio"]
                        self.memory_lifecycle_html = health_data["lifecycle_html"]
                        self.conflict_count = conflict_data["count"]
                        self.watchpoint_groups = wp_data["groups"]
                        self.watchpoint_count = str(wp_data["count"])
                        # Scanner banner
                        self.scanner_active = scanner_data["active"]
                        self.scanner_warming_up = scanner_data["warming_up"]
                        self.scanner_price_polls = scanner_data["price_polls"]
                        self.scanner_deriv_polls = scanner_data["deriv_polls"]
                        self.scanner_pairs_count = scanner_data["pairs_count"]
                        self.scanner_anomalies_total = scanner_data["anomalies_detected"]
                        self.scanner_wakes_total = scanner_data["wakes_triggered"]
                        self.scanner_recent = scanner_data["recent"]
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
    def wallet_llm_cost(self) -> str:
        """Total LLM API cost string."""
        try:
            from hynous.core.costs import get_month_summary
            s = get_month_summary()
            return f"${s['llm']['total_cost_usd']:.2f}"
        except Exception:
            return "$0.00"

    @rx.var(cache=False)
    def wallet_llm_calls(self) -> str:
        """Total LLM API call count."""
        try:
            from hynous.core.costs import get_month_summary
            return str(get_month_summary()["llm"]["total_calls"])
        except Exception:
            return "0"

    @rx.var(cache=False)
    def wallet_llm_tokens(self) -> str:
        """Total LLM token usage string."""
        try:
            from hynous.core.costs import get_month_summary
            llm = get_month_summary()["llm"]
            return f"{llm['total_input_tokens']:,} in / {llm['total_output_tokens']:,} out"
        except Exception:
            return "0 in / 0 out"

    @rx.var(cache=False)
    def wallet_models_html(self) -> str:
        """Pre-rendered HTML for per-model cost breakdown in wallet dialog."""
        try:
            from hynous.core.costs import get_month_summary
            from html import escape
            models = get_month_summary()["llm"]["models"]
            if not models:
                return '<div style="color:#404040;font-size:0.75rem">No LLM calls yet</div>'
            rows = []
            for m in models:
                if m["calls"] == 0:
                    continue
                rows.append(
                    f'<div style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem 0;'
                    f'border-bottom:1px solid #1a1a1a">'
                    f'<div style="flex:1;min-width:0">'
                    f'<div style="color:#d4d4d4;font-size:0.78rem;font-weight:500">'
                    f'{escape(m["label"])}</div>'
                    f'<div style="display:flex;gap:0.5rem;font-size:0.65rem;margin-top:2px">'
                    f'<span style="color:#a78bfa;font-weight:500">${m["cost_usd"]:.2f}</span>'
                    f'<span style="color:#404040">\u00b7</span>'
                    f'<span style="color:#525252">{m["calls"]} calls</span>'
                    f'<span style="color:#404040">\u00b7</span>'
                    f'<span style="color:#404040">{m["input_tokens"]:,} in / {m["output_tokens"]:,} out</span>'
                    f'</div></div></div>'
                )
            return "".join(rows)
        except Exception:
            return ""

    @rx.var(cache=False)
    def wallet_sonnet_cost(self) -> str:
        """Sonnet model cost string (legacy)."""
        return "$0.00"

    @rx.var(cache=False)
    def wallet_sonnet_calls(self) -> str:
        """Sonnet model call count (legacy)."""
        try:
            from hynous.core.costs import get_month_summary
            return str(get_month_summary()['claude']['sonnet']['calls'])
        except Exception:
            return "0"

    @rx.var(cache=False)
    def wallet_haiku_cost(self) -> str:
        """Haiku model cost string."""
        try:
            from hynous.core.costs import get_month_summary
            return f"${get_month_summary()['claude']['haiku']['cost_usd']:.2f}"
        except Exception:
            return "$0.00"

    @rx.var(cache=False)
    def wallet_haiku_calls(self) -> str:
        """Haiku model call count."""
        try:
            from hynous.core.costs import get_month_summary
            return str(get_month_summary()['claude']['haiku']['calls'])
        except Exception:
            return "0"

    @rx.var(cache=False)
    def wallet_cache_savings(self) -> str:
        """Cache savings string."""
        try:
            from hynous.core.costs import get_month_summary
            return f"${get_month_summary()['claude']['cache_savings_usd']:.2f}"
        except Exception:
            return "$0.00"

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

    def go_to_memory(self):
        """Navigate to memory management page and load data."""
        self.current_page = "memory"
        return AppState.load_memory_page

    def go_to_chat_with_message(self, msg: str):
        """Navigate to chat and send a message."""
        self.current_page = "chat"
        self._pending_input = msg
        return self.send_message()

    # === Model Selection ===
    selected_model: str = "openrouter/anthropic/claude-sonnet-4-5-20250929"
    selected_sub_model: str = "openrouter/anthropic/claude-haiku-4-5-20251001"

    @rx.var
    def selected_model_label(self) -> str:
        """Human-readable label for the currently selected main model."""
        return _MODEL_TO_LABEL.get(self.selected_model, self.selected_model)

    @rx.var
    def selected_sub_model_label(self) -> str:
        """Human-readable label for the currently selected sub-agent model."""
        return _MODEL_TO_LABEL.get(self.selected_sub_model, self.selected_sub_model)

    def set_agent_model(self, label: str):
        """Switch the main agent model at runtime."""
        model_id = _LABEL_TO_MODEL.get(label, label)
        self.selected_model = model_id
        agent = _get_agent()
        if agent:
            agent.config.agent.model = model_id
            agent.rebuild_system_prompt()
        _save_model_prefs(model_id, self.selected_sub_model)

    def set_sub_model(self, label: str):
        """Switch the sub-agent (coach/compression) model at runtime."""
        model_id = _LABEL_TO_MODEL.get(label, label)
        self.selected_sub_model = model_id
        agent = _get_agent()
        if agent:
            agent.config.memory.compression_model = model_id
        _save_model_prefs(self.selected_model, model_id)

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

    # === Clusters State ===

    cluster_displays: List[ClusterDisplay] = []
    cluster_total: str = "0"

    @_background
    async def load_clusters(self):
        """Fetch cluster data from Nous."""
        data = await asyncio.to_thread(self._fetch_clusters)
        async with self:
            self.cluster_displays = data["clusters"]
            self.cluster_total = str(data["total"])

    @staticmethod
    def _fetch_clusters() -> dict:
        """Fetch clusters with health info (sync, runs in thread)."""
        try:
            from hynous.nous.client import get_client
            from html import escape

            client = get_client()
            clusters = client.list_clusters()

            # Color map for known cluster names
            accent_map = {
                "BTC": "#f7931a",
                "ETH": "#627eea",
                "SOL": "#9945ff",
                "Thesis": "#60a5fa",
                "Theses": "#60a5fa",
                "Lessons": "#a3e635",
                "Trade History": "#f59e0b",
            }

            displays: list[ClusterDisplay] = []
            total_nodes = 0

            for cl in clusters:
                cid = cl.get("id", "")
                name = cl.get("name", "?")
                node_count = cl.get("node_count", 0)
                total_nodes += node_count
                accent = accent_map.get(name, "#a5b4fc")

                # Fetch health for this cluster
                health_html = ""
                try:
                    health = client.get_cluster_health(cid)
                    active = health.get("active_nodes", 0)
                    weak = health.get("weak_nodes", 0)
                    dormant = health.get("dormant_nodes", 0)
                    total = active + weak + dormant

                    if total > 0:
                        a_pct = round(active / total * 100)
                        w_pct = round(weak / total * 100)
                        d_pct = 100 - a_pct - w_pct

                        # Health bar
                        bar = (
                            f'<div style="display:flex;height:4px;border-radius:2px;overflow:hidden;'
                            f'background:#1a1a1a;margin-top:6px">'
                        )
                        if a_pct > 0:
                            bar += f'<div style="width:{a_pct}%;background:#22c55e"></div>'
                        if w_pct > 0:
                            bar += f'<div style="width:{w_pct}%;background:#eab308"></div>'
                        if d_pct > 0:
                            bar += f'<div style="width:{d_pct}%;background:#404040"></div>'
                        bar += '</div>'

                        # Labels
                        labels = []
                        if active:
                            labels.append(f'<span style="color:#22c55e">{active} active</span>')
                        if weak:
                            labels.append(f'<span style="color:#eab308">{weak} weak</span>')
                        if dormant:
                            labels.append(f'<span style="color:#525252">{dormant} dormant</span>')
                        label_row = (
                            f'<div style="display:flex;gap:8px;font-size:0.65rem;margin-top:4px">'
                            f'{" ".join(labels)}</div>'
                        )
                        health_html = bar + label_row
                    else:
                        health_html = (
                            '<div style="font-size:0.65rem;color:#404040;margin-top:6px">'
                            'Empty cluster</div>'
                        )
                except Exception:
                    health_html = ""

                displays.append(ClusterDisplay(
                    name=name,
                    node_count=str(node_count),
                    health_html=health_html,
                    accent=accent,
                ))

            return {"clusters": displays, "total": total_nodes}
        except Exception:
            return {"clusters": [], "total": 0}

    # === Scanner Banner State ===

    scanner_active: bool = False
    scanner_warming_up: bool = False
    scanner_price_polls: int = 0
    scanner_deriv_polls: int = 0
    scanner_pairs_count: int = 0
    scanner_anomalies_total: int = 0
    scanner_wakes_total: int = 0
    scanner_recent: list[dict] = []
    scanner_expanded: bool = False

    def toggle_scanner_expanded(self):
        """Toggle scanner detail panel."""
        self.scanner_expanded = not self.scanner_expanded

    @rx.var(cache=False)
    def scanner_status_text(self) -> str:
        """Scanner headline for banner."""
        if _daemon is None or not _daemon.is_running or _daemon._scanner is None:
            return "Scanner Offline"
        if self.scanner_warming_up:
            return f"Warming Up  {self.scanner_price_polls}/5 price  {self.scanner_deriv_polls}/2 deriv"
        if self.scanner_active:
            return f"Scanner Active  {self.scanner_pairs_count} pairs"
        return "Scanner Idle"

    @rx.var(cache=False)
    def scanner_status_color(self) -> str:
        """Color for scanner icon."""
        if self.scanner_active:
            return "#2dd4bf"
        if self.scanner_warming_up:
            return "#fbbf24"
        return "#525252"

    @rx.var(cache=False)
    def scanner_subtitle(self) -> str:
        """Secondary text for banner."""
        if not self.scanner_active and not self.scanner_warming_up:
            return ""
        parts = []
        if self.scanner_anomalies_total > 0:
            parts.append(f"{self.scanner_anomalies_total} anomalies")
        if self.scanner_wakes_total > 0:
            parts.append(f"{self.scanner_wakes_total} wakes")
        if not parts:
            return "No anomalies yet"
        return " \u00b7 ".join(parts)

    @rx.var(cache=False)
    def scanner_recent_html(self) -> str:
        """Pre-rendered HTML for recent anomaly rows."""
        import time as _time
        if not self.scanner_recent:
            return (
                '<div style="font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;'
                'color:#404040;text-align:center;padding:0.5rem 0;">'
                'No anomalies detected yet</div>'
            )
        rows = []
        now = _time.time()
        for a in self.scanner_recent[:10]:
            age_s = int(now - a.get("detected_at", now))
            if age_s < 60:
                age = "just now"
            elif age_s < 3600:
                age = f"{age_s // 60}m ago"
            else:
                age = f"{age_s // 3600}h ago"

            sev = a.get("severity", 0)
            if sev >= 0.7:
                sev_color = "#ef4444"
            elif sev >= 0.5:
                sev_color = "#fbbf24"
            else:
                sev_color = "#525252"

            sym = a.get("symbol", "?")
            headline = a.get("headline", "")
            # Escape HTML
            from html import escape
            headline = escape(headline)

            rows.append(
                f'<div style="display:flex;gap:0.75rem;padding:0.25rem 0;align-items:center;">'
                f'<span style="width:52px;color:#525252;flex-shrink:0">{age}</span>'
                f'<span style="width:48px;color:#2dd4bf;font-weight:500;flex-shrink:0">{sym}</span>'
                f'<span style="flex:1;color:#a3a3a3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{headline}</span>'
                f'<span style="width:36px;text-align:right;color:{sev_color};flex-shrink:0">{sev:.2f}</span>'
                f'</div>'
            )
        html = (
            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;">'
            + "".join(rows)
            + '</div>'
        )
        return html

    @staticmethod
    def _fetch_scanner_status() -> dict:
        """Read scanner status from daemon (sync, thread-safe)."""
        try:
            if _daemon is not None and _daemon._scanner is not None:
                return _daemon._scanner.get_status()
        except Exception:
            pass
        return {
            "active": False, "warming_up": False,
            "price_polls": 0, "deriv_polls": 0,
            "pairs_count": 0, "anomalies_detected": 0,
            "wakes_triggered": 0, "recent": [],
        }

    # === Memory Management State ===

    memory_node_count: str = "0"
    memory_edge_count: str = "0"
    memory_health_ratio: str = "0%"
    memory_lifecycle_html: str = ""

    conflict_items: List[ConflictItem] = []
    conflict_count: str = "0"
    show_conflicts: bool = False

    stale_html: str = ""  # Pre-rendered dormant node list
    stale_count: str = "0"
    stale_filter: str = "DORMANT"
    show_stale: bool = False

    decay_running: bool = False
    decay_result: str = ""

    backfill_running: bool = False
    backfill_result: str = ""

    cluster_backfill_running: bool = False
    cluster_backfill_result: str = ""

    @_background
    async def load_memory_page(self):
        """Load all memory management data."""
        async with self:
            lifecycle = self.stale_filter
        health, conflicts, stale, clusters = await asyncio.to_thread(
            self._fetch_memory_page_data, lifecycle
        )
        async with self:
            self.memory_node_count = health["node_count"]
            self.memory_edge_count = health["edge_count"]
            self.memory_health_ratio = health["health_ratio"]
            self.memory_lifecycle_html = health["lifecycle_html"]
            self.conflict_items = conflicts["items"]
            self.conflict_count = conflicts["count"]
            self.stale_html = stale["html"]
            self.stale_count = stale["count"]
            self.cluster_displays = clusters["clusters"]
            self.cluster_total = str(clusters["total"])

    @staticmethod
    def _fetch_memory_page_data(lifecycle: str = "DORMANT") -> tuple:
        """Fetch all memory page data in one thread."""
        health = AppState._fetch_memory_health()
        conflicts = AppState._fetch_conflicts()
        stale = AppState._fetch_stale(lifecycle)
        clusters = AppState._fetch_clusters()
        return health, conflicts, stale, clusters

    @staticmethod
    def _fetch_memory_health() -> dict:
        """Fetch overall memory health from Nous."""
        try:
            from hynous.nous.client import get_client
            client = get_client()
            h = client.health()

            nodes = h.get("node_count", 0)
            edges = h.get("edge_count", 0)
            lifecycle = h.get("lifecycle", {})
            active = lifecycle.get("ACTIVE", 0)
            weak = lifecycle.get("WEAK", 0)
            dormant = lifecycle.get("DORMANT", 0)
            total = active + weak + dormant
            ratio = round(active / total * 100) if total > 0 else 0

            # Pre-render lifecycle bar
            if total > 0:
                a_pct = round(active / total * 100)
                w_pct = round(weak / total * 100)
                d_pct = 100 - a_pct - w_pct

                bar = (
                    '<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;'
                    'background:#1a1a1a;margin:8px 0 10px 0;width:100%">'
                )
                if a_pct > 0:
                    bar += f'<div style="width:{a_pct}%;background:#22c55e"></div>'
                if w_pct > 0:
                    bar += f'<div style="width:{w_pct}%;background:#eab308"></div>'
                if d_pct > 0:
                    bar += f'<div style="width:{d_pct}%;background:#404040"></div>'
                bar += '</div>'

                labels = (
                    f'<div style="display:flex;gap:12px;font-size:0.68rem;flex-wrap:wrap">'
                    f'<span style="color:#22c55e;white-space:nowrap">{active} active</span>'
                    f'<span style="color:#eab308;white-space:nowrap">{weak} weak</span>'
                    f'<span style="color:#525252;white-space:nowrap">{dormant} dormant</span>'
                    f'</div>'
                )
                lifecycle_html = bar + labels
            else:
                lifecycle_html = '<div style="color:#404040;font-size:0.7rem">No memories yet</div>'

            return {
                "node_count": str(nodes),
                "edge_count": str(edges),
                "health_ratio": f"{ratio}%",
                "lifecycle_html": lifecycle_html,
            }
        except Exception:
            return {"node_count": "0", "edge_count": "0", "health_ratio": "0%", "lifecycle_html": ""}

    @staticmethod
    def _fetch_conflicts() -> dict:
        """Fetch pending conflicts as structured ConflictItem list."""
        try:
            from hynous.nous.client import get_client
            client = get_client()
            conflicts = client.get_conflicts(status="pending")

            if not conflicts:
                return {"items": [], "count": "0"}

            items = []
            for c in conflicts[:100]:  # Cap at 100
                cid = c.get("id", "?")
                old_id = c.get("old_node_id", "?")
                new_id = c.get("new_node_id")
                new_content = c.get("new_content", "")
                confidence = c.get("detection_confidence", 0)
                ctype = c.get("conflict_type", "?")

                # Fetch old node
                old_title, old_body = old_id, ""
                try:
                    old_node = client.get_node(old_id)
                    if old_node:
                        old_title = old_node.get("content_title", old_id)
                        old_body = (old_node.get("content_body", "") or "")[:200]
                except Exception:
                    pass

                # Fetch new node
                new_title, new_body = "", ""
                if new_id:
                    try:
                        new_node = client.get_node(new_id)
                        if new_node:
                            new_title = new_node.get("content_title", "")
                            new_body = (new_node.get("content_body", "") or "")[:200]
                    except Exception:
                        pass

                conf_pct = f"{confidence:.0%}" if isinstance(confidence, float) else str(confidence)

                items.append(ConflictItem(
                    conflict_id=cid,
                    conflict_type=ctype,
                    confidence=conf_pct,
                    old_title=old_title,
                    old_body=old_body,
                    new_title=new_title or new_content[:80],
                    new_body=new_body or new_content[:200],
                ))

            return {"items": items, "count": str(len(conflicts))}
        except Exception:
            return {"items": [], "count": "0"}

    @staticmethod
    def _fetch_stale(lifecycle: str = "DORMANT") -> dict:
        """Fetch memories by lifecycle with pre-rendered HTML."""
        try:
            from hynous.nous.client import get_client
            from html import escape
            from datetime import datetime, timezone
            client = get_client()
            nodes = client.list_nodes(lifecycle=lifecycle, limit=30)

            if not nodes:
                return {"html": "", "count": "0"}

            now = datetime.now(timezone.utc)
            parts = []
            for n in nodes:
                nid = n.get("id", "?")
                title = n.get("content_title", "Untitled")
                subtype = (n.get("content_subtype", "") or "").replace("custom:", "")
                created = n.get("created_at", "")
                retrievability = n.get("neural_retrievability", 0)
                retr_pct = f"{retrievability:.0%}" if isinstance(retrievability, float) else "?"

                # Compute age
                days_old = "?"
                try:
                    ct = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    days_old = f"{(now - ct).days}d"
                except Exception:
                    pass

                parts.append(
                    f'<div style="display:flex;align-items:center;gap:0.75rem;padding:0.625rem 0;'
                    f'border-bottom:1px solid #1a1a1a" data-nid="{escape(nid)}">'
                    f'<div style="flex:1;min-width:0">'
                    f'<div style="color:#fafafa;font-size:0.78rem;font-weight:500;'
                    f'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{escape(title)}</div>'
                    f'<div style="display:flex;gap:0.5rem;font-size:0.65rem;margin-top:2px">'
                    f'<span style="color:#525252">{escape(subtype)}</span>'
                    f'<span style="color:#404040">{days_old} old</span>'
                    f'<span style="color:#404040">recall: {retr_pct}</span></div></div></div>'
                )

            return {"html": "".join(parts), "count": str(len(nodes))}
        except Exception:
            return {"html": "", "count": "0"}

    @_background
    async def run_decay(self):
        """Run FSRS decay cycle."""
        async with self:
            self.decay_running = True
            self.decay_result = ""
        try:
            result = await asyncio.to_thread(self._exec_decay)
            # Refresh health after decay
            health = await asyncio.to_thread(self._fetch_memory_health)
            async with self:
                self.decay_result = result
                self.decay_running = False
                self.memory_node_count = health["node_count"]
                self.memory_edge_count = health["edge_count"]
                self.memory_health_ratio = health["health_ratio"]
                self.memory_lifecycle_html = health["lifecycle_html"]
        except Exception as e:
            async with self:
                self.decay_result = f"Error: {e}"
                self.decay_running = False

    @staticmethod
    def _exec_decay() -> str:
        from hynous.nous.client import get_client
        client = get_client()
        result = client.run_decay()
        transitioned = result.get("transitioned", 0)
        processed = result.get("processed", 0)
        return f"Processed {processed} nodes, {transitioned} transitioned"

    @_background
    async def run_backfill(self):
        """Run embedding backfill."""
        async with self:
            self.backfill_running = True
            self.backfill_result = ""
        try:
            result = await asyncio.to_thread(self._exec_backfill)
            async with self:
                self.backfill_result = result
                self.backfill_running = False
        except Exception as e:
            async with self:
                self.backfill_result = f"Error: {e}"
                self.backfill_running = False

    @staticmethod
    def _exec_backfill() -> str:
        from hynous.nous.client import get_client
        client = get_client()
        result = client.backfill_embeddings()
        embedded = result.get("embedded", 0)
        total = result.get("total", 0)
        return f"Embedded {embedded}/{total} nodes"

    @_background
    async def run_cluster_backfill(self):
        """Retroactively assign all existing nodes to matching clusters."""
        async with self:
            self.cluster_backfill_running = True
            self.cluster_backfill_result = ""
        try:
            result = await asyncio.to_thread(self._exec_cluster_backfill)
            clusters = await asyncio.to_thread(self._fetch_clusters)
            async with self:
                self.cluster_backfill_result = result
                self.cluster_backfill_running = False
                self.cluster_displays = clusters["clusters"]
                self.cluster_total = str(clusters["total"])
        except Exception as e:
            async with self:
                self.cluster_backfill_result = f"Error: {e}"
                self.cluster_backfill_running = False

    @staticmethod
    def _exec_cluster_backfill() -> str:
        """Scan all ACTIVE nodes and assign to matching clusters."""
        import re as _re
        import json as _json
        from hynous.nous.client import get_client

        client = get_client()
        clusters = client.list_clusters()
        if not clusters:
            return "No clusters to backfill"

        nodes = client.list_nodes(lifecycle="ACTIVE", limit=500)
        if not nodes:
            return "No active nodes"

        assigned = 0
        for node in nodes:
            nid = node.get("id")
            subtype = node.get("subtype", "") or node.get("content_subtype", "")
            title = node.get("content_title", "")
            body = node.get("content_body", "")
            # Extract text from JSON body
            if body and body.startswith("{"):
                try:
                    body = _json.loads(body).get("text", body)
                except Exception:
                    pass
            text_upper = f"{title} {body}".upper()

            for cl in clusters:
                cid = cl.get("id")
                if not cid:
                    continue
                matched = False

                # Strategy 1: Subtype match
                auto_subs = cl.get("auto_subtypes")
                if auto_subs:
                    if isinstance(auto_subs, str):
                        try:
                            auto_subs = _json.loads(auto_subs)
                        except Exception:
                            auto_subs = None
                    if isinstance(auto_subs, list) and subtype in auto_subs:
                        matched = True

                # Strategy 2: Keyword match (cluster name in content)
                if not matched:
                    cluster_name = (cl.get("name") or "").upper()
                    if cluster_name and len(cluster_name) >= 2:
                        pattern = r'(?<![A-Z])' + _re.escape(cluster_name) + r'(?![A-Z])'
                        if _re.search(pattern, text_upper):
                            matched = True

                if matched:
                    try:
                        client.add_to_cluster(cid, node_id=nid)
                        assigned += 1
                    except Exception:
                        pass

        return f"Scanned {len(nodes)} nodes, {assigned} assignments made"

    @_background
    async def resolve_all_conflicts(self):
        """Batch resolve all pending conflicts as new_is_current."""
        try:
            result = await asyncio.to_thread(self._exec_batch_resolve, "new_is_current")
            # Refresh conflicts
            conflicts = await asyncio.to_thread(self._fetch_conflicts)
            health = await asyncio.to_thread(self._fetch_memory_health)
            async with self:
                self.conflict_items = conflicts["items"]
                self.conflict_count = conflicts["count"]
                self.memory_node_count = health["node_count"]
                self.memory_health_ratio = health["health_ratio"]
                self.memory_lifecycle_html = health["lifecycle_html"]
        except Exception:
            pass

    @_background
    async def resolve_all_keep_both(self):
        """Batch resolve all pending conflicts as keep_both."""
        try:
            result = await asyncio.to_thread(self._exec_batch_resolve, "keep_both")
            conflicts = await asyncio.to_thread(self._fetch_conflicts)
            async with self:
                self.conflict_items = conflicts["items"]
                self.conflict_count = conflicts["count"]
        except Exception:
            pass

    @staticmethod
    def _exec_batch_resolve(resolution: str) -> dict:
        from hynous.nous.client import get_client
        client = get_client()
        conflicts = client.get_conflicts(status="pending")
        if not conflicts:
            return {"resolved": 0}
        items = [{"conflict_id": c["id"], "resolution": resolution} for c in conflicts]
        return client.batch_resolve_conflicts(items)

    @_background
    async def bulk_archive_stale(self):
        """Archive all dormant memories."""
        try:
            await asyncio.to_thread(self._exec_bulk_archive)
            async with self:
                lifecycle = self.stale_filter
            stale = await asyncio.to_thread(self._fetch_stale, lifecycle)
            health = await asyncio.to_thread(self._fetch_memory_health)
            async with self:
                self.stale_html = stale["html"]
                self.stale_count = stale["count"]
                self.memory_node_count = health["node_count"]
                self.memory_health_ratio = health["health_ratio"]
                self.memory_lifecycle_html = health["lifecycle_html"]
        except Exception:
            pass

    @staticmethod
    def _exec_bulk_archive():
        from hynous.nous.client import get_client
        client = get_client()
        nodes = client.list_nodes(lifecycle="DORMANT", limit=100)
        archived = 0
        for n in nodes:
            try:
                client.update_node(n["id"], state_lifecycle="ARCHIVE")
                archived += 1
            except Exception:
                pass
        logger.info("Bulk archive: %d/%d dormant nodes archived", archived, len(nodes))

    def set_stale_filter(self, val: str):
        """Update stale lifecycle filter and refresh."""
        self.stale_filter = val
        return AppState.load_stale_filtered

    @_background
    async def load_stale_filtered(self):
        """Re-fetch stale nodes with current filter."""
        async with self:
            lifecycle = self.stale_filter
        stale = await asyncio.to_thread(self._fetch_stale, lifecycle)
        async with self:
            self.stale_html = stale["html"]
            self.stale_count = stale["count"]

    def toggle_conflicts(self):
        """Toggle conflicts dialog."""
        self.show_conflicts = not self.show_conflicts

    def toggle_stale(self):
        """Toggle stale memories dialog."""
        self.show_stale = not self.show_stale

    def resolve_one_conflict(self, conflict_id: str, resolution: str):
        """Resolve a single conflict and refresh."""
        return AppState._exec_resolve_one(conflict_id, resolution)

    @_background
    async def _exec_resolve_one(self, conflict_id: str, resolution: str):
        """Background: resolve one conflict, refresh list."""
        try:
            await asyncio.to_thread(self._do_resolve_one, conflict_id, resolution)
            conflicts = await asyncio.to_thread(self._fetch_conflicts)
            health = await asyncio.to_thread(self._fetch_memory_health)
            async with self:
                self.conflict_items = conflicts["items"]
                self.conflict_count = conflicts["count"]
                self.memory_node_count = health["node_count"]
                self.memory_health_ratio = health["health_ratio"]
                self.memory_lifecycle_html = health["lifecycle_html"]
        except Exception:
            pass

    @staticmethod
    def _do_resolve_one(conflict_id: str, resolution: str):
        from hynous.nous.client import get_client
        client = get_client()
        client.resolve_conflict(conflict_id, resolution)

    # === Journal State ===

    journal_win_rate: str = "—"
    journal_total_pnl: str = "—"
    journal_profit_factor: str = "—"
    journal_total_trades: str = "0"
    journal_current_streak: str = "—"
    journal_max_win_streak: str = "0"
    journal_max_loss_streak: str = "0"
    journal_avg_duration: str = "—"
    equity_days: int = 30
    closed_trades: List[ClosedTrade] = []
    symbol_breakdown: list[dict] = []

    def set_equity_days(self, days: str):
        """Update equity chart timeframe."""
        self.equity_days = int(days)

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
                # Streaks
                streak = stats['current_streak']
                if streak > 0:
                    self.journal_current_streak = f"+{streak}W"
                elif streak < 0:
                    self.journal_current_streak = f"{streak}L"
                else:
                    self.journal_current_streak = "—"
                self.journal_max_win_streak = str(stats['max_win_streak'])
                self.journal_max_loss_streak = str(stats['max_loss_streak'])
                # Avg duration
                dur = stats['avg_duration_hours']
                if dur >= 24:
                    self.journal_avg_duration = f"{dur / 24:.1f}d"
                elif dur > 0:
                    self.journal_avg_duration = f"{dur:.1f}h"
                else:
                    self.journal_avg_duration = "—"
                self.closed_trades = trades
                self.symbol_breakdown = breakdown

    @staticmethod
    def _fetch_journal_data():
        """Fetch journal data from trade analytics (sync, runs in thread)."""
        try:
            from hynous.core.trade_analytics import get_trade_stats
            stats = get_trade_stats()
            trades = []
            for t in stats.trades[:30]:
                dur_h = round(t.duration_hours, 1)
                if dur_h >= 24:
                    dur_str = f"{dur_h / 24:.1f}d"
                elif dur_h > 0:
                    dur_str = f"{dur_h}h"
                else:
                    dur_str = "—"
                trades.append(ClosedTrade(
                    symbol=t.symbol,
                    side=t.side,
                    entry_px=t.entry_px,
                    exit_px=t.exit_px,
                    pnl_pct=round(t.pnl_pct, 2),
                    pnl_usd=round(t.pnl_usd, 2),
                    closed_at=t.closed_at,
                    close_type=t.close_type,
                    duration_hours=dur_h,
                    duration_str=dur_str,
                    date=t.closed_at.split("T")[0] if "T" in t.closed_at else t.closed_at[:10],
                ))
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
                    "current_streak": stats.current_streak,
                    "max_win_streak": stats.max_win_streak,
                    "max_loss_streak": stats.max_loss_streak,
                    "avg_duration_hours": stats.avg_duration_hours,
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
            data = get_equity_data(days=self.equity_days)
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
