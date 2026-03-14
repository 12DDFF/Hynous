# WebSocket Migration — Implementation Guide

> **Status:** Ready for implementation
> **Priority:** High — Phase 1 (Market Data) first, Phase 2 (Account Data) second
> **Estimated scope:** 1 new file (~350 lines), 3 modified files, ~120 lines removed from daemon

---

## Pre-Reading Requirements

**The engineer MUST read these files IN FULL before writing any code:**

### Architecture Context
1. `docs/revisions/ws-migration/README.md` — Migration overview, WS channel reference, connection strategy
2. `docs/revisions/ws-price-feed/README.md` — Existing allMids WS pattern (being moved)
3. `docs/integration.md` — Cross-system data flows (daemon ↔ provider ↔ scanner ↔ satellite)
4. `ARCHITECTURE.md` — System overview (especially "Data Flow" section)

### Files Being Modified
5. `src/hynous/data/providers/hyperliquid.py` — **Full file** (863 lines). Understand every public method, the `_info` vs `_trade_info` split, `_fetch_all_mids()` caching, return shapes.
6. `src/hynous/intelligence/daemon.py` — Read these sections:
   - Lines 555-558: `_ws_prices`, `_ws_connected`, `_ws_last_msg` initialization
   - Lines 893-899: WS status in `_build_status_dict()`
   - Lines 1013-1019: WS thread launch in `_loop_inner()`
   - Lines 1041-1047: WS health monitor in main loop
   - Lines 1261-1313: `_poll_prices()` — full method
   - Lines 1315-1408: `_run_ws_price_feed()` + `_get_prices_with_ws_fallback()` — full methods
   - Lines 1410-1605: `_poll_derivatives()` — full method
   - Lines 2099-2200: `_fast_trigger_check()` — price fetch + trigger check flow
   - Line 5558: `_wake_agent()` price refresh
7. `src/hynous/core/config.py` — `DaemonConfig` dataclass and `load_config()` function

### Existing WS Patterns (reference only)
8. `data-layer/src/hynous_data/collectors/l2_subscriber.py` — L2Book WS parsing pattern
9. `data-layer/src/hynous_data/collectors/trade_stream.py` — Trades WS + SDK pattern

### Data Consumers (understand what format they expect)
10. `src/hynous/intelligence/scanner.py` — `ingest_prices()`, `ingest_orderbooks()`, `ingest_derivatives()`, `ingest_candles()` method signatures and expected data shapes
11. `src/hynous/intelligence/briefing.py` — `DataCache._fetch_orderbook()`, `DataCache._fetch_candles_7d()`, `DataCache._fetch_funding_7d()`
12. `src/hynous/data/providers/paper.py` — delegation pattern, `check_triggers(prices)` method

---

## Architecture Overview

### What Changes

```
BEFORE:                                 AFTER:

daemon.py                               daemon.py (simplified)
├─ _run_ws_price_feed() [allMids]       ├─ calls provider.start_ws() on startup
├─ _ws_prices, _ws_connected            ├─ _poll_prices() unchanged (provider handles WS/REST)
├─ _get_prices_with_ws_fallback()       ├─ _poll_derivatives() unchanged (provider handles WS/REST)
├─ _poll_prices() → REST L2, candles    └─ _fast_trigger_check() → provider.get_all_prices()
├─ _poll_derivatives() → REST contexts
└─ WS health check in main loop         ws_feeds.py (NEW)
                                         ├─ MarketDataFeed class
hyperliquid.py (REST only)               │  ├─ allMids channel → _prices
├─ get_all_prices() → REST               │  ├─ l2Book channels → _l2_books
├─ get_l2_book() → REST                  │  └─ activeAssetCtx channels → _asset_ctxs
├─ get_asset_context() → REST            └─ (Phase 2: AccountDataFeed)
└─ skip_ws=True
                                         hyperliquid.py (WS-first, REST fallback)
                                         ├─ _market_feed: MarketDataFeed
                                         ├─ get_all_prices() → WS cache or REST
                                         ├─ get_l2_book() → WS cache or REST
                                         └─ get_asset_context() → WS cache or REST
```

### Design Principles

