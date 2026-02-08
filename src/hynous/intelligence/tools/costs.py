"""
Costs Tool — get_my_costs

Lets the agent check his own operating costs. Token usage, API calls,
monthly subscriptions. He can be cost-conscious without this being
injected into every system prompt.
"""

import logging

logger = logging.getLogger(__name__)


TOOL_DEF = {
    "name": "get_my_costs",
    "description": (
        "Check your own operating costs — Claude API usage, Perplexity API usage, "
        "and fixed subscriptions (Coinglass). Use this when David asks about costs, "
        "or when you want to be aware of your burn rate."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}


def handle_get_my_costs() -> str:
    """Return a compact cost report."""
    from ...core.costs import get_cost_report
    return get_cost_report()


def register(registry):
    """Register the costs tool."""
    from .registry import Tool
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_get_my_costs,
    ))
