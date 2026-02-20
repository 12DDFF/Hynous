"""Token bucket rate limiter for Hyperliquid API (1200 weight/min)."""

import time
import threading
import logging

log = logging.getLogger(__name__)


class RateLimiter:
    """Thread-safe token bucket rate limiter.

    Tokens refill continuously. acquire() blocks until enough tokens are available.
    """

    def __init__(self, max_weight: int = 1200, safety_pct: int = 85):
        self._max = max_weight * safety_pct // 100  # effective budget
        self._tokens = float(self._max)
        self._refill_rate = self._max / 60.0  # tokens per second
        self._last_refill = time.monotonic()
        self._lock = threading.Lock()
        # Stats
        self.total_acquired = 0
        self.total_waited_s = 0.0

    @property
    def available(self) -> float:
        with self._lock:
            self._refill()
            return self._tokens

    def _refill(self):
        """Add tokens based on elapsed time (must hold lock)."""
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens = min(self._max, self._tokens + elapsed * self._refill_rate)
        self._last_refill = now

    def acquire(self, weight: int = 2, timeout: float = 30.0) -> bool:
        """Block until `weight` tokens are available. Returns False on timeout."""
        deadline = time.monotonic() + timeout
        while True:
            with self._lock:
                self._refill()
                if self._tokens >= weight:
                    self._tokens -= weight
                    self.total_acquired += weight
                    return True
            # Not enough tokens — wait and retry
            wait = weight / self._refill_rate  # estimated wait
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                log.warning("Rate limiter timeout acquiring %d weight", weight)
                return False
            sleep_time = min(wait * 0.5, remaining, 1.0)
            time.sleep(sleep_time)
            with self._lock:
                self.total_waited_s += sleep_time

    def stats(self) -> dict:
        with self._lock:
            self._refill()
            return {
                "available": round(self._tokens, 1),
                "max": self._max,
                "total_acquired": self.total_acquired,
                "total_waited_s": round(self.total_waited_s, 2),
            }