1. **Provider is the WS boundary.** All WS state lives in the provider layer. Daemon, tools, briefing, context snapshot — they all call the same provider methods as before. They don't know about WS.
2. **Every WS read has a REST fallback.** If WS is stale (>30s), the provider falls back to REST. No caller needs to handle WS failures.
3. **Atomic dict replacement for thread safety.** WS callbacks replace entire dicts atomically (GIL-safe). No locks needed. Same pattern as existing `_ws_prices`.
4. **Daemon polling structure unchanged.** `_poll_prices()` still runs every 60s, `_poll_derivatives()` every 300s. The difference is that `provider.get_l2_book()` now returns WS-cached data instantly instead of making a REST call. The polling loop feeds scanners and updates snapshots as before.

### Connection Topology

**One WS connection** for Phase 1 (market data). Subscribes to:
- `allMids` (1 subscription, all coins)
- `l2Book` (1 subscription per tracked coin)
- `activeAssetCtx` (1 subscription per tracked coin)

All channels share one connection to `wss://api.hyperliquid.xyz/ws`. A single disconnect affects all channels — acceptable because REST fallback covers the gap. This is simpler than two connections and matches the SDK's single-connection model.

Phase 2 adds a **second WS connection** for account data (different endpoint for testnet).

---

## Phase 1: Market Data WebSocket

### Step 1: Create `src/hynous/data/providers/ws_feeds.py`

**New file. ~350 lines.**

```python
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

        # Atomic replacement of this coin's book
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
                    "premium": "0.0001",
                    "oraclePx": "97430.0",
                    "midPx": "97432.5",
                    "impactPxs": [...],
                    "dayBaseVlm": "24500.0"
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

        new_ctxs = dict(self._asset_ctxs)
        new_ctxs[coin] = transformed
        self._asset_ctxs = new_ctxs
        self._asset_ctxs_time = {**self._asset_ctxs_time, coin: time.time()}
```

**Critical format details the engineer must verify:**

1. **L2 level `"n"` field:** The SDK type `L2Level` defines `{"px", "sz", "n"}`. The WS should include `"n"`. However, we use `lv.get("n", 1)` as a safety default in case it's absent. The data-layer's L2Subscriber omits `"n"` in its parsing — this is because it doesn't need order count. We DO need it because `scanner.ingest_orderbooks()` uses it.

2. **`activeAssetCtx` field names:** WS uses camelCase (`openInterest`, `dayNtlVlm`, `markPx`, `prevDayPx`). Provider returns snake_case (`open_interest`, `day_volume`, `mark_price`, `prev_day_price`). The `_handle_asset_ctx()` method performs this mapping. These field names MUST match what `get_asset_context()` in hyperliquid.py returns — verify against lines 350-365 of hyperliquid.py.

3. **Price strings → floats:** All WS numeric values arrive as strings. All provider methods return floats. Every handler must `float()` convert.

---

### Step 2: Modify `src/hynous/data/providers/hyperliquid.py`

**Changes: Add WS feed integration to provider. Methods check WS cache before REST.**

#### 2a. Add import and instance variable

At the top of the file (after the existing imports around line 28), add import:
```python
from hynous.data.providers.ws_feeds import MarketDataFeed
```

**Note on import style:** This file uses absolute imports (`from hyperliquid.info import Info`). Use the same style for consistency. Do NOT use relative imports (no `from .ws_feeds`).

In `__init__()`, after the existing `self._mids_cache` declarations, add:
```python
# WebSocket market data feed (started by daemon via start_ws())
self._market_feed: MarketDataFeed | None = None
```

#### 2b. Add `start_ws()` and `stop_ws()` methods

Add these methods after `__init__()`:
```python
def start_ws(self, coins: list[str]):
    """Start WebSocket market data feed. Called once by daemon on startup.

    Args:
        coins: List of coin symbols to subscribe to for L2 and asset context.
              allMids always subscribes to all coins regardless.
    """
    if self._market_feed is not None:
        return  # Already started
    self._market_feed = MarketDataFeed(coins=coins)
    self._market_feed.start()

def stop_ws(self):
    """Stop WebSocket feed. Called on daemon shutdown."""
    if self._market_feed:
        self._market_feed.stop()
        self._market_feed = None

@property
def ws_health(self) -> dict | None:
    """Return WS health for status reporting. None if WS not started."""
    if not self._market_feed:
        return None
    h = self._market_feed.get_health()
    return {
        "connected": h.connected,
        "last_msg_age": h.last_msg_age,
        "price_count": h.price_count,
        "l2_book_coins": h.l2_book_coins,
        "asset_ctx_coins": h.asset_ctx_coins,
        "reconnect_count": h.reconnect_count,
    }
```

