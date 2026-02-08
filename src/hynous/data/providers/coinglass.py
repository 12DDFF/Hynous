"""
Coinglass Data Provider

REST wrapper for the Coinglass API v4.
Provides cross-exchange derivatives data: liquidations, open interest, funding rates,
options, ETF flows, exchange balances, and sentiment indicators.

Key decisions:
- Uses requests.Session for connection reuse (like Hyperliquid provider)
- Singleton pattern via get_provider() to avoid re-creating per tool call
- API key loaded from environment (COINGLASS_API_KEY)
- All methods return cleaned Python dicts/lists — callers never see raw API response
- Funding rates from Coinglass are in PERCENT (e.g., -0.02 = -0.02%), unlike
  Hyperliquid which uses decimal (0.0001 = 0.01%). We normalize to percent.

Available on Hobbyist plan:
- Liquidation coin list / exchange list
- OI exchange list + OI exchange history chart
- Funding rate exchange list + OI/vol weight history
- Options max pain + options exchange info
- Coinbase premium index
- BTC/ETH ETF flows + ETF list
- Exchange balance list + balance chart + assets
- Fear & Greed index, AHR999, Puell Multiple
"""

import os
import logging
from typing import Optional

import requests

logger = logging.getLogger(__name__)


_provider: Optional["CoinglassProvider"] = None


def get_provider() -> "CoinglassProvider":
    """Get or create the singleton CoinglassProvider."""
    global _provider
    if _provider is None:
        api_key = os.environ.get("COINGLASS_API_KEY", "")
        if not api_key:
            raise ValueError(
                "COINGLASS_API_KEY not set. Add it to your .env file."
            )
        _provider = CoinglassProvider(api_key)
    return _provider


