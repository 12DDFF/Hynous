"""
Trade Analytics — Performance tracking from Nous trade_close nodes.

Queries Nous for closed trades, parses structured JSON, computes stats.
Module-level 30s cache to avoid hammering Nous on repeated calls.

Cost: zero LLM tokens (pure Python + Nous HTTP).
"""

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Module-level cache
_cached_stats: "TradeStats | None" = None
_cache_time: float = 0
_CACHE_TTL = 30  # seconds


@dataclass
class TradeRecord:
    """One closed trade parsed from Nous."""
    symbol: str
    side: str           # "long" or "short"
    entry_px: float
    exit_px: float
    pnl_usd: float
    pnl_pct: float
    close_type: str     # "full", "50% partial", etc.
    closed_at: str      # ISO timestamp
    size_usd: float = 0.0
    duration_hours: float = 0.0
    thesis: str = ""    # entry thesis from linked trade_entry node
    trade_type: str = "macro"  # "micro" or "macro"
    fee_loss:      bool  = False   # directionally correct but fees ate profit
    fee_heavy:     bool  = False   # fees took >50% of gross profit
    fee_estimate:  float = 0.0    # estimated round-trip fees in USD
    pnl_gross:     float = 0.0    # raw PnL before fees
    lev_return_pct: float = 0.0   # net leveraged ROE % (pnl_net / margin * 100)
    mfe_usd:        float = 0.0   # peak dollar value (mfe_pct / 100 * margin)
    leverage:       int   = 0     # position leverage; 0 = unknown


@dataclass
class TradeStats:
    """Aggregate performance statistics."""
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    fee_losses: int = 0       # directionally correct but net negative from fees
    fee_heavy_count: int = 0  # fees took >50% of gross profit
    total_fees: float = 0.0   # sum of estimated round-trip fees in USD
    win_rate: float = 0.0
    total_pnl: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    profit_factor: float = 0.0
    best_trade: float = 0.0
    worst_trade: float = 0.0
    current_streak: int = 0       # positive = win streak, negative = loss streak
    max_win_streak: int = 0
    max_loss_streak: int = 0
    avg_duration_hours: float = 0.0
    by_symbol: dict = field(default_factory=dict)
    trades: list[TradeRecord] = field(default_factory=list)


def fetch_trade_history(
    nous_client=None,
    limit: int = 500,
    created_after: str | None = None,
    created_before: str | None = None,
) -> list[TradeRecord]:
    """Query Nous for trade_close nodes and parse into TradeRecords."""
    if nous_client is None:
        from ..nous.client import get_client
        nous_client = get_client()

    try:
        nodes = nous_client.list_nodes(
            subtype="custom:trade_close",
            limit=limit,
            created_after=created_after,
            created_before=created_before,
        )
    except Exception as e:
        logger.debug("Failed to fetch trade_close nodes: %s", e)
        return []

    records = []
    for node in nodes:
        try:
            record = _parse_trade_node(node, nous_client)
            if record:
                records.append(record)
        except Exception as e:
            logger.debug("Failed to parse trade node %s: %s", node.get("id", "?"), e)

    # Sort by close date (newest first)
    records.sort(key=lambda r: r.closed_at, reverse=True)
    return records


