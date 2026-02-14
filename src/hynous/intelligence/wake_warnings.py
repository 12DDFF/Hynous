"""
Wake Warnings — Deterministic code-based checks injected before agent responds.

Pure function module (like context_snapshot.py). Runs BEFORE agent.chat() in
daemon._wake_agent(). Catches mechanical issues that code can check perfectly
(trade without thesis, missing SL/TP, stale items). Haiku gap finder handles
the rest (reasoning gaps, missed signals).

Cost: zero (Python only, no LLM calls).
"""

import logging
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_memory_state_cache: dict | None = None
_memory_state_cache_time: float = 0.0
_MEMORY_STATE_CACHE_TTL: float = 300.0  # 5 minutes


# ====================================================================
# Public API
# ====================================================================

def build_warnings(provider, daemon, nous_client, config) -> tuple[str, dict]:
    """Build deterministic warnings + shared memory state.

    Returns (warnings_text, memory_state_dict).

    warnings_text: "[Warnings]\\n- ..." block or empty string.
    memory_state_dict: passed to coach.evaluate() to avoid double-querying Nous.
    Safe — never raises.
    """
    try:
        memory_state = _query_memory_state(nous_client)
        warnings = []

        # 1. Trade without thesis
        _check_unlinked_trades(memory_state, warnings)

        # 2. Position without SL/TP
        _check_missing_protection(provider, warnings)

        # 3. No watchpoints + open positions
        _check_no_watchpoints(provider, memory_state, warnings)

        # 4. Stale curiosity (>3d)
        _check_stale_curiosity(memory_state, warnings)

        # 5. Big unrealized gain at risk
        _check_profit_at_risk(provider, warnings)

        # 6. Staleness (same pattern 3 wakes)
        _check_staleness(daemon, warnings)

        # 7. Circuit breaker
        _check_circuit_breaker(daemon, warnings)

        # 8. Correlated positions
        _check_correlation(provider, warnings)

        # 9. Pending thought from last review
        thought_lines = _get_pending_thoughts(daemon)

        # Assemble output
        parts = []
        if warnings:
            parts.append("[Warnings]")
            for w in warnings:
                parts.append(f"- {w}")
        if thought_lines:
            parts.append("[Thought from last review]")
            for t in thought_lines:
                parts.append(f"- {t}")

        text = "\n".join(parts) if parts else ""
        return text, memory_state

    except Exception as e:
        logger.debug("Wake warnings failed: %s", e)
        return "", {}


# ====================================================================
# Shared Memory State Query
# ====================================================================

def _query_memory_state(nous_client) -> dict:
    """Consolidated Nous queries — shared by warnings AND coach.

    ALL queries filter lifecycle="ACTIVE" — fixes the stale data leak
    where the old coach returned dormant nodes.

    Cached with 5-min TTL to avoid 5 HTTP calls per wake cycle.

    Returns:
        {"watchpoints": [...], "theses": [...], "trade_entries": [...],
         "curiosity": [...], "lessons": [...], "thesis_symbols": set()}
    """
    global _memory_state_cache, _memory_state_cache_time
    now = time.time()
    if _memory_state_cache is not None and (now - _memory_state_cache_time) < _MEMORY_STATE_CACHE_TTL:
        return _memory_state_cache

    state = {
        "watchpoints": [],
        "theses": [],
        "trade_entries": [],
        "curiosity": [],
        "lessons": [],
        "thesis_symbols": set(),
    }

    if nous_client is None:
        return state

    # Watchpoints
    try:
        state["watchpoints"] = nous_client.list_nodes(
            subtype="custom:watchpoint", lifecycle="ACTIVE", limit=10,
        )
    except Exception:
        pass

    # Theses
    try:
        state["theses"] = nous_client.list_nodes(
            subtype="custom:thesis", lifecycle="ACTIVE", limit=10,
        )
        # Build thesis symbol set for trade linking check
        for t in state["theses"]:
            title = (t.get("content_title") or "").upper()
            sym = _extract_symbol_from_thesis(title)
            if sym:
                state["thesis_symbols"].add(sym)
    except Exception:
        pass

    # Trade entries
    try:
        state["trade_entries"] = nous_client.list_nodes(
            subtype="custom:trade_entry", lifecycle="ACTIVE", limit=10,
        )
    except Exception:
        pass

    # Curiosity items
    try:
        state["curiosity"] = nous_client.list_nodes(
            subtype="custom:curiosity", lifecycle="ACTIVE", limit=10,
        )
    except Exception:
        pass

    # Lessons (for coach — not used by warnings)
    try:
        state["lessons"] = nous_client.list_nodes(
            subtype="custom:lesson", lifecycle="ACTIVE", limit=5,
        )
    except Exception:
        pass

    _memory_state_cache = state
    _memory_state_cache_time = time.time()
    return state


