from __future__ import annotations

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
SPAN_TRADE_STEP = "trade_step"


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
