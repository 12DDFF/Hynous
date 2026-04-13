"""FastAPI routes exposing the v2 journal under ``/api/v2/journal/*``.

The router is mounted into the dashboard's FastAPI app at startup. The store
instance is injected via :func:`set_store` before the first request lands —
routes 503 out until that happens so a misconfigured startup fails loudly
instead of silently serving empty data.

Routes (all under ``/api/v2/journal``):
    GET  /health                         — liveness + db path echo
    GET  /trades                         — list with filters (symbol, status,
                                           exit_classification, since, until,
                                           limit, offset)
    GET  /trades/{trade_id}              — full hydrated bundle
    GET  /trades/{trade_id}/events       — lifecycle events chronological
    GET  /trades/{trade_id}/analysis     — LLM analysis if present (404 else)
    GET  /stats                          — aggregate performance
    GET  /search                         — semantic search (entry|analysis)
    POST /trades/{trade_id}/tags         — attach a tag
    DELETE /trades/{trade_id}/tags/{tag} — remove a tag
    GET  /patterns                       — latest pattern records
                                           (pattern_type + limit filters)
    GET  /trades/{trade_id}/related      — edges outbound from a trade
                                           (edge_type filter, raw rows)
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .store import JournalStore

router = APIRouter(prefix="/api/v2/journal", tags=["journal"])

_store: JournalStore | None = None


def set_store(store: JournalStore) -> None:
    """Inject the journal store instance. Called once at app startup."""
    global _store
    _store = store


def _require_store() -> JournalStore:
    """Lookup helper — routes 503 until :func:`set_store` has been called."""
    if _store is None:
        raise HTTPException(
            status_code=503,
            detail="Journal store not initialized",
        )
    return _store


# ============================================================================
# Pydantic response models
# ============================================================================


class TradeSummary(BaseModel):
    """One row of ``GET /trades`` — minimum fields for a journal list view.

    Includes the rejection triplet (``rejection_reason`` / ``trigger_source`` /
    ``trigger_type``) and ``trade_type`` so the dashboard can distinguish
    rejected rows from closed trades without a second fetch.
    """

    trade_id: str
    symbol: str
    side: str
    status: str
    trade_type: str | None = None
    entry_ts: str | None = None
    entry_px: float | None = None
    exit_ts: str | None = None
    exit_px: float | None = None
    exit_classification: str | None = None
    realized_pnl_usd: float | None = None
    roe_pct: float | None = None
    hold_duration_s: int | None = None
    peak_roe: float | None = None
    leverage: int | None = None
    rejection_reason: str | None = None
    trigger_source: str | None = None
    trigger_type: str | None = None


class AggregateStats(BaseModel):
    """Shape returned by ``GET /stats``."""

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


@router.get("/health")
def health_endpoint() -> dict[str, Any]:
    """Liveness probe — returns 200 + db path, 503 if store not wired."""
    store = _require_store()
    return {"status": "ok", "db_path": store._db_path}


@router.get("/trades", response_model=list[TradeSummary])
def list_trades_endpoint(
    symbol: str | None = Query(None),
    status: str | None = Query(None),
    exit_classification: str | None = Query(None),
    since: str | None = Query(None),
    until: str | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
) -> list[TradeSummary]:
    """List trades with SQL filters. Ordered by ``entry_ts DESC``."""
    store = _require_store()
    trades = store.list_trades(
        symbol=symbol, status=status, exit_classification=exit_classification,
        since=since, until=until, limit=limit, offset=offset,
    )
    return [TradeSummary(**t) for t in trades]


@router.get("/trades/{trade_id}")
def get_trade_endpoint(trade_id: str) -> dict[str, Any]:
    """Full hydrated bundle: row + snapshots + events + analysis + tags."""
    store = _require_store()
    trade = store.get_trade(trade_id)
    if trade is None:
        raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")
    return trade


@router.get("/trades/{trade_id}/events")
def get_trade_events_endpoint(trade_id: str) -> list[dict[str, Any]]:
    """Lifecycle events for a trade, chronological."""
    store = _require_store()
    return store.get_events_for_trade(trade_id)


@router.get("/trades/{trade_id}/analysis")
def get_trade_analysis_endpoint(trade_id: str) -> dict[str, Any]:
    """LLM analysis for a trade, 404 if absent."""
    store = _require_store()
    analysis = store.get_analysis(trade_id)
    if analysis is None:
        raise HTTPException(
            status_code=404,
            detail=f"No analysis for trade {trade_id}",
        )
    return analysis


@router.get("/stats", response_model=AggregateStats)
def get_stats_endpoint(
    symbol: str | None = Query(None),
    since: str | None = Query(None),
    until: str | None = Query(None),
) -> AggregateStats:
    """Aggregate performance over closed/analyzed trades in the window."""
    store = _require_store()
    stats = store.get_aggregate_stats(since=since, until=until, symbol=symbol)
    return AggregateStats(**stats)


@router.get("/search")
def search_trades_endpoint(
    q: str = Query(..., description="Search query text"),
    scope: str = Query("entry", pattern="^(entry|analysis)$"),
    limit: int = Query(20, le=100),
    symbol: str | None = Query(None),
) -> list[dict[str, Any]]:
    """Semantic search. Embeds the query text and returns top-N trades by cosine."""
    store = _require_store()
    from .embeddings import EmbeddingClient

    try:
        client = EmbeddingClient()
        query_embedding = client.embed(q)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Embedding failed: {exc}",
        ) from exc

    return store.search_semantic(
        query_embedding=query_embedding,
        scope=scope,
        limit=limit,
        symbol=symbol,
    )


@router.post("/trades/{trade_id}/tags")
def add_trade_tag_endpoint(
    trade_id: str,
    tag: str = Query(..., min_length=1, max_length=64),
) -> dict[str, Any]:
    """Attach a tag to a trade (source='manual')."""
    store = _require_store()
    store.add_tag(trade_id, tag, source="manual")
    return {"status": "ok", "trade_id": trade_id, "tag": tag}


@router.delete("/trades/{trade_id}/tags/{tag}")
def remove_trade_tag_endpoint(trade_id: str, tag: str) -> dict[str, Any]:
    """Remove a tag from a trade."""
    store = _require_store()
    store.remove_tag(trade_id, tag)
    return {"status": "ok"}


@router.get("/patterns")
def list_patterns_endpoint(
    pattern_type: str | None = Query(None),
    limit: int = Query(10, le=50),
) -> list[dict[str, Any]]:
    """List latest trade patterns (weekly rollups). Ordered by updated_at DESC."""
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
    """Edges outbound from ``trade_id``, optionally filtered by ``edge_type``.

    Returns raw edge rows — a single neighbour may appear under multiple
    ``edge_type``s (e.g. a rejection's nearest prior same-symbol trade is
    both ``preceded_by`` AND ``rejection_vs_contemporaneous_trade``). Callers
    that want unique neighbours should group client-side.
    """
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
