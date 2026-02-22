"""
Consolidation Engine — Cross-Episode Generalization (Issue 3)

The 'hippocampal replay' pipeline. Runs periodically in a daemon background
thread, reviews clusters of episodic memories, and extracts cross-episode
patterns into durable knowledge-tier nodes.

Pipeline:
  1. Fetch recent EPISODIC/SIGNALS source nodes (trades, summaries, signals)
  2. Group by extracted trading symbol
  3. For qualifying groups (>= min_group_size): call Haiku for pattern extraction
  4. Dedup check via check_similar() — skip if duplicate exists
  5. Create knowledge node (custom:lesson) + generalizes edges to source episodes
  6. Strengthen existing knowledge edges when duplicate is found

Design: Issue 3 of memory-sections revision
See: revisions/memory-sections/issue-3-generalization.md
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

# Max tokens for the Haiku analysis response
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
    "with an average R:R of 2.3:1' IS a pattern.\n\n"
    "PLAYBOOK PROMOTION: If the pattern has ALL of the following:\n"
    "  1. Win rate >= 70% across >= 8 trades\n"
    "  2. A clear, specific trigger condition (e.g. funding_extreme, oi_surge, "
    "price_spike, liquidation_cascade, oi_drop, cvd_divergence)\n"
    "  3. A specific directional bias (long or short)\n"
    "Then add a line immediately after TITLE (before the blank line):\n"
    "PLAYBOOK_TRIGGER: {\"anomaly_types\": [\"funding_extreme\"], "
    "\"min_severity\": 0.5, \"direction\": \"short\"}\n"
    "Only add this line when all three conditions are clearly met. "
    "If uncertain, omit it and output a standard TITLE pattern."
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

        # Issue 5: Extract PLAYBOOK_TRIGGER line if present (before parsing)
        playbook_trigger = _extract_playbook_trigger(text)
        if playbook_trigger:
            # Strip the PLAYBOOK_TRIGGER line before passing to _parse_pattern_output
            text = re.sub(r"^PLAYBOOK_TRIGGER:.*$\n?", "", text, flags=re.MULTILINE)

        # Parse the pattern output
        title, body = _parse_pattern_output(text)
        if not title or not body:
            logger.debug(
                "Consolidation: could not parse LLM output for '%s'", group_key
            )
            return None

        # Dedup check: does a similar lesson/playbook already exist?
        check_subtype = "custom:playbook" if playbook_trigger else "custom:lesson"
        try:
            similar = nous.check_similar(
                content=body,
                title=title,
                subtype=check_subtype,
            )
            matches = similar.get("matches", [])
            if matches:
                top = matches[0]
                action = top.get("action", "")
                existing_id = top.get("id")

                if action == "duplicate" and existing_id:
                    # Near-identical node exists — strengthen its edges instead
                    self._strengthen_source_edges(
                        nous, existing_id, analysis_episodes
                    )
                    logger.info(
                        "Consolidation: strengthened existing %s '%s' "
                        "with %d new source episodes",
                        check_subtype, existing_id, len(analysis_episodes),
                    )
                    return "strengthened"

                if action == "connect" and existing_id:
                    # Similar but distinct — create new node AND link to existing
                    node_id = self._create_knowledge_node(
                        nous, title, body, analysis_episodes,
                        playbook_trigger=playbook_trigger,
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

        # No duplicate found — create new lesson (or playbook)
        node_id = self._create_knowledge_node(
            nous, title, body, analysis_episodes,
            playbook_trigger=playbook_trigger,
        )
        return "created" if node_id else None

    # ----------------------------------------------------------------
    # Helpers: Node creation and edge linking
    # ----------------------------------------------------------------

    def _create_knowledge_node(
        self,
        nous,
        title: str,
        body: str,
        source_episodes: list[dict],
        playbook_trigger: dict | None = None,
    ) -> str | None:
        """Create a lesson or playbook node and link it to source episodes.

        Args:
            playbook_trigger: If provided, creates a custom:playbook node with
                structured JSON body containing trigger conditions. Otherwise
                creates a custom:lesson node.

        Returns the new node ID, or None on failure.
        """
        try:
            if playbook_trigger:
                subtype = "custom:playbook"
                body_data = {
                    "text": body,
                    "trigger": playbook_trigger,
                    "action": playbook_trigger.pop("action", ""),
                    "direction": playbook_trigger.get("direction", "either"),
                    "success_count": 0,
                    "sample_size": 0,
                }
                node_body = json.dumps(body_data)
            else:
                subtype = "custom:lesson"
                node_body = body

            node = nous.create_node(
                type="concept",
                subtype=subtype,
                title=title,
                body=node_body,
                summary=body[:300] if len(body) > 300 else None,
                event_source="consolidation",
            )
            node_id = node.get("id")
            if not node_id:
                return None

            # Link to source episodes with 'generalizes' edges
            self._link_to_sources(nous, node_id, source_episodes)

            logger.info(
                "Consolidation: created %s '%s' (%s) from %d episodes",
                subtype, title[:50], node_id, len(source_episodes),
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


def _extract_playbook_trigger(text: str) -> dict | None:
    """Extract a PLAYBOOK_TRIGGER JSON line from consolidation output.

    The LLM may output:
        TITLE: BTC Funding Fade Short
        PLAYBOOK_TRIGGER: {"anomaly_types": ["funding_extreme"], ...}

        Pattern body...

    Returns the parsed trigger dict, or None if not found or malformed.
    """
    if not text:
        return None
    match = re.search(r"^PLAYBOOK_TRIGGER:\s*(.+)$", text, re.MULTILINE)
    if not match:
        return None
    try:
        trigger = json.loads(match.group(1).strip())
        if not isinstance(trigger, dict) or not trigger.get("anomaly_types"):
            return None
        return trigger
    except (json.JSONDecodeError, TypeError):
        return None


def _extract_symbol(node: dict) -> str | None:
    """Extract a trading symbol from a node's title, body, or signals.

    Priority:
      1. signals.symbol field (most reliable — set by trading tools)
      2. Regex match in title (fast, catches "BTC short at $68K")
      3. Regex match in body text (fallback)

    Returns uppercase symbol string or None.
    """
    title = node.get("content_title", "") or ""
    body = node.get("content_body", "") or ""

    # Try to parse JSON body for signals.symbol
    if body.startswith("{"):
        try:
            parsed = json.loads(body)
            signals = parsed.get("signals", {})
            symbol = signals.get("symbol") or signals.get("coin")
            if symbol and isinstance(symbol, str):
                return symbol.upper()
            # Use text from JSON body for regex fallback
            body = parsed.get("text", "") or ""
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
        title = ep.get("content_title", "Untitled") or "Untitled"
        subtype = ep.get("subtype", "") or ""
        if subtype.startswith("custom:"):
            subtype = subtype[7:]
        date = (ep.get("provenance_created_at", "") or "")[:16]  # YYYY-MM-DDTHH:MM

        # Get body text
        body = ep.get("content_body", "") or ""
        if body.startswith("{"):
            try:
                parsed = json.loads(body)
                body = parsed.get("text", body) or body
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
