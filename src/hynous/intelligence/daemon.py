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

        # Timing trackers
        self._last_review: float = 0
        self._last_curiosity_check: float = 0

        # Data-change gate: watchpoints only checked when data is fresh
        self._data_changed: bool = False

        # Position tracking (fill detection)
        self._prev_positions: dict[str, dict] = {}    # coin → {side, size, entry_px}
        self._tracked_triggers: dict[str, list] = {}  # coin → trigger orders snapshot
        self._last_fill_check: float = 0
        self._fill_fires: int = 0
        self._processed_fills: set[str] = set()       # Fill hashes already processed

        # Risk guardrails (circuit breaker)
        self._daily_realized_pnl: float = 0.0
        self._daily_reset_date: str = ""    # YYYY-MM-DD UTC
        self._trading_paused: bool = False

        # Wake rate limiting
        self._wake_timestamps: list[float] = []
        self._last_wake_time: float = 0

        # Cached counts (for snapshot, avoids re-querying Nous)
        self._active_watchpoint_count: int = 0
        self._active_thesis_count: int = 0
        self._pending_curiosity_count: int = 0

        # Coach cross-wake state
        self._pending_directives: list[dict] = []   # Unresolved coach directives
        self._wake_fingerprints: list[frozenset] = []  # Last 5 tool+mutation fingerprints

        # Stats
        self.wake_count: int = 0
        self.watchpoint_fires: int = 0
        self.learning_sessions: int = 0
        self.polls: int = 0

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
        logger.info("Daemon started (price=%ds, deriv=%ds, review=%ds, curiosity=%ds)",
                     self.config.daemon.price_poll_interval,
                     self.config.daemon.deriv_poll_interval,
                     self.config.daemon.periodic_interval,
                     self.config.daemon.curiosity_check_interval)

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

    @property
    def status(self) -> dict:
        """Current daemon status for dashboard display."""
        return {
            "running": self.is_running,
            "wake_count": self.wake_count,
            "watchpoint_fires": self.watchpoint_fires,
            "fill_fires": self._fill_fires,
            "learning_sessions": self.learning_sessions,
            "polls": self.polls,
            "trading_paused": self._trading_paused,
            "daily_pnl": self._daily_realized_pnl,
            "snapshot": {
                "prices": dict(self.snapshot.prices),
                "fear_greed": self.snapshot.fear_greed,
            },
        }

    # ================================================================
    # Main Loop
    # ================================================================

    def _loop(self):
        """The daemon's heartbeat. Runs in a background thread."""
        # Initial data fetch
        self._poll_prices()
        self._poll_derivatives()
        self._init_position_tracking()
        self._last_review = time.time()
        self._last_curiosity_check = time.time()
        self._last_fill_check = time.time()

        while self._running:
            try:
                now = time.time()

                # 0. Daily reset check (circuit breaker)
                self._check_daily_reset()

                # 1. Price polling (default every 60s)
                if now - self.snapshot.last_price_poll >= self.config.daemon.price_poll_interval:
                    self._poll_prices()

                # 1b. Position tracking — detect SL/TP fills (same interval as price)
                if now - self._last_fill_check >= self.config.daemon.price_poll_interval:
                    self._check_positions()
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

        # Refresh trigger orders cache for fill classification
        self._refresh_trigger_cache()

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

    def _check_positions(self):
        """Compare current positions to cached snapshot. Detect closes."""
        try:
            provider = self._get_provider()
            if not provider.can_trade:
                return

            # Paper mode: check SL/TP/liquidation triggers internally
            if hasattr(provider, "check_triggers") and self.snapshot.prices:
                events = provider.check_triggers(self.snapshot.prices)
                for event in events:
                    self._update_daily_pnl(event["realized_pnl"])
                    self._wake_for_fill(
                        event["coin"], event["side"], event["entry_px"],
                        event["exit_px"], event["realized_pnl"],
                        event["classification"],
                    )
                # Refresh cached positions after any closes
                if events:
                    state = provider.get_user_state()
                    self._prev_positions = {
                        p["coin"]: {"side": p["side"], "size": p["size"], "entry_px": p["entry_px"]}
                        for p in state.get("positions", [])
                    }
                    return

            # Testnet/live flow: detect closes by comparing snapshots
            state = provider.get_user_state()
            current = {}
            for p in state.get("positions", []):
                current[p["coin"]] = {
                    "side": p["side"],
                    "size": p["size"],
                    "entry_px": p["entry_px"],
                }

            # Detect closed positions: was in _prev but not in current
            for coin, prev_data in self._prev_positions.items():
                if coin not in current:
                    # Position closed — find the fill details
                    self._handle_position_close(provider, coin, prev_data)

            # Update snapshot
            self._prev_positions = current

        except Exception as e:
            logger.debug("Position check failed: %s", e)

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

        # Wake the agent with the appropriate message
        self._wake_for_fill(coin, side, entry_px, exit_px, realized_pnl, classification)

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
            self._daily_reset_date = today

    def _update_daily_pnl(self, realized_pnl: float):
        """Update daily PnL and check circuit breaker threshold."""
        self._check_daily_reset()
        self._daily_realized_pnl += realized_pnl

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
            "This alert is now DEAD — it will never fire again.",
            "Run your tools, compare current vs then, and decide what to do.",
            "If you take action (trade, update thesis), store it in memory.",
            "If you want to keep monitoring, use manage_watchpoints to set a new alert.",
        ])

        message = "\n".join(lines)
        response = self._wake_agent(message, max_coach_cycles=1)
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

        if classification == "stop_loss":
            lines = [
                f"[DAEMON WAKE — Stop Loss Hit: {coin} {side.upper()}]",
                "",
                f"Your stop loss was hit on {coin} {side}.",
                f"Entry: ${entry_px:,.0f} → Exit: ${exit_px:,.0f} | "
                f"Realized PnL: {pnl_sign}${abs(realized_pnl):,.2f} ({pnl_pct:+.1f}%)",
                "",
                "This is a learning moment. Use your tools to:",
                "1. Recall your original trade thesis (recall_memory for the entry)",
                "2. Check what happened — what moved against you?",
                "3. Was the thesis wrong, or was the stop too tight?",
                "4. Store a lesson — what would you do differently?",
                "",
                "Be honest with yourself. This is how you get better.",
            ]
        elif classification == "take_profit":
            lines = [
                f"[DAEMON WAKE — Take Profit Hit: {coin} {side.upper()}]",
                "",
                f"Your take profit was hit on {coin} {side}!",
                f"Entry: ${entry_px:,.0f} → Exit: ${exit_px:,.0f} | "
                f"Realized PnL: {pnl_sign}${abs(realized_pnl):,.2f} ({pnl_pct:+.1f}%)",
                "",
                "Nice trade. Use your tools to:",
                "1. Recall your original thesis — did the market confirm it?",
                "2. What signals were right? What can you do more of?",
                "3. Store a lesson — reinforce what worked.",
                "",
                "Good patterns deserve to be remembered.",
            ]
        else:
            lines = [
                f"[DAEMON WAKE — Position Closed: {coin} {side.upper()}]",
                "",
                f"Your {coin} {side} position was closed.",
                f"Entry: ${entry_px:,.0f} → Exit: ${exit_px:,.0f} | "
                f"Realized PnL: {pnl_sign}${abs(realized_pnl):,.2f} ({pnl_pct:+.1f}%)",
                "",
                "Check if this was intentional. If you closed it via your tools, "
                "this was already documented.",
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
        response = self._wake_agent(message, priority=True, max_coach_cycles=1)
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
        """Periodic market review — snapshot provides all context now.

        The agent sees portfolio, positions, market, and memory counts
        automatically via the snapshot injection in agent.chat().
        Coach pushes for deeper engagement after the initial response.
        """
        lines = [
            "[DAEMON WAKE — Periodic Market Review]",
            "",
            "Review your positions and the market. Look for:",
            "- New setups or opportunities worth investigating",
            "- Changes that affect your open positions or thesis",
            "- Key levels to add to your watchlist",
            "- Anything worth storing in memory or researching further",
            "",
            "Take concrete action — don't just observe.",
        ]

        message = "\n".join(lines)
        response = self._wake_agent(message, max_coach_cycles=2)
        if response:
            symbols = self.config.execution.symbols
            log_event(DaemonEvent(
                "review", "Periodic market review",
                f"Symbols: {', '.join(symbols)} | F&G: {self.snapshot.fear_greed}",
            ))
            _daemon_chat_queue.put({
                "type": "Review",
                "title": "Periodic market review",
                "response": response,
            })
            _notify_discord("Review", "Periodic market review", response)
            logger.info("Periodic review complete (%d chars)", len(response))

    def _check_curiosity(self):
        """Check if curiosity queue is large enough for a learning session."""
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
            response = self._wake_agent(message, max_coach_cycles=1)
            if response:
                self.learning_sessions += 1
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
        """Send a daemon message to the agent, optionally with coach follow-up.

        Uses the agent's _chat_lock to avoid racing with user chat.
        Non-blocking: if the agent is busy (user chatting), skip this wake.

        Coach integration (when max_coach_cycles > 0):
        1. Agent responds to wake message
        2. Coach evaluates response with full context:
           - Memory mutations (what was stored/linked/failed)
           - Wake history (last 5 daemon events)
           - Pending directives (unresolved from previous wakes)
           - Staleness warning (repetitive behavior detection)
        3. If directives issued: agent responds, directives stored
        4. Fulfilled directives auto-cleared, stale ones escalated

        Args:
            message: The wake message to send.
            priority: If True, bypass cooldown (used for fill wakes).
                      Still respects hourly rate limit.
            max_coach_cycles: Number of coach evaluation→follow-up cycles.
                0 = no coaching (user chat, discord). 1-2 = daemon wakes.

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
            # Turn 1: Hynous responds (snapshot auto-injected by agent.chat)
            response = self.agent.chat(message)
            if response is None:
                return None

            # Coach loop (only for daemon wakes with coaching enabled)
            if max_coach_cycles > 0:
                try:
                    from .coach import Coach
                    from ..nous.client import get_client
                    from ..core.memory_tracker import get_tracker

                    coach = Coach(self.agent.client)
                    tracker = get_tracker()

                    # Use agent's cached snapshot (just built by agent.chat)
                    snapshot = self.agent._last_snapshot or ""

                    # Build wake history from daemon log
                    wake_history = self._format_wake_history()

                    # Build pending directives text
                    pending_text = self._format_pending_directives()

                    # Build staleness warning
                    staleness_warning = ""  # Computed after first cycle

                    all_coach_directives: list[str] = []
                    coach_ran = False

                    for cycle in range(max_coach_cycles):
                        # Get memory audit from mutation tracker
                        memory_audit = tracker.format_for_coach()

                        evaluation = coach.evaluate(
                            snapshot=snapshot,
                            response=response,
                            tool_calls=self.agent._last_tool_calls,
                            active_context=self.agent._last_active_context,
                            nous_client=get_client(),
                            memory_audit=memory_audit,
                            wake_history=wake_history,
                            pending_directives=pending_text,
                            staleness_warning=staleness_warning,
                        )
                        coach_ran = True

                        if not evaluation.needs_action:
                            logger.info("Coach cycle %d: ALL_CLEAR", cycle + 1)
                            break

                        # Collect directives for embedded summary
                        all_coach_directives.extend(evaluation.directives)

                        # Store new directives for cross-wake tracking
                        self._store_directives(evaluation.directives)

                        # Feed coach directives back to Hynous
                        logger.info("Coach cycle %d: %d depth, %d directives",
                                     cycle + 1, evaluation.depth, len(evaluation.directives))
                        response = self.agent.chat(evaluation.message)

                        # If coach said depth=1, only do one cycle
                        if evaluation.depth <= 1:
                            break

                    # Post-coach: check directive fulfillment + update fingerprint
                    audit = tracker.build_audit()
                    self._check_fulfilled_directives(audit)
                    staleness_warning = self._update_fingerprint(audit)

                    # Embed coach summary into response (visible in dashboard)
                    if all_coach_directives:
                        dir_lines = "\n".join(
                            f"> {i}. {d}" for i, d in enumerate(all_coach_directives, 1)
                        )
                        response += (
                            f"\n\n---\n"
                            f"> **Coach Review** — {len(all_coach_directives)} "
                            f"directive{'s' if len(all_coach_directives) != 1 else ''} addressed\n"
                            f"{dir_lines}"
                        )
                    elif coach_ran:
                        response += "\n\n---\n> **Coach Review** — all clear"

                except Exception as e:
                    logger.error("Coach loop failed: %s", e)
                    # Continue with original response — coaching is best-effort

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
                        p["coin"]: {"side": p["side"], "size": p["size"], "entry_px": p["entry_px"]}
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
            "Your human triggered a manual review. Give them a thorough update:",
            "- Current portfolio and position status",
            "- Any notable market moves or signals",
            "- Status of your theses and watchpoints",
            "- Anything worth acting on right now",
            "",
            "Use your tools — don't just summarize from memory.",
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
            # Compact: truncate detail
            if len(detail) > 80:
                detail = detail[:77] + "..."
            lines.append(f"  {age}: [{etype}] {title} — {detail}")

        return "\n".join(lines)

    def _format_pending_directives(self) -> str:
        """Format unresolved directives for the coach prompt."""
        if not self._pending_directives:
            return ""

        lines = ["Unresolved Directives (from previous wakes):"]
        for d in self._pending_directives:
            age = self.wake_count - d["wake_number"]
            age_label = f"{age} wake{'s' if age != 1 else ''} ago"
            prefix = "OVERDUE: " if age >= 3 else ""
            lines.append(f"  [{age_label}] {prefix}\"{d['text']}\"")

        return "\n".join(lines)

    def _store_directives(self, directives: list[str]):
        """Store new coach directives for cross-wake tracking."""
        for text in directives:
            self._pending_directives.append({
                "text": text,
                "issued_at": time.time(),
                "wake_number": self.wake_count,
            })

        # Cap at 10 directives max
        if len(self._pending_directives) > 10:
            self._pending_directives = self._pending_directives[-10:]

    def _check_fulfilled_directives(self, audit: dict):
        """Remove directives that were fulfilled during this wake cycle."""
        if not self._pending_directives:
            return

        remaining = []
        for d in self._pending_directives:
            if _check_directive_fulfillment(d["text"], audit):
                logger.info("Directive fulfilled: %s", d["text"][:60])
            else:
                remaining.append(d)

        removed = len(self._pending_directives) - len(remaining)
        if removed > 0:
            logger.info("Cleared %d fulfilled directive(s), %d remaining", removed, len(remaining))
        self._pending_directives = remaining

    def _update_fingerprint(self, audit: dict) -> str:
        """Update wake fingerprint and return staleness warning if repetitive.

        Compares current tool+mutation pattern against last 3 wakes.
        Returns warning text if staleness detected, empty string otherwise.
        """
        # Build fingerprint from tools used + mutations made
        tools_used = frozenset(tc["name"] for tc in self.agent._last_tool_calls)
        mutations = frozenset(n["subtype"] for n in audit["nodes_created"])
        fingerprint = tools_used | mutations

        # Check against recent fingerprints
        staleness_score = 0
        for prev in self._wake_fingerprints[-3:]:
            if prev and fingerprint == prev:
                staleness_score += 1

        self._wake_fingerprints.append(fingerprint)
        if len(self._wake_fingerprints) > 5:
            self._wake_fingerprints.pop(0)

        if staleness_score >= 2 and fingerprint:
            tools_str = ", ".join(sorted(tools_used)) if tools_used else "no tools"
            mut_str = ", ".join(sorted(m.replace("custom:", "") for m in mutations)) if mutations else "no mutations"
            warning = (
                f"Hynous used the same pattern in {staleness_score} of the last 3 wakes: "
                f"tools=[{tools_str}], mutations=[{mut_str}]. "
                f"Push for different tools or new actions."
            )
            logger.info("Staleness detected: %s", warning[:80])
            return warning

        return ""


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


def _check_directive_fulfillment(directive_text: str, audit: dict) -> bool:
    """Check if a mutation audit satisfies a directive.

    Simple keyword matching against the directive text and the subtypes
    of nodes created during this cycle. Not ML — just practical heuristics.
    """
    text_lower = directive_text.lower()
    subtypes_created = {n["subtype"] for n in audit.get("nodes_created", [])}
    edges_created = audit.get("edges_created", [])
    edge_types = {e["type"] for e in edges_created}

    # Thesis-related directives
    if any(w in text_lower for w in ("thesis", "conviction", "market view")):
        return "custom:thesis" in subtypes_created

    # Lesson-related directives
    if any(w in text_lower for w in ("lesson", "document what went")):
        return "custom:lesson" in subtypes_created

    # Watchpoint-related directives
    if any(w in text_lower for w in ("watchpoint", "alert", "monitor", "set price")):
        return "custom:watchpoint" in subtypes_created

    # Link-related directives
    if any(w in text_lower for w in ("link", "connect", "edge")):
        return len(edges_created) > 0

    # Generic store/save directives
    if any(w in text_lower for w in ("store", "save", "record", "document")):
        return len(audit.get("nodes_created", [])) > 0

    # Tool-based directives (can't verify from mutations alone)
    if any(w in text_lower for w in ("use your tools", "investigate", "check", "research")):
        return True  # Trust that the agent acted if tools were called

    return False


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
