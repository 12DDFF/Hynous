"""
Coach — Haiku-powered inner critic for daemon wakes.

Reviews Hynous's daemon wake responses and pushes him to go deeper.
Identifies gaps in memory, actions, and behavioral patterns, then
generates 2-4 targeted directives for follow-up.

Runs ONLY on daemon wakes (not user chat or Discord).

Data sources (all zero-cost — already in-process):
  - Memory mutations from MutationTracker (what was stored/linked/failed)
  - Wake history from DaemonLog (cross-wake patterns)
  - Pending directives from Daemon (accountability)
  - Staleness fingerprints from Daemon (repetition detection)
  - Tool calls with results from Agent (depth assessment)
  - Memory state from Nous (completeness check)

Cost per evaluation: ~$0.0006 (Haiku, ~2.0K in + 150 out).
"""

import logging
import re
from dataclasses import dataclass

import anthropic

from ..core.costs import record_claude_usage

logger = logging.getLogger(__name__)


COACH_SYSTEM_PROMPT = """\
You are Hynous's internal coach. You evaluate his daemon wake responses using ONLY the data below.

ROLE: You and Hynous are partners. You handle quality control — he handles execution.
Your job: find gaps between what should have happened and what actually happened, \
then give 2-4 specific directives to close those gaps.

IMPORTANT CONTEXT: Hynous already receives a [Live State] snapshot with current portfolio, \
positions (with SL/TP), prices, funding, and F&G before every wake. This is live data — \
he does NOT need to call get_account or get_market_data to see his own state. \
Zero tool calls during a quiet market review is perfectly fine if the snapshot was sufficient.

YOU HAVE ACCESS TO (numbered sections in the evaluation prompt):
1. Current State — portfolio, positions, market prices, circuit breaker
2. Memory Recalled — what Nous auto-returned for this wake
3. Full Memory State — all active watchpoints, thesis notes, trades, curiosity items with counts
4. Memory Mutations This Cycle — exactly what Hynous stored/linked/failed this wake
5. Tools Used + Results — every tool call with its truncated return data
6. Wake History — last 5 daemon events (for cross-wake pattern detection)
7. Unresolved Directives — your previous instructions that weren't fulfilled yet
8. Hynous's Response — his text output

EVALUATION FRAMEWORK — check each area in order, skip if data is absent:

A. DIRECTIVE ACCOUNTABILITY (Section 7)
   - If unresolved directives exist, they are your TOP priority.
   - Each unfulfilled directive = automatic re-issue with age.
   - 3+ wakes old = prefix with "OVERDUE:".
   - If a directive was fulfilled this cycle (check Section 4), do NOT re-issue.

B. GRAPH INTEGRITY (Sections 4 + 3)
   - Trade entries in Section 3 marked "(!! no thesis linked)" = directive to store/link thesis.
   - Failed mutations in Section 4 = directive to retry.
   - Use exact counts: "2/3 trade entries have no thesis (67% unlinked)."

C. ACTIONABLE DEPTH (Sections 5 + 8)
   - If a tool returned notable data (funding spike, F&G extreme, volume anomaly) that \
Hynous's response didn't address = cite the specific number and push to act on it.
   - If staleness warning is present, push for different tools or new actions.
   - Do NOT penalize zero tool calls if the snapshot was sufficient and nothing notable happened. \
Quiet markets don't need forced investigation.

D. MEMORY HYGIENE (Section 3)
   - 0 active watchpoints AND open positions exist in Section 1 = "Set price alerts."
   - 0 active thesis notes = "Develop and store a market thesis."
   - Stale curiosity items aged 3+ days = "Research or archive [title] ([N]d old)."
   - Recent losses without stored lessons = "Document what went wrong."
   - Thesis notes/watchpoints that Hynous says are invalidated but didn't archive = "Archive [title]."

E. POSITION MANAGEMENT (Section 1)
   - Positions visible in snapshot without SL/TP = "Set protection on [symbol]."
   - Circuit breaker active = "Focus on analysis. No new entries."

OUTPUT RULES:
- 2-4 numbered directives. Each MUST end with a concrete action verb \
(store, set, research, link, document, investigate, archive).
- Under 150 words total. No praise, no filler, no hedging, no greetings.
- Use exact numbers from the data: counts, percentages, prices, ages.
- If ALL areas are genuinely covered: respond with ONLY "ALL_CLEAR".
- ONLY reference data that appears in the numbered sections. \
Never assume, infer, or hallucinate data that isn't there.
- If tool results or the response show the agent already handled something, don't re-request it.
- Prefer ALL_CLEAR over inventing directives. Only issue directives for real gaps."""


