# Data Module

> Market data providers - Hynous's window to the markets.

---

## Structure

```
data/
├── providers/
│   ├── hyperliquid.py   # Main exchange (prices, funding, trades)
│   ├── binance.py       # Historical data (optional backup)
│   └── cryptoquant.py   # On-chain metrics (future)
└── __init__.py
```

---

## Providers

| Provider | Data | Priority |
|----------|------|----------|
| Hyperliquid | Prices, funding, positions, execution | P0 |
| Binance | Historical OHLCV | P1 |
| CryptoQuant | Whale flows, exchange reserves | P2 |

---

## Provider Interface

All providers follow the same pattern:

```python
class BaseProvider:
    async def get_price(self, symbol: str) -> float: ...
    async def get_funding(self, symbol: str) -> float: ...
    async def get_ohlcv(self, symbol: str, timeframe: str, limit: int) -> list: ...
```

---

## Integration with Hydra

These providers can wrap existing Hydra data sources:

```python
from hydra.data import HyperliquidDataSource

class HyperliquidProvider:
    def __init__(self):
        self.source = HyperliquidDataSource()

    async def get_price(self, symbol: str) -> float:
        return await self.source.get_current_price(symbol)
```

This allows Hynous to benefit from Hydra's existing infrastructure.

---

## Adding a New Provider

1. Create file in `providers/`
2. Implement the base interface
3. Export in `__init__.py`
4. Create corresponding tools in `intelligence/tools/`
