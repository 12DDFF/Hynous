"""Tick-level microstructure feature computation for directional prediction.

Computes features from live WebSocket data every 1 second:
- Multi-level orderbook imbalance (5/10/20 depth levels)
- VWAP-to-mid deviation (buy-side vs sell-side)
- Tick-level trade flow (last 10s/30s/60s)
- Spread and depth metrics

Features are batched and written to satellite.db every 5 seconds.

Research basis:
- arXiv:2506.05764 "Better Inputs Matter More" — XGBoost with LOB features
- arXiv:2602.00776 "Explainable Patterns in Cryptocurrency Microstructure"

Usage:
    engine = TickFeatureEngine(provider, store, coins=["BTC"])
    engine.start()  # background thread, computes every 1s, writes every 5s
    engine.stop()
"""

import logging
import math
import threading
import time
from collections import deque
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

# Feature names — order matters, must match training.
# Canonical list — data-layer/engine/tick_collector.py has a copy; keep in sync.
TICK_FEATURE_NAMES = [
    # Orderbook imbalance at multiple depth levels
    "book_imbalance_5",       # bid_vol / (bid_vol + ask_vol) at top 5 levels
    "book_imbalance_10",      # same at top 10 levels
    "book_imbalance_20",      # same at top 20 levels
    # Depth metrics
    "bid_depth_usd_5",        # total bid $ within top 5 levels
    "ask_depth_usd_5",        # total ask $ within top 5 levels
    "spread_pct",             # (best_ask - best_bid) / mid_price
    "mid_price",              # (best_bid + best_ask) / 2
    # VWAP deviations
    "buy_vwap_deviation",     # (buy_vwap - mid) / mid — positive = buyers paying premium
    "sell_vwap_deviation",    # (sell_vwap - mid) / mid — negative = sellers accepting discount
    # Trade flow at multiple windows
    "flow_imbalance_10s",     # buy_vol / total_vol over last 10 seconds
    "flow_imbalance_30s",     # same over 30 seconds
    "flow_imbalance_60s",     # same over 60 seconds
    "flow_intensity_10s",     # total trades / 10 (trades per second)
    "flow_intensity_30s",     # total trades / 30
    # Volume metrics
    "trade_volume_10s_usd",   # total notional volume last 10s
    "trade_volume_30s_usd",   # total notional volume last 30s
    # Momentum
    "price_change_10s",       # % price change over last 10 seconds
    "price_change_30s",       # % change over 30 seconds
    "price_change_60s",       # % change over 60 seconds
    # Pressure
    "large_trade_imbalance",  # buy/sell imbalance of trades > $10K only
    # v2: Book pressure delta — how fast is the orderbook shifting?
    "book_imbalance_delta_5s",   # imbalance_5 now minus 5s ago
    "book_imbalance_delta_10s",  # imbalance_5 now minus 10s ago
    "depth_ratio_change_5s",     # (bid/ask depth ratio now) / (5s ago) - 1
    # v2: Trade size distribution — are whales active?
    "max_trade_usd_60s",         # largest single trade notional in 60s
    "trade_count_60s",           # raw number of trades in 60s
    "trade_count_10s",           # raw number of trades in 10s
]

TICK_FEATURE_COUNT = len(TICK_FEATURE_NAMES)

# Schema version — increment when features change
# v2: added book pressure delta + trade size distribution (6 features)
TICK_SCHEMA_VERSION = 2

# Rolling features computed during training and inference from base features.
# Window sizes at DOWNSAMPLE_INTERVAL=5: w5=1, w10=2, w30=6, w60=12.
ROLLING_FEATURES = [
    "book_imbalance_5_mean5", "flow_imbalance_10s_mean5", "price_change_10s_mean5",
    "book_imbalance_5_mean10", "flow_imbalance_10s_mean10",
    "book_imbalance_5_std30", "flow_imbalance_10s_std30", "price_change_10s_std30",
    "book_imbalance_5_slope60", "flow_imbalance_10s_slope60", "mid_price_slope60",
]


