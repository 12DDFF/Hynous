"""WebSocket L2 order book subscriber — 100 levels/side, zero REST weight.

Maintains an in-memory snapshot of the order book for each subscribed coin.
Updated in real-time via Hyperliquid WebSocket push.

Design: SPEC-01, ml-011 §3
"""

import json
import logging
import threading
import time

log = logging.getLogger(__name__)


def safe_float(val, default: float = 0.0) -> float:
    """Convert to float safely."""
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


class L2Subscriber:
    """WebSocket subscriber for L2 order book data.

    Maintains an in-memory snapshot of the order book (100 levels/side)
    for each subscribed coin. Updated in real-time via WebSocket push.

    Usage:
        sub = L2Subscriber(coins=["BTC", "ETH", "SOL"])
        sub.start()
        book = sub.get_book("BTC")  # {bids: [...], asks: [...], mid: float}
        sub.stop()
    """

    def __init__(
        self,
        coins: list[str],
        url: str = "wss://api.hyperliquid.xyz/ws",
    ):
        self._coins = coins
        self._url = url
        self._books: dict[str, dict] = {}
        self._books_lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._connected = False
        self._last_update: dict[str, float] = {}

    def start(self) -> None:
        """Start WebSocket connection in background thread."""
        self._thread = threading.Thread(
            target=self._run_with_reconnect,
            name="l2-subscriber",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        """Signal stop and wait for thread to exit."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)

    def get_book(self, coin: str) -> dict | None:
        """Get current order book snapshot for a coin.

        Returns:
            Dict with keys: bids, asks, mid, spread, updated_at.
            Each bid/ask is (price, size) sorted by price.
            None if no data received yet.
        """
        with self._books_lock:
            return self._books.get(coin)

    def get_mid(self, coin: str) -> float | None:
        """Get current mid price for a coin."""
        book = self.get_book(coin)
        return book["mid"] if book else None

    @property
    def is_healthy(self) -> bool:
        """True if connected and receiving updates within last 30s."""
        if not self._connected:
            return False
        now = time.time()
        return all(
            now - self._last_update.get(c, 0) < 30
            for c in self._coins
        )

    def _run_with_reconnect(self) -> None:
        """Connect with automatic reconnection on failure."""
        while not self._stop_event.is_set():
            try:
                self._run()
            except Exception:
                log.exception(
                    "L2 subscriber connection error, reconnecting in 5s"
                )
            self._connected = False
            self._stop_event.wait(5)

    def _run(self) -> None:
        """Main WebSocket loop."""
        import websockets.sync.client as ws_client

        with ws_client.connect(self._url) as ws:
            self._connected = True
            log.info("L2 subscriber connected to %s", self._url)

            # Subscribe to L2 book for each coin
            for coin in self._coins:
                ws.send(json.dumps({
                    "method": "subscribe",
                    "subscription": {"type": "l2Book", "coin": coin},
                }))

            while not self._stop_event.is_set():
                try:
                    msg = ws.recv(timeout=10)
                except TimeoutError:
                    continue

                data = json.loads(msg)
                self._handle_message(data)

        self._connected = False

    def _handle_message(self, data: dict) -> None:
        """Process incoming L2 book message."""
        channel = data.get("channel")
        if channel != "l2Book":
            return

        book_data = data.get("data", {})
        coin = book_data.get("coin")
        if not coin or coin not in self._coins:
            return

        levels = book_data.get("levels", [])
        if len(levels) < 2:
            return

        bids = [
            (safe_float(lvl["px"]), safe_float(lvl["sz"]))
            for lvl in levels[0]
        ]
        asks = [
            (safe_float(lvl["px"]), safe_float(lvl["sz"]))
            for lvl in levels[1]
        ]

        best_bid = bids[0][0] if bids else 0
        best_ask = asks[0][0] if asks else 0
        mid = (best_bid + best_ask) / 2 if best_bid and best_ask else 0

        snapshot = {
            "bids": bids,
            "asks": asks,
            "mid": mid,
            "spread": best_ask - best_bid if best_bid and best_ask else 0,
            "spread_bps": (
                (best_ask - best_bid) / mid * 10000 if mid else 0
            ),
            "bid_depth_usd": sum(px * sz for px, sz in bids),
            "ask_depth_usd": sum(px * sz for px, sz in asks),
            "levels_count": len(bids),
            "updated_at": time.time(),
        }

        with self._books_lock:
            self._books[coin] = snapshot
        self._last_update[coin] = time.time()

    def stats(self) -> dict:
        return {
            "connected": self._connected,
            "healthy": self.is_healthy,
            "coins": self._coins,
            "books_cached": len(self._books),
        }
