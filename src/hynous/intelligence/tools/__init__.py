"""
Tools - Functions Hynous can call

Each module defines tools for a specific domain:
- market.py: Price data, period analysis, comparisons
- memory.py: Search and store knowledge (future)
- trading.py: Execute trades, manage positions (future)

Pattern: each module has TOOL_DEF + handler + register(registry).
See market.py for the reference implementation.
"""

from .registry import ToolRegistry, get_registry

__all__ = ["ToolRegistry", "get_registry"]
