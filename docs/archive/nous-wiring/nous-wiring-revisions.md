# Nous Wiring Revisions

> Issues in the integration layer between **Nous** (TypeScript memory server on `:3100`) and the **Python intelligence stack** (agent, daemon, tools). Nous itself is working correctly in all cases — these are problems in how the Python side talks to it.

## Architecture Context

The Python side communicates with Nous through a single HTTP client at `src/hynous/nous/client.py` (`NousClient` class). This client wraps REST calls to the Nous server at `nous-server/server/src/routes/`. The agent's tools (`src/hynous/intelligence/tools/`) and daemon (`src/hynous/intelligence/daemon.py`) use this client to create, read, update, and search nodes/edges.

**Key file map:**

| Layer | File | Role |
|---|---|---|
| Python HTTP client | `src/hynous/nous/client.py` | All Nous HTTP calls go through here |
| Agent tools | `src/hynous/intelligence/tools/memory.py` | `store_memory`, `recall_memory` tools |
| Agent tools | `src/hynous/intelligence/tools/trading.py` | Trade execution, stores trade memories |
| Agent tools | `src/hynous/intelligence/tools/watchpoints.py` | Watchpoint CRUD |
| Auto-retrieval | `src/hynous/intelligence/memory_manager.py` | Searches Nous before each prompt, formats results |
| Background daemon | `src/hynous/intelligence/daemon.py` | Polls market data, evaluates watchpoints, wakes agent |
| Nous PATCH endpoint | `nous-server/server/src/routes/nodes.ts` (line 197) | Accepts updates with `allowedFields` whitelist |
| Nous search | `nous-server/server/src/routes/search.ts` | SSA-powered search, returns full node objects |
| Nous decay | `nous-server/server/src/routes/decay.ts` | Batch FSRS decay computation |
| Nous contradiction | `nous-server/server/src/routes/contradiction.ts` | Conflict detection + queue |

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| **P0** | Actively breaking core functionality. Fix first. |
| **P1** | Significant degradation to agent memory/learning. Fix soon. |
| **P2** | Unused Nous capabilities or missing integration. Fix when able. |
| **P3** | Minor display/UX issues in Nous data reads. Fix opportunistically. |

---

## NW-1. ~~[P0] Field name mismatch: Python sends `lifecycle_state`, Nous expects `state_lifecycle`~~ FIXED

**Status:** Resolved.

**What was fixed:**

All three `daemon.py` call sites now use the correct field name `state_lifecycle`:

- Line 454: `nous.update_node(wp["id"], state_lifecycle="DORMANT")` — expiring watchpoints
- Line 466: `nous.update_node(wp["id"], state_lifecycle="DORMANT")` — firing watchpoints
- Line 939: `nous.update_node(item["id"], state_lifecycle="WEAK")` — marking curiosity items addressed

The read-side mismatch in `watchpoints.py` was also fixed (see NW-7).

**Remaining concern:** The bare `except Exception: pass` blocks in `daemon.py` still swallow all errors silently. If a future update introduces a different field name issue, it will again fail silently. Consider adding at least `logger.warning()` in these exception handlers.

---

## NW-2. ~~[P0] Retrieval formatting strips `content_body` — agent only sees `content_summary`~~ FIXED

**Status:** Resolved.

**What was fixed:**

Both formatting functions now use `content_body` as primary and `content_summary` as fallback only when body is empty. JSON bodies (trades, watchpoints) are parsed first to extract the `text` field.

**Path 1 — Auto-retrieval** in `memory_manager.py`, function `_format_context()` (lines 399-414):
```python
# Parse JSON bodies first (trades, watchpoints store JSON with "text" key)
preview = ""
if body.startswith("{"):
    try:
        parsed = json.loads(body)
        preview = parsed.get("text", "")
    except (json.JSONDecodeError, TypeError):
        pass

# Use body as primary, summary only as fallback when body is empty
if not preview:
    preview = body or summary
```

**Path 2 — Explicit recall** in `tools/memory.py`, function `handle_recall_memory()` (lines 479-494): Same fix applied.

**Per-memory truncation removed.** The old 300/400-char hard clips are gone. For auto-retrieval, the global `max_context_tokens` budget (now 4000, see NW-3) handles the overall size cap. For explicit recall, there is no per-memory truncation — the agent gets the full content it asked for.

**Tested against all 6 storage formats:** trade memories (JSON with thesis + signals), plain text memories, body+summary memories, empty-body-with-summary, watchpoints (JSON with trigger), and malformed JSON. All return the correct content.

---

## NW-3. ~~[P1] Global token budget for recalled context is too restrictive~~ FIXED

**Status:** Resolved.

**What was fixed:**

