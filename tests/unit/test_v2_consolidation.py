"""Phase 6 Milestone 1 — consolidation edge-builder unit tests.

Covers the four edge builders in :mod:`hynous.journal.consolidation` plus
the dedup and aggregate counting contracts for :func:`build_edges`.

All tests seed a tmp :class:`JournalStore` via the public
``upsert_trade`` / ``insert_entry_snapshot`` API and invoke the builders
directly. No mocks, no network, no LLM.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from typing import Any

from hynous.journal.consolidation import (
    _build_regime_bucket_edges,
    _build_rejection_reason_edges,
    _build_rejection_vs_contemporaneous_edges,
    _build_temporal_edges,
    _insert_edge,
    build_edges,
)
from hynous.journal.schema import TradeEntrySnapshot


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _edges(store: Any) -> list[dict[str, Any]]:
    """Return every row in trade_edges as plain dicts."""
    conn = store._connect()
    try:
        rows = conn.execute(
            "SELECT source_trade_id, target_trade_id, edge_type, reason "
            "FROM trade_edges ORDER BY id ASC",
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _snapshot_with_regime(
    base: TradeEntrySnapshot,
    *,
    trade_id: str,
    entry_ts: str,
    vol_1h_regime: str | None,
) -> TradeEntrySnapshot:
    """Clone ``base`` with a new trade_id / entry_ts / vol_1h_regime."""
    new_basics = replace(base.trade_basics, trade_id=trade_id, entry_ts=entry_ts)
    new_ml = replace(base.ml_snapshot, vol_1h_regime=vol_1h_regime)
    return replace(base, trade_basics=new_basics, ml_snapshot=new_ml)


# ---------------------------------------------------------------------------
# Temporal edges
# ---------------------------------------------------------------------------


def test_build_temporal_edges_creates_preceded_and_followed_by(
    tmp_journal_db: Any,
) -> None:
    """With a prior closed trade, builder inserts both a followed_by (old→new)
    and a preceded_by (new→old) edge and returns a count of 2."""
    tmp_journal_db.upsert_trade(
        trade_id="t_old", symbol="BTC", side="long", trade_type="macro",
        status="closed", entry_ts="2026-04-10T10:00:00+00:00",
    )
    tmp_journal_db.upsert_trade(
        trade_id="t_new", symbol="BTC", side="long", trade_type="macro",
        status="closed", entry_ts="2026-04-12T10:00:00+00:00",
    )

    trade = tmp_journal_db.get_trade("t_new")
    assert trade is not None
    count = _build_temporal_edges(tmp_journal_db, trade)

    assert count == 2
    rows = _edges(tmp_journal_db)
    edge_types = {r["edge_type"] for r in rows}
    assert edge_types == {"preceded_by", "followed_by"}
    # followed_by points from prev -> current
    fb = [r for r in rows if r["edge_type"] == "followed_by"][0]
    assert fb["source_trade_id"] == "t_old"
    assert fb["target_trade_id"] == "t_new"
    # preceded_by points from current -> prev
    pb = [r for r in rows if r["edge_type"] == "preceded_by"][0]
    assert pb["source_trade_id"] == "t_new"
    assert pb["target_trade_id"] == "t_old"


def test_build_temporal_edges_skips_when_no_prior_trade(tmp_journal_db: Any) -> None:
    """First-ever trade on a symbol yields zero temporal edges."""
    tmp_journal_db.upsert_trade(
        trade_id="t_only", symbol="BTC", side="long", trade_type="macro",
        status="closed", entry_ts="2026-04-12T10:00:00+00:00",
    )
    trade = tmp_journal_db.get_trade("t_only")
    assert trade is not None
    count = _build_temporal_edges(tmp_journal_db, trade)

    assert count == 0
    assert _edges(tmp_journal_db) == []


# ---------------------------------------------------------------------------
# Regime bucket edges
# ---------------------------------------------------------------------------


def test_build_regime_bucket_edges_joins_matching_regimes(
    tmp_journal_db: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """Taken trades with matching vol_1h_regime get linked; non-matches are skipped."""
    now = datetime(2026, 4, 12, 10, 0, 0, tzinfo=timezone.utc)

    # Two peers with matching "normal" regime, one with "extreme"
    match_a = _snapshot_with_regime(
        sample_entry_snapshot,
        trade_id="t_match_a",
        entry_ts=(now - timedelta(days=2)).isoformat(),
        vol_1h_regime="normal",
    )
    match_b = _snapshot_with_regime(
        sample_entry_snapshot,
        trade_id="t_match_b",
        entry_ts=(now - timedelta(days=5)).isoformat(),
        vol_1h_regime="normal",
    )
    other = _snapshot_with_regime(
        sample_entry_snapshot,
        trade_id="t_other",
        entry_ts=(now - timedelta(days=3)).isoformat(),
        vol_1h_regime="extreme",
    )
    source = _snapshot_with_regime(
        sample_entry_snapshot,
        trade_id="t_source",
        entry_ts=now.isoformat(),
        vol_1h_regime="normal",
    )

    for snap in (match_a, match_b, other, source):
        tmp_journal_db.insert_entry_snapshot(snap)
    # Flip peers to 'closed' so they pass the status filter
    for tid in ("t_match_a", "t_match_b", "t_other"):
        tmp_journal_db.upsert_trade(
            trade_id=tid, symbol="BTC", side="long", trade_type="macro",
            status="closed",
        )

    trade = tmp_journal_db.get_trade("t_source")
    assert trade is not None
    count = _build_regime_bucket_edges(tmp_journal_db, trade)

    assert count == 2
    rows = _edges(tmp_journal_db)
    targets = {r["target_trade_id"] for r in rows}
    assert targets == {"t_match_a", "t_match_b"}
    assert all(r["edge_type"] == "same_regime_bucket" for r in rows)
    assert all(r["source_trade_id"] == "t_source" for r in rows)


def test_build_regime_bucket_edges_respects_30d_window(
    tmp_journal_db: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """Trades with matching regime but entry_ts older than 30 days are excluded."""
    now = datetime(2026, 4, 12, 10, 0, 0, tzinfo=timezone.utc)

    in_window = _snapshot_with_regime(
        sample_entry_snapshot,
        trade_id="t_in",
        entry_ts=(now - timedelta(days=15)).isoformat(),
        vol_1h_regime="normal",
    )
    out_of_window = _snapshot_with_regime(
        sample_entry_snapshot,
        trade_id="t_out",
        entry_ts=(now - timedelta(days=45)).isoformat(),
        vol_1h_regime="normal",
    )
    source = _snapshot_with_regime(
        sample_entry_snapshot,
        trade_id="t_source",
        entry_ts=now.isoformat(),
        vol_1h_regime="normal",
    )

    for snap in (in_window, out_of_window, source):
        tmp_journal_db.insert_entry_snapshot(snap)
    for tid in ("t_in", "t_out"):
        tmp_journal_db.upsert_trade(
            trade_id=tid, symbol="BTC", side="long", trade_type="macro",
            status="closed",
        )

    trade = tmp_journal_db.get_trade("t_source")
    assert trade is not None
    count = _build_regime_bucket_edges(tmp_journal_db, trade)

    assert count == 1
    rows = _edges(tmp_journal_db)
    assert len(rows) == 1
    assert rows[0]["target_trade_id"] == "t_in"


def test_build_regime_bucket_edges_limits_to_10(
    tmp_journal_db: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """Builder caps edge creation at 10 even when 15 matches exist."""
    now = datetime(2026, 4, 12, 10, 0, 0, tzinfo=timezone.utc)

    for i in range(15):
        snap = _snapshot_with_regime(
            sample_entry_snapshot,
            trade_id=f"t_peer_{i:02d}",
            entry_ts=(now - timedelta(days=1, minutes=i)).isoformat(),
            vol_1h_regime="normal",
        )
        tmp_journal_db.insert_entry_snapshot(snap)
        tmp_journal_db.upsert_trade(
            trade_id=f"t_peer_{i:02d}", symbol="BTC", side="long",
            trade_type="macro", status="closed",
        )

    source = _snapshot_with_regime(
        sample_entry_snapshot,
        trade_id="t_source",
        entry_ts=now.isoformat(),
        vol_1h_regime="normal",
    )
    tmp_journal_db.insert_entry_snapshot(source)

    trade = tmp_journal_db.get_trade("t_source")
    assert trade is not None
    count = _build_regime_bucket_edges(tmp_journal_db, trade)

    assert count == 10
    assert len(_edges(tmp_journal_db)) == 10


# ---------------------------------------------------------------------------
# Rejection reason edges
# ---------------------------------------------------------------------------


def test_build_rejection_reason_edges_groups_by_reason(tmp_journal_db: Any) -> None:
    """Rejected trades with matching rejection_reason are linked; other reasons excluded."""
    now = datetime(2026, 4, 12, 10, 0, 0, tzinfo=timezone.utc)

    tmp_journal_db.upsert_trade(
        trade_id="r_match_a", symbol="BTC", side="long", trade_type="macro",
        status="rejected", entry_ts=(now - timedelta(hours=2)).isoformat(),
        rejection_reason="composite_below_threshold",
    )
    tmp_journal_db.upsert_trade(
        trade_id="r_match_b", symbol="BTC", side="long", trade_type="macro",
        status="rejected", entry_ts=(now - timedelta(hours=5)).isoformat(),
        rejection_reason="composite_below_threshold",
    )
    tmp_journal_db.upsert_trade(
        trade_id="r_other", symbol="BTC", side="long", trade_type="macro",
        status="rejected", entry_ts=(now - timedelta(hours=3)).isoformat(),
        rejection_reason="funding_gate",
    )
    tmp_journal_db.upsert_trade(
        trade_id="r_source", symbol="BTC", side="long", trade_type="macro",
        status="rejected", entry_ts=now.isoformat(),
        rejection_reason="composite_below_threshold",
    )

    trade = tmp_journal_db.get_trade("r_source")
    assert trade is not None
    count = _build_rejection_reason_edges(tmp_journal_db, trade)

    assert count == 2
    rows = _edges(tmp_journal_db)
    targets = {r["target_trade_id"] for r in rows}
    assert targets == {"r_match_a", "r_match_b"}
    assert all(r["edge_type"] == "same_rejection_reason" for r in rows)


def test_build_rejection_reason_edges_skips_non_rejections(
    tmp_journal_db: Any,
) -> None:
    """A closed trade never triggers rejection_reason edges, even with matching reason."""
    now = datetime(2026, 4, 12, 10, 0, 0, tzinfo=timezone.utc)

    tmp_journal_db.upsert_trade(
        trade_id="r_peer", symbol="BTC", side="long", trade_type="macro",
        status="rejected", entry_ts=(now - timedelta(hours=2)).isoformat(),
        rejection_reason="composite_below_threshold",
    )
    tmp_journal_db.upsert_trade(
        trade_id="t_closed", symbol="BTC", side="long", trade_type="macro",
        status="closed", entry_ts=now.isoformat(),
        rejection_reason="composite_below_threshold",
    )

    trade = tmp_journal_db.get_trade("t_closed")
    assert trade is not None
    count = _build_rejection_reason_edges(tmp_journal_db, trade)

    assert count == 0
    assert _edges(tmp_journal_db) == []


# ---------------------------------------------------------------------------
# Rejection-vs-contemporaneous edges
# ---------------------------------------------------------------------------


def test_build_rejection_vs_contemporaneous_links_across_statuses(
    tmp_journal_db: Any,
) -> None:
    """A rejection within ±2h of a taken trade on the same symbol gets linked."""
    now = datetime(2026, 4, 12, 10, 0, 0, tzinfo=timezone.utc)

    tmp_journal_db.upsert_trade(
        trade_id="t_taken", symbol="BTC", side="long", trade_type="macro",
        status="closed", entry_ts=(now - timedelta(minutes=30)).isoformat(),
    )
    tmp_journal_db.upsert_trade(
        trade_id="r_source", symbol="BTC", side="long", trade_type="macro",
        status="rejected", entry_ts=now.isoformat(),
        rejection_reason="vol_too_high",
    )

    trade = tmp_journal_db.get_trade("r_source")
    assert trade is not None
    count = _build_rejection_vs_contemporaneous_edges(tmp_journal_db, trade)

    assert count == 1
    rows = _edges(tmp_journal_db)
    assert len(rows) == 1
    assert rows[0]["edge_type"] == "rejection_vs_contemporaneous_trade"
    assert rows[0]["source_trade_id"] == "r_source"
    assert rows[0]["target_trade_id"] == "t_taken"


def test_build_rejection_vs_contemporaneous_respects_2h_window(
    tmp_journal_db: Any,
) -> None:
    """Taken trades more than 2 hours from the rejection are excluded."""
    now = datetime(2026, 4, 12, 10, 0, 0, tzinfo=timezone.utc)

    tmp_journal_db.upsert_trade(
        trade_id="t_in_window", symbol="BTC", side="long", trade_type="macro",
        status="closed", entry_ts=(now - timedelta(minutes=30)).isoformat(),
    )
    tmp_journal_db.upsert_trade(
        trade_id="t_out_of_window", symbol="BTC", side="long", trade_type="macro",
        status="closed", entry_ts=(now - timedelta(hours=3)).isoformat(),
    )
    tmp_journal_db.upsert_trade(
        trade_id="r_source", symbol="BTC", side="long", trade_type="macro",
        status="rejected", entry_ts=now.isoformat(),
        rejection_reason="vol_too_high",
    )

    trade = tmp_journal_db.get_trade("r_source")
    assert trade is not None
    count = _build_rejection_vs_contemporaneous_edges(tmp_journal_db, trade)

    assert count == 1
    rows = _edges(tmp_journal_db)
    assert len(rows) == 1
    assert rows[0]["target_trade_id"] == "t_in_window"


# ---------------------------------------------------------------------------
# Dedup + aggregate count
# ---------------------------------------------------------------------------


def test_insert_edge_deduplicates(tmp_journal_db: Any) -> None:
    """Second insert with matching (source, target, edge_type) returns False
    and the row count stays at 1 (UNIQUE constraint enforced at DB level)."""
    tmp_journal_db.upsert_trade(
        trade_id="t_a", symbol="BTC", side="long", trade_type="macro",
        status="closed", entry_ts="2026-04-12T10:00:00+00:00",
    )
    tmp_journal_db.upsert_trade(
        trade_id="t_b", symbol="BTC", side="long", trade_type="macro",
        status="closed", entry_ts="2026-04-12T11:00:00+00:00",
    )
    now_iso = "2026-04-12T12:00:00+00:00"

    conn = tmp_journal_db._connect()
    try:
        first = _insert_edge(
            conn, source="t_a", target="t_b", edge_type="followed_by",
            strength=1.0, reason="first", now_iso=now_iso,
        )
        second = _insert_edge(
            conn, source="t_a", target="t_b", edge_type="followed_by",
            strength=1.0, reason="second", now_iso=now_iso,
        )
    finally:
        conn.close()

    assert first is True
    assert second is False
    rows = _edges(tmp_journal_db)
    assert len(rows) == 1
    assert rows[0]["reason"] == "first"


def test_build_edges_returns_correct_count(
    tmp_journal_db: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """build_edges returns the sum of all four builders' insert counts.

    Setup: a rejected source trade with
      - one prior closed trade on same symbol  → 0 temporal edges
        (temporal builder skips rejections by status filter — prev row must be
        closed/analyzed; but the source itself has no ``closed``/``analyzed``
        status so the SELECT still succeeds. Count = 2 from the symmetric pair.)
      - one taken peer with matching vol_1h_regime → 0 regime edges
        (regime builder skips rejections: source has no entry snapshot)
      - one peer rejection with matching rejection_reason → 1 edge
      - one contemporaneous taken trade within 2h → 1 edge

    Since a rejected source has no entry snapshot, regime edges contribute 0.
    Total expected = 2 (temporal) + 0 (regime) + 1 (reason) + 1 (contemporaneous) = 4.
    """
    now = datetime(2026, 4, 12, 12, 0, 0, tzinfo=timezone.utc)

    # Prior closed trade — outside the 2h contemporaneous window, so only
    # the temporal builder picks it up (it's still the most-recent prior
    # because t_contemp below is more recent but we want both builders to
    # fire on distinct targets).
    tmp_journal_db.upsert_trade(
        trade_id="t_prior", symbol="BTC", side="long", trade_type="macro",
        status="closed", entry_ts=(now - timedelta(hours=5)).isoformat(),
    )
    # Contemporaneous taken trade within 2h → drives rejection_vs_contemporaneous.
    # Also becomes the temporal "prev" since it's the most recent prior closed
    # trade. That's fine: the temporal pair is (prev=t_contemp, current=r_source)
    # and the contemporaneous edge is (source=r_source, target=t_contemp). Two
    # different edge_types → both coexist under the UNIQUE constraint.
    tmp_journal_db.upsert_trade(
        trade_id="t_contemp", symbol="BTC", side="long", trade_type="macro",
        status="closed", entry_ts=(now - timedelta(minutes=30)).isoformat(),
    )
    # Peer rejection with matching rejection_reason → drives rejection_reason edge
    tmp_journal_db.upsert_trade(
        trade_id="r_peer", symbol="BTC", side="short", trade_type="macro",
        status="rejected", entry_ts=(now - timedelta(hours=6)).isoformat(),
        rejection_reason="vol_too_high",
    )
    # Source rejection
    tmp_journal_db.upsert_trade(
        trade_id="r_source", symbol="BTC", side="long", trade_type="macro",
        status="rejected", entry_ts=now.isoformat(),
        rejection_reason="vol_too_high",
    )

    count = build_edges(tmp_journal_db, "r_source")

    rows = _edges(tmp_journal_db)
    type_counts: dict[str, int] = {}
    for r in rows:
        type_counts[r["edge_type"]] = type_counts.get(r["edge_type"], 0) + 1

    # Temporal: 2 edges (preceded_by + followed_by vs t_contemp, the most recent
    # prior closed same-symbol trade).
    assert type_counts.get("preceded_by") == 1
    assert type_counts.get("followed_by") == 1
    # Regime: 0 (source has no entry snapshot)
    assert "same_regime_bucket" not in type_counts
    # Rejection reason: 1 (r_peer)
    assert type_counts.get("same_rejection_reason") == 1
    # Contemporaneous: 1 (t_contemp)
    assert type_counts.get("rejection_vs_contemporaneous_trade") == 1

    assert count == len(rows)
    assert count == 4
