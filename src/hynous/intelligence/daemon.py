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

import collections
import json
import logging
import math
import queue as _queue_module
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from ..core.config import Config
from ..core.daemon_log import log_event, DaemonEvent, flush as flush_daemon_log
from ..core.trading_settings import get_trading_settings

logger = logging.getLogger(__name__)

# Module-level reference so trading tools can check circuit breaker
_active_daemon: "Daemon | None" = None

# Memory subtypes worth alerting on when they fade ACTIVE → WEAK.
# Signals/watchpoints/episodes decay by design — only hard-won knowledge
# (lessons, theses, playbooks) is worth waking the agent to reinforce.
_FADING_ALERT_SUBTYPES: frozenset[str] = frozenset({
    "custom:lesson",
    "custom:thesis",
    "custom:playbook",
})

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


def _notify_discord_simple(message: str):
    """Send a plain-text trade notification to Discord (no header, no agent response)."""
    try:
        from ..discord.bot import notify_simple
        notify_simple(message)
    except Exception:
        pass


_TOOL_DISPLAY = {
    "get_market_data": "market data",
    "get_orderbook": "orderbook",
    "get_book_history": "book history",
    "get_funding_history": "funding",
    "get_liquidations": "liquidations",
    "get_multi_timeframe": "multi-TF",
    "get_global_sentiment": "sentiment",
    "get_options_flow": "options",
    "get_institutional_flow": "institutional",
    "get_account": "account",
    "get_my_costs": "costs",
    "get_trade_stats": "stats",
    "execute_trade": "trade",
    "close_position": "close",
    "modify_position": "modify",
    "monitor_signal": "monitor",
    "recall_memory": "memory",
    "store_memory": "memory",
    "update_memory": "memory",
    "delete_memory": "memory",
    "explore_memory": "explore",
    "manage_conflicts": "conflicts",
    "manage_clusters": "clusters",
    "manage_watchpoints": "watchpoints",
    "batch_prune": "memory",
    "analyze_memory": "memory",
    "search_web": "web search",
    "data_layer": "data layer",
}


def _format_tool_trace_text(tool_calls: list[dict]) -> str:
    """Format agent tool calls into a readable trace string for the dashboard."""
    lines = []
    for tc in tool_calls:
        name = tc.get("name", "")
        inp = tc.get("input", {}) or {}
        result = tc.get("result", "") or ""
        display = _TOOL_DISPLAY.get(name, name.replace("_", " "))
        parts = []
        if "symbol" in inp:
            parts.append(str(inp["symbol"]).upper())
        if "period" in inp:
            parts.append(str(inp["period"]))
        if "n" in inp:
            parts.append(f"n={inp['n']}")
        if "action" in inp:
            parts.append(str(inp["action"]))
        full_name = f"{display} · {' · '.join(parts)}" if parts else display
        # Skip header lines (end with ":") and separators — pick first prose line
        raw_line = next(
            (
                l.strip() for l in result.split("\n")
                if l.strip() and len(l.strip()) > 5
                and not l.strip().endswith(":")
                and not all(c in "-=| \t" for c in l.strip())
            ),
            "",
        )
        if raw_line:
            truncated = raw_line[:80]
            suffix = "..." if len(raw_line) > 80 else ""
            lines.append(f"⚡ {full_name}  →  {truncated}{suffix}")
        else:
            lines.append(f"⚡ {full_name}")
    return "\n".join(lines)


def _extract_decision(tool_calls: list[dict]) -> str:
    """Infer agent decision from which tools were called."""
    names = {tc.get("name") for tc in tool_calls}
    if "execute_trade" in names:
        return "trade"
    if "close_position" in names or "modify_position" in names:
        return "manage"
    if "monitor_signal" in names:
        return "monitor"
    return "pass"


