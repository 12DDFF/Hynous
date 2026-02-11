# TO-3: Tiered Stale Tool Result Truncation

> Truncate stale tool results based on what tool produced them. Confirmations need 100 chars, not 800.

**Status:** READY FOR IMPLEMENTATION
**Priority:** P1
**Estimated effort:** Small — modify one constant and one method in `agent.py`

---

## Problem

`agent.py` line 38 defines a single truncation limit for ALL stale tool results:

```python
_MAX_STALE_RESULT_CHARS = 800
```

This limit is applied uniformly in `_truncate_tool_entry()` (lines 246-257):

```python
@staticmethod
def _truncate_tool_entry(entry: dict) -> dict:
    """Create a copy of a tool_result entry with truncated content."""
    new_blocks = []
    for block in entry["content"]:
        if isinstance(block, dict) and block.get("type") == "tool_result":
            content = block.get("content", "")
            if len(content) > _MAX_STALE_RESULT_CHARS:
                content = content[:_MAX_STALE_RESULT_CHARS] + "\n...[truncated, already processed]"
            new_blocks.append({**block, "content": content})
        else:
            new_blocks.append(block)
    return {"role": entry["role"], "content": new_blocks}
```

**Why 800 is wasteful for most tools:**

Stale tool results are results the agent has already seen and responded to. They sit in the conversation history and get re-sent on every subsequent API call. The agent already incorporated them into its reasoning — keeping the full text is pure waste. The current 800-char limit (~200 tokens) is a reasonable ceiling for data-heavy tools, but wildly excessive for confirmation messages.

Consider these actual tool results:

| Tool | Typical stale result | Actual length | Kept at 800 | Waste |
|------|---------------------|---------------|-------------|-------|
| `store_memory` | `Stored: "BTC funding divergence thesis" (n_abc123)` | ~60 chars | 60 chars | 0 (under limit) |
| `update_memory` | `Updated: "thesis title" (n_abc) — lifecycle → DORMANT` | ~70 chars | 70 chars | 0 (under limit) |
| `execute_trade` | 8-12 lines: confirmation, SL/TP distances, memory link, watchpoint auto-cleanup | ~600-1200 chars | 800 chars | ~0-400 chars |
| `recall_memory` | 10 search results with titles, dates, previews, SSA scores | ~2000-4000 chars | 800 chars | Truncated correctly |
| `get_market_data` | Multi-section data: prices, funding, OI, volume, fear/greed | ~800-1500 chars | 800 chars | ~0-700 chars |
| `search_web` | 5 search results with titles, snippets, URLs | ~2000-3000 chars | 800 chars | Truncated correctly |

The waste is concentrated in **medium-sized data tools** (market, orderbook, funding, etc.) where 800 chars keeps enough raw numbers to inflate the context but not enough to be independently useful. For these tools, the agent already read the data and made its decision. A much shorter summary or even just the tool name + key figure is sufficient for context continuity.

---

## Solution

Replace the single `_MAX_STALE_RESULT_CHARS = 800` with a tiered truncation map based on tool name. The tiers are:

| Tier | Limit | Tools | Rationale |
|------|-------|-------|-----------|
| **Confirmation** | 150 chars | `store_memory`, `update_memory`, `delete_memory`, `explore_memory` (link/unlink), `manage_clusters` (CRUD) | These return one-line confirmations like `Stored: "title" (id)`. 150 chars covers even the longest confirmation with contradiction warnings. |
| **Action** | 300 chars | `execute_trade`, `close_position`, `modify_position`, `manage_watchpoints`, `manage_conflicts` | These return multi-line action summaries (trade confirmation + SL/TP + memory link). 300 chars keeps the key info (what was done) without the verbose details. |
| **Data** | 400 chars | `get_market_data`, `get_multi_timeframe`, `get_orderbook`, `get_funding_history`, `get_liquidations`, `get_options_flow`, `get_institutional_flow`, `get_global_sentiment`, `get_trade_stats`, `get_my_costs` | Market data tools. The agent already read and analyzed the numbers. 400 chars keeps a recognizable header (which tool, which symbol) without the full data tables. |
| **Search** | 600 chars | `recall_memory`, `search_web`, `explore_memory` (explore action) | Search results are the most context-dependent. The agent may reference specific results later. 600 chars keeps 2-3 result previews for continuity. |
| **Default** | 800 chars | Any unknown/new tool | Safe fallback. New tools added later get the current behavior until classified. |

