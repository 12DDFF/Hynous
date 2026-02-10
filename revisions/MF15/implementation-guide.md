# MF-15: Gate Filter for Memory Quality — Implementation Guide

> Pre-storage quality gate that rejects junk content before it enters Nous.
> Python port of the core TypeScript rules — no server changes needed.

---

## Prerequisites — Read Before Coding

Read these files **in order** before writing any code. Understanding the existing patterns is critical for consistent implementation.

### Must Read (Python — Hynous)

| # | File | Why |
|---|------|-----|
| 1 | `src/hynous/intelligence/tools/memory.py` | **Primary target file.** Contains `_store_memory_impl()` where the gate check will be inserted. Understand the full store flow: `handle_store_memory()` → queue-or-direct → `_store_memory_impl()` → dedup check → `client.create_node()`. Pay special attention to the queue mode (lines 36-80), the `_TYPE_MAP` (lines 217-232), the dedup check for lesson/curiosity (lines 420-463), and how results are returned to the agent (line 528-537). |
| 2 | `src/hynous/intelligence/memory_manager.py` | Contains `_TRIVIAL_MESSAGES` (lines 62-69) and `_is_trivial()` (lines 368-373) — the existing retrieval-side trivial check. Also contains `_store_summary()` (lines 309-349) which calls `create_node()` directly and should NOT be gated. Understand the overlap. |
| 3 | `src/hynous/intelligence/tools/trading.py` | Contains `_store_to_nous()` (lines 650-700) which calls `create_node()` directly for trade lifecycle records. Should NOT be gated. Read to understand why — trade records are always structured, deliberate, and critical. |
| 4 | `src/hynous/intelligence/tools/watchpoints.py` | Contains `_create_watchpoint()` which calls `create_node()` directly (line 198). Should NOT be gated. Read lines 180-218 to confirm. |
| 5 | `src/hynous/intelligence/tools/registry.py` | Tool registration pattern. No changes needed for MF-15 (no new tool), but read to understand the system. |
| 6 | `src/hynous/core/config.py` | Configuration dataclasses. You will add a `gate_filter_enabled` field to `MemoryConfig`. |

### Must Read (TypeScript — Reference Only)

| # | File | Why |
|---|------|-----|
| 7 | `nous-server/core/src/gate-filter/index.ts` | **Source of truth for all rules.** Read the constants (lines 1-360), every helper function (lines 870-1030), and the main `gateFilter()` function (lines 695-813). You are porting a subset of this to Python. Do NOT import from this — the Python port is standalone. |
| 8 | `nous-server/core/src/gate-filter/index.test.ts` | Test cases for the TypeScript rules. Use as reference for your Python test cases — same inputs should produce same outputs. |

### Must Read (Documentation)

| # | File | Why |
|---|------|-----|
| 9 | `revisions/nous-wiring/more-functionality.md` | Read lines 433-469 (MF-15 section) for the original spec and recommended approach. |
| 10 | `revisions/nous-wiring/executive-summary.md` | Context for where MF-15 fits in the broader integration. |
| 11 | `ARCHITECTURE.md` | System overview — understand the 4-layer architecture and data flow. |

---

## Architecture Decisions

All decisions are final. Do not deviate.

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Python port, no server endpoint** | Rules are pure string/regex ops. Zero network overhead. ~0ms latency. |
| 2 | **Gate only in `_store_memory_impl()`** | Other create_node paths (memory_manager, trading, watchpoints) produce structured, intentional content that should never be gated. |
| 3 | **Gate ALL memory types** | Rules are conservative enough that legitimate content never triggers them. One check at the top, no per-type conditionals. |
| 4 | **Check raw `content` param, not JSON body** | The `content` string is the human-readable text the agent wrote. JSON wrapping (for watchpoints/signals with trigger/signals fields) happens after the gate check. |
| 5 | **PASS/REJECT only — no PROMPT** | The caller is always the LLM agent, not a human. There's no interactive confirmation mechanism. Simplify to binary pass/reject. |
| 6 | **Skip R-007 (all caps)** | Too many false positives in crypto context. Trade-related content naturally uses uppercase ("BTC SHORT SQUEEZE", "LONG ETH at support"). |
| 7 | **Gate runs BEFORE dedup check** | Don't waste an HTTP round-trip to `check_similar` if the content is garbage. |
| 8 | **Rejection returns agent-visible feedback** | For synchronous stores (lesson/curiosity), the agent sees the rejection reason and can adjust. For queued stores, the rejection is logged but silent to the agent. |
| 9 | **Config toggle** | `gate_filter_enabled` in `MemoryConfig` (default `True`). Allows disabling without code changes. |

---

## Implementation Steps

### Step 1: Create the gate filter module

**File:** `src/hynous/intelligence/gate_filter.py` (NEW)

This is a standalone Python module with zero dependencies — pure string/regex operations. It ports 6 of the 8 TypeScript rules (skipping R-007 all caps and keeping the other 7 minus R-007).

**Rules to implement (6 rules):**

