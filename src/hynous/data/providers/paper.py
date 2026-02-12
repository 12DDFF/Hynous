"""
Paper Trading Provider — Internal Position Simulation

Wraps HyperliquidProvider: delegates all data reads to mainnet,
simulates all writes (positions, orders, fills) internally. Drop-in
replacement — same interface, so trading tools, daemon, and dashboard
work unchanged.

Why: Hyperliquid testnet has broken price data (gaps, stale candles,
prices diverging from mainnet). The agent would learn wrong lessons
from every trade. Paper mode uses real mainnet prices for accurate
PnL, accurate SL/TP evaluation, and accurate learning.

Usage:
    from hynous.data.providers.paper import PaperProvider
    paper = PaperProvider(real_provider, initial_balance=1000)
    paper.market_open("BTC", is_buy=True, size_usd=100, slippage=0.05)
    state = paper.get_user_state()  # positions valued at mainnet prices
"""

import hashlib
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class PaperPosition:
    """An open simulated position."""
    coin: str
    side: str              # "long" | "short"
    size: float            # base asset amount (e.g. 0.01 BTC)
    entry_px: float        # mainnet price at entry
    leverage: int
    margin: float          # notional / leverage
    liquidation_px: float  # simplified liquidation price
    sl_px: Optional[float] = None
    tp_px: Optional[float] = None
    opened_at: str = ""
    sl_oid: int = 0        # pseudo OID for stop loss trigger
    tp_oid: int = 0        # pseudo OID for take profit trigger

    def unrealized_pnl(self, mark_px: float) -> float:
        if self.side == "long":
            return (mark_px - self.entry_px) * self.size
        else:
            return (self.entry_px - mark_px) * self.size

    def return_pct(self, mark_px: float) -> float:
        pnl = self.unrealized_pnl(mark_px)
        return (pnl / self.margin * 100) if self.margin > 0 else 0.0


