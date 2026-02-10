"""
Equity Tracker — Append-only JSON persistence for equity curve.

Records snapshots every ~5 min (called from daemon). Thread-safe.
Auto-prunes entries older than 30 days.

File: storage/equity.json
"""

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_STORAGE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "storage", "equity.json",
)
_MAX_AGE_DAYS = 30
_lock = threading.Lock()
_buffer: list[dict] = []
_loaded: bool = False


def _ensure_loaded():
    """Load existing data from disk on first access."""
    global _buffer, _loaded
    if _loaded:
        return
    try:
        if os.path.exists(_STORAGE_PATH):
            with open(_STORAGE_PATH, "r") as f:
                _buffer = json.load(f)
                if not isinstance(_buffer, list):
                    _buffer = []
        else:
            _buffer = []
    except Exception as e:
        logger.debug("Failed to load equity data: %s", e)
        _buffer = []
    _loaded = True


def _write():
    """Write buffer to disk. Caller must hold _lock."""
    try:
        os.makedirs(os.path.dirname(_STORAGE_PATH), exist_ok=True)
        with open(_STORAGE_PATH, "w") as f:
            json.dump(_buffer, f)
    except Exception as e:
        logger.debug("Failed to write equity data: %s", e)


def _prune():
    """Remove entries older than _MAX_AGE_DAYS. Caller must hold _lock."""
    global _buffer
    if not _buffer:
        return
    cutoff = time.time() - (_MAX_AGE_DAYS * 86400)
    _buffer = [s for s in _buffer if s.get("timestamp", 0) > cutoff]


def record_snapshot(
    account_value: float,
    unrealized_pnl: float,
    daily_realized_pnl: float,
    position_count: int,
):
    """Record an equity snapshot. Called from daemon every 5 min."""
    snapshot = {
        "timestamp": time.time(),
        "time_iso": datetime.now(timezone.utc).isoformat(),
        "account_value": round(account_value, 2),
        "unrealized_pnl": round(unrealized_pnl, 2),
        "daily_realized_pnl": round(daily_realized_pnl, 2),
        "position_count": position_count,
    }

    with _lock:
        _ensure_loaded()
        _buffer.append(snapshot)
        # Prune every 100 entries to avoid unbounded growth
        if len(_buffer) % 100 == 0:
            _prune()
        _write()


def get_equity_data(days: int = 30) -> list[dict]:
    """Get equity data for the last N days. For dashboard chart."""
    with _lock:
        _ensure_loaded()
        if not _buffer:
            return []
        cutoff = time.time() - (days * 86400)
        return [s for s in _buffer if s.get("timestamp", 0) > cutoff]


def flush():
    """Force write buffer to disk. Call on shutdown."""
    with _lock:
        _ensure_loaded()
        _prune()
        _write()
