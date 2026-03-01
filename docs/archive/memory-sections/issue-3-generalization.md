# Issue 3: Cross-Episode Generalization — Implementation Guide

> **STATUS:** DONE
>
> **Depends on:** Issue 0 (Section Foundation) — provides `SECTION_PROFILES` with `consolidation_role` defining which sections are sources (EPISODIC, SIGNALS) and targets (KNOWLEDGE, PROCEDURAL), plus `get_section_for_subtype()` for classification. Issue 2 (Per-Section Decay Curves) should be implemented first — it ensures episodic nodes decay faster than knowledge nodes, which is the lifecycle asymmetry that makes consolidation meaningful (episodes are fast-write/fast-decay staging; consolidated knowledge is slow-write/slow-decay permanent storage).
>
> **What this creates:** A background consolidation pipeline — the "hippocampal replay" system — that periodically reviews clusters of related episodic memories (trades, signals, summaries), uses an LLM to identify cross-episode patterns, and promotes those patterns into durable knowledge-tier nodes (lessons). Source episodes continue to decay naturally; the extracted knowledge persists. This runs as a daemon periodic task alongside the existing decay cycle, conflict checker, and embedding backfill. No agent wake is required — consolidation happens silently in the background.

---

## Problem Statement

The agent's memory system has **single-episode compression** (Haiku summarizes individual conversations into `turn_summary` nodes when the working window overflows) and **opportunistic lesson creation** (the agent can manually `store_memory` a lesson during a live conversation). But there is **no systematic background process** that reviews accumulated episodes and extracts cross-episode patterns.

This matters concretely:

**Pattern blindness across context windows.** The agent cannot simultaneously review 12 trade entries to notice "across my last 12 trades where funding exceeded 0.08%, 9 resulted in reversals within 4 hours." Each conversation recalls at most 4-5 memories. Patterns that span more episodes than fit in one context window are invisible.

**Opportunistic vs systematic.** The agent only creates lessons when it happens to notice something during a live conversation. A pattern like "I consistently exit too early when my thesis is playing out" requires reviewing 15+ trade outcomes — something the agent can't do in a single chat turn but a background process could.

**Ephemeral aggregate value.** Individual `turn_summary` nodes are mildly useful. But patterns across 50 turn summaries (e.g., "I underestimate volatility on weekends") are highly valuable and currently invisible to the system.

**The brain analogy:** During sleep, the hippocampus replays recent experiences. The brain identifies recurring patterns across episodes and consolidates those patterns into schema-level knowledge in the neocortex. Episodes are fast-write, fast-decay staging areas. Consolidated knowledge is slow-write, slow-decay permanent storage. The consolidation pipeline is the bridge between them.

**What this guide implements:**
1. A `ConsolidationEngine` class that reviews episode clusters and extracts patterns via LLM
2. A daemon periodic task (`_run_consolidation()`) that triggers the engine on a configurable interval
3. Knowledge node creation with `generalizes` edges linking back to source episodes
4. Dedup checking via `check_similar()` to avoid creating duplicate lessons
5. Edge strengthening for existing knowledge nodes that match new episode clusters
6. Configuration and system prompt updates

---

## Required Reading

Read these files **in order** before implementing. The "Focus Areas" column tells you exactly which parts matter.

### Foundation & Theory (read first)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 1 | `revisions/memory-sections/executive-summary.md` | **START HERE.** "Issue 3: No Cross-Episode Generalization Pipeline" (lines 198-234) defines the problem, the brain analogy, and what the pipeline should do. Also "How the Six Issues Interconnect" (lines 359-402) — consolidation moves knowledge BETWEEN sections. | Lines 198-234 (Issue 3), lines 359-402 (interconnections), lines 406-424 (Proposed Section Model — `consolidation_role`) |
| 2 | `revisions/memory-sections/issue-0-section-foundation.md` | Foundation guide. Defines `SectionProfile.consolidation_role` — EPISODIC and SIGNALS are `"source"`, KNOWLEDGE and PROCEDURAL are `"target"`. Also `SUBTYPE_INITIAL_STABILITY` values — the lifecycle asymmetry that makes consolidation meaningful (signals: 2d, trade_entry: 21d, lesson: 90d, playbook: 180d). | Lines 236-240 (`consolidation_role` in SectionProfile), lines 280-281 (EPISODIC consolidation_role="source"), lines 307-308 (SIGNALS consolidation_role="source"), lines 334-335 (KNOWLEDGE consolidation_role="target"), lines 361-362 (PROCEDURAL consolidation_role="target"), lines 426-449 (SUBTYPE_INITIAL_STABILITY) |
| 3 | `revisions/memory-sections/issue-4-stakes-weighting.md` | Issue 4 adds salience-modulated stability to new nodes. Consolidation can optionally use stakes weighting when creating knowledge nodes — a lesson extracted from high-salience trade closes should encode more strongly. | Skim Steps 4.1 and 4.5 — the `calculate_salience()` and `_store_memory_impl()` integration pattern |

### Python Patterns — Daemon Periodic Tasks (critical for understanding HOW to add a new periodic task)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 4 | `src/hynous/intelligence/daemon.py` | **PRIMARY INTEGRATION TARGET.** The daemon's `_loop()` (lines 511-654) shows the exact pattern for adding a new periodic task: timer check → spawn background thread if not running → thread calls the handler. Study `_run_decay_cycle()` (lines 2368-2404) as the closest analogy — it calls a Nous client method in a background thread, logs stats, and handles errors. Also study `__init__()` (lines 184-269) for the timer tracker and thread reference you need to add. | Lines 184-269 (`__init__` — timer trackers, thread refs), lines 511-654 (`_loop` — periodic task scheduling), lines 596-608 (decay cycle scheduling — **exact pattern to copy**), lines 2368-2404 (`_run_decay_cycle` — the handler pattern), lines 2847-2906 (`_check_curiosity` — another periodic pattern for reference) |
| 5 | `src/hynous/core/config.py` | **MODIFICATION TARGET.** `DaemonConfig` dataclass (lines 94-118) defines all daemon interval settings. You will add `consolidation_interval` here. Study the existing pattern: each interval has a default value, a comment, and is loaded from YAML in `load_config()` (lines 262-279). | Lines 94-118 (DaemonConfig), lines 262-279 (daemon YAML loading) |
| 6 | `config/default.yaml` | **MODIFICATION TARGET.** The daemon config section (lines 34-49). You will add `consolidation_interval` here. | Lines 34-49 (daemon YAML block) |

### Python Patterns — LLM Calls & Cost Tracking (critical for the Haiku analysis call)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 7 | `src/hynous/intelligence/memory_manager.py` | **PATTERN REFERENCE.** The `_compress_one()` method (lines 322-365) shows the exact pattern for calling Haiku in a background thread: `litellm.completion()` → `litellm.completion_cost()` → `record_llm_usage()`. Also `_COMPRESSION_SYSTEM` (lines 37-58) — the system prompt format for instructing Haiku to do specific analysis work. The consolidation engine's LLM prompt follows this same pattern. | Lines 37-58 (`_COMPRESSION_SYSTEM` — Haiku prompt pattern), lines 322-365 (`_compress_one` — litellm call + cost tracking), lines 660-676 (`_record_compression_usage` — cost tracking helper) |
| 8 | `src/hynous/core/costs.py` | Reference for `record_llm_usage()` function signature (lines 124-146). Called after each LLM completion to track costs. | Lines 124-146 (`record_llm_usage` signature) |

