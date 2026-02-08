# Intelligence Module

> The brain of Hynous. LLM agent with reasoning and tool use.

---

## Structure

```
intelligence/
├── agent.py           # Core agent (Claude wrapper, tool loop)
├── daemon.py          # Background loop for autonomous operation
│
├── prompts/           # System prompts
│   ├── identity.py    # Who Hynous is (personality, values)
│   ├── trading.py     # Trading knowledge (principles, not rules)
│   └── builder.py     # Assembles full prompt from parts
│
├── tools/             # Tool definitions
│   ├── registry.py    # Tool registration and lookup
│   ├── market.py      # get_price, get_funding, get_ohlcv
│   ├── memory.py      # search_memory, store_insight
│   ├── trading.py     # execute_trade, get_position
│   └── analysis.py    # Future: technical analysis tools
│
└── events/            # Event detection
    ├── detector.py    # Checks for significant market events
    └── handlers.py    # Event → Agent analysis triggers
```

---

## Key Patterns

### Adding a New Tool

```python
# tools/my_new_tool.py

from .registry import tool

@tool(
    name="my_tool",
    description="Does something useful",
    parameters={
        "param1": {"type": "string", "description": "..."}
    }
)
async def my_tool(param1: str) -> str:
    """Implementation here."""
    result = do_something(param1)
    return result
```

### Modifying the Prompt

Edit files in `prompts/` — they're combined by `builder.py`.

- `identity.py` — Hynous's personality (from storm-011)
- `trading.py` — Trading principles (from storm-010)

---

## Dependencies

- `anthropic` — Claude API
- `nous/` — Memory retrieval
- `data/` — Market data