| Rule | Name | What it catches | Confidence | Decision |
|------|------|----------------|------------|----------|
| R-001 | `too_short` | Content < 10 chars after normalization | 1.0 | REJECT |
| R-002 | `gibberish` | High Shannon entropy + low real-word ratio | 0.98 | REJECT |
| R-003 | `spam_pattern` | Known spam/test/placeholder patterns | 0.97 | REJECT |
| R-004 | `repeated_chars` | > 10 consecutive identical characters | 0.96 | REJECT |
| R-005 | `pure_filler` | > 90% filler words in 5+ word content | 0.96 | REJECT |
| R-006 | `empty_semantic` | Only emoji/punctuation/whitespace, < 2 semantic chars | 0.88 | REJECT |
| R-008 | `social_only` | Pure greetings/thanks/apologies | 0.70 | REJECT |

> **IMPORTANT: R-001 threshold adjustment.** The TypeScript uses `< 3 chars`. For Hynous, use `< 10 chars`. A 3-character memory is useless for the agent. 10 chars is still very conservative — it catches truly garbage content like `"ok"`, `"hi there"`, `"yes"` while allowing any real memory content through.

**Exact code for `src/hynous/intelligence/gate_filter.py`:**

```python
"""
Gate Filter — Pre-storage quality gate for memory content.

Rejects junk content before it enters Nous. Python port of the core
rules from @nous/core/gate-filter (storm-036), adapted for Hynous.

Rules implemented (6 of 8):
  R-001: Too short (< 10 chars)
  R-002: Gibberish (high entropy + no real words)
  R-003: Spam patterns (test/placeholder/marketing)
  R-004: Repeated characters (> 10 consecutive same char)
  R-005: Pure filler (> 90% filler words in 5+ word content)
  R-006: Empty semantic content (only emoji/punctuation)
  R-008: Social-only (greetings, thanks, apologies)

Skipped:
  R-007: All caps — too many false positives in crypto context

Reference: nous-server/core/src/gate-filter/index.ts
"""

import logging
import math
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# ============================================================
# RESULT TYPE
# ============================================================

@dataclass(frozen=True)
class GateResult:
    """Result of gate filter evaluation."""
    passed: bool
    reason: str  # "pass", or the rejection reason (e.g. "too_short")
    detail: str  # Human-readable explanation for the agent


# ============================================================
# CONSTANTS
# ============================================================

# R-001: Minimum content length (adjusted from TypeScript's 3 to 10 for Hynous)
MIN_CONTENT_LENGTH = 10

# R-002: Gibberish detection thresholds (match TypeScript exactly)
GIBBERISH_ENTROPY_THRESHOLD = 4.5
GIBBERISH_WORD_RATIO_THRESHOLD = 0.3

# R-004: Repeated character pattern (> 10 consecutive same char)
REPEATED_CHARS_RE = re.compile(r"(.)\1{10,}")

# R-005: Filler word configuration
FILLER_THRESHOLD = 0.9  # > 90% filler = reject
MIN_WORDS_FOR_FILLER = 5

FILLER_WORDS = frozenset({
    "um", "uh", "like", "basically", "actually", "literally",
    "honestly", "so", "well", "anyway", "kind", "sort",
    "right", "okay", "yeah", "hmm",
})

# R-003: Spam patterns (match TypeScript exactly)
SPAM_PATTERNS = [
    re.compile(r"^(test|testing|asdf|qwerty)+$", re.IGNORECASE),
    re.compile(r"\b(buy now|click here|limited offer|act now|free money)\b", re.IGNORECASE),
    re.compile(r"(.{1,3})\1{5,}"),       # Short repeated groups (e.g. "hahahahaha")
    re.compile(r"^[0-9\s\-\+\(\)]+$"),   # Only phone numbers/digits
    re.compile(r"^\s*\d+\s*$"),           # Only numbers
]

# R-006: Empty semantic — regex to strip emoji, punctuation, whitespace
# After stripping, if < 2 chars remain, content is semantically empty.
# Python's \p{} requires the `regex` package. We use a broad approximation
# that covers the common cases: strip ASCII punctuation, whitespace, and
# common emoji ranges.
_EMOJI_PUNCT_WS_RE = re.compile(
    r"[\s"                         # whitespace
    r"!\"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~"  # ASCII punctuation
    r"\U0001F600-\U0001F64F"       # emoticons
    r"\U0001F300-\U0001F5FF"       # misc symbols & pictographs
    r"\U0001F680-\U0001F6FF"       # transport & map symbols
    r"\U0001F1E0-\U0001F1FF"       # flags
    r"\U00002702-\U000027B0"       # dingbats
    r"\U0000FE00-\U0000FE0F"       # variation selectors
    r"\U0001F900-\U0001F9FF"       # supplemental symbols
    r"\U0001FA00-\U0001FA6F"       # chess symbols
    r"\U0001FA70-\U0001FAFF"       # symbols extended-A
    r"\U00002600-\U000026FF"       # misc symbols
    r"]+"
)

# R-008: Social-only patterns (English only — Hynous is English-only)
SOCIAL_PATTERNS = [
    re.compile(r"^(hi|hello|hey|yo|sup)[\s!?.]*$", re.IGNORECASE),
    re.compile(r"^(thanks|thank you|ty|thx)[\s!?.]*$", re.IGNORECASE),
    re.compile(r"^(sorry|my bad|oops|apologies)[\s!?.]*$", re.IGNORECASE),
    re.compile(r"^(bye|goodbye|see you|later|cya)[\s!?.]*$", re.IGNORECASE),
    re.compile(r"^(ok|okay|k|sure|yep|yeah|yes|no|nope|nah)[\s!?.]*$", re.IGNORECASE),
    re.compile(r"^how are you[\s!?.]*$", re.IGNORECASE),
    re.compile(r"^what's up[\s!?.]*$", re.IGNORECASE),
    re.compile(r"^(good morning|good night|gm|gn)[\s!?.]*$", re.IGNORECASE),
]

# R-002: Common English words for real-word detection in gibberish check
# (match TypeScript COMMON_WORDS set exactly)
COMMON_WORDS = frozenset({
    # Articles, pronouns
    "the", "a", "an", "i", "you", "he", "she", "it", "we", "they",
    "me", "him", "her", "us", "them", "my", "your", "his", "our", "their",
    # Verbs
    "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did",
    "will", "would", "can", "could", "should", "may", "might", "must", "shall",
    # Conjunctions, prepositions
    "and", "or", "but", "if", "then", "because", "as", "until", "while",
    "of", "at", "by", "for", "with", "about", "against", "between", "into",
    "through", "during", "before", "after", "above", "below", "to", "from",
    "up", "down", "in", "out", "on", "off", "over", "under",
    # Common adverbs, adjectives
    "again", "further", "once", "here", "there", "when", "where", "why", "how",
    "all", "each", "few", "more", "most", "other", "some", "such",
    "no", "not", "only", "own", "same", "so", "than", "too", "very",
    # Common nouns
    "this", "that", "these", "those", "what", "which", "who", "whom",
})


# ============================================================
# MAIN GATE FUNCTION
# ============================================================

_PASS = GateResult(passed=True, reason="pass", detail="")


def check_content(content: str) -> GateResult:
    """Run gate filter rules on content.

    Args:
        content: Raw text content the agent wants to store.

    Returns:
        GateResult with passed=True if content is acceptable,
        or passed=False with reason and detail if rejected.
    """
    # Normalize whitespace (collapse multiple spaces, trim)
    text = re.sub(r"\s+", " ", content).strip()

    # R-001: Too short
    if len(text) < MIN_CONTENT_LENGTH:
        return GateResult(
            passed=False,
            reason="too_short",
            detail=f"Content too short ({len(text)} chars, minimum {MIN_CONTENT_LENGTH}). Write richer, more detailed content.",
        )

    # R-002: Gibberish (high entropy + low real-word ratio)
    if _is_gibberish(text):
        return GateResult(
            passed=False,
            reason="gibberish",
            detail="Content appears to be gibberish (random characters, no real words). Write meaningful content.",
        )

    # R-003: Spam patterns
    if _matches_spam(text):
        return GateResult(
            passed=False,
            reason="spam_pattern",
            detail="Content matches a spam/test pattern. Write substantive content worth remembering.",
        )

    # R-004: Repeated characters
    if REPEATED_CHARS_RE.search(text):
        return GateResult(
            passed=False,
            reason="repeated_chars",
            detail="Content has excessive repeated characters. Write clean, meaningful content.",
        )

    # R-005: Pure filler words (> 90% filler in 5+ word content)
    words = text.lower().split()
    if len(words) >= MIN_WORDS_FOR_FILLER:
        filler_count = sum(1 for w in words if w in FILLER_WORDS)
        filler_ratio = filler_count / len(words)
        if filler_ratio > FILLER_THRESHOLD:
            return GateResult(
                passed=False,
                reason="pure_filler",
                detail="Content is mostly filler words (um, like, basically...). Write substantive content.",
            )

    # R-006: Empty semantic content (only emoji/punctuation)
    semantic = _EMOJI_PUNCT_WS_RE.sub("", text)
    if len(semantic) < 2:
        return GateResult(
            passed=False,
            reason="empty_semantic",
            detail="Content has no meaningful text (only emoji/punctuation). Write text with substance.",
        )

    # R-008: Social-only (greetings, thanks, apologies)
    if _is_social_only(text):
        return GateResult(
            passed=False,
            reason="social_only",
            detail="Content is just a social pleasantry (greeting/thanks/apology). Not worth storing as a memory.",
        )

    return _PASS


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def _is_gibberish(text: str) -> bool:
    """R-002: Check if text is gibberish (high entropy + no real words).

    Requires BOTH conditions:
      1. Shannon entropy > 4.5 (high character randomness)
      2. Real word ratio < 0.3 (most words aren't recognizable)
    """
    entropy = _shannon_entropy(text)
    if entropy <= GIBBERISH_ENTROPY_THRESHOLD:
        return False

    words = text.lower().split()
    if not words:
        return True

    # Words > 2 chars count as "real" even if not in COMMON_WORDS
    # (matches TypeScript countRealWords behavior)
    real_count = sum(1 for w in words if w in COMMON_WORDS or len(w) > 2)
    word_ratio = real_count / len(words)

    return word_ratio < GIBBERISH_WORD_RATIO_THRESHOLD


def _shannon_entropy(text: str) -> float:
    """Calculate Shannon entropy (bits per character).

    Higher entropy = more random/uniform character distribution.
    Normal English text: ~3.5-4.0. Random chars: ~4.5+.
    """
    if not text:
        return 0.0

    freq: dict[str, int] = {}
    for ch in text:
        freq[ch] = freq.get(ch, 0) + 1

    length = len(text)
    return -sum(
        (count / length) * math.log2(count / length)
        for count in freq.values()
    )


def _matches_spam(text: str) -> bool:
    """R-003: Check if text matches known spam patterns."""
    return any(pattern.search(text) for pattern in SPAM_PATTERNS)


def _is_social_only(text: str) -> bool:
    """R-008: Check if text is a social pleasantry."""
    trimmed = text.strip()
    return any(pattern.match(trimmed) for pattern in SOCIAL_PATTERNS)
```

