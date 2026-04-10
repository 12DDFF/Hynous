# Phase 6 — Consolidation & Pattern Rollup

> **Prerequisites:** Phases 0–5 complete.
>
> **Phase goal:** Build the minimal consolidation layer. Four conservative trade edges (preceded_by, followed_by, same_regime_bucket, same_rejection_reason, rejection_vs_contemporaneous_trade) computed automatically post-analysis. A barebones weekly pattern rollup cron that aggregates mistake tags, rejection reasons, grades, and regime performance into a `system_health_report` record. No LLM in consolidation — it's all SQL + heuristics.

---

## Context

You explicitly pushed back on automatic edge creation: "we'd have to do some deep analysis about what qualifies and creates an edge." The solution is to ship only edges that are (a) objectively definable without analysis and (b) useful for the transparency mission.

The four edge types in v2 are:

1. **`preceded_by` / `followed_by`** — the previous/next trade in time on the same symbol. Purely temporal. No interpretation.
2. **`same_regime_bucket`** — trades whose entry vol_regime label matches. Pure SQL join. Lets you ask "how does the system do in Extreme vol?"
3. **`same_rejection_reason`** — rejected signals grouped by which gate rejected them. Pure SQL. Lets you see "composite gate rejected 40 signals this week."
4. **`rejection_vs_contemporaneous_trade`** — when a rejection happens while a similar taken trade is running, link them. Useful for "we rejected signal X; we took similar signal Y; outcomes were…"

No embedding-based edges. No clustering. No LLM. All four can be computed by SQL with a small Python driver in under 150 LOC.

Pattern rollup is similarly barebones: a weekly cron job aggregates mistake tags, rejection reasons, grade distributions, and regime-stratified performance into a single `system_health_report` JSON blob per week. No narrative synthesis. No clustering. Just SQL aggregates surfaced to the dashboard.

BTC-only reminder: the `same_symbol` dimension doesn't matter for phase 6 because every trade is BTC anyway. The edge SQL should still include a symbol filter for when ETH/SOL are added later.

---

## Required Reading

1. All prior phase plans
2. **`05-phase-2-journal-module.md`** — the `trade_edges` and `trade_patterns` tables (already defined, currently empty)
3. **`06-phase-3-analysis-agent.md`** — the `mistake_tags` and `grades` you'll be aggregating
4. **`config/default.yaml`** — the `v2.consolidation` section

---

## Scope

### In Scope

- `src/hynous/journal/consolidation.py` — edge computation + pattern rollup
- Hook: after an analysis is inserted, call `build_edges(trade_id)` in a background thread
- Hook: on daemon startup, start a weekly cron for pattern rollup
- API endpoint `/api/v2/journal/patterns` listing latest pattern records
- CLI/manual trigger `python -m hynous.journal.consolidation rollup` for on-demand rollup
- Unit tests for each edge type
- Unit test for the weekly rollup logic
- Smoke test verifying edges get created after analyses fire

### Out of Scope

- Embedding-based similarity edges (deferred until we see what qualifies)
- Cluster visualizations (dashboard phase 7 may add simple tag filters)
- LLM involvement in consolidation
- Tag propagation across trades
- User-configurable edge types

---

## Consolidation Module

