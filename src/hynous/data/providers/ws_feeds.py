"""WebSocket feed manager for Hyperliquid market data.

Manages a single WS connection subscribing to multiple channels:
- allMids: all mid prices (sub-second)
- l2Book: L2 orderbook per coin (every ~500ms)
- activeAssetCtx: funding, OI, volume per coin (real-time)

Each channel maintains a state dict that is atomically replaced on each
message (GIL-safe, no locks). Provider methods check these dicts first,
falling back to REST if the WS data is stale (>30s).

Follows the same pattern as the original daemon._run_ws_price_feed()
but manages multiple channels on one connection.
"""

import json
import logging
import threading
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Staleness threshold: if no WS message in this many seconds, consider stale.
# Callers fall back to REST when stale.
WS_STALE_THRESHOLD = 30.0

# Reconnect backoff: starts at 5s, doubles each failure, caps at 60s.
RECONNECT_INITIAL = 5
RECONNECT_MAX = 60


@dataclass
class FeedHealth:
    """Health snapshot for status reporting."""
    connected: bool = False
    last_msg_age: float | None = None
    price_count: int = 0
    l2_book_coins: int = 0
    asset_ctx_coins: int = 0
    reconnect_count: int = 0


class MarketDataFeed:
    """Manages a single WS connection for public Hyperliquid market data.

    Usage:
        feed = MarketDataFeed(coins=["BTC", "ETH", "SOL"])
        feed.start()

        # Provider methods call these — returns None if stale/unavailable:
        prices = feed.get_prices()        # dict[str, float] or None
        book = feed.get_l2_book("BTC")    # dict or None
        ctx = feed.get_asset_ctx("BTC")   # dict or None

        feed.stop()
    """

    WS_URL = "wss://api.hyperliquid.xyz/ws"

    def __init__(self, coins: list[str]):
        self._coins = list(coins)
        self._running = False

        # --- State dicts (atomically replaced by WS callbacks) ---
        # allMids: {coin: price_float}
        self._prices: dict[str, float] = {}
        self._prices_time: float = 0.0

        # l2Book: {coin: provider-format dict}
        # Format per coin: {"bids": [...], "asks": [...], "best_bid": float, ...}
        self._l2_books: dict[str, dict] = {}
        self._l2_books_time: dict[str, float] = {}

        # activeAssetCtx: {coin: provider-format dict}
        # Format per coin: {"funding": float, "open_interest": float, ...}
        self._asset_ctxs: dict[str, dict] = {}
        self._asset_ctxs_time: dict[str, float] = {}

        # --- Health ---
        self._connected: bool = False
        self._last_msg: float = 0.0
        self._reconnect_count: int = 0
        self._thread: threading.Thread | None = None
        self._ws = None  # Reference to live WebSocketApp (for update_coins)

    # ------------------------------------------------------------------
    # Public API (called by provider methods)
    # ------------------------------------------------------------------

    def start(self):
        """Launch background WS thread. Idempotent."""
        if self._thread and self._thread.is_alive():
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._run,
            daemon=True,
            name="hynous-ws-market",
        )
        self._thread.start()
        logger.warning("MarketDataFeed started for coins: %s", self._coins)

    def stop(self):
        """Signal WS thread to stop."""
        self._running = False

    def update_coins(self, coins: list[str]):
        """Update tracked coins and subscribe to new ones immediately.

        New coins are subscribed on the live connection if connected.
        Removed coins stay subscribed until next reconnect (harmless —
        extra data is simply ignored).
        """
        old_coins = set(self._coins)
        self._coins = list(coins)
        new_coins = set(coins) - old_coins

        # Subscribe new coins on the live connection if possible
        if new_coins and self._connected and self._ws:
            for coin in new_coins:
                try:
                    self._ws.send(json.dumps({
                        "method": "subscribe",
                        "subscription": {"type": "l2Book", "coin": coin},
                    }))
                    self._ws.send(json.dumps({
                        "method": "subscribe",
                        "subscription": {"type": "activeAssetCtx", "coin": coin},
                    }))
                except Exception:
                    logger.debug("Failed to subscribe new coin %s", coin)

    def get_prices(self) -> dict[str, float] | None:
        """Return WS-fed prices if fresh (<30s), else None (caller uses REST)."""
        if self._prices and (time.time() - self._prices_time) < WS_STALE_THRESHOLD:
            return self._prices
        return None

    def get_l2_book(self, coin: str) -> dict | None:
        """Return WS-fed L2 book for coin if fresh (<30s), else None."""
        book = self._l2_books.get(coin)
        ts = self._l2_books_time.get(coin, 0)
        if book and (time.time() - ts) < WS_STALE_THRESHOLD:
            return book
        return None

    def get_asset_ctx(self, coin: str) -> dict | None:
        """Return WS-fed asset context for coin if fresh (<30s), else None."""
        ctx = self._asset_ctxs.get(coin)
        ts = self._asset_ctxs_time.get(coin, 0)
        if ctx and (time.time() - ts) < WS_STALE_THRESHOLD:
            return ctx
        return None

    def get_health(self) -> FeedHealth:
        """Return health snapshot for status reporting."""
        return FeedHealth(
            connected=self._connected,
            last_msg_age=round(time.time() - self._last_msg, 1) if self._last_msg else None,
            price_count=len(self._prices),
            l2_book_coins=len(self._l2_books),
            asset_ctx_coins=len(self._asset_ctxs),
            reconnect_count=self._reconnect_count,
        )

    @property
    def connected(self) -> bool:
        return self._connected

    # ------------------------------------------------------------------
    # Background thread
    # ------------------------------------------------------------------

    def _run(self):
        """Background thread: connect, subscribe, handle messages, reconnect."""
        try:
            import websocket as _ws_lib
        except ImportError:
            logger.error(
                "websocket-client not installed — WS market feed disabled. "
                "Install with: pip install websocket-client"
            )
            return

        reconnect_delay = RECONNECT_INITIAL

        while self._running:
            try:
                logger.warning(
                    "WS market feed connecting to %s (coins: %s)...",
                    self.WS_URL, self._coins,
                )

                def on_open(ws):
                    nonlocal reconnect_delay
                    self._ws = ws  # Store reference for update_coins()
                    self._connected = True
                    self._last_msg = time.time()
                    reconnect_delay = RECONNECT_INITIAL

                    # Subscribe to all channels
                    subs = self._build_subscriptions()
                    for sub in subs:
                        ws.send(json.dumps(sub))

                    logger.warning(
                        "WS market feed connected — %d subscriptions sent",
                        len(subs),
                    )

                def on_message(ws, raw):
                    try:
                        msg = json.loads(raw)
                        channel = msg.get("channel")
                        data = msg.get("data")
                        if not channel or data is None:
                            return

                        self._last_msg = time.time()

                        if channel == "allMids":
                            self._handle_all_mids(data)
                        elif channel == "l2Book":
                            self._handle_l2_book(data)
                        elif channel == "activeAssetCtx":
                            self._handle_asset_ctx(data)
                        # Ignore other channels (pong, etc.)
                    except Exception:
                        logger.debug("WS market feed parse error", exc_info=True)

                def on_close(ws, code=None, msg=None):
                    self._connected = False
                    self._ws = None
                    logger.warning("WS market feed disconnected (code=%s)", code)

                def on_error(ws, err):
                    logger.warning("WS market feed error: %s", err)

                ws = _ws_lib.WebSocketApp(
                    self.WS_URL,
                    on_open=on_open,
                    on_message=on_message,
                    on_close=on_close,
                    on_error=on_error,
                )
                ws.run_forever(ping_interval=30, ping_timeout=10)

            except Exception as e:
                logger.warning("WS market feed crashed: %s", e)

            self._connected = False
            self._ws = None
            if not self._running:
                break

            self._reconnect_count += 1
            logger.warning("WS market feed reconnecting in %ds...", reconnect_delay)

            # Interruptible sleep (0.5s increments)
            for _ in range(int(reconnect_delay * 2)):
                if not self._running:
                    break
                time.sleep(0.5)

            reconnect_delay = min(reconnect_delay * 2, RECONNECT_MAX)

    # ------------------------------------------------------------------
    # Subscription building
    # ------------------------------------------------------------------

    def _build_subscriptions(self) -> list[dict]:
        """Build all subscription messages for current coin set."""
        subs = [
            {"method": "subscribe", "subscription": {"type": "allMids"}},
        ]
        for coin in self._coins:
            subs.append({
                "method": "subscribe",
                "subscription": {"type": "l2Book", "coin": coin},
            })
            subs.append({
                "method": "subscribe",
                "subscription": {"type": "activeAssetCtx", "coin": coin},
            })
        return subs

    # ------------------------------------------------------------------
    # Message handlers — transform WS data to provider format
    # ------------------------------------------------------------------

    def _handle_all_mids(self, data: dict):
        """Handle allMids message. Atomically replace prices dict.

        WS format: {"mids": {"BTC": "97432.5", "ETH": "3421.8", ...}}
        Provider format: {"BTC": 97432.5, "ETH": 3421.8, ...}
        """
        mids = data.get("mids")
        if not mids:
            return
        # Atomic dict replacement — GIL-safe
        self._prices = {k: float(v) for k, v in mids.items()}
        self._prices_time = time.time()

    def _handle_l2_book(self, data: dict):
        """Handle l2Book message. Transform to provider format.

        WS format:
            {"coin": "BTC", "levels": [[bids], [asks]], "time": 1234567890}
            Each level: {"px": "97400.0", "sz": "0.5", "n": 3}

        Provider format (what get_l2_book() returns):
            {
                "bids": [{"price": 97400.0, "size": 0.5, "orders": 3}, ...],
                "asks": [{"price": 97410.0, "size": 0.3, "orders": 1}, ...],
                "best_bid": 97400.0,
                "best_ask": 97410.0,
                "mid_price": 97405.0,
                "spread": 10.0,
            }
        """
        coin = data.get("coin")
        levels = data.get("levels")
        if not coin or not levels or len(levels) < 2:
            return

        bids = [
            {"price": float(lv["px"]), "size": float(lv["sz"]), "orders": int(lv.get("n", 1))}
            for lv in levels[0]
            if "px" in lv and "sz" in lv
        ]
        asks = [
            {"price": float(lv["px"]), "size": float(lv["sz"]), "orders": int(lv.get("n", 1))}
            for lv in levels[1]
            if "px" in lv and "sz" in lv
        ]

        best_bid = bids[0]["price"] if bids else 0.0
        best_ask = asks[0]["price"] if asks else 0.0

        book = {
            "bids": bids,
            "asks": asks,
            "best_bid": best_bid,
            "best_ask": best_ask,
            "mid_price": (best_bid + best_ask) / 2 if best_bid and best_ask else 0.0,
            "spread": best_ask - best_bid if best_bid and best_ask else 0.0,
        }

        # Atomic replacement of this coin's book (copy-on-write, GIL-safe)
        new_books = dict(self._l2_books)
        new_books[coin] = book
        self._l2_books = new_books
        self._l2_books_time = {**self._l2_books_time, coin: time.time()}

    def _handle_asset_ctx(self, data: dict):
        """Handle activeAssetCtx message. Transform to provider format.

        WS format (PerpAssetCtx):
            {
                "coin": "BTC",
                "ctx": {
                    "funding": "0.000125",
                    "openInterest": "45000.5",
                    "dayNtlVlm": "2400000000",
                    "markPx": "97432.5",
                    "prevDayPx": "96500.0",
                    ...
                }
            }

        Provider format (what get_asset_context() returns):
            {
                "funding": 0.000125,
                "open_interest": 45000.5,
                "day_volume": 2400000000.0,
                "mark_price": 97432.5,
                "prev_day_price": 96500.0,
            }
        """
        coin = data.get("coin")
        ctx = data.get("ctx")
        if not coin or not ctx:
            return

        transformed = {
            "funding": float(ctx.get("funding", "0")),
            "open_interest": float(ctx.get("openInterest", "0")),
            "day_volume": float(ctx.get("dayNtlVlm", "0")),
            "mark_price": float(ctx["markPx"]) if ctx.get("markPx") else None,
            "prev_day_price": float(ctx.get("prevDayPx", "0")),
        }

        # Atomic replacement of this coin's context (copy-on-write, GIL-safe)
        new_ctxs = dict(self._asset_ctxs)
        new_ctxs[coin] = transformed
        self._asset_ctxs = new_ctxs
        self._asset_ctxs_time = {**self._asset_ctxs_time, coin: time.time()}
