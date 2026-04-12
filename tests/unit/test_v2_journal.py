"""Phase 2 journal module tests — Milestones 1 & 2.

M1: dataclass reconstruction helpers (Amendment 9).
M2: :class:`JournalStore` CRUD, aggregate stats, and daemon-compat methods.

Fixtures ``sample_entry_snapshot`` / ``sample_exit_snapshot`` / ``tmp_journal_db``
live in ``tests/conftest.py`` and autoload.
"""

from __future__ import annotations

import json
import struct
from dataclasses import asdict
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from hynous.journal.schema import (
    Counterfactuals,
    TradeEntrySnapshot,
    TradeExitSnapshot,
    entry_snapshot_from_dict,
    exit_snapshot_from_dict,
)

# ---------------------------------------------------------------------------
# M1 — reconstruction helpers (Amendment 9)
# ---------------------------------------------------------------------------


def test_entry_snapshot_round_trip_preserves_every_field(
    sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """asdict → json.dumps → json.loads → entry_snapshot_from_dict returns an
    instance equal to the original (all nested fields preserved)."""
    original = sample_entry_snapshot
    serialized = json.dumps(
        asdict(original), sort_keys=True, separators=(",", ":"), default=str,
    )
    restored = entry_snapshot_from_dict(json.loads(serialized))

    assert restored == original


def test_exit_snapshot_round_trip_preserves_every_field(
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """Same round-trip contract for :class:`TradeExitSnapshot`."""
    original = sample_exit_snapshot
    serialized = json.dumps(
        asdict(original), sort_keys=True, separators=(",", ":"), default=str,
    )
    restored = exit_snapshot_from_dict(json.loads(serialized))

    assert restored == original


def test_entry_snapshot_from_dict_raises_keyerror_on_missing_section() -> None:
    """Missing a top-level section (schema drift / corrupt row) raises
    KeyError — caller's responsibility to catch and skip, not swallow here.

    Empty dict is the clean "every section missing" case; the dict lookup
    for ``data["trade_basics"]`` fires KeyError before any TradeBasics()
    constructor runs.
    """
    with pytest.raises(KeyError):
        entry_snapshot_from_dict({})


# ---------------------------------------------------------------------------
# M2 — JournalStore: schema + CRUD
# ---------------------------------------------------------------------------


def test_journal_store_init_creates_schema(tmp_path: Any) -> None:
    """Fresh DB has all 9 tables (8 functional + journal_metadata)."""
    from hynous.journal.store import JournalStore

    store = JournalStore(str(tmp_path / "j.db"))
    conn = store._connect()
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' "
            "ORDER BY name",
        ).fetchall()
    finally:
        conn.close()

    names = {r["name"] for r in rows}
    assert names == {
        "journal_metadata",
        "trades",
        "trade_entry_snapshots",
        "trade_exit_snapshots",
        "trade_events",
        "trade_analyses",
        "trade_tags",
        "trade_edges",
        "trade_patterns",
    }


def test_upsert_trade_inserts_new_row(tmp_journal_db: Any) -> None:
    """Fresh trade_id inserts a row that's queryable by list_trades."""
    tmp_journal_db.upsert_trade(
        trade_id="t1", symbol="BTC", side="long", trade_type="macro",
        status="open", entry_ts="2026-04-12T10:00:00+00:00", entry_px=64000.0,
    )
    rows = tmp_journal_db.list_trades(symbol="BTC")
    assert len(rows) == 1
    assert rows[0]["trade_id"] == "t1"
    assert rows[0]["status"] == "open"
    assert rows[0]["entry_px"] == 64000.0


def test_upsert_trade_updates_existing_row(tmp_journal_db: Any) -> None:
    """Second upsert with the same trade_id updates mutable fields."""
    tmp_journal_db.upsert_trade(
        trade_id="t1", symbol="BTC", side="long", trade_type="macro",
        status="open", entry_ts="2026-04-12T10:00:00+00:00", entry_px=64000.0,
    )
    tmp_journal_db.upsert_trade(
        trade_id="t1", symbol="BTC", side="long", trade_type="macro",
        status="closed", exit_ts="2026-04-12T11:00:00+00:00",
        exit_px=65000.0, realized_pnl_usd=100.0, roe_pct=15.0,
    )
    row = tmp_journal_db.list_trades()[0]
    assert row["status"] == "closed"
    assert row["exit_px"] == 65000.0
    assert row["realized_pnl_usd"] == 100.0
    # Identity columns preserved
    assert row["symbol"] == "BTC"
    assert row["side"] == "long"


def test_insert_entry_snapshot_creates_trade_row(
    tmp_journal_db: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """insert_entry_snapshot upserts the parent trade row with status='open'."""
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    row = tmp_journal_db.list_trades()[0]
    assert row["trade_id"] == sample_entry_snapshot.trade_basics.trade_id
    assert row["status"] == "open"
    assert row["symbol"] == "BTC"
    assert row["leverage"] == 20


def test_insert_entry_snapshot_persists_json(
    tmp_journal_db: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """The serialized snapshot JSON round-trips to the original dataclass."""
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    data = tmp_journal_db.get_entry_snapshot_json(
        sample_entry_snapshot.trade_basics.trade_id,
    )
    assert data is not None
    restored = entry_snapshot_from_dict(data)
    assert restored == sample_entry_snapshot


def test_insert_exit_snapshot_updates_trade_status(
    tmp_journal_db: Any,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """Exit insert upgrades parent trade to status='closed' and fills exit columns."""
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tmp_journal_db.insert_exit_snapshot(sample_exit_snapshot)

    row = tmp_journal_db.list_trades()[0]
    assert row["status"] == "closed"
    assert row["exit_px"] == sample_exit_snapshot.trade_outcome.exit_px
    assert row["exit_classification"] == "trailing_stop"
    assert row["peak_roe"] == sample_exit_snapshot.roe_trajectory.peak_roe


def test_insert_lifecycle_event_persists(
    tmp_journal_db: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """Lifecycle event insert is queryable via get_events_for_trade."""
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tid = sample_entry_snapshot.trade_basics.trade_id
    tmp_journal_db.insert_lifecycle_event(
        trade_id=tid, ts="2026-04-12T10:20:00+00:00",
        event_type="dynamic_sl_placed", payload={"sl_px": 63500.0, "roe_at_placement": 0.0},
    )
    events = tmp_journal_db.get_events_for_trade(tid)
    assert len(events) == 1
    assert events[0]["event_type"] == "dynamic_sl_placed"
    assert events[0]["payload"] == {"sl_px": 63500.0, "roe_at_placement": 0.0}


def test_get_events_for_trade_ordered_chronologically(
    tmp_journal_db: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """Events come back in ascending ts order regardless of insert order."""
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tid = sample_entry_snapshot.trade_basics.trade_id
    # Insert out of chronological order
    tmp_journal_db.insert_lifecycle_event(
        trade_id=tid, ts="2026-04-12T11:00:00+00:00",
        event_type="trail_activated", payload={},
    )
    tmp_journal_db.insert_lifecycle_event(
        trade_id=tid, ts="2026-04-12T10:30:00+00:00",
        event_type="fee_be_set", payload={},
    )
    tmp_journal_db.insert_lifecycle_event(
        trade_id=tid, ts="2026-04-12T10:15:30+00:00",
        event_type="dynamic_sl_placed", payload={},
    )

    events = tmp_journal_db.get_events_for_trade(tid)
    event_types = [e["event_type"] for e in events]
    assert event_types == ["dynamic_sl_placed", "fee_be_set", "trail_activated"]


def test_insert_analysis_updates_trade_status_to_analyzed(
    tmp_journal_db: Any,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """After analysis insert, trade row status flips to 'analyzed'."""
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tmp_journal_db.insert_exit_snapshot(sample_exit_snapshot)
    tmp_journal_db.insert_analysis(
        trade_id=sample_entry_snapshot.trade_basics.trade_id,
        narrative="Clean trend-continuation long on BTC; exited at trailing stop after 24% ROE.",
        narrative_citations=[{"paragraph_idx": 0, "finding_ids": ["F1"]}],
        findings=[{"id": "F1", "type": "exit", "severity": "low", "interpretation": "ok"}],
        grades={"entry_quality": 85, "entry_timing": 70, "sl_placement": 80,
                "tp_placement": 60, "size_leverage": 75, "exit_quality": 90},
        mistake_tags=[],
        process_quality_score=77,
        one_line_summary="Clean trend long with proper mechanical exit.",
        unverified_claims=None,
        model_used="anthropic/claude-sonnet-4.5",
        prompt_version="v1",
    )
    row = tmp_journal_db.list_trades()[0]
    assert row["status"] == "analyzed"


def test_get_analysis_returns_full_record(
    tmp_journal_db: Any,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """get_analysis round-trips all structured fields."""
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tmp_journal_db.insert_exit_snapshot(sample_exit_snapshot)
    tid = sample_entry_snapshot.trade_basics.trade_id
    tmp_journal_db.insert_analysis(
        trade_id=tid,
        narrative="Narrative.",
        narrative_citations=[],
        findings=[{"id": "F1"}],
        grades={"entry_quality": 80, "entry_timing": 80, "sl_placement": 80,
                "tp_placement": 80, "size_leverage": 80, "exit_quality": 80},
        mistake_tags=["entered_too_early", "ignored_warning_signal"],
        process_quality_score=80,
        one_line_summary="Short summary.",
        unverified_claims=[{"claim": "unproven"}],
        model_used="anthropic/claude-sonnet-4.5",
        prompt_version="v1",
    )
    a = tmp_journal_db.get_analysis(tid)
    assert a is not None
    assert a["mistake_tags"] == ["entered_too_early", "ignored_warning_signal"]
    assert a["process_quality_score"] == 80
    assert a["grades"]["entry_quality"] == 80
    assert a["unverified_claims"] == [{"claim": "unproven"}]


def test_list_trades_filters_by_symbol(tmp_journal_db: Any) -> None:
    """list_trades symbol= parameter restricts to matching symbol rows."""
    tmp_journal_db.upsert_trade(trade_id="b1", symbol="BTC", side="long",
                                trade_type="macro", status="open",
                                entry_ts="2026-04-12T10:00:00+00:00")
    tmp_journal_db.upsert_trade(trade_id="e1", symbol="ETH", side="short",
                                trade_type="micro", status="open",
                                entry_ts="2026-04-12T10:05:00+00:00")
    btc_rows = tmp_journal_db.list_trades(symbol="BTC")
    assert [r["trade_id"] for r in btc_rows] == ["b1"]
    eth_rows = tmp_journal_db.list_trades(symbol="ETH")
    assert [r["trade_id"] for r in eth_rows] == ["e1"]


def test_list_trades_filters_by_status(tmp_journal_db: Any) -> None:
    """status= parameter restricts correctly."""
    tmp_journal_db.upsert_trade(trade_id="t_open", symbol="BTC", side="long",
                                trade_type="macro", status="open",
                                entry_ts="2026-04-12T10:00:00+00:00")
    tmp_journal_db.upsert_trade(trade_id="t_closed", symbol="BTC", side="long",
                                trade_type="macro", status="closed",
                                entry_ts="2026-04-12T09:00:00+00:00")
    tmp_journal_db.upsert_trade(trade_id="t_rejected", symbol="BTC", side="long",
                                trade_type="macro", status="rejected",
                                rejection_reason="low_composite_score")
    assert [r["trade_id"] for r in tmp_journal_db.list_trades(status="open")] == ["t_open"]
    assert [r["trade_id"] for r in tmp_journal_db.list_trades(status="closed")] == ["t_closed"]
    assert [r["trade_id"] for r in tmp_journal_db.list_trades(status="rejected")] == ["t_rejected"]


def test_list_trades_pagination(tmp_journal_db: Any) -> None:
    """limit+offset paginate correctly with entry_ts DESC ordering."""
    for i in range(5):
        tmp_journal_db.upsert_trade(
            trade_id=f"t{i}", symbol="BTC", side="long", trade_type="macro",
            status="open", entry_ts=f"2026-04-12T10:0{i}:00+00:00",
        )
    page1 = tmp_journal_db.list_trades(limit=2, offset=0)
    page2 = tmp_journal_db.list_trades(limit=2, offset=2)
    page3 = tmp_journal_db.list_trades(limit=2, offset=4)
    assert [r["trade_id"] for r in page1] == ["t4", "t3"]
    assert [r["trade_id"] for r in page2] == ["t2", "t1"]
    assert [r["trade_id"] for r in page3] == ["t0"]


def test_add_and_remove_tag(tmp_journal_db: Any) -> None:
    """add_tag then remove_tag leaves no tag on the trade."""
    tmp_journal_db.upsert_trade(trade_id="t1", symbol="BTC", side="long",
                                trade_type="macro", status="open")
    tmp_journal_db.add_tag("t1", "revenge_trade", source="manual")
    assert tmp_journal_db.get_tags("t1") and tmp_journal_db.get_tags("t1")[0]["tag"] == "revenge_trade"
    tmp_journal_db.remove_tag("t1", "revenge_trade")
    assert tmp_journal_db.get_tags("t1") == []


def test_get_tags_returns_all_sources(tmp_journal_db: Any) -> None:
    """Tags from different sources are all returned."""
    tmp_journal_db.upsert_trade(trade_id="t1", symbol="BTC", side="long",
                                trade_type="macro", status="open")
    tmp_journal_db.add_tag("t1", "tag_a", source="llm")
    tmp_journal_db.add_tag("t1", "tag_b", source="manual")
    tmp_journal_db.add_tag("t1", "tag_c", source="auto")

    tags = tmp_journal_db.get_tags("t1")
    sources = {t["source"] for t in tags}
    assert sources == {"llm", "manual", "auto"}
    assert {t["tag"] for t in tags} == {"tag_a", "tag_b", "tag_c"}


def test_get_aggregate_stats_empty(tmp_journal_db: Any) -> None:
    """No trades → all zeros."""
    stats = tmp_journal_db.get_aggregate_stats()
    assert stats["total_trades"] == 0
    assert stats["wins"] == 0
    assert stats["losses"] == 0
    assert stats["win_rate"] == 0.0
    assert stats["profit_factor"] == 0.0


def test_get_aggregate_stats_with_mixed_outcomes(tmp_journal_db: Any) -> None:
    """3 wins + 2 losses → win_rate=60, profit_factor computed from gross."""
    trades = [
        ("t1", 100.0), ("t2", 200.0), ("t3", 150.0),  # 3 wins, gross profit 450
        ("t4", -50.0), ("t5", -100.0),                  # 2 losses, gross loss 150
    ]
    for tid, pnl in trades:
        tmp_journal_db.upsert_trade(
            trade_id=tid, symbol="BTC", side="long", trade_type="macro",
            status="closed", entry_ts="2026-04-12T10:00:00+00:00",
            realized_pnl_usd=pnl, hold_duration_s=3600,
        )
    stats = tmp_journal_db.get_aggregate_stats()
    assert stats["total_trades"] == 5
    assert stats["wins"] == 3
    assert stats["losses"] == 2
    assert stats["win_rate"] == 60.0
    assert stats["total_pnl"] == 300.0
    assert stats["profit_factor"] == 3.0  # 450 / 150
    assert stats["best_trade"] == 200.0
    assert stats["worst_trade"] == -100.0
    assert stats["avg_hold_s"] == 3600


def test_get_trade_returns_full_bundle(
    tmp_journal_db: Any,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """get_trade bundle includes row + entry_snapshot + exit_snapshot + counterfactuals
    + events + analysis + tags, with every expected key present.
    """
    tid = sample_entry_snapshot.trade_basics.trade_id
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tmp_journal_db.insert_lifecycle_event(
        trade_id=tid, ts="2026-04-12T10:20:00+00:00",
        event_type="dynamic_sl_placed", payload={"sl_px": 63500.0},
    )
    tmp_journal_db.insert_exit_snapshot(sample_exit_snapshot)
    tmp_journal_db.insert_analysis(
        trade_id=tid, narrative="N.", narrative_citations=[],
        findings=[], grades={"entry_quality": 75, "entry_timing": 75,
                             "sl_placement": 75, "tp_placement": 75,
                             "size_leverage": 75, "exit_quality": 75},
        mistake_tags=[], process_quality_score=75,
        one_line_summary="s", unverified_claims=None,
        model_used="x", prompt_version="v1",
    )
    tmp_journal_db.add_tag(tid, "trend_continuation", source="llm")

    bundle = tmp_journal_db.get_trade(tid)
    assert bundle is not None
    for key in ("trade_id", "symbol", "side", "status",
                "entry_snapshot", "exit_snapshot", "counterfactuals",
                "events", "analysis", "tags"):
        assert key in bundle
    assert len(bundle["events"]) == 1
    assert len(bundle["tags"]) == 1
    assert bundle["tags"][0]["tag"] == "trend_continuation"
    assert bundle["analysis"] is not None
    assert bundle["analysis"]["process_quality_score"] == 75


def test_get_trade_hydrates_nested_dataclasses(
    tmp_journal_db: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """End-to-end: insert → get_trade returns real TradeEntrySnapshot instance,
    not a raw dict (Amendment 9 empirical verification)."""
    tid = sample_entry_snapshot.trade_basics.trade_id
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    bundle = tmp_journal_db.get_trade(tid)

    assert bundle is not None
    assert isinstance(bundle["entry_snapshot"], TradeEntrySnapshot)
    assert (
        bundle["entry_snapshot"].trade_basics.symbol
        == sample_entry_snapshot.trade_basics.symbol
    )
    assert (
        bundle["entry_snapshot"].ml_snapshot.composite_entry_score
        == sample_entry_snapshot.ml_snapshot.composite_entry_score
    )


# ---------------------------------------------------------------------------
# M2 — daemon compatibility methods (architect delta 1)
# ---------------------------------------------------------------------------


def test_get_entry_snapshot_json_returns_dict_or_none(
    tmp_journal_db: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """Returns a parsed dict for an existing trade; None for unknown trade_id."""
    tid = sample_entry_snapshot.trade_basics.trade_id
    assert tmp_journal_db.get_entry_snapshot_json("nonexistent") is None

    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    data = tmp_journal_db.get_entry_snapshot_json(tid)
    assert isinstance(data, dict)
    assert data["trade_basics"]["trade_id"] == tid


def test_list_exit_snapshots_needing_counterfactuals_filters_on_flags(
    tmp_journal_db: Any,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """Only exits with both flags False come back; resolved exits are filtered out."""
    # Trade 1 — counterfactuals still both False (needs recompute)
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tmp_journal_db.insert_exit_snapshot(sample_exit_snapshot)

    # Trade 2 — make a second entry+exit where did_tp_hit_later=True (resolved)
    from dataclasses import replace as dc_replace


    basics2 = dc_replace(sample_entry_snapshot.trade_basics, trade_id="trade_zzz9999999999z")
    entry2 = dc_replace(sample_entry_snapshot, trade_basics=basics2)
    tmp_journal_db.insert_entry_snapshot(entry2)

    cf_resolved = Counterfactuals(
        counterfactual_window_s=7200,
        max_favorable_price=65700.0,
        max_adverse_price=64200.0,
        optimal_exit_px=65700.0,
        optimal_exit_ts="2026-04-12T12:05:00+00:00",
        did_tp_hit_later=True,   # <-- resolved
        did_tp_hit_ts="2026-04-12T12:00:00+00:00",
        did_sl_get_hunted=False,
        sl_hunt_reversal_pct=None,
    )
    exit2 = dc_replace(
        sample_exit_snapshot, trade_id=basics2.trade_id, counterfactuals=cf_resolved,
    )
    tmp_journal_db.insert_exit_snapshot(exit2)

    pending = tmp_journal_db.list_exit_snapshots_needing_counterfactuals()
    ids = [p["trade_id"] for p in pending]
    assert sample_entry_snapshot.trade_basics.trade_id in ids
    assert basics2.trade_id not in ids  # resolved exit excluded

    # Return shape contract: {trade_id, exit_ts, snapshot}
    item = pending[0]
    assert set(item.keys()) == {"trade_id", "exit_ts", "snapshot"}
    assert item["exit_ts"] == sample_exit_snapshot.trade_outcome.exit_ts
    assert isinstance(item["snapshot"], dict)
    # Used by daemon.py:4720 — snapshot must include counterfactuals section
    assert "counterfactuals" in item["snapshot"]


def test_update_exit_snapshot_overwrites_existing_row(
    tmp_journal_db: Any,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """update_exit_snapshot persists new counterfactuals + snapshot JSON in place."""
    tid = sample_entry_snapshot.trade_basics.trade_id
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tmp_journal_db.insert_exit_snapshot(sample_exit_snapshot)

    # Mutate counterfactuals and push update
    new_cf = Counterfactuals(
        counterfactual_window_s=14400,
        max_favorable_price=66000.0,
        max_adverse_price=63800.0,
        optimal_exit_px=66000.0,
        optimal_exit_ts="2026-04-12T13:00:00+00:00",
        did_tp_hit_later=True,
        did_tp_hit_ts="2026-04-12T12:50:00+00:00",
        did_sl_get_hunted=True,
        sl_hunt_reversal_pct=1.4,
    )
    updated = TradeExitSnapshot(
        trade_id=tid,
        trade_outcome=sample_exit_snapshot.trade_outcome,
        roe_trajectory=sample_exit_snapshot.roe_trajectory,
        counterfactuals=new_cf,
        ml_exit_comparison=sample_exit_snapshot.ml_exit_comparison,
        market_state_at_exit=sample_exit_snapshot.market_state_at_exit,
        price_path_1m=sample_exit_snapshot.price_path_1m,
        schema_version=sample_exit_snapshot.schema_version,
    )
    tmp_journal_db.update_exit_snapshot(tid, updated)

    bundle = tmp_journal_db.get_trade(tid)
    assert bundle is not None
    assert bundle["counterfactuals"]["did_tp_hit_later"] is True
    assert bundle["counterfactuals"]["did_sl_get_hunted"] is True
    assert bundle["counterfactuals"]["sl_hunt_reversal_pct"] == 1.4
    assert bundle["counterfactuals"]["counterfactual_window_s"] == 14400

    # Also verify the full-snapshot column was updated (not just counterfactuals)
    assert isinstance(bundle["exit_snapshot"], TradeExitSnapshot)
    assert bundle["exit_snapshot"].counterfactuals.did_tp_hit_later is True

    # And the filter now excludes this one (both flags are True → not "needing")
    pending_ids = [
        p["trade_id"]
        for p in tmp_journal_db.list_exit_snapshots_needing_counterfactuals()
    ]
    assert tid not in pending_ids


# ---------------------------------------------------------------------------
# M3 — EmbeddingClient + cosine + semantic search
# ---------------------------------------------------------------------------


def _pack_vec(floats: list[float]) -> bytes:
    """Test helper: pack a list of floats into the float32 byte layout used
    by EmbeddingClient / search_semantic."""
    return struct.pack(f"{len(floats)}f", *floats)


def test_embedding_client_strips_openai_prefix_from_model_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Config stores ``openai/text-embedding-3-small``; OpenAI API rejects
    provider-prefixed names. The client must strip the prefix at init so
    both forms work (architect delta 3)."""
    from hynous.journal.embeddings import EmbeddingClient

    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    client_prefixed = EmbeddingClient(model="openai/text-embedding-3-small")
    client_bare = EmbeddingClient(model="text-embedding-3-small")
    assert client_prefixed._model == "text-embedding-3-small"
    assert client_bare._model == "text-embedding-3-small"


def test_embedding_client_embed_single(monkeypatch: pytest.MonkeyPatch) -> None:
    """embed() returns float32 bytes truncated to comparison_dim (512)."""
    from hynous.journal.embeddings import EmbeddingClient

    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    # OpenAI returns a 1536-d vector; we truncate to 512.
    fake_vec = [0.001 * i for i in range(1536)]

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"data": [{"embedding": fake_vec}]}
    mock_resp.raise_for_status.return_value = None

    client = EmbeddingClient()
    with patch.object(client._session, "post", return_value=mock_resp) as mock_post:
        result = client.embed("hello world")

    assert isinstance(result, bytes)
    assert len(result) == 512 * 4  # 512 float32 values

    unpacked = struct.unpack("512f", result)
    # First 512 values of fake_vec, allowing float32 quantization drift.
    for i in range(512):
        assert abs(unpacked[i] - fake_vec[i]) < 1e-5

    # Verify we called OpenAI with the bare model name.
    call_json = mock_post.call_args.kwargs["json"]
    assert call_json["model"] == "text-embedding-3-small"
    assert call_json["input"] == ["hello world"]


def test_embedding_client_embed_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    """embed_batch preserves input order and returns one bytes blob per text."""
    from hynous.journal.embeddings import EmbeddingClient

    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    vecs = [
        [1.0] * 1536,
        [0.5] * 1536,
        [-0.5] * 1536,
    ]

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"data": [{"embedding": v} for v in vecs]}
    mock_resp.raise_for_status.return_value = None

    client = EmbeddingClient()
    with patch.object(client._session, "post", return_value=mock_resp):
        results = client.embed_batch(["a", "b", "c"])

    assert len(results) == 3
    for blob, expected in zip(results, vecs):
        assert len(blob) == 512 * 4
        unpacked = struct.unpack("512f", blob)
        # Every element should match the scalar the input was filled with.
        for got, want in zip(unpacked, expected[:512]):
            assert abs(got - want) < 1e-5


def test_cosine_similarity_identical_vectors() -> None:
    """Identical nonzero vectors have cosine similarity 1.0."""
    from hynous.journal.embeddings import cosine_similarity

    v = _pack_vec([1.0, 2.0, 3.0, 4.0])
    assert abs(cosine_similarity(v, v) - 1.0) < 1e-6


def test_cosine_similarity_orthogonal_vectors() -> None:
    """Orthogonal vectors have cosine similarity 0.0."""
    from hynous.journal.embeddings import cosine_similarity

    a = _pack_vec([1.0, 0.0, 0.0, 0.0])
    b = _pack_vec([0.0, 1.0, 0.0, 0.0])
    assert abs(cosine_similarity(a, b)) < 1e-6

    # Defensive branch: empty blob / mismatched lengths → 0.0
    assert cosine_similarity(b"", a) == 0.0
    assert cosine_similarity(a, _pack_vec([1.0, 0.0])) == 0.0


def test_search_semantic_orders_by_score(
    tmp_journal_db: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """Seed three entries with known embeddings; search by a vector pointing
    along one axis and verify ordering by cosine similarity."""
    from dataclasses import replace as dc_replace

    # Three trades, embeddings point along three orthogonal axes.
    emb_a = _pack_vec([1.0, 0.0, 0.0])
    emb_b = _pack_vec([0.5, 0.5, 0.0])  # 45° to A
    emb_c = _pack_vec([0.0, 1.0, 0.0])  # 90° to A

    basics_a = dc_replace(sample_entry_snapshot.trade_basics, trade_id="axis_a_trade")
    basics_b = dc_replace(sample_entry_snapshot.trade_basics, trade_id="axis_b_trade")
    basics_c = dc_replace(sample_entry_snapshot.trade_basics, trade_id="axis_c_trade")
    snap_a = dc_replace(sample_entry_snapshot, trade_basics=basics_a)
    snap_b = dc_replace(sample_entry_snapshot, trade_basics=basics_b)
    snap_c = dc_replace(sample_entry_snapshot, trade_basics=basics_c)

    tmp_journal_db.insert_entry_snapshot(snap_a, embedding=emb_a)
    tmp_journal_db.insert_entry_snapshot(snap_b, embedding=emb_b)
    tmp_journal_db.insert_entry_snapshot(snap_c, embedding=emb_c)

    # Query along A-axis → A should rank first, B second, C last.
    query = _pack_vec([1.0, 0.0, 0.0])
    results = tmp_journal_db.search_semantic(query_embedding=query, scope="entry")
    ranked_ids = [r["trade_id"] for r in results]
    assert ranked_ids == ["axis_a_trade", "axis_b_trade", "axis_c_trade"]
    # Scores descending
    assert results[0]["score"] > results[1]["score"] > results[2]["score"]
    # Top score is ~1.0 (identical)
    assert abs(results[0]["score"] - 1.0) < 1e-6
    # Last score is ~0.0 (orthogonal)
    assert abs(results[2]["score"]) < 1e-6


def test_build_entry_embedding_text_produces_expected_format(
    sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """build_entry_embedding_text returns a single-line pipe-joined summary
    capturing symbol/side/leverage/trigger/ML signals/market state."""
    from hynous.journal.embeddings import build_entry_embedding_text

    snap_dict = asdict(sample_entry_snapshot)
    text = build_entry_embedding_text(snap_dict)
    assert "BTC long 20x" in text
    assert "trigger: scanner composite_score" in text
    assert "composite entry score: 0.71 strong" in text
    assert "vol regime: normal" in text
    assert "direction signal: long" in text
    assert "|" in text  # pipe-separated


# ---------------------------------------------------------------------------
# M6 — Amendment 10 order flow + smart money backfill
# ---------------------------------------------------------------------------


def test_build_order_flow_state_populates_windows_from_mock_client() -> None:
    """Mocked data-layer response → every window / ratio / CVD / large-trade
    count populated correctly on OrderFlowState."""
    from hynous.journal.capture import _build_order_flow_state

    mock_client = MagicMock()
    mock_client.order_flow.return_value = {
        "coin": "BTC",
        "windows": {
            "1m":  {"cvd": 100.0, "buy_pct": 55.0},
            "5m":  {"cvd": 300.0, "buy_pct": 52.0},
            "15m": {"cvd": 600.0, "buy_pct": 48.0},
            "30m": {"cvd": 900.0, "buy_pct": 47.0},
            "1h":  {"cvd": 1200.0, "buy_pct": 51.0},
        },
    }
    mock_client.large_trade_count.return_value = {"count": 7}

    with patch(
        "hynous.data.providers.hynous_data.get_client",
        return_value=mock_client,
    ):
        state = _build_order_flow_state(daemon=MagicMock(), symbol="BTC")

    assert state.cvd_30m == 900.0
    assert state.cvd_1h == 1200.0
    # cvd_acceleration = cvd_5m - cvd_15m / 3 = 300 - 200 = 100
    assert state.cvd_acceleration == 100.0
    assert state.buy_sell_ratio_1m == 0.55
    assert state.buy_sell_ratio_5m == 0.52
    assert state.buy_sell_ratio_15m == 0.48
    assert state.buy_sell_ratio_1h == 0.51
    assert state.large_trade_count_1h == 7


def test_build_order_flow_state_graceful_when_data_layer_down() -> None:
    """If ``get_client`` raises, return an all-None OrderFlowState (not raise)."""
    from hynous.journal.capture import _build_order_flow_state

    with patch(
        "hynous.data.providers.hynous_data.get_client",
        side_effect=RuntimeError("connection refused"),
    ):
        state = _build_order_flow_state(daemon=MagicMock(), symbol="BTC")

    # Every field back to default (None / None / None / ... / None).
    assert state.cvd_1h is None
    assert state.cvd_30m is None
    assert state.buy_sell_ratio_1h is None
    assert state.large_trade_count_1h is None


def test_build_smart_money_context_aggregates_hlp_per_symbol() -> None:
    """HLP aggregation: only positions matching the target symbol count
    toward net/size; cross-coin positions are ignored."""
    from hynous.journal.capture import _build_smart_money_context

    mock_client = MagicMock()
    mock_client.hlp_positions.return_value = {
        "positions": [
            {"coin": "BTC", "side": "long", "size_usd": 5_000_000.0},
            {"coin": "BTC", "side": "short", "size_usd": 2_000_000.0},
            {"coin": "ETH", "side": "long", "size_usd": 10_000_000.0},  # ignored
        ],
    }
    mock_client.whales.return_value = {
        "positions": [{"wallet": "0x1", "size_usd": 3.0e6}],
    }
    mock_client.sm_changes.return_value = {"changes": []}

    with patch(
        "hynous.data.providers.hynous_data.get_client",
        return_value=mock_client,
    ):
        ctx = _build_smart_money_context(daemon=MagicMock(), symbol="BTC")

    assert ctx.hlp_net_delta_usd == 3_000_000.0  # 5M long - 2M short
    assert ctx.hlp_size_usd == 7_000_000.0       # 5M + 2M (BTC only)
    assert ctx.hlp_side == "long"
    assert len(ctx.top_whale_positions) == 1


def test_build_smart_money_context_counts_sm_opens_for_symbol_only() -> None:
    """sm_changes response filters to target symbol; count includes
    entry/flip/increase actions (architect delta 2); 'exit' is excluded."""
    from hynous.journal.capture import _build_smart_money_context

    mock_client = MagicMock()
    mock_client.hlp_positions.return_value = {"positions": []}
    mock_client.whales.return_value = {"positions": []}
    mock_client.sm_changes.return_value = {
        "changes": [
            # Three opens on BTC (entry + flip + increase)
            {"coin": "BTC", "action": "entry", "side": "long"},
            {"coin": "BTC", "action": "flip", "side": "short"},
            {"coin": "BTC", "action": "increase", "side": "long"},
            # Exit on BTC — should NOT count
            {"coin": "BTC", "action": "exit", "side": "long"},
            # Entry on a different coin — filtered out
            {"coin": "ETH", "action": "entry", "side": "long"},
        ],
    }

    with patch(
        "hynous.data.providers.hynous_data.get_client",
        return_value=mock_client,
    ):
        ctx = _build_smart_money_context(daemon=MagicMock(), symbol="BTC")

    assert ctx.smart_money_opens_1h == 3


def test_build_smart_money_context_graceful_when_all_endpoints_down() -> None:
    """Every data-layer endpoint raises → SmartMoneyContext comes back with
    defaults, no exception escapes."""
    from hynous.journal.capture import _build_smart_money_context

    mock_client = MagicMock()
    mock_client.hlp_positions.side_effect = RuntimeError("boom")
    mock_client.whales.side_effect = RuntimeError("boom")
    mock_client.sm_changes.side_effect = RuntimeError("boom")

    with patch(
        "hynous.data.providers.hynous_data.get_client",
        return_value=mock_client,
    ):
        ctx = _build_smart_money_context(daemon=MagicMock(), symbol="BTC")

    assert ctx.hlp_net_delta_usd is None
    assert ctx.hlp_side is None
    assert ctx.hlp_size_usd is None
    assert ctx.top_whale_positions == []
    assert ctx.smart_money_opens_1h == 0
