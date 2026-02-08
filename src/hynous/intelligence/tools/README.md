# Tools

> Functions Hynous can call during reasoning.

---

## Tool Categories

| File | Tools | Purpose |
|------|-------|---------|
| `market.py` | get_price, get_funding, get_ohlcv | Market data |
| `memory.py` | search_memory, store_insight | Knowledge management |
| `trading.py` | execute_trade, get_position, get_balance | Trade execution |
| `analysis.py` | (future) | Technical analysis |

---

## Adding a Tool

1. Create or edit the appropriate category file
2. Use the `@tool` decorator
3. Tool is automatically available to the agent

```python
from .registry import tool

@tool(
    name="get_something",
    description="Gets something useful",
    parameters={
        "symbol": {
            "type": "string",
            "description": "The trading symbol (BTC, ETH, SOL)"
        }
    }
)
async def get_something(symbol: str) -> dict:
    """
    Implementation here.

    Returns dict that will be shown to the agent.
    """
    return {"symbol": symbol, "value": 123}
```

---

## Tool Design Principles

1. **Clear names** — `get_price` not `fetchCurrentPriceData`
2. **Focused scope** — One tool does one thing
3. **Useful output** — Return what the agent needs to reason
4. **Handle errors** — Return error messages, don't crash
