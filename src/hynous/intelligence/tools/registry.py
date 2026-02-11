"""
Tool Registry

Manages tools that Hynous can call during reasoning.
Tools are registered here and converted to OpenAI/LiteLLM tool format for the API.

Pattern for adding new tools:
  1. Create a new file in this directory (e.g., memory.py, trading.py)
  2. Define TOOL_DEF dict, handler function, and register(registry) function
  3. Add one import + call in get_registry() below

See market.py for the reference implementation.
"""

from dataclasses import dataclass, field
from typing import Callable, Any


@dataclass
class Tool:
    """A tool that Hynous can call.

    Set background=True for fire-and-forget tools whose results don't
    influence the agent's response (e.g. store_memory).  The agent receives
    an immediate synthetic "Done." result while the real work runs in a
    daemon thread.  This saves latency on the tool-result → Claude round-trip.
    """

    name: str
    description: str
    parameters: dict  # JSON Schema
    handler: Callable[..., Any]
    background: bool = False

    def to_litellm_format(self) -> dict:
        """Convert to OpenAI/LiteLLM tool format."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolRegistry:
    """Registry of tools available to the agent."""

    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        """Register a tool."""
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        """Get a tool by name."""
        return self._tools.get(name)

    def list_tools(self) -> list[Tool]:
        """List all registered tools."""
        return list(self._tools.values())

    def to_litellm_format(self) -> list[dict]:
        """Convert all tools to OpenAI/LiteLLM format."""
        return [tool.to_litellm_format() for tool in self._tools.values()]

    def call(self, tool_name: str, **kwargs) -> Any:
        """Call a tool by name with arguments."""
        tool = self.get(tool_name)
        if not tool:
            raise ValueError(f"Unknown tool: {tool_name}")
        return tool.handler(**kwargs)

    @property
    def has_tools(self) -> bool:
        """Whether any tools are registered."""
        return len(self._tools) > 0


def get_registry() -> ToolRegistry:
    """Create a registry with all tools.

    Each tool module has a register(registry) function.
    Add new tools by importing their module and calling register().
    """
    registry = ToolRegistry()

    from . import market
    market.register(registry)

    from . import orderbook
    orderbook.register(registry)

    from . import funding
    funding.register(registry)

    from . import multi_timeframe
    multi_timeframe.register(registry)

    from . import liquidations
    liquidations.register(registry)

    from . import sentiment
    sentiment.register(registry)

    from . import options
    options.register(registry)

    from . import institutional
    institutional.register(registry)

    from . import web_search
    web_search.register(registry)

    from . import costs
    costs.register(registry)

    from . import memory
    memory.register(registry)

    from . import trading
    trading.register(registry)

    from . import delete_memory
    delete_memory.register(registry)

    from . import watchpoints
    watchpoints.register(registry)

    from . import trade_stats
    trade_stats.register(registry)

    from . import explore_memory
    explore_memory.register(registry)

    from . import conflicts
    conflicts.register(registry)

    from . import clusters
    clusters.register(registry)

    return registry
