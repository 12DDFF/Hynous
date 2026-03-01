# MF-0: Search-Before-Store Deduplication — Implementation Guide

> Detailed implementation specification for the engineering agent. Every decision is finalized. Follow this exactly.

---

## 0. Prerequisites — Read Before Implementing

Before writing any code, read these files **in order** to understand the system you're modifying.

### Required Reading (do all of these)

| Order | File | Why |
|---|---|---|
| 1 | `ARCHITECTURE.md` | System overview — understand the 4-layer architecture (Dashboard → FastAPI → Nous → Hydra) and how they communicate |
| 2 | `src/hynous/intelligence/README.md` | Intelligence module structure — tools, prompts, daemon, memory_manager. Shows how tools are registered and how the daemon works |
| 3 | `src/hynous/intelligence/tools/README.md` | Tool conventions — the standard pattern for TOOL_DEF + handler + register(). Every tool follows this |
| 4 | `src/hynous/nous/README.md` | Python↔Nous HTTP client — all existing NousClient methods and which endpoints they call |
| 5 | `src/hynous/intelligence/tools/memory.py` | **Primary file you'll modify.** Read the entire file (785 lines). Understand: `_TYPE_MAP`, queue system (`_queue_mode`, `flush_memory_queue`), `handle_store_memory()`, `_store_memory_impl()`, `_auto_link()`, `_resolve_wikilinks()` |
| 6 | `src/hynous/nous/client.py` | **Second file you'll modify.** Read the entire file (289 lines). Understand: `NousClient` class, `_url()` helper, `_session` (requests.Session), how methods like `search()` and `create_node()` work |
| 7 | `nous-server/server/src/routes/nodes.ts` | **Third file you'll modify.** Read the entire file (282 lines). Understand: Hono route patterns, how `POST /nodes` creates nodes and generates embeddings (fire-and-forget IIFE at lines 52-75), how `POST /nodes/backfill-embeddings` builds text and embeds in batch |
| 8 | `nous-server/server/src/embed.ts` | Server's embedding utilities (119 lines). Understand: `embedTexts()`, `buildNodeText()`, `buildContextPrefix()` — you'll use all three in the new endpoint |
| 9 | `nous-server/server/src/db.ts` | Database schema (230 lines). Understand: `nodes` table columns (especially `embedding_vector BLOB`, `embedding_model TEXT`, `subtype TEXT`, `state_lifecycle TEXT`), `getDb()` singleton, `@libsql/client` usage |
| 10 | `nous-server/server/src/index.ts` | Server entry point (57 lines). Understand: how routes are mounted (`app.route('/', nodes)`) under `.basePath('/v1')` — this is why your new route auto-registers |

### Reference Reading (skim for context, don't need to memorize)

| File | Why |
|---|---|
| `nous-server/core/src/embeddings/index.ts` | Core embedding library. Lines 54-59 for threshold constants (`SIMILARITY_EDGE_THRESHOLD = 0.90`, `DEDUP_CHECK_THRESHOLD = 0.95`, `COMPARISON_DIMS = 512`). Lines 954-1012 for `cosineSimilarity()`, `truncateForComparison()`, `checkSimilarity()` |
| `config/default.yaml` | Runtime config — `nous.url`, `memory.max_context_tokens`, `memory.retrieve_limit` |
| `revisions/nous-wiring/more-functionality.md` | MF-0 section (lines 41-59) describes the original problem statement |
| `revisions/nous-wiring/executive-summary.md` | Section 7 describes the deduplication gap this implementation fills |

### Auditor Notes

