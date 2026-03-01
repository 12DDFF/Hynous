# MF-0: Search-Before-Store Deduplication — Solved

> Summary of the issue, what was done, considerations made, and impact on the system.

---

## The Issue

**Original priority:** P1

Every `store_memory` call unconditionally created a new node in Nous. There was zero logic to check whether a similar or identical memory already existed. The storage path in `_store_memory_impl()` went straight to `client.create_node()` without any search or comparison.

**Concrete example:** If the agent learned "never trade during low-volume weekends" three times across separate sessions, that produced three separate nodes — each with their own FSRS stability schedule, edges, and embeddings. On recall, SSA returned all three, wasting the retrieval budget on redundant information and diluting search quality.

Nous core already had all the deduplication infrastructure (`checkSimilarity()`, `DEDUP_CHECK_THRESHOLD`, `cosineSimilarity()`, Matryoshka 512-dim comparison) built and tested (112 passing tests in `core/src/embeddings/`), but none of it was wired to the Python intelligence layer.

---

## Key Considerations

### 1. Which memory types should be deduplicated?

Only **lesson** and **curiosity** — these are the fungible types where the same insight can be rephrased. All other types were deliberately excluded:

- **Thesis**: Evolution trail is valuable. Multiple thesis nodes show how the agent's thinking developed over time.
- **Signal/Episode**: Point-in-time snapshots, unique by definition.
- **Trade types**: Each trade record is unique (different entry/exit/parameters).
- **Watchpoint**: Each has unique trigger conditions.
- **Turn/session summaries**: Auto-generated, not user-facing.

### 2. Why not use existing SSA search for dedup?

SSA search (`POST /v1/search`) returns a 6-signal composite score (semantic 0.30, keyword 0.15, graph 0.20, recency 0.15, authority 0.10, affinity 0.10). For dedup, we need **pure semantic similarity** — the other 5 signals actively distort the comparison. A lesson from 2 months ago identical to the new content could score lower than a different lesson from yesterday because recency and affinity boost the newer one. Additionally, QCS might classify short queries as LOOKUP and disable embeddings entirely, making the semantic score 0.

**Decision:** New dedicated endpoint using brute-force cosine similarity at 512 dims (Matryoshka). Candidate set is small (10-50 lessons), comparison takes ~0.5ms total — negligible vs the ~100ms embedding API call.

### 3. Three-tier response system

| Cosine Similarity | Tier | Action |
|---|---|---|
| >= 0.95 (`DEDUP_CHECK_THRESHOLD`) | Duplicate | Drop the new node entirely. Return existing node's ID, title, lifecycle. |
| 0.90-0.95 (`SIMILARITY_EDGE_THRESHOLD`) | Connect | Create the new node. Create `relates_to` edges to similar nodes. |
| < 0.90 | Unique | Create the new node normally. |

The 0.95 threshold is not arbitrary — it's the canonical dedup threshold from `@nous/core/embeddings`, validated in the core test suite.

### 4. Queue bypass for real-time feedback

Lesson and curiosity stores bypass the memory queue (`_queue_mode`) and always execute directly. This ensures the agent gets real-time dedup feedback ("Stored" or "Duplicate: already stored as...") instead of a blind "Queued" confirmation that can't be corrected later. All other types continue to use the queue as normal.

### 5. Graceful degradation

If the dedup check fails (Nous down, embedding generation fails, network timeout), the system falls back to creating the node normally. **A duplicate is better than a lost memory.** Dedup is an optimization, not a safety gate.

### 6. Double-embed cost accepted

The check-similar endpoint generates an embedding for comparison, then node creation generates another for storage. This is ~$0.000008 per store (OpenAI text-embedding-3-small). At 5-10 lessons/day, that's $0.00004-0.00008/day. The complexity of shuttling embeddings between calls is not worth the savings.

---

## What Was Implemented

### 1. New Nous endpoint — `POST /v1/nodes/check-similar`

**File:** `nous-server/server/src/routes/nodes.ts`

Generates an embedding for incoming content using the same pipeline as node creation (`buildNodeText()`, `buildContextPrefix()`, `embedTexts()`). Fetches candidates of the same subtype from DB, compares using `cosineSimilarity()` at 512 dims. Returns matches with tiered actions.

### 2. Python client method — `check_similar()`

**File:** `src/hynous/nous/client.py`

New method on `NousClient` that calls the endpoint. Returns `{matches, recommendation}`. Follows the same `_session.post()` + `raise_for_status()` pattern as all other client methods.

### 3. Dedup gate in `_store_memory_impl()`

**File:** `src/hynous/intelligence/tools/memory.py`

Before `client.create_node()`, lesson and curiosity types call `check_similar()`. Duplicate matches (>= 0.95) drop the store entirely with feedback including the existing node's ID, title, lifecycle, and similarity percentage. Connect-tier matches (0.90-0.95) proceed with creation + `relates_to` edge linking.

