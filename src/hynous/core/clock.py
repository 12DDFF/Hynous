"""
Clock — Time awareness for Hynous.

Single source of truth for how the system sees time.
Used everywhere something needs a timestamp:
  - agent.chat() stamps each user message
  - daemon loop stamps event triggers (future)
  - any module that feeds messages to the agent

Usage:
    from hynous.core.clock import stamp, now, time_str

    # Stamp a message with current time
    stamped = stamp("What's BTC doing?")
    # → "[2:34 PM · Feb 6, 2026] What's BTC doing?"

    # Just get the formatted time string
    t = time_str()
    # → "2:34 PM · Feb 6, 2026"

    # Get raw datetime
    dt = now()
"""

from datetime import datetime, timezone


def now() -> datetime:
    """Current time (local timezone)."""
    return datetime.now()


def now_utc() -> datetime:
    """Current time (UTC)."""
    return datetime.now(timezone.utc)


def time_str() -> str:
    """Formatted time string for display.

    Format: "2:34 PM · Feb 6, 2026"
    """
    t = now()
    return t.strftime("%-I:%M %p · %b %-d, %Y")


def stamp(message: str) -> str:
    """Prepend current timestamp to a message.

    This is how the agent "glances at the clock" — every message
    it processes carries the time it was created.

    Used by:
      - agent.chat() for user messages
      - daemon triggers for event messages (future)
    """
    return f"[{time_str()}] {message}"


def date_str() -> str:
    """Just the date, for system prompt baseline awareness.

    Format: "February 6, 2026"
    """
    return now().strftime("%B %-d, %Y")