#### 2c. Modify `get_all_prices()` — WS-first

Find the existing `get_all_prices()` method. Replace with:
```python
def get_all_prices(self) -> dict[str, float]:
    """Get all mid prices. Uses WS if available and fresh, else REST."""
    if self._market_feed:
        ws_prices = self._market_feed.get_prices()
        if ws_prices:
            return ws_prices
    # REST fallback
    return {symbol: float(price) for symbol, price in self._fetch_all_mids().items()}
```

**Note:** `_fetch_all_mids()` and its 2s TTL cache + retry logic remain as-is. They only execute when WS is unavailable. This is the REST fallback path.

#### 2c-bis. Modify `get_price()` — delegate to `get_all_prices()`

**CRITICAL — this was a gap in the initial review.** `get_price()` calls `_fetch_all_mids()` directly, bypassing the WS cache. It's called by 10 sites across 6 files (trading.py, market.py, multi_timeframe.py, funding.py, orderbook.py, paper.py). All would still hit REST without this fix.

Find `get_price()` (line ~647). Replace with:
```python
def get_price(self, symbol: str) -> float | None:
    """Get current mid price for a single symbol.

    Returns:
        Price as float, or None if symbol not found.
    """
    prices = self.get_all_prices()  # Uses WS cache if available
    return prices.get(symbol)
```

**Why this works:** `get_all_prices()` now checks WS first, REST fallback. The old code called `_fetch_all_mids()` (REST only) and did `float(mids.get(symbol))`. The new code calls `get_all_prices()` which already returns `dict[str, float]`, so `.get(symbol)` returns `float | None`. Behavior is identical — returns `None` for unknown symbols, `float` for known ones.

**Callers affected (all benefit from WS automatically, no changes needed):**
- `tools/trading.py:604` — `provider.get_price(symbol)` during execute_trade
- `tools/market.py:238` — `provider.get_price(symbol)` for market tool
- `tools/multi_timeframe.py:78` — `provider.get_price(symbol)` for TF analysis
- `tools/funding.py:90` — `provider.get_price(symbol)` for current funding context
- `tools/orderbook.py:75` — `provider.get_price(symbol)` for orderbook tool
- `paper.py:125` — `self._real.get_price(symbol)` (delegation)
- `paper.py:252,305` — `self.get_price(symbol)` → `self._real.get_price()` during paper trades
- `hyperliquid.py:366` — `self.get_price(symbol)` inside `market_open()` for size calc

#### 2d. Modify `get_l2_book()` — WS-first

Find the existing `get_l2_book()` method. Add WS check at the top of the method, BEFORE the REST call:
```python
def get_l2_book(self, symbol: str) -> dict | None:
    """Get L2 orderbook. Uses WS if available and fresh, else REST."""
    # WS-first: check if we have a fresh WS-fed book
    if self._market_feed:
        ws_book = self._market_feed.get_l2_book(symbol)
        if ws_book:
            return ws_book

    # REST fallback (existing code unchanged below this point)
    try:
        raw = self._info.l2_snapshot(symbol)
        # ... existing REST parsing code ...
```

**IMPORTANT:** Keep ALL existing REST code below the WS check. The REST path is the fallback.

#### 2e. Modify `get_asset_context()` — WS-first

Find the existing `get_asset_context()` method. Add WS check at the top:
```python
def get_asset_context(self, symbol: str) -> dict | None:
    """Get asset context. Uses WS if available and fresh, else REST."""
    # WS-first: check if we have a fresh WS-fed context
    if self._market_feed:
        ws_ctx = self._market_feed.get_asset_ctx(symbol)
        if ws_ctx:
            return ws_ctx

    # REST fallback (existing code unchanged below this point)
    try:
        result = self._info.meta_and_asset_ctxs()
        # ... existing REST parsing code ...
```

#### 2f. Modify `get_multi_asset_contexts()` — WS-first for tracked coins

