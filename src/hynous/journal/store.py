"""Production v2 journal store — replaces Nous.

Thread-safe SQLite journal with WAL reads and serialized writes. Every mutation
goes through a short-lived connection inside a write lock; reads open their own
connection and benefit from WAL's concurrent-read semantics.

The store exposes the full CRUD surface phase 3+ needs (trades, entry/exit
snapshots, lifecycle events, analyses, tags, aggregate stats) PLUS three
daemon-compatibility methods that mirror :class:`StagingStore` so phase 2's
M7 daemon swap is a drop-in type change.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .schema import (
    SCHEMA_DDL,
    TradeEntrySnapshot,
    TradeExitSnapshot,
    entry_snapshot_from_dict,
    exit_snapshot_from_dict,
)

logger = logging.getLogger(__name__)


class JournalStore:
    """Production journal store. Replaces Nous entirely.

    Thread-safe via a connection-per-operation pattern with a write lock.
    Reads are concurrent (WAL mode); writes are serialized by the lock
    to avoid SQLite busy errors on the embedded daemon deployment.
    """

    def __init__(self, db_path: str, *, busy_timeout_ms: int = 5000) -> None:
        self._db_path = db_path
        self._busy_timeout_ms = busy_timeout_ms
        self._write_lock = threading.Lock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    # ========================================================================
    # Connection management
    # ========================================================================

    def _connect(self) -> sqlite3.Connection:
        """Open a new SQLite connection with WAL mode and safe settings."""
        conn = sqlite3.connect(
            self._db_path,
            timeout=self._busy_timeout_ms / 1000,
            isolation_level=None,  # autocommit — explicit transactions if needed
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute(f"PRAGMA busy_timeout={self._busy_timeout_ms}")
        return conn

    def _init_schema(self) -> None:
        with self._write_lock:
            conn = self._connect()
            try:
                conn.executescript(SCHEMA_DDL)
            finally:
                conn.close()

    def close(self) -> None:
        """No-op since connections are per-operation, kept for API symmetry."""

    # ========================================================================
    # Trade CRUD
    # ========================================================================

    def upsert_trade(
        self,
        *,
        trade_id: str,
        symbol: str,
        side: str,
        trade_type: str,
        status: str,
        entry_ts: str | None = None,
        entry_px: float | None = None,
        exit_ts: str | None = None,
        exit_px: float | None = None,
        exit_classification: str | None = None,
        realized_pnl_usd: float | None = None,
        roe_pct: float | None = None,
        hold_duration_s: int | None = None,
        peak_roe: float | None = None,
        trough_roe: float | None = None,
        leverage: int | None = None,
        size_usd: float | None = None,
        margin_usd: float | None = None,
        trigger_source: str | None = None,
        trigger_type: str | None = None,
        rejection_reason: str | None = None,
    ) -> None:
        """Insert or update a trade row.

        Called from entry capture (status='open'), exit capture (status='closed'),
        analysis agent (status='analyzed'), and rejection recording
        (status='rejected'). On conflict, the DO UPDATE SET clause only touches
        mutable fields — symbol/side/trade_type/entry_ts are preserved from the
        original insert so exit-time calls with empty placeholder values do not
        clobber the identity columns.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        with self._write_lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO trades (
                        trade_id, symbol, side, trade_type, status,
                        entry_ts, entry_px, exit_ts, exit_px, exit_classification,
                        realized_pnl_usd, roe_pct, hold_duration_s, peak_roe, trough_roe,
                        leverage, size_usd, margin_usd, trigger_source, trigger_type,
                        rejection_reason, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(trade_id) DO UPDATE SET
                        status = excluded.status,
                        exit_ts = COALESCE(excluded.exit_ts, trades.exit_ts),
                        exit_px = COALESCE(excluded.exit_px, trades.exit_px),
                        exit_classification = COALESCE(excluded.exit_classification, trades.exit_classification),
                        realized_pnl_usd = COALESCE(excluded.realized_pnl_usd, trades.realized_pnl_usd),
                        roe_pct = COALESCE(excluded.roe_pct, trades.roe_pct),
                        hold_duration_s = COALESCE(excluded.hold_duration_s, trades.hold_duration_s),
                        peak_roe = COALESCE(excluded.peak_roe, trades.peak_roe),
                        trough_roe = COALESCE(excluded.trough_roe, trades.trough_roe),
                        rejection_reason = COALESCE(excluded.rejection_reason, trades.rejection_reason),
                        updated_at = excluded.updated_at
                    """,
                    (
                        trade_id, symbol, side, trade_type, status,
                        entry_ts, entry_px, exit_ts, exit_px, exit_classification,
                        realized_pnl_usd, roe_pct, hold_duration_s, peak_roe, trough_roe,
                        leverage, size_usd, margin_usd, trigger_source, trigger_type,
                        rejection_reason, now_iso, now_iso,
                    ),
                )
            finally:
                conn.close()

    def get_trade(self, trade_id: str) -> dict[str, Any] | None:
        """Return the full hydrated trade bundle: row + snapshots + events + analysis + tags.

        ``entry_snapshot`` and ``exit_snapshot`` keys hold real dataclass
        instances (reconstructed via the schema helpers); ``counterfactuals``,
        ``events``, ``analysis``, and ``tags`` remain as plain dicts/lists for
        ergonomic JSON-style access.
        """
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM trades WHERE trade_id = ?", (trade_id,),
            ).fetchone()
            if not row:
                return None

            result: dict[str, Any] = dict(row)

            # Entry snapshot — hydrate to dataclass
            entry_row = conn.execute(
                "SELECT snapshot_json FROM trade_entry_snapshots WHERE trade_id = ?",
                (trade_id,),
            ).fetchone()
            if entry_row:
                try:
                    result["entry_snapshot"] = entry_snapshot_from_dict(
                        json.loads(entry_row["snapshot_json"]),
                    )
                except (KeyError, TypeError):
                    logger.exception(
                        "entry snapshot hydration failed for %s — treating as None",
                        trade_id,
                    )
                    result["entry_snapshot"] = None
            else:
                result["entry_snapshot"] = None

            # Exit snapshot — hydrate to dataclass; counterfactuals stay as dict
            exit_row = conn.execute(
                "SELECT snapshot_json, counterfactuals_json "
                "FROM trade_exit_snapshots WHERE trade_id = ?",
                (trade_id,),
            ).fetchone()
            if exit_row:
                try:
                    result["exit_snapshot"] = exit_snapshot_from_dict(
                        json.loads(exit_row["snapshot_json"]),
                    )
                except (KeyError, TypeError):
                    logger.exception(
                        "exit snapshot hydration failed for %s — treating as None",
                        trade_id,
                    )
                    result["exit_snapshot"] = None
                result["counterfactuals"] = json.loads(exit_row["counterfactuals_json"])
            else:
                result["exit_snapshot"] = None
                result["counterfactuals"] = None

            # Events — chronological
            event_rows = conn.execute(
                """
                SELECT id, ts, event_type, payload_json
                FROM trade_events
                WHERE trade_id = ?
                ORDER BY ts ASC
                """,
                (trade_id,),
            ).fetchall()
            result["events"] = [
                {
                    "id": r["id"],
                    "ts": r["ts"],
                    "event_type": r["event_type"],
                    "payload": json.loads(r["payload_json"]),
                }
                for r in event_rows
            ]

            # Analysis
            analysis_row = conn.execute(
                """
                SELECT narrative, narrative_citations_json, findings_json, grades_json,
                       mistake_tags, process_quality_score, one_line_summary,
                       unverified_claims_json, model_used, prompt_version, analysis_ts
                FROM trade_analyses WHERE trade_id = ?
                """,
                (trade_id,),
            ).fetchone()
            if analysis_row:
                result["analysis"] = {
                    "narrative": analysis_row["narrative"],
                    "narrative_citations": json.loads(
                        analysis_row["narrative_citations_json"],
                    ),
                    "findings": json.loads(analysis_row["findings_json"]),
                    "grades": json.loads(analysis_row["grades_json"]),
                    "mistake_tags": (
                        analysis_row["mistake_tags"].split(",")
                        if analysis_row["mistake_tags"] else []
                    ),
                    "process_quality_score": analysis_row["process_quality_score"],
                    "one_line_summary": analysis_row["one_line_summary"],
                    "unverified_claims": (
                        json.loads(analysis_row["unverified_claims_json"])
                        if analysis_row["unverified_claims_json"] else []
                    ),
                    "model_used": analysis_row["model_used"],
                    "prompt_version": analysis_row["prompt_version"],
                    "analysis_ts": analysis_row["analysis_ts"],
                }
            else:
                result["analysis"] = None

            # Tags
            tag_rows = conn.execute(
                "SELECT tag, source FROM trade_tags WHERE trade_id = ?",
                (trade_id,),
            ).fetchall()
            result["tags"] = [
                {"tag": r["tag"], "source": r["source"]} for r in tag_rows
            ]

            return result
        finally:
            conn.close()

    def list_trades(
        self,
        *,
        symbol: str | None = None,
        status: str | None = None,
        exit_classification: str | None = None,
        since: str | None = None,
        until: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """List trades with SQL filters ordered by entry_ts DESC."""
        conditions: list[str] = []
        params: list[Any] = []

        if symbol:
            conditions.append("symbol = ?")
            params.append(symbol)
        if status:
            conditions.append("status = ?")
            params.append(status)
        if exit_classification:
            conditions.append("exit_classification = ?")
            params.append(exit_classification)
        if since:
            conditions.append("entry_ts >= ?")
            params.append(since)
        if until:
            conditions.append("entry_ts <= ?")
            params.append(until)

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        params.extend([limit, offset])

        conn = self._connect()
        try:
            rows = conn.execute(
                f"SELECT * FROM trades {where} ORDER BY entry_ts DESC LIMIT ? OFFSET ?",
                params,
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # ========================================================================
    # Entry / exit snapshot CRUD
    # ========================================================================

    def insert_entry_snapshot(
        self,
        snapshot: TradeEntrySnapshot,
        *,
        embedding: bytes | None = None,
    ) -> None:
        """Persist an entry snapshot + upsert the parent trade row to status='open'."""
        self.upsert_trade(
            trade_id=snapshot.trade_basics.trade_id,
            symbol=snapshot.trade_basics.symbol,
            side=snapshot.trade_basics.side,
            trade_type=snapshot.trade_basics.trade_type,
            status="open",
            entry_ts=snapshot.trade_basics.entry_ts,
            entry_px=snapshot.trade_basics.entry_px,
            leverage=snapshot.trade_basics.leverage,
            size_usd=snapshot.trade_basics.size_usd,
            margin_usd=snapshot.trade_basics.margin_usd,
            trigger_source=snapshot.trigger_context.trigger_source,
            trigger_type=snapshot.trigger_context.trigger_type,
        )

        json_str = json.dumps(
            asdict(snapshot), sort_keys=True, separators=(",", ":"), default=str,
        )
        now_iso = datetime.now(timezone.utc).isoformat()

        with self._write_lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO trade_entry_snapshots (
                        trade_id, snapshot_json, embedding, schema_version, created_at
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(trade_id) DO UPDATE SET
                        snapshot_json = excluded.snapshot_json,
                        embedding = excluded.embedding
                    """,
                    (
                        snapshot.trade_basics.trade_id,
                        json_str,
                        embedding,
                        snapshot.schema_version,
                        now_iso,
                    ),
                )
            finally:
                conn.close()

    def insert_exit_snapshot(self, snapshot: TradeExitSnapshot) -> None:
        """Persist an exit snapshot + mark the parent trade as closed.

        Serializes both the full snapshot and its counterfactuals section into
        separate columns so phase 6's pattern rollup can filter on
        counterfactual fields without parsing the full blob.
        """
        self.upsert_trade(
            trade_id=snapshot.trade_id,
            symbol="",
            side="",
            trade_type="",
            status="closed",
            exit_ts=snapshot.trade_outcome.exit_ts,
            exit_px=snapshot.trade_outcome.exit_px,
            exit_classification=snapshot.trade_outcome.exit_classification,
            realized_pnl_usd=snapshot.trade_outcome.realized_pnl_usd,
            roe_pct=snapshot.trade_outcome.roe_at_exit,
            hold_duration_s=snapshot.trade_outcome.hold_duration_s,
            peak_roe=snapshot.roe_trajectory.peak_roe,
            trough_roe=snapshot.roe_trajectory.trough_roe,
        )

        snapshot_json = json.dumps(
            asdict(snapshot), sort_keys=True, separators=(",", ":"), default=str,
        )
        counterfactuals_json = json.dumps(
            asdict(snapshot.counterfactuals),
            sort_keys=True, separators=(",", ":"), default=str,
        )
        now_iso = datetime.now(timezone.utc).isoformat()

        with self._write_lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO trade_exit_snapshots (
                        trade_id, snapshot_json, counterfactuals_json,
                        schema_version, created_at
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(trade_id) DO UPDATE SET
                        snapshot_json = excluded.snapshot_json,
                        counterfactuals_json = excluded.counterfactuals_json
                    """,
                    (
                        snapshot.trade_id,
                        snapshot_json,
                        counterfactuals_json,
                        snapshot.schema_version,
                        now_iso,
                    ),
                )
            finally:
                conn.close()

    # ========================================================================
    # Lifecycle events
    # ========================================================================

    def insert_lifecycle_event(
        self,
        *,
        trade_id: str,
        ts: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        """Persist a single lifecycle event. Emitted by the daemon's mechanical-exit layers."""
        now_iso = datetime.now(timezone.utc).isoformat()
        payload_json = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), default=str,
        )

        with self._write_lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO trade_events (trade_id, ts, event_type, payload_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (trade_id, ts, event_type, payload_json, now_iso),
                )
            finally:
                conn.close()

    def get_events_for_trade(self, trade_id: str) -> list[dict[str, Any]]:
        """Return all lifecycle events for a trade, chronological.

        NOTE: ``StagingStore`` returned ``list[LifecycleEvent]`` here;
        ``JournalStore`` returns ``list[dict]`` because that's what the API
        response models expect. Callers that want dataclass instances can
        import :class:`LifecycleEvent` from :mod:`hynous.journal.schema` and
        construct from the dict.
        """
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT id, ts, event_type, payload_json
                FROM trade_events
                WHERE trade_id = ?
                ORDER BY ts ASC
                """,
                (trade_id,),
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "ts": r["ts"],
                    "event_type": r["event_type"],
                    "payload": json.loads(r["payload_json"]),
                }
                for r in rows
            ]
        finally:
            conn.close()

    # ========================================================================
    # Trade analyses (phase 3 populates; phase 2 exposes read+write API)
    # ========================================================================

    def insert_analysis(
        self,
        *,
        trade_id: str,
        narrative: str,
        narrative_citations: list[dict[str, Any]],
        findings: list[dict[str, Any]],
        grades: dict[str, int],
        mistake_tags: list[str],
        process_quality_score: int,
        one_line_summary: str,
        unverified_claims: list[dict[str, Any]] | None,
        model_used: str,
        prompt_version: str,
        embedding: bytes | None = None,
    ) -> None:
        """Persist an analysis + upgrade the parent trade's status to 'analyzed'."""
        analysis_ts = datetime.now(timezone.utc).isoformat()

        with self._write_lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO trade_analyses (
                        trade_id, narrative, narrative_citations_json, findings_json,
                        grades_json, mistake_tags, process_quality_score, one_line_summary,
                        unverified_claims_json, model_used, prompt_version, analysis_ts,
                        embedding, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(trade_id) DO UPDATE SET
                        narrative = excluded.narrative,
                        narrative_citations_json = excluded.narrative_citations_json,
                        findings_json = excluded.findings_json,
                        grades_json = excluded.grades_json,
                        mistake_tags = excluded.mistake_tags,
                        process_quality_score = excluded.process_quality_score,
                        one_line_summary = excluded.one_line_summary,
                        unverified_claims_json = excluded.unverified_claims_json,
                        model_used = excluded.model_used,
                        prompt_version = excluded.prompt_version,
                        analysis_ts = excluded.analysis_ts,
                        embedding = excluded.embedding
                    """,
                    (
                        trade_id,
                        narrative,
                        json.dumps(narrative_citations, sort_keys=True, separators=(",", ":")),
                        json.dumps(findings, sort_keys=True, separators=(",", ":")),
                        json.dumps(grades, sort_keys=True, separators=(",", ":")),
                        ",".join(mistake_tags),
                        process_quality_score,
                        one_line_summary,
                        (
                            json.dumps(unverified_claims, sort_keys=True, separators=(",", ":"))
                            if unverified_claims else None
                        ),
                        model_used,
                        prompt_version,
                        analysis_ts,
                        embedding,
                        analysis_ts,
                    ),
                )
                conn.execute(
                    "UPDATE trades SET status = 'analyzed', updated_at = ? "
                    "WHERE trade_id = ?",
                    (analysis_ts, trade_id),
                )
            finally:
                conn.close()

    def get_analysis(self, trade_id: str) -> dict[str, Any] | None:
        """Return the analysis record for a trade, or None."""
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT narrative, narrative_citations_json, findings_json, grades_json,
                       mistake_tags, process_quality_score, one_line_summary,
                       unverified_claims_json, model_used, prompt_version, analysis_ts
                FROM trade_analyses WHERE trade_id = ?
                """,
                (trade_id,),
            ).fetchone()
            if not row:
                return None
            return {
                "narrative": row["narrative"],
                "narrative_citations": json.loads(row["narrative_citations_json"]),
                "findings": json.loads(row["findings_json"]),
                "grades": json.loads(row["grades_json"]),
                "mistake_tags": (
                    row["mistake_tags"].split(",") if row["mistake_tags"] else []
                ),
                "process_quality_score": row["process_quality_score"],
                "one_line_summary": row["one_line_summary"],
                "unverified_claims": (
                    json.loads(row["unverified_claims_json"])
                    if row["unverified_claims_json"] else []
                ),
                "model_used": row["model_used"],
                "prompt_version": row["prompt_version"],
                "analysis_ts": row["analysis_ts"],
            }
        finally:
            conn.close()

    # ========================================================================
    # Tags
    # ========================================================================

    def add_tag(self, trade_id: str, tag: str, source: str = "manual") -> None:
        """Attach a tag to a trade. Idempotent via the composite primary key."""
        now_iso = datetime.now(timezone.utc).isoformat()
        with self._write_lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO trade_tags (trade_id, tag, source, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (trade_id, tag, source, now_iso),
                )
            finally:
                conn.close()

    def remove_tag(self, trade_id: str, tag: str) -> None:
        """Remove a tag from a trade."""
        with self._write_lock:
            conn = self._connect()
            try:
                conn.execute(
                    "DELETE FROM trade_tags WHERE trade_id = ? AND tag = ?",
                    (trade_id, tag),
                )
            finally:
                conn.close()

    def get_tags(self, trade_id: str) -> list[dict[str, str]]:
        """Return all tags for a trade ordered by creation time."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT tag, source, created_at FROM trade_tags "
                "WHERE trade_id = ? ORDER BY created_at ASC",
                (trade_id,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def list_trades_by_tag(self, tag: str, limit: int = 100) -> list[str]:
        """Return trade_ids that carry a given tag."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT trade_id FROM trade_tags WHERE tag = ? LIMIT ?",
                (tag, limit),
            ).fetchall()
            return [r["trade_id"] for r in rows]
        finally:
            conn.close()

    # ========================================================================
    # Semantic search (phase 2 — Milestone 3)
    # ========================================================================

    def search_semantic(
        self,
        *,
        query_embedding: bytes,
        scope: str = "entry",
        limit: int = 20,
        symbol: str | None = None,
    ) -> list[dict[str, Any]]:
        """Cosine-similarity search over entry snapshots or analysis narratives.

        Brute-force scan computing cosine per row in Python — acceptable for
        ≤ 10k trades. If scale grows beyond that, swap to the sqlite-vec
        extension or an external vector index.

        Args:
            query_embedding: float32 bytes (produced by
                :class:`hynous.journal.embeddings.EmbeddingClient.embed`).
            scope: ``"entry"`` to search over entry-snapshot embeddings,
                ``"analysis"`` to search over analysis-narrative embeddings.
            limit: maximum rows returned.
            symbol: optional filter on trade symbol.

        Returns:
            Descending by cosine score, each row
            ``{"trade_id", "symbol", "side", "score"}``.
        """
        from .embeddings import cosine_similarity

        params: list[Any] = []
        sym_filter = ""
        if symbol:
            sym_filter = " AND t.symbol = ?"
            params.append(symbol)

        conn = self._connect()
        try:
            if scope == "entry":
                rows = conn.execute(
                    f"""
                    SELECT t.trade_id, t.symbol, t.side, tes.embedding AS emb
                    FROM trades t
                    JOIN trade_entry_snapshots tes ON t.trade_id = tes.trade_id
                    WHERE tes.embedding IS NOT NULL{sym_filter}
                    """,
                    params,
                ).fetchall()
            elif scope == "analysis":
                rows = conn.execute(
                    f"""
                    SELECT t.trade_id, t.symbol, t.side, ta.embedding AS emb
                    FROM trades t
                    JOIN trade_analyses ta ON t.trade_id = ta.trade_id
                    WHERE ta.embedding IS NOT NULL{sym_filter}
                    """,
                    params,
                ).fetchall()
            else:
                raise ValueError(
                    f"unsupported scope: {scope!r} (expected 'entry' or 'analysis')",
                )

            results: list[dict[str, Any]] = []
            for r in rows:
                score = cosine_similarity(query_embedding, r["emb"])
                results.append({
                    "trade_id": r["trade_id"],
                    "symbol": r["symbol"],
                    "side": r["side"],
                    "score": score,
                })
            results.sort(key=lambda x: x["score"], reverse=True)
            return results[:limit]
        finally:
            conn.close()

    # ========================================================================
    # Statistics
    # ========================================================================

    def get_aggregate_stats(
        self,
        *,
        since: str | None = None,
        until: str | None = None,
        symbol: str | None = None,
    ) -> dict[str, Any]:
        """Aggregate performance metrics over closed/analyzed trades in a time window."""
        conditions: list[str] = ["(status = 'closed' OR status = 'analyzed')"]
        params: list[Any] = []
        if since:
            conditions.append("entry_ts >= ?")
            params.append(since)
        if until:
            conditions.append("entry_ts <= ?")
            params.append(until)
        if symbol:
            conditions.append("symbol = ?")
            params.append(symbol)

        where = "WHERE " + " AND ".join(conditions)

        conn = self._connect()
        try:
            row = conn.execute(
                f"""
                SELECT
                    COUNT(*) AS total_trades,
                    SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN realized_pnl_usd < 0 THEN 1 ELSE 0 END) AS losses,
                    SUM(realized_pnl_usd) AS total_pnl,
                    AVG(CASE WHEN realized_pnl_usd > 0 THEN realized_pnl_usd END) AS avg_win,
                    AVG(CASE WHEN realized_pnl_usd < 0 THEN realized_pnl_usd END) AS avg_loss,
                    MAX(realized_pnl_usd) AS best_trade,
                    MIN(realized_pnl_usd) AS worst_trade,
                    AVG(hold_duration_s) AS avg_hold_s
                FROM trades {where}
                """,
                params,
            ).fetchone()

            total = row["total_trades"] or 0
            wins = row["wins"] or 0
            win_rate = (wins / total * 100) if total else 0.0

            pf_row = conn.execute(
                f"""
                SELECT
                    SUM(CASE WHEN realized_pnl_usd > 0 THEN realized_pnl_usd ELSE 0 END) AS gross_profit,
                    SUM(CASE WHEN realized_pnl_usd < 0 THEN realized_pnl_usd ELSE 0 END) AS gross_loss
                FROM trades {where}
                """,
                params,
            ).fetchone()
            gross_profit = pf_row["gross_profit"] or 0
            gross_loss = abs(pf_row["gross_loss"] or 0)
            profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else 0.0

            return {
                "total_trades": total,
                "wins": wins,
                "losses": row["losses"] or 0,
                "win_rate": round(win_rate, 2),
                "total_pnl": row["total_pnl"] or 0,
                "avg_win": row["avg_win"] or 0,
                "avg_loss": row["avg_loss"] or 0,
                "profit_factor": round(profit_factor, 2),
                "best_trade": row["best_trade"] or 0,
                "worst_trade": row["worst_trade"] or 0,
                "avg_hold_s": int(row["avg_hold_s"] or 0),
            }
        finally:
            conn.close()

    # ========================================================================
    # Daemon compatibility methods (preserve StagingStore shape for drop-in swap)
    #
    # The daemon holds ``_journal_store`` as a polymorphic reference typed
    # ``StagingStore | JournalStore``. These three methods are the contract
    # that daemon.py:2249, daemon.py:4711, and daemon.py:4757 consume — their
    # signatures and return shapes must remain identical to StagingStore so
    # the phase-2 M7 swap is a drop-in type change. See architect delta 1 in
    # the M2 brief for rationale.
    # ========================================================================

    def get_entry_snapshot_json(self, trade_id: str) -> dict[str, Any] | None:
        """Return the parsed entry snapshot JSON dict, or None if absent.

        Used by daemon.py:2249 when building an exit snapshot — it needs
        cross-access to entry fields (symbol, side, entry_px, sl_px, tp_px)
        without the cost of hydrating the full dataclass tree.
        """
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT snapshot_json FROM trade_entry_snapshots WHERE trade_id = ?",
                (trade_id,),
            ).fetchone()
            if not row:
                return None
            result: dict[str, Any] = json.loads(row["snapshot_json"])
            return result
        finally:
            conn.close()

    def list_exit_snapshots_needing_counterfactuals(
        self,
    ) -> list[dict[str, Any]]:
        """Return exit snapshots whose counterfactuals were likely captured incomplete.

        Filter mirrors ``StagingStore``: an exit whose counterfactuals have
        ``did_tp_hit_later=False`` AND ``did_sl_get_hunted=False`` is a
        candidate for recomputation (these flags default to False when
        counterfactuals were computed synchronously at exit time without
        post-exit candle data).

        Returns list of ``{"trade_id": str, "exit_ts": str, "snapshot": dict}``
        where ``snapshot`` is the full parsed TradeExitSnapshot JSON. Consumed
        by daemon.py:4711 in ``_recompute_pending_counterfactuals()``.
        """
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT trade_id, snapshot_json
                FROM trade_exit_snapshots
                ORDER BY created_at ASC
                """,
            ).fetchall()
            results: list[dict[str, Any]] = []
            for r in rows:
                snap = json.loads(r["snapshot_json"])
                cf = snap.get("counterfactuals", {})
                if not cf.get("did_tp_hit_later") and not cf.get("did_sl_get_hunted"):
                    exit_ts = snap.get("trade_outcome", {}).get("exit_ts", "")
                    results.append({
                        "trade_id": r["trade_id"],
                        "exit_ts": exit_ts,
                        "snapshot": snap,
                    })
            return results
        finally:
            conn.close()

    def update_exit_snapshot(
        self, trade_id: str, snapshot: TradeExitSnapshot,
    ) -> None:
        """Overwrite an existing exit snapshot (used after counterfactual recompute).

        Re-serializes BOTH the full snapshot JSON and the counterfactuals JSON
        column so the two stay in sync. Does not touch the ``trades`` row or
        ``schema_version``/``created_at`` metadata. Consumed by daemon.py:4757.
        """
        snapshot_json = json.dumps(
            asdict(snapshot), sort_keys=True, separators=(",", ":"), default=str,
        )
        counterfactuals_json = json.dumps(
            asdict(snapshot.counterfactuals),
            sort_keys=True, separators=(",", ":"), default=str,
        )
        with self._write_lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    UPDATE trade_exit_snapshots
                    SET snapshot_json = ?,
                        counterfactuals_json = ?
                    WHERE trade_id = ?
                    """,
                    (snapshot_json, counterfactuals_json, trade_id),
                )
            finally:
                conn.close()
