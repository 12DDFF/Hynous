#!/usr/bin/env python3
"""Artemis historical backfill — reconstruct satellite snapshots from S3 data.

Usage:
    cd /root/hynous  (or wherever project root is)
    python3 scripts/backfill.py --check          # verify prerequisites
    python3 scripts/backfill.py --start 2025-08-01 --end 2026-02-27
    python3 scripts/backfill.py --start 2025-08-01 --end 2025-08-03  # small test first

Processes one day at a time:
  S3 download (~10GB) → extract → delete → next day.
  Peak temp disk usage: ~10GB. Final satellite.db growth: ~15MB/day.

Cost: ~$15-30 for full 6-month backfill (S3 requester-pays transfer).
"""

import argparse
import logging
import sqlite3
import sys
import threading
import time
from datetime import date, datetime
from pathlib import Path

# Ensure project root is on path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))
sys.path.insert(0, str(PROJECT_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("backfill")


# ─── Database adapter (no dependency on hynous_data package) ────────────────

class DataLayerDB:
    """Minimal adapter matching what the Artemis pipeline expects:
    .conn (sqlite3.Connection with Row factory) and .write_lock (threading.Lock).
    """

    def __init__(self, db_path: str | Path):
        self._path = Path(db_path)
        self.conn: sqlite3.Connection | None = None
        self.write_lock = threading.Lock()

    def connect(self) -> None:
        self.conn = sqlite3.connect(
            str(self._path),
            check_same_thread=False,
            timeout=10,
        )
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA busy_timeout=5000")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.row_factory = sqlite3.Row

    def close(self) -> None:
        if self.conn:
            self.conn.close()
            self.conn = None


def _ensure_historical_tables(db: DataLayerDB) -> None:
    """Create historical tables if they don't exist (idempotent)."""
    db.conn.executescript("""
        CREATE TABLE IF NOT EXISTS funding_history (
            coin TEXT NOT NULL,
            recorded_at REAL NOT NULL,
            rate REAL NOT NULL,
            PRIMARY KEY (coin, recorded_at)
        );
        CREATE INDEX IF NOT EXISTS idx_fh_coin_time
            ON funding_history(coin, recorded_at);

        CREATE TABLE IF NOT EXISTS oi_history (
            coin TEXT NOT NULL,
            recorded_at REAL NOT NULL,
            oi_usd REAL NOT NULL,
            PRIMARY KEY (coin, recorded_at)
        );
        CREATE INDEX IF NOT EXISTS idx_oh_coin_time
            ON oi_history(coin, recorded_at);

        CREATE TABLE IF NOT EXISTS volume_history (
            coin TEXT NOT NULL,
            recorded_at REAL NOT NULL,
            volume_usd REAL NOT NULL,
            PRIMARY KEY (coin, recorded_at)
        );
        CREATE INDEX IF NOT EXISTS idx_vh_coin_time
            ON volume_history(coin, recorded_at);

        CREATE TABLE IF NOT EXISTS liquidation_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin TEXT NOT NULL,
            occurred_at REAL NOT NULL,
            side TEXT NOT NULL,
            size_usd REAL NOT NULL,
            price REAL,
            address TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_le_coin_time
            ON liquidation_events(coin, occurred_at);

        CREATE TABLE IF NOT EXISTS addresses (
            address TEXT PRIMARY KEY,
            first_seen REAL,
            last_seen REAL,
            trade_count INTEGER DEFAULT 0,
            last_polled REAL,
            tier INTEGER DEFAULT 3,
            total_size_usd REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS wallet_profiles (
            address TEXT PRIMARY KEY,
            computed_at REAL,
            win_rate REAL,
            trade_count INTEGER,
            profit_factor REAL,
            avg_hold_hours REAL,
            avg_pnl_pct REAL,
            max_drawdown REAL,
            style TEXT,
            is_bot INTEGER,
            equity REAL,
            source TEXT
        );

        CREATE TABLE IF NOT EXISTS trade_flow_history (
            coin TEXT NOT NULL,
            recorded_at REAL NOT NULL,
            buy_volume_usd REAL DEFAULT 0,
            sell_volume_usd REAL DEFAULT 0,
            PRIMARY KEY (coin, recorded_at)
        );
        CREATE INDEX IF NOT EXISTS idx_tfh_coin_time
            ON trade_flow_history(coin, recorded_at);

        CREATE TABLE IF NOT EXISTS candles_history (
            coin TEXT NOT NULL,
            interval TEXT NOT NULL,
            open_time REAL NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL NOT NULL,
            PRIMARY KEY (coin, interval, open_time)
        );
        CREATE INDEX IF NOT EXISTS idx_ch_coin_interval_time
            ON candles_history(coin, interval, open_time);
    """)
    db.conn.commit()


# ─── Prerequisite checks ────────────────────────────────────────────────────

def check_prerequisites() -> bool:
    """Verify all prerequisites for running the backfill."""
    ok = True

    # 1. boto3
    print("Checking boto3...", end=" ")
    try:
        import boto3
        print(f"OK (v{boto3.__version__})")
    except ImportError:
        print("MISSING — run: pip install boto3")
        ok = False

    # 2. AWS credentials
    print("Checking AWS credentials...", end=" ")
    try:
        import boto3
        sts = boto3.client("sts")
        identity = sts.get_caller_identity()
        print(f"OK (account: {identity['Account']})")
    except Exception as e:
        err = str(e)
        if "NoCredentialsError" in type(e).__name__ or "credentials" in err.lower():
            print("MISSING — configure AWS credentials:")
            print("  Option A: aws configure")
            print("  Option B: export AWS_ACCESS_KEY_ID=... && export AWS_SECRET_ACCESS_KEY=...")
            print("  Option C: Create ~/.aws/credentials")
        else:
            print(f"ERROR: {e}")
        ok = False

    # 3. S3 bucket accessible
    if ok:
        print("Checking S3 bucket access...", end=" ")
        try:
            import boto3
            s3 = boto3.client("s3")
            response = s3.list_objects_v2(
                Bucket="artemis-hyperliquid-data",
                Prefix="raw/node_fills/",
                MaxKeys=1,
                RequestPayer="requester",
            )
            if "Contents" in response:
                print("OK (bucket accessible, requester-pays confirmed)")
            else:
                print("WARNING — bucket accessible but no objects found at expected path")
        except Exception as e:
            print(f"FAILED: {e}")
            ok = False

    # 4. Satellite module
    print("Checking satellite module...", end=" ")
    try:
        import satellite
        from satellite.store import SatelliteStore
        from satellite.artemis.pipeline import process_date_range, ArtemisConfig
        print("OK")
    except ImportError as e:
        print(f"MISSING: {e}")
        ok = False

    # 5. Hyperliquid SDK (for candle/funding fetch)
    print("Checking hyperliquid SDK...", end=" ")
    try:
        from hyperliquid.info import Info
        print("OK")
    except ImportError:
        print("MISSING — run: pip install hyperliquid-python-sdk")
        ok = False

    # 6. Disk space
    print("Checking disk space...", end=" ")
    import shutil
    total, used, free = shutil.disk_usage("/tmp")
    free_gb = free / (1024 ** 3)
    if free_gb >= 15:
        print(f"OK ({free_gb:.1f}GB free)")
    else:
        print(f"LOW ({free_gb:.1f}GB free, need ~15GB for temp processing)")
        ok = False

    # 7. Data-layer DB
    print("Checking data-layer DB...", end=" ")
    dl_path = _find_data_layer_db()
    if dl_path and dl_path.exists():
        size_mb = dl_path.stat().st_size / (1024 ** 2)
        print(f"OK ({dl_path}, {size_mb:.1f}MB)")
    else:
        print(f"WARNING — not found at expected paths, will create new")

    # 8. Satellite DB
    print("Checking satellite DB...", end=" ")
    sat_path = _find_satellite_db()
    if sat_path and sat_path.exists():
        size_mb = sat_path.stat().st_size / (1024 ** 2)
        # Count existing snapshots
        try:
            conn = sqlite3.connect(str(sat_path))
            count = conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
            conn.close()
            print(f"OK ({sat_path}, {size_mb:.1f}MB, {count} existing snapshots)")
        except Exception:
            print(f"OK ({sat_path}, {size_mb:.1f}MB)")
    else:
        print(f"Will create new at {sat_path or 'storage/satellite.db'}")

    print()
    if ok:
        print("All prerequisites met. Ready to backfill.")
    else:
        print("Some prerequisites missing. Fix the issues above before running.")

    return ok


def _find_data_layer_db() -> Path | None:
    """Find the data-layer database file."""
    candidates = [
        PROJECT_ROOT / "storage" / "hynous-data.db",
        PROJECT_ROOT / "storage" / "data-layer.db",
    ]
    # Try loading from config
    try:
        from hynous.core.config import load_config
        cfg = load_config()
        candidates.insert(0, cfg.project_root / "storage" / "hynous-data.db")
    except Exception:
        pass

    for p in candidates:
        if p.exists():
            return p
    return candidates[0]  # default path


def _find_satellite_db() -> Path | None:
    """Find the satellite database file."""
    candidates = [
        PROJECT_ROOT / "storage" / "satellite.db",
    ]
    try:
        from hynous.core.config import load_config
        cfg = load_config()
        candidates.insert(0, cfg.project_root / cfg.satellite.db_path)
    except Exception:
        pass

    for p in candidates:
        if p.exists():
            return p
    return candidates[0]


# ─── Funding Pre-fetch ─────────────────────────────────────────────────────

def _prefetch_funding(
    db: DataLayerDB, start_date: date, end_date: date, coins: list[str],
) -> None:
    """Pre-fetch ALL funding history from HL API and store to DB.

    Fetches in monthly chunks to avoid oversized responses.
    """
    import requests

    from datetime import datetime, timezone, timedelta

    # We need 30 days before start for z-score computation
    fetch_start = datetime.combine(
        start_date - timedelta(days=30), datetime.min.time(),
    ).replace(tzinfo=timezone.utc)
    fetch_end = datetime.combine(
        end_date + timedelta(days=1), datetime.min.time(),
    ).replace(tzinfo=timezone.utc)

    # Check what we already have
    existing = 0
    try:
        existing = db.conn.execute(
            "SELECT COUNT(*) FROM funding_history",
        ).fetchone()[0]
    except Exception:
        pass

    if existing > 0:
        log.info("funding_history already has %d rows, checking for gaps...", existing)

    total_written = 0
    for coin in coins:
        # Fetch in 30-day chunks
        chunk_start = fetch_start
        while chunk_start < fetch_end:
            chunk_end = min(chunk_start + timedelta(days=30), fetch_end)
            start_ms = int(chunk_start.timestamp() * 1000)
            end_ms = int(chunk_end.timestamp() * 1000)

            try:
                resp = requests.post(
                    "https://api.hyperliquid.xyz/info",
                    json={
                        "type": "fundingHistory",
                        "coin": coin,
                        "startTime": start_ms,
                        "endTime": end_ms,
                    },
                    timeout=30,
                )
                if resp.status_code == 429:
                    log.warning("Rate limited on funding prefetch, waiting 60s...")
                    time.sleep(60)
                    continue  # retry same chunk
                resp.raise_for_status()
                raw = resp.json()

                rows = []
                for r in raw:
                    t = r.get("time", 0)
                    if isinstance(t, str):
                        t = datetime.fromisoformat(t).timestamp()
                    elif isinstance(t, (int, float)) and t > 1e12:
                        t = t / 1000
                    rate = float(r.get("fundingRate", 0))
                    rows.append((coin, t, rate))

                if rows:
                    with db.write_lock:
                        db.conn.executemany(
                            "INSERT OR IGNORE INTO funding_history "
                            "(coin, recorded_at, rate) VALUES (?, ?, ?)",
                            rows,
                        )
                        db.conn.commit()
                    total_written += len(rows)

                log.info(
                    "Funding %s %s to %s: %d records",
                    coin, chunk_start.strftime("%Y-%m-%d"),
                    chunk_end.strftime("%Y-%m-%d"), len(rows),
                )
            except Exception:
                log.exception(
                    "Failed funding fetch %s %s-%s",
                    coin, chunk_start.strftime("%Y-%m-%d"),
                    chunk_end.strftime("%Y-%m-%d"),
                )

            chunk_start = chunk_end
            time.sleep(15)  # Conservative rate limit between chunks

    final_count = db.conn.execute(
        "SELECT COUNT(*) FROM funding_history",
    ).fetchone()[0]
    log.info(
        "Funding prefetch complete: %d new rows, %d total in DB",
        total_written, final_count,
    )


# ─── Main backfill logic ────────────────────────────────────────────────────

def run_backfill(start_date: date, end_date: date, dry_run: bool = False) -> None:
    """Run the Artemis backfill pipeline."""
    total_days = (end_date - start_date).days + 1
    log.info(
        "Starting backfill: %s to %s (%d days, %d estimated snapshots)",
        start_date, end_date, total_days, total_days * 288 * 3,
    )

    if dry_run:
        log.info("DRY RUN — would process %d days. Exiting.", total_days)
        return

    # Connect to databases
    dl_path = _find_data_layer_db()
    sat_path = _find_satellite_db()

    log.info("Data-layer DB: %s", dl_path)
    log.info("Satellite DB: %s", sat_path)

    dl_db = DataLayerDB(dl_path)
    dl_db.connect()
    _ensure_historical_tables(dl_db)

    from satellite.store import SatelliteStore
    sat_store = SatelliteStore(str(sat_path))
    sat_store.connect()

    # Pre-fetch ALL funding history from HL API (has full history)
    # This avoids making API calls during the main processing loop.
    _prefetch_funding(dl_db, start_date, end_date, ["BTC", "ETH", "SOL"])

    # Run pipeline (zero HL API calls during processing)
    from satellite.artemis.pipeline import process_date_range, ArtemisConfig

    config = ArtemisConfig(
        coins=["BTC", "ETH", "SOL"],
        batch_size=10000,
        min_position_usd=50_000,
        api_delay_seconds=0.5,
    )

    t0 = time.time()
    try:
        results = process_date_range(
            start_date=start_date,
            end_date=end_date,
            data_layer_db=dl_db,
            satellite_store=sat_store,
            config=config,
            skip_profiling=True,  # Save memory during backfill
        )
    finally:
        dl_db.close()
        sat_store.close()

    elapsed = time.time() - t0

    # Report
    print("\n" + "=" * 60)
    print("BACKFILL COMPLETE")
    print("=" * 60)
    total_snaps = sum(r.snapshots_reconstructed for r in results)
    total_labels = sum(r.labels_computed for r in results)
    total_liqs = sum(r.liquidation_events for r in results)
    total_addrs = sum(r.addresses_discovered for r in results)
    total_trades = sum(r.trades_processed for r in results)
    total_profiles = sum(r.profiles_computed for r in results)

    print(f"Days processed:     {len(results)}/{total_days}")
    print(f"Snapshots created:  {total_snaps:,}")
    print(f"Labels computed:    {total_labels:,}")
    print(f"Liquidation events: {total_liqs:,}")
    print(f"Addresses found:    {total_addrs:,}")
    print(f"Trades processed:   {total_trades:,}")
    print(f"Profiles computed:  {total_profiles:,}")
    print(f"Total time:         {elapsed/3600:.1f}h ({elapsed/60:.0f}m)")
    print(f"Avg per day:        {elapsed/max(len(results),1)/60:.1f}m")

    # Show DB sizes
    if dl_path.exists():
        print(f"\nData-layer DB: {dl_path.stat().st_size / 1024**2:.1f}MB")
    sat_path_obj = Path(sat_path) if isinstance(sat_path, str) else sat_path
    if sat_path_obj.exists():
        print(f"Satellite DB:  {sat_path_obj.stat().st_size / 1024**2:.1f}MB")

    # Show failed days
    failed = total_days - len(results)
    if failed:
        print(f"\nWARNING: {failed} days failed — check logs above")


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Artemis historical backfill for satellite ML training data",
    )
    parser.add_argument(
        "--check", action="store_true",
        help="Check prerequisites only, don't run backfill",
    )
    parser.add_argument(
        "--start", type=str, default="2025-08-01",
        help="Start date (YYYY-MM-DD, default: 2025-08-01)",
    )
    parser.add_argument(
        "--end", type=str, default=None,
        help="End date (YYYY-MM-DD, default: yesterday)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Check what would be done without actually processing",
    )
    args = parser.parse_args()

    if args.check:
        check_prerequisites()
        return

    # Parse dates
    start = datetime.strptime(args.start, "%Y-%m-%d").date()
    end = (
        datetime.strptime(args.end, "%Y-%m-%d").date()
        if args.end
        else date.today() - __import__("datetime").timedelta(days=1)
    )

    if start > end:
        print(f"Error: start ({start}) is after end ({end})")
        sys.exit(1)

    # Run prerequisite check first
    print("Running prerequisite checks...\n")
    if not check_prerequisites():
        print("\nFix prerequisites before running backfill.")
        sys.exit(1)

    print()
    run_backfill(start, end, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
