from __future__ import annotations

"""
Trace Log — persistent storage for debug traces and content-addressed payloads.

Traces are stored in storage/traces.json (one JSON array, newest last).
Large payloads (system prompts, tool schemas, message arrays) are stored
in storage/payloads/ using SHA256 content addressing for deduplication.

Thread-safe, capped at 500 traces, 14-day retention, auto-pruned.

Follows the daemon_log.py pattern: Lock, lazy load, buffered flush, FIFO cap.

Usage:
    from hynous.core.trace_log import save_trace, load_traces, load_trace
    from hynous.core.trace_log import store_payload, load_payload
"""

import hashlib
import json
import logging
import threading
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

from .config import _find_project_root

logger = logging.getLogger(__name__)

_MAX_TRACES = 500
_RETENTION_DAYS = 14
_PRUNE_EVERY = 50  # Auto-prune every N saves

_lock = threading.Lock()
_traces_path: Path | None = None
_payloads_dir: Path | None = None

# In-memory state (lazy loaded)
_traces: list[dict] = []
_loaded: bool = False
_dirty: bool = False
_save_count: int = 0


def _get_paths() -> tuple[Path, Path]:
    """Get trace file path and payloads directory, creating if needed."""
    global _traces_path, _payloads_dir
    if _traces_path is None:
        root = _find_project_root()
        storage = root / "storage"
        storage.mkdir(exist_ok=True)
        _traces_path = storage / "traces.json"
        _payloads_dir = storage / "payloads"
        _payloads_dir.mkdir(exist_ok=True)
    return _traces_path, _payloads_dir


def _ensure_loaded():
    """Load traces from disk into memory if not yet loaded."""
    global _traces, _loaded
    if _loaded:
        return
    traces_path, _ = _get_paths()
    if traces_path.exists():
        try:
            _traces = json.loads(traces_path.read_text())
        except (json.JSONDecodeError, OSError):
            _traces = []
    _loaded = True


def _flush_to_disk():
    """Write in-memory traces to disk. Must be called under _lock."""
    global _dirty
    if not _dirty:
        return
    traces_path, _ = _get_paths()
    try:
        traces_path.write_text(json.dumps(_traces, indent=None, default=str))
        _dirty = False
    except OSError as e:
        logger.debug("Trace flush failed: %s", e)


def _prune():
    """Remove old traces and cap at _MAX_TRACES. Must be called under _lock."""
    global _dirty

    if not _traces:
        return

    cutoff = (datetime.now(timezone.utc) - timedelta(days=_RETENTION_DAYS)).isoformat()
    before = len(_traces)

    # Remove expired traces
    _traces[:] = [t for t in _traces if t.get("started_at", "") >= cutoff]

    # Cap at max
    if len(_traces) > _MAX_TRACES:
        del _traces[:len(_traces) - _MAX_TRACES]

    if len(_traces) != before:
        _dirty = True
        logger.debug("Pruned traces: %d → %d", before, len(_traces))

    # Clean orphaned payloads (only on prune, not every save)
    try:
        _clean_orphaned_payloads()
    except Exception:
        pass


def _clean_orphaned_payloads():
    """Remove payload files not referenced by any trace."""
    _, payloads_dir = _get_paths()
    if not payloads_dir.exists():
        return

    # Collect all payload hashes referenced by traces
    referenced = set()
    for trace in _traces:
        for span in trace.get("spans", []):
            for key in ("system_prompt_hash", "tools_hash", "messages_hash",
                        "response_hash", "input_hash", "output_hash"):
                h = span.get(key)
                if h:
                    referenced.add(h)

    # Remove unreferenced payload files
    for f in payloads_dir.iterdir():
        if f.suffix == ".json" and f.stem not in referenced:
            try:
                f.unlink()
            except OSError:
                pass


# ---- Public API ----

def save_trace(trace: dict) -> None:
    """Save a completed trace to disk. Thread-safe."""
    global _dirty, _save_count

    with _lock:
        _ensure_loaded()
        _traces.append(trace)
        _dirty = True
        _save_count += 1

        # Auto-prune periodically
        if _save_count % _PRUNE_EVERY == 0:
            _prune()

        _flush_to_disk()


def load_traces(
    limit: int = 50,
    offset: int = 0,
    source: str | None = None,
    status: str | None = None,
) -> list[dict]:
    """Load recent traces from disk. Newest first.

    Args:
        limit: Max traces to return.
        offset: Skip this many traces from the newest.
        source: Filter by source (e.g. "user_chat", "daemon:review").
        status: Filter by status ("completed", "error", "in_progress").
    """
    with _lock:
        _ensure_loaded()
        filtered = _traces

        if source:
            filtered = [t for t in filtered if t.get("source", "") == source]
        if status:
            filtered = [t for t in filtered if t.get("status", "") == status]

        # Newest first
        filtered = list(reversed(filtered))

        return filtered[offset:offset + limit]


def load_trace(trace_id: str) -> dict | None:
    """Load a single trace by ID."""
    with _lock:
        _ensure_loaded()
        for t in reversed(_traces):
            if t.get("trace_id") == trace_id:
                return dict(t)
    return None


def store_payload(content: str) -> str:
    """Store a payload using content-addressed SHA256 hashing.

    Returns the hash string. If the payload already exists, just returns
    the hash without writing (dedup). Thread-safe.

    Args:
        content: The payload content (typically JSON string of system prompt,
                 tool schemas, or message arrays).
    """
    content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]
    _, payloads_dir = _get_paths()
    payload_path = payloads_dir / f"{content_hash}.json"

    if not payload_path.exists():
        try:
            payload_path.write_text(content)
        except OSError as e:
            logger.debug("Failed to store payload %s: %s", content_hash, e)

    return content_hash


def load_payload(payload_hash: str) -> str | None:
    """Load a payload by its hash. Returns None if not found."""
    _, payloads_dir = _get_paths()
    payload_path = payloads_dir / f"{payload_hash}.json"
    if payload_path.exists():
        try:
            return payload_path.read_text()
        except OSError:
            return None
    return None


def flush() -> None:
    """Force flush buffered traces to disk. Call on shutdown."""
    with _lock:
        _flush_to_disk()
