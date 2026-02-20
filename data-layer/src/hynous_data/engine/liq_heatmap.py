"""Liquidation heatmap engine — positions → liquidation price buckets."""

import time
import threading
import logging

from hyperliquid.info import Info

from hynous_data.core.config import HeatmapConfig
from hynous_data.core.db import Database
from hynous_data.core.rate_limiter import RateLimiter

log = logging.getLogger(__name__)


class LiqHeatmapEngine:
    """Periodically recomputes liquidation heatmaps from the positions table."""

    def __init__(self, db: Database, config: HeatmapConfig,
                 base_url: str = "https://api.hyperliquid.xyz",
                 rate_limiter: RateLimiter | None = None):
        self._db = db
        self._cfg = config
        self._rl = rate_limiter
        self._info = Info(base_url=base_url, skip_ws=True)
        # Cache: coin → heatmap dict
        self._cache: dict[str, dict] = {}
        self._cache_lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._last_recompute = 0.0

    def start(self):
        self._thread = threading.Thread(target=self._run, name="liq-heatmap", daemon=True)
        self._thread.start()

    def _run(self):
        log.info("LiqHeatmapEngine starting (interval=%ds)", self._cfg.recompute_interval)
        while not self._stop_event.is_set():
            try:
                self._recompute_all()
            except Exception:
                log.exception("Heatmap recompute error")
            self._stop_event.wait(self._cfg.recompute_interval)

    def _recompute_all(self):
        """Recompute heatmaps for all coins with positions."""
        conn = self._db.conn

        # Get distinct coins with positions
        coins = [r["coin"] for r in conn.execute(
            "SELECT DISTINCT coin FROM positions"
        ).fetchall()]

        # Fetch current mid prices (counted against rate limiter)
        if self._rl and not self._rl.acquire(2, timeout=10):
            log.debug("Rate limiter blocked heatmap all_mids()")
            return
        try:
            mids = self._info.all_mids()
        except Exception:
            log.debug("Failed to fetch mid prices for heatmap")
            return

        new_cache = {}
        for coin in coins:
            mid_px = float(mids.get(coin, 0))
            if mid_px <= 0:
                continue
            heatmap = self._compute_coin_heatmap(coin, mid_px)
            if heatmap:
                new_cache[coin] = heatmap

        with self._cache_lock:
            self._cache = new_cache
        self._last_recompute = time.time()

    def _compute_coin_heatmap(self, coin: str, mid_px: float) -> dict | None:
        """Compute heatmap for a single coin."""
        conn = self._db.conn

        # Get all positions for this coin
        rows = conn.execute(
            "SELECT side, size_usd, liq_px FROM positions WHERE coin = ? AND liq_px IS NOT NULL AND liq_px > 0",
            (coin,),
        ).fetchall()

        if not rows:
            return None

        # Define price range
        range_pct = self._cfg.range_pct / 100
        low = mid_px * (1 - range_pct)
        high = mid_px * (1 + range_pct)
        n_buckets = self._cfg.bucket_count
        bucket_size = (high - low) / n_buckets

        # Initialize buckets
        buckets = []
        for i in range(n_buckets):
            price_low = low + i * bucket_size
            price_high = price_low + bucket_size
            buckets.append({
                "price_low": round(price_low, 2),
                "price_high": round(price_high, 2),
                "price_mid": round((price_low + price_high) / 2, 2),
                "long_liq_usd": 0.0,
                "short_liq_usd": 0.0,
                "long_count": 0,
                "short_count": 0,
            })

        # Assign liquidation prices to buckets
        total_long_liq = 0.0
        total_short_liq = 0.0

        for row in rows:
            liq_px = row["liq_px"]
            if liq_px is None or liq_px <= 0:
                continue
            if liq_px < low or liq_px >= high:
                continue

            idx = int((liq_px - low) / bucket_size)
            idx = min(idx, n_buckets - 1)
            size_usd = row["size_usd"]

            if row["side"] == "long":
                buckets[idx]["long_liq_usd"] += size_usd
                buckets[idx]["long_count"] += 1
                total_long_liq += size_usd
            else:
                buckets[idx]["short_liq_usd"] += size_usd
                buckets[idx]["short_count"] += 1
                total_short_liq += size_usd

        # Round values
        for b in buckets:
            b["long_liq_usd"] = round(b["long_liq_usd"], 2)
            b["short_liq_usd"] = round(b["short_liq_usd"], 2)

        return {
            "coin": coin,
            "mid_price": mid_px,
            "range_pct": self._cfg.range_pct,
            "bucket_count": n_buckets,
            "buckets": buckets,
            "summary": {
                "total_long_liq_usd": round(total_long_liq, 2),
                "total_short_liq_usd": round(total_short_liq, 2),
                "total_positions": len(rows),
                "computed_at": time.time(),
            },
        }

    def get_heatmap(self, coin: str) -> dict | None:
        """Get cached heatmap for a coin."""
        with self._cache_lock:
            return self._cache.get(coin)

    def get_available_coins(self) -> list[str]:
        with self._cache_lock:
            return list(self._cache.keys())

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)

    def stats(self) -> dict:
        return {
            "cached_coins": len(self._cache),
            "last_recompute": self._last_recompute,
        }
