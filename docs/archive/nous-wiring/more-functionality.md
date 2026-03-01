# Nous Functionality — Not Yet Wired to Hynous

> Every Nous capability that exists but is not connected to the Python intelligence layer. For each: what it does, how important it is, the impact on agent performance, and step-by-step implementation instructions.

## Architecture Reference

| Layer | Path | Role |
|---|---|---|
| Nous core library | `nous-server/core/src/` | All algorithms, types, specs |
| Nous HTTP server | `nous-server/server/src/` | REST API routes over core |
| Python HTTP client | `src/hynous/nous/client.py` | NousClient — all Python→Nous calls |
| Agent tools | `src/hynous/intelligence/tools/` | Tools the agent can call |
| Memory manager | `src/hynous/intelligence/memory_manager.py` | Auto-retrieval + compression |
| Daemon | `src/hynous/intelligence/daemon.py` | Background polling loop |
| Config | `config/default.yaml` | Runtime configuration |
| Tool registry | `src/hynous/intelligence/tools/registry.py` | Tool dataclass + registration |

**How tools are added (standard pattern):**
1. Define `TOOL_DEF` dict with name, description, JSON Schema parameters
2. Write a handler function that calls `NousClient` methods
3. Write a `register(registry)` function at the bottom of the file
4. Import and call `register()` from the tool loader

**How client methods are added:**
- Add a method to `NousClient` in `client.py` that calls the appropriate Nous endpoint
- All endpoints are prefixed with `/v1/` (e.g. `self._url("/decay")`)

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| **P0** | Core functionality that's actively broken or blocking the learning loop |
| **P1** | High-value capability that would significantly improve agent intelligence |
| **P2** | Useful feature that rounds out the system |
| **P3** | Nice-to-have, low urgency |

---

## ~~MF-0. [P1] Search-Before-Store — Deduplication and Consolidation~~ DONE

**Status:** Implemented and auditor-verified.

**What was done:**

1. **`POST /v1/nodes/check-similar` endpoint** — New Nous server route in `nodes.ts`. Generates an embedding for the incoming content, fetches candidates of the same subtype from DB, compares using `cosineSimilarity()` at 512 dims (Matryoshka truncation). Returns matches with actions: `duplicate` (>= 0.95 cosine), `connect` (0.90-0.95), or unique (< 0.90).

2. **`check_similar()` client method** — Added to `NousClient` in `client.py`. Calls `POST /v1/nodes/check-similar` with content, title, subtype, limit.

3. **Dedup gate in `_store_memory_impl()`** — Before `client.create_node()`, lesson and curiosity types call `check_similar()`. Duplicate matches drop the store entirely with feedback: `"Duplicate: already stored as '...' (n_xxx). Not created. (97% similar)"`. Connect-tier matches proceed with creation + `relates_to` edge linking.

4. **Queue bypass for dedup-eligible types** — In `handle_store_memory()`, lesson and curiosity types bypass the memory queue to get real-time dedup feedback during agent thinking.

5. **Connect-tier edge creation** — After creating a new node, any 0.90-0.95 similarity matches get `relates_to` edges automatically.

**Key thresholds (from `@nous/core/embeddings`):**
- `DEDUP_CHECK_THRESHOLD = 0.95` — cosine similarity for near-duplicate detection
- `SIMILARITY_EDGE_THRESHOLD = 0.90` — cosine similarity for auto-linking
- `COMPARISON_DIMS = 512` — Matryoshka dimension truncation for comparison speed

**Implementation guide:** `revisions/MF0/implementation-guide.md`

---

## ~~MF-1. [P1] Edge Strengthening (Hebbian Learning)~~ DONE

### What it is

Nous has a `POST /v1/edges/:id/strengthen` endpoint that implements Hebbian co-activation learning. When two memories are accessed together or prove useful together, the edge between them gets stronger (up to a cap of 1.0). Stronger edges mean SSA spreading activation flows more energy between those nodes, making them more likely to surface together in future searches.