`config/default.yaml` `max_context_tokens` raised from `800` to `4000` (~1,000 words total, ~16,000 chars). With 5 recalled memories, each now gets ~3,200 chars (~800 words) — enough for a full thesis or detailed analysis.

In `memory_manager.py` `_format_context()` (line 388), this converts to:
```python
char_limit = max_tokens * 4  # 4000 * 4 = 16,000 chars
```

**Companion fix:** NW-2 (per-memory truncation) is also resolved. Together, the agent now sees full memory content up to the 4000-token global budget — roughly 200 words per memory with 5 results. The entire memory retrieval bottleneck is fixed.

---

## NW-4. ~~[P2] `update_node()` exists in client but no tool exposes it — memories are immutable~~ FIXED

**Status:** Resolved.

**What was fixed:**

Added `update_memory` tool in `src/hynous/intelligence/tools/memory.py` (lines 518-652) with:

- `UPDATE_TOOL_DEF` — tool definition with 6 parameters:
  - `node_id` (required) — which memory to update
  - `title` (optional) — new title, maps to `content_title`
  - `content` (optional) — new body content (full replace), maps to `content_body`
  - `summary` (optional) — new summary, maps to `content_summary`
  - `append_text` (optional) — text to append to existing body instead of replacing
  - `lifecycle` (optional) — lifecycle state change, maps to `state_lifecycle`