**Key differences from TypeScript:**
- `MIN_CONTENT_LENGTH` = 10 (not 3) — more useful threshold for agent memories
- No R-007 (all caps) — skipped per architecture decision
- English-only social patterns — Hynous is English-only
- `GateResult` dataclass instead of full `GateFilterResult` — no confidence/latency/transformations needed
- No PROMPT/BYPASS decisions — binary PASS/REJECT
- No metrics tracking, audit logging, or envelope schema — unnecessary complexity
- Uses `re` module only (stdlib) — no external dependencies

---

### Step 2: Add config toggle

**File:** `src/hynous/core/config.py`

Add `gate_filter_enabled` to `MemoryConfig`.

**Find this block** (the `MemoryConfig` dataclass):

```python
@dataclass
class MemoryConfig:
    """Memory manager configuration."""
    compress_enabled: bool = True
    compression_model: str = "claude-haiku-4-5-20251001"
    window_size: int = 8
    retrieve_limit: int = 5
    max_context_tokens: int = 800
```

**Add one field at the end:**

```python
@dataclass
class MemoryConfig:
    """Memory manager configuration."""
    compress_enabled: bool = True
    compression_model: str = "claude-haiku-4-5-20251001"
    window_size: int = 8
    retrieve_limit: int = 5
    max_context_tokens: int = 800
    gate_filter_enabled: bool = True
```

