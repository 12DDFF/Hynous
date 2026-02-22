# Debug Dashboard — Detailed Implementation Guide

> This guide is self-contained. An engineer agent with no prior context should be able to implement the entire debug dashboard by following it step-by-step.

---

## Table of Contents

1. [Pre-Read Requirements](#1-pre-read-requirements)
2. [Chunk 1: Data Models (`request_tracer.py`)](#chunk-1-data-models--tracer-singleton)
3. [Chunk 2: Persistence Layer (`trace_log.py`)](#chunk-2-persistence-layer)
4. [Chunk 3: Instrument `agent.py`](#chunk-3-instrument-agentpy)
5. [Chunk 4: Instrument `memory_manager.py`](#chunk-4-instrument-memory_managerpy)
6. [Chunk 5: Instrument `tools/memory.py`](#chunk-5-instrument-toolsmemorypy)
7. [Chunk 6: Tag Daemon Wake Source](#chunk-6-tag-daemon-wake-source)
8. [Chunk 7: Dashboard State](#chunk-7-dashboard-state)
9. [Chunk 8: Debug Page UI](#chunk-8-debug-page-ui)
10. [Chunk 9: Wire Routing + Nav](#chunk-9-wire-routing--nav)
11. [Chunk 10: Live View + Polish](#chunk-10-live-view--polish)
12. [Final Verification](#final-verification)

---

## 1. Pre-Read Requirements

**Before writing ANY code, the engineer MUST read these files in full to understand the codebase patterns, conventions, and architecture.** Failure to do so will result in inconsistent code that breaks the system.

### Required Reading — Core Patterns (read in this order)

| # | File | Why |
|---|------|-----|
| 1 | `src/hynous/core/daemon_log.py` | **Primary pattern to follow.** Thread-safe module-level singleton, `threading.Lock`, lazy load from disk, buffered writes every 30s, FIFO cap at 500 entries, `_find_project_root()` for storage path. Your `trace_log.py` MUST follow this exact pattern. |
| 2 | `src/hynous/core/memory_tracker.py` | **Secondary pattern.** Class-based singleton via `get_tracker()`, instance-level `_lock`, `reset()` per cycle, `record_*()` methods. Your `RequestTracer` class follows this pattern. |
| 3 | `src/hynous/core/config.py` | Understand `_find_project_root()` — this is how all storage modules locate the `storage/` directory. You will import and use this. Also shows the `Config` dataclass hierarchy. |
| 4 | `src/hynous/core/clock.py` | **All timestamps use this module.** `now_utc()` for ISO timestamps, `stamp()` for message prefixing. Never use `datetime.now()` directly. |
| 5 | `src/hynous/core/costs.py` | Shows how `record_llm_usage()` captures LLM costs. The tracer captures similar data (tokens, model, cost) but for debug visibility, not billing. |
| 6 | `src/hynous/core/persistence.py` | Shows serialization patterns — how SDK objects get converted to plain dicts for JSON. Important for understanding what the message history looks like. |

### Required Reading — Files to Instrument

| # | File | Why |
|---|------|-----|
| 7 | `src/hynous/intelligence/agent.py` | **The main file to instrument.** Read the ENTIRE file (965 lines). Understand: `chat()` (line 507), `chat_stream()` (line 676), `_build_messages()` (line 144), `_compact_messages()` (line 217), `_api_kwargs()` (line 312), `_execute_tools()` (line 366), `_record_usage()` (line 933). Note: there is no `source` parameter on `chat()` currently — you will add one. |
| 8 | `src/hynous/intelligence/memory_manager.py` | Read fully (620 lines). Key methods: `retrieve_context()` (line 87), `maybe_compress()` (line 172), `_compress_and_store()` (line 251), `_compress_one()` (line 265). |
| 9 | `src/hynous/intelligence/tools/memory.py` | Read fully (943 lines). Key functions: `handle_store_memory()` (line 335), `_store_memory_impl()` (line 369), `handle_recall_memory()` (line 685), `handle_update_memory()` (line 828), `flush_memory_queue()` (line 56). |
| 10 | `src/hynous/intelligence/daemon.py` | Read `_wake_agent()` (line 1961-2128) and all `_wake_for_*` methods (lines 1160, 1302, 1356, 1395, 1481, 1715). Each calls `_wake_agent()` — you need to understand the call chain to add source tagging. |

### Required Reading — Dashboard Patterns

| # | File | Why |
|---|------|-----|
| 11 | `dashboard/dashboard/state.py` | Read first 500 lines carefully. Understand: `_background` decorator (line 28), `AppState` class (line 360), navigation (`current_page`, `go_to_*` methods), `poll_portfolio` (line 720) as the background polling pattern, `_get_agent()` singleton (line 297). |
| 12 | `dashboard/dashboard/dashboard.py` | Read fully (269 lines). Understand: `_dashboard_content()` page routing via nested `rx.cond` (line 167-179), `index()` auth gate (line 199), the `app` object (line 209), `_eager_agent_start` lifespan task (line 255). |
| 13 | `dashboard/dashboard/components/nav.py` | Read fully (147 lines). Understand: `nav_item()` component signature, `navbar()` parameter list — you will add `on_debug` callback. |
| 14 | `dashboard/dashboard/pages/memory.py` | Read first 100 lines. This is the **UI pattern to follow** — sidebar + main area layout, `_section_header()`, dark theme colors. |
| 15 | `dashboard/dashboard/pages/__init__.py` | Shows how pages are exported — you will add `debug_page` here. |
| 16 | `dashboard/dashboard/pages/home.py` | Skim first 200 lines for component patterns: `rx.box`, `rx.vstack`, `rx.hstack`, color constants, font sizing, hover states. |

### Required Reading — Existing Debug/Logging Context

| # | File | Why |
|---|------|-----|
| 17 | `config/default.yaml` | Has `logging:` section (lines 107-111). Understand existing log levels. |
| 18 | `debugging/brief-planning.md` | The architectural plan this guide implements. Reference for data model, span types, and design principles. |

**Total: 18 files. Read ALL of them before writing code.**

---

## Critical Rules

These rules apply to EVERY chunk. Violating any of them will break the system.

1. **NEVER break the agent.** Every tracer call in `agent.py`, `memory_manager.py`, `tools/memory.py`, and `daemon.py` MUST be wrapped in `try/except` with a silent pass or logger.debug fallback. If tracing throws, the agent MUST continue normally.

2. **Follow existing import style.** Look at how existing files import — relative imports within the package (`from ..core.config import ...`), absolute for stdlib. Match exactly.

3. **Thread safety.** Use `threading.Lock` for all shared state. Follow the `daemon_log.py` lock pattern exactly.

4. **Storage path.** Always use `_find_project_root() / "storage"` for file paths. Never hardcode paths.

5. **Timestamps.** Use `datetime.now(timezone.utc).isoformat()` for all trace timestamps (matching `daemon_log.py` line 87).

6. **JSON serialization.** Only store plain Python types (str, int, float, bool, list, dict, None) in traces. No dataclass instances, no SDK objects.

7. **No new dependencies.** Only use stdlib + packages already in `pyproject.toml`.

8. **Dark theme colors.** Background: `#0a0a0a`. Surface: `#141414`. Borders: `#1a1a1a`. Text: `#fafafa`. Muted: `#737373`. Dimmed: `#525252`. Accent: `#6366f1`. Error: `#ef4444`. Success: `#22c55e`. Warning: `#f59e0b`. Mono font: `JetBrains Mono, monospace`.

9. **File size awareness.** The system prompt is ~2KB, tool schemas ~5KB, message arrays can be 10-50KB. These MUST be stored via content-addressed payloads, NOT inlined in traces.

10. **Reflex reactive patterns.** Dashboard uses nested `rx.cond` for page routing — add another `rx.cond` level for the debug route. Reflex 0.8.26 DOES support `rx.match` for multi-branch value mapping (used in `home.py`, `chat.py`, `ticker.py`) — use it for span type → color/label mapping. However, `rx.foreach` only accepts a **single-argument** lambda: `lambda item: component(item)`. It does NOT support two-argument `lambda item, idx:` — no index is available. For expand/collapse by index, pre-compute the data server-side in state methods.

---

## Chunk 1: Data Models + Tracer Singleton

### Create: `src/hynous/core/request_tracer.py`

This is the in-process tracer. It holds active traces in memory, records spans, and flushes completed traces to `trace_log.py`.

```python
"""
Request Tracer — in-process trace collector for the debug dashboard.

Records spans during each agent.chat() / chat_stream() call. Traces are
held in memory while active and flushed to trace_log.py on completion.

Thread-safe. Singleton via module-level instance (same pattern as memory_tracker.py).

All public methods are safe to call from any thread. If anything fails internally,
the tracer silently degrades — it must NEVER break the agent.

Usage:
    from hynous.core.request_tracer import get_tracer

    trace_id = get_tracer().begin_trace("user_chat", "What's BTC doing?")
    get_tracer().record_span(trace_id, {
        "type": "llm_call",
        "model": "claude-sonnet-4-5",
        "duration_ms": 1200,
        ...
    })
    get_tracer().end_trace(trace_id, "completed", "BTC is at $97K...")
"""

import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ---- Span type constants (used by instrumented code) ----
SPAN_CONTEXT = "context"
SPAN_RETRIEVAL = "retrieval"
SPAN_LLM_CALL = "llm_call"
SPAN_TOOL_EXEC = "tool_execution"
SPAN_MEMORY_OP = "memory_op"
SPAN_COMPRESSION = "compression"
SPAN_QUEUE_FLUSH = "queue_flush"


class RequestTracer:
    """Collects traces and spans for debug visibility.

    Thread-safe. One singleton instance shared across the process.
    Each chat() or chat_stream() call gets one trace with ordered spans.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # Active traces: trace_id -> trace dict (in-memory while request is running)
        self._active: dict[str, dict] = {}
        # Completed traces waiting to be read (in-memory cache of recent traces)
        self._completed: list[dict] = []
        self._max_completed = 100  # In-memory cache size

    def begin_trace(self, source: str, input_summary: str) -> str:
        """Start a new trace. Returns trace_id.

        Args:
            source: Origin of the request. One of:
                "user_chat", "discord", "daemon:review", "daemon:watchpoint",
                "daemon:scanner", "daemon:fill", "daemon:curiosity",
                "daemon:learning", "daemon:conflict", "daemon:profit",
                "daemon:manual"
            input_summary: First ~200 chars of the input message.
        """
        trace_id = str(uuid.uuid4())
        trace = {
            "trace_id": trace_id,
            "source": source,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "ended_at": None,
            "status": "in_progress",
            "input_summary": input_summary[:200] if input_summary else "",
            "output_summary": "",
            "spans": [],
            "total_duration_ms": 0,
            "error": None,
            "_start_mono": time.monotonic(),  # For duration calc (not persisted)
        }
        with self._lock:
            self._active[trace_id] = trace
        return trace_id

    def record_span(self, trace_id: str, span: dict) -> None:
        """Append a span to an active trace.

        Args:
            trace_id: The trace to append to.
            span: A dict with at minimum:
                - "type": one of the SPAN_* constants
                - "started_at": ISO timestamp
                - "duration_ms": int
                Plus type-specific fields (see each span type below).
        """
        with self._lock:
            trace = self._active.get(trace_id)
            if trace is not None:
                trace["spans"].append(span)

    def end_trace(
        self,
        trace_id: str,
        status: str,
        output_summary: str = "",
        error: str | None = None,
    ) -> None:
        """Finalize a trace and persist it.

        Args:
            trace_id: The trace to finalize.
            status: "completed" or "error".
            output_summary: First ~200 chars of the response.
            error: Exception message if status is "error".
        """
        with self._lock:
            trace = self._active.pop(trace_id, None)

        if trace is None:
            return

        # Finalize fields
        trace["ended_at"] = datetime.now(timezone.utc).isoformat()
        trace["status"] = status
        trace["output_summary"] = output_summary[:200] if output_summary else ""
        trace["error"] = error
        start_mono = trace.pop("_start_mono", None)
        if start_mono is not None:
            trace["total_duration_ms"] = int((time.monotonic() - start_mono) * 1000)

        # Add to in-memory completed cache
        with self._lock:
            self._completed.append(trace)
            if len(self._completed) > self._max_completed:
                self._completed = self._completed[-self._max_completed:]

        # Persist to disk (fire-and-forget)
        try:
            from .trace_log import save_trace
            save_trace(trace)
        except Exception as e:
            logger.debug("Failed to persist trace %s: %s", trace_id, e)

    def export_partial(self, trace_id: str) -> dict | None:
        """Export an in-progress trace for live view.

        Returns a snapshot dict, or None if trace_id not found.
        """
        with self._lock:
            trace = self._active.get(trace_id)
            if trace is None:
                return None
            # Return a shallow copy so caller can read without holding lock
            snapshot = dict(trace)
            snapshot["spans"] = list(trace["spans"])
            # Compute duration so far
            start_mono = trace.get("_start_mono")
            if start_mono is not None:
                snapshot["total_duration_ms"] = int(
                    (time.monotonic() - start_mono) * 1000
                )
            snapshot.pop("_start_mono", None)
            return snapshot

    def get_active_trace_ids(self) -> list[str]:
        """Get IDs of all currently in-progress traces."""
        with self._lock:
            return list(self._active.keys())

    def get_recent_traces(self, limit: int = 50) -> list[dict]:
        """Get recent trace summaries (completed + active) for sidebar.

        Returns list of dicts with keys: trace_id, source, status,
        started_at, total_duration_ms, input_summary.
        Newest first.
        """
        summaries = []

        with self._lock:
            # Active traces first (they're newest)
            for trace in self._active.values():
                start_mono = trace.get("_start_mono")
                duration = (
                    int((time.monotonic() - start_mono) * 1000)
                    if start_mono
                    else 0
                )
                summaries.append({
                    "trace_id": trace["trace_id"],
                    "source": trace["source"],
                    "status": "in_progress",
                    "started_at": trace["started_at"],
                    "total_duration_ms": duration,
                    "input_summary": trace["input_summary"],
                    "span_count": len(trace["spans"]),
                })

        # Also load from disk for completed traces
        try:
            from .trace_log import load_traces
            disk_traces = load_traces(limit=limit)
            for t in disk_traces:
                summaries.append({
                    "trace_id": t["trace_id"],
                    "source": t["source"],
                    "status": t["status"],
                    "started_at": t["started_at"],
                    "total_duration_ms": t.get("total_duration_ms", 0),
                    "input_summary": t.get("input_summary", ""),
                    "span_count": len(t.get("spans", [])),
                })
        except Exception as e:
            logger.debug("Failed to load traces from disk: %s", e)

        # Sort newest first, deduplicate by trace_id
        seen = set()
        unique = []
        for s in summaries:
            tid = s["trace_id"]
            if tid not in seen:
                seen.add(tid)
                unique.append(s)

        unique.sort(key=lambda x: x["started_at"], reverse=True)
        return unique[:limit]

    def get_trace(self, trace_id: str) -> dict | None:
        """Get a full trace by ID (active or completed).

        Returns the full trace dict with all spans, or None.
        """
        # Check active first
        partial = self.export_partial(trace_id)
        if partial is not None:
            return partial

        # Check in-memory completed cache
        with self._lock:
            for t in reversed(self._completed):
                if t["trace_id"] == trace_id:
                    return dict(t)

        # Fall back to disk
        try:
            from .trace_log import load_trace
            return load_trace(trace_id)
        except Exception as e:
            logger.debug("Failed to load trace %s from disk: %s", trace_id, e)
            return None


# ---- Module-level singleton ----

_tracer: RequestTracer | None = None
_tracer_lock = threading.Lock()


def get_tracer() -> RequestTracer:
    """Get the global RequestTracer singleton."""
    global _tracer
    if _tracer is None:
        with _tracer_lock:
            if _tracer is None:
                _tracer = RequestTracer()
    return _tracer
```

### Verification — Chunk 1

After creating this file, verify:

1. **Import check**: Run `python -c "from hynous.core.request_tracer import get_tracer, SPAN_LLM_CALL; print('OK')"` from the project root.
2. **Basic round-trip**: Run this in a Python shell:
   ```python
   from hynous.core.request_tracer import get_tracer
   t = get_tracer()
   tid = t.begin_trace("test", "hello world")
   t.record_span(tid, {"type": "llm_call", "model": "test", "duration_ms": 100, "started_at": "2026-01-01T00:00:00Z"})
   assert t.export_partial(tid) is not None
   assert t.export_partial(tid)["status"] == "in_progress"
   assert len(t.export_partial(tid)["spans"]) == 1
   # Don't call end_trace yet — trace_log.py doesn't exist yet
   print("Chunk 1 OK")
   ```
3. **Thread safety**: The `_lock` is used in every public method. Confirm no public method accesses `_active` or `_completed` without holding the lock.

---

## Chunk 2: Persistence Layer

### Create: `src/hynous/core/trace_log.py`

This handles disk I/O for traces and content-addressed payloads. Follows the `daemon_log.py` pattern exactly.

```python
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
    # Any span key ending in _hash is a payload reference
    referenced = set()
    for trace in _traces:
        for span in trace.get("spans", []):
            for key, val in span.items():
                if key.endswith("_hash") and isinstance(val, str):
                    referenced.add(val)

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
```

### Verification — Chunk 2

Run this test script from the project root:

```python
import json, os, sys
sys.path.insert(0, "src")

from hynous.core.trace_log import save_trace, load_traces, load_trace, store_payload, load_payload

# Test payload dedup
h1 = store_payload("test content 123")
h2 = store_payload("test content 123")
assert h1 == h2, "Payload dedup failed"
assert load_payload(h1) == "test content 123"
print(f"Payload dedup OK: {h1}")

# Test trace save/load
trace = {
    "trace_id": "test-001",
    "source": "test",
    "started_at": "2026-02-11T00:00:00+00:00",
    "ended_at": "2026-02-11T00:00:01+00:00",
    "status": "completed",
    "input_summary": "test input",
    "output_summary": "test output",
    "spans": [{"type": "llm_call", "duration_ms": 500}],
    "total_duration_ms": 1000,
    "error": None,
}
save_trace(trace)

loaded = load_traces(limit=10)
assert len(loaded) >= 1, "No traces loaded"
assert loaded[0]["trace_id"] == "test-001"
print(f"Trace round-trip OK: {loaded[0]['trace_id']}")

single = load_trace("test-001")
assert single is not None
assert single["spans"][0]["type"] == "llm_call"
print("Single trace load OK")

# Now test end_trace from request_tracer (full pipeline)
from hynous.core.request_tracer import get_tracer
t = get_tracer()
tid = t.begin_trace("test", "full pipeline test")
t.record_span(tid, {"type": "llm_call", "model": "test", "duration_ms": 100, "started_at": "2026-01-01T00:00:00Z"})
t.end_trace(tid, "completed", "response text here")
full = t.get_trace(tid)
assert full is not None
assert full["status"] == "completed"
assert len(full["spans"]) == 1
print("Full pipeline (tracer → log) OK")

# Cleanup test trace
from hynous.core.trace_log import _lock, _traces, _flush_to_disk
with _lock:
    _traces[:] = [t for t in _traces if t.get("trace_id") != "test-001"]
    import hynous.core.trace_log as tl
    tl._dirty = True
    _flush_to_disk()
print("Cleanup OK")
print("\n=== Chunk 2 ALL TESTS PASSED ===")
```

---

## Chunk 3: Instrument `agent.py`

### Overview

Add a `source` parameter to `chat()` and `chat_stream()`. Wrap each major operation in trace spans. All tracer calls are wrapped in try/except so tracing can never break the agent.

### Modifications

**Step 3.1 — Add imports at the top of `agent.py`**

Find this block (lines 10-28):

```python
import logging
import json
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Generator

import litellm

from .prompts import build_system_prompt
from .memory_manager import MemoryManager
from .tools.registry import ToolRegistry, get_registry
from .tools.memory import enable_queue_mode, disable_queue_mode, flush_memory_queue
from ..core.config import Config, load_config
from ..core.clock import stamp
from ..core import persistence
from ..core.costs import record_llm_usage
from ..core.memory_tracker import get_tracker
```

Replace with (3 new imports added):

```python
import logging
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Generator

import litellm

from .prompts import build_system_prompt
from .memory_manager import MemoryManager
from .tools.registry import ToolRegistry, get_registry
from .tools.memory import enable_queue_mode, disable_queue_mode, flush_memory_queue
from ..core.config import Config, load_config
from ..core.clock import stamp
from ..core import persistence
from ..core.costs import record_llm_usage
from ..core.memory_tracker import get_tracker
from ..core.request_tracer import get_tracer, SPAN_CONTEXT, SPAN_LLM_CALL, SPAN_TOOL_EXEC
```

The three new lines are: `import time`, `from datetime import datetime, timezone`, and `from ..core.request_tracer import ...`.

**Step 3.2 — Add `source` parameter to `chat()`**

Change the `chat()` method signature at line 507 from:

```python
def chat(self, message: str, skip_snapshot: bool = False, max_tokens: int | None = None) -> str:
```

To:

```python
def chat(self, message: str, skip_snapshot: bool = False, max_tokens: int | None = None, source: str = "user_chat") -> str:
```

**Step 3.3 — Instrument `chat()` entry point**

Find this block (lines 523-530):

```python
        with self._chat_lock:
            self._last_tool_calls = []  # Reset tool tracking
            get_tracker().reset()       # Reset mutation tracking for this cycle

            # Build context injection:
            # - skip_snapshot=True (daemon wake with briefing): no injection
            # - skip_snapshot=False: try briefing injection first, fall back to snapshot
            if not skip_snapshot:
```

Replace with:

```python
        with self._chat_lock:
            self._last_tool_calls = []  # Reset tool tracking
            get_tracker().reset()       # Reset mutation tracking for this cycle

            # Begin debug trace
            _trace_id: str | None = None
            try:
                _trace_id = get_tracer().begin_trace(source, message[:200])
            except Exception:
                pass

            # Build context injection:
            # - skip_snapshot=True (daemon wake with briefing): no injection
            # - skip_snapshot=False: try briefing injection first, fall back to snapshot
            if not skip_snapshot:
```

**Step 3.4 — Instrument context injection in `chat()`**

Find this block (lines 545-549):

```python
            else:
                wrapped = message
                self._last_snapshot = ""

            self._history.append({"role": "user", "content": stamp(wrapped)})
```

Replace with:

```python
            else:
                wrapped = message
                self._last_snapshot = ""

            # Record context span
            try:
                if _trace_id:
                    from ..core.trace_log import store_payload
                    _ctx_detail = {
                        "type": SPAN_CONTEXT,
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "duration_ms": 0,
                        "has_briefing": "[Briefing" in wrapped if not skip_snapshot else False,
                        "has_snapshot": "[Live State" in wrapped if not skip_snapshot else False,
                        "skip_snapshot": skip_snapshot,
                        "user_message": message[:500],
                        "wrapped_hash": store_payload(wrapped),
                    }
                    get_tracer().record_span(_trace_id, _ctx_detail)
            except Exception:
                pass

            self._history.append({"role": "user", "content": stamp(wrapped)})
```

Note: `user_message` stores the first 500 chars of the raw user message (before context injection). `wrapped_hash` stores the full wrapped message (user message + briefing/snapshot injection) via content-addressed payload. The debug page resolves `*_hash` fields to actual content.

**Step 3.5 — Instrument the LLM call loop in `chat()`**

Inside the `while True:` loop, wrap the `litellm.completion()` call. Replace the block from line 568-575:

```python
                    try:
                        response = litellm.completion(**kwargs)
                    except Exception as e:
                        logger.error("LLM API error (%s): %s", type(e).__name__, e)
                        error_msg = "I'm having trouble connecting right now. Give me a moment."
                        self._history.append({"role": "assistant", "content": error_msg})
                        self._active_context = None
                        return error_msg
```

With:

```python
                    _llm_start = time.monotonic()
                    try:
                        response = litellm.completion(**kwargs)
                    except Exception as e:
                        logger.error("LLM API error (%s): %s", type(e).__name__, e)
                        # Record failed LLM span
                        try:
                            if _trace_id:
                                get_tracer().record_span(_trace_id, {
                                    "type": SPAN_LLM_CALL,
                                    "started_at": datetime.now(timezone.utc).isoformat(),
                                    "duration_ms": int((time.monotonic() - _llm_start) * 1000),
                                    "model": self.config.agent.model,
                                    "error": f"{type(e).__name__}: {e}",
                                    "success": False,
                                })
                        except Exception:
                            pass
                        error_msg = "I'm having trouble connecting right now. Give me a moment."
                        self._history.append({"role": "assistant", "content": error_msg})
                        self._active_context = None
                        try:
                            if _trace_id:
                                get_tracer().end_trace(_trace_id, "error", error_msg, error=str(e))
                        except Exception:
                            pass
                        return error_msg
```

Note: You need `import time` at the top. Check — `agent.py` currently does NOT import `time`. Add it.

**Step 3.6 — Record successful LLM call span**

Find this block (lines 577-583):

```python
                    self._record_usage(response)
                    msg = response.choices[0].message
                    finish = response.choices[0].finish_reason

                    if finish == "tool_calls" or (msg.tool_calls and len(msg.tool_calls) > 0):
                        parsed_calls = self._parse_tool_calls(msg)
                        tool_results = self._execute_tools(parsed_calls)
```

Replace with:

```python
                    self._record_usage(response)
                    msg = response.choices[0].message
                    finish = response.choices[0].finish_reason

                    # Record LLM call span
                    try:
                        if _trace_id:
                            _usage = response.usage
                            _llm_span = {
                                "type": SPAN_LLM_CALL,
                                "started_at": datetime.now(timezone.utc).isoformat(),
                                "duration_ms": int((time.monotonic() - _llm_start) * 1000),
                                "model": self.config.agent.model,
                                "input_tokens": getattr(_usage, "prompt_tokens", 0) if _usage else 0,
                                "output_tokens": getattr(_usage, "completion_tokens", 0) if _usage else 0,
                                "stop_reason": finish,
                                "has_tool_calls": bool(msg.tool_calls),
                                "success": True,
                            }
                            # Store message payload by hash (avoids bloating trace)
                            try:
                                from ..core.trace_log import store_payload
                                _llm_span["messages_hash"] = store_payload(
                                    json.dumps(kwargs.get("messages", []), default=str)
                                )
                                if msg.content:
                                    _llm_span["response_hash"] = store_payload(msg.content)
                            except Exception:
                                pass
                            get_tracer().record_span(_trace_id, _llm_span)
                    except Exception:
                        pass

                    if finish == "tool_calls" or (msg.tool_calls and len(msg.tool_calls) > 0):
                        parsed_calls = self._parse_tool_calls(msg)
                        tool_results = self._execute_tools(parsed_calls, _trace_id=_trace_id)
```

Note: this also applies the `_trace_id=_trace_id` change from Step 3.7b to the tool execution call.

**Step 3.7 — Record tool execution spans**

In `_execute_tools()`, instrument the `_run()` inner function. Find the `_run` function (lines 380-398). The current code is:

```python
        def _run(name: str, kwargs: dict, tool_call_id: str) -> dict:
            """Execute a tool call."""
            logger.info("Tool call: %s(%s)", name, kwargs)
            try:
                result = self.tools.call(name, **kwargs)
                return {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "name": name,
                    "content": json.dumps(result) if not isinstance(result, str) else result,
                }
            except Exception as e:
                logger.error("Tool error: %s — %s", name, e)
                return {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "name": name,
                    "content": f"Error: {e}",
                }
```

Replace with:

```python
        def _run(name: str, kwargs: dict, tool_call_id: str) -> dict:
            """Execute a tool call."""
            logger.info("Tool call: %s(%s)", name, kwargs)
            _tool_start = time.monotonic()
            try:
                result = self.tools.call(name, **kwargs)
                _tool_result = {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "name": name,
                    "content": json.dumps(result) if not isinstance(result, str) else result,
                }
                # Record tool span (trace_id accessed via closure)
                try:
                    if _trace_id:
                        get_tracer().record_span(_trace_id, {
                            "type": SPAN_TOOL_EXEC,
                            "started_at": datetime.now(timezone.utc).isoformat(),
                            "duration_ms": int((time.monotonic() - _tool_start) * 1000),
                            "tool_name": name,
                            "input_args": kwargs,
                            "output_preview": _tool_result["content"][:500],
                            "success": True,
                        })
                except Exception:
                    pass
                return _tool_result
            except Exception as e:
                logger.error("Tool error: %s — %s", name, e)
                try:
                    if _trace_id:
                        get_tracer().record_span(_trace_id, {
                            "type": SPAN_TOOL_EXEC,
                            "started_at": datetime.now(timezone.utc).isoformat(),
                            "duration_ms": int((time.monotonic() - _tool_start) * 1000),
                            "tool_name": name,
                            "input_args": kwargs,
                            "error": str(e),
                            "success": False,
                        })
                except Exception:
                    pass
                return {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "name": name,
                    "content": f"Error: {e}",
                }
```

**IMPORTANT**: The `_run` inner function needs access to `_trace_id`. This variable is defined in `chat()` but `_execute_tools()` is called from `chat()`. Since `_trace_id` is a local variable in `chat()`, not an instance variable, we need to pass it.

**Step 3.7b — Add `_trace_id` parameter to `_execute_tools()`**

Change the method signature from:

```python
def _execute_tools(self, tool_calls: list[dict]) -> list[dict]:
```

To:

```python
def _execute_tools(self, tool_calls: list[dict], _trace_id: str | None = None) -> list[dict]:
```

Then update the two call sites in `chat()` where `_execute_tools` is called (there's one at line 583):

```python
tool_results = self._execute_tools(parsed_calls, _trace_id=_trace_id)
```

And the one in `chat_stream()` (there's one at line 819):

```python
tool_results = self._execute_tools(parsed_calls, _trace_id=_trace_id)
```

**Step 3.8 — Instrument `chat()` exit point**

Replace the return statement in the `else` branch (the final response path, around line 604-616):

```python
                    else:
                        text = msg.content or "(no response)"
                        text = self._strip_text_tool_calls(text)
                        self._check_text_tool_leakage(text)
                        self._history.append({"role": "assistant", "content": text})

                        # Window management: compress evicted exchanges into Nous
                        self._active_context = None
                        trimmed, did_compress = self.memory_manager.maybe_compress(self._history)
                        if did_compress:
                            self._history = trimmed
                        else:
                            self._trim_history()  # Safety net fallback
                        return text
```

With:

```python
                    else:
                        text = msg.content or "(no response)"
                        text = self._strip_text_tool_calls(text)
                        self._check_text_tool_leakage(text)
                        self._history.append({"role": "assistant", "content": text})

                        # Window management: compress evicted exchanges into Nous
                        self._active_context = None
                        trimmed, did_compress = self.memory_manager.maybe_compress(
                            self._history, _trace_id=_trace_id,
                        )
                        if did_compress:
                            self._history = trimmed
                        else:
                            self._trim_history()  # Safety net fallback

                        # End debug trace
                        try:
                            if _trace_id:
                                get_tracer().end_trace(_trace_id, "completed", text[:200])
                        except Exception:
                            pass
                        return text
```

Note: We pass `_trace_id` to `maybe_compress()` — that will be handled in Chunk 4.

**Steps 3.9–3.11 — Fully instrument `chat_stream()`**

`chat_stream()` is structurally different from `chat()` — it uses streaming chunks, a `collected_tool_calls` accumulator, and two abort checkpoints. Here are ALL the exact changes, in order of where they appear in the method.

**3.9a — Change the method signature** (line 676):

```python
# BEFORE:
def chat_stream(self, message: str, skip_snapshot: bool = False, max_tokens: int | None = None) -> Generator[tuple[str, str], None, None]:

# AFTER:
def chat_stream(self, message: str, skip_snapshot: bool = False, max_tokens: int | None = None, source: str = "user_chat") -> Generator[tuple[str, str], None, None]:
```

**3.9b — Add trace begin.** Find this block in `chat_stream()` (lines 698-705):

```python
        with self._chat_lock:
            self._last_tool_calls = []  # Reset tool tracking
            get_tracker().reset()       # Reset mutation tracking for this cycle

            # Build context injection:
            # - skip_snapshot=True (daemon wake with briefing): no injection
            # - skip_snapshot=False: try briefing injection first, fall back to snapshot
            if not skip_snapshot:
```

Replace with:

```python
        with self._chat_lock:
            self._last_tool_calls = []  # Reset tool tracking
            get_tracker().reset()       # Reset mutation tracking for this cycle

            # Begin debug trace
            _trace_id: str | None = None
            try:
                _trace_id = get_tracer().begin_trace(source, message[:200])
            except Exception:
                pass
            # Note: set_active_trace() is created in Chunk 5 Step 5.2.
            # The try/except ensures this safely no-ops until then.
            try:
                from ..core.request_tracer import set_active_trace
                set_active_trace(_trace_id)
            except Exception:
                pass

            # Build context injection:
            # - skip_snapshot=True (daemon wake with briefing): no injection
            # - skip_snapshot=False: try briefing injection first, fall back to snapshot
            if not skip_snapshot:
```

**3.9c — Add context span.** Find this block in `chat_stream()` (lines 720-724):

```python
            else:
                wrapped = message
                self._last_snapshot = ""

            self._history.append({"role": "user", "content": stamp(wrapped)})
```

Replace with:

```python
            else:
                wrapped = message
                self._last_snapshot = ""

            # Record context span
            try:
                if _trace_id:
                    from ..core.trace_log import store_payload
                    get_tracer().record_span(_trace_id, {
                        "type": SPAN_CONTEXT,
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "duration_ms": 0,
                        "has_briefing": "[Briefing" in wrapped if not skip_snapshot else False,
                        "has_snapshot": "[Live State" in wrapped if not skip_snapshot else False,
                        "skip_snapshot": skip_snapshot,
                        "user_message": message[:500],
                        "wrapped_hash": store_payload(wrapped),
                    })
            except Exception:
                pass

            self._history.append({"role": "user", "content": stamp(wrapped)})
```

**3.9d — Add `_llm_start` before the streaming LLM call.** Find this block (lines 741-745):

```python
                while True:
                    try:
                        stream_response = litellm.completion(**kwargs, stream=True)

                        collected_text = []
```

Replace with:

```python
                while True:
                    _llm_start = time.monotonic()
                    try:
                        stream_response = litellm.completion(**kwargs, stream=True)

                        collected_text = []
```

**3.9e — First abort checkpoint (line 750-755).** Replace the existing abort block:

```python
# BEFORE:
                            if self._abort.is_set():
                                self._abort.clear()
                                partial = "".join(collected_text) or ""
                                if partial:
                                    self._history.append({"role": "assistant", "content": partial})
                                return

# AFTER:
                            if self._abort.is_set():
                                self._abort.clear()
                                partial = "".join(collected_text) or ""
                                if partial:
                                    self._history.append({"role": "assistant", "content": partial})
                                try:
                                    if _trace_id:
                                        get_tracer().end_trace(_trace_id, "completed", partial[:200])
                                except Exception:
                                    pass
                                return
```

**3.9f — Record LLM span after stream consumption.** Find the end of the `for chunk in stream_response:` loop. The loop body ends at line 780 (last line of tool call accumulation), then the `except` block starts at line 782. Insert the span recording BETWEEN the end of the for loop and the except block.

Find this block (lines 779-782):

```python
                                    if tc_chunk.function and tc_chunk.function.arguments:
                                        collected_tool_calls[idx]["arguments"] += tc_chunk.function.arguments

                    except Exception as e:
```

Replace with:

```python
                                    if tc_chunk.function and tc_chunk.function.arguments:
                                        collected_tool_calls[idx]["arguments"] += tc_chunk.function.arguments

                        # End of stream — record LLM call span
                        try:
                            if _trace_id:
                                from ..core.trace_log import store_payload
                                _response_text = "".join(collected_text)
                                _llm_span = {
                                    "type": SPAN_LLM_CALL,
                                    "started_at": datetime.now(timezone.utc).isoformat(),
                                    "duration_ms": int((time.monotonic() - _llm_start) * 1000),
                                    "model": self.config.agent.model,
                                    "streamed": True,
                                    "has_tool_calls": bool(collected_tool_calls),
                                    "text_length": len(_response_text),
                                    "success": True,
                                    "messages_hash": store_payload(
                                        json.dumps(kwargs.get("messages", []), default=str)
                                    ),
                                }
                                if _response_text:
                                    _llm_span["response_hash"] = store_payload(_response_text)
                                get_tracer().record_span(_trace_id, _llm_span)
                        except Exception:
                            pass
```

**3.9g — Handle stream error with trace.** In the `except` block (line 782-788), add trace recording:

```python
# BEFORE:
                    except Exception as e:
                        logger.error("LLM API error (%s): %s", type(e).__name__, e)
                        error_msg = "I'm having trouble connecting right now. Give me a moment."
                        self._history.append({"role": "assistant", "content": error_msg})
                        self._active_context = None
                        yield ("text", error_msg)
                        return

# AFTER:
                    except Exception as e:
                        logger.error("LLM API error (%s): %s", type(e).__name__, e)
                        try:
                            if _trace_id:
                                get_tracer().record_span(_trace_id, {
                                    "type": SPAN_LLM_CALL,
                                    "started_at": datetime.now(timezone.utc).isoformat(),
                                    "duration_ms": int((time.monotonic() - _llm_start) * 1000),
                                    "model": self.config.agent.model,
                                    "error": f"{type(e).__name__}: {e}",
                                    "success": False,
                                })
                        except Exception:
                            pass
                        error_msg = "I'm having trouble connecting right now. Give me a moment."
                        self._history.append({"role": "assistant", "content": error_msg})
                        self._active_context = None
                        try:
                            if _trace_id:
                                get_tracer().end_trace(_trace_id, "error", error_msg, error=str(e))
                        except Exception:
                            pass
                        yield ("text", error_msg)
                        return
```

**3.9h — Second abort checkpoint (line 807-812).** Replace:

```python
# BEFORE:
                        if self._abort.is_set():
                            self._abort.clear()
                            partial = "".join(collected_text) or ""
                            if partial:
                                self._history.append({"role": "assistant", "content": partial})
                            return

# AFTER:
                        if self._abort.is_set():
                            self._abort.clear()
                            partial = "".join(collected_text) or ""
                            if partial:
                                self._history.append({"role": "assistant", "content": partial})
                            try:
                                if _trace_id:
                                    get_tracer().end_trace(_trace_id, "completed", partial[:200])
                            except Exception:
                                pass
                            return
```

**3.9i — Pass `_trace_id` to `_execute_tools` call** (line 819):

```python
# BEFORE:
                        tool_results = self._execute_tools(parsed_calls)

# AFTER:
                        tool_results = self._execute_tools(parsed_calls, _trace_id=_trace_id)
```

**3.9j — Instrument final response path.** The `else:` branch at the end (line 856-872). Replace:

```python
# BEFORE:
                    else:
                        full_text = "".join(collected_text) or "(no response)"
                        stripped = self._strip_text_tool_calls(full_text)
                        if stripped != full_text:
                            yield ("replace", stripped)
                            full_text = stripped
                        self._check_text_tool_leakage(full_text)
                        self._history.append({"role": "assistant", "content": full_text})

                        # Window management: compress evicted exchanges into Nous
                        self._active_context = None
                        trimmed, did_compress = self.memory_manager.maybe_compress(self._history)
                        if did_compress:
                            self._history = trimmed
                        else:
                            self._trim_history()  # Safety net fallback
                        return

# AFTER:
                    else:
                        full_text = "".join(collected_text) or "(no response)"
                        stripped = self._strip_text_tool_calls(full_text)
                        if stripped != full_text:
                            yield ("replace", stripped)
                            full_text = stripped
                        self._check_text_tool_leakage(full_text)
                        self._history.append({"role": "assistant", "content": full_text})

                        # Window management: compress evicted exchanges into Nous
                        self._active_context = None
                        trimmed, did_compress = self.memory_manager.maybe_compress(
                            self._history, _trace_id=_trace_id,
                        )
                        if did_compress:
                            self._history = trimmed
                        else:
                            self._trim_history()  # Safety net fallback

                        # End debug trace
                        try:
                            if _trace_id:
                                get_tracer().end_trace(_trace_id, "completed", full_text[:200])
                        except Exception:
                            pass
                        return
```

**3.9k — Note: `finally` blocks are modified in Chunk 5**

The `finally` blocks in both `chat()` (line 617) and `chat_stream()` (line 873) need `set_active_trace(None)` added. However, `set_active_trace()` is not created until Chunk 5 Step 5.2. These modifications are specified in **Step 5.2c** (for `chat()`) and **Step 5.2d** (for `chat_stream()`). Do NOT modify the `finally` blocks in this chunk.

### Verification — Chunk 3

1. **Syntax check**: `python -c "from hynous.intelligence.agent import Agent; print('OK')"` — must not error.
2. **Signature check**: Verify `chat()` and `chat_stream()` both have the `source` parameter with default `"user_chat"`.
3. **Trace ID flow**: Grep for `_trace_id` in `agent.py` — it should appear in: `chat()`, `chat_stream()`, passed to `_execute_tools()`, passed to `maybe_compress()`.
4. **Safety check**: Grep for `get_tracer()` in `agent.py` — every call must be inside a `try/except` block that catches `Exception` and does `pass`.
5. **No new behavior**: Without running the tracer, the agent must behave identically. The `source` parameter defaults to `"user_chat"` and `_trace_id` defaults to `None` if `begin_trace` fails.

---

## Chunk 4: Instrument `memory_manager.py`

### Overview

Add trace spans for retrieval, compression, and queue flush. Pass `_trace_id` through from the agent.

### Modifications

**Step 4.1 — Add imports**

Find this block at the top of `memory_manager.py` (lines 17-28):

```python
import json
import logging
import threading
from typing import Optional

import litellm
from litellm.exceptions import APIError as LitellmAPIError

from ..core.config import Config
from ..core.costs import record_llm_usage

logger = logging.getLogger(__name__)
```

Replace with:

```python
import json
import logging
import threading
import time
from typing import Optional

import litellm
from litellm.exceptions import APIError as LitellmAPIError

from ..core.config import Config
from ..core.costs import record_llm_usage
from ..core.request_tracer import get_tracer, SPAN_RETRIEVAL, SPAN_COMPRESSION, SPAN_QUEUE_FLUSH

logger = logging.getLogger(__name__)
```

Two new lines: `import time` and `from ..core.request_tracer import ...`.

**Step 4.2 — Instrument `retrieve_context()`**

Add a `_trace_id` parameter:

```python
def retrieve_context(self, message: str, _trace_id: str | None = None) -> Optional[str]:
```

Wrap the search call with timing and span recording. Find this block (lines 105-123):

```python
        try:
            from ..nous.client import get_client
            nous = get_client()
            results = nous.search(
                query=query,
                limit=self.config.memory.retrieve_limit,
            )
            if not results:
                return None

            # Hebbian: strengthen edges between co-retrieved memories (MF-1)
            if len(results) > 1:
                _strengthen_co_retrieved(nous, results, amount=0.03)

            return _format_context(results, self.config.memory.max_context_tokens)

        except Exception as e:
            logger.debug("Context retrieval skipped (Nous may be down): %s", e)
            return None
```

Replace with:

```python
        try:
            from ..nous.client import get_client
            nous = get_client()
            _ret_start = time.monotonic()
            results = nous.search(
                query=query,
                limit=self.config.memory.retrieve_limit,
            )
            _ret_ms = int((time.monotonic() - _ret_start) * 1000)

            # Record retrieval span
            try:
                if _trace_id:
                    from datetime import datetime, timezone
                    get_tracer().record_span(_trace_id, {
                        "type": SPAN_RETRIEVAL,
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "duration_ms": _ret_ms,
                        "query": query[:200],
                        "results_count": len(results) if results else 0,
                        "results": [
                            {
                                "title": r.get("content_title", "")[:80],
                                "body": r.get("content_body", "")[:300],
                                "score": r.get("score", 0),
                                "node_type": r.get("node_type", ""),
                                "lifecycle": r.get("lifecycle", ""),
                            }
                            for r in (results or [])[:5]
                        ],
                    })
            except Exception:
                pass

            if not results:
                return None

            # Hebbian: strengthen edges between co-retrieved memories (MF-1)
            if len(results) > 1:
                _strengthen_co_retrieved(nous, results, amount=0.03)

            return _format_context(results, self.config.memory.max_context_tokens)

        except Exception as e:
            logger.debug("Context retrieval skipped (Nous may be down): %s", e)
            return None
```

**Step 4.3 — Update `retrieve_context()` call site in `agent.py`**

In `agent.py`, update the two calls to `retrieve_context()` (one in `chat()` at line 558, one in `chat_stream()` at line 733):

```python
self._active_context = self.memory_manager.retrieve_context(search_query, _trace_id=_trace_id)
```

**Step 4.4 — Instrument `maybe_compress()`**

Add `_trace_id` parameter:

```python
def maybe_compress(self, history: list[dict], _trace_id: str | None = None) -> tuple[list[dict], bool]:
```

Find this block (lines 196-204):

```python
        # Split: evict oldest, keep most recent
        evicted_exchanges = exchanges[:-window]
        kept_exchanges = exchanges[-window:]

        # Find the cut point in the original history list.
        # The first entry of the first kept exchange tells us where to slice.
        if not kept_exchanges:
            return history, False
```

Replace with:

```python
        # Split: evict oldest, keep most recent
        evicted_exchanges = exchanges[:-window]
        kept_exchanges = exchanges[-window:]

        # Record compression span

        try:
            if _trace_id:
                from datetime import datetime, timezone
                get_tracer().record_span(_trace_id, {
                    "type": SPAN_COMPRESSION,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "duration_ms": 0,  # Compression runs in background
                    "exchanges_evicted": len(evicted_exchanges),
                    "exchanges_kept": len(kept_exchanges),
                    "window_size": window,
                    "background": True,
                })
        except Exception:
            pass

        # Find the cut point in the original history list.
        # The first entry of the first kept exchange tells us where to slice.
        if not kept_exchanges:
            return history, False
```

**Step 4.5 — Update `maybe_compress()` call site in `agent.py`**

Already done in Step 3.8 — we pass `_trace_id` there. Also do the same for the `chat_stream()` call to `maybe_compress()` (around line 867):

```python
trimmed, did_compress = self.memory_manager.maybe_compress(
    self._history, _trace_id=_trace_id,
)
```

### Verification — Chunk 4

1. **Import check**: `python -c "from hynous.intelligence.memory_manager import MemoryManager; print('OK')"`
2. **Signature check**: Verify `retrieve_context()` and `maybe_compress()` both accept `_trace_id` with default `None`.
3. **Safety check**: All `get_tracer()` calls in `memory_manager.py` are inside `try/except`.
4. **Backward compat**: All new parameters default to `None`, so existing callers don't break.

---

## Chunk 5: Instrument `tools/memory.py`

### Overview

Record MemoryOpSpan for store, recall, and update operations. Also instrument `flush_memory_queue()` with QueueFlushSpan. Uses thread-local trace context since `_store_memory_impl()` can be called from queue flush background threads.

### Modifications

**Step 5.1 — Add import at top of `tools/memory.py`**

Find this block (lines 24-30):

```python
import json
import logging
import re
import threading
from typing import Optional

logger = logging.getLogger(__name__)
```

Replace with:

```python
import json
import logging
import re
import threading
from typing import Optional

from ...core.request_tracer import get_tracer, SPAN_MEMORY_OP, SPAN_QUEUE_FLUSH

logger = logging.getLogger(__name__)
```

**Step 5.2 — Add thread-local trace context to `request_tracer.py`**

In `src/hynous/core/request_tracer.py`, add at the very end of the file (after the `get_tracer()` function):

```python
# Thread-local storage for implicit trace context.
# When a trace is active in the current thread, tools and helpers
# can record spans without explicit trace_id passing.
import threading as _threading
_thread_local = _threading.local()


def set_active_trace(trace_id: str | None) -> None:
    """Set the active trace for the current thread."""
    _thread_local.trace_id = trace_id


def get_active_trace() -> str | None:
    """Get the active trace ID for the current thread, or None."""
    return getattr(_thread_local, "trace_id", None)
```

**Step 5.2b — Set active trace in `agent.py` `chat()`**

After Step 3.3 was applied, `chat()` has this block (right after `get_tracker().reset()`):

```python
            # Begin debug trace
            _trace_id: str | None = None
            try:
                _trace_id = get_tracer().begin_trace(source, message[:200])
            except Exception:
                pass

            # Build context injection:
```

Replace with:

```python
            # Begin debug trace
            _trace_id: str | None = None
            try:
                _trace_id = get_tracer().begin_trace(source, message[:200])
            except Exception:
                pass
            try:
                from ..core.request_tracer import set_active_trace
                set_active_trace(_trace_id)
            except Exception:
                pass

            # Build context injection:
```

**Step 5.2c — Clear active trace in `chat()` `finally` block**

In `chat()`, the `finally` block at line 617-619 currently reads:

```python
            finally:
                disable_queue_mode()
                flush_memory_queue()
```

Change to:

```python
            finally:
                try:
                    from ..core.request_tracer import set_active_trace
                    set_active_trace(None)
                except Exception:
                    pass
                disable_queue_mode()
                flush_memory_queue()
```

**Step 5.2d — Do the same for `chat_stream()` `finally` block**

In `chat_stream()`, the `finally` block at line 873-875 currently reads:

```python
            finally:
                disable_queue_mode()
                flush_memory_queue()
```

Change to:

```python
            finally:
                try:
                    from ..core.request_tracer import set_active_trace
                    set_active_trace(None)
                except Exception:
                    pass
                disable_queue_mode()
                flush_memory_queue()
```

**Step 5.3 — Instrument gate filter REJECTION in `_store_memory_impl()`**

Find this exact code block in `_store_memory_impl()` (lines 391-396):

```python
        if not gate_result.passed:
            logger.info(
                "Gate filter rejected %s \"%s\": %s",
                memory_type, title[:50], gate_result.reason,
            )
            return f"Not stored: {gate_result.detail}"
```

Replace with:

```python
        if not gate_result.passed:
            logger.info(
                "Gate filter rejected %s \"%s\": %s",
                memory_type, title[:50], gate_result.reason,
            )
            # Record rejected memory op span
            try:
                from datetime import datetime, timezone
                from ...core.request_tracer import get_active_trace
                _tid = get_active_trace()
                if _tid:
                    get_tracer().record_span(_tid, {
                        "type": SPAN_MEMORY_OP,
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "duration_ms": 0,
                        "operation": "store",
                        "memory_type": memory_type,
                        "title": title[:100],
                        "gate_filter": "rejected",
                        "gate_reason": gate_result.reason,
                    })
            except Exception:
                pass
            return f"Not stored: {gate_result.detail}"
```

**Step 5.4 — Instrument dedup REJECTION in `_store_memory_impl()`**

Find this exact code block (lines 459-466):

```python
                result_msg = (
                    f"Duplicate: already stored as \"{dup_title}\" ({dup_id})"
                )
                if dup_lifecycle != "ACTIVE":
                    result_msg += f" [{dup_lifecycle}]"
                    result_msg += ". Use update_memory to reactivate if needed"
                result_msg += f". Not created. ({sim_pct}% similar)"
                return result_msg
```

Replace with:

```python
                result_msg = (
                    f"Duplicate: already stored as \"{dup_title}\" ({dup_id})"
                )
                if dup_lifecycle != "ACTIVE":
                    result_msg += f" [{dup_lifecycle}]"
                    result_msg += ". Use update_memory to reactivate if needed"
                result_msg += f". Not created. ({sim_pct}% similar)"
                # Record dedup rejection span
                try:
                    from datetime import datetime, timezone
                    from ...core.request_tracer import get_active_trace
                    _tid = get_active_trace()
                    if _tid:
                        get_tracer().record_span(_tid, {
                            "type": SPAN_MEMORY_OP,
                            "started_at": datetime.now(timezone.utc).isoformat(),
                            "duration_ms": 0,
                            "operation": "store",
                            "memory_type": memory_type,
                            "title": title[:100],
                            "dedup": "duplicate",
                            "duplicate_of": dup_title[:60],
                            "similarity": dup_sim,
                        })
                except Exception:
                    pass
                return result_msg
```

**Step 5.5 — Instrument successful STORE in `_store_memory_impl()`**

Find this exact code block (lines 549-559):

```python
        logger.info("Stored %s: \"%s\" (%s)", memory_type, title, node_id)
        result_msg = f"Stored: \"{title}\" ({node_id})"
        if cluster:
            result_msg += f" [→ cluster: {cluster}]"
        if contradiction_flag:
            logger.warning("Contradiction detected on store: %s (%s)", title, node_id)
            result_msg += (
                "\n\n⚠ Contradiction detected — this content may conflict with "
                "existing memories. Use manage_conflicts(action=\"list\") to review."
            )
        return result_msg
```

Replace with:

```python
        logger.info("Stored %s: \"%s\" (%s)", memory_type, title, node_id)
        # Record successful memory op span
        try:
            from datetime import datetime, timezone
            from ...core.request_tracer import get_active_trace
            _tid = get_active_trace()
            if _tid:
                get_tracer().record_span(_tid, {
                    "type": SPAN_MEMORY_OP,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "duration_ms": 0,
                    "operation": "store",
                    "memory_type": memory_type,
                    "title": title[:100],
                    "node_id": node_id,
                    "gate_filter": "passed" if cfg.memory.gate_filter_enabled else "disabled",
                    "contradiction": contradiction_flag,
                })
        except Exception:
            pass
        result_msg = f"Stored: \"{title}\" ({node_id})"
        if cluster:
            result_msg += f" [→ cluster: {cluster}]"
        if contradiction_flag:
            logger.warning("Contradiction detected on store: %s (%s)", title, node_id)
            result_msg += (
                "\n\n⚠ Contradiction detected — this content may conflict with "
                "existing memories. Use manage_conflicts(action=\"list\") to review."
            )
        return result_msg
```

**Step 5.6 — Instrument `handle_recall_memory()` search path**

Find this exact code block in the search mode `else` branch (lines 764-766):

```python
            header = f"Found {len(results)} memories:\n"
            return _format_memory_results(results, header)
```

Replace with:

```python
            header = f"Found {len(results)} memories:\n"
            result_text = _format_memory_results(results, header)
            # Record recall span
            try:
                from datetime import datetime, timezone
                from ...core.request_tracer import get_active_trace
                _tid = get_active_trace()
                if _tid:
                    get_tracer().record_span(_tid, {
                        "type": SPAN_MEMORY_OP,
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "duration_ms": 0,
                        "operation": "recall",
                        "mode": mode,
                        "query": query[:200] if query else None,
                        "results_count": len(results),
                    })
            except Exception:
                pass
            return result_text
```

**Also instrument the browse path.** Find this line in the browse mode `if mode == "browse":` branch (line 730):

```python
            return _format_memory_results(results, header)
```

Replace with:

```python
            result_text = _format_memory_results(results, header)
            # Record recall span (browse)
            try:
                from datetime import datetime, timezone
                from ...core.request_tracer import get_active_trace
                _tid = get_active_trace()
                if _tid:
                    get_tracer().record_span(_tid, {
                        "type": SPAN_MEMORY_OP,
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "duration_ms": 0,
                        "operation": "recall",
                        "mode": "browse",
                        "memory_type": memory_type,
                        "results_count": len(results),
                    })
            except Exception:
                pass
            return result_text
```

**Step 5.7 — Instrument `flush_memory_queue()`**

Find this exact code block (lines 66-69):

```python
    if not items:
        return 0

    count = len(items)
```

Replace with:

```python
    if not items:
        return 0

    count = len(items)

    # Record queue flush span (before background thread starts)
    try:
        from datetime import datetime, timezone
        from ...core.request_tracer import get_active_trace
        _tid = get_active_trace()
        if _tid:
            get_tracer().record_span(_tid, {
                "type": SPAN_QUEUE_FLUSH,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "duration_ms": 0,
                "items_count": count,
                "items": [
                    {"title": k.get("title", "")[:60], "type": k.get("memory_type", "")}
                    for k in items[:10]
                ],
            })
    except Exception:
        pass
```

### Verification — Chunk 5

1. **Import check**: `python -c "from hynous.intelligence.tools.memory import handle_store_memory; print('OK')"`
2. **Safety check**: Every `get_tracer()` and `get_active_trace()` call in `tools/memory.py` is inside `try/except`.
3. **No behavior change**: `_store_memory_impl()` returns the same strings in the same order. The spans are purely additive — inserted BEFORE existing return statements.
4. **Thread-local works**: `set_active_trace(_trace_id)` is called in `chat()` after `begin_trace`, cleared in `finally` before `disable_queue_mode()`. Queue flush runs AFTER `set_active_trace(None)`, so queued stores (background thread) will correctly have `_tid = None` and skip span recording — this is intended since those stores happen after the trace is ended.

---

## Chunk 6: Tag Daemon Wake Source

### Overview

The daemon currently calls `self.agent.chat(message, skip_snapshot=...)` with no source indication. We add `source=` to each wake type so traces show "daemon:review", "daemon:watchpoint", etc.

### Modifications in `daemon.py`

**Step 6.1 — In `_wake_agent()`, add `source` parameter**

Change the signature (line 1961) from:

```python
def _wake_agent(
    self, message: str, priority: bool = False,
    max_coach_cycles: int = 0,
    max_tokens: int | None = None,
) -> str | None:
```

To:

```python
def _wake_agent(
    self, message: str, priority: bool = False,
    max_coach_cycles: int = 0,
    max_tokens: int | None = None,
    source: str = "daemon:unknown",
) -> str | None:
```

**Step 6.2 — Pass source to `agent.chat()`**

In `_wake_agent()`, the `agent.chat()` call (line 2088):

```python
response = self.agent.chat(
    full_message, skip_snapshot=bool(briefing_text),
    max_tokens=max_tokens,
)
```

Change to:

```python
response = self.agent.chat(
    full_message, skip_snapshot=bool(briefing_text),
    max_tokens=max_tokens,
    source=source,
)
```

**Step 6.3 — Tag each `_wake_for_*` method**

There are exactly 9 `_wake_agent()` call sites in `daemon.py`. Here is the exact before→after for each one. Only the `source=` kwarg is added — do NOT change any other arguments.

**6.3a — `_wake_for_profit()` (line 1227):**

```python
# BEFORE:
        response = self._wake_agent(message, priority=priority, max_coach_cycles=0, max_tokens=1024)

# AFTER:
        response = self._wake_agent(message, priority=priority, max_coach_cycles=0, max_tokens=1024, source="daemon:profit")
```

**6.3b — `_wake_for_watchpoint()` (line 1341):**

```python
# BEFORE:
        response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1024)

# AFTER:
        response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1024, source="daemon:watchpoint")
```

**6.3c — `_wake_for_scanner()` (line 1376):**

```python
# BEFORE:
        response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1024)

# AFTER:
        response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1024, source="daemon:scanner")
```

**6.3d — `_wake_for_fill()` (line 1463):**

```python
# BEFORE:
        response = self._wake_agent(message, priority=True, max_coach_cycles=0, max_tokens=fill_tokens)

# AFTER:
        response = self._wake_agent(message, priority=True, max_coach_cycles=0, max_tokens=fill_tokens, source="daemon:fill")
```

**6.3e — `_wake_for_review()` — learning path (line 1523):**

```python
# BEFORE:
            response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1536)

# AFTER:
            response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1536, source="daemon:review")
```

**6.3f — `_wake_for_review()` — normal review path (line 1525):**

```python
# BEFORE:
            response = self._wake_agent(message, max_coach_cycles=1, max_tokens=512)

# AFTER:
            response = self._wake_agent(message, max_coach_cycles=1, max_tokens=512, source="daemon:review")
```

**6.3g — `_wake_for_conflicts()` (line 1787):**

```python
# BEFORE:
        response = self._wake_agent(message, max_tokens=1024)

# AFTER:
        response = self._wake_agent(message, max_tokens=1024, source="daemon:conflict")
```

**6.3h — `_check_curiosity()` / learning session (line 1931):**

```python
# BEFORE:
            response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1536)

# AFTER:
            response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1536, source="daemon:learning")
```

**6.3i — `_manual_wake()` (line 2157):**

```python
# BEFORE:
        response = self._wake_agent(message, priority=True, max_coach_cycles=1, max_tokens=1024)

# AFTER:
        response = self._wake_agent(message, priority=True, max_coach_cycles=1, max_tokens=1024, source="daemon:manual")
```

**That's all 9 call sites.** Verify with: `grep -c "_wake_agent(" src/hynous/intelligence/daemon.py` — should output `10` (9 calls + 1 `def _wake_agent`).

### Verification — Chunk 6

1. **Import check**: `python -c "from hynous.intelligence.daemon import Daemon; print('OK')"`
2. **Grep check**: `grep "_wake_agent" daemon.py` — every call should have `source=` argument.
3. **No behavior change**: Default `source="daemon:unknown"` means any untouched call sites still work.

---

## Chunk 7: Dashboard State

### Overview

Add debug-related state variables and methods to `AppState` in `state.py`.

### Modifications in `dashboard/dashboard/state.py`

**Step 7.1 — Add state variables to `AppState`**

Find the `# === Navigation ===` section (around line 428). BEFORE it, add:

```python
    # === Debug State ===
    debug_traces: list[dict] = []
    debug_selected_trace_id: str = ""
    debug_selected_trace: dict = {}
    debug_filter_source: str = ""
    debug_filter_status: str = ""
    debug_selected_span_id: str = ""  # ID of currently expanded span (empty = none)
```

**Step 7.2 — Add navigation method**

After the existing `go_to_journal()` method (around line 2292), add:

```python
    def go_to_debug(self):
        """Navigate to the debug page."""
        self.current_page = "debug"
        return AppState.load_debug_traces
```

**Step 7.3 — Add debug methods**

After `go_to_debug()`, add:

```python
    def load_debug_traces(self):
        """Load recent traces for the debug sidebar."""
        try:
            from hynous.core.request_tracer import get_tracer
            tracer = get_tracer()
            self.debug_traces = tracer.get_recent_traces(limit=50)
        except Exception as e:
            logger.error("Failed to load debug traces: %s", e)
            self.debug_traces = []

    def select_debug_trace(self, trace_id: str):
        """Select a trace to view in detail."""
        self.debug_selected_trace_id = trace_id
        self.debug_selected_span_id = ""
        try:
            from hynous.core.request_tracer import get_tracer
            trace = get_tracer().get_trace(trace_id)
            if trace:
                self.debug_selected_trace = trace
            else:
                self.debug_selected_trace = {}
        except Exception as e:
            logger.error("Failed to load trace %s: %s", trace_id, e)
            self.debug_selected_trace = {}

    def toggle_debug_span(self, span_id: str):
        """Toggle expansion of a span in the trace detail view.

        Only one span can be expanded at a time. Click same span to collapse.
        Uses string ID (e.g. "span-0") instead of index because rx.foreach
        does not provide indices.
        """
        if self.debug_selected_span_id == span_id:
            self.debug_selected_span_id = ""
        else:
            self.debug_selected_span_id = span_id

    def set_debug_filter_source(self, value: str):
        """Set the source filter for debug traces."""
        self.debug_filter_source = value
        return AppState.load_debug_traces

    def set_debug_filter_status(self, value: str):
        """Set the status filter for debug traces."""
        self.debug_filter_status = value
        return AppState.load_debug_traces

    def refresh_debug_traces(self):
        """Refresh the trace list (called by manual refresh or polling)."""
        return AppState.load_debug_traces

    def load_debug_payload(self, payload_hash: str) -> str:
        """Load a content-addressed payload for display."""
        try:
            from hynous.core.trace_log import load_payload
            content = load_payload(payload_hash)
            return content or "(payload not found)"
        except Exception:
            return "(error loading payload)"

    @rx.var(cache=False)
    def debug_spans_display(self) -> list[dict]:
        """Prepare spans for display with pre-computed fields.

        This computed var is CRITICAL for Reflex compatibility:
        - rx.foreach only accepts single-argument lambdas (no index)
        - Python dict lookups like _SPAN_CONFIG.get(span_type) don't work
          on reactive rx.Var values at component build time
        - We solve both by pre-processing spans server-side here,
          then sending flat dicts the UI can render with simple field access

        IMPORTANT: This method also resolves all *_hash payload references
        to their actual content. Spans store large content (LLM messages,
        responses, injected context) via content-addressed hashes on disk.
        Here we load those payloads so the UI shows actual text, not hashes.

        Each span dict gets extra keys:
        - "span_id": unique identifier ("span-0", "span-1", ...) for expand/collapse
        - "label": display label ("LLM Call", "Tool", etc.)
        - "color": hex color for the badge/border
        - "summary": one-line description
        - "detail_json": formatted JSON string for expanded view (with resolved content)
        - "is_error": bool for error indicator
        """
        import json as _json
        spans = self.debug_selected_trace.get("spans", [])
        result = []

        # Lazy-load payload resolver (only import if we have spans)
        _load_payload = None
        if spans:
            try:
                from hynous.core.trace_log import load_payload
                _load_payload = load_payload
            except Exception:
                pass

        for i, span in enumerate(spans):
            span_type = span.get("type", "unknown")

            # Map span type → label + color
            label_map = {
                "context": ("Context", "#818cf8"),
                "retrieval": ("Retrieval", "#34d399"),
                "llm_call": ("LLM Call", "#f59e0b"),
                "tool_execution": ("Tool", "#60a5fa"),
                "memory_op": ("Memory", "#a78bfa"),
                "compression": ("Compress", "#fb923c"),
                "queue_flush": ("Queue", "#94a3b8"),
            }
            label, color = label_map.get(span_type, (span_type, "#525252"))

            # Build summary based on span type
            if span_type == "llm_call":
                tokens = span.get("input_tokens", 0) + span.get("output_tokens", 0)
                model = span.get("model", "?")
                if tokens:
                    summary = f"{model} — {tokens} tok"
                else:
                    summary = f"{model} — streamed"
            elif span_type == "tool_execution":
                summary = span.get("tool_name", "")
            elif span_type == "retrieval":
                q = span.get("query", "")
                n = span.get("results_count", 0)
                summary = f'"{q[:50]}" → {n} results' if q else ""
            elif span_type == "memory_op":
                summary = f"{span.get('operation', '')}: {span.get('title', '')}"
            elif span_type == "context":
                parts = []
                if span.get("has_briefing"):
                    parts.append("briefing")
                if span.get("has_snapshot"):
                    parts.append("snapshot")
                summary = "Injected: " + ", ".join(parts) if parts else "Context injection"
            elif span_type == "compression":
                summary = f"{span.get('exchanges_evicted', 0)} exchanges evicted"
            elif span_type == "queue_flush":
                summary = f"{span.get('items_count', 0)} items"
            else:
                summary = ""

            # ---- Resolve payload hashes to actual content ----
            # Spans store large content via SHA256 hashes (content-addressed).
            # We resolve them here so the UI shows real text, not hash strings.
            resolved = dict(span)
            if _load_payload:
                for key in list(resolved.keys()):
                    if key.endswith("_hash"):
                        try:
                            content = _load_payload(resolved[key])
                            if content is not None:
                                # Replace hash with content. Use _content suffix.
                                content_key = key.replace("_hash", "_content")
                                # Try to parse JSON payloads so they nest properly
                                try:
                                    resolved[content_key] = _json.loads(content)
                                except (ValueError, TypeError):
                                    resolved[content_key] = content
                                del resolved[key]  # Remove the hash key
                        except Exception:
                            pass  # Keep the hash if loading fails

            # JSON detail for expanded view (now with resolved content)
            try:
                detail = _json.dumps(resolved, indent=2, default=str)
            except Exception:
                detail = str(resolved)

            result.append({
                "span_id": f"span-{i}",
                "type": span_type,
                "label": label,
                "color": color,
                "summary": summary,
                "duration_ms": span.get("duration_ms", 0),
                "is_error": span.get("success") is False or "error" in span,
                "detail_json": detail,
            })
        return result
```

### Verification — Chunk 7

1. **Import check**: `cd dashboard && python -c "from dashboard.state import AppState; print('OK')"`
2. **State vars exist**: Verify `debug_traces`, `debug_selected_trace_id`, `debug_selected_trace`, `debug_filter_source`, `debug_filter_status`, `debug_selected_span_id` are all defined with defaults.
3. **Methods exist**: Verify `go_to_debug`, `load_debug_traces`, `select_debug_trace`, `toggle_debug_span`, `refresh_debug_traces`, `debug_spans_display` all exist.
4. **Computed var**: `debug_spans_display` should return `list[dict]` and include `span_id`, `label`, `color`, `summary`, `detail_json`, `is_error` fields.

---

## Chunk 8: Debug Page UI

### Create: `dashboard/dashboard/pages/debug.py`

This is the main debug page. Follow the `memory.py` pattern: sidebar (left) + main area (right).

**IMPORTANT Reflex 0.8.26 constraints this code respects:**
- `rx.foreach` only accepts **single-argument** lambdas: `lambda item: func(item)`. NO index parameter.
- `rx.match` IS supported for multi-branch value mapping (used in `home.py`, `chat.py`, `ticker.py`).
- Python dict lookups like `_SPAN_CONFIG.get(span_type)` do NOT work on reactive `rx.Var` — use `rx.match` instead.
- For expand/collapse, we use a `debug_selected_span_id` string in state (click toggles it) instead of index-based tracking, avoiding the need for `rx.foreach` with index.

**Step 8.0 — State vars prerequisite**

All required state vars and methods are already defined in Chunk 7:
- `debug_selected_span_id: str` — for expand/collapse
- `toggle_debug_span(span_id: str)` — toggles expansion
- `debug_spans_display` — computed var that pre-processes spans for the UI

No amendments needed. Proceed to creating the debug page file:

```python
"""Debug dashboard — full pipeline transparency for agent.chat() calls."""

import reflex as rx
from ..state import AppState


# ---- Sidebar Components ----

def _trace_item(trace: dict) -> rx.Component:
    """Single trace row in the sidebar. Single-arg lambda for rx.foreach."""
    return rx.box(
        rx.vstack(
            rx.hstack(
                # Source badge
                rx.text(
                    trace["source"],
                    font_size="0.65rem",
                    font_weight="500",
                    color="#a5b4fc",
                    background="#1e1b4b",
                    padding="1px 6px",
                    border_radius="4px",
                    white_space="nowrap",
                    overflow="hidden",
                    text_overflow="ellipsis",
                    max_width="120px",
                ),
                rx.spacer(),
                # Status dot — use rx.match (confirmed working in Reflex 0.8.26)
                rx.box(
                    width="6px",
                    height="6px",
                    border_radius="50%",
                    background=rx.match(
                        trace["status"],
                        ("completed", "#22c55e"),
                        ("error", "#ef4444"),
                        ("in_progress", "#f59e0b"),
                        "#525252",
                    ),
                    flex_shrink="0",
                ),
                # Duration
                rx.text(
                    rx.cond(
                        trace["total_duration_ms"] > 1000,
                        (trace["total_duration_ms"] / 1000).to(str) + "s",
                        trace["total_duration_ms"].to(str) + "ms",
                    ),
                    font_size="0.65rem",
                    color="#525252",
                    font_family="JetBrains Mono, monospace",
                ),
                spacing="2",
                align="center",
                width="100%",
            ),
            # Input summary
            rx.text(
                trace["input_summary"],
                font_size="0.72rem",
                color="#a3a3a3",
                overflow="hidden",
                text_overflow="ellipsis",
                white_space="nowrap",
                width="100%",
            ),
            # Timestamp + span count
            rx.hstack(
                rx.text(
                    trace["started_at"][:19].replace("T", " "),
                    font_size="0.6rem",
                    color="#404040",
                    font_family="JetBrains Mono, monospace",
                ),
                rx.spacer(),
                rx.text(
                    trace["span_count"].to(str) + " spans",
                    font_size="0.6rem",
                    color="#404040",
                ),
                width="100%",
            ),
            spacing="1",
            width="100%",
        ),
        padding="8px 10px",
        border_radius="6px",
        cursor="pointer",
        background=rx.cond(
            AppState.debug_selected_trace_id == trace["trace_id"],
            "#1a1a1a",
            "transparent",
        ),
        border=rx.cond(
            AppState.debug_selected_trace_id == trace["trace_id"],
            "1px solid #2a2a2a",
            "1px solid transparent",
        ),
        _hover={"background": "#141414"},
        on_click=AppState.select_debug_trace(trace["trace_id"]),
        width="100%",
    )


def _sidebar() -> rx.Component:
    """Trace list sidebar."""
    return rx.vstack(
        # Header
        rx.hstack(
            rx.icon("bug", size=14, color="#6366f1"),
            rx.text(
                "TRACES",
                font_size="0.7rem",
                font_weight="600",
                color="#737373",
                text_transform="uppercase",
                letter_spacing="0.05em",
            ),
            rx.spacer(),
            rx.button(
                rx.icon("refresh-cw", size=12),
                on_click=AppState.refresh_debug_traces,
                background="transparent",
                color="#525252",
                border="none",
                cursor="pointer",
                padding="4px",
                min_width="auto",
                height="auto",
                _hover={"color": "#fafafa"},
            ),
            spacing="2",
            align="center",
            width="100%",
            padding_bottom="8px",
            border_bottom="1px solid #1a1a1a",
        ),

        # Trace list
        rx.cond(
            AppState.debug_traces.length() > 0,
            rx.box(
                rx.foreach(AppState.debug_traces, _trace_item),
                width="100%",
                overflow_y="auto",
                flex="1",
                sx={
                    "&::-webkit-scrollbar": {"width": "4px"},
                    "&::-webkit-scrollbar-track": {"background": "transparent"},
                    "&::-webkit-scrollbar-thumb": {
                        "background": "#2a2a2a",
                        "border_radius": "2px",
                    },
                },
            ),
            rx.center(
                rx.text("No traces yet", font_size="0.75rem", color="#404040"),
                padding="2rem",
                width="100%",
            ),
        ),

        spacing="2",
        width="280px",
        min_width="280px",
        height="100%",
        padding="12px",
        border_right="1px solid #1a1a1a",
        overflow="hidden",
    )


# ---- Span Detail Components ----

def _span_row(span: dict) -> rx.Component:
    """Single span row in the timeline. Single-arg lambda for rx.foreach.

    The span dict is pre-processed by debug_spans_display computed var,
    so it has: span_id, label, color, summary, duration_ms, is_error, detail_json.
    """
    is_expanded = AppState.debug_selected_span_id == span["span_id"]

    return rx.box(
        rx.vstack(
            # Collapsed row — always visible
            rx.hstack(
                rx.icon(
                    rx.cond(is_expanded, "chevron-down", "chevron-right"),
                    size=12, color="#525252",
                ),
                # Span type badge
                rx.text(
                    span["label"],
                    font_size="0.6rem",
                    font_weight="600",
                    color=span["color"],
                    padding="1px 6px",
                    border_radius="3px",
                    text_transform="uppercase",
                    letter_spacing="0.03em",
                    white_space="nowrap",
                ),
                # Summary text
                rx.text(
                    span["summary"],
                    font_size="0.72rem",
                    color="#a3a3a3",
                    overflow="hidden",
                    text_overflow="ellipsis",
                    white_space="nowrap",
                    flex="1",
                ),
                rx.spacer(),
                # Duration
                rx.text(
                    span["duration_ms"].to(str) + "ms",
                    font_size="0.65rem",
                    color="#525252",
                    font_family="JetBrains Mono, monospace",
                ),
                # Error indicator
                rx.cond(
                    span["is_error"],
                    rx.box(
                        width="6px", height="6px", border_radius="50%",
                        background="#ef4444", flex_shrink="0",
                    ),
                    rx.fragment(),
                ),
                spacing="2",
                align="center",
                width="100%",
            ),

            # Expanded detail — shown when this span is selected
            rx.cond(
                is_expanded,
                rx.box(
                    rx.code_block(
                        span["detail_json"],
                        language="json",
                        theme="dark",
                        width="100%",
                    ),
                    padding="8px 0 0 24px",
                    width="100%",
                ),
                rx.fragment(),
            ),

            spacing="1",
            width="100%",
        ),
        padding="6px 8px",
        border_radius="4px",
        cursor="pointer",
        _hover={"background": "#141414"},
        on_click=AppState.toggle_debug_span(span["span_id"]),
        width="100%",
        border_left="2px solid " + span["color"],
        margin_left="8px",
    )


def _trace_detail() -> rx.Component:
    """Main area: selected trace detail view."""
    trace = AppState.debug_selected_trace

    return rx.cond(
        AppState.debug_selected_trace_id != "",
        rx.vstack(
            # Header
            rx.vstack(
                rx.hstack(
                    rx.text(
                        "Trace: " + trace["trace_id"].to(str)[:8] + "...",
                        font_size="0.85rem",
                        font_weight="600",
                        color="#fafafa",
                        font_family="JetBrains Mono, monospace",
                    ),
                    rx.spacer(),
                    rx.text(
                        trace.get("status", ""),
                        font_size="0.7rem",
                        font_weight="500",
                        color=rx.match(
                            trace.get("status", ""),
                            ("completed", "#22c55e"),
                            ("error", "#ef4444"),
                            ("in_progress", "#f59e0b"),
                            "#525252",
                        ),
                        text_transform="uppercase",
                    ),
                    width="100%",
                    align="center",
                ),
                rx.hstack(
                    rx.text("Source: ", font_size="0.7rem", color="#525252"),
                    rx.text(trace.get("source", ""), font_size="0.7rem", color="#a5b4fc"),
                    rx.text(" | Duration: ", font_size="0.7rem", color="#525252"),
                    rx.text(
                        trace.get("total_duration_ms", 0).to(str) + "ms",
                        font_size="0.7rem", color="#fafafa",
                        font_family="JetBrains Mono, monospace",
                    ),
                    spacing="1",
                    align="center",
                ),
                rx.text(
                    trace.get("input_summary", ""),
                    font_size="0.75rem",
                    color="#a3a3a3",
                    padding_top="4px",
                ),
                spacing="1",
                width="100%",
                padding="12px 16px",
                background="#141414",
                border_radius="8px",
                border="1px solid #1a1a1a",
            ),

            # Error panel (if error)
            rx.cond(
                trace.get("error", "") != "",
                rx.box(
                    rx.hstack(
                        rx.icon("alert-triangle", size=14, color="#ef4444"),
                        rx.text("Error", font_size="0.75rem", font_weight="600", color="#ef4444"),
                        spacing="2",
                        align="center",
                    ),
                    rx.text(
                        trace.get("error", ""),
                        font_size="0.72rem",
                        color="#fca5a5",
                        font_family="JetBrains Mono, monospace",
                        white_space="pre-wrap",
                        padding_top="4px",
                    ),
                    padding="10px 14px",
                    background="#1c0a0a",
                    border="1px solid #3b1111",
                    border_radius="6px",
                    width="100%",
                ),
                rx.fragment(),
            ),

            # Timeline — uses debug_spans_display (pre-processed in state)
            rx.vstack(
                rx.text(
                    "TIMELINE",
                    font_size="0.65rem",
                    font_weight="600",
                    color="#525252",
                    text_transform="uppercase",
                    letter_spacing="0.05em",
                    padding_bottom="4px",
                ),
                rx.foreach(
                    AppState.debug_spans_display,
                    _span_row,
                ),
                spacing="1",
                width="100%",
            ),

            # Output summary
            rx.cond(
                trace.get("output_summary", "") != "",
                rx.box(
                    rx.text(
                        "OUTPUT",
                        font_size="0.65rem",
                        font_weight="600",
                        color="#525252",
                        text_transform="uppercase",
                        letter_spacing="0.05em",
                    ),
                    rx.text(
                        trace.get("output_summary", ""),
                        font_size="0.75rem",
                        color="#a3a3a3",
                        padding_top="4px",
                    ),
                    padding="12px 16px",
                    background="#141414",
                    border_radius="8px",
                    border="1px solid #1a1a1a",
                    width="100%",
                ),
                rx.fragment(),
            ),

            spacing="3",
            width="100%",
            padding="16px",
            overflow_y="auto",
            flex="1",
            sx={
                "&::-webkit-scrollbar": {"width": "4px"},
                "&::-webkit-scrollbar-track": {"background": "transparent"},
                "&::-webkit-scrollbar-thumb": {
                    "background": "#2a2a2a",
                    "border_radius": "2px",
                },
            },
        ),
        # Empty state
        rx.center(
            rx.vstack(
                rx.icon("terminal", size=32, color="#2a2a2a"),
                rx.text(
                    "Select a trace to inspect",
                    font_size="0.85rem",
                    color="#404040",
                ),
                spacing="3",
                align="center",
            ),
            width="100%",
            height="100%",
        ),
    )


# ---- Main Page ----

def debug_page() -> rx.Component:
    """Debug dashboard page — trace list + detail view."""
    return rx.hstack(
        _sidebar(),
        _trace_detail(),
        spacing="0",
        width="100%",
        height="100%",
        background="#0a0a0a",
    )
```

### Verification — Chunk 8

1. **Import check**: `cd dashboard && python -c "from dashboard.pages.debug import debug_page; print('OK')"`
2. **Component structure**: The page returns an `rx.hstack` with `_sidebar()` (280px, left) and `_trace_detail()` (flex, right).
3. **No state errors**: All `AppState.*` references match variables defined in Chunk 7 (amended).
4. **rx.foreach single-arg**: Both `rx.foreach` calls use single-argument lambdas — `_trace_item` receives one `trace` dict, `_span_row` receives one pre-processed `span` dict.
5. **No Python dict lookups on rx.Var**: Span type → color/label mapping is done server-side in `debug_spans_display` computed var, not client-side in the component.

---

## Chunk 9: Wire Routing + Nav

### Step 9.1 — Update `pages/__init__.py`

Add the debug page export:

```python
from .debug import debug_page
```

And add to `__all__`:

```python
__all__ = ["home_page", "chat_page", "graph_page", "journal_page", "memory_page", "login_page", "debug_page"]
```

### Step 9.2 — Update `dashboard.py` imports

At line 14, change:

```python
from .pages import home_page, chat_page, graph_page, journal_page, memory_page, login_page
```

To:

```python
from .pages import home_page, chat_page, graph_page, journal_page, memory_page, login_page, debug_page
```

### Step 9.3 — Update page routing in `dashboard.py`

In `_dashboard_content()`, the page content box (lines 167-179) currently has:

```python
rx.cond(
    AppState.current_page == "home",
    home_page(),
    rx.cond(
        AppState.current_page == "chat",
        chat_page(),
        rx.cond(
            AppState.current_page == "journal",
            journal_page(),
            memory_page(),
        ),
    ),
),
```

Change to:

```python
rx.cond(
    AppState.current_page == "home",
    home_page(),
    rx.cond(
        AppState.current_page == "chat",
        chat_page(),
        rx.cond(
            AppState.current_page == "journal",
            journal_page(),
            rx.cond(
                AppState.current_page == "debug",
                debug_page(),
                memory_page(),
            ),
        ),
    ),
),
```

### Step 9.4 — Update `nav.py`

**Change `navbar()` signature** (line 54) from:

```python
def navbar(current_page: rx.Var[str], on_home: callable, on_chat: callable, on_journal: callable, on_memory: callable, on_logout: callable = None) -> rx.Component:
```

To:

```python
def navbar(current_page: rx.Var[str], on_home: callable, on_chat: callable, on_journal: callable, on_memory: callable, on_debug: callable = None, on_logout: callable = None) -> rx.Component:
```

**Add "Debug" nav item** in the center section. After the Memory nav_item (line 87):

```python
nav_item("Memory", current_page == "memory", on_memory, has_unread=AppState.memory_unread),
```

Add:

```python
nav_item("Debug", current_page == "debug", on_debug),
```

### Step 9.5 — Update `navbar()` call in `dashboard.py`

In `_dashboard_content()`, the navbar call (lines 147-154):

```python
navbar(
    current_page=AppState.current_page,
    on_home=AppState.go_to_home,
    on_chat=AppState.go_to_chat,
    on_journal=AppState.go_to_journal,
    on_memory=AppState.go_to_memory,
    on_logout=AppState.logout,
),
```

Add the `on_debug` parameter:

```python
navbar(
    current_page=AppState.current_page,
    on_home=AppState.go_to_home,
    on_chat=AppState.go_to_chat,
    on_journal=AppState.go_to_journal,
    on_memory=AppState.go_to_memory,
    on_debug=AppState.go_to_debug,
    on_logout=AppState.logout,
),
```

### Verification — Chunk 9

1. **Full import chain**: `cd dashboard && python -c "from dashboard.dashboard import app; print('OK')"`
2. **Routing**: The nested `rx.cond` chain is: home → chat → journal → debug → memory (memory is the fallback/else).
3. **Nav item count**: The navbar center section should now have 5 items: Home, Chat, Journal, Memory, Debug.
4. **Navigation works**: `AppState.go_to_debug` sets `current_page = "debug"` and triggers `load_debug_traces`.

---

## Chunk 10: Live View + Polish

### Step 10.1 — Auto-refresh on page entry

Already handled in Step 7.2: `go_to_debug()` returns `AppState.load_debug_traces` which loads traces on page entry.

### Step 10.2 — Auto-refresh via existing poller

Hook into the existing `poll_portfolio` background task (runs every 15s via `_POLL_INTERVAL`). This avoids creating a separate background loop. The user can always click the manual refresh button for immediate updates.

**File**: `dashboard/dashboard/state.py`

**Exact insertion point**: Inside `poll_portfolio()`, after the `_cluster_tick` block ends (the `except Exception: pass` at line 832-833), and BEFORE `await asyncio.sleep(_POLL_INTERVAL)` at line 835.

BEFORE (lines 832-835):
```python
                except Exception:
                    pass

            await asyncio.sleep(_POLL_INTERVAL)
```

AFTER:
```python
                except Exception:
                    pass

            # Refresh debug traces when on debug page
            try:
                async with self:
                    if self.current_page == "debug":
                        self.load_debug_traces()
                        # Also refresh selected trace if viewing one (live span updates)
                        if self.debug_selected_trace_id:
                            from hynous.core.request_tracer import get_tracer
                            trace = get_tracer().get_trace(self.debug_selected_trace_id)
                            if trace:
                                self.debug_selected_trace = trace
            except Exception:
                pass

            await asyncio.sleep(_POLL_INTERVAL)
```

**Why this pattern**: This matches how `poll_portfolio` already handles cluster data (the `_cluster_tick` block). The `async with self:` state lock is acquired for a short burst to update state vars. The `load_debug_traces()` call is a simple `get_recent_traces(limit=50)` which reads from the in-memory tracer — no disk I/O, sub-millisecond. The selected trace refresh enables live-following an in-progress trace (new spans appear as they're recorded).

### Step 10.3 — JSON display in span detail

The `debug_spans_display` computed var in Chunk 7 already includes `detail_json` — a formatted JSON string for each span (via `json.dumps(span, indent=2, default=str)`). The `_span_row` component in Chunk 8 already renders this in an `rx.code_block` when the span is expanded:

```python
rx.code_block(
    span["detail_json"],
    language="json",
    ...
)
```

No additional work needed. The formatted JSON display is already wired end-to-end.

### Step 10.4 — Manual refresh button

Already handled in Chunk 8's `_sidebar()` component:

```python
rx.icon(
    "refresh-cw", size=14, color="#525252",
    cursor="pointer",
    _hover={"color": "#fafafa"},
    on_click=AppState.refresh_debug_traces,
),
```

This calls `refresh_debug_traces()` from Chunk 7 which delegates to `load_debug_traces()`.

### Step 10.5 — Error highlighting

Already handled in the `debug_spans_display` computed var (Chunk 7) and `_span_row` component (Chunk 8):

- `debug_spans_display` sets `is_error: True` when `span.get("success") is False or "error" in span`
- `_span_row` applies error styling when `span["is_error"]` is true:
  - Left border turns `#ef4444` (red)
  - Background shifts to `#1a0a0a` (dark red tint)
- The trace-level error panel in `_trace_detail()` shows when `trace.get("error", "") != ""`:
  - Red-bordered box at the top with the full error message

### Step 10.6 — Duration bars

Already handled in `_span_row` (Chunk 8). Each span row shows its `duration_ms` value:

```python
rx.text(
    span["duration_ms"].to(str) + "ms",
    font_size="0.65rem",
    color="#525252",
    font_family="JetBrains Mono, monospace",
),
```

To add proportional duration bars (optional enhancement), you would add a computed var that calculates each span's percentage of total trace duration and renders a colored `rx.box` width accordingly. This is deferred — the numeric display is sufficient for Phase 1.

### Step 10.7 — `.gitignore` entry

The `storage/` directory is already in `.gitignore` (confirmed in pre-read). The new `storage/traces.json` and `storage/payloads/` will be automatically excluded. No changes needed.

### Step 10.8 — Export trace as JSON (optional)

To add a "Download JSON" button to the trace detail header, add this to the header `rx.hstack` in `_trace_detail()`:

```python
rx.link(
    rx.icon("download", size=14, color="#525252", _hover={"color": "#fafafa"}),
    href=rx.cond(
        AppState.debug_selected_trace_id != "",
        "data:application/json;charset=utf-8," + AppState.debug_selected_trace.to(str),
        "#",
    ),
    download="trace.json",
    cursor="pointer",
),
```

**Note**: This uses a data URL which works for small traces but may hit browser limits for very large ones. For Phase 1, this is optional — the JSON is already visible in expanded spans.

### Verification — Chunk 10

1. **Auto-refresh**: Navigate to the debug page. Send a message from another tab. Within 15 seconds, the new trace should appear in the sidebar.
2. **Live trace following**: While a trace is in-progress, the selected trace detail should update with new spans every 15 seconds.
3. **Manual refresh**: Click the refresh icon in the sidebar header — trace list should update immediately.
4. **JSON display**: Expand any span — `detail_json` should show formatted JSON in the code block.
5. **Error highlighting**: Traces with errors should show red status dot in sidebar. Error spans should have red left border and error detail at top of trace detail.
6. **Content visibility**: Expand an LLM Call span — should show `messages_content` (the full message array, not a hash) and `response_content` (the actual response text, not a hash). Expand a Context span — should show `wrapped_content` (the full injected message). Expand a Retrieval span — should show `results` with `body` fields containing actual memory content.

---

## Final Verification

After completing ALL chunks, run these verification steps in order:

### 1. Python Import Chain (no errors)

```bash
cd /path/to/Hynous
python -c "
from hynous.core.request_tracer import get_tracer, get_active_trace, set_active_trace
from hynous.core.request_tracer import SPAN_CONTEXT, SPAN_LLM_CALL, SPAN_TOOL_EXEC, SPAN_RETRIEVAL, SPAN_COMPRESSION, SPAN_QUEUE_FLUSH, SPAN_MEMORY_OP
from hynous.core.trace_log import save_trace, load_traces, load_trace, store_payload, load_payload, flush
from hynous.intelligence.agent import Agent
from hynous.intelligence.memory_manager import MemoryManager
from hynous.intelligence.daemon import Daemon
from hynous.intelligence.tools.memory import handle_store_memory, handle_recall_memory
print('All imports OK')
"
```

### 2. Dashboard Import Chain (no errors)

```bash
cd /path/to/Hynous/dashboard
python -c "
from dashboard.state import AppState
from dashboard.pages.debug import debug_page
from dashboard.pages import debug_page as dp2
from dashboard.components.nav import navbar
from dashboard.dashboard import app
print('Dashboard imports OK')
"
```

### 3. Tracer Full Round-Trip Test

```bash
cd /path/to/Hynous
python -c "
import time, json
from hynous.core.request_tracer import get_tracer, set_active_trace, get_active_trace
from hynous.core.trace_log import store_payload, load_payload

t = get_tracer()

# Simulate a full trace
tid = t.begin_trace('test_e2e', 'End to end test message')
set_active_trace(tid)
assert get_active_trace() == tid

# Context span with injection content
wrapped_hash = store_payload('What is BTC doing? [Live State]\nBTC: $97,000\n[End Live State]')
t.record_span(tid, {'type': 'context', 'started_at': '2026-01-01T00:00:00Z', 'duration_ms': 0, 'has_briefing': False, 'has_snapshot': True, 'user_message': 'What is BTC doing?', 'wrapped_hash': wrapped_hash})

# Retrieval span with content bodies
t.record_span(tid, {'type': 'retrieval', 'started_at': '2026-01-01T00:00:00Z', 'duration_ms': 50, 'query': 'BTC thesis', 'results_count': 2, 'results': [
    {'title': 'BTC bullish thesis', 'body': 'Accumulation phase, strong on-chain metrics...', 'score': 0.87, 'node_type': 'thesis', 'lifecycle': 'ACTIVE'},
    {'title': 'BTC funding rates', 'body': 'Funding positive but moderate, no froth...', 'score': 0.72, 'node_type': 'signal', 'lifecycle': 'ACTIVE'},
]})

# LLM call span with payload hashes (messages + response)
messages_hash = store_payload(json.dumps([{'role': 'system', 'content': 'You are Hynous...'}, {'role': 'user', 'content': 'What is BTC doing?'}]))
response_hash = store_payload('BTC is at $97K and looking bullish. On-chain metrics show accumulation...')
t.record_span(tid, {'type': 'llm_call', 'started_at': '2026-01-01T00:00:00Z', 'duration_ms': 1200, 'model': 'claude-sonnet', 'input_tokens': 5000, 'output_tokens': 800, 'stop_reason': 'end_turn', 'success': True, 'messages_hash': messages_hash, 'response_hash': response_hash})

# Tool span
t.record_span(tid, {'type': 'tool_execution', 'started_at': '2026-01-01T00:00:00Z', 'duration_ms': 300, 'tool_name': 'get_market_data', 'success': True, 'input_args': {'symbol': 'BTC'}, 'output_preview': '{\"price\": 97000}'})

# Memory op span
t.record_span(tid, {'type': 'memory_op', 'started_at': '2026-01-01T00:00:00Z', 'duration_ms': 0, 'operation': 'store', 'memory_type': 'thesis', 'title': 'BTC bullish thesis'})

# End trace
set_active_trace(None)
t.end_trace(tid, 'completed', 'BTC looks bullish based on...')

# Verify trace structure
full = t.get_trace(tid)
assert full is not None
assert full['status'] == 'completed'
assert len(full['spans']) == 5
assert full['total_duration_ms'] > 0

# Verify payload round-trip (hashes resolve to content)
assert load_payload(messages_hash) is not None
assert 'Hynous' in load_payload(messages_hash)
assert load_payload(response_hash) == 'BTC is at $97K and looking bullish. On-chain metrics show accumulation...'
assert load_payload(wrapped_hash) is not None

# Verify retrieval results have content bodies
ret_span = full['spans'][1]
assert ret_span['type'] == 'retrieval'
assert len(ret_span['results']) == 2
assert 'body' in ret_span['results'][0]
assert 'Accumulation' in ret_span['results'][0]['body']

# Verify context span has wrapped content hash
ctx_span = full['spans'][0]
assert 'wrapped_hash' in ctx_span
assert ctx_span['user_message'] == 'What is BTC doing?'

# Verify sidebar listing
traces = t.get_recent_traces(limit=10)
found = [tr for tr in traces if tr['trace_id'] == tid]
assert len(found) == 1

print(f'E2E test PASSED — trace {tid[:8]}... with {len(full[\"spans\"])} spans')
print(f'  Context: user_message present, wrapped_hash resolves')
print(f'  Retrieval: {len(ret_span[\"results\"])} results with content bodies')
print(f'  LLM: messages_hash + response_hash both resolve')
"
```

### 4. Agent Signature Check

```bash
cd /path/to/Hynous
python -c "
import inspect
from hynous.intelligence.agent import Agent

sig = inspect.signature(Agent.chat)
params = list(sig.parameters.keys())
assert 'source' in params, f'source not in chat() params: {params}'
assert sig.parameters['source'].default == 'user_chat'

sig2 = inspect.signature(Agent.chat_stream)
params2 = list(sig2.parameters.keys())
assert 'source' in params2, f'source not in chat_stream() params: {params2}'

sig3 = inspect.signature(Agent._execute_tools)
params3 = list(sig3.parameters.keys())
assert '_trace_id' in params3, f'_trace_id not in _execute_tools() params: {params3}'

print('Agent signatures OK')
"
```

### 5. Memory Manager Signature Check

```bash
cd /path/to/Hynous
python -c "
import inspect
from hynous.intelligence.memory_manager import MemoryManager

sig = inspect.signature(MemoryManager.retrieve_context)
assert '_trace_id' in sig.parameters

sig2 = inspect.signature(MemoryManager.maybe_compress)
assert '_trace_id' in sig2.parameters

print('MemoryManager signatures OK')
"
```

### 6. Daemon Source Tagging Check

```bash
cd /path/to/Hynous
grep -n 'source=' src/hynous/intelligence/daemon.py | head -20
# Should show multiple lines like:
#   source="daemon:review"
#   source="daemon:watchpoint"
#   source="daemon:scanner"
#   etc.
```

### 7. Dashboard State Check

```bash
cd /path/to/Hynous/dashboard
python -c "
from dashboard.state import AppState
# Check state vars exist with correct types
assert hasattr(AppState, 'debug_traces')
assert hasattr(AppState, 'debug_selected_trace_id')
assert hasattr(AppState, 'debug_selected_trace')
assert hasattr(AppState, 'go_to_debug')
assert hasattr(AppState, 'load_debug_traces')
assert hasattr(AppState, 'select_debug_trace')
assert hasattr(AppState, 'toggle_debug_span')
print('Dashboard state OK')
"
```

### 8. Full System Smoke Test (if Nous + API keys available)

```bash
cd /path/to/Hynous
python -c "
# This test only works if the full system is configured
# Skip if OPENROUTER_API_KEY is not set
import os
if not os.getenv('OPENROUTER_API_KEY'):
    print('SKIPPED — no OPENROUTER_API_KEY')
else:
    from hynous.intelligence.agent import Agent
    from hynous.core.request_tracer import get_tracer

    agent = Agent()
    # Send a simple message — should create a trace
    response = agent.chat('ping', source='test_e2e')

    # Check trace was created
    traces = get_tracer().get_recent_traces(limit=5)
    test_traces = [t for t in traces if t['source'] == 'test_e2e']
    assert len(test_traces) >= 1, 'No trace created for test message'
    print(f'Live test PASSED — response: {response[:50]}...')
    print(f'Trace: {test_traces[0][\"trace_id\"][:8]}... with {test_traces[0][\"span_count\"]} spans')
"
```

---

## Summary: Files Created/Modified

### New Files (3)
| File | Lines | Purpose |
|------|-------|---------|
| `src/hynous/core/request_tracer.py` | ~250 | Tracer singleton — begin/record/end traces |
| `src/hynous/core/trace_log.py` | ~200 | Persistence — JSON storage + content-addressed payloads |
| `dashboard/dashboard/pages/debug.py` | ~400 | Debug page UI — sidebar + timeline |

### Modified Files (7)
| File | Changes | Purpose |
|------|---------|---------|
| `src/hynous/intelligence/agent.py` | +~80 lines | Add `source` param, trace spans for context/LLM/tools |
| `src/hynous/intelligence/memory_manager.py` | +~30 lines | Trace spans for retrieval + compression |
| `src/hynous/intelligence/tools/memory.py` | +~50 lines | Trace spans for store/recall/update + queue flush |
| `src/hynous/intelligence/daemon.py` | +~15 lines | Add `source=` to all `_wake_agent()` calls |
| `dashboard/dashboard/state.py` | +~60 lines | Debug state vars + methods |
| `dashboard/dashboard/dashboard.py` | +~5 lines | Add debug route + import |
| `dashboard/dashboard/pages/__init__.py` | +2 lines | Export debug_page |
| `dashboard/dashboard/components/nav.py` | +~5 lines | Add Debug nav item |

### Storage (auto-created at runtime)
```
storage/
├── traces.json          # Trace metadata + spans (max 500, 14-day retention)
└── payloads/            # Content-addressed LLM payloads (SHA256 dedup)
    ├── a1b2c3d4e5f6.json
    └── ...
```
