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
  Claude Haiku 4.5:
    Input:         $0.80/M tokens
    Output:        $4.00/M tokens
    Cache write:   $1.00/M tokens
    Cache read:    $0.08/M tokens
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
    "claude_sonnet": {
        "input": 3.00,
        "output": 15.00,
        "cache_write": 3.75,
        "cache_read": 0.30,
    },
    "claude_haiku": {
        "input": 0.80,
        "output": 4.00,
        "cache_write": 1.00,
        "cache_read": 0.08,
    },
    "perplexity": {"input": 1.00, "output": 1.00},
}

# Fixed monthly subscriptions
FIXED_MONTHLY = {
    "coinglass": 35.00,
}

# Valid Claude model keys
_CLAUDE_MODELS = ("sonnet", "haiku")


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


def _empty_claude_bucket() -> dict:
    """Template for a single model's token bucket."""
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_write_tokens": 0,
        "cache_read_tokens": 0,
        "calls": 0,
    }


def _get_month(data: dict, month: str) -> dict:
    """Get or create a month's cost record."""
    if month not in data["months"]:
        data["months"][month] = {
            "claude_sonnet": _empty_claude_bucket(),
            "claude_haiku": _empty_claude_bucket(),
            "perplexity": {"input_tokens": 0, "output_tokens": 0, "calls": 0},
            "fixed": dict(FIXED_MONTHLY),
        }
    m = data["months"][month]

    # Migrate from old single "claude" bucket to split buckets
    if "claude" in m and "claude_sonnet" not in m:
        # Old data had a single "claude" key — move it to "claude_sonnet"
        m["claude_sonnet"] = m.pop("claude")
        m.setdefault("claude_haiku", _empty_claude_bucket())

    # Ensure both model buckets exist (covers partial migration)
    m.setdefault("claude_sonnet", _empty_claude_bucket())
    m.setdefault("claude_haiku", _empty_claude_bucket())

    # Migrate older records that lack cache fields
    for key in ("claude_sonnet", "claude_haiku"):
        m[key].setdefault("cache_write_tokens", 0)
        m[key].setdefault("cache_read_tokens", 0)

    return m


def record_claude_usage(
    input_tokens: int,
    output_tokens: int,
    cache_write_tokens: int = 0,
    cache_read_tokens: int = 0,
    model: str = "sonnet",
) -> None:
    """Record a Claude API call's token usage.

    Args:
        input_tokens: Uncached input tokens.
        output_tokens: Output tokens.
        cache_write_tokens: Tokens written to cache (write price).
        cache_read_tokens: Tokens read from cache (read price).
        model: "sonnet" or "haiku". Defaults to "sonnet".
    """
    if model not in _CLAUDE_MODELS:
        model = "sonnet"

    bucket_key = f"claude_{model}"
    data = _load()
    month = _get_month(data, _month_key())
    bucket = month[bucket_key]
    bucket["input_tokens"] += input_tokens
    bucket["output_tokens"] += output_tokens
    bucket["cache_write_tokens"] += cache_write_tokens
    bucket["cache_read_tokens"] += cache_read_tokens
    bucket["calls"] += 1
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
    pricing_key: str,
    input_tokens: int,
    output_tokens: int,
    cache_write_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> float:
    """Calculate USD cost for token usage (cache-aware)."""
    p = PRICING.get(pricing_key, {"input": 0, "output": 0})
    cost = (
        (input_tokens / 1_000_000) * p["input"]
        + (output_tokens / 1_000_000) * p["output"]
    )
    if cache_write_tokens:
        cost += (cache_write_tokens / 1_000_000) * p.get("cache_write", p["input"])
    if cache_read_tokens:
        cost += (cache_read_tokens / 1_000_000) * p.get("cache_read", p["input"])
    return cost


def _bucket_cost(pricing_key: str, bucket: dict) -> float:
    """Calculate cost for a token bucket."""
    return _calc_api_cost(
        pricing_key,
        bucket["input_tokens"],
        bucket["output_tokens"],
        bucket.get("cache_write_tokens", 0),
        bucket.get("cache_read_tokens", 0),
    )


