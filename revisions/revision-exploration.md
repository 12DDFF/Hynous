# Revision Exploration

> Running list of all issues found during review. Each issue is documented with enough detail for an agent with zero project context to understand and fix it.

## Project Context (for cold-start agents)

Hynous is a crypto trading agent powered by Claude. It has 4 layers:
- **Dashboard** (Reflex/Python → React) on `:3000` — UI
- **Intelligence** (Python) — the Claude-powered agent with tool calling
- **Nous** (TypeScript/Hono) on `:3100` — persistent memory system (knowledge graph, SSA retrieval, FSRS decay, vector embeddings, SQLite)
- **Hydra** (Python) — market data providers (Hyperliquid, Binance, CryptoQuant)

The agent talks to Nous via HTTP through a Python client at `src/hynous/nous/client.py`. The agent's tools live in `src/hynous/intelligence/tools/`. The Nous server code is in `nous-server/server/src/`.

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| **P0 — Critical** | Actively breaking core functionality. Fix first. |
| **P1 — High** | Significant degradation to agent learning/memory. Fix soon. |
| **P2 — Medium** | Missing features or misleading behavior. Fix when able. |
| **P3 — Low** | Minor UX or display issues. Fix opportunistically. |

---

## Memory Sections — IMPLEMENTED (2026-02-21)

> **All 21 issues below are resolved. Memory Sections (Issues 0–6) are also fully implemented.** Brain-inspired sectioned memory gives different memory types (signals, episodes, lessons, playbooks) fundamentally different retrieval weights, decay curves, encoding strength, and consolidation rules. All 7 issues were implemented in order (0 → 1/2 → 6 → 4 → 3 → 5). See `memory-sections/executive-summary.md` for full theory and implementation notes.

---

## Issues Found (All Resolved)

### ~~!! P0 — Python retrieval layer strips full memory content — Nous stores everything correctly but the agent only sees summaries~~ FIXED

**Status:** Resolved via NW-2 (retrieval formatting fix) and NW-3 (token budget increase). Both formatting functions now use `content_body` as primary, parse JSON bodies for `text` field, and use `content_summary` only as fallback. Per-memory truncation removed. Global `max_context_tokens` raised from 800 to 4000. See `nous-wiring/nous-wiring-revisions.md` NW-2, NW-3.

**Confirmed by the agent itself.** Hynous independently diagnosed this bug during a live conversation. When asked why it only returned basic trade info (position size, TP/SL), it responded:

> "The memory exists (it's showing up in auto-recall snippets). But the content is truncated or corrupted — I can only see the title/metadata, not the body. This is a data integrity issue in my memory system. The reasoning was stored when I called execute_trade, but something is preventing me from retrieving the full content now. This is a bug, not a 'I didn't store my thesis' problem."

**The agent is correct — Nous is NOT the problem. The Python retrieval layer is.**

**Root cause (two functions, same bug pattern):**

The bottleneck is entirely in two Python formatting functions that sit between Nous and Claude. Both prefer `content_summary` over `content_body` when summary exists:

**Path 1 — Auto-retrieval** (`src/hynous/intelligence/memory_manager.py`, function `_format_context()`, line ~400):
```python
body = node.get("content_body", "") or ""
summary = node.get("content_summary", "") or ""
preview = summary or body[:300]  # summary ALWAYS wins when it exists

if len(preview) > 300:
    preview = preview[:297] + "..."
```

**Path 2 — Explicit recall_memory tool** (`src/hynous/intelligence/tools/memory.py`, function `handle_recall_memory()`, line ~482):
```python
body = node.get("content_body", "") or ""
summary = node.get("content_summary", "") or ""
preview = summary or body[:400]  # summary ALWAYS wins when it exists

if len(preview) > 400:
    preview = preview[:397] + "..."
```

**Why summary always wins for trades:**

`_store_trade_memory()` in `trading.py` (line ~754) always sets `content_summary` to a mechanical one-liner:
```python
summary = (
    f"{side.upper()} {symbol} @ {price_label} | "
    f"SL {_fmt_price(stop_loss)} | TP {_fmt_price(take_profit)} | "
    f"{_fmt_big(size_usd)}"
)
```
Result: `"LONG BTC @ $69,210 | SL $67,500 | TP $73,000 | $50 | R:R 2.22:1"`

Meanwhile `content_body` contains the full thesis as JSON:
```python
body_data = {"text": f"Thesis: {reasoning}\nEntry: {price_label} | Size: ..."}
body_data["signals"] = signals  # entry price, SL, TP, side, size, confidence
body = json.dumps(body_data)
```

**The full data flow:**

```
STORAGE (works perfectly):
  Agent calls execute_trade(reasoning="Fear & Greed at 8, BTC bouncing from $68K support...")
    → trading.py builds content with thesis + signals
    → _store_to_nous() wraps in JSON, sends to Nous
    → Nous stores content_body (full JSON with thesis) AND content_summary (one-liner)
    → Both saved correctly in SQLite

RETRIEVAL (broken):
  Agent calls recall_memory(query="BTC trade") OR auto-retrieval triggers
    → Nous SSA search finds the node, ranks it correctly, returns FULL node
    → Python formatting picks summary over body: preview = summary or body[:400]
    → summary exists ("LONG BTC @ $69,210 | SL $67,500...") → wins
    → Agent sees only: "LONG BTC @ $69,210 | SL $67,500 | TP $73,000 | $50"
    → Full thesis ("Fear & Greed at 8, BTC bouncing from $68K...") is NEVER shown

  Even if summary were empty, body[:400] would show raw JSON:
    → '{"text":"Thesis: Fear & Greed at ex...'  (truncated, unparsed)
    → The JSON extraction code (lines ~485-490) only triggers if preview.startswith("{")
    → But preview is already set to summary, so the JSON extraction never runs
```

**Secondary bottleneck — global token budget:**

Even if the per-memory truncation is fixed, `config/default.yaml` sets `memory.max_context_tokens: 800` (line ~66). This converts to ~3,200 chars total across ALL recalled memories. With 5 memories, that's ~640 chars each — better than 300, but still only ~160 words per memory. Both the per-memory clip AND the global budget need to be raised together.

**What needs to change (summary for implementer):**