@dataclass
class TickSnapshot:
    """One tick-level feature snapshot."""
    timestamp: float
    coin: str
    features: dict[str, float]
    schema_version: int = TICK_SCHEMA_VERSION

    def to_row(self) -> tuple:
        """Convert to DB row tuple (timestamp, coin, f1, f2, ..., schema_version)."""
        vals = [self.features.get(f, 0.0) for f in TICK_FEATURE_NAMES]
        return (self.timestamp, self.coin, *vals, self.schema_version)


class TickFeatureEngine:
    """Computes tick-level features every 1s from live WS data.

    Designed for the same provider that daemon uses — accesses
    _market_feed for L2 books and trade buffers directly.

    Thread-safe: runs in a daemon thread, writes to satellite.db
    via batched inserts every 5 seconds.
    """

    COMPUTE_INTERVAL = 1.0   # seconds between feature computations
    WRITE_INTERVAL = 5.0     # seconds between DB writes (batch 5 snapshots)
    LARGE_TRADE_USD = 10_000  # threshold for "large trade" imbalance

    def __init__(self, provider, store, coins: list[str] | None = None):
        """
        Args:
            provider: HyperliquidProvider (or PaperProvider wrapping it)
            store: SatelliteStore for DB writes
            coins: coins to track (default BTC only)
        """
        self._provider = provider
        self._store = store
        self._coins = coins or ["BTC"]
        self._running = False
        self._thread: threading.Thread | None = None
        self._write_buffer: list[TickSnapshot] = []
        self._buffer_lock = threading.Lock()

        # Price history for momentum features (per coin)
        self._price_history: dict[str, deque] = {
            coin: deque(maxlen=120)  # 2 min of 1s prices
            for coin in self._coins
        }

        # Cached trade data from data-layer (refreshed every 5s)
        self._trade_cache: dict[str, list] = {}
        self._trade_cache_time: dict[str, float] = {}
        self._trade_cache_ttl = 5.0  # seconds

        # Stats
        self.snapshots_computed = 0
        self.snapshots_written = 0
        self.compute_errors = 0
        self.write_errors = 0

    def start(self):
        """Launch background computation thread."""
        if self._thread and self._thread.is_alive():
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._run,
            daemon=True,
            name="hynous-tick-features",
        )
        self._thread.start()
        log.warning("TickFeatureEngine started for %s", self._coins)

    def stop(self):
        """Signal thread to stop."""
        self._running = False

    def _run(self):
        """Main loop: compute every 1s, write every 5s."""
        last_write = time.time()

        while self._running:
            t0 = time.time()

            # Compute features for each coin
            for coin in self._coins:
                try:
                    snap = self._compute(coin)
                    if snap:
                        with self._buffer_lock:
                            self._write_buffer.append(snap)
                        self.snapshots_computed += 1
                except Exception:
                    self.compute_errors += 1
                    if self.compute_errors <= 5 or self.compute_errors % 100 == 0:
                        log.warning(
                            "Tick feature compute error (%d total)",
                            self.compute_errors, exc_info=True,
                        )

            # Batch write every WRITE_INTERVAL
            if time.time() - last_write >= self.WRITE_INTERVAL:
                self._flush_buffer()
                last_write = time.time()

            # Sleep remainder of interval
            elapsed = time.time() - t0
            sleep_time = max(0, self.COMPUTE_INTERVAL - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

        # Final flush on shutdown
        self._flush_buffer()

    def _compute(self, coin: str) -> TickSnapshot | None:
        """Compute all tick features for one coin from live WS data."""
        now = time.time()

        # Get L2 book from WS
        real = getattr(self._provider, "_real", self._provider)
        feed = getattr(real, "_market_feed", None)
        if not feed:
            return None

        book = feed.get_l2_book(coin)
        if not book or not book.get("bids") or not book.get("asks"):
            return None

        bids = book["bids"]
        asks = book["asks"]
        mid = book.get("mid_price", 0)
        if not mid or mid <= 0:
            return None

        # Track price for momentum
        self._price_history[coin].append((now, mid))

        # Get trade data from data-layer order flow API (cached, refreshed every 5s)
        trades = self._get_cached_trades(coin, now)

        features = {}

        # === ORDERBOOK IMBALANCE ===
        for depth, label in [(5, "5"), (10, "10"), (20, "20")]:
            bid_vol = sum(b["price"] * b["size"] for b in bids[:depth])
            ask_vol = sum(a["price"] * a["size"] for a in asks[:depth])
            total = bid_vol + ask_vol
            features[f"book_imbalance_{label}"] = bid_vol / total if total > 0 else 0.5

        # === DEPTH METRICS ===
        features["bid_depth_usd_5"] = sum(b["price"] * b["size"] for b in bids[:5])
        features["ask_depth_usd_5"] = sum(a["price"] * a["size"] for a in asks[:5])
        features["spread_pct"] = book.get("spread", 0) / mid if mid else 0
        features["mid_price"] = mid

        # === VWAP DEVIATIONS ===
        now_ms = int(now * 1000)
        recent_trades = [t for t in trades if t["time"] > now_ms - 60_000]  # last 60s

        buy_trades = [t for t in recent_trades if t["side"] == "B"]
        sell_trades = [t for t in recent_trades if t["side"] == "A"]

        if buy_trades:
            buy_notional = sum(t["px"] * t["sz"] for t in buy_trades)
            buy_volume = sum(t["sz"] for t in buy_trades)
            buy_vwap = buy_notional / buy_volume if buy_volume > 0 else mid
            features["buy_vwap_deviation"] = (buy_vwap - mid) / mid
        else:
            features["buy_vwap_deviation"] = 0.0

        if sell_trades:
            sell_notional = sum(t["px"] * t["sz"] for t in sell_trades)
            sell_volume = sum(t["sz"] for t in sell_trades)
            sell_vwap = sell_notional / sell_volume if sell_volume > 0 else mid
            features["sell_vwap_deviation"] = (sell_vwap - mid) / mid
        else:
            features["sell_vwap_deviation"] = 0.0

        # === TRADE FLOW AT MULTIPLE WINDOWS ===
        for window_s, label in [(10, "10s"), (30, "30s"), (60, "60s")]:
            cutoff = now_ms - window_s * 1000
            window_trades = [t for t in recent_trades if t["time"] > cutoff]

            buy_vol = sum(t["px"] * t["sz"] for t in window_trades if t["side"] == "B")
            sell_vol = sum(t["px"] * t["sz"] for t in window_trades if t["side"] == "A")
            total_vol = buy_vol + sell_vol

            features[f"flow_imbalance_{label}"] = buy_vol / total_vol if total_vol > 0 else 0.5

            if label in ("10s", "30s"):
                features[f"flow_intensity_{label}"] = len(window_trades) / window_s

            if label in ("10s", "30s"):
                features[f"trade_volume_{label}_usd"] = total_vol

        # === MOMENTUM ===
        price_hist = list(self._price_history[coin])
        for window_s, label in [(10, "10s"), (30, "30s"), (60, "60s")]:
            cutoff = now - window_s
            past_prices = [(t, p) for t, p in price_hist if t <= cutoff + 1 and t >= cutoff - 1]
            if past_prices and mid > 0:
                past_price = past_prices[0][1]
                features[f"price_change_{label}"] = (mid - past_price) / past_price * 100
            else:
                features[f"price_change_{label}"] = 0.0

        # === LARGE TRADE IMBALANCE ===
        large_buys = sum(t["px"] * t["sz"] for t in recent_trades
                        if t["side"] == "B" and t["px"] * t["sz"] >= self.LARGE_TRADE_USD)
        large_sells = sum(t["px"] * t["sz"] for t in recent_trades
                         if t["side"] == "A" and t["px"] * t["sz"] >= self.LARGE_TRADE_USD)
        large_total = large_buys + large_sells
        features["large_trade_imbalance"] = large_buys / large_total if large_total > 0 else 0.5

        # Validate: no NaN or inf
        for k, v in features.items():
            if math.isnan(v) or math.isinf(v):
                features[k] = 0.0

        return TickSnapshot(
            timestamp=now,
            coin=coin,
            features=features,
        )

    def _get_cached_trades(self, coin: str, now: float) -> list:
        """Get recent trades from data-layer, cached for 5s.

        Returns list of dicts with keys: px, sz, side, time (ms).
        Falls back to empty list if data-layer is unreachable.
        """
        cache_age = now - self._trade_cache_time.get(coin, 0)
        if cache_age < self._trade_cache_ttl and coin in self._trade_cache:
            return self._trade_cache[coin]

        try:
            import urllib.request
            import json
            url = "http://127.0.0.1:8100/v1/orderflow/%s" % coin
            req = urllib.request.Request(url, method="GET")
            resp = urllib.request.urlopen(req, timeout=2)
            data = json.loads(resp.read())

            # Convert order flow windows to trade-like records for feature computation
            # We don't get individual trades, but we get buy/sell volume per window
            trades = []
            for label, window in data.get("windows", {}).items():
                buy_vol = window.get("buy_volume_usd", 0)
                sell_vol = window.get("sell_volume_usd", 0)
                buy_count = window.get("buy_count", 0)
                sell_count = window.get("sell_count", 0)

                # Synthesize trade records from aggregate data
                mid = self._price_history.get(coin, deque())
                current_price = mid[-1][1] if mid else 0

                if current_price > 0:
                    if buy_count > 0:
                        avg_buy_size = buy_vol / buy_count / current_price
                        for _ in range(min(buy_count, 100)):  # cap to avoid memory issues
                            trades.append({
                                "px": current_price,
                                "sz": avg_buy_size,
                                "side": "B",
                                "time": int(now * 1000),
                            })
                    if sell_count > 0:
                        avg_sell_size = sell_vol / sell_count / current_price
                        for _ in range(min(sell_count, 100)):
                            trades.append({
                                "px": current_price,
                                "sz": avg_sell_size,
                                "side": "A",
                                "time": int(now * 1000),
                            })

            self._trade_cache[coin] = trades
            self._trade_cache_time[coin] = now
            return trades

        except Exception:
            return self._trade_cache.get(coin, [])

    def _flush_buffer(self):
        """Write buffered snapshots to DB."""
        with self._buffer_lock:
            if not self._write_buffer:
                return
            batch = self._write_buffer.copy()
            self._write_buffer.clear()

        try:
            conn = self._store.conn
            placeholders = ", ".join(["?"] * (2 + TICK_FEATURE_COUNT + 1))
            cols = ["timestamp", "coin"] + TICK_FEATURE_NAMES + ["schema_version"]
            col_str = ", ".join(cols)

            with self._store.write_lock:
                conn.executemany(
                    f"INSERT OR IGNORE INTO tick_snapshots ({col_str}) VALUES ({placeholders})",
                    [s.to_row() for s in batch],
                )
                conn.commit()

            self.snapshots_written += len(batch)
        except Exception:
            self.write_errors += 1
            if self.write_errors <= 5 or self.write_errors % 100 == 0:
                log.warning(
                    "Tick feature write error (%d total, %d in batch)",
                    self.write_errors, len(batch), exc_info=True,
                )

    def get_status(self) -> dict:
        """Status for daemon health reporting."""
        return {
            "running": self._running,
            "computed": self.snapshots_computed,
            "written": self.snapshots_written,
            "compute_errors": self.compute_errors,
            "write_errors": self.write_errors,
            "buffer_size": len(self._write_buffer),
        }