### Nous Client — Node Operations (critical for episode fetching, knowledge creation, edge linking)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 9 | `src/hynous/nous/client.py` | **API REFERENCE.** You will use multiple methods: `list_nodes()` (lines 98-121) to fetch recent episodes, `create_node()` (lines 61-88) to create knowledge nodes, `create_edge()` (lines 137-158) to link knowledge to source episodes, `strengthen_edge()` (lines 171-184) to reinforce existing edges, `check_similar()` (lines 385-412) for dedup before creating knowledge, `get_edges()` (lines 160-169) to check existing edges. | Lines 61-88 (`create_node()`), lines 98-121 (`list_nodes()` — filters: subtype, lifecycle, limit, created_after), lines 137-158 (`create_edge()`), lines 160-169 (`get_edges()`), lines 171-184 (`strengthen_edge()`), lines 385-412 (`check_similar()`) |
| 10 | `src/hynous/nous/sections.py` | **REFERENCE.** The `SECTION_PROFILES` dict (lines 172-251) defines `consolidation_role` per section. EPISODIC="source", SIGNALS="source", KNOWLEDGE="target", PROCEDURAL="target". The consolidation engine uses this to determine which subtypes are eligible sources. Also `get_section_for_subtype()` (lines 93-100). | Lines 172-251 (SECTION_PROFILES — consolidation_role values), lines 42-65 (SUBTYPE_TO_SECTION) |

### System Prompt (update for agent awareness)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 11 | `src/hynous/intelligence/prompts/builder.py` | **MODIFICATION TARGET.** The `TOOL_STRATEGY` constant (lines 146-177) includes "How My Memory Works" section (lines 173-177). You will add a sentence about consolidation so the agent knows its memory system extracts patterns in the background. | Lines 173-177 ("How My Memory Works" section) |

### Existing Daemon Infrastructure (understand the log/event pattern)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 12 | `src/hynous/core/daemon_log.py` | The `DaemonEvent` dataclass and `log_event()` function used by all daemon periodic tasks to log structured events. Consolidation will log events using the same pattern. | Skim for `DaemonEvent` class, `log_event()` signature |

---

## Architecture Decisions

### Decision 1: Consolidation runs as a daemon background thread, not an agent wake (FINAL)

The consolidation pipeline runs entirely in a background thread — same pattern as `_run_decay_cycle()` and `_run_embedding_backfill()`. It does NOT wake the agent. Rationale:

- **Cost efficiency.** Waking the agent costs ~10-15K tokens (Sonnet). Consolidation analysis with Haiku costs ~500-800 tokens per group. Running 5 groups per cycle = ~4K tokens total vs ~75K if we woke the agent 5 times.
- **No interactivity needed.** The agent doesn't need to approve or refine extracted patterns. The LLM analyzes episodes, creates knowledge nodes, and the agent discovers them naturally through future retrieval.
- **Non-blocking.** Background thread cannot interfere with user chat or SL/TP trigger checks.

**Where:** `daemon.py` — new `_consolidation_thread` reference in `__init__`, new scheduling block in `_loop()` step 10, new `_run_consolidation()` handler.

### Decision 2: Episodes are grouped by extracted trading symbol (FINAL)

The engine parses a trading symbol from each episode's title and body, then groups episodes by symbol. This is a simple, deterministic heuristic that works for the agent's actual memory content (trade entries/closes always mention the symbol).

**Why not clusters?** The existing Nous cluster system is manual (agent-created). Many episodes aren't assigned to clusters. Symbol extraction catches the vast majority of trade-related episodes without requiring cluster membership.

**Fallback:** Episodes with no extractable symbol are grouped under a `"_general"` key. If this group reaches the minimum size threshold, it's analyzed for non-symbol-specific patterns (e.g., behavioral patterns, timing patterns).

**Where:** `consolidation.py` — `_group_episodes()` method with `_extract_symbol()` helper.

### Decision 3: Haiku analyzes each group with a consolidation-specific prompt (FINAL)

Each qualifying group (≥ `min_group_size` episodes) is formatted as a batch and sent to Haiku with a system prompt designed for cross-episode pattern extraction. The prompt instructs Haiku to:

1. Look for recurring conditions, outcomes, and behaviors across the episodes
2. Output either `NO_PATTERN` (nothing worth extracting) or a structured pattern with `TITLE:` and body
3. Include statistical backing where possible ("X out of Y trades showed...")
4. Write in first person as the agent's own knowledge (matching the compression prompt style)

**Cost control:** Max `max_groups_per_cycle` groups analyzed per cycle (default 5). At ~800 tokens per group, this caps consolidation at ~4K tokens per cycle ≈ $0.004 per 24h cycle with Haiku.

**Where:** `consolidation.py` — `_CONSOLIDATION_SYSTEM` prompt constant, `_build_analysis_prompt()`, `_analyze_group()`.

### Decision 4: Dedup via check_similar() before creating knowledge nodes (FINAL)

Before creating a new lesson, the engine calls `check_similar()` to check if a similar lesson already exists. This reuses the existing dedup infrastructure from MF-0. Three outcomes:

- **No match:** Create new lesson node + `generalizes` edges to source episodes.
- **Duplicate (≥0.95 cosine):** Skip creation. Strengthen existing edges between the matched lesson and the new source episodes.
- **Connect (0.90-0.95 cosine):** Create new lesson (the pattern is distinct enough) but also create a `relates_to` edge to the similar existing lesson.

**Where:** `consolidation.py` — inside `_analyze_group()`, after LLM output is parsed and before `create_node()`.

### Decision 5: New knowledge nodes use `generalizes` edge type to link to source episodes (FINAL)

The `generalizes` edge type (SSA weight 0.70 — already defined in `nous-server/core/src/params/index.ts` line 115) semantically represents "this knowledge was generalized from these episodes." This is distinct from `relates_to` (0.50) and `causes` (0.80).

Direction: `lesson_node → generalizes → source_episode`. This means SSA spreading activation flows FROM the lesson TO the source episodes, which is the desired behavior — recalling the lesson brings the underlying evidence into view.

**Where:** `consolidation.py` — `_link_to_sources()` method.

### Decision 6: Configuration is minimal — one YAML-tunable interval, rest are module constants (FINAL)

Only `consolidation_interval` goes in `DaemonConfig` / `default.yaml` (following the pattern of `decay_interval`, `conflict_check_interval`, etc.). Implementation-specific parameters (lookback days, min group size, max groups per cycle, LLM model) are constants in the `consolidation.py` module. They can be promoted to config later if tuning is needed.

**Rationale:** The daemon config already has 11 interval/threshold settings. Adding 5 more for consolidation would bloat the YAML without clear benefit. Module constants are easier to discover (one file) and change (one import, no YAML parsing).

**Where:** `config.py` — add `consolidation_interval` to `DaemonConfig`. `consolidation.py` — module-level constants for everything else.

---

## Implementation Steps

### Step 3.1: Create the consolidation engine module

**New file:** `src/hynous/intelligence/consolidation.py`

This is the core of the cross-episode generalization pipeline. It runs in a background thread, fetches recent episodes, groups them, calls Haiku for pattern extraction, and creates knowledge nodes.

