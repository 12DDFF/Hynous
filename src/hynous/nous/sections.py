"""
Memory Sections — Python-side section definitions.

Mirrors the TypeScript module @nous/core/sections.
Sections are a BIAS LAYER on top of existing SSA search:
- All nodes stay in one table
- All queries still search all nodes
- Sections influence HOW results are scored (reranking weights),
  how fast they decay (FSRS params), and how strongly they encode (salience)

See: revisions/memory-sections/executive-summary.md

IMPORTANT: This file must stay in sync with:
  nous-server/core/src/sections/index.ts
"""

from __future__ import annotations

from enum import Enum
from dataclasses import dataclass, field
from typing import Optional


# ============================================================
# SECTION ENUM
# ============================================================

class MemorySection(str, Enum):
    """The four memory sections, inspired by brain regions."""
    EPISODIC = "EPISODIC"       # Hippocampus — what happened
    SIGNALS = "SIGNALS"         # Sensory cortex — what to watch
    KNOWLEDGE = "KNOWLEDGE"     # Neocortex — what I've learned
    PROCEDURAL = "PROCEDURAL"   # Cerebellum — how to act


# ============================================================
# SUBTYPE → SECTION MAPPING
# ============================================================

# SINGLE SOURCE OF TRUTH (Python side).
# Must match SUBTYPE_TO_SECTION in nous-server/core/src/sections/index.ts
SUBTYPE_TO_SECTION: dict[str, MemorySection] = {
    # EPISODIC — What happened
    "custom:trade_entry": MemorySection.EPISODIC,
    "custom:trade_close": MemorySection.EPISODIC,
    "custom:trade_modify": MemorySection.EPISODIC,
    "custom:trade": MemorySection.EPISODIC,
    "custom:turn_summary": MemorySection.EPISODIC,
    "custom:session_summary": MemorySection.EPISODIC,
    "custom:market_event": MemorySection.EPISODIC,

    # SIGNALS — What to watch
    "custom:signal": MemorySection.SIGNALS,
    "custom:watchpoint": MemorySection.SIGNALS,

    # KNOWLEDGE — What I've learned
    "custom:lesson": MemorySection.KNOWLEDGE,
    "custom:thesis": MemorySection.KNOWLEDGE,
    "custom:curiosity": MemorySection.KNOWLEDGE,

    # PROCEDURAL — How to act
    "custom:playbook": MemorySection.PROCEDURAL,
    "custom:missed_opportunity": MemorySection.PROCEDURAL,
    "custom:good_pass": MemorySection.PROCEDURAL,
}

# Reverse map: memory_type (agent-facing name) → section
# Uses the keys from tools/memory.py _TYPE_MAP
MEMORY_TYPE_TO_SECTION: dict[str, MemorySection] = {
    "trade_entry": MemorySection.EPISODIC,
    "trade_close": MemorySection.EPISODIC,
    "trade_modify": MemorySection.EPISODIC,
    "trade": MemorySection.EPISODIC,
    "turn_summary": MemorySection.EPISODIC,
    "session_summary": MemorySection.EPISODIC,
    "episode": MemorySection.EPISODIC,      # maps to custom:market_event

    "signal": MemorySection.SIGNALS,
    "watchpoint": MemorySection.SIGNALS,

    "lesson": MemorySection.KNOWLEDGE,
    "thesis": MemorySection.KNOWLEDGE,
    "curiosity": MemorySection.KNOWLEDGE,

    "playbook": MemorySection.PROCEDURAL,
    "missed_opportunity": MemorySection.PROCEDURAL,
    "good_pass": MemorySection.PROCEDURAL,
}

DEFAULT_SECTION = MemorySection.KNOWLEDGE


def get_section_for_subtype(subtype: str | None) -> MemorySection:
    """Get the memory section for a node's subtype.

    Returns KNOWLEDGE as default for unknown subtypes.
    """
    if not subtype:
        return DEFAULT_SECTION
    return SUBTYPE_TO_SECTION.get(subtype, DEFAULT_SECTION)


def get_section_for_memory_type(memory_type: str) -> MemorySection:
    """Get the memory section for an agent-facing memory type name.

    Uses the same keys as _TYPE_MAP in tools/memory.py.
    Returns KNOWLEDGE as default for unknown types.
    """
    return MEMORY_TYPE_TO_SECTION.get(memory_type, DEFAULT_SECTION)