### 4. Queue bypass

**File:** `src/hynous/intelligence/tools/memory.py`

Single line change: `if _queue_mode:` became `if _queue_mode and memory_type not in ("lesson", "curiosity"):`.

### 5. Connect-tier edge creation

**File:** `src/hynous/intelligence/tools/memory.py`

After creating a new node, any 0.90-0.95 similarity matches get `relates_to` edges automatically. These are in addition to `_auto_link()` which still runs (title-based vs embedding-based — complementary).

### 6. Tool description update

**File:** `src/hynous/intelligence/tools/memory.py`

`STORE_TOOL_DEF` description updated so the agent knows about dedup behavior and understands "Duplicate" responses.

---

## Audit Findings & Fixes

The auditor found 4 issues during code review:

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| 1 | **P1** | Connect-tier edges duplicate auto_link edges — both could create `relates_to` to the same target, and Nous has no `(source, target, type)` uniqueness constraint | **Fixed** — Connect-tier match IDs are now merged into the `all_skip` list passed to `_auto_link(explicit_ids=...)`, preventing double-linking |
| 2 | **P2** | `matches[0]` access unguarded — if server returned `duplicate_found` with empty matches array, would IndexError | **Fixed** — Condition changed to `if recommendation == "duplicate_found" and matches:` |
| 3 | **P3** | Double `get_client()` calls in `_store_memory_impl()` — dedup path and create path each called it separately | **Fixed** — Single `client = get_client()` at function top, used by both paths |
| 4 | **P3** | Dedup latency (~300-500ms) not configurable or logged | **Skipped** — Negligible at current volume. Can add config flag later if needed |

---

## E2E Test Results

All tests pass. Environment: Nous server on localhost:3100 (tsx dev), OpenAI embeddings enabled, Python 3.11.

### Server-Side (6 tests)

| Test | Result |
|------|--------|
| Near-duplicate detection (~93.8% similar) | **PASS** — `similar_found` + connect action |
| Exact duplicate detection | **PASS** — `duplicate_found` |
| Unique content (unrelated topic) | **PASS** — `unique` + empty matches |
| Cross-subtype isolation (same content, different subtype) | **PASS** — no cross-subtype matching |
| Missing required fields | **PASS** — 400 validation error |
| Connect-tier threshold (92.5% similarity) | **PASS** — `similar_found` + connect action |

### Python Client (3 tests)

| Test | Result |
|------|--------|
| Duplicate returns correct structure | **PASS** |
| Unique returns correct structure | **PASS** |
| Connect-tier returns correct structure | **PASS** |

### Full Store Flow (6 tests)

| Test | Result |
|------|--------|
| Duplicate blocked (near-identical lesson) | **PASS** — node count unchanged |
| Unique created (unrelated lesson) | **PASS** — node created, 0 extra edges |
| Connect-tier edge created (92.5% similar) | **PASS** — `relates_to` edge created |
| No duplicate edges (Issue 1 fix verified) | **PASS** — auto_link skipped connect-tier target, exactly 1 edge |
| Duplicate of duplicate blocked | **PASS** — second identical store blocked |
| Graceful degradation (check_similar raises) | **PASS** — node created normally, warning logged |

---

## Impact on the System

### Immediate

- **Stops knowledge base bloat** for the two most commonly duplicated memory types (lessons and curiosity items). The agent can no longer accidentally store the same insight 3-5 times across sessions.
- **Dedup feedback loop** — the agent sees "Duplicate: already stored as '...' (n_xxx)" with the existing node's lifecycle state, enabling it to call `update_memory` to reactivate a DORMANT duplicate instead of creating a new one.
- **Connect-tier linking** — similar-but-not-duplicate lessons (0.90-0.95 cosine) get automatically linked via `relates_to` edges, strengthening the knowledge graph without manual effort.

### Long-term

- **Search quality improves** — SSA no longer wastes retrieval budget ranking 3 copies of the same lesson. More unique, relevant memories surface in the limited retrieval window.
- **FSRS lifecycle simplifies** — one node per insight means one stability schedule to maintain, not three divergent ones that may decay at different rates.
- **Foundation for future consolidation** — the `check-similar` endpoint can be extended for other dedup scenarios (e.g., checking if a thesis is too similar to an existing one before creating it).

---

## Files Changed

| File | Change |
|------|--------|
| `nous-server/server/src/routes/nodes.ts` | New `POST /nodes/check-similar` route (~90 lines) + import from `@nous/core/embeddings` |
| `src/hynous/nous/client.py` | New `check_similar()` method (~20 lines) |
| `src/hynous/intelligence/tools/memory.py` | Dedup gate (~40 lines), connect-tier edges (~10 lines), queue bypass (1 line), tool description (4 lines) |

**Implementation guide:** `revisions/MF0/implementation-guide.md`
**Audit notes:** `revisions/MF0/audit-notes.md`