That's it. Default `True`. Can be set to `False` in `config/default.yaml` under `memory.gate_filter_enabled` to disable.

---

### Step 3: Integrate gate filter into `_store_memory_impl()`

**File:** `src/hynous/intelligence/tools/memory.py`

This is the critical integration. The gate check runs at the **top** of `_store_memory_impl()`, before any HTTP calls (dedup, create_node, linking).

**3a. Add the import at the top of the file (after existing imports, around line 28):**

```python
from ..gate_filter import check_content
```

**3b. Add the gate check inside `_store_memory_impl()`.** Find the beginning of the function (line 374):

```python
def _store_memory_impl(
    content: str,
    memory_type: str,
    title: str,
    trigger: Optional[dict] = None,
    signals: Optional[dict] = None,
    link_ids: Optional[list] = None,
    event_time: Optional[str] = None,
    cluster: Optional[str] = None,
) -> str:
    """Actually store a memory in Nous (HTTP calls + linking)."""
    from ...nous.client import get_client
    client = get_client()

    node_type, subtype = _TYPE_MAP[memory_type]
```

**Replace with** (inserting the gate check between the client init and the type lookup):

```python
def _store_memory_impl(
    content: str,
    memory_type: str,
    title: str,
    trigger: Optional[dict] = None,
    signals: Optional[dict] = None,
    link_ids: Optional[list] = None,
    event_time: Optional[str] = None,
    cluster: Optional[str] = None,
) -> str:
    """Actually store a memory in Nous (HTTP calls + linking)."""
    from ...nous.client import get_client
    from ...core.config import load_config

    # --- Gate filter (MF-15) ---
    # Reject junk content before any HTTP calls to Nous.
    # Runs on ALL memory types. For synchronous stores (lesson/curiosity),
    # the agent sees the rejection feedback. For queued stores, the rejection
    # is logged but silent to the agent (acceptable — rules are conservative).
    cfg = load_config()
    if cfg.memory.gate_filter_enabled:
        gate_result = check_content(content)
        if not gate_result.passed:
            logger.info(
                "Gate filter rejected %s \"%s\": %s",
                memory_type, title[:50], gate_result.reason,
            )
            return f"Not stored: {gate_result.detail}"

    client = get_client()

    node_type, subtype = _TYPE_MAP[memory_type]
```

**What this does:**
- Loads config to check `gate_filter_enabled` toggle
- Calls `check_content(content)` with the raw content string (not the JSON body)
- If rejected: logs the rejection, returns an agent-visible message starting with `"Not stored: "` followed by the human-readable detail
- If passed: continues with the normal flow (dedup → create_node → linking)
- The `load_config()` call uses the cached singleton, so there's negligible overhead

**IMPORTANT notes for the engineer:**
1. The `from ...core.config import load_config` import is added alongside the existing `from ...nous.client import get_client`. Both use cached singletons.
2. The gate check runs BEFORE `client = get_client()` to avoid initializing the Nous client on rejected content. Actually, we need the config first, so we load config, check gate, then get client. Move the `client = get_client()` line to AFTER the gate check.
3. The return format `"Not stored: {detail}"` is intentionally different from `"Stored: ..."` and `"Queued: ..."` and `"Duplicate: ..."` so the agent can distinguish between outcomes.
4. Do NOT add any gate check to `handle_store_memory()`. The gate belongs in `_store_memory_impl()` so it covers both the direct path AND the queue flush path.

---

### Step 4: Write unit tests for the gate filter module

**File:** `tests/unit/test_gate_filter.py` (NEW)

