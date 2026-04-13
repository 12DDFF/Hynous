"""Retrain the long/short XGBoost direction regressors from v2 journal trades.

Standalone, manually-run bridge that:
  1. Pulls closed v2 journal trades via read-only SQLite
  2. Reconstructs satellite features from the stored entry snapshots
     (a strict subset — ~14 of 28 features come from real snapshot fields,
     the remaining ~14 fall back to ``satellite.features.NEUTRAL_VALUES``)
  3. Time-splits into train/val (index-based, NOT random)
  4. Calls ``satellite.training.train.train_both_models``
  5. Writes timestamped artifacts under
     ``satellite/artifacts/direction/journal/{ISO_timestamp}/v{N}/``

Feature hash inherited from ``satellite.features``; reconstruction fills gaps
with ``NEUTRAL_VALUES`` — verify real-data coverage via
``training_report.json`` before promoting an artifact to production.

The journal DB is opened with ``file:{path}?mode=ro`` — no writes possible
from this process. Trade data is loaded via raw sqlite3 + the
``entry_snapshot_from_dict`` / ``exit_snapshot_from_dict`` helpers; the
writable ``JournalStore`` is never imported.

Usage:
    python scripts/retrain_direction_model.py \\
        [--db storage/v2/journal.db] \\
        [--output satellite/artifacts/direction/journal] \\
        [--window-days 90] \\
        [--train-split 0.8] \\
        [--min-trades 50] \\
        [--dry-run]

Exit codes:
    0  — success (or dry-run completed)
    1  — unexpected error
    2  — insufficient trade volume (total or per-side)
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sqlite3
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Allow running as a standalone script: prepend src to sys.path so hynous
# imports resolve without requiring PYTHONPATH=src.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_SRC_DIR = _REPO_ROOT / "src"
if _SRC_DIR.is_dir() and str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from hynous.journal.schema import (  # noqa: E402
    TradeEntrySnapshot,
    entry_snapshot_from_dict,
    exit_snapshot_from_dict,
)

log = logging.getLogger("retrain_direction_model")


# ─── Defaults ───────────────────────────────────────────────────────────────

DEFAULT_DB_PATH = "storage/v2/journal.db"
DEFAULT_OUTPUT_DIR = "satellite/artifacts/direction/journal"
DEFAULT_WINDOW_DAYS = 90
DEFAULT_TRAIN_SPLIT = 0.8
DEFAULT_MIN_TRADES = 50

# Per-side min minimum: half the overall floor. Enforced AFTER the total
# check. E.g. min_trades=50 → each side needs ≥25.
_PER_SIDE_MIN_DIVISOR = 2

# ROE label clip range — matches satellite.training.pipeline.prepare_training_data
# so the bridge produces labels in the same distribution the rest of the
# training pipeline expects.
_ROE_CLIP_LO = -20.0
_ROE_CLIP_HI = 20.0


# ─── Feature reconstruction mapping ─────────────────────────────────────────

# Maps FEATURE_NAMES entry → AVAIL_COLUMNS entry for features whose
# availability flag exists. Features not listed here have NO matching
# avail column; the script leaves them at the pass-through default (1).
#
# Verified against satellite/features.py lines 37-135 on 2026-04-13. Re-check
# if AVAIL_COLUMNS gains or loses entries.
_FEATURE_TO_AVAIL: dict[str, str] = {
    "oi_vs_7d_avg_ratio": "oi_7d_avail",
    "liq_cascade_active": "liq_cascade_avail",
    "liq_imbalance_1h": "liq_imbalance_avail",
    "funding_vs_30d_zscore": "funding_zscore_avail",
    "oi_funding_pressure": "oi_funding_pressure_avail",
    "volume_vs_1h_avg_ratio": "volume_avail",
    "volume_acceleration": "volume_acceleration_avail",
    "realized_vol_1h": "realized_vol_avail",
    "realized_vol_4h": "realized_vol_4h_avail",
    "vol_of_vol": "vol_of_vol_avail",
    "cvd_ratio_30m": "cvd_30m_avail",
    "cvd_ratio_1h": "cvd_1h_avail",
    "price_trend_1h": "price_trend_1h_avail",
    "price_trend_4h": "price_trend_4h_avail",
    "close_position_5m": "close_position_avail",
    "oi_price_direction": "oi_price_dir_avail",
}


# ─── SQL ────────────────────────────────────────────────────────────────────

_SELECT_CLOSED_TRADES = """
    SELECT
        t.trade_id,
        t.side,
        t.entry_ts,
        t.exit_ts,
        tes.snapshot_json AS entry_snapshot_json,
        txs.snapshot_json AS exit_snapshot_json
    FROM trades t
    JOIN trade_entry_snapshots tes ON t.trade_id = tes.trade_id
    JOIN trade_exit_snapshots  txs ON t.trade_id = txs.trade_id
    WHERE t.status IN ('closed', 'analyzed')
      AND t.exit_ts IS NOT NULL
      AND t.exit_ts >= ?
    ORDER BY t.entry_ts ASC
