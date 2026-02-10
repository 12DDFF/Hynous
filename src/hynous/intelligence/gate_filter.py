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

# R-006: Empty semantic — strip emoji, punctuation, whitespace.
# After stripping, if < 2 chars remain, content is semantically empty.
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
