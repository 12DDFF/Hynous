"""Integration tests for ``scripts/calibrate_composite_score.py``.

Seeds a temp :class:`JournalStore` via the public API, drives ``run_audit``
against the DB file, and asserts on the returned structured dict. No
network calls, no LLM calls — embeddings are skipped (the script is
read-only and never touches the embedding column).

Covers the acceptance criterion at
``v2-planning/11-phase-8-quantitative.md:482`` ("Integration test verifies
with seeded data") plus the four named cases in the new-M3 directive.
"""

from __future__ import annotations

import importlib.util
import sys
from collections.abc import Iterator
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

from hynous.journal.schema import TradeEntrySnapshot, TradeExitSnapshot
from hynous.journal.store import JournalStore

# ---------------------------------------------------------------------------
# Dynamic import of the script as a module (scripts/ isn't a package, and we
# don't want to import-hook by name).
# ---------------------------------------------------------------------------


SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "scripts"
    / "calibrate_composite_score.py"
)


@pytest.fixture(scope="module")
def calibrate_module() -> Any:
    """Load the audit script as an importable module."""
    spec = importlib.util.spec_from_file_location(
        "_calibrate_composite_score", SCRIPT_PATH,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Seeding helpers
# ---------------------------------------------------------------------------


def _seed_trade(
    store: JournalStore,
    *,
    template_entry: TradeEntrySnapshot,
    template_exit: TradeExitSnapshot,
    trade_id: str,
    score: float,
    pnl: float,
    entry_ts: str,
    exit_ts: str,
    status: str = "closed",
) -> None:
    """Insert a single seeded trade (entry snapshot + exit snapshot + status)."""
    entry_basics = replace(
        template_entry.trade_basics, trade_id=trade_id, entry_ts=entry_ts,
    )
    entry_ml = replace(template_entry.ml_snapshot, composite_entry_score=score)
    entry = replace(template_entry, trade_basics=entry_basics, ml_snapshot=entry_ml)
    store.insert_entry_snapshot(entry)

    outcome = replace(
        template_exit.trade_outcome,
        exit_ts=exit_ts,
        realized_pnl_usd=pnl,
    )
    exit_snap = replace(template_exit, trade_id=trade_id, trade_outcome=outcome)
    store.insert_exit_snapshot(exit_snap)

    if status == "analyzed":
        # insert_exit_snapshot sets status='closed'; upsert to promote to analyzed.
        store.upsert_trade(
            trade_id=trade_id,
            symbol=entry_basics.symbol,
            side=entry_basics.side,
            trade_type=entry_basics.trade_type,
            status="analyzed",
        )


@pytest.fixture
def seeded_db(
    tmp_path: Path,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> Iterator[Path]:
    """Seed 4 buckets × 5 trades with target win rates 20% / 40% / 60% / 80%.

    Buckets: 15 (WR 20%), 35 (WR 40%), 55 (WR 60%), 75 (WR 80%).
    All entry_ts within the last 10 days to stay inside the default window.
    Uses ``closed`` status for all seeded trades.
    """
    db_path = tmp_path / "seeded_journal.db"
    store = JournalStore(str(db_path))

    now = datetime.now(timezone.utc)
    plan = [
        (15, 1),   # score 15 bucket → 1/5 wins → 20%
        (35, 2),   # score 35 bucket → 2/5 wins → 40%
        (55, 3),   # score 55 bucket → 3/5 wins → 60%
        (75, 4),   # score 75 bucket → 4/5 wins → 80%
    ]
    for bucket_idx, (score, wins) in enumerate(plan):
        for n in range(5):
            pnl = 10.0 if n < wins else -5.0
            # Stagger entry_ts to keep them distinct + clearly within window.
            ts_offset_s = (bucket_idx * 5 + n) * 60
            entry_ts = (now - timedelta(days=1, seconds=ts_offset_s)).isoformat()
            exit_ts = (now - timedelta(days=1, seconds=ts_offset_s - 30)).isoformat()
            _seed_trade(
                store,
                template_entry=sample_entry_snapshot,
                template_exit=sample_exit_snapshot,
                trade_id=f"trade_s{score:02d}_n{n}",
                score=float(score),
                pnl=pnl,
                entry_ts=entry_ts,
                exit_ts=exit_ts,
            )

    store.close()
    yield db_path


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_run_audit_returns_expected_buckets(
    calibrate_module: Any, seeded_db: Path,
) -> None:
    """Each seeded bucket shows up with count=5 and the expected win rate."""
    result = calibrate_module.run_audit(str(seeded_db), window_days=30)
    assert result["trade_count"] == 20
    buckets = result["buckets"]
    for bucket_floor, expected_wr in [(10, 20.0), (30, 40.0), (50, 60.0), (70, 80.0)]:
        assert bucket_floor in buckets, f"missing bucket {bucket_floor}"
        stats = buckets[bucket_floor]
        assert stats["count"] == 5
        assert stats["win_rate"] == pytest.approx(expected_wr)
        assert stats["low_n"] is False


def test_run_audit_suggests_reasonable_thresholds(
    calibrate_module: Any, seeded_db: Path,
) -> None:
    """Reject lands at the 50-bucket (first ≥50% WR); warn at the 70-bucket (first ≥60%).

    Per the seed: 10→20% WR, 30→40%, 50→60%, 70→80%. The 50-bucket is the
    first to cross 50% AND the first to cross 60% — so both suggestions
    land at 50.
    """
    result = calibrate_module.run_audit(str(seeded_db), window_days=30)
    # First bucket with WR >= 50 is the 50-floor bucket (60% WR).
    assert result["suggested_reject"] == 50
    # First bucket with WR >= 60 is also the 50-floor bucket (60% WR ties at 60).
    assert result["suggested_warn"] == 50
    # Sanity: top-bucket (70-floor) should be 80% WR.
    assert result["top_bucket_win_rate"] == pytest.approx(80.0)
    # All four buckets participate in the boundary set (all count=5 >= 3).
    assert sorted(result["boundary_buckets"]) == [10, 30, 50, 70]
    # Current thresholds surfaced untouched.
    assert result["current"]["entry_score_reject_below"] == 25.0
    assert result["current"]["entry_score_warn_below"] == 45.0


def test_run_audit_empty_db_returns_zero_trades(
    calibrate_module: Any, tmp_path: Path,
) -> None:
    """Empty journal → trade_count=0, no crash, suggestions None."""
    db_path = tmp_path / "empty_journal.db"
    store = JournalStore(str(db_path))
    store.close()

    result = calibrate_module.run_audit(str(db_path), window_days=30)
    assert result["trade_count"] == 0
    assert result["buckets"] == {}
    assert result["suggested_reject"] is None
    assert result["suggested_warn"] is None
    assert result["top_bucket_win_rate"] is None
    # Current thresholds still populated even on empty path.
    assert result["current"]["entry_score_reject_below"] == 25.0


def test_run_audit_respects_window_days(
    calibrate_module: Any,
    tmp_path: Path,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """Seed one trade 60 days old + one today; window_days=30 only counts recent."""
    db_path = tmp_path / "windowed_journal.db"
    store = JournalStore(str(db_path))

    now = datetime.now(timezone.utc)
    _seed_trade(
        store,
        template_entry=sample_entry_snapshot,
        template_exit=sample_exit_snapshot,
        trade_id="trade_old",
        score=55.0,
        pnl=10.0,
        entry_ts=(now - timedelta(days=60)).isoformat(),
        exit_ts=(now - timedelta(days=60, seconds=-300)).isoformat(),
    )
    _seed_trade(
        store,
        template_entry=sample_entry_snapshot,
        template_exit=sample_exit_snapshot,
        trade_id="trade_new",
        score=55.0,
        pnl=10.0,
        entry_ts=(now - timedelta(days=1)).isoformat(),
        exit_ts=(now - timedelta(days=1, seconds=-300)).isoformat(),
    )
    store.close()

    result = calibrate_module.run_audit(str(db_path), window_days=30)
    assert result["trade_count"] == 1
    assert 50 in result["buckets"]
    assert result["buckets"][50]["count"] == 1
    # count=1 < 3, so the bucket is flagged low-n and excluded from boundaries.
    assert result["buckets"][50]["low_n"] is True
    assert result["boundary_buckets"] == []
    assert result["suggested_reject"] is None
    assert result["suggested_warn"] is None

    # Widening the window picks up both trades.
    result_wide = calibrate_module.run_audit(str(db_path), window_days=90)
    assert result_wide["trade_count"] == 2
    assert result_wide["buckets"][50]["count"] == 2
    assert result_wide["buckets"][50]["low_n"] is True  # still < 3
