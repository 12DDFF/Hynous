"""Phase 6 consolidation — trade edge building + weekly rollup.

Conservative, SQL-backed edge inference post-analysis. Four edge types:

- ``preceded_by`` / ``followed_by``: purely temporal, same-symbol neighbours.
- ``same_regime_bucket``: taken trades whose entry ``vol_1h_regime`` matches.
- ``same_rejection_reason``: rejected signals grouped by ``rejection_reason``.
- ``rejection_vs_contemporaneous_trade``: a rejection and a nearby-in-time
  taken trade on the same symbol (or vice versa).

Weekly pattern rollup (``run_weekly_rollup``) aggregates the last ``window_days``
of trade/analysis activity into a single ``system_health_report`` row in
``trade_patterns``. A companion cron (``start_weekly_rollup_cron``) schedules
the rollup from a background daemon thread.

No LLM, no embeddings, no clustering. All builders + the rollup are pure SQL
with small Python drivers. :class:`JournalStore` exposes ``_connect`` at the
package level — usage here is intentional (per
``v2-planning/09-phase-6-consolidation-and-patterns.md``).
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from dataclasses import asdict, is_dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from .store import JournalStore

logger = logging.getLogger(__name__)


# ============================================================================
# Edge building
# ============================================================================


def build_edges(journal_store: JournalStore, trade_id: str) -> int:
    """Build conservative edges for a newly-analyzed (or rejected) trade.

    Called from the analysis pipeline completion hook (phase 6 M3) in a
    background thread via :func:`build_edges_async`.

    Returns:
        Total number of edge rows successfully inserted across all four
        builders. Dedup misses (UNIQUE violations) are not counted.
    """
    trade = journal_store.get_trade(trade_id)
    if not trade:
        return 0

    count = 0
    count += _build_temporal_edges(journal_store, trade)
    count += _build_regime_bucket_edges(journal_store, trade)
    count += _build_rejection_reason_edges(journal_store, trade)
    count += _build_rejection_vs_contemporaneous_edges(journal_store, trade)

    logger.info("Built %d edges for trade %s", count, trade_id)
    return count


def _build_temporal_edges(store: JournalStore, trade: dict[str, Any]) -> int:
    """``preceded_by`` + ``followed_by`` for the nearest prior same-symbol trade.

    Symmetric: inserts two edges (prev → current as ``followed_by`` and
    current → prev as ``preceded_by``) in a single transaction. Skips
    silently when the trade has no ``entry_ts`` (unfilled rejections).
    """
    trade_id = trade["trade_id"]
    symbol = trade["symbol"]
    entry_ts = trade.get("entry_ts")
    if not entry_ts:
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    count = 0

    conn = store._connect()
    try:
        prev_row = conn.execute(
            """
            SELECT trade_id FROM trades
            WHERE symbol = ?
              AND trade_id != ?
              AND entry_ts < ?
              AND status IN ('closed', 'analyzed')
            ORDER BY entry_ts DESC
            LIMIT 1
            """,
            (symbol, trade_id, entry_ts),
        ).fetchone()

        if prev_row:
            prev_id = prev_row["trade_id"]
            if _insert_edge(
                conn,
                source=prev_id, target=trade_id,
                edge_type="followed_by", strength=1.0,
                reason=f"next trade on {symbol}",
                now_iso=now_iso,
            ):
                count += 1
            if _insert_edge(
                conn,
                source=trade_id, target=prev_id,
                edge_type="preceded_by", strength=1.0,
                reason=f"previous trade on {symbol}",
                now_iso=now_iso,
            ):
                count += 1
    finally:
        conn.close()

    return count


def _build_regime_bucket_edges(store: JournalStore, trade: dict[str, Any]) -> int:
    """``same_regime_bucket``: link to taken trades whose entry vol_1h_regime matches.

    30-day lookback window, capped at 10 edges. Skips silently when the
    source trade has no entry snapshot or its ``ml_snapshot.vol_1h_regime``
    is null/missing.

    The join reads the target trades' regime from
    ``trade_entry_snapshots.snapshot_json`` via ``json_extract`` so no
    additional Python-side hydration is required.
    """
    trade_id = trade["trade_id"]
    vol_regime = _extract_vol_1h_regime(trade.get("entry_snapshot"))
    if not vol_regime:
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    count = 0

    conn = store._connect()
    try:
        rows = conn.execute(
            """
            SELECT t.trade_id
            FROM trades t
            JOIN trade_entry_snapshots tes ON t.trade_id = tes.trade_id
            WHERE t.trade_id != ?
              AND t.entry_ts >= ?
              AND t.status IN ('closed', 'analyzed')
              AND json_extract(tes.snapshot_json, '$.ml_snapshot.vol_1h_regime') = ?
            ORDER BY t.entry_ts DESC
            LIMIT 10
            """,
            (trade_id, cutoff, vol_regime),
        ).fetchall()

        for row in rows:
            target_id = row["trade_id"]
            if _insert_edge(
                conn,
                source=trade_id, target=target_id,
                edge_type="same_regime_bucket", strength=1.0,
                reason=f"both entered in vol_regime={vol_regime}",
                now_iso=now_iso,
            ):
                count += 1
    finally:
        conn.close()

    return count


def _build_rejection_reason_edges(store: JournalStore, trade: dict[str, Any]) -> int:
    """``same_rejection_reason``: only fires when source trade is ``rejected``.

    Groups rejected signals by ``rejection_reason`` over a 30-day window,
    capped at 10 edges.
    """
    if trade.get("status") != "rejected":
        return 0

    trade_id = trade["trade_id"]
    reason = trade.get("rejection_reason")
    if not reason:
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    count = 0

    conn = store._connect()
    try:
        rows = conn.execute(
            """
            SELECT trade_id FROM trades
            WHERE trade_id != ?
              AND entry_ts >= ?
              AND status = 'rejected'
              AND rejection_reason = ?
            ORDER BY entry_ts DESC
            LIMIT 10
            """,
            (trade_id, cutoff, reason),
        ).fetchall()

        for row in rows:
            target_id = row["trade_id"]
            if _insert_edge(
                conn,
                source=trade_id, target=target_id,
                edge_type="same_rejection_reason", strength=1.0,
                reason=f"both rejected for {reason}",
                now_iso=now_iso,
            ):
                count += 1
    finally:
        conn.close()

    return count


def _build_rejection_vs_contemporaneous_edges(
    store: JournalStore, trade: dict[str, Any],
) -> int:
    """``rejection_vs_contemporaneous_trade``: link rejections to nearby taken trades.

    Symmetric across status: a rejection links to taken trades (``closed`` or
    ``analyzed``) within ±2h on the same symbol, and a taken trade links to
    rejections within ±2h. Same-status matches are excluded. Capped at 5
    edges.
    """
    trade_id = trade["trade_id"]
    symbol = trade["symbol"]
    entry_ts = trade.get("entry_ts")
    status = trade.get("status")

    if not entry_ts or status not in ("closed", "analyzed", "rejected"):
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    count = 0

    conn = store._connect()
    try:
        dt = datetime.fromisoformat(entry_ts.replace("Z", "+00:00"))
        window_start = (dt - timedelta(hours=2)).isoformat()
        window_end = (dt + timedelta(hours=2)).isoformat()

        rows = conn.execute(
            """
            SELECT trade_id FROM trades
            WHERE trade_id != ?
              AND symbol = ?
              AND entry_ts BETWEEN ? AND ?
              AND status IN ('closed', 'analyzed', 'rejected')
              AND status != ?
            ORDER BY entry_ts DESC
            LIMIT 5
            """,
            (trade_id, symbol, window_start, window_end, status),
        ).fetchall()

        for row in rows:
            target_id = row["trade_id"]
            if _insert_edge(
                conn,
                source=trade_id, target=target_id,
                edge_type="rejection_vs_contemporaneous_trade", strength=1.0,
                reason=f"contemporaneous on {symbol} within 2h",
                now_iso=now_iso,
            ):
                count += 1
    finally:
        conn.close()

    return count


def _insert_edge(
    conn: sqlite3.Connection,
    *,
    source: str,
    target: str,
    edge_type: str,
    strength: float,
    reason: str,
    now_iso: str,
) -> bool:
    """Insert one edge row. Returns ``True`` on insert, ``False`` on dedup.

    Catches :class:`sqlite3.IntegrityError` specifically so real bugs (e.g.
    foreign-key violations from a stale ``target_trade_id``) surface as
    exceptions instead of silently turning into "already exists" misses.
    """
    try:
        conn.execute(
            """
            INSERT INTO trade_edges
                (source_trade_id, target_trade_id, edge_type, strength, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (source, target, edge_type, strength, reason, now_iso),
        )
        return True
    except sqlite3.IntegrityError:
        return False