```python
# src/hynous/journal/consolidation.py

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from .store import JournalStore

logger = logging.getLogger(__name__)


# ============================================================================
# Edge building
# ============================================================================

def build_edges(journal_store: JournalStore, trade_id: str) -> int:
    """Build conservative edges for a newly-analyzed trade.
    
    Called from the analysis pipeline completion hook in a background thread.
    Returns the number of edges created.
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


def _build_temporal_edges(store: JournalStore, trade: dict) -> int:
    """preceded_by / followed_by based on entry_ts on the same symbol."""
    trade_id = trade["trade_id"]
    symbol = trade["symbol"]
    entry_ts = trade.get("entry_ts")
    if not entry_ts:
        return 0
    
    now_iso = datetime.now(timezone.utc).isoformat()
    count = 0
    
    conn = store._connect()
    try:
        # Find the previous trade on the same symbol
        prev_row = conn.execute(
            """
            SELECT trade_id FROM trades
            WHERE symbol = ? AND trade_id != ? AND entry_ts < ? AND status IN ('closed', 'analyzed')
            ORDER BY entry_ts DESC LIMIT 1
            """,
            (symbol, trade_id, entry_ts),
        ).fetchone()
        
        if prev_row:
            prev_id = prev_row["trade_id"]
            _insert_edge(
                conn,
                source=prev_id, target=trade_id,
                edge_type="followed_by", strength=1.0,
                reason=f"next trade on {symbol}",
                now_iso=now_iso,
            )
            _insert_edge(
                conn,
                source=trade_id, target=prev_id,
                edge_type="preceded_by", strength=1.0,
                reason=f"previous trade on {symbol}",
                now_iso=now_iso,
            )
            count += 2
    finally:
        conn.close()
    
    return count


def _build_regime_bucket_edges(store: JournalStore, trade: dict) -> int:
    """same_regime_bucket: link to trades with matching entry vol_regime."""
    trade_id = trade["trade_id"]
    entry_snapshot = trade.get("entry_snapshot", {})
    if not entry_snapshot:
        return 0
    
    vol_regime = (
        entry_snapshot.get("ml_snapshot", {}).get("vol_1h_regime")
    )
    if not vol_regime:
        return 0
    
    now_iso = datetime.now(timezone.utc).isoformat()
    count = 0
    
    conn = store._connect()
    try:
        # Find up to 10 other trades in the same regime bucket (last 30d)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
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


def _build_rejection_reason_edges(store: JournalStore, trade: dict) -> int:
    """same_rejection_reason: link rejected signals by their rejection_reason."""
    trade_id = trade["trade_id"]
    if trade.get("status") != "rejected":
        return 0
    
    reason = trade.get("rejection_reason")
    if not reason:
        return 0
    
    now_iso = datetime.now(timezone.utc).isoformat()
    count = 0
    
    conn = store._connect()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
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


def _build_rejection_vs_contemporaneous_edges(store: JournalStore, trade: dict) -> int:
    """rejection_vs_contemporaneous_trade: when a rejection happens near a taken trade on the same symbol."""
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
        # For a rejection: find taken trades running within ±2 hours
        # For a taken trade: find rejections within ±2 hours
        dt = datetime.fromisoformat(entry_ts.replace("Z", "+00:00"))
        window_start = (dt - timedelta(hours=2)).isoformat()
        window_end = (dt + timedelta(hours=2)).isoformat()
        
        opposite_status = "rejected" if status != "rejected" else "closed"
        
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
    conn,
    *,
    source: str,
    target: str,
    edge_type: str,
    strength: float,
    reason: str,
    now_iso: str,
) -> bool:
    """Insert an edge, returning True if created, False if already existed."""
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
    except Exception:
        # UNIQUE constraint violation — edge already exists
        return False


def build_edges_async(journal_store: JournalStore, trade_id: str) -> None:
    """Background wrapper for build_edges."""
    def _run():
        try:
            build_edges(journal_store, trade_id)
        except Exception:
            logger.exception("Edge building failed for %s", trade_id)
    
    thread = threading.Thread(target=_run, daemon=True, name=f"edges-{trade_id[:8]}")
    thread.start()


# ============================================================================
# Pattern rollup
# ============================================================================

def run_weekly_rollup(
    journal_store: JournalStore,
    *,
    window_days: int = 30,
) -> str | None:
    """Produce a weekly system_health_report pattern record.
    
    Returns the pattern id on success, None on failure.
    """
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=window_days)
    pattern_id = f"system_health_{now.strftime('%Y%m%d_%H%M%S')}"
    
    conn = journal_store._connect()
    try:
        # Aggregate 1: mistake tags frequency
        tag_rows = conn.execute(
            """
            SELECT mistake_tags, process_quality_score, 
                   (SELECT realized_pnl_usd FROM trades WHERE trade_id = ta.trade_id) AS pnl
            FROM trade_analyses ta
            WHERE analysis_ts >= ?
            """,
            (window_start.isoformat(),),
        ).fetchall()
        
        tag_counts: dict[str, dict] = {}
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
                "count": stats["count"],
                "avg_process_quality": round(stats["sum_pqs"] / stats["count"], 1),
                "avg_pnl": round(stats["sum_pnl"] / stats["count"], 2),
            }
            for tag, stats in sorted(tag_counts.items(), key=lambda x: x[1]["count"], reverse=True)
        ]
        
        # Aggregate 2: rejection reasons histogram
        rejection_rows = conn.execute(
            """
            SELECT rejection_reason, COUNT(*) as count
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
        
        # Aggregate 3: grade distribution (histogram per grade)
        grade_rows = conn.execute(
            """
            SELECT grades_json FROM trade_analyses
            WHERE analysis_ts >= ?
            """,
            (window_start.isoformat(),),
        ).fetchall()
        
        grade_sums: dict[str, dict] = {}
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
                "sample_size": stats["count"],
            }
            for key, stats in grade_sums.items()
        }
        
        # Aggregate 4: performance by regime
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
                "win_rate": round((r["wins"] or 0) / r["trade_count"] * 100, 1) if r["trade_count"] else 0,
                "total_pnl": round(r["total_pnl"] or 0, 2),
                "avg_roe": round(r["avg_roe"] or 0, 2),
            }
            for r in regime_rows
        ]
        
        # Assemble aggregate record
        aggregate = {
            "window_start": window_start.isoformat(),
            "window_end": now.isoformat(),
            "total_analyses": len(tag_rows),
            "mistake_tag_summary": mistake_tag_summary,
            "rejection_reasons": rejection_reasons,
            "grade_summary": grade_summary,
            "regime_performance": regime_performance,
        }
        
        # Insert pattern record
        member_ids = [r["trade_id"] for r in conn.execute(
            """
            SELECT trade_id FROM trades WHERE entry_ts >= ?
            """,
            (window_start.isoformat(),),
        ).fetchall()]
        
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
        
        logger.info("System health report written: %s (%d trades)", pattern_id, len(member_ids))
        return pattern_id
    finally:
        conn.close()


def start_weekly_rollup_cron(
    journal_store: JournalStore,
    *,
    interval_s: int,
    window_days: int,
) -> threading.Thread:
    """Background thread that runs the weekly rollup on schedule."""
    def _loop():
        while True:
            try:
                time.sleep(interval_s)
                run_weekly_rollup(journal_store, window_days=window_days)
            except Exception:
                logger.exception("Weekly rollup iteration failed")
    
    thread = threading.Thread(target=_loop, daemon=True, name="weekly-rollup-cron")
    thread.start()
    return thread
```

