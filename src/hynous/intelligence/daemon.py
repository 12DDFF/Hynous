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
    daemon = Daemon(config)
    daemon.start()   # Background thread
    daemon.stop()    # Graceful shutdown
"""

import collections
import json
import logging
import math
import queue as _queue_module
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..core.config import Config
from ..core.daemon_log import log_event, DaemonEvent, flush as flush_daemon_log
from ..core.trading_settings import get_trading_settings

if TYPE_CHECKING:
    from hynous.mechanical_entry.interface import EntryTriggerSource

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
    pass


def _notify_discord_simple(message: str):
    pass


_TOOL_DISPLAY = {
    "get_market_data": "market data",
    "get_orderbook": "orderbook",
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
    """Background polling loop for Hynous (v2).

    Responsibilities:
    1. Poll market data at intervals (Hyperliquid prices, Coinglass derivatives)
    2. Evaluate watchpoint triggers against cached data
    3. Drive mechanical entry/exit (no LLM involvement)
    4. Run satellite ML inference and labeling
    """

    def __init__(self, config: Config):
        self.config = config
        self.snapshot = MarketSnapshot()

        self._running = False
        self._thread: threading.Thread | None = None

        # Background threads for long-running maintenance tasks.
        # These run off the main daemon loop so they cannot block
        # _fast_trigger_check() (SL/TP guard that must fire every 10 s).
        self._review_thread: threading.Thread | None = None
        self._labeler_thread: threading.Thread | None = None
        self._validation_thread: threading.Thread | None = None

        # Cached provider references (avoid re-importing in every method)
        self._hl_provider = None

        # Pre-fetched deep market data for briefing injection
        from .briefing import DataCache
        self._data_cache = DataCache()

        # Timing trackers
        self._last_review: float = 0
        self._last_health_check: float = 0
        self._last_labeler_run: float = 0
        self._last_validation_run: float = 0
        self._latest_validation_results: list[dict] = []

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
        self._dynamic_sl_set: dict[str, bool] = {}   # True once dynamic protective SL placed
        self._small_wins_exited: dict[str, bool] = {}  # coin → True once small-wins exit fired
        self._small_wins_tp_placed: dict[str, bool] = {}  # coin → True once exchange TP order placed
        self._trailing_active: dict[str, bool] = {}   # coin → True once trail is engaged
        self._trailing_stop_px: dict[str, float] = {}  # coin → current trailing stop price level

        # Position type registry: {coin: {"type": "micro"|"macro", "entry_time": float}}
        # Populated by trading tool via register_position_type(), inferred on restart
        self._position_types: dict[str, dict] = {}

        # v2: trade journal capture (phase 1)
        self._open_trade_ids: dict[str, str] = {}        # coin → trade_id (active snapshot)
        self._journal_store = None                            # JournalStore (phase 2 M7; migrated from StagingStore)
        self._peak_roe_ts: dict[str, str] = {}            # coin → ISO timestamp of peak ROE
        self._trough_roe_ts: dict[str, str] = {}          # coin → ISO timestamp of trough ROE
        self._peak_roe_price: dict[str, float] = {}       # coin → price at peak ROE
        self._trough_roe_price: dict[str, float] = {}     # coin → price at trough ROE
        self._last_vol_regime: str | None = None          # last observed vol regime (for change detection)

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

        # Wake rate limiting (kept for dashboard stats surface, unused in v2)
        self._wake_timestamps: list[float] = []
        self._last_wake_time: float = 0

        # Heartbeat — updated every loop iteration, checked by dashboard watchdog
        self._heartbeat: float = time.time()

        # Regime detection (computed every deriv poll, injected everywhere)
        from .regime import RegimeClassifier
        self._regime_classifier = RegimeClassifier()  # Persistent for hysteresis
        self._regime = None             # RegimeState or None
        self._prev_regime_label = ""    # For shift detection
        self._micro_safe = True         # Micro safety gate from regime

        # Market scanner (anomaly detection across all pairs)
        self._scanner = None
        if config.scanner.enabled:
            from .scanner import MarketScanner
            self._scanner = MarketScanner(config.scanner)
            self._scanner.execution_symbols = set(config.execution.symbols)
            self._scanner._data_layer_enabled = config.data_layer.enabled

        # Satellite: ML feature engine (SPEC-03)
        self._satellite_store = None
        self._satellite_config = None
        self._satellite_dl_conn = None  # read-only conn to data-layer DB
        self._inference_engine = None              # NEW — unconditional
        self._kill_switch = None                   # NEW — unconditional
        self._latest_predictions: dict[str, dict] = {}  # NEW — unconditional
        self._latest_predictions_lock = threading.Lock()
        # v2 phase 5: mechanical entry trigger (set by _init_mechanical_entry).
        self._entry_trigger: "EntryTriggerSource | None" = None
        self._last_entry_check: float = 0   # v2 phase 5: periodic ML signal evaluation
        # v2 post-launch: optional Kronos shadow predictor (set by _init_kronos_shadow).
        self._kronos_shadow: Any = None
        self._last_kronos_shadow: float = 0.0
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

        # Tick-level features: collected by data-layer process (survives daemon restarts)
        # Tick direction models: loaded here for inference from satellite.db
        self._tick_inference = None
        if self._satellite_store:
            try:
                from satellite.tick_inference import TickInferenceEngine
                _tick_artifacts = config.project_root / "satellite" / "artifacts" / "tick_models"
                _sat_db = str(config.project_root / config.satellite.db_path)
                self._tick_inference = TickInferenceEngine(_tick_artifacts, _sat_db)
                if self._tick_inference.is_ready:
                    logger.info("Tick inference engine loaded: %s", self._tick_inference.model_names)
                else:
                    self._tick_inference = None
            except Exception:
                logger.debug("Tick inference engine init failed", exc_info=True)

        # Stats
        self.wake_count: int = 0
        self.watchpoint_fires: int = 0
        self.scanner_wakes: int = 0
        self.learning_sessions: int = 0
        self.health_checks: int = 0
        self.labeler_runs: int = 0
        self.snapshots_labeled_total: int = 0
        self.polls: int = 0

    # ================================================================
    # Cached Provider Access
    # ================================================================

    def _get_provider(self):
        """Get cached provider (PaperProvider in paper mode, Hyperliquid otherwise)."""
        if self._hl_provider is None:
            from ..data.providers.hyperliquid import get_provider
            self._hl_provider = get_provider(config=self.config)
        return self._hl_provider

    # ================================================================
    # Lifecycle
    # ================================================================

    def start(self):
        """Start the daemon loop in a background thread."""
        if self._running:
            return
        global _active_daemon
        _active_daemon = self

        # Prime the v2 LLM monthly budget cap. Shared across analysis
        # pipeline, batch rejection cron, and user-chat agent via the
        # module-level state in hynous.core.costs. <= 0 disables the cap.
        try:
            from ..core.costs import set_monthly_budget
            budget = self.config.v2.monthly_llm_budget_usd
            set_monthly_budget(budget if budget > 0 else None)
        except Exception:
            logger.exception("Failed to prime LLM monthly budget cap")

        self._running = True
        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="hynous-daemon",
        )
        self._thread.start()
        scanner_status = "ON" if self._scanner else "OFF"
        # v2 only surfaces the intervals that actually drive loops today.
        # The v1 curiosity/decay/conflict/health/backfill/periodic-review
        # intervals are still in DaemonConfig but have no v2 consumer (see
        # v2-debug M6); dropping them from the log line stops misleading
        # operators into thinking those cycles are running.
        logger.info(
            "Daemon started (price=%ds, deriv=%ds, scanner=%s)",
            self.config.daemon.price_poll_interval,
            self.config.daemon.deriv_poll_interval,
            scanner_status,
        )

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
            "tick_inference": self._tick_inference.get_status() if self._tick_inference else None,
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
        """Deprecated — v2 has no periodic LLM reviews. Dashboard stub; remove in phase 7."""
        return 0

    @property
    def current_funding_rates(self) -> dict[str, float]:
        """Current funding rates from snapshot."""
        return dict(self.snapshot.funding)

    @property
    def review_count(self) -> int:
        """Deprecated — v2 has no periodic LLM reviews. Dashboard stub; remove in phase 7."""
        return 0

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
        # Initial data fetch
        self._poll_prices()
        self._poll_derivatives()
        self._init_position_tracking()
        self._last_review = time.time()
        self._last_health_check = time.time()
        self._last_labeler_run = time.time() - self.config.daemon.labeler_interval + 300  # First run after 5min warmup
        self._last_validation_run = time.time() - self.config.daemon.validation_interval + 3600  # First run after 1h warmup
        self._last_fill_check = time.time()
        self._load_daily_pnl()

        # v2: initialize the production JournalStore (phase 2 M7 — promoted
        # from StagingStore). First-run auto-migration from staging.db → journal.db
        # is guarded by a journal_metadata flag so subsequent starts skip it.
        try:
            from hynous.journal.store import JournalStore
            journal_path = self.config.v2.journal.db_path
            store = JournalStore(
                db_path=journal_path,
                busy_timeout_ms=self.config.v2.journal.busy_timeout_ms,
            )
            self._journal_store = store

            # One-shot migration from phase-1 staging.db if present and not yet migrated.
            migrate_flag = store.get_metadata("staging_migration_done")
            if migrate_flag != "1":
                staging_path = journal_path.replace("journal.db", "staging.db")
                from pathlib import Path as _Path
                if _Path(staging_path).exists():
                    from hynous.journal.migrate_staging import (
                        migrate_staging_to_journal,
                    )
                    counts = migrate_staging_to_journal(staging_path, journal_path)
                    logger.info(
                        "v2 staging→journal migration: entries=%d exits=%d events=%d "
                        "(skipped e=%d x=%d ev=%d)",
                        counts["entries"], counts["exits"], counts["events"],
                        counts["skipped_entries"], counts["skipped_exits"],
                        counts["skipped_events"],
                    )
                store.set_metadata("staging_migration_done", "1")

            logger.info("v2 journal store initialized: %s", journal_path)
        except Exception:
            logger.exception("Failed to initialize v2 journal store")
            self._journal_store = None

        # v2 phase 5: initialize mechanical entry trigger.
        # Wrapped so init failure never prevents the daemon loop from running.
        try:
            self._init_mechanical_entry()
        except Exception:
            logger.exception("Failed to initialize v2 mechanical entry trigger")
            self._entry_trigger = None

        # v2 post-launch: Kronos shadow predictor (read-only side car).
        # Wrapped so init failure never prevents the daemon loop from running.
        try:
            self._init_kronos_shadow()
        except Exception:
            logger.exception("Failed to initialize Kronos shadow predictor")
            self._kronos_shadow = None

        # v2: start batch rejection analysis cron (phase 3 M5).
        # Wrapped in its own try/except so cron start failure never prevents
        # the daemon from entering its main loop.
        if self._journal_store is not None:
            try:
                from hynous.analysis.batch_rejection import start_batch_rejection_cron
                start_batch_rejection_cron(
                    journal_store=self._journal_store,
                    interval_s=self.config.v2.analysis_agent.batch_rejection_interval_s,
                    model=self.config.v2.analysis_agent.model,
                )
                logger.info(
                    "v2 batch rejection cron started (interval=%ds)",
                    self.config.v2.analysis_agent.batch_rejection_interval_s,
                )
            except Exception:
                logger.exception("Failed to start v2 batch rejection cron")

        # v2: start weekly pattern rollup cron (phase 6 M2/M3).
        if (
            self._journal_store is not None
            and self.config.v2.consolidation.pattern_rollup_enabled
        ):
            try:
                from hynous.journal.consolidation import start_weekly_rollup_cron
                start_weekly_rollup_cron(
                    journal_store=self._journal_store,
                    interval_s=self.config.v2.consolidation.pattern_rollup_interval_hours * 3600,
                    window_days=self.config.v2.consolidation.pattern_rollup_window_days,
                )
                logger.info(
                    "v2 weekly rollup cron started (interval=%dh, window=%dd)",
                    self.config.v2.consolidation.pattern_rollup_interval_hours,
                    self.config.v2.consolidation.pattern_rollup_window_days,
                )
            except Exception:
                logger.exception("Failed to start v2 weekly rollup cron")

        # Start WebSocket market data feed via provider
        if self.config.daemon.ws_price_feed:
            provider = self._get_provider()
            # Tracked coins: configured symbols + any currently open positions
            ws_coins = list(
                set(self.config.execution.symbols) | set(self._prev_positions.keys())
            )
            provider.start_ws(ws_coins)
            logger.warning("WS market data feed started via provider")

        # Tick features: collected by data-layer process (survives daemon restarts)

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

                # 3. Watchpoint polling removed in phase 4.
                if self._data_changed:
                    self._data_changed = False

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
                        if anomalies and self._entry_trigger is not None:
                            self._evaluate_entry_signals(anomalies)
                    except Exception as e:
                        logger.debug("Scanner detect failed: %s", e)

                # 3c. v2 phase 5: periodic ML-signal entry check (every 60s,
                # independent of scanner).
                if self._entry_trigger and now - self._last_entry_check >= 60:
                    self._last_entry_check = now
                    try:
                        self._periodic_ml_signal_check()
                    except Exception:
                        logger.debug(
                            "Periodic ML signal check failed", exc_info=True,
                        )

                # 3d. Kronos shadow tick (post-v2, read-only). Runs on its own
                # cadence (default 300s) on a background thread so inference
                # latency never stalls _fast_trigger_check.
                if self._kronos_shadow is not None:
                    tick_interval = self.config.v2.kronos_shadow.tick_interval_s
                    if now - self._last_kronos_shadow >= tick_interval:
                        self._last_kronos_shadow = now
                        threading.Thread(
                            target=self._run_kronos_shadow_tick,
                            name="kronos-shadow",
                            daemon=True,
                        ).start()

                # 4. Curiosity cron removed in phase 4.
                # 5. Periodic review cron removed in phase 5 (v1 LLM wake retired).
                # 6. FSRS decay cron removed in phase 4.
                # 7. Contradiction queue cron removed in phase 4.
                # 8. Health check cron removed in phase 4.
                # 9. Embedding backfill cron removed in phase 4.
                # 10. Consolidation cron removed in phase 4.

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

                # 14. v2: Deferred counterfactual recomputation (every 30 min)
                if (
                    self._journal_store
                    and now - getattr(self, "_last_cf_recompute", 0) >= 1800
                ):
                    self._last_cf_recompute = now
                    try:
                        self._recompute_pending_counterfactuals()
                    except Exception:
                        logger.debug("Counterfactual recompute failed", exc_info=True)

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

                # ML-condition wake evaluation removed in phase 5 (v1 LLM wake retired).
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
        Mechanical entry (phase 5) consumes the cached predictions via
        ``_evaluate_entry_signals``; no LLM wake path.
        """
        if not self._satellite_store:
            return

        has_inference = bool(self._inference_engine)

        import json
        import time as _time

        shadow = True

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

                        # --- Tick direction inference ---
                        # Store under tick_* keys to avoid overwriting v2 direction model.
                        # Entry score reads from signal/long_roe/short_roe (v2 model).
                        # Tick predictions stored separately for monitoring + future blending.
                        if self._tick_inference:
                            try:
                                tick_pred = self._tick_inference.predict(coin)
                                if tick_pred:
                                    _ret_bps = tick_pred.predicted_return_bps
                                    with self._latest_predictions_lock:
                                        if coin not in self._latest_predictions:
                                            self._latest_predictions[coin] = {}
                                        self._latest_predictions[coin]["tick_signal"] = tick_pred.signal
                                        self._latest_predictions[coin]["tick_return_bps"] = round(_ret_bps, 3)
                                        self._latest_predictions[coin]["tick_long_roe"] = max(0, _ret_bps * 20 / 100)
                                        self._latest_predictions[coin]["tick_short_roe"] = max(0, -_ret_bps * 20 / 100)
                                        self._latest_predictions[coin]["tick_predictions"] = tick_pred.predictions
                                        self._latest_predictions[coin]["tick_inference_ms"] = tick_pred.inference_time_ms
                                    logger.debug(
                                        "Tick inference %s: %s (%.1f bps, %.1fms)",
                                        coin, tick_pred.signal, _ret_bps, tick_pred.inference_time_ms,
                                    )
                            except Exception:
                                logger.debug("Tick inference failed for %s", coin, exc_info=True)

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

        # ML-signal LLM wake removed in phase 5. Signals still logged above;
        # mechanical entry evaluation consumes them via _evaluate_entry_signals.

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
    # Watchpoint System (legacy helpers — used by remaining trigger eval)
    # ================================================================

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
                # v2: emit trade_exit events + build exit snapshots BEFORE eviction
                for event in events:
                    _trade_id = self._open_trade_ids.get(event["coin"])
                    if _trade_id and self._journal_store:
                        try:
                            from hynous.journal.capture import (
                                build_exit_snapshot,
                                emit_lifecycle_event,
                            )
                            emit_lifecycle_event(
                                journal_store=self._journal_store,
                                trade_id=_trade_id,
                                event_type="trade_exit",
                                payload={
                                    "exit_px": event.get("exit_px", 0),
                                    "exit_classification": event.get("classification", "unknown"),
                                    "realized_pnl_usd": event.get("realized_pnl", 0),
                                    "peak_roe": self._peak_roe.get(event["coin"], 0),
                                    "trough_roe": self._trough_roe.get(event["coin"], 0),
                                    "entry_px": event.get("entry_px", 0),
                                    "side": event.get("side", ""),
                                },
                            )
                            # Build and persist exit snapshot
                            _entry_json = self._journal_store.get_entry_snapshot_json(
                                _trade_id,
                            )
                            if _entry_json:
                                _exit_snap = build_exit_snapshot(
                                    trade_id=_trade_id,
                                    entry_snapshot_json=_entry_json,
                                    exit_event=event,
                                    daemon=self,
                                )
                                self._journal_store.insert_exit_snapshot(_exit_snap)
                                # v2: trigger post-trade analysis in background.
                                # Wrapped in its own try/except so a dispatch failure
                                # (bad import, misconfig) never breaks exit capture.
                                try:
                                    from hynous.analysis.wake_integration import (
                                        trigger_analysis_async,
                                    )
                                    trigger_analysis_async(
                                        trade_id=_trade_id,
                                        journal_store=self._journal_store,
                                        model=self.config.v2.analysis_agent.model,
                                        prompt_version=(
                                            self.config.v2.analysis_agent.prompt_version
                                        ),
                                    )
                                except Exception:
                                    logger.exception(
                                        "Failed to dispatch analysis for %s",
                                        _trade_id,
                                    )
                        except Exception:
                            logger.exception(
                                "v2 exit capture failed for %s", event["coin"],
                            )

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
                    self._breakeven_set.pop(_coin, None)
                    self._dynamic_sl_set.pop(_coin, None)
                    # v2: clean trade journal state
                    self._open_trade_ids.pop(_coin, None)
                    self._peak_roe_ts.pop(_coin, None)
                    self._trough_roe_ts.pop(_coin, None)
                    self._peak_roe_price.pop(_coin, None)
                    self._trough_roe_price.pop(_coin, None)
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

            # v2: detect vol regime changes and emit lifecycle events
            try:
                with self._latest_predictions_lock:
                    _btc_pred = dict(self._latest_predictions.get("BTC", {}))
                _btc_cond = _btc_pred.get("conditions", {})
                _current_vol_regime = _btc_cond.get("vol_1h", {}).get("regime")
                if (
                    _current_vol_regime
                    and self._last_vol_regime is not None
                    and _current_vol_regime != self._last_vol_regime
                ):
                    for _sym in position_syms:
                        _trade_id = self._open_trade_ids.get(_sym)
                        if _trade_id and self._journal_store:
                            from hynous.journal.capture import emit_lifecycle_event
                            emit_lifecycle_event(
                                journal_store=self._journal_store,
                                trade_id=_trade_id,
                                event_type="vol_regime_change",
                                payload={
                                    "old_regime": self._last_vol_regime,
                                    "new_regime": _current_vol_regime,
                                },
                            )
                if _current_vol_regime:
                    self._last_vol_regime = _current_vol_regime
            except Exception:
                pass  # non-critical

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
                    # v2: track timestamp/price of peak for exit snapshot
                    _now_iso = datetime.now(timezone.utc).isoformat()
                    self._peak_roe_ts[sym] = _now_iso
                    self._peak_roe_price[sym] = px
                    _trade_id = self._open_trade_ids.get(sym)
                    if _trade_id and self._journal_store:
                        from hynous.journal.capture import emit_lifecycle_event
                        emit_lifecycle_event(
                            journal_store=self._journal_store,
                            trade_id=_trade_id,
                            event_type="peak_roe_new",
                            payload={"peak_roe": roe_pct, "price": px},
                        )
                if roe_pct < self._trough_roe.get(sym, 0):
                    self._trough_roe[sym] = roe_pct
                    _now_iso = datetime.now(timezone.utc).isoformat()
                    self._trough_roe_ts[sym] = _now_iso
                    self._trough_roe_price[sym] = px
                    _trade_id = self._open_trade_ids.get(sym)
                    if _trade_id and self._journal_store:
                        from hynous.journal.capture import emit_lifecycle_event
                        emit_lifecycle_event(
                            journal_store=self._journal_store,
                            trade_id=_trade_id,
                            event_type="trough_roe_new",
                            payload={"trough_roe": roe_pct, "price": px},
                        )

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
                                # v2: lifecycle event
                                _trade_id = self._open_trade_ids.get(sym)
                                if _trade_id and self._journal_store:
                                    from hynous.journal.capture import emit_lifecycle_event
                                    emit_lifecycle_event(
                                        journal_store=self._journal_store,
                                        trade_id=_trade_id,
                                        event_type="dynamic_sl_placed",
                                        payload={
                                            "vol_regime": _vol_regime,
                                            "sl_roe_distance": sl_roe,
                                            "sl_px": sl_px,
                                            "existing_sl_was_tighter": False,
                                            "side": side,
                                        },
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
                                # v2: lifecycle event
                                _trade_id = self._open_trade_ids.get(sym)
                                if _trade_id and self._journal_store:
                                    from hynous.journal.capture import emit_lifecycle_event
                                    emit_lifecycle_event(
                                        journal_store=self._journal_store,
                                        trade_id=_trade_id,
                                        event_type="fee_be_set",
                                        payload={
                                            "new_sl_px": be_price,
                                            "roe_at_trigger": roe_pct,
                                            "trade_type": trade_type,
                                        },
                                    )
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
                            # v2: lifecycle event
                            _trade_id = self._open_trade_ids.get(sym)
                            if _trade_id and self._journal_store:
                                from hynous.journal.capture import emit_lifecycle_event
                                emit_lifecycle_event(
                                    journal_store=self._journal_store,
                                    trade_id=_trade_id,
                                    event_type="trail_activated",
                                    payload={
                                        "vol_regime": _vol_regime,
                                        "activation_roe": activation_roe,
                                        "roe_at_activation": roe_pct,
                                    },
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
                                    # v2: lifecycle event
                                    _trade_id = self._open_trade_ids.get(sym)
                                    if _trade_id and self._journal_store:
                                        from hynous.journal.capture import emit_lifecycle_event
                                        emit_lifecycle_event(
                                            journal_store=self._journal_store,
                                            trade_id=_trade_id,
                                            event_type="trail_updated",
                                            payload={
                                                "peak_roe": peak,
                                                "old_trail_px": old_trail_px,
                                                "new_trail_px": new_trail_px,
                                                "retracement_pct": effective_retracement,
                                                "vol_regime": _vol_regime,
                                            },
                                        )
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
                            # Record trigger close (same path as SL/TP closes)
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

                if worst_roe < self._trough_roe.get(sym, 0):
                    old_trough = self._trough_roe.get(sym, 0)
                    self._trough_roe[sym] = worst_roe
                    if old_trough - worst_roe > 0.5:
                        logger.info(
                            "MAE corrected by candle: %s %s | %.1f%% → %.1f%% (%.1f%%)",
                            sym, side, old_trough, worst_roe, worst_roe - old_trough,
                        )

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

        # Record trigger close (auto-triggered closes aren't written by agent)
        if classification in ("stop_loss", "take_profit", "liquidation", "trailing_stop", "breakeven_stop", "dynamic_protective_sl"):
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
        # No-op in v2; phase 1 journal capture handles trade persistence.
        return None

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

    _PROFIT_TIERS = frozenset({
        "micro_overstay", "urgent_profit", "take_profit",
        "profit_nudge", "profit_fading", "risk_no_sl",
    })

    def _wake_for_profit(
        self, coin: str, side: str, entry_px: float,
        mark_px: float, roe_pct: float, tier: str,
        trade_type: str = "macro",
    ):
        """Record a profit/risk event (v2 phase 5 M4: pure notification sink).

        The v1 implementation woke the LLM agent with a tiered alert; v2
        replaces that with a plain ``log_event`` call so the event still
        surfaces in the daemon log feed but no LLM tokens are consumed.
        Mechanical exits (dynamic SL + trailing stop) manage the position.
        """
        # Unknown tiers are silently dropped (matches v1 behavior).
        if tier not in self._PROFIT_TIERS:
            return

        leverage = self._prev_positions.get(coin, {}).get("leverage", 20)
        is_scalp = trade_type == "micro"
        type_label = f"scalp {leverage}x" if is_scalp else f"swing {leverage}x"

        log_event(DaemonEvent(
            "profit", f"{tier}: {coin} {side}",
            f"ROE {roe_pct:+.1f}% ({type_label}) | Entry ${entry_px:,.0f} → ${mark_px:,.0f}",
        ))
        logger.info(
            "Profit alert: %s %s %s (ROE %+.1f%%, %s)",
            tier, coin, side, roe_pct, trade_type,
        )

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


    def _init_mechanical_entry(self) -> None:
        """Initialize the configured EntryTriggerSource (v2 phase 5)."""
        cfg = self.config.v2.mechanical_entry
        if cfg.trigger_source == "ml_signal_driven":
            from hynous.mechanical_entry.ml_signal_driven import MLSignalDrivenTrigger
            self._entry_trigger = MLSignalDrivenTrigger(
                composite_threshold=cfg.composite_entry_threshold,
                direction_confidence_threshold=cfg.direction_confidence_threshold,
                entry_quality_threshold=cfg.require_entry_quality_pctl,
                max_vol_regime=cfg.max_vol_regime,
                tick_confirmation_enabled=cfg.tick_confirmation_enabled,
                tick_confirmation_horizon=cfg.tick_confirmation_horizon,
            )
            logger.info(
                "v2 mechanical entry trigger initialized: %s "
                "(thresh=%.2f dir=%.2f eq=%d vol<=%s tick_conf=%s@%s)",
                self._entry_trigger.name(),
                cfg.composite_entry_threshold,
                cfg.direction_confidence_threshold,
                cfg.require_entry_quality_pctl,
                cfg.max_vol_regime,
                cfg.tick_confirmation_enabled,
                cfg.tick_confirmation_horizon,
            )
        elif cfg.trigger_source in ("", "none", "disabled"):
            logger.info("v2 mechanical entry: disabled by config")
            self._entry_trigger = None
        else:
            logger.error(
                "v2 unknown trigger_source: %r — mechanical entry disabled",
                cfg.trigger_source,
            )
            self._entry_trigger = None

    def _init_kronos_shadow(self) -> None:
        """Load Kronos and build the shadow predictor; no-op if disabled or deps missing."""
        cfg = self.config.v2.kronos_shadow
        if not cfg.enabled:
            logger.info("kronos-shadow: disabled in config")
            return
        try:
            from hynous.kronos_shadow.adapter import KronosAdapter, is_kronos_available
            from hynous.kronos_shadow.shadow_predictor import KronosShadowPredictor
        except ImportError:
            logger.warning("kronos-shadow: import failed — disabling")
            return
        if not is_kronos_available():
            logger.warning("kronos-shadow: extras missing — disabling")
            return
        adapter = KronosAdapter(
            model_name=cfg.model_name,
            tokenizer_name=cfg.tokenizer_name,
            max_context=cfg.max_context,
            device=cfg.device,
        )
        try:
            adapter.load()
        except Exception:
            logger.exception("kronos-shadow: load failed — disabling")
            return
        self._kronos_shadow = KronosShadowPredictor(adapter=adapter, config=cfg)
        logger.info(
            "kronos-shadow: ENABLED symbol=%s model=%s cadence=%ds",
            cfg.symbol, cfg.model_name, cfg.tick_interval_s,
        )

    def _run_kronos_shadow_tick(self) -> None:
        """Background-thread entry point. Never raises — the worker swallows."""
        try:
            if self._kronos_shadow is not None:
                self._kronos_shadow.predict_and_record(daemon=self)
        except Exception:
            logger.exception("kronos-shadow: tick worker crashed")

    def _evaluate_entry_signals(self, anomalies: list) -> None:
        """Evaluate the configured mechanical trigger for each anomaly (v2 phase 5).

        Mechanical entry evaluation. No LLM involvement. For every anomaly,
        builds an ``EntryEvaluationContext``, asks the trigger to evaluate,
        and if a signal comes back, fires ``execute_trade_mechanical``.
        Rejections are recorded by the trigger itself (M2). Fully
        synchronous — no background threads.
        """
        from datetime import datetime, timezone

        from hynous.mechanical_entry.executor import execute_trade_mechanical
        from hynous.mechanical_entry.interface import EntryEvaluationContext

        if not self._entry_trigger:
            return

        cfg_coin = self.config.v2.mechanical_entry.coin.upper()

        for anomaly in anomalies:
            # Anomaly may be an AnomalyEvent dataclass (scanner.detect) or a
            # dict — support both shapes.
            if hasattr(anomaly, "symbol"):
                symbol = (anomaly.symbol or "").upper()
                scanner_detail: dict[str, Any] = dict(anomaly.__dict__)
            else:
                symbol = (anomaly.get("symbol", "") or "").upper()
                scanner_detail = dict(anomaly)

            if symbol != cfg_coin:
                continue  # phase 5: single-coin evaluation

            ctx = EntryEvaluationContext(
                daemon=self,
                symbol=symbol,
                scanner_anomaly=scanner_detail,
                now_ts=datetime.now(timezone.utc).isoformat(),
            )
            try:
                signal = self._entry_trigger.evaluate(ctx)
            except Exception:
                logger.exception("Entry trigger evaluation failed for %s", symbol)
                continue
            if signal is None:
                continue

            try:
                trade_id = execute_trade_mechanical(signal=signal, daemon=self)
                if trade_id:
                    logger.info(
                        "Mechanical entry fired via scanner path: %s", trade_id,
                    )
                    log_event(DaemonEvent(
                        "entry",
                        f"Mechanical entry: {signal.symbol} {signal.side}",
                        f"trigger={signal.trigger_source} "
                        f"conviction={signal.conviction:.2f} trade_id={trade_id}",
                    ))
            except Exception:
                logger.exception(
                    "Mechanical entry execution failed for %s", symbol,
                )

    def _periodic_ml_signal_check(self) -> None:
        """Fire entry evaluation for the configured coin even without a
        scanner anomaly (v2 phase 5)."""
        from datetime import datetime, timezone

        from hynous.mechanical_entry.executor import execute_trade_mechanical
        from hynous.mechanical_entry.interface import EntryEvaluationContext

        if not self._entry_trigger:
            return

        symbol = self.config.v2.mechanical_entry.coin.upper()
        if symbol in self._prev_positions:
            return  # one-at-a-time

        ctx = EntryEvaluationContext(
            daemon=self,
            symbol=symbol,
            scanner_anomaly=None,
            now_ts=datetime.now(timezone.utc).isoformat(),
        )
        try:
            signal = self._entry_trigger.evaluate(ctx)
        except Exception:
            logger.exception("Periodic ML signal check evaluation failed")
            return
        if signal is None:
            return
        try:
            trade_id = execute_trade_mechanical(signal=signal, daemon=self)
            if trade_id:
                logger.info(
                    "Mechanical entry fired via periodic check: %s", trade_id,
                )
                log_event(DaemonEvent(
                    "entry",
                    f"Mechanical entry (periodic): {symbol} {signal.side}",
                    f"trigger={signal.trigger_source} "
                    f"conviction={signal.conviction:.2f} trade_id={trade_id}",
                ))
        except Exception:
            logger.exception(
                "Periodic mechanical entry execution failed for %s", symbol,
            )

    def _wake_for_fill(
        self,
        coin: str,
        side: str,
        entry_px: float,
        exit_px: float,
        realized_pnl: float,
        classification: str,
    ):
        """Record a position close (v2 phase 5 M4: pure notification sink).

        The v1 implementation woke the LLM agent with a classification-specific
        playbook prompt; v2 replaces that with ``log_event`` + a plain
        Discord notification and keeps the satellite entry-snapshot outcome
        backfill (phase 8 quant work still reads it).
        """
        # Look up trade type BEFORE cleanup (still in registry at this point)
        type_info = self._position_types.get(coin, {"type": "macro", "entry_time": 0})
        trade_type = type_info["type"]
        is_scalp = trade_type == "micro"
        type_label = "Scalp" if is_scalp else "Swing"

        pnl_sign = "+" if realized_pnl >= 0 else "-"
        pnl_pct = ((exit_px - entry_px) / entry_px * 100) if entry_px > 0 else 0
        if side == "short":
            pnl_pct = -pnl_pct

        # Backfill entry snapshot outcome for feedback loop (Phase 3 satellite)
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

        self._fill_fires += 1
        fill_title = f"{classification.replace('_', ' ').title()}: {coin} {side} ({type_label})"
        log_event(DaemonEvent(
            "fill", fill_title,
            f"Entry: ${entry_px:,.0f} → Exit: ${exit_px:,.0f} | "
            f"PnL: {pnl_sign}${abs(realized_pnl):,.2f} ({pnl_pct:+.1f}%)",
        ))
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
        logger.info("Fill event: %s %s %s %s (PnL: %s%.2f)",
                     classification, trade_type, coin, side, pnl_sign, abs(realized_pnl))

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
                "peak_roe_ts": self._peak_roe_ts,
                "trough_roe_ts": self._trough_roe_ts,
                "peak_roe_price": self._peak_roe_price,
                "trough_roe_price": self._trough_roe_price,
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
            for sym, val in saved.get("peak_roe_ts", {}).items():
                if sym in open_syms:
                    self._peak_roe_ts[sym] = val
            for sym, val in saved.get("trough_roe_ts", {}).items():
                if sym in open_syms:
                    self._trough_roe_ts[sym] = val
            for sym, val in saved.get("peak_roe_price", {}).items():
                if sym in open_syms:
                    self._peak_roe_price[sym] = val
            for sym, val in saved.get("trough_roe_price", {}).items():
                if sym in open_syms:
                    self._trough_roe_price[sym] = val

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

    def _recompute_pending_counterfactuals(self) -> None:
        """Recompute counterfactuals for exits whose window has elapsed."""
        if not self._journal_store:
            return
        if not hasattr(self._journal_store, "list_exit_snapshots_needing_counterfactuals"):
            return

        from hynous.journal.counterfactuals import compute_counterfactuals
        from hynous.journal.schema import (
            MLExitComparison, MarketState, ROETrajectory,
            TradeExitSnapshot, TradeOutcome,
        )
        from dataclasses import asdict

        pending = self._journal_store.list_exit_snapshots_needing_counterfactuals()
        if not pending:
            return

        provider = self._get_provider()
        now = time.time()
        recomputed = 0

        for item in pending:
            snap = item["snapshot"]
            exit_ts = item["exit_ts"]
            cf = snap.get("counterfactuals", {})
            window_s = cf.get("counterfactual_window_s", 7200)

            try:
                exit_dt = datetime.fromisoformat(exit_ts.replace("Z", "+00:00"))
                window_end = exit_dt.timestamp() + window_s
                if now < window_end:
                    continue
            except Exception:
                continue

            basics = snap.get("trade_basics", {})
            try:
                new_cf = compute_counterfactuals(
                    provider=provider,
                    symbol=basics.get("symbol", "BTC"),
                    side=basics.get("side", "long"),
                    entry_px=basics.get("entry_px", 0),
                    entry_ts=basics.get("entry_ts", exit_ts),
                    exit_px=snap.get("trade_outcome", {}).get("exit_px", 0),
                    exit_ts=exit_ts,
                    sl_px=basics.get("sl_px"),
                    tp_px=basics.get("tp_px"),
                )
                if new_cf.did_tp_hit_later or new_cf.did_sl_get_hunted:
                    snap["counterfactuals"] = asdict(new_cf)
                    updated = TradeExitSnapshot(
                        trade_id=item["trade_id"],
                        trade_outcome=TradeOutcome(**snap.get("trade_outcome", {})),
                        roe_trajectory=ROETrajectory(**snap.get("roe_trajectory", {})),
                        counterfactuals=new_cf,
                        ml_exit_comparison=MLExitComparison(**snap.get("ml_exit_comparison", {})),
                        market_state_at_exit=MarketState(**snap.get("market_state_at_exit", {})),
                        price_path_1m=snap.get("price_path_1m", []),
                    )
                    self._journal_store.update_exit_snapshot(item["trade_id"], updated)
                    recomputed += 1
                    logger.info(
                        "Counterfactuals recomputed for %s: tp_hit=%s sl_hunted=%s",
                        item["trade_id"], new_cf.did_tp_hit_later, new_cf.did_sl_get_hunted,
                    )
            except Exception:
                logger.debug(
                    "Counterfactual recompute failed for %s", item["trade_id"], exc_info=True,
                )

        if recomputed:
            logger.info("Recomputed counterfactuals for %d exit(s)", recomputed)

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

        Runs daily. Uses ``update_weights`` default ``min_trades=10``
        (phase-8 new-M1 tightening) — do not re-override here.
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
                self._satellite_store, weights_path,
            )
            if new_weights:
                self._entry_score_weights = new_weights
                logger.info("Entry score weights updated from feedback loop")

        except Exception as e:
            logger.debug("Feedback analysis failed: %s", e, exc_info=True)