```python
"""
Consolidation Engine — Cross-Episode Generalization (Issue 3)

The 'hippocampal replay' pipeline. Runs periodically in a daemon background
thread, reviews clusters of episodic memories, and extracts cross-episode
patterns into durable knowledge-tier nodes.

Pipeline:
  1. Fetch recent EPISODIC source nodes (trades, summaries, signals)
  2. Group by extracted trading symbol
  3. For qualifying groups (≥ min_group_size): call Haiku for pattern extraction
  4. Dedup check via check_similar() — skip if duplicate exists
  5. Create knowledge node (custom:lesson) + generalizes edges to source episodes
  6. Strengthen existing knowledge edges when duplicate is found

Design: Issue 3 of memory-sections revision
See: revisions/memory-sections/executive-summary.md (lines 198-234)
"""

import json
import logging
import re
import time
from datetime import datetime, timezone, timedelta

import litellm

from ..core.config import Config
from ..core.costs import record_llm_usage

logger = logging.getLogger(__name__)

# ============================================================
# MODULE CONSTANTS (not in YAML — see Decision 6)
# ============================================================

# How far back to look for source episodes
_LOOKBACK_DAYS = 14

# Minimum episodes in a group before we analyze it.
# Below this, there isn't enough data for meaningful cross-episode patterns.
_MIN_GROUP_SIZE = 3

# Maximum groups to analyze per consolidation cycle.
# Cost control: each group = 1 Haiku call (~800 tokens).
_MAX_GROUPS_PER_CYCLE = 5

# Maximum source episodes to include in a single analysis prompt.
# More than 15 makes the prompt too long for reliable Haiku extraction.
_MAX_EPISODES_PER_PROMPT = 15

# LLM model for consolidation analysis — uses the compression model
# (Haiku) to keep costs low. Each call is ~500-800 tokens output.
_MAX_ANALYSIS_TOKENS = 800

# Source subtypes eligible for consolidation.
# These are the EPISODIC and SIGNALS section subtypes with
# consolidation_role="source" in SECTION_PROFILES.
_SOURCE_SUBTYPES = [
    "custom:trade_entry",
    "custom:trade_close",
    "custom:trade_modify",
    "custom:turn_summary",
    "custom:signal",
]

# Known trading symbols to look for in episode content.
# Ordered by importance — checked first in title, then body.
_KNOWN_SYMBOLS = [
    "BTC", "ETH", "SOL", "DOGE", "ARB", "OP", "AVAX",
    "MATIC", "LINK", "UNI", "AAVE", "APT", "SUI", "SEI",
    "WIF", "PEPE", "BONK", "JUP", "TIA", "INJ",
]
_SYMBOL_PATTERN = re.compile(
    r"\b(" + "|".join(_KNOWN_SYMBOLS) + r")\b",
    re.IGNORECASE,
)

# ============================================================
# CONSOLIDATION PROMPT
# ============================================================

_CONSOLIDATION_SYSTEM = (
    "You are analyzing a batch of trading episodes for the agent Hynous. "
    "Your job is to find CROSS-EPISODE PATTERNS — recurring conditions, "
    "behaviors, or outcomes that appear across multiple episodes.\n\n"
    "You are NOT summarizing individual episodes. You are looking for:\n"
    "- Recurring market conditions that led to similar outcomes\n"
    "- Behavioral patterns (consistent mistakes or successes)\n"
    "- Statistical regularities (e.g., 'X out of Y trades with condition Z were profitable')\n"
    "- Timing patterns (e.g., 'losses cluster around specific market conditions')\n\n"
    "Write as if YOU are the agent recalling a pattern — use first person "
    "(I, my, me). Include specific numbers from the episodes.\n\n"
    "Output format:\n"
    "- If you find a meaningful pattern: start with 'TITLE: <max 60 chars>' "
    "on the first line, then a blank line, then the pattern body (100-250 words).\n"
    "- If the episodes are too diverse or there's no clear pattern: "
    "respond with just 'NO_PATTERN'.\n\n"
    "A pattern must be ACTIONABLE — something the agent can use to make "
    "better decisions. 'I traded ETH several times' is not a pattern. "
    "'When ETH funding exceeds 0.08%, my shorts have been profitable 4/5 times "
    "with an average R:R of 2.3:1' IS a pattern."
)


# ============================================================
# CONSOLIDATION ENGINE
# ============================================================

class ConsolidationEngine:
    """Cross-episode generalization — extracts durable knowledge from episodic clusters.

    Usage (from daemon background thread):
        engine = ConsolidationEngine(config)
        stats = engine.run_cycle()
        # stats = {"episodes_reviewed": 45, "groups_analyzed": 3, ...}
    """

    def __init__(self, config: Config):
        self.config = config
        # Use same compression model as memory_manager (Haiku)
        self._model = config.memory.compression_model

    def run_cycle(self) -> dict:
        """Run one full consolidation cycle.

        Returns a stats dict with:
            episodes_reviewed: Total source episodes fetched
            groups_found: Distinct symbol groups identified
            groups_analyzed: Groups that met min_group_size and were sent to LLM
            patterns_created: New lesson nodes created
            patterns_strengthened: Existing lessons found and edges strengthened
            errors: Number of per-group errors (non-fatal)
        """
        stats = {
            "episodes_reviewed": 0,
            "groups_found": 0,
            "groups_analyzed": 0,
            "patterns_created": 0,
            "patterns_strengthened": 0,
            "errors": 0,
        }

        try:
            from ..nous.client import get_client
            nous = get_client()

            # Step 1: Fetch recent episodic nodes
            episodes = self._fetch_recent_episodes(nous)
            stats["episodes_reviewed"] = len(episodes)

            if len(episodes) < _MIN_GROUP_SIZE:
                logger.debug(
                    "Consolidation: only %d episodes (need %d) — skipping",
                    len(episodes), _MIN_GROUP_SIZE,
                )
                return stats

            # Step 2: Group by extracted symbol
            groups = self._group_episodes(episodes)
            stats["groups_found"] = len(groups)

            # Step 3: Analyze qualifying groups
            analyzed = 0
            for group_key, group_nodes in sorted(
                groups.items(),
                key=lambda kv: len(kv[1]),
                reverse=True,  # Largest groups first (most likely to have patterns)
            ):
                if len(group_nodes) < _MIN_GROUP_SIZE:
                    continue
                if analyzed >= _MAX_GROUPS_PER_CYCLE:
                    break

                try:
                    result = self._analyze_group(nous, group_key, group_nodes)
                    analyzed += 1
                    stats["groups_analyzed"] = analyzed
                    if result == "created":
                        stats["patterns_created"] += 1
                    elif result == "strengthened":
                        stats["patterns_strengthened"] += 1
                except Exception as e:
                    logger.warning(
                        "Consolidation failed for group '%s': %s", group_key, e
                    )
                    stats["errors"] += 1

        except Exception as e:
            logger.error("Consolidation cycle failed: %s", e)
            stats["errors"] += 1

        return stats

    # ----------------------------------------------------------------
    # Step 1: Fetch recent episodes
    # ----------------------------------------------------------------

    def _fetch_recent_episodes(self, nous) -> list[dict]:
        """Fetch recent ACTIVE source-section nodes for consolidation.

        Queries each source subtype separately because list_nodes()
        only accepts a single subtype filter. Merges results.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=_LOOKBACK_DAYS)
        created_after = cutoff.isoformat()

        all_episodes: list[dict] = []
        for subtype in _SOURCE_SUBTYPES:
            try:
                nodes = nous.list_nodes(
                    subtype=subtype,
                    lifecycle="ACTIVE",
                    limit=50,
                    created_after=created_after,
                )
                all_episodes.extend(nodes)
            except Exception as e:
                logger.debug("Failed to fetch %s nodes: %s", subtype, e)

        return all_episodes

    # ----------------------------------------------------------------
    # Step 2: Group episodes by symbol
    # ----------------------------------------------------------------

    def _group_episodes(self, episodes: list[dict]) -> dict[str, list[dict]]:
        """Group episodes by extracted trading symbol.

        Episodes with no extractable symbol go into '_general'.
        """
        groups: dict[str, list[dict]] = {}

        for ep in episodes:
            symbol = _extract_symbol(ep)
            key = symbol if symbol else "_general"
            groups.setdefault(key, []).append(ep)

        return groups

    # ----------------------------------------------------------------
    # Step 3: Analyze a group for patterns
    # ----------------------------------------------------------------

    def _analyze_group(
        self, nous, group_key: str, episodes: list[dict]
    ) -> str | None:
        """Analyze a group of episodes for cross-episode patterns.

        Returns:
            "created" — new lesson node created
            "strengthened" — existing similar lesson found, edges strengthened
            None — no pattern found or LLM returned NO_PATTERN
        """
        # Cap episodes per prompt to keep it manageable for Haiku
        analysis_episodes = episodes[:_MAX_EPISODES_PER_PROMPT]

        # Build analysis prompt
        prompt = _build_analysis_prompt(group_key, analysis_episodes)

        # Call Haiku for pattern extraction
        try:
            response = litellm.completion(
                model=self._model,
                max_tokens=_MAX_ANALYSIS_TOKENS,
                messages=[
                    {"role": "system", "content": _CONSOLIDATION_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
            )

            # Track cost
            _record_consolidation_cost(response, model=self._model)

        except Exception as e:
            logger.warning("Consolidation LLM call failed for '%s': %s", group_key, e)
            return None

        text = response.choices[0].message.content.strip()

        # Check if Haiku found a pattern
        if text.upper().startswith("NO_PATTERN"):
            logger.debug("Consolidation: no pattern found for '%s'", group_key)
            return None

        # Parse the pattern output
        title, body = _parse_pattern_output(text)
        if not title or not body:
            logger.debug(
                "Consolidation: could not parse LLM output for '%s'", group_key
            )
            return None

        # Dedup check: does a similar lesson already exist?
        try:
            similar = nous.check_similar(
                content=body,
                title=title,
                subtype="custom:lesson",
            )
            matches = similar.get("matches", [])
            if matches:
                top = matches[0]
                action = top.get("action", "")
                existing_id = top.get("id")

                if action == "duplicate" and existing_id:
                    # Near-identical lesson exists — strengthen its edges instead
                    self._strengthen_source_edges(
                        nous, existing_id, analysis_episodes
                    )
                    logger.info(
                        "Consolidation: strengthened existing lesson '%s' "
                        "with %d new source episodes",
                        existing_id, len(analysis_episodes),
                    )
                    return "strengthened"

                if action == "connect" and existing_id:
                    # Similar but distinct — create new lesson AND link to existing
                    node_id = self._create_knowledge_node(
                        nous, title, body, analysis_episodes
                    )
                    if node_id:
                        try:
                            nous.create_edge(
                                source_id=node_id,
                                target_id=existing_id,
                                type="relates_to",
                            )
                        except Exception:
                            pass
                        return "created"
                    return None

        except Exception as e:
            logger.debug("Consolidation dedup check failed: %s", e)
            # Continue with creation anyway — duplicate is better than nothing

        # No duplicate found — create new lesson
        node_id = self._create_knowledge_node(
            nous, title, body, analysis_episodes
        )
        return "created" if node_id else None

    # ----------------------------------------------------------------
    # Helpers: Node creation and edge linking
    # ----------------------------------------------------------------

    def _create_knowledge_node(
        self, nous, title: str, body: str, source_episodes: list[dict]
    ) -> str | None:
        """Create a lesson node and link it to source episodes.

        Returns the new node ID, or None on failure.
        """
        try:
            node = nous.create_node(
                type="concept",
                subtype="custom:lesson",
                title=title,
                body=body,
                summary=body[:300] if len(body) > 300 else None,
                event_source="consolidation",
            )
            node_id = node.get("id")
            if not node_id:
                return None

            # Link to source episodes with 'generalizes' edges
            self._link_to_sources(nous, node_id, source_episodes)

            logger.info(
                "Consolidation: created lesson '%s' (%s) from %d episodes",
                title[:50], node_id, len(source_episodes),
            )
            return node_id

        except Exception as e:
            logger.error("Consolidation: failed to create knowledge node: %s", e)
            return None

    def _link_to_sources(
        self, nous, knowledge_id: str, source_episodes: list[dict]
    ) -> None:
        """Create 'generalizes' edges from the knowledge node to source episodes.

        Direction: knowledge_node → generalizes → source_episode
        This means SSA spreading from the lesson reaches the underlying evidence.
        """
        linked = 0
        for ep in source_episodes:
            ep_id = ep.get("id")
            if not ep_id:
                continue
            try:
                nous.create_edge(
                    source_id=knowledge_id,
                    target_id=ep_id,
                    type="generalizes",
                )
                linked += 1
            except Exception:
                # Edge creation can fail if node was deleted between fetch and link
                continue

        if linked:
            logger.debug(
                "Consolidation: linked %s to %d source episodes", knowledge_id, linked
            )

    def _strengthen_source_edges(
        self, nous, existing_lesson_id: str, new_episodes: list[dict]
    ) -> None:
        """Strengthen edges between an existing lesson and new related episodes.

        When we find that a new batch of episodes matches an existing lesson,
        we create 'generalizes' edges to the new episodes (expanding the
        evidence base) and strengthen any existing edges by 0.05 (Hebbian).
        """
        # Get existing edges to see which episodes are already linked
        try:
            existing_edges = nous.get_edges(existing_lesson_id, direction="out")
            existing_targets = {
                e.get("target_id") for e in existing_edges if e.get("target_id")
            }
        except Exception:
            existing_targets = set()

        for ep in new_episodes:
            ep_id = ep.get("id")
            if not ep_id:
                continue

            if ep_id in existing_targets:
                # Already linked — find and strengthen the edge
                for edge in existing_edges:
                    if edge.get("target_id") == ep_id:
                        try:
                            nous.strengthen_edge(edge["id"], amount=0.05)
                        except Exception:
                            pass
                        break
            else:
                # New episode — create edge
                try:
                    nous.create_edge(
                        source_id=existing_lesson_id,
                        target_id=ep_id,
                        type="generalizes",
                    )
                except Exception:
                    continue


# ============================================================
# PURE FUNCTIONS (no state, easy to test)
# ============================================================


def _extract_symbol(node: dict) -> str | None:
    """Extract a trading symbol from a node's title, body, or signals.

    Priority:
      1. signals.symbol field (most reliable — set by trading tools)
      2. Regex match in title (fast, catches "BTC short at $68K")
      3. Regex match in body text (fallback)

    Returns uppercase symbol string or None.
    """
    title = node.get("content_title", "")
    body = node.get("content_body", "")

    # Try to parse JSON body for signals.symbol
    if body.startswith("{"):
        try:
            parsed = json.loads(body)
            signals = parsed.get("signals", {})
            symbol = signals.get("symbol") or signals.get("coin")
            if symbol and isinstance(symbol, str):
                return symbol.upper()
            # Use text from JSON body for regex fallback
            body = parsed.get("text", "")
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass

    # Regex search in title first (most specific)
    match = _SYMBOL_PATTERN.search(title)
    if match:
        return match.group(1).upper()

    # Regex search in body
    match = _SYMBOL_PATTERN.search(body)
    if match:
        return match.group(1).upper()

    return None


def _build_analysis_prompt(group_key: str, episodes: list[dict]) -> str:
    """Build the user prompt for Haiku pattern extraction.

    Formats each episode as a compact summary with key data points.
    """
    lines = [
        f"## {len(episodes)} episodes for {group_key}",
        "",
        "Analyze these episodes for recurring patterns. "
        "Each episode is a memory from my trading activity.",
        "",
    ]

    for i, ep in enumerate(episodes, 1):
        title = ep.get("content_title", "Untitled")
        subtype = ep.get("subtype", "")
        if subtype.startswith("custom:"):
            subtype = subtype[7:]
        date = ep.get("provenance_created_at", "")[:16]  # YYYY-MM-DDTHH:MM

        # Get body text
        body = ep.get("content_body", "") or ""
        if body.startswith("{"):
            try:
                parsed = json.loads(body)
                body = parsed.get("text", body)
            except (json.JSONDecodeError, TypeError):
                pass

        # Truncate long bodies
        if len(body) > 500:
            body = body[:497] + "..."

        lines.append(f"**Episode {i}** [{subtype}] ({date}): {title}")
        if body:
            lines.append(f"  {body}")
        lines.append("")

    return "\n".join(lines)


def _parse_pattern_output(text: str) -> tuple[str | None, str | None]:
    """Parse the LLM's pattern output into (title, body).

    Expected format:
        TITLE: Some pattern title here
        <blank line>
        Pattern body text...

    Returns (None, None) if parsing fails.
    """
    if not text or text.upper().startswith("NO_PATTERN"):
        return None, None

    # Handle TITLE: prefix
    if text.startswith("TITLE:"):
        parts = text.split("\n", 2)
        title = parts[0].replace("TITLE:", "").strip()[:60]
        body = "\n".join(parts[1:]).strip() if len(parts) > 1 else ""
        if title and body:
            return title, body

    # Fallback: use first line as title, rest as body
    lines = text.strip().split("\n", 1)
    if len(lines) >= 2:
        title = lines[0].strip()[:60]
        body = lines[1].strip()
        if title and body:
            return title, body

    # Can't parse — treat entire text as body with generated title
    if len(text) > 30:
        return text[:57] + "...", text

    return None, None


def _record_consolidation_cost(response, model: str = "") -> None:
    """Record consolidation LLM call cost. Same pattern as memory_manager."""
    try:
        usage = response.usage
        if usage:
            try:
                cost = litellm.completion_cost(completion_response=response)
            except Exception:
                cost = 0.0
            record_llm_usage(
                model=model,
                input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                output_tokens=getattr(usage, "completion_tokens", 0) or 0,
                cost_usd=cost,
            )
    except Exception:
        pass
```