---

## Integration Points

### After analysis inserts (phase 3 integration)

In `src/hynous/analysis/wake_integration.py`, after `journal_store.insert_analysis(...)` succeeds:

```python
# v2: build consolidation edges for this trade
try:
    from hynous.journal.consolidation import build_edges_async
    build_edges_async(journal_store, trade_id)
except Exception:
    logger.exception("Edge building dispatch failed for %s", trade_id)
```

### Daemon startup

After the analysis batch rejection cron is started, also start the weekly rollup:

```python
from hynous.journal.consolidation import start_weekly_rollup_cron
start_weekly_rollup_cron(
    journal_store=self._journal_store,
    interval_s=self.config.v2.consolidation.pattern_rollup_interval_hours * 3600,
    window_days=self.config.v2.consolidation.pattern_rollup_window_days,
)
```

### API route for patterns

Add to `src/hynous/journal/api.py`:

```python
@router.get("/patterns")
def list_patterns_endpoint(
    pattern_type: str | None = Query(None),
    limit: int = Query(10, le=50),
) -> list[dict[str, Any]]:
    store = _require_store()
    conn = store._connect()
    try:
        if pattern_type:
            rows = conn.execute(
                """
                SELECT id, title, description, pattern_type, aggregate_json,
                       member_trade_ids_json, window_start, window_end, created_at, updated_at
                FROM trade_patterns
                WHERE pattern_type = ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (pattern_type, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, title, description, pattern_type, aggregate_json,
                       member_trade_ids_json, window_start, window_end, created_at, updated_at
                FROM trade_patterns
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        
        return [
            {
                "id": r["id"],
                "title": r["title"],
                "description": r["description"],
                "pattern_type": r["pattern_type"],
                "aggregate": json.loads(r["aggregate_json"]),
                "member_trade_ids": json.loads(r["member_trade_ids_json"]),
                "window_start": r["window_start"],
                "window_end": r["window_end"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
    finally:
        conn.close()


@router.get("/trades/{trade_id}/related")
def get_related_trades_endpoint(
    trade_id: str,
    edge_type: str | None = Query(None),
) -> list[dict[str, Any]]:
    store = _require_store()
    conn = store._connect()
    try:
        if edge_type:
            rows = conn.execute(
                """
                SELECT e.target_trade_id AS other_id, e.edge_type, e.strength, e.reason,
                       t.symbol, t.side, t.status, t.realized_pnl_usd
                FROM trade_edges e
                JOIN trades t ON e.target_trade_id = t.trade_id
                WHERE e.source_trade_id = ? AND e.edge_type = ?
                ORDER BY e.created_at DESC
                """,
                (trade_id, edge_type),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT e.target_trade_id AS other_id, e.edge_type, e.strength, e.reason,
                       t.symbol, t.side, t.status, t.realized_pnl_usd
                FROM trade_edges e
                JOIN trades t ON e.target_trade_id = t.trade_id
                WHERE e.source_trade_id = ?
                ORDER BY e.edge_type, e.created_at DESC
                """,
                (trade_id,),
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
```

