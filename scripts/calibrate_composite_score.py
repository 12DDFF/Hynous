"""Audit composite entry score thresholds against real v2 journal data.

READ-ONLY audit tool. Does NOT modify config or the journal DB.

Stratifies closed v2 trades by composite entry score (10-point buckets) and
suggests calibrated thresholds in BOTH threshold spaces:

* ``satellite/entry_score.py``    — ``reject_below=25.0`` / ``warn_below=45.0``
* ``config/default.yaml``          — ``v2.mechanical_entry.composite_entry_threshold=50``

The script opens the SQLite journal with ``mode=ro`` (no schema writes
possible) and never calls any mutating method. The engineer runs it,
reviews the histogram + suggestions, and decides whether to hand-edit the
two threshold surfaces.

Usage:
    python scripts/calibrate_composite_score.py [--window-days 30] [--db PATH]

Empty-data path: exits 0 with ``trade_count=0`` in the returned dict.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore[import-untyped]

    _HAS_YAML = True
except ImportError:  # pragma: no cover - yaml is a project dep, fallback covered by regex
    _HAS_YAML = False


# Current threshold values hard-coded here as the ground-truth defaults.
# run_audit reads the live yaml if available; the entry_score defaults are
# static (not yaml-backed).
CURRENT_ENTRY_SCORE_REJECT = 25.0
CURRENT_ENTRY_SCORE_WARN = 45.0
CURRENT_COMPOSITE_ENTRY_THRESHOLD_FALLBACK = 50

DEFAULT_DB_PATH = "storage/v2/journal.db"
DEFAULT_CONFIG_PATH = "config/default.yaml"
DEFAULT_WINDOW_DAYS = 30

_LOW_N_THRESHOLD = 3  # buckets with count < 3 are flagged + excluded from boundary suggestions


def _read_composite_entry_threshold(config_path: str = DEFAULT_CONFIG_PATH) -> int:
    """Best-effort read of ``v2.mechanical_entry.composite_entry_threshold`` from YAML.

    Falls back to a regex scrape if PyYAML isn't importable (keeps the script
    runnable standalone without project deps). Falls back to the static
    default on any parse failure. READ-ONLY.
    """
    path = Path(config_path)
    if not path.is_file():
        return CURRENT_COMPOSITE_ENTRY_THRESHOLD_FALLBACK

    if _HAS_YAML:
        try:
            with path.open() as f:
                data = yaml.safe_load(f) or {}
            v2 = data.get("v2") or {}
            me = v2.get("mechanical_entry") or {}
            val = me.get("composite_entry_threshold")
            if isinstance(val, (int, float)):
                return int(val)
        except Exception:  # noqa: BLE001 - fallback on any yaml parse issue
            pass

    # Regex fallback — match the exact key under mechanical_entry.
    try:
        text = path.read_text()
        m = re.search(r"composite_entry_threshold\s*:\s*(\d+)", text)
        if m:
            return int(m.group(1))
    except OSError:
        pass

    return CURRENT_COMPOSITE_ENTRY_THRESHOLD_FALLBACK


def run_audit(
    db_path: str,
    window_days: int,
    *,
    config_path: str = DEFAULT_CONFIG_PATH,
) -> dict[str, Any]:
    """Compute the calibration audit result as a structured dict.

    Args:
        db_path: absolute or relative path to the v2 journal SQLite file.
        window_days: only consider trades with ``entry_ts`` within the last N days.
        config_path: path to the YAML holding ``composite_entry_threshold``.

    Returns:
        Dict with keys:
            trade_count (int)
            window_days (int)
            buckets (dict[int, dict]) — keyed by bucket floor (0, 10, ..., 90).
              Each value: count, wins, win_rate, avg_roe, median_roe, sum_pnl,
              low_n (bool).
            boundary_buckets (list[int]) — buckets used in boundary logic
              (low-n excluded).
            suggested_reject (int | None) — lowest bucket with win_rate >= 50%,
              None if no bucket qualifies.
            suggested_warn (int | None) — lowest bucket with win_rate >= 60%,
              None if no bucket qualifies.
            top_bucket_win_rate (float | None) — sanity-check win rate of the
              highest-scoring bucket (regardless of low-n flag).
            current (dict) — current threshold values in both spaces.

    The function opens a read-only SQLite connection (``mode=ro`` URI) and
    never mutates the database. Safe to call against the live journal.
    """
    current = {
        "entry_score_reject_below": CURRENT_ENTRY_SCORE_REJECT,
        "entry_score_warn_below": CURRENT_ENTRY_SCORE_WARN,
        "composite_entry_threshold": _read_composite_entry_threshold(config_path),
    }
    result: dict[str, Any] = {
        "trade_count": 0,
        "window_days": window_days,
        "buckets": {},
        "boundary_buckets": [],
        "suggested_reject": None,
        "suggested_warn": None,
        "top_bucket_win_rate": None,
        "current": current,
    }

    db_file = Path(db_path)
    if not db_file.is_file():
        return result

    # Read-only URI connection — no schema writes possible from this process.
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        conn.row_factory = sqlite3.Row
        # NOTE: string comparison between ISO-8601 `YYYY-MM-DDTHH:MM:SS+00:00`
        # (stored in trades.entry_ts) and SQLite's naive `YYYY-MM-DD HH:MM:SS`
        # (output of `datetime('now', '-N days')`) sorts correctly because the
        # date prefix is left-aligned and lexicographically monotonic. The `T`
        # vs space divider at position 10 only matters if the dates tie, and
        # in that case `T` (0x54) > space (0x20) so the ">= cutoff" filter
        # still admits same-day trades — which is the intended behavior.
        rows = conn.execute(
            """
            SELECT
                t.trade_id,
                json_extract(tes.snapshot_json, '$.ml_snapshot.composite_entry_score') AS score,
                t.realized_pnl_usd,
                t.roe_pct
            FROM trades t
            JOIN trade_entry_snapshots tes ON t.trade_id = tes.trade_id
            WHERE t.status IN ('closed', 'analyzed')
              AND t.entry_ts >= datetime('now', ?)
            """,
            (f"-{window_days} days",),
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        return result

    # Bucket by composite score (10-point buckets).
    buckets: dict[int, list[dict[str, float]]] = defaultdict(list)
    for r in rows:
        score = r["score"]
        if score is None:
            continue
        bucket = int(float(score) / 10) * 10
        buckets[bucket].append(
            {
                "pnl": float(r["realized_pnl_usd"] or 0.0),
                "roe": float(r["roe_pct"] or 0.0),
            },
        )

    counted = sum(len(v) for v in buckets.values())
    result["trade_count"] = counted
    if counted == 0:
        return result

    bucket_stats: dict[int, dict[str, Any]] = {}
    for bucket, trades in buckets.items():
        count = len(trades)
        wins = sum(1 for t in trades if t["pnl"] > 0)
        win_rate = wins / count * 100
        avg_roe = statistics.mean(t["roe"] for t in trades)
        median_roe = statistics.median(t["roe"] for t in trades)
        sum_pnl = sum(t["pnl"] for t in trades)
        bucket_stats[bucket] = {
            "count": count,
            "wins": wins,
            "win_rate": win_rate,
            "avg_roe": avg_roe,
            "median_roe": median_roe,
            "sum_pnl": sum_pnl,
            "low_n": count < _LOW_N_THRESHOLD,
        }
    result["buckets"] = bucket_stats

    # Boundary logic — exclude low-n buckets.
    boundary_buckets = sorted(
        b for b, s in bucket_stats.items() if not s["low_n"]
    )
    result["boundary_buckets"] = boundary_buckets

    suggested_reject: int | None = None
    suggested_warn: int | None = None
    for bucket in boundary_buckets:
        wr = bucket_stats[bucket]["win_rate"]
        if suggested_reject is None and wr >= 50.0:
            suggested_reject = bucket
        if suggested_warn is None and wr >= 60.0:
            suggested_warn = bucket
    result["suggested_reject"] = suggested_reject
    result["suggested_warn"] = suggested_warn

    # Sanity check — top-scoring bucket (any count) win rate.
    top_bucket = max(bucket_stats.keys())
    result["top_bucket_win_rate"] = bucket_stats[top_bucket]["win_rate"]

    return result


def _print_report(result: dict[str, Any]) -> None:
    """Pretty-print the audit dict for CLI consumption."""
    trade_count = result["trade_count"]
    window_days = result["window_days"]
    current = result["current"]

    if trade_count == 0:
        print(f"No trades in window ({window_days} days) — nothing to calibrate.")
        print()
        print(
            f"Current thresholds: "
            f"entry_score.reject_below={current['entry_score_reject_below']}, "
            f"entry_score.warn_below={current['entry_score_warn_below']}, "
            f"composite_entry_threshold={current['composite_entry_threshold']}",
        )
        return

    print(
        f"Composite score calibration — {trade_count} trades over {window_days} days",
    )
    print()
    header = f"{'Bucket':<12} {'Count':<8} {'Win%':<10} {'Avg ROE%':<12} {'Med ROE%':<12} {'Sum PnL':<14} Flag"
    print(header)
    print("-" * len(header))

    for bucket in sorted(result["buckets"].keys()):
        s = result["buckets"][bucket]
        flag = "(low-n)" if s["low_n"] else ""
        label = f"{bucket}-{bucket + 9}"
        print(
            f"{label:<12} {s['count']:<8} {s['win_rate']:<10.1f} "
            f"{s['avg_roe']:<12.2f} {s['median_roe']:<12.2f} "
            f"${s['sum_pnl']:<13.2f} {flag}",
        )

    print()
    print("--- Suggestions (low-n buckets excluded) ---")
    sr = result["suggested_reject"]
    sw = result["suggested_warn"]
    top_wr = result["top_bucket_win_rate"]
    print(
        f"Current entry_score.py    reject_below={current['entry_score_reject_below']}  "
        f"warn_below={current['entry_score_warn_below']}",
    )
    print(
        f"Current default.yaml      composite_entry_threshold="
        f"{current['composite_entry_threshold']}",
    )
    print()
    if sr is not None:
        print(f"Suggested reject bucket floor: {sr} (lowest bucket with win_rate >= 50%)")
        # v2 mechanical gate is a single threshold; align it with the reject bucket
        # floor (same semantics — anything below this is rejected).
        print(f"  -> entry_score.reject_below      ~= {sr}")
        print(f"  -> composite_entry_threshold     ~= {sr}")
    else:
        print("Suggested reject bucket floor: <none met 50% WR in boundary set>")
    if sw is not None:
        print(f"Suggested warn bucket floor:   {sw} (lowest bucket with win_rate >= 60%)")
        print(f"  -> entry_score.warn_below        ~= {sw}")
    else:
        print("Suggested warn bucket floor:   <none met 60% WR in boundary set>")
    if top_wr is not None:
        print(f"Top-score bucket sanity check: WR={top_wr:.1f}%")
    print()
    print(
        "Review + hand-edit both threshold surfaces: "
        "satellite/entry_score.py (reject_below, warn_below) and "
        "config/default.yaml (v2.mechanical_entry.composite_entry_threshold).",
    )


def main(argv: list[str] | None = None, *, db_path: str | None = None) -> int:
    """CLI entry point. Returns 0 on success (including empty-data case).

    Args:
        argv: optional argv for testing; defaults to ``sys.argv[1:]``.
        db_path: explicit DB path override — bypasses ``--db`` CLI arg.
            Used by the integration test to point at a tmp DB without
            argparse gymnastics.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--window-days", type=int, default=DEFAULT_WINDOW_DAYS)
    parser.add_argument("--db", default=DEFAULT_DB_PATH)
    parser.add_argument("--config", default=DEFAULT_CONFIG_PATH)
    args = parser.parse_args(argv)

    resolved_db = db_path if db_path is not None else args.db
    result = run_audit(resolved_db, args.window_days, config_path=args.config)
    _print_report(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
