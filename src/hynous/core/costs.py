"""
Cost Tracker

Tracks operational costs for Hynous: LLM API usage (any provider via OpenRouter),
Perplexity, and fixed monthly subscriptions. Persists to storage/costs.json.

Cost per call is calculated by LiteLLM's completion_cost() which knows
pricing for all models. No hardcoded pricing tables needed.
"""

import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_STORAGE_DIR = Path(__file__).resolve().parents[3] / "storage"
_COSTS_FILE = _STORAGE_DIR / "costs.json"

# Fixed monthly subscriptions
FIXED_MONTHLY = {
    "coinglass": 35.00,
}


def _month_key() -> str:
    """Current month as YYYY-MM string."""
    return datetime.now().strftime("%Y-%m")


def _load() -> dict:
    """Load costs data from disk."""
    if not _COSTS_FILE.exists():
        return {"months": {}}
    try:
        return json.loads(_COSTS_FILE.read_text())
    except Exception as e:
        logger.error(f"Failed to load costs: {e}")
        return {"months": {}}


def _save(data: dict) -> None:
    """Save costs data to disk."""
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        _COSTS_FILE.write_text(json.dumps(data, indent=2))
    except Exception as e:
        logger.error(f"Failed to save costs: {e}")


def _model_label(model: str) -> str:
    """Convert a full model ID to a short display label.

    'openrouter/anthropic/claude-sonnet-4-5-20250929' → 'claude-sonnet-4-5'
    'openrouter/x-ai/grok-4.1-fast' → 'grok-4.1-fast'
    """
    # Strip openrouter/ prefix
    if model.startswith("openrouter/"):
        model = model[len("openrouter/"):]
    # Take the last segment (model name after provider/)
    parts = model.split("/")
    name = parts[-1] if len(parts) > 1 else parts[0]
    # Strip date suffixes like -20250929
    import re
    name = re.sub(r'-\d{8}$', '', name)
    return name


def _get_month(data: dict, month: str) -> dict:
    """Get or create a month's cost record."""
    if month not in data["months"]:
        data["months"][month] = {
            "llm": {},  # model_label → {calls, input_tokens, output_tokens, cost_usd}
            "perplexity": {"input_tokens": 0, "output_tokens": 0, "calls": 0},
            "fixed": dict(FIXED_MONTHLY),
        }
    m = data["months"][month]
    m.setdefault("llm", {})
    m.setdefault("perplexity", {"input_tokens": 0, "output_tokens": 0, "calls": 0})
    m.setdefault("fixed", dict(FIXED_MONTHLY))

    # Migrate old claude_sonnet/claude_haiku buckets → llm
    for old_key, new_label in [("claude_sonnet", "claude-sonnet-4-5"), ("claude_haiku", "claude-haiku-4-5")]:
        if old_key in m:
            old = m.pop(old_key)
            if old.get("calls", 0) > 0:
                existing = m["llm"].get(new_label, _empty_model_bucket())
                existing["calls"] += old["calls"]
                existing["input_tokens"] += old.get("input_tokens", 0)
                existing["output_tokens"] += old.get("output_tokens", 0)
                # Estimate cost from old pricing (migration only)
                existing["cost_usd"] += (
                    old.get("input_tokens", 0) / 1_000_000 * (3.00 if "sonnet" in old_key else 0.80)
                    + old.get("output_tokens", 0) / 1_000_000 * (15.00 if "sonnet" in old_key else 4.00)
                    + old.get("cache_write_tokens", 0) / 1_000_000 * (3.75 if "sonnet" in old_key else 1.00)
                    + old.get("cache_read_tokens", 0) / 1_000_000 * (0.30 if "sonnet" in old_key else 0.08)
                )
                m["llm"][new_label] = existing

    # Migrate single old "claude" bucket
    if "claude" in m and not any(k.startswith("claude_") for k in m):
        old = m.pop("claude")
        if old.get("calls", 0) > 0:
            existing = m["llm"].get("claude-sonnet-4-5", _empty_model_bucket())
            existing["calls"] += old["calls"]
            existing["input_tokens"] += old.get("input_tokens", 0)
            existing["output_tokens"] += old.get("output_tokens", 0)
            existing["cost_usd"] += (
                old.get("input_tokens", 0) / 1_000_000 * 3.00
                + old.get("output_tokens", 0) / 1_000_000 * 15.00
            )
            m["llm"]["claude-sonnet-4-5"] = existing

    return m


def _empty_model_bucket() -> dict:
    return {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}


def record_llm_usage(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
) -> None:
    """Record an LLM API call with pre-calculated cost from LiteLLM.

    Args:
        model: Full model string (e.g. 'openrouter/x-ai/grok-4.1-fast').
        input_tokens: Input/prompt tokens.
        output_tokens: Output/completion tokens.
        cost_usd: Actual USD cost from litellm.completion_cost().
    """
    label = _model_label(model)
    data = _load()
    month = _get_month(data, _month_key())
    bucket = month["llm"].setdefault(label, _empty_model_bucket())
    bucket["calls"] += 1
    bucket["input_tokens"] += input_tokens
    bucket["output_tokens"] += output_tokens
    bucket["cost_usd"] += cost_usd
    _save(data)