### What was implemented

All 4 integration points from the spec are wired:

**1. `strengthen_edge()` client method** — `src/hynous/nous/client.py`
- `POST /v1/edges/:id/strengthen` with `{amount}` (default 0.05)
- Returns updated edge with new strength (capped at 1.0)

**2. Auto-strengthen on co-retrieval** — `src/hynous/intelligence/memory_manager.py`
- `_strengthen_co_retrieved()` helper: after SSA search returns multiple results, finds edges connecting pairs of co-retrieved nodes and strengthens them (amount=0.03)
- Called from `retrieve_context()` — runs in background thread
- Deduplication: each edge is strengthened at most once per search, even if seen from both ends
- Shared helper — also imported by `tools/memory.py`

**3. Strengthen on explicit recall** — `src/hynous/intelligence/tools/memory.py`
- `handle_recall_memory()` search mode calls `_strengthen_co_retrieved()` with amount=0.05
- Higher amount than auto-retrieval (0.05 vs 0.03) since the agent explicitly asked for these memories

**4. Strengthen trade lifecycle edges** — `src/hynous/intelligence/tools/trading.py`
- `_strengthen_trade_edge()`: when a trade closes and the entry node is found, strengthens the `part_of` edge between entry and close (amount=0.1)
- Called from `handle_close_position()` — runs in background thread
- Trade lifecycle edges get the highest strengthening amount because the close event confirms the connection is real

### Strengthening amounts

| Trigger | Amount | Rationale |
|---------|--------|-----------|
| Auto-retrieval (memory_manager) | 0.03 | Passive co-occurrence, low signal |
| Explicit recall (recall_memory) | 0.05 | Agent deliberately searched, moderate signal |
| Trade lifecycle close | 0.10 | Confirmed real-world connection, high signal |

### Design notes

- All strengthening runs in background threads — zero latency impact on agent responses
- Edge dedup: each edge is attempted at most once per search (tracked in a `strengthened` set)
- Error isolation: strengthening failures are caught and logged at DEBUG, never crash retrieval or tools
- The system prompt already claimed "Recalling strengthens memories" and "connections strengthen both" — this wiring makes those claims true

---

## ~~MF-2. [P1] Batch Decay Cycle via Daemon~~ DONE

**Status:** Implemented.

**What was done:**

1. **`run_decay()`** added to `NousClient` in `client.py` — calls `POST /v1/decay`, returns `{ok, processed, transitions_count, transitions}`
2. **`decay_interval: int = 21600`** added to `DaemonConfig` in `config.py` and `config/default.yaml` (6 hours)
3. **`_run_decay_cycle()`** added to daemon in `daemon.py`:
   - Calls `nous.run_decay()`
   - Logs each transition individually: `"Decay transition: n_abc — ACTIVE → WEAK"`
   - Logs `DaemonEvent("decay", ...)` when transitions occur
   - Increments `self.decay_cycles_run` counter
   - Silent on no-op cycles (debug log)
4. **Main loop step 6** — checks `decay_interval` timer, calls `_run_decay_cycle()`
5. Start log updated to include decay interval

**Fading memory alerts — IMPLEMENTED (2026-02-21):**

The optional enhancement has been built. When the decay cycle detects transitions from ACTIVE→WEAK for important memory subtypes (`custom:lesson`, `custom:thesis`, `custom:playbook`), the daemon wakes the agent to review and reinforce them. Signals and episodes decay silently — by design.