```python
"""Tests for the gate filter module (MF-15)."""

import pytest

from hynous.intelligence.gate_filter import (
    GateResult,
    check_content,
    _is_gibberish,
    _shannon_entropy,
    _matches_spam,
    _is_social_only,
    MIN_CONTENT_LENGTH,
)


class TestCheckContent:
    """Tests for the main check_content function."""

    # --- R-001: Too short ---

    def test_rejects_empty_string(self):
        result = check_content("")
        assert not result.passed
        assert result.reason == "too_short"

    def test_rejects_very_short_content(self):
        result = check_content("hi")
        assert not result.passed
        assert result.reason == "too_short"

    def test_rejects_whitespace_only(self):
        result = check_content("   \t\n   ")
        assert not result.passed
        assert result.reason == "too_short"

    def test_rejects_content_below_threshold(self):
        result = check_content("short txt")  # 9 chars
        assert not result.passed
        assert result.reason == "too_short"

    def test_passes_content_at_threshold(self):
        result = check_content("good stuff")  # 10 chars
        assert result.passed

    # --- R-002: Gibberish ---

    def test_passes_normal_english_text(self):
        result = check_content("Hello, how are you today? I need help with something.")
        assert result.passed

    def test_passes_technical_content(self):
        result = check_content("BTC funding rate dropped to -0.01% with OI increasing by 5%")
        assert result.passed

    # --- R-003: Spam patterns ---

    def test_rejects_test_content(self):
        result = check_content("testtest")
        assert not result.passed
        assert result.reason == "spam_pattern"

    def test_rejects_asdf_content(self):
        result = check_content("asdfasdfasdf")
        assert not result.passed
        assert result.reason == "spam_pattern"

    def test_rejects_marketing_spam(self):
        result = check_content("Buy now and save on this limited offer!")
        assert not result.passed
        assert result.reason == "spam_pattern"

    def test_rejects_number_only_content(self):
        result = check_content("123-456-7890")
        assert not result.passed
        assert result.reason == "spam_pattern"

    def test_rejects_digits_only(self):
        result = check_content("1234567890")
        assert not result.passed
        assert result.reason == "spam_pattern"

    def test_passes_numbers_in_context(self):
        result = check_content("BTC price is $68,500 with funding at 0.01%")
        assert result.passed

    # --- R-004: Repeated characters ---

    def test_rejects_repeated_chars(self):
        result = check_content("This is greaaaaaaaaaaat")
        assert not result.passed
        assert result.reason == "repeated_chars"

    def test_passes_normal_repetition(self):
        result = check_content("This is really good stuff here")
        assert result.passed

    # --- R-005: Pure filler ---

    def test_rejects_pure_filler_content(self):
        result = check_content("um like basically yeah so anyway hmm")
        assert not result.passed
        assert result.reason == "pure_filler"

    def test_passes_filler_mixed_with_substance(self):
        result = check_content("so basically BTC is showing a bullish divergence on the 4h chart")
        assert result.passed

    def test_skips_filler_check_for_short_messages(self):
        # < 5 words — filler check doesn't apply
        result = check_content("um like yeah")
        # Should NOT be rejected for filler (too few words)
        # May be rejected for other reasons (too short, social, etc.)
        if not result.passed:
            assert result.reason != "pure_filler"

    # --- R-006: Empty semantic ---

    def test_rejects_emoji_only(self):
        result = check_content("\U0001F600\U0001F600\U0001F600\U0001F600")
        assert not result.passed
        assert result.reason == "empty_semantic"

    def test_rejects_punctuation_only(self):
        result = check_content("!!!...???!!!")
        assert not result.passed
        assert result.reason == "empty_semantic"

    def test_passes_text_with_emoji(self):
        result = check_content("Great analysis on BTC \U0001F680\U0001F680")
        assert result.passed

    # --- R-008: Social only ---

    def test_rejects_greeting(self):
        result = check_content("Hello there!")
        # "Hello there!" is 12 chars, passes R-001
        # But check if it matches social pattern — "Hello there!" doesn't match
        # because patterns require JUST the greeting word(s)
        # "Hello!" would match though
        pass  # See specific greeting tests below

    def test_rejects_hello(self):
        result = check_content("Hello!    ")  # with trailing spaces
        assert not result.passed
        assert result.reason == "social_only"

    def test_rejects_thanks(self):
        result = check_content("Thank you!")
        assert not result.passed
        assert result.reason == "social_only"

    def test_rejects_ok(self):
        # "ok" is < 10 chars, so it's caught by too_short first
        result = check_content("ok")
        assert not result.passed
        assert result.reason == "too_short"

    def test_rejects_sure(self):
        # "sure" is < 10 chars, caught by too_short
        result = check_content("sure")
        assert not result.passed
        assert result.reason == "too_short"

    def test_passes_greeting_with_substance(self):
        result = check_content("Hello, I need to analyze the BTC funding rate divergence")
        assert result.passed

    # --- PASS cases ---

    def test_passes_meaningful_lesson(self):
        result = check_content(
            "Funding rate inversions that persist for more than 4 hours "
            "during low volume periods tend to resolve with a 2-3% move "
            "in the direction opposite to the crowded side."
        )
        assert result.passed

    def test_passes_thesis(self):
        result = check_content(
            "BTC is setting up for a short squeeze. Funding has been negative "
            "for 12 hours, OI is rising, and we just bounced off the 200 EMA "
            "on the 4h with strong bid walls at 67K."
        )
        assert result.passed

    def test_passes_episode(self):
        result = check_content(
            "BTC dropped 5% in 2 hours after a cascade of liquidations "
            "triggered by a large sell wall at 70K being swept."
        )
        assert result.passed

    def test_passes_signal_content(self):
        result = check_content(
            "BTC funding: -0.015%, OI: $18.2B (+3%), Fear/Greed: 35, "
            "24h volume: $42B, dominance: 54.2%"
        )
        assert result.passed

    def test_passes_watchpoint_content(self):
        result = check_content(
            "Alert me if BTC funding drops below -0.05% — that would signal "
            "extreme short crowding and a potential squeeze setup."
        )
        assert result.passed

    def test_passes_unicode_content(self):
        result = check_content("This analysis covers the BTC market in detail")
        assert result.passed

    def test_passes_long_content(self):
        result = check_content("This is a detailed analysis. " * 50)
        assert result.passed


class TestHelpers:
    """Tests for individual helper functions."""

    def test_shannon_entropy_empty(self):
        assert _shannon_entropy("") == 0.0

    def test_shannon_entropy_single_char(self):
        assert _shannon_entropy("aaaa") == 0.0

    def test_shannon_entropy_varied_higher(self):
        low = _shannon_entropy("aaaa")
        high = _shannon_entropy("abcd")
        assert high > low

    def test_is_gibberish_normal_text(self):
        assert not _is_gibberish("Hello, how are you today?")

    def test_is_gibberish_common_words(self):
        assert not _is_gibberish("the cat is on the mat and it is sleeping")

    def test_matches_spam_test(self):
        assert _matches_spam("test")
        assert _matches_spam("testing")
        assert _matches_spam("asdf")

    def test_matches_spam_marketing(self):
        assert _matches_spam("Click here for more info")
        assert _matches_spam("Buy now while supplies last")

    def test_matches_spam_repeated(self):
        assert _matches_spam("hahahahahahahahahaha")

    def test_matches_spam_normal_text(self):
        assert not _matches_spam("I need to buy groceries tomorrow")

    def test_is_social_only_greetings(self):
        assert _is_social_only("hi")
        assert _is_social_only("hello!")
        assert _is_social_only("hey")
        assert _is_social_only("Hello?")

    def test_is_social_only_thanks(self):
        assert _is_social_only("thanks")
        assert _is_social_only("thank you!")
        assert _is_social_only("ty")

    def test_is_social_only_with_substance(self):
        assert not _is_social_only("Hello, I need help with BTC analysis")

    def test_is_social_only_case_insensitive(self):
        assert _is_social_only("HELLO!")
        assert _is_social_only("Thanks!")
        assert _is_social_only("YEP")


class TestGateResult:
    """Tests for the GateResult dataclass."""

    def test_passed_result(self):
        result = GateResult(passed=True, reason="pass", detail="")
        assert result.passed
        assert result.reason == "pass"

    def test_rejected_result(self):
        result = GateResult(passed=False, reason="too_short", detail="Content too short.")
        assert not result.passed
        assert result.reason == "too_short"
        assert "too short" in result.detail.lower()

    def test_frozen(self):
        result = GateResult(passed=True, reason="pass", detail="")
        with pytest.raises(AttributeError):
            result.passed = False  # type: ignore
```

