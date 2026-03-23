"""Tick-level microstructure feature collector.

Runs inside the data-layer process (independent of daemon restarts).
Computes 20 orderbook + trade flow features every 1s from live WS data,
batches writes to satellite.db every 5s.

Data sources (in-process, zero HTTP):
- L2Subscriber: real-time orderbook (100 levels/side)
- TradeStream buffers: per-coin trade deques (px, sz, side, time)

Research basis:
- arXiv:2506.05764 "Better Inputs Matter More"
- arXiv:2602.00776 "Explainable Patterns in Cryptocurrency Microstructure"
"""

import logging
import math
import sqlite3
import threading
import time
from collections import deque
from pathlib import Path

log = logging.getLogger(__name__)

# Feature names — order matters, must match training.
# Canonical list lives in satellite/tick_features.py; keep in sync.
TICK_FEATURE_NAMES = [
    "book_imbalance_5",
    "book_imbalance_10",
    "book_imbalance_20",
    "bid_depth_usd_5",
    "ask_depth_usd_5",
    "spread_pct",
    "mid_price",
    "buy_vwap_deviation",
    "sell_vwap_deviation",
    "flow_imbalance_10s",
    "flow_imbalance_30s",
    "flow_imbalance_60s",
    "flow_intensity_10s",
    "flow_intensity_30s",
    "trade_volume_10s_usd",
    "trade_volume_30s_usd",
    "price_change_10s",
    "price_change_30s",
    "price_change_60s",
    "large_trade_imbalance",
]

TICK_FEATURE_COUNT = len(TICK_FEATURE_NAMES)
TICK_SCHEMA_VERSION = 1

# SQL for batch inserts
_COLS = ["timestamp", "coin"] + TICK_FEATURE_NAMES + ["schema_version"]
_INSERT_SQL = (
    f"INSERT OR IGNORE INTO tick_snapshots ({', '.join(_COLS)}) "
    f"VALUES ({', '.join(['?'] * len(_COLS))})"
)

LARGE_TRADE_USD = 10_000


