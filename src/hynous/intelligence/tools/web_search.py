"""
Web Search Tool

Real-time web search via Perplexity Sonar API.
Gives the agent access to news, macro events, regulatory changes, and knowledge gaps.

This is a "break glass in case of emergency" tool — NOT for compulsive news checking.

Good use cases:
  - Something weird happened (flash crash, unexplained move, funding spike)
  - Cross-checking a thesis ("Is there actually Fed news today?")
  - Understanding macro/regulatory shifts that change the game
  - Filling a specific knowledge gap ("How does BTC behave around halving events?")
  - Learning trading concepts to sharpen analysis

Bad use cases:
  - "Let me search for Bitcoin price predictions" — useless
  - Reading analyst opinions to validate bias
  - Checking news before every trade
  - Anything the data tools already answer better

The agent's own words: "The data tools ARE the news, in objective form.
Money flow doesn't lie. News does."

Standard tool module pattern:
  1. TOOL_DEF — Anthropic JSON schema
  2. handler  — processes the tool call
  3. register — wires into the registry
"""

import logging

from .registry import Tool

logger = logging.getLogger(__name__)


# =============================================================================
# 1. TOOL DEFINITION — Anthropic JSON Schema
# =============================================================================

TOOL_DEF = {
    "name": "search_web",
    "description": (
        "Search the web for real-time information via Perplexity.\n"
        "Use this sparingly — only when data tools can't answer the question.\n\n"
        "GOOD use cases:\n"
        "- Anomalous market events: 'Why did BTC drop 15% in an hour?'\n"
        "- Macro context: 'Is there a Fed meeting today? What's expected?'\n"
        "- Regulatory news: 'Did any country just ban/approve crypto?'\n"
        "- Cross-checking thesis: 'Is there news explaining this funding spike?'\n"
        "- Learning: 'How does BTC typically behave during rate cuts?'\n"
        "- Knowledge gaps: 'What is the Puell Multiple and how should I interpret it?'\n\n"
        "BAD use cases (DO NOT use for these):\n"
        "- Price predictions or analyst opinions\n"
        "- Checking news before every trade\n"
        "- Anything your data tools already answer (use get_market_data, get_liquidations, etc. instead)\n\n"
        "Always provide context about WHY you're searching — it improves results.\n\n"
        "Examples:\n"
        '  {"query": "Why did Bitcoin drop sharply today February 2026", '
        '"context": "BTC fell 8% in 4 hours with heavy liquidations, trying to understand catalyst"}\n'
        '  {"query": "Fed interest rate decision February 2026", '
        '"context": "Checking if macro event explains sudden risk-off move"}\n'
        '  {"query": "How does Bitcoin typically perform after ETF approval events", '
        '"context": "Studying historical patterns to inform my trading framework"}'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "What to search for. Be specific — include dates, asset names, and what you want to know.",
            },
            "context": {
                "type": "string",
                "description": "WHY you're searching. What market condition or knowledge gap prompted this? Helps get better results.",
            },
        },
        "required": ["query"],
    },
}


# =============================================================================
# 2. HANDLER — processes the tool call
# =============================================================================

def handle_search_web(
    query: str,
    context: str | None = None,
) -> str:
    """Handle the search_web tool call."""
    from ...data.providers.perplexity import get_provider

    try:
        provider = get_provider()
        result = provider.search(query, context=context)
    except Exception as e:
        logger.error(f"Web search error: {e}")
        return f"Web search failed: {e}"

    answer = result["answer"]
    citations = result.get("citations", [])

    # Build compact output
    lines = ["Web Search Results:"]
    lines.append("")
    lines.append(answer)

    # Append top citations (max 4) so agent knows sources
    if citations:
        lines.append("")
        lines.append("Sources:")
        for url in citations[:4]:
            lines.append(f"  - {url}")

    return "\n".join(lines)


# =============================================================================
# 3. REGISTER — wires into the registry
# =============================================================================

def register(registry) -> None:
    """Register web search tool with the registry."""
    registry.register(Tool(
        name=TOOL_DEF["name"],
        description=TOOL_DEF["description"],
        parameters=TOOL_DEF["parameters"],
        handler=handle_search_web,
    ))
