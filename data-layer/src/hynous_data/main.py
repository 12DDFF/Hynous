"""Orchestrator — starts all threads + FastAPI server."""

import os
import sys
import time
import threading
import logging
from pathlib import Path

import uvicorn

from hynous_data.core.config import Config, load_config
from hynous_data.core.db import Database
from hynous_data.core.rate_limiter import RateLimiter
from hynous_data.collectors.trade_stream import TradeStream
from hynous_data.collectors.position_poller import PositionPoller
from hynous_data.collectors.hlp_tracker import HlpTracker
from hynous_data.engine.liq_heatmap import LiqHeatmapEngine
from hynous_data.engine.order_flow import OrderFlowEngine
from hynous_data.engine.whale_tracker import WhaleTracker
from hynous_data.engine.smart_money import SmartMoneyEngine
from hynous_data.engine.profiler import WalletProfiler
from hynous_data.engine.position_tracker import PositionChangeTracker
from hynous_data.api.app import create_app

log = logging.getLogger(__name__)

BASE_URL = "https://api.hyperliquid.xyz"
PIDFILE = "storage/hynous-data.pid"


def _acquire_instance_lock(cfg: Config) -> bool:
    """Write PID file and check for existing instance. Returns True if lock acquired."""
    pidpath = Path(cfg.project_root) / PIDFILE
    pidpath.parent.mkdir(parents=True, exist_ok=True)

    if pidpath.exists():
        try:
            old_pid = int(pidpath.read_text().strip())
            # Check if process is still running
            os.kill(old_pid, 0)
            log.error("Another instance is running (PID %d). Aborting.", old_pid)
            return False
        except (ProcessLookupError, ValueError):
            pass  # Stale PID file — safe to overwrite
        except PermissionError:
            # Process exists but belongs to another user — treat as running
            log.error("Another instance is running (PID %d, different user). Aborting.", old_pid)
            return False

    pidpath.write_text(str(os.getpid()))
    return True


def _release_instance_lock(cfg: Config):
    """Remove PID file."""
    pidpath = Path(cfg.project_root) / PIDFILE
    try:
        if pidpath.exists() and pidpath.read_text().strip() == str(os.getpid()):
            pidpath.unlink()
    except Exception:
        pass


