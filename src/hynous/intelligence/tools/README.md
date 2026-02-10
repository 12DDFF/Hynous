# Tools

> Functions Hynous can call during reasoning. Currently 17 tool modules registered.

---

## Tool Modules

| File | Tools | Purpose |
|------|-------|---------|
| `market.py` | `get_market_data` | Price, volume, OI, funding snapshots |
| `orderbook.py` | `get_orderbook` | Orderbook depth and bid/ask spread |
| `funding.py` | `get_funding_history` | Historical funding rates |
| `multi_timeframe.py` | `get_multi_timeframe` | OHLCV across multiple timeframes |
| `liquidations.py` | `get_liquidations` | Recent liquidation data |
| `sentiment.py` | `get_sentiment` | Market sentiment indicators |
| `options.py` | `get_options_data` | Options flow and positioning |
| `institutional.py` | `get_institutional_flows` | Institutional fund flows |
| `web_search.py` | `web_search` | Web search for news/context |
| `costs.py` | `estimate_costs` | Trading cost estimation |
| `memory.py` | `store_memory`, `recall_memory`, `update_memory` | Full memory CRUD (create, search/browse/time-range, update) |
| `delete_memory.py` | `delete_memory` | Memory deletion with edge cleanup |
| `trading.py` | `execute_trade`, `close_position`, `modify_position`, `get_positions`, `get_balance` | Trade execution and management |
| `watchpoints.py` | `manage_watchpoints` | Price/funding alert CRUD |
| `explore_memory.py` | `explore_memory` | Graph traversal: explore connections, link/unlink edges |
| `conflicts.py` | `manage_conflicts` | List and resolve contradictions in knowledge base |
| `clusters.py` | `manage_clusters` | Cluster CRUD, membership, scoped search, health, auto-assignment |

---

## Adding a Tool

1. Create a new file in `tools/`
2. Define a `TOOL_DEF` dict with name, description, and JSON Schema `parameters`
3. Write a handler function that receives kwargs and returns a string
4. Write a `register(registry)` function at the bottom
5. Import and call `register()` from `registry.py`

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

- **Blocking** (`background=False`) — agent waits for the real result. Use for tools where the agent needs feedback (recall, update, explore, conflicts, trading).
- **Background** (`background=True`) — agent gets an instant `"Done."` and the handler runs in a separate thread. Use for fire-and-forget operations. Note: `store_memory` was changed from background to blocking (NW-10) so the agent sees storage confirmation.

---

## Tool Design Principles

1. **Clear names** — `get_market_data` not `fetchCurrentPriceData`
2. **Focused scope** — One tool does one thing
3. **Useful output** — Return what the agent needs to reason
4. **Handle errors** — Return error messages, don't crash
5. **Use NousClient** — All memory operations go through `src/hynous/nous/client.py`
