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


@dataclass
class TradeStats:
    """Aggregate performance statistics."""
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
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


def fetch_trade_history(nous_client=None) -> list[TradeRecord]:
    """Query Nous for trade_close nodes and parse into TradeRecords."""
    if nous_client is None:
        from ..nous.client import get_client
        nous_client = get_client()

    try:
        nodes = nous_client.list_nodes(
            subtype="custom:trade_close",
            limit=50,
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
    pnl_usd = float(signals.get("pnl_usd", 0))
    pnl_pct = float(signals.get("pnl_pct", 0))
    close_type = signals.get("close_type", "full")
    size_usd = float(signals.get("size_usd", 0))

    if not symbol or not entry_px:
        return None

    closed_at = node.get("created_at", "")

    # Try to find duration by matching entry node via part_of edges
    duration_hours = _find_duration(node, nous_client, closed_at)

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
        duration_hours=duration_hours,
    )


def _find_duration(close_node: dict, nous_client, closed_at: str) -> float:
    """Find trade duration by looking up the linked entry node."""
    try:
        node_id = close_node.get("id")
        if not node_id:
            return 0.0

        edges = nous_client.get_edges(node_id, direction="in")
        for edge in edges:
            if edge.get("type") == "part_of":
                source_id = edge.get("source_id")
                if source_id:
                    entry_node = nous_client.get_node(source_id)
                    if entry_node:
                        entry_time = entry_node.get("created_at", "")
                        if entry_time and closed_at:
                            return _hours_between(entry_time, closed_at)
    except Exception:
        pass

    # Fallback: check if opened_at is stored in the close node's signals
    try:
        body = json.loads(close_node.get("content_body", "{}"))
        signals = body.get("signals", {})
        opened_at = signals.get("opened_at", "")
        if opened_at and closed_at:
            return _hours_between(opened_at, closed_at)
    except Exception:
        pass
    return 0.0


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
        key = (t.symbol, t.side, t.entry_px)
        if key not in merged:
            merged[key] = TradeRecord(
                symbol=t.symbol, side=t.side, entry_px=t.entry_px,
                exit_px=t.exit_px, pnl_usd=t.pnl_usd, pnl_pct=t.pnl_pct,
                close_type=t.close_type, closed_at=t.closed_at,
                size_usd=t.size_usd, duration_hours=t.duration_hours,
            )
        else:
            m = merged[key]
            total_size = m.size_usd + t.size_usd
            if total_size > 0:
                m.exit_px = round((m.exit_px * m.size_usd + t.exit_px * t.size_usd) / total_size, 6)
            m.pnl_usd = round(m.pnl_usd + t.pnl_usd, 2)
            m.size_usd = round(total_size, 2)
            if m.entry_px > 0 and m.size_usd > 0:
                margin = m.size_usd / 10
                m.pnl_pct = round((m.pnl_usd / margin) * 100, 2) if margin > 0 else 0
            m.closed_at = max(m.closed_at, t.closed_at)
            m.close_type = "merged"
            m.duration_hours = max(m.duration_hours, t.duration_hours)
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


def get_trade_stats(nous_client=None) -> TradeStats:
    """Main entry point — cached for 30s."""
    global _cached_stats, _cache_time

    now = time.time()
    if _cached_stats is not None and (now - _cache_time) < _CACHE_TTL:
        return _cached_stats

    trades = fetch_trade_history(nous_client)
    stats = compute_stats(trades)
    _cached_stats = stats
    _cache_time = now
    return stats


def format_stats_compact(stats: TradeStats) -> str:
    """~80 token one-liner for briefing injection."""
    if stats.total_trades == 0:
        return "Performance: No closed trades yet"

    pf_str = f"{stats.profit_factor:.1f}" if stats.profit_factor != float('inf') else "inf"
    sign = "+" if stats.total_pnl >= 0 else ""
    streak = ""
    if stats.current_streak > 1:
        streak = f", {stats.current_streak}W streak"
    elif stats.current_streak < -1:
        streak = f", {abs(stats.current_streak)}L streak"

    return (
        f"Performance: {stats.total_trades} trades, "
        f"{stats.win_rate:.0f}% win, "
        f"{sign}${stats.total_pnl:.2f}, "
        f"PF {pf_str}{streak}"
    )