---

## Required Reading (Before Implementation)

The engineer MUST read and understand these files before making changes:

1. **`src/hynous/intelligence/agent.py`** — The ONLY file being modified. Read entirely. Focus on:
   - `_MAX_STALE_RESULT_CHARS = 800` (line 38) — the constant being replaced
   - `_compact_messages()` (lines 175-243) — the method that calls `_truncate_tool_entry()`. Understand how it determines which tool results are "stale" vs "fresh" (fresh = last message in the array when it's a tool_result).
   - `_truncate_tool_entry()` (lines 246-257) — the method being modified. Currently a `@staticmethod`. Will need access to the tool name from the preceding assistant message.
   - `_build_messages()` (lines 102-133) — how messages are constructed before compaction.
   - `chat()` (lines 417-521) and `chat_stream()` (lines 523-645) — both call `_compact_messages()`. No changes needed in these methods.

2. **`src/hynous/intelligence/tools/registry.py`** — Read `get_registry()` (lines 79-141) to see ALL 18 tool modules and their names. This is the source of truth for tool names.

3. **Understand the message format:**
   - Assistant messages with tool calls have `content` as a list of blocks: `[{"type": "text", "text": "..."}, {"type": "tool_use", "id": "toolu_abc", "name": "get_market_data", "input": {...}}]`
   - User messages with tool results have `content` as a list of blocks: `[{"type": "tool_result", "tool_use_id": "toolu_abc", "content": "..."}]`
   - The `tool_use_id` in the result matches the `id` in the preceding assistant's `tool_use` block.
   - To determine which tool produced a result, you MUST map `tool_use_id` → `name` from the assistant message.

---

## Implementation Steps

### Step 1: Replace the single constant with a tiered map

**File:** `src/hynous/intelligence/agent.py`

Remove line 38:
```python
# REMOVE
_MAX_STALE_RESULT_CHARS = 800
```

Add the tiered truncation configuration in its place:

```python
# Tiered truncation limits for stale (already-processed) tool results.
# The agent already saw the full result and made its decision — keeping
# the full text in subsequent API calls is pure waste.
# Fresh (unseen) tool results are always kept at full fidelity.
_STALE_TRUNCATION = {
    # Confirmation tools — one-line ack messages
    "store_memory": 150,
    "update_memory": 150,
    "delete_memory": 150,
    "explore_memory": 150,
    "manage_clusters": 150,
    # Action tools — multi-line summaries of what was done
    "execute_trade": 300,
    "close_position": 300,
    "modify_position": 300,
    "manage_watchpoints": 300,
    "manage_conflicts": 300,
    # Data tools — market numbers the agent already analyzed
    "get_market_data": 400,
    "get_multi_timeframe": 400,
    "get_orderbook": 400,
    "get_funding_history": 400,
    "get_liquidations": 400,
    "get_options_flow": 400,
    "get_institutional_flow": 400,
    "get_global_sentiment": 400,
    "get_trade_stats": 400,
    "get_my_costs": 400,
    "get_account": 400,
    # Search tools — agent may reference specific results
    "recall_memory": 600,
    "search_web": 600,
}
_DEFAULT_STALE_LIMIT = 800  # Fallback for unclassified tools
```

### Step 2: Build a tool_use_id → tool_name mapping in _compact_messages()

**File:** `src/hynous/intelligence/agent.py`

Modify `_compact_messages()` to build a mapping before truncation. Insert the mapping logic after the existing `messages = self._build_messages()` line (line 188):

```python
def _compact_messages(self) -> list[dict]:
    """Build messages for API with stale tool results and snapshots compacted."""
    messages = self._build_messages()

    # Build tool_use_id → tool_name mapping from assistant messages.
    # Needed for tiered truncation — different tools get different limits.
    tool_id_to_name: dict[str, str] = {}
    for entry in messages:
        if entry["role"] == "assistant" and isinstance(entry.get("content"), list):
            for block in entry["content"]:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tid = block.get("id", "")
                    name = block.get("name", "")
                    if tid and name:
                        tool_id_to_name[tid] = name

    # Is the last message a fresh (unseen) tool_result?
    last_is_tools = (
        len(messages) > 0
        and messages[-1]["role"] == "user"
        and isinstance(messages[-1].get("content"), list)
    )

    compacted = []
    for i, entry in enumerate(messages):
        is_tool_entry = (
            entry["role"] == "user"
            and isinstance(entry.get("content"), list)
        )
        # Keep the last tool_result full if fresh; compact all others
        if is_tool_entry and not (last_is_tools and i == len(messages) - 1):
            compacted.append(self._truncate_tool_entry(entry, tool_id_to_name))
        else:
            compacted.append(entry)

    # ... rest of the method is UNCHANGED (snapshot stripping logic) ...
```

**CRITICAL:** The snapshot stripping logic (lines 209-241) stays exactly the same. Do NOT modify it.

### Step 3: Modify _truncate_tool_entry() to use tiered limits

**File:** `src/hynous/intelligence/agent.py`

Replace the current `_truncate_tool_entry()` (lines 245-257):

```python
# BEFORE
@staticmethod
def _truncate_tool_entry(entry: dict) -> dict:
    """Create a copy of a tool_result entry with truncated content."""
    new_blocks = []
    for block in entry["content"]:
        if isinstance(block, dict) and block.get("type") == "tool_result":
            content = block.get("content", "")
            if len(content) > _MAX_STALE_RESULT_CHARS:
                content = content[:_MAX_STALE_RESULT_CHARS] + "\n...[truncated, already processed]"
            new_blocks.append({**block, "content": content})
        else:
            new_blocks.append(block)
    return {"role": entry["role"], "content": new_blocks}
```

```python
# AFTER
@staticmethod
def _truncate_tool_entry(entry: dict, tool_id_to_name: dict[str, str] | None = None) -> dict:
    """Create a copy of a tool_result entry with tiered truncated content.

    Different tools get different truncation limits:
    - Confirmations (store, update, delete): 150 chars
    - Actions (trade, watchpoints): 300 chars
    - Data (market, funding, etc.): 400 chars
    - Search (recall, web): 600 chars
    - Default (unknown tools): 800 chars
    """
    new_blocks = []
    for block in entry["content"]:
        if isinstance(block, dict) and block.get("type") == "tool_result":
            content = block.get("content", "")
            # Look up the tool name to determine truncation tier
            tool_name = ""
            if tool_id_to_name:
                tool_name = tool_id_to_name.get(block.get("tool_use_id", ""), "")
            limit = _STALE_TRUNCATION.get(tool_name, _DEFAULT_STALE_LIMIT)
            if len(content) > limit:
                content = content[:limit] + "\n...[truncated, already processed]"
            new_blocks.append({**block, "content": content})
        else:
            new_blocks.append(block)
    return {"role": entry["role"], "content": new_blocks}
```

**Key design decisions:**
- `tool_id_to_name` is `None`-able for backward compatibility (existing callers that might not pass it).
- When `tool_id_to_name` is `None` or the `tool_use_id` isn't found, falls back to `_DEFAULT_STALE_LIMIT` (800), which is the current behavior.
- The `@staticmethod` decorator is preserved — the method still doesn't access `self`.

### Step 4: No changes needed elsewhere

The `_compact_messages()` method is the only caller of `_truncate_tool_entry()`. The `_format_exchange()` function in `memory_manager.py` (used for Haiku compression) has its own separate 800-char truncation at line 454 — this is independent and should NOT be changed.

---

## How Token Savings Work

In a typical multi-tool exchange, the agent might call 3-5 tools. Each stale tool result currently occupies up to 800 chars (~200 tokens). With tiered truncation:

**Example — periodic review wake (typical 3-tool exchange):**

| Tool called | Current stale size | New stale size | Saved |
|------------|-------------------|---------------|-------|
| `get_market_data` | 800 chars | 400 chars | 400 chars |
| `recall_memory` | 800 chars | 600 chars | 200 chars |
| `store_memory` | 60 chars (under limit) | 60 chars | 0 chars |
| **Total per stale exchange** | **1,660 chars** | **1,060 chars** | **~600 chars (~150 tokens)** |

With a 4-6 exchange window, there are typically 3-5 stale exchanges in the history, each with 1-5 tool results. Conservative estimate: **~400-600 tokens saved per API call** on uncached input.

At $3.00/M tokens (uncached input): ~$0.0012-0.0018 per call. Over 24 daemon wakes/day: ~$0.03-0.04/day, ~$0.90-1.20/month.

---

## Verification Checklist

After implementation, the engineer MUST verify:

- [ ] `_MAX_STALE_RESULT_CHARS` constant is REMOVED (no longer exists)
- [ ] `_STALE_TRUNCATION` dict exists with all 21 tool entries classified
- [ ] `_DEFAULT_STALE_LIMIT = 800` exists as the fallback
- [ ] All tool names in `_STALE_TRUNCATION` match actual tool names in `registry.py` `get_registry()`:
  - Confirmation (150): `store_memory`, `update_memory`, `delete_memory`, `explore_memory`, `manage_clusters`
  - Action (300): `execute_trade`, `close_position`, `modify_position`, `manage_watchpoints`, `manage_conflicts`
  - Data (400): `get_market_data`, `get_multi_timeframe`, `get_orderbook`, `get_funding_history`, `get_liquidations`, `get_options_flow`, `get_institutional_flow`, `get_global_sentiment`, `get_trade_stats`, `get_my_costs`, `get_account`
  - Search (600): `recall_memory`, `search_web`
- [ ] `_compact_messages()` builds `tool_id_to_name` mapping by scanning assistant messages
- [ ] `_compact_messages()` passes `tool_id_to_name` to `_truncate_tool_entry()`
- [ ] `_truncate_tool_entry()` accepts `tool_id_to_name` parameter (default `None`)
- [ ] `_truncate_tool_entry()` looks up `tool_name` from `tool_id_to_name` using `tool_use_id`
- [ ] `_truncate_tool_entry()` uses `_STALE_TRUNCATION.get(tool_name, _DEFAULT_STALE_LIMIT)` for the limit
- [ ] The `@staticmethod` decorator is preserved on `_truncate_tool_entry()`
- [ ] The snapshot stripping logic in `_compact_messages()` (lines 209-241) is UNCHANGED
- [ ] Fresh tool results (last message when it's a tool_result) are still kept at full fidelity — the `last_is_tools` guard is preserved
- [ ] `_format_exchange()` in `memory_manager.py` is NOT modified (independent 800-char truncation for Haiku compression)
- [ ] No existing tests break (run `pytest tests/`)
- [ ] The truncation suffix `"\n...[truncated, already processed]"` is preserved

---

## Risk Assessment

**Very low risk.** Stale tool results are, by definition, results the agent has already seen and incorporated into its reasoning. Truncating them more aggressively only affects what the agent sees in *future* API calls when it scrolls back through history.

The tiers are conservative:
- 150 chars for confirmations is generous — most confirmations are 30-70 chars.
- 300 chars for actions keeps the essential "what was done" information.
- 400 chars for data keeps the header/structure but cuts the raw numbers.
- 600 chars for search keeps 2-3 result previews.
- 800 chars (default) is the current behavior — no regression for unclassified tools.

If any tool needs more history context, its limit can be individually increased by editing `_STALE_TRUNCATION`.

**Edge case:** If a new tool is added via `registry.py` but not classified in `_STALE_TRUNCATION`, it gets the 800-char default — identical to current behavior. No risk of regression. The comment on `_DEFAULT_STALE_LIMIT` should note this for future engineers.

---

## Files Modified

| File | Change |
|------|--------|
| `src/hynous/intelligence/agent.py` | Replace `_MAX_STALE_RESULT_CHARS` with `_STALE_TRUNCATION` dict + `_DEFAULT_STALE_LIMIT`. Modify `_compact_messages()` to build tool_use_id→name mapping. Modify `_truncate_tool_entry()` to use tiered limits. |
