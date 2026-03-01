# MF-15: Gate Filter for Memory Quality — Solved

> Summary of the issue, what was done, considerations made, and impact on the system.

---

## The Issue

**Original priority:** P3

Every `store_memory` call passed content directly to Nous without any quality check. Junk content — empty messages, social pleasantries ("Thank you!"), spam patterns ("testtesttest"), filler words ("um like basically yeah so"), emoji-only messages, and other noise — could be stored as permanent memories, polluting the knowledge base.

**Concrete example:** If the agent processed a conversation where the user said "ok" or "thanks!" and the agent attempted to store that as a memory, it would create a real node in Nous with an embedding, FSRS schedule, and edges — wasting storage, embedding API calls, and degrading search quality by adding noise to the retrieval pool.

Nous core already had a comprehensive gate filter (`@nous/core/gate-filter`) with 8 rules, 16 filler words, 110 common words, 5 spam patterns, and 8 social patterns — all with 859 lines of tests. But this TypeScript filter operated at the server level. The Python intelligence layer needed its own pre-storage gate to reject junk before making any HTTP calls to Nous.

---

## Key Considerations

### 1. Python port, not a server endpoint

The gate filter rules are pure string/regex operations — no embeddings, no DB access, no network calls needed. Porting to Python eliminates a round-trip to Nous (~5ms overhead saved) and lets junk be rejected instantly at ~0ms cost. Zero external dependencies (only Python stdlib: `re`, `math`, `logging`, `dataclasses`).

### 2. Gate only in `_store_memory_impl()`

Other `create_node()` paths — `memory_manager._store_summary()`, `trading._store_to_nous()`, `watchpoints._create_watchpoint()` — produce structured, intentional content that should never be gated. Trade lifecycle records are always critical. Session summaries are auto-generated. Watchpoints have validated trigger conditions. Only the agent's freeform `store_memory` tool needs quality filtering.

### 3. Gate ALL memory types equally

The rules are conservative enough that legitimate content never triggers them. A single check at the top of `_store_memory_impl()` covers all types (lesson, thesis, episode, signal, etc.) without per-type conditionals. This is simpler and prevents any type from becoming a bypass path.

### 4. Skip R-007 (all caps detection)

Too many false positives in crypto context. Trading content naturally uses uppercase: "BTC SHORT SQUEEZE incoming", "LONG ETH at support", "SOL/BTC ratio broke above". Manually verified with 5 representative crypto trading strings — all would have triggered R-007 incorrectly.

### 5. R-001 threshold: 10 chars (raised from TypeScript's 3)

The TypeScript gate uses `< 3 chars` because it handles user-facing chat where short valid inputs exist. For the Hynous agent, a 3-character memory is useless. 10 chars catches truly garbage content ("ok", "hi there", "yes") while allowing any real memory through. "good stuff" (10 chars) passes.

### 6. Gate runs BEFORE dedup check

Don't waste an HTTP round-trip to `check_similar` (which generates embeddings) if the content is garbage. The gate check is ~0ms; the dedup check is ~300-500ms with embedding generation.

### 7. Gate runs BEFORE `get_client()`

The engineer moved both the `get_client` function call AND its import below the gate check. On rejected content, no Nous connection is even initialized — not even the module import overhead.

### 8. Config toggle for disabling

`gate_filter_enabled` in `MemoryConfig` (default `True`). Allows disabling the gate without code changes via `config/default.yaml`. When disabled, all content passes through as before.

---

## What Was Implemented

### 1. Gate filter module — `gate_filter.py`

**File:** `src/hynous/intelligence/gate_filter.py` (NEW — ~230 lines)

Standalone module implementing 6 rejection rules:

| Rule | Name | What it catches | Threshold |
|------|------|----------------|-----------|
| R-001 | `too_short` | Content < 10 chars after whitespace normalization | 10 chars |
| R-002 | `gibberish` | High Shannon entropy (> 4.5) AND low real-word ratio (< 0.3) | Both conditions required |
| R-003 | `spam_pattern` | 5 regex patterns: test/placeholder, asdf, marketing, repeated groups, digits-only | Any match |
| R-004 | `repeated_chars` | > 10 consecutive identical characters | `(.)\1{10,}` |
| R-005 | `pure_filler` | > 90% filler words in content with 5+ words | 16 filler words checked |
| R-006 | `empty_semantic` | Only emoji/punctuation/whitespace, < 2 semantic characters remaining | Explicit Unicode ranges |
| R-008 | `social_only` | Pure greetings/thanks/apologies matching 8 social patterns | English `en` patterns only |

All constants exactly match the TypeScript reference: 16 filler words, 110 common words, 5 spam patterns, 8 social patterns. `GateResult` is a frozen dataclass (`passed`, `reason`, `detail`). The `_PASS` singleton avoids repeated allocations on passing content.

### 2. Gate check in `_store_memory_impl()`

