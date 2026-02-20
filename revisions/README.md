# Revisions

> Known issues and planned improvements for Hynous. Read before making changes.

---

## Reading Order

### 1. Nous ↔ Python Integration — ALL RESOLVED

| File | Contents |
|------|----------|
| `nous-wiring/executive-summary.md` | **Start here.** Issue categories with context and current status |
| `nous-wiring/nous-wiring-revisions.md` | 10 wiring issues (NW-1 to NW-10) — **all 10 FIXED** |
| `nous-wiring/more-functionality.md` | 16 Nous features (MF-0 to MF-15) — **14 DONE, 2 SKIPPED, 0 remaining** |

Detailed implementation + audit notes for major items:

| Directory | Item | Status |
|-----------|------|--------|
| `MF0/` | Search-before-store dedup | DONE, auditor verified |
| `MF12/` | Contradiction resolution execution | DONE, auditor verified |
| `MF13/` | Cluster management | DONE, auditor verified |
| `MF15/` | Gate filter for memory quality | DONE, auditor verified |

### 2. Memory Search — IMPLEMENTED

| File | Contents |
|------|----------|
| `memory-search/design-plan.md` | Architectural design and rationale — **IMPLEMENTED** |
| `memory-search/implementation-guide.md` | Detailed implementation guide — **IMPLEMENTED** (diverged in some areas) |

The Intelligent Retrieval Orchestrator transforms single-shot memory retrieval into a 5-step pipeline (Classify → Decompose → Parallel Search → Quality Gate → Merge & Select). Lives in `src/hynous/intelligence/retrieval_orchestrator.py`. Wired into `memory_manager.py` and `tools/memory.py`. Config toggle: `orchestrator.enabled`.

Key implementation divergences from the guide: added `search_full()` to NousClient, D1+D4 decomposition triggers (not just D4), 5-step pipeline (no "Replace Weak" step), individual filter parameters (not `SearchFilters` dataclass).

### 3. Trade Recall — ALL FIXED

| File | Contents |
|------|----------|
| `trade-recall/retrieval-issues.md` | Root cause analysis of trade retrieval failures — **ALL FIXED** |
| `trade-recall/implementation-guide.md` | Step-by-step implementation guide (9 steps across 3 problems) |

Three trade retrieval issues resolved:

1. **~~Missing `event_time` on trade nodes~~** — FIXED: `_store_to_nous()` now passes `event_time`, `event_confidence`, `event_source` to `create_node()`. All trade nodes get ISO timestamps automatically.
2. **~~`memory_type` mismatch~~** — FIXED: `handle_recall_memory()` normalizes `"trade"` → `"trade_entry"` before `_TYPE_MAP` lookup.
3. **~~`get_trade_stats` wrong tool for thesis retrieval~~** — FIXED: `TradeRecord` has `thesis` field, `_enrich_from_entry()` extracts thesis from linked entry nodes, time/limit filtering added, formatters show thesis.

### 4. Token Optimization — TO-1 through TO-4 DONE

| File | Contents |
|------|----------|
| `token-optimization/executive-summary.md` | Overview of 8 TOs (4 implemented, 4 deferred) |
| `token-optimization/TO-1-dynamic-max-tokens.md` | Dynamic max_tokens per wake type (512-2048) |
| `token-optimization/TO-2-schema-trimming.md` | Trim store_memory/recall_memory schemas (~70% smaller) |
| `token-optimization/TO-3-stale-tool-truncation.md` | Tiered stale tool-result truncation (150/300/400/600/800) |
| `token-optimization/TO-4-window-size.md` | Window size 6→4 with Haiku compression |

Deferred for later: TO-5 (streaming cost abort), TO-6 (cron schedule tuning), TO-7 (prompt compression), TO-8 (model routing).

### 5. Trade Debug Interface — IMPLEMENTED

| File | Contents |
|------|----------|
| `trade-debug-interface/analysis.md` | Original analysis: problem statement, current trade flows, data inventory, proposed solutions |
| `trade-debug-interface/implementation-guide.md` | Step-by-step implementation guide (6 chunks) — **IMPLEMENTED** |

Added `trade_step` span type (8th span type) to the debug system. Three trade handlers (`execute_trade`, `close_position`, `modify_position`) now emit sub-step spans for every internal operation: circuit breaker, validation, leverage, order fill, SL/TP, PnL calculation, cache invalidation, order cancellation, entry lookup, memory storage. Each span includes timing, success/failure, and human+AI-readable detail strings. 3 files modified (`request_tracer.py`, `trading.py`, `state.py`), ~130 lines added, 0 removed.

### 6. Debug Dashboard — IMPLEMENTED

| File | Contents |
|------|----------|
| `../debugging/brief-planning.md` | Architectural plan: data model, span types, architecture overview |
| `../debugging/implementation-guide.md` | Detailed 10-chunk implementation guide — **IMPLEMENTED** |