5. **`_FADING_ALERT_SUBTYPES`** — module-level constant: `frozenset({"custom:lesson", "custom:thesis", "custom:playbook"})`
6. **`_fading_alerted: dict[str, float]`** — in-memory 24h per-node cooldown dict (prevents re-alerting same WEAK node every 6h cycle). 48h GC to bound size.
7. **`_check_fading_transitions(transitions, nous)`** — filters ACTIVE→WEAK transitions, fetches full node for each candidate, checks subtype against `_FADING_ALERT_SUBTYPES`, calls `_wake_for_fading_memories()` if any qualify.
8. **`_wake_for_fading_memories(nodes)`** — formats wake message with node title, subtype label, retrievability %, and 400-char body preview. Calls `_wake_agent(message, max_tokens=1024, source="daemon:memory_fading")`.
9. **`builder.py` updated** — TOOL_STRATEGY memory section and "How My Memory Works" paragraph both reference fading alerts so the agent understands why it's being woken and what to do (recall to reinforce, update to revise, archive if stale).

**`_run_decay_cycle()` runs in a background thread** (`hynous-decay`) — non-blocking, does not stall `_fast_trigger_check()` (SL/TP guard runs every 10s).

---

## ~~MF-3. [P1] Contradiction Queue Polling + Resolution~~ DONE

**Status:** Implemented.

**What was done:**

1. **Agent tool** — Created `src/hynous/intelligence/tools/conflicts.py` with `manage_conflicts` tool:
   - `list` action: calls `client.get_conflicts(status)`, formats with old node title, new content preview (200 chars), conflict type, confidence, dates. Supports `status` filter (pending/resolved).
   - `resolve` action: calls `client.resolve_conflict(conflict_id, resolution)` with 4 strategies.
   - Blocking tool, 16th module in registry.

2. **Daemon cron task** — `_check_conflicts()` in `daemon.py`:
   - Polls `nous.get_conflicts(status="pending")` every `conflict_check_interval` seconds (default 1800 = 30 min).
   - **Tier 1 auto-resolve triage (5 rules, zero agent cost):**
     1. Expired (>14 days) → `keep_both`
     2. Low confidence (<0.40) → `keep_both`
     3. Explicit self-correction markers ("i was wrong", "correction:") + conf>0.50 → `new_is_current`
     4. Explicit update markers ("update:", "revised:") + conf>0.50 → `new_is_current`
     5. Same subtype + same entity → `new_is_current`
   - All auto-decisions are batched into a single `batch_resolve_conflicts()` call.
   - **Tier 2:** Remaining conflicts (no rule fired) → agent woken with up to 5 summaries + `manage_conflicts` instruction.
   - Runs in background thread (`hynous-conflicts`) — non-blocking.
   - Config: `DaemonConfig.conflict_check_interval`, `config/default.yaml`, step 7 in main loop.

3. **Inline flag check** — In `_store_memory_impl()` in `memory.py`:
   - Checks `node.get("_contradiction_detected")` after `client.create_node()`.
   - Appends warning to return message directing agent to `manage_conflicts(action="list")`.
   - Since `store_memory` is now synchronous (NW-10), agent always sees the warning.

4. **System prompt** — No changes needed. The claim in `prompts/builder.py` about contradiction detection is now true.

**Previously dead client methods now called:** `get_conflicts()`, `resolve_conflict()`, `batch_resolve_conflicts()`. `detect_contradiction()` is still not called from Python (Nous runs Tier 2 automatically on node creation).

---

## ~~MF-4. [P2] Node Update Tool — Mutable Memories~~ DONE

**Status:** Implemented.

**What was done:**

Added `update_memory` tool in `src/hynous/intelligence/tools/memory.py` (lines 518-652):

- `UPDATE_TOOL_DEF` with parameters: `node_id` (required), `title`, `content`, `summary`, `append_text`, `lifecycle` (all optional)
- `handle_update_memory()` handler with field name mapping (`title` → `content_title`, `content` → `content_body`, `summary` → `content_summary`, `lifecycle` → `state_lifecycle`)
- JSON-aware append: for trade/watchpoint bodies (JSON with `text` key), parses JSON, appends to `text` field, preserves other fields (signals, trigger), re-serializes
- Plain text append: concatenates with `\n\n---\n\n` separator
- Malformed JSON fallback: treats as plain text
- Validation: rejects empty updates, rejects simultaneous replace + append, verifies node exists
- Registered as blocking (not background) — agent sees confirmation

