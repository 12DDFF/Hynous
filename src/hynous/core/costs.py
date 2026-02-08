"""
Cost Tracker

Tracks operational costs for Hynous: API usage (Claude, Perplexity) and
fixed monthly subscriptions (Coinglass). Persists to storage/costs.json.

The agent can query this to understand his own burn rate and be cost-conscious.
David can use it to monitor expenses.

Pricing (as of Feb 2026):
  Claude Sonnet 4.5:
    Input:         $3.00/M tokens
    Output:        $15.00/M tokens
    Cache write:   $3.75/M tokens  (25% premium on first cache fill)
    Cache read:    $0.30/M tokens  (90% savings on subsequent calls)
  Perplexity Sonar:  $1/M input tokens, $1/M output tokens
  Coinglass Hobbyist: $35/month fixed
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

# Pricing per million tokens (USD)
PRICING = {
    "claude": {
        "input": 3.00,
        "output": 15.00,
        "cache_write": 3.75,
        "cache_read": 0.30,
    },
    "perplexity": {"input": 1.00, "output": 1.00},
}

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


def _get_month(data: dict, month: str) -> dict:
    """Get or create a month's cost record."""
    if month not in data["months"]:
        data["months"][month] = {
            "claude": {
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_write_tokens": 0,
                "cache_read_tokens": 0,
                "calls": 0,
            },
            "perplexity": {"input_tokens": 0, "output_tokens": 0, "calls": 0},
            "fixed": dict(FIXED_MONTHLY),
        }
    # Migrate older records that lack cache fields
    c = data["months"][month]["claude"]
    c.setdefault("cache_write_tokens", 0)
    c.setdefault("cache_read_tokens", 0)
    return data["months"][month]


def record_claude_usage(
    input_tokens: int,
    output_tokens: int,
    cache_write_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> None:
    """Record a Claude API call's token usage.

    With prompt caching enabled, the API reports:
      - input_tokens:                uncached input tokens (regular price)
      - cache_creation_input_tokens: tokens written to cache (write price)
      - cache_read_input_tokens:     tokens read from cache (read price)
    """
    data = _load()
    month = _get_month(data, _month_key())
    month["claude"]["input_tokens"] += input_tokens
    month["claude"]["output_tokens"] += output_tokens
    month["claude"]["cache_write_tokens"] += cache_write_tokens
    month["claude"]["cache_read_tokens"] += cache_read_tokens
    month["claude"]["calls"] += 1
    _save(data)


def record_perplexity_usage(input_tokens: int, output_tokens: int) -> None:
    """Record a Perplexity API call's token usage."""
    data = _load()
    month = _get_month(data, _month_key())
    month["perplexity"]["input_tokens"] += input_tokens
    month["perplexity"]["output_tokens"] += output_tokens
    month["perplexity"]["calls"] += 1
    _save(data)


def _calc_api_cost(
    service: str,
    input_tokens: int,
    output_tokens: int,
    cache_write_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> float:
    """Calculate USD cost for token usage (cache-aware)."""
    p = PRICING.get(service, {"input": 0, "output": 0})
    cost = (
        (input_tokens / 1_000_000) * p["input"]
        + (output_tokens / 1_000_000) * p["output"]
    )
    # Add cache costs if present (Claude only)
    if cache_write_tokens:
        cost += (cache_write_tokens / 1_000_000) * p.get("cache_write", p["input"])
    if cache_read_tokens:
        cost += (cache_read_tokens / 1_000_000) * p.get("cache_read", p["input"])
    return cost


_summary_cache: dict | None = None
_summary_cache_time: float = 0
_SUMMARY_CACHE_TTL = 30  # seconds — wallet UI doesn't need real-time updates


def get_month_summary(month: Optional[str] = None) -> dict:
    """Get cost summary for a month.

    Returns dict with:
        claude: {input_tokens, output_tokens, calls, cost_usd}
        perplexity: {input_tokens, output_tokens, calls, cost_usd}
        fixed: {coinglass: 35.00, ...}
        total_usd: float

    Current-month results are cached for 30s to avoid repeated disk reads
    (dashboard computed vars call this 7x per state update).
    """
    global _summary_cache, _summary_cache_time

    if month is None:
        month = _month_key()
        # Cache hit for current month
        if _summary_cache is not None and time.monotonic() - _summary_cache_time < _SUMMARY_CACHE_TTL:
            return _summary_cache

    data = _load()
    m = _get_month(data, month)

    c = m["claude"]
    claude_cost = _calc_api_cost(
        "claude",
        c["input_tokens"],
        c["output_tokens"],
        c["cache_write_tokens"],
        c["cache_read_tokens"],
    )
    # What we would have paid without caching (all cache tokens at regular input price)
    claude_nocache = _calc_api_cost(
        "claude",
        c["input_tokens"] + c["cache_write_tokens"] + c["cache_read_tokens"],
        c["output_tokens"],
    )
    perplexity_cost = _calc_api_cost(
        "perplexity", m["perplexity"]["input_tokens"], m["perplexity"]["output_tokens"]
    )
    fixed_total = sum(m["fixed"].values())

    result = {
        "month": month,
        "claude": {
            **c,
            "cost_usd": round(claude_cost, 4),
            "cache_savings_usd": round(claude_nocache - claude_cost, 4),
        },
        "perplexity": {
            **m["perplexity"],
            "cost_usd": round(perplexity_cost, 4),
        },
        "fixed": m["fixed"],
        "total_usd": round(claude_cost + perplexity_cost + fixed_total, 2),
    }

    # Cache current-month result
    if month == _month_key():
        _summary_cache = result
        _summary_cache_time = time.monotonic()

    return result


def get_cost_report() -> str:
    """Generate a human-readable cost report for the current month.

    Used by the agent to understand his own operational costs.
    """
    s = get_month_summary()

    lines = [f"Operating Costs ({s['month']}):"]
    lines.append("")

    # Claude
    c = s["claude"]
    cache_note = ""
    if c["cache_read_tokens"] > 0:
        cache_note = f" | cache saved ${c['cache_savings_usd']:.2f}"
    lines.append(
        f"  Claude API: ${c['cost_usd']:.2f} "
        f"({c['calls']} calls, "
        f"{c['input_tokens']:,} in / {c['output_tokens']:,} out tokens"
        f"{cache_note})"
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
