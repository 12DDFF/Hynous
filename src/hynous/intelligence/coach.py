"""
Coach — Haiku-powered inner critic for daemon wakes.

Reviews Hynous's daemon wake responses and pushes him to go deeper.
Identifies gaps in memory, actions, and behavioral patterns, then
generates 2-4 targeted directives for follow-up.

Runs ONLY on daemon wakes (not user chat or Discord).
Cost per evaluation: ~$0.0005 (Haiku, ~1.8K in + 150 out).
"""

import logging
from dataclasses import dataclass

import anthropic

from ..core.costs import record_claude_usage

logger = logging.getLogger(__name__)


COACH_SYSTEM_PROMPT = """\
You are Hynous's internal coach. You review his daemon wake responses and push him to go deeper.

You see: his live state, his memory state, what was auto-recalled, and what tools he used WITH their results.

YOUR JOB — identify gaps and demand action:

MEMORY GAPS:
- Trade entries without linked thesis → "Your HYPE trade has no thesis stored. What's your conviction? Store it."
- Empty watchlist → "Zero watchpoints. What levels matter? Set them before you sleep."
- Low thesis count → "Only 1 active thesis. What's your market read? Develop more views."
- Pending curiosity never explored → "You logged curiosity about X 3 days ago. Research it or archive it."
- Stale observations → "You said 'interesting' but didn't store or act on it."

BEHAVIORAL GAPS:
- No tools called → "You observed but didn't investigate. Use your tools."
- Vague language without specifics → "What exactly do you mean by 'keeping an eye on it'?"
- Loss/lesson not stored → "You mentioned a mistake but didn't store a lesson. Document it."
- Recalled memory not referenced → "You were shown a lesson about X but didn't consider it."
- Positions without stops → "Your position has no SL/TP. Set protection."
- Tool returned useful data but agent ignored it → "Funding was -0.03% but you didn't comment on it."

RULES:
- 2-4 numbered directives. Each ends with a concrete action verb.
- Under 150 words. No praise, no filler.
- If Hynous genuinely covered everything: respond with only "ALL_CLEAR"
- Reference specific data (names, prices, memory titles) — never be generic.
- Use the tool results to judge depth — don't ask for data the agent already has."""


@dataclass
class CoachResult:
    """Result of a coach evaluation."""
    needs_action: bool
    message: str       # Directive message to send to Hynous (empty if ALL_CLEAR)
    depth: int         # Suggested follow-up rounds (0=done, 1-2=more rounds)