# ============================================================
# SECTION PROFILE DATACLASSES
# ============================================================

@dataclass(frozen=True)
class SectionDecayConfig:
    """Decay configuration per section."""
    initial_stability_days: float = 21.0
    growth_rate: float = 2.5
    active_threshold: float = 0.5
    weak_threshold: float = 0.1
    max_stability_days: float = 365.0


@dataclass(frozen=True)
class SectionEncodingConfig:
    """Encoding configuration per section."""
    base_difficulty: float = 0.3
    salience_enabled: bool = False
    max_salience_multiplier: float = 1.0


@dataclass(frozen=True)
class RerankingWeights:
    """6-signal reranking weight profile. Must sum to 1.0."""
    semantic: float = 0.30
    keyword: float = 0.15
    graph: float = 0.20
    recency: float = 0.15
    authority: float = 0.10
    affinity: float = 0.10

    def __post_init__(self):
        total = (self.semantic + self.keyword + self.graph +
                 self.recency + self.authority + self.affinity)
        if abs(total - 1.0) > 0.01:
            raise ValueError(
                f"Reranking weights must sum to 1.0, got {total:.3f}"
            )


@dataclass(frozen=True)
class SectionProfile:
    """Complete section profile — all parameters for one section."""
    name: str
    section: MemorySection
    reranking_weights: RerankingWeights
    decay: SectionDecayConfig
    encoding: SectionEncodingConfig
    consolidation_role: str = "none"   # 'source', 'target', 'both', 'none'
    intent_boost: float = 1.3          # Multiplier when section matches query intent


# ============================================================
# DEFAULT SECTION PROFILES
# ============================================================

# These mirror SECTION_PROFILES in nous-server/core/src/sections/index.ts.
# Values are placeholders — Issues 1, 2, 4, 6 finalize exact tuning.

SECTION_PROFILES: dict[MemorySection, SectionProfile] = {
    MemorySection.EPISODIC: SectionProfile(
        name="Episodic",
        section=MemorySection.EPISODIC,
        reranking_weights=RerankingWeights(
            semantic=0.20, keyword=0.15, graph=0.15,
            recency=0.30, authority=0.10, affinity=0.10,
        ),
        decay=SectionDecayConfig(
            initial_stability_days=14, growth_rate=2.0,
            active_threshold=0.5, weak_threshold=0.1,
            max_stability_days=180,
        ),
        encoding=SectionEncodingConfig(
            base_difficulty=0.3, salience_enabled=True,
            max_salience_multiplier=2.0,
        ),
        consolidation_role="source",
        intent_boost=1.3,
    ),

    MemorySection.SIGNALS: SectionProfile(
        name="Signals",
        section=MemorySection.SIGNALS,
        reranking_weights=RerankingWeights(
            semantic=0.15, keyword=0.10, graph=0.10,
            recency=0.45, authority=0.10, affinity=0.10,
        ),
        decay=SectionDecayConfig(
            initial_stability_days=2, growth_rate=1.5,
            active_threshold=0.5, weak_threshold=0.15,
            max_stability_days=30,
        ),
        encoding=SectionEncodingConfig(
            base_difficulty=0.2, salience_enabled=False,
            max_salience_multiplier=1.0,
        ),
        consolidation_role="source",
        intent_boost=1.3,
    ),

    MemorySection.KNOWLEDGE: SectionProfile(
        name="Knowledge",
        section=MemorySection.KNOWLEDGE,
        reranking_weights=RerankingWeights(
            semantic=0.35, keyword=0.15, graph=0.20,
            recency=0.05, authority=0.20, affinity=0.05,
        ),
        decay=SectionDecayConfig(
            initial_stability_days=60, growth_rate=3.0,
            active_threshold=0.4, weak_threshold=0.05,
            max_stability_days=365,
        ),
        encoding=SectionEncodingConfig(
            base_difficulty=0.4, salience_enabled=True,
            max_salience_multiplier=2.0,
        ),
        consolidation_role="target",
        intent_boost=1.3,
    ),

    MemorySection.PROCEDURAL: SectionProfile(
        name="Procedural",
        section=MemorySection.PROCEDURAL,
        reranking_weights=RerankingWeights(
            semantic=0.25, keyword=0.25, graph=0.20,
            recency=0.05, authority=0.15, affinity=0.10,
        ),
        decay=SectionDecayConfig(
            initial_stability_days=120, growth_rate=3.5,
            active_threshold=0.3, weak_threshold=0.03,
            max_stability_days=365,
        ),
        encoding=SectionEncodingConfig(
            base_difficulty=0.5, salience_enabled=True,
            max_salience_multiplier=3.0,
        ),
        consolidation_role="target",
        intent_boost=1.3,
    ),
}


