# Archive Index

> Historical revision and implementation guides. All 9 revision tracks are fully implemented. There is no pending work.

---

## Master Issue List

| File | Contents | Status |
|------|----------|--------|
| [revision-exploration.md](./revision-exploration.md) | All 21 issues across the codebase, prioritized P0-P3 | ALL RESOLVED |

---

## Revision Tracks

### 1. Nous Wiring (NW-1 to NW-10, MF-0 to MF-15)

Nous-to-Python integration fixes and Nous feature additions.

| Directory | Contents | Status |
|-----------|----------|--------|
| [nous-wiring/](./nous-wiring/) | 10 wiring issues + 16 feature items (executive summary, detailed guides) | ALL RESOLVED (10 fixed, 14 done, 2 skipped) |
| [MF0/](./MF0/) | Search-before-store dedup — implementation guide + audit notes | DONE, auditor verified |
| [MF12/](./MF12/) | Contradiction resolution execution — implementation guide + audit notes | DONE, auditor verified |
| [MF13/](./MF13/) | Cluster management — implementation guide + audit notes | DONE, auditor verified |
| [MF15/](./MF15/) | Gate filter for memory quality — implementation guide + audit notes | DONE, auditor verified |

### 2. Memory Search

Intelligent Retrieval Orchestrator: 5-step pipeline (Classify, Decompose, Parallel Search, Quality Gate, Merge).

| Directory | Contents | Status |
|-----------|----------|--------|
| [memory-search/](./memory-search/) | Design plan + implementation guide | IMPLEMENTED |

### 3. Trade Recall

Three trade retrieval bugs: missing event_time, memory_type mismatch, thesis extraction.

| Directory | Contents | Status |
|-----------|----------|--------|
| [trade-recall/](./trade-recall/) | Root cause analysis + implementation guide (9 steps) | ALL FIXED |

### 4. Token Optimization (TO-1 to TO-4)

LLM token cost reduction: dynamic max_tokens, schema trimming, stale tool truncation, window size.

| Directory | Contents | Status |
|-----------|----------|--------|
| [token-optimization/](./token-optimization/) | Executive summary + 4 individual TO guides | TO-1 through TO-4 DONE (TO-5 to TO-8 deferred) |

### 5. Trade Debug Interface

Trade execution telemetry via `trade_step` span type in the debug system.

| Directory | Contents | Status |
|-----------|----------|--------|
| [trade-debug-interface/](./trade-debug-interface/) | Analysis + implementation guide (6 chunks) | IMPLEMENTED |

### 6. Debug Dashboard

Full pipeline transparency for `agent.chat()` calls: request tracer, trace log, debug page.

| Directory | Contents | Status |
|-----------|----------|--------|
| [debugging/](./debugging/) | Brief planning + implementation guide (10 chunks) | IMPLEMENTED |

### 7. Memory Pruning

Two-phase memory maintenance: `analyze_memory` (graph scan + staleness scoring) and `batch_prune` (concurrent archive/delete).

| Directory | Contents | Status |
|-----------|----------|--------|
| [memory-pruning/](./memory-pruning/) | Implementation guide (Approach B) | IMPLEMENTED |

### 8. Memory Sections (Issues 0-6 + Brain Visualization)

Brain-inspired memory sectioning: per-section retrieval weights, decay curves, consolidation, stakes weighting, procedural memory, retrieval bias. Plus interactive brain visualization frontend.

| Directory | Contents | Status |
|-----------|----------|--------|
| [memory-sections/](./memory-sections/) | Executive summary + 7 issue guides + brain visualization guide | ALL 7 ISSUES DONE |

### 9. Other

| Directory | Contents | Status |
|-----------|----------|--------|
| [graph-changes/](./graph-changes/) | Cluster visualization changes | DONE |
| [portfolio-tracking/](./portfolio-tracking/) | Portfolio tracking audit | DONE |

---

## For Agents

All revisions are complete. If you need to understand a past design decision, read the relevant directory above. Start with the executive summary if one exists, then drill into implementation guides.

Key starting points for understanding the system:
- `nous-wiring/executive-summary.md` -- Nous integration overview
- `memory-search/design-plan.md` -- Retrieval orchestrator architecture
- `memory-sections/executive-summary.md` -- Memory sections theory and implementation
- `token-optimization/executive-summary.md` -- Cost optimization strategy

---

Last updated: 2026-03-01
