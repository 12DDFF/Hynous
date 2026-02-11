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

        # Cached counts (for snapshot, avoids re-querying Nous)
        self._active_watchpoint_count: int = 0
        self._active_thesis_count: int = 0
        self._pending_curiosity_count: int = 0

        # Coach cross-wake state
        self._pending_thoughts: list[str] = []       # Haiku questions (max 3)
        self._wake_fingerprints: list[frozenset] = []  # Last 5 tool+mutation fingerprints

        # Market scanner (anomaly detection across all pairs)
        self._scanner = None
        if config.scanner.enabled:
            from .scanner import MarketScanner
            self._scanner = MarketScanner(config.scanner)
            self._scanner.execution_symbols = set(config.execution.symbols)

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
        """Get cached Hyperliquid provider."""
        if self._hl_provider is None:
            from ..data.providers.hyperliquid import get_provider
            self._hl_provider = get_provider()
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

    def record_micro_entry(self):
        """Record a micro trade entry (called by trading tool when trade_type='micro')."""
        self._micro_entries_today += 1

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

        while self._running:
            try:
                now = time.time()

                # 0. Daily reset check (circuit breaker)
                self._check_daily_reset()

                # 1. Price polling (default every 60s)
                if now - self.snapshot.last_price_poll >= self.config.daemon.price_poll_interval:
                    self._poll_prices()

                # 1b. Position tracking — detect SL/TP fills + profit monitoring
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
            for coin, prev_data in self._prev_positions.items():
                if coin not in current:
                    # Position closed — find the fill details
                    self._handle_position_close(provider, coin, prev_data)

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
            signals = {
                "action": "close",
                "side": side,
                "symbol": coin,
                "entry": entry_px,
                "exit": exit_px,
                "pnl_usd": round(pnl, 4),
                "pnl_pct": round(pnl_pct, 2),
                "close_type": classification,
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

    _PROFIT_ALERT_COOLDOWN = 1800  # 30min between alerts for same position+tier

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

                # Reset alerts if position side flipped (close long → open short)
                prev_side = self._profit_sides.get(coin)
                if prev_side and prev_side != side:
                    self._profit_alerts.pop(coin, None)
                self._profit_sides[coin] = side

                if coin not in self._profit_alerts:
                    self._profit_alerts[coin] = {}
                alerts = self._profit_alerts[coin]

                # Leverage-aware thresholds
                nudge, take, urgent, risk = self._profit_thresholds(leverage)

                # Check profit tiers (highest first for priority)
                if roe_pct >= urgent:
                    self._maybe_alert(coin, "urgent_profit", roe_pct, side, entry_px, mark_px, now, alerts)
                elif roe_pct >= take:
                    self._maybe_alert(coin, "take_profit", roe_pct, side, entry_px, mark_px, now, alerts)
                elif roe_pct >= nudge:
                    self._maybe_alert(coin, "profit_nudge", roe_pct, side, entry_px, mark_px, now, alerts)

                # Check risk: significant loss with no stop loss
                if roe_pct <= risk:
                    triggers = self._tracked_triggers.get(coin, [])
                    has_sl = any(t.get("order_type") == "stop_loss" for t in triggers)
                    if not has_sl:
                        self._maybe_alert(coin, "risk_no_sl", roe_pct, side, entry_px, mark_px, now, alerts)

            # Clean up alerts + sides for closed positions
            open_coins = {p["coin"] for p in positions}
            for coin in list(self._profit_alerts.keys()):
                if coin not in open_coins:
                    del self._profit_alerts[coin]
                    self._profit_sides.pop(coin, None)

        except Exception as e:
            logger.debug("Profit level check failed: %s", e)

    def _maybe_alert(
        self, coin: str, tier: str, roe_pct: float,
        side: str, entry_px: float, mark_px: float,
        now: float, alerts: dict,
    ):
        """Fire profit alert if not on cooldown."""
        last = alerts.get(tier, 0)
        if now - last < self._PROFIT_ALERT_COOLDOWN:
            return
        alerts[tier] = now
        self._wake_for_profit(coin, side, entry_px, mark_px, roe_pct, tier)

    def _wake_for_profit(
        self, coin: str, side: str, entry_px: float,
        mark_px: float, roe_pct: float, tier: str,
    ):
        """Wake the agent with a profit/risk alert."""
        pnl_line = f"{coin} {side.upper()} | Entry: ${entry_px:,.0f} → Mark: ${mark_px:,.0f} | ROE: {roe_pct:+.1f}%"

        if tier == "urgent_profit":
            header = f"[DAEMON WAKE — TAKE PROFIT: {coin} {side.upper()} +{roe_pct:.0f}%]"
            footer = "15% is exceptional. Lock this in. What's your reason to hold past this?"
            priority = True
        elif tier == "take_profit":
            header = f"[DAEMON WAKE — Profit Alert: {coin} {side.upper()} +{roe_pct:.0f}%]"
            footer = "You're up 10%. This is where you take profits. Tighten stop or close."
            priority = True
        elif tier == "profit_nudge":
            header = f"[DAEMON WAKE — {coin} {side.upper()} +{roe_pct:.0f}%]"
            footer = "Consider tightening your stop to lock in gains."
            priority = False
        elif tier == "risk_no_sl":
            header = f"[DAEMON WAKE — RISK: {coin} {side.upper()} {roe_pct:+.0f}%]"
            footer = "You're down with no stop loss. Set one NOW or close."
            priority = True
        else:
            return

        message = f"{header}\n\n{pnl_line}\n\n{footer}"
        response = self._wake_agent(message, priority=priority, max_coach_cycles=0)
        if response:
            log_event(DaemonEvent(
                "profit", f"{tier}: {coin} {side}",
                f"ROE {roe_pct:+.1f}% | Entry ${entry_px:,.0f} → ${mark_px:,.0f}",
            ))
            _daemon_chat_queue.put({
                "type": "Profit",
                "title": f"{tier.replace('_', ' ').title()}: {coin}",
                "response": response,
            })
            _notify_discord("Profit", f"{tier.replace('_', ' ').title()}: {coin}", response)
            logger.info("Profit alert: %s %s %s (ROE %+.1f%%)", tier, coin, side, roe_pct)

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
        response = self._wake_agent(message, max_coach_cycles=0)
        if response:
            self.watchpoint_fires += 1
            log_event(DaemonEvent(
                "watchpoint", title,
                f"{symbol} {condition.replace('_', ' ')} {value} | F&G: {self.snapshot.fear_greed}",
            ))
            _daemon_chat_queue.put({
                "type": "Watchpoint",
                "title": title,
                "response": response,
            })
            _notify_discord("Watchpoint", title, response)
            logger.info("Watchpoint wake complete: %s (%d chars)", title, len(response))

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

        # Format the wake message
        message = format_scanner_wake(top)

        response = self._wake_agent(message, max_coach_cycles=0)
        if response:
            self.scanner_wakes += 1
            self._scanner.wakes_triggered += 1
            top_event = top[0]
            title = top_event.headline
            log_event(DaemonEvent(
                "scanner", title,
                f"{len(top)} anomalies (top: {top_event.type} {top_event.symbol} sev={top_event.severity:.2f})",
            ))
            _daemon_chat_queue.put({
                "type": "Scanner",
                "title": title,
                "response": response,
            })
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
        """Wake the agent when a position closes. Tone depends on SL/TP/manual."""
        pnl_sign = "+" if realized_pnl >= 0 else ""
        pnl_pct = ((exit_px - entry_px) / entry_px * 100) if entry_px > 0 else 0
        if side == "short":
            pnl_pct = -pnl_pct

        pnl_line = (
            f"Entry: ${entry_px:,.0f} → Exit: ${exit_px:,.0f} | "
            f"PnL: {pnl_sign}${abs(realized_pnl):,.2f} ({pnl_pct:+.1f}%)"
        )

        if classification == "stop_loss":
            lines = [
                f"[DAEMON WAKE — Stop Loss: {coin} {side.upper()}]",
                "", pnl_line,
                "",
                "Stopped out. Recall your thesis, store a real lesson (what would you do differently?), archive the thesis, clean up watchpoints, and scan for what's next.",
            ]
        elif classification == "take_profit":
            lines = [
                f"[DAEMON WAKE — Take Profit: {coin} {side.upper()}]",
                "", pnl_line,
                "",
                "TP hit. Recall your thesis, store a lesson (what worked, what's repeatable?), archive the thesis, clean up watchpoints, and look for follow-up setups.",
            ]
        else:
            lines = [
                f"[DAEMON WAKE — Position Closed: {coin} {side.upper()}]",
                "", pnl_line,
                "",
                "Position closed. Store why if intentional, clean up watchpoints, scan the market.",
            ]

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
        response = self._wake_agent(message, priority=True, max_coach_cycles=0)
        if response:
            self._fill_fires += 1
            fill_title = f"{classification.replace('_', ' ').title()}: {coin} {side}"
            log_event(DaemonEvent(
                "fill", fill_title,
                f"Entry: ${entry_px:,.0f} → Exit: ${exit_px:,.0f} | "
                f"PnL: {pnl_sign}${abs(realized_pnl):,.2f} ({pnl_pct:+.1f}%)",
            ))
            _daemon_chat_queue.put({
                "type": "Fill",
                "title": fill_title,
                "response": response,
            })
            _notify_discord("Fill", fill_title, response)
            logger.info("Fill wake complete: %s %s %s (PnL: %s%.2f)",
                         classification, coin, side, pnl_sign, abs(realized_pnl))

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
                "Keep your response to 1-3 sentences plus any tool actions.",
            ]
            review_type = "Periodic review + learning"
        else:
            lines = [
                "[DAEMON WAKE — Periodic Market Review]",
                "",
                "Briefing has market data. Address [Warnings] and [Questions] first.",
                "Check all symbols, check your watchpoints (set new ones if you have none).",
                "Keep your response to 1-3 sentences.",
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
        response = self._wake_agent(message, max_coach_cycles=1)
        if response:
            symbols = self.config.execution.symbols
            log_event(DaemonEvent(
                "review", review_type,
                f"Symbols: {', '.join(symbols)} | F&G: {self.snapshot.fear_greed}",
            ))
            _daemon_chat_queue.put({
                "type": "Review",
                "title": review_type,
                "response": response,
            })
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
        response = self._wake_agent(message)
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
            response = self._wake_agent(message, max_coach_cycles=0)
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
                _daemon_chat_queue.put({
                    "type": "Learning",
                    "title": f"Curiosity: {', '.join(topics[:3])}",
                    "response": response,
                })
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

        # Rate limit: max wakes per hour
        max_hourly = self.config.daemon.max_wakes_per_hour
        if max_hourly > 0:
            cutoff = now - 3600
            self._wake_timestamps = [t for t in self._wake_timestamps if t > cutoff]
            if len(self._wake_timestamps) >= max_hourly:
                log_event(DaemonEvent(
                    "skip", "Hourly rate limit",
                    f"{len(self._wake_timestamps)}/{max_hourly} wakes in last hour",
                ))
                logger.info("Wake skipped — hourly limit (%d/%d)",
                             len(self._wake_timestamps), max_hourly)
                return None

        acquired = self.agent._chat_lock.acquire(blocking=False)
        if not acquired:
            log_event(DaemonEvent("skip", "Agent busy", "User chatting — wake skipped"))
            logger.info("Agent busy (user chatting), skipping daemon wake")
            return None

        try:
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

            # === 2. Build briefing (free, pre-fetched data) ===
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

            # === 4. Assemble wake message ===
            parts = []
            if briefing_text:
                parts.append(f"[Briefing]\n{briefing_text}\n[End Briefing]")
            if code_questions or haiku_questions:
                all_q = code_questions + haiku_questions
                parts.append("[Questions]\n" + "\n".join(f"- {q}" for q in all_q))
            if warnings_text:
                parts.append(warnings_text)
            parts.append(message)  # Original wake message

            full_message = "\n\n".join(parts)

            # === 5. Agent responds (skip_snapshot since briefing has it all) ===
            response = self.agent.chat(
                full_message, skip_snapshot=bool(briefing_text),
            )
            if response is None:
                return None

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
        response = self._wake_agent(message, priority=True, max_coach_cycles=1)
        if response:
            log_event(DaemonEvent(
                "review", "Manual review (dashboard)",
                f"Triggered by user | F&G: {self.snapshot.fear_greed}",
            ))
            _daemon_chat_queue.put({
                "type": "Manual Review",
                "title": "Manual review (dashboard)",
                "response": response,
            })
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