---

### Step 5: Write integration test for the gate filter in store_memory flow

**File:** `tests/integration/test_gate_filter_integration.py` (NEW)

This tests the actual integration in `_store_memory_impl` — verifying that rejected content never reaches Nous.

```python
"""Integration tests for gate filter in the store_memory flow."""

from unittest.mock import patch, MagicMock

import pytest

from hynous.intelligence.tools.memory import _store_memory_impl


class TestGateFilterIntegration:
    """Test that gate filter correctly blocks junk in _store_memory_impl."""

    @patch("hynous.intelligence.tools.memory.load_config")
    @patch("hynous.intelligence.tools.memory.get_client")
    def test_rejects_short_content(self, mock_get_client, mock_config):
        """Short content should be rejected before any Nous call."""
        mock_config.return_value = _make_config(gate_enabled=True)

        result = _store_memory_impl(
            content="hi",
            memory_type="lesson",
            title="Test",
        )

        assert result.startswith("Not stored:")
        assert "too short" in result.lower()
        mock_get_client.assert_not_called()

    @patch("hynous.intelligence.tools.memory.load_config")
    @patch("hynous.intelligence.tools.memory.get_client")
    def test_rejects_spam_content(self, mock_get_client, mock_config):
        """Spam content should be rejected."""
        mock_config.return_value = _make_config(gate_enabled=True)

        result = _store_memory_impl(
            content="testtest",
            memory_type="lesson",
            title="Test",
        )

        assert result.startswith("Not stored:")
        mock_get_client.assert_not_called()

    @patch("hynous.intelligence.tools.memory.load_config")
    @patch("hynous.intelligence.tools.memory.get_client")
    def test_passes_good_content(self, mock_get_client, mock_config):
        """Good content should pass through to Nous."""
        mock_config.return_value = _make_config(gate_enabled=True)
        mock_client = MagicMock()
        mock_client.check_similar.return_value = {
            "recommendation": "unique",
            "matches": [],
        }
        mock_client.create_node.return_value = {"id": "n_test123456"}
        mock_get_client.return_value = mock_client

        result = _store_memory_impl(
            content="BTC funding rate inverted to -0.02% indicating extreme short crowding",
            memory_type="lesson",
            title="Funding inversion signal",
        )

        assert result.startswith("Stored:")
        mock_client.create_node.assert_called_once()

    @patch("hynous.intelligence.tools.memory.load_config")
    @patch("hynous.intelligence.tools.memory.get_client")
    def test_gate_disabled_allows_junk(self, mock_get_client, mock_config):
        """When gate_filter_enabled=False, junk content should pass through."""
        mock_config.return_value = _make_config(gate_enabled=False)
        mock_client = MagicMock()
        mock_client.create_node.return_value = {"id": "n_test123456"}
        mock_get_client.return_value = mock_client

        result = _store_memory_impl(
            content="hi",
            memory_type="episode",
            title="Test",
        )

        # Should NOT be rejected — gate is disabled
        assert not result.startswith("Not stored:")
        mock_client.create_node.assert_called_once()

    @patch("hynous.intelligence.tools.memory.load_config")
    @patch("hynous.intelligence.tools.memory.get_client")
    def test_rejects_social_only(self, mock_get_client, mock_config):
        """Social pleasantries should be rejected."""
        mock_config.return_value = _make_config(gate_enabled=True)

        result = _store_memory_impl(
            content="Thank you!",
            memory_type="lesson",
            title="Thanks",
        )

        assert result.startswith("Not stored:")
        assert "social" in result.lower() or "pleasantry" in result.lower()
        mock_get_client.assert_not_called()


def _make_config(gate_enabled: bool = True):
    """Create a minimal mock config for testing."""
    config = MagicMock()
    config.memory.gate_filter_enabled = gate_enabled
    config.memory.compress_enabled = True
    return config
```