**Why:** This is a self-contained module following established patterns: `litellm.completion()` for LLM calls (from `memory_manager.py`), `record_llm_usage()` for cost tracking (from `costs.py`), `NousClient` methods for all Nous operations. The engine is stateless — instantiated fresh each cycle from config, so no stale state accumulates.

---

### Step 3.2: Add `consolidation_interval` to DaemonConfig

**File:** `src/hynous/core/config.py`

**Find this** (lines 108-109, inside `DaemonConfig`):
```python
    # Embedding backfill
    embedding_backfill_interval: int = 43200  # Seconds between embedding backfill runs (12 hours)
```

**Insert after** (before the risk guardrails comment):
```python
    # Consolidation (cross-episode generalization — Issue 3)
    consolidation_interval: int = 86400  # Seconds between consolidation cycles (24 hours)
```

**Then**, in the `load_config()` function, find the daemon YAML loading block.

**Find this** (line 272, inside the `DaemonConfig(...)` constructor):
```python
            embedding_backfill_interval=daemon_raw.get("embedding_backfill_interval", 43200),
```

**Insert after** (on a new line, before the closing paren):
```python
            consolidation_interval=daemon_raw.get("consolidation_interval", 86400),
```

**Why:** Follows the exact pattern of every other daemon interval: dataclass field with default + comment, YAML loading with same default fallback.

