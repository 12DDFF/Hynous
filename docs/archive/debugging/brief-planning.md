# Debug Dashboard — Implementation Plan

> **STATUS: IMPLEMENTED.** Full pipeline transparency for every `agent.chat()` call. See exactly what happened at each step and diagnose where things went wrong.
>
> Core files: `src/hynous/core/request_tracer.py`, `src/hynous/core/trace_log.py`, `dashboard/dashboard/pages/debug.py`. Instrumented: `agent.py`, `memory_manager.py`, `tools/memory.py`, `daemon.py`.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    REFLEX DEBUG PAGE                      │
│                  /debug route (:3000)                     │
│                                                          │
│  ┌──────────────┐  ┌─────────────────────────────────┐  │
│  │  Trace List   │  │         Trace Detail             │  │
│  │  (sidebar)    │  │  • Timeline (spans)              │  │
│  │               │  │  • LLM payload viewer            │  │
│  │  Filter by:   │  │  • Tool call inspector           │  │
│  │  - source     │  │  • Memory ops panel              │  │
│  │  - status     │  │  • Compression audit             │  │
│  │  - time range │  │  • Error highlights              │  │
│  └──────┬───────┘  └──────────────┬──────────────────┘  │
│         │ polls every 2s          │                       │
└─────────┼─────────────────────────┼──────────────────────┘
          │                         │
          ▼                         ▼
┌─────────────────────────────────────────────────────────┐
│              TRACE STORAGE (trace_log.py)                 │
│                                                          │
│  storage/traces.json   — Trace metadata + spans          │
│  storage/payloads/     — Content-addressed LLM payloads  │
│                          (SHA256 dedup)                   │
│                                                          │
│  Max 500 traces, 14-day retention, auto-prune            │
└─────────────────────────────────┬───────────────────────┘
                          │
                          ▲ writes
                          │
┌─────────────────────────────────────────────────────────┐
│             REQUEST TRACER (request_tracer.py)            │
│                                                          │
│  Singleton, thread-safe (threading.Lock)                 │
│  • begin_trace(source, input_summary)                    │
│  • record_span(trace_id, span)                           │
│  • end_trace(trace_id, status, output_summary)           │
│  • export_partial(trace_id) — for live view              │
│                                                          │
│  Called from: agent.py, memory_manager.py,               │
│              tools/memory.py, daemon.py                   │
└─────────────────────────────────────────────────────────┘
```

---

## Data Model

### RequestTrace (one per chat() / chat_stream() call)

```python
@dataclass
class RequestTrace:
    trace_id: str           # uuid4
    source: str             # "user_chat" | "discord" | "daemon:<wake_type>"
    started_at: str         # ISO timestamp
    ended_at: str | None    # Set on completion
    status: str             # "in_progress" | "completed" | "error"
    input_summary: str      # First ~200 chars of user message
    output_summary: str     # First ~200 chars of final response
    spans: list[Span]       # Ordered timeline of operations
    total_duration_ms: int  # Wall clock time
    error: str | None       # Exception message if failed