# ====================================================================
# Individual Checks
# ====================================================================

def _check_unlinked_trades(memory_state: dict, warnings: list):
    """Check 1: Trade entries without a matching thesis."""
    entries = memory_state.get("trade_entries", [])
    thesis_symbols = memory_state.get("thesis_symbols", set())

    for entry in entries:
        title = entry.get("content_title", "")
        symbol = _extract_symbol(title)
        if symbol and symbol not in thesis_symbols:
            warnings.append(f"Trade {symbol} has no linked thesis")


def _check_missing_protection(provider, warnings: list):
    """Check 2: Open positions without SL or TP."""
    if provider is None:
        return

    try:
        state = provider.get_user_state()
        positions = state.get("positions", [])
        if not positions:
            return

        trigger_map = _get_trigger_map(provider)
        for p in positions:
            coin = p["coin"]
            triggers = trigger_map.get(coin, {})
            missing = []
            if not triggers.get("sl"):
                missing.append("stop loss")
            if not triggers.get("tp"):
                missing.append("take profit")
            if missing:
                side = p["side"].upper()
                warnings.append(f"{coin} {side} has no {' or '.join(missing)}")
    except Exception as e:
        logger.debug("Protection check failed: %s", e)


def _check_no_watchpoints(provider, memory_state: dict, warnings: list):
    """Check 3: No watchpoints — always a problem."""
    watchpoints = memory_state.get("watchpoints", [])

    if not watchpoints:
        # Always warn — even with no positions, should be scanning the market
        try:
            if provider is None:
                warnings.append("0 watchpoints — set alerts for levels you're watching")
                return
            state = provider.get_user_state()
            positions = state.get("positions", [])
            if positions:
                warnings.append(f"0 watchpoints with {len(positions)} open position{'s' if len(positions) != 1 else ''} — set SL/TP alerts and market scans")
            else:
                warnings.append("0 watchpoints and 0 positions — scan the market and set alerts for potential setups")
        except Exception:
            warnings.append("0 watchpoints — set alerts for levels you're watching")
        return

    # Have watchpoints — check if they only cover position symbols (tunnel vision)
    try:
        if provider is None:
            return
        state = provider.get_user_state()
        positions = state.get("positions", [])
        if not positions:
            return  # No positions — any watchpoints are fine

        # Get symbols from watchpoints (check title for coin mentions)
        wp_symbols = set()
        for wp in watchpoints:
            title = (wp.get("content_title") or "").upper()
            for sym in ("BTC", "ETH", "SOL", "HYPE", "DOGE", "ARB", "OP", "SUI",
                        "AVAX", "LINK", "MATIC", "XRP", "ADA", "DOT", "NEAR",
                        "APT", "FTM", "ATOM", "UNI", "AAVE"):
                if sym in title:
                    wp_symbols.add(sym)

        pos_symbols = {p["coin"].upper() for p in positions}

        # All watchpoints only cover position symbols — no market-wide alerts
        if wp_symbols and wp_symbols.issubset(pos_symbols) and len(positions) > 0:
            other_majors = {"BTC", "ETH", "SOL"} - pos_symbols
            if other_majors:
                warnings.append(f"Watchpoints only cover your positions — add alerts for {', '.join(sorted(other_majors))}")
    except Exception:
        pass