def _bucket_nocache_cost(pricing_key: str, bucket: dict) -> float:
    """Calculate what cost would have been without caching."""
    return _calc_api_cost(
        pricing_key,
        bucket["input_tokens"] + bucket.get("cache_write_tokens", 0) + bucket.get("cache_read_tokens", 0),
        bucket["output_tokens"],
    )


_summary_cache: dict | None = None
_summary_cache_time: float = 0
_SUMMARY_CACHE_TTL = 30  # seconds — wallet UI doesn't need real-time updates


def get_month_summary(month: Optional[str] = None) -> dict:
    """Get cost summary for a month.

    Returns dict with:
        claude: {input_tokens, output_tokens, calls, cost_usd, cache_savings_usd,
                 sonnet: {...}, haiku: {...}}
        perplexity: {input_tokens, output_tokens, calls, cost_usd}
        fixed: {coinglass: 35.00, ...}
        total_usd: float

    The top-level "claude" key sums Sonnet + Haiku for backward compatibility
    with the dashboard. Sub-keys provide per-model breakdowns.
    """
    global _summary_cache, _summary_cache_time

    if month is None:
        month = _month_key()
        if _summary_cache is not None and time.monotonic() - _summary_cache_time < _SUMMARY_CACHE_TTL:
            return _summary_cache

    data = _load()
    m = _get_month(data, month)

    sonnet = m["claude_sonnet"]
    haiku = m["claude_haiku"]

    sonnet_cost = _bucket_cost("claude_sonnet", sonnet)
    sonnet_nocache = _bucket_nocache_cost("claude_sonnet", sonnet)
    haiku_cost = _bucket_cost("claude_haiku", haiku)
    haiku_nocache = _bucket_nocache_cost("claude_haiku", haiku)

    total_claude_cost = sonnet_cost + haiku_cost
    total_claude_savings = (sonnet_nocache - sonnet_cost) + (haiku_nocache - haiku_cost)

    perplexity_cost = _calc_api_cost(
        "perplexity", m["perplexity"]["input_tokens"], m["perplexity"]["output_tokens"]
    )
    fixed_total = sum(m["fixed"].values())

    result = {
        "month": month,
        "claude": {
            # Summed totals — dashboard reads these
            "input_tokens": sonnet["input_tokens"] + haiku["input_tokens"],
            "output_tokens": sonnet["output_tokens"] + haiku["output_tokens"],
            "cache_write_tokens": sonnet.get("cache_write_tokens", 0) + haiku.get("cache_write_tokens", 0),
            "cache_read_tokens": sonnet.get("cache_read_tokens", 0) + haiku.get("cache_read_tokens", 0),
            "calls": sonnet["calls"] + haiku["calls"],
            "cost_usd": round(total_claude_cost, 4),
            "cache_savings_usd": round(total_claude_savings, 4),
            # Per-model breakdowns
            "sonnet": {
                "calls": sonnet["calls"],
                "input_tokens": sonnet["input_tokens"],
                "output_tokens": sonnet["output_tokens"],
                "cost_usd": round(sonnet_cost, 4),
            },
            "haiku": {
                "calls": haiku["calls"],
                "input_tokens": haiku["input_tokens"],
                "output_tokens": haiku["output_tokens"],
                "cost_usd": round(haiku_cost, 4),
            },
        },
        "perplexity": {
            **m["perplexity"],
            "cost_usd": round(perplexity_cost, 4),
        },
        "fixed": m["fixed"],
        "total_usd": round(total_claude_cost + perplexity_cost + fixed_total, 2),
    }

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

    # Claude — total
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

    # Claude — per-model breakdown
    sn = c["sonnet"]
    hk = c["haiku"]
    if sn["calls"] > 0:
        lines.append(
            f"    Sonnet: ${sn['cost_usd']:.2f} ({sn['calls']} calls, "
            f"{sn['input_tokens']:,} in / {sn['output_tokens']:,} out)"
        )
    if hk["calls"] > 0:
        lines.append(
            f"    Haiku:  ${hk['cost_usd']:.2f} ({hk['calls']} calls, "
            f"{hk['input_tokens']:,} in / {hk['output_tokens']:,} out)"
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