```

### Span Types (7 types covering the full pipeline)

| Span Type | What It Captures | Triggered By |
|-----------|-----------------|--------------|
| `ContextSpan` | Briefing injection, context snapshot, timestamp injection | `agent.py` — `_build_messages()` / `chat()` |
| `RetrievalSpan` | Nous SSA search query, results returned, scores, latency | `memory_manager.py` — `retrieve_context()` |
| `LLMCallSpan` | Full request payload (messages, tools, system prompt via SHA ref), full response, token counts, model, latency, stop_reason | `agent.py` — `_call_llm()` loop iterations |
| `ToolExecutionSpan` | Tool name, input args, output result, duration, success/error | `agent.py` — `_execute_tools()` |
| `MemoryOpSpan` | Operation type (store/recall/update), node data, gate filter result, dedup result | `tools/memory.py` — tool handlers |
| `CompressionSpan` | Exchanges evicted count, Haiku compression input/output, Nous store result, fallback used? | `memory_manager.py` — `maybe_compress()` |
| `QueueFlushSpan` | Pending queue items, store results per item, errors | `memory_manager.py` — `flush_pending_memories()` |

### Payload Dedup (content-addressed storage)

Large payloads (system prompt, tool schemas, full message arrays) are stored separately using SHA256 content addressing:

```
storage/payloads/
├── a1b2c3d4.json    # System prompt (stored once, referenced by many traces)
├── e5f6g7h8.json    # Tool schema array (stored once)
├── ...
```

Spans reference payloads by hash instead of inlining them. This prevents trace files from exploding in size — the system prompt (~2KB) and tool schemas (~5KB) are shared across all traces.

---

## Files to Create

### 1. `src/hynous/core/request_tracer.py` — Tracer Singleton

In-process tracer that records spans during a request lifecycle.

- `RequestTracer` class — singleton via module-level instance (like `memory_tracker.py` pattern)
- `begin_trace(source, input_summary) -> trace_id` — creates new RequestTrace, returns ID
- `record_span(trace_id, span)` — appends span to trace's timeline
- `end_trace(trace_id, status, output_summary, error?)` — finalizes trace, triggers persist
- `export_partial(trace_id) -> RequestTrace` — returns in-progress trace for live view
- `get_recent_traces(limit=50) -> list[TraceSummary]` — for sidebar list
- `get_trace(trace_id) -> RequestTrace` — full trace with spans
- Thread-safe via `threading.Lock` (following `daemon_log.py` pattern)
- Buffered writes: flush to `trace_log.py` on `end_trace()` and every 30s for long-running traces

### 2. `src/hynous/core/trace_log.py` — Trace Storage

Persistence layer for traces and payloads.

- `save_trace(trace: RequestTrace)` — serialize to JSON, append to traces.json
- `load_traces(limit, offset, filters) -> list[RequestTrace]` — paginated loading
- `load_trace(trace_id) -> RequestTrace` — single trace by ID
- `store_payload(content: str) -> str` — SHA256 hash, write to `storage/payloads/{hash}.json` if not exists, return hash
- `load_payload(hash: str) -> str` — read payload by hash
- `prune()` — delete traces older than 14 days, cap at 500 traces, clean orphaned payloads
- Auto-prune on save (every 50th write, following `daemon_log.py` lazy pattern)
- Storage location: `storage/traces.json` + `storage/payloads/`

### 3. `dashboard/dashboard/pages/debug.py` — Debug Page UI

New Reflex page at `/debug` route.

**Layout**: Sidebar (trace list) + Main area (trace detail) — same pattern as `memory.py` page

**Sidebar** (left, ~300px):
- Filter bar: source dropdown, status dropdown, time range
- Scrollable trace list: each item shows timestamp, source badge, status dot, duration, input_summary truncated
- Click to select → loads full trace in main area
- Auto-refresh every 2s (for live traces)

**Main Area** (right):
- **Header**: trace_id, source, status, total duration, timestamps
- **Timeline**: Vertical list of spans in chronological order, each showing:
  - Span type icon/badge
  - Duration bar (proportional to total)
  - Key info summary
  - Click to expand full detail
- **Expanded Span Views**:
  - `LLMCallSpan`: Collapsible JSON viewer for request/response payloads, token counts highlighted, stop_reason
  - `ToolExecutionSpan`: Tool name, input args (syntax highlighted), output (collapsible), error if any
  - `RetrievalSpan`: Search query, results with relevance scores, latency
  - `MemoryOpSpan`: Operation type, node data, gate filter verdict, dedup check
  - `CompressionSpan`: Before/after text, Haiku summary, fallback indicator
  - `QueueFlushSpan`: Items processed, success/fail counts
  - `ContextSpan`: What was injected (briefing, snapshot, timestamp)
- **Error Panel**: If trace has errors, highlighted at top with full stack trace

---

## Files to Modify

### 4. `src/hynous/intelligence/agent.py` — Instrument the Agent

**In `chat()` and `chat_stream()`:**
- At entry: `trace_id = tracer.begin_trace(source, message[:200])`
- Pass `trace_id` through to helper methods
- At exit: `tracer.end_trace(trace_id, "completed", response[:200])`
- On exception: `tracer.end_trace(trace_id, "error", error=str(e))`

**In `_build_messages()` / context injection:**
- Record `ContextSpan` with what was injected (briefing present?, snapshot present?, timestamp?)

**In the LLM call loop (each iteration):**
- Before litellm call: capture full request payload (messages array hash, system prompt hash, tool schemas hash, model, temperature, max_tokens)
- After litellm response: capture full response, token usage, stop_reason, latency
- Record `LLMCallSpan`

**In `_execute_tools()`:**
- Before each tool: record tool name, input args
- After each tool: record output, duration, success/error
- Record `ToolExecutionSpan` per tool

### 5. `src/hynous/intelligence/memory_manager.py` — Instrument Memory

**In `retrieve_context()`:**
- Record `RetrievalSpan` with query, results count, scores, latency

**In `maybe_compress()`:**
- Record `CompressionSpan` with exchanges_evicted count, compression input/output, fallback used

**In `flush_pending_memories()`:**
- Record `QueueFlushSpan` with items count, results

### 6. `src/hynous/intelligence/tools/memory.py` — Instrument Memory Tools

**In store_memory, recall_memory, update_memory handlers:**
- Record `MemoryOpSpan` with operation type, node data, gate filter result, dedup result

### 7. `src/hynous/intelligence/daemon.py` — Tag Wake Source

**In `_wake_agent()`:**
- Pass wake type as source to agent.chat() so traces show "daemon:scanner", "daemon:periodic", etc.

### 8. `dashboard/dashboard/state.py` — Debug State

Add debug-related state variables:
- `debug_traces: list[dict]` — recent trace summaries for sidebar
- `debug_selected_trace: dict | None` — full selected trace
- `debug_filter_source: str` — filter dropdown value
- `debug_filter_status: str` — filter dropdown value
- `debug_live_mode: bool` — auto-refresh toggle
- Background polling method (2s interval when live mode on) using `@_background` pattern
- Methods: `load_traces()`, `select_trace(trace_id)`, `toggle_live_mode()`

### 9. `dashboard/dashboard/dashboard.py` — Add Debug Route

Add `/debug` to the `rx.cond` routing chain.

### 10. `dashboard/dashboard/components/nav.py` — Add Nav Item

Add "Debug" nav item with appropriate icon (e.g., bug icon).

---

## Implementation Phases

### Phase 1: Storage Layer (~2 files)
Create `trace_log.py` and `request_tracer.py`. Unit test both with synthetic traces.
- Verify: JSON round-trip, payload dedup, auto-prune, thread safety

### Phase 2: Agent Instrumentation (~3 files)
Instrument `agent.py`, `memory_manager.py`, `tools/memory.py`, `daemon.py`.
- Verify: Run agent locally, confirm traces appear in `storage/traces.json`
- Key principle: **tracing must never break the agent**. All tracer calls wrapped in try/except with silent fallback.

### Phase 3: Debug Page — Post-Mortem View (~3 files)
Build `debug.py` page, add state vars, wire routing + nav.
- Verify: Navigate to `/debug`, see completed traces, click to expand, inspect spans and payloads

### Phase 4: Live View
Add 2s polling, `export_partial()` for in-progress traces, auto-scroll timeline.
- Verify: Send a message while watching debug page, see spans appear in real-time

### Phase 5: Polish
- Error highlighting (red badges on error spans)
- Duration bars on timeline
- JSON syntax highlighting in payload viewer
- Export trace as JSON button
- Source/status filter dropdowns

---

## Design Principles

1. **Zero impact on agent performance** — Tracing is fire-and-forget. Never blocks the LLM call loop. All persistence is async/buffered.
2. **Zero impact on token costs** — Tracing is purely local. No extra LLM calls. Payloads are captured from existing data flowing through the system.
3. **Fail-safe** — If tracing throws, the agent continues normally. All tracer calls wrapped in try/except.
4. **Follow existing patterns** — Storage follows `daemon_log.py` (Lock, lazy load, buffered flush, FIFO prune). UI follows `memory.py` page (sidebar + main). State follows existing `@_background` polling pattern.
5. **Content-addressed payloads** — Large payloads (system prompt, tool schemas) stored once via SHA256 hash, referenced by many traces. Keeps trace file small.
