"""
Prompts - Hynous's System Prompt Components

The system prompt is assembled from parts:
- identity.py: Who Hynous is (personality, values, relationship)
- trading.py: Trading knowledge (principles, decision framework)
- builder.py: Combines parts into full prompt

Usage:
    from hynous.intelligence.prompts import build_system_prompt
    prompt = build_system_prompt(context)
"""

from .builder import build_system_prompt

__all__ = ["build_system_prompt"]
