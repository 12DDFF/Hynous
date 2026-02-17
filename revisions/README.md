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

## For Agents

All revisions are complete. If you're fixing a specific issue or starting new work:

If you're fixing a specific issue:

1. Check if it's already resolved in `nous-wiring/`, `memory-search/`, `trade-debug-interface/`, or `token-optimization/`
2. Each issue has exact file paths, line numbers, and implementation instructions
3. Check `revision-exploration.md` for related issues that may compound with yours

If you're doing a general review or planning work:

1. Read `nous-wiring/executive-summary.md` for Nous integration status
2. Read `memory-search/design-plan.md` for retrieval orchestrator design
3. Read `trade-debug-interface/analysis.md` for trade execution telemetry design
4. Read `token-optimization/executive-summary.md` for cost optimization status
5. Check `revision-exploration.md` for the full issue landscape