Find the existing `get_multi_asset_contexts()` method. Add WS check:
```python
def get_multi_asset_contexts(self, symbols: list[str]) -> dict[str, dict]:
    """Get asset contexts for multiple symbols. WS-first, REST fallback."""
    result = {}
    missing = []

    # Try WS cache first for each symbol
    if self._market_feed:
        for sym in symbols:
            ws_ctx = self._market_feed.get_asset_ctx(sym)
            if ws_ctx:
                result[sym] = ws_ctx
            else:
                missing.append(sym)
    else:
        missing = list(symbols)

    # REST fallback for any symbols not in WS cache
    if missing:
        try:
            rest_result = self._rest_get_multi_asset_contexts(missing)
            result.update(rest_result)
        except Exception:
            pass  # Caller handles missing symbols

    return result
```

**CRITICAL:** Rename the existing `get_multi_asset_contexts()` implementation to `_rest_get_multi_asset_contexts()`. This preserves the REST path as a private fallback method. The existing code body moves unchanged — only the method name changes.

#### 2g. `get_all_asset_contexts()` — NO CHANGE

This method fetches the FULL universe (200+ coins) for the scanner. It stays REST-only. The WS feed only subscribes to tracked coins (3-5), not the full universe. Do not modify this method.

---

### Step 3: Modify `src/hynous/intelligence/daemon.py`

**Changes: Remove WS management from daemon. Start WS via provider. Clean up.**

#### 3a. Remove WS state variables

Delete these lines from `__init__()` (around line 555-558):
```python
# DELETE these 3 lines:
self._ws_prices: dict[str, float] = {}
self._ws_connected: bool = False
self._ws_last_msg: float = 0.0
```

#### 3b. Modify WS thread launch in `_loop_inner()`

Find the WS thread launch block (around lines 1013-1019). Replace with:
```python
# Start WebSocket market data feed via provider
if self.config.daemon.ws_price_feed:
    provider = self._get_provider()
    # Tracked coins: configured symbols + any currently open positions
    ws_coins = list(
        set(self.config.execution.symbols) | set(self._prev_positions.keys())
    )
    provider.start_ws(ws_coins)
    logger.warning("WS market data feed started via provider")
```

**Note:** The `PaperProvider` delegates to `self._real` (the `HyperliquidProvider`). We need `start_ws()` on the real provider. Check: if the provider is a PaperProvider, call `provider._real.start_ws()` instead. However, to keep the interface clean, add a `start_ws()` passthrough to PaperProvider (see Step 4).

#### 3c. Remove WS health monitor from main loop

Delete the WS health check block (around lines 1041-1047):
```python
# DELETE this block:
if self.config.daemon.ws_price_feed and self._ws_connected:
    ws_age = now - self._ws_last_msg if self._ws_last_msg else float("inf")
    if ws_age > 60:
        logger.warning(
            "WS price feed stale (last msg %.0fs ago), forcing fallback to REST",
            ws_age,
        )
        self._ws_connected = False
```

**Why removed:** Health monitoring now lives inside `MarketDataFeed`. When the feed detects staleness, `get_prices()` returns `None`, and the provider falls back to REST automatically.

#### 3d. Delete `_run_ws_price_feed()` method entirely

Delete the entire method (around lines 1315-1395, ~80 lines). This code is replaced by `MarketDataFeed._run()` in ws_feeds.py.

#### 3e. Delete `_get_prices_with_ws_fallback()` method entirely

Delete the entire method (around lines 1397-1408). This is replaced by `provider.get_all_prices()` which now handles WS/REST fallback internally.

#### 3f. Update `_fast_trigger_check()` price fetch

Find the line where `_fast_trigger_check()` gets prices (around line 2117):
```python
# BEFORE:
all_mids = self._get_prices_with_ws_fallback()

# AFTER:
all_mids = self._get_provider().get_all_prices()
```

#### 3g. Update `_wake_agent()` price refresh

Find the price refresh in `_wake_agent()` (around line 5558):
```python
# BEFORE:
fresh_prices = self._get_prices_with_ws_fallback()

# AFTER:
fresh_prices = self._get_provider().get_all_prices()
```

#### 3h. Update `_build_status_dict()` WS section