---

### Step 3.3: Add `consolidation_interval` to default.yaml

**File:** `config/default.yaml`

**Find this** (lines 44-45):
```yaml
  health_check_interval: 3600        # Nous health check interval (seconds, 1 hour)
  embedding_backfill_interval: 43200 # Embedding backfill interval (seconds, 12 hours)
```

**Insert after** (on a new line, before the risk guardrail settings):
```yaml
  consolidation_interval: 86400      # Cross-episode generalization (seconds, 24 hours)
```

**Why:** Makes the consolidation interval visible and tunable from YAML without code changes.

---

### Step 3.4: Wire consolidation into the daemon loop

**File:** `src/hynous/intelligence/daemon.py`

This step adds the consolidation periodic task following the exact pattern of `_run_decay_cycle()`.

**3.4a: Add timer tracker and thread reference to `__init__`**

**Find this** (lines 196-197, inside `__init__`):
```python
        self._decay_thread: threading.Thread | None = None
        self._conflict_thread: threading.Thread | None = None
        self._backfill_thread: threading.Thread | None = None
```

**Replace with:**
```python
        self._decay_thread: threading.Thread | None = None
        self._conflict_thread: threading.Thread | None = None
        self._backfill_thread: threading.Thread | None = None
        self._consolidation_thread: threading.Thread | None = None
```

**Find this** (lines 217-218, the timing trackers):
```python
        self._last_embedding_backfill: float = 0
```

**Insert after:**
```python
        self._last_consolidation: float = 0
```

**3.4b: Initialize timer in `_loop()` startup section**

**Find this** (line 527, inside `_loop()` startup):
```python
        self._last_embedding_backfill = time.time()
```

**Insert after:**
```python
        self._last_consolidation = time.time()
```

**3.4c: Add consolidation scheduling to `_loop()` main loop**

**Find this** (lines 635-647, the embedding backfill block — this is step 9 in the loop):
```python
                # 9. Embedding backfill (default every 12 hours)
                # Runs in a background thread — OpenAI calls per-node, slow at scale.
                if now - self._last_embedding_backfill >= self.config.daemon.embedding_backfill_interval:
                    self._last_embedding_backfill = now
                    if self._backfill_thread is None or not self._backfill_thread.is_alive():
                        self._backfill_thread = threading.Thread(
                            target=self._run_embedding_backfill,
                            daemon=True,
                            name="hynous-backfill",
                        )
                        self._backfill_thread.start()
                    else:
                        logger.debug("Embedding backfill still running — skipping interval")
```