"""


# ─── Data loading ───────────────────────────────────────────────────────────


def load_closed_trades(
    db_path: str, window_days: int,
) -> list[dict[str, Any]]:
    """Load closed trades within ``window_days`` of ``exit_ts``.

    Opens the DB read-only (URI with ``?mode=ro``). Returns an empty list
    if the DB file does not exist.

    Args:
        db_path: path to the v2 journal SQLite file.
        window_days: lookback window measured on ``trades.exit_ts``.

    Returns:
        List of dicts shaped ``{trade_id, side, entry_ts, exit_ts,
        entry_snapshot: TradeEntrySnapshot, exit_snapshot: TradeExitSnapshot}``.
        Trades whose snapshot JSON fails schema reconstruction are logged
        and skipped (NOT raised) — callers treat missing rows as absent.
    """
    path = Path(db_path)
    if not path.is_file():
        log.warning("Journal DB not found at %s", db_path)
        return []

    # Read-only URI — guarantees no writes escape this process even if a
    # caller accidentally passes mutating SQL.
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        cutoff = f"-{window_days} days"
        rows = conn.execute(_SELECT_CLOSED_TRADES, (_sql_cutoff(cutoff),)).fetchall()
    finally:
        conn.close()

    trades: list[dict[str, Any]] = []
    for row in rows:
        try:
            entry = entry_snapshot_from_dict(json.loads(row["entry_snapshot_json"]))
            exit_ = exit_snapshot_from_dict(json.loads(row["exit_snapshot_json"]))
        except (KeyError, TypeError, json.JSONDecodeError) as e:
            log.warning(
                "Skipping trade %s: snapshot reconstruction failed (%s)",
                row["trade_id"], e,
            )
            continue

        trades.append(
            {
                "trade_id": row["trade_id"],
                "side": row["side"],
                "entry_ts": row["entry_ts"],
                "exit_ts": row["exit_ts"],
                "entry_snapshot": entry,
                "exit_snapshot": exit_,
            },
        )

    log.info(
        "Loaded %d closed trades from %s (window_days=%d)",
        len(trades), db_path, window_days,
    )
    return trades


def _sql_cutoff(modifier: str) -> str:
    """Return an ISO-8601 cutoff string N days in the past.

    SQLite's ``datetime('now', '-N days')`` returns a naive
    ``YYYY-MM-DD HH:MM:SS`` string; the journal stores
    ``YYYY-MM-DDTHH:MM:SS+00:00``. String comparison still works because
    the date prefix is left-aligned; we compute the cutoff in Python to
    sidestep any timezone-shift surprises.
    """
    # modifier is e.g. '-90 days'
    try:
        n = int(modifier.strip().split()[0])
    except (ValueError, IndexError):
        n = 0
    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=abs(n))
    return cutoff.isoformat()


# ─── Feature reconstruction ─────────────────────────────────────────────────


def reconstruct_features(
    entry: TradeEntrySnapshot,
) -> tuple[dict[str, float], dict[str, int], list[str]]:
    """Reconstruct the satellite feature vector from a single entry snapshot.

    Reconstructible features (~14 of 28) are derived from the
    ``market_state``, ``derivatives_state``, ``order_flow_state``,
    ``liquidation_terrain``, and ``time_context`` sections. The remaining
    features fall back to ``NEUTRAL_VALUES`` — they are listed in the
    returned ``missing`` array and flagged via ``AVAIL_COLUMNS`` where a
    matching avail column exists (pass-through default 1 otherwise).

    Args:
        entry: hydrated :class:`TradeEntrySnapshot`.

    Returns:
        Tuple of:
            raw_features: ``{feature_name: float}`` — every entry in
                ``FEATURE_NAMES``. Values from real data where possible,
                NEUTRAL_VALUES otherwise.
            availability: ``{avail_col: 0|1}`` — every entry in
                ``AVAIL_COLUMNS``. 1 if the feature that maps to that
                avail col was reconstructed from real data; 0 if filled
                from NEUTRAL_VALUES; 1 (pass-through) for avail cols
                whose feature mapping we could not establish.
            missing: list of FEATURE_NAMES that fell back to NEUTRAL.
    """
    # Imported here (not at module-top) so unit tests for reconstruct_features
    # can run even in environments where the satellite training deps
    # (numpy/xgboost) are missing — ``satellite.features`` itself only
    # depends on the stdlib + the satellite package root.
    from satellite.features import AVAIL_COLUMNS, FEATURE_NAMES, NEUTRAL_VALUES

    market = entry.market_state
    derivs = entry.derivatives_state
    flow = entry.order_flow_state
    liq = entry.liquidation_terrain
    tctx = entry.time_context

    raw: dict[str, float] = {}
    real: dict[str, bool] = {}  # True iff reconstructed from real data

    # --- Funding ---
    raw["funding_rate_raw"], real["funding_rate_raw"] = _coerce(derivs.funding_rate)

    # --- OI dynamics ---
    raw["oi_change_rate_1h"], real["oi_change_rate_1h"] = _coerce(derivs.oi_change_1h_pct)

    # --- Volatility ---
    raw["realized_vol_1h"], real["realized_vol_1h"] = _coerce(market.realized_vol_1h_pct)
    raw["realized_vol_4h"], real["realized_vol_4h"] = _coerce(market.realized_vol_4h_pct)

    # --- Volume vs 1h avg ratio ---
    # derivable: current 1h volume / (4h volume / 4) = current_1h / avg_1h_of_4h_window.
    v1h = market.volume_1h_usd
    v4h = market.volume_4h_usd
    if v1h is not None and v4h is not None and v4h > 0:
        raw["volume_vs_1h_avg_ratio"] = float(v1h) / (float(v4h) / 4.0)
        real["volume_vs_1h_avg_ratio"] = True
    else:
        raw["volume_vs_1h_avg_ratio"] = NEUTRAL_VALUES["volume_vs_1h_avg_ratio"]
        real["volume_vs_1h_avg_ratio"] = False

    # --- CVD ---
    # Directive allows raw cvd fallback (we don't have a notional baseline
    # in the snapshot). Downstream scaler is TYPE P (pass-through) — values
    # propagate unclipped. Real data still beats NEUTRAL (=0.0) here.
    raw["cvd_ratio_30m"], real["cvd_ratio_30m"] = _coerce(flow.cvd_30m)
    raw["cvd_ratio_1h"], real["cvd_ratio_1h"] = _coerce(flow.cvd_1h)
    raw["cvd_acceleration"], real["cvd_acceleration"] = _coerce(flow.cvd_acceleration)

    # --- Price trend ---
    raw["price_trend_1h"], real["price_trend_1h"] = _coerce(market.pct_change_1h)
    raw["price_trend_4h"], real["price_trend_4h"] = _coerce(market.pct_change_4h)

    # --- Hour encoding ---
    h = tctx.hour_utc
    if h is not None and 0 <= int(h) <= 23:
        theta = 2.0 * math.pi * float(h) / 24.0
        raw["hour_sin"] = math.sin(theta)
        raw["hour_cos"] = math.cos(theta)
        real["hour_sin"] = True
        real["hour_cos"] = True
    else:
        raw["hour_sin"] = NEUTRAL_VALUES["hour_sin"]
        raw["hour_cos"] = NEUTRAL_VALUES["hour_cos"]
        real["hour_sin"] = False
        real["hour_cos"] = False

    # --- Liquidations ---
    long_1h = liq.total_1h_long_liq_usd
    short_1h = liq.total_1h_short_liq_usd
    if long_1h is not None and short_1h is not None:
        total = float(long_1h) + float(short_1h)
        raw["liq_total_1h_usd"] = math.log10(total + 1.0)
        real["liq_total_1h_usd"] = True
        denom = float(long_1h) + float(short_1h)
        if denom > 0:
            # Signed imbalance in [-1, +1]: (+) = more longs liquidated.
            raw["liq_imbalance_1h"] = (float(long_1h) - float(short_1h)) / denom
            real["liq_imbalance_1h"] = True
        else:
            raw["liq_imbalance_1h"] = NEUTRAL_VALUES["liq_imbalance_1h"]
            real["liq_imbalance_1h"] = False
    else:
        raw["liq_total_1h_usd"] = NEUTRAL_VALUES["liq_total_1h_usd"]
        real["liq_total_1h_usd"] = False
        raw["liq_imbalance_1h"] = NEUTRAL_VALUES["liq_imbalance_1h"]
        real["liq_imbalance_1h"] = False

    # liq_cascade_active — bool → {0,1}
    if isinstance(liq.cascade_active, bool):
        raw["liq_cascade_active"] = 1.0 if liq.cascade_active else 0.0
        real["liq_cascade_active"] = True
    else:
        raw["liq_cascade_active"] = NEUTRAL_VALUES["liq_cascade_active"]
        real["liq_cascade_active"] = False

    # --- All other features fall back to NEUTRAL ---
    for name in FEATURE_NAMES:
        if name not in raw:
            raw[name] = NEUTRAL_VALUES[name]
            real[name] = False

    # --- Availability flags ---
    # Default every avail column to 1 (pass-through). Then for any
    # feature in _FEATURE_TO_AVAIL where we have a flag, override with
    # the real-vs-neutral signal.
    availability: dict[str, int] = {col: 1 for col in AVAIL_COLUMNS}
    for feat_name, avail_col in _FEATURE_TO_AVAIL.items():
        if avail_col in availability:
            availability[avail_col] = 1 if real.get(feat_name, False) else 0

    missing = [name for name in FEATURE_NAMES if not real.get(name, False)]
    return raw, availability, missing


def _coerce(val: Any) -> tuple[float, bool]:
    """Coerce to float, returning (value, was_real_data).

    Returns ``(0.0, False)`` if ``val`` is None, NaN, or inf. Otherwise
    returns ``(float(val), True)``.
    """
    if val is None:
        return 0.0, False
    try:
        f = float(val)
    except (TypeError, ValueError):
        return 0.0, False
    if math.isnan(f) or math.isinf(f):
        return 0.0, False
    return f, True


# ─── Training data construction ─────────────────────────────────────────────


@dataclass
class _SidePrep:
    """Internal per-side prep result passed to ``build_training_data``."""

    train_features: dict[str, Any]
    val_features: dict[str, Any]
    train_rows: list[dict[str, Any]]
    val_rows: list[dict[str, Any]]
    n_total: int


def build_training_data(
    trades: list[dict[str, Any]],
    side: str,
    train_split: float,
) -> Any:
    """Build a ``TrainingData`` object for one side.

    Filters ``trades`` to those matching ``side`` (each closed trade
    contributes to exactly ONE side's training set, never both). Time-orders
    by ``entry_ts`` and index-splits at ``floor(n * train_split)`` into
    train/val partitions. Fits a :class:`satellite.normalize.FeatureScaler`
    on the train partition only, transforms both partitions with the same
    scaler, appends ``AVAIL_COLUMNS`` flags, clips labels to
    ``[_ROE_CLIP_LO, _ROE_CLIP_HI]``.

    Args:
        trades: output of :func:`load_closed_trades`.
        side: ``"long"`` or ``"short"``.
        train_split: fraction for train partition, exclusive split
            (indexes ``[0:k)`` train, ``[k:n)`` val).

    Returns:
        :class:`satellite.training.pipeline.TrainingData`.

    Raises:
        ValueError: when the side has insufficient samples for a split.
    """
    import numpy as np

    from satellite.features import AVAIL_COLUMNS, FEATURE_NAMES
    from satellite.normalize import FeatureScaler
    from satellite.training.pipeline import TrainingData

    side_trades = [t for t in trades if t["side"] == side]
    side_trades.sort(key=lambda t: t["entry_ts"])
    n = len(side_trades)
    if n < 2:
        raise ValueError(
            f"side={side} has {n} trades — need ≥2 for a train/val split",
        )

    k = max(1, min(n - 1, int(n * train_split)))
    train_trades = side_trades[:k]
    val_trades = side_trades[k:]

    def _rows(batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out = []
        for t in batch:
            raw, avail, _missing = reconstruct_features(t["entry_snapshot"])
            entry_ts = t["entry_ts"]
            # created_at used for TrainingData.train_timestamps / val_timestamps.
            try:
                epoch = datetime.fromisoformat(entry_ts).timestamp()
            except (ValueError, TypeError):
                epoch = 0.0
            row: dict[str, Any] = {
                "created_at": epoch,
                "label": float(t["exit_snapshot"].trade_outcome.roe_at_exit),
                "raw": raw,
                "avail": avail,
            }
            out.append(row)
        return out

    train_rows = _rows(train_trades)
    val_rows = _rows(val_trades)

    # Feature dicts for scaler fit/transform.
    def _stack(rows: list[dict[str, Any]]) -> dict[str, np.ndarray]:
        stacked: dict[str, np.ndarray] = {}
        for name in FEATURE_NAMES:
            stacked[name] = np.array(
                [float(r["raw"][name]) for r in rows], dtype=np.float64,
            )
        return stacked

    train_stacked = _stack(train_rows)
    val_stacked = _stack(val_rows)

    scaler = FeatureScaler()
    scaler.fit(train_stacked)
    # X_train / X_val are standard ML/numpy convention and match the
    # uppercase naming in satellite/training/pipeline.py.
    X_train = scaler.transform_batch(train_stacked)  # noqa: N806
    X_val = scaler.transform_batch(val_stacked)  # noqa: N806

    # Append AVAIL_COLUMNS (binary, no normalization) — match pipeline.py.
    for col in AVAIL_COLUMNS:
        col_train = np.array(
            [r["avail"].get(col, 1) for r in train_rows], dtype=np.float64,
        ).reshape(-1, 1)
        col_val = np.array(
            [r["avail"].get(col, 1) for r in val_rows], dtype=np.float64,
        ).reshape(-1, 1)
        X_train = np.hstack([X_train, col_train])  # noqa: N806
        X_val = np.hstack([X_val, col_val])  # noqa: N806

    feature_names = list(FEATURE_NAMES) + list(AVAIL_COLUMNS)

    y_train = np.clip(
        np.array([r["label"] for r in train_rows], dtype=np.float64),
        _ROE_CLIP_LO, _ROE_CLIP_HI,
    )
    y_val = np.clip(
        np.array([r["label"] for r in val_rows], dtype=np.float64),
        _ROE_CLIP_LO, _ROE_CLIP_HI,
    )

    train_ts = np.array([r["created_at"] for r in train_rows], dtype=np.float64)
    val_ts = np.array([r["created_at"] for r in val_rows], dtype=np.float64)

    return TrainingData(
        X_train=X_train,
        y_train=y_train,
        X_val=X_val,
        y_val=y_val,
        scaler=scaler,
        train_timestamps=train_ts,
        val_timestamps=val_ts,
        feature_names=feature_names,
    )


# ─── Missing-feature reporting ──────────────────────────────────────────────


def compute_missing_fractions(
    trades: list[dict[str, Any]],
) -> dict[str, float]:
    """Fraction of trades where each feature fell back to NEUTRAL.

    A feature with fraction 0.0 was always reconstructed from real data;
    a feature with fraction 1.0 was never available. Used to populate
    ``training_report.json``.
    """
    if not trades:
        return {}
    from satellite.features import FEATURE_NAMES

    missing_count: dict[str, int] = defaultdict(int)
    for t in trades:
        _raw, _avail, missing = reconstruct_features(t["entry_snapshot"])
        for name in missing:
            missing_count[name] += 1
    n = len(trades)
    return {name: missing_count.get(name, 0) / n for name in FEATURE_NAMES}


# ─── Versioning ─────────────────────────────────────────────────────────────


def _next_version(output_root: Path) -> int:
    """Scan ``output_root`` for existing ``v{N}/`` directories and return max+1.

    The search is recursive across timestamp sub-directories so that
    bumping continues across multiple training runs.
    """
    if not output_root.exists():
        return 1
    highest = 0
    for child in output_root.rglob("v*"):
        if not child.is_dir():
            continue
        name = child.name
        if not name.startswith("v"):
            continue
        rest = name[1:]
        if not rest.isdigit():
            continue
        highest = max(highest, int(rest))
    return highest + 1


def _timestamp_dir_name(ts: datetime | None = None) -> str:
    """Return an ISO-8601 UTC timestamp suitable as a directory name.

    Colons are stripped (``:`` is illegal on Windows and creates path
    confusion on Unix): e.g. ``20260413T051200Z``.
    """
    ts = ts or datetime.now(timezone.utc)
    return ts.strftime("%Y%m%dT%H%M%SZ")


# ─── Orchestration ──────────────────────────────────────────────────────────


def retrain(args: argparse.Namespace) -> int:
    """Execute the full retrain pipeline.

    Returns the process exit code. ``args`` is the argparse namespace;
    factored out so tests can call this directly without argv marshalling.
    """
    trades = load_closed_trades(args.db, args.window_days)
    total = len(trades)

    if total < args.min_trades:
        log.warning(
            "Insufficient trades: %d < min_trades=%d — aborting",
            total, args.min_trades,
        )
        return 2

    long_trades = [t for t in trades if t["side"] == "long"]
    short_trades = [t for t in trades if t["side"] == "short"]
    per_side_min = max(1, args.min_trades // _PER_SIDE_MIN_DIVISOR)
    if len(long_trades) < per_side_min or len(short_trades) < per_side_min:
        log.warning(
            "Per-side minimum not met: long=%d short=%d min/side=%d — aborting",
            len(long_trades), len(short_trades), per_side_min,
        )
        return 2

    # Missing-feature diagnostics — log before training so the user sees
    # which features had to fall back even on dry-run.
    missing_fractions = compute_missing_fractions(trades)
    _log_missing_fractions(missing_fractions)

    if args.dry_run:
        log.info(
            "Dry run: %d trades (%d long, %d short) would be used for training. "
            "No artifacts written.",
            total, len(long_trades), len(short_trades),
        )
        return 0

    # Build per-side training data. Each side is independent — raising on
    # one doesn't doom the other's artifacts (we still need both, so we
    # let either error abort the run).
    long_data = build_training_data(trades, "long", args.train_split)
    short_data = build_training_data(trades, "short", args.train_split)

    output_root = Path(args.output)
    version = _next_version(output_root)
    ts_name = _timestamp_dir_name()
    run_dir = output_root / ts_name
    run_dir.mkdir(parents=True, exist_ok=True)

    # Train (imports deferred so dry-run / below-min paths don't require xgboost).
    from satellite.training.train import train_both_models
    artifact = train_both_models(long_data, short_data, version=version)
    saved_dir = artifact.save(run_dir)

    report = {
        "window_days": args.window_days,
        "trade_count": total,
        "long_count": len(long_trades),
        "short_count": len(short_trades),
        "missing_feature_fractions": missing_fractions,
        "version": version,
        "long_val_mae": _extract_long_val_mae(artifact),
        "short_val_mae": _extract_short_val_mae(artifact),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    report_path = run_dir / "training_report.json"
    with report_path.open("w") as f:
        json.dump(report, f, indent=2, sort_keys=True)

    log.info(
        "Wrote artifact v%d under %s (report: %s)",
        version, saved_dir, report_path,
    )
    return 0


def _log_missing_fractions(fractions: dict[str, float]) -> None:
    """Emit an INFO-level log listing features that fell back to NEUTRAL."""
    if not fractions:
        return
    nonzero = sorted(
        ((name, frac) for name, frac in fractions.items() if frac > 0),
        key=lambda kv: -kv[1],
    )
    if not nonzero:
        log.info("All features reconstructed from real data (0 NEUTRAL fallbacks).")
        return
    lines = [f"{name}={frac:.2%}" for name, frac in nonzero]
    log.info(
        "Features falling back to NEUTRAL (sorted desc): %s",
        ", ".join(lines),
    )


def _extract_long_val_mae(artifact: Any) -> float | None:
    """Pull long model val MAE out of the artifact metadata notes string.

    ``train_both_models`` packs both MAEs into ``metadata.notes`` as
    ``"Long MAE: X.XXX, Short MAE: Y.YYY"``. We parse rather than thread
    a new field through; that would touch ``satellite/training/``.
    """
    return _parse_mae(artifact, "Long MAE:")


def _extract_short_val_mae(artifact: Any) -> float | None:
    return _parse_mae(artifact, "Short MAE:")


def _parse_mae(artifact: Any, prefix: str) -> float | None:
    try:
        notes = artifact.metadata.notes
    except AttributeError:
        return None
    if not isinstance(notes, str):
        return None
    idx = notes.find(prefix)
    if idx < 0:
        return None
    tail = notes[idx + len(prefix):].strip()
    token = tail.split(",")[0].strip()
    try:
        return float(token)
    except ValueError:
        return None


# ─── CLI ────────────────────────────────────────────────────────────────────


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=DEFAULT_DB_PATH)
    parser.add_argument("--output", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--window-days", type=int, default=DEFAULT_WINDOW_DAYS)
    parser.add_argument("--train-split", type=float, default=DEFAULT_TRAIN_SPLIT)
    parser.add_argument("--min-trades", type=int, default=DEFAULT_MIN_TRADES)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Run all steps except the final artifact + training_report writes.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args(argv)
    try:
        return retrain(args)
    except Exception:
        log.exception("Retrain failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
