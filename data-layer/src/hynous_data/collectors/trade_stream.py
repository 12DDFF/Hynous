"""WebSocket trade stream — address discovery + raw trade data for order flow."""

import time
import threading
import logging
from collections import deque
from typing import Any

from hyperliquid.info import Info

from hynous_data.core.db import Database
from hynous_data.core.utils import safe_float

log = logging.getLogger(__name__)

# Shared trade buffer for OrderFlow engine (thread-safe deques per coin)
# Format: {"coin": str, "side": "B"|"A", "px": float, "sz": float, "time": int}
_trade_buffers: dict[str, deque] = {}
_buffer_lock = threading.Lock()

MAX_BUFFER_SIZE = 50_000  # per-coin trade buffer cap
WS_DEAD_THRESHOLD = 30  # seconds with no trades = WS considered dead
WS_RECONNECT_DELAY = 5  # seconds to wait before reconnecting


def get_trade_buffer(coin: str) -> deque:
    """Get or create a trade buffer for a coin."""
    with _buffer_lock:
        if coin not in _trade_buffers:
            _trade_buffers[coin] = deque(maxlen=MAX_BUFFER_SIZE)
        return _trade_buffers[coin]


def get_all_buffers() -> dict[str, deque]:
    """Return snapshot copy of all trade buffers (keys only, deques are shared)."""
    with _buffer_lock:
        return dict(_trade_buffers)


def clear_all_buffers():
    """Clear all trade buffers (call on startup to avoid stale data)."""
    with _buffer_lock:
        _trade_buffers.clear()