The agent now has full CRUD: `store_memory` (create), `recall_memory` (search), `update_memory` (update), `delete_memory` (delete). This is a prerequisite for MF-0 (search-before-store / deduplication).

---

## ~~MF-5. [P2] Graph Traversal — Explore Connected Memories~~ DONE

**Status:** Implemented.

**What was done:**

Created `src/hynous/intelligence/tools/explore_memory.py` as a dedicated tool module with 3 actions:

1. **`explore`** — 1-hop graph neighborhood display:
   - Fetches starting node title/type via `client.get_node(node_id)`
   - Fetches edges via `client.get_edges(node_id, direction)` with direction filter (`in`, `out`, `both`)
   - Resolves connected node titles via `client.get_node(connected_id)` for each edge
   - Formats with direction arrows, edge type, node type, title, strength, and edge ID
   - Strips `custom:` prefix from subtypes

2. **`link`** — Manual edge creation:
   - `client.create_edge(source_id, target_id, type)` with 5 edge types: `relates_to`, `part_of`, `causes`, `supports`, `contradicts`

3. **`unlink`** — Edge removal:
   - `client.delete_edge(edge_id)` by edge ID from explore output

Registered as blocking tool. 15th module in `registry.py`.

**Remaining optional enhancement:** Multi-hop traversal (`depth > 1`). Current implementation covers 1-hop only, which handles the primary use case. Multi-hop would enable following full trade lifecycle chains in a single call.

---

## ~~MF-6. [P2] Browsable Memory Inventory via `list_nodes()`~~ DONE

**Status:** Implemented.

**What was done:**

Added `browse` mode to the existing `recall_memory` tool in `memory.py`:

- New `mode` parameter: `"search"` (default) or `"browse"`
- `query` removed from `required` — now validated in handler (required for search only)
- Browse mode calls `client.list_nodes(type, subtype, lifecycle, limit)` — no search query needed
- Shared `_format_memory_results()` helper formats results identically for both modes
- Non-ACTIVE nodes show lifecycle tags (`[WEAK]`, `[DORMANT]`)
- Empty result messages include applied filters for clarity
- Fully backward compatible — existing `recall_memory(query="X")` calls work unchanged

---

## ~~MF-7. [P2] Time-Range Search~~ DONE

**Status:** Implemented.

**What was done:**

Added three new parameters to `recall_memory` tool in `src/hynous/intelligence/tools/memory.py`:

- `time_start` (optional, string) — ISO date/datetime, only return memories after this time
- `time_end` (optional, string) — ISO date/datetime, only return memories before this time
- `time_type` (optional, enum `["event", "ingestion", "any"]`, default `"any"`) — which timestamp to filter on

In `handle_recall_memory()`, when either `time_start` or `time_end` is provided, a `time_range` dict is built and passed through to `client.search()` which already supported the parameter. Search mode only — browse mode is unaffected.

The agent can now:
- `{"query": "BTC", "time_start": "2026-01-01", "time_end": "2026-01-31"}` — BTC memories from January
- `{"query": "trade entry", "time_start": "2026-02-01", "time_type": "event"}` — trades since Feb 1st
- Scope post-trade reviews to memories between entry and close dates
- Focus periodic reviews on "what happened since last review"

`NousClient.search()` in `client.py` already accepted `time_range` — no client changes needed.

---

## ~~MF-8. [P2] Health Check for Reliability Monitoring~~ DONE

**Status:** Implemented.

**What was done:**

1. **Config:** Added `health_check_interval: int = 3600` (1 hour) to `DaemonConfig` in `config.py` + `config/default.yaml`.

2. **Startup health check:** At the start of `_loop()`, `_check_health(startup=True)` calls `nous.health()` and logs a clear pass/fail with node/edge counts and lifecycle distribution. If Nous is unreachable, logs a warning.

3. **Periodic health check:** Step 8 in the daemon main loop calls `_check_health()` every `health_check_interval` seconds (default 1 hour). Logs node/edge counts and lifecycle stats each cycle.

