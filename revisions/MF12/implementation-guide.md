# MF-12: Contradiction Resolution Execution — Implementation Guide

> Detailed implementation specification for the engineering agent. Every decision is finalized. Follow this exactly.

---

## 0. Prerequisites — Read Before Implementing

Before writing any code, read these files **in order** to understand the system you're modifying.

### Required Reading (do all of these)

| Order | File | Why |
|---|---|---|
| 1 | `ARCHITECTURE.md` | System overview — understand the 4-layer architecture (Dashboard → FastAPI → Nous → Hydra) and how they communicate |
| 2 | `src/hynous/intelligence/README.md` | Intelligence module structure — tools, prompts, daemon, memory_manager. Shows how tools are registered and cron tasks work |
| 3 | `revisions/nous-wiring/more-functionality.md` | Lines 426-451 — MF-12 issue description. Also read MF-3 (lines 184-208) for how the current contradiction system was wired |
| 4 | `nous-server/server/src/routes/contradiction.ts` | **Primary TypeScript file you'll modify.** 142 lines. The `POST /contradiction/resolve` endpoint at line 126 is the core of this fix |
| 5 | `nous-server/server/src/routes/nodes.ts` | How nodes are created (PATCH at line 204 — understand the update pattern), and the Tier 2 inline contradiction detection at line 84-118 |
| 6 | `nous-server/server/src/routes/edges.ts` | How edges are created (`POST /edges` at line 9) — you'll replicate this pattern inside the resolve handler |
| 7 | `nous-server/server/src/db.ts` | Database schema. The `conflict_queue` table (line 136-152), `nodes` table (line 28-53), and `edges` table (line 108-123). Column names: `state_lifecycle`, `content_body`, `content_title` |
| 8 | `nous-server/server/src/utils.ts` | Utility functions: `edgeId()` generates edge IDs (`e_` + 12 chars), `now()` returns ISO timestamp |
| 9 | `nous-server/server/src/core-bridge.ts` | `EDGE_TYPE_WEIGHTS` at line 175 — `supersedes` maps to `SSA_EDGE_WEIGHTS.related_to` (line 184). `relates_to` maps to `SSA_EDGE_WEIGHTS.related_to` (line 176). Both default to 0.5 strength |
| 10 | `src/hynous/intelligence/tools/conflicts.py` | **Primary Python file you'll modify.** 164 lines. The `handle_manage_conflicts()` function — `list` action (line 85) and `resolve` action (line 132). The list action is where we improve conflict presentation |
| 11 | `src/hynous/nous/client.py` | Python HTTP client. `resolve_conflict()` at line 205 and `get_conflicts()` at line 199 — understand the current request/response shape. `get_node()` at line 85 fetches full node data |
| 12 | `src/hynous/intelligence/daemon.py` | `_check_conflicts()` at line 1002 — daemon wake that presents conflicts to the agent. Also needs improved conflict presentation |

### Reference Reading (skim for context)

| File | Why |
|---|---|
| `nous-server/core/src/contradiction/constants.ts` | `UserResolution` type: `'old_is_current' | 'new_is_current' | 'keep_both' | 'merge'`. `SupersededState` type and `SUPERSEDED_DECAY_MULTIPLIERS`. `CONFLICT_TYPE_RESOLUTION` mapping |
| `nous-server/core/src/contradiction/types.ts` | `ConflictQueueItem` interface — fields available on conflict queue rows. `ContradictionResolution` interface |
| `src/hynous/intelligence/tools/explore_memory.py` | Reference for how edge creation is called from Python tools (`client.create_edge()` at line 161) |
| `config/default.yaml` | `daemon.conflict_check_interval` (default 1800 = 30 min) |

### Auditor Notes

