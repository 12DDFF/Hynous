# MF-12: Contradiction Resolution Execution — Solved

> Summary of the issue, what was done, considerations made, and impact on the system.

---

## The Issue

**Original priority:** P3
**Original title:** Advanced Contradiction Tiers (3-5)

The original MF-12 described wiring Nous core's higher contradiction detection tiers (Tier 2.5 few-shot classifier, Tier 3 LLM detection, Tier 4 adversarial verification, Tier 5 user review) to the server. These tiers exist in `core/src/contradiction/` but require LLM adapters and add cost/latency.

During architectural review, the scope was narrowed to a more fundamental problem: **the resolution execution gap**. The existing `POST /contradiction/resolve` endpoint was broken — it marked conflicts as `status = 'resolved'` in the database but never actually did anything. No nodes were updated, no edges were created, no content was merged. The agent's resolution decisions were recorded but never executed.

**Secondary problem:** The conflict listing (both in the Python tool and daemon wake) only showed truncated previews — the old node's title and 150-200 chars of new content. The agent couldn't make informed decisions without making separate `recall_memory` calls to see the actual content of each node.

**Scope decision:** Skip the LLM tiers entirely. The agent's own reasoning when reviewing conflicts serves as Tier 3 — it reads both nodes' content, reasons about which is correct, and chooses a resolution. Adding a separate LLM call in TypeScript would be redundant and expensive.

---

## Key Considerations

### 1. Four resolution strategies

Each strategy maps to concrete database operations:

| Strategy | Node Changes | Edge Created |
|----------|-------------|--------------|
| `new_is_current` | Old → DORMANT | `supersedes` (new → old) |
| `old_is_current` | New → DORMANT | `supersedes` (old → new) |
| `keep_both` | None | `relates_to` (old → new) |
| `merge` | Old body appended, new node deleted | None |

### 2. Supersedes edge direction convention

Source supersedes target: `A supersedes B` means "A replaced B". This matches SSA spreading activation — energy flows from source to target, so following a supersedes edge from A leads to the predecessor B it replaced.

### 3. Nullable `new_node_id`

The `new_node_id` column in `conflict_queue` is nullable (`TEXT REFERENCES nodes(id) ON DELETE SET NULL`). Some conflicts only have `old_node_id` + `new_content` text without a persisted new node (e.g., when Tier 2 detects a contradiction during storage but the new node hasn't been created yet). All resolution branches guard `if (newNodeId)` before operating on the new node.

### 4. Merge semantics: append, not replace

Merge appends new content to the old node's body with a dated separator (`--- Merged (2026-02-09) ---`). This preserves the original content and adds the new information. The FTS trigger on `nodes` fires on body update, keeping full-text search current. CASCADE on node deletion removes orphan edges when the new node is deleted.

### 5. Edge weight consistency

Edge creation uses `neural_weight: 0.5`, `strength: 0.5`, `confidence: 1.0` — matching `EDGE_TYPE_WEIGHTS` in `core-bridge.ts` where both `supersedes` and `relates_to` map to `SSA_EDGE_WEIGHTS.related_to` (0.5).

### 6. Partial failure semantics

If a resolution partially executes (e.g., DORMANT update succeeds but edge INSERT fails), the handler returns 500 with `partial_actions` showing what was done. The conflict stays `pending` because the resolve UPDATE (writing `resolution` and `resolved_at`) only runs after the try/catch block succeeds. This allows safe retry — setting an already-DORMANT node to DORMANT is idempotent.

### 7. No LLM tiers needed

The original MF-12 proposed wiring Tiers 3-5 with LLM calls from TypeScript. This was deemed unnecessary because:
- The agent already reviews both nodes' full content when listing conflicts
- The agent reasons about which is correct using its own Claude reasoning
- The agent chooses a resolution strategy based on that reasoning
- Adding a separate LLM call would be redundant, adding cost (~1000 tokens per conflict) for no additional insight

---

## What Was Implemented

### 1. DB migration — `db.ts`

Added `resolution TEXT` and `resolved_at TEXT` columns to `conflict_queue` via `safeAddColumn` (no-op if they already exist). These persist the resolution decision alongside the status change.

### 2. Fixed `POST /contradiction/resolve` — `contradiction.ts`

Complete replacement of the resolve handler (~145 lines). Now:
- Validates inputs (conflict_id, resolution — 4 valid values)
- Fetches the conflict to get node IDs
- Executes the resolution strategy with proper node updates + edge creation
- Tracks all actions taken in an `actions[]` array
- Marks the conflict as resolved with `resolution` and `resolved_at`
- Returns full details: `{ok, conflict_id, resolution, old_node_id, new_node_id, actions, resolved_at}`

### 3. Improved conflict listing — `conflicts.py`

The list action now fetches full content for both old and new nodes via `client.get_node()`. Shows content bodies capped at 1000 chars with OLD/NEW labels and clear separation. Falls back to `new_content` from the conflict queue when no `new_node_id` exists.

### 4. Improved daemon wake — `daemon.py`

Same improvement for the daemon-triggered conflict review. Shows up to 500 chars of each node's content (more compact than the tool's 1000 chars since daemon wakes trigger full agent cycles). Shows at most 5 conflicts with "... and N more" overflow.