1. **`memory_manager.py:_format_context()`** — Stop preferring summary. For each node, extract the actual text content: parse JSON bodies to get the `text` field, use `content_body` as primary with `content_summary` as fallback only when body is empty. Respect the global `max_context_tokens` budget but allow each memory a fair share of it.

2. **`memory.py:handle_recall_memory()`** — Same fix. Show `content_body` (parsed from JSON if needed) as the primary content. Show `content_summary` as a secondary one-liner label, not as the content itself. Consider showing the full body without truncation for explicit recall (the agent specifically asked for this memory).

3. **`config/default.yaml`** — Raise `memory.max_context_tokens` from 800 to at least 4000 (~1,000 words total). Cost impact is negligible with prompt caching (~$0.001/call).

**Cascading issues this blocks:** Issues #1, #2, #11, #13, #15 are all symptoms or consequences of this root cause.

**Impact:** P0 — This breaks the entire memory-driven learning loop. The agent stores rich, detailed memories but can never access them. It can't review past theses, learn from mistakes, evaluate predictions, or build on prior analysis. The agent itself confirmed this is actively breaking its ability to trade intelligently.

---

### ~~1. [P1] Retrieval truncates stored content — agent never sees full memories~~ FIXED

**Status:** Resolved via NW-2 and NW-3. Both `_format_context()` and `handle_recall_memory()` now show `content_body` (parsed from JSON if needed) as primary content. Per-memory truncation removed. Global token budget raised from 800 to 4000. See `nous-wiring/nous-wiring-revisions.md` NW-2, NW-3.

**Files involved:**
- `src/hynous/intelligence/memory_manager.py` — `_format_context()` function (line ~383)
- `src/hynous/intelligence/tools/memory.py` — `handle_recall_memory()` function (line ~439)

**Data flow (auto-retrieval path):**
1. User sends a message to the agent
2. `Agent.chat()` in `src/hynous/intelligence/agent.py` (line 352) calls `self.memory_manager.retrieve_context(message)`
3. `MemoryManager.retrieve_context()` in `memory_manager.py` (line 88) calls `nous.search(query=query, limit=config.memory.retrieve_limit)`
4. Nous returns full node objects with `content_body`, `content_summary`, `content_title`, etc.
5. `_format_context()` (line ~383) formats results for injection. The critical truncation:
   ```python
   preview = summary or body[:300]  # line ~400
   # ...
   if len(preview) > 300:
       preview = preview[:297] + "..."  # line ~412
   ```
6. This formatted text is injected into the user message before the Claude API call (line ~136 in `_build_messages()`):
   ```python
   "[From your memory — relevant context recalled automatically]\n"
   f"{self._active_context}\n"
   "[End of recalled context]\n\n"
   f"{entry['content']}"
   ```

**Data flow (explicit recall_memory tool path):**
1. Agent calls `recall_memory` tool during reasoning
2. `handle_recall_memory()` in `memory.py` (line ~439) calls `client.search()`
3. Results are formatted with the same truncation pattern:
   ```python
   body = node.get("content_body", "") or ""
   summary = node.get("content_summary", "") or ""
   preview = summary or body[:400]  # line ~482

   # Tries to extract text from JSON body
   if preview.startswith("{"):
       try:
           parsed = json.loads(body)
           preview = parsed.get("text", body[:400])
       except (json.JSONDecodeError, TypeError):
           preview = body[:400]

   if len(preview) > 400:  # line ~492
       preview = preview[:397] + "..."
   ```

**Problem:** Both paths clip content to 300-400 characters. A 2,000-word analysis, thesis, or lesson stored in Nous is reduced to a sentence fragment on recall. The full content exists in the database but the Python retrieval code throws it away before the agent ever sees it.

**Why 300/400 chars:** Likely a token budget concern — injecting 10 full memories at 2,000 words each would consume ~25K tokens. But the current limit is too aggressive. The auto-retrieval path (`_format_context`) has a `max_context_tokens` budget from config (`config.memory.max_context_tokens`) that already handles the overall budget — the per-memory clip at 300 chars is redundant and destructive.

**Impact:** The agent stores rich, detailed memories but can never access them. This is the foundational issue behind most of David's concerns.

---

### 2. [P2] Compression summaries are lossy — nuance and numbers get dropped

**Files involved:**
- `src/hynous/intelligence/memory_manager.py` — `_compress_and_store()`, `_compress_one()`, `_store_summary()`

**How compression works:**
1. `Agent.chat()` calls `self.memory_manager.maybe_compress(self._history)` after every response (line ~387 in `agent.py`)
2. `maybe_compress()` (line ~169 in `memory_manager.py`) groups history into exchanges and checks if count exceeds `config.memory.window_size`
3. Overflow exchanges are deep-copied and sent to background thread `_compress_and_store()`
4. Each exchange is formatted by `_format_exchange()` (line ~430) into readable text:
   ```
   USER: What's BTC doing?
   AGENT CALLED: get_market_data({"symbols":["BTC"]})
   TOOL RESULT: BTC @ $69,000 | 24h: +2.1% | Funding: +0.0150% | OI: $18.2B | Vol: $42.1B
   AGENT: Based on the data...
   ```
5. This text is sent to Haiku (Claude haiku) with the compression prompt `_COMPRESSION_SYSTEM` (line ~34):
   - Instructs Haiku to write 150-300 words as first-person memory
   - Max output tokens: `_COMPRESSION_MAX_TOKENS = 600` (line ~59)
   - Haiku can flag trivial exchanges as "TRIVIAL" to skip them
6. The compressed summary is stored in Nous as a `custom:turn_summary` node via `_store_summary()` (line ~305):
   ```python
   nous.create_node(
       type="episode",
       subtype=SUBTYPE_TURN_SUMMARY,  # "custom:turn_summary"
       title=title,
       body=body,  # The 150-300 word Haiku summary
       summary=body[:300] if len(body) > 300 else None,
   )
   ```

**Problem:** A 10-tool-call analytical session with exact funding rates, OI numbers, orderbook depth, and multi-timeframe analysis gets compressed into ~200 words. Specific numbers survive if Haiku deems them important, but exact tool outputs, secondary data points, and nuanced reasoning chains are lost.