def get_section_profile(section: MemorySection) -> SectionProfile:
    """Get the full profile for a section."""
    return SECTION_PROFILES[section]


def get_profile_for_subtype(subtype: str | None) -> SectionProfile:
    """Get the section profile for a specific node subtype."""
    section = get_section_for_subtype(subtype)
    return SECTION_PROFILES[section]


# ============================================================
# PER-SUBTYPE INITIAL STABILITY OVERRIDES
# ============================================================

# Per-subtype overrides for initial stability (in days).
# Takes priority over section defaults.
# Must match SUBTYPE_INITIAL_STABILITY in nous-server/core/src/sections/index.ts.
SUBTYPE_INITIAL_STABILITY: dict[str, float] = {
    # EPISODIC (section default: 14 days)
    "custom:trade_entry": 21,
    "custom:trade_close": 21,
    "custom:trade_modify": 14,
    "custom:trade": 14,
    "custom:turn_summary": 7,
    "custom:session_summary": 14,
    "custom:market_event": 10,

    # SIGNALS (section default: 2 days)
    "custom:signal": 2,
    "custom:watchpoint": 5,

    # KNOWLEDGE (section default: 60 days)
    "custom:lesson": 90,
    "custom:thesis": 30,
    "custom:curiosity": 14,

    # PROCEDURAL (section default: 120 days)
    "custom:playbook": 180,
    "custom:missed_opportunity": 30,
    "custom:good_pass": 30,
}


def get_initial_stability_for_subtype(subtype: str | None) -> float:
    """Get initial stability for a specific subtype (in days).

    Falls back to section default, then to 21 days (global fallback).
    """
    if subtype and subtype in SUBTYPE_INITIAL_STABILITY:
        return SUBTYPE_INITIAL_STABILITY[subtype]
    section = get_section_for_subtype(subtype)
    return SECTION_PROFILES[section].decay.initial_stability_days


# ============================================================
# SALIENCE CALCULATION (Issue 4: Stakes Weighting)
# ============================================================

def calculate_salience(subtype: str | None, signals: dict | None) -> float:
    """Calculate emotional/stakes salience for a memory.

    Returns a float from 0.1 (routine) to 1.0 (catastrophic/exceptional).
    Default is 0.5 (neutral — no stability modulation).

    Salience is derived from trade metadata in the signals dict:
    - For trade_close: PnL magnitude + loss amplification
    - For trade_entry: confidence + risk/reward ratio
    - For phantoms: phantom PnL magnitude
    - For other types or missing data: 0.5 (neutral)

    Only applies when the section's SectionEncodingConfig.salience_enabled is True.
    SIGNALS section (salience_enabled=False) always returns 0.5.
    """
    if not subtype or not signals:
        return 0.5

    section = get_section_for_subtype(subtype)
    profile = SECTION_PROFILES[section]
    if not profile.encoding.salience_enabled:
        return 0.5

    # ----- Trade close: PnL is the primary salience signal -----
    if subtype == "custom:trade_close":
        pnl_pct = signals.get("pnl_pct", 0)
        magnitude = min(1.0, abs(pnl_pct) / 10.0)  # 10% price move = max
        loss_boost = 0.15 if pnl_pct < 0 else 0.0   # Negativity bias
        return _clamp(0.3 + magnitude * 0.55 + loss_boost)

    # ----- Trade entry: confidence and R:R ratio -----
    if subtype == "custom:trade_entry":
        confidence = signals.get("confidence", 0.5)
        if confidence is None:
            confidence = 0.5
        rr_ratio = signals.get("rr_ratio", 0)
        if rr_ratio is None:
            rr_ratio = 0
        rr_score = min(1.0, rr_ratio / 3.0)  # 3:1 R:R = max
        return _clamp(0.3 + confidence * 0.5 + rr_score * 0.2)

    # ----- Trade modify: use PnL if available (position is at some unrealized PnL) -----
    if subtype == "custom:trade_modify":
        pnl_pct = signals.get("pnl_pct", 0)
        if pnl_pct:
            magnitude = min(1.0, abs(pnl_pct) / 10.0)
            return _clamp(0.3 + magnitude * 0.55)
        return 0.5

    # ----- Phantom outcomes: phantom PnL magnitude -----
    if subtype in ("custom:missed_opportunity", "custom:good_pass"):
        pnl_pct = signals.get("pnl_pct", 0)
        magnitude = min(1.0, abs(pnl_pct) / 10.0)
        return _clamp(0.3 + magnitude * 0.7)

    return 0.5


