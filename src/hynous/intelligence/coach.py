"""
Coach — Haiku-powered sharpener that runs BEFORE Sonnet responds.

Sees the briefing + code questions + memory state and adds 1-2 cross-signal
reasoning questions that code can't generate. These questions guide Sonnet's
thinking — injected into the wake message alongside code questions.

Also provides trade pre-mortem checks — a fast sanity check before execution.

Cost per call: ~$0.0003-0.0005 (Haiku, ~1.5K in + 80 out).
"""

import logging
import time

import litellm

from ..core.config import Config
from ..core.costs import record_llm_usage

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
- A concept or theory the trader should understand to interpret the current data better

WAKE HISTORY PATTERNS — pay special attention to:
- Same asset appearing in 3+ recent wakes (conviction building? or noise?)
- Consecutive passes on the same signal type (justified caution or paralysis?)
- Alternating long/short signals on one asset (choppy, avoid)
- Scanner wakes followed by no trade, then profit alert on same asset (missed opportunity pattern)
If you see a pattern, frame it as a question: "3 of 5 recent wakes flagged SOL — \
is conviction building or are you ignoring a setup?"

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


PRE_MORTEM_PROMPT = """\
You are a risk-check layer for the trading agent Hynous. He is about to execute a trade. \
Your job: find ONE reason this trade could fail that the agent might not be seeing.

Check for:
- Direction vs regime mismatch (going long in a bearish regime, or short in bullish)
- Funding rate working against the trade (paying funding to hold)
- Recent losses on the same asset (revenge trading pattern)
- Extreme volatility conditions (position might get stopped out by noise)
- Correlated positions (already exposed to the same directional risk)

If you find a genuine concern: write ONE sentence (under 40 words), specific, \
with numbers. Example: "Funding is +0.08% — you'll pay $12/day to hold this \
long while longs are already crowded."

If the trade looks sound: respond with just "CLEAR"

RULES:
- ONE concern max. Under 40 words.
- Must be specific with numbers from the context.
- Do NOT repeat validations already done (R:R, portfolio risk, leverage coherence).
- CLEAR is better than a weak concern."""


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
                    try:
                        cost = litellm.completion_cost(completion_response=result)
                    except Exception:
                        cost = 0.0
                    record_llm_usage(
                        model=self.config.memory.compression_model,
                        input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                        output_tokens=getattr(usage, "completion_tokens", 0) or 0,
                        cost_usd=cost,
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

    def pre_mortem(
        self,
        symbol: str,
        side: str,
        leverage: int,
        stop_loss: float | None,
        take_profit: float | None,
        confidence: float | None,
        reasoning: str | None,
        market_context: str,
    ) -> str | None:
        """Fast sanity check before trade execution.

        Args:
            symbol: Trading symbol (e.g., "BTC").
            side: "long" or "short".
            leverage: Trade leverage.
            stop_loss: SL price.
            take_profit: TP price.
            confidence: Conviction level (0-1).
            reasoning: Agent's thesis for the trade.
            market_context: Compact context string (regime, funding, positions, ML).

        Returns a warning string, or None if trade looks sound.
        """
        try:
            sl_str = f"${stop_loss:,.2f}" if stop_loss else "none"
            tp_str = f"${take_profit:,.2f}" if take_profit else "none"
            conf_str = f"{confidence:.0%}" if confidence is not None else "?"

            user_msg = (
                f"Trade: {side.upper()} {symbol} at {leverage}x\n"
                f"SL: {sl_str} | TP: {tp_str} | Confidence: {conf_str}\n"
                f"Reasoning: {reasoning or 'not provided'}\n\n"
                f"Market context:\n{market_context}"
            )

            result = litellm.completion(
                model=self.config.memory.compression_model,
                max_tokens=80,
                messages=[
                    {"role": "system", "content": PRE_MORTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
            )

            # Record usage
            try:
                usage = result.usage
                if usage:
                    try:
                        cost = litellm.completion_cost(completion_response=result)
                    except Exception:
                        cost = 0.0
                    record_llm_usage(
                        model=self.config.memory.compression_model,
                        input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                        output_tokens=getattr(usage, "completion_tokens", 0) or 0,
                        cost_usd=cost,
                    )
            except Exception:
                pass

            text = result.choices[0].message.content.strip()

            if "CLEAR" in text.upper() and len(text) < 20:
                logger.info("Pre-mortem: CLEAR for %s %s", side, symbol)
                return None

            logger.info("Pre-mortem warning: %s", text[:100])
            return text

        except Exception as e:
            logger.debug("Pre-mortem check failed (non-blocking): %s", e)
            return None

    def _build_pre_mortem_context(self, symbol: str, side: str) -> str:
        """Build compact market context for the pre-mortem check."""
        lines = []
        try:
            from .daemon import get_active_daemon
            daemon = get_active_daemon()
            if not daemon:
                return "No daemon context available"

            # Regime
            if daemon._regime:
                lines.append(f"Regime: {daemon._regime.label} (macro={daemon._regime.macro_score:+.2f})")

            # Funding for this symbol
            if daemon.snapshot and daemon.snapshot.funding:
                funding = daemon.snapshot.funding.get(symbol)
                if funding is not None:
                    lines.append(f"Funding {symbol}: {funding:+.4%}")

            # Existing positions
            if daemon._prev_positions:
                for coin, pdata in daemon._prev_positions.items():
                    p_side = pdata.get("side", "long")
                    p_lev = pdata.get("leverage", 0)
                    lines.append(f"Open position: {coin} {p_side.upper()} {p_lev}x")

            # ML conditions
            pred = (daemon._latest_predictions or {}).get(symbol, {})
            cond = pred.get("conditions", {})
            if cond:
                for name in ["vol_1h", "mae_long", "mae_short", "entry_quality"]:
                    info = cond.get(name)
                    if info and info.get("regime") in ("high", "extreme"):
                        lines.append(f"ML {name}: {info.get('regime')} (p{info.get('percentile', '?')})")

            # Recent trades on same symbol (from Nous)
            try:
                from ..nous.client import get_client
                nous = get_client()
                recent = nous.list_nodes(
                    subtype="custom:trade_close",
                    lifecycle="ACTIVE",
                    limit=3,
                )
                for node in recent:
                    title = node.get("content_title", "")
                    if symbol.upper() in title.upper():
                        body = node.get("content_body", "")
                        # Extract PnL from body
                        if "PnL:" in body:
                            pnl_line = [l for l in body.split("\n") if "PnL:" in l]
                            if pnl_line:
                                lines.append(f"Recent: {title[:50]} — {pnl_line[0].strip()}")
                        else:
                            lines.append(f"Recent: {title[:60]}")
            except Exception:
                pass

        except Exception as e:
            lines.append(f"Context error: {e}")

        return "\n".join(lines) if lines else "No additional context"

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