### 5. Resolution outcome feedback — `conflicts.py`

The resolve action now shows the agent exactly what happened: each action as a bullet point (e.g., "Old node n_xxx → DORMANT", "Edge e_xxx: n_yyy supersedes n_xxx").

### No changes needed — `client.py`

`resolve_conflict()` already returns `resp.json()` — the new response fields (`actions`, `old_node_id`, `new_node_id`, `resolved_at`) flow through automatically.

---

## Audit Results

**Verdict: PASS — No issues found.**

The auditor performed character-level comparison against the implementation guide across all 4 files. All 27 self-review checklist items verified. All cross-file consistency checks passed:

- Column names `resolution`, `resolved_at` match across `db.ts` ↔ `contradiction.ts`
- Edge types `supersedes`, `relates_to` recognized by core-bridge SSA weights
- Supersedes edge direction correct (source supersedes target)
- Response shape flows correctly through full stack (TS server → Python client → Python tool → agent)
- FTS trigger fires on merge body update
- CASCADE on node delete removes orphan edges during merge

**5 observations documented (no action needed):**
1. Dead variables in resolve action (`old_id`, `new_id` fetched but unused) — matches guide, harmless
2. `new_is_current` with null `newNodeId` — old goes DORMANT without a replacement, by design
3. Merge doesn't inherit new node's edges — CASCADE removes them, acceptable for current scope
4. `merged_content` not exposed in Python tool — merge always uses `conflict.new_content`, by design
5. Partial failure allows safe retry — idempotent DORMANT updates

---

## Impact on the System

### Immediate

- **Contradictions are now actually resolved.** When the agent decides "the new information is correct", the old node goes DORMANT and a supersedes edge records the relationship. Previously this decision was recorded but the old node stayed ACTIVE at full strength, polluting search results.
- **Agent makes informed decisions.** Full content of both nodes is displayed when listing conflicts — no more guessing from 200-char previews.
- **Agent sees what happened.** Resolution feedback shows exactly which nodes were updated and which edges were created.

### Long-term

- **Knowledge base self-corrects.** As the agent resolves contradictions, outdated information fades (DORMANT) while current information stays active. SSA search naturally favors ACTIVE nodes.
- **Graph records supersession history.** `supersedes` edges create an audit trail of what replaced what. The agent (or a future analysis tool) can trace how its beliefs evolved over time.
- **Merge preserves context.** When two pieces of information are complementary rather than contradictory, merge combines them into a single, richer node rather than maintaining two fragmented ones.

---

## Files Changed

| File | Change |
|------|--------|
| `nous-server/server/src/db.ts` | 2 `safeAddColumn` calls for `resolution` and `resolved_at` |
| `nous-server/server/src/routes/contradiction.ts` | `edgeId` import + complete resolve handler replacement (~145 lines) |
| `src/hynous/intelligence/tools/conflicts.py` | Rewritten list action (full content) + rewritten resolve action (outcome feedback) |
| `src/hynous/intelligence/daemon.py` | Rewritten conflict wake message (full content for both nodes) |

**Implementation guide:** `revisions/MF12/implementation-guide.md`
**Audit notes:** `revisions/MF12/audit-notes.md`