4. **Health state tracking:** `self._nous_healthy` flag tracks whether Nous is reachable. Transitions from healthy→unhealthy log a warning + `DaemonEvent("health", ...)`. Sustained failures log only at debug level to avoid log spam.

5. **Stats:** `self.health_checks` counter tracks completed checks.

`NousClient.health()` already existed in `client.py` — no client changes needed.

**Remaining optional enhancement:** A `system_status` agent tool that lets the agent check its own memory system stats (node/edge counts, lifecycle distribution, pending conflicts). Low priority — the daemon-side monitoring covers the reliability need.

---

## ~~MF-9. [P2] Embedding Backfill~~ DONE

**Status:** Implemented.

**What was done:**

1. **`backfill_embeddings()`** added to `NousClient` in `client.py` — calls `POST /v1/nodes/backfill-embeddings`, returns `{ok, embedded, total}`
2. **`embedding_backfill_interval: int = 43200`** added to `DaemonConfig` in `config.py` and `config/default.yaml` (12 hours)
3. **`_run_embedding_backfill()`** added to daemon in `daemon.py`:
   - Calls `nous.backfill_embeddings()`
   - Logs count when nodes are embedded: `"Embedding backfill: 3/3 nodes embedded"`
   - Logs `DaemonEvent("backfill", ...)` when embeddings are generated
   - Increments `self.embedding_backfills` counter
   - Silent on no-op cycles (debug log: "all nodes have embeddings")
4. **Main loop step 9** — checks `embedding_backfill_interval` timer, calls `_run_embedding_backfill()`
5. Start log updated to include backfill interval

---

## ~~MF-10. [P2] QCS Pre-Classification for Smarter Retrieval~~ DONE

### What it is

Nous has a Query Classification System (QCS) that categorizes queries into types before search:
- **LOOKUP** queries (specific entity/attribute seeking) — skip embeddings, use BM25 only (~10ms)
- **AMBIGUOUS** queries (conceptual, reasoning) — use full SSA with embeddings (~1-2s)
- **Disqualified** queries (6 categories: reasoning, negation, time references, compound, unresolved references, exploration) — always use full SSA

~~`NousClient.classify_query()` exists but is never called. The classification already happens internally within the `/search` endpoint, but the Python side has no visibility into it.~~ → **FIXED: QCS metadata from the `/search` response is now logged at DEBUG level inside `NousClient.search()`.**

### What was implemented

QCS metadata logging was added directly inside `NousClient.search()` in `client.py`. After the HTTP response, the `qcs` field is extracted and logged at DEBUG level. This captures all 6 search callers (memory_manager auto-retrieval, recall_memory, auto-link, wikilink resolution, trade entry lookup) without any API changes.

Log format:
- Normal queries: `QCS: query='BTC funding' → LOOKUP, embeddings=False`
- Disqualified queries: `QCS: query='what would happen if...' → AMBIGUOUS (disqualified: reasoning), embeddings=True`
- Missing QCS (backward compat): no log, no crash

The `classify_query()` client method remains unused — QCS runs server-side within search, so a separate pre-classification call is unnecessary. The existing `_is_trivial()` check in `memory_manager.py` already handles trivial message filtering.

### Changes made

1. `src/hynous/nous/client.py` — `search()` method now parses full response JSON, extracts `qcs` field, logs query_type + used_embeddings + disqualified status at DEBUG level. Return type unchanged (`list[dict]`).

### Not implemented (by design)

- **Pre-filter via `classify_query()`**: Skipped — `_is_trivial()` already handles this, and the extra HTTP round-trip per search is not worth the marginal improvement.
- **`classify_query()` client method**: Remains available but unused. No callers needed.

---

## ~~MF-11. [P3] Working Memory Trial Periods~~ SKIPPED

**Status:** Skipped — overlapping functionality already covered by existing systems.