Find the WS status block (around lines 893-899). Replace with:
```python
# WS market data feed status
ws_health = None
provider = self._get_provider()
if hasattr(provider, 'ws_health'):
    ws_health = provider.ws_health
elif hasattr(provider, '_real') and hasattr(provider._real, 'ws_health'):
    ws_health = provider._real.ws_health

"ws": ws_health or {
    "connected": False,
    "last_msg_age": None,
    "price_count": 0,
},
```

#### 3i. Update coin tracking on position changes

When a new position is detected (in `_check_positions()`, around the new entry detection block), update the WS feed's coin list. Add a helper method to the Daemon class:

```python
def _update_ws_coins(self):
    """Update WS feed subscriptions when tracked coins change."""
    ws_coins = list(set(self.config.execution.symbols) | set(self._prev_positions.keys()))
    provider = self._get_provider()
    # Get the real provider (unwrap PaperProvider if needed)
    real = getattr(provider, '_real', provider)
    if hasattr(real, '_market_feed') and real._market_feed:
        real._market_feed.update_coins(ws_coins)
```

Call `self._update_ws_coins()` in `_check_positions()` after new position entries are detected (in the block where Discord notifications are sent for new entries). Also call it after `_prev_positions` is updated from a fill event.

**Why:** If the agent opens a position on a coin not in the config, we need L2 and context data for it. `update_coins()` sends new subscriptions on the live connection immediately — no reconnect needed.

---

### Step 4: Modify `src/hynous/data/providers/paper.py`

**Minimal changes: add WS passthrough.**

Add these methods to `PaperProvider`:
```python
def start_ws(self, coins: list[str]):
    """Pass through to real provider."""
    self._real.start_ws(coins)

def stop_ws(self):
    """Pass through to real provider."""
    self._real.stop_ws()

@property
def ws_health(self) -> dict | None:
    """Pass through to real provider."""
    return self._real.ws_health
```

**No other changes to paper.py.** The paper provider delegates all market data reads to `self._real`, which now serves WS-cached data. `check_triggers(prices)` receives prices as a parameter from the daemon — the daemon gets those prices from `provider.get_all_prices()` which uses WS.

---

### Step 5: Config changes

#### 5a. No new config fields needed for Phase 1

The existing `daemon.ws_price_feed: true` config flag controls whether WS feeds start. No new fields needed — the WS feed subscribes to whatever coins are in `execution.symbols`.

#### 5b. Future Phase 2 config (do NOT implement yet)

These would be added for account data WS (Phase 2):
```yaml
# NOT YET — Phase 2 only:
daemon:
  ws_account_feed: false  # Disabled until live trading
```

---

### Step 6: Verify `_poll_prices()` still works correctly

**`_poll_prices()` requires NO code changes.** Here's why:

1. `provider.get_all_prices()` — still called every 60s. Now returns WS prices instantly (no REST call). Scanner still gets `ingest_prices()`.
2. `provider.get_l2_book(sym)` — still called per tracked symbol. Now returns WS-cached books instantly. Scanner still gets `ingest_orderbooks()`.
3. `provider.get_candles(sym, "5m", ...)` — still called per symbol. **Candles stay REST** — WS candle channel doesn't provide historical ranges. No change.
4. `self.snapshot.prices[sym]` — still updated from `all_prices`. No change.
5. `self._data_changed = True` — still set. Watchpoints + scanner detect still triggered.

**Verification:** After implementation, add a temporary log line at the top of `_poll_prices()`:
```python
logger.debug("_poll_prices: provider.get_all_prices() returned %d prices", len(all_prices))
```
Confirm it returns 200+ prices (WS path) and doesn't log 429 errors.

### Step 7: Verify `_poll_derivatives()` still works correctly

**`_poll_derivatives()` requires NO code changes.** Here's why:

1. `provider.get_multi_asset_contexts(symbols)` — still called every 300s. Now returns WS-cached contexts for tracked coins (instant), REST for any missing. Scanner and snapshot still updated.
2. `provider.get_all_asset_contexts()` — still called for scanner. **Stays REST** (full universe). No change.
3. `self._record_historical_snapshots()` — still called. Uses `self.snapshot.funding/oi_usd/volume_usd` which are populated from the contexts call above.
4. `self._refresh_trigger_cache()` — still called (this is Phase 2 cleanup). No change in Phase 1.
5. Satellite tick, regime, equity snapshot — all unchanged.