class TickCollector:
    """Computes tick-level features every 1s, writes to satellite.db every 5s.

    Runs as a daemon thread inside the data-layer process.
    Reads directly from L2Subscriber and trade_stream buffers — no HTTP.
    """

    COMPUTE_INTERVAL = 1.0
    WRITE_INTERVAL = 5.0

    def __init__(
        self,
        l2_subscriber,
        coins: list[str],
        satellite_db_path: str | Path,
    ):
        self._l2 = l2_subscriber
        self._coins = coins
        self._db_path = Path(satellite_db_path)

        self._running = False
        self._thread: threading.Thread | None = None
        self._write_buffer: list[tuple] = []
        self._buffer_lock = threading.Lock()

        # Price history for momentum features (per coin)
        self._price_history: dict[str, deque] = {
            c: deque(maxlen=120) for c in coins
        }

        # Satellite DB connection (separate from data-layer DB)
        self._conn: sqlite3.Connection | None = None
        self._db_lock = threading.Lock()

        # Stats
        self.snapshots_computed = 0
        self.snapshots_written = 0
        self.compute_errors = 0
        self.write_errors = 0

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._init_db()
        self._running = True
        self._thread = threading.Thread(
            target=self._run,
            daemon=True,
            name="tick-collector",
        )
        self._thread.start()
        log.warning("TickCollector started for %s → %s", self._coins, self._db_path)

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
        self._flush_buffer()
        if self._conn:
            self._conn.close()
            self._conn = None

    # ------------------------------------------------------------------
    # DB init — creates tick_snapshots table in satellite.db
    # ------------------------------------------------------------------

    def _init_db(self):
        """Open satellite.db (WAL mode) and ensure tick_snapshots table exists."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(
            str(self._db_path),
            check_same_thread=False,
            timeout=10,
        )
        self._conn.execute("PRAGMA journal_mode=WAL")

        tick_cols = ["timestamp REAL NOT NULL", "coin TEXT NOT NULL"]
        tick_cols += [f"{f} REAL" for f in TICK_FEATURE_NAMES]
        tick_cols += ["schema_version INTEGER NOT NULL DEFAULT 1"]
        ddl = (
            "CREATE TABLE IF NOT EXISTS tick_snapshots (\n    "
            + ",\n    ".join(tick_cols)
            + ",\n    PRIMARY KEY (coin, timestamp)\n)"
        )
        self._conn.execute(ddl)
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tick_coin_time "
            "ON tick_snapshots(coin, timestamp)"
        )
        self._conn.commit()
        log.info("TickCollector DB ready: %s", self._db_path)

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    def _run(self):
        """Main loop with crash recovery — restarts on unhandled exceptions."""
        while self._running:
            try:
                self._run_inner()
            except Exception:
                log.exception("TickCollector thread crashed — restarting in 5s")
                time.sleep(5)

    def _run_inner(self):
        last_write = time.time()
        last_status_log = time.time()

        while self._running:
            t0 = time.time()

            for coin in self._coins:
                try:
                    row = self._compute(coin)
                    if row:
                        with self._buffer_lock:
                            self._write_buffer.append(row)
                        self.snapshots_computed += 1
                except Exception:
                    self.compute_errors += 1
                    if self.compute_errors <= 5 or self.compute_errors % 100 == 0:
                        log.warning(
                            "Tick compute error (%d total)",
                            self.compute_errors,
                            exc_info=True,
                        )

            if time.time() - last_write >= self.WRITE_INTERVAL:
                self._flush_buffer()
                last_write = time.time()

            # Periodic status log every 60s
            if time.time() - last_status_log >= 60:
                last_status_log = time.time()
                log.info(
                    "TickCollector: %d written, %d errors, buf=%d",
                    self.snapshots_written,
                    self.compute_errors,
                    len(self._write_buffer),
                )

            elapsed = time.time() - t0
            sleep_time = max(0, self.COMPUTE_INTERVAL - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

        self._flush_buffer()

    # ------------------------------------------------------------------
    # Feature computation — reads from L2Subscriber + trade buffers
    # ------------------------------------------------------------------

    def _compute(self, coin: str) -> tuple | None:
        now = time.time()

        # --- L2 book from L2Subscriber ---
        book = self._l2.get_book(coin)
        if not book:
            return None

        # Reject stale book data (>10s old = WS likely disconnected)
        book_age = now - book.get("updated_at", 0)
        if book_age > 10:
            return None

        # book format: bids/asks are lists of (price, size) tuples
        bids = book.get("bids", [])
        asks = book.get("asks", [])
        mid = book.get("mid", 0)
        if not mid or mid <= 0 or not bids or not asks:
            return None

        self._price_history[coin].append((now, mid))

        # --- Trades from in-memory buffer (iterate deque once) ---
        from hynous_data.collectors.trade_stream import get_trade_buffer

        trade_buf = get_trade_buffer(coin)
        now_ms = int(now * 1000)
        cutoff_60s = now_ms - 60_000
        cutoff_30s = now_ms - 30_000
        cutoff_10s = now_ms - 10_000

        # Single pass: bucket trades by window and side
        buy_notional_60 = 0.0
        sell_notional_60 = 0.0
        buy_volume_60 = 0.0
        sell_volume_60 = 0.0
        buy_notional_30 = 0.0
        sell_notional_30 = 0.0
        buy_notional_10 = 0.0
        sell_notional_10 = 0.0
        count_60 = 0
        count_30 = 0
        count_10 = 0
        large_buys = 0.0
        large_sells = 0.0

        # Iterate deque directly (no list() copy — deque iteration is thread-safe for reads)
        for t in trade_buf:
            t_time = t["time"]
            if t_time <= cutoff_60s:
                continue
            count_60 += 1
            notional = t["px"] * t["sz"]
            is_buy = t["side"] == "B"

            if is_buy:
                buy_notional_60 += notional
                buy_volume_60 += t["sz"]
            else:
                sell_notional_60 += notional
                sell_volume_60 += t["sz"]

            if notional >= LARGE_TRADE_USD:
                if is_buy:
                    large_buys += notional
                else:
                    large_sells += notional

            if t_time > cutoff_30s:
                count_30 += 1
                if is_buy:
                    buy_notional_30 += notional
                else:
                    sell_notional_30 += notional

                if t_time > cutoff_10s:
                    count_10 += 1
                    if is_buy:
                        buy_notional_10 += notional
                    else:
                        sell_notional_10 += notional

        features: dict[str, float] = {}

        # === ORDERBOOK IMBALANCE ===
        for depth, label in [(5, "5"), (10, "10"), (20, "20")]:
            bid_vol = sum(px * sz for px, sz in bids[:depth])
            ask_vol = sum(px * sz for px, sz in asks[:depth])
            total = bid_vol + ask_vol
            features[f"book_imbalance_{label}"] = bid_vol / total if total > 0 else 0.5

        # === DEPTH METRICS ===
        features["bid_depth_usd_5"] = sum(px * sz for px, sz in bids[:5])
        features["ask_depth_usd_5"] = sum(px * sz for px, sz in asks[:5])
        features["spread_pct"] = book.get("spread", 0) / mid if mid else 0
        features["mid_price"] = mid

        # === VWAP DEVIATIONS ===
        if buy_volume_60 > 0:
            features["buy_vwap_deviation"] = (buy_notional_60 / buy_volume_60 - mid) / mid
        else:
            features["buy_vwap_deviation"] = 0.0

        if sell_volume_60 > 0:
            features["sell_vwap_deviation"] = (sell_notional_60 / sell_volume_60 - mid) / mid
        else:
            features["sell_vwap_deviation"] = 0.0

        # === TRADE FLOW AT MULTIPLE WINDOWS ===
        windows = [
            ("10s", buy_notional_10, sell_notional_10, count_10, 10),
            ("30s", buy_notional_30, sell_notional_30, count_30, 30),
            ("60s", buy_notional_60, sell_notional_60, count_60, 60),
        ]
        for label, buy_n, sell_n, cnt, window_s in windows:
            total_vol = buy_n + sell_n
            features[f"flow_imbalance_{label}"] = buy_n / total_vol if total_vol > 0 else 0.5

            if label in ("10s", "30s"):
                features[f"flow_intensity_{label}"] = cnt / window_s
                features[f"trade_volume_{label}_usd"] = total_vol

        # === MOMENTUM ===
        price_hist = self._price_history[coin]
        for window_s, label in [(10, "10s"), (30, "30s"), (60, "60s")]:
            cutoff = now - window_s
            # Scan from oldest; deque is chronological
            past_price = None
            for t_ts, t_px in price_hist:
                if cutoff - 1 <= t_ts <= cutoff + 1:
                    past_price = t_px
                    break
            if past_price and mid > 0:
                features[f"price_change_{label}"] = (mid - past_price) / past_price * 100
            else:
                features[f"price_change_{label}"] = 0.0

        # === LARGE TRADE IMBALANCE ===
        large_total = large_buys + large_sells
        features["large_trade_imbalance"] = large_buys / large_total if large_total > 0 else 0.5

        # Sanitize NaN/inf
        for k, v in features.items():
            if math.isnan(v) or math.isinf(v):
                features[k] = 0.0

        # Build row tuple matching _COLS order
        vals = [features.get(f, 0.0) for f in TICK_FEATURE_NAMES]
        return (now, coin, *vals, TICK_SCHEMA_VERSION)

    # ------------------------------------------------------------------
    # DB writes
    # ------------------------------------------------------------------

    def _flush_buffer(self):
        with self._buffer_lock:
            if not self._write_buffer:
                return
            batch = self._write_buffer.copy()
            self._write_buffer.clear()

        try:
            with self._db_lock:
                self._conn.executemany(_INSERT_SQL, batch)
                self._conn.commit()
            self.snapshots_written += len(batch)
            if self.snapshots_written % 500 == 0:
                log.info(
                    "TickCollector: %d written, %d computed, %d errors",
                    self.snapshots_written,
                    self.snapshots_computed,
                    self.compute_errors,
                )
        except Exception:
            self.write_errors += 1
            if self.write_errors <= 5 or self.write_errors % 100 == 0:
                log.warning(
                    "Tick write error (%d total, %d in batch)",
                    self.write_errors,
                    len(batch),
                    exc_info=True,
                )

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def stats(self) -> dict:
        return {
            "running": self._running,
            "coins": self._coins,
            "computed": self.snapshots_computed,
            "written": self.snapshots_written,
            "compute_errors": self.compute_errors,
            "write_errors": self.write_errors,
            "buffer_size": len(self._write_buffer),
            "db_path": str(self._db_path),
        }