**Why skipped:** The core working memory module exists in `@nous/core` with 95 passing tests, but wiring it adds complexity for marginal benefit given what's already in place:

1. **FSRS decay (MF-2)** already handles lifecycle transitions (ACTIVE → WEAK → DORMANT) on a 6-hour batch cycle. Memories that aren't accessed naturally fade — this IS the trial period, just implemented at the FSRS level rather than a separate working memory layer.

2. **MF-0 dedup** prevents the main source of low-value node proliferation (duplicate lessons/curiosity items). The knowledge base no longer grows unchecked.

3. **Hebbian strengthening (MF-1)** already rewards memories that prove useful — co-retrieved memories get their edges strengthened, making them more likely to surface again. This is the "promotion" signal, just expressed through edge weights rather than a promotion score.

4. **The agent's own judgment** acts as the quality gate. The agent decides what to store, and the system prompt guides it toward high-value content. Adding a trial period on top of the agent's curation adds a second layer of filtering that's largely redundant.

The core module remains available if needed in the future (e.g., if the knowledge base grows to thousands of nodes and passive curation becomes insufficient).

---

## ~~MF-12. [P3] Advanced Contradiction Tiers (3-5)~~ DONE

**Status:** Implemented and auditor-verified. Scoped down from "add LLM tiers" to "fix the resolution execution gap" — the agent's own reasoning already serves as Tier 3.

**What was done:**

1. **Fixed `POST /contradiction/resolve`** — The endpoint previously just marked `status = 'resolved'` without executing anything. Now it actually executes the 4 resolution strategies:
   - `new_is_current`: Old node → DORMANT + `supersedes` edge (new → old)
   - `old_is_current`: New node → DORMANT + `supersedes` edge (old → new)
   - `keep_both`: `relates_to` edge between both nodes
   - `merge`: Append new content to old node body + delete new node

2. **DB migration** — Added `resolution TEXT` and `resolved_at TEXT` columns to `conflict_queue` via `safeAddColumn` in `db.ts`.

3. **Improved conflict listing** — Both the Python tool (`conflicts.py`) and daemon wake (`daemon.py`) now fetch and display full content of both old and new nodes, so the agent can make informed resolution decisions without extra tool calls.

4. **Resolution outcome feedback** — The resolve action now shows the agent exactly what happened (which nodes were updated, which edges were created).

**Key design decisions:**
- Supersedes edge direction: source supersedes target (new → old means "new replaces old")
- Edge weights: `neural_weight: 0.5`, `strength: 0.5`, `confidence: 1.0` — matches `EDGE_TYPE_WEIGHTS` in core-bridge
- Null safety: All branches check `if (newNodeId)` since `new_node_id` is nullable in `conflict_queue`
- Merge appends (not replaces): old body + separator + new content. FTS trigger fires on body update. CASCADE deletes orphan edges on new node deletion.
- No LLM tiers added — the agent's own reasoning when reviewing conflicts IS the Tier 3 analysis

**Implementation guide:** `revisions/MF12/implementation-guide.md`

---

## ~~MF-13. [P3] Cluster Management~~ DONE

**Status:** Implemented. Full CRUD + membership + cluster-scoped search + health + auto-assign. Server routes in `nous-server/server/src/routes/clusters.ts` (9 endpoints). Python client methods in `client.py` (9 methods). Agent tool `manage_clusters` in `tools/clusters.py` (8 actions: list, create, update, delete, add, remove, members, health). Store/recall integration: optional `cluster` param on `store_memory`, `cluster` filter on `recall_memory` search mode. Auto-assignment: clusters with `auto_subtypes` auto-assign matching memories on store. Node deletion cleans up memberships.

### What it is

Nous core has a full cluster management system (`core/src/clusters/`) for organizing memories into groups. Clusters support:
- Seeded emergence from templates (STUDENT, PROFESSIONAL, CREATIVE)
- Evolution triggers based on node frequency, temporal proximity, edge density
- Health monitoring (min 3 members, max 100)
- Per-cluster decay modifiers (0.7x-1.2x)
- Retrieval scoping (search within specific clusters)