**Verification:** Confirm `self.snapshot.funding["BTC"]` updates correctly from WS-fed contexts. Compare WS values vs a manual REST call to verify they match.

---

## Testing Plan

### Static Testing (Code Review Checks)

The engineer MUST verify each of these before running the code:

1. **Format parity check:** Compare the output of `_handle_l2_book()` against a real `get_l2_book()` REST response for the same symbol. Fields, types, and nesting must be identical.

2. **Format parity check:** Compare the output of `_handle_asset_ctx()` against a real `get_asset_context()` REST response. Fields must match exactly: `funding`, `open_interest`, `day_volume`, `mark_price`, `prev_day_price`.

3. **Format parity check:** Compare `_handle_all_mids()` output against `get_all_prices()` REST response. Both must return `dict[str, float]`.

4. **`get_price()` delegates to `get_all_prices()`:** Verify that `get_price()` no longer calls `_fetch_all_mids()` directly. If it does, tools (trading.py, market.py, etc.) bypass the WS cache and hit REST on every call. This was the most critical gap found in the review — 10 call sites across 6 files would silently remain REST-only.

5. **No dangling references:** Search the entire codebase for:
   - `_ws_prices` — should only appear in ws_feeds.py, not daemon.py
   - `_ws_connected` — should only appear in ws_feeds.py, not daemon.py
   - `_ws_last_msg` — should only appear in ws_feeds.py, not daemon.py
   - `_get_prices_with_ws_fallback` — should not appear anywhere
   - `_run_ws_price_feed` — should not appear anywhere

5. **Paper provider passthrough:** Verify that `PaperProvider.get_all_prices()` → `self._real.get_all_prices()` → WS cache → REST fallback chain works. No extra code needed — existing delegation handles it.

6. **Thread safety audit:** Confirm all WS callbacks only do atomic dict replacement (full dict assignment). No partial mutations (e.g., `self._l2_books["BTC"] = book` mutates existing dict — WRONG). Must be `new_dict = dict(self._l2_books); new_dict[coin] = book; self._l2_books = new_dict` (creates new dict, atomic assignment).

7. **Shutdown safety:** Confirm `MarketDataFeed.stop()` sets `self._running = False` and the reconnect loop checks it in 0.5s increments. The thread is `daemon=True` so it dies with the process regardless.

8. **REST fallback paths:** For every modified provider method, trace the code path when WS returns `None`. Confirm it falls through to the original REST code with zero behavioral change.

### Dynamic Testing

#### Test 1: WS Connection and Price Feed
```bash
# Start the daemon in development mode
PYTHONPATH=src python -c "
from hynous.data.providers.hyperliquid import get_provider
from hynous.core.config import load_config
import time

config = load_config()
provider = get_provider(config)
provider.start_ws(['BTC', 'ETH', 'SOL'])

# Wait for WS to connect
time.sleep(5)

# Test 1a: Prices from WS
prices = provider.get_all_prices()
print(f'Prices: {len(prices)} coins, BTC={prices.get(\"BTC\")}')
assert len(prices) > 100, 'Expected 200+ prices from allMids'
assert 'BTC' in prices

# Test 1b: L2 book from WS
book = provider.get_l2_book('BTC')
print(f'L2 book: {len(book[\"bids\"])} bids, {len(book[\"asks\"])} asks')
assert len(book['bids']) > 0
assert 'price' in book['bids'][0]
assert 'size' in book['bids'][0]
assert 'orders' in book['bids'][0]
assert book['best_bid'] > 0
assert book['spread'] >= 0

# Test 1c: Asset context from WS
ctx = provider.get_asset_context('BTC')
print(f'Context: funding={ctx[\"funding\"]}, OI={ctx[\"open_interest\"]}')
assert 'funding' in ctx
assert 'open_interest' in ctx
assert 'day_volume' in ctx
assert 'mark_price' in ctx
assert isinstance(ctx['funding'], float)

# Test 1d: Multi-asset contexts
multi = provider.get_multi_asset_contexts(['BTC', 'ETH', 'SOL'])
print(f'Multi: {list(multi.keys())}')
assert 'BTC' in multi
assert 'ETH' in multi

# Test 1e: Health check
health = provider.ws_health
print(f'Health: {health}')
assert health['connected'] == True
assert health['price_count'] > 100

provider.stop_ws()
print('All WS tests passed!')
"
```

