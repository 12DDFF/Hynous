"""
Daemon Activity Log

Persistent JSON log of daemon events — wakes, watchpoints, fills, errors.
Thread-safe, capped at 500 events, stored at storage/daemon-log.json.

Optimization: events are buffered in memory and flushed to disk periodically
(every 30s or when get_events is called). This avoids reading and writing
the full JSON file on every single log_event() call.

Usage:
    from hynous.core.daemon_log import log_event, get_events, DaemonEvent
    log_event(DaemonEvent("watchpoint", "BTC price below 60K", "Triggered at $59,800"))
    events = get_events(limit=20)
"""

import json
import threading
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

from .config import _find_project_root

_MAX_EVENTS = 500
_FLUSH_INTERVAL = 30  # seconds between disk flushes
_lock = threading.Lock()
_log_path: Path | None = None

# In-memory state
_events: list[dict] = []
_loaded: bool = False
_dirty: bool = False
_last_flush: float = 0


def _get_log_path() -> Path:
    """Get the daemon log file path, creating storage dir if needed."""
    global _log_path
    if _log_path is None:
        root = _find_project_root()
        storage = root / "storage"
        storage.mkdir(exist_ok=True)
        _log_path = storage / "daemon-log.json"
    return _log_path


def _ensure_loaded():
    """Load events from disk into memory if not yet loaded."""
    global _events, _loaded
    if _loaded:
        return
    path = _get_log_path()
    if path.exists():
        try:
            _events = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            _events = []
    _loaded = True


def _flush_to_disk():
    """Write in-memory events to disk. Must be called under _lock."""
    global _dirty, _last_flush
    if not _dirty:
        return
    path = _get_log_path()
    try:
        path.write_text(json.dumps(_events, indent=None))
        _dirty = False
        _last_flush = time.monotonic()
    except OSError:
        pass  # Disk write failed — will retry next flush


@dataclass
class DaemonEvent:
    """A single daemon activity event."""
    type: str       # "wake", "watchpoint", "fill", "learning", "review", "error", "skip", "circuit_breaker", "profit", "news"
    title: str      # Human-readable summary
    detail: str     # Extra context (PnL, trigger condition, etc.)
    timestamp: str = ""  # ISO 8601 — auto-filled if empty

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()


def log_event(event: DaemonEvent) -> None:
    """Append an event to the daemon log. Thread-safe, buffered in memory."""
    global _dirty

    with _lock:
        _ensure_loaded()

        _events.append(asdict(event))
        if len(_events) > _MAX_EVENTS:
            del _events[:len(_events) - _MAX_EVENTS]
        _dirty = True

        # Periodic flush — avoid disk I/O on every event
        if time.monotonic() - _last_flush >= _FLUSH_INTERVAL:
            _flush_to_disk()


def get_events(limit: int = 50) -> list[dict]:
    """Get the most recent daemon events (newest first).

    Forces a disk flush to ensure consistency.

    Args:
        limit: Max events to return (default 50).

    Returns:
        List of event dicts with keys: type, title, detail, timestamp.
    """
    with _lock:
        _ensure_loaded()
        # No disk flush here — events are in memory and that's sufficient
        # for dashboard display. Periodic flush (every 30s) handles persistence.
        return list(reversed(_events[-limit:]))


def clear_log() -> None:
    """Clear all daemon log events."""
    global _dirty
    with _lock:
        _events.clear()
        _dirty = True
        _flush_to_disk()


def flush() -> None:
    """Force flush buffered events to disk. Call on shutdown."""
    with _lock:
        _flush_to_disk()