- `handle_update_memory()` — handler that:
  1. Validates at least one field is provided
  2. Rejects simultaneous `content` + `append_text` (can't replace and append)
  3. Verifies node exists via `client.get_node(node_id)`
  4. Maps user-friendly names to Nous field names (`title` → `content_title`, etc.)
  5. For `append_text` with JSON bodies: parses JSON, appends to `text` field, preserves other fields (signals, trigger), re-serializes
  6. For `append_text` with plain text: concatenates with `\n\n---\n\n` separator
  7. For `append_text` with malformed JSON: falls back to plain text append
  8. Calls `client.update_node(node_id, **updates)` with correctly-named fields
  9. Returns confirmation listing what changed

- Registered as **blocking** (not background) — agent sees real confirmation.

**The agent now has the full CRUD set:** `store_memory` (create), `recall_memory` (search), `update_memory` (update), `delete_memory` (delete).

**Follow-up fix (2026-02-20):** Although the tool was implemented and registered, it was never added to the system prompt (`prompts/builder.py`). The agent's `TOOL_STRATEGY` section listed every other memory tool but omitted `update_memory`, meaning the agent had no behavioral guidance to use it and defaulted to creating duplicate nodes instead. Fixed by:
1. Adding `update_memory` to the **Memory** tools list in `TOOL_STRATEGY` with a description of when to use it.
2. Adding an explicit rule to the **"How My Memory Works"** section: *"When I need to revise a memory... I use update_memory to edit it in place. I never store a duplicate to 'update' something that already exists."*

E2E verified: agent correctly called `update_memory` and all three fields (title, content, summary) were durably written to Nous.

---

## NW-5. ~~[P2] Contradiction detection API is fully dead — queued conflicts never checked~~ FIXED

**Status:** Resolved.

**What was fixed:**

Three integration points implemented:

1. **Agent tool** — Created `src/hynous/intelligence/tools/conflicts.py` with `manage_conflicts` tool:
   - `list` action — calls `client.get_conflicts(status)`, formats conflicts with old node title, new content preview, conflict type, confidence, creation/expiry dates. Supports filtering by `status` (pending/resolved).
   - `resolve` action — calls `client.resolve_conflict(conflict_id, resolution)` with the agent's chosen strategy: `old_is_current`, `new_is_current`, `keep_both`, or `merge`.
   - Registered as blocking tool (16th module in `registry.py`).

2. **Daemon periodic check** — Added `_check_conflicts()` to `daemon.py`:
   - Polls `nous.get_conflicts(status="pending")` every 30 minutes (configurable via `conflict_check_interval`).
   - **Tier 1 auto-resolve triage (5 rules, zero agent cost, updated 2026-02-21):**
     1. Expired (>14 days) → `keep_both`
     2. Low confidence (<0.40) → `keep_both`
     3. Explicit self-correction markers ("i was wrong", "correction:") + conf>0.50 → `new_is_current`
     4. Explicit update markers ("update:", "revised:") + conf>0.50 → `new_is_current`
     5. Same subtype + same entity (fetches both nodes) → `new_is_current`
   - Auto-decisions batched into single `batch_resolve_conflicts()` call (max 50 per HTTP call, auto-chunked).
   - **Tier 2:** Remaining conflicts → agent woken with up to 5 summaries. Wake message instructs use of `manage_conflicts` tool.
   - Config: `conflict_check_interval: int = 1800` in `DaemonConfig` + `config/default.yaml`.
   - Timing tracker `_last_conflict_check` + stats counter `conflict_checks`.
   - Added as step 7 in main loop, after FSRS decay (step 6). Runs in background thread (`hynous-conflicts`).

3. **Inline detection feedback** — Modified `_store_memory_impl()` in `memory.py`:
   - After `client.create_node()`, checks `node.get("_contradiction_detected")` flag.
   - If True, appends a warning to the return message: "Contradiction detected — this content may conflict with existing memories. Use manage_conflicts(action='list') to review."
   - Since `store_memory` is now synchronous (`background=False`, NW-10), the agent always sees this warning.

**The system prompt claim is now true:** The agent IS warned about contradictions (via inline flag on store + daemon periodic polling). The `manage_conflicts` tool gives it the ability to investigate and reconcile conflicts.

**Previously dead client methods now called:**
- `get_conflicts()` — called by `manage_conflicts` tool (list action) and daemon `_check_conflicts()`
- `resolve_conflict()` — called by `manage_conflicts` tool (resolve action)
- `batch_resolve_conflicts()` — called by daemon auto-resolve triage (was previously dead code, now active)
- `detect_contradiction()` — still not called from Python (Nous runs Tier 2 automatically on node creation; manual detection is available but not needed)

---

## NW-6. ~~[P2] Graph traversal is write-only — edges created but never inspected~~ FIXED

**Status:** Resolved.

**What was fixed:**

Created a dedicated `explore_memory` tool in `src/hynous/intelligence/tools/explore_memory.py` with three actions:

1. **`explore`** — Show a memory's 1-hop graph neighborhood:
   - Calls `client.get_node(node_id)` to get the starting node's title/type
   - Calls `client.get_edges(node_id, direction)` to get all connected edges
   - For each edge, calls `client.get_node(connected_id)` to get the connected node's title/type
   - Formats as a readable graph view with direction arrows (`→` outgoing, `←` incoming), edge type, connected node type, title, strength, and edge ID
   - Supports `direction` parameter: `"in"`, `"out"`, or `"both"` (default)
   - Strips `custom:` prefix from subtypes for readability (e.g. `custom:thesis` → `thesis`)

2. **`link`** — Create a new edge between two memories:
   - Requires `source_id` and `target_id`
   - Supports 5 edge types: `relates_to`, `part_of`, `causes`, `supports`, `contradicts`
   - Default: `relates_to`
   - Returns confirmation with edge ID

3. **`unlink`** — Remove an edge:
   - Requires `edge_id` (visible from explore output)
   - Calls `client.delete_edge(edge_id)`
   - Returns confirmation

Registered as a **blocking** tool (not background) — agent sees real results. Added to `registry.py` as the 15th tool module.

**The agent can now:**
- `{"action": "explore", "node_id": "n_abc123"}` → see all connections
- `{"action": "explore", "node_id": "n_abc123", "direction": "out"}` → outgoing edges only
- `{"action": "link", "source_id": "n_abc", "target_id": "n_def", "edge_type": "supports"}` → manually link memories
- `{"action": "unlink", "edge_id": "e_xyz789"}` → remove incorrect auto-generated edge

**Remaining enhancement:** Multi-hop traversal (`depth > 1`). The current implementation shows only direct connections (1-hop). Multi-hop would let the agent follow chains like entry → modify → close in a single call. This is lower priority — 1-hop covers the primary use case.

---

## NW-7. ~~[P3] Watchpoint list reads wrong field name for lifecycle display~~ FIXED

**Status:** Resolved.

**What was fixed:**

`watchpoints.py` line 248 now reads the correct field:
```python
lifecycle = wp.get("state_lifecycle", "?")
```

Watchpoint list now correctly shows `[ACTIVE]` or `[DORMANT]` instead of `[?]`.

---

## NW-8. ~~[P2] FSRS batch decay endpoint exists but is never called~~ FIXED

**Status:** Resolved.

**What was fixed:**

1. **Added `run_decay()` to `NousClient`** in `client.py`:
   - `POST /v1/decay` — returns `{ok, processed, transitions_count, transitions}`
   - Transitions are objects with `{id, from, to}` for each lifecycle change

2. **Added `decay_interval` config** in `config.py` `DaemonConfig` + `config/default.yaml`:
   - Default: `21600` seconds (6 hours)
   - Loaded from `daemon.decay_interval` in YAML

3. **Added `_run_decay_cycle()` method to daemon** in `daemon.py`:
   - Calls `nous.run_decay()`
   - Extracts `processed`, `transitions_count`, `transitions` from response
   - Logs each individual transition: `"Decay transition: n_abc — ACTIVE → WEAK"`
   - Logs a `DaemonEvent("decay", ...)` when transitions occur
   - Increments `self.decay_cycles_run` counter
   - Silent on no-transition cycles (debug log only)
   - Error handling: catches exceptions, logs as debug

4. **Added to daemon main loop** as step 6 (after periodic review):
   - `if now - self._last_decay_cycle >= self.config.daemon.decay_interval`
   - Initialized with `time.time()` at loop start (no immediate run on startup)
   - Start log message updated to include decay interval

**Update (2026-02-21):** Fading memory alerts now implemented (see MF-2). The daemon DOES wake the agent when important memories (lessons, theses, playbooks) cross ACTIVE→WEAK. Signals and episodes decay silently. `_run_decay_cycle()` runs in a named background thread (`hynous-decay`) — non-blocking.

---

## NW-9. ~~[P2] `list_nodes()` not exposed as a general browsing tool~~ FIXED

**Status:** Resolved.

**What was fixed:**

Added `browse` mode to the existing `recall_memory` tool in `memory.py`:

- **New `mode` parameter** — `"search"` (default, existing behavior) or `"browse"` (uses `list_nodes()`)
- **`query` is no longer required** — handled in handler: required for search, ignored for browse
- **Browse mode** calls `client.list_nodes(type, subtype, lifecycle, limit)` and formats results identically to search mode
- **Lifecycle tags** — non-ACTIVE nodes show `[WEAK]` or `[DORMANT]` tags in both modes
- **Shared formatting** — extracted `_format_memory_results()` helper used by both search and browse paths

The agent can now:
- `{"mode": "browse", "memory_type": "thesis", "active_only": true}` → all active theses
- `{"mode": "browse", "memory_type": "trade_entry", "limit": 5}` → recent trade entries
- `{"mode": "browse"}` → most recent memories (all types)
- `{"query": "BTC support"}` → search (unchanged, backward compatible)

---

## NW-10. ~~[P2] `store_memory` is fire-and-forget — storage failures are silent~~ FIXED

**Status:** Resolved via Option 2 (synchronous).

**What was fixed:**

Changed `store_memory` registration from `background=True` to `background=False` in `memory.py` line 527. The agent now receives real feedback from the handler instead of a synthetic `"Done."` message.

**How it works now:**
- **During queue mode** (active during the chat thinking loop): `handle_store_memory` appends to the queue and returns `Queued: "title"` instantly — no HTTP call, no latency impact. The agent sees the real queued confirmation.
- **Outside queue mode** (direct calls): `handle_store_memory` calls `_store_memory_impl()` which makes the HTTP call to Nous (~5ms). The agent sees `Stored: "title" (node_id)` on success or the actual error on failure.
- **Queue flush** (unchanged): `flush_memory_queue()` still runs in a background thread after the response. Individual flush failures are logged but not surfaced — this is acceptable since the agent already received the `Queued:` acknowledgment.

**Remaining concern:** The queue flush path still silently drops failed items. If Nous goes down between the `Queued:` response and the background flush, those memories are lost. A future improvement could track flush failures and surface them to the agent on the next turn.

---

## Summary: Fix Order

**Completed:**
- ~~**NW-1**~~ — Fixed `lifecycle_state` → `state_lifecycle` in 3 lines of `daemon.py` + 1 line of `watchpoints.py`.
- ~~**NW-2**~~ — Fixed both formatting functions to show `content_body` over `content_summary`. JSON bodies parsed for `text` field. Per-memory truncation removed.
- ~~**NW-3**~~ — Raised `max_context_tokens` from 800 → 4000 in `config/default.yaml`.
- ~~**NW-4**~~ — Added `update_memory` tool in `memory.py`. Agent now has full CRUD: store, recall, update, delete. Supports title/content/summary replace, body append (JSON-aware), and lifecycle changes.
- ~~**NW-7**~~ — Fixed watchpoint display field name in `watchpoints.py`.
- ~~**NW-8**~~ — Wired FSRS batch decay: `run_decay()` client method + `_run_decay_cycle()` daemon task + `decay_interval` config (6h default).
- ~~**NW-9**~~ — Added browse mode to `recall_memory` tool. Agent can now list memories by type/lifecycle without a search query.
- ~~**NW-10**~~ — Changed `store_memory` from `background=True` to `background=False`. Agent now sees real feedback.

- ~~**NW-6**~~ — Created `explore_memory` tool in `explore_memory.py` with 3 actions: explore (1-hop graph view), link (manual edge creation), unlink (edge removal). Registered as 15th blocking tool.
- ~~**NW-5**~~ — Wired contradiction queue: `manage_conflicts` tool (list + resolve), daemon `_check_conflicts()` polling every 30 min, inline `_contradiction_detected` flag check on store. 16th tool module.

**All NW wiring fixes complete.** All 10 issues (NW-1 through NW-10) are resolved.