**Insert after** (before the `except Exception` block on line 649):
```python

                # 10. Consolidation — cross-episode generalization (default every 24 hours)
                # Runs in a background thread — includes LLM calls (Haiku),
                # cannot block _fast_trigger_check().
                if now - self._last_consolidation >= self.config.daemon.consolidation_interval:
                    self._last_consolidation = now
                    if self._consolidation_thread is None or not self._consolidation_thread.is_alive():
                        self._consolidation_thread = threading.Thread(
                            target=self._run_consolidation,
                            daemon=True,
                            name="hynous-consolidation",
                        )
                        self._consolidation_thread.start()
                    else:
                        logger.debug("Consolidation still running — skipping interval")
```

**3.4d: Add the `_run_consolidation()` handler method**

This goes in the daemon class, near the existing `_run_decay_cycle()` method. Find a good insertion point after the decay/fading methods.

**Find this** (the line after `_wake_for_fading_memories` method ends — approximately line 2520, after the last line of that method):
```python
        if count > 5:
            lines.append(f"... and {count - 5} more. Use recall_memory(mode=\"browse\") to see all WEAK nodes.")
            lines.append("")

        lines.extend([
            "Options per memory:",
            "- Recall and reflect on it (natural reinforcement — FSRS stability grows on access)",
```

Actually, to keep the insertion clean, find the section header that follows the decay/fading section. The exact location depends on your file, but the handler should go after the fading memories methods and before the next section header.

**Insert the following method into the `Daemon` class** (after `_wake_for_fading_memories` and its related code, before the next section of the class). The exact position is not critical — it just needs to be a method of the `Daemon` class:

```python
    def _run_consolidation(self):
        """Run cross-episode generalization cycle.

        Reviews clusters of episodic memories and extracts cross-episode
        patterns into knowledge-tier nodes. Uses Haiku for analysis.
        Runs in a background thread (hynous-consolidation).

        See: revisions/memory-sections/issue-3-generalization.md
        """
        try:
            from .consolidation import ConsolidationEngine

            engine = ConsolidationEngine(self.config)
            stats = engine.run_cycle()

            reviewed = stats.get("episodes_reviewed", 0)
            analyzed = stats.get("groups_analyzed", 0)
            created = stats.get("patterns_created", 0)
            strengthened = stats.get("patterns_strengthened", 0)
            errors = stats.get("errors", 0)

            if created > 0 or strengthened > 0:
                log_event(DaemonEvent(
                    "consolidation",
                    "Cross-episode generalization",
                    f"{reviewed} episodes → {analyzed} groups → "
                    f"{created} new patterns, {strengthened} strengthened",
                ))
                logger.info(
                    "Consolidation: %d episodes, %d groups, "
                    "%d patterns created, %d strengthened",
                    reviewed, analyzed, created, strengthened,
                )
            else:
                logger.debug(
                    "Consolidation: %d episodes, %d groups — no new patterns",
                    reviewed, analyzed,
                )

            if errors > 0:
                logger.warning("Consolidation: %d error(s) during cycle", errors)

        except Exception as e:
            logger.warning("Consolidation cycle failed: %s", e)
```

**Why:** This follows the exact pattern of `_run_decay_cycle()` (lines 2368-2404): try/except wrapper, calls the engine, logs stats with `log_event(DaemonEvent(...))`, handles errors gracefully. The lazy import of `ConsolidationEngine` avoids import-time side effects and keeps the daemon module's import graph clean.

---

### Step 3.5: Update system prompt to mention consolidation

**File:** `src/hynous/intelligence/prompts/builder.py`

**Find this** (lines 175-177, inside `TOOL_STRATEGY`):
```python
Decay is two-way: the daemon runs FSRS every 6 hours and tells me when important memories (lessons, theses, playbooks) are fading. I review them, reinforce what still holds, and archive what doesn't. The spaced repetition only works if I close the loop."""
```

**Replace with:**
```python
Decay is two-way: the daemon runs FSRS every 6 hours and tells me when important memories (lessons, theses, playbooks) are fading. I review them, reinforce what still holds, and archive what doesn't. The spaced repetition only works if I close the loop.

My memory also consolidates automatically. In the background, my daemon reviews clusters of recent trades and episodes, identifies recurring patterns across them, and promotes those patterns into durable lessons. I don't need to manually extract every insight — the system surfaces cross-episode knowledge that I wouldn't notice in a single conversation. When I recall a lesson I didn't explicitly create, it came from this consolidation process — I can trust it and trace its source episodes."""
```

**Why:** The agent needs to know that lessons may appear in its memory that it didn't explicitly create. Without this awareness, it might be confused by unfamiliar lessons during retrieval. The prompt also explains the trust model — consolidation-generated lessons have traceable source episodes.

---

### Step 3.6: Verify the `generalizes` edge type exists in Nous

Before implementing, confirm that the `generalizes` edge type is recognized by the Nous server. Check the SSA edge weights configuration.

**File to check (read-only):** `nous-server/core/src/params/index.ts`

Look for the `SSA_EDGE_WEIGHTS` constant. It should contain an entry for `generalizes`. If it does NOT exist, you need to add it:

**If `generalizes` is missing from `SSA_EDGE_WEIGHTS`**, find the edge weights object and add:

```typescript
  generalizes: 0.70,    // Knowledge generalized from episodes (consolidation)
```