def _parse_trade_node(node: dict, nous_client) -> TradeRecord | None:
    """Parse a trade_close node into a TradeRecord."""
    body_raw = node.get("content_body", "")
    if not body_raw:
        return None

    try:
        body = json.loads(body_raw)
    except (json.JSONDecodeError, TypeError):
        return None

    signals = body.get("signals", {})
    action = signals.get("action", "")
    if not signals or action not in ("close", "partial_close"):
        return None

    symbol = signals.get("symbol", "")
    side = signals.get("side", "")
    entry_px = float(signals.get("entry", 0))
    exit_px = float(signals.get("exit", 0))
    pnl_usd        = float(signals.get("pnl_usd", 0))
    pnl_pct        = float(signals.get("pnl_pct", 0))
    lev_return_pct = float(signals.get("lev_return_pct", 0.0))
    margin_used    = float(signals.get("margin_used", 0.0))
    leverage_stored = int(signals.get("leverage", 0))
    mfe_pct_raw    = float(signals.get("mfe_pct", 0.0))
    mfe_usd        = float(signals.get("mfe_usd", 0.0))

    # Fallback 1: derive lev_return_pct from stored margin_used
    if lev_return_pct == 0.0 and margin_used > 0 and pnl_usd != 0.0:
        lev_return_pct = round(pnl_usd / margin_used * 100, 2)
    # Fallback 2: derive from stored leverage + size_usd (older signals)
    if lev_return_pct == 0.0 and leverage_stored > 0 and size_usd > 0 and pnl_usd != 0.0:
        lev_return_pct = round(pnl_usd / (size_usd / leverage_stored) * 100, 2)

    # Derive mfe_usd from mfe_pct * implied_margin when not stored directly
    # mfe_usd = mfe_pct/100 * margin = mfe_pct * pnl_usd / lev_return_pct (same margin base)
    if mfe_usd == 0.0 and mfe_pct_raw > 0 and lev_return_pct != 0.0 and pnl_usd != 0.0:
        mfe_usd = round(mfe_pct_raw * pnl_usd / lev_return_pct, 2)
    close_type = signals.get("close_type", "full")
    size_usd = float(signals.get("size_usd", 0))
    trade_type = signals.get("trade_type", "macro")

    if not symbol or not entry_px:
        return None

    closed_at = node.get("created_at", "")

    # Enrich from linked entry node (duration + thesis + trade_type fallback)
    enrichment = _enrich_from_entry(node, nous_client, closed_at)

    # If close node didn't have trade_type, try entry node enrichment
    if trade_type == "macro" and enrichment.get("trade_type"):
        trade_type = enrichment["trade_type"]

    # Fee fields: stored flags + estimates
    fee_heavy    = bool(signals.get("fee_heavy", False))
    fee_estimate = float(signals.get("fee_estimate", 0.0))
    pnl_gross    = float(signals.get("pnl_gross", 0.0))

    # Fee loss: either from stored flag or inferred (gross > 0 but net < 0)
    fee_loss = bool(signals.get("fee_loss", False))
    if not fee_loss:
        if pnl_gross > 0 and pnl_usd < 0:
            fee_loss = True

    return TradeRecord(
        symbol=symbol,
        side=side,
        entry_px=entry_px,
        exit_px=exit_px,
        pnl_usd=pnl_usd,
        pnl_pct=pnl_pct,
        close_type=close_type,
        closed_at=closed_at,
        size_usd=size_usd,
        duration_hours=enrichment["duration_hours"],
        thesis=enrichment["thesis"],
        trade_type=trade_type,
        fee_loss=fee_loss,
        fee_heavy=fee_heavy,
        fee_estimate=fee_estimate,
        pnl_gross=pnl_gross,
        lev_return_pct=lev_return_pct,
        mfe_usd=mfe_usd,
        leverage=leverage_stored,
    )


def _enrich_from_entry(close_node: dict, nous_client, closed_at: str) -> dict:
    """Find the linked entry node and extract duration + thesis + trade_type."""
    result = {"duration_hours": 0.0, "thesis": "", "trade_type": ""}

    entry_node = None
    try:
        node_id = close_node.get("id")
        if not node_id:
            return result

        # Try 1: follow part_of edge
        edges = nous_client.get_edges(node_id, direction="in")
        for edge in edges:
            if edge.get("type") == "part_of":
                source_id = edge.get("source_id")
                if source_id:
                    entry_node = nous_client.get_node(source_id)
                    if entry_node:
                        break

        # Try 2: list_nodes fallback (edges may not exist — search was broken before)
        if not entry_node:
            try:
                body_fb = json.loads(close_node.get("content_body", "{}"))
                symbol = body_fb.get("signals", {}).get("symbol", "")
                if symbol:
                    candidates = nous_client.list_nodes(
                        subtype="custom:trade_entry",
                        created_before=closed_at if closed_at else None,
                        limit=10,
                    )
                    for candidate in candidates:
                        title = candidate.get("content_title", "")
                        if symbol.upper() in title.upper():
                            entry_node = candidate
                            break
            except Exception:
                pass

        if entry_node:
            # Duration from entry node created_at → close node created_at
            entry_time = entry_node.get("created_at", "")
            if entry_time and closed_at:
                result["duration_hours"] = _hours_between(entry_time, closed_at)

            # Thesis + trade_type — extract from entry node body
            body_raw = entry_node.get("content_body", "")
            try:
                body = json.loads(body_raw)
                text = body.get("text", "")
                # _store_trade_memory formats as "Thesis: ...\nEntry: ...\n..."
                for line in text.split("\n"):
                    if line.startswith("Thesis: "):
                        result["thesis"] = line[len("Thesis: "):]
                        break
                # Fallback: use first line if no "Thesis:" prefix
                if not result["thesis"] and text:
                    result["thesis"] = text.split("\n")[0][:200]
                # Trade type from entry signals
                entry_signals = body.get("signals", {})
                if entry_signals.get("trade_type"):
                    result["trade_type"] = entry_signals["trade_type"]
            except (json.JSONDecodeError, TypeError):
                if body_raw:
                    result["thesis"] = body_raw.split("\n")[0][:200]
    except Exception:
        pass

    # Fallback duration from signals.opened_at
    if result["duration_hours"] == 0.0:
        try:
            body = json.loads(close_node.get("content_body", "{}"))
            signals = body.get("signals", {})
            opened_at = signals.get("opened_at", "")
            if opened_at and closed_at:
                result["duration_hours"] = _hours_between(opened_at, closed_at)
        except Exception:
            pass

    return result


