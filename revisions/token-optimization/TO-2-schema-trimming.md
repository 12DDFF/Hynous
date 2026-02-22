# TO-2: Trim store_memory and recall_memory Tool Schemas

> Remove bloat from the two largest tool schemas. These schemas are sent on every API call (~2,819 tokens combined). Cached after the first call, but trimming reduces cache-write cost, cache size, and Claude's processing overhead.

**Status:** IMPLEMENTED
**Priority:** P1
**Estimated effort:** Small — text edits only, no logic changes
**Scope:** ONLY `store_memory` and `recall_memory`. All other tools remain unchanged.

---

## Problem

Tool schemas are serialized and sent to Claude on every API call via `_api_kwargs()` in `agent.py` (line 289):

```python
if self.tools.has_tools:
    tools = self.tools.to_anthropic_format()
    tools[-1]["cache_control"] = {"type": "ephemeral"}
    kwargs["tools"] = tools
```

The total schema payload is ~13,600 tokens across 23 tool definitions. The top two memory tools account for ~2,819 tokens:

| Tool | Current size | Bloat type |
|------|-------------|-----------|
| `store_memory` | ~1,762 tokens | Implementation details (batching, dedup internals), redundant type definitions, patronizing hints |
| `recall_memory` | ~1,057 tokens | Excessive examples (3-4 per mode), redundant mode explanations |

**What is NOT bloat (do not remove):**
- Memory type definitions in store_memory (episode, lesson, thesis, etc.) — agent needs these to pick correctly
- Wikilink syntax explanation — unique feature the agent wouldn't discover otherwise
- Parameter definitions and types — required for valid tool calls
- Search vs browse mode distinction in recall_memory — genuinely different behaviors
- Time-range and cluster filtering parameters — functional documentation

---

## Required Reading (Before Implementation)

The engineer MUST read these files:

1. **`src/hynous/intelligence/tools/memory.py`** — Read the ENTIRE file. This is the only file being modified. Understand:
   - `STORE_TOOL_DEF` (lines 239-337) — the store_memory schema to trim
   - `RECALL_TOOL_DEF` (lines 579-662) — the recall_memory schema to trim
   - `handle_store_memory()` (lines 340-371) — how the handler uses parameters (DO NOT modify logic)
   - `handle_recall_memory()` (lines 713-798) — how the handler uses parameters (DO NOT modify logic)
   - `register()` (lines 946-970) — how schemas are registered (DO NOT modify)

2. **`src/hynous/intelligence/tools/registry.py`** — Understand how `Tool.to_anthropic_format()` converts the schema dict to API format. The `description` field and `parameters` dict are sent directly to the Anthropic API.

3. **`src/hynous/intelligence/prompts/builder.py`** — Read the `TOOL_STRATEGY` section (lines 78-112). This section in the system prompt contains strategic guidance about memory tools. The schema descriptions should NOT duplicate what's already in TOOL_STRATEGY. Specifically, TOOL_STRATEGY already covers:
   - "store_memory to persist anything worth remembering"
   - Wikilink syntax with example
   - "call store_memory multiple times in one response"
   - "recall_memory to search past knowledge"
   - "I only call recall_memory for filtered or targeted searches beyond what was auto-recalled"
   - Archive behavior

   Anything already in TOOL_STRATEGY does NOT need to be repeated in the tool schema.

---

## Implementation: store_memory

### Current Description (lines 241-270, ~2,666 chars)