**If `generalizes` already exists** (it should — it's a standard edge type), no change needed. Just verify the weight is reasonable (0.60-0.80 range).

**Why:** The `generalizes` edge type must have an SSA weight so spreading activation flows correctly from consolidated lessons to their source episodes. A weight of 0.70 is between `relates_to` (0.50) and `causes` (0.80) — strong enough to surface evidence but not as strong as causal relationships.

---

## Testing

### Unit Tests (Python — Consolidation Engine)

**New file:** `tests/unit/test_consolidation.py`

```python
"""Unit tests for the consolidation engine (Issue 3)."""

import json
import pytest
from unittest.mock import MagicMock, patch

from hynous.intelligence.consolidation import (
    ConsolidationEngine,
    _extract_symbol,
    _build_analysis_prompt,
    _parse_pattern_output,
    _SOURCE_SUBTYPES,
    _MIN_GROUP_SIZE,
    _MAX_GROUPS_PER_CYCLE,
)


# ---- Symbol extraction ----

class TestExtractSymbol:
    def test_symbol_in_title(self):
        node = {"content_title": "BTC short at $68K", "content_body": ""}
        assert _extract_symbol(node) == "BTC"

    def test_symbol_in_body(self):
        node = {"content_title": "Market event", "content_body": "ETH funding spike"}
        assert _extract_symbol(node) == "ETH"

    def test_symbol_from_json_signals(self):
        body = json.dumps({"text": "Trade closed", "signals": {"symbol": "SOL"}})
        node = {"content_title": "Trade close", "content_body": body}
        assert _extract_symbol(node) == "SOL"

    def test_symbol_from_json_coin_field(self):
        body = json.dumps({"text": "Entry", "signals": {"coin": "eth"}})
        node = {"content_title": "Trade", "content_body": body}
        assert _extract_symbol(node) == "ETH"

    def test_no_symbol_returns_none(self):
        node = {"content_title": "General market thoughts", "content_body": "Nothing specific"}
        assert _extract_symbol(node) is None

    def test_title_takes_priority_over_body(self):
        node = {"content_title": "BTC analysis", "content_body": "ETH is also interesting"}
        assert _extract_symbol(node) == "BTC"

    def test_case_insensitive(self):
        node = {"content_title": "btc short squeeze", "content_body": ""}
        assert _extract_symbol(node) == "BTC"

    def test_symbol_boundary_match(self):
        """Should not match 'ABTC' or 'BTCX'."""
        node = {"content_title": "ABTCX token analysis", "content_body": ""}
        assert _extract_symbol(node) is None

    def test_empty_node(self):
        assert _extract_symbol({}) is None
        assert _extract_symbol({"content_title": "", "content_body": ""}) is None

    def test_malformed_json_body(self):
        node = {"content_title": "BTC trade", "content_body": "{invalid json"}
        assert _extract_symbol(node) == "BTC"


# ---- Prompt building ----

class TestBuildAnalysisPrompt:
    def test_includes_group_key_and_count(self):
        episodes = [
            {"content_title": "Trade 1", "subtype": "custom:trade_close",
             "content_body": "Closed BTC short", "provenance_created_at": "2026-02-15T10:00:00Z"},
        ]
        prompt = _build_analysis_prompt("BTC", episodes)
        assert "1 episodes for BTC" in prompt
        assert "Trade 1" in prompt

    def test_truncates_long_bodies(self):
        long_body = "x" * 600
        episodes = [
            {"content_title": "T", "subtype": "custom:trade_entry",
             "content_body": long_body, "provenance_created_at": "2026-02-15T10:00:00Z"},
        ]
        prompt = _build_analysis_prompt("ETH", episodes)
        assert "..." in prompt
        assert len(prompt) < len(long_body) + 500

    def test_parses_json_body(self):
        body = json.dumps({"text": "Closed short at profit", "signals": {"pnl_pct": 5.0}})
        episodes = [
            {"content_title": "ETH close", "subtype": "custom:trade_close",
             "content_body": body, "provenance_created_at": "2026-02-15T10:00:00Z"},
        ]
        prompt = _build_analysis_prompt("ETH", episodes)
        assert "Closed short at profit" in prompt

    def test_strips_custom_prefix_from_subtype(self):
        episodes = [
            {"content_title": "T", "subtype": "custom:trade_entry",
             "content_body": "", "provenance_created_at": "2026-02-15T10:00:00Z"},
        ]
        prompt = _build_analysis_prompt("BTC", episodes)
        assert "[trade_entry]" in prompt
        assert "custom:" not in prompt


# ---- Pattern output parsing ----

class TestParsePatternOutput:
    def test_valid_title_and_body(self):
        text = "TITLE: Funding squeeze pattern on ETH\n\nWhen ETH funding exceeds 0.08%..."
        title, body = _parse_pattern_output(text)
        assert title == "Funding squeeze pattern on ETH"
        assert body.startswith("When ETH funding")

    def test_no_pattern(self):
        title, body = _parse_pattern_output("NO_PATTERN")
        assert title is None
        assert body is None

    def test_no_pattern_case_insensitive(self):
        title, body = _parse_pattern_output("no_pattern - episodes are too diverse")
        assert title is None
        assert body is None

    def test_title_truncated_to_60_chars(self):
        long_title = "TITLE: " + "A" * 80 + "\n\nBody text here."
        title, body = _parse_pattern_output(long_title)
        assert title is not None
        assert len(title) <= 60

    def test_fallback_first_line_as_title(self):
        text = "Short funding squeezes are reliable\nI've noticed that when..."
        title, body = _parse_pattern_output(text)
        assert title is not None
        assert body is not None

    def test_empty_string(self):
        assert _parse_pattern_output("") == (None, None)

    def test_none(self):
        assert _parse_pattern_output(None) == (None, None)

    def test_long_text_without_title(self):
        text = "A" * 100
        title, body = _parse_pattern_output(text)
        assert title is not None
        assert body == text


# ---- ConsolidationEngine grouping ----

class TestConsolidationGrouping:
    def _make_engine(self):
        config = MagicMock()
        config.memory.compression_model = "test-model"
        return ConsolidationEngine(config)

    def test_groups_by_symbol(self):
        engine = self._make_engine()
        episodes = [
            {"content_title": "BTC short", "content_body": ""},
            {"content_title": "BTC long", "content_body": ""},
            {"content_title": "ETH entry", "content_body": ""},
        ]
        groups = engine._group_episodes(episodes)
        assert "BTC" in groups
        assert len(groups["BTC"]) == 2
        assert "ETH" in groups
        assert len(groups["ETH"]) == 1

    def test_no_symbol_goes_to_general(self):
        engine = self._make_engine()
        episodes = [
            {"content_title": "General thoughts", "content_body": "Just thinking"},
        ]
        groups = engine._group_episodes(episodes)
        assert "_general" in groups


# ---- Source subtypes ----

class TestSourceSubtypes:
    def test_source_subtypes_are_from_source_sections(self):
        """All source subtypes should belong to sections with consolidation_role='source'."""
        from hynous.nous.sections import SECTION_PROFILES, get_section_for_subtype
        for subtype in _SOURCE_SUBTYPES:
            section = get_section_for_subtype(subtype)
            profile = SECTION_PROFILES[section]
            assert profile.consolidation_role == "source", (
                f"{subtype} is in section {section.value} with "
                f"consolidation_role={profile.consolidation_role}, expected 'source'"
            )


# ---- Constants ----

class TestConstants:
    def test_min_group_size_positive(self):
        assert _MIN_GROUP_SIZE >= 2

    def test_max_groups_positive(self):
        assert _MAX_GROUPS_PER_CYCLE >= 1
```

**Run with:**
```bash
cd /path/to/project
PYTHONPATH=src python -m pytest tests/unit/test_consolidation.py -v
```

**Expected:** All tests pass. ~30 test cases covering symbol extraction, prompt building, output parsing, grouping, and constant validation.

### Integration Tests (Live Local)

These tests require the Nous server running locally with the full stack.

**Prerequisites:**
```bash
# Terminal 1: Start Nous server
cd nous-server/core && npx tsup
cd ../server && pnpm dev
# Should show: "Nous server running on port 3100"
```

**Test 1: Seed episodes and run consolidation**
```bash
# Seed 5 trade_close episodes for BTC with similar pattern
for i in 1 2 3 4 5; do
  curl -s -X POST http://localhost:3100/v1/nodes \
    -H "Content-Type: application/json" \
    -d "{
      \"type\": \"concept\",
      \"subtype\": \"custom:trade_close\",
      \"content_title\": \"BTC short close #$i — funding squeeze\",
      \"content_body\": \"{\\\"text\\\": \\\"Closed BTC short at +${i}.5% profit. Funding was 0.09% when I entered, price reversed within 3 hours. R:R 2.${i}:1. Thesis was correct — shorts were overleveraged.\\\", \\\"signals\\\": {\\\"symbol\\\": \\\"BTC\\\", \\\"pnl_pct\\\": ${i}.5}}\"
    }" | jq '.id'
  sleep 1
done
echo "Seeded 5 BTC episodes"
```

**Test 2: Run consolidation engine directly**
```bash
PYTHONPATH=src python -c "
from hynous.core.config import load_config
from hynous.intelligence.consolidation import ConsolidationEngine

config = load_config()
engine = ConsolidationEngine(config)
stats = engine.run_cycle()
print('Consolidation stats:', stats)
"
```

**Expected output:**
```
Consolidation stats: {'episodes_reviewed': 5, 'groups_found': 1, 'groups_analyzed': 1, 'patterns_created': 1, 'patterns_strengthened': 0, 'errors': 0}
```

**Test 3: Verify the created lesson node exists**
```bash
curl -s 'http://localhost:3100/v1/nodes?subtype=custom:lesson&limit=5' | \
  jq '.data[] | select(.temporal_event_source == "consolidation") | {id, content_title, subtype}'
```

**Expected:** At least one lesson node with `temporal_event_source: "consolidation"` and a title related to the BTC funding squeeze pattern.

**Test 4: Verify generalizes edges exist**
```bash
# Get the consolidation lesson ID from Test 3, then:
LESSON_ID="<paste lesson id here>"
curl -s "http://localhost:3100/v1/edges?node_id=$LESSON_ID&direction=out" | \
  jq '.data[] | {target_id, type}'
```

**Expected:** 5 edges with `type: "generalizes"` pointing to the 5 seeded trade_close nodes.

**Test 5: Run consolidation again — should strengthen, not duplicate**
```bash
# Seed 2 more BTC episodes
for i in 6 7; do
  curl -s -X POST http://localhost:3100/v1/nodes \
    -H "Content-Type: application/json" \
    -d "{
      \"type\": \"concept\",
      \"subtype\": \"custom:trade_close\",
      \"content_title\": \"BTC short close #$i — funding squeeze\",
      \"content_body\": \"{\\\"text\\\": \\\"Closed BTC short at +${i}.0% profit. Same funding squeeze pattern.\\\", \\\"signals\\\": {\\\"symbol\\\": \\\"BTC\\\", \\\"pnl_pct\\\": ${i}.0}}\"
    }" | jq '.id'
  sleep 1
done

# Run consolidation again
PYTHONPATH=src python -c "
from hynous.core.config import load_config
from hynous.intelligence.consolidation import ConsolidationEngine

config = load_config()
engine = ConsolidationEngine(config)
stats = engine.run_cycle()
print('Second run stats:', stats)
"
```

**Expected:** `patterns_strengthened: 1` (not `patterns_created: 1`) because the dedup check finds the existing similar lesson from Test 2.

### Live Dynamic Tests (VPS)

After deploying updated code to VPS:

**Test 6: Verify consolidation runs in daemon**

Enable the daemon and wait for one consolidation cycle (or temporarily lower `consolidation_interval` to 300 for testing):

```bash
# Check daemon log for consolidation events
journalctl -u hynous --since "1 hour ago" | grep -i consolidation
```

**Expected:** Log lines like:
```
Consolidation: 32 episodes, 3 groups, 1 patterns created, 0 strengthened
```

**Test 7: Verify consolidation-created lessons appear in agent retrieval**

In the chat interface, ask:
> "What patterns have you noticed in your recent trades?"

**Expected:** The agent should recall consolidation-generated lessons alongside manually created ones. Consolidation lessons are indistinguishable from manual ones at retrieval time (same subtype, same scoring) — the difference is they were created automatically.

---

## Verification Checklist

| # | Check | How to Verify |
|---|-------|---------------|
| 1 | `consolidation.py` module imports cleanly | `PYTHONPATH=src python -c "from hynous.intelligence.consolidation import ConsolidationEngine"` |
| 2 | `ConsolidationEngine.run_cycle()` returns stats dict | Run Test 2 above — verify all expected keys present |
| 3 | Symbol extraction works for JSON bodies | `_extract_symbol({"content_title": "", "content_body": '{"signals": {"symbol": "BTC"}}'})` returns `"BTC"` |
| 4 | Symbol extraction returns None for no symbol | `_extract_symbol({"content_title": "thoughts", "content_body": ""})` returns `None` |
| 5 | `_parse_pattern_output("NO_PATTERN")` returns `(None, None)` | Unit test covers this |
| 6 | `DaemonConfig.consolidation_interval` exists | `PYTHONPATH=src python -c "from hynous.core.config import load_config; print(load_config().daemon.consolidation_interval)"` → `86400` |
| 7 | `default.yaml` has `consolidation_interval` | `grep consolidation_interval config/default.yaml` → present |
| 8 | Daemon loop has step 10 (consolidation) | Read `daemon.py` `_loop()` method — verify consolidation block exists after step 9 |
| 9 | `_run_consolidation()` handler exists in Daemon class | Read `daemon.py` — verify method exists |
| 10 | Background thread pattern matches decay cycle | Both use `if self._<x>_thread is None or not self._<x>_thread.is_alive()` pattern |
| 11 | Consolidation creates lesson nodes with `event_source="consolidation"` | Run Test 3 — filter by event_source |
| 12 | `generalizes` edges link lesson to source episodes | Run Test 4 — verify edge count and type |
| 13 | Dedup check prevents duplicate lessons | Run Test 5 — second run should strengthen, not create |
| 14 | LLM costs are tracked | After running consolidation, check `storage/costs.json` for Haiku usage |
| 15 | System prompt mentions consolidation | Read `builder.py` TOOL_STRATEGY — verify "consolidates automatically" text |
| 16 | Unit tests pass | `PYTHONPATH=src python -m pytest tests/unit/test_consolidation.py -v` — all green |
| 17 | Existing tests still pass | `PYTHONPATH=src python -m pytest tests/ -v` — no regressions |
| 18 | `generalizes` edge type has SSA weight | Check `nous-server/core/src/params/index.ts` `SSA_EDGE_WEIGHTS` contains `generalizes` |

---

## File Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/hynous/intelligence/consolidation.py` | **NEW** | ConsolidationEngine class + pure helper functions (~320 lines) |
| `src/hynous/core/config.py` | Modified | Add `consolidation_interval` to `DaemonConfig` (+2 lines) |
| `config/default.yaml` | Modified | Add `consolidation_interval` setting (+1 line) |
| `src/hynous/intelligence/daemon.py` | Modified | Add `_consolidation_thread`, timer, loop step 10, `_run_consolidation()` handler (~35 lines) |
| `src/hynous/intelligence/prompts/builder.py` | Modified | Add consolidation mention to "How My Memory Works" section (+3 lines) |
| `tests/unit/test_consolidation.py` | **NEW** | Unit tests for symbol extraction, prompt building, output parsing, grouping (~180 lines) |

**Total new code:** ~320 lines (consolidation engine) + ~180 lines (tests) = ~500 lines
**Total modified:** ~40 lines across 4 existing files
**Schema changes:** None
**API changes:** None (consolidation uses existing Nous API endpoints)
**LLM cost per cycle:** ~4K tokens Haiku ≈ $0.004 per 24h cycle (analyzing 5 groups)
**New edge type needed:** Verify `generalizes` exists in `SSA_EDGE_WEIGHTS` (likely already present)

---

## What Comes Next

After this guide, the system automatically extracts cross-episode patterns into durable knowledge. The next guide builds directly on this:

- **Issue 5 (Procedural Memory)** extends the consolidation pipeline. When the consolidation engine identifies a pattern with enough statistical backing (e.g., "9/12 trades following this setup were profitable"), it can create a `custom:playbook` node instead of a `custom:lesson`. The playbook has structured trigger conditions, making it eligible for the playbook matcher's pattern-matching retrieval. Consolidation creates the knowledge; procedural memory makes it actionable.
