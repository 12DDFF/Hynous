"""
Events - Market Event Detection

Monitors for significant market conditions:
- Funding extremes
- Price spikes
- Volume surges

When detected, events trigger agent analysis.
"""

from .detector import EventDetector
from .handlers import handle_event

__all__ = ["EventDetector", "handle_event"]
