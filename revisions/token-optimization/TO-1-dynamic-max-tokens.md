# TO-1: Dynamic max_tokens Per Wake Type

> Cap output tokens based on what the agent is actually doing. Output tokens are $15/M — 5x input cost.

**Status:** READY FOR IMPLEMENTATION
**Priority:** P0
**Estimated effort:** Small — config change + one parameter threaded through

---

## Problem

`config/default.yaml` line 28 sets a single global value:

```yaml
agent:
  max_tokens: 4096
```

This value is used in `agent.py` line 276:

```python
kwargs = {
    "model": self.config.agent.model,
    "max_tokens": self.config.agent.max_tokens,  # <-- always 4096
    ...
}
```

Every API call — whether a routine "all quiet" daemon review (~133 tokens needed) or a detailed user chat analysis (~1500 tokens needed) — allocates 4096 output tokens.

While `max_tokens` is a ceiling (not a target), Claude sometimes ignores brevity instructions in the system prompt, especially on learning wakes where the prompt says "take the space you need." A hard API-level cap ensures compliance.

---

## Solution

Thread a `max_tokens` parameter through `agent.chat()` and `agent.chat_stream()`, defaulting to the config value. Each daemon wake type passes an appropriate limit.

---

## Token Allocation Table

| Caller | Context | max_tokens | Rationale |
|--------|---------|-----------|-----------|
| **User chat** (dashboard, Discord) | David sends a message. Agent may do multi-tool analysis. | **2048** | Even a detailed market analysis with tables fits in ~1500 tokens. 4096 was never needed. |
| **Periodic review** | Hourly glance at market. "All quiet. BTC $97K. Watching $95K." | **512** | System prompt says "max 100 words for routine reviews." |
| **Learning review** | Every 3rd review. Researches a concept, stores a lesson. | **1536** | Agent is told "take the space you need." Research summaries can be 200-300 words. |
| **Watchpoint fire** | An alert triggered. Agent compares then-vs-now, may trade. | **1024** | Moderate analysis: compare conditions, decide action, update state. |
| **Fill (SL/TP)** | Stop loss or take profit triggered. Reflection + lesson. | **1536** | Important moment. Agent reflects, extracts lesson, archives thesis, scans market. |
| **Fill (manual)** | Position closed for unclear reason. Quick note. | **512** | Brief: note reason, clean up watchpoints. |
| **Contradiction review** | Pending conflicts in memory. Review and resolve. | **1024** | Agent calls manage_conflicts tool, resolves 1-5 conflicts. |
| **Curiosity/learning session** | Accumulated curiosity items. Deep research session. | **1536** | Same as learning review — web research, synthesis, lesson storage. |
| **Manual review** | David clicked "wake" button. On-demand update. | **1024** | David wants a status report. More detailed than routine review but not unbounded. |

---

## Required Reading (Before Implementation)

The engineer MUST read and understand these files before making changes:

1. **`config/default.yaml`** — Current config structure (lines 26-29 for agent settings). Understand how config is loaded.
2. **`src/hynous/core/config.py`** — How config is parsed into the `Config` object. You'll need to understand the `AgentConfig` or equivalent dataclass to add new fields.
3. **`src/hynous/intelligence/agent.py`** — The core file. Read entirely. Focus on:
   - `__init__()` (lines 44-98) — how config is consumed
   - `_api_kwargs()` (lines 261-297) — where max_tokens is set in API call
   - `chat()` (lines 417-521) — the non-streaming entry point
   - `chat_stream()` (lines 523-645) — the streaming entry point
4. **`src/hynous/intelligence/daemon.py`** — Read entirely. Focus on:
   - `_wake_agent()` (lines 1389-1554) — the central wake dispatch. This is where max_tokens gets passed.
   - `_wake_for_review()` (lines 1050-1107) — periodic review + learning. Needs to distinguish review vs learning.
   - `_wake_for_watchpoint()` (lines 906-961) — watchpoint fire.
   - `_wake_for_fill()` (lines 963-1048) — fill detection. Needs to distinguish SL/TP vs manual.
   - `_check_curiosity()` (lines 1318-1383) — learning session.
   - `_check_conflicts()` (lines 1169-1271) — contradiction review.
   - `trigger_manual_wake()` / `_manual_wake()` (lines 1560-1596) — manual wake from dashboard.

---

## Implementation Steps

### Step 1: Add max_tokens parameter to agent.chat() and agent.chat_stream()

**File:** `src/hynous/intelligence/agent.py`

Modify the `chat()` method signature (line 417):

```python
# BEFORE
def chat(self, message: str, skip_snapshot: bool = False) -> str:

# AFTER
def chat(self, message: str, skip_snapshot: bool = False, max_tokens: int | None = None) -> str:
```

Modify `_api_kwargs()` to accept and use the override. There are two approaches:

**Approach A (simpler):** Store as instance variable before calling `_api_kwargs()`:

```python
# In chat(), before kwargs = self._api_kwargs():
self._max_tokens_override = max_tokens

# In _api_kwargs():
"max_tokens": self._max_tokens_override or self.config.agent.max_tokens,
```

**Approach B (cleaner):** Pass max_tokens to `_api_kwargs()` directly:

```python
def _api_kwargs(self, max_tokens: int | None = None) -> dict:
    kwargs = {
        "model": self.config.agent.model,
        "max_tokens": max_tokens or self.config.agent.max_tokens,
        ...
    }
```

Use Approach B. It's explicit, no hidden state, and thread-safe.

