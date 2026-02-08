"""
Perplexity Data Provider

Web search via Perplexity's Sonar API.
Gives the agent access to real-time web information — news, macro events,
regulatory changes, and knowledge gaps.

Key decisions:
- Uses requests.Session for connection reuse (like other providers)
- Singleton pattern via get_provider()
- Model: sonar (cheapest at $1/M tokens, fastest, 128K context)
- Low temperature (0.2) for factual queries
- System prompt steers Sonar toward crypto/finance context
- Returns compact text — no raw JSON, no excessive citations
"""

import os
import logging
from typing import Optional

import requests

logger = logging.getLogger(__name__)


_provider: Optional["PerplexityProvider"] = None


def get_provider() -> "PerplexityProvider":
    """Get or create the singleton PerplexityProvider."""
    global _provider
    if _provider is None:
        api_key = os.environ.get("PERPLEXITY_API_KEY", "")
        if not api_key:
            raise ValueError(
                "PERPLEXITY_API_KEY not set. Add it to your .env file."
            )
        _provider = PerplexityProvider(api_key)
    return _provider


class PerplexityProvider:
    """Synchronous wrapper around Perplexity Sonar API."""

    BASE_URL = "https://api.perplexity.ai/chat/completions"
    MODEL = "sonar"  # Cheapest/fastest — $1/M tokens

    # Steer Sonar toward useful, compact crypto answers
    SYSTEM_PROMPT = (
        "You are a research assistant for a crypto trader. "
        "Give concise, factual answers. Focus on what happened, when, and why it matters for markets. "
        "Skip filler and opinions. If something is unconfirmed or rumored, say so. "
        "Keep responses under 300 words unless the question demands more."
    )

    def __init__(self, api_key: str):
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        })
        logger.info("PerplexityProvider initialized")

    def search(
        self,
        query: str,
        context: str | None = None,
        max_tokens: int = 600,
    ) -> dict:
        """Search the web via Perplexity Sonar.

        Args:
            query: The search query.
            context: Optional context about WHY the agent is searching.
                     Prepended to query for better results.
            max_tokens: Max response length.

        Returns:
            dict with keys: answer (str), citations (list[str])
        """
        # Build the user message — include context if provided
        if context:
            user_content = f"Context: {context}\n\nQuestion: {query}"
        else:
            user_content = query

        payload = {
            "model": self.MODEL,
            "messages": [
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }

        resp = self._session.post(self.BASE_URL, json=payload, timeout=30)
        resp.raise_for_status()

        data = resp.json()
        answer = data["choices"][0]["message"]["content"]
        citations = data.get("citations", [])

        # Record token usage for cost tracking
        usage = data.get("usage", {})
        if usage:
            try:
                from ...core.costs import record_perplexity_usage
                record_perplexity_usage(
                    input_tokens=usage.get("prompt_tokens", 0),
                    output_tokens=usage.get("completion_tokens", 0),
                )
            except Exception:
                pass  # Never let cost tracking break the search

        return {"answer": answer, "citations": citations}