def build_edges_async(journal_store: JournalStore, trade_id: str) -> None:
    """Dispatch :func:`build_edges` on a daemon thread.

    Called from the analysis pipeline completion hook in phase 6 M3.
    Failures are logged and swallowed — edge building is best-effort and
    must not propagate into the analysis pipeline's error handling.
    """
    def _run() -> None:
        try:
            build_edges(journal_store, trade_id)
        except Exception:
            logger.exception("Edge building failed for %s", trade_id)

    thread = threading.Thread(
        target=_run, daemon=True, name=f"edges-{trade_id[:8]}",
    )
    thread.start()


# ============================================================================
# Helpers
# ============================================================================


def _extract_vol_1h_regime(entry_snapshot: Any) -> str | None:
    """Read ``ml_snapshot.vol_1h_regime`` off an entry snapshot.

    ``JournalStore.get_trade`` returns ``entry_snapshot`` as a
    :class:`~hynous.journal.schema.TradeEntrySnapshot` dataclass; tests or
    synthetic bundles may pass a plain dict. Handle both.
    """
    if entry_snapshot is None:
        return None
    if is_dataclass(entry_snapshot) and not isinstance(entry_snapshot, type):
        data = asdict(entry_snapshot)
    elif isinstance(entry_snapshot, dict):
        data = entry_snapshot
    else:
        return None
    ml = data.get("ml_snapshot") or {}
    regime = ml.get("vol_1h_regime")
    return regime if isinstance(regime, str) and regime else None