def _queue_and_persist(wake_type: str, title: str, response: str, event_type: str = "", meta: dict | None = None):
    """Put wake message in dashboard queue AND persistent wake log.

    The in-memory queue gives instant UI updates when the dashboard is open.
    The persistent log ensures messages survive restarts and are available
    even if the dashboard wasn't open when the wake happened.
    """
    item = {"type": wake_type, "title": title, "response": response}
    if event_type:
        item["event_type"] = event_type
    if meta:
        item.update(meta)
    _daemon_chat_queue.put(item)
    try:
        from ..core.persistence import append_wake
        append_wake(wake_type, title, response, extra=meta or {})
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

        # Background threads for long-running Nous maintenance tasks.
        # These run off the main daemon loop so they cannot block
        # _fast_trigger_check() (SL/TP guard that must fire every 10 s).
        self._decay_thread: threading.Thread | None = None
        self._conflict_thread: threading.Thread | None = None
        self._backfill_thread: threading.Thread | None = None
        self._consolidation_thread: threading.Thread | None = None
        self._curiosity_thread: threading.Thread | None = None
        self._review_thread: threading.Thread | None = None
        self._labeler_thread: threading.Thread | None = None
        self._validation_thread: threading.Thread | None = None

        # Per-node cooldown for fading memory alerts (node_id → last alert timestamp).
        # Prevents the same WEAK node from triggering a wake on every 6h decay cycle.
        self._fading_alerted: dict[str, float] = {}

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
        self._last_consolidation: float = 0
        self._last_labeler_run: float = 0
        self._last_validation_run: float = 0
        self._latest_validation_results: list[dict] = []

        # Nous health state
        self._nous_healthy: bool = True

        # Data-change gate: watchpoints only checked when data is fresh
        self._data_changed: bool = False

        # Position tracking (fill detection)
        self._prev_positions: dict[str, dict] = {}    # coin → {side, size, entry_px}
        self._tracked_triggers: dict[str, list] = {}  # coin → trigger orders snapshot
        self._last_fill_check: float = 0
        self._last_candle_peak_check: float = 0     # Timestamp of last candle peak tracking run
        self._fill_fires: int = 0
        self._processed_fills: set[str] = set()       # Fill hashes already processed

        # Profit level tracking: {coin: {tier: last_alert_timestamp}}
        self._profit_alerts: dict[str, dict[str, float]] = {}
        self._profit_sides: dict[str, str] = {}  # coin → side (detect flips)
        self._peak_roe: dict[str, float] = {}     # coin → max ROE % seen during hold (MFE)
        self._trough_roe: dict[str, float] = {}   # coin → min ROE % seen during hold (MAE, negative = drawdown)
        self._current_roe: dict[str, float] = {}   # coin → latest computed ROE % (updated every 10s)
        self._breakeven_set: dict[str, bool] = {}  # coin → True once breakeven SL placed this hold
        self._capital_be_set: dict[str, bool] = {}  # coin → True once capital-breakeven SL placed this hold
        self._dynamic_sl_set: dict[str, bool] = {}   # True once dynamic protective SL placed
        self._small_wins_exited: dict[str, bool] = {}  # coin → True once small-wins exit fired
        self._small_wins_tp_placed: dict[str, bool] = {}  # coin → True once exchange TP order placed
        self._trailing_active: dict[str, bool] = {}   # coin → True once trail is engaged
        self._trailing_stop_px: dict[str, float] = {}  # coin → current trailing stop price level

        # Position type registry: {coin: {"type": "micro"|"macro", "entry_time": float}}
        # Populated by trading tool via register_position_type(), inferred on restart
        self._position_types: dict[str, dict] = {}

        # Volume delta tracking (24h rolling → 5m delta for volume_history parity)
        self._prev_day_volume: dict[str, float] = {}

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

        # Recent trade close history (in-memory, for briefing injection)
        # Deque of dicts: {coin, side, leverage, lev_return_pct, mfe_pct, close_type, closed_at}
        # Newest first, capped at 10. Populated by _handle_position_close + _record_trigger_close.
        self._recent_trade_closes: collections.deque = collections.deque(maxlen=10)

        # Pending follow-up watches: sym → {fire_at, thesis, side, scheduled_at}
        # Ephemeral — lost on restart. Use manage_watchpoints for persistent alerts.
        self._pending_watches: dict[str, dict] = {}

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
        from .regime import RegimeClassifier
        self._regime_classifier = RegimeClassifier()  # Persistent for hysteresis
        self._regime = None             # RegimeState or None
        self._prev_regime_label = ""    # For shift detection
        self._micro_safe = True         # Micro safety gate from regime

        # Market scanner (anomaly detection across all pairs)
        self._scanner = None
        self._playbook_matcher = None
        self._last_matched_playbooks: list = []  # For auto-linking after trade
        if config.scanner.enabled:
            from .scanner import MarketScanner
            self._scanner = MarketScanner(config.scanner)
            self._scanner.execution_symbols = set(config.execution.symbols)
            self._scanner._data_layer_enabled = config.data_layer.enabled
            # Playbook matcher (Issue 5: proactive procedural memory)
            from .playbook_matcher import PlaybookMatcher
            self._playbook_matcher = PlaybookMatcher(
                cache_ttl=config.daemon.playbook_cache_ttl,
            )

        # Satellite: ML feature engine (SPEC-03)
        self._satellite_store = None
        self._satellite_config = None
        self._satellite_dl_conn = None  # read-only conn to data-layer DB
        self._inference_engine = None              # NEW — unconditional
        self._kill_switch = None                   # NEW — unconditional
        self._latest_predictions: dict[str, dict] = {}  # NEW — unconditional
        self._latest_predictions_lock = threading.Lock()
        self._staged_entries: dict = {}  # directive_id → StagedEntry
        if config.satellite.enabled:
            try:
                from satellite.config import SatelliteConfig as SatCfg
                from satellite.store import SatelliteStore
                import sqlite3

                # Resolve relative paths against project root (not cwd,
                # since systemd WorkingDirectory may differ)
                root = config.project_root
                sat_db = str(root / config.satellite.db_path)
                dl_db = str(root / config.satellite.data_layer_db_path)

                # Map daemon's SatelliteConfig to satellite module's config
                self._satellite_config = SatCfg(
                    enabled=config.satellite.enabled,
                    db_path=sat_db,
                    data_layer_db_path=dl_db,
                    snapshot_interval=config.satellite.snapshot_interval,
                    coins=config.satellite.coins,
                    min_position_size_usd=config.satellite.min_position_size_usd,
                    liq_cascade_threshold=config.satellite.liq_cascade_threshold,
                    liq_cascade_min_usd=config.satellite.liq_cascade_min_usd,
                    store_raw_data=config.satellite.store_raw_data,
                    funding_settlement_hours=config.satellite.funding_settlement_hours,
                )
                self._satellite_store = SatelliteStore(sat_db)
                self._satellite_store.connect()

                # Read-only connection to data-layer DB for historical queries
                if Path(dl_db).exists():
                    self._satellite_dl_conn = sqlite3.connect(
                        dl_db, check_same_thread=False, timeout=5,
                    )
                    self._satellite_dl_conn.execute("PRAGMA busy_timeout=3000")
                    self._satellite_dl_conn.row_factory = sqlite3.Row

                logger.info("Satellite initialized: %s", sat_db)
            except Exception:
                logger.exception(
                    "Satellite initialization failed, continuing without ML",
                )
                self._satellite_store = None
                self._satellite_dl_conn = None

        # Load inference model (if satellite store init succeeded)
        if self._satellite_store:
            try:
                from satellite.training.artifact import ModelArtifact
                from satellite.inference import InferenceEngine
                from satellite.safety import KillSwitch

                # Find latest artifact version
                artifacts_dir = config.project_root / "satellite" / "artifacts"
                if artifacts_dir.exists():
                    versions = sorted(
                        [d for d in artifacts_dir.iterdir()
                         if d.is_dir() and d.name.startswith("v")],
                        key=lambda d: int(d.name.lstrip("v")),
                    )
                    if versions:
                        latest = versions[-1]
                        artifact = ModelArtifact.load(latest)

                        # Read threshold from config (with default)
                        threshold = getattr(
                            config.satellite, "inference_entry_threshold", 3.0
                        )
                        self._inference_engine = InferenceEngine(
                            artifact, entry_threshold=threshold,
                        )

                        # Kill switch — starts in shadow mode by default
                        self._kill_switch = KillSwitch(
                            self._satellite_config.safety,
                            store=self._satellite_store,
                        )

                        # Apply shadow mode from config
                        shadow_mode = getattr(
                            config.satellite, "inference_shadow_mode", True
                        )
                        self._kill_switch._cfg.shadow_mode = shadow_mode

                        logger.info(
                            "Satellite inference loaded: v%d (%d samples, threshold %.1f%%, shadow=%s)",
                            artifact.metadata.version,
                            artifact.metadata.training_samples,
                            threshold,
                            shadow_mode,
                        )
                    else:
                        logger.info("No model artifacts found in %s", artifacts_dir)
                else:
                    logger.info("Artifacts directory not found: %s", artifacts_dir)

            except Exception:
                logger.exception("Satellite inference init failed, continuing without ML")
                self._inference_engine = None
                self._kill_switch = None

        # Load condition models (if any exist)
        self._condition_engine = None
        if self._satellite_store:
            conditions_dir = config.project_root / "satellite" / "artifacts" / "conditions"
            if conditions_dir.exists() and any(conditions_dir.iterdir()):
                try:
                    from satellite.conditions import ConditionEngine
                    self._condition_engine = ConditionEngine(conditions_dir)
                    logger.info("Loaded %d condition models", self._condition_engine.model_count)
                except Exception:
                    logger.debug("Condition engine load failed", exc_info=True)

        # Init condition wake evaluator
        self._condition_evaluator = None
        if self._condition_engine:
            try:
                from satellite.condition_alerts import ConditionWakeEvaluator
                self._condition_evaluator = ConditionWakeEvaluator()
                logger.info("Condition wake evaluator initialized")
            except Exception:
                logger.debug("Condition wake evaluator init failed", exc_info=True)

        # Entry score feedback loop (Phase 3)
        self._entry_score_weights: dict[str, float] | None = None
        self._last_feedback_analysis: float = 0
        self._feedback_thread: threading.Thread | None = None
        _weights_path = config.project_root / "storage" / "entry_score_weights.json"
        if _weights_path.exists():
            try:
                self._entry_score_weights = json.loads(_weights_path.read_text())
                logger.info("Loaded entry score weights: %s", self._entry_score_weights)
            except Exception:
                logger.debug("Failed to load entry score weights", exc_info=True)

        # Tick-level microstructure feature engine (1s compute for direction prediction)
        self._tick_engine = None
        if self._satellite_store:
            try:
                from satellite.tick_features import TickFeatureEngine
                provider = self._get_provider()
                self._tick_engine = TickFeatureEngine(
                    provider=provider,
                    store=self._satellite_store,
                    coins=["BTC"],  # BTC only for now
                )
                logger.info("TickFeatureEngine initialized")
            except Exception:
                logger.debug("TickFeatureEngine init failed", exc_info=True)

        # Stats
        self.wake_count: int = 0
        self.watchpoint_fires: int = 0
        self.scanner_wakes: int = 0
        self.learning_sessions: int = 0
        self.decay_cycles_run: int = 0
        self.conflict_checks: int = 0
        self.health_checks: int = 0
        self.embedding_backfills: int = 0
        self.labeler_runs: int = 0
        self.snapshots_labeled_total: int = 0
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

    def enable_satellite(self) -> bool:
        """Enable satellite at runtime (persists to config YAML)."""
        if self._satellite_store is not None:
            return True  # already running
        try:
            from satellite.config import SatelliteConfig as SatCfg
            from satellite.store import SatelliteStore
            import sqlite3

            config = self.config
            root = config.project_root
            sat_db = str(root / config.satellite.db_path)
            dl_db = str(root / config.satellite.data_layer_db_path)

            self._satellite_config = SatCfg(
                enabled=True,
                db_path=sat_db,
                data_layer_db_path=dl_db,
                snapshot_interval=config.satellite.snapshot_interval,
                coins=config.satellite.coins,
                min_position_size_usd=config.satellite.min_position_size_usd,
                liq_cascade_threshold=config.satellite.liq_cascade_threshold,
                liq_cascade_min_usd=config.satellite.liq_cascade_min_usd,
                store_raw_data=config.satellite.store_raw_data,
                funding_settlement_hours=config.satellite.funding_settlement_hours,
            )
            self._satellite_store = SatelliteStore(sat_db)
            self._satellite_store.connect()

            if Path(dl_db).exists():
                self._satellite_dl_conn = sqlite3.connect(
                    dl_db, check_same_thread=False, timeout=5,
                )
                self._satellite_dl_conn.execute("PRAGMA busy_timeout=3000")
                self._satellite_dl_conn.row_factory = sqlite3.Row

            self._update_satellite_config(True)
            logger.info("Satellite enabled at runtime: %s", sat_db)
            return True
        except Exception:
            logger.exception("Failed to enable satellite at runtime")
            self._satellite_store = None
            self._satellite_dl_conn = None
            return False

    def disable_satellite(self) -> bool:
        """Disable satellite at runtime (persists to config YAML)."""
        if self._satellite_store is None:
            return True  # already off
        try:
            if self._satellite_dl_conn:
                self._satellite_dl_conn.close()
            if self._satellite_store and self._satellite_store._conn:
                self._satellite_store._conn.close()
        except Exception:
            pass
        self._satellite_store = None
        self._satellite_config = None
        self._satellite_dl_conn = None
        self._latest_predictions = {}
        self._condition_engine = None
        self._condition_evaluator = None
        self._update_satellite_config(False)
        logger.info("Satellite disabled at runtime")
        return True

    def _update_satellite_config(self, enabled: bool):
        """Persist satellite.enabled to config YAML."""
        try:
            config_path = self.config.project_root / "config" / "default.yaml"
            text = config_path.read_text()
            # Replace the enabled line under satellite section
            import re
            text = re.sub(
                r"(satellite:\s*\n\s*enabled:\s*)(\S+)",
                rf"\g<1>{'true' if enabled else 'false'}",
                text,
            )
            config_path.write_text(text)
        except Exception:
            logger.debug("Could not persist satellite config", exc_info=True)

    def _check_satellite_toggle(self):
        """Check for a toggle flag file written by the dashboard API."""
        try:
            flag = Path(str(self.config.project_root)) / "storage" / ".satellite_toggle"
            if not flag.exists():
                return
            action = flag.read_text().strip()
            flag.unlink()
            logger.info("Satellite toggle flag: %s", action)
            if action == "enable" and self._satellite_store is None:
                self.enable_satellite()
            elif action == "disable" and self._satellite_store is not None:
                self.disable_satellite()
        except Exception:
            logger.exception("Satellite toggle check failed")

    @property
    def satellite_enabled(self) -> bool:
        """Whether satellite is currently active."""
        return self._satellite_store is not None

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
        return self._peak_roe.get(coin, 0.0)

    def get_trough_roe(self, coin: str) -> float:
        """Get max adverse excursion (trough ROE %, negative = drawdown) tracked during hold."""
        return self._trough_roe.get(coin, 0.0)

    def is_trailing_active(self, coin: str) -> bool:
        """Check if trailing stop is currently active for a position."""
        return self._trailing_active.get(coin, False)

    def _build_wake_context(self, coin: str):
        """Build position-aware context for a coin."""
        from satellite.condition_alerts import WakeContext
        pos = self._prev_positions.get(coin)
        if pos:
            return WakeContext(
                coin=coin,
                is_positioned=True,
                position_side=pos.get("side"),
                position_roe=self._current_roe.get(coin),
                position_type=self._position_types.get(coin, {}).get("type"),
                peak_roe=self._peak_roe.get(coin),
                leverage=pos.get("leverage"),
            )
        return WakeContext(coin=coin, is_positioned=False)

    def _wake_for_conditions(self):
        """Evaluate ML conditions against thresholds and wake agent if triggered."""
        if not self._condition_evaluator or not self._satellite_config:
            return
        ts = get_trading_settings()
        if not ts.ml_condition_wakes:
            return

        contexts = {}
        conditions = {}
        for coin in self._satellite_config.coins:
            with self._latest_predictions_lock:
                pred = dict(self._latest_predictions.get(coin, {}))
            cond = pred.get("conditions")
            if cond:
                contexts[coin] = self._build_wake_context(coin)
                conditions[coin] = cond
        if not conditions:
            return

        alerts = self._condition_evaluator.evaluate(conditions, contexts, ts)
        if not alerts:
            return

        # Build message
        has_priority = any(a.priority for a in alerts)
        lines = ["[DAEMON WAKE — ML Condition Alert]", ""]
        for alert in alerts:
            ctx = contexts[alert.coin]
            msg = alert.message_positioned if ctx.is_positioned else alert.message_flat
            if not msg:
                continue  # suppressed alert slipped through (shouldn't happen)
            age_tag = f" (predicted {alert.prediction_age_s:.0f}s ago)"
            if alert.prediction_age_s > 240:
                age_tag += " — consider waiting for next tick"
            lines.append(f"{alert.coin}: {msg}{age_tag}")

        if len(lines) <= 2:  # only header + blank line, no actual alerts
            return

        lines.append("")
        lines.append("Briefing has full market data. Validate before acting.")

        message = "\n".join(lines)
        response = self._wake_agent(
            message, priority=has_priority,
            max_coach_cycles=0, max_tokens=1200,
            source="daemon:ml_conditions",
        )
        if response:
            title = alerts[0].headline
            log_event(DaemonEvent("ml_conditions", title,
                      f"{len(alerts)} condition alerts"))
            _queue_and_persist("ML Conditions", title, response,
                              event_type="ml_conditions")

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
        # WS market data feed status
        ws_health = None
        try:
            provider = self._get_provider()
            if hasattr(provider, "ws_health"):
                ws_health = provider.ws_health
            elif hasattr(provider, "_real") and hasattr(provider._real, "ws_health"):
                ws_health = provider._real.ws_health
        except Exception:
            pass

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
            "ws": ws_health or {
                "connected": False,
                "last_msg_age": None,
                "price_count": 0,
            },
            "labeler": {
                "runs": self.labeler_runs,
                "labeled_total": self.snapshots_labeled_total,
            },
            "validation": {
                "last_run": self._last_validation_run,
                "results_count": len(self._latest_validation_results),
            },
            "regime": {
                "label": self._regime.label if self._regime else "UNKNOWN",
                "score": round(self._regime.score, 2) if self._regime else 0,
                "macro_score": round(self._regime.macro_score, 2) if self._regime else 0,
                "micro_score": round(self._regime.micro_score, 2) if self._regime else 0,
                "bias": self._regime.bias if self._regime else "neutral",
                "structure": self._regime.structure_label if self._regime else "RANGING",
                "micro_safe": self._regime.micro_safe if self._regime else True,
                "session": self._regime.session if self._regime else "QUIET",
                "reversal": self._regime.reversal_flag if self._regime else False,
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
        try:
            self._loop_inner()
        except Exception as e:
            logger.error("FATAL: daemon loop crashed: %s", e, exc_info=True)
            self._running = False

    def _loop_inner(self):
        """Actual daemon loop (wrapped by _loop for crash protection)."""
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
        self._last_consolidation = time.time()
        self._last_labeler_run = time.time() - self.config.daemon.labeler_interval + 300  # First run after 5min warmup
        self._last_validation_run = time.time() - self.config.daemon.validation_interval + 3600  # First run after 1h warmup
        self._last_fill_check = time.time()
        self._last_phantom_check = time.time()
        # self._load_phantoms()  # DISABLED — phantom system removed
        self._load_daily_pnl()

        # Start WebSocket market data feed via provider
        if self.config.daemon.ws_price_feed:
            provider = self._get_provider()
            # Tracked coins: configured symbols + any currently open positions
            ws_coins = list(
                set(self.config.execution.symbols) | set(self._prev_positions.keys())
            )
            provider.start_ws(ws_coins)
            logger.warning("WS market data feed started via provider")

        # Start tick-level feature collection (1s compute, 5s DB write)
        if self._tick_engine:
            self._tick_engine.start()
            logger.warning("Tick feature engine started (1s compute)")

        while self._running:
            try:
                now = time.time()
                self._heartbeat = now

                # 0a. Check for satellite toggle flag from dashboard
                self._check_satellite_toggle()

                # 0. Daily reset check (circuit breaker)
                self._check_daily_reset()

                # 1. Price polling (default every 60s)
                if now - self.snapshot.last_price_poll >= self.config.daemon.price_poll_interval:
                    self._poll_prices()

                # 1a. Fast trigger check EVERY loop (10s) for open positions
                # SL/TP must fire promptly — can't wait 60s between checks.
                # Fetches fresh prices only for position symbols (1 cheap API call).
                self._fast_trigger_check()

                # 1a-bis. Candle-based peak tracking (every 60s) for open positions
                # Catches MFE/MAE extremes missed by 10s polling gaps.
                if (
                    self.config.daemon.candle_peak_tracking_enabled
                    and self._prev_positions
                    and now - self._last_candle_peak_check >= 60
                ):
                    try:
                        self._update_peaks_from_candles()
                    except Exception as e:
                        logger.debug("Candle peak tracking error: %s", e)
                    self._last_candle_peak_check = now

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
                        threading.Thread(
                            target=self._wake_for_watchpoint,
                            args=(wp,),
                            daemon=True,
                            name="hynous-wake-wp",
                        ).start()

                # 3b. Market scanner anomaly detection (runs after each data refresh)
                if self._scanner:
                    try:
                        # Update position awareness before detection
                        self._scanner.position_symbols = set(self._prev_positions.keys())
                        self._scanner.position_directions = {
                            sym: pos.get("side", "long")
                            for sym, pos in self._prev_positions.items()
                        }
                        self._scanner.peak_roe_data = {
                            coin: {
                                "peak_roe":    self._peak_roe.get(coin, 0.0),
                                "trough_roe":  self._trough_roe.get(coin, 0.0),
                                "current_roe": self._current_roe.get(coin, pos.get("return_pct", 0.0)),
                                "leverage":    pos.get("leverage", 20),
                                "trade_type":  self.get_position_type(coin)["type"],
                                "side":        pos.get("side", "long"),
                                "entry_px":    pos.get("entry_px", 0.0),
                            }
                            for coin, pos in self._prev_positions.items()
                        }
                        anomalies = self._scanner.detect()
                        if anomalies:
                            self._wake_for_scanner(anomalies)
                    except Exception as e:
                        logger.debug("Scanner detect failed: %s", e)

                # 4. Curiosity check (default every 15 min)
                # Runs in a background thread — includes LLM call (learning session),
                # cannot block _fast_trigger_check().
                if now - self._last_curiosity_check >= self.config.daemon.curiosity_check_interval:
                    self._last_curiosity_check = now
                    if self._curiosity_thread is None or not self._curiosity_thread.is_alive():
                        self._curiosity_thread = threading.Thread(
                            target=self._check_curiosity,
                            daemon=True,
                            name="hynous-curiosity",
                        )
                        self._curiosity_thread.start()
                    else:
                        logger.debug("Curiosity check still running — skipping interval")

                # 5. Periodic review (1h weekdays, 2h weekends)
                review_interval = self.config.daemon.periodic_interval
                if datetime.now(timezone.utc).weekday() >= 5:  # Sat=5, Sun=6
                    review_interval *= 2
                if now - self._last_review >= review_interval:
                    self._last_review = now
                    if self._review_thread is None or not self._review_thread.is_alive():
                        self._review_thread = threading.Thread(
                            target=self._wake_for_review,
                            daemon=True,
                            name="hynous-wake-review",
                        )
                        self._review_thread.start()
                    else:
                        logger.debug("Review wake still running — skipping interval")

                # 6. FSRS batch decay (default every 6 hours)
                # Runs in a background thread — can take seconds with thousands of
                # nodes, cannot block _fast_trigger_check().
                if now - self._last_decay_cycle >= self.config.daemon.decay_interval:
                    self._last_decay_cycle = now
                    if self._decay_thread is None or not self._decay_thread.is_alive():
                        self._decay_thread = threading.Thread(
                            target=self._run_decay_cycle,
                            daemon=True,
                            name="hynous-decay",
                        )
                        self._decay_thread.start()
                    else:
                        logger.debug("Decay cycle still running — skipping interval")

                # 7. Contradiction queue check (default every 30 min)
                # Runs in a background thread — may wake the agent, which involves
                # a full LLM call. Cannot block _fast_trigger_check().
                if now - self._last_conflict_check >= self.config.daemon.conflict_check_interval:
                    self._last_conflict_check = now
                    if self._conflict_thread is None or not self._conflict_thread.is_alive():
                        self._conflict_thread = threading.Thread(
                            target=self._check_conflicts,
                            daemon=True,
                            name="hynous-conflicts",
                        )
                        self._conflict_thread.start()
                    else:
                        logger.debug("Conflict check still running — skipping interval")

                # 7b. Phantom evaluation — DISABLED (removed from system)
                # if self._phantoms and now - self._last_phantom_check >= self.config.daemon.phantom_check_interval:
                #     self._last_phantom_check = now
                #     self._evaluate_phantoms()

                # 8. Nous health check (default every 1 hour)
                if now - self._last_health_check >= self.config.daemon.health_check_interval:
                    self._last_health_check = now
                    self._check_health()

                # 9. Embedding backfill (default every 12 hours)
                # Runs in a background thread — OpenAI calls per-node, slow at scale.
                if now - self._last_embedding_backfill >= self.config.daemon.embedding_backfill_interval:
                    self._last_embedding_backfill = now
                    if self._backfill_thread is None or not self._backfill_thread.is_alive():
                        self._backfill_thread = threading.Thread(
                            target=self._run_embedding_backfill,
                            daemon=True,
                            name="hynous-backfill",
                        )
                        self._backfill_thread.start()
                    else:
                        logger.debug("Embedding backfill still running — skipping interval")

                # 10. Consolidation — cross-episode generalization (default every 24 hours)
                # Runs in a background thread — includes LLM calls (Haiku),
                # cannot block _fast_trigger_check().
                if now - self._last_consolidation >= self.config.daemon.consolidation_interval:
                    self._last_consolidation = now
                    if self._consolidation_thread is None or not self._consolidation_thread.is_alive():
                        self._consolidation_thread = threading.Thread(
                            target=self._run_consolidation,
                            daemon=True,
                            name="hynous-consolidation",
                        )
                        self._consolidation_thread.start()
                    else:
                        logger.debug("Consolidation still running — skipping interval")

                # 11. Satellite labeling — outcome labels for ML validation (default every 1 hour)
                # Labels snapshots that are 4h+ old with ground-truth ROE outcomes.
                # Without this, condition model predictions cannot be validated.
                if (
                    self._satellite_store
                    and now - self._last_labeler_run >= self.config.daemon.labeler_interval
                ):
                    self._last_labeler_run = now
                    if self._labeler_thread is None or not self._labeler_thread.is_alive():
                        self._labeler_thread = threading.Thread(
                            target=self._run_labeler,
                            daemon=True,
                            name="hynous-labeler",
                        )
                        self._labeler_thread.start()
                    else:
                        logger.debug("Labeler still running — skipping interval")

                # 12. Condition model validation — daily live accuracy check
                if (
                    self._satellite_store
                    and self._condition_engine
                    and now - self._last_validation_run >= self.config.daemon.validation_interval
                ):
                    self._last_validation_run = now
                    if self._validation_thread is None or not self._validation_thread.is_alive():
                        self._validation_thread = threading.Thread(
                            target=self._run_validation,
                            daemon=True,
                            name="hynous-validation",
                        )
                        self._validation_thread.start()
                    else:
                        logger.debug("Validation still running — skipping interval")

                # 13. Entry score feedback — daily weight adjustment from trade outcomes
                if (
                    self._satellite_store
                    and now - self._last_feedback_analysis >= 86400  # 24 hours
                ):
                    self._last_feedback_analysis = now
                    if self._feedback_thread is None or not self._feedback_thread.is_alive():
                        self._feedback_thread = threading.Thread(
                            target=self._run_feedback_analysis,
                            daemon=True,
                            name="hynous-feedback",
                        )
                        self._feedback_thread.start()

            except Exception as e:
                log_event(DaemonEvent("error", "Loop error", str(e)))
                logger.error("Daemon loop error: %s", e)

            # 1s granularity — WS provides sub-second prices, trigger checks
            # need frequent evaluation for reliable mechanical exits at 20x leverage.
            # All other operations are timer-gated and unaffected by faster looping.
            time.sleep(1)

    # ================================================================
    # Tier 1: Data Polling (Zero Tokens)
    # ================================================================

    def _update_ws_coins(self):
        """Update WS feed subscriptions when tracked coins change.

        Called after new position entries are detected in _check_positions().
        Ensures L2 and asset context data streams for newly opened positions.
        """
        ws_coins = list(set(self.config.execution.symbols) | set(self._prev_positions.keys()))
        provider = self._get_provider()
        # Unwrap PaperProvider if needed to reach the real provider
        real = getattr(provider, "_real", provider)
        if hasattr(real, "_market_feed") and real._market_feed:
            real._market_feed.update_coins(ws_coins)

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

            # Quick phantom evaluation — DISABLED (removed from system)
            # if self._phantoms:
            #     self._evaluate_phantoms()
            #     self._last_phantom_check = time.time()
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

        # Record historical snapshots for ML feature computation (SPEC-01)
        try:
            self._record_historical_snapshots()
        except Exception as e:
            logger.debug("Historical snapshot recording failed: %s", e)

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

        # Compute regime classification (zero cost, uses cached data + 1h candles)
        try:
            candles_1h = self._fetch_regime_candles()
            fast_signals = self._fetch_fast_signals()
            self._regime = self._regime_classifier.classify(
                self.snapshot, self._data_cache, self._scanner,
                candles_1h=candles_1h,
                fast_signals=fast_signals,
            )
            self._micro_safe = self._regime.micro_safe
            # Track label changes for scanner shift detection
            new_label = self._regime.label
            if self._prev_regime_label and new_label != self._prev_regime_label:
                logger.info("Regime shift: %s -> %s (macro %.2f, micro %.2f)",
                            self._prev_regime_label, new_label,
                            self._regime.macro_score, self._regime.micro_score)
                if self._scanner:
                    self._scanner.regime_shifted(
                        self._prev_regime_label, new_label, self._regime.score,
                        micro_safe=self._regime.micro_safe,
                        reversal_detail=self._regime.reversal_detail,
                        micro_score=self._regime.micro_score,
                    )
            self._prev_regime_label = new_label
            # Feed micro_safe to scanner
            if self._scanner:
                self._scanner._micro_safe = self._regime.micro_safe
        except Exception as e:
            logger.debug("Regime computation failed: %s", e)

        self.snapshot.last_deriv_poll = time.time()
        self._data_changed = True
        self.polls += 1

        # Satellite: compute and store ML features (SPEC-03)
        if self._satellite_store:
            try:
                import satellite

                # Lightweight adapter so features.py can call db_adapter.conn.execute()
                class _DbAdapter:
                    def __init__(self, conn):
                        self.conn = conn

                dl_db = (
                    _DbAdapter(self._satellite_dl_conn)
                    if self._satellite_dl_conn else None
                )

                # Adapters wrapping data-layer HTTP client to match engine interfaces
                heatmap_adapter = None
                flow_adapter = None
                if self.config.data_layer.enabled:
                    try:
                        from ..data.providers.hynous_data import get_client
                        _dl_client = get_client()

                        class _HeatmapAdapter:
                            def get_heatmap(self, coin):
                                return _dl_client.heatmap(coin)

                        class _OrderFlowAdapter:
                            def get_order_flow(self, coin):
                                return _dl_client.order_flow(coin) or {"windows": {}, "total_trades": 0}

                        heatmap_adapter = _HeatmapAdapter()
                        flow_adapter = _OrderFlowAdapter()
                    except Exception as e:
                        logger.warning("Satellite adapter creation failed: %s", e)

                # Refresh snapshot fields from WS immediately before satellite tick.
                # _poll_derivatives() already used WS-first data at the start, but
                # the method takes time (Coinglass, data-layer push, etc.). Refreshing
                # from WS here minimizes staleness for ML features.
                if self._satellite_config:
                    provider = self._get_provider()
                    for coin in self._satellite_config.coins:
                        try:
                            ctx = provider.get_asset_context(coin)
                            if ctx:
                                price = self.snapshot.prices.get(coin, 0)
                                self.snapshot.funding[coin] = ctx["funding"]
                                self.snapshot.oi_usd[coin] = ctx["open_interest"] * price if price else self.snapshot.oi_usd.get(coin, 0)
                                self.snapshot.volume_usd[coin] = ctx["day_volume"]
                        except Exception:
                            pass  # stale snapshot is fine — next tick will be fresh

                # Fetch candles for satellite features (price_change_5m, realized_vol_1h)
                candles_map = {}
                for coin in self._satellite_config.coins:
                    try:
                        c5m, c1m = self._fetch_satellite_candles(coin)
                        candles_map[coin] = (c5m, c1m)
                    except Exception:
                        logger.debug("Candle fetch failed for %s", coin)

                satellite.tick(
                    snapshot=self.snapshot,
                    data_layer_db=dl_db,
                    heatmap_engine=heatmap_adapter,
                    order_flow_engine=flow_adapter,
                    store=self._satellite_store,
                    config=self._satellite_config,
                    candles_map=candles_map,  # NEW
                )

                # Run ML inference on fresh features
                try:
                    self._run_satellite_inference(
                        dl_db=dl_db,
                        heatmap_adapter=heatmap_adapter,
                        flow_adapter=flow_adapter,
                        candles_map=candles_map,
                    )
                except Exception:
                    logger.debug("Satellite inference failed", exc_info=True)

                # Evaluate ML conditions for active wakes
                # Runs in a background thread — includes LLM call,
                # cannot block _fast_trigger_check().
                try:
                    threading.Thread(
                        target=self._wake_for_conditions,
                        daemon=True,
                        name="hynous-wake-conditions",
                    ).start()
                except Exception:
                    logger.debug("Condition wake evaluation failed", exc_info=True)
            except Exception:
                logger.debug("Satellite tick failed", exc_info=True)

    def _record_historical_snapshots(self):
        """Write funding, OI, volume to historical tables for ML features.

        Called after every _poll_derivatives() (~300s interval).
        Uses data-layer HTTP client if available, otherwise no-op.
        """
        if not self.config.data_layer.enabled:
            return

        from ..data.providers.hynous_data import get_client
        client = get_client()
        if not client.is_available:
            return

        funding = {}
        oi = {}
        volume = {}

        for sym in self.config.execution.symbols:
            f = self.snapshot.funding.get(sym)
            if f is not None:
                funding[sym] = f
            o = self.snapshot.oi_usd.get(sym)
            if o is not None:
                oi[sym] = o
            # Compute 5m volume delta from consecutive dayNtlVlm readings.
            # dayNtlVlm is a cumulative counter that resets at 00:00 UTC.
            # This matches backfill semantics (5m bucket volume in volume_history).
            current_day_vol = self.snapshot.volume_usd.get(sym, 0)
            prev_day_vol = self._prev_day_volume.get(sym, 0)
            if prev_day_vol > 0 and current_day_vol >= prev_day_vol:
                volume[sym] = current_day_vol - prev_day_vol
            elif prev_day_vol > 0 and current_day_vol < prev_day_vol:
                # Cumulative counter decreased → midnight UTC reset. Skip this tick.
                pass
            # else: first reading after restart, skip (no baseline yet)
            self._prev_day_volume[sym] = current_day_vol

        if funding or oi or volume:
            client.record_historical(funding=funding, oi=oi, volume=volume)

    def _fetch_regime_candles(self) -> list[dict]:
        """Fetch 50 x 1h BTC candles for regime classification."""
        try:
            provider = self._get_provider()
            now_ms = int(time.time() * 1000)
            start_ms = now_ms - 50 * 3600 * 1000  # 50h lookback
            candles = provider.get_candles("BTC", "1h", start_ms, now_ms)
            if candles and len(candles) > 1:
                return candles[:-1]  # Drop forming candle
            return candles or []
        except Exception as e:
            logger.debug("Regime candle fetch failed: %s", e)
            return []

    def _run_satellite_inference(
        self,
        dl_db: object,
        heatmap_adapter: object | None,
        flow_adapter: object | None,
        candles_map: dict[str, tuple[list, list]] | None = None,
    ) -> None:
        """Run ML inference on all configured coins after satellite.tick().

        Stores predictions to satellite.db and caches them for briefing injection.
        Optionally wakes agent on strong signals (if not in shadow mode).
        """
        if not self._satellite_store:
            return

        has_inference = bool(self._inference_engine)

        import json
        import time as _time

        shadow = True
        signals = []

        # --- Direction inference (only if model exists) ---
        if has_inference:
            # Check kill switch
            if self._kill_switch and not self._kill_switch.is_active:
                logger.debug(
                    "Satellite inference skipped: kill switch active (%s)",
                    self._kill_switch.disable_reason,
                )
                has_inference = False

            # Check staleness
            if has_inference and self._kill_switch:
                self._kill_switch.check_staleness()
                if not self._kill_switch.is_active:
                    has_inference = False

            if has_inference:
                shadow = self._kill_switch.is_shadow if self._kill_switch else True
                for coin in self._satellite_config.coins:
                    try:
                        c5m, c1m = (candles_map or {}).get(coin, (None, None))
                        result = self._inference_engine.predict(
                            coin=coin,
                            snapshot=self.snapshot,
                            data_layer_db=dl_db,
                            heatmap_engine=heatmap_adapter,
                            order_flow_engine=flow_adapter,
                            explain=True,
                            candles_5m=c5m,
                            candles_1m=c1m,
                        )

                        # Build SHAP top 5 JSON for storage
                        shap_json = None
                        exp = (
                            result.explanation_long
                            if result.signal == "long"
                            else result.explanation_short
                        )
                        if exp is None:
                            exp = result.explanation_long  # fallback
                        if exp and exp.top_contributors:
                            shap_data = [
                                {"feature": name, "value": round(val, 4), "shap": round(shap_val, 4)}
                                for name, val, shap_val in exp.top_contributors[:5]
                            ]
                            shap_json = json.dumps(shap_data)

                        # Save prediction to DB
                        self._satellite_store.save_prediction(
                            predicted_at=_time.time(),
                            coin=coin,
                            model_version=self._inference_engine._artifact.metadata.version,
                            predicted_long_roe=result.predicted_long_roe,
                            predicted_short_roe=result.predicted_short_roe,
                            signal=result.signal,
                            entry_threshold=self._inference_engine.entry_threshold,
                            inference_time_ms=result.inference_time_ms,
                            snapshot_id=None,
                            shap_top5_json=shap_json,
                        )

                        # Update kill switch snapshot time
                        if self._kill_switch:
                            self._kill_switch.record_snapshot_time(_time.time())

                        # Cache for briefing injection
                        with self._latest_predictions_lock:
                            self._latest_predictions[coin] = {
                                "signal": result.signal,
                                "long_roe": result.predicted_long_roe,
                                "short_roe": result.predicted_short_roe,
                                "confidence": result.confidence,
                                "summary": result.summary,
                                "inference_time_ms": result.inference_time_ms,
                                "timestamp": _time.time(),
                                "shadow": shadow,
                            }

                        # Collect actionable signals for potential wake
                        if result.signal in ("long", "short"):
                            signals.append(result)

                        logger.debug(
                            "ML inference %s: %s (long=%.1f%%, short=%.1f%%, %.1fms)%s",
                            coin, result.signal,
                            result.predicted_long_roe, result.predicted_short_roe,
                            result.inference_time_ms,
                            " [shadow]" if shadow else "",
                        )

                    except Exception:
                        logger.debug("Inference failed for %s", coin, exc_info=True)

        # --- Condition predictions (always run, independent of direction model) ---
        if self._condition_engine and self._satellite_store:
            try:
                from satellite.features import FEATURE_NAMES as _FEAT_NAMES
                # Only predict for BTC — models are trained on BTC data only.
                # Applying BTC-calibrated percentiles to ETH/SOL produces misleading regimes.
                coin = "BTC"
                latest = self._satellite_store.get_latest_snapshot(coin)
                if latest:
                    features = {name: latest.get(name, 0.0) for name in _FEAT_NAMES}
                    conditions = self._condition_engine.predict(coin, features)
                    if conditions is None:
                        # Feature quality too low — clear cached predictions so
                        # trading tool sees ml_cond=None and blocks trading.
                        with self._latest_predictions_lock:
                            if coin in self._latest_predictions:
                                self._latest_predictions[coin].pop("conditions", None)
                                self._latest_predictions[coin].pop("conditions_text", None)
                        logger.warning("ML conditions unavailable for %s — features degraded", coin)
                    else:
                        with self._latest_predictions_lock:
                            if coin not in self._latest_predictions:
                                self._latest_predictions[coin] = {}
                            self._latest_predictions[coin]["conditions"] = conditions.to_dict()
                            self._latest_predictions[coin]["conditions_text"] = conditions.to_briefing_text()
                        # Persist for live validation
                        self._satellite_store.save_condition_predictions(
                            snapshot_id=latest["snapshot_id"],
                            coin=coin,
                            conditions=conditions,
                        )

                        # --- Compute composite entry score ---
                        try:
                            from satellite.entry_score import compute_entry_score, EntryScoreConfig

                            # Use feedback-adjusted weights if available
                            _score_cfg = EntryScoreConfig()
                            if self._entry_score_weights:
                                _score_cfg.weights = self._entry_score_weights

                            # Get direction model results for this coin (may be None)
                            _dir_pred = self._latest_predictions.get(coin, {})
                            _entry_score = compute_entry_score(
                                conditions=conditions.to_dict(),
                                direction_signal=_dir_pred.get("signal"),
                                direction_long_roe=_dir_pred.get("long_roe", 0),
                                direction_short_roe=_dir_pred.get("short_roe", 0),
                                config=_score_cfg,
                                coin=coin,
                            )
                            with self._latest_predictions_lock:
                                if coin in self._latest_predictions:
                                    self._latest_predictions[coin]["entry_score"] = _entry_score.score
                                    self._latest_predictions[coin]["entry_score_label"] = _entry_score.label
                                    self._latest_predictions[coin]["entry_score_components"] = _entry_score.components
                                    self._latest_predictions[coin]["entry_score_line"] = _entry_score.to_briefing_line()
                        except Exception:
                            logger.debug("Failed to compute entry score for %s", coin, exc_info=True)

                        logger.debug(
                            "Condition predictions for %s: %d models, %.1fms",
                            coin, len(conditions.predictions), conditions.inference_time_ms,
                        )
            except Exception:
                logger.debug("Condition prediction failed", exc_info=True)

        # Wake agent on strong signals (only if NOT in shadow mode)
        if signals and not shadow:
            # Only wake if no position already open in the signaled direction
            wake_signals = []
            for sig in signals:
                coin = sig.coin
                existing = self._prev_positions.get(coin)
                if existing:
                    # Already holding this coin — skip wake
                    # (agent will see signal in next regular briefing)
                    continue
                wake_signals.append(sig)

            if wake_signals:
                summary_parts = [s.summary for s in wake_signals[:3]]
                msg = (
                    "[ML Signal]\n"
                    + "\n".join(summary_parts)
                    + "\n\nModel detected actionable signal. Evaluate and decide."
                )
                threading.Thread(
                    target=self._wake_agent,
                    args=(msg,),
                    kwargs={"source": "daemon:ml_signal", "max_tokens": 1536, "max_coach_cycles": 0},
                    daemon=True,
                    name="hynous-wake-ml-signal",
                ).start()

    def _fetch_satellite_candles(self, coin: str) -> tuple[list[dict], list[dict]]:
        """Fetch 5m and 1m candles for satellite features.

        Tries WS candle cache first (zero API calls), falls back to REST.

        Returns:
            (candles_5m, candles_1m) — both sorted ascending by timestamp.
            Either list may be empty on failure.
        """
        provider = self._get_provider()
        now_ms = int(time.time() * 1000)
        candles_5m = []
        candles_1m = []

        # Try WS candle cache first (populated by MarketDataFeed)
        feed = self._get_ws_candle_feed()
        if feed:
            ws_5m = feed.get_candles(coin, "5m", count=15)  # 75 min
            ws_1m = feed.get_candles(coin, "1m", count=70)  # 70 min
            if ws_5m:
                candles_5m = ws_5m
            if ws_1m:
                candles_1m = ws_1m

        # REST fallback for anything not covered by WS
        if not candles_5m:
            try:
                start_5m = now_ms - 75 * 60 * 1000
                candles_5m = provider.get_candles(coin, "5m", start_5m, now_ms)
            except Exception:
                logger.debug("Failed to fetch 5m candles for %s", coin)

        if not candles_1m:
            try:
                start_1m = now_ms - 70 * 60 * 1000
                candles_1m = provider.get_candles(coin, "1m", start_1m, now_ms)
            except Exception:
                logger.debug("Failed to fetch 1m candles for %s", coin)

        return candles_5m, candles_1m

    def _fetch_fast_signals(self) -> dict | None:
        """Fetch real-time signals from data layer for regime classifier.

        Returns dict with CVD, whale, HLP signals — or None if unavailable.
        Graceful: never raises, never blocks classify().
        """
        if not self.config.data_layer.enabled:
            return None
        try:
            from ..data.providers.hynous_data import get_client
            client = get_client()
            if not client.is_available:
                return None

            signals = {}

            # CVD (order flow) — sub-second via WebSocket trade stream
            of = client.order_flow("BTC")
            if of and "windows" in of:
                for window_name, window_data in of["windows"].items():
                    cvd = window_data.get("cvd")
                    if cvd is not None:
                        signals[f"cvd_{window_name}"] = cvd

            # Whale bias — 30s-10min refresh
            wh = client.whales("BTC", top_n=20)
            if wh:
                if "net_usd" in wh:
                    signals["whale_net_usd"] = wh["net_usd"]
                total_long = wh.get("total_long_usd", 0)
                total_short = wh.get("total_short_usd", 0)
                total = total_long + total_short
                if total > 0:
                    signals["whale_long_pct"] = total_long / total * 100

            # HLP vault — 60s refresh
            hlp = client.hlp_positions()
            if hlp:
                for p in hlp.get("positions", []):
                    if p.get("coin") == "BTC":
                        signals["hlp_btc_side"] = p.get("side", "")
                        signals["hlp_btc_size_usd"] = p.get("size_usd", 0)
                        break

            return signals if signals else None
        except Exception as e:
            logger.debug("Fast signals fetch failed: %s", e)
            return None

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
            # Load trailing stop state (prevents SL degradation on restart)
            self._load_mechanical_state()
            # Load staged entry directives (filter expired on load)
            from .staged_entries import load_staged_entries
            _staged_path = self.config.project_root / "storage" / "staged_entries.json"
            self._staged_entries = load_staged_entries(_staged_path)

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
        if not hasattr(provider, "check_triggers") or (not self._prev_positions and not self._staged_entries):
            return

        try:
            # Fetch fresh prices only for symbols with open positions
            position_syms = list(self._prev_positions.keys())
            fresh_prices = {}
            all_mids = self._get_provider().get_all_prices()
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
                event["classification"] = self._override_sl_classification(
                    event["coin"], event["classification"],
                )
                self._update_daily_pnl(event["realized_pnl"])
                self._record_trigger_close(event)
                threading.Thread(
                    target=self._wake_for_fill,
                    args=(event["coin"], event["side"], event["entry_px"],
                          event["exit_px"], event["realized_pnl"],
                          event["classification"]),
                    daemon=True,
                    name="hynous-wake-fill",
                ).start()

            if events:
                for event in events:
                    self._position_types.pop(event["coin"], None)
                self._persist_position_types()
                # Immediately evict closed positions from cache using event data.
                # This guarantees stale positions are removed even if get_user_state() fails.
                # Also prevents Phase 3 from firing on already-closed positions
                # (the ROE loop's `if not pos: continue` guard reads _prev_positions).
                for event in events:
                    self._prev_positions.pop(event["coin"], None)
                # Clear trailing stop state for closed coins and persist immediately.
                # Without this, mechanical_state.json retains ghost data. A new same-coin
                # position opened before _check_profit_levels() runs (up to 60s away) would
                # inherit stale trailing_active=True and a wrong trail price on restart.
                _closed_coins = {event["coin"] for event in events}
                for _coin in _closed_coins:
                    self._trailing_active.pop(_coin, None)
                    self._trailing_stop_px.pop(_coin, None)
                    self._peak_roe.pop(_coin, None)
                    self._capital_be_set.pop(_coin, None)
                    self._breakeven_set.pop(_coin, None)
                    self._dynamic_sl_set.pop(_coin, None)
                self._persist_mechanical_state()
                # Try to get the full fresh state (also picks up any new positions)
                try:
                    state = provider.get_user_state()
                    positions = state.get("positions", [])
                    self._prev_positions = {
                        p["coin"]: {"side": p["side"], "size": p["size"], "entry_px": p["entry_px"], "leverage": p.get("leverage", 20)}
                        for p in positions
                    }
                except Exception as e:
                    logger.warning("get_user_state() failed after trigger close, using event-based eviction: %s", e)

            # Track peak ROE + current ROE on every check (not just every 60s)
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
                self._current_roe[sym] = roe_pct  # Always update — scanner uses this
                if roe_pct > self._peak_roe.get(sym, 0):
                    self._peak_roe[sym] = roe_pct
                if roe_pct < self._trough_roe.get(sym, 0):
                    self._trough_roe[sym] = roe_pct

                # Breakeven stop: dynamic protective SL + fee-BE protection system
                # ── Dynamic Protective SL (replaces capital-breakeven) ────────
                # Placed immediately on position detection. Vol-regime-calibrated
                # distance below entry. Fee-BE will tighten later if ROE rises.
                ts = get_trading_settings()
                if (
                    ts.dynamic_sl_enabled
                    and self.config.daemon.dynamic_sl_enabled
                    and not self._dynamic_sl_set.get(sym)
                    and not self._breakeven_set.get(sym)
                ):
                    try:
                        # ── Resolve vol regime (same pattern as trailing) ──
                        _vol_regime = "normal"
                        with self._latest_predictions_lock:
                            _pred = dict(self._latest_predictions.get("BTC", {}))
                        _cond = _pred.get("conditions", {})
                        if _cond:
                            _cond_ts = _cond.get("timestamp", 0)
                            if time.time() - _cond_ts < 330:
                                _vol_regime = _cond.get("vol_1h", {}).get("regime", "normal")

                        # ── Map regime → SL distance (ROE %) ──
                        _sl_map = {
                            "extreme": ts.dynamic_sl_extreme_vol,
                            "high":    ts.dynamic_sl_high_vol,
                            "normal":  ts.dynamic_sl_normal_vol,
                            "low":     ts.dynamic_sl_low_vol,
                        }
                        sl_roe = _sl_map.get(_vol_regime, ts.dynamic_sl_normal_vol)
                        sl_roe = max(sl_roe, ts.dynamic_sl_floor)
                        sl_roe = min(sl_roe, ts.dynamic_sl_cap)

                        # ── Convert to price ──
                        sl_price_pct = sl_roe / leverage / 100.0
                        if side == "long":
                            sl_px = entry_px * (1.0 - sl_price_pct)
                        else:
                            sl_px = entry_px * (1.0 + sl_price_pct)

                        # ── Check if existing SL is already tighter ──
                        existing_sl = None
                        for t in self._tracked_triggers.get(sym, []):
                            if t.get("order_type") == "stop_loss":
                                existing_sl = t
                                break

                        already_tighter = False
                        if existing_sl:
                            tpx = existing_sl.get("trigger_px", 0)
                            if side == "long" and tpx > 0:
                                already_tighter = tpx >= sl_px  # existing is closer to price
                            elif side == "short" and tpx > 0:
                                already_tighter = tpx <= sl_px

                        if already_tighter:
                            self._dynamic_sl_set[sym] = True
                            logger.debug(
                                "Dynamic SL skip: %s existing SL tighter (%.2f vs %.2f)",
                                sym, existing_sl.get("trigger_px", 0), sl_px,
                            )
                        else:
                            # ── Save old SL for rollback (Bug A pattern) ──
                            old_sl_oid = existing_sl.get("oid") if existing_sl else None
                            old_sl_px = existing_sl.get("trigger_px") if existing_sl else None

                            # ── Cancel existing SL ──
                            if old_sl_oid:
                                provider.cancel_order(sym, old_sl_oid)

                            # ── Place dynamic SL ──
                            result = provider.place_trigger_order(
                                symbol=sym,
                                is_buy=(side != "long"),
                                sz=pos.get("size", 0),
                                trigger_px=round(sl_px, 6),
                                tpsl="sl",
                            )
                            if result and result.get("status") == "trigger_placed":
                                self._refresh_trigger_cache()
                                self._dynamic_sl_set[sym] = True
                                logger.info(
                                    "Dynamic SL placed: %s %s | %.2f ROE%% (%s vol) | SL @ $%.4f",
                                    sym, side, sl_roe, _vol_regime, sl_px,
                                )
                            else:
                                # ── Rollback: restore old SL on failure ──
                                if old_sl_px and old_sl_oid:
                                    provider.place_trigger_order(
                                        symbol=sym,
                                        is_buy=(side != "long"),
                                        sz=pos.get("size", 0),
                                        trigger_px=old_sl_px,
                                        tpsl="sl",
                                    )
                                    self._refresh_trigger_cache()
                                logger.warning(
                                    "Dynamic SL FAILED: %s — rolled back to old SL", sym,
                                )
                    except Exception:
                        logger.exception("Dynamic SL error for %s", sym)

                # ── Layer 2: Fee-breakeven — tighten SL to cover fees ──────────
                # Activates when ROE covers round-trip fee. SL moves to entry + buffer.
                # Worst case: ~$0 net. This is the upgrade from capital-BE.
                if (
                    self.config.daemon.breakeven_stop_enabled
                    and not self._breakeven_set.get(sym)
                ):
                    fee_be_roe = get_trading_settings().taker_fee_pct * leverage
                    if roe_pct >= fee_be_roe:
                        type_info = self.get_position_type(sym)
                        trade_type = type_info["type"]
                        buffer_pct = (
                            self.config.daemon.breakeven_buffer_micro_pct
                            if trade_type == "micro"
                            else self.config.daemon.breakeven_buffer_macro_pct
                        ) / 100.0
                        is_long = (side == "long")
                        be_price = (
                            entry_px * (1 + buffer_pct) if is_long
                            else entry_px * (1 - buffer_pct)
                        )
                        # Check if existing SL is already adequate
                        triggers = self._tracked_triggers.get(sym, [])
                        has_good_sl = any(
                            t.get("order_type") == "stop_loss" and (
                                (is_long and t.get("trigger_px", 0) >= be_price) or
                                (not is_long and 0 < t.get("trigger_px", 0) <= be_price)
                            )
                            for t in triggers
                        )
                        if has_good_sl:
                            self._breakeven_set[sym] = True
                            self._dynamic_sl_set[sym] = True
                        else:
                            # Save old SL for rollback
                            old_sl_info = None
                            for t in triggers:
                                if t.get("order_type") == "stop_loss" and t.get("oid"):
                                    old_sl_info = (t["oid"], t.get("trigger_px"))
                                    break

                            try:
                                # Cancel existing SL before placing fee-breakeven
                                for t in triggers:
                                    if t.get("order_type") == "stop_loss" and t.get("oid"):
                                        self._get_provider().cancel_order(sym, t["oid"])
                                sz = pos.get("size", 0)
                                self._get_provider().place_trigger_order(
                                    symbol=sym,
                                    is_buy=(side != "long"),
                                    sz=sz,
                                    trigger_px=be_price,
                                    tpsl="sl",
                                )
                                self._refresh_trigger_cache()  # Fix Bug A: was missing
                                self._breakeven_set[sym] = True
                                # Also mark capital-BE as set (fee-BE is strictly tighter)
                                self._capital_be_set[sym] = True
                                self._dynamic_sl_set[sym] = True
                                type_label = f"{trade_type} {leverage}x"
                                logger.info(
                                    "Fee-breakeven SET: %s %s (%s) | SL @ $%,.2f | ROE %+.1f%% >= %.1f%%",
                                    sym, side, type_label, be_price, roe_pct, fee_be_roe,
                                )
                                log_event(DaemonEvent(
                                    "profit", f"fee_breakeven: {sym} {side}",
                                    f"SL @ ${be_price:,.2f} | ROE {roe_pct:+.1f}%",
                                ))
                            except Exception as be_err:
                                logger.warning("Fee-breakeven failed for %s: %s", sym, be_err)
                                # Rollback: restore old SL if placement failed
                                if old_sl_info:
                                    try:
                                        self._get_provider().place_trigger_order(
                                            symbol=sym,
                                            is_buy=(side != "long"),
                                            sz=pos.get("size", 0),
                                            trigger_px=old_sl_info[1],
                                            tpsl="sl",
                                        )
                                        self._refresh_trigger_cache()
                                    except Exception:
                                        logger.error(
                                            "CRITICAL: Failed to restore old SL for %s after fee-BE failure", sym,
                                        )

                # ── Trailing Stop: mechanical exit, no agent involvement ──────────
                # Activates once ROE exceeds threshold. Trails at configured
                # retracement from peak. Stop only moves up, never down.
                # Executes immediately — no wake, no LLM decision.
                if (
                    self.config.daemon.trailing_stop_enabled
                    and not self._small_wins_exited.get(sym)  # Don't trail if small wins already closed
                ):
                    ts = get_trading_settings()
                    if ts.trailing_stop_enabled:
                        peak = self._peak_roe.get(sym, 0)

                        # ── Resolve vol regime from ML conditions (BTC only, 5-min refresh) ──
                        # Falls back to "normal" for non-BTC coins or stale/missing predictions.
                        _vol_regime = "normal"
                        with self._latest_predictions_lock:
                            _pred = dict(self._latest_predictions.get("BTC", {}))
                        _cond = _pred.get("conditions", {})
                        if _cond:
                            _cond_ts = _cond.get("timestamp", 0)
                            if time.time() - _cond_ts < 330:  # Fresh within staleness threshold
                                _vol_regime = _cond.get("vol_1h", {}).get("regime", "normal")

                        # ── Vol-adaptive activation threshold ──
                        _activation_map = {
                            "extreme": ts.trail_activation_extreme,
                            "high": ts.trail_activation_high,
                            "normal": ts.trail_activation_normal,
                            "low": ts.trail_activation_low,
                        }
                        activation_roe = _activation_map.get(_vol_regime, ts.trail_activation_normal)
                        # Floor: never activate below fee-BE + minimum distance
                        fee_be_roe = ts.taker_fee_pct * leverage
                        activation_roe = max(activation_roe, fee_be_roe + 0.1)

                        # Phase 1: Check if trail should activate
                        if not self._trailing_active.get(sym) and roe_pct >= activation_roe:
                            self._trailing_active[sym] = True
                            self._persist_mechanical_state()
                            logger.info(
                                "Trailing stop ACTIVATED: %s %s | ROE %.1f%% >= %.1f%% threshold (vol=%s)",
                                sym, side, roe_pct, activation_roe, _vol_regime,
                            )

                        # Phase 2: Update trailing stop price (only if active)
                        if self._trailing_active.get(sym) and peak > 0:
                            # ── Continuous exponential retracement ──
                            # r(p) = floor + amplitude * exp(-k * p)
                            # Vol regime absorbed into k (no separate modifier).
                            _k_map = {
                                "extreme": ts.trail_ret_k_extreme,
                                "high": ts.trail_ret_k_high,
                                "normal": ts.trail_ret_k_normal,
                                "low": ts.trail_ret_k_low,
                            }
                            _k = _k_map.get(_vol_regime, ts.trail_ret_k_normal)
                            effective_retracement = ts.trail_ret_floor + ts.trail_ret_amplitude * math.exp(-_k * peak)

                            trail_roe = peak * (1.0 - effective_retracement)

                            # ── Floor: fee-BE + minimum distance ──
                            trail_floor = fee_be_roe + ts.trail_min_distance_above_fee_be
                            trail_roe = max(trail_roe, trail_floor)

                            # Convert trail ROE to price
                            trail_price_pct = trail_roe / leverage / 100.0
                            if side == "long":
                                new_trail_px = entry_px * (1 + trail_price_pct)
                            else:
                                new_trail_px = entry_px * (1 - trail_price_pct)

                            # Stop only moves UP (tighter) — never backwards
                            old_trail_px = self._trailing_stop_px.get(sym, 0)
                            if side == "long":
                                should_update = (new_trail_px > old_trail_px) if old_trail_px > 0 else True
                            else:
                                should_update = (new_trail_px < old_trail_px) if old_trail_px > 0 else True

                            if should_update:
                                # Update the paper provider's SL to match.
                                # NOTE: _trailing_stop_px is updated INSIDE the try block, only
                                # after successful placement. This prevents a silent state gap
                                # where the code believes a SL is placed when it is not.
                                #
                                # Bug A fix: save old SL before cancel so we can roll back if
                                # placement fails after cancel succeeds (position with NO SL).
                                triggers = self._tracked_triggers.get(sym, [])
                                old_sl_info = None
                                for t in triggers:
                                    if t.get("order_type") == "stop_loss" and t.get("oid"):
                                        old_sl_info = (t["oid"], t.get("trigger_px"))
                                        break
                                try:
                                    # Cancel existing SL first, then place new one
                                    for t in triggers:
                                        if t.get("order_type") == "stop_loss" and t.get("oid"):
                                            self._get_provider().cancel_order(sym, t["oid"])
                                    self._get_provider().place_trigger_order(
                                        symbol=sym,
                                        is_buy=(side != "long"),
                                        sz=pos.get("size", 0),
                                        trigger_px=new_trail_px,
                                        tpsl="sl",
                                    )
                                    # Refresh trigger cache so check_triggers sees the new SL
                                    self._refresh_trigger_cache()
                                    # Update in-memory state AFTER confirmed successful placement
                                    self._trailing_stop_px[sym] = new_trail_px
                                    self._persist_mechanical_state()
                                    if old_trail_px > 0:
                                        logger.info(
                                            "Trailing stop UPDATED: %s %s | $%,.2f → $%,.2f (peak ROE %.1f%%, trail ROE %.1f%%)",
                                            sym, side, old_trail_px, new_trail_px, peak, trail_roe,
                                        )
                                except Exception as trail_err:
                                    _err = str(trail_err).lower()
                                    if "no position" in _err or "no open position" in _err:
                                        # Position already closed — evict stale zombie state immediately
                                        # rather than waiting up to 60s for _check_positions() cleanup
                                        logger.warning(
                                            "Trailing stop update: position gone for %s, clearing zombie state",
                                            sym,
                                        )
                                        self._prev_positions.pop(sym, None)
                                        self._trailing_active.pop(sym, None)
                                        self._trailing_stop_px.pop(sym, None)
                                        self._peak_roe.pop(sym, None)
                                    else:
                                        logger.warning("Trailing stop update failed for %s: %s", sym, trail_err)
                                        # Rollback: re-place old SL if cancel succeeded before placement failed.
                                        # Without this, the position has ZERO stop-loss protection.
                                        if old_sl_info:
                                            try:
                                                self._get_provider().place_trigger_order(
                                                    symbol=sym,
                                                    is_buy=(side != "long"),
                                                    sz=pos.get("size", 0),
                                                    trigger_px=old_sl_info[1],
                                                    tpsl="sl",
                                                )
                                                self._refresh_trigger_cache()
                                            except Exception:
                                                logger.error(
                                                    "CRITICAL: Failed to restore old SL for %s after trail update failure",
                                                    sym,
                                                )

                        # Phase 3: Check if trailing stop is HIT
                        # This is a backup — paper provider's check_triggers() catches it too,
                        # but we want immediate execution + proper classification.
                        if self._trailing_active.get(sym):
                            trail_px = self._trailing_stop_px.get(sym)
                            if trail_px and trail_px > 0:
                                trail_hit = (
                                    (side == "long" and px <= trail_px) or
                                    (side == "short" and px >= trail_px)
                                )
                                if trail_hit:
                                    try:
                                        result = self._get_provider().market_close(sym)
                                        realized_pnl = result.get("closed_pnl", 0.0)
                                        exit_px_trail = result.get("avg_px", px)
                                        trail_roe_at_exit = roe_pct
                                        peak_at_exit = self._peak_roe.get(sym, 0)

                                        trail_msg = (
                                            f"[TRAILING STOP] {sym} {side.upper()} closed at {trail_roe_at_exit:+.1f}% ROE "
                                            f"(peak was {peak_at_exit:+.1f}%). Trail stop @ ${trail_px:,.2f} hit."
                                        )
                                        _queue_and_persist("System", f"Trailing Stop: {sym}", trail_msg)
                                        _notify_discord_simple(
                                            f"Trailing stop hit: {sym} {side.upper()} | "
                                            f"ROE {trail_roe_at_exit:+.1f}% (peak {peak_at_exit:+.1f}%) | "
                                            f"PnL ${realized_pnl:+.2f}"
                                        )
                                        log_event(DaemonEvent(
                                            "profit", f"trailing_stop: {sym} {side}",
                                            f"Exit ROE {trail_roe_at_exit:+.1f}% | Peak {peak_at_exit:+.1f}% | "
                                            f"PnL ${realized_pnl:+.2f}",
                                        ))
                                        self._update_daily_pnl(realized_pnl)
                                        self._record_trigger_close({
                                            "coin": sym, "side": side, "entry_px": entry_px,
                                            "exit_px": exit_px_trail, "realized_pnl": realized_pnl,
                                            "classification": "trailing_stop",
                                        })
                                        self._position_types.pop(sym, None)
                                        self._persist_position_types()
                                        self._prev_positions.pop(sym, None)
                                        self._trailing_active.pop(sym, None)
                                        self._trailing_stop_px.pop(sym, None)
                                        self._peak_roe.pop(sym, None)
                                        # Bug F fix: persist after Phase 3 closes the position.
                                        # Without this, the cleared trailing state is never written
                                        # to disk — a restart reloads it and re-fires Phase 3.
                                        self._persist_mechanical_state()
                                        try:
                                            self._get_provider().cancel_all_orders(sym)
                                        except Exception:
                                            pass
                                    except Exception as trail_close_err:
                                        _err = str(trail_close_err).lower()
                                        if "no open position" in _err or "no position" in _err:
                                            # Position already gone — evict zombie state immediately
                                            logger.warning(
                                                "Trailing stop close: position gone for %s, clearing zombie state",
                                                sym,
                                            )
                                            self._prev_positions.pop(sym, None)
                                            self._trailing_active.pop(sym, None)
                                            self._trailing_stop_px.pop(sym, None)
                                            self._peak_roe.pop(sym, None)
                                        else:
                                            logger.warning("Trailing stop close failed for %s: %s", sym, trail_close_err)

                # Small Wins Mode: mechanical exit at configured ROE target (no agent decision)
                ts = get_trading_settings()
                if ts.small_wins_mode and not self._small_wins_exited.get(sym):
                    fee_be_roe = ts.taker_fee_pct * leverage
                    # Floor: always require at least fee BE + 0.1% so we actually net a profit
                    exit_roe = max(ts.small_wins_roe_pct, fee_be_roe + 0.1)
                    if roe_pct >= exit_roe:
                        try:
                            result = self._get_provider().market_close(sym)
                            self._small_wins_exited[sym] = True
                            exit_px_sw = result.get("avg_px", px)
                            realized_pnl_sw = result.get("closed_pnl", 0.0)
                            net_roe = roe_pct - fee_be_roe
                            type_info = self.get_position_type(sym)
                            trade_type = type_info["type"]
                            type_label = f"{trade_type} {leverage}x"
                            sw_msg = (
                                f"[SMALL WINS] {sym} {side.upper()} closed at {roe_pct:+.1f}% ROE "
                                f"({type_label}). Fee break-even: {fee_be_roe:.1f}% → "
                                f"net after fees: ~{net_roe:+.1f}% ROE. "
                                f"Small Wins Mode locked in profit automatically."
                            )
                            _queue_and_persist("System", f"Small Wins Exit: {sym}", sw_msg)
                            _notify_discord_simple(
                                f"Exited {sym} {side} [Small Wins] — "
                                f"+${abs(realized_pnl_sw):.2f} · ROE {roe_pct:+.1f}% "
                                f"(net ~{net_roe:+.1f}%)"
                            )
                            log_event(DaemonEvent(
                                "profit", f"small_wins_exit: {sym} {side}",
                                f"Exit @ ROE {roe_pct:+.1f}% | fee BE {fee_be_roe:.1f}% "
                                f"| net ~{net_roe:+.1f}% | {type_label}",
                            ))
                            # Update daily PnL circuit breaker
                            self._update_daily_pnl(realized_pnl_sw)
                            # Record in Nous journal (same path as SL/TP closes)
                            self._record_trigger_close({
                                "coin": sym, "side": side, "entry_px": entry_px,
                                "exit_px": exit_px_sw, "realized_pnl": realized_pnl_sw,
                                "classification": "small_wins",
                            })
                            self._position_types.pop(sym, None)
                            self._persist_position_types()
                            # Remove from snapshot so _check_positions doesn't re-detect
                            # this close and send a duplicate WIN/LOSS Discord message
                            self._prev_positions.pop(sym, None)
                            # Cancel any remaining orders so TP/SL don't linger on closed position
                            try:
                                self._get_provider().cancel_all_orders(sym)
                            except Exception:
                                pass
                        except Exception as sw_err:
                            logger.warning("Small wins exit failed for %s: %s", sym, sw_err)

        except Exception as e:
            logger.debug("Fast trigger check failed: %s", e)

        # ── Staged entry evaluation ──
        if self._staged_entries:
            try:
                _se_prices = self._get_provider().get_all_prices()
                self._evaluate_staged_entries(_se_prices)
            except Exception as _se_err:
                logger.debug("Staged entry evaluation failed: %s", _se_err)

        self._check_pending_watches()

    def _evaluate_staged_entries(self, prices: dict[str, float]) -> None:
        """Evaluate staged entry directives against live WS prices.

        Called every ~1s from _fast_trigger_check(). Executes entries
        mechanically when price trigger + composite score are both satisfied.
        """
        from .staged_entries import evaluate_trigger, persist_staged_entries

        now = time.time()
        to_remove = []
        ts = get_trading_settings()

        for did, entry in list(self._staged_entries.items()):
            # Check expiry
            if now >= entry.expires_at:
                entry.status = "expired"
                to_remove.append(did)
                logger.info("Staged entry expired: %s %s %s", entry.coin, entry.side, did)
                continue

            # Check price trigger
            price = prices.get(entry.coin)
            if not price:
                continue

            if not evaluate_trigger(entry, price):
                continue

            # Re-verify composite score at trigger time
            with self._latest_predictions_lock:
                _pred = dict(self._latest_predictions.get(entry.coin, {}))
            current_score = _pred.get("entry_score", 0)
            if current_score < entry.min_entry_score:
                # Don't cancel — score may recover. Just skip this tick.
                continue

            # Re-verify safety gates
            if self._trading_paused:
                continue
            if entry.coin.upper() in self._prev_positions:
                entry.status = "cancelled"
                to_remove.append(did)
                logger.info("Staged entry cancelled (position exists): %s", did)
                continue
            if len(self._prev_positions) >= ts.max_open_positions:
                continue

            # EXECUTE
            self._execute_staged_entry(entry, price)
            to_remove.append(did)

        for did in to_remove:
            self._staged_entries.pop(did, None)

        if to_remove:
            _path = self.config.project_root / "storage" / "staged_entries.json"
            persist_staged_entries(self._staged_entries, _path)

    def _execute_staged_entry(self, entry, trigger_price: float) -> None:
        """Execute a staged entry via provider. Mechanical — no LLM."""
        try:
            provider = self._get_provider()
            ts = get_trading_settings()

            # Set leverage
            provider.update_leverage(entry.coin, entry.leverage)

            # Compute size from conviction (same formula as trading.py)
            try:
                state = provider.get_user_state()
                portfolio = state.get("account_value", 1000)
            except Exception:
                portfolio = 1000

            if entry.confidence >= 0.8:
                margin = portfolio * (ts.tier_high_margin_pct / 100)
            elif entry.confidence >= 0.6:
                margin = portfolio * (ts.tier_medium_margin_pct / 100)
            else:
                margin = portfolio * (ts.tier_speculative_margin_pct / 100)

            size_usd = margin * entry.leverage
            size_usd = min(size_usd, ts.max_position_usd)

            # Execute market order
            is_buy = entry.side == "long"
            result = provider.market_open(
                entry.coin, is_buy, size_usd,
                self._config.hyperliquid.default_slippage,
            )

            if result.get("status") != "filled" or not result.get("fillSz"):
                logger.warning("Staged entry fill failed: %s %s", entry.coin, result)
                return

            fill_px = float(result.get("avgPx", trigger_price))
            entry.status = "filled"
            entry.fill_price = fill_px
            entry.fill_time = time.time()

            # Place SL/TP triggers (same as trading tool)
            try:
                if entry.stop_loss:
                    provider.place_trigger_order(
                        symbol=entry.coin,
                        is_buy=not is_buy,
                        sz=float(result["fillSz"]),
                        trigger_px=entry.stop_loss,
                        tpsl="sl",
                    )
                if entry.take_profit:
                    provider.place_trigger_order(
                        symbol=entry.coin,
                        is_buy=not is_buy,
                        sz=float(result["fillSz"]),
                        trigger_px=entry.take_profit,
                        tpsl="tp",
                    )
            except Exception:
                logger.debug("Failed to place staged entry triggers", exc_info=True)

            # Record entry (same as daemon.record_trade_entry())
            self.record_trade_entry()
            self.register_position_type(entry.coin, entry.trade_type)

            # Store trade memory in background
            threading.Thread(
                target=self._store_staged_trade_memory,
                args=(entry, fill_px, size_usd),
                name="hynous-staged-memory",
                daemon=True,
            ).start()

            # Notify Discord
            _notify_discord_simple(
                f"STAGED ENTRY FILLED: {entry.coin} {entry.side.upper()} "
                f"@ ${fill_px:,.2f} ({entry.leverage}x) "
                f"| staged {(time.time() - entry.created_at) / 60:.1f}min ago"
            )

            logger.info(
                "Staged entry filled: %s %s @ %.2f (size=$%.0f, staged %.0fs ago)",
                entry.coin, entry.side, fill_px, size_usd,
                time.time() - entry.created_at,
            )

        except Exception:
            logger.exception("Staged entry execution failed: %s", entry.directive_id)

    def _store_staged_trade_memory(self, entry, fill_px: float, size_usd: float) -> None:
        """Store staged entry trade memory in Nous. Runs in background thread."""
        try:
            from .tools.trading import _store_to_nous

            is_buy = entry.side == "long"
            if is_buy:
                risk = fill_px - entry.stop_loss
                reward = entry.take_profit - fill_px
            else:
                risk = entry.stop_loss - fill_px
                reward = fill_px - entry.take_profit
            rr_val = round(reward / risk, 2) if risk > 0 else 0

            price_label = f"${fill_px:,.2f}" if fill_px >= 100 else f"${fill_px:,.4f}"
            content = (
                f"[STAGED ENTRY — Mechanical fill]\n"
                f"Thesis: {entry.reasoning}\n"
                f"Entry: {price_label} | Size: ~${size_usd:,.0f}\n"
                f"Stop Loss: ${entry.stop_loss:,.2f} | Take Profit: ${entry.take_profit:,.2f}"
            )
            if rr_val:
                content += f" | R:R: {rr_val}:1"

            summary = (
                f"{entry.side.upper()} {entry.coin} @ {price_label} [staged] | "
                f"SL ${entry.stop_loss:,.2f} | TP ${entry.take_profit:,.2f}"
            )

            signals = {
                "action": "entry",
                "side": entry.side,
                "symbol": entry.coin,
                "entry": fill_px,
                "stop": entry.stop_loss,
                "target": entry.take_profit,
                "size_usd": round(size_usd, 2),
                "confidence": entry.confidence,
                "staged": True,
                "directive_id": entry.directive_id,
                "trade_type": entry.trade_type,
            }
            if rr_val:
                signals["rr_ratio"] = rr_val

            _store_to_nous(
                subtype="custom:trade_entry",
                title=f"{entry.side.upper()} {entry.coin} @ {price_label} [staged]",
                content=content,
                summary=summary,
                signals=signals,
            )
        except Exception:
            logger.debug("Failed to store staged trade memory", exc_info=True)

    def _get_ws_candle_feed(self):
        """Get the MarketDataFeed instance from the provider, unwrapping Paper if needed.

        Returns None if WS feed is not available (WS disabled or not connected).
        """
        provider = self._get_provider()
        real = getattr(provider, "_real", provider)
        return getattr(real, "_market_feed", None)

    def _update_peaks_from_candles(self):
        """Enhance MFE/MAE with 1m candle high/low for open positions.

        Catches peaks/troughs missed between 1s price samples. 1m candles
        include the true intra-candle extreme. Called once per minute.
        Uses WS candle cache when available (zero API calls), falls back
        to REST (1 API call per position) if WS data is insufficient.
        """
        if not self._prev_positions:
            return

        provider = self._get_provider()
        now_ms = int(time.time() * 1000)
        # Fetch last 2 minutes of 1m candles — ensures we get the just-closed candle
        start_ms = now_ms - 2 * 60 * 1000

        # WS-first: try MarketDataFeed candle cache before REST.
        # Fetched once outside the loop — same feed instance for all coins.
        feed = self._get_ws_candle_feed()

        for sym, pos in self._prev_positions.items():
            entry_px = pos.get("entry_px", 0)
            leverage = pos.get("leverage", 20)
            side = pos.get("side", "long")
            if entry_px <= 0:
                continue

            candles = None

            # Try WS candle cache first (zero API calls)
            if feed:
                ws_candles = feed.get_candles(sym, "1m", count=2)
                if ws_candles:
                    candles = ws_candles

            # REST fallback if WS unavailable or insufficient data
            if not candles:
                try:
                    candles = provider.get_candles(sym, "1m", start_ms, now_ms)
                except Exception:
                    logger.debug("Candle peak tracking failed for %s", sym)
                    continue

            if not candles:
                continue

            for candle in candles:
                high = candle.get("h", 0)
                low = candle.get("l", 0)
                if high <= 0 or low <= 0:
                    continue

                # Compute ROE at candle high and low
                if side == "long":
                    best_roe = ((high - entry_px) / entry_px * 100) * leverage
                    worst_roe = ((low - entry_px) / entry_px * 100) * leverage
                else:
                    # Short profits when price drops (low), loses when price rises (high)
                    best_roe = ((entry_px - low) / entry_px * 100) * leverage
                    worst_roe = ((entry_px - high) / entry_px * 100) * leverage

                # Update peaks — only if candle extreme exceeds current record
                if best_roe > self._peak_roe.get(sym, 0):
                    old_peak = self._peak_roe.get(sym, 0)
                    self._peak_roe[sym] = best_roe
                    if best_roe - old_peak > 0.5:  # Only log significant corrections
                        logger.info(
                            "MFE corrected by candle: %s %s | %.1f%% → %.1f%% (+%.1f%%)",
                            sym, side, old_peak, best_roe, best_roe - old_peak,
                        )
                    # Bug E fix: persist when trailing is active — peak drives trail price.
                    # Without this, an updated peak (that would tighten the trail) is lost on
                    # restart, letting the trail fall back to a looser position.
                    if self._trailing_active.get(sym):
                        self._persist_mechanical_state()

                    # Re-evaluate capital-breakeven if candle shows threshold was crossed.
                    # A wick above the threshold (even sub-second) earns entry-price protection.
                    # Only capital-BE — fee-BE requires sustained price above threshold.
                    if (
                        self.config.daemon.capital_breakeven_enabled
                        and not self._capital_be_set.get(sym)
                        and not self._breakeven_set.get(sym)
                    ):
                        capital_threshold = self.config.daemon.capital_breakeven_roe
                        if best_roe >= capital_threshold:
                            is_long = (side == "long")
                            # Pure dict lookups — moved outside try so old_sl_info_candle
                            # can be saved before any cancel happens (mirrors _fast_trigger_check).
                            triggers_for_sym = self._tracked_triggers.get(sym, [])
                            has_tighter = any(
                                t.get("order_type") == "stop_loss" and (
                                    (is_long and t.get("trigger_px", 0) >= entry_px) or
                                    (not is_long and 0 < t.get("trigger_px", 0) <= entry_px)
                                )
                                for t in triggers_for_sym
                            )
                            if has_tighter:
                                self._capital_be_set[sym] = True
                            else:
                                # Save old SL for rollback — cancel can succeed before place
                                # fails, leaving position with NO stop-loss. Same pattern as
                                # _fast_trigger_check capital-BE block.
                                old_sl_info_candle = None
                                for t in triggers_for_sym:
                                    if t.get("order_type") == "stop_loss" and t.get("oid"):
                                        old_sl_info_candle = (t["oid"], t.get("trigger_px"))
                                        break
                                try:
                                    for t in triggers_for_sym:
                                        if t.get("order_type") == "stop_loss" and t.get("oid"):
                                            self._get_provider().cancel_order(sym, t["oid"])
                                    self._get_provider().place_trigger_order(
                                        symbol=sym,
                                        is_buy=(side != "long"),
                                        sz=self._prev_positions.get(sym, {}).get("size", 0),
                                        trigger_px=entry_px,
                                        tpsl="sl",
                                    )
                                    self._refresh_trigger_cache()
                                    self._capital_be_set[sym] = True
                                    logger.info(
                                        "Capital-BE from candle: %s %s | candle peak ROE %.1f%% >= %.1f%%",
                                        sym, side, best_roe, capital_threshold,
                                    )
                                except Exception as cbe_candle_err:
                                    logger.warning("Candle capital-BE failed for %s: %s", sym, cbe_candle_err)
                                    # Rollback: restore old SL if placement failed
                                    if old_sl_info_candle:
                                        try:
                                            self._get_provider().place_trigger_order(
                                                symbol=sym,
                                                is_buy=(side != "long"),
                                                sz=self._prev_positions.get(sym, {}).get("size", 0),
                                                trigger_px=old_sl_info_candle[1],
                                                tpsl="sl",
                                            )
                                            self._refresh_trigger_cache()
                                        except Exception:
                                            logger.error(
                                                "CRITICAL: Failed to restore old SL for %s after candle capital-BE failure", sym,
                                            )

                if worst_roe < self._trough_roe.get(sym, 0):
                    old_trough = self._trough_roe.get(sym, 0)
                    self._trough_roe[sym] = worst_roe
                    if old_trough - worst_roe > 0.5:
                        logger.info(
                            "MAE corrected by candle: %s %s | %.1f%% → %.1f%% (%.1f%%)",
                            sym, side, old_trough, worst_roe, worst_roe - old_trough,
                        )

    def _check_pending_watches(self) -> None:
        """Fire any monitor_signal follow-ups whose delay has elapsed.

        Each follow-up is launched in a background thread so the 10s fast-path
        loop (SL/TP guard) is never blocked by an LLM call.
        """
        if not self._pending_watches:
            return
        now = time.time()
        for sym in list(self._pending_watches):
            w = self._pending_watches[sym]
            if now >= w["fire_at"]:
                del self._pending_watches[sym]
                threading.Thread(
                    target=self._fire_watch_followup,
                    args=(sym, w),
                    daemon=True,
                    name=f"hynous-watch-{sym.lower()}",
                ).start()

    def _fire_watch_followup(self, sym: str, watch: dict) -> None:
        """Wake agent with fresh data for a scheduled monitor_signal follow-up."""
        elapsed = int(time.time() - watch["scheduled_at"])
        thesis = watch["thesis"]
        side_hint = f" (watching for {watch['side']} entry)" if watch.get("side") else ""

        price = self.snapshot.prices.get(sym, 0)
        price_str = f"${price:,.2f}" if price else "unknown"

        book_str = ""
        if self._scanner and len(self._scanner._books) > 0:
            snap = self._scanner._books.latest()
            if snap and sym in snap.books:
                b = snap.books[sym]
                bias = "bid-heavy" if b["imbalance"] > 0.55 else "ask-heavy" if b["imbalance"] < 0.45 else "balanced"
                book_str = (
                    f"Book now: bids ${b['bid_depth_usd']:,.0f} · "
                    f"asks ${b['ask_depth_usd']:,.0f} · imb {b['imbalance']:.2f} ({bias})\n"
                )

        msg = (
            f"[MONITOR FOLLOW-UP — {sym}{side_hint} — {elapsed}s elapsed]\n"
            f"Original thesis: {thesis}\n\n"
            f"Current price: {price_str}\n"
            f"{book_str}\n"
            f"VALIDATION — call in parallel: "
            f"[get_book_history {sym} n=5] + [get_market_data {sym} 1m]\n\n"
            f"Has your thesis developed as expected?\n"
            f"• If YES → call execute_trade (state conviction)\n"
            f"• If NO → state specifically what invalidated it and skip\n"
            f"• If STILL UNCERTAIN → call monitor_signal again (max 1 more watch)"
        )

        response = self._wake_agent(
            msg,
            source="daemon:monitor_followup",
            max_tokens=1024,
            max_coach_cycles=0,
            skip_memory=True,
        )
        # Snapshot immediately — another chat() call would reset _last_tool_calls
        last_tool_calls = list(self.agent._last_tool_calls)
        if response:
            logger.info("Monitor follow-up completed for %s", sym)
            monitor_meta = {
                "tool_trace_text": _format_tool_trace_text(last_tool_calls),
                "decision": _extract_decision(last_tool_calls),
                "signal_header": f"monitor · {sym}",
            }
            _queue_and_persist("Monitor", f"Follow-up: {sym}", response, event_type="scanner", meta=monitor_meta)

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
                    event["classification"] = self._override_sl_classification(
                        event["coin"], event["classification"],
                    )
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
                    new_positions = {
                        p["coin"]: {"side": p["side"], "size": p["size"], "entry_px": p["entry_px"], "leverage": p.get("leverage", 20)}
                        for p in positions
                    }
                    # Entry detection in paper path — fires even when a close happened in the same cycle
                    has_new_entries = False
                    for coin, curr_data in new_positions.items():
                        if coin not in self._prev_positions:
                            has_new_entries = True
                            c_side = curr_data.get("side", "long")
                            c_lev = int(curr_data.get("leverage", 0))
                            c_entry = curr_data.get("entry_px", 0)
                            msg = f"Entered {coin} {c_side}"
                            if c_lev:
                                msg += f" ({c_lev}x)"
                            if c_entry:
                                msg += f" @ ${c_entry:,.0f}"
                            _notify_discord_simple(msg)
                    self._prev_positions = new_positions
                    if has_new_entries:
                        self._refresh_trigger_cache()
                        self._update_ws_coins()
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

            # Detect new positions (entries) and send clean Discord notification
            has_new_entries = False
            for coin, curr_data in current.items():
                if coin not in self._prev_positions:
                    has_new_entries = True
                    c_side = curr_data.get("side", "long")
                    c_lev = int(curr_data.get("leverage", 0))
                    c_entry = curr_data.get("entry_px", 0)
                    msg = f"Entered {coin} {c_side}"
                    if c_lev:
                        msg += f" ({c_lev}x)"
                    if c_entry:
                        msg += f" @ ${c_entry:,.0f}"
                    _notify_discord_simple(msg)

            # Update snapshot
            self._prev_positions = current
            if has_new_entries:
                self._refresh_trigger_cache()
                self._update_ws_coins()
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
        classification = self._override_sl_classification(coin, classification)

        # Update daily PnL for circuit breaker
        self._update_daily_pnl(realized_pnl)

        # Record to Nous (auto-triggered closes aren't written by agent)
        if classification in ("stop_loss", "take_profit", "liquidation", "trailing_stop", "breakeven_stop", "capital_breakeven_stop", "dynamic_protective_sl"):
            self._record_trigger_close({
                "coin": coin, "side": side, "entry_px": entry_px,
                "exit_px": exit_px, "realized_pnl": realized_pnl,
                "classification": classification,
                "mae_pct": self._trough_roe.get(coin, 0.0),
            })

        # Wake the agent with the appropriate message
        self._wake_for_fill(coin, side, entry_px, exit_px, realized_pnl, classification)

        # Cache close for briefing Recent Trades — for ALL close types (not just trigger closes)
        peak_roe = self._peak_roe.get(coin, 0.0)
        pos_leverage = prev_data.get("leverage", 20)
        pos_size = prev_data.get("size", 0)
        if entry_px > 0 and pos_size > 0:
            margin_used = pos_size * entry_px / pos_leverage if pos_leverage > 0 else 0
            lev_ret = round(realized_pnl / margin_used * 100, 1) if margin_used > 0 else 0
        else:
            lev_ret = 0
        self._recent_trade_closes.appendleft({
            "coin": coin,
            "side": side,
            "leverage": pos_leverage,
            "lev_return_pct": lev_ret,
            "mfe_pct": round(peak_roe, 1),
            "close_type": classification,
            "closed_at": time.time(),
        })

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

            # Get peak ROE (MFE) and trough ROE (MAE) before they're cleaned up.
            # _handle_position_close passes mae_pct in event dict so it's captured
            # before _trough_roe is cleaned up; fall back to dict for trigger closes.
            mfe_pct = self._peak_roe.get(coin, 0.0)
            mae_pct = event.get("mae_pct", self._trough_roe.get(coin, 0.0))
            trade_type = type_info.get("type", "macro")

            # Derive position sizing from cached state (for ROE + fee analytics)
            pos_meta = self._prev_positions.get(coin, {})
            leverage = int(pos_meta.get("leverage", type_info.get("leverage", 0)))
            size = float(pos_meta.get("size", 0))
            size_usd = round(size * entry_px, 2) if size > 0 and entry_px > 0 else 0.0
            margin_used = round(size_usd / leverage, 2) if leverage > 0 else 0.0
            lev_return_pct = round(pnl / margin_used * 100, 2) if margin_used > 0 else 0.0
            _taker = 0.00035
            fee_estimate = round((size * entry_px + size * exit_px) * _taker, 4) if size > 0 else 0.0
            pnl_gross = round(pnl + fee_estimate, 4)
            is_fee_loss = bool(pnl_gross > 0 and pnl <= 0)
            is_fee_heavy = bool(pnl_gross > 0 and fee_estimate / pnl_gross > 0.5)
            mfe_usd = round(mfe_pct / 100 * margin_used, 2) if margin_used > 0 else 0.0
            mae_usd = round(mae_pct / 100 * margin_used, 2) if margin_used > 0 else 0.0

            signals = {
                "action": "close",
                "side": side,
                "symbol": coin,
                "entry": entry_px,
                "exit": exit_px,
                "pnl_usd": round(pnl, 4),
                "pnl_pct": round(pnl_pct, 2),
                "lev_return_pct": lev_return_pct,
                "close_type": classification,
                "opened_at": opened_at,
                "mfe_pct": round(mfe_pct, 2),
                "mae_pct": round(mae_pct, 2),
                "mfe_usd": mfe_usd,
                "mae_usd": mae_usd,
                "trade_type": trade_type,
                "size_usd": size_usd,
                "margin_used": margin_used,
                "leverage": leverage,
                "fee_estimate": fee_estimate,
                "pnl_gross": pnl_gross,
                "fee_loss": is_fee_loss,
                "fee_heavy": is_fee_heavy,
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

            # Cache for briefing Recent Trades section
            self._recent_trade_closes.appendleft({
                "coin": coin,
                "side": side,
                "leverage": leverage,
                "lev_return_pct": lev_return_pct,
                "mfe_pct": round(mfe_pct, 1),
                "close_type": classification,
                "closed_at": time.time(),
            })
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
                    return t.get("order_type", "manual").replace("_", " ")

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

    def _override_sl_classification(self, coin: str, classification: str) -> str:
        """Refine 'stop_loss' to 'trailing_stop' or 'breakeven_stop' using daemon state.

        check_triggers() and _classify_fill() only know about generic stop_loss.
        The daemon tracks which positions have trailing/breakeven stops active,
        so we can give a more specific classification for analytics.
        """
        if classification != "stop_loss":
            return classification
        # Bug G fix: require both _trailing_active AND _trailing_stop_px to confirm "trailing_stop".
        # _trailing_active is set in Phase 1 (activation), but _trailing_stop_px is only set in
        # Phase 2 (after successful SL placement). If Phase 2 failed, the trail SL was never placed
        # and classifying as "trailing_stop" would be wrong — fall through to breakeven checks.
        if self._trailing_active.get(coin) and self._trailing_stop_px.get(coin): return "trailing_stop"
        if self._breakeven_set.get(coin):
            return "breakeven_stop"
        if self._dynamic_sl_set.get(coin) and not self._breakeven_set.get(coin):
            return "dynamic_protective_sl"
        return classification

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

                # Track MFE (peak) and MAE (trough) for each position.
                if roe_pct > self._peak_roe.get(coin, 0):
                    self._peak_roe[coin] = roe_pct
                if roe_pct < self._trough_roe.get(coin, 0):
                    self._trough_roe[coin] = roe_pct

                # ── Small Wins: place exchange-side TP order once per hold ──────────
                # Polling can miss spikes that reverse within the 10s window. Placing
                # a TP trigger order on Hyperliquid fills the instant price touches the
                # target, with zero polling lag — same approach as breakeven stop.
                # The polling fallback below still runs as a backup.
                if (
                    not self._small_wins_exited.get(coin)
                    and not self._small_wins_tp_placed.get(coin)
                ):
                    ts_tp = get_trading_settings()
                    if ts_tp.small_wins_mode:
                        fee_be_tp = ts_tp.taker_fee_pct * leverage
                        exit_roe_tp = max(ts_tp.small_wins_roe_pct, fee_be_tp + 0.1)
                        # TP price: convert ROE target → price move → absolute price
                        price_move_pct = exit_roe_tp / leverage / 100
                        if side == "long":
                            sw_tp_px = entry_px * (1 + price_move_pct)
                        else:
                            sw_tp_px = entry_px * (1 - price_move_pct)
                        sz = p.get("size", 0)
                        if sz > 0 and sw_tp_px > 0:
                            try:
                                self._get_provider().place_trigger_order(
                                    symbol=coin,
                                    is_buy=(side != "long"),
                                    sz=sz,
                                    trigger_px=round(sw_tp_px, 6),
                                    tpsl="tp",
                                )
                                self._small_wins_tp_placed[coin] = True
                                logger.info(
                                    "Small Wins TP order placed: %s %s @ %.4f (ROE %.1f%% target)",
                                    coin, side, sw_tp_px, exit_roe_tp,
                                )
                            except Exception as tp_err:
                                logger.warning("Small Wins TP order failed for %s: %s — polling fallback active", coin, tp_err)

                # ── Small Wins polling fallback (fires on CURRENT roe_pct every 60s) ─
                # Handles cases where TP order placement failed or was cancelled.
                if not self._small_wins_exited.get(coin):
                    ts_sw = get_trading_settings()
                    if ts_sw.small_wins_mode:
                        fee_be_roe_sw = ts_sw.taker_fee_pct * leverage
                        exit_roe_sw = max(ts_sw.small_wins_roe_pct, fee_be_roe_sw + 0.1)
                        if roe_pct >= exit_roe_sw:
                            try:
                                result_sw = self._get_provider().market_close(coin)
                                self._small_wins_exited[coin] = True
                                exit_px_sw = result_sw.get("avg_px", mark_px)
                                realized_pnl_sw = result_sw.get("closed_pnl", 0.0)
                                net_roe_sw = roe_pct - fee_be_roe_sw
                                type_info_sw = self.get_position_type(coin)
                                trade_type_sw = type_info_sw["type"]
                                type_label_sw = f"{trade_type_sw} {leverage}x"
                                sw_msg = (
                                    f"[SMALL WINS] {coin} {side.upper()} closed at {roe_pct:+.1f}% ROE "
                                    f"({type_label_sw}). Fee break-even: {fee_be_roe_sw:.1f}% → "
                                    f"net after fees: ~{net_roe_sw:+.1f}% ROE. "
                                    f"Small Wins Mode locked in profit automatically."
                                )
                                _queue_and_persist("System", f"Small Wins Exit: {coin}", sw_msg)
                                _notify_discord_simple(
                                    f"Exited {coin} {side} [Small Wins] — "
                                    f"+${abs(realized_pnl_sw):.2f} · ROE {roe_pct:+.1f}% "
                                    f"(net ~{net_roe_sw:+.1f}%)"
                                )
                                log_event(DaemonEvent(
                                    "profit", f"small_wins_exit: {coin} {side}",
                                    f"Exit @ ROE {roe_pct:+.1f}% | fee BE {fee_be_roe_sw:.1f}% "
                                    f"| net ~{net_roe_sw:+.1f}% | {type_label_sw}",
                                ))
                                self._update_daily_pnl(realized_pnl_sw)
                                self._record_trigger_close({
                                    "coin": coin, "side": side, "entry_px": entry_px,
                                    "exit_px": exit_px_sw, "realized_pnl": realized_pnl_sw,
                                    "classification": "small_wins",
                                })
                                self._position_types.pop(coin, None)
                                self._persist_position_types()
                                # Remove from snapshot so _check_positions doesn't re-detect
                                # this close and send a duplicate WIN/LOSS Discord message
                                self._prev_positions.pop(coin, None)
                                try:
                                    self._get_provider().cancel_all_orders(coin)
                                except Exception:
                                    pass
                                continue  # Position closed — skip profit alerts
                            except Exception as sw_err:
                                logger.warning("Small wins exit failed for %s: %s", coin, sw_err)

                # Reset alerts if position side flipped (close long → open short)
                prev_side = self._profit_sides.get(coin)
                if prev_side and prev_side != side:
                    self._profit_alerts.pop(coin, None)
                    self._breakeven_set.pop(coin, None)         # New position — re-evaluate breakeven
                    self._capital_be_set.pop(coin, None)        # New position — re-evaluate capital-BE
                    self._dynamic_sl_set.pop(coin, None)        # New position — re-evaluate dynamic SL
                    self._small_wins_exited.pop(coin, None)    # New hold — re-arm small wins
                    self._small_wins_tp_placed.pop(coin, None) # New hold — re-arm TP order
                    self._peak_roe.pop(coin, None)             # New hold — reset MFE
                    self._trough_roe.pop(coin, None)           # New hold — reset MAE
                    self._trailing_active.pop(coin, None)      # New hold — re-arm trailing
                    self._trailing_stop_px.pop(coin, None)     # New hold — clear trail price
                    # Bug C fix: persist after side-flip trailing state cleanup so the cleared
                    # state reaches disk. Without this, a daemon restart loads stale trail state
                    # onto the new (opposite-side) position and Phase 3 fires immediately.
                    self._persist_mechanical_state()
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
                reversion_threshold = (
                    self.config.daemon.peak_reversion_threshold_micro if trade_type == "micro"
                    else self.config.daemon.peak_reversion_threshold_macro
                )
                if peak >= nudge and roe_pct < peak * (1.0 - reversion_threshold):
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
            for coin in list(self._current_roe):
                if coin not in open_coins:
                    del self._current_roe[coin]
            for coin in list(self._breakeven_set):
                if coin not in open_coins:
                    del self._breakeven_set[coin]
            for coin in list(self._capital_be_set):
                if coin not in open_coins:
                    del self._capital_be_set[coin]
            for coin in list(self._dynamic_sl_set):
                if coin not in open_coins:
                    del self._dynamic_sl_set[coin]
            for coin in list(self._small_wins_exited):
                if coin not in open_coins:
                    del self._small_wins_exited[coin]
            for coin in list(self._small_wins_tp_placed):
                if coin not in open_coins:
                    del self._small_wins_tp_placed[coin]
            for coin in list(self._trough_roe):
                if coin not in open_coins:
                    del self._trough_roe[coin]
            # Bug D fix: track whether any trailing state was evicted so we persist exactly once.
            # Without this persist, stale entries survive in mechanical_state.json across restarts
            # and ghost-fire Phase 3 on the next same-coin position.
            _cleaned_trailing = False
            for coin in list(self._trailing_active):
                if coin not in open_coins:
                    del self._trailing_active[coin]
                    _cleaned_trailing = True
            for coin in list(self._trailing_stop_px):
                if coin not in open_coins:
                    del self._trailing_stop_px[coin]
                    _cleaned_trailing = True
            if _cleaned_trailing:
                self._persist_mechanical_state()

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
        threading.Thread(
            target=self._wake_for_profit,
            args=(coin, side, entry_px, mark_px, roe_pct, tier, trade_type),
            daemon=True,
            name="hynous-wake-profit",
        ).start()

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

        Phantom/regret system DISABLED. Only pass streak detection remains.
        """
        lines = []

        if self._scanner_pass_streak >= 3:
            lines.append(f"Pass streak: {self._scanner_pass_streak} consecutive — consider loosening filters")

        if not lines:
            return ""
        return "[Track Record]\n" + "\n".join(lines)

    def _build_ml_context(self, anomalies: list) -> str:
        """Build compact ML conditions block for scanner wakes.

        Shows only high/extreme regime predictions for coins in the anomalies,
        so the agent sees risk and opportunity signals alongside the scanner alert.
        """
        coins = {a.symbol for a in anomalies if a.symbol != "MARKET"}
        if not coins or not self._latest_predictions:
            return ""

        lines = []
        for coin in sorted(coins):
            with self._latest_predictions_lock:
                pred = dict(self._latest_predictions.get(coin, {}))
            cond = pred.get("conditions", {})
            if not cond:
                continue

            highlights = []
            for name in ["vol_1h", "vol_4h", "range_30m", "move_30m", "mae_long",
                         "mae_short", "entry_quality", "vol_expand", "funding_4h"]:
                info = cond.get(name)
                if not info:
                    continue
                regime = info.get("regime", "normal")
                if regime in ("high", "extreme"):
                    pctl = info.get("percentile", 0)
                    val = info.get("value", 0)
                    highlights.append(f"{name}={val:.2f} (p{pctl}, {regime})")

            if highlights:
                lines.append(f"  {coin}: {', '.join(highlights)}")

        if not lines:
            return ""

        return "[ML Conditions — noteworthy]\n" + "\n".join(lines)

    # Validation specs per signal type — injected into scanner wake prompts.
    # Each spec teaches the agent WHAT to fetch and HOW to assess it for this
    # specific signal. Only covers the primary (first) anomaly in a multi-anomaly
    # wake — subsequent anomalies are visible in the signal block itself.
    # Tool names must match the registered names in registry.py exactly.
    _VALIDATION_SPECS: dict = {
        "book_flip": {
            "parallel": ["get_book_history {sym} n=5", "get_market_data {sym} 1m"],
            "checks": [
                "Persistence: imbalance consistent in ≥3 of 5 snapshots (not a single spike)?",
                "Price: 1m candle moving in direction of the imbalance?",
            ],
            "rule": "Both must confirm. Book recovered OR price contradicts → skip or monitor_signal.",
        },
        "momentum_burst": {
            "parallel": ["get_market_data {sym} 5m", "get_orderbook {sym}"],
            "checks": [
                "Sustained: next 5m candle continuing momentum or already stalling?",
                "Book: orderbook supporting direction (not adverse flip)?",
            ],
            "rule": "Both must confirm. Momentum + adverse book = fade trade, not entry.",
        },
        "funding_extreme": {
            "parallel": ["get_funding_history {sym}", "get_market_data {sym} 4h"],
            "checks": [
                "Trend: funding elevated/negative across multiple periods (not a single spike)?",
                "Price: 4h candle aligned with funding signal (not already reversing)?",
            ],
            "rule": "Funding spike alone = weak. Funding trend + price alignment = consider.",
        },
        "funding_flip": {
            "parallel": ["get_funding_history {sym}", "get_market_data {sym} 1h"],
            "checks": [
                "Flip sustained or reverting in latest data?",
                "Price responding to the funding shift?",
            ],
            "rule": "Flip + price move = real signal. Flip alone = monitor.",
        },
        "oi_surge": {
            "parallel": ["get_market_data {sym} 1h", "get_orderbook {sym}"],
            "checks": [
                "OI direction vs price: OI up + price down = distribution (bearish). OI up + price up = accumulation.",
                "Book supporting intended entry direction?",
            ],
            "rule": "OI/price divergence = skip. Aligned = consider with regime filter.",
        },
        "oi_price_divergence": {
            "parallel": ["get_market_data {sym} 4h", "get_funding_history {sym}"],
            "checks": [
                "Divergence confirmed across 2+ timeframes?",
                "Funding direction consistent with expected squeeze direction?",
            ],
            "rule": "Divergence + funding alignment = high-conviction. Divergence alone = wait.",
        },
        "price_spike": {
            "parallel": ["get_market_data {sym} 5m", "get_orderbook {sym}"],
            "checks": [
                "Candle structure: clean breakout (strong close) or wick rejection (reversal risk)?",
                "Book: bids stacking under spike (continuation) or walls capping it (exhaustion)?",
            ],
            "rule": "Long wick + capping walls = fade/skip. Clean candle + stacked bids = momentum entry.",
        },
        "liq_cascade": {
            "parallel": ["get_liquidations {sym}", "get_market_data {sym} 1m"],
            "checks": [
                "More liq clusters ahead in the cascade direction (fuel for continuation)?",
                "Price still moving or stalling (cascade losing steam)?",
            ],
            "rule": "More cascades ahead + moving price = momentum play. Liq exhausted = snap-back risk, skip.",
        },
        "liq_cluster": {
            "parallel": ["get_liquidations {sym}", "get_orderbook {sym}"],
            "checks": [
                "How close is the liq cluster to current price (% distance)?",
                "Book showing momentum toward the cluster (magnetic pull forming)?",
            ],
            "rule": "Cluster within 2% + directional momentum = consider. Further = wait for confirmation.",
        },
        "market_liq_wave": {
            "parallel": ["get_liquidations BTC", "get_market_data BTC 1h"],
            "checks": [
                "Are BTC liq cascades driving or following altcoin moves?",
                "Is the liq wave peaked or still accelerating (price still in trend direction)?",
            ],
            "rule": "Early wave + accelerating = ride BTC direction. Late wave = reversal risk.",
        },
        "hlp_flip": {
            "parallel": ["get_funding_history {sym}", "get_market_data {sym} 1h"],
            "checks": [
                "Funding aligned with HLP's new direction (both pointing same way = strong signal)?",
                "Price already moving with HLP or lagging (entry timing)?",
            ],
            "rule": "HLP flip + aligned funding + confirming price = high-conviction. HLP alone = soft signal.",
        },
        "whale_surge": {
            "parallel": ["get_market_data {sym} 1h", "get_orderbook {sym}"],
            "checks": [
                "Is the whale move reflected in price (whale buying/selling showing up)?",
                "Book supporting the whale's direction (not getting absorbed)?",
            ],
            "rule": "Whale accumulation + price holding + book support = consider their direction. Whale exit = stay out.",
        },
        "peak_reversion": {
            "parallel": ["get_book_history {sym} n=5", "get_account"],
            "checks": [
                "Adverse book pressure: persistent across ≥3 snapshots or brief spike?",
                "Current SL: how much more can I lose before it's hit? Is it adequate?",
            ],
            "rule": "Persistent adverse + heavy giveback → tighten SL to current mark or close. Temporary spike → hold.",
        },
        "position_adverse_book": {
            "parallel": ["get_book_history {sym} n=5", "get_account"],
            "checks": [
                "Persistent adverse pressure across ≥3 snapshots (not a brief spike)?",
                "Is current SL close enough to limit damage if book pressure continues?",
            ],
            "rule": "Persistent adverse → tighten SL or close. Single-snapshot spike → hold and watch.",
        },
        "news_alert": {
            "parallel": ["get_market_data {sym} 1m", "get_orderbook {sym}"],
            "checks": [
                "Price reacting (>0.3% move in 1m)?",
                "Spread normal or widening (widening = already priced in, dangerous to chase)?",
            ],
            "rule": "No price reaction = already priced in, skip. Reaction + normal spread = consider.",
        },
        "regime_shift": {
            "parallel": ["get_funding_history {sym}", "get_market_data {sym} 4h"],
            "checks": [
                "Funding and 4h structure consistent with the new regime label?",
                "Any open positions: does my entry thesis still hold under the new regime?",
            ],
            "rule": "Regime shift doesn't mandate a close — it mandates reassessment. Close only if thesis is broken.",
        },
        "sm_entry": {
            "parallel": ["get_market_data {sym} 1h", "get_orderbook {sym}"],
            "checks": [
                "Price responding to the smart money entry (move already started or still early)?",
                "Book supporting their direction (not getting absorbed by opposing flow)?",
            ],
            "rule": "Smart money entry alone = soft signal. Entry + price + book = consider following.",
        },
        "sm_exit": {
            "parallel": ["get_market_data {sym} 1h", "get_orderbook {sym}"],
            "checks": [
                "Price breaking down after smart money exit (confirming their read)?",
                "Do I have an open position in the same direction they exited?",
            ],
            "rule": "Smart money exit + price weakness = tighten SL or close matching position.",
        },
    }
    _DEFAULT_VALIDATION_SPEC: dict = {
        "parallel": ["get_market_data {sym} 1m", "get_orderbook {sym}"],
        "checks": ["Price confirming signal direction?", "Book supporting direction?"],
        "rule": "Both must align before entering.",
    }

    def _build_validation_prompt(self, anomalies: list, regime_label: str) -> str:
        """Build a scanner wake message with signal-specific validation instructions."""
        from .scanner import format_scanner_wake

        signal_block = format_scanner_wake(anomalies, self._position_types, regime_label)

        top = anomalies[0]
        sym = top.symbol
        spec = self._VALIDATION_SPECS.get(top.type, self._DEFAULT_VALIDATION_SPEC)

        parallel_str = " + ".join(
            f"[{t.replace('{sym}', sym)}]" for t in spec["parallel"]
        )
        checks_str = "\n".join(f"  • {c}" for c in spec["checks"])

        validation_block = (
            f"\nVALIDATION — call in parallel BEFORE deciding:\n"
            f"  {parallel_str}\n\n"
            f"Then assess:\n{checks_str}\n\n"
            f"Decision rule: {spec['rule']}\n"
            f"If signal unclear after validation → monitor_signal({sym}, delay_s=60, "
            f"thesis='<your specific thesis>') — you'll get fresh data in 60s.\n"
        )

        # Insert validation block just before the "IMPORTANT: If you decide to trade" footer
        split_marker = "IMPORTANT: If you decide to trade"
        if split_marker in signal_block:
            pre, post = signal_block.split(split_marker, 1)
            return pre.rstrip() + "\n" + validation_block + "\n" + split_marker + post
        return signal_block + "\n" + validation_block

    def _wake_for_scanner(self, anomalies: list):
        """Wake the agent when the market scanner detects anomalies.

        Filters by wake threshold, formats message, respects rate limits.
        Non-priority wake (shares cooldown with other wakes).
        """
        cfg = self.config.scanner
        # Filter to anomalies above wake threshold
        wake_worthy = [a for a in anomalies if a.severity >= cfg.wake_threshold]
        if not wake_worthy:
            return

        # Cap to max anomalies per wake
        top = wake_worthy[:cfg.max_anomalies_per_wake]

        # Format the wake message with signal-specific validation instructions
        regime_label = self._regime.label if self._regime else "RANGING"
        message = self._build_validation_prompt(top, regime_label)

        # Issue 5: Playbook matching — inject matching playbook context
        matched_playbooks: list = []
        if self._playbook_matcher:
            try:
                from .playbook_matcher import PlaybookMatcher
                matched_playbooks = self._playbook_matcher.find_matching(top)
                if matched_playbooks:
                    playbook_section = PlaybookMatcher.format_matches(matched_playbooks)
                    message += "\n\n" + playbook_section
                    logger.debug(
                        "Playbook matcher: %d matches for %d anomalies",
                        len(matched_playbooks), len(top),
                    )
            except Exception as e:
                logger.debug("Playbook matching failed: %s", e)

        # Inject historical context above the scanner message
        track_record = self._build_historical_context(top)
        if track_record:
            message = track_record + "\n\n" + message

        response = self._wake_agent(
            message, max_coach_cycles=1, max_tokens=1200,
            source="daemon:scanner",
        )
        # Snapshot immediately — another chat() call would reset _last_tool_calls
        last_tool_calls = list(self.agent._last_tool_calls)
        if response:
            self.scanner_wakes += 1
            self._scanner.wakes_triggered += 1
            top_event = top[0]
            title = top_event.headline

            # Track pass streak + phantom creation
            if self.agent.last_chat_had_trade_tool():
                self._scanner_pass_streak = 0
                # Issue 5: auto-link matched playbooks to the trade entry
                if matched_playbooks:
                    self._link_playbooks_to_trade(matched_playbooks, top)
            else:
                self._scanner_pass_streak += 1
                # Phantom tracking — DISABLED (removed from system)
                # self._maybe_create_phantom(top_event, agent_response=response)

            log_event(DaemonEvent(
                "scanner", title,
                f"{len(top)} anomalies (top: {top_event.type} {top_event.symbol} sev={top_event.severity:.2f})",
            ))
            scanner_meta = {
                "tool_trace_text": _format_tool_trace_text(last_tool_calls),
                "decision": _extract_decision(last_tool_calls),
                "signal_header": f"{top_event.type} · {top_event.symbol} · {top_event.severity:.2f}",
            }
            _queue_and_persist("Scanner", title, response, event_type="scanner", meta=scanner_meta)
            logger.info("Scanner wake: %d anomalies, agent responded (%d chars)",
                        len(top), len(response))

    def _link_playbooks_to_trade(self, matches: list, anomalies: list):
        """Background: link matched playbooks to the most recent trade entry.

        After the agent trades following a playbook match, create an
        `applied_to` edge from each matched playbook to the trade entry.
        This enables the feedback loop: on trade close, the system finds
        these edges and updates playbook success metrics.

        Runs in a background thread — cannot block the main daemon loop.
        """
        def _do_link():
            try:
                from ..nous.client import get_client
                client = get_client()
                # Collect symbols from anomalies (for matching entries)
                symbols = set(
                    a.symbol.upper() for a in anomalies if a.symbol != "MARKET"
                )
                # Fetch recent trade entries (newest first)
                entries = client.list_nodes(
                    subtype="custom:trade_entry", limit=5,
                )
                for match in matches:
                    sym = match.matched_symbol.upper()
                    for entry in entries:
                        title = entry.get("content_title", "").upper()
                        if sym in title:
                            try:
                                client.create_edge(
                                    source_id=match.playbook_id,
                                    target_id=entry["id"],
                                    type="applied_to",
                                )
                                logger.info(
                                    "Linked playbook %s → trade entry %s (%s)",
                                    match.playbook_id, entry["id"], sym,
                                )
                            except Exception as e:
                                logger.debug(
                                    "Playbook-trade edge failed: %s", e,
                                )
                            break  # Found the entry for this symbol
            except Exception as e:
                logger.debug("Playbook-trade linking failed: %s", e)

        threading.Thread(target=_do_link, daemon=True, name="hynous-pb-link").start()

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

        pnl_sign = "+" if realized_pnl >= 0 else "-"
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

        # Backfill entry snapshot outcome for feedback loop (Phase 3)
        try:
            if self._satellite_store:
                self._satellite_store.conn.execute(
                    "UPDATE entry_snapshots "
                    "SET outcome_roe = ?, outcome_pnl_usd = ?, "
                    "outcome_won = ?, close_time = ?, close_reason = ? "
                    "WHERE id = ("
                    "  SELECT id FROM entry_snapshots "
                    "  WHERE coin = ? AND outcome_won IS NULL "
                    "  ORDER BY entry_time DESC LIMIT 1"
                    ")",
                    (
                        pnl_pct, realized_pnl,
                        1 if realized_pnl > 0 else 0,
                        time.time(), classification, coin,
                    ),
                )
                self._satellite_store.conn.commit()
        except Exception:
            logger.debug("Failed to backfill entry snapshot outcome", exc_info=True)

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
            # Clean Discord exit notification (no agent response blob)
            close_label = {
                "stop_loss": "SL", "take_profit": "TP", "liquidation": "Liquidation",
            }.get(classification, "Closed")
            leverage_dc = self._prev_positions.get(coin, {}).get("leverage", type_info.get("leverage", 0))
            roe_dc = round(pnl_pct * leverage_dc, 1) if leverage_dc else 0.0
            win_loss = "WIN" if realized_pnl >= 0 else "LOSS"
            _notify_discord_simple(
                f"{win_loss} · Exited {coin} {side} [{close_label}] — "
                f"{pnl_sign}${abs(realized_pnl):.2f} ({pnl_pct:+.1f}%)"
                + (f" · ROE {roe_dc:+.1f}%" if roe_dc else "")
            )
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
            if p["entry_price"] <= 0:
                pnl_pct = 0.0  # entry price missing — can't compute ROE
            elif p["side"] == "long":
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

    def _persist_mechanical_state(self) -> None:
        """Persist trailing stop state to disk so restarts don't degrade active SLs.

        Saves _peak_roe, _trailing_stop_px, and _trailing_active.
        On restart, _load_mechanical_state() restores these filtered to open positions.
        This prevents the trailing stop from treating a restart as a fresh position
        (old_trail_px=0 → should_update=True → cancels good SL and places worse one).
        """
        try:
            import json as _json
            path = self.config.project_root / "storage" / "mechanical_state.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            from ..core.persistence import _atomic_write
            data = {
                "peak_roe": self._peak_roe,
                "trailing_stop_px": self._trailing_stop_px,
                "trailing_active": self._trailing_active,
            }
            _atomic_write(path, _json.dumps(data))
        except Exception as e:
            logger.debug("Failed to persist mechanical state: %s", e)

    def _load_mechanical_state(self) -> None:
        """Load trailing stop state from disk on startup.

        Only restores state for symbols that are currently open positions
        (checked against _prev_positions). State for closed positions is
        discarded — if a position closed while the daemon was down, its
        state is irrelevant.

        Must be called AFTER _init_position_tracking() so _prev_positions
        is already populated with live positions.
        """
        try:
            import json as _json
            path = self.config.project_root / "storage" / "mechanical_state.json"
            if not path.exists():
                return
            saved = _json.loads(path.read_text())
            open_syms = set(self._prev_positions.keys())

            restored = 0
            for sym, val in saved.get("peak_roe", {}).items():
                if sym in open_syms:
                    self._peak_roe[sym] = val
                    restored += 1
            for sym, val in saved.get("trailing_stop_px", {}).items():
                if sym in open_syms:
                    self._trailing_stop_px[sym] = val
            for sym, val in saved.get("trailing_active", {}).items():
                if sym in open_syms:
                    self._trailing_active[sym] = val

            if restored:
                logger.info(
                    "Restored mechanical state for %d position(s) from disk "
                    "(peak_roe=%s, trailing_active=%s)",
                    restored,
                    {k: f"{v:.1f}%" for k, v in self._peak_roe.items()},
                    dict(self._trailing_active),
                )
        except Exception as e:
            logger.debug("Failed to load mechanical state: %s", e)

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
        (ACTIVE → WEAK → DORMANT). Logs transition stats. If important
        memories (lessons, theses, playbooks) just crossed ACTIVE → WEAK,
        wakes the agent to review and reinforce them.
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

                # Surface important ACTIVE → WEAK transitions to the agent
                self._check_fading_transitions(transitions, nous)
            else:
                logger.debug("Decay cycle: %d nodes processed, no transitions", processed)

        except Exception as e:
            logger.warning("Decay cycle failed: %s", e)

    def _run_consolidation(self):
        """Run cross-episode generalization cycle.

        Reviews clusters of episodic memories and extracts cross-episode
        patterns into knowledge-tier nodes. Uses Haiku for analysis.
        Runs in a background thread (hynous-consolidation).

        See: revisions/memory-sections/issue-3-generalization.md
        """
        try:
            from .consolidation import ConsolidationEngine

            engine = ConsolidationEngine(self.config)
            stats = engine.run_cycle()

            reviewed = stats.get("episodes_reviewed", 0)
            analyzed = stats.get("groups_analyzed", 0)
            created = stats.get("patterns_created", 0)
            strengthened = stats.get("patterns_strengthened", 0)
            errors = stats.get("errors", 0)

            if created > 0 or strengthened > 0:
                log_event(DaemonEvent(
                    "consolidation",
                    "Cross-episode generalization",
                    f"{reviewed} episodes → {analyzed} groups → "
                    f"{created} new patterns, {strengthened} strengthened",
                ))
                logger.info(
                    "Consolidation: %d episodes, %d groups, "
                    "%d patterns created, %d strengthened",
                    reviewed, analyzed, created, strengthened,
                )
            else:
                logger.debug(
                    "Consolidation: %d episodes, %d groups — no new patterns",
                    reviewed, analyzed,
                )

            if errors > 0:
                logger.warning("Consolidation: %d error(s) during cycle", errors)

            # Refresh promoted lessons cache after consolidation
            try:
                from .prompts.builder import refresh_promoted_lessons
                count = refresh_promoted_lessons()
                if count > 0:
                    # Rebuild system prompt so agent picks up new lessons
                    self.agent.rebuild_system_prompt()
                    logger.info("Promoted lessons refreshed (%d) — system prompt rebuilt", count)
            except Exception as e:
                logger.debug("Promoted lessons refresh failed: %s", e)

        except Exception as e:
            logger.warning("Consolidation cycle failed: %s", e)

    def _check_fading_transitions(self, transitions: list[dict], nous) -> None:
        """Filter ACTIVE→WEAK transitions for important memory types.

        Fetches each transitioning node to check its subtype. Only lessons,
        theses, and playbooks are worth waking the agent to reinforce — signals
        and episodes decay by design and need no action.

        A 24-hour per-node cooldown prevents the same WEAK node from
        triggering a repeated wake on every 6-hour decay cycle.
        """
        now = time.time()
        _24H = 86_400

        # Only ACTIVE → WEAK, and only nodes not recently alerted
        candidates = [
            t for t in transitions
            if t.get("from") == "ACTIVE" and t.get("to") == "WEAK"
            and now - self._fading_alerted.get(t.get("id", ""), 0) > _24H
        ]

        if not candidates:
            return

        # Fetch each candidate to inspect its subtype
        fading: list[dict] = []
        for t in candidates:
            nid = t.get("id")
            if not nid:
                continue
            try:
                node = nous.get_node(nid)
                if node and node.get("subtype") in _FADING_ALERT_SUBTYPES:
                    fading.append(node)
            except Exception as e:
                logger.debug("Could not fetch fading node %s: %s", nid, e)

        if not fading:
            return

        # Record alert timestamps; prune stale entries (> 48h) to bound dict size
        for node in fading:
            self._fading_alerted[node["id"]] = now
        cutoff = now - 172_800
        self._fading_alerted = {k: v for k, v in self._fading_alerted.items() if v > cutoff}

        logger.info("Fading memories: %d important node(s) crossed ACTIVE→WEAK", len(fading))
        self._wake_for_fading_memories(fading)

    def _wake_for_fading_memories(self, nodes: list[dict]) -> None:
        """Wake the agent with fading important memories for reinforcement.

        Runs in the hynous-decay background thread — same thread safety
        as _check_conflicts() which also calls _wake_agent() from a thread.
        """
        _labels = {
            "custom:lesson": "lesson",
            "custom:thesis": "thesis",
            "custom:playbook": "playbook",
        }

        count = len(nodes)
        lines = [
            "[DAEMON WAKE — Fading Memories]",
            f"{count} important {'memory' if count == 1 else 'memories'} just crossed ACTIVE → WEAK.",
            "Accessing a memory reinforces its FSRS stability — recalling it here counts.",
            "Archive anything no longer relevant: delete_memory(action=\"archive\").",
            "",
        ]

        for node in nodes[:5]:
            nid = node.get("id", "?")
            title = node.get("content_title", "Untitled")
            subtype = node.get("subtype", "")
            label = _labels.get(subtype, subtype)
            body = node.get("content_body", "") or ""

            # Parse JSON-wrapped bodies (trade-style nodes store text in a JSON envelope)
            if body.startswith("{"):
                try:
                    parsed = json.loads(body)
                    body = parsed.get("text", body)
                except Exception:
                    pass

            preview = body[:400].strip()
            if len(body) > 400:
                preview += "..."

            retrievability = node.get("neural_retrievability", 0)
            lines.append(
                f"[{label}] \"{title}\" ({nid}) — {retrievability:.0%} retrievability"
            )
            if preview:
                lines.append(f"  {preview}")
            lines.append("")

        if count > 5:
            lines.append(f"... and {count - 5} more. Use recall_memory(mode=\"browse\") to see all WEAK nodes.")
            lines.append("")

        lines.extend([
            "Options per memory:",
            "- Recall and reflect on it (natural reinforcement — FSRS stability grows on access)",
            "- update_memory to revise stale content before it fades to DORMANT",
            "- delete_memory(action=\"archive\") if the memory is no longer relevant",
        ])

        message = "\n".join(lines)
        response = self._wake_agent(message, max_tokens=1024, source="daemon:memory_fading")
        if response:
            titles_preview = ", ".join(
                f"\"{n.get('content_title', '?')[:30]}\""
                for n in nodes[:3]
            )
            log_event(DaemonEvent(
                "memory_fading", "Fading memory review",
                f"{count} node(s): {titles_preview}",
            ))
            _queue_and_persist("Memory Fading", "Fading Memories", response)
            logger.info(
                "Fading memory wake: %d node(s), agent responded (%d chars)",
                count, len(response),
            )

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
            logger.warning("Embedding backfill failed: %s", e)

    def _run_labeler(self):
        """Label unlabeled satellite snapshots with ground-truth outcome data.

        Runs in a background thread. For each unlabeled snapshot (4h+ old),
        fetches 5m candles covering +4h forward and computes ROE/MAE labels.
        Rate-limited by batch_size and inter-fetch delay to avoid 429s.
        """
        if not self._satellite_store:
            return

        try:
            from satellite.labeler import compute_labels, save_labels

            coins = self._satellite_config.coins if self._satellite_config else ["BTC", "ETH", "SOL"]
            batch_size = self.config.daemon.labeler_batch_size
            leverage = self.config.hyperliquid.default_leverage
            total_labeled = 0

            for coin in coins:
                if not self._running:
                    break

                unlabeled = self._satellite_store.get_unlabeled_snapshots(coin)
                batch = unlabeled[:batch_size]

                for snap in batch:
                    if not self._running:
                        break
                    try:
                        start = snap["created_at"] - 300  # include entry candle
                        end = snap["created_at"] + 14400 + 300  # +4h +5min buffer

                        candles = self._labeler_candle_fetcher(coin, start, end)
                        if not candles:
                            continue

                        result = compute_labels(
                            snapshot_id=snap["snapshot_id"],
                            entry_time=snap["created_at"],
                            coin=coin,
                            candles=candles,
                            leverage=leverage,
                        )

                        if result:
                            save_labels(self._satellite_store, result)
                            total_labeled += 1

                        # Rate limit: 0.5s between candle fetches to avoid 429s
                        time.sleep(0.5)

                    except Exception:
                        logger.debug(
                            "Labeling failed for %s snapshot %s",
                            coin, snap["snapshot_id"], exc_info=True,
                        )

            self.labeler_runs += 1
            self.snapshots_labeled_total += total_labeled

            if total_labeled:
                logger.warning("Labeler: labeled %d snapshots", total_labeled)
                log_event(DaemonEvent(
                    "labeler", "Snapshot labeling",
                    f"{total_labeled} snapshots labeled",
                ))
            else:
                logger.debug("Labeler: no snapshots to label")

        except Exception as e:
            logger.warning("Labeler run failed: %s", e)

    def _labeler_candle_fetcher(self, coin: str, start_time: float, end_time: float) -> list[dict]:
        """Candle fetcher adapter for the labeler.

        Converts seconds-based timestamps to milliseconds for the provider API.
        Returns 5m candles sorted ascending.
        """
        provider = self._get_provider()
        start_ms = int(start_time * 1000)
        end_ms = int(end_time * 1000)
        return provider.get_candles(coin, "5m", start_ms, end_ms)

    def _run_validation(self):
        """Run live validation of condition models and log results.

        Compares stored predictions against actual outcomes (labels).
        Logs per-model Spearman correlation at WARNING level for visibility.
        Saves results to storage/validation_results.json for inspection.
        """
        try:
            from satellite.training.validate_conditions import validate_live

            db_path = str(self.config.project_root / self.config.satellite.db_path)
            days = self.config.daemon.validation_days

            results = validate_live(db_path=db_path, coin="BTC", days=days)
            if not results:
                logger.debug("Validation: no joinable data yet")
                return

            self._latest_validation_results = results

            # Log summary at WARNING level so it's visible in production
            for r in results:
                if r.get("status") != "success":
                    continue
                sp = r.get("spearman", 0)
                da = r.get("centered_dir_pct", 50)
                n = r.get("samples", 0)
                if sp > 0.3 and da > 55:
                    status = "GOOD"
                elif sp > 0.15 or da > 52:
                    status = "WEAK"
                else:
                    status = "BROKEN"
                logger.warning(
                    "Validation %s: Spearman=%+.3f DirAcc=%.1f%% [%s] (%d samples)",
                    r["name"], sp, da, status, n,
                )

            # Persist results for dashboard/inspection (atomic write)
            import json as _json
            import tempfile
            import os
            results_path = self.config.project_root / "storage" / "validation_results.json"
            tmp = tempfile.NamedTemporaryFile(
                mode="w", dir=results_path.parent,
                suffix=".tmp", delete=False,
            )
            _json.dump({
                "coin": "BTC",
                "timestamp": time.time(),
                "days": days,
                "results": results,
            }, tmp, indent=2)
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp.close()
            os.replace(tmp.name, str(results_path))

            log_event(DaemonEvent(
                "validation", "ML model validation",
                f"{sum(1 for r in results if r.get('status') == 'success')} models validated",
            ))

        except Exception as e:
            logger.warning("Validation run failed: %s", e)

    def _run_feedback_analysis(self):
        """Compute rolling signal IC and update composite score weights.

        Runs daily. Requires >= 30 closed trades in entry_snapshots.
        Updates self._entry_score_weights and persists to disk.
        """
        try:
            from satellite.weight_updater import update_weights
            from satellite.signal_evaluator import compute_rolling_ic, compute_calibration_error

            # Log current signal quality
            ics = compute_rolling_ic(self._satellite_store, window=30)
            if ics:
                logger.info("Rolling IC: %s", ics)
            ece = compute_calibration_error(self._satellite_store)
            if ece >= 0:
                logger.info("Composite score ECE: %.4f", ece)

            # Attempt weight update
            weights_path = self.config.project_root / "storage" / "entry_score_weights.json"
            new_weights = update_weights(
                self._satellite_store, weights_path, min_trades=30,
            )
            if new_weights:
                self._entry_score_weights = new_weights
                logger.info("Entry score weights updated from feedback loop")

        except Exception as e:
            logger.debug("Feedback analysis failed: %s", e, exc_info=True)

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
            logger.warning("Conflict check failed: %s", e)

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

        # Snapshot before the agent runs so finally can detect agent-initiated closes.
        # _check_positions() won't see them because _prev_positions is refreshed in finally.
        positions_before = dict(self._prev_positions)

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
                    with self._latest_predictions_lock:
                        _ml_snap = {k: dict(v) for k, v in self._latest_predictions.items()}
                    briefing_text = build_briefing(
                        self._data_cache, self.snapshot,
                        self._get_provider(), self, self.config,
                        ml_predictions=_ml_snap,
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
                        ml_predictions=_ml_snap,
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

            # === Source-aware context tiers ===
            _FULL_CONTEXT = {"daemon:scanner", "daemon:ml_conditions", "daemon:review", "daemon:manual"}
            _POSITION_CONTEXT = {"daemon:profit", "daemon:watchpoint", "daemon:fill"}
            needs_full = source in _FULL_CONTEXT
            needs_positions = needs_full or source in _POSITION_CONTEXT

            # Strip briefing + code questions for non-full-context wakes
            if not needs_full:
                briefing_text = ""
                code_questions = []
                haiku_questions = []

            # Strip warnings for lightweight wakes (phantom, memory, conflict, learning)
            if not needs_full and not needs_positions:
                warnings_text = ""

            # === 3b. Position awareness block ===
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
                if pos_lines and needs_positions:
                    position_block = (
                        "[YOUR OPEN POSITIONS]\n"
                        + "\n".join(pos_lines)
                        + "\nIf any position is profitable, consider whether to close, trail stop, or hold."
                    )

            # === 4. Assemble wake message ===
            parts = []
            if briefing_text:
                parts.append(f"[Briefing]\n{briefing_text}\n[End Briefing]")
            if code_questions or haiku_questions:
                all_q = code_questions + haiku_questions
                parts.append("[Consider — do NOT list these in your response, just let them inform your thinking]\n" + "\n".join(f"- {q}" for q in all_q))
            if warnings_text:
                parts.append(warnings_text)
            if position_block:
                parts.append(position_block)

            # Active staged entries
            if self._staged_entries:
                staged_lines = []
                for e in self._staged_entries.values():
                    if e.status != "active":
                        continue
                    ttl_min = (e.expires_at - time.time()) / 60
                    price_str = (
                        f"@ ${e.entry_price:,.2f}"
                        if e.entry_price
                        else f"zone ${e.entry_zone_low:,.2f}-${e.entry_zone_high:,.2f}"
                    )
                    staged_lines.append(
                        f"  STAGED: {e.coin} {e.side.upper()} {price_str} "
                        f"| SL ${e.stop_loss:,.2f} TP ${e.take_profit:,.2f} "
                        f"| {e.leverage}x | {e.confidence:.0%} "
                        f"| expires {ttl_min:.0f}min | min_score={e.min_entry_score:.0f}"
                    )
                if staged_lines:
                    parts.append("[Staged Entries]\n" + "\n".join(staged_lines))

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
                    # Detect agent-initiated closes and update the circuit breaker.
                    # Any coin present before the wake but absent after was closed
                    # by the agent — _check_positions() won't catch it because
                    # _prev_positions was just refreshed above.
                    for coin in positions_before:
                        if coin not in self._prev_positions:
                            try:
                                fills = provider.get_user_fills(
                                    start_ms=int((time.time() - 300) * 1000)
                                )
                                close_fill = next(
                                    (f for f in reversed(fills)
                                     if f.get("coin") == coin and "Close" in f.get("direction", "")),
                                    None,
                                )
                                if close_fill:
                                    self._update_daily_pnl(close_fill.get("closed_pnl", 0.0))
                            except Exception:
                                pass
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
