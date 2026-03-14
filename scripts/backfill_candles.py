"""Backfill candles_history table from Artemis S3 Node Fills data.

Downloads Node Fills parquet files, builds 1m/5m OHLCV candles from raw trades,
and writes to candles_history in the data-layer DB. Does NOT create snapshots
or labels — only populates the candle table needed by enrich_with_new_features().

Usage:
    python -m scripts.backfill_candles --start 2025-08-17 --end 2026-03-14
    python -m scripts.backfill_candles --start 2025-08-17 --end 2026-03-14 --skip-profiling
"""

import argparse
import logging
import shutil
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from satellite.artemis.pipeline import (
    ArtemisConfig,
    _download_s3_all,
    _process_node_fills_parquet,
)

log = logging.getLogger(__name__)


def backfill_candles(
    start_date: date,
    end_date: date,
    data_layer_db_path: str = "data-layer/storage/hynous-data.db",
    config: ArtemisConfig | None = None,
) -> dict:
    """Download Node Fills and build candles for a date range.

    Only runs Phase 2 (fills → candles/liq/volume/CVD).
    Skips Phase 1 (perp balances) and Phase 3 (reconstruction).

    Returns summary dict.
    """
    import sqlite3
    import threading

    config = config or ArtemisConfig()

    # Open data-layer DB with same pattern as pipeline
    class _DB:
        def __init__(self, path):
            self.conn = sqlite3.connect(path, check_same_thread=False)
            self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA busy_timeout=5000")
            self.write_lock = threading.Lock()

    db = _DB(data_layer_db_path)

    # Ensure candles_history table exists before any queries
    db.conn.execute(
        "CREATE TABLE IF NOT EXISTS candles_history ("
        "coin TEXT NOT NULL, interval TEXT NOT NULL, "
        "open_time REAL NOT NULL, open REAL NOT NULL, "
        "high REAL NOT NULL, low REAL NOT NULL, "
        "close REAL NOT NULL, volume REAL NOT NULL, "
        "PRIMARY KEY (coin, interval, open_time))",
    )
    db.conn.commit()

    total_days = (end_date - start_date).days + 1
    total_trades = 0
    total_candles = 0
    days_processed = 0
    days_skipped = 0

    current = start_date
    while current <= end_date:
        date_str = current.strftime("%Y-%m-%d")
        dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        y, m, d = dt.strftime("%Y"), dt.strftime("%m"), dt.strftime("%d")

        temp_dir = Path(config.temp_dir) / date_str
        temp_dir.mkdir(parents=True, exist_ok=True)

        try:
            # Check if candles already exist for this day
            day_start = dt.timestamp()
            day_end = day_start + 86400
            existing = db.conn.execute(
                "SELECT COUNT(*) FROM candles_history "
                "WHERE coin = 'BTC' AND interval = '5m' "
                "AND open_time >= ? AND open_time < ?",
                (day_start, day_end),
            ).fetchone()[0]

            if existing >= 280:  # ~288 expected per day, 280 = close enough
                days_skipped += 1
                if days_skipped <= 3 or days_skipped % 10 == 0:
                    log.info("Skipping %s — already has %d candles", date_str, existing)
                current += timedelta(days=1)
                continue

            # Download Node Fills
            fills_prefix = f"{config.s3_prefix}node_fills/hourly/{y}/{m}/{d}/"
            fills_files = _download_s3_all(
                config.s3_bucket, fills_prefix,
                temp_dir / "node_fills",
            )

            if not fills_files:
                log.warning("No fills data for %s — skipping", date_str)
                days_skipped += 1
                current += timedelta(days=1)
                continue

            # Process fills → candles + liq + volume + CVD
            trades, _profiles, _liqs = _process_node_fills_parquet(
                fills_files, db, date_str, config,
                skip_profiling=True,  # Don't need wallet profiling for candle backfill
            )

            total_trades += trades
            days_processed += 1

            # Count candles written
            new_candles = db.conn.execute(
                "SELECT COUNT(*) FROM candles_history "
                "WHERE coin = 'BTC' AND interval = '5m' "
                "AND open_time >= ? AND open_time < ?",
                (day_start, day_end),
            ).fetchone()[0]
            total_candles += new_candles

            elapsed_pct = days_processed / total_days * 100
            log.info(
                "[%3.0f%%] %s: %d trades → %d candles (%d/%d days)",
                elapsed_pct, date_str, trades, new_candles,
                days_processed, total_days,
            )

        except Exception:
            log.exception("Failed to process %s", date_str)

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

        current += timedelta(days=1)

    db.conn.close()

    summary = {
        "days_processed": days_processed,
        "days_skipped": days_skipped,
        "total_trades": total_trades,
        "total_candles": total_candles,
    }
    log.info("Backfill complete: %s", summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description="Backfill candles_history from Artemis S3")
    parser.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--db", default="data-layer/storage/hynous-data.db")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)

    log.info("Backfilling candles from %s to %s (%d days)", start, end, (end - start).days + 1)

    result = backfill_candles(
        start_date=start,
        end_date=end,
        data_layer_db_path=args.db,
    )

    print("\nDone: %d days processed, %d skipped, %d trades, %d candles" % (
        result["days_processed"], result["days_skipped"],
        result["total_trades"], result["total_candles"],
    ))


if __name__ == "__main__":
    main()