class PaperProvider:
    """Paper trading provider — simulates positions using mainnet prices.

    Delegates all market data reads to a real HyperliquidProvider (mainnet).
    Simulates all trading operations internally with accurate PnL math.
    Persists state to JSON so positions survive restarts.
    """

    TAKER_FEE = 0.00035  # 0.035% per side (Hyperliquid's actual rate)

    def __init__(self, real_provider, initial_balance: float = 1000.0):
        self._real = real_provider
        self._initial_balance = initial_balance
        self.balance: float = initial_balance
        self.positions: dict[str, PaperPosition] = {}
        self.fills: list[dict] = []
        self.leverage_map: dict[str, int] = {}
        self._next_oid: int = 1000
        self._lock = threading.Lock()

        # Determine storage path (relative to project root)
        self._storage_path = self._find_storage_path()
        self._load()
        logger.info("PaperProvider initialized (balance=$%.2f, positions=%d)",
                     self.balance, len(self.positions))

    @staticmethod
    def _find_storage_path() -> str:
        """Find storage directory — walk up from this file to find 'storage/'."""
        d = os.path.dirname(os.path.abspath(__file__))
        for _ in range(6):
            candidate = os.path.join(d, "storage")
            if os.path.isdir(candidate):
                return os.path.join(candidate, "paper-state.json")
            d = os.path.dirname(d)
        # Fallback: create storage/ next to config/
        fallback = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "..", "..", "..", "..", "storage")
        os.makedirs(fallback, exist_ok=True)
        return os.path.join(fallback, "paper-state.json")

    # ================================================================
    # Properties
    # ================================================================

    @property
    def can_trade(self) -> bool:
        return True

    @property
    def address(self) -> str:
        return "0xPAPER_TRADING"

    # ================================================================
    # Data Reads — Delegate to Real Provider (Mainnet)
    # ================================================================

    def get_price(self, symbol: str) -> Optional[float]:
        return self._real.get_price(symbol)

    def get_all_prices(self) -> dict[str, float]:
        return self._real.get_all_prices()

    def get_multi_asset_contexts(self, symbols: list[str]) -> dict[str, dict]:
        return self._real.get_multi_asset_contexts(symbols)

    def get_asset_context(self, symbol: str):
        return self._real.get_asset_context(symbol)

    def get_candles(self, symbol: str, interval: str, start_ms: int,
                    end_ms: Optional[int] = None) -> list[dict]:
        return self._real.get_candles(symbol, interval, start_ms, end_ms)

    def get_l2_book(self, symbol: str) -> dict:
        return self._real.get_l2_book(symbol)

    def get_funding_history(self, symbol: str, start_ms: int,
                             end_ms: Optional[int] = None) -> list[dict]:
        return self._real.get_funding_history(symbol, start_ms, end_ms)

    def _get_sz_decimals(self, symbol: str) -> int:
        return self._real._get_sz_decimals(symbol)

    # ================================================================
    # Account Reads — Simulated from Internal State
    # ================================================================

    def get_user_state(self) -> dict:
        """Get account state — same format as HyperliquidProvider.get_user_state()."""
        prices = self.get_all_prices()
        total_margin = 0.0
        total_pnl = 0.0
        positions = []

        with self._lock:
            for coin, pos in self.positions.items():
                mark_px = prices.get(coin, pos.entry_px)
                pnl = pos.unrealized_pnl(mark_px)
                total_pnl += pnl
                total_margin += pos.margin

                positions.append({
                    "coin": coin,
                    "side": pos.side,
                    "size": pos.size,
                    "size_usd": pos.size * mark_px,
                    "entry_px": pos.entry_px,
                    "mark_px": mark_px,
                    "unrealized_pnl": pnl,
                    "return_pct": pos.return_pct(mark_px),
                    "leverage": pos.leverage,
                    "liquidation_px": pos.liquidation_px,
                    "margin_used": pos.margin,
                    "opened_at": pos.opened_at,
                })

        return {
            "account_value": self.balance + total_margin + total_pnl,
            "total_margin": total_margin,
            "withdrawable": self.balance,
            "unrealized_pnl": total_pnl,
            "positions": positions,
        }

    def get_open_orders(self) -> list[dict]:
        """No resting limit orders in paper mode."""
        return []

    def get_trigger_orders(self, symbol: str | None = None) -> list[dict]:
        """Build trigger orders from position SL/TP fields."""
        orders = []
        with self._lock:
            for coin, pos in self.positions.items():
                if symbol and coin != symbol:
                    continue
                close_side = "sell" if pos.side == "long" else "buy"
                if pos.sl_px and pos.sl_oid:
                    orders.append({
                        "coin": coin,
                        "side": close_side,
                        "size": pos.size,
                        "orig_size": pos.size,
                        "trigger_px": pos.sl_px,
                        "limit_px": 0,
                        "oid": pos.sl_oid,
                        "order_type": "stop_loss",
                        "is_trigger": True,
                        "is_tpsl": True,
                        "reduce_only": True,
                        "timestamp": int(time.time() * 1000),
                    })
                if pos.tp_px and pos.tp_oid:
                    orders.append({
                        "coin": coin,
                        "side": close_side,
                        "size": pos.size,
                        "orig_size": pos.size,
                        "trigger_px": pos.tp_px,
                        "limit_px": 0,
                        "oid": pos.tp_oid,
                        "order_type": "take_profit",
                        "is_trigger": True,
                        "is_tpsl": True,
                        "reduce_only": True,
                        "timestamp": int(time.time() * 1000),
                    })
        return orders

    def get_user_fills(self, start_ms: int, end_ms: int | None = None) -> list[dict]:
        """Return recent fills filtered by time range."""
        with self._lock:
            result = []
            for f in self.fills:
                if f["time"] >= start_ms:
                    if end_ms is None or f["time"] <= end_ms:
                        result.append(f)
            return result

    # ================================================================
    # Trading Operations — Simulated Internally
    # ================================================================

    def market_open(self, symbol: str, is_buy: bool, size_usd: float,
                    slippage: float = 0.05) -> dict:
        """Open a position at current mainnet mid price."""
        price = self.get_price(symbol)
        if not price:
            raise ValueError(f"Cannot get price for {symbol}")

        with self._lock:
            if symbol in self.positions:
                raise ValueError(
                    f"Already have a {self.positions[symbol].side} position in {symbol}"
                )

            fee = size_usd * self.TAKER_FEE
            leverage = self.leverage_map.get(symbol, 5)
            margin = size_usd / leverage

            if margin + fee > self.balance:
                raise ValueError(
                    f"Insufficient margin: need ${margin + fee:.2f}, have ${self.balance:.2f}"
                )

            size = size_usd / price
            side = "long" if is_buy else "short"

            # Liquidation price — 5% buffer for accumulated fees
            if side == "long":
                liq_px = price * (1 - 0.95 / leverage)
            else:
                liq_px = price * (1 + 0.95 / leverage)

            self.balance -= (margin + fee)
            oid = self._next_oid
            self._next_oid += 1

            self.positions[symbol] = PaperPosition(
                coin=symbol, side=side, size=size, entry_px=price,
                leverage=leverage, margin=margin, liquidation_px=liq_px,
                opened_at=datetime.now(timezone.utc).isoformat(),
            )

            direction = f"Open {'Long' if is_buy else 'Short'}"
            self._record_fill(symbol, "B" if is_buy else "A", size, price,
                              0.0, direction, oid)
            self._save()

        logger.info("Paper %s %s: %.6g @ $%,.0f ($%,.0f notional, %dx)",
                     side, symbol, size, price, size_usd, leverage)
        return {
            "symbol": symbol, "oid": oid, "filled_sz": size,
            "avg_px": price, "status": "filled",
        }

    def market_close(self, symbol: str, size: float | None = None,
                     slippage: float = 0.05) -> dict:
        """Close a position at current mainnet mid price."""
        price = self.get_price(symbol)
        if not price:
            raise ValueError(f"Cannot get price for {symbol}")

        with self._lock:
            if symbol not in self.positions:
                raise ValueError(f"No open position for {symbol}")

            pos = self.positions[symbol]
            close_sz = size if size else pos.size
            full_close = (size is None) or (close_sz >= pos.size)

            if full_close:
                trade = self._close_at_locked(symbol, price)
                oid = trade["oid"]
                filled_sz = trade["size"]
                self._save()
            else:
                # Partial close
                pnl_per_unit = (price - pos.entry_px) if pos.side == "long" \
                    else (pos.entry_px - price)
                partial_pnl = pnl_per_unit * close_sz
                fee = close_sz * price * self.TAKER_FEE
                net_pnl = partial_pnl - fee

                # Reduce position
                margin_freed = pos.margin * (close_sz / pos.size)
                pos.size -= close_sz
                pos.margin -= margin_freed
                self.balance += margin_freed + net_pnl

                oid = self._next_oid
                self._next_oid += 1
                direction = f"Close {'Long' if pos.side == 'long' else 'Short'}"
                self._record_fill(symbol, "A" if pos.side == "long" else "B",
                                  close_sz, price, net_pnl, direction, oid)
                filled_sz = close_sz
                self._save()

        return {
            "symbol": symbol, "oid": oid, "filled_sz": filled_sz,
            "avg_px": price, "status": "filled",
        }

    def limit_open(self, symbol: str, is_buy: bool, limit_px: float,
                   size_usd: float | None = None, sz: float | None = None,
                   tif: str = "Gtc") -> dict:
        """Simulate limit order — fills instantly at limit price.

        Paper mode simplification: limit orders fill immediately.
        """
        if sz and not size_usd:
            size_usd = sz * limit_px

        if not size_usd:
            raise ValueError("Either size_usd or sz required")

        # Use limit price as the fill price
        with self._lock:
            if symbol in self.positions:
                # This is a close via limit (e.g. close_position with limit)
                pass  # Fall through — handled by trading.py calling market_close

            fee = size_usd * self.TAKER_FEE
            leverage = self.leverage_map.get(symbol, 5)
            margin = size_usd / leverage

            # Check if this is a closing order (opposite side of existing position)
            existing = self.positions.get(symbol)
            if existing:
                is_closing = (existing.side == "long" and not is_buy) or \
                             (existing.side == "short" and is_buy)
                if is_closing:
                    actual_sz = sz or (size_usd / limit_px)
                    full_close = actual_sz >= existing.size
                    if full_close:
                        trade = self._close_at_locked(symbol, limit_px)
                        return {
                            "symbol": symbol, "oid": trade["oid"],
                            "filled_sz": trade["size"],
                            "avg_px": limit_px, "status": "filled",
                        }
                    else:
                        # Partial close at limit
                        pnl_per_unit = (limit_px - existing.entry_px) if existing.side == "long" \
                            else (existing.entry_px - limit_px)
                        partial_pnl = pnl_per_unit * actual_sz
                        fee_close = actual_sz * limit_px * self.TAKER_FEE
                        net_pnl = partial_pnl - fee_close
                        margin_freed = existing.margin * (actual_sz / existing.size)
                        existing.size -= actual_sz
                        existing.margin -= margin_freed
                        self.balance += margin_freed + net_pnl
                        oid = self._next_oid
                        self._next_oid += 1
                        direction = f"Close {'Long' if existing.side == 'long' else 'Short'}"
                        self._record_fill(symbol, "A" if existing.side == "long" else "B",
                                          actual_sz, limit_px, net_pnl, direction, oid)
                        self._save()
                        return {
                            "symbol": symbol, "oid": oid,
                            "filled_sz": actual_sz,
                            "avg_px": limit_px, "status": "filled",
                        }

            # Block same-direction duplicate
            if symbol in self.positions:
                raise ValueError(
                    f"Already have a {self.positions[symbol].side} position in {symbol}"
                )

            # New position at limit price
            if margin + fee > self.balance:
                raise ValueError(
                    f"Insufficient margin: need ${margin + fee:.2f}, have ${self.balance:.2f}"
                )

            size = size_usd / limit_px
            side = "long" if is_buy else "short"

            if side == "long":
                liq_px = limit_px * (1 - 0.95 / leverage)
            else:
                liq_px = limit_px * (1 + 0.95 / leverage)

            self.balance -= (margin + fee)
            oid = self._next_oid
            self._next_oid += 1

            self.positions[symbol] = PaperPosition(
                coin=symbol, side=side, size=size, entry_px=limit_px,
                leverage=leverage, margin=margin, liquidation_px=liq_px,
                opened_at=datetime.now(timezone.utc).isoformat(),
            )

            direction = f"Open {'Long' if is_buy else 'Short'}"
            self._record_fill(symbol, "B" if is_buy else "A", size, limit_px,
                              0.0, direction, oid)
            self._save()

        return {
            "symbol": symbol, "oid": oid, "filled_sz": size,
            "avg_px": limit_px, "status": "filled",
        }

    def place_trigger_order(self, symbol: str, is_buy: bool, sz: float,
                             trigger_px: float, tpsl: str = "sl") -> dict:
        """Store SL or TP on the position."""
        with self._lock:
            pos = self.positions.get(symbol)
            if not pos:
                raise ValueError(f"No position for {symbol} to attach trigger to")

            oid = self._next_oid
            self._next_oid += 1

            if tpsl == "sl":
                pos.sl_px = trigger_px
                pos.sl_oid = oid
            else:
                pos.tp_px = trigger_px
                pos.tp_oid = oid

            self._save()

        label = "Stop loss" if tpsl == "sl" else "Take profit"
        logger.info("Paper %s set for %s: $%,.0f (oid=%d)", label, symbol, trigger_px, oid)
        return {"symbol": symbol, "oid": oid, "status": "trigger_placed"}

    def cancel_order(self, symbol: str, oid: int) -> bool:
        """Cancel a trigger order by OID."""
        with self._lock:
            pos = self.positions.get(symbol)
            if not pos:
                return False
            if pos.sl_oid == oid:
                pos.sl_px = None
                pos.sl_oid = 0
                self._save()
                return True
            if pos.tp_oid == oid:
                pos.tp_px = None
                pos.tp_oid = 0
                self._save()
                return True
        return False

    def cancel_all_orders(self, symbol: str) -> int:
        """Cancel all trigger orders for a symbol."""
        count = 0
        with self._lock:
            pos = self.positions.get(symbol)
            if pos:
                if pos.sl_px:
                    pos.sl_px = None
                    pos.sl_oid = 0
                    count += 1
                if pos.tp_px:
                    pos.tp_px = None
                    pos.tp_oid = 0
                    count += 1
                if count:
                    self._save()
        return count

    def update_leverage(self, symbol: str, leverage: int,
                        is_cross: bool = True) -> None:
        """Store per-symbol leverage for future trades."""
        self.leverage_map[symbol] = leverage
        # If position exists, update its leverage (in practice this is risky
        # but Hyperliquid allows it)
        with self._lock:
            pos = self.positions.get(symbol)
            if pos:
                pos.leverage = leverage
                # Recalculate liquidation
                if pos.side == "long":
                    pos.liquidation_px = pos.entry_px * (1 - 0.95 / leverage)
                else:
                    pos.liquidation_px = pos.entry_px * (1 + 0.95 / leverage)
                self._save()

    # ================================================================
    # Paper-Specific: Trigger Checking (called by daemon)
    # ================================================================

    def check_triggers(self, prices: dict[str, float]) -> list[dict]:
        """Check all positions for SL/TP/liquidation against current prices.

        Called by the daemon each price poll cycle. Returns list of events
        for each triggered position. Closes the position internally.

        Returns list of dicts:
            coin, side, entry_px, exit_px, realized_pnl, classification
        """
        events = []
        to_close: list[tuple[str, float, str]] = []

        with self._lock:
            for coin, pos in self.positions.items():
                px = prices.get(coin)
                if not px:
                    continue

                # Priority: liquidation > stop loss > take profit
                if (pos.side == "long" and px <= pos.liquidation_px) or \
                   (pos.side == "short" and px >= pos.liquidation_px):
                    to_close.append((coin, px, "liquidation"))
                elif pos.sl_px is not None and (
                    (pos.side == "long" and px <= pos.sl_px) or
                    (pos.side == "short" and px >= pos.sl_px)
                ):
                    to_close.append((coin, pos.sl_px, "stop_loss"))
                elif pos.tp_px is not None and (
                    (pos.side == "long" and px >= pos.tp_px) or
                    (pos.side == "short" and px <= pos.tp_px)
                ):
                    to_close.append((coin, pos.tp_px, "take_profit"))

            for coin, exit_px, reason in to_close:
                pos = self.positions.get(coin)
                if not pos:
                    continue

                if reason == "liquidation":
                    # Liquidation = total margin loss
                    realized_pnl = -pos.margin
                    oid = self._next_oid
                    self._next_oid += 1
                    direction = f"Close {'Long' if pos.side == 'long' else 'Short'}"
                    self._record_fill(coin, "A" if pos.side == "long" else "B",
                                      pos.size, exit_px, realized_pnl, direction, oid)
                    # Margin is lost — don't return it
                    self.positions.pop(coin)
                else:
                    # Normal SL/TP close at trigger price
                    trade = self._close_at_locked(coin, exit_px)
                    realized_pnl = trade["closed_pnl"]

                events.append({
                    "coin": coin,
                    "side": pos.side,
                    "entry_px": pos.entry_px,
                    "exit_px": exit_px,
                    "realized_pnl": realized_pnl,
                    "classification": reason,
                })

            if events:
                self._save()

        for ev in events:
            logger.info("Paper trigger: %s %s %s — entry $%,.0f → exit $%,.0f, PnL $%+,.2f",
                         ev["classification"], ev["coin"], ev["side"],
                         ev["entry_px"], ev["exit_px"], ev["realized_pnl"])

        return events

    # ================================================================
    # Internal Helpers
    # ================================================================

    def _close_at_locked(self, symbol: str, exit_px: float) -> dict:
        """Close a position at a specific price. Must hold self._lock.

        Returns dict with: coin, side, size, entry_px, exit_px, closed_pnl, oid
        """
        pos = self.positions.pop(symbol)
        pnl = pos.unrealized_pnl(exit_px)
        fee = pos.size * exit_px * self.TAKER_FEE
        net_pnl = pnl - fee

        # Return margin + net PnL
        self.balance += pos.margin + net_pnl

        oid = self._next_oid
        self._next_oid += 1
        direction = f"Close {'Long' if pos.side == 'long' else 'Short'}"
        self._record_fill(symbol, "A" if pos.side == "long" else "B",
                          pos.size, exit_px, net_pnl, direction, oid)

        return {
            "coin": symbol, "side": pos.side, "size": pos.size,
            "entry_px": pos.entry_px, "exit_px": exit_px,
            "closed_pnl": net_pnl, "oid": oid,
        }

    def _record_fill(self, coin: str, side: str, size: float, price: float,
                     closed_pnl: float, direction: str, oid: int):
        """Record a fill in the fills list (for get_user_fills compatibility)."""
        now_ms = int(time.time() * 1000)
        fill_hash = hashlib.md5(
            f"{coin}{side}{size}{price}{now_ms}{oid}".encode()
        ).hexdigest()[:16]

        self.fills.append({
            "coin": coin,
            "side": side,
            "size": size,
            "price": price,
            "closed_pnl": closed_pnl,
            "direction": direction,
            "time": now_ms,
            "oid": oid,
            "hash": f"paper_{fill_hash}",
        })

        # Cap fills list at 200
        if len(self.fills) > 200:
            self.fills = self.fills[-100:]

    # ================================================================
    # Persistence
    # ================================================================

    def _save(self):
        """Save state to JSON. Must hold self._lock (or be called from within lock)."""
        data = {
            "balance": self.balance,
            "initial_balance": self._initial_balance,
            "next_oid": self._next_oid,
            "leverage_map": self.leverage_map,
            "positions": {
                coin: asdict(pos) for coin, pos in self.positions.items()
            },
            "fills": self.fills[-100:],  # Keep last 100 fills
        }
        try:
            import tempfile
            dir_name = os.path.dirname(self._storage_path)
            with tempfile.NamedTemporaryFile(
                mode="w", dir=dir_name, delete=False, suffix=".tmp",
            ) as tmp:
                json.dump(data, tmp, indent=2)
                tmp.flush()
                os.fsync(tmp.fileno())
            os.replace(tmp.name, self._storage_path)
        except Exception as e:
            logger.error("Failed to save paper state: %s", e)

    def _load(self):
        """Load state from JSON if it exists."""
        if not os.path.exists(self._storage_path):
            return

        try:
            with open(self._storage_path) as f:
                data = json.load(f)

            self.balance = data.get("balance", self._initial_balance)
            self._initial_balance = data.get("initial_balance", self._initial_balance)
            self._next_oid = data.get("next_oid", 1000)
            self.leverage_map = data.get("leverage_map", {})
            self.fills = data.get("fills", [])

            for coin, pos_data in data.get("positions", {}).items():
                self.positions[coin] = PaperPosition(**pos_data)

            logger.info("Loaded paper state: $%.2f balance, %d positions, %d fills",
                         self.balance, len(self.positions), len(self.fills))
        except Exception as e:
            logger.error("Failed to load paper state: %s", e)
