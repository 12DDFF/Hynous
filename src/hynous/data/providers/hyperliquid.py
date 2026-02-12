"""
Hyperliquid Data Provider

Wraps the Hyperliquid SDK's Info class for market data access and the
Exchange class for order execution on testnet/mainnet.

Key decisions:
- Uses SDK's Info class directly (synchronous) — our agent.chat() is sync
- skip_ws=True — we only need REST queries, no WebSocket overhead
- All prices from SDK come as strings — we convert to float here
- All SDK timestamps are in milliseconds — callers pass ms, we return ms
- Singleton pattern to avoid re-initializing the SDK per tool call
- Exchange is lazily initialized only when a private key is available

Reference: Hydra-v2's HyperliquidDataSource (async, aiohttp-based) at
  desktop/hydra-v2/src/hydra/data/sources/hyperliquid.py
We're building a simpler sync wrapper for the intelligence layer.
"""

import logging
import os
from typing import Optional

from hyperliquid.info import Info
from hyperliquid.exchange import Exchange
from eth_account import Account

logger = logging.getLogger(__name__)


_provider: Optional["HyperliquidProvider"] = None


def get_provider(config=None) -> "HyperliquidProvider":
    """Get or create the singleton provider.

    Returns a PaperProvider (paper mode) or HyperliquidProvider (testnet/live).
    Data reads always use mainnet for accurate prices.

    Args:
        config: Optional Config object controlling mode and credentials.
    """
    global _provider
    if _provider is None:
        mode = config.execution.mode if config else "testnet"

        # Always create real provider for mainnet data
        real = HyperliquidProvider()

        if mode == "paper":
            # Paper mode: simulate trades internally using mainnet prices
            from .paper import PaperProvider
            balance = config.execution.paper_balance if config else 1000.0
            _provider = PaperProvider(real, initial_balance=balance)
        elif mode == "testnet":
            # Testnet: real provider with testnet for account/trading
            trade_url = config.hyperliquid.testnet_url if config else "https://api.hyperliquid-testnet.xyz"
            real._trade_url = trade_url
            real._trade_info = Info(base_url=trade_url, skip_ws=True)
            _provider = real
            # Init exchange on testnet
            key = (config.hyperliquid_private_key if config else "") or os.environ.get("HYPERLIQUID_PRIVATE_KEY", "")
            if key:
                try:
                    real.init_exchange(key)
                except Exception as e:
                    logger.error("Failed to initialize Exchange: %s", e)
        else:
            # Live modes: real provider, mainnet everything
            _provider = real
            key = (config.hyperliquid_private_key if config else "") or os.environ.get("HYPERLIQUID_PRIVATE_KEY", "")
            if key:
                try:
                    real.init_exchange(key)
                except Exception as e:
                    logger.error("Failed to initialize Exchange: %s", e)

    return _provider


