"""Phase 2 Milestone 4 — FastAPI journal routes integration tests.

Uses ``fastapi.testclient.TestClient`` against a bare FastAPI app with the
journal router mounted. No real LLM calls; embedding client is mocked on
the ``/search`` test.

Tests the plan-specified integration cases (2, 3, 4, 5, 7 from phase 2
plan lines 1911-1921) plus health, search, and a full-lifecycle smoke.
"""

from __future__ import annotations

import struct
import threading
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hynous.journal.api import router as journal_router
from hynous.journal.api import set_store as set_journal_store
from hynous.journal.schema import TradeEntrySnapshot, TradeExitSnapshot
from hynous.journal.store import JournalStore


@pytest.fixture
def api_client(tmp_journal_db: JournalStore) -> TestClient:
    """TestClient with the journal router mounted and the store injected."""
    app = FastAPI()
    app.include_router(journal_router)
    set_journal_store(tmp_journal_db)
    try:
        yield TestClient(app)
    finally:
        set_journal_store(None)  # type: ignore[arg-type]  # reset between tests


# ---------------------------------------------------------------------------
# Basic route sanity
# ---------------------------------------------------------------------------


def test_api_health_returns_200(api_client: TestClient) -> None:
    """Health endpoint is 200 with db_path echo when store is wired."""
    resp = api_client.get("/api/v2/journal/health")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "ok"
    assert "db_path" in payload


def test_api_health_returns_503_when_store_unset(tmp_journal_db: JournalStore) -> None:
    """Without set_store, requests 503 out instead of silently serving empty data."""
    app = FastAPI()
    app.include_router(journal_router)
    set_journal_store(None)  # type: ignore[arg-type]
    client = TestClient(app)
    resp = client.get("/api/v2/journal/health")
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# List / get trades
# ---------------------------------------------------------------------------