**~~Compounding with Issue #1:~~** ~~Even these already-lossy 200-word summaries get further truncated to 300-400 chars when recalled by the agent later. So the final recall is a fraction of a fraction of the original session.~~ **Note:** Issue #1 is now FIXED — retrieval no longer truncates. The compression itself is still lossy, but the compounding effect is eliminated.

**Impact:** Long-form analytical work degrades during compression. However, with Issue #1 fixed, the full compressed summary (~200 words) is now visible on recall instead of being further truncated to a fragment.

---

### 3. [P2] No market context snapshot stored alongside memories

**Files involved:**
- `src/hynous/intelligence/tools/memory.py` — `handle_store_memory()` (line ~281), `STORE_TOOL_DEF` (line ~194)
- `src/hynous/intelligence/tools/trading.py` — `_store_trade_memory()` (line ~728) — does include signals

**How store_memory works:**
1. Agent calls `store_memory` tool with `content`, `memory_type`, `title`, and optional `signals`, `trigger`, `link_ids`, `event_time`
2. `handle_store_memory()` queues or stores directly depending on `_queue_mode`
3. `_store_memory_impl()` (line ~311) builds the node:
   ```python
   if trigger or signals:
       body_data: dict = {"text": content}
       if trigger:
           body_data["trigger"] = trigger
       if signals:
           body_data["signals_at_creation"] = signals
       body = json.dumps(body_data)
   else:
       body = content  # Plain text, no signals
   ```
4. Node is created in Nous via `client.create_node()`

**How trading tools store (for comparison):**
`_store_trade_memory()` in `trading.py` (line ~728) always includes a `signals` dict:
```python
signals = {
    "action": "entry",
    "side": side,
    "symbol": symbol,
    "entry": entry_px,
    "stop": stop_loss,
    "target": take_profit,
    "size_usd": round(size_usd, 2),
    "fill_sz": fill_sz,
}
```

**Problem:** The `signals` parameter in `store_memory` is optional and the agent almost never provides it. When the agent stores a thesis like "BTC looks bullish — funding reset, support held" via `store_memory`, there's no automatic capture of the current market state. The `signals` field in `STORE_TOOL_DEF` is described as "Current market snapshot to store alongside" but it requires the agent to manually construct it — the system doesn't auto-populate it.

**Contrast with trading tools:** `execute_trade`, `close_position`, and `modify_position` all auto-build a `signals` dict with structured data. But `store_memory` doesn't.

**Impact:** Theses and episodes stored via `store_memory` lack temporal market context. "BTC looks bullish" stored 3 weeks ago is meaningless without knowing BTC was at $69K with -0.01% funding at the time. The agent can't evaluate whether past reasoning was sound because it doesn't know what conditions existed.

---

### 4. [P2] No feedback loop — past predictions are never scored — PARTIALLY ADDRESSED

**Note:** The `update_memory` tool now exists (NW-4 FIXED), giving the agent the ability to annotate trade entries with outcomes. The `explore_memory` tool (NW-6 FIXED) lets it traverse entry→close edges. However, there is still no **automated** process to score predictions — the agent must do this manually. The building blocks are in place but the automated feedback loop is not.

**Files involved:**
- `src/hynous/intelligence/tools/trading.py` — `_store_trade_memory()` creates `custom:trade_entry`, `handle_close_position()` creates `custom:trade_close` and links back via `part_of` edge
- `src/hynous/nous/client.py` — `update_node()` now called by `update_memory` tool and daemon lifecycle updates

**How the trade lifecycle currently works:**
1. `execute_trade` → stores `custom:trade_entry` node with thesis + parameters
2. `close_position` → stores `custom:trade_close` node with entry/exit/PnL + reasoning
3. Close node links back to entry via `part_of` edge (line ~981):
   ```python
   close_node_id = _store_to_nous(
       subtype="custom:trade_close",
       # ...
       link_to=entry_node_id,  # Edge: entry --part_of--> close
       edge_type="part_of",
   )
   ```

**What's missing:** After a trade closes, there's no process to:
- Go back to the original `trade_entry` node and annotate it: "This thesis was correct — BTC hit $73K as predicted" or "This thesis failed — support broke and funding didn't reset as expected"
- Update the entry node's content with the outcome using `client.update_node()`
- Create a `custom:lesson` node that links the entry, close, and a retroactive analysis
- Score the thesis quality (was the reasoning sound even if the trade lost?)

**The `update_node()` method in `client.py`:**
```python
def update_node(self, node_id: str, **updates) -> dict:
    """Partial update a node. Pass fields as kwargs."""
    resp = self._session.patch(self._url(f"/nodes/{node_id}"), json=updates)
    resp.raise_for_status()
    return resp.json()
```
This is fully functional — the Nous server's PATCH endpoint (`nous-server/server/src/routes/nodes.ts` line ~197) supports updating `content_title`, `content_summary`, `content_body`, `state_lifecycle`, and more. But no Python tool ever calls it.

**Impact:** The agent accumulates trade entries and closes as separate, disconnected memories. It can search for them, but there's no structured way to ask "what was my thesis accuracy?" or "which types of theses tend to win?" The data exists in Nous but is never connected retroactively.

---

### ~~5. [P2] FSRS decay runs passively — no proactive review cycle~~ FIXED

**Files involved:**
- `nous-server/server/src/core-bridge.ts` — `computeDecay()` (line ~106), `applyDecay()` (line ~129), `computeStabilityGrowth()` (line ~147)
- `nous-server/server/src/routes/search.ts` — applies decay on search results (line ~139)
- `nous-server/server/src/routes/nodes.ts` — applies decay + stability growth on GET by ID (line ~132)
- `nous-server/server/src/routes/decay.ts` — endpoint exists for batch decay
- `src/hynous/intelligence/daemon.py` — the background loop (41K file, runs 24/7)

**How FSRS currently works:**
1. Each node has `neural_stability` (days until 90% recall probability drops to ~35%), `neural_retrievability` (current recall probability), and `neural_difficulty`
2. Different subtypes get different initial stability via `getNeuralDefaults()` in `core-bridge.ts` (line ~159):
   - `custom:trade_entry` → `concept` → 21 days stability
   - `custom:turn_summary` → `event` → ~10 days stability
   - `custom:lesson` → `fact` → specific stability
