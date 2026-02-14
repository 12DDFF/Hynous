# Nous ↔ Hynous Integration — Executive Summary

> Start here. This document outlines the categories of issues in the integration between Nous (TypeScript memory server) and the Hynous Python intelligence layer. After reading this, dive into the specific issues in the companion files.

## Companion Files

| File | Contents |
|------|----------|
| `nous-wiring-revisions.md` | 10 issues (NW-1 through NW-10) — things that ARE wired but work incorrectly |
| `more-functionality.md` | 16 items (MF-0 through MF-15) — Nous capabilities. 14 DONE, 2 SKIPPED (MF-11, MF-14), 0 remaining |

---

## System Overview

Nous is a sophisticated memory system with SSA retrieval (6-signal composite scoring), FSRS spaced repetition, Hebbian edge learning, contradiction detection, graph spreading activation, lifecycle management, and more. It works correctly — all 1,236+ core tests pass, all server endpoints function as designed.

The Python intelligence layer (agent, daemon, tools, memory manager) communicates with Nous through an HTTP client (`src/hynous/nous/client.py`). This integration layer is where all issues live. Nous itself does not need changes.

---

## Issue Categories

### 1. Memory Retrieval Bottleneck

**The most critical category.** The agent stores rich, detailed content into Nous — full trade theses, multi-paragraph analyses, structured market data. Nous stores it all perfectly and returns it in full on search. But the Python retrieval layer aggressively truncates content before the agent ever sees it.

Three stacking truncation layers:
- **Summary preference**: Two formatting functions prefer `content_summary` (a short one-liner) over `content_body` (the full content). Whenever a summary exists — which it always does for trades and long content — the full body is discarded.
- **Per-memory character clip**: Each memory is hard-clipped to 300 chars (auto-retrieval) or 400 chars (explicit recall). A 2,000-word analysis becomes ~75 words.
- **Global token budget**: All auto-recalled memories share a combined budget of 800 tokens (~200 words total). Even if per-memory clips are fixed, this budget caps the agent's total recalled context to roughly one paragraph.

The result: the agent operates on ~5% of the knowledge it stored. The system prompt tells it to "write rich, detailed content" — it does, Nous saves it, and the retrieval layer throws it away. The agent itself diagnosed this bug during live trading.

**See:** `nous-wiring-revisions.md` → NW-2, NW-3

---

### 2. Incorrectly Wired Integration

Some Nous features are connected to the Python side but wired wrong — incorrect field names, mismatched expectations, or logic errors that cause silent failures.

The most severe: the Python side uses `lifecycle_state` as a field name everywhere, but Nous expects `state_lifecycle`. Every lifecycle transition (marking watchpoints as fired, expiring alerts, marking curiosity items as addressed) silently fails. The daemon catches the HTTP 400 error in bare `except: pass` blocks, so nothing logs the failure. Consequences include watchpoints that fire infinitely, curiosity sessions that re-trigger every 15 minutes, and wasted API tokens on duplicate wakes.

Similar field name mismatches exist on the read side — the watchpoint list display reads `lifecycle_state` from Nous responses (which use `state_lifecycle`), so lifecycle status always shows as "?".

**See:** `nous-wiring-revisions.md` → NW-1, NW-7

---

### 3. Dead Client Methods

The Python `NousClient` class has 13 methods wrapping Nous endpoints. Roughly half are never called by any tool, daemon task, or manager:

- ~~`update_node()` — exists but no tool exposes it, making memories immutable~~ → **FIXED: exposed via `update_memory` tool**
- `detect_contradiction()` — exists but not called from Python (Nous runs Tier 2 automatically; manual detection available but not needed)
- ~~`get_conflicts()` — exists but never called~~ → **FIXED: called by `manage_conflicts` tool + daemon `_check_conflicts()`**
- ~~`resolve_conflict()` — exists but never called~~ → **FIXED: called by `manage_conflicts` tool (resolve action)**
- ~~`classify_query()` — exists but never called~~ → **FIXED: called by Intelligent Retrieval Orchestrator (`retrieval_orchestrator.py`) for compound query detection (D4/D1)**
- ~~`health()` — exists but never called~~ → **FIXED: daemon `_check_health()` on startup + periodic (MF-8 DONE)**

