"""
Hynous Daemon — Background Watchdog + Curiosity Engine + Periodic Review

The daemon runs in a background thread, polling market data and evaluating
conditions — all zero LLM tokens. When something interesting happens (a
watchpoint triggers, curiosity accumulates, or it's time for a review), it
wakes the agent with assembled context.

Three-tier token model:
  Tier 1: Python polling (0 tokens) — prices, funding, fear/greed
  Tier 2: Reserved for future quick-gate filtering (~500 tokens)
  Tier 3: Full agent wake (~10-15K tokens) — tool use, reasoning, memory

Design: storm-014 (Memory-Triggered Watchdog & Curiosity-Driven Learning)

Usage:
    from hynous.intelligence.daemon import Daemon
    daemon = Daemon(agent, config)
    daemon.start()   # Background thread
    daemon.stop()    # Graceful shutdown
"""

import json
import logging
import queue as _queue_module
import re
import threading
import time
from datetime import datetime, timezone

from ..core.config import Config
from ..core.daemon_log import log_event, DaemonEvent, flush as flush_daemon_log

logger = logging.getLogger(__name__)

# Module-level reference so trading tools can check circuit breaker
_active_daemon: "Daemon | None" = None

# Queue for daemon wake conversations → consumed by the dashboard to show in chat.
# Each item: {"type": str, "title": str, "response": str}
_daemon_chat_queue: _queue_module.Queue = _queue_module.Queue()


def get_daemon_chat_queue() -> _queue_module.Queue:
    """Get the queue of daemon wake conversations for dashboard display."""
    return _daemon_chat_queue


def _notify_discord(wake_type: str, title: str, response: str):
    """Forward daemon notification to Discord (if bot is running)."""
    try:
        from ..discord.bot import notify
        notify(title, wake_type, response)
    except Exception:
        pass


def _queue_and_persist(wake_type: str, title: str, response: str, event_type: str = ""):
    """Put wake message in dashboard queue AND persistent wake log.

    The in-memory queue gives instant UI updates when the dashboard is open.
    The persistent log ensures messages survive restarts and are available
    even if the dashboard wasn't open when the wake happened.
    """
    item = {"type": wake_type, "title": title, "response": response}
    if event_type:
        item["event_type"] = event_type
    _daemon_chat_queue.put(item)
    try:
        from ..core.persistence import append_wake
        append_wake(wake_type, title, response)
    except Exception:
        pass


# Regex for detecting narrated trade entries in text (without actual tool calls).
# Matches trade-specific phrases, NOT generic "entering" (which could be
# "shorts entering the market" etc.). Patterns:
#   "Entering SOL long"  "Entering BTC micro short"  "going long"
#   "taking a short"  "Conviction: 0.68 — entering."
_TRADE_NARRATION_RE = re.compile(
    r'(?:'
    r'(?:entering|opening)\s+\w+\s+(?:long|short|micro|macro)'
    r'|going\s+(?:long|short)'
    r'|taking\s+a\s+(?:long|short)'
    r'|\u2014\s*entering\.'
    r')',
    re.IGNORECASE,
)


def _check_narrated_trade(response: str, agent) -> str | None:
    """Detect and fix narrated trades — agent said entry words without calling execute_trade.

    If detected, sends a follow-up message telling the agent to actually execute the trade.
    Returns the follow-up response if a correction was made, None otherwise.
    """
    if not response or not _TRADE_NARRATION_RE.search(response):
        return None
    if agent.last_chat_had_trade_tool():
        return None  # Tool was called — text is just confirmation, all good

    logger.warning(
        "NARRATED TRADE DETECTED — sending correction. Response: %s",
        response[:300],
    )

    # Send follow-up forcing tool execution
    correction = (
        "[SYSTEM] You just said you entered a trade in TEXT, but you never called "
        "execute_trade. Text is NOT execution — no position was opened. "
        "If you still want this trade, call execute_trade NOW with the exact parameters "
        "you described. If you changed your mind, say so clearly."
    )
    try:
        followup = agent.chat(correction, skip_snapshot=True, max_tokens=768, source="daemon:narration_fix")
        return followup
    except Exception as e:
        logger.error("Narration fix failed: %s", e)
        return None


def get_active_daemon() -> "Daemon | None":
    """Get the currently running daemon instance (if any).

    Used by trading tools to check circuit breaker and position limits.
    """
    return _active_daemon


class MarketSnapshot:
    """Lightweight cache of current market data for trigger evaluation.

    Updated by the daemon's polling loop. Evaluated against watchpoint
    triggers with zero LLM tokens.
    """

    def __init__(self):
        self.prices: dict[str, float] = {}       # symbol → mid price
        self.funding: dict[str, float] = {}      # symbol → funding rate (decimal)
        self.oi_usd: dict[str, float] = {}       # symbol → open interest USD
        self.volume_usd: dict[str, float] = {}   # symbol → 24h notional volume
        self.prev_day_price: dict[str, float] = {}  # symbol → previous day price (24h change)
        self.fear_greed: int = 0                  # 0-100 index
        self.last_price_poll: float = 0           # Unix timestamp
        self.last_deriv_poll: float = 0           # Unix timestamp

    def price_summary(self, symbols: list[str]) -> str:
        """Format a compact price summary for wake messages."""
        lines = []
        for sym in symbols:
            price = self.prices.get(sym)
            funding = self.funding.get(sym)
            if price:
                parts = [f"{sym}: ${price:,.0f}"]
                if funding is not None:
                    parts.append(f"Funding: {funding:.4%}")
                lines.append(" | ".join(parts))
        if self.fear_greed > 0:
            lines.append(f"Fear & Greed: {self.fear_greed}")
        return "\n".join(lines)