@dataclass
class CoachResult:
    """Result of a coach evaluation."""
    needs_action: bool
    message: str       # Directive message to send to Hynous (empty if ALL_CLEAR)
    depth: int         # Suggested follow-up rounds (0=done, 1-2=more rounds)
    directives: list[str]  # Individual directive texts (for persistence tracking)


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
        *,
        memory_audit: str = "",
        wake_history: str = "",
        pending_directives: str = "",
        staleness_warning: str = "",
    ) -> CoachResult:
        """Evaluate Hynous's response. Returns directives or ALL_CLEAR.

        Args:
            snapshot: Live state text that was injected.
            response: Hynous's text response to the wake.
            tool_calls: List of dicts with 'name', 'input', 'result' keys.
            active_context: Nous context that was auto-recalled (or None).
            nous_client: NousClient for querying memory state.
            memory_audit: Formatted mutation tracker output.
            wake_history: Formatted recent daemon events.
            pending_directives: Formatted unresolved directives from previous wakes.
            staleness_warning: Staleness detection text (or empty).

        Returns:
            CoachResult with directives or ALL_CLEAR.
        """
        try:
            memory_state = self._build_memory_state(nous_client)
            user_msg = self._build_prompt(
                snapshot, response, tool_calls, active_context, memory_state,
                memory_audit, wake_history, pending_directives, staleness_warning,
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
                return CoachResult(needs_action=False, message="", depth=0, directives=[])

            # Extract individual directives (lines starting with 1-4)
            directives = _extract_directives(text)
            depth = 2 if len(directives) >= 3 else 1

            logger.info("Coach: %d directives, depth=%d", len(directives), depth)
            return CoachResult(
                needs_action=True,
                message=f"[Internal Review — address these before you go back to sleep]\n{text}",
                depth=depth,
                directives=directives,
            )

        except Exception as e:
            logger.error("Coach evaluation failed: %s", e)
            return CoachResult(needs_action=False, message="", depth=0, directives=[])

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
                lines = [f"Thesis Notes ({len(theses)} active):"]
                for t in theses:
                    lines.append(f"  - {t.get('content_title', 'Untitled')}")
                sections.append("\n".join(lines))
            else:
                sections.append("Thesis Notes: 0 active")
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

                unlinked = 0
                lines = [f"Trade Entries ({len(entries)} active):"]
                for entry in entries:
                    title = entry.get("content_title", "Untitled")
                    symbol = _extract_symbol(title)
                    has_thesis = symbol in thesis_symbols if symbol else True
                    if not has_thesis:
                        unlinked += 1
                    flag = "" if has_thesis else " (!! no thesis linked)"
                    lines.append(f"  - {title}{flag}")

                if unlinked > 0:
                    pct = int(unlinked / len(entries) * 100)
                    lines.append(f"  ({unlinked}/{len(entries)} unlinked = {pct}%)")

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
        memory_audit: str,
        wake_history: str,
        pending_directives: str,
        staleness_warning: str,
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
                    tool_lines.append(f"  -> {result}")
            tools_str = "\n".join(tool_lines)
        else:
            tools_str = "None — took no action"

        context_str = active_context or "None — no relevant memories found"

        # Build sections — only include non-empty ones
        sections = [
            f"## 1. Current State\n{snapshot}",
            f"## 2. What Memory Was Recalled For Hynous\n{context_str}",
            f"## 3. Full Memory State\n{memory_state}",
            f"## 4. Memory Mutations This Cycle\n{memory_audit or 'None — no Nous writes this cycle'}",
            f"## 5. Tools Hynous Used (with results)\n{tools_str}",
            f"## 6. Wake History\n{wake_history or 'No previous wakes'}",
            f"## 7. Unresolved Directives\n{pending_directives or 'None — all previous directives resolved'}",
        ]

        if staleness_warning:
            sections.append(f"## Staleness Warning\n{staleness_warning}")

        sections.append(f"## 8. Hynous's Response\n{response}")

        return "\n\n".join(sections)


def _extract_directives(text: str) -> list[str]:
    """Extract individual directive texts from coach response.

    Matches lines starting with 1., 2., 3., 4. (with optional whitespace).
    Returns list of directive strings without the number prefix.
    """
    directives = []
    for line in text.splitlines():
        stripped = line.strip()
        match = re.match(r'^([1-4])\.\s*(.+)', stripped)
        if match:
            directives.append(match.group(2).strip())
    return directives


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
