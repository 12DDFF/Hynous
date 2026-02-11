# TO-4: Reduce Conversation Window from 6 to 4

> Fewer exchanges in the working window = fewer uncached tokens resent on every API call.

**Status:** READY FOR IMPLEMENTATION
**Priority:** P1
**Estimated effort:** Minimal — two config values changed
**Backup plan:** Option D (dynamic window) documented below if quality degrades

---

## Problem

The conversation window keeps the last N complete exchanges (user message + all tool calls + agent response) in the API call's `messages` array. Every exchange in the window is resent — uncached — on every API call at $3.00/M tokens.

Current setting in `config/default.yaml` (line 69):

```yaml
memory:
  window_size: 6
```

And in `src/hynous/core/config.py` (line 59, `MemoryConfig` dataclass):

```python
@dataclass
class MemoryConfig:
    window_size: int = 6
```

**Why 6 is too many:**

A typical exchange consists of:
- 1 user message (~50-200 tokens)
- 1-3 tool call rounds (assistant tool_use + user tool_result = ~200-800 tokens each, after stale truncation)
- 1 final assistant response (~100-500 tokens)

That's roughly **350-1,500 tokens per exchange** depending on tool usage. With a window of 6 exchanges:
- **Minimum (simple chats):** 6 × 350 = 2,100 tokens
- **Typical (1-2 tools per exchange):** 6 × 800 = 4,800 tokens
- **Maximum (heavy tool usage):** 6 × 1,500 = 9,000 tokens

This entire payload is uncached (messages change every call). With a window of 4:
- **Minimum:** 4 × 350 = 1,400 tokens (saved: ~700)
- **Typical:** 4 × 800 = 3,200 tokens (saved: ~1,600)
- **Maximum:** 4 × 1,500 = 6,000 tokens (saved: ~3,000)

**Typical savings: ~1,600 tokens/call** on uncached input.

**Why 4 is safe:**

1. **Evicted exchanges are NOT lost.** When an exchange leaves the window, `memory_manager.maybe_compress()` compresses it via Haiku and stores it as a `custom:turn_summary` node in Nous. On future calls, `memory_manager.retrieve_context()` can recall these summaries if they're relevant.

2. **The agent rarely references exchanges >3 turns back.** Most multi-turn reasoning chains (question → tool call → analysis → follow-up) complete within 2-3 exchanges. Exchange #5 and #6 from the current window are almost always obsolete context.

3. **Daemon wakes are independent.** Each daemon wake is a standalone interaction — the agent doesn't need previous wake context (that's what memory is for). The window primarily serves user chat sessions.

4. **The coach and briefing system provide continuity.** The daemon's `_format_wake_history()` gives the agent recent wake context independent of the conversation window.

---

## Required Reading (Before Implementation)

The engineer MUST read and understand these files before making changes:

1. **`config/default.yaml`** — Lines 67-73. The `memory` section with `window_size: 6`. This is the runtime configuration value.

2. **`src/hynous/core/config.py`** — Lines 57-64. The `MemoryConfig` dataclass with `window_size: int = 6`. This is the default when no YAML config is provided. **Both values must be changed.**

3. **`src/hynous/intelligence/memory_manager.py`** — Read the `maybe_compress()` method (lines 173-246). This is where `window_size` is consumed:
   ```python
   window = self.config.memory.window_size  # line 193
   if len(exchanges) <= window:             # line 194
       return history, False
   evicted_exchanges = exchanges[:-window]  # line 198
   kept_exchanges = exchanges[-window:]     # line 199
   ```
   Understand how the window boundary determines which exchanges get evicted and compressed via Haiku.

4. **`src/hynous/intelligence/memory_manager.py`** — Read `group_exchanges()` (lines 130-167). This is how raw history entries are grouped into complete exchanges. A multi-tool exchange (user → assistant+tools → results → assistant+tools → results → final response) counts as ONE exchange.

5. **`src/hynous/intelligence/agent.py`** — Read `chat()` (lines 511-517) and `chat_stream()` (lines 635-641). Both call `maybe_compress()` after each response. This is the only place where `window_size` takes effect.

---

## Implementation Steps

### Step 1: Update config/default.yaml

**File:** `config/default.yaml`

```yaml
# BEFORE (line 69)
memory:
  window_size: 6                 # Complete exchanges to keep in working window

# AFTER
memory:
  window_size: 4                 # Complete exchanges to keep in working window
```

### Step 2: Update MemoryConfig dataclass default

**File:** `src/hynous/core/config.py`

```python
# BEFORE (line 59)
@dataclass
class MemoryConfig:
    window_size: int = 6

# AFTER
@dataclass
class MemoryConfig:
    window_size: int = 4
```

### Step 3: No other changes needed

The `maybe_compress()` method in `memory_manager.py` already uses `self.config.memory.window_size` dynamically. The `load_config()` function in `config.py` already reads `window_size` from YAML with a fallback to the dataclass default. No logic changes are needed anywhere.

---

## Backup Plan: Option D (Dynamic Window)