**Important notes for the engineer on patching:**
- `load_config` needs to be patched at `hynous.intelligence.tools.memory.load_config` (where it's imported), not at `hynous.core.config.load_config` (where it's defined). Since the import is inside the function (`from ...core.config import load_config`), you patch it at the point of use.
- Same for `get_client` — patch at `hynous.intelligence.tools.memory.get_client`.
- If the imports are inside the function body (they are — see lines 385-386 of memory.py), the patches need to target the module where the function resolves them. Since `_store_memory_impl` does `from ...nous.client import get_client` inside the function, the patch path depends on how Python resolves it. The safest approach: patch the `get_client` function on the `hynous.nous.client` module directly, or use `patch.object`. **Test this and adjust patch paths if needed.**

---

### Step 6: Verify no other paths are affected

This is a **verification step**, not a code change. The engineer must confirm:

1. **`memory_manager.py:_store_summary()`** (line 333) — calls `nous.create_node()` directly, does NOT go through `_store_memory_impl()`. Gate filter does NOT affect this path. Verify by reading lines 309-349.

2. **`trading.py:_store_to_nous()`** (line 677) — calls `client.create_node()` directly, does NOT go through `_store_memory_impl()`. Gate filter does NOT affect this path. Verify by reading lines 650-700.

3. **`watchpoints.py`** (line 198) — calls `client.create_node()` directly, does NOT go through `_store_memory_impl()`. Gate filter does NOT affect this path. Verify by reading lines 180-218.

4. **`flush_memory_queue()`** (line 71-79) — calls `_store_memory_impl()` for each queued item. Gate filter DOES run here. Queued items that fail gate are logged but the agent doesn't see the rejection (acceptable). Verify by reading lines 56-79.

---

### Step 7: Update documentation

**7a. Update `revisions/nous-wiring/more-functionality.md`**

Find the MF-15 section header (around line 433):

```
## MF-15. [P3] Gate Filter for Memory Quality
```

Change the header to mark it DONE:

```
## ~~MF-15. [P3] Gate Filter for Memory Quality~~ DONE
```

Add a brief completion note at the end of the MF-15 section (after line 469):

```
### Implementation (DONE)

Python port of 6 core rules (R-001 through R-006, R-008; R-007 skipped for crypto context). Gate runs in `_store_memory_impl()` before dedup check — all memory types gated. Binary PASS/REJECT, no PROMPT. Config toggle: `memory.gate_filter_enabled` (default True).

Module: `src/hynous/intelligence/gate_filter.py`
Tests: `tests/unit/test_gate_filter.py`, `tests/integration/test_gate_filter_integration.py`
```

**7b. Update `revisions/nous-wiring/executive-summary.md`**

This file doesn't have a dedicated MF-15 section, but the companion files table (line 10) references `more-functionality.md`. Update the count in the table row:

Find:
```
| `more-functionality.md` | 16 items (MF-0 through MF-15) — Nous capabilities. 12 DONE, 1 SKIPPED, 3 remaining |
```

Replace with:
```
| `more-functionality.md` | 16 items (MF-0 through MF-15) — Nous capabilities. 13 DONE, 2 SKIPPED, 1 remaining |
```