def modulate_stability(subtype: str | None, salience: float) -> float | None:
    """Apply salience to base stability, returning modulated stability in days.

    Returns None if salience is neutral (0.5) or section doesn't support salience,
    meaning the caller should use default stability (no override needed).

    The modulation formula:
    - salience >= 0.5: amplify. multiplier = 1.0 to max_salience_multiplier
    - salience < 0.5: reduce. multiplier = 0.2 to 1.0
    """
    if not subtype:
        return None

    section = get_section_for_subtype(subtype)
    profile = SECTION_PROFILES[section]

    if not profile.encoding.salience_enabled:
        return None

    # Neutral salience = no modulation needed
    if abs(salience - 0.5) < 0.01:
        return None

    base = get_initial_stability_for_subtype(subtype)
    max_mult = profile.encoding.max_salience_multiplier

    if salience >= 0.5:
        t = (salience - 0.5) / 0.5
        multiplier = 1.0 + t * (max_mult - 1.0)
    else:
        t = salience / 0.5
        multiplier = 0.2 + t * 0.8

    return round(base * multiplier, 2)


def _clamp(value: float, low: float = 0.1, high: float = 1.0) -> float:
    """Clamp a value to [low, high] range."""
    return max(low, min(high, value))


# ============================================================
# INTENT CLASSIFICATION (Issue 6: Section-Aware Retrieval Bias)
# ============================================================

# Keyword patterns that indicate query intent for each section.
# Patterns are checked case-insensitively against the query string.
# A query can match multiple sections (multi-intent).
_INTENT_PATTERNS: dict[MemorySection, list[str]] = {
    MemorySection.SIGNALS: [
        "signal", "signals", "firing", "active signal",
        "what's happening", "whats happening", "right now",
        "current", "live", "real-time", "realtime",
        "alert", "anomaly", "anomalies", "scanner",
        "watchpoint", "watchpoints", "watching",
    ],
    MemorySection.EPISODIC: [
        "my trade", "my position", "my trades", "my positions",
        "last time", "when did i", "when i", "trade history",
        "what happened", "my short", "my long",
        "entry", "exit", "closed", "opened",
        "pnl", "profit", "loss", "drawdown",
        "session", "conversation", "yesterday", "last week",
    ],
    MemorySection.KNOWLEDGE: [
        "lesson", "lessons", "learned", "learning",
        "principle", "principles", "what do i know",
        "thesis", "theses", "theory", "pattern",
        "insight", "insights", "wisdom", "rule",
        "why does", "why do", "how does", "how do",
        "understand", "explain",
    ],
    MemorySection.PROCEDURAL: [
        "playbook", "playbooks", "procedure", "process",
        "how do i trade", "my setup", "my process",
        "steps for", "strategy for", "approach for",
        "when i see", "my plan for", "template",
        "missed opportunity", "good pass",
    ],
}


def classify_intent(query: str) -> list[MemorySection]:
    """Classify a query's intent to determine which section(s) are most relevant.

    Returns a list of MemorySection values that the query is relevant to.
    Returns empty list if no clear intent is detected (no boost applied).

    The classification is keyword-pattern-based for speed (~0.1ms).
    Multi-intent is supported: a query can match multiple sections.

    Args:
        query: The search query text.

    Returns:
        List of MemorySection values matching the query intent.
        Empty list means no specific section intent detected.
    """
    if not query:
        return []

    query_lower = query.lower()
    matched: list[MemorySection] = []

    for section, patterns in _INTENT_PATTERNS.items():
        for pattern in patterns:
            if pattern in query_lower:
                matched.append(section)
                break  # One match per section is enough

    return matched