def _check_profit_at_risk(provider, warnings: list):
    """Check 5: Position with big unrealized gain — tighten stop or take profit.

    Uses leverage-aware thresholds: high leverage (scalps) trigger at lower ROE,
    low leverage (swings) trigger at higher ROE — matching the daemon's profit monitor.
    """
    if provider is None:
        return
    try:
        from .daemon import Daemon
        state = provider.get_user_state()
        for p in state.get("positions", []):
            ret_pct = p.get("return_pct", 0)
            coin = p["coin"]
            leverage = p.get("leverage", 20)
            nudge, take, _urgent, _ = Daemon._profit_thresholds(leverage)
            if ret_pct >= take:
                warnings.append(f"{coin} is up {ret_pct:.1f}% — that's exceptional. Tighten stop or take profit NOW.")
            elif ret_pct >= nudge:
                warnings.append(f"{coin} is up {ret_pct:.1f}% — tighten stop to lock in gains")
    except Exception:
        pass


def _check_stale_curiosity(memory_state: dict, warnings: list):
    """Check 4: Curiosity items older than 3 days."""
    for item in memory_state.get("curiosity", []):
        title = item.get("content_title", "Untitled")
        created = item.get("created_at", "")
        if not created:
            continue

        age_days = _age_in_days(created)
        if age_days is not None and age_days >= 3:
            warnings.append(f'"{title}" is {age_days}d old — research or archive')


def _check_staleness(daemon, warnings: list):
    """Check 5: Same tool+mutation pattern in last 3 wakes."""
    if daemon is None:
        return

    fingerprints = getattr(daemon, "_wake_fingerprints", [])
    if len(fingerprints) < 3:
        return

    recent = fingerprints[-3:]
    # All 3 must be identical and non-empty
    if recent[0] and recent[0] == recent[1] == recent[2]:
        warnings.append("Same tools in last 3 wakes — try different approach")


def _check_circuit_breaker(daemon, warnings: list):
    """Check 6: Circuit breaker is active."""
    if daemon is None:
        return

    if getattr(daemon, "_trading_paused", False):
        pnl = getattr(daemon, "_daily_realized_pnl", 0)
        warnings.append(f"Circuit breaker active (${pnl:+.0f} today) — no new entries")


_CORRELATION_GROUPS = [
    {"BTC", "ETH"},        # ~0.85
    {"ETH", "SOL"},        # ~0.80
    {"BTC", "SOL"},        # ~0.75
    {"ETH", "ARB", "OP"},  # L2s
    {"SOL", "SUI", "APT"}, # Alt-L1s
]


def _check_correlation(provider, warnings: list):
    """Check 8: Multiple same-direction positions in correlated assets."""
    if provider is None:
        return
    try:
        state = provider.get_user_state()
        positions = state.get("positions", [])
        if len(positions) < 2:
            return

        pos_by_coin = {p["coin"].upper(): p["side"] for p in positions}

        warned = set()
        for group in _CORRELATION_GROUPS:
            in_group = group & set(pos_by_coin.keys())
            if len(in_group) < 2:
                continue
            # Check if same direction
            sides = {pos_by_coin[c] for c in in_group}
            if len(sides) == 1:
                key = frozenset(in_group)
                if key not in warned:
                    warned.add(key)
                    direction = sides.pop().upper()
                    coins = ", ".join(sorted(in_group))
                    warnings.append(
                        f"Correlated positions: {coins} all {direction} — "
                        f"one move could hit both. Consider reducing exposure."
                    )
    except Exception as e:
        logger.debug("Correlation check failed: %s", e)


def _get_pending_thoughts(daemon) -> list[str]:
    """Check 9: Pending thoughts from Haiku's last review."""
    if daemon is None:
        return []
    thoughts = getattr(daemon, "_pending_thoughts", [])
    return list(thoughts)  # Copy — daemon clears after injection


# ====================================================================
# Helper Functions (moved from coach.py)
# ====================================================================