class TradeStream:
    """Subscribes to trades WS for all coins, extracts addresses, buffers trades.

    Includes health monitoring: if no trades arrive for 30s, kills and reconnects WS.
    """

    def __init__(self, db: Database, base_url: str = "https://api.hyperliquid.xyz"):
        self._db = db
        self._base_url = base_url
        self._info: Info | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        # Batch address discovery
        self._pending_addresses: dict[str, dict] = {}
        self._addr_lock = threading.Lock()
        self._flush_interval = 1.0
        # Health monitoring
        self._last_trade_time = 0.0
        self._reconnect_count = 0
        self._ws_connected = False
        # Stats
        self.total_trades = 0
        self.total_addresses_discovered = 0
        self.total_invalid_trades = 0
        self._subscribed_coins: list[str] = []

    def start(self):
        """Start the trade stream in a background thread."""
        clear_all_buffers()  # Prevent stale data from prior runs
        self._thread = threading.Thread(target=self._run_with_reconnect, name="trade-stream", daemon=True)
        self._thread.start()

    def _run_with_reconnect(self):
        """Outer loop: reconnects WS if it dies."""
        while not self._stop_event.is_set():
            try:
                self._connect_and_subscribe()
                self._monitor_loop()
            except Exception:
                log.exception("TradeStream error — will reconnect in %ds", WS_RECONNECT_DELAY)
            finally:
                self._cleanup_ws()

            if not self._stop_event.is_set():
                self._reconnect_count += 1
                log.warning("TradeStream reconnecting (attempt #%d)", self._reconnect_count)
                self._stop_event.wait(WS_RECONNECT_DELAY)

    def _connect_and_subscribe(self):
        """Connect WS and subscribe to all coins."""
        log.info("TradeStream connecting to WS...")
        self._info = Info(base_url=self._base_url)
        time.sleep(2)

        meta = self._info.meta()
        coins = [asset["name"] for asset in meta.get("universe", [])]
        log.info("Subscribing to trades for %d coins", len(coins))

        self._subscribed_coins.clear()
        for coin in coins:
            if self._stop_event.is_set():
                return
            self._info.subscribe({"type": "trades", "coin": coin}, self._on_trade)
            self._subscribed_coins.append(coin)

        self._ws_connected = True
        self._last_trade_time = time.time()
        log.info("TradeStream subscribed to %d coins", len(self._subscribed_coins))

    def _monitor_loop(self):
        """Flush addresses + check WS health."""
        while not self._stop_event.is_set():
            self._flush_addresses()

            # Health check: if no trades for WS_DEAD_THRESHOLD, force reconnect
            if self._last_trade_time > 0:
                silence = time.time() - self._last_trade_time
                if silence > WS_DEAD_THRESHOLD:
                    log.warning("TradeStream: no trades for %.0fs — WS dead, forcing reconnect", silence)
                    return  # Exit to trigger reconnect

            self._stop_event.wait(self._flush_interval)

    def _cleanup_ws(self):
        """Disconnect current WS."""
        self._ws_connected = False
        if self._info:
            try:
                self._info.disconnect_websocket()
            except Exception:
                pass
            self._info = None

    def _on_trade(self, msg: dict[str, Any]):
        """Callback for each trade message from WS."""
        if msg.get("channel") != "trades":
            return

        now = time.time()
        self._last_trade_time = now

        for trade in msg.get("data", []):
            # Validate trade data
            coin = trade.get("coin", "")
            px = safe_float(trade.get("px", 0))
            sz = safe_float(trade.get("sz", 0))
            side = trade.get("side", "")

            if not coin or px <= 0 or sz <= 0 or side not in ("B", "A"):
                self.total_invalid_trades += 1
                continue

            self.total_trades += 1

            # Buffer trade for order flow
            buf = get_trade_buffer(coin)
            buf.append({
                "coin": coin,
                "side": side,
                "px": px,
                "sz": sz,
                "time": trade.get("time", 0),
            })

            # Record liquidation events (SPEC-01)
            if trade.get("liquidation") or trade.get("liq"):
                try:
                    size_usd = abs(px * sz)
                    if size_usd >= 100:  # ignore dust liquidations
                        normalized_side = (
                            "short" if side == "B"
                            else "long" if side == "A"
                            else side
                        )
                        users_list = trade.get("users", [])
                        address = (
                            users_list[0]
                            if users_list and isinstance(users_list, list)
                            else None
                        )
                        with self._db.write_lock:
                            self._db.conn.execute(
                                "INSERT INTO liquidation_events "
                                "(coin, occurred_at, side, size_usd, price, address) "
                                "VALUES (?, ?, ?, ?, ?, ?)",
                                (coin, now, normalized_side, size_usd, px, address),
                            )
                            self._db.conn.commit()
                except Exception:
                    pass  # never crash trade stream for liq recording

            # Address discovery from users field
            users = trade.get("users")
            if users and isinstance(users, list):
                with self._addr_lock:
                    for addr in users:
                        if not addr or not isinstance(addr, str) or len(addr) < 10:
                            continue
                        if addr in self._pending_addresses:
                            self._pending_addresses[addr]["last_seen"] = now
                            self._pending_addresses[addr]["count"] += 1
                        else:
                            self._pending_addresses[addr] = {
                                "first_seen": now,
                                "last_seen": now,
                                "count": 1,
                            }

    def _flush_addresses(self):
        """Batch insert/update discovered addresses to SQLite."""
        with self._addr_lock:
            if not self._pending_addresses:
                return
            batch = self._pending_addresses.copy()
            self._pending_addresses.clear()

        conn = self._db.conn
        try:
            with self._db.write_lock:
                # Count only genuinely new inserts (not re-seen addresses)
                before = conn.execute("SELECT COUNT(*) FROM addresses").fetchone()[0]
                conn.executemany(
                    """
                    INSERT INTO addresses (address, first_seen, last_seen, trade_count)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(address) DO UPDATE SET
                        last_seen = MAX(last_seen, excluded.last_seen),
                        trade_count = trade_count + excluded.trade_count
                    """,
                    [
                        (addr, d["first_seen"], d["last_seen"], d["count"])
                        for addr, d in batch.items()
                    ],
                )
                conn.commit()
                after = conn.execute("SELECT COUNT(*) FROM addresses").fetchone()[0]
            self.total_addresses_discovered += (after - before)
        except Exception:
            log.exception("Failed to flush %d addresses", len(batch))

    def stop(self):
        self._stop_event.set()
        self._cleanup_ws()
        if self._thread:
            self._thread.join(timeout=5)

    @property
    def is_healthy(self) -> bool:
        """True if WS is connected and received trades recently."""
        if not self._ws_connected:
            return False
        return (time.time() - self._last_trade_time) < WS_DEAD_THRESHOLD

    def stats(self) -> dict:
        now = time.time()
        return {
            "subscribed_coins": len(self._subscribed_coins),
            "total_trades": self.total_trades,
            "total_invalid_trades": self.total_invalid_trades,
            "total_addresses_discovered": self.total_addresses_discovered,
            "pending_flush": len(self._pending_addresses),
            "ws_connected": self._ws_connected,
            "ws_healthy": self.is_healthy,
            "last_trade_age_s": round(now - self._last_trade_time, 1) if self._last_trade_time else None,
            "reconnect_count": self._reconnect_count,
        }