3. Decay is computed on read: `retrievability = e^(-days_since_access / stability)` via `calculateRetrievability()` from `@nous/core/params`
4. Lifecycle transitions happen automatically: ACTIVE → WEAK → FADING → DORMANT based on retrievability thresholds
5. On access (search result returned or GET by ID), stability grows via `updateStabilityOnAccess()` — the memory gets stronger

**Status:** Fully resolved (2026-02-21). The daemon calls `POST /v1/decay` every 6 hours via `_run_decay_cycle()` in a background thread (`hynous-decay`). Lifecycle transitions are computed and written to DB. When important memories (lessons, theses, playbooks) cross ACTIVE→WEAK, `_check_fading_transitions()` fetches each candidate node, checks its subtype, and calls `_wake_for_fading_memories()` to alert the agent. A 24h per-node cooldown (`_fading_alerted` dict) prevents repeated alerts. Signals and episodes decay silently — by design. The "repetition" half of spaced repetition is now complete.

---

### ~~6. [P2] Contradiction detection is wired but never used from Python~~ FIXED

**Files involved:**
- `src/hynous/intelligence/tools/conflicts.py` — NEW: `manage_conflicts` tool (list + resolve)
- `src/hynous/intelligence/tools/registry.py` — registered as 16th tool module
- `src/hynous/intelligence/daemon.py` — `_check_conflicts()` periodic polling + wake
- `src/hynous/intelligence/tools/memory.py` — inline `_contradiction_detected` flag check
- `src/hynous/core/config.py` — `conflict_check_interval` config field
- `config/default.yaml` — `conflict_check_interval: 1800`

**Status:** Resolved. Three integration points:
- **Agent tool** (`manage_conflicts`): list pending/resolved conflicts with old node titles, new content previews, confidence scores; resolve with 4 strategies (old_is_current, new_is_current, keep_both, merge).
- **Daemon polling** (`_check_conflicts()`): checks conflict queue every 30 min, wakes agent with formatted summaries if pending conflicts exist.
- **Inline feedback**: `_store_memory_impl()` checks `_contradiction_detected` flag on new nodes and surfaces a warning to the agent.

`NousClient` methods `get_conflicts()` and `resolve_conflict()` are no longer dead code. The system prompt claim about contradiction detection is now true.

---

### ~~7. [P2] Edges are write-only — graph traversal unused from Python~~ FIXED

**Files involved:**
- `src/hynous/intelligence/tools/explore_memory.py` — NEW: dedicated graph exploration tool
- `src/hynous/intelligence/tools/registry.py` — registered as 15th tool module
- `src/hynous/nous/client.py` — `get_edges()`, `create_edge()`, `delete_edge()` now all called by explore_memory

**Status:** Resolved. Created `explore_memory` tool with three actions:
- **explore** — Display 1-hop graph neighborhood: node title/type + all connected edges with direction arrows, edge type, connected node titles, strength values, and edge IDs
- **link** — Create manual edges with 5 types: `relates_to`, `part_of`, `causes`, `supports`, `contradicts`
- **unlink** — Remove edges by ID

The agent can now inspect its knowledge graph, verify auto-generated connections, manually link related memories, and remove incorrect edges. `NousClient` edge methods (`get_edges`, `create_edge`, `delete_edge`) are no longer dead code — they're all actively used by the tool.

---

### ~~8. [P1] Node updates never happen — memories are immutable~~ FIXED

**Files involved:**
- `src/hynous/nous/client.py` — `update_node()` (line ~112)
- `nous-server/server/src/routes/nodes.ts` — PATCH endpoint (line ~197)

**The update_node client method:**
```python
def update_node(self, node_id: str, **updates) -> dict:
    """Partial update a node. Pass fields as kwargs."""
    resp = self._session.patch(self._url(f"/nodes/{node_id}"), json=updates)
    resp.raise_for_status()
    return resp.json()
```

**The Nous server PATCH endpoint supports:**
```typescript
const allowedFields = [
    'type', 'subtype', 'content_title', 'content_summary', 'content_body',
    'neural_stability', 'neural_retrievability', 'neural_difficulty', 'state_lifecycle',
    'temporal_event_time', 'temporal_event_confidence', 'temporal_event_source',
];
```
It also bumps `version` and `last_modified` automatically.

**What's missing:** No tool in `src/hynous/intelligence/tools/` wraps `update_node()`. The agent has `store_memory` (create), `recall_memory` (search), and `delete_memory` (delete) — but no `update_memory` or `revise_memory`.

**Status:** Resolved. The `update_memory` tool was added to `src/hynous/intelligence/tools/memory.py`. The agent can now update titles, content (replace or append), summaries, and lifecycle states on existing nodes. JSON bodies are handled correctly. Registered as blocking (not background). The agent now has full CRUD: store, recall, update, delete.

**Follow-up fix (2026-02-20):** The tool was registered and present in the LLM tool schema, but was never added to `prompts/builder.py`. The agent had no system prompt guidance to use it, causing it to silently create duplicate nodes instead of editing existing ones. Fixed by adding `update_memory` to the `TOOL_STRATEGY` memory list and adding an explicit behavioral rule to the "How My Memory Works" section. E2E verified.

---

### ~~9. [P2] list_nodes never used — no browsable memory inventory~~ FIXED

**Files involved:**
- `src/hynous/nous/client.py` — `list_nodes()` (line ~93)
- `nous-server/server/src/routes/nodes.ts` — GET /nodes endpoint (line ~163)

**The list_nodes client method:**
```python
def list_nodes(
    self,
    type: Optional[str] = None,
    subtype: Optional[str] = None,
    lifecycle: Optional[str] = None,
    limit: int = 50,
) -> list[dict]:
    params: dict = {"limit": limit}
    if type: params["type"] = type
    if subtype: params["subtype"] = subtype
    if lifecycle: params["lifecycle"] = lifecycle
    resp = self._session.get(self._url("/nodes"), params=params)
    resp.raise_for_status()
    return resp.json().get("data", [])
```

**The server endpoint supports:** filtering by type, subtype, lifecycle state, with limit up to 200. Returns newest first.

**What's missing:** No tool wraps this for the agent. The `recall_memory` tool only does search-by-query. There's no way to browse without a search string.