Most formerly-dead methods are now active. Only `detect_contradiction()` (not needed — Tier 2 runs automatically) remains unused. `classify_query()` is now used by the Intelligent Retrieval Orchestrator for compound query detection. `search_full()` was added for the orchestrator's quality gating.

**See:** `nous-wiring-revisions.md` → NW-4 (FIXED), NW-5 (FIXED), NW-8 (FIXED); `more-functionality.md` → MF-4 (DONE), MF-8 (DONE), MF-10 (DONE)

---

### 4. Missing Nous Functionality (No Wiring At All)

Beyond the dead client methods, Nous has entire capability areas that have no client method AND no tool:

- ~~**Edge strengthening** (Hebbian learning) — edges should get stronger when memories are co-activated, making the graph adaptive. The `POST /edges/:id/strengthen` endpoint exists but has no Python client method.~~ → **FIXED: `strengthen_edge()` client method + auto-strengthen on co-retrieval (memory_manager + recall_memory) + trade lifecycle strengthening (MF-1 DONE)**
- ~~**Batch decay** — the `POST /decay` endpoint runs FSRS lifecycle transitions across all nodes. No client method, no daemon task.~~ → **FIXED: `run_decay()` client method + daemon `_run_decay_cycle()` every 6h (MF-2 DONE)**
- ~~**Embedding backfill** — the `POST /nodes/backfill-embeddings` endpoint ensures all nodes have vector embeddings. No client method.~~ → **FIXED: `backfill_embeddings()` client method + daemon `_run_embedding_backfill()` every 12h (MF-9 DONE)**
- ~~**Graph traversal** — `get_edges()` exists in the client but is only used for watchpoint cleanup. The agent can't explore its own knowledge graph.~~ → **FIXED: `explore_memory` tool with explore/link/unlink actions**
- ~~**Time-range search** — the search endpoint supports temporal filtering but no tool ever passes time parameters.~~ → **FIXED: `recall_memory` now accepts `time_start`, `time_end`, `time_type` parameters**
- ~~**Browsable inventory** — `list_nodes()` exists but isn't exposed as a general tool. The agent can only find memories by keyword search, not by browsing categories.~~ → **FIXED: browse mode in `recall_memory`**

These represent Nous capabilities that are fully built and tested but have zero path from the agent to the endpoint.

**See:** `more-functionality.md` → MF-1 through MF-9

---

### 5. Fire-and-Forget Reliability Gap

The `store_memory` tool is registered as a background tool (`background=True`). When the agent calls it, the tool execution returns an immediate synthetic `"Done."` response before any HTTP call to Nous happens. The actual storage runs in a daemon thread. If Nous is down, the network times out, or the request fails, the error is logged but the agent already believes the memory was stored.

