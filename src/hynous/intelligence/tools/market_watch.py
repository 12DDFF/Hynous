"""
Market Watch Tools

Two tools for chain-of-thought signal validation:

  get_book_history  — reads scanner's rolling L2 buffer (zero API cost)
  monitor_signal    — schedules a short follow-up wake to re-check a developing setup
"""

import time

# =============================================================================
# get_book_history
# =============================================================================

GET_BOOK_HISTORY_TOOL_DEF = {
    "name": "get_book_history",
    "description": (
        "Show the L2 orderbook imbalance trend for a symbol over the last N snapshots (~60s each).\n"
        "Use during scanner validation to check if a book_flip signal is persistent (real) "
        "or a brief spike (noise). Reads from the scanner's rolling buffer — zero API cost.\n\n"
        "Returns: per-snapshot bid/ask depth + imbalance, plus a trend summary."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Asset symbol, e.g. 'BTC'"},
            "n": {"type": "integer", "description": "Snapshots to show (2-10, default 5)"},
        },
        "required": ["symbol"],
    },
}


def handle_get_book_history(symbol: str, n: int = 5) -> str:
    from ...intelligence.daemon import get_active_daemon
    daemon = get_active_daemon()
    scanner = getattr(daemon, "_scanner", None) if daemon else None
    if not scanner or len(scanner._books) == 0:
        return f"No book history available for {symbol} — scanner buffer empty."

    n = max(2, min(int(n), 10, len(scanner._books)))
    # oldest → newest: nth_back(n-1) is oldest, nth_back(0) is newest
    snaps = [scanner._books.nth_back(n - 1 - i) for i in range(n)]

    sym = symbol.upper()
    rows = []
    valid_imbs = []
    for i, snap in enumerate(snaps):
        age_label = "NOW" if i == n - 1 else f"-{(n - 1 - i)}m"
        if snap is None:
            rows.append(f"  [{age_label}]: no data")
            continue
        b = snap.books.get(sym)
        if not b:
            rows.append(f"  [{age_label}]: {sym} not tracked")
            continue
        bid = b["bid_depth_usd"]
        ask = b["ask_depth_usd"]
        imb = b["imbalance"]
        valid_imbs.append(imb)
        bias = "BID-heavy" if imb > 0.58 else "ASK-heavy" if imb < 0.42 else "balanced"
        rows.append(
            f"  [{age_label}]: bids ${bid:,.0f} · asks ${ask:,.0f} · "
            f"imb {imb:.2f} ({bias})"
        )

    if len(valid_imbs) >= 2:
        delta = valid_imbs[-1] - valid_imbs[0]  # newest minus oldest
        trend = (
            f"bids recovering (+{delta:.2f})" if delta > 0.05 else
            f"asks recovering ({delta:.2f})" if delta < -0.05 else
            f"stable ({delta:+.2f})"
        )
        consistent_ask = sum(1 for x in valid_imbs if x < 0.42)
        consistent_bid = sum(1 for x in valid_imbs if x > 0.58)
        persist = (
            f"{consistent_ask}/{len(valid_imbs)} snapshots ask-heavy"
            if consistent_ask > consistent_bid
            else f"{consistent_bid}/{len(valid_imbs)} snapshots bid-heavy"
        )
        rows.append(f"\n  Trend: {trend} | Persistence: {persist}")

    return f"{sym} book history (last {n} snapshots, ~1 min apart):\n" + "\n".join(rows)


# =============================================================================
# monitor_signal
# =============================================================================

MONITOR_SIGNAL_TOOL_DEF = {
    "name": "monitor_signal",
    "description": (
        "Schedule a follow-up monitoring session for a developing scanner signal.\n\n"
        "Use when: a signal looks interesting but needs more time to confirm "
        "(e.g. book flip that might recover, momentum that might stall).\n"
        "You'll be woken in delay_s seconds with fresh orderbook + price data "
        "and your original thesis preserved in context.\n\n"
        "DIFFERENT from manage_watchpoints:\n"
        "  - watchpoints: persistent threshold alerts stored in memory (price_above $X, funding_below Y%)\n"
        "  - monitor_signal: single short-duration recheck (30-180s) for an active developing setup\n\n"
        "Typical: 'book flip looks real but CVD is mixed — watch 60s before committing.'\n"
        "Max delay: 180s. Only one active watch per symbol (new call overwrites old)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol":  {"type": "string",  "description": "Asset to monitor"},
            "delay_s": {"type": "integer", "description": "Seconds until follow-up (30-180)"},
            "thesis":  {"type": "string",  "description": "What you're watching for"},
            "side":    {
                "type": "string",
                "description": "Side you'd take if confirmed: 'long' or 'short'",
                "enum": ["long", "short"],
            },
        },
        "required": ["symbol", "delay_s", "thesis"],
    },
}


def handle_monitor_signal(
    symbol: str,
    delay_s: int,
    thesis: str,
    side: str | None = None,
) -> str:
    from ...intelligence.daemon import get_active_daemon
    daemon = get_active_daemon()
    if not daemon:
        return "Daemon not running — cannot schedule follow-up."
    delay_s = max(30, min(int(delay_s), 180))
    # Validate side — only "long" or "short" are meaningful
    if side and side not in ("long", "short"):
        side = None
    now = time.time()
    sym = symbol.upper()
    daemon._pending_watches[sym] = {
        "scheduled_at": now,
        "fire_at": now + delay_s,
        "thesis": thesis,
        "side": side or "",
    }
    side_note = f" [{side}]" if side else ""
    return f"Monitoring {sym}{side_note} — follow-up in {delay_s}s. Thesis: {thesis}"


# =============================================================================
# Register
# =============================================================================

def register(registry) -> None:
    from .registry import Tool

    registry.register(Tool(
        name="get_book_history",
        description=GET_BOOK_HISTORY_TOOL_DEF["description"],
        parameters=GET_BOOK_HISTORY_TOOL_DEF["parameters"],
        handler=handle_get_book_history,
    ))

    registry.register(Tool(
        name="monitor_signal",
        description=MONITOR_SIGNAL_TOOL_DEF["description"],
        parameters=MONITOR_SIGNAL_TOOL_DEF["parameters"],
        handler=handle_monitor_signal,
    ))