Check the `revisions/MF0/` directory for any additional files from the auditor before and during implementation. These may contain change requests or corrections that supersede parts of this guide.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Architecture Decisions](#2-architecture-decisions)
3. [Change 1: Nous Endpoint — `POST /v1/nodes/check-similar`](#3-change-1-nous-endpoint)
4. [Change 2: Python Client Method — `check_similar()`](#4-change-2-python-client-method)
5. [Change 3: Dedup Gate in `_store_memory_impl()`](#5-change-3-dedup-gate)
6. [Change 4: Queue Bypass for Dedup-Eligible Types](#6-change-4-queue-bypass)
7. [Change 5: Edge Creation for Connect Tier](#7-change-5-edge-creation-for-connect-tier)
8. [Change 6: Update `STORE_TOOL_DEF` Description](#8-change-6-update-store-tool-def-description)
9. [Change 7: Documentation Updates](#9-change-7-documentation-updates)
10. [Error Handling & Fallbacks](#10-error-handling--fallbacks)
11. [Edge Cases](#11-edge-cases)
12. [File-by-File Change Summary](#12-file-by-file-change-summary)

---

## 1. Problem Statement

Every `store_memory` call unconditionally creates a new node in Nous. There is zero logic to check whether a similar or identical memory already exists. The storage path in `_store_memory_impl()` (`src/hynous/intelligence/tools/memory.py`, line 311) goes straight to `client.create_node()` without any search or comparison.

This means: if the agent learns "never trade during low-volume weekends" three times across separate sessions, that's three separate nodes with their own FSRS stability, edges, and embeddings. On recall, SSA returns all three, wasting the retrieval budget on redundant information.

MF-0 adds a **search-before-store** step for specific memory types, using a new Nous endpoint that leverages existing deduplication infrastructure (`checkSimilarity()`, `DEDUP_CHECK_THRESHOLD`, `cosineSimilarity()`, Matryoshka 512-dim comparison) that was built but never wired.

---

## 2. Architecture Decisions

These decisions are **final**. Do not deviate.

### 2.1 Type-Gating: Only `lesson` and `curiosity` Are Dedup-Eligible

| Memory Type | Dedup? | Rationale |
|---|---|---|
| `lesson` | **Yes** | Same insight repeated = redundant. "Never trade weekends" stored 3x is waste. |
| `curiosity` | **Yes** | Same question asked twice = redundant. |
| `thesis` | No | Evolution trail is valuable. Multiple thesis nodes show how thinking developed over time. Agent can learn from the progression. Connected via auto-linking. |
| `signal` | No | Point-in-time data snapshot. Each is unique by definition. |
| `episode` | No | Distinct events, even if about the same topic. |
| `trade` | No | Manual trade records are unique. |
| `trade_entry` | No | Each trade is unique. Created by `trading.py`, not `_store_memory_impl()`. |
| `trade_close` | No | Each trade outcome is unique. Created by `trading.py`. |
| `trade_modify` | No | Each position adjustment is unique. Created by `trading.py`. |
| `watchpoint` | No | Each has unique trigger conditions. |
| `turn_summary` | No | Auto-generated by compression. Not user-facing. |
| `session_summary` | No | Auto-generated. Not user-facing. |

**Implementation**: The dedup check runs inside `_store_memory_impl()` and is gated by `memory_type in ("lesson", "curiosity")`. All other types skip directly to `client.create_node()`.

### 2.2 Dedup Mechanism: New Nous Endpoint

A new `POST /v1/nodes/check-similar` endpoint on the Nous server. Uses existing core library functions:

- `checkSimilarity()` from `core/src/embeddings/index.ts` — compares two embeddings at 512 dims
- `DEDUP_CHECK_THRESHOLD = 0.95` from `core/src/embeddings/index.ts` — cosine similarity for near-duplicate
- `SIMILARITY_EDGE_THRESHOLD = 0.90` from `core/src/embeddings/index.ts` — cosine similarity for auto-linking
- `cosineSimilarity()` from `core/src/embeddings/index.ts` — raw cosine similarity math
- Matryoshka 512-dim truncation for fast comparison

**Why not use existing SSA search?** SSA search (`POST /v1/search`) returns a 6-signal composite score (semantic 0.30, keyword 0.15, graph 0.20, recency 0.15, authority 0.10, affinity 0.10). For dedup, we need **pure semantic similarity** — the other 5 signals (recency, authority, affinity, graph, keyword) actively distort the comparison. A lesson from 2 months ago that's identical to the new content could score lower than a different lesson from yesterday because recency and affinity boost the newer one. Additionally, QCS might classify short queries as LOOKUP and disable embeddings entirely, making the semantic score 0.

### 2.3 Similarity Tiers and Outcomes

| Cosine Similarity | Nous Constant | Tier | Action |
|---|---|---|---|
| >= 0.95 | `DEDUP_CHECK_THRESHOLD` | **Duplicate** | Drop the new node. Return existing node's ID, title, lifecycle to the agent. |
| 0.90 – 0.95 | `SIMILARITY_EDGE_THRESHOLD` | **Connect** | Create the new node normally. Create explicit `relates_to` edges from check-similar results. |
| < 0.90 | — | **Unique** | Create the new node normally. No extra action (auto-link handles general connectivity). |

### 2.4 Queue Bypass for Dedup-Eligible Types

Lesson and curiosity stores **bypass the memory queue** and always store directly, even during the agent's thinking loop (when `_queue_mode` is True). This ensures the agent gets real-time dedup feedback ("Stored" or "Duplicate") instead of a blind "Queued" confirmation that can't be corrected later.

All other memory types continue to use the queue as normal.

**Latency impact**: ~200ms per lesson/curiosity store (embedding generation + comparison). This is comparable to other blocking tools (`recall_memory`, `update_memory`, `get_market_data`). The agent stores 0-2 lessons per response typically. Acceptable.

### 2.5 Embedding Cost

The check-similar endpoint generates an embedding for the new content. Node creation later generates another embedding for the same content. This is a double-embed. The cost is ~$0.000008 per store (OpenAI text-embedding-3-small). At 5-10 lessons/curiosity per day, that's $0.00004-0.00008/day. Do not optimize this — the complexity of shuttling embeddings between calls is not worth the savings.

### 2.6 Fallback on Failure

If the check-similar endpoint fails (Nous down, embedding generation fails, network timeout), **fall back to creating the node normally** without the dedup check. A duplicate is better than a lost memory. Dedup is an optimization, not a safety gate. Log the failure at WARNING level and proceed.

### 2.7 Duplicate Lifecycle Handling

If a duplicate is found (>= 0.95) but the existing node is DORMANT or WEAK, still treat it as a duplicate. Return the existing node's lifecycle in the feedback message so the agent can reactivate it if desired:

```
Duplicate: already stored as "Avoid weekend trading" (n_xyz789) [DORMANT]. Not created. Use update_memory to reactivate if needed.
```

The agent can then call `update_memory(node_id="n_xyz789", lifecycle="ACTIVE")` to bring it back.

---

## 3. Change 1: Nous Endpoint — `POST /v1/nodes/check-similar`

### File: `nous-server/server/src/routes/nodes.ts`

This file currently has 282 lines containing 6 routes: POST /nodes (create), GET /nodes/:id, GET /nodes (list), PATCH /nodes/:id (update), DELETE /nodes/:id, and POST /nodes/backfill-embeddings. Add the new route **between the DELETE route (line 243) and the BACKFILL route (line 246)**. No new file needed — the `nodes` Hono router is already mounted at `/v1/` in `server/src/index.ts` via `app.route('/', nodes)`, so the route will automatically be available at `POST /v1/nodes/check-similar`.

### Existing Imports in `nodes.ts` (lines 1-12)

The file already imports everything needed for embedding generation:

```typescript
import { Hono } from 'hono';
import { getDb } from '../db.js';
import { nodeId, now } from '../utils.js';
import {
  getNeuralDefaults,
  applyDecay,
  computeStabilityGrowth,
  type NodeRow,
} from '../core-bridge.js';
import { embedTexts, buildNodeText, buildContextPrefix } from '../embed.js';
import { runTier2Pattern } from '@nous/core/contradiction';
import { nanoid } from 'nanoid';
```

**Add this one import** to the top of the file (after the existing imports):

```typescript
import {
  cosineSimilarity,
  truncateForComparison,
  DEDUP_CHECK_THRESHOLD,
  SIMILARITY_EDGE_THRESHOLD,
  COMPARISON_DIMS,
} from '@nous/core/embeddings';
```

These are all exported from `nous-server/core/src/embeddings/index.ts` and re-exported via `core/src/index.ts`. The values:
- `DEDUP_CHECK_THRESHOLD` = 0.95 (line 59 of `core/src/embeddings/index.ts`)
- `SIMILARITY_EDGE_THRESHOLD` = 0.90 (line 54)
- `COMPARISON_DIMS` = 512 (line 39)
- `cosineSimilarity(a: Float32Array, b: Float32Array): number` (line 954) — dot product / (norm_a * norm_b)
- `truncateForComparison(vector: Float32Array, dims: number): Float32Array` (line 978) — `vector.slice(0, dims)`

> **Why NOT use `checkSimilarity()` from core?** It requires `NodeEmbedding` interface objects with fields like `model`, `contextPrefix`, `contextHash`, `provisional`, `version` — which we don't have when reading raw BLOBs from the database. Using `cosineSimilarity()` and `truncateForComparison()` directly is simpler and equivalent.

### Route: `POST /v1/nodes/check-similar`

#### Request Body

```typescript
// Content, title, and subtype are ALL required. Return 400 if any missing.
interface CheckSimilarRequest {
  content: string;    // The full content text (maps to content_body)
  title: string;      // The title (maps to content_title)
  subtype: string;    // Nous subtype to filter: "custom:lesson" or "custom:curiosity"
  limit?: number;     // Max matches to return (default 5)
}
```

### Complete Route Handler Code

Insert this between the DELETE handler and the BACKFILL handler in `nodes.ts`:

```typescript
// ---- CHECK SIMILAR (dedup pre-check for lesson/curiosity) ----
nodes.post('/nodes/check-similar', async (c) => {
  const body = await c.req.json();
  const { content, title, subtype, limit = 5 } = body;

  if (!content || !title || !subtype) {
    return c.json({ error: 'content, title, and subtype are required' }, 400);
  }

  // Step 1: Build embedding text using the SAME functions used by POST /nodes
  // and POST /nodes/backfill-embeddings — ensures apples-to-apples comparison.
  //
  // buildNodeText() is from '../embed.js' (already imported at top of file).
  // It concatenates title + summary + body, capped at 30K chars.
  // We pass null for summary since incoming memories don't have one yet.
  //
  // buildContextPrefix() maps subtype to a label like "[lesson]" or "[curiosity]".
  // This prefix is prepended to the text before embedding — same as node creation.
  const text = buildNodeText(title, null, content);
  const prefix = buildContextPrefix('concept', subtype);

  // Step 2: Generate embedding via OpenAI text-embedding-3-small (1536 dims)
  //
  // embedTexts() is from '../embed.js' (already imported). It calls OpenAI API
  // directly via fetch(). Returns Float32Array[]. Returns empty Float32Array if
  // OPENAI_API_KEY is not set or on error.
  let newEmbedding: Float32Array;
  try {
    const [emb] = await embedTexts([prefix + ' ' + text]);
    if (!emb || emb.length === 0) {
      return c.json({ error: 'embedding generation failed: empty result' }, 500);
    }
    newEmbedding = emb;
  } catch (e: any) {
    return c.json({ error: `embedding generation failed: ${e.message}` }, 500);
  }

  // Step 3: Fetch candidate nodes of the same subtype that have embeddings.
  //
  // Database: @libsql/client (SQLite). getDb() returns singleton Client.
  // Schema from db.ts:
  //   nodes.embedding_vector  — BLOB column (stored via Buffer.from(float32array.buffer))
  //   nodes.subtype           — TEXT column (e.g., "custom:lesson")
  //   nodes.state_lifecycle   — TEXT column (ACTIVE, WEAK, DORMANT)
  //   nodes.content_title     — TEXT column
  //   nodes.provenance_created_at — TEXT column (ISO timestamp)
  //
  // We fetch limit*3 candidates (over-fetch) then take the top matches.
  // ORDER BY provenance_created_at DESC so we compare against recent nodes first.
  // Candidate count is small (maybe 10-50 lessons total), so brute-force is fine.
  const db = getDb();
  let candidates: any[];
  try {
    const result = await db.execute({
      sql: `SELECT id, content_title, state_lifecycle, embedding_vector
            FROM nodes
            WHERE subtype = ? AND embedding_vector IS NOT NULL
            ORDER BY provenance_created_at DESC
            LIMIT ?`,
      args: [subtype, limit * 3],
    });
    candidates = result.rows as any[];
  } catch (e: any) {
    return c.json({ error: `similarity search failed: ${e.message}` }, 500);
  }

  // No candidates = unique by definition
  if (candidates.length === 0) {
    return c.json({ matches: [], recommendation: 'unique' });
  }

  // Step 4: Compare new embedding against each candidate using cosine similarity.
  //
  // truncateForComparison() slices to 512 dims (Matryoshka Stage 2) for speed.
  // cosineSimilarity() computes dot(a,b) / (||a|| * ||b||) on Float32Arrays.
  // Both imported from '@nous/core/embeddings' (added import at top).
  //
  // BLOB deserialization: @libsql/client returns BLOB columns as ArrayBuffer.
  // The embedding was stored as Buffer.from(float32array.buffer) — raw bytes of
  // the Float32Array. To reconstruct: new Float32Array(arrayBuffer).
  // If the runtime returns a Buffer/Uint8Array instead, we handle that too.
  const truncatedNew = truncateForComparison(newEmbedding, COMPARISON_DIMS);

  interface Match {
    node_id: string;
    title: string;
    similarity: number;
    action: 'duplicate' | 'connect';
    lifecycle: string;
  }

  const matches: Match[] = [];

  for (const row of candidates) {
    // Deserialize embedding BLOB → Float32Array
    const blob = row.embedding_vector;
    if (!blob) continue;

    let candidateVec: Float32Array;
    try {
      if (blob instanceof ArrayBuffer) {
        candidateVec = new Float32Array(blob);
      } else if (blob instanceof Uint8Array || Buffer.isBuffer(blob)) {
        // Ensure proper alignment by copying to a new ArrayBuffer
        const aligned = new Uint8Array(blob).buffer;
        candidateVec = new Float32Array(aligned);
      } else {
        continue; // Unknown format, skip
      }
    } catch {
      continue; // Malformed embedding, skip
    }

    // Truncate candidate to 512 dims to match
    const truncatedCandidate = truncateForComparison(candidateVec, COMPARISON_DIMS);

    // Compute cosine similarity
    let similarity: number;
    try {
      similarity = cosineSimilarity(truncatedNew, truncatedCandidate);
    } catch {
      continue; // Length mismatch or other error, skip
    }

    // Categorize: duplicate (>= 0.95), connect (>= 0.90), or skip
    let action: 'duplicate' | 'connect' | 'none';
    if (similarity >= DEDUP_CHECK_THRESHOLD) {
      action = 'duplicate';
    } else if (similarity >= SIMILARITY_EDGE_THRESHOLD) {
      action = 'connect';
    } else {
      action = 'none';
    }

    if (action !== 'none') {
      matches.push({
        node_id: row.id as string,
        title: (row.content_title as string) ?? 'Untitled',
        similarity: Math.round(similarity * 10000) / 10000, // 4 decimal places
        action,
        lifecycle: (row.state_lifecycle as string) ?? 'ACTIVE',
      });
    }
  }

  // Step 5: Sort by similarity descending, take top `limit`
  matches.sort((a, b) => b.similarity - a.similarity);
  const topMatches = matches.slice(0, limit);

  // Step 6: Determine recommendation
  let recommendation: 'duplicate_found' | 'similar_found' | 'unique';
  if (topMatches.some((m) => m.action === 'duplicate')) {
    recommendation = 'duplicate_found';
  } else if (topMatches.length > 0) {
    recommendation = 'similar_found';
  } else {
    recommendation = 'unique';
  }

  return c.json({ matches: topMatches, recommendation });
});
```

### Why This Approach Works

**Embedding generation** — The handler uses `buildNodeText()`, `buildContextPrefix()`, and `embedTexts()` — the exact same pipeline used by `POST /nodes` (line 61-63 of `nodes.ts`) and `POST /nodes/backfill-embeddings` (line 257-263). This guarantees the new content is embedded in the same vector space as stored nodes. The text format is: `"[lesson] Title. Content body"` — prefix + space + concatenated text.

**Brute-force comparison** — Instead of wiring into SSA's vector search infrastructure (`context.vectorSearch`), we directly query the DB and compare embeddings. This is acceptable because:
- We filter by subtype, so the candidate set is small (maybe 10-50 lessons total, bounded by LIMIT)
- `cosineSimilarity()` at 512 dims is ~0.01ms per comparison
- 50 comparisons = ~0.5ms total, negligible vs the ~100ms embedding API call
- Avoids importing SSA context factory, hybrid seeding, and the entire SSA pipeline

**BLOB deserialization** — Embeddings are stored in the `embedding_vector BLOB` column as `Buffer.from(embedding.buffer)` (see `nodes.ts` line 65). When read back via `@libsql/client`, BLOBs come back as `ArrayBuffer`. Since the original data was a `Float32Array`'s underlying buffer, we reconstruct with `new Float32Array(arrayBuffer)`. The handler includes a fallback for `Buffer`/`Uint8Array` return types to be safe.

**No route registration needed** — The route is added to the existing `nodes` Hono router. `index.ts` (line 25) mounts it via `app.route('/', nodes)`, and `app` uses `.basePath('/v1')` (line 17). So the route is automatically accessible at `POST /v1/nodes/check-similar`.

### Response Body

```typescript
interface CheckSimilarResponse {
  matches: Array<{
    node_id: string;          // ID of the existing similar node
    title: string;            // content_title of the existing node
    similarity: number;       // Cosine similarity (0-1), rounded to 4 decimal places
    action: 'duplicate' | 'connect';  // Based on thresholds (>= 0.95 or >= 0.90)
    lifecycle: string;        // state_lifecycle: ACTIVE, WEAK, or DORMANT
  }>;
  recommendation: 'duplicate_found' | 'similar_found' | 'unique';
  // 'duplicate_found' if any match has action='duplicate'
  // 'similar_found' if matches exist but none are duplicates
  // 'unique' if no matches at all
}
```

### Example Responses

**Duplicate found:**
```json
{
  "matches": [
    {
      "node_id": "n_abc123",
      "title": "Avoid trading during low-volume weekends",
      "similarity": 0.9712,
      "action": "duplicate",
      "lifecycle": "ACTIVE"
    }
  ],
  "recommendation": "duplicate_found"
}
```

**Similar but not duplicate:**
```json
{
  "matches": [
    {
      "node_id": "n_def456",
      "title": "Low liquidity increases slippage",
      "similarity": 0.9234,
      "action": "connect",
      "lifecycle": "ACTIVE"
    }
  ],
  "recommendation": "similar_found"
}
```

**No matches (unique content):**
```json
{
  "matches": [],
  "recommendation": "unique"
}
```

### Error Handling

| Condition | HTTP Status | Response |
|---|---|---|
| Missing `content`, `title`, or `subtype` | 400 | `{error: "content, title, and subtype are required"}` |
| `embedTexts()` returns empty/throws | 500 | `{error: "embedding generation failed: <detail>"}` |
| DB query fails | 500 | `{error: "similarity search failed: <detail>"}` |
| No nodes of given subtype exist | 200 | `{matches: [], recommendation: "unique"}` |
| Individual candidate BLOB malformed | — | Skipped silently (try/catch inside loop) |

---

## 4. Change 2: Python Client Method — `check_similar()`

### File: `src/hynous/nous/client.py`

This file is 289 lines. `NousClient` class starts at line 34. Methods use `self._session` (a `requests.Session`) and `self._url(path)` which returns `f"{self.base_url}/v1{path}"`.

Add the new method **after the `search()` method (which ends at line 280) and before the `classify_query()` method (line 284)**. This keeps it near the search-related methods.

**Existing pattern reference** — look at the `search()` method (line 240-280) for the POST + JSON + `resp.raise_for_status()` pattern:

```python
def search(self, query: str, ...) -> list[dict]:
    payload: dict = {"query": query, "limit": limit}
    ...
    resp = self._session.post(self._url("/search"), json=payload)
    resp.raise_for_status()
    data = resp.json()
    ...
    return data.get("data", [])
```

### Insert This Method

```python
def check_similar(
    self,
    content: str,
    title: str,
    subtype: str,
    limit: int = 5,
) -> dict:
    """Check if similar nodes exist before storing.

    Compares content embedding against existing nodes of the same subtype.
    Returns similarity matches with recommended actions based on thresholds:
      - duplicate (>= 0.95 cosine): near-identical content exists
      - connect (0.90-0.95 cosine): similar content, should link

    Used by _store_memory_impl() for lesson and curiosity dedup.
    """
    resp = self._session.post(
        self._url("/nodes/check-similar"),
        json={
            "content": content,
            "title": title,
            "subtype": subtype,
            "limit": limit,
        },
    )
    resp.raise_for_status()
    return resp.json()
```

This method:
- Calls `POST /v1/nodes/check-similar` (the endpoint added in Change 1)
- Returns the full response dict with keys `matches` (list) and `recommendation` (string)
- Raises `requests.HTTPError` on non-2xx responses (caught by the caller's `try/except Exception`)
- No special error handling needed here — the dedup gate in `_store_memory_impl()` catches all exceptions and falls back to normal creation

---

## 5. Change 3: Dedup Gate in `_store_memory_impl()`

### File: `src/hynous/intelligence/tools/memory.py`

This file is 785 lines. `_store_memory_impl()` starts at line 311 and ends at line 396. It takes the same params as `handle_store_memory()` (content, memory_type, title, trigger, signals, link_ids, event_time).

#### Current Flow of `_store_memory_impl()` (lines 311-396)

```python
# Line 321-322: Import get_client, resolve type/subtype
from ...nous.client import get_client
node_type, subtype = _TYPE_MAP[memory_type]   # e.g. ("concept", "custom:lesson")

# Line 325-334: Auto-set event_time for event-like types
_event_time = event_time
...

# Line 336-345: Build content_body (plain text or JSON with trigger/signals)
if trigger or signals:
    body_data: dict = {"text": content}
    ...
    body = json.dumps(body_data)
else:
    body = content

# Line 347-348: Build summary
summary = content[:500] if len(content) > 500 else None

# Line 350-361: Create node via Nous HTTP API  ← DEDUP CHECK GOES BEFORE THIS
try:
    client = get_client()
    node = client.create_node(...)

# Line 363-376: Create explicit edges for link_ids
# Line 378-379: Resolve [[wikilinks]] (background thread)
# Line 381-382: Auto-link by title (background thread)
# Line 384-392: Return result message
```

#### Where to Insert

Insert the dedup check **after line 348** (`summary = content[:500] if len(content) > 500 else None`) and **before line 350** (`try:`). The `subtype` variable is already set at line 323 from `_TYPE_MAP`, so we can use it directly.

#### Exact Code to Insert

Between line 348 and line 350, insert:

```python
    # --- Dedup check for eligible types (MF-0) ---
    # Only lesson and curiosity go through dedup. All other types create immediately.
    # This check calls POST /v1/nodes/check-similar on Nous to compare the new
    # content's embedding against existing nodes of the same subtype.
    _connect_matches = []
    if memory_type in ("lesson", "curiosity"):
        try:
            dedup_client = get_client()
            similar = dedup_client.check_similar(
                content=content,
                title=title,
                subtype=subtype,
                limit=5,
            )

            recommendation = similar.get("recommendation", "unique")
            matches = similar.get("matches", [])

            # DUPLICATE (>= 0.95 cosine): drop the new node entirely
            if recommendation == "duplicate_found":
                top = matches[0]  # Highest similarity match (sorted by Nous)
                dup_title = top.get("title", "Untitled")
                dup_id = top.get("node_id", "?")
                dup_lifecycle = top.get("lifecycle", "ACTIVE")
                dup_sim = top.get("similarity", 0)
                sim_pct = int(dup_sim * 100)

                logger.info(
                    "Dedup: dropped %s \"%s\" — duplicate of \"%s\" (%s, %d%% similar)",
                    memory_type, title, dup_title, dup_id, sim_pct,
                )

                result_msg = (
                    f"Duplicate: already stored as \"{dup_title}\" ({dup_id})"
                )
                if dup_lifecycle != "ACTIVE":
                    result_msg += f" [{dup_lifecycle}]"
                    result_msg += ". Use update_memory to reactivate if needed"
                result_msg += f". Not created. ({sim_pct}% similar)"
                return result_msg

            # CONNECT tier matches (0.90-0.95) — save for edge creation after node is created
            _connect_matches = [
                m for m in matches if m.get("action") == "connect"
            ]

        except Exception as e:
            # Dedup check failed — fall back to creating normally.
            # A duplicate is better than a lost memory. Dedup is optimization, not safety.
            logger.warning("Dedup check failed, creating normally: %s", e)
            _connect_matches = []
```

**Important notes:**
- `_connect_matches` is initialized to `[]` before the `if` block so it's always defined, even for non-dedup types
- The `subtype` variable (e.g., `"custom:lesson"`) comes from line 323: `node_type, subtype = _TYPE_MAP[memory_type]`
- The `get_client()` import is at line 321 (`from ...nous.client import get_client`) — already in scope
- If the dedup check returns `duplicate_found`, the function **returns immediately** without calling `create_node()`
- If the dedup check returns `similar_found` or `unique`, execution continues to `create_node()` below
- The `_connect_matches` list is consumed after node creation (see below)

#### Edge Creation for Connect-Tier Matches

After the auto-link call (line 382: `_auto_link(node_id, title, content, explicit_ids=link_ids)`), add:

```python
        # Create edges for connect-tier matches from dedup check (0.90-0.95 similarity)
        if _connect_matches:
            for match in _connect_matches:
                match_id = match.get("node_id")
                if match_id:
                    try:
                        client.create_edge(
                            source_id=node_id,
                            target_id=match_id,
                            type="relates_to",
                        )
                    except Exception as e:
                        logger.debug("Failed to link connect-tier match %s → %s: %s", node_id, match_id, e)
```

This is **inside** the existing `try:` block (line 350) that wraps `create_node()` and edge creation, so the `client` variable is already available. The `node_id` variable was set at line 363: `node_id = node.get("id", "?")`.

These `relates_to` edges are in **addition to** `_auto_link()` (line 382) which still runs for all stores. `_auto_link` searches by title (SSA search), while these edges come from pure embedding similarity — they may or may not overlap.

---

## 6. Change 4: Queue Bypass for Dedup-Eligible Types

### File: `src/hynous/intelligence/tools/memory.py`

`handle_store_memory()` starts at line 281 and ends at line 308. It's the entry point called by the tool registry when the agent calls `store_memory`.

#### Current Code at Line 299-306

```python
    if _queue_mode:
        with _queue_lock:
            _memory_queue.append(kwargs)
        wikilinks = _WIKILINK_RE.findall(content)
        result = f"Queued: \"{title}\""
        if wikilinks:
            result += f" (will link: {', '.join(wikilinks)})"
        return result
```

When `_queue_mode` is True (active during agent's thinking loop), this queues ALL memory stores as instant "Queued: title" responses. The queue is later flushed by `flush_memory_queue()` (line 56) which calls `_store_memory_impl()` for each item in a background thread.

**Problem**: If lesson/curiosity goes through the queue, the dedup check in `_store_memory_impl()` runs in the background after the agent's response is complete. The agent already told the user "Queued: lesson title" and can't take it back if the lesson turns out to be a duplicate.

#### New Code — Replace Line 299

Change **only line 299** from:

```python
    if _queue_mode:
```

to:

```python
    if _queue_mode and memory_type not in ("lesson", "curiosity"):
```

The **only change** is adding `and memory_type not in ("lesson", "curiosity")` to the condition on line 299. The rest of the block (lines 300-306) stays identical.

This ensures:
- **Lesson and curiosity** always fall through to `_store_memory_impl()` on line 308, which runs the dedup check and returns real-time feedback ("Stored: ..." or "Duplicate: ...")
- **All other types** (thesis, episode, signal, trade, watchpoint, etc.) continue to use the queue as normal — they don't need dedup so the "Queued" response is fine

---

## 7. Change 5: Edge Creation for Connect Tier

This is already covered in Change 3 above (the `_connect_matches` loop after node creation). No separate change needed — it's part of the `_store_memory_impl()` modification.

To summarize: when the check-similar endpoint returns matches with `action: "connect"` (0.90-0.95 similarity), the implementation creates `relates_to` edges from the new node to each connect-tier match. These edges are created directly (not in a background thread) since there are at most 5 matches and each `create_edge` call takes ~5ms.

This is **in addition to** `_auto_link()` which still runs after every store. `_auto_link()` searches by title and may or may not find the same nodes. The dedup-derived edges are more precise (embedding-based), while auto-link edges are broader (title-based). Both are valuable.

---

## 8. Change 6: Update `STORE_TOOL_DEF` Description

### File: `src/hynous/intelligence/tools/memory.py`

`STORE_TOOL_DEF` is defined at line 194. Its `"description"` key is a multi-line string (lines 197-220) containing paragraphs about memory types, wikilinks, and batching.

The description currently ends with:

```python
        "flush to Nous after your response is complete. Call multiple store_memory "
        "in one response for related memories. Use [[wikilinks]] to cross-reference."
    ),
```

**Add the dedup paragraph** before the closing `),` — concatenate it to the existing description string. Insert after the "Use [[wikilinks]] to cross-reference." line:

```python
        "in one response for related memories. Use [[wikilinks]] to cross-reference."
        "\n\n"
        "DEDUPLICATION: Lessons and curiosity items are checked for duplicates before "
        "storing. If a very similar memory already exists (95%+ match), the new one "
        "won't be created — you'll see which existing memory matched. If a moderately "
        "similar memory exists (90-95% match), the new one is created and linked to it."
    ),
```

The agent needs to know about dedup so it:
- Understands why some stores return "Duplicate: already stored as..." instead of "Stored: ..."
- Knows to use `update_memory` to reactivate a dormant duplicate instead of re-storing
- Doesn't try to store the same lesson repeatedly when it gets the "Duplicate" feedback

---

## 9. Change 7: Documentation Updates

> **DEFERRED** — Do NOT mark MF-0 as DONE in any documentation yet. We are iterating on the implementation and verifying it works correctly first. An auditor will review changes and may add revision files in the `revisions/MF0/` directory. Documentation updates will happen after final verification.
>
> The instructions below describe what to update **once MF-0 is verified and approved**. Do not apply them during the initial implementation.

### 9.1 `revisions/nous-wiring/more-functionality.md` — DEFERRED

Change the MF-0 header from:

```markdown
## MF-0. [P1] Search-Before-Store — Deduplication and Consolidation
```

to:

```markdown
## ~~MF-0. [P1] Search-Before-Store — Deduplication and Consolidation~~ DONE
```

Add a "Status: Implemented" section at the top of the MF-0 section (below the header, above "### What it is"):

```markdown
**Status:** Implemented.

**What was done:**

1. **New Nous endpoint** — `POST /v1/nodes/check-similar` compares new content against existing nodes of the same subtype using embedding cosine similarity at 512 dims (Matryoshka Stage 2). Returns tiered matches: `duplicate` (>= 0.95 DEDUP_CHECK_THRESHOLD), `connect` (>= 0.90 SIMILARITY_EDGE_THRESHOLD), or `unique`.

2. **Python client method** — `check_similar()` added to `NousClient` in `client.py`.

3. **Dedup gate** — `_store_memory_impl()` in `memory.py` checks for duplicates before `create_node()` for lesson and curiosity types only. Duplicates are dropped with a feedback message including the existing node's ID, title, and lifecycle. Connect-tier matches (0.90-0.95) get explicit `relates_to` edges after node creation.

4. **Queue bypass** — Lesson and curiosity stores bypass the memory queue (`_queue_mode`) and always execute directly, ensuring the agent receives real-time dedup feedback.

5. **Type-gating** — Only `lesson` and `curiosity` are dedup-eligible. All other types (thesis, signal, episode, trade, watchpoint, etc.) create immediately without dedup checks. Theses are deliberately excluded to preserve the evolution trail.

6. **Fallback** — If the dedup check fails (Nous down, embedding error), falls back to normal node creation. Dedup is an optimization, not a safety gate.
```

### 9.2 `revisions/nous-wiring/executive-summary.md` — DEFERRED

In section "7. No Deduplication or Consolidation — Unchecked Node Proliferation", change the header to include RESOLVED:

```markdown
### ~~7. No Deduplication or Consolidation — Unchecked Node Proliferation~~ RESOLVED
```

Add a status note at the top of that section:

```markdown
**Status:** Resolved via MF-0. Lesson and curiosity types now go through a search-before-store dedup check using a new Nous endpoint (`POST /v1/nodes/check-similar`). Duplicates (>= 0.95 cosine) are dropped. Similar content (0.90-0.95) is created and linked. Other types (thesis, signal, episode, trade, watchpoint) create unconditionally — by design.
```

### 9.3 `revisions/revision-exploration.md`

No changes needed — this file doesn't have a dedicated dedup issue entry. The relevant context is in the executive summary and more-functionality.md.

### 9.4 `src/hynous/intelligence/README.md` — DEFERRED

In the "Remaining:" section at the bottom, change:

```markdown
- `store_memory` always creates new nodes without checking for existing related memories (MF-0)
```

to:

```markdown
- ~~`store_memory` always creates new nodes without checking for existing related memories (MF-0)~~ — FIXED: lesson and curiosity types checked for duplicates via `POST /v1/nodes/check-similar` before creation
```

### 9.5 `src/hynous/nous/README.md` — DEFERRED

In the NousClient Methods table, add a new row:

```markdown
| `check_similar()` | `POST /v1/nodes/check-similar` | `_store_memory_impl()` dedup gate for lesson/curiosity |
```

In the "Remaining integration work" line at the bottom, change:

```markdown
Remaining integration work: search-before-store dedup (MF-0).
```

to:

```markdown
All integration work complete. Search-before-store dedup (MF-0) is DONE.
```

### 9.6 `src/hynous/intelligence/tools/README.md` — DEFERRED

In the Tools table entry for `memory.py`, update the Purpose column:

```markdown
| `memory.py` | `store_memory`, `recall_memory`, `update_memory` | Full memory CRUD (create with dedup for lesson/curiosity, search/browse/time-range, update) |
```

---

## 10. Error Handling & Fallbacks

### Nous Endpoint Errors

| Error | HTTP Status | Response |
|---|---|---|
| Missing required fields | 400 | `{error: "content, title, and subtype are required"}` |
| Embedding generation fails | 500 | `{error: "embedding generation failed: <detail>"}` |
| Vector search fails | 500 | `{error: "similarity search failed: <detail>"}` |
| No nodes of subtype exist | 200 | `{matches: [], recommendation: "unique"}` |

### Python-Side Fallback

In `_store_memory_impl()`, the entire dedup check is wrapped in `try/except Exception`. Any failure (network timeout, 500 from Nous, JSON parse error) falls through to normal node creation:

```python
except Exception as e:
    logger.warning("Dedup check failed, creating normally: %s", e)
    _connect_matches = []
```

This ensures dedup failures never prevent memory storage. The warning log provides visibility without breaking the flow.

### Nous Server-Side Fallback

The `embedTexts()` function in `server/src/embed.ts` calls OpenAI text-embedding-3-small (1536 dims) directly via fetch. If `OPENAI_API_KEY` is not set, it returns empty `Float32Array` arrays. If the API call fails (network error, rate limit), it catches the error and returns empty arrays.

In the check-similar handler, if `embedTexts()` returns an empty embedding (length 0), the endpoint returns HTTP 500. Python's dedup gate catches this and falls back to creating without dedup.

---

## 11. Edge Cases

### 11.1 First-Ever Lesson/Curiosity

When the knowledge base has zero lessons (or zero curiosity items), the check-similar endpoint returns `{matches: [], recommendation: "unique"}`. The dedup gate does nothing and creation proceeds normally.

### 11.2 Same Lesson Stored Twice in One Response

If the agent calls `store_memory` twice in one response for similar lessons:
- First call: goes through dedup check, no existing node found, creates normally
- Second call: goes through dedup check. The first node was JUST created (~200ms ago). Its embedding may or may not be ready yet.
  - **Why the race exists**: `POST /nodes` in `nodes.ts` (lines 52-75) generates embeddings in a fire-and-forget `async () => {...}` IIFE that runs **after** the HTTP response is sent. The node exists in DB immediately, but `embedding_vector` is NULL until the async embedding call completes (~100-200ms later).
  - If the embedding IS ready: the check-similar endpoint finds it (the SQL query filters `WHERE embedding_vector IS NOT NULL`) and returns `duplicate_found`. Second store is dropped.
  - If the embedding is NOT ready: the node has `embedding_vector = NULL`, so the check-similar query skips it, and returns `unique`. Second store creates a new node. This is a minor, rare edge case. Auto-link will likely connect them anyway.

This is acceptable. The race affects at most same-response stores and is inherent to the async embedding design.

### 11.3 Lesson Content Changed Slightly

"Never trade during low-volume weekends" vs "Avoid trading on weekends when volume is low" — these express the same insight differently. Cosine similarity at 512 dims would likely score 0.90-0.96 for these. The thresholds handle this correctly:
- If >= 0.95: duplicate, dropped
- If 0.90-0.95: connect tier, new node created + linked

This is the desired behavior — if the phrasing is different enough to score below 0.95, it's worth keeping as a separate node (the nuance might matter).

### 11.4 Lesson That Refines a Previous One

"Never trade during low-volume weekends" → "Never trade during low-volume weekends UNLESS funding is extremely negative" — this is a refinement, not a duplicate. The added conditional changes the semantics enough to push cosine similarity below 0.95 (the "UNLESS" clause adds new information). It would land in the connect tier or unique tier, creating a new node and potentially linking to the old one.

### 11.5 Dedup Check Returns Multiple Duplicates

If multiple existing nodes score >= 0.95 (e.g., the same lesson was stored before this feature existed), the endpoint returns all of them sorted by similarity. The Python dedup gate uses `matches[0]` (highest similarity) for the feedback message. The new node is still dropped — one feedback message is sufficient.

---

## 12. File-by-File Change Summary

### Nous Server (TypeScript)

| File | Change | Where | Lines |
|---|---|---|---|
| `nous-server/server/src/routes/nodes.ts` | Add import for `cosineSimilarity`, `truncateForComparison`, `DEDUP_CHECK_THRESHOLD`, `SIMILARITY_EDGE_THRESHOLD`, `COMPARISON_DIMS` from `@nous/core/embeddings` | After line 12 (existing imports) | ~5 lines |
| `nous-server/server/src/routes/nodes.ts` | Add `POST /v1/nodes/check-similar` route handler | Between DELETE handler (line 243) and BACKFILL handler (line 246) | ~90 new lines |

### Python Source

| File | Change | Where | Lines |
|---|---|---|---|
| `src/hynous/nous/client.py` | Add `check_similar()` method to `NousClient` | After `search()` method (line 280), before `classify_query()` (line 284) | ~20 new lines |
| `src/hynous/intelligence/tools/memory.py` | Add dedup gate in `_store_memory_impl()` | After line 348 (`summary = ...`), before line 350 (`try:`) | ~40 new lines |
| `src/hynous/intelligence/tools/memory.py` | Add connect-tier edge creation | After line 382 (`_auto_link(...)`) | ~10 new lines |
| `src/hynous/intelligence/tools/memory.py` | Change queue bypass condition in `handle_store_memory()` | Line 299: `if _queue_mode:` → `if _queue_mode and memory_type not in ("lesson", "curiosity"):` | 1 line changed |
| `src/hynous/intelligence/tools/memory.py` | Update `STORE_TOOL_DEF` description | After "Use [[wikilinks]] to cross-reference." (line 219) | ~4 new lines |

### Documentation — DEFERRED (do NOT apply until verified)

| File | Change |
|---|---|
| `revisions/nous-wiring/more-functionality.md` | Mark MF-0 as DONE, add implementation summary |
| `revisions/nous-wiring/executive-summary.md` | Mark section 7 as RESOLVED |
| `src/hynous/intelligence/README.md` | Mark MF-0 as FIXED in remaining issues |
| `src/hynous/nous/README.md` | Add `check_similar()` to method table, update remaining work |
| `src/hynous/intelligence/tools/README.md` | Update memory.py description in tools table |

### Total Scope

- **~95 lines new TypeScript** (imports + one endpoint handler)
- **~75 lines new/changed Python** (client method + dedup gate + connect edges + queue bypass + tool description)
- **~5 documentation files updated** (status markers and summaries)

### Implementation Order

1. **TypeScript first** — Add the Nous endpoint (Change 1). This can be tested independently with curl.
2. **Python client** — Add `check_similar()` method (Change 2).
3. **Dedup gate + queue bypass** — Modify `_store_memory_impl()` and `handle_store_memory()` (Changes 3-4).
4. **Tool description** — Update STORE_TOOL_DEF (Change 6).
5. **Documentation** — Mark everything as done (Change 7).

### Self-Review Checklist — REQUIRED Before Passing to Auditor

**Before submitting your work, you MUST thoroughly verify every change.** Read back every file you modified, confirm correctness, and run through this checklist. Do not hand off until all items pass.

#### TypeScript (`nodes.ts`)

- [ ] The new import from `@nous/core/embeddings` compiles — all 5 symbols exist and are exported
- [ ] The route path is exactly `'/nodes/check-similar'` (not `/check-similar` or `/nodes/checksimilar`)
- [ ] `buildNodeText()` and `buildContextPrefix()` are called with the same argument pattern as `POST /nodes` (lines 61-62) and backfill (lines 258-260)
- [ ] The embedding text is constructed as `prefix + ' ' + text` — matching the existing pattern at line 63
- [ ] The SQL query selects from `nodes` with correct column names: `id`, `content_title`, `state_lifecycle`, `embedding_vector` (verify against `db.ts` schema)
- [ ] The SQL WHERE clause filters by `subtype = ?` AND `embedding_vector IS NOT NULL`
- [ ] BLOB deserialization handles both `ArrayBuffer` and `Buffer`/`Uint8Array` return types
- [ ] `truncateForComparison()` is called with `COMPARISON_DIMS` (512), not a hardcoded number
- [ ] Threshold comparisons use the imported constants (`DEDUP_CHECK_THRESHOLD`, `SIMILARITY_EDGE_THRESHOLD`), not hardcoded 0.95/0.90
- [ ] The response JSON shape matches the spec: `{ matches: [...], recommendation: "..." }`
- [ ] Error responses return proper HTTP status codes (400 for bad input, 500 for server errors)
- [ ] The route is placed between DELETE and BACKFILL handlers — not accidentally inside another handler's scope
- [ ] Read the entire modified `nodes.ts` file top-to-bottom to verify nothing was broken

#### Python (`client.py`)

- [ ] `check_similar()` method uses `self._session.post()` and `self._url("/nodes/check-similar")` — matching the pattern of other methods like `search()`
- [ ] The method calls `resp.raise_for_status()` before `resp.json()` — matching every other method in the class
- [ ] The method is placed between `search()` and `classify_query()`, not accidentally inside another method

#### Python (`memory.py`)

- [ ] The dedup gate is inside `_store_memory_impl()`, NOT inside `handle_store_memory()`
- [ ] `_connect_matches = []` is initialized BEFORE the `if memory_type in (...)` block — so it's always defined
- [ ] The dedup check uses the `subtype` variable from line 323 (`_TYPE_MAP`), not a hardcoded string
- [ ] The duplicate feedback message includes node ID, title, lifecycle, and similarity percentage
- [ ] The `return result_msg` inside the duplicate branch actually exits the function — preventing `create_node()` from running
- [ ] Connect-tier edge creation is AFTER `_auto_link()` and INSIDE the existing `try:` block — uses the `client` and `node_id` variables from that scope
- [ ] The queue bypass change is on line 299 only — `if _queue_mode and memory_type not in ("lesson", "curiosity"):`
- [ ] The STORE_TOOL_DEF description addition is properly concatenated as part of the existing string (no syntax error)
- [ ] Read the entire modified `memory.py` file top-to-bottom to verify nothing was broken

#### Integration Sanity

- [ ] No circular imports introduced
- [ ] No new dependencies added (all imports already exist or are from `@nous/core`)
- [ ] Logger usage matches existing patterns (`logger.info`, `logger.warning`, `logger.debug`)
- [ ] All new code paths have error handling that falls back gracefully

### Quick Verification

After implementing and passing the self-review, test with:

```bash
# 1. Start Nous server
cd nous-server && pnpm dev

# 2. Store a lesson
curl -X POST http://localhost:3100/v1/nodes -H 'Content-Type: application/json' \
  -d '{"type":"concept","subtype":"custom:lesson","content_title":"Never trade weekends","content_body":"Low volume weekends increase slippage risk"}'

# 3. Wait 2 seconds for embedding to generate (fire-and-forget)

# 4. Check for similar content
curl -X POST http://localhost:3100/v1/nodes/check-similar -H 'Content-Type: application/json' \
  -d '{"title":"Avoid weekend trading","content":"Weekend trading is risky due to low volume and slippage","subtype":"custom:lesson"}'

# Expected: recommendation "duplicate_found" or "similar_found" with high similarity
```