#### Test 2: REST Fallback
```bash
PYTHONPATH=src python -c "
from hynous.data.providers.hyperliquid import HyperliquidProvider
import time

# Create provider WITHOUT starting WS
provider = HyperliquidProvider()

# All methods should fall through to REST
prices = provider.get_all_prices()
assert len(prices) > 100, 'REST fallback for prices failed'

book = provider.get_l2_book('BTC')
assert book is not None, 'REST fallback for L2 failed'
assert len(book['bids']) > 0

ctx = provider.get_asset_context('BTC')
assert ctx is not None, 'REST fallback for context failed'
assert 'funding' in ctx

print('All REST fallback tests passed!')
"
```

#### Test 3: Format Parity (WS vs REST)
```bash
PYTHONPATH=src python -c "
from hynous.data.providers.hyperliquid import HyperliquidProvider
import time, json

provider = HyperliquidProvider()
provider.start_ws(['BTC'])
time.sleep(5)

# Get WS data
ws_book = provider.get_l2_book('BTC')
ws_ctx = provider.get_asset_context('BTC')

# Force REST by stopping WS
provider.stop_ws()
time.sleep(1)

# Get REST data
rest_book = provider.get_l2_book('BTC')
rest_ctx = provider.get_asset_context('BTC')

# Compare L2 book structure
print('L2 WS keys:', sorted(ws_book.keys()))
print('L2 REST keys:', sorted(rest_book.keys()))
assert sorted(ws_book.keys()) == sorted(rest_book.keys()), 'L2 key mismatch!'

bid_keys_ws = sorted(ws_book['bids'][0].keys())
bid_keys_rest = sorted(rest_book['bids'][0].keys())
print('Bid level WS keys:', bid_keys_ws)
print('Bid level REST keys:', bid_keys_rest)
assert bid_keys_ws == bid_keys_rest, 'L2 bid level key mismatch!'

# Compare context structure
print('CTX WS keys:', sorted(ws_ctx.keys()))
print('CTX REST keys:', sorted(rest_ctx.keys()))
assert sorted(ws_ctx.keys()) == sorted(rest_ctx.keys()), 'Context key mismatch!'

# Values should be close (not exact — they're sampled at different times)
print(f'Funding: WS={ws_ctx[\"funding\"]}, REST={rest_ctx[\"funding\"]}')
print(f'OI: WS={ws_ctx[\"open_interest\"]}, REST={rest_ctx[\"open_interest\"]}')

print('Format parity verified!')
"
```

#### Test 4: Run Existing Test Suite
```bash
# All existing tests must pass — WS migration should not break anything
PYTHONPATH=src pytest tests/ -v
PYTHONPATH=. pytest satellite/tests/ -v
```

#### Test 5: Daemon Integration (Manual)
```bash
# Start daemon in development mode, watch logs for:
# 1. "WS market data feed started via provider" on startup
# 2. "WS market feed connected — N subscriptions sent"
# 3. No 429 errors during normal operation
# 4. Scanner still detecting anomalies
# 5. Satellite still computing features
# 6. Briefing still generating (check via chat or review wake)

cd dashboard && reflex run
# OR
python -m scripts.run_daemon
```

### Logical Error Checks

The engineer MUST verify these potential logical issues:

1. **Scanner receives stale WS data during `_poll_prices()`?** No — `provider.get_all_prices()` returns the latest WS prices. Even if the WS hasn't pushed in 29s, the prices are still valid (market hasn't moved). If >30s stale, REST fallback kicks in. Scanner always gets fresh data.

2. **`_poll_derivatives()` double-fetches contexts?** No — `get_multi_asset_contexts()` checks WS for each symbol first. Only symbols NOT in WS cache trigger a REST call. Since WS subscribes to all tracked coins, REST should rarely execute during normal operation.

3. **`get_all_asset_contexts()` (full universe) conflicts with per-coin WS?** No — `get_all_asset_contexts()` stays REST-only. It fetches all 200+ coins in one REST call for the scanner. The WS only tracks 3-5 coins. These are separate code paths that don't interact.