class Coach:
    """Haiku-powered inner critic for daemon wake quality."""

    def __init__(self, anthropic_client: anthropic.Anthropic):
        self.client = anthropic_client

    def evaluate(
        self,
        snapshot: str,
        response: str,
        tool_calls: list[dict],
        active_context: str | None,
        nous_client,
    ) -> CoachResult:
        """Evaluate Hynous's response. Returns directives or ALL_CLEAR.

        Args:
            snapshot: Live state text that was injected.
            response: Hynous's text response to the wake.
            tool_calls: List of dicts with 'name', 'input', 'result' keys.
            active_context: Nous context that was auto-recalled (or None).
            nous_client: NousClient for querying memory state.

        Returns:
            CoachResult with directives or ALL_CLEAR.
        """
        try:
            memory_state = self._build_memory_state(nous_client)
            user_msg = self._build_prompt(
                snapshot, response, tool_calls, active_context, memory_state,
            )

            result = self.client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=300,
                system=COACH_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )

            # Record Haiku usage for cost tracking
            try:
                usage = result.usage
                if usage:
                    record_claude_usage(
                        input_tokens=usage.input_tokens,
                        output_tokens=usage.output_tokens,
                        cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
                        cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
                        model="haiku",
                    )
            except Exception:
                pass

            text = result.content[0].text.strip()

            if "ALL_CLEAR" in text:
                logger.info("Coach: ALL_CLEAR — no follow-up needed")
                return CoachResult(needs_action=False, message="", depth=0)

            # Count directives to determine depth
            directive_count = len([
                line for line in text.splitlines()
                if line.strip()[:1] in ("1", "2", "3", "4")
            ])
            depth = 2 if directive_count >= 3 else 1

            logger.info("Coach: %d directives, depth=%d", directive_count, depth)
            return CoachResult(
                needs_action=True,
                message=f"[Internal Review — address these before you go back to sleep]\n{text}",
                depth=depth,
            )

        except Exception as e:
            logger.error("Coach evaluation failed: %s", e)
            return CoachResult(needs_action=False, message="", depth=0)

    def _build_memory_state(self, nous_client) -> str:
        """Query Nous for active memory counts and titles.

        Returns compact text block (~300 tokens) with:
          - Active watchpoints (titles)
          - Active theses (titles)
          - Active trade entries (titles + thesis gap flags via symbol matching)
          - Pending curiosity items (titles + age)
          - Recent lessons

        Uses symbol extraction instead of edge traversal to detect thesis gaps.
        """
        if nous_client is None:
            return "Memory state unavailable (Nous not connected)"

        sections = []
        theses = []  # Cached for thesis gap detection in trade entries

        # Watchpoints
        try:
            watchpoints = nous_client.list_nodes(
                subtype="custom:watchpoint", lifecycle="ACTIVE", limit=10,
            )
            if watchpoints:
                lines = [f"Watchpoints ({len(watchpoints)} active):"]
                for wp in watchpoints:
                    lines.append(f"  - {wp.get('content_title', 'Untitled')}")
                sections.append("\n".join(lines))
            else:
                sections.append("Watchpoints: 0 active")
        except Exception:
            pass

        # Theses — cached for cross-reference with trade entries
        try:
            theses = nous_client.list_nodes(
                subtype="custom:thesis", lifecycle="ACTIVE", limit=10,
            )
            if theses:
                lines = [f"Theses ({len(theses)} active):"]
                for t in theses:
                    lines.append(f"  - {t.get('content_title', 'Untitled')}")
                sections.append("\n".join(lines))
            else:
                sections.append("Theses: 0 active")
        except Exception:
            pass

        # Trade entries — check thesis links by SYMBOL MATCH (not edge traversal)
        try:
            entries = nous_client.list_nodes(
                subtype="custom:trade_entry", lifecycle="ACTIVE", limit=10,
            )
            if entries:
                # Build set of symbols covered by active theses
                thesis_symbols = set()
                for t in theses:
                    title = (t.get("content_title") or "").upper()
                    sym = _extract_symbol_from_thesis(title)
                    if sym:
                        thesis_symbols.add(sym)

                lines = [f"Trade Entries ({len(entries)} active):"]
                for entry in entries:
                    title = entry.get("content_title", "Untitled")
                    symbol = _extract_symbol(title)
                    has_thesis = symbol in thesis_symbols if symbol else True
                    flag = "" if has_thesis else " (!! no thesis linked)"
                    lines.append(f"  - {title}{flag}")
                sections.append("\n".join(lines))
        except Exception:
            pass

        # Curiosity items
        try:
            curiosity = nous_client.list_nodes(
                subtype="custom:curiosity", lifecycle="ACTIVE", limit=10,
            )
            if curiosity:
                lines = [f"Curiosity ({len(curiosity)} pending):"]
                for c in curiosity:
                    title = c.get("content_title", "Untitled")
                    created = c.get("created_at", "")
                    age_str = _format_age(created) if created else ""
                    lines.append(f"  - {title}{f' ({age_str})' if age_str else ''}")
                sections.append("\n".join(lines))
        except Exception:
            pass

        # Recent lessons
        try:
            lessons = nous_client.search(
                query="lesson",
                subtype="custom:lesson",
                limit=5,
            )
            if lessons:
                lines = ["Recent Lessons:"]
                for l in lessons:
                    title = l.get("content_title", "Untitled")
                    lines.append(f"  - {title}")
                sections.append("\n".join(lines))
        except Exception:
            pass

        return "\n\n".join(sections) if sections else "No memory data available"

    def _build_prompt(
        self,
        snapshot: str,
        response: str,
        tool_calls: list[dict],
        active_context: str | None,
        memory_state: str,
    ) -> str:
        """Assemble the evaluation prompt for Haiku."""
        # Format tool calls with results (not just names)
        if tool_calls:
            tool_lines = []
            for tc in tool_calls:
                inp = tc.get("input", {})
                # Compact input representation
                inp_str = ", ".join(f"{k}={v!r}" for k, v in inp.items()) if inp else ""
                tool_lines.append(f"- {tc['name']}({inp_str}):")
                result = tc.get("result", "")
                if result:
                    # Truncate result for coach prompt
                    if len(result) > 300:
                        result = result[:300] + "..."
                    tool_lines.append(f"  → {result}")
            tools_str = "\n".join(tool_lines)
        else:
            tools_str = "None — took no action"

        context_str = active_context or "None — no relevant memories found"

        return (
            f"## Current State\n{snapshot}\n\n"
            f"## What Memory Was Recalled For Hynous\n{context_str}\n\n"
            f"## Full Memory State\n{memory_state}\n\n"
            f"## Tools Hynous Used (with results)\n{tools_str}\n\n"
            f"## Hynous's Response\n{response}"
        )


def _extract_symbol(title: str) -> str | None:
    """Extract trading symbol from trade entry title like 'LONG HYPE @ $30'."""
    parts = title.upper().split()
    if len(parts) >= 2 and parts[0] in ("LONG", "SHORT"):
        return parts[1]
    return None


def _extract_symbol_from_thesis(title: str) -> str | None:
    """Extract a symbol from a thesis title. Checks common crypto symbols."""
    title_upper = title.upper()
    # Common symbols to check — covers most traded assets
    for sym in ("BTC", "ETH", "SOL", "HYPE", "DOGE", "ARB", "OP", "SUI",
                "AVAX", "LINK", "MATIC", "XRP", "ADA", "DOT", "NEAR",
                "APT", "FTM", "ATOM", "UNI", "AAVE"):
        if sym in title_upper:
            return sym
    return None


def _format_age(iso_timestamp: str) -> str:
    """Format an ISO timestamp as a human-readable age (e.g. '3d ago')."""
    from datetime import datetime, timezone

    try:
        created = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta = now - created
        days = delta.days
        if days == 0:
            hours = delta.seconds // 3600
            return f"{hours}h ago" if hours > 0 else "just now"
        return f"{days}d ago"
    except Exception:
        return ""