If reducing to 4 causes observable quality degradation (agent losing track of multi-turn conversations), implement a dynamic window that adjusts based on exchange size. This is a **future option** — do NOT implement it now. Only pursue this if testing with window_size=4 reveals problems.

### Option D Design

Instead of a fixed window, measure the total token count of the exchanges and keep as many as fit within a budget:

```python
# In memory_manager.py — maybe_compress()
# INSTEAD of:
#   window = self.config.memory.window_size

MAX_WINDOW_TOKENS = 4000  # Token budget for the working window
MIN_WINDOW = 2            # Always keep at least 2 exchanges
MAX_WINDOW = 6            # Never keep more than 6

def _estimate_exchange_tokens(exchange: list[dict]) -> int:
    """Rough token estimate: ~4 chars per token."""
    total_chars = 0
    for entry in exchange:
        content = entry.get("content", "")
        if isinstance(content, str):
            total_chars += len(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    total_chars += len(str(block.get("content", "")))
                    total_chars += len(str(block.get("text", "")))
    return total_chars // 4

# In maybe_compress():
exchanges = self.group_exchanges(history)

# Dynamic: count backward from newest, accumulate tokens
kept = 0
token_sum = 0
for ex in reversed(exchanges):
    ex_tokens = _estimate_exchange_tokens(ex)
    if token_sum + ex_tokens > MAX_WINDOW_TOKENS and kept >= MIN_WINDOW:
        break
    token_sum += ex_tokens
    kept += 1
    if kept >= MAX_WINDOW:
        break

window = max(kept, MIN_WINDOW)
```

**Advantages of Option D:**
- Short exchanges (simple chats) keep more history
- Long exchanges (heavy tool use) keep less — prevents payload explosion
- Adapts to actual usage patterns

**Why we're NOT implementing it now:**
- More complex, harder to predict behavior
- Fixed window of 4 is likely sufficient based on usage patterns
- Can always upgrade to Option D later if needed

---

## Verification Checklist

After implementation, the engineer MUST verify:

- [ ] `config/default.yaml` has `window_size: 4` (not 6)
- [ ] `MemoryConfig` dataclass in `config.py` has `window_size: int = 4` (not 6)
- [ ] `load_config()` in `config.py` still reads `window_size` from YAML with `.get("window_size", 4)` — verify the fallback matches the new default. Check line 173: `window_size=mem_raw.get("window_size", 6)` — this hardcoded `6` fallback **MUST be changed to `4`** to match the new default.
- [ ] `maybe_compress()` in `memory_manager.py` is NOT modified (it reads from config dynamically)
- [ ] `group_exchanges()` in `memory_manager.py` is NOT modified
- [ ] `chat()` and `chat_stream()` in `agent.py` are NOT modified
- [ ] No existing tests break (run `pytest tests/`)
- [ ] Manual verification: start the agent, have a conversation with 5+ exchanges, confirm that only 4 exchanges remain in history after compression fires
- [ ] Confirm that the 5th exchange was compressed via Haiku and stored in Nous (check logs for "Compressing 1 evicted exchange(s) in background")
- [ ] Confirm recalled context still works — after eviction, relevant memories from evicted exchanges should appear in `[From your memory — relevant context recalled automatically]`

---

## Risk Assessment

**Low risk.** The window change is purely a config value — no logic changes. The compression system already handles eviction gracefully:

1. **Evicted exchanges are preserved in Nous.** They're compressed via Haiku and stored as `custom:turn_summary` nodes. The agent can recall them via semantic search.

2. **No data loss.** Even if Haiku compression fails, the `_fallback_compress()` rule-based extractor provides a minimal summary (user question + tools used + truncated response).

3. **Reversible.** If quality degrades, change `window_size` back to 6 in one line. Or try 5 as a middle ground.

4. **Daemon wakes are unaffected.** Each daemon wake is an independent exchange. The window only accumulates during user chat sessions or rapid sequential wakes (rate-limited to 6/hour).

**The one scenario to watch:** A user having a long multi-turn analysis session (5+ back-and-forth exchanges about the same topic) might lose some earlier context. But the recalled memory context injection (`memory_manager.retrieve_context()`) should compensate — relevant earlier context gets pulled in via Nous search.

---

## Important: load_config() Fallback Value

There is a subtle gotcha in `config.py`. The `load_config()` function (line 173) has a hardcoded fallback:

```python
memory=MemoryConfig(
    window_size=mem_raw.get("window_size", 6),  # <-- hardcoded 6
    ...
)
```

This `6` is the fallback when `window_size` is not present in the YAML file. It MUST be changed to `4` to match the new default. If you only change the YAML and the dataclass default but miss this line, the fallback would still be 6, causing inconsistency when running without a config file.

---

## Files Modified

| File | Change |
|------|--------|
| `config/default.yaml` | `window_size: 6` → `window_size: 4` |
| `src/hynous/core/config.py` | `MemoryConfig.window_size` default: `6` → `4`. `load_config()` fallback: `6` → `4`. |