```python
STORE_TOOL_DEF = {
    "name": "store_memory",
    "description": (
        "Store something in your persistent memory. Write rich, detailed content — "
        "your future self will thank you. Don't summarize when detail matters.\n\n"
        "Memory types (choose ONE — if unsure, pick the closest):\n"
        "  episode — WHAT happened. A specific event with a timestamp. "
        "\"BTC pumped 5% in 2 hours on a short squeeze cascade.\"\n"
        "  lesson — WHAT you learned. A takeaway from experience or research.\n"
        "  thesis — WHAT you believe will happen and WHY. Forward-looking conviction.\n"
        "  signal — RAW data snapshot. Numbers, not narrative.\n"
        "  watchpoint — An alert with trigger conditions. Include trigger object.\n"
        "  curiosity — A question to research later.\n"
        "  trade — Manual trade record.\n\n"
        "Rule of thumb: episode=narrative of what happened, signal=raw numbers, "
        "thesis=forward prediction, lesson=backward insight.\n\n"
        "LINKING with [[wikilinks]]: Reference existing memories by writing "
        "[[title or topic]] anywhere in your content. The system searches for "
        "matching memories and creates edges automatically. Like Obsidian backlinks.\n"
        "Example: \"BTC squeezed 5% today, similar pattern to [[BTC Jan 15 squeeze]]. "
        "This confirms my [[funding rate divergence thesis]].\"\n\n"
        "BATCHING: Don't stop to store memories mid-analysis. Keep thinking, keep "
        "using tools, keep building your picture. Call store_memory whenever something "
        "is worth remembering — it's instant (queued, not stored yet). All memories "
        "flush to Nous after your response is complete. Call multiple store_memory "
        "in one response for related memories. Use [[wikilinks]] to cross-reference."
        "\n\n"
        "DEDUPLICATION: Lessons and curiosity items are checked for duplicates before "
        "storing. If a very similar memory already exists (95%+ match), the new one "
        "won't be created — you'll see which existing memory matched. If a moderately "
        "similar memory exists (90-95% match), the new one is created and linked to it."
    ),
    ...
}
```

### What to cut and why

| Section | Action | Reason |
|---------|--------|--------|
| "Write rich, detailed content — your future self will thank you. Don't summarize when detail matters." | **Simplify** | Overly verbose encouragement. Replace with a concise quality instruction. |
| "if unsure, pick the closest" | **Remove** | Patronizing. Claude can figure this out. |
| Memory type definitions (episode through trade) | **Keep** | Load-bearing. Agent needs these to choose correctly. |
| "Rule of thumb: episode=narrative..." | **Remove** | Redundant — restates the type definitions immediately above it. |
| Wikilink explanation + example | **Keep but shorten** | Important feature, but the example is also covered in system prompt TOOL_STRATEGY. Keep the syntax explanation, cut the extended example. |
| BATCHING paragraph (entire) | **Remove** | Implementation detail. The agent doesn't need to know about queuing internals. The system prompt TOOL_STRATEGY already says "call store_memory multiple times in one response." |
| DEDUPLICATION paragraph (entire) | **Remove** | Implementation detail. The agent sees dedup results in tool output ("Duplicate: already stored as..."). It doesn't need to know thresholds (95%, 90-95%) upfront — that's plumbing. |

### New Description

Replace the entire `description` value in `STORE_TOOL_DEF` with:

```python
STORE_TOOL_DEF = {
    "name": "store_memory",
    "description": (
        "Store something in your persistent memory. Include key context, reasoning, "
        "and numbers — be complete but not padded.\n\n"
        "Memory types:\n"
        "  episode — A specific event. \"BTC pumped 5% on a short squeeze.\"\n"
        "  lesson — A takeaway from experience or research.\n"
        "  thesis — Forward-looking conviction. What you believe will happen and why.\n"
        "  signal — Raw data snapshot. Numbers, not narrative.\n"
        "  watchpoint — An alert with trigger conditions. Include trigger object.\n"
        "  curiosity — A question to research later.\n"
        "  trade — Manual trade record.\n\n"
        "Use [[wikilinks]] in content to link to related memories: "
        "\"This confirms my [[funding rate thesis]].\" "
        "The system searches for matches and creates edges automatically.\n\n"
        "Lessons and curiosity items are checked for duplicates automatically."
    ),
    ...
}
```

**Estimated reduction:** ~2,666 chars → ~850 chars (~68% smaller, saves ~450 tokens)

### Parameter descriptions to trim

Within the `parameters` dict (lines 272-336), trim the `content` parameter description:

```python
# BEFORE (lines 275-281)
"content": {
    "type": "string",
    "description": (
        "The full content to remember. Be detailed — include context, "
        "reasoning, numbers, and anything that would help you understand "
        "this memory months from now. No need to be brief. "
        "Use [[title]] to link to related memories."
    ),
},

# AFTER
"content": {
    "type": "string",
    "description": (
        "The content to remember. Include context, reasoning, and key numbers. "
        "Use [[title]] to link to related memories."
    ),
},
```

Trim the `trigger` parameter description:

```python
# BEFORE (lines 293-306)
"trigger": {
    "type": "object",
    "description": (
        "Only for watchpoints. Alert conditions. Properties: "
        "condition (price_below, price_above, funding_above, funding_below, "
        "oi_change, liquidation_spike, fear_greed_extreme), "
        "symbol (e.g. BTC), value (threshold number), "
        "expiry (ISO date, optional, default 7 days)."
    ),
    ...
},

# AFTER
"trigger": {
    "type": "object",
    "description": (
        "Watchpoints only. Conditions: price_below, price_above, funding_above, "
        "funding_below, fear_greed_extreme. Requires symbol and value. "
        "Optional expiry (ISO date, default 7 days)."
    ),
    ...
},
```

Trim the `cluster` parameter description:

```python
# BEFORE (lines 326-333)
"cluster": {
    "type": "string",
    "description": (
        "Cluster ID to assign this memory to (optional). "
        "Get cluster IDs from manage_clusters(action=\"list\"). "
        "Memories are also auto-assigned to clusters based on "
        "their type if the cluster has matching auto_subtypes."
    ),
},

# AFTER
"cluster": {
    "type": "string",
    "description": "Cluster ID to assign to (optional). Auto-assignment also applies based on type.",
},
```

All other parameters (`memory_type`, `title`, `signals`, `link_ids`, `event_time`) are already concise — leave them unchanged.

---

## Implementation: recall_memory

### Current Description (lines 580-600, ~1,441 chars)

```python
RECALL_TOOL_DEF = {
    "name": "recall_memory",
    "description": (
        "Search or browse your persistent memory.\n\n"
        "Two modes:\n"
        "  search (default) — Semantic search by query. Requires query.\n"
        "  browse — List memories by type/lifecycle. No query needed.\n\n"
        "Search examples:\n"
        '  {"query": "BTC support levels"} → search all memories\n'
        '  {"query": "funding", "memory_type": "signal"} → search only signals\n\n'
        "Browse examples:\n"
        '  {"mode": "browse", "memory_type": "thesis", "active_only": true} '
        "→ all active theses\n"
        '  {"mode": "browse", "memory_type": "trade_entry", "limit": 5} '
        "→ recent trade entries\n"
        '  {"mode": "browse"} → most recent memories (all types)\n\n'
        "Time-range search (search mode only):\n"
        '  {"query": "BTC", "time_start": "2026-01-01", "time_end": "2026-01-31"} '
        "→ BTC memories from January\n"
        '  {"query": "trade entry", "time_start": "2026-02-01", "time_type": "event"} '
        "→ trades since Feb 1st"
    ),
    ...
}
```

### What to cut and why

| Section | Action | Reason |
|---------|--------|--------|
| Mode definitions (search/browse, 2 lines) | **Keep** | Load-bearing — two genuinely different behaviors. |
| Search examples (2 examples) | **Reduce to 1** | One example is enough. Claude understands `query` + optional filters. |
| Browse examples (3 examples) | **Reduce to 1** | Three examples showing variations of the same pattern. One with `memory_type` + `active_only` covers it. |
| Time-range examples (2 examples) | **Reduce to 1** | One example with `time_start` + `time_end` is sufficient. |

### New Description

Replace the entire `description` value in `RECALL_TOOL_DEF` with:

```python
RECALL_TOOL_DEF = {
    "name": "recall_memory",
    "description": (
        "Search or browse your persistent memory.\n\n"
        "Modes:\n"
        "  search (default) — Semantic search by query. Requires query.\n"
        "  browse — List by type/lifecycle. No query needed.\n\n"
        "Examples:\n"
        '  {"query": "BTC support levels"}\n'
        '  {"mode": "browse", "memory_type": "thesis", "active_only": true}\n'
        '  {"query": "BTC", "time_start": "2026-01-01", "time_end": "2026-01-31"}'
    ),
    ...
}
```

**Estimated reduction:** ~1,441 chars → ~500 chars (~65% smaller, saves ~235 tokens)

### Parameter descriptions to trim

Within the `parameters` dict (lines 602-661), trim the `memory_type` description:

```python
# BEFORE (lines 614-621)
"memory_type": {
    "type": "string",
    "enum": [...],
    "description": (
        "Filter by memory type. Trade lifecycle types: "
        "trade_entry (theses + entries), trade_close (outcomes + PnL), "
        "trade_modify (position adjustments)."
    ),
},

# AFTER
"memory_type": {
    "type": "string",
    "enum": [...],
    "description": "Filter by memory type.",
},
```

The enum values are self-explanatory. The trade lifecycle explanation is unnecessary — `trade_entry`, `trade_close`, `trade_modify` are clear names.

Trim the `time_type` description:

```python
# BEFORE (lines 643-650)
"time_type": {
    "type": "string",
    "enum": ["event", "ingestion", "any"],
    "description": (
        "Which timestamp to filter on. "
        "event = when the event happened, "
        "ingestion = when stored, "
        "any = either. Default: any."
    ),
},

# AFTER
"time_type": {
    "type": "string",
    "enum": ["event", "ingestion", "any"],
    "description": "Timestamp to filter: event (when it happened), ingestion (when stored), any (either). Default: any.",
},
```

Trim the `cluster` description (same pattern as store_memory):

```python
# BEFORE (lines 652-658)
"cluster": {
    "type": "string",
    "description": (
        "Cluster ID to search within (search mode only). "
        "Only returns memories that belong to this cluster. "
        "Get cluster IDs from manage_clusters(action=\"list\")."
    ),
},

# AFTER
"cluster": {
    "type": "string",
    "description": "Cluster ID to search within (search mode only).",
},
```

All other parameters (`mode`, `query`, `active_only`, `limit`, `time_start`, `time_end`) are already concise — leave them unchanged.

---

## Total Estimated Savings

| Tool | Before | After | Saved |
|------|--------|-------|-------|
| store_memory description | ~2,666 chars (~667 tokens) | ~850 chars (~213 tokens) | ~454 tokens |
| store_memory parameters | ~4,382 chars (~1,096 tokens) | ~3,800 chars (~950 tokens) | ~146 tokens |
| recall_memory description | ~1,441 chars (~360 tokens) | ~500 chars (~125 tokens) | ~235 tokens |
| recall_memory parameters | ~2,785 chars (~696 tokens) | ~2,400 chars (~600 tokens) | ~96 tokens |
| **Total** | **~2,819 tokens** | **~1,888 tokens** | **~931 tokens** |

Since tool schemas are cached, this saves:
- **First call (cache write):** 931 tokens × $3.75/M = $0.0035
- **Every subsequent call (cache read):** 931 tokens × $0.30/M = $0.0003
- **Side benefit:** Smaller schemas = faster Claude processing, fewer hallucinated parameters

---

## Verification Checklist

After implementation, the engineer MUST verify:

- [ ] `STORE_TOOL_DEF["description"]` is the new trimmed version
- [ ] `STORE_TOOL_DEF["parameters"]["properties"]["content"]["description"]` is trimmed
- [ ] `STORE_TOOL_DEF["parameters"]["properties"]["trigger"]["description"]` is trimmed
- [ ] `STORE_TOOL_DEF["parameters"]["properties"]["cluster"]["description"]` is trimmed
- [ ] `RECALL_TOOL_DEF["description"]` is the new trimmed version
- [ ] `RECALL_TOOL_DEF["parameters"]["properties"]["memory_type"]["description"]` is trimmed
- [ ] `RECALL_TOOL_DEF["parameters"]["properties"]["time_type"]["description"]` is trimmed
- [ ] `RECALL_TOOL_DEF["parameters"]["properties"]["cluster"]["description"]` is trimmed
- [ ] All `"required"` fields are unchanged (store: `["content", "memory_type", "title"]`, recall: `[]`)
- [ ] All `"enum"` values are unchanged
- [ ] All parameter `"type"` fields are unchanged
- [ ] `handle_store_memory()` function is NOT modified (logic unchanged)
- [ ] `handle_recall_memory()` function is NOT modified (logic unchanged)
- [ ] `register()` function is NOT modified
- [ ] `UPDATE_TOOL_DEF` is NOT modified (out of scope)
- [ ] The trimmed descriptions still contain:
  - All 7 memory types with brief definitions
  - Wikilink syntax explanation
  - Dedup mention (one sentence)
  - Search vs browse mode distinction
  - At least 1 example per mode
- [ ] No existing tests break (run `pytest tests/`)

---

## Risk Assessment

**Very low risk.** This is a text-only change to tool descriptions. No logic, no parameters, no handler code is modified. The risk is that Claude might slightly change its tool-calling behavior (e.g., shorter memory content) due to the revised description. This is acceptable — the description still instructs "be complete" and includes type definitions.

If any behavioral regression is observed (agent stops using wikilinks, picks wrong memory types, etc.), the descriptions can be reverted independently.

---

## Files Modified

| File | Change |
|------|--------|
| `src/hynous/intelligence/tools/memory.py` | Trim STORE_TOOL_DEF description + 3 parameter descriptions. Trim RECALL_TOOL_DEF description + 3 parameter descriptions. |