Full pipeline transparency for every `agent.chat()` call. Request tracer captures spans across the entire agent lifecycle: context injection, Nous retrieval, LLM calls, tool execution, memory operations, compression, and queue flushes.

Key components:
- **`src/hynous/core/request_tracer.py`** — Tracer singleton with thread-safe span recording, trace lifecycle management (`begin_trace`, `record_span`, `end_trace`, `export_partial`)
- **`src/hynous/core/trace_log.py`** — Persistence layer with content-addressed payload dedup (SHA256), 500-trace cap, 14-day retention, auto-prune
- **`dashboard/dashboard/pages/debug.py`** — Reflex `/debug` page with sidebar trace list + main area timeline view, expandable span details, live auto-refresh
- **Instrumentation** in `agent.py`, `memory_manager.py`, `tools/memory.py`, `daemon.py` — all tracer calls wrapped in try/except for zero impact on agent operation

### 7. Memory Pruning — IMPLEMENTED

| File | Contents |
|------|----------|
| `memory-pruning/implementation-guide.md` | Two-phase implementation guide (Approach B) — **IMPLEMENTED** |

Two-phase memory maintenance system for cleaning up stale nodes:

1. **`analyze_memory`** — Scans entire knowledge graph via `get_graph()`, finds connected components via BFS, scores each group on staleness (0.0-1.0) using retrievability, lifecycle, recency, and access frequency. Returns ranked analysis for agent review.
2. **`batch_prune`** — Archives (set DORMANT) or deletes nodes in bulk using `ThreadPoolExecutor(max_workers=10)` for concurrent processing. Safety guard: skips ACTIVE nodes with >10 accesses on delete.

Key implementation details:
- Concurrent batch processing via `_prune_one_node()` thread-safe worker
- `NousClient.delete_node()` and `delete_edge()` now properly call `raise_for_status()` for error propagation
- Dashboard health count shows live nodes (active + weak), excludes archived (DORMANT)
- `MutationTracker` extended with `record_archive()` and `record_delete()` for audit trail
- System prompt updated: 25 tools total, pruning tools mentioned in Memory strategy
- 45 tests (38 unit + 7 integration), all passing

Files modified: `pruning.py` (new), `registry.py`, `builder.py`, `agent.py`, `memory_tracker.py`, `client.py`, `state.py`, `test_pruning.py` (new), `test_pruning_integration.py` (new), `test_token_optimization.py`.

### 8. Full Issue List

| File | Contents |
|------|----------|
| `revision-exploration.md` | Master list of all 21 issues across the entire codebase, prioritized P0 through P3 — **all resolved** |

---

### 9. Memory Sections — NEXT UP (Active Development)

| File | Contents |
|------|----------|
| `memory-sections/executive-summary.md` | **START HERE.** Theory, 6 issues, proposed section model, design constraints |

Brain-inspired memory sectioning: giving different memory types (signals, episodes, lessons, playbooks) fundamentally different retrieval weights, decay curves, encoding strength, and consolidation rules. Sections are a **bias layer on top of existing SSA search**, not hard partitions — all nodes stay in one table, all queries still search everything, but results are reranked per-section and boosted by query intent.

Six issues to address:
1. **Uniform SSA retrieval weights** — same 6-signal weights for all memory types
2. **Uniform FSRS decay curves** — same decay rate for signals and lessons
3. **No cross-episode generalization** — no background process to extract patterns across trades
4. **No stakes weighting** — catastrophic losses encode identically to routine scans
5. **No procedural memory** — playbooks are text blobs, not structured pattern→action pairs
6. **Flat retrieval** — no section-aware reranking or intent-based priority boost

Implementation guides for each issue will be added as companion files. The executive summary contains the full theory and problem statement.

---

## For Agents

**What to work on next:** Memory Sections. Read `memory-sections/executive-summary.md` first. All prior revisions are complete — memory sections is the active development frontier.

If you're fixing a specific issue from a prior revision:

1. Check if it's already resolved in `nous-wiring/`, `memory-search/`, `trade-debug-interface/`, or `token-optimization/`
2. Each issue has exact file paths, line numbers, and implementation instructions
3. Check `revision-exploration.md` for related issues that may compound with yours

If you're doing a general review or planning work:

1. **Read `memory-sections/executive-summary.md`** — this is the current focus
2. Read `nous-wiring/executive-summary.md` for Nous integration status (all resolved)
3. Read `memory-search/design-plan.md` for retrieval orchestrator design
4. Read `trade-debug-interface/analysis.md` for trade execution telemetry design
5. Read `token-optimization/executive-summary.md` for cost optimization status
6. Read `../debugging/brief-planning.md` for debug dashboard architecture
7. Check `revision-exploration.md` for the full issue landscape (all 21 resolved)
