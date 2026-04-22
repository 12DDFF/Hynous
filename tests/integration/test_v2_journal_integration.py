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
        model_used="openrouter/anthropic/claude-sonnet-4.5", prompt_version="v1",
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


# ---------------------------------------------------------------------------
# Staging → journal migration (plan integration test #6)
# ---------------------------------------------------------------------------


def test_migrate_staging_preserves_all_data(
    tmp_path: Any,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """Seed a staging DB with entries+exits+events, migrate, assert journal
    has identical counts and that the migration is idempotent on re-run.
    """
    from dataclasses import replace as dc_replace

    from hynous.journal.migrate_staging import migrate_staging_to_journal
    from hynous.journal.staging_store import StagingStore

    staging_path = tmp_path / "staging.db"
    journal_path = tmp_path / "journal.db"
    staging = StagingStore(str(staging_path))

    # Seed 2 entries with distinct trade_ids
    entry_a = sample_entry_snapshot
    basics_b = dc_replace(
        sample_entry_snapshot.trade_basics, trade_id="trade_bbb2345678901234b",
    )
    entry_b = dc_replace(sample_entry_snapshot, trade_basics=basics_b)
    staging.insert_entry_snapshot(entry_a)
    staging.insert_entry_snapshot(entry_b)

    # Seed 2 exits (matching trade_ids)
    exit_a = sample_exit_snapshot  # trade_id already matches entry_a
    exit_b = dc_replace(sample_exit_snapshot, trade_id="trade_bbb2345678901234b")
    staging.insert_exit_snapshot(exit_a)
    staging.insert_exit_snapshot(exit_b)

    # Seed 5 lifecycle events (mixed trade_ids)
    for i, tid in enumerate(
        [entry_a.trade_basics.trade_id, entry_b.trade_basics.trade_id,
         entry_a.trade_basics.trade_id, entry_b.trade_basics.trade_id,
         entry_a.trade_basics.trade_id],
    ):
        staging.insert_lifecycle_event(
            trade_id=tid, ts=f"2026-04-12T10:1{i}:00+00:00",
            event_type="dynamic_sl_placed",
            payload={"sl_px": 63500.0 + i},
        )

    # First migration
    counts = migrate_staging_to_journal(str(staging_path), str(journal_path))
    assert counts["entries"] == 2
    assert counts["exits"] == 2
    assert counts["events"] == 5
    assert counts["skipped_entries"] == 0
    assert counts["skipped_exits"] == 0
    assert counts["skipped_events"] == 0

    # Verify journal state
    journal = JournalStore(str(journal_path))
    trades = journal.list_trades()
    assert len(trades) == 2
    trade_ids = {t["trade_id"] for t in trades}
    assert entry_a.trade_basics.trade_id in trade_ids
    assert entry_b.trade_basics.trade_id in trade_ids
    # Both trades closed (exit snapshots migrated)
    assert all(t["status"] == "closed" for t in trades)

    bundle_a = journal.get_trade(entry_a.trade_basics.trade_id)
    assert bundle_a is not None
    assert isinstance(bundle_a["entry_snapshot"], TradeEntrySnapshot)
    assert isinstance(bundle_a["exit_snapshot"], TradeExitSnapshot)
    # Entry A had 3 of the 5 events seeded
    assert len(bundle_a["events"]) == 3

    # Idempotent re-run: snapshots upsert, counts come back the same;
    # events don't upsert (no idempotency key) but the function itself
    # reports the same input count.
    counts2 = migrate_staging_to_journal(str(staging_path), str(journal_path))
    assert counts2["entries"] == 2
    assert counts2["exits"] == 2
    assert counts2["events"] == 5
    # Trade count unchanged after re-run (upsert preserved identity)
    assert len(journal.list_trades()) == 2


def test_migrate_staging_no_source_db_returns_empty_counts(tmp_path: Any) -> None:
    """Missing staging DB is not an error — migration reports zero counts."""
    from hynous.journal.migrate_staging import migrate_staging_to_journal

    result = migrate_staging_to_journal(
        str(tmp_path / "does_not_exist.db"),
        str(tmp_path / "journal.db"),
    )
    assert result == {
        "entries": 0, "exits": 0, "events": 0,
        "skipped_entries": 0, "skipped_exits": 0, "skipped_events": 0,
    }


# ---------------------------------------------------------------------------
# Amendment 10 — end-to-end order flow + smart money capture (plan test #8)
# ---------------------------------------------------------------------------


def test_full_trade_capture_populates_order_flow_and_smart_money(
    tmp_journal_db: JournalStore,
    sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """Drive build_entry_snapshot with a mocked data-layer client and assert
    the persisted entry snapshot has populated order_flow_state and
    smart_money_context fields (not the empty-dataclass placeholders from
    phase 1).
    """
    from unittest.mock import MagicMock, patch

    from hynous.journal.capture import (
        _build_order_flow_state,
        _build_smart_money_context,
    )

    mock_client = MagicMock()
    mock_client.order_flow.return_value = {
        "windows": {
            "1m":  {"cvd": 50.0, "buy_pct": 60.0},
            "5m":  {"cvd": 250.0, "buy_pct": 55.0},
            "15m": {"cvd": 600.0, "buy_pct": 50.0},
            "30m": {"cvd": 900.0, "buy_pct": 48.0},
            "1h":  {"cvd": 1500.0, "buy_pct": 53.0},
        },
    }
    mock_client.large_trade_count.return_value = {"count": 4}
    mock_client.hlp_positions.return_value = {
        "positions": [
            {"coin": "BTC", "side": "long", "size_usd": 7_500_000.0},
        ],
    }
    mock_client.whales.return_value = {
        "positions": [
            {"wallet": "0xw1", "side": "long", "size_usd": 5_000_000.0},
            {"wallet": "0xw2", "side": "short", "size_usd": 3_000_000.0},
        ],
    }
    mock_client.sm_changes.return_value = {
        "changes": [
            {"coin": "BTC", "action": "entry", "side": "long"},
            {"coin": "BTC", "action": "flip", "side": "short"},
        ],
    }

    with patch(
        "hynous.data.providers.hynous_data.get_client",
        return_value=mock_client,
    ):
        of = _build_order_flow_state(daemon=MagicMock(), symbol="BTC")
        sm = _build_smart_money_context(daemon=MagicMock(), symbol="BTC")

    # Build a modified entry snapshot with the populated states and persist.
    from dataclasses import replace as dc_replace
    enriched = dc_replace(
        sample_entry_snapshot, order_flow_state=of, smart_money_context=sm,
    )
    tmp_journal_db.insert_entry_snapshot(enriched)

    # Read back and verify Amendment 10 acceptance criteria: non-None
    # cvd_1h + buy_sell_ratio_1h + non-empty top_whale_positions.
    bundle = tmp_journal_db.get_trade(enriched.trade_basics.trade_id)
    assert bundle is not None
    es = bundle["entry_snapshot"]
    assert es.order_flow_state.cvd_1h == 1500.0
    assert es.order_flow_state.cvd_30m == 900.0
    assert es.order_flow_state.buy_sell_ratio_1h == 0.53
    assert es.order_flow_state.large_trade_count_1h == 4
    assert es.smart_money_context.hlp_side == "long"
    assert es.smart_money_context.hlp_size_usd == 7_500_000.0
    assert len(es.smart_money_context.top_whale_positions) == 2
    assert es.smart_money_context.smart_money_opens_1h == 2


def test_daemon_startup_migration_flag_is_idempotent(
    tmp_path: Any,
    sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """Simulate M7's first-run migration pattern: seed staging.db, run the
    migrate-then-set-flag sequence twice, assert the second run is a no-op
    (flag present → skip migration)."""
    from hynous.journal.migrate_staging import migrate_staging_to_journal
    from hynous.journal.staging_store import StagingStore

    staging_path = tmp_path / "staging.db"
    journal_path = tmp_path / "journal.db"

    staging = StagingStore(str(staging_path))
    staging.insert_entry_snapshot(sample_entry_snapshot)

    def _startup_sequence() -> str:
        """Replica of daemon.py:1056-1085 logic."""
        store = JournalStore(str(journal_path))
        flag = store.get_metadata("staging_migration_done")
        if flag != "1":
            if staging_path.exists():
                migrate_staging_to_journal(str(staging_path), str(journal_path))
            store.set_metadata("staging_migration_done", "1")
            return "migrated"
        return "skipped"

    # First startup: migrates
    assert _startup_sequence() == "migrated"
    journal = JournalStore(str(journal_path))
    assert len(journal.list_trades()) == 1
    assert journal.get_metadata("staging_migration_done") == "1"

    # Second startup: flag present → skip
    assert _startup_sequence() == "skipped"
    # Trade count unchanged
    assert len(journal.list_trades()) == 1


def test_migrate_staging_skips_corrupt_row(tmp_path: Any) -> None:
    """A malformed JSON row in staging is logged + skipped, not fatal."""
    import sqlite3

    from hynous.journal.migrate_staging import migrate_staging_to_journal

    staging_path = tmp_path / "staging.db"
    # Create minimal staging schema + inject a corrupt entry JSON
    conn = sqlite3.connect(str(staging_path))
    conn.executescript("""
        CREATE TABLE trade_entry_snapshots_staging (
            trade_id TEXT PRIMARY KEY,
            symbol TEXT, side TEXT, entry_ts TEXT,
            snapshot_json TEXT NOT NULL,
            schema_version TEXT, created_at TEXT
        );
        CREATE TABLE trade_exit_snapshots_staging (
            trade_id TEXT PRIMARY KEY,
            exit_ts TEXT, exit_classification TEXT,
            realized_pnl_usd REAL, snapshot_json TEXT NOT NULL,
            schema_version TEXT, created_at TEXT
        );
        CREATE TABLE trade_events_staging (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_id TEXT, ts TEXT, event_type TEXT,
            payload_json TEXT NOT NULL, created_at TEXT
        );
    """)
    conn.execute(
        "INSERT INTO trade_entry_snapshots_staging VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("bad_trade", "BTC", "long", "2026-04-12T10:00:00+00:00",
         "{not valid json", "1.0.0", "2026-04-12T10:00:00+00:00"),
    )
    conn.commit()
    conn.close()

    counts = migrate_staging_to_journal(
        str(staging_path), str(tmp_path / "journal.db"),
    )
    assert counts["entries"] == 0
    assert counts["skipped_entries"] == 1


# ---------------------------------------------------------------------------
# Phase 6 Milestone 4 — /patterns + /trades/{id}/related routes
# ---------------------------------------------------------------------------


def test_api_patterns_route_returns_latest(
    api_client: TestClient, tmp_journal_db: JournalStore,
) -> None:
    """Seed two patterns with different updated_at; assert newest first,
    JSON fields parsed, and pattern_type filter works.
    """
    import json as _json

    conn = tmp_journal_db._connect()
    try:
        conn.execute(
            """
            INSERT INTO trade_patterns
                (id, title, description, pattern_type, aggregate_json,
                 member_trade_ids_json, window_start, window_end,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "pat_old", "Old rollup", "older description",
                "system_health_report",
                _json.dumps({"total_trades": 5, "win_rate": 40.0}),
                _json.dumps(["t1", "t2", "t3"]),
                "2026-04-05T00:00:00+00:00",
                "2026-04-12T00:00:00+00:00",
                "2026-04-12T00:00:00+00:00",
                "2026-04-12T00:00:00+00:00",
            ),
        )
        conn.execute(
            """
            INSERT INTO trade_patterns
                (id, title, description, pattern_type, aggregate_json,
                 member_trade_ids_json, window_start, window_end,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "pat_new", "New rollup", "newer description",
                "system_health_report",
                _json.dumps({"total_trades": 8, "win_rate": 62.5}),
                _json.dumps(["t4", "t5", "t6", "t7"]),
                "2026-04-12T00:00:00+00:00",
                "2026-04-19T00:00:00+00:00",
                "2026-04-19T00:00:00+00:00",
                "2026-04-19T00:00:00+00:00",
            ),
        )
    finally:
        conn.close()

    resp = api_client.get("/api/v2/journal/patterns")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 2
    # Newest first
    assert data[0]["id"] == "pat_new"
    assert data[1]["id"] == "pat_old"
    # JSON columns parsed into native types
    assert isinstance(data[0]["aggregate"], dict)
    assert data[0]["aggregate"]["win_rate"] == 62.5
    assert isinstance(data[0]["member_trade_ids"], list)
    assert data[0]["member_trade_ids"] == ["t4", "t5", "t6", "t7"]

    # Filter by matching pattern_type — both rows still returned
    resp = api_client.get(
        "/api/v2/journal/patterns",
        params={"pattern_type": "system_health_report"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    # Filter by non-existent type — empty
    resp = api_client.get(
        "/api/v2/journal/patterns", params={"pattern_type": "not_a_type"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


def test_api_patterns_respects_limit(
    api_client: TestClient, tmp_journal_db: JournalStore,
) -> None:
    """Seed 12 pattern rows; assert limit=5 returns 5 newest in DESC order."""
    import json as _json

    conn = tmp_journal_db._connect()
    try:
        for i in range(12):
            conn.execute(
                """
                INSERT INTO trade_patterns
                    (id, title, description, pattern_type, aggregate_json,
                     member_trade_ids_json, window_start, window_end,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"pat_{i:02d}",
                    f"Rollup #{i}",
                    None,
                    "system_health_report",
                    _json.dumps({"i": i}),
                    _json.dumps([]),
                    "2026-04-05T00:00:00+00:00",
                    "2026-04-12T00:00:00+00:00",
                    "2026-04-12T00:00:00+00:00",
                    # Monotonically increasing updated_at — later i == newer
                    f"2026-04-12T10:{i:02d}:00+00:00",
                ),
            )
    finally:
        conn.close()

    resp = api_client.get("/api/v2/journal/patterns", params={"limit": 5})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 5
    # DESC ordering — ids 11, 10, 09, 08, 07
    assert [row["id"] for row in data] == [
        "pat_11", "pat_10", "pat_09", "pat_08", "pat_07",
    ]


def test_api_related_route_returns_linked_trades(
    api_client: TestClient, tmp_journal_db: JournalStore,
) -> None:
    """Three edges A→B(followed_by), A→C(same_regime_bucket), A→B(preceded_by).
    No dedup: B appears twice under different edge_types. Expect 3 rows,
    ordered by ``edge_type ASC, created_at DESC``.
    """
    for tid, pnl in (("A", 10.0), ("B", 20.0), ("C", -5.0)):
        tmp_journal_db.upsert_trade(
            trade_id=tid, symbol="BTC", side="long", trade_type="macro",
            status="closed", entry_ts="2026-04-12T10:00:00+00:00",
            realized_pnl_usd=pnl,
        )

    conn = tmp_journal_db._connect()
    try:
        conn.execute(
            """
            INSERT INTO trade_edges
                (source_trade_id, target_trade_id, edge_type, strength,
                 reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("A", "B", "followed_by", 0.8, "close in time",
             "2026-04-12T11:00:00+00:00"),
        )
        conn.execute(
            """
            INSERT INTO trade_edges
                (source_trade_id, target_trade_id, edge_type, strength,
                 reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("A", "C", "same_regime_bucket", 0.5, "same vol regime",
             "2026-04-12T11:05:00+00:00"),
        )
        conn.execute(
            """
            INSERT INTO trade_edges
                (source_trade_id, target_trade_id, edge_type, strength,
                 reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("A", "B", "preceded_by", 0.7, "prior context",
             "2026-04-12T11:10:00+00:00"),
        )
    finally:
        conn.close()

    resp = api_client.get("/api/v2/journal/trades/A/related")
    assert resp.status_code == 200
    rows = resp.json()
    # Raw rows — no dedup, B appears twice under distinct edge_types
    assert len(rows) == 3

    for row in rows:
        for key in (
            "other_id", "edge_type", "strength", "reason",
            "symbol", "side", "status", "realized_pnl_usd",
        ):
            assert key in row

    # Expected ordering: edge_type ASC, created_at DESC
    # followed_by < preceded_by < same_regime_bucket (alphabetical)
    assert [(r["edge_type"], r["other_id"]) for r in rows] == [
        ("followed_by", "B"),
        ("preceded_by", "B"),
        ("same_regime_bucket", "C"),
    ]


def test_api_related_route_filters_by_edge_type(
    api_client: TestClient, tmp_journal_db: JournalStore,
) -> None:
    """Same seed as previous test; edge_type=followed_by returns exactly 1 row."""
    for tid in ("A", "B", "C"):
        tmp_journal_db.upsert_trade(
            trade_id=tid, symbol="BTC", side="long", trade_type="macro",
            status="closed", entry_ts="2026-04-12T10:00:00+00:00",
            realized_pnl_usd=0.0,
        )

    conn = tmp_journal_db._connect()
    try:
        conn.execute(
            """
            INSERT INTO trade_edges
                (source_trade_id, target_trade_id, edge_type, strength,
                 reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("A", "B", "followed_by", 0.8, None,
             "2026-04-12T11:00:00+00:00"),
        )
        conn.execute(
            """
            INSERT INTO trade_edges
                (source_trade_id, target_trade_id, edge_type, strength,
                 reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("A", "C", "same_regime_bucket", 0.5, None,
             "2026-04-12T11:05:00+00:00"),
        )
        conn.execute(
            """
            INSERT INTO trade_edges
                (source_trade_id, target_trade_id, edge_type, strength,
                 reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("A", "B", "preceded_by", 0.7, None,
             "2026-04-12T11:10:00+00:00"),
        )
    finally:
        conn.close()

    resp = api_client.get(
        "/api/v2/journal/trades/A/related",
        params={"edge_type": "followed_by"},
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["other_id"] == "B"
    assert rows[0]["edge_type"] == "followed_by"