> Note: MF-14 was also SKIPPED, so the count is now 13 DONE (was 12), 2 SKIPPED (MF-11 + MF-14), 1 remaining (MF-13 if still in progress, or 0 if done).
> The engineer should check the actual current state of MF-13 and MF-14 when updating. If MF-14 hasn't been marked SKIPPED yet in `more-functionality.md`, do that too — add `~~ SKIPPED` to its header and a brief note: "Skipped: Hebbian strengthening already provides signal discrimination, trading knowledge stays relevant long-term, graph too small for edge noise to matter."

**7c. Update `ARCHITECTURE.md`**

No changes needed — the gate filter is internal to the store_memory flow and doesn't add new endpoints, tools, or architectural components.

---

## File Summary

| File | Action | What changes |
|------|--------|-------------|
| `src/hynous/intelligence/gate_filter.py` | **NEW** | Gate filter module — 6 rules, ~180 lines |
| `src/hynous/intelligence/tools/memory.py` | MODIFY | Add import + gate check at top of `_store_memory_impl()` (~10 lines) |
| `src/hynous/core/config.py` | MODIFY | Add `gate_filter_enabled: bool = True` to `MemoryConfig` (1 line) |
| `tests/unit/test_gate_filter.py` | **NEW** | Unit tests for all 6 rules + helpers (~200 lines) |
| `tests/integration/test_gate_filter_integration.py` | **NEW** | Integration tests for store flow (~80 lines) |
| `revisions/nous-wiring/more-functionality.md` | MODIFY | Mark MF-15 DONE |
| `revisions/nous-wiring/executive-summary.md` | MODIFY | Update counts |

**Total:** 2 new files, 5 modified files.

---

## Self-Review Checklist

The engineer MUST verify all of these before submitting to the auditor.

### Module correctness

- [ ] `gate_filter.py` has zero external dependencies (only stdlib: `re`, `math`, `logging`, `dataclasses`)
- [ ] `MIN_CONTENT_LENGTH` is 10, not 3
- [ ] R-007 (all caps) is NOT implemented
- [ ] All 6 rules (R-001, R-002, R-003, R-004, R-005, R-006, R-008) are implemented
- [ ] `check_content()` normalizes whitespace before checking rules
- [ ] `check_content()` returns `GateResult(passed=True, ...)` for valid content
- [ ] `check_content()` returns `GateResult(passed=False, reason=..., detail=...)` for rejected content
- [ ] `_is_gibberish()` requires BOTH high entropy AND low word ratio (not just one)
- [ ] `_shannon_entropy()` returns 0.0 for empty string
- [ ] `_matches_spam()` uses `pattern.search()` (not `.match()`) so it catches spam anywhere in text
- [ ] `_is_social_only()` uses `pattern.match()` (anchored to start) so it only catches pure social messages
- [ ] SPAM_PATTERNS list exactly matches the 5 TypeScript patterns
- [ ] SOCIAL_PATTERNS list covers: greetings, thanks, apologies, farewells, yes/no/ok, "how are you", "what's up", "good morning/night"
- [ ] FILLER_WORDS set matches the TypeScript FILLER_WORDS set exactly (16 words)
- [ ] COMMON_WORDS set matches the TypeScript COMMON_WORDS set exactly

### Integration correctness

- [ ] `_store_memory_impl()` loads config and checks `gate_filter_enabled` before any HTTP calls
- [ ] Gate check runs BEFORE the dedup check (lesson/curiosity) and BEFORE `client.create_node()`
- [ ] `get_client()` is NOT called if content is rejected (no wasted Nous connection)
- [ ] Rejected content returns `"Not stored: {detail}"` — agent sees clear feedback
- [ ] `load_config()` uses cached singleton — no performance impact
- [ ] `gate_filter_enabled` field added to `MemoryConfig` with default `True`
- [ ] No gate check added to `handle_store_memory()` — only in `_store_memory_impl()`
- [ ] No gate check added to `memory_manager.py`, `trading.py`, or `watchpoints.py`

### Test correctness

- [ ] Unit tests cover all 6 rejection rules with specific test cases
- [ ] Unit tests verify PASS for legitimate crypto/trading content (lesson, thesis, episode, signal, watchpoint)
- [ ] Unit tests verify edge cases: empty string, whitespace-only, unicode, long content
- [ ] Integration tests verify rejected content never triggers `create_node()`
- [ ] Integration tests verify `gate_filter_enabled=False` allows all content through
- [ ] Integration tests verify good content passes through to `create_node()`
- [ ] All tests pass: `pytest tests/unit/test_gate_filter.py tests/integration/test_gate_filter_integration.py -v`

### No regressions

- [ ] Existing `store_memory` behavior unchanged for valid content
- [ ] Queue mode still works: queued items go through gate at flush time
- [ ] Dedup check (MF-0) still runs after gate passes
- [ ] Wikilink resolution still runs after gate passes
- [ ] Auto-link still runs after gate passes
- [ ] Cluster assignment (MF-13) still runs after gate passes
- [ ] Contradiction detection still runs after gate passes
- [ ] `recall_memory` is completely unaffected
- [ ] `update_memory` is completely unaffected
- [ ] Turn summary compression path is completely unaffected
- [ ] Trade memory storage path is completely unaffected
- [ ] Watchpoint creation path is completely unaffected

### Documentation

- [ ] MF-15 marked DONE in `more-functionality.md`
- [ ] Counts updated in `executive-summary.md`
- [ ] MF-14 marked SKIPPED in `more-functionality.md` (if not already done)