4. **New position on untracked coin has no WS data?** Correct — the L2 and context WS only subscribe to tracked coins. When a new position opens on an untracked coin, `get_l2_book()` falls back to REST for that coin. The `update_coins()` call in `_check_positions()` adds it for future WS updates. The REST fallback bridges the gap.

5. **Paper mode: does WS start?** Yes — `PaperProvider.start_ws()` passes through to `self._real.start_ws()`. The real provider connects to mainnet WS for market data. This is correct — paper mode needs real mainnet prices.

6. **Two VPS instances: do WS connections conflict?** No — each VPS opens its own WS connection to Hyperliquid. WS connections are per-client, no shared state. Both instances get the same data independently.

7. **`snapshot.oi_usd` calculation uses `price * OI_base`**: In `_poll_derivatives()` line ~1420, OI USD is calculated as `ctx["open_interest"] * price`. The WS `activeAssetCtx` provides `openInterest` as base asset quantity (same as REST). The calculation remains correct.

8. **Historical snapshot recording uses `snapshot.funding/oi_usd/volume_usd`**: These are populated from `get_multi_asset_contexts()` (now WS-fed). Values are semantically identical — same numbers, just delivered faster. `_record_historical_snapshots()` works unchanged.

9. **Satellite feature computation**: Satellite reads from `snapshot.funding`, `snapshot.oi_usd`, etc. (populated from WS-fed contexts) AND from data-layer DB (historical tables). Both paths are unaffected. Satellite candles are fetched via REST (historical ranges) — unchanged.

10. **WS reconnect: do we lose L2/context data?** Yes, briefly — during reconnect (5-60s), `get_l2_book()` and `get_asset_ctx()` return `None` (stale), and providers fall back to REST. After reconnect, WS resubscribes and data resumes. No data loss — just temporary REST fallback.

11. **`market_open()` calls `get_price()` internally (line 366 of hyperliquid.py).** With the `get_price()` fix (Step 2c-bis), this call now reads from WS cache. This is correct — we want the freshest price for size calculation. If WS is down, REST fallback still works.

12. **Provider docstring says `skip_ws=True`.** Update the module docstring (line 9 of hyperliquid.py) to reflect that WS is now used for market data reads. Change "skip_ws=True — we only need REST queries, no WebSocket overhead" to "skip_ws=True on SDK Info — we manage our own WS feeds via ws_feeds.py".

---

## Files Changed Summary

| File | Action | Lines Changed |
|------|--------|--------------|
| `src/hynous/data/providers/ws_feeds.py` | **NEW** | ~350 lines |
| `src/hynous/data/providers/hyperliquid.py` | Modified | ~60 lines added, ~5 renamed |
| `src/hynous/data/providers/paper.py` | Modified | ~15 lines added (passthrough) |
| `src/hynous/intelligence/daemon.py` | Modified | ~120 lines removed, ~15 lines changed |
| `config/default.yaml` | No change | — |
| `src/hynous/core/config.py` | No change | — |

---

## Phase 2: Account Data WebSocket (Future — After Live Trading)

**Do NOT implement Phase 2 now.** It's documented here for reference.

Phase 2 adds an `AccountDataFeed` class in ws_feeds.py that subscribes to:
- `clearinghouseState` → replaces `get_user_state()` polling
- `openOrders` → replaces `get_trigger_orders()` + `_refresh_trigger_cache()`
- `userFills` → replaces `get_user_fills()` polling

This eliminates the 13 manual `_refresh_trigger_cache()` calls and the T1/B1 stale-state bug classes. But it only matters in live mode (paper mode simulates account state locally).

**Prerequisite:** Trading mode switched from paper to live/testnet.
**Connection:** Separate WS to the trade chain endpoint (may differ from mainnet for testnet).

---

## Rollback Plan

If the WS migration causes issues in production:

1. Set `daemon.ws_price_feed: false` in `config/default.yaml`
2. Restart daemon
3. Provider's `start_ws()` won't be called, `_market_feed` stays `None`
4. All provider methods fall through to REST (existing behavior)
5. No code changes needed — just a config toggle

This is possible because every WS path has a REST fallback. The config flag is the kill switch.

---

Last updated: 2026-03-14
