"""
Clock — Time awareness for Hynous.

Single source of truth for how the system sees time.
All times are Pacific (America/Los_Angeles) regardless of server location.

Used everywhere something needs a timestamp:
  - agent.chat() stamps each user message
  - daemon loop stamps event triggers (future)
  - any module that feeds messages to the agent

Usage:
    from hynous.core.clock import stamp, now, time_str

    # Stamp a message with current time
    stamped = stamp("What's BTC doing?")
    # → "[2:34 PM PST · Feb 6, 2026] What's BTC doing?"

    # Just get the formatted time string
    t = time_str()
    # → "2:34 PM PST · Feb 6, 2026"

    # Get raw datetime
    dt = now()
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

# Default timezone — Pacific Time (Los Angeles)
# Server may be in Europe but we always display Pacific.
_PACIFIC = ZoneInfo("America/Los_Angeles")


def now() -> datetime:
    """Current time (Pacific timezone)."""
    return datetime.now(_PACIFIC)


def now_utc() -> datetime:
    """Current time (UTC)."""
    return datetime.now(timezone.utc)


def time_str() -> str:
    """Formatted time string for display.

    Format: "2:34 PM PST · Feb 6, 2026"
    Includes timezone abbreviation (PST or PDT depending on DST).
    """
    t = now()
    tz_abbr = t.strftime("%Z")  # "PST" or "PDT"
    return t.strftime(f"%-I:%M %p {tz_abbr} · %b %-d, %Y")


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
