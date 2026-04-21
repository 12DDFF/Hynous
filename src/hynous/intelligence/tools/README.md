# Tools

> Functions Hynous can call during reasoning. 13 tool modules, 17 registered tools.

---

## Tool Modules

| File | Tools | Purpose |
|------|-------|---------|
| `market.py` | `get_market_data` | Price, volume, OI, funding snapshots |
| `orderbook.py` | `get_orderbook` | Orderbook depth and bid/ask spread |
| `funding.py` | `get_funding_history` | Historical funding rates |
| `multi_timeframe.py` | `get_multi_timeframe` | OHLCV across multiple timeframes |
| `liquidations.py` | `get_liquidations` | Recent liquidation data |
| `sentiment.py` | `get_global_sentiment` | Market sentiment indicators |
| `options.py` | `get_options_flow` | Options flow and positioning |
| `institutional.py` | `get_institutional_flow` | Institutional fund flows |
| `costs.py` | `get_my_costs` | LLM cost tracking and breakdown |
| `trading.py` | `close_position`, `modify_position`, `get_account` | Account view + exit/modify (entry execution moved to `mechanical_entry/executor.py`) |
| `data_layer.py` | `data_layer` | Hyperliquid satellite: heatmap, orderflow, whales, HLP vault, smart money, wallet profiling/tracking/alerts |

---

## Adding a Tool

1. Create a new file in `tools/`
2. Define a `TOOL_DEF` dict with name, description, and JSON Schema `parameters`
3. Write a handler function that receives kwargs and returns a string
4. Write a `register(registry)` function at the bottom
5. Import and call `register()` from `registry.py`
6. **If the tool is user-chat-invocable, add usage guidance to `src/hynous/user_chat/prompt.py`** -- registration alone is not enough; the agent will not discover a tool absent from its prompt. The analysis agent (`src/hynous/analysis/prompts.py`) does not call external tools.

```python
# tools/my_tool.py

TOOL_DEF = {
    "name": "my_tool",
    "description": "Does something useful",
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": "The trading symbol (BTC, ETH, SOL)",
            }
        },
        "required": ["symbol"],
    },
}

def handle_my_tool(symbol: str, **kwargs) -> str:
    """Implementation here. Returns string shown to the agent."""
    result = do_something(symbol)
    return f"Result: {result}"

def register(registry):
    from .registry import Tool
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_my_tool,
        background=False,  # True = fire-and-forget, False = agent sees result
    ))
```

Then in `registry.py`:
```python
from . import my_tool
my_tool.register(registry)
```

---

## Blocking vs Background Tools

- **Blocking** (`background=False`) -- agent waits for the real result. Use for tools where the agent needs feedback (trading, data fetches).
- **Background** (`background=True`) -- agent gets an instant `"Done."` and the handler runs in a separate thread. Use for fire-and-forget operations.

---

## Tool Design Principles

1. **Clear names** -- `get_market_data` not `fetchCurrentPriceData`
2. **Focused scope** -- One tool does one thing
3. **Useful output** -- Return what the agent needs to reason
4. **Handle errors** -- Return error messages, don't crash

---

Last updated: 2026-04-12 (phase 4 M9 — tool surface trimmed to 17 after M4/M8 deletions)