**File:** `src/hynous/intelligence/tools/memory.py`

Gate check inserted at the top of `_store_memory_impl()`, before both the dedup check and the `get_client()` call. On rejection, returns `"Not stored: {detail}"` — a distinct prefix from "Stored:", "Queued:", and "Duplicate:" so the agent can distinguish rejection from other outcomes.

### 3. Config field — `gate_filter_enabled`

**File:** `src/hynous/core/config.py`

`gate_filter_enabled: bool = True` added to `MemoryConfig` dataclass. Wired in `load_config()` via `mem_raw.get("gate_filter_enabled", True)`.

### 4. Unit tests — 50 test cases

**File:** `tests/unit/test_gate_filter.py` (NEW)

50 tests covering all 6 rejection rules, helper function tests (`_shannon_entropy`, `_is_gibberish`, `_matches_spam`, `_is_social_only`), `GateResult` dataclass behavior (passed, rejected, frozen immutability), and pass-through cases for legitimate crypto trading content.

### 5. Integration tests — 7 test cases

**File:** `tests/integration/test_gate_filter_integration.py` (NEW)

7 tests verifying the gate's integration with `_store_memory_impl()`: reject-short, reject-spam, reject-social, pass-good, gate-disabled bypass, reject-filler, episode-type-also-gated. Each rejection test verifies `mock_get_client.assert_not_called()` — confirming no Nous connection on rejected content.

---

## Audit Results

**Verdict: PASS — No P0, P1, or P2 issues found.**

57 automated test assertions all pass. Manual verification confirmed no false positives on 5 representative crypto trading strings ("BTC SHORT SQUEEZE incoming...", "LONG ETH at support, SL...", "SOL/BTC ratio broke above...", "BTCUSD PERP: funding flipped...", "0.001% funding = 8.76% annualized..."). Edge cases verified: exactly 10 chars passes, 9 chars rejects, whitespace normalization, 4 filler words passes (below minimum), 5 filler words rejects.

**4 informational P3 observations (no action needed):**

| # | Observation |
|---|-------------|
| P3-1 | Pre-existing editable install issue — tests need `PYTHONPATH` workaround (not caused by MF-15) |
| P3-2 | `__init__.py` files for test dirs not in guide — pragmatic addition for test discovery |
| P3-3 | R-003/R-004 overlap on single-char repeats — R-003's `(.{1,3})\1{5,}` catches before R-004's `(.)\1{10,}`. Content still rejected. Same overlap exists in TypeScript. |
| P3-4 | Unicode emoji regex uses explicit ranges instead of `\p{Emoji}` — acceptable trade-off for stdlib-only (avoiding `regex` package dependency) |

---

## Impact on the System

### Immediate

- **Stops knowledge base pollution.** Social pleasantries, spam, filler, and other junk are rejected before entering Nous. No embedding generated, no FSRS schedule created, no edges formed for garbage content.
- **Zero-cost rejection.** The gate is pure Python string/regex — ~0ms per check. Rejected content avoids both the dedup HTTP call (~300-500ms) and the node creation call. This is a net performance improvement for junk inputs.
- **Agent gets feedback.** On rejection, the agent sees "Not stored: Content too short (2 chars, minimum 10)" or "Not stored: Social pleasantry, not memorable." — enabling it to adjust its storage decisions.

### Long-term

- **Search quality improves.** Fewer junk nodes means SSA retrieval returns more relevant, meaningful memories within the limited retrieval budget.
- **Embedding costs reduced.** Each rejected memory saves one OpenAI text-embedding-3-small call (~$0.000004). At scale, this compounds.
- **Foundation for stricter rules.** New rules can be added to the gate filter module without touching any other code — just add a check in `check_content()` and it automatically applies to all `store_memory` calls.

---

## Files Changed

| File | Change |
|------|--------|
| `src/hynous/intelligence/gate_filter.py` | **NEW** — Gate filter module with 6 rules (~230 lines) |
| `src/hynous/intelligence/tools/memory.py` | Gate check in `_store_memory_impl()`, before dedup and `get_client()` |
| `src/hynous/core/config.py` | `gate_filter_enabled: bool = True` in `MemoryConfig` + wiring in `load_config()` |
| `tests/unit/test_gate_filter.py` | **NEW** — 50 unit tests |
| `tests/integration/test_gate_filter_integration.py` | **NEW** — 7 integration tests |
| `tests/unit/__init__.py` | **NEW** — Empty init for test discovery |
| `tests/integration/__init__.py` | **NEW** — Empty init for test discovery |
| `revisions/nous-wiring/more-functionality.md` | Mark MF-15 DONE |
| `revisions/nous-wiring/executive-summary.md` | Update companion files table (14 DONE, 2 SKIPPED, 0 remaining) |

**Implementation guide:** `revisions/MF15/implementation-guide.md`
**Audit notes:** `revisions/MF15/audit-notes.md`