No server routes exist for clusters.

### Impact on agent performance

For a crypto trading agent, clusters could organize memories by:
- Asset (BTC cluster, ETH cluster, SOL cluster)
- Strategy type (momentum, mean-reversion, funding arbitrage)
- Market regime (bull market learnings, bear market learnings, ranging)
- Time period (January analysis, Q1 review)

This would let the agent scope searches: "Search only within my BTC cluster" or "What have I learned about momentum strategies?"

However, this is a large feature and the agent currently only trades a few assets. The benefit increases with knowledge base size.

### What needs to be implemented

This requires both new server routes and Python integration. It's Phase 3 work — do it after the core wiring issues and Phase 2 features are complete.

---

## ~~MF-14. [P3] Edge Decay and Pruning~~ SKIPPED

### What it is

Nous core has edge lifecycle management:
- `decayEdge(edge, decayRate)` — reduces edge strength over time
- `shouldPruneEdge(edge, maxAgeDays, threshold)` — determines if an edge should be removed
- `reactivateEdge(edge)` — resets decay factor to 1.0

Auto-generated edges (from auto-linking and wikilinks) can become stale over time. An edge between "BTC thesis Jan 2026" and a general market observation might have been relevant when created but isn't useful 6 months later.

### Impact on agent performance

Without edge decay:
- The graph accumulates stale connections that dilute SSA spreading
- Old auto-generated `relates_to` edges with strength 0.50 never weaken
- The graph gets noisier over time as more auto-links accumulate

This is low priority because the current graph is small and edge noise isn't yet a problem. But as the knowledge base grows past hundreds of nodes, edge pruning becomes important for search quality.

### What needs to be implemented

**1. Add server routes** for edge decay (new endpoint or extend `POST /edges/:id` with decay action)
**2. Add a daemon task** that periodically decays edges that haven't been co-activated recently
**3. Add pruning** for edges below a strength threshold (e.g. 0.1)

This is Phase 3 work.

### Decision: SKIPPED

Skipped: Hebbian strengthening (MF-1) already provides signal discrimination — useful edges get stronger through co-activation, pushing stale ones down naturally. Trading knowledge doesn't go stale like general knowledge (a thesis about funding rate mechanics is still valid months later). The graph will stay small enough (hundreds, not millions of nodes) that edge noise won't meaningfully degrade SSA results.

---

## ~~MF-15. [P3] Gate Filter for Memory Quality~~ DONE

### What it is

Nous core has a gate filter system (`core/src/gate-filter/`) with 8 rejection rules that evaluate content quality before storage:
- R-001: Too short (< 3 chars)
- R-002: Gibberish (high entropy, no real words)
- R-003: Spam patterns
- R-004: Repeated characters
- R-005: Pure filler words (um, uh, like, basically)
- R-006: Empty semantic content (only emoji/punctuation)
- R-007: All caps
- R-008: Social-only content (greetings, thanks)

Decisions: BYPASS (always accept), PASS (accept), REJECT (discard from memory), PROMPT (ask for confirmation).

### Impact on agent performance

Without gate filtering:
- The agent can store trivial memories that clutter the knowledge base
- Turn summaries of "Hello" / "Hi, how are you?" conversations become permanent nodes
- SSA searches through noise

With gate filtering:
- Low-quality content is filtered before Nous storage
- The knowledge base stays clean and searchable
- Compression summaries marked TRIVIAL by Haiku already implement a crude version of this

### What needs to be implemented

**1. Add gate filter to `store_memory`** in `memory.py`:

Before calling `client.create_node()`, run the content through gate filter logic. This can be a Python port of the core rules (they're simple regex/string checks) or a new server route.

The simplest approach: port the 4 most impactful rules (R-001 too short, R-002 gibberish, R-005 filler, R-008 social-only) as Python functions. If content fails, return a warning to the agent instead of storing.

This is Phase 3 — the Haiku compression already filters trivial exchanges, and the agent's own judgment usually prevents storing junk.

### Implementation (DONE)

Python port of 6 core rules (R-001 through R-006, R-008; R-007 skipped for crypto context). Gate runs in `_store_memory_impl()` before dedup check — all memory types gated. Binary PASS/REJECT, no PROMPT. Config toggle: `memory.gate_filter_enabled` (default True). R-001 threshold raised to 10 chars (from TypeScript's 3) for more useful filtering.

Module: `src/hynous/intelligence/gate_filter.py`
Tests: `tests/unit/test_gate_filter.py`, `tests/integration/test_gate_filter_integration.py`

---

## Implementation Order

For maximum value with minimum effort, implement in this order:

| Phase | Item | Effort | Impact |
|-------|------|--------|--------|
| ~~**Phase 1**~~ | ~~MF-0 (Search-before-store / dedup)~~ | ~~DONE~~ | ~~Stops knowledge base bloat, enables consolidation~~ |
| ~~**Phase 1**~~ | ~~MF-2 (Decay via daemon)~~ | ~~DONE~~ | ~~Enables proactive FSRS lifecycle~~ |
| ~~**Phase 1**~~ | ~~MF-3 (Contradiction queue)~~ | ~~DONE~~ | ~~Enables knowledge consistency~~ |
| ~~**Phase 1**~~ | ~~MF-1 (Edge strengthening)~~ | ~~DONE~~ | ~~Makes the graph adaptive~~ |
| ~~**Phase 1**~~ | ~~MF-4 (Update tool)~~ | ~~DONE~~ | ~~Enables memory evolution (prerequisite for MF-0)~~ |
| ~~**Phase 1**~~ | ~~MF-5 (Graph traversal)~~ | ~~DONE~~ | ~~Enables memory exploration~~ |
| ~~**Phase 1**~~ | ~~MF-6 (Browse by type)~~ | ~~DONE~~ | ~~Enables inventory browsing~~ |
| ~~**Phase 1**~~ | ~~MF-7 (Time-range search)~~ | ~~DONE~~ | ~~Enables temporal queries~~ |
| ~~**Phase 1**~~ | ~~MF-8 (Health check)~~ | ~~DONE~~ | ~~Enables reliability monitoring~~ |
| ~~**Phase 1**~~ | ~~MF-9 (Embedding backfill)~~ | ~~DONE~~ | ~~Ensures search completeness~~ |
| ~~**Phase 2**~~ | ~~MF-10 (QCS pre-classification)~~ | ~~DONE~~ | ~~Optimizes retrieval~~ |
| ~~**Phase 2**~~ | ~~MF-12 (Advanced contradiction)~~ | ~~DONE~~ | ~~Resolution execution gap fixed — agent decisions now execute~~ |
| ~~**Phase 2**~~ | ~~MF-11 (Working memory)~~ | ~~SKIPPED~~ | ~~Overlaps with FSRS decay (MF-2), dedup (MF-0), and Hebbian strengthening (MF-1)~~ |
| ~~**Phase 3**~~ | ~~MF-13 (Clusters)~~ | ~~DONE~~ | ~~Scoped knowledge organization~~ |
| ~~**Phase 3**~~ | ~~MF-14 (Edge decay)~~ | ~~SKIPPED~~ | ~~Hebbian strengthening already provides signal discrimination~~ |
| ~~**Phase 3**~~ | ~~MF-15 (Gate filter)~~ | ~~DONE~~ | ~~Pre-storage quality gate — 6 rules, Python port~~ |

**Note:** MF-4 (update tool) should be implemented before MF-0 (search-before-store), since dedup/consolidation needs the ability to update existing nodes.

Phase 1 items can all be done independently and in any order (except the MF-4 → MF-0 dependency). They collectively transform the agent from a basic create+search memory user into a system that actively maintains, strengthens, and curates its own knowledge graph.