class HyperliquidProvider:
    """Synchronous wrapper around Hyperliquid SDK's Info and Exchange classes."""

    MAINNET_URL = "https://api.hyperliquid.xyz"

    # HTTP timeout (seconds) — prevents daemon thread from hanging
    # indefinitely on Hyperliquid API calls.
    _TIMEOUT = 10

    def __init__(self, trade_url: str | None = None):
        """Initialize with mainnet data + optional separate trading endpoint.

        Args:
            trade_url: URL for trading operations (testnet). If None, trades
                       go to mainnet. Data reads ALWAYS use mainnet for
                       accurate prices, funding rates, and OI.
        """
        self._info = Info(base_url=self.MAINNET_URL, skip_ws=True, timeout=self._TIMEOUT)
        self._exchange: Exchange | None = None
        self._wallet = None
        self._trade_url = trade_url or self.MAINNET_URL
        # Separate Info for account queries when trading on testnet
        # (positions/fills/orders live on the testnet chain, not mainnet)
        self._trade_info = Info(base_url=self._trade_url, skip_ws=True, timeout=self._TIMEOUT) if trade_url else self._info
        self._sz_decimals: dict[str, int] | None = None
        if trade_url:
            logger.info("HyperliquidProvider initialized (data=%s, trade=%s)", self.MAINNET_URL, trade_url)
        else:
            logger.info("HyperliquidProvider initialized (url=%s)", self.MAINNET_URL)

    # ================================================================
    # Exchange Initialization (lazy)
    # ================================================================

    def init_exchange(self, private_key: str) -> None:
        """Initialize the Exchange class with a private key.

        Call once at startup. Required for any trading operations.
        The private key is a 64-char hex string (32 bytes), with or without 0x prefix.
        """
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        self._wallet = Account.from_key(private_key)
        self._exchange = Exchange(
            wallet=self._wallet,
            base_url=self._trade_url,
            timeout=self._TIMEOUT,
        )
        logger.info("Exchange initialized for %s (url=%s)", self._wallet.address, self._trade_url)

    @property
    def can_trade(self) -> bool:
        """Whether trading operations are available."""
        return self._exchange is not None

    @property
    def address(self) -> str | None:
        """The wallet address, or None if exchange not initialized."""
        return self._wallet.address if self._wallet else None

    # ================================================================
    # Universe Metadata (cached)
    # ================================================================

    def _get_sz_decimals(self, symbol: str) -> int:
        """Get the size decimal precision for a symbol.

        Hyperliquid requires sizes rounded to asset-specific decimal places.
        BTC = 4 decimals (0.0001), ETH = 3 (0.001), etc.
        """
        if self._sz_decimals is None:
            meta_and_ctxs = self._info.meta_and_asset_ctxs()
            self._sz_decimals = {
                a["name"]: a["szDecimals"]
                for a in meta_and_ctxs[0]["universe"]
            }
        return self._sz_decimals.get(symbol, 4)

    # ================================================================
    # Account State (read-only, requires wallet)
    # ================================================================

    def get_user_state(self) -> dict:
        """Get account state: positions, margin, equity.

        Returns dict with:
            account_value: float — total account value in USD
            total_margin: float — margin currently used
            withdrawable: float — available to withdraw
            unrealized_pnl: float — total unrealized PnL
            positions: list[dict] — open positions, each with:
                coin, side, size, size_usd, entry_px, mark_px,
                unrealized_pnl, return_pct, leverage, liquidation_px, margin_used
        """
        if not self._wallet:
            raise RuntimeError("Exchange not initialized — no private key")

        raw = self._trade_info.user_state(self._wallet.address)

        # Parse cross margin summary
        margin = raw.get("crossMarginSummary", raw.get("marginSummary", {}))
        account_value = float(margin.get("accountValue", "0"))
        total_margin = float(margin.get("totalMarginUsed", "0"))
        withdrawable = float(raw.get("withdrawable", "0"))

        # Unified account mode: spot USDC IS the trading margin but the
        # perps API reports them separately.  Add spot USDC to totals.
        try:
            spot = self._trade_info.spot_user_state(self._wallet.address)
            for b in spot.get("balances", []):
                if b.get("coin") == "USDC":
                    spot_usdc = float(b.get("total", "0"))
                    account_value += spot_usdc
                    withdrawable += spot_usdc
                    break
        except Exception as e:
            logger.debug("Could not fetch spot state: %s", e)

        # Parse positions
        positions = []
        total_pnl = 0.0
        for ap in raw.get("assetPositions", []):
            pos = ap.get("position", {})
            szi = float(pos.get("szi", "0"))
            if szi == 0:
                continue  # No position

            entry_px = float(pos.get("entryPx", "0"))
            pnl = float(pos.get("unrealizedPnl", "0"))
            total_pnl += pnl

            # Get mark price from position value and size
            pos_value = float(pos.get("positionValue", "0"))
            mark_px = abs(pos_value / szi) if szi != 0 else entry_px

            lev = pos.get("leverage", {})
            lev_value = int(lev.get("value", 1)) if isinstance(lev, dict) else int(lev)

            liq_px_raw = pos.get("liquidationPx")
            liq_px = float(liq_px_raw) if liq_px_raw and liq_px_raw != "null" else None

            positions.append({
                "coin": pos.get("coin", "?"),
                "side": "long" if szi > 0 else "short",
                "size": abs(szi),
                "size_usd": abs(pos_value),
                "entry_px": entry_px,
                "mark_px": mark_px,
                "unrealized_pnl": pnl,
                "return_pct": float(pos.get("returnOnEquity", "0")) * 100,
                "leverage": lev_value,
                "liquidation_px": liq_px,
                "margin_used": float(pos.get("marginUsed", "0")),
            })

        return {
            "account_value": account_value,
            "total_margin": total_margin,
            "withdrawable": withdrawable,
            "unrealized_pnl": total_pnl,
            "positions": positions,
        }

    def get_open_orders(self) -> list[dict]:
        """Get open resting limit orders.

        Returns list of dicts with: coin, side, size, limit_px, oid, order_type, timestamp.
        Does NOT include trigger orders (SL/TP). Use get_trigger_orders() for those.
        """
        if not self._wallet:
            raise RuntimeError("Exchange not initialized — no private key")

        raw = self._trade_info.open_orders(self._wallet.address)
        orders = []
        for o in raw:
            orders.append({
                "coin": o.get("coin", "?"),
                "side": "buy" if o.get("side") == "B" else "sell",
                "size": float(o.get("sz", "0")),
                "limit_px": float(o.get("limitPx", "0")),
                "oid": o.get("oid"),
                "order_type": o.get("orderType", "unknown"),
                "timestamp": o.get("timestamp"),
            })
        return orders

    def get_trigger_orders(self, symbol: str | None = None) -> list[dict]:
        """Get trigger orders (stop losses, take profits, conditional orders).

        Uses frontend_open_orders which includes trigger orders that open_orders misses.

        Args:
            symbol: Filter to a specific symbol. None = all symbols.

        Returns list of dicts with:
            coin, side, size, trigger_px, limit_px, oid, order_type,
            is_trigger, is_tpsl, tpsl, reduce_only, timestamp
        """
        if not self._wallet:
            raise RuntimeError("Exchange not initialized — no private key")

        raw = self._trade_info.frontend_open_orders(self._wallet.address)
        orders = []
        for o in raw:
            coin = o.get("coin", "?")
            if symbol and coin != symbol:
                continue

            is_trigger = o.get("isTrigger", False)
            is_tpsl = o.get("isPositionTpsl", False)
            trigger_px = float(o["triggerPx"]) if o.get("triggerPx") else None
            trigger_cond = o.get("triggerCondition", "")

            # Determine order label
            if is_tpsl or is_trigger:
                # Infer SL/TP from trigger condition + side
                # triggerCondition: "tp" or "sl" when isTrigger
                if trigger_cond in ("tp", "sl"):
                    order_label = "take_profit" if trigger_cond == "tp" else "stop_loss"
                elif trigger_px:
                    # Fallback: compare trigger to order side
                    order_label = "trigger"
                else:
                    order_label = "trigger"
            else:
                order_label = o.get("orderType", "limit")

            orders.append({
                "coin": coin,
                "side": "buy" if o.get("side") == "B" else "sell",
                "size": float(o.get("sz", "0")),
                "orig_size": float(o.get("origSz", "0")),
                "trigger_px": trigger_px,
                "limit_px": float(o.get("limitPx", "0")),
                "oid": o.get("oid"),
                "order_type": order_label,
                "is_trigger": is_trigger,
                "is_tpsl": is_tpsl,
                "reduce_only": o.get("reduceOnly", False),
                "timestamp": o.get("timestamp"),
            })
        return orders

    # ================================================================
    # Trading Operations (requires exchange)
    # ================================================================

    def market_open(
        self,
        symbol: str,
        is_buy: bool,
        size_usd: float,
        slippage: float = 0.05,
    ) -> dict:
        """Place a market order (aggressive IoC limit).

        Args:
            symbol: Asset (e.g., "BTC")
            is_buy: True = long, False = short
            size_usd: Position size in USD
            slippage: Max slippage (default 5%)

        Returns dict with: oid, filled_sz, avg_px, side, status
        Raises RuntimeError if exchange not initialized.
        Raises ValueError on invalid response.
        """
        if not self._exchange:
            raise RuntimeError("Exchange not initialized — no private key")

        # Get current price for size calculation
        price = self.get_price(symbol)
        if not price:
            raise ValueError(f"Could not get price for {symbol}")

        # Calculate size in base asset, rounded to asset's precision
        sz_decimals = self._get_sz_decimals(symbol)
        sz = round(size_usd / price, sz_decimals)
        if sz <= 0:
            raise ValueError(f"Size too small: ${size_usd} / ${price} = {sz} {symbol}")

        logger.info("market_open: %s %s sz=%.6f (=$%.0f) slippage=%.2f",
                     "BUY" if is_buy else "SELL", symbol, sz, size_usd, slippage)

        result = self._exchange.market_open(
            name=symbol, is_buy=is_buy, sz=sz, slippage=slippage,
        )

        return self._parse_order_result(result, symbol)

    def market_close(
        self,
        symbol: str,
        size: float | None = None,
        slippage: float = 0.05,
    ) -> dict:
        """Close a position (full or partial).

        Args:
            symbol: Asset to close
            size: Size in base asset to close (None = full position)
            slippage: Max slippage (default 5%)

        Returns dict with: oid, filled_sz, avg_px, side, status
        """
        if not self._exchange:
            raise RuntimeError("Exchange not initialized — no private key")

        logger.info("market_close: %s size=%s", symbol, size or "FULL")

        result = self._exchange.market_close(
            coin=symbol, sz=size, slippage=slippage,
        )

        return self._parse_order_result(result, symbol)

    def limit_open(
        self,
        symbol: str,
        is_buy: bool,
        limit_px: float,
        size_usd: float | None = None,
        sz: float | None = None,
        tif: str = "Gtc",
    ) -> dict:
        """Place a limit order (Good Till Cancel by default).

        Args:
            symbol: Asset (e.g., "BTC")
            is_buy: True = buy, False = sell
            limit_px: Limit price
            size_usd: Position size in USD (converted to base asset at limit_px)
            sz: Position size in base asset (use instead of size_usd)
            tif: Time in force — "Gtc" (default), "Alo" (add liquidity only), "Ioc"

        Returns dict with: oid, filled_sz, avg_px, side, status
        """
        if not self._exchange:
            raise RuntimeError("Exchange not initialized — no private key")

        if sz is None and size_usd is not None:
            sz_decimals = self._get_sz_decimals(symbol)
            sz = round(size_usd / limit_px, sz_decimals)
        elif sz is None:
            raise ValueError("Must provide either size_usd or sz")

        if sz <= 0:
            raise ValueError(f"Size too small: {sz} {symbol}")

        logger.info("limit_open: %s %s sz=%.6f @ %.2f tif=%s",
                     "BUY" if is_buy else "SELL", symbol, sz, limit_px, tif)

        result = self._exchange.order(
            name=symbol,
            is_buy=is_buy,
            sz=sz,
            limit_px=limit_px,
            order_type={"limit": {"tif": tif}},
        )

        return self._parse_order_result(result, symbol)

    def place_trigger_order(
        self,
        symbol: str,
        is_buy: bool,
        sz: float,
        trigger_px: float,
        tpsl: str,
    ) -> dict:
        """Place a stop-loss or take-profit trigger order.

        Args:
            symbol: Asset
            is_buy: Direction of the closing order
            sz: Size in base asset
            trigger_px: Price at which to trigger
            tpsl: "sl" for stop-loss, "tp" for take-profit

        Returns dict with: oid, status
        """
        if not self._exchange:
            raise RuntimeError("Exchange not initialized — no private key")

        if tpsl not in ("sl", "tp"):
            raise ValueError(f"tpsl must be 'sl' or 'tp', got '{tpsl}'")

        logger.info("trigger_order: %s %s %s trigger=%.2f sz=%.6f",
                     tpsl.upper(), "BUY" if is_buy else "SELL", symbol, trigger_px, sz)

        result = self._exchange.order(
            name=symbol,
            is_buy=is_buy,
            sz=sz,
            limit_px=trigger_px,
            order_type={
                "trigger": {
                    "triggerPx": trigger_px,
                    "isMarket": True,
                    "tpsl": tpsl,
                }
            },
            reduce_only=True,
        )

        return self._parse_order_result(result, symbol)

    def cancel_order(self, symbol: str, oid: int) -> bool:
        """Cancel an open order by OID.

        Returns True on success, False on failure.
        """
        if not self._exchange:
            raise RuntimeError("Exchange not initialized — no private key")

        try:
            self._exchange.cancel(name=symbol, oid=oid)
            return True
        except Exception as e:
            logger.error("Failed to cancel order %s/%d: %s", symbol, oid, e)
            return False

    def cancel_all_orders(self, symbol: str) -> int:
        """Cancel all open orders for a symbol. Returns count cancelled."""
        orders = self.get_open_orders()
        cancelled = 0
        for o in orders:
            if o["coin"] == symbol and o.get("oid"):
                if self.cancel_order(symbol, o["oid"]):
                    cancelled += 1
        return cancelled

    def update_leverage(
        self, symbol: str, leverage: int, is_cross: bool = True,
    ) -> None:
        """Update leverage for a symbol."""
        if not self._exchange:
            raise RuntimeError("Exchange not initialized — no private key")

        self._exchange.update_leverage(
            leverage=leverage, name=symbol, is_cross=is_cross,
        )
        logger.info("Leverage updated: %s = %dx (%s)",
                     symbol, leverage, "cross" if is_cross else "isolated")

    # ================================================================
    # Response Parsing
    # ================================================================

    @staticmethod
    def _parse_order_result(result: dict, symbol: str) -> dict:
        """Parse the SDK's raw order response into a clean dict.

        Expected structure:
            {"status": "ok", "response": {"type": "order", "data": {"statuses": [...]}}}
        """
        if not isinstance(result, dict):
            raise ValueError(f"Unexpected response type: {type(result)}")

        # Check for API-level error
        status = result.get("status")
        if status != "ok":
            raise ValueError(f"Order failed: {result}")

        resp = result.get("response", {})
        data = resp.get("data", {})
        statuses = data.get("statuses", [])

        if not statuses:
            raise ValueError(f"No order statuses in response: {result}")

        s = statuses[0]

        # The status can be nested in different ways
        if isinstance(s, dict):
            # Could be {"filled": {...}} or {"resting": {...}} or {"error": "..."}
            if "error" in s:
                raise ValueError(f"Order error: {s['error']}")

            # Extract from filled or resting
            if "filled" in s:
                fill = s["filled"]
                return {
                    "symbol": symbol,
                    "oid": fill.get("oid"),
                    "filled_sz": float(fill.get("totalSz", "0")),
                    "avg_px": float(fill.get("avgPx", "0")),
                    "status": "filled",
                }
            elif "resting" in s:
                rest = s["resting"]
                return {
                    "symbol": symbol,
                    "oid": rest.get("oid"),
                    "filled_sz": 0,
                    "avg_px": 0,
                    "status": "resting",
                }

        # Fallback: return what we can
        return {
            "symbol": symbol,
            "oid": s.get("oid"),
            "filled_sz": float(s.get("totalSz", s.get("filled", "0"))),
            "avg_px": float(s.get("avgFillPx", s.get("avgPx", "0"))),
            "status": s.get("status", "unknown"),
        }

    # ================================================================
    # Market Data (unchanged from original)
    # ================================================================

    def get_all_prices(self) -> dict[str, float]:
        """Get current mid prices for all traded assets.

        Returns:
            Dict mapping symbol to price, e.g. {"BTC": 97432.5, "ETH": 3421.8}
        """
        mids = self._info.all_mids()
        return {symbol: float(price) for symbol, price in mids.items()}

    def get_price(self, symbol: str) -> float | None:
        """Get current mid price for a single symbol.

        Returns:
            Price as float, or None if symbol not found.
        """
        mids = self._info.all_mids()
        price_str = mids.get(symbol)
        if price_str is None:
            return None
        return float(price_str)

    def get_candles(
        self,
        symbol: str,
        interval: str,
        start_ms: int,
        end_ms: int,
    ) -> list[dict]:
        """Get OHLCV candles for a symbol.

        Args:
            symbol: Trading symbol (e.g., "BTC").
            interval: Candle interval ("1h", "4h", "1d", etc.).
            start_ms: Start time in Unix milliseconds.
            end_ms: End time in Unix milliseconds.

        Returns:
            List of candle dicts with keys: t (int ms), o, h, l, c, v (all float).
            Sorted by timestamp ascending.
        """
        raw = self._info.candles_snapshot(symbol, interval, start_ms, end_ms)
        candles = []
        for c in raw:
            candles.append({
                "t": c["t"],
                "o": float(c["o"]),
                "h": float(c["h"]),
                "l": float(c["l"]),
                "c": float(c["c"]),
                "v": float(c["v"]),
            })
        # SDK should return sorted, but ensure it
        candles.sort(key=lambda x: x["t"])
        return candles

    def get_l2_book(self, symbol: str) -> dict | None:
        """Get L2 orderbook snapshot (up to 20 levels per side).

        Returns:
            Dict with keys: bids, asks, best_bid, best_ask, mid_price, spread.
            Each bid/ask is a list of {price, size, orders} dicts.
            Or None if error.
        """
        try:
            raw = self._info.l2_snapshot(symbol)
        except Exception as e:
            logger.error(f"L2 snapshot error for {symbol}: {e}")
            return None

        levels = raw.get("levels", [[], []])
        bids = [
            {"price": float(lv["px"]), "size": float(lv["sz"]), "orders": int(lv["n"])}
            for lv in levels[0]
        ]
        asks = [
            {"price": float(lv["px"]), "size": float(lv["sz"]), "orders": int(lv["n"])}
            for lv in levels[1]
        ]

        best_bid = bids[0]["price"] if bids else 0
        best_ask = asks[0]["price"] if asks else 0
        mid = (best_bid + best_ask) / 2 if best_bid and best_ask else 0

        return {
            "bids": bids,
            "asks": asks,
            "best_bid": best_bid,
            "best_ask": best_ask,
            "mid_price": mid,
            "spread": best_ask - best_bid if best_bid and best_ask else 0,
        }

    def get_funding_history(
        self, symbol: str, start_ms: int, end_ms: int | None = None,
    ) -> list[dict]:
        """Get historical funding rates for a symbol.

        Returns:
            List of {time (ms), rate (float), premium (float)} sorted ascending.
        """
        raw = self._info.funding_history(symbol, start_ms, end_ms)
        rates = [
            {
                "time": entry["time"],
                "rate": float(entry["fundingRate"]),
                "premium": float(entry.get("premium", "0")),
            }
            for entry in raw
        ]
        rates.sort(key=lambda x: x["time"])
        return rates

    def get_user_fills(
        self, start_ms: int, end_ms: int | None = None,
    ) -> list[dict]:
        """Get fills (trades) for the wallet in a time range.

        Args:
            start_ms: Start time in Unix milliseconds.
            end_ms: End time in Unix milliseconds (None = now).

        Returns:
            List of fill dicts with keys:
                coin, side, size, price, closed_pnl, direction, time, oid, hash
            - direction: "Open Long", "Close Long", "Open Short", "Close Short"
            - closed_pnl: 0 for opens, non-zero for closes (realized PnL)
            Sorted by time ascending.
        """
        if not self._wallet:
            raise RuntimeError("Exchange not initialized — no private key")

        raw = self._trade_info.user_fills_by_time(
            self._wallet.address, start_ms, end_ms,
        )

        fills = []
        for f in raw:
            fills.append({
                "coin": f.get("coin", "?"),
                "side": f.get("side", "?"),
                "size": float(f.get("sz", "0")),
                "price": float(f.get("px", "0")),
                "closed_pnl": float(f.get("closedPnl", "0")),
                "direction": f.get("dir", ""),
                "time": f.get("time", 0),
                "oid": f.get("oid"),
                "hash": f.get("hash", ""),
            })

        fills.sort(key=lambda x: x["time"])
        return fills

    def get_multi_asset_contexts(self, symbols: list[str]) -> dict[str, dict]:
        """Get context for multiple symbols in a single API call.

        Unlike get_asset_context() which fetches all assets per symbol,
        this calls the API once and extracts data for all requested symbols.

        Returns dict mapping symbol → context dict.
        """
        meta_and_ctxs = self._info.meta_and_asset_ctxs()
        meta = meta_and_ctxs[0]
        ctxs = meta_and_ctxs[1]

        universe = meta["universe"]
        symbols_set = set(symbols)
        result = {}
        for i, asset in enumerate(universe):
            if asset["name"] in symbols_set:
                ctx = ctxs[i]
                result[asset["name"]] = {
                    "funding": float(ctx.get("funding", "0")),
                    "open_interest": float(ctx.get("openInterest", "0")),
                    "day_volume": float(ctx.get("dayNtlVlm", "0")),
                    "mark_price": float(ctx["markPx"]) if ctx.get("markPx") else None,
                    "prev_day_price": float(ctx.get("prevDayPx", "0")),
                }
        return result

    def get_all_asset_contexts(self) -> dict[str, dict]:
        """Get context for ALL trading pairs in a single API call.

        Same as get_multi_asset_contexts but without symbol filtering.
        Used by the market scanner to track the full Hyperliquid universe.

        Returns dict mapping symbol → context dict.
        """
        meta_and_ctxs = self._info.meta_and_asset_ctxs()
        universe = meta_and_ctxs[0]["universe"]
        ctxs = meta_and_ctxs[1]

        result = {}
        for i, asset in enumerate(universe):
            ctx = ctxs[i]
            result[asset["name"]] = {
                "funding": float(ctx.get("funding", "0")),
                "open_interest": float(ctx.get("openInterest", "0")),
                "day_volume": float(ctx.get("dayNtlVlm", "0")),
                "mark_price": float(ctx["markPx"]) if ctx.get("markPx") else None,
                "prev_day_price": float(ctx.get("prevDayPx", "0")),
            }
        return result

    def get_asset_context(self, symbol: str) -> dict | None:
        """Get current context for an asset (funding, OI, volume, etc.).

        Returns:
            Dict with keys: funding, open_interest, day_volume, mark_price, prev_day_price.
            Or None if symbol not found in the universe.
        """
        meta_and_ctxs = self._info.meta_and_asset_ctxs()
        meta = meta_and_ctxs[0]
        ctxs = meta_and_ctxs[1]

        universe = meta["universe"]
        for i, asset in enumerate(universe):
            if asset["name"] == symbol:
                ctx = ctxs[i]
                return {
                    "funding": float(ctx.get("funding", "0")),
                    "open_interest": float(ctx.get("openInterest", "0")),
                    "day_volume": float(ctx.get("dayNtlVlm", "0")),
                    "mark_price": float(ctx["markPx"]) if ctx.get("markPx") else None,
                    "prev_day_price": float(ctx.get("prevDayPx", "0")),
                }
        return None
