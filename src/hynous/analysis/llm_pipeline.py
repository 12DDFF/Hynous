"""LLM synthesis pipeline for the analysis agent.

Orchestrates the single LLM call that turns a trade bundle + deterministic
findings into the narrative / grades / mistake tags / supplemental findings
bundle that :meth:`JournalStore.insert_analysis` will persist. Evidence
validation of the returned supplementals is M3's responsibility — this
module only parses and shape-checks.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .prompts import ANALYSIS_SYSTEM_PROMPT, build_user_prompt
from .rules_engine import Finding

logger = logging.getLogger(__name__)


def parse_llm_json(content: str) -> dict:
    """Parse an LLM response body into a dict, tolerating markdown fences.

    Anthropic models via OpenRouter wrap their JSON output in
    ```json ... ``` fences regardless of ``response_format``. Strip them
    before handing to :func:`json.loads`. Also tolerates a bare ```
    fence (no ``json`` language tag) and trailing whitespace.

    Raises ``ValueError`` on empty input or unparseable JSON after
    fence stripping (re-thrown from :class:`json.JSONDecodeError`).
    """
    if not content:
        raise ValueError("Empty LLM response")
    stripped = content.strip()
    if stripped.startswith("```"):
        first_nl = stripped.find("\n")
        if first_nl > 0:
            stripped = stripped[first_nl + 1:]
        if stripped.endswith("```"):
            stripped = stripped[:-3]
        stripped = stripped.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM response not parseable JSON: {exc}") from exc


def run_analysis(
    *,
    trade_bundle: dict[str, Any],
    deterministic_findings: list[Finding],
    model: str = "openrouter/anthropic/claude-sonnet-4.5",
    max_tokens: int = 4096,
    temperature: float = 0.2,
    prompt_version: str = "v1",
) -> dict[str, Any]:
    """Run the analysis LLM call and return the parsed structured output.

    Args:
        trade_bundle: full ``JournalStore.get_trade()``-shaped bundle.
        deterministic_findings: findings from :func:`run_rules` — these are
            serialized into the user prompt so the LLM can cite them by id.
        model: litellm-compatible model id. Default is Claude Sonnet 4.5.
        max_tokens: upper bound on output length.
        temperature: sampling temperature. Kept low (0.2) to favour
            consistent structured output over creative phrasing.
        prompt_version: opaque version tag persisted onto the returned dict
            so later analysis diffs can be grouped by prompt rev.

    Returns:
        Parsed JSON object with the 7 required keys (``narrative``,
        ``narrative_citations``, ``supplemental_findings``, ``grades``,
        ``mistake_tags``, ``process_quality_score``, ``one_line_summary``)
        plus ``model_used`` and ``prompt_version`` annotations.

    Raises:
        RuntimeError: on litellm call failure (caller decides whether to
            retry). The underlying exception is chained via ``from``.
        ValueError: if the LLM response is empty, not valid JSON, or missing
            any of the 7 required top-level keys.
    """
    # Build messages
    user_prompt = build_user_prompt(
        trade_bundle=trade_bundle,
        deterministic_findings=deterministic_findings,
    )

    messages = [
        {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    # Monthly budget guard — skip the call (and raise so wake_integration
    # logs + returns cleanly) if the v2 LLM cap is tripped. Set once at
    # daemon startup via hynous.core.costs.set_monthly_budget().
    from hynous.core.costs import check_budget

    is_over, current, budget = check_budget()
    if is_over:
        raise RuntimeError(
            f"LLM monthly budget hit (${current:.4f}/${budget:.2f}); "
            f"analysis skipped",
        )

    # Lazy import: v1 test modules (e.g. ``test_trade_retrieval.py``,
    # ``test_pruning.py``) stub ``sys.modules["litellm"]`` at import time when
    # the real package is absent. Alphabetical collection puts those before
    # ``test_v2_analysis.py``; a module-level ``import litellm`` here would
    # bind to the empty stub and break monkeypatching. Resolving inside the
    # call lets per-test monkeypatches of ``litellm.completion`` win
    # regardless of collection order.
    import litellm

    try:
        response = litellm.completion(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            response_format={"type": "json_object"},
        )
    except Exception as e:
        logger.exception("Analysis LLM call failed")
        raise RuntimeError(f"Analysis LLM call failed: {e}") from e

    # Extract content + tolerate markdown fences (OpenRouter Anthropic wraps
    # JSON in ```json ... ``` regardless of response_format — see
    # parse_llm_json docstring).
    content = response.choices[0].message.content
    try:
        parsed: dict[str, Any] = parse_llm_json(content)
    except ValueError:
        logger.error(
            "LLM response was not parseable JSON: %s",
            (content or "")[:500],
        )
        raise

    # Validate required top-level keys
    required_keys = {
        "narrative",
        "narrative_citations",
        "supplemental_findings",
        "grades",
        "mistake_tags",
        "process_quality_score",
        "one_line_summary",
    }
    missing = required_keys - set(parsed.keys())
    if missing:
        raise ValueError(f"LLM response missing required keys: {sorted(missing)}")

    parsed["model_used"] = model
    parsed["prompt_version"] = prompt_version

    # Record cost (best-effort — do NOT let cost-recording break the call)
    try:
        from hynous.core.costs import record_llm_usage

        usage = getattr(response, "usage", None)
        if usage:
            hidden = getattr(response, "_hidden_params", {}) or {}
            record_llm_usage(
                model=model,
                input_tokens=getattr(usage, "prompt_tokens", 0),
                output_tokens=getattr(usage, "completion_tokens", 0),
                cost_usd=hidden.get("response_cost", 0),
            )
    except Exception:
        logger.debug("Failed to record LLM usage", exc_info=True)

    return parsed