class Orchestrator:
    """Manages all components: DB, collectors, engines, API."""

    def __init__(self, config: Config | None = None):
        self.cfg = config or load_config()
        self._components: dict = {}
        self._stop_event = threading.Event()
        self._pruner_thread: threading.Thread | None = None
        self.start_time = 0.0

    def start(self):
        """Initialize and start all components."""
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
            datefmt="%H:%M:%S",
        )

        # Instance lock — prevent double-run
        if not _acquire_instance_lock(self.cfg):
            sys.exit(1)

        self.start_time = time.time()
        log.info("=== Hynous-Data starting ===")

        # Core
        db = Database(self.cfg.db.path)
        db.connect()
        db.init_schema()
        rate_limiter = RateLimiter(
            max_weight=self.cfg.rate_limit.max_weight_per_min,
            safety_pct=self.cfg.rate_limit.safety_pct,
        )
        self._components["db"] = db
        self._components["rate_limiter"] = rate_limiter
        self._components["start_time"] = self.start_time

        # Engines (created before collectors so we can wire them)
        smart_money = SmartMoneyEngine(db)
        order_flow = OrderFlowEngine(windows=self.cfg.order_flow.windows)
        liq_heatmap = LiqHeatmapEngine(db, self.cfg.heatmap, base_url=BASE_URL, rate_limiter=rate_limiter)
        whale_tracker = WhaleTracker(db)

        # Smart money wallet profiler + position change tracker
        position_tracker = PositionChangeTracker(db)
        position_tracker.load_snapshots()
        profiler = WalletProfiler(db, rate_limiter, self.cfg.smart_money, base_url=BASE_URL)

        self._components["order_flow"] = order_flow
        self._components["liq_heatmap"] = liq_heatmap
        self._components["whale_tracker"] = whale_tracker
        self._components["smart_money"] = smart_money
        self._components["profiler"] = profiler
        self._components["position_tracker"] = position_tracker

        # Collectors
        if self.cfg.trade_stream.enabled:
            ts = TradeStream(db, base_url=BASE_URL)
            ts.start()
            self._components["trade_stream"] = ts
            log.info("TradeStream started")

        if self.cfg.position_poller.enabled:
            pp = PositionPoller(db, rate_limiter, self.cfg.position_poller, base_url=BASE_URL)
            pp.set_smart_money(smart_money)  # Wire PnL tracking
            pp.set_position_tracker(position_tracker)  # Wire change detection
            pp.start()
            self._components["position_poller"] = pp
            log.info("PositionPoller started")

        if self.cfg.hlp_tracker.enabled:
            hlp = HlpTracker(db, rate_limiter, self.cfg.hlp_tracker, base_url=BASE_URL)
            hlp.start()
            self._components["hlp_tracker"] = hlp
            log.info("HlpTracker started")

        # Start engine threads
        liq_heatmap.start()
        log.info("Signal engines started")

        # DB pruner (hourly) + profiler refresh
        self._pruner_thread = threading.Thread(target=self._pruner_loop, daemon=True)
        self._pruner_thread.start()
        self._profiler_thread = threading.Thread(target=self._profiler_loop, daemon=True)
        self._profiler_thread.start()

        # FastAPI
        app = create_app(self._components)
        log.info("Starting API on %s:%d", self.cfg.server.host, self.cfg.server.port)
        try:
            uvicorn.run(
                app,
                host=self.cfg.server.host,
                port=self.cfg.server.port,
                log_level="warning",
            )
        finally:
            _release_instance_lock(self.cfg)

    def _pruner_loop(self):
        """Prune old time-series data + stale positions every hour."""
        while not self._stop_event.is_set():
            self._stop_event.wait(3600)
            if self._stop_event.is_set():
                break
            try:
                db = self._components["db"]
                db.prune_old_data(self.cfg.db.prune_days)
                # Also prune positions not updated in 24h (address closed all positions)
                cutoff = time.time() - 86400
                with db.write_lock:
                    cur = db.conn.execute(
                        "DELETE FROM positions WHERE updated_at < ?", (cutoff,)
                    )
                    if cur.rowcount:
                        db.conn.commit()
                        log.info("Pruned %d stale positions (>24h old)", cur.rowcount)
                # Prune old position_changes (>7 days)
                pc_cutoff = time.time() - 7 * 86400
                with db.write_lock:
                    cur = db.conn.execute(
                        "DELETE FROM position_changes WHERE detected_at < ?", (pc_cutoff,)
                    )
                    if cur.rowcount:
                        db.conn.commit()
                        log.info("Pruned %d old position changes", cur.rowcount)
            except Exception:
                log.exception("Pruner error")

    def _profiler_loop(self):
        """Refresh wallet profiles periodically."""
        refresh_s = self.cfg.smart_money.profile_refresh_hours * 3600
        # Initial delay: wait 5min before first profile refresh
        self._stop_event.wait(300)
        while not self._stop_event.is_set():
            try:
                profiler = self._components.get("profiler")
                if profiler:
                    profiler.refresh_profiles()
                    if self.cfg.smart_money.auto_curate_enabled:
                        profiler.auto_curate()
            except Exception:
                log.exception("Profiler refresh error")
            self._stop_event.wait(refresh_s)

    def stop(self):
        """Gracefully shut down all components."""
        log.info("Shutting down...")
        self._stop_event.set()
        for name in ("trade_stream", "position_poller", "hlp_tracker", "liq_heatmap"):
            comp = self._components.get(name)
            if comp and hasattr(comp, "stop"):
                comp.stop()
        db = self._components.get("db")
        if db:
            db.close()
        _release_instance_lock(self.cfg)
        log.info("Shutdown complete")