Check the `revisions/MF12/` directory for any additional files from the auditor before and during implementation. These may contain change requests or corrections that supersede parts of this guide.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Scope](#2-scope)
3. [Change 1: Fix `POST /contradiction/resolve` — Execute Resolutions](#3-change-1-fix-post-contradictionresolve)
4. [Change 2: Improve Conflict Listing in Python Tool](#4-change-2-improve-conflict-listing-in-python-tool)
5. [Change 3: Improve Daemon Wake Conflict Presentation](#5-change-3-improve-daemon-wake-conflict-presentation)
6. [Change 4: Enrich `resolve_conflict()` Python Client Return Value](#6-change-4-enrich-resolve_conflict-python-client-return-value)
7. [Change 5: Give Agent Feedback on Resolution Outcome](#7-change-5-give-agent-feedback-on-resolution-outcome)
8. [Implementation Order](#8-implementation-order)
9. [Testing](#9-testing)
10. [Documentation Updates](#10-documentation-updates)
11. [Self-Review Checklist](#11-self-review-checklist)
12. [File Summary](#12-file-summary)

---

## 1. Problem Statement

The contradiction resolution system has a **resolution execution gap**. The pipeline detects conflicts correctly (Tier 2 pattern matching fires on node creation, conflicts are queued, the daemon wakes the agent, the agent can list and resolve conflicts). But the resolve endpoint does **nothing** — it just marks the conflict as `status = 'resolved'` in the database without actually modifying any nodes or creating any edges.

**Current behavior** (`nous-server/server/src/routes/contradiction.ts` lines 126-140):

```typescript
contradiction.post('/contradiction/resolve', async (c) => {
  const { conflict_id, resolution } = await c.req.json();
  // ... validation ...
  const db = getDb();
  await db.execute({
    sql: 'UPDATE conflict_queue SET status = ? WHERE id = ?',
    args: ['resolved', conflict_id],
  });
  return c.json({ ok: true, conflict_id, resolution });
});
```

This means when the agent resolves a conflict as `new_is_current`, the old node stays ACTIVE with full strength. When it resolves as `merge`, nothing is merged. The agent's decisions are recorded but never executed.

**Secondary problem**: The conflict listing only shows truncated `new_content` (200 chars in tool, 150 chars in daemon wake) and just the old node's title. The agent can't make informed decisions without seeing both nodes' full content. Currently the agent would need to make separate `recall_memory` calls to see the actual content of each node.

---

## 2. Scope

This MF covers **three things only**:

1. **Fix resolution execution** — `POST /contradiction/resolve` should actually update nodes and create edges based on the resolution strategy.
2. **Improve conflict presentation** — Show the agent full content of both old and new nodes when listing conflicts, so it can reason about them without extra tool calls.
3. **Surface resolution results** — Tell the agent exactly what happened when it resolves a conflict (what nodes were updated, what edges were created).

**Explicitly NOT in scope:**
- No new detection tiers (Tier 2.5, 3, 4) — the agent's own reasoning handles contradiction detection adequately.
- No new LLM calls — not in TypeScript, not in Python.
- No changes to `POST /nodes` creation flow or Tier 2 detection.
- No superseded lifecycle state machine (the full `SUPERSEDED_ACTIVE → SUPERSEDED_FADING → ...` chain from core). We use simple `DORMANT` which already exists in the FSRS lifecycle.
- No new daemon cron tasks.

---

## 3. Change 1: Fix `POST /contradiction/resolve`

**File:** `nous-server/server/src/routes/contradiction.ts`
**Lines to replace:** 122-142 (the entire `POST /contradiction/resolve` handler)

### What the handler must do

For every resolution, it must:
1. Validate inputs (`conflict_id`, `resolution`)
2. Fetch the conflict from `conflict_queue` to get `old_node_id` and `new_node_id`
3. Execute the resolution strategy (different for each of the 4 strategies)
4. Mark the conflict as `status = 'resolved'` with `resolution` and `resolved_at`
5. Return details of what was done

### New imports needed

Add to the import block at the top of the file (line 3, after `import { now } from '../utils.js';`):

```typescript
import { edgeId } from '../utils.js';
```

The existing `now` import from `'../utils.js'` is already there — just add `edgeId` to the same import. Change line 3 from:

```typescript
import { now } from '../utils.js';
```

to:

```typescript
import { now, edgeId } from '../utils.js';
```

### DB schema context

The `conflict_queue` table needs two new columns to persist the resolution decision. Add these via migration (safe — no-op if they exist):

Add after line 152 in `db.ts` (after the conflict_queue CREATE INDEX):

```typescript
await safeAddColumn(client, 'conflict_queue', 'resolution', 'TEXT');
await safeAddColumn(client, 'conflict_queue', 'resolved_at', 'TEXT');
```

### Complete replacement handler

Replace lines 122-142 in `contradiction.ts` with:

```typescript
/**
 * POST /contradiction/resolve — Resolve a conflict and execute the resolution.
 *
 * Strategies:
 *   new_is_current — Old node → DORMANT, create supersedes edge (new → old)
 *   old_is_current — New node → DORMANT, create supersedes edge (old → new)
 *   keep_both     — Create relates_to edge between both nodes
 *   merge         — Append new content to old node body, delete new node if it exists
 */
contradiction.post('/contradiction/resolve', async (c) => {
  const body = await c.req.json();
  const { conflict_id, resolution, merged_content } = body;

  if (!conflict_id || !resolution) {
    return c.json({ error: 'conflict_id and resolution are required' }, 400);
  }

  const validResolutions = ['old_is_current', 'new_is_current', 'keep_both', 'merge'];
  if (!validResolutions.includes(resolution)) {
    return c.json({
      error: `Invalid resolution: ${resolution}. Must be one of: ${validResolutions.join(', ')}`,
    }, 400);
  }

  const db = getDb();
  const ts = now();

  // 1. Fetch the conflict to get node IDs
  const conflictResult = await db.execute({
    sql: 'SELECT * FROM conflict_queue WHERE id = ?',
    args: [conflict_id],
  });

  if (conflictResult.rows.length === 0) {
    return c.json({ error: `Conflict ${conflict_id} not found` }, 404);
  }

  const conflict = conflictResult.rows[0] as any;
  const oldNodeId: string = conflict.old_node_id;
  const newNodeId: string | null = conflict.new_node_id ?? null;

  // Track what was done for the response
  const actions: string[] = [];

  // 2. Execute the resolution strategy
  try {
    if (resolution === 'new_is_current') {
      // Old node becomes DORMANT — it's been superseded
      await db.execute({
        sql: `UPDATE nodes SET state_lifecycle = 'DORMANT', last_modified = ?, version = version + 1 WHERE id = ?`,
        args: [ts, oldNodeId],
      });
      actions.push(`Old node ${oldNodeId} → DORMANT`);

      // Create supersedes edge: new → old (new supersedes old)
      if (newNodeId) {
        const eid = edgeId();
        await db.execute({
          sql: `INSERT INTO edges (id, type, source_id, target_id, neural_weight, strength, confidence, created_at)
                VALUES (?, 'supersedes', ?, ?, 0.5, 0.5, 1.0, ?)`,
          args: [eid, newNodeId, oldNodeId, ts],
        });
        actions.push(`Edge ${eid}: ${newNodeId} supersedes ${oldNodeId}`);
      }
    } else if (resolution === 'old_is_current') {
      // New node becomes DORMANT — the old one was correct
      if (newNodeId) {
        await db.execute({
          sql: `UPDATE nodes SET state_lifecycle = 'DORMANT', last_modified = ?, version = version + 1 WHERE id = ?`,
          args: [ts, newNodeId],
        });
        actions.push(`New node ${newNodeId} → DORMANT`);

        // Create supersedes edge: old → new (old supersedes new)
        const eid = edgeId();
        await db.execute({
          sql: `INSERT INTO edges (id, type, source_id, target_id, neural_weight, strength, confidence, created_at)
                VALUES (?, 'supersedes', ?, ?, 0.5, 0.5, 1.0, ?)`,
          args: [eid, oldNodeId, newNodeId, ts],
        });
        actions.push(`Edge ${eid}: ${oldNodeId} supersedes ${newNodeId}`);
      } else {
        // No new node — just acknowledge the old one is correct
        actions.push(`Old node ${oldNodeId} confirmed current (no new node to deprecate)`);
      }
    } else if (resolution === 'keep_both') {
      // Both are valid — create relates_to edge
      if (newNodeId) {
        const eid = edgeId();
        await db.execute({
          sql: `INSERT INTO edges (id, type, source_id, target_id, neural_weight, strength, confidence, created_at)
                VALUES (?, 'relates_to', ?, ?, 0.5, 0.5, 1.0, ?)`,
          args: [eid, oldNodeId, newNodeId, ts],
        });
        actions.push(`Edge ${eid}: ${oldNodeId} relates_to ${newNodeId}`);
      } else {
        actions.push('Both kept (no new node to link)');
      }
    } else if (resolution === 'merge') {
      // Append new content to old node's body
      const oldNodeResult = await db.execute({
        sql: 'SELECT content_body FROM nodes WHERE id = ?',
        args: [oldNodeId],
      });

      if (oldNodeResult.rows.length > 0) {
        const oldBody = (oldNodeResult.rows[0] as any).content_body || '';

        // Use merged_content if provided, otherwise use conflict's new_content
        const appendContent = merged_content || conflict.new_content || '';
        const separator = '\n\n--- Merged (' + ts.substring(0, 10) + ') ---\n\n';
        const newBody = oldBody + separator + appendContent;

        await db.execute({
          sql: `UPDATE nodes SET content_body = ?, last_modified = ?, version = version + 1 WHERE id = ?`,
          args: [newBody, ts, oldNodeId],
        });
        actions.push(`Merged content into old node ${oldNodeId}`);
      }

      // Delete the new node if it exists (content is now merged into old)
      if (newNodeId) {
        await db.execute({
          sql: 'DELETE FROM nodes WHERE id = ?',
          args: [newNodeId],
        });
        actions.push(`Deleted new node ${newNodeId} (merged into ${oldNodeId})`);
      }
    }
  } catch (e: any) {
    return c.json({
      error: `Resolution execution failed: ${e.message}`,
      conflict_id,
      resolution,
      partial_actions: actions,
    }, 500);
  }

  // 3. Mark the conflict as resolved
  await db.execute({
    sql: `UPDATE conflict_queue SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?`,
    args: [resolution, ts, conflict_id],
  });

  return c.json({
    ok: true,
    conflict_id,
    resolution,
    old_node_id: oldNodeId,
    new_node_id: newNodeId,
    actions,
    resolved_at: ts,
  });
});
```

### Edge direction convention

The `supersedes` edge direction is: **source supersedes target**.
- `new_is_current`: source = `newNodeId`, target = `oldNodeId` (new supersedes old)
- `old_is_current`: source = `oldNodeId`, target = `newNodeId` (old supersedes new)

This matches the SSA spreading activation model — when searching, activation flows from source to target. A `supersedes` edge from A → B means "A replaced B", and SSA can follow it to find the predecessor if needed.

### Null safety for `new_node_id`

The `new_node_id` column in `conflict_queue` is nullable (`TEXT REFERENCES nodes(id) ON DELETE SET NULL` — see `db.ts` line 139). Some conflicts may only have `old_node_id` + `new_content` without a persisted new node. All resolution branches check `if (newNodeId)` before operating on the new node.

---

## 4. Change 2: Improve Conflict Listing in Python Tool

**File:** `src/hynous/intelligence/tools/conflicts.py`
**Lines to modify:** 85-130 (the `list` action in `handle_manage_conflicts`)

### Problem

Currently the list action shows:
- Old node: just the title (fetched via `client.get_node()`)
- New content: 200-char truncated preview from `conflict.new_content`

The agent can't compare the two nodes' actual content to decide what's correct.

### Fix

Fetch full content for both nodes and present them side-by-side.

Replace lines 85-130 (from `if action == "list":` through the closing `return "\n".join(lines)`) with:

```python
        if action == "list":
            conflicts = client.get_conflicts(status=status)

            if not conflicts:
                return f"No {status} conflicts."

            lines = [f"{len(conflicts)} {status} conflict(s):", ""]

            for conflict in conflicts:
                cid = conflict.get("id", "?")
                old_id = conflict.get("old_node_id", "?")
                new_id = conflict.get("new_node_id")
                new_content = conflict.get("new_content", "")
                ctype = conflict.get("conflict_type", "?")
                confidence = conflict.get("detection_confidence", 0)
                created = conflict.get("created_at", "?")
                expires = conflict.get("expires_at", "?")

                # Fetch old node full data for comparison
                old_title = old_id
                old_body = ""
                try:
                    old_node = client.get_node(old_id)
                    if old_node:
                        old_title = old_node.get("content_title", old_id)
                        old_body = old_node.get("content_body", "") or ""
                except Exception:
                    pass

                # Fetch new node full data if it exists
                new_title = ""
                new_body = ""
                if new_id:
                    try:
                        new_node = client.get_node(new_id)
                        if new_node:
                            new_title = new_node.get("content_title", "")
                            new_body = new_node.get("content_body", "") or ""
                    except Exception:
                        pass

                lines.append(f"--- {cid} ---")
                lines.append(f"  Type: {ctype} | Confidence: {confidence:.0%}")
                lines.append(f"  Created: {created} | Expires: {expires}")
                lines.append("")

                # Old node — show full content (capped at 1000 chars)
                lines.append(f"  OLD: \"{old_title}\" ({old_id})")
                if old_body:
                    display_body = old_body[:1000]
                    if len(old_body) > 1000:
                        display_body += "..."
                    lines.append(f"  Content: {display_body}")
                lines.append("")

                # New node or new content
                if new_id and new_title:
                    lines.append(f"  NEW: \"{new_title}\" ({new_id})")
                    if new_body:
                        display_body = new_body[:1000]
                        if len(new_body) > 1000:
                            display_body += "..."
                        lines.append(f"  Content: {display_body}")
                else:
                    lines.append(f"  NEW CONTENT:")
                    display_content = new_content[:1000]
                    if len(new_content) > 1000:
                        display_content += "..."
                    lines.append(f"  {display_content}")
                lines.append("")

            lines.append(
                "Use resolve action with conflict_id and resolution "
                "(old_is_current, new_is_current, keep_both, merge)."
            )
            return "\n".join(lines)
```

### Key differences from old code

1. **Old node full body** — fetches `content_body` from `client.get_node()`, not just title. Capped at 1000 chars (enough for reasoning, not overwhelming).
2. **New node lookup** — if `new_node_id` exists, fetches that node's full data too (title + body).
3. **Fallback** — if no `new_node_id`, shows `new_content` from the conflict queue (the raw detection text). Still capped at 1000 chars.
4. **Cleaner formatting** — OLD/NEW labels with clear separation for the agent to compare.

---

## 5. Change 3: Improve Daemon Wake Conflict Presentation

**File:** `src/hynous/intelligence/daemon.py`
**Lines to modify:** 1018-1062 (inside `_check_conflicts()`, the wake message construction)

### Problem

Same as the tool: the daemon wake only shows old node title + 150-char preview of new content. The agent wakes up without enough information.

### Fix

Replace lines 1018-1062 (from `# Build wake message with conflict details` through the end of `lines.extend(...)`) with:

```python
            # Build wake message with conflict details
            lines = [
                "[DAEMON WAKE — Contradiction Review]",
                f"You have {len(conflicts)} pending contradiction(s) in your knowledge base.",
                "Review them and decide how to resolve each one.",
                "",
            ]

            for conflict in conflicts[:5]:  # Show at most 5 to avoid overwhelming
                cid = conflict.get("id", "?")
                old_id = conflict.get("old_node_id", "?")
                new_id = conflict.get("new_node_id")
                new_content = conflict.get("new_content", "")
                ctype = conflict.get("conflict_type", "?")
                confidence = conflict.get("detection_confidence", 0)

                # Fetch old node full content
                old_title = old_id
                old_body = ""
                try:
                    old_node = nous.get_node(old_id)
                    if old_node:
                        old_title = old_node.get("content_title", old_id)
                        old_body = old_node.get("content_body", "") or ""
                except Exception:
                    pass

                # Fetch new node full content if it exists
                new_title = ""
                new_body = ""
                if new_id:
                    try:
                        new_node = nous.get_node(new_id)
                        if new_node:
                            new_title = new_node.get("content_title", "")
                            new_body = new_node.get("content_body", "") or ""
                    except Exception:
                        pass

                lines.append(f"Conflict {cid} ({ctype}, {confidence:.0%} confidence):")

                # Old node
                old_preview = old_body[:500] if old_body else "(no content)"
                if len(old_body) > 500:
                    old_preview += "..."
                lines.append(f"  OLD: \"{old_title}\" ({old_id})")
                lines.append(f"  {old_preview}")

                # New node or content
                if new_id and new_title:
                    new_preview = new_body[:500] if new_body else "(no content)"
                    if len(new_body) > 500:
                        new_preview += "..."
                    lines.append(f"  NEW: \"{new_title}\" ({new_id})")
                    lines.append(f"  {new_preview}")
                else:
                    new_preview = new_content[:500]
                    if len(new_content) > 500:
                        new_preview += "..."
                    lines.append(f"  NEW CONTENT: {new_preview}")
                lines.append("")

            if len(conflicts) > 5:
                lines.append(f"... and {len(conflicts) - 5} more. Use manage_conflicts(action=\"list\") to see all.")
                lines.append("")

            lines.extend([
                "Use your manage_conflicts tool to:",
                "1. List all conflicts: {\"action\": \"list\"}",
                "2. Resolve each one: {\"action\": \"resolve\", \"conflict_id\": \"c_...\", "
                "\"resolution\": \"new_is_current\"}",
                "",
                "Resolutions: old_is_current, new_is_current, keep_both, merge",
            ])
```

### Key differences from old code

1. **Old node body** — now shows up to 500 chars of old node content (was just title).
2. **New node lookup** — if `new_node_id` exists, fetches and shows that node's content too.
3. **Slightly longer previews** — 500 chars in daemon wake (vs 1000 in tool). Daemon wakes need to be compact since they trigger a full agent wake cycle.

---

## 6. Change 4: Enrich `resolve_conflict()` Python Client Return Value

**File:** `src/hynous/nous/client.py`

### No changes needed

The `resolve_conflict()` method at line 205-212 already returns `resp.json()` which will automatically include the new fields (`actions`, `old_node_id`, `new_node_id`, `resolved_at`) from the updated TypeScript endpoint. No Python client changes are needed.

---

## 7. Change 5: Give Agent Feedback on Resolution Outcome

**File:** `src/hynous/intelligence/tools/conflicts.py`
**Lines to modify:** 132-144 (the `resolve` action in `handle_manage_conflicts`)

### Problem

Currently the resolve action just says `"Resolved: conflict c_xyz — new_is_current."` The agent doesn't know what actually happened (was a node made DORMANT? was an edge created?).

### Fix

Replace lines 132-144 (from `elif action == "resolve":` through `return f"Error: failed..."`) with:

```python
        elif action == "resolve":
            if not conflict_id:
                return "Error: conflict_id is required for resolve action."
            if not resolution:
                return "Error: resolution is required for resolve action."

            result = client.resolve_conflict(conflict_id, resolution)

            if result.get("ok"):
                logger.info("Resolved conflict %s: %s", conflict_id, resolution)
                actions = result.get("actions", [])
                old_id = result.get("old_node_id", "?")
                new_id = result.get("new_node_id", "?")

                lines = [f"Resolved: conflict {conflict_id} — {resolution}."]
                if actions:
                    lines.append("")
                    lines.append("Actions taken:")
                    for action_desc in actions:
                        lines.append(f"  - {action_desc}")
                return "\n".join(lines)
            else:
                error = result.get("error", "unknown error")
                return f"Error resolving conflict {conflict_id}: {error}"
```

---

## 8. Implementation Order

Do these in sequence. Each change depends on the previous one.

| Step | What | File | Why this order |
|------|------|------|----------------|
| 1 | Add `resolution` and `resolved_at` columns to `conflict_queue` | `nous-server/server/src/db.ts` | Schema migration must exist before the resolve handler writes to these columns |
| 2 | Fix `POST /contradiction/resolve` | `nous-server/server/src/routes/contradiction.ts` | Core fix — everything else depends on this actually executing resolutions |
| 3 | Improve conflict listing in Python tool | `src/hynous/intelligence/tools/conflicts.py` (list action) | Agent needs full context to make informed resolution decisions |
| 4 | Improve daemon wake presentation | `src/hynous/intelligence/daemon.py` | Same improvement for daemon-triggered conflict reviews |
| 5 | Show resolution outcome in Python tool | `src/hynous/intelligence/tools/conflicts.py` (resolve action) | Agent sees what its resolution decision actually did |

---

## 9. Testing

### TypeScript — Test the resolve endpoint

After implementing Step 1 and 2, start the Nous server and test with curl.

**Setup** — create two test nodes and a conflict:

```bash
# Create old node
curl -s -X POST http://localhost:3100/v1/nodes \
  -H 'Content-Type: application/json' \
  -d '{"type":"concept","subtype":"custom:lesson","content_title":"BTC is bullish","content_body":"Market structure looks bullish with higher highs."}' \
  | jq '.id'
# Save this as OLD_ID (e.g., n_xxxxxxxxxxxx)

# Create new node
curl -s -X POST http://localhost:3100/v1/nodes \
  -H 'Content-Type: application/json' \
  -d '{"type":"concept","subtype":"custom:lesson","content_title":"Actually BTC is bearish","content_body":"Actually, I was wrong. Market broke structure, now bearish."}' \
  | jq '.id'
# Save this as NEW_ID

# Create a conflict manually
curl -s -X POST http://localhost:3100/v1/contradiction/queue \
  -H 'Content-Type: application/json' \
  -d "{\"old_node_id\":\"$OLD_ID\",\"new_node_id\":\"$NEW_ID\",\"new_content\":\"Actually, I was wrong. Market broke structure, now bearish.\",\"conflict_type\":\"CORRECTION\",\"detection_tier\":\"PATTERN\",\"detection_confidence\":0.8}"
# Save the returned id as CONFLICT_ID
```

**Test 1: `new_is_current`**

```bash
curl -s -X POST http://localhost:3100/v1/contradiction/resolve \
  -H 'Content-Type: application/json' \
  -d "{\"conflict_id\":\"$CONFLICT_ID\",\"resolution\":\"new_is_current\"}" | jq
```

Verify:
- Response has `"ok": true` and `"actions"` array
- Actions include "Old node ... → DORMANT" and "Edge ...: ... supersedes ..."
- `GET /v1/nodes/$OLD_ID` returns `state_lifecycle: "DORMANT"`
- `GET /v1/edges?node_id=$NEW_ID` returns an edge with type `supersedes` pointing at `$OLD_ID`

**Test 2: `old_is_current`** (create fresh nodes + conflict)

```bash
# ... create test data ...
curl -s -X POST http://localhost:3100/v1/contradiction/resolve \
  -H 'Content-Type: application/json' \
  -d "{\"conflict_id\":\"$CONFLICT_ID\",\"resolution\":\"old_is_current\"}" | jq
```

Verify:
- New node is DORMANT
- `supersedes` edge goes from old → new

**Test 3: `keep_both`** (create fresh nodes + conflict)

```bash
curl -s -X POST http://localhost:3100/v1/contradiction/resolve \
  -H 'Content-Type: application/json' \
  -d "{\"conflict_id\":\"$CONFLICT_ID\",\"resolution\":\"keep_both\"}" | jq
```

Verify:
- Neither node is DORMANT
- `relates_to` edge exists between them

**Test 4: `merge`** (create fresh nodes + conflict)

```bash
curl -s -X POST http://localhost:3100/v1/contradiction/resolve \
  -H 'Content-Type: application/json' \
  -d "{\"conflict_id\":\"$CONFLICT_ID\",\"resolution\":\"merge\"}" | jq
```

Verify:
- Old node's `content_body` now contains original + separator + new content
- New node is deleted (404 on GET)

**Test 5: Invalid resolution**

```bash
curl -s -X POST http://localhost:3100/v1/contradiction/resolve \
  -H 'Content-Type: application/json' \
  -d '{"conflict_id":"c_fake","resolution":"invalid"}' | jq
```

Verify: 400 error with clear message.

**Test 6: Nonexistent conflict**

```bash
curl -s -X POST http://localhost:3100/v1/contradiction/resolve \
  -H 'Content-Type: application/json' \
  -d '{"conflict_id":"c_doesnotexist","resolution":"keep_both"}' | jq
```

Verify: 404 error.

**Test 7: Null `new_node_id`** (conflict created without a new node)

```bash
# Create conflict with only old_node_id (no new_node_id)
curl -s -X POST http://localhost:3100/v1/contradiction/queue \
  -H 'Content-Type: application/json' \
  -d "{\"old_node_id\":\"$OLD_ID\",\"new_content\":\"Some contradicting content\"}"

# Resolve as new_is_current — should set old to DORMANT but no edge (no new node)
curl -s -X POST http://localhost:3100/v1/contradiction/resolve \
  -H 'Content-Type: application/json' \
  -d "{\"conflict_id\":\"$CONFLICT_ID\",\"resolution\":\"new_is_current\"}" | jq
```

Verify: Old node → DORMANT. No edge created. No error.

### Python — Test conflict listing improvements

After Steps 3-5, test the Python tool manually:

```python
from hynous.intelligence.tools.conflicts import handle_manage_conflicts

# Should show full content for both OLD and NEW nodes
result = handle_manage_conflicts(action="list")
print(result)
# Verify: output shows "OLD:" with content body, "NEW:" with content body

# Resolve and check feedback
result = handle_manage_conflicts(
    action="resolve",
    conflict_id="c_...",
    resolution="new_is_current",
)
print(result)
# Verify: output shows "Actions taken:" with specific actions
```

### Existing test suites

Check if existing tests pass. Run:

```bash
# Nous core tests
cd nous-server && pnpm test

# Python tests (if any exist for conflicts)
cd /path/to/hynous && python -m pytest tests/ -v -k conflict
```

---

## 10. Documentation Updates

**DEFERRED** — Do not apply these until the implementation is verified and approved by the auditor.

### Files to update when approved

| File | What to update |
|---|---|
| `revisions/nous-wiring/more-functionality.md` | Mark MF-12 section (lines 426-451) as DONE with implementation summary |
| `ARCHITECTURE.md` | No changes needed — contradiction route already documented |
| `src/hynous/intelligence/README.md` | Update "Remaining" section (line 107) — remove MF-12 mention or mark as fixed |
| `src/hynous/nous/README.md` | Update `resolve_conflict()` method docs to note it now executes resolutions |
| `revisions/nous-wiring/executive-summary.md` | Update status to reflect MF-12 completion |

---

## 11. Self-Review Checklist

The engineer must verify ALL of these before handing off to the auditor.

### TypeScript — `contradiction.ts` (9 checks)

- [ ] `edgeId` is imported from `'../utils.js'` (same import line as `now`)
- [ ] The handler fetches the conflict row from `conflict_queue` before executing
- [ ] If `conflict_id` doesn't exist in the DB, returns 404 (not 400)
- [ ] If `resolution` is not one of the 4 valid values, returns 400
- [ ] `new_is_current`: old node gets `state_lifecycle = 'DORMANT'` AND `supersedes` edge created (source = new, target = old)
- [ ] `old_is_current`: new node gets `state_lifecycle = 'DORMANT'` AND `supersedes` edge created (source = old, target = new)
- [ ] `keep_both`: `relates_to` edge created (source = old, target = new)
- [ ] `merge`: old node's `content_body` is appended to (not replaced), new node is deleted
- [ ] All branches check `if (newNodeId)` before operating on the new node — `new_node_id` can be null

### TypeScript — `db.ts` (2 checks)

- [ ] `safeAddColumn` calls for `resolution TEXT` and `resolved_at TEXT` on `conflict_queue` are placed AFTER the table creation and index
- [ ] Column names match what the resolve handler writes: `resolution` and `resolved_at`

### Python — `conflicts.py` list action (5 checks)

- [ ] Old node's `content_body` is fetched and displayed (not just title)
- [ ] New node is fetched via `client.get_node(new_id)` when `new_id` exists
- [ ] Content preview is capped at 1000 chars with `...` suffix if truncated
- [ ] Falls back to `new_content` from conflict queue when no `new_node_id`
- [ ] Empty/null body is handled gracefully (shows "(no content)" or empty)

### Python — `conflicts.py` resolve action (3 checks)

- [ ] Response includes `actions` from the server response
- [ ] Each action is displayed as a bullet point (`- ...`)
- [ ] Error responses from the server are surfaced to the agent (not swallowed)

### Python — `daemon.py` _check_conflicts (4 checks)

- [ ] Old node body is fetched and shown (up to 500 chars)
- [ ] New node body is fetched when `new_node_id` exists
- [ ] Content preview is capped at 500 chars (not 1000 — daemon wakes are more compact)
- [ ] Graceful degradation — if node fetch fails, still shows whatever info is available

### Integration (4 checks)

- [ ] All 7 curl tests pass (see Section 9)
- [ ] The Nous server starts without errors after `db.ts` changes
- [ ] Existing `pnpm test` in `nous-server/` still passes
- [ ] No TypeScript compilation errors (`pnpm build` or `tsc --noEmit`)

---

## 12. File Summary

| File | Change | Where |
|---|---|---|
| `nous-server/server/src/db.ts` | Add 2 migration columns to `conflict_queue` | After line 152, add `safeAddColumn` for `resolution` and `resolved_at` |
| `nous-server/server/src/routes/contradiction.ts` | Replace entire `POST /resolve` handler + add `edgeId` import | Lines 3 (import), 122-142 (handler) |
| `src/hynous/intelligence/tools/conflicts.py` | Rewrite `list` action with full content + rewrite `resolve` action with outcome feedback | Lines 85-130 (list), 132-144 (resolve) |
| `src/hynous/intelligence/daemon.py` | Rewrite conflict wake message with full content | Lines 1018-1062 (inside `_check_conflicts`) |

**Files NOT modified:**
- `src/hynous/nous/client.py` — no changes needed, `resolve_conflict()` already returns `resp.json()` and the new fields flow through automatically
- `src/hynous/intelligence/tools/registry.py` — no new tools, existing `conflicts` tool is already registered
- `nous-server/server/src/index.ts` — contradiction route already mounted
- `config/default.yaml` — no new config needed
