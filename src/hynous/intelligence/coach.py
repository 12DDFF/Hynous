"""
Coach — Haiku-powered sharpener that runs BEFORE Sonnet responds.

Sees the briefing + code questions + memory state and adds 1-2 cross-signal
reasoning questions that code can't generate. These questions guide Sonnet's
thinking — injected into the wake message alongside code questions.

Runs ONLY on review + manual wakes (not fills, watchpoints, or learning).

Cost per call: ~$0.0003-0.0005 (Haiku, ~1.5K in + 80 out).
"""

import logging

import litellm

from ..core.config import Config
from ..core.costs import record_claude_usage

logger = logging.getLogger(__name__)


SHARPENER_PROMPT = """\
You see Hynous's market briefing before he wakes up. Code-based questions already \
flag obvious signals (funding extremes, F&G, orderbook imbalance). YOUR job: find \
connections BETWEEN signals that code can't see.

CONTEXT:
1. Market Briefing — portfolio, positions, orderbook, funding, trends
2. Memory State — active watchpoints, theses, trades, curiosity
3. Code Questions — what the system already flagged
4. Wake History — last 5 daemon events

WHAT TO LOOK FOR:
- Two signals that together tell a different story than either alone
- A thesis assumption that current market data contradicts
- A risk the trader isn't thinking about (correlation, timing, macro)
- Something across recent wakes that forms a pattern
- A concept or theory the trader should understand to interpret the current data better

Write 1-2 questions (under 30 words each). Specific, using numbers from the data.
Good: "7d funding rising but 24h price flat — longs building without price \
follow-through. Squeeze risk?"
Bad: "You should check funding."

If nothing connects: "ALL_CLEAR"

RULES:
- 1-2 questions max. Under 30 words each.
- Questions, not commands.
- Must reference specific numbers from the briefing.
- Prefer ALL_CLEAR over weak questions."""


class Coach:
    """Haiku-powered sharpener for daemon wake quality."""

    def __init__(self, config: Config):
        self.config = config

    def sharpen(
        self,
        briefing: str,
        code_questions: list[str],
        memory_state: dict,
        wake_history: str,
    ) -> list[str]:
        """Generate 0-2 reasoning questions to inject before Sonnet.

        Args:
            briefing: Full briefing text (portfolio, book, funding, trends).
            code_questions: What code-based checks already flagged.
            memory_state: Pre-queried dict from wake_warnings._query_memory_state().
            wake_history: Formatted recent daemon events.

        Returns list of question strings, or empty list if ALL_CLEAR.
        """
        try:
            user_msg = self._build_prompt(
                briefing, code_questions, memory_state, wake_history,
            )

            result = litellm.completion(
                model=self.config.memory.compression_model,
                max_tokens=120,
                messages=[
                    {"role": "system", "content": SHARPENER_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
            )

            # Record usage for cost tracking
            try:
                usage = result.usage
                if usage:
                    record_claude_usage(
                        input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                        output_tokens=getattr(usage, "completion_tokens", 0) or 0,
                        cache_write_tokens=0,
                        cache_read_tokens=0,
                        model="haiku",
                    )
            except Exception:
                pass

            text = result.choices[0].message.content.strip()

            if "ALL_CLEAR" in text:
                logger.info("Coach: ALL_CLEAR")
                return []

            # Parse questions — split on newlines, clean up
            questions = []
            for line in text.split("\n"):
                line = line.strip().strip('"').strip("'").strip("-").strip("•").strip()
                # Strip numbered list prefixes: "1.", "2)", "1:"
                if len(line) > 2 and line[0].isdigit() and line[1] in ".):":
                    line = line[2:].strip()
                # Skip empty, too-short, markdown headings, and dividers
                if not line or len(line) <= 10:
                    continue
                if line.startswith("#") or line.startswith("---") or line.startswith("**"):
                    continue
                questions.append(line)

            # Cap at 2
            questions = questions[:2]
            for q in questions:
                logger.info("Coach question: %s", q[:80])
            return questions

        except Exception as e:
            logger.error("Coach sharpen failed: %s", e)
            return []

    def _build_prompt(
        self,
        briefing: str,
        code_questions: list[str],
        memory_state: dict,
        wake_history: str,
    ) -> str:
        """Assemble the sharpener prompt for Haiku."""
        from .wake_warnings import format_memory_state

        # Format code questions
        if code_questions:
            code_q_str = "\n".join(f"- {q}" for q in code_questions)
        else:
            code_q_str = "None — all signals within normal range"

        # Format memory state
        memory_str = format_memory_state(memory_state)

        sections = [
            f"## 1. Market Briefing\n{briefing}",
            f"## 2. Memory State\n{memory_str}",
            f"## 3. Code Questions Already Flagged\n{code_q_str}",
            f"## 4. Wake History\n{wake_history or 'No previous wakes'}",
        ]

        return "\n\n".join(sections)