class CoinglassProvider:
    """Synchronous wrapper around Coinglass API v4."""

    BASE_URL = "https://open-api-v4.coinglass.com"

    def __init__(self, api_key: str):
        self._session = requests.Session()
        self._session.headers["CG-API-KEY"] = api_key
        logger.info("CoinglassProvider initialized")

    def _get(self, path: str, params: dict | None = None) -> dict | list:
        """Make GET request, return data payload or raise on error."""
        url = f"{self.BASE_URL}{path}"
        resp = self._session.get(url, params=params, timeout=15)
        resp.raise_for_status()
        body = resp.json()
        code = str(body.get("code", ""))
        if code != "0":
            msg = body.get("msg", "Unknown error")
            raise CoinglassAPIError(f"Coinglass API error: {msg} (code={code})")
        return body.get("data", [])

    # =========================================================================
    # Liquidation endpoints
    # =========================================================================

    def get_liquidation_coins(self) -> list[dict]:
        """Get aggregate liquidation stats for all coins.

        Returns list of dicts with keys:
            symbol, liquidation_usd_{1h,4h,12h,24h},
            long_liquidation_usd_{1h,4h,12h,24h},
            short_liquidation_usd_{1h,4h,12h,24h}
        """
        return self._get("/api/futures/liquidation/coin-list")

    def get_liquidation_by_exchange(
        self, symbol: str = "BTC", range: str = "24h",
    ) -> list[dict]:
        """Get liquidation breakdown by exchange for a coin.

        Args:
            symbol: Coin symbol (e.g., "BTC", "ETH").
            range: Time range — "1h", "4h", "12h", or "24h".

        Returns list of dicts with keys:
            exchange, liquidation_usd, longLiquidation_usd, shortLiquidation_usd
        """
        return self._get(
            "/api/futures/liquidation/exchange-list",
            params={"symbol": symbol, "range": range},
        )

    # =========================================================================
    # Open Interest endpoints
    # =========================================================================

    def get_oi_by_exchange(self, symbol: str = "BTC") -> list[dict]:
        """Get cross-exchange open interest for a coin.

        Returns list of dicts with keys:
            exchange, symbol,
            open_interest_usd, open_interest_quantity,
            open_interest_change_percent_{5m,15m,30m,1h,4h,24h},
            open_interest_by_coin_margin, open_interest_by_stable_coin_margin
        """
        return self._get(
            "/api/futures/open-interest/exchange-list",
            params={"symbol": symbol},
        )

    # =========================================================================
    # Funding Rate endpoints
    # =========================================================================

    def get_funding_by_exchange(self, symbol: str = "BTC") -> dict:
        """Get current funding rates across all exchanges for a coin.

        Returns dict with key structure:
            [{symbol, stablecoin_margin_list: [{exchange, funding_rate, ...}]}]
        """
        data = self._get(
            "/api/futures/funding-rate/exchange-list",
            params={"symbol": symbol},
        )
        # Data is a list with one item per symbol
        if data and isinstance(data, list):
            return data[0] if data else {}
        return data

    def get_funding_history_weighted(
        self,
        symbol: str = "BTC",
        weight: str = "oi",
        interval: str = "8h",
        limit: int = 100,
    ) -> list[dict]:
        """Get aggregate weighted funding rate OHLC history.

        Args:
            symbol: Coin symbol (e.g., "BTC").
            weight: "oi" for OI-weighted, "vol" for volume-weighted.
            interval: Candle interval (e.g., "8h", "1d").
            limit: Number of candles (max 4500).

        Returns list of dicts with keys: time, open, high, low, close
            (values are funding rates in percent, e.g., -0.02 = -0.02%)
        """
        path = (
            "/api/futures/funding-rate/oi-weight-history"
            if weight == "oi"
            else "/api/futures/funding-rate/vol-weight-history"
        )
        raw = self._get(path, params={
            "symbol": symbol,
            "interval": interval,
            "limit": limit,
        })
        # Normalize: values come as strings
        return [
            {
                "time": entry["time"],
                "open": float(entry["open"]),
                "high": float(entry["high"]),
                "low": float(entry["low"]),
                "close": float(entry["close"]),
            }
            for entry in raw
        ]


    # =========================================================================
    # OI History endpoints
    # =========================================================================

    def get_oi_history_chart(
        self, symbol: str = "BTC", range: str = "4h",
    ) -> dict:
        """Get cross-exchange OI over time.

        Args:
            symbol: Coin symbol.
            range: Time range — "4h", "12h", "24h", etc.

        Returns dict with keys: time_list, price_list, data_map
            data_map is {exchange_name: [oi_values...]}
        """
        return self._get(
            "/api/futures/open-interest/exchange-history-chart",
            params={"symbol": symbol, "range": range},
        )

    # =========================================================================
    # Options endpoints
    # =========================================================================

    def get_options_max_pain(
        self, symbol: str = "BTC", exchange: str = "Deribit",
    ) -> list[dict]:
        """Get options max pain per expiry date.

        Returns list of dicts with keys:
            date, max_pain_price, call_open_interest, put_open_interest,
            call_open_interest_notional, put_open_interest_notional,
            call_open_interest_market_value, put_open_interest_market_value
        """
        return self._get(
            "/api/option/max-pain",
            params={"symbol": symbol, "exchange": exchange},
        )

    def get_options_info(
        self, symbol: str = "BTC", exchange: str = "Deribit",
    ) -> list[dict]:
        """Get cross-exchange options OI, volume, and market share.

        Returns list of dicts with keys:
            exchange_name, open_interest, oi_market_share,
            open_interest_change_24h, open_interest_usd,
            volume_usd_24h, volume_change_percent_24h
        """
        return self._get(
            "/api/option/info",
            params={"symbol": symbol, "exchange": exchange},
        )

    # =========================================================================
    # Coinbase Premium
    # =========================================================================

    def get_coinbase_premium(
        self, interval: str = "1h", limit: int = 24,
    ) -> list[dict]:
        """Get Coinbase premium/discount index over time.

        Returns list of dicts with keys: time, premium, premium_rate
            premium is USD diff, premium_rate is percentage.
        """
        return self._get(
            "/api/coinbase-premium-index",
            params={"interval": interval, "limit": limit},
        )

    # =========================================================================
    # ETF endpoints
    # =========================================================================

    def get_etf_flows(self, asset: str = "bitcoin") -> list[dict]:
        """Get daily ETF net flows.

        Args:
            asset: "bitcoin" or "ethereum"

        Returns list of dicts with keys:
            timestamp, flow_usd, price_usd, etf_flows (list of per-fund data)
        """
        return self._get(f"/api/etf/{asset}/flow-history")

    def get_etf_list(self, asset: str = "bitcoin") -> list[dict]:
        """Get list of ETFs.

        Returns list of dicts with keys:
            ticker, fund_name, region, market_status, primary_exchange, etc.
        """
        return self._get(f"/api/etf/{asset}/list")

    # =========================================================================
    # Exchange Balance (on-chain)
    # =========================================================================

    def get_exchange_balance(self, symbol: str = "BTC") -> list[dict]:
        """Get per-exchange holdings with 1d/7d/30d changes.

        Returns list of dicts with keys:
            exchange_name, total_balance,
            balance_change_{1d,7d,30d}, balance_change_percent_{1d,7d,30d}
        """
        return self._get(
            "/api/exchange/balance/list",
            params={"symbol": symbol},
        )

    def get_exchange_balance_chart(
        self, symbol: str = "BTC", exchange: str = "Binance",
    ) -> dict:
        """Get historical exchange balance time series.

        Returns dict with keys: time_list, price_list, data_map
        """
        return self._get(
            "/api/exchange/balance/chart",
            params={"symbol": symbol, "exchange": exchange},
        )

    # =========================================================================
    # Sentiment / Index indicators
    # =========================================================================

    def get_fear_greed(self) -> dict:
        """Get Fear & Greed index history.

        Returns dict with keys: data_list (values), price_list, time_list
        """
        return self._get("/api/index/fear-greed-history")

    def get_puell_multiple(self, limit: int = 30) -> list[dict]:
        """Get Puell Multiple history (mining indicator).

        Returns list of dicts with keys: timestamp, price, puell_multiple
        """
        data = self._get("/api/index/puell-multiple")
        # Return only the last N entries
        return data[-limit:] if data else []


class CoinglassAPIError(Exception):
    """Raised when Coinglass API returns a non-success response."""
    pass