# ============================================================================
# Weekly pattern rollup
# ============================================================================


def run_weekly_rollup(
    journal_store: JournalStore,
    *,
    window_days: int = 30,
) -> str | None:
    """Produce a weekly ``system_health_report`` pattern record.

    Aggregates the last ``window_days`` of trade + analysis activity into a
    single ``trade_patterns`` row. Four aggregates:

    1. **mistake_tag_summary** — frequency + avg process-quality + avg pnl
       per CSV-split mistake tag (joined to ``trades.realized_pnl_usd``).
    2. **rejection_reasons** — histogram of ``trades.rejection_reason`` for
       rejected trades in the window.
    3. **grade_summary** — per-key avg/min/max/sample_size parsed out of
       ``trade_analyses.grades_json``.
    4. **regime_performance** — trade_count / wins / win_rate / total_pnl /
       avg_roe bucketed by ``ml_snapshot.vol_1h_regime`` (extracted with
       ``json_extract`` directly from ``trade_entry_snapshots.snapshot_json``).
       Status filter: ``IN ('closed', 'analyzed')``.

    The resulting row id is ``system_health_{YYYYMMDD_HHMMSS}``. Member
    trade ids include every trade whose ``entry_ts`` lands in the window
    regardless of status (rejected + closed + analyzed).

    Returns the pattern id on success, ``None`` on failure.
    """
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=window_days)
    pattern_id = f"system_health_{now.strftime('%Y%m%d_%H%M%S')}"

    conn = journal_store._connect()
    try:
        # Aggregate 1: mistake tags frequency (+ avg pqs + avg pnl)
        tag_rows = conn.execute(
            """
            SELECT mistake_tags, process_quality_score,
                   (SELECT realized_pnl_usd FROM trades WHERE trade_id = ta.trade_id) AS pnl
            FROM trade_analyses ta
            WHERE analysis_ts >= ?
            """,
            (window_start.isoformat(),),
        ).fetchall()

        tag_counts: dict[str, dict[str, float]] = {}
        for row in tag_rows:
            tags = [t for t in (row["mistake_tags"] or "").split(",") if t]
            pqs = row["process_quality_score"] or 50
            pnl = row["pnl"] or 0
            for tag in tags:
                if tag not in tag_counts:
                    tag_counts[tag] = {"count": 0, "sum_pqs": 0, "sum_pnl": 0}
                tag_counts[tag]["count"] += 1
                tag_counts[tag]["sum_pqs"] += pqs
                tag_counts[tag]["sum_pnl"] += pnl

        mistake_tag_summary = [
            {
                "tag": tag,
                "count": int(stats["count"]),
                "avg_process_quality": round(stats["sum_pqs"] / stats["count"], 1),
                "avg_pnl": round(stats["sum_pnl"] / stats["count"], 2),
            }
            for tag, stats in sorted(
                tag_counts.items(), key=lambda x: x[1]["count"], reverse=True,
            )
        ]

        # Aggregate 2: rejection reasons histogram
        rejection_rows = conn.execute(
            """
            SELECT rejection_reason, COUNT(*) AS count
            FROM trades
            WHERE status = 'rejected' AND entry_ts >= ?
            GROUP BY rejection_reason
            ORDER BY count DESC
            """,
            (window_start.isoformat(),),
        ).fetchall()
        rejection_reasons = [
            {"reason": r["rejection_reason"], "count": r["count"]}
            for r in rejection_rows
        ]

        # Aggregate 3: grade distribution (per-key min/max/avg/sample_size)
        grade_rows = conn.execute(
            """
            SELECT grades_json FROM trade_analyses
            WHERE analysis_ts >= ?
            """,
            (window_start.isoformat(),),
        ).fetchall()

        grade_sums: dict[str, dict[str, float]] = {}
        for row in grade_rows:
            try:
                grades = json.loads(row["grades_json"])
            except Exception:
                continue
            for key, val in grades.items():
                if key not in grade_sums:
                    grade_sums[key] = {"count": 0, "sum": 0, "min": val, "max": val}
                grade_sums[key]["count"] += 1
                grade_sums[key]["sum"] += val
                grade_sums[key]["min"] = min(grade_sums[key]["min"], val)
                grade_sums[key]["max"] = max(grade_sums[key]["max"], val)

        grade_summary = {
            key: {
                "avg": round(stats["sum"] / stats["count"], 1) if stats["count"] else 0,
                "min": stats["min"],
                "max": stats["max"],
                "sample_size": int(stats["count"]),
            }
            for key, stats in grade_sums.items()
        }

        # Aggregate 4: performance by entry vol_1h_regime
        regime_rows = conn.execute(
            """
            SELECT
                json_extract(tes.snapshot_json, '$.ml_snapshot.vol_1h_regime') AS regime,
                COUNT(*) AS trade_count,
                SUM(CASE WHEN t.realized_pnl_usd > 0 THEN 1 ELSE 0 END) AS wins,
                SUM(t.realized_pnl_usd) AS total_pnl,
                AVG(t.roe_pct) AS avg_roe
            FROM trades t
            JOIN trade_entry_snapshots tes ON t.trade_id = tes.trade_id
            WHERE t.entry_ts >= ? AND t.status IN ('closed', 'analyzed')
            GROUP BY regime
            """,
            (window_start.isoformat(),),
        ).fetchall()

        regime_performance = [
            {
                "regime": r["regime"] or "unknown",
                "trade_count": r["trade_count"],
                "wins": r["wins"] or 0,
                "win_rate": (
                    round((r["wins"] or 0) / r["trade_count"] * 100, 1)
                    if r["trade_count"] else 0
                ),
                "total_pnl": round(r["total_pnl"] or 0, 2),
                "avg_roe": round(r["avg_roe"] or 0, 2),
            }
            for r in regime_rows
        ]

        aggregate = {
            "window_start": window_start.isoformat(),
            "window_end": now.isoformat(),
            "total_analyses": len(tag_rows),
            "mistake_tag_summary": mistake_tag_summary,
            "rejection_reasons": rejection_reasons,
            "grade_summary": grade_summary,
            "regime_performance": regime_performance,
        }

        member_ids = [
            r["trade_id"] for r in conn.execute(
                "SELECT trade_id FROM trades WHERE entry_ts >= ?",
                (window_start.isoformat(),),
            ).fetchall()
        ]

        conn.execute(
            """
            INSERT INTO trade_patterns
            (id, title, description, pattern_type, aggregate_json, member_trade_ids_json,
             window_start, window_end, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                aggregate_json = excluded.aggregate_json,
                member_trade_ids_json = excluded.member_trade_ids_json,
                updated_at = excluded.updated_at
            """,
            (
                pattern_id,
                f"System Health Report {now.strftime('%Y-%m-%d')}",
                f"Weekly rollup over {window_days} days ending {now.strftime('%Y-%m-%d')}",
                "system_health_report",
                json.dumps(aggregate, separators=(",", ":"), default=str),
                json.dumps(member_ids, separators=(",", ":"), default=str),
                window_start.isoformat(),
                now.isoformat(),
                now.isoformat(),
                now.isoformat(),
            ),
        )

        logger.info(
            "System health report written: %s (%d trades)",
            pattern_id, len(member_ids),
        )
        return pattern_id
    finally:
        conn.close()


def start_weekly_rollup_cron(
    journal_store: JournalStore,
    *,
    interval_s: int,
    window_days: int,
) -> threading.Thread:
    """Background thread that runs :func:`run_weekly_rollup` on a fixed cadence.

    Exceptions inside the loop are caught and logged so one failure does not
    kill the thread. The first invocation waits ``interval_s`` seconds — the
    daemon startup path should call :func:`run_weekly_rollup` directly if an
    immediate rollup is desired.
    """
    def _loop() -> None:
        while True:
            try:
                time.sleep(interval_s)
                run_weekly_rollup(journal_store, window_days=window_days)
            except Exception:
                logger.exception("Weekly rollup iteration failed")

    thread = threading.Thread(
        target=_loop, daemon=True, name="weekly-rollup-cron",
    )
    thread.start()
    return thread
