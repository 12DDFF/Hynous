"""
Intelligence Layer - The Brain of Hynous

This module contains:
- agent.py: Core LLM agent with tool calling
- prompts/: System prompts (identity, trading knowledge)
- tools/: Tool definitions and handlers
- events/: Event detection and handling
- daemon.py: Background autonomous loop

Usage:
    from hynous.intelligence import Agent
    agent = Agent(config)
    response = await agent.chat("What's BTC doing?")
"""

from .agent import Agent

__all__ = ["Agent"]