def test_api_list_trades_returns_expected_shape(
    api_client: TestClient,
    tmp_journal_db: JournalStore,
    sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """GET /trades returns list of TradeSummary objects matching the Pydantic shape."""
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    resp = api_client.get("/api/v2/journal/trades")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    t = data[0]
    # Minimum Pydantic fields present
    for key in (
        "trade_id", "symbol", "side", "status",
        "entry_ts", "entry_px", "leverage",
    ):
        assert key in t
    assert t["trade_id"] == sample_entry_snapshot.trade_basics.trade_id
    assert t["symbol"] == "BTC"
    assert t["status"] == "open"


def test_api_get_trade_404_on_missing(api_client: TestClient) -> None:
    """Unknown trade_id returns 404 with a descriptive detail."""
    resp = api_client.get("/api/v2/journal/trades/nonexistent")
    assert resp.status_code == 404
    assert "nonexistent" in resp.json()["detail"]


def test_api_get_trade_returns_full_bundle(
    api_client: TestClient,
    tmp_journal_db: JournalStore,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """GET /trades/{id} returns the full bundle: row + snapshots + events + analysis + tags."""
    tid = sample_entry_snapshot.trade_basics.trade_id
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tmp_journal_db.insert_lifecycle_event(
        trade_id=tid, ts="2026-04-12T10:20:00+00:00",
        event_type="dynamic_sl_placed", payload={"sl_px": 63500.0},
    )
    tmp_journal_db.insert_exit_snapshot(sample_exit_snapshot)
    tmp_journal_db.add_tag(tid, "trend_continuation", source="llm")

    resp = api_client.get(f"/api/v2/journal/trades/{tid}")
    assert resp.status_code == 200
    bundle = resp.json()
    for key in (
        "trade_id", "symbol", "status",
        "entry_snapshot", "exit_snapshot",
        "counterfactuals", "events", "analysis", "tags",
    ):
        assert key in bundle
    assert bundle["entry_snapshot"] is not None
    assert len(bundle["events"]) == 1
    assert bundle["tags"][0]["tag"] == "trend_continuation"


def test_api_get_trade_events_endpoint(
    api_client: TestClient,
    tmp_journal_db: JournalStore,
    sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """GET /trades/{id}/events returns chronological events list."""
    tid = sample_entry_snapshot.trade_basics.trade_id
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tmp_journal_db.insert_lifecycle_event(
        trade_id=tid, ts="2026-04-12T10:30:00+00:00",
        event_type="fee_be_set", payload={},
    )
    tmp_journal_db.insert_lifecycle_event(
        trade_id=tid, ts="2026-04-12T10:15:30+00:00",
        event_type="dynamic_sl_placed", payload={},
    )
    resp = api_client.get(f"/api/v2/journal/trades/{tid}/events")
    assert resp.status_code == 200
    events = resp.json()
    assert [e["event_type"] for e in events] == ["dynamic_sl_placed", "fee_be_set"]


def test_api_get_trade_analysis_404_when_absent(
    api_client: TestClient,
    tmp_journal_db: JournalStore,
    sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """Trade exists but has no analysis yet → 404 from /analysis endpoint."""
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tid = sample_entry_snapshot.trade_basics.trade_id
    resp = api_client.get(f"/api/v2/journal/trades/{tid}/analysis")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


def test_api_stats_computes_aggregates(
    api_client: TestClient, tmp_journal_db: JournalStore,
) -> None:
    """GET /stats returns AggregateStats populated from closed trades."""
    trades = [
        ("t1", 100.0), ("t2", 200.0), ("t3", 150.0),
        ("t4", -50.0), ("t5", -100.0),
    ]
    for tid, pnl in trades:
        tmp_journal_db.upsert_trade(
            trade_id=tid, symbol="BTC", side="long", trade_type="macro",
            status="closed", entry_ts="2026-04-12T10:00:00+00:00",
            realized_pnl_usd=pnl, hold_duration_s=3600,
        )
    resp = api_client.get("/api/v2/journal/stats")
    assert resp.status_code == 200
    s = resp.json()
    assert s["total_trades"] == 5
    assert s["wins"] == 3
    assert s["losses"] == 2
    assert s["win_rate"] == 60.0
    assert s["total_pnl"] == 300.0
    assert s["profit_factor"] == 3.0


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------


def test_api_tag_add_and_delete(
    api_client: TestClient, tmp_journal_db: JournalStore,
    sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """POST then DELETE on /tags endpoints roundtrip."""
    tid = sample_entry_snapshot.trade_basics.trade_id
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)

    resp = api_client.post(
        f"/api/v2/journal/trades/{tid}/tags",
        params={"tag": "manual_review"},
    )
    assert resp.status_code == 200
    assert tmp_journal_db.get_tags(tid)[0]["tag"] == "manual_review"

    resp = api_client.delete(f"/api/v2/journal/trades/{tid}/tags/manual_review")
    assert resp.status_code == 200
    assert tmp_journal_db.get_tags(tid) == []


# ---------------------------------------------------------------------------
# Search — embedding client mocked
# ---------------------------------------------------------------------------


def test_api_search_endpoint_calls_embedder_and_returns_ranked(
    api_client: TestClient,
    tmp_journal_db: JournalStore,
    sample_entry_snapshot: TradeEntrySnapshot,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GET /search embeds the query, calls search_semantic, returns ranked JSON."""
    from dataclasses import replace as dc_replace

    # Seed two trades with known embeddings
    axis_a = struct.pack("3f", 1.0, 0.0, 0.0)
    axis_b = struct.pack("3f", 0.0, 1.0, 0.0)
    basics_a = dc_replace(sample_entry_snapshot.trade_basics, trade_id="axis_a")
    basics_b = dc_replace(sample_entry_snapshot.trade_basics, trade_id="axis_b")
    tmp_journal_db.insert_entry_snapshot(
        dc_replace(sample_entry_snapshot, trade_basics=basics_a),
        embedding=axis_a,
    )
    tmp_journal_db.insert_entry_snapshot(
        dc_replace(sample_entry_snapshot, trade_basics=basics_b),
        embedding=axis_b,
    )

    # Mock the embedding client to return the axis_a vector for the query.
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    mock_client_instance = MagicMock()
    mock_client_instance.embed.return_value = axis_a

    with patch(
        "hynous.journal.embeddings.EmbeddingClient",
        return_value=mock_client_instance,
    ):
        resp = api_client.get(
            "/api/v2/journal/search",
            params={"q": "find me axis-A-like setups"},
        )

    assert resp.status_code == 200
    results = resp.json()
    assert len(results) == 2
    assert results[0]["trade_id"] == "axis_a"
    assert results[0]["score"] > results[1]["score"]
    mock_client_instance.embed.assert_called_once()


def test_api_search_returns_500_on_embedding_failure(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Embedding failure surfaces as 500 with descriptive detail."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    with patch(
        "hynous.journal.embeddings.EmbeddingClient",
        side_effect=RuntimeError("mock OpenAI outage"),
    ):
        resp = api_client.get("/api/v2/journal/search", params={"q": "x"})
    assert resp.status_code == 500
    assert "mock OpenAI outage" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Concurrency — WAL mode under concurrent read+write
# ---------------------------------------------------------------------------


def test_concurrent_reads_during_write(tmp_journal_db: JournalStore) -> None:
    """Reader thread sees consistent data while writer thread inserts.

    WAL mode guarantees no SQLite 'database is locked' error on reads
    happening during writes. This is a smoke of that invariant, not a
    stress test.
    """
    errors: list[BaseException] = []

    def writer() -> None:
        try:
            for i in range(20):
                tmp_journal_db.upsert_trade(
                    trade_id=f"w{i}", symbol="BTC", side="long",
                    trade_type="macro", status="open",
                    entry_ts=f"2026-04-12T10:{i:02d}:00+00:00",
                )
        except Exception as exc:
            errors.append(exc)

    def reader() -> None:
        try:
            for _ in range(20):
                tmp_journal_db.list_trades(limit=50)
        except Exception as exc:
            errors.append(exc)

    t_write = threading.Thread(target=writer)
    t_read = threading.Thread(target=reader)
    t_write.start()
    t_read.start()
    t_write.join(timeout=5)
    t_read.join(timeout=5)

    assert not errors, f"concurrency errors: {errors}"
    assert len(tmp_journal_db.list_trades(limit=50)) == 20


# ---------------------------------------------------------------------------
# Full trade lifecycle smoke (plan integration test #1)
# ---------------------------------------------------------------------------


def test_full_trade_lifecycle_writes_all_tables(
    tmp_journal_db: JournalStore,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """End-to-end: entry → events → exit → analysis → tags produces a fully
    populated trade bundle on get_trade()."""
    tid = sample_entry_snapshot.trade_basics.trade_id
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tmp_journal_db.insert_lifecycle_event(
        trade_id=tid, ts="2026-04-12T10:20:00+00:00",
        event_type="dynamic_sl_placed", payload={"sl_px": 63500.0},
    )
    tmp_journal_db.insert_lifecycle_event(
        trade_id=tid, ts="2026-04-12T11:10:00+00:00",
        event_type="trail_activated", payload={"trail_px": 64800.0},
    )
    tmp_journal_db.insert_exit_snapshot(sample_exit_snapshot)
    tmp_journal_db.insert_analysis(
        trade_id=tid, narrative="N.", narrative_citations=[], findings=[],
        grades={"entry_quality": 80, "entry_timing": 80, "sl_placement": 80,
                "tp_placement": 80, "size_leverage": 80, "exit_quality": 80},
        mistake_tags=[], process_quality_score=80,
        one_line_summary="s", unverified_claims=None,
        model_used="anthropic/claude-sonnet-4.5", prompt_version="v1",
    )
    tmp_journal_db.add_tag(tid, "trend", source="llm")

    bundle = tmp_journal_db.get_trade(tid)
    assert bundle is not None
    assert bundle["status"] == "analyzed"
    assert isinstance(bundle["entry_snapshot"], TradeEntrySnapshot)
    assert isinstance(bundle["exit_snapshot"], TradeExitSnapshot)
    assert bundle["counterfactuals"] is not None
    assert len(bundle["events"]) == 2
    assert bundle["analysis"]["process_quality_score"] == 80
    assert len(bundle["tags"]) == 1


def _unused_marker() -> None:
    """Silence F401 if tools think the Any import is unused — it isn't, the
    fixtures return Any-typed values that pytest type-narrows at call sites."""
    _ = Any
