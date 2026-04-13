"""Integration tests for ``scripts/retrain_direction_model.py``.

Seeds a temp :class:`JournalStore` via the public API, drives
``retrain()`` against the DB file, and asserts on the emitted artifacts
and ``training_report.json``.

No ``storage/`` writes — everything lives under ``tmp_path``. Training
invocations are gated by ``xgboost`` + ``numpy`` availability so the
non-training tests (below-min-trades, dry-run, feature-fallback) still
run in minimal CI envs.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from collections.abc import Iterator
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

from hynous.journal.schema import TradeEntrySnapshot, TradeExitSnapshot
from hynous.journal.store import JournalStore

try:
    import numpy  # noqa: F401
    import xgboost  # noqa: F401

    _has_xgboost = True
except ImportError:
    _has_xgboost = False


# ---------------------------------------------------------------------------
# Dynamic import of the script as a module
# ---------------------------------------------------------------------------

SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "scripts"
    / "retrain_direction_model.py"
)


@pytest.fixture(scope="module")
def retrain_module() -> Any:
    spec = importlib.util.spec_from_file_location(
        "_retrain_direction_model", SCRIPT_PATH,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Seeding helpers
# ---------------------------------------------------------------------------


def _make_args(
    *,
    db: Path,
    output: Path,
    window_days: int = 90,
    train_split: float = 0.8,
    min_trades: int = 50,
    dry_run: bool = False,
) -> argparse.Namespace:
    """Build an ``argparse.Namespace`` shaped like the CLI's output."""
    return argparse.Namespace(
        db=str(db),
        output=str(output),
        window_days=window_days,
        train_split=train_split,
        min_trades=min_trades,
        dry_run=dry_run,
    )


def _seed_trade(
    store: JournalStore,
    *,
    template_entry: TradeEntrySnapshot,
    template_exit: TradeExitSnapshot,
    trade_id: str,
    side: str,
    entry_ts: str,
    exit_ts: str,
    roe: float,
    pnl: float = 0.0,
) -> None:
    """Insert a single seeded trade with specified side + outcome ROE."""
    entry_basics = replace(
        template_entry.trade_basics,
        trade_id=trade_id,
        side=side,
        entry_ts=entry_ts,
    )
    entry = replace(template_entry, trade_basics=entry_basics)
    store.insert_entry_snapshot(entry)

    outcome = replace(
        template_exit.trade_outcome,
        exit_ts=exit_ts,
        realized_pnl_usd=pnl,
        roe_at_exit=roe,
    )
    exit_snap = replace(template_exit, trade_id=trade_id, trade_outcome=outcome)
    store.insert_exit_snapshot(exit_snap)


def _seed_batch(
    store: JournalStore,
    *,
    template_entry: TradeEntrySnapshot,
    template_exit: TradeExitSnapshot,
    count: int,
    side: str,
    days_ago_span: tuple[int, int] = (1, 40),
    id_prefix: str = "tr",
    roe_pattern: str = "alternating",
) -> None:
    """Seed ``count`` trades of a given side, spread across a day range.

    ``roe_pattern='alternating'`` alternates positive/negative ROE values
    so the resulting label distribution has signal for XGBoost to fit.
    """
    now = datetime.now(timezone.utc)
    start_days, end_days = days_ago_span
    for i in range(count):
        # Spread entries linearly from start_days..end_days ago.
        days_ago = start_days + (end_days - start_days) * i / max(1, count - 1)
        entry_ts = (now - timedelta(days=days_ago)).isoformat()
        exit_ts = (now - timedelta(days=days_ago, seconds=-600)).isoformat()
        if roe_pattern == "alternating":
            roe = 2.5 + (i % 5) if i % 2 == 0 else -1.5 - (i % 4)
        else:
            roe = 1.0
        _seed_trade(
            store,
            template_entry=template_entry,
            template_exit=template_exit,
            trade_id=f"{id_prefix}_{side}_{i:04d}",
            side=side,
            entry_ts=entry_ts,
            exit_ts=exit_ts,
            roe=roe,
            pnl=roe * 10.0,
        )