During queue mode (active during the agent's thinking loop), memories are batch-flushed after the response. Each failed item in the queue is silently skipped. Multiple memories can fail in a single flush.

The agent has zero feedback mechanism for storage failures. It can't retry, can't alert the user, and can't adjust its behavior. For a system built on memory-driven learning, silent memory loss is a meaningful gap.

**See:** `nous-wiring-revisions.md` → NW-10

---

### ~~6. Misleading System Prompt~~ MOSTLY RESOLVED

The agent's system prompt (in `prompts/builder.py`) claims are now mostly true:

- ~~*"When I store something contradicting existing knowledge, the system warns me."* — False.~~ → **NOW TRUE.** The `_contradiction_detected` flag is checked on store and surfaces a warning. The daemon polls the conflict queue every 30 min and wakes the agent. The `manage_conflicts` tool lets the agent list and resolve conflicts.
- *"Memories decay: ACTIVE → WEAK → DORMANT."* — **Now partially true.** FSRS batch decay runs every 6 hours via `_run_decay_cycle()`. Lifecycle transitions are computed proactively. However, the agent still has no visibility into which specific memories are fading (no fading alerts yet).

**Remaining:** The "fading memory alerts" enhancement (surfacing ACTIVE→WEAK transitions to the agent for review/reinforcement) is still TODO.

**See:** `revision-exploration.md` → #14

---

### ~~7. No Deduplication or Consolidation — Unchecked Node Proliferation~~ RESOLVED

The `store_memory` tool now runs a search-before-store dedup check for lesson and curiosity types. Before creating a node, `_store_memory_impl()` calls `POST /v1/nodes/check-similar` on Nous, which generates an embedding and compares it against existing nodes of the same subtype using cosine similarity at 512 dims.

- **>= 0.95 cosine**: Near-duplicate — store is dropped entirely, agent gets feedback: `"Duplicate: already stored as '...' (n_xxx). Not created."`
- **0.90-0.95 cosine**: Similar — new node is created + `relates_to` edge auto-linked to the similar node
- **< 0.90 cosine**: Unique — new node created normally

Lesson and curiosity types bypass the memory queue to get real-time dedup feedback during agent thinking. Other types (episode, signal, watchpoint, trade) create unconditionally since each is a distinct point-in-time event.

**See:** `more-functionality.md` → MF-0 (DONE); `revisions/MF0/implementation-guide.md`

---

### ~~8. No Knowledge Evolution~~ RESOLVED

The `update_memory` tool now exists in `src/hynous/intelligence/tools/memory.py`. The agent can update titles, content (replace or append), summaries, and lifecycle states on existing nodes. JSON bodies (trades, watchpoints) are handled correctly — the `text` field is updated while preserving other JSON fields (signals, trigger).

The agent now has full CRUD: `store_memory` (create), `recall_memory` (search), `update_memory` (update), `delete_memory` (delete). Theses can accumulate evidence, predictions can be annotated with outcomes, and lessons can be refined — all while preserving node IDs, edges, and FSRS stability.

**See:** `nous-wiring-revisions.md` → NW-4 (FIXED); `more-functionality.md` → MF-4 (DONE)

---

### 9. Daemon-Side Integration Gaps

The daemon (`daemon.py`) runs 24/7 and is the natural home for periodic Nous maintenance tasks. Currently it only uses Nous for two things: listing active watchpoints and listing curiosity items. Several daemon-appropriate tasks have no implementation:

- ~~**Batch decay cycle** — should run every 6-12 hours to update FSRS retrievability across all nodes~~ → **FIXED: `_run_decay_cycle()` runs every 6h via daemon**
- ~~**Conflict queue polling** — should check for pending contradictions periodically and wake the agent to resolve them~~ → **FIXED: `_check_conflicts()` runs every 30 min via daemon**
- ~~**Health monitoring** — should verify Nous is up before each polling cycle~~ → **FIXED: `_check_health()` on startup + every hour via daemon (MF-8 DONE)**
- ~~**Embedding backfill** — should ensure all nodes have vector embeddings~~ → **FIXED: `_run_embedding_backfill()` runs every 12h via daemon (MF-9 DONE)**
- **Fading memory alerts** — should surface important memories transitioning from ACTIVE to WEAK so the agent can reinforce them

The `lifecycle_state` vs `state_lifecycle` field name mismatch (category 2) has been fixed (NW-1 DONE).

**See:** `more-functionality.md` → MF-2 (DONE), MF-3 (DONE), MF-8 (DONE), MF-9 (DONE); `nous-wiring-revisions.md` → NW-1 (FIXED)

---

## Fix Priority

| Order | Category | Impact |
|-------|----------|--------|
| 1st | Incorrectly wired (field name fix) | 5 minutes, stops infinite re-triggering |
| 2nd | Memory retrieval bottleneck | 30 minutes, unblocks the entire learning loop |
| ~~3rd~~ | ~~Node proliferation + knowledge evolution~~ | ~~FULLY RESOLVED. Knowledge evolution via update_memory (MF-4). Dedup via search-before-store (MF-0).~~ |
| 4th | Dead client methods → tools | 1-2 hours, enables contradiction handling + health monitoring |
| 5th | Missing functionality wiring | 2-3 hours, unlocks Nous's full potential |
| 6th | Daemon integration | 1-2 hours, enables proactive maintenance |
| 7th | Fire-and-forget reliability | 30 minutes, prevents silent memory loss |
| 8th | System prompt accuracy | 5 minutes, update after features are wired |

Categories 1 and 2 are quick fixes with outsized impact. Categories 3-5 are the bulk of the work. Categories 6-8 are polish.

---

## Trade Recall Failures — RESOLVED

All Nous wiring issues above are resolved. The trade-recall revision has also been completed — three bugs that prevented the agent from reliably finding, recalling, and reasoning about its own trades are now fixed. See **`../trade-recall/retrieval-issues.md`** for the root cause analysis and resolution details.