### Manual trigger

Add a CLI entry point:

```python
# src/hynous/journal/__main__.py

import sys
from .store import JournalStore
from .consolidation import run_weekly_rollup

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m hynous.journal {rollup}")
        sys.exit(1)
    
    cmd = sys.argv[1]
    if cmd == "rollup":
        from hynous.core.config import load_config
        cfg = load_config()
        store = JournalStore(cfg.v2.journal.db_path)
        pattern_id = run_weekly_rollup(
            store, window_days=cfg.v2.consolidation.pattern_rollup_window_days,
        )
        print(f"Rollup complete: {pattern_id}")
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
```

---

## Testing

### Unit tests

`tests/unit/test_v2_consolidation.py`:

1. `test_build_temporal_edges_creates_preceded_and_followed_by`
2. `test_build_temporal_edges_skips_when_no_prior_trade`
3. `test_build_regime_bucket_edges_joins_matching_regimes`
4. `test_build_regime_bucket_edges_respects_30d_window`
5. `test_build_regime_bucket_edges_limits_to_10`
6. `test_build_rejection_reason_edges_groups_by_reason`
7. `test_build_rejection_reason_edges_skips_non_rejections`
8. `test_build_rejection_vs_contemporaneous_links_across_statuses`
9. `test_build_rejection_vs_contemporaneous_respects_2h_window`
10. `test_insert_edge_deduplicates`
11. `test_build_edges_returns_correct_count`
12. `test_run_weekly_rollup_empty_window`
13. `test_run_weekly_rollup_with_mixed_data`
14. `test_run_weekly_rollup_aggregates_mistake_tags`
15. `test_run_weekly_rollup_aggregates_grade_distribution`
16. `test_run_weekly_rollup_aggregates_regime_performance`
17. `test_run_weekly_rollup_idempotent_upsert`

### Integration tests

`tests/integration/test_v2_consolidation_integration.py`:

1. `test_analysis_hook_triggers_edge_build` — insert an analysis, verify edges appear
2. `test_api_patterns_route_returns_latest`
3. `test_api_related_route_returns_linked_trades`
4. `test_cron_fires_and_produces_pattern` — mock the interval short, verify a pattern appears

### Smoke test

Run daemon for 2 hours in paper mode. Trigger a manual rollup halfway through:

```bash
python -m hynous.journal rollup
```

Verify:
- `trade_edges` table has rows after at least 2 closed trades
- `trade_patterns` has at least one `system_health_report`
- API route `/api/v2/journal/patterns` returns the pattern
- Pattern JSON contains mistake_tag_summary, rejection_reasons, grade_summary, regime_performance

---

## Acceptance Criteria

- [ ] `src/hynous/journal/consolidation.py` implements all 4 edge types + rollup
- [ ] Edge building fires automatically after analysis insert
- [ ] Weekly rollup cron starts on daemon startup
- [ ] `python -m hynous.journal rollup` works as manual trigger
- [ ] `/api/v2/journal/patterns` returns rollups
- [ ] `/api/v2/journal/trades/{id}/related` returns edges
- [ ] 17 unit tests pass
- [ ] 4 integration tests pass
- [ ] Smoke test produces edges and a pattern record
- [ ] No LLM calls in consolidation code (grep for `litellm`, `completion`, should return nothing in `consolidation.py`)
- [ ] Phase 6 commits tagged `[phase-6]`

---

## Report-Back

Include:
- Number of edges created during smoke test, grouped by edge_type
- Pattern record aggregate JSON (sample)
- Confirmation that consolidation adds no measurable latency to analysis pipeline
- Any edge type that produced an unexpectedly high count (could indicate the SQL is too permissive)