def record_perplexity_usage(input_tokens: int, output_tokens: int) -> None:
    """Record a Perplexity API call's token usage."""
    data = _load()
    month = _get_month(data, _month_key())
    month["perplexity"]["input_tokens"] += input_tokens
    month["perplexity"]["output_tokens"] += output_tokens
    month["perplexity"]["calls"] += 1
    _save(data)


_summary_cache: dict | None = None
_summary_cache_time: float = 0
_SUMMARY_CACHE_TTL = 30  # seconds


def get_month_summary(month: Optional[str] = None) -> dict:
    """Get cost summary for a month.

    Returns dict with:
        llm: {total_cost_usd, total_calls, total_input_tokens, total_output_tokens,
              models: [{label, calls, input_tokens, output_tokens, cost_usd}, ...]}
        perplexity: {input_tokens, output_tokens, calls, cost_usd}
        fixed: {coinglass: 35.00, ...}
        total_usd: float

    Also includes legacy 'claude' key for backward compatibility.
    """
    global _summary_cache, _summary_cache_time

    if month is None:
        month = _month_key()
        if _summary_cache is not None and time.monotonic() - _summary_cache_time < _SUMMARY_CACHE_TTL:
            return _summary_cache

    data = _load()
    m = _get_month(data, month)

    # Aggregate LLM models
    llm_models = []
    total_llm_cost = 0.0
    total_llm_calls = 0
    total_llm_in = 0
    total_llm_out = 0
    for label, bucket in sorted(m["llm"].items(), key=lambda x: -x[1].get("cost_usd", 0)):
        cost = bucket.get("cost_usd", 0.0)
        calls = bucket.get("calls", 0)
        in_tok = bucket.get("input_tokens", 0)
        out_tok = bucket.get("output_tokens", 0)
        total_llm_cost += cost
        total_llm_calls += calls
        total_llm_in += in_tok
        total_llm_out += out_tok
        llm_models.append({
            "label": label,
            "calls": calls,
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "cost_usd": round(cost, 4),
        })

    # Perplexity (still uses simple pricing since it doesn't go through LiteLLM)
    p = m["perplexity"]
    perplexity_cost = (p["input_tokens"] + p["output_tokens"]) / 1_000_000 * 1.00
    fixed_total = sum(m["fixed"].values())

    result = {
        "month": month,
        "llm": {
            "total_cost_usd": round(total_llm_cost, 4),
            "total_calls": total_llm_calls,
            "total_input_tokens": total_llm_in,
            "total_output_tokens": total_llm_out,
            "models": llm_models,
        },
        # Legacy 'claude' key — dashboard wallet reads this
        "claude": {
            "input_tokens": total_llm_in,
            "output_tokens": total_llm_out,
            "calls": total_llm_calls,
            "cost_usd": round(total_llm_cost, 4),
            "cache_savings_usd": 0,
            "cache_write_tokens": 0,
            "cache_read_tokens": 0,
            "sonnet": {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0},
            "haiku": {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0},
        },
        "perplexity": {
            **p,
            "cost_usd": round(perplexity_cost, 4),
        },
        "fixed": m["fixed"],
        "total_usd": round(total_llm_cost + perplexity_cost + fixed_total, 2),
    }

    if month == _month_key():
        _summary_cache = result
        _summary_cache_time = time.monotonic()

    return result


def get_cost_report() -> str:
    """Generate a human-readable cost report for the current month."""
    s = get_month_summary()

    lines = [f"Operating Costs ({s['month']}):"]
    lines.append("")

    # LLM API — total
    llm = s["llm"]
    lines.append(
        f"  LLM API: ${llm['total_cost_usd']:.2f} "
        f"({llm['total_calls']} calls, "
        f"{llm['total_input_tokens']:,} in / {llm['total_output_tokens']:,} out tokens)"
    )

    # Per-model breakdown
    for model in llm["models"]:
        if model["calls"] > 0:
            lines.append(
                f"    {model['label']}: ${model['cost_usd']:.2f} "
                f"({model['calls']} calls, "
                f"{model['input_tokens']:,} in / {model['output_tokens']:,} out)"
            )

    # Perplexity
    p = s["perplexity"]
    lines.append(
        f"  Perplexity API: ${p['cost_usd']:.2f} "
        f"({p['calls']} calls, "
        f"{p['input_tokens']:,} in / {p['output_tokens']:,} out tokens)"
    )

    # Fixed
    for name, cost in s["fixed"].items():
        lines.append(f"  {name.capitalize()}: ${cost:.2f}/mo (subscription)")

    # Total
    lines.append("")
    lines.append(f"  Total this month: ${s['total_usd']:.2f}")

    return "\n".join(lines)