def _extract_symbol(title: str) -> str | None:
    """Extract trading symbol from trade entry title like 'LONG HYPE @ $30'."""
    parts = title.upper().split()
    if len(parts) >= 2 and parts[0] in ("LONG", "SHORT"):
        return parts[1]
    return None


def _extract_symbol_from_thesis(title: str) -> str | None:
    """Extract a symbol from a thesis title. Checks common crypto symbols."""
    title_upper = title.upper()
    for sym in ("BTC", "ETH", "SOL", "HYPE", "DOGE", "ARB", "OP", "SUI",
                "AVAX", "LINK", "MATIC", "XRP", "ADA", "DOT", "NEAR",
                "APT", "FTM", "ATOM", "UNI", "AAVE"):
        if sym in title_upper:
            return sym
    return None


def _format_age(iso_timestamp: str) -> str:
    """Format an ISO timestamp as a human-readable age (e.g. '3d ago')."""
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


def _age_in_days(iso_timestamp: str) -> int | None:
    """Return age in days from an ISO timestamp, or None on failure."""
    try:
        created = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        return (now - created).days
    except Exception:
        return None


def _get_trigger_map(provider) -> dict:
    """Build {coin: {"sl": price, "tp": price}} from trigger orders."""
    result = {}
    try:
        triggers = provider.get_trigger_orders()
        for t in triggers:
            coin = t["coin"]
            if coin not in result:
                result[coin] = {}
            otype = t.get("order_type", "")
            px = t.get("trigger_px")
            if px:
                if otype == "stop_loss":
                    result[coin]["sl"] = px
                elif otype == "take_profit":
                    result[coin]["tp"] = px
    except Exception as e:
        logger.debug("Trigger map fetch failed: %s", e)
    return result


# ====================================================================
# Format memory state for coach prompt
# ====================================================================

def format_memory_state(memory_state: dict) -> str:
    """Format the shared memory state dict as compact text for the coach.

    Used by coach.evaluate() to avoid re-querying Nous.
    """
    sections = []

    # Watchpoints
    watchpoints = memory_state.get("watchpoints", [])
    if watchpoints:
        lines = [f"Watchpoints ({len(watchpoints)} active):"]
        for wp in watchpoints:
            lines.append(f"  - {wp.get('content_title', 'Untitled')}")
        sections.append("\n".join(lines))
    else:
        sections.append("Watchpoints: 0 active")

    # Theses
    theses = memory_state.get("theses", [])
    if theses:
        lines = [f"Thesis Notes ({len(theses)} active):"]
        for t in theses:
            lines.append(f"  - {t.get('content_title', 'Untitled')}")
        sections.append("\n".join(lines))
    else:
        sections.append("Thesis Notes: 0 active")

    # Trade entries with thesis gap detection
    entries = memory_state.get("trade_entries", [])
    thesis_symbols = memory_state.get("thesis_symbols", set())
    if entries:
        lines = [f"Trade Entries ({len(entries)} active):"]
        for entry in entries:
            title = entry.get("content_title", "Untitled")
            symbol = _extract_symbol(title)
            has_thesis = symbol in thesis_symbols if symbol else True
            flag = "" if has_thesis else " (no thesis)"
            lines.append(f"  - {title}{flag}")
        sections.append("\n".join(lines))

    # Curiosity
    curiosity = memory_state.get("curiosity", [])
    if curiosity:
        lines = [f"Curiosity ({len(curiosity)} pending):"]
        for c in curiosity:
            title = c.get("content_title", "Untitled")
            created = c.get("created_at", "")
            age_str = _format_age(created) if created else ""
            lines.append(f"  - {title}{f' ({age_str})' if age_str else ''}")
        sections.append("\n".join(lines))

    # Lessons
    lessons = memory_state.get("lessons", [])
    if lessons:
        lines = ["Recent Lessons:"]
        for l in lessons:
            lines.append(f"  - {l.get('content_title', 'Untitled')}")
        sections.append("\n".join(lines))

    return "\n\n".join(sections) if sections else "No memory data available"
