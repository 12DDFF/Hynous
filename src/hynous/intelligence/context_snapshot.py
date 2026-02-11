"""
Context Snapshot — Live state injected into every agent message.

Builds a compact (~150 token) text block with portfolio, positions, market,
and memory state. Eliminates the need for the agent to burn tool calls just
to see its own state.

Data sources (all zero/low cost):
  - provider.get_user_state() → 1 HTTP call (~50ms)
  - provider.get_trigger_orders() → per position SL/TP
  - daemon.snapshot → cached prices, funding, F&G (zero cost)
  - daemon daily PnL + circuit breaker (zero cost)
  - daemon cached counts OR nous.list_nodes() fallback

Pure function — no class, no state (except TTL cache). Safe — never raises.
"""

import logging
import time

logger = logging.getLogger(__name__)

# --- Snapshot TTL cache ---
_snapshot_cache: str | None = None
_snapshot_cache_time: float = 0
_SNAPSHOT_TTL = 30  # seconds


def build_snapshot(provider, daemon, nous_client, config) -> str:
    """Build compact live state text (~150 tokens). Safe — never raises.

    Results are cached for 30 seconds. Portfolio data changes slowly —
    positions don't open/close multiple times per second.

    Args:
        provider: HyperliquidProvider or PaperProvider (can be None).
        daemon: Daemon instance (can be None if not running).
        nous_client: NousClient instance (can be None).
        config: Config instance.

    Returns:
        Multi-line text block for injection, or empty string on total failure.
    """
    global _snapshot_cache, _snapshot_cache_time

    now = time.time()
    if _snapshot_cache is not None and (now - _snapshot_cache_time) < _SNAPSHOT_TTL:
        return _snapshot_cache

    sections = []

    # --- Portfolio + Positions ---
    portfolio_line = _build_portfolio(provider, daemon, config)
    if portfolio_line:
        sections.append(portfolio_line)

    # --- Market data from daemon snapshot ---
    market_line = _build_market(daemon, config)
    if market_line:
        sections.append(market_line)

    # --- Memory counts (prefer daemon cache, fallback to Nous) ---
    memory_line = _build_memory_counts(nous_client, daemon)
    if memory_line:
        sections.append(memory_line)

    # --- Trade activity (zero cost, daemon in-memory counters) ---
    activity_line = _build_activity(daemon)
    if activity_line:
        sections.append(activity_line)

    result = "\n".join(sections)
    _snapshot_cache = result
    _snapshot_cache_time = now
    return result


def invalidate_snapshot():
    """Call after trades or position changes to force refresh."""
    global _snapshot_cache
    _snapshot_cache = None


def extract_symbols(snapshot: str) -> list[str]:
    """Extract position symbols from a snapshot string.

    Matches position lines like "  HYPE LONG @ $30 -> $31..."
    Returns e.g. ['HYPE', 'ETH'].
    """
    symbols = []
    for line in snapshot.splitlines():
        line = line.strip()
        if not line or not line[0].isalpha():
            continue
        # Position lines have the pattern: SYMBOL LONG/SHORT @ ...
        parts = line.split()
        if len(parts) >= 2 and parts[1] in ("LONG", "SHORT"):
            symbols.append(parts[0])
    return symbols


def _build_portfolio(provider, daemon, config) -> str:
    """Portfolio value + open positions with SL/TP."""
    if provider is None:
        return "Portfolio: unavailable (no provider)"

    try:
        state = provider.get_user_state()
    except Exception as e:
        logger.debug("Snapshot: portfolio fetch failed: %s", e)
        return "Portfolio: unavailable"

    acct = state["account_value"]
    unrealized = state["unrealized_pnl"]

    # Calculate return % from initial balance
    initial = config.execution.paper_balance if config else 1000
    ret_pct = ((acct - initial) / initial * 100) if initial > 0 else 0

    # Daily PnL from daemon (if running)
    daily_pnl = ""
    if daemon is not None:
        dpnl = daemon._daily_realized_pnl
        daily_pnl = f" | Daily PnL: {'+' if dpnl >= 0 else ''}${dpnl:.0f}"
        if daemon._trading_paused:
            daily_pnl += " [CIRCUIT BREAKER]"

    header = (
        f"Portfolio: ${acct:,.0f} ({ret_pct:+.1f}%) | "
        f"Unrealized: {'+' if unrealized >= 0 else ''}${unrealized:.0f}"
        f"{daily_pnl}"
    )

    positions = state.get("positions", [])
    if not positions:
        return header

    # Build position lines with SL/TP from trigger orders
    trigger_map = _get_trigger_map(provider, positions)
    lines = [header]
    for p in positions:
        coin = p["coin"]
        side = p["side"].upper()
        entry = p["entry_px"]
        mark = p["mark_px"]
        pnl_pct = p["return_pct"]
        pnl_usd = p["unrealized_pnl"]

        pos_str = (
            f"  {coin} {side} @ ${entry:,.0f} -> ${mark:,.0f} "
            f"({pnl_pct:+.1f}%, {'+' if pnl_usd >= 0 else ''}${pnl_usd:.0f})"
        )

        # Append SL/TP if known
        triggers = trigger_map.get(coin, {})
        sl = triggers.get("sl")
        tp = triggers.get("tp")
        if sl or tp:
            parts = []
            if sl:
                parts.append(f"SL ${sl:,.0f}")
            if tp:
                parts.append(f"TP ${tp:,.0f}")
            pos_str += f" | {' '.join(parts)}"

        lines.append(pos_str)

    return "\n".join(lines)


