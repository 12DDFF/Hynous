# Phase 2 — Journal Module

> **Prerequisites:** Phase 0 and Phase 1 complete and accepted. `00-master-plan.md`, `01-pre-implementation-reading.md`, `02-testing-standards.md` read in full.
>
> **Phase goal:** Build the full Python journal module that replaces Nous. SQLite schema, CRUD layer, embeddings, search, FastAPI routes. At the end of this phase, the staging store from phase 1 is promoted to the real journal store, and the phase 3 analysis agent has a home to write into.
>
> **What this phase does NOT do:** delete Nous (phase 4), build the analysis agent (phase 3), rework the dashboard to query the new API (phase 7). Phase 2 stands up the journal as a new parallel system. It does not yet take over from Nous.

---

## Context

Phase 2 is the replacement for the entire Nous TypeScript server. Nous in v1 is ~91K LOC of `@nous/core` modules implementing SSA retrieval, FSRS decay, sections, QCS, clusters, conflicts, consolidation, working memory, and a Hono HTTP server. v2 needs ~1% of that surface area: a persistence layer for trades, events, analyses, tags, edges, and patterns, plus embeddings for semantic search of trade records.

The phase replaces Nous with approximately 800 LOC of Python: one SQLite database, a clean dataclass-backed store, an embedding helper, and a FastAPI routes module that gets mounted into the main `hynous` service. No separate process, no pnpm, no TypeScript, no systemd unit for a memory server.

Phase 1 produced a staging store that contains exactly three tables (`trade_entry_snapshots_staging`, `trade_exit_snapshots_staging`, `trade_events_staging`). Phase 2 promotes this to a full schema with eight tables total, plus real API routes, embedding support, and a migration step that copies the phase 1 staging data into the production tables (this is an internal migration, not from Nous — Nous is still running alongside but we are not migrating anything from it).