class Daemon:
    """Background autonomous loop for Hynous.

    Responsibilities:
    1. Poll market data at intervals (Hyperliquid prices, Coinglass derivatives)
    2. Evaluate watchpoint triggers against cached data
    3. Count curiosity items and trigger learning sessions
    4. Periodically wake the agent for market reviews
    5. Coordinate with user chat via agent._chat_lock
    """

    def __init__(self, agent, config: Config):
        self.agent = agent
        self.config = config
        self.snapshot = MarketSnapshot()

        self._running = False
        self._thread: threading.Thread | None = None

        # Cached provider references (avoid re-importing in every method)
        self._hl_provider = None
        self._nous_client = None

        # Pre-fetched deep market data for briefing injection
        from .briefing import DataCache
        self._data_cache = DataCache()

        # Timing trackers
        self._last_review: float = 0
        self._last_curiosity_check: float = 0
        self._last_learning_session: float = 0  # Cooldown to prevent runaway loop
        self._last_decay_cycle: float = 0
        self._last_conflict_check: float = 0
        self._last_health_check: float = 0
        self._last_embedding_backfill: float = 0

        # Nous health state
        self._nous_healthy: bool = True

        # Data-change gate: watchpoints only checked when data is fresh
        self._data_changed: bool = False

        # Position tracking (fill detection)
        self._prev_positions: dict[str, dict] = {}    # coin → {side, size, entry_px}
        self._tracked_triggers: dict[str, list] = {}  # coin → trigger orders snapshot
        self._last_fill_check: float = 0
        self._fill_fires: int = 0
        self._processed_fills: set[str] = set()       # Fill hashes already processed

        # Profit level tracking: {coin: {tier: last_alert_timestamp}}
        self._profit_alerts: dict[str, dict[str, float]] = {}
        self._profit_sides: dict[str, str] = {}  # coin → side (detect flips)
        self._peak_roe: dict[str, float] = {}  # coin → max ROE % seen during hold

        # Position type registry: {coin: {"type": "micro"|"macro", "entry_time": float}}
        # Populated by trading tool via register_position_type(), inferred on restart
        self._position_types: dict[str, dict] = {}

        # Risk guardrails (circuit breaker)
        self._daily_realized_pnl: float = 0.0
        self._daily_reset_date: str = ""    # YYYY-MM-DD UTC
        self._trading_paused: bool = False

        # Trade activity tracking (for conviction system awareness)
        self._entries_today: int = 0
        self._micro_entries_today: int = 0
        self._entries_this_week: int = 0
        self._last_entry_time: float = 0
        self._last_close_time: float = 0

        # Wake rate limiting
        self._wake_timestamps: list[float] = []
        self._last_wake_time: float = 0

        # Scanner stats
        self._scanner_pass_streak: int = 0

        # Phantom tracker (inaction cost — tracks what would have happened on passes)
        self._phantoms: list[dict] = []           # Active phantom positions
        self._phantom_results: list[dict] = []    # Resolved (for historical context)
        self._last_phantom_check: float = 0
        self._phantom_stats = {"missed": 0, "good_pass": 0, "expired": 0}

        # Cached counts (for snapshot, avoids re-querying Nous)
        self._active_watchpoint_count: int = 0
        self._active_thesis_count: int = 0
        self._pending_curiosity_count: int = 0

        # Heartbeat — updated every loop iteration, checked by dashboard watchdog
        self._heartbeat: float = time.time()

        # Coach cross-wake state
        self._pending_thoughts: list[str] = []       # Haiku questions (max 3)
        self._wake_fingerprints: list[frozenset] = []  # Last 5 tool+mutation fingerprints

        # Regime detection (computed every deriv poll, injected everywhere)
        self._regime = None             # RegimeState or None
        self._prev_regime_label = ""    # For shift detection

        # Market scanner (anomaly detection across all pairs)
        self._scanner = None
        if config.scanner.enabled:
            from .scanner import MarketScanner
            self._scanner = MarketScanner(config.scanner)
            self._scanner.execution_symbols = set(config.execution.symbols)
            self._scanner._data_layer_enabled = config.data_layer.enabled

        # Stats
        self.wake_count: int = 0
        self.watchpoint_fires: int = 0
        self.scanner_wakes: int = 0
        self.learning_sessions: int = 0
        self.decay_cycles_run: int = 0
        self.conflict_checks: int = 0
        self.health_checks: int = 0
        self.embedding_backfills: int = 0
        self.polls: int = 0
        self._review_count: int = 0

    # ================================================================
    # Cached Provider Access
    # ================================================================

    def _get_provider(self):
        """Get cached provider (PaperProvider in paper mode, Hyperliquid otherwise)."""
        if self._hl_provider is None:
            from ..data.providers.hyperliquid import get_provider
            self._hl_provider = get_provider(config=self.config)
        return self._hl_provider

    def _get_nous(self):
        """Get cached Nous client."""
        if self._nous_client is None:
            from ..nous.client import get_client
            self._nous_client = get_client()
        return self._nous_client

    # ================================================================
    # Lifecycle
    # ================================================================

    def start(self):
        """Start the daemon loop in a background thread."""
        if self._running:
            return
        global _active_daemon
        _active_daemon = self
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="hynous-daemon",
        )
        self._thread.start()
        scanner_status = "ON" if self._scanner else "OFF"
        logger.info("Daemon started (price=%ds, deriv=%ds, review=%ds, curiosity=%ds, "
                     "decay=%ds, conflicts=%ds, health=%ds, backfill=%ds, scanner=%s)",
                     self.config.daemon.price_poll_interval,
                     self.config.daemon.deriv_poll_interval,
                     self.config.daemon.periodic_interval,
                     self.config.daemon.curiosity_check_interval,
                     self.config.daemon.decay_interval,
                     self.config.daemon.conflict_check_interval,
                     self.config.daemon.health_check_interval,
                     self.config.daemon.embedding_backfill_interval,
                     scanner_status)

    def stop(self):
        """Stop the daemon loop gracefully."""
        global _active_daemon
        self._running = False
        if self._thread:
            self._thread.join(timeout=15)
            self._thread = None
        if _active_daemon is self:
            _active_daemon = None
        flush_daemon_log()  # Persist any buffered events
        try:
            from ..core.equity_tracker import flush as flush_equity
            flush_equity()
        except Exception:
            pass
        logger.info("Daemon stopped (wakes=%d, watchpoints=%d, learning=%d)",
                     self.wake_count, self.watchpoint_fires, self.learning_sessions)

    @property
    def is_running(self) -> bool:
        return self._running and self._thread is not None and self._thread.is_alive()

    @property
    def trading_paused(self) -> bool:
        """Whether the circuit breaker has paused trading."""
        return self._trading_paused

    @property
    def daily_realized_pnl(self) -> float:
        """Today's realized PnL (resets at UTC midnight)."""
        return self._daily_realized_pnl

    def record_trade_entry(self):
        """Record a new trade entry for activity tracking (called by trading tool)."""
        self._check_daily_reset()
        self._entries_today += 1
        self._entries_this_week += 1
        self._last_entry_time = time.time()
        self._persist_daily_pnl()

    def record_micro_entry(self):
        """Record a micro trade entry (called by trading tool when trade_type='micro')."""
        self._micro_entries_today += 1
        self._persist_daily_pnl()

    def register_position_type(self, coin: str, trade_type: str = "macro"):
        """Register trade type for a position. Called by trading tool on entry."""
        self._position_types[coin] = {
            "type": trade_type,
            "entry_time": time.time(),
        }
        self._persist_position_types()

    def get_position_type(self, coin: str) -> dict:
        """Get trade type info for a position. Infers from leverage if unregistered."""
        if coin in self._position_types:
            return self._position_types[coin]
        # Fallback: infer from leverage in _prev_positions
        prev = self._prev_positions.get(coin, {})
        leverage = prev.get("leverage", 20)
        inferred = "micro" if leverage >= 15 else "macro"
        return {"type": inferred, "entry_time": 0}

    def get_peak_roe(self, coin: str) -> float:
        """Get max favorable excursion (peak ROE %) tracked during hold."""
        return self._peak_roe.get(coin.upper(), 0.0)

    @property
    def last_trade_ago(self) -> str:
        """Human-readable time since last trade (entry or close)."""
        last = max(self._last_entry_time, self._last_close_time)
        if last == 0:
            return "never"
        elapsed = time.time() - last
        if elapsed < 3600:
            return f"{int(elapsed / 60)}m"
        elif elapsed < 86400:
            return f"{elapsed / 3600:.0f}h"
        return f"{elapsed / 86400:.0f}d"

    @property
    def status(self) -> dict:
        """Current daemon status for dashboard display."""
        return {
            "running": self.is_running,
            "wake_count": self.wake_count,
            "watchpoint_fires": self.watchpoint_fires,
            "scanner_wakes": self.scanner_wakes,
            "fill_fires": self._fill_fires,
            "learning_sessions": self.learning_sessions,
            "polls": self.polls,
            "trading_paused": self._trading_paused,
            "daily_pnl": self._daily_realized_pnl,
            "scanner": self._scanner.get_status() if self._scanner else None,
            "snapshot": {
                "prices": dict(self.snapshot.prices),
                "fear_greed": self.snapshot.fear_greed,
            },
            "regime": {
                "label": self._regime.label if self._regime else "UNKNOWN",
                "score": round(self._regime.score, 2) if self._regime else 0,
                "bias": self._regime.bias if self._regime else "NEUTRAL",
            } if self._regime else None,
        }

    @property
    def next_review_seconds(self) -> int:
        """Seconds until next periodic review (doubled on weekends)."""
        if not self._last_review:
            return 0
        interval = self.config.daemon.periodic_interval
        if datetime.now(timezone.utc).weekday() >= 5:
            interval *= 2
        elapsed = time.time() - self._last_review
        remaining = int(interval - elapsed)
        return max(remaining, 0)

    @property
    def cooldown_remaining(self) -> int:
        """Seconds remaining in wake cooldown (0 = ready)."""
        if not self._last_wake_time:
            return 0
        cooldown = self.config.daemon.wake_cooldown_seconds
        elapsed = time.time() - self._last_wake_time
        remaining = int(cooldown - elapsed)
        return max(remaining, 0)

    @property
    def wakes_this_hour(self) -> int:
        """Number of wakes in the last 60 minutes."""
        cutoff = time.time() - 3600
        return len([t for t in self._wake_timestamps if t > cutoff])

    @property
    def reviews_until_learning(self) -> int:
        """Reviews until next learning session (every 3rd review)."""
        return 3 - (self._review_count % 3)

    @property
    def current_funding_rates(self) -> dict[str, float]:
        """Current funding rates from snapshot."""
        return dict(self.snapshot.funding)

    @property
    def review_count(self) -> int:
        """Total periodic reviews completed."""
        return self._review_count

    @property
    def last_wake_time(self) -> float:
        """Unix timestamp of last wake."""
        return self._last_wake_time

    @property
    def micro_entries_today(self) -> int:
        """Number of micro trades entered today."""
        return self._micro_entries_today

    # ================================================================
    # Main Loop
    # ================================================================

    def _loop(self):
        """The daemon's heartbeat. Runs in a background thread."""
        # Startup health check — verify Nous is reachable
        self._check_health(startup=True)
        # Seed clusters if none exist
        self._seed_clusters()

        # Initial data fetch
        self._poll_prices()
        self._poll_derivatives()
        self._init_position_tracking()
        self._last_review = time.time()
        self._last_curiosity_check = time.time()
        self._last_decay_cycle = time.time()
        self._last_conflict_check = time.time()
        self._last_health_check = time.time()
        self._last_embedding_backfill = time.time()
        self._last_fill_check = time.time()
        self._last_phantom_check = time.time()
        self._load_phantoms()
        self._load_daily_pnl()

        while self._running:
            try:
                now = time.time()
                self._heartbeat = now

                # 0. Daily reset check (circuit breaker)
                self._check_daily_reset()

                # 1. Price polling (default every 60s)
                if now - self.snapshot.last_price_poll >= self.config.daemon.price_poll_interval:
                    self._poll_prices()

                # 1a. Fast trigger check EVERY loop (10s) for open positions
                # SL/TP must fire promptly — can't wait 60s between checks.
                # Fetches fresh prices only for position symbols (1 cheap API call).
                self._fast_trigger_check()

                # 1b. Full position tracking + profit monitoring (every 60s)
                if now - self._last_fill_check >= self.config.daemon.price_poll_interval:
                    live_positions = self._check_positions()
                    self._check_profit_levels(live_positions)
                    self._last_fill_check = now

                # 2. Derivatives polling (default every 300s)
                if now - self.snapshot.last_deriv_poll >= self.config.daemon.deriv_poll_interval:
                    self._poll_derivatives()

                # 3. Check watchpoints ONLY when data has changed (not every 10s)
                if self._data_changed:
                    self._data_changed = False
                    triggered = self._check_watchpoints()
                    for wp in triggered:
                        self._wake_for_watchpoint(wp)

                # 3b. Market scanner anomaly detection (runs after each data refresh)
                if self._scanner:
                    try:
                        # Update position awareness before detection
                        self._scanner.position_symbols = set(self._prev_positions.keys())
                        self._scanner.position_directions = {
                            sym: pos.get("side", "long")
                            for sym, pos in self._prev_positions.items()
                        }
                        anomalies = self._scanner.detect()
                        if anomalies:
                            self._wake_for_scanner(anomalies)
                    except Exception as e:
                        logger.debug("Scanner detect failed: %s", e)

                # 4. Curiosity check (default every 15 min)
                if now - self._last_curiosity_check >= self.config.daemon.curiosity_check_interval:
                    self._last_curiosity_check = now
                    self._check_curiosity()

                # 5. Periodic review (1h weekdays, 2h weekends)
                review_interval = self.config.daemon.periodic_interval
                if datetime.now(timezone.utc).weekday() >= 5:  # Sat=5, Sun=6
                    review_interval *= 2
                if now - self._last_review >= review_interval:
                    self._last_review = now
                    self._wake_for_review()

                # 6. FSRS batch decay (default every 6 hours)
                if now - self._last_decay_cycle >= self.config.daemon.decay_interval:
                    self._last_decay_cycle = now
                    self._run_decay_cycle()

                # 7. Contradiction queue check (default every 30 min)
                if now - self._last_conflict_check >= self.config.daemon.conflict_check_interval:
                    self._last_conflict_check = now
                    self._check_conflicts()

                # 7b. Phantom evaluation (default every 30 min)
                if self._phantoms and now - self._last_phantom_check >= self.config.daemon.phantom_check_interval:
                    self._last_phantom_check = now
                    self._evaluate_phantoms()

                # 8. Nous health check (default every 1 hour)
                if now - self._last_health_check >= self.config.daemon.health_check_interval:
                    self._last_health_check = now
                    self._check_health()

                # 9. Embedding backfill (default every 12 hours)
                if now - self._last_embedding_backfill >= self.config.daemon.embedding_backfill_interval:
                    self._last_embedding_backfill = now
                    self._run_embedding_backfill()

            except Exception as e:
                log_event(DaemonEvent("error", "Loop error", str(e)))
                logger.error("Daemon loop error: %s", e)

            # Sleep between checks — 10s granularity
            time.sleep(10)

    # ================================================================
    # Tier 1: Data Polling (Zero Tokens)
    # ================================================================

    def _poll_prices(self):
        """Fetch current prices from Hyperliquid. Zero tokens."""
        try:
            provider = self._get_provider()
            all_prices = provider.get_all_prices()

            for sym in self.config.execution.symbols:
                if sym in all_prices:
                    self.snapshot.prices[sym] = all_prices[sym]

            # Feed scanner with ALL prices (not just tracked symbols)
            if self._scanner:
                self._scanner.ingest_prices(all_prices)

            # L2 orderbooks + 5m candles for micro trading (tracked symbols only)
            if self._scanner and self.config.scanner.book_poll_enabled:
                tracked = set(self.config.execution.symbols) | set(self._prev_positions.keys())

                # L2 orderbooks (1 call per symbol)
                books = {}
                for sym in tracked:
                    try:
                        book = provider.get_l2_book(sym)
                        if book:
                            books[sym] = book
                    except Exception as e:
                        logger.debug("L2 book fetch failed for %s: %s", sym, e)
                if books:
                    self._scanner.ingest_orderbooks(books)

                # 5m candles, last 1h (1 call per symbol)
                now_ms = int(time.time() * 1000)
                candles = {}
                for sym in tracked:
                    try:
                        c = provider.get_candles(sym, "5m", now_ms - 3600_000, now_ms)
                        if c and len(c) > 1:
                            candles[sym] = c[:-1]  # Drop forming candle
                    except Exception as e:
                        logger.debug("5m candle fetch failed for %s: %s", sym, e)
                if candles:
                    self._scanner.ingest_candles(candles)

            self.snapshot.last_price_poll = time.time()
            self._data_changed = True
            self.polls += 1

            # Quick phantom evaluation on fresh prices (faster resolution)
            if self._phantoms:
                self._evaluate_phantoms()
                self._last_phantom_check = time.time()
        except Exception as e:
            logger.debug("Price poll failed: %s", e)

    def _poll_derivatives(self):
        """Fetch funding, OI from Hyperliquid + fear/greed from Coinglass. Zero tokens."""
        # Hyperliquid: funding + OI + volume — single API call for all symbols
        try:
            provider = self._get_provider()
            contexts = provider.get_multi_asset_contexts(self.config.execution.symbols)

            for sym, ctx in contexts.items():
                self.snapshot.funding[sym] = ctx["funding"]
                self.snapshot.prev_day_price[sym] = ctx.get("prev_day_price", 0)
                price = self.snapshot.prices.get(sym, 0)
                self.snapshot.oi_usd[sym] = ctx["open_interest"] * price if price else 0
                self.snapshot.volume_usd[sym] = ctx["day_volume"]
        except Exception as e:
            logger.debug("HL derivatives poll failed: %s", e)

        # Coinglass: fear & greed
        try:
            from ..data.providers.coinglass import get_provider as cg_get
            cg = cg_get()
            fg_data = cg.get_fear_greed()
            if fg_data and isinstance(fg_data, dict):
                data_list = fg_data.get("data_list", fg_data.get("dataList", []))
                if data_list:
                    self.snapshot.fear_greed = int(float(data_list[-1]))
        except Exception as e:
            logger.debug("Coinglass poll failed: %s", e)

        # Feed scanner: all asset contexts (single API call, already cached)
        if self._scanner:
            try:
                provider = self._get_provider()
                all_contexts = provider.get_all_asset_contexts()
                self._scanner.ingest_derivatives(all_contexts)
            except Exception as e:
                logger.debug("Scanner deriv ingest failed: %s", e)

            # Feed scanner: liquidation data from Coinglass
            try:
                from ..data.providers.coinglass import get_provider as cg_get
                cg = cg_get()
                liq_data = cg.get_liquidation_coins()
                if liq_data:
                    self._scanner.ingest_liquidations(liq_data)
            except Exception as e:
                logger.debug("Scanner liq ingest failed: %s", e)

            # Feed scanner: news from CryptoCompare
            if self.config.scanner.news_poll_enabled:
                self._poll_news()

        # Refresh trigger orders cache for fill classification
        self._refresh_trigger_cache()

        # Pre-fetch deep data for briefing (position assets + BTC always)
        try:
            position_symbols = list(self._prev_positions.keys())
            brief_targets = list(set(position_symbols) | {"BTC"})
            self._data_cache.poll(self._get_provider(), brief_targets)
        except Exception as e:
            logger.debug("DataCache poll failed: %s", e)

        # Record equity snapshot (every deriv poll = ~5 min)
        try:
            from ..core.equity_tracker import record_snapshot
            provider = self._get_provider()
            if provider.can_trade:
                state = provider.get_user_state()
                record_snapshot(
                    account_value=state["account_value"],
                    unrealized_pnl=state["unrealized_pnl"],
                    daily_realized_pnl=self._daily_realized_pnl,
                    position_count=len(state.get("positions", [])),
                )
        except Exception as e:
            logger.debug("Equity snapshot failed: %s", e)

        # Compute regime classification (zero cost, uses cached data)
        try:
            from .regime import RegimeClassifier
            classifier = RegimeClassifier()
            self._regime = classifier.compute(
                self.snapshot, self._data_cache, self._scanner,
            )
            # Track label changes for scanner shift detection
            new_label = self._regime.label
            if self._prev_regime_label and new_label != self._prev_regime_label:
                logger.info("Regime shift: %s -> %s (score %.2f)",
                            self._prev_regime_label, new_label, self._regime.score)
                # Feed regime shift to scanner for anomaly detection
                if self._scanner:
                    self._scanner.regime_shifted(self._prev_regime_label, new_label, self._regime.score)
            self._prev_regime_label = new_label
        except Exception as e:
            logger.debug("Regime computation failed: %s", e)

        self.snapshot.last_deriv_poll = time.time()
        self._data_changed = True
        self.polls += 1

    # ================================================================
    # Watchpoint System
    # ================================================================

    def _check_watchpoints(self) -> list[dict]:
        """Query Nous for active watchpoints and evaluate triggers.

        Returns list of triggered watchpoint dicts with keys:
            node, data (parsed JSON body), trigger
        """
        if not self.snapshot.prices:
            return []  # No data yet

        triggered = []
        try:
            nous = self._get_nous()

            # List all active watchpoints
            watchpoints = nous.list_nodes(
                subtype="custom:watchpoint",
                lifecycle="ACTIVE",
                limit=50,
            )

            self._active_watchpoint_count = len(watchpoints)

            # Also cache thesis count (zero extra calls during this check)
            try:
                theses = nous.list_nodes(
                    subtype="custom:thesis", lifecycle="ACTIVE", limit=50,
                )
                self._active_thesis_count = len(theses)
            except Exception:
                pass

            for wp in watchpoints:
                body = wp.get("content_body", "")
                if not body:
                    continue

                try:
                    data = json.loads(body)
                except (json.JSONDecodeError, TypeError):
                    continue

                trigger = data.get("trigger")
                if not trigger:
                    continue

                # Check expiry
                expiry = trigger.get("expiry")
                if expiry:
                    try:
                        exp_dt = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
                        if exp_dt < datetime.now(timezone.utc):
                            self._expire_watchpoint(nous, wp)
                            continue
                    except ValueError:
                        pass

                # Evaluate trigger condition
                if self._evaluate_trigger(trigger):
                    triggered.append({
                        "node": wp,
                        "data": data,
                        "trigger": trigger,
                    })
                    # Mark as fired to prevent re-triggering
                    self._fire_watchpoint(nous, wp)

        except Exception as e:
            logger.debug("Watchpoint check failed: %s", e)

        return triggered

    def _evaluate_trigger(self, trigger: dict) -> bool:
        """Evaluate a single trigger condition against the market snapshot."""
        condition = trigger.get("condition", "")
        symbol = trigger.get("symbol", "")
        value = trigger.get("value", 0)

        if not condition or not symbol:
            return False

        price = self.snapshot.prices.get(symbol)
        funding = self.snapshot.funding.get(symbol)

        if condition == "price_below":
            return price is not None and price <= value

        elif condition == "price_above":
            return price is not None and price >= value

        elif condition == "funding_above":
            return funding is not None and funding >= value

        elif condition == "funding_below":
            return funding is not None and funding <= value

        elif condition == "fear_greed_extreme":
            fg = self.snapshot.fear_greed
            # value is the threshold — fire if below value OR above (100 - value)
            return fg > 0 and (fg <= value or fg >= (100 - value))

        # Future: oi_change, liquidation_spike (need historical tracking)
        return False

    @staticmethod
    def _expire_watchpoint(nous, wp: dict):
        """Mark a watchpoint as expired."""
        try:
            nous.update_node(wp["id"], state_lifecycle="DORMANT")
            logger.info("Watchpoint expired: %s", wp.get("content_title", "?"))
        except Exception:
            pass

    @staticmethod
    def _fire_watchpoint(nous, wp: dict):
        """Mark a watchpoint as fired — DORMANT = permanently dead.

        The agent must create a new watchpoint if it wants to monitor again.
        """
        try:
            nous.update_node(wp["id"], state_lifecycle="DORMANT")
            logger.info("Watchpoint fired → DORMANT: %s", wp.get("content_title", "?"))
        except Exception:
            pass

    # ================================================================
    # Position Tracking & Fill Detection
    # ================================================================

    def _init_position_tracking(self):
        """Snapshot current positions on daemon start (no wake on existing)."""
        try:
            provider = self._get_provider()
            if not provider.can_trade:
                return

            state = provider.get_user_state()
            for p in state.get("positions", []):
                self._prev_positions[p["coin"]] = {
                    "side": p["side"],
                    "size": p["size"],
                    "entry_px": p["entry_px"],
                    "leverage": p.get("leverage", 20),
                }

            # Load persisted position types first (survives restarts)
            self._load_position_types()

            # Infer position types for any remaining unregistered positions
            for coin, data in self._prev_positions.items():
                if coin not in self._position_types:
                    lev = data.get("leverage", 20)
                    self._position_types[coin] = {
                        "type": "micro" if lev >= 15 else "macro",
                        "entry_time": 0,  # Unknown — daemon just started
                    }

            # Initial trigger cache
            self._refresh_trigger_cache()
            logger.info("Position tracking initialized: %d position(s)",
                         len(self._prev_positions))
        except Exception as e:
            logger.debug("Position tracking init failed: %s", e)

    def _refresh_trigger_cache(self):
        """Cache current trigger orders for fill classification."""
        try:
            provider = self._get_provider()
            if not provider.can_trade:
                return

            triggers = provider.get_trigger_orders()
            self._tracked_triggers.clear()
            for t in triggers:
                coin = t["coin"]
                if coin not in self._tracked_triggers:
                    self._tracked_triggers[coin] = []
                self._tracked_triggers[coin].append(t)
        except Exception as e:
            logger.debug("Trigger cache refresh failed: %s", e)

    def _fast_trigger_check(self):
        """Check SL/TP triggers every loop iteration (~10s) with fresh prices.

        The full price poll runs every 60s for ~200 symbols (feeds scanner).
        But SL/TP triggers on open positions need faster checking — a trade
        can hit TP and reverse within 60s, causing missed exits.

        This fetches fresh prices ONLY for position symbols (1 API call)
        and runs check_triggers + peak ROE tracking on every loop.
        """
        provider = self._get_provider()
        if not hasattr(provider, "check_triggers") or not self._prev_positions:
            return

        try:
            # Fetch fresh prices only for symbols with open positions
            position_syms = list(self._prev_positions.keys())
            fresh_prices = {}
            all_mids = provider.get_all_prices()
            for sym in position_syms:
                if sym in all_mids:
                    fresh_prices[sym] = all_mids[sym]
                    # Also update snapshot so briefing/scanner see latest
                    self.snapshot.prices[sym] = all_mids[sym]

            if not fresh_prices:
                return

            # Check SL/TP/liquidation triggers with fresh prices
            events = provider.check_triggers(fresh_prices)
            for event in events:
                self._update_daily_pnl(event["realized_pnl"])
                self._record_trigger_close(event)
                self._wake_for_fill(
                    event["coin"], event["side"], event["entry_px"],
                    event["exit_px"], event["realized_pnl"],
                    event["classification"],
                )

            if events:
                for event in events:
                    self._position_types.pop(event["coin"], None)
                self._persist_position_types()
                state = provider.get_user_state()
                positions = state.get("positions", [])
                self._prev_positions = {
                    p["coin"]: {"side": p["side"], "size": p["size"], "entry_px": p["entry_px"], "leverage": p.get("leverage", 20)}
                    for p in positions
                }

            # Track peak ROE on every check (not just every 60s)
            for sym in position_syms:
                px = fresh_prices.get(sym)
                if not px:
                    continue
                pos = self._prev_positions.get(sym)
                if not pos:
                    continue
                entry_px = pos.get("entry_px", 0)
                leverage = pos.get("leverage", 20)
                if entry_px <= 0:
                    continue
                side = pos.get("side", "long")
                if side == "long":
                    price_pct = (px - entry_px) / entry_px * 100
                else:
                    price_pct = (entry_px - px) / entry_px * 100
                roe_pct = price_pct * leverage
                if roe_pct > self._peak_roe.get(sym, 0):
                    self._peak_roe[sym] = roe_pct

        except Exception as e:
            logger.debug("Fast trigger check failed: %s", e)

    def _check_positions(self) -> list[dict] | None:
        """Compare current positions to cached snapshot. Detect closes.

        Returns the raw positions list from get_user_state() so callers
        (_check_profit_levels) can reuse it without a second API call.
        """
        try:
            provider = self._get_provider()
            if not provider.can_trade:
                return None

            # Paper mode: check SL/TP/liquidation triggers internally
            if hasattr(provider, "check_triggers") and self.snapshot.prices:
                events = provider.check_triggers(self.snapshot.prices)
                for event in events:
                    self._update_daily_pnl(event["realized_pnl"])
                    self._record_trigger_close(event)
                    self._wake_for_fill(
                        event["coin"], event["side"], event["entry_px"],
                        event["exit_px"], event["realized_pnl"],
                        event["classification"],
                    )
                # Refresh cached positions after any closes
                if events:
                    # Clean up position types for closed positions (after wake_for_fill used them)
                    for event in events:
                        self._position_types.pop(event["coin"], None)
                    self._persist_position_types()
                    state = provider.get_user_state()
                    positions = state.get("positions", [])
                    self._prev_positions = {
                        p["coin"]: {"side": p["side"], "size": p["size"], "entry_px": p["entry_px"], "leverage": p.get("leverage", 20)}
                        for p in positions
                    }
                    return positions

            # Testnet/live flow: detect closes by comparing snapshots
            state = provider.get_user_state()
            positions = state.get("positions", [])
            current = {}
            for p in positions:
                current[p["coin"]] = {
                    "side": p["side"],
                    "size": p["size"],
                    "entry_px": p["entry_px"],
                    "leverage": p.get("leverage", 20),
                }

            # Detect closed positions: was in _prev but not in current
            closed_coins = []
            for coin, prev_data in self._prev_positions.items():
                if coin not in current:
                    # Position closed — find the fill details
                    self._handle_position_close(provider, coin, prev_data)
                    closed_coins.append(coin)

            # Clean up position types for closed positions (after wake_for_fill used them)
            for coin in closed_coins:
                self._position_types.pop(coin, None)
            if closed_coins:
                self._persist_position_types()

            # Update snapshot
            self._prev_positions = current
            return positions

        except Exception as e:
            logger.debug("Position check failed: %s", e)
            return None

    def _handle_position_close(self, provider, coin: str, prev_data: dict):
        """Handle a detected position close — find fills, classify, wake agent."""
        side = prev_data["side"]
        entry_px = prev_data["entry_px"]

        # Look up recent fills to get exit price and PnL
        # Use _last_fill_check as lookback start (not wall clock) — handles daemon delays
        try:
            start_ms = int(max(self._last_fill_check - 60, 0) * 1000)  # 60s buffer
            fills = provider.get_user_fills(start_ms)

            # Find the closing fill for this coin
            close_fill = None
            for f in reversed(fills):  # newest first
                if f["coin"] == coin and f["direction"].startswith("Close"):
                    close_fill = f
                    break

            # Dedup: skip if we already processed this fill
            if close_fill:
                fill_hash = close_fill.get("hash", "")
                if fill_hash and fill_hash in self._processed_fills:
                    logger.debug("Skipping already-processed fill: %s %s", coin, fill_hash)
                    return
                if fill_hash:
                    self._processed_fills.add(fill_hash)
                    # Cap set size
                    if len(self._processed_fills) > 100:
                        self._processed_fills = set(list(self._processed_fills)[-50:])

            if close_fill:
                exit_px = close_fill["price"]
                realized_pnl = close_fill["closed_pnl"]
            else:
                # No fill found — estimate from last known price
                exit_px = self.snapshot.prices.get(coin, 0)
                if side == "long":
                    realized_pnl = (exit_px - entry_px) * prev_data["size"]
                else:
                    realized_pnl = (entry_px - exit_px) * prev_data["size"]

        except Exception as e:
            logger.debug("Fill lookup failed for %s: %s", coin, e)
            exit_px = self.snapshot.prices.get(coin, 0)
            realized_pnl = 0
            close_fill = None

        # Refresh trigger cache for accurate classification
        # (triggers may have been placed since last deriv poll)
        self._refresh_trigger_cache()

        # Classify the exit
        triggers = self._tracked_triggers.get(coin, [])
        classification = self._classify_fill(coin, close_fill, triggers)

        # Update daily PnL for circuit breaker
        self._update_daily_pnl(realized_pnl)

        # Record to Nous (SL/TP auto-fills aren't written by agent)
        if classification in ("stop_loss", "take_profit", "liquidation"):
            self._record_trigger_close({
                "coin": coin, "side": side, "entry_px": entry_px,
                "exit_px": exit_px, "realized_pnl": realized_pnl,
                "classification": classification,
            })

        # Wake the agent with the appropriate message
        self._wake_for_fill(coin, side, entry_px, exit_px, realized_pnl, classification)

    def _record_trigger_close(self, event: dict):
        """Write a trade_close node to Nous when paper SL/TP/liquidation fires.

        This ensures auto-fills are persisted in memory just like manual closes.
        Reuses the same _store_to_nous / _find_trade_entry pattern from trading tools.
        """
        try:
            from .tools.trading import _store_to_nous, _find_trade_entry

            coin = event["coin"]
            side = event["side"]
            entry_px = event["entry_px"]
            exit_px = event["exit_px"]
            pnl = event["realized_pnl"]
            classification = event["classification"]  # stop_loss, take_profit, liquidation

            pnl_pct = ((exit_px - entry_px) / entry_px * 100) if entry_px else 0
            if side == "short":
                pnl_pct = -pnl_pct

            label = classification.replace("_", " ").title()
            sign = "+" if pnl >= 0 else ""
            title = f"CLOSED {side.upper()} {coin} @ ${exit_px:,.2f}"
            summary = (
                f"CLOSED {side.upper()} {coin} | ${entry_px:,.2f} → ${exit_px:,.2f} "
                f"| PnL {sign}${pnl:.4f} ({sign}{pnl_pct:.2f}%)"
            )
            content = (
                f"Closed full {side} {coin}.\n"
                f"Entry: ${entry_px:,.2f} → Exit: ${exit_px:,.2f}\n"
                f"PnL: {sign}${pnl:.4f} ({sign}{pnl_pct:.2f}%)\n"
                f"Reason: {label} triggered automatically."
            )
            # Get opened_at from position type registry (set on entry)
            type_info = self._position_types.get(coin, {})
            entry_time = type_info.get("entry_time", 0)
            opened_at = ""
            if entry_time > 0:
                from datetime import datetime, timezone
                opened_at = datetime.fromtimestamp(entry_time, tz=timezone.utc).isoformat()

            # Get peak ROE (MFE) and trade_type before they're cleaned up
            mfe_pct = self._peak_roe.get(coin, 0.0)
            trade_type = type_info.get("type", "macro")

            signals = {
                "action": "close",
                "side": side,
                "symbol": coin,
                "entry": entry_px,
                "exit": exit_px,
                "pnl_usd": round(pnl, 4),
                "pnl_pct": round(pnl_pct, 2),
                "close_type": classification,
                "opened_at": opened_at,
                "mfe_pct": round(mfe_pct, 2),
                "trade_type": trade_type,
            }

            # Find the matching entry node for edge linking
            entry_id = _find_trade_entry(coin)

            node_id = _store_to_nous(
                subtype="custom:trade_close",
                title=title,
                content=content,
                summary=summary,
                signals=signals,
                link_to=entry_id,
            )
            if node_id:
                logger.info("Recorded %s close for %s in Nous: %s", classification, coin, node_id)
            else:
                logger.warning("Failed to record %s close for %s in Nous", classification, coin)
        except Exception as e:
            logger.error("_record_trigger_close failed for %s: %s", event.get("coin", "?"), e)

    def _classify_fill(
        self, coin: str, fill: dict | None, triggers: list[dict],
    ) -> str:
        """Classify a position close as 'stop_loss', 'take_profit', or 'manual'.

        Priority:
        1. OID match — fill OID matches a trigger order OID (definitive)
        2. Price match — fill price within 1.5% of SL/TP trigger price
        3. Fallback — 'manual'
        """
        if not fill or not triggers:
            return "manual"

        fill_oid = fill.get("oid")
        fill_px = fill.get("price", 0)

        # 1. Direct OID match
        if fill_oid:
            for t in triggers:
                if t.get("oid") == fill_oid:
                    return t.get("order_type", "manual").replace("_", "_")

        # 2. Price proximity match (1.5% tolerance for slippage)
        if fill_px > 0:
            for t in triggers:
                trigger_px = t.get("trigger_px")
                if not trigger_px or trigger_px <= 0:
                    continue
                pct_diff = abs(fill_px - trigger_px) / trigger_px
                if pct_diff <= 0.015:
                    return t.get("order_type", "manual")

        return "manual"

    # ================================================================
    # Profit Level Monitoring
    # ================================================================

    @staticmethod
    def _alert_cooldown(trade_type: str) -> int:
        """Cooldown between repeated profit alerts for same position+tier.

        Scalps are short-lived — need faster re-alerts.
        Swings are patient — longer gaps are fine.
        """
        if trade_type == "micro":
            return 300   # 5 min — micros live 3-15 min, need fast re-alerts
        return 2700      # 45 min

    @staticmethod
    def _profit_thresholds(leverage: int) -> tuple[float, float, float, float]:
        """Get profit alert thresholds scaled by leverage.

        Two regimes to keep price-move thresholds sensible:
        - High leverage (>=15x, scalp): tight ROE thresholds (7/10/15/-7)
        - Low leverage (<15x, swing): wider ROE thresholds (20/35/50/-15)

        Price-move equivalents:
          Scalp 20x: nudge 0.35%, take 0.5%, urgent 0.75%
          Swing 10x: nudge 2%, take 3.5%, urgent 5%
          Swing  5x: nudge 4%, take 7%, urgent 10%
        """
        if leverage >= 15:
            return (7.0, 10.0, 15.0, -7.0)
        return (20.0, 35.0, 50.0, -15.0)

    def _check_profit_levels(self, positions: list[dict] | None = None):
        """Check unrealized P&L on open positions and wake agent at thresholds.

        Uses live return_pct from provider — no manual ROE computation needed.
        Thresholds scale with leverage: high lev = scalp (tight), low lev = swing (wide).

        Args:
            positions: Raw positions list from _check_positions(). If None,
                       skips this cycle (avoids redundant API call).
        """
        if not positions:
            return

        try:
            now = time.time()

            for p in positions:
                coin = p["coin"]
                side = p["side"]
                entry_px = p["entry_px"]
                mark_px = p["mark_px"]
                roe_pct = p["return_pct"]  # Already leveraged return on margin
                leverage = p.get("leverage", 20)

                # Track peak ROE for MFE (max favorable excursion)
                if roe_pct > self._peak_roe.get(coin, 0):
                    self._peak_roe[coin] = roe_pct

                # Reset alerts if position side flipped (close long → open short)
                prev_side = self._profit_sides.get(coin)
                if prev_side and prev_side != side:
                    self._profit_alerts.pop(coin, None)
                self._profit_sides[coin] = side

                if coin not in self._profit_alerts:
                    self._profit_alerts[coin] = {}
                alerts = self._profit_alerts[coin]

                # Look up trade type for this position
                type_info = self.get_position_type(coin)
                trade_type = type_info["type"]

                # Leverage-aware thresholds
                nudge, take, urgent, risk = self._profit_thresholds(leverage)

                # Check profit tiers (highest first for priority)
                if roe_pct >= urgent:
                    self._maybe_alert(coin, "urgent_profit", roe_pct, side, entry_px, mark_px, now, alerts, trade_type)
                elif roe_pct >= take:
                    self._maybe_alert(coin, "take_profit", roe_pct, side, entry_px, mark_px, now, alerts, trade_type)
                elif roe_pct >= nudge:
                    self._maybe_alert(coin, "profit_nudge", roe_pct, side, entry_px, mark_px, now, alerts, trade_type)

                # Check profit fading: peak was strong but profit is dying
                peak = self._peak_roe.get(coin, 0)
                if peak >= nudge and roe_pct < peak * 0.4:
                    self._maybe_alert(coin, "profit_fading", roe_pct, side, entry_px, mark_px, now, alerts, trade_type)

                # Check risk: significant loss with no stop loss
                if roe_pct <= risk:
                    triggers = self._tracked_triggers.get(coin, [])
                    has_sl = any(t.get("order_type") == "stop_loss" for t in triggers)
                    if not has_sl:
                        self._maybe_alert(coin, "risk_no_sl", roe_pct, side, entry_px, mark_px, now, alerts, trade_type)

                # Check micro overstay (>60 min)
                if trade_type == "micro" and type_info["entry_time"] > 0:
                    if now - type_info["entry_time"] > 3600:
                        self._maybe_alert(coin, "micro_overstay", roe_pct, side, entry_px, mark_px, now, alerts, "micro")

            # Clean up alerts + sides + peak ROE for closed positions
            open_coins = {p["coin"] for p in positions}
            for coin in list(self._profit_alerts.keys()):
                if coin not in open_coins:
                    del self._profit_alerts[coin]
                    self._profit_sides.pop(coin, None)
            for coin in list(self._peak_roe):
                if coin not in open_coins:
                    del self._peak_roe[coin]

        except Exception as e:
            logger.debug("Profit level check failed: %s", e)

    def _maybe_alert(
        self, coin: str, tier: str, roe_pct: float,
        side: str, entry_px: float, mark_px: float,
        now: float, alerts: dict, trade_type: str = "macro",
    ):
        """Fire profit alert if not on cooldown."""
        last = alerts.get(tier, 0)
        cooldown = self._alert_cooldown(trade_type)
        if now - last < cooldown:
            return
        alerts[tier] = now
        self._wake_for_profit(coin, side, entry_px, mark_px, roe_pct, tier, trade_type)

    def _wake_for_profit(
        self, coin: str, side: str, entry_px: float,
        mark_px: float, roe_pct: float, tier: str,
        trade_type: str = "macro",
    ):
        """Wake the agent with a profit/risk alert. Adapts tone to trade type."""
        type_info = self.get_position_type(coin)
        leverage = self._prev_positions.get(coin, {}).get("leverage", 20)
        is_scalp = trade_type == "micro"
        type_label = f"scalp {leverage}x" if is_scalp else f"swing {leverage}x"

        # Hold duration (if known)
        hold_str = ""
        hold_mins = 0
        if type_info["entry_time"] > 0:
            hold_mins = max(0, int((time.time() - type_info["entry_time"]) / 60))
            if hold_mins < 60:
                hold_str = f" | Held: {hold_mins}m"
            else:
                hold_str = f" | Held: {hold_mins // 60}h{hold_mins % 60}m"

        pnl_line = (
            f"{coin} {side.upper()} ({type_label})"
            f" | Entry: ${entry_px:,.0f} → Mark: ${mark_px:,.0f}"
            f" | ROE: {roe_pct:+.1f}%{hold_str}"
        )

        if tier == "micro_overstay":
            overstay_mins = hold_mins or 60
            header = f"[DAEMON WAKE — Micro Overstay: {coin} {side.upper()} {overstay_mins}m]"
            footer = (
                f"This scalp has been open {overstay_mins} minutes — micro trades should be 15-60 min. "
                f"You're at {roe_pct:+.1f}% ROE. Close it, or if your thesis evolved, acknowledge it's now a swing."
            )
            priority = False
        elif tier == "urgent_profit":
            header = f"[DAEMON WAKE — TAKE PROFIT: {coin} {side.upper()} +{roe_pct:.0f}%]"
            if is_scalp:
                footer = f"This scalp is up {roe_pct:+.0f}%. That's a clean win — close it and move on."
            else:
                footer = f"Swing up {roe_pct:+.0f}% — your thesis played out. Take profit or give a clear reason to hold."
            priority = True
        elif tier == "take_profit":
            header = f"[DAEMON WAKE — Profit Alert: {coin} {side.upper()} +{roe_pct:.0f}%]"
            if is_scalp:
                footer = f"Scalp up {roe_pct:+.0f}%. Lock in the gain — don't let a quick win turn into a hold."
            else:
                footer = f"Swing position up {roe_pct:+.0f}%. Consider taking some off the table or trail your stop."
            priority = True
        elif tier == "profit_nudge":
            header = f"[DAEMON WAKE — {coin} {side.upper()} +{roe_pct:.0f}%]"
            if is_scalp:
                footer = f"Scalp up {roe_pct:+.0f}%. CLOSE THIS TRADE NOW. This is peak micro profit — take it before it reverses."
            else:
                footer = f"Swing building nicely at +{roe_pct:.0f}%. Trail your stop to lock in the move."
            priority = False
        elif tier == "profit_fading":
            peak = self._peak_roe.get(coin, 0)
            header = f"[DAEMON WAKE — PROFIT FADING: {coin} {side.upper()} peaked +{peak:.0f}% → now {roe_pct:+.0f}%]"
            if is_scalp:
                footer = (
                    f"Scalp peaked at +{peak:.0f}% ROE but now at {roe_pct:+.0f}%. "
                    f"Your profit is dying. CLOSE NOW or you lose it all."
                )
            else:
                footer = (
                    f"Swing peaked at +{peak:.0f}% ROE but dropped to {roe_pct:+.0f}%. "
                    f"Profit is fading fast. Take what's left or tighten your stop."
                )
            priority = True
        elif tier == "risk_no_sl":
            header = f"[DAEMON WAKE — RISK: {coin} {side.upper()} {roe_pct:+.0f}%]"
            if is_scalp:
                footer = f"Scalp down {roe_pct:+.0f}% with no SL. Close or set a tight stop immediately."
            else:
                footer = f"Swing down {roe_pct:+.0f}% with no stop loss. Your thesis needs a line in the sand — set one."
            priority = True
        else:
            return

        message = f"{header}\n\n{pnl_line}\n\n{footer}"
        response = self._wake_agent(message, priority=priority, max_coach_cycles=0, max_tokens=1024, source="daemon:profit")
        if response:
            log_event(DaemonEvent(
                "profit", f"{tier}: {coin} {side}",
                f"ROE {roe_pct:+.1f}% ({type_label}) | Entry ${entry_px:,.0f} → ${mark_px:,.0f}",
            ))
            _queue_and_persist("Profit", f"{tier.replace('_', ' ').title()}: {coin}", response)
            _notify_discord("Profit", f"{tier.replace('_', ' ').title()}: {coin}", response)
            logger.info("Profit alert: %s %s %s (ROE %+.1f%%, %s)", tier, coin, side, roe_pct, trade_type)

    # ================================================================
    # News Polling
    # ================================================================

    def _poll_news(self):
        """Fetch crypto news from CryptoCompare and feed to scanner. Zero tokens."""
        try:
            from ..data.providers.cryptocompare import get_provider as cc_get
            cc = cc_get()
            # Fetch news for tracked + position symbols
            symbols = list(set(self.config.execution.symbols) | set(self._prev_positions.keys()))
            articles = cc.get_news(categories=symbols, limit=30)
            if articles and self._scanner:
                self._scanner.ingest_news(articles)
        except Exception as e:
            logger.debug("News poll failed: %s", e)

    # ================================================================
    # Risk Guardrails (Circuit Breaker)
    # ================================================================

    def _check_daily_reset(self):
        """Reset daily PnL counters at UTC midnight."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if self._daily_reset_date != today:
            if self._daily_reset_date and self._trading_paused:
                log_event(DaemonEvent(
                    "circuit_breaker", "Circuit breaker reset",
                    f"New day ({today}). Daily PnL reset from ${self._daily_realized_pnl:+.2f}.",
                ))
                logger.info("Circuit breaker reset — new day %s", today)
            self._daily_realized_pnl = 0.0
            self._trading_paused = False
            self._entries_today = 0
            self._micro_entries_today = 0
            # Weekly reset on Monday
            if datetime.now(timezone.utc).weekday() == 0:
                self._entries_this_week = 0
            self._daily_reset_date = today
            self._persist_daily_pnl()

    def _update_daily_pnl(self, realized_pnl: float):
        """Update daily PnL and check circuit breaker threshold."""
        self._check_daily_reset()
        self._daily_realized_pnl += realized_pnl
        self._last_close_time = time.time()

        max_loss = self.config.daemon.max_daily_loss_usd
        if max_loss > 0 and self._daily_realized_pnl <= -max_loss and not self._trading_paused:
            self._trading_paused = True
            log_event(DaemonEvent(
                "circuit_breaker", "Trading paused",
                f"Daily loss ${self._daily_realized_pnl:+.2f} exceeds "
                f"-${max_loss:.0f} limit. Paused until UTC midnight.",
            ))
            logger.warning("CIRCUIT BREAKER: Daily loss $%.2f exceeds limit $%.0f",
                            abs(self._daily_realized_pnl), max_loss)
        self._persist_daily_pnl()

    # ================================================================
    # Wake Messages
    # ================================================================

    def _wake_for_watchpoint(self, wp_data: dict):
        """Assemble context and wake the agent for a triggered watchpoint."""
        node = wp_data["node"]
        data = wp_data["data"]
        trigger = wp_data["trigger"]

        title = node.get("content_title", "Untitled watchpoint")
        content = data.get("text", "")
        signals = data.get("signals_at_creation", {})
        symbol = trigger.get("symbol", "?")
        condition = trigger.get("condition", "?")
        value = trigger.get("value", 0)

        # Current data
        current_price = self.snapshot.prices.get(symbol, 0)
        current_funding = self.snapshot.funding.get(symbol, 0)

        lines = [
            f"[DAEMON WAKE — Watchpoint Triggered: {title}]",
            "",
            f"Your alert fired: {symbol} {condition.replace('_', ' ')} {value}.",
            f"Current: ${current_price:,.0f} | Funding: {current_funding:.4%} | F&G: {self.snapshot.fear_greed}",
            "",
            "What you were thinking when you set this:",
            content,
        ]

        if signals:
            lines.append("")
            lines.append("Market conditions when you set this alert:")
            for k, v in signals.items():
                lines.append(f"  {k}: {v}")

        lines.extend([
            "",
            "This alert is now DEAD. Decide: act on it, or set a new one. Keep your response to 1-3 sentences.",
        ])

        message = "\n".join(lines)
        response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1024, source="daemon:watchpoint")
        if response:
            self.watchpoint_fires += 1
            log_event(DaemonEvent(
                "watchpoint", title,
                f"{symbol} {condition.replace('_', ' ')} {value} | F&G: {self.snapshot.fear_greed}",
            ))
            _queue_and_persist("Watchpoint", title, response)
            _notify_discord("Watchpoint", title, response)
            logger.info("Watchpoint wake complete: %s (%d chars)", title, len(response))

    def _build_historical_context(self, anomalies: list) -> str:
        """Build a [Track Record] block for scanner wakes.

        Action-oriented framing: when phantoms outperform real trades,
        pushes the agent to ACT rather than reinforcing fear of past losses.
        """
        lines = []
        symbols = {a.symbol for a in anomalies if a.symbol != "MARKET"}
        anomaly_types = {a.type for a in anomalies}

        # Phantom stats
        total_resolved = self._phantom_stats["missed"] + self._phantom_stats["good_pass"]
        phantom_winrate = (self._phantom_stats["missed"] / total_resolved * 100) if total_resolved >= 3 else 0

        # Real trade stats
        real_winrate = 0
        real_total = 0
        try:
            from ..core.trade_analytics import get_trade_stats
            stats = get_trade_stats()
            real_winrate = stats.win_rate
            real_total = stats.total_trades
        except Exception:
            pass

        # Detect paralysis: phantom winrate significantly beats real, or long pass streak
        is_paralyzed = (
            (phantom_winrate > 40 and total_resolved >= 5) or
            self._scanner_pass_streak >= 5
        )

        if is_paralyzed:
            # Action-oriented framing — break the fear loop
            if phantom_winrate > 0 and total_resolved >= 5:
                lines.append(
                    f"[PARALYSIS CHECK] Your phantom tracker shows {phantom_winrate:.0f}% winrate on "
                    f"{total_resolved} setups you PASSED on. That's real money left on the table."
                )
            if self._scanner_pass_streak >= 5:
                lines.append(
                    f"You've passed {self._scanner_pass_streak} scanner wakes in a row. "
                    f"Caution has become paralysis. Take the next setup with 1.5:1+ R:R at Speculative size."
                )
            if real_total > 0 and phantom_winrate > real_winrate:
                lines.append(
                    f"Your filters are COSTING you — phantoms ({phantom_winrate:.0f}% win) outperform "
                    f"your actual trades ({real_winrate:.0f}% win). The lesson: you pass on too many, not too few."
                )
        else:
            # Normal track record — brief, not fear-inducing
            if total_resolved >= 3:
                lines.append(
                    f"Phantom tracker: {self._phantom_stats['missed']} missed winners, "
                    f"{self._phantom_stats['good_pass']} good passes ({phantom_winrate:.0f}% miss rate)"
                )

            # Per-symbol phantom data (brief)
            if self._phantom_results:
                for sym in symbols:
                    sym_phantoms = [p for p in self._phantom_results if p.get("symbol") == sym]
                    if sym_phantoms:
                        missed = sum(1 for p in sym_phantoms if p.get("result") == "missed")
                        good = sum(1 for p in sym_phantoms if p.get("result") == "good_pass")
                        if missed > good:
                            lines.append(f"{sym} phantoms: {missed} missed vs {good} good pass — you're over-filtering {sym}")
                        elif sym_phantoms:
                            lines.append(f"{sym} phantoms: {missed} missed, {good} good pass")

            if self._scanner_pass_streak >= 3:
                lines.append(f"Pass streak: {self._scanner_pass_streak} consecutive — consider loosening filters")

        if not lines:
            return ""
        return "[Track Record]\n" + "\n".join(lines)

    def _wake_for_scanner(self, anomalies: list):
        """Wake the agent when the market scanner detects anomalies.

        Filters by wake threshold, formats message, respects rate limits.
        Non-priority wake (shares cooldown with other wakes).
        """
        from .scanner import format_scanner_wake

        cfg = self.config.scanner
        # Filter to anomalies above wake threshold
        wake_worthy = [a for a in anomalies if a.severity >= cfg.wake_threshold]
        if not wake_worthy:
            return

        # Cap to max anomalies per wake
        top = wake_worthy[:cfg.max_anomalies_per_wake]

        # Format the wake message (pass position types + regime for directional context)
        regime_label = self._regime.label if self._regime else "NEUTRAL"
        message = format_scanner_wake(top, position_types=self._position_types, regime_label=regime_label)

        # Inject regime context above the scanner message
        if self._regime and self._regime.label != "NEUTRAL":
            from .regime import format_regime_line
            regime_line = format_regime_line(self._regime, compact=True)
            message = f"[{regime_line}]\n\n" + message

        # Inject historical context above the scanner message
        track_record = self._build_historical_context(top)
        if track_record:
            message = track_record + "\n\n" + message

        response = self._wake_agent(
            message, max_coach_cycles=0, max_tokens=768,
            source="daemon:scanner",
        )
        if response:
            self.scanner_wakes += 1
            self._scanner.wakes_triggered += 1
            top_event = top[0]
            title = top_event.headline

            # Track pass streak + phantom creation
            if self.agent.last_chat_had_trade_tool():
                self._scanner_pass_streak = 0
            else:
                self._scanner_pass_streak += 1
                # Phantom tracking: record what would have happened on this pass
                self._maybe_create_phantom(top_event, agent_response=response)

            log_event(DaemonEvent(
                "scanner", title,
                f"{len(top)} anomalies (top: {top_event.type} {top_event.symbol} sev={top_event.severity:.2f})",
            ))
            _queue_and_persist("Scanner", title, response, event_type="scanner")
            _notify_discord("Scanner", title, response)
            logger.info("Scanner wake: %d anomalies, agent responded (%d chars)",
                        len(top), len(response))

    def _wake_for_fill(
        self,
        coin: str,
        side: str,
        entry_px: float,
        exit_px: float,
        realized_pnl: float,
        classification: str,
    ):
        """Wake the agent when a position closes. Adapts tone to trade type + classification."""
        # Look up trade type BEFORE cleanup (still in registry at this point)
        type_info = self._position_types.get(coin, {"type": "macro", "entry_time": 0})
        trade_type = type_info["type"]
        is_scalp = trade_type == "micro"
        type_label = "Scalp" if is_scalp else "Swing"

        pnl_sign = "+" if realized_pnl >= 0 else ""
        pnl_pct = ((exit_px - entry_px) / entry_px * 100) if entry_px > 0 else 0
        if side == "short":
            pnl_pct = -pnl_pct

        # Hold duration
        hold_str = ""
        if type_info["entry_time"] > 0:
            hold_mins = max(0, int((time.time() - type_info["entry_time"]) / 60))
            if hold_mins < 60:
                hold_str = f" | Held: {hold_mins}m"
            else:
                hold_str = f" | Held: {hold_mins // 60}h{hold_mins % 60}m"

        pnl_line = (
            f"Entry: ${entry_px:,.0f} → Exit: ${exit_px:,.0f} | "
            f"PnL: {pnl_sign}${abs(realized_pnl):,.2f} ({pnl_pct:+.1f}%){hold_str}"
        )

        if classification == "stop_loss":
            header = f"[DAEMON WAKE — Stop Loss: {coin} {side.upper()} ({type_label})]"
            if is_scalp:
                footer = "Scalp stopped out. Quick review: was the entry timing right? Was the SL appropriate for the timeframe? One lesson, then move on."
            else:
                footer = "Stopped out of swing position. Recall your thesis — what invalidated it? Store a real lesson (what would you do differently?), archive the thesis, clean up watchpoints, and scan for what's next."
        elif classification == "take_profit":
            header = f"[DAEMON WAKE — Take Profit: {coin} {side.upper()} ({type_label})]"
            if is_scalp:
                footer = (
                    "Scalp TP hit — clean trade. REQUIRED: store a playbook (memory_type='playbook') with: "
                    "setup conditions, entry timing, risk params that worked, what's repeatable. "
                    f"Title: 'Playbook: {coin} <pattern_name>'"
                )
            else:
                footer = (
                    "Swing TP hit. REQUIRED: store a playbook (memory_type='playbook') with: "
                    "thesis and what confirmed it, entry signal, hold logic through drawdowns, "
                    "risk params that worked, what's repeatable. "
                    f"Title: 'Playbook: {coin} <pattern_name>'. "
                    "Then archive thesis, clean watchpoints, look for follow-up."
                )
        else:
            header = f"[DAEMON WAKE — Position Closed: {coin} {side.upper()} ({type_label})]"
            if realized_pnl >= 0:
                # Profitable close — extract the playbook
                if is_scalp:
                    footer = (
                        "Scalp closed in profit. Store a playbook (memory_type='playbook'): "
                        f"setup, timing, what worked. Title: 'Playbook: {coin} <pattern>'."
                    )
                else:
                    footer = (
                        "Swing closed in profit. Store a playbook (memory_type='playbook'): "
                        "thesis, entry signal, risk params, what worked. "
                        f"Title: 'Playbook: {coin} <pattern>'. Archive thesis, clean watchpoints."
                    )
            else:
                if is_scalp:
                    footer = "Scalp closed at a loss. Was the exit timing right? Store the lesson — specific to THIS setup, not a global rule."
                else:
                    footer = "Swing closed at a loss. Store why — what specifically went wrong with THIS setup? Clean up watchpoints, scan the market."

        lines = [header, "", pnl_line, "", footer]

        # Append circuit breaker warning if trading is paused
        if self._trading_paused:
            lines.extend([
                "",
                "[CIRCUIT BREAKER ACTIVE]",
                f"Daily loss has reached ${abs(self._daily_realized_pnl):,.2f}. "
                "Trading is paused until tomorrow UTC.",
                "Focus on analysis and learning, not new entries.",
            ])

        message = "\n".join(lines)
        fill_tokens = 1536 if classification in ("stop_loss", "take_profit") else 512
        response = self._wake_agent(message, priority=True, max_coach_cycles=0, max_tokens=fill_tokens, source="daemon:fill")
        if response:
            self._fill_fires += 1
            fill_title = f"{classification.replace('_', ' ').title()}: {coin} {side} ({type_label})"
            log_event(DaemonEvent(
                "fill", fill_title,
                f"Entry: ${entry_px:,.0f} → Exit: ${exit_px:,.0f} | "
                f"PnL: {pnl_sign}${abs(realized_pnl):,.2f} ({pnl_pct:+.1f}%)",
            ))
            _queue_and_persist("Fill", fill_title, response, event_type="fill")
            _notify_discord("Fill", fill_title, response)
            logger.info("Fill wake complete: %s %s %s %s (PnL: %s%.2f)",
                         classification, trade_type, coin, side, pnl_sign, abs(realized_pnl))

    # ================================================================
    # Phantom Tracker — Inaction Cost
    # ================================================================

    _PHANTOM_PARAMS_RE = re.compile(
        r'Conviction:\s*([\d.]+).*?\[SL\s*([\d.]+)%\s*TP\s*([\d.]+)%\]',
        re.IGNORECASE,
    )

    @staticmethod
    def _parse_phantom_params(response: str) -> dict | None:
        """Parse agent-informed SL/TP from scanner response suffix.

        Looks for: Conviction: 0.35 — too weak. [SL 1.5% TP 3%]
        Returns dict with conviction, sl_pct, tp_pct (as decimals) or None.
        """
        m = Daemon._PHANTOM_PARAMS_RE.search(response)
        if not m:
            return None
        try:
            conviction = float(m.group(1))
            sl_pct = float(m.group(2))
            tp_pct = float(m.group(3))
            if not (0.1 <= sl_pct <= 10.0 and 0.2 <= tp_pct <= 20.0 and 0 <= conviction <= 1):
                return None
            return {"conviction": conviction, "sl_pct": sl_pct / 100, "tp_pct": tp_pct / 100}
        except (ValueError, TypeError):
            return None

    def _maybe_create_phantom(self, top_event, agent_response: str = ""):
        """Create a phantom position when the agent passes on a scanner wake.

        Only tracks high-severity anomalies with inferable direction on liquid symbols.
        """
        from .scanner import infer_phantom_direction

        # Gate: severity >= 0.6, real symbol, liquid
        if top_event.severity < 0.6:
            return
        if top_event.symbol == "MARKET":
            return
        liquid = getattr(self._scanner, '_liquid_symbols', set()) if self._scanner else set()
        if liquid and top_event.symbol not in liquid:
            return

        direction = infer_phantom_direction(top_event)
        if not direction:
            return

        entry_price = self.snapshot.prices.get(top_event.symbol, 0)
        if entry_price <= 0:
            return

        is_micro = top_event.category == "micro"
        parsed = self._parse_phantom_params(agent_response) if agent_response else None

        if parsed:
            sl_pct = parsed["sl_pct"]
            tp_pct = parsed["tp_pct"]
            leverage = max(5, min(50, round(15 / (sl_pct * 100))))
            max_age = 7200 if is_micro else 14400
            logger.info("Phantom using agent params: SL %.1f%% TP %.1f%% → %dx",
                        sl_pct * 100, tp_pct * 100, leverage)
        else:
            if is_micro:
                sl_pct, tp_pct, leverage, max_age = 0.004, 0.008, 20, 7200
            else:
                sl_pct, tp_pct, leverage, max_age = 0.02, 0.03, 10, 14400

        if direction == "long":
            stop_loss = entry_price * (1 - sl_pct)
            take_profit = entry_price * (1 + tp_pct)
        else:
            stop_loss = entry_price * (1 + sl_pct)
            take_profit = entry_price * (1 - tp_pct)

        phantom = {
            "symbol": top_event.symbol,
            "side": direction,
            "entry_price": entry_price,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
            "leverage": leverage,
            "category": "micro" if is_micro else "macro",
            "created_at": time.time(),
            "expires_at": time.time() + max_age,
            "anomaly_type": top_event.type,
            "anomaly_headline": top_event.headline,
            "severity": top_event.severity,
            "agent_conviction": parsed["conviction"] if parsed else None,
            "agent_informed": parsed is not None,
        }
        self._phantoms.append(phantom)

        # Cap at 20 active phantoms
        if len(self._phantoms) > 20:
            self._phantoms = self._phantoms[-20:]

        self._persist_phantoms()
        logger.info("Phantom created: %s %s %s @ %.2f (SL %.2f / TP %.2f)",
                     direction, top_event.symbol, top_event.type,
                     entry_price, stop_loss, take_profit)

    def _evaluate_phantoms(self):
        """Evaluate all active phantoms against current prices. Zero LLM cost.

        Resolves as: TP hit (missed opportunity), SL hit (good pass), or expired (wash).
        """
        now = time.time()
        still_active = []

        for p in self._phantoms:
            sym = p["symbol"]
            price = self.snapshot.prices.get(sym, 0)
            if not price:
                still_active.append(p)
                continue

            result = None

            if p["side"] == "long":
                if price >= p["take_profit"]:
                    result = "missed_opportunity"
                elif price <= p["stop_loss"]:
                    result = "good_pass"
            else:
                if price <= p["take_profit"]:
                    result = "missed_opportunity"
                elif price >= p["stop_loss"]:
                    result = "good_pass"

            # Check expiry
            if result is None and now >= p["expires_at"]:
                result = "expired"

            if result is None:
                still_active.append(p)
                continue

            # Compute phantom PnL (leveraged ROE %)
            if p["side"] == "long":
                pnl_pct = ((price - p["entry_price"]) / p["entry_price"]) * p["leverage"] * 100
            else:
                pnl_pct = ((p["entry_price"] - price) / p["entry_price"]) * p["leverage"] * 100

            resolved = {
                **p,
                "result": result,
                "exit_price": price,
                "pnl_pct": round(pnl_pct, 1),
                "resolved_at": now,
            }
            self._phantom_results.append(resolved)

            # Update stats
            if result == "missed_opportunity":
                self._phantom_stats["missed"] += 1
            elif result == "good_pass":
                self._phantom_stats["good_pass"] += 1
            else:
                self._phantom_stats["expired"] += 1

            # Store in Nous (missed + good_pass only)
            if result != "expired":
                self._store_phantom_result(resolved)

            # Fire wake for missed opportunities
            if result == "missed_opportunity":
                self._wake_for_phantom(resolved)

            logger.info("Phantom resolved: %s %s %s → %s (%.1f%%)",
                         p["side"], sym, p["anomaly_type"], result, pnl_pct)

        changed = len(self._phantoms) != len(still_active)
        self._phantoms = still_active
        if changed:
            self._persist_phantoms()

    def _store_phantom_result(self, resolved: dict):
        """Store a resolved phantom in Nous for future memory retrieval."""
        result = resolved["result"]
        sym = resolved["symbol"]
        side = resolved["side"]
        entry = resolved["entry_price"]
        exit_px = resolved["exit_price"]
        pnl = resolved["pnl_pct"]
        anomaly = resolved["anomaly_type"]
        headline = resolved["anomaly_headline"]

        if result == "missed_opportunity":
            subtype = "custom:missed_opportunity"
            title = f"Missed: {side} {sym} ({anomaly}) would have hit TP"
            content = (
                f"Passed on {side} {sym} when scanner detected: {headline}. "
                f"Entry would have been ${entry:,.2f}, TP hit at ${exit_px:,.2f}. "
                f"Phantom PnL: {pnl:+.1f}% at {resolved['leverage']}x leverage."
            )
        elif result == "good_pass":
            subtype = "custom:good_pass"
            title = f"Good pass: {side} {sym} ({anomaly}) hit SL"
            content = (
                f"Correctly passed on {side} {sym} when scanner detected: {headline}. "
                f"Entry would have been ${entry:,.2f}, SL hit at ${exit_px:,.2f}. "
                f"Phantom loss: {pnl:+.1f}% at {resolved['leverage']}x leverage."
            )
        else:
            return

        try:
            from .tools.trading import _store_to_nous
            _store_to_nous(
                subtype=subtype,
                title=title,
                content=content,
                summary=title,
                signals={
                    "phantom": True,
                    "side": side,
                    "symbol": sym,
                    "entry": entry,
                    "exit": exit_px,
                    "pnl_pct": pnl,
                    "anomaly_type": anomaly,
                    "category": resolved["category"],
                    "result": result,
                    "agent_conviction": resolved.get("agent_conviction"),
                    "agent_informed": resolved.get("agent_informed", False),
                },
            )
        except Exception as e:
            logger.debug("Failed to store phantom result: %s", e)

    def _wake_for_phantom(self, resolved: dict):
        """Wake the agent when a phantom position would have hit TP."""
        sym = resolved["symbol"]
        side = resolved["side"].upper()
        entry = resolved["entry_price"]
        tp = resolved["take_profit"]
        pnl = resolved["pnl_pct"]
        headline = resolved["anomaly_headline"]
        category = resolved["category"]
        hold_mins = int((resolved["resolved_at"] - resolved["created_at"]) / 60)

        # Phantom stats summary
        total = self._phantom_stats["missed"] + self._phantom_stats["good_pass"]
        stats_line = ""
        if total > 0:
            miss_rate = self._phantom_stats["missed"] / total * 100
            stats_line = (
                f"\nPhantom tracker: {self._phantom_stats['missed']} missed, "
                f"{self._phantom_stats['good_pass']} good passes "
                f"({miss_rate:.0f}% miss rate)"
            )

        lines = [
            f"[DAEMON WAKE — Missed Opportunity: {sym}]",
            "",
            f"You passed on {side} {sym} {hold_mins}m ago.",
            f"Scanner signal was: {headline}",
            f"Phantom entry: ${entry:,.2f} → TP hit at ${tp:,.2f}",
            f"Would have made: {pnl:+.1f}% ({'your levels' if resolved.get('agent_informed') else 'default params'}, {resolved['leverage']}x)",
        ]
        if stats_line:
            lines.append(stats_line)
        lines.extend([
            "",
            "What held you back? Was your caution justified, or did you freeze?",
        ])

        message = "\n".join(lines)
        response = self._wake_agent(
            message, max_coach_cycles=0, max_tokens=512,
            source="daemon:phantom",
        )
        if response:
            title = f"Missed: {side.lower()} {sym} +{pnl:.0f}%"
            log_event(DaemonEvent(
                "phantom", title,
                f"Entry ${entry:,.0f} → TP ${tp:,.0f} | {pnl:+.1f}% | {category}",
            ))
            _queue_and_persist("Phantom", title, response, event_type="phantom")
            _notify_discord("Phantom", title, response)

    def _persist_phantoms(self):
        """Save active phantoms + stats to disk (survives restarts)."""
        try:
            import json as _json
            from ..core.persistence import _atomic_write
            storage = self.config.project_root / "storage"
            storage.mkdir(parents=True, exist_ok=True)
            # Active phantoms
            _atomic_write(storage / "phantoms.json", _json.dumps(self._phantoms, default=str))
            # Phantom stats + recent results (persist across restarts)
            stats_data = {
                "stats": self._phantom_stats,
                "results": self._phantom_results,
            }
            _atomic_write(storage / "phantom_stats.json", _json.dumps(stats_data, default=str))
        except Exception as e:
            logger.debug("Failed to persist phantoms: %s", e)

    def _load_phantoms(self):
        """Load active phantoms + stats from disk on startup."""
        try:
            import json as _json
            storage = self.config.project_root / "storage"
            # Active phantoms
            path = storage / "phantoms.json"
            if path.exists():
                self._phantoms = _json.loads(path.read_text())
                now = time.time()
                self._phantoms = [p for p in self._phantoms if p.get("expires_at", 0) > now]
                logger.info("Loaded %d active phantoms from disk", len(self._phantoms))
            # Phantom stats + results
            stats_path = storage / "phantom_stats.json"
            if stats_path.exists():
                data = _json.loads(stats_path.read_text())
                saved_stats = data.get("stats", {})
                self._phantom_stats["missed"] = saved_stats.get("missed", 0)
                self._phantom_stats["good_pass"] = saved_stats.get("good_pass", 0)
                self._phantom_stats["expired"] = saved_stats.get("expired", 0)
                self._phantom_results = data.get("results", [])
                logger.info("Loaded phantom stats: %d missed, %d good pass, %d results",
                           self._phantom_stats["missed"], self._phantom_stats["good_pass"],
                           len(self._phantom_results))
            else:
                # First run with persistence — seed stats from Nous
                self._seed_phantom_stats_from_nous()
        except Exception as e:
            logger.debug("Failed to load phantoms: %s", e)

    def _seed_phantom_stats_from_nous(self):
        """Seed phantom stats from Nous nodes on first run (no phantom_stats.json yet)."""
        try:
            nous = self._get_nous()
            if nous is None:
                return
            missed = nous.list_nodes(subtype="custom:missed_opportunity", limit=500)
            good = nous.list_nodes(subtype="custom:good_pass", limit=500)
            self._phantom_stats["missed"] = len(missed)
            self._phantom_stats["good_pass"] = len(good)
            logger.info("Seeded phantom stats from Nous: %d missed, %d good pass",
                       len(missed), len(good))
            # Persist immediately so we don't re-seed next restart
            self._persist_phantoms()
        except Exception as e:
            logger.debug("Failed to seed phantom stats from Nous: %s", e)

    def _persist_position_types(self):
        """Save position types to disk (survives restarts)."""
        try:
            import json as _json
            path = self.config.project_root / "storage" / "position_types.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            from ..core.persistence import _atomic_write
            _atomic_write(path, _json.dumps(self._position_types, default=str))
        except Exception as e:
            logger.debug("Failed to persist position types: %s", e)

    def _load_position_types(self):
        """Load position types from disk on startup. Merge with live positions."""
        try:
            import json as _json
            path = self.config.project_root / "storage" / "position_types.json"
            if path.exists():
                saved = _json.loads(path.read_text())
                # Only load types for coins that are still open positions
                open_coins = set(self._prev_positions.keys())
                loaded = 0
                for coin, info in saved.items():
                    if coin in open_coins and coin not in self._position_types:
                        self._position_types[coin] = info
                        loaded += 1
                if loaded:
                    logger.info("Loaded %d position types from disk", loaded)
        except Exception as e:
            logger.debug("Failed to load position types: %s", e)

    def _persist_daily_pnl(self):
        """Save daily PnL + counters to disk (survives restarts)."""
        try:
            import json as _json
            path = self.config.project_root / "storage" / "daily_pnl.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            from ..core.persistence import _atomic_write
            data = {
                "date": self._daily_reset_date,
                "daily_realized_pnl": self._daily_realized_pnl,
                "entries_today": self._entries_today,
                "micro_entries_today": self._micro_entries_today,
                "trading_paused": self._trading_paused,
            }
            _atomic_write(path, _json.dumps(data))
        except Exception as e:
            logger.debug("Failed to persist daily PnL: %s", e)

    def _load_daily_pnl(self):
        """Load daily PnL from disk on startup. Only restore if same UTC day."""
        try:
            import json as _json
            path = self.config.project_root / "storage" / "daily_pnl.json"
            if not path.exists():
                return
            saved = _json.loads(path.read_text())
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            if saved.get("date") == today:
                self._daily_realized_pnl = saved.get("daily_realized_pnl", 0.0)
                self._entries_today = saved.get("entries_today", 0)
                self._micro_entries_today = saved.get("micro_entries_today", 0)
                self._trading_paused = saved.get("trading_paused", False)
                self._daily_reset_date = today
                logger.info("Restored daily PnL from disk: $%.2f (%d entries, %d micro)",
                           self._daily_realized_pnl, self._entries_today, self._micro_entries_today)
            else:
                logger.info("Daily PnL file is from %s (today=%s), starting fresh",
                           saved.get("date"), today)
        except Exception as e:
            logger.debug("Failed to load daily PnL: %s", e)

    def _wake_for_review(self):
        """Periodic market review — alternates between normal and learning reviews.

        Every 3rd review is a learning review that prompts the agent to
        explore a concept, pattern, or contradiction using search_web.
        Normal reviews stay brief (under 100 words).
        """
        self._review_count += 1
        is_learning = self._review_count % 3 == 0

        if is_learning:
            lines = [
                "[DAEMON WAKE — Periodic Review + Learning]",
                "",
                "Briefing has market data. Address [Warnings] and [Questions] first.",
                "Then pick one thing to learn — a concept, pattern, or contradiction — research it, store the lesson.",
                "Share what genuinely interests you right now. Be curious, not mechanical.",
            ]
            review_type = "Periodic review + learning"
        else:
            lines = [
                "[DAEMON WAKE — Periodic Market Review]",
                "",
                "Briefing has market data. Address [Warnings] and [Questions] first.",
                "Check all symbols, check your watchpoints (set new ones if you have none).",
                "Share your honest take — what's the most interesting thing happening right now? Don't just repeat the last review.",
            ]
            review_type = "Periodic market review"

        # Activity awareness — nudge when too quiet or too active
        if self._last_entry_time > 0:
            idle_hours = (time.time() - self._last_entry_time) / 3600
            if idle_hours > 48:
                lines.append(
                    f"\n⚠ No new entries in {idle_hours / 24:.0f} days. "
                    "Are you being selective or stuck? A 0.6 conviction trade at half size is valid."
                )
        if self._entries_today >= 3:
            lines.append(f"\n⚠ {self._entries_today} entries today. Check for overtrading.")

        message = "\n".join(lines)
        if is_learning:
            response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1536, source="daemon:review")
        else:
            response = self._wake_agent(message, max_coach_cycles=1, max_tokens=512, source="daemon:review")
        if response:
            symbols = self.config.execution.symbols
            log_event(DaemonEvent(
                "review", review_type,
                f"Symbols: {', '.join(symbols)} | F&G: {self.snapshot.fear_greed}",
            ))
            _queue_and_persist("Review", review_type, response)
            _notify_discord("Review", review_type, response)
            logger.info("%s complete (%d chars)", review_type, len(response))

    def _run_decay_cycle(self):
        """Run FSRS batch decay across all Nous nodes.

        Recomputes retrievability and transitions lifecycle states
        (ACTIVE → WEAK → DORMANT). Logs transition stats.
        """
        try:
            nous = self._get_nous()
            result = nous.run_decay()

            processed = result.get("processed", 0)
            transitions_count = result.get("transitions_count", 0)
            transitions = result.get("transitions", [])

            self.decay_cycles_run += 1

            if transitions_count > 0:
                # Log each transition for visibility
                for t in transitions:
                    logger.info("Decay transition: %s — %s → %s",
                                t.get("id", "?"), t.get("from", "?"), t.get("to", "?"))

                log_event(DaemonEvent(
                    "decay", "FSRS decay cycle",
                    f"{processed} nodes, {transitions_count} transitions",
                ))
            else:
                logger.debug("Decay cycle: %d nodes processed, no transitions", processed)

        except Exception as e:
            logger.debug("Decay cycle failed: %s", e)

    def _run_embedding_backfill(self):
        """Backfill embeddings for any nodes missing them.

        Nodes created during an OpenAI outage have no vector embedding,
        making them invisible to semantic search (SSA vector component).
        This periodic task ensures all nodes eventually get embeddings.
        """
        try:
            nous = self._get_nous()
            result = nous.backfill_embeddings()

            embedded = result.get("embedded", 0)
            total = result.get("total", 0)

            self.embedding_backfills += 1

            if embedded > 0:
                logger.info("Embedding backfill: %d/%d nodes embedded", embedded, total)
                log_event(DaemonEvent(
                    "backfill", "Embedding backfill",
                    f"{embedded}/{total} nodes embedded",
                ))
            else:
                logger.debug("Embedding backfill: all nodes have embeddings")

        except Exception as e:
            logger.debug("Embedding backfill failed: %s", e)

    def _check_conflicts(self):
        """Poll the Nous contradiction queue for pending conflicts.

        Tier 1: Auto-resolve obvious cases (no agent, no cost).
        Tier 2: Wake agent with remaining conflicts for batch resolution.
        """
        try:
            nous = self._get_nous()
            conflicts = nous.get_conflicts(status="pending")

            self.conflict_checks += 1

            if not conflicts:
                logger.debug("Conflict check: no pending conflicts")
                return

            # === Tier 1: Auto-resolve (zero cost) ===
            auto_items = []   # [{conflict_id, resolution}]
            remaining = []    # conflicts that need agent review

            for conflict in conflicts:
                auto_resolution = self._auto_resolve_conflict(conflict, nous)
                if auto_resolution:
                    auto_items.append({
                        "conflict_id": conflict["id"],
                        "resolution": auto_resolution,
                    })
                else:
                    remaining.append(conflict)

            # Batch-resolve all auto-decisions in one HTTP call
            if auto_items:
                try:
                    result = nous.batch_resolve_conflicts(auto_items)
                    auto_resolved = result.get("resolved", 0)
                    logger.info("Auto-resolved %d/%d conflicts (tier 1)",
                                auto_resolved, len(auto_items))
                    log_event(DaemonEvent(
                        "conflict", "Auto-resolved conflicts",
                        f"{auto_resolved} auto-resolved, {len(remaining)} need review",
                    ))
                except Exception as e:
                    logger.warning("Batch auto-resolve failed: %s", e)
                    # Fall back to sending all to agent
                    remaining = conflicts

            if not remaining:
                return

            # === Tier 2: Wake agent with remaining conflicts ===
            self._wake_for_conflicts(remaining, nous)

        except Exception as e:
            logger.debug("Conflict check failed: %s", e)

    def _auto_resolve_conflict(self, conflict: dict, nous) -> str | None:
        """Apply Tier 1 auto-resolve rules. Returns resolution string or None.

        Rules (conservative — better to send to agent than auto-resolve wrong):
        1. Expired: expires_at has passed -> keep_both
        2. Low confidence: detection_confidence < 0.40 -> keep_both
        3. Explicit self-correction: markers + confidence > 0.50 -> new_is_current
        4. Explicit update: markers + confidence > 0.50 -> new_is_current
        5. Same subtype + same entity: latest view wins -> new_is_current
        """
        cid = conflict.get("id", "?")
        confidence = conflict.get("detection_confidence", 0)
        new_content = (conflict.get("new_content", "") or "").lower()
        expires_at = conflict.get("expires_at", "")

        # Rule 1: Expired
        if expires_at:
            try:
                from datetime import datetime, timezone
                exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if exp_dt < datetime.now(timezone.utc):
                    logger.debug("Auto-resolve %s: expired", cid)
                    return "keep_both"
            except (ValueError, TypeError):
                pass

        # Rule 2: Low confidence (system wasn't sure it's a real contradiction)
        if confidence < 0.40:
            logger.debug("Auto-resolve %s: low confidence (%.2f)", cid, confidence)
            return "keep_both"

        # Rule 3: Explicit self-correction
        correction_markers = ["i was wrong", "correction:", "i made an error", "i was mistaken"]
        if confidence > 0.50 and any(m in new_content for m in correction_markers):
            logger.debug("Auto-resolve %s: self-correction detected", cid)
            return "new_is_current"

        # Rule 4: Explicit update
        update_markers = ["update:", "revised:", "updated:", "revised view"]
        if confidence > 0.50 and any(m in new_content for m in update_markers):
            logger.debug("Auto-resolve %s: explicit update detected", cid)
            return "new_is_current"

        # Rule 5: Same subtype + same entity (latest view wins)
        old_node_id = conflict.get("old_node_id")
        new_node_id = conflict.get("new_node_id")
        entity = conflict.get("entity_name")
        if old_node_id and new_node_id and entity:
            try:
                old_node = nous.get_node(old_node_id)
                new_node = nous.get_node(new_node_id)
                if old_node and new_node:
                    if old_node.get("subtype") == new_node.get("subtype"):
                        logger.debug("Auto-resolve %s: same subtype+entity (%s)", cid, entity)
                        return "new_is_current"
            except Exception:
                pass

        return None

    def _wake_for_conflicts(self, conflicts: list[dict], nous):
        """Wake agent with remaining conflicts, instructing batch resolution."""
        lines = [
            "[DAEMON WAKE — Contradiction Review]",
            f"You have {len(conflicts)} contradiction(s) that need your judgment.",
            "",
        ]

        for conflict in conflicts[:5]:
            cid = conflict.get("id", "?")
            old_id = conflict.get("old_node_id", "?")
            new_id = conflict.get("new_node_id")
            new_content = conflict.get("new_content", "")
            ctype = conflict.get("conflict_type", "?")
            confidence = conflict.get("detection_confidence", 0)

            old_title = old_id
            old_body = ""
            try:
                old_node = nous.get_node(old_id)
                if old_node:
                    old_title = old_node.get("content_title", old_id)
                    old_body = old_node.get("content_body", "") or ""
            except Exception:
                pass

            new_title = ""
            new_body = ""
            if new_id:
                try:
                    new_node = nous.get_node(new_id)
                    if new_node:
                        new_title = new_node.get("content_title", "")
                        new_body = new_node.get("content_body", "") or ""
                except Exception:
                    pass

            lines.append(f"Conflict {cid} ({ctype}, {confidence:.0%} confidence):")

            old_preview = old_body[:500] if old_body else "(no content)"
            if len(old_body) > 500:
                old_preview += "..."
            lines.append(f'  OLD: "{old_title}" ({old_id})')
            lines.append(f"  {old_preview}")

            if new_id and new_title:
                new_preview = new_body[:500] if new_body else "(no content)"
                if len(new_body) > 500:
                    new_preview += "..."
                lines.append(f'  NEW: "{new_title}" ({new_id})')
                lines.append(f"  {new_preview}")
            else:
                new_preview = new_content[:500]
                if len(new_content) > 500:
                    new_preview += "..."
                lines.append(f"  NEW CONTENT: {new_preview}")
            lines.append("")

        if len(conflicts) > 5:
            lines.append(f"... and {len(conflicts) - 5} more. Use manage_conflicts(action=\"list\") to see all.")
            lines.append("")

        lines.extend([
            "EFFICIENT RESOLUTION:",
            "- Group conflicts with the same decision and use batch_resolve:",
            '  {"action": "batch_resolve", "conflict_ids": ["c_...", "c_..."], "resolution": "new_is_current"}',
            "- Only resolve individually when conflicts need different decisions.",
            "",
            "Resolutions: old_is_current, new_is_current, keep_both, merge",
        ])

        message = "\n".join(lines)
        response = self._wake_agent(message, max_tokens=1024, source="daemon:conflict")
        if response:
            log_event(DaemonEvent(
                "conflict", "Contradiction review",
                f"{len(conflicts)} conflicts for agent review",
            ))
            logger.info("Contradiction review wake: %d conflicts, agent responded (%d chars)",
                        len(conflicts), len(response))

    def _seed_clusters(self):
        """Create starter clusters if none exist.

        Called once on daemon startup. Only seeds when the cluster list is
        completely empty (won't re-seed if user deleted some clusters).
        """
        try:
            nous = self._get_nous()
            existing = nous.list_clusters()
            if existing:
                logger.debug("Cluster seeding skipped: %d clusters exist", len(existing))
                return

            symbols = self.config.execution.symbols  # ["BTC", "ETH", "SOL"]

            # Asset clusters (keyword matching in _auto_assign_clusters)
            for sym in symbols:
                nous.create_cluster(
                    name=sym,
                    description=f"All {sym}-related memories",
                    pinned=True,
                )

            # Type clusters (subtype-based auto-assignment)
            type_clusters = [
                ("Thesis", "Active and archived trade theses", ["custom:thesis"]),
                ("Lessons", "Lessons learned from experience and research", ["custom:lesson"]),
                ("Trade History", "Trade entries, modifications, and closes", [
                    "custom:trade_entry", "custom:trade_close", "custom:trade_modify",
                ]),
            ]
            for name, desc, auto_subs in type_clusters:
                nous.create_cluster(
                    name=name,
                    description=desc,
                    auto_subtypes=auto_subs,
                )

            total = len(symbols) + len(type_clusters)
            log_event(DaemonEvent(
                "cluster", "Clusters seeded",
                f"{len(symbols)} asset + {len(type_clusters)} type clusters",
            ))
            logger.info("Seeded %d clusters (%d asset + %d type)",
                        total, len(symbols), len(type_clusters))

        except Exception as e:
            logger.warning("Cluster seeding failed: %s", e)

    def _check_health(self, startup: bool = False):
        """Check Nous server health and log knowledge base stats.

        On startup: logs a clear pass/fail message.
        Periodic: logs node/edge counts and lifecycle distribution.
        Sets self._nous_healthy for other methods to check.
        """
        try:
            nous = self._get_nous()
            result = nous.health()

            self._nous_healthy = True
            self.health_checks += 1

            status = result.get("status", "?")
            node_count = result.get("node_count", 0)
            edge_count = result.get("edge_count", 0)
            lifecycle = result.get("lifecycle", {})

            if startup:
                logger.info("Nous health OK — %d nodes, %d edges (ACTIVE=%d, WEAK=%d, DORMANT=%d)",
                            node_count, edge_count,
                            lifecycle.get("ACTIVE", 0),
                            lifecycle.get("WEAK", 0),
                            lifecycle.get("DORMANT", 0))
            else:
                logger.info("Nous health: %s — %d nodes, %d edges (A=%d W=%d D=%d)",
                            status, node_count, edge_count,
                            lifecycle.get("ACTIVE", 0),
                            lifecycle.get("WEAK", 0),
                            lifecycle.get("DORMANT", 0))

        except Exception as e:
            was_healthy = self._nous_healthy
            self._nous_healthy = False

            if startup:
                logger.warning("Nous health check FAILED on startup: %s — memory tools will fail", e)
            elif was_healthy:
                # Transitioned from healthy to unhealthy — warn loudly
                logger.warning("Nous health check FAILED: %s — memory operations may fail", e)
                log_event(DaemonEvent("health", "Nous unreachable", str(e)))
            else:
                logger.debug("Nous still unreachable: %s", e)

    def _check_curiosity(self):
        """Check if curiosity queue is large enough for a learning session.

        Enforces a 1-hour cooldown between learning sessions to prevent
        runaway loops where each session creates new curiosity items.
        """
        # Cooldown: max 1 learning session per hour
        if time.time() - self._last_learning_session < 3600:
            return

        try:
            nous = self._get_nous()
            curiosity_items = nous.list_nodes(
                subtype="custom:curiosity",
                lifecycle="ACTIVE",
                limit=20,
            )

            self._pending_curiosity_count = len(curiosity_items)

            if len(curiosity_items) < self.config.daemon.curiosity_threshold:
                return

            lines = [
                "[DAEMON WAKE — Learning Session]",
                "",
                f"You have {len(curiosity_items)} pending curiosity items:",
            ]
            for i, item in enumerate(curiosity_items[:5], 1):
                title = item.get("content_title", "Untitled")
                lines.append(f"  {i}. {title}")

            lines.extend([
                "",
                "Pick the most relevant topic and research it using search_web. "
                "Synthesize what you learn into a lesson. Store it with [[wikilinks]] "
                "back to the original curiosity item and related memories. "
                "Mark addressed items by noting them in your lesson.",
            ])

            message = "\n".join(lines)
            response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1536, source="daemon:learning")
            if response:
                self.learning_sessions += 1
                self._last_learning_session = time.time()
                # Mark addressed curiosity items as WEAK so they don't re-trigger
                for item in curiosity_items[:5]:
                    try:
                        nous.update_node(item["id"], state_lifecycle="WEAK")
                    except Exception:
                        pass
                topics = [it.get("content_title", "?") for it in curiosity_items[:5]]
                log_event(DaemonEvent(
                    "learning", "Curiosity learning session",
                    f"{len(curiosity_items)} items: {', '.join(topics)}",
                ))
                _queue_and_persist("Learning", f"Curiosity: {', '.join(topics[:3])}", response)
                _notify_discord("Learning", f"Curiosity: {', '.join(topics[:3])}", response)
                logger.info("Learning session complete (%d chars)", len(response))

        except Exception as e:
            logger.debug("Curiosity check failed: %s", e)

    # ================================================================
    # Agent Wake (Thread-Safe)
    # ================================================================

    def _wake_agent(
        self, message: str, priority: bool = False,
        max_coach_cycles: int = 0,
        max_tokens: int | None = None,
        source: str = "daemon:unknown",
        skip_memory: bool = False,
    ) -> str | None:
        """Send a daemon message to the agent with pre-built briefing.

        Flow:
        1. Build code-based warnings (free, deterministic)
        2. Build briefing from pre-fetched data (free)
        3. Build code questions from data (free)
        4. If max_coach_cycles > 0: Haiku sharpener BEFORE Sonnet (~$0.0003)
        5. Assemble all into wake message
        6. Agent responds (1 Sonnet call, skip_snapshot when briefing present)
        7. Update fingerprint + clear consumed thoughts

        No post-Sonnet evaluation. Haiku runs BEFORE, not after.
        Total: 0-1 Haiku + 1 Sonnet.

        Args:
            message: The wake message to send.
            priority: If True, bypass cooldown (used for fill wakes).
                      Still respects hourly rate limit.
            max_coach_cycles: 0 = no coaching (fills, watchpoints, learning).
                1 = sharpener (review, manual).

        Returns the agent's response text, or None if skipped/busy.
        """
        if not hasattr(self.agent, '_chat_lock'):
            logger.error("Agent missing _chat_lock — cannot wake")
            return None

        now = time.time()

        # Rate limit: cooldown between wakes (skip unless priority)
        cooldown = self.config.daemon.wake_cooldown_seconds
        if not priority and cooldown > 0 and (now - self._last_wake_time) < cooldown:
            log_event(DaemonEvent(
                "skip", "Cooldown active",
                f"{cooldown - (now - self._last_wake_time):.0f}s remaining",
            ))
            logger.info("Wake skipped — cooldown (%ds remaining)",
                         cooldown - (now - self._last_wake_time))
            return None

        # Prune wake timestamp log (keep last hour for stats only)
        cutoff = now - 3600
        self._wake_timestamps = [t for t in self._wake_timestamps if t > cutoff]

        acquired = self.agent._chat_lock.acquire(blocking=False)
        if not acquired:
            log_event(DaemonEvent("skip", "Agent busy", "User chatting — wake skipped"))
            logger.info("Agent busy (user chatting), skipping daemon wake")
            return None

        try:
            # === 0. Ensure fresh prices before any wake ===
            # Briefing uses snapshot.prices — stale prices = stale reasoning.
            # Force a price refresh if last poll was >15s ago (cheap HTTP call).
            price_age = time.time() - self.snapshot.last_price_poll
            if price_age > 15:
                try:
                    provider = self._get_provider()
                    fresh_prices = provider.get_all_prices()
                    for sym in self.config.execution.symbols:
                        if sym in fresh_prices:
                            self.snapshot.prices[sym] = fresh_prices[sym]
                    self.snapshot.last_price_poll = time.time()
                    logger.debug("Wake price refresh: %d symbols updated (was %.0fs stale)",
                                 len(fresh_prices), price_age)
                except Exception as e:
                    logger.debug("Wake price refresh failed (using cached): %s", e)

            # === 1. Build warnings (free, existing) ===
            warnings_text = ""
            memory_state = {}
            try:
                from .wake_warnings import build_warnings
                warnings_text, memory_state = build_warnings(
                    self._get_provider(), self, self._get_nous(), self.config,
                )
            except Exception as e:
                logger.debug("Wake warnings failed: %s", e)

            # === 2. Build briefing (free, pre-fetched data + fresh prices) ===
            briefing_text = ""
            code_questions = []
            if self._data_cache.symbols:
                try:
                    from .briefing import build_briefing, build_code_questions
                    briefing_text = build_briefing(
                        self._data_cache, self.snapshot,
                        self._get_provider(), self, self.config,
                    )
                    # Get positions for code questions
                    try:
                        state = self._get_provider().get_user_state()
                        positions = state.get("positions", [])
                    except Exception:
                        positions = []
                    code_questions = build_code_questions(
                        self._data_cache, self.snapshot, positions, self.config,
                        daemon=self,
                    )
                except Exception as e:
                    logger.debug("Briefing build failed: %s", e)

            # === 3. Haiku sharpener (pre-Sonnet, review/manual only) ===
            haiku_questions = []
            if max_coach_cycles > 0 and briefing_text:
                try:
                    from .coach import Coach
                    coach = Coach(self.agent.config)
                    haiku_questions = coach.sharpen(
                        briefing_text, code_questions, memory_state,
                        self._format_wake_history(),
                    )
                except Exception as e:
                    logger.error("Coach sharpen failed: %s", e)

            # === 3b. Position awareness block (every wake) ===
            position_block = ""
            if self._prev_positions:
                pos_lines = []
                now_ts = time.time()
                for coin, pdata in self._prev_positions.items():
                    p_side = pdata.get("side", "long")
                    p_entry = pdata.get("entry_px", 0)
                    p_lev = pdata.get("leverage", 20)
                    p_px = self.snapshot.prices.get(coin, 0)
                    if p_entry > 0 and p_px > 0:
                        if p_side == "long":
                            p_pct = (p_px - p_entry) / p_entry * 100
                        else:
                            p_pct = (p_entry - p_px) / p_entry * 100
                        p_roe = p_pct * p_lev
                    else:
                        p_roe = 0
                    p_peak = self._peak_roe.get(coin, 0)
                    p_type = self.get_position_type(coin)
                    p_hold = ""
                    if p_type["entry_time"] > 0:
                        p_mins = max(0, int((now_ts - p_type["entry_time"]) / 60))
                        p_hold = f" | Hold: {p_mins}m"
                    p_fade = ""
                    if p_peak > 5 and p_roe < p_peak * 0.5:
                        p_fade = " | PROFIT FADING"
                    px_f = f"${p_px:,.0f}" if p_px >= 100 else f"${p_px:,.2f}"
                    en_f = f"${p_entry:,.0f}" if p_entry >= 100 else f"${p_entry:,.2f}"
                    pos_lines.append(
                        f"  {coin} {p_side.upper()} {p_lev}x ({p_type['type']})"
                        f" | {en_f} -> {px_f}"
                        f" | ROE: {p_roe:+.1f}% (peak {p_peak:+.1f}%){p_hold}{p_fade}"
                    )
                if pos_lines:
                    position_block = (
                        "[YOUR OPEN POSITIONS — manage these before anything else]\n"
                        + "\n".join(pos_lines)
                        + "\nIf any position is profitable, decide NOW: close, trail stop, or hold with clear reason."
                    )

            # === 3c. Regime context (zero cost, already computed) ===
            regime_block = ""
            if self._regime and self._regime.label != "NEUTRAL":
                from .regime import format_regime_line
                regime_block = format_regime_line(self._regime, compact=False)

            # === 4. Assemble wake message ===
            parts = []
            if briefing_text:
                parts.append(f"[Briefing]\n{briefing_text}\n[End Briefing]")
            if code_questions or haiku_questions:
                all_q = code_questions + haiku_questions
                parts.append("[Consider — do NOT list these in your response, just let them inform your thinking]\n" + "\n".join(f"- {q}" for q in all_q))
            if warnings_text:
                parts.append(warnings_text)
            if regime_block:
                parts.append(regime_block)
            if position_block:
                parts.append(position_block)
            parts.append(message)  # Original wake message

            full_message = "\n\n".join(parts)

            # === 5. Agent responds (skip_snapshot since briefing has it all) ===
            response = self.agent.chat(
                full_message, skip_snapshot=bool(briefing_text),
                max_tokens=max_tokens,
                source=source,
                skip_memory=skip_memory,
            )
            if response is None:
                return None

            # === 5b. Narrated-trade check (while lock is held) ===
            # If agent narrated a trade without calling the tool, force a follow-up
            followup = _check_narrated_trade(response, self.agent)
            if followup:
                response = response + "\n\n" + followup

            # === 6. Update fingerprint for staleness detection ===
            try:
                from ..core.memory_tracker import get_tracker
                audit = get_tracker().build_audit()
                self._update_fingerprint(audit)
            except Exception:
                pass

            # === 7. Clear consumed thoughts ===
            if self._pending_thoughts:
                self._pending_thoughts.clear()

            self.wake_count += 1
            self._wake_timestamps.append(now)
            self._last_wake_time = now
            return response
        except Exception as e:
            log_event(DaemonEvent("error", "Wake failed", str(e)))
            logger.error("Daemon wake failed: %s", e)
            return None
        finally:
            self.agent._chat_lock.release()
            # Refresh position snapshot so agent-initiated closes don't
            # re-trigger fill detection on the next _check_positions() cycle.
            try:
                provider = self._get_provider()
                if provider.can_trade:
                    state = provider.get_user_state()
                    self._prev_positions = {
                        p["coin"]: {"side": p["side"], "size": p["size"], "entry_px": p["entry_px"], "leverage": p.get("leverage", 20)}
                        for p in state.get("positions", [])
                    }
            except Exception:
                pass

    # ================================================================
    # Manual Wake (triggered from dashboard UI)
    # ================================================================

    def trigger_manual_wake(self):
        """Trigger an immediate review wake from the UI.

        Runs in a background thread — returns immediately. The response
        appears in the dashboard chat feed via the daemon chat queue.
        """
        if not self._running:
            logger.warning("Manual wake ignored — daemon not running")
            return

        threading.Thread(
            target=self._manual_wake, daemon=True, name="manual-wake",
        ).start()

    def _manual_wake(self):
        """Execute a manual review wake (runs in background thread)."""
        lines = [
            "[DAEMON WAKE — Manual Review (triggered from dashboard)]",
            "",
            "David wants a quick update. Briefing has market data. 1-3 sentences.",
        ]

        message = "\n".join(lines)
        response = self._wake_agent(message, priority=True, max_coach_cycles=1, max_tokens=1024, source="daemon:manual")
        if response:
            log_event(DaemonEvent(
                "review", "Manual review (dashboard)",
                f"Triggered by user | F&G: {self.snapshot.fear_greed}",
            ))
            _queue_and_persist("Manual Review", "Manual review (dashboard)", response)
            _notify_discord("Review", "Manual review (dashboard)", response)
            logger.info("Manual review complete (%d chars)", len(response))

    # ================================================================
    # Coach Cross-Wake Intelligence
    # ================================================================

    def _format_wake_history(self) -> str:
        """Format recent daemon events for the coach prompt."""
        from ..core.daemon_log import get_events

        events = get_events(limit=5)
        if not events:
            return ""

        lines = [f"Recent Wake History (last {len(events)}):"]
        for event in events:
            etype = event.get("type", "?")
            title = event.get("title", "?")
            detail = event.get("detail", "")
            ts = event.get("timestamp", "")

            age = _format_event_age(ts) if ts else "?"
            if len(detail) > 80:
                detail = detail[:77] + "..."
            lines.append(f"  {age}: [{etype}] {title} — {detail}")

        return "\n".join(lines)

    def _store_thought(self, question: str):
        """Store a Haiku question for injection into the next wake."""
        self._pending_thoughts.append(question)
        # Cap at 3 thoughts max
        if len(self._pending_thoughts) > 3:
            self._pending_thoughts = self._pending_thoughts[-3:]
        logger.info("Stored pending thought: %s", question[:60])

    def _update_fingerprint(self, audit: dict):
        """Update wake fingerprint for staleness detection by warnings."""
        tools_used = frozenset(tc["name"] for tc in self.agent._last_tool_calls)
        mutations = frozenset(n["subtype"] for n in audit["nodes_created"])
        fingerprint = tools_used | mutations

        self._wake_fingerprints.append(fingerprint)
        if len(self._wake_fingerprints) > 5:
            self._wake_fingerprints.pop(0)


# ====================================================================
# Coach Intelligence Helpers
# ====================================================================

def _format_event_age(iso_timestamp: str) -> str:
    """Format an ISO timestamp as relative age (e.g. '3h ago', '45m ago')."""
    try:
        ts = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta = now - ts
        total_seconds = int(delta.total_seconds())

        if total_seconds < 60:
            return "just now"
        elif total_seconds < 3600:
            return f"{total_seconds // 60}m ago"
        elif total_seconds < 86400:
            return f"{total_seconds // 3600}h ago"
        else:
            return f"{delta.days}d ago"
    except Exception:
        return "?"


# ====================================================================
# Standalone entry point
# ====================================================================

def run_standalone():
    """Run the daemon as a standalone process (no dashboard).

    Usage: python3 -m hynous.intelligence.daemon
    """
    import signal

    from ..core.config import load_config
    from ..nous.server import ensure_running
    from .agent import Agent

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    config = load_config()

    # Start Nous server
    if not ensure_running():
        logger.warning("Nous server not available — memory tools will fail")

    # Initialize agent
    agent = Agent(config=config)

    # Start daemon
    daemon = Daemon(agent, config)
    daemon.start()

    logger.info("Daemon running. Press Ctrl+C to stop.")

    # Wait for shutdown signal
    stop_event = threading.Event()

    def _sig_handler(sig, frame):
        logger.info("Shutdown signal received")
        stop_event.set()

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    stop_event.wait()
    daemon.stop()
    logger.info("Daemon exited cleanly")


if __name__ == "__main__":
    run_standalone()