Do the same for `chat_stream()` (line 523).

**CRITICAL:** Both `chat()` and `chat_stream()` call `_api_kwargs()` in two places:
1. Initial call (line 473 / line 584)
2. After tool use loop (line 505 / line 629): `kwargs["messages"] = ...` — this line only updates messages, not max_tokens, so max_tokens from the initial kwargs is preserved. No change needed here.

### Step 2: Update default config

**File:** `config/default.yaml`

Change the default max_tokens to 2048 (the new user chat default):

```yaml
agent:
  model: "claude-sonnet-4-5-20250929"
  max_tokens: 2048            # Max response tokens (user chat default)
  temperature: 0.7
```

This ensures that even if a caller doesn't pass max_tokens, the ceiling is 2048 instead of 4096.

### Step 3: Pass max_tokens from each daemon wake type

**File:** `src/hynous/intelligence/daemon.py`

Each wake method calls `self._wake_agent(message, ...)` which internally calls `self.agent.chat(full_message, ...)`. The max_tokens needs to flow through `_wake_agent()` to `agent.chat()`.

**3a.** Add `max_tokens` parameter to `_wake_agent()` (line 1389):

```python
# BEFORE
def _wake_agent(
    self, message: str, priority: bool = False,
    max_coach_cycles: int = 0,
) -> str | None:

# AFTER
def _wake_agent(
    self, message: str, priority: bool = False,
    max_coach_cycles: int = 0,
    max_tokens: int | None = None,
) -> str | None:
```

**3b.** Pass it through to `agent.chat()` (line 1515-1516):

```python
# BEFORE
response = self.agent.chat(
    full_message, skip_snapshot=bool(briefing_text),
)

# AFTER
response = self.agent.chat(
    full_message, skip_snapshot=bool(briefing_text),
    max_tokens=max_tokens,
)
```

**3c.** Pass appropriate values from each wake caller:

**`_wake_for_review()` (line 1093-1094):**
```python
# Learning review
if is_learning:
    response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1536)
# Normal review
else:
    response = self._wake_agent(message, max_coach_cycles=1, max_tokens=512)
```

**`_wake_for_watchpoint()` (line 948):**
```python
response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1024)
```

**`_wake_for_fill()` (line 1032):**
```python
# SL/TP fills get more space for reflection
if classification in ("stop_loss", "take_profit"):
    response = self._wake_agent(message, priority=True, max_coach_cycles=0, max_tokens=1536)
else:
    response = self._wake_agent(message, priority=True, max_coach_cycles=0, max_tokens=512)
```

**`_check_curiosity()` (line 1359):**
```python
response = self._wake_agent(message, max_coach_cycles=0, max_tokens=1536)
```

**`_check_conflicts()` (line 1261):**
```python
response = self._wake_agent(message, max_tokens=1024)
```

**`_manual_wake()` (line 1584):**
```python
response = self._wake_agent(message, priority=True, max_coach_cycles=1, max_tokens=1024)
```

### Step 4: Verify user chat paths

The user chat paths are:

1. **Dashboard:** `dashboard/state.py` calls `agent.chat_stream()` — no max_tokens passed, so it uses the config default (now 2048). Correct.
2. **Discord:** `src/hynous/discord/bot.py` calls `agent.chat()` — same default. Correct.

No changes needed for user chat paths — they inherit the config default.

---

## Verification Checklist

After implementation, the engineer MUST verify:

- [ ] `agent.chat("test")` uses config default (2048) when no max_tokens passed
- [ ] `agent.chat("test", max_tokens=512)` correctly caps at 512
- [ ] `agent.chat_stream("test")` uses config default when no max_tokens passed
- [ ] `agent.chat_stream("test", max_tokens=1024)` correctly caps at 1024
- [ ] `_api_kwargs(max_tokens=512)` produces `{"max_tokens": 512, ...}` in the returned dict
- [ ] `_api_kwargs()` with no argument produces `{"max_tokens": 2048, ...}` (config default)
- [ ] All 7 daemon wake callers pass the correct max_tokens value
- [ ] The `kwargs["messages"] = ...` line in the tool loop does NOT reset max_tokens
- [ ] `_wake_for_fill()` distinguishes SL/TP (1536) from manual (512)
- [ ] `_wake_for_review()` distinguishes learning (1536) from normal (512)
- [ ] No existing tests break (run `pytest tests/`)
- [ ] The config change from 4096 → 2048 doesn't break any hardcoded expectations elsewhere

---

## Risk Assessment

**Low risk.** `max_tokens` is a ceiling — reducing it can only make responses shorter, never cause errors. If a response hits the limit, Claude returns `stop_reason: "max_tokens"` instead of `"end_turn"`. The agent loop in `chat()` only continues on `stop_reason == "tool_use"`, so a truncated response is returned as-is.

The only scenario where this matters: if the agent tries to call a tool but gets cut off mid-JSON. This would only happen if max_tokens is set too low relative to the agent's reasoning + tool call. The proposed values (512-2048) are all well above the minimum needed for a tool call (~50-100 tokens).

---

## Files Modified

| File | Change |
|------|--------|
| `config/default.yaml` | max_tokens: 4096 → 2048 |
| `src/hynous/intelligence/agent.py` | Add max_tokens param to chat(), chat_stream(), _api_kwargs() |
| `src/hynous/intelligence/daemon.py` | Add max_tokens param to _wake_agent(), pass from all 7 wake callers |