def _hours_between(start_iso: str, end_iso: str) -> float:
    """Calculate hours between two ISO timestamps."""
    try:
        start = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        end = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
        delta = end - start
        return max(delta.total_seconds() / 3600, 0)
    except Exception:
        return 0.0


def _merge_partial_trades(trades: list[TradeRecord]) -> list[TradeRecord]:
    """Merge partial exits of the same position into a single trade."""
    merged: dict[tuple, TradeRecord] = {}
    for t in trades:
        key = (t.symbol, t.side, t.entry_px, t.trade_type)
        if key not in merged:
            merged[key] = TradeRecord(
                symbol=t.symbol, side=t.side, entry_px=t.entry_px,
                exit_px=t.exit_px, pnl_usd=t.pnl_usd, pnl_pct=t.pnl_pct,
                close_type=t.close_type, closed_at=t.closed_at,
                size_usd=t.size_usd, duration_hours=t.duration_hours,
                thesis=t.thesis, trade_type=t.trade_type,
                fee_loss=t.fee_loss, fee_heavy=t.fee_heavy,
                fee_estimate=t.fee_estimate, pnl_gross=t.pnl_gross,
                lev_return_pct=t.lev_return_pct, mfe_usd=t.mfe_usd,
                leverage=t.leverage,
            )
        else:
            m = merged[key]
            old_size = m.size_usd
            total_size = old_size + t.size_usd
            if total_size > 0:
                m.exit_px = round((m.exit_px * old_size + t.exit_px * t.size_usd) / total_size, 6)
                # pnl_pct = price move %, computed from entry/exit (no leverage needed)
                if m.entry_px > 0:
                    direction = 1.0 if m.side == "long" else -1.0
                    m.pnl_pct = round(direction * (m.exit_px - m.entry_px) / m.entry_px * 100, 2)
                # lev_return_pct: weighted average by notional size
                m.lev_return_pct = round(
                    (m.lev_return_pct * old_size + t.lev_return_pct * t.size_usd) / total_size, 2
                )
            m.pnl_usd = round(m.pnl_usd + t.pnl_usd, 2)
            m.size_usd = round(total_size, 2)
            m.closed_at = max(m.closed_at, t.closed_at)
            m.close_type = "merged"
            m.duration_hours = max(m.duration_hours, t.duration_hours)
            # Aggregate fee fields across partial closes; peak is the max
            m.fee_estimate = round(m.fee_estimate + t.fee_estimate, 2)
            m.pnl_gross    = round(m.pnl_gross    + t.pnl_gross,    2)
            m.mfe_usd      = max(m.mfe_usd, t.mfe_usd)
            # Leverage is constant per position — keep first non-zero value
            if m.leverage == 0 and t.leverage > 0:
                m.leverage = t.leverage
            # Recompute flags on merged totals
            m.fee_loss  = m.pnl_gross > 0 and m.pnl_usd < 0
            m.fee_heavy = (not m.fee_loss) and m.pnl_gross > 0 and m.fee_estimate > m.pnl_gross * 0.5
    return sorted(merged.values(), key=lambda t: t.closed_at, reverse=True)


