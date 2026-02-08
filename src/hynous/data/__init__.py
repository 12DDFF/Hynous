"""
Data Layer - Market Data Providers

Connects Hynous to the outside world:
- Hyperliquid: Prices, funding, execution
- Binance: Historical data (optional)
- CryptoQuant: On-chain metrics (future)

These are wrapped by intelligence/tools/ for agent use.

Usage:
    from hynous.data import HyperliquidProvider

    provider = HyperliquidProvider()
    price = await provider.get_price("BTC")
    funding = await provider.get_funding("BTC")
"""

from .providers import HyperliquidProvider

__all__ = ["HyperliquidProvider"]