**Status:** Resolved. Added `browse` mode to `recall_memory` tool. The agent can now list memories by type and lifecycle without a search query: `{"mode": "browse", "memory_type": "thesis", "active_only": true}`. Uses `client.list_nodes()` with filters. Fully backward compatible with existing search mode.

---

### ~~10. [P3] QCS classify_query exists in client but never used~~ PARTIALLY FIXED (MF-10)

**Status:** QCS metadata from search responses is now logged at DEBUG level inside `NousClient.search()`. The standalone `classify_query()` method remains unused (not needed — QCS runs server-side within search).

**What was done:** `search()` in `client.py` now parses the `qcs` field from the Nous search response and logs query_type, used_embeddings, and disqualified status. This provides visibility into the search classification path without requiring a separate `classify_query()` call.

**What remains:** The `classify_query()` client method itself is still not called anywhere. This is by design — QCS runs server-side automatically, and the metadata is now accessible via search response logging. No further action needed unless pre-classification becomes useful for query reformulation.

---

### ~~11. [P0] Trade reasoning stored but invisible on recall — summary masks the thesis~~ FIXED

**Status:** Resolved via NW-2. Both `_format_context()` and `handle_recall_memory()` now use `content_body` as primary content, parsing JSON bodies to extract the `text` field (which contains the full thesis). `content_summary` is only used as fallback when body is empty. The agent now sees the full trade thesis on recall. See `nous-wiring/nous-wiring-revisions.md` NW-2.

**Files involved:**
- `src/hynous/intelligence/tools/trading.py` — `_store_trade_memory()` (line ~728)
- `src/hynous/intelligence/tools/trading.py` — `_store_to_nous()` (line ~649)
- `src/hynous/intelligence/tools/memory.py` — `handle_recall_memory()` (line ~439)

**Storage path (what happens when a trade is executed):**