After phase 2, the system has two memory backends running simultaneously:
1. **Nous** (v1) — still receives writes from `_store_trade_memory`, still serves dashboard /api/nous/* routes
2. **Journal** (v2) — receives phase 1 captures in the new tables, exposes /api/v2/journal/*

Phase 4 deletes Nous. Phase 7 switches the dashboard from /api/nous/* to /api/v2/journal/*.

---

## Required Reading for This Phase

In addition to the base reading list, phase 2 engineers must read:

1. **Phase 1 plan (`04-phase-1-data-capture.md`)** — full read. You're building on top of the schema.py and staging_store.py that phase 1 created.
2. **`src/hynous/nous/client.py`** — full read. Understand what the v1 Python client offered (the API you're replacing, at a behavioral level).
3. **`src/hynous/nous/sections.py`** — read to understand the section concept so you know why v2 does NOT have sections (trades are one category, no bias layer needed).
4. **`nous-server/core/src/forgetting/`** — skim. Understand FSRS decay exists in v1 and does NOT exist in v2 (trades don't "forget").
5. **`nous-server/core/src/ssa/`** — skim. Understand spreading activation exists in v1 and v2 uses plain SQL + cosine similarity instead.
6. **FastAPI documentation** — specifically route mounting, dependency injection, Pydantic response models. This is the first v2 phase that adds routes.
7. **SQLite WAL mode documentation** — v2 uses WAL for concurrent reads while the daemon writes.
8. **OpenAI embedding API documentation** — text-embedding-3-small, dimensions, truncation, batch calls.
9. **`dashboard/dashboard/dashboard.py`** — targeted read of the `/api/nous/*` proxy routes so you understand what the dashboard currently expects. Your new routes should be shape-compatible where possible to ease the phase 7 migration.
10. **`src/hynous/core/config.py`** — the existing `Config` loading pattern you'll extend with the v2 journal config (already set up in phase 0).

---

## Scope

### In Scope

- Complete SQLite schema with 8 tables (listed below)
- `JournalStore` class replacing `StagingStore` with full CRUD + query methods
- Migration from `staging.db` → `journal.db` preserving phase 1 data
- `EmbeddingClient` wrapping OpenAI text-embedding-3-small with caching, retries, and batch mode
- Semantic search over trade snapshots and analyses using cosine similarity
- FastAPI routes under `/api/v2/journal/*` mounted into the main dashboard app
- Pydantic response models for all API routes
- Unit tests for every public method of `JournalStore`, `EmbeddingClient`
- Integration tests for the API routes against a real `JournalStore` fixture
- README at `src/hynous/journal/README.md` documenting the module
- **Dataclass reconstruction helpers** in `src/hynous/journal/schema.py` (see "Dataclass Reconstruction Helpers" section below). Phase 1 persisted snapshots as JSON dicts and deliberately omitted the dict→dataclass reconstruction helper that the phase 1 plan had stubbed as `raise NotImplementedError`. Phase 2 ships them because `JournalStore.get_trade()` returns hydrated `TradeEntrySnapshot` / `TradeExitSnapshot` objects and phase 3's analysis agent reads those objects directly. See master plan Amendment 9.
- **Order flow + smart money backfill** in `src/hynous/journal/capture.py` (see "Order Flow & Smart Money Backfill" section below). Phase 1 shipped `_build_order_flow_state()` and `_build_smart_money_context()` as empty-dataclass placeholders pending a decision on data-layer integration. Phase 2 wires them to the existing data-layer HTTP endpoints (`hynous_data.order_flow`, `hlp_positions`, `whales`, `sm_changes`) so every entry snapshot carries real CVD / HLP / whale / smart-money context. See master plan Amendment 10.

### Out of Scope

- Deleting Nous (phase 4)
- Rewiring the dashboard to use `/api/v2/journal/*` instead of `/api/nous/*` (phase 7)
- The analysis agent that writes to `trade_analyses` (phase 3)
- Consolidation edges or pattern rollup (phase 6)
- User chat agent that queries the journal (phase 5 or later)

---

## Database Schema

The v2 journal database is `storage/v2/journal.db`. It replaces `storage/v2/staging.db` from phase 1 (a migration script transfers the data). The schema is eight tables.

### Full DDL

```sql
-- ============================================================================
-- Hynous v2 Journal Schema
-- Phase 2 creates this; phase 3 adds trade_analyses rows; phase 6 adds edges + patterns
-- ============================================================================

-- Schema version tracking
CREATE TABLE IF NOT EXISTS journal_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Bootstrap: insert schema version
INSERT OR IGNORE INTO journal_metadata (key, value, updated_at)
VALUES ('schema_version', '1.0.0', datetime('now'));

-- ============================================================================
-- Core: trades table (one row per trade, taken OR rejected)
-- ============================================================================
CREATE TABLE IF NOT EXISTS trades (
    trade_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,                     -- "long" | "short"
    trade_type TEXT NOT NULL,               -- "macro" | "micro"
    status TEXT NOT NULL,                   -- "open" | "closed" | "analyzed" | "rejected" | "failed"
    entry_ts TEXT,                          -- ISO 8601, NULL for rejected signals
    entry_px REAL,
    exit_ts TEXT,
    exit_px REAL,
    exit_classification TEXT,               -- "dynamic_protective_sl" | "breakeven_stop" | "trailing_stop" | "tp_hit" | "manual_close" | "liquidation" | "stop_loss" | NULL for open/rejected
    realized_pnl_usd REAL,
    roe_pct REAL,
    hold_duration_s INTEGER,
    peak_roe REAL,
    trough_roe REAL,
    leverage INTEGER,
    size_usd REAL,
    margin_usd REAL,
    trigger_source TEXT,                    -- "scanner" | "ml_signal" | "manual"
    trigger_type TEXT,
    rejection_reason TEXT,                  -- NULL unless status='rejected'; which gate rejected
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_entry_ts ON trades(entry_ts);
CREATE INDEX IF NOT EXISTS idx_trades_exit_classification ON trades(exit_classification);
CREATE INDEX IF NOT EXISTS idx_trades_rejection_reason ON trades(rejection_reason);

-- ============================================================================
-- Entry snapshots: rich JSON blob per trade (one row per trade)
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_entry_snapshots (
    trade_id TEXT PRIMARY KEY REFERENCES trades(trade_id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL,            -- full TradeEntrySnapshot dataclass serialized
    embedding BLOB,                         -- 1536d float32 of entry context vector
    schema_version TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- ============================================================================
-- Exit snapshots: rich JSON blob per closed trade (one row per closed trade)
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_exit_snapshots (
    trade_id TEXT PRIMARY KEY REFERENCES trades(trade_id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL,            -- full TradeExitSnapshot dataclass serialized
    counterfactuals_json TEXT NOT NULL,     -- separately queryable counterfactual section
    schema_version TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- ============================================================================
-- Lifecycle events: discrete mechanical events during hold
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
    ts TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_trade_id ON trade_events(trade_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON trade_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_trade_type ON trade_events(trade_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_ts ON trade_events(ts);

-- ============================================================================
-- Trade analyses: LLM-produced evidence-backed narratives (phase 3 populates this)
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_analyses (
    trade_id TEXT PRIMARY KEY REFERENCES trades(trade_id) ON DELETE CASCADE,
    narrative TEXT NOT NULL,
    narrative_citations_json TEXT NOT NULL, -- list of {paragraph_idx, finding_ids}
    findings_json TEXT NOT NULL,            -- list of structured findings with evidence refs
    grades_json TEXT NOT NULL,              -- {entry_quality, entry_timing, sl_placement, tp_placement, size_leverage, exit_quality}
    mistake_tags TEXT NOT NULL,             -- comma-separated tags from fixed vocabulary
    process_quality_score INTEGER NOT NULL, -- 0-100
    one_line_summary TEXT NOT NULL,
    unverified_claims_json TEXT,            -- JSON list of claims LLM made without evidence, or NULL
    model_used TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    analysis_ts TEXT NOT NULL,
    embedding BLOB,                         -- 1536d float32 of narrative vector for semantic search
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analyses_process_quality ON trade_analyses(process_quality_score);
CREATE INDEX IF NOT EXISTS idx_analyses_analysis_ts ON trade_analyses(analysis_ts);

-- ============================================================================
-- Tags: free-form labels attached to trades
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_tags (
    trade_id TEXT NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    source TEXT NOT NULL,                   -- "llm" | "manual" | "auto"
    created_at TEXT NOT NULL,
    PRIMARY KEY (trade_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON trade_tags(tag);

-- ============================================================================
-- Edges: relationships between trades (phase 6 populates this)
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_trade_id TEXT NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
    target_trade_id TEXT NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL,                -- "preceded_by" | "followed_by" | "same_regime_bucket" | "same_rejection_reason" | "rejection_vs_contemporaneous_trade"
    strength REAL,
    reason TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (source_trade_id, target_trade_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON trade_edges(source_trade_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON trade_edges(target_trade_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON trade_edges(edge_type);

-- ============================================================================
-- Patterns: weekly rollup aggregates (phase 6 populates this)
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_patterns (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    pattern_type TEXT NOT NULL,             -- "mistake_cluster" | "rejection_reason_cluster" | "regime_performance" | "grade_distribution"
    aggregate_json TEXT NOT NULL,           -- the aggregated data (counts, win rate, avg pnl, etc.)
    member_trade_ids_json TEXT NOT NULL,    -- JSON array of trade_ids included
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patterns_type ON trade_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_window ON trade_patterns(window_start, window_end);
```

### Schema notes

- **No sections table.** Unlike Nous, trades are one category. The v1 4-section bias layer is removed.
- **No decay fields.** Unlike Nous `neural_stability`, `neural_retrievability`, `neural_difficulty`, `neural_access_count`, `neural_last_accessed` — none of these exist. Trades don't forget.
- **No lifecycle states.** Trades have status (open/closed/analyzed/rejected) but no WEAK/DORMANT/SUMMARIZED/ARCHIVED states. A trade is a fact; it doesn't decay into abstraction.
- **No FTS5.** Dashboard queries trades by SQL filters (symbol, status, date). Semantic search is cosine over embedding columns. No full-text virtual table.
- **No conflict_queue.** No contradictions in a journal — every trade is what it is.
- **No clusters table.** The old Nous clusters table was for organizing memories. v2 uses `trade_patterns` and `trade_tags` for organizational overlay.

---

## JournalStore Class

The main persistence API. Replaces `StagingStore` and subsumes the v1 `NousClient` functionality that actually matters.

### File layout

```
src/hynous/journal/
├── __init__.py              # public exports
├── schema.py                # dataclasses (from phase 1) + DDL constant
├── store.py                 # JournalStore class (this phase)
├── embeddings.py            # EmbeddingClient (this phase)
├── counterfactuals.py       # from phase 1
├── capture.py               # from phase 1
├── api.py                   # FastAPI routes (this phase)
├── migrate_staging.py       # one-shot staging→journal migration (this phase)
├── README.md                # module documentation (this phase)
└── [phase 2 does NOT delete staging_store.py yet — phase 4 does]
```

### JournalStore implementation

```python
# src/hynous/journal/store.py

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import struct
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .schema import (
    LifecycleEvent,
    TradeEntrySnapshot,
    TradeExitSnapshot,
    SCHEMA_DDL,
)

logger = logging.getLogger(__name__)


class JournalStore:
    """Production journal store. Replaces Nous entirely.
    
    Thread-safe via connection-per-operation pattern with a write lock.
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
            isolation_level=None,  # autocommit mode; we use explicit transactions
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
        """No-op since connections are per-operation, but exposed for symmetry."""
        pass
    
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
        
        Called from:
        - execute_trade path when a new entry fires (status='open')
        - daemon trigger close path when exit is recorded (status='closed')
        - analysis agent after producing analysis (status='analyzed')
        - rejection recording path (status='rejected')
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
        """Return the full trade bundle: row + entry snapshot + exit snapshot + events + analysis."""
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM trades WHERE trade_id = ?", (trade_id,)).fetchone()
            if not row:
                return None
            
            result: dict[str, Any] = dict(row)
            
            # Entry snapshot
            entry_row = conn.execute(
                "SELECT snapshot_json, schema_version FROM trade_entry_snapshots WHERE trade_id = ?",
                (trade_id,),
            ).fetchone()
            result["entry_snapshot"] = json.loads(entry_row["snapshot_json"]) if entry_row else None
            
            # Exit snapshot
            exit_row = conn.execute(
                "SELECT snapshot_json, counterfactuals_json FROM trade_exit_snapshots WHERE trade_id = ?",
                (trade_id,),
            ).fetchone()
            result["exit_snapshot"] = json.loads(exit_row["snapshot_json"]) if exit_row else None
            result["counterfactuals"] = json.loads(exit_row["counterfactuals_json"]) if exit_row else None
            
            # Events
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
                    "narrative_citations": json.loads(analysis_row["narrative_citations_json"]),
                    "findings": json.loads(analysis_row["findings_json"]),
                    "grades": json.loads(analysis_row["grades_json"]),
                    "mistake_tags": analysis_row["mistake_tags"].split(",") if analysis_row["mistake_tags"] else [],
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
            result["tags"] = [{"tag": r["tag"], "source": r["source"]} for r in tag_rows]
            
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
        """List trades with SQL filter."""
        conditions = []
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
        
        where = "WHERE " + " AND ".join(conditions) if conditions else ""
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
        """Persist an entry snapshot + upsert parent trade row."""
        # First, upsert the parent trade row
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
        
        # Then insert the rich snapshot
        json_str = json.dumps(asdict(snapshot), sort_keys=True, separators=(",", ":"), default=str)
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
        """Persist an exit snapshot + mark the parent trade as closed."""
        # Update parent trade row
        self.upsert_trade(
            trade_id=snapshot.trade_id,
            symbol="",  # already set at entry; ON CONFLICT will preserve
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
        
        # Insert the rich exit snapshot
        snapshot_json = json.dumps(asdict(snapshot), sort_keys=True, separators=(",", ":"), default=str)
        counterfactuals_json = json.dumps(asdict(snapshot.counterfactuals), sort_keys=True, separators=(",", ":"), default=str)
        now_iso = datetime.now(timezone.utc).isoformat()
        
        with self._write_lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO trade_exit_snapshots (
                        trade_id, snapshot_json, counterfactuals_json, schema_version, created_at
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
        """Persist a lifecycle event (called from daemon state mutations)."""
        now_iso = datetime.now(timezone.utc).isoformat()
        payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        
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
        """Get all lifecycle events for a trade in chronological order."""
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
    # Trade analyses (phase 3 populates, phase 2 exposes read API)
    # ========================================================================
    
    def insert_analysis(
        self,
        *,
        trade_id: str,
        narrative: str,
        narrative_citations: list[dict],
        findings: list[dict],
        grades: dict[str, int],
        mistake_tags: list[str],
        process_quality_score: int,
        one_line_summary: str,
        unverified_claims: list[dict] | None,
        model_used: str,
        prompt_version: str,
        embedding: bytes | None = None,
    ) -> None:
        """Persist an analysis + update trade status to 'analyzed'."""
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
                        trade_id, narrative,
                        json.dumps(narrative_citations, sort_keys=True, separators=(",", ":")),
                        json.dumps(findings, sort_keys=True, separators=(",", ":")),
                        json.dumps(grades, sort_keys=True, separators=(",", ":")),
                        ",".join(mistake_tags),
                        process_quality_score,
                        one_line_summary,
                        json.dumps(unverified_claims, sort_keys=True, separators=(",", ":")) if unverified_claims else None,
                        model_used,
                        prompt_version,
                        analysis_ts,
                        embedding,
                        analysis_ts,
                    ),
                )
                # Upgrade trade status
                conn.execute(
                    "UPDATE trades SET status = 'analyzed', updated_at = ? WHERE trade_id = ?",
                    (analysis_ts, trade_id),
                )
            finally:
                conn.close()
    
    def get_analysis(self, trade_id: str) -> dict[str, Any] | None:
        """Return the analysis for a trade, or None."""
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
                "mistake_tags": row["mistake_tags"].split(",") if row["mistake_tags"] else [],
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
        """Attach a tag to a trade."""
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
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT tag, source, created_at FROM trade_tags WHERE trade_id = ? ORDER BY created_at ASC",
                (trade_id,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()
    
    def list_trades_by_tag(self, tag: str, limit: int = 100) -> list[str]:
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
    # Semantic search
    # ========================================================================
    
    def search_semantic(
        self,
        *,
        query_embedding: bytes,
        scope: str = "entry",  # "entry" | "analysis" | "both"
        limit: int = 20,
        symbol: str | None = None,
    ) -> list[dict[str, Any]]:
        """Search trades by cosine similarity to a query embedding.
        
        Brute-force scan with cosine in Python — acceptable for ≤ 10k trades.
        If scale grows beyond that, switch to sqlite-vec extension.
        """
        from .embeddings import cosine_similarity
        
        # NOTE: the `embedding` column lives on a different table per scope
        # (trade_entry_snapshots.embedding for "entry",
        # trade_analyses.embedding for "analysis"). Qualify the column
        # with its table alias in every branch — an unqualified
        # `embedding IS NOT NULL` would be ambiguous once the JOINs
        # are in place. Build the WHERE conditions per-branch rather
        # than sharing a single list.
        params: list[Any] = []
        if symbol:
            params.append(symbol)
        
        conn = self._connect()
        try:
            if scope == "entry":
                where_parts = ["tes.embedding IS NOT NULL"]
                if symbol:
                    where_parts.append("t.symbol = ?")
                rows = conn.execute(
                    f"""
                    SELECT t.trade_id, t.symbol, t.side, tes.embedding
                    FROM trades t
                    JOIN trade_entry_snapshots tes ON t.trade_id = tes.trade_id
                    WHERE {" AND ".join(where_parts)}
                    """,
                    params,
                ).fetchall()
            elif scope == "analysis":
                where_parts = ["ta.embedding IS NOT NULL"]
                if symbol:
                    where_parts.append("t.symbol = ?")
                rows = conn.execute(
                    f"""
                    SELECT t.trade_id, t.symbol, t.side, ta.embedding
                    FROM trades t
                    JOIN trade_analyses ta ON t.trade_id = ta.trade_id
                    WHERE {" AND ".join(where_parts)}
                    """,
                    params,
                ).fetchall()
            else:
                raise ValueError(f"unsupported scope: {scope}")
            
            results = []
            for r in rows:
                score = cosine_similarity(query_embedding, r["embedding"])
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
        """Compute aggregate performance stats over a time window."""
        conditions = ["status = 'closed' OR status = 'analyzed'"]
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
            
            # Profit factor: sum of wins / abs(sum of losses)
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
            profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0.0
            
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
```

---

## Embedding Client

```python
# src/hynous/journal/embeddings.py

from __future__ import annotations

import json
import logging
import os
import struct
import time
from dataclasses import dataclass
from typing import Any

import requests

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "text-embedding-3-small"
DEFAULT_DIM = 1536
COMPARISON_DIM = 512  # truncation for fast cosine, matryoshka-style


class EmbeddingClient:
    """Wraps OpenAI text-embedding-3-small with caching, retries, batching."""
    
    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str = DEFAULT_MODEL,
        dim: int = DEFAULT_DIM,
        comparison_dim: int = COMPARISON_DIM,
        timeout_s: float = 30.0,
    ) -> None:
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self._api_key:
            raise RuntimeError("OPENAI_API_KEY not set")
        self._model = model
        self._dim = dim
        self._comparison_dim = comparison_dim
        self._timeout_s = timeout_s
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        })
    
    def embed(self, text: str) -> bytes:
        """Get embedding for a single text, return as float32 bytes (truncated to comparison_dim)."""
        return self.embed_batch([text])[0]
    
    def embed_batch(self, texts: list[str]) -> list[bytes]:
        """Batch embedding call. Returns one bytes blob per input text."""
        if not texts:
            return []
        
        # Cap text length to avoid token limit issues (8191 tokens for text-embedding-3-small)
        # Use char count as a rough proxy (1 token ≈ 4 chars for English)
        capped = [t[:30000] for t in texts]
        
        retries = 3
        last_error = None
        for attempt in range(retries):
            try:
                response = self._session.post(
                    "https://api.openai.com/v1/embeddings",
                    json={
                        "model": self._model,
                        "input": capped,
                        "encoding_format": "float",
                    },
                    timeout=self._timeout_s,
                )
                response.raise_for_status()
                data = response.json()
                
                result = []
                for item in data["data"]:
                    vec = item["embedding"]
                    # Truncate to comparison_dim (matryoshka)
                    truncated = vec[:self._comparison_dim]
                    # Pack as float32 bytes
                    packed = struct.pack(f"{len(truncated)}f", *truncated)
                    result.append(packed)
                return result
            
            except requests.exceptions.HTTPError as e:
                last_error = e
                if e.response is not None and e.response.status_code == 429:
                    backoff = 2 ** attempt
                    logger.warning("OpenAI embedding rate limited, backoff %ds", backoff)
                    time.sleep(backoff)
                    continue
                raise
            except requests.exceptions.RequestException as e:
                last_error = e
                if attempt < retries - 1:
                    time.sleep(1)
                    continue
                raise
        
        raise RuntimeError(f"Embedding failed after {retries} retries: {last_error}")


def cosine_similarity(a_bytes: bytes, b_bytes: bytes) -> float:
    """Cosine similarity between two float32 byte blobs."""
    if not a_bytes or not b_bytes or len(a_bytes) != len(b_bytes):
        return 0.0
    
    n = len(a_bytes) // 4
    a = struct.unpack(f"{n}f", a_bytes)
    b = struct.unpack(f"{n}f", b_bytes)
    
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    
    if norm_a == 0 or norm_b == 0:
        return 0.0
    
    return dot / (norm_a * norm_b)


def build_entry_embedding_text(snapshot_dict: dict[str, Any]) -> str:
    """Build the text representation of an entry snapshot for embedding.
    
    The LLM analysis agent's embeddings need to capture the 'essence' of a
    trade setup — what signals were firing, what the market looked like.
    This function converts a TradeEntrySnapshot dict into a concise text
    description suitable for semantic search.
    """
    parts = []
    basics = snapshot_dict.get("trade_basics", {})
    ml = snapshot_dict.get("ml_snapshot", {})
    market = snapshot_dict.get("market_state", {})
    derivs = snapshot_dict.get("derivatives_state", {})
    trigger = snapshot_dict.get("trigger_context", {})
    
    parts.append(f"{basics.get('symbol')} {basics.get('side')} {basics.get('leverage')}x at {basics.get('entry_px')}")
    parts.append(f"trigger: {trigger.get('trigger_source')} {trigger.get('trigger_type')}")
    parts.append(f"composite entry score: {ml.get('composite_entry_score')} {ml.get('composite_label')}")
    parts.append(f"vol regime: {ml.get('vol_1h_regime')} value {ml.get('vol_1h_value')}")
    parts.append(f"entry quality pctl: {ml.get('entry_quality_percentile')}")
    parts.append(f"direction signal: {ml.get('direction_signal')}")
    parts.append(f"funding: {derivs.get('funding_rate')} oi: {derivs.get('open_interest')}")
    parts.append(f"1h change: {market.get('pct_change_1h')}%")
    return " | ".join(p for p in parts if p)
```

---

## FastAPI Routes

```python
# src/hynous/journal/api.py

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .store import JournalStore


router = APIRouter(prefix="/api/v2/journal", tags=["journal"])
_store: JournalStore | None = None


def set_store(store: JournalStore) -> None:
    """Called during application startup to inject the store."""
    global _store
    _store = store


def _require_store() -> JournalStore:
    if _store is None:
        raise HTTPException(status_code=503, detail="Journal store not initialized")
    return _store


# ============================================================================
# Pydantic response models
# ============================================================================

class TradeSummary(BaseModel):
    trade_id: str
    symbol: str
    side: str
    status: str
    entry_ts: str | None
    entry_px: float | None
    exit_ts: str | None
    exit_px: float | None
    exit_classification: str | None
    realized_pnl_usd: float | None
    roe_pct: float | None
    hold_duration_s: int | None
    peak_roe: float | None
    leverage: int | None


class AggregateStats(BaseModel):
    total_trades: int
    wins: int
    losses: int
    win_rate: float
    total_pnl: float
    avg_win: float
    avg_loss: float
    profit_factor: float
    best_trade: float
    worst_trade: float
    avg_hold_s: int


# ============================================================================
# Routes
# ============================================================================

@router.get("/trades", response_model=list[TradeSummary])
def list_trades_endpoint(
    symbol: str | None = Query(None),
    status: str | None = Query(None),
    exit_classification: str | None = Query(None),
    since: str | None = Query(None),
    until: str | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
):
    store = _require_store()
    trades = store.list_trades(
        symbol=symbol, status=status, exit_classification=exit_classification,
        since=since, until=until, limit=limit, offset=offset,
    )
    return [TradeSummary(**t) for t in trades]


@router.get("/trades/{trade_id}")
def get_trade_endpoint(trade_id: str) -> dict[str, Any]:
    store = _require_store()
    trade = store.get_trade(trade_id)
    if trade is None:
        raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")
    return trade


@router.get("/trades/{trade_id}/events")
def get_trade_events_endpoint(trade_id: str) -> list[dict[str, Any]]:
    store = _require_store()
    return store.get_events_for_trade(trade_id)


@router.get("/trades/{trade_id}/analysis")
def get_trade_analysis_endpoint(trade_id: str) -> dict[str, Any]:
    store = _require_store()
    analysis = store.get_analysis(trade_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail=f"No analysis for trade {trade_id}")
    return analysis


@router.get("/stats", response_model=AggregateStats)
def get_stats_endpoint(
    symbol: str | None = Query(None),
    since: str | None = Query(None),
    until: str | None = Query(None),
):
    store = _require_store()
    stats = store.get_aggregate_stats(since=since, until=until, symbol=symbol)
    return AggregateStats(**stats)


@router.get("/search")
def search_trades_endpoint(
    q: str = Query(..., description="Search query text"),
    scope: str = Query("entry", regex="^(entry|analysis)$"),
    limit: int = Query(20, le=100),
    symbol: str | None = Query(None),
) -> list[dict[str, Any]]:
    store = _require_store()
    from .embeddings import EmbeddingClient
    try:
        client = EmbeddingClient()
        query_embedding = client.embed(q)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {e}")
    
    return store.search_semantic(
        query_embedding=query_embedding,
        scope=scope,
        limit=limit,
        symbol=symbol,
    )


@router.post("/trades/{trade_id}/tags")
def add_trade_tag_endpoint(trade_id: str, tag: str = Query(...)):
    store = _require_store()
    store.add_tag(trade_id, tag, source="manual")
    return {"status": "ok", "trade_id": trade_id, "tag": tag}


@router.delete("/trades/{trade_id}/tags/{tag}")
def remove_trade_tag_endpoint(trade_id: str, tag: str):
    store = _require_store()
    store.remove_tag(trade_id, tag)
    return {"status": "ok"}


@router.get("/health")
def health_endpoint():
    store = _require_store()
    return {"status": "ok", "db_path": store._db_path}
```

### Mounting in the dashboard

In `dashboard/dashboard/dashboard.py`, add at application startup:

```python
# Near the top, alongside other imports
from hynous.journal.store import JournalStore
from hynous.journal.api import router as journal_router, set_store as set_journal_store

# In the app initialization block (find where `app._api` is available)
def initialize_journal(cfg):
    store = JournalStore(
        db_path=cfg.v2.journal.db_path,
        busy_timeout_ms=cfg.v2.journal.busy_timeout_ms,
    )
    set_journal_store(store)
    app._api.include_router(journal_router)
    return store

# Call during startup (find the appropriate hook)
```

---

## Migration from Staging

```python
# src/hynous/journal/migrate_staging.py

from __future__ import annotations

import json
import logging
from pathlib import Path

from .store import JournalStore
from .staging_store import StagingStore

logger = logging.getLogger(__name__)


def migrate_staging_to_journal(
    staging_db_path: str,
    journal_db_path: str,
) -> dict[str, int]:
    """Copy all data from the phase 1 staging DB into the phase 2 journal DB.
    
    Idempotency is asymmetric:
      - Snapshots use `ON CONFLICT(trade_id) DO UPDATE` — safe to re-run.
      - Lifecycle events have an autoincrement PK and will RE-INSERT on
        re-run, producing duplicates.
    
    Therefore callers MUST guard against re-runs. The daemon does this
    via `journal_metadata.staging_migration_done` (set to `"true"` once)
    and refuses to call this function a second time. If you call this
    function directly (e.g. from a one-off script), ensure the journal
    DB is fresh or drop `trade_events` rows first.
    
    Returns counts of migrated records.
    """
    if not Path(staging_db_path).exists():
        logger.info("No staging DB at %s, nothing to migrate", staging_db_path)
        return {"entries": 0, "exits": 0, "events": 0}
    
    staging = StagingStore(staging_db_path)
    journal = JournalStore(journal_db_path)
    
    counts = {"entries": 0, "exits": 0, "events": 0}
    
    # Migrate entry snapshots
    # ... (SQL scan over staging tables, convert rows, call journal.insert_entry_snapshot)
    # This is straightforward; engineer implements it following the pattern.
    
    # Migrate exit snapshots
    # ... similar
    
    # Migrate lifecycle events
    # ... similar
    
    return counts
```

---

## Dataclass Reconstruction Helpers

> **Resolves master plan Amendment 9 (Gotcha 1).** Phase 1's `staging_store.py` ships `get_entry_snapshot_json(trade_id) -> dict | None` instead of the plan-sketched `get_entry_snapshot(trade_id) -> TradeEntrySnapshot | None`. The `_dict_to_entry_snapshot` helper was left unimplemented. Phase 2's `JournalStore.get_trade()` returns a hydrated bundle (with `entry_snapshot` and `exit_snapshot` as real dataclass instances, not dicts), so the reconstruction helpers must exist and must be verified empirically before the analysis agent in phase 3 reads them.

### Step order

Reconstruction helpers are the **first code written in phase 2**. They live in `src/hynous/journal/schema.py` alongside the dataclass definitions themselves (schema is the single source of truth for the round-trip contract). Phase 2 Step 1: add the helpers and their unit tests. Only then proceed to `store.py`.

### File additions

Add to the **bottom** of `src/hynous/journal/schema.py`:

```python
# ============================================================================
# Reconstruction helpers (phase 2)
#
# Phase 1 persists dataclass instances as JSON (via dataclasses.asdict + json.dumps).
# Phase 2 needs the reverse direction so JournalStore.get_trade() can return typed
# objects to the analysis agent. These helpers are exhaustive — they enumerate
# every nested dataclass field explicitly. Do NOT attempt to collapse into a
# generic recursive walker; the dataclasses have irregular shapes (list[dict]
# fields like `clusters_above`, `top_whale_positions`, `direction_shap_top5`,
# `candles_1m_15min` stay as-is).
# ============================================================================


def entry_snapshot_from_dict(data: dict[str, Any]) -> TradeEntrySnapshot:
    """Reconstruct a TradeEntrySnapshot from a JSON-loaded dict.

    Args:
        data: dict previously produced by dataclasses.asdict(snapshot). Must
            contain every top-level key of TradeEntrySnapshot.

    Raises:
        KeyError: if a required top-level key is missing (indicates schema drift
            or a corrupt row — caller should log and skip, not swallow).
        TypeError: if a field has an unexpected shape.

    Returns:
        Fully-hydrated TradeEntrySnapshot with every nested dataclass instantiated.
    """
    return TradeEntrySnapshot(
        trade_basics=TradeBasics(**data["trade_basics"]),
        trigger_context=TriggerContext(**data["trigger_context"]),
        ml_snapshot=MLSnapshot(**data["ml_snapshot"]),
        market_state=MarketState(**data["market_state"]),
        derivatives_state=DerivativesState(**data["derivatives_state"]),
        liquidation_terrain=LiquidationTerrain(**data["liquidation_terrain"]),
        order_flow_state=OrderFlowState(**data["order_flow_state"]),
        smart_money_context=SmartMoneyContext(**data["smart_money_context"]),
        time_context=TimeContext(**data["time_context"]),
        account_context=AccountContext(**data["account_context"]),
        settings_snapshot=SettingsSnapshot(**data["settings_snapshot"]),
        price_history=PriceHistoryContext(**data["price_history"]),
        schema_version=data.get("schema_version", "1.0.0"),
    )


def exit_snapshot_from_dict(data: dict[str, Any]) -> TradeExitSnapshot:
    """Reconstruct a TradeExitSnapshot from a JSON-loaded dict. Contract mirrors
    entry_snapshot_from_dict."""
    return TradeExitSnapshot(
        trade_id=data["trade_id"],
        trade_outcome=TradeOutcome(**data["trade_outcome"]),
        roe_trajectory=ROETrajectory(**data["roe_trajectory"]),
        counterfactuals=Counterfactuals(**data["counterfactuals"]),
        ml_exit_comparison=MLExitComparison(**data["ml_exit_comparison"]),
        market_state_at_exit=MarketState(**data["market_state_at_exit"]),
        price_path_1m=data.get("price_path_1m", []),
        schema_version=data.get("schema_version", "1.0.0"),
    )
```

### JournalStore integration

`JournalStore.get_trade(trade_id)` uses the helpers to hydrate:

```python
def get_trade(self, trade_id: str) -> dict[str, Any] | None:
    # ... (SELECT row + associated entry/exit/events/analysis)
    bundle = {...}  # as per JournalStore class spec above

    if entry_row is not None:
        from .schema import entry_snapshot_from_dict
        bundle["entry_snapshot"] = entry_snapshot_from_dict(
            json.loads(entry_row["snapshot_json"])
        )
    else:
        bundle["entry_snapshot"] = None

    if exit_row is not None:
        from .schema import exit_snapshot_from_dict
        bundle["exit_snapshot"] = exit_snapshot_from_dict(
            json.loads(exit_row["snapshot_json"])
        )
    else:
        bundle["exit_snapshot"] = None

    # counterfactuals separately queryable (stored in trade_exit_snapshots.counterfactuals_json)
    # events, analysis, tags — unchanged
    return bundle
```

**Why not hydrate during `get_entry_snapshot_json()` in the staging store?** Staging is ephemeral; phase 2 deletes it. Do not backport the helpers into `staging_store.py`.

### Round-trip unit tests (mandatory)

Add to `tests/unit/test_v2_journal.py` — the empirical verification the user specifically asked for. These tests **must pass before any other phase 2 code is written**:

```python
def test_entry_snapshot_round_trip_preserves_every_field(sample_entry_snapshot):
    """asdict → json.dumps → json.loads → entry_snapshot_from_dict returns an
    instance equal to the original (all nested fields preserved)."""
    from dataclasses import asdict
    import json
    from hynous.journal.schema import entry_snapshot_from_dict
    
    original = sample_entry_snapshot
    serialized = json.dumps(asdict(original), sort_keys=True, separators=(",", ":"), default=str)
    restored = entry_snapshot_from_dict(json.loads(serialized))
    
    assert restored == original  # dataclass __eq__ walks all fields


def test_exit_snapshot_round_trip_preserves_every_field(sample_exit_snapshot):
    """Same contract for TradeExitSnapshot."""
    from dataclasses import asdict
    import json
    from hynous.journal.schema import exit_snapshot_from_dict
    
    original = sample_exit_snapshot
    serialized = json.dumps(asdict(original), sort_keys=True, separators=(",", ":"), default=str)
    restored = exit_snapshot_from_dict(json.loads(serialized))
    
    assert restored == original


def test_entry_snapshot_from_dict_raises_keyerror_on_missing_section():
    """Missing a top-level section (schema drift / corrupt row) raises KeyError —
    caller's responsibility to catch and skip, not swallow here."""
    import pytest
    from hynous.journal.schema import entry_snapshot_from_dict
    
    with pytest.raises(KeyError):
        entry_snapshot_from_dict({"trade_basics": {}})  # missing everything else


def test_get_trade_hydrates_nested_dataclasses(tmp_journal_db, sample_entry_snapshot):
    """End-to-end: insert → get_trade → returned bundle has real dataclass instances
    at entry_snapshot / exit_snapshot keys, not raw dicts."""
    from hynous.journal.schema import TradeEntrySnapshot
    
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    bundle = tmp_journal_db.get_trade(sample_entry_snapshot.trade_basics.trade_id)
    
    assert isinstance(bundle["entry_snapshot"], TradeEntrySnapshot)
    assert bundle["entry_snapshot"].trade_basics.symbol == sample_entry_snapshot.trade_basics.symbol
    assert bundle["entry_snapshot"].ml_snapshot.composite_entry_score == sample_entry_snapshot.ml_snapshot.composite_entry_score
```

Run these four tests in isolation:

```bash
pytest tests/unit/test_v2_journal.py -v -k "round_trip or hydrates or raises_keyerror"
```

All four must pass before phase 2 proceeds past Step 1.

### Empirical verification during smoke test

After the phase 2 15-minute smoke test completes and at least one trade has been written, run this ad-hoc check to confirm hydration works on real captured data (not just fixtures):

```bash
python -c "
from hynous.journal.store import JournalStore
from hynous.core.config import load_config
cfg = load_config()
store = JournalStore(cfg.v2.journal.db_path)
trades = store.list_trades(limit=5)
if not trades:
    print('No trades captured during smoke — rerun with a longer window')
else:
    for t in trades:
        bundle = store.get_trade(t['trade_id'])
        assert bundle['entry_snapshot'] is not None
        assert bundle['entry_snapshot'].trade_basics.trade_id == t['trade_id']
        print(f'hydration ok: {t[\"trade_id\"]} ({t[\"symbol\"]} {t[\"side\"]})')
"
```

Report the output as part of the phase 2 report-back.

---

## Order Flow & Smart Money Backfill

> **Resolves master plan Amendment 10 (Gotcha 2).** Phase 1's `_build_order_flow_state()` and `_build_smart_money_context()` return empty `OrderFlowState()` / `SmartMoneyContext()` instances with every field `None` / empty list. Phase 2 backfills them against the existing data-layer service so entry snapshots carry real CVD / HLP / whale / smart-money context. Phase 3's analysis agent rules depend on these fields being populated.

### Data-layer surface (verified 2026-04-12)

The `hynous_data.py` client (`src/hynous/data/providers/hynous_data.py`) already exposes every method needed. No new client methods required for the fields marked "supported" below; the two unsupported fields require small data-layer additions called out in the "Data-layer additions" subsection.

| `OrderFlowState` field | Source endpoint | Mapping |
|------------------------|-----------------|---------|
| `cvd_1h` | `order_flow(coin)` → `windows["1h"]["cvd"]` | direct |
| `cvd_acceleration` | computed client-side | `windows["5m"]["cvd"] - (windows["15m"]["cvd"] / 3)` (5m actual vs. 1/3 of the 15m accumulation as a trailing baseline) |
| `buy_sell_ratio_1m` | `order_flow(coin)` → `windows["1m"]["buy_pct"] / 100.0` | direct |
| `buy_sell_ratio_5m` | `order_flow(coin)` → `windows["5m"]["buy_pct"] / 100.0` | direct |
| `buy_sell_ratio_15m` | `order_flow(coin)` → `windows["15m"]["buy_pct"] / 100.0` | direct |
| `buy_sell_ratio_1h` | `order_flow(coin)` → `windows["1h"]["buy_pct"] / 100.0` | direct |
| `cvd_30m` | **requires data-layer addition** — see below | via new `windows["30m"]` key |
| `large_trade_count_1h` | **requires data-layer addition** — see below | via new endpoint |

| `SmartMoneyContext` field | Source endpoint | Mapping |
|---------------------------|-----------------|---------|
| `hlp_net_delta_usd` | `hlp_positions()` → sum(size_usd where coin=symbol AND side=="long") − sum(where side=="short"). If only one side present for the symbol, net equals signed size. | client-side filter + aggregate |
| `hlp_side` | derived from `hlp_net_delta_usd`: `"long"` if > 0, `"short"` if < 0, `"flat"` if 0 or no positions | client-side |
| `hlp_size_usd` | `hlp_positions()` → total size_usd for the symbol (ignores sign) | client-side filter + sum |
| `top_whale_positions` | `whales(coin, top_n=5)` → `positions` list (already size-sorted DESC by `size_usd`) | direct, take all 5 |
| `smart_money_opens_1h` | `sm_changes(minutes=60)` → count of entries in the response where the coin matches | client-side filter + count |

The exact `order_flow()` response shape was verified against `data-layer/src/hynous_data/engine/order_flow.py`:

```python
{
    "coin": str,
    "total_trades": int,
    "windows": {
        "1m":  {"window_seconds": 60,   "buy_volume_usd": float, "sell_volume_usd": float, "cvd": float, "buy_count": int, "sell_count": int, "buy_pct": float},
        "5m":  {"window_seconds": 300,  ...},
        "15m": {"window_seconds": 900,  ...},
        "1h":  {"window_seconds": 3600, ...},
    }
}
```

Default windows are `[60, 300, 900, 3600]` — no 30m key today.

### Data-layer additions (required)

Two small additions to `data-layer/src/hynous_data/engine/order_flow.py` to make the full schema populable. Both are purely additive and do not change existing endpoint contracts.

**1. Add 1800s (30m) to the default windows list.**

```python
# data-layer/src/hynous_data/engine/order_flow.py, __init__
def __init__(self, windows: list[int] | None = None):
    self._windows = windows or [60, 300, 900, 1800, 3600]  # 1m, 5m, 15m, 30m, 1h
```

The existing label logic (`window_s // 60` for `< 3600`) produces `"30m"` automatically; no other code changes needed in the engine. `order_flow(coin)` now returns a `"30m"` key alongside the existing four.

**2. Add a `large_trade_count(coin, window_s, threshold_pct_of_window_vol=0.01)` helper + route.**

```python
# data-layer/src/hynous_data/engine/order_flow.py — add a method
def large_trade_count(
    self,
    coin: str,
    window_s: int = 3600,
    threshold_pct_of_window_vol: float = 0.01,
) -> dict:
    """Count trades in the window whose notional exceeds a percentage of the
    window's total volume. Default: 1% of hourly volume.
    """
    import time
    buf = get_trade_buffer(coin)
    if not buf:
        return {"coin": coin, "window_s": window_s, "count": 0, "threshold_usd": 0}

    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - window_s * 1000
    window_trades = [t for t in list(buf) if t["time"] >= cutoff_ms]
    total_vol = sum(t["px"] * t["sz"] for t in window_trades)
    threshold = total_vol * threshold_pct_of_window_vol
    count = sum(1 for t in window_trades if t["px"] * t["sz"] >= threshold)
    return {
        "coin": coin,
        "window_s": window_s,
        "threshold_usd": round(threshold, 2),
        "count": count,
    }
```

```python
# data-layer/src/hynous_data/api/routes.py — register the route
@router.get("/v1/orderflow/{coin}/large-trade-count")
def large_trade_count(coin: str, window_s: int = Query(3600, ge=60, le=86400)):
    if "order_flow" not in c:
        return JSONResponse(status_code=503, content={"error": "Order flow engine not available"})
    engine = c["order_flow"]
    return engine.large_trade_count(coin.upper(), window_s=window_s)
```

```python
# src/hynous/data/providers/hynous_data.py — add a client method next to order_flow()
def large_trade_count(self, coin: str, window_s: int = 3600) -> dict | None:
    """Count of trades in window exceeding 1% of window volume."""
    return self._get(
        f"/v1/orderflow/{coin.upper()}/large-trade-count",
        params={"window_s": window_s},
    )
```

### Capture builder rewrites

Replace the two placeholder builders in `src/hynous/journal/capture.py`:

```python
def _build_order_flow_state(daemon: Any, symbol: str) -> OrderFlowState:
    """Read order flow metrics from the data-layer. Gracefully degrades if the
    data-layer is down: every field becomes None."""
    try:
        from hynous.data.providers.hynous_data import get_client
        client = get_client()
    except Exception:
        logger.debug("data-layer client unavailable for order flow", exc_info=True)
        return OrderFlowState()

    # Pull windowed CVD / buy_pct
    flow = client.order_flow(symbol)
    if not flow or "windows" not in flow:
        return OrderFlowState()
    w = flow["windows"]

    def _ratio(label: str) -> float | None:
        win = w.get(label)
        if not win:
            return None
        bp = win.get("buy_pct")
        return bp / 100.0 if bp is not None else None

    def _cvd(label: str) -> float | None:
        win = w.get(label)
        return win.get("cvd") if win else None

    cvd_5m = _cvd("5m") or 0.0
    cvd_15m = _cvd("15m") or 0.0
    cvd_accel = cvd_5m - (cvd_15m / 3.0) if (cvd_5m or cvd_15m) else None

    # Large-trade count (best-effort)
    ltc = None
    try:
        ltc_resp = client.large_trade_count(symbol, window_s=3600)
        ltc = ltc_resp.get("count") if ltc_resp else None
    except Exception:
        logger.debug("large_trade_count fetch failed", exc_info=True)

    return OrderFlowState(
        cvd_30m=_cvd("30m"),
        cvd_1h=_cvd("1h"),
        cvd_acceleration=cvd_accel,
        buy_sell_ratio_1m=_ratio("1m"),
        buy_sell_ratio_5m=_ratio("5m"),
        buy_sell_ratio_15m=_ratio("15m"),
        buy_sell_ratio_1h=_ratio("1h"),
        large_trade_count_1h=ltc,
    )


def _build_smart_money_context(daemon: Any, symbol: str) -> SmartMoneyContext:
    """Read HLP, whale, and smart-money data from the data-layer. Gracefully
    degrades if the data-layer is down: fields become None / empty list / 0."""
    try:
        from hynous.data.providers.hynous_data import get_client
        client = get_client()
    except Exception:
        logger.debug("data-layer client unavailable for smart money", exc_info=True)
        return SmartMoneyContext(top_whale_positions=[], smart_money_opens_1h=0)

    # HLP
    hlp_net: float | None = None
    hlp_size: float | None = None
    hlp_side: str | None = None
    try:
        hlp = client.hlp_positions()
        if hlp and isinstance(hlp.get("positions"), list):
            long_usd = sum(
                p.get("size_usd", 0)
                for p in hlp["positions"]
                if p.get("coin") == symbol and p.get("side") == "long"
            )
            short_usd = sum(
                p.get("size_usd", 0)
                for p in hlp["positions"]
                if p.get("coin") == symbol and p.get("side") == "short"
            )
            hlp_net = long_usd - short_usd
            hlp_size = long_usd + short_usd
            if hlp_net > 0:
                hlp_side = "long"
            elif hlp_net < 0:
                hlp_side = "short"
            elif hlp_size == 0:
                hlp_side = None  # no position on this coin
            else:
                hlp_side = "flat"  # equal longs and shorts (rare)
    except Exception:
        logger.debug("hlp_positions fetch failed", exc_info=True)

    # Top whale positions
    top_whales: list[dict[str, Any]] = []
    try:
        whales = client.whales(symbol, top_n=5)
        if whales and isinstance(whales.get("positions"), list):
            top_whales = whales["positions"][:5]
    except Exception:
        logger.debug("whales fetch failed", exc_info=True)

    # Smart money opens in last 1h on this coin
    sm_opens = 0
    try:
        changes = client.sm_changes(minutes=60)
        if changes and isinstance(changes.get("changes"), list):
            # Each change entry is per-wallet; count opens of our symbol.
            # Data-layer response shape (verified against
            # data-layer/engine/position_tracker.py:120-155 and
            # data-layer/api/routes.py:208): rows have the keys
            # `action`, `coin`, `side`, `size_usd`, `price`, `detected_at`,
            # plus wallet profile fields (`win_rate`, `style`, `is_bot`,
            # `label`). The `action` column values are
            # `entry` | `flip` | `increase` | `exit`. Count only
            # position-OPENING events — do NOT count `exit`.
            sm_opens = sum(
                1 for ch in changes["changes"]
                if ch.get("coin") == symbol
                and ch.get("action") in ("entry", "flip", "increase")
            )
    except Exception:
        logger.debug("sm_changes fetch failed", exc_info=True)

    return SmartMoneyContext(
        hlp_net_delta_usd=hlp_net,
        hlp_side=hlp_side,
        hlp_size_usd=hlp_size,
        top_whale_positions=top_whales,
        smart_money_opens_1h=sm_opens,
    )
```

**Critical:** every data-layer call is individually `try/except`-wrapped so a single endpoint outage cannot strand an entry snapshot. A missing data-layer field becomes `None`, never raises.

### Daemon client lifecycle

The `hynous_data.get_client()` helper already returns a cached client instance. Capture builders reuse that cache; do not create per-call clients. No daemon state changes are needed for this backfill.

### Defensive fields

If the data-layer's `sm_changes` response changes its shape in future (this report verified the current client signature but did not exhaustively audit the engine response), the filtering loop above is intentionally permissive: if `ch.get("coin")` is not populated we undercount rather than raise. Document this in the capture.py module docstring so phase 3 analysis agent rules can decide whether to treat `smart_money_opens_1h == 0` as "none observed" vs. "data unavailable".

### Verification during smoke test

After the phase 2 smoke test, sample one entry snapshot and verify populated fields:

```bash
sqlite3 storage/v2/journal.db "SELECT snapshot_json FROM trade_entry_snapshots LIMIT 1;" \
  | python -c "
import sys, json
data = json.loads(sys.stdin.read())
of = data['order_flow_state']
sm = data['smart_money_context']
print('order flow:', {k: v for k, v in of.items() if v is not None})
print('smart money:', {k: v for k, v in sm.items() if v is not None and v != [] and v != 0})
"
```

At least `cvd_1h`, `buy_sell_ratio_1h`, and `top_whale_positions` must be populated in any smoke-test-captured snapshot. If all fields are None/empty, the data-layer is down or the backfill wiring regressed — pause and investigate before reporting phase 2 complete.

---

## Testing

### Unit tests

Create `tests/unit/test_v2_journal.py`:

1. `test_journal_store_init_creates_schema` — fresh DB, assert all 8 tables exist
2. `test_upsert_trade_inserts_new_row` — assert row is queryable
3. `test_upsert_trade_updates_existing_row` — update a field, assert persistence
4. `test_insert_entry_snapshot_creates_trade_row` — check upsert side effect
5. `test_insert_entry_snapshot_persists_json` — retrieve and assert JSON equivalence
6. `test_insert_exit_snapshot_updates_trade_status` — assert status becomes 'closed'
7. `test_insert_lifecycle_event_persists` — insert and retrieve
8. `test_get_events_for_trade_ordered_chronologically` — out-of-order inserts, check ordering
9. `test_insert_analysis_updates_trade_status_to_analyzed` — assert status
10. `test_get_analysis_returns_full_record` — insert and read back
11. `test_list_trades_filters_by_symbol` — mixed data, assert filter
12. `test_list_trades_filters_by_status` — assert filter
13. `test_list_trades_pagination` — limit + offset
14. `test_add_and_remove_tag` — tag lifecycle
15. `test_get_tags_returns_all_sources` — llm/manual/auto
16. `test_get_aggregate_stats_empty` — no trades, assert zeros
17. `test_get_aggregate_stats_with_mixed_outcomes` — wins, losses, assert math
18. `test_get_trade_returns_full_bundle` — insert everything, fetch, assert keys
19. `test_embedding_client_embed_single` — mock OpenAI call, assert bytes returned
20. `test_embedding_client_embed_batch` — same for batch
21. `test_cosine_similarity_identical_vectors` — should be 1.0
22. `test_cosine_similarity_orthogonal_vectors` — should be 0.0
23. `test_search_semantic_orders_by_score` — seed with known embeddings, verify ordering
24. `test_entry_snapshot_round_trip_preserves_every_field` — asdict → json → from_dict roundtrip equals original (Amendment 9)
25. `test_exit_snapshot_round_trip_preserves_every_field` — same contract (Amendment 9)
26. `test_entry_snapshot_from_dict_raises_keyerror_on_missing_section` — schema drift raises, not swallowed (Amendment 9)
27. `test_get_trade_hydrates_nested_dataclasses` — end-to-end, `get_trade()` returns real `TradeEntrySnapshot` instance (Amendment 9)
28. `test_build_order_flow_state_populates_windows_from_mock_client` — mocked `order_flow` response returns shape with `windows` dict; all 5 windows (1m/5m/15m/30m/1h) map correctly; `cvd_acceleration` computed as `cvd_5m − cvd_15m/3` (Amendment 10)
29. `test_build_order_flow_state_graceful_when_data_layer_down` — `get_client()` raises; returns empty `OrderFlowState()` without error (Amendment 10)
30. `test_build_smart_money_context_aggregates_hlp_per_symbol` — mocked `hlp_positions` with mixed coins; only the target symbol's positions count toward net/size (Amendment 10)
31. `test_build_smart_money_context_counts_sm_opens_for_symbol_only` — mocked `sm_changes` with entries across multiple coins; count filters to target symbol (Amendment 10)
32. `test_build_smart_money_context_graceful_when_all_endpoints_down` — every data-layer call raises; returns `SmartMoneyContext` with all fields None/empty, does not raise (Amendment 10)

### Integration tests

Create `tests/integration/test_v2_journal_integration.py`:

1. `test_full_trade_lifecycle_writes_all_tables` — insert entry snapshot, events, exit snapshot, analysis; assert all tables populated
2. `test_api_list_trades_returns_expected_shape` — use FastAPI TestClient, hit `/api/v2/journal/trades`, validate Pydantic shape
3. `test_api_get_trade_404_on_missing` — unknown trade_id returns 404
4. `test_api_get_trade_returns_full_bundle` — populated trade, hit endpoint, verify all keys present
5. `test_api_stats_computes_aggregates` — populate 10 trades with known outcomes, assert stats math
6. `test_migrate_staging_preserves_all_data` — populate staging, run migration, assert journal has identical data
7. `test_concurrent_reads_during_write` — thread one reads while thread two writes; assert no busy errors thanks to WAL
8. `test_full_trade_capture_populates_order_flow_and_smart_money` — run end-to-end with a live `PaperProvider` and a data-layer stub; assert captured entry snapshot has non-empty `cvd_1h`, `buy_sell_ratio_1h`, and `top_whale_positions` fields (Amendment 10)

### Smoke test

Run the daemon in paper mode for 15 minutes. Post-smoke verification:

```bash
sqlite3 storage/v2/journal.db <<'EOF'
SELECT 'trades', COUNT(*) FROM trades;
SELECT 'entry_snapshots', COUNT(*) FROM trade_entry_snapshots;
SELECT 'exit_snapshots', COUNT(*) FROM trade_exit_snapshots;
SELECT 'events', COUNT(*) FROM trade_events;
SELECT 'analyses', COUNT(*) FROM trade_analyses;
SELECT 'tags', COUNT(*) FROM trade_tags;
SELECT 'edges', COUNT(*) FROM trade_edges;
SELECT 'patterns', COUNT(*) FROM trade_patterns;
EOF

# Sanity check: hit the API
curl http://localhost:8000/api/v2/journal/health
curl http://localhost:8000/api/v2/journal/trades?limit=5
curl http://localhost:8000/api/v2/journal/stats
```

Expected: trades, events, entry_snapshots populated. Analyses, edges, patterns empty (phases 3 and 6 populate them).

---

## Acceptance Criteria

- [ ] `src/hynous/journal/store.py` exists with full `JournalStore` class
- [ ] `src/hynous/journal/embeddings.py` exists with `EmbeddingClient` and `cosine_similarity`
- [ ] `src/hynous/journal/api.py` exists with all routes listed
- [ ] `src/hynous/journal/migrate_staging.py` exists, is snapshot-idempotent (ON CONFLICT upsert), and is guarded against re-run by `journal_metadata.staging_migration_done` (events table would re-insert without that flag)
- [ ] `src/hynous/journal/README.md` exists and explains the module
- [ ] `storage/v2/journal.db` is created with all 8 tables on daemon startup
- [ ] Journal router is mounted on the dashboard FastAPI app
- [ ] Phase 1 staging data migrates cleanly (if present)
- [ ] Daemon now writes to `JournalStore` instead of `StagingStore` (the `_journal_store` reference swaps)
- [ ] All 32 unit tests pass (23 original + 4 reconstruction round-trip tests for Amendment 9 + 5 order-flow / smart-money tests for Amendment 10)
- [ ] All 8 integration tests pass (7 original + 1 end-to-end order-flow / smart-money capture test for Amendment 10)
- [ ] `entry_snapshot_from_dict` and `exit_snapshot_from_dict` exist in `src/hynous/journal/schema.py` and round-trip empirically verified (Amendment 9)
- [ ] `JournalStore.get_trade()` returns bundle where `entry_snapshot` and `exit_snapshot` are real `TradeEntrySnapshot` / `TradeExitSnapshot` instances, not dicts (Amendment 9)
- [ ] `_build_order_flow_state()` in `src/hynous/journal/capture.py` reads from `hynous_data.order_flow(coin)` + `hynous_data.large_trade_count(coin)` with per-call graceful degradation (Amendment 10)
- [ ] `_build_smart_money_context()` in `src/hynous/journal/capture.py` reads from `hynous_data.hlp_positions()`, `hynous_data.whales(coin, top_n=5)`, `hynous_data.sm_changes(minutes=60)` with per-call graceful degradation (Amendment 10)
- [ ] `data-layer/src/hynous_data/engine/order_flow.py` default windows include `1800` (30m) — new `"30m"` key appears in `order_flow()` response (Amendment 10)
- [ ] `data-layer/src/hynous_data/engine/order_flow.py` exposes `large_trade_count(coin, window_s, threshold_pct_of_window_vol)` helper (Amendment 10)
- [ ] `data-layer/src/hynous_data/api/routes.py` registers `GET /v1/orderflow/{coin}/large-trade-count` (Amendment 10)
- [ ] `src/hynous/data/providers/hynous_data.py` exposes `large_trade_count(coin, window_s)` client method (Amendment 10)
- [ ] Post-smoke verification: at least one captured entry snapshot has non-None `cvd_1h`, `buy_sell_ratio_1h`, and non-empty `top_whale_positions` (Amendment 10)
- [ ] Post-smoke verification: `store.get_trade(trade_id)` hydrates at least one captured trade end-to-end (Amendment 9)
- [ ] Full regression `pytest tests/ --ignore=tests/e2e` passes with zero new failures (baseline: 810 passed / 1 pre-existing failure — see master plan Amendment 2)
- [ ] mypy baseline preserved
- [ ] ruff baseline preserved
- [ ] Smoke test produces at least one trade written via the new store
- [ ] `curl /api/v2/journal/health` returns 200
- [ ] `curl /api/v2/journal/trades` returns valid JSON
- [ ] `curl /api/v2/journal/stats` returns valid stats JSON
- [ ] Nous is still running and receiving writes (phase 4 handles removal)
- [ ] Phase 2 commit(s) on v2 branch tagged `[phase-2]`

---

## Rollback

```bash
git revert <phase-2-commit-sha>
rm -rf storage/v2/journal.db*
```

The dashboard continues using the phase 1 staging store. Nous is still up.

---

## Report-Back

Include:
- Migration counts (staging entries / exits / events copied into journal)
- Journal DB size after smoke test
- API route response times for `/trades` and `/stats` (should be < 100ms)
- Number of trades written via journal during smoke test
- Any embedding API calls attempted (phase 2 doesn't require embeddings during normal operation, but if search was tested, note the cost)
- Any deviations from the plan