def compute_stats(trades: list[TradeRecord]) -> TradeStats:
    """Compute aggregate stats from trade records."""
    trades = _merge_partial_trades(trades)
    stats = TradeStats(trades=trades)
    if not trades:
        return stats

    stats.total_trades = len(trades)

    wins = [t for t in trades if t.pnl_usd > 0]
    losses = [t for t in trades if t.pnl_usd <= 0]
    stats.wins = len(wins)
    stats.losses = len(losses)
    stats.fee_losses      = sum(1 for t in trades if t.fee_loss)
    stats.fee_heavy_count = sum(1 for t in trades if t.fee_heavy)
    stats.total_fees      = round(sum(t.fee_estimate for t in trades), 2)
    stats.win_rate = (stats.wins / stats.total_trades * 100) if stats.total_trades > 0 else 0

    stats.total_pnl = sum(t.pnl_usd for t in trades)

    if wins:
        stats.avg_win = sum(t.pnl_usd for t in wins) / len(wins)
    if losses:
        stats.avg_loss = sum(t.pnl_usd for t in losses) / len(losses)

    gross_profit = sum(t.pnl_usd for t in wins)
    gross_loss = abs(sum(t.pnl_usd for t in losses))
    stats.profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else float('inf') if gross_profit > 0 else 0

    stats.best_trade = max(t.pnl_usd for t in trades)
    stats.worst_trade = min(t.pnl_usd for t in trades)

    # Streaks (trades sorted newest-first, so reverse for chronological)
    chronological = list(reversed(trades))
    current = 0
    max_win = 0
    max_loss = 0
    for t in chronological:
        if t.pnl_usd > 0:
            current = current + 1 if current > 0 else 1
            max_win = max(max_win, current)
        else:
            current = current - 1 if current < 0 else -1
            max_loss = min(max_loss, current)

    stats.current_streak = current
    stats.max_win_streak = max_win
    stats.max_loss_streak = abs(max_loss)

    # Average duration
    durations = [t.duration_hours for t in trades if t.duration_hours > 0]
    stats.avg_duration_hours = sum(durations) / len(durations) if durations else 0

    # Per-symbol breakdown
    by_sym: dict[str, dict] = {}
    for t in trades:
        sym = t.symbol
        if sym not in by_sym:
            by_sym[sym] = {"trades": 0, "wins": 0, "pnl": 0.0}
        by_sym[sym]["trades"] += 1
        if t.pnl_usd > 0:
            by_sym[sym]["wins"] += 1
        by_sym[sym]["pnl"] += t.pnl_usd

    for sym, data in by_sym.items():
        data["win_rate"] = round(data["wins"] / data["trades"] * 100, 1) if data["trades"] > 0 else 0
        data["pnl"] = round(data["pnl"], 2)

    stats.by_symbol = by_sym
    return stats


def get_trade_stats(
    nous_client=None,
    limit: int = 500,
    created_after: str | None = None,
    created_before: str | None = None,
) -> TradeStats:
    """Main entry point — cached for 30s (default queries only)."""
    global _cached_stats, _cache_time

    has_filters = created_after or created_before or limit != 500

    # Use cache for default (unfiltered) queries only
    if not has_filters:
        now = time.time()
        if _cached_stats is not None and (now - _cache_time) < _CACHE_TTL:
            return _cached_stats

    trades = fetch_trade_history(
        nous_client,
        limit=limit,
        created_after=created_after,
        created_before=created_before,
    )
    stats = compute_stats(trades)

    # Only cache unfiltered results
    if not has_filters:
        _cached_stats = stats
        _cache_time = time.time()

    return stats


def format_stats_compact(stats: TradeStats, account_pnl: float | None = None) -> str:
    """~80 token one-liner for briefing injection.

    account_pnl: real PnL from exchange (account_value - initial). If provided,
    used instead of Nous-recorded sum which may be incomplete.
    """
    if stats.total_trades == 0:
        return "Performance: No closed trades yet"

    pf_str = f"{stats.profit_factor:.1f}" if stats.profit_factor != float('inf') else "inf"

    # Use exchange truth if available, fall back to recorded sum
    pnl = account_pnl if account_pnl is not None else stats.total_pnl
    sign = "+" if pnl >= 0 else ""

    streak = ""
    if stats.current_streak > 1:
        streak = f", {stats.current_streak}W streak"
    elif stats.current_streak < -1:
        streak = f", {abs(stats.current_streak)}L streak"

    fee_note = ""
    if stats.fee_losses > 0:
        fee_note = f", {stats.fee_losses} fee losses (direction correct, fees ate profit)"

    return (
        f"Performance: {stats.total_trades} trades, "
        f"{stats.win_rate:.0f}% win, "
        f"{sign}${pnl:.2f}, "
        f"PF {pf_str}{streak}{fee_note}"
    )