1. `handle_execute_trade()` requires `reasoning` (it's in `required` array of `TRADE_TOOL_DEF`, line ~389)
2. `_store_trade_memory()` (line ~728) builds two separate text fields:

   **content (includes reasoning):**
   ```python
   content = (
       f"Thesis: {reasoning}\n"
       f"Entry: {price_label} | Size: {fill_sz:.6g} {symbol} (~{_fmt_big(size_usd)})\n"
       f"Stop Loss: {_fmt_price(stop_loss)} | Take Profit: {_fmt_price(take_profit)}"
   )
   ```

   **summary (mechanical one-liner, NO reasoning):**
   ```python
   summary = (
       f"{side.upper()} {symbol} @ {price_label} | "
       f"SL {_fmt_price(stop_loss)} | TP {_fmt_price(take_profit)} | "
       f"{_fmt_big(size_usd)}"
   )
   ```

3. `_store_to_nous()` (line ~649) wraps content in JSON and stores both:
   ```python
   body_data: dict = {"text": content}
   if signals:
       body_data["signals"] = signals
   body = json.dumps(body_data)
   # ...
   client.create_node(
       type="concept",
       subtype=subtype,  # "custom:trade_entry"
       title=title,       # "LONG BTC @ $69,210"
       body=body,          # JSON: {"text": "Thesis: ...\nEntry: ...", "signals": {...}}
       summary=summary,    # "LONG BTC @ $69,210 | SL $67,500 | TP $73,000 | $50 | R:R 2.22:1"
   )
   ```

**Retrieval path (what happens when the agent recalls the trade):**

1. Agent calls `recall_memory(query="BTC trade")` or auto-retrieval triggers on a related message
2. `handle_recall_memory()` in `memory.py` (line ~439) gets results from Nous search
3. For each result, it builds a preview (line ~480):
   ```python
   body = node.get("content_body", "") or ""
   summary = node.get("content_summary", "") or ""
   preview = summary or body[:400]  # <-- summary ALWAYS exists for trades, so it wins
   ```
4. Since `content_summary` is always populated by `_store_trade_memory()`, the preview is always the mechanical one-liner
5. The JSON body containing the thesis is never shown. Even if summary were empty, `body[:400]` would show `{"text":"Thesis: Fear & Greed at ex...` — raw JSON, truncated

**Confirmed by the agent itself:** Hynous diagnosed this in a Discord conversation. It stored a full thesis about Fear & Greed at extreme fear (8), BTC bouncing from $68k support, relief rally targeting $72-73k resistance, weekend consolidation expectations. When it recalled the trade, it only saw: `LONG BTC @ $69,210 | SL $67,500 | TP $73,000 | $50 | R:R 2.22:1`. The entire thesis was invisible.

**Root cause:** Design conflict — `content_summary` is designed for scannable search result previews (one-liner), but the `recall_memory` tool uses it as the primary display content. Trade summaries prioritize scannability over completeness. The retrieval path's `summary or body[:400]` logic means that whenever a summary exists, the full body is never shown.

**Impact:** Critical — the highest-severity issue. The entire trade learning loop is broken:
- The tool forces the agent to write reasoning (good)
- The reasoning is correctly stored in Nous (good)
- But the agent can never see its own reasoning again (broken)
- It can't evaluate past theses, learn from mistakes, or build on prior analysis
- This is the specific issue David raised in his review

---

### ~~12. [P0] Wrong field name: `lifecycle_state` vs `state_lifecycle` — daemon updates fail silently~~ FIXED

**Status:** Resolved via NW-1. All three `daemon.py` call sites now use the correct field name `state_lifecycle`. The read-side mismatch in `watchpoints.py` was also fixed (NW-7). See `nous-wiring/nous-wiring-revisions.md` NW-1, NW-7.

**Files involved:**
- `src/hynous/intelligence/daemon.py` — `_expire_watchpoint()` (line ~451), `_fire_watchpoint()` (line ~460), `_check_curiosity()` (line ~939)
- `nous-server/server/src/routes/nodes.ts` — PATCH endpoint `allowedFields` (line ~207)
- `src/hynous/nous/client.py` — `update_node()` (line ~112)

**The bug:**

The daemon calls `update_node()` with the kwarg `lifecycle_state`:
```python
# daemon.py line 454 — _expire_watchpoint
nous.update_node(wp["id"], lifecycle_state="DORMANT")

# daemon.py line 466 — _fire_watchpoint
nous.update_node(wp["id"], lifecycle_state="DORMANT")

# daemon.py line 939 — _check_curiosity (marking addressed items)
nous.update_node(item["id"], lifecycle_state="WEAK")
```

The `update_node()` client method passes kwargs directly as JSON:
```python
def update_node(self, node_id: str, **updates) -> dict:
    resp = self._session.patch(self._url(f"/nodes/{node_id}"), json=updates)
    resp.raise_for_status()
    return resp.json()
```

So it sends `{"lifecycle_state": "DORMANT"}` to the server.

But the Nous server PATCH endpoint's `allowedFields` array (line ~207 in `nodes.ts`) uses `state_lifecycle`, not `lifecycle_state`:
```typescript
const allowedFields = [
    'type', 'subtype', 'content_title', 'content_summary', 'content_body',
    'neural_stability', 'neural_retrievability', 'neural_difficulty', 'state_lifecycle',
    'temporal_event_time', 'temporal_event_confidence', 'temporal_event_source',
];
```

The field loop checks `if (field in body)` — it looks for `state_lifecycle` in the request body but finds `lifecycle_state`. No match. The endpoint returns `{error: 'no valid fields to update'}` with HTTP 400.

The client's `resp.raise_for_status()` raises an exception for the 400 response. But every caller wraps in `try/except Exception: pass`:
```python
# daemon.py line 456
except Exception:
    pass
```

**Consequences:**
1. **Watchpoints never die.** `_fire_watchpoint()` fails silently. The watchpoint stays `ACTIVE` in Nous. On the next data poll, `_check_watchpoints()` queries active watchpoints and finds the same one again. If the trigger condition is still true (price is still below the threshold), it fires AGAIN. The daemon counts another `watchpoint_fires`, wakes the agent AGAIN with the same alert, consuming tokens for a duplicate wake. This repeats every `price_poll_interval` (60s) as long as the condition holds.

2. **Watchpoints never expire.** `_expire_watchpoint()` fails silently. Expired watchpoints stay `ACTIVE` and keep being evaluated against triggers, wasting cycles.

3. **Curiosity items never get marked as addressed.** `_check_curiosity()` marks items as `WEAK` after a learning session, but the update fails. The same items stay `ACTIVE` and trigger another learning session at the next `curiosity_check_interval` (15 min), waking the agent repeatedly for the same topics.

**Fix:** All three call sites should use `state_lifecycle` instead of `lifecycle_state`:
```python
nous.update_node(wp["id"], state_lifecycle="DORMANT")
nous.update_node(item["id"], state_lifecycle="WEAK")
```

**Impact:** This is a silent, high-severity bug. Every watchpoint that fires becomes an infinite loop of duplicate wakes. Every learning session re-triggers. The agent gets woken repeatedly for the same events, wasting significant Claude API tokens ($0.10-0.50 per wake) and polluting conversation history with duplicate entries.

---

### ~~13. [P1] Fill wake tells agent to recall thesis, but thesis is invisible (cascade from #11)~~ FIXED

**Status:** Resolved. This was a cascade of Issue #11, which is now fixed via NW-2. The agent can now recall the full trade thesis (including reasoning) when the daemon wakes it for a fill event. The post-trade learning loop now works as designed.

**Files involved:**
- `src/hynous/intelligence/daemon.py` — `_wake_for_fill()` (line ~752)
- `src/hynous/intelligence/tools/memory.py` — `handle_recall_memory()` (line ~439)
- `src/hynous/intelligence/tools/trading.py` — `_store_trade_memory()` (line ~728)

**The interaction:**

When a stop loss is hit, the daemon wakes the agent with specific instructions (line ~776):
```python
"This is a learning moment. Use your tools to:",
"1. Recall your original trade thesis (recall_memory for the entry)",
"2. Check what happened — what moved against you?",
"3. Was the thesis wrong, or was the stop too tight?",
"4. Store a lesson — what would you do differently?",
```

The take profit wake is similar (line ~791):
```python
"1. Recall your original thesis — did the market confirm it?",
"2. What signals were right? What can you do more of?",
```

The agent follows these instructions and calls `recall_memory(query="BTC trade entry")`. But due to Issue #11, the trade entry's `content_summary` (mechanical one-liner like `LONG BTC @ $69,210 | SL $67,500 | TP $73,000 | $50`) always wins over the `content_body` (which contains the full thesis). The agent sees the trade parameters but NOT the thesis it's supposed to evaluate.

**The learning loop that should happen:**
1. Agent enters trade with thesis: "Fear & Greed at 8, BTC bouncing from $68K support, expecting relief rally to $72-73K"
2. Stop loss hits → daemon wakes agent
3. Agent recalls the trade → sees full thesis
4. Agent compares thesis to what actually happened
5. Agent stores a lesson: "Fear & Greed alone isn't enough — need to check liquidation heat maps too"

**What actually happens:**
1. Agent enters trade with thesis (stored correctly in Nous body)
2. Stop loss hits → daemon wakes agent
3. Agent recalls the trade → sees only "LONG BTC @ $69,210 | SL $67,500 | TP $73,000 | $50"
4. Agent has no thesis to evaluate — can only comment on the entry/exit prices
5. The "lesson" is shallow: "The trade didn't work" instead of "My thesis about Fear & Greed was wrong because..."

**Impact:** The entire post-trade learning flow — the daemon's most sophisticated feature — is broken. The daemon correctly detects fills, correctly classifies SL/TP/manual, correctly wakes the agent with appropriate tone, and correctly instructs it to reflect. But the final step (seeing the original thesis) fails because of Issue #11's retrieval masking.

---

### ~~14. [P2] System prompt promises features that aren't wired up~~ MOSTLY RESOLVED

**Files involved:**
- `src/hynous/intelligence/prompts/builder.py` — `TOOL_STRATEGY` section (line ~60)

**What the system prompt claims:**

In `builder.py` lines ~92-93, the TOOL_STRATEGY section tells the agent:
```
**Contradiction detection.** When I store something contradicting existing knowledge —
"actually," "I was wrong," "update:" — the system warns me. I should investigate and reconcile.
```

And line ~86:
```
**Memories decay.** Each memory has stability (days until it fades to 90% recall).
Untouched memories weaken: ACTIVE → WEAK → DORMANT. The important things survive
because I keep using them.
```

**Status: Fully resolved (2026-02-21).**

- **Contradiction detection** — **TRUE.** The `_contradiction_detected` flag is checked on store. Daemon polls the conflict queue every 30 min via `_check_conflicts()`, auto-resolves what it can (5 rules, zero agent cost), wakes the agent with the remainder. `manage_conflicts` tool handles list + resolve.
- **Memory decay** — **TRUE.** FSRS batch decay runs every 6 hours. Lifecycle transitions are computed. Fading alerts wake the agent when lessons, theses, or playbooks cross ACTIVE→WEAK. Signals and episodes decay silently. The spaced repetition loop is complete.

---

### ~~15. [P1] max_context_tokens: 800 is extremely restrictive — recalled context budget too small~~ FIXED

**Status:** Resolved via NW-3. `config/default.yaml` `max_context_tokens` raised from 800 to 4000 (~1,000 words total, ~16,000 chars). With 5 recalled memories, each now gets ~3,200 chars (~800 words). Combined with NW-2 (per-memory truncation removed), the entire retrieval bottleneck is fixed. See `nous-wiring/nous-wiring-revisions.md` NW-3.

**Files involved:**
- `config/default.yaml` — `memory.max_context_tokens: 800` (line ~66)
- `src/hynous/intelligence/memory_manager.py` — `_format_context()` (line ~383)

**How the budget works:**

`_format_context()` converts the token budget to a character limit:
```python
char_limit = max_tokens * 4  # ~4 chars per token → 800 * 4 = 3,200 chars
```

Each memory gets formatted as one line:
```
- [trade_entry] LONG BTC @ $69,210 (2026-02-05): LONG BTC @ $69,210 | SL $67,500 | TP $73,000 | $50
```

With `retrieve_limit: 5` memories and per-memory truncation at 300 chars (Issue #1), each entry is ~350 chars (including metadata prefix). 5 entries × 350 chars = ~1,750 chars — well within the 3,200 budget. But this means:

**If Issue #1 is fixed** (per-memory truncation removed or raised), the 3,200-char global budget becomes the binding constraint. At 3,200 chars ÷ 5 memories = 640 chars each — better, but still only ~160 words per memory. A detailed thesis, lesson, or analytical episode would still be truncated.

**The real constraint:** 800 tokens ≈ 200 words of total recalled context injected into the user message. This is roughly one paragraph across ALL memories. For an agent that's supposed to learn from its past and build on prior analysis, this is extremely tight.

**Why it matters for Issue #1 fix:** Simply removing the 300-char per-memory clip won't fully solve the recall problem. The global `max_context_tokens` budget will still truncate total context. Both limits need to be raised together. A reasonable target might be `max_context_tokens: 4000` (~1,000 words, ~16K chars) — enough for 5 memories at ~200 words each.

**Note on cost:** The auto-retrieval context goes into the user message, which is cached on subsequent API calls within the same conversation exchange (prompt caching). The cost impact of increasing this from 800 to 4,000 tokens is ~$0.001 per API call with cache hits. Negligible.

**Impact:** Even if Issue #1 is fixed, the global budget prevents the agent from seeing more than a paragraph of its own past knowledge. The per-memory and global limits are both too restrictive and need coordinated adjustment.

---

### ~~16. [P3] Watchpoint context truncated to 200 chars in list view~~ FIXED

**Files involved:**
- `src/hynous/intelligence/tools/watchpoints.py` — `_list_watchpoints()` (line ~265)

**The truncation:**
```python
context_str = data.get("text", "")[:200]  # line 265
```

When the agent calls `manage_watchpoints(action="list")`, each watchpoint's context (the reasoning for WHY the alert was set) is clipped to 200 characters. The full context is stored in the watchpoint's `content_body` JSON under the `text` key, but only the first 200 chars are shown.

**Example:**
The agent stores a watchpoint with context:
> "BTC funding has been negative for 3 consecutive 8-hour periods. Historically this has preceded short squeezes within 24-48 hours. If price drops below $65K while funding stays negative, the setup becomes even more asymmetric. I want to enter long with tight stop at $64.2K and target $69K. The R:R at $65K entry would be roughly 5:1."

What the agent sees when listing:
> "BTC funding has been negative for 3 consecutive 8-hour periods. Historically this has preceded short squeezes within 24-48 hours. If price drops below $65K while funding stay..."

The trade plan (entry, stop, target, R:R) is cut off.

**Impact:** Low-medium. The agent can still see the watchpoint trigger condition and the first part of its reasoning. But detailed action plans, specific levels, and conditional logic stored in the context get truncated. The daemon's `_wake_for_watchpoint()` does show the full context on wake (line ~719: `content = data.get("text", "")`), so this only affects the list view.

---

### ~~17. [P3] Watchpoint list reads wrong field name for lifecycle status~~ FIXED

**Status:** Resolved via NW-7. `watchpoints.py` now reads the correct field `state_lifecycle` instead of `lifecycle_state`. Watchpoint list correctly shows `[ACTIVE]` or `[DORMANT]` instead of `[?]`. See `nous-wiring/nous-wiring-revisions.md` NW-7.

**Files involved:**
- `src/hynous/intelligence/tools/watchpoints.py` — `_list_watchpoints()` (line ~248)
- `nous-server/server/src/routes/nodes.ts` — GET /nodes endpoint returns raw DB columns

**The mismatch:**
```python
lifecycle = wp.get("lifecycle_state", "?")  # line 248 — Python reads "lifecycle_state"
```

But the Nous server returns nodes with the raw SQLite column name `state_lifecycle`. The node dict has `state_lifecycle: "ACTIVE"`, not `lifecycle_state: "ACTIVE"`.

**Result:** The `lifecycle` variable is always `"?"` because the key doesn't exist in the dict. The status display at line 269:
```python
status = "ACTIVE" if lifecycle == "ACTIVE" else lifecycle
```
Always evaluates to `"?"` since `lifecycle` is always `"?"`. Every watchpoint shows as `[?]` instead of `[ACTIVE]` or `[DORMANT]`.

**Impact:** Low. The agent sees watchpoints listed with `[?]` status instead of the correct lifecycle state. Since the list already separates active from inactive via separate queries (lines 224 vs 233), the agent can still tell which are active by position in the list. But the status label is wrong.

---

### 18. [P2] Daemon wakes pollute shared conversation history with user chat

**Files involved:**
- `src/hynous/intelligence/daemon.py` — `_wake_agent()` (line ~962)
- `src/hynous/intelligence/agent.py` — `chat()` (line ~339), `_history` list

**How daemon wakes work:**

The daemon calls `self.agent.chat(message)` at line 1015. This goes through the full `Agent.chat()` flow:
1. Appends the daemon wake message as a `{"role": "user", ...}` entry to `self._history`
2. Retrieves context from Nous
3. Calls Claude API with the full history
4. Agent responds (may use tools, multiple rounds)
5. Appends all responses and tool results to `self._history`
6. Compresses if overflow

**The problem:** `_history` is a single shared list used by both user chat AND daemon wakes. A daemon wake adds 2-10 entries to the history (user wake message + tool calls + responses). When David chats with Hynous afterwards, he sees the daemon's wake messages interleaved with his own conversation. The system prompt correctly marks daemon messages with `[DAEMON WAKE —` prefix, but they still consume the conversation window.

**With `window_size: 6`**, the 6 most recent exchanges are kept. If the daemon fires 3 wakes between David's messages, only 3 of David's recent exchanges survive before compression kicks in. The agent's working memory of the human conversation shrinks because daemon wakes consume exchange slots.

**Additionally:** Each daemon wake goes through `memory_manager.retrieve_context()`, which searches Nous using the daemon wake message as the query. Daemon messages like "[DAEMON WAKE — Periodic Market Review]\nBTC: $69,000 | Funding: 0.0150%" trigger Nous searches that may retrieve irrelevant memories (e.g., searching for "periodic market review" might surface old review summaries instead of actual market analysis).

**Impact:** Medium. Daemon wakes dilute the working conversation window and can push David's recent messages out of context faster. The interleaving is by design (both use the same agent instance), but the conversation quality degrades when the daemon is active. With 6 max wakes/hour and window_size of 6, an active daemon could consume the entire window in 1 hour.

---

### ~~19. [P2] store_memory is fire-and-forget — agent never knows if storage failed~~ FIXED

**Status:** Resolved via NW-10. Changed `store_memory` registration from `background=True` to `background=False`. The agent now receives real feedback: `Queued: "title"` during queue mode, or `Stored: "title" (node_id)` on direct calls, or the actual error on failure. Queue flush path still silently drops failed items (minor remaining concern). See `nous-wiring/nous-wiring-revisions.md` NW-10.

**Files involved:**
- `src/hynous/intelligence/tools/memory.py` — `register()` (line ~517), `handle_store_memory()` (line ~281)
- `src/hynous/intelligence/agent.py` — `_execute_tools()` (line ~240)
- `src/hynous/intelligence/tools/registry.py` — `Tool` dataclass, `background` field (line ~27)

**How store_memory is registered:**
```python
# memory.py line 521-526
registry.register(Tool(
    name=STORE_TOOL_DEF["name"],
    description=STORE_TOOL_DEF["description"],
    parameters=STORE_TOOL_DEF["parameters"],
    handler=handle_store_memory,
    background=True,  # <-- Fire-and-forget
))
```

**What `background=True` does in `_execute_tools()`:**
```python
# agent.py lines 299-309
for block in background:
    name = str(block.name)
    kwargs = dict(block.input)
    tool_use_id = str(block.id)
    threading.Thread(target=_bg_fire, args=(name, kwargs), daemon=True).start()
    results.append({
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": "Done.",  # <-- Immediate synthetic result
    })
```

The agent receives `"Done."` immediately, before the memory is actually stored. If Nous is down, the network times out, or the node creation fails, the real error happens in a background thread:
```python
def _bg_fire(name, kwargs):
    try:
        self.tools.call(name, **kwargs)
    except Exception as e:
        logger.error("Background tool error: %s — %s", name, e)
```

The error is logged but the agent already told Claude "Done." The agent continues believing the memory was stored when it wasn't.

**When this matters:**
- Agent stores a lesson: "Never trade BTC during low-volume weekends" → actually lost
- Agent stores a thesis with [[wikilinks]] → links never created because node was never created
- Agent tries to recall the memory later → not found → agent has no idea why

**The queue mode compounds this:** During queue mode, `handle_store_memory()` doesn't even attempt storage — it queues the kwargs. After the response, `flush_memory_queue()` fires a background thread that processes the queue. If any item fails, it's logged and skipped:
```python
def _flush():
    for kwargs in items:
        try:
            _store_memory_impl(**kwargs)
        except Exception as e:
            logger.error("Failed to flush queued memory: %s", e)
```

Multiple memories can silently fail in a single flush.

**Impact:** Low-medium. In practice, Nous is usually running and storage succeeds. But there's zero feedback mechanism when it doesn't. The agent can't retry, can't tell David something went wrong, and can't adjust its behavior. For a system built on memory-driven learning, silent memory loss is a meaningful reliability gap.

---

### ~~20. [P1] Trade nodes missing `temporal_event_time` — time-range recall fails~~ FIXED

**Status:** Resolved via trade-recall revision. `_store_to_nous()` in `trading.py` now passes `event_time=datetime.now(timezone.utc).isoformat()`, `event_confidence=1.0`, `event_source="inferred"` to `create_node()`. All three callers (entry, close, modify) get timestamps automatically without code changes.

**See:** `revisions/trade-recall/retrieval-issues.md` — Problem 1

---

### ~~21. [P2] `memory_type="trade"` maps to wrong subtype — misses auto-created trade nodes~~ FIXED

**Status:** Resolved via trade-recall revision. `handle_recall_memory()` in `memory.py` normalizes `"trade"` → `"trade_entry"` before `_TYPE_MAP` lookup. `_TYPE_MAP` itself unchanged (store path via `store_memory` unaffected). Agent filtering by `memory_type="trade"` now correctly finds `custom:trade_entry` nodes.

**See:** `revisions/trade-recall/retrieval-issues.md` — Problem 2