def _get_trigger_map(provider, positions: list) -> dict:
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
        logger.debug("Snapshot: trigger orders fetch failed: %s", e)
    return result


def _build_market(daemon, config) -> str:
    """Market prices + funding + F&G from daemon's cached snapshot."""
    if daemon is None or not daemon.snapshot.prices:
        return "Market: use get_market_data for current prices"

    snap = daemon.snapshot
    symbols = config.execution.symbols if config else []

    parts = []
    for sym in symbols:
        price = snap.prices.get(sym)
        if price:
            # Compact format: BTC $97.2K
            if price >= 1000:
                parts.append(f"{sym} ${price / 1000:.1f}K")
            else:
                parts.append(f"{sym} ${price:,.0f}")

    # Add BTC funding if available
    btc_funding = snap.funding.get("BTC")
    if btc_funding is not None:
        parts.append(f"BTC Funding: {btc_funding:+.3%}")

    # Fear & Greed
    fg = snap.fear_greed
    if fg > 0:
        label = _fg_label(fg)
        parts.append(f"F&G: {fg} ({label})")

    return f"Market: {' | '.join(parts)}" if parts else ""


def _build_memory_counts(nous_client, daemon=None) -> str:
    """Counts of active watchpoints, theses, and pending curiosity items.

    If daemon is running, uses its cached counts (zero HTTP calls).
    Falls back to querying Nous directly.
    """
    # Fast path: daemon has cached counts
    if daemon is not None:
        counts = {}
        wp_count = getattr(daemon, '_active_watchpoint_count', None)
        if wp_count is not None:
            counts["watchpoints"] = wp_count
        thesis_count = getattr(daemon, '_active_thesis_count', None)
        if thesis_count is not None:
            counts["theses"] = thesis_count
        curiosity_count = getattr(daemon, '_pending_curiosity_count', None)
        if curiosity_count is not None:
            counts["curiosity pending"] = curiosity_count

        # If daemon has all 3 counts, skip Nous entirely
        if len(counts) == 3:
            parts = [f"{v} {k}" for k, v in counts.items()]
            return f"Memory: {' | '.join(parts)}"

    # Slow path: query Nous directly
    if nous_client is None:
        return ""

    counts = {}
    for subtype, label in [
        ("custom:watchpoint", "watchpoints"),
        ("custom:thesis", "theses"),
        ("custom:curiosity", "curiosity pending"),
    ]:
        try:
            items = nous_client.list_nodes(
                subtype=subtype,
                lifecycle="ACTIVE",
                limit=50,
            )
            counts[label] = len(items)
        except Exception:
            pass

    if not counts:
        return ""

    parts = [f"{v} {k}" for k, v in counts.items()]
    return f"Memory: {' | '.join(parts)}"


def _build_activity(daemon) -> str:
    """Trade activity stats — zero cost, uses daemon in-memory counters."""
    if daemon is None:
        return ""

    today = getattr(daemon, '_entries_today', 0)
    week = getattr(daemon, '_entries_this_week', 0)
    last = getattr(daemon, 'last_trade_ago', "never")

    return f"Activity: {today} entries today, {week} this week | Last trade: {last} ago"


def _fg_label(value: int) -> str:
    """Human label for Fear & Greed index."""
    if value <= 20:
        return "Extreme Fear"
    elif value <= 40:
        return "Fear"
    elif value <= 60:
        return "Neutral"
    elif value <= 80:
        return "Greed"
    else:
        return "Extreme Greed"