@pytest.fixture
def big_seeded_db(
    tmp_path: Path,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> Iterator[Path]:
    """Seed 120 trades (60 long + 60 short) spanning 40 days."""
    db_path = tmp_path / "big.db"
    store = JournalStore(str(db_path))
    _seed_batch(
        store,
        template_entry=sample_entry_snapshot,
        template_exit=sample_exit_snapshot,
        count=60,
        side="long",
        days_ago_span=(1, 40),
        id_prefix="L",
    )
    _seed_batch(
        store,
        template_entry=sample_entry_snapshot,
        template_exit=sample_exit_snapshot,
        count=60,
        side="short",
        days_ago_span=(1, 40),
        id_prefix="S",
    )
    store.close()
    yield db_path


# ---------------------------------------------------------------------------
# Tests — training-invoking (require xgboost)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _has_xgboost, reason="xgboost unavailable")
def test_retrain_happy_path_writes_artifacts(
    retrain_module: Any, big_seeded_db: Path, tmp_path: Path,
) -> None:
    """120 closed trades → v1 artifact + training_report.json."""
    from satellite.training.artifact import ModelArtifact

    output_dir = tmp_path / "out"
    args = _make_args(
        db=big_seeded_db, output=output_dir,
        window_days=60, min_trades=50,
    )
    rc = retrain_module.retrain(args)
    assert rc == 0

    # There must be exactly one timestamp directory + one v1 under it.
    ts_dirs = [d for d in output_dir.iterdir() if d.is_dir()]
    assert len(ts_dirs) == 1, f"expected 1 timestamp dir, got {ts_dirs}"
    ts_dir = ts_dirs[0]

    v1_dir = ts_dir / "v1"
    assert v1_dir.is_dir()
    assert (v1_dir / "model_long_v1.pkl").is_file()
    assert (v1_dir / "model_short_v1.pkl").is_file()
    assert (v1_dir / "scaler_v1.json").is_file()
    assert (v1_dir / "metadata_v1.json").is_file()

    report_path = ts_dir / "training_report.json"
    assert report_path.is_file()
    report = json.loads(report_path.read_text())
    assert report["trade_count"] == 120
    assert report["long_count"] + report["short_count"] == 120
    assert isinstance(report["long_val_mae"], float)
    assert isinstance(report["short_val_mae"], float)
    assert "missing_feature_fractions" in report
    assert report["version"] == 1

    # ModelArtifact.load verifies the feature hash matches current FEATURE_HASH.
    loaded = ModelArtifact.load(v1_dir)
    assert loaded.metadata is not None
    assert loaded.metadata.version == 1


@pytest.mark.skipif(not _has_xgboost, reason="xgboost unavailable")
def test_retrain_bumps_version_number(
    retrain_module: Any, big_seeded_db: Path, tmp_path: Path,
) -> None:
    """Pre-existing v1 directory → next run lands at v2."""
    output_dir = tmp_path / "out"
    (output_dir / "oldts" / "v1").mkdir(parents=True)

    args = _make_args(
        db=big_seeded_db, output=output_dir,
        window_days=60, min_trades=50,
    )
    rc = retrain_module.retrain(args)
    assert rc == 0

    # The newly-created timestamp dir is whichever one isn't 'oldts'.
    ts_dirs = sorted(d.name for d in output_dir.iterdir() if d.is_dir())
    new_ts = next(name for name in ts_dirs if name != "oldts")
    v2_dir = output_dir / new_ts / "v2"
    assert v2_dir.is_dir()
    assert (v2_dir / "model_long_v2.pkl").is_file()
    assert (v2_dir / "metadata_v2.json").is_file()


# ---------------------------------------------------------------------------
# Tests — non-training (run without xgboost)
# ---------------------------------------------------------------------------


def test_retrain_below_min_trades_exits_cleanly(
    retrain_module: Any,
    tmp_path: Path,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """Below min_trades → exit 2, no artifact directory created."""
    db_path = tmp_path / "sparse.db"
    store = JournalStore(str(db_path))
    _seed_batch(
        store,
        template_entry=sample_entry_snapshot,
        template_exit=sample_exit_snapshot,
        count=10,
        side="long",
    )
    _seed_batch(
        store,
        template_entry=sample_entry_snapshot,
        template_exit=sample_exit_snapshot,
        count=10,
        side="short",
    )
    store.close()

    output_dir = tmp_path / "out"
    args = _make_args(
        db=db_path, output=output_dir,
        window_days=90, min_trades=50,
    )
    rc = retrain_module.retrain(args)
    assert rc == 2
    assert not output_dir.exists()


def test_retrain_window_days_filter(
    retrain_module: Any,
    tmp_path: Path,
    sample_entry_snapshot: TradeEntrySnapshot,
    sample_exit_snapshot: TradeExitSnapshot,
) -> None:
    """Only trades with exit_ts within window_days contribute to the count."""
    db_path = tmp_path / "windowed.db"
    store = JournalStore(str(db_path))

    # 60 recent trades (within last 30 days).
    _seed_batch(
        store,
        template_entry=sample_entry_snapshot,
        template_exit=sample_exit_snapshot,
        count=30,
        side="long",
        days_ago_span=(1, 28),
        id_prefix="recent",
    )
    _seed_batch(
        store,
        template_entry=sample_entry_snapshot,
        template_exit=sample_exit_snapshot,
        count=30,
        side="short",
        days_ago_span=(1, 28),
        id_prefix="recent",
    )
    # 40 old trades (>90 days ago, should be excluded).
    _seed_batch(
        store,
        template_entry=sample_entry_snapshot,
        template_exit=sample_exit_snapshot,
        count=20,
        side="long",
        days_ago_span=(100, 180),
        id_prefix="old",
    )
    _seed_batch(
        store,
        template_entry=sample_entry_snapshot,
        template_exit=sample_exit_snapshot,
        count=20,
        side="short",
        days_ago_span=(100, 180),
        id_prefix="old",
    )
    store.close()

    # Dry-run so we don't require xgboost; load_closed_trades still runs
    # through the same SQL so the filter is exercised end-to-end.
    output_dir = tmp_path / "out"
    args = _make_args(
        db=db_path, output=output_dir,
        window_days=30, min_trades=40, dry_run=True,
    )
    # Verify load_closed_trades returns exactly 60 recent trades.
    trades = retrain_module.load_closed_trades(str(db_path), window_days=30)
    assert len(trades) == 60

    rc = retrain_module.retrain(args)
    # Dry-run with sufficient trades → exit 0, no artifacts written.
    assert rc == 0
    assert not output_dir.exists()


def test_retrain_dry_run_writes_nothing(
    retrain_module: Any, big_seeded_db: Path, tmp_path: Path,
) -> None:
    """--dry-run → exit 0, no artifact dir, no training_report.json."""
    output_dir = tmp_path / "out"
    args = _make_args(
        db=big_seeded_db, output=output_dir,
        window_days=60, min_trades=50, dry_run=True,
    )
    rc = retrain_module.retrain(args)
    assert rc == 0
    assert not output_dir.exists()


def test_reconstruct_features_missing_sections_uses_neutral(
    retrain_module: Any, sample_entry_snapshot: TradeEntrySnapshot,
) -> None:
    """Blanking ``derivatives_state.funding_rate`` → NEUTRAL + avail=0."""
    from dataclasses import replace as dc_replace

    from satellite.features import NEUTRAL_VALUES

    blanked_derivs = dc_replace(
        sample_entry_snapshot.derivatives_state, funding_rate=None,
    )
    entry = dc_replace(sample_entry_snapshot, derivatives_state=blanked_derivs)

    raw, avail, missing = retrain_module.reconstruct_features(entry)
    assert raw["funding_rate_raw"] == NEUTRAL_VALUES["funding_rate_raw"]
    # funding_rate_raw has NO matching avail column in AVAIL_COLUMNS, so
    # the assertion is on the feature's membership in ``missing`` and
    # (for completeness) a feature that DOES map to an avail column.
    assert "funding_rate_raw" in missing

    # Blank funding_vs_30d_zscore — that feature is purely NEUTRAL here
    # (no real source in the snapshot), and its avail column MUST be 0.
    assert avail["funding_zscore_avail"] == 0
